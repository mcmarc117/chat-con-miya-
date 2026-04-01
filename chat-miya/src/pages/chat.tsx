import { useEffect, useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  useGetMe,
  useGetMessages,
  useSendMessage,
  useDeleteMessage,
  useMarkMessagesRead,
  useLogout,
  getGetMessagesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LogOut, Trash2, Check, CheckCheck, Send, Smile } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { Message } from "@workspace/api-client-react/src/generated/api.schemas";

const EMOJI_LIST = [
  "❤️","🥰","😍","😘","💋","💕","💞","💓","💗","💖",
  "🫶","🤗","😊","🥹","😁","😂","🤣","😅","😆","🥲",
  "😴","🤔","😎","🤩","😇","🙈","🙉","🙊","🫠","🥺",
  "😭","😩","😤","🤯","😱","🤭","🫡","👀","✨","🌹",
  "🌸","🌺","🌻","🍓","🍒","🍑","🧁","🎂","🎁","🎀",
  "🐱","🐶","🐰","🦊","🐻","🐼","🦄","🌈","⭐","🌙",
];

export default function Chat() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const [newMessage, setNewMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedMsgId, setSelectedMsgId] = useState<number | null>(null);
  const [showEmojis, setShowEmojis] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const initialized = useRef(false);

  const { data: user, isError: authError } = useGetMe({
    query: {
      retry: false,
      queryKey: ["/api/auth/me"],
    },
  });

  useEffect(() => {
    if (authError) {
      setLocation("/login");
    }
  }, [authError, setLocation]);

  const queryKey = getGetMessagesQueryKey({ limit: 50 });

  const { data: messagesData, isLoading: messagesLoading } = useGetMessages(
    { limit: 50 },
    {
      query: {
        queryKey,
        enabled: !!user,
      },
    }
  );

  useEffect(() => {
    if (messagesData?.messages) {
      // Server already returns messages in ascending order (oldest first, newest last)
      // DO NOT reverse — they are already in the correct order
      setMessages([...messagesData.messages]);
      setHasMore(messagesData.messages.length >= 50);
      if (!initialized.current) {
        initialized.current = true;
        setTimeout(scrollToBottom, 100);
      }
    }
  }, [messagesData]);

  const markReadMutation = useMarkMessagesRead();
  useEffect(() => {
    const handleFocus = () => {
      if (user && document.hasFocus()) {
        markReadMutation.mutate({});
      }
    };
    window.addEventListener("focus", handleFocus);
    if (user && document.hasFocus()) {
      markReadMutation.mutate({});
    }
    return () => window.removeEventListener("focus", handleFocus);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const sse = new EventSource("/api/messages/sse", { withCredentials: true });

    sse.addEventListener("message", (e) => {
      const msg: Message = JSON.parse(e.data);
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      queryClient.invalidateQueries({ queryKey: getGetMessagesQueryKey() });
      if (msg.senderId !== user.id && document.hasFocus()) {
        markReadMutation.mutate({});
      }
      setTimeout(scrollToBottom, 50);
    });

    sse.addEventListener("delete", (e) => {
      const data = JSON.parse(e.data);
      setMessages((prev) => prev.filter((m) => m.id !== data.id));
      queryClient.invalidateQueries({ queryKey: getGetMessagesQueryKey() });
    });

    sse.addEventListener("read", () => {
      setMessages((prev) =>
        prev.map((m) => (m.senderId === user.id ? { ...m, isRead: true } : m))
      );
      queryClient.invalidateQueries({ queryKey: getGetMessagesQueryKey() });
    });

    return () => sse.close();
  }, [user, queryClient]);

  // Load older messages when scrolling to top
  const loadMoreMessages = useCallback(async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    const oldestId = messages[0].id;
    const container = scrollContainerRef.current;
    const scrollHeightBefore = container?.scrollHeight ?? 0;

    setLoadingMore(true);
    try {
      const res = await fetch(`/api/messages?limit=50&before=${oldestId}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (data.messages && data.messages.length > 0) {
        setMessages((prev) => [...data.messages, ...prev]);
        setHasMore(data.messages.length >= 50);
        // Restore scroll position so it does not jump to top
        // Double rAF needed on iOS: first frame lets React flush DOM, second applies scroll
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (container) {
              container.scrollTop = container.scrollHeight - scrollHeightBefore;
            }
          });
        });
      } else {
        setHasMore(false);
      }
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, messages]);

  // Detect scroll to top → load more
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      if (container.scrollTop < 60 && hasMore && !loadingMore) {
        loadMoreMessages();
      }
    };
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [loadMoreMessages, hasMore, loadingMore]);

  // Close emoji picker on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojis(false);
      }
    };
    if (showEmojis) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showEmojis]);

  const scrollToBottom = () => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  };

  const sendMessageMutation = useSendMessage({
    mutation: {
      onSuccess: () => {
        setNewMessage("");
        scrollToBottom();
      },
    },
  });

  const deleteMessageMutation = useDeleteMessage();

  const handleSend = () => {
    if (!newMessage.trim()) return;
    sendMessageMutation.mutate({ data: { content: newMessage.trim() } });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const logoutMutation = useLogout({
    mutation: {
      onSuccess: () => {
        queryClient.clear();
        setLocation("/login");
      },
    },
  });

  const handleMessageTap = (msg: Message, isMine: boolean) => {
    if (!isMine) return;
    setSelectedMsgId((prev) => (prev === msg.id ? null : msg.id));
  };

  const handleDelete = (id: number) => {
    deleteMessageMutation.mutate({ id });
    setSelectedMsgId(null);
  };

  const insertEmoji = (emoji: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setNewMessage((prev) => prev + emoji);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const updated = newMessage.slice(0, start) + emoji + newMessage.slice(end);
    setNewMessage(updated);
    setShowEmojis(false);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + emoji.length, start + emoji.length);
    }, 0);
  };

  if (!user) return null;

  const partnerName = user.username === "marc" ? "Miya" : "Marc";

  return (
    <div
      className="flex flex-col h-[100dvh] bg-background"
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (!target.closest("[data-message]")) {
          setSelectedMsgId(null);
        }
      }}
    >
      {/* Header */}
      <header className="flex-none h-16 border-b border-border/40 bg-card/50 backdrop-blur-md flex items-center justify-between px-6 z-10 sticky top-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-sm">
            {partnerName.charAt(0)}
          </div>
          <div>
            <h1 className="font-medium text-foreground">{partnerName}</h1>
            <p className="text-xs text-muted-foreground">Aquí podremos hablar libremente</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => logoutMutation.mutate()}
        >
          <LogOut className="w-4 h-4" />
        </Button>
      </header>

      {/* Chat Area */}
      <main
        ref={scrollContainerRef}
        className="flex-1 overflow-y-scroll p-4 space-y-1 flex flex-col overscroll-y-contain"
        style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
      >
        {messagesLoading ? (
          <div className="flex-1 flex flex-col justify-end space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`flex ${i % 2 === 0 ? "justify-end" : "justify-start"}`}>
                <div className="w-48 h-12 bg-muted/50 rounded-2xl animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex flex-col justify-end min-h-full">
            {/* Load more indicator */}
            {loadingMore && (
              <div className="flex justify-center py-3">
                <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            )}
            {!hasMore && messages.length > 0 && (
              <div className="text-center py-3">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40 font-medium">
                  Inicio de la conversación
                </span>
              </div>
            )}
            <div className="space-y-1 pb-2">
              <AnimatePresence initial={false}>
                {messages.map((msg, idx) => {
                  const isMine = msg.senderId === user.id;
                  const showTime =
                    idx === 0 ||
                    new Date(msg.createdAt).getTime() -
                      new Date(messages[idx - 1].createdAt).getTime() >
                      5 * 60 * 1000;
                  const isSelected = selectedMsgId === msg.id;

                  return (
                    <div key={msg.id} className="flex flex-col">
                      {showTime && (
                        <div className="text-center my-3">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium bg-background/80 px-2 py-1 rounded-full">
                            {format(new Date(msg.createdAt), "d MMM, HH:mm", { locale: es })}
                          </span>
                        </div>
                      )}
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
                        className={`flex relative ${isMine ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          data-message
                          className={`max-w-[78%] px-4 py-2.5 text-[15px] leading-relaxed shadow-sm cursor-pointer select-none transition-opacity ${
                            isMine
                              ? "bg-primary text-primary-foreground rounded-2xl rounded-br-sm"
                              : "bg-card text-card-foreground border border-border/50 rounded-2xl rounded-bl-sm"
                          }`}
                          onClick={() => handleMessageTap(msg, isMine)}
                        >
                          <div className="whitespace-pre-wrap break-words">{msg.content}</div>

                          {isMine && (
                            <div className="flex justify-end mt-1 items-center gap-1 opacity-70">
                              <span className="text-[10px]">
                                {format(new Date(msg.createdAt), "HH:mm")}
                              </span>
                              {msg.isRead ? (
                                <CheckCheck className="w-3 h-3" />
                              ) : (
                                <Check className="w-3 h-3" />
                              )}
                            </div>
                          )}
                          {!isMine && (
                            <div className="flex justify-start mt-1 items-center opacity-40">
                              <span className="text-[10px]">
                                {format(new Date(msg.createdAt), "HH:mm")}
                              </span>
                            </div>
                          )}
                        </div>
                      </motion.div>

                      {/* Delete button — shown on tap for own messages */}
                      <AnimatePresence>
                        {isMine && isSelected && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="flex justify-end pr-1 mt-1"
                          >
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1"
                              onClick={() => handleDelete(msg.id)}
                            >
                              <Trash2 className="w-3 h-3" />
                              Eliminar
                            </Button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </AnimatePresence>
            </div>
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {/* Emoji Picker */}
      <AnimatePresence>
        {showEmojis && (
          <motion.div
            ref={emojiPickerRef}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.15 }}
            className="mx-3 mb-1 bg-card border border-border/60 rounded-2xl p-3 shadow-lg grid grid-cols-10 gap-1"
          >
            {EMOJI_LIST.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="text-xl h-9 w-9 flex items-center justify-center rounded-xl hover:bg-primary/10 active:scale-90 transition-transform"
                onClick={() => insertEmoji(emoji)}
              >
                {emoji}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input Area */}
      <footer className="flex-none p-3 bg-background/80 backdrop-blur-xl border-t border-border/50 pb-safe">
        <div className="flex items-end gap-2 bg-card border border-border/60 rounded-3xl p-2 shadow-sm focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/30 transition-all">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={`h-10 w-10 rounded-full shrink-0 transition-colors mb-0.5 ml-0.5 ${
              showEmojis ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-primary hover:bg-primary/10"
            }`}
            onClick={() => setShowEmojis((v) => !v)}
          >
            <Smile className="w-5 h-5" />
          </Button>
          <Textarea
            ref={textareaRef}
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe algo..."
            className="min-h-[44px] max-h-[140px] resize-none border-0 focus-visible:ring-0 shadow-none bg-transparent py-2.5 px-3 flex-1 text-base placeholder:text-muted-foreground/50"
            rows={1}
          />
          <Button
            size="icon"
            className="h-10 w-10 rounded-full shrink-0 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-colors mb-0.5 mr-0.5"
            onClick={handleSend}
            disabled={!newMessage.trim() || sendMessageMutation.isPending}
          >
            <Send className="w-4 h-4 ml-0.5" />
          </Button>
        </div>
      </footer>
    </div>
  );
}

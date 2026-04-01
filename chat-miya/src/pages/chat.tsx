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
import { LogOut, Trash2, Check, CheckCheck, Send, Smile, Reply, X } from "lucide-react";
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

  // Swipe-to-reply state
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [swipeOffset, setSwipeOffset] = useState<{ id: number; x: number } | null>(null);
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const swipingId = useRef<number | null>(null);
  const swipeVerticalLocked = useRef(false);

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
    container.addEventListener("scroll", handleScroll, { passive: true });
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
        setReplyTo(null);
        scrollToBottom();
      },
    },
  });

  const deleteMessageMutation = useDeleteMessage();

  const handleSend = () => {
    if (!newMessage.trim()) return;
    sendMessageMutation.mutate({
      data: {
        content: newMessage.trim(),
        replyToId: replyTo?.id ?? null,
      },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const insertEmoji = (emoji: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newValue = newMessage.slice(0, start) + emoji + newMessage.slice(end);
    setNewMessage(newValue);
    setTimeout(() => {
      textarea.selectionStart = textarea.selectionEnd = start + emoji.length;
      textarea.focus();
    }, 0);
  };

  const handleMessageTap = (msg: Message, isMine: boolean) => {
    if (!isMine) return;
    setSelectedMsgId((prev) => (prev === msg.id ? null : msg.id));
  };

  const logoutMutation = useLogout({
    mutation: {
      onSuccess: () => setLocation("/login"),
    },
  });

  // Swipe-to-reply touch handlers
  const handleTouchStart = (msgId: number, e: React.TouchEvent) => {
    swipeStartX.current = e.touches[0].clientX;
    swipeStartY.current = e.touches[0].clientY;
    swipingId.current = msgId;
    swipeVerticalLocked.current = false;
  };

  const handleTouchMove = (msgId: number, e: React.TouchEvent) => {
    if (swipingId.current !== msgId) return;
    if (swipeVerticalLocked.current) return;

    const dx = e.touches[0].clientX - swipeStartX.current;
    const dy = Math.abs(e.touches[0].clientY - swipeStartY.current);

    // If vertical movement dominant, lock to scroll
    if (dy > 20 && dy > Math.abs(dx)) {
      swipeVerticalLocked.current = true;
      setSwipeOffset(null);
      return;
    }

    // Only right swipe
    if (dx > 4) {
      setSwipeOffset({ id: msgId, x: Math.min(dx * 0.6, 72) });
    }
  };

  const handleTouchEnd = (msg: Message) => {
    if (swipeOffset?.id === msg.id) {
      if (swipeOffset.x >= 50) {
        setReplyTo(msg);
        setSelectedMsgId(null);
        try { navigator.vibrate(12); } catch { /* ignore */ }
        setTimeout(() => textareaRef.current?.focus(), 100);
      }
    }
    setSwipeOffset(null);
    swipingId.current = null;
    swipeVerticalLocked.current = false;
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
        className="flex-1 overflow-y-scroll"
        style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
      >
        {messagesLoading ? (
          <div className="flex flex-col justify-end min-h-full p-4 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`flex ${i % 2 === 0 ? "justify-end" : "justify-start"}`}>
                <div className="w-48 h-12 bg-muted/50 rounded-2xl animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col justify-end min-h-full p-4">
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
                  const currentSwipeX = swipeOffset?.id === msg.id ? swipeOffset.x : 0;

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
                        {/* Reply icon — fades in as you swipe right */}
                        <div
                          className="absolute top-1/2 pointer-events-none"
                          style={{
                            left: isMine ? undefined : `${Math.max(currentSwipeX - 28, -4)}px`,
                            right: isMine ? `${Math.max(currentSwipeX - 28, -4)}px` : undefined,
                            transform: "translateY(-50%)",
                            opacity: Math.min(currentSwipeX / 50, 1),
                            transition: currentSwipeX === 0 ? "opacity 0.2s" : "none",
                          }}
                        >
                          <Reply className="w-5 h-5 text-primary" />
                        </div>

                        {/* Swipe wrapper */}
                        <div
                          style={{
                            transform: `translateX(${isMine ? -currentSwipeX : currentSwipeX}px)`,
                            transition: currentSwipeX === 0 ? "transform 0.25s ease-out" : "none",
                            display: "flex",
                          }}
                          onTouchStart={(e) => handleTouchStart(msg.id, e)}
                          onTouchMove={(e) => handleTouchMove(msg.id, e)}
                          onTouchEnd={() => handleTouchEnd(msg)}
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
                            {/* Reply preview inside bubble */}
                            {msg.replyToId && msg.replyToContent && (
                              <div
                                className={`rounded-xl px-3 py-1.5 mb-2 border-l-[3px] border-primary/70 ${
                                  isMine
                                    ? "bg-white/10"
                                    : "bg-muted/60"
                                }`}
                              >
                                <p className={`text-[11px] font-semibold mb-0.5 ${isMine ? "text-primary-foreground/90" : "text-primary"}`}>
                                  {msg.replyToSenderName}
                                </p>
                                <p className={`text-[12px] line-clamp-2 ${isMine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                                  {msg.replyToContent}
                                </p>
                              </div>
                            )}

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
                        </div>

                        {/* Delete button — shown on tap for own messages */}
                        <AnimatePresence>
                          {isSelected && isMine && (
                            <motion.button
                              initial={{ opacity: 0, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.8 }}
                              className="absolute -bottom-7 right-0 flex items-center gap-1 text-destructive text-xs bg-background border border-border rounded-full px-2.5 py-1 shadow-md z-10"
                              onClick={() => {
                                deleteMessageMutation.mutate({ id: String(msg.id) });
                                setSelectedMsgId(null);
                              }}
                            >
                              <Trash2 className="w-3 h-3" />
                              Eliminar
                            </motion.button>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    </div>
                  );
                })}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </div>
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
            className="flex-none border-t border-border/40 bg-card/80 backdrop-blur-xl px-3 py-2 grid grid-cols-10 gap-0.5 max-h-40 overflow-y-auto"
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

      {/* Reply Preview Bar */}
      <AnimatePresence>
        {replyTo && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="flex-none overflow-hidden bg-card/60 backdrop-blur-sm border-t border-border/30 px-4 py-2"
          >
            <div className="flex items-center gap-2">
              <Reply className="w-4 h-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0 border-l-2 border-primary pl-2.5">
                <p className="text-[11px] font-semibold text-primary leading-none mb-0.5">
                  {replyTo.senderName}
                </p>
                <p className="text-[12px] text-muted-foreground truncate leading-tight">
                  {replyTo.content}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground rounded-full"
                onClick={() => setReplyTo(null)}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
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

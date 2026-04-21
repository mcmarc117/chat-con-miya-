import { useEffect, useState, useRef } from "react";
import { useLocation } from "wouter";
import {
  useGetMe,
  useGetMessages,
  useSendMessage,
  getGetMessagesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Send, RefreshCw, Film } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import type { Message } from "@workspace/api-client-react/src/generated/api.schemas";

interface WatchState {
  url: string;
  playing: boolean;
  currentTime: number;
  updatedAt: number;
}

function getYouTubeId(url: string): string | null {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
    /\/live\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function getVimeoEmbedUrl(url: string): string | null {
  const m = url.match(/vimeo\.com\/(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  return null;
}

function isDirectVideo(url: string): boolean {
  return /\.(mp4|webm|ogg|mov)(\?|$)/i.test(url);
}

function ytCmd(iframe: HTMLIFrameElement | null, func: string, args: unknown[] = []) {
  if (!iframe?.contentWindow) return;
  iframe.contentWindow.postMessage(
    JSON.stringify({ event: "command", func, args }),
    "*"
  );
}

export default function Watch() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const ytIframeRef = useRef<HTMLIFrameElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stateRef = useRef<WatchState | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const suppressRef = useRef(false);
  const currentTimeRef = useRef(0);
  const initialized = useRef(false);

  const [newMessage, setNewMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [videoUrl, setVideoUrl] = useState("");
  const [inputUrl, setInputUrl] = useState("");
  const [pendingSync, setPendingSync] = useState(false);

  const { data: user, isError: authError } = useGetMe({
    query: { retry: false, queryKey: ["/api/auth/me"] },
  });
  useEffect(() => {
    if (authError) setLocation("/login");
  }, [authError, setLocation]);

  const isMarc = user?.username === "marc";
  const ytId = videoUrl ? getYouTubeId(videoUrl) : null;
  const vimeoEmbedUrl = !ytId && videoUrl ? getVimeoEmbedUrl(videoUrl) : null;
  const isDirect = !ytId && !vimeoEmbedUrl && videoUrl ? isDirectVideo(videoUrl) : false;

  // Listen to postMessage events from YouTube iframe (both Marc and Miya)
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      let data: Record<string, unknown>;
      try { data = JSON.parse(e.data); } catch { return; }

      if (data.event === "infoDelivery" && typeof (data.info as Record<string, unknown>)?.currentTime === "number") {
        currentTimeRef.current = (data.info as Record<string, unknown>).currentTime as number;
      }

      if (isMarc && !suppressRef.current && data.event === "onStateChange") {
        if (data.info === 1 || data.info === 2) {
          const playing = data.info === 1;
          postWatchState(videoUrl, playing, currentTimeRef.current);
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [isMarc, videoUrl]);

  // Marc: heartbeat every 5s while playing
  useEffect(() => {
    if (!isMarc) return;
    heartbeatRef.current = setInterval(() => {
      const video = videoRef.current;
      if (ytIframeRef.current) {
        ytIframeRef.current.contentWindow?.postMessage(
          JSON.stringify({ event: "listening" }),
          "*"
        );
        if (stateRef.current?.playing) {
          const elapsed = (Date.now() - (stateRef.current.updatedAt ?? 0)) / 1000;
          const approxTime = (stateRef.current.currentTime ?? 0) + elapsed;
          postWatchState(videoUrl, true, approxTime);
        }
      } else if (video && !video.paused) {
        postWatchState(videoUrl, true, video.currentTime);
      }
    }, 5000);
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [isMarc, videoUrl]);

  // Load initial watch state
  useEffect(() => {
    if (!user) return;
    fetch("/api/watch/state", { credentials: "include" })
      .then((r) => r.json())
      .then((state: WatchState) => {
        if (state.url) {
          stateRef.current = state;
          setVideoUrl(state.url);
          setInputUrl(state.url);
          if (!isMarc) setPendingSync(true);
        }
      });
  }, [user]);

  // Messages
  const queryKey = getGetMessagesQueryKey({ limit: 50 });
  const { data: messagesData } = useGetMessages(
    { limit: 50 },
    { query: { queryKey, enabled: !!user } }
  );
  useEffect(() => {
    if (messagesData?.messages) {
      setMessages([...messagesData.messages]);
      if (!initialized.current) {
        initialized.current = true;
        setTimeout(() => messagesEndRef.current?.scrollIntoView(), 100);
      }
    }
  }, [messagesData]);

  // SSE
  useEffect(() => {
    if (!user) return;
    const sse = new EventSource("/api/messages/sse", { withCredentials: true });

    sse.addEventListener("message", (e) => {
      const msg: Message = JSON.parse(e.data);
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      queryClient.invalidateQueries({ queryKey: getGetMessagesQueryKey() });
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    });
    sse.addEventListener("delete", (e) => {
      const { id } = JSON.parse(e.data);
      setMessages((prev) => prev.filter((m) => m.id !== id));
    });
    sse.addEventListener("watch-state", (e) => {
      const state: WatchState = JSON.parse(e.data);
      stateRef.current = state;
      if (state.url && state.url !== videoUrl) {
        setVideoUrl(state.url);
        setInputUrl(state.url);
      }
      if (!isMarc) {
        setPendingSync(false);
        applyWatchState(state);
      }
    });

    return () => sse.close();
  }, [user, videoUrl, isMarc]);

  function applyWatchState(state: WatchState) {
    if (!state.url) return;
    const elapsed = (Date.now() - state.updatedAt) / 1000;
    const targetTime = state.currentTime + (state.playing ? elapsed : 0);

    const iframe = ytIframeRef.current;
    const video = videoRef.current;

    if (iframe) {
      suppressRef.current = true;
      ytCmd(iframe, "seekTo", [targetTime, true]);
      if (state.playing) ytCmd(iframe, "playVideo");
      else ytCmd(iframe, "pauseVideo");
      setTimeout(() => { suppressRef.current = false; }, 1500);
    } else if (video) {
      video.currentTime = targetTime;
      if (state.playing) video.play().catch(() => setPendingSync(true));
      else video.pause();
    } else {
      setPendingSync(true);
    }
  }

  async function postWatchState(url: string, playing: boolean, currentTime: number) {
    if (!url) return;
    const state = { url, playing, currentTime };
    stateRef.current = { ...state, updatedAt: Date.now() };
    await fetch("/api/watch/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(state),
    });
  }

  function handleLoadVideo() {
    const url = inputUrl.trim();
    if (!url || !isMarc) return;
    setVideoUrl(url);
    postWatchState(url, false, 0);
  }

  function handleSyncNow() {
    if (stateRef.current) applyWatchState(stateRef.current);
    setPendingSync(false);
  }

  function handleMarcSync() {
    const iframe = ytIframeRef.current;
    const video = videoRef.current;
    const currentTime = iframe ? currentTimeRef.current : (video?.currentTime ?? 0);
    const playing = video ? !video.paused : (stateRef.current?.playing ?? false);
    postWatchState(videoUrl, playing, currentTime);
  }

  const sendMessageMutation = useSendMessage();
  function handleSend() {
    if (!newMessage.trim()) return;
    sendMessageMutation.mutate({ data: { content: newMessage.trim() } });
    setNewMessage("");
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!user) return null;

  return (
    <div className="flex flex-col h-[100dvh] bg-background overflow-hidden">
      {/* Header */}
      <header className="flex-none h-12 border-b border-border/40 bg-card/50 backdrop-blur-md flex items-center gap-2 px-3 z-10">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setLocation("/")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <Film className="w-4 h-4 text-primary shrink-0" />
        <span className="font-medium text-sm flex-1">Watch Party</span>
        {!isMarc && pendingSync && (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-primary/40 text-primary" onClick={handleSyncNow}>
            <RefreshCw className="w-3 h-3" />
            Sincronizar
          </Button>
        )}
        {isMarc && videoUrl && (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handleMarcSync}>
            <RefreshCw className="w-3 h-3" />
            Sync
          </Button>
        )}
      </header>

      {/* Video Player — 42% height */}
      <div className="flex-none bg-black" style={{ height: "42vh" }}>
        {!videoUrl ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-4 px-6">
            {isMarc ? (
              <>
                <p className="text-sm text-white/60 text-center">
                  Pega un enlace de YouTube, Vimeo o video directo
                </p>
                <div className="flex gap-2 w-full max-w-sm">
                  <Input
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    placeholder="YouTube, Vimeo o .mp4..."
                    className="h-9 text-sm bg-white/10 border-white/20 text-white placeholder:text-white/30 flex-1"
                    onKeyDown={(e) => e.key === "Enter" && handleLoadVideo()}
                  />
                  <Button size="sm" onClick={handleLoadVideo} disabled={!inputUrl.trim()}>
                    Cargar
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-white/40">Marc aún no ha elegido un video</p>
            )}
          </div>
        ) : ytId ? (
          <iframe
            key={ytId}
            ref={ytIframeRef}
            className="w-full h-full border-0"
            src={`https://www.youtube-nocookie.com/embed/${ytId}?enablejsapi=1&rel=0&modestbranding=1&playsinline=1`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            onLoad={() => {
              ytIframeRef.current?.contentWindow?.postMessage(
                JSON.stringify({ event: "listening" }),
                "*"
              );
            }}
          />
        ) : vimeoEmbedUrl ? (
          <iframe
            key={vimeoEmbedUrl}
            className="w-full h-full border-0"
            src={vimeoEmbedUrl}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
          />
        ) : isDirect ? (
          <video
            ref={videoRef}
            key={videoUrl}
            className="w-full h-full object-contain"
            src={videoUrl}
            controls={isMarc}
            playsInline
            onPlay={isMarc ? () => postWatchState(videoUrl, true, videoRef.current?.currentTime ?? 0) : undefined}
            onPause={isMarc ? () => postWatchState(videoUrl, false, videoRef.current?.currentTime ?? 0) : undefined}
            onSeeked={isMarc ? () => postWatchState(videoUrl, !videoRef.current?.paused, videoRef.current?.currentTime ?? 0) : undefined}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 px-6">
            <p className="text-sm text-white/40 text-center">
              Enlace no reconocido. Usa YouTube, Vimeo o un link directo a .mp4
            </p>
            {isMarc && (
              <div className="flex gap-2 w-full max-w-sm">
                <Input
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  placeholder="Cambiar enlace..."
                  className="h-9 text-sm bg-white/10 border-white/20 text-white placeholder:text-white/30 flex-1"
                  onKeyDown={(e) => e.key === "Enter" && handleLoadVideo()}
                />
                <Button size="sm" onClick={handleLoadVideo}>Cargar</Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Marc: change video bar */}
      {isMarc && videoUrl && (
        <div className="flex-none px-3 py-2 bg-muted/20 border-b border-border/30 flex gap-2">
          <Input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="YouTube, Vimeo o .mp4..."
            className="h-8 text-xs flex-1"
            onKeyDown={(e) => e.key === "Enter" && handleLoadVideo()}
          />
          <Button
            size="sm"
            className="h-8 text-xs shrink-0"
            onClick={handleLoadVideo}
            disabled={!inputUrl.trim() || inputUrl.trim() === videoUrl}
          >
            Cambiar
          </Button>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-20">
            <p className="text-xs text-muted-foreground/50">Hablen mientras ven el video</p>
          </div>
        )}
        {messages.map((msg) => {
          const isMine = msg.senderId === user.id;
          return (
            <div key={msg.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[78%] px-3 py-2 text-sm rounded-2xl shadow-sm ${
                  isMine
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-card text-card-foreground border border-border/50 rounded-bl-sm"
                }`}
              >
                <div className="relative">
                  <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                  {isMine ? (
                    <>
                      <span className="inline-block align-bottom w-12 h-3" />
                      <div className="absolute bottom-0 right-0 text-[10px] opacity-70">
                        {format(new Date(msg.createdAt), "HH:mm")}
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="inline-block align-bottom w-9 h-3" />
                      <div className="absolute bottom-0 right-0 text-[10px] opacity-40">
                        {format(new Date(msg.createdAt), "HH:mm")}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <footer className="flex-none p-2 bg-background/80 backdrop-blur-xl border-t border-border/50">
        <div className="flex items-center gap-2 bg-card border border-border/60 rounded-3xl px-4 py-1 shadow-sm">
          <input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe mientras ves..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 py-2"
          />
          <Button
            size="icon"
            className="h-8 w-8 rounded-full bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground shrink-0"
            onClick={handleSend}
            disabled={!newMessage.trim() || sendMessageMutation.isPending}
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </div>
      </footer>
    </div>
  );
}

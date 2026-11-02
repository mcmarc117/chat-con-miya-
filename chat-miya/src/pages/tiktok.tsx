import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useGetMe, useSendMessage } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, ExternalLink, Link2, Music2, Send } from "lucide-react";
import { SiTiktok } from "react-icons/si";

interface TikTokVideo {
  id: string;
  url: string;
  title: string | null;
  thumbnailUrl: string | null;
  authorName: string | null;
  addedAt: number;
}

const HISTORY_KEY = "miya-tiktok-history";
const MAX_HISTORY = 12;

const ID_PATTERNS = [
  /\/video\/(\d{6,25})/,
  /\/photo\/(\d{6,25})/,
  /\/v\/(\d{6,25})(?:\.html)?/,
  /[?&]item_id=(\d{6,25})/,
];

function extractTikTokId(url: string): string | null {
  for (const p of ID_PATTERNS) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function loadHistory(): TikTokVideo[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export default function TikTokPlayer() {
  const [, setLocation] = useLocation();
  const [inputUrl, setInputUrl] = useState("");
  const [video, setVideo] = useState<TikTokVideo | null>(null);
  const [history, setHistory] = useState<TikTokVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  const { data: user, isError: authError } = useGetMe({
    query: { retry: false, queryKey: ["/api/auth/me"] },
  });
  useEffect(() => {
    if (authError) setLocation("/login");
  }, [authError, setLocation]);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const sendMessageMutation = useSendMessage();

  async function handleLoad() {
    const url = inputUrl.trim();
    if (!url || loading) return;
    setLoading(true);
    setError(null);
    setShared(false);

    let resolved: TikTokVideo | null = null;
    try {
      const res = await fetch(`/api/tiktok/resolve?url=${encodeURIComponent(url)}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        resolved = {
          id: data.id,
          url: data.url ?? data.embedUrl,
          title: data.title ?? null,
          thumbnailUrl: data.thumbnailUrl ?? null,
          authorName: data.authorName ?? null,
          addedAt: Date.now(),
        };
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "No se pudo cargar el video de TikTok");
      }
    } catch {
      // sin conexión con el backend: intentamos resolver localmente
    }

    if (!resolved) {
      const id = extractTikTokId(url);
      if (id) {
        resolved = {
          id,
          url,
          title: null,
          thumbnailUrl: null,
          authorName: null,
          addedAt: Date.now(),
        };
        setError(null);
      } else if (!error) {
        setError(
          "No se pudo resolver el enlace. Pega el enlace completo del video (el que contiene /video/...)",
        );
      }
    }

    if (resolved) {
      setVideo(resolved);
      setHistory((prev) => {
        const next = [resolved!, ...prev.filter((v) => v.id !== resolved!.id)].slice(
          0,
          MAX_HISTORY,
        );
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
      setInputUrl("");
    }
    setLoading(false);
  }

  function handleShare() {
    if (!video || shared) return;
    sendMessageMutation.mutate({
      data: { content: video.url },
    });
    setShared(true);
    setTimeout(() => setShared(false), 2500);
  }

  if (!user) return null;

  return (
    <div className="flex flex-col h-[100dvh] bg-background overflow-hidden">
      {/* Header */}
      <header className="flex-none h-12 border-b border-border/40 bg-card/50 backdrop-blur-md flex items-center gap-2 px-3 z-10">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setLocation("/")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <SiTiktok className="w-4 h-4 text-primary shrink-0" />
        <span className="font-medium text-sm flex-1">TikTok Player</span>
        {video && (
          <a
            href={video.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Abrir en TikTok
          </a>
        )}
      </header>

      {/* Player */}
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center gap-3 p-4 min-h-0">
        {!video ? (
          <div className="flex flex-col items-center justify-center gap-3 text-center max-w-sm">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Music2 className="w-7 h-7 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">
              Pega el enlace de un video de TikTok para verlo aquí, aparte del Watch Party.
            </p>
            <p className="text-xs text-muted-foreground/60">
              Funciona con enlaces largos (@usuario/video/...) y cortos (vm.tiktok.com).
            </p>
          </div>
        ) : (
          <div className="w-full max-w-[360px] bg-black rounded-2xl overflow-hidden shadow-lg border border-border/40">
            <iframe
              key={video.id}
              className="w-full aspect-[9/16] max-h-[62vh] border-0"
              src={`https://www.tiktok.com/embed/v2/${video.id}`}
              allow="encrypted-media; picture-in-picture; fullscreen; clipboard-write; autoplay"
              allowFullScreen
              title={video.title ?? "Video de TikTok"}
            />
          </div>
        )}

        {video?.title && (
          <p className="text-xs text-muted-foreground text-center max-w-sm line-clamp-2 px-4">
            {video.authorName ? `@${video.authorName} · ` : ""}
            {video.title}
          </p>
        )}
        {video && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={handleShare}
              disabled={shared || sendMessageMutation.isPending}
            >
              <Send className="w-3 h-3" />
              {shared ? "Enviado al chat ✓" : "Enviar link al chat"}
            </Button>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground/50 text-center max-w-sm px-4">
          Cada persona controla su propia reproducción: TikTok no permite control remoto como YouTube.
        </p>

        {/* Historial */}
        {history.length > 0 && (
          <div className="w-full max-w-md">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/40 font-medium mb-2 text-center">
              Vistos recientemente
            </p>
            <div className="flex gap-2 overflow-x-auto pb-2 px-1 justify-start sm:justify-center">
              {history.map((v) => (
                <button
                  key={v.id}
                  onClick={() => {
                    setVideo(v);
                    setShared(false);
                    setError(null);
                  }}
                  className={`shrink-0 w-16 h-20 rounded-lg overflow-hidden border transition-all relative ${
                    video?.id === v.id
                      ? "border-primary ring-1 ring-primary/40"
                      : "border-border/40 opacity-70 hover:opacity-100"
                  }`}
                  title={v.title ?? v.url}
                >
                  {v.thumbnailUrl ? (
                    <img src={v.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center">
                      <Link2 className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="text-xs text-destructive text-center max-w-sm px-4">{error}</p>
        )}
      </div>

      {/* Input */}
      <footer className="flex-none p-2 bg-background/80 backdrop-blur-xl border-t border-border/50">
        <div className="flex gap-2">
          <Input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLoad()}
            placeholder="https://www.tiktok.com/@usuario/video/..."
            className="h-9 text-sm flex-1"
          />
          <Button size="sm" className="h-9 px-4 shrink-0" onClick={handleLoad} disabled={!inputUrl.trim() || loading}>
            {loading ? "Cargando..." : "Reproducir"}
          </Button>
        </div>
      </footer>
    </div>
  );
}

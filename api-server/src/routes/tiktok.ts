import { Router } from "express";
import { requireAuth } from "../lib/session";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const ID_PATTERNS: RegExp[] = [
  /\/video\/(\d{6,25})/,
  /\/photo\/(\d{6,25})/,
  /\/v\/(\d{6,25})(?:\.html)?/,
  /[?&]item_id=(\d{6,25})/,
];

export function extractTikTokId(url: string): string | null {
  for (const p of ID_PATTERNS) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function isTikTokUrl(url: string): boolean {
  return /^https?:\/\/([a-z0-9-]+\.)*tiktok\.com\//i.test(url);
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": BROWSER_UA,
        "accept-language": "es-ES,es;q=0.9,en;q=0.8",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/tiktok/resolve?url=<tiktok-url>
 *
 * Devuelve el id del video y los datos para el reproductor embebido.
 * Soporta enlaces largos (@usuario/video/123), links cortos
 * (vm.tiktok.com, tiktok.com/t/...) y links móviles (m.tiktok.com/v/...).
 */
router.get("/resolve", async (req, res) => {
  const rawUrl = typeof req.query.url === "string" ? req.query.url.trim() : "";
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
    res.status(400).json({ error: "Falta la URL del video de TikTok" });
    return;
  }
  if (!isTikTokUrl(rawUrl)) {
    res.status(400).json({ error: "No es un enlace de TikTok válido" });
    return;
  }

  try {
    let videoId = extractTikTokId(rawUrl);
    let canonicalUrl = rawUrl;

    // Links cortos (vm.tiktok.com / tiktok.com/t/...): seguimos la redirección
    // en el servidor y leemos la URL final, que contiene /video/<id>.
    if (!videoId) {
      const finalRes = await fetchWithTimeout(rawUrl, 10_000);
      const finalUrl = decodeURIComponent(finalRes.url || "");
      videoId = extractTikTokId(finalUrl);
      if (videoId) canonicalUrl = finalUrl;

      if (!videoId && finalRes.status < 400) {
        // Último recurso: buscar el id dentro del HTML devuelto
        try {
          const text = await finalRes.text();
          const m =
            text.match(/\/video\/(\d{6,25})/) ||
            text.match(/"itemId"\s*:\s*"?(\d{6,25})"?/) ||
            text.match(/item_id=(\d{6,25})/);
          if (m) {
            videoId = m[1];
            canonicalUrl = finalUrl || rawUrl;
          }
        } catch {
          // ignore
        }
      }
    }

    if (!videoId) {
      res.status(422).json({
        error:
          "No se pudo resolver el enlace. Abre el video en TikTok, toca 'Compartir' y pega el enlace completo (el que contiene /video/...)",
      });
      return;
    }

    // Metadatos opcionales (título, miniatura, autor) vía oEmbed público.
    // Nunca falla la petición por esto.
    let title: string | null = null;
    let thumbnailUrl: string | null = null;
    let authorName: string | null = null;
    try {
      const oe = await fetchWithTimeout(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(canonicalUrl.split("?")[0])}`,
        6_000,
      );
      if (oe.ok) {
        const data = (await oe.json()) as Record<string, unknown>;
        if (typeof data.title === "string") title = data.title;
        if (typeof data.thumbnail_url === "string") thumbnailUrl = data.thumbnail_url;
        if (typeof data.author_name === "string") authorName = data.author_name;
      }
    } catch (err) {
      logger.debug({ err }, "oEmbed de TikTok no disponible");
    }

    res.json({
      id: videoId,
      embedUrl: `https://www.tiktok.com/embed/v2/${videoId}`,
      url: canonicalUrl.split("?")[0],
      title,
      thumbnailUrl,
      authorName,
    });
  } catch (err) {
    logger.error({ err }, "Error resolviendo enlace de TikTok");
    res
      .status(502)
      .json({ error: "TikTok no respondió. Intenta de nuevo en unos segundos." });
  }
});

export default router;

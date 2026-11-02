import { Router } from "express";
import { requireAuth } from "../lib/session";
import { broadcastMessage } from "../lib/sse";
import { db, watchStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

interface VideoState {
  url: string;
  playing: boolean;
  currentTime: number;
  updatedAt: number;
}

let videoState: VideoState = { url: "", playing: false, currentTime: 0, updatedAt: 0 };
let loadedFromDb = false;

// El estado vive en memoria (rápido) pero se respalda en Supabase para que
// sobreviva a reinicios y redeploys del servicio en Render.
async function loadStateFromDb(): Promise<void> {
  if (loadedFromDb) return;
  loadedFromDb = true;
  if (videoState.url) return; // ya hay estado vivo en esta instancia
  try {
    const [row] = await db
      .select()
      .from(watchStateTable)
      .where(eq(watchStateTable.id, 1))
      .limit(1);
    if (row && row.url) {
      videoState = {
        url: row.url,
        playing: row.playing,
        currentTime: row.currentTime,
        updatedAt: Number(row.updatedAt),
      };
      logger.info({ url: row.url }, "Watch state restaurado desde la BD");
    }
  } catch (err) {
    logger.error({ err }, "No se pudo leer watch_state de la BD");
  }
}

async function persistState(state: VideoState): Promise<void> {
  try {
    await db
      .insert(watchStateTable)
      .values({
        id: 1,
        url: state.url,
        playing: state.playing,
        currentTime: state.currentTime,
        updatedAt: state.updatedAt,
      })
      .onConflictDoUpdate({
        target: watchStateTable.id,
        set: {
          url: state.url,
          playing: state.playing,
          currentTime: state.currentTime,
          updatedAt: state.updatedAt,
        },
      });
  } catch (err) {
    logger.error({ err }, "No se pudo guardar watch_state en la BD");
  }
}

router.get("/state", async (_req, res) => {
  await loadStateFromDb();
  res.json(videoState);
});

router.post("/state", async (req, res) => {
  if (req.user!.username !== "marc") {
    res.status(403).json({ error: "Solo Marc puede controlar el video" });
    return;
  }
  const { url, playing, currentTime } = req.body;
  if (typeof url !== "string" || typeof playing !== "boolean" || typeof currentTime !== "number") {
    res.status(400).json({ error: "Estado inválido" });
    return;
  }
  videoState = { url, playing, currentTime, updatedAt: Date.now() };
  broadcastMessage("watch-state", videoState);
  void persistState(videoState);
  res.json(videoState);
});

export default router;

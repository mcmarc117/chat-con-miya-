import { Router } from "express";
import { requireAuth } from "../lib/session";
import { broadcastMessage } from "../lib/sse";

const router = Router();
router.use(requireAuth);

interface VideoState {
  url: string;
  playing: boolean;
  currentTime: number;
  updatedAt: number;
}

let videoState: VideoState = { url: "", playing: false, currentTime: 0, updatedAt: 0 };

router.get("/state", (_req, res) => {
  res.json(videoState);
});

router.post("/state", (req, res) => {
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
  res.json(videoState);
});

export default router;

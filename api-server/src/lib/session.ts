import { randomBytes } from "crypto";
import { type Request, type Response, type NextFunction } from "express";

interface SessionData {
  userId: number;
  username: string;
  displayName: string;
}

const sessions = new Map<string, SessionData>();

const COOKIE_NAME = "chat_session";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

export function createSession(res: Response, data: SessionData): void {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, data);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
}

export function destroySession(req: Request, res: Response): void {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) sessions.delete(token);
  res.clearCookie(COOKIE_NAME);
}

export function getSession(req: Request): SessionData | null {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  return sessions.get(token) ?? null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  (req as Request & { user: SessionData }).user = session;
  next();
}

declare global {
  namespace Express {
    interface Request {
      user?: SessionData;
    }
  }
}

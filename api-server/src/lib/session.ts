import { type Request, type Response, type NextFunction } from "express";

interface SessionData {
  userId: number;
  username: string;
  displayName: string;
}

const COOKIE_NAME = "chat_session";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

export function createSession(res: Response, data: SessionData): void {
  res.cookie(COOKIE_NAME, JSON.stringify(data), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
    signed: true,
  });
}

export function destroySession(_req: Request, res: Response): void {
  res.clearCookie(COOKIE_NAME);
}

export function getSession(req: Request): SessionData | null {
  const raw = req.signedCookies?.[COOKIE_NAME];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.user = session;
  next();
}

declare global {
  namespace Express {
    interface Request {
      user?: SessionData;
    }
  }
}

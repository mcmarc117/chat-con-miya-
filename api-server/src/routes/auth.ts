import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { LoginBody } from "@workspace/api-zod";
import { verifyPassword } from "../lib/crypto";
import { createSession, destroySession, getSession, requireAuth } from "../lib/session";

const router = Router();

router.post("/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const { username, password } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username))
    .limit(1);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Usuario o contraseña incorrectos" });
    return;
  }

  createSession(res, {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
  });

  res.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
  });
});

router.post("/logout", (req, res) => {
  destroySession(req, res);
  res.json({ success: true });
});

router.get("/me", requireAuth, (req, res) => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({
    id: session.userId,
    username: session.username,
    displayName: session.displayName,
  });
});

export default router;

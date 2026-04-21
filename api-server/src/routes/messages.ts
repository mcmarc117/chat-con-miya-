import { Router } from "express";
import { db, messagesTable, usersTable } from "@workspace/db";
import { eq, desc, isNull, lt, and, ne, inArray } from "drizzle-orm";
import { SendMessageBody, GetMessagesQueryParams, DeleteMessageParams } from "@workspace/api-zod";
import { requireAuth } from "../lib/session";
import { broadcastMessage, addSSEClient, removeSSEClient } from "../lib/sse";

const router = Router();

router.use(requireAuth);

async function translateToJapanese(text: string): Promise<string> {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=es&tl=ja&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    const data = await response.json() as unknown[][];
    const translated = (data[0] as unknown[][])?.map((item) => (item as unknown[])[0]).join("") ?? text;
    return typeof translated === "string" && translated.trim() ? translated : text;
  } catch {
    return text;
  }
}

// SSE endpoint for real-time messages
router.get("/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write("event: connected\ndata: {}\n\n");

  const client = addSSEClient(req.user!.userId, res);

  const heartbeat = setInterval(() => {
    try {
      res.write("event: ping\ndata: {}\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 30_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeSSEClient(client);
  });
});

// GET /messages
router.get("/", async (req, res) => {
  const parsed = GetMessagesQueryParams.safeParse(req.query);
  const limit = parsed.success ? (parsed.data.limit ?? 50) : 50;
  const before = parsed.success ? parsed.data.before : undefined;

  const conditions = [isNull(messagesTable.deletedAt)];
  if (before) {
    conditions.push(lt(messagesTable.id, before));
  }

  const rows = await db
    .select({
      id: messagesTable.id,
      senderId: messagesTable.senderId,
      senderName: usersTable.displayName,
      content: messagesTable.content,
      createdAt: messagesTable.createdAt,
      isRead: messagesTable.isRead,
      replyToId: messagesTable.replyToId,
    })
    .from(messagesTable)
    .innerJoin(usersTable, eq(messagesTable.senderId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(messagesTable.createdAt))
    .limit(limit);

  // Fetch reply content in a separate query (avoids self-join / alias issues)
  const replyIds = [...new Set(rows.filter((r) => r.replyToId).map((r) => r.replyToId as number))];
  const replyMap = new Map<number, { content: string; senderName: string }>();

  if (replyIds.length > 0) {
    const replyRows = await db
      .select({
        id: messagesTable.id,
        content: messagesTable.content,
        senderName: usersTable.displayName,
      })
      .from(messagesTable)
      .innerJoin(usersTable, eq(messagesTable.senderId, usersTable.id))
      .where(inArray(messagesTable.id, replyIds));

    for (const r of replyRows) {
      replyMap.set(r.id, { content: r.content, senderName: r.senderName });
    }
  }

  const messages = rows.reverse().map((m) => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
    replyToContent: m.replyToId ? (replyMap.get(m.replyToId)?.content ?? null) : null,
    replyToSenderName: m.replyToId ? (replyMap.get(m.replyToId)?.senderName ?? null) : null,
  }));

  res.json({ messages, total: messages.length });
});

// POST /messages
router.post("/", async (req, res) => {
  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const { content, replyToId } = parsed.data;
  if (!content.trim()) {
    res.status(400).json({ error: "Message cannot be empty" });
    return;
  }

  // If Marc sends the message, translate from Spanish to Japanese for Miya
  const isMarc = req.user!.username === "marc";
  const finalContent = isMarc
    ? await translateToJapanese(content.trim())
    : content.trim();

  const [newMsg] = await db
    .insert(messagesTable)
    .values({
      senderId: req.user!.userId,
      content: finalContent,
      replyToId: replyToId ?? null,
    })
    .returning();

  // Fetch reply context
  let replyToContent: string | null = null;
  let replyToSenderName: string | null = null;
  if (newMsg.replyToId) {
    const replyRows = await db
      .select({ content: messagesTable.content, displayName: usersTable.displayName })
      .from(messagesTable)
      .innerJoin(usersTable, eq(messagesTable.senderId, usersTable.id))
      .where(eq(messagesTable.id, newMsg.replyToId))
      .limit(1);
    if (replyRows[0]) {
      replyToContent = replyRows[0].content;
      replyToSenderName = replyRows[0].displayName;
    }
  }

  const message = {
    id: newMsg.id,
    senderId: newMsg.senderId,
    senderName: req.user!.displayName,
    content: newMsg.content,
    createdAt: newMsg.createdAt.toISOString(),
    isRead: newMsg.isRead,
    replyToId: newMsg.replyToId ?? null,
    replyToContent,
    replyToSenderName,
  };

  broadcastMessage("message", message);
  res.status(201).json(message);
});

// POST /messages/read
router.post("/read", async (req, res) => {
  await db
    .update(messagesTable)
    .set({ isRead: true })
    .where(
      and(
        ne(messagesTable.senderId, req.user!.userId),
        eq(messagesTable.isRead, false),
        isNull(messagesTable.deletedAt),
      ),
    );

  broadcastMessage("read", { userId: req.user!.userId });
  res.json({ success: true });
});

// GET /messages/unread-count
router.get("/unread-count", async (req, res) => {
  const rows = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(
      and(
        ne(messagesTable.senderId, req.user!.userId),
        eq(messagesTable.isRead, false),
        isNull(messagesTable.deletedAt),
      ),
    );

  res.json({ count: rows.length });
});

// DELETE /messages/:id
router.delete("/:id", async (req, res) => {
  const parsed = DeleteMessageParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [msg] = await db
    .select({ senderId: messagesTable.senderId })
    .from(messagesTable)
    .where(eq(messagesTable.id, parsed.data.id));

  if (!msg) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  if (msg.senderId !== req.user!.userId) {
    res.status(403).json({ error: "Cannot delete another user's message" });
    return;
  }

  await db
    .update(messagesTable)
    .set({ deletedAt: new Date() })
    .where(eq(messagesTable.id, parsed.data.id));

  broadcastMessage("delete", { id: parsed.data.id });
  res.json({ success: true });
});

export default router;

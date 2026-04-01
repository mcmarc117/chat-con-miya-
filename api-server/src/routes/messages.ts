import { Router } from "express";
import { db, messagesTable, usersTable } from "@workspace/db";
import { eq, desc, isNull, lt, and, ne } from "drizzle-orm";
import { SendMessageBody, GetMessagesQueryParams, DeleteMessageParams } from "@workspace/api-zod";
import { requireAuth } from "../lib/session";
import { broadcastMessage, addSSEClient, removeSSEClient } from "../lib/sse";

const router = Router();

router.use(requireAuth);

// SSE endpoint for real-time messages
router.get("/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send a heartbeat immediately
  res.write("event: connected\ndata: {}\n\n");

  const client = addSSEClient(req.user!.userId, res);

  // Heartbeat every 30s to keep connection alive
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
    })
    .from(messagesTable)
    .innerJoin(usersTable, eq(messagesTable.senderId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(messagesTable.createdAt))
    .limit(limit);

  const messages = rows.reverse().map((m) => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
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

  const { content } = parsed.data;
  if (!content.trim()) {
    res.status(400).json({ error: "Message cannot be empty" });
    return;
  }

  const [newMsg] = await db
    .insert(messagesTable)
    .values({
      senderId: req.user!.userId,
      content: content.trim(),
    })
    .returning();

  const message = {
    id: newMsg.id,
    senderId: newMsg.senderId,
    senderName: req.user!.displayName,
    content: newMsg.content,
    createdAt: newMsg.createdAt.toISOString(),
    isRead: newMsg.isRead,
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
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.id, parsed.data.id))
    .limit(1);

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

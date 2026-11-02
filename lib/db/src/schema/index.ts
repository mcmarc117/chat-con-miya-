import { pgTable, serial, text, integer, boolean, timestamp, doublePrecision, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id")
    .notNull()
    .references(() => usersTable.id),
  content: text("content").notNull(),
  replyToId: integer("reply_to_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  isRead: boolean("is_read").notNull().default(false),
  deletedAt: timestamp("deleted_at"),
});

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ id: true, createdAt: true, isRead: true, deletedAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;

// Estado del Watch Party: una sola fila (id = 1) para que el video elegido
// sobreviva a reinicios y redeploys del servidor en Render.
export const watchStateTable = pgTable("watch_state", {
  id: integer("id").primaryKey(),
  url: text("url").notNull().default(""),
  playing: boolean("playing").notNull().default(false),
  currentTime: doublePrecision("current_time").notNull().default(0),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(0),
});

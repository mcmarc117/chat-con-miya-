import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { scryptSync, randomBytes } from "crypto";
import { logger } from "./logger";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const USERS = [
  { username: "marc", displayName: "Marc", password: "Francisco" },
  { username: "miya", displayName: "Miya", password: "Francisco" },
];

export async function seedUsers(): Promise<void> {
  // Migrate old "yo" username to "marc" if it still exists
  const oldYo = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, "yo"))
    .limit(1);

  if (oldYo.length > 0) {
    await db
      .update(usersTable)
      .set({ username: "marc", displayName: "Marc" })
      .where(eq(usersTable.username, "yo"));
    logger.info("Migrated user 'yo' -> 'marc'");
  }

  for (const u of USERS) {
    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, u.username))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(usersTable).values({
        username: u.username,
        displayName: u.displayName,
        passwordHash: hashPassword(u.password),
      });
      logger.info({ username: u.username }, "User seeded");
    }
  }
}

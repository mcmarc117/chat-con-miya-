import app from "./app";
import { logger } from "./lib/logger";
import { seedUsers } from "./lib/seed";

// Catch any unhandled errors and print them before exiting
process.on("uncaughtException", (err) => {
  console.error("FATAL uncaughtException:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("FATAL unhandledRejection:", reason);
  process.exit(1);
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  console.error("PORT environment variable is required but was not provided.");
  process.exit(1);
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  console.error(`Invalid PORT value: "${rawPort}"`);
  process.exit(1);
}

app.listen(port, () => {
  logger.info({ port }, "Server listening");
  seedUsers().catch((err) => {
    logger.error({ err }, "Error seeding users");
  });
});

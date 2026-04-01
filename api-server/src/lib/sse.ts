import { type Response } from "express";

type SSEClient = {
  userId: number;
  res: Response;
};

const clients: Set<SSEClient> = new Set();

export function addSSEClient(userId: number, res: Response): SSEClient {
  const client: SSEClient = { userId, res };
  clients.add(client);
  return client;
}

export function removeSSEClient(client: SSEClient): void {
  clients.delete(client);
}

export function broadcastMessage(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

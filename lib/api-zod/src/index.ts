// ./generated/api y ./generated/types exportan varios nombres duplicados
// (LoginBody, SendMessageBody), lo que rompía `tsc --build` con TS2308.
// Exportamos los schemas zod (fuente de verdad que consume el api-server) y,
// de los tipos generados, solo los que no colisionan.
export * from "./generated/api";
export type {
  GetMessagesParams,
  HealthStatus,
  Message,
  MessageList,
  SuccessResponse,
  UnreadCount,
  User,
} from "./generated/types";

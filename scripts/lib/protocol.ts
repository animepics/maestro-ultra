import { z } from "zod";

// Boundary schemas for the Codex app-server WebSocket JSON-RPC protocol.
// Field shapes verified against openai/codex @ ccdfb4f342
// (codex-rs/app-server-protocol/src/protocol/v2/) and live probes on 2026-07-02.
// `.loose()` keeps unknown fields: the protocol grows without notice.

export const THREAD_SORT_KEYS = ["created_at", "updated_at", "recency_at"] as const;
export type ThreadSortKey = (typeof THREAD_SORT_KEYS)[number];

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const ThreadStatusSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("notLoaded") }),
  z.object({ type: z.literal("idle") }),
  z.object({ type: z.literal("systemError") }),
  z.object({ type: z.literal("active"), activeFlags: z.array(z.string()).default([]) }),
]);
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;

export const TurnStatusSchema = z.enum(["completed", "interrupted", "failed", "inProgress"]);
export type TurnStatus = z.infer<typeof TurnStatusSchema>;

const TurnErrorSchema = z
  .object({
    message: z.string(),
    codexErrorInfo: z.unknown().optional(),
    additionalDetails: z.string().nullish(),
  })
  .loose();

export const TurnSchema = z
  .object({
    id: z.string(),
    status: TurnStatusSchema,
    items: z.array(z.record(z.string(), z.unknown())).default([]),
    error: TurnErrorSchema.nullish(),
  })
  .loose();
export type Turn = z.infer<typeof TurnSchema>;

const GitInfoSchema = z
  .object({
    branch: z.string().nullish(),
    sha: z.string().nullish(),
    originUrl: z.string().nullish(),
  })
  .loose();

export const ThreadSchema = z
  .object({
    id: z.string(),
    preview: z.string().default(""),
    name: z.string().nullish(),
    status: ThreadStatusSchema,
    cwd: z.string(),
    source: z.string().nullish(),
    modelProvider: z.string().nullish(),
    createdAt: z.number(),
    updatedAt: z.number(),
    recencyAt: z.number().nullish(),
    gitInfo: GitInfoSchema.nullish(),
    turns: z.array(TurnSchema).default([]),
  })
  .loose();
export type Thread = z.infer<typeof ThreadSchema>;

export const ThreadListResponseSchema = z.object({
  data: z.array(ThreadSchema),
  nextCursor: z.string().nullish(),
  backwardsCursor: z.string().nullish(),
});

export const ThreadLoadedListResponseSchema = z.object({
  data: z.array(z.string()),
  nextCursor: z.string().nullish(),
});

export const ThreadSearchResponseSchema = z.object({
  data: z.array(z.object({ thread: ThreadSchema, snippet: z.string() })),
  nextCursor: z.string().nullish(),
});

export const ThreadReadResponseSchema = z.object({ thread: ThreadSchema });
export const TurnStartResponseSchema = z.object({ turn: TurnSchema });

export const TurnCompletedParamsSchema = z.object({
  threadId: z.string(),
  turn: TurnSchema,
});

export const AgentMessageDeltaParamsSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  itemId: z.string(),
  delta: z.string(),
});

export const ErrorNotificationParamsSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string().nullish(),
    willRetry: z.boolean().default(false),
    error: TurnErrorSchema,
  })
  .loose();

// item/started and item/completed share this shape: the lifecycle of one turn
// item (agentMessage, commandExecution, fileChange, …). Used by the `events`
// tail to surface item progression.
export const ItemNotificationParamsSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string().nullish(),
    item: z.object({ type: z.string() }).loose(),
  })
  .loose();

export const RemoteControlStatusSchema = z
  .object({
    status: z.string(),
    serverName: z.string().nullish(),
    environmentId: z.string().nullish(),
    installationId: z.string().nullish(),
  })
  .loose();

export const RemoteControlClientSchema = z
  .object({
    clientId: z.string(),
    displayName: z.string().nullish(),
    deviceType: z.string().nullish(),
    platform: z.string().nullish(),
    osVersion: z.string().nullish(),
    deviceModel: z.string().nullish(),
    appVersion: z.string().nullish(),
    lastSeenAt: z.number().nullish(),
  })
  .loose();
export type RemoteControlClient = z.infer<typeof RemoteControlClientSchema>;

export const RemoteControlClientsListResponseSchema = z.object({
  data: z.array(RemoteControlClientSchema),
  nextCursor: z.string().nullish(),
});

const JsonRpcErrorSchema = z.object({ code: z.number().optional(), message: z.string() }).loose();

export const JsonRpcMessageSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  error: JsonRpcErrorSchema.optional(),
});
export type JsonRpcMessage = z.infer<typeof JsonRpcMessageSchema>;

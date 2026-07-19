import {
  AgentMessageDeltaParamsSchema,
  ErrorNotificationParamsSchema,
  type JsonRpcMessage,
  TurnCompletedParamsSchema,
  type TurnStatus,
} from "./protocol.ts";

export type TurnEvent =
  | { readonly kind: "delta"; readonly text: string }
  | { readonly kind: "completed"; readonly status: TurnStatus; readonly errorMessage?: string }
  | {
      readonly kind: "serverRequest";
      readonly requestId: number | string;
      readonly method: string;
    }
  | { readonly kind: "turnError"; readonly message: string; readonly willRetry: boolean }
  | { readonly kind: "ignored" };

const IGNORED: TurnEvent = { kind: "ignored" };

// Classifies one incoming frame while waiting for a turn on `targetThreadId`.
// Frames for other threads are ignored: a shared app-server broadcasts
// notifications for every subscribed thread on the same socket.
export function classifyServerMessage(targetThreadId: string, message: JsonRpcMessage): TurnEvent {
  if (message.id !== undefined && message.method !== undefined) {
    // Server -> client JSON-RPC request (approval, user input). It blocks the
    // remote turn until answered, so it must surface regardless of thread.
    return { kind: "serverRequest", requestId: message.id, method: message.method };
  }
  switch (message.method) {
    case "item/agentMessage/delta": {
      const params = AgentMessageDeltaParamsSchema.safeParse(message.params);
      if (!params.success || params.data.threadId !== targetThreadId) return IGNORED;
      return { kind: "delta", text: params.data.delta };
    }
    case "turn/completed": {
      const params = TurnCompletedParamsSchema.safeParse(message.params);
      if (!params.success || params.data.threadId !== targetThreadId) return IGNORED;
      const errorMessage = params.data.turn.error?.message;
      return {
        kind: "completed",
        status: params.data.turn.status,
        ...(errorMessage !== undefined ? { errorMessage } : {}),
      };
    }
    case "error": {
      const params = ErrorNotificationParamsSchema.safeParse(message.params);
      if (!params.success || params.data.threadId !== targetThreadId) return IGNORED;
      return {
        kind: "turnError",
        message: params.data.error.message,
        willRetry: params.data.willRetry,
      };
    }
    default:
      return IGNORED;
  }
}

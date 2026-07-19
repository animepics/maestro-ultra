import type { Command } from "./cli-args.ts";
import { type CodexClient, CodexRpcError } from "./client.ts";
import { turnAgentText } from "./format.ts";
import {
  type Thread,
  ThreadReadResponseSchema,
  TurnStartResponseSchema,
  type TurnStatus,
} from "./protocol.ts";
import { assertNever } from "./result.ts";
import { classifyServerMessage } from "./turn-monitor.ts";

type MsgCommand = Extract<Command, { kind: "msg" }>;
type SteerCommand = Extract<Command, { kind: "steer" }>;
type InterruptCommand = Extract<Command, { kind: "interrupt" }>;

type Completion = { readonly status: TurnStatus; readonly errorMessage?: string };

const APPROVAL_METHODS: ReadonlySet<string> = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
]);

const POLL_INTERVAL_MS = 2_000;

export async function readThread(client: CodexClient, threadId: string): Promise<Thread> {
  const raw = await client.request("thread/read", { threadId, includeTurns: true });
  return ThreadReadResponseSchema.parse(raw).thread;
}

// thread/resume subscribes this connection to the thread's notifications.
// A thread created moments ago with zero turns has no rollout on disk yet, so
// resume fails until its first turn is persisted; callers fall back to polling.
async function tryResume(client: CodexClient, threadId: string): Promise<boolean> {
  try {
    await client.request("thread/resume", { threadId });
    return true;
  } catch (error) {
    // Server wording varies by version: "no rollout found" (<=0.141) vs
    // "rollout at <path> is empty" (0.142+, file created but no turn yet).
    if (
      error instanceof CodexRpcError &&
      (error.detail.includes("no rollout found") || error.detail.includes("is empty"))
    )
      return false;
    throw error;
  }
}

function finalAgentText(thread: Thread, turnId: string): string {
  const turn = thread.turns.find((candidate) => candidate.id === turnId);
  return turn === undefined ? "" : turnAgentText(turn);
}

async function pollUntilDone(
  client: CodexClient,
  threadId: string,
  turnId: string,
  deadlineMs: number,
): Promise<Completion | undefined> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const thread = await readThread(client, threadId);
    const turn = thread.turns.find((candidate) => candidate.id === turnId);
    if (turn !== undefined && turn.status !== "inProgress") {
      const errorMessage = turn.error?.message;
      return { status: turn.status, ...(errorMessage !== undefined ? { errorMessage } : {}) };
    }
  }
  return undefined;
}

export async function runMsg(client: CodexClient, command: MsgCommand): Promise<number> {
  let subscribed = await tryResume(client, command.threadId);

  let agentText = "";
  let completion: Completion | undefined;
  let resolveCompletion = () => {};
  const completed = new Promise<"done">((resolve) => {
    resolveCompletion = () => resolve("done");
  });

  const unsubscribe = client.onMessage((message) => {
    const event = classifyServerMessage(command.threadId, message);
    switch (event.kind) {
      case "delta":
        agentText += event.text;
        break;
      case "completed":
        completion = event;
        resolveCompletion();
        break;
      case "serverRequest": {
        if (APPROVAL_METHODS.has(event.method)) {
          const decision = command.approve ? "accept" : "decline";
          client.respond(event.requestId, { decision });
          console.error(`[approval] ${event.method} -> ${decision}`);
        } else {
          client.respond(event.requestId, {});
          console.error(`[server-request] ${event.method} -> acknowledged with empty response`);
        }
        break;
      }
      case "turnError":
        console.error(
          `[turn-error] ${event.message}${event.willRetry ? " (server will retry)" : ""}`,
        );
        break;
      case "ignored":
        break;
      default:
        assertNever(event);
    }
  });

  try {
    const timeoutMs = command.timeoutSecs * 1000;
    const timedOut = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), timeoutMs);
    });

    const startRaw = await client.request(
      "turn/start",
      { threadId: command.threadId, input: [{ type: "text", text: command.text }] },
      timeoutMs,
    );
    const { turn } = TurnStartResponseSchema.parse(startRaw);

    if (!subscribed) {
      // The first turn materializes the rollout; resume now to start streaming.
      subscribed = await tryResume(client, command.threadId);
      if (!subscribed) console.error("[msg] no rollout yet; falling back to status polling");
    }

    console.log(`[USER] ${command.text}`);
    if (subscribed) {
      const outcome = await Promise.race([completed, timedOut]);
      if (outcome === "timeout") {
        console.log(`[AGENT partial] ${agentText.trim()}`);
        console.error(
          `timed out after ${command.timeoutSecs}s; the turn may still be running. ` +
            `Check with: read ${command.threadId} — stop with: interrupt ${command.threadId}`,
        );
        return 1;
      }
    } else {
      completion = await pollUntilDone(client, command.threadId, turn.id, timeoutMs);
      if (completion === undefined) {
        console.error(`timed out after ${command.timeoutSecs}s while polling turn ${turn.id}`);
        return 1;
      }
    }

    const finalText = finalAgentText(await readThread(client, command.threadId), turn.id);
    console.log(`[AGENT] ${finalText !== "" ? finalText : agentText.trim()}`);
    console.log(`turn ${turn.id} finished: ${completion?.status ?? "unknown"}`);
    if (completion?.errorMessage !== undefined) console.error(`error: ${completion.errorMessage}`);
    return completion?.status === "completed" ? 0 : 1;
  } finally {
    unsubscribe();
  }
}

export async function runSteer(client: CodexClient, command: SteerCommand): Promise<number> {
  await tryResume(client, command.threadId);
  const thread = await readThread(client, command.threadId);
  const active = thread.turns.findLast((turn) => turn.status === "inProgress");
  if (active === undefined) {
    console.error(`no turn in progress on ${command.threadId}; use msg to start one`);
    return 1;
  }
  await client.request("turn/steer", {
    threadId: command.threadId,
    expectedTurnId: active.id,
    input: [{ type: "text", text: command.text }],
  });
  console.log(`steered turn ${active.id} on ${command.threadId}`);
  return 0;
}

export async function runInterrupt(
  client: CodexClient,
  command: InterruptCommand,
): Promise<number> {
  await tryResume(client, command.threadId);
  const thread = await readThread(client, command.threadId);
  const active = thread.turns.findLast((turn) => turn.status === "inProgress");
  if (active === undefined) {
    console.error(`no turn in progress on ${command.threadId}; nothing to interrupt`);
    return 1;
  }
  await client.request("turn/interrupt", { threadId: command.threadId, turnId: active.id });
  console.log(`interrupted turn ${active.id} on ${command.threadId}`);
  return 0;
}

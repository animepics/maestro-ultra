import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Command } from "./cli-args.ts";
import { type CodexClient, CodexRpcError } from "./client.ts";
import {
  buildWorkflowRows,
  classifyEventFrame,
  formatClientLine,
  formatClock,
  formatEventLine,
  formatThreadLine,
  type MaestroUnit,
  renderWorkflowJson,
  renderWorkflowTable,
  shouldLiveWatch,
  shouldStopTail,
  statusLabel,
  turnAgentText,
  WORKFLOWS_HEADER,
} from "./format.ts";
import {
  RemoteControlClientsListResponseSchema,
  RemoteControlStatusSchema,
  type Thread,
  ThreadListResponseSchema,
  ThreadLoadedListResponseSchema,
  ThreadReadResponseSchema,
  ThreadSearchResponseSchema,
} from "./protocol.ts";
import { assertNever } from "./result.ts";
import { readThread, runInterrupt, runMsg, runSteer } from "./turn-commands.ts";

export const USAGE = `usage: codex-query <command> [args] [flags]
  status                                remote-control status
  clients [--limit n]                   paired remote-control clients
  threads [limit] [--sort created|updated|recency] [--dir asc|desc]
          [--search term] [--cursor c] [--cwd path] [--archived]
  search <term...> [--limit n]          full-text thread search (experimental)
  active                                threads with a turn in flight
  models                                models offered by the app-server (raw JSON)
  workflows [--json | --watch] [--cwd path]
                                        codex-side workflows merged with .maestro/state.json
  loaded                                thread ids loaded in server memory
  read <threadId> [--full]              thread details with recent turns
  answer <threadId>                     final agent message, full text
  create <cwd>                          start a new thread
  rename <threadId> <name...>           set thread name
  archive <threadId>                    archive a thread
  msg <threadId> <text...> [--timeout secs] [--approve]
                                        send a message, stream the reply
  steer <threadId> <text...>            inject input into the running turn
  interrupt <threadId>                  stop the running turn
  events <threadId> [--follow]          tail a running turn's live events on a
                                        second connection (item progress,
                                        turnError willRetry, completion); one-shot
                                        exits at turn end, --follow tails to SIGINT
HOST targets any app-server: unset = this machine, a known alias (mengmotaHost,
mengmotaMac), any ssh-reachable name[:port], or a ws:// URL. CODEX_WS_TOKEN overrides
the token lookup.`;

async function runThreads(
  client: CodexClient,
  command: Extract<Command, { kind: "threads" }>,
): Promise<void> {
  const raw = await client.request("thread/list", {
    limit: command.limit,
    archived: command.archived,
    ...(command.sort !== undefined ? { sortKey: command.sort } : {}),
    ...(command.dir !== undefined ? { sortDirection: command.dir } : {}),
    ...(command.search !== undefined ? { searchTerm: command.search } : {}),
    ...(command.cursor !== undefined ? { cursor: command.cursor } : {}),
    ...(command.cwd !== undefined ? { cwd: command.cwd } : {}),
  });
  const page = ThreadListResponseSchema.parse(raw);
  for (const thread of page.data) console.log(formatThreadLine(thread));
  console.log(`Total: ${page.data.length}`);
  if (page.nextCursor != null) console.log(`nextCursor: ${page.nextCursor}`);
}

async function runActive(client: CodexClient): Promise<void> {
  // No server-side status filter exists on thread/list; list recent threads
  // and keep the ones whose runtime status is active.
  const raw = await client.request("thread/list", {
    limit: 100,
    sortKey: "recency_at",
    sortDirection: "desc",
  });
  const page = ThreadListResponseSchema.parse(raw);
  const active = page.data.filter((thread) => thread.status.type === "active");
  for (const thread of active) console.log(formatThreadLine(thread));
  console.log(`Active: ${active.length} (of ${page.data.length} recent threads scanned)`);
}

const READ_PREVIEW_CHARS = 300;
const READ_FINAL_CHARS = 3000;

async function runRead(
  client: CodexClient,
  command: Extract<Command, { kind: "read" }>,
): Promise<void> {
  const thread = await readThread(client, command.threadId);
  console.log(`Thread: ${thread.id}`);
  console.log(`Name: ${thread.name ?? "(none)"}`);
  console.log(`Status: ${statusLabel(thread.status)}`);
  console.log(`CWD: ${thread.cwd}`);
  if (thread.gitInfo != null) {
    console.log(`Git: branch=${thread.gitInfo.branch} sha=${thread.gitInfo.sha?.slice(0, 10)}`);
  }
  console.log(`Turns: ${thread.turns.length}`);
  const turns = command.full ? thread.turns : thread.turns.slice(-5);
  for (const turn of turns) {
    console.log(`\n--- Turn ${turn.id} status:${turn.status} (${turn.items.length} items) ---`);
    const items = command.full ? turn.items : turn.items.slice(-8);
    if (!command.full && turn.items.length > 8) {
      console.log(`  (… ${turn.items.length - 8} earlier items; use --full)`);
    }
    for (const item of items) {
      const text = item["text"] ?? item["content"] ?? "";
      const body = typeof text === "string" ? text : JSON.stringify(text);
      const preview = command.full ? body : body.replace(/\s+/g, " ").slice(0, READ_PREVIEW_CHARS);
      console.log(`  [${String(item["type"])}] ${preview}`);
    }
  }
  const last = thread.turns.findLast((turn) => turnAgentText(turn) !== "");
  if (last !== undefined) {
    const text = turnAgentText(last);
    console.log(`\n=== Final agent message (turn ${last.id}, ${last.status}) ===`);
    if (command.full || text.length <= READ_FINAL_CHARS) {
      console.log(text);
    } else {
      console.log(text.slice(0, READ_FINAL_CHARS));
      console.log(
        `(… ${text.length - READ_FINAL_CHARS} more chars; use --full or: answer ${thread.id})`,
      );
    }
  }
}

async function runAnswer(client: CodexClient, threadId: string): Promise<number> {
  const thread = await readThread(client, threadId);
  const last = thread.turns.findLast((turn) => turnAgentText(turn) !== "");
  if (last === undefined) {
    console.error(`no agent message found on ${threadId}`);
    return 1;
  }
  console.log(turnAgentText(last));
  console.error(`(turn ${last.id} — ${last.status})`);
  return 0;
}

async function runClients(client: CodexClient, limit: number | undefined): Promise<number> {
  const statusRaw = await client.request("remoteControl/status/read");
  const status = RemoteControlStatusSchema.parse(statusRaw);
  if (status.environmentId == null) {
    console.error(`remote control is not active (status: ${status.status})`);
    return 1;
  }
  const raw = await client.request("remoteControl/client/list", {
    environmentId: status.environmentId,
    ...(limit !== undefined ? { limit } : {}),
  });
  const page = RemoteControlClientsListResponseSchema.parse(raw);
  for (const entry of page.data) console.log(formatClientLine(entry));
  console.log(`Total: ${page.data.length}`);
  if (page.nextCursor != null) console.log(`nextCursor: ${page.nextCursor}`);
  return 0;
}

// state.json is authored in prose by the conductor, so parse it liberally:
// accept either a bare unit array or a { units: [...] } wrapper, and keep
// unknown fields. A missing/unreadable file degrades to "no units".
const MaestroUnitSchema = z
  .object({
    unitSlug: z.string(),
    threadId: z.string().nullish(),
    branch: z.string().nullish(),
    phase: z.string().nullish(),
    baseline: z.string().nullish(),
    model: z.string().nullish(),
  })
  .loose();

const MaestroStateSchema = z.union([
  z.array(MaestroUnitSchema),
  z.object({ units: z.array(MaestroUnitSchema) }).loose(),
]);

function toMaestroUnit(unit: z.infer<typeof MaestroUnitSchema>): MaestroUnit {
  return {
    unitSlug: unit.unitSlug,
    ...(unit.threadId != null ? { threadId: unit.threadId } : {}),
    ...(unit.branch != null ? { branch: unit.branch } : {}),
    ...(unit.phase != null ? { phase: unit.phase } : {}),
    ...(unit.baseline != null ? { baseline: unit.baseline } : {}),
    ...(unit.model != null ? { model: unit.model } : {}),
  };
}

function readMaestroState(cwd: string): readonly MaestroUnit[] {
  const path = join(cwd, ".maestro", "state.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return []; // no state.json here — codex-only view
  }
  const parsed = MaestroStateSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error(`[workflows] ignoring unreadable ${path}`);
    return [];
  }
  const units = Array.isArray(parsed.data) ? parsed.data : parsed.data.units;
  return units.map(toMaestroUnit);
}

async function fetchActiveThreadsWithTurns(client: CodexClient): Promise<readonly Thread[]> {
  const raw = await client.request("thread/list", {
    limit: 100,
    sortKey: "recency_at",
    sortDirection: "desc",
  });
  const page = ThreadListResponseSchema.parse(raw);
  const active = page.data.filter((thread) => thread.status.type === "active");
  return Promise.all(active.map((thread) => readThread(client, thread.id)));
}

async function renderWorkflowsOnce(client: CodexClient, cwd: string, json: boolean): Promise<void> {
  const threads = await fetchActiveThreadsWithTurns(client);
  const units = readMaestroState(cwd);
  const rows = buildWorkflowRows(threads, units, Date.now());
  if (json) {
    console.log(renderWorkflowJson(rows));
    return;
  }
  console.log(WORKFLOWS_HEADER);
  if (threads.length === 0) console.log("no active codex sessions");
  if (rows.length > 0) console.log(renderWorkflowTable(rows));
}

const WORKFLOWS_REFRESH_MS = 2_000;

// The codebase's first long-lived command. --watch on a TTY departs from the
// one-shot connect→runCommand→close lifecycle: it drives its own refresh loop
// and resolves only on SIGINT, so main()'s finally still owns client.close()
// and the exit-0. Non-TTY degrades to one-shot (no ANSI noise in pipes).
function watchWorkflows(client: CodexClient, cwd: string): Promise<number> {
  return new Promise<number>((resolve) => {
    let stopped = false;
    process.once("SIGINT", () => {
      stopped = true;
      resolve(0);
    });
    const loop = async (): Promise<void> => {
      while (!stopped) {
        process.stdout.write("\x1b[2J\x1b[3J\x1b[H"); // clear screen + scrollback
        await renderWorkflowsOnce(client, cwd, false);
        await new Promise((tick) => setTimeout(tick, WORKFLOWS_REFRESH_MS));
      }
    };
    void loop().catch((error: unknown) => {
      console.error(String(error));
      resolve(1);
    });
  });
}

async function runWorkflows(
  client: CodexClient,
  command: Extract<Command, { kind: "workflows" }>,
): Promise<number> {
  const cwd = command.cwd ?? process.cwd();
  if (!shouldLiveWatch(command.watch, process.stdout.isTTY === true)) {
    await renderWorkflowsOnce(client, cwd, command.json);
    return 0;
  }
  return watchWorkflows(client, cwd);
}

// thread/resume subscribes THIS connection to the thread's live notification
// broadcast — the same mechanism msg/steer use. A second connection resuming a
// turn started elsewhere still receives its notifications (verified by probe),
// which is what makes an out-of-process event tail possible. A thread whose
// first turn has not persisted a rollout yet cannot be resumed.
async function resumeForEvents(client: CodexClient, threadId: string): Promise<boolean> {
  try {
    await client.request("thread/resume", { threadId });
    return true;
  } catch (error) {
    if (
      error instanceof CodexRpcError &&
      (error.detail.includes("no rollout found") || error.detail.includes("is empty"))
    )
      return false;
    throw error;
  }
}

// The tail loop: print one line per classified event; a one-shot exits at the
// first turn/completed, --follow tails across turns until SIGINT. Like
// watchWorkflows this is long-lived, so main()'s finally still owns client.close
// and the exit. Output is plain lines (no ANSI), so it is pipe-safe.
function tailEvents(client: CodexClient, threadId: string, follow: boolean): Promise<number> {
  return new Promise<number>((resolve) => {
    let unsubscribe = (): void => {};
    let stopped = false;
    const finish = (code: number): void => {
      if (stopped) return;
      stopped = true;
      unsubscribe();
      resolve(code);
    };
    process.once("SIGINT", () => finish(0));
    unsubscribe = client.onMessage((message) => {
      const event = classifyEventFrame(threadId, message);
      if (event === undefined) return;
      console.log(formatEventLine(event, new Date()));
      if (shouldStopTail(event, follow)) finish(0);
    });
  });
}

async function runEvents(
  client: CodexClient,
  command: Extract<Command, { kind: "events" }>,
): Promise<number> {
  const resumed = await resumeForEvents(client, command.threadId);
  if (!resumed) {
    console.error(`no rollout for ${command.threadId} yet — no live turn events to tail`);
    return 1;
  }
  // Don't hang on a thread with nothing running: without a turn in progress and
  // without --follow there is no live stream to wait for, so report and exit.
  const thread = await readThread(client, command.threadId);
  const running = thread.turns.some((turn) => turn.status === "inProgress");
  if (!running && !command.follow) {
    const last = thread.turns.at(-1);
    console.log(
      `[${formatClock(new Date())}] idle: no turn in progress (last: ${last?.status ?? "none"})`,
    );
    return 0;
  }
  return tailEvents(client, command.threadId, command.follow);
}

export async function runCommand(client: CodexClient, command: Command): Promise<number> {
  switch (command.kind) {
    case "help":
      console.log(USAGE);
      return 0;
    case "status": {
      const raw = await client.request("remoteControl/status/read");
      console.log(JSON.stringify(raw, null, 2));
      return 0;
    }
    case "clients":
      return runClients(client, command.limit);
    case "threads":
      await runThreads(client, command);
      return 0;
    case "search": {
      const raw = await client.request("thread/search", {
        searchTerm: command.term,
        limit: command.limit,
      });
      const page = ThreadSearchResponseSchema.parse(raw);
      for (const hit of page.data) {
        console.log(formatThreadLine(hit.thread));
        console.log(`  snippet: ${hit.snippet.slice(0, 160)}`);
      }
      console.log(`Total: ${page.data.length}`);
      if (page.nextCursor != null) console.log(`nextCursor: ${page.nextCursor}`);
      return 0;
    }
    case "active":
      await runActive(client);
      return 0;
    case "models": {
      // No vendored schema for model/list yet; print the raw response like `status`.
      const raw = await client.request("model/list", {});
      console.log(JSON.stringify(raw, null, 2));
      return 0;
    }
    case "loaded": {
      const raw = await client.request("thread/loaded/list", {});
      const page = ThreadLoadedListResponseSchema.parse(raw);
      console.log(`Loaded threads: ${page.data.length}`);
      for (const threadId of page.data) console.log(`  ${threadId}`);
      return 0;
    }
    case "read":
      await runRead(client, command);
      return 0;
    case "answer":
      return runAnswer(client, command.threadId);
    case "create": {
      const raw = await client.request("thread/start", { cwd: command.cwd });
      const { thread } = ThreadReadResponseSchema.parse(raw);
      console.log(`Created ${thread.id}`);
      console.log(`  cwd: ${thread.cwd}`);
      console.log(`  next: msg ${thread.id} "<text>"  |  read ${thread.id}`);
      return 0;
    }
    case "rename":
      await client.request("thread/name/set", {
        threadId: command.threadId,
        name: command.name,
      });
      console.log(`Renamed ${command.threadId} -> "${command.name}"`);
      return 0;
    case "archive":
      await client.request("thread/archive", { threadId: command.threadId });
      console.log(`Archived ${command.threadId}`);
      return 0;
    case "msg":
      return runMsg(client, command);
    case "steer":
      return runSteer(client, command);
    case "interrupt":
      return runInterrupt(client, command);
    case "workflows":
      return runWorkflows(client, command);
    case "events":
      return runEvents(client, command);
    default:
      return assertNever(command);
  }
}

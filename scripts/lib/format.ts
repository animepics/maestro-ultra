import type { RemoteControlClient, Thread, ThreadStatus, Turn } from "./protocol.ts";
import { assertNever } from "./result.ts";

const TITLE_WIDTH = 70;

export function statusLabel(status: ThreadStatus): string {
  switch (status.type) {
    case "notLoaded":
      return "notLoaded";
    case "idle":
      return "idle";
    case "systemError":
      return "systemError";
    case "active":
      return status.activeFlags.length > 0 ? `active[${status.activeFlags.join(",")}]` : "active";
    default:
      return assertNever(status);
  }
}

export function formatThreadLine(thread: Thread): string {
  const title = (thread.name ?? "") || thread.preview.split("\n")[0] || "(untitled)";
  return [
    `[${thread.source ?? "?"}]`,
    thread.id,
    title.slice(0, TITLE_WIDTH),
    statusLabel(thread.status),
  ].join(" | ");
}

// The concatenated agent reply of one turn — what "how did it go?" asks for.
export function turnAgentText(turn: Turn): string {
  return turn.items
    .filter((item) => item["type"] === "agentMessage" && typeof item["text"] === "string")
    .map((item) => String(item["text"]))
    .join("\n");
}

// --- workflows subcommand (maestro-local) ---------------------------------
// Pure rendering + merge for the `workflows` codex-side table. The live socket
// fetch and the --watch loop live in commands.ts; everything here is testable
// without a connection.

export const WORKFLOWS_HEADER =
  "codex-side view only — Claude subagents are visible via the conductor's maestro-workflows report";

export const WORKFLOW_COLUMNS = [
  "UNIT",
  "THREAD",
  "MODEL",
  "STATUS",
  "LAST EVENT",
  "ELAPSED",
] as const;

// A unit as recorded in <cwd>/.maestro/state.json (see maestro SKILL.md). Only
// the fields the table correlates on are typed; the file carries more.
export type MaestroUnit = {
  readonly unitSlug: string;
  readonly threadId?: string;
  readonly branch?: string;
  readonly phase?: string;
  readonly baseline?: string;
  readonly model?: string;
};

export type WorkflowRow = {
  readonly unit: string;
  readonly thread: string;
  readonly model: string;
  readonly status: string;
  readonly lastEvent: string;
  readonly elapsed: string;
};

export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h${mins % 60}m`;
}

function threadLastEvent(thread: Thread): string {
  const turn = thread.turns.at(-1);
  if (turn === undefined) return "(no turns)";
  const item = turn.items.at(-1);
  const itemType = item !== undefined ? String(item["type"]) : undefined;
  return itemType !== undefined ? `${turn.status}:${itemType}` : turn.status;
}

function workflowRow(
  unit: MaestroUnit | undefined,
  thread: Thread | undefined,
  nowMs: number,
): WorkflowRow {
  const unitLabel = unit?.unitSlug ?? "-";
  if (thread === undefined) {
    return {
      unit: unitLabel,
      thread: "-",
      model: unit?.model ?? "-",
      status: unit?.phase ?? "-",
      lastEvent: "(no active codex thread)",
      elapsed: "-",
    };
  }
  const status = statusLabel(thread.status);
  return {
    unit: unitLabel,
    thread: thread.id.slice(0, 8),
    model: thread.modelProvider ?? unit?.model ?? "-",
    status: unit?.phase !== undefined ? `${status} (${unit.phase})` : status,
    lastEvent: threadLastEvent(thread),
    elapsed: formatElapsed(nowMs - thread.updatedAt * 1000),
  };
}

// Merge state.json units with live codex threads: one row per unit (matched to
// its thread by id when active), then any active thread not claimed by a unit.
export function buildWorkflowRows(
  threads: readonly Thread[],
  units: readonly MaestroUnit[],
  nowMs: number,
): readonly WorkflowRow[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread] as const));
  const used = new Set<string>();
  const rows: WorkflowRow[] = [];
  for (const unit of units) {
    const thread = unit.threadId !== undefined ? byId.get(unit.threadId) : undefined;
    if (thread !== undefined) used.add(thread.id);
    rows.push(workflowRow(unit, thread, nowMs));
  }
  for (const thread of threads) {
    if (used.has(thread.id)) continue;
    rows.push(workflowRow(undefined, thread, nowMs));
  }
  return rows;
}

export function renderWorkflowTable(rows: readonly WorkflowRow[]): string {
  const cells = rows.map((row) => [
    row.unit,
    row.thread,
    row.model,
    row.status,
    row.lastEvent,
    row.elapsed,
  ]);
  const widths = WORKFLOW_COLUMNS.map((header, i) =>
    Math.max(header.length, ...cells.map((cell) => (cell[i] ?? "").length)),
  );
  const line = (cols: readonly string[]): string =>
    cols
      .map((col, i) => col.padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd();
  return [line(WORKFLOW_COLUMNS), ...cells.map(line)].join("\n");
}

// --watch drives an ANSI clear/redraw loop; that only makes sense on a TTY.
// Elsewhere (pipes, CI) degrade to a single one-shot render.
export function shouldLiveWatch(watch: boolean, isTty: boolean): boolean {
  return watch && isTty;
}

export function formatClientLine(client: RemoteControlClient): string {
  const device = [client.deviceType, client.platform, client.osVersion, client.deviceModel]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" ");
  const lastSeen =
    client.lastSeenAt == null ? "never" : new Date(client.lastSeenAt * 1000).toISOString();
  return [
    client.clientId,
    client.displayName ?? "(unnamed)",
    device === "" ? "(unknown device)" : device,
    `app ${client.appVersion ?? "?"}`,
    `lastSeen ${lastSeen}`,
  ].join(" | ");
}

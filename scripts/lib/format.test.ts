import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildWorkflowRows,
  classifyEventFrame,
  formatElapsed,
  formatEventLine,
  formatThreadLine,
  renderWorkflowTable,
  shouldLiveWatch,
  shouldStopTail,
  statusLabel,
  turnAgentText,
  WORKFLOW_COLUMNS,
} from "./format.ts";
import { ThreadSchema, TurnSchema } from "./protocol.ts";

describe("statusLabel", () => {
  it("renders active flags so a stuck approval is visible in listings", () => {
    // Given / When / Then
    assert.equal(
      statusLabel({ type: "active", activeFlags: ["waitingOnApproval"] }),
      "active[waitingOnApproval]",
    );
  });

  it("renders idle as a bare word", () => {
    assert.equal(statusLabel({ type: "idle" }), "idle");
  });

  it("renders systemError so broken threads are not mistaken for idle ones", () => {
    assert.equal(statusLabel({ type: "systemError" }), "systemError");
  });
});

describe("formatThreadLine", () => {
  it("shows id, title, and status when the thread has a name", () => {
    // Given
    const thread = ThreadSchema.parse({
      id: "019f209c-037f-7af1-8679-b08435c708ec",
      name: "my session",
      preview: "first user message",
      status: { type: "idle" },
      cwd: "/tmp",
      source: "vscode",
      createdAt: 1,
      updatedAt: 2,
    });
    // When
    const line = formatThreadLine(thread);
    // Then
    assert.ok(line.includes("019f209c-037f-7af1-8679-b08435c708ec"));
    assert.ok(line.includes("my session"));
    assert.ok(line.includes("idle"));
  });

  it("falls back to the preview when the thread has no name", () => {
    // Given
    const thread = ThreadSchema.parse({
      id: "t2",
      preview: "fix the parser crash",
      status: { type: "idle" },
      cwd: "/tmp",
      createdAt: 1,
      updatedAt: 2,
    });
    // When / Then
    assert.ok(formatThreadLine(thread).includes("fix the parser crash"));
  });
});

describe("turnAgentText", () => {
  it("joins every agentMessage item so the final reply survives intact", () => {
    // Given: a turn mixing tool items and two agent messages
    const turn = TurnSchema.parse({
      id: "u1",
      status: "completed",
      items: [
        { type: "commandExecution", command: "ls" },
        { type: "agentMessage", text: "part one" },
        { type: "agentMessage", text: "part two" },
      ],
    });
    // When / Then
    assert.equal(turnAgentText(turn), "part one\npart two");
  });
});

const activeThread = ThreadSchema.parse({
  id: "019f209c-037f-7af1-8679-b08435c708ec",
  preview: "implement auth",
  status: { type: "active", activeFlags: [] },
  cwd: "/repo",
  modelProvider: "openai",
  createdAt: 1000,
  updatedAt: 1000,
  turns: [
    { id: "u1", status: "inProgress", items: [{ type: "commandExecution", command: "npm test" }] },
  ],
});

describe("buildWorkflowRows", () => {
  it("merges a state.json unit with its active thread and folds phase into status", () => {
    // Given: a unit pointing at an active thread, read 65s after its last update
    const units = [
      {
        unitSlug: "auth-api",
        threadId: activeThread.id,
        branch: "maestro/auth-api",
        phase: "verify",
      },
    ];
    const now = 1000 * 1000 + 65_000;
    // When
    const rows = buildWorkflowRows([activeThread], units, now);
    // Then
    assert.deepEqual(rows, [
      {
        unit: "auth-api",
        thread: "019f209c",
        model: "openai",
        status: "active (verify)",
        lastEvent: "inProgress:commandExecution",
        elapsed: "1m5s",
      },
    ]);
  });

  it("labels a unit with no active thread and a thread claimed by no unit", () => {
    // Given: one orphan unit (thread gone) + one active thread with no unit row
    const units = [{ unitSlug: "docs", phase: "rework" }];
    // When
    const rows = buildWorkflowRows([activeThread], units, 1000 * 1000);
    // Then: the unit row is marked, the unclaimed thread gets a "-" unit
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], {
      unit: "docs",
      thread: "-",
      model: "-",
      status: "rework",
      lastEvent: "(no active codex thread)",
      elapsed: "-",
    });
    assert.equal(rows[1]?.unit, "-");
    assert.equal(rows[1]?.thread, "019f209c");
  });
});

describe("renderWorkflowTable", () => {
  it("aligns columns and keeps the header row", () => {
    // Given
    const rows = buildWorkflowRows(
      [activeThread],
      [{ unitSlug: "auth", threadId: activeThread.id }],
      1000 * 1000,
    );
    // When
    const table = renderWorkflowTable(rows);
    const lines = table.split("\n");
    // Then
    assert.ok(lines[0]?.startsWith("UNIT"));
    for (const column of WORKFLOW_COLUMNS) assert.ok(lines[0]?.includes(column));
    assert.ok(lines[1]?.includes("auth"));
    assert.ok(lines[1]?.includes("019f209c"));
  });
});

describe("formatElapsed", () => {
  it("renders seconds, minutes, and hours and guards negatives", () => {
    assert.equal(formatElapsed(5_000), "5s");
    assert.equal(formatElapsed(65_000), "1m5s");
    assert.equal(formatElapsed(3_900_000), "1h5m");
    assert.equal(formatElapsed(-1), "-");
  });
});

describe("shouldLiveWatch", () => {
  it("drives the ANSI refresh loop only when --watch meets a TTY", () => {
    assert.equal(shouldLiveWatch(true, true), true);
    assert.equal(shouldLiveWatch(true, false), false);
    assert.equal(shouldLiveWatch(false, true), false);
    assert.equal(shouldLiveWatch(false, false), false);
  });
});

const EVENTS_THREAD = "t-target";

describe("classifyEventFrame", () => {
  it("renders item lifecycle with the item type and phase", () => {
    // Given / When / Then: item/started carries the item type to tail
    assert.deepEqual(
      classifyEventFrame(EVENTS_THREAD, {
        method: "item/started",
        params: {
          threadId: EVENTS_THREAD,
          turnId: "u1",
          item: { type: "commandExecution", id: "i1" },
        },
      }),
      { body: "item:commandExecution started", terminal: false },
    );
    assert.deepEqual(
      classifyEventFrame(EVENTS_THREAD, {
        method: "item/completed",
        params: { threadId: EVENTS_THREAD, turnId: "u1", item: { type: "agentMessage" } },
      }),
      { body: "item:agentMessage completed", terminal: false },
    );
  });

  it("surfaces turnError with willRetry — the signal thread/read cannot show", () => {
    // Given / When / Then
    assert.deepEqual(
      classifyEventFrame(EVENTS_THREAD, {
        method: "error",
        params: {
          threadId: EVENTS_THREAD,
          turnId: "u1",
          willRetry: true,
          error: { message: "UsageLimitExceeded" },
        },
      }),
      { body: "turnError: UsageLimitExceeded willRetry=true", terminal: false },
    );
  });

  it("marks turn/completed terminal so a one-shot tail stops", () => {
    // Given / When / Then
    assert.deepEqual(
      classifyEventFrame(EVENTS_THREAD, {
        method: "turn/completed",
        params: { threadId: EVENTS_THREAD, turn: { id: "u1", status: "completed", items: [] } },
      }),
      { body: "completed: completed", terminal: true },
    );
  });

  it("ignores frames for another thread and non-event noise", () => {
    // Given: an item for a different thread, and a token-usage notification
    assert.equal(
      classifyEventFrame(EVENTS_THREAD, {
        method: "item/started",
        params: { threadId: "other", item: { type: "commandExecution" } },
      }),
      undefined,
    );
    assert.equal(
      classifyEventFrame(EVENTS_THREAD, {
        method: "thread/tokenUsage/updated",
        params: { threadId: EVENTS_THREAD },
      }),
      undefined,
    );
  });
});

describe("formatEventLine and shouldStopTail", () => {
  it("prefixes a wall-clock timestamp", () => {
    // Given: a fixed local time
    const at = new Date("2026-07-20T09:37:42");
    // When / Then
    assert.equal(
      formatEventLine({ body: "completed: completed", terminal: true }, at),
      "[09:37:42] completed: completed",
    );
  });

  it("stops a one-shot tail on a terminal event but keeps --follow running", () => {
    // Given / When / Then
    assert.equal(shouldStopTail({ body: "completed: completed", terminal: true }, false), true);
    assert.equal(shouldStopTail({ body: "completed: completed", terminal: true }, true), false);
    assert.equal(shouldStopTail({ body: "item:x started", terminal: false }, false), false);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  JsonRpcMessageSchema,
  ThreadListResponseSchema,
  ThreadLoadedListResponseSchema,
  ThreadSchema,
  TurnCompletedParamsSchema,
} from "./protocol.ts";

describe("ThreadLoadedListResponseSchema", () => {
  it("exposes loaded thread ids from the `data` field when parsing a live response", () => {
    // Given: the exact shape the server returned in the live probe (2026-07-02)
    const raw = { data: ["019f209c-037f-7af1-8679-b08435c708ec"], nextCursor: null };
    // When
    const parsed = ThreadLoadedListResponseSchema.parse(raw);
    // Then: ids come from `data` — the old CLI read a nonexistent `threadIds` field
    assert.deepEqual(parsed.data, ["019f209c-037f-7af1-8679-b08435c708ec"]);
  });
});

describe("ThreadSchema", () => {
  it("parses an active status with activeFlags when the thread has a turn in flight", () => {
    // Given: a thread carrying the tagged active status
    const raw = {
      id: "t1",
      preview: "fix the bug",
      status: { type: "active", activeFlags: ["waitingOnApproval"] },
      cwd: "/tmp",
      createdAt: 1,
      updatedAt: 2,
    };
    // When
    const thread = ThreadSchema.parse(raw);
    // Then
    assert.equal(thread.status.type, "active");
    if (thread.status.type !== "active") throw new Error("unreachable");
    assert.deepEqual(thread.status.activeFlags, ["waitingOnApproval"]);
  });

  it("parses a systemError status when the server reports one", () => {
    // Given
    const raw = {
      id: "t2",
      preview: "",
      status: { type: "systemError" },
      cwd: "/tmp",
      createdAt: 1,
      updatedAt: 2,
    };
    // When / Then
    assert.equal(ThreadSchema.parse(raw).status.type, "systemError");
  });
});

describe("ThreadListResponseSchema", () => {
  it("keeps pagination cursors when a page is full", () => {
    // Given
    const raw = {
      data: [],
      nextCursor: "2026-07-02T02:02:40.359Z|x",
      backwardsCursor: "2026-07-02T02:03:44.000Z|y",
    };
    // When
    const page = ThreadListResponseSchema.parse(raw);
    // Then
    assert.equal(page.nextCursor, "2026-07-02T02:02:40.359Z|x");
    assert.equal(page.backwardsCursor, "2026-07-02T02:03:44.000Z|y");
  });
});

describe("TurnCompletedParamsSchema", () => {
  it("surfaces the failure message when a turn completes with status failed", () => {
    // Given
    const raw = {
      threadId: "t1",
      turn: { id: "turn1", status: "failed", items: [], error: { message: "usage limit" } },
    };
    // When
    const params = TurnCompletedParamsSchema.parse(raw);
    // Then
    assert.equal(params.turn.status, "failed");
    assert.equal(params.turn.error?.message, "usage limit");
  });
});

describe("JsonRpcMessageSchema", () => {
  it("rejects a frame that is not an object", () => {
    // Given / When
    const parsed = JsonRpcMessageSchema.safeParse("garbage");
    // Then
    assert.equal(parsed.success, false);
  });
});

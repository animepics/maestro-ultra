import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyServerMessage } from "./turn-monitor.ts";

const THREAD = "t-target";

describe("classifyServerMessage deltas", () => {
  it("yields a delta event when an agentMessage delta arrives for the watched thread", () => {
    // Given
    const msg = {
      method: "item/agentMessage/delta",
      params: { threadId: THREAD, turnId: "u1", itemId: "i1", delta: "PO" },
    };
    // When / Then
    assert.deepEqual(classifyServerMessage(THREAD, msg), { kind: "delta", text: "PO" });
  });

  it("ignores a delta that belongs to a different thread", () => {
    // Given
    const msg = {
      method: "item/agentMessage/delta",
      params: { threadId: "other", turnId: "u1", itemId: "i1", delta: "NG" },
    };
    // When / Then
    assert.deepEqual(classifyServerMessage(THREAD, msg), { kind: "ignored" });
  });
});

describe("classifyServerMessage completion", () => {
  it("yields completed with the turn status when the watched thread's turn ends", () => {
    // Given
    const msg = {
      method: "turn/completed",
      params: { threadId: THREAD, turn: { id: "u1", status: "completed", items: [] } },
    };
    // When / Then
    assert.deepEqual(classifyServerMessage(THREAD, msg), {
      kind: "completed",
      status: "completed",
    });
  });

  it("carries the error message when the turn failed", () => {
    // Given
    const msg = {
      method: "turn/completed",
      params: {
        threadId: THREAD,
        turn: { id: "u1", status: "failed", items: [], error: { message: "usage limit" } },
      },
    };
    // When / Then
    assert.deepEqual(classifyServerMessage(THREAD, msg), {
      kind: "completed",
      status: "failed",
      errorMessage: "usage limit",
    });
  });

  it("ignores completion of an unrelated thread so concurrent sessions cannot end the wait", () => {
    // Given
    const msg = {
      method: "turn/completed",
      params: { threadId: "other", turn: { id: "u9", status: "completed", items: [] } },
    };
    // When / Then
    assert.deepEqual(classifyServerMessage(THREAD, msg), { kind: "ignored" });
  });
});

describe("classifyServerMessage server requests", () => {
  it("yields serverRequest when the server asks for command approval mid-turn", () => {
    // Given: server -> client JSON-RPC request (has both id and method)
    const msg = {
      id: 42,
      method: "item/commandExecution/requestApproval",
      params: { threadId: THREAD, itemId: "i1" },
    };
    // When / Then
    assert.deepEqual(classifyServerMessage(THREAD, msg), {
      kind: "serverRequest",
      requestId: 42,
      method: "item/commandExecution/requestApproval",
    });
  });
});

describe("classifyServerMessage errors and noise", () => {
  it("yields turnError with retry info when the server reports a thread error", () => {
    // Given
    const msg = {
      method: "error",
      params: {
        threadId: THREAD,
        turnId: "u1",
        willRetry: false,
        error: { message: "UsageLimitExceeded" },
      },
    };
    // When / Then
    assert.deepEqual(classifyServerMessage(THREAD, msg), {
      kind: "turnError",
      message: "UsageLimitExceeded",
      willRetry: false,
    });
  });

  it("ignores plain responses that only carry an id", () => {
    // Given / When / Then
    assert.deepEqual(classifyServerMessage(THREAD, { id: 7, result: {} }), { kind: "ignored" });
  });
});

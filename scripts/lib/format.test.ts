import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatThreadLine, statusLabel, turnAgentText } from "./format.ts";
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

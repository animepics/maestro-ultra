import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildWorkflowRows, renderWorkflowJson } from "./format.ts";
import { ThreadSchema } from "./protocol.ts";

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

describe("renderWorkflowJson", () => {
  it("renders active threads and state-only units as a headerless JSON row array", () => {
    // Given: one state-only unit and one active thread not claimed by state.json
    const rows = buildWorkflowRows(
      [activeThread],
      [{ unitSlug: "docs", phase: "rework", model: "gpt-5.6-luna" }],
      1000 * 1000,
    );
    // When
    const output = renderWorkflowJson(rows);
    // Then
    assert.deepEqual(JSON.parse(output), [
      {
        unit: "docs",
        thread: "-",
        model: "gpt-5.6-luna",
        status: "rework",
        lastEvent: "(no active codex thread)",
        elapsed: "-",
      },
      {
        unit: "-",
        thread: "019f209c",
        model: "openai",
        status: "active",
        lastEvent: "inProgress:commandExecution",
        elapsed: "0s",
      },
    ]);
    assert.equal(output.includes("UNIT"), false);
    assert.equal(output.includes("codex-side view only"), false);
    assert.equal(output.includes("\u001b"), false);
  });
});

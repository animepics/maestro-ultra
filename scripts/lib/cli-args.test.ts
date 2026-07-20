import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCliArgs } from "./cli-args.ts";

describe("parseCliArgs threads", () => {
  it("maps sort/search/cursor flags onto thread/list params when all are given", () => {
    // Given
    const argv = [
      "threads",
      "30",
      "--sort",
      "updated",
      "--dir",
      "asc",
      "--search",
      "omo",
      "--cursor",
      "c1",
    ] as const;
    // When
    const result = parseCliArgs(argv);
    // Then
    if (!result.ok) throw new Error(result.error.message);
    assert.deepEqual(result.value, {
      kind: "threads",
      limit: 30,
      sort: "updated_at",
      dir: "asc",
      search: "omo",
      cursor: "c1",
      archived: false,
    });
  });

  it("defaults to limit 15 non-archived when no flags are given", () => {
    // Given / When
    const result = parseCliArgs(["threads"]);
    // Then
    if (!result.ok) throw new Error(result.error.message);
    assert.deepEqual(result.value, { kind: "threads", limit: 15, archived: false });
  });

  it("rejects an unknown sort key with a usage error", () => {
    // Given / When
    const result = parseCliArgs(["threads", "--sort", "bogus"]);
    // Then
    assert.equal(result.ok, false);
  });
});

describe("parseCliArgs msg", () => {
  it("joins message words and honors --timeout when steering an idle thread", () => {
    // Given / When
    const result = parseCliArgs(["msg", "tid-1", "hello", "world", "--timeout", "900"]);
    // Then
    if (!result.ok) throw new Error(result.error.message);
    assert.deepEqual(result.value, {
      kind: "msg",
      threadId: "tid-1",
      text: "hello world",
      timeoutSecs: 900,
      approve: false,
    });
  });

  it("defaults the turn timeout to 600 seconds when --timeout is absent", () => {
    // Given / When
    const result = parseCliArgs(["msg", "tid-1", "ping"]);
    // Then
    if (!result.ok) throw new Error(result.error.message);
    if (result.value.kind !== "msg") throw new Error("wrong kind");
    assert.deepEqual(result.value.timeoutSecs, 600);
  });

  it("rejects msg without any text", () => {
    // Given / When / Then
    assert.equal(parseCliArgs(["msg", "tid-1"]).ok, false);
  });
});

describe("parseCliArgs steer and interrupt", () => {
  it("collects steer text after the thread id", () => {
    // Given / When
    const result = parseCliArgs(["steer", "tid-2", "also", "run", "tests"]);
    // Then
    if (!result.ok) throw new Error(result.error.message);
    assert.deepEqual(result.value, { kind: "steer", threadId: "tid-2", text: "also run tests" });
  });

  it("parses interrupt with only a thread id", () => {
    // Given / When
    const result = parseCliArgs(["interrupt", "tid-3"]);
    // Then
    if (!result.ok) throw new Error(result.error.message);
    assert.deepEqual(result.value, { kind: "interrupt", threadId: "tid-3" });
  });
});

describe("parseCliArgs search and active", () => {
  it("treats every non-flag token as the full-text search term", () => {
    // Given / When
    const result = parseCliArgs(["search", "usage", "limit", "--limit", "5"]);
    // Then
    if (!result.ok) throw new Error(result.error.message);
    assert.deepEqual(result.value, { kind: "search", term: "usage limit", limit: 5 });
  });

  it("rejects search without a term", () => {
    assert.deepEqual(parseCliArgs(["search"]).ok, false);
  });

  it("parses the active command", () => {
    // Given / When
    const result = parseCliArgs(["active"]);
    // Then
    if (!result.ok) throw new Error(result.error.message);
    assert.deepEqual(result.value, { kind: "active" });
  });

  it("parses the models command", () => {
    // Given / When
    const result = parseCliArgs(["models"]);
    // Then
    if (!result.ok) throw new Error(result.error.message);
    assert.deepEqual(result.value, { kind: "models" });
  });
});

describe("parseCliArgs failure modes", () => {
  it("returns a usage error naming the command when the command is unknown", () => {
    // Given / When
    const result = parseCliArgs(["bogus"]);
    // Then
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.ok(result.error.message.includes("bogus"));
  });
});

describe("parseCliArgs read and answer", () => {
  it("parses read with the --full flag for untruncated output", () => {
    // Given / When
    const result = parseCliArgs(["read", "tid-4", "--full"]);
    // Then
    if (!result.ok) throw new Error(result.error.message);
    assert.deepEqual(result.value, { kind: "read", threadId: "tid-4", full: true });
  });

  it("parses answer so the final agent message can be fetched in one command", () => {
    // Given / When
    const result = parseCliArgs(["answer", "tid-5"]);
    // Then
    if (!result.ok) throw new Error(result.error.message);
    assert.deepEqual(result.value, { kind: "answer", threadId: "tid-5" });
  });
});

describe("parseCliArgs msg model/effort overrides", () => {
  it("parses --model and --effort so maestro can pick the model per work unit", () => {
    // Given / When
    const result = parseCliArgs([
      "msg",
      "tid-6",
      "do it",
      "--model",
      "gpt-5.6-luna",
      "--effort",
      "low",
    ]);
    // Then
    if (!result.ok) throw new Error(result.error.message);
    assert.deepEqual(result.value, {
      kind: "msg",
      threadId: "tid-6",
      text: "do it",
      timeoutSecs: 600,
      approve: false,
      model: "gpt-5.6-luna",
      effort: "low",
    });
  });

  it("leaves model and effort undefined when the flags are absent", () => {
    // Given / When
    const result = parseCliArgs(["msg", "tid-7", "do it"]);
    // Then
    if (!result.ok) throw new Error(result.error.message);
    assert.equal(result.value.kind, "msg");
    if (result.value.kind !== "msg") throw new Error("unreachable");
    assert.equal(result.value.model, undefined);
    assert.equal(result.value.effort, undefined);
  });
});

import type { SortDirection, ThreadSortKey } from "./protocol.ts";
import { SORT_DIRECTIONS } from "./protocol.ts";
import { err, ok, type Result } from "./result.ts";

export type Command =
  | { readonly kind: "status" }
  | { readonly kind: "clients"; readonly limit?: number }
  | {
      readonly kind: "threads";
      readonly limit: number;
      readonly archived: boolean;
      readonly sort?: ThreadSortKey;
      readonly dir?: SortDirection;
      readonly search?: string;
      readonly cursor?: string;
      readonly cwd?: string;
    }
  | { readonly kind: "search"; readonly term: string; readonly limit: number }
  | { readonly kind: "active" }
  | { readonly kind: "read"; readonly threadId: string; readonly full: boolean }
  | { readonly kind: "answer"; readonly threadId: string }
  | { readonly kind: "loaded" }
  | { readonly kind: "create"; readonly cwd: string }
  | { readonly kind: "rename"; readonly threadId: string; readonly name: string }
  | { readonly kind: "archive"; readonly threadId: string }
  | {
      readonly kind: "msg";
      readonly threadId: string;
      readonly text: string;
      readonly timeoutSecs: number;
      readonly approve: boolean;
      readonly model?: string;
      readonly effort?: string;
    }
  | { readonly kind: "steer"; readonly threadId: string; readonly text: string }
  | { readonly kind: "interrupt"; readonly threadId: string }
  | { readonly kind: "help" };

export type CliArgsError = { readonly kind: "usage"; readonly message: string };

const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "sort",
  "dir",
  "search",
  "cursor",
  "cwd",
  "limit",
  "timeout",
  "model",
  "effort",
]);
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(["archived", "approve", "full"]);

const SORT_ALIASES: Readonly<Record<string, ThreadSortKey>> = {
  created: "created_at",
  created_at: "created_at",
  updated: "updated_at",
  updated_at: "updated_at",
  recency: "recency_at",
  recency_at: "recency_at",
};

type ParsedFlags = {
  readonly values: ReadonlyMap<string, string>;
  readonly booleans: ReadonlySet<string>;
  readonly positionals: readonly string[];
};

function usage(message: string): Result<never, CliArgsError> {
  return err({ kind: "usage", message });
}

function splitFlags(argv: readonly string[]): Result<ParsedFlags, CliArgsError> {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) break;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const flag = token.slice(2);
    if (BOOLEAN_FLAGS.has(flag)) {
      booleans.add(flag);
      continue;
    }
    if (VALUE_FLAGS.has(flag)) {
      const value = argv[i + 1];
      if (value === undefined) return usage(`--${flag} requires a value`);
      values.set(flag, value);
      i += 1;
      continue;
    }
    return usage(`unknown flag --${flag}`);
  }
  return ok({ values, booleans, positionals });
}

function parsePositiveInt(raw: string, label: string): Result<number, CliArgsError> {
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value <= 0) return usage(`${label} must be a positive integer`);
  return ok(value);
}

function parseThreads(flags: ParsedFlags): Result<Command, CliArgsError> {
  let limit = 15;
  const rawLimit = flags.positionals[1] ?? flags.values.get("limit");
  if (rawLimit !== undefined) {
    const parsed = parsePositiveInt(rawLimit, "limit");
    if (!parsed.ok) return parsed;
    limit = parsed.value;
  }
  let sort: ThreadSortKey | undefined;
  const rawSort = flags.values.get("sort");
  if (rawSort !== undefined) {
    sort = SORT_ALIASES[rawSort];
    if (sort === undefined) return usage(`unknown sort key '${rawSort}'`);
  }
  const rawDir = flags.values.get("dir");
  const dir = SORT_DIRECTIONS.find((candidate) => candidate === rawDir);
  if (rawDir !== undefined && dir === undefined) {
    return usage(`--dir must be one of: ${SORT_DIRECTIONS.join(", ")}`);
  }
  const search = flags.values.get("search");
  const cursor = flags.values.get("cursor");
  const cwd = flags.values.get("cwd");
  return ok({
    kind: "threads",
    limit,
    archived: flags.booleans.has("archived"),
    ...(sort !== undefined ? { sort } : {}),
    ...(dir !== undefined ? { dir } : {}),
    ...(search !== undefined ? { search } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
  });
}

function parseWithText(
  flags: ParsedFlags,
  build: (threadId: string, text: string) => Result<Command, CliArgsError>,
  name: string,
): Result<Command, CliArgsError> {
  const threadId = flags.positionals[1];
  const text = flags.positionals.slice(2).join(" ");
  if (threadId === undefined || text === "") {
    return usage(`usage: ${name} <threadId> <text...>`);
  }
  return build(threadId, text);
}

export function parseCliArgs(argv: readonly string[]): Result<Command, CliArgsError> {
  const split = splitFlags(argv);
  if (!split.ok) return split;
  const flags = split.value;
  const command = flags.positionals[0];
  switch (command) {
    case undefined:
    case "help":
      return ok({ kind: "help" });
    case "status":
      return ok({ kind: "status" });
    case "loaded":
      return ok({ kind: "loaded" });
    case "active":
      return ok({ kind: "active" });
    case "clients": {
      const rawLimit = flags.values.get("limit");
      if (rawLimit === undefined) return ok({ kind: "clients" });
      const parsed = parsePositiveInt(rawLimit, "limit");
      if (!parsed.ok) return parsed;
      return ok({ kind: "clients", limit: parsed.value });
    }
    case "threads":
      return parseThreads(flags);
    case "search": {
      const term = flags.positionals.slice(1).join(" ");
      if (term === "") return usage("usage: search <term...> [--limit n]");
      const rawLimit = flags.values.get("limit");
      if (rawLimit === undefined) return ok({ kind: "search", term, limit: 10 });
      const parsed = parsePositiveInt(rawLimit, "limit");
      if (!parsed.ok) return parsed;
      return ok({ kind: "search", term, limit: parsed.value });
    }
    case "read": {
      const threadId = flags.positionals[1];
      if (threadId === undefined) return usage("usage: read <threadId> [--full]");
      return ok({ kind: "read", threadId, full: flags.booleans.has("full") });
    }
    case "answer": {
      const threadId = flags.positionals[1];
      if (threadId === undefined) return usage("usage: answer <threadId>");
      return ok({ kind: "answer", threadId });
    }
    case "create": {
      const cwd = flags.positionals[1];
      if (cwd === undefined) return usage("usage: create <cwd>");
      return ok({ kind: "create", cwd });
    }
    case "rename":
      return parseWithText(
        flags,
        (threadId, name) => ok({ kind: "rename", threadId, name }),
        "rename",
      );
    case "archive": {
      const threadId = flags.positionals[1];
      if (threadId === undefined) return usage("usage: archive <threadId>");
      return ok({ kind: "archive", threadId });
    }
    case "msg": {
      const rawTimeout = flags.values.get("timeout");
      let timeoutSecs = 600;
      if (rawTimeout !== undefined) {
        const parsed = parsePositiveInt(rawTimeout, "timeout");
        if (!parsed.ok) return parsed;
        timeoutSecs = parsed.value;
      }
      return parseWithText(
        flags,
        (threadId, text) => {
          const model = flags.values.get("model");
          const effort = flags.values.get("effort");
          return ok({
            kind: "msg",
            threadId,
            text,
            timeoutSecs,
            approve: flags.booleans.has("approve"),
            ...(model !== undefined && { model }),
            ...(effort !== undefined && { effort }),
          });
        },
        "msg",
      );
    }
    case "steer":
      return parseWithText(
        flags,
        (threadId, text) => ok({ kind: "steer", threadId, text }),
        "steer",
      );
    case "interrupt": {
      const threadId = flags.positionals[1];
      if (threadId === undefined) return usage("usage: interrupt <threadId>");
      return ok({ kind: "interrupt", threadId });
    }
    default:
      return usage(`unknown command '${command}'`);
  }
}

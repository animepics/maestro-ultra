#!/usr/bin/env node
// Codex app-server query tool. Runs on Node >= 23.6 (native TS) and Bun.
// Usage: [HOST=<alias|name[:port]|ws://url>] node codex-query.ts <command> [args] [flags]
// Run with no arguments (or `help`) for the command list.
import { spawnSync } from "node:child_process";
import { hostname } from "node:os";
import { parseCliArgs } from "./lib/cli-args.ts";
import { CodexClient } from "./lib/client.ts";
import { runCommand, USAGE } from "./lib/commands.ts";
import { resolveHost, type TokenSource } from "./lib/hosts.ts";
import { assertNever, err, ok, type Result } from "./lib/result.ts";

function readToken(source: TokenSource): Result<string, string> {
  switch (source.kind) {
    case "literal":
      return ok(source.token);
    case "command": {
      const proc = spawnSync("sh", ["-c", source.command], { encoding: "utf8" });
      if (proc.status !== 0) return err(`token command failed: ${proc.stderr.trim()}`);
      return ok(proc.stdout.trim());
    }
    default:
      return assertNever(source);
  }
}

async function main(): Promise<number> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error.message);
    console.error(USAGE);
    return 2;
  }
  if (parsed.value.kind === "help") {
    console.log(USAGE);
    return 0;
  }

  const host = process.env["HOST"];
  const token = process.env["CODEX_WS_TOKEN"];
  const target = resolveHost(
    {
      ...(host !== undefined ? { host } : {}),
      ...(token !== undefined ? { token } : {}),
    },
    hostname(),
  );
  const resolvedToken = readToken(target.tokenSource);
  if (!resolvedToken.ok) {
    console.error(`cannot get token for ${target.name}: ${resolvedToken.error}`);
    return 2;
  }

  const client = await CodexClient.connect(target.url, resolvedToken.value, "codex-query");
  try {
    return await runCommand(client, parsed.value);
  } finally {
    client.close();
  }
}

// no-excuse-ok: catch
main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(String(error));
    process.exit(1);
  });

# Attribution

The transport CLI in this directory (`codex-query.ts` and `lib/`) is vendored from the
**use-codex-appserver** skill — a WebSocket JSON-RPC client for the Codex app-server
(list/create/message/read sessions, steer/interrupt running turns).

Vendored 2026-07-19 so that maestro is self-contained. Upstream fixes should be ported
here; maestro-local changes should stay minimal to keep the diff against upstream small.

## Maestro-local changes vs upstream

- `msg` accepts `--model <id>` and `--effort <level>`, passed through as `turn/start`'s
  `model`/`effort` overrides (protocol v2 `TurnStartParams`) so the conductor can pick
  the model per work unit. (`lib/cli-args.ts`, `lib/turn-commands.ts`, tests in
  `lib/cli-args.test.ts`.)
- `models` command: wraps the `model/list` RPC and prints the raw JSON response
  (no vendored schema yet — same schema-less precedent as `status`), so the conductor
  can discover the live model roster for per-unit routing. (`lib/cli-args.ts`,
  `lib/commands.ts`, test in `lib/cli-args.test.ts`.)
- `workflows [--watch] [--cwd path]` command: read-only codex-side progress table that
  reuses `thread/list` (active) + `thread/read` and merges `.maestro/state.json` units
  (no new RPCs or deps). `--watch` is the transport's first long-lived command — on a TTY
  it drives a refresh loop with SIGINT clean-exit; non-TTY degrades to one-shot. Header
  fixed to "codex-side view only" since the transport cannot see Claude subagents.
  (`lib/cli-args.ts`, `lib/commands.ts`, `lib/format.ts`, tests in `lib/cli-args.test.ts`
  and `lib/format.test.ts`.)

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

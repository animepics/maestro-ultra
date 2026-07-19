# Attribution

The transport CLI in this directory (`codex-query.ts` and `lib/`) is vendored from the
**use-codex-appserver** skill — a WebSocket JSON-RPC client for the Codex app-server
(list/create/message/read sessions, steer/interrupt running turns).

Vendored 2026-07-19 so that maestro is self-contained. Upstream fixes should be ported
here; maestro-local changes should stay minimal to keep the diff against upstream small.

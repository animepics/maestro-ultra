# Changelog

## 0.1.0 — 2026-07-19

Initial release.

- `/maestro` skill: Claude conducts Codex sessions end-to-end — analyze & split with acceptance criteria, dispatch via codex app-server (WebSocket JSON-RPC), observe/steer, evidence-based verification (`git diff` vs baseline + build/tests), rework loop (≤3 rounds) with escalation.
- Parallel execution with per-unit git worktree + `maestro/<slug>` branch isolation; deterministic merge and cleanup.
- Session state persisted to `.maestro/state.json` in the target repo; resume/reattach after interruption.
- Vendored transport CLI (`scripts/codex-query.ts`, from the use-codex-appserver skill) — the repo is self-contained.
- Embedded Codex prompting guide (`skills/maestro/references/prompting-codex.md`) with the required Goal/Do/Don't/Expected/Test shape and real examples.
- `install.sh`, MIT license, `AGENTS.md` (Codex-side protocol), troubleshooting for the stale app-server `systemError` failure mode.
- Verified against real Codex sessions: single-unit, parallel-isolation, and rework/escalation smoke tests.

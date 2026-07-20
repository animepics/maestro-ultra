# Changelog

## 0.2.0 — 2026-07-20

Model auto-routing + Fable-style reasoning injection.

- New transport command `models`: wraps the app-server `model/list` RPC and prints the raw roster (id, display name, descriptions, supported reasoning efforts, default flags). Schema-less by design until the upstream shape stabilizes.
- Phase 1 full-auto routing: maestro discovers every model the codex user has and routes each work unit itself — gpt-5.6-family as the workhorse while present on the roster, light/fast models only for clearly mechanical units, upshift only for genuinely hard units. Choice + reasoning always reported; roster fetch failure degrades gracefully to effort-only guidance.
- Phase 2 `## Read first` injection: non-trivial dispatches point the session at the ultraprompt strategy skills (axis mapping table, cap 3, `verification-discipline` always) so sub-frontier models reason like the stronger model. Mechanical per-axis path probe with maestro-repo fallback; steer-once compliance nudge.
- Eight strategy skills merged from [ultraprompt](https://github.com/rlaope/ultraprompt) (0.1.x addendum, now first-class).
- README: hero art, badges, GitHub alert callouts, maintainers.

## 0.1.0 — 2026-07-19

Initial release.

- `/maestro` skill: Claude conducts Codex sessions end-to-end — analyze & split with acceptance criteria, dispatch via codex app-server (WebSocket JSON-RPC), observe/steer, evidence-based verification (`git diff` vs baseline + build/tests), rework loop (≤3 rounds) with escalation.
- Parallel execution with per-unit git worktree + `maestro/<slug>` branch isolation; deterministic merge and cleanup.
- Session state persisted to `.maestro/state.json` in the target repo; resume/reattach after interruption.
- Vendored transport CLI (`scripts/codex-query.ts`, from the use-codex-appserver skill) — the repo is self-contained.
- Embedded Codex prompting guide (`skills/maestro/references/prompting-codex.md`) with the required Goal/Do/Don't/Expected/Test shape and real examples.
- `install.sh`, MIT license, `AGENTS.md` (Codex-side protocol), troubleshooting for the stale app-server `systemError` failure mode.
- Verified against real Codex sessions: single-unit, parallel-isolation, and rework/escalation smoke tests.

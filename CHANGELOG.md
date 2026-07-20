# Changelog

## 0.3.0 — 2026-07-20

Dispatch-quality gate, outcome ledger, and autonomous rework governance.

- Phase 1 **criteria-quality gate**: every derived criterion is checked as testable / falsifiable / disjoint-scoped / failure-mode-aware and rewritten if it fails; granularity scales with the routed model. Binds to the right-size-the-ceremony step (skipped on the cheap path).
- **Spec echo-back** before dispatch on ambiguous/multi-part tasks (AskUserQuestion where available); autonomous runs log assumptions and proceed instead of deadlocking.
- **Outcome ledger** `.maestro/metrics.jsonl`: append-only, one line per verified unit (model, effort, criteria count, first-attempt pass, rework rounds, `resolvedBy`), pinned to the main repo even from worktree cwds. Durable and never deleted (only ephemeral `state.json` is), same-machine local, node reader for the first-attempt-pass rate.
- **Clause A — Fable-takeover terminal breaker**: on an autonomous run that exhausts the ≤3 rework budget, one Claude attempt fires only under four strict gates (round-3 exhausted, autonomy signal present, independent oracle exists, healthy state); Fable never edits test files; no oracle → terminal abort with the branch preserved.
- **Quota-exhaustion handover**: when Codex quota runs out mid-run, the conductor commits partial work and lets Claude finish the unit in the same worktree/branch against the same criteria — offered interactively, gated autonomously (dependents parked, degraded units surfaced at run end when no independent oracle). Distinct from Clause A: a performer-swap with no failure history, not a loop-breaker.
- **maestro-workflows**: on-demand combined status table of all live performers (Codex threads + the conductor's own background work); new codex-side `workflows [--watch]` transport subcommand renders the same table live (Codex threads only) — the transport's first long-lived command.
- Four new draft strategy axes (state-probing, honest-reporting, delegation-parallelism, context-memory-hygiene) with `CASES.md` skeletons, plus `skills/_SIMULATION.md` (the distillation protocol) — all `v0.1 baseline draft` awaiting trace evidence. Skills are authored here and mirrored upstream to ultraprompt.
- ultraprompt gains a one-line `install.sh` and a 3-box README (upstream repo, tracked separately).

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

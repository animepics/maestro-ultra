# maestro-ultra

**Claude conducts. Codex performs. And every agent learns to reason like the stronger model.**

Two things live here, built to work together:

1. **`/maestro`** — an orchestration harness for people who run both Claude Code and the Codex CLI. One invocation has Claude analyze the task, write testable acceptance criteria, dispatch the implementation to real Codex sessions over the app-server protocol, watch them run, and verify the results against hard evidence before anything merges.
2. **Eight strategy skills** (merged from [ultraprompt](https://github.com/rlaope/ultraprompt)) — portable reasoning prompts distilled from how a frontier model (Claude Fable 5) actually solves problems, written to make any sub-frontier agent — Opus, a Codex session, anything that reads a system prompt — explore, verify, and self-correct the way the stronger model does.

The philosophy is a strict division of labor: **Claude is the conductor** (planning, splitting, judgment, verification); **Codex is the performer** (implementation labor). A session's final answer is treated as a claim — the only evidence maestro accepts is `git diff` against a recorded baseline plus passing builds/tests.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/animepics/maestro-ultra/main/install.sh | sh
```

Or just tell your coding agent:

```text
hey, install this: https://github.com/animepics/maestro-ultra
```

Clones to `~/.maestro` (override with `MAESTRO_DIR`), installs the transport's npm dependencies, and symlinks the skill into `~/.claude/skills/`. From a local checkout, `./install.sh` does the same without cloning. Then, in Claude Code:

```
/maestro "implement a slugify utility with full test coverage"
```

See [Prerequisites](#prerequisites) for what must be running first — the skill's preflight checks it all and tells you exactly what's missing.

## Architecture

How Claude hooks the Codex app-server:

```text
┌─ Claude Code (conductor) ─────────────┐            ┌─ codex app-server ────────────────┐
│  /maestro "task"                      │            │  ws://127.0.0.1:18789             │
│                                       │  WebSocket │                                   │
│  1 ANALYZE   task → units + criteria  │  JSON-RPC  │   ┌─ session (thread) ─────────┐  │
│  2 DISPATCH  msg --approve            │            │   │  GPT-5.x                   │  │
│      --model … --effort …  ───────────┼─ turn/start ──▶│  cwd = repo or worktree    │  │
│  3 OBSERVE   active / read  ◀─────────┼─ events ───────│  edits files, runs tests   │  │
│      steer (mid-turn) / interrupt ────┼─ steer ────────▶                            │  │
│  4 VERIFY    git diff <baseline>      │            │   └────────────────────────────┘  │
│      + build/tests   (answer ≠ proof) │            │         … up to 4 in parallel     │
│  5 REWORK    defect list → same       │            └───────────────┬───────────────────┘
│      thread (≤3) → merge or escalate  │                            │ executes in
└───────────────────┬───────────────────┘                            ▼
                    │ transport: scripts/codex-query.ts   ┌─ target git repo ────────────┐
                    │ (vendored, WebSocket JSON-RPC)      │  baseline SHA captured first │
                    └─────────────────────────────────────│  one worktree + maestro/<x>  │
                                                          │  branch per parallel unit    │
                                                          │  .maestro/state.json resume  │
                                                          └──────────────────────────────┘
```

Key mechanics, pinned as verbatim command templates in the skill (so they're identical on every run):

- **Baseline first** — `git rev-parse HEAD` is recorded before any dispatch; review scope is exactly `diff <baseline>`.
- **Parallel isolation** — each concurrent unit gets its own `git worktree` on a fresh `maestro/<slug>` branch (hard cap: 4). Merges happen in dispatch order; the first conflict stops and surfaces to you.
- **Non-blocking dispatch** — `msg` runs in the background so Claude can observe, steer a drifting session mid-turn, or interrupt a runaway one.
- **Crash-safe** — thread ids, baselines, and worktrees persist to `.maestro/state.json`; an interrupted run reattaches instead of orphaning sessions.

## Benchmark: maestro vs codex alone

A controlled head-to-head, run July 2026: the **same task text** given to a bare `codex exec` and to `/maestro`, same model, then both outputs blind-scored against a **hidden test suite written before either run** (the standard HumanEval-style method). One clearly-specified task (LRU cache with TTL) and one deliberately vague one (debounce with lodash semantics).

![Same task, same model — with and without the conductor](docs/assets/benchmark-cost.svg)

> **Takeaway:** on the vague task, codex alone took **7.2 min and 74.5k tokens** finding the semantics by trial and error; maestro finished in **1.3 min and 31.6k tokens** because the conductor pinned the spec before dispatch. On the clear task the roles reverse (~45% harness overhead) — which is why the skill's Phase 1 tells you when a task is small enough to skip the ceremony.

![Correctness, scored the HumanEval way](docs/assets/benchmark-quality.svg)

> **Takeaway:** correctness tied at 100% (22/22 hidden tests each) — the difference isn't whether the code works, it's that maestro's result arrives **already verified** against diff + tests, at a fraction of the cost precisely when the spec is fuzzy.

What the QA runs also exercised, end to end:

| Path | Result |
|---|---|
| Acceptance-criteria verification | 26/26 tests green across merged units; every criterion checked against diff + test evidence |
| Rework loop | A deliberately failing unit was reworked in 1 round after a concrete-defect message to the same thread |
| Clarifying-question protocol | An underspecified unit stopped with one concrete question (empty diff) instead of guessing — no rework round consumed |
| Mid-turn steering | A constraint added via `steer` while the turn ran was fully incorporated in the final code |
| Honest-performer behavior | When the environment (not the code) broke a test command, the session reported the blocker precisely rather than hacking around it — and diff-based verification caught it independently |

## Why maestro (comparison)

| | `/maestro` | raw `codex exec` | manual session juggling |
|---|---|---|---|
| Acceptance criteria per dispatch | enforced, embedded verbatim | your discipline | your discipline |
| Verification | `git diff` vs baseline + build/tests, per criterion | trust the printed output | manual |
| Parallel work | worktree-isolated branches, capped, ordered merge | one-shot | tmux + memory |
| Mid-turn correction | `steer` / `interrupt` | not possible | possible, manual |
| Rework on failure | automatic, defect-named, ≤3 rounds, then escalation | re-run and re-explain | manual |
| Crash recovery | `.maestro/state.json` resume | n/a | state in your head |
| Model/effort per unit | chosen by Claude per difficulty (`--model`, `--effort`) | flags, chosen by you | chosen by you |
| Overengineering control | minimalism rule in every prompt + checked at review | — | — |

## Prerequisites

- [Codex CLI](https://github.com/openai/codex) with app-server support, running as `codex app-server`, and **signed in** (`codex login` — requires a ChatGPT account with an eligible plan: Plus/Pro/Team/Enterprise)
- Node with TypeScript type-stripping (≥ 23.6 guaranteed; 22.18+ typically works) or Bun
- Target projects must be git repositories (verification is diff-based)
- v1 scope: local same-machine only; sandbox policy uses the app-server default

The skill's preflight checks all of this before any dispatch and tells you exactly what's missing — including when you're not logged in to Codex.

Then, in Claude Code:

```
/maestro "implement a slugify utility with full test coverage"
```

## Example run (real transcript, condensed)

```text
Phase 1  1 unit, single session — criteria: file exists, exact bytes, nothing else touched
Phase 2  baseline 718ce99 recorded → create session → msg --approve --effort low (background)
Phase 3  observing… turn completed
Phase 4  answer claims success → evidence: git diff shows only the target file;
         od -c confirms exact bytes → 3/3 criteria PASS
```

Parallel, two units:

```text
Phase 2  worktree add -b maestro/unit-a …  (same for unit-b) → two sessions concurrently
Phase 4  unit-b finishes first → verified while unit-a still runs; per-unit diffs attribute cleanly
Cleanup  merge in dispatch order → worktrees & branches removed, no leaks
```

## Strategy skills — reasoning like the stronger model

Merged from [ultraprompt](https://github.com/rlaope/ultraprompt): eight axis-sliced skills distilled from Fable 5 reasoning traces. They encode *strategy, not domain* — the same trade-off articulation pattern shows up in a kanban board and an LSM-tree, so it's captured once and transfers anywhere. Each is a standalone `SKILL.md` prompt with router-ready trigger lines, threshold heuristics, and anti-patterns; `install.sh` links them all.

| Skill | What it encodes |
|---|---|
| [exploration-strategy](skills/exploration-strategy/SKILL.md) | The order in which to build a mental model before touching anything |
| [hypothesis-management](skills/hypothesis-management/SKILL.md) | How many competing explanations to keep alive, and what evidence retires one |
| [verification-discipline](skills/verification-discipline/SKILL.md) | What counts as proof of "done" — execution, not inspection |
| [tradeoff-articulation](skills/tradeoff-articulation/SKILL.md) | Quantifying alternatives and stating the decision's cost out loud |
| [failure-mode-enumeration](skills/failure-mode-enumeration/SKILL.md) | Listing edge cases before implementation, not after the bug report |
| [self-correction-loop](skills/self-correction-loop/SKILL.md) | When to abandon an approach, and how to change course without thrashing |
| [spec-to-code-fidelity](skills/spec-to-code-fidelity/SKILL.md) | Cross-checking habits when translating an RFC, paper, or formula into code |
| [incremental-safety](skills/incremental-safety/SKILL.md) | Splitting a large change into states that are each safe to stop at |

They compose with the conductor: maestro's criteria derivation is `failure-mode-enumeration` applied before dispatch, its evidence rules are `verification-discipline`, and a Codex session that reads them (via `AGENTS.md` or a pasted skill) performs closer to how the conductor thinks.

## For Codex sessions

[`AGENTS.md`](AGENTS.md) documents the contract from the performer's side: criteria are the spec, diffs are the evidence, commit-on-branch for parallel units, ask one concrete question instead of guessing. The [strategy skills](#strategy-skills--reasoning-like-the-stronger-model) above are written to be readable by Codex sessions too — `verification-discipline` and `failure-mode-enumeration` are the two that pay off first.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Short version: `cd scripts && npm run check` must stay green (biome + tsc + tests), the vendored transport keeps a minimal diff vs upstream (`scripts/ATTRIBUTION.md`), and skill changes need a real dispatched-session check.

## Roadmap

- **Remote `HOST=` targets** — the transport already speaks to remote app-servers; verification needs a remote-diff story (`git bundle` or SSH-side execution)
- **Per-task sandbox policy** — wrap the raw `config/value/write` RPC
- **Minimal orchestration helper** — extract deterministic mechanics into code *only if* the verbatim prose templates prove insufficient in practice
- **Rework-rate metrics** — criteria-pass-on-first-attempt tracking across runs

## License

[MIT](LICENSE)

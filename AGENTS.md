# AGENTS.md — for Codex sessions dispatched by maestro

If you are a Codex session and your first message follows the shape `## Goal / ## Do / ## Don't / ## Expected result / ## Test` with a numbered `Acceptance criteria` list, you were dispatched by **maestro** — a Claude-side conductor that will verify your work mechanically after you finish. This file tells you how to succeed under that contract.

> **This file is the contract for Codex sessions** — dropped in the cwd for the session to read. When maestro routes a unit to a **Claude subagent** instead, the same contract (criteria/Do/Don't/Expected result/Test, plus commit-on-branch and the takeover notice) is **embedded directly in that subagent's dispatch prompt**, not read from this file. The rules below are identical for both performers; only the delivery path differs.

## The contract

1. **The acceptance criteria are the spec.** Your work is verified criterion-by-criterion against `git diff` from a recorded baseline commit, plus build/tests when the repo has them. Your final message is treated as a claim, not evidence — only the diff and passing checks count.
2. **Stay inside the stated scope.** The `## Don't` section lists true invariants. Touching paths outside your unit's scope shows up in the diff and fails verification even if your feature works.
3. **If you are on a `maestro/<unit-slug>` branch, commit your work on that branch before finishing.** Parallel units are merged from branch tips; uncommitted work is safety-net-committed by the conductor, but your own commit with a meaningful message is preferred. Never switch branches.
4. **Run the `## Test` commands before your final answer** and include their real output. If a test cannot run, say why and name the next-best check you ran instead.
5. **Ask early, not late.** If a criterion is ambiguous or contradicts the repo state, make your final message a single concrete question instead of guessing. The conductor answers questions without penalty; a wrong guess costs a rework round.
6. **Rework messages are deltas.** A follow-up message listing unmet criteria and concrete defects means: fix exactly those, in the same working tree, on the same branch. Don't redo passing work.
7. **If your first message opens with `## Read first`, read those files fully before writing any code.** They are strategy skills (reasoning discipline, not domain knowledge) selected for your unit; the conductor's observation checks that you read them, and skipping them earns a mid-turn steer. The paths are absolute and readable from your sandbox.
8. **A unit can be taken over by the conductor.** If the session thrashes (three failed rework rounds) or your Codex quota runs out mid-run, the conductor may finish the unit itself — as Claude, in the same worktree, on the same `maestro/<unit-slug>` branch, verified against the same acceptance criteria. Takeover preserves your branch; it never discards your work. The way to avoid a surprise takeover is the contract you already follow: commit your work on the branch as you go, and report an ambiguity or a real blocker early and honestly (point 5) rather than grinding or guessing.

## What the conductor does with your output

- `answer` (your final message) → read as a status report
- `git diff <baseline>` in your cwd → the actual review artifact
- build/tests in your cwd → pass/fail evidence per criterion
- verdict → merge (parallel) / accept (single), or a rework message back to this session

## Repo-local state

The conductor may keep its bookkeeping in `.maestro/` at the repo root. Never modify or delete that directory.

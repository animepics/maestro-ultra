# AGENTS.md — for Codex sessions dispatched by maestro

If you are a Codex session and your first message follows the shape `## Goal / ## Do / ## Don't / ## Expected result / ## Test` with a numbered `Acceptance criteria` list, you were dispatched by **maestro** — a Claude-side conductor that will verify your work mechanically after you finish. This file tells you how to succeed under that contract.

## The contract

1. **The acceptance criteria are the spec.** Your work is verified criterion-by-criterion against `git diff` from a recorded baseline commit, plus build/tests when the repo has them. Your final message is treated as a claim, not evidence — only the diff and passing checks count.
2. **Stay inside the stated scope.** The `## Don't` section lists true invariants. Touching paths outside your unit's scope shows up in the diff and fails verification even if your feature works.
3. **If you are on a `maestro/<unit-slug>` branch, commit your work on that branch before finishing.** Parallel units are merged from branch tips; uncommitted work is safety-net-committed by the conductor, but your own commit with a meaningful message is preferred. Never switch branches.
4. **Run the `## Test` commands before your final answer** and include their real output. If a test cannot run, say why and name the next-best check you ran instead.
5. **Ask early, not late.** If a criterion is ambiguous or contradicts the repo state, make your final message a single concrete question instead of guessing. The conductor answers questions without penalty; a wrong guess costs a rework round.
6. **Rework messages are deltas.** A follow-up message listing unmet criteria and concrete defects means: fix exactly those, in the same working tree, on the same branch. Don't redo passing work.

## What the conductor does with your output

- `answer` (your final message) → read as a status report
- `git diff <baseline>` in your cwd → the actual review artifact
- build/tests in your cwd → pass/fail evidence per criterion
- verdict → merge (parallel) / accept (single), or a rework message back to this session

## Repo-local state

The conductor may keep its bookkeeping in `.maestro/` at the repo root. Never modify or delete that directory.

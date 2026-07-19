---
name: maestro
description: "Claude Maestro — Claude conducts Codex: analyzes a task, writes acceptance criteria, decides single vs N parallel Codex sessions, dispatches via codex app-server, observes progress, verifies results with diff review + build/tests, and drives a rework loop (≤3 rounds) before escalating. Triggers: 'maestro', 'conduct codex', 'dispatch to codex', 'codex로 처리'."
---

# maestro

Claude is the conductor (planning, judgment, verification); Codex is the performer (implementation labor). One invocation — `/maestro "task description"` — runs the full loop: analyze → dispatch → observe → verify → rework/escalate.

**Judgment vs mechanics.** Steps marked *(judgment)* are yours to reason about. Steps marked *(mechanics)* are exact command templates: run them **verbatim** (filling `<placeholders>` only). Do not re-derive, reorder, or "improve" them — they encode correctness constraints (baseline attribution, worktree isolation, non-blocking dispatch) that prose reasoning gets intermittently wrong.

## Scope (v1)

- **Local same-machine only.** Diff/build/test verification requires Codex's cwd on the same host as Claude. Remote `HOST=` app-servers are out of scope.
- **Server-default sandbox/model.** The transport's `create <cwd>` exposes no sandbox/model flags; sessions use the app-server's default config.
- **Target cwd must be a git repository** — verification is diff-based.

## Prerequisites & Preflight *(mechanics — run ALL before any dispatch; on any failure STOP and report the fix, do not dispatch)*

```bash
# 1. Resolve transport (first path that exists):
SCRIPT=~/.claude/skills/use-codex-appserver/scripts/codex-query.ts
[ -f "$SCRIPT" ] || SCRIPT=~/.agents/skills/use-codex-appserver/scripts/codex-query.ts
# missing → instruct: install the use-codex-appserver skill

# 2. Transport deps installed:
[ -d "$(dirname $SCRIPT)/node_modules" ]   # missing → instruct: npm install in scripts/

# 3. Runtimes:
command -v codex                            # missing → instruct: install Codex CLI

# 4. App-server reachable — this is the authoritative runtime check:
node $SCRIPT status                         # syntax/type error → Node too old for TS type stripping: upgrade (≥23.6 guaranteed; 22.18+ typically works)
                                            # connection error → instruct: start codex app-server

# 5. Each target cwd is a git repo:
git -C <cwd> rev-parse --git-dir

# 6. Stale-state pre-clean (crash recovery; parallel runs only):
git -C <repo> worktree prune
git -C <repo> branch -D maestro/<unit-slug> 2>/dev/null || true   # per planned slug
```

## Phase 1 — Analyze & Split *(judgment)*

1. Restate the task. Derive **testable acceptance criteria** per work unit — never dispatch a bare task prompt.
2. Decide **single session vs N parallel sessions**. Parallel ONLY when all three hold:
   - units are independent (no ordering dependency), AND
   - units touch **disjoint directories** (not merely disjoint files — a shared git index, lockfiles, and build artifacts break attribution), AND
   - each unit is individually meaningful.
   Otherwise run single-session.
3. **Report the decision and reasoning to the user before dispatching.**

## Phase 2 — Dispatch *(mechanics + judgment)*

**Baseline capture — in the repo, BEFORE any worktree creation** *(mechanics)*:

```bash
git -C <repo> rev-parse HEAD          # record as <baseline>
git -C <repo> status --porcelain      # non-empty → warn user: pre-existing changes are excluded from review (diff is vs <baseline> only)
```

**Parallel isolation** *(mechanics — N>1 units only)*: one isolated worktree + fresh branch per unit, created at baseline:

```bash
git -C <repo> worktree add -b maestro/<unit-slug> <repo>-maestro-<unit-slug> <baseline>
node $SCRIPT create <worktree-path>
```

Two parallel sessions MUST NOT share a cwd. Single unit: `node $SCRIPT create <cwd>` directly — no worktree, no branch.

**Prompt composition** *(judgment)*: READ `use-codex-appserver/references/prompting-codex.md` and follow its required shape — Goal / Do / Don't / Expected result / Test — **in English**, with the unit's acceptance criteria embedded verbatim. For parallel units, the Expected result MUST include: *"commit all your work on the current branch (`maestro/<unit-slug>`)"* — merge and cleanup operate on the branch tip.

**Send — non-blocking** *(mechanics)*:

```bash
node $SCRIPT msg <threadId> "<prompt>" --approve --timeout <fit-to-task-size>   # via run_in_background
```

- `run_in_background` is required: `msg` blocks synchronously until the turn completes, which would make observation/steering impossible and serialize parallel dispatch.
- `--approve` is required: without it, file-change AND command-execution approvals are auto-declined and the session stalls writing nothing.

## Phase 3 — Observe *(mechanics + judgment)*

While background `msg` runs: poll `node $SCRIPT active` and `node $SCRIPT read <threadId>`; summarize progress for the user. `steer <threadId> "<corrective delta>"` when a session drifts from its criteria *(judgment)*; `interrupt <threadId>` for runaway turns. On msg timeout the turn continues server-side: keep polling `read` — never re-`msg` blindly.

*(Note: steer/read open separate connections while the background msg holds one; multiple clients are supported, but same-thread steer-during-background-msg is unverified — if steer errors, fall back to interrupt + a rework msg.)*

## Phase 4 — Verify *(mechanics templates + judgment review)* — per unit, as each completes

`node $SCRIPT answer <threadId>` is the session's **self-report — a claim, never evidence.** Verification is only:

```bash
git -C <unit-cwd> diff <baseline>     # the actual changes (captures committed AND uncommitted work)
# + run build/tests in <unit-cwd> when the target repo has them
```

Review the diff against **each** acceptance criterion *(judgment)*. Produce a per-unit **Verification Report**: criterion → pass/fail → evidence (diff hunk / test output).

## Phase 5 — Rework loop *(judgment)*

On failure: `msg` the SAME thread (same `--approve`/background mechanics) with the concrete defect list and unmet criteria — **≤3 rounds total**. After round 3: escalate to the user with per-criterion status, diff summary, and a recommended next action.

## Cleanup *(mechanics — parallel runs only)* — per accepted unit, after verification

```bash
# 1. Pin commit state (safety net if Codex didn't commit despite the prompt):
[ -n "$(git -C <worktree> status --porcelain)" ] && git -C <worktree> add -A && git -C <worktree> commit -m "maestro: <unit-slug>"

# 2. Merge (per user instruction; conflicts are surfaced to the user, never auto-resolved):
git -C <repo> merge maestro/<unit-slug>

# 3. Remove (prevents leaked worktrees/branches):
git -C <repo> worktree remove --force <repo>-maestro-<unit-slug>
git -C <repo> branch -D maestro/<unit-slug>
```

Rejected units: report the diff before removal, never silently discard; then the same remove commands.

## Troubleshooting

- **Turn "completes" instantly but `answer` finds no agent message**, and `read <threadId>` shows `Status: systemError` with only the user message in the turn → the app-server process is stale (observed after ~2 weeks uptime). Fix: restart it with its original arguments (`ps aux | grep 'codex app-server'` shows the command line; `kill <pid>` then relaunch detached), re-create the session, re-dispatch. Verify the model path separately with `codex exec "Reply: pong"` if unsure.
- `status` returning `"disabled"` refers to remote-control pairing — it does **not** block turn execution; don't chase it.
- Byte-exact content checks: use `od -c <file>` (macOS BSD `cat` has no `-A` flag).

## Final report

Dispatch decision + reasoning · per-unit Verification Reports · overall verdict (done / escalated with recommended next action).

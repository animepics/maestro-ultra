---
name: maestro
description: "Claude Maestro — Claude conducts Codex: analyzes a task, writes acceptance criteria, decides single vs N parallel Codex sessions, auto-routes models, dispatches via codex app-server, observes progress, verifies results with diff review + build/tests, and drives a rework loop (≤3 rounds) before escalating. Use this WHENEVER the user wants implementation work done by Codex/GPT sessions — no explicit /maestro needed. Triggers include: 'maestro', any ask to delegate/hand off coding to codex ('have codex do this', 'let codex implement', 'send this to codex', 'ask codex to fix'), Korean phrasings ('codex로 처리', 'codex한테 시켜', '코덱스로 해줘', '코덱스에게 맡겨'), or requests to run/steer/verify Codex sessions. Even when the user does NOT mention codex: for a substantial implementation task (feature + tests, multi-file change, parallelizable work), OFFER maestro with a quick yes/no question before proceeding — see 'Offering maestro' in the skill body."
---

# maestro

Claude is the conductor (planning, judgment, verification); Codex is the performer (implementation labor). This skill activates on any natural ask to hand work to Codex ("have codex do this", "codex한테 시켜") as well as explicit `/maestro "task description"` — either way it runs the full loop: analyze → dispatch → observe → verify → rework/escalate.

## Offering maestro (HITL — when the user didn't say "codex")

If the user asks for substantial implementation work without mentioning Codex, don't silently take over and don't silently dispatch — **offer**. Use a structured yes/no question (AskUserQuestion where available; plain question otherwise):

> This looks like a good fit for maestro — I'd conduct Codex sessions to implement it and verify the result against diff + tests. Hand it to Codex, or should I do it directly?
> **[Codex via maestro (recommended)]** / **[Do it directly]**

Rules *(judgment)*:
- Offer ONLY for substantial work: a feature with tests, a multi-file change, or independently parallelizable units. Never for trivial edits, questions, reviews, or debugging-by-conversation — just do those.
- Offer at most ONCE per task; a "no" holds for the rest of the session unless the user brings Codex up themselves.
- Recommend the option you actually believe fits (per the Phase 1 right-size rule — if the cheap path is better, say so in the offer).
- On "yes", proceed with the full loop below; on "no", work normally and never mention it again.

**Judgment vs mechanics.** Steps marked *(judgment)* are yours to reason about. Steps marked *(mechanics)* are exact command templates: run them **verbatim** (filling `<placeholders>` only). Do not re-derive, reorder, or "improve" them — they encode correctness constraints (baseline attribution, worktree isolation, non-blocking dispatch) that prose reasoning gets intermittently wrong.

## Scope (v1)

- **Local same-machine only.** Diff/build/test verification requires Codex's cwd on the same host as Claude. Remote `HOST=` app-servers are out of scope.
- **Server-default sandbox.** Sandbox policy uses the app-server's default config. (Model and reasoning effort ARE selectable per unit — see Phase 1.)
- **Injected skill paths must be readable from the session's sandbox.** The `## Read first` injection (Phase 2) points sessions at files outside their cwd (`~/.claude/skills/...`); the app-server default sandbox permits out-of-cwd reads (verified live 2026-07-20). The Phase 3 read-compliance observation is the gate on nonstandard configs.
- **Target cwd must be a git repository** — verification is diff-based.

## Prerequisites & Preflight *(mechanics — run ALL before any dispatch; on any failure STOP and report the fix, do not dispatch. Sole exception: step 4.5 is non-fatal)*

```bash
# 1. Resolve transport (first path that exists — vendored copy first):
SCRIPT=<this-skill-dir>/../../scripts/codex-query.ts        # vendored in the maestro repo
[ -f "$SCRIPT" ] || SCRIPT=~/.claude/skills/use-codex-appserver/scripts/codex-query.ts
[ -f "$SCRIPT" ] || SCRIPT=~/.agents/skills/use-codex-appserver/scripts/codex-query.ts
# missing → instruct: run install.sh from the maestro repo

# 2. Transport deps installed:
[ -d "$(dirname $SCRIPT)/node_modules" ]   # missing → instruct: npm install in scripts/

# 3. Runtimes:
command -v codex                            # missing → instruct: install Codex CLI

# 3.5 Codex auth — exit 1 ("Not logged in") → STOP and tell the user exactly this:
codex login status                          #   "Run `codex login` first. Codex requires a ChatGPT account
                                            #    with an eligible plan (Plus/Pro/Team/Enterprise) — if you
                                            #    don't have one, subscribe before using maestro."

# 4. App-server reachable — this is the authoritative runtime check:
node $SCRIPT status                         # syntax/type error → Node too old for TS type stripping: upgrade (≥23.6 guaranteed; 22.18+ typically works)
                                            # connection error → instruct: start codex app-server

# 4.5 Model roster (OPTIONAL — the only non-fatal step; failure just disables routing):
node $SCRIPT models                         # non-zero exit → note "roster unavailable, effort-only fallback engaged" and continue

# 5. Each target cwd is a git repo:
git -C <cwd> rev-parse --git-dir

# 6. Stale-state pre-clean (crash recovery; parallel runs only):
git -C <repo> worktree prune
git -C <repo> branch -D maestro/<unit-slug> 2>/dev/null || true   # per planned slug
```

## Phase 0 — Resume check *(mechanics)*

If `<target-repo>/.maestro/state.json` exists, a previous maestro run was interrupted (or is still live). Do NOT start fresh:
1. Read it: thread ids, baseline, unit slugs/worktrees, criteria, phase reached.
2. For each recorded thread: `read <threadId>` — a running turn → rejoin at Phase 3 (observe); a finished turn → rejoin at Phase 4 (verify).
3. `git -C <repo> worktree list` — worktrees recorded in state but with no live purpose (verification done or thread dead) are orphans: report them, then clean up per the Cleanup section.
4. Only after reporting resume status to the user, continue the loop from the phase each unit is actually in. If state is stale/corrupt, say so and offer fresh start (which archives the old file to `.maestro/state.json.bak`).

## Phase 1 — Analyze & Split *(judgment)*

0. **Right-size the ceremony.** Benchmarked honestly: on a small, fully-specified, single-file task, the harness adds ~40–50% time/token overhead over a bare `codex exec` with no quality gain — its spec-expansion pays off on ambiguous or multi-part tasks (measured 5.5× faster, 2.4× cheaper there). So: for a trivial well-specified one-liner-ish task, say so and offer the user the cheap path (direct edit or bare dispatch with terse criteria, `--effort low`); reserve full ceremony (elaborate criteria, observation cadence, parallel machinery) for tasks with ambiguity, edge cases, or multiple units.
1. Restate the task. Derive **testable acceptance criteria** per work unit — never dispatch a bare task prompt.
2. Decide **single session vs N parallel sessions**. **Hard cap: 4 concurrent sessions** — more units than that queue behind the first wave. Parallel ONLY when all three hold:
   - units are independent (no ordering dependency), AND
   - units touch **disjoint directories** (not merely disjoint files — a shared git index, lockfiles, and build artifacts break attribution), AND
   - each unit is individually meaningful.
   Otherwise run single-session.
3. **Model & effort per unit — full-auto routing** *(judgment)*: route each unit across the live roster fetched in preflight 4.5 (`node $SCRIPT models`; per-model fields: `id`, `displayName`, `description`, `isDefault`, `hidden`, `supportedReasoningEfforts` with per-effort descriptions, `defaultReasoningEffort`). Pass choices via `msg --model <id> --effort <level>`.
   - **Workhorse rule**: the gpt-5.6 family resolves most needs — route to it by default while it is on the roster. Prefer the roster's `isDefault: true` entry for standard/hard units; the family's fast/affordable tier (read `description`) covers lighter standard work. If no 5.6-family model is present, anchor on whatever entry is `isDefault` — never hard-fail on a missing literal name.
   - **Downshift** to a light model (`description` says fast/affordable/ultra-fast; name says mini/nano/spark) ONLY for clearly mechanical units (rename, boilerplate, single small function).
   - **Upshift** past the workhorse only when the roster offers something genuinely stronger AND the unit is genuinely hard (debugging, tricky algorithms, cross-cutting refactors).
   - **Effort**: scale within the chosen model's `supportedReasoningEfforts` — mechanical → `low`; standard → the model's `defaultReasoningEffort` (or omit the flag); hard → `high` or above.
   - **Unknown model names**: infer tier from `description` plus name heuristics (mini/nano/spark → light; higher version number → newer; codex-variants preferred for code). Still uncertain → the workhorse, or omit `--model` (server default).
   - **Fallback**: `models` failed in preflight → omit `--model` entirely and use effort-only guidance: mechanical `--effort low`, standard `--effort medium` (or omit), hard `--effort high`.
   - **Report**: state per unit, in the dispatch report, the chosen (model, effort, injected skills — Phase 2) and one line of reasoning. Never route silently.
4. **Anti-overengineering is part of every dispatch** *(judgment)*: every prompt's Do section MUST include a minimalism decision rule (e.g., "implement the smallest standard-library solution that satisfies the criteria; no new dependencies, no speculative abstractions, no features beyond the criteria"), and Phase 4 review MUST check the diff for overengineering (unrequested features, needless layers/config, premature generalization) — overengineered-but-working output is a verification FAIL with a rework instruction to simplify.
5. **Report the decision and reasoning to the user before dispatching.**

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

**Prompt composition** *(judgment)*: READ `references/prompting-codex.md` (in this skill's directory) and follow its required shape — Goal / Do / Don't / Expected result / Test — **in English**, with the unit's acceptance criteria embedded verbatim. For parallel units, the Expected result MUST include: *"commit all your work on the current branch (`maestro/<unit-slug>`)"* — merge and cleanup operate on the branch tip.

**Fable-style reasoning injection** *(judgment + mechanics)*: non-trivial units get a `## Read first` section at the very top of the prompt (before `## Goal`) directing the session to read strategy skills — the 8 ultraprompt axes vendored in this repo's `skills/` — so a sub-frontier model reasons closer to how the conductor does. Trivial units SKIP injection entirely (reading two skills costs the session ~3–4k tokens; don't spend it on a one-liner).

Axis selection *(judgment — default mapping; deviating is fine when you say why in the dispatch report)*:

| Unit smells like | Inject |
|---|---|
| debugging / root-causing | hypothesis-management + self-correction-loop |
| implementing a spec / RFC / paper | spec-to-code-fidelity |
| design / greenfield | tradeoff-articulation + failure-mode-enumeration |
| refactor / large change | incremental-safety + exploration-strategy |
| unfamiliar codebase | exploration-strategy |

Hard cap: 3 selected axes per dispatch. `verification-discipline` is ALWAYS added on top — it is the floor and does not count toward the cap.

Path resolution *(mechanics — run per axis BEFORE composing the prompt; never inject a path you didn't verify exists)*:

```bash
AXIS=~/.claude/skills/<axis>/SKILL.md
[ -f "$AXIS" ] || AXIS=<maestro-repo>/skills/<axis>/SKILL.md
[ -f "$AXIS" ] || AXIS=""   # neither exists → skip this axis, note it in the dispatch report
```

Template *(mechanics — prepend verbatim, resolved absolute paths)*:

```text
## Read first
Before writing any code, READ these files fully — they define the reasoning discipline required for this task:
- <axis-path-1>
- <axis-path-2>
```

Out-of-cwd reads are permitted by the app-server default sandbox (verified live). If Phase 3 observation shows the files were NOT read, `steer <threadId> "Read the files listed under ## Read first before continuing."` once — a conductor-side compliance nudge, it does not consume a rework round.

**Send — non-blocking** *(mechanics)*:

```bash
node $SCRIPT msg <threadId> "<prompt>" --approve --timeout <fit-to-task-size>   # via run_in_background
```

- `run_in_background` is required: `msg` blocks synchronously until the turn completes, which would make observation/steering impossible and serialize parallel dispatch.
- `--approve` is required: without it, file-change AND command-execution approvals are auto-declined and the session stalls writing nothing.

**State persistence** *(mechanics — immediately after dispatching)*: write `<target-repo>/.maestro/state.json` recording, per unit: `unitSlug`, `threadId`, `cwd` (worktree or repo), `baseline` SHA, `branch` (parallel only), `acceptanceCriteria`, `dispatchedAt`, `phase`. Update `phase` as each unit moves through observe → verify → rework/done. This is what makes Phase 0 resume possible after a crash — without it, running Codex sessions are orphaned. Ensure `.maestro/` is not committed (add to the target repo's local excludes: `echo .maestro/ >> <repo>/.git/info/exclude`). Delete `state.json` at the end of a fully completed run.

## Phase 3 — Observe *(mechanics + judgment)*

While background `msg` runs: poll `node $SCRIPT active` and `node $SCRIPT read <threadId>`; summarize progress for the user. `steer <threadId> "<corrective delta>"` when a session drifts from its criteria *(judgment)*; `interrupt <threadId>` for runaway turns. On msg timeout the turn continues server-side: keep polling `read` — never re-`msg` blindly.

*(Steer-during-background-msg is verified working: steer opens its own connection while the background msg holds one, injects into the running turn, and the delta is incorporated. If steer ever errors, fall back to interrupt + a rework msg.)*

## Phase 4 — Verify *(mechanics templates + judgment review)* — per unit, as each completes

**Health check first** *(mechanics)*: `read <threadId>` and check the thread `Status`. `systemError` with zero agent items in the turn = the app-server silently failed the turn — this is NOT the session's fault: do **not** consume a rework round; see Troubleshooting (stale app-server), restart, re-create the session, re-dispatch.

`node $SCRIPT answer <threadId>` is the session's **self-report — a claim, never evidence.** But triage its shape first:
- **It's a clarifying question, not completed work** → answer the question with a `msg` to the same thread. This does NOT consume a rework round (cap: 2 question round-trips per unit; beyond that, escalate — the unit was underspecified, which is a dispatch defect, not a Codex defect).
- **It claims completion** → verify:

```bash
git -C <unit-cwd> diff <baseline>     # the actual changes (captures committed AND uncommitted work)
```

**Build/test detection recipe** *(mechanics — check in order, run everything that exists in `<unit-cwd>`, report what was skipped and why)*:
1. `package.json` → run its `test` and `build` scripts if defined
2. `Makefile` → `make test` if the target exists (`make -n test`)
3. `Cargo.toml` → `cargo test`
4. `pyproject.toml` / `pytest.ini` / `setup.cfg` with pytest → `pytest`
5. `go.mod` → `go test ./...`
Nothing found → say "no build/test harness detected" in the report; diff review is then the only evidence.

Review the diff against **each** acceptance criterion *(judgment)*. Produce a per-unit **Verification Report**: criterion → pass/fail → evidence (diff hunk / test output).

## Phase 5 — Rework loop *(judgment)*

**Root-cause before consuming a round:** if a failing criterion reproduces independently of the session's changes — e.g., a harness-supplied test command that cannot pass in this environment, a broken fixture, or a criterion contradicting the repo — it is a **conductor/environment defect, not a Codex defect**: fix it conductor-side (or amend the criterion), re-verify, and do NOT consume a rework round. Sessions that correctly flag such blockers in their answer instead of hacking around them are behaving well.

On genuine work defects: `msg` the SAME thread (same `--approve`/background mechanics) with the concrete defect list and unmet criteria — **≤3 rounds total**. After round 3: escalate to the user with per-criterion status, diff summary, and a recommended next action.

## Cleanup *(mechanics — parallel runs only)* — per accepted unit, after verification

**Merge order is deterministic:** merge accepted units in **dispatch order** (the order recorded in `.maestro/state.json`). On the first merge conflict, STOP — surface the conflict to the user with the conflicting unit named; never auto-resolve, never continue merging subsequent units on top of an unresolved conflict.

```bash
# 1. Pin commit state (safety net if Codex didn't commit despite the prompt):
[ -n "$(git -C <worktree> status --porcelain)" ] && git -C <worktree> add -A && git -C <worktree> commit -m "maestro: <unit-slug>"

# 2. Merge (in dispatch order; conflicts are surfaced to the user, never auto-resolved):
git -C <repo> merge maestro/<unit-slug>

# 3. Remove (prevents leaked worktrees/branches):
git -C <repo> worktree remove --force <repo>-maestro-<unit-slug>
git -C <repo> branch -D maestro/<unit-slug>
```

Rejected units: report the diff before removal, never silently discard; then the same remove commands. When every unit is closed out, delete `<repo>/.maestro/state.json`.

## Troubleshooting

- **Turn "completes" instantly but `answer` finds no agent message**, and `read <threadId>` shows `Status: systemError` with only the user message in the turn → the app-server process is stale (observed after ~2 weeks uptime). Fix: restart it with its original arguments (`ps aux | grep 'codex app-server'` shows the command line; `kill <pid>` then relaunch detached), re-create the session, re-dispatch. Verify the model path separately with `codex exec "Reply: pong"` if unsure.
- `status` returning `"disabled"` refers to remote-control pairing — it does **not** block turn execution; don't chase it.
- Byte-exact content checks: use `od -c <file>` (macOS BSD `cat` has no `-A` flag).

## Final report

Dispatch decision + reasoning · per-unit Verification Reports · overall verdict (done / escalated with recommended next action).

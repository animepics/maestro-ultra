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
2. For each recorded thread: `read <threadId>` — a running turn → rejoin at Phase 3 (observe); a finished turn → rejoin at Phase 4 (verify). **Claude-performer units** carry a subagent handle, not a thread — probe whether the subagent is still live; if it is NOT (no live completion handle — e.g. after conductor death, since claude turns are not server-persisted), **re-dispatch from the last worktree commit** (the recovery point is the worktree commit, not a server turn — this DEPENDS on the Unit-2 commit-on-branch contract, A6). **Conductor-direct units** have no handle at all; on crash they simply **restart from criteria** (trivial-only cell, small blast radius).
3. `git -C <repo> worktree list` — worktrees recorded in state but with no live purpose (verification done or thread dead) are orphans: report them, then clean up per the Cleanup section.
4. Only after reporting resume status to the user, continue the loop from the phase each unit is actually in. If state is stale/corrupt, say so and offer fresh start (which archives the old file to `.maestro/state.json.bak`).

## Phase 1 — Analyze & Split *(judgment)*

0. **Right-size the ceremony.** Benchmarked honestly: on a small, fully-specified, single-file task, the harness adds ~40–50% time/token overhead over a bare `codex exec` with no quality gain — its spec-expansion pays off on ambiguous or multi-part tasks (measured 5.5× faster, 2.4× cheaper there). So: for a trivial well-specified one-liner-ish task, say so and offer the user the cheap path (direct edit or bare dispatch with terse criteria, `--effort low`); reserve full ceremony (elaborate criteria, observation cadence, parallel machinery) for tasks with ambiguity, edge cases, or multiple units.
1. Restate the task. Derive **testable acceptance criteria** per work unit — never dispatch a bare task prompt.

   **Criteria-quality gate** *(judgment — binds to step 0: runs with full ceremony, SKIPPED entirely on the cheap path)*. Before dispatch, check every derived criterion against four properties and rewrite any that fail:
   - **Testable** — a mechanical check (diff / build / test / inspection) can decide it, not a vibe.
   - **Falsifiable** — it states a condition that can concretely fail. Operational example: *"parses file X"* FAILs the gate (it passes as long as anything happens); *"emits an explicit error on a malformed X instead of silently continuing"* PASSes (a named failure mode you can force and observe).
   - **Disjoint-scoped** — criteria don't overlap; each owns one outcome, so a single failure points at one place.
   - **Failure-mode-aware** — at least one criterion names what going wrong looks like (malformed input, empty, boundary), not only the happy path.
   Granularity scales with the unit's routed model *(judgment)*: a light-tier unit (downshifted in step 3) gets finer-grained criteria — smaller, more numerous — because a weaker performer needs the target pinned tighter. This is granularity of the **destination**, not the procedure (still no step-by-step scripts — see `references/prompting-codex.md`). *(Vocabulary here echoes the `self-correction-loop` skill — treat its terms as a v0.1-draft framing, not a fixed contract.)*
2. Decide **single session vs N parallel sessions**. **Hard cap: 4 concurrent sessions** — a **codex-session isolation constraint** (claude-subagent concurrency is judged separately — see step 3's A4 note); more units than that queue behind the first wave. Parallel ONLY when all three hold:
   - units are independent (no ordering dependency), AND
   - units touch **disjoint directories** (not merely disjoint files — a shared git index, lockfiles, and build artifacts break attribution), AND
   - each unit is individually meaningful.
   Otherwise run single-session.
3. **Performer & model/effort per unit — two-stage routing** *(judgment)*: decide each unit in **two stages** — **(a)** pick the **performer cell** {codex-session | claude-subagent | conductor-direct}, then **(b)** pick **model/effort within that cell** (codex = the roster routing below, unchanged; claude = a per-call haiku/sonnet/opus choice; conductor-direct = Fable inline, no model knob). Default cell is **codex** (separate token pool); claude/conductor-direct are chosen only on the signals below.

   **Stage (a) — performer cell** *(judgment — prose heuristics, not a scorecard)*:
   - **conductor-direct (Fable inline)** — trivial · fully-specified · single-file/one-liner units: this is step 0's cheap path re-cast as the matrix's third cell (when the WHOLE task is just this one unit, keep step 0's ceremony/ledger skip — see step 0). Also: a unit of a multi-unit run where the conductor already holds the full mental model, so the **context re-transfer cost of dispatch would exceed the work itself**; and latency-critical tiny edits. **No parallelism** (single conductor thread) — never herd multiple units here.
   - **codex-session (default bulk performer)** — independent, parallelizable units (up to the 4-concurrent worktree wave), especially to offload labor onto a **separate token pool** and preserve the conductor's own budget (codex quota is separate from the Claude budget — **cost-pool honesty**). Standard–hard implementation labor. Prefer it where **server-side persistence/resume** matters (long turns, crash risk) — codex `read <threadId>` rejoins a running turn; claude has no equivalent. Cost axis: consumes ChatGPT-plan quota, separate from the conductor's budget.
   - **claude-subagent (first-class)** — units where **reasoning quality matters more than throughput** (native Claude has no cross-model reasoning gap with the conductor); opus-tier reasoning the codex roster can't match; where a per-call haiku/sonnet/opus tier is advantageous. **quota-state is a first-class routing INPUT, not a fallback trigger**: when Codex quota is exhausted/constrained but the Claude budget has headroom, route here deliberately (this generalizes the quota handover — now a routing input, not only a fallback). **Cost axis (honest): claude burns the CONDUCTOR'S OWN Claude budget** — unlike codex's separate pool — so prefer codex under Claude-budget pressure and claude under Codex-quota pressure.
     - **Conductor-budget fail-safe guard** *(Principle: fail-safe conservative)*: if the conductor's OWN budget is under pressure, do NOT route to claude. If Codex quota AND the conductor budget are BOTH under pressure, **park / escalate** the unit rather than burning the orchestrator's remaining budget — when signals are uncertain, don't automate.
     - **Concurrency (A4)** — the 4-concurrent cap (step 2) is a **codex-session isolation constraint**, NOT a global one. claude-subagent concurrency is judged separately (conductor budget + observation load); keep total in-flight performers to a **soft bound ≤4** for observability, exception when justified. claude units MIX into the same parallel wave as codex (verification is performer-agnostic and the worktree isolation is shared).

   **context-depth axis** *(judgment, across cells)*: a unit needing repo context the conductor already holds deeply → conductor-direct or claude (Claude↔Claude context transfer is natural in the dispatch prompt); shallow + fully-specified → codex.

   **Stage (b) — codex-cell model & effort — full-auto routing** *(judgment)*: route each unit across the live roster fetched in preflight 4.5 (`node $SCRIPT models`; per-model fields: `id`, `displayName`, `description`, `isDefault`, `hidden`, `supportedReasoningEfforts` with per-effort descriptions, `defaultReasoningEffort`). Pass choices via `msg --model <id> --effort <level>`.
   - **Workhorse rule**: the gpt-5.6 family resolves most needs — route to it by default while it is on the roster. Prefer the roster's `isDefault: true` entry for standard/hard units; the family's fast/affordable tier (read `description`) covers lighter standard work. If no 5.6-family model is present, anchor on whatever entry is `isDefault` — never hard-fail on a missing literal name.
   - **Downshift** to a light model (`description` says fast/affordable/ultra-fast; name says mini/nano/spark) ONLY for clearly mechanical units (rename, boilerplate, single small function).
   - **Upshift** past the workhorse only when the roster offers something genuinely stronger AND the unit is genuinely hard (debugging, tricky algorithms, cross-cutting refactors).
   - **Effort**: scale within the chosen model's `supportedReasoningEfforts` — mechanical → `low`; standard → the model's `defaultReasoningEffort` (or omit the flag); hard → `high` or above.
   - **Unknown model names**: infer tier from `description` plus name heuristics (mini/nano/spark → light; higher version number → newer; codex-variants preferred for code). Still uncertain → the workhorse, or omit `--model` (server default).
   - **Fallback**: `models` failed in preflight → omit `--model` entirely and use effort-only guidance: mechanical `--effort low`, standard `--effort medium` (or omit), hard `--effort high`.
   - **Report**: state per unit, in the dispatch report, the chosen **(performer cell, model, effort, injected skills — Phase 2)** and one line of reasoning. Never route silently. The user may **override the performer/model choice per unit** — a per-unit user override sits on top of the conductor's routing.
4. **Anti-overengineering is part of every dispatch** *(judgment)*: every prompt's Do section MUST include a minimalism decision rule (e.g., "implement the smallest standard-library solution that satisfies the criteria; no new dependencies, no speculative abstractions, no features beyond the criteria"), and Phase 4 review MUST check the diff for overengineering (unrequested features, needless layers/config, premature generalization) — overengineered-but-working output is a verification FAIL with a rework instruction to simplify.
5. **Report the decision and reasoning to the user before dispatching.**

**Spec echo-back** *(judgment — ambiguous/multi-part tasks only, bound to step 0: the cheap path structurally skips this)*. Before dispatch, echo the derived spec (restated task + unit split + acceptance criteria) back to the user for a quick confirm — via AskUserQuestion where available. This is a **destination** confirm ("did I understand the outcome and its criteria?"), not a procedure walkthrough. Non-interactive/autonomous fallback: when the autonomy discriminator is positive (same signal as the Phase-5 breaker — the `"The boulder never stops"` reminder or an explicit autopilot/ralph flag), do NOT wait; log the stated assumptions and proceed, so an autonomous run never deadlocks on an absent human. Absent any autonomy signal, treat the run as interactive and wait for the confirm.

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

**Claude-subagent dispatch** *(judgment + mechanics — for units routed to the claude cell in Phase 1)*: dispatch is a **native Agent tool call** carrying a per-call `model` (haiku/sonnet/opus), run in the **background with a completion notification** — no new CLI or transport is invented (native, transport-free). The contract is **embedded in the dispatch prompt itself** — claude does NOT read `AGENTS.md` (that file is the codex-session contract, Difference 3): the same Goal / Do / Don't / Expected result / Test + acceptance-criteria shape, PLUS a **commit-on-branch instruction** (*"commit all your work on `maestro/<unit-slug>`"*) and a **takeover notice** (**A6** — mirroring the codex contract's AGENTS.md points 3 and 8; the Phase-0 claude crash-recovery DEPENDS on this commit point existing).

- **Worktree isolation — path (a)** *(mechanics)*: the subagent works inside the **conductor-created `maestro/<slug>` worktree**, enforced by an **absolute-cwd instruction in the prompt** — so the existing worktree add/branch/merge/cleanup scheme applies unchanged. Do NOT use the Agent tool's own `isolation:"worktree"` — that is a separate harness lifecycle invisible to maestro's merge/cleanup. (This is prompt-enforced, not transport-enforced — Difference 4.)
- **Strategy-skill injection — tier-conditional** *(judgment)*: **opus/sonnet claude = SKIP** (frontier reasoning; the `## Read first` skills exist to lift a sub-frontier model toward the conductor's reasoning, so injecting them here just wastes tokens). **Downshifted haiku claude = CONSIDER** injection (haiku is sub-frontier — the skills' original target), combined with the conductor-budget guard: inject only with budget headroom, else **park/escalate** the haiku unit.
- **Steering** *(judgment)*: a follow-up message to the subagent (SendMessage-equivalent). When exactly it injects into a running turn (immediately vs at a turn boundary) is `[live: unconfirmed]`.

**Four honest differences from a codex session** *(verification, worktree merge/cleanup, and criteria are the SAME — see "what does not change")*:
1. **handle, not threadId** — a claude subagent has an Agent id / background-task handle, not a codex `threadId`; state.json records the handle.
2. **no server-side turn persistence** — a half-done claude turn is not server-persisted; crash recovery is **re-dispatch from the last worktree commit** `[live: unconfirmed]` (not a server-turn rejoin), and orphaned live subagents on conductor death are re-dispatch candidates.
3. **contract path** — the contract arrives in the dispatch prompt, not via an `AGENTS.md` in cwd.
4. **prompt-enforced vs transport-enforced isolation** — codex's cwd IS its worktree (transport-enforced); claude complies with a prompt cwd instruction (prompt-enforced), relatively weaker under parallelism — cwd compliance under parallel dispatch is `[live: unconfirmed]`.

**Confirmed native Agent-tool facts (NO marker):** background dispatch, completion notification, follow-up messaging, per-call model, and parallel dispatch are native-contract facts stated without hedge; only the three items marked above stay `[live: unconfirmed]`.

**State persistence** *(mechanics — immediately after dispatching)*: write `<target-repo>/.maestro/state.json` recording, per unit: `unitSlug`, `threadId` (a **subagent handle** replaces it for claude-performer units), `cwd` (worktree or repo), `baseline` SHA, `branch` (parallel only), `acceptanceCriteria`, `dispatchedAt`, `phase`, plus `performer: "codex"|"claude"|"conductor"` — the **mutable current-actor** ("who is working this unit right now"), which the **quota handover (Phase 5) flips to `"fable"`** (the takeover state kept deliberately distinct from a routed `conductor`) — `degraded`, `dependentsParked: true`, and `lastTurnError: {message, willRetry, at}` (a carry-field: what LIVE streaming observed, for resume reference — advisory only, NEVER a substitute for the re-probe, since `read` cannot re-derive `willRetry`). Update `phase` as each unit moves through observe → verify → rework/done; on quota recovery record the transition here (`performer` flips back to `codex`, `degraded`/`dependentsParked` cleared — at the unit/dispatch boundary only). **A3 — two performer fields.** state.json `performer` is the **mutable current-actor** (above); it contrasts with the **ledger `performer`** (Phase 4), which is the **immutable routing provenance**. `conductor` and `fable` are the **same physical actor** (the conductor, Fable), distinguished only by provenance: `conductor` = deliberately routed to the inline cell, `fable` = a quota/breaker takeover state. This is what makes Phase 0 resume possible after a crash — without it, running Codex sessions are orphaned. Ensure `.maestro/` is not committed (add to the target repo's local excludes: `echo .maestro/ >> <repo>/.git/info/exclude`). Delete `state.json` at the end of a fully completed run.

## Phase 3 — Observe *(mechanics + judgment)*

While background `msg` runs: poll `node $SCRIPT active` and `node $SCRIPT read <threadId>`; summarize progress for the user. `steer <threadId> "<corrective delta>"` when a session drifts from its criteria *(judgment)*; `interrupt <threadId>` for runaway turns. On msg timeout the turn continues server-side: keep polling `read` — never re-`msg` blindly.

*(Steer-during-background-msg is verified working: steer opens its own connection while the background msg holds one, injects into the running turn, and the delta is incorporated. If steer ever errors, fall back to interrupt + a rework msg.)*

## maestro-workflows — at-a-glance status *(judgment + mechanics)*

Triggered by the user saying "maestro-workflows" / "/maestro workflows" (any "what are the performers doing right now"). On demand, render ONE combined table of ALL currently running performers *(judgment — only the conductor can render this MIXED view; the transport scripts are codex-side only)*:

- **Codex sessions** *(mechanics)*: `.maestro/state.json` (unit rows) + `node $SCRIPT active` (in-flight threads) + `node $SCRIPT read <threadId>` (phase / last event) per thread.
- **Claude background subagents/tasks** *(judgment)*: the conductor's own dispatched Fable/subagent work — visible ONLY to the conductor, never to the transport.

| UNIT | PERFORMER | THREAD | MODEL | PHASE/STATUS | LAST EVENT | ELAPSED |
|---|---|---|---|---|---|---|

- **Empty state** *(judgment)*: no live performers → say "no active performers" honestly; still list `state.json` units not yet closed out, marked as such (no live thread).
- **codex-side alternative** *(mechanics)*: `node $SCRIPT workflows [--watch]` renders the same table live/pretty — but **codex-side only** (Claude subagents are invisible to it). Use it for a live/auto-refreshing view; the conductor's mixed report for completeness.
- Enumerating the conductor's own background tasks needs live verification — [live: confirm the conductor can actually list its dispatched Claude background tasks; if it can't, state that limit in the report].

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

**Outcome ledger** *(mechanics — append ONE line per unit at verification close, conductor-side only)*. This is the append-only `.maestro/metrics.jsonl` — a **separate** file from `state.json` with the opposite lifecycle: `state.json` is ephemeral crash-recovery scratch deleted at run end (Cleanup); `metrics.jsonl` is durable outcome history and is **NEVER deleted**. It accumulates locally on this machine only (no upload, no aggregation service — scope it honestly). Pin it to the **main repo** even when the unit ran in a linked worktree cwd:

```bash
# Resolve to the MAIN repo's .maestro/ (worktree cwds must still write here):
LEDGER_DIR="$(dirname "$(git -C <unit-cwd> rev-parse --path-format=absolute --git-common-dir)")/.maestro"
mkdir -p "$LEDGER_DIR"
# --path-format=absolute is required: bare --git-common-dir can return a relative .git.

# Append one line (node validates the JSON, then appends — schema is fixed):
node -e 'require("fs").appendFileSync(process.argv[2], JSON.stringify(JSON.parse(process.argv[1]))+"\n")' \
  '{"unitSlug":"<slug>","ranAt":"<iso8601>","performer":"codex|claude|conductor","model":"<model>","effort":"<effort>","criteriaCount":<post-rewrite count>,"firstAttemptPass":<bool>,"reworkRounds":<int>,"reElevated":<bool>,"resolvedBy":"codex|claude|conductor|fable-breaker|fable-quota|user|aborted","outcome":"done|escalated","baselineSha":"<sha>"}' \
  "$LEDGER_DIR/metrics.jsonl"
```

Two OPTIONAL fields attach to quota-handover units (Phase 5 Quota-exhaustion handover) — omit them otherwise: `"degraded":true` (autonomous takeover with no independent oracle) and `"oracle":"baseline-tests"|"hidden-suite"|"none"`.

`criteriaCount` is the post-rewrite count when a criterion was re-elevated (Phase 5), with `reElevated:true`. `resolvedBy` separates who closed the unit so a Fable rescue, quota takeover, or user intervention never pollutes the first-attempt-pass stat — `fable-quota` marks a Codex→Fable quota handover and is excluded from that aggregation exactly like `fable-breaker`.

**Performer & routing provenance (Round 3).** The ledger `performer` field is the **immutable routing provenance** (`codex|claude|conductor`; a legacy line without it is read as `codex` — backward-compatible). `resolvedBy` **normal** values extend to **`codex|claude|conductor`** (the fallback values `fable-breaker|fable-quota|user|aborted` are unchanged). **Invariant:** on normal resolution `resolvedBy === performer`; when a fallback rescues, `performer` keeps the routed cell and `resolvedBy` is the fallback value (e.g. routed to claude but rescued by Clause A → `performer:"claude", resolvedBy:"fable-breaker"` — readable as such).

**First-class routing ≠ first-attempt aggregation (Principle 9).** The headline first-attempt-pass stat is computed **only over `resolvedBy ∈ {codex, claude}`** — the performers with an **independent verifier**. `conductor` lines are recorded (provenance-only) but **excluded from the headline exactly like the fallback set**: the conductor is the same actor as the verifier (self-grading is irreducible), and a conductor-direct unit has no dispatch boundary, so `firstAttemptPass` is trivially true and measures nothing. Being a first-class ROUTING cell does not admit `conductor` into first-attempt AGGREGATION; `claude` (independent verifier) does enter.

**conductor-direct ledger nuance.** (a) A **whole-task-trivial** step-0 cheap-path unit is **un-ledgered** (ceremony skipped). (b) An **inline unit of a ceremonied multi-unit run** IS ledgered as `performer:"conductor", resolvedBy:"conductor"` — provenance-only, excluded from the headline. A conductor-direct crash-resume has no handle, so it **restarts from criteria** (trivial-only cell). The live mixed PERFORMER view is the maestro-workflows table (which already renders codex/claude, inheriting its `[live]` hedge — not restated as confirmed here).

Reader (node, not jq — node is already a prerequisite; **headline first-attempt-pass over `resolvedBy ∈ {codex, claude}` only** — `conductor` and the fallback set `fable-quota|fable-breaker|user|aborted` are excluded from the headline; legacy lines without `performer` read as codex):

```bash
node -e 'const r=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").filter(Boolean).map(JSON.parse); const c=r.filter(x=>["codex","claude"].includes(x.resolvedBy)); console.log(`first-attempt-pass: ${c.filter(x=>x.firstAttemptPass).length}/${c.length}`)' "$LEDGER_DIR/metrics.jsonl"
```

## Phase 5 — Rework loop *(judgment)*

**Root-cause before consuming a round:** if a failing criterion reproduces independently of the session's changes — e.g., a harness-supplied test command that cannot pass in this environment, a broken fixture, or a criterion contradicting the repo — it is a **conductor/environment defect, not a Codex defect**: fix it conductor-side (or amend the criterion), re-verify, and do NOT consume a rework round. Sessions that correctly flag such blockers in their answer instead of hacking around them are behaving well.

**Convergence re-elevation** *(judgment)*. When the SAME criterion fails twice for the SAME reason across rework rounds, stop reworking the code against it — the criterion itself is the defect. Rewrite it (per the Phase-1 criteria-quality gate) and re-dispatch, recording `reElevated:true` and the post-rewrite `criteriaCount` in the ledger. This is the **intended cross-referenced exception** to the rule directly above ("a criterion contradicting the repo … does NOT consume a rework round"): repeated same-reason failure is the deliberate signal that the criterion is broken, so it is re-elevated rather than hacked around — but, unlike the single repo-contradiction case, re-elevation is bounded by the EXISTING ≤3 rework budget and NEVER opens a fresh round, precisely to prevent an unbounded rewrite→re-dispatch loop.

On genuine work defects: `msg` the SAME thread (same `--approve`/background mechanics) with the concrete defect list and unmet criteria — **≤3 rounds total**. After round 3: escalate to the user with per-criterion status, diff summary, and a recommended next action.

**Fable-takeover terminal breaker** *(judgment — a bounded terminal for the autonomous branch, NOT a new phase)*. The round-3 escalate above assumes a human to escalate *to*; an autonomous run has none, so the loop would end unresolved. This breaker supplies a 'resolved' terminal for that case only, and fires ONLY when ALL FOUR hold:
1. **Round 3 exhausted** — the ≤3 budget is spent and the unit still fails.
2. **Autonomous discriminator POSITIVE** — an explicit autonomy signal is present in context: the OMC ralph/ultrawork hook reminder `"The boulder never stops"`, or an explicit autopilot/ralph flag. Signal absent = interactive = escalate to the user (the fail-safe default; this is where interactive/autonomous vocabulary enters the skill).
3. **Independent oracle exists** — tests present at the recorded baseline SHA, or a conductor-written Phase-1 hidden suite (prefer the baseline harness). It must NOT be tests authored or modified during this run, and **Fable is FORBIDDEN from editing any test file during takeover** — the performer must never write its own scorecard. No independent oracle (a diff-review-only unit) → escalate/abort, never takeover.
4. **Ledger + echo-back state healthy** — if either is uncertain, treat as unhealthy → escalate.

Then **≤1 Fable attempt.** Oracle still fails → **terminal abort**: write the ledger line with `resolvedBy:"aborted"` and `outcome:"escalated"`, preserve the branch/worktree for human review, never loop. Oracle passes → `resolvedBy:"fable-breaker"` (excluded from the first-attempt-pass stat, per the ledger reader).

**Quota-exhaustion handover** *(judgment — a performer-swap, distinct from Clause A above; sits next to it but is NOT a loop-breaker)*. Codex can exhaust its token/rate quota; the conductor recognizes this and lets Fable (Claude) finish the unit.

**Distinction vs Clause A** *(the one sentence that separates them)*: Clause A is a terminal loop-breaker fired after 3 failed rework rounds (strict gates, ≤1 attempt); a quota handover is a performer-swap with **NO failure history** — quota is external resource exhaustion, not a difficulty signal, so the clean-completion prior is high and the oracle requirement relaxes (used if present, degraded-and-gated if absent) — but the same honesty rules bind.

Recognition, split by observation surface *(mechanics-flavored judgment)*:
- **(i) LIVE dispatch-turn streaming** — a `turnError` event whose `error.message` is quota/rate-limit-shaped AND `willRetry=false` = quota exhaustion (`willRetry` exists only on the live `error` notification — `ErrorNotificationParamsSchema`).
- **(ii) resume / `read` path** — a thread `read` can NEVER carry `willRetry` (`TurnSchema` has no such field — schema fact). Recognize by `Status: failed` + a quota-shaped `error.message` ONLY, and **re-probe** (a minimal fresh `msg` or `status` check) confirming exhaustion is still current before declaring it — never assume from a stale message.
- Exact quota message strings are unverified — [live: capture the real string on first occurrence and pin it here].

Handover semantics *(judgment)*:
- **Pre-dispatch exhaustion** (first turn fails immediately, no Codex output) → Fable starts the unit clean as a normal working session.
- **Mid-turn exhaustion** → first safety-net commit Codex's partial work (Cleanup step-1 mechanics), then Fable continues **in the SAME worktree, SAME `maestro/<slug>` branch** — never switches branches — and commits there. Fable follows the SAME acceptance criteria; standard diff-vs-`<baseline>` verification still applies.

Gating *(judgment — autonomy discriminator is the SAME signal as Clause A: `"The boulder never stops"` / autopilot·ralph flag; signal absent = interactive)*:
- **Interactive** → offer the user the choice (continue with Fable now / wait for quota reset) via AskUserQuestion.
- **Autonomous + independent oracle exists** (baseline tests / a Phase-1 hidden suite; Fable never edits tests) → proceed, verify with that oracle, normal routing.
- **Autonomous + no oracle** → the unit still completes but is labeled `conductor-authored + conductor-verified (no independent oracle)` in the report, AND dependents are NOT dispatched on top — dependent units are **parked** and surfaced at run end together with all degraded units (a run-end human-review gate). Never claim an evidence-free "pass".

Recovery *(judgment)*: when Codex quota returns, resume normal routing only at the NEXT unit/dispatch boundary — never swap a unit back to Codex mid-unit.

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

Rejected units: report the diff before removal, never silently discard; then the same remove commands. When every unit is closed out, delete `<repo>/.maestro/state.json` — but NEVER delete `.maestro/metrics.jsonl` (the outcome ledger is durable history; only the ephemeral `state.json` is removed).

## Troubleshooting

- **Turn "completes" instantly but `answer` finds no agent message**, and `read <threadId>` shows `Status: systemError` with only the user message in the turn → the app-server process is stale (observed after ~2 weeks uptime). Fix: restart it with its original arguments (`ps aux | grep 'codex app-server'` shows the command line; `kill <pid>` then relaunch detached), re-create the session, re-dispatch. Verify the model path separately with `codex exec "Reply: pong"` if unsure.
- `status` returning `"disabled"` refers to remote-control pairing — it does **not** block turn execution; don't chase it.
- Byte-exact content checks: use `od -c <file>` (macOS BSD `cat` has no `-A` flag).

## Final report

Dispatch decision + reasoning · per-unit Verification Reports · overall verdict (done / escalated with recommended next action).

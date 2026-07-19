# maestro

Claude Maestro — an orchestration harness where Claude acts as the conductor: it observes Codex sessions, dispatches work prompts (deciding between parallel or single execution), and verifies the results.

**Philosophy:** Claude is the conductor (planning, judgment, verification); Codex is the performer (implementation labor).

## Components

- **Observe** — Inspect the state, progress, and results of Codex sessions (via codex app-server, WebSocket JSON-RPC)
- **Dispatch** — Claude writes work prompts with explicit acceptance criteria and sends them to Codex, deciding whether to run N sessions in parallel or a single session
- **Verify** — Per-criterion checks + diff code review + build/test execution; on failure, sends concrete rework instructions (max 3 attempts, then escalates to the user)
- **Skill** — Packages the whole loop into a single invocation: `/maestro "task description"`

## How it works

```
/maestro "task"
   │
   ├─ 1. Claude analyzes the task, writes acceptance criteria
   ├─ 2. Decides: single session vs N parallel sessions (split by independent files/dirs)
   ├─ 3. Dispatches prompts to Codex via app-server (WebSocket JSON-RPC)
   ├─ 4. Observes session progress, reports status
   ├─ 5. Verifies: criteria checklist + diff review + build/tests
   └─ 6. Pass → done. Fail → rework prompt to the same session (≤3 rounds) → escalate
```

## Prerequisites

- **[Codex CLI](https://github.com/openai/codex)** with app-server support, running as `codex app-server`
- **Node with TypeScript type-stripping** (≥ 23.6 guaranteed; 22.18+ typically works) or Bun
- Target projects must be **git repositories** (verification is diff-based)
- **v1 scope:** local same-machine only (no remote `HOST=` targets); sessions use the app-server's default sandbox/model config

The transport CLI (`scripts/codex-query.ts`, WebSocket JSON-RPC — vendored from the use-codex-appserver skill) ships in this repo: **no external skill dependency**.

## Installation

```sh
git clone https://github.com/animepics/maestro.git && cd maestro
./install.sh
```

The installer symlinks `skills/maestro` into `~/.claude/skills/` and installs the transport's npm dependencies. Then, in Claude Code: `/maestro "your task"`.

## Example run (real transcript, condensed)

Single unit — `/maestro "create hello.txt containing 'hello maestro'"`:

```text
Phase 1  1 unit, single session (no split value) — criteria: file exists, exact bytes, nothing else touched
Phase 2  baseline 718ce99 recorded → create session → msg --approve (background)
Phase 3  observing… turn completed
Phase 4  answer claims success → evidence: git diff shows only hello.txt;
         od -c: 'h e l l o   m a e s t r o \n'  → 3/3 criteria PASS
```

Parallel — two units in isolated worktrees:

```text
Phase 2  worktree add -b maestro/unit-a …-maestro-unit-a 718ce99   (same for unit-b)
         two sessions dispatched concurrently
Phase 4  unit-b finishes first → verified while unit-a still runs
         per-unit diffs attribute cleanly (b/beta.txt ← unit-b only)
Cleanup  merge maestro/unit-a, maestro/unit-b (dispatch order) → worktrees & branches removed, no leaks
```

The `answer`-is-a-claim rule earns its keep: in testing, a stale app-server produced turns that reported "completed" with zero work done — diff-based verification caught it immediately (now documented in the skill's Troubleshooting).

## For Codex sessions

[`AGENTS.md`](AGENTS.md) documents the contract from the Codex side: criteria are the spec, diffs are the evidence, commit-on-branch for parallel units, ask instead of guessing.

## Roadmap

- **Remote `HOST=` targets** — the transport already speaks to remote app-servers; verification needs a remote-diff story (likely `git bundle` or SSH-side `git -C` execution)
- **Per-task sandbox/model selection** — requires wrapping the raw `config/value/write` RPC that the CLI does not yet expose
- **Minimal orchestration helper** — extract deterministic baseline/worktree/background-msg mechanics into ~100 lines of code *only if* the verbatim prose templates prove insufficient in practice
- **Rework-rate metrics** — track criteria-pass-on-first-attempt vs rework rounds across runs

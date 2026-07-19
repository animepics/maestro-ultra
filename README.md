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

## Installation

The skill source lives in this repo (`skills/maestro/`). Install globally via symlink:

```sh
ln -s "$(pwd)/skills/maestro" ~/.claude/skills/maestro
```

Requires the [Codex CLI](https://github.com/openai/codex) with app-server support.

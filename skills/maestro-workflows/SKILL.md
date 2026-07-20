---
name: maestro-workflows
description: "Render the maestro mixed performer status view — one at-a-glance table of ALL currently running performers: codex sessions (app-server) AND Claude background subagents, plus not-yet-closed maestro units. Invoke on: '/maestro-workflows', 'maestro-workflows', 'maestro workflows', '지금 뭐 돌고 있어', 'what are the performers doing'. This is the conductor-rendered counterpart of Claude Code's /workflows for maestro runs."
---

# maestro-workflows

Render ONE combined status table of everything currently performing work under this conductor. This view is conductor-only by design: the codex-side script cannot see Claude subagents; only the conductor holds both halves.

## Gather *(mechanics — run what applies, skip what doesn't)*

```bash
# 1. Transport (same resolution as the maestro skill):
SCRIPT=<maestro-repo>/scripts/codex-query.ts   # or ~/.claude/skills/use-codex-appserver/scripts/codex-query.ts

# 2. Codex side — active turns and, if a maestro run is live, per-thread detail:
node $SCRIPT active
node $SCRIPT read <threadId>        # per thread of interest (status, last item)

# 3. Maestro bookkeeping (if present in the target repo):
cat <repo>/.maestro/state.json      # units: slug, threadId/handle, performer, phase, branch, baseline
```

Claude side *(judgment)*: enumerate your own currently running background subagents/tasks from this session's task list and live agent handles — name, what they're doing, elapsed. `[live: if you cannot enumerate them in this harness, state that limit instead of omitting the column]`

## Render *(judgment)*

One markdown table, columns exactly:

`UNIT | PERFORMER | THREAD/HANDLE | MODEL | PHASE/STATUS | LAST EVENT | ELAPSED`

- Codex sessions: from `active`/`read` + state.json labels (unit slug, branch, phase). Threads with no state.json unit → UNIT `-`.
- Claude subagents: PERFORMER `claude`, THREAD/HANDLE = task/agent label, phase from what you know as their dispatcher.
- state.json units not yet closed out but with no live performer → include, marked accordingly (e.g. `rework`, `parked`).
- Empty state: say "no active performers" honestly — never invent rows. Still list open state.json units if any.
- After the table, one line per anomaly worth flagging (stalled turn, orphaned worktree, degraded unit awaiting review).

## Live monitor alternative

For a self-refreshing codex-side view in a separate terminal (codex sessions only — no Claude subagents):

```sh
node <maestro-repo>/scripts/codex-query.ts workflows --watch
```

Mention this once when the user seems to want continuous monitoring; do not spawn it yourself.

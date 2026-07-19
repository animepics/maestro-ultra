## What & why

<!-- One or two sentences: what changes, and what problem it solves. -->

## Area

- [ ] Skill (`skills/maestro/SKILL.md` or references)
- [ ] Transport (`scripts/`) — keep the diff vs upstream minimal and note it in `scripts/ATTRIBUTION.md`
- [ ] Install / preflight (`install.sh`, README prerequisites)
- [ ] Docs

## Verification

<!-- Evidence, not claims. Check what applies and paste the key output. -->

- [ ] `cd scripts && npm run check` green (biome + tsc + tests) — required for any `scripts/` change
- [ ] `sh -n install.sh` — required for install.sh changes
- [ ] Skill-behavior changes exercised against a **real dispatched Codex session** (paste the condensed transcript: dispatch → verify)
- [ ] Docs-only change (no runtime verification needed)

```text
(verification output here)
```

## Notes for the reviewer

<!-- Anything non-obvious: tradeoffs, follow-ups, what you deliberately did NOT do. -->

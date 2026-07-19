# Contributing to maestro

Thanks for helping conduct. This is a small, sharply-scoped project — the bar for merging is evidence, not vibes.

## Ground rules

1. **Judgment in prose, mechanics in templates.** The skill (`skills/maestro/SKILL.md`) separates judgment steps (Claude reasons) from mechanics (verbatim command templates that encode correctness: baseline capture, worktree isolation, backgrounded `msg --approve`, diff-vs-baseline verification). Don't soften a mechanics template into prose, and don't hard-code a judgment call.
2. **The transport stays close to upstream.** `scripts/` is vendored from the use-codex-appserver skill. Keep maestro-local changes minimal and record every intentional divergence in `scripts/ATTRIBUTION.md`.
3. **Answers are claims; diffs are evidence.** Any change to the verification flow must preserve this: a session's self-report is never accepted as proof.
4. **No speculative features.** The same anti-overengineering rule maestro imposes on Codex applies to maestro itself.

## Dev setup

```sh
git clone https://github.com/animepics/maestro-ultra.git && cd maestro-ultra
./install.sh          # symlinks the skill, installs transport deps
cd scripts && npm run check   # biome + tsc --noEmit + node --test — must be green
```

## Testing changes

- **Transport changes** (`scripts/`): `npm run check` is mandatory. Add/extend a test in `scripts/lib/*.test.ts` for any new flag or behavior.
- **Skill changes** (`SKILL.md`, references): exercise the changed path against a real Codex session — a scratch git repo, one dispatch, one verification. Paste the condensed transcript in your PR.
- **install.sh**: `sh -n install.sh`, plus an end-to-end run with an isolated `HOME` if you touched the clone/symlink logic.

## Commit / PR conventions

- Small, focused commits; message says what and why.
- PRs follow the template — the Verification section is not optional.
- One logical change per PR. Cleanup and features don't mix.

## Reporting bugs

Use the bug template. The four diagnostics that matter most: `codex login status`, `node scripts/codex-query.ts status`, the thread `read` transcript, and `git worktree list` in the target repo.

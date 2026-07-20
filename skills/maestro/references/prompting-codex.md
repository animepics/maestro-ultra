# Prompting Codex sessions

Every prompt maestro sends into a Codex session (`msg`, first message, `steer`) is a prompt to the session's underlying model (GPT-5.x class). This shape is mandatory — never send a bare one-liner as a task prompt.

**EVERY PROMPT MUST BE WRITTEN IN ENGLISH. NO EXCEPTIONS.** Codex models' instruction following and reasoning are strongest in English. When the surrounding conversation is in another language, translate the task into English before sending. Only code identifiers, file paths, error messages, and literal strings stay verbatim.

*(Adapted from the use-codex-appserver skill's prompting reference.)*

## Required task-prompt shape

The model is outcome-first: define the destination, constraints, and evidence, then let it choose the path. Every dispatch prompt MUST contain these sections, each kept short (1–3 lines):

```text
## Read first
[OPTIONAL — non-trivial units only. Resolved absolute paths to the selected
strategy skills (SKILL.md Phase 2: mapping table, cap 3, verification-discipline
always). Omit the whole section for trivial units.]
Before writing any code, READ these files fully — they define the reasoning
discipline required for this task:
- /abs/path/to/skills/<axis-1>/SKILL.md
- /abs/path/to/skills/<axis-2>/SKILL.md

## Goal
[user-visible outcome, 1-2 sentences]

## Do
[scope, files/areas in play, constraints that matter, context the session
cannot derive. For parallel units: "Commit all your work on the current
branch (maestro/<unit-slug>)"]

## Don't
[true invariants only — actions that must never happen. 3 lines max.]

## Expected result
[success criteria: what must be true before the final answer]

## Test
[exact validation commands the session must run before finishing, and what
passing looks like]

Acceptance criteria:
1. [testable criterion — verbatim, these are what maestro will verify against]
2. ...
```

## Rules that bite

- **Destination, not procedure.** Don't send "first do A, then B, then C" scripts — process-heavy prompts narrow the model's search space.
- **ALWAYS/NEVER are for true invariants only.** Judgment calls go under Do as decision rules.
- **Name file paths instead of pasting contents** — the session has filesystem access in its cwd.
- **`steer` is a delta, not a re-prompt.** Send only what changed: the corrected constraint and updated Expected result. Never replay the original prompt.
- **Acceptance criteria must be falsifiable.** Each names a mechanical check and at least one names a failure mode (malformed/empty/boundary): *"parses X"* is not a criterion (it passes as long as anything happens); *"errors explicitly on a malformed X"* is. See SKILL.md Phase 1's criteria-quality gate.
- A long Don't section means the Goal is underspecified.

## Example 1 — single-unit dispatch (real, from maestro's smoke test)

```text
## Goal
Create a file named hello.txt in the repository root containing exactly the line: hello maestro

## Do
- Create hello.txt in the current working directory (the repo root)
- Its full content must be exactly 'hello maestro' followed by a single trailing newline

## Don't
- Do not modify README.md or any other file
- Do not commit

## Expected result
- hello.txt exists at the repo root with content 'hello maestro\n'

## Test
- cat hello.txt prints: hello maestro
- git status shows only hello.txt as untracked; no other changes

Acceptance criteria:
1. hello.txt exists at repo root
2. content is exactly 'hello maestro' + newline
3. no other file touched
```

## Example 2 — parallel-unit dispatch (real, from maestro's parallel smoke test)

```text
## Goal
Create the directory 'a' with a file a/alpha.txt containing exactly the line: alpha

## Do
- Create a/alpha.txt in the current working directory (repo root); content exactly 'alpha' + one trailing newline
- Commit all your work on the current branch (maestro/unit-a) with message 'unit-a: add alpha'

## Don't
- Do not touch any path outside the a/ directory
- Do not switch branches

## Expected result
- a/alpha.txt exists with content 'alpha\n', committed on branch maestro/unit-a

## Test
- cat a/alpha.txt prints: alpha
- git log --oneline -1 shows the unit-a commit; git status is clean

Acceptance criteria:
1. a/alpha.txt exists, content exactly 'alpha' + newline
2. committed on current branch, clean tree
3. no path outside a/ touched
```

## Anti-patterns

| Sending | Why it fails | Instead |
|---|---|---|
| Bare one-liner ("fix the bug") | No success criteria — the session guesses scope | Full shape above, even one line per section |
| Step-by-step process script | Over-specifies the path; models perform worse | Goal + constraints + success criteria |
| Whole file contents pasted in | Wastes tokens, drifts from disk | Paths plus one line on what matters |
| "Be careful" / vague quality demands | Zero information | Concrete Expected result + Test commands |

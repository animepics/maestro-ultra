#!/bin/sh
# maestro installer: global skill symlink + transport deps
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_LINK="$HOME/.claude/skills/maestro"

echo "==> Installing transport dependencies (scripts/)"
if command -v npm >/dev/null 2>&1; then
  (cd "$REPO_DIR/scripts" && npm install --no-audit --no-fund)
elif command -v bun >/dev/null 2>&1; then
  (cd "$REPO_DIR/scripts" && bun install)
else
  echo "ERROR: need npm or bun to install transport dependencies" >&2
  exit 1
fi

echo "==> Linking skill to $SKILL_LINK"
mkdir -p "$HOME/.claude/skills"
if [ -e "$SKILL_LINK" ] || [ -L "$SKILL_LINK" ]; then
  if [ "$(readlink "$SKILL_LINK" 2>/dev/null)" = "$REPO_DIR/skills/maestro" ]; then
    echo "    already linked correctly, skipping"
  else
    echo "ERROR: $SKILL_LINK already exists and points elsewhere — remove it first" >&2
    exit 1
  fi
else
  ln -s "$REPO_DIR/skills/maestro" "$SKILL_LINK"
fi

echo "==> Done. Next steps:"
echo "    1. Make sure the Codex CLI is installed and 'codex app-server' is running"
echo "    2. Open Claude Code and run: /maestro \"your task\""
echo "    (Preflight inside the skill validates the full setup before any dispatch.)"

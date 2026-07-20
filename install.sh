#!/bin/sh
# maestro installer — works both ways:
#   curl -fsSL https://raw.githubusercontent.com/animepics/maestro-ultra/main/install.sh | sh
#   ./install.sh   (from a local checkout)
set -e

REPO_URL="https://github.com/animepics/maestro-ultra.git"

# Local checkout if the script sits next to skills/maestro; otherwise clone/update.
SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
if [ -n "$SELF_DIR" ] && [ -f "$SELF_DIR/skills/maestro/SKILL.md" ]; then
  REPO_DIR="$SELF_DIR"
else
  REPO_DIR="${MAESTRO_DIR:-$HOME/.maestro}"
  if [ -d "$REPO_DIR/.git" ]; then
    echo "==> Updating existing clone at $REPO_DIR"
    git -C "$REPO_DIR" pull --ff-only
  else
    echo "==> Cloning maestro to $REPO_DIR"
    git clone "$REPO_URL" "$REPO_DIR"
  fi
fi

echo "==> Installing transport dependencies (scripts/)"
if command -v npm >/dev/null 2>&1; then
  (cd "$REPO_DIR/scripts" && npm install --no-audit --no-fund)
elif command -v bun >/dev/null 2>&1; then
  (cd "$REPO_DIR/scripts" && bun install)
else
  echo "ERROR: need npm or bun to install transport dependencies" >&2
  exit 1
fi

echo "==> Linking skills into ~/.claude/skills/"
mkdir -p "$HOME/.claude/skills"
for SKILL_DIR in "$REPO_DIR"/skills/*/; do
  NAME="$(basename "$SKILL_DIR")"
  LINK="$HOME/.claude/skills/$NAME"
  if [ -e "$LINK" ] || [ -L "$LINK" ]; then
    if [ "$(readlink "$LINK" 2>/dev/null)" = "${SKILL_DIR%/}" ]; then
      echo "    $NAME: already linked, skipping"
    else
      echo "    $NAME: SKIPPED — $LINK exists and points elsewhere (remove it to relink)"
    fi
  else
    ln -s "${SKILL_DIR%/}" "$LINK"
    echo "    $NAME: linked"
  fi
done

echo "==> Done. Next steps:"
echo "    1. Install the Codex CLI and sign in: codex login"
echo "       (requires a ChatGPT account with an eligible plan — Plus/Pro/Team/Enterprise)"
echo "    2. Start the app-server: codex app-server"
echo "    3. Open Claude Code and run: /maestro \"your task\""
echo "    (Preflight inside the skill validates the full setup before any dispatch.)"
if command -v codex >/dev/null 2>&1; then
  codex login status >/dev/null 2>&1 || echo "NOTE: codex is installed but you are NOT logged in — run: codex login"
else
  echo "NOTE: codex CLI not found on PATH — install it before using maestro"
fi

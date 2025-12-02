#!/usr/bin/env bash
set -euo pipefail

echo "========================================"
echo "   <0001dep>  Fetti Deploy Helper"
echo "========================================"
echo ""

# Safety: refuse to deploy from the wrong folder
if [ ! -f "package.json" ] || [ ! -d ".git" ]; then
  echo "[DEPLOY] Not in a git project with package.json. Aborting."
  exit 1
fi

echo "[DEPLOY] Running local build check..."
# Run build to ensure no errors before pushing
if ! npm run build; then
  echo "[DEPLOY] ❌ Local build failed. Fix errors before deploying."
  exit 1
fi
echo "[DEPLOY] ✅ Local build passed."

echo "[DEPLOY] Git status:"
git status --short || true
echo ""

# 1) Never auto-commit. If there are uncommitted changes, bail.
if [ -n "$(git status --porcelain)" ]; then
  echo "[DEPLOY] Working tree is NOT clean."
  echo "[DEPLOY] Please commit or stash your changes before deploying."
  echo "[DEPLOY] Aborting deploy to avoid overwriting or deploying partial work."
  exit 1
fi

# 2) Confirm we are on main
current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current_branch" != "main" ]; then
  echo "[DEPLOY] You are on branch '$current_branch', not 'main'."
  echo "[DEPLOY] Either switch to 'main' or update this script if you intend to deploy another branch."
  exit 1
fi

echo "[DEPLOY] Pushing branch: $current_branch"
git push origin "$current_branch"

echo ""
echo "✅ Deploy push sent to remote. Vercel will pick this up and deploy."

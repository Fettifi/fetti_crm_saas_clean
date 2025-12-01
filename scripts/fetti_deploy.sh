#!/usr/bin/env bash
set -euo pipefail

echo "========================================"
echo "   <0001dep>  Fetti Deploy Helper"
echo "========================================"

# Make sure we are in the project root
cd "$(dirname "$0")/.."

echo ""
echo "[DEPLOY] Git status:"
git status --short

# Check for uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo ""
  echo "[DEPLOY] You have local changes."
  echo "[DEPLOY] Creating a commit before pushing..."

  git add .

  # Use a generic message; you can edit later if you want finer control
  git commit -m "chore: auto-deploy from Fetti Doctor pipeline" || true
else
  echo ""
  echo "[DEPLOY] No changes to commit."
fi

# Show current branch
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo ""
echo "[DEPLOY] Pushing branch: $BRANCH"
git push origin "$BRANCH"

echo ""
echo "✅ Deploy push sent to remote. Vercel will pick this up and deploy."

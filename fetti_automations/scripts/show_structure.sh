#!/bin/bash
# Show the Fetti automations folder structure and files.

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Fetti Automations – Folder Structure"
echo "Base: $BASE_DIR"
echo

cd "$BASE_DIR" || exit 1

echo "Directories:"
find . -maxdepth 3 -type d | sed 's|^\./||'
echo
echo "Files:"
find . -maxdepth 3 -type f | sed 's|^\./||'

#!/bin/zsh
# Double-click to scan a document straight into a loan file.
REPO="/Users/fetti/Desktop/fetti_crm_saas_clean_fresh"
cd "$REPO" || { echo "CRM folder not found at $REPO"; read -k 1; exit 1; }

# ORDER MATTERS HERE. Setting PATH after sourcing nvm wipes the node/bin entry nvm just
# prepended, which silently drops this back to the system Node 18 — where tsx fails to load the
# CRM. Set the base PATH first, then let nvm put its version in front of it.
export PATH="$HOME/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
  nvm use default >/dev/null 2>&1
fi

MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)
if [ -z "$MAJOR" ] || [ "$MAJOR" -lt 20 ]; then
  echo "This needs Node 20 or newer; found ${MAJOR:-none}."
  echo "Open Terminal and run:  nvm install 20 && nvm alias default 20"
  echo; echo "Press any key to close…"; read -k 1; exit 1
fi

npx tsx scripts/scan-to-file.ts
echo; echo "Press any key to close…"; read -k 1
exit 0

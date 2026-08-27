#!/bin/zsh
# Double-click to let the CRM's Scan buttons reach the office scanner.
# Leave this window open while you're scanning; close it when you're done.
REPO="/Users/fetti/Desktop/fetti_crm_saas_clean_fresh"
cd "$REPO" || { echo "CRM folder not found at $REPO"; read -k 1; exit 1; }

# PATH first, then nvm — setting it afterwards wipes nvm's entry and drops to the system Node 18,
# where tsx cannot load the CRM.
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

# Already running? Don't start a second one fighting for the port.
if curl -s -m 2 http://127.0.0.1:3401/health >/dev/null 2>&1; then
  echo "The scan agent is already running. You can close this window."
  echo; echo "Press any key to close…"; read -k 1; exit 0
fi

echo "Starting the Fetti scan agent…"
echo "Keep this window open, then use the Scan buttons in the CRM."
echo
npx tsx scripts/scan-agent.ts
echo; echo "The scan agent stopped. Press any key to close…"; read -k 1

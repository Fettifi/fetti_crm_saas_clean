#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

echo "➡ Loading Supabase env from .env.local…"

# Load SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
set -a
source .env.local
set +a

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "❌ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env.local"
  exit 1
fi

EMAIL="ramon@fettifi.com"
PASSWORD="Fetti$uper123!"   # you can change this if you want

echo "➡ Creating Supabase user \$EMAIL …"

curl -sS "${SUPABASE_URL}/auth/v1/admin/users" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  --data '{"email":"'"$EMAIL"'","password":"'"$PASSWORD"'","email_confirm":true}'

echo
echo "✅ Done."
echo "   Email:    \$EMAIL"
echo "   Password: \$PASSWORD"

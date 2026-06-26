# Fetti Dictate — Outlook add-in

Speak a rough note → polished, professional email inserted into your Outlook draft.
Powered by the CRM's own OpenAI keys (Whisper for speech-to-text, GPT for the rewrite).

## Pieces
- **Web (served from `app.fettifi.com/outlook/`)** — `public/outlook/`
  - `taskpane.html` — the side-panel UI (record → transcribe → compose → insert). No secrets.
  - `commands.html` — required FunctionFile for the ribbon button.
  - `index.html` — install instructions page.
  - `assets/icon-*.png` — ribbon + store icons (from `fetti-emblem.png`).
- **API (`app/api/outlook/`)**
  - `transcribe/route.ts` — OpenAI Whisper. Bearer-gated + rate-limited.
  - `compose/route.ts` — OpenAI GPT, professional-email prompt. Bearer-gated + rate-limited.
  - `lib/outlookEmail.ts` — the email prompt + tone presets (NOT the Mark persona).
  - `lib/outlookAuth.ts` — bearer-token gate (fail-closed).
- **Headers** — `next.config.mjs` gives `/outlook/*` a frame-friendly CSP (Office.js CDN allowed,
  no X-Frame-Options / frame-ancestors) so Outlook can host the pane. All other routes unchanged.

## Security model
- `/api/outlook/*` is intentionally open in `proxy.ts` (the pane has no CRM login), so each route
  enforces a **bearer token** = `OUTLOOK_ADDIN_KEY` (Vercel env). Fail-closed: no key set → 503.
- The token rides in the **manifest** (`taskpane.html?k=<token>`), never in any served HTML.
  Worst case if it leaks: rate-limited OpenAI usage (60/min/IP). No data access.
- The **real manifest is never hosted/committed** — only the placeholder template here.

## Regenerate the installable manifest
```bash
GUID=4adf61a3-8c21-4b8c-9816-7055befcab42   # stable; reuse so re-installs replace cleanly
TOKEN=<value of OUTLOOK_ADDIN_KEY in Vercel>
sed -e "s/__GUID__/$GUID/" -e "s#__TOKEN__#$TOKEN#" \
  outlook-addin/manifest.template.xml > ~/Desktop/Fetti-Outlook-Dictate.xml
```
Then in Outlook: **Apps → Get Add-ins → My add-ins → Custom Add-ins → Add from File…** → pick the file.

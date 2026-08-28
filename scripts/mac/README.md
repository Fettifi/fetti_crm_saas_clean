# The two files that live outside this repo

The scanner is two tools over the same parts. Some of the pieces live on the Mac, not in git:

| Piece | Lives at | What it does |
|---|---|---|
| `scripts/scan-to-file.ts` | in the repo | the menus, the upload, the filing |
| `scan` | `~/bin/scan` | talks to the Canon over eSCL and writes a PDF |
| `Fetti Scanner.command` | `~/Desktop/Fetti Scanner.command` | the Terminal tool — pick a borrower, scan |
| `scripts/scan-agent.ts` | in the repo | local server the CRM's Scan buttons call |
| `Fetti Scanner Agent.command` | `~/Desktop/Fetti Scanner Agent.command` | starts that agent |
| `lib/scanFile.ts` | in the repo | the filing itself — both tools call it |

The bottom two are on the Mac, not in git, so copies live here. They are copies, not symlinks —
editing the ones in this folder changes nothing until you install them:

```
cp scripts/mac/scan ~/bin/scan && chmod +x ~/bin/scan
cp "scripts/mac/Fetti Scanner.command" ~/Desktop/ && chmod +x ~/Desktop/"Fetti Scanner.command"
cp "scripts/mac/Fetti Scanner Agent.command" ~/Desktop/ && chmod +x ~/Desktop/"Fetti Scanner Agent.command"
```

`scan` finds the scanner in this order: `--host`, then `Canona9e13b.lan`, then `~/.canon-scan-host`,
then a sweep of the subnet. It needs no driver and no toner — eSCL is plain HTTP and is completely
independent of the print engine, which is why an empty cartridge does not stop a scan.


## The Scan button in the CRM

`app.fettifi.com` cannot reach the Canon — the CRM is in the cloud and the scanner is on the
office LAN. The browser is the only thing on both networks, so the Scan buttons call the agent on
`http://127.0.0.1:3401`.

Two things had to be true for that to work, and both bit:

1. **The CRM's own CSP blocked it.** `connect-src` is an allow-list and loopback was not on it, so
   the call died before mixed-content or private-network rules were even consulted. `next.config.mjs`
   now allows `http://127.0.0.1:3401`.
2. **Chrome 138+ gates local network access behind a permission.** Until it is granted the request
   does not fail — it HANGS, with nothing in the console. Confirmed on Chrome 151:
   `navigator.permissions.query({name:"local-network-access"})` returned `prompt` while the fetch
   sat pending forever. The dialog therefore connects on a CLICK, so Chrome has a gesture to hang
   the prompt on, and every call carries its own deadline.

Loopback origins are not gated this way, which is why a dev server on `http://localhost:<port>`
talks to the agent with no prompt at all.


## Auto-start

The agent runs as a user LaunchAgent so the CRM's Scan buttons always find it:

- `~/bin/fetti-scan-agent` — wrapper that fixes PATH/nvm, then runs the agent
- `~/Library/LaunchAgents/com.fetti.scanagent.plist` — RunAtLoad, restarts on a crash
- log: `~/Library/Logs/fetti-scan-agent.log`

Verified by killing it: launchd had it back in about ten seconds.

```bash
# status / restart / stop for good
launchctl list | grep scanagent
launchctl kickstart -k gui/$(id -u)/com.fetti.scanagent
launchctl bootout gui/$(id -u)/com.fetti.scanagent && rm ~/Library/LaunchAgents/com.fetti.scanagent.plist
```

`Fetti Scanner Agent.command` on the Desktop still works and is now just a manual fallback — it
detects an agent that is already running and says so instead of fighting for the port.

// THE LOCAL SCAN AGENT — what the Scan button in the CRM actually talks to.
//
// The CRM runs at app.fettifi.com and the Canon is on the office LAN, so the cloud can never
// reach the scanner. The browser can: it is sitting on both networks at once. This is a small
// HTTP server on 127.0.0.1 that the CRM page calls to scan a page and file it.
//
// SECURITY — why there is no password on this.
//
// The danger is not "someone in the office"; it is that ANY website Ramon has open could POST to
// 127.0.0.1 and drive his scanner or drop files on his Mac. Three things close that:
//
//   1. It binds to 127.0.0.1 only, so nothing off this machine can reach it at all.
//   2. Every request that DOES anything must carry an Origin this file allows. A browser sets
//      Origin itself and a page cannot forge it, so evil.com's request is refused before the
//      scanner is touched — this is what stops the silent cross-site request, not CORS, which
//      only governs whether a reply can be READ.
//   3. Writes are confined to the allow-listed folders in lib/scanFile.ts, resolved through
//      symlinks, so no crafted path can land a file somewhere macOS would later execute.
//
// A shared secret would add nothing here: anything running locally that could steal it already
// has .env.local and the service-role key sitting next to it.
import "./_env";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { scanToPdf, shrinkIfNeeded, fileScannedDocument, ALLOWED_ROOTS, MIRROR_ROOT, assertAllowedDir } from "../lib/scanFile";
import { loanFolderName } from "../lib/docNaming";

const PORT = Number(process.env.SCAN_AGENT_PORT || 3401);
const VERSION = "1.0.0";

// Exactly one remote origin, plus any loopback port so a dev server can be on whatever port it
// lands on. Loopback is not a loophole: a page can only be served from localhost if something on
// this machine is already serving it, and anything with that much access has .env.local too.
const REMOTE_ORIGIN = "https://app.fettifi.com";
const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const originAllowed = (o: string) => o === REMOTE_ORIGIN || LOOPBACK.test(o);

function cors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = String(req.headers.origin || "");
  if (origin && originAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");
    // Chrome's Private Network Access check: a public page reaching a loopback address is
    // preflighted, and the reply must say this out loud or the request never happens.
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    return true;
  }
  return false;
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

async function scannerReachable(): Promise<{ reachable: boolean; host: string }> {
  const hostFile = join(homedir(), ".canon-scan-host");
  const host = (existsSync(hostFile) ? readFileSync(hostFile, "utf8").trim() : "") || "Canona9e13b.lan";
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    const r = await fetch(`http://${host}/eSCL/ScannerStatus`, { signal: ctl.signal });
    clearTimeout(t);
    return { reachable: r.ok, host };
  } catch { return { reachable: false, host }; }
}

const readBody = (req: IncomingMessage): Promise<any> => new Promise((resolve) => {
  let d = ""; req.on("data", (c) => { d += c; if (d.length > 1e6) req.destroy(); });
  req.on("end", () => { try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); } });
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  if (process.env.SCAN_AGENT_DEBUG) console.log(`${req.method} ${url.pathname} origin=${req.headers.origin || "-"} pna=${req.headers["access-control-request-private-network"] || "-"}`);
  const allowed = cors(req, res);

  if (req.method === "OPTIONS") { res.writeHead(allowed ? 204 : 403); return res.end(); }

  // /health is the only thing an unknown origin may call, and it answers with nothing sensitive —
  // the CRM uses it to tell "the agent isn't running" from "the scanner is unplugged".
  if (url.pathname === "/health") {
    const sc = await scannerReachable();
    return json(res, 200, { ok: true, agent: VERSION, scanner: sc, roots: ALLOWED_ROOTS().map((r) => r.replace(homedir(), "~")) });
  }

  if (!allowed) return json(res, 403, { error: "This scanner agent only answers the Fetti CRM." });

  try {
    if (url.pathname === "/destinations" && req.method === "GET") {
      const fileId = url.searchParams.get("fileId") || "";
      let borrowerFolder: string | null = null;
      if (fileId) {
        const { data } = await supabaseAdmin.from("loan_files").select("id,borrower_name,file_number").eq("id", fileId).maybeSingle();
        if (data) borrowerFolder = join(MIRROR_ROOT(), loanFolderName((data as any).borrower_name, (data as any).file_number, (data as any).id));
      }
      return json(res, 200, {
        default: borrowerFolder,
        options: [
          ...(borrowerFolder ? [{ label: "The borrower's loan folder (recommended)", path: borrowerFolder }] : []),
          { label: "Desktop", path: join(homedir(), "Desktop") },
          { label: "Documents", path: join(homedir(), "Documents") },
          { label: "Downloads", path: join(homedir(), "Downloads") },
          { label: "Fetti Clients", path: join(homedir(), "Fetti Clients") },
          { label: "Fetti Legal", path: join(homedir(), "Fetti Legal") },
        ],
        home: homedir(),
      });
    }

    if (url.pathname === "/scan" && req.method === "POST") {
      const b = await readBody(req);
      const source = b?.source === "adf" ? "adf" : "glass";
      const fileId = String(b?.fileId || "");
      const docName = String(b?.docName || "").trim();
      const docId = b?.docId ? String(b.docId) : null;
      const destDir = b?.destDir ? String(b.destDir) : null;
      const attach = b?.attach !== false;

      if (!docName) return json(res, 400, { error: "Give the document a name." });
      if (attach && !fileId) return json(res, 400, { error: "No loan file was given." });
      if (destDir) { try { assertAllowedDir(destDir); } catch (e: any) { return json(res, 400, { error: e.message }); } }

      let file: any = { id: fileId };
      if (fileId) {
        const { data } = await supabaseAdmin.from("loan_files").select("id,borrower_name,file_number").eq("id", fileId).maybeSingle();
        if (!data) return json(res, 404, { error: "That loan file no longer exists." });
        file = data;
      }

      const notes: string[] = [];
      const raw = await scanToPdf(source);
      const bytes = await shrinkIfNeeded(raw, (n) => notes.push(n));
      const out = await fileScannedDocument({ file, docName, bytes, existingDocId: docId, destDir, attachToLoanFile: attach });
      console.log(`filed: ${out.name} (${(out.bytes / 1048576).toFixed(1)} MB) -> ${out.localPath}`);
      return json(res, 200, { ok: true, ...out, localPath: out.localPath?.replace(homedir(), "~"), notes });
    }
  } catch (e: any) {
    console.error("scan failed:", e?.message || e);
    return json(res, 500, { error: e?.message || "The scan failed." });
  }

  return json(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Fetti scan agent v${VERSION} — listening on http://127.0.0.1:${PORT}`);
  console.log(`Serving: ${REMOTE_ORIGIN} and any http://localhost:<port>`);
  console.log("Leave this window open. The Scan buttons in the CRM use it.\n");
});

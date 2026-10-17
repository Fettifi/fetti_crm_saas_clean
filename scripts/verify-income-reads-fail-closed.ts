// A FAILED READ IS NOT AN EMPTY ONE — ON THE INCOME ROUTE.
//
// 2026-10-17 autopilot. app/api/los/files/[id]/verify-income/route.ts read loan_files, leads and
// loan_documents as `const { data } = …` and never looked at `error`. supabase-js does not throw on
// a failed query — it hands back { data: null, error }. So a transient outage became a confident,
// false answer on each read:
//
//   loan_files      → 404 "Loan file not found."  (the file exists)
//   leads           → the URLA was assembled with no lead; loanType fell back to conventional on an
//                     FHA file, and the income ran under the wrong programme
//   loan_documents  → 422 "No income documents are uploaded on this file yet … Request and collect
//                     them first." — an instruction to ask the borrower for documents we hold
//
// This runs the SHIPPING POST handler, not a regex over it. It points the real supabase-js client at
// a local stand-in PostgREST that fails exactly one table per case, and asserts the route refuses
// with 503. A control case (every read succeeds, the file genuinely has no documents) must still
// reach the real 422, so the harness is proven to drive the route past each read rather than
// failing early for some unrelated reason. No borrower data is involved: the inputs are
// infrastructure failures, and the loan row is a bare id. Nothing leaves 127.0.0.1 — the
// Anthropic key is a placeholder and every case returns before any document is read.
//
//   npm run verify:income-reads-fail-closed
import http from "http";
import type { AddressInfo } from "net";

let failed = 0;
const chk = (ok: boolean, msg: string) => { console.log(`  ${ok ? "ok  " : "FAIL"}  ${msg}`); if (!ok) failed++; };

type Mode = { fail?: "loan_files" | "leads" | "loan_documents"; leadId?: string | null };
let mode: Mode = {};
const hits: string[] = [];

const server = http.createServer((req, res) => {
  const table = (req.url || "").split("?")[0].replace(/^\/rest\/v1\//, "");
  hits.push(table);
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (mode.fail === table) return send(500, { message: "simulated outage", code: "XX000", details: null, hint: null });
  const wantsObject = /vnd\.pgrst\.object/.test(String(req.headers.accept || ""));
  let rows: any[] = [];
  if (table === "loan_files") rows = [{ id: "00000000-0000-0000-0000-00000000f11e", lead_id: mode.leadId ?? null, borrower_name: "Guard Fixture" }];
  else if (table === "leads") rows = [{ id: mode.leadId }];
  else if (table === "loan_documents") rows = [];
  return send(200, wantsObject ? (rows[0] ?? null) : rows);
});

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  // Before the route module loads: lib/supabaseAdminClient.ts builds its client at import time.
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "guard-placeholder-not-a-key";
  process.env.ANTHROPIC_API_KEY = "guard-placeholder-not-a-key";

  const { NextRequest } = await import("next/server");
  const { POST } = await import("../app/api/los/files/[id]/verify-income/route");
  const call = async () => {
    const req = new NextRequest("http://127.0.0.1/api/los/files/x/verify-income", { method: "POST" });
    const res: Response = await POST(req as any, { params: Promise.resolve({ id: "00000000-0000-0000-0000-00000000f11e" }) });
    let body: any = null;
    try { body = await res.json(); } catch { /* not json */ }
    return { status: res.status, error: String(body?.error || "") };
  };

  console.log("\nINCOME ROUTE — a failed read refuses; it is never read as empty\n");

  // CONTROL — every read succeeds and there genuinely are no documents. Must reach the real 422.
  mode = { leadId: "00000000-0000-0000-0000-0000000001ea" }; hits.length = 0;
  const ctl = await call();
  chk(ctl.status === 422 && /No income documents/.test(ctl.error), `control: all reads succeed, no documents → 422 "No income documents" (got ${ctl.status})`);
  chk(["loan_files", "leads", "loan_documents"].every((t) => hits.includes(t)), `control: the route actually read loan_files, leads and loan_documents (read ${[...new Set(hits)].join(", ") || "nothing"})`);

  mode = { fail: "loan_files" };
  const a = await call();
  chk(a.status === 503, `loan_files read fails → 503, not "Loan file not found" (got ${a.status}: ${a.error.slice(0, 60)})`);

  mode = { fail: "leads", leadId: "00000000-0000-0000-0000-0000000001ea" };
  const b = await call();
  chk(b.status === 503, `leads read fails → 503, not a URLA assembled without the lead (got ${b.status}: ${b.error.slice(0, 60)})`);

  mode = { fail: "loan_documents" };
  const c = await call();
  chk(c.status === 503, `loan_documents read fails → 503 (got ${c.status}: ${c.error.slice(0, 60)})`);
  chk(!/Request and collect them/.test(c.error), `…and it never tells the LO to ask the borrower for documents`);

  server.close();
  console.log(failed ? `\nFAIL — ${failed} check(s)\n` : `\nPASS — every read on the income route fails closed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("FAIL — harness error:", e); server.close(); process.exit(1); });

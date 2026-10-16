// BORROWER DOCUMENTS MUST NOT BE READABLE WITHOUT A CREDENTIAL — CHECKED AGAINST PRODUCTION.
//
// 2026-10-16. supabase/migrations/20251202081206_create_storage_bucket.sql creates the 'documents'
// bucket with `public = true` and grants BLANKET anon insert AND select on every object in it:
//
//     create policy "Public Uploads"   ... for insert with check ( bucket_id = 'documents' )
//     create policy "Public Downloads" ... for select using  ( bucket_id = 'documents' )
//
// On a mortgage CRM those objects are pay stubs, bank statements, tax returns and government IDs.
//
// Production was measured before anything was changed, and was NOT exposed: both document buckets
// read public=false, an anonymous list returns [], and a real borrower document answered
// service-role 200 / anon 400 / public-URL 400. Someone had flipped the bucket private after that
// migration ran. The repo, however, still described the unsafe shape — so a fresh deploy, a branch
// database or a `supabase db reset` would recreate it in silence.
//
// A MIGRATION FILE IS NOT THE LIVE STATE, AND NEITHER IS A PREVIOUS GOOD READING. This guard asks
// the live project every run, because the thing that would re-open this hole is a dashboard toggle
// nobody commits. [[state-decays-reread-before-you-report]] · [[a-private-company-had-a-public-repo]]
//
//   npx tsx scripts/verify-storage-private.ts
import { readFileSync } from "fs";

const BUCKETS = ["loan-docs", "documents"];

function env(k: string): string {
  const f = readFileSync(".env.local", "utf8");
  const m = f.split("\n").find((l) => l.startsWith(k + "="));
  return m ? m.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : "";
}

async function run() {
  const url = env("NEXT_PUBLIC_SUPABASE_URL") || env("SUPABASE_URL");
  const srv = env("SUPABASE_SERVICE_ROLE_KEY");
  const anon = env("NEXT_PUBLIC_SUPABASE_ANON_KEY") || env("SUPABASE_ANON_KEY");
  let bad = 0;
  const ck = (n: string, ok: boolean, d = "") => { if (!ok) bad++; console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

  console.log("\nSTORAGE PRIVACY — asked of the live project\n");
  if (!url || !srv || !anon) { console.log("  ❌ UNREADABLE — missing Supabase env. Not a clean result.\n"); process.exit(1); }

  // 1. The buckets themselves. `public = true` is readable by URL with no token and no policy can undo it.
  const bRes = await fetch(`${url}/storage/v1/bucket`, { headers: { apikey: srv, Authorization: `Bearer ${srv}` } });
  const buckets = await bRes.json();
  if (!Array.isArray(buckets)) { console.log(`  ❌ UNREADABLE — ${String((buckets as any)?.message || bRes.status)}\n`); process.exit(1); }
  for (const name of BUCKETS) {
    const b = buckets.find((x: any) => x.name === name);
    if (!b) { console.log(`  ·  ${name} does not exist here — skipped`); continue; }
    ck(`${name} is NOT a public bucket`, b.public === false, `public=${b.public}`);
  }

  // 2. A real object, fetched three ways. This is the question that actually matters, and it is
  //    the one a bucket flag alone cannot answer — a policy can grant anon select on a private
  //    bucket. TRUE-COUNT DISCIPLINE: if there is no document to try, say so rather than pass.
  const dRes = await fetch(`${url}/rest/v1/loan_documents?select=storage_path&storage_path=not.is.null&limit=1`,
    { headers: { apikey: srv, Authorization: `Bearer ${srv}` } });
  const docs = await dRes.json();
  const path = Array.isArray(docs) && docs[0]?.storage_path;
  if (!path) {
    ck("a real document exists to test with", false, "no loan_documents row has a storage_path — this guard proved nothing");
  } else {
    const svc = await fetch(`${url}/storage/v1/object/loan-docs/${path}`, { headers: { apikey: srv, Authorization: `Bearer ${srv}` } });
    ck("the service role CAN read it (so the test is live, not a dead path)", svc.status === 200, `HTTP ${svc.status}`);
    const an = await fetch(`${url}/storage/v1/object/loan-docs/${path}`, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } });
    ck("the PUBLIC anon key CANNOT read a borrower document", an.status !== 200, `HTTP ${an.status}`);
    const pub = await fetch(`${url}/storage/v1/object/public/loan-docs/${path}`);
    ck("…and neither can a bare public URL with no key at all", pub.status !== 200, `HTTP ${pub.status}`);
  }

  // 3. Anonymous listing must not enumerate filenames — a filename alone leaks the borrower.
  for (const name of BUCKETS) {
    const r = await fetch(`${url}/storage/v1/object/list/${name}`, {
      method: "POST", headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: "", limit: 5 }),
    });
    const j = await r.json().catch(() => null);
    ck(`anon cannot enumerate ${name}`, !Array.isArray(j) || j.length === 0, `${Array.isArray(j) ? j.length : "?"} entr(y/ies)`);
  }

  // 4. The repo must not still describe the unsafe shape for a fresh deploy.
  const lockdown = readFileSync("supabase/migrations/20261016030000_storage_bucket_lockdown.sql", "utf8");
  ck("a corrective migration exists for fresh environments",
     /set public = false/.test(lockdown) && /drop policy if exists "Public Downloads"/.test(lockdown), "");

  console.log(bad ? `\n❌ ${bad} failed — borrower documents may be reachable without a credential.\n`
                  : "\n✅ CLEAN — both document buckets are private and anon is refused on a real file.\n");
  process.exit(bad ? 1 : 0);
}
run();

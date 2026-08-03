import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { leadReality } from "./lib/leadReality";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
(async () => {
  const { data: all } = await sb.from("leads").select("*").limit(2000);
  // 1. The two watch-range leads my simulation predicted would flip
  for (const nm of ["Muhammad Salman", "H"]) {
    const l = all!.find((x:any)=>x.full_name===nm);
    if (!l) { console.log("not found", nm); continue; }
    console.log(`\n${nm}: phone=${l.phone} stage=${l.stage} step=${l.nurture_step}`);
    console.log("  stored shield:", JSON.stringify((l as any).raw.shield));
    console.log("  leadReality  :", JSON.stringify(leadReality({raw:l.raw,name:l.full_name,email:l.email,phone:l.phone})));
  }
  // 2. leadDigest channel-quality: replicate lib/notify/leadDigest.ts:80-92 exactly
  const d7 = new Date(Date.now() - 7*86400000).toISOString();
  const week = all!.filter((l:any)=> l.created_at >= d7);
  const run = (useShield: boolean) => {
    const chan: Record<string,{total:number;bad:number}> = {};
    for (const l of week as any[]) {
      const raw = l.raw && typeof l.raw==="object" ? l.raw : {};
      const key = String(l.lead_source || l.source || "unknown").slice(0,40);
      chan[key] = chan[key] || {total:0,bad:0};
      chan[key].total++;
      const isBad = String(l.stage||"").toLowerCase()==="review" ||
        ["invalid","non_us"].includes(raw.phone_status) ||
        (useShield && raw.shield?.band && raw.shield.band !== "gray");
      if (isBad) chan[key].bad++;
    }
    return chan;
  };
  const withB = run(true), withoutB = run(false);
  console.log("\n=== leadDigest channel-quality (7d), lib/notify/leadDigest.ts:85-86 ===");
  for (const k of Object.keys(withB)) {
    const a = withoutB[k], b = withB[k];
    const pa = a.total?Math.round(a.bad/a.total*100):0, pb = b.total?Math.round(b.bad/b.total*100):0;
    console.log(`  ${k.padEnd(22)} total=${b.total}  bad BEFORE backfill=${a.bad} (${pa}%)  bad AFTER=${b.bad} (${pb}%)  ${b.total>=3 && b.bad/b.total>=0.25 ? "<-- FLAGGED 'CUT THIS PLACEMENT'":""} ${a.total>=3 && a.bad/a.total>=0.25?"(was already flagged)":""}`);
  }
  // 3. Does the flow still drop clean verdicts? count leads created since backfill
  const post = all!.filter((l:any)=> l.created_at > "2026-08-03T05:31:59Z");
  console.log("\nleads created after the backfill:", post.length);
})();

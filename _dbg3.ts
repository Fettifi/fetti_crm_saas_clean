import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { leadReality } from "./lib/leadReality";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
(async () => {
  const cutoff = new Date(Date.now() - 365*86400000).toISOString();
  const { data: all } = await sb.from("leads").select("*").limit(2000);
  const drip = all!.filter((l:any)=> l.created_at>=cutoff && !l.nurture_paused && String(l.stage||"").toLowerCase()!=="review" && (l.phone||l.email) && !/@fetti-internal\.test$/i.test(l.email||""));
  const dist: Record<string,number> = {};
  const flagged: any[] = [];
  for (const l of drip) { const r = leadReality({raw:l.raw,name:l.full_name,email:l.email,phone:l.phone}); dist[r.level]=(dist[r.level]||0)+1;
    if (r.level!=="real") flagged.push({name:l.full_name,email:l.email,stage:l.stage,step:l.nurture_step,level:r.level,reason:r.reason,band:l.raw?.shield?.band,risk:l.raw?.shield?.risk,by:l.raw?.shield?.screened_by}); }
  console.log("NOW drip-eligible:", drip.length, dist);
  for (const f of flagged) console.log(JSON.stringify(f));
  // screened_by census
  const by: Record<string,number> = {};
  for (const l of all!) { const k = String(l.raw?.shield?.screened_by ?? l.raw?.shield?.mode ?? "<other>"); by[k]=(by[k]||0)+1; }
  console.log("\nscreened_by census:", by);
  const times = all!.map((l:any)=>l.raw?.shield?.screened_at).filter(Boolean).sort();
  console.log("backfill write window:", times[0], "->", times[times.length-1], "count", times.length);
})();

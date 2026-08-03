import * as dotenv from "dotenv"; dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
(async () => {
  const names = ["Tajauana Bell","Sharon Wyche","Felicia house","Osakwe uchenna Christopher "];
  const { data: all } = await sb.from("leads").select("*").limit(2000);
  for (const n of names) {
    const l: any = all!.find((x:any)=>x.full_name===n); if (!l) { console.log("missing", n); continue; }
    const { data: acts } = await sb.from("activity_log").select("action, actor, detail, created_at").eq("lead_id", l.id).order("created_at",{ascending:false}).limit(200);
    const inb = (acts||[]).filter((a:any)=>a.action==="comms.message" && a.detail?.direction==="inbound");
    const out = (acts||[]).filter((a:any)=>a.action==="comms.message" && a.detail?.direction!=="inbound");
    const { data: lf } = await sb.from("loan_files").select("id").eq("lead_id", l.id).limit(1);
    console.log(`${n} | stage=${l.stage} step=${l.nurture_step} last_nurture=${l.last_nurture_at} paused=${l.nurture_paused}`);
    console.log(`   shield=${JSON.stringify(l.raw?.shield?.band)} risk=${l.raw?.shield?.risk} screened_by=${l.raw?.shield?.screened_by ?? "(pre-backfill)"}`);
    console.log(`   inbound=${inb.length} outbound=${out.length} loan_files=${(lf||[]).length} lastAct=${acts?.[0]?.action}@${acts?.[0]?.created_at}`);
  }
})();

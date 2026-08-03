import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { leadReality } from "./lib/leadReality";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
(async () => {
  const { data: leads } = await sb.from("leads").select("id, full_name, email, phone, stage, raw, nurture_paused, created_at").limit(2000);
  const shapes: Record<string, number> = {};
  for (const l of leads!) {
    const s = (l as any).raw?.shield;
    if (!s) { shapes["<none>"] = (shapes["<none>"]||0)+1; continue; }
    const k = Object.keys(s).sort().join(",");
    shapes[k] = (shapes[k]||0)+1;
  }
  for (const [k,v] of Object.entries(shapes).sort((a,b)=>b[1]-a[1])) console.log(v, "|", k);
  const sample = leads!.filter((l:any)=>l.raw?.shield).slice(0,3);
  for (const s of sample) console.log("\nSAMPLE", s.full_name, JSON.stringify((s as any).raw.shield).slice(0,500));
  const bands: Record<string, number> = {};
  for (const l of leads!) { const b = (l as any).raw?.shield?.band ?? "<no band>"; bands[String(b)] = (bands[String(b)]||0)+1; }
  console.log("\nbands:", bands);
})();

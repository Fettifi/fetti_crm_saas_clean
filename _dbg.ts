import * as dotenv from "dotenv";
dotenv.config({ path: "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/.env.local" });
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
(async () => {
  let leads: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("leads")
      .select("id, full_name, first_name, last_name, email, phone, stage, source, created_at, nurture_paused, raw, credit_score, property_value, loan_amount_requested")
      .range(f, f + 999);
    if (error) throw new Error(error.message);
    leads = leads.concat(data || []);
    console.log("page", f, "got", (data||[]).length);
    if ((data || []).length < 1000) break;
  }
  console.log("total", leads.length);
  console.log("no shield", leads.filter(l=>!l.raw?.shield).length);
  console.log("has shield", leads.filter(l=>l.raw?.shield).length);
  console.log("no email and no phone", leads.filter(l=>!l.email && !l.phone).length);
  console.log("internal test", leads.filter(l=>/fetti-internal\.test/i.test(String(l.email||""))).length);
})();

// AFTER Ramon accepts the customer-list terms (one click):
//   https://business.facebook.com/ads/manage/customaudiences/tos/?act=1192914151836153
// run:  node scratchpad/attach-crm-audience.js
// Creates the "Fetti CRM leads" customer-list audience from all contactable leads
// (SHA-256 hashed), uploads them, and attaches it to the live retargeting ad set.
require("dotenv").config({ path: "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/.env.local", quiet: true });
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const G = "https://graph.facebook.com/v21.0", ACC = "act_1192914151836153", ADSET = "120247258374820330", PIXEL_AUD = "120247040501550330";
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
(async () => {
  const { data: s } = await sb.from("app_settings").select("value").eq("key", "META_USER_TOKEN").maybeSingle();
  const tok = s.value;
  const post = async (p, b) => { const r = await fetch(G + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...b, access_token: tok }) }); const j = await r.json(); if (j.error) throw new Error(p + ": " + JSON.stringify(j.error).slice(0, 250)); return j; };
  const { data: leads } = await sb.from("leads").select("email, phone, first_name, last_name, stage, raw").limit(2000);
  const rows = [];
  for (const l of leads || []) {
    if (l.raw?.duplicate_of) continue;
    const em = (l.email || "").trim().toLowerCase(), ph = (l.phone || "").replace(/\D/g, "");
    if (!em && !ph) continue;
    rows.push([em ? sha(em) : "", ph ? sha(ph.length === 10 ? "1" + ph : ph) : "", l.first_name ? sha(l.first_name.trim().toLowerCase()) : "", l.last_name ? sha(l.last_name.trim().toLowerCase()) : ""]);
  }
  const aud = await post(`/${ACC}/customaudiences`, { name: "Fetti CRM leads (customer list)", subtype: "CUSTOM", description: "All CRM leads — retargeting", customer_file_source: "USER_PROVIDED_ONLY" });
  for (let i = 0; i < rows.length; i += 500) await post(`/${aud.id}/users`, { payload: { schema: ["EMAIL", "PHONE", "FN", "LN"], data: rows.slice(i, i + 500) } });
  await post(`/${ADSET}`, { targeting: { geo_locations: { regions: [{ key: "3847" }, { key: "3852" }, { key: "3865" }], location_types: ["home", "recent"] }, age_min: 18, age_max: 65, custom_audiences: [{ id: PIXEL_AUD }, { id: aud.id }], publisher_platforms: ["facebook", "instagram"], facebook_positions: ["feed", "marketplace", "facebook_reels"], instagram_positions: ["stream", "explore", "reels"], device_platforms: ["mobile", "desktop"] } });
  console.log(`✓ ${rows.length} CRM contacts uploaded to audience ${aud.id} and attached to the retargeting ad set`);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });

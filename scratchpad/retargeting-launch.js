// Launch retargeting: CRM-leads customer-list audience + pixel audience → new ad
// set in the CBO campaign (shares the existing $20/day — no new spend), reusing
// the live ad creative. Verifies everything by reading back.
require("dotenv").config({ path: "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/.env.local", quiet: true });
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const G = "https://graph.facebook.com/v21.0";
const ACCOUNT = "act_1192914151836153", CAMPAIGN = "120211147112730330", PIXEL_AUD = "120247040501550330", PAGE = "106150442387865", CREATIVE = "1000131076063956";
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

(async () => {
  const { data: s } = await sb.from("app_settings").select("value").eq("key", "META_USER_TOKEN").maybeSingle();
  const tok = s.value;
  const post = async (path, body) => {
    const r = await fetch(G + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, access_token: tok }) });
    const j = await r.json();
    if (j.error) throw new Error(path + ": " + JSON.stringify(j.error).slice(0, 300));
    return j;
  };

  // 1) CRM leads → hashed customer list (live, contactable, not junk)
  const { data: leads } = await sb.from("leads").select("email, phone, first_name, last_name, stage, raw").limit(2000);
  const rows = [];
  for (const l of leads || []) {
    if (/dead|lost/i.test(l.stage || "") && l.raw?.duplicate_of) continue; // skip junk dups only
    const em = (l.email || "").trim().toLowerCase();
    const ph = (l.phone || "").replace(/\D/g, "");
    if (!em && !ph) continue;
    rows.push([em ? sha(em) : "", ph ? sha(ph.length === 10 ? "1" + ph : ph) : "",
      l.first_name ? sha(l.first_name.trim().toLowerCase()) : "", l.last_name ? sha(l.last_name.trim().toLowerCase()) : ""]);
  }
  console.log("CRM contacts to upload:", rows.length);

  // 2) Pixel audience only for now (customer list awaits the one-click TOS).
  const listAudId = null;

  // 3) New ad set under CBO (no own budget → shares the campaign's $20/day)
  const adset = await post(`/${ACCOUNT}/adsets`, {
    name: "Retargeting — site visitors + CRM leads",
    campaign_id: CAMPAIGN, optimization_goal: "LEAD_GENERATION", billing_event: "IMPRESSIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    promoted_object: { page_id: PAGE },
    status: "ACTIVE",
    targeting: {
      geo_locations: { regions: [{ key: "3847" }, { key: "3852" }, { key: "3865" }], location_types: ["home", "recent"] },
      age_min: 18, age_max: 65,
      custom_audiences: [{ id: PIXEL_AUD }],
      publisher_platforms: ["facebook", "instagram"],
      facebook_positions: ["feed", "marketplace", "facebook_reels"],
      instagram_positions: ["stream", "explore", "reels"],
      device_platforms: ["mobile", "desktop"],
    },
  });
  console.log("ad set created:", adset.id);

  // 4) Ad reusing the live creative
  const ad = await post(`/${ACCOUNT}/ads`, { name: "Retargeting — same creative", adset_id: adset.id, creative: { creative_id: CREATIVE }, status: "ACTIVE" });
  console.log("ad created:", ad.id);

  // 5) Verify readback
  const chk = await (await fetch(`${G}/${adset.id}?fields=name,effective_status,targeting{custom_audiences},campaign{daily_budget}&access_token=${tok}`)).json();
  console.log("VERIFY:", JSON.stringify(chk).slice(0, 400));
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });

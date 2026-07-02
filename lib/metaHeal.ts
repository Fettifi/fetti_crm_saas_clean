// Self-healing Meta token manager. Runs on a schedule (Doctor) and before every
// auto-post. It: (1) bootstraps the env token into the DB so it's manageable at
// runtime, (2) validates the current page token, (3) auto-refreshes it from a
// stored long-lived user token + app credentials when it's expiring/invalid —
// all with no human approval. Only a full re-auth (Meta requires a human login
// roughly every 60 days) can't be self-fixed; that's reported, not silently
// broken.
import { getSetting, setSetting, cfg } from "@/lib/settings";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { canonicalPhone, phoneMatchForms } from "@/lib/phone";
import { notifyNewLead } from "@/lib/notify/leadAlert";
import { scoreLead } from "@/lib/leadScore";
import { parseMoney } from "@/lib/parseMoney";
import crypto from "crypto";

const GRAPH = "https://graph.facebook.com/v21.0";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";

async function debugToken(token: string, appId: string, secret: string) {
  try {
    const r = await fetch(`${GRAPH}/debug_token?input_token=${token}&access_token=${appId}|${secret}`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    return j.data || {};
  } catch { return {}; }
}

export type HealResult = { status: "healthy" | "healed" | "needs_reauth" | "not_configured"; detail: string; daysLeft?: number };

export async function healMetaToken(): Promise<HealResult> {
  const appId = await cfg("META_APP_ID");
  const secret = await cfg("META_APP_SECRET");
  const pageId = await cfg("META_PAGE_ID");
  let token = await cfg("META_ACCESS_TOKEN");
  if (!token || !pageId) return { status: "not_configured", detail: "Meta not configured" };

  // Bootstrap: make sure the working token lives in the DB (manageable + override-able).
  if (!(await getSetting("META_ACCESS_TOKEN")) && process.env.META_ACCESS_TOKEN) {
    await setSetting("META_ACCESS_TOKEN", process.env.META_ACCESS_TOKEN);
    token = process.env.META_ACCESS_TOKEN;
  }
  // Persist app creds to the DB too, so heals work even if env changes.
  if (process.env.META_APP_ID && !(await getSetting("META_APP_ID"))) await setSetting("META_APP_ID", process.env.META_APP_ID);
  if (process.env.META_APP_SECRET && !(await getSetting("META_APP_SECRET"))) await setSetting("META_APP_SECRET", process.env.META_APP_SECRET);

  if (!appId || !secret) return { status: "healthy", detail: "token set (no app creds to validate)" };

  const d = await debugToken(token, appId, secret);
  const daysLeft = d.expires_at ? Math.round((d.expires_at * 1000 - Date.now()) / 86400000) : 9999;

  // Healthy and not about to expire → done.
  if (d.is_valid && daysLeft > 5) return { status: "healthy", detail: `valid, ~${daysLeft}d left`, daysLeft };

  // Expiring or invalid → try to refresh from a stored long-lived user token.
  const userTok = await getSetting("META_USER_TOKEN");
  if (userTok) {
    try {
      const ll = await (await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${secret}&fb_exchange_token=${userTok}`)).json();
      if (ll.access_token) {
        await setSetting("META_USER_TOKEN", ll.access_token); // keep the freshest long-lived user token
        const pj = await (await fetch(`${GRAPH}/${pageId}?fields=access_token&access_token=${ll.access_token}`)).json();
        if (pj.access_token) {
          await setSetting("META_ACCESS_TOKEN", pj.access_token);
          return { status: "healed", detail: "auto-refreshed the page token" };
        }
      }
    } catch { /* fall through */ }
  }

  if (d.is_valid) return { status: "healthy", detail: `valid, ~${daysLeft}d left`, daysLeft };
  return { status: "needs_reauth", detail: "token invalid and no usable user token to refresh — one Meta reconnect needed", daysLeft };
}

// Full connection status for the UI: is Facebook posting connected, is Instagram
// linked + publishable. Auto-stores the IG account id when it becomes publishable
// so posting wires itself up.
export async function metaConnectionStatus() {
  const appId = await cfg("META_APP_ID");
  const secret = await cfg("META_APP_SECRET");
  const pageId = await cfg("META_PAGE_ID");
  const token = await cfg("META_ACCESS_TOKEN");
  const out: any = {
    facebook: { connected: false, page: null as string | null, detail: "not configured" },
    instagram: { linked: false, canPublish: false, username: null as string | null },
  };
  if (!token || !pageId) return out;

  try {
    const r = await fetch(`${GRAPH}/${pageId}?fields=name,instagram_business_account{id,username}&access_token=${token}`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (j?.name) { out.facebook.connected = true; out.facebook.page = j.name; out.facebook.detail = "connected"; }
    else out.facebook.detail = j?.error?.message || "token issue";
    const ig = j?.instagram_business_account;
    if (ig?.id) { out.instagram.linked = true; out.instagram.username = ig.username || null; out.instagram.accountId = ig.id; }
  } catch { out.facebook.detail = "error reaching Meta"; }

  if (appId && secret) {
    try {
      const d = await debugToken(token, appId, secret);
      out.facebook.connected = out.facebook.connected && !!d.is_valid;
      const scopes: string[] = d.scopes || [];
      out.instagram.canPublish = out.instagram.linked && scopes.includes("instagram_content_publish");
      // Self-wire: once IG is publishable, store its id so posts go to IG too.
      if (out.instagram.canPublish && out.instagram.accountId) {
        await setSetting("META_IG_USER_ID", out.instagram.accountId);
      }
    } catch { /* */ }
  }
  return out;
}

// Accept a fresh user token (e.g. pasted once) and immediately mint + store a
// page token from it. After this, the system self-refreshes on its own.
export async function ingestUserToken(userToken: string): Promise<HealResult> {
  const appId = await cfg("META_APP_ID");
  const secret = await cfg("META_APP_SECRET");
  const pageId = await cfg("META_PAGE_ID");
  if (!appId || !secret || !pageId) return { status: "not_configured", detail: "missing app creds/page" };
  try {
    const ll = await (await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${secret}&fb_exchange_token=${userToken}`)).json();
    if (!ll.access_token) return { status: "needs_reauth", detail: ll?.error?.message || "could not extend token" };
    await setSetting("META_USER_TOKEN", ll.access_token);
    const pj = await (await fetch(`${GRAPH}/${pageId}?fields=access_token&access_token=${ll.access_token}`)).json();
    if (!pj.access_token) return { status: "needs_reauth", detail: pj?.error?.message || "no page token" };
    await setSetting("META_ACCESS_TOKEN", pj.access_token);
    // Auto-subscribe the Page to the leadgen webhook so Facebook Lead Ads flow
    // straight into the CRM (the borrower never gets stuck in Meta's Lead Center).
    // Best-effort: requires pages_manage_metadata on the token; non-fatal if it fails.
    let leadgen = "";
    try {
      const sub = await (await fetch(`${GRAPH}/${pageId}/subscribed_apps?subscribed_fields=leadgen&access_token=${pj.access_token}`, { method: "POST" })).json();
      leadgen = sub?.success ? " + Page subscribed to Lead Ads" : (sub?.error?.message ? ` (page lead webhook: ${sub.error.message})` : "");
    } catch { /* non-fatal */ }
    // Also (re)subscribe the APP itself to the leadgen webhook — the App-dashboard
    // step most setups miss. Uses app creds, so it works regardless of user scopes.
    try { const a = await subscribeAppToLeadgen(); leadgen += a.ok ? " + App subscribed to Lead Ads" : ` (app webhook: ${a.detail})`; } catch { /* non-fatal */ }
    return { status: "healed", detail: `connected + stored; will self-refresh${leadgen}` };
  } catch (e) {
    return { status: "needs_reauth", detail: e instanceof Error ? e.message : "error" };
  }
}

// Subscribe the APP itself to the `leadgen` webhook field (object=page) using the
// app access token. This is the Meta App-dashboard step that registers our callback
// URL + verify token and turns on Lead Ads delivery. Works with app creds alone
// (no user scopes) and is idempotent — safe to call any time.
export async function subscribeAppToLeadgen(): Promise<{ ok: boolean; detail: string }> {
  const appId = await cfg("META_APP_ID");
  const secret = await cfg("META_APP_SECRET");
  const verify = await cfg("META_WEBHOOK_VERIFY_TOKEN");
  if (!appId || !secret || !verify) return { ok: false, detail: "missing app id/secret/verify token" };
  try {
    const params = new URLSearchParams({
      object: "page",
      callback_url: `${APP_URL}/api/meta/webhook`,
      fields: "leadgen",
      verify_token: verify,
      access_token: `${appId}|${secret}`,
    });
    const r = await fetch(`${GRAPH}/${appId}/subscriptions`, { method: "POST", body: params, signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    if (j?.success || r.ok) return { ok: true, detail: "app subscribed to leadgen webhook" };
    return { ok: false, detail: j?.error?.message || `HTTP ${r.status}` };
  } catch (e) { return { ok: false, detail: e instanceof Error ? e.message : "error" }; }
}

// Subscribe the PAGE itself to leadgen (so Meta actually DELIVERS this page's lead
// events to our app). Normally needs a page token with pages_manage_metadata; we try
// the page token first, then fall back to the app access token — which can succeed
// for a page the app already manages, letting us finish with no user re-auth.
export async function subscribePageToLeadgen(): Promise<{ ok: boolean; via: string; detail: string }> {
  const appId = await cfg("META_APP_ID");
  const secret = await cfg("META_APP_SECRET");
  const pageId = await cfg("META_PAGE_ID");
  const pageToken = await cfg("META_ACCESS_TOKEN");
  if (!pageId) return { ok: false, via: "none", detail: "no page id" };
  const attempts: Array<[string, string | null]> = [
    ["page_token", pageToken],
    ["app_token", appId && secret ? `${appId}|${secret}` : null],
  ];
  let lastDetail = "";
  for (const [via, tok] of attempts) {
    if (!tok) continue;
    try {
      const r = await fetch(`${GRAPH}/${pageId}/subscribed_apps?subscribed_fields=leadgen&access_token=${tok}`, { method: "POST", signal: AbortSignal.timeout(10000) });
      const j = await r.json();
      if (j?.success || r.ok) return { ok: true, via, detail: "page subscribed to leadgen" };
      lastDetail = `${via}: ${j?.error?.message || `HTTP ${r.status}`}`;
    } catch (e) { lastDetail = `${via}: ${e instanceof Error ? e.message : "error"}`; }
  }
  return { ok: false, via: "tried page+app token", detail: lastDetail || "failed" };
}

// Exact readiness for receiving real Facebook Lead Ads: is the APP subscribed to
// leadgen, is the PAGE subscribed, is the token valid, and does it carry the scopes
// the pipeline needs (leads_retrieval to fetch the lead, pages_manage_metadata to
// subscribe the page).
export async function metaLeadgenReadiness() {
  const appId = await cfg("META_APP_ID");
  const secret = await cfg("META_APP_SECRET");
  const pageId = await cfg("META_PAGE_ID");
  const token = await cfg("META_ACCESS_TOKEN");
  const out: any = {
    appSubscribedLeadgen: false, pageSubscribedLeadgen: false,
    tokenValid: false, scopes: [] as string[],
    hasLeadsRetrieval: false, hasPagesManageMetadata: false, pageId: pageId || null, detail: "",
  };
  if (!appId || !secret) { out.detail = "missing app creds"; return out; }
  try {
    const r = await fetch(`${GRAPH}/${appId}/subscriptions?access_token=${appId}|${secret}`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const pageSub = (j?.data || []).find((s: any) => s.object === "page");
    out.appSubscribedLeadgen = !!pageSub && (pageSub.fields || []).some((f: any) => (f?.name || f) === "leadgen");
  } catch { /* */ }
  if (token && pageId) {
    // Read with the PAGE token first (it can list its own subscribed apps); the app
    // token usually can't and returns empty, which gave a false negative before.
    for (const tok of [token, `${appId}|${secret}`]) {
      if (!tok) continue;
      try {
        const r = await fetch(`${GRAPH}/${pageId}/subscribed_apps?access_token=${tok}`, { signal: AbortSignal.timeout(8000) });
        const j = await r.json();
        if (Array.isArray(j?.data)) {
          out.pageSubs = j.data.map((a: any) => ({ name: a?.name, fields: (a?.subscribed_fields || []).map((f: any) => f?.name || f) }));
          out.pageSubscribedLeadgen = j.data.some((a: any) => (a?.subscribed_fields || []).some((f: any) => (f?.name || f) === "leadgen"));
          break;
        } else if (j?.error) {
          out.pageSubsError = j.error.message;
        }
      } catch { /* */ }
    }
    try {
      const d = await debugToken(token, appId, secret);
      out.tokenValid = !!d.is_valid;
      out.scopes = d.scopes || [];
      out.hasLeadsRetrieval = out.scopes.includes("leads_retrieval");
      out.hasPagesManageMetadata = out.scopes.includes("pages_manage_metadata");
    } catch { /* */ }
  }
  out.detail = `app=${out.appSubscribedLeadgen} page=${out.pageSubscribedLeadgen} valid=${out.tokenValid} leads_retrieval=${out.hasLeadsRetrieval}`;
  return out;
}

// Prove the webhook → intake → DB → alert path end to end, with NO Meta dependency:
// the server signs a synthetic leadgen event with the real app secret and POSTs it to
// our own live webhook. The fake leadgen_id can't be fetched from Graph, so it should
// exercise the never-lose-a-lead fallback (a flagged lead row + alert). Returns the
// webhook's response + the synthetic leadgen_id so the caller can confirm + clean up.
export async function selfTestWebhook(): Promise<{ ok: boolean; status: number; body: string; leadgenId: string }> {
  const secret = await cfg("META_APP_SECRET");
  const pageId = await cfg("META_PAGE_ID");
  const leadgenId = "FETTI_SELFTEST_" + Date.now();
  if (!secret) return { ok: false, status: 0, body: "no app secret", leadgenId };
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    object: "page",
    entry: [{ id: pageId, time: now, changes: [{ field: "leadgen", value: { leadgen_id: leadgenId, page_id: pageId, form_id: "selftest", created_time: now, platform: "facebook" } }] }],
  });
  const sig = "sha256=" + crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  try {
    const r = await fetch(`${APP_URL}/api/meta/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig },
      body: payload,
      signal: AbortSignal.timeout(25000),
    });
    return { ok: r.ok, status: r.status, body: await r.text(), leadgenId };
  } catch (e) { return { ok: false, status: 0, body: e instanceof Error ? e.message : "error", leadgenId }; }
}

// Recover historical Facebook/Instagram Lead Ads leads collected by Meta but never
// delivered to the CRM (the ones Ramon paid for). Enumerates EVERY Page the user
// manages, persists a pageId->token map (so the webhook can fetch leads from ANY of
// his pages), (re)subscribes each page to leadgen, then pulls every retrievable lead
// from every form and inserts DIRECTLY into `leads` — NOT through /api/apply — so NO
// auto email/SMS goes to these older contacts. Deduped by Meta leadgen_id, flagged for
// manual review. (Meta only serves leads via API for ~90 days; older leads show as
// claimed-but-not-retrieved and need a Lead Center CSV export.)
export async function importHistoricalLeads(): Promise<any> {
  const userTok = await cfg("META_USER_TOKEN");
  const fallbackPageTok = await cfg("META_ACCESS_TOKEN");
  const cfgPageId = await cfg("META_PAGE_ID");

  // Every Page the user manages + its Page token.
  const pages: Array<{ id: string; name: string; token: string }> = [];
  if (userTok) {
    let url: string | null = `${GRAPH}/me/accounts?fields=id,name,access_token&limit=100&access_token=${userTok}`;
    let guard = 0;
    while (url && guard++ < 20) {
      const j: any = await fetch(url, { signal: AbortSignal.timeout(15000) }).then((x: any) => x.json()).catch(() => ({}));
      if (j?.error) break;
      for (const p of j.data || []) if (p.access_token) pages.push({ id: p.id, name: p.name, token: p.access_token });
      url = j.paging?.next || null;
    }
  }
  if (cfgPageId && fallbackPageTok && !pages.some((p) => p.id === cfgPageId)) pages.push({ id: cfgPageId, name: "(configured page)", token: fallbackPageTok });
  if (!pages.length) return { ok: false, detail: "no pages/tokens (reconnect Meta with a user token)", pageReports: [] };

  // Persist pageId->token so the webhook can fetch leads from ANY of these pages.
  try {
    const map: Record<string, string> = {};
    for (const p of pages) map[p.id] = p.token;
    await setSetting("META_PAGE_TOKENS", JSON.stringify(map));
  } catch { /* */ }

  // Already-imported leadgen ids → never double-import. EXCEPTION: a webhook-fallback
  // "shell" row (saved with no contact info when the Graph fetch failed) must NOT block
  // recovery — we track shells so the importer can fill them in with the real lead.
  const seen = new Set<string>();
  const shells = new Map<string, string>(); // leadgen_id -> shell lead row id
  try {
    const { data } = await supabaseAdmin.from("leads").select("id, email, phone, raw")
      .or("source.in.(facebook,instagram,meta_lead_ad),lead_source.in.(facebook,instagram,meta_lead_ad)").limit(20000);
    for (const r of data || []) {
      const id = (r as any)?.raw?.meta?.leadgen_id; if (!id) continue;
      const isShell = (r as any)?.raw?.fallback_reason && !(r as any).email && !(r as any).phone;
      if (isShell) shells.set(String(id), (r as any).id);
      else seen.add(String(id));
    }
  } catch { /* */ }

  const norm = (s: any) => String(s || "").toLowerCase().replace(/[\s\-]+/g, "_");
  const mapLead = (fieldData: any[]) => {
    const valOf = (f: any) => (Array.isArray(f?.values) ? f.values[0] : f?.values);
    const getExact = (...names: string[]) => { for (const w of names) { const f = fieldData.find((x) => norm(x?.name) === w); if (f) return valOf(f); } return undefined; };
    const get = (...names: string[]) => { const e = getExact(...names); if (e !== undefined) return e; for (const w of names) { const f = fieldData.find((x) => norm(x?.name).includes(w)); if (f) return valOf(f); } return undefined; };
    const first = getExact("first_name"); const last = getExact("last_name");
    const digits = String(get("phone_number", "phone") || "").replace(/\D/g, "");
    return {
      full_name: getExact("full_name", "name") || [first, last].filter(Boolean).join(" ") || null,
      email: (get("email") || null) as string | null,
      phone: digits.length >= 7 ? digits : null,
      state: get("state") || null,
      loan_purpose: get("loan_purpose", "purpose", "loan_type", "what_type") || null,
      // Scoring inputs (were dropped before, so every historical lead scored 0/Tier 3).
      // parseMoney handles "$100k+" / "$50,000–$99,999" style answers.
      credit_band: (get("credit_band", "credit_score", "credit") || null) as string | null,
      credit_score: Number(String(getExact("credit_score") || "").replace(/[^0-9.]/g, "")) || null,
      liquid_assets: parseMoney(get("liquid_assets", "liquid_reserves", "reserves", "cash", "savings", "available_funds")) ?? null,
      property_value: parseMoney(get("property_value", "home_value", "purchase_price")) ?? null,
      income: parseMoney(get("annual_income", "monthly_income", "gross_income", "income")) ?? null,
    };
  };

  let fetched = 0, imported = 0, skipped = 0;
  const pageReports: any[] = [];
  for (const page of pages) {
    const pr: any = { page: page.name, pageId: page.id, forms: 0, claimedLeads: 0, retrieved: 0, imported: 0, skipped: 0, subscribed: false };
    try {
      const s: any = await fetch(`${GRAPH}/${page.id}/subscribed_apps?subscribed_fields=leadgen&access_token=${page.token}`, { method: "POST", signal: AbortSignal.timeout(10000) }).then((x: any) => x.json()).catch(() => ({}));
      pr.subscribed = !!s?.success;
    } catch { /* */ }
    const forms: Array<{ id: string; name: string; count: number }> = [];
    let furl: string | null = `${GRAPH}/${page.id}/leadgen_forms?fields=id,name,leads_count&limit=100&access_token=${page.token}`;
    let fg = 0;
    while (furl && fg++ < 20) {
      const fj: any = await fetch(furl, { signal: AbortSignal.timeout(15000) }).then((x: any) => x.json()).catch(() => ({}));
      if (fj?.error) { pr.formsError = fj.error.message; break; }
      for (const f of fj.data || []) forms.push({ id: f.id, name: f.name, count: Number(f.leads_count || 0) });
      furl = fj.paging?.next || null;
    }
    pr.forms = forms.length;
    pr.claimedLeads = forms.reduce((s, f) => s + f.count, 0);
    for (const form of forms) {
      let lurl: string | null = `${GRAPH}/${form.id}/leads?limit=100&access_token=${page.token}`;
      let lg = 0;
      while (lurl && lg++ < 500) {
        const lj: any = await fetch(lurl, { signal: AbortSignal.timeout(20000) }).then((x: any) => x.json()).catch(() => ({}));
        if (lj?.error) { pr.leadsError = lj.error.message; break; }
        for (const lead of lj.data || []) {
          fetched++; pr.retrieved++;
          const lgid = String(lead.id);
          if (seen.has(lgid)) { skipped++; pr.skipped++; continue; }
          const m = mapLead(lead.field_data || []);
          if (!m.email && !m.phone && !m.full_name) { skipped++; pr.skipped++; continue; }
          // DEDUP by contact details too (not just leadgen_id): the same person from a
          // different form/submission — or already in the CRM from the website — must
          // NOT become a second lead row (that caused double drip emails).
          m.phone = canonicalPhone(m.phone);
          if (m.email) m.email = String(m.email).trim().toLowerCase();
          {
            const orParts: string[] = [];
            if (m.email) orParts.push(`email.eq.${m.email}`);
            if (m.phone) for (const f of phoneMatchForms(m.phone)) orParts.push(`phone.eq.${f}`);
            if (orParts.length) {
              const { data: dup } = await supabaseAdmin
                .from("leads").select("id").or(orParts.join(",")).limit(1).maybeSingle();
              if (dup) { seen.add(lgid); skipped++; pr.skipped++; continue; }
            }
          }
          // Score/tier through the SAME logic as /api/apply so imported paid leads
          // are prioritized for follow-up instead of sitting in the pipeline untiered.
          const { score, tier } = scoreLead({
            loan_purpose: m.loan_purpose, credit_band: m.credit_band, credit_score: m.credit_score,
            liquid_assets: m.liquid_assets, property_value: m.property_value,
          });
          const row = {
            full_name: m.full_name, email: m.email, phone: m.phone, state: m.state, loan_purpose: m.loan_purpose,
            credit_band: m.credit_band, credit_score: m.credit_score, liquid_assets: m.liquid_assets,
            property_value: m.property_value, income: m.income,
            score, tier,
            notes: `Imported from Meta Lead Center (historical) — page "${page.name}", form "${form.name}". Review before contacting.`,
            stage: "New Lead", source: "facebook", lead_source: "facebook",
            raw: { meta: { leadgen_id: lgid, form_id: form.id, form_name: form.name, page_id: page.id, created_time: lead.created_time }, historical_import: true, field_data: lead.field_data },
          };
          // SHELL RECOVERY: the webhook saved a contactless placeholder for this
          // leadgen_id — fill it in with the real borrower instead of skipping forever.
          const shellId = shells.get(lgid);
          if (shellId) {
            const { error: upErr } = await supabaseAdmin.from("leads").update({
              full_name: row.full_name, email: row.email, phone: row.phone, state: row.state,
              loan_purpose: row.loan_purpose, credit_band: row.credit_band, credit_score: row.credit_score,
              liquid_assets: row.liquid_assets, property_value: row.property_value, income: row.income,
              score, tier, raw: row.raw,
            }).eq("id", shellId);
            if (!upErr) {
              seen.add(lgid); shells.delete(lgid); imported++; pr.imported++;
              try { await notifyNewLead({ lead_id: shellId, full_name: row.full_name, email: row.email, phone: row.phone, state: row.state, loan_purpose: row.loan_purpose, score, tier, source: "facebook (shell recovered — details filled in)", auto_sent: [] }); } catch { /* */ }
            } else { skipped++; pr.skipped++; }
            continue;
          }

          // FRESH lead (webhook missed it minutes ago, not months): route through
          // /api/apply so it gets the IDENTICAL speed-to-lead treatment as a webhook
          // delivery — instant first-touch email, scoring, agents — instead of being
          // mislabeled historical (no first touch, review-gated).
          const ageH = lead.created_time ? (Date.now() - new Date(lead.created_time).getTime()) / 3600000 : 9999;
          if (ageH <= 48 && process.env.CRON_SECRET) {
            try {
              const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
              const ar = await fetch(`${appUrl}/api/apply`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-fetti-internal": process.env.CRON_SECRET },
                body: JSON.stringify({
                  full_name: row.full_name, email: row.email, phone: row.phone, state: row.state,
                  loan_purpose: row.loan_purpose, credit_band: row.credit_band, credit_score: row.credit_score,
                  liquid_assets: row.liquid_assets, property_value: row.property_value, income: row.income,
                  source: "facebook", notes: `Recovered by the 15-min importer (webhook missed it) — page "${page.name}", form "${form.name}".`,
                }),
                signal: AbortSignal.timeout(30000),
              });
              if (ar.ok) { seen.add(lgid); imported++; pr.imported++; continue; }
            } catch { /* fall through to the direct-insert safety net */ }
          }

          const { data: ins, error } = await supabaseAdmin.from("leads").insert([row]).select("id").single();
          if (error) { skipped++; pr.skipped++; } else {
            seen.add(lgid); imported++; pr.imported++;
            // Alert immediately — a lead the webhook missed still gets worked fast.
            try {
              await notifyNewLead({
                lead_id: (ins as any)?.id, full_name: row.full_name, email: row.email, phone: row.phone,
                state: row.state, loan_purpose: row.loan_purpose, score, tier,
                source: "facebook (auto-recovered)", auto_sent: [],
              });
            } catch { /* alert is best-effort */ }
          }
        }
        lurl = lj.paging?.next || null;
      }
    }
    pageReports.push(pr);
  }
  return { ok: true, pagesScanned: pages.length, fetched, imported, skipped, pageReports };
}

// Full ad-account diagnostic: WHY are/aren't Facebook leads coming in? Pulls every ad
// account the token can see, their campaigns + objectives + delivery status + spend,
// and the page's lead forms + lifetime lead counts — then computes a plain-English
// verdict. Read-only; never changes a campaign or spends money.
export async function metaAdsReport(): Promise<any> {
  const token = (await cfg("META_USER_TOKEN")) || (await cfg("META_ACCESS_TOKEN"));
  const pageId = await cfg("META_PAGE_ID");
  const out: any = { accounts: [], leadForms: [], totalLeadsAllForms: 0, verdict: [], errors: [] };
  if (!token) { out.errors.push("no token"); return out; }
  const g = async (path: string) => {
    try {
      const r = await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${token}`, { signal: AbortSignal.timeout(20000) });
      return await r.json();
    } catch (e: any) { return { error: { message: e?.message || "fetch error" } }; }
  };

  if (pageId) {
    const lf = await g(`${pageId}/leadgen_forms?fields=id,name,status,leads_count&limit=100`);
    if (lf?.error) out.errors.push(`leadForms: ${lf.error.message}`);
    else out.leadForms = (lf.data || []).map((f: any) => ({ id: f.id, name: f.name, status: f.status, leads_count: Number(f.leads_count || 0) }));
  }
  out.totalLeadsAllForms = out.leadForms.reduce((s: number, f: any) => s + (f.leads_count || 0), 0);

  const accts = await g(`me/adaccounts?fields=id,name,account_status,amount_spent,currency,disable_reason&limit=25`);
  if (accts?.error) out.errors.push(`adaccounts: ${accts.error.message}`);
  const accountList: any[] = accts?.data || [];
  const knownAcct = "act_3631424977078470"; // from Ramon's Ads Manager URL
  if (!accountList.some((a: any) => a.id === knownAcct)) accountList.push({ id: knownAcct, name: "(from Ads Manager URL)", account_status: null });

  for (const a of accountList.slice(0, 8)) {
    const rec: any = { id: a.id, name: a.name, account_status: a.account_status, amount_spent: a.amount_spent, currency: a.currency, disable_reason: a.disable_reason, campaigns: [] };
    const camps = await g(`${a.id}/campaigns?fields=name,objective,status,effective_status,daily_budget,lifetime_budget&limit=100`);
    if (camps?.error) rec.campaignsError = camps.error.message;
    else rec.campaigns = (camps.data || []).map((c: any) => ({ name: c.name, objective: c.objective, status: c.status, effective_status: c.effective_status, daily_budget: c.daily_budget, lifetime_budget: c.lifetime_budget }));
    const ins = await g(`${a.id}/insights?date_preset=maximum&fields=spend,impressions,clicks,cpc,actions`);
    if (ins?.error) rec.insightsError = ins.error.message;
    else rec.insights = (ins.data || [])[0] || null;
    // Distinguish the lifetime COUNT of lead submissions (a metric) from how many are
    // recent enough that Meta still serves the RECORD via API (~90 days).
    const leadFrom = (actions: any[]) => { const x = (actions || []).find((y: any) => y.action_type === "onsite_conversion.lead_grouped") || (actions || []).find((y: any) => y.action_type === "lead"); return x ? Number(x.value) : 0; };
    rec.leadsLifetime = leadFrom(rec.insights?.actions);
    const ins90 = await g(`${a.id}/insights?date_preset=last_90d&fields=actions`);
    rec.leadsLast90d = ins90?.error ? null : leadFrom(((ins90.data || [])[0] || {}).actions);
    const ins30 = await g(`${a.id}/insights?date_preset=last_30d&fields=actions`);
    rec.leadsLast30d = ins30?.error ? null : leadFrom(((ins30.data || [])[0] || {}).actions);
    out.accounts.push(rec);
  }

  const v: string[] = out.verdict;
  const allCamps = out.accounts.flatMap((a: any) => a.campaigns || []);
  const leadObj = ["OUTCOME_LEADS", "LEAD_GENERATION"];
  const leadCamps = allCamps.filter((c: any) => leadObj.includes(c.objective));
  const activeLeadCamps = leadCamps.filter((c: any) => c.effective_status === "ACTIVE");
  if (!allCamps.length) v.push("No campaigns found on any accessible ad account — nothing is running to generate leads.");
  else {
    v.push(`${allCamps.length} campaign(s) total; objectives seen: ${[...new Set(allCamps.map((c: any) => c.objective))].join(", ") || "n/a"}.`);
    if (!leadCamps.length) v.push("NONE use a Leads objective (OUTCOME_LEADS/LEAD_GENERATION). Instant-form leads ONLY come from a Leads-objective campaign with an attached instant form — almost certainly why there are charges but no leads.");
    else if (!activeLeadCamps.length) v.push("A Leads campaign exists but is NOT active (paused/off) — it won't deliver.");
    else v.push(`${activeLeadCamps.length} ACTIVE Leads campaign(s).`);
  }
  v.push(`Lead forms: ${out.leadForms.length}; lifetime leads across all forms: ${out.totalLeadsAllForms} (includes any test leads).`);
  const spend = out.accounts.reduce((s: number, a: any) => s + Number(a.insights?.spend || 0), 0);
  if (spend > 0) v.push(`Lifetime ad spend across accounts: ~$${spend.toFixed(2)}.`);
  const lifeLeads = out.accounts.reduce((s: number, a: any) => s + Number(a.leadsLifetime || 0), 0);
  const leads90 = out.accounts.reduce((s: number, a: any) => s + Number(a.leadsLast90d || 0), 0);
  const leads30 = out.accounts.reduce((s: number, a: any) => s + Number(a.leadsLast30d || 0), 0);
  v.push(`Lead-form submissions (Meta's COUNT metric): ${lifeLeads} lifetime, ${leads90} in last 90d, ${leads30} in last 30d. Meta serves lead RECORDS via API for ~90 days only — so only ~${leads90} are API-importable; the other ~${lifeLeads - leads90} exist as a number but their contact records are gone from the API (Lead Center CSV only, subject to Meta retention).`);
  return out;
}

// Inspect (and optionally re-activate) a lead campaign. Reads the full tree
// (campaign → ad sets → ads), extracts the destination Page + lead form per ad set,
// and reports whether that Page is wired to the CRM (in META_PAGE_TOKENS) so leads
// would actually flow. With activate=true, sets the campaign + all its ad sets + ads
// to ACTIVE. NOTE: re-activating resumes ad SPEND — caller gates this on explicit intent.
export async function metaManageCampaign(opts: { account?: string; nameOrId?: string; activate?: boolean; status?: "ACTIVE" | "PAUSED"; dailyBudgetCents?: number }): Promise<any> {
  const token = (await cfg("META_USER_TOKEN")) || (await cfg("META_ACCESS_TOKEN"));
  const account = opts.account || "act_1192914151836153";
  const target = (opts.nameOrId || "New Leads Campaign").trim();
  const out: any = { account, target, campaign: null, adsets: [], ads: [], pageIds: [], pageWired: {}, activated: false, actions: [], errors: [] };
  if (!token) { out.errors.push("no token"); return out; }
  const g = async (path: string, method = "GET", body?: Record<string, string>) => {
    try {
      const init: any = { method, signal: AbortSignal.timeout(20000) };
      if (body) init.body = new URLSearchParams(body);
      const r = await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${token}`, init);
      return await r.json();
    } catch (e: any) { return { error: { message: e?.message || "fetch error" } }; }
  };

  let campId = "";
  if (/^\d+$/.test(target)) campId = target;
  else {
    const cj = await g(`${account}/campaigns?fields=id,name,status,effective_status,objective&limit=200`);
    if (cj?.error) { out.errors.push(`campaigns: ${cj.error.message}`); return out; }
    const list = cj.data || [];
    const match = list.find((c: any) => c.name === target) || list.find((c: any) => String(c.name || "").toLowerCase().includes(target.toLowerCase()));
    if (!match) { out.errors.push(`campaign "${target}" not found on ${account}`); out.available = list.map((c: any) => c.name); return out; }
    campId = match.id; out.campaign = match;
  }
  if (!out.campaign) { const cj = await g(`${campId}?fields=id,name,status,effective_status,objective`); out.campaign = cj?.error ? { id: campId, error: cj.error.message } : cj; }

  const aj = await g(`${campId}/adsets?fields=id,name,status,effective_status,optimization_goal,destination_type,promoted_object&limit=200`);
  if (aj?.error) out.errors.push(`adsets: ${aj.error.message}`);
  out.adsets = (aj?.data || []).map((s: any) => ({ id: s.id, name: s.name, status: s.status, effective_status: s.effective_status, optimization_goal: s.optimization_goal, destination_type: s.destination_type, page_id: s.promoted_object?.page_id, lead_form_id: s.promoted_object?.lead_gen_form_id }));
  for (const s of out.adsets) if (s.page_id) out.pageIds.push(String(s.page_id));

  const adj = await g(`${campId}/ads?fields=id,name,status,effective_status,creative{object_story_spec,call_to_action_type,object_type}&limit=200`);
  if (adj?.error) out.errors.push(`ads: ${adj.error.message}`);
  const destOf = (cr: any) => {
    const oss = cr?.object_story_spec || {};
    return oss?.link_data?.link || oss?.video_data?.call_to_action?.value?.link || oss?.link_data?.call_to_action?.value?.link || (cr?.object_type ? `(${cr.object_type})` : null);
  };
  out.ads = (adj?.data || []).map((a: any) => ({ id: a.id, name: a.name, status: a.status, effective_status: a.effective_status, destination: destOf(a.creative) }));

  let tokenMap: Record<string, string> = {};
  try { tokenMap = JSON.parse((await cfg("META_PAGE_TOKENS")) || "{}"); } catch { tokenMap = {}; }
  out.pageIds = [...new Set(out.pageIds)];
  for (const pid of out.pageIds) out.pageWired[pid] = !!tokenMap[pid];

  const desiredStatus = opts.status || (opts.activate ? "ACTIVE" : null);
  if (desiredStatus) {
    const c = await g(`${campId}`, "POST", { status: desiredStatus });
    out.actions.push({ entity: "campaign", id: campId, ok: !c?.error, detail: c?.error?.message || desiredStatus });
    // Pausing the campaign stops all delivery/spend; only re-activation needs to walk
    // the ad sets + ads (they may individually be paused).
    if (desiredStatus === "ACTIVE") {
      for (const s of out.adsets) { const r = await g(`${s.id}`, "POST", { status: "ACTIVE" }); out.actions.push({ entity: "adset", id: s.id, ok: !r?.error, detail: r?.error?.message || "ACTIVE" }); }
      for (const a of out.ads) { const r = await g(`${a.id}`, "POST", { status: "ACTIVE" }); out.actions.push({ entity: "ad", id: a.id, ok: !r?.error, detail: r?.error?.message || "ACTIVE" }); }
    }
    out.statusSet = desiredStatus;
    out.activated = desiredStatus === "ACTIVE" && out.actions.length > 0 && out.actions.every((x: any) => x.ok);
  }

  if (opts.dailyBudgetCents && opts.dailyBudgetCents > 0) {
    // Try campaign-level budget (Advantage/CBO). If the budget lives at the ad set
    // level instead, fall back and set it on each ad set.
    const r = await g(`${campId}`, "POST", { daily_budget: String(opts.dailyBudgetCents) });
    if (!r?.error) {
      out.actions.push({ entity: "campaign_budget", id: campId, ok: true, detail: `daily_budget=${opts.dailyBudgetCents}` });
    } else {
      out.actions.push({ entity: "campaign_budget", id: campId, ok: false, detail: r.error.message });
      for (const s of out.adsets) {
        const rr = await g(`${s.id}`, "POST", { daily_budget: String(opts.dailyBudgetCents) });
        out.actions.push({ entity: "adset_budget", id: s.id, ok: !rr?.error, detail: rr?.error?.message || `daily_budget=${opts.dailyBudgetCents}` });
      }
    }
    out.budgetSetCents = opts.dailyBudgetCents;
  }
  return out;
}

// Follow the money: for EVERY ad account, how much was charged today / yesterday /
// last 7d / last 30d, what funding source (card) pays for it, and — per campaign over
// the last 7 days — what the spend actually BOUGHT (leads vs just link clicks). This
// pinpoints where the daily charges go and whether they produce lead-form leads.
export async function metaSpendTrace(): Promise<any> {
  const token = (await cfg("META_USER_TOKEN")) || (await cfg("META_ACCESS_TOKEN"));
  const out: any = { accounts: [], errors: [] };
  if (!token) { out.errors.push("no token"); return out; }
  const g = async (path: string) => {
    try {
      const r = await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${token}`, { signal: AbortSignal.timeout(20000) });
      return await r.json();
    } catch (e: any) { return { error: { message: e?.message || "fetch error" } }; }
  };
  const leadFrom = (actions: any[]) => { const x = (actions || []).find((y: any) => y.action_type === "onsite_conversion.lead_grouped") || (actions || []).find((y: any) => y.action_type === "lead"); return x ? Number(x.value) : 0; };
  const clickFrom = (actions: any[]) => { const x = (actions || []).find((y: any) => y.action_type === "link_click"); return x ? Number(x.value) : 0; };

  const accts = await g(`me/adaccounts?fields=id,name,account_status,amount_spent,balance,currency,funding_source_details,spend_cap,business{id,name},owner&limit=25`);
  if (accts?.error) out.errors.push(`adaccounts: ${accts.error.message}`);
  const list: any[] = accts?.data || [];
  const known = "act_3631424977078470";
  if (!list.some((a) => a.id === known)) list.push({ id: known, name: "(from Ads Manager URL)" });

  for (const a of list.slice(0, 12)) {
    const rec: any = {
      id: a.id, name: a.name, account_status: a.account_status,
      amount_spent_lifetime: a.amount_spent ? Number(a.amount_spent) / 100 : null,
      balance_owed: a.balance ? Number(a.balance) / 100 : null,
      currency: a.currency, card: a.funding_source_details?.display_string || null,
      ownerBusiness: a.business?.name ? `${a.business.name} (${a.business.id})` : (a.owner || null),
      ownerBusinessId: a.business?.id || a.owner || null,
      spend: {},
    };
    for (const dp of ["today", "yesterday", "last_7d", "last_30d"]) {
      const j = await g(`${a.id}/insights?date_preset=${dp}&fields=spend,impressions,clicks,actions`);
      if (j?.error) { rec.spend[dp] = { error: j.error.message }; continue; }
      const row = (j?.data || [])[0] || {};
      rec.spend[dp] = { spend: Number(row.spend || 0), clicks: Number(row.clicks || 0), linkClicks: clickFrom(row.actions), leads: leadFrom(row.actions) };
    }
    const cj = await g(`${a.id}/insights?date_preset=last_7d&level=campaign&fields=campaign_name,spend,impressions,clicks,actions&limit=100`);
    rec.campaigns7d = (cj?.data || [])
      .map((c: any) => ({ name: c.campaign_name, spend: Number(c.spend || 0), linkClicks: clickFrom(c.actions), leads: leadFrom(c.actions) }))
      .filter((c: any) => c.spend > 0)
      .sort((x: any, y: any) => y.spend - x.spend);
    if (rec.ownerBusinessId) {
      const u = await g(`${a.id}/assigned_users?fields=id,name,tasks&business=${rec.ownerBusinessId}&limit=50`);
      if (u?.error) rec.usersError = u.error.message;
      else rec.users = (u?.data || []).map((x: any) => ({ name: x.name, id: x.id, tasks: x.tasks }));
    }
    out.accounts.push(rec);
  }
  return out;
}

import { NextRequest, NextResponse, after } from "next/server";
import { cfg } from "@/lib/settings";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { notifyNewLead } from "@/lib/notify/leadAlert";
import { parseMoney } from "@/lib/parseMoney";
import { canonicalPhone, phoneMatchForms } from "@/lib/phone";
import crypto from "crypto";

// Meta Lead Ads webhook. Receives `leadgen` events when someone submits a
// Facebook/Instagram INSTANT FORM, fetches the full lead from the Graph API, and
// routes it through the SAME intake as the website (/api/apply) so it gets
// scored, auto-responded, alerted, and worked by the agents — in real time.
// Without this, instant-form leads stay trapped in Meta and never reach the CRM.
//
// Security: GET verifies the subscription (hub.verify_token == META_WEBHOOK_VERIFY_TOKEN);
// POST verifies Meta's X-Hub-Signature-256 HMAC against META_APP_SECRET. Public by
// design (Meta calls it) — not session-gated; it authenticates by signature.
//
// Meta-side setup (owner does this in the Meta App dashboard):
//   1. Webhooks → Page → callback URL https://app.fettifi.com/api/meta/webhook, verify token = META_WEBHOOK_VERIFY_TOKEN
//   2. Subscribe the Page to the `leadgen` field
//   3. The Page access token (META_ACCESS_TOKEN) must have `leads_retrieval` permission
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const GRAPH = "https://graph.facebook.com/v21.0";

// --- GET: webhook subscription verification handshake ---
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get("hub.mode");
  const token = sp.get("hub.verify_token");
  const challenge = sp.get("hub.challenge");
  const expected = await cfg("META_WEBHOOK_VERIFY_TOKEN");
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "verification failed" }, { status: 403 });
}

function verifySignature(raw: string, header: string | null, appSecret: string): boolean {
  if (!header) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(raw, "utf8").digest("hex");
  const a = Buffer.from(header), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Map a Meta lead's field_data ([{name, values:[...]}]) into our /api/apply body.
// EXACT-match first, then fall back to substring — otherwise a 'first_name' field
// gets wrongly captured by a 'name' substring match and mangles the borrower's name.
function mapFields(fieldData: any[]): Record<string, any> {
  const norm = (s: any) => String(s || "").toLowerCase().replace(/[\s\-]+/g, "_");
  const valOf = (f: any) => (Array.isArray(f?.values) ? f.values[0] : f?.values);
  const getExact = (...names: string[]) => {
    for (const want of names) {
      const f = fieldData.find((x) => norm(x?.name) === want);
      if (f) return valOf(f);
    }
    return undefined;
  };
  const get = (...names: string[]) => {
    const exact = getExact(...names);
    if (exact !== undefined) return exact;
    for (const want of names) {
      const f = fieldData.find((x) => norm(x?.name).includes(want));
      if (f) return valOf(f);
    }
    return undefined;
  };
  const first = getExact("first_name");
  const last = getExact("last_name");
  const body: Record<string, any> = {
    full_name: getExact("full_name", "name") || [first, last].filter(Boolean).join(" ") || undefined,
    first_name: first,
    last_name: last,
    email: get("email"),
    phone: get("phone_number", "phone"),
    state: get("state"),
    loan_purpose: get("loan_purpose", "purpose", "loan_type", "what_type"),
    property_value: parseMoney(get("property_value", "home_value", "purchase_price")),
    credit_band: get("credit_band", "credit_score", "credit"),
    // Capture the remaining SCORING inputs so a Meta lead can actually reach Tier 1.
    // Previously liquid_assets/credit_score/income were never mapped, so paid leads
    // were structurally capped at Tier 2/3 no matter how strong the borrower was.
    // parseMoney handles "$100k+", "$50,000–$99,999", etc. (range answers tier to the floor).
    liquid_assets: parseMoney(get("liquid_assets", "liquid_reserves", "reserves", "cash", "savings", "available_funds")),
    credit_score: Number(String(getExact("credit_score") || "").replace(/[^0-9.]/g, "")) || undefined,
    income: parseMoney(get("annual_income", "monthly_income", "gross_income", "income")),
    loan_amount_requested: parseMoney(get("loan_amount_requested", "loan_amount", "amount_needed")),
  };
  // keep everything for the record
  body.notes = "Meta Lead Ad: " + fieldData.map((f) => `${f.name}=${Array.isArray(f.values) ? f.values.join("/") : f.values}`).join("; ");
  return body;
}

// Never lose a paid Meta lead: when the Graph fetch or intake fails, persist what we
// have directly to `leads` (so it shows up in the Leads tab, clearly flagged) and
// alert the team — instead of the lead silently vanishing.
async function saveFallbackLead(v: any, partial: Record<string, any>, reason: string) {
  try {
    const platform = String(v?.platform || "facebook").toLowerCase();
    const src = platform === "ig" || platform === "instagram" ? "instagram" : "facebook";
    const phone = canonicalPhone(partial.phone);
    const emailNorm = partial.email ? String(partial.email).trim().toLowerCase() : null;

    // DEDUP before inserting (same email-or-phone check as /api/apply, both phone forms):
    // this missing check is how one person became two lead rows + got double-contacted.
    const orParts: string[] = [];
    if (emailNorm) orParts.push(`email.eq.${emailNorm}`);
    if (phone) for (const f of phoneMatchForms(phone)) orParts.push(`phone.eq.${f}`);
    if (orParts.length) {
      const { data: existing } = await supabaseAdmin
        .from("leads").select("id, full_name").or(orParts.join(",")).limit(1).maybeSingle();
      if (existing) {
        const mismatch = partial.full_name && existing.full_name &&
          String(partial.full_name).trim().toLowerCase() !== String(existing.full_name).trim().toLowerCase();
        await notifyNewLead({
          lead_id: existing.id as string, full_name: partial.full_name ?? existing.full_name, email: emailNorm, phone,
          state: partial.state, loan_purpose: partial.loan_purpose, score: 0, tier: "Tier 3",
          source: `${src} — DUPLICATE lead-ad submission (already lead ${String(existing.id).slice(0, 8)})${mismatch ? ` ⚠️ DIFFERENT name (was "${existing.full_name}") — possible fake` : ""}`,
          returning: true, auto_sent: [],
        });
        return; // never a second row, never a second auto-contact
      }
    }

    // Contactless shells (no email AND no phone) can't be worked — put them in
    // the shield's Review lane with evidence instead of "New Lead" limbo. Shells
    // WITH contact info stay New Lead (a real borrower behind a Graph hiccup).
    const contactless = !emailNorm && !phone;
    const row = {
      full_name: partial.full_name ?? null,
      email: emailNorm,
      phone,
      state: partial.state ?? null,
      loan_purpose: partial.loan_purpose ?? null,
      notes: `⚠️ Facebook Lead Ad received but ${reason}. ${partial.notes || ""}`.trim(),
      stage: contactless ? "Review" : "New Lead",
      nurture_paused: contactless ? true : undefined,
      source: src,
      lead_source: src,
      raw: {
        meta: { leadgen_id: v?.leadgen_id, form_id: v?.form_id, page_id: v?.page_id, ad_id: v?.ad_id, created_time: v?.created_time },
        fallback_reason: reason,
        ...partial,
        ...(contactless ? { shield: { version: 1, verdict: "quarantine", band: "junk", risk: 60, signals: [{ key: "meta_shell", pts: 60, ev: "hard", note: reason }], channel: "meta", quarantined_at: new Date().toISOString(), pre_quarantine_stage: "New Lead" } } : {}),
      },
    };
    const { data } = await supabaseAdmin.from("leads").insert([row]).select("id").single();
    await notifyNewLead({
      lead_id: (data as any)?.id, full_name: row.full_name, email: row.email, phone: row.phone,
      state: row.state, loan_purpose: row.loan_purpose, score: 0, tier: "Tier 3",
      source: `${src} ⚠️ needs attention (${reason})`, auto_sent: [],
    });
  } catch (e: any) {
    console.error("[meta/webhook] fallback save failed:", e?.message);
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const appSecret = await cfg("META_APP_SECRET");
  // Missing secret means we can't trust the payload — fail LOUD (500) so Meta
  // retries and the gap is visible, instead of silently swallowing a real lead.
  if (!appSecret) { console.error("[meta/webhook] META_APP_SECRET not set"); return NextResponse.json({ error: "not configured" }, { status: 500 }); }
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }, { status: 200 }); }

  const fallbackToken = await cfg("META_ACCESS_TOKEN");
  // Per-page token map so we can fetch leads from ANY of the user's pages, not just one.
  let tokenMap: Record<string, string> = {};
  try { tokenMap = JSON.parse((await cfg("META_PAGE_TOKENS")) || "{}"); } catch { tokenMap = {}; }
  // Trusted server-to-server intake: carry an internal secret so /api/apply skips
  // the public per-IP rate limiter (the self-call has no real client IP, so a burst
  // of paid leads would otherwise all share one bucket and get throttled).
  const internalHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.CRON_SECRET) internalHeaders["x-fetti-internal"] = process.env.CRON_SECRET;

  // ACK Meta IMMEDIATELY, process in the background (after()). Doing the Graph fetch
  // + intake BEFORE responding pushed the response past Meta's webhook timeout, so Meta
  // marked deliveries FAILED and kept redelivering the same event — every redelivery
  // re-ran intake and re-alerted the team (the Medrano 15-minute ding loop, 2026-07-04).
  after(async () => {
  try {
    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== "leadgen") continue;
        const v = change.value || {};
        const leadgenId = v.leadgen_id;
        if (!leadgenId) { console.warn("[meta/webhook] leadgen change with no leadgen_id"); continue; }
        // IDEMPOTENCY: Meta redelivers events it thinks failed (and can redeliver on
        // subscription refreshes). A leadgen_id we already processed is a no-op —
        // never a second intake, never a second alert.
        try {
          const { data: already } = await supabaseAdmin
            .from("leads").select("id")
            .filter("raw->meta->>leadgen_id", "eq", String(leadgenId))
            .limit(1).maybeSingle();
          if (already) { console.log("[meta/webhook] redelivery of", leadgenId, "→ already lead", (already as any).id, "— skipped"); continue; }
        } catch { /* check is best-effort — worst case the alert throttle below still holds */ }
        const pageToken = tokenMap[v.page_id] || fallbackToken;
        if (!pageToken) {
          console.warn("[meta/webhook] no page token — saving fallback lead");
          await saveFallbackLead(v, {}, "no Meta access token is connected (reconnect Meta on /settings)");
          continue;
        }
        const platform = (v.platform || "facebook").toLowerCase();
        const src = platform === "ig" || platform === "instagram" ? "instagram" : "facebook";
        try {
          const r = await fetch(`${GRAPH}/${leadgenId}?access_token=${pageToken}`, { signal: AbortSignal.timeout(10000) });
          const lead = await r.json();
          if (!r.ok || !lead.field_data) {
            const msg = lead?.error?.message || `HTTP ${r.status}`;
            console.error("[meta/webhook] graph fetch failed:", msg);
            await saveFallbackLead(v, {}, `could not fetch lead details (${msg}) — token likely missing leads_retrieval`);
            continue;
          }
          const mapped = mapFields(lead.field_data);
          const body = {
            ...mapped,
            source: src,
            utm_source: src,
            utm_medium: "paid_social",
            utm_campaign: v.ad_id ? `meta_ad_${v.ad_id}` : "meta_lead_ad",
            consent: true, consent_at: new Date().toISOString(),
            consent_text: "Submitted a Meta Lead Ad instant form requesting contact from Fetti Financial Services.",
            meta: { leadgen_id: leadgenId, form_id: v.form_id, page_id: v.page_id, ad_id: v.ad_id, created_time: v.created_time },
          };
          // Route through the same intake the website uses (scoring, auto-response, alert, agents).
          const ar = await fetch(`${APP_URL}/api/apply`, { method: "POST", headers: internalHeaders, body: JSON.stringify(body) });
          if (!ar.ok) {
            console.error("[meta/webhook] /api/apply rejected:", ar.status);
            await saveFallbackLead(v, mapped, `intake rejected (HTTP ${ar.status})`);
          }
        } catch (e: any) {
          console.error("[meta/webhook] lead handling error:", e?.message);
          await saveFallbackLead(v, {}, `lead handling error (${e?.message || "unknown"})`);
        }
      }
    }
  } catch (e: any) { console.error("[meta/webhook] processing error:", e?.message); }
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}

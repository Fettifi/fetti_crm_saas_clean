// Meta Conversions API (server-side). Reports a "Lead" to the Meta Pixel whenever a
// lead is created in our CRM, so Meta can OPTIMIZE campaigns toward real leads (not
// just clicks/views) and the leads show up in ad reporting/attribution. PII is SHA-256
// hashed before it leaves our server, per Meta's requirements. Best-effort: never
// throws into the request path, and safely no-ops if the pixel/token isn't configured.
import { cfg, setSetting } from "@/lib/settings";
import crypto from "crypto";

const GRAPH = "https://graph.facebook.com/v21.0";
const sha256 = (s: string) => crypto.createHash("sha256").update(s.trim().toLowerCase()).digest("hex");
const KNOWN_ACCOUNTS = ["act_3631424977078470", "act_1192914151836153"];

// Find the business's Meta Pixel (dataset) id and cache it in app_settings.
export async function discoverPixel(): Promise<{ id: string | null; detail: string }> {
  const existing = await cfg("META_PIXEL_ID");
  if (existing) return { id: existing, detail: "configured" };
  const token = (await cfg("META_USER_TOKEN")) || (await cfg("META_ACCESS_TOKEN"));
  if (!token) return { id: null, detail: "no token" };
  for (const acct of KNOWN_ACCOUNTS) {
    try {
      const j = await (await fetch(`${GRAPH}/${acct}/adspixels?fields=id,name&access_token=${token}`, { signal: AbortSignal.timeout(12000) })).json();
      const px = (j?.data || [])[0];
      if (px?.id) { await setSetting("META_PIXEL_ID", String(px.id)); return { id: String(px.id), detail: `found on ${acct}: ${px.name || px.id}` }; }
      if (j?.error) return { id: null, detail: j.error.message };
    } catch { /* try next */ }
  }
  return { id: null, detail: "no pixel found on the ad accounts" };
}

// Discover the pixel, or CREATE one (on the LLC ad account) if none exists, so the
// Conversions API can report website/wizard leads to Meta — enabling lead-optimized
// campaigns, retargeting, and real attribution. Idempotent; caches META_PIXEL_ID.
export async function ensurePixel(): Promise<{ id: string | null; detail: string; created?: boolean }> {
  const found = await discoverPixel();
  if (found.id) return found;
  const token = (await cfg("META_USER_TOKEN")) || (await cfg("META_ACCESS_TOKEN"));
  if (!token) return { id: null, detail: "no token to create a pixel" };
  for (const acct of ["act_1192914151836153", "act_3631424977078470"]) {
    try {
      const body = new URLSearchParams({ name: "Fetti Lead Pixel", access_token: token });
      const r = await fetch(`${GRAPH}/${acct}/adspixels`, { method: "POST", body, signal: AbortSignal.timeout(12000) });
      const j = await r.json();
      if (j?.id) { await setSetting("META_PIXEL_ID", String(j.id)); return { id: String(j.id), detail: `created on ${acct}`, created: true }; }
      // Account may already have a pixel we couldn't list — try to read it back.
      const rd = await (await fetch(`${GRAPH}/${acct}/adspixels?fields=id,name&access_token=${token}`, { signal: AbortSignal.timeout(10000) })).json();
      const px = (rd?.data || [])[0];
      if (px?.id) { await setSetting("META_PIXEL_ID", String(px.id)); return { id: String(px.id), detail: `existing on ${acct}` }; }
    } catch { /* try next account */ }
  }
  return { id: null, detail: "could not create a pixel via API — create one in Events Manager and I'll wire it" };
}

// Fire a server-side "Lead" conversion event for a CRM lead.
export async function sendMetaLeadEvent(lead: any, opts?: { sourceUrl?: string; eventTime?: number }): Promise<{ ok: boolean; detail: string }> {
  try {
    const pixel = await cfg("META_PIXEL_ID");
    const token = (await cfg("META_CAPI_TOKEN")) || (await cfg("META_USER_TOKEN")) || (await cfg("META_ACCESS_TOKEN"));
    if (!pixel || !token) return { ok: false, detail: "pixel/token not configured" };

    const raw = lead?.raw && typeof lead.raw === "object" ? lead.raw : {};
    const email = lead?.email ? String(lead.email) : null;
    const phoneDigits = lead?.phone ? String(lead.phone).replace(/\D/g, "") : null;
    const user_data: Record<string, any> = {};
    if (email) user_data.em = [sha256(email)];
    if (phoneDigits) user_data.ph = [sha256(phoneDigits)];
    if (lead?.full_name) {
      const parts = String(lead.full_name).trim().split(/\s+/);
      if (parts[0]) user_data.fn = [sha256(parts[0])];
      if (parts.length > 1) user_data.ln = [sha256(parts.slice(1).join(" "))];
    }
    if (lead?.state) user_data.st = [sha256(String(lead.state))];
    // fbc/fbp improve match quality when the click id was captured at intake.
    const fbclid = raw.fbclid || raw.fbc;
    if (fbclid) user_data.fbc = String(fbclid).startsWith("fb.") ? String(fbclid) : `fb.1.${Math.floor(Date.now() / 1000)}.${fbclid}`;

    // Deferred sends (shield promotions) pass the ORIGINAL intake time so ad
    // attribution survives quarantine — Meta accepts event_time up to 7 days back.
    const eventTime = opts?.eventTime && isFinite(opts.eventTime)
      ? Math.max(Math.floor(Date.now() / 1000) - 6 * 86400, Math.floor(opts.eventTime))
      : Math.floor(Date.now() / 1000);
    const event = {
      event_name: "Lead",
      event_time: eventTime,
      action_source: "website",
      event_id: String(lead?.id || ""),   // dedup key (Meta de-dups against any pixel event with the same id)
      event_source_url: opts?.sourceUrl || raw.referrer || (process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com"),
      user_data,
      custom_data: { lead_source: lead?.source || "website", content_name: lead?.loan_purpose || "Mortgage inquiry" },
    };
    const body = new URLSearchParams({ data: JSON.stringify([event]), access_token: token });
    const r = await fetch(`${GRAPH}/${pixel}/events`, { method: "POST", body, signal: AbortSignal.timeout(12000) });
    const j = await r.json();
    if (typeof j?.events_received === "number" && j.events_received >= 1) return { ok: true, detail: `events_received=${j.events_received}` };
    return { ok: false, detail: j?.error?.message || `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "error" };
  }
}

// Fire a server-side "Purchase" conversion when a loan FUNDS — the bottom-of-funnel
// money event. This closes the optimization loop: Meta learns which ad clicks turned
// into real, funded loans (not just form-fills) and can bid toward that outcome via
// value-based optimization. value = the funded loan amount (the strongest signal for
// VBO). A distinct event_id keeps it from de-duping against the Lead/QualifiedLead
// events. Best-effort; never throws. Report ONCE per loan (caller guards re-fires).
export async function sendMetaFundedEvent(
  lead: any,
  opts?: { value?: number; sourceUrl?: string; loanFileId?: string }
): Promise<{ ok: boolean; detail: string }> {
  try {
    const pixel = await cfg("META_PIXEL_ID");
    const token = (await cfg("META_CAPI_TOKEN")) || (await cfg("META_USER_TOKEN")) || (await cfg("META_ACCESS_TOKEN"));
    if (!pixel || !token) return { ok: false, detail: "pixel/token not configured" };

    const raw = lead?.raw && typeof lead.raw === "object" ? lead.raw : {};
    const user_data: Record<string, any> = {};
    if (lead?.email) user_data.em = [sha256(String(lead.email))];
    const phoneDigits = lead?.phone ? String(lead.phone).replace(/\D/g, "") : null;
    if (phoneDigits) user_data.ph = [sha256(phoneDigits)];
    if (lead?.full_name) {
      const parts = String(lead.full_name).trim().split(/\s+/);
      if (parts[0]) user_data.fn = [sha256(parts[0])];
      if (parts.length > 1) user_data.ln = [sha256(parts.slice(1).join(" "))];
    }
    if (lead?.state) user_data.st = [sha256(String(lead.state))];
    const fbclid = raw.fbclid || raw.fbc;
    if (fbclid) user_data.fbc = String(fbclid).startsWith("fb.") ? String(fbclid) : `fb.1.${Math.floor(Date.now() / 1000)}.${fbclid}`;

    const value = typeof opts?.value === "number" && opts.value > 0 ? Math.round(opts.value) : 0;
    const event = {
      event_name: "Purchase",
      event_time: Math.floor(Date.now() / 1000),
      action_source: "system_generated",
      // Per-loan-file id (a lead can have more than one funded file) so Meta doesn't
      // de-dup a second funded loan against the first.
      event_id: `${opts?.loanFileId || lead?.id || ""}:funded`,
      event_source_url: opts?.sourceUrl || raw.referrer || (process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com"),
      user_data,
      custom_data: { value, currency: "USD", content_name: lead?.loan_purpose || "Funded loan", content_category: "funded_loan" },
    };
    const body = new URLSearchParams({ data: JSON.stringify([event]), access_token: token });
    const r = await fetch(`${GRAPH}/${pixel}/events`, { method: "POST", body, signal: AbortSignal.timeout(12000) });
    const j = await r.json();
    if (typeof j?.events_received === "number" && j.events_received >= 1) return { ok: true, detail: `events_received=${j.events_received}` };
    return { ok: false, detail: j?.error?.message || `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "error" };
  }
}

// Fire a server-side "QualifiedLead" custom conversion AFTER the Qualify agent says a
// lead is fundable. This is the quality feedback loop: tell Meta which leads were
// actually good so campaigns can optimize delivery toward that profile (set the ad
// set to optimize for the "QualifiedLead" custom event). A distinct event_id keeps it
// from de-duping against the earlier "Lead" event. value scales with tier so it can
// also drive value-based optimization later. Best-effort; never throws.
export async function sendMetaQualifiedEvent(
  lead: any,
  opts?: { tier?: string; decision?: string; sourceUrl?: string }
): Promise<{ ok: boolean; detail: string }> {
  try {
    const pixel = await cfg("META_PIXEL_ID");
    const token = (await cfg("META_CAPI_TOKEN")) || (await cfg("META_USER_TOKEN")) || (await cfg("META_ACCESS_TOKEN"));
    if (!pixel || !token) return { ok: false, detail: "pixel/token not configured" };

    const raw = lead?.raw && typeof lead.raw === "object" ? lead.raw : {};
    const user_data: Record<string, any> = {};
    if (lead?.email) user_data.em = [sha256(String(lead.email))];
    const phoneDigits = lead?.phone ? String(lead.phone).replace(/\D/g, "") : null;
    if (phoneDigits) user_data.ph = [sha256(phoneDigits)];
    if (lead?.full_name) {
      const parts = String(lead.full_name).trim().split(/\s+/);
      if (parts[0]) user_data.fn = [sha256(parts[0])];
      if (parts.length > 1) user_data.ln = [sha256(parts.slice(1).join(" "))];
    }
    if (lead?.state) user_data.st = [sha256(String(lead.state))];
    const fbclid = raw.fbclid || raw.fbc;
    if (fbclid) user_data.fbc = String(fbclid).startsWith("fb.") ? String(fbclid) : `fb.1.${Math.floor(Date.now() / 1000)}.${fbclid}`;
    // external_id (the lead's own id, hashed) raises Meta's match rate so it can attribute
    // this qualified conversion back to the original ad click and optimize delivery better.
    if (lead?.id) user_data.external_id = [sha256(String(lead.id))];

    const tier = String(opts?.tier || "");
    const value = /tier\s*1/i.test(tier) ? 100 : /tier\s*2/i.test(tier) ? 50 : 25;

    const event = {
      event_name: "QualifiedLead",
      event_time: Math.floor(Date.now() / 1000),
      action_source: "system_generated",
      event_id: `${lead?.id || ""}:qualified`,   // distinct from the "Lead" event id
      event_source_url: opts?.sourceUrl || raw.referrer || (process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com"),
      user_data,
      custom_data: {
        lead_quality: opts?.tier || "qualified",
        decision: opts?.decision || "qualified",
        value,
        currency: "USD",
        content_name: lead?.loan_purpose || "Mortgage inquiry",
      },
    };
    const body = new URLSearchParams({ data: JSON.stringify([event]), access_token: token });
    const r = await fetch(`${GRAPH}/${pixel}/events`, { method: "POST", body, signal: AbortSignal.timeout(12000) });
    const j = await r.json();
    if (typeof j?.events_received === "number" && j.events_received >= 1) return { ok: true, detail: `events_received=${j.events_received}` };
    return { ok: false, detail: j?.error?.message || `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "error" };
  }
}

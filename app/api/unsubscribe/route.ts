import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { unsubToken } from "@/lib/notify/emailCopy";
import { logActivity } from "@/lib/activity";
import { emailOptOutRecord } from "@/lib/smsConsent";

// One-click email unsubscribe (CAN-SPAM). Linked from the footer of every borrower
// follow-up email: /api/unsubscribe?l=<leadId>&t=<hmac>. Sets nurture_paused on the
// lead so the drip/reactivation engine skips them permanently. Public (no session —
// borrowers click from their inbox); the HMAC token prevents guessing lead ids.
//
// The actual opt-out is performed ONLY on POST — never on GET. A plain footer link is a
// GET, and email security appliances / inbox prefetchers routinely auto-fetch (GET) every
// link in a message to scan it, which would silently pause nurture for engaged leads. So
// GET renders a confirmation page with a button that POSTs back here, and the mutation
// lives in the POST handler. This POST endpoint also satisfies RFC 8058 one-click
// unsubscribe: mail clients that see the List-Unsubscribe-Post header POST
// "List-Unsubscribe=One-Click" to this same URL, which opts the lead out immediately.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CONSTANT-TIME TOKEN COMPARE. `t !== unsubToken(l)` short-circuits on the first differing
// character, so the time to reject leaks how much of a guessed token is correct — and this
// token is only 16 hex characters (lib/notify/emailCopy.ts truncates the HMAC). Twelve other
// token checks in this repo already use timingSafeEqual (lib/cardAuth.ts, lib/portalSession.ts,
// lib/hotLead.ts, app/api/voice/lookup, app/api/meta/webhook, …); these two routes did not.
// timingSafeEqual THROWS on unequal lengths, so the length test has to come first and has to
// return false rather than propagate — a thrown comparison would turn a mistyped link into a
// 500 and break the one-click unsubscribe for everyone.
function tokenEquals(given: string, expected: string): boolean {
  const a = Buffer.from(String(given || ""), "utf8");
  const b = Buffer.from(String(expected || ""), "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

const page = (title: string, msg: string) => new NextResponse(
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
  <body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:40px;max-width:420px;text-align:center">
      <div style="font-weight:800;font-size:18px;color:#0f172a">${title}</div>
      <p style="color:#475569;font-size:14px;line-height:1.6">${msg}</p>
      <div style="font-size:11px;color:#94a3b8;margin-top:18px">Fetti Financial Services LLC · NMLS #2267023</div>
    </div>
  </body></html>`,
  { status: 200, headers: { "Content-Type": "text/html" } }
);

// Confirmation page shown on GET: a single button that POSTs back to perform the opt-out.
// The button is a real form submit so no client JS is required and link scanners (which
// only issue GETs) can never trigger the state change.
const confirmPage = (l: string, t: string) => new NextResponse(
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title></head>
  <body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:40px;max-width:420px;text-align:center">
      <div style="font-weight:800;font-size:18px;color:#0f172a">Stop follow-up emails?</div>
      <p style="color:#475569;font-size:14px;line-height:1.6">Click below to unsubscribe from Fetti follow-up emails. You'll stop hearing from our drip right away.</p>
      <form method="post" action="/api/unsubscribe?l=${encodeURIComponent(l)}&t=${encodeURIComponent(t)}">
        <button type="submit" style="background:#0f172a;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:14px;font-weight:700;cursor:pointer">Unsubscribe</button>
      </form>
      <div style="font-size:11px;color:#94a3b8;margin-top:18px">Fetti Financial Services LLC · NMLS #2267023</div>
    </div>
  </body></html>`,
  { status: 200, headers: { "Content-Type": "text/html" } }
);

export async function GET(req: NextRequest) {
  const l = req.nextUrl.searchParams.get("l") || "";
  const t = req.nextUrl.searchParams.get("t") || "";
  if (!l || !t || !tokenEquals(t, unsubToken(l))) {
    return page("Link problem", "This unsubscribe link isn't valid. If you'd like to stop emails, just reply “unsubscribe” to any message and we'll take care of it.");
  }
  // Do NOT mutate on GET — just render the confirmation form (see header note).
  return confirmPage(l, t);
}

export async function POST(req: NextRequest) {
  const l = req.nextUrl.searchParams.get("l") || "";
  const t = req.nextUrl.searchParams.get("t") || "";
  if (!l || !t || !tokenEquals(t, unsubToken(l))) {
    return page("Link problem", "This unsubscribe link isn't valid. If you'd like to stop emails, just reply “unsubscribe” to any message and we'll take care of it.");
  }
  try {
    // ── THE OPT-OUT NEEDS A RECORD THAT SURVIVES. ────────────────────────────────────────────
    //
    // This wrote `nurture_paused: true` and nothing else, so the consumer's own act left no
    // artifact: after the 2026-10-14 transactional fix, lib/smsConsent.ts treats a bare
    // nurture_paused as "an LO paused the drip", which is the opposite of a revocation.
    //
    // Worse, the column is cleared behind our back. lib/leadShield.ts:534 (promoteQuarantined)
    // sets `nurture_paused: false` unconditionally and then replays the new-lead pipeline,
    // first-touch email included. autoPromoteIfQuarantined fires it from app/api/apply/prefill
    // (a LINK CLICK), the portal upload route, the Calendly webhook, inbound SMS and
    // lib/inbound/ingestEmail — and the unsubscribe footer and the pre-filled apply link travel
    // in the SAME drip email. A borrower in Review stage who unsubscribes and then taps the
    // apply link in that same message had their opt-out erased and the drip restarted.
    //
    // emailOptOutRecord() writes a timestamped, sourced artifact into `raw`, which
    // promoteQuarantined preserves (it spreads raw and only edits raw.shield). nurture_paused
    // is still set, because the cheap drip checks that read only that column — the watchdog's
    // queue drain, lib/nurture.ts — must keep holding too.
    //
    // SCOPE: this is the CAN-SPAM commercial opt-out, not a blanket "never contact me". The page
    // this link renders says "stop follow-up emails"; a document the borrower is waiting on is a
    // transactional message under 15 U.S.C. §7702(2)(B),(17) and keeps going. See the comment on
    // messagingAllowed() — writing `email_optout_at` here would silently kill card
    // authorizations and e-sign links, which is the Strapko failure of 2026-10-14.
    const { data: lead, error } = await supabaseAdmin.from("leads").select("raw").eq("id", l).maybeSingle();
    if (error || !lead) {
      // NEVER WRITE A RECONSTRUCTED `raw` OVER ONE WE COULD NOT READ. This is a read-modify-write
      // on a JSON blob that also holds the SMS consent artifact, the Shield verdict and the income
      // facts; spreading `{}` on a failed read would erase all of it. Honour the intent with the
      // column that needs no read, and say in the log that the artifact is missing.
      await supabaseAdmin.from("leads").update({ nurture_paused: true }).eq("id", l);
      await logActivity({ entity_type: "lead", entity_id: l, lead_id: l, actor: "borrower", action: "email.unsubscribed", detail: { via: "one-click link", artifact: "NOT WRITTEN — could not read the lead", error: (error as any)?.message || "no row" } }).catch(() => {});
    } else {
      const prior = ((lead as any).raw && typeof (lead as any).raw === "object" ? (lead as any).raw : {}) as Record<string, unknown>;
      const raw = { ...prior, ...emailOptOutRecord(prior as any, "one_click_link") };
      await supabaseAdmin.from("leads").update({ raw, nurture_paused: true }).eq("id", l);
      await logActivity({ entity_type: "lead", entity_id: l, lead_id: l, actor: "borrower", action: "email.unsubscribed", detail: { via: "one-click link", recorded: "raw.email_marketing_optout_at" } }).catch(() => {});
    }
  } catch { /* still show success — we honor the intent */ }
  return page("You're unsubscribed", "You won't receive follow-up emails from us anymore. If you change your mind, just reach out at fettifi.com — we'll be here.");
}

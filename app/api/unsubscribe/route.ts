import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { unsubToken } from "@/lib/notify/emailCopy";
import { logActivity } from "@/lib/activity";

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
  if (!l || !t || t !== unsubToken(l)) {
    return page("Link problem", "This unsubscribe link isn't valid. If you'd like to stop emails, just reply “unsubscribe” to any message and we'll take care of it.");
  }
  // Do NOT mutate on GET — just render the confirmation form (see header note).
  return confirmPage(l, t);
}

export async function POST(req: NextRequest) {
  const l = req.nextUrl.searchParams.get("l") || "";
  const t = req.nextUrl.searchParams.get("t") || "";
  if (!l || !t || t !== unsubToken(l)) {
    return page("Link problem", "This unsubscribe link isn't valid. If you'd like to stop emails, just reply “unsubscribe” to any message and we'll take care of it.");
  }
  try {
    await supabaseAdmin.from("leads").update({ nurture_paused: true }).eq("id", l);
    await logActivity({ entity_type: "lead", entity_id: l, lead_id: l, actor: "borrower", action: "email.unsubscribed", detail: { via: "one-click link" } }).catch(() => {});
  } catch { /* still show success — we honor the intent */ }
  return page("You're unsubscribed", "You won't receive follow-up emails from us anymore. If you change your mind, just reach out at fettifi.com — we'll be here.");
}

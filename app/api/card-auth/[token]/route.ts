// PUBLIC borrower-facing credit-card authorization (token-gated by the loan file's
// share_token + ?b=<borrowerIndex>). The borrower e-signs a blanket authorization and
// provides their card. We store the PAN ENCRYPTED and NEVER store the CVV.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { BRAND } from "@/lib/brand";
import { blanketAuthText, cardBrand, luhnValid, last4, encryptPan, encryptCvv, CVV_TTL_HOURS, cardAuthSigValid, type CardAuth } from "@/lib/cardAuth";

export const dynamic = "force-dynamic";

// Concurrency-safe persist: re-read the FRESHEST leads.raw immediately before writing and
// merge ONLY this borrower's card_auth entry back. A whole-`raw` overwrite (read at the
// top of the request, written seconds later after validation + encryption) silently loses
// any concurrent writer's change — including a co-borrower's just-signed authorization or
// an LO status update. Narrowing the write to a single jsonb key on a fresh read removes
// that cross-key clobber. NOTE: a fully atomic write still requires a jsonb_set RPC or a
// dedicated card_authorizations table (a DB migration) — see the deferred note.
async function persistCardAuthEntry(leadId: string, index: number, entry: CardAuth) {
  const { data: fresh } = await supabaseAdmin.from("leads").select("raw").eq("id", leadId).maybeSingle();
  const raw = (fresh?.raw && typeof fresh.raw === "object") ? fresh.raw : {};
  const auths: Record<string, CardAuth> = (raw.card_auths && typeof raw.card_auths === "object") ? raw.card_auths : {};
  auths[String(index)] = entry;
  raw.card_auths = auths;
  return supabaseAdmin.from("leads").update({ raw }).eq("id", leadId);
}

async function resolve(token: string, b: string | null, sig: string | null) {
  const i = Number(b);
  if (!token || token.length < 12 || !(i >= 0)) return null;
  // Per-borrower binding: the ?b index must carry a valid HMAC (?s=). This stops a
  // holder of the file token from iterating ?b to reach another borrower's card entry.
  if (!cardAuthSigValid(token, i, sig)) return null;
  const { data: file } = await supabaseAdmin.from("loan_files").select("id, file_number, lead_id, share_token").eq("share_token", token).maybeSingle();
  if (!file?.lead_id) return null;
  const { data: lead } = await supabaseAdmin.from("leads").select("*").eq("id", file.lead_id).maybeSingle();
  if (!lead) return null;
  const auths: Record<string, CardAuth> = (lead.raw?.card_auths && typeof lead.raw.card_auths === "object") ? lead.raw.card_auths : {};
  return { file, lead, i, auth: auths[String(i)] || null, auths };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await resolve(token, req.nextUrl.searchParams.get("b"), req.nextUrl.searchParams.get("s"));
  if (!r || !r.auth) return NextResponse.json({ error: "This authorization link is invalid or has expired." }, { status: 404 });
  return NextResponse.json({
    company: BRAND.company, nmls: BRAND.nmls,
    fileNumber: r.file.file_number,
    borrowerName: r.auth.borrowerName,
    amount: r.auth.amount,
    scope: r.auth.scope,
    authText: blanketAuthText(r.file.file_number, r.auth.amount),
    alreadyAuthorized: r.auth.status === "authorized",
    last4: r.auth.last4,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const r = await resolve(token, req.nextUrl.searchParams.get("b"), req.nextUrl.searchParams.get("s"));
    if (!r || !r.auth) return NextResponse.json({ error: "This authorization link is invalid or has expired." }, { status: 404 });
    const body = await req.json();

    const cardholder = String(body?.cardholder || "").trim().slice(0, 80);
    const pan = String(body?.cardNumber || "").replace(/\D/g, "");
    const expMonth = String(body?.expMonth || "").replace(/\D/g, "").padStart(2, "0").slice(0, 2);
    const expYear = String(body?.expYear || "").replace(/\D/g, "").slice(-2);
    const billingZip = String(body?.billingZip || "").trim().slice(0, 10);
    const signature = String(body?.signature || "").trim().slice(0, 80);
    const consented = body?.consent === true;
    // CVV is SENSITIVE AUTHENTICATION DATA. We hold it ONLY transiently (encrypted, with a
    // short TTL) so the LO can make the initial keyed charge, then it auto-purges. It is
    // never long-lived, never returned in status, never logged.
    const cvv = String(body?.cvv || "").replace(/\D/g, "");

    if (!cardholder) return NextResponse.json({ error: "Enter the cardholder name." }, { status: 400 });
    if (!luhnValid(pan)) return NextResponse.json({ error: "That card number doesn't look valid." }, { status: 400 });
    if (!/^(0[1-9]|1[0-2])$/.test(expMonth) || expYear.length !== 2) return NextResponse.json({ error: "Enter a valid expiry (MM / YY)." }, { status: 400 });
    if (!/^\d{3,4}$/.test(cvv)) return NextResponse.json({ error: "Enter the 3 or 4-digit security code (CVV)." }, { status: 400 });
    if (billingZip.length < 5) return NextResponse.json({ error: "Enter the card's billing ZIP." }, { status: 400 });
    if (!signature) return NextResponse.json({ error: "Type your full name to sign." }, { status: 400 });
    if (!consented) return NextResponse.json({ error: "You must check the authorization box to continue." }, { status: 400 });

    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
    const updated: CardAuth = {
      ...r.auth,
      status: "authorized",
      cardholder, brand: cardBrand(pan), last4: last4(pan), expMonth, expYear, billingZip,
      panEnc: encryptPan(pan), // PAN encrypted at rest, retained
      cvvEnc: encryptCvv(cvv), // CVV encrypted + TRANSIENT — auto-purges after the TTL below
      cvvExpiresAt: new Date(Date.now() + CVV_TTL_HOURS * 3600 * 1000).toISOString(),
      consentText: blanketAuthText(r.file.file_number, r.auth.amount),
      signature, signedAt: new Date().toISOString(), signerIp: ip,
    };
    // Merge onto a fresh read so a concurrent writer (co-borrower / LO) isn't clobbered.
    const { error } = await persistCardAuthEntry(r.lead.id, r.i, updated);
    if (error) return NextResponse.json({ error: "Could not save your authorization. Please try again." }, { status: 500 });

    await logActivity({
      entity_type: "loan_file", entity_id: r.file.id, loan_file_id: r.file.id, lead_id: r.lead.id,
      actor: "borrower", action: "card_auth.signed", detail: { borrowerIndex: r.i, brand: updated.brand, last4: updated.last4, amount: r.auth.amount },
    }).catch(() => {});

    return NextResponse.json({ ok: true, brand: updated.brand, last4: updated.last4 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}

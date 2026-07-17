// LO-side per-borrower credit-card authorization. Auth-gated via the /api/los matcher.
//   GET  /api/los/files/[id]/card-auth                         -> per-borrower status + links
//   POST /api/los/files/[id]/card-auth  { borrowerIndex, amount, scope? }  -> create/update a request
//   POST /api/los/files/[id]/card-auth  { borrowerIndex, action:"reveal" } -> decrypt PAN (access-logged)
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { assembleUrla } from "@/lib/urla";
import { logActivity } from "@/lib/activity";
import { getCardAuths, publicCardView, blanketAuthText, decryptPan, decryptCvv, cvvLive, purgeExpiredCvv, cardAuthSig, type CardAuth } from "@/lib/cardAuth";
import { sendSignRequest } from "@/lib/notify/docRequest";

export const dynamic = "force-dynamic";

// The specific borrower's contact (per-borrower from the 1003), falling back to the
// file's / lead's primary contact — so a co-borrower's link goes to THEIR email/phone.
function borrowerContact(lead: any, loanFile: any, i: number): { email: string | null; phone: string | null } {
  const u = assembleUrla(lead, loanFile);
  const b: any = (u.borrowers || [])[i] || {};
  return {
    email: b.email || loanFile.email || lead.email || null,
    phone: b.cellPhone || b.homePhone || loanFile.phone || lead.phone || null,
  };
}

async function load(id: string) {
  const { data: loanFile } = await supabaseAdmin.from("loan_files").select("*").eq("id", id).maybeSingle();
  if (!loanFile?.lead_id) return { loanFile: null, lead: null };
  const { data: lead } = await supabaseAdmin.from("leads").select("*").eq("id", loanFile.lead_id).maybeSingle();
  return { loanFile, lead };
}

// Concurrency-safe persist: re-read the FRESHEST leads.raw right before writing and merge
// ONLY this borrower's card_auth entry. A whole-`raw` overwrite loses any change a
// concurrent writer (e.g. the borrower e-signing at the token endpoint, or a co-borrower's
// request) made between our load() and this write. Narrowing to a single jsonb key on a
// fresh read removes that cross-key clobber. A fully atomic write would need a jsonb_set
// RPC or a dedicated card_authorizations table (DB migration) — deferred.
async function persistCardAuthEntry(leadId: string, index: number, entry: CardAuth) {
  const { data: fresh } = await supabaseAdmin.from("leads").select("raw").eq("id", leadId).maybeSingle();
  const raw = (fresh?.raw && typeof fresh.raw === "object") ? fresh.raw : {};
  const auths: Record<string, CardAuth> = (raw.card_auths && typeof raw.card_auths === "object") ? raw.card_auths : {};
  auths[String(index)] = entry;
  raw.card_auths = auths;
  return supabaseAdmin.from("leads").update({ raw }).eq("id", leadId);
}

function borrowerNames(lead: any, loanFile: any): string[] {
  const u = assembleUrla(lead, loanFile);
  return (u.borrowers || []).map((b: any, i: number) =>
    b.fullName || [b.firstName, b.lastName].filter(Boolean).join(" ") || `Borrower ${i + 1}`);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { loanFile, lead } = await load(id);
  if (!loanFile || !lead) return NextResponse.json({ error: "Loan file not found." }, { status: 404 });
  const names = borrowerNames(lead, loanFile);
  const auths = getCardAuths(lead);
  // Housekeeping: drop any CVV that has passed its TTL (PCI — never retain CVV past use).
  let changed = false;
  for (const k of Object.keys(auths)) { const before = auths[k]?.cvvEnc; purgeExpiredCvv(auths[k]); if (before && !auths[k]?.cvvEnc) changed = true; }
  if (changed) {
    // Purge onto a FRESH read so this housekeeping write can't clobber a borrower who
    // e-signed (or a co-borrower request) between load() above and here.
    const { data: fresh } = await supabaseAdmin.from("leads").select("raw").eq("id", lead.id).maybeSingle();
    const raw = (fresh?.raw && typeof fresh.raw === "object") ? fresh.raw : {};
    const freshAuths: Record<string, CardAuth> = (raw.card_auths && typeof raw.card_auths === "object") ? raw.card_auths : {};
    for (const k of Object.keys(freshAuths)) purgeExpiredCvv(freshAuths[k]);
    raw.card_auths = freshAuths;
    await supabaseAdmin.from("leads").update({ raw }).eq("id", lead.id);
  }
  return NextResponse.json({
    shareToken: loanFile.share_token,
    fileNumber: loanFile.file_number,
    borrowers: names.map((name, i) => ({ index: i, name, auth: publicCardView(auths[String(i)]) })),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const i = Number(body?.borrowerIndex);
    if (!(i >= 0)) return NextResponse.json({ error: "borrowerIndex required" }, { status: 400 });
    const { loanFile, lead } = await load(id);
    if (!loanFile || !lead) return NextResponse.json({ error: "Loan file not found." }, { status: 404 });

    const raw = lead.raw && typeof lead.raw === "object" ? lead.raw : {};
    const auths: Record<string, CardAuth> = (raw.card_auths && typeof raw.card_auths === "object") ? raw.card_auths : {};
    const key = String(i);

    // Reveal the full card for the LO to key into the credit vendor — access-logged.
    // CVV is included ONLY while still within its TTL; expired CVVs are purged on the way out.
    if (body.action === "reveal") {
      const a = auths[key];
      if (!a?.panEnc) return NextResponse.json({ error: "No card on file for this borrower yet." }, { status: 404 });
      const pan = decryptPan(a.panEnc);
      if (!pan) return NextResponse.json({ error: "Could not decrypt the card (missing key)." }, { status: 500 });
      const cvv = cvvLive(a) ? decryptCvv(a.cvvEnc) : undefined;
      a.revealedAt = new Date().toISOString();
      purgeExpiredCvv(a);
      await persistCardAuthEntry(lead.id, i, a); // single-key merge — don't clobber other borrowers
      await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: lead.id, actor: "lo", action: "card_auth.revealed", detail: { borrowerIndex: i, last4: a.last4 } }).catch(() => {});
      return NextResponse.json({ pan, cvv, cvvExpiresAt: cvvLive(a) ? a.cvvExpiresAt : undefined, cardholder: a.cardholder, exp: `${a.expMonth}/${a.expYear}`, brand: a.brand, billingZip: a.billingZip });
    }

    // Clear the CVV immediately (LO has finished keying the charge).
    if (body.action === "clear_cvv") {
      const a = auths[key];
      if (a) { delete a.cvvEnc; delete a.cvvExpiresAt; await persistCardAuthEntry(lead.id, i, a); }
      await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: lead.id, actor: "lo", action: "card_auth.cvv_cleared", detail: { borrowerIndex: i } }).catch(() => {});
      return NextResponse.json({ ok: true });
    }

    // SEND the secure authorization link to the borrower over email + SMS. Ensures the
    // request (with its amount) exists first, then actually delivers it.
    if (body.action === "send") {
      const names = borrowerNames(lead, loanFile);
      const amt = Math.max(0, Math.round(Number(body?.amount) || auths[key]?.amount || 0));
      const ex = auths[key];
      auths[key] = {
        ...(ex || {} as any),
        amount: amt, scope: ex?.scope || "Blanket — all fees for this loan transaction",
        status: ex?.status === "authorized" ? "authorized" : "requested",
        requestedAt: ex?.requestedAt || new Date().toISOString(),
        borrowerName: names[i] || `Borrower ${i + 1}`,
      };
      await persistCardAuthEntry(lead.id, i, auths[key]); // single-key merge — don't clobber other borrowers

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
      const link = `${appUrl}/card-auth/${loanFile.share_token}?b=${i}&s=${cardAuthSig(loanFile.share_token, i)}`;
      const { email, phone } = borrowerContact(lead, loanFile, i);
      if (!email && !phone) {
        return NextResponse.json({ error: "No email or phone on file for this borrower — add their contact on the lead / 1003, or copy the link to send it yourself.", link }, { status: 422 });
      }
      const { sent } = await sendSignRequest({ to_name: names[i], to_email: email, to_phone: phone, link, title: "Credit Card Authorization" });
      await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: lead.id, actor: "lo", action: "card_auth.sent", detail: { borrowerIndex: i, channels: sent, amount: amt } }).catch(() => {});
      return NextResponse.json({
        ok: true, sent, link, to: email || phone,
        message: sent.length ? `Sent via ${sent.join(" + ")} to ${email || phone}.` : "Couldn't deliver (email/SMS not configured) — copy the link to send it manually.",
      });
    }

    // Create / update a request (sets the blanket amount for this loan transaction).
    const amount = Math.max(0, Math.round(Number(body?.amount) || 0));
    const names = borrowerNames(lead, loanFile);
    const existing = auths[key];
    const scope = String(body?.scope || "Blanket — all fees for this loan transaction").slice(0, 200);
    auths[key] = {
      ...(existing || {} as any),
      amount, scope,
      status: existing?.status === "authorized" ? "authorized" : "requested",
      requestedAt: existing?.requestedAt || new Date().toISOString(),
      borrowerName: names[i] || `Borrower ${i + 1}`,
    };
    const { error } = await persistCardAuthEntry(lead.id, i, auths[key]); // single-key merge — don't clobber other borrowers
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: lead.id, actor: "lo", action: "card_auth.requested", detail: { borrowerIndex: i, amount } }).catch(() => {});

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
    return NextResponse.json({
      ok: true,
      link: `${appUrl}/card-auth/${loanFile.share_token}?b=${i}&s=${cardAuthSig(loanFile.share_token, i)}`,
      preview: blanketAuthText(loanFile.file_number, amount),
      auth: publicCardView(auths[key]),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}

// GET /api/los/files/[id]/credit-order — everything needed to key a TRI-MERGE order into
// the Credco portal by hand, in one place and in the portal's own field order.
//
// Credco has no system-to-system interface on this account (checked 2026-07-31: the eCREDCO
// portal exposes no API, and their docs only cover Encompass Desktop/Web), so every pull is
// typed by a human. This exists to make that typing fast and accurate: a transposed digit in
// an SSN or ZIP is a bad pull that has already been paid for, and a wrong DOB can return
// somebody else's file entirely.
//
// Auth-gated by the /api/los matcher. Opening this is ACCESS-LOGGED, because it assembles a
// borrower's SSN and DOB onto one screen — the same reason lib/cardAuth logs a PAN reveal.
// The card is deliberately NOT included: the LO reveals it through the existing card-auth
// reveal action, which has its own audit entry, so there is exactly one logged path to a PAN.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { assembleUrla } from "@/lib/urla";
import { readyForCredit } from "@/lib/credit";
import { getCardAuths, publicCardView, type CardAuth } from "@/lib/cardAuth";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const line = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" ").trim() || null;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { data: loanFile } = await supabaseAdmin.from("loan_files").select("*").eq("id", id).maybeSingle();
    if (!loanFile) return NextResponse.json({ error: "Loan file not found." }, { status: 404 });
    let lead: any = null;
    if (loanFile.lead_id) {
      const r = await supabaseAdmin.from("leads").select("*").eq("id", loanFile.lead_id).maybeSingle();
      lead = r.data;
    }

    const u = assembleUrla(lead, loanFile);
    const ready = readyForCredit(u);

    // Every borrower on the file — a joint tri-merge orders both, and forgetting the
    // co-borrower is a second pull and a second fee.
    const borrowers = (u.borrowers || []).map((b: any) => ({
      name: line(b.firstName, b.middleName, b.lastName),
      firstName: b.firstName || null,
      lastName: b.lastName || null,
      ssn: b.ssn || null,                       // decrypted by assembleUrla; access-logged below
      dob: b.dob || null,
      currentAddress: line(b.currentAddress?.street, b.currentAddress?.unit),
      city: b.currentAddress?.city || null,
      state: b.currentAddress?.state || null,
      zip: b.currentAddress?.zip || null,
      // Credco asks for a prior address when time at the current one is short.
      priorAddress: line(b.priorAddress?.street, b.priorAddress?.city, b.priorAddress?.state, b.priorAddress?.zip),
      employer: b.employment?.employerName || null,
      phone: b.cellPhone || b.homePhone || null,
    }));

    const auths: Record<string, CardAuth> = getCardAuths(lead);
    const card = Object.values(auths || {}).find((a: any) => a?.status === "authorized" && a?.last4);

    await logActivity({
      entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: lead?.id || null,
      actor: "lo", action: "credit_order.viewed",
      detail: { borrowers: borrowers.length, product: "instant_merge" },
    }).catch(() => {});

    return NextResponse.json({
      reference: loanFile.file_number || null,     // use as the Credco reference number
      product: "Instant Merge — tri-merge, all three bureaus",   // Credco's own product name
      purpose: loanFile.product || null,
      borrowers,
      ready: ready.ready,
      missing: ready.missing,
      // Presence + last4 only. The full PAN comes from the card-auth reveal, which logs it.
      card: card ? publicCardView(card as CardAuth) : null,
      cardOnFile: !!card,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

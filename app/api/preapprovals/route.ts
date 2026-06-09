// Issue + list mortgage pre-approval letters. Generates a unique letter number
// and an unguessable share token (the borrower/agent letter link).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { BRAND } from "@/lib/brand";
import { buildPreApprovalPdf } from "@/lib/preapprovalPdf";
import { sendPreapprovalEmails } from "@/lib/notify/sendPreapproval";

const validEmail = (e: any) => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

export const dynamic = "force-dynamic";

const token = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "")
    : Math.random().toString(16).slice(2)).slice(0, 28);

function letterNo() {
  const d = new Date();
  return `PA-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}-${Math.floor(1000 + Math.random() * 9000)}`;
}

export async function GET() {
  const { data } = await supabaseAdmin
    .from("preapprovals").select("*").order("created_at", { ascending: false }).limit(200);
  return NextResponse.json({ preapprovals: data || [] });
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.borrower_name || !String(b.borrower_name).trim()) {
      return NextResponse.json({ error: "Borrower name is required." }, { status: 400 });
    }
    const num = (v: any) => (v === "" || v == null ? null : Number(String(v).replace(/[^0-9.]/g, "")));
    const purchase = num(b.purchase_price);
    const down = num(b.down_payment);
    let loan = num(b.loan_amount);
    if (!loan && purchase != null) loan = purchase - (down || 0);

    // Default expiry: 60 days out if not provided.
    const expires = b.expires_on || new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

    const row = {
      letter_number: letterNo(),
      share_token: token(),
      lead_id: b.lead_id || null,
      loan_file_id: b.loan_file_id || null,
      borrower_name: String(b.borrower_name).trim(),
      co_borrower: b.co_borrower ? String(b.co_borrower).trim() : null,
      loan_type: b.loan_type || null,
      purchase_price: purchase,
      loan_amount: loan,
      down_payment: down,
      interest_rate: b.interest_rate ? String(b.interest_rate).trim() : null,
      term: b.term || null,
      property_address: b.property_address ? String(b.property_address).trim() : null,
      occupancy: b.occupancy || null,
      conditions: b.conditions ? String(b.conditions).trim() : null,
      officer_name: b.officer_name ? String(b.officer_name).trim() : null,
      officer_nmls: b.officer_nmls ? String(b.officer_nmls).trim() : BRAND.nmls,
      status: "issued",
      expires_on: expires,
      // Both optional — only fill what the LO entered.
      borrower_email: validEmail(b.borrower_email) ? String(b.borrower_email).trim().toLowerCase() : null,
      agent_email: validEmail(b.agent_email) ? String(b.agent_email).trim().toLowerCase() : null,
    };
    const { data, error } = await supabaseAdmin.from("preapprovals").insert([row]).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Auto-email the PDF to whichever recipients were provided.
    let emailed: string[] = [];
    if (data.borrower_email || data.agent_email) {
      try {
        const pdf = await buildPreApprovalPdf(data);
        emailed = await sendPreapprovalEmails(data, pdf, { borrower_email: data.borrower_email, agent_email: data.agent_email });
        if (emailed.length) await supabaseAdmin.from("preapprovals").update({ emailed_to: emailed }).eq("id", data.id);
      } catch (e) { console.warn("[preapproval] email failed:", e); }
    }

    await logActivity({
      entity_type: "preapproval", entity_id: data.id, lead_id: data.lead_id, loan_file_id: data.loan_file_id,
      actor: "lo", action: "preapproval.issued",
      detail: { letter_number: data.letter_number, borrower: data.borrower_name, amount: loan, emailed },
    });
    return NextResponse.json({ preapproval: data, emailed }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

// Void / reinstate a letter.
export async function PATCH(req: NextRequest) {
  try {
    const { id, status } = await req.json();
    if (!id || !["issued", "void"].includes(status)) return NextResponse.json({ error: "id + valid status required" }, { status: 400 });
    const { data, error } = await supabaseAdmin.from("preapprovals").update({ status }).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ preapproval: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

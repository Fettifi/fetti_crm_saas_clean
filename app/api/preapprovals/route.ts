// Issue + list mortgage pre-approval letters. Generates a unique letter number
// and an unguessable share token (the borrower/agent letter link).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { BRAND } from "@/lib/brand";
import { buildPreApprovalPdf } from "@/lib/preapprovalPdf";
import { sendPreapprovalEmails } from "@/lib/notify/sendPreapproval";
import { setSetting } from "@/lib/settings";
import { PA_LETTER_KEYS, PA_INTERNAL_KEYS } from "@/lib/preapprovalFields";

// Term-sheet fields the preapprovals table has no column for, persisted in app_settings keyed by
// letter id. TWO keys, deliberately:
//
//   PA_TERMS:<id>     — printed on the letter. The PUBLIC pdf and letter routes read this.
//   PA_INTERNAL:<id>  — captured for Ramon, never printed, and no public route reads it.
//
// The split is the control, not the toggle. Everything in PA_TERMS is public by construction —
// app/api/letter/[token]/pdf/route.ts dereferences it for anyone holding the share link — so
// broker compensation, the wholesale lender's name, the borrower's FICO and DTI must not be in
// there at all. A per-field "show on letter" checkbox that writes into the same blob would put
// one boolean between a listing agent and the buyer's credit score.
//
// as_is_value stays letter-side: the LETTER measures LTV on the SAME basis as the Scenario Desk
// (lesser of as-is and price on a purchase), and without it the letter printed a different ratio
// than the desk that produced it.
const EXTRA_KEYS = PA_LETTER_KEYS;

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
    //
    // AND IT MUST NOT ALREADY BE PAST. The extractor used to map a rate-lock expiration into this
    // field, so a three-week-old term sheet issued a letter that was dead on arrival: the row
    // inserted, the PDF built, the emails went out, 201 came back with an "Open letter" button —
    // and that button, the copy link and the PDF download all 410'd. The borrower and the agent
    // already had the dead link. A past date now falls back to the default and says so.
    let expires = b.expires_on || new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    let expiryWarning: string | null = null;
    if (b.expires_on && new Date(`${b.expires_on}T23:59:59-07:00`) < new Date()) {
      expiryWarning = `The expiry on the term sheet (${b.expires_on}) has already passed — the letter was issued valid for 60 days instead.`;
      expires = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    }

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
    // The 80-char cap was applied HERE as well as in the extractor, with no ellipsis — so a real
    // prepay clause ("…1% in year 5; waived on sale to an unrelated third party") stored cut
    // mid-word with the borrower-favourable half deleted, and printed as a complete term.
    const CAP = 600;
    const take = (keys: string[]) => {
      const out: Record<string, unknown> = {};
      if (!b.extra_terms || typeof b.extra_terms !== "object") return out;
      for (const k of keys) {
        const v = b.extra_terms[k];
        if (v == null || String(v).trim() === "") continue;   // "" is absent; 0 and false are NOT
        if (k === "other_terms" && Array.isArray(v)) { out[k] = v.slice(0, 40); continue; }
        const t = String(v).trim();
        out[k] = t.length > CAP ? t.slice(0, CAP - 1) + "\u2026" : t;
      }
      return out;
    };
    // Ramon's per-letter choice, not a fixed list: whatever he ticked OFF stays behind. Anything
    // hidden goes to the internal key that no public route reads, so hiding is a real control and
    // not just a rendering flag on data that is already publicly served.
    const hidden: string[] = Array.isArray(b.hidden_fields) ? b.hidden_fields.map(String) : [];
    const hide = new Set(hidden);
    const letterKeys = [...EXTRA_KEYS, ...PA_INTERNAL_KEYS, "other_terms"].filter((k) => !hide.has(k));
    const extra = take(letterKeys) as Record<string, string>;
    if (hidden.length) (extra as any).__hidden = hidden as any;
    const internal = take([...PA_INTERNAL_KEYS, ...EXTRA_KEYS].filter((k) => hide.has(k)));

    const { data, error } = await supabaseAdmin.from("preapprovals").insert([row]).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // A LOST WRITE HERE PRODUCES TWO DIFFERENT LETTERS UNDER ONE LETTER NUMBER.
    // setSetting returns false on failure precisely so a caller can notice; this ignored it and
    // the catch only warned. The emailed PDF is built from the in-memory `extra` below, so the
    // attachment was complete while every later download — and the web letter — silently lost
    // every term. 201 and "✅ Letter issued" either way. Now it is reported.
    let termsWarning: string | null = null;
    if (Object.keys(extra).length) {
      let ok = false;
      try { ok = await setSetting(`PA_TERMS:${data.id}`, JSON.stringify(extra)); }
      catch (e) { console.warn("[preapproval] terms persist failed:", e); }
      if (!ok) termsWarning = "The letter was issued, but the additional loan terms could not be saved — the emailed PDF has them, later downloads will not. Re-issue this letter.";
    }
    if (Object.keys(internal).length) {
      try { await setSetting(`PA_INTERNAL:${data.id}`, JSON.stringify(internal)); }
      catch (e) { console.warn("[preapproval] internal terms persist failed:", e); }
    }

    // Auto-email the PDF to whichever recipients were provided.
    let emailed: string[] = [];
    if (data.borrower_email || data.agent_email) {
      try {
        const pdf = await buildPreApprovalPdf(data, extra);
        emailed = await sendPreapprovalEmails(data, pdf, { borrower_email: data.borrower_email, agent_email: data.agent_email });
        if (emailed.length) await supabaseAdmin.from("preapprovals").update({ emailed_to: emailed }).eq("id", data.id);
      } catch (e) { console.warn("[preapproval] email failed:", e); }
    }

    await logActivity({
      entity_type: "preapproval", entity_id: data.id, lead_id: data.lead_id, loan_file_id: data.loan_file_id,
      actor: "lo", action: "preapproval.issued",
      detail: { letter_number: data.letter_number, borrower: data.borrower_name, amount: loan, emailed },
    });
    const warnings = [expiryWarning, termsWarning].filter(Boolean);
    return NextResponse.json({ preapproval: data, emailed, warnings }, { status: 201 });
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

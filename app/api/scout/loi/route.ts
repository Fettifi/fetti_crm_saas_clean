// Deal Scout → Letter of Intent. Builds the branded LOI PDF and, per `mode`:
//   download — returns the PDF bytes (preview before anything leaves the building)
//   email    — emails the seller the PDF (Resend attachment, reply-to frank@)
//   esign    — creates a built-in e-sign envelope (seller signs at /sign/<token>)
//              and emails the seller BOTH the attached PDF and the signing link.
// Every path stamps the deal's timeline; nothing sends without an explicit click.
import { NextRequest, NextResponse } from "next/server";
import { getDeal, saveDeal, type ScoutLoi } from "@/lib/scoutStore";
import { buildScoutLoiPdf, SELLER_SIGN_FIELDS } from "@/lib/scoutLoiPdf";
import { senderFrom } from "@/lib/notify/mailFrom";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import {
  ESIGN_BUCKET, newToken, saveRequest, saveRecipientPointer,
  type EsignRequest, type Recipient,
} from "@/lib/esign";
import { cfg } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";

async function emailLoi(to: string, subject: string, html: string, pdf: Uint8Array, filename: string): Promise<{ ok: boolean; id?: string; detail: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = senderFrom();
  if (!key || !from) return { ok: false, detail: "resend not configured" };
  const replyTo = ((await cfg("REPLY_TO_EMAIL")) || "frank@fettifi.com").trim();
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [to], subject, reply_to: [replyTo],
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#0f172a">${html}</div>`,
        attachments: [{ filename, content: Buffer.from(pdf).toString("base64") }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j?.id) return { ok: true, id: String(j.id), detail: "sent" };
    return { ok: false, detail: j?.message || `HTTP ${res.status}` };
  } catch (e) { return { ok: false, detail: e instanceof Error ? e.message : "error" }; }
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const id = String(body?.id || "");
  const mode = ["download", "email", "esign"].includes(body?.mode) ? body.mode : "download";
  const deal = id ? await getDeal(id) : null;
  if (!deal) return NextResponse.json({ error: "deal not found" }, { status: 404 });
  if (deal.optout) return NextResponse.json({ error: "seller opted out — no contact" }, { status: 409 });

  const offer = Number(body?.offer_price) || 0;
  if (offer <= 0) return NextResponse.json({ error: "offer_price required" }, { status: 400 });
  const loi: ScoutLoi = {
    offer_price: offer,
    earnest: Number(body?.earnest) || null,
    close_days: Number(body?.close_days) || null,
    inspection_days: Number(body?.inspection_days) || null,
    financing: typeof body?.financing === "string" && body.financing.trim() ? body.financing.trim().slice(0, 200) : null,
    valid_days: Number(body?.valid_days) || 7,
  };

  const pdf = await buildScoutLoiPdf(deal, loi);
  const filename = `LOI-${deal.id.slice(0, 40)}.pdf`;

  if (mode === "download") {
    return new NextResponse(Buffer.from(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"` },
    });
  }

  // email / esign both need a seller email.
  if (!deal.seller_email) {
    return NextResponse.json({ error: "no seller email on file — add one to the deal first (download mode still works)" }, { status: 400 });
  }

  const sellerName = (deal.seller_name && !/property owner/i.test(deal.seller_name)) ? deal.seller_name : "Property Owner";
  const addr = [deal.address, deal.city].filter(Boolean).join(", ");
  let signLink: string | null = null;
  let envelopeToken: string | null = null;

  if (mode === "esign") {
    // Create the built-in e-sign envelope: upload source PDF, one seller
    // recipient, signature + date fields at the printed signature block.
    envelopeToken = newToken();
    const up = await supabaseAdmin.storage
      .from(ESIGN_BUCKET)
      .upload(`esign/${envelopeToken}/source.pdf`, Buffer.from(pdf), { contentType: "application/pdf", upsert: true });
    if (up.error) return NextResponse.json({ error: `e-sign upload failed: ${up.error.message}` }, { status: 500 });

    const recipient: Recipient = {
      id: "seller", name: sellerName, email: deal.seller_email, phone: deal.seller_phone || null,
      order: 1, token: newToken(), status: "sent",
    };
    const now = new Date().toISOString();
    const env: EsignRequest = {
      token: envelopeToken,
      title: `Letter of Intent — ${addr}`,
      lead_id: null, loan_file_id: null,
      signer_name: recipient.name, signer_email: recipient.email, signer_phone: recipient.phone,
      recipients: [recipient],
      source_path: `esign/${envelopeToken}/source.pdf`,
      fields: [
        { type: "signature", recipientId: "seller", ...SELLER_SIGN_FIELDS.signature },
        { type: "date", recipientId: "seller", ...SELLER_SIGN_FIELDS.date },
      ],
      status: "sent",
      events: [{ type: "created", at: now, detail: "scout LOI" }],
      created_by: "scout",
      created_at: now, updated_at: now,
    };
    await saveRequest(env);
    await saveRecipientPointer(recipient.token, envelopeToken, recipient.id);
    signLink = `${APP_URL}/sign/${recipient.token}`;
  }

  const subject = `Offer for ${addr} — letter of intent attached`;
  const html =
    `Hi ${sellerName.split(/\s+/)[0]},<br><br>` +
    `Thank you for the conversation about <b>${addr}</b>. As promised, my offer is attached as a formal letter of intent — ` +
    `<b>$${Math.round(loi.offer_price).toLocaleString()}</b>${loi.close_days ? `, closing within ${loi.close_days} days of a signed agreement` : ""}.<br><br>` +
    (signLink
      ? `If the terms work for you, you can review and sign it right from your phone — no printing, no scanning:<br><br>` +
        `<a href="${signLink}" style="display:inline-block;background:#047857;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Review &amp; sign the offer</a><br><br>`
      : `If the terms work for you, sign the attached letter and send it back — or reply here and we'll finalize together.<br><br>`) +
    `Questions or want to adjust something? Just reply — this comes straight to me. The letter of intent is non-binding; ` +
    `it simply locks our starting terms so I can send the purchase agreement.<br><br>` +
    `Ramon Dent<br>Fetti Capital`;

  const sent = await emailLoi(deal.seller_email, subject, html, pdf, filename);

  // Stamp the deal.
  const now = new Date().toISOString();
  deal.loi = { ...loi, sent_at: sent.ok ? now : null, sign_link: signLink, esign_token: envelopeToken };
  deal.events = [...(deal.events || []), {
    at: now,
    kind: sent.ok ? "loi_sent" : "loi_send_failed",
    detail: `$${Math.round(loi.offer_price).toLocaleString()} via ${mode}${sent.ok ? "" : ` — ${sent.detail}`}`,
  }];
  if (sent.ok && !["under_contract"].includes(deal.status)) deal.status = "loi_sent";
  const saved = await saveDeal(deal);

  return NextResponse.json({ sent: sent.ok, detail: sent.detail, signLink, deal: saved });
}

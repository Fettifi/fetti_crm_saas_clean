// SEND A DOCUMENT TO COMPLETE: the LO uploads a blank form/template (Excel PFS,
// REO schedule, budget worksheet, questionnaire…) and it's EMAILED to the borrower
// as an attachment with instructions to complete it and return it through the
// file's secure upload link. The template is stored on the file (loan_documents,
// status "requested") so the checklist tracks that it's outstanding, and the send
// is logged to the Conversations inbox. Auth-gated by the /api/los matcher.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { logComms } from "@/lib/comms";
import { markSignatureLite } from "@/lib/notify/emailSignature";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "loan-docs";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const MAX_BYTES = 15 * 1024 * 1024; // Resend attachment ceiling is 40MB total; keep sane
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.LEAD_RESPONSE_FROM_EMAIL;
    if (!key || !from) return NextResponse.json({ error: "Email isn't configured (RESEND_API_KEY / LEAD_RESPONSE_FROM_EMAIL)." }, { status: 503 });

    const form = await req.formData();
    const f = form.get("file");
    if (!(f instanceof Blob) || !f.size) return NextResponse.json({ error: "Attach the document to send." }, { status: 400 });
    if (f.size > MAX_BYTES) return NextResponse.json({ error: "File too large — keep it under 15 MB." }, { status: 413 });
    const note = String(form.get("note") || "").trim();
    const toEmail = String(form.get("to_email") || "").trim().toLowerCase();
    const toName = String(form.get("to_name") || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toEmail)) return NextResponse.json({ error: "A valid recipient email is required." }, { status: 400 });

    const { data: lf } = await supabaseAdmin
      .from("loan_files").select("id, file_number, share_token, lead_id, borrower_name")
      .eq("id", id).maybeSingle();
    if (!lf) return NextResponse.json({ error: "Loan file not found." }, { status: 404 });

    const fileName = ((f as any).name || "document").replace(/[^\w.\- ()]/g, "_").slice(0, 120);
    const bytes = Buffer.from(await f.arrayBuffer());

    // 1) Keep the blank template ON the file (audit + re-send later), and put the
    //    completed-version expectation on the checklist so it's tracked as missing.
    const storagePath = `${id}/sent-to-complete/${Date.now()}-${fileName}`;
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET)
      .upload(storagePath, bytes, { contentType: (f as any).type || "application/octet-stream", upsert: false });
    if (upErr) return NextResponse.json({ error: "Couldn't store the document: " + upErr.message }, { status: 500 });
    const docTitle = `Completed: ${fileName.replace(/\.[^.]+$/, "")}`;
    await supabaseAdmin.from("loan_documents").insert([{
      loan_file_id: id, name: docTitle, category: "borrower-to-complete",
      required: true, status: "requested", storage_path: storagePath, file_name: fileName,
      size_bytes: f.size, uploaded_by: "lo",
      notes: `Blank form emailed to ${toEmail}${note ? ` — "${note.slice(0, 140)}"` : ""}`,
    }]);

    // 2) Email the borrower: attachment + how to return it (their secure link).
    const first = (toName || lf.borrower_name || "there").split(/\s+/)[0];
    const link = lf.share_token ? `${APP_URL}/file/${lf.share_token}` : null;
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#0f172a;max-width:560px">
      <p>Hi ${esc(first)},</p>
      <p>Attached is <b>${esc(fileName)}</b> for your loan file${lf.file_number ? ` (${esc(lf.file_number)})` : ""}. Please fill it out and send it back — it's one of the items we need to keep your file moving.</p>
      ${note ? `<p>${esc(note).replace(/\n/g, "<br>")}</p>` : ""}
      ${link
        ? `<p><b>Returning it is easy:</b> when it's done, upload it here on your secure file page — it lands directly in your file:<br><a href="${link}" style="color:#0c7a52;font-weight:600">${link}</a></p>`
        : `<p>When it's done, just reply to this email with the completed file attached.</p>`}
      <p>Stuck on any field? Reply here and I'll walk you through it.</p>
    </div>${await markSignatureLite()}`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [toEmail],
        reply_to: ["frank@fettifi.com"],
        subject: `Please complete: ${fileName}${lf.file_number ? ` — file ${lf.file_number}` : ""}`,
        html,
        attachments: [{ filename: fileName, content: bytes.toString("base64") }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    const j = await res.json().catch(() => ({} as any));
    if (!res.ok) return NextResponse.json({ error: j?.message || `Email failed (${res.status})` }, { status: 502 });

    // 3) Paper trail: conversation thread + activity log.
    if (lf.lead_id) {
      await logComms({
        leadId: lf.lead_id, channel: "email", direction: "outbound", type: "doc_to_complete",
        body: `Sent "${fileName}" to complete${note ? ` — ${note}` : ""}${link ? ` (return via ${link})` : ""}`,
        to: toEmail, providerId: j?.id,
      }).catch(() => {});
    }
    await logActivity({
      entity_type: "loan_file", entity_id: id, lead_id: lf.lead_id || undefined, actor: "lo",
      action: "doc.sent_to_complete", detail: { file: fileName, to: toEmail, note: note || undefined },
    });

    return NextResponse.json({ ok: true, sent: "email", doc: docTitle });
  } catch (e: any) {
    console.error("[los/send-doc]", e?.message || e);
    return NextResponse.json({ error: "Send failed — try again." }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { compressPdfIfNeeded } from "@/lib/pdfCompress";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { sendSignRequest } from "@/lib/notify/docRequest";
import { EsignField, EsignRequest, Recipient, ESIGN_BUCKET, newToken, saveRequest, saveRecipientPointer, listRequests } from "@/lib/esign";

// E-signature envelopes (sender side). Auth-gated via the /api/esign/requests matcher.
//   GET  ?file=<loanFileId>  -> list envelopes (optionally for one file)
//   POST multipart: pdf (File) + title, loan_file_id?, recipients(JSON), fields(JSON)
//        recipients: [{ id, name, email?, phone?, order }]  (signing order)
//        fields: [{ type,page,xPct,yPct,wPct,hPct, recipientId }]
//   Back-compat: signer_name/email/phone build a single recipient if no recipients[].
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BYTES = 40 * 1024 * 1024;  // pre-compression intake ceiling
export const maxDuration = 120;      // big-PDF compression needs headroom

export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get("file");
  let reqs = await listRequests();
  if (file) reqs = reqs.filter((r) => r.loan_file_id === file);
  const items = reqs.map((r) => ({
    token: r.token, title: r.title, signer_name: r.signer_name, status: r.status,
    loan_file_id: r.loan_file_id, created_at: r.created_at,
    recipients: (r.recipients || []).map((x) => ({ name: x.name, email: x.email || null, order: x.order, status: x.status, delivery: x.delivery || null })),
    has_signed: !!r.signed_path,
    has_cert: !!r.cert_path,
  }));
  return NextResponse.json({ requests: items });
}

export async function POST(req: NextRequest) {
  try {
    // TWO intake modes:
    //  A) JSON { source_path } — the PDF was already PUT straight to storage via
    //     /api/esign/requests/upload-url. Vercel rejects request bodies over ~4.5MB
    //     BEFORE this function runs, so inlining a normal scanned PDF died with a raw
    //     platform error ("Connection error." in the UI). Direct-to-storage has no cap.
    //  B) legacy multipart with the PDF inline (small files / API callers).
    const ctype = req.headers.get("content-type") || "";
    const jsonBody: any = ctype.includes("application/json") ? await req.json().catch(() => null) : null;
    const form = jsonBody ? null : await req.formData().catch(() => null);

    let buf: Buffer;
    let uploadedPath: string | null = null;
    let pdfName = "document.pdf";
    if (jsonBody?.source_path) {
      const sp = String(jsonBody.source_path);
      if (!/^esign\/uploads\/[A-Za-z0-9_-]+\.pdf$/.test(sp)) return NextResponse.json({ error: "Bad upload path." }, { status: 400 });
      const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(ESIGN_BUCKET).download(sp);
      if (dlErr || !blob) return NextResponse.json({ error: "Uploaded PDF not found — please try again." }, { status: 404 });
      buf = Buffer.from(await blob.arrayBuffer());
      uploadedPath = sp;
      pdfName = String(jsonBody.pdf_name || pdfName);
    } else {
      const pdf = form?.get("pdf") as File | null;
      if (!pdf || typeof pdf === "string") return NextResponse.json({ error: "Attach a PDF as field 'pdf'." }, { status: 400 });
      buf = Buffer.from(await pdf.arrayBuffer());
      pdfName = pdf.name || pdfName;
    }
    if (buf.length > MAX_BYTES) return NextResponse.json({ error: "PDF too large (max 40 MB) — split it and send in parts." }, { status: 413 });
    if (buf.subarray(0, 5).toString("latin1").indexOf("%PDF") !== 0) return NextResponse.json({ error: "That file isn't a PDF." }, { status: 422 });
    // AUTO-COMPRESS oversized PDFs (page-faithful 180/150-DPI re-render; smaller
    // files pass through untouched) so a heavy scan never fails on size again.
    let compressNote: string | null = null;
    if (buf.length > 8 * 1024 * 1024) {
      try {
        const c = await compressPdfIfNeeded(buf, { targetBytes: 8 * 1024 * 1024, hardMaxBytes: 15 * 1024 * 1024 });
        if (c.compressed) { buf = c.buf; compressNote = c.note || null; }
      } catch (e: any) {
        return NextResponse.json({ error: e?.message || "Couldn't compress that PDF — try splitting it." }, { status: 422 });
      }
    }

    const gv = (k: string) => (jsonBody ? jsonBody[k] : form?.get(k));
    const title = String(gv("title") || pdfName || "Document for signature").slice(0, 160);
    const loan_file_id = (String(gv("loan_file_id") || "").trim() || null);

    // Recipients (multi-signer with order) — or one from the legacy fields.
    let raw: any[] = [];
    try { const rv = gv("recipients"); const r = typeof rv === "object" && rv ? rv : JSON.parse(String(rv || "[]")); if (Array.isArray(r)) raw = r; } catch { /* */ }
    if (!raw.length) {
      const n = String(gv("signer_name") || "").trim();
      if (n) raw = [{ id: "r1", name: n, email: String(gv("signer_email") || "").trim() || null, phone: String(gv("signer_phone") || "").trim() || null, order: 1 }];
    }
    raw = raw.filter((r) => r && String(r.name || "").trim());
    if (!raw.length) return NextResponse.json({ error: "Add at least one signer (name + email or phone)." }, { status: 400 });
    for (const r of raw) if (!String(r.email || "").trim() && !String(r.phone || "").trim()) return NextResponse.json({ error: `Add an email or phone for ${r.name}.` }, { status: 400 });
    // Validate email FORMAT so a malformed address is rejected at the source (caught
    // immediately, not after a silent bounce). Syntactically-valid-but-wrong addresses
    // are caught by the sender's confirm-recipients step + the Resend bounce webhook.
    const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
    for (const r of raw) { const e = String(r.email || "").trim(); if (e && !isEmail(e)) return NextResponse.json({ error: `That email for ${r.name || "a signer"} isn't a valid address: "${e}". Please correct it and resend.` }, { status: 400 }); }

    const envToken = newToken();
    const source_path = `esign/${envToken}/source.pdf`;
    if (uploadedPath && !compressNote) {
      // Already in the bucket, unchanged — move it into the envelope's canonical location.
      const { error: mvErr } = await supabaseAdmin.storage.from(ESIGN_BUCKET).move(uploadedPath, source_path);
      if (mvErr) throw new Error("Upload move failed: " + mvErr.message);
    } else {
      const { error: upErr } = await supabaseAdmin.storage.from(ESIGN_BUCKET).upload(source_path, buf, { contentType: "application/pdf", upsert: false });
      if (upErr) throw new Error("Upload failed: " + upErr.message);
      if (uploadedPath) { try { await supabaseAdmin.storage.from(ESIGN_BUCKET).remove([uploadedPath]); } catch { /* orphan cleanup is best-effort */ } }
    }

    let lead_id: string | null = null;
    if (loan_file_id) {
      const { data: lf } = await supabaseAdmin.from("loan_files").select("lead_id").eq("id", loan_file_id).maybeSingle();
      lead_id = lf?.lead_id || null;
    }

    const recipients: Recipient[] = raw
      .map((r, i) => ({
        id: String(r.id || `r${i + 1}`),
        name: String(r.name).trim(),
        email: (String(r.email || "").trim() || null),
        phone: (String(r.phone || "").trim() || null),
        order: Number(r.order) || (i + 1),
        token: newToken(),
        status: "pending" as const,
      }))
      .sort((a, b) => a.order - b.order);

    let fields: EsignField[] = [];
    try { const fv = gv("fields"); const f = typeof fv === "object" && fv ? fv : JSON.parse(String(fv || "[]")); if (Array.isArray(f)) fields = f; } catch { /* */ }
    // default field if none placed → assign to first recipient
    if (!fields.length) fields = [
      { type: "signature", page: 1, xPct: 0.58, yPct: 0.85, wPct: 0.24, hPct: 0.06, recipientId: recipients[0].id },
      { type: "date", page: 1, xPct: 0.12, yPct: 0.865, wPct: 0.16, hPct: 0.032, recipientId: recipients[0].id },
    ];
    // any unassigned field defaults to the first recipient
    fields = fields.map((f) => ({ ...f, recipientId: f.recipientId || recipients[0].id }));

    const now = new Date().toISOString();
    const env: EsignRequest = {
      token: envToken, title, loan_file_id, lead_id,
      signer_name: recipients[0].name, signer_email: recipients[0].email, signer_phone: recipients[0].phone,
      recipients, source_path, signed_path: null, fields, status: "sent",
      events: [{ type: "created", at: now, detail: `Created with ${recipients.length} signer(s)` }],
      created_by: "lo", created_at: now, updated_at: now,
    };

    // pointers for every recipient link
    for (const r of recipients) await saveRecipientPointer(r.token, envToken, r.id);

    // Route to the FIRST signer only (sequential).
    const origin = req.nextUrl.origin;
    const first = recipients[0];
    first.status = "sent";
    const { sent } = await sendSignRequest({ to_name: first.name, to_email: first.email, to_phone: first.phone, link: `${origin}/sign/${first.token}`, title });
    if (sent.includes("email")) first.delivery = "sent"; // pending delivery confirmation; the Resend webhook flips to delivered/bounced
    env.events!.push({ type: "sent", at: new Date().toISOString(), detail: sent.length ? `Sent to ${first.name} via ${sent.join(" + ")}` : `Link created for ${first.name} (manual delivery)` });
    await saveRequest(env);

    if (loan_file_id) {
      await logActivity({ entity_type: "loan_file", entity_id: loan_file_id, loan_file_id, lead_id, actor: "lo", action: "esign.sent", detail: { title, signers: recipients.map((r) => r.name), channels: sent } });
    }

    return NextResponse.json({
      ok: true, token: envToken,
      links: recipients.map((r) => ({ name: r.name, order: r.order, link: `${origin}/sign/${r.token}` })),
      sent,
      message: (sent.length ? `Sent to ${first.name} via ${sent.join(" + ")}.` : "Created — copy the first signer's link to send manually.") + (compressNote ? ` (${compressNote})` : ""),
    });
  } catch (e: any) {
    console.error("[esign/requests] error:", e);
    return NextResponse.json({ error: e?.message || "Failed to create envelope." }, { status: 500 });
  }
}

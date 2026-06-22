import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { maybeAdvanceStage } from "@/lib/los";
import { sendSignRequest } from "@/lib/notify/docRequest";
import { ESIGN_BUCKET, EsignField, EsignRequest, activeRecipient, envelopeComplete, getByRecipientToken, recipientView, saveRequest } from "@/lib/esign";

// Public signer endpoint — [token] is a RECIPIENT token.
//   GET  -> this recipient's view (marks "viewed" when it's their turn)
//   POST { signatureDataUrl, typedName, consent } -> stamp THIS recipient's
//         fields, route to the next signer, or complete + Certificate of Completion.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string {
  const xf = req.headers.get("x-forwarded-for");
  return (xf ? xf.split(",")[0].trim() : "") || req.headers.get("x-real-ip") || "unknown";
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await getByRecipientToken(token);
  if (!res) return NextResponse.json({ error: "This signing link is invalid or has expired." }, { status: 404 });
  const { env, recipient } = res;
  const active = activeRecipient(env);
  if (active?.id === recipient.id && (recipient.status === "sent" || recipient.status === "pending")) {
    const ip = clientIp(req); const ua = (req.headers.get("user-agent") || "").slice(0, 180);
    recipient.status = "viewed"; recipient.viewedAt = new Date().toISOString();
    env.events = [...(env.events || []), { type: "viewed", at: recipient.viewedAt, ip, ua, detail: `${recipient.name} opened the document` }];
    await saveRequest(env);
  }
  return NextResponse.json(recipientView(env, recipient));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const res = await getByRecipientToken(token);
    if (!res) return NextResponse.json({ error: "Invalid or expired signing link." }, { status: 404 });
    const { env, recipient } = res;
    if (env.status === "voided") return NextResponse.json({ error: "This envelope was voided by the sender." }, { status: 409 });
    if (env.status === "declined") return NextResponse.json({ error: "This envelope was declined." }, { status: 409 });
    if (recipient.status === "signed") return NextResponse.json({ error: "You already signed this document." }, { status: 409 });
    if (activeRecipient(env)?.id !== recipient.id) {
      const a = activeRecipient(env);
      return NextResponse.json({ error: a ? `It's not your turn yet — waiting on ${a.name}.` : "This envelope is no longer active." }, { status: 409 });
    }

    const body = await req.json().catch(() => ({}));
    const consent = body?.consent === true;
    const typedName = String(body?.typedName || recipient.name || "").trim();
    const sigData = String(body?.signatureDataUrl || "");
    if (!consent) return NextResponse.json({ error: "You must agree to sign electronically." }, { status: 400 });
    if (!/^data:image\/png;base64,/.test(sigData)) return NextResponse.json({ error: "A signature is required." }, { status: 400 });

    const ip = clientIp(req);
    const ua = (req.headers.get("user-agent") || "").slice(0, 180);
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

    // Stamp onto the accumulating PDF (signed copy if a prior signer already signed).
    const workingPath = env.signed_path || env.source_path;
    const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(ESIGN_BUCKET).download(workingPath);
    if (dlErr || !blob) throw new Error("Could not load the document.");
    const pdf = await PDFDocument.load(await blob.arrayBuffer());
    const sigImg = await pdf.embedPng(Buffer.from(sigData.split(",")[1], "base64"));
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const pages = pdf.getPages();
    const mine = (env.fields || []).filter((f: EsignField) => (f.recipientId || env.recipients[0]?.id) === recipient.id);
    for (const f of mine) {
      const pg = pages[Math.min(Math.max((f.page || 1) - 1, 0), pages.length - 1)];
      const { width: pw, height: ph } = pg.getSize();
      const bw = (f.wPct || 0.2) * pw, bh = (f.hPct || 0.04) * ph;
      const x = (f.xPct || 0) * pw;
      const yBottom = ph - (f.yPct || 0) * ph - bh;
      if (f.type === "signature" || f.type === "initials") {
        const d = sigImg.scaleToFit(bw, bh);
        pg.drawImage(sigImg, { x: x + (bw - d.width) / 2, y: yBottom + (bh - d.height) / 2, width: d.width, height: d.height });
      } else {
        const text = f.type === "date" ? dateStr : typedName;
        const size = Math.max(7, Math.min(bh * 0.8, 13));
        pg.drawText(text, { x: x + 1, y: yBottom + (bh - size) / 2, size, font: helv, color: rgb(0.05, 0.05, 0.1) });
      }
    }
    const updated = await pdf.save();
    const signed_path = `esign/${env.token}/signed.pdf`;
    await supabaseAdmin.storage.from(ESIGN_BUCKET).upload(signed_path, Buffer.from(updated), { contentType: "application/pdf", upsert: true });
    env.signed_path = signed_path;

    recipient.status = "signed"; recipient.signedAt = now.toISOString(); recipient.ip = ip; recipient.ua = ua; recipient.typedName = typedName;
    env.events = [...(env.events || []), { type: "signed", at: now.toISOString(), ip, ua, detail: `Signed by ${recipient.name}` }];

    const next = activeRecipient(env);
    const origin = req.nextUrl.origin;
    if (next) {
      // Route to the next signer.
      next.status = "sent";
      env.status = "in_progress";
      await saveRequest(env);
      try {
        await sendSignRequest({ to_name: next.name, to_email: next.email, to_phone: next.phone, link: `${origin}/sign/${next.token}`, title: env.title });
        env.events.push({ type: "routed", at: new Date().toISOString(), detail: `Routed to next signer: ${next.name}` });
        await saveRequest(env);
      } catch { /* */ }
      return NextResponse.json({ ok: true, signed: true, completed: false, next: next.name });
    }

    // Everyone signed → complete + Certificate of Completion.
    const finalHash = crypto.createHash("sha256").update(updated).digest("hex");
    env.status = "completed";
    env.signed_hash = finalHash;
    const certBytes = await buildCertificate(env, finalHash);
    const cert_path = `esign/${env.token}/certificate.pdf`;
    await supabaseAdmin.storage.from(ESIGN_BUCKET).upload(cert_path, Buffer.from(certBytes), { contentType: "application/pdf", upsert: true });
    env.cert_path = cert_path;
    env.events.push({ type: "completed", at: new Date().toISOString(), detail: "All signers completed" });
    await saveRequest(env);

    if (env.loan_file_id) {
      await supabaseAdmin.from("loan_documents").insert([
        { loan_file_id: env.loan_file_id, name: `Signed: ${env.title}`, category: "Signed", required: false, status: "accepted", uploaded_by: "borrower", storage_path: signed_path, file_name: `${env.title}.pdf` },
        { loan_file_id: env.loan_file_id, name: `Certificate of Completion: ${env.title}`, category: "Signed", required: false, status: "accepted", uploaded_by: "system", storage_path: cert_path, file_name: `${env.title}-certificate.pdf` },
      ]);
      await logActivity({ entity_type: "loan_file", entity_id: env.loan_file_id, loan_file_id: env.loan_file_id, lead_id: env.lead_id || undefined, actor: "borrower", action: "esign.completed", detail: { title: env.title, signers: env.recipients.map((r) => r.name), hash: finalHash.slice(0, 16) } });
      try { await maybeAdvanceStage(env.loan_file_id); } catch { /* */ }
    }

    return NextResponse.json({ ok: true, signed: true, completed: true });
  } catch (e: any) {
    console.error("[esign/sign] error:", e);
    return NextResponse.json({ error: e?.message || "Signing failed." }, { status: 500 });
  }
}

async function buildCertificate(env: EsignRequest, signedHash: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.11, 0.15), muted = rgb(0.42, 0.45, 0.5), line = rgb(0.85, 0.87, 0.9);
  let y = 744;
  const T = (t: string, o: { b?: boolean; size?: number; color?: any; x?: number } = {}) => page.drawText(t, { x: o.x ?? 54, y, size: o.size || 10, font: o.b ? bold : helv, color: o.color || ink });
  const rule = () => page.drawLine({ start: { x: 54, y: y + 6 }, end: { x: 558, y: y + 6 }, thickness: 0.5, color: line });
  const fmt = (iso?: string) => { if (!iso) return "—"; try { return new Date(iso).toUTCString(); } catch { return iso; } };

  T("Certificate of Completion", { b: true, size: 18 }); y -= 14;
  T("Fetti Financial Services LLC · Electronic Signature Audit Trail", { size: 9, color: muted }); y -= 22; rule(); y -= 8;
  T("Document", { b: true }); T(env.title, { x: 170 }); y -= 16;
  T("Reference ID", { b: true }); T(env.token, { x: 170, size: 9, color: muted }); y -= 16;
  T("Status", { b: true }); T("Completed", { x: 170, color: rgb(0.05, 0.5, 0.3) }); y -= 16;
  y -= 6; rule(); y -= 14;

  T("Signers", { b: true, size: 12 }); y -= 18;
  for (const r of [...(env.recipients || [])].sort((a, b) => a.order - b.order)) {
    T(`${r.order}. ${r.name}`, { b: true, size: 10 }); T(r.status.toUpperCase(), { x: 470, size: 9, color: r.status === "signed" ? rgb(0.05, 0.5, 0.3) : muted }); y -= 12;
    if (r.email) { T(r.email, { x: 66, size: 8, color: muted }); y -= 11; }
    T(`Signed: ${fmt(r.signedAt)}${r.ip ? `  ·  IP ${r.ip}` : ""}`, { x: 66, size: 8, color: muted }); y -= 11;
    if (r.ua) { T(r.ua.slice(0, 80), { x: 66, size: 7, color: muted }); y -= 11; }
    y -= 4;
  }
  y -= 6; rule(); y -= 14;

  T("Event history", { b: true, size: 12 }); y -= 16;
  for (const ev of env.events || []) {
    T(`• ${ev.type.toUpperCase()}`, { b: true, size: 9 }); T(fmt(ev.at), { x: 170, size: 9 }); y -= 11;
    if (ev.detail) { T(ev.detail, { x: 66, size: 8, color: muted }); y -= 11; }
    if (y < 120) break;
  }
  y = Math.max(y, 96); rule(); y -= 14;
  const consent = "Consent: Each signer agreed to conduct this transaction electronically. Their electronic signatures are legally binding and equivalent to handwritten signatures under the U.S. ESIGN Act and applicable UETA.";
  let buf = ""; for (const w of consent.split(" ")) { if ((buf + " " + w).length > 100) { page.drawText(buf, { x: 54, y, size: 8, font: helv, color: muted }); y -= 11; buf = w; } else buf = buf ? buf + " " + w : w; }
  if (buf) { page.drawText(buf, { x: 54, y, size: 8, font: helv, color: muted }); y -= 14; }
  page.drawText(`Document integrity (SHA-256 of signed PDF): ${signedHash}`, { x: 54, y, size: 7, font: helv, color: muted });
  return doc.save();
}

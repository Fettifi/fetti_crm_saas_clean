// CERTIFICATE OF COMPLETION — ONE IMPLEMENTATION FOR BOTH WAYS AN ENVELOPE FINISHES.
//
// An envelope finishes either because every recipient signed (the sign route) or because the
// sender closed it with the signatures already collected (completeWithSignaturesCollected in
// lib/esign.ts). Two copies of this would drift, and the certificate is the one document whose
// wording has to be exactly right: it is the evidence of who signed and when.
//
// A sender-completed envelope must never read as though everyone signed. The status line says how
// many of how many; every recipient who did not sign prints NOT SIGNED with no signing line; the
// sender's note prints as the sender's (and only if they wrote one); and the consent paragraph
// speaks only for the people who actually signed. `certificateModel` is the text and
// `buildCertificate` only lays it out, so the wording is checked directly
// (scripts/verify-esign-complete-as-signed.ts) instead of by parsing a PDF.
import { PDFDocument, PDFFont, StandardFonts, rgb } from "pdf-lib";
import type { EsignRequest } from "@/lib/esign";

const CONSENT_ALL =
  "Consent: Each signer agreed to conduct this transaction electronically. Their electronic signatures are legally binding and equivalent to handwritten signatures under the U.S. ESIGN Act and applicable UETA.";
const CONSENT_PARTIAL =
  "Consent: Each recipient listed as SIGNED agreed to conduct this transaction electronically. Their electronic signatures are legally binding and equivalent to handwritten signatures under the U.S. ESIGN Act and applicable UETA. A recipient listed as NOT SIGNED gave no electronic signature in this envelope.";

export type CertTone = "ink" | "muted" | "ok" | "warn";
export type CertLine = { text: string; size: number; tone: CertTone };
export type CertSigner = { heading: string; label: string; signed: boolean; lines: CertLine[] };
export type CertModel = {
  title: string;
  reference: string;
  statusText: string;
  partial: boolean;
  note: string | null;
  signers: CertSigner[];
  events: { type: string; at: string; detail?: string }[];
  consent: string;
  integrity: string;
};

const fmt = (iso?: string) => { if (!iso) return "—"; try { return new Date(iso).toUTCString(); } catch { return iso; } };

export function certificateModel(env: EsignRequest, signedHash: string): CertModel {
  const recips = [...(env.recipients || [])].sort((a, b) => a.order - b.order);
  const closed = env.closed_by_sender || null;
  const signedCount = recips.filter((r) => r.status === "signed").length;

  const signers: CertSigner[] = recips.map((r) => {
    const signed = r.status === "signed";
    const lines: CertLine[] = [];
    if (r.email) lines.push({ text: r.email, size: 8, tone: "muted" });
    if (signed) {
      lines.push({ text: `Signed: ${fmt(r.signedAt)}${r.ip ? `  ·  IP ${r.ip}` : ""}`, size: 8, tone: "muted" });
      if (r.ua) lines.push({ text: r.ua.slice(0, 80), size: 7, tone: "muted" });
    } else {
      // "In this envelope" is all the system knows. Whether they signed some other copy elsewhere is
      // not something this certificate can see, so it never says they "did not sign".
      if (r.viewedAt) lines.push({ text: `Viewed: ${fmt(r.viewedAt)} (no signature in this envelope)`, size: 8, tone: "muted" });
      if (r.status === "declined") lines.push({ text: `Declined${r.declineReason ? `: ${r.declineReason}` : ""}`, size: 8, tone: "warn" });
      else if (closed) lines.push({ text: `No signature in this envelope. Marked not signed when the sender completed it on ${fmt(closed.at)}.`, size: 8, tone: "warn" });
    }
    const label = signed ? "SIGNED" : r.status === "not_signed" ? "NOT SIGNED" : r.status.toUpperCase();
    return { heading: `${r.order}. ${r.name}`, label, signed, lines };
  });

  return {
    title: env.title,
    reference: env.token,
    statusText: closed ? `Completed by sender — ${signedCount} of ${recips.length} signers signed` : "Completed",
    partial: !!closed,
    note: closed?.reason || null,
    signers,
    events: env.events || [],
    consent: closed ? CONSENT_PARTIAL : CONSENT_ALL,
    integrity: `Document integrity (SHA-256 of signed PDF): ${signedHash}`,
  };
}

/** Where an event's timestamp starts: the fixed column, or past the label when the label is longer
 *  ("• COMPLETED_BY_SENDER" in bold 9pt ends past x=170 and used to print over its own time). */
export function timestampX(labelWidth: number): number {
  return Math.max(170, 54 + labelWidth + 8);
}

// The standard fonts are WinAnsi. A curly quote pasted into the sender's note, or an emoji in a
// name, would otherwise throw inside drawText and take the whole certificate down with it. The
// stored envelope keeps the original text; only the printed glyph is substituted.
const WINANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split(""));
function winAnsi(s: string): string {
  return String(s ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .split("")
    .map((ch) => {
      const c = ch.charCodeAt(0);
      return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.has(ch) ? ch : "?";
    })
    .join("");
}

export async function buildCertificate(env: EsignRequest, signedHash: string): Promise<Uint8Array> {
  const m = certificateModel(env, signedHash);
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const tones: Record<CertTone, ReturnType<typeof rgb>> = {
    ink: rgb(0.09, 0.11, 0.15), muted: rgb(0.42, 0.45, 0.5), ok: rgb(0.05, 0.5, 0.3), warn: rgb(0.72, 0.42, 0.02),
  };
  const lineColor = rgb(0.85, 0.87, 0.9);

  let page = doc.addPage([612, 792]);
  let y = 744;
  const T = (t: string, o: { b?: boolean; size?: number; tone?: CertTone; x?: number } = {}) =>
    page.drawText(winAnsi(t), { x: o.x ?? 54, y, size: o.size || 10, font: o.b ? bold : helv, color: tones[o.tone || "ink"] });
  const rule = () => page.drawLine({ start: { x: 54, y: y + 6 }, end: { x: 558, y: y + 6 }, thickness: 0.5, color: lineColor });
  const wrap = (t: string, size: number, max: number, font: PDFFont = helv): string[] => {
    const out: string[] = [];
    let buf = "";
    for (let w of winAnsi(t).split(" ").filter(Boolean)) {
      // A single token wider than the line (a pasted URL or reference number) is hard-split, never
      // clipped off the edge of the page.
      while (font.widthOfTextAtSize(w, size) > max) {
        if (buf) { out.push(buf); buf = ""; }
        let k = w.length - 1;
        while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > max) k--;
        out.push(w.slice(0, k));
        w = w.slice(k);
      }
      const next = buf ? `${buf} ${w}` : w;
      if (buf && font.widthOfTextAtSize(next, size) > max) { out.push(buf); buf = w; } else buf = next;
    }
    if (buf) out.push(buf);
    return out;
  };
  // Out of room → another page, headed so a page printed or exhibited on its own still says which
  // certificate it belongs to. The old single-page layout stopped drawing at the bottom margin, so a
  // long envelope silently lost the end of its own audit trail.
  const newPage = () => {
    page = doc.addPage([612, 792]);
    y = 744;
    T(`Certificate of Completion (continued) — ${m.title}`.slice(0, 110), { b: true, size: 10 }); y -= 12;
    T(`Reference ID ${m.reference}`, { size: 8, tone: "muted" }); y -= 10;
    rule(); y -= 14;
  };
  const room = (need: number) => { if (y - need < 60) newPage(); };

  T("Certificate of Completion", { b: true, size: 18 }); y -= 14;
  T("Fetti Financial Services LLC · Electronic Signature Audit Trail", { size: 9, tone: "muted" }); y -= 22; rule(); y -= 8;
  T("Document", { b: true });
  const titleLines = wrap(m.title, 10, 388);
  titleLines.forEach((ln, i) => { if (i) { y -= 13; } T(ln, { x: 170 }); }); y -= 16;
  T("Reference ID", { b: true }); T(m.reference, { x: 170, size: 9, tone: "muted" }); y -= 16;
  T("Status", { b: true }); T(m.statusText, { x: 170, tone: m.partial ? "warn" : "ok" }); y -= 16;
  if (m.note) {
    T("Sender's note", { b: true });
    for (const part of wrap(m.note, 9, 388)) { room(12); T(part, { x: 170, size: 9, tone: "ink" }); y -= 12; }
    y -= 4;
  }
  y -= 6; rule(); y -= 14;

  T("Signers", { b: true, size: 12 }); y -= 18;
  for (const s of m.signers) {
    room(16 + s.lines.length * 11);
    T(s.heading, { b: true, size: 10 });
    T(s.label, { x: 470, size: 9, tone: s.signed ? "ok" : s.label === "NOT SIGNED" || s.label === "DECLINED" ? "warn" : "muted" });
    y -= 12;
    for (const ln of s.lines) {
      for (const part of wrap(ln.text, ln.size, 480)) { room(11); T(part, { x: 66, size: ln.size, tone: ln.tone }); y -= 11; }
    }
    y -= 4;
  }
  y -= 6; room(40); rule(); y -= 14;

  T("Event history", { b: true, size: 12 }); y -= 16;
  for (const ev of m.events) {
    room(24);
    const label = `• ${String(ev.type || "").toUpperCase()}`;
    T(label, { b: true, size: 9 });
    T(fmt(ev.at), { x: timestampX(bold.widthOfTextAtSize(winAnsi(label), 9)), size: 9 });
    y -= 11;
    if (ev.detail) for (const part of wrap(ev.detail, 8, 480)) { room(11); T(part, { x: 66, size: 8, tone: "muted" }); y -= 11; }
  }
  y -= 6; room(70); rule(); y -= 14;

  for (const part of wrap(m.consent, 8, 504)) { room(11); T(part, { size: 8, tone: "muted" }); y -= 11; }
  y -= 3; room(12);
  T(m.integrity, { size: 7, tone: "muted" });

  // Every page carries its reference and its place in the whole.
  const all = doc.getPages();
  all.forEach((p, i) => {
    p.drawText(winAnsi(`Reference ID ${m.reference}`), { x: 54, y: 30, size: 7, font: helv, color: tones.muted });
    p.drawText(`Page ${i + 1} of ${all.length}`, { x: 504, y: 30, size: 7, font: helv, color: tones.muted });
  });
  return doc.save();
}

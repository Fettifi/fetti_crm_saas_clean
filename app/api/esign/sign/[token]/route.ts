import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { standaloneBytes } from "@/lib/imageToPdf";
import { optimizeSignaturePng } from "@/lib/signatureImage";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { maybeAdvanceStage } from "@/lib/los";
import { sendSignRequest } from "@/lib/notify/docRequest";
import { notifyTeam } from "@/lib/notify/leadAlert";
import { ESIGN_BUCKET, EsignField, activeRecipient, getByRecipientToken, mutateRequest, recipientView, saveRequestIfUnchanged } from "@/lib/esign";
import { buildCertificate } from "@/lib/esignCertificate";

// Public signer endpoint — [token] is a RECIPIENT token.
//   GET  -> this recipient's view (marks "viewed" when it's their turn)
//   POST { signatureDataUrl, typedName, consent } -> stamp THIS recipient's
//         fields, route to the next signer, or complete + Certificate of Completion.
//
// Every write here is compare-and-set against the envelope version this request read (see
// saveRequestIfUnchanged in lib/esign.ts). A signature that loses a race — to the sender completing
// or voiding, or to another write — changes nothing: its uploaded files are deleted and it answers
// 409 before anyone is emailed, anything is filed, or a stage moves.
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
  let { env, recipient } = res;
  const active = activeRecipient(env);
  if (active?.id === recipient.id && (recipient.status === "sent" || recipient.status === "pending")) {
    const ip = clientIp(req); const ua = (req.headers.get("user-agent") || "").slice(0, 180);
    const at = new Date().toISOString();
    const rid = recipient.id;
    // Re-checked against the fresh row: marking "viewed" must never land on top of a signature or a
    // completion that happened after this request read the envelope.
    const out = await mutateRequest(env.token, (fresh) => {
      const r = (fresh.recipients || []).find((x) => x.id === rid);
      if (!r || activeRecipient(fresh)?.id !== rid || (r.status !== "sent" && r.status !== "pending")) return false;
      r.status = "viewed"; r.viewedAt = at;
      fresh.events = [...(fresh.events || []), { type: "viewed", at, ip, ua, detail: `${r.name} opened the document` }];
      return true;
    }).catch(() => null);
    if (out) {
      env = out.env;
      recipient = (env.recipients || []).find((x) => x.id === rid) || recipient;
    }
    if (out?.applied) {
      // DocuSign-style "viewed (unsigned)" alert to the loan team — fired once, on first open.
      notifyTeam(
        `📄 Viewed — not yet signed: ${env.title}`,
        `${recipient.name}${recipient.email ? ` <${recipient.email}>` : ""} opened "${env.title}" at ${at} (IP ${ip}).\nThey have NOT signed yet.`
      ).catch(() => {});
      await logActivity({ entity_type: "esign", entity_id: env.token, loan_file_id: env.loan_file_id || undefined, actor: "signer", action: "esign.viewed", detail: { recipient: recipient.name, title: env.title } }).catch(() => {});
    }
  }
  return NextResponse.json(recipientView(env, recipient));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const res = await getByRecipientToken(token);
    if (!res) return NextResponse.json({ error: "Invalid or expired signing link." }, { status: 404 });
    const { env, recipient, version } = res;
    if (env.status === "voided") return NextResponse.json({ error: "This envelope was voided by the sender." }, { status: 409 });
    if (env.status === "declined") return NextResponse.json({ error: "This envelope was declined." }, { status: 409 });
    // Completed includes an envelope the sender finished with the signatures already collected: its
    // certificate is issued, and a late signature must not change the document it certifies.
    if (env.status === "completed") return NextResponse.json({ error: "This document has already been completed. No further signatures are needed." }, { status: 409 });
    if (recipient.status === "signed") return NextResponse.json({ error: "You already signed this document." }, { status: 409 });
    if (activeRecipient(env)?.id !== recipient.id) {
      const a = activeRecipient(env);
      return NextResponse.json({ error: a ? `It's not your turn yet — waiting on ${a.name}.` : "This envelope is no longer active." }, { status: 409 });
    }

    const body = await req.json().catch(() => ({}));
    const consent = body?.consent === true;
    const typedName = String(body?.typedName || recipient.name || "").trim();
    // Signer-typed text-box values, keyed by field id (only this signer's fields are stamped).
    const fieldValues: Record<string, string> = (body?.fieldValues && typeof body.fieldValues === "object") ? body.fieldValues : {};
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
    // standaloneBytes: a signature PNG is small, and `Buffer.from(str, "base64")` under ~4KB
    // comes from Node's shared pool at a NON-ZERO byteOffset — which pdf-lib reads past,
    // rejecting a perfectly good signature. See lib/imageToPdf.ts.
    // A browser canvas exports the WHOLE pad at full resolution in RGBA, so a few strokes arrive
    // as a large true-colour image that nearly doubles the finished document — 23 KB of source
    // PDF came back 44 KB, too big for the system Ramon uploads to. Trim it to the ink, cap it
    // at print resolution, and store it as a small palette PNG before it goes in.
    const sigPng = await optimizeSignaturePng(Buffer.from(sigData.split(",")[1], "base64"));
    const sigImg = await pdf.embedPng(standaloneBytes(sigPng));
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const pages = pdf.getPages();
    let mine = (env.fields || []).filter((f: EsignField) => (f.recipientId || env.recipients[0]?.id) === recipient.id);

    // SIGNATURES THE SIGNER PLACED THEMSELVES.
    //
    // A signer can put their own signature where they want it on the page; those placements
    // arrive here and REPLACE the sender's signature boxes for this recipient. Anything else
    // the sender laid out — dates, name, text — is untouched, and a signer can never place a
    // field for anybody else: everything below is stamped as this recipient, this signature.
    const placed = Array.isArray(body?.placedFields) ? body.placedFields : [];
    if (placed.length) {
      // COORDINATES HERE ARE FRACTIONS OF THE PAGE (0-1) — THE SAME CONTRACT /api/esign/requests
      // ENFORCES AT INGEST. AN OUT-OF-RANGE VALUE IS REFUSED, NEVER CLAMPED.
      //
      // 2026-10-14, Jackson Metoyer 82609059, PTF 55: the Loan Originator's Section 9 of the Final
      // 1003, owed to the funder on the day the loan was scheduled to fund. This block used to CLAMP
      // each coordinate into [0, 0.98]. An envelope written straight into app_settings — bypassing
      // the ingest route that rejects values > 1 — carried xPct 13.21 and yPct 18.89, meaning
      // PERCENT. The clamp turned both into 0.98, so the signature was drawn at x=599.8 on a 612pt
      // page with its box bottom at y=-142.6. The envelope reported `completed`, the recipient
      // `signed`, a signed_hash was written, and the Section 9 signature line was BLANK. It was
      // caught only by rendering the result and looking at it.
      //
      // A clamp is the wrong instinct for a coordinate. It converts "I do not understand these
      // numbers" into "I will put the signature somewhere", and somewhere is off the paper — while
      // every downstream surface reports the document as executed. Refusing costs one error message;
      // clamping cost a blank instrument on a funding file.
      // [[verified-the-check-never-read-the-value]] [[things-that-look-like-they-work]]
      const badUnits: string[] = [];
      const frac = (v: unknown, dflt: number, name: string, i: number): number => {
        if (v === undefined || v === null || v === "") return dflt;   // absent is fine — use the default
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 1) {
          badUnits.push(`${name}=${String(v)} on field ${i}`);
          return dflt;
        }
        return n;
      };
      const clean: EsignField[] = placed.slice(0, 5).map((f: any, i: number) => ({
        id: `self-${recipient.id}-${i}`,
        type: "signature" as const,
        page: Math.max(1, Math.min(Number(f.page) || 1, pdf.getPageCount())),
        xPct: frac(f.xPct, 0, "xPct", i),
        yPct: frac(f.yPct, 0, "yPct", i),
        wPct: frac(f.wPct, 0.24, "wPct", i),
        hPct: frac(f.hPct, 0.06, "hPct", i),
        recipientId: recipient.id,
      }));
      if (badUnits.length) {
        console.error("[esign] refusing out-of-range signer placement", env.token, recipient.id, badUnits);
        await logActivity({ entity_type: "esign", entity_id: env.token, loan_file_id: env.loan_file_id || undefined, actor: "system", action: "esign.bad_units_refused", detail: { title: env.title, signer: recipient.name, fields: badUnits } }).catch(() => {});
        return NextResponse.json({ error: "We can't place your signature on this document correctly. Nothing was signed — please contact us and we'll send a corrected copy." }, { status: 422 });
      }
      mine = [...mine.filter((f) => f.type !== "signature"), ...clean];
      // Persist so the audit trail and any later re-render show where it actually went.
      env.fields = [
        ...(env.fields || []).filter((f: EsignField) => !((f.recipientId || env.recipients[0]?.id) === recipient.id && f.type === "signature")),
        ...clean,
      ];
    }
    // NOTHING MAY BE STAMPED OFF THE PAGE.
    //
    // 2026-09-18, Magali Lopez Villafuerte's parking letter of explanation: the envelope completed,
    // the recipient showed `signed`, the certificate counted it — and the signed PDF came out with an
    // empty signature line. The field carried percentages (12.4, 65.7) where this code reads
    // FRACTIONS, so pdf-lib drew the signature image thousands of points past the edge of the paper.
    // Nothing threw. A borrower document that is blank where the signature belongs is worse than a
    // signature that fails, because everything downstream — the file listing, the certificate, the
    // lender upload — reports it as executed. That letter sat in the loan's upload folder ready to go
    // to an underwriter.
    //
    // The ingest route now rejects coordinates greater than 1 (verify:esign-field-units holds it), so
    // a violation here means something else produced an off-page placement. Refuse it rather than
    // write a blank instrument.
    // THE PAGE INDEX WAS CLAMPED, IN THE FUNCTION THAT EXISTS TO REFUSE RATHER THAN CLAMP.
    //
    // `pages[Math.min(Math.max((f.page || 1) - 1, 0), pages.length - 1)]` silently relocates a field:
    // a field placed on page 7 of a document that is now 3 pages gets stamped on page 3, and page 0
    // or a negative gets stamped on page 1. The envelope then reports `completed`. That is a borrower's
    // signature on the wrong page of an executed instrument — a defect of exactly the kind the
    // off-page refusal below was written for, arriving through the page axis instead of x/y.
    // [[a-clamp-erases-the-error-it-should-raise]]
    //
    // A document can legitimately be re-generated shorter after fields were placed, so this is
    // reachable without anyone doing anything odd. Resolve the index ONCE, validate it, refuse.
    const pageOf = (f: { page?: number | null }) => (f.page || 1) - 1;
    const badPage = mine
      .filter((f) => { const i = pageOf(f); return !Number.isInteger(i) || i < 0 || i >= pages.length; })
      .map((f) => `${f.type}@p${f.page || 1} of ${pages.length} page(s)`);
    if (badPage.length) {
      console.error("[esign] refusing to stamp fields on a page that does not exist", env.token, recipient.id, badPage);
      await logActivity({ entity_type: "esign", entity_id: env.token, loan_file_id: env.loan_file_id || undefined, actor: "system", action: "esign.badpage_refused", detail: { title: env.title, signer: recipient.name, fields: badPage, pages: pages.length } }).catch(() => {});
      return NextResponse.json({ error: "We can't place your signature on this document correctly. Nothing was signed — please contact us and we'll send a corrected copy." }, { status: 422 });
    }

    const offPage: string[] = [];
    for (const f of mine) {
      const pg = pages[pageOf(f)];
      const { width: pw, height: ph } = pg.getSize();
      const bw = (f.wPct || 0.2) * pw, bh = (f.hPct || 0.04) * ph;
      const x = (f.xPct || 0) * pw;
      const yBottom = ph - (f.yPct || 0) * ph - bh;
      // CONTAINMENT, NOT "WHOLLY OUTSIDE".
      //
      // This test used to ask whether the box had left the page ENTIRELY: x + bw < 1 || x > pw - 1 ||
      // yBottom + bh < 1 || yBottom > ph - 1. A box that STRADDLES an edge satisfies none of those and
      // sailed through — which is exactly what happened on Metoyer 82609059. The clamped box was
      // x=599.8 w=367.2 (running to 967 on a 612pt page) with yBottom=-142.6 h=158.4, so
      // `yBottom + bh` came to 15.8, comfortably above 1, and the old test reported it on-page. The
      // signature image is then centred INSIDE that box, so the ink landed off the paper while the
      // arithmetic said it had not. The right-hand edge was never tested against pw at all.
      //
      // The signature has to sit ON the paper, so test all four edges for containment. EDGE absorbs
      // the hair of overhang that rounding genuinely produces; anything beyond a point is a
      // misplacement, and a misplacement must refuse rather than write a blank instrument.
      const EDGE = 1;
      if (x < -EDGE || yBottom < -EDGE || x + bw > pw + EDGE || yBottom + bh > ph + EDGE) {
        offPage.push(`${f.type}@p${f.page || 1} box x=${x.toFixed(0)}..${(x + bw).toFixed(0)} y=${yBottom.toFixed(0)}..${(yBottom + bh).toFixed(0)} of ${pw.toFixed(0)}x${ph.toFixed(0)}`);
      }
    }
    if (offPage.length) {
      console.error("[esign] refusing to stamp off-page fields", env.token, recipient.id, offPage);
      await logActivity({ entity_type: "esign", entity_id: env.token, loan_file_id: env.loan_file_id || undefined, actor: "system", action: "esign.offpage_refused", detail: { title: env.title, signer: recipient.name, fields: offPage } }).catch(() => {});
      return NextResponse.json({ error: "We can't place your signature on this document correctly. Nothing was signed — please contact us and we'll send a corrected copy." }, { status: 422 });
    }

    // A TEXT VALUE THAT DOES NOT FIT MUST REFUSE, NOT OVERFLOW ACROSS THE INSTRUMENT.
    //
    // `drawText` was given `maxWidth` (so it WRAPS) but no height bound, and pdf-lib draws every
    // wrapped line regardless of the box. A signer typing a long entity name or address into a
    // one-line field has the overflow run down the page, over whatever text is beneath it — and the
    // envelope reports `completed`. Same family as the off-page defect above: the document is
    // defaced while the arithmetic says it is fine.
    //
    // Measure the wrap before stamping. `slice(0, 300)` caps the input but says nothing about how
    // many LINES 300 characters become in a box this wide.
    const wrapLines = (text: string, size: number, maxW: number): number => {
      let lines = 1, cur = "";
      for (const word of String(text).split(/\s+/).filter(Boolean)) {
        const next = cur ? `${cur} ${word}` : word;
        if (helv.widthOfTextAtSize(next, size) <= maxW) { cur = next; continue; }
        // A single word wider than the box cannot be wrapped away — count the rows it needs.
        if (!cur) { lines += Math.max(0, Math.ceil(helv.widthOfTextAtSize(word, size) / maxW) - 1); cur = ""; continue; }
        lines++; cur = word;
      }
      return lines;
    };
    const overflow: string[] = [];
    for (const f of mine) {
      if (f.type !== "text") continue;
      const pg = pages[pageOf(f)];
      const { width: pw, height: ph } = pg.getSize();
      const bw = (f.wPct || 0.2) * pw, bh = (f.hPct || 0.04) * ph;
      const v = String(fieldValues?.[String(f.id)] || "").slice(0, 300);
      if (!v) continue;
      const size = Math.max(7, Math.min(13, bh * 0.6));
      const needed = wrapLines(v, size, Math.max(1, bw - 4)) * size * 1.15;
      if (needed > bh + 0.5) overflow.push(`${f.type}@p${f.page || 1} needs ${needed.toFixed(0)}pt in a ${bh.toFixed(0)}pt box`);
    }
    if (overflow.length) {
      console.error("[esign] refusing to stamp overflowing text", env.token, recipient.id, overflow);
      await logActivity({ entity_type: "esign", entity_id: env.token, loan_file_id: env.loan_file_id || undefined, actor: "system", action: "esign.overflow_refused", detail: { title: env.title, signer: recipient.name, fields: overflow } }).catch(() => {});
      return NextResponse.json({ error: "One of your answers is too long for the space on this document. Nothing was signed — please shorten it, or contact us and we'll send a corrected copy." }, { status: 422 });
    }

    for (const f of mine) {
      const pg = pages[pageOf(f)];
      const { width: pw, height: ph } = pg.getSize();
      const bw = (f.wPct || 0.2) * pw, bh = (f.hPct || 0.04) * ph;
      const x = (f.xPct || 0) * pw;
      const yBottom = ph - (f.yPct || 0) * ph - bh;
      if (f.type === "text") {
        const v = String(fieldValues?.[String(f.id)] || "").slice(0, 300);
        if (v) {
          const size = Math.max(7, Math.min(13, bh * 0.6));
          pg.drawText(v, { x: x + 2, y: yBottom + (bh - size) / 2, size, font: helv, color: rgb(0.05, 0.05, 0.1), maxWidth: bw - 4, lineHeight: size * 1.15 });
        }
      } else if (f.type === "signature" || f.type === "initials") {
        const d = sigImg.scaleToFit(bw, bh);
        pg.drawImage(sigImg, { x: x + (bw - d.width) / 2, y: yBottom + (bh - d.height) / 2, width: d.width, height: d.height });
      } else {
        const text = f.type === "date" ? dateStr : typedName;
        const size = Math.max(7, Math.min(bh * 0.8, 13));
        pg.drawText(text, { x: x + 1, y: yBottom + (bh - size) / 2, size, font: helv, color: rgb(0.05, 0.05, 0.1) });
      }
    }
    const updated = await pdf.save();
    // A NEW object per signing attempt, never an overwrite. The previous signed copy — which a
    // certificate may already hash — stays byte-for-byte what it was, and a losing attempt only
    // ever has its own file to clean up.
    const signed_path = `esign/${env.token}/signed-${now.getTime()}.pdf`;
    const { error: sUpErr } = await supabaseAdmin.storage.from(ESIGN_BUCKET).upload(signed_path, Buffer.from(updated), { contentType: "application/pdf", upsert: false });
    if (sUpErr) throw new Error("Could not save the signed document.");
    env.signed_path = signed_path;

    recipient.status = "signed"; recipient.signedAt = now.toISOString(); recipient.ip = ip; recipient.ua = ua; recipient.typedName = typedName;
    env.events = [...(env.events || []), { type: "signed", at: now.toISOString(), ip, ua, detail: `Signed by ${recipient.name}` }];

    const lostRace = async (paths: string[]) => {
      await supabaseAdmin.storage.from(ESIGN_BUCKET).remove(paths).catch(() => {});
      return NextResponse.json({ error: "This document changed while you were signing — please reload the page to see where it stands." }, { status: 409 });
    };

    const next = activeRecipient(env);
    const origin = req.nextUrl.origin;
    if (next) {
      // Route to the next signer — but only once this signature is safely the envelope of record.
      next.status = "sent";
      env.status = "in_progress";
      if (!(await saveRequestIfUnchanged(env, version))) return lostRace([signed_path]);
      try {
        const routed = await sendSignRequest({ to_name: next.name, to_email: next.email, to_phone: next.phone, link: `${origin}/sign/${next.token}`, title: env.title });
        const routedAt = new Date().toISOString();
        // Record what ACTUALLY left: the delivery state and Resend id land on the fresh row (the
        // local `env` was already saved above), and the event says which channels carried the
        // link — "routed" used to be written even when nothing was sent.
        await mutateRequest(env.token, (fresh) => {
          if (fresh.status !== "in_progress") return false;
          const rc = (fresh.recipients || []).find((x) => x.id === next.id);
          if (rc && routed.sent.includes("email")) { rc.delivery = "sent"; rc.emailId = routed.emailId || null; }
          const how = routed.sent.length ? `via ${routed.sent.join(" + ")}` : "link created — NOT delivered (no channel reached the signer)";
          fresh.events = [...(fresh.events || []), { type: "routed", at: routedAt, detail: `Routed to next signer: ${next.name} ${how}` }];
          return true;
        });
      } catch { /* */ }
      return NextResponse.json({ ok: true, signed: true, completed: false, next: next.name });
    }

    // Everyone signed → complete + Certificate of Completion.
    const finalHash = crypto.createHash("sha256").update(updated).digest("hex");
    env.status = "completed";
    env.signed_hash = finalHash;
    const certBytes = await buildCertificate(env, finalHash);
    const cert_path = `esign/${env.token}/certificate-${now.getTime()}.pdf`;
    const { error: cUpErr } = await supabaseAdmin.storage.from(ESIGN_BUCKET).upload(cert_path, Buffer.from(certBytes), { contentType: "application/pdf", upsert: false });
    if (cUpErr) { await supabaseAdmin.storage.from(ESIGN_BUCKET).remove([signed_path]).catch(() => {}); throw new Error("Could not save the certificate."); }
    env.cert_path = cert_path;
    env.events.push({ type: "completed", at: new Date().toISOString(), detail: "All signers completed" });
    if (!(await saveRequestIfUnchanged(env, version))) return lostRace([signed_path, cert_path]);

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

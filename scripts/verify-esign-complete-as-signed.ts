// "COMPLETE AS SIGNED" MUST ISSUE A TRUE CERTIFICATE, KILL THE UNUSED LINKS, AND LOSE RACES CLEANLY.
//
// Ramon, 2026-09-15: he and Kelly Dorsey signed the 3545 Winthrop VOM on 8/26; the third recipient
// signed with his own DocuSign instead. The envelope sat "in progress" and the only code that issued
// a Certificate of Completion ran when EVERY recipient signed, so there was no way to prove the two
// signatures that did happen.
//
// An adversarial review of the first version then confirmed a race: every envelope write was
// last-write-wins, so a signature landing while the sender pressed Complete could be erased and
// that signer certified NOT SIGNED. Writes are now compare-and-set; this proves the loser loses.
//
// Runs the real implementation against the real store with throwaway envelopes
// (@fetti-internal.test recipients; nothing is ever sent) and holds:
//   1. nothing signed → refused; voided → refused; both left untouched
//   2. the compare-and-set primitive refuses a stale version and writes nothing
//   3. completion that loses to a concurrent signature changes nothing: the signer stays signed,
//      no closed_by_sender, and the attempt's certificate object is deleted
//   4. completing marks the envelope completed, the unsigned recipient not_signed, and leaves the
//      signed recipients' timestamps untouched
//   5. the certificate is stored, opens as a PDF, and its TEXT says "2 of 3", prints the unsigned
//      recipient NOT SIGNED with no "Signed:" line, says "in this envelope", and does not use the
//      everyone-consented wording; the stored hash is the SHA-256 of the signed PDF in storage
//   6. the unsigned recipient can no longer sign or decline (409) or open the PDFs (410); a signer
//      still can open them, and their own view knows the sender closed it
//   7. completing twice is a no-op; a blank note is stored as null and prints no note
//   8. long event labels push the timestamp column right; the all-signed wording is unchanged
// Everything it creates is deleted in `finally`, then checked gone.
//
//   npm run verify:esign-complete   (runs under --conditions=react-server: the sign route imports server-only modules)
import "./_env";
import crypto from "crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { NextRequest } from "next/server";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import {
  ESIGN_BUCKET, type EsignRequest, type Recipient, newToken, saveRequest, saveRecipientPointer, getRequest, getRequestRow,
  saveRequestIfUnchanged, activeRecipient, recipientView, completeWithSignaturesCollected,
} from "../lib/esign";
import { certificateModel, timestampX } from "../lib/esignCertificate";
import { POST as signPOST } from "../app/api/esign/sign/[token]/route";
import { POST as declinePOST } from "../app/api/esign/sign/[token]/decline/route";
import { GET as pdfGET } from "../app/api/esign/sign/[token]/pdf/route";

let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || info === undefined ? "" : `  →  ${JSON.stringify(info)}`}`);
  if (!ok) failures++;
};
const sha = (b: Uint8Array) => crypto.createHash("sha256").update(b).digest("hex");
const created = { keys: [] as string[], prefixes: [] as string[] };
const listObjects = async (prefix: string): Promise<string[]> => ((await supabaseAdmin.storage.from(ESIGN_BUCKET).list(prefix)).data || []).map((o: { name: string }) => o.name);

async function makeEnvelope(label: string, statuses: Recipient["status"][], envStatus: EsignRequest["status"] = "in_progress"): Promise<EsignRequest> {
  const token = newToken();
  created.prefixes.push(`esign/${token}`);
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]).drawText(`verify ${label}`, { x: 72, y: 700, size: 12 });
  const bytes = await pdf.save();
  for (const name of ["source.pdf", "signed.pdf"]) {
    const { error } = await supabaseAdmin.storage.from(ESIGN_BUCKET).upload(`esign/${token}/${name}`, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
    if (error) throw new Error(`upload ${name}: ${error.message}`);
  }
  const now = new Date().toISOString();
  const recipients: Recipient[] = statuses.map((s, i) => {
    const letter = String.fromCharCode(65 + i);
    return {
      id: `r${i + 1}`, name: `Verify Signer ${letter}`, email: `verify-signer-${letter.toLowerCase()}@fetti-internal.test`, phone: null,
      order: i + 1, token: newToken(), status: s,
      ...(s === "signed" ? { viewedAt: now, signedAt: now, ip: "203.0.113.7", ua: "verify-script", typedName: `Verify Signer ${letter}` } : s === "viewed" ? { viewedAt: now } : {}),
    };
  });
  const env: EsignRequest = {
    token, title: `VERIFY complete-as-signed ${label}`, loan_file_id: null, lead_id: null,
    signer_name: recipients[0].name, signer_email: recipients[0].email, signer_phone: null,
    recipients, source_path: `esign/${token}/source.pdf`,
    signed_path: statuses.includes("signed") ? `esign/${token}/signed.pdf` : null,
    fields: [], status: envStatus, events: [{ type: "created", at: now, detail: "verify script" }],
    created_by: "verify", created_at: now, updated_at: now,
  };
  created.keys.push(`esign:${token}`);
  await saveRequest(env);
  for (const r of recipients) { created.keys.push(`rcpt:${r.token}`); await saveRecipientPointer(r.token, token, r.id); }
  return env;
}

const post = (url: string, b: unknown) => new NextRequest(url, { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" } });
const get = (url: string) => new NextRequest(url, { method: "GET" });

(async () => {
  try {
    // 1. refusals
    const none = await makeEnvelope("nobody-signed", ["sent", "pending"]);
    const r1 = await completeWithSignaturesCollected(none.token, "x");
    check("nothing signed → refused", !r1.ok && r1.reason === "nothing_signed", r1);
    const voided = await makeEnvelope("voided", ["signed", "viewed"], "voided");
    const r2 = await completeWithSignaturesCollected(voided.token, "x");
    check("voided → refused", !r2.ok && r2.reason === "voided", r2);
    check("refusals left both envelopes untouched",
      (await getRequest(none.token))?.status === "in_progress" && (await getRequest(voided.token))?.status === "voided" && !(await getRequest(voided.token))?.cert_path);

    // 2. compare-and-set primitive
    const casEnv = await makeEnvelope("cas", ["signed", "viewed"]);
    const casRow = (await getRequestRow(casEnv.token))!;
    const staleCopy: EsignRequest = JSON.parse(JSON.stringify(casRow.env));
    const bumped = await saveRequestIfUnchanged({ ...casRow.env, title: `${casRow.env.title} (bumped)` }, casRow.version);
    check("CAS write with the current version lands", !!bumped);
    const stale = await saveRequestIfUnchanged({ ...staleCopy, title: "STALE WRITE" }, casRow.version);
    check("CAS write with a stale version is refused", stale === null);
    check("the refused write changed nothing", (await getRequest(casEnv.token))?.title === `${casEnv.title} (bumped)`);

    // 3. completion loses to a concurrent signature — nothing is overwritten
    const race = await makeEnvelope("race", ["signed", "viewed"]);
    const lost = await completeWithSignaturesCollected(race.token, "should not land", {
      beforeSave: async () => {
        // A signer signs in the window between the certificate build and the save.
        const row = (await getRequestRow(race.token))!;
        const r = row.env.recipients.find((x) => x.id === "r2")!;
        r.status = "signed"; r.signedAt = new Date().toISOString(); r.ip = "203.0.113.9"; r.ua = "verify-concurrent-signer";
        row.env.events = [...(row.env.events || []), { type: "signed", at: r.signedAt, detail: "Signed by Verify Signer B (concurrent)" }];
        if (!(await saveRequestIfUnchanged(row.env, row.version))) throw new Error("could not stage the concurrent signature");
      },
    });
    const raceAfter = (await getRequest(race.token))!;
    check("completion that lost the race reports changed", !lost.ok && lost.reason === "changed", lost);
    check("the concurrent signer is still SIGNED", raceAfter.recipients.find((r) => r.id === "r2")?.status === "signed");
    check("no closed_by_sender and not completed after losing", !raceAfter.closed_by_sender && raceAfter.status === "in_progress" && !raceAfter.cert_path, { status: raceAfter.status, closed: raceAfter.closed_by_sender });
    const raceObjects = await listObjects(`esign/${race.token}`);
    check("the losing attempt's certificate object was deleted", !raceObjects.some((n) => n.startsWith("certificate")), raceObjects);

    // 4. the real case: two of three signed
    const env = await makeEnvelope("two-of-three", ["signed", "signed", "viewed"]);
    const before = (await getRequest(env.token))!;
    check("before: the third recipient is the active signer", activeRecipient(before)?.id === "r3");
    const note = "Verify Signer C signed separately using their own DocuSign";
    const out = await completeWithSignaturesCollected(env.token, note);
    check("complete → ok with no warning", out.ok && !out.alreadyCompleted && !out.warning, out.ok ? { alreadyCompleted: out.alreadyCompleted, warning: out.warning } : out);
    const after = (await getRequest(env.token))!;
    check("envelope status is completed", after.status === "completed", after.status);
    check("unsigned recipient is not_signed", after.recipients.find((r) => r.id === "r3")?.status === "not_signed");
    const stamps = (e: EsignRequest) => e.recipients.filter((r) => r.status === "signed").map((r) => `${r.id}@${r.signedAt}`).join();
    check("signed recipients untouched", stamps(after) === stamps(before) && after.recipients.filter((r) => r.status === "signed").length === 2, { before: stamps(before), after: stamps(after) });
    check("closed_by_sender records who did and did not sign",
      JSON.stringify(after.closed_by_sender?.signed) === JSON.stringify(["Verify Signer A", "Verify Signer B"]) &&
      JSON.stringify(after.closed_by_sender?.not_signed) === JSON.stringify(["Verify Signer C"]) &&
      after.closed_by_sender?.reason === note, after.closed_by_sender);
    check("exactly one completed_by_sender event", (after.events || []).filter((e) => e.type === "completed_by_sender").length === 1);
    check("certificate stored at a per-attempt path", /\/certificate-\d+\.pdf$/.test(after.cert_path || ""), after.cert_path);

    // 5. certificate + hash
    const { data: signedBlob } = await supabaseAdmin.storage.from(ESIGN_BUCKET).download(after.signed_path!);
    const signedBytes = new Uint8Array(await signedBlob!.arrayBuffer());
    check("signed_hash is the SHA-256 of the stored signed PDF", after.signed_hash === sha(signedBytes));
    const { data: certBlob, error: certErr } = await supabaseAdmin.storage.from(ESIGN_BUCKET).download(after.cert_path || `esign/${env.token}/missing.pdf`);
    const certBytes = certBlob ? new Uint8Array(await certBlob.arrayBuffer()) : new Uint8Array();
    check("certificate stored and is a PDF", !certErr && Buffer.from(certBytes.subarray(0, 5)).toString("latin1").startsWith("%PDF"), certErr?.message);
    const opened = certBytes.length ? await PDFDocument.load(certBytes).catch(() => null) : null;
    check("certificate PDF opens", !!opened && opened.getPageCount() >= 1);
    const m = certificateModel(after, after.signed_hash!);
    check("certificate status says 2 of 3", m.partial && /2 of 3/.test(m.statusText), m.statusText);
    const c = m.signers.find((s) => s.heading.includes("Signer C"));
    check("unsigned recipient prints NOT SIGNED", !!c && c.label === "NOT SIGNED" && !c.signed, c);
    check("unsigned recipient has no Signed: line", !!c && !c.lines.some((l) => /^Signed:/.test(l.text)), c?.lines);
    check("unsigned recipient's lines say 'in this envelope', never a bare 'did not sign'",
      !!c && c.lines.some((l) => /in this envelope/.test(l.text)) && !c.lines.some((l) => /did not sign/.test(l.text)), c?.lines);
    const s2 = m.signers.filter((s) => s.signed);
    check("signed recipients print SIGNED with a timestamp", s2.length === 2 && s2.every((s) => s.label === "SIGNED" && s.lines.some((l) => /^Signed: /.test(l.text))));
    check("consent does not claim everyone signed", !/^Consent: Each signer agreed/.test(m.consent) && /NOT SIGNED/.test(m.consent), m.consent);
    check("sender's note is on the certificate", m.note === note);

    // 6. the unused link is dead; a signer's is not
    const r3 = after.recipients.find((r) => r.id === "r3")!;
    const r1s = after.recipients.find((r) => r.id === "r1")!;
    const view3 = recipientView(after, r3);
    check("unsigned recipient's view: closed by sender, not their turn", view3.closedBySender === true && view3.yourTurn === false && view3.waitingFor === null, view3);
    const view1 = recipientView(after, r1s);
    check("signed recipient's view knows the sender closed it", view1.closedBySender === true && view1.signed === true);
    check("no active recipient after completion", activeRecipient(after) === null);
    const signRes = await signPOST(post(`http://verify.local/api/esign/sign/${r3.token}`, { consent: true, typedName: "x", signatureDataUrl: "data:image/png;base64,iVBORw0KGgo=" }), { params: Promise.resolve({ token: r3.token }) });
    check("unsigned recipient can no longer sign (409)", signRes.status === 409, signRes.status);
    const decRes = await declinePOST(post(`http://verify.local/api/esign/sign/${r3.token}/decline`, { reason: "x" }), { params: Promise.resolve({ token: r3.token }) });
    check("unsigned recipient can no longer decline (409)", decRes.status === 409, decRes.status);
    const pdf3 = await pdfGET(get(`http://verify.local/api/esign/sign/${r3.token}/pdf?doc=cert`), { params: Promise.resolve({ token: r3.token }) });
    check("unsigned recipient can no longer open the certificate (410)", pdf3.status === 410, pdf3.status);
    const pdf1 = await pdfGET(get(`http://verify.local/api/esign/sign/${r1s.token}/pdf?doc=cert`), { params: Promise.resolve({ token: r1s.token }) });
    check("a signer can still open the certificate (200 PDF)", pdf1.status === 200 && (pdf1.headers.get("content-type") || "").includes("pdf"), pdf1.status);
    const { data: again } = await supabaseAdmin.storage.from(ESIGN_BUCKET).download(after.signed_path!);
    check("signed PDF unchanged after the attempts", sha(new Uint8Array(await again!.arrayBuffer())) === after.signed_hash);
    check("envelope still completed after the attempts", (await getRequest(env.token))?.status === "completed");

    // 7. idempotent; blank note
    const twice = await completeWithSignaturesCollected(env.token, "second note");
    const afterTwice = (await getRequest(env.token))!;
    check("completing twice is a no-op",
      twice.ok && twice.alreadyCompleted && (afterTwice.events || []).length === (after.events || []).length && afterTwice.closed_by_sender?.reason === note);
    const blank = await makeEnvelope("blank-note", ["signed", "viewed"]);
    const bOut = await completeWithSignaturesCollected(blank.token, "   ");
    const bAfter = (await getRequest(blank.token))!;
    check("blank note → completed with reason null", bOut.ok && bAfter.closed_by_sender?.reason === null, bAfter.closed_by_sender);
    const bm = certificateModel(bAfter, bAfter.signed_hash || "");
    check("blank note → no Sender's note on the certificate and no note in the event", bm.note === null && !(bAfter.events || []).some((e) => /Sender's note/.test(e.detail || "")), { note: bm.note });

    // 8. layout + unchanged all-signed wording
    const probe = await PDFDocument.create();
    const bold = await probe.embedFont(StandardFonts.HelveticaBold);
    const lw = bold.widthOfTextAtSize("• COMPLETED_BY_SENDER", 9);
    check("a long event label pushes the timestamp past its end", timestampX(lw) >= 54 + lw + 4 && timestampX(bold.widthOfTextAtSize("• SENT", 9)) === 170, { labelEnd: 54 + lw, x: timestampX(lw) });
    const full = certificateModel(
      { ...after, closed_by_sender: null, recipients: after.recipients.map((r) => ({ ...r, status: "signed" as const, signedAt: r.signedAt || new Date().toISOString() })) },
      "0".repeat(64),
    );
    check("all-signed certificate keeps the original wording",
      full.statusText === "Completed" && !full.partial && /^Consent: Each signer agreed/.test(full.consent) && full.note === null && full.signers.every((s) => s.label === "SIGNED"));
  } catch (e: any) {
    check("script ran to the end without throwing", false, e?.message || String(e));
  } finally {
    for (const prefix of created.prefixes) {
      const names = await listObjects(prefix);
      if (names.length) await supabaseAdmin.storage.from(ESIGN_BUCKET).remove(names.map((n: string) => `${prefix}/${n}`));
      const left = await listObjects(prefix);
      check(`cleanup: storage emptied for ${prefix.slice(0, 14)}…`, left.length === 0, left);
    }
    if (created.keys.length) {
      await supabaseAdmin.from("app_settings").delete().in("key", created.keys);
      const { data: rows } = await supabaseAdmin.from("app_settings").select("key").in("key", created.keys);
      check(`cleanup: ${created.keys.length} app_settings rows deleted`, (rows || []).length === 0, rows);
    }
    console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
    process.exitCode = failures ? 1 : 0;
  }
})();

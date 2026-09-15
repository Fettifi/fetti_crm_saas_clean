// Built-in e-signature ("our own DocuSign"). Envelopes are stored as rows in the
// service-role-only app_settings table (keyed esign:<token>) — no public/anon
// access — and the source/signed PDFs live in the private loan-docs bucket.
// Multi-signer with a signing order; each recipient gets their own link
// (rcpt:<recipientToken> → envelope). Signing is ESIGN/UETA-style: explicit
// consent + intent + a stamped Certificate of Completion (audit trail).
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { buildCertificate } from "@/lib/esignCertificate";

export type EsignFieldType = "signature" | "initials" | "date" | "name" | "text";
// Page-relative fractions, top-left origin (matches the pdf.js placement UI).
// recipientId ties a field to a specific signer.
export type EsignField = { id?: string; type: EsignFieldType; page: number; xPct: number; yPct: number; wPct: number; hPct: number; recipientId?: string; value?: string };

export type Recipient = {
  id: string;                 // stable id (also used by fields.recipientId)
  name: string;
  email?: string | null;
  phone?: string | null;
  order: number;              // 1-based signing order (sequential routing)
  token: string;              // per-recipient signing link token
  // "not_signed" = the sender completed the envelope with the signatures already collected and
  // this recipient never signed in it. Distinct from "declined": they did not refuse anything.
  status: "pending" | "sent" | "viewed" | "signed" | "declined" | "not_signed";
  // Email DELIVERY state (separate from signing status) — updated by the Resend
  // bounce/delivery webhook so a mistyped address auto-flips to "bounced".
  // "self" = never delivered anywhere, because the signer opened it themselves. A
  // self-signed envelope has no inbox hop to report on, and calling that "sent" would put a
  // delivery in the audit trail that never happened.
  delivery?: "sent" | "delivered" | "bounced" | "complained" | "self";
  deliveryAt?: string;
  viewedAt?: string; signedAt?: string; ip?: string; ua?: string; typedName?: string; declineReason?: string;
};

export type EsignRequest = {
  token: string;              // envelope token
  title: string;
  loan_file_id?: string | null;
  lead_id?: string | null;
  signer_name: string;        // convenience for list display (first recipient)
  signer_email?: string | null;
  signer_phone?: string | null;
  recipients: Recipient[];
  source_path: string;
  signed_path?: string | null;     // working/accumulating signed PDF
  cert_path?: string | null;       // separate Certificate of Completion (audit trail) PDF
  signed_hash?: string | null;     // SHA-256 of the completed signed PDF
  fields: EsignField[];
  status: "sent" | "in_progress" | "completed" | "declined" | "voided";
  events?: { type: string; at: string; ip?: string; ua?: string; detail?: string }[];
  // Set when the sender finished the envelope with the signatures already collected instead of
  // waiting for everyone. status is "completed" either way; this is what tells the two apart, on
  // the dashboard and on the certificate. reason is null when the sender wrote no note — a default
  // sentence would print on the certificate as a statement the sender never made.
  closed_by_sender?: { at: string; reason: string | null; signed: string[]; not_signed: string[] } | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
};

export const ESIGN_BUCKET = "loan-docs";
const KEY = (t: string) => `esign:${t}`;
const RKEY = (t: string) => `rcpt:${t}`;

export function newToken(): string {
  const r = () => (globalThis.crypto?.randomUUID?.() || Math.random().toString(16).slice(2) + Date.now().toString(16)).replace(/-/g, "");
  return (r() + r()).slice(0, 32);
}

// Unconditional write. For a BRAND-NEW envelope only — nothing can have raced a row that did not
// exist. Every write to an existing envelope goes through saveRequestIfUnchanged / mutateRequest.
export async function saveRequest(req: EsignRequest): Promise<void> {
  req.updated_at = new Date().toISOString();
  await supabaseAdmin.from("app_settings").upsert(
    { key: KEY(req.token), value: JSON.stringify(req), updated_at: req.updated_at },
    { onConflict: "key" }
  );
}

export async function getRequest(token: string): Promise<EsignRequest | null> {
  if (!token) return null;
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", KEY(token)).maybeSingle();
  if (!data?.value) return null;
  try { return JSON.parse(data.value) as EsignRequest; } catch { return null; }
}

// COMPARE-AND-SET ENVELOPE WRITES.
//
// An envelope is one JSON row, and several writers touch it: a signer signing, the sender voiding
// or completing, the first-open "viewed" mark, the Resend delivery webhook. Each used to read the
// row, spend seconds on PDF work or network sends, then upsert its copy over whatever was there.
// Adversarial review (2026-09-15) confirmed what that allows: a signature landing while the sender
// clicks "Complete as signed" could be erased and the signer certified NOT SIGNED over a PDF that
// carries their signature — or the signer's stale copy could reopen an envelope whose certificate
// was already issued.
//
// Every write to an existing envelope now lands only if the row is still the version that was
// read (same pattern as casSetting in lib/settings.ts). The loser learns it lost, instead of
// silently winning.
export type EnvelopeRow = { env: EsignRequest; version: string };

/** STRICT read: throws on a DB error rather than reporting "not found" — a read-modify-write must
 *  never treat a blip as an empty envelope. `version` is the row's updated_at, for the CAS. */
export async function getRequestRow(token: string): Promise<EnvelopeRow | null> {
  if (!token) return null;
  const { data, error } = await supabaseAdmin.from("app_settings").select("value, updated_at").eq("key", KEY(token)).maybeSingle();
  if (error) throw new Error(`Could not read the envelope: ${error.message}`);
  if (!data?.value || !(data as any).updated_at) return null;
  try { return { env: JSON.parse(data.value) as EsignRequest, version: String((data as any).updated_at) }; } catch { return null; }
}

/** Writes only if the stored row is still `version`. Returns the new version, or null when another
 *  writer got there first (nothing is written). */
export async function saveRequestIfUnchanged(env: EsignRequest, version: string): Promise<string | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from("app_settings")
    .update({ value: JSON.stringify({ ...env, updated_at: nowIso }), updated_at: nowIso })
    .eq("key", KEY(env.token)).eq("updated_at", version)
    .select("updated_at");
  if (error) throw new Error(`Could not save the envelope: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) return null;
  env.updated_at = nowIso;
  return String((data[0] as any).updated_at);
}

/** Read → apply → compare-and-set, retried on conflict. `apply` is re-run against the FRESH row each
 *  time and returns false to skip the write (e.g. the envelope has since completed). */
export async function mutateRequest(token: string, apply: (env: EsignRequest) => boolean, tries = 4): Promise<{ env: EsignRequest; applied: boolean } | null> {
  for (let i = 0; i < tries; i++) {
    const row = await getRequestRow(token);
    if (!row) return null;
    if (!apply(row.env)) return { env: row.env, applied: false };
    if (await saveRequestIfUnchanged(row.env, row.version)) return { env: row.env, applied: true };
  }
  throw new Error("The envelope kept changing while it was being updated — please try again.");
}

export async function saveRecipientPointer(recipientToken: string, envelopeToken: string, recipientId: string): Promise<void> {
  await supabaseAdmin.from("app_settings").upsert(
    { key: RKEY(recipientToken), value: JSON.stringify({ env: envelopeToken, rid: recipientId }), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
}

// Resolve a recipient signing token → its envelope + the recipient, with the row version a caller
// needs for a compare-and-set write.
export async function getByRecipientToken(recipientToken: string): Promise<{ env: EsignRequest; recipient: Recipient; version: string } | null> {
  if (!recipientToken) return null;
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", RKEY(recipientToken)).maybeSingle();
  if (!data?.value) return null;
  let ptr: { env: string; rid: string };
  try { ptr = JSON.parse(data.value); } catch { return null; }
  const row = await getRequestRow(ptr.env);
  if (!row) return null;
  const recipient = (row.env.recipients || []).find((r) => r.id === ptr.rid);
  if (!recipient) return null;
  return { env: row.env, recipient, version: row.version };
}

// Sequential routing: the recipient whose turn it is to sign (lowest order not
// yet signed). Returns null if a signer declined, everyone has signed, or the
// envelope is finished.
export function activeRecipient(env: EsignRequest): Recipient | null {
  // A finished envelope has nobody's turn. Without this, a sender-completed envelope still
  // named its first unsigned recipient as active — their link would mark "viewed", alert the
  // team, and accept a signature on a document that already has a certificate.
  if (env.status === "completed" || env.status === "voided" || env.status === "declined") return null;
  const recips = [...(env.recipients || [])].sort((a, b) => a.order - b.order);
  for (const r of recips) {
    if (r.status === "declined") return null;
    if (r.status !== "signed") return r;
  }
  return null;
}

export function envelopeComplete(env: EsignRequest): boolean {
  return (env.recipients || []).length > 0 && (env.recipients || []).every((r) => r.status === "signed");
}

export async function listRequests(): Promise<EsignRequest[]> {
  const { data } = await supabaseAdmin.from("app_settings").select("value").like("key", "esign:%").limit(500);
  const out: EsignRequest[] = [];
  for (const r of (data || []) as { value: string }[]) {
    try { out.push(JSON.parse(r.value)); } catch { /* skip */ }
  }
  return out.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

// Public-safe projection for one recipient's signing page.
export function recipientView(env: EsignRequest, recipient: Recipient) {
  const active = activeRecipient(env);
  const yourTurn = active?.id === recipient.id;
  return {
    title: env.title,
    signer_name: recipient.name,
    status: recipient.status,
    envelopeStatus: env.status,
    signed: recipient.status === "signed",
    declined: recipient.status === "declined" || env.status === "declined",
    voided: env.status === "voided",
    // The sender finished it with the signatures already collected rather than waiting for everyone.
    closedBySender: env.status === "completed" && !!env.closed_by_sender,
    yourTurn,
    waitingFor: !yourTurn && env.status !== "completed" && active ? active.name : null,
    // only this recipient's fields are fillable; others shown read-only for context
    fields: (env.fields || []).map((f) => ({ ...f, mine: !f.recipientId || f.recipientId === recipient.id })),
  };
}

// VOIDING AN ENVELOPE — ONE IMPLEMENTATION, TWO CALLERS.
//
// The sender route and any operational script that has to kill a stale link must agree on what
// voiding MEANS, because the sign route enforces exactly one thing: `env.status === "voided"`.
// A second copy of this that set a different field, or logged nothing, would leave a link that
// still signs while the screen says it is dead.
//
// Already-voided is a SUCCESS, not an error, and does not add a second event — voiding twice is a
// normal thing to do to a list and should not litter the audit trail.
export type VoidOutcome =
  | { ok: true; env: EsignRequest; alreadyVoided: boolean }
  | { ok: false; reason: "not_found" | "completed" };

export async function voidEnvelope(token: string, reason?: string): Promise<VoidOutcome> {
  const detail = String(reason || "").slice(0, 300) || "Voided by sender";
  // A completed envelope is a signed document. Voiding it would contradict a Certificate of
  // Completion that has already been issued, so it is refused here and not just in the UI — and
  // re-checked on every retry, because a signature can complete it between the read and the write.
  const state = { completed: false, already: false };
  const out = await mutateRequest(token, (env) => {
    state.completed = env.status === "completed";
    state.already = env.status === "voided";
    if (state.completed || state.already) return false;
    env.status = "voided";
    env.events = [...(env.events || []), { type: "voided", at: new Date().toISOString(), detail }];
    return true;
  });
  if (!out) return { ok: false, reason: "not_found" };
  if (state.completed) return { ok: false, reason: "completed" };
  if (state.already) return { ok: true, env: out.env, alreadyVoided: true };

  const env = out.env;
  if (env.loan_file_id) {
    const { logActivity } = await import("@/lib/activity");
    await logActivity({
      entity_type: "loan_file", entity_id: env.loan_file_id, loan_file_id: env.loan_file_id,
      lead_id: env.lead_id || undefined, actor: "lo", action: "esign.voided",
      detail: { title: env.title, reason: detail },
    }).catch(() => {});
  }
  return { ok: true, env, alreadyVoided: false };
}

// FILING A SENDER-COMPLETED ENVELOPE ON ITS LOAN FILE — idempotent, and a retry repairs it.
//
// Keyed on (loan_file_id, storage_path): a row that already exists is never inserted twice, and a
// failed insert throws instead of vanishing. Because completing an already-completed envelope runs
// this again, pressing the button a second time is how a filing that failed gets repaired.
// Status "received", not "accepted": a document missing a signer is not reviewed-and-accepted just
// because the sender closed the envelope.
export async function fileSenderCompletionOnLoanFile(env: EsignRequest): Promise<number> {
  if (!env.loan_file_id || !env.closed_by_sender || !env.signed_path || !env.cert_path) return 0;
  const recips = env.recipients || [];
  const n = recips.filter((r) => r.status === "signed").length;
  const want = [
    { storage_path: env.signed_path, name: `Signed (${n} of ${recips.length} signers): ${env.title}`, file_name: `${env.title}.pdf` },
    { storage_path: env.cert_path, name: `Certificate of Completion (${n} of ${recips.length} signed): ${env.title}`, file_name: `${env.title}-certificate.pdf` },
  ];
  const { data: have, error: readErr } = await supabaseAdmin.from("loan_documents")
    .select("storage_path").eq("loan_file_id", env.loan_file_id).in("storage_path", want.map((w) => w.storage_path));
  if (readErr) throw new Error(`Could not check the loan file: ${readErr.message}`);
  const missing = want.filter((w) => !(have || []).some((h: any) => h.storage_path === w.storage_path));
  if (!missing.length) return 0;
  const { error } = await supabaseAdmin.from("loan_documents").insert(missing.map((w) => ({
    loan_file_id: env.loan_file_id, name: w.name, category: "Signed", required: false, status: "received",
    uploaded_by: "system", storage_path: w.storage_path, file_name: w.file_name,
  })));
  if (error) throw new Error(`Filing on the loan file failed: ${error.message}`);
  // No maybeAdvanceStage here, unlike the all-signed path: a document missing a signer is not
  // proof that whatever requirement it was sent for has been met.
  const { logActivity } = await import("@/lib/activity");
  await logActivity({
    entity_type: "loan_file", entity_id: env.loan_file_id, loan_file_id: env.loan_file_id,
    lead_id: env.lead_id || undefined, actor: "lo", action: "esign.completed_by_sender",
    detail: { title: env.title, signed: env.closed_by_sender.signed, not_signed: env.closed_by_sender.not_signed, note: env.closed_by_sender.reason, hash: (env.signed_hash || "").slice(0, 16) },
  }).catch(() => {});
  return missing.length;
}

// COMPLETING AN ENVELOPE WITH THE SIGNATURES ALREADY COLLECTED — ONE IMPLEMENTATION, TWO CALLERS.
//
// Ramon, 2026-09-15: he and Kelly Dorsey signed the 3545 Winthrop VOM on 8/26; the third
// recipient signed with his own DocuSign instead. The envelope sat "in progress" for three weeks
// and the only code that issued a Certificate of Completion ran when EVERY recipient had signed,
// so there was no way to prove the two signatures that did happen.
//
// This finishes an envelope on the sender's say-so, and the certificate says exactly that: "N of M
// signed", every recipient who did not sign printed NOT SIGNED, the sender's note printed as the
// sender's. The sender route and any operational script call this one function.
//
// Concurrency: the certificate goes to a NEW object per attempt and the envelope is saved only if
// it is still the version that was read. If a signer acted in between, nothing is overwritten —
// the attempt's certificate is deleted and the caller is told the envelope changed.
export type CompleteOutcome =
  | { ok: true; env: EsignRequest; alreadyCompleted: boolean; warning?: string }
  | { ok: false; reason: "not_found" | "voided" | "declined" | "nothing_signed" | "changed" };

const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

export async function completeWithSignaturesCollected(
  token: string,
  note?: string,
  // Test seam only: runs between building the certificate and the conditional save, so the verify
  // script can land a concurrent write in exactly the window the review found.
  hooks?: { beforeSave?: () => Promise<void> },
): Promise<CompleteOutcome> {
  const row = await getRequestRow(token);
  if (!row) return { ok: false, reason: "not_found" };
  const env = row.env;
  if (env.status === "completed") {
    const warning = await fileSenderCompletionOnLoanFile(env).then(() => undefined, (e: any) => String(e?.message || e));
    return { ok: true, env, alreadyCompleted: true, ...(warning ? { warning } : {}) };
  }
  if (env.status === "voided") return { ok: false, reason: "voided" };
  if (env.status === "declined") return { ok: false, reason: "declined" };

  const recips = [...(env.recipients || [])].sort((a, b) => a.order - b.order);
  const signed = recips.filter((r) => r.status === "signed");
  const unsigned = recips.filter((r) => r.status !== "signed");
  // A certificate certifies signatures. With none, there is nothing to certify — void it instead.
  if (!signed.length || !env.signed_path) return { ok: false, reason: "nothing_signed" };

  const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(ESIGN_BUCKET).download(env.signed_path);
  if (dlErr || !blob) throw new Error("Could not load the signed document.");
  const hash = sha256(Buffer.from(await blob.arrayBuffer()));

  const at = new Date().toISOString();
  const raw = String(note || "").replace(/\s+/g, " ").trim();
  const reason = raw ? (raw.length > 500 ? `${raw.slice(0, 500)}… [note truncated]` : raw) : null;
  const next: EsignRequest = JSON.parse(JSON.stringify(env));
  for (const r of next.recipients) if (r.status !== "signed") r.status = "not_signed";
  next.status = "completed";
  next.signed_hash = hash;
  next.closed_by_sender = { at, reason, signed: signed.map((r) => r.name), not_signed: unsigned.map((r) => r.name) };
  next.events = [
    ...(next.events || []),
    {
      type: "completed_by_sender", at,
      detail: `Completed by the sender with ${signed.length} of ${recips.length} signatures. Not signed: ${unsigned.map((r) => r.name).join(", ") || "none"}.${reason ? ` Sender's note: ${reason}` : ""}`,
    },
  ];

  const cert = await buildCertificate(next, hash);
  const cert_path = `esign/${env.token}/certificate-${Date.now()}.pdf`;
  const { error: upErr } = await supabaseAdmin.storage.from(ESIGN_BUCKET).upload(cert_path, Buffer.from(cert), { contentType: "application/pdf", upsert: false });
  if (upErr) throw new Error("Certificate upload failed: " + upErr.message);
  next.cert_path = cert_path;

  if (hooks?.beforeSave) await hooks.beforeSave();
  const saved = await saveRequestIfUnchanged(next, row.version);
  if (!saved) {
    await supabaseAdmin.storage.from(ESIGN_BUCKET).remove([cert_path]).catch(() => {});
    const now = await getRequestRow(token);
    if (now?.env.status === "completed") return { ok: true, env: now.env, alreadyCompleted: true };
    return { ok: false, reason: "changed" };
  }

  const warnings: string[] = [];
  // The bytes the certificate hashes must still be the bytes at signed_path. Signers write a new
  // object per attempt, so this cannot differ — unless something bypassed that. Say so loudly.
  const { data: again } = await supabaseAdmin.storage.from(ESIGN_BUCKET).download(next.signed_path!);
  if (!again || sha256(Buffer.from(await again.arrayBuffer())) !== hash) {
    const msg = `Integrity check failed: the stored signed document for ${next.token} no longer matches the SHA-256 on its certificate.`;
    console.error(`[esign/complete] ${msg}`);
    warnings.push(msg);
  }
  await fileSenderCompletionOnLoanFile(next).catch((e: any) => {
    console.error(`[esign/complete] filing ${next.token} on loan file ${next.loan_file_id}: ${e?.message}`);
    warnings.push(`Completed, but filing it on the loan file failed (${e?.message}). Press Complete again to retry the filing.`);
  });
  return { ok: true, env: next, alreadyCompleted: false, ...(warnings.length ? { warning: warnings.join(" ") } : {}) };
}

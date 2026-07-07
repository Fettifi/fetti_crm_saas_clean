// Built-in e-signature ("our own DocuSign"). Envelopes are stored as rows in the
// service-role-only app_settings table (keyed esign:<token>) — no public/anon
// access — and the source/signed PDFs live in the private loan-docs bucket.
// Multi-signer with a signing order; each recipient gets their own link
// (rcpt:<recipientToken> → envelope). Signing is ESIGN/UETA-style: explicit
// consent + intent + a stamped Certificate of Completion (audit trail).
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

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
  status: "pending" | "sent" | "viewed" | "signed" | "declined";
  // Email DELIVERY state (separate from signing status) — updated by the Resend
  // bounce/delivery webhook so a mistyped address auto-flips to "bounced".
  delivery?: "sent" | "delivered" | "bounced" | "complained";
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

export async function saveRecipientPointer(recipientToken: string, envelopeToken: string, recipientId: string): Promise<void> {
  await supabaseAdmin.from("app_settings").upsert(
    { key: RKEY(recipientToken), value: JSON.stringify({ env: envelopeToken, rid: recipientId }), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
}

// Resolve a recipient signing token → its envelope + the recipient.
export async function getByRecipientToken(recipientToken: string): Promise<{ env: EsignRequest; recipient: Recipient } | null> {
  if (!recipientToken) return null;
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", RKEY(recipientToken)).maybeSingle();
  if (!data?.value) return null;
  let ptr: { env: string; rid: string };
  try { ptr = JSON.parse(data.value); } catch { return null; }
  const env = await getRequest(ptr.env);
  if (!env) return null;
  const recipient = (env.recipients || []).find((r) => r.id === ptr.rid);
  if (!recipient) return null;
  return { env, recipient };
}

// Sequential routing: the recipient whose turn it is to sign (lowest order not
// yet signed). Returns null if a signer declined or everyone has signed.
export function activeRecipient(env: EsignRequest): Recipient | null {
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
    yourTurn,
    waitingFor: !yourTurn && env.status !== "completed" && active ? active.name : null,
    // only this recipient's fields are fillable; others shown read-only for context
    fields: (env.fields || []).map((f) => ({ ...f, mine: !f.recipientId || f.recipientId === recipient.id })),
  };
}

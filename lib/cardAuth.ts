// Per-borrower credit-card AUTHORIZATION (not a payment processor). The borrower
// e-signs a BLANKET authorization for this loan transaction (a set max amount) and
// provides a card the LO can key into the credit vendor. We retain the card number
// ENCRYPTED at rest (AES-256-GCM, same engine as SSNs) and NEVER store the CVV — PCI
// prohibits storing CVV, and a signed card-on-file authorization is the basis to charge.
import { encryptField, decryptField } from "@/lib/crypto";
import { BRAND } from "@/lib/brand";
import { signingSecret } from "@/lib/signingSecret";
import crypto from "crypto";

// SECURITY: bind each borrower's card-auth link to that borrower. The public link is
// /card-auth/<fileShareToken>?b=<index>; without binding, anyone holding the file token
// could iterate ?b to view/overwrite ANOTHER borrower-on-the-file's card entry (IDOR).
// The signature is an HMAC over (shareToken:index) with the app secret, so ?b can't be
// forged. Staff (session-gated /api/los/... routes) don't need it and don't pass it.
export function cardAuthSig(shareToken: string, index: number): string {
  return crypto.createHmac("sha256", signingSecret() + ":cardauth")
    .update(`${shareToken}:${index}`).digest("hex").slice(0, 32);
}
export function cardAuthSigValid(shareToken: string, index: number, sig: string | null | undefined): boolean {
  if (!sig) return false;
  const expected = cardAuthSig(shareToken, index);
  const a = Buffer.from(expected), b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type CardAuth = {
  amount: number;            // blanket max authorized for this loan transaction
  scope: string;             // human-readable scope
  status: "requested" | "authorized";
  requestedAt: string;
  borrowerName: string;
  // populated when the borrower submits + signs:
  cardholder?: string;
  brand?: string;
  last4?: string;
  expMonth?: string;
  expYear?: string;
  billingZip?: string;
  panEnc?: string;           // encrypted full PAN
  // CVV is SENSITIVE AUTHENTICATION DATA — PCI prohibits retaining it. We hold it ONLY
  // transiently (encrypted) so the LO can make the initial keyed charge, then AUTO-PURGE
  // it after `cvvExpiresAt` (or when the LO clears it). Never long-lived, never logged.
  cvvEnc?: string;
  cvvExpiresAt?: string;     // ISO; once passed, cvvEnc MUST be purged
  consentText?: string;
  signature?: string;        // typed full name
  signedAt?: string;
  signerIp?: string;
  revealedAt?: string;       // last time an LO revealed the full PAN (audit)
};

const digits = (s?: string) => String(s || "").replace(/\D/g, "");

export function cardBrand(pan?: string): string {
  const n = digits(pan);
  if (/^4/.test(n)) return "Visa";
  if (/^(5[1-5]|2(2[2-9]|[3-6][0-9]|7[01]|720))/.test(n)) return "Mastercard";
  if (/^3[47]/.test(n)) return "Amex";
  if (/^(6011|65|64[4-9]|622)/.test(n)) return "Discover";
  if (/^3(0[0-5]|[689])/.test(n)) return "Diners";
  if (/^35/.test(n)) return "JCB";
  return "Card";
}

export function luhnValid(pan?: string): boolean {
  const n = digits(pan);
  if (n.length < 12 || n.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = n.length - 1; i >= 0; i--) { let d = +n[i]; if (alt) { d *= 2; if (d > 9) d -= 9; } sum += d; alt = !alt; }
  return sum % 10 === 0;
}

export const last4 = (pan?: string) => digits(pan).slice(-4);
export const encryptPan = (pan?: string) => encryptField(digits(pan)) || "";
export const decryptPan = (enc?: string) => decryptField(enc);

// CVV RETENTION — RAMON'S CALL, MADE 2026-08-20, AND THE REASONING IS RECORDED HERE.
//
// The security code is RETAINED with the card, because CoreLogic's credit-report ordering
// requires it at transaction time and a credit pull frequently happens days after the
// borrower signs the authorization. A 48-hour clock meant the code was gone exactly when the
// file was ready to move, and re-asking the borrower every time is friction on a card they
// already provided for this purpose.
//
// What that accepts, stated plainly so nobody has to rediscover it: PCI DSS 3.2.2 prohibits
// retaining the card verification code after authorization, encrypted or not. This is a
// deliberate, informed business decision by the owner of the merchant account, not an
// oversight. If Fetti ever takes payments under a merchant agreement that is audited, or
// integrates a processor that tokenizes (which removes the need entirely — a stored
// credential is charged without a CVV), this should be revisited first.
//
// Because it IS retained, the compensating controls matter more, not less. All of these are
// live and must stay: AES-256-GCM at rest via the same engine as SSNs, per-borrower HMAC
// binding on the public link (no IDOR across borrowers on a file), session-gated staff
// routes, and an activity_log entry on every reveal. `clear_cvv` remains so the LO can drop a
// code the moment a file is done with it, and setting CARD_CVV_TTL_HOURS to a positive number
// restores automatic expiry without a code change.
export const CVV_RETAIN_BY_DEFAULT = true;
// 0 (or unset) = retain until explicitly cleared. A positive value re-enables auto-expiry.
export const CVV_TTL_HOURS = Number(process.env.CARD_CVV_TTL_HOURS || 0);
// A code the borrower re-supplies through the ?cvv=1 link is held the same way; the LO may
// still clear it immediately after keying the charge.
export const CVV_REFRESH_TTL_HOURS = Number(process.env.CARD_CVV_TTL_HOURS || 0);
/**
 * The expiry stamp to store with a code, or undefined to retain it.
 *
 * Every write must go through this. Stamping `Date.now() + 0` when the TTL is 0 would mark a
 * code expired the instant it was saved, and the next read would delete it — retention that
 * silently erases is worse than no retention at all.
 */
export function cvvExpiryStamp(hours = CVV_TTL_HOURS): string | undefined {
  return hours > 0 ? new Date(Date.now() + hours * 3600 * 1000).toISOString() : undefined;
}
export const encryptCvv = (cvv?: string) => encryptField(digits(cvv).slice(0, 4)) || "";
export const decryptCvv = (enc?: string) => decryptField(enc);
/** A code is usable when it exists and either carries no expiry (retained) or hasn't passed it. */
export const cvvLive = (a?: CardAuth): boolean =>
  !!(a?.cvvEnc && (!a.cvvExpiresAt || new Date(a.cvvExpiresAt).getTime() > Date.now()));
/**
 * Drop a CVV only when it carries an expiry that has actually passed.
 *
 * The previous version treated a MISSING cvvExpiresAt as "expired" and deleted the code, so
 * retention could never work by simply omitting the timestamp — the next read would erase it.
 * A record with no expiry is retained on purpose.
 */
export function purgeExpiredCvv(a?: CardAuth): CardAuth | undefined {
  if (a?.cvvEnc && a.cvvExpiresAt && new Date(a.cvvExpiresAt).getTime() <= Date.now()) {
    delete a.cvvEnc; delete a.cvvExpiresAt;
  }
  return a;
}

// The blanket authorization language the borrower e-signs.
export function blanketAuthText(fileNumber: string | undefined, amount: number): string {
  // A blanket card authorization MUST carry a dollar ceiling. This used to fall back to "the
  // amounts shown to me" whenever amount was 0 — and amount became 0 whenever the LO left the
  // box blank, because the panel and the route both did `Number(...) || 0`. The result: the LOS
  // showed "blanket up to $0" while the document the borrower actually e-signed authorized
  // charges with NO CEILING, revocable only in writing, against a PAN we store encrypted.
  //
  // Refusing here rather than defaulting is deliberate: this text is the signed instrument, and
  // there is no safe uncapped version of it. Callers must supply a real amount.
  if (!(amount > 0)) {
    throw new Error("blanketAuthText: a blanket card authorization requires a dollar ceiling — refusing to generate uncapped language.");
  }
  const amt = `$${Math.round(amount).toLocaleString()}`;
  return `I authorize ${BRAND.company} (NMLS #${BRAND.nmls}) to charge the credit/debit card I have provided for fees incurred in connection with my loan application${fileNumber ? ` (File ${fileNumber})` : ""} — including, but not limited to, the credit report fee, appraisal fee, and other third-party charges related to this loan transaction — up to a total of ${amt}. This is a BLANKET authorization that remains in effect for the duration of this loan transaction unless I revoke it in writing. I certify that I am the cardholder or am authorized to use this card.`;
}

// Read/write the per-borrower map on lead.raw.card_auths (keyed by borrower index).
export function getCardAuths(lead: any): Record<string, CardAuth> {
  const raw = lead?.raw && typeof lead.raw === "object" ? lead.raw : {};
  return raw.card_auths && typeof raw.card_auths === "object" ? raw.card_auths : {};
}

// Borrower-safe + LO-safe view of an auth (never includes the full PAN or CVV).
export function publicCardView(a?: CardAuth) {
  if (!a) return null;
  return {
    status: a.status, amount: a.amount, scope: a.scope, borrowerName: a.borrowerName,
    cardholder: a.cardholder, brand: a.brand, last4: a.last4,
    exp: a.expMonth && a.expYear ? `${a.expMonth}/${a.expYear}` : undefined,
    billingZip: a.billingZip, signedAt: a.signedAt, requestedAt: a.requestedAt, revealedAt: a.revealedAt,
    cvvOnFile: cvvLive(a), cvvExpiresAt: cvvLive(a) ? a.cvvExpiresAt : undefined,
  };
}

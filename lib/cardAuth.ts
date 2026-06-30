// Per-borrower credit-card AUTHORIZATION (not a payment processor). The borrower
// e-signs a BLANKET authorization for this loan transaction (a set max amount) and
// provides a card the LO can key into the credit vendor. We retain the card number
// ENCRYPTED at rest (AES-256-GCM, same engine as SSNs) and NEVER store the CVV — PCI
// prohibits storing CVV, and a signed card-on-file authorization is the basis to charge.
import { encryptField, decryptField } from "@/lib/crypto";
import { BRAND } from "@/lib/brand";

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

// CVV — transient only. Held encrypted for CVV_TTL_HOURS, then auto-purged.
export const CVV_TTL_HOURS = 48;
export const encryptCvv = (cvv?: string) => encryptField(digits(cvv).slice(0, 4)) || "";
export const decryptCvv = (enc?: string) => decryptField(enc);
export const cvvLive = (a?: CardAuth): boolean =>
  !!(a?.cvvEnc && a?.cvvExpiresAt && new Date(a.cvvExpiresAt).getTime() > Date.now());
// Drop an expired CVV from an auth record (mutates + returns it). Call on every read.
export function purgeExpiredCvv(a?: CardAuth): CardAuth | undefined {
  if (a?.cvvEnc && (!a.cvvExpiresAt || new Date(a.cvvExpiresAt).getTime() <= Date.now())) {
    delete a.cvvEnc; delete a.cvvExpiresAt;
  }
  return a;
}

// The blanket authorization language the borrower e-signs.
export function blanketAuthText(fileNumber: string | undefined, amount: number): string {
  const amt = amount > 0 ? `$${Math.round(amount).toLocaleString()}` : "the amounts shown to me";
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

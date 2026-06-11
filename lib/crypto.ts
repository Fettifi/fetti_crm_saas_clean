// Application-layer field encryption for the most sensitive PII (SSN), on top of
// the database provider's at-rest AES-256. Uses AES-256-GCM (authenticated) with
// a 32-byte key from SSN_ENCRYPTION_KEY (hex or base64). Values are stored as
// "enc:v1:<iv>:<tag>:<ciphertext>" (base64 parts). Backward compatible: legacy
// plaintext values are returned as-is on read and encrypted on the next save.
// Server-only (uses the node crypto module).
import crypto from "crypto";

const PREFIX = "enc:v1:";

function getKey(): Buffer | null {
  const k = process.env.SSN_ENCRYPTION_KEY;
  if (!k) return null;
  try {
    const buf = /^[0-9a-fA-F]{64}$/.test(k) ? Buffer.from(k, "hex") : Buffer.from(k, "base64");
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

export function encryptField(plain?: string | null): string | undefined {
  if (plain == null || plain === "") return plain == null ? undefined : "";
  if (typeof plain === "string" && plain.startsWith(PREFIX)) return plain; // already encrypted
  const key = getKey();
  if (!key) return String(plain); // no key configured -> rely on provider at-rest encryption
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return PREFIX + [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptField(val?: string | null): string | undefined {
  if (val == null || val === "") return val == null ? undefined : "";
  if (typeof val !== "string" || !val.startsWith(PREFIX)) return val ?? undefined; // legacy plaintext
  const key = getKey();
  if (!key) return undefined; // can't decrypt without the key; never leak ciphertext
  try {
    const parts = val.split(":"); // [enc, v1, iv, tag, ct]
    const iv = Buffer.from(parts[2], "base64");
    const tag = Buffer.from(parts[3], "base64");
    const ct = Buffer.from(parts[4], "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}

// Encrypt the SSN on every borrower in a URLA object (returns the same object).
export function encryptUrlaSsns<T extends { borrowers?: Array<{ ssn?: string }> }>(urla: T): T {
  if (urla && Array.isArray(urla.borrowers)) {
    urla.borrowers = urla.borrowers.map((b) => (b && b.ssn ? { ...b, ssn: encryptField(b.ssn) } : b));
  }
  return urla;
}

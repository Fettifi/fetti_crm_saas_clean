// Application-layer field encryption for the most sensitive PII (SSN), on top of
// the database provider's at-rest AES-256. Uses AES-256-GCM (authenticated) with
// a 32-byte key from SSN_ENCRYPTION_KEY (hex or base64). Values are stored as
// "enc:v1:<iv>:<tag>:<ciphertext>" (base64 parts). Backward compatible: legacy
// plaintext values are returned as-is on read and encrypted on the next save.
// Server-only (uses the node crypto module).
import crypto from "crypto";

const PREFIX = "enc:v1:";

type KeyState = "ok" | "missing" | "invalid";

// Fail-closed enforcement applies wherever real borrower PII is handled. Vercel sets
// NODE_ENV=production for BOTH production and preview/staging deploys, so any non-dev
// environment is treated as one that must NEVER write plaintext SSN/PAN.
function isEnforced(): boolean {
  return process.env.NODE_ENV === "production";
}

function keyState(): { key: Buffer | null; state: KeyState } {
  const k = process.env.SSN_ENCRYPTION_KEY;
  if (!k) return { key: null, state: "missing" };
  try {
    const buf = /^[0-9a-fA-F]{64}$/.test(k) ? Buffer.from(k, "hex") : Buffer.from(k, "base64");
    if (buf.length === 32) return { key: buf, state: "ok" };
    return { key: null, state: "invalid" };
  } catch {
    return { key: null, state: "invalid" };
  }
}

function getKey(): Buffer | null {
  return keyState().key;
}

// Boot-time health surface: lets a route/cron report the encryption posture without
// waiting for the first SSN write to reveal a misconfiguration. `ok` means field-level
// encryption is active; `enforced` means the plaintext fallback is DISABLED here.
export function encryptionKeyHealth(): { ok: boolean; state: KeyState; enforced: boolean } {
  const { state } = keyState();
  return { ok: state === "ok", state, enforced: isEnforced() };
}

// Surface a missing/malformed key at module load (server start) so the misconfiguration
// shows up loudly in logs immediately — not silently on the first borrower's SSN.
{
  const s = keyState().state;
  if (isEnforced() && s !== "ok") {
    console.error(`[crypto] STARTUP: SSN_ENCRYPTION_KEY is ${s} in a production/preview environment — sensitive fields will NOT be persisted until it is fixed`);
  }
}

export function encryptField(plain?: string | null): string | undefined {
  if (plain == null || plain === "") return plain == null ? undefined : "";
  if (typeof plain === "string" && plain.startsWith(PREFIX)) return plain; // already encrypted
  const { key, state } = keyState();
  if (!key) {
    // FAIL CLOSED: previously a missing/malformed key silently downgraded to plaintext,
    // defeating the whole point of app-layer encryption for SSN/PAN. In an enforced
    // (production/preview) environment we now REFUSE to persist the field — return
    // undefined so callers store null — and alert loudly, rather than writing plaintext PII.
    if (isEnforced()) {
      console.error(`[crypto] SSN_ENCRYPTION_KEY ${state} — refusing to persist sensitive field in plaintext; field dropped (returned undefined)`);
      return undefined;
    }
    // Local dev only: keep the plaintext fallback so developers aren't blocked, but log a
    // DISTINCT warning every time the fallback is taken so it can never pass unnoticed.
    console.warn(`[crypto] SSN_ENCRYPTION_KEY ${state} — storing sensitive field WITHOUT app-layer encryption (dev fallback only)`);
    return String(plain);
  }
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

// Shared HMAC for the screened-transfer decision webhook (whisper-call gate).
import "server-only";
import crypto from "crypto";
export function decisionToken(sid: string, secret: string): string {
  return crypto.createHmac("sha256", secret + ":transfer").update(sid).digest("hex").slice(0, 16);
}

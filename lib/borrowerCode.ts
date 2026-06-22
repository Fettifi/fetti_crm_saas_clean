// Human-readable, non-sensitive borrower code for identifying a loan file's
// secure link at a glance — e.g. "Jane Nicole Smith" -> "JNS-4821".
// The letters are the borrower's initials (up to 3); the 4 digits are a stable
// hash of the loan file id (NOT the birthday, SSN, or any real number tied to
// the person). Deterministic: same file always yields the same code, on both
// the server (email/SMS) and the client (display).
export function borrowerCode(name?: string | null, seed?: string | null): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  let initials = parts.slice(0, 3).map((p) => p[0]).join("").toUpperCase().replace(/[^A-Z]/g, "");
  if (!initials) initials = "BWR"; // borrower, when no name yet
  const str = String(seed || name || "fetti");
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const digits = String(h % 10000).padStart(4, "0");
  return `${initials}-${digits}`;
}

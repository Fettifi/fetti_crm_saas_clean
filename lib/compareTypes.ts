// Pure (client-safe) types + helpers for the Loan Comparison tool — NO server imports,
// so both the client page and server code can use them. The app_settings store lives
// in lib/compare.ts (which re-exports everything here).

export type CompareQuote = {
  id: string;
  lender?: string;          // "AD Mortgage"
  program?: string;         // "30-Yr Fixed DSCR" — used as the column header
  loanType?: string;        // Conventional | FHA | DSCR | ...
  loanAmount?: number;
  rate?: string;            // "6.875%"
  apr?: string;             // "7.012%"
  term?: string;            // "30-year fixed"
  monthlyPI?: string;       // "$2,431"
  pitia?: string;           // "$3,142" total monthly (PITIA)
  points?: string;          // "1.000" or "$2,000"
  lenderFees?: string;      // "$1,995"
  ltv?: string;             // "75%"
  cashToClose?: string;     // "$48,200"
  lockDays?: string;        // "45 days"
  prepay?: string;          // "5/4/3/2/1" | "None"
  occupancy?: string;
  purpose?: string;
  dscr?: string;            // "1.25"
  notes?: string;
  recommended?: boolean;
  sourceFile?: string;      // original PDF filename
};

export type Comparison = {
  id: string;
  number: string;           // CMP-YYYYMM-####
  borrowerName?: string;
  borrowerEmail?: string;
  leadId?: string | null;
  loanFileId?: string | null;
  note?: string;
  quotes: CompareQuote[];
  created_at: string;
  updated_at: string;
  emailed_to?: string[];
};

/** MERGE THE LIVE SCREEN OVER THE SAVED RECORD.
 *
 *  Both the PDF route and the email route used to do `b.id ? await getComparison(b.id) : draft`,
 *  which DISCARDS the entire posted body whenever the comparison has been saved once. The panel
 *  posts the live editor state on every action, so the sequence "save -> correct a rate -> email
 *  borrower" sent the borrower the stale saved version, with no error and no warning. That is the
 *  same screen/document divergence that had the pricer PDF quoting a different origination fee
 *  than the screen it came from — and here it reaches the borrower's inbox.
 *
 *  The posted body is what the loan officer is looking at, so it wins field by field. The stored
 *  record supplies only what the screen does not carry (creation time, prior recipients). */
export function mergeComparison(stored: Comparison | null, posted: any): Comparison {
  const p = posted || {};
  const has = (k: string) => p[k] !== undefined && p[k] !== null;
  const now = new Date().toISOString();
  return {
    id: stored?.id || p.id || "draft",
    number: stored?.number || p.number || "",
    // An explicitly cleared field ("" for a name or note) is an edit, not an absence — only
    // undefined/null falls back to the stored value.
    borrowerName: has("borrowerName") ? p.borrowerName : stored?.borrowerName,
    borrowerEmail: has("borrowerEmail") ? p.borrowerEmail : stored?.borrowerEmail,
    leadId: has("leadId") ? p.leadId : stored?.leadId ?? null,
    loanFileId: has("loanFileId") ? p.loanFileId : stored?.loanFileId ?? null,
    note: has("note") ? p.note : stored?.note,
    // Quotes are the document. Only fall back to storage when the caller sent no array at all
    // (a re-send of a saved comparison); an empty array is caught by the caller's own guard.
    quotes: Array.isArray(p.quotes) ? p.quotes : (stored?.quotes || []),
    created_at: stored?.created_at || p.created_at || now,
    updated_at: now,
    emailed_to: stored?.emailed_to || [],
  };
}

// The comparison-table rows (column header = the program/Option N). Order matters;
// a row renders only if at least one quote has a value for it.
export const COMPARE_ROWS: { label: string; key: keyof CompareQuote }[] = [
  { label: "Lender", key: "lender" },
  { label: "Loan type", key: "loanType" },
  { label: "Loan amount", key: "loanAmount" },
  { label: "Interest rate", key: "rate" },
  { label: "APR", key: "apr" },
  { label: "Term", key: "term" },
  { label: "Monthly P&I", key: "monthlyPI" },
  { label: "Est. total payment", key: "pitia" },
  { label: "Points", key: "points" },
  { label: "Lender fees", key: "lenderFees" },
  { label: "LTV", key: "ltv" },
  { label: "Cash to close", key: "cashToClose" },
  { label: "Rate lock", key: "lockDays" },
  { label: "Prepay penalty", key: "prepay" },
  { label: "DSCR", key: "dscr" },
  { label: "Occupancy", key: "occupancy" },
  { label: "Purpose", key: "purpose" },
];

// Editable keys in the UI (string inputs); loanAmount handled separately (numeric).
export const EDITABLE_STRING_KEYS: (keyof CompareQuote)[] = [
  "lender", "loanType", "rate", "apr", "term", "monthlyPI", "pitia", "points",
  "lenderFees", "ltv", "cashToClose", "lockDays", "prepay", "occupancy", "purpose", "dscr",
];

export function fmtMoney(n?: number | null): string {
  if (n == null || !isFinite(Number(n))) return "—";
  return "$" + Math.round(Number(n)).toLocaleString("en-US");
}

export function cellValue(q: CompareQuote, key: keyof CompareQuote): string {
  const v = q[key];
  if (v == null || v === "") return "—";
  if (key === "loanAmount") return fmtMoney(Number(v));
  return String(v);
}

export function genId(): string {
  return (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)).slice(0, 24);
}

export function comparisonNumber(): string {
  const d = new Date();
  return `CMP-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}-${Math.floor(1000 + Math.random() * 9000)}`;
}

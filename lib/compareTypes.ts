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

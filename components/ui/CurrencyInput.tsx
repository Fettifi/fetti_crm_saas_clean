"use client";

// Shared money/currency input for the whole CRM. Shows a "$" prefix and live
// thousands separators (1,250,000) as you type, so dollar amounts are always
// clear and mistake-proof. It DISPLAYS commas but emits a clean numeric string
// (digits only, e.g. "1250000") via onChange — so callers and the backend keep
// storing plain numbers, no parsing changes needed.
//
// Usage:  <CurrencyInput value={f.loan_amount} onChange={(v) => set("loan_amount", v)} className={field} />
import React from "react";

function formatDisplay(value: string | number | null | undefined, allowCents: boolean): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (s === "") return "";
  s = s.replace(/[^\d.]/g, "");
  if (!allowCents) s = s.replace(/\./g, "");
  const dot = s.indexOf(".");
  const intRaw = dot === -1 ? s : s.slice(0, dot);
  const dec = dot === -1 ? "" : s.slice(dot + 1).replace(/\./g, "");
  const intPart = intRaw.replace(/^0+(?=\d)/, "");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (dot !== -1) return `${grouped || "0"}.${dec.slice(0, 2)}`;
  return grouped;
}

// Strip to a clean numeric string the rest of the app already understands.
function toClean(input: string, allowCents: boolean): string {
  let s = input.replace(/[^\d.]/g, "");
  if (!allowCents) return s.replace(/\./g, "");
  const dot = s.indexOf(".");
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "");
  return s;
}

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: string | number | null | undefined;
  onChange: (cleanNumericString: string) => void;
  allowCents?: boolean;
};

export default function CurrencyInput({ value, onChange, allowCents = false, className = "", style, ...rest }: Props) {
  return (
    <div className="relative">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-current opacity-50 text-sm pointer-events-none select-none">$</span>
      <input
        {...rest}
        type="text"
        inputMode={allowCents ? "decimal" : "numeric"}
        value={formatDisplay(value, allowCents)}
        onChange={(e) => onChange(toClean(e.target.value, allowCents))}
        className={className}
        // Inline padding beats the className's px-* so the "$" never overlaps text.
        style={{ paddingLeft: "1.5rem", ...style }}
      />
    </div>
  );
}

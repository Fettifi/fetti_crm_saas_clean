"use client";

// Public, printable mortgage pre-approval letter (shareable token link).
// Branded with the Fetti logo and tuned to print on a single US-Letter sheet.
import { use, useEffect, useState } from "react";
import { Printer, Loader2 } from "lucide-react";
import { LICENSING_NOTE } from "@/lib/legal";

type Letter = {
  letter_number: string; borrower_name: string; co_borrower?: string; loan_type?: string;
  purchase_price?: number; loan_amount?: number; down_payment?: number; interest_rate?: string; term?: string;
  property_address?: string; occupancy?: string; conditions?: string; officer_name?: string; officer_nmls?: string;
  status: string; expires_on?: string; created_at: string;
};

const money = (n?: number | null) => (n == null ? "—" : "$" + Math.round(n).toLocaleString());
const date = (s?: string) => (s ? new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "—");

export default function LetterPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [l, setL] = useState<Letter | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch(`/api/letter/${token}`).then((r) => r.ok ? r.json() : Promise.reject()).then((j) => { setL(j.letter); setLoading(false); }).catch(() => { setMissing(true); setLoading(false); });
  }, [token]);

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-100"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (missing || !l) return <div className="min-h-screen flex items-center justify-center bg-slate-100 text-slate-500 px-6 text-center">This pre-approval letter link is invalid or has been removed.</div>;

  const voided = l.status === "void";
  const expired = l.expires_on && new Date(l.expires_on) < new Date();

  return (
    <div className="min-h-screen bg-slate-100 py-6 px-4 print:bg-white print:p-0">
      {/* Print rules: one US-Letter sheet, no UI chrome, render colors. */}
      <style>{`
        @media print {
          @page { size: letter portrait; margin: 0.5in; }
          html, body { background: #fff !important; }
          .print-hide { display: none !important; }
          .sheet { box-shadow: none !important; border-radius: 0 !important; padding: 0 !important; max-width: 100% !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="max-w-[760px] mx-auto">
        <div className="flex justify-end mb-3 print-hide">
          <button onClick={() => window.print()} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-lg">
            <Printer className="w-4 h-4" /> Print / Save as PDF
          </button>
        </div>

        <div className="sheet bg-white text-slate-900 shadow-lg rounded-lg px-9 py-8 relative">
          {(voided || expired) && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-[110px] font-black text-red-500/10 rotate-[-25deg] select-none">{voided ? "VOID" : "EXPIRED"}</span>
            </div>
          )}

          {/* Letterhead with logo */}
          <div className="border-b-2 border-emerald-600 pb-3 flex items-end justify-between">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/fetti-logo.png" alt="Fetti Financial Services" className="h-12 w-12 rounded-md object-contain" />
              <div>
                <div className="text-xl font-extrabold text-emerald-700 leading-tight">Fetti Financial Services LLC</div>
                <div className="text-[10px] text-slate-500">NMLS #2267023 · CA DFPI Financing Law License #60DBO-153798</div>
              </div>
            </div>
            <div className="text-right text-[10px] text-slate-500">
              <div className="font-mono">{l.letter_number}</div>
              <div>{date(l.created_at)}</div>
            </div>
          </div>

          <h1 className="text-lg font-bold mt-5 text-center tracking-wide">MORTGAGE PRE-APPROVAL LETTER</h1>

          <p className="mt-4 text-[13.5px] leading-relaxed">To Whom It May Concern,</p>
          <p className="mt-2 text-[13.5px] leading-relaxed">
            This letter confirms that <b>{l.borrower_name}</b>{l.co_borrower ? <> and <b>{l.co_borrower}</b></> : null} {l.co_borrower ? "have" : "has"} been
            <b> pre-approved</b> by Fetti Financial Services LLC for mortgage financing based on a preliminary review of the
            information provided, subject to the conditions below.
          </p>

          {/* Terms table */}
          <div className="mt-4 border border-slate-200 rounded-md overflow-hidden text-[13px]">
            {[
              ["Loan program", l.loan_type || "—"],
              ["Approved loan amount (up to)", money(l.loan_amount)],
              ["Estimated purchase price", money(l.purchase_price)],
              ["Down payment", money(l.down_payment)],
              ["Loan term", l.term || "—"],
              ["Estimated rate", l.interest_rate || "Subject to market at lock"],
              ["Occupancy", l.occupancy || "—"],
              ["Subject property", l.property_address || "To be determined"],
            ].map(([k, v], i) => (
              <div key={k as string} className={`flex justify-between px-3 py-1.5 ${i % 2 ? "bg-slate-50" : ""}`}>
                <span className="text-slate-500">{k}</span><span className="font-medium text-right">{v}</span>
              </div>
            ))}
          </div>

          {l.conditions && (
            <div className="mt-3 text-[12.5px]">
              <span className="font-semibold">Conditions: </span>
              <span className="text-slate-700">{l.conditions}</span>
            </div>
          )}

          <p className="mt-3 text-[11.5px] leading-relaxed text-slate-600">
            This pre-approval is <b>not a commitment to lend</b> and is contingent upon: verification of income, assets, and
            employment; a satisfactory property appraisal; clear title; acceptable property insurance; an acceptable
            contract of sale; and final underwriting approval. Rates and programs are subject to change until locked. Valid
            through <b>{date(l.expires_on)}</b>.
          </p>

          {/* Signature */}
          <div className="mt-6 text-[13.5px]">
            <div>Sincerely,</div>
            <div className="mt-5 font-semibold">{l.officer_name || "Fetti Financial Services LLC"}</div>
            <div className="text-[10px] text-slate-500">Mortgage Loan Originator{l.officer_nmls ? ` · NMLS #${l.officer_nmls}` : ""} · Fetti Financial Services LLC</div>
          </div>

          <div className="mt-5 pt-3 border-t border-slate-200 text-[9px] text-slate-400 leading-snug">
            🏠 Equal Housing Opportunity. {LICENSING_NOTE}
          </div>
        </div>
      </div>
    </div>
  );
}

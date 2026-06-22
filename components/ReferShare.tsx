"use client";
// Share controls for the referral loop — copy link, SMS, email, X, Facebook.
// Used on the post-conversion success states and the /refer/<code> page.
import { useState } from "react";
import { referralLink, referralShareText } from "@/lib/referral";

export default function ReferShare({ code, compact = false }: { code: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const link = referralLink(code);
  const text = referralShareText(code);
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ } };
  const btn = "flex-1 text-center text-sm font-semibold px-3 py-2 rounded-lg border border-slate-300 hover:border-emerald-400 hover:bg-emerald-50 text-slate-800 transition";
  const sms = `sms:?&body=${encodeURIComponent(text)}`;
  const email = `mailto:?subject=${encodeURIComponent("Check out Fetti for your mortgage")}&body=${encodeURIComponent(text)}`;
  const x = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  const fb = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`;

  return (
    <div className={compact ? "" : "mt-4"}>
      <div className="flex items-center gap-2">
        <input readOnly value={link} onClick={(e) => e.currentTarget.select()} className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 font-mono" />
        <button onClick={copy} className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm px-4 py-2 rounded-lg whitespace-nowrap">{copied ? "✓ Copied" : "Copy"}</button>
      </div>
      <div className="flex gap-2 mt-2">
        <a href={sms} className={btn}>Text</a>
        <a href={email} className={btn}>Email</a>
        <a href={x} target="_blank" rel="noreferrer" className={btn}>Post on X</a>
        <a href={fb} target="_blank" rel="noreferrer" className={btn}>Facebook</a>
      </div>
    </div>
  );
}

"use client";

// Cookie-consent banner (CCPA/CPRA notice-at-collection + opt-out). Shows once per
// visitor unless they've already chosen or their browser sends a GPC/DNT opt-out
// signal (which we auto-honor as "essential only"). The choice gates the marketing
// pixels in TrackingPixels.tsx.
import { useEffect, useState } from "react";
import { getConsent, setConsent, gpcOptedOut } from "@/lib/consent";

export default function ConsentBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!gpcOptedOut() && getConsent() === null) setShow(true);
  }, []);

  if (!show) return null;
  const choose = (v: "all" | "essential") => { setConsent(v); setShow(false); };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] p-3 sm:p-4 pointer-events-none">
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white/95 backdrop-blur shadow-xl p-4 sm:flex sm:items-center sm:gap-4 pointer-events-auto">
        <p className="text-xs text-slate-600 leading-relaxed">
          We use cookies — <strong>essential</strong> ones to run the site, plus <strong>analytics &amp; advertising</strong> cookies
          to understand traffic and show you relevant Fetti info. Accept all, or keep only essential.
          See our <a href="/privacy" className="text-emerald-700 underline">Privacy Policy</a> and{" "}
          <a href="/privacy#choices" className="text-emerald-700 underline">your privacy choices</a>.
        </p>
        <div className="flex gap-2 mt-3 sm:mt-0 shrink-0">
          <button onClick={() => choose("essential")} className="text-xs font-medium px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 whitespace-nowrap">Essential only</button>
          <button onClick={() => choose("all")} className="text-xs font-semibold px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 whitespace-nowrap">Accept all</button>
        </div>
      </div>
    </div>
  );
}

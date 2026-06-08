"use client";

// Reusable address field with built-in verification. Verifies on blur / Enter
// (or the Verify button), shows a ✓ standardized result + "View on map" link,
// and lets the user accept the standardized address. Falls back gracefully —
// an unverifiable address can still be used.
import { useState } from "react";
import { MapPin, Check, Loader2, ExternalLink, AlertTriangle } from "lucide-react";

type Result = { verified: boolean; standardized?: string; mapsUrl: string; city?: string; state?: string; zip?: string };

export default function AddressInput({
  value, onChange, onVerified, placeholder = "Property address", className = "",
}: {
  value: string; onChange: (v: string) => void; onVerified?: (r: Result) => void; placeholder?: string; className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);

  async function verify() {
    const q = (value || "").trim();
    if (q.length < 5) { setRes(null); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/verify-address?q=${encodeURIComponent(q)}`);
      const j = (await r.json()) as Result;
      setRes(j);
      onVerified?.(j);
    } finally { setBusy(false); }
  }

  const cls = className || "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none";

  return (
    <div>
      <div className="relative">
        <MapPin className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={value}
          onChange={(e) => { onChange(e.target.value); setRes(null); }}
          onBlur={verify}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); verify(); } }}
          placeholder={placeholder}
          className={cls.replace("px-3", "pl-9 pr-20")}
        />
        <button type="button" onClick={verify} disabled={busy}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : "Verify"}
        </button>
      </div>

      {res && (
        <div className="mt-1.5 text-[11px]">
          {res.verified ? (
            <div className="flex flex-wrap items-center gap-2 text-emerald-400">
              <span className="flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Verified</span>
              {res.standardized && res.standardized.toLowerCase() !== value.trim().toLowerCase() && (
                <button type="button" onClick={() => { onChange(res.standardized!); }} className="text-indigo-300 hover:underline">
                  use “{res.standardized}”
                </button>
              )}
              <a href={res.mapsUrl} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-white flex items-center gap-0.5"><ExternalLink className="w-3 h-3" /> view on map</a>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-amber-400/80">
              <AlertTriangle className="w-3.5 h-3.5" /> Couldn&apos;t verify — you can still use it.
              <a href={res.mapsUrl} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-white flex items-center gap-0.5"><ExternalLink className="w-3 h-3" /> map</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

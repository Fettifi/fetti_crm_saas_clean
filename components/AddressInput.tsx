"use client";

// Reusable address field. With a Google Maps key set, it shows live Google
// Places autocomplete (type → dropdown of real addresses). Either way it then
// verifies/standardizes via /api/verify-address (free Census/OSM) and offers a
// "view on map" link. Degrades gracefully if Google is unavailable.
import { useEffect, useRef, useState } from "react";
import { MapPin, Check, Loader2, ExternalLink, AlertTriangle } from "lucide-react";

type Result = { verified: boolean; standardized?: string; mapsUrl: string; city?: string; state?: string; zip?: string };
const GKEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;

export default function AddressInput({
  value, onChange, onVerified, onResolved, placeholder = "Property address", className = "",
}: {
  value: string; onChange: (v: string) => void; onVerified?: (r: Result) => void;
  onResolved?: (r: { street?: string; city?: string; state?: string; zip?: string; formatted?: string }) => void;
  placeholder?: string; className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [sugs, setSugs] = useState<string[]>([]);
  // The key is a Vercel "Sensitive" var (not inlined at build), so fetch it at runtime.
  const [gkey, setGkey] = useState<string | null>(GKEY || null);
  const timer = useRef<any>(null);
  useEffect(() => {
    if (gkey) return;
    let on = true;
    fetch("/api/places/key").then((r) => r.json()).then((j) => { if (on && j?.key) setGkey(j.key); }).catch(() => {});
    return () => { on = false; };
  }, [gkey]);

  async function fetchSuggestions(input: string) {
    if (!gkey || input.trim().length < 3) { setSugs([]); return; }
    try {
      const r = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": gkey },
        body: JSON.stringify({ input, includedRegionCodes: ["us"] }),
      });
      const j = await r.json();
      const list = (j.suggestions || []).map((s: any) => s.placePrediction?.text?.text).filter(Boolean).slice(0, 5);
      setSugs(list);
    } catch { setSugs([]); }
  }

  function handleChange(v: string) {
    onChange(v); setRes(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fetchSuggestions(v), 300);
  }

  // Hand the caller the PARSED, standardized address — street line on its own PLUS
  // city/state/zip — so a verified address fills structured fields completely (e.g. it
  // populates the whole 1003 property/borrower address, not just the street).
  function emit(r: Result, fallback: string) {
    const std = r.standardized || fallback;
    const street = std.split(",")[0]?.trim() || std;
    onResolved?.({ formatted: std, street, city: r.city, state: r.state, zip: r.zip });
  }

  async function verify(addr?: string) {
    const q = (addr ?? value ?? "").trim();
    if (q.length < 5) { setRes(null); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/verify-address?q=${encodeURIComponent(q)}`);
      const j = (await r.json()) as Result;
      setRes(j); onVerified?.(j); emit(j, q);
    } finally { setBusy(false); }
  }

  function pick(addr: string) {
    onChange(addr); setSugs([]); verify(addr);
  }

  const cls = className || "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none";

  return (
    <div className="relative">
      <div className="relative">
        <MapPin className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 z-10" />
        <input
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={() => { setTimeout(() => setSugs([]), 150); verify(); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setSugs([]); verify(); } }}
          placeholder={placeholder}
          className={cls.replace("px-3", "pl-9 pr-20")}
          autoComplete="off"
        />
        <button type="button" onClick={() => { setSugs([]); verify(); }} disabled={busy}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : "Verify"}
        </button>
      </div>

      {sugs.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
          {sugs.map((s) => (
            <button key={s} type="button" onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" /> {s}
            </button>
          ))}
        </div>
      )}

      {res && (
        <div className="mt-1.5 text-[11px]">
          {res.verified ? (
            <div className="flex flex-wrap items-center gap-2 text-emerald-400">
              <span className="flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Verified</span>
              {res.standardized && res.standardized.toLowerCase() !== value.trim().toLowerCase() && (
                <button type="button" onClick={() => { onChange(res.standardized!.split(",")[0]?.trim() || res.standardized!); emit(res, value); }} className="text-indigo-300 hover:underline">use “{res.standardized}”</button>
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

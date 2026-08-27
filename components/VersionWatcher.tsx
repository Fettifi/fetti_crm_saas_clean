"use client";
// TELL THE APP WHEN IT IS RUNNING OLD CODE.
//
// 2026-08-26. Three rounds of "still not working" on a feature that was deployed and working:
// the CRM is installed as a Chrome web app, and a single-page app that is never reloaded keeps
// running the JS it booted with. Navigation between pages is client-side, so the document is
// never re-fetched and last week's bundle survives indefinitely. The HTTP cache headers were
// already correct (`max-age=0, must-revalidate`) — nothing was cached wrongly. The app simply
// never asked again.
//
// So it asks. /api/version already reports the deployed commit; this remembers the one the app
// booted with and compares. On a mismatch it offers a reload — never forces one, because a
// forced refresh mid-form would throw away whatever was being typed.
import { useEffect, useRef, useState } from "react";

const POLL_MS = 5 * 60 * 1000;

export default function VersionWatcher() {
  const boot = useRef<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        // cache: "no-store" or this check would itself be answered from cache — a staleness
        // detector that can be served a stale answer detects nothing.
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const { sha } = await r.json();
        if (!sha || !alive) return;
        if (!boot.current) { boot.current = sha; return; }
        if (sha !== boot.current) setStale(true);
      } catch { /* offline or mid-deploy — try again on the next tick */ }
    };
    check();
    const t = setInterval(check, POLL_MS);
    // Coming back to the window is the cheapest moment to notice, and the likeliest one to
    // matter: it is when someone returns after a deploy has landed.
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => { alive = false; clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, []);

  if (!stale) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 rounded-full border border-emerald-500/40 bg-slate-900/95 px-4 py-2 shadow-lg backdrop-blur">
      <span className="text-xs text-slate-200">A newer version of Fetti is available.</span>
      <button
        onClick={() => window.location.reload()}
        className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-emerald-500"
      >
        Reload
      </button>
      <button onClick={() => setStale(false)} className="text-xs text-slate-500 hover:text-slate-300" aria-label="Dismiss">
        Later
      </button>
    </div>
  );
}

"use client";

// Caller ID Lookup — the "phone is ringing, who is this?" tool.
// Type a number → instant answer from three layers:
//   1. CRM match (they're already a lead — name, stage, last touch, open thread)
//   2. Carrier caller ID (Twilio CNAM: registered name, mobile/voip/landline, carrier)
//   3. Deep web sweep (Google + AI: who the number belongs to, spam reports)
// The fast layers render immediately; the web sweep streams in a beat later, so
// Ramon has a verdict before the second ring.
import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, Search, Loader2, ShieldAlert, ShieldCheck, Globe, Users, BadgeInfo, ExternalLink } from "lucide-react";

type Flag = { label: string; level: "danger" | "warn" | "ok" };
type CrmMatch = {
  id: string; name: string; email: string | null; stage: string | null; tier: string | null;
  score: number | null; loan_purpose: string | null; state: string | null; source: string | null;
  created_at: string; lastActivity: { action: string; at: string } | null;
};
type CallerId = { callerName: string | null; callerType: string | null; lineType: string; carrier: string | null; valid: boolean };
type WebIntel = { who: string | null; summary: string; spamLikely: boolean; confidence: string; sources: { title: string; url: string }[] };
type LookupRes = { ok: true; pretty: string; e164: string; crm: CrmMatch[]; callerId: CallerId | null; flags: Flag[]; web?: WebIntel | null };

const RECENT_KEY = "fetti:lookup:recent";

function formatAsTyped(v: string): string {
  if (v.trim().startsWith("+")) return v.trim(); // international: leave alone
  const d = v.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86400_000);
  if (d > 30) return new Date(iso).toLocaleDateString();
  if (d >= 1) return `${d}d ago`;
  const h = Math.floor(ms / 3600_000);
  if (h >= 1) return `${h}h ago`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m ago`;
}

const LINE_TYPE_LABEL: Record<string, string> = {
  mobile: "Mobile", landline: "Landline", nonFixedVoip: "VoIP (internet)", fixedVoip: "VoIP (fixed/business)",
  tollFree: "Toll-free", premium: "Premium", pager: "Pager", voicemail: "Voicemail", sharedCost: "Shared-cost",
  unknown: "Unknown line", invalid: "INVALID",
};

export default function LookupPage() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [deepBusy, setDeepBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<LookupRes | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0); // ignore stale responses when a new search starts mid-flight

  useEffect(() => {
    try { setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) || "[]")); } catch { /* fresh */ }
    inputRef.current?.focus();
  }, []);

  const run = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    const seq = ++seqRef.current;
    setBusy(true); setDeepBusy(true); setError(null); setRes(null);
    try {
      const r = await fetch(`/api/lookup?phone=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (seq !== seqRef.current) return;
      if (!r.ok || !j.ok) { setError(j.error || "Lookup failed — try again."); setBusy(false); setDeepBusy(false); return; }
      setRes(j); setBusy(false);
      try {
        const next = [j.pretty, ...JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").filter((x: string) => x !== j.pretty)].slice(0, 8);
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
        setRecent(next);
      } catch { /* cosmetic */ }
      // Deep web sweep rides behind the fast answer.
      const dr = await fetch(`/api/lookup?phone=${encodeURIComponent(q)}&deep=1`);
      const dj = await dr.json();
      if (seq !== seqRef.current) return;
      if (dr.ok && dj.ok) setRes(dj);
    } catch {
      if (seq === seqRef.current) setError("Lookup failed — check the connection and try again.");
    } finally {
      if (seq === seqRef.current) { setBusy(false); setDeepBusy(false); }
    }
  }, []);

  const identity = res
    ? (res.crm[0]?.name || res.callerId?.callerName || res.web?.who || null)
    : null;
  const identitySource = res
    ? (res.crm[0] ? "Matched in your CRM" : res.callerId?.callerName ? "Carrier caller ID" : res.web?.who ? "Web match" : null)
    : null;
  const danger = res?.flags.some((f) => f.level === "danger") || res?.web?.spamLikely;

  const chip = (f: Flag, i: number) => (
    <span key={i} className={
      "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border " +
      (f.level === "danger" ? "bg-red-500/10 border-red-500/40 text-red-300"
        : f.level === "warn" ? "bg-amber-500/10 border-amber-500/40 text-amber-300"
        : "bg-emerald-500/10 border-emerald-500/40 text-emerald-300")
    }>
      {f.level === "ok" ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}{f.label}
    </span>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Phone className="w-6 h-6 text-emerald-400" /> Caller ID Lookup</h1>
        <p className="text-slate-400 text-sm mt-1">Phone ringing? Type the number — see who it actually is before you pick up.</p>

        <form
          className="mt-5 flex gap-2"
          onSubmit={(e) => { e.preventDefault(); run(input); }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(formatAsTyped(e.target.value))}
            onPaste={(e) => {
              // Paste-and-go: pasting a full number searches immediately.
              const t = formatAsTyped(e.clipboardData.getData("text"));
              if (t.replace(/\D/g, "").length >= 10) { e.preventDefault(); setInput(t); run(t); }
            }}
            inputMode="tel"
            placeholder="(213) 555-0123"
            className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-xl tracking-wide placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            disabled={busy || input.replace(/\D/g, "").length < 10}
            className="px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed font-semibold flex items-center gap-2"
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />} Look up
          </button>
        </form>

        {recent.length > 0 && !res && !busy && (
          <div className="mt-3 flex flex-wrap gap-2">
            {recent.map((r) => (
              <button key={r} onClick={() => { setInput(r); run(r); }} className="text-xs px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-slate-400 hover:border-slate-600">
                {r}
              </button>
            ))}
          </div>
        )}

        {error && <div className="mt-5 bg-red-500/10 border border-red-500/40 text-red-300 rounded-xl p-4 text-sm">{error}</div>}

        {res && (
          <div className="mt-5 space-y-4">
            {/* Verdict banner */}
            <div className={"rounded-2xl p-5 border " + (danger ? "bg-red-500/5 border-red-500/40" : "bg-slate-900/40 border-slate-800")}>
              <div className="text-xs uppercase tracking-wide text-slate-500">{res.pretty}</div>
              <div className="text-2xl font-bold mt-1">
                {identity || (deepBusy ? "No name yet — checking the web…" : "No name found for this number")}
              </div>
              {identitySource && <div className="text-sm text-emerald-400 mt-0.5">{identitySource}</div>}
              <div className="mt-3 flex flex-wrap gap-2">
                {res.callerId && (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
                    <BadgeInfo className="w-3 h-3" />{LINE_TYPE_LABEL[res.callerId.lineType] || res.callerId.lineType}{res.callerId.carrier ? ` · ${res.callerId.carrier}` : ""}
                  </span>
                )}
                {res.flags.map(chip)}
                {res.web?.spamLikely && chip({ label: "Spam reports found online", level: "danger" }, 999)}
              </div>
            </div>

            {/* CRM matches */}
            {res.crm.length > 0 && (
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
                <div className="text-xs uppercase tracking-wide text-slate-500 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> In your pipeline</div>
                <div className="mt-3 space-y-3">
                  {res.crm.map((l) => (
                    <div key={l.id} className="flex items-start justify-between gap-3 border border-slate-800 rounded-xl p-3">
                      <div className="min-w-0">
                        <div className="font-semibold">{l.name}</div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {[l.stage && `Stage: ${l.stage}`, l.tier && `Tier ${l.tier}`, l.loan_purpose, l.state, l.source && `via ${l.source}`].filter(Boolean).join(" · ")}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Lead since {new Date(l.created_at).toLocaleDateString()}
                          {l.lastActivity ? ` · last touch ${ago(l.lastActivity.at)} (${l.lastActivity.action})` : " · never contacted"}
                        </div>
                      </div>
                      <a href={`/leads?leadId=${encodeURIComponent(l.id)}`} className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-semibold">
                        Open thread →
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Carrier caller ID */}
            {res.callerId && (
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
                <div className="text-xs uppercase tracking-wide text-slate-500 flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Carrier caller ID</div>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><div className="text-slate-500 text-xs">Registered name</div><div className="font-medium">{res.callerId.callerName || "—"}</div></div>
                  <div><div className="text-slate-500 text-xs">Type</div><div className="font-medium">{res.callerId.callerType === "BUSINESS" ? "Business" : res.callerId.callerType === "CONSUMER" ? "Person" : "—"}</div></div>
                  <div><div className="text-slate-500 text-xs">Line</div><div className="font-medium">{LINE_TYPE_LABEL[res.callerId.lineType] || res.callerId.lineType}</div></div>
                  <div><div className="text-slate-500 text-xs">Carrier</div><div className="font-medium">{res.callerId.carrier || "—"}</div></div>
                </div>
              </div>
            )}

            {/* Web intel */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
              <div className="text-xs uppercase tracking-wide text-slate-500 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> Web sweep</div>
              {deepBusy && !res.web ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /> Searching the web for this number…</div>
              ) : res.web ? (
                <div className="mt-2">
                  <p className="text-sm text-slate-200">{res.web.summary}</p>
                  {res.web.sources.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {res.web.sources.slice(0, 5).map((s, i) => (
                        <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 truncate">
                          <ExternalLink className="w-3 h-3 shrink-0" />{s.title || s.url}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500">Web sweep unavailable for this search.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

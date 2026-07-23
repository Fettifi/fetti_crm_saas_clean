"use client";

// Caller ID Lookup — the "phone is ringing, who is this?" tool.
// Type a number → instant answer from stacked layers:
//   1. CRM match (leads + active loan files — name, stage, last touch, open it)
//   2. Carrier caller ID (Twilio CNAM: registered name, mobile/voip/landline)
//   3. Number geography (area code → home metro, instant)
//   4. Deep sweep: Google Maps reverse lookup (businesses are indexed by phone),
//      web search, and carrier identification — who services the line and where
//      THEY are, clearly separated from who is calling (an "…LLC" carrier on a
//      lookup is the phone company, never the caller).
// Fast layers render immediately; the sweep streams in a beat later, so Ramon
// has a verdict before the second ring.
import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, Search, Loader2, ShieldAlert, ShieldCheck, Globe, Users, BadgeInfo, ExternalLink, MapPin, Building2, FileText, Signal } from "lucide-react";

type Flag = { label: string; level: "danger" | "warn" | "ok" };
type CrmMatch = {
  id: string; name: string; email: string | null; stage: string | null; tier: string | null;
  score: number | null; loan_purpose: string | null; state: string | null; source: string | null;
  created_at: string; lastActivity: { action: string; at: string } | null;
};
type CrmFile = {
  id: string; fileNumber: string | null; borrowerName: string | null; product: string | null;
  propertyAddress: string | null; stage: string | null; status: string | null; leadId: string | null; created_at: string;
};
type CallerId = { callerName: string | null; callerType: string | null; lineType: string; carrier: string | null; valid: boolean };
type CarrierIntel = { name: string; what: string; hq: string | null; kind: string };
type Place = { name: string; address: string; phone: string | null; website: string | null; category: string | null; rating: number | null };
type WebIntel = {
  who: string | null; whoType: string; callerLocation: string | null; summary: string;
  spamLikely: boolean; confidence: string; sources: { title: string; url: string }[];
  places: Place[]; carrier: CarrierIntel | null;
};
type LookupRes = {
  ok: true; pretty: string; e164: string; location: string | null;
  crm: CrmMatch[]; crmFiles: CrmFile[]; callerId: CallerId | null;
  carrierIntel: CarrierIntel | null; flags: Flag[]; web?: WebIntel | null;
};

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

// Mirrors lib/phoneLookup carrierHint (can't import — that module is server-only).
function hintForKind(kind: string): string | null {
  if (kind === "mobile") return "Consumer mobile carrier — most likely a real person's cell.";
  if (kind === "cable" || kind === "landline") return "Home or business line from a mainstream carrier.";
  if (kind === "cloud-voip" || kind === "wholesale-voip")
    return "Internet-phone number: this company is just the phone company servicing the line — the actual caller is a customer of some app or calling service. Also the most common setup behind robocalls.";
  return null;
}

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
      // Deep sweep rides behind the fast answer.
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

  const bestPlace = res?.web?.places?.[0] || null;
  const identity = res
    ? (res.crm[0]?.name || res.crmFiles[0]?.borrowerName || res.callerId?.callerName || res.web?.who || bestPlace?.name || null)
    : null;
  const identitySource = res
    ? (res.crm[0] || res.crmFiles[0] ? "Matched in your CRM"
      : res.callerId?.callerName ? "Carrier caller ID"
      : res.web?.who || bestPlace ? "Web / Google Maps match" : null)
    : null;
  const whereLine = res
    ? (res.web?.callerLocation || bestPlace?.address || res.location || null)
    : null;
  const danger = res?.flags.some((f) => f.level === "danger") || res?.web?.spamLikely;
  const carrier = res?.carrierIntel || res?.web?.carrier || null;
  const carrierNote = carrier ? hintForKind(carrier.kind) : null;

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
              <div className="text-2xl font-bold mt-1 flex items-center gap-2">
                {res.web?.whoType === "business" || bestPlace ? <Building2 className="w-5 h-5 text-slate-400 shrink-0" /> : null}
                {identity || (deepBusy ? "No name yet — sweeping the web…" : "Caller identity not publicly known")}
              </div>
              {identitySource && <div className="text-sm text-emerald-400 mt-0.5">{identitySource}{res.web?.confidence && identitySource.startsWith("Web") ? ` · ${res.web.confidence} confidence` : ""}</div>}
              {whereLine && (
                <div className="text-sm text-slate-300 mt-1.5 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-500" />{whereLine}
                  {!res.web?.callerLocation && !bestPlace && res.location ? <span className="text-slate-500">(area-code region)</span> : null}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {res.callerId && (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
                    <BadgeInfo className="w-3 h-3" />{LINE_TYPE_LABEL[res.callerId.lineType] || res.callerId.lineType}
                  </span>
                )}
                {res.flags.map(chip)}
                {res.web?.spamLikely && chip({ label: "Spam reports found online", level: "danger" }, 999)}
              </div>
              {/* Carrier explainer — kills the "who is Horizon LLC?" confusion */}
              {(carrier || res.callerId?.carrier) && (
                <div className="mt-3 text-xs text-slate-400 border-t border-slate-800 pt-2.5 flex items-start gap-1.5">
                  <Signal className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-500" />
                  <span>
                    Line serviced by <span className="text-slate-200 font-medium">{carrier?.name || res.callerId?.carrier}</span>
                    {carrier ? <> — {carrier.what}{carrier.hq ? ` (HQ: ${carrier.hq})` : ""}</> : null}.
                    {carrierNote ? <span className="text-slate-500"> {carrierNote}</span> : <span className="text-slate-500"> This is the phone company, not the caller.</span>}
                  </span>
                </div>
              )}
            </div>

            {/* CRM matches — leads */}
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

            {/* CRM matches — loan files */}
            {res.crmFiles.length > 0 && (
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
                <div className="text-xs uppercase tracking-wide text-slate-500 flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Active loan file</div>
                <div className="mt-3 space-y-3">
                  {res.crmFiles.map((f) => (
                    <div key={f.id} className="flex items-start justify-between gap-3 border border-slate-800 rounded-xl p-3">
                      <div className="min-w-0">
                        <div className="font-semibold">{f.borrowerName || "Borrower"}{f.fileNumber ? <span className="text-slate-500 font-normal"> · {f.fileNumber}</span> : null}</div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {[f.product, f.propertyAddress, f.stage && `Stage: ${f.stage}`, f.status].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <a href={`/los/${encodeURIComponent(f.id)}/1003`} className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-semibold">
                        Open file →
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Google Maps business matches */}
            {res.web && res.web.places.length > 0 && (
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
                <div className="text-xs uppercase tracking-wide text-slate-500 flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Google Maps match</div>
                <div className="mt-3 space-y-3">
                  {res.web.places.slice(0, 3).map((p, i) => (
                    <div key={i} className="border border-slate-800 rounded-xl p-3">
                      <div className="font-semibold">{p.name}{p.category ? <span className="text-slate-500 font-normal"> · {p.category}</span> : null}</div>
                      <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5"><MapPin className="w-3 h-3 shrink-0" />{p.address}</div>
                      <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-3">
                        {p.phone && <span>Listed: {p.phone}</span>}
                        {p.rating != null && <span>★ {p.rating}</span>}
                        {p.website && <a href={p.website} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300 inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" />site</a>}
                      </div>
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
                  <div><div className="text-slate-500 text-xs">Number based in</div><div className="font-medium">{res.location || "—"}</div></div>
                </div>
                {!res.callerId.callerName && (
                  <p className="mt-2.5 text-xs text-slate-500">No registered name in the carrier database — normal for VoIP, prepaid, and app-issued numbers. The web sweep below digs further.</p>
                )}
              </div>
            )}

            {/* Web sweep */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
              <div className="text-xs uppercase tracking-wide text-slate-500 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> Web sweep</div>
              {deepBusy && !res.web ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /> Checking Google Maps, spam databases, and the open web…</div>
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

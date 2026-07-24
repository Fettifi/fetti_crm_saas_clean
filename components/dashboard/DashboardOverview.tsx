"use client";

// Real dashboard overview — live leads, loan files, loan volume ($), and
// potential earnings at an ADJUSTABLE margin you set right here. Pulls
// /api/dashboard; the % is editable and saved as the company default.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Users, FolderOpen, DollarSign, TrendingUp, Check } from "lucide-react";
import AutomationsWidget from "@/components/dashboard/AutomationsWidget";
import ReferralStatsWidget from "@/components/dashboard/ReferralStatsWidget";

type Stats = {
  marginPct: number;
  leads: { total: number; new7d: number; today: number; tier1: number; tier2: number; tier3: number };
  files: { total: number; active: number; funded: number; byStage: Record<string, number> };
  volume: { pipeline: number; funded: number; leadRequested: number; total: number };
  recentLeads: { id: string; name: string; purpose: string; tier: string | null; stage: string; amount: number; created_at: string }[];
  recentFiles: { id: string; borrower: string; stage: string; amount: number; created_at: string }[];
  // Completed 1003s with no documents yet (optional: older API payloads lack it).
  appsAwaitingDocs?: { id: string; name: string; purpose: string; tier: string | null; stage: string; amount: number; created_at: string }[];
  // Tier-1/2 leads contacted but stalled pre-Application (optional on older payloads).
  stalledHighValue?: { id: string; name: string; purpose: string; tier: string | null; stage: string; amount: number; created_at: string }[];
};

const money = (n: number) => "$" + Math.round(n || 0).toLocaleString();
const compact = (n: number) => {
  n = n || 0;
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return "$" + Math.round(n / 1e3) + "k";
  return "$" + Math.round(n);
};
const STAGE_ORDER = ["Application", "Processing", "Underwriting", "Approved", "Clear to Close", "Funded", "Closed"];

export default function DashboardOverview() {
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [margin, setMargin] = useState(2.75);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/dashboard");
        if (!r.ok) throw new Error("Couldn't load dashboard.");
        const j = await r.json();
        setS(j); setMargin(Number(j.marginPct) || 2.75);
      } catch (e: any) { setErr(e?.message || "error"); }
    })();
  }, []);

  async function saveMargin() {
    setSaving(true); setSaved(false);
    try {
      const r = await fetch("/api/settings/margin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pct: margin }) });
      if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); }
    } catch { /* */ }
    setSaving(false);
  }

  if (err) return <div className="text-sm text-amber-300 p-4">⚠️ {err}</div>;
  if (!s) return <div className="text-slate-400 text-sm flex items-center gap-2 p-4"><Loader2 className="w-4 h-4 animate-spin" /> Loading live numbers…</div>;

  const earn = (v: number) => (v || 0) * (margin / 100);

  const Card = ({ icon, label, children }: { icon: any; label: string; children: any }) => (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500 mb-2">
        <span className="text-emerald-400">{icon}</span> {label}
      </div>
      {children}
    </div>
  );

  const ago = (iso: string) => {
    const h = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3600000));
    if (h < 1) return "just now";
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    return d === 1 ? "yesterday" : `${d}d ago`;
  };
  const apps = s.appsAwaitingDocs || [];
  const stalled = s.stalledHighValue || [];

  return (
    <div className="space-y-4">
      {/* Completed applications with no docs yet — the hottest follow-ups in the
          building. Loud and first: a finished 1003 must never be invisible just
          because the borrower hasn't uploaded a document yet. */}
      {apps.length > 0 && (
        <div className="bg-gradient-to-br from-amber-950/40 to-slate-900/50 border border-amber-700/50 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-wide text-amber-400">📋 Completed applications — awaiting documents ({apps.length})</div>
            <Link href="/leads" className="text-[11px] text-amber-400 hover:underline">All leads →</Link>
          </div>
          <div className="space-y-2">
            {apps.map((l) => (
              <Link key={l.id} href={`/leads?leadId=${l.id}`} className="flex items-center justify-between gap-2 border-b border-amber-900/30 pb-2 text-sm hover:bg-slate-900/40 rounded px-1">
                <div className="min-w-0">
                  <div className="font-medium truncate text-white">{l.name} {l.tier === "Tier 1" && <span className="text-[10px] font-bold text-amber-300 bg-amber-500/15 rounded-full px-1.5 py-0.5 align-middle">🔥 TIER 1</span>}</div>
                  <div className="text-[11px] text-slate-400 truncate">{l.purpose} · application done, no docs yet · {ago(l.created_at)}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-slate-300">{l.amount ? compact(l.amount) : "—"}</div>
                  <div className="text-[10px] text-amber-400">Follow up →</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* High-value leads going cold — Tier-1/2 that were contacted but never
          reached Application. The Enterprise Brain's standing #1 bottleneck:
          the best deals stall unseen while 0 loans fund. Work these first. */}
      {stalled.length > 0 && (
        <div className="bg-gradient-to-br from-sky-950/40 to-slate-900/50 border border-sky-700/50 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-wide text-sky-400">❄️ High-value leads going cold ({stalled.length})</div>
            <Link href="/leads" className="text-[11px] text-sky-400 hover:underline">All leads →</Link>
          </div>
          <div className="space-y-2">
            {stalled.map((l) => (
              <Link key={l.id} href={`/leads?leadId=${l.id}`} className="flex items-center justify-between gap-2 border-b border-sky-900/30 pb-2 text-sm hover:bg-slate-900/40 rounded px-1">
                <div className="min-w-0">
                  <div className="font-medium truncate text-white">{l.name} {l.tier === "Tier 1"
                    ? <span className="text-[10px] font-bold text-amber-300 bg-amber-500/15 rounded-full px-1.5 py-0.5 align-middle">🔥 TIER 1</span>
                    : <span className="text-[10px] font-bold text-sky-300 bg-sky-500/15 rounded-full px-1.5 py-0.5 align-middle">TIER 2</span>}</div>
                  <div className="text-[11px] text-slate-400 truncate">{l.purpose} · {l.stage.toLowerCase()} · no app yet · {ago(l.created_at)}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-slate-300">{l.amount ? compact(l.amount) : "—"}</div>
                  <div className="text-[10px] text-sky-400">Follow up →</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card icon={<Users className="w-4 h-4" />} label="Leads">
          <div className="text-3xl font-bold text-white">{s.leads.total.toLocaleString()}</div>
          <div className="text-xs text-emerald-400 mt-1">+{s.leads.new7d} this week · {s.leads.today} today</div>
          <div className="flex gap-1.5 mt-3 text-[11px]">
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">T1 {s.leads.tier1}</span>
            <span className="px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300">T2 {s.leads.tier2}</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-300">T3 {s.leads.tier3}</span>
          </div>
        </Card>

        <Card icon={<FolderOpen className="w-4 h-4" />} label="Loan files">
          <div className="text-3xl font-bold text-white">{s.files.active.toLocaleString()}<span className="text-base text-slate-500 font-normal"> active</span></div>
          <div className="text-xs text-slate-400 mt-1">{s.files.funded} funded · {s.files.total} total</div>
          <Link href="/los" className="inline-block mt-3 text-[11px] text-emerald-400 hover:underline">Open LOS →</Link>
        </Card>

        <Card icon={<DollarSign className="w-4 h-4" />} label="Loan volume (pipeline)">
          <div className="text-3xl font-bold text-white" title={money(s.volume.pipeline)}>{compact(s.volume.pipeline)}</div>
          <div className="text-xs text-slate-400 mt-1">Funded: <span className="text-slate-200">{compact(s.volume.funded)}</span></div>
          <div className="text-[11px] text-slate-500 mt-2">Lead requests: {compact(s.volume.leadRequested)}</div>
        </Card>

        <Card icon={<TrendingUp className="w-4 h-4" />} label={`Potential earnings · ${margin}%`}>
          <div className="text-3xl font-bold text-emerald-400" title={money(earn(s.volume.pipeline))}>{compact(earn(s.volume.pipeline))}</div>
          <div className="text-xs text-slate-400 mt-1">Earned (funded): <span className="text-emerald-300">{compact(earn(s.volume.funded))}</span></div>
          <div className="text-[11px] text-slate-500 mt-2">If all leads fund: {compact(earn(s.volume.leadRequested))}</div>
        </Card>
      </div>

      {/* Earnings calculator — adjustable margin */}
      <div className="bg-gradient-to-br from-emerald-950/30 to-slate-900/50 border border-emerald-800/40 rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-wide text-emerald-400">💰 Earnings calculator</div>
          <div className="flex items-center gap-3">
            <label className="text-sm text-slate-300">We make</label>
            <div className="flex items-center bg-slate-950 border border-slate-700 rounded-lg overflow-hidden">
              <input type="number" step={0.05} min={0} max={100} value={margin}
                onChange={(e) => setMargin(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                className="w-20 bg-transparent px-3 py-1.5 text-right text-white text-sm focus:outline-none" />
              <span className="px-2 text-slate-400 text-sm">%</span>
            </div>
            <span className="text-sm text-slate-400">per loan</span>
            <button onClick={saveMargin} disabled={saving}
              className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : null}
              {saved ? "Saved" : "Save as default"}
            </button>
          </div>
        </div>
        <input type="range" min={0} max={5} step={0.05} value={Math.min(margin, 5)}
          onChange={(e) => setMargin(Number(e.target.value))}
          className="w-full mt-4 accent-emerald-500" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          {[
            ["Pipeline earnings", earn(s.volume.pipeline), "active loan files"],
            ["Already earned", earn(s.volume.funded), "funded files"],
            ["If all leads fund", earn(s.volume.leadRequested), "lead requests"],
          ].map(([label, val, sub]) => (
            <div key={label as string} className="bg-slate-900/60 border border-slate-800 rounded-xl px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">{label as string}</div>
              <div className="text-2xl font-bold text-emerald-400 mt-1" title={money(val as number)}>{compact(val as number)}</div>
              <div className="text-[10px] text-slate-500">{sub as string} · at {margin}%</div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-500 mt-3">Adjust the % to model different margins — earnings recalc instantly. "Save as default" sets it as the company rate going forward.</p>
      </div>

      {/* Pipeline by stage */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">Pipeline by stage</div>
        <div className="flex flex-wrap gap-2">
          {STAGE_ORDER.map((st) => (
            <div key={st} className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2 text-center min-w-[92px]">
              <div className="text-lg font-bold text-white">{s.files.byStage[st] || 0}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">{st}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Recent leads</div>
            <Link href="/leads" className="text-[11px] text-emerald-400 hover:underline">All leads →</Link>
          </div>
          <div className="space-y-2">
            {s.recentLeads.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 border-b border-slate-800/50 pb-2 text-sm">
                <div className="min-w-0"><div className="font-medium truncate text-slate-200">{l.name}</div><div className="text-[11px] text-slate-500 truncate">{l.purpose} · {l.stage}</div></div>
                <div className="text-right shrink-0">{l.tier && <div className="text-[10px] text-emerald-400">{l.tier}</div>}<div className="text-xs text-slate-400">{l.amount ? compact(l.amount) : "—"}</div></div>
              </div>
            ))}
            {!s.recentLeads.length && <div className="text-slate-600 text-sm">No leads yet.</div>}
          </div>
        </div>

        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Active loan files</div>
            <Link href="/los" className="text-[11px] text-emerald-400 hover:underline">Open LOS →</Link>
          </div>
          <div className="space-y-2">
            {s.recentFiles.map((f) => (
              <Link key={f.id} href={`/los/${f.id}`} className="flex items-center justify-between gap-2 border-b border-slate-800/50 pb-2 text-sm hover:bg-slate-900/40 rounded px-1">
                <div className="min-w-0"><div className="font-medium truncate text-slate-200">{f.borrower}</div><div className="text-[11px] text-slate-500">{f.stage}</div></div>
                <div className="text-xs text-slate-400 shrink-0">{f.amount ? compact(f.amount) : "—"}</div>
              </Link>
            ))}
            {!s.recentFiles.length && <div className="text-slate-600 text-sm">No active files yet.</div>}
          </div>
        </div>
      </div>

      {/* Existing real widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <AutomationsWidget />
        <ReferralStatsWidget />
      </div>
    </div>
  );
}

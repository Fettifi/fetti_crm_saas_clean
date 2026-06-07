"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Trophy } from "lucide-react";

type Stats = {
  leads: { today: number; week: number; total: number; tier1: number; tier2: number; tier3: number };
  nurture: { active: number; contacted: number };
  sources: { source: string; count: number }[];
  partners: { name: string; code: string; leads: number; tier1: number }[];
  agentRuns: number;
};

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-3xl font-extrabold text-emerald-400 mt-1">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

export default function CommandPage() {
  const [s, setS] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/stats");
    setS(await res.json());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">⚡ Command Center</h1>
            <p className="text-slate-400 text-sm mt-1">Your whole lead machine at a glance.</p>
          </div>
          <button onClick={load} className="flex items-center gap-2 text-sm bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        {loading && !s && <div className="text-slate-500 mt-10 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}

        {s && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
              <Stat label="New leads today" value={s.leads.today} />
              <Stat label="This week" value={s.leads.week} />
              <Stat label="Total leads" value={s.leads.total} />
              <Stat label="In nurture queue" value={s.nurture.active} sub={`${s.nurture.contacted} contacted`} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              {/* Tier mix */}
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">Lead quality</div>
                {[["Tier 1", s.leads.tier1, "bg-emerald-500"], ["Tier 2", s.leads.tier2, "bg-yellow-500"], ["Tier 3", s.leads.tier3, "bg-slate-600"]].map(([label, n, color]) => {
                  const total = Math.max(1, s.leads.total);
                  return (
                    <div key={label as string} className="mb-2">
                      <div className="flex justify-between text-xs text-slate-400"><span>{label as string}</span><span>{n as number}</span></div>
                      <div className="h-2 bg-slate-800 rounded mt-1"><div className={`h-2 rounded ${color as string}`} style={{ width: `${((n as number) / total) * 100}%` }} /></div>
                    </div>
                  );
                })}
                <div className="text-xs text-slate-500 mt-3">🧠 {s.agentRuns} AI agent runs total</div>
              </div>

              {/* Sources */}
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">Lead sources</div>
                {s.sources.length === 0 && <div className="text-slate-600 text-sm">No leads yet.</div>}
                {s.sources.map((x) => (
                  <div key={x.source} className="flex justify-between text-sm py-1 border-b border-slate-800/50 last:border-0">
                    <span className="text-slate-300">{x.source.replace(/_/g, " ")}</span>
                    <span className="text-slate-400">{x.count}</span>
                  </div>
                ))}
              </div>

              {/* Top partners */}
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">Top referral partners</div>
                {s.partners.length === 0 && <div className="text-slate-600 text-sm">No referred leads yet.</div>}
                {s.partners.map((p, i) => (
                  <div key={p.code} className="flex items-center justify-between text-sm py-1.5 border-b border-slate-800/50 last:border-0">
                    <span className="flex items-center gap-2">
                      {i === 0 ? <Trophy className="w-4 h-4 text-yellow-400" /> : <span className="text-slate-600 w-4 text-center">{i + 1}</span>}
                      {p.name}
                    </span>
                    <span className="text-xs text-slate-400">{p.leads} · <span className="text-emerald-400">{p.tier1} T1</span></span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

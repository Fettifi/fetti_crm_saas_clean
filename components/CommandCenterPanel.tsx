"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Trophy, Brain, Target } from "lucide-react";

type Stats = {
  leads: { today: number; week: number; total: number; tier1: number; tier2: number; tier3: number };
  nurture: { active: number; contacted: number };
  sources: { source: string; count: number }[];
  partners: { name: string; code: string; leads: number; tier1: number }[];
  agentRuns: number;
  wizard?: {
    sessions: number; contacts: number; completes: number;
    summary: string | null; insights: string[]; recommendations: string[]; learnedAt: string | null;
  };
  org?: {
    summary: string | null;
    north_star: { label: string; target: number; current: number; progress_pct: number; on_track: boolean } | null;
    insights: string[]; priorities: string[]; learnedAt: string | null;
    los: { total: number; active: number; funded: number; pipeline: Record<string, number> };
  };
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

export default function CommandCenterPanel() {
  const [s, setS] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const [learning, setLearning] = useState(false);
  async function load() {
    setLoading(true);
    const res = await fetch("/api/stats");
    setS(await res.json());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function runCoach() {
    setLearning(true);
    try { await fetch("/api/cron/wizard-learn", { method: "POST" }); await load(); }
    finally { setLearning(false); }
  }
  const [thinking, setThinking] = useState(false);
  const [tasks, setTasks] = useState<{ id: string; title: string; source: string }[]>([]);
  async function loadTasks() {
    const r = await fetch("/api/tasks"); const j = await r.json(); setTasks(j.open || []);
  }
  useEffect(() => { loadTasks(); }, []);
  async function completeTask(id: string) {
    setTasks((t) => t.filter((x) => x.id !== id));
    await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: "done" }) });
  }
  async function runBrain() {
    setThinking(true);
    try { await fetch("/api/cron/org-learn", { method: "POST" }); await load(); await loadTasks(); }
    finally { setThinking(false); }
  }

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
            {/* Enterprise Brain — the whole company toward one goal */}
            <div className="bg-gradient-to-br from-indigo-600/15 to-slate-900/0 border border-indigo-500/30 rounded-2xl p-5 mt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Target className="w-5 h-5 text-indigo-400" />
                  <span className="font-semibold">Enterprise Brain</span>
                  <span className="text-xs text-slate-500">learns from every action · one goal</span>
                </div>
                <button onClick={runBrain} disabled={thinking}
                  className="flex items-center gap-2 text-xs bg-indigo-600/80 hover:bg-indigo-500 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                  {thinking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
                  {thinking ? "Thinking…" : "Think now"}
                </button>
              </div>

              {s.org?.north_star && (
                <div className="mt-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-300">🎯 {s.org.north_star.label}</span>
                    <span className={s.org.north_star.on_track ? "text-emerald-400" : "text-amber-400"}>
                      {s.org.north_star.current}/{s.org.north_star.target} · {Math.round(s.org.north_star.progress_pct)}%
                    </span>
                  </div>
                  <div className="h-2.5 bg-slate-800 rounded mt-1.5"><div className={`h-2.5 rounded ${s.org.north_star.on_track ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${Math.min(100, s.org.north_star.progress_pct)}%` }} /></div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 mt-4">
                <div className="bg-slate-950/40 rounded-xl p-3 text-center"><div className="text-2xl font-bold">{s.org?.los.active ?? 0}</div><div className="text-[11px] text-slate-500">active loan files</div></div>
                <div className="bg-slate-950/40 rounded-xl p-3 text-center"><div className="text-2xl font-bold text-emerald-400">{s.org?.los.funded ?? 0}</div><div className="text-[11px] text-slate-500">funded</div></div>
                <div className="bg-slate-950/40 rounded-xl p-3 text-center"><div className="text-2xl font-bold">{s.org?.los.total ?? 0}</div><div className="text-[11px] text-slate-500">total files</div></div>
              </div>

              {s.org?.summary ? (
                <>
                  <p className="text-sm text-slate-200 mt-4">🧠 {s.org.summary}</p>
                  {tasks.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Action items — check off as you go</div>
                      <div className="space-y-1.5">
                        {tasks.map((t) => (
                          <label key={t.id} className="flex items-start gap-2 text-sm cursor-pointer group">
                            <input type="checkbox" onChange={() => completeTask(t.id)} className="mt-0.5 accent-emerald-500" />
                            <span className="text-indigo-200/90 group-hover:text-white">{t.title}{t.source === "brain" && <span className="ml-1 text-[10px] text-indigo-400/60">brain</span>}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  {s.org.learnedAt && <div className="text-[11px] text-slate-600 mt-3">Last reasoned {new Date(s.org.learnedAt).toLocaleString()}</div>}
                </>
              ) : (
                <p className="text-sm text-slate-500 mt-4">The brain learns from every lead, message, agent run, and document across the CRM — then tells the team the highest-leverage next moves toward {s.org?.north_star?.target ?? 20} funded loans/month. Hit “Think now” once you have activity.</p>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
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

            {/* Application Coach — the learning agent behind the wizard */}
            <div className="bg-slate-900/40 border border-indigo-500/30 rounded-2xl p-5 mt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-indigo-400" />
                  <span className="font-semibold">Application Coach</span>
                  <span className="text-xs text-slate-500">learns from the wizard</span>
                </div>
                <button onClick={runCoach} disabled={learning}
                  className="flex items-center gap-2 text-xs bg-indigo-600/80 hover:bg-indigo-500 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                  {learning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
                  {learning ? "Learning…" : "Run now"}
                </button>
              </div>

              {s.wizard && (
                <div className="grid grid-cols-3 gap-3 mt-4">
                  <div className="bg-slate-950/40 rounded-xl p-3 text-center">
                    <div className="text-2xl font-bold">{s.wizard.sessions}</div>
                    <div className="text-[11px] text-slate-500">sessions (14d)</div>
                  </div>
                  <div className="bg-slate-950/40 rounded-xl p-3 text-center">
                    <div className="text-2xl font-bold text-emerald-400">{s.wizard.contacts}</div>
                    <div className="text-[11px] text-slate-500">reached contact</div>
                  </div>
                  <div className="bg-slate-950/40 rounded-xl p-3 text-center">
                    <div className="text-2xl font-bold text-emerald-400">{s.wizard.completes}</div>
                    <div className="text-[11px] text-slate-500">completed 1003</div>
                  </div>
                </div>
              )}

              {s.wizard?.summary ? (
                <>
                  <p className="text-sm text-slate-200 mt-4">🧠 {s.wizard.summary}</p>
                  {s.wizard.insights.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">What it has learned</div>
                      <ul className="list-disc list-inside text-sm text-slate-300 space-y-1">
                        {s.wizard.insights.map((x, i) => <li key={i}>{x}</li>)}
                      </ul>
                    </div>
                  )}
                  {s.wizard.recommendations.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Recommended changes</div>
                      <ul className="list-disc list-inside text-sm text-amber-300/90 space-y-1">
                        {s.wizard.recommendations.map((x, i) => <li key={i}>{x}</li>)}
                      </ul>
                    </div>
                  )}
                  {s.wizard.learnedAt && <div className="text-[11px] text-slate-600 mt-3">Last learned {new Date(s.wizard.learnedAt).toLocaleString()}</div>}
                </>
              ) : (
                <p className="text-sm text-slate-500 mt-4">No lessons yet — the Coach learns automatically each day once applicants start flowing through the wizard, and reorders questions + tips to lift completions. Hit “Run now” once you have a few sessions.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

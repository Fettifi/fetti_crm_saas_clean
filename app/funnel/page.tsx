"use client";

// Funnel drop-off dashboard — see exactly where applicants leak, step by step,
// from "Started" through every wizard question to "Application complete".
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

function ago(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return "just now";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function FunnelPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/funnel?days=${days}`);
    if (r.ok) setData(await r.json());
    setLoading(false);
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const runNow = useCallback(async () => {
    setRunning(true); setRunResult(null);
    try {
      const r = await fetch("/api/funnel/run-nurture", { method: "POST" });
      setRunResult(await r.json());
      await load();
    } catch (e: any) {
      setRunResult({ ok: false, error: e?.message || "Run failed." });
    } finally {
      setRunning(false);
    }
  }, [load]);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-4xl mx-auto">
        <Link href="/leads" className="text-slate-400 hover:text-white text-sm">← CRM</Link>
        <div className="flex items-center justify-between gap-3 mt-2 mb-1">
          <h1 className="text-2xl font-bold">Application funnel</h1>
          <div className="flex gap-1">
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => setDays(d)} className={`text-xs px-3 py-1.5 rounded-full ${days === d ? "bg-emerald-500 text-slate-950 font-semibold" : "bg-slate-800 hover:bg-slate-700 text-slate-300"}`}>{d}d</button>
            ))}
          </div>
        </div>
        <p className="text-slate-500 text-sm mb-5">Where applicants drop off, step by step. Last {days} days.</p>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
        ) : !data ? (
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-8 text-center text-slate-500">Couldn&apos;t load funnel data. Try again.</div>
        ) : (
          <>
            {/* ===== Lead pipeline & follow-up health — proves the engine is actually working ===== */}
            {data.health && (() => {
              const h = data.health;
              const STAGE_ORDER = ["New Lead", "Contacted", "Engaged", "Application", "Pre-Approved", "Approved", "Funded", "Closed", "Nurture", "Lost", "Dead"];
              const byStage: Record<string, number> = h.leadsByStage || {};
              const ordered = [...STAGE_ORDER.filter((s) => s in byStage), ...Object.keys(byStage).filter((s) => !STAGE_ORDER.includes(s))];
              const totalLeads = Object.values(byStage).reduce((a: number, b: any) => a + (b as number), 0);
              const ob = h.outbound || {};
              const chans = Object.entries(h.nurtureChannels || {}).map(([c, n]) => `${c}: ${n}`).join(" · ");
              return (
                <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mb-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Lead pipeline &amp; follow-up health</div>
                    <button onClick={runNow} disabled={running} className="text-xs font-semibold bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                      {running ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…</> : <>▶ Run follow-ups now</>}
                    </button>
                  </div>

                  {/* pipeline by stage */}
                  <div className="flex flex-wrap gap-2 mb-3">
                    {ordered.length ? ordered.map((s) => (
                      <div key={s} className="bg-slate-900/60 border border-slate-800 rounded-xl px-3 py-2 text-center min-w-[84px]">
                        <div className="text-xl font-bold text-emerald-300">{byStage[s]}</div>
                        <div className="text-[10px] text-slate-400">{s}</div>
                      </div>
                    )) : <div className="text-slate-600 text-sm">No leads yet.</div>}
                    <div className="bg-emerald-500/5 border border-emerald-700/40 rounded-xl px-3 py-2 text-center min-w-[84px]">
                      <div className="text-xl font-bold text-emerald-400">{totalLeads}</div>
                      <div className="text-[10px] text-slate-400">Total leads</div>
                    </div>
                  </div>

                  {runResult && (
                    <div className={`text-xs rounded-lg px-3 py-2 mb-3 ${runResult.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}>
                      {runResult.ok ? `Follow-up run complete — considered ${runResult.considered}, sent ${runResult.sent}, doc-chases ${runResult.chased}, reactivated ${runResult.reactivated}.` : `Run failed: ${runResult.error || "unknown error"}`}
                    </div>
                  )}

                  {/* outbound activity in window */}
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Activity · last {days}d</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    {([
                      ["New leads", ob["lead.created"] || 0],
                      ["Follow-ups sent", ob["nurture.sent"] || 0],
                      ["Stage advances", ob["lead.stage.advanced"] || 0],
                      ["Doc requests", (ob["doc.requested"] || 0) + (ob["doc.request.sent"] || 0)],
                      ["Docs uploaded", ob["doc.uploaded"] || 0],
                      ["Reminders sent", ob["doc.reminder.sent"] || 0],
                      ["Pre-approvals", ob["preapproval.issued"] || 0],
                      ["Emails delivered", ob["email.delivered"] || 0],
                    ] as [string, number][]).map(([k, v]) => (
                      <div key={k} className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2">
                        <div className="text-lg font-bold text-white">{v}</div>
                        <div className="text-[10px] text-slate-400">{k}</div>
                      </div>
                    ))}
                  </div>
                  {chans && <div className="text-[11px] text-slate-500 mb-2">Follow-up channels: {chans}</div>}
                  <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
                    <span>Last follow-up run: <b className="text-slate-300">{h.lastNurtureRun ? `${ago(h.lastNurtureRun.at)} (considered ${h.lastNurtureRun.considered}, sent ${h.lastNurtureRun.sent})` : "—"}</b></span>
                    <span>Last message sent: <b className="text-slate-300">{ago(h.lastNurtureSent)}</b></span>
                    <span>Last new lead: <b className="text-slate-300">{ago(h.lastLeadCreated)}</b></span>
                  </div>
                </div>
              );
            })()}

            {/* ===== Wizard step-by-step funnel (only when there are wizard events) ===== */}
            {!data.started ? (
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 text-center text-slate-500 text-sm">No wizard runs in this window yet — the step-by-step application drop-off appears here once applicants start the apply wizard.</div>
            ) : (
            <>
            {/* headline conversion */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[["Started", data.started, ""], ["Reached contact", data.contact, `${data.contactRate}%`], ["Completed app", data.complete, `${data.completeRate}%`]].map(([k, v, p]) => (
                <div key={k as string} className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 text-center">
                  <div className="text-2xl font-bold text-emerald-300">{v as number}</div>
                  <div className="text-xs text-slate-400">{k as string}{p ? ` · ${p}` : ""}</div>
                </div>
              ))}
            </div>

            {/* step-by-step funnel */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mb-4">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-4">Step-by-step drop-off</div>
              <div className="space-y-2">
                {data.funnel.map((n: any, i: number) => {
                  const big = i === 0 || n.key === "contact" || n.key === "complete";
                  const leak = n.dropPctFromPrev >= 25 && i > 0;
                  return (
                    <div key={n.key}>
                      <div className="flex items-center gap-3">
                        <div className={`w-40 shrink-0 text-sm ${big ? "font-semibold text-white" : "text-slate-300"}`}>{n.label}</div>
                        <div className="flex-1 h-6 rounded bg-slate-800 overflow-hidden relative">
                          <div className={`h-full ${big ? "bg-emerald-500" : "bg-emerald-600/60"}`} style={{ width: `${Math.max(2, n.pct)}%` }} />
                          <span className="absolute inset-0 flex items-center px-2 text-xs text-white/90">{n.count} · {n.pct}%</span>
                        </div>
                        {i > 0 && n.dropFromPrev > 0 && (
                          <div className={`w-24 shrink-0 text-right text-xs ${leak ? "text-amber-300 font-semibold" : "text-slate-500"}`}>▼ {n.dropFromPrev} ({n.dropPctFromPrev}%)</div>
                        )}
                        {i > 0 && n.dropFromPrev === 0 && <div className="w-24 shrink-0" />}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-slate-600 mt-3">Amber = a step losing ≥25% of the people who reached the prior step (your biggest leaks to fix first).</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* by goal */}
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">Conversion by goal</div>
                {data.goals.length ? (
                  <table className="w-full text-sm">
                    <thead className="text-xs text-slate-500 text-left"><tr><th className="py-1">Goal</th><th>Started</th><th>Contact</th><th>Complete</th></tr></thead>
                    <tbody>
                      {data.goals.map((g: any) => (
                        <tr key={g.goal} className="border-t border-slate-800/50">
                          <td className="py-1.5 font-medium">{g.goal}</td>
                          <td>{g.started}</td>
                          <td className="text-slate-300">{g.contact} <span className="text-xs text-slate-500">({g.contactRate}%)</span></td>
                          <td className="text-emerald-300">{g.complete} <span className="text-xs text-slate-500">({g.completeRate}%)</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <div className="text-slate-600 text-sm">No goal data.</div>}
              </div>

              {/* objections */}
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">Top objections hit</div>
                {data.topObjections.length ? (
                  <div className="space-y-1.5">
                    {data.topObjections.map((o: any) => (
                      <div key={o.obstacle} className="flex items-center justify-between text-sm border-b border-slate-800/50 pb-1.5">
                        <span className="text-slate-300">{o.obstacle}</span>
                        <span className="text-amber-300 font-semibold">{o.count}</span>
                      </div>
                    ))}
                  </div>
                ) : <div className="text-slate-600 text-sm">No objections recorded — clean run.</div>}
              </div>
            </div>
            </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

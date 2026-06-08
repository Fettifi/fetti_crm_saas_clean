"use client";

// Fetti CRM Doctor dashboard. Shows the latest health report (auto-run every few
// hours) and lets you run a check + auto-repair on demand.
import { useEffect, useState } from "react";
import { Loader2, Stethoscope, CheckCircle2, XCircle, AlertTriangle, Wrench, RefreshCw } from "lucide-react";

type Check = { name: string; ok: boolean; level: string; detail: string };
type Repair = { name: string; detail: string };
type Report = { status: string; checks: Check[]; repairs: Repair[]; created_at?: string };

export default function DoctorPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  async function load() {
    const r = await fetch("/api/doctor"); const j = await r.json();
    setReport(j.report); setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function runNow() {
    setRunning(true);
    try { const r = await fetch("/api/doctor", { method: "POST" }); const j = await r.json(); setReport({ ...j, created_at: new Date().toISOString() }); }
    finally { setRunning(false); }
  }

  const banner = report?.status === "healthy" ? "border-emerald-500/40 bg-emerald-500/5"
    : report?.status === "degraded" ? "border-amber-500/40 bg-amber-500/5" : "border-red-500/40 bg-red-500/5";
  const groups = ["critical", "warn", "info"];

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Stethoscope className="w-6 h-6 text-emerald-400" /> Fetti CRM Doctor</h1>
            <p className="text-slate-400 text-sm mt-1">Always-on monitor that auto-repairs safe issues — no approval needed.</p>
          </div>
          <button onClick={runNow} disabled={running} className="flex items-center gap-2 text-sm bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 rounded-lg font-semibold">
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} {running ? "Running…" : "Run check now"}
          </button>
        </div>

        {loading && <div className="text-slate-500 mt-10 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}

        {report && (
          <>
            <div className={`mt-6 rounded-2xl border p-5 ${banner}`}>
              <div className="flex items-center gap-3">
                <span className={`text-3xl`}>{report.status === "healthy" ? "🟢" : report.status === "degraded" ? "🟡" : "🔴"}</span>
                <div>
                  <div className="text-xl font-bold capitalize">{report.status}</div>
                  <div className="text-xs text-slate-400">{report.checks.filter((c) => c.ok).length}/{report.checks.length} checks passing{report.created_at ? ` · ${new Date(report.created_at).toLocaleString()}` : ""}</div>
                </div>
              </div>
              {report.repairs?.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs uppercase tracking-wide text-emerald-400/80 flex items-center gap-1 mb-1"><Wrench className="w-3.5 h-3.5" /> Auto-repaired</div>
                  <ul className="text-sm text-emerald-200/90 space-y-1">{report.repairs.map((r, i) => <li key={i}>✓ {r.detail}</li>)}</ul>
                </div>
              )}
            </div>

            {groups.map((g) => {
              const items = report.checks.filter((c) => c.level === g);
              if (!items.length) return null;
              return (
                <div key={g} className="mt-5">
                  <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">{g === "critical" ? "Critical" : g === "warn" ? "Important" : "Info"}</div>
                  <div className="space-y-1.5">
                    {items.map((c) => (
                      <div key={c.name} className="flex items-center gap-2 bg-slate-900/40 border border-slate-800 rounded-lg px-3 py-2 text-sm">
                        {c.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : c.level === "critical" ? <XCircle className="w-4 h-4 text-red-400 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
                        <span className="font-mono text-xs text-slate-300">{c.name}</span>
                        <span className="text-slate-500 text-xs ml-auto truncate max-w-[50%]">{c.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

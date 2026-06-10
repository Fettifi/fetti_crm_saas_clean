"use client";

// Loan file detail for the loan officer: stage control, document review (view /
// accept / reject / request), compliance checklist, the borrower's custom link,
// and the full activity timeline for this file.
import { useCallback, useEffect, useState } from "react";
import { use } from "react";
import Link from "next/link";
import { Loader2, Link2, Check, ArrowLeft, Plus, ExternalLink } from "lucide-react";

const STAGES = ["Application", "Processing", "Underwriting", "Approved", "Clear to Close", "Funded", "Closed"];

type Doc = { id: string; name: string; category: string; required: boolean; status: string; file_name?: string; storage_path?: string };
type Comp = { key: string; label: string; done: boolean };
type FileT = { id: string; file_number: string; borrower_name: string; email?: string; phone?: string; product: string; occupancy?: string; property_address?: string; property_value?: number; loan_amount?: number; state?: string; stage: string; status: string; share_token: string; compliance: Comp[]; lead_id?: string };
type Act = { id: string; actor: string; action: string; detail: any; created_at: string };

export default function LoanFileDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [file, setFile] = useState<FileT | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [activity, setActivity] = useState<Act[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [newDoc, setNewDoc] = useState("");
  const [saving, setSaving] = useState(false);
  const [mismo, setMismo] = useState<{ completeness: { missing: string[]; present: string[]; pct: number }; metrics: any; urla: any } | null>(null);
  const [uw, setUw] = useState<any>(null);
  const [uwLoading, setUwLoading] = useState(false);

  async function runUnderwrite() {
    setUwLoading(true);
    try { const r = await fetch(`/api/los/underwrite?file=${id}`, { method: "POST" }); const j = await r.json(); if (r.ok) setUw(j.analysis); else setUw({ summary: "⚠️ " + (j.error || "Failed."), eligibilityRead: "Insufficient data", strengths: [], risks: [], conditions: [] }); } catch { setUw({ summary: "⚠️ Connection error.", strengths: [], risks: [], conditions: [] }); }
    setUwLoading(false);
  }
  const fmtMoney = (n?: number) => n == null ? "—" : "$" + Math.round(n).toLocaleString();

  const load = useCallback(async () => {
    const res = await fetch(`/api/los/files/${id}`);
    if (res.ok) { const j = await res.json(); setFile(j.file); setDocs(j.documents); setActivity(j.activity); }
    setLoading(false);
    try { const r = await fetch(`/api/los/export?file=${id}&report=1`); if (r.ok) setMismo(await r.json()); } catch {}
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function patchFile(patch: any) {
    setSaving(true);
    await fetch(`/api/los/files/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    await load(); setSaving(false);
  }
  async function patchDoc(doc_id: string, status: string) {
    await fetch(`/api/los/files/${id}/docs`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc_id, status }) });
    await load();
  }
  async function addDoc() {
    if (!newDoc.trim()) return;
    await fetch(`/api/los/files/${id}/docs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newDoc.trim() }) });
    setNewDoc(""); await load();
  }
  async function viewDoc(doc_id: string) {
    const res = await fetch(`/api/los/files/${id}/docs?doc_id=${doc_id}`);
    const j = await res.json(); if (j.url) window.open(j.url, "_blank");
  }
  function toggleComp(i: number) {
    if (!file) return;
    const next = file.compliance.map((c, idx) => idx === i ? { ...c, done: !c.done } : c);
    setFile({ ...file, compliance: next });
    patchFile({ compliance: next });
  }
  function copyLink() {
    if (!file) return;
    navigator.clipboard?.writeText(`${window.location.origin}/file/${file.share_token}`);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>;
  if (!file) return <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center">Loan file not found.</div>;

  const badge = (s: string) => s === "accepted" ? "text-emerald-400" : s === "received" ? "text-yellow-400" : s === "rejected" ? "text-red-400" : "text-slate-500";

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        <Link href="/los" className="text-slate-400 hover:text-white text-sm flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Loan files</Link>

        <div className="flex flex-wrap items-start justify-between gap-3 mt-3">
          <div>
            <h1 className="text-2xl font-bold">{file.borrower_name || "Borrower"}</h1>
            <div className="text-sm text-slate-400 mt-1 font-mono">{file.file_number} · {file.product || "—"}{file.occupancy ? ` · ${file.occupancy}` : ""}</div>
            <div className="text-sm text-slate-500 mt-1">{[file.email, file.phone, file.property_address, file.state].filter(Boolean).join(" · ")}</div>
            {file.property_address && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(file.property_address)}`} target="_blank" rel="noreferrer" className="text-xs text-emerald-400 hover:underline">🗺️ View property on map</a>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={copyLink} className="flex items-center gap-2 text-sm bg-emerald-600/80 hover:bg-emerald-500 px-3 py-2 rounded-lg">
              {copied ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />} {copied ? "Copied!" : "Copy borrower link"}
            </button>
            <a href={`/file/${file.share_token}`} target="_blank" className="text-slate-400 hover:text-white p-2"><ExternalLink className="w-4 h-4" /></a>
          </div>
        </div>

        {/* Stage */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 mt-5">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Stage {saving && <Loader2 className="w-3 h-3 animate-spin inline ml-1" />}</div>
          <div className="flex flex-wrap gap-2">
            {STAGES.map((s) => (
              <button key={s} onClick={() => patchFile({ stage: s })}
                className={`text-xs px-3 py-1.5 rounded-full ${file.stage === s ? "bg-emerald-500 text-slate-950 font-semibold" : "bg-slate-800 hover:bg-slate-700 text-slate-300"}`}>{s}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
          {/* Documents */}
          <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">Documents & conditions</div>
            <div className="space-y-2">
              {docs.map((d) => {
                const got = d.status !== "needed";
                return (
                  <div key={d.id} className="flex items-center justify-between gap-2 border-b border-slate-800/50 pb-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{d.name} {d.required && <span className="text-[10px] text-amber-400/70">required</span>}</div>
                      <div className={`text-xs ${badge(d.status)}`}>{d.status}{d.file_name ? ` · ${d.file_name}` : ""}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {d.storage_path && <button onClick={() => viewDoc(d.id)} className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700">View</button>}
                      {got && d.status !== "accepted" && <button onClick={() => patchDoc(d.id, "accepted")} className="text-xs px-2 py-1 rounded bg-emerald-600/80 hover:bg-emerald-500">Accept</button>}
                      {got && d.status !== "rejected" && <button onClick={() => patchDoc(d.id, "rejected")} className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-red-900/60">Reject</button>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 mt-4">
              <input value={newDoc} onChange={(e) => setNewDoc(e.target.value)} placeholder="Request another document…"
                onKeyDown={(e) => { if (e.key === "Enter") addDoc(); }}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none" />
              <button onClick={addDoc} className="bg-slate-800 hover:bg-slate-700 px-3 rounded-lg flex items-center"><Plus className="w-4 h-4" /></button>
            </div>
          </div>

          {/* Compliance */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">Compliance</div>
            <div className="space-y-2">
              {(file.compliance || []).map((c, i) => (
                <label key={c.key} className="flex items-start gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={c.done} onChange={() => toggleComp(i)} className="mt-0.5 accent-emerald-500" />
                  <span className={c.done ? "text-slate-400 line-through" : "text-slate-200"}>{c.label}</span>
                </label>
              ))}
              {(!file.compliance || !file.compliance.length) && <div className="text-slate-600 text-sm">No items.</div>}
            </div>
            {file.lead_id && <Link href={`/agents?lead=${file.lead_id}`} className="block mt-4 text-xs text-emerald-400 hover:underline">Run AI agents on this file →</Link>}
          </div>
        </div>

        {/* 1003 / MISMO export */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mt-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">1003 / URLA · MISMO 3.4 export</div>
            <div className="flex items-center gap-2">
              <Link href={`/los/${id}/1003`} className="text-xs font-semibold bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg">✎ Complete 1003</Link>
              <a href={`/api/los/export?file=${id}`} download
                className="text-xs font-semibold bg-emerald-600/80 hover:bg-emerald-500 px-3 py-1.5 rounded-lg">⬇ Download MISMO 3.4 XML</a>
            </div>
          </div>
          {mismo ? (
            <>
              {mismo.metrics && (
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
                  {[
                    ["Income/mo", fmtMoney(mismo.metrics.monthlyIncome)],
                    ["Loan", fmtMoney(mismo.metrics.amount)],
                    ["Value", fmtMoney(mismo.metrics.value)],
                    ["LTV", mismo.metrics.ltv != null ? mismo.metrics.ltv + "%" : "—"],
                    [mismo.metrics.isInvestment ? "DSCR" : "DTI", mismo.metrics.isInvestment ? (mismo.metrics.dscr ?? "—") : (mismo.metrics.backDti != null ? mismo.metrics.backDti + "%" : "—")],
                    ["P&I est.", fmtMoney(mismo.metrics.pi)],
                  ].map(([k, v]) => (
                    <div key={k as string} className="bg-slate-900/60 border border-slate-800 rounded-lg px-2 py-1.5 text-center">
                      <div className="text-[10px] uppercase text-slate-500">{k}</div>
                      <div className="text-sm font-semibold text-slate-200">{v}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${mismo.completeness.pct}%` }} />
                </div>
                <span className="text-sm text-slate-300 font-semibold">{mismo.completeness.pct}% complete</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-emerald-400 mb-1">Captured ({mismo.completeness.present.length})</div>
                  <ul className="text-sm text-slate-300 space-y-0.5">
                    {mismo.completeness.present.map((p) => <li key={p}>✓ {p}</li>)}
                  </ul>
                </div>
                <div>
                  <div className="text-xs text-amber-400 mb-1">Missing for a complete file ({mismo.completeness.missing.length})</div>
                  {mismo.completeness.missing.length ? (
                    <ul className="text-sm text-amber-300/90 space-y-0.5">
                      {mismo.completeness.missing.map((p) => <li key={p}>• {p}</li>)}
                    </ul>
                  ) : <div className="text-sm text-emerald-400">Nothing missing — ready to export.</div>}
                </div>
              </div>
              <p className="text-xs text-slate-600 mt-3">The XML includes everything captured. Missing items still export as empty MISMO elements; fill them on the application to complete the file.</p>
            </>
          ) : <div className="text-slate-600 text-sm">Building 1003 view…</div>}
        </div>

        {/* AI Underwriter */}
        <div className="bg-gradient-to-br from-emerald-950/40 to-slate-900/40 border border-emerald-800/40 rounded-2xl p-5 mt-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-xs uppercase tracking-wide text-emerald-400">🧠 AI Underwriter</div>
            <button onClick={runUnderwrite} disabled={uwLoading}
              className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              {uwLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}{uwLoading ? "Reading the file…" : uw ? "Re-run" : "Run AI Underwriter"}
            </button>
          </div>
          {!uw && !uwLoading && <div className="text-slate-500 text-sm">Claude reads the full 1003 + metrics and returns an underwriting read: strengths, risks, conditions, and an eligibility call. Not a credit decision.</div>}
          {uw && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${/strong/i.test(uw.eligibilityRead) ? "bg-emerald-500/20 text-emerald-300" : /conditions/i.test(uw.eligibilityRead) ? "bg-amber-500/20 text-amber-300" : "bg-slate-700 text-slate-300"}`}>{uw.eligibilityRead || "—"}</span>
              </div>
              <p className="text-sm text-slate-200 leading-relaxed">{uw.summary}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {!!(uw.strengths || []).length && <div><div className="text-xs text-emerald-400 mb-1">Strengths</div><ul className="text-sm text-slate-300 space-y-0.5">{uw.strengths.map((s: string, i: number) => <li key={i}>✓ {s}</li>)}</ul></div>}
                {!!(uw.risks || []).length && <div><div className="text-xs text-amber-400 mb-1">Risks</div><ul className="text-sm text-amber-200/90 space-y-0.5">{uw.risks.map((s: string, i: number) => <li key={i}>• {s}</li>)}</ul></div>}
              </div>
              {!!(uw.conditions || []).length && <div><div className="text-xs text-sky-400 mb-1">Suggested conditions</div><ul className="text-sm text-slate-300 space-y-0.5">{uw.conditions.map((s: string, i: number) => <li key={i}>☐ {s}</li>)}</ul></div>}
              {uw.incomeAnalysis && <div><div className="text-xs text-slate-500 mb-1">Income analysis</div><p className="text-sm text-slate-300">{uw.incomeAnalysis}</p></div>}
              {uw.keyRatios && <div className="text-xs text-slate-500">{uw.keyRatios}</div>}
            </div>
          )}
        </div>

        {/* Activity */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mt-4">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">Activity</div>
          <div className="space-y-1.5">
            {activity.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-sm">
                <span className="text-slate-600 text-xs w-32 shrink-0">{new Date(a.created_at).toLocaleString()}</span>
                <span className="text-slate-300">{a.action.replace(/[._]/g, " ")}</span>
                <span className="text-slate-600 text-xs">{a.actor}</span>
              </div>
            ))}
            {!activity.length && <div className="text-slate-600 text-sm">No activity yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

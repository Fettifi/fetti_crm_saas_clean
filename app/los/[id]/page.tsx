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
  const [credit, setCredit] = useState<any>(null);
  const [creditLoading, setCreditLoading] = useState(false);
  const [dirLenders, setDirLenders] = useState<any[]>([]);
  const [submitState, setSubmitState] = useState<{ id?: string; msg?: string; ok?: boolean }>({});
  const [priceRows, setPriceRows] = useState<any[] | null>(null);
  const [pricing, setPricing] = useState(false);
  const [screen, setScreen] = useState<any>(null);
  const [screening, setScreening] = useState(false);

  async function runScreen() {
    setScreening(true);
    try { const r = await fetch(`/api/los/screen?file=${id}`, { method: "POST" }); const j = await r.json(); setScreen(r.ok ? j.screen : { verdict: "Needs more info", summary: "⚠️ " + (j.error || "Failed"), bestLenders: [], questions: [] }); }
    catch { setScreen({ verdict: "Needs more info", summary: "⚠️ Connection error", bestLenders: [], questions: [] }); }
    setScreening(false);
  }

  async function priceLoan() {
    setPricing(true);
    const u = mismo?.urla || {};
    const scenario = {
      loanAmount: u.loan?.amount, propertyValue: u.property?.presentValue,
      fico: credit?.credit?.representativeScore || undefined,
      occupancy: u.property?.occupancy, purpose: u.loan?.purpose, loanType: u.loan?.loanType,
      state: u.property?.address?.state,
    };
    try { const r = await fetch("/api/pricing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "compare", scenario }) }); const j = await r.json(); setPriceRows(j.results || []); } catch { setPriceRows([]); }
    setPricing(false);
  }

  useEffect(() => { (async () => { try { const r = await fetch("/api/pricing/lenders"); if (r.ok) { const j = await r.json(); setDirLenders((j.lenders || []).filter((l: any) => l.active !== false)); } } catch {} })(); }, []);

  async function submitToLender(l: any) {
    if (!confirm(`Send this file to ${l.name}${l.submissionEmail ? ` (${l.submissionEmail})` : ""}? This emails the MISMO 3.4 file.`)) return;
    setSubmitState({ id: l.id, msg: "Sending…" });
    try {
      const r = await fetch(`/api/los/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: id, lenderId: l.id }) });
      const j = await r.json();
      if (r.ok) { setSubmitState({ id: l.id, ok: true, msg: `✓ Sent to ${j.to}` }); await load(); }
      else setSubmitState({ id: l.id, ok: false, msg: "⚠️ " + (j.error || "Failed") });
    } catch { setSubmitState({ id: l.id, ok: false, msg: "⚠️ Connection error" }); }
  }

  const loadCredit = useCallback(async () => {
    try { const r = await fetch(`/api/los/credit?file=${id}`); if (r.ok) setCredit(await r.json()); } catch {}
  }, [id]);
  useEffect(() => { loadCredit(); }, [loadCredit]);

  async function pullCredit() {
    setCreditLoading(true);
    try { const r = await fetch(`/api/los/credit?file=${id}`, { method: "POST" }); const j = await r.json(); setCredit((c: any) => ({ ...c, ...j, lastError: r.ok ? null : (j.error || j.note) })); if (r.ok) await load(); }
    catch { setCredit((c: any) => ({ ...c, lastError: "Connection error." })); }
    setCreditLoading(false);
  }

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

        {/* AI Deal Screen (Relip-style triage + lender match) */}
        <div className="bg-gradient-to-br from-emerald-950/40 to-slate-900/40 border border-emerald-800/40 rounded-2xl p-5 mt-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-xs uppercase tracking-wide text-emerald-400">🎯 AI Deal Screen — fundable? best lender?</div>
            <button onClick={runScreen} disabled={screening} className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              {screening ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}{screening ? "Screening…" : screen ? "Re-screen" : "Screen this deal"}
            </button>
          </div>
          {!screen && !screening && <div className="text-slate-500 text-sm">Claude screens the deal for fundability (real deal vs tire-kicker) and tells you which of your wholesalers to send it to. Not a credit decision.</div>}
          {screen && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${/hot/i.test(screen.verdict) ? "bg-emerald-500/20 text-emerald-300" : /workable/i.test(screen.verdict) ? "bg-teal-500/20 text-teal-300" : /tire/i.test(screen.verdict) ? "bg-red-500/20 text-red-300" : "bg-amber-500/20 text-amber-300"}`}>{screen.verdict}</span>
                {typeof screen.dealScore === "number" && <span className="text-xs text-slate-400">Deal score {screen.dealScore}/100</span>}
              </div>
              <p className="text-sm text-slate-200 leading-relaxed">{screen.summary}</p>
              {screen.dealRead && <p className="text-xs text-slate-400">{screen.dealRead}</p>}
              {!!(screen.bestLenders || []).length && (
                <div>
                  <div className="text-xs text-slate-500 mb-1.5">Best lender for this deal</div>
                  <div className="space-y-1.5">
                    {screen.bestLenders.map((bl: any, i: number) => {
                      const lender = dirLenders.find((l: any) => l.id === bl.lenderId || l.name === bl.lenderName);
                      const pass = /pass/i.test(bl.fit);
                      return (
                        <div key={i} className="flex items-center justify-between gap-2 bg-slate-900/50 border border-slate-800 rounded-lg px-3 py-2">
                          <div className="min-w-0">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded mr-2 ${/strong/i.test(bl.fit) ? "bg-emerald-500/20 text-emerald-300" : pass ? "bg-slate-700 text-slate-400" : "bg-amber-500/20 text-amber-300"}`}>{bl.fit}</span>
                            <span className="font-medium text-sm">{bl.lenderName}</span>
                            <div className="text-xs text-slate-500 mt-0.5">{bl.reason}</div>
                          </div>
                          {lender && !pass && <button onClick={() => submitToLender(lender)} className="text-xs font-semibold px-2.5 py-1 rounded bg-emerald-600/80 hover:bg-emerald-500 shrink-0">Send file</button>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {!!(screen.questions || []).length && (
                <div><div className="text-xs text-slate-500 mb-1">Ask the borrower</div><ul className="text-sm text-slate-300 space-y-0.5">{screen.questions.map((q: string, i: number) => <li key={i}>• {q}</li>)}</ul></div>
              )}
              {screen.nextAction && <div className="text-sm text-emerald-300">➡️ {screen.nextAction}</div>}
            </div>
          )}
        </div>

        {/* Price across lenders */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mt-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Price this loan across lenders</div>
            <button onClick={priceLoan} disabled={pricing} className="text-xs font-semibold bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              {pricing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}{pricing ? "Pricing…" : "Price across lenders"}
            </button>
          </div>
          {priceRows === null ? (
            <div className="text-sm text-slate-500">Uses this file&apos;s loan amount, value, FICO, occupancy, purpose &amp; state against your uploaded rate sheets. <Link href="/pricing" className="text-emerald-400 hover:underline">Manage rate sheets →</Link></div>
          ) : priceRows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500 text-left"><tr><th className="py-1">#</th><th>Lender</th><th>Product</th><th>Rate</th><th>Price</th><th>P&amp;I</th></tr></thead>
                <tbody>
                  {priceRows.map((r, i) => (
                    <tr key={r.id} className={`border-t border-slate-800/50 ${i === 0 ? "bg-emerald-500/10" : ""}`}>
                      <td className="py-2 text-slate-500">{i + 1}</td>
                      <td className="font-medium">{r.lenderName}</td>
                      <td className="text-slate-300">{r.productName}{r.loanType ? ` · ${r.loanType}` : ""}</td>
                      <td className="font-bold text-emerald-300">{r.noteRate != null ? r.noteRate.toFixed(3) + "%" : "—"}</td>
                      <td className="text-slate-300">{r.pricePercent != null ? r.pricePercent.toFixed(3) : "—"}</td>
                      <td className="text-slate-300">{r.monthlyPI != null ? "$" + Math.round(r.monthlyPI).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-slate-500">No eligible products. Add rate sheets on the <Link href="/pricing" className="text-emerald-400 hover:underline">Pricing page</Link>, or loosen the 1003.</div>
          )}
        </div>

        {/* Submit to a wholesale lender */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mt-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Submit to a wholesale lender</div>
            <Link href="/pricing" className="text-xs text-emerald-400 hover:underline">Manage lenders →</Link>
          </div>
          {dirLenders.length ? (
            <div className="space-y-1.5">
              {dirLenders.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-2 border-b border-slate-800/50 pb-1.5">
                  <div className="min-w-0">
                    <span className="font-medium">{l.name}</span>
                    <span className="text-xs text-slate-500"> · {l.submissionEmail || "no submit email"}{l.loanTypes?.length ? ` · ${l.loanTypes.join("/")}` : ""}</span>
                    {submitState.id === l.id && <span className={`text-xs ml-2 ${submitState.ok ? "text-emerald-400" : submitState.ok === false ? "text-amber-300" : "text-slate-400"}`}>{submitState.msg}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {l.portalUrl && <a href={l.portalUrl} target="_blank" rel="noreferrer" className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700">Portal ↗</a>}
                    <button onClick={() => submitToLender(l)} disabled={submitState.id === l.id && submitState.msg === "Sending…"} className="text-xs font-semibold px-2.5 py-1 rounded bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-50">Send file</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-500">No lenders yet. <Link href="/pricing" className="text-emerald-400 hover:underline">Add your wholesale lenders →</Link></div>
          )}
        </div>

        {/* Credit (Credco) */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mt-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Credit · Credco tri-merge</div>
            <button onClick={pullCredit} disabled={creditLoading || !credit?.ready?.ready}
              className="text-xs font-semibold bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              {creditLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}{creditLoading ? "Pulling…" : "Pull credit"}
            </button>
          </div>
          {credit?.credit?.scores?.length ? (
            <div className="flex flex-wrap items-center gap-3">
              {credit.credit.scores.map((s: any, i: number) => (
                <div key={i} className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-1.5 text-center">
                  <div className="text-[10px] uppercase text-slate-500">{s.bureau}</div>
                  <div className="text-lg font-bold text-emerald-300">{s.score ?? "—"}</div>
                </div>
              ))}
              {credit.credit.representativeScore && <div className="text-sm text-slate-300">Representative: <span className="font-bold text-emerald-300">{credit.credit.representativeScore}</span></div>}
              <div className="text-xs text-slate-600 w-full">Pulled {credit.credit.pulledAt ? new Date(credit.credit.pulledAt).toLocaleString() : ""}{credit.addedLiabilities ? ` · ${credit.addedLiabilities} tradelines → liabilities` : ""}</div>
            </div>
          ) : credit && credit.configured === false ? (
            <div className="text-sm text-amber-300/90">Credco isn&apos;t connected yet. Add <span className="font-mono text-xs">{(credit.neededEnv || []).join(", ")}</span> to Vercel env (CERT endpoint first) and send Ramon the Credco integration guide to finalize.</div>
          ) : credit && !credit.ready?.ready ? (
            <div className="text-sm text-slate-400">Need before a pull: {(credit.ready?.missing || []).join(", ")}. Complete the 1003.</div>
          ) : (
            <div className="text-sm text-slate-500">Ready to pull. {credit?.lastError ? <span className="text-amber-300">{credit.lastError}</span> : ""}</div>
          )}
          {credit?.lastError && credit?.credit && <div className="text-xs text-amber-300 mt-2">{credit.lastError}</div>}
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

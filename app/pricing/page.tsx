"use client";

// Pricing comparison — one location, all your wholesalers. Drop each lender's
// rate sheet (Claude parses it), enter a scenario, get a ranked side-by-side.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, FileUp, Trash2, Search } from "lucide-react";

export default function PricingPage() {
  const [lenders, setLenders] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [lenderName, setLenderName] = useState("");
  const [ingesting, setIngesting] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [sc, setSc] = useState<any>({ loanAmount: "", propertyValue: "", fico: "", occupancy: "", purpose: "", loanType: "", state: "" });
  const [results, setResults] = useState<any[] | null>(null);
  const [filtered, setFiltered] = useState(0);
  const [comparing, setComparing] = useState(false);

  // Wholesale lender directory
  const [dir, setDir] = useState<any[]>([]);
  const [lf, setLf] = useState<any>({ name: "", submissionEmail: "", portalUrl: "", aeEmail: "", loanTypes: "", states: "" });

  const load = useCallback(async () => {
    const r = await fetch("/api/pricing"); if (r.ok) { const j = await r.json(); setLenders(j.lenders || []); setTotal(j.total || 0); }
  }, []);
  const loadDir = useCallback(async () => {
    const r = await fetch("/api/pricing/lenders"); if (r.ok) { const j = await r.json(); setDir(j.lenders || []); }
  }, []);
  useEffect(() => { load(); loadDir(); }, [load, loadDir]);

  async function saveLender() {
    if (!lf.name.trim()) { alert("Lender name required."); return; }
    const lender = { id: lf.id, name: lf.name.trim(), submissionEmail: lf.submissionEmail.trim() || undefined, portalUrl: lf.portalUrl.trim() || undefined, aeEmail: lf.aeEmail.trim() || undefined,
      loanTypes: lf.loanTypes ? lf.loanTypes.split(",").map((s: string) => s.trim()).filter(Boolean) : undefined,
      states: lf.states ? lf.states.split(",").map((s: string) => s.trim().toUpperCase()).filter(Boolean) : undefined };
    await fetch("/api/pricing/lenders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lender }) });
    setLf({ name: "", submissionEmail: "", portalUrl: "", aeEmail: "", loanTypes: "", states: "" });
    await loadDir();
  }
  async function delLender(id: string, name: string) { if (!confirm(`Remove ${name}?`)) return; await fetch(`/api/pricing/lenders?id=${id}`, { method: "DELETE" }); await loadDir(); }
  function editLender(l: any) { setLf({ id: l.id, name: l.name, submissionEmail: l.submissionEmail || "", portalUrl: l.portalUrl || "", aeEmail: l.aeEmail || "", loanTypes: (l.loanTypes || []).join(", "), states: (l.states || []).join(", ") }); window.scrollTo({ top: 0, behavior: "smooth" }); }

  // Daily refresh: the first file replaces this lender's current sheet, any
  // additional files accumulate (a multi-sheet lender = one fresh set).
  async function ingestFiles(files: FileList | File[]) {
    if (!lenderName.trim()) { alert("Enter the lender name first."); return; }
    const arr = Array.from(files); const name = lenderName.trim(); let total = 0;
    for (let i = 0; i < arr.length; i++) {
      setIngesting(`Parsing ${arr[i].name}${arr.length > 1 ? ` (${i + 1}/${arr.length})` : ""} for ${name}…`);
      const fd = new FormData(); fd.append("lenderName", name); fd.append("doc", arr[i]); fd.append("replace", i === 0 ? "true" : "false");
      try {
        const r = await fetch("/api/pricing/ingest", { method: "POST", body: fd });
        const j = await r.json();
        if (!r.ok) { setIngesting("⚠️ " + (j.error || `Failed on ${arr[i].name}.`)); await load(); setTimeout(() => setIngesting(null), 7000); return; }
        total += j.added || 0;
      } catch { setIngesting("⚠️ Upload failed."); setTimeout(() => setIngesting(null), 7000); return; }
    }
    setIngesting(`✓ Refreshed ${name} — ${total} products${arr.length > 1 ? ` from ${arr.length} sheets` : ""}.`);
    setLenderName(""); await load();
    setTimeout(() => setIngesting(null), 6000);
  }

  async function clearLender(lenderId: string, name: string) {
    if (!confirm(`Remove all products for ${name}?`)) return;
    await fetch("/api/pricing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clear", lenderId }) });
    await load();
  }

  async function runCompare() {
    setComparing(true);
    const num = (v: any) => v === "" ? undefined : Number(String(v).replace(/[^0-9.]/g, ""));
    const scenario = { loanAmount: num(sc.loanAmount), propertyValue: num(sc.propertyValue), fico: num(sc.fico), occupancy: sc.occupancy || undefined, purpose: sc.purpose || undefined, loanType: sc.loanType || undefined, state: sc.state || undefined };
    const r = await fetch("/api/pricing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "compare", scenario }) });
    const j = await r.json();
    setResults(j.results || []); setFiltered(j.filtered || 0);
    setComparing(false);
  }

  const inp = "bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none";
  const ltv = sc.loanAmount && sc.propertyValue ? ((Number(String(sc.loanAmount).replace(/[^0-9.]/g, "")) / Number(String(sc.propertyValue).replace(/[^0-9.]/g, ""))) * 100).toFixed(1) : null;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        <Link href="/leads" className="text-slate-400 hover:text-white text-sm">← CRM</Link>
        <h1 className="text-2xl font-bold mt-2">Pricing — one-location comparison</h1>
        <p className="text-slate-500 text-sm">Drop each wholesaler&apos;s rate sheet, then price a scenario across all of them at once.</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-5">
          {/* Upload */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
            <div className="text-xs uppercase tracking-wide text-emerald-400 mb-3">Add a wholesaler rate sheet</div>
            <input value={lenderName} onChange={(e) => setLenderName(e.target.value)} placeholder="Lender name (e.g. TheLender)" className={`${inp} w-full mb-2`} />
            <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => { const fs = e.target.files; if (fs && fs.length) ingestFiles(fs); e.currentTarget.value = ""; }} />
            <button onClick={() => fileRef.current?.click()} disabled={!!ingesting} className="w-full text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-2 rounded-lg flex items-center justify-center gap-1.5">
              {ingesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />} Parse / refresh rate sheet
            </button>
            {ingesting && <div className="text-xs text-slate-400 mt-2">{ingesting}</div>}
            <div className="text-[11px] text-slate-600 mt-2">Re-uploading <span className="text-slate-400">replaces</span> this lender&apos;s sheet — built for a daily refresh, no stale rows. Select multiple files for a lender that splits sheets (conv / govt / non-QM).</div>
          </div>

          {/* Lenders */}
          <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">Lenders loaded · {total} products</div>
            {lenders.length ? (
              <div className="space-y-1.5">
                {lenders.map((l) => {
                  const fresh = l.uploadedAt && new Date(l.uploadedAt).toDateString() === new Date().toDateString();
                  return (
                  <div key={l.lenderId} className="flex items-center justify-between border-b border-slate-800/50 pb-1.5">
                    <div>
                      <span className="font-medium">{l.lenderName}</span>{" "}
                      <span className="text-xs text-slate-500">· {l.count} products{l.effectiveDate ? ` · as of ${l.effectiveDate}` : l.uploadedAt ? ` · ${new Date(l.uploadedAt).toLocaleDateString()}` : ""}</span>
                      {l.uploadedAt && (fresh
                        ? <span className="text-[11px] text-emerald-400 ml-1">· fresh today</span>
                        : <span className="text-[11px] text-amber-400 ml-1">· refresh today</span>)}
                    </div>
                    <button onClick={() => clearLender(l.lenderId, l.lenderName)} className="text-slate-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  );
                })}
              </div>
            ) : <div className="text-slate-600 text-sm">No rate sheets yet. Add one to start comparing.</div>}
          </div>
        </div>

        {/* Fast multi-portal pricing */}
        <Link href="/pricing/run" className="block bg-emerald-600/10 border border-emerald-700/40 hover:border-emerald-500 rounded-2xl p-4 mt-4 transition-colors">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-emerald-300">⚡ Price a deal across your portals →</div>
              <div className="text-xs text-slate-400 mt-0.5">Set the scenario once, open each portal, paste each result into its lane, and capture + compare all of them in one click.</div>
            </div>
            <span className="text-emerald-400 text-xl shrink-0">→</span>
          </div>
        </Link>

        {/* Wholesale lender directory */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mt-4">
          <div className="text-xs uppercase tracking-wide text-emerald-400 mb-3">My wholesale lenders ({dir.length}) — these show up everywhere you price &amp; submit</div>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end mb-3">
            <div><label className="text-xs text-slate-400 block mb-1">{lf.id ? "Editing" : "Lender name"}</label><input value={lf.name} onChange={(e) => setLf({ ...lf, name: e.target.value })} className={`${inp} w-full`} placeholder="TheLender" /></div>
            <div><label className="text-xs text-slate-400 block mb-1">Submission email</label><input value={lf.submissionEmail} onChange={(e) => setLf({ ...lf, submissionEmail: e.target.value })} className={`${inp} w-full`} placeholder="submit@lender.com" /></div>
            <div><label className="text-xs text-slate-400 block mb-1">Portal URL</label><input value={lf.portalUrl} onChange={(e) => setLf({ ...lf, portalUrl: e.target.value })} className={`${inp} w-full`} placeholder="https://tpo…" /></div>
            <div><label className="text-xs text-slate-400 block mb-1">AE email</label><input value={lf.aeEmail} onChange={(e) => setLf({ ...lf, aeEmail: e.target.value })} className={`${inp} w-full`} /></div>
            <div><label className="text-xs text-slate-400 block mb-1">Loan types</label><input value={lf.loanTypes} onChange={(e) => setLf({ ...lf, loanTypes: e.target.value })} className={`${inp} w-full`} placeholder="DSCR, Conventional" /></div>
            <div className="flex gap-1"><div className="flex-1"><label className="text-xs text-slate-400 block mb-1">States</label><input value={lf.states} onChange={(e) => setLf({ ...lf, states: e.target.value })} className={`${inp} w-full`} placeholder="CA, FL" /></div></div>
          </div>
          <button onClick={saveLender} className="text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 rounded-lg">{lf.id ? "Save lender" : "Add lender"}</button>
          <div className="mt-3 space-y-1.5">
            {dir.map((l) => (
              <div key={l.id} className="flex items-center justify-between border-b border-slate-800/50 pb-1.5 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{l.name}</span>
                  <span className="text-xs text-slate-500"> · {l.submissionEmail || "no submit email"}{l.loanTypes?.length ? ` · ${l.loanTypes.join("/")}` : ""}{l.states?.length ? ` · ${l.states.join(",")}` : " · all states"}</span>
                  {l.portalUrl && <a href={l.portalUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-400 hover:underline ml-2">portal ↗</a>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => editLender(l)} className="text-xs text-slate-400 hover:text-white">edit</button>
                  <button onClick={() => delLender(l.id, l.name)} className="text-slate-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
            {!dir.length && <div className="text-slate-600 text-sm">Add the wholesale lenders you're approved with. They'll appear on every loan file's "Submit to lender" panel.</div>}
          </div>
        </div>

        {/* Scenario */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mt-4">
          <div className="text-xs uppercase tracking-wide text-emerald-400 mb-3">Price a scenario {ltv && <span className="text-slate-500 normal-case">· LTV {ltv}%</span>}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 items-end">
            {[["loanAmount", "Loan $"], ["propertyValue", "Value $"], ["fico", "FICO"]].map(([k, lab]) => (
              <div key={k}><label className="text-xs text-slate-400 block mb-1">{lab}</label><input value={sc[k]} onChange={(e) => setSc({ ...sc, [k]: e.target.value })} className={`${inp} w-full`} /></div>
            ))}
            <div><label className="text-xs text-slate-400 block mb-1">Occupancy</label><select value={sc.occupancy} onChange={(e) => setSc({ ...sc, occupancy: e.target.value })} className={`${inp} w-full`}><option value="">Any</option><option>PrimaryResidence</option><option>SecondHome</option><option>Investment</option></select></div>
            <div><label className="text-xs text-slate-400 block mb-1">Purpose</label><select value={sc.purpose} onChange={(e) => setSc({ ...sc, purpose: e.target.value })} className={`${inp} w-full`}><option value="">Any</option><option>Purchase</option><option>Refinance</option><option>CashOutRefinance</option></select></div>
            <div><label className="text-xs text-slate-400 block mb-1">Type</label><select value={sc.loanType} onChange={(e) => setSc({ ...sc, loanType: e.target.value })} className={`${inp} w-full`}><option value="">Any</option><option>Conventional</option><option>FHA</option><option>VA</option><option>Jumbo</option><option>DSCR</option><option>NonQM</option></select></div>
            <div><label className="text-xs text-slate-400 block mb-1">State</label><input value={sc.state} onChange={(e) => setSc({ ...sc, state: e.target.value })} placeholder="CA" className={`${inp} w-full`} /></div>
          </div>
          <button onClick={runCompare} disabled={comparing || !total} className="mt-3 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 rounded-lg flex items-center gap-1.5">
            {comparing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Compare all lenders
          </button>
        </div>

        {/* Results */}
        {results && (
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mt-4">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">{results.length} eligible · {filtered} filtered out</div>
            {results.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-500 text-left"><tr><th className="py-1">#</th><th>Lender</th><th>Product</th><th>Rate</th><th>Price</th><th>P&amp;I</th><th>Lock</th></tr></thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={r.id} className={`border-t border-slate-800/50 ${i === 0 ? "bg-emerald-500/10" : ""}`}>
                        <td className="py-2 text-slate-500">{i + 1}</td>
                        <td className="font-medium">{r.lenderName}</td>
                        <td className="text-slate-300">{r.productName}{r.loanType ? ` · ${r.loanType}` : ""}</td>
                        <td className="font-bold text-emerald-300">{r.noteRate != null ? r.noteRate.toFixed(3) + "%" : "—"}</td>
                        <td className="text-slate-300">{r.pricePercent != null ? r.pricePercent.toFixed(3) : "—"}</td>
                        <td className="text-slate-300">{r.monthlyPI != null ? "$" + Math.round(r.monthlyPI).toLocaleString() : "—"}</td>
                        <td className="text-slate-500">{r.lockDays ? r.lockDays + "d" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="text-slate-500 text-sm">No eligible products for that scenario. Loosen the scenario or add more lenders.</div>}
            <p className="text-xs text-slate-600 mt-3">Rates are parsed from uploaded sheets and don&apos;t yet apply LLPA adjusters — treat as a shopping shortlist, then confirm exact pricing with the lender. A PPE/API adapter would give exact, adjuster-applied pricing.</p>
          </div>
        )}
      </div>
    </div>
  );
}

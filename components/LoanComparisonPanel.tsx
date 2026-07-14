"use client";
import CurrencyInput from "@/components/ui/CurrencyInput";

// Loan Comparison — upload several lender price-quote PDFs (e.g. AD Mortgage Quick
// Pricer), Claude extracts each, the LO reviews/edits a side-by-side grid, then
// previews the branded term sheet and emails it to the borrower (PDF attached).
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Upload, Mail, Download, X, Star, Trash2, Save, FileText, Plus } from "lucide-react";
import { COMPARE_ROWS, genId, type CompareQuote, type Comparison } from "@/lib/compareTypes";

export default function LoanComparisonPanel() {
  const [quotes, setQuotes] = useState<CompareQuote[]>([]);
  const [borrowerName, setBorrowerName] = useState("");
  const [borrowerEmail, setBorrowerEmail] = useState("");
  const [note, setNote] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedNumber, setSavedNumber] = useState<string | null>(null);
  const [list, setList] = useState<Comparison[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    try { const r = await fetch("/api/compare"); if (r.ok) { const j = await r.json(); setList(j.comparisons || []); } } catch { /* */ }
  }, []);
  useEffect(() => { loadList(); }, [loadList]);

  async function extractFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true); setErr(null); setMsg(null);
    try {
      const fd = new FormData();
      Array.from(files).slice(0, 6).forEach((f) => fd.append("files", f));
      const r = await fetch("/api/compare/extract", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Couldn't read those files."); return; }
      setQuotes((prev) => [...prev, ...(j.quotes || [])]);
      setMsg(`Read ${j.read} of ${j.uploaded} file(s). Review and edit below, then preview or email.`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Extraction failed"); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  const setQ = (i: number, patch: Partial<CompareQuote>) => setQuotes((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const setStr = (i: number, key: keyof CompareQuote, v: string) => setQ(i, { [key]: v } as Partial<CompareQuote>);
  const setAmount = (i: number, v: string) => { const n = Number(v.replace(/[^0-9.]/g, "")); setQ(i, { loanAmount: isFinite(n) && n > 0 ? n : undefined }); };
  const recommend = (i: number) => setQuotes((qs) => qs.map((q, j) => ({ ...q, recommended: j === i ? !q.recommended : false })));
  const removeQuote = (i: number) => setQuotes((qs) => qs.filter((_, j) => j !== i));
  const addBlank = () => setQuotes((qs) => [...qs, { id: genId(), program: `Option ${qs.length + 1}` }]);

  function payload() {
    return { id: savedId, number: savedNumber, borrowerName, borrowerEmail, note, quotes };
  }

  async function previewPdf() {
    if (!quotes.length) { setErr("Add at least one quote first."); return; }
    setBusy("pdf"); setErr(null);
    try {
      const r = await fetch("/api/compare/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error || "PDF failed"); return; }
      const blob = await r.blob();
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (e) { setErr(e instanceof Error ? e.message : "PDF failed"); }
    finally { setBusy(null); }
  }

  async function save() {
    if (!quotes.length) { setErr("Nothing to save yet."); return; }
    setBusy("save"); setErr(null); setMsg(null);
    try {
      const r = await fetch("/api/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Save failed"); return; }
      setSavedId(j.comparison.id); setSavedNumber(j.comparison.number);
      setMsg(`Saved as ${j.comparison.number}.`); loadList();
    } catch (e) { setErr(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(null); }
  }

  async function emailBorrower() {
    if (!quotes.length) { setErr("Add at least one quote first."); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(borrowerEmail.trim())) { setErr("Enter a valid borrower email."); return; }
    if (!window.confirm(`Email this comparison (${quotes.length} option${quotes.length === 1 ? "" : "s"}) to ${borrowerEmail.trim()}?`)) return;
    setBusy("email"); setErr(null); setMsg(null);
    try {
      const r = await fetch("/api/compare/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload(), to: borrowerEmail.trim() }) });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Email failed"); return; }
      setSavedId(j.comparison.id); setSavedNumber(j.comparison.number);
      setMsg(`Emailed the comparison to ${j.sent}. ✓`); loadList();
    } catch (e) { setErr(e instanceof Error ? e.message : "Email failed"); }
    finally { setBusy(null); }
  }

  async function openSaved(id: string) {
    setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/compare?id=${encodeURIComponent(id)}`);
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Couldn't load"); return; }
      const c: Comparison = j.comparison;
      setSavedId(c.id); setSavedNumber(c.number); setQuotes(c.quotes || []);
      setBorrowerName(c.borrowerName || ""); setBorrowerEmail(c.borrowerEmail || ""); setNote(c.note || "");
      setMsg(`Loaded ${c.number}.`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Load failed"); }
  }

  function reset() { setSavedId(null); setSavedNumber(null); setQuotes([]); setBorrowerName(""); setBorrowerEmail(""); setNote(""); setMsg(null); setErr(null); }

  const input = "bg-slate-900 border border-slate-800 rounded px-2 py-1 text-[13px] text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-600/60 w-full";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="w-6 h-6 text-emerald-400" /> Loan Comparison</h1>
        <p className="text-slate-500 text-sm mt-1">Upload lender price quotes (AD Mortgage, UWM, etc.) → AI builds a side-by-side term sheet → email it to your borrower.</p>

        {/* Upload */}
        <div className="mt-5 border border-dashed border-slate-700 rounded-xl p-5 bg-slate-900/40">
          <div className="flex items-center gap-3 flex-wrap">
            <input ref={fileRef} type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={(e) => extractFiles(e.target.files)} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-semibold rounded-lg px-4 py-2.5 text-sm flex items-center gap-2">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Upload quote PDFs
            </button>
            <button onClick={addBlank} className="text-slate-300 hover:text-white text-sm flex items-center gap-1.5 border border-slate-800 rounded-lg px-3 py-2.5"><Plus className="w-4 h-4" /> Add blank column</button>
            <span className="text-[12px] text-slate-500">Up to 6 at once. PDFs or images.</span>
          </div>
        </div>

        {err && <div className="mt-3 text-red-400 text-sm">{err}</div>}
        {msg && <div className="mt-3 text-emerald-400 text-sm">{msg}</div>}

        {/* Comparison grid */}
        {quotes.length > 0 && (
          <div className="mt-5 overflow-x-auto border border-slate-800 rounded-xl">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/60">
                  <th className="text-left p-2 font-medium text-slate-500 w-40 sticky left-0 bg-slate-900/60">Loan terms</th>
                  {quotes.map((q, i) => (
                    <th key={q.id} className="p-2 min-w-[160px] align-top">
                      <div className="flex items-center gap-1">
                        <input value={q.program ?? ""} onChange={(e) => setStr(i, "program", e.target.value)} placeholder={`Option ${i + 1}`} className={input + " font-semibold"} />
                        <button onClick={() => recommend(i)} title="Mark recommended" className={`shrink-0 ${q.recommended ? "text-amber-400" : "text-slate-600 hover:text-slate-400"}`}><Star className="w-4 h-4" fill={q.recommended ? "currentColor" : "none"} /></button>
                        <button onClick={() => removeQuote(i)} title="Remove" className="shrink-0 text-slate-600 hover:text-red-400"><X className="w-4 h-4" /></button>
                      </div>
                      {q.recommended && <div className="text-[10px] text-amber-400 mt-0.5">★ Recommended</div>}
                      {q.sourceFile && <div className="text-[10px] text-slate-600 mt-0.5 truncate">{q.sourceFile}</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((row) => (
                  <tr key={String(row.key)} className="border-b border-slate-900/60">
                    <td className="p-2 text-slate-400 sticky left-0 bg-slate-950">{row.label}</td>
                    {quotes.map((q, i) => (
                      <td key={q.id} className="p-1.5">
                        {row.key === "loanAmount"
                          ? <CurrencyInput value={String(q.loanAmount ?? "")} onChange={(v) => setAmount(i, v)} placeholder="—" className={input} />
                          : <input value={(q[row.key] as string) ?? ""} onChange={(e) => setStr(i, row.key, e.target.value)} placeholder="—" className={input} />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Borrower + actions */}
        {quotes.length > 0 && (
          <div className="mt-5 grid md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-wide text-slate-500">Borrower name</label>
              <input value={borrowerName} onChange={(e) => setBorrowerName(e.target.value)} placeholder="Jordan Smith" className={input} />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-wide text-slate-500">Borrower email</label>
              <input value={borrowerEmail} onChange={(e) => setBorrowerEmail(e.target.value)} placeholder="jordan@email.com" className={input} />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-wide text-slate-500">Note to borrower (optional)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Here are the options we discussed…" className={input} />
            </div>
          </div>
        )}

        {quotes.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-3">
            <button onClick={previewPdf} disabled={!!busy} className="bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg px-4 py-2.5 text-sm font-medium flex items-center gap-2">
              {busy === "pdf" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Preview / download PDF
            </button>
            <button onClick={save} disabled={!!busy} className="bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg px-4 py-2.5 text-sm font-medium flex items-center gap-2">
              {busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
            </button>
            <button onClick={emailBorrower} disabled={!!busy} className="bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold rounded-lg px-4 py-2.5 text-sm flex items-center gap-2">
              {busy === "email" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Email to borrower
            </button>
            <button onClick={reset} className="text-slate-500 hover:text-slate-300 text-sm px-3 py-2.5">New comparison</button>
          </div>
        )}

        {/* Saved comparisons */}
        {list.length > 0 && (
          <div className="mt-10">
            <h2 className="text-sm font-semibold text-slate-400 mb-2">Saved comparisons</h2>
            <div className="space-y-1.5">
              {list.slice(0, 20).map((c) => (
                <div key={c.id} className="flex items-center gap-3 bg-slate-900/50 border border-slate-800 rounded-lg px-3 py-2 text-sm">
                  <button onClick={() => openSaved(c.id)} className="text-emerald-400 hover:text-emerald-300 font-medium">{c.number}</button>
                  <span className="text-slate-300 truncate">{c.borrowerName || "—"}</span>
                  <span className="text-slate-600 text-[12px]">{c.quotes?.length || 0} option(s)</span>
                  {c.emailed_to?.length ? <span className="text-[11px] text-emerald-500/80">✉ sent</span> : null}
                  <span className="ml-auto text-[11px] text-slate-600">{new Date(c.created_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

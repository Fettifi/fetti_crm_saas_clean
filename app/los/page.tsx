"use client";

// LOS pipeline board — every loan file by stage, with document progress and a
// one-click copy of the borrower's custom document link.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, Link2, Check, Plus, FileUp, CheckSquare, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { borrowerCode } from "@/lib/borrowerCode";

const STAGES = ["Application", "Processing", "Underwriting", "Approved", "Clear to Close", "Funded", "Closed"];

type Docs = { total: number; received: number; required: number; requiredReceived: number };
type File = { id: string; file_number: string; borrower_name: string; product: string; stage: string; status: string; share_token: string; loan_amount: number; docs: Docs };

export default function LosBoard() {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  // "New file from lead" picker.
  const [picker, setPicker] = useState(false);
  const [leadOpts, setLeadOpts] = useState<{ id: string; label: string }[]>([]);
  const [picked, setPicked] = useState("");
  const [creating, setCreating] = useState(false);
  // "New file" — start a fresh file for a borrower who isn't a lead yet.
  const [newForm, setNewForm] = useState(false);
  const [nf, setNf] = useState({ borrower: "", email: "", phone: "", product: "" });
  const [creatingNew, setCreatingNew] = useState(false);
  // "New file from MISMO 1003 XML".
  const xmlRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [remindOneState, setRemindOneState] = useState<{ id: string; msg: string } | null>(null);
  // Bulk delete: a select mode + a set of selected file ids.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [purgeStorage, setPurgeStorage] = useState(true);
  const [bulkBusy, setBulkBusy] = useState(false);

  async function importMismoNew(f: globalThis.File) {
    setImporting(`Importing ${f.name}…`);
    try {
      const fd = new FormData(); fd.append("xml", f);
      const r = await fetch("/api/los/import-mismo", { method: "POST", body: fd });
      const j = await r.json();
      if (r.ok && j.fileId) {
        setImporting(`✓ Created ${j.fileNumber} for ${(j.summary?.borrowerNames || []).join(", ") || "borrower"} — opening…`);
        window.location.href = `/los/${j.fileId}/1003`;
      } else { setImporting("⚠️ " + (j.error || "Import failed.")); setTimeout(() => setImporting(null), 8000); }
    } catch { setImporting("⚠️ Upload failed."); setTimeout(() => setImporting(null), 8000); }
  }

  async function load() {
    setLoading(true);
    const res = await fetch("/api/los/files");
    const j = await res.json();
    setFiles(j.files || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function copyLink(token: string) {
    const url = `${window.location.origin}/file/${token}`;
    navigator.clipboard?.writeText(url);
    setCopied(token);
    setTimeout(() => setCopied(null), 1500);
  }

  async function openPicker() {
    setPicker((v) => !v);
    if (!leadOpts.length) {
      const { data } = await supabase.from("leads")
        .select("id, full_name, email, loan_purpose")
        .order("created_at", { ascending: false }).limit(300);
      setLeadOpts((data || []).map((l: any) => ({ id: l.id, label: `${l.full_name || l.email || "Lead"}${l.loan_purpose ? ` · ${l.loan_purpose}` : ""}` })));
    }
  }
  async function createFromLead() {
    if (!picked) return;
    setCreating(true);
    try {
      const r = await fetch("/api/los/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lead_id: picked }) });
      const j = await r.json();
      if (r.ok && j.file) { setPicker(false); setPicked(""); await load(); copyLink(j.file.share_token); }
      else alert(j.error || "Could not create loan file.");
    } finally { setCreating(false); }
  }
  // Start a brand-new file for a borrower who isn't a lead yet, then open it.
  async function createNew() {
    if (!nf.borrower.trim()) return;
    setCreatingNew(true);
    try {
      const r = await fetch("/api/los/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ borrower: nf.borrower, email: nf.email, phone: nf.phone, product: nf.product }) });
      const j = await r.json();
      if (r.ok && j.file) { window.location.href = `/los/${j.file.id}`; }
      else alert(j.error || "Could not create the loan file.");
    } catch { alert("Connection error."); }
    finally { setCreatingNew(false); }
  }

  // Per-file reminder — fire it for ONE specific loan file from the queue.
  async function remindOne(fileId: string) {
    setRemindOneState({ id: fileId, msg: "…" });
    try {
      const r = await fetch(`/api/los/files/${fileId}/remind`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json();
      const msg = !r.ok ? "⚠️ " + (j.error || "failed")
        : j.missing === 0 ? "✓ all in"
        : j.sent?.length ? `✓ sent (${j.missing})` : "no email/SMS channel";
      setRemindOneState({ id: fileId, msg });
    } catch { setRemindOneState({ id: fileId, msg: "⚠️ error" }); }
    setTimeout(() => setRemindOneState((s) => (s?.id === fileId ? null : s)), 7000);
  }

  function toggleSel(id: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function exitSelect() { setSelectMode(false); setSelected(new Set()); setConfirmBulk(false); }

  async function bulkDelete() {
    if (!selected.size) return;
    setBulkBusy(true);
    try {
      const r = await fetch("/api/los/files/bulk-delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], purge: purgeStorage }),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error || "Bulk delete failed."); return; }
      setFiles((fs) => fs.filter((f) => !selected.has(f.id)));
      exitSelect();
      if (j.failed?.length) alert(`Deleted ${j.deleted}. ${j.failed.length} could not be deleted.`);
    } catch { alert("Connection error during bulk delete."); }
    finally { setBulkBusy(false); }
  }

  const active = files.filter((f) => f.status === "active");
  const funded = files.filter((f) => f.stage === "Funded").length;
  const visibleActive = active; // every active file is selectable
  const allVisibleSelected = visibleActive.length > 0 && visibleActive.every((f) => selected.has(f.id));
  function toggleSelectAll() {
    setSelected((prev) => {
      if (allVisibleSelected) return new Set();
      const n = new Set(prev); for (const f of visibleActive) n.add(f.id); return n;
    });
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">📁 Loan Files (LOS)</h1>
            <p className="text-slate-400 text-sm mt-1">{active.length} active · {funded} funded · every file has a borrower document link.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setNewForm((v) => !v); setPicker(false); }} className="flex items-center gap-2 text-sm bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold px-4 py-2 rounded-lg">
              <Plus className="w-4 h-4" /> New file
            </button>
            <button onClick={() => { openPicker(); setNewForm(false); }} className="flex items-center gap-2 text-sm bg-slate-800 hover:bg-slate-700 font-semibold px-4 py-2 rounded-lg" title="Open a loan file from an existing lead">
              <Plus className="w-4 h-4" /> From lead
            </button>
            <input ref={xmlRef} type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importMismoNew(f); e.currentTarget.value = ""; }} />
            <button onClick={() => xmlRef.current?.click()} className="flex items-center gap-2 text-sm bg-sky-600 hover:bg-sky-500 text-white font-semibold px-4 py-2 rounded-lg" title="Create a loan file from a MISMO 3.4 / Calyx Point 1003 XML export">
              <FileUp className="w-4 h-4" /> Import 1003 XML
            </button>
            <button onClick={load} className="flex items-center gap-2 text-sm bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              className={`flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg ${selectMode ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-slate-800 hover:bg-slate-700"}`}
              title="Select multiple files to delete at once">
              {selectMode ? <><X className="w-4 h-4" /> Cancel</> : <><CheckSquare className="w-4 h-4" /> Select</>}
            </button>
          </div>
        </div>

        {importing && (
          <div className="mt-4 bg-sky-950/40 border border-sky-800/40 rounded-xl px-4 py-3 text-sm text-sky-200 flex items-center gap-2">
            {importing.startsWith("✓") ? null : importing.startsWith("⚠️") ? null : <Loader2 className="w-4 h-4 animate-spin" />} {importing}
          </div>
        )}

        {newForm && (
          <div className="mt-4 bg-slate-900/60 border border-slate-800 rounded-xl p-4">
            <div className="text-sm text-slate-300 mb-2">Start a new loan file — just the borrower to begin (email / phone / loan type optional; fill the rest inside the file):</div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <input value={nf.borrower} onChange={(e) => setNf({ ...nf, borrower: e.target.value })} placeholder="Borrower / entity name *" className="sm:col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none" />
              <input value={nf.email} onChange={(e) => setNf({ ...nf, email: e.target.value })} placeholder="Email (optional)" className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none" />
              <input value={nf.phone} onChange={(e) => setNf({ ...nf, phone: e.target.value })} placeholder="Phone (optional)" className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none" />
              <input value={nf.product} onChange={(e) => setNf({ ...nf, product: e.target.value })} placeholder="Loan type — DSCR, Hard Money, FHA… (optional)" className="sm:col-span-3 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none" />
              <button onClick={createNew} disabled={!nf.borrower.trim() || creatingNew} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2">
                {creatingNew ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create &amp; open
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">Creates the borrower + a fresh loan file and opens it — request docs, complete the 1003, price, and order title from there.</p>
          </div>
        )}

        {picker && (
          <div className="mt-4 bg-slate-900/60 border border-slate-800 rounded-xl p-4">
            <div className="text-sm text-slate-300 mb-2">Pick a lead to open a loan file + borrower link:</div>
            <div className="flex flex-col sm:flex-row gap-2">
              <select value={picked} onChange={(e) => setPicked(e.target.value)} className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none">
                <option value="">— Select a lead —</option>
                {leadOpts.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
              <button onClick={createFromLead} disabled={!picked || creating} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} Create file + copy link
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">If the lead already has a file, this just opens it and copies the same link — no duplicates.</p>
          </div>
        )}

        {loading && !files.length && <div className="text-slate-500 mt-10 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
        {!loading && !files.length && <div className="text-slate-500 mt-10">No loan files yet. They open automatically when a lead applies.</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-6">
          {STAGES.map((stage) => {
            const col = files.filter((f) => f.stage === stage && f.status === "active");
            if (!col.length && stage !== "Application") return null;
            return (
              <div key={stage}>
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">{stage} <span className="text-slate-600">({col.length})</span></div>
                <div className="space-y-3">
                  {col.map((f) => {
                    const pct = f.docs.required ? (f.docs.requiredReceived / f.docs.required) * 100 : 0;
                    return (
                      <div key={f.id} className={`bg-slate-900/50 border rounded-xl p-4 ${selectMode && selected.has(f.id) ? "border-emerald-500 ring-1 ring-emerald-500/40" : "border-slate-800"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 min-w-0">
                            {selectMode && <input type="checkbox" aria-label="Select file" className="mt-1 accent-emerald-500 shrink-0 w-4 h-4 cursor-pointer" checked={selected.has(f.id)} onChange={() => toggleSel(f.id)} />}
                            <Link href={`/los/${f.id}`} className="min-w-0">
                            <div className="font-semibold truncate hover:text-emerald-400">{f.borrower_name || "Borrower"}</div>
                            <div className="text-[11px] font-mono text-slate-500 flex items-center gap-1.5">
                              <span className="text-sky-400 font-bold">{borrowerCode(f.borrower_name, f.id)}</span>
                              <span>·</span>{f.file_number}
                            </div>
                          </Link>
                          </div>
                          <button onClick={() => copyLink(f.share_token)} title="Copy borrower document link"
                            className="text-slate-400 hover:text-emerald-400 shrink-0">
                            {copied === f.share_token ? <Check className="w-4 h-4 text-emerald-400" /> : <Link2 className="w-4 h-4" />}
                          </button>
                        </div>
                        <div className="text-xs text-slate-400 mt-2 truncate">{f.product || "—"}</div>
                        <div className="flex items-center gap-2 mt-2">
                          <div className="h-1.5 bg-slate-800 rounded flex-1"><div className="h-1.5 bg-emerald-500 rounded" style={{ width: `${pct}%` }} /></div>
                          <span className="text-[11px] text-slate-500">{f.docs.requiredReceived}/{f.docs.required} docs</span>
                        </div>
                        {f.docs.required > f.docs.requiredReceived && (
                          <button onClick={() => remindOne(f.id)} disabled={remindOneState?.id === f.id && remindOneState.msg === "…"}
                            title="Email/text THIS borrower their secure link + only the documents still missing"
                            className="mt-2 w-full text-[11px] font-semibold bg-sky-600/80 hover:bg-sky-500 disabled:opacity-60 text-white rounded-lg py-1.5 flex items-center justify-center gap-1.5">
                            📨 {remindOneState?.id === f.id ? remindOneState.msg : "Remind — missing docs"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bulk-delete action bar — floats when files are selected */}
        {selectMode && selected.size > 0 && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-slate-900 border border-slate-700 shadow-2xl rounded-2xl px-4 py-2.5">
            <span className="text-sm font-semibold text-white">{selected.size} selected</span>
            <button onClick={toggleSelectAll} className="text-xs text-slate-300 hover:text-white px-2 py-1 rounded-lg hover:bg-slate-800">{allVisibleSelected ? "Clear all" : "Select all"}</button>
            <button onClick={() => setConfirmBulk(true)} className="flex items-center gap-1.5 text-sm font-semibold bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg">
              <Trash2 className="w-4 h-4" /> Delete {selected.size} file{selected.size === 1 ? "" : "s"}
            </button>
          </div>
        )}

        {/* Bulk-delete confirmation */}
        {confirmBulk && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onClick={() => !bulkBusy && setConfirmBulk(false)}>
            <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 text-red-400 font-semibold"><Trash2 className="w-5 h-5" /> Delete {selected.size} loan file{selected.size === 1 ? "" : "s"}?</div>
              <p className="text-sm text-slate-400 mt-2">This permanently removes the selected loan file{selected.size === 1 ? "" : "s"} and all of their documents, activity, and pre-approvals. It cannot be undone. (The underlying leads are not affected.)</p>
              <label className="flex items-center gap-2 text-xs text-slate-300 mt-3"><input type="checkbox" className="accent-emerald-500" checked={purgeStorage} onChange={(e) => setPurgeStorage(e.target.checked)} /> Also delete the uploaded files from storage</label>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setConfirmBulk(false)} disabled={bulkBusy} className="text-sm px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50">Cancel</button>
                <button onClick={bulkDelete} disabled={bulkBusy} className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white disabled:opacity-50">
                  {bulkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete {selected.size}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

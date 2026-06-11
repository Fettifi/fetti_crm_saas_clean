"use client";

// LOS pipeline board — every loan file by stage, with document progress and a
// one-click copy of the borrower's custom document link.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, Link2, Check, Plus } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

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

  const active = files.filter((f) => f.status === "active");
  const funded = files.filter((f) => f.stage === "Funded").length;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">📁 Loan Files (LOS)</h1>
            <p className="text-slate-400 text-sm mt-1">{active.length} active · {funded} funded · every file has a borrower document link.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={openPicker} className="flex items-center gap-2 text-sm bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold px-4 py-2 rounded-lg">
              <Plus className="w-4 h-4" /> New file from lead
            </button>
            <button onClick={load} className="flex items-center gap-2 text-sm bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>

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
                      <div key={f.id} className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
                        <div className="flex items-start justify-between gap-2">
                          <Link href={`/los/${f.id}`} className="min-w-0">
                            <div className="font-semibold truncate hover:text-emerald-400">{f.borrower_name || "Borrower"}</div>
                            <div className="text-[11px] font-mono text-slate-500">{f.file_number}</div>
                          </Link>
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
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

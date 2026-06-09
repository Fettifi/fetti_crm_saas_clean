"use client";

// The borrower's custom loan-file link: /file/<token>. Shows their file status,
// the document checklist, and lets them securely upload documents — which land
// in the LOS, mark the checklist, and notify the team via the activity stream.
import { useCallback, useEffect, useRef, useState } from "react";
import { use } from "react";
import { CheckCircle2, Clock, Upload, Loader2, FileText, ShieldCheck } from "lucide-react";
import { LICENSING_SHORT } from "@/lib/legal";

type Doc = { id: string; name: string; category: string; required: boolean; status: string; file_name?: string };
type FileInfo = { file_number: string; borrower_name: string; product: string; stage: string; status: string; property_address?: string; state?: string };

const STAGES = ["Application", "Processing", "Underwriting", "Approved", "Clear to Close", "Funded"];

export default function BorrowerFilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [file, setFile] = useState<FileInfo | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busyDoc, setBusyDoc] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/file/${token}`);
    if (!res.ok) { setNotFound(true); setLoading(false); return; }
    const j = await res.json();
    setFile(j.file); setDocs(j.documents); setLoading(false);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function upload(docId: string | null, f: File) {
    setBusyDoc(docId || "new");
    const fd = new FormData();
    fd.append("file", f);
    if (docId) fd.append("doc_id", docId);
    try {
      const res = await fetch(`/api/file/${token}/upload`, { method: "POST", body: fd });
      if (res.ok) await load();
    } finally { setBusyDoc(null); }
  }

  if (loading) return <Center><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></Center>;
  if (notFound || !file) return <Center><p className="text-slate-400">This link is invalid or has expired. Please contact your Fetti specialist.</p></Center>;

  const received = docs.filter((d) => d.status !== "needed").length;
  const stageIdx = Math.max(0, STAGES.indexOf(file.stage));

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="flex items-center gap-2">
          <img src="/fetti-emblem.png" alt="Fetti Financial Services LLC logo" width={34} height={34} className="w-[34px] h-[34px]" />
          <div className="text-emerald-400 font-extrabold text-lg">Fetti<span className="text-white"> Financial Services</span> <span className="text-white/60 text-[0.7em] font-bold align-middle">LLC</span></div>
        </div>
        <h1 className="text-2xl font-bold mt-4">Welcome{file.borrower_name ? `, ${file.borrower_name.split(" ")[0]}` : ""} 👋</h1>
        <p className="text-slate-400 mt-1">Your secure loan file · <span className="font-mono text-slate-300">{file.file_number}</span></p>

        {/* Status / pipeline */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mt-6">
          <div className="text-sm text-slate-400">{file.product || "Your loan"}{file.property_address ? ` · ${file.property_address}` : ""}</div>
          <div className="flex items-center gap-1 mt-4 overflow-x-auto">
            {STAGES.map((s, i) => (
              <div key={s} className="flex items-center shrink-0">
                <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${i <= stageIdx ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-500"}`}>
                  {i < stageIdx ? <CheckCircle2 className="w-3.5 h-3.5" /> : i === stageIdx ? <Clock className="w-3.5 h-3.5" /> : null}
                  {s}
                </div>
                {i < STAGES.length - 1 && <div className={`w-3 h-px ${i < stageIdx ? "bg-emerald-500/40" : "bg-slate-700"}`} />}
              </div>
            ))}
          </div>
        </div>

        {/* Documents */}
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your documents</h2>
            <span className="text-sm text-slate-400">{received}/{docs.length} uploaded</span>
          </div>
          <div className="h-2 bg-slate-800 rounded mt-2"><div className="h-2 bg-emerald-500 rounded transition-all" style={{ width: `${docs.length ? (received / docs.length) * 100 : 0}%` }} /></div>

          <div className="space-y-2 mt-4">
            {docs.map((d) => {
              const got = d.status !== "needed";
              return (
                <div key={d.id} className="flex items-center justify-between bg-slate-900/40 border border-slate-800 rounded-xl px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {got ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <FileText className="w-4 h-4 text-slate-500 shrink-0" />}
                      <span className="font-medium truncate">{d.name}</span>
                      {d.required && !got && <span className="text-[10px] text-amber-400/80 shrink-0">required</span>}
                    </div>
                    {got && <div className="text-xs text-slate-500 mt-0.5 ml-6">{d.status === "accepted" ? "Accepted ✓" : d.status === "rejected" ? "Needs another copy" : "Received — under review"}{d.file_name ? ` · ${d.file_name}` : ""}</div>}
                  </div>
                  <div className="shrink-0 ml-3">
                    <input ref={(el) => { fileInputs.current[d.id] = el; }} type="file" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(d.id, f); e.currentTarget.value = ""; }} />
                    <button onClick={() => fileInputs.current[d.id]?.click()} disabled={busyDoc === d.id}
                      className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${got ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold"}`}>
                      {busyDoc === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      {got ? "Replace" : "Upload"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add anything else */}
          <div className="mt-4">
            <input ref={(el) => { fileInputs.current["new"] = el; }} type="file" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(null, f); e.currentTarget.value = ""; }} />
            <button onClick={() => fileInputs.current["new"]?.click()} disabled={busyDoc === "new"}
              className="w-full border border-dashed border-slate-700 hover:border-emerald-500/60 text-slate-400 rounded-xl py-3 text-sm flex items-center justify-center gap-2">
              {busyDoc === "new" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Upload another document
            </button>
          </div>
        </div>

        <p className="text-[11px] text-slate-500 mt-6 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 shrink-0 text-emerald-500/70" /> Your documents are encrypted and visible only to your Fetti loan team.</p>
        <p className="text-[10px] text-slate-600 mt-2">{LICENSING_SHORT}</p>
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-950 flex items-center justify-center px-6 text-center">{children}</div>;
}

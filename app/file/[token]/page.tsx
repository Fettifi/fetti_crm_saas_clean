"use client";

// The borrower's custom loan-file link: /file/<token>. Shows their file status,
// the document checklist, and lets them securely upload documents — which land
// in the LOS, mark the checklist, and notify the team via the activity stream.
import { useCallback, useEffect, useRef, useState } from "react";
import { use } from "react";
import { CheckCircle2, Clock, Upload, Loader2, FileText, ShieldCheck, CalendarDays } from "lucide-react";
import { LICENSING_SHORT } from "@/lib/legal";

type Doc = { id: string; name: string; category: string; required: boolean; status: string; file_name?: string; notes?: string };
type FileInfo = { file_number: string; borrower_name: string; product: string; stage: string; status: string; property_address?: string; state?: string };

const STAGES = ["Application", "Processing", "Underwriting", "Approved", "Clear to Close", "Funded"];

export default function BorrowerFilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [file, setFile] = useState<FileInfo | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busyDoc, setBusyDoc] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const [calendly, setCalendly] = useState<string>("");
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/file/${token}`);
    if (!res.ok) { setNotFound(true); setLoading(false); return; }
    const j = await res.json();
    setFile(j.file); setDocs(j.documents); setCalendly(j.calendly || ""); setLoading(false);
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

  if (loading) return <Center><Loader2 className="w-6 h-6 animate-spin text-emerald-600" /></Center>;
  if (notFound || !file) return <Center><p className="text-slate-500">This link is invalid or has expired. Please contact your Fetti specialist.</p></Center>;

  const received = docs.filter((d) => d.status === "received" || d.status === "accepted").length;
  const stageIdx = Math.max(0, STAGES.indexOf(file.stage));

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="flex items-center gap-2">
          <img src="/fetti-emblem.png" alt="Fetti Financial Services LLC logo" width={34} height={34} className="w-[34px] h-[34px]" />
          <div className="text-emerald-600 font-extrabold text-lg">Fetti<span className="text-slate-900"> Financial Services</span> <span className="text-slate-400 text-[0.7em] font-bold align-middle">LLC</span></div>
        </div>
        <h1 className="text-2xl font-bold mt-4">Welcome{file.borrower_name ? `, ${file.borrower_name.split(" ")[0]}` : ""} 👋</h1>
        <p className="text-slate-500 mt-1">Your secure loan file · <span className="font-mono text-slate-600">{file.file_number}</span></p>

        {/* Book a call */}
        {calendly && (
          <a href={calendly} target="_blank" rel="noreferrer"
            className="mt-5 flex items-center justify-center gap-2 w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-2xl py-3 text-sm">
            <CalendarDays className="w-4 h-4" /> Book a call with your Fetti specialist
          </a>
        )}

        {/* Status / pipeline */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 mt-6">
          <div className="text-sm text-slate-500">{file.product || "Your loan"}{file.property_address ? ` · ${file.property_address}` : ""}</div>
          <div className="flex items-center gap-1 mt-4 overflow-x-auto">
            {STAGES.map((s, i) => (
              <div key={s} className="flex items-center shrink-0">
                <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${i <= stageIdx ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                  {i < stageIdx ? <CheckCircle2 className="w-3.5 h-3.5" /> : i === stageIdx ? <Clock className="w-3.5 h-3.5" /> : null}
                  {s}
                </div>
                {i < STAGES.length - 1 && <div className={`w-3 h-px ${i < stageIdx ? "bg-emerald-600/40" : "bg-slate-700"}`} />}
              </div>
            ))}
          </div>
        </div>

        {/* Documents */}
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your documents</h2>
            <span className="text-sm text-slate-500">{received}/{docs.length} uploaded</span>
          </div>
          <div className="h-2 bg-slate-100 rounded mt-2"><div className="h-2 bg-emerald-600 rounded transition-all" style={{ width: `${docs.length ? (received / docs.length) * 100 : 0}%` }} /></div>
          <p className="text-xs text-slate-500 mt-2">Tap <span className="font-medium text-slate-700">Upload</span> next to each item to send it securely — ID, bank statements, pay stubs, and anything else listed. Your file moves forward as documents come in.</p>

          <div className="space-y-2 mt-4">
            {docs.map((d) => {
              const uploaded = d.status === "received" || d.status === "accepted";
              const rejected = d.status === "rejected";
              return (
                <div key={d.id} className={`flex items-center justify-between border rounded-xl px-4 py-3 ${rejected ? "bg-red-50 border-red-200" : "bg-white border-slate-200"}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {uploaded ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <FileText className={`w-4 h-4 shrink-0 ${rejected ? "text-red-500" : "text-slate-400"}`} />}
                      <span className="font-medium truncate">{d.name}</span>
                      {d.required && !uploaded && <span className="text-[10px] text-amber-500 shrink-0">required</span>}
                    </div>
                    {uploaded && <div className="text-xs text-slate-400 mt-0.5 ml-6">{d.status === "accepted" ? "Accepted ✓" : "Received — under review"}{d.file_name ? ` · ${d.file_name}` : ""}</div>}
                    {rejected && <div className="text-xs text-red-600 font-medium mt-0.5 ml-6">❗ Please re-upload{d.notes ? ` — ${d.notes}` : ""}</div>}
                  </div>
                  <div className="shrink-0 ml-3">
                    <input ref={(el) => { fileInputs.current[d.id] = el; }} type="file" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(d.id, f); e.currentTarget.value = ""; }} />
                    <button onClick={() => fileInputs.current[d.id]?.click()} disabled={busyDoc === d.id}
                      className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${uploaded ? "bg-slate-100 hover:bg-slate-200 text-slate-600" : rejected ? "bg-red-600 hover:bg-red-500 text-white font-semibold" : "bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"}`}>
                      {busyDoc === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      {uploaded ? "Replace" : rejected ? "Re-upload" : "Upload"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add another document — ask which item it is so it lands in the right slot (never a duplicate) */}
          <div className="mt-4">
            <input ref={(el) => { fileInputs.current["new"] = el; }} type="file" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) setPending(f); e.currentTarget.value = ""; }} />
            <button onClick={() => fileInputs.current["new"]?.click()} disabled={busyDoc === "new"}
              onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
              onDragLeave={() => setDropping(false)}
              onDrop={(e) => { e.preventDefault(); setDropping(false); const f = e.dataTransfer.files?.[0]; if (f) setPending(f); }}
              className={`w-full border border-dashed rounded-xl py-5 text-sm flex items-center justify-center gap-2 transition ${dropping ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 hover:border-emerald-300 text-slate-500"}`}>
              {busyDoc === "new" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {dropping ? "Drop to upload" : "Upload another document"}
            </button>
          </div>

          {/* "Which document is this?" — routes the file to the right checklist item so it
              satisfies that requirement instead of creating a duplicate/orphan. */}
          {pending && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setPending(null)}>
              <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <h3 className="font-semibold text-slate-900">Which document is this?</h3>
                <p className="text-xs text-slate-500 mt-1 truncate">📎 {pending.name}</p>
                <div className="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
                  {docs.filter((d) => d.status === "needed" || d.status === "rejected").map((d) => (
                    <button key={d.id} onClick={async () => { const f = pending; setPending(null); if (f) await upload(d.id, f); }}
                      className="w-full text-left text-sm px-3 py-2 rounded-lg bg-slate-50 hover:bg-emerald-50 hover:text-emerald-700 text-slate-700">
                      {d.name}{d.required ? "  ·  required" : ""}
                    </button>
                  ))}
                  <button onClick={async () => { const f = pending; setPending(null); if (f) await upload(null, f); }}
                    className="w-full text-left text-sm px-3 py-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-500">
                    It&apos;s something else (additional document)
                  </button>
                </div>
                <button onClick={() => setPending(null)} className="mt-3 text-xs text-slate-400 hover:text-slate-600">Cancel</button>
              </div>
            </div>
          )}
        </div>

        <p className="text-[11px] text-slate-400 mt-6 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 shrink-0 text-emerald-500/70" /> Your documents are encrypted and visible only to your Fetti loan team.</p>
        <p className="text-[10px] text-slate-400 mt-2">{LICENSING_SHORT}</p>
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-white flex items-center justify-center px-6 text-center">{children}</div>;
}

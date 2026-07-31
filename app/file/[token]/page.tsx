"use client";

// The borrower's custom loan-file link: /file/<token>. Shows their file status,
// the document checklist, and lets them securely upload documents — which land
// in the LOS, mark the checklist, and notify the team via the activity stream.
import { useCallback, useEffect, useRef, useState } from "react";
import { use } from "react";
import { CheckCircle2, Clock, Upload, Loader2, FileText, ShieldCheck, CalendarDays } from "lucide-react";
import { LICENSING_SHORT } from "@/lib/legal";
import { isBusinessCreditDeal } from "@/lib/bizApp";

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
  const [pending, setPending] = useState<File[]>([]);
  const [calendly, setCalendly] = useState<string>("");
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/file/${token}`);
    if (!res.ok) { setNotFound(true); setLoading(false); return; }
    const j = await res.json();
    setFile(j.file); setDocs(j.documents); setCalendly(j.calendly || ""); setLoading(false);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // Upload one OR MORE files to the same checklist item, SEQUENTIALLY. The first file
  // satisfies the request; each additional file is kept as its own document (the server
  // never overwrites). Sequential so the request→satisfied transition lands before the
  // next file, which then attaches as an additional doc to that same item.
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  // Business profile — shown only on business-purpose files. These applicants came through
  // the mortgage-shaped intake, so their file has no entity, revenue or debt schedule; the
  // magic apply link only restores contact details, so asking them to "finish the
  // application" would mean starting over. Nine fields on the link they already have.
  const [biz, setBiz] = useState<Record<string, string>>({});
  const [bizSaving, setBizSaving] = useState(false);
  const [bizSaved, setBizSaved] = useState(false);
  const [bizErr, setBizErr] = useState<string | null>(null);
  async function uploadMany(docId: string | null, files: File[]) {
    if (!files.length) return;
    setBusyDoc(docId || "new");
    setUploadErr(null);
    const failed: string[] = [];
    try {
      for (const f of files) {
        try {
          // Bank statements and tax returns are routinely over the ~4.5MB the platform
          // will accept in a request body — those never reached the server at all and the
          // borrower just saw "(too large)" with no way forward. Send anything big straight
          // to storage on a signed URL, then post only the metadata.
          if (f.size > 4 * 1024 * 1024) {
            const su = await fetch(`/api/file/${token}/upload-url`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ fileName: f.name }),
            });
            const sj = await su.json().catch(() => ({} as any));
            if (!su.ok || !sj?.url) { failed.push(`${f.name}${sj?.error ? ` (${sj.error})` : ""}`); continue; }
            const put = await fetch(sj.url, { method: "PUT", body: f, headers: { "Content-Type": f.type || "application/octet-stream" } });
            if (!put.ok) { failed.push(`${f.name} (transfer failed)`); continue; }
            const rec = await fetch(`/api/file/${token}/upload`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ storage_path: sj.path, file_name: sj.fileName, size_bytes: f.size, doc_id: docId || null }),
            });
            if (!rec.ok) { const j = await rec.json().catch(() => ({} as any)); failed.push(`${f.name}${j?.error ? ` (${j.error})` : ""}`); }
            continue;
          }
          const fd = new FormData();
          fd.append("file", f);
          if (docId) fd.append("doc_id", docId);
          const res = await fetch(`/api/file/${token}/upload`, { method: "POST", body: fd });
          if (!res.ok) {
            const j = await res.json().catch(() => ({} as any));
            failed.push(`${f.name}${j?.error ? ` (${j.error})` : res.status === 413 ? " (too large)" : ""}`);
          }
        } catch { failed.push(`${f.name} (connection failed)`); }
      }
      await load();
      // A silent failure here meant borrowers walked away believing their documents
      // went through (audit P1) — always tell them exactly which files didn't land.
      if (failed.length) setUploadErr(`These didn't upload: ${failed.join(", ")}. Please try again, or reply to your specialist and we'll take them by email.`);
    } finally { setBusyDoc(null); }
  }

  if (loading) return <Center><Loader2 className="w-6 h-6 animate-spin text-emerald-600" /></Center>;
  if (notFound || !file) return <Center><p className="text-slate-500">This link is invalid or has expired. Please contact your Fetti specialist.</p></Center>;

  const received = docs.filter((d) => d.status === "received" || d.status === "accepted").length;
  const stageIdx = Math.max(0, STAGES.indexOf(file.stage));

  const errBanner = uploadErr ? (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 max-w-md w-[92%] rounded-xl bg-red-50 border border-red-300 px-4 py-3 shadow-lg">
      <p className="text-sm text-red-700">{uploadErr}</p>
    </div>
  ) : null;
  async function saveBiz(e: React.FormEvent) {
    e.preventDefault();
    setBizSaving(true); setBizErr(null);
    try {
      const r = await fetch(`/api/file/${token}/biz`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(biz),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Could not save.");
      setBizSaved(true);
    } catch (err) {
      setBizErr(err instanceof Error ? err.message : "Could not save.");
    } finally { setBizSaving(false); }
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {errBanner}
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="flex items-center gap-2">
          <img src="/fetti-emblem.png" alt="Fetti Financial Services LLC logo" width={34} height={34} className="w-[34px] h-[34px]" />
          <div className="text-emerald-600 font-extrabold text-lg">Fetti<span className="text-slate-900"> Financial Services</span> <span className="text-slate-400 text-[0.7em] font-bold align-middle">LLC</span></div>
        </div>
        <h1 className="text-2xl font-bold mt-4">Welcome{file.borrower_name ? `, ${file.borrower_name.split(" ")[0]}` : ""} 👋</h1>
        <p className="text-slate-500 mt-1">{file.file_number ? <>Your secure loan file · <span className="font-mono text-slate-600">{file.file_number}</span></> : "Upload your documents securely below to get started."}</p>

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

        {/* Business profile — business-purpose files only. */}
        {isBusinessCreditDeal(file.product, null) && (
          <div className="mt-6 border border-slate-200 rounded-2xl p-5">
            <div className="font-bold">About your business</div>
            <p className="text-slate-500 text-sm mt-1">
              A few details funders ask for. Takes about two minutes and it&apos;s the fastest way to get real terms.
            </p>
            {bizSaved ? (
              <div className="mt-4 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-3">
                Got it — thank you. That&apos;s everything we needed on the business side.
              </div>
            ) : (
              <form onSubmit={saveBiz} className="mt-4 space-y-3">
                {([
                  ["business_name", "Legal business name", "text"],
                  ["entity_type", "Entity type (LLC, S-Corp, sole proprietor…)", "text"],
                  ["industry", "What the business does", "text"],
                  ["months_in_business", "Months in business", "number"],
                  ["annual_revenue", "Gross revenue last year ($)", "number"],
                  ["avg_monthly_deposits", "Average monthly bank deposits ($)", "number"],
                  ["use_of_proceeds", "What the funds are for", "text"],
                  ["ownership_pct", "% of the business you own", "number"],
                  ["ein", "EIN (optional)", "text"],
                ] as [string, string, string][]).map(([k, label, type]) => (
                  <div key={k}>
                    <label className="text-xs text-slate-500">{label}</label>
                    <input type={type} inputMode={type === "number" ? "numeric" : undefined}
                      value={biz[k] || ""} onChange={(e) => setBiz((b) => ({ ...b, [k]: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 focus:border-emerald-500 focus:outline-none" />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-slate-500">Any current business loans, advances or lines of credit?</label>
                  <div className="flex gap-2 mt-1">
                    {(["no", "yes"] as const).map((v) => (
                      <button key={v} type="button" onClick={() => setBiz((b) => ({ ...b, existing_biz_debt: v }))}
                        className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-semibold ${biz.existing_biz_debt === v ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}>
                        {v === "no" ? "No, nothing outstanding" : "Yes, there is some"}
                      </button>
                    ))}
                  </div>
                </div>
                {bizErr && <div className="text-sm text-red-600">{bizErr}</div>}
                <button type="submit" disabled={bizSaving}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-2xl py-3 text-sm">
                  {bizSaving ? "Saving…" : "Save business details"}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Documents */}
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your documents</h2>
            <span className="text-sm text-slate-500">{received}/{docs.length} uploaded</span>
          </div>
          <div className="h-2 bg-slate-100 rounded mt-2"><div className="h-2 bg-emerald-600 rounded transition-all" style={{ width: `${docs.length ? (received / docs.length) * 100 : 0}%` }} /></div>
          <p className="text-xs text-slate-500 mt-2">Tap <span className="font-medium text-slate-700">Upload</span> next to each item to send it securely — ID, bank statements, pay stubs, and anything else listed. You can attach <span className="font-medium text-slate-700">more than one file</span> to any item. Your file moves forward as documents come in.</p>

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
                    <input ref={(el) => { fileInputs.current[d.id] = el; }} type="file" multiple className="hidden"
                      onChange={(e) => { const fs = Array.from(e.target.files || []); if (fs.length) uploadMany(d.id, fs); e.currentTarget.value = ""; }} />
                    <button onClick={() => fileInputs.current[d.id]?.click()} disabled={busyDoc === d.id}
                      className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${uploaded ? "bg-slate-100 hover:bg-slate-200 text-slate-600" : rejected ? "bg-red-600 hover:bg-red-500 text-white font-semibold" : "bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"}`}>
                      {busyDoc === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      {uploaded ? "Add file(s)" : rejected ? "Re-upload" : "Upload"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add another document — ask which item it is so it lands in the right slot (never a duplicate) */}
          <div className="mt-4">
            <input ref={(el) => { fileInputs.current["new"] = el; }} type="file" multiple className="hidden"
              onChange={(e) => { const fs = Array.from(e.target.files || []); if (fs.length) setPending(fs); e.currentTarget.value = ""; }} />
            <button onClick={() => fileInputs.current["new"]?.click()} disabled={busyDoc === "new"}
              onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
              onDragLeave={() => setDropping(false)}
              onDrop={(e) => { e.preventDefault(); setDropping(false); const fs = Array.from(e.dataTransfer.files || []); if (fs.length) setPending(fs); }}
              className={`w-full border border-dashed rounded-xl py-5 text-sm flex items-center justify-center gap-2 transition ${dropping ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 hover:border-emerald-300 text-slate-500"}`}>
              {busyDoc === "new" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {dropping ? "Drop to upload" : "Upload another document"}
            </button>
          </div>

          {/* "Which document is this?" — routes the file to the right checklist item so it
              satisfies that requirement instead of creating a duplicate/orphan. */}
          {pending.length > 0 && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setPending([])}>
              <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <h3 className="font-semibold text-slate-900">{pending.length === 1 ? "Which document is this?" : "Which item are these files for?"}</h3>
                <p className="text-xs text-slate-500 mt-1 truncate">📎 {pending.length === 1 ? pending[0].name : `${pending.length} files selected`}</p>
                <div className="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
                  {docs.filter((d) => d.status === "needed" || d.status === "rejected").map((d) => (
                    <button key={d.id} onClick={async () => { const fs = pending; setPending([]); if (fs.length) await uploadMany(d.id, fs); }}
                      className="w-full text-left text-sm px-3 py-2 rounded-lg bg-slate-50 hover:bg-emerald-50 hover:text-emerald-700 text-slate-700">
                      {d.name}{d.required ? "  ·  required" : ""}
                    </button>
                  ))}
                  <button onClick={async () => { const fs = pending; setPending([]); if (fs.length) await uploadMany(null, fs); }}
                    className="w-full text-left text-sm px-3 py-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-500">
                    {pending.length === 1 ? "It’s something else (additional document)" : "They’re something else (additional documents)"}
                  </button>
                </div>
                <button onClick={() => setPending([])} className="mt-3 text-xs text-slate-400 hover:text-slate-600">Cancel</button>
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

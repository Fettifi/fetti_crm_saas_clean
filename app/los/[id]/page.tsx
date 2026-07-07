"use client";

// Loan file detail for the loan officer: stage control, document review (view /
// accept / reject / request), compliance checklist, the borrower's custom link,
// and the full activity timeline for this file.
import { useCallback, useEffect, useRef, useState } from "react";
import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Link2, Check, ArrowLeft, Plus, ExternalLink, Send, X, Trash2 } from "lucide-react";
import { borrowerCode } from "@/lib/borrowerCode";
import DeleteConfirm from "@/components/DeleteConfirm";
import ConditionsImporter from "@/components/los/ConditionsImporter";
import IncomeQualifier from "@/components/los/IncomeQualifier";
import CardAuthPanel from "@/components/los/CardAuthPanel";

const STAGES = ["Application", "Processing", "Underwriting", "Approved", "Clear to Close", "Funded", "Closed"];

type Doc = { id: string; name: string; category: string; required: boolean; status: string; file_name?: string; storage_path?: string; notes?: string; borrowerName?: string | null };
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
  const [codeCopied, setCodeCopied] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  const [linkMsg, setLinkMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const [newDoc, setNewDoc] = useState("");
  const [saving, setSaving] = useState(false);
  // In-app document viewer — streams the file through our OWN origin (inline) so it
  // loads under CSP `frame-src 'self'` (framing the cross-origin Supabase URL was
  // blocked: "This content is blocked"). Works for PDFs and image docs.
  const [viewer, setViewer] = useState<{ url: string; name: string; isImage?: boolean } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [docBusy, setDocBusy] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<{ id: string; name: string } | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const uploadTargetRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [delOpen, setDelOpen] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  async function deleteFile(purge: boolean) {
    setDelBusy(true);
    try {
      const r = await fetch(`/api/los/files/${id}?purge=${purge ? 1 : 0}`, { method: "DELETE" });
      if (r.ok) { router.push("/los"); return; }
      const j = await r.json().catch(() => ({})); alert(j.error || "Delete failed.");
    } catch { alert("Connection error deleting the file."); }
    setDelBusy(false);
  }
  // In-file document request composer.
  const [reqList, setReqList] = useState<string[]>([]);
  // Recipient = a borrower INDEX ("0", "1", …) on this file, or "other" (custom).
  const [recipient, setRecipient] = useState<string>("0");
  const [docFilter, setDocFilter] = useState<string>("all"); // doc list filter: "all" or a borrower name
  const [other, setOther] = useState({ name: "", email: "", phone: "" });
  const [reqNote, setReqNote] = useState("");
  const sendDocRef = useRef<HTMLInputElement>(null);
  const [titleCo, setTitleCo] = useState({ company: "", contact: "", email: "", closing: "" });
  const [sendingReq, setSendingReq] = useState(false);
  const [reqMsg, setReqMsg] = useState<{ ok?: boolean; text: string } | null>(null);
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
    try { const sr = await fetch(`/api/los/screen?file=${id}`); if (sr.ok) { const sj = await sr.json(); if (sj.screen) setScreen(sj.screen); } } catch {}
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function patchFile(patch: any) {
    setSaving(true);
    await fetch(`/api/los/files/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    await load(); setSaving(false);
  }
  async function patchDoc(doc_id: string, status: string, notes?: string) {
    await fetch(`/api/los/files/${id}/docs`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc_id, status, ...(notes !== undefined ? { notes } : {}) }) });
    await load();
  }
  // Reject WITH a reason — sets the doc to "rejected" + the note, which re-adds it to
  // the borrower's missing items and shows them WHY on their portal + in the reminder.
  async function confirmReject() {
    if (!rejectTarget) return;
    setDocBusy(rejectTarget.id);
    try { await patchDoc(rejectTarget.id, "rejected", rejectNote.trim()); }
    finally { setDocBusy(null); setRejectTarget(null); setRejectNote(""); }
  }
  function addToReq(name: string) {
    const n = name.trim();
    if (!n) return;
    setReqList((l) => (l.includes(n) ? l : [...l, n]));
    setNewDoc("");
  }
  // The borrowers on this file (from the 1003), each with their OWN contact — so a
  // co-borrower's link/request goes to THEIR email/phone, not the primary's.
  const borrowers = ((mismo?.urla?.borrowers as any[]) || []).map((b: any, i: number) => ({
    index: i,
    name: b.fullName || [b.firstName, b.lastName].filter(Boolean).join(" ") || (i === 0 ? (file?.borrower_name || "Borrower 1") : `Borrower ${i + 1}`),
    email: b.email || (i === 0 ? file?.email : null) || null,
    phone: b.cellPhone || b.homePhone || (i === 0 ? file?.phone : null) || null,
  }));
  // Resolve the currently-selected recipient to { to_name, to_email, to_phone }.
  function recipientContact(): { to_name: string | null; to_email: string | null; to_phone: string | null } {
    if (recipient === "other") return { to_name: other.name || null, to_email: other.email || null, to_phone: other.phone || null };
    const b = borrowers[Number(recipient)] || borrowers[0];
    return { to_name: b?.name || file?.borrower_name || null, to_email: b?.email || null, to_phone: b?.phone || null };
  }
  // The borrower name to ATTRIBUTE requested docs to (null for "someone else" = shared).
  function recipientBorrowerName(): string | null { return recipient === "other" ? null : (borrowers[Number(recipient)]?.name || null); }
  // Doc list filtered by the borrower toggle. Untagged docs (seeded checklist) belong to
  // the primary borrower's view. "all" shows everyone's, each with a borrower badge.
  const primaryName = borrowers[0]?.name || null;
  const shownDocs = docFilter === "all" ? docs : docs.filter((d) => (d.borrowerName || null) === docFilter || (docFilter === primaryName && !d.borrowerName));

  async function addOnly() {
    if (!reqList.length) { setReqMsg({ text: "Add at least one document." }); return; }
    setSendingReq(true); setReqMsg(null);
    await fetch(`/api/los/files/${id}/docs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: reqList, borrowerName: recipientBorrowerName() }) });
    setReqList([]); setReqMsg({ ok: true, text: "Added to checklist." }); setSendingReq(false); await load();
  }
  async function sendRequest() {
    if (!reqList.length) { setReqMsg({ text: "Add at least one document to request." }); return; }
    const notify: any = recipientContact();
    if (!notify.to_email && !notify.to_phone) {
      setReqMsg({ text: recipient === "other" ? "Add an email or phone for the recipient." : "No email/phone on file for this borrower — add it on the 1003, or use “Someone else”." });
      return;
    }
    if (reqNote.trim()) notify.note = reqNote.trim();
    setSendingReq(true); setReqMsg(null);
    try {
      const r = await fetch(`/api/los/files/${id}/docs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: reqList, notify, borrowerName: recipientBorrowerName() }) });
      const j = await r.json();
      if (r.ok) {
        const ch = (j.sent || []).join(" + ");
        setReqMsg({ ok: !!ch, text: ch ? `✓ Sent via ${ch} with the file link` : "Added to the file, but no email/SMS channel is configured to deliver it yet." });
        setReqList([]); setReqNote("");
        await load();
      } else setReqMsg({ text: "⚠️ " + (j.error || "Failed") });
    } catch { setReqMsg({ text: "⚠️ Connection error" }); }
    setSendingReq(false);
  }
  // One click: email/text the borrower their secure link + ONLY the docs still missing.
  // Adds nothing to the checklist (no duplicates) — just re-requests what's outstanding.
  async function remindMissing() {
    setSendingReq(true); setReqMsg(null);
    try {
      const r = await fetch(`/api/los/files/${id}/remind`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(recipientContact()) });
      const j = await r.json();
      if (r.ok) {
        if (j.missing === 0) setReqMsg({ ok: true, text: "✓ All documents are already in — nothing to request." });
        else if (j.sent?.length) setReqMsg({ ok: true, text: `✓ Reminder for ${j.missing} missing doc(s) sent via ${j.sent.join(" + ")}.` });
        else setReqMsg({ text: "Found missing docs, but no email/SMS channel delivered — check the borrower's contact." });
        await load();
      } else setReqMsg({ text: "⚠️ " + (j.error || "Failed") });
    } catch { setReqMsg({ text: "⚠️ Connection error" }); }
    setSendingReq(false);
  }
  function viewDoc(doc_id: string, name: string) {
    // Open each document in its OWN window so the LO can keep working in the CRM
    // while a document is up. The stream is same-origin + session-gated, so the new
    // window is authenticated by the session cookie. A stable per-doc window name
    // means re-clicking View focuses that doc's existing window instead of duplicating.
    const url = `/api/los/files/${id}/docs?doc_id=${doc_id}&inline=1`;
    const w = window.open(url, `fettidoc_${doc_id}`, "popup=yes,width=1000,height=1200,resizable=yes,scrollbars=yes");
    if (w) { try { w.focus(); } catch { /* */ } return; }
    // Popup blocked (browser only) — fall back to the in-app viewer overlay.
    const isImage = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(name || "");
    setZoom(1);
    setViewer({ url, name, isImage });
  }
  // LO uploads a file directly into the file. target = a doc_id (satisfy that item) or
  // "new" (add it as a fresh item — e.g. something the borrower emailed you).
  function pickUpload(target: string) { uploadTargetRef.current = target; fileInputRef.current?.click(); }
  async function onFilePicked(e: any) {
    const f = e.target.files?.[0]; e.target.value = "";
    const target = uploadTargetRef.current; uploadTargetRef.current = null;
    if (!f || !target) return;
    setDocBusy(target);
    try {
      const fd = new FormData(); fd.append("file", f);
      if (target !== "new") fd.append("doc_id", target);
      const r = await fetch(`/api/los/files/${id}/upload`, { method: "POST", body: fd });
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || "Upload failed."); }
      await load();
    } catch { alert("Connection error during upload."); } finally { setDocBusy(null); }
  }
  async function removeDoc(docId: string, name: string) {
    if (!confirm(`Remove "${name}" from this file's checklist? If a file was uploaded for it, that file is deleted too.`)) return;
    setDocBusy(docId);
    try {
      const r = await fetch(`/api/los/files/${id}/docs?doc_id=${docId}`, { method: "DELETE" });
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || "Remove failed."); }
      await load();
    } catch { alert("Connection error removing the item."); } finally { setDocBusy(null); }
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
  async function sendBorrowerLink() {
    if (!file) return;
    setSendingLink(true); setLinkMsg(null);
    try {
      const r = await fetch(`/api/los/files/${id}/send-link`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(recipientContact()) });
      const j = await r.json();
      setLinkMsg({ ok: r.ok && (j.sent?.length > 0), text: r.ok ? j.message : (j.error || "Failed to send.") });
    } catch { setLinkMsg({ text: "⚠️ Connection error." }); }
    setSendingLink(false);
    setTimeout(() => setLinkMsg(null), 9000);
  }

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>;
  if (!file) return <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center">Loan file not found.</div>;

  const badge = (s: string) => s === "accepted" ? "text-emerald-400" : s === "received" ? "text-yellow-400" : s === "rejected" ? "text-red-400" : "text-slate-500";
  const code = borrowerCode(file.borrower_name, file.id);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        <Link href="/los" className="text-slate-400 hover:text-white text-sm flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Loan files</Link>

        <div className="flex flex-wrap items-start justify-between gap-3 mt-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold">{file.borrower_name || "Borrower"}</h1>
              <button
                onClick={() => { navigator.clipboard?.writeText(code); setCodeCopied(true); setTimeout(() => setCodeCopied(false), 1500); }}
                title="Borrower code — identifies this borrower's secure link (not their SSN/DOB). Click to copy."
                className="font-mono text-xs font-bold tracking-wider bg-sky-500/15 text-sky-300 border border-sky-500/30 rounded-full px-2.5 py-1 hover:bg-sky-500/25"
              >{code}{codeCopied ? " ✓" : ""}</button>
            </div>
            <div className="text-sm text-slate-400 mt-1 font-mono">{file.file_number} · {file.product || "—"}{file.occupancy ? ` · ${file.occupancy}` : ""}</div>
            <div className="text-sm text-slate-500 mt-1">{[file.email, file.phone, file.property_address, file.state].filter(Boolean).join(" · ")}</div>
            {file.property_address && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(file.property_address)}`} target="_blank" rel="noreferrer" className="text-xs text-emerald-400 hover:underline">🗺️ View property on map</a>}
          </div>
          <div className="flex flex-col items-end gap-1">
            {borrowers.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap justify-end mb-0.5">
                <span className="text-[11px] text-slate-500">Send link to:</span>
                {borrowers.map((b) => (
                  <button key={b.index} onClick={() => setRecipient(String(b.index))} title={[b.email, b.phone].filter(Boolean).join(" · ") || "no contact on file"}
                    className={`text-[11px] px-2 py-0.5 rounded-full ${recipient === String(b.index) ? "bg-emerald-500 text-slate-950 font-semibold" : "bg-slate-800 text-slate-300"}`}>
                    {b.name.split(" ")[0]}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button onClick={sendBorrowerLink} disabled={sendingLink} className="flex items-center gap-2 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-semibold px-3 py-2 rounded-lg">
                {sendingLink ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send upload link
              </button>
              <button onClick={copyLink} className="flex items-center gap-2 text-sm bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg">
                {copied ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />} {copied ? "Copied!" : "Copy link"}
              </button>
              <a href={`/file/${file.share_token}`} target="_blank" className="text-slate-400 hover:text-white p-2" title="Preview the borrower portal"><ExternalLink className="w-4 h-4" /></a>
              <a href={`/scenarios?loan_file_id=${id}`} className="flex items-center gap-2 text-sm bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg" title="Build a wholesaler pricing scenario from this file">📑 Price this deal</a>
              <button onClick={() => setDelOpen(true)} title="Delete this loan file permanently" className="flex items-center gap-1.5 text-sm bg-slate-800 hover:bg-red-900/60 text-red-300 px-3 py-2 rounded-lg"><Trash2 className="w-4 h-4" /> Delete</button>
            </div>
            {linkMsg && <span className={`text-xs ${linkMsg.ok ? "text-emerald-400" : "text-amber-300"}`}>{linkMsg.text}</span>}
            <span className="text-[11px] text-slate-500">Texts/emails {(recipient === "other" ? (other.name || "the recipient") : (borrowers[Number(recipient)]?.name || file.borrower_name || "the borrower")).split(" ")[0]} their secure link for file <span className="font-mono text-sky-300">{code}</span></span>
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
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Documents & conditions</div>
              <a href={`/esign?file=${id}`} className="text-xs font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1">✍️ Send for signature</a>
            </div>
            {borrowers.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap mb-3">
                <span className="text-[11px] text-slate-500">Outstanding for:</span>
                <button onClick={() => setDocFilter("all")} className={`text-[11px] px-2.5 py-1 rounded-full ${docFilter === "all" ? "bg-emerald-500 text-slate-950 font-semibold" : "bg-slate-800 text-slate-300"}`}>Both</button>
                {borrowers.map((b) => {
                  const cnt = docs.filter((d) => ((d.borrowerName || null) === b.name || (b.index === 0 && !d.borrowerName)) && (d.status === "needed" || d.status === "rejected")).length;
                  return <button key={b.index} onClick={() => setDocFilter(b.name)} className={`text-[11px] px-2.5 py-1 rounded-full ${docFilter === b.name ? "bg-emerald-500 text-slate-950 font-semibold" : "bg-slate-800 text-slate-300"}`}>{b.name.split(" ")[0]}{cnt ? ` · ${cnt} open` : ""}</button>;
                })}
              </div>
            )}
            <div className="space-y-2">
              {shownDocs.length === 0 && <div className="text-xs text-slate-500">No documents for this borrower yet.</div>}
              {shownDocs.map((d) => {
                const rejected = d.status === "rejected";
                // "Provided" = a file is in AND not rejected. A rejected doc reads as
                // NOT provided (re-upload needed) and stays in the missing queue.
                const provided = d.status === "received" || d.status === "accepted";
                return (
                  <div key={d.id} className={`flex items-center justify-between gap-2 border-b border-slate-800/50 pb-2 ${rejected ? "bg-red-950/20 -mx-2 px-2 rounded" : ""}`}>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{d.name} {d.required && !provided && <span className="text-[10px] text-amber-400/70">required</span>}{borrowers.length > 1 && (d.borrowerName || primaryName) && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300 align-middle">{(d.borrowerName || primaryName)!.split(" ")[0]}</span>}</div>
                      <div className={`text-xs ${badge(d.status)}`}>{rejected ? "rejected · not provided — awaiting new upload" : `${d.status}${d.file_name ? ` · ${d.file_name}` : ""}`}</div>
                      {rejected && d.notes && <div className="text-[11px] text-red-300/90 mt-0.5">↩︎ Sent back: {d.notes}</div>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {d.storage_path && <button onClick={() => viewDoc(d.id, d.name)} title={rejected ? "View the rejected copy" : "View"} className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700">View</button>}
                      <button onClick={() => pickUpload(d.id)} disabled={docBusy === d.id} title="Upload a file for this item (e.g. one the borrower emailed you)" className="text-xs px-2 py-1 rounded bg-sky-700/70 hover:bg-sky-600 disabled:opacity-50">{docBusy === d.id ? "…" : (provided ? "Replace" : "Upload")}</button>
                      {d.status === "received" && <button onClick={() => patchDoc(d.id, "accepted")} className="text-xs px-2 py-1 rounded bg-emerald-600/80 hover:bg-emerald-500">Accept</button>}
                      {(d.status === "received" || d.status === "accepted") && <button onClick={() => { setRejectTarget({ id: d.id, name: d.name }); setRejectNote(""); }} className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-red-900/60">Reject</button>}
                      <button onClick={() => removeDoc(d.id, d.name)} disabled={docBusy === d.id} title="Remove this item from the checklist" className="text-xs px-1.5 py-1 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800">🗑</button>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* LO can drop a file straight in (e.g. one the borrower emailed) — as a new
                checklist item; or use the per-row Upload to satisfy an existing item. */}
            <div className="mt-3">
              <input ref={fileInputRef} type="file" className="hidden" onChange={onFilePicked}
                accept=".pdf,.png,.jpg,.jpeg,.heic,.heif,.webp,.gif,.bmp,.tif,.tiff,.doc,.docx,.xls,.xlsx,.csv,.txt" />
              <button onClick={() => pickUpload("new")} disabled={docBusy === "new"}
                className="w-full text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-lg py-2 flex items-center justify-center gap-1.5">
                {docBusy === "new" ? "Uploading…" : "⬆️ Add a file directly (emailed / on hand)"}
              </button>
            </div>

            {/* Import conditions / approval → Claude splits it into line-item requests,
                each routable to the borrower, a wholesaler, or a custom email. */}
            <div className="mt-5 border-t border-slate-800/60 pt-4">
              <ConditionsImporter loanFileId={id} borrowerName={file.borrower_name} borrowerEmail={file.email} onCreated={load} />
            </div>

            {/* Request documents — build a list, then send the borrower (or anyone
                else) this file's secure upload link, without leaving this screen. */}
            <div className="mt-5 border-t border-slate-800/60 pt-4">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Request documents</div>

              {reqList.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {reqList.map((n) => (
                    <span key={n} className="flex items-center gap-1 text-xs bg-slate-800 rounded-full pl-2.5 pr-1.5 py-1">
                      {n}
                      <button onClick={() => setReqList(reqList.filter((x) => x !== n))} className="hover:text-red-300"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <input value={newDoc} onChange={(e) => setNewDoc(e.target.value)} placeholder="Add a document to request…"
                  onKeyDown={(e) => { if (e.key === "Enter") addToReq(newDoc); }}
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none" />
                <button onClick={() => addToReq(newDoc)} className="bg-slate-800 hover:bg-slate-700 px-3 rounded-lg flex items-center"><Plus className="w-4 h-4" /></button>
              </div>

              <div className="flex flex-wrap gap-1.5 mt-2">
                {["Government-issued photo ID", "Bank statements — last 2 months", "Lease agreement / Form 1007", "Property insurance quote", "Entity documents (LLC)", "Purchase contract", "Mortgage statement"].map((q) => (
                  <button key={q} onClick={() => addToReq(q)} className="text-[11px] px-2 py-1 rounded-full bg-slate-800/60 hover:bg-slate-700 text-slate-300">+ {q}</button>
                ))}
              </div>

              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <span className="text-slate-500 text-xs">Send to:</span>
                {borrowers.map((b) => (
                  <button key={b.index} onClick={() => setRecipient(String(b.index))} title={[b.email, b.phone].filter(Boolean).join(" · ") || "no contact on file"}
                    className={`text-xs px-2.5 py-1 rounded-full ${recipient === String(b.index) ? "bg-emerald-500 text-slate-950 font-semibold" : "bg-slate-800 text-slate-300"}`}>
                    {borrowers.length > 1 ? b.name : "Borrower"}
                  </button>
                ))}
                <button onClick={() => setRecipient("other")} className={`text-xs px-2.5 py-1 rounded-full ${recipient === "other" ? "bg-emerald-500 text-slate-950 font-semibold" : "bg-slate-800 text-slate-300"}`}>Someone else</button>
              </div>
              {recipient === "other" ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                  <input value={other.name} onChange={(e) => setOther({ ...other, name: e.target.value })} placeholder="Name (e.g. CPA, title co.)" className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none" />
                  <input value={other.email} onChange={(e) => setOther({ ...other, email: e.target.value })} placeholder="Email" className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none" />
                  <input value={other.phone} onChange={(e) => setOther({ ...other, phone: e.target.value })} placeholder="Phone (optional)" className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none" />
                </div>
              ) : (
                <div className="text-xs text-slate-500 mt-1.5">{(() => { const c = recipientContact(); return [c.to_email, c.to_phone].filter(Boolean).join(" · ") || "No email/phone on file for this borrower — add it on the 1003, or use “Someone else”."; })()}</div>
              )}

              <textarea value={reqNote} onChange={(e) => setReqNote(e.target.value)} rows={2} placeholder="Optional note (added to the email)…"
                className="w-full mt-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none" />

              <div className="flex items-center flex-wrap gap-2 mt-2">
                <button onClick={sendRequest} disabled={sendingReq}
                  className="text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-2 rounded-lg flex items-center gap-1.5">
                  {sendingReq ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send request + file link
                </button>
                <button onClick={addOnly} disabled={sendingReq} className="text-xs text-slate-400 hover:text-white px-2 py-2">Add to checklist only</button>
                <button onClick={remindMissing} disabled={sendingReq} title="Email/text the borrower their secure link + every document still missing — no typing, no duplicates"
                  className="text-sm font-semibold bg-sky-600 hover:bg-sky-500 disabled:opacity-50 px-3 py-2 rounded-lg flex items-center gap-1.5">
                  {sendingReq ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>📨</span>} Remind: missing{(() => { const n = docs.filter((d) => (d.status === "needed" || d.status === "rejected") && d.required).length; return n ? ` (${n})` : ""; })()}
                </button>
                {reqMsg && <span className={`text-xs ${reqMsg.ok ? "text-emerald-400" : "text-amber-300"}`}>{reqMsg.text}</span>}
              </div>
              <p className="text-[11px] text-slate-600 mt-1">Always sends this file&apos;s secure link (<span className="font-mono">/file/{file.share_token.slice(0, 6)}…</span>) so every upload lands in this file.</p>

              {/* Send a blank form/template for the borrower to COMPLETE (e.g. Excel PFS). */}
              <div className="mt-3 pt-3 border-t border-slate-800">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-1.5">Send a form to complete</div>
                <p className="text-[11px] text-slate-500 mb-2">Attach a blank document (Excel, PDF, Word…) — it&apos;s emailed to the recipient above with instructions, and &quot;Completed: …&quot; is tracked on the checklist until they return it through their link.</p>
                <input ref={sendDocRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg"
                  onChange={async (e) => {
                    const f = e.target.files?.[0]; if (!f) return;
                    e.target.value = "";
                    const c = recipientContact();
                    if (!c.to_email) { setReqMsg({ text: "No email on file for this recipient — add it on the 1003, or use “Someone else”." }); return; }
                    setSendingReq(true); setReqMsg(null);
                    try {
                      const fd = new FormData();
                      fd.append("file", f); fd.append("to_email", c.to_email); fd.append("to_name", c.to_name || "");
                      if (reqNote.trim()) fd.append("note", reqNote.trim());
                      const r = await fetch(`/api/los/files/${id}/send-doc`, { method: "POST", body: fd });
                      const j = await r.json();
                      if (r.ok) { setReqMsg({ ok: true, text: `✓ "${f.name}" emailed to ${c.to_email} — tracking "${j.doc}" on the checklist` }); setReqNote(""); await load(); }
                      else setReqMsg({ text: "⚠️ " + (j.error || "Send failed") });
                    } catch { setReqMsg({ text: "⚠️ Connection error" }); }
                    setSendingReq(false);
                  }} />
                <button onClick={() => sendDocRef.current?.click()} disabled={sendingReq}
                  className="text-sm font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-50 px-3 py-2 rounded-lg flex items-center gap-1.5">
                  {sendingReq ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>📎</span>} Attach &amp; email a form to complete
                </button>

                {/* Title / escrow order-opening sheet — prefilled from THIS file. */}
                <div className="mt-3 pt-3 border-t border-slate-800">
                  <div className="text-xs uppercase tracking-wide text-slate-500 mb-1.5">Title / escrow order</div>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <input value={titleCo.company} onChange={(e) => setTitleCo({ ...titleCo, company: e.target.value })} placeholder="Title/escrow company" className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none" />
                    <input value={titleCo.contact} onChange={(e) => setTitleCo({ ...titleCo, contact: e.target.value })} placeholder="Contact name" className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none" />
                    <input type="email" value={titleCo.email} onChange={(e) => setTitleCo({ ...titleCo, email: e.target.value })} placeholder="Their email" className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none" />
                    <input value={titleCo.closing} onChange={(e) => setTitleCo({ ...titleCo, closing: e.target.value })} placeholder="Est. closing (e.g. Aug 15)" className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none" />
                  </div>
                  <div className="flex items-center flex-wrap gap-2">
                    <a href={`/api/los/files/${id}/title-order?company=${encodeURIComponent(titleCo.company)}&contact=${encodeURIComponent(titleCo.contact)}&email=${encodeURIComponent(titleCo.email)}&closing=${encodeURIComponent(titleCo.closing)}`}
                      className="text-sm font-semibold bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg flex items-center gap-1.5">📄 Download sheet</a>
                    <button disabled={sendingReq || !titleCo.email.trim()} onClick={async () => {
                      setSendingReq(true); setReqMsg(null);
                      try {
                        const r = await fetch(`/api/los/files/${id}/title-order`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toCompany: titleCo.company, toContact: titleCo.contact, toEmail: titleCo.email, estClosing: titleCo.closing }) });
                        const j = await r.json();
                        setReqMsg(r.ok ? { ok: true, text: `✓ Order-opening sheet emailed to ${titleCo.email} — replies go to ramon@fettifi.com` } : { text: "⚠️ " + (j.error || "Send failed") });
                        if (r.ok) await load();
                      } catch { setReqMsg({ text: "⚠️ Connection error" }); }
                      setSendingReq(false);
                    }} className="text-sm font-semibold bg-amber-600 hover:bg-amber-500 disabled:opacity-40 px-3 py-2 rounded-lg flex items-center gap-1.5">
                      {sendingReq ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>🏛️</span>} Email order to title
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1">Prefilled from this file (borrower, property, price, loan amount) — Fetti-branded PDF with the full open-order checklist; replies route to ramon@fettifi.com.</p>
                </div>
              </div>
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

        {/* Income & qualification — the income calc embedded in the file, prefilled from the 1003 */}
        {mismo?.metrics && <IncomeQualifier metrics={mismo.metrics} loan={mismo.urla?.loan} fileId={id} borrowerEmail={file.email} />}
        <CardAuthPanel fileId={id} />

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

      {/* In-app document viewer — opens approved PDFs right here (no popup blockers). */}
      {viewer && (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/90 backdrop-blur-sm" onClick={() => setViewer(null)}>
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="min-w-0 text-sm font-medium text-slate-200 truncate">{viewer.name}</div>
            <div className="flex items-center gap-2 shrink-0">
              {viewer.isImage && (
                <div className="flex items-center gap-1 mr-1" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => setZoom((z) => Math.max(0.2, +(z * 0.8).toFixed(2)))} title="Zoom out" className="text-base w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 leading-none">−</button>
                  <span className="text-xs w-12 text-center tabular-nums text-slate-300">{Math.round(zoom * 100)}%</span>
                  <button onClick={() => setZoom((z) => Math.min(8, +(z * 1.25).toFixed(2)))} title="Zoom in" className="text-base w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 leading-none">+</button>
                  <button onClick={() => setZoom(1)} title="Fit to screen" className="text-xs px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700">Fit</button>
                </div>
              )}
              <a href={viewer.url} target="_blank" rel="noopener noreferrer" className="text-xs px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" /> New tab</a>
              <button onClick={() => setViewer(null)} className="text-xs px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 flex items-center gap-1"><X className="w-3.5 h-3.5" /> Close</button>
            </div>
          </div>
          {viewer.isImage ? (
            <div className="flex-1 overflow-auto bg-slate-900 flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
              <img src={viewer.url} alt={viewer.name} draggable={false}
                style={zoom === 1 ? { maxWidth: "100%", maxHeight: "100%" } : { width: `${zoom * 100}%`, maxWidth: "none", height: "auto" }} />
            </div>
          ) : (
            <iframe src={viewer.url} title={viewer.name} className="flex-1 w-full bg-white" onClick={(e) => e.stopPropagation()} />
          )}
        </div>
      )}

      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4" onClick={() => setRejectTarget(null)}>
          <div className="w-full max-w-md rounded-2xl border border-red-500/40 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white">Reject & send back</h3>
            <p className="text-sm text-slate-400 mt-1"><span className="text-slate-200 font-semibold">{rejectTarget.name}</span> — tell the borrower what's wrong so they can fix it. This re-adds it to their missing items, and the reason shows on their upload page.</p>
            <textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={3} autoFocus
              placeholder="e.g. Statement is cut off — need all pages, most recent month."
              className="w-full mt-3 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-red-500 focus:outline-none" />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setRejectTarget(null)} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-2.5 rounded-lg">Cancel</button>
              <button onClick={confirmReject} disabled={docBusy === rejectTarget.id} className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg">
                {docBusy === rejectTarget.id ? "…" : "Reject & request re-upload"}
              </button>
            </div>
            <p className="text-[11px] text-slate-600 mt-2">Tip: reject everything that needs fixing, then hit “📨 Remind: missing” once to send the borrower their link with all the reasons.</p>
          </div>
        </div>
      )}

      <DeleteConfirm open={delOpen} name={file.borrower_name || file.file_number || "this file"} kind="loan file" busy={delBusy} onCancel={() => setDelOpen(false)} onConfirm={deleteFile} />
    </div>
  );
}

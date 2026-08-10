"use client";

// E-Sign sender (DocuSign-style): upload a PDF, add one or more signers in a
// signing order, drop each signer's fields (color-coded) onto the live document,
// and send. Tracks per-signer status; void anytime before completion.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, FileUp, Send, Link2, ExternalLink, FileSignature, Plus, Trash2, Ban, Download, Eye, X, RefreshCw, AlertTriangle } from "lucide-react";
import PdfDoc, { EsignField, EsignFieldType } from "@/components/PdfDoc";

type Recipient = { id: string; name: string; email: string; phone: string; order: number };
type Req = { token: string; title: string; status: string; created_at: string; has_signed?: boolean; has_cert?: boolean; recipients: { name: string; email?: string | null; order: number; status: string; delivery?: string | null }[] };

const TOOLS: [EsignFieldType, string][] = [["signature", "✍️ Signature"], ["initials", "🅸 Initials"], ["date", "📅 Date"], ["name", "🅽 Name"], ["text", "📝 Text box"]];
const COLORS = ["#0ea5e9", "#f59e0b", "#a855f7", "#ef4444", "#14b8a6"];

export default function EsignPage() {
  const [title, setTitle] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([{ id: "r1", name: "", email: "", phone: "", order: 1 }]);
  const [activeRid, setActiveRid] = useState("r1");
  const [fileId, setFileId] = useState("");
  const [fields, setFields] = useState<EsignField[]>([]);
  const [tool, setTool] = useState<EsignFieldType | null>(null);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  // `loaded` means a list fetch actually SUCCEEDED. Without it there is no way to tell
  // "you have no envelopes" apart from "we never managed to ask", and the page told
  // Ramon the first one while six envelopes — three of them completed and signed —
  // sat in the database.
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [viewing, setViewing] = useState<{ token: string; title: string; doc: "signed" | "cert" | "source" } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const pdfRef = useRef<HTMLInputElement>(null);

  function acceptDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name))) pickPdf(f);
    else setMsg({ text: "Drop a PDF file." });
  }

  useEffect(() => { const u = new URL(window.location.href); const f = u.searchParams.get("file"); if (f) setFileId(f); }, []);

  // WHY THIS IS NOT `if (r.ok) { ... }` ANY MORE.
  // On a HARD load of /esign (typed URL, bookmark, refresh) this request is routinely
  // ABORTED while the shell is still bootstrapping. An aborted fetch does not throw —
  // it RESOLVES with an opaque response: `status: 0`, `ok: false`. The old code checked
  // `r.ok`, found it false, and did nothing at all: no state, no error, no retry. The
  // list stayed `[]` and the page printed "Nothing sent yet." Reaching /esign by clicking
  // through the app instead did a client-side navigation, the fetch completed, and all six
  // envelopes appeared — which is why this looked intermittent rather than broken.
  // So: treat every non-ok outcome as a failure, RETRY it, and never claim emptiness
  // unless a load actually came back.
  // A hung request is the OTHER half of the same bug. Measured on production after the
  // first fix: on a cold hard load this request does not fail fast — it simply never
  // settles, so a retry that waits on the promise waits forever and the page sat on
  // "Loading your envelopes…" for eighteen seconds until a window focus rescued it.
  // A timeout turns that hang into an ordinary failure the retry below can act on.
  const load = useCallback(async (attempt = 0): Promise<void> => {
    if (attempt === 0) setReloading(true);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    try {
      const r = await fetch("/api/esign/requests", { cache: "no-store", signal: ctl.signal });
      if (!r.ok) throw new Error(r.status ? `the server returned HTTP ${r.status}` : "the request was interrupted before it finished");
      const j = await r.json();
      setReqs(Array.isArray(j?.requests) ? j.requests : []);
      setLoadErr(null);
      setLoaded(true);
    } catch (e: any) {
      // An interrupted or hung first load is transient — back off and try again before
      // surfacing anything. Only a run of failures is worth telling Ramon about.
      if (attempt < 3) {
        await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
        return load(attempt + 1);
      }
      setLoadErr(e?.name === "AbortError" ? "it timed out" : (e?.message || "the request failed"));
    } finally {
      clearTimeout(timer);
      if (attempt === 0) setReloading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Self-heal: if a load was lost while the tab was in the background (or the app was
  // asleep), pick it up the moment Ramon looks at the screen again.
  useEffect(() => {
    const again = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => { window.removeEventListener("focus", again); document.removeEventListener("visibilitychange", again); };
  }, [load]);

  const docUrl = (v: { token: string; doc: string }) => `/api/esign/requests/${v.token}/pdf?doc=${v.doc}`;

  const colorOf = (id: string) => COLORS[Math.max(0, recipients.findIndex((r) => r.id === id)) % COLORS.length];
  const colors = Object.fromEntries(recipients.map((r) => [r.id, colorOf(r.id)]));
  const labels = Object.fromEntries(recipients.map((r) => [r.id, (r.name || `Signer ${r.order}`).split(" ")[0]]));

  async function pickPdf(f: File | null) {
    setPdf(f); setFields([]); setPdfData(null);
    if (f) { const buf = await f.arrayBuffer(); setPdfData(new Uint8Array(buf)); if (!title) setTitle(f.name.replace(/\.pdf$/i, "")); }
  }
  function addRecipient() {
    const id = `r${Date.now().toString(36).slice(-4)}`;
    setRecipients([...recipients, { id, name: "", email: "", phone: "", order: recipients.length + 1 }]);
    setActiveRid(id);
  }
  function removeRecipient(id: string) {
    if (recipients.length === 1) return;
    const next = recipients.filter((r) => r.id !== id).map((r, i) => ({ ...r, order: i + 1 }));
    setRecipients(next);
    setFields(fields.filter((f) => f.recipientId !== id));
    if (activeRid === id) setActiveRid(next[0].id);
  }
  const setR = (id: string, patch: Partial<Recipient>) => setRecipients(recipients.map((r) => r.id === id ? { ...r, ...patch } : r));

  const inp = "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none";
  const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

  // Step 1 — validate, then show the "confirm recipients" review so a typo'd email is
  // SEEN before anything sends (the DocuSign-style review-recipients gate).
  function review() {
    setMsg(null);
    if (!pdf) { setMsg({ text: "Choose a PDF." }); return; }
    const clean = recipients.filter((r) => r.name.trim());
    if (!clean.length) { setMsg({ text: "Add at least one signer." }); return; }
    for (const r of clean) {
      if (!r.email.trim() && !r.phone.trim()) { setMsg({ text: `Add an email or phone for ${r.name}.` }); return; }
      if (r.email.trim() && !isEmail(r.email)) { setMsg({ text: `That email for ${r.name} isn't valid: "${r.email.trim()}". Fix it before sending.` }); return; }
    }
    setConfirming(true);
  }

  // Step 2 — actually send, after the LO confirms every recipient is correct.
  async function doSend() {
    if (!pdf) return;
    setSending(true); setMsg(null);
    try {
      if (pdf.size > 40 * 1024 * 1024) { setMsg({ text: "That PDF is over 40 MB — split it and send in parts." }); setSending(false); return; }
      const clean = recipients.filter((r) => r.name.trim());

      // 1) Upload the PDF STRAIGHT to storage (signed URL) — posting it through the
      //    API died at ~4.5MB (platform body cap) and surfaced as "Connection error".
      const uRes = await fetch("/api/esign/requests/upload-url", { method: "POST" });
      const u = await uRes.json().catch(() => null);
      if (!uRes.ok || !u?.url) { setMsg({ text: (u && u.error) || `Couldn't start the upload (HTTP ${uRes.status}).` }); setSending(false); return; }
      const put = await fetch(u.url, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: pdf });
      if (!put.ok) { setMsg({ text: `The PDF upload failed (HTTP ${put.status}) — check your connection and try again.` }); setSending(false); return; }

      // 2) Create the envelope from metadata only (tiny request — no size cliff).
      const r = await fetch("/api/esign/requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_path: u.path, pdf_name: pdf.name,
          title: title.trim() || pdf.name.replace(/\.pdf$/i, ""),
          loan_file_id: fileId.trim() || undefined,
          recipients: clean.map((rc) => ({ id: rc.id, name: rc.name.trim(), email: rc.email.trim() || null, phone: rc.phone.trim() || null, order: rc.order })),
          fields,
        }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j) {
        setMsg({ ok: true, text: j.message || "Sent." });
        setPdf(null); setPdfData(null); setFields([]); setTitle(""); setRecipients([{ id: "r1", name: "", email: "", phone: "", order: 1 }]); setActiveRid("r1"); setConfirming(false);
        await load();
      } else setMsg({ text: (j && j.error) || `Send failed (HTTP ${r.status}). If this keeps happening, log out and back in.` });
    } catch { setMsg({ text: "Network error — check your connection and try again." }); }
    setSending(false);
  }

  async function voidEnv(token: string) {
    if (!confirm("Void this envelope? Signers can no longer sign it.")) return;
    await fetch(`/api/esign/requests/${token}/void`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    await load();
  }

  const badge = (s: string) => s === "completed" ? "bg-emerald-500/20 text-emerald-300" : s === "in_progress" ? "bg-sky-500/20 text-sky-300" : s === "declined" || s === "voided" ? "bg-red-500/20 text-red-300" : "bg-slate-700/60 text-slate-300";

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold flex items-center gap-2"><FileSignature className="w-6 h-6 text-emerald-400" /> E-Sign</h1>
        <p className="text-slate-400 text-sm mt-1">Add signers in order, drop each one's fields onto the document, and send. Signed copy + Certificate of Completion attach to the loan file.</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-5">
          {/* Left: signers + details */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 space-y-3 h-fit">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">PDF</label>
              <input ref={pdfRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => pickPdf(e.target.files?.[0] || null)} />
              <button onClick={() => pdfRef.current?.click()} className="w-full bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-2 text-sm flex items-center gap-2"><FileUp className="w-4 h-4" /> {pdf ? pdf.name : "Choose PDF…"}</button>
            </div>
            <div><label className="text-xs text-slate-400 mb-1 block">Document title</label><input className={inp} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Borrower Authorization" /></div>

            <div>
              <div className="flex items-center justify-between mb-1"><label className="text-xs text-slate-400">Signers (in order)</label><button onClick={addRecipient} className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"><Plus className="w-3 h-3" /> Add signer</button></div>
              <div className="space-y-2">
                {recipients.map((r, i) => (
                  <div key={r.id} className={`rounded-lg border p-2 ${activeRid === r.id ? "border-emerald-500/60 bg-slate-900" : "border-slate-800 bg-slate-900/40"}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ background: colorOf(r.id) }} />
                      <span className="text-xs font-semibold text-slate-300">{i + 1}.</span>
                      <input className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm" value={r.name} onChange={(e) => setR(r.id, { name: e.target.value })} placeholder="Signer name" />
                      <button onClick={() => setActiveRid(r.id)} className={`text-[10px] px-2 py-1 rounded ${activeRid === r.id ? "bg-emerald-600 text-slate-950 font-semibold" : "bg-slate-800 text-slate-400"}`}>{activeRid === r.id ? "placing" : "place fields"}</button>
                      {recipients.length > 1 && <button onClick={() => removeRecipient(r.id)} className="text-slate-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <input className={`bg-slate-900 border rounded px-2 py-1 text-xs ${r.email.trim() && !isEmail(r.email) ? "border-red-500 text-red-300" : "border-slate-700 text-white"}`} value={r.email} onChange={(e) => setR(r.id, { email: e.target.value })} placeholder="email" />
                      <input className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs" value={r.phone} onChange={(e) => setR(r.id, { phone: e.target.value })} placeholder="phone (optional)" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div><label className="text-xs text-slate-400 mb-1 block">Loan file ID (optional)</label><input className={inp} value={fileId} onChange={(e) => setFileId(e.target.value)} placeholder="links the signed doc to a file" /></div>
            {!confirming ? (
              <button onClick={review} disabled={sending} className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2">
                <Send className="w-4 h-4" /> Review &amp; send
              </button>
            ) : (
              <div className="rounded-lg border border-emerald-600/50 bg-emerald-500/5 p-3 space-y-2">
                <div className="text-xs font-semibold text-emerald-300">Confirm recipients — check every email is exactly right:</div>
                <div className="space-y-1.5">
                  {recipients.filter((r) => r.name.trim()).map((r) => (
                    <div key={r.id} className="text-xs">
                      <span className="text-slate-500">{r.order}. </span>
                      <span className="font-medium text-slate-200">{r.name.trim()}</span>
                      <span className="text-slate-500"> → </span>
                      <span className="font-mono text-amber-200 break-all">{r.email.trim() || r.phone.trim()}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setConfirming(false)} disabled={sending} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 rounded-lg text-xs">← Edit</button>
                  <button onClick={doSend} disabled={sending} className="flex-[2] bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold px-3 py-2 rounded-lg text-xs flex items-center justify-center gap-2">
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Confirm &amp; send
                  </button>
                </div>
              </div>
            )}
            {msg && <div className={`text-sm ${msg.ok ? "text-emerald-400" : "text-amber-300"}`}>{msg.text}</div>}
            <p className="text-[11px] text-slate-600">Sent sequentially — each signer is emailed/texted their turn. Best for authorizations &amp; agreements; for regulated disclosures (LE/CD) confirm compliance first.</p>
          </div>

          {/* Right: placement */}
          <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800 rounded-2xl p-4"
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={acceptDrop}>
            {!pdfData ? (
              <div onClick={() => pdfRef.current?.click()}
                className={`h-72 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed cursor-pointer transition ${dragOver ? "border-emerald-400 bg-emerald-500/10 text-emerald-300" : "border-slate-700 text-slate-500 hover:border-slate-600"}`}>
                <FileUp className="w-8 h-8" />
                <div className="text-sm font-semibold">{dragOver ? "Drop your PDF" : "Drag & drop a PDF here"}</div>
                <div className="text-xs">or click to choose a file</div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <span className="text-xs text-slate-400">Placing for <b style={{ color: colorOf(activeRid) }}>{labels[activeRid]}</b> — pick a field, then click the document:</span>
                  {TOOLS.map(([t, label]) => (
                    <button key={t} onClick={() => setTool(tool === t ? null : t)} className={`text-xs px-2.5 py-1.5 rounded-lg ${tool === t ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>{label}</button>
                  ))}
                  <span className="text-xs text-slate-500 ml-auto">{fields.length} field{fields.length === 1 ? "" : "s"}</span>
                </div>
                <div className="max-h-[70vh] overflow-y-auto rounded-lg bg-slate-800/30 p-3">
                  <PdfDoc data={pdfData} mode="place" fields={fields} onChange={setFields} tool={tool} onToolUsed={() => setTool(null)} activeRecipientId={activeRid} recipientColors={colors} recipientLabels={labels} />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Envelopes */}
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-2">
            <div className="text-xs uppercase tracking-wide text-slate-500">Envelopes ({loaded ? reqs.length : "…"})</div>
            <button onClick={() => load()} disabled={reloading} className="text-slate-500 hover:text-slate-300 disabled:opacity-40" title="Refresh">
              <RefreshCw className={`w-3.5 h-3.5 ${reloading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Inline viewer — the signed copy and the Certificate of Completion open HERE,
              on this page, instead of only downloading. */}
          {viewing && (
            <div className="mb-3 bg-slate-900/60 border border-slate-700 rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800 flex-wrap">
                <FileSignature className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="font-medium text-sm truncate">{viewing.title}</span>
                <div className="ml-auto flex items-center gap-1">
                  {([["signed", "Signed"], ["cert", "Certificate"], ["source", "Original"]] as const).map(([d, lbl]) => (
                    <button key={d} onClick={() => setViewing({ ...viewing, doc: d })}
                      className={`text-[11px] px-2 py-1 rounded ${viewing.doc === d ? "bg-emerald-600 text-slate-950 font-semibold" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>{lbl}</button>
                  ))}
                  <a href={docUrl(viewing)} download className="text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1"><Download className="w-3.5 h-3.5" /> Download</a>
                  <a href={docUrl(viewing)} target="_blank" rel="noreferrer" className="text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" /> New tab</a>
                  <button onClick={() => setViewing(null)} className="text-slate-500 hover:text-red-400 p-1" title="Close"><X className="w-4 h-4" /></button>
                </div>
              </div>
              {/* keyed so switching Signed/Certificate/Original actually reloads the frame */}
              <iframe key={docUrl(viewing)} src={docUrl(viewing)} className="w-full h-[75vh] bg-white" title={`${viewing.title} — ${viewing.doc}`} />
            </div>
          )}

          <div className="space-y-2">
            {reqs.map((r) => (
              <div key={r.token} className="bg-slate-900/40 border border-slate-800 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{r.title}</div>
                  <div className="text-xs text-slate-500 flex flex-wrap gap-x-2">
                    {(r.recipients || []).sort((a, b) => a.order - b.order).map((x) => (
                      <span key={x.order}>{x.order}. {x.name}{x.email ? ` <${x.email}>` : ""} <span className={x.status === "signed" ? "text-emerald-400" : x.status === "declined" ? "text-red-400" : "text-slate-500"}>· {x.status}</span>{x.delivery === "bounced" ? <span className="text-red-400 font-semibold"> · ✕ delivery failed</span> : x.delivery === "delivered" ? <span className="text-emerald-400"> · ✓ delivered</span> : null}</span>
                    ))}
                    <span>· {new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge(r.status)}`}>{r.status.replace("_", " ")}</span>
                  {r.has_signed && <button onClick={() => setViewing({ token: r.token, title: r.title, doc: "signed" })} className="text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 flex items-center gap-1" title="View the signed PDF on this page"><Eye className="w-3.5 h-3.5" /> Signed</button>}
                  {r.has_cert && <button onClick={() => setViewing({ token: r.token, title: r.title, doc: "cert" })} className="text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1" title="View the Certificate of Completion on this page"><Eye className="w-3.5 h-3.5" /> Certificate</button>}
                  {!r.has_signed && <button onClick={() => setViewing({ token: r.token, title: r.title, doc: "source" })} className="text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 flex items-center gap-1" title="View the document that was sent"><Eye className="w-3.5 h-3.5" /> Document</button>}
                  {(r.status !== "voided" && r.status !== "declined" && r.status !== "completed") && (
                    <button onClick={() => voidEnv(r.token)} className="text-slate-500 hover:text-red-400 flex items-center gap-1 text-xs" title="Void envelope"><Ban className="w-3.5 h-3.5" /> Void</button>
                  )}
                </div>
              </div>
            ))}
            {/* Three DISTINCT states. "Nothing sent yet" is only ever shown once a load
                has actually succeeded — never as the default for a failure. */}
            {!loaded && !loadErr && (
              <div className="text-slate-500 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading your envelopes…</div>
            )}
            {loadErr && (
              <div className="rounded-xl border border-amber-600/50 bg-amber-500/5 px-4 py-3 text-sm flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <div className="text-amber-200">Couldn&apos;t load your envelopes — {loadErr}.</div>
                  <div className="text-slate-500 text-xs mt-0.5">Nothing has been lost; this screen just couldn&apos;t reach the list.</div>
                  <button onClick={() => load()} className="mt-2 text-xs px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 inline-flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Try again</button>
                </div>
              </div>
            )}
            {loaded && !reqs.length && <div className="text-slate-600 text-sm">Nothing sent yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

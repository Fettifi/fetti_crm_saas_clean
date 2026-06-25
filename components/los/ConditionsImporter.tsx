"use client";

// Upload a pre-approval letter / underwriting conditions / stip sheet → Claude reads it
// and SPLITS it into individual line items → the LO reviews each, picks WHO it goes to
// (borrower, a wholesaler, or a custom email), and one click creates each as a document
// request on the file (and emails it to that person). Module-scope component (its inputs
// hold local state) so typing never remounts — avoids the recurring focus-loss bug.
import { useEffect, useRef, useState } from "react";
import { Loader2, Upload, Trash2, ClipboardList, Send } from "lucide-react";

type Cond = { title: string; category: string; to: string; custom: string }; // to: "borrower" | "none" | "custom" | "<wholesaler email>"
type Recipient = { label: string; email: string };

export default function ConditionsImporter({
  loanFileId, borrowerName, borrowerEmail, onCreated,
}: {
  loanFileId: string;
  borrowerName?: string | null;
  borrowerEmail?: string | null;
  onCreated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [conds, setConds] = useState<Cond[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [wholesalers, setWholesalers] = useState<Recipient[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Populate the recipient dropdown with the wholesaler contacts from the Scenario Desk.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/wholesalers");
        if (r.ok) {
          const j = await r.json();
          setWholesalers((j.wholesalers || []).filter((w: any) => w.email).map((w: any) => ({ label: `${w.company}${w.contact_name ? ` (${w.contact_name})` : ""}`, email: w.email })));
        }
      } catch { /* dropdown still has borrower + custom */ }
    })();
  }, []);

  const defaultTo = (recipient: string) => (recipient === "borrower" && borrowerEmail ? "borrower" : recipient === "borrower" ? "none" : "custom");

  async function onFile(f: File) {
    setBusy(true); setMsg("📄 Reading the document…"); setConds(null);
    try {
      const fd = new FormData(); fd.append("doc", f);
      const r = await fetch(`/api/los/files/${loanFileId}/parse-conditions`, { method: "POST", body: fd });
      const j = await r.json();
      if (r.ok && Array.isArray(j.conditions)) {
        if (!j.conditions.length) { setMsg("No conditions found in that document."); return; }
        setConds(j.conditions.map((c: any) => ({ title: c.title, category: c.category || "Other", to: defaultTo(c.recipient), custom: "" })));
        setMsg(`Found ${j.conditions.length} item${j.conditions.length === 1 ? "" : "s"} — edit, choose who each goes to, then create the requests.`);
      } else setMsg("⚠️ " + (j.error || "Couldn't read it."));
    } catch { setMsg("⚠️ Upload failed."); } finally { setBusy(false); }
  }

  const patch = (i: number, p: Partial<Cond>) => setConds((cs) => (cs ? cs.map((c, idx) => (idx === i ? { ...c, ...p } : c)) : cs));
  const remove = (i: number) => setConds((cs) => (cs ? cs.filter((_, idx) => idx !== i) : cs));

  const resolveEmail = (c: Cond): string =>
    c.to === "borrower" ? (borrowerEmail || "") : c.to === "custom" ? c.custom.trim() : c.to === "none" ? "" : c.to;

  async function createAll() {
    if (!conds?.length) return;
    setCreating(true); setMsg("Creating requests…");
    let created = 0, sent = 0;
    for (const c of conds) {
      if (!c.title.trim()) continue;
      const toEmail = resolveEmail(c);
      const notify = /\S+@\S+\.\S+/.test(toEmail)
        ? { to_email: toEmail, to_name: c.to === "borrower" ? borrowerName || null : null }
        : undefined;
      try {
        const r = await fetch(`/api/los/files/${loanFileId}/docs`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: [c.title.trim()], category: c.category, required: true, notify }),
        });
        if (r.ok) { created++; const j = await r.json().catch(() => ({})); if ((j.sent || []).length) sent++; }
      } catch { /* keep going */ }
    }
    setCreating(false); setConds(null); onCreated();
    setMsg(`✓ Created ${created} request${created === 1 ? "" : "s"}${sent ? ` · emailed ${sent}` : ""}.`);
    setTimeout(() => setMsg(null), 7000);
  }

  const selCls = "bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-emerald-500 focus:outline-none";

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm font-semibold flex items-center gap-2"><ClipboardList className="w-4 h-4 text-emerald-400" /> Import conditions / approval
          <span className="text-[11px] text-slate-500 font-normal hidden sm:inline">— upload an approval or conditions list; it auto-splits into requests you can route</span></div>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || creating}
          className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload conditions
        </button>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ""; }} />
      </div>

      {msg && <div className="text-xs text-slate-300 mt-2">{msg}</div>}

      {conds && conds.length > 0 && (
        <div className="mt-3 space-y-2">
          {conds.map((c, i) => (
            <div key={i} className="bg-slate-900/60 border border-slate-800 rounded-lg p-2.5 flex flex-col sm:flex-row sm:items-center gap-2">
              <input value={c.title} onChange={(e) => patch(i, { title: e.target.value })}
                className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none" />
              <div className="flex items-center gap-2">
                <select value={c.to} onChange={(e) => patch(i, { to: e.target.value })} className={selCls} title="Who should this request go to?">
                  <option value="borrower">{borrowerEmail ? `Borrower — ${borrowerName || borrowerEmail}` : "Borrower (no email on file)"}</option>
                  {wholesalers.map((w) => <option key={w.email} value={w.email}>{w.label}</option>)}
                  <option value="custom">Custom email…</option>
                  <option value="none">Create only (don&apos;t send)</option>
                </select>
                {c.to === "custom" && (
                  <input type="email" value={c.custom} onChange={(e) => patch(i, { custom: e.target.value })} placeholder="name@email.com"
                    className="w-40 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-emerald-500 focus:outline-none" />
                )}
                <button type="button" onClick={() => remove(i)} title="Remove" className="text-slate-600 hover:text-red-400 shrink-0"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={createAll} disabled={creating}
              className="text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 px-4 py-2 rounded-lg flex items-center gap-1.5">
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Create {conds.length} request{conds.length === 1 ? "" : "s"}
            </button>
            <button type="button" onClick={() => { setConds(null); setMsg(null); }} disabled={creating} className="text-xs text-slate-400 hover:text-slate-200 px-2 py-2">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

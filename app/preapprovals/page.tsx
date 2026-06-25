"use client";

// Pre-Approvals: issue branded, compliant mortgage pre-approval letters (pull
// from a loan file or enter manually), then share/print the letter.
import { useEffect, useState } from "react";
import { FileCheck2, Loader2, Copy, Check, ExternalLink, Plus, Ban, Download, Upload } from "lucide-react";
import AddressInput from "@/components/AddressInput";
import CurrencyInput from "@/components/ui/CurrencyInput";

type PA = { id: string; letter_number: string; share_token: string; borrower_name: string; loan_type?: string; loan_amount?: number; status: string; expires_on?: string; created_at: string };
type LoanFile = { id: string; lead_id?: string; borrower_name: string; email?: string; product?: string; occupancy?: string; property_address?: string; property_value?: number; loan_amount?: number };

const LOAN_TYPES = ["Conventional", "FHA", "VA", "USDA", "Jumbo", "First-Time Homebuyer", "DSCR", "Bank-Statement (Self-Employed)", "Fix & Flip", "Bridge", "HELOC", "Reverse (HECM)"];
const TERMS = ["30-year fixed", "15-year fixed", "20-year fixed", "5/1 ARM", "7/1 ARM", "12-month interest-only", "Other"];
const OCC = ["Primary residence", "Second home", "Investment"];
// Richer term-sheet fields with no preapprovals column — captured, shown on the
// letter, persisted via app_settings. [key, label, placeholder]
const EXTRA_FIELDS: [string, string, string][] = [
  ["loan_purpose", "Loan purpose", "Purchase / Cash-Out Refi"],
  ["rate_type", "Rate type", "e.g. 5/1 ARM, Fixed, I/O"],
  ["monthly_payment", "Est. monthly payment", "e.g. $3,142"],
  ["ltv", "LTV", "auto if blank"],
  ["points", "Points", "e.g. 1.000"],
  ["lender_fees", "Lender fees", "e.g. $1,995"],
  ["prepay_penalty", "Prepay penalty", "5/4/3/2/1 or None"],
  ["reserves", "Reserves", "e.g. 6 months"],
  ["dscr", "DSCR", "e.g. 1.25"],
  ["lock_period", "Rate lock", "e.g. 45 days"],
];
const field = "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none";

export default function PreApprovals() {
  const [list, setList] = useState<PA[]>([]);
  const [files, setFiles] = useState<LoanFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [justIssued, setJustIssued] = useState<PA | null>(null);
  const [emailed, setEmailed] = useState<string[]>([]);
  const [tsBusy, setTsBusy] = useState(false);
  const [tsMsg, setTsMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const [f, setF] = useState<any>({
    borrower_name: "", co_borrower: "", loan_type: "Conventional", purchase_price: "", down_payment: "",
    loan_amount: "", interest_rate: "", term: "30-year fixed", property_address: "", occupancy: "Primary residence",
    conditions: "Standard documentation required: income, assets, and employment verification; satisfactory appraisal; clear title.",
    officer_name: "Ramon Dent", officer_nmls: "2267023", expires_on: "",
    borrower_email: "", agent_email: "",
    loan_purpose: "", rate_type: "", monthly_payment: "", ltv: "", points: "",
    lender_fees: "", prepay_penalty: "", reserves: "", dscr: "", lock_period: "",
  });
  const set = (k: string, v: string) => setF((p: any) => ({ ...p, [k]: v }));

  async function load() {
    const [pr, fr] = await Promise.all([fetch("/api/preapprovals"), fetch("/api/los/files")]);
    if (pr.ok) setList((await pr.json()).preapprovals);
    if (fr.ok) setFiles((await fr.json()).files);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function pull(id: string) {
    const lf = files.find((x) => x.id === id); if (!lf) return;
    setF((p: any) => ({
      ...p, loan_file_id: lf.id, lead_id: lf.lead_id || "",
      borrower_name: lf.borrower_name || p.borrower_name, loan_type: lf.product || p.loan_type,
      borrower_email: lf.email || p.borrower_email,
      property_address: lf.property_address || p.property_address,
      purchase_price: lf.property_value ? String(lf.property_value) : p.purchase_price,
      loan_amount: lf.loan_amount ? String(lf.loan_amount) : p.loan_amount,
      occupancy: lf.occupancy === "Investor" ? "Investment" : lf.occupancy === "Owner" ? "Primary residence" : p.occupancy,
    }));
  }

  // Upload a lender term sheet → Claude extracts the loan terms → pre-fill the form.
  async function uploadTermSheet(file: File) {
    setTsBusy(true); setTsMsg(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await fetch("/api/preapprovals/extract", { method: "POST", body: fd });
      const j = await r.json();
      if (r.ok && j.extracted) {
        const ex = j.extracted;
        const numStr = (v: any) => (v != null ? String(v) : undefined);
        setF((p: any) => ({
          ...p,
          ...(ex.borrower_name && { borrower_name: ex.borrower_name }),
          ...(ex.co_borrower && { co_borrower: ex.co_borrower }),
          ...(ex.loan_type && { loan_type: ex.loan_type }),
          ...(ex.loan_amount != null && { loan_amount: numStr(ex.loan_amount) }),
          ...(ex.purchase_price != null && { purchase_price: numStr(ex.purchase_price) }),
          ...(ex.down_payment != null && { down_payment: numStr(ex.down_payment) }),
          ...(ex.interest_rate && { interest_rate: ex.interest_rate }),
          ...(ex.term && { term: ex.term }),
          ...(ex.property_address && { property_address: ex.property_address }),
          ...(ex.occupancy && { occupancy: ex.occupancy }),
          ...(ex.conditions && { conditions: ex.conditions }),
          ...(ex.expires_on && { expires_on: ex.expires_on }),
          ...Object.fromEntries(EXTRA_FIELDS.map(([k]) => [k, ex[k]]).filter(([, v]) => v)),
        }));
        const n = (j.fields || []).length;
        setTsMsg(n ? { ok: true, text: `✅ Pulled ${n} field${n === 1 ? "" : "s"} from the term sheet — review below, then issue the letter.` } : { text: "Read the file but found no usable terms — enter them manually." });
      } else setTsMsg({ text: "⚠️ " + (j.error || "Couldn't read the term sheet.") });
    } catch { setTsMsg({ text: "⚠️ Connection error." }); } finally { setTsBusy(false); }
  }

  async function issue(e: React.FormEvent) {
    e.preventDefault(); if (!f.borrower_name.trim()) return;
    setSaving(true);
    try {
      const extra_terms = Object.fromEntries(EXTRA_FIELDS.map(([k]) => [k, f[k]]).filter(([, v]) => v && String(v).trim()));
      const r = await fetch("/api/preapprovals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, extra_terms }) });
      const j = await r.json();
      if (r.ok) { setJustIssued(j.preapproval); setEmailed(j.emailed || []); await load(); }
    } finally { setSaving(false); }
  }
  async function voidLetter(id: string) {
    await fetch("/api/preapprovals", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: "void" }) });
    load();
  }
  function copyLink(tok: string) {
    navigator.clipboard?.writeText(`${window.location.origin}/letter/${tok}`); setCopied(tok); setTimeout(() => setCopied(null), 1500);
  }
  const money = (n?: number) => (n == null ? "—" : "$" + Math.round(n).toLocaleString());

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold flex items-center gap-2"><FileCheck2 className="w-6 h-6 text-emerald-400" /> Pre-Approvals</h1>
        <p className="text-slate-400 text-sm mt-1">Issue a branded, compliant pre-approval letter. Share the link or print to PDF.</p>

        {justIssued && (
          <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
            <div className="font-semibold">✅ Letter issued — {justIssued.letter_number}</div>
            {emailed.length > 0 && <div className="text-xs text-emerald-300/90 mt-1">📧 PDF emailed to {emailed.join(" & ")}.</div>}
            <div className="flex gap-2 mt-2">
              <a href={`/letter/${justIssued.share_token}`} target="_blank" rel="noreferrer" className="text-sm bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 rounded-lg flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" /> Open letter</a>
              <a href={`/api/letter/${justIssued.share_token}/pdf`} className="text-sm bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg flex items-center gap-1"><Download className="w-3.5 h-3.5" /> PDF</a>
              <button onClick={() => copyLink(justIssued.share_token)} className="text-sm bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg flex items-center gap-1">{copied === justIssued.share_token ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />} Copy link</button>
            </div>
          </div>
        )}

        {/* Create from a term sheet — upload, AI extracts the terms, review, issue */}
        <div className="bg-gradient-to-r from-emerald-950/40 to-slate-900/40 border border-emerald-800/40 rounded-2xl p-4 mt-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm font-semibold flex items-center gap-2">📄 Create from a term sheet
              <span className="text-xs text-slate-500 font-normal hidden sm:inline">— upload a lender term sheet and AI fills the letter below</span></div>
            <label className={`${tsBusy ? "opacity-60" : ""} bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-3 py-2 rounded-lg text-sm flex items-center gap-2 cursor-pointer`}>
              {tsBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {tsBusy ? "Reading…" : "Upload term sheet"}
              <input type="file" accept="application/pdf,image/*" className="hidden" disabled={tsBusy}
                onChange={(e) => { const fl = e.target.files?.[0]; if (fl) uploadTermSheet(fl); e.currentTarget.value = ""; }} />
            </label>
          </div>
          {tsMsg && <div className={`text-xs mt-2 ${tsMsg.ok ? "text-emerald-300" : "text-slate-300"}`}>{tsMsg.text}</div>}
          <div className="text-[11px] text-slate-500 mt-1">PDF or image. Terms are extracted for your review — nothing is issued until you click &ldquo;Issue pre-approval letter&rdquo; below.</div>
        </div>

        {/* Issue form */}
        <form onSubmit={issue} className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mt-4 space-y-3">
          {files.length > 0 && (
            <div>
              <label className="text-xs text-slate-500">Pull from a loan file (optional)</label>
              <select onChange={(e) => e.target.value && pull(e.target.value)} defaultValue="" className={field}>
                <option value="">— Start blank or pick a borrower —</option>
                {files.map((lf) => <option key={lf.id} value={lf.id}>{lf.borrower_name || "Borrower"} · {lf.product || "—"}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="text-xs text-slate-500">Borrower name *</label><input value={f.borrower_name} onChange={(e) => set("borrower_name", e.target.value)} className={field} required /></div>
            <div><label className="text-xs text-slate-500">Co-borrower</label><input value={f.co_borrower} onChange={(e) => set("co_borrower", e.target.value)} className={field} /></div>
            <div><label className="text-xs text-slate-500">Loan program</label><select value={f.loan_type} onChange={(e) => set("loan_type", e.target.value)} className={field}>{LOAN_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div><label className="text-xs text-slate-500">Occupancy</label><select value={f.occupancy} onChange={(e) => set("occupancy", e.target.value)} className={field}>{OCC.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div><label className="text-xs text-slate-500">Purchase price</label><CurrencyInput value={f.purchase_price} onChange={(v) => set("purchase_price", v)} className={field} /></div>
            <div><label className="text-xs text-slate-500">Down payment</label><CurrencyInput value={f.down_payment} onChange={(v) => set("down_payment", v)} className={field} /></div>
            <div><label className="text-xs text-slate-500">Approved loan amount</label><CurrencyInput value={f.loan_amount} onChange={(v) => set("loan_amount", v)} placeholder="auto = price − down" className={field} /></div>
            <div><label className="text-xs text-slate-500">Loan term</label><select value={f.term} onChange={(e) => set("term", e.target.value)} className={field}>{TERMS.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div><label className="text-xs text-slate-500">Estimated rate</label><input value={f.interest_rate} onChange={(e) => set("interest_rate", e.target.value)} placeholder="e.g. 6.5% (or leave blank)" className={field} /></div>
            <div><label className="text-xs text-slate-500">Expires on</label><input type="date" value={f.expires_on} onChange={(e) => set("expires_on", e.target.value)} placeholder="defaults to 60 days" className={field} /></div>
          </div>
          <div><label className="text-xs text-slate-500">Property address</label><AddressInput value={f.property_address} onChange={(v) => set("property_address", v)} placeholder="To be determined" /></div>
          <div><label className="text-xs text-slate-500">Conditions</label><textarea value={f.conditions} onChange={(e) => set("conditions", e.target.value)} rows={2} className={field} /></div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <div className="text-xs text-slate-400 mb-2">📑 Additional loan terms <span className="text-slate-500">— captured from the term sheet; edit any, blanks are left off the letter (LTV auto-computes from amount ÷ price)</span></div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {EXTRA_FIELDS.map(([k, label, ph]) => (
                <div key={k}><label className="text-xs text-slate-500">{label}</label><input value={f[k] || ""} onChange={(e) => set(k, e.target.value)} placeholder={ph} className={field} /></div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="text-xs text-slate-500">Loan officer name</label><input value={f.officer_name} onChange={(e) => set("officer_name", e.target.value)} className={field} /></div>
            <div><label className="text-xs text-slate-500">Officer NMLS #</label><input value={f.officer_nmls} onChange={(e) => set("officer_nmls", e.target.value)} className={field} /></div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <div className="text-xs text-slate-400 mb-2">📧 Email the PDF letter automatically — <span className="text-slate-500">both optional, leave blank to skip</span></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="text-xs text-slate-500">Borrower email</label><input type="email" value={f.borrower_email} onChange={(e) => set("borrower_email", e.target.value)} placeholder="optional" className={field} /></div>
              <div><label className="text-xs text-slate-500">Agent email</label><input type="email" value={f.agent_email} onChange={(e) => set("agent_email", e.target.value)} placeholder="optional" className={field} /></div>
            </div>
          </div>
          <button type="submit" disabled={saving} className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-bold py-2.5 rounded-lg flex items-center justify-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Issue pre-approval letter
          </button>
          <p className="text-[11px] text-slate-500">Not a commitment to lend. Subject to verification, appraisal, and full underwriting. NMLS #2267023 · Equal Housing Opportunity.</p>
        </form>

        {/* Issued list */}
        <h2 className="text-lg font-semibold mt-8">Issued letters</h2>
        {loading && <div className="text-slate-500 mt-3 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
        <div className="space-y-2 mt-3">
          {list.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 bg-slate-900/40 border border-slate-800 rounded-xl px-4 py-3">
              <div className="min-w-0">
                <div className="font-medium truncate">{p.borrower_name} {p.status === "void" && <span className="text-[10px] text-red-400">VOID</span>}</div>
                <div className="text-xs text-slate-500">{p.letter_number} · {p.loan_type || "—"} · {money(p.loan_amount)} · exp {p.expires_on || "—"}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <a href={`/letter/${p.share_token}`} target="_blank" rel="noreferrer" className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" /> View</a>
                <a href={`/api/letter/${p.share_token}/pdf`} title="Download PDF" className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 flex items-center"><Download className="w-3.5 h-3.5" /></a>
                <button onClick={() => copyLink(p.share_token)} className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700">{copied === p.share_token ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}</button>
                {p.status !== "void" && <button onClick={() => voidLetter(p.id)} title="Void" className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-red-900/60 text-slate-400"><Ban className="w-3.5 h-3.5" /></button>}
              </div>
            </div>
          ))}
          {!loading && !list.length && <div className="text-slate-600 text-sm">No letters issued yet.</div>}
        </div>
      </div>
    </div>
  );
}

"use client";

// Loan Scenario Desk — the centerpiece. Build a deal, shop it to wholesale
// lenders for pricing/approval, compare the quotes that come back, crown a
// winner, and push it straight into a Fetti pre-approval letter.
//
// Two-pane: LEFT = create/prefill + the scenario list. RIGHT = the editor
// (driven by SCENARIO_SECTIONS so it never drifts from the PDF), the wholesaler
// shopping panel, and the quotes comparison table.
//
// HARD RULE honored throughout: every field/row component that contains an
// <input>/<textarea>/<select> is defined at MODULE scope and fed by props — so
// React never remounts inputs on a keystroke ("types one char at a time"). Money
// fields all use the shared CurrencyInput (commas + $).

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Layers, Loader2, Plus, Search, Download, Send, Trash2, Building2, Save,
  Crown, FileCheck2, ExternalLink, UserPlus, X, Check, RefreshCw, ArrowLeft,
} from "lucide-react";
import CurrencyInput from "@/components/ui/CurrencyInput";
import AddressInput from "@/components/AddressInput";
import {
  SCENARIO_SECTIONS, fmtMoney, fmtPercent,
  type Scenario, type Wholesaler, type Quote, type Field, type ScenarioStatus,
} from "@/lib/scenario";

// ----------------------------------------------------------------------------
// Shared style tokens (mirror the rest of the CRM — emerald-on-slate dark theme)
// ----------------------------------------------------------------------------
const field =
  "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none";
const fieldSm =
  "w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none";

const STATUS_BADGE: Record<ScenarioStatus, string> = {
  draft: "bg-slate-700/60 text-slate-300",
  shopping: "bg-amber-500/20 text-amber-300",
  quoted: "bg-sky-500/20 text-sky-300",
  won: "bg-emerald-500/20 text-emerald-300",
  lost: "bg-red-500/20 text-red-300",
  archived: "bg-slate-800 text-slate-500",
};

// ----------------------------------------------------------------------------
// Light row/option types for the prefill pickers
// ----------------------------------------------------------------------------
type LeadOpt = { id: string; full_name?: string | null; first_name?: string | null; last_name?: string | null; loan_purpose?: string | null };
type FileOpt = { id: string; borrower_name?: string | null; product?: string | null };

// ============================================================================
// MODULE-SCOPE field components (never defined inside the page body)
// ============================================================================

// One editor field — picks the right control off field.type. Money -> CurrencyInput.
function EditorField({
  f, value, onChange,
}: {
  f: Field;
  value: any;
  onChange: (key: keyof Scenario, raw: string) => void;
}) {
  const v = value == null ? "" : String(value);
  return (
    <div className={f.full ? "sm:col-span-2" : ""}>
      <label className="text-xs text-slate-500 flex items-center gap-1">
        {f.label}
        {f.hint && <span className="text-[10px] text-slate-600">· {f.hint}</span>}
      </label>
      {f.key === "property_address" ? (
        <AddressInput value={v} onChange={(val) => onChange(f.key, val)} placeholder={f.label} />
      ) : f.type === "money" ? (
        <CurrencyInput value={v} onChange={(clean) => onChange(f.key, clean)} className={field} />
      ) : f.type === "select" ? (
        <select value={v} onChange={(e) => onChange(f.key, e.target.value)} className={field}>
          <option value="">— Select —</option>
          {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : f.type === "textarea" ? (
        <textarea value={v} onChange={(e) => onChange(f.key, e.target.value)} rows={3} className={field} />
      ) : f.type === "number" || f.type === "percent" ? (
        <input
          type="number" inputMode="decimal" step="any" value={v}
          onChange={(e) => onChange(f.key, e.target.value)} className={field}
          placeholder={f.type === "percent" ? "%" : ""}
        />
      ) : (
        <input type="text" value={v} onChange={(e) => onChange(f.key, e.target.value)} className={field} />
      )}
    </div>
  );
}

// A wholesaler management row (list / inline checkbox / delete).
function WholesalerRow({
  w, checked, onToggle, onDelete,
}: {
  w: Wholesaler;
  checked: boolean;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 bg-slate-900/50 border border-slate-800 rounded-lg px-3 py-2 cursor-pointer hover:border-slate-700">
      <input type="checkbox" checked={checked} onChange={() => onToggle(w.id)} className="accent-emerald-500" />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-white truncate">{w.company}</div>
        <div className="text-[11px] text-slate-500 truncate">
          {[w.lender_type, w.contact_name, w.email].filter(Boolean).join(" · ") || "—"}
        </div>
      </div>
      <button
        type="button" title="Remove wholesaler"
        onClick={(e) => { e.preventDefault(); onDelete(w.id); }}
        className="text-slate-600 hover:text-red-400 shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </label>
  );
}

// The "add a wholesaler" inline form. State lives here (module scope component),
// committed up via onAdd — so typing never remounts.
function AddWholesalerForm({ onAdd }: { onAdd: (w: Partial<Wholesaler>) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [w, setW] = useState<Partial<Wholesaler>>({});
  const set = (k: keyof Wholesaler, v: string) => setW((p) => ({ ...p, [k]: v }));

  async function submit() {
    if (!String(w.company || "").trim()) return;
    setBusy(true);
    try {
      await onAdd(w);
      setW({}); setOpen(false);
    } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button
        type="button" onClick={() => setOpen(true)}
        className="w-full text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg py-2 flex items-center justify-center gap-1.5"
      >
        <UserPlus className="w-4 h-4" /> Add a wholesaler
      </button>
    );
  }
  return (
    <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-3 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input autoFocus value={w.company || ""} onChange={(e) => set("company", e.target.value)} placeholder="Company *" className={fieldSm} />
        <input value={w.contact_name || ""} onChange={(e) => set("contact_name", e.target.value)} placeholder="Contact name" className={fieldSm} />
        <input type="email" value={w.email || ""} onChange={(e) => set("email", e.target.value)} placeholder="Email" className={fieldSm} />
        <input value={w.phone || ""} onChange={(e) => set("phone", e.target.value)} placeholder="Phone" className={fieldSm} />
        <input value={w.lender_type || ""} onChange={(e) => set("lender_type", e.target.value)} placeholder="Lender type (DSCR / Non-QM / …)" className={`${fieldSm} sm:col-span-2`} />
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={submit} className="text-xs bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-semibold px-3 py-1.5 rounded flex items-center gap-1">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save
        </button>
        <button type="button" onClick={() => { setOpen(false); setW({}); }} className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded flex items-center gap-1">
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
      </div>
    </div>
  );
}

// A single editable quote row in the comparison table. Local draft state lives
// in this module-scope component; saving lifts it up via onSave.
function QuoteRow({
  q, isBest, saving, onSave, onWinner,
}: {
  q: Quote;
  isBest: boolean;
  saving: boolean;
  onSave: (wholesaler_id: string, patch: Partial<Quote>) => void;
  onWinner: (wholesaler_id: string) => void;
}) {
  const [d, setD] = useState<Partial<Quote>>({
    status: q.status, rate: q.rate ?? null, points: q.points ?? null,
    lender_fees: q.lender_fees ?? null, max_ltv: q.max_ltv ?? null,
    term: q.term ?? "", conditions: q.conditions ?? "",
  });
  // Re-sync local draft when the underlying quote changes (e.g. after a refresh).
  useEffect(() => {
    setD({
      status: q.status, rate: q.rate ?? null, points: q.points ?? null,
      lender_fees: q.lender_fees ?? null, max_ltv: q.max_ltv ?? null,
      term: q.term ?? "", conditions: q.conditions ?? "",
    });
  }, [q.id, q.status, q.rate, q.points, q.lender_fees, q.max_ltv, q.term, q.conditions]);

  const set = (k: keyof Quote, v: any) => setD((p) => ({ ...p, [k]: v }));
  const rowCls = q.is_winner
    ? "bg-emerald-500/10 border-emerald-500/40"
    : isBest ? "bg-emerald-500/[0.04] border-slate-800" : "border-slate-800";

  return (
    <tr className={`border-t ${rowCls}`}>
      <td className="px-3 py-2 align-top">
        <div className="text-sm text-white flex items-center gap-1">
          {q.is_winner && <Crown className="w-3.5 h-3.5 text-emerald-400" />}
          {q.wholesaler_company}
        </div>
        {isBest && !q.is_winner && <div className="text-[10px] text-emerald-400/80">best rate</div>}
      </td>
      <td className="px-2 py-2 align-top">
        <select value={d.status || "sent"} onChange={(e) => set("status", e.target.value)} className={`${fieldSm} w-24`}>
          {["sent", "quoted", "approved", "declined"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td className="px-2 py-2 align-top">
        <input type="number" step="any" value={d.rate ?? ""} onChange={(e) => set("rate", e.target.value)} placeholder="%" className={`${fieldSm} w-16`} />
      </td>
      <td className="px-2 py-2 align-top">
        <input type="number" step="any" value={d.points ?? ""} onChange={(e) => set("points", e.target.value)} placeholder="pts" className={`${fieldSm} w-16`} />
      </td>
      <td className="px-2 py-2 align-top w-28">
        <CurrencyInput value={d.lender_fees as any ?? ""} onChange={(v) => set("lender_fees", v)} className={fieldSm} />
      </td>
      <td className="px-2 py-2 align-top">
        <input type="number" step="any" value={d.max_ltv ?? ""} onChange={(e) => set("max_ltv", e.target.value)} placeholder="%" className={`${fieldSm} w-16`} />
      </td>
      <td className="px-2 py-2 align-top">
        <input value={d.term ?? ""} onChange={(e) => set("term", e.target.value)} placeholder="30yr" className={`${fieldSm} w-24`} />
      </td>
      <td className="px-2 py-2 align-top">
        <input value={d.conditions ?? ""} onChange={(e) => set("conditions", e.target.value)} placeholder="stips" className={`${fieldSm} w-40`} />
      </td>
      <td className="px-2 py-2 align-top whitespace-nowrap">
        <div className="flex items-center gap-1">
          <button
            type="button" disabled={saving} title="Save quote"
            onClick={() => onSave(q.wholesaler_id, d)}
            className="text-[11px] bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-slate-200 px-2 py-1 rounded flex items-center gap-1"
          >
            <Save className="w-3 h-3" /> Save
          </button>
          <button
            type="button" disabled={saving} title="Mark as winner"
            onClick={() => onWinner(q.wholesaler_id)}
            className={`text-[11px] px-2 py-1 rounded flex items-center gap-1 ${q.is_winner ? "bg-emerald-500 text-slate-950" : "bg-slate-800 hover:bg-slate-700 text-amber-300"}`}
          >
            <Crown className="w-3 h-3" /> {q.is_winner ? "Winner" : "Win"}
          </button>
        </div>
      </td>
    </tr>
  );
}

// ============================================================================
// PAGE
// ============================================================================
function ScenarioDesk() {
  const router = useRouter();
  const sp = useSearchParams();

  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [wholesalers, setWholesalers] = useState<Wholesaler[]>([]);
  const [leads, setLeads] = useState<LeadOpt[]>([]);
  const [files, setFiles] = useState<FileOpt[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Scenario | null>(null); // editor working copy

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState(""); // list search
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [flash, setFlash] = useState<string | null>(null);

  const selected = useMemo(
    () => scenarios.find((s) => s.id === selectedId) || null,
    [scenarios, selectedId]
  );

  // --- loaders ---------------------------------------------------------------
  const loadScenarios = useCallback(async (): Promise<Scenario[]> => {
    const r = await fetch("/api/scenarios");
    if (!r.ok) throw new Error("Could not load scenarios.");
    const j = await r.json();
    const list: Scenario[] = j.scenarios || [];
    setScenarios(list);
    return list;
  }, []);

  const loadWholesalers = useCallback(async () => {
    const r = await fetch("/api/wholesalers");
    if (r.ok) setWholesalers((await r.json()).wholesalers || []);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadScenarios(), loadWholesalers()]);
      } catch (e: any) { setErr(e?.message || "Load failed."); }
      finally { setLoading(false); }
      // Picker sources (best-effort; tolerate routes that don't list).
      try { const r = await fetch("/api/leads"); if (r.ok) setLeads((await r.json()).leads || []); } catch {}
      try { const r = await fetch("/api/los/files"); if (r.ok) setFiles((await r.json()).files || []); } catch {}
    })();
  }, [loadScenarios, loadWholesalers]);

  // Keep the editor draft in sync when selection changes.
  useEffect(() => {
    setDraft(selected ? { ...selected } : null);
    setChecked({});
  }, [selectedId, selected?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- create / prefill ------------------------------------------------------
  const createBlank = useCallback(async () => {
    setBusyAction("new");
    try {
      const r = await fetch("/api/scenarios", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const j = await r.json();
      if (r.ok) { await loadScenarios(); setSelectedId(j.scenario.id); }
      else setErr(j.error || "Could not create scenario.");
    } finally { setBusyAction(null); }
  }, [loadScenarios]);

  // Prefill from a lead or loan file: GET the draft, POST to create, select it.
  const createFromSource = useCallback(async (kind: "lead_id" | "loan_file_id", id: string) => {
    if (!id) return;
    setBusyAction("prefill");
    try {
      const pr = await fetch(`/api/scenarios/prefill?${kind}=${encodeURIComponent(id)}`);
      const pj = await pr.json();
      if (!pr.ok) { setErr(pj.error || "Could not prefill."); return; }
      const r = await fetch("/api/scenarios", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pj.draft || {}),
      });
      const j = await r.json();
      if (r.ok) { await loadScenarios(); setSelectedId(j.scenario.id); }
      else setErr(j.error || "Could not create scenario.");
    } finally { setBusyAction(null); }
  }, [loadScenarios]);

  // INTERTWINE: auto-create a prefilled scenario when the URL carries an id.
  useEffect(() => {
    if (loading) return;
    const leadId = sp.get("lead_id");
    const fileId = sp.get("loan_file_id") || sp.get("file");
    if (!leadId && !fileId) return;
    (async () => {
      if (fileId) await createFromSource("loan_file_id", fileId);
      else if (leadId) await createFromSource("lead_id", leadId);
      // Clear the query so a refresh doesn't re-create.
      router.replace("/scenarios");
    })();
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- editor save -----------------------------------------------------------
  const setF = useCallback((key: keyof Scenario, raw: string) => {
    setDraft((p) => (p ? { ...p, [key]: raw } as Scenario : p));
  }, []);

  const saveScenario = useCallback(async () => {
    if (!draft) return;
    setSaving(true); setErr(null);
    try {
      const body: any = { id: draft.id, status: draft.status, lead_id: draft.lead_id, loan_file_id: draft.loan_file_id };
      for (const sec of SCENARIO_SECTIONS) for (const f of sec.fields) body[f.key] = (draft as any)[f.key];
      const r = await fetch("/api/scenarios", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await r.json();
      if (r.ok) { await loadScenarios(); setSelectedId(j.scenario.id); setFlash("Saved."); setTimeout(() => setFlash(null), 1500); }
      else setErr(j.error || "Save failed.");
    } catch (e: any) { setErr(e?.message || "Save failed."); }
    finally { setSaving(false); }
  }, [draft, loadScenarios]);

  const deleteScenario = useCallback(async (id: string) => {
    setBusyAction("delete");
    try {
      await fetch(`/api/scenarios?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (selectedId === id) setSelectedId(null);
      await loadScenarios();
    } finally { setBusyAction(null); }
  }, [loadScenarios, selectedId]);

  // --- wholesalers -----------------------------------------------------------
  const addWholesaler = useCallback(async (w: Partial<Wholesaler>) => {
    const r = await fetch("/api/wholesalers", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(w),
    });
    if (r.ok) await loadWholesalers();
  }, [loadWholesalers]);

  const deleteWholesaler = useCallback(async (id: string) => {
    await fetch(`/api/wholesalers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setChecked((p) => { const n = { ...p }; delete n[id]; return n; });
    await loadWholesalers();
  }, [loadWholesalers]);

  const toggle = useCallback((id: string) => setChecked((p) => ({ ...p, [id]: !p[id] })), []);

  // --- shopping --------------------------------------------------------------
  const selectedIds = useMemo(() => Object.keys(checked).filter((k) => checked[k]), [checked]);

  const sendToWholesalers = useCallback(async () => {
    if (!selected || !selectedIds.length) return;
    setBusyAction("send");
    try {
      const r = await fetch(`/api/scenarios/${selected.id}/send`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wholesaler_ids: selectedIds }),
      });
      const j = await r.json();
      if (r.ok) { await loadScenarios(); setChecked({}); setFlash(`Sent to ${(j.sent || []).length} wholesaler(s).`); setTimeout(() => setFlash(null), 2500); }
      else setErr(j.error || "Send failed.");
    } finally { setBusyAction(null); }
  }, [selected, selectedIds, loadScenarios]);

  // --- quotes ----------------------------------------------------------------
  const saveQuote = useCallback(async (wholesaler_id: string, patch: Partial<Quote>) => {
    if (!selected) return;
    setBusyAction("quote:" + wholesaler_id);
    try {
      const r = await fetch(`/api/scenarios/${selected.id}/quote`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wholesaler_id, ...patch }),
      });
      if (r.ok) await loadScenarios();
    } finally { setBusyAction(null); }
  }, [selected, loadScenarios]);

  const markWinner = useCallback(async (wholesaler_id: string) => {
    if (!selected) return;
    setBusyAction("winner:" + wholesaler_id);
    try {
      const r = await fetch(`/api/scenarios/${selected.id}/quote`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wholesaler_id, is_winner: true }),
      });
      if (r.ok) await loadScenarios();
    } finally { setBusyAction(null); }
  }, [selected, loadScenarios]);

  // --- pre-approval from winner ---------------------------------------------
  const issuePreapproval = useCallback(async () => {
    if (!selected) return;
    const winner = (selected.quotes || []).find((x) => x.is_winner);
    setBusyAction("preapproval");
    try {
      const body = {
        lead_id: selected.lead_id || undefined,
        loan_file_id: selected.loan_file_id || undefined,
        borrower_name: selected.borrower_name || "",
        co_borrower: selected.co_borrower || "",
        loan_type: selected.loan_type || "",
        purchase_price: selected.purchase_price ?? "",
        down_payment: selected.down_payment ?? "",
        loan_amount: selected.loan_amount ?? "",
        interest_rate: winner?.rate != null ? String(winner.rate) + "%" : "",
        term: winner?.term || selected.term || "",
        property_address: selected.property_address || "",
        occupancy: selected.occupancy === "Investment" ? "Investment" : selected.occupancy === "Primary Residence" ? "Primary residence" : selected.occupancy === "Second Home" ? "Second home" : "",
        conditions: winner?.conditions || undefined,
      };
      const r = await fetch("/api/preapprovals", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (r.ok) router.push("/preapprovals");
      else { const j = await r.json().catch(() => ({})); setErr(j.error || "Could not issue pre-approval."); }
    } finally { setBusyAction(null); }
  }, [selected, router]);

  // --- derived ---------------------------------------------------------------
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return scenarios;
    return scenarios.filter((s) =>
      [s.scenario_number, s.borrower_name, s.loan_type, s.property_address, s.state]
        .filter(Boolean).join(" ").toLowerCase().includes(t)
    );
  }, [scenarios, q]);

  const bestQuoteWholesalerId = useMemo(() => {
    const quotes = (selected?.quotes || []).filter((x) => x.rate != null);
    if (!quotes.length) return null;
    return quotes.reduce((a, b) => ((a.rate as number) <= (b.rate as number) ? a : b)).wholesaler_id;
  }, [selected]);

  const hasWinner = !!(selected?.quotes || []).some((x) => x.is_winner);

  // ===========================================================================
  // RENDER
  // ===========================================================================
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-[1400px] mx-auto p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <button
              type="button"
              onClick={() => { if (typeof window !== "undefined" && window.history.length > 1) router.back(); else router.push("/"); }}
              className="text-sm text-slate-400 hover:text-emerald-300 flex items-center gap-1.5 mb-2"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Layers className="w-6 h-6 text-emerald-400" /> Scenario Desk</h1>
            <p className="text-slate-400 text-sm mt-1">Build a deal, shop it to wholesale lenders, compare quotes, crown a winner.</p>
          </div>
          {flash && <div className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-1.5">{flash}</div>}
        </div>

        {err && (
          <div className="mt-3 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 flex items-center justify-between">
            {err}<button onClick={() => setErr(null)} className="text-red-400 hover:text-red-200"><X className="w-4 h-4" /></button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5 mt-5">
          {/* ============================ LEFT PANE ============================ */}
          <div className="space-y-3">
            <button
              type="button" onClick={createBlank} disabled={busyAction === "new"}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-bold py-2.5 rounded-lg flex items-center justify-center gap-2"
            >
              {busyAction === "new" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} New Scenario
            </button>

            {/* Prefill pickers */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3 space-y-2">
              <div className="text-xs text-slate-500 font-semibold">Start from an existing record</div>
              <select
                defaultValue="" disabled={busyAction === "prefill"}
                onChange={(e) => { if (e.target.value) createFromSource("loan_file_id", e.target.value); e.currentTarget.value = ""; }}
                className={field}
              >
                <option value="">From Loan File…</option>
                {files.map((lf) => <option key={lf.id} value={lf.id}>{lf.borrower_name || "Borrower"} · {lf.product || "—"}</option>)}
              </select>
              <select
                defaultValue="" disabled={busyAction === "prefill"}
                onChange={(e) => { if (e.target.value) createFromSource("lead_id", e.target.value); e.currentTarget.value = ""; }}
                className={field}
              >
                <option value="">From Lead…</option>
                {leads.map((l) => {
                  const name = l.full_name || [l.first_name, l.last_name].filter(Boolean).join(" ") || "Lead";
                  return <option key={l.id} value={l.id}>{name} · {l.loan_purpose || "—"}</option>;
                })}
              </select>
              {busyAction === "prefill" && <div className="text-xs text-slate-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Prefilling…</div>}
            </div>

            {/* Search + list */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search scenarios…" className={`${field} pl-9`} />
            </div>

            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {loading && <div className="text-slate-500 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
              {!loading && !filtered.length && <div className="text-slate-600 text-sm py-6 text-center">No scenarios yet. Create one above.</div>}
              {filtered.map((s) => (
                <button
                  key={s.id} type="button" onClick={() => setSelectedId(s.id)}
                  className={`w-full text-left bg-slate-900/40 border rounded-xl px-3 py-2.5 transition ${selectedId === s.id ? "border-emerald-500/60 bg-emerald-500/[0.06]" : "border-slate-800 hover:border-slate-700"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-500 font-mono">{s.scenario_number}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full uppercase tracking-wide ${STATUS_BADGE[s.status] || STATUS_BADGE.draft}`}>{s.status}</span>
                  </div>
                  <div className="text-sm text-white font-medium truncate mt-0.5">{s.borrower_name || "Unnamed borrower"}</div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {[s.loan_type, fmtMoney(s.loan_amount)].filter((x) => x && x !== "—").join(" · ") || "—"}
                    {(s.quotes?.length || 0) > 0 && <span className="text-slate-400"> · {s.quotes.length} quote{s.quotes.length === 1 ? "" : "s"}</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* ============================ RIGHT PANE ============================ */}
          <div>
            {!selected ? (
              <div className="h-full min-h-[300px] flex items-center justify-center border border-dashed border-slate-800 rounded-2xl text-slate-600 text-sm">
                Select a scenario, or create one to start shopping.
              </div>
            ) : (
              <div className="space-y-5">
                {/* Header / actions */}
                <div className="flex items-center justify-between gap-3 flex-wrap bg-slate-900/40 border border-slate-800 rounded-2xl px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500 font-mono">{selected.scenario_number}</div>
                    <div className="text-lg font-semibold truncate">{draft?.borrower_name || "Unnamed borrower"}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={`/api/scenarios/${selected.id}/pdf`} target="_blank" rel="noreferrer" className="text-sm bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                      <Download className="w-4 h-4" /> PDF
                    </a>
                    <button type="button" onClick={saveScenario} disabled={saving} className="text-sm bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
                    </button>
                    <button type="button" onClick={() => deleteScenario(selected.id)} title="Delete scenario" className="text-sm bg-slate-800 hover:bg-red-900/50 text-slate-400 px-2.5 py-1.5 rounded-lg">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Editor: SCENARIO_SECTIONS */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {SCENARIO_SECTIONS.map((sec) => (
                    <div key={sec.title} className={`bg-slate-900/40 border border-slate-800 rounded-2xl p-4 ${sec.fields.some((f) => f.full) && sec.fields.length === 1 ? "xl:col-span-2" : ""}`}>
                      <div className="text-sm font-semibold text-emerald-300 mb-3">{sec.title}</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {sec.fields.map((f) => (
                          <EditorField key={String(f.key)} f={f} value={draft ? (draft as any)[f.key] : ""} onChange={setF} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* WHOLESALER SHOPPING */}
                <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                    <div className="text-sm font-semibold flex items-center gap-2"><Building2 className="w-4 h-4 text-emerald-400" /> Shop to wholesalers</div>
                    <button
                      type="button" onClick={sendToWholesalers} disabled={!selectedIds.length || busyAction === "send"}
                      className="text-sm bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5"
                    >
                      {busyAction === "send" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send to {selectedIds.length} wholesaler{selectedIds.length === 1 ? "" : "s"}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {wholesalers.map((w) => (
                      <WholesalerRow key={w.id} w={w} checked={!!checked[w.id]} onToggle={toggle} onDelete={deleteWholesaler} />
                    ))}
                  </div>
                  {!wholesalers.length && <div className="text-slate-600 text-sm mb-2">No wholesalers yet — add your lender contacts below.</div>}
                  <div className="mt-3"><AddWholesalerForm onAdd={addWholesaler} /></div>
                </div>

                {/* QUOTES comparison */}
                <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                    <div className="text-sm font-semibold flex items-center gap-2"><RefreshCw className="w-4 h-4 text-emerald-400" /> Quotes</div>
                    {hasWinner && (
                      <button
                        type="button" onClick={issuePreapproval} disabled={busyAction === "preapproval"}
                        className="text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5"
                      >
                        {busyAction === "preapproval" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCheck2 className="w-4 h-4" />} Issue Pre-Approval from winner
                        <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                      </button>
                    )}
                  </div>
                  {!(selected.quotes?.length) ? (
                    <div className="text-slate-600 text-sm">No quotes yet. Select wholesalers above and send the scenario.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-[11px] uppercase tracking-wide text-slate-500 text-left">
                            <th className="px-3 py-2 font-medium">Wholesaler</th>
                            <th className="px-2 py-2 font-medium">Status</th>
                            <th className="px-2 py-2 font-medium">Rate</th>
                            <th className="px-2 py-2 font-medium">Points</th>
                            <th className="px-2 py-2 font-medium">Lender Fees</th>
                            <th className="px-2 py-2 font-medium">Max LTV</th>
                            <th className="px-2 py-2 font-medium">Term</th>
                            <th className="px-2 py-2 font-medium">Conditions</th>
                            <th className="px-2 py-2 font-medium">Winner</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.quotes.map((qt) => (
                            <QuoteRow
                              key={qt.id || qt.wholesaler_id}
                              q={qt}
                              isBest={qt.wholesaler_id === bestQuoteWholesalerId}
                              saving={busyAction === "quote:" + qt.wholesaler_id || busyAction === "winner:" + qt.wholesaler_id}
                              onSave={saveQuote}
                              onWinner={markWinner}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="text-[11px] text-slate-600 mt-6">
          Quotes are lender pricing indications for internal comparison only — not a commitment to lend. Subject to verification, appraisal, and full underwriting.
        </p>
      </div>
    </div>
  );
}

export default function ScenariosPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 text-slate-500 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>}>
      <ScenarioDesk />
    </Suspense>
  );
}

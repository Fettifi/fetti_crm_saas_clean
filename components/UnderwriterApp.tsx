"use client";

// Portfolio Underwriter — drop a spreadsheet of properties, AI maps the columns,
// the engine sizes every loan (LTV cap vs DSCR floor), and the page recomputes
// LIVE as you tweak assumptions or verify back taxes. Save/load portfolios via
// /api/underwrite; export the grid as CSV.
//
// HARD RULE honored: every component that contains an <input>/<select> lives at
// MODULE scope and is fed by props — never defined inside the page body (input
// focus bug: inline components remount per keystroke).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Building2, Upload, Loader2, ChevronDown, ChevronRight, Save,
  Trash2, Download, Copy, Check, ExternalLink, Search, AlertTriangle, X,
  FileSpreadsheet, ShieldAlert, ShieldCheck,
} from "lucide-react";
import * as XLSX from "xlsx";
import {
  underwritePortfolio, DEFAULT_ASSUMPTIONS,
  type PropertyRow, type Assumptions, type UnderwriteResult, type PortfolioSummary, type BackTaxStatus,
} from "@/lib/underwrite/engine";
import { taxWorklist, type TaxLookup } from "@/lib/underwrite/taxLinks";
import { qualifyDeal } from "@/lib/underwrite/dealQualifier";

// ----------------------------------------------------------------------------
// Shared style tokens (emerald-on-slate dark theme, same as Scenario Desk)
// ----------------------------------------------------------------------------
const field =
  "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none";
const fieldSm =
  "bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none";

const VERDICT_BADGE: Record<UnderwriteResult["verdict"], string> = {
  strong: "bg-emerald-500/20 text-emerald-300",
  workable: "bg-sky-500/20 text-sky-300",
  thin: "bg-amber-500/20 text-amber-300",
  insufficient: "bg-slate-700/60 text-slate-400",
};

const fm = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : "$" + Math.round(n).toLocaleString();
const fp = (n: number | null | undefined, d = 1) =>
  n == null || !Number.isFinite(n) ? "—" : n.toFixed(d) + "%";
const fx = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : n.toFixed(2);

// The six assumptions editable on the bar (rest ride on DEFAULT_ASSUMPTIONS / saved values).
const EDITABLE: { key: keyof Assumptions; label: string; suffix: string; step: string }[] = [
  { key: "rate_pct", label: "Rate", suffix: "%", step: "0.125" },
  { key: "target_dscr", label: "Target DSCR", suffix: "x", step: "0.05" },
  { key: "max_ltv_pct", label: "Max LTV", suffix: "%", step: "1" },
  { key: "vacancy_pct", label: "Vacancy", suffix: "%", step: "1" },
  { key: "mgmt_pct", label: "Mgmt", suffix: "%", step: "1" },
  { key: "closing_cost_pct", label: "Closing costs", suffix: "%", step: "0.5" },
];

type SavedMeta = { id: string; name: string; count: number; updated_at: string };

// ============================================================================
// MODULE-SCOPE components (anything with an input lives here)
// ============================================================================

function VerdictBadge({ v }: { v: UnderwriteResult["verdict"] }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${VERDICT_BADGE[v]}`}>
      {v}
    </span>
  );
}

function ConstraintChip({ c }: { c: UnderwriteResult["binding_constraint"] }) {
  if (c === "none") return <span className="text-slate-600 text-[11px]">—</span>;
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${c === "dscr" ? "bg-violet-500/20 text-violet-300" : "bg-sky-500/20 text-sky-300"}`}>
      {c}
    </span>
  );
}

function SummaryCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "red" | "emerald" }) {
  const border = tone === "red" ? "border-red-500/40 bg-red-500/[0.07]" : tone === "emerald" ? "border-emerald-500/40 bg-emerald-500/[0.06]" : "border-slate-800 bg-slate-900/40";
  const valColor = tone === "red" ? "text-red-300" : "text-white";
  return (
    <div className={`border rounded-xl px-3 py-2.5 ${border}`}>
      <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-bold ${valColor}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function AssumptionInput({
  k, label, suffix, step, value, onChange,
}: {
  k: keyof Assumptions; label: string; suffix: string; step: string;
  value: string; onChange: (k: keyof Assumptions, v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 min-w-[92px]">
      <span className="text-[11px] text-slate-500 font-semibold">{label}</span>
      <div className="relative">
        <input
          type="number" inputMode="decimal" step={step} value={value}
          onChange={(e) => onChange(k, e.target.value)}
          className={`${fieldSm} w-full pr-6 py-1.5`}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">{suffix}</span>
      </div>
    </label>
  );
}

// Back-tax status + amount, used in both the detail panel and the tax worklist.
function BackTaxEditor({
  id, status, amount, onStatus, onAmount,
}: {
  id: string; status: BackTaxStatus; amount: number | null | undefined;
  onStatus: (id: string, s: BackTaxStatus) => void;
  onAmount: (id: string, v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={status}
        onChange={(e) => onStatus(id, e.target.value as BackTaxStatus)}
        className={`${fieldSm} py-1.5`}
      >
        <option value="unknown">Unverified</option>
        <option value="clear">Clear</option>
        <option value="owed">Owed</option>
      </select>
      {status === "owed" && (
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">$</span>
          <input
            type="number" inputMode="decimal" min="0" step="1"
            value={amount ?? ""} placeholder="amount"
            onChange={(e) => onAmount(id, e.target.value)}
            className={`${fieldSm} w-28 pl-5 py-1.5`}
          />
        </div>
      )}
    </div>
  );
}

function TaxWorklistRow({
  item, copiedId, onCopy, onStatus, onAmount,
}: {
  item: TaxLookup; copiedId: string | null;
  onCopy: (id: string, text: string) => void;
  onStatus: (id: string, s: BackTaxStatus) => void;
  onAmount: (id: string, v: string) => void;
}) {
  const statusPill =
    item.status === "owed" ? "bg-red-500/20 text-red-300" :
    item.status === "unknown" ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/20 text-emerald-300";
  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-xl px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-white font-medium">{item.pasteAddress}</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${statusPill}`}>
            {item.status === "unknown" ? "unverified" : item.status}
            {item.status === "owed" && item.amount ? ` · ${fm(item.amount)}` : ""}
          </span>
          {item.taxesAnnual != null && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300">
              {fm(item.taxesAnnual)}/yr tax
            </span>
          )}
        </div>
        {item.notes && (
          <div className="text-[11px] text-slate-400 leading-relaxed mt-1 whitespace-pre-wrap">{item.notes}</div>
        )}
        <div className="flex items-center gap-3 mt-1 text-[12px]">
          <button
            type="button" onClick={() => onCopy(item.id, item.pasteAddress)}
            className="text-slate-400 hover:text-emerald-300 flex items-center gap-1"
          >
            {copiedId === item.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {copiedId === item.id ? "Copied" : "Copy address"}
          </button>
          <a href={item.countyUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-semibold">
            <ExternalLink className="w-3 h-3" /> {item.countyName}
          </a>
          <a href={item.netrUrl} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300 flex items-center gap-1">
            <ExternalLink className="w-3 h-3" /> NETR
          </a>
          <a href={item.searchUrl} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300 flex items-center gap-1">
            <Search className="w-3 h-3" /> Search
          </a>
        </div>
      </div>
      <BackTaxEditor id={item.id} status={item.status} amount={item.amount} onStatus={onStatus} onAmount={onAmount} />
    </div>
  );
}

// Single-property manual entry form. Inputs, so module scope.
function ManualPropertyForm({ onAdd, hasRows }: {
  onAdd: (r: Omit<PropertyRow, "id" | "back_tax_status">) => void; hasRows: boolean;
}) {
  const [f, setF] = useState({ address: "", city: "", state: "", zip: "", price: "", rent: "", taxes: "", insurance: "", hoa: "", rehab: "", arv: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const num = (s: string) => { const n = Number(String(s).replace(/[$,\s]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
  const canAdd = f.address.trim().length > 3 && num(f.price) != null;
  const submit = () => {
    if (!canAdd) return;
    onAdd({
      address: f.address.trim(), city: f.city.trim() || null, state: f.state.trim().toUpperCase() || null, zip: f.zip.trim() || null,
      price: num(f.price), rent_monthly: num(f.rent), taxes_annual: num(f.taxes), insurance_annual: num(f.insurance),
      hoa_monthly: num(f.hoa), rehab_budget: num(f.rehab), arv: num(f.arv),
    });
    setF({ address: "", city: "", state: "", zip: "", price: "", rent: "", taxes: "", insurance: "", hoa: "", rehab: "", arv: "" });
  };
  const cls = "bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 w-full";
  return (
    <div className="mt-3 bg-slate-900/40 border border-slate-800 rounded-xl p-4">
      <div className="text-sm font-semibold text-white mb-1">Single property analysis</div>
      <div className="text-xs text-slate-500 mb-3">
        An address and a price are all it takes — the Deal Qualifier tells you the rent and ARV the deal needs to work.
        Add rent/rehab/ARV if you have them and it grades the deal against them.{hasRows ? " This adds the property to the portfolio that's already loaded." : ""}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="col-span-2"><input className={cls} placeholder="Street address *" value={f.address} onChange={set("address")} /></div>
        <input className={cls} placeholder="City" value={f.city} onChange={set("city")} />
        <div className="grid grid-cols-2 gap-2">
          <input className={cls} placeholder="ST" maxLength={2} value={f.state} onChange={set("state")} />
          <input className={cls} placeholder="ZIP" value={f.zip} onChange={set("zip")} />
        </div>
        <input className={cls} placeholder="Purchase price / value *" value={f.price} onChange={set("price")} />
        <input className={cls} placeholder="Monthly rent (optional — I'll tell you what's needed)" value={f.rent} onChange={set("rent")} />
        <input className={cls} placeholder="Annual taxes (optional)" value={f.taxes} onChange={set("taxes")} />
        <input className={cls} placeholder="Annual insurance (optional)" value={f.insurance} onChange={set("insurance")} />
        <input className={cls} placeholder="HOA /mo (optional)" value={f.hoa} onChange={set("hoa")} />
        <input className={cls} placeholder="Rehab budget (optional)" value={f.rehab} onChange={set("rehab")} />
        <input className={cls} placeholder="ARV (optional)" value={f.arv} onChange={set("arv")} />
        <button
          type="button" onClick={submit} disabled={!canAdd}
          className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 text-sm font-bold rounded-lg px-3 py-1.5"
        >
          Underwrite it
        </button>
      </div>
    </div>
  );
}

// Save bar: portfolio name + saved-list dropdown. Inputs, so module scope.
function SaveBar({
  name, onName, saving, onSave, saved, onOpen, currentId, onDelete, onExport, onExportXlsx, canExport,
}: {
  name: string; onName: (v: string) => void; saving: boolean; onSave: () => void;
  saved: SavedMeta[]; onOpen: (id: string) => void; currentId: string | null;
  onDelete: () => void; onExport: () => void; onExportXlsx: () => void; canExport: boolean;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        value={name} onChange={(e) => onName(e.target.value)} placeholder="Portfolio name…"
        className={`${fieldSm} w-44 py-1.5`}
      />
      <button
        type="button" onClick={onSave} disabled={saving || !name.trim()}
        className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5"
      >
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
      </button>
      <select
        value="" onChange={(e) => { if (e.target.value) onOpen(e.target.value); }}
        className={`${fieldSm} py-1.5 max-w-[190px]`}
      >
        <option value="">Open saved…</option>
        {saved.map((p) => (
          <option key={p.id} value={p.id}>{p.name} · {p.count} prop{p.count === 1 ? "" : "s"}</option>
        ))}
      </select>
      {currentId && (
        <button
          type="button" onClick={onDelete} title="Delete this saved portfolio"
          className="text-slate-500 hover:text-red-400 p-1.5"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
      <button
        type="button" onClick={onExportXlsx} disabled={!canExport}
        className="bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5"
        title="3-sheet workbook: Dashboard, All Doors, Tax & Title Risk"
      >
        <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel
      </button>
      <button
        type="button" onClick={onExport} disabled={!canExport}
        className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 border border-slate-700"
      >
        <Download className="w-3.5 h-3.5" /> CSV
      </button>
    </div>
  );
}

// The upload drop zone (file input inside → module scope).
function UploadZone({ parsing, onFile }: { parsing: boolean; onFile: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault(); setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-xl px-6 py-8 text-center cursor-pointer transition ${
        drag ? "border-emerald-500 bg-emerald-500/[0.06]" : "border-slate-700 bg-slate-900/40 hover:border-slate-600"
      }`}
    >
      <input
        ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
      />
      {parsing ? (
        <div className="flex items-center justify-center gap-2 text-emerald-300 text-sm">
          <Loader2 className="w-5 h-5 animate-spin" /> Mapping columns + underwriting…
        </div>
      ) : (
        <>
          <Upload className="w-7 h-7 text-slate-500 mx-auto" />
          <div className="text-sm text-slate-300 mt-2 font-medium">Drop a property spreadsheet here, or click to browse</div>
          <div className="text-xs text-slate-500 mt-1">.xlsx / .xls / .csv — AI maps your columns, every property gets sized instantly</div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// PAGE
// ============================================================================
export default function UnderwritePage() {
  const router = useRouter();

  // --- core data --------------------------------------------------------------
  const [rows, setRows] = useState<PropertyRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [parsing, setParsing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // --- assumptions: string drafts over a base so partial typing never breaks math
  const [baseAssump, setBaseAssump] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const [aStr, setAStr] = useState<Record<string, string>>(() =>
    Object.fromEntries(EDITABLE.map((f) => [f.key, String(DEFAULT_ASSUMPTIONS[f.key])]))
  );
  const setAssumption = useCallback((k: keyof Assumptions, v: string) => {
    setAStr((p) => ({ ...p, [k]: v }));
  }, []);
  const assumptions: Assumptions = useMemo(() => {
    const out: Assumptions = { ...baseAssump };
    for (const f of EDITABLE) {
      const n = parseFloat(aStr[f.key]);
      if (Number.isFinite(n) && n >= 0) (out as any)[f.key] = n;
    }
    if (out.target_dscr <= 0) out.target_dscr = DEFAULT_ASSUMPTIONS.target_dscr; // never divide by zero
    return out;
  }, [aStr, baseAssump]);

  // --- LIVE recompute: identical math to the API (pure isomorphic engine) -----
  const computed = useMemo<{ results: UnderwriteResult[]; summary: PortfolioSummary } | null>(
    () => (rows.length ? underwritePortfolio(rows, assumptions) : null),
    [rows, assumptions]
  );
  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  // --- UI state ----------------------------------------------------------------
  const [tab, setTab] = useState<"dashboard" | "results" | "tax">("dashboard");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showMapping, setShowMapping] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // --- save/load ----------------------------------------------------------------
  const [name, setName] = useState("");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedMeta[]>([]);

  const api = useCallback(async (body: any) => {
    const r = await fetch("/api/underwrite", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({ ok: false, error: "Bad response from server." }));
    if (!r.ok || j?.ok === false) throw new Error(j?.error || `Request failed (${r.status}).`);
    return j;
  }, []);

  const loadList = useCallback(async () => {
    try { const j = await api({ action: "list" }); setSaved(j.portfolios || []); } catch { /* best-effort */ }
  }, [api]);
  useEffect(() => { loadList(); }, [loadList]);

  // --- upload → parse -------------------------------------------------------------
  const onFile = useCallback((f: File) => {
    setErr(null); setParsing(true);
    const reader = new FileReader();
    reader.onerror = () => { setParsing(false); setErr("Could not read the file."); };
    reader.onload = async () => {
      try {
        const b64 = String(reader.result || "").split(",")[1] || "";
        if (!b64) throw new Error("Empty file.");
        const j = await api({ action: "parse", filename: f.name, file_b64: b64 });
        setRows(j.rows || []);
        setMapping(j.mapping || {});
        setBaseAssump(DEFAULT_ASSUMPTIONS);
        setAStr(Object.fromEntries(EDITABLE.map((x) => [x.key, String(DEFAULT_ASSUMPTIONS[x.key])])));
        setCurrentId(null);
        setName(f.name.replace(/\.(xlsx|xls|csv)$/i, ""));
        setExpandedId(null); setTab("results");
      } catch (e: any) {
        setErr(e?.message || "Parse failed.");
      } finally { setParsing(false); }
    };
    reader.readAsDataURL(f);
  }, [api]);

  // --- back-tax edits (shared by detail panel + worklist) -------------------------
  const setTaxStatus = useCallback((id: string, s: BackTaxStatus) => {
    setRows((p) => p.map((r) => (r.id === id ? { ...r, back_tax_status: s, back_tax_amount: s === "owed" ? r.back_tax_amount ?? null : null } : r)));
  }, []);
  const setTaxAmount = useCallback((id: string, v: string) => {
    const n = parseFloat(v);
    setRows((p) => p.map((r) => (r.id === id ? { ...r, back_tax_amount: Number.isFinite(n) && n >= 0 ? n : null } : r)));
  }, []);

  const onCopy = useCallback((id: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    }).catch(() => {});
  }, []);

  // --- save / open / delete --------------------------------------------------------
  const savePortfolio = useCallback(async () => {
    if (!name.trim() || !rows.length) return;
    setSaving(true); setErr(null);
    try {
      const j = await api({ action: "save", portfolio: { id: currentId || undefined, name: name.trim(), rows, assumptions } });
      setCurrentId(j.id || currentId);
      setFlash("Portfolio saved."); setTimeout(() => setFlash(null), 2000);
      await loadList();
    } catch (e: any) { setErr(e?.message || "Save failed."); }
    finally { setSaving(false); }
  }, [api, name, rows, assumptions, currentId, loadList]);

  const openPortfolio = useCallback(async (id: string) => {
    setErr(null);
    try {
      const j = await api({ action: "get", id });
      const p = j.portfolio;
      if (!p) throw new Error("Portfolio not found.");
      const a: Assumptions = { ...DEFAULT_ASSUMPTIONS, ...(p.assumptions || {}) };
      setRows(p.rows || []);
      setBaseAssump(a);
      setAStr(Object.fromEntries(EDITABLE.map((x) => [x.key, String(a[x.key])])));
      setName(p.name || "");
      setCurrentId(p.id);
      setMapping({}); setExpandedId(null); setTab("results");
    } catch (e: any) { setErr(e?.message || "Could not open portfolio."); }
  }, [api]);

  const deletePortfolio = useCallback(async () => {
    if (!currentId) return;
    if (!confirm(`Delete saved portfolio "${name || "Untitled"}"? This can't be undone.`)) return;
    setErr(null);
    try {
      await api({ action: "delete", id: currentId });
      setCurrentId(null);
      setFlash("Deleted."); setTimeout(() => setFlash(null), 1500);
      await loadList();
    } catch (e: any) { setErr(e?.message || "Delete failed."); }
  }, [api, currentId, name, loadList]);

  // --- CSV export --------------------------------------------------------------------
  const exportCsv = useCallback(() => {
    if (!computed) return;
    const esc = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "Address", "Verdict", "Price", "Monthly Rent", "Annual Taxes", "Taxes Estimated?", "Max Loan", "Binding Constraint",
      "LTV @ Max %", "DSCR @ Max", "Cap Rate %", "NOI Annual", "PITIA Monthly",
      "Monthly Cashflow", "Cash Needed", "Cash-on-Cash %", "Back Tax Status", "Back Tax Amount", "Flags", "Tax / Title Notes",
    ];
    const lines = computed.results.map((x) => {
      const r = rowById.get(x.id);
      return [
        x.address, x.verdict, r?.price ?? "", r?.rent_monthly ?? "", r?.taxes_annual ?? "", x.taxes_estimated ? "estimated" : "verified/input", x.max_loan, x.binding_constraint,
        x.ltv_at_max_loan_pct ?? "", x.dscr_at_max_loan ?? "", x.cap_rate_pct ?? "", x.noi_annual, x.pitia_at_max_loan_m,
        x.monthly_cashflow, x.cash_needed, x.cash_on_cash_pct ?? "", r?.back_tax_status ?? "", r?.back_tax_amount ?? "",
        x.flags.join(" | "), r?.notes ?? "",
      ].map(esc).join(",");
    });
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(name || "portfolio").replace(/[^\w.-]+/g, "_")}_underwrite.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [computed, rowById, name]);

  // --- derived --------------------------------------------------------------------
  const summary = computed?.summary || null;
  const taxAttention = summary ? summary.tax_unverified + summary.tax_owed : 0;
  // --- single-property manual entry (no spreadsheet needed) ---------------------------
  const [showManual, setShowManual] = useState(false);
  const addManualRow = useCallback((r: Omit<PropertyRow, "id" | "back_tax_status">) => {
    const row: PropertyRow = { ...r, id: crypto.randomUUID(), back_tax_status: "unknown" };
    setRows((prev) => [...prev, row]);
    setName((n) => n || r.address || "Single property");
    setShowManual(false);
    setTab("results");
    setExpandedId(row.id); // open straight into the deal qualifier
  }, []);

  const worklist = useMemo(() => (rows.length ? taxWorklist(rows) : []), [rows]);
  const worklistActive = worklist.filter((w) => w.status !== "clear");
  const worklistClear = worklist.length - worklistActive.length;

  // --- Tax & title risk rollup for the dashboard + Excel export -----------------------
  const risk = useMemo(() => {
    const urgent: PropertyRow[] = [], delinquent: PropertyRow[] = [], shared: PropertyRow[] = [];
    const flags: PropertyRow[] = [], clean: PropertyRow[] = [], pending: PropertyRow[] = [];
    let pastDue = 0;
    for (const r of rows) {
      const n = r.notes || "";
      const isUrgent = /TAX.?SALE/i.test(n);
      if (/title flag|confirm[^.]*?(title|ownership|entity|pairing)/i.test(n)) flags.push(r);
      if (r.back_tax_status === "owed") {
        pastDue += Number(r.back_tax_amount) || 0;
        if (isUrgent) urgent.push(r);
        else if ((Number(r.back_tax_amount) || 0) > 0) delinquent.push(r);
        else shared.push(r);
      } else if (r.back_tax_status === "clear") clean.push(r);
      else pending.push(r);
    }
    delinquent.sort((a, b) => (Number(b.back_tax_amount) || 0) - (Number(a.back_tax_amount) || 0));
    return { urgent, delinquent, shared, flags, clean, pending, pastDue };
  }, [rows]);

  // --- Excel export: Dashboard + All Doors + Tax & Title Risk sheets ------------------
  const exportXlsx = useCallback(() => {
    if (!computed) return;
    const s = computed.summary;
    const wb = XLSX.utils.book_new();
    const dash: (string | number)[][] = [
      ["Portfolio", name || "Portfolio"],
      ["Exported", new Date().toLocaleString()],
      [],
      ["OVERVIEW", ""],
      ["Doors", rows.length],
      ["Total value", s.total_price],
      ["Total max loan", s.total_max_loan],
      ["Blended DSCR", s.blended_dscr ?? ""],
      ["Blended LTV %", s.blended_ltv_pct ?? ""],
      ["Monthly cashflow", s.total_monthly_cashflow],
      ["Cash needed (incl. past-due taxes)", s.total_cash_needed],
      [],
      ["TAX & TITLE RISK", ""],
      ["Past-due taxes total", risk.pastDue],
      ["Tax-sale alerts", risk.urgent.length],
      ["Delinquent doors", risk.delinquent.length + risk.shared.length],
      ["Title / entity flags", risk.flags.length],
      ["Verified current", risk.clean.length],
      ["Unverified", risk.pending.length],
      [],
      ["TAX-SALE ALERTS — act immediately", ""],
      ...risk.urgent.map((r): (string | number)[] => [r.address, Number(r.back_tax_amount) || 0]),
      [],
      ["DELINQUENT — past-due estimate", ""],
      ...risk.delinquent.map((r): (string | number)[] => [r.address, Number(r.back_tax_amount) || 0]),
      [],
      ["TITLE / ENTITY FLAGS", ""],
      ...risk.flags.map((r): (string | number)[] => [r.address, (r.notes || "").slice(0, 200)]),
    ];
    const wsDash = XLSX.utils.aoa_to_sheet(dash);
    wsDash["!cols"] = [{ wch: 42 }, { wch: 95 }];
    XLSX.utils.book_append_sheet(wb, wsDash, "Dashboard");

    const header = ["Address", "City", "County", "Price", "Monthly Rent", "Annual Taxes", "Tax Status", "Past-Due Taxes", "Verdict", "Max Loan", "DSCR", "LTV %", "Monthly Cashflow", "Cash Needed", "County Notes"];
    const body = computed.results.map((x) => {
      const r = rowById.get(x.id);
      return [
        x.address, r?.city ?? "", r?.county ?? "", r?.price ?? "", r?.rent_monthly ?? "", r?.taxes_annual ?? "",
        r?.back_tax_status ?? "", r?.back_tax_amount ?? "", x.verdict, x.max_loan, x.dscr_at_max_loan ?? "", x.ltv_at_max_loan_pct ?? "",
        x.monthly_cashflow, x.cash_needed, r?.notes ?? "",
      ];
    });
    const wsAll = XLSX.utils.aoa_to_sheet([header, ...body]);
    wsAll["!cols"] = header.map((_, i) => ({ wch: i === 0 ? 26 : i === 14 ? 110 : 14 }));
    XLSX.utils.book_append_sheet(wb, wsAll, "All Doors");

    const rBody = [
      ...risk.urgent.map((r) => ["TAX SALE ALERT", r.address, Number(r.back_tax_amount) || 0, r.notes || ""]),
      ...risk.delinquent.map((r) => ["Delinquent", r.address, Number(r.back_tax_amount) || 0, r.notes || ""]),
      ...risk.shared.map((r) => ["Delinquent (shared parcel)", r.address, 0, r.notes || ""]),
      ...risk.flags.map((r) => ["Title / entity flag", r.address, "", r.notes || ""]),
    ];
    const wsRisk = XLSX.utils.aoa_to_sheet([["Category", "Address", "Past-Due $", "County Notes"], ...rBody]);
    wsRisk["!cols"] = [{ wch: 24 }, { wch: 26 }, { wch: 12 }, { wch: 110 }];
    XLSX.utils.book_append_sheet(wb, wsRisk, "Tax & Title Risk");

    XLSX.writeFile(wb, `${(name || "portfolio").replace(/[^\w.-]+/g, "_")}_underwrite.xlsx`);
  }, [computed, rows, risk, name, rowById]);

  // ===========================================================================
  // RENDER
  // ===========================================================================
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-[1400px] mx-auto p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <button
              type="button"
              onClick={() => { if (typeof window !== "undefined" && window.history.length > 1) router.back(); else router.push("/"); }}
              className="text-sm text-slate-400 hover:text-emerald-300 flex items-center gap-1.5 mb-2"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Building2 className="w-6 h-6 text-emerald-400" /> Portfolio Underwriter
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Drop a property list — AI maps the columns, every deal gets sized (LTV cap vs DSCR floor), taxes get a worklist.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {flash && <div className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-1.5">{flash}</div>}
            <SaveBar
              name={name} onName={setName} saving={saving} onSave={savePortfolio}
              saved={saved} onOpen={openPortfolio} currentId={currentId} onDelete={deletePortfolio}
              onExport={exportCsv} onExportXlsx={exportXlsx} canExport={!!computed}
            />
          </div>
        </div>

        {err && (
          <div className="mt-3 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 flex items-center justify-between">
            <span>{err}</span>
            <button onClick={() => setErr(null)} className="text-red-400 hover:text-red-200"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Upload */}
        <div className="mt-5">
          <UploadZone parsing={parsing} onFile={onFile} />
          <div className="mt-2 text-center">
            <button
              type="button" onClick={() => setShowManual((v) => !v)}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold"
            >
              {showManual ? "− Hide single-property form" : "+ Or run a single property — enter it manually, no spreadsheet needed"}
            </button>
          </div>
          {showManual && <ManualPropertyForm onAdd={addManualRow} hasRows={rows.length > 0} />}
        </div>

        {/* Column mapping */}
        {Object.keys(mapping).length > 0 && (
          <div className="mt-3 bg-slate-900/40 border border-slate-800 rounded-xl">
            <button
              type="button" onClick={() => setShowMapping((v) => !v)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:text-white"
            >
              {showMapping ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
              How I read your sheet <span className="text-slate-500 text-xs">({Object.keys(mapping).length} columns mapped)</span>
            </button>
            {showMapping && (
              <div className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
                {Object.entries(mapping).map(([header, f]) => (
                  <div key={header} className="text-xs flex items-center gap-2 min-w-0">
                    <span className="text-slate-400 truncate">{header}</span>
                    <span className="text-slate-600 shrink-0">→</span>
                    <span className="text-emerald-300 font-mono shrink-0">{f}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Summary cards */}
        {summary && (
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
            <SummaryCard label="Properties" value={String(summary.count)} sub={`${summary.underwritable} underwritable`} />
            <SummaryCard label="Total value" value={fm(summary.total_price)} />
            <SummaryCard label="Total max loan" value={fm(summary.total_max_loan)} sub={summary.blended_ltv_pct != null ? `${fp(summary.blended_ltv_pct)} blended LTV` : undefined} tone="emerald" />
            <SummaryCard label="Blended DSCR" value={summary.blended_dscr != null ? `${fx(summary.blended_dscr)}x` : "—"} />
            <SummaryCard label="Cash needed" value={fm(summary.total_cash_needed)} />
            <SummaryCard label="Monthly cashflow" value={fm(summary.total_monthly_cashflow)} tone={summary.total_monthly_cashflow < 0 ? "red" : undefined} />
            {taxAttention > 0 ? (
              <button type="button" onClick={() => setTab("tax")} className="text-left">
                <SummaryCard label="Tax verification" value={`${taxAttention} propert${taxAttention === 1 ? "y" : "ies"}`} sub={`${summary.tax_unverified} unverified · ${summary.tax_owed} owed — open worklist`} tone="red" />
              </button>
            ) : (
              <SummaryCard label="Tax verification" value="All clear" tone="emerald" />
            )}
          </div>
        )}

        {/* Assumptions bar */}
        {rows.length > 0 && (
          <div className="mt-4 bg-slate-900/40 border border-slate-800 rounded-xl px-3 py-2.5">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide pb-2">Assumptions<br /><span className="text-slate-600 normal-case font-normal">recomputes live</span></div>
              {EDITABLE.map((f) => (
                <AssumptionInput key={f.key} k={f.key} label={f.label} suffix={f.suffix} step={f.step} value={aStr[f.key] ?? ""} onChange={setAssumption} />
              ))}
              <div className="text-[11px] text-slate-600 pb-2">
                {assumptions.amort_years}-yr amort · maint {assumptions.maintenance_pct}% · tax fallback {assumptions.tax_fallback_pct}% · ins fallback {assumptions.ins_fallback_pct}%
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        {rows.length > 0 && (
          <div className="mt-5 flex items-center gap-1 border-b border-slate-800">
            {([
              ["dashboard", "Deal dashboard"],
              ["results", `Results (${rows.length})`],
              ["tax", `Tax worklist${worklistActive.length ? ` (${worklistActive.length})` : ""}`],
            ] as const).map(([key, label]) => (
              <button
                key={key} type="button" onClick={() => setTab(key)}
                className={`px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 -mb-px transition ${
                  tab === key ? "border-emerald-500 text-emerald-300" : "border-transparent text-slate-500 hover:text-slate-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Deal dashboard — the plain-English tax & title picture */}
        {computed && tab === "dashboard" && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <SummaryCard label="Past-due taxes" value={fm(risk.pastDue)} sub="verified at the county" tone={risk.pastDue > 0 ? "red" : "emerald"} />
              <SummaryCard label="Tax-sale alerts" value={String(risk.urgent.length)} sub="act immediately" tone={risk.urgent.length ? "red" : "emerald"} />
              <SummaryCard label="Delinquent doors" value={String(risk.delinquent.length + risk.shared.length)} tone={risk.delinquent.length ? "red" : "emerald"} />
              <SummaryCard label="Title / entity flags" value={String(risk.flags.length)} sub="owner of record differs" />
              <SummaryCard label="Verified current" value={String(risk.clean.length)} tone="emerald" />
              <SummaryCard label="Unverified" value={String(risk.pending.length)} />
            </div>

            {risk.urgent.length > 0 && (
              <div className="bg-red-500/[0.07] border border-red-500/40 rounded-xl p-4">
                <div className="flex items-center gap-2 text-red-300 font-bold text-sm mb-2">
                  <ShieldAlert className="w-4 h-4" /> TAX-SALE ALERTS — these can cost the property. Handle before anything else.
                </div>
                {risk.urgent.map((r) => (
                  <div key={r.id} className="py-2 border-t border-red-500/20 first:border-0">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-white font-semibold text-sm">{r.address}</span>
                      <span className="text-red-300 font-bold text-sm">{fm(Number(r.back_tax_amount) || 0)}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1 leading-relaxed">{r.notes}</div>
                  </div>
                ))}
              </div>
            )}

            {risk.delinquent.length > 0 && (
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
                <div className="text-sm font-bold text-amber-300 mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Delinquent taxes (largest first) — added to cash-needed
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                  {risk.delinquent.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 py-1 border-b border-slate-800/60 text-sm">
                      <span className="text-slate-200 truncate">{r.address}</span>
                      <span className="text-amber-300 font-semibold shrink-0">{fm(Number(r.back_tax_amount) || 0)}</span>
                    </div>
                  ))}
                  {risk.shared.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 py-1 border-b border-slate-800/60 text-sm">
                      <span className="text-slate-400 truncate">{r.address}</span>
                      <span className="text-slate-500 text-xs shrink-0">on shared parcel</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {risk.flags.length > 0 && (
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
                <div className="text-sm font-bold text-sky-300 mb-2">Title / entity flags — county owner of record differs from the package</div>
                {risk.flags.map((r) => (
                  <div key={r.id} className="py-2 border-t border-slate-800/60 first:border-0">
                    <div className="text-white font-semibold text-sm">{r.address}</div>
                    <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">{r.notes}</div>
                  </div>
                ))}
              </div>
            )}

            {risk.clean.length > 0 && (
              <div className="bg-emerald-500/[0.05] border border-emerald-500/25 rounded-xl p-4">
                <div className="text-sm font-bold text-emerald-300 mb-2 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" /> Verified current at the county ({risk.clean.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {risk.clean.map((r) => (
                    <span key={r.id} className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-200 text-xs">{r.address}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Results table */}
        {computed && tab === "results" && (
          <div className="mt-4 bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1050px]">
                <thead>
                  <tr className="text-left text-[11px] text-slate-500 uppercase tracking-wide border-b border-slate-800">
                    <th className="px-3 py-2.5 font-semibold">Address</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Price</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Rent</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Taxes /yr</th>
                    <th className="px-3 py-2.5 font-semibold">Verdict</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Max loan</th>
                    <th className="px-3 py-2.5 font-semibold">Constraint</th>
                    <th className="px-3 py-2.5 font-semibold text-right">DSCR</th>
                    <th className="px-3 py-2.5 font-semibold text-right">LTV</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Cap</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Cashflow</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Cash needed</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.results.map((x) => {
                    const r = rowById.get(x.id);
                    const open = expandedId === x.id;
                    return (
                      <RowPair
                        key={x.id} x={x} r={r} open={open} assumptions={assumptions}
                        onToggle={() => setExpandedId(open ? null : x.id)}
                        onStatus={setTaxStatus} onAmount={setTaxAmount}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tax worklist */}
        {computed && tab === "tax" && (
          <div className="mt-4 space-y-3">
            <div className="bg-amber-500/[0.07] border border-amber-500/30 rounded-xl px-3 py-2.5 text-xs text-amber-200/90 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
              <span>
                <b>County-first:</b> the county treasurer record is the authority — search it <b>by the property address</b>,
                then cross-check the owner of record against the expected entity (a mismatch is a title flag). It shows live
                amounts due, delinquencies, and tax-sale flags that assessment-roll tools like TitlePro miss. The numbers you
                enter flow straight into cash-needed.
              </span>
            </div>
            {worklistActive.length === 0 && (
              <div className="text-slate-500 text-sm py-6 text-center">Every property is verified tax-clear. Nothing to work.</div>
            )}
            {worklistActive.map((item) => (
              <TaxWorklistRow
                key={item.id} item={item} copiedId={copiedId} onCopy={onCopy}
                onStatus={setTaxStatus} onAmount={setTaxAmount}
              />
            ))}
            {worklistClear > 0 && (
              <div className="text-xs text-slate-600 text-center">{worklistClear} propert{worklistClear === 1 ? "y" : "ies"} already verified clear.</div>
            )}
          </div>
        )}

        {!rows.length && !parsing && (
          <div className="mt-8 text-center text-slate-600 text-sm">
            No portfolio loaded. Upload a sheet above or open a saved portfolio.
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Table row + expandable detail panel (module scope — contains inputs via BackTaxEditor)
// ============================================================================
function RowPair({
  x, r, open, assumptions, onToggle, onStatus, onAmount,
}: {
  x: UnderwriteResult; r: PropertyRow | undefined; open: boolean; assumptions: Assumptions;
  onToggle: () => void;
  onStatus: (id: string, s: BackTaxStatus) => void;
  onAmount: (id: string, v: string) => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`border-b border-slate-800/60 cursor-pointer transition ${open ? "bg-emerald-500/[0.04]" : "hover:bg-slate-800/30"}`}
      >
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5 min-w-0">
            {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />}
            <span className="text-white truncate max-w-[260px]" title={x.address}>{x.address || "—"}</span>
          </div>
        </td>
        <td className="px-3 py-2.5 text-right text-slate-300">{fm(r?.price)}</td>
        <td className="px-3 py-2.5 text-right text-slate-300">{fm(r?.rent_monthly)}</td>
        <td className={`px-3 py-2.5 text-right ${x.taxes_estimated ? "text-amber-300" : "text-slate-200"}`} title={x.taxes_estimated ? "Estimated from price — no verified tax on file" : "Verified / input annual tax"}>
          {fm(r?.taxes_annual ?? x.taxes_m * 12)}{x.taxes_estimated ? " ~" : ""}
        </td>
        <td className="px-3 py-2.5"><VerdictBadge v={x.verdict} /></td>
        <td className="px-3 py-2.5 text-right font-semibold text-emerald-300">{fm(x.max_loan)}</td>
        <td className="px-3 py-2.5"><ConstraintChip c={x.binding_constraint} /></td>
        <td className="px-3 py-2.5 text-right text-slate-300">{x.dscr_at_max_loan != null ? fx(x.dscr_at_max_loan) : "—"}</td>
        <td className="px-3 py-2.5 text-right text-slate-300">{fp(x.ltv_at_max_loan_pct)}</td>
        <td className="px-3 py-2.5 text-right text-slate-300">{fp(x.cap_rate_pct)}</td>
        <td className={`px-3 py-2.5 text-right font-medium ${x.monthly_cashflow < 0 ? "text-red-400" : "text-slate-200"}`}>{fm(x.monthly_cashflow)}</td>
        <td className="px-3 py-2.5 text-right text-slate-300">{fm(x.cash_needed)}</td>
        <td className="px-3 py-2.5 text-right">
          {x.flags.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-amber-300 text-xs"><AlertTriangle className="w-3 h-3" />{x.flags.length}</span>
          ) : (
            <span className="text-slate-600 text-xs">0</span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-slate-800/60 bg-slate-900/60">
          <td colSpan={13} className="px-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Income + expenses */}
              <div>
                <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide mb-2">Income & expenses (monthly)</div>
                <DetailLine label="Gross income" value={fm(x.gross_income_m)} />
                <DetailLine label="Effective (after vacancy)" value={fm(x.effective_income_m)} />
                <DetailLine label={`Taxes${x.taxes_estimated ? " (est.)" : ""}`} value={fm(x.taxes_m)} warn={x.taxes_estimated} />
                <DetailLine label={`Insurance${x.insurance_estimated ? " (est.)" : ""}`} value={fm(x.insurance_m)} warn={x.insurance_estimated} />
                <DetailLine label="HOA" value={fm(x.hoa_m)} />
                <DetailLine label="NOI (annual)" value={fm(x.noi_annual)} strong />
                <DetailLine label="Cap rate" value={fp(x.cap_rate_pct)} />
              </div>
              {/* Sizing */}
              <div>
                <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide mb-2">Loan sizing</div>
                <DetailLine label="Loan by LTV (cap)" value={fm(x.loan_by_ltv)} />
                <DetailLine label="Loan by DSCR (floor)" value={fm(x.loan_by_dscr)} />
                <DetailLine label="Max loan" value={fm(x.max_loan)} strong />
                <DetailLine label="Binding constraint" value={x.binding_constraint === "none" ? "—" : x.binding_constraint.toUpperCase()} />
                <DetailLine label="PITIA @ max loan" value={fm(x.pitia_at_max_loan_m)} />
                <DetailLine label="DSCR @ max loan" value={x.dscr_at_max_loan != null ? fx(x.dscr_at_max_loan) : "—"} />
                <DetailLine label="LTV @ max loan" value={fp(x.ltv_at_max_loan_pct)} />
                <DetailLine label="Monthly cashflow" value={fm(x.monthly_cashflow)} strong warn={x.monthly_cashflow < 0} />
                <DetailLine label="Cash needed" value={fm(x.cash_needed)} />
                <DetailLine label="Cash-on-cash" value={fp(x.cash_on_cash_pct)} />
              </div>
              {/* Flags + back taxes */}
              <div>
                <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide mb-2">Flags & back taxes</div>
                {x.flags.length === 0 && <div className="text-xs text-slate-600 mb-2">No flags on this property.</div>}
                <div className="space-y-1 mb-3">
                  {x.flags.map((f, i) => (
                    <div key={i} className="text-xs text-amber-300/90 flex items-start gap-1.5">
                      <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5 text-amber-400" /> {f}
                    </div>
                  ))}
                </div>
                {r && (
                  <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="text-[11px] text-slate-500 font-semibold mb-1.5">Back-tax verification</div>
                    <BackTaxEditor id={r.id} status={r.back_tax_status} amount={r.back_tax_amount} onStatus={onStatus} onAmount={onAmount} />
                    <div className="text-[10px] text-slate-600 mt-1.5">Owed amounts add straight to cash-needed and recompute live.</div>
                  </div>
                )}
                {r?.notes && (
                  <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-2.5 mt-2">
                    <div className="text-[11px] text-slate-500 font-semibold mb-1">Tax / title notes</div>
                    <div className="text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap">{r.notes}</div>
                  </div>
                )}
              </div>
            </div>
            {r && <DealQualifierPanel r={r} a={assumptions} />}
          </td>
        </tr>
      )}
    </>
  );
}

// ============================================================================
// DEAL QUALIFIER — what this deal needs to work, plus on-demand market intel.
// ============================================================================
const V_STYLE: Record<string, string> = {
  works: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  works_if: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  thin: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  no: "bg-red-500/15 text-red-300 border-red-500/40",
};

function DealQualifierPanel({ r, a }: { r: PropertyRow; a: Assumptions }) {
  const q = useMemo(() => qualifyDeal(r, a), [r, a]);
  const [intel, setIntel] = useState<any | null>(null);
  const [intelBusy, setIntelBusy] = useState(false);
  const [intelErr, setIntelErr] = useState<string | null>(null);

  const fetchIntel = useCallback(async () => {
    setIntelBusy(true); setIntelErr(null);
    try {
      const resp = await fetch("/api/underwrite", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "market",
          address: r.address, city: r.city, state: r.state, zip: r.zip,
          price: r.price, rent_monthly: r.rent_monthly, rehab_budget: r.rehab_budget, arv: r.arv,
          required_rent: q.rental.requiredRent, arv_needed: q.flip.arvNeededProfit,
        }),
      });
      const j = await resp.json();
      if (!resp.ok || j?.ok === false) throw new Error(j?.error || "Market lookup failed");
      setIntel(j);
    } catch (e) { setIntelErr(e instanceof Error ? e.message : "Market lookup failed"); }
    finally { setIntelBusy(false); }
  }, [r, q]);

  const addrQ = encodeURIComponent([r.address, r.city, r.state, r.zip].filter(Boolean).join(", "));
  const compsLinks = [
    { name: "Zillow sold comps", url: `https://www.zillow.com/homes/recently_sold/${addrQ}_rb/` },
    { name: "Redfin", url: `https://www.redfin.com/search?q=${addrQ}` },
    { name: "Realtor.com", url: `https://www.realtor.com/realestateandhomes-search?searchQuery=${addrQ}` },
  ];

  return (
    <div className="mt-4 bg-slate-950/70 border border-emerald-500/20 rounded-xl p-4">
      <div className="text-sm font-bold text-white mb-1">🎯 Deal qualifier — what this deal needs</div>
      <div className="text-[13px] text-emerald-200 font-semibold mb-3">{q.headline}</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={`border rounded-lg p-3 ${V_STYLE[q.rental.verdict]}`}>
          <div className="text-[11px] font-bold uppercase tracking-wide mb-1">🏠 Rental (DSCR hold)</div>
          <div className="text-xs leading-relaxed text-slate-200">{q.rental.line}</div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">loan {fm(q.rental.loanAtMaxLtv)}</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">PITIA {fm(q.rental.pitiaAtMaxLtv)}/mo</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">needs {fm(q.rental.requiredRent)}/mo</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">break-even {fm(q.rental.breakevenRent)}/mo</span>
          </div>
        </div>
        <div className={`border rounded-lg p-3 ${q.flip.verdict ? V_STYLE[q.flip.verdict] : "bg-slate-900/60 border-slate-700"}`}>
          <div className="text-[11px] font-bold uppercase tracking-wide mb-1">🔨 Fix &amp; flip</div>
          <div className="text-xs leading-relaxed text-slate-200">{q.flip.line}</div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">all-in {fm(q.flip.allIn)}</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">ARV needed {fm(q.flip.arvNeededProfit)}</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">70% rule {fm(q.flip.arvNeeded70Rule)}</span>
          </div>
        </div>
        <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide mb-1 text-sky-300">🔁 BRRRR</div>
          <div className="text-xs leading-relaxed text-slate-200">{q.brrrr.line}</div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <button
          type="button" onClick={fetchIntel} disabled={intelBusy}
          className="bg-sky-600/80 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5"
        >
          {intelBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          {intel ? "Refresh market intel" : "Get market intel (census + AI area analysis)"}
        </button>
        {compsLinks.map((l) => (
          <a key={l.name} href={l.url} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1">
            <ExternalLink className="w-3 h-3" /> {l.name}
          </a>
        ))}
      </div>
      {intelErr && <div className="mt-2 text-xs text-red-400">{intelErr}</div>}

      {intel && (
        <div className="mt-3 space-y-3">
          {intel.census && (
            <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-3">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">
                Census hard data — ZIP {intel.census.zip}{intel.census.vintage ? ` (ACS ${intel.census.vintage}${intel.census.trend_from ? `, trend vs ${intel.census.trend_from}` : ""})` : ""}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <CensusStat label="Median home value" now={intel.census.median_home_value} pct={intel.census.home_value_change_pct} money />
                <CensusStat label="Median gross rent" now={intel.census.median_rent} pct={intel.census.rent_change_pct} money />
                <CensusStat label="Median HH income" now={intel.census.median_income} pct={intel.census.income_change_pct} money />
                <CensusStat label="Renter share" now={intel.census.renter_share_pct} pct={null} suffix="%" />
              </div>
            </div>
          )}
          {intel.ai && (
            <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-3 space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                AI area analysis <span className="normal-case font-normal text-slate-600">— knowledge-based assessment; verify locally before committing capital</span>
              </div>
              {intel.ai.trajectory && (
                <div className="text-xs text-slate-200"><b className="text-white">Trajectory:</b> {intel.ai.trajectory}</div>
              )}
              {Array.isArray(intel.ai.gentrification_signals) && intel.ai.gentrification_signals.length > 0 && (
                <div className="text-xs text-slate-200"><b className="text-white">Gentrification signals:</b> {intel.ai.gentrification_signals.join(" · ")}</div>
              )}
              {intel.ai.rent_context && <div className="text-xs text-slate-200"><b className="text-white">Rent reality-check:</b> {intel.ai.rent_context}</div>}
              {intel.ai.price_context && <div className="text-xs text-slate-200"><b className="text-white">Price/ARV reality-check:</b> {intel.ai.price_context}</div>}
              {Array.isArray(intel.ai.risks) && intel.ai.risks.length > 0 && (
                <div className="text-xs text-amber-200"><b className="text-amber-300">Risks:</b> {intel.ai.risks.join(" · ")}</div>
              )}
              {intel.ai.strategy && (
                <div className="text-xs text-emerald-200 bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-2.5 py-2">
                  <b className="text-emerald-300">Recommended play:</b> {intel.ai.strategy}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CensusStat({ label, now, pct, money, suffix }: { label: string; now: number | null; pct: number | null; money?: boolean; suffix?: string }) {
  return (
    <div>
      <div className="text-slate-500 text-[10px]">{label}</div>
      <div className="text-white font-semibold">
        {now == null ? "—" : money ? fm(now) : `${now}${suffix || ""}`}
        {pct != null && (
          <span className={`ml-1.5 text-[10px] font-bold ${pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {pct >= 0 ? "▲" : "▼"}{Math.abs(pct)}%/5yr
          </span>
        )}
      </div>
    </div>
  );
}

function DetailLine({ label, value, strong, warn }: { label: string; value: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className={`${warn ? "text-amber-300" : strong ? "text-white font-semibold" : "text-slate-300"}`}>{value}</span>
    </div>
  );
}

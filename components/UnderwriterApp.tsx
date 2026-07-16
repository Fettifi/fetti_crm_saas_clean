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
} from "lucide-react";
import {
  underwritePortfolio, DEFAULT_ASSUMPTIONS,
  type PropertyRow, type Assumptions, type UnderwriteResult, type PortfolioSummary, type BackTaxStatus,
} from "@/lib/underwrite/engine";
import { taxWorklist, type TaxLookup } from "@/lib/underwrite/taxLinks";

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
        </div>
        <div className="flex items-center gap-3 mt-1 text-[12px]">
          <button
            type="button" onClick={() => onCopy(item.id, item.pasteAddress)}
            className="text-slate-400 hover:text-emerald-300 flex items-center gap-1"
          >
            {copiedId === item.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {copiedId === item.id ? "Copied" : "Copy address"}
          </button>
          <a href={item.netrUrl} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300 flex items-center gap-1">
            <ExternalLink className="w-3 h-3" /> County records
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

// Save bar: portfolio name + saved-list dropdown. Inputs, so module scope.
function SaveBar({
  name, onName, saving, onSave, saved, onOpen, currentId, onDelete, onExport, canExport,
}: {
  name: string; onName: (v: string) => void; saving: boolean; onSave: () => void;
  saved: SavedMeta[]; onOpen: (id: string) => void; currentId: string | null;
  onDelete: () => void; onExport: () => void; canExport: boolean;
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
        type="button" onClick={onExport} disabled={!canExport}
        className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 border border-slate-700"
      >
        <Download className="w-3.5 h-3.5" /> Export CSV
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
  const [tab, setTab] = useState<"results" | "tax">("results");
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
  const worklist = useMemo(() => (rows.length ? taxWorklist(rows) : []), [rows]);
  const worklistActive = worklist.filter((w) => w.status !== "clear");
  const worklistClear = worklist.length - worklistActive.length;

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
              onExport={exportCsv} canExport={!!computed}
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
                        key={x.id} x={x} r={r} open={open}
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
                <b>TitlePro247:</b> paste the address in your TitlePro tab — no public API exists, so verification stays a
                human step; the numbers you enter flow straight into cash-needed.
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
  x, r, open, onToggle, onStatus, onAmount,
}: {
  x: UnderwriteResult; r: PropertyRow | undefined; open: boolean; onToggle: () => void;
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
          <td colSpan={12} className="px-4 py-4">
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
          </td>
        </tr>
      )}
    </>
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

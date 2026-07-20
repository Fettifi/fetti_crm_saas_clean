"use client";

// UNDERWRITING DESK — one screen to underwrite a single deal before pulling a prelim.
// Enter the deal (address, borrower, loan type, lien position, amount, property params),
// drop in the TitlePro profile + county assessor printout, and get a full underwrite:
// auto-pulled market data + AI-read title/tax + LTV/CLTV/DSCR/max-loan + fundability +
// best wholesale lender + conditions — then create the LOS file and order title/escrow.
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Upload, X, FileText, MapPin } from "lucide-react";
import CurrencyInput from "@/components/ui/CurrencyInput";
import { computeDeskMetrics, DESK_LOAN_TYPES, LOAN_BOX, type DeskInput, type DeskLoanType } from "@/lib/underwritingDesk";

const money = (n: any) => "$" + Math.round(Number(n) || 0).toLocaleString();
const num = (s: any) => Number(String(s ?? "").replace(/[^0-9.\-]/g, "")) || 0;

type DocFile = { name: string; mediaType: string; base64: string };

async function fileToDoc(f: File): Promise<DocFile | null> {
  if (f.size > 12 * 1024 * 1024) return null; // 12MB cap
  const buf = new Uint8Array(await f.arrayBuffer());
  let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  const ext = (f.name.toLowerCase().split(".").pop() || "");
  const mediaType = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : (ext === "jpg" || ext === "jpeg") ? "image/jpeg" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : f.type;
  if (!/pdf|png|jpe?g|webp|gif/.test(mediaType)) return null;
  return { name: f.name.slice(0, 80), mediaType, base64: btoa(bin) };
}

export default function UnderwritingDesk() {
  const router = useRouter();
  const [f, setF] = useState<any>({ loanType: "dscr", lienPosition: 1, occupancy: "investment", termYears: 30, propertyType: "SFR" });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const [docs, setDocs] = useState<DocFile[]>([]);
  const [dropBusy, setDropBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);

  const box = LOAN_BOX[f.loanType as DeskLoanType] || LOAN_BOX.dscr;
  // A "2nd Position / HELOC" loan type IS a junior lien — treat it as 2nd position even if
  // the lien-position selector wasn't flipped, so the senior-lien field + CLTV appear.
  const lien2 = f.loanType === "second" || Number(f.lienPosition) === 2;

  // Build a DeskInput from the form for the live client-side preview.
  const input: DeskInput = useMemo(() => ({
    address: f.address, city: f.city, state: (f.state || "").toUpperCase(), zip: f.zip, borrower: f.borrower,
    loanType: f.loanType, lienPosition: (f.loanType === "second" || Number(f.lienPosition) === 2) ? 2 : 1,
    loanAmount: num(f.loanAmount), asIsValue: num(f.asIsValue), arv: num(f.arv) || undefined,
    existingLiens: num(f.existingLiens) || undefined, rehabBudget: num(f.rehabBudget) || undefined,
    monthlyRent: num(f.monthlyRent) || undefined, propertyType: f.propertyType, occupancy: f.occupancy,
    fico: num(f.fico) || undefined, ratePct: num(f.ratePct) || undefined, termYears: num(f.termYears) || 30,
    hoaMonthly: num(f.hoaMonthly) || undefined, targetDscr: num(f.targetDscr) || undefined,
  }), [f]);
  const preview = useMemo(() => { try { return computeDeskMetrics(input); } catch { return null; } }, [input]);

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setDropBusy(true);
    const added: DocFile[] = [];
    for (const file of Array.from(list).slice(0, 6)) { const d = await fileToDoc(file); if (d) added.push(d); }
    setDocs((prev) => [...prev, ...added].slice(0, 6));
    setDropBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function runUnderwrite() {
    if (!input.loanAmount || !input.asIsValue) { setErr("Enter at least a loan amount and an as-is value / purchase price."); return; }
    setRunning(true); setErr(""); setResult(null);
    try {
      const r = await fetch("/api/underwriter-desk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "underwrite", input, docs }) });
      const j = await r.json();
      if (!r.ok) { setErr(j?.error || "Underwrite failed."); } else { setResult(j); setTimeout(() => document.getElementById("uw-result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); }
    } catch (e: any) { setErr(e?.message || "Underwrite failed."); } finally { setRunning(false); }
  }

  async function downloadPdf() {
    if (!result) return;
    setPdfBusy(true);
    try {
      const r = await fetch("/api/underwriter-desk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pdf", result }) });
      if (!r.ok) { setErr("PDF failed."); return; }
      const blob = await r.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "Underwriting-Summary.pdf"; a.click(); URL.revokeObjectURL(url);
    } catch { setErr("PDF failed."); } finally { setPdfBusy(false); }
  }

  async function createFile() {
    setFileBusy(true); setErr("");
    try {
      const r = await fetch("/api/underwriter-desk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create-file", input, result, docs }) });
      const j = await r.json();
      if (!r.ok || !j.fileId) { setErr(j?.error || "Couldn't create the loan file."); return; }
      router.push(`/los/${j.fileId}`);
    } catch (e: any) { setErr(e?.message || "Couldn't create the loan file."); } finally { setFileBusy(false); }
  }

  const inp = "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none";
  const lbl = "text-[11px] text-slate-400 mb-1 block";
  const uw = result?.underwrite || {};
  const m = result?.metrics || preview;
  const tr = result?.titleRead;

  const Metric = ({ label, value, tone }: { label: string; value: any; tone?: "ok" | "warn" | "bad" }) => (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2 text-center">
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      <div className={`text-sm font-bold ${tone === "bad" ? "text-red-400" : tone === "warn" ? "text-amber-400" : "text-emerald-300"}`}>{value}</div>
    </div>
  );

  // Loan-type-aware headline tiles: ARV loans (hard money/bridge/flip) lead with LTARV —
  // the metric the loan actually underwrites to — and label the as-is number "As-is LTV"
  // (informational, no pass/fail tone). Rental products lead with LTV + DSCR.
  type Tile = { label: string; value: string; tone?: "ok" | "warn" | "bad" };
  const coreTiles = (mm: any): Tile[] => {
    const t: Tile[] = [];
    const hasSenior = lien2 || !!num(f.existingLiens);
    if (box.usesARV) {
      t.push({ label: "LTARV", value: mm.ltarv != null ? mm.ltarv + "%" : "—", tone: mm.fits?.ltv ? "ok" : "bad" });
      if (hasSenior) t.push({ label: "CLTARV", value: mm.cltarv != null ? mm.cltarv + "%" : "—", tone: mm.fits?.cltv ? "ok" : "bad" });
      t.push({ label: "As-is LTV", value: mm.ltv != null ? mm.ltv + "%" : "—" });
      t.push({ label: "P&I · IO", value: money(mm.pi) });
    } else if (box.usesRental) {
      t.push({ label: "LTV", value: mm.ltv != null ? mm.ltv + "%" : "—", tone: mm.fits?.ltv ? "ok" : "bad" });
      if (hasSenior) t.push({ label: "CLTV", value: mm.cltv != null ? mm.cltv + "%" : "—", tone: mm.fits?.cltv ? "ok" : "bad" });
      t.push({ label: "DSCR", value: mm.dscr != null ? mm.dscr.toFixed(2) : "—", tone: mm.fits?.dscr ? "ok" : "warn" });
    } else {
      t.push({ label: "LTV", value: mm.ltv != null ? mm.ltv + "%" : "—", tone: mm.fits?.ltv ? "ok" : "bad" });
      if (hasSenior) t.push({ label: "CLTV", value: mm.cltv != null ? mm.cltv + "%" : "—", tone: mm.fits?.cltv ? "ok" : "bad" });
      t.push({ label: "P&I", value: money(mm.pi) });
    }
    t.push({ label: "PITIA", value: money(mm.pitia) + "/mo" });
    t.push({ label: "Max loan", value: money(mm.maxLoan) });
    t.push({ label: "Headroom", value: (mm.headroom >= 0 ? "+" : "") + money(mm.headroom), tone: mm.headroom >= 0 ? "ok" : "bad" });
    return t;
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">🧾 Underwriting Desk</h1>
        <Link href="/underwrite" className="text-xs text-slate-400 hover:text-emerald-300">Portfolio Underwriter →</Link>
      </div>
      <p className="text-sm text-slate-400 mb-5">Underwrite a single deal in one pass — enter it, drop in the TitlePro profile + assessor printout, and get value, LTV/CLTV, DSCR, tax &amp; title read, program fit, and the best wholesale lender. Then create the file and order title/escrow. A preliminary underwrite, done before you pull the prelim.</p>

      {/* ---- INPUT ---- */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2"><label className={lbl}>Property address</label><input value={f.address || ""} onChange={(e) => set("address", e.target.value)} className={inp} placeholder="123 Main St" /></div>
          <div><label className={lbl}>Borrower / entity</label><input value={f.borrower || ""} onChange={(e) => set("borrower", e.target.value)} className={inp} placeholder="Name or LLC" /></div>
          <div><label className={lbl}>City</label><input value={f.city || ""} onChange={(e) => set("city", e.target.value)} className={inp} /></div>
          <div><label className={lbl}>State</label><input value={f.state || ""} onChange={(e) => set("state", e.target.value.toUpperCase().slice(0, 2))} className={inp} placeholder="CA" maxLength={2} /></div>
          <div><label className={lbl}>ZIP</label><input value={f.zip || ""} onChange={(e) => set("zip", e.target.value.replace(/[^0-9]/g, "").slice(0, 5))} className={inp} placeholder="90001" /></div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div><label className={lbl}>Loan type</label><select value={f.loanType} onChange={(e) => { const v = e.target.value; setF((p: any) => ({ ...p, loanType: v, ...(v === "second" ? { lienPosition: 2 } : {}) })); }} className={inp}>{DESK_LOAN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
          <div><label className={lbl}>Lien position</label><select value={lien2 ? 2 : 1} onChange={(e) => set("lienPosition", Number(e.target.value))} disabled={f.loanType === "second"} className={`${inp} ${f.loanType === "second" ? "opacity-70 cursor-not-allowed" : ""}`}><option value={1}>1st position</option><option value={2}>2nd position</option></select></div>
          <div><label className={lbl}>Loan amount</label><CurrencyInput value={f.loanAmount || ""} onChange={(v) => set("loanAmount", v)} className={inp} placeholder="$" /></div>
          <div><label className={lbl}>As-is value / price</label><CurrencyInput value={f.asIsValue || ""} onChange={(v) => set("asIsValue", v)} className={inp} placeholder="$" /></div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          {box.usesARV && <div><label className={lbl}>ARV (after repair)</label><CurrencyInput value={f.arv || ""} onChange={(v) => set("arv", v)} className={inp} placeholder="$" /></div>}
          {box.usesARV && <div><label className={lbl}>Rehab budget</label><CurrencyInput value={f.rehabBudget || ""} onChange={(v) => set("rehabBudget", v)} className={inp} placeholder="$" /></div>}
          {(lien2 || f.existingLiens) && <div><label className={lbl}>Senior lien balance{lien2 ? " (for CLTV)" : ""}</label><CurrencyInput value={f.existingLiens || ""} onChange={(v) => set("existingLiens", v)} className={inp} placeholder="$" /></div>}
          {!lien2 && !f.existingLiens && <div><label className={lbl}>Existing liens (optional)</label><CurrencyInput value={f.existingLiens || ""} onChange={(v) => set("existingLiens", v)} className={inp} placeholder="$0" /></div>}
          {box.usesRental && <div><label className={lbl}>Gross rent / mo</label><CurrencyInput value={f.monthlyRent || ""} onChange={(v) => set("monthlyRent", v)} className={inp} placeholder="$/mo" /></div>}
          {box.usesRental && <div><label className={lbl}>Target DSCR</label><select value={f.targetDscr || box.minDSCR} onChange={(e) => set("targetDscr", e.target.value)} className={inp}><option value={1.25}>1.25</option><option value={1.10}>1.10</option><option value={1.0}>1.00</option><option value={0.75}>0.75 (low-DSCR)</option></select></div>}
          <div><label className={lbl}>Property type</label><select value={f.propertyType} onChange={(e) => set("propertyType", e.target.value)} className={inp}><option>SFR</option><option>2-4 unit</option><option>Condo</option><option>Multifamily 5+</option><option>Commercial</option><option>Land</option></select></div>
          <div><label className={lbl}>Occupancy</label><select value={f.occupancy} onChange={(e) => set("occupancy", e.target.value)} className={inp}><option value="investment">Investment</option><option value="owner">Owner-occupied</option><option value="second_home">Second home</option></select></div>
          <div><label className={lbl}>Rate % {box.usesIncome ? "" : `(def ${box.rate})`}</label><input value={f.ratePct || ""} onChange={(e) => set("ratePct", e.target.value)} className={inp} placeholder={String(box.rate)} /></div>
          <div><label className={lbl}>Term (yrs)</label><select value={f.termYears} onChange={(e) => set("termYears", Number(e.target.value))} className={inp}><option value={30}>30</option><option value={25}>25</option><option value={20}>20</option><option value={15}>15</option><option value={1}>12 mo (bridge)</option></select></div>
          <div><label className={lbl}>FICO (optional)</label><input value={f.fico || ""} onChange={(e) => set("fico", e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} className={inp} placeholder="720" /></div>
          <div><label className={lbl}>HOA / mo</label><CurrencyInput value={f.hoaMonthly || ""} onChange={(v) => set("hoaMonthly", v)} className={inp} placeholder="$0" /></div>
        </div>

        {/* Uploads */}
        <div>
          <label className={lbl}>TitlePro profile · county assessor · appraisal / BPO (read instantly)</label>
          <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
            className="border border-dashed border-slate-700 rounded-lg px-4 py-4 text-center cursor-pointer hover:border-emerald-600/60" onClick={() => fileRef.current?.click()}>
            <input ref={fileRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.gif" className="hidden" onChange={(e) => onFiles(e.target.files)} />
            <div className="text-xs text-slate-400 flex items-center justify-center gap-2">{dropBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}Drop the property profile / title report / assessor printout here, or click to pick.</div>
          </div>
          {docs.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{docs.map((d, i) => <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-300"><FileText className="w-3 h-3" />{d.name}<button onClick={() => setDocs((p) => p.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-300"><X className="w-3 h-3" /></button></span>)}</div>}
        </div>

        {/* Live preview */}
        {preview && (input.loanAmount > 0 && input.asIsValue > 0) && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {coreTiles(preview).map((t, i) => <Metric key={i} label={t.label} value={t.value} tone={t.tone} />)}
          </div>
        )}

        {err && <div className="text-sm text-red-300 bg-red-500/10 rounded-lg px-3 py-2">{err}</div>}
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={runUnderwrite} disabled={running} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-lg flex items-center gap-2">{running ? <Loader2 className="w-4 h-4 animate-spin" /> : "🔍"}{running ? "Underwriting…" : "Run full underwrite"}</button>
          <span className="text-[11px] text-slate-500">Auto-pulls market + tax/insurance + county tax link; reads your uploads; matches your approved wholesalers.</span>
        </div>
      </div>

      {/* ---- RESULT ---- */}
      {result && (
        <div id="uw-result" className="mt-5 space-y-4">
          {/* Verdict */}
          <div className={`rounded-2xl p-5 border ${/pass/i.test(uw.verdict || "") ? "border-red-800/50 bg-red-950/20" : /thin/i.test(uw.verdict || "") ? "border-amber-800/50 bg-amber-950/20" : "border-emerald-800/50 bg-emerald-950/20"}`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <span className={`text-sm font-bold px-3 py-1 rounded-full ${/pass/i.test(uw.verdict || "") ? "bg-red-500/20 text-red-300" : /thin/i.test(uw.verdict || "") ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/20 text-emerald-300"}`}>{uw.verdict || "Underwriting read"}</span>
                {typeof uw.dealScore === "number" && <span className="text-xs text-slate-400">Deal score {uw.dealScore}/100</span>}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={downloadPdf} disabled={pdfBusy} className="text-xs font-semibold bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg">{pdfBusy ? "…" : "⬇ Underwriting PDF"}</button>
                <button onClick={createFile} disabled={fileBusy} className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 rounded-lg text-white">{fileBusy ? "Creating…" : "📂 Create file & order title →"}</button>
              </div>
            </div>
            {uw.summary && <p className="text-sm text-slate-200 mt-3 leading-relaxed">{uw.summary}</p>}
            {uw.error && <p className="text-xs text-amber-300 mt-2">AI synthesis unavailable ({uw.error}) — computed metrics below are still valid.</p>}
            {result.geo?.mapsUrl && <a href={result.geo.mapsUrl} target="_blank" rel="noreferrer" className="text-[11px] text-emerald-400 hover:underline mt-2 inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{result.geo.standardized}</a>}
          </div>

          {/* Metrics */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">Computed metrics</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Metric label="Loan" value={money(input.loanAmount)} />
              <Metric label="Value" value={money(input.asIsValue)} />
              {m.box?.usesARV && input.arv ? <Metric label="ARV" value={money(input.arv)} /> : <Metric label="Rate" value={m.ratePct + "%"} />}
              {coreTiles(m).map((t, i) => <Metric key={i} label={t.label} value={t.value} tone={t.tone} />)}
            </div>
            {m.box && <div className={`mt-3 text-[11px] rounded-lg px-3 py-2 ${m.fits?.overall ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"}`}>Program box ({m.box.label}): {m.box.usesARV ? `≤ ${m.box.maxLTV}% LTARV (loan-to-ARV)` : `≤ ${m.box.maxLTV}% LTV, ≤ ${m.box.maxCLTV}% CLTV`}{m.box.minDSCR ? `, ≥ ${m.box.minDSCR} DSCR` : ""} — {m.fits?.overall ? "fits as structured." : "outside the box — see restructure below."}</div>}
          </div>

          {/* Narrative sections */}
          {[["Value opinion", uw.valueOpinion], ["LTV / CLTV read", uw.ltvRead], [box.usesRental ? "Cash-flow read" : "Income / DTI read", uw.cashflowRead], ["Title, liens & vesting", uw.titleLienRead], ["Property tax status", uw.taxRead], ["Program fit", uw.programFit], ["Max loan read", uw.maxLoanRead], ["Exit (flip / bridge)", uw.exit]].map(([t, v]) => v ? (
            <div key={t as string} className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">{t}</div>
              <p className="text-sm text-slate-200 leading-relaxed">{v as string}</p>
            </div>
          ) : null)}

          {/* Title read facts */}
          {tr && !tr.error && (tr.vesting || (tr.openLiens || []).length || tr.taxStatus?.status) && (
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Read from your documents</div>
              <div className="text-sm text-slate-300 space-y-1">
                {tr.vesting && <div>Vesting: <span className="text-slate-200">{tr.vesting}</span></div>}
                {tr.assessedValue && <div>Assessed value: <span className="text-slate-200">{money(tr.assessedValue)}</span>{tr.assessedYear ? ` (${tr.assessedYear})` : ""}</div>}
                {(tr.openLiens || []).length > 0 && <div className="mt-1"><div className="text-slate-500 text-[11px] uppercase">Open liens</div>{tr.openLiens.map((l: any, i: number) => <div key={i} className="text-[13px]">• {l.lienType}{l.holder ? ` — ${l.holder}` : ""}{l.estimatedBalance ? ` ~${money(l.estimatedBalance)}` : ""}{l.position ? ` (pos ${l.position})` : ""}</div>)}</div>}
                {tr.taxStatus?.status && <div className={tr.taxStatus.status === "delinquent" || tr.taxStatus.status === "tax-sale" ? "text-amber-300" : ""}>Tax: {tr.taxStatus.status}{tr.taxStatus.amountOwed ? ` — owed ${money(tr.taxStatus.amountOwed)}` : ""}{tr.taxStatus.throughYear ? ` (through ${tr.taxStatus.throughYear})` : ""}</div>}
              </div>
            </div>
          )}
          {tr?.error && <div className="text-[11px] text-amber-300">Couldn't read an uploaded document ({tr.error}).</div>}
          {!result.titleRead && <div className="bg-amber-950/20 border border-amber-800/40 rounded-2xl p-4 text-sm text-amber-200">No title/property profile uploaded — pull a TitlePro profile / preliminary title report to confirm vesting + senior liens before funding.{result.taxLink?.countyUrl && <> Verify taxes at <a href={result.taxLink.countyUrl} target="_blank" rel="noreferrer" className="underline">{result.taxLink.countyName || "the county treasurer"}</a>.</>}</div>}

          {/* Conditions / flags / lenders */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(uw.conditions || []).length > 0 && <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4"><div className="text-xs uppercase text-sky-400 mb-1">Conditions to fund</div><ul className="text-sm text-slate-300 space-y-0.5">{uw.conditions.map((c: string, i: number) => <li key={i}>☐ {c}</li>)}</ul></div>}
            {(uw.redFlags || []).length > 0 && <div className="bg-slate-900/40 border border-red-900/40 rounded-2xl p-4"><div className="text-xs uppercase text-red-400 mb-1">Red flags / risks</div><ul className="text-sm text-red-200/90 space-y-0.5">{uw.redFlags.map((c: string, i: number) => <li key={i}>• {c}</li>)}</ul></div>}
          </div>
          {(uw.bestLenders || []).length > 0 && (
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Best-fit wholesale lenders</div>
              <div className="space-y-1.5">{uw.bestLenders.map((l: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-sm"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${/strong/i.test(l.fit) ? "bg-emerald-500/20 text-emerald-300" : /pass/i.test(l.fit) ? "bg-slate-700 text-slate-400" : "bg-amber-500/20 text-amber-300"}`}>{l.fit}</span><span className="font-medium text-slate-200">{l.lenderName}</span><span className="text-xs text-slate-500">— {l.reason}</span></div>
              ))}</div>
              <p className="text-[11px] text-slate-500 mt-2">Create the file to submit the MISMO 3.4 package from the LOS.</p>
            </div>
          )}
          {(uw.nextSteps || []).length > 0 && <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4"><div className="text-xs uppercase text-emerald-400 mb-1">Next steps</div><ul className="text-sm text-slate-300 space-y-0.5">{uw.nextSteps.map((s: string, i: number) => <li key={i}>➡️ {s}</li>)}</ul></div>}

          {/* Market */}
          {result.market && (result.market.medianHomeValue || result.market.medianGrossRent) && (
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Market context — {result.market.zip}{result.location?.countyName ? `, ${result.location.countyName}` : ""} (Census ACS {result.market.vintage})</div>
              <div className="text-sm text-slate-300">Median home value <span className="text-slate-100 font-semibold">{result.market.medianHomeValue ? money(result.market.medianHomeValue) : "—"}</span> · median gross rent <span className="text-slate-100 font-semibold">{result.market.medianGrossRent ? money(result.market.medianGrossRent) + "/mo" : "—"}</span> · median income <span className="text-slate-100 font-semibold">{result.market.medianIncome ? money(result.market.medianIncome) : "—"}</span></div>
            </div>
          )}

          <p className="text-[10px] text-slate-600">Preliminary underwriting estimate — not a credit decision or commitment to lend. Value, title, liens, and taxes must be confirmed by a formal appraisal/BPO and a preliminary title report before funding.</p>
        </div>
      )}
    </div>
  );
}

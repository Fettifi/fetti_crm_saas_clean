"use client";

// Structured 1003 / URLA editor. The loan officer (or borrower, via a future
// portal link) completes the full application here. Saves to leads.raw.urla as
// structured data so the MISMO 3.4 export is complete and import-ready.
import { createContext, use, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, Trash2, Save, Download, FileUp } from "lucide-react";
import CurrencyInput from "@/components/ui/CurrencyInput";
import AddressInput from "@/components/AddressInput";

function getAt(o: any, path: string) { return path.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o); }
function setAt(o: any, path: string, val: any) {
  const keys = path.split(".");
  const root: any = Array.isArray(o) ? [...o] : { ...(o || {}) };
  let cur = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i], nk = keys[i + 1];
    const child = cur[k];
    cur[k] = Array.isArray(child) ? [...child] : child && typeof child === "object" ? { ...child } : /^\d+$/.test(nk) ? [] : {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = val;
  return root;
}

// Field components live at MODULE scope (stable identity) so typing never remounts the
// input — defining them inside the page caused the "one character at a time / focus pops
// away" bug. They read the live form + setters from context so values + saves stay live.
const Ctx = createContext<any>(null);
function Txt({ label, path, type = "text", money = false }: { label: string; path: string; type?: string; money?: boolean }) {
  const { u, set, setNum, inp, lbl } = useContext(Ctx);
  return (
    <div><label className={lbl}>{label}</label>
      {money
        ? <CurrencyInput value={getAt(u, path) ?? ""} onChange={(v: string) => setNum(path, v)} className={inp} />
        : <input type={type} className={inp} value={getAt(u, path) ?? ""} onChange={(e) => type === "number" ? setNum(path, e.target.value) : set(path, e.target.value)} />}
    </div>
  );
}
function Sel({ label, path, opts }: { label: string; path: string; opts: (string | string[])[] }) {
  const { u, set, inp, lbl } = useContext(Ctx);
  return (
    <div><label className={lbl}>{label}</label>
      <select className={inp} value={getAt(u, path) ?? ""} onChange={(e) => set(path, e.target.value || undefined)}>
        {opts.map((o) => { const [v, t] = Array.isArray(o) ? o : [o, o]; return <option key={v} value={v}>{t}</option>; })}
      </select></div>
  );
}
function Card({ title, children }: { title: string; children: any }) {
  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
      <div className="text-xs uppercase tracking-wide text-emerald-400 mb-3">{title}</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{children}</div>
    </div>
  );
}
// Address street line with live Google autocomplete; picking a result auto-fills the
// sibling city/state/zip on the same base path. Module scope (no focus-loss) + reads
// the live form/setters from Ctx, like Txt.
function AddrAuto({ base, label = "Street" }: { base: string; label?: string }) {
  const { u, set, inp, lbl } = useContext(Ctx);
  return (
    <div className="col-span-2 sm:col-span-3">
      <label className={lbl}>{label}</label>
      <AddressInput
        value={getAt(u, `${base}.street`) ?? ""}
        onChange={(v: string) => set(`${base}.street`, v)}
        onResolved={(c: any) => {
          if (c.street) set(`${base}.street`, c.street);
          if (c.city) set(`${base}.city`, c.city);
          if (c.state) set(`${base}.state`, c.state);
          if (c.zip) set(`${base}.zip`, c.zip);
        }}
        placeholder="Start typing the address…"
        className={inp}
      />
    </div>
  );
}

const C = "U.S. Citizen", PR = "Permanent Resident";
const CITIZEN = [["USCitizen", C], ["PermanentResidentAlien", PR], ["NonPermanentResidentAlien", "Non-Permanent Resident"]];
const YN = [["", "—"], ["Yes", "Yes"], ["No", "No"]];

export default function Form1003({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [u, setU] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [bi, setBi] = useState(0);
  const [ocr, setOcr] = useState<string | null>(null);
  const [imp, setImp] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const xmlRef = useRef<HTMLInputElement>(null);

  async function importMismo(f: File) {
    setImp(`Importing ${f.name}…`);
    try {
      const fd = new FormData(); fd.append("xml", f);
      const r = await fetch(`/api/los/import-mismo?file=${id}`, { method: "POST", body: fd });
      const j = await r.json();
      if (r.ok) {
        await load();
        const names = (j.summary?.borrowerNames || []).join(", ");
        const warn = (j.warnings || []).length ? ` ⚠️ ${j.warnings[0]}` : "";
        setImp(`✓ Imported ${names || "1003"}${j.summary?.originationSystem ? ` from ${j.summary.originationSystem}` : ""}.${warn}`);
      } else setImp("⚠️ " + (j.error || "Import failed."));
    } catch { setImp("⚠️ Upload failed."); }
    setTimeout(() => setImp(null), 9000);
  }

  async function autofillFromDoc(f: File) {
    setOcr("Reading " + f.name + "…");
    try {
      const fd = new FormData(); fd.append("doc", f);
      const r = await fetch(`/api/los/extract?file=${id}`, { method: "POST", body: fd });
      const j = await r.json();
      if (r.ok) { await load(); setOcr(`✓ Filled from ${j.docType || "document"}.`); }
      else setOcr("⚠️ " + (j.error || "Couldn't read it."));
    } catch { setOcr("⚠️ Upload failed."); }
    setTimeout(() => setOcr(null), 5000);
  }

  const load = useCallback(async () => {
    const r = await fetch(`/api/los/urla?file=${id}`);
    if (r.ok) { const j = await r.json(); setU(j.urla); setPct(j.completeness?.pct ?? null); }
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const set = (path: string, val: any) => setU((p: any) => setAt(p, path, val));
  const setNum = (path: string, val: string) => set(path, val === "" ? undefined : Number(val.replace(/[^0-9.\-]/g, "")));

  async function save() {
    setSaving(true);
    const r = await fetch(`/api/los/urla?file=${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urla: u }) });
    const j = await r.json();
    if (r.ok) { setPct(j.completeness?.pct ?? null); setSavedAt(new Date().toLocaleTimeString()); }
    else alert(j.error || "Save failed.");
    setSaving(false);
  }

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>;
  if (!u) return <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center">Application not found.</div>;

  const b = u.borrowers?.[0] || {};
  const inp = "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none";
  const lbl = "text-xs text-slate-400 mb-1 block";

  // Txt / Sel / Card are now module-level (see top of file) — defining them here was
  // what remounted inputs on every keystroke. inp/lbl are passed to them via context.
  const addItem = (key: string) => set(key, [...(getAt(u, key) || []), {}]);
  const delItem = (key: string, i: number) => set(key, (getAt(u, key) || []).filter((_: any, idx: number) => idx !== i));

  return (
    <Ctx.Provider value={{ u, set, setNum, inp, lbl }}>
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-4xl mx-auto pb-28">
        <Link href={`/los/${id}`} className="text-slate-400 hover:text-white text-sm flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Loan file</Link>
        <div className="flex items-center justify-between gap-3 mt-3 mb-5">
          <div>
            <h1 className="text-2xl font-bold">1003 / URLA — {b.fullName || "Borrower"}</h1>
            <div className="text-sm text-slate-500">Complete the application. Saves as structured data for a clean MISMO 3.4 export.</div>
          </div>
          {pct != null && <span className="text-sm font-semibold text-emerald-400 shrink-0">{pct}% complete</span>}
        </div>

        {/* AI document auto-fill */}
        <div className="bg-gradient-to-br from-emerald-950/40 to-slate-900/40 border border-emerald-800/40 rounded-2xl p-4 mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-slate-300">📎 <span className="font-semibold text-emerald-300">AI auto-fill:</span> drop a paystub, W2, bank statement, or ID and Claude reads it into the 1003.</div>
          <div className="flex items-center gap-3">
            {ocr && <span className="text-xs text-slate-400">{ocr}</span>}
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) autofillFromDoc(f); e.currentTarget.value = ""; }} />
            <button onClick={() => fileRef.current?.click()} className="text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 rounded-lg flex items-center gap-1.5"><FileUp className="w-4 h-4" /> Upload document</button>
          </div>
        </div>

        {/* Full 1003 import from a MISMO / Calyx Point XML */}
        <div className="bg-gradient-to-br from-sky-950/40 to-slate-900/40 border border-sky-800/40 rounded-2xl p-4 mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-slate-300">📄 <span className="font-semibold text-sky-300">Import full 1003:</span> upload a MISMO 3.4 / Calyx Point <code className="text-sky-200">.xml</code> export and the entire application fills in here — encrypted &amp; editable. The original file is archived to this loan file.</div>
          <div className="flex items-center gap-3">
            {imp && <span className="text-xs text-slate-400 max-w-xs">{imp}</span>}
            <input ref={xmlRef} type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importMismo(f); e.currentTarget.value = ""; }} />
            <button onClick={() => xmlRef.current?.click()} className="text-sm font-semibold bg-sky-600 hover:bg-sky-500 px-3 py-1.5 rounded-lg flex items-center gap-1.5"><FileUp className="w-4 h-4" /> Import 1003 XML</button>
          </div>
        </div>

        <div className="space-y-4">
          {/* Borrower switcher (co-borrowers) */}
          <div className="flex items-center gap-2 flex-wrap">
            {(u.borrowers || [{}]).map((bb: any, i: number) => (
              <button key={i} onClick={() => setBi(i)}
                className={`text-sm px-3 py-1.5 rounded-full ${bi === i ? "bg-emerald-500 text-slate-950 font-semibold" : "bg-slate-800 hover:bg-slate-700 text-slate-300"}`}>
                {i === 0 ? "Borrower" : "Co-borrower"} {(bb.firstName || bb.lastName) ? `· ${bb.firstName || ""} ${bb.lastName || ""}`.trim() : i > 0 ? `#${i + 1}` : ""}
              </button>
            ))}
            <button onClick={() => { const arr = u.borrowers || []; set("borrowers", [...arr, {}]); setBi(arr.length); }}
              className="text-xs flex items-center gap-1 text-emerald-400 hover:text-emerald-300 px-2 py-1.5"><Plus className="w-3 h-3" /> Add co-borrower</button>
            {bi > 0 && <button onClick={() => { set("borrowers", (u.borrowers || []).filter((_: any, idx: number) => idx !== bi)); setBi(0); }}
              className="text-xs flex items-center gap-1 text-slate-500 hover:text-red-400 px-2 py-1.5"><Trash2 className="w-3 h-3" /> Remove</button>}
          </div>

          <Card title={bi === 0 ? "Borrower" : `Co-borrower #${bi + 1}`}>
            <Txt label="First name" path={`borrowers.${bi}.firstName`} />
            <Txt label="Last name" path={`borrowers.${bi}.lastName`} />
            <Txt label="SSN" path={`borrowers.${bi}.ssn`} />
            <Txt label="Date of birth" path={`borrowers.${bi}.dob`} type="date" />
            <Sel label="Citizenship" path={`borrowers.${bi}.citizenship`} opts={[["", "—"], ...CITIZEN]} />
            <Sel label="Marital status" path={`borrowers.${bi}.maritalStatus`} opts={[["", "—"], "Married", "Separated", "Unmarried"]} />
            <Txt label="Dependents" path={`borrowers.${bi}.dependentsCount`} type="number" />
            <Txt label="Email" path={`borrowers.${bi}.email`} />
            <Txt label="Cell phone" path={`borrowers.${bi}.cellPhone`} />
          </Card>

          <Card title="Current residence">
            <AddrAuto base={`borrowers.${bi}.currentAddress`} />
            <Txt label="City" path={`borrowers.${bi}.currentAddress.city`} />
            <Txt label="State" path={`borrowers.${bi}.currentAddress.state`} />
            <Txt label="ZIP" path={`borrowers.${bi}.currentAddress.zip`} />
            <Sel label="Own or rent" path={`borrowers.${bi}.housingStatus`} opts={[["", "—"], "Own", "Rent", ["NoPrimaryHousingExpense", "No primary expense"]]} />
            <Txt label="Monthly housing $" path={`borrowers.${bi}.monthlyHousingExpense`} money />
            <Txt label="Years at address" path={`borrowers.${bi}.yearsAtAddress`} type="number" />
          </Card>

          <Card title="Employment">
            <Txt label="Employer name" path={`borrowers.${bi}.employment.employerName`} />
            <Txt label="Position / title" path={`borrowers.${bi}.employment.position`} />
            <Txt label="Start date" path={`borrowers.${bi}.employment.startDate`} type="date" />
            <Txt label="Employer phone" path={`borrowers.${bi}.employment.employerPhone`} />
            <Txt label="Years in line of work" path={`borrowers.${bi}.employment.yearsInLineOfWork`} type="number" />
            <div className="flex items-end pb-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-emerald-500" checked={!!getAt(u, `borrowers.${bi}.employment.selfEmployed`)} onChange={(e) => set(`borrowers.${bi}.employment.selfEmployed`, e.target.checked)} /> Self-employed</label></div>
          </Card>

          <Card title="Monthly income">
            <Txt label="Base" path={`borrowers.${bi}.income.base`} money />
            <Txt label="Overtime" path={`borrowers.${bi}.income.overtime`} money />
            <Txt label="Bonus" path={`borrowers.${bi}.income.bonus`} money />
            <Txt label="Commission" path={`borrowers.${bi}.income.commission`} money />
            <Txt label="Other" path={`borrowers.${bi}.income.other`} money />
          </Card>

          <Card title="Subject property & loan">
            <AddrAuto base="property.address" />
            <Txt label="City" path="property.address.city" />
            <Txt label="State" path="property.address.state" />
            <Txt label="ZIP" path="property.address.zip" />
            <Sel label="Occupancy" path="property.occupancy" opts={[["", "—"], ["PrimaryResidence", "Primary"], ["SecondHome", "Second home"], ["Investment", "Investment"]]} />
            <Txt label="Property value $" path="property.presentValue" money />
            <Txt label="Expected rent $/mo" path="property.expectedMonthlyRentalIncome" money />
            <Sel label="Loan purpose" path="loan.purpose" opts={[["", "—"], "Purchase", "Refinance", ["CashOutRefinance", "Cash-out refi"], "Other"]} />
            <Txt label="Loan amount $" path="loan.amount" money />
            <Sel label="Loan type" path="loan.loanType" opts={[["", "—"], "Conventional", "FHA", "VA", "USDA", ["Other", "Other / Non-QM / DSCR"]]} />
            <Sel label="Amortization" path="loan.amortizationType" opts={[["Fixed", "Fixed"], ["ARM", "ARM"]]} />
            <Txt label="Term (months)" path="loan.termMonths" type="number" />
          </Card>

          {/* Assets */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3"><div className="text-xs uppercase tracking-wide text-emerald-400">Assets</div>
              <button onClick={() => addItem("assets")} className="text-xs flex items-center gap-1 text-emerald-400 hover:text-emerald-300"><Plus className="w-3 h-3" /> Add</button></div>
            <div className="space-y-2">
              {(u.assets || []).map((_: any, i: number) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                  <Sel label="Type" path={`assets.${i}.type`} opts={[["CheckingAccount", "Checking"], ["SavingsAccount", "Savings"], ["MoneyMarketFund", "Money market"], ["RetirementFund", "Retirement"], ["Stock", "Stocks"], ["Other", "Other"]]} />
                  <Txt label="Institution" path={`assets.${i}.institution`} />
                  <Txt label="Balance $" path={`assets.${i}.balance`} money />
                  <button onClick={() => delItem("assets", i)} className="text-slate-500 hover:text-red-400 pb-2"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              {!(u.assets || []).length && <div className="text-slate-600 text-sm">No assets added.</div>}
            </div>
          </div>

          {/* Liabilities */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3"><div className="text-xs uppercase tracking-wide text-emerald-400">Liabilities</div>
              <button onClick={() => addItem("liabilities")} className="text-xs flex items-center gap-1 text-emerald-400 hover:text-emerald-300"><Plus className="w-3 h-3" /> Add</button></div>
            <div className="space-y-2">
              {(u.liabilities || []).map((_: any, i: number) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                  <Sel label="Type" path={`liabilities.${i}.type`} opts={[["Revolving", "Revolving"], ["Installment", "Installment"], ["MortgageLoan", "Mortgage"], ["Other", "Other"]]} />
                  <Txt label="Creditor" path={`liabilities.${i}.creditor`} />
                  <Txt label="Balance $" path={`liabilities.${i}.balance`} money />
                  <Txt label="Payment $/mo" path={`liabilities.${i}.monthlyPayment`} money />
                  <button onClick={() => delItem("liabilities", i)} className="text-slate-500 hover:text-red-400 pb-2"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              {!(u.liabilities || []).length && <div className="text-slate-600 text-sm">No liabilities added.</div>}
            </div>
          </div>

          {/* REO */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3"><div className="text-xs uppercase tracking-wide text-emerald-400">Real estate owned</div>
              <button onClick={() => addItem("reo")} className="text-xs flex items-center gap-1 text-emerald-400 hover:text-emerald-300"><Plus className="w-3 h-3" /> Add</button></div>
            <div className="space-y-2">
              {(u.reo || []).map((_: any, i: number) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-7 gap-2 items-end border-b border-slate-800/40 pb-2">
                  <AddrAuto base={`reo.${i}.address`} />
                  <Txt label="City" path={`reo.${i}.address.city`} />
                  <Txt label="State" path={`reo.${i}.address.state`} />
                  <Txt label="ZIP" path={`reo.${i}.address.zip`} />
                  <Txt label="Value $" path={`reo.${i}.presentValue`} money />
                  <Txt label="Rent $/mo" path={`reo.${i}.monthlyRentalIncome`} money />
                  <div className="flex items-end gap-1"><div className="flex-1"><Txt label="Mtg $/mo" path={`reo.${i}.monthlyMortgage`} money /></div><button onClick={() => delItem("reo", i)} className="text-slate-500 hover:text-red-400 pb-2"><Trash2 className="w-4 h-4" /></button></div>
                </div>
              ))}
              {!(u.reo || []).length && <div className="text-slate-600 text-sm">No other properties.</div>}
            </div>
          </div>

          <Card title="Declarations">
            <Sel label="Bankruptcy (7 yr)?" path="declarations.bankruptcyPast7Years" opts={YN} />
            <Sel label="Foreclosure (7 yr)?" path="declarations.foreclosurePast7Years" opts={YN} />
            <Sel label="Outstanding judgments?" path="declarations.outstandingJudgments" opts={YN} />
            <Sel label="Party to a lawsuit?" path="declarations.partyToLawsuit" opts={YN} />
            <Sel label="Owns other property?" path="declarations.ownsOtherProperty" opts={YN} />
            <Sel label="Occupy as primary?" path="declarations.intendToOccupyAsPrimary" opts={YN} />
            <Sel label="Borrowing down payment?" path="declarations.borrowingDownPayment" opts={YN} />
          </Card>

          <Card title="Demographic info (HMDA)">
            <Sel label="Ethnicity" path="demographics.ethnicity" opts={[["", "—"], ["HispanicOrLatino", "Hispanic or Latino"], ["NotHispanicOrLatino", "Not Hispanic or Latino"]]} />
            <Sel label="Race" path="demographics.race" opts={[["", "—"], ["White", "White"], ["BlackOrAfricanAmerican", "Black or African American"], ["Asian", "Asian"], ["AmericanIndianOrAlaskaNative", "American Indian/Alaska Native"], ["NativeHawaiianOrOtherPacificIslander", "Native Hawaiian/Pacific Islander"]]} />
            <Sel label="Sex" path="demographics.sex" opts={[["", "—"], "Female", "Male"]} />
            <div className="flex items-end pb-2 col-span-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-emerald-500" checked={getAt(u, "demographics.providedVoluntarily") === false} onChange={(e) => set("demographics.providedVoluntarily", e.target.checked ? false : true)} /> Borrower declined to provide</label></div>
          </Card>
        </div>
      </div>

      {/* sticky save bar */}
      <div className="fixed bottom-0 inset-x-0 bg-slate-900/95 border-t border-slate-800 backdrop-blur px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="text-sm text-slate-400">{pct != null && <span className="font-semibold text-emerald-400">{pct}% complete</span>}{savedAt && <span className="ml-3 text-slate-500">saved {savedAt}</span>}</div>
          <div className="flex items-center gap-2">
            <a href={`/api/los/urla/pdf?file=${id}`} target="_blank" rel="noreferrer" className="text-sm flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg"><Download className="w-4 h-4" /> PDF (1003)</a>
            <a href={`/api/los/export?file=${id}`} download className="text-sm flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg"><Download className="w-4 h-4" /> MISMO 3.4</a>
            <button onClick={save} disabled={saving} className="text-sm font-semibold flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 rounded-lg">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save 1003
            </button>
          </div>
        </div>
      </div>
    </div>
    </Ctx.Provider>
  );
}

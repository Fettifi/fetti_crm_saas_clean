"use client";

// Structured 1003 / URLA editor. The loan officer (or borrower, via a future
// portal link) completes the full application here. Saves to leads.raw.urla as
// structured data so the MISMO 3.4 export is complete and import-ready.
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, Trash2, Save, Download } from "lucide-react";

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

  const Txt = ({ label, path, type = "text", money = false }: { label: string; path: string; type?: string; money?: boolean }) => (
    <div><label className={lbl}>{label}</label>
      <input type={type} className={inp} value={getAt(u, path) ?? ""} onChange={(e) => (money || type === "number") ? setNum(path, e.target.value) : set(path, e.target.value)} /></div>
  );
  const Sel = ({ label, path, opts }: { label: string; path: string; opts: (string | string[])[] }) => (
    <div><label className={lbl}>{label}</label>
      <select className={inp} value={getAt(u, path) ?? ""} onChange={(e) => set(path, e.target.value || undefined)}>
        {opts.map((o) => { const [v, t] = Array.isArray(o) ? o : [o, o]; return <option key={v} value={v}>{t}</option>; })}
      </select></div>
  );
  const Card = ({ title, children }: { title: string; children: any }) => (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
      <div className="text-xs uppercase tracking-wide text-emerald-400 mb-3">{title}</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{children}</div>
    </div>
  );
  const addItem = (key: string) => set(key, [...(getAt(u, key) || []), {}]);
  const delItem = (key: string, i: number) => set(key, (getAt(u, key) || []).filter((_: any, idx: number) => idx !== i));

  return (
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

        <div className="space-y-4">
          <Card title="Borrower">
            <Txt label="First name" path="borrowers.0.firstName" />
            <Txt label="Last name" path="borrowers.0.lastName" />
            <Txt label="SSN" path="borrowers.0.ssn" />
            <Txt label="Date of birth" path="borrowers.0.dob" type="date" />
            <Sel label="Citizenship" path="borrowers.0.citizenship" opts={[["", "—"], ...CITIZEN]} />
            <Sel label="Marital status" path="borrowers.0.maritalStatus" opts={[["", "—"], "Married", "Separated", "Unmarried"]} />
            <Txt label="Dependents" path="borrowers.0.dependentsCount" type="number" />
            <Txt label="Email" path="borrowers.0.email" />
            <Txt label="Cell phone" path="borrowers.0.cellPhone" />
          </Card>

          <Card title="Current residence">
            <Txt label="Street" path="borrowers.0.currentAddress.street" />
            <Txt label="City" path="borrowers.0.currentAddress.city" />
            <Txt label="State" path="borrowers.0.currentAddress.state" />
            <Txt label="ZIP" path="borrowers.0.currentAddress.zip" />
            <Sel label="Own or rent" path="borrowers.0.housingStatus" opts={[["", "—"], "Own", "Rent", ["NoPrimaryHousingExpense", "No primary expense"]]} />
            <Txt label="Monthly housing $" path="borrowers.0.monthlyHousingExpense" money />
            <Txt label="Years at address" path="borrowers.0.yearsAtAddress" type="number" />
          </Card>

          <Card title="Employment">
            <Txt label="Employer name" path="borrowers.0.employment.employerName" />
            <Txt label="Position / title" path="borrowers.0.employment.position" />
            <Txt label="Start date" path="borrowers.0.employment.startDate" type="date" />
            <Txt label="Employer phone" path="borrowers.0.employment.employerPhone" />
            <Txt label="Years in line of work" path="borrowers.0.employment.yearsInLineOfWork" type="number" />
            <div className="flex items-end pb-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-emerald-500" checked={!!getAt(u, "borrowers.0.employment.selfEmployed")} onChange={(e) => set("borrowers.0.employment.selfEmployed", e.target.checked)} /> Self-employed</label></div>
          </Card>

          <Card title="Monthly income">
            <Txt label="Base" path="borrowers.0.income.base" money />
            <Txt label="Overtime" path="borrowers.0.income.overtime" money />
            <Txt label="Bonus" path="borrowers.0.income.bonus" money />
            <Txt label="Commission" path="borrowers.0.income.commission" money />
            <Txt label="Other" path="borrowers.0.income.other" money />
          </Card>

          <Card title="Subject property & loan">
            <Txt label="Street" path="property.address.street" />
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
                <div key={i} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                  <Txt label="Property address" path={`reo.${i}.address`} />
                  <Txt label="Value $" path={`reo.${i}.presentValue`} money />
                  <Txt label="Rent $/mo" path={`reo.${i}.monthlyRentalIncome`} money />
                  <Txt label="Mortgage $/mo" path={`reo.${i}.monthlyMortgage`} money />
                  <button onClick={() => delItem("reo", i)} className="text-slate-500 hover:text-red-400 pb-2"><Trash2 className="w-4 h-4" /></button>
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
            <a href={`/api/los/export?file=${id}`} download className="text-sm flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg"><Download className="w-4 h-4" /> MISMO 3.4</a>
            <button onClick={save} disabled={saving} className="text-sm font-semibold flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 rounded-lg">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save 1003
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

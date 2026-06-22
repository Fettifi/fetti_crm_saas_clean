"use client";

// "Price a deal" — the fast multi-portal capture flow. Enter the scenario once,
// paste each portal's pricing result into its lane (open each portal with one
// click), then hit a single button: every lane is captured in parallel and the
// ranked side-by-side comparison appears below. Attended (you run each portal),
// but the CRM orchestrates capture + compare in one motion.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Search, ExternalLink, Plus, X } from "lucide-react";

type Lane = { key: string; name: string; portalUrl?: string; text: string; status?: string; busy?: boolean };

const num = (v: any) => (v === "" || v == null ? undefined : Number(String(v).replace(/[^0-9.]/g, "")) || undefined);

export default function PricingRunPage() {
  const [sc, setSc] = useState<any>({ loanAmount: "", propertyValue: "", fico: "", occupancy: "", purpose: "", loanType: "", state: "" });
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [results, setResults] = useState<any[] | null>(null);
  const [filtered, setFiltered] = useState(0);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/pricing/lenders").then((r) => (r.ok ? r.json() : { lenders: [] })).then((j) => {
      const ls = (j.lenders || []).filter((l: any) => l.active !== false);
      setLanes(ls.map((l: any) => ({ key: l.id, name: l.name, portalUrl: l.portalUrl, text: "" })));
    }).catch(() => {});
  }, []);

  const scenario = useMemo(() => ({
    loanAmount: num(sc.loanAmount), propertyValue: num(sc.propertyValue), fico: num(sc.fico),
    occupancy: sc.occupancy || undefined, purpose: sc.purpose || undefined, loanType: sc.loanType || undefined, state: sc.state || undefined,
  }), [sc]);
  const ltv = num(sc.loanAmount) && num(sc.propertyValue) ? ((num(sc.loanAmount)! / num(sc.propertyValue)!) * 100).toFixed(1) : null;

  const setLane = (key: string, patch: Partial<Lane>) => setLanes((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLane = () => setLanes((ls) => [...ls, { key: "custom-" + ls.length + "-" + (ls.at(-1)?.key || "x"), name: "", text: "" }]);
  const removeLane = (key: string) => setLanes((ls) => ls.filter((l) => l.key !== key));

  async function captureLane(l: Lane): Promise<number> {
    if (!l.name.trim() || l.text.trim().length < 10) return 0;
    setLane(l.key, { busy: true, status: "parsing…" });
    try {
      const r = await fetch("/api/pricing/capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lenderName: l.name.trim(), text: l.text, replace: true }) });
      const j = await r.json();
      setLane(l.key, { busy: false, status: r.ok ? `✓ ${j.added} products` : "⚠️ " + (j.error || "failed") });
      return r.ok ? j.added || 0 : 0;
    } catch { setLane(l.key, { busy: false, status: "⚠️ connection error" }); return 0; }
  }

  async function runAll() {
    const active = lanes.filter((l) => l.name.trim() && l.text.trim().length >= 10);
    if (!active.length) { setMsg("Paste at least one portal's pricing into a lane first."); return; }
    setRunning(true); setMsg(null); setResults(null);
    const counts = await Promise.all(active.map(captureLane));
    const total = counts.reduce((a, b) => a + b, 0);
    try {
      const r = await fetch("/api/pricing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "compare", scenario }) });
      const j = await r.json();
      setResults(j.results || []); setFiltered(j.filtered || 0);
      setMsg(`Captured ${total} products across ${active.length} lender${active.length > 1 ? "s" : ""}. Ranked below.`);
    } catch { setMsg(`Captured ${total} products, but the comparison failed to load.`); }
    setRunning(false);
  }

  const inp = "bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none";
  const captureBookmarklet = "javascript:(function(){try{var s=window.getSelection&&String(window.getSelection());var t=(s&&s.length>20)?s:document.body.innerText;navigator.clipboard.writeText(t).then(function(){alert('Pricing copied. Paste it into the matching lane in Fetti CRM.');},function(){alert('Select the pricing and copy it manually.');});}catch(e){alert('Copy failed: '+e.message);}})();";

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        <Link href="/pricing" className="text-slate-400 hover:text-white text-sm">← Pricing</Link>
        <h1 className="text-2xl font-bold mt-2">Price a deal — across your portals</h1>
        <p className="text-slate-500 text-sm">Set the scenario once, open each portal, paste its result into the lane, then capture &amp; compare in one click.</p>

        {/* Scenario */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mt-5">
          <div className="text-xs uppercase tracking-wide text-emerald-400 mb-3">The deal {ltv && <span className="text-slate-500 normal-case">· LTV {ltv}%</span>}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 items-end">
            {[["loanAmount", "Loan $"], ["propertyValue", "Value $"], ["fico", "FICO"]].map(([k, lab]) => (
              <div key={k}><label className="text-xs text-slate-400 block mb-1">{lab}</label><input value={sc[k]} onChange={(e) => setSc({ ...sc, [k]: e.target.value })} className={`${inp} w-full`} /></div>
            ))}
            <div><label className="text-xs text-slate-400 block mb-1">Occupancy</label><select value={sc.occupancy} onChange={(e) => setSc({ ...sc, occupancy: e.target.value })} className={`${inp} w-full`}><option value="">Any</option><option>PrimaryResidence</option><option>SecondHome</option><option>Investment</option></select></div>
            <div><label className="text-xs text-slate-400 block mb-1">Purpose</label><select value={sc.purpose} onChange={(e) => setSc({ ...sc, purpose: e.target.value })} className={`${inp} w-full`}><option value="">Any</option><option>Purchase</option><option>Refinance</option><option>CashOutRefinance</option></select></div>
            <div><label className="text-xs text-slate-400 block mb-1">Type</label><select value={sc.loanType} onChange={(e) => setSc({ ...sc, loanType: e.target.value })} className={`${inp} w-full`}><option value="">Any</option><option>Conventional</option><option>FHA</option><option>VA</option><option>Jumbo</option><option>DSCR</option><option>NonQM</option></select></div>
            <div><label className="text-xs text-slate-400 block mb-1">State</label><input value={sc.state} onChange={(e) => setSc({ ...sc, state: e.target.value })} placeholder="CA" className={`${inp} w-full`} /></div>
          </div>
        </div>

        {/* Lender lanes */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mt-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-wide text-emerald-400">Portal results — paste each lender&apos;s pricing</div>
            <button onClick={addLane} className="text-xs text-slate-400 hover:text-white flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> add lender</button>
          </div>
          <div className="space-y-3">
            {lanes.map((l) => (
              <div key={l.key} className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2 items-start">
                <div className="space-y-1">
                  <input value={l.name} onChange={(e) => setLane(l.key, { name: e.target.value })} placeholder="Lender" className={`${inp} w-full text-sm`} />
                  <div className="flex items-center gap-2 text-[11px]">
                    {l.portalUrl ? <a href={l.portalUrl} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline flex items-center gap-0.5">open pricer <ExternalLink className="w-3 h-3" /></a> : <span className="text-slate-600">no portal URL</span>}
                    {l.key.startsWith("custom-") && <button onClick={() => removeLane(l.key)} className="text-slate-600 hover:text-red-400 flex items-center gap-0.5"><X className="w-3 h-3" /> remove</button>}
                    {l.status && <span className={l.status.startsWith("✓") ? "text-emerald-400" : l.status.startsWith("⚠") ? "text-amber-400" : "text-slate-500"}>{l.busy && <Loader2 className="w-3 h-3 animate-spin inline mr-1" />}{l.status}</span>}
                  </div>
                </div>
                <textarea value={l.text} onChange={(e) => setLane(l.key, { text: e.target.value, status: undefined })} placeholder={`Paste ${l.name || "this lender"}'s pricing result…`} rows={3} className={`${inp} w-full font-mono text-xs`} />
              </div>
            ))}
            {!lanes.length && <div className="text-slate-600 text-sm">No lenders in your directory yet — add one, or set them up on the Pricing page.</div>}
          </div>

          <div className="flex items-center gap-3 mt-4">
            <button onClick={runAll} disabled={running} className="text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 rounded-lg flex items-center gap-1.5">
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Capture all &amp; compare
            </button>
            {msg && <span className="text-xs text-slate-300">{msg}</span>}
          </div>
          <details className="mt-3">
            <summary className="text-[11px] text-slate-500 cursor-pointer">One-click copy bookmarklet (optional)</summary>
            <div className="text-[11px] text-slate-500 mt-2 space-y-1.5">
              <div>Create a browser bookmark with this as its URL. On a portal pricing result, click it to copy, then paste into the matching lane.</div>
              <input readOnly value={captureBookmarklet} onClick={(e) => e.currentTarget.select()} className={`${inp} w-full font-mono text-[10px]`} />
            </div>
          </details>
        </div>

        {/* Results */}
        {results && (
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mt-4">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">{results.length} eligible · {filtered} filtered out · best rate highlighted</div>
            {results.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-500 text-left"><tr><th className="py-1">#</th><th>Lender</th><th>Product</th><th>Rate</th><th>Price</th><th>P&amp;I</th><th>Lock</th></tr></thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={r.id} className={`border-t border-slate-800/50 ${i === 0 ? "bg-emerald-500/10" : ""}`}>
                        <td className="py-2 text-slate-500">{i + 1}</td>
                        <td className="font-medium">{r.lenderName}</td>
                        <td className="text-slate-300">{r.productName}{r.loanType ? ` · ${r.loanType}` : ""}</td>
                        <td className="font-bold text-emerald-300">{r.noteRate != null ? r.noteRate.toFixed(3) + "%" : "—"}</td>
                        <td className="text-slate-300">{r.pricePercent != null ? r.pricePercent.toFixed(3) : "—"}</td>
                        <td className="text-slate-300">{r.monthlyPI != null ? "$" + Math.round(r.monthlyPI).toLocaleString() : "—"}</td>
                        <td className="text-slate-500">{r.lockDays ? r.lockDays + "d" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="text-slate-500 text-sm">No eligible products for that scenario. Loosen the scenario, or check the lanes captured correctly.</div>}
            <p className="text-[11px] text-slate-600 mt-3">Compares everything in your pricing store for this scenario — today&apos;s captures plus any current rate sheets. Estimates from your own portal pulls; confirm final pricing in the portal before locking.</p>
          </div>
        )}
      </div>
    </div>
  );
}

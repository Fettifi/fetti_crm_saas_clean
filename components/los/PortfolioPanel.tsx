"use client";

// PORTFOLIO PANEL — the property set behind a loan file.
//
// A loan file has one property_address column. When a borrower is buying six properties there is
// nowhere to put the other five, and the first attempt crammed two into the column. This panel is
// where the set actually lives.
//
// The numbers are deliberately NOT one number. "Committed" (under contract or past it) is the
// borrower's exposure; "identified" is still a candidate. Blending them is how a pipeline figure,
// a shopping-sheet LTV and a pre-approval letter all become confidently wrong at once, so the two
// are shown apart and the file's own property_value column is left describing the primary property.
import { useCallback, useEffect, useState } from "react";
import { Building2, Loader2, Plus, Star, X, AlertTriangle } from "lucide-react";

type Status = "identified" | "under_contract" | "in_diligence" | "closed" | "dropped";
type Prop = { id: string; address: string; city?: string | null; state?: string | null; zip?: string | null;
  property_type?: string | null; units?: number | null; price?: number | null; contract_price?: number | null;
  requested_loan?: number | null; status: Status; occupancy?: string | null; dropped_reason?: string | null };
type Rollup = { count: number; dropped: number; committed_count: number; identified_count: number;
  committed_value: number | null; committed_requested_loan: number | null; identified_value: number | null;
  states: string[]; occupancies: string[] };
type Purpose = { cls: "business" | "consumer" | "mixed_unresolved" | "unknown"; reason: string };
type Portfolio = { name: string; properties: Prop[]; primary_id: string | null; source: { name: string } | null };
type Saved = { id: string; name: string; count: number };

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : "$" + Math.round(n).toLocaleString();

const STATUS_LABEL: Record<Status, string> = {
  identified: "Identified", under_contract: "Under contract", in_diligence: "In diligence",
  closed: "Closed", dropped: "Dropped",
};
const STATUS_CLASS: Record<Status, string> = {
  identified: "bg-slate-700/60 text-slate-300",
  under_contract: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  in_diligence: "bg-sky-500/15 text-sky-300 border border-sky-500/30",
  closed: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  dropped: "bg-slate-800 text-slate-500 line-through",
};

export default function PortfolioPanel({ fileId }: { fileId: string }) {
  const [p, setP] = useState<Portfolio | null>(null);
  const [roll, setRoll] = useState<Rollup | null>(null);
  const [purpose, setPurpose] = useState<Purpose | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [form, setForm] = useState({ address: "", city: "", state: "", zip: "", price: "", status: "identified" as Status, occupancy: "Investment" });

  const url = `/api/los/files/${fileId}/portfolio`;

  const apply = (j: { portfolio: Portfolio | null; rollup: Rollup | null; purpose: Purpose | null }) => {
    setP(j.portfolio); setRoll(j.rollup); setPurpose(j.purpose);
  };

  const load = useCallback(async () => {
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (r.ok) apply(j);
    } catch { /* leave the panel empty rather than breaking the page */ }
    setLoading(false);
  }, [url]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { (async () => {
    try {
      const r = await fetch("/api/underwrite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list" }) });
      if (r.ok) { const j = await r.json(); setSaved(Array.isArray(j?.portfolios) ? j.portfolios : []); }
    } catch { /* the import path is optional */ }
  })(); }, []);

  const send = async (method: string, body?: unknown) => {
    setBusy(true); setErr("");
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json();
      if (!r.ok) { setErr(j?.error || "Something went wrong."); setBusy(false); return false; }
      apply(j); setBusy(false); return true;
    } catch (e) { setErr(e instanceof Error ? e.message : "error"); setBusy(false); return false; }
  };

  const addProperty = async () => {
    const ok = await send("PATCH", { action: "add", property: {
      address: form.address, city: form.city || null, state: form.state || null, zip: form.zip || null,
      price: form.price ? Number(form.price.replace(/[^0-9.]/g, "")) : null,
      status: form.status, occupancy: form.occupancy || null,
    } });
    if (ok) { setForm({ ...form, address: "", city: "", zip: "", price: "" }); setAdding(false); }
  };

  const drop = async (id: string, address: string) => {
    const reason = window.prompt(`Why is ${address} coming off this file?\n\nThe reason is kept — a property that was under contract and fell out is part of the file's history.`);
    if (reason === null) return;
    await send("PATCH", { action: "drop", property_id: id, reason });
  };

  if (loading) {
    return <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mt-4 flex items-center gap-2 text-slate-500 text-sm">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading properties…
    </div>;
  }

  // No portfolio: a single-property file looks and behaves exactly as it always has.
  if (!p) {
    return (
      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mt-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400 flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Properties</div>
            <div className="text-sm text-slate-500 mt-1">This file covers one property. Make it a portfolio file to track several under one borrower.</div>
          </div>
          <div className="flex items-center gap-2">
            {saved.length > 0 && (
              <select
                onChange={(e) => { if (e.target.value) send("PUT", { uw_portfolio_id: e.target.value }); }}
                defaultValue=""
                className="bg-slate-800 border border-slate-700 rounded-lg text-xs px-2 py-2 text-slate-300"
              >
                <option value="">Import from /underwrite…</option>
                {saved.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.count})</option>)}
              </select>
            )}
            <button onClick={() => send("PUT", {})} disabled={busy}
              className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-2 rounded-lg flex items-center gap-1.5">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Make this a portfolio file
            </button>
          </div>
        </div>
        {err && <div className="text-xs text-rose-400 mt-2">{err}</div>}
      </div>
    );
  }

  const active = p.properties.filter((x) => x.status !== "dropped");
  const dropped = p.properties.filter((x) => x.status === "dropped");

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mt-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-emerald-400 flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Portfolio — {p.name}</div>
          <div className="text-sm text-slate-500 mt-0.5">
            {roll?.count} propert{roll?.count === 1 ? "y" : "ies"}
            {roll?.states.length ? ` · ${roll.states.join(", ")}` : ""}
            {p.source ? ` · imported from “${p.source.name}”` : ""}
          </div>
        </div>
        <button onClick={() => setAdding((v) => !v)} className="text-xs font-semibold bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add property
        </button>
      </div>

      {/* Committed and identified are shown APART. There is deliberately no combined total. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <Stat label={`Committed (${roll?.committed_count ?? 0})`} value={money(roll?.committed_value)} hint="Under contract or past it — the borrower's exposure" tone="emerald" />
        <Stat label={`Identified (${roll?.identified_count ?? 0})`} value={money(roll?.identified_value)} hint="Still candidates — never counted as exposure" tone="slate" />
        <Stat label="Requested loan" value={money(roll?.committed_requested_loan)} hint="Across committed properties only" tone="slate" />
        <Stat label="Purpose" value={purpose?.cls === "mixed_unresolved" ? "Mixed" : (purpose?.cls ?? "—").replace(/^\w/, (c) => c.toUpperCase())} hint={purpose?.reason || ""} tone={purpose?.cls === "mixed_unresolved" ? "amber" : "slate"} />
      </div>

      {purpose?.cls === "mixed_unresolved" && (
        <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div><span className="font-semibold">This file has no single purpose.</span> {purpose.reason}</div>
        </div>
      )}

      {adding && (
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 mb-3 grid grid-cols-2 sm:grid-cols-6 gap-2">
          <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street address" className="col-span-2 sm:col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-sm" />
          <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="City" className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-sm" />
          <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase().slice(0, 2) })} placeholder="ST" className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-sm" />
          <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Price" className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-sm" />
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Status })} className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-sm">
            <option value="identified">Identified</option><option value="under_contract">Under contract</option>
            <option value="in_diligence">In diligence</option><option value="closed">Closed</option>
          </select>
          <select value={form.occupancy} onChange={(e) => setForm({ ...form, occupancy: e.target.value })} className="col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-sm">
            <option value="Investment">Investment</option><option value="Primary residence">Primary residence</option><option value="Second home">Second home</option>
          </select>
          <button onClick={addProperty} disabled={busy || !form.address.trim()} className="col-span-2 sm:col-span-1 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 px-3 py-1.5 rounded-lg">
            {busy ? "…" : "Add"}
          </button>
        </div>
      )}

      {err && <div className="text-xs text-rose-400 mb-2">{err}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-[11px] uppercase tracking-wide text-slate-500 text-left">
            <th className="py-1.5 pr-2">Property</th><th className="py-1.5 pr-2">Status</th>
            <th className="py-1.5 pr-2 text-right">Price</th><th className="py-1.5 pr-2">Occupancy</th><th className="py-1.5 w-16"></th>
          </tr></thead>
          <tbody>
            {active.map((x) => (
              <tr key={x.id} className="border-t border-slate-800/70">
                <td className="py-2 pr-2">
                  <div className="flex items-center gap-1.5">
                    {p.primary_id === x.id && <Star className="w-3 h-3 text-amber-400 shrink-0" aria-label="Primary property" />}
                    <span className="text-slate-200">{x.address}</span>
                  </div>
                  <div className="text-xs text-slate-500">{[x.city, x.state, x.zip].filter(Boolean).join(", ")}{x.property_type ? ` · ${x.property_type}` : ""}{x.units ? ` · ${x.units} unit${x.units > 1 ? "s" : ""}` : ""}</div>
                </td>
                <td className="py-2 pr-2"><span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_CLASS[x.status]}`}>{STATUS_LABEL[x.status]}</span></td>
                <td className="py-2 pr-2 text-right tabular-nums text-slate-300">{money(x.contract_price ?? x.price)}</td>
                <td className="py-2 pr-2 text-xs text-slate-400">{x.occupancy || "—"}</td>
                <td className="py-2 text-right whitespace-nowrap">
                  {p.primary_id !== x.id && (
                    <button onClick={() => send("PATCH", { action: "primary", property_id: x.id })} title="Make primary — this is the address the file's own column shows"
                      className="text-slate-500 hover:text-amber-400 px-1"><Star className="w-3.5 h-3.5" /></button>
                  )}
                  <button onClick={() => drop(x.id, x.address)} title="Drop from this file (kept on the record, with a reason)"
                    className="text-slate-600 hover:text-rose-400 px-1"><X className="w-3.5 h-3.5" /></button>
                </td>
              </tr>
            ))}
            {dropped.map((x) => (
              <tr key={x.id} className="border-t border-slate-800/40 opacity-50">
                <td className="py-1.5 pr-2 text-slate-500">{x.address}</td>
                <td className="py-1.5 pr-2"><span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_CLASS.dropped}`}>Dropped</span></td>
                <td className="py-1.5 pr-2"></td>
                <td className="py-1.5 pr-2 text-xs text-slate-500 italic" colSpan={2}>{x.dropped_reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-[11px] text-slate-600 mt-3 leading-relaxed">
        The file&apos;s own address, value and loan-amount fields still describe the <span className="text-slate-500">primary</span> property (★).
        They feed the pipeline, pre-approval letters and title orders, so this panel never writes a portfolio-wide sum into them.
      </div>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: "emerald" | "slate" | "amber" }) {
  const ring = tone === "emerald" ? "border-emerald-800/40" : tone === "amber" ? "border-amber-700/40" : "border-slate-800";
  const fg = tone === "emerald" ? "text-emerald-300" : tone === "amber" ? "text-amber-300" : "text-slate-200";
  return (
    <div className={`bg-slate-950/50 border ${ring} rounded-xl px-3 py-2`} title={hint}>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${fg}`}>{value}</div>
    </div>
  );
}

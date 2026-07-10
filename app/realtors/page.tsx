"use client";

// Real-estate-agent referral pipeline. Agents = the highest-ROI B2B channel: one
// active agent sends a steady stream of real, pre-qualified buyers. Track them from
// prospect → active, send a RESPA-safe intro in one click, mint a tracked referral
// link, and see who's actually sending business. RESPA §8: relationship + co-marketing,
// NEVER pay-per-referral (enforced in the outreach copy).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, Mail, Link2, Check, Users, TrendingUp, Trash2 } from "lucide-react";

type Agent = {
  id: string; name: string; company?: string; email?: string; phone?: string; market?: string;
  status: "prospect" | "contacted" | "active" | "dormant"; code?: string; notes?: string;
  referred: number; referred_t1: number; link: string | null; last_contact_at?: string;
};
const COLS: { key: Agent["status"]; label: string; hint: string }[] = [
  { key: "prospect", label: "Prospects", hint: "added, not yet contacted" },
  { key: "contacted", label: "Contacted", hint: "intro sent, warming up" },
  { key: "active", label: "Active", hint: "sending buyers — tracked" },
  { key: "dormant", label: "Dormant", hint: "went quiet — re-engage" },
];

export default function RealtorsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: "", company: "", email: "", phone: "", market: "", notes: "" });

  const load = useCallback(async () => {
    const r = await fetch("/api/realtors");
    if (r.ok) setAgents((await r.json()).agents || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(action: string, body: any) {
    setBusy(body.id || "new");
    await fetch("/api/realtors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body }) });
    await load(); setBusy(null);
  }
  async function add() {
    if (!form.name.trim()) return;
    await act("create", form);
    setForm({ name: "", company: "", email: "", phone: "", market: "", notes: "" }); setShow(false);
  }

  const totals = { active: agents.filter((a) => a.status === "active").length, buyers: agents.reduce((s, a) => s + a.referred, 0), t1: agents.reduce((s, a) => s + a.referred_t1, 0) };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <Link href="/leads" className="text-slate-400 hover:text-white text-sm">← CRM</Link>
        <div className="flex items-start justify-between gap-3 mt-2">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="w-5 h-5 text-emerald-400" /> Agent Referral Pipeline</h1>
            <p className="text-slate-500 text-sm">Real-estate agents are your #1 source of real, ready-to-buy borrowers. Work them like a pipeline.</p>
          </div>
          <button onClick={() => setShow((s) => !s)} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-2 text-sm font-semibold shrink-0"><Plus size={15} /> Add agent</button>
        </div>

        <div className="mt-3 flex gap-3 text-xs">
          <span className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-1.5">Active agents <b className="text-emerald-400">{totals.active}</b></span>
          <span className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-1.5">Buyers referred <b className="text-emerald-400">{totals.buyers}</b></span>
          <span className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-1.5">Tier-1 buyers <b className="text-amber-300">{totals.t1}</b></span>
        </div>

        {show && (
          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(["name", "company", "email", "phone", "market"] as const).map((f) => (
              <input key={f} placeholder={f === "market" ? "Market / area (e.g. Long Beach)" : f[0].toUpperCase() + f.slice(1)} value={(form as any)[f]}
                onChange={(e) => setForm({ ...form, [f]: e.target.value })} className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm" />
            ))}
            <input placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm" />
            <div className="sm:col-span-2 flex gap-2"><button onClick={add} disabled={busy === "new"} className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-sm font-semibold disabled:opacity-50">{busy === "new" ? "Adding…" : "Add"}</button></div>
          </div>
        )}

        <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/90">
          ⚖️ RESPA §8: never pay an agent for referrals. Grow these relationships with co-marketing, education, and being the lender who closes — the intro email is written to stay on the right side of that line.
        </div>

        {loading ? <div className="mt-10 flex justify-center"><Loader2 className="animate-spin text-slate-500" /></div> : (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
            {COLS.map((col) => {
              const list = agents.filter((a) => a.status === col.key);
              return (
                <div key={col.key} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                  <div className="font-semibold text-sm">{col.label} <span className="text-slate-600">({list.length})</span></div>
                  <div className="text-[10px] text-slate-600 mb-2">{col.hint}</div>
                  <div className="space-y-2">
                    {list.map((a) => (
                      <div key={a.id} className="rounded-lg bg-slate-950/70 border border-slate-800 p-2.5">
                        <div className="font-medium text-sm">{a.name}</div>
                        {a.company && <div className="text-[11px] text-slate-500">{a.company}{a.market ? ` · ${a.market}` : ""}</div>}
                        {a.status === "active" && <div className="text-[11px] text-emerald-400 mt-0.5 flex items-center gap-1"><TrendingUp size={11} /> {a.referred} buyers{a.referred_t1 ? ` · ${a.referred_t1} Tier-1` : ""}</div>}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {a.email && a.status !== "active" && (
                            <button onClick={() => act("outreach", { id: a.id })} disabled={busy === a.id} title="Send RESPA-safe intro email"
                              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50">{busy === a.id ? <Loader2 size={10} className="animate-spin" /> : <Mail size={10} />} Intro</button>
                          )}
                          {a.status !== "active" && (
                            <button onClick={() => act("activate", { id: a.id })} disabled={busy === a.id} title="Mint a tracked referral link"
                              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50"><Link2 size={10} /> Activate</button>
                          )}
                          {a.link && (
                            <button onClick={() => { navigator.clipboard?.writeText(a.link!); setCopied(a.id); setTimeout(() => setCopied(null), 1500); }}
                              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700">{copied === a.id ? <Check size={10} className="text-emerald-400" /> : <Link2 size={10} />} {copied === a.id ? "Copied" : "Link"}</button>
                          )}
                          <button onClick={() => act("delete", { id: a.id })} title="Remove" className="text-[10px] px-1.5 py-1 rounded bg-slate-800 hover:bg-red-900/50"><Trash2 size={10} /></button>
                        </div>
                      </div>
                    ))}
                    {!list.length && <div className="text-[11px] text-slate-700 py-1">—</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

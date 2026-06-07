"use client";

// Referral-partner console: add partners (realtors, wholesalers, etc.), get a
// tracked link to share, and see how many leads each has sent.
import { useEffect, useState } from "react";
import { Copy, Plus, Loader2, ChevronDown, Trophy } from "lucide-react";

type Partner = {
  id: string; code: string; name: string; company: string | null;
  leads: number; tier1: number; tier2: number; tier3: number; avg_score: number;
};
type RefLead = { id: string; full_name: string | null; loan_purpose: string | null; tier: string | null; score: number | null; stage: string | null; created_at: string };

const ORIGIN = "https://app.fettifi.com";

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [leadsByCode, setLeadsByCode] = useState<Record<string, RefLead[]>>({});

  async function toggleLeads(code: string) {
    if (expanded === code) { setExpanded(null); return; }
    setExpanded(code);
    if (!leadsByCode[code]) {
      const res = await fetch(`/api/partners/leads?code=${encodeURIComponent(code)}`);
      const j = await res.json();
      setLeadsByCode((p) => ({ ...p, [code]: j.leads || [] }));
    }
  }

  async function load() {
    const res = await fetch("/api/partners");
    const j = await res.json();
    setPartners(j.partners || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!name.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/partners", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, company }),
      });
      const j = await res.json();
      if (j.partner) { setPartners((p) => [j.partner, ...p]); setName(""); setCompany(""); }
    } finally { setAdding(false); }
  }

  function linkFor(code: string) { return `${ORIGIN}/start?ref=${code}`; }
  function copy(code: string) {
    navigator.clipboard?.writeText(linkFor(code));
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold">🤝 Referral Partners</h1>
        <p className="text-slate-400 text-sm mt-1">
          Add a realtor, wholesaler, or partner → get a tracked link to share. Every lead from
          that link is tagged to them automatically in your CRM.
        </p>

        {/* Add */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 mt-6 flex flex-col sm:flex-row gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Partner name"
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 focus:border-emerald-500 focus:outline-none" />
          <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company (optional)"
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 focus:border-emerald-500 focus:outline-none" />
          <button onClick={add} disabled={adding || !name.trim()}
            className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold px-5 py-2.5 rounded-lg">
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add
          </button>
        </div>

        {/* List */}
        <div className="mt-6 space-y-3">
          {loading && <div className="text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
          {!loading && partners.length === 0 && <div className="text-slate-500 text-sm">No partners yet. Add your first above.</div>}
          {partners.map((p, idx) => (
            <div key={p.id} className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${idx === 0 && p.leads > 0 ? "bg-yellow-500/20 text-yellow-400" : "bg-slate-800 text-slate-400"}`}>
                    {idx === 0 && p.leads > 0 ? <Trophy className="w-4 h-4" /> : idx + 1}
                  </div>
                  <div>
                    <div className="font-semibold">{p.name}{p.company ? ` · ${p.company}` : ""}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {p.leads} lead{p.leads === 1 ? "" : "s"}
                      {p.leads > 0 && (
                        <> · <span className="text-emerald-400">{p.tier1} Tier-1</span> · {p.tier2} T2 · {p.tier3} T3 · avg {p.avg_score}</>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-2xl font-bold text-emerald-400">{p.leads}</div>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <code className="flex-1 text-xs bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-emerald-300 truncate">
                  {linkFor(p.code)}
                </code>
                <button onClick={() => copy(p.code)} className="flex items-center gap-1 text-sm bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg">
                  <Copy className="w-4 h-4" /> {copied === p.code ? "Copied!" : "Copy"}
                </button>
                {p.leads > 0 && (
                  <button onClick={() => toggleLeads(p.code)} className="flex items-center gap-1 text-sm bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg">
                    <ChevronDown className={`w-4 h-4 transition-transform ${expanded === p.code ? "rotate-180" : ""}`} /> Leads
                  </button>
                )}
              </div>
              {expanded === p.code && (
                <div className="mt-3 border-t border-slate-800 pt-3">
                  {!leadsByCode[p.code] && <div className="text-slate-500 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
                  {leadsByCode[p.code]?.map((l) => (
                    <div key={l.id} className="flex items-center justify-between py-1.5 text-sm border-b border-slate-800/50 last:border-0">
                      <span>{l.full_name || "Lead"} <span className="text-slate-500">· {l.loan_purpose || "—"}</span></span>
                      <span className="text-xs"><span className={l.tier === "Tier 1" ? "text-emerald-400" : "text-slate-400"}>{l.tier || "—"}</span> · {l.stage || "New"}</span>
                    </div>
                  ))}
                  {leadsByCode[p.code]?.length === 0 && <div className="text-slate-500 text-sm">No leads yet.</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

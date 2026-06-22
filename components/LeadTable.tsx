"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import DeleteConfirm from "@/components/DeleteConfirm";

type Lead = {
  id: string;
  created_at: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
  loan_purpose: string | null;
  credit_band: string | null;
  stage: string | null;
  source: string | null;
  lead_source: string | null;
};

// A lead is "paid" if it came from an ad (LP paid_* source, or a paid traffic source).
const PAID_RE = /google|bing|cpc|ppc|paid|adwords|gclid|fbclid|meta|facebook/i;
function isPaid(l: { source: string | null; lead_source: string | null }): boolean {
  return /^paid_/.test(l.source || "") || PAID_RE.test(l.lead_source || "") || PAID_RE.test(l.source || "");
}

// A lead becomes a "complete application" once its file has all required docs
// (stage advances to Processing+) — those are kept separate from raw leads.
const APP_STAGES = ["application", "processing", "underwriting", "approved", "clear to close", "funded", "closed"];
function lifecycle(stage: string | null): "lead" | "engaged" | "application" {
  const s = (stage || "").toLowerCase();
  if (APP_STAGES.some((a) => s.includes(a))) return "application";
  if (s === "engaged") return "engaged";
  return "lead";
}
function StageBadge({ stage }: { stage: string | null }) {
  const k = lifecycle(stage);
  const map = {
    lead: ["New lead", "bg-slate-700/60 text-slate-300"],
    engaged: ["Engaged", "bg-amber-500/20 text-amber-300"],
    application: ["Application ✓", "bg-emerald-500/20 text-emerald-300"],
  } as const;
  const [label, cls] = map[k];
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

export default function LeadTable() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"leads" | "applications" | "all">("leads");
  // LOS: create-or-fetch a loan file (+ borrower link) per lead, on demand.
  const [losBusy, setLosBusy] = useState<string | null>(null);
  const [losFile, setLosFile] = useState<Record<string, { id: string; token: string }>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [delTarget, setDelTarget] = useState<Lead | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  async function doDelete(purge: boolean) {
    if (!delTarget) return;
    setDelBusy(true);
    try {
      const r = await fetch(`/api/leads?id=${delTarget.id}&purge=${purge ? 1 : 0}`, { method: "DELETE" });
      if (r.ok) { setLeads((ls) => ls.filter((x) => x.id !== delTarget.id)); setDelTarget(null); }
      else { const j = await r.json().catch(() => ({})); alert(j.error || "Delete failed."); }
    } catch { alert("Connection error deleting the lead."); } finally { setDelBusy(false); }
  }

  async function createFile(leadId: string) {
    setLosBusy(leadId);
    try {
      const r = await fetch("/api/los/files", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId }),
      });
      const j = await r.json();
      if (r.ok && j.file) {
        setLosFile((m) => ({ ...m, [leadId]: { id: j.file.id, token: j.file.share_token } }));
        try {
          await navigator.clipboard?.writeText(`${window.location.origin}/file/${j.file.share_token}`);
          setCopied(leadId); setTimeout(() => setCopied(null), 1500);
        } catch { /* clipboard may be blocked; link still on the row */ }
      } else {
        alert(j.error || "Could not create loan file.");
      }
    } finally { setLosBusy(null); }
  }
  function copyLink(leadId: string) {
    const f = losFile[leadId]; if (!f) return;
    navigator.clipboard?.writeText(`${window.location.origin}/file/${f.token}`);
    setCopied(leadId); setTimeout(() => setCopied(null), 1500);
  }

  useEffect(() => {
    let mounted = true;

    async function loadLeads() {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from("leads")
        // NOTE: do not embed applications(...) — that table/relationship does not
        // exist, which made the whole query fail (PGRST200) and the leads page show
        // nothing. Select only real columns on the leads table.
        .select(
          "id, created_at, full_name, email, phone, state, loan_purpose, credit_band, stage, source, lead_source"
        )
        .order("created_at", { ascending: false })
        .limit(200);

      if (!mounted) return;

      if (error) {
        console.error(error);
        setError(error.message);
      } else if (data) {
        setLeads(data as Lead[]);
      }

      setLoading(false);
    }

    loadLeads();
    const channel = supabase
      .channel("leads-changes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "leads" },
        () => {
          loadLeads();
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  if (loading) {
    return <div className="text-sm text-slate-400">Loading leads...</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-700 bg-red-900/40 px-3 py-2 text-xs text-red-200">
        Failed to load leads: {error}
      </div>
    );
  }

  if (!leads.length) {
    return (
      <div className="text-sm text-slate-400">
        No leads yet. Connect your Fetti LeadGen app or use the Apply page to
        submit a test lead.
      </div>
    );
  }

  const counts = {
    leads: leads.filter((l) => lifecycle(l.stage) !== "application").length,
    applications: leads.filter((l) => lifecycle(l.stage) === "application").length,
    all: leads.length,
  };
  const shown = leads.filter((l) =>
    view === "all" ? true : view === "applications" ? lifecycle(l.stage) === "application" : lifecycle(l.stage) !== "application"
  );

  const Tab = ({ id, label }: { id: typeof view; label: string }) => (
    <button onClick={() => setView(id)}
      className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${view === id ? "bg-emerald-600 text-slate-950" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
      {label} <span className="opacity-70">({counts[id]})</span>
    </button>
  );

  return (
    <div>
    <div className="flex items-center gap-2 mb-3">
      <Tab id="leads" label="Leads" />
      <Tab id="applications" label="Applications" />
      <Tab id="all" label="All" />
      <span className="text-[11px] text-slate-500 ml-1">Raw leads stay separate from complete applications.</span>
    </div>
    {!shown.length ? (
      <div className="text-sm text-slate-400">{view === "applications" ? "No complete applications yet — they appear here once a borrower's required docs are all in." : "No leads in this view."}</div>
    ) : (
    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
      <table className="min-w-full text-left text-xs">
        <thead className="border-b border-slate-800 bg-slate-900/80 text-slate-300">
          <tr>
            <th className="px-3 py-2">Created</th>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">Phone</th>
            <th className="px-3 py-2">State</th>
            <th className="px-3 py-2">Purpose</th>
            <th className="px-3 py-2">Credit</th>
            <th className="px-3 py-2">Stage</th>
            <th className="px-3 py-2">Source</th>
            <th className="px-3 py-2">Deal Score</th>
            <th className="px-3 py-2">LOS file</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {shown.map((lead) => (
            <tr key={lead.id} className="hover:bg-slate-900">
              <td className="px-3 py-2 text-slate-400">
                {lead.created_at
                  ? new Date(lead.created_at).toLocaleString()
                  : "—"}
              </td>
              <td className="px-3 py-2">{lead.full_name ?? "—"}</td>
              <td className="px-3 py-2">{lead.email ?? "—"}</td>
              <td className="px-3 py-2">{lead.phone ?? "—"}</td>
              <td className="px-3 py-2">{lead.state ?? "—"}</td>
              <td className="px-3 py-2">{lead.loan_purpose ?? "—"}</td>
              <td className="px-3 py-2">{lead.credit_band ?? "—"}</td>
              <td className="px-3 py-2"><StageBadge stage={lead.stage} /></td>
              <td className="px-3 py-2">
                <span>{lead.source ?? "generated"}</span>
                {isPaid(lead) && <span className="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300">Paid</span>}
                {lead.lead_source && lead.lead_source !== lead.source && <span className="block text-[10px] text-slate-500">{lead.lead_source}</span>}
              </td>
              <td className="px-3 py-2">
                {(() => {
                  // @ts-ignore
                  const app = lead.applications?.[0];
                  if (!app?.notes) return <span className="text-slate-600">—</span>;
                  try {
                    const notes = JSON.parse(app.notes);
                    const score = notes.dealScore?.score || notes.dealScore?.probability;
                    if (!score) return <span className="text-slate-600">—</span>;

                    const color = score === 'High' || score > 80 ? 'text-emerald-400' :
                      score === 'Medium' || score > 50 ? 'text-yellow-400' : 'text-red-400';

                    return <span className={`font-mono font-bold ${color}`}>{score}</span>;
                  } catch (e) {
                    return <span className="text-slate-600">Error</span>;
                  }
                })()}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <span className="flex items-center gap-2">
                  {losFile[lead.id] ? (
                    <>
                      <button onClick={() => copyLink(lead.id)} className="text-emerald-400 hover:text-emerald-300">
                        {copied === lead.id ? "✓ Copied" : "🔗 Copy link"}
                      </button>
                      <a href={`/los/${losFile[lead.id].id}`} className="text-slate-400 hover:text-white underline">Open</a>
                    </>
                  ) : (
                    <button onClick={() => createFile(lead.id)} disabled={losBusy === lead.id}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-50">
                      {losBusy === lead.id ? "…" : "📁 Create file + link"}
                    </button>
                  )}
                  <button onClick={() => setDelTarget(lead)} title="Delete lead permanently" className="text-slate-600 hover:text-red-400 px-1">🗑</button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    )}
    <DeleteConfirm open={!!delTarget} name={delTarget?.full_name || delTarget?.email || "this lead"} kind="lead" busy={delBusy} onCancel={() => setDelTarget(null)} onConfirm={doDelete} />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

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
};

export default function LeadTable() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // LOS: create-or-fetch a loan file (+ borrower link) per lead, on demand.
  const [losBusy, setLosBusy] = useState<string | null>(null);
  const [losFile, setLosFile] = useState<Record<string, { id: string; token: string }>>({});
  const [copied, setCopied] = useState<string | null>(null);

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
          "id, created_at, full_name, email, phone, state, loan_purpose, credit_band, stage, source"
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

  return (
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
          {leads.map((lead) => (
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
              <td className="px-3 py-2">{lead.stage ?? "New Lead"}</td>
              <td className="px-3 py-2">{lead.source ?? "generated"}</td>
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
                {losFile[lead.id] ? (
                  <span className="flex items-center gap-2">
                    <button onClick={() => copyLink(lead.id)} className="text-emerald-400 hover:text-emerald-300">
                      {copied === lead.id ? "✓ Copied" : "🔗 Copy link"}
                    </button>
                    <a href={`/los/${losFile[lead.id].id}`} className="text-slate-400 hover:text-white underline">Open</a>
                  </span>
                ) : (
                  <button onClick={() => createFile(lead.id)} disabled={losBusy === lead.id}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-50">
                    {losBusy === lead.id ? "…" : "📁 Create file + link"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

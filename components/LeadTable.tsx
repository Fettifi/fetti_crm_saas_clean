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

  useEffect(() => {
    let mounted = true;

    async function loadLeads() {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from("leads")
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

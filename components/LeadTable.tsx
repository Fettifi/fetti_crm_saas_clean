"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { Lead } from "@/lib/types";

export function LeadTable() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadLeads() {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("leads")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50);

        if (error) throw error;
        setLeads((data ?? []) as Lead[]);
      } catch (err: any) {
        console.error(err);
        setError(err.message ?? "Failed to load leads");
      } finally {
        setLoading(false);
      }
    }

    loadLeads();
  }, []);

  if (loading) {
    return <div className="text-sm text-slate-300">Loading leads…</div>;
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">
        Error loading leads: {error}
      </div>
    );
  }

  if (!leads.length) {
    return (
      <div className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-4 text-sm text-slate-300">
        No leads yet. Connect your Fetti LeadGen app or manually insert a few rows in the
        <code className="mx-1 rounded bg-slate-800 px-1 py-0.5 text-xs">leads</code> table.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-slate-800 bg-slate-950/60">
      <table className="min-w-full text-left text-xs md:text-sm">
        <thead className="bg-slate-900/80 text-slate-300">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">Phone</th>
            <th className="px-3 py-2">State</th>
            <th className="px-3 py-2">Stage</th>
            <th className="px-3 py-2">Score</th>
            <th className="px-3 py-2">Value</th>
            <th className="px-3 py-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id} className="border-t border-slate-800/80 hover:bg-slate-900/60">
              <td className="px-3 py-2">
                {lead.first_name} {lead.last_name}
              </td>
              <td className="px-3 py-2 text-slate-300">{lead.email}</td>
              <td className="px-3 py-2 text-slate-300">{lead.phone}</td>
              <td className="px-3 py-2">{lead.state}</td>
              <td className="px-3 py-2">{lead.stage}</td>
              <td className="px-3 py-2">{lead.score ?? "-"}</td>
              <td className="px-3 py-2">
                {lead.property_value ? `$${lead.property_value.toLocaleString()}` : "-"}
              </td>
              <td className="px-3 py-2 text-slate-400">
                {new Date(lead.created_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

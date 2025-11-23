import Link from "next/link";
import { getLeads } from "@/lib/leads";

export default async function LeadsPage() {
  const leads = await getLeads();

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-slate-400">
            Centralized view of all mortgage & investment opportunities.
          </p>
        </div>
        <Link
          href="/leads/new"
          className="rounded-lg bg-fettiGreen px-3 py-2 text-xs font-medium text-slate-950 shadow-sm hover:bg-emerald-500"
        >
          New Lead
        </Link>
      </header>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900/70 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Borrower</th>
              <th className="px-3 py-2 text-left">State</th>
              <th className="px-3 py-2 text-left">Purpose</th>
              <th className="px-3 py-2 text-left">Stage</th>
              <th className="px-3 py-2 text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr
                key={lead.id}
                className="border-t border-slate-800 hover:bg-slate-900/60"
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/leads/${lead.id}`}
                    className="font-medium text-fettiGold hover:underline"
                  >
                    {lead.first_name} {lead.last_name}
                  </Link>
                  <div className="text-xs text-slate-400">{lead.email}</div>
                </td>
                <td className="px-3 py-2 text-xs">{lead.state}</td>
                <td className="px-3 py-2 text-xs">{lead.loan_purpose}</td>
                <td className="px-3 py-2 text-xs">{lead.stage}</td>
                <td className="px-3 py-2 text-right text-xs">
                  {lead.score ?? "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {leads.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-slate-500">
            No leads yet. Once your Streamlit Fetti Leads app is wired to
            Supabase, they&apos;ll start showing up here automatically.
          </div>
        )}
      </div>
    </div>
  );
}

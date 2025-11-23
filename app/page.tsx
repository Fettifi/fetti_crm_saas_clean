import { Suspense } from "react";
import { getLeadStats } from "@/lib/leads";

export default async function DashboardPage() {
  const stats = await getLeadStats();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-slate-400">
          High-level view of your Fetti mortgage & investment pipeline.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Total Leads"
          value={stats.totalLeads}
          note="All-time in Supabase"
        />
        <StatCard
          label="Active Pipeline"
          value={stats.activeLeads}
          note="Not yet closed / lost"
        />
        <StatCard
          label="Avg. Lead Score"
          value={stats.avgScore}
          note="Based on Fetti AI scoring"
        />
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: number;
  note: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{note}</div>
    </div>
  );
}

import { LeadTable } from "@/components/LeadTable";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <div className="text-xs text-slate-400 mb-1">Today&apos;s New Leads</div>
          <div className="text-2xl font-semibold">—</div>
          <div className="mt-2 text-xs text-slate-400">
            Hook this up to a Supabase function or view for real-time lead counts.
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <div className="text-xs text-slate-400 mb-1">Warm / Hot Pipeline</div>
          <div className="text-2xl font-semibold">$—</div>
          <div className="mt-2 text-xs text-slate-400">
            Sum of property values for stages Qualified → Won.
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <div className="text-xs text-slate-400 mb-1">Average Credit Band</div>
          <div className="text-2xl font-semibold">—</div>
          <div className="mt-2 text-xs text-slate-400">
            Use Supabase SQL views to pre-aggregate your KPIs.
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base md:text-lg font-semibold">Latest Leads</h2>
          <span className="text-xs text-slate-400">
            Pulled live from Supabase <code className="font-mono">leads</code> table
          </span>
        </div>
        <LeadTable />
      </section>
    </div>
  );
}

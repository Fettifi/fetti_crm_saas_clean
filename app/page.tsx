export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-400">
          Overview of your Fetti CRM pipeline. Hook this up to Supabase
          analytics when you&apos;re ready.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="text-xs text-slate-400">Total Leads</div>
          <div className="mt-2 text-2xl font-semibold">0</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="text-xs text-slate-400">In Pipeline</div>
          <div className="mt-2 text-2xl font-semibold">0</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="text-xs text-slate-400">Funded</div>
          <div className="mt-2 text-2xl font-semibold">0</div>
        </div>
      </div>
    </div>
  );
}

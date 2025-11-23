import LeadTable from "@/components/LeadTable";

export default function LeadsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">All Leads</h1>
        <p className="mt-1 text-sm text-slate-400">
          Live view of leads from your Supabase <code>leads</code> table.
        </p>
      </div>

      <LeadTable />
    </div>
  );
}

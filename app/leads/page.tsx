import { LeadTable } from "@/components/LeadTable";

export default function LeadsPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">All Leads</h2>
        <p className="text-xs text-slate-400 max-w-md">
          This view is a simple table pulling from Supabase. You can extend it with filters
          (state, credit, loan purpose), tags, and bulk actions.
        </p>
      </div>
      <LeadTable />
    </div>
  );
}

import AppLayout from "@/components/AppLayout";
import LeadTable from "@/components/LeadTable";

export default function LeadsPage() {
  return (
    <AppLayout
      title="All Leads"
      description="Live view of leads from your Supabase leads table."
    >
      <LeadTable />
    </AppLayout>
  );
}

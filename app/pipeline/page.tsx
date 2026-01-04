
import AppLayout from "@/components/AppLayout";

export default function PipelinePage() {
  return (
    <AppLayout
      title="Pipeline"
      description="This is a placeholder for your pipeline view. You can group leads by stage (New, Contacted, App In, Approved, Funded) using Supabase data."
    >
      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center">
        <p className="text-slate-400">Pipeline Board Placeholder</p>
      </div>
    </AppLayout>
  );
}


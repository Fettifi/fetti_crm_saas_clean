import { getLeadById } from "@/lib/leads";
import { notFound } from "next/navigation";

interface Props {
  params: { id: string };
}

export default async function LeadDetailPage({ params }: Props) {
  const lead = await getLeadById(params.id);

  if (!lead) return notFound();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {lead.first_name} {lead.last_name}
        </h1>
        <p className="text-sm text-slate-400">
          {lead.email} • {lead.phone} • {lead.state}
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-1">
          <h2 className="text-xs font-semibold uppercase text-slate-400">
            Deal Snapshot
          </h2>
          <div className="text-sm">
            <span className="text-slate-400">Purpose:</span>{" "}
            {lead.loan_purpose}
          </div>
          <div className="text-sm">
            <span className="text-slate-400">Stage:</span> {lead.stage}
          </div>
          <div className="text-sm">
            <span className="text-slate-400">Score:</span>{" "}
            {lead.score ?? "N/A"}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 col-span-2 space-y-2">
          <h2 className="text-xs font-semibold uppercase text-slate-400">
            Fetti AI Summary
          </h2>
          <p className="text-sm whitespace-pre-line">
            {lead.ai_summary ||
              "No AI summary captured yet. Once your lead capture form pushes AI notes into Supabase, they will appear here."}
          </p>
        </div>
      </section>
    </div>
  );
}

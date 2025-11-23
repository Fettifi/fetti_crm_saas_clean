export default function PipelinePage() {
  const stages = [
    { name: "New", emoji: "🟢" },
    { name: "Contacted", emoji: "📞" },
    { name: "Qualified", emoji: "✅" },
    { name: "Proposal", emoji: "📄" },
    { name: "Won", emoji: "🏆" },
    { name: "Lost", emoji: "🕳️" }
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Pipeline Board</h2>
      <p className="text-xs text-slate-400 max-w-2xl">
        This is a placeholder Kanban-style view. You can wire this to Supabase using
        drag-and-drop and update the <code className="font-mono">stage</code> column
        on each lead.
      </p>
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        {stages.map((stage) => (
          <div
            key={stage.name}
            className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 flex flex-col gap-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold flex items-center gap-2">
                <span>{stage.emoji}</span>
                {stage.name}
              </span>
              <span className="text-xs text-slate-400">0</span>
            </div>
            <div className="h-24 rounded-lg border border-dashed border-slate-800 text-xs text-slate-500 flex items-center justify-center text-center px-2">
              Connect to Supabase to show leads in this stage.
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

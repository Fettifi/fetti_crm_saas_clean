export default function TeamPage() {
  const team = [
    { name: "Ramon Dent", role: "CEO · Loan Strategist", email: "ramon@fettifi.com" },
    { name: "Piaget Dent", role: "Senior Consultant", email: "piaget@fettifi.com" }
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Team</h2>
      <p className="text-xs text-slate-400 max-w-2xl">
        Later you can connect this to a <code className="font-mono">profiles</code> table in Supabase
        and manage users, roles, and routing by branch or territory.
      </p>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {team.map((member) => (
          <div
            key={member.email}
            className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold">{member.name}</div>
                <div className="text-xs text-slate-400">{member.role}</div>
              </div>
              <div className="h-9 w-9 rounded-full bg-slate-900 flex items-center justify-center text-sm">
                {member.name
                  .split(" ")
                  .map((p) => p[0])
                  .join("")}
              </div>
            </div>
            <div className="text-xs text-slate-300">{member.email}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

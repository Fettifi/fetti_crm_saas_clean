import React from "react";
import { LeadStatus, ApplicationStatus } from "@/lib/fettiSequences";

type Lead = {
  id: string;
  name?: string;
  email?: string;
  status: LeadStatus;
  created_at?: string;
};

type Application = {
  id: string;
  borrower?: string;
  loanType?: string;
  status: ApplicationStatus;
  updated_at?: string;
};

const sampleNewLeads: Lead[] = [
  {
    id: "L-1001",
    name: "Jane First-Time Buyer",
    email: "jane@example.com",
    status: LeadStatus.NEW,
    created_at: new Date().toISOString(),
  },
  {
    id: "L-1002",
    name: "Marcus DSCR Refi",
    email: "marcus@example.com",
    status: LeadStatus.NEW,
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

const sampleApplications: Application[] = [
  {
    id: "A-2001",
    borrower: "Jane First-Time Buyer",
    loanType: "FHA Purchase",
    status: ApplicationStatus.STARTED,
    updated_at: new Date().toISOString(),
  },
  {
    id: "A-2002",
    borrower: "Marcus DSCR Refi",
    loanType: "DSCR Refi",
    status: ApplicationStatus.IN_PROGRESS,
    updated_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "A-2003",
    borrower: "Kim Multi-Unit",
    loanType: "Conventional 4-Unit",
    status: ApplicationStatus.INCOMPLETE,
    updated_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "A-2004",
    borrower: "DJ Investor",
    loanType: "Bridge Loan",
    status: ApplicationStatus.SUBMITTED,
    updated_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

function statusPill(status: ApplicationStatus) {
  let label: string;
  switch (status) {
    case ApplicationStatus.STARTED:
      label = "Started";
      break;
    case ApplicationStatus.IN_PROGRESS:
      label = "In Progress";
      break;
    case ApplicationStatus.SUBMITTED:
      label = "Submitted";
      break;
    case ApplicationStatus.INCOMPLETE:
      label = "Incomplete";
      break;
    case ApplicationStatus.WITHDRAWN:
      label = "Withdrawn";
      break;
  }

  return (
    <span className="inline-flex items-center rounded-full border border-border/60 px-2 py-0.5 text-xs font-medium">
      {label}
    </span>
  );
}

export default function AutomationsPage() {
  const appsInProgress = sampleApplications.filter((app) =>
    [ApplicationStatus.STARTED, ApplicationStatus.IN_PROGRESS, ApplicationStatus.INCOMPLETE].includes(
      app.status
    )
  );

  const submittedApps = sampleApplications.filter(
    (app) => app.status === ApplicationStatus.SUBMITTED
  );

  return (
    <div className="space-y-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Automations</h1>
        <p className="text-sm text-muted-foreground">
          Fetti overview for new leads and live applications. (Clean-repo demo data only.)
        </p>
      </header>

      {/* New Leads (last 7 days) */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">New Leads (last 7 days)</h2>
          <span className="text-sm text-muted-foreground">
            Count: <span className="font-medium">{sampleNewLeads.length}</span>
          </span>
        </div>

        <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Created
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Name
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Email
                </th>
              </tr>
            </thead>
            <tbody>
              {sampleNewLeads.map((lead) => (
                <tr
                  key={lead.id}
                  className="border-b border-border/60 last:border-none"
                >
                  <td className="px-4 py-2 whitespace-nowrap">
                    {lead.created_at
                      ? new Date(lead.created_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {lead.name && lead.name.trim().length > 0
                      ? lead.name
                      : "Untitled lead"}
                  </td>
                  <td className="px-4 py-2">{lead.email || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Apps In Progress */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Apps In Progress</h2>
          <span className="text-sm text-muted-foreground">
            Count: <span className="font-medium">{appsInProgress.length}</span>
          </span>
        </div>

        <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Updated
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Borrower
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Loan Type
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {appsInProgress.map((app) => (
                <tr
                  key={app.id}
                  className="border-b border-border/60 last:border-none"
                >
                  <td className="px-4 py-2 whitespace-nowrap">
                    {app.updated_at
                      ? new Date(app.updated_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {app.borrower && app.borrower.trim().length > 0
                      ? app.borrower
                      : "Unnamed borrower"}
                  </td>
                  <td className="px-4 py-2">{app.loanType || "—"}</td>
                  <td className="px-4 py-2">{statusPill(app.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Submitted Apps */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Submitted Apps</h2>
          <span className="text-sm text-muted-foreground">
            Count: <span className="font-medium">{submittedApps.length}</span>
          </span>
        </div>

        <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Updated
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Borrower
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Loan Type
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {submittedApps.map((app) => (
                <tr
                  key={app.id}
                  className="border-b border-border/60 last:border-none"
                >
                  <td className="px-4 py-2 whitespace-nowrap">
                    {app.updated_at
                      ? new Date(app.updated_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {app.borrower && app.borrower.trim().length > 0
                      ? app.borrower
                      : "Unnamed borrower"}
                  </td>
                  <td className="px-4 py-2">{app.loanType || "—"}</td>
                  <td className="px-4 py-2">{statusPill(app.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

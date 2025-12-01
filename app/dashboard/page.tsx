"use client";

import Image from "next/image";
import { useState } from "react";

type TabId =
  | "dashboard"
  | "leads"
  | "pipeline"
  | "requests"
  | "automations"
  | "settings"
  | "team";

const TABS: { id: TabId; label: string; description: string }[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Matrix overview of leads, apps, and automation health.",
  },
  {
    id: "leads",
    label: "Leads",
    description: "All inbound leads flowing into the Fetti pipeline.",
  },
  {
    id: "pipeline",
    label: "Pipeline",
    description: "Stage-based pipeline view for deals in motion.",
  },
  {
    id: "requests",
    label: "Requests",
    description: "Loan requests, 1003s, and document tasks.",
  },
  {
    id: "automations",
    label: "Automations",
    description: "Sequences, triggers, and Fetti Doctor / Matrix flows.",
  },
  {
    id: "settings",
    label: "Settings",
    description: "Team, branding, and CRM configuration.",
  },
  {
    id: "team",
    label: "Team",
    description: "Agents, processors, and permissions.",
  },
];

function SidebarNav({
  activeTab,
  setActiveTab,
}: {
  activeTab: TabId;
  setActiveTab: (id: TabId) => void;
}) {
  return (
    <aside className="flex h-full w-60 flex-col border-r border-slate-800 bg-slate-950/80">
      {/* Logo + product */}
      <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg">
          {/* 64 x 64 logo */}
          <Image
            src="/fetti-logo.png"
            alt="Fetti"
            width={64}
            height={64}
            className="h-10 w-10 object-contain drop-shadow"
          />
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-semibold tracking-widest text-emerald-400">
            FETTI CRM
          </span>
          <span className="text-[11px] text-slate-400">
            We Do Money · Matrix
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-3 py-4 text-sm">
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={[
                "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-all",
                isActive
                  ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/50"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-100",
              ].join(" ")}
            >
              <span>{tab.label}</span>
              {isActive && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom meta */}
      <div className="border-t border-slate-800 px-4 py-3 text-[11px] text-slate-500">
        <div className="flex items-center justify-between">
          <span>Matrix: Online</span>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
        </div>
        <p className="mt-1 text-[10px] text-slate-600">
          Agent changes should respect this shell and branding.
        </p>
      </div>
    </aside>
  );
}

function StatCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string | number;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 shadow-sm">
      <span className="text-[11px] uppercase tracking-wide text-slate-500">
        {title}
      </span>
      <span className="mt-1 text-2xl font-semibold text-slate-50">
        {value}
      </span>
      <span className="mt-1 text-[11px] text-slate-500">{subtitle}</span>
    </div>
  );
}

function ActiveTabContent({ activeTab }: { activeTab: TabId }) {
  if (activeTab === "dashboard") {
    return (
      <>
        {/* Top stats row */}
        <section className="grid gap-3 md:grid-cols-3">
          <StatCard
            title="New Leads (7d)"
            value="—"
            subtitle="Matrix will wire this to live data."
          />
          <StatCard
            title="Apps In Progress"
            value="—"
            subtitle="STARTED · IN_PROGRESS · INCOMPLETE"
          />
          <StatCard
            title="Submitted Apps"
            value="—"
            subtitle="Ready for processing / funding."
          />
        </section>

        {/* Matrix workspace box */}
        <section className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 px-5 py-6 text-xs text-slate-400">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Matrix Workspace
          </div>
          <p className="text-xs text-slate-400">
            This area is reserved for future widgets: live lead tables,
            pipeline boards, automations timeline, and LOS views. Fetti Matrix
            agents should only add new components inside this box while keeping
            the outer shell layout, sidebar, and header intact.
          </p>
        </section>
      </>
    );
  }

  // Placeholder content for other tabs
  const label = TABS.find((t) => t.id === activeTab)?.label ?? "Tab";
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/50 px-5 py-6">
      <h2 className="text-sm font-semibold text-slate-50">{label}</h2>
      <p className="mt-2 text-xs text-slate-400">
        This is a placeholder view for the <span className="font-semibold">{label}</span>{" "}
        tab. Matrix / Fetti Wizard tasks can progressively replace this panel
        with live tables and workflows, without modifying the sidebar or
        layout shell.
      </p>
    </section>
  );
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const active = TABS.find((t) => t.id === activeTab)!;

  return (
    <div className="flex min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      {/* Sidebar */}
      <SidebarNav activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Main area */}
      <main className="flex min-h-screen flex-1 flex-col">
        {/* Top header */}
        <header className="border-b border-slate-800 px-6 py-4 md:px-10">
          <div className="mx-auto max-w-6xl">
            <h1 className="text-xl font-semibold text-slate-50 md:text-2xl">
              {active.label}
            </h1>
            <p className="mt-1 max-w-xl text-xs text-slate-400 md:text-sm">
              {active.description}
            </p>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 px-4 py-6 md:px-10">
          <div className="mx-auto max-w-6xl space-y-8">
            <ActiveTabContent activeTab={activeTab} />
          </div>
        </div>
      </main>
    </div>
  );
}

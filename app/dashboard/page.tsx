"use client";

import React, { useState } from "react";
import Image from "next/image";

type TabKey =
  | "overview"
  | "leads"
  | "requests"
  | "pipeline"
  | "automations"
  | "team"
  | "settings";

const tabs: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Dashboard" },
  { key: "leads", label: "Leads" },
  { key: "requests", label: "Requests" },
  { key: "pipeline", label: "Pipeline" },
  { key: "automations", label: "Automations" },
  { key: "team", label: "Team" },
  { key: "settings", label: "Settings" },
];

function Sidebar({
  activeTab,
  onTabChange,
}: {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}) {
  return (
    <aside className="hidden md:flex md:flex-col w-64 bg-[#020617] border-r border-slate-800">
      {/* Logo + brand */}
      <div className="px-6 py-6 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="relative h-9 w-9">
            <Image
              src="/fetti-logo.png"
              alt="Fetti Financial Services LLC"
              fill
              className="object-contain"
              priority
            />
          </div>
          <div>
            <div className="text-xs font-semibold text-emerald-400 leading-tight">
              Fetti SuperAgent
            </div>
            <div className="text-[11px] text-slate-400">We Do Money!!</div>
          </div>
        </div>
      </div>

      {/* Nav – acts like tabs, NOT page navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 text-sm">
        {tabs.map((item) => {
          const isActive = activeTab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onTabChange(item.key)}
              className={[
                "flex w-full items-center rounded-lg px-3 py-2 text-left transition",
                isActive
                  ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                  : "text-slate-300 hover:text-emerald-300 hover:bg-emerald-500/10",
              ].join(" ")}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-slate-800 text-[11px] text-slate-500">
        Fetti CRM • Fetti Financial Services LLC
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
  subtitle?: string;
}) {
  return (
    <div className="rounded-2xl bg-[#020617] border border-slate-800 px-5 py-4 flex flex-col gap-2">
      <div className="text-xs text-slate-400">{title}</div>
      <div className="text-2xl font-semibold text-slate-50">{value}</div>
      {subtitle && <div className="text-[11px] text-slate-500">{subtitle}</div>}
    </div>
  );
}

function OverviewPanel() {
  const totalLeads = 0;
  const inPipeline = 0;
  const funded = 0;

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Total Leads"
          value={totalLeads}
          subtitle="All leads currently stored in Fetti CRM."
        />
        <StatCard
          title="In Pipeline"
          value={inPipeline}
          subtitle="Leads currently in active stages."
        />
        <StatCard
          title="Funded"
          value={funded}
          subtitle="Successfully funded deals."
        />
      </section>

      <section className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 px-5 py-6 text-xs text-slate-500">
        Matrix workspace: overview widgets, charts, and KPIs live here without
        changing the shell layout.
      </section>
    </div>
  );
}

function PlaceholderPanel({ title }: { title: string }) {
  return (
    <section className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 px-5 py-6 text-xs text-slate-400">
      <div className="text-sm font-semibold text-slate-100 mb-2">{title}</div>
      <p>
        Matrix workspace for <span className="font-mono">{title}</span>.  
        Your agents / auto-features should add lists, tables, and flows here
        instead of changing the global layout.
      </p>
    </section>
  );
}

function ActiveTabContent({ activeTab }: { activeTab: TabKey }) {
  switch (activeTab) {
    case "overview":
      return <OverviewPanel />;
    case "leads":
      return <PlaceholderPanel title="Leads" />;
    case "requests":
      return <PlaceholderPanel title="Requests" />;
    case "pipeline":
      return <PlaceholderPanel title="Pipeline" />;
    case "automations":
      return <PlaceholderPanel title="Automations" />;
    case "team":
      return <PlaceholderPanel title="Team" />;
    case "settings":
      return <PlaceholderPanel title="Settings" />;
    default:
      return <OverviewPanel />;
  }
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  const activeLabel =
    tabs.find((t) => t.key === activeTab)?.label ?? "Dashboard";

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="flex-1 flex flex-col">
        {/* Top header */}
        <header className="border-b border-slate-800 px-6 md:px-10 py-5">
          <div className="max-w-6xl mx-auto">
            <h1 className="text-xl md:text-2xl font-semibold text-slate-50">
              {activeLabel}
            </h1>
            <p className="mt-1 text-xs md:text-sm text-slate-400 max-w-xl">
              This screen stays on /dashboard. The sidebar only changes the
              Matrix workspace content; it does not navigate away or reload
              the page.
            </p>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 px-4 md:px-10 py-6">
          <div className="max-w-6xl mx-auto space-y-8">
            <ActiveTabContent activeTab={activeTab} />
          </div>
        </div>
      </main>
    </div>
  );
}

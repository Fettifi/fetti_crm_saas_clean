"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";

// FETTI DASHBOARD SHELL – DO NOT BREAK
// This layout + sidebar + dark theme is the visual baseline.
// Matrix / feature agents MAY:
//   - Wire real data into the stat cards.
//   - Add widgets/sections INSIDE the main content area.
// MUST NOT:
//   - Remove the sidebar or top header.
//   - Replace the FETTI logo block or change the core colors.

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/requests", label: "Requests" },
  { href: "/automations", label: "Automations" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/team", label: "Team" },
  { href: "/settings", label: "Settings" },
];

function Sidebar() {
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

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 text-sm">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center rounded-lg px-3 py-2 text-slate-300 hover:text-emerald-300 hover:bg-emerald-500/10 transition"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-slate-800 text-[11px] text-slate-500">
        Fetti CRM • v0.3 • Live
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

export default function DashboardPage() {
  // For now these are static placeholders. Matrix will wire them to live data.
  const totalLeads = 0;
  const inPipeline = 0;
  const funded = 0;

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex">
      <Sidebar />

      <main className="flex-1 flex flex-col">
        {/* Top header */}
        <header className="border-b border-slate-800 px-6 md:px-10 py-5">
          <h1 className="text-xl md:text-2xl font-semibold text-slate-50">
            Dashboard
          </h1>
          <p className="mt-1 text-xs md:text-sm text-slate-400 max-w-xl">
            Overview of your Fetti CRM pipeline. Hook this up to Supabase
            analytics when you&apos;re ready.
          </p>
        </header>

        {/* Content */}
        <div className="flex-1 px-4 md:px-10 py-6">
          {/* Top stat cards row */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
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

          {/* Reserved space for future widgets */}
          <section className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 px-5 py-6 text-xs text-slate-500">
            Matrix workspace: future widgets (lead lists, pipeline boards,
            automations) should be added inside this area without changing the
            shell layout.
          </section>
        </div>
      </main>
    </div>
  );
}

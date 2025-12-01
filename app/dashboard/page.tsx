import React from "react";
import Link from "next/link";
import Image from "next/image";

// FETTI DESIGN LOCK:
// This dashboard layout + sidebar is the visual baseline.
// Feature agents MAY:
// - Add cards, widgets, and sections inside the main content.
// - Wire real data into the placeholders below.
// Feature agents MUST NOT:
// - Replace the overall dark theme and layout shell.
// - Remove the left sidebar or top header.
// - Remove or swap out the FETTI logo block.

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/leads", label: "Leads" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/requests", label: "Requests" },
  { href: "/settings", label: "Settings" },
];

function Sidebar() {
  return (
    <aside className="hidden md:flex md:flex-col w-64 bg-black/40 border-r border-slate-800">
      <div className="px-6 py-5 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="relative h-10 w-10">
            <Image
              src="/fetti-logo.png"
              alt="Fetti Financial Services LLC"
              fill
              className="object-contain"
              priority
            />
          </div>
          <div>
            <div className="text-[10px] tracking-[0.25em] uppercase text-emerald-400">
              FETTI FINANCIAL SERVICES LLC
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-50">
              Command Center
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Annuit Coeptis • We Do Money
            </div>
          </div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 text-sm">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center rounded-xl px-3 py-2 text-slate-300 hover:text-emerald-300 hover:bg-emerald-500/10 transition"
          >
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="px-4 py-4 border-t border-slate-800 text-[11px] text-slate-500">
        Session: Live • v0.3
      </div>
    </aside>
  );
}

type StatCardProps = {
  label: string;
  value: string;
  subtitle?: string;
};

function StatCard({ label, value, subtitle }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 flex flex-col gap-1">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="text-xl font-semibold text-slate-50">{value}</div>
      {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      <Sidebar />

      <main className="flex-1 flex flex-col">
        {/* Top header */}
        <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-50">
              Fetti Dashboard
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              High-level view of leads, pipeline, and apps in progress.
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <div className="rounded-full bg-emerald-500/10 text-emerald-300 text-[11px] px-3 py-1 border border-emerald-500/40">
              Live • Connected
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 px-4 sm:px-6 py-5 flex flex-col gap-5">
          {/* Top stat row */}
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              label="New leads (last 7 days)"
              value="—"
              subtitle="Matrix will wire this to real data."
            />
            <StatCard
              label="Apps in progress"
              value="—"
              subtitle="STARTED • IN_PROGRESS • INCOMPLETE"
            />
            <StatCard
              label="Submitted apps"
              value="—"
              subtitle="SUBMITTED"
            />
          </section>

          {/* Main panels */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Pipeline column */}
            <div className="lg:col-span-2 space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-slate-50">
                    Pipeline overview
                  </h2>
                  <span className="text-[11px] text-slate-500">
                    Matrix will replace this with live pipeline stats.
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-slate-400">
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase">New</span>
                    <span className="text-lg text-slate-50">—</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase">Contacted</span>
                    <span className="text-lg text-slate-50">—</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase">Engaged</span>
                    <span className="text-lg text-slate-50">—</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase">
                      Not qualified / Dead
                    </span>
                    <span className="text-lg text-slate-50">—</span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-slate-50">
                    Workboard
                  </h2>
                  <span className="text-[11px] text-slate-500">
                    Quick notes for upcoming matrix automations.
                  </span>
                </div>
                <ul className="space-y-2 text-xs text-slate-400">
                  <li>• Wire New Leads widget to Supabase leads table.</li>
                  <li>• Wire Apps In Progress widget to applications table.</li>
                  <li>• Add filters for loan type, channel, and stage.</li>
                </ul>
              </div>
            </div>

            {/* Activity column */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <h2 className="text-sm font-semibold text-slate-50 mb-3">
                  Recent activity
                </h2>
                <p className="text-xs text-slate-500">
                  Matrix can later populate this with live events
                  (new leads, app updates, tasks) without changing the shell.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <h2 className="text-sm font-semibold text-slate-50 mb-3">
                  Shortcuts
                </h2>
                <div className="flex flex-col gap-2 text-xs">
                  <Link
                    href="/apply"
                    className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-emerald-200 hover:bg-emerald-500/20 transition"
                  >
                    Start new application
                  </Link>
                  <Link
                    href="/leads"
                    className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-200 hover:bg-slate-800 transition"
                  >
                    View all leads
                  </Link>
                  <Link
                    href="/pipeline"
                    className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-200 hover:bg-slate-800 transition"
                  >
                    View pipeline board
                  </Link>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

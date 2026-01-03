'use client';

import Image from 'next/image';
import { useState } from 'react';
import NewLeadsWidget from '@/components/dashboard/NewLeadsWidget';
import AppsInProgressWidget from '@/components/dashboard/AppsInProgressWidget';
import SubmittedAppsWidget from '@/components/dashboard/SubmittedAppsWidget';
import AutomationsWidget from '@/components/dashboard/AutomationsWidget';
import ReferralStatsWidget from '@/components/dashboard/ReferralStatsWidget';
import ChatInterface from '@/components/apply/ChatInterface';
import AutomationHub from '@/components/dashboard/AutomationHub';
import RoadmapView from '@/components/dashboard/RoadmapView';
import TaskList from '@/components/dashboard/TaskList';
import AssistantInterface from '@/components/dashboard/AssistantInterface';
import ErrorBoundary from '@/components/ErrorBoundary';

type TabId =
  | 'dashboard'
  | 'leads'
  | 'pipeline'
  | 'requests'
  | 'automations'
  | 'settings'
  | 'team'
  | 'training'
  | 'task-list'
  | 'roadmap';

const TABS: { id: TabId; label: string; description: string }[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Matrix overview of leads, apps, and automation health.',
  },
  {
    id: 'leads',
    label: 'Leads',
    description: 'Matrix workspace for Lead tables, imports, and follow-up flows.',
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    description: 'Matrix workspace for pipeline stages, board views, and offer status.',
  },
  {
    id: 'requests',
    label: 'Requests',
    description: 'Matrix workspace for loan requests, 1003 exports, and LOS sync.',
  },
  {
    id: 'automations',
    label: 'Automations',
    description:
      'Matrix workspace for drip sequences, task automations, and AI agents.',
  },
  {
    id: 'settings',
    label: 'Settings',
    description:
      'Matrix workspace for settings. Agents should add tables and flows here instead of changing the global layout.',
  },
  {
    id: 'team',
    label: 'Team',
    description:
      'Matrix workspace for team members, roles, and routing rules.',
  },
  {
    id: 'training',
    label: 'Co Pilot',
    description:
      'Your dedicated AI co-pilot. Teach him, ask him to research, or plan your day.',
  },
  {
    id: 'task-list',
    label: 'Task List',
    description: 'Manage your daily tasks and to-dos.',
  },
  {
    id: 'roadmap',
    label: 'Roadmap',
    description:
      'The Master Plan. Rupee manages this vision board.',
  },
];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function StatCard(props: {
  title: string;
  value: string | number;
  subtitle?: string;
}) {
  const { title, value, subtitle } = props;
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-4 shadow-[0_0_0_1px_rgba(15,23,42,0.7)]">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
        {title}
      </p>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-slate-50">{value}</span>
      </div>
      {subtitle && (
        <p className="mt-2 text-[11px] text-slate-500">{subtitle}</p>
      )}
    </div>
  );
}

function ActiveTabContent({ activeTab }: { activeTab: TabId }) {
  if (activeTab === 'dashboard') {
    return (
      <>
        {/* Top stat row */}
        <section className="grid gap-4 md:grid-cols-3">
          <NewLeadsWidget />
          <AppsInProgressWidget />
          <SubmittedAppsWidget />
          <AutomationsWidget />
          <ReferralStatsWidget />
        </section>

        {/* Matrix workspace */}
        <section className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 px-5 py-6 text-xs text-slate-400">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Matrix workspace
          </p>
          <p className="mt-3 max-w-3xl leading-relaxed">
            This area is reserved for future widgets: live lead tables, pipeline
            boards, automations timeline, and LOS views. Fetti Matrix agents
            should only add new components inside this box while keeping the
            outer shell layout, sidebar, and header intact.
          </p>
        </section>
      </>
    );
  }

  // Non-dashboard tabs reuse the same Matrix workspace box,
  // but with different copy so the agent knows where to wire things.
  const tabCopy: Record<TabId, string> = {
    dashboard: '',
    leads:
      'Workspace for Leads. Matrix agents should add lead tables, filters, and import tools here.',
    pipeline:
      'Workspace for Pipeline. Matrix agents should add pipeline boards, Kanban views, and stage analytics here.',
    requests:
      'Workspace for Requests. Matrix agents should add request lists, 1003 exports, and LOS integrations here.',
    automations: '',
    settings:
      'Workspace for Settings. Agents should add configuration tables and flows here instead of changing layout.tsx or this shell.',
    team:
      'Workspace for Team. Matrix agents should add team rosters, permissions, and routing rules here.',
    training: '',
    'task-list': '',
    roadmap: '',
  };

  if (activeTab === 'training') {
    return (
      <div className="max-w-5xl mx-auto">
        <ErrorBoundary>
          <AssistantInterface />
        </ErrorBoundary>
      </div>
    );
  }

  if (activeTab === 'automations') {
    return (
      <div className="max-w-4xl">
        <AutomationHub />
      </div>
    );
  }

  if (activeTab === 'task-list') {
    return <TaskList />;
  }

  if (activeTab === 'roadmap') {
    return (
      <div className="max-w-4xl">
        <RoadmapView />
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 px-5 py-6 text-xs text-slate-400">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        Matrix workspace
      </p>
      <p className="mt-3 max-w-3xl leading-relaxed">{tabCopy[activeTab]}</p>
    </section>
  );
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');

  const active = TABS.find((t) => t.id === activeTab)!;

  return (
    <div className="flex min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      {/* Sidebar – stays fixed, never navigates away */}
      <aside className="flex w-60 flex-col border-r border-slate-900/80 bg-slate-950/95">
        {/* Brand block */}
        <div className="border-b border-slate-900/80 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-500/40 bg-emerald-950/70">
              <Image
                src="/fetti-logo.png"
                alt="Fetti CRM logo"
                width={64}
                height={64}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-0.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">
                FETTI CRM
              </p>
              <p className="text-xs font-medium text-slate-100">
                We Do Money · Matrix
              </p>
            </div>
          </div>
        </div>

        {/* Sidebar nav (local tab state only) */}
        <nav className="flex-1 space-y-1 px-3 py-3 text-sm">
          {TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cx(
                  'flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-colors',
                  isActive
                    ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/40'
                    : 'text-slate-300 hover:bg-slate-900/80 hover:text-slate-50'
                )}
              >
                <span>{tab.label}</span>
                {isActive && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Matrix status footer */}
        <div className="border-t border-slate-900/80 px-4 py-4 text-[11px] text-slate-500">
          <div className="flex items-center gap-3 rounded-xl bg-slate-900/50 p-3 border border-slate-800">
            <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Rupee</p>
              <p className="text-xs text-emerald-400">Online & Ready</p>
            </div>
          </div>
          <p className="mt-1 leading-snug mb-3">
            Agent changes should respect this shell, sidebar, and branding.
          </p>

          <button
            onClick={async () => {
              const { createBrowserClient } = await import('@supabase/ssr');
              const supabase = createBrowserClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
              );
              await supabase.auth.signOut();
              window.location.href = '/login';
            }}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-slate-400 transition hover:bg-red-950/30 hover:text-red-400 hover:border-red-900/50"
          >
            <span>Log Out</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" x2="9" y1="12" y2="12" /></svg>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex flex-1 flex-col">
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

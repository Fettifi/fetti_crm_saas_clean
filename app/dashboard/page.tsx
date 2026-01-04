'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import NewLeadsWidget from '@/components/dashboard/NewLeadsWidget';
import AppsInProgressWidget from '@/components/dashboard/AppsInProgressWidget';
import SubmittedAppsWidget from '@/components/dashboard/SubmittedAppsWidget';
import AutomationsWidget from '@/components/dashboard/AutomationsWidget';
import ReferralStatsWidget from '@/components/dashboard/ReferralStatsWidget';
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
    label: 'My Personal Assistant',
    description:
      'Your dedicated executive assistant. Teach her, ask her to research, or plan your day.',
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
  const pathname = usePathname();
  // Simple mapping for current path to TabId for sync
  const currentTab = TABS.find(t => pathname.includes(t.id))?.id || 'dashboard';
  const active = TABS.find((t) => t.id === currentTab)!;

  return (
    <AppLayout
      title={active.label}
      description={active.description}
    >
      <ActiveTabContent activeTab={currentTab} />
    </AppLayout>
  );
}


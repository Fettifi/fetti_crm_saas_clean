import React from 'react';
import NewLeadsWidget from '../../components/NewLeadsWidget';
import SubmittedAppsWidget from '../../components/SubmittedAppsWidget';

export default function DashboardPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Dashboard</h1>
        <p className="text-slate-300">
          Fetti SuperAgent is live and healthy.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <NewLeadsWidget />
        <SubmittedAppsWidget />
      </div>
    </div>
  );
}

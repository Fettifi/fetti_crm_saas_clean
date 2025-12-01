import React from 'react';

export default function NewLeadsWidget() {
  // TODO: Replace mock data with real data from your leads table.
  // For now this keeps the build 100% safe and lets us style the widget.
  const mockCount = 0;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="text-sm font-semibold text-slate-300">
        New Leads (last 7 days)
      </h2>
      <p className="mt-2 text-3xl font-bold text-emerald-400">
        {mockCount}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        This will show the real count of leads created in the last 7 days once we hook it to live data.
      </p>
    </div>
  );
}

import React from 'react';

const SubmittedAppsWidget: React.FC = () => {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="text-lg font-semibold text-white mb-2">
        Submitted Applications
      </h2>
      <p className="text-sm text-slate-400">
        Submitted apps widget is wired into the dashboard. Next step is to hook
        this up to the applications data source.
      </p>
    </div>
  );
};

export default SubmittedAppsWidget;

import { ApplicationStatus } from '@/lib/leadStatus';

interface Application {
    id: string;
    applicantName: string;
    status: ApplicationStatus;
    lastUpdated: string;
}

export default function AppsInProgressWidget() {
    const apps: Application[] = [
        { id: '101', applicantName: 'John Doe', status: 'STARTED', lastUpdated: new Date().toISOString() },
        { id: '102', applicantName: 'Jane Smith', status: 'IN_PROGRESS', lastUpdated: new Date(Date.now() - 3600000).toISOString() },
    ];

    return (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Apps In Progress</h3>
                <span className="bg-blue-500/10 text-blue-400 text-xs px-2 py-1 rounded-full font-medium">
                    {apps.length} Active
                </span>
            </div>
            <div className="space-y-3">
                {apps.length === 0 ? (
                    <p className="text-sm text-slate-500">No active applications.</p>
                ) : (
                    apps.map((app) => (
                        <div key={app.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-950/50 border border-slate-800/50 hover:border-slate-700 transition-colors">
                            <div>
                                <p className="text-sm font-medium text-slate-200">{app.applicantName}</p>
                                <p className="text-xs text-slate-500">Updated: {new Date(app.lastUpdated).toLocaleDateString()}</p>
                            </div>
                            <span className="text-xs font-medium text-blue-400 bg-blue-950/30 px-2 py-0.5 rounded">
                                {app.status.replace('_', ' ')}
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

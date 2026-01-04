import AppLayout from "@/components/AppLayout";

export default function RequestsPage() {
    return (
        <AppLayout
            title="Requests"
            description="Manage loan requests and 1003 exports."
        >
            <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center">
                <p className="text-slate-400">Requests Workspace</p>
            </div>
        </AppLayout>
    );
}

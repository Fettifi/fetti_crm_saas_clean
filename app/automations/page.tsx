import AppLayout from "@/components/AppLayout";
import AutomationHub from "@/components/dashboard/AutomationHub";

export default function AutomationsPage() {
    return (
        <AppLayout
            title="Automations"
            description="Drip sequences, task automations, and AI agents."
        >
            <div className="max-w-4xl">
                <AutomationHub />
            </div>
        </AppLayout>
    );
}

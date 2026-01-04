import AppLayout from "@/components/AppLayout";
import RoadmapView from "@/components/dashboard/RoadmapView";

export default function RoadmapPage() {
    return (
        <AppLayout
            title="Roadmap"
            description="The Master Plan. Rupee manages this vision board."
        >
            <div className="max-w-4xl">
                <RoadmapView />
            </div>
        </AppLayout>
    );
}

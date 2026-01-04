"use client";

import ChatInterface from "@/components/apply/ChatInterface";
import AppLayout from "@/components/AppLayout";

export default function TrainingPage() {
    return (
        <AppLayout
            title="Teach Frank"
            description="Train your digital twin. Speak or type rules, and Frank will memorize them forever."
        >
            <div className="mt-6">
                <ChatInterface />
            </div>
        </AppLayout>
    );
}


"use client";

import ChatInterface from "@/components/apply/ChatInterface";

export default function TrainingPage() {
    return (
        <div className="space-y-4">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">Teach Frank</h1>
                <p className="mt-1 text-sm text-slate-400">
                    Train your digital twin. Speak or type rules, and Frank will memorize them forever.
                </p>
            </div>

            <div className="mt-6">
                <ChatInterface />
            </div>
        </div>
    );
}

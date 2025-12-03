"use client";

import { useState } from "react";
import { Check, Zap, Mail, MessageSquare, Star, Clock } from "lucide-react";

type Automation = {
    id: string;
    title: string;
    description: string;
    icon: any;
    enabled: boolean;
};

export default function AutomationHub() {
    const [automations, setAutomations] = useState<Automation[]>([
        {
            id: "instant-reply",
            title: "Instant Lead Response",
            description: "Immediately send a welcome SMS & Email to new leads. 'Hi [Name], I'm reviewing your file...'",
            icon: Zap,
            enabled: true,
        },
        {
            id: "ghost-protocol",
            title: "The 'Ghost' Protocol",
            description: "Auto-follow up if a lead doesn't reply for 48 hours. Sends a 'Are you still looking?' text.",
            icon: Clock,
            enabled: true,
        },
        {
            id: "review-harvester",
            title: "Review Harvester",
            description: "Automatically email a Google Review link 24 hours after a deal is marked 'Closed'.",
            icon: Star,
            enabled: false,
        },
        {
            id: "birthday-wisher",
            title: "Birthday Wisher",
            description: "Send a personalized Happy Birthday email to past clients.",
            icon: Mail,
            enabled: false,
        },
    ]);

    const toggleAutomation = (id: string) => {
        setAutomations((prev) =>
            prev.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a))
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-white">Automation Center</h2>
                    <p className="text-sm text-slate-400">
                        Configure your digital workforce. Turn these on to put your business on autopilot.
                    </p>
                </div>
                <button className="rounded-lg bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition">
                    View Logs
                </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                {automations.map((auto) => (
                    <div
                        key={auto.id}
                        className={`relative overflow-hidden rounded-xl border p-5 transition-all ${auto.enabled
                                ? "border-emerald-500/30 bg-emerald-950/10"
                                : "border-slate-800 bg-slate-900/40 opacity-75"
                            }`}
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex gap-4">
                                <div
                                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${auto.enabled ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-800 text-slate-500"
                                        }`}
                                >
                                    <auto.icon className="h-5 w-5" />
                                </div>
                                <div>
                                    <h3 className={`font-medium ${auto.enabled ? "text-white" : "text-slate-300"}`}>
                                        {auto.title}
                                    </h3>
                                    <p className="mt-1 text-xs leading-relaxed text-slate-400">
                                        {auto.description}
                                    </p>
                                </div>
                            </div>

                            <button
                                onClick={() => toggleAutomation(auto.id)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${auto.enabled ? "bg-emerald-500" : "bg-slate-700"
                                    }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${auto.enabled ? "translate-x-6" : "translate-x-1"
                                        }`}
                                />
                            </button>
                        </div>

                        {auto.enabled && (
                            <div className="absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r from-emerald-500/0 via-emerald-500/50 to-emerald-500/0 opacity-50" />
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

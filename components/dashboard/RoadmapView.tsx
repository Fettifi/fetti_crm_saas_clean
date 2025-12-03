"use client";

import { useEffect, useState } from "react";

export default function RoadmapView() {
    const [content, setContent] = useState("Loading Roadmap...");

    useEffect(() => {
        fetch('/api/roadmap')
            .then(res => res.json())
            .then(data => setContent(data.content))
            .catch(err => setContent("Failed to load roadmap."));
    }, []);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-white">Fetti Roadmap</h2>
                    <p className="text-sm text-slate-400">
                        The Vision. Managed by Frank.
                    </p>
                </div>
                <button
                    onClick={() => window.location.reload()}
                    className="rounded-lg bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition"
                >
                    Refresh
                </button>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 font-mono text-sm text-slate-300 whitespace-pre-wrap">
                {content}
            </div>
        </div>
    );
}

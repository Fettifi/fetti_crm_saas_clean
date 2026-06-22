"use client";

import { ReactNode } from "react";

// Page header + content container. The sidebar + Back/menu top bar are provided
// globally by AppChrome (root layout), so this no longer renders its own
// Sidebar — that would double it up. It just lays out the page title and body
// inside AppChrome's main area.
interface AppLayoutProps {
    children: ReactNode;
    title: string;
    description?: string;
    fullWidth?: boolean;
}

export default function AppLayout({
    children,
    title,
    description,
    fullWidth = false,
}: AppLayoutProps) {
    return (
        <div className="flex min-h-full flex-col bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-slate-50">
            {/* Top header */}
            <header className="border-b border-slate-800 px-6 py-4 md:px-10 shrink-0">
                <div className="mx-auto max-w-6xl w-full">
                    <h1 className="text-xl font-semibold text-slate-50 md:text-2xl">
                        {title}
                    </h1>
                    {description && (
                        <p className="mt-1 max-w-xl text-xs text-slate-400 md:text-sm">
                            {description}
                        </p>
                    )}
                </div>
            </header>

            {/* Content */}
            <div className={`flex-1 overflow-y-auto px-4 py-6 md:px-10 ${fullWidth ? 'p-0 md:p-0' : ''}`}>
                <div className={`mx-auto w-full ${fullWidth ? '' : 'max-w-6xl space-y-8'}`}>
                    {children}
                </div>
            </div>
        </div>
    );
}

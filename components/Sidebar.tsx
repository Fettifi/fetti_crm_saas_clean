"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import CoPilot from "./CoPilot";

const navItems = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/leads", label: "Leads", icon: "📋" },
  { href: "/pipeline", label: "Pipeline", icon: "📈" },
  { href: "/team", label: "Team", icon: "👥" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
  { href: "/training", label: "Teach Frank", icon: "🧠" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [isCoPilotOpen, setIsCoPilotOpen] = useState(false);

  return (
    <>
      <aside className="hidden md:flex w-64 flex-col border-r border-slate-900/80 bg-slate-950/95 overflow-hidden">
        {/* Brand block */}
        <div className="border-b border-slate-900/80 px-4 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/40 bg-emerald-950/70">
              <Image
                src="/fetti-logo.png"
                alt="Fetti CRM logo"
                width={56}
                height={56}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400">
                FETTI CRM
              </p>
              <p className="text-xs font-semibold text-slate-100">
                Matrix Engine
              </p>
            </div>
          </div>
        </div>

        {/* Sidebar nav */}
        <nav className="flex-1 space-y-1 px-3 py-6">
          {navItems.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <li key={item.href} className="list-none">
                <Link
                  href={item.href}
                  className={`mx-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${active
                    ? "bg-slate-800 text-fetti-green font-medium border border-fetti-green/60"
                    : "text-slate-300 hover:bg-slate-900 hover:text-white"
                    }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-base">{item.icon}</span>
                    <span className="font-medium">{item.label}</span>
                  </div>
                  {active && (
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
                  )}
                </Link>
              </li>
            );
          })}
        </nav>

        {/* Co-Pilot Toggle Footer */}
        <div className="border-t border-slate-900/80 p-4">
          <button
            onClick={() => setIsCoPilotOpen(!isCoPilotOpen)}
            className={`group flex w-full flex-col gap-3 rounded-2xl border p-4 transition-all duration-300 ${isCoPilotOpen
              ? "border-emerald-500/50 bg-emerald-500/10 shadow-[0_0_20px_rgba(16,185,129,0.1)]"
              : "border-slate-800 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-900/60"
              }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">🤖</span>
                <span className={`text-[11px] font-bold uppercase tracking-wider ${isCoPilotOpen ? "text-emerald-400" : "text-slate-400"}`}>
                  Co-Pilot
                </span>
              </div>
              <div className={`h-2 w-2 rounded-full ${isCoPilotOpen ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
            </div>

            <div className="text-left">
              <p className="text-[10px] font-medium text-slate-200">Feddy Assistant</p>
              <p className="text-[9px] text-slate-500 mt-0.5 leading-tight">
                {isCoPilotOpen ? "Assistant active" : "Ready to optimize your workflow"}
              </p>
            </div>
          </button>
        </div>

        {/* Matrix status footer */}
        <div className="bg-slate-950 px-5 py-3 text-[10px] text-slate-600 border-t border-slate-900/50 text-center">
          <span className="font-mono uppercase tracking-widest opacity-50">Matrix System Online</span>
        </div>
      </aside>

      {/* Co-Pilot Portal */}
      {isCoPilotOpen && (
        <div className="fixed bottom-6 left-72 z-50 w-80 animate-in slide-in-from-left-4 duration-300">
          <CoPilot />
        </div>
      )}
    </>
  );
}

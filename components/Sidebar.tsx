import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { logActivity } from "@/lib/logger";

// Nav items matching the specialized screenshot
const navItems = [
  { href: "/rupee", label: "Rupee (AI Co-Founder)", icon: "🦉" },
  { href: "/command", label: "Command Center", icon: "⚡" },
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/leads", label: "Leads", icon: "📋" },
  { href: "/agents", label: "AI Agents", icon: "🧠" },
  { href: "/growth", label: "Lead-Gen Launchpad", icon: "🚀" },
  { href: "/content", label: "Content Studio", icon: "🎬" },
  { href: "/doctor", label: "CRM Doctor", icon: "🩺" },
  { href: "/los", label: "Loan Files (LOS)", icon: "📁" },
  { href: "/pricing", label: "Pricing Comparison", icon: "💲" },
  { href: "/preapprovals", label: "Pre-Approvals", icon: "📝" },
  { href: "/pipeline", label: "Pipeline", icon: "📈" },
  { href: "/partners", label: "Referral Partners", icon: "🤝" },
  { href: "/requests", label: "Requests", icon: "📥" },
  { href: "/automations", label: "Automations", icon: "⚡" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
  { href: "/team", label: "Team", icon: "👥" },
  { href: "/training", label: "My Personal Assistant", icon: "🤖" },
  { href: "/task-list", label: "Task List", icon: "✅" },
  { href: "/roadmap", label: "Roadmap", icon: "🗺️" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-64 flex-col border-r border-slate-900/80 bg-slate-950/95 overflow-hidden">
      {/* Brand block */}
      <div className="border-b border-slate-900/80 px-4 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-950/30">
            <Image
              src="/fetti-logo.png"
              alt="Fetti CRM"
              width={40}
              height={40}
              className="rounded-lg"
            />
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400">
              FETTI CRM
            </p>
            <p className="text-[10px] font-semibold text-slate-400">
              We Do Money • Matrix
            </p>
          </div>
        </div>
      </div>

      {/* Sidebar nav */}
      <nav className="flex-1 space-y-0.5 px-3 py-6 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
        {navItems.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => logActivity('navigate_sidebar', { destination: item.href, label: item.label })}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs transition-all duration-200 ${active
                ? "bg-slate-800/80 text-emerald-400 font-medium border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]"
                : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                }`}
            >
              {/* Active Indicator Dot */}
              {active && (
                <span className="absolute left-0 h-5 w-0.5 rounded-r-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
              )}

              <span className={`text-base ${active ? "scale-110" : "opacity-70 group-hover:scale-110 group-hover:opacity-100"} transition-transform`}>
                {item.icon}
              </span>
              <span>{item.label}</span>

              {active && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_5px_rgba(16,185,129,0.6)]" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer / User Profile */}
      <div className="p-4 border-t border-slate-900/80 bg-slate-950">
        <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-3 space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-emerald-950/50 border border-emerald-500/20 flex items-center justify-center relative">
              <div className="h-2 w-2 rounded-full bg-emerald-500 absolute bottom-0 right-0 shadow-[0_0_5px_rgba(16,185,129,0.5)] border border-slate-900" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-200">Rupee</p>
              <p className="text-[10px] text-emerald-500/80 font-medium">Online & Ready</p>
            </div>
          </div>

          <div className="text-[9px] text-slate-500 leading-relaxed px-1">
            Agent changes should respect this shell, sidebar, and branding.
          </div>

          <button
            onClick={() => logActivity('logout')}
            className="flex w-full items-center justify-between text-[10px] text-slate-400 hover:text-slate-200 py-1.5 px-2 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <span>Log Out</span>
            <LogOut size={12} />
          </button>
        </div>
      </div>
    </aside>
  );
}

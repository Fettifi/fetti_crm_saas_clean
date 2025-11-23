"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Pipeline, Users, Settings, FileText } from "lucide-react";

const nav = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/leads", label: "Leads", icon: Pipeline },
  { href: "/pipeline", label: "Pipeline", icon: FileText },
  { href: "/team", label: "Team", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-64 flex-col border-r border-slate-800 bg-slate-950/80">
      <div className="px-4 py-5 border-b border-slate-800 flex items-center gap-2">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-fettiGreen to-fettiGold flex items-center justify-center font-black text-slate-950">
          F
        </div>
        <div>
          <div className="text-sm font-semibold tracking-wide">Fetti CRM</div>
          <div className="text-xs text-slate-400">We Do Money.</div>
        </div>
      </div>
      <nav className="flex-1 py-4">
        <ul className="space-y-1">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`mx-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                    active
                      ? "bg-slate-800 text-fettiGold"
                      : "text-slate-300 hover:bg-slate-900 hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="px-4 py-4 border-t border-slate-800 text-xs text-slate-500">
        © {new Date().getFullYear()} Fetti Financial Services
      </div>
    </aside>
  );
}

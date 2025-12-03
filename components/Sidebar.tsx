"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

  return (
    <aside className="hidden md:flex w-64 flex-col border-r border-slate-800 bg-slate-950/80">
      <div className="px-6 py-6 border-b border-slate-800 flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-fetti-green to-fetti-gold flex items-center justify-center text-black font-black text-xl">
          F
        </div>
        <div>
          <div className="text-sm font-semibold tracking-wide">Fetti CRM</div>
          <div className="text-xs text-slate-400">We Do Money.</div>
        </div>
      </div>

      <nav className="flex-1 py-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`mx-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${active
                      ? "bg-slate-800 text-fetti-green font-medium border border-fetti-green/60"
                      : "text-slate-300 hover:bg-slate-900 hover:text-white"
                    }`}
                >
                  <span className="h-4 w-4">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const navItems = [
  { href: "/", label: "Dashboard", icon: "🏠" },
  { href: "/leads", label: "Leads", icon: "📋" },
  { href: "/pipeline", label: "Pipeline", icon: "📈" },
  { href: "/team", label: "Team", icon: "👥" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <aside className="hidden md:flex md:w-64 flex-col border-r border-slate-800 bg-slate-900/90 fetti-gradient">
      <div className="px-6 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-slate-950/80 flex items-center justify-center text-2xl">
            💸
          </div>
          <div>
            <div className="text-sm font-semibold tracking-wide">Fetti CRM</div>
            <div className="text-[11px] text-slate-400">We Do Money.</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname?.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                active
                  ? "bg-slate-900 text-fettiGreen border border-fettiGreen/40"
                  : "text-slate-300 hover:bg-slate-800 hover:text-slate-50",
              ].join(" ")}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-slate-800">
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 hover:text-red-300 hover:border-red-400 transition"
        >
          <span>🚪</span>
          <span>Log out</span>
        </button>
      </div>
    </aside>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  label: string;
  href: string;
};

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/" },
  { label: "Leads", href: "/leads" },
  { label: "Pipeline", href: "/pipeline" },
  { label: "Team", href: "/team" },
  { label: "Settings", href: "/settings" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 shrink-0 border-r border-slate-800 bg-slate-950/90 text-slate-100 flex flex-col">
      {/* Brand header */}
      <div className="p-4 border-b border-slate-800">
        <div className="text-xl font-bold">Fetti CRM</div>
        <div className="text-xs text-slate-400">WE DO MONEY.</div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "flex items-center rounded-md px-3 py-2 text-sm transition",
                active
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/60",
              ].join(" ")}
            >
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

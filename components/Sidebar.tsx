"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { ReactNode } from "react";

type SidebarProps = {
  children: ReactNode;
};

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/leads", label: "Leads" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/team", label: "Team" },
  { href: "/settings", label: "Settings" },
];

export default function Sidebar({ children }: SidebarProps) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      {/* LEFT SIDEBAR */}
      <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col">
        {/* LOGO + TEXT HEADER */}
        <div className="flex flex-col items-center gap-2 px-4 py-6">
          <div className="flex items-center justify-center h-[72px] w-[72px]">
            <Image
              src="/fetti-logo.png"
              alt="Fetti Financial Services"
              width={72}
              height={72}
              className="rounded-md object-contain"
              priority
            />
          </div>

          <div className="text-center leading-tight">
            <div className="text-lg font-bold tracking-wide">FETTI CRM</div>
            <div className="text-xs text-slate-400 uppercase">
              Financial Services LLC
            </div>
            <div className="text-[10px] text-slate-500 tracking-wide">
              Annuit Coeptis · We Do Money
            </div>
          </div>
        </div>

        {/* NAV LINKS */}
        <nav className="flex-1 px-2 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/40"
                    : "text-slate-300 hover:bg-slate-800/80 hover:text-white",
                ].join(" ")}
              >
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* BOTTOM FOOTER TEXT */}
        <div className="px-4 py-4 text-[10px] text-slate-500 border-t border-slate-800">
          Fetti CRM · © {new Date().getFullYear()}
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 bg-slate-950">{children}</main>
    </div>
  );
}

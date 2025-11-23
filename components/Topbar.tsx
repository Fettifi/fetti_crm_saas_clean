"use client";

import { usePathname } from "next/navigation";

function titleFromPath(pathname: string | null): string {
  if (!pathname || pathname === "/") return "Dashboard";
  const clean = pathname.replace(/^\/+/, "");
  return clean
    .split("/")[0]
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Topbar() {
  const pathname = usePathname();
  const title = titleFromPath(pathname);

  return (
    <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950/70 px-4 py-3 md:px-6">
      <div>
        <h1 className="text-lg md:text-xl font-semibold">{title}</h1>
        <p className="text-xs text-slate-400">
          Fetti CRM · Investment & Refi Lead Engine
        </p>
      </div>
      <div className="flex items-center gap-3 text-xs">
        <span className="hidden sm:inline text-slate-400">Logged in as</span>
        <span className="rounded-full bg-slate-900 px-3 py-1 text-slate-100">
          info@fettifi.com
        </span>
      </div>
    </header>
  );
}

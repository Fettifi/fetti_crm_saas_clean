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

export function Sidebar() {   // <-- named export
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <aside className="hidden md:flex md:w-64 flex-col border-r border-slate-800 bg-slate-900/90 fetti-gradient">
      {/* ...rest of your sidebar JSX... */}
    </aside>
  );
}

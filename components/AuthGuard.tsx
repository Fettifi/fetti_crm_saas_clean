"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

interface Props {
  children: ReactNode;
}

export default function AuthGuard({ children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data.session;

        // If not authenticated and not already on /login, redirect
        if (!session && pathname !== "/login") {
          const next = encodeURIComponent(pathname || "/");
          router.replace(`/login?next=${next}`);
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    check();

    // Optional: keep session fresh
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, _session) => {
      // You can add logic here if you want to react to sign-out, etc.
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router, pathname]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-xs text-slate-300">
          Checking your session…
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

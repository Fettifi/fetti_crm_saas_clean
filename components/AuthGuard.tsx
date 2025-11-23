"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

interface Props {
  children: ReactNode;
}

const PUBLIC_ROUTES = ["/login", "/reset-password", "/reset-password/update"];

export default function AuthGuard({ children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        // If it’s a public route, don’t block it
        if (pathname && PUBLIC_ROUTES.some((p) => pathname.startsWith(p))) {
          return;
        }

        const { data } = await supabase.auth.getSession();
        const session = data.session;

        if (!session && pathname !== "/login") {
          const next = encodeURIComponent(pathname || "/");
          router.replace(`/login?next=${next}`);
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    check();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, _session) => {
      // could react to sign-out here if needed
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router, pathname]);

  if (checking) {
    // Keep this light loading state so app doesn’t flash
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

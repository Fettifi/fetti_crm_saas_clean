"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { supabase } from "@/lib/supabaseClient";

type Props = {
  children: ReactNode;
};

export default function AuthGuard({ children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  const isPublicRoute = pathname === "/login";

  useEffect(() => {
    if (isPublicRoute) {
      // Login page is always allowed
      setChecking(false);
      return;
    }

    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;

      if (!data.session) {
        router.replace("/login");
      } else {
        setChecking(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [isPublicRoute, router]);

  // Login route: just render
  if (isPublicRoute) {
    return <>{children}</>;
  }

  // While we check the session, show a simple loading screen
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
        <div className="text-lg animate-pulse">Checking your session…</div>
      </div>
    );
  }

  return <>{children}</>;
}

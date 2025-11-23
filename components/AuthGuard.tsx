"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const PUBLIC_ROUTES = [
  "/login",
  "/reset-password",
  "/apply",
  "/auth/callback",
];

function isPublicRoute(pathname: string | null) {
  if (!pathname) return true;
  return PUBLIC_ROUTES.some((route) => {
    if (route.endsWith("/*")) {
      const base = route.replace("/*", "");
      return pathname.startsWith(base);
    }
    return pathname === route;
  });
}

type Props = {
  children: React.ReactNode;
};

export default function AuthGuard({ children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [initialLoading, setInitialLoading] = useState(true);
  const [session, setSession] = useState<any | null>(null);

  const publicRoute = isPublicRoute(pathname);

  useEffect(() => {
    let isMounted = true;

    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!isMounted) return;

      setSession(data.session ?? null);
      setInitialLoading(false);

      // If user is not logged in and on a protected route → send to /login
      if (!data.session && !publicRoute) {
        router.replace("/login");
      }

      // If user IS logged in and on a public auth route → send to dashboard
      if (data.session && publicRoute && pathname === "/login") {
        router.replace("/");
      }
    };

    checkSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!isMounted) return;

      setSession(newSession);

      const isPublic = isPublicRoute(pathname);

      if (!newSession && !isPublic) {
        router.replace("/login");
      }

      if (newSession && isPublic && pathname === "/login") {
        router.replace("/");
      }
    });

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, [router, pathname, publicRoute]);

  // Public routes (login, reset-password, etc.) should always render
  if (publicRoute) {
    return <>{children}</>;
  }

  // Protected routes: while we’re checking the session, show loader
  if (initialLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-200 text-sm">
        Checking your session...
      </div>
    );
  }

  // If no session after check, AuthGuard will have redirected already.
  // Just render children here.
  return <>{children}</>;
}

"use client";

import React from "react";

type AuthGuardProps = {
  children: React.ReactNode;
};

/**
 * TEMP STUB:
 * - No Supabase
 * - No redirects
 * - No cookies
 * Just render children so nothing can crash on the server.
 */
export default function AuthGuard({ children }: AuthGuardProps) {
  return <>{children}</>;
}

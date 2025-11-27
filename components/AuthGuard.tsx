"use client";

import React from "react";

type AuthGuardProps = {
  children: React.ReactNode;
};

/**
 * TEMPORARY STUB:
 * - No Supabase
 * - No env vars
 * - No redirects
 * Just renders children so we can stop 500 errors in production.
 */
export default function AuthGuard({ children }: AuthGuardProps) {
  return <>{children}</>;
}

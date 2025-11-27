"use client";

import React from "react";

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * TEMPORARY GUARD:
 * We are disabling the session check because the production site
 * is hanging on "Checking your session...".
 *
 * Once auth is fully stable, we can reintroduce proper checks here.
 */
export default function AuthGuard({ children }: AuthGuardProps) {
  return <>{children}</>;
}

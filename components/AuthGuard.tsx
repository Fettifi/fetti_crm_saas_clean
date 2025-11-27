"use client";

import { ReactNode } from "react";

export type AuthGuardProps = {
  children: ReactNode;
};

/**
 * TEMPORARY AUTH GUARD
 * --------------------
 * For now, we allow all users through without checking the session.
 * This removes the "Checking your session..." hang in production.
 *
 * Once auth is fully stable, we can reintroduce proper checks here.
 */

// Named export (matches: import { AuthGuard } from "@/components/AuthGuard")
export function AuthGuard({ children }: AuthGuardProps) {
  return <>{children}</>;
}

// Default export (matches: import AuthGuard from "@/components/AuthGuard")
export default AuthGuard;

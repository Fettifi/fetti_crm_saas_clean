"use client";

import { ReactNode } from "react";

type AuthGuardProps = {
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
export default function AuthGuard({ children }: AuthGuardProps) {
  return <>{children}</>;
}

"use client";

import { ReactNode } from "react";

type AuthGuardProps = {
  children: ReactNode;
};

/**
 * TEMPORARY NO-OP AUTH GUARD
 * This just renders children as-is.
 * We'll reintroduce real Supabase auth checks once the app is stable.
 */
export default function AuthGuard({ children }: AuthGuardProps) {
  return <>{children}</>;
}

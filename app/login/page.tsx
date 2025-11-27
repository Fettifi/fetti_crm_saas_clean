"use client";

import { Suspense } from "react";
import LoginPageInner from "./LoginPageInner";

/**
 * Wrapper page for /login
 *
 * Next.js 15 requires useSearchParams() and similar hooks
 * to be rendered inside a <Suspense> boundary.
 *
 * The real login logic lives in LoginPageInner. We just
 * wrap it here so the build can succeed.
 */
export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center text-white">
          Loading login...
        </div>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}

import type { NextRequest } from "next/server";

/**
 * TEMPORARY: disable all middleware logic while we stabilize login.
 */
export function middleware(_req: NextRequest) {
  return;
}

// Empty matcher so this effectively does nothing.
export const config = {
  matcher: [],
};

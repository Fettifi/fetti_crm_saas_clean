"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The Command Center now lives as an in-page tab on the dashboard (/?tab=command).
// This page is kept as a redirect so existing deep links to /command still work.
export default function CommandRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/?tab=command");
  }, [router]);
  return null;
}

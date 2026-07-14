"use client";

// This page was merged into /settings as the "Security (MFA)" tab. Kept as a
// redirect so existing deep links to /security still land on the right place.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SecurityRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings?tab=security");
  }, [router]);
  return null;
}

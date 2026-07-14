"use client";

// The Paid Ads Launch Kit was merged into /growth as the "ads" tab.
// This page now redirects so existing deep links keep working.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/growth?tab=ads");
  }, [router]);
  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <p className="text-slate-400 text-sm">Redirecting to the Lead-Gen Launchpad…</p>
    </div>
  );
}

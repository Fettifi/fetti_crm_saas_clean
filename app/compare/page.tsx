"use client";

// Loan Comparison has been merged into the Scenario Desk as a tab.
// Keep this route as a redirect so existing deep links still work.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function ComparePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/scenarios?tab=compare");
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-500 flex items-center justify-center">
      <Loader2 className="w-5 h-5 animate-spin" />
    </div>
  );
}

// Public share page: fettifi.com/refer/<code>. A member's personal hub to share
// Fetti. The link they share (fettifi.com/r/<code>) attributes referees back to
// them. No login — built to be opened and shared from a phone.
import type { Metadata } from "next";
import ReferShare from "@/components/ReferShare";
import { LICENSING_NOTE } from "@/lib/legal";

export const metadata: Metadata = { title: "Share Fetti — refer a friend", robots: { index: false } };

export default async function ReferPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const clean = String(code || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12).toUpperCase() || "FETTI";

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="max-w-md mx-auto px-5 py-12 text-center">
        <img src="/fetti-logo.png" alt="Fetti Financial Services LLC" width={160} height={48} className="h-11 w-auto mx-auto" />
        <h1 className="text-3xl font-extrabold tracking-tight mt-8">Know someone who needs a loan?</h1>
        <p className="text-slate-600 mt-3 text-lg">Send them your link and we&apos;ll take great care of them — a nonbank lender that funds home, investment, and business loans directly. They get a specialist who actually picks up the phone.</p>

        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 mt-7 text-left">
          <div className="text-xs uppercase tracking-wide text-emerald-700 font-semibold mb-2">Your personal link</div>
          <ReferShare code={clean} />
        </div>

        <p className="text-xs text-slate-500 mt-5">Every friend who uses your link is connected straight to Fetti and tracked back to you. No credit pull for them to start.</p>
        <p className="text-[10px] text-slate-400 mt-8 leading-relaxed">{LICENSING_NOTE}</p>
      </div>
    </div>
  );
}

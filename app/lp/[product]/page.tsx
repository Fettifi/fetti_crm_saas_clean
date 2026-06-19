// Generic paid landing page — one per product (/lp/dscr, /lp/cash-out-refi, …).
// Server-rendered (content in the HTML for instant paint + Ads Quality Score),
// statically generated per product. The inline form is the only client island.
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { LP_CONFIGS, LP_SLUGS } from "@/lib/lpConfigs";
import { LICENSING_NOTE } from "@/lib/legal";
import LeadForm from "@/components/lp/LeadForm";
import ExitCapture from "@/components/lp/ExitCapture";
import { SocialProofWall } from "@/components/SocialProofWall";

export const dynamicParams = false; // only the configured products exist; others 404
export const revalidate = 600; // ISR so fresh proof appears without a redeploy
export function generateStaticParams() { return LP_SLUGS.map((product) => ({ product })); }

export async function generateMetadata({ params }: { params: Promise<{ product: string }> }): Promise<Metadata> {
  const { product } = await params;
  const c = LP_CONFIGS[product];
  if (!c) return { title: "Fetti Financial Services" };
  return { title: `${c.headline} ${c.accent} | Fetti Financial Services`, description: c.subhead, robots: { index: false } };
}

export default async function LandingPage({ params }: { params: Promise<{ product: string }> }) {
  const { product } = await params;
  const c = LP_CONFIGS[product];
  if (!c) notFound();

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-5 py-3 flex items-center justify-between">
          <img src="/fetti-logo.png" alt="Fetti Financial Services LLC" width={130} height={40} className="h-9 w-auto" />
          <span className="text-xs text-slate-500 hidden sm:block">Licensed lender &amp; broker · NMLS #2267023</span>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-5 py-8 lg:py-14 grid lg:grid-cols-2 gap-10 items-start">
        <div>
          <div className="inline-flex items-center gap-1.5 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1 text-xs font-semibold">{c.badge}</div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mt-4 leading-tight">{c.headline} <span className="text-emerald-600">{c.accent}</span></h1>
          <p className="text-slate-600 text-lg mt-4">{c.subhead}</p>
          <div className="mt-6 space-y-2.5">
            {c.bullets.map((b, i) => <div key={i} className="flex items-start gap-2 text-slate-700"><span>{b}</span></div>)}
          </div>
          {c.statesNote && <p className="text-xs text-slate-400 mt-4">{c.statesNote}</p>}
          <div className="mt-7 flex items-center gap-3">
            <img src="/mark-golden-owl-512.png" alt="Mark, the all-knowing Fetti owl" width={56} height={56} className="w-12 h-12" />
            <p className="text-sm text-slate-600 italic">&quot;{c.markLine}&quot;</p>
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 lg:p-7 shadow-sm lg:sticky lg:top-6">
          <LeadForm config={c} />
        </div>
      </div>

      <SocialProofWall variant="compact" max={2} heading="Funded, and they'd tell you so." />

      <ExitCapture slug={product} />

      <footer className="border-t border-slate-100 mt-6">
        <div className="max-w-5xl mx-auto px-5 py-6">
          <p className="text-[10px] text-slate-400 leading-relaxed">{LICENSING_NOTE}</p>
        </div>
      </footer>
    </div>
  );
}

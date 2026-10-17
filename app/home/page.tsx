import Link from "next/link";
import {
  Home as HomeIcon, RefreshCw, Building2, TrendingUp, Zap, Briefcase, Landmark,
  CheckCircle2, ArrowRight, ShieldCheck, Headphones, Sparkles, BadgeCheck, Lock,
  Scale, Rocket, Award, HeartHandshake, X,
} from "lucide-react";
import { LICENSING_NOTE } from "@/lib/legal";
import { indexableGuides } from "@/lib/seoIndexable";
import { PRODUCTS } from "@/lib/lendingProducts";
import { stateLabel } from "@/lib/lendingMatrix";
import { ORGANIZATION, WEBSITE } from "@/lib/seo/schema";
import { CediBubble } from "@/components/CediBubble";
import { CediVoice } from "@/components/CediVoice";
import { SiteHeader } from "@/components/SiteHeader";
import HeroCapture from "@/components/HeroCapture";
import { Section, Well } from "@/components/site/Ledger";
import { SocialProofWall } from "@/components/SocialProofWall";

// ISR: keep the static speed of the marketing homepage but let newly approved
// client wins / fresh Google reviews surface within ~10 minutes.
export const revalidate = 600;

export const metadata = {
  title: "Fetti Financial Services LLC | Home, Investment & Business Lending",
  description:
    "Fetti Financial Services LLC — a mortgage lender and broker (NMLS #2267023) built for the way you actually earn. Self-employed, commissioned, investing, or buying your first place. Pre-qualify in 2 minutes, no credit impact.",
  alternates: { canonical: "https://fettifi.com" },
};

// Investment & business programs are nationwide → link to the "…in the U.S." page
// (state "usa"). Home loans are FL/MI/CA-only → link to Florida.
const CATEGORIES = [
  {
    title: "Home Loans",
    tag: "Owner-occupied · FL, MI, CA",
    blurb: "Buy or refinance the home you live in. Conventional, FHA & VA.",
    state: "florida",
    items: [
      { icon: HomeIcon, name: "Home Purchase", desc: "Conventional, FHA & VA options for primary residences.", slug: "home-purchase-loans" },
      { icon: RefreshCw, name: "Refinance & Cash-Out", desc: "Lower your rate or tap the equity in your home.", slug: "refinance-loans" },
    ],
  },
  {
    title: "Investment Loans",
    tag: "All 50 states",
    blurb: "Financing engineered for serious real-estate investors.",
    state: "usa",
    items: [
      { icon: Building2, name: "DSCR Rental Loans", desc: "Qualify on the property's cash flow. No W-2 or tax returns.", slug: "dscr-loans" },
      { icon: TrendingUp, name: "Fix & Flip", desc: "Purchase + rehab capital to move fast on deals.", slug: "fix-and-flip-loans" },
      { icon: Zap, name: "Bridge / Hard Money", desc: "Close in days when timing is everything.", slug: "hard-money-loans" },
    ],
  },
  {
    title: "Business Loans",
    tag: "All 50 states",
    blurb: "Capital to start, run, and scale your business.",
    state: "usa",
    items: [
      { icon: Briefcase, name: "Working Capital & Term Loans", desc: "Flexible funding for operations and growth.", slug: "business-loans" },
      { icon: Landmark, name: "Commercial Real Estate & SBA", desc: "Owner-user, investment CRE, and SBA programs.", slug: "commercial-real-estate-loans" },
    ],
  },
];

// The in-depth program guides, resolved from the SAME array the sitemap and robots.txt read
// (lib/seoIndexable.ts), so a slug added there lights up here automatically and this can never
// drift back out of sync.
//
// Why this section exists: every one of the seven /lending links in CATEGORIES above resolves to
// a `noindex, follow` page, so before this the homepage — the highest-authority URL on the domain
// — passed 100% of its lending link equity to pages that cannot rank, and the pages that CAN rank
// received no homepage link at all. The category cards are deliberately left pointing where they
// were: a card tagged "All 50 states" must not send a Texas investor to a Florida page merely to
// move equity around. So the guides get their own row, with anchors that say what the page is.
const GUIDES = indexableGuides().map((slug) => {
  const i = slug.lastIndexOf("-");
  const product = slug.slice(0, i);
  const label = stateLabel(slug.slice(i + 1));
  return {
    slug,
    // Anchor text carries the query wording ("DSCR Loans in Florida"), not a bare state name.
    title: `${PRODUCTS[product]?.label ?? product} in ${label}`,
    blurb: PRODUCTS[product]?.blurb ?? "",
  };
});

const STATS = [
  { value: "Low/$0 down", label: "FHA, VA & USDA + down payment help" },
  { value: "All 50", label: "States. Investment & business" },
  { value: "Turned down?", label: "We figure out how to get it done" },
  { value: "2 min", label: "To pre-qualify · no credit pull" },
];

// The contrast, with no competitor named. Ramon, 2026-10-13: "Lead with the borrower, don't mention
// banks at all." The left column is a PROCESS, not a company — we can describe a template honestly
// without asserting what any named institution would have done with this visitor's file.
const CONTRAST = [
  { them: "One menu, and you fit it or you don't", us: "Programs matched to your scenario, not the other way round" },
  { them: "You are a file in a queue", us: "A named person on your file who answers the phone" },
  { them: "Branch hours, hold music, hand-offs", us: "One specialist, your phone, California-fast" },
  { them: "Income has to arrive on two W-2s", us: "Built for income that arrives any other way" },
];

const AUDIENCE = [
  { icon: HomeIcon, title: "Homebuyers & families", desc: "First-time or move-up. We make the biggest purchase of your life feel handled." },
  { icon: TrendingUp, title: "Real-estate investors", desc: "DSCR, flips, bridge, BRRRR. Financing built to scale a portfolio, not slow it down." },
  { icon: Briefcase, title: "Self-employed & 1099", desc: "Bank statements over tax returns. We speak entrepreneur because we are one." },
  { icon: Landmark, title: "Business owners", desc: "Working capital, CRE, SBA. Capital to start, run, and grow." },
];

const STEPS = [
  { n: "01", icon: Sparkles, title: "Tell us your goal", desc: "Two-minute pre-qualification. Purchase, refinance, investment, or business. No credit pull to start." },
  { n: "02", icon: Headphones, title: "A specialist reaches out", desc: "A real loan expert reviews your scenario and maps the path — including the ones that take more than a template." },
  { n: "03", icon: BadgeCheck, title: "Get funded", desc: "We move fast, keep you updated at every step, and get you to the closing table." },
];

const WHY = [
  { icon: ShieldCheck, title: "Compliance in our DNA", desc: "Shaped by years in heavily-regulated industries. We do it right. Every file, every time." },
  { icon: Rocket, title: "California-fast", desc: "Bridge and hard-money options close in days. Pre-qualification takes minutes." },
  { icon: Scale, title: "We work for you", desc: "Your scenario is the starting point, and our job is finding the program that fits it." },
  { icon: HeartHandshake, title: "We get you", desc: "Built by people who've been the operator and the everyday grinder. We respect what you need." },
];

const FAQ = [
  { q: "What makes Fetti different?", a: "We're built for the way people actually earn (NMLS #2267023) — first-time buyers, self-employed, commissioned, investors, and income that does not arrive on two W-2s. We have programs that qualify you on bank deposits, on a property's rent, or on a full-doc file, and we start from your scenario rather than asking you to fit one. All loans are subject to credit approval and program guidelines." },
  { q: "Can you help with my down payment?", a: "Yes — for a lot of buyers, that's the easiest part to solve. Between FHA (3.5% down), VA and USDA ($0 down if you're eligible), and down payment assistance programs from state, county, and national sources, we can often cover most or all of your down payment and closing costs. Eligibility and terms vary by program — we'll show you exactly what you qualify for in a 2-minute chat, no credit impact." },
  { q: "Will getting started affect my credit?", a: "No. Pre-qualifying takes about two minutes with no hard credit pull. We only move forward when you're ready." },
  { q: "How fast can I close?", a: "It depends on the loan, but we move fast. Bridge and hard-money options can close in days, and we keep you posted at every step. All loans are subject to credit approval and program guidelines." },
  { q: "What states do you cover?", a: "Investment and business-purpose loans — DSCR, fix & flip, bridge, hard money, and business loans — are available nationwide, in all 50 states. Owner-occupied home loans are available in Florida, Michigan, and California. Not sure we cover your scenario? Start in two minutes and we'll tell you exactly what we can do." },
  { q: "What do I need to start?", a: "Just a couple minutes and a few basics about your goal. No documents required to pre-qualify. A specialist tells you exactly what's needed for your scenario." },
  { q: "Is it really no-obligation?", a: "100%. Pre-qualifying costs nothing, doesn't impact your credit, and comes with zero pressure. Wise money moves only." },
];

// Programs flattened from CATEGORIES into ONE ruled table. Cards became a table because nine
// programmes in a deck of boxes is a template; nine programmes in a ruled register with a
// jurisdiction column is a document — and the jurisdiction column is the compliance point. A row
// tagged "All 50 states" is investment/business ONLY; owner-occupied is CA · FL · MI, and the two
// must never blur. The link targets are unchanged.
const PROGRAM_ROWS = CATEGORIES.flatMap((c) =>
  c.items.map((it) => ({
    name: it.name,
    desc: it.desc,
    href: `/lending/${it.slug}/${c.state}`,
    jurisdiction: c.state === "usa" ? "ALL 50" : "CA · FL · MI",
    group: c.title,
  })),
);

export default async function MarketingHome() {
  return (
    <div className="min-h-screen bg-fetti-paper font-display text-fetti-ink antialiased [font-variant-numeric:tabular-nums]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBSITE) }} />

      {/* USE THE SHARED COMPONENT. This page used to carry its own inline copy of SiteHeader, so the
          busiest page on the site was the one page that never received header fixes. */}
      <SiteHeader onDark />

      {/* ───────────── HERO ─────────────────────────────────────────────────────────────────
          Ramon, 2026-10-17: "our website is not a compliance metrics. It's meant to get our
          customers happily involved with our products and services... treat it as if you were the
          top marketing advertising company in the world."

          WHAT THIS REPLACES AND WHY. The previous hero was black type on white beside a four-row
          SPEC TABLE — PRE-QUALIFY / CREDIT IMPACT / OWNER-OCCUPIED / INVESTMENT & BUSINESS — with
          the emblem set as a seal on ruled lines. Every element of it was accurate and none of it
          was persuasive. A data sheet is what you hand someone who has already decided; this page
          has to make them decide.

          THREE DELIBERATE MOVES:

          1. A DARK BRAND GROUND. #309C30 is 3.55:1 on white, so it can never carry text and was
             confined to a single button — which forced the whole page to be black-on-white, i.e. to
             look like a legal filing. `fetti-forest` (#0F3D16, 12.4:1 with white) lets the brand BE
             the page. This is the single change that stops it reading as a document.

          2. THE HEADLINE SELLS; THE TAGLINE SIGNS. "We do money." is Ramon's line and it stays —
             but as a signature beside the mark, not as the thing doing the persuading. The headline
             is now the promise the audience actually cares about, and the audience is specific:
             people conventional lenders turn away or misprice.

          3. MARK IS ON THE PAGE. The brand owns a fully-realised mascot, already drawn in the
             brand gold and deep green, and the homepage was rendering exactly ONE image — the
             emblem, four times. The distinctiveness was sitting unused in /public.

          NO PHOTOGRAPH OF RAMON — 2026-10-17, his instruction, enforced by verify:no-founder-photo.
          ───────────────────────────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-fetti-forest">
        {/* Depth without decoration: two very soft radial pools, no gradient text, no mesh. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.55]"
             style={{ background: "radial-gradient(60rem 36rem at 72% 18%, rgba(48,156,48,0.30), transparent 62%), radial-gradient(44rem 30rem at 8% 96%, rgba(252,192,84,0.10), transparent 60%)" }} />

        <div className="relative mx-auto w-full max-w-[1280px] px-6 lg:px-20 pt-16 pb-20 lg:pt-20 lg:pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 lg:gap-x-10 items-center">
            <div className="lg:col-span-7">
              <div className="flex items-center gap-3">
                <img src="/fetti-emblem.png" alt="" aria-hidden="true" width={40} height={40} className="h-10 w-10" />
                <span className="font-display text-[13px] font-semibold uppercase tracking-[0.14em] text-fetti-gold">
                  Fetti Financial Services
                </span>
              </div>

              <h1 className="mt-8 font-display font-semibold text-white leading-[0.95] tracking-[-0.035em] text-[clamp(42px,6.4vw,82px)]">
                Built for how you
                <br className="hidden sm:block" />{" "}
                <span className="text-fetti-gold">actually</span> earn.
              </h1>

              <p className="mt-7 max-w-[54ch] font-serif text-[clamp(18px,1.55vw,23px)] leading-[1.55] text-fetti-wash/90">
                Self-employed, commissioned, investing, or buying your first place. If your income
                doesn&apos;t fit a template, that&apos;s exactly what we&apos;re built for — and
                we&apos;ll tell you where you stand in about two minutes.
              </p>

              <div className="mt-10 flex flex-col sm:flex-row gap-3">
                <Link href="/apply/form"
                  className="inline-flex items-center justify-center rounded-full bg-fetti-gold px-8 py-4 text-[16px] font-bold text-fetti-forest transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fetti-gold">
                  Get pre-qualified
                </Link>
                <Link href="/quote"
                  className="inline-flex items-center justify-center rounded-full border border-white/35 px-8 py-4 text-[16px] font-semibold text-white transition hover:bg-white/10">
                  See what you qualify for
                </Link>
              </div>

              {/* The four facts survive — as one quiet line a person reads, not a table they audit. */}
              <p className="mt-7 text-[14px] leading-relaxed text-fetti-wash/70">
                Two minutes · <span className="text-white font-semibold">No credit pull</span> · No obligation
                <span className="mx-2 text-white/25">|</span>
                Home loans in CA, FL &amp; MI · Investment &amp; business lending in all 50 states
              </p>
            </div>

            {/* MARK. The brand's own character, finally on the brand's own homepage. */}
            <div className="mt-14 lg:mt-0 lg:col-span-5 flex justify-center lg:justify-end">
              <div className="relative">
                <div aria-hidden className="absolute inset-0 -m-10 rounded-full bg-fetti-green/15 blur-2xl" />
                <img
                  src="/mark-golden-owl.png"
                  alt="Mark, the Fetti Financial Services guide"
                  width={420}
                  height={420}
                  className="relative w-[240px] sm:w-[300px] lg:w-[400px] h-auto drop-shadow-2xl"
                />
                <p className="relative mt-5 text-center lg:text-right font-display text-[15px] font-semibold uppercase tracking-[0.12em] text-white/80">
                  We do money.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Capture sits on the pale ground immediately under the hero, so the ask is the first thing
          after the promise rather than buried eight sections down. */}
      <Section pad="pt-14 pb-20">
        <Well>
          <div className="max-w-[640px]">
            <HeroCapture />
          </div>
          <div className="mt-12 max-w-[640px]">
            <CediBubble size={56}>
              I&apos;m <span className="font-semibold text-fetti-ink">Mark</span> with Fetti Financial
              Services. Tell me your goal and how your income is put together — however that looks,
              there is usually a program built for it. Two minutes, no credit pull.
            </CediBubble>
            <div className="mt-4"><CediVoice /></div>
          </div>
        </Well>
      </Section>

      {/* ───────────── 02 PROGRAMS — a ruled table, not a deck of cards ───────────── */}
      <Section>
        <Well>
          <h2 className="max-w-[18ch] font-display font-semibold leading-[1.02] tracking-[-0.028em] text-[clamp(34px,4.4vw,56px)]">
            Start with your scenario.
          </h2>
          <p className="mt-5 max-w-[56ch] text-[16px] leading-[1.6] text-fetti-body">
            Most lending starts with a template and asks you to match it. We start with how you
            actually earn, then match a program to that.
          </p>

          <div className="mt-12 border-t border-fetti-rule">
            {PROGRAM_ROWS.map((p) => (
              <Link
                key={p.href}
                href={p.href}
                className="group grid grid-cols-12 items-center gap-x-4 border-b border-fetti-line py-6 transition-colors hover:bg-[#FAFCFA]"
              >
                <span aria-hidden className="col-span-12 -mb-6 h-0 w-0 lg:col-span-0" />
                <span className="col-span-8 lg:col-span-3">
                  <span className="block font-display text-[20px] font-semibold leading-[1.25] tracking-[-0.012em]">
                    {p.name}
                  </span>
                  <span className="mt-1 block font-mono text-[12px] font-medium tracking-[0.04em] text-fetti-muted lg:hidden">
                    {p.jurisdiction}
                  </span>
                </span>
                <span className="col-span-12 mt-2 text-[15px] leading-[1.58] text-fetti-body lg:col-span-6 lg:mt-0">
                  {p.desc}
                </span>
                <span className="col-span-3 hidden font-mono text-[12px] font-medium tracking-[0.04em] text-fetti-muted lg:col-span-2 lg:block">
                  {p.jurisdiction}
                </span>
                <span className="col-span-1 justify-self-end text-fetti-muted transition-colors group-hover:text-fetti-ink">
                  <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            ))}
          </div>

          {GUIDES.length > 0 && (
            <>
              <p className="mt-14 border-b border-fetti-rule pb-2 font-mono text-[12px] font-medium uppercase tracking-[0.04em] text-fetti-muted">
                Guides — how these loans actually get underwritten
              </p>
              <div className="border-t-0">
                {GUIDES.map((g) => (
                  <Link
                    key={g.slug}
                    href={`/lending/${g.slug}`}
                    className="group grid grid-cols-12 items-baseline gap-x-4 border-b border-fetti-line py-5 transition-colors hover:bg-[#FAFCFA]"
                  >
                    <span className="col-span-11 font-display text-[17px] font-semibold tracking-[-0.012em] lg:col-span-4">
                      {g.title}
                    </span>
                    <span className="col-span-12 mt-1 text-[15px] leading-[1.58] text-fetti-body lg:col-span-7 lg:mt-0">
                      {g.blurb}
                    </span>
                    <span className="col-span-1 justify-self-end text-fetti-muted transition-colors group-hover:text-fetti-ink">
                      <ArrowRight className="h-4 w-4" />
                    </span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </Well>
      </Section>

      {/* ───────────── 03 THE DIFFERENCE — a paired ledger read across a shared rule.
          De-emphasis is pure colour value: no X icons, no check icons, no badges. ───────────── */}
      <Section>
        <Well>
          <h2 className="max-w-[20ch] font-display font-semibold leading-[1.02] tracking-[-0.028em] text-[clamp(34px,4.4vw,56px)]">
            We find the program that fits it.
          </h2>

          <div className="mt-12 border-t border-fetti-rule">
            <div className="grid grid-cols-1 gap-x-10 border-b border-fetti-line py-3 lg:grid-cols-2">
              <p className="font-mono text-[12px] font-medium uppercase tracking-[0.04em] text-fetti-muted">
                A one-size process
              </p>
              <p className="mt-2 font-mono text-[12px] font-medium uppercase tracking-[0.04em] text-fetti-ink lg:mt-0">
                Fetti
              </p>
            </div>
            {CONTRAST.map((row) => (
              <div key={row.us} className="grid grid-cols-1 gap-x-10 border-b border-fetti-line py-6 lg:grid-cols-2">
                <p className="text-[16px] leading-[1.6] text-fetti-muted">{row.them}</p>
                <p className="mt-3 text-[16px] leading-[1.6] text-fetti-ink lg:mt-0">{row.us}</p>
              </div>
            ))}
          </div>
        </Well>
      </Section>

      {/* ───────────── 04 AUTHORITY — the serif section. The TYPEFACE CHANGE is the section
          break: no band, no background, no border. ───────────── */}
      <Section pad="py-28 lg:py-36">
        <Well>
          <div className="grid grid-cols-1 lg:grid-cols-12 lg:gap-x-6">
            <div className="lg:col-span-8 lg:col-start-3">
              <p className="max-w-[62ch] font-serif text-[22px] leading-[1.55] text-fetti-ink">
                <span className="font-display font-semibold uppercase tracking-[0.06em]">
                  A licensed lender.
                </span>{" "}
                Fully licensed and regulated in every state we lend in, and built for the way you
                actually earn. Owner-occupied home loans in California, Florida and Michigan.
                Investment and business-purpose lending in all fifty. Start in two minutes, with no
                impact on your credit.
              </p>
              <p className="mt-8 font-mono text-[12px] font-medium tracking-[0.04em] text-fetti-muted">
                NMLS #2267023 · CA #60DBO-153798 · FL #MBR7286 · MI #FL0024463
              </p>
            </div>
          </div>
        </Well>
      </Section>

      {/* ───────────── 05 PROCESS — one literal rule with nodes on it ───────────── */}
      <Section>
        <Well>
          <h2 className="max-w-[16ch] font-display font-semibold leading-[1.02] tracking-[-0.028em] text-[clamp(34px,4.4vw,56px)]">
            How it works.
          </h2>
          <div className="relative mt-16">
            <span aria-hidden className="absolute left-0 right-0 top-[4.5rem] hidden h-px bg-fetti-line lg:block" />
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-3 lg:gap-6">
              {STEPS.map((s) => (
                <div key={s.n} className="relative">
                  <p className="font-mono text-[44px] font-medium leading-none tracking-[-0.01em] text-fetti-ink">
                    {s.n}
                  </p>
                  <span aria-hidden className="mt-7 hidden h-[9px] w-[9px] bg-fetti-green lg:block" />
                  <h3 className="mt-6 font-display text-[20px] font-semibold tracking-[-0.012em]">{s.title}</h3>
                  <p className="mt-2 max-w-[42ch] text-[15px] leading-[1.58] text-fetti-body">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </Well>
      </Section>

      {/* ───────────── 06 WHO WE BUILD FOR — the only section using VERTICAL rules, which is
          exactly why it cannot be confused with 02. ───────────── */}
      <Section>
        <Well>
          <h2 className="max-w-[18ch] font-display font-semibold leading-[1.02] tracking-[-0.028em] text-[clamp(34px,4.4vw,56px)]">
            Built for how you actually earn.
          </h2>
          <div className="mt-14 grid grid-cols-1 gap-y-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-x-0">
            {AUDIENCE.map((a, i) => (
              <div
                key={a.title}
                className={`lg:px-6 ${i === 0 ? "lg:pl-0" : "lg:border-l lg:border-fetti-line"}`}
              >
                <p className="font-mono text-[12px] font-medium tracking-[0.04em] text-fetti-muted">
                  {String(i + 1).padStart(2, "0")}
                </p>
                <h3 className="mt-3 font-display text-[20px] font-semibold tracking-[-0.012em]">{a.title}</h3>
                <p className="mt-2 text-[15px] leading-[1.58] text-fetti-body">{a.desc}</p>
              </div>
            ))}
          </div>
        </Well>
      </Section>

      {/* ───────────── 07 QUESTIONS ───────────── */}
      <Section>
        <Well>
          <h2 className="max-w-[16ch] font-display font-semibold leading-[1.02] tracking-[-0.028em] text-[clamp(34px,4.4vw,56px)]">
            Straight answers.
          </h2>
          <div className="mt-12 border-t border-fetti-rule">
            {FAQ.map((f) => (
              <details key={f.q} className="group border-b border-fetti-line py-5">
                <summary className="flex cursor-pointer list-none items-baseline justify-between gap-6">
                  <span className="font-display text-[18px] font-semibold tracking-[-0.012em]">{f.q}</span>
                  <span aria-hidden className="shrink-0 font-mono text-[12px] font-medium text-fetti-ink">
                    <span className="group-open:hidden">+</span>
                    <span className="hidden group-open:inline">−</span>
                  </span>
                </summary>
                <p className="mt-4 max-w-[62ch] text-[16px] leading-[1.6] text-fetti-body lg:pl-[8.333%]">
                  {f.a}
                </p>
              </details>
            ))}
          </div>
        </Well>
      </Section>

      <Section pad="pt-4 pb-20">
        <Well>
          <SocialProofWall />
        </Well>
      </Section>

      {/* ───────────── 09 ACTION — the single inverted band on the whole site. Large white type
          on #309C30 clears AA at 3.56:1; no legal copy ever sits on a coloured ground. ────── */}
      <section className="bg-fetti-green">
        <div className="mx-auto w-full max-w-[1280px] px-6 py-28 lg:px-20">
          <h2 className="max-w-[20ch] font-display font-semibold leading-[1.02] tracking-[-0.028em] text-white text-[clamp(34px,4.4vw,56px)]">
            Two minutes. No credit pull.
          </h2>
          <div className="mt-10 flex flex-col sm:flex-row gap-3">
            <Link
              href="/apply/form"
              className="inline-flex items-center justify-center rounded-[4px] bg-white px-7 py-3.5 text-[15px] font-semibold text-fetti-deep transition-opacity hover:opacity-90"
            >
              Get pre-qualified
            </Link>
            <Link
              href="/quote"
              className="inline-flex items-center justify-center rounded-[4px] border border-white px-7 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-white/10"
            >
              See what you qualify for
            </Link>
          </div>
        </div>
      </section>

      {/* ───────────── THE REGISTER — the footer, and the close of the argument. The most
          carefully typeset block on the page, because it is the one that is legally required
          to be here. ───────────── */}
      <footer className="bg-fetti-wash">
        <div className="mx-auto w-full max-w-[1280px] px-6 py-16 lg:px-20">
          <div className="flex items-center gap-3">
            <img src="/fetti-emblem.png" alt="" aria-hidden="true" width={32} height={32} className="h-8 w-8" />
            {/* Full size, full ink. Shrinking and greying the licensed entity's name is a tell. */}
            <span className="font-display text-[15px] font-semibold uppercase tracking-[0.08em] text-fetti-ink">
              Fetti Financial Services LLC
            </span>
          </div>

          <dl className="mt-10 border-t border-fetti-rule">
            {[
              ["LICENSEE", "NMLS #2267023"],
              ["CALIFORNIA", "DFPI Financing Law License · 60DBO-153798"],
              ["FLORIDA", "Mortgage Broker License · MBR7286"],
              ["MICHIGAN", "1st Mortgage Broker/Lender License · FL0024463"],
              ["OWNER-OCCUPIED", "California · Florida · Michigan"],
              ["INVESTMENT & BUSINESS", "All 50 states"],
              ["FAIR HOUSING", "Equal Housing Opportunity"],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-1 gap-1 border-b border-fetti-line py-3 sm:grid-cols-12 sm:gap-4">
                <dt className="font-mono text-[12px] font-medium uppercase tracking-[0.04em] text-fetti-muted sm:col-span-4">
                  {k}
                </dt>
                <dd className="font-display text-[13px] text-fetti-body sm:col-span-8">{v}</dd>
              </div>
            ))}
          </dl>

          <nav className="mt-10 flex flex-wrap gap-x-8 gap-y-2 text-[15px]">
            {[
              ["/lending", "Programs"],
              ["/quote", "Instant Quote"],
              ["/apply/form", "Apply"],
              ["/privacy", "Privacy"],
              ["/terms", "Terms"],
            ].map(([href, label]) => (
              <Link key={href} href={href} className="text-fetti-body transition-colors hover:text-fetti-ink">
                {label}
              </Link>
            ))}
          </nav>

          <p className="mt-10 border-t border-fetti-rule pt-8 text-[13px] leading-[1.65] text-fetti-body">
            {LICENSING_NOTE}
          </p>
        </div>
      </footer>
    </div>
  );
}

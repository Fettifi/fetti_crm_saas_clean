"use client";

// Site-wide ENGAGEMENT engine. Clicks, scroll depth, time-on-page, and every SPA
// route change all fire an ANONYMOUS, cookieless event to Vercel Web Analytics (no
// consent needed — no cookies, no PII), AND a retargeting signal to the marketing
// pixels ONLY after the visitor consents to "all". Builds rich "engaged visitor"
// audiences for aggressive retargeting. Anonymous only (button text/href, scroll %,
// seconds) — never form values, never PII.
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { track } from "@vercel/analytics";
import { getConsent } from "@/lib/consent";

export default function ClickTracker() {
  const pathname = usePathname();
  const firstNav = useRef(true);

  // Re-fire pixel PageView/ViewContent on each client-side route change so every page
  // a consenting visitor browses counts toward retargeting — not just the first load.
  // (The initial load's PageView is fired by TrackingPixels, so skip the first run.)
  useEffect(() => {
    if (firstNav.current) { firstNav.current = false; return; }
    if (getConsent() !== "all") return;
    const w = window as any;
    try { w.fbq?.("track", "PageView"); w.fbq?.("track", "ViewContent"); } catch { /* */ }
    try { w.ttq?.page?.(); } catch { /* */ }
    try { track("pageview", { path: pathname || "/" }); } catch { /* */ }
  }, [pathname]);

  useEffect(() => {
    const marketing = () => getConsent() === "all";
    const pixel = (name: string, props: Record<string, unknown>) => {
      if (!marketing()) return;
      const w = window as any;
      try { w.fbq?.("trackCustom", name, props); } catch { /* */ }
      try { w.ttq?.track(name, props); } catch { /* */ }
    };

    // Clicks
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest("a,button,[role=button]") as HTMLElement | null;
      if (!el) return;
      const label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("href") || "").replace(/\s+/g, " ").trim().slice(0, 60);
      if (!label) return;
      const href = el.getAttribute("href") || undefined;
      try { track("click", href ? { label, href } : { label }); } catch { /* */ }
      pixel("Click", { label });
    };
    document.addEventListener("click", onClick, true);

    // Scroll depth (50%, 90%) — fired once each per session
    const seen = new Set<number>();
    const onScroll = () => {
      const d = document.documentElement;
      const max = (d.scrollHeight - d.clientHeight) || 1;
      const pct = Math.round(((d.scrollTop || window.scrollY) / max) * 100);
      for (const m of [50, 90]) {
        if (pct >= m && !seen.has(m)) {
          seen.add(m);
          try { track("scroll", { depth: m }); } catch { /* */ }
          pixel("ScrollDepth", { depth: m });
        }
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    // Time-on-page milestones (30s, 90s) — 90s marks an "EngagedVisitor" for retargeting
    const t30 = setTimeout(() => { try { track("dwell", { seconds: 30 }); } catch { /* */ } pixel("TimeOnPage", { seconds: 30 }); }, 30000);
    const t90 = setTimeout(() => { try { track("dwell", { seconds: 90 }); } catch { /* */ } pixel("EngagedVisitor", { seconds: 90 }); }, 90000);

    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("scroll", onScroll);
      clearTimeout(t30); clearTimeout(t90);
    };
  }, []);

  return null;
}

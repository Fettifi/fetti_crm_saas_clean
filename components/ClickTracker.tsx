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
import { isTokenGatedPath } from "@/lib/personalRoutes";

export default function ClickTracker() {
  const pathname = usePathname();
  const firstNav = useRef(true);

  // Re-fire pixel PageView/ViewContent on each client-side route change so every page
  // a consenting visitor browses counts toward retargeting — not just the first load.
  // (The initial load's PageView is fired by TrackingPixels, so skip the first run.)
  // NO TELEMETRY AT ALL ON A PAGE WHOSE URL IS A CREDENTIAL.
  // /file/<token>, /sign/<token>, /letter/<token> and /card-auth/<token> authenticate the visitor
  // with a bearer token IN THE PATH. Every emitter below carries that path: fbq PageView and
  // ttq.page() send document.location to Meta and TikTok, and track("pageview", {path}) puts it in
  // Vercel Analytics. TrackingPixels is now gated, but it only controls the INITIAL load — a
  // visitor who navigates from a tracked page into a token page in the same SPA session arrives
  // with fbq already on the window, and this effect would have fired the token straight at it.
  // Read at FIRE TIME from window.location, never from a captured pathname: the click and scroll
  // handlers below are registered once and would otherwise hold a stale value.
  const onSecretUrl = () => { try { return isTokenGatedPath(window.location.pathname); } catch { return true; } };
  // Vercel's track() associates every event with the CURRENT PAGE URL automatically, so "scroll",
  // "dwell" and "click" leak the token just as surely as a pixel does — and a click event also
  // carries the href, which on these pages is frequently another tokened link. One wrapper, so a
  // new call site cannot miss the rule. The `any` mirrors @vercel/analytics' own loose props type.
  const atrack = (name: string, props?: any) => { if (onSecretUrl()) return; try { (track as any)(name, props); } catch { /* */ } };

  useEffect(() => {
    if (firstNav.current) { firstNav.current = false; return; }
    if (getConsent() !== "all") return;
    if (onSecretUrl()) return;
    const w = window as any;
    try { w.fbq?.("track", "PageView"); w.fbq?.("track", "ViewContent"); } catch { /* */ }
    try { w.ttq?.page?.(); } catch { /* */ }
    atrack("pageview", { path: pathname || "/" });
  }, [pathname]);

  useEffect(() => {
    const marketing = () => getConsent() === "all" && !onSecretUrl();
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
      atrack("click", href ? { label, href } : { label });
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
          atrack("scroll", { depth: m });
          pixel("ScrollDepth", { depth: m });
        }
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    // Time-on-page milestones (30s, 90s) — 90s marks an "EngagedVisitor" for retargeting
    const t30 = setTimeout(() => { atrack("dwell", { seconds: 30 }); pixel("TimeOnPage", { seconds: 30 }); }, 30000);
    const t90 = setTimeout(() => { atrack("dwell", { seconds: 90 }); pixel("EngagedVisitor", { seconds: 90 }); }, 90000);

    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("scroll", onScroll);
      clearTimeout(t30); clearTimeout(t90);
    };
  }, []);

  return null;
}

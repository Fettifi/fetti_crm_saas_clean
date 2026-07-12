"use client";
// Cookieless first-party pageview beacon for PUBLIC pages (mounted by AppChrome's
// non-CRM branch). One sendBeacon per route change → /api/track. No cookies, no
// IDs — the endpoint stores only path/UTM/referer-origin/coarse-geo, honoring GPC.
import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function TrackBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      const payload = JSON.stringify({ path: pathname, search: window.location.search, ref: document.referrer });
      if (navigator.sendBeacon) navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
      else fetch("/api/track", { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
    } catch { /* never break the page for analytics */ }
  }, [pathname]);
  return null;
}

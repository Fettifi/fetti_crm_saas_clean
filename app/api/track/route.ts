// FIRST-PARTY page-hit beacon — cookieless, anonymous, consent-safe analytics
// on OUR public pages, so the funnel (content → click → landing session → lead)
// is measurable in our own database independent of Meta/Google's reporting.
//
// Deliberately minimal data class (same as cookieless Vercel Analytics): path,
// UTM tags, referer ORIGIN only, coarse country, device class. No cookies, no
// IDs, no raw IP stored, no fingerprinting — and if the browser sends Global
// Privacy Control, we drop country/device too. Public endpoint; rate-limited.
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { logActivity } from "@/lib/activity";
import { rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // Rate limits: per-source and global (a beacon endpoint is a spam magnet).
    const src = (req.headers.get("x-forwarded-for") || "anon").split(",")[0].trim().slice(0, 45);
    if (!(await rateLimit(`track:${src}`, 120, 3600))) return NextResponse.json({ ok: true });
    if (!(await rateLimit("track:global", 20000, 86400))) return NextResponse.json({ ok: true });

    const b = await req.json().catch(() => ({}));
    const path = String(b.path || "/").slice(0, 200);
    const search = new URLSearchParams(String(b.search || "").slice(0, 500));
    const gpc = req.headers.get("sec-gpc") === "1";
    const ref = (() => { try { return new URL(String(b.ref || "")).origin; } catch { return null; } })();

    const detail: Record<string, unknown> = {
      path,
      utm_source: search.get("utm_source"),
      utm_medium: search.get("utm_medium"),
      utm_campaign: search.get("utm_campaign"),
      gclid: search.get("gclid") ? true : undefined, // presence only, never the id
      ref,
    };
    if (!gpc) {
      detail.country = req.headers.get("x-vercel-ip-country") || null;
      detail.device = /mobile|iphone|android/i.test(req.headers.get("user-agent") || "") ? "mobile" : "desktop";
    }

    after(async () => {
      await logActivity({ entity_type: "web", entity_id: path.slice(0, 60), actor: "visitor", action: "web.hit", detail }).catch(() => {});
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true }); // a beacon must never error at the client
  }
}

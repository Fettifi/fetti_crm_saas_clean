// TRACKED SHORT LINKS — the door every piece of shared content walks through.
// fettifi.com/go/<slug> 302s to its target with attribution UTMs appended, and
// logs the click FIRST-PARTY (our own activity_log, not just the ad platforms')
// so every video QR, caption link, bio link, and flyer is measurable: which
// content produced which clicks, sessions, and ultimately leads.
//
// Link registry lives in app_settings GO_LINKS:
//   { "<slug>": { "to": "/", "utm_source": "raymark", "utm_medium": "qr",
//                 "utm_campaign": "ep1", "note": "EP1 end-card QR" } }
// Unknown slugs still redirect (never 404 a shared link) and still log — an
// unknown-slug click is data too. Privacy: no cookies set here, no raw IP
// stored; referer trimmed to origin, UA trimmed, coarse country from the edge.
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getSetting } from "@/lib/settings";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await ctx.params;
  const slug = String(rawSlug || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 60);

  let links: Record<string, any> = {};
  try { links = JSON.parse((await getSetting("GO_LINKS")) || "{}"); } catch { links = {}; }
  const def = (slug && links[slug]) || null;

  const target = new URL(String(def?.to || "/"), req.url);
  target.searchParams.set("utm_source", String(def?.utm_source || "golink"));
  target.searchParams.set("utm_medium", String(def?.utm_medium || "short_link"));
  target.searchParams.set("utm_campaign", String(def?.utm_campaign || slug || "unknown"));

  const ref = (() => { try { return new URL(req.headers.get("referer") || "").origin; } catch { return null; } })();
  const country = req.headers.get("x-vercel-ip-country") || null;
  const ua = (req.headers.get("user-agent") || "").slice(0, 120);

  after(async () => {
    await logActivity({
      entity_type: "link", entity_id: slug || "unknown", actor: "visitor", action: "link.click",
      detail: {
        slug: slug || "unknown", known: !!def, target: target.pathname,
        utm_source: target.searchParams.get("utm_source"),
        utm_medium: target.searchParams.get("utm_medium"),
        utm_campaign: target.searchParams.get("utm_campaign"),
        ref, country, ua,
      },
    }).catch(() => {});
  });

  return NextResponse.redirect(target, 302);
}

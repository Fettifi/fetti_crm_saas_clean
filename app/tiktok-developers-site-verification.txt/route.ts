// Serves https://fettifi.com/tiktok-developers-site-verification.txt for TikTok's
// "URL prefix / website" ownership verification (file method). Paste the signature
// string TikTok gives you in the Developer Portal into app_settings key
// TIKTOK_SITE_VERIFICATION (or env), and this endpoint serves it — no redeploy.
// (For the "Domain" property, the DNS-TXT method at GoDaddy is preferred and covers
// app.fettifi.com too.)
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const val = (await getSetting("TIKTOK_SITE_VERIFICATION")) || process.env.TIKTOK_SITE_VERIFICATION || "";
  if (!val) {
    return new Response("TikTok site-verification not configured yet.", { status: 404, headers: { "Content-Type": "text/plain" } });
  }
  return new Response(val, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

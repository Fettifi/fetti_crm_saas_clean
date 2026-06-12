import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Content-Security-Policy. Locks script + connect origins to self + the known
// integrations (Supabase, Google/Meta/TikTok pixels, Google Places, Vercel) so
// an injected <script src=evil> or data-exfil to an arbitrary host is blocked.
// 'unsafe-inline'/'unsafe-eval' are required by Next's hydration + the ad pixels;
// img-src https: stays permissive (images can't execute). object/base/frame are
// locked down. Supabase https+wss is included so the app/login/realtime never break.
const SB = "https://hgnpxdivozbmjagmshda.supabase.co";
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.googletagmanager.com https://*.google-analytics.com https://*.googleadservices.com https://*.doubleclick.net https://www.google.com https://*.facebook.net https://*.tiktok.com https://*.googleapis.com https://*.gstatic.com https://*.vercel-scripts.com https://vercel.live",
  "style-src 'self' 'unsafe-inline' https://*.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://*.gstatic.com",
  `connect-src 'self' ${SB} wss://hgnpxdivozbmjagmshda.supabase.co https://*.googleapis.com https://*.google-analytics.com https://*.googletagmanager.com https://*.analytics.google.com https://*.google.com https://*.doubleclick.net https://*.googleadservices.com https://*.facebook.com https://*.facebook.net https://*.tiktok.com https://*.vercel-insights.com https://*.vercel-scripts.com`,
  "media-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'self' https://*.doubleclick.net https://*.googletagmanager.com https://*.facebook.com",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "hgnpxdivozbmjagmshda.supabase.co" },
    ],
  },
  // Pin the workspace root to THIS project. Without this, a stray
  // package-lock.json in the home directory makes Next treat ~/ as the root
  // and try to compile unrelated files (e.g. ~/.gemini/...), breaking the build.
  turbopack: {
    root: __dirname,
  },
  // Security response headers applied to every route. HSTS forces HTTPS;
  // SAMEORIGIN + nosniff + referrer + permissions policies harden against
  // clickjacking, MIME sniffing, referrer leakage, and unwanted device access.
  // (A full Content-Security-Policy is a recommended next step — it needs the
  // third-party allowlist tested against the live pixels/maps to avoid breakage.)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), browsing-topics=()" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;

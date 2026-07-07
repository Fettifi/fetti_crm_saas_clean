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

// Separate, deliberately frame-friendly policy for the Outlook add-in surface
// (/outlook/*). The task pane is loaded INSIDE Outlook's own frame (web + the
// desktop WebView), so it must NOT carry X-Frame-Options or a restrictive
// frame-ancestors — those would block Outlook from hosting it at all. It must
// also allow the Office.js CDN in script-src. Same-origin API calls ('self')
// still cover /api/outlook/*. frame-ancestors is intentionally OMITTED (it does
// not inherit from default-src) so any Office host can frame the pane.
const officeHosts =
  "https://appsforoffice.microsoft.com https://*.office.com https://*.officeapps.live.com https://*.microsoft.com https://*.office365.com https://*.outlook.com";
const outlookCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${officeHosts}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${officeHosts}`,
  "media-src 'self' blob: data:",
  "worker-src 'self' blob:",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The e-sign PDF compressor loads pdfium.wasm from node_modules at runtime —
  // force-include it in the serverless bundle so file tracing can never miss it.
  outputFileTracingIncludes: {
    "/api/esign/requests": ["./node_modules/@hyzyla/pdfium/dist/pdfium.wasm"],
  },
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
    const baseSecurity = [
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-DNS-Prefetch-Control", value: "off" },
    ];
    return [
      {
        // Everything EXCEPT the Outlook add-in surface keeps the strict policy
        // (unchanged from before — same CSP, X-Frame-Options, permissions).
        source: "/((?!outlook/).*)",
        headers: [
          ...baseSecurity,
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), browsing-topics=()" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
      {
        // The Outlook add-in pages are framed by Outlook — no X-Frame-Options,
        // no frame-ancestors, Office.js CDN allowed, microphone permitted.
        source: "/outlook/:path*",
        headers: [
          ...baseSecurity,
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
          { key: "Content-Security-Policy", value: outlookCsp },
        ],
      },
    ];
  },
};

export default nextConfig;

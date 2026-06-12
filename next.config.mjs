import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
        ],
      },
    ];
  },
};

export default nextConfig;

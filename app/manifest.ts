import type { MetadataRoute } from "next";

// Web app manifest — makes the app installable as a dedicated desktop / mobile
// app (single standalone window, own dock icon, no browser chrome).
// Next.js serves this at /manifest.webmanifest and auto-links it from <head>.
//
// The name is PUBLIC. One Next app serves both hosts, so this manifest is linked
// from every fettifi.com marketing page too, and Next renders it into
// <meta name="application-name"> and <meta name="apple-mobile-web-app-title">.
// It read "Fetti CRM", which meant a borrower who added fettifi.com to their home
// screen got an icon labelled with our internal tooling — and every public page
// carried "Fetti CRM" as its application-name. Name the company, not the tool.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fetti Financial Services",
    short_name: "Fetti",
    description: "Fetti Financial Services — we get your loan funded.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

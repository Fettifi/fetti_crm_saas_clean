import type { MetadataRoute } from "next";

// Web app manifest — makes app.fettifi.com installable as a dedicated desktop /
// mobile app (single standalone window, own dock icon, no browser chrome).
// Next.js serves this at /manifest.webmanifest and auto-links it from <head>.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fetti CRM",
    short_name: "Fetti CRM",
    description: "Fetti Financial Services — mortgage CRM & loan origination.",
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

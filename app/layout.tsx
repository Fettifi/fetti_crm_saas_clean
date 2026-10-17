import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Archivo, Source_Serif_4, IBM_Plex_Mono } from "next/font/google";

const inter = Inter({ subsets: ["latin"], display: "swap" });

// THE PUBLIC SITE'S TYPEFACES — loaded as CSS VARIABLES, deliberately not as the global default.
//
// Inter stays the default on <html> because the CRM, the LOS, the pricer and every internal screen
// are built against it; swapping the app-wide font to restyle the marketing site would be a very
// large blast radius for a cosmetic change. These three are exposed as variables and consumed only
// by the marketing pages via Tailwind's font-display / font-serif / font-mono.
//
// Archivo — an American grotesque in the Franklin Gothic lineage. Squarer and wider in the
// lowercase than Inter, with more spine, and it holds at both 12px and 92px. It reads as civic
// signage and annual report rather than SaaS — and it is not the font a template reaches for,
// which is half the point when the complaint is "this looks AI-built".
//
// Source Serif 4 — used for EXACTLY TWO THINGS on the whole site: the hero lede and the authority
// passage. Its scarcity is what makes it read as a decision instead of decoration. If it starts
// appearing in a third place, it has become wallpaper and should be pulled back.
//
// IBM Plex Mono — the ledger voice: indices, jurisdictions, licence codes, step numbers. It is what
// lets the compliance apparatus read as deliberate typesetting rather than small print.
const archivo = Archivo({ subsets: ["latin"], display: "swap", variable: "--font-archivo", weight: ["400", "500", "600", "700"] });
// WEIGHT 400, ROMAN ONLY — and this is a build constraint, not a preference. Requesting
// style: ["normal","italic"] with multiple weights made Turbopack fail to resolve the font module
// 24 times at build (`Can't resolve @vercel/turbopack-next/internal/font/google/font`), while dev
// rendered fine — so it would have shipped green locally and broken the deploy. The design uses
// Source Serif 4 in exactly two places (hero lede, authority passage) and both are 400 roman, so
// the extra faces bought nothing. Do not add weights here without re-running `npm run build`.
const sourceSerif = Source_Serif_4({ subsets: ["latin"], display: "swap", variable: "--font-serif", weight: ["400"] });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], display: "swap", variable: "--font-mono", weight: ["400", "500"] });

// `title` is only the FALLBACK — every public marketing page sets its own, so this shows up on
// CRM screens, where "Fetti CRM" is the right name. `applicationName` and `appleWebApp.title` are
// different: Next renders them into <meta name="application-name"> and
// <meta name="apple-mobile-web-app-title"> on EVERY page, public ones included. They read
// "Fetti CRM", so a borrower who added fettifi.com to their home screen got an icon labelled with
// our internal tooling. Public-facing strings name the company. See also app/manifest.ts.
export const metadata: Metadata = {
  title: "Fetti CRM",
  description: "Fetti - We Do Money.",
  applicationName: "Fetti Financial Services",
  // Installed (standalone) app behavior on iOS/iPadOS.
  appleWebApp: { capable: true, title: "Fetti Financial Services", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#0f172a" };

import { Toaster } from 'sonner';
import { Analytics } from '@vercel/analytics/next';
import TrackingPixels from '@/components/TrackingPixels';
import AttributionCapture from '@/components/AttributionCapture';
import ConsentBanner from '@/components/ConsentBanner';
import ClickTracker from '@/components/ClickTracker';
import AppChrome from '@/components/AppChrome';
import VersionWatcher from "@/components/VersionWatcher";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.className} ${archivo.variable} ${sourceSerif.variable} ${plexMono.variable}`}>
      <body className="bg-gray-50 text-gray-900">
        <TrackingPixels />
        <AttributionCapture />
        <ClickTracker />
        <Analytics />
        <AppChrome>{children}</AppChrome>
        {/* Notices when the running bundle is older than what is deployed. */}
        <VersionWatcher />
        <ConsentBanner />
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}

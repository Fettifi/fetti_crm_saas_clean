import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], display: "swap" });

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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.className}>
      <body className="bg-gray-50 text-gray-900">
        <TrackingPixels />
        <AttributionCapture />
        <ClickTracker />
        <Analytics />
        <AppChrome>{children}</AppChrome>
        <ConsentBanner />
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}

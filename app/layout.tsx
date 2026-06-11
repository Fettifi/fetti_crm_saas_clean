import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Fetti CRM",
  description: "Fetti - We Do Money.",
  applicationName: "Fetti CRM",
  // Installed (standalone) app behavior on iOS/iPadOS.
  appleWebApp: { capable: true, title: "Fetti CRM", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#0f172a" };

import { Toaster } from 'sonner';
import TrackingPixels from '@/components/TrackingPixels';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.className}>
      <body className="bg-gray-50 text-gray-900">
        <TrackingPixels />
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}

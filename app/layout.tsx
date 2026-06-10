import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Fetti CRM",
  description: "Fetti - We Do Money.",
};

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

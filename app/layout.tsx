import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Fetti CRM",
  description: "Fetti - We Do Money.",
};

import { Toaster } from 'sonner';
import TrackingPixels from '@/components/TrackingPixels';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900">
        <TrackingPixels />
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}

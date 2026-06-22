"use client";
// Mounts globally (root layout). Persists first-touch ad attribution on every
// page load so a Google Ads click is still attributable when the visitor finally
// submits, even if they wandered across several pages first.
import { useEffect } from "react";
import { captureAttribution } from "@/lib/attribution";

export default function AttributionCapture() {
  useEffect(() => { captureAttribution(); }, []);
  return null;
}

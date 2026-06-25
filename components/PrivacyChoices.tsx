"use client";

// Always-available opt-in/opt-out control for analytics & advertising cookies
// (CCPA/CPRA "Do Not Sell or Share" mechanism). Linked from the cookie banner.
import { useState } from "react";
import { setConsent } from "@/lib/consent";

export default function PrivacyChoices() {
  const [msg, setMsg] = useState("");
  const apply = (v: "all" | "essential") => {
    setConsent(v);
    setMsg(v === "essential"
      ? "Saved — advertising & analytics cookies are turned off. Essential cookies remain so the site works."
      : "Saved — all cookies enabled.");
  };
  return (
    <div className="not-prose mt-3">
      <div className="flex flex-wrap gap-2">
        <button onClick={() => apply("essential")} className="text-sm font-medium px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">
          Do Not Sell or Share — Essential cookies only
        </button>
        <button onClick={() => apply("all")} className="text-sm font-medium px-3 py-2 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50">
          Allow all cookies
        </button>
      </div>
      {msg && <p className="text-xs text-emerald-700 mt-2">{msg}</p>}
      <p className="text-xs text-gray-500 mt-2">
        Your browser&apos;s Global Privacy Control (GPC) signal is automatically honored as an opt-out.
      </p>
    </div>
  );
}

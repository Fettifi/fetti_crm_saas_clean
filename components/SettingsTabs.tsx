"use client";

// Tab shell for the Settings page. Keeps the existing settings content as the
// default tab and adds a "Security (MFA)" tab that hosts the MFA panel merged in
// from the old /security route. Active tab is read from the ?tab= query param
// (client-side in a useEffect — no useSearchParams, which would require a
// Suspense boundary and break the build).
import { ReactNode, useEffect, useState } from "react";
import SecurityMFAPanel from "@/components/SecurityMFAPanel";

type TabKey = "general" | "security";

export default function SettingsTabs({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<TabKey>("general");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "security") setTab("security");
  }, []);

  const selectTab = (next: TabKey) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "general") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: "general", label: "General" },
    { key: "security", label: "Security (MFA)" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-slate-800">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => selectTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t.key
                ? "border-emerald-500 text-emerald-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={tab === "general" ? "space-y-8" : "hidden"}>{children}</div>
      {tab === "security" && <SecurityMFAPanel />}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

// Paste your Calendly scheduling link here. Once set, borrowers see a
// "Book a call" button on their secure file portal, and it's included in
// outreach (upload-link messages + nurture follow-ups).
export default function CalendlySettings() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/settings/calendly");
        if (r.ok) { const j = await r.json(); setUrl(j.url || ""); }
      } catch { /* */ }
      setLoading(false);
    })();
  }, []);

  async function save() {
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/settings/calendly", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const j = await r.json();
      setMsg(r.ok ? { ok: true, text: url ? "✓ Saved — borrowers can now book a call." : "✓ Cleared." } : { text: j.error || "Save failed." });
    } catch { setMsg({ text: "Connection error." }); }
    setSaving(false);
    setTimeout(() => setMsg(null), 6000);
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-300 space-y-2">
      <p className="font-semibold text-slate-200">📅 Calendly scheduling link</p>
      <p>Borrowers see a <span className="text-emerald-300">Book a call</span> button on their secure file portal, and the link rides along in upload-link texts/emails and nurture follow-ups.</p>
      <div className="flex flex-col sm:flex-row gap-2 pt-1">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://calendly.com/your-name/30min"
          disabled={loading}
          className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
        />
        <button onClick={save} disabled={saving || loading}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {msg && <span className={msg.ok ? "text-emerald-400" : "text-amber-300"}>{msg.text}</span>}
    </div>
  );
}

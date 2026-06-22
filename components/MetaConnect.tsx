"use client";

// Owner-only Meta (Facebook/Instagram) reconnect card. The owner generates a
// Facebook USER token themselves (only they can log into Facebook) and pastes it
// here once; the server mints the Page publishing token and self-refreshes after.
// This is what turns the daily auto-content publishing back ON.
import { useEffect, useState } from "react";

type Status = {
  facebook?: { connected?: boolean; page?: string; detail?: string };
  instagram?: { linked?: boolean; username?: string | null };
};

export default function MetaConnect() {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showHow, setShowHow] = useState(false);

  async function loadStatus() {
    try { const r = await fetch("/api/settings/meta-connect"); if (r.ok) setStatus(await r.json()); } catch { /* */ }
  }
  useEffect(() => { loadStatus(); }, []);

  async function connect() {
    const t = token.trim();
    if (!t) { setMsg("Paste your Facebook user token first."); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/settings/meta-connect", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userToken: t }),
      });
      const j = await r.json();
      if (r.ok && j.status === "healed") { setMsg("✅ Connected — your daily content will now auto-publish to Facebook/Instagram."); setToken(""); }
      else setMsg("⚠️ " + (j.detail || "Couldn't connect — double-check the token and its permissions."));
      await loadStatus();
    } catch { setMsg("⚠️ Connection error."); } finally { setBusy(false); }
  }

  const connected = !!status?.facebook?.connected;
  const ig = status?.instagram?.linked ? status?.instagram?.username : null;
  const dot = connected ? "bg-emerald-400" : "bg-amber-400";

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-300 space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-slate-200 text-sm">📣 Facebook / Instagram auto-publishing</p>
        <span className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${dot}`} />{connected ? <span className="text-emerald-400">Connected{status?.facebook?.page ? ` · ${status.facebook.page}` : ""}{ig ? ` · IG @${ig}` : ""}</span> : <span className="text-amber-400">Needs reconnect</span>}</span>
      </div>
      <p>Connect your Page so (1) the daily AI content posts itself for free organic reach, and (2) your <b>Facebook Lead Ads leads flow straight into the CRM</b> instead of getting stuck in Facebook. You generate a one-time Facebook token — only you can, since it needs your Facebook login — then paste it here. After that it self-refreshes.</p>

      <button onClick={() => setShowHow((v) => !v)} className="text-emerald-400 hover:text-emerald-300 underline">{showHow ? "Hide" : "How do I get the token?"}</button>
      {showHow && (
        <ol className="list-decimal pl-5 space-y-1 text-slate-400 bg-slate-950/40 rounded-lg p-3">
          <li>Open the <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" className="text-emerald-400 underline">Meta Graph API Explorer</a> (log in with the Facebook account that manages your Page).</li>
          <li>Under <b>Meta App</b>, pick your Fetti app. Click <b>Permissions</b> and add: <span className="text-slate-300">pages_show_list, pages_read_engagement, pages_manage_posts, business_management, instagram_basic, instagram_content_publish, leads_retrieval, pages_manage_metadata</span>.</li>
          <li>Click <b>Generate Access Token</b> and approve when Facebook asks. Copy the long token string it shows.</li>
          <li>Paste it below and hit Connect. (It&apos;s a temporary token — we exchange it for a long-lived one and refresh automatically from then on.)</li>
        </ol>
      )}

      <textarea value={token} onChange={(e) => setToken(e.target.value)} rows={3} placeholder="Paste your Facebook user token here…"
        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none font-mono text-[11px]" />
      <div className="flex items-center gap-3">
        <button onClick={connect} disabled={busy || !token.trim()} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg">{busy ? "Connecting…" : "Connect"}</button>
        {msg && <span className="text-slate-300">{msg}</span>}
      </div>
    </div>
  );
}

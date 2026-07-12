"use client";
// TODAY'S TIKTOK — the daily grab-and-post page. Bookmark it. Every morning it
// shows today's 9:16 Fetti-branded card (or the fresh episode video), a Download
// button, and the compliant caption with one-tap Copy. You post it and add music.
import { useEffect, useState } from "react";

type Card = { hook: string; caption: string; asset: string; fresh: boolean };
type Ep = { hook: string; caption: string; video: string };

export default function TikTokTodayPage() {
  const [data, setData] = useState<{ date: string; card: Card | null; episode: Ep | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/content/tiktok-today")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 401 ? "Please sign in to the CRM first." : "Failed to load"))))
      .then((j) => (j.ok ? setData(j) : setErr(j.error || "error")))
      .catch((e) => setErr(e.message));
  }, []);

  const copy = async (text: string, which: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(which); setTimeout(() => setCopied(null), 2000); } catch { /* */ }
  };

  const wrap = "min-h-screen bg-slate-950 text-slate-100 px-5 py-8 max-w-xl mx-auto";
  if (err) return <div className={wrap}><h1 className="text-xl font-bold mb-2">Today&apos;s TikTok</h1><p className="text-rose-300">{err}</p></div>;
  if (!data) return <div className={wrap}><p className="text-slate-400">Loading today&apos;s post…</p></div>;

  const ep = data.episode, card = data.card;
  const primary = ep ? { kind: "video" as const, media: ep.video, caption: ep.caption, hook: ep.hook } : card ? { kind: "image" as const, media: card.asset, caption: card.caption, hook: card.hook } : null;

  return (
    <div className={wrap}>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-extrabold tracking-tight">Today&apos;s TikTok 🦉</h1>
        <span className="text-xs text-slate-500">{data.date}</span>
      </div>
      <p className="text-sm text-slate-400 mb-6">Download → post on TikTok → add your music → paste the caption. Coincides with today&apos;s Instagram &amp; Facebook post.</p>

      {!primary && <p className="text-slate-400">No post generated yet today — the engine runs each morning. Check back shortly.</p>}

      {primary && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
          <div className="aspect-[9/16] bg-black flex items-center justify-center">
            {primary.kind === "video"
              ? <video src={primary.media} controls playsInline className="h-full w-full object-contain" />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={primary.media} alt={primary.hook} className="h-full w-full object-contain" />}
          </div>
          <div className="p-4 space-y-3">
            {ep && <p className="text-xs font-semibold text-emerald-300">🎬 Episode day — post this video (best reach), music optional.</p>}
            <div className="flex gap-2">
              <a href={primary.media} download className="flex-1 text-center rounded-xl bg-white text-slate-900 font-bold py-3">⬇︎ Download {primary.kind === "video" ? "video" : "image"}</a>
              <a href="https://www.tiktok.com/tiktokstudio/upload" target="_blank" rel="noreferrer" className="flex-1 text-center rounded-xl bg-rose-500 text-white font-bold py-3">Open TikTok ↗</a>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs uppercase tracking-wide text-slate-500">Caption</span>
                <button onClick={() => copy(primary.caption, "cap")} className="text-xs font-semibold text-sky-300">{copied === "cap" ? "Copied ✓" : "Copy caption"}</button>
              </div>
              <pre className="whitespace-pre-wrap text-sm text-slate-200 bg-slate-950/70 rounded-xl p-3 border border-slate-800 max-h-64 overflow-auto">{primary.caption}</pre>
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-500 mt-6">Add trending audio in the TikTok editor after upload. Everything else — brand art, caption, disclosures — is already done and compliant.</p>
    </div>
  );
}

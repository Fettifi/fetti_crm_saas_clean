"use client";

// Content Studio: the auto-generated social content queue. New posts (Reel
// scripts + captions + AI images) are created daily; you review, copy, download
// the image, and mark posted. Hit "Generate now" for an instant batch.
import { useEffect, useState } from "react";
import Image from "next/image";
import { Loader2, Sparkles, Copy, Check, Download, RefreshCw, CalendarClock } from "lucide-react";
import { SOCIAL_DISCLOSURE } from "@/lib/legal";

type Post = { id: string; type: string; hook: string; script: string; caption: string; hashtags: string; image_url?: string; status: string; created_at: string };

function CopyBtn({ text }: { text: string }) {
  const [d, setD] = useState(false);
  return <button onClick={() => { navigator.clipboard?.writeText(text); setD(true); setTimeout(() => setD(false), 1200); }}
    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700">{d ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}{d ? "Copied" : "Copy caption"}</button>;
}

export default function ContentStudio() {
  const [queued, setQueued] = useState<Post[]>([]);
  const [postedCount, setPostedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [gen, setGen] = useState(false);

  const [meta, setMeta] = useState<any>(null);
  const [tt, setTt] = useState<any>(null);
  async function load() {
    const r = await fetch("/api/content"); const j = await r.json();
    setQueued(j.queued || []); setPostedCount((j.posted || []).length); setLoading(false);
    fetch("/api/meta/status").then((x) => x.json()).then(setMeta).catch(() => {});
    fetch("/api/tiktok/status").then((x) => x.json()).then(setTt).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  // Surface the TikTok OAuth result (redirected back with ?tiktok=…).
  const [ttFlash, setTtFlash] = useState<string | null>(null);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("tiktok");
    if (!v) return;
    const m: Record<string, string> = { connected: "✅ TikTok connected!", error: "TikTok connection was cancelled.", badstate: "TikTok connect expired — try again.", fail: "TikTok connection failed — try again." };
    setTtFlash(m[v] || null);
    window.history.replaceState({}, "", "/content");
    setTimeout(() => setTtFlash(null), 5000);
  }, []);

  // --- TikTok video composer (you record the video, we post it) ---
  const [ttFile, setTtFile] = useState<File | null>(null);
  const [ttCaption, setTtCaption] = useState("");
  const [ttBusy, setTtBusy] = useState(false);
  const [ttMsg, setTtMsg] = useState<string | null>(null);
  async function postToTikTok() {
    if (!ttFile) { setTtMsg("Pick your recorded video file first."); return; }
    setTtBusy(true); setTtMsg("Uploading video…");
    try {
      const up = await fetch("/api/content/video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: ttFile.name }) });
      const uj = await up.json();
      if (!up.ok) throw new Error(uj.error || "Could not start upload");
      const put = await fetch(uj.signedUrl, { method: "PUT", headers: { "Content-Type": ttFile.type || "video/mp4", "x-upsert": "true" }, body: ttFile });
      if (!put.ok) throw new Error("Video upload failed");
      setTtMsg("Posting to TikTok…");
      const pr = await fetch("/api/tiktok/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoUrl: uj.publicUrl, caption: ttCaption }) });
      const pj = await pr.json();
      if (!pr.ok || !pj.ok) throw new Error(pj.error || "Publish failed");
      setTtMsg("✅ Sent to TikTok! Check your TikTok app.");
      setTtFile(null); setTtCaption("");
    } catch (e) { setTtMsg("⚠️ " + (e instanceof Error ? e.message : "error")); }
    finally { setTtBusy(false); }
  }

  async function generate() {
    setGen(true);
    try { await fetch("/api/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); await load(); }
    finally { setGen(false); }
  }
  const [pub, setPub] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  async function setStatus(id: string, status: string) {
    setQueued((q) => q.filter((p) => p.id !== id));
    await fetch("/api/content", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    if (status === "posted") setPostedCount((c) => c + 1);
  }
  async function approve(id: string) {
    setPub(id);
    try {
      const r = await fetch("/api/content/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const j = await r.json();
      if (j.connected) {
        const ok = (j.channels || []).filter((c: any) => c.ok).map((c: any) => c.platform);
        setFlash(ok.length ? `✅ Published to ${ok.join(", ")}` : `⚠️ ${(j.channels || [])[0]?.detail || "Publish failed"}`);
      } else {
        setFlash("Marked posted. Connect Meta (in Settings) to auto-publish next time.");
      }
      setQueued((q) => q.filter((p) => p.id !== id));
      setPostedCount((c) => c + 1);
      setTimeout(() => setFlash(null), 4000);
    } finally { setPub(null); }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">🎬 Content Studio</h1>
            <p className="text-slate-400 text-sm mt-1">Fresh posts are auto-created every morning. Review, copy, post. {postedCount} posted.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="flex items-center gap-2 text-sm bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
            <button onClick={generate} disabled={gen} className="flex items-center gap-2 text-sm bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 rounded-lg font-semibold">
              {gen ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {gen ? "Creating… (~20s)" : "Generate now"}
            </button>
          </div>
        </div>

        {/* Channel connection status */}
        {meta && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Auto-post channels:</span>
            <span className={`px-2.5 py-1 rounded-full border ${meta.facebook?.connected ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"}`}>
              📘 Facebook {meta.facebook?.connected ? `✓ ${meta.facebook?.page || ""}` : "— reconnect"}
            </span>
            <span className={`px-2.5 py-1 rounded-full border ${meta.instagram?.canPublish ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-700 bg-slate-900 text-slate-400"}`}>
              📸 Instagram {meta.instagram?.canPublish ? `✓ @${meta.instagram?.username || ""}` : meta.instagram?.linked ? "— linked, needs publish permission" : "— not connected"}
            </span>
            <span className={`px-2.5 py-1 rounded-full border ${tt?.connected ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-700 bg-slate-900 text-slate-400"}`}>
              🎵 TikTok {tt?.connected ? `✓ ${tt?.username || "connected"}` : tt?.configured ? "— connect account" : "— not set up"}
            </span>
          </div>
        )}

        {ttFlash && <div className="mt-3 rounded-lg bg-slate-900 border border-emerald-500/30 px-4 py-2 text-sm text-emerald-300">{ttFlash}</div>}

        {/* TikTok composer — you record the video, we post it to TikTok */}
        {tt && (
          <div className="mt-4 bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-lg">🎵</span>
                <div>
                  <div className="font-semibold text-sm">TikTok</div>
                  <div className="text-[11px] text-slate-400">{tt.detail || "Record a video from a script below, then post it here."}</div>
                </div>
              </div>
              {!tt.connected && (
                <a href="/api/tiktok/auth" className="text-xs px-3 py-1.5 rounded-md bg-fuchsia-600/90 hover:bg-fuchsia-500 font-semibold">
                  {tt.configured ? "Connect TikTok" : "Set up TikTok"}
                </a>
              )}
            </div>
            {tt.connected && (
              <div className="mt-4 space-y-3">
                <textarea value={ttCaption} onChange={(e) => setTtCaption(e.target.value)} rows={3}
                  placeholder="Caption (paste a caption from a queued post, or write your own)…"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm" />
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="text-xs px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 cursor-pointer">
                    {ttFile ? `🎬 ${ttFile.name.slice(0, 28)}` : "Choose video file"}
                    <input type="file" accept="video/*" className="hidden" onChange={(e) => setTtFile(e.target.files?.[0] || null)} />
                  </label>
                  <button onClick={postToTikTok} disabled={ttBusy || !ttFile}
                    className="text-xs px-3 py-1.5 rounded-md bg-fuchsia-600/90 hover:bg-fuchsia-500 disabled:opacity-50 font-semibold flex items-center gap-1">
                    {ttBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "🎵"} Post to TikTok
                  </button>
                  {!tt.canPublish && <span className="text-[11px] text-amber-400">App pending audit — posts go out private until TikTok approves.</span>}
                </div>
                {ttMsg && <div className="text-xs text-slate-300">{ttMsg}</div>}
                <div className="text-[10px] text-slate-500">✓ NMLS compliance disclosure is auto-added to the TikTok caption.</div>
              </div>
            )}
          </div>
        )}

        {flash && <div className="mt-4 rounded-lg bg-slate-900 border border-emerald-500/30 px-4 py-2 text-sm text-emerald-300">{flash}</div>}
        {loading && <div className="text-slate-500 mt-10 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
        {!loading && queued.length === 0 && (
          <div className="text-center py-16 text-slate-500">
            <CalendarClock className="w-10 h-10 mx-auto mb-3 text-emerald-400/50" />
            Your queue is empty. Hit <b className="text-slate-300">Generate now</b> to create a batch instantly — or wait for tomorrow morning&apos;s auto-drop.
          </div>
        )}

        <div className="space-y-4 mt-6">
          {queued.map((p) => (
            <div key={p.id} className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <span className={`text-xs px-2 py-0.5 rounded-full ${p.type === "image" ? "bg-fuchsia-500/15 text-fuchsia-300" : "bg-indigo-500/15 text-indigo-300"}`}>{p.type === "image" ? "🖼️ Image post" : "🎬 Reel / TikTok"}</span>
                <span className="text-[11px] text-slate-600">{new Date(p.created_at).toLocaleDateString()}</span>
              </div>

              {p.image_url && (
                <div className="mt-3 relative">
                  <Image src={p.image_url} alt="" width={1024} height={1024} unoptimized className="rounded-xl w-full max-w-xs" />
                  <a href={p.image_url} download target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs mt-2 text-emerald-400 hover:underline"><Download className="w-3.5 h-3.5" /> Download image</a>
                </div>
              )}

              <div className="mt-3 font-medium">🎯 {p.hook}</div>
              {p.script && p.type !== "image" && <div className="text-xs text-slate-400 mt-1"><b>Script:</b> {p.script}</div>}
              <div className="text-sm text-slate-300 mt-2 whitespace-pre-wrap">{p.caption}</div>
              <div className="text-[11px] text-emerald-400/80 mt-1">{p.hashtags}</div>
              <div className="text-[10px] text-slate-500 mt-2 whitespace-pre-wrap border-t border-slate-800 pt-2">✓ NMLS compliance disclosure auto-added to every post:{"\n"}{SOCIAL_DISCLOSURE.replace(/^—\n/, "")}</div>

              <div className="flex items-center gap-2 mt-4 flex-wrap">
                <button onClick={() => approve(p.id)} disabled={pub === p.id} className="text-xs px-3 py-1.5 rounded-md bg-emerald-600/90 hover:bg-emerald-500 disabled:opacity-50 font-semibold flex items-center gap-1">
                  {pub === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "✅"} Approve &amp; Publish
                </button>
                <CopyBtn text={`${p.caption}\n\n${p.hashtags}\n\n${SOCIAL_DISCLOSURE}`} />
                {tt?.connected && p.type !== "image" && (
                  <button onClick={() => { setTtCaption(`${p.caption}\n\n${p.hashtags}`); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                    className="text-xs px-3 py-1.5 rounded-md bg-fuchsia-600/20 hover:bg-fuchsia-600/40 text-fuchsia-300">🎵 Use for TikTok</button>
                )}
                <button onClick={() => setStatus(p.id, "posted")} className="text-xs px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300">Mark posted</button>
                <button onClick={() => setStatus(p.id, "skipped")} className="text-xs px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-400">Skip</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

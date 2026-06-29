"use client";

// TikTok Direct Post composer — built to TikTok's Content Posting "UX Guidelines"
// (https://developers.tiktok.com/doc/content-sharing-guidelines), which an app MUST
// implement to pass the Content Posting API audit. Every required element is here:
//   • creator nickname pulled FRESH from creator_info on open
//   • privacy selector populated from privacy_level_options, with NO default
//   • Comment / Duet / Stitch toggles, default OFF, greyed-out when the account
//     disables that interaction
//   • commercial-content disclosure (default OFF) → "Your Brand" / "Branded Content"
//   • a live content preview
//   • the exact consent declaration string with the required hyperlinks
//   • publish-status polling
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

const MUSIC_URL = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
const BC_URL = "https://www.tiktok.com/legal/page/global/bc-policy/en";

const PRIVACY_LABELS: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Public — everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends — mutual follows",
  FOLLOWER_OF_CREATOR: "Followers only",
  SELF_ONLY: "Private — only me",
};

type CreatorInfo = {
  ok: boolean;
  nickname?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  privacyOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxDurationSec?: number;
  error?: string;
};

type TtStatus = { configured?: boolean; connected?: boolean; canPublish?: boolean; username?: string | null; detail?: string };

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 text-sm ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}>
      <span className={`relative inline-block w-9 h-5 rounded-full transition ${checked && !disabled ? "bg-fuchsia-600" : "bg-slate-700"}`}>
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition ${checked && !disabled ? "translate-x-4" : ""}`} />
      </span>
      <span>{label}{disabled ? " (off for this account)" : ""}</span>
    </button>
  );
}

export default function TikTokComposer({ tt, caption, setCaption }: { tt: TtStatus; caption: string; setCaption: (v: string) => void }) {
  const [ci, setCi] = useState<CreatorInfo | null>(null);
  const [ciLoading, setCiLoading] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [privacy, setPrivacy] = useState<string>(""); // NO default — required by TikTok UX guidelines
  const [allowComment, setAllowComment] = useState(false);
  const [allowDuet, setAllowDuet] = useState(false);
  const [allowStitch, setAllowStitch] = useState(false);

  const [disclose, setDisclose] = useState(false);   // commercial content disclosure, default OFF
  const [brandOrganic, setBrandOrganic] = useState(false); // "Your Brand"
  const [brandedContent, setBrandedContent] = useState(false); // "Branded Content"

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadCreatorInfo = useCallback(() => {
    if (!tt?.connected) return;
    setCiLoading(true);
    fetch("/api/tiktok/creator-info")
      .then((r) => r.json())
      .then((d: CreatorInfo) => setCi(d))
      .catch(() => setCi({ ok: false, privacyOptions: [], commentDisabled: true, duetDisabled: true, stitchDisabled: true, error: "Could not load account info" }))
      .finally(() => setCiLoading(false));
  }, [tt?.connected]);

  // Fetch creator info FRESH whenever the composer is shown / account connects.
  useEffect(() => { loadCreatorInfo(); }, [loadCreatorInfo]);

  // Branded content can't be private — drop SELF_ONLY when it's selected.
  const privacyChoices = (ci?.privacyOptions || []).filter((p) => !(brandedContent && p === "SELF_ONLY"));
  useEffect(() => {
    if (brandedContent && privacy === "SELF_ONLY") setPrivacy("");
  }, [brandedContent, privacy]);

  const commercialLabel = brandedContent ? "Paid partnership" : brandOrganic ? "Promotional content" : null;
  const commercialValid = !disclose || brandOrganic || brandedContent;
  const canPost = !!file && !!privacy && commercialValid && !busy;

  async function poll(publishId: string) {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const s = await (await fetch(`/api/tiktok/publish-status?publish_id=${encodeURIComponent(publishId)}`)).json();
        if (s.status === "PUBLISH_COMPLETE") { setMsg("✅ Published to TikTok."); return; }
        if (s.status === "FAILED" || s.status === "ERROR") { setMsg("⚠️ TikTok reported: " + (s.detail || s.status)); return; }
        setMsg(`Posting… (${s.status?.toLowerCase().replace(/_/g, " ") || "processing"})`);
      } catch { /* keep polling */ }
    }
    setMsg("Sent to TikTok — still processing. Check your TikTok app/notifications.");
  }

  async function publish() {
    if (!file) { setMsg("Choose your recorded video file first."); return; }
    if (!privacy) { setMsg("Select who can view this video."); return; }
    if (brandedContent && privacy === "SELF_ONLY") { setMsg("Branded content can't be Private. Pick another audience."); return; }
    setBusy(true); setMsg("Uploading video…");
    try {
      const up = await fetch("/api/content/video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name }) });
      const uj = await up.json();
      if (!up.ok) throw new Error(uj.error || "Could not start upload");
      const put = await fetch(uj.signedUrl, { method: "PUT", headers: { "Content-Type": file.type || "video/mp4", "x-upsert": "true" }, body: file });
      if (!put.ok) throw new Error("Video upload failed");
      setMsg("Sending to TikTok…");
      const pr = await fetch("/api/tiktok/publish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: uj.publicUrl, caption,
          privacyLevel: privacy,
          allowComment, allowDuet, allowStitch,
          brandOrganic: disclose && brandOrganic,
          brandedContent: disclose && brandedContent,
        }),
      });
      const pj = await pr.json();
      if (!pr.ok || !pj.ok) throw new Error(pj.error || "Publish failed");
      setMsg("Posting… (processing upload)");
      setFile(null);
      await poll(pj.publishId);
    } catch (e) { setMsg("⚠️ " + (e instanceof Error ? e.message : "error")); }
    finally { setBusy(false); }
  }

  // ---- not connected / not configured ----
  if (!tt?.connected) {
    return (
      <div className="mt-4 bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎵</span>
            <div>
              <div className="font-semibold text-sm">TikTok — Direct Post</div>
              <div className="text-[11px] text-slate-400">{tt?.detail || "Connect your TikTok account to post videos from here."}</div>
            </div>
          </div>
          <a href="/api/tiktok/auth" className="text-xs px-3 py-1.5 rounded-md bg-fuchsia-600/90 hover:bg-fuchsia-500 font-semibold">
            {tt?.configured ? "Connect TikTok" : "Set up TikTok"}
          </a>
        </div>
      </div>
    );
  }

  const onlyPrivate = (ci?.privacyOptions || []).length > 0 && ci?.privacyOptions.every((p) => p === "SELF_ONLY");

  // ---- connected: the compliant composer ----
  return (
    <div className="mt-4 bg-slate-900/50 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-lg">🎵</span>
        <div className="flex-1">
          <div className="font-semibold text-sm">TikTok — Direct Post</div>
          <div className="text-[11px] text-slate-400">
            {ciLoading ? "Loading account…" : ci?.ok
              ? <>Posting to <b className="text-slate-200">@{ci.username || ci.nickname}</b></>
              : (ci?.error || "Connected.")}
          </div>
        </div>
        <button type="button" onClick={loadCreatorInfo} className="text-[11px] text-slate-500 hover:text-slate-300 underline">refresh</button>
      </div>

      {onlyPrivate && (
        <div className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
          Your app is pending TikTok audit — only <b>Private (only me)</b> is available until it&apos;s approved. Posts you make now are visible to you only.
        </div>
      )}

      {/* video + caption */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-xs px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 cursor-pointer">
          {file ? `🎬 ${file.name.slice(0, 30)}` : "Choose video file"}
          <input type="file" accept="video/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        {ci?.maxDurationSec ? <span className="text-[11px] text-slate-500">max {ci.maxDurationSec}s</span> : null}
      </div>
      <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3}
        placeholder="Caption…" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm" />

      {/* privacy — required, NO default */}
      <div>
        <label className="block text-xs font-medium text-slate-300 mb-1">Who can view this video <span className="text-fuchsia-400">*</span></label>
        <select value={privacy} onChange={(e) => setPrivacy(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm">
          <option value="" disabled>Select who can view this video…</option>
          {privacyChoices.map((p) => <option key={p} value={p}>{PRIVACY_LABELS[p] || p}</option>)}
        </select>
      </div>

      {/* interaction toggles — default OFF, greyed when account disables them */}
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Toggle label="Allow comments" checked={allowComment} disabled={ci?.commentDisabled} onChange={setAllowComment} />
        <Toggle label="Allow Duet" checked={allowDuet} disabled={ci?.duetDisabled} onChange={setAllowDuet} />
        <Toggle label="Allow Stitch" checked={allowStitch} disabled={ci?.stitchDisabled} onChange={setAllowStitch} />
      </div>

      {/* commercial content disclosure — default OFF */}
      <div className="border-t border-slate-800 pt-3">
        <Toggle label="Disclose video content (commercial / promotional)" checked={disclose} onChange={(v) => { setDisclose(v); if (!v) { setBrandOrganic(false); setBrandedContent(false); } }} />
        {disclose && (
          <div className="mt-2 ml-1 space-y-2 text-sm">
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={brandOrganic} onChange={(e) => setBrandOrganic(e.target.checked)} className="mt-1" />
              <span><b>Your Brand</b> — you are promoting yourself or your own business. Labeled <i>“Promotional content.”</i></span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={brandedContent} onChange={(e) => setBrandedContent(e.target.checked)} className="mt-1" />
              <span><b>Branded Content</b> — you are promoting another brand or third party. Labeled <i>“Paid partnership.”</i> (Can&apos;t be posted as Private.)</span>
            </label>
            {!commercialValid && <p className="text-[11px] text-amber-400">Select at least one option, or turn the disclosure off.</p>}
          </div>
        )}
      </div>

      {/* content preview */}
      <div className="border border-slate-800 rounded-lg p-3 bg-slate-950/60">
        <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Preview</div>
        <div className="text-sm text-slate-300">{file ? `🎬 ${file.name}` : <span className="text-slate-600">No video chosen yet</span>}</div>
        {caption && <div className="text-xs text-slate-400 mt-1 whitespace-pre-wrap">{caption}</div>}
        <div className="text-[11px] text-slate-500 mt-1">
          Audience: <b className="text-slate-300">{privacy ? (PRIVACY_LABELS[privacy] || privacy) : "—"}</b>
          {commercialLabel && <> · Label: <b className="text-slate-300">{commercialLabel}</b></>}
        </div>
        <div className="text-[10px] text-slate-600 mt-1">NMLS compliance disclosure is appended to the caption automatically.</div>
      </div>

      {/* consent declaration — exact required strings + hyperlinks */}
      <p className="text-[11px] text-slate-400">
        {brandedContent ? (
          <>By posting, you agree to TikTok&apos;s <a href={BC_URL} target="_blank" rel="noreferrer" className="underline text-slate-300">Branded Content Policy</a> and <a href={MUSIC_URL} target="_blank" rel="noreferrer" className="underline text-slate-300">Music Usage Confirmation</a>.</>
        ) : (
          <>By posting, you agree to TikTok&apos;s <a href={MUSIC_URL} target="_blank" rel="noreferrer" className="underline text-slate-300">Music Usage Confirmation</a>.</>
        )}
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={publish} disabled={!canPost}
          className="text-sm px-4 py-2 rounded-md bg-fuchsia-600/90 hover:bg-fuchsia-500 disabled:opacity-40 font-semibold flex items-center gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "🎵"} Post to TikTok
        </button>
        {msg && <span className="text-xs text-slate-300">{msg}</span>}
      </div>
    </div>
  );
}

// TikTok Content Posting API integration. Unlike Meta (which lets you post to your
// own Page/IG with no review), TikTok requires an approved developer app + OAuth.
// This module is the full plumbing: OAuth connect, self-healing token refresh,
// connection status, and Direct Post of a recorded video.
//
// Activation: set TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET (env or app_settings),
// then connect your account via /api/tiktok/auth. Until TikTok AUDITS your app you
// can only post privately (SELF_ONLY); after audit it auto-upgrades to public.
import { cfg, getSetting, setSetting } from "@/lib/settings";
import { SOCIAL_DISCLOSURE } from "@/lib/legal";

const AUTH = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN = "https://open.tiktokapis.com/v2/oauth/token/";
const API = "https://open.tiktokapis.com/v2";
// user.info.basic = who's connected; video.publish = direct post; video.upload = draft/inbox.
const SCOPES = "user.info.basic,video.publish,video.upload";
const MAX_BYTES = 64 * 1024 * 1024; // single-chunk upload ceiling

export function tiktokRedirectUri(): string {
  return process.env.TIKTOK_REDIRECT_URI || "https://app.fettifi.com/api/tiktok/callback";
}

// Build the OAuth authorize URL. Returns null if the app isn't configured yet.
export async function tiktokAuthUrl(state: string): Promise<string | null> {
  const key = await cfg("TIKTOK_CLIENT_KEY");
  if (!key) return null;
  const p = new URLSearchParams({
    client_key: key,
    response_type: "code",
    scope: SCOPES,
    redirect_uri: tiktokRedirectUri(),
    state,
  });
  return `${AUTH}?${p.toString()}`;
}

async function persistTokens(j: Record<string, unknown>) {
  if (j.access_token) await setSetting("TIKTOK_ACCESS_TOKEN", String(j.access_token));
  if (j.refresh_token) await setSetting("TIKTOK_REFRESH_TOKEN", String(j.refresh_token));
  if (j.open_id) await setSetting("TIKTOK_OPEN_ID", String(j.open_id));
  if (j.expires_in) await setSetting("TIKTOK_TOKEN_EXPIRES", String(Date.now() + Number(j.expires_in) * 1000));
}

// Exchange the OAuth code for tokens and store them (DB-first so they self-heal).
export async function tiktokExchangeCode(code: string): Promise<void> {
  const key = await cfg("TIKTOK_CLIENT_KEY");
  const secret = await cfg("TIKTOK_CLIENT_SECRET");
  if (!key || !secret) throw new Error("TikTok app not configured (TIKTOK_CLIENT_KEY/SECRET)");
  const body = new URLSearchParams({
    client_key: key, client_secret: secret, code,
    grant_type: "authorization_code", redirect_uri: tiktokRedirectUri(),
  });
  const r = await fetch(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error_description || j.error || "TikTok token exchange failed");
  await persistTokens(j);
}

// Refresh the access token if it's missing/expiring. TikTok access tokens last ~24h;
// refresh tokens ~365 days. Called before every status check and publish.
export async function tiktokHeal(): Promise<{ status: string }> {
  const token = await getSetting("TIKTOK_ACCESS_TOKEN");
  const refresh = await getSetting("TIKTOK_REFRESH_TOKEN");
  const exp = Number((await getSetting("TIKTOK_TOKEN_EXPIRES")) || 0);
  if (!refresh) return { status: token ? "ok" : "disconnected" };
  // Still valid for >2h? leave it.
  if (token && Date.now() < exp - 2 * 3600_000) return { status: "ok" };
  const key = await cfg("TIKTOK_CLIENT_KEY");
  const secret = await cfg("TIKTOK_CLIENT_SECRET");
  if (!key || !secret) return { status: token ? "ok" : "disconnected" };
  try {
    const body = new URLSearchParams({ client_key: key, client_secret: secret, grant_type: "refresh_token", refresh_token: refresh });
    const r = await fetch(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const j = await r.json();
    if (j.access_token) { await persistTokens(j); return { status: "refreshed" }; }
  } catch { /* keep old token */ }
  return { status: token ? "ok" : "error" };
}

export type TikTokStatus = {
  configured: boolean; connected: boolean; canPublish: boolean;
  username?: string | null; privacyOptions?: string[]; detail?: string;
};

// Report connection state for the UI (no secrets in the response).
export async function tiktokStatus(): Promise<TikTokStatus> {
  const key = await cfg("TIKTOK_CLIENT_KEY");
  if (!key) return { configured: false, connected: false, canPublish: false, detail: "Add your TikTok app key & secret to begin." };
  await tiktokHeal();
  const token = await getSetting("TIKTOK_ACCESS_TOKEN");
  if (!token) return { configured: true, connected: false, canPublish: false, detail: "Connect your TikTok account." };
  try {
    const r = await fetch(`${API}/post/publish/creator_info/query/`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const j = await r.json();
    if (j.error && j.error.code && j.error.code !== "ok") {
      return { configured: true, connected: false, canPublish: false, detail: j.error.message || "Reconnect TikTok." };
    }
    const d = j.data || {};
    const opts: string[] = d.privacy_level_options || [];
    return {
      configured: true, connected: true,
      canPublish: opts.length > 0,
      username: d.creator_nickname || d.creator_username || null,
      privacyOptions: opts,
      detail: opts.includes("PUBLIC_TO_EVERYONE") ? "Public posting approved." : "Connected (app pending audit — posts go out private until approved).",
    };
  } catch {
    return { configured: true, connected: true, canPublish: false, detail: "Connected (couldn't read creator info)." };
  }
}

export type TikTokPostOptions = {
  privacyLevel: string;          // one of creator_info.privacy_level_options (required)
  allowComment?: boolean;
  allowDuet?: boolean;
  allowStitch?: boolean;
  brandOrganic?: boolean;        // "Your Brand" → labeled Promotional content
  brandedContent?: boolean;      // "Branded Content" → labeled Paid partnership
};

export type TikTokCreatorInfo = {
  ok: boolean;
  nickname?: string;
  username?: string;
  avatarUrl?: string;
  privacyOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxDurationSec?: number;
  error?: string;
};

// Fresh creator_info for the Direct Post composer (privacy options, interaction
// flags, nickname). TikTok's UX guidelines require this before every post.
export async function tiktokCreatorInfo(): Promise<TikTokCreatorInfo> {
  await tiktokHeal();
  const token = await getSetting("TIKTOK_ACCESS_TOKEN");
  const off = { ok: false, privacyOptions: [] as string[], commentDisabled: true, duetDisabled: true, stitchDisabled: true };
  if (!token) return { ...off, error: "TikTok not connected" };
  try {
    const r = await fetch(`${API}/post/publish/creator_info/query/`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const j = await r.json();
    if (j.error && j.error.code && j.error.code !== "ok") return { ...off, error: j.error.message || "creator info failed" };
    const d = j.data || {};
    return {
      ok: true,
      nickname: d.creator_nickname || d.creator_username || undefined,
      username: d.creator_username || undefined,
      avatarUrl: d.creator_avatar_url || undefined,
      privacyOptions: d.privacy_level_options || [],
      commentDisabled: !!d.comment_disabled,
      duetDisabled: !!d.duet_disabled,
      stitchDisabled: !!d.stitch_disabled,
      maxDurationSec: d.max_video_post_duration_sec,
    };
  } catch (e) {
    return { ...off, error: e instanceof Error ? e.message : "error" };
  }
}

// Direct-post a recorded video to TikTok. videoUrl is a publicly-fetchable URL
// (e.g. Supabase Storage). Caption gets the compliance disclosure appended.
// Returns the TikTok publish_id. When `opts` is supplied (the compliant composer)
// the caller's explicit privacy + interaction + commercial choices are used;
// otherwise it auto-picks the most public privacy level allowed.
export async function tiktokPublishVideo(videoUrl: string, caption: string, opts?: TikTokPostOptions): Promise<string> {
  await tiktokHeal();
  const token = await getSetting("TIKTOK_ACCESS_TOKEN");
  if (!token) throw new Error("TikTok not connected");

  const vid = await fetch(videoUrl);
  if (!vid.ok) throw new Error("Could not fetch the uploaded video");
  const buf = Buffer.from(await vid.arrayBuffer());
  const size = buf.length;
  if (size === 0) throw new Error("Video file is empty");
  if (size > MAX_BYTES) throw new Error("Video is over 64MB — please upload a shorter/compressed clip");

  // Creator info → choose a valid privacy level (required by TikTok for direct post).
  const ciRes = await fetch(`${API}/post/publish/creator_info/query/`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const ci = await ciRes.json();
  if (ci.error && ci.error.code && ci.error.code !== "ok") throw new Error(ci.error.message || "TikTok creator info failed");
  const allowed: string[] = ci?.data?.privacy_level_options || ["SELF_ONLY"];
  const privacy = opts?.privacyLevel || (allowed.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : allowed[0]);
  if (!allowed.includes(privacy)) throw new Error("Selected audience isn't available for this account yet.");
  if (opts?.brandedContent && privacy === "SELF_ONLY") throw new Error("Branded content can't be posted as Private (Only me).");

  const title = [caption, SOCIAL_DISCLOSURE].filter(Boolean).join("\n\n").slice(0, 2150);
  const initBody = {
    post_info: {
      title, privacy_level: privacy,
      disable_comment: opts ? !opts.allowComment : false,
      disable_duet: opts ? !opts.allowDuet : false,
      disable_stitch: opts ? !opts.allowStitch : false,
      video_cover_timestamp_ms: 1000,
      brand_organic_toggle: !!opts?.brandOrganic,
      brand_content_toggle: !!opts?.brandedContent,
    },
    source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 },
  };
  const initRes = await fetch(`${API}/post/publish/video/init/`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(initBody),
  });
  const init = await initRes.json();
  if (init.error && init.error.code && init.error.code !== "ok") throw new Error(init.error.message || "TikTok init failed");
  const publishId: string = init?.data?.publish_id;
  const uploadUrl: string = init?.data?.upload_url;
  if (!publishId || !uploadUrl) throw new Error("TikTok did not return an upload URL");

  // Single-chunk upload of the whole file.
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Range": `bytes 0-${size - 1}/${size}` },
    body: buf,
  });
  if (!put.ok) throw new Error(`TikTok upload failed (${put.status})`);
  return publishId;
}

// Poll a Direct Post's status: PROCESSING_UPLOAD → PUBLISH_COMPLETE / FAILED.
export async function tiktokPublishStatus(publishId: string): Promise<{ status: string; detail?: string }> {
  const token = await getSetting("TIKTOK_ACCESS_TOKEN");
  if (!token) return { status: "ERROR", detail: "not connected" };
  try {
    const r = await fetch(`${API}/post/publish/status/fetch/`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const j = await r.json();
    if (j.error && j.error.code && j.error.code !== "ok") return { status: "ERROR", detail: j.error.message };
    const d = j.data || {};
    return { status: d.status || "UNKNOWN", detail: d.fail_reason || undefined };
  } catch (e) {
    return { status: "ERROR", detail: e instanceof Error ? e.message : "error" };
  }
}

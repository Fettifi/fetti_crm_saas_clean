// One-click publishing to connected social channels. Real Meta (Facebook Page +
// Instagram Business) publishing via the Graph API — activates as soon as a token
// is configured (META_ACCESS_TOKEN + META_IG_USER_ID + META_PAGE_ID), no app
// review needed for your own accounts. TikTok requires an approved Content
// Posting app, so it's reported as "needs connection" until that's set up.
import { cfg } from "@/lib/settings";
import { healMetaToken } from "@/lib/metaHeal";
import { SOCIAL_DISCLOSURE } from "@/lib/legal";

const GRAPH = "https://graph.facebook.com/v21.0";

// NOTE: for type "reel_video", image_url carries the VIDEO URL (content_posts has
// no video column and DDL isn't reachable headlessly — the type disambiguates).
type Post = { type?: string; caption?: string; hashtags?: string; image_url?: string | null };
export type PublishResult = { connected: boolean; channels: { platform: string; ok: boolean; detail: string }[] };

// Every caption carries the required mortgage-advertising disclosure (NMLS, EHO,
// not-a-commitment) — appended here so no post can go out without it.
const fullCaption = (p: Post) => [p.caption, p.hashtags, SOCIAL_DISCLOSURE].filter(Boolean).join("\n\n");

async function igPublish(igUserId: string, token: string, imageUrl: string, caption: string) {
  // 1) create media container
  const create = await fetch(`${GRAPH}/${igUserId}/media`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: token }),
  });
  const cj = await create.json();
  if (!create.ok || !cj.id) throw new Error(cj?.error?.message || "IG container failed");
  // 2) wait for the container to finish processing (avoids "Media ID not available")
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    try {
      const st = await (await fetch(`${GRAPH}/${cj.id}?fields=status_code&access_token=${token}`)).json();
      if (st.status_code === "FINISHED") break;
      if (st.status_code === "ERROR") throw new Error("IG media processing error");
    } catch { /* keep waiting */ }
  }
  // 3) publish
  const pub = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: cj.id, access_token: token }),
  });
  const pj = await pub.json();
  if (!pub.ok || !pj.id) throw new Error(pj?.error?.message || "IG publish failed");
  return pj.id as string;
}

// Publish a real VIDEO Reel (the Ray & Mark episodes — the viral vector).
// Container processing for video takes longer than images: poll up to ~2.5 min.
async function igReel(igUserId: string, token: string, videoUrl: string, caption: string) {
  const create = await fetch(`${GRAPH}/${igUserId}/media`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: "REELS", video_url: videoUrl, caption, share_to_feed: true, access_token: token }),
  });
  const cj = await create.json();
  if (!create.ok || !cj.id) throw new Error(cj?.error?.message || "IG reel container failed");
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const st = await (await fetch(`${GRAPH}/${cj.id}?fields=status_code&access_token=${token}`)).json();
      if (st.status_code === "FINISHED") break;
      if (st.status_code === "ERROR") throw new Error("IG reel processing error");
    } catch (e) { if (e instanceof Error && /processing error/.test(e.message)) throw e; }
  }
  const pub = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: cj.id, access_token: token }),
  });
  const pj = await pub.json();
  if (!pub.ok || !pj.id) throw new Error(pj?.error?.message || "IG reel publish failed");
  return pj.id as string;
}

async function fbVideo(pageId: string, token: string, videoUrl: string, description: string) {
  const r = await fetch(`${GRAPH}/${pageId}/videos`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_url: videoUrl, description, access_token: token }),
  });
  const j = await r.json();
  if (!r.ok || !j.id) throw new Error(j?.error?.message || "FB video failed");
  return j.id as string;
}

async function fbPhoto(pageId: string, token: string, imageUrl: string, caption: string) {
  const r = await fetch(`${GRAPH}/${pageId}/photos`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: imageUrl, caption, access_token: token }),
  });
  const j = await r.json();
  if (!r.ok || !(j.id || j.post_id)) throw new Error(j?.error?.message || "FB photo failed");
  return (j.post_id || j.id) as string;
}
async function fbText(pageId: string, token: string, message: string) {
  const r = await fetch(`${GRAPH}/${pageId}/feed`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, access_token: token }),
  });
  const j = await r.json();
  if (!r.ok || !j.id) throw new Error(j?.error?.message || "FB post failed");
  return j.id as string;
}

export async function publishPost(post: Post): Promise<PublishResult> {
  // Self-heal the token first (validate / auto-refresh) so a stale token never
  // causes a failed post when it could have been fixed automatically.
  try { await healMetaToken(); } catch { /* non-fatal */ }
  const token = await cfg("META_ACCESS_TOKEN");
  const pageId = await cfg("META_PAGE_ID");
  // Always use the Instagram account currently CONNECTED TO THE PAGE (that's the
  // only one publishable via the page token). Self-corrects once IG is linked.
  let igUser = await cfg("META_IG_USER_ID");
  if (token && pageId) {
    try {
      const pg = await (await fetch(`${GRAPH}/${pageId}?fields=instagram_business_account&access_token=${token}`)).json();
      igUser = pg?.instagram_business_account?.id || null;
    } catch { /* keep stored */ }
  }
  const channels: PublishResult["channels"] = [];
  const caption = fullCaption(post);

  if (!token || (!igUser && !pageId)) {
    return { connected: false, channels: [{ platform: "meta", ok: false, detail: "Connect Meta to auto-publish (set META_ACCESS_TOKEN + IDs)." }] };
  }

  // Instagram — real video Reels (Ray & Mark episodes) or brand-art image posts.
  const isVideo = post.type === "reel_video" && !!post.image_url;
  if (igUser && isVideo) {
    try { const id = await igReel(igUser, token, post.image_url!, caption); channels.push({ platform: "instagram", ok: true, detail: `Posted (${id}).` }); }
    catch (e) { channels.push({ platform: "instagram", ok: false, detail: e instanceof Error ? e.message : "error" }); }
  } else if (igUser && post.image_url) {
    try { const id = await igPublish(igUser, token, post.image_url, caption); channels.push({ platform: "instagram", ok: true, detail: `Posted (${id}).` }); }
    catch (e) { channels.push({ platform: "instagram", ok: false, detail: e instanceof Error ? e.message : "error" }); }
  } else if (igUser) {
    channels.push({ platform: "instagram", ok: false, detail: "Reel script has no media — post manually or wait for the produced video." });
  }

  // Facebook Page — video for episodes, photo for image posts, else text.
  if (pageId) {
    try {
      const id = isVideo ? await fbVideo(pageId, token, post.image_url!, caption)
        : post.image_url ? await fbPhoto(pageId, token, post.image_url, caption)
        : await fbText(pageId, token, caption);
      channels.push({ platform: "facebook", ok: true, detail: `Posted (${id}).` });
    } catch (e) { channels.push({ platform: "facebook", ok: false, detail: e instanceof Error ? e.message : "error" }); }
  }

  // TikTok — needs an approved Content Posting app.
  if (process.env.TIKTOK_ACCESS_TOKEN) {
    channels.push({ platform: "tiktok", ok: false, detail: "TikTok video posting requires an approved app — coming once connected." });
  }

  return { connected: true, channels };
}

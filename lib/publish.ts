// One-click publishing to connected social channels. Real Meta (Facebook Page +
// Instagram Business) publishing via the Graph API — activates as soon as a token
// is configured (META_ACCESS_TOKEN + META_IG_USER_ID + META_PAGE_ID), no app
// review needed for your own accounts. TikTok requires an approved Content
// Posting app, so it's reported as "needs connection" until that's set up.
import { cfg } from "@/lib/settings";
import { healMetaToken } from "@/lib/metaHeal";

const GRAPH = "https://graph.facebook.com/v21.0";

type Post = { type?: string; caption?: string; hashtags?: string; image_url?: string | null };
export type PublishResult = { connected: boolean; channels: { platform: string; ok: boolean; detail: string }[] };

const fullCaption = (p: Post) => [p.caption, p.hashtags].filter(Boolean).join("\n\n");

async function igPublish(igUserId: string, token: string, imageUrl: string, caption: string) {
  // 1) create media container
  const create = await fetch(`${GRAPH}/${igUserId}/media`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: token }),
  });
  const cj = await create.json();
  if (!create.ok || !cj.id) throw new Error(cj?.error?.message || "IG container failed");
  // 2) publish
  const pub = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: cj.id, access_token: token }),
  });
  const pj = await pub.json();
  if (!pub.ok || !pj.id) throw new Error(pj?.error?.message || "IG publish failed");
  return pj.id as string;
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

  // Instagram — image posts only (Reels need a video file we don't generate).
  if (igUser && post.image_url) {
    try { const id = await igPublish(igUser, token, post.image_url, caption); channels.push({ platform: "instagram", ok: true, detail: `Posted (${id}).` }); }
    catch (e) { channels.push({ platform: "instagram", ok: false, detail: e instanceof Error ? e.message : "error" }); }
  } else if (igUser) {
    channels.push({ platform: "instagram", ok: false, detail: "Reel needs a video — post the script manually on IG." });
  }

  // Facebook Page — photo if we have an image, else a text post.
  if (pageId) {
    try {
      const id = post.image_url ? await fbPhoto(pageId, token, post.image_url, caption) : await fbText(pageId, token, caption);
      channels.push({ platform: "facebook", ok: true, detail: `Posted (${id}).` });
    } catch (e) { channels.push({ platform: "facebook", ok: false, detail: e instanceof Error ? e.message : "error" }); }
  }

  // TikTok — needs an approved Content Posting app.
  if (process.env.TIKTOK_ACCESS_TOKEN) {
    channels.push({ platform: "tiktok", ok: false, detail: "TikTok video posting requires an approved app — coming once connected." });
  }

  return { connected: true, channels };
}

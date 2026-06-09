// Self-healing Meta token manager. Runs on a schedule (Doctor) and before every
// auto-post. It: (1) bootstraps the env token into the DB so it's manageable at
// runtime, (2) validates the current page token, (3) auto-refreshes it from a
// stored long-lived user token + app credentials when it's expiring/invalid —
// all with no human approval. Only a full re-auth (Meta requires a human login
// roughly every 60 days) can't be self-fixed; that's reported, not silently
// broken.
import { getSetting, setSetting, cfg } from "@/lib/settings";

const GRAPH = "https://graph.facebook.com/v21.0";

async function debugToken(token: string, appId: string, secret: string) {
  try {
    const r = await fetch(`${GRAPH}/debug_token?input_token=${token}&access_token=${appId}|${secret}`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    return j.data || {};
  } catch { return {}; }
}

export type HealResult = { status: "healthy" | "healed" | "needs_reauth" | "not_configured"; detail: string; daysLeft?: number };

export async function healMetaToken(): Promise<HealResult> {
  const appId = await cfg("META_APP_ID");
  const secret = await cfg("META_APP_SECRET");
  const pageId = await cfg("META_PAGE_ID");
  let token = await cfg("META_ACCESS_TOKEN");
  if (!token || !pageId) return { status: "not_configured", detail: "Meta not configured" };

  // Bootstrap: make sure the working token lives in the DB (manageable + override-able).
  if (!(await getSetting("META_ACCESS_TOKEN")) && process.env.META_ACCESS_TOKEN) {
    await setSetting("META_ACCESS_TOKEN", process.env.META_ACCESS_TOKEN);
    token = process.env.META_ACCESS_TOKEN;
  }
  // Persist app creds to the DB too, so heals work even if env changes.
  if (process.env.META_APP_ID && !(await getSetting("META_APP_ID"))) await setSetting("META_APP_ID", process.env.META_APP_ID);
  if (process.env.META_APP_SECRET && !(await getSetting("META_APP_SECRET"))) await setSetting("META_APP_SECRET", process.env.META_APP_SECRET);

  if (!appId || !secret) return { status: "healthy", detail: "token set (no app creds to validate)" };

  const d = await debugToken(token, appId, secret);
  const daysLeft = d.expires_at ? Math.round((d.expires_at * 1000 - Date.now()) / 86400000) : 9999;

  // Healthy and not about to expire → done.
  if (d.is_valid && daysLeft > 5) return { status: "healthy", detail: `valid, ~${daysLeft}d left`, daysLeft };

  // Expiring or invalid → try to refresh from a stored long-lived user token.
  const userTok = await getSetting("META_USER_TOKEN");
  if (userTok) {
    try {
      const ll = await (await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${secret}&fb_exchange_token=${userTok}`)).json();
      if (ll.access_token) {
        await setSetting("META_USER_TOKEN", ll.access_token); // keep the freshest long-lived user token
        const pj = await (await fetch(`${GRAPH}/${pageId}?fields=access_token&access_token=${ll.access_token}`)).json();
        if (pj.access_token) {
          await setSetting("META_ACCESS_TOKEN", pj.access_token);
          return { status: "healed", detail: "auto-refreshed the page token" };
        }
      }
    } catch { /* fall through */ }
  }

  if (d.is_valid) return { status: "healthy", detail: `valid, ~${daysLeft}d left`, daysLeft };
  return { status: "needs_reauth", detail: "token invalid and no usable user token to refresh — one Meta reconnect needed", daysLeft };
}

// Full connection status for the UI: is Facebook posting connected, is Instagram
// linked + publishable. Auto-stores the IG account id when it becomes publishable
// so posting wires itself up.
export async function metaConnectionStatus() {
  const appId = await cfg("META_APP_ID");
  const secret = await cfg("META_APP_SECRET");
  const pageId = await cfg("META_PAGE_ID");
  const token = await cfg("META_ACCESS_TOKEN");
  const out: any = {
    facebook: { connected: false, page: null as string | null, detail: "not configured" },
    instagram: { linked: false, canPublish: false, username: null as string | null },
  };
  if (!token || !pageId) return out;

  try {
    const r = await fetch(`${GRAPH}/${pageId}?fields=name,instagram_business_account{id,username}&access_token=${token}`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (j?.name) { out.facebook.connected = true; out.facebook.page = j.name; out.facebook.detail = "connected"; }
    else out.facebook.detail = j?.error?.message || "token issue";
    const ig = j?.instagram_business_account;
    if (ig?.id) { out.instagram.linked = true; out.instagram.username = ig.username || null; out.instagram.accountId = ig.id; }
  } catch { out.facebook.detail = "error reaching Meta"; }

  if (appId && secret) {
    try {
      const d = await debugToken(token, appId, secret);
      out.facebook.connected = out.facebook.connected && !!d.is_valid;
      const scopes: string[] = d.scopes || [];
      out.instagram.canPublish = out.instagram.linked && scopes.includes("instagram_content_publish");
      // Self-wire: once IG is publishable, store its id so posts go to IG too.
      if (out.instagram.canPublish && out.instagram.accountId) {
        await setSetting("META_IG_USER_ID", out.instagram.accountId);
      }
    } catch { /* */ }
  }
  return out;
}

// Accept a fresh user token (e.g. pasted once) and immediately mint + store a
// page token from it. After this, the system self-refreshes on its own.
export async function ingestUserToken(userToken: string): Promise<HealResult> {
  const appId = await cfg("META_APP_ID");
  const secret = await cfg("META_APP_SECRET");
  const pageId = await cfg("META_PAGE_ID");
  if (!appId || !secret || !pageId) return { status: "not_configured", detail: "missing app creds/page" };
  try {
    const ll = await (await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${secret}&fb_exchange_token=${userToken}`)).json();
    if (!ll.access_token) return { status: "needs_reauth", detail: ll?.error?.message || "could not extend token" };
    await setSetting("META_USER_TOKEN", ll.access_token);
    const pj = await (await fetch(`${GRAPH}/${pageId}?fields=access_token&access_token=${ll.access_token}`)).json();
    if (!pj.access_token) return { status: "needs_reauth", detail: pj?.error?.message || "no page token" };
    await setSetting("META_ACCESS_TOKEN", pj.access_token);
    return { status: "healed", detail: "connected + stored; will self-refresh from now on" };
  } catch (e) {
    return { status: "needs_reauth", detail: e instanceof Error ? e.message : "error" };
  }
}

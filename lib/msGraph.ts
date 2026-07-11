// Microsoft Graph — app-only (client-credentials) client for reading a mailbox.
// This is the PERMANENT inbound-email pipe: instead of a fragile Power Automate
// flow (premium HTTP connector) or a mail-reroute that would break M365 email,
// the CRM's own cron polls frank@fettifi.com (the nurture reply-to) via Graph and
// feeds new borrower replies into the same ingestion the webhook receiver uses.
//
// Creds come from cfg() (DB-first, then env), so they can be set as Vercel env vars
// OR self-healed into app_settings without a redeploy:
//   MS_GRAPH_TENANT_ID     — the Fetti M365 tenant (directory) id
//   MS_GRAPH_CLIENT_ID     — the Entra app registration's application (client) id
//   MS_GRAPH_CLIENT_SECRET — a client secret for that app
//   MS_GRAPH_MAILBOX       — mailbox to watch (default frank@fettifi.com)
// The app needs application permission Mail.Read (admin-consented), ideally scoped
// to only this mailbox via an Exchange Application Access Policy (least privilege).
import { cfg } from "@/lib/settings";

export type GraphCreds = { tenant: string | null; clientId: string | null; clientSecret: string | null; mailbox: string };

export async function graphCreds(): Promise<GraphCreds> {
  const [tenant, clientId, clientSecret, mailbox] = await Promise.all([
    cfg("MS_GRAPH_TENANT_ID"),
    cfg("MS_GRAPH_CLIENT_ID"),
    cfg("MS_GRAPH_CLIENT_SECRET"),
    cfg("MS_GRAPH_MAILBOX"),
  ]);
  return { tenant, clientId, clientSecret, mailbox: (mailbox || "frank@fettifi.com").toLowerCase() };
}

export async function graphConfigured(): Promise<boolean> {
  const c = await graphCreds();
  return !!(c.tenant && c.clientId && c.clientSecret);
}

// Client-credentials token (no user context). Cached in-module for its lifetime
// so a burst of polls doesn't re-mint on every call.
let _tok: { value: string; exp: number } | null = null;
export async function getGraphToken(): Promise<string | null> {
  if (_tok && _tok.exp > Date.now() + 60_000) return _tok.value;
  const c = await graphCreds();
  if (!c.tenant || !c.clientId || !c.clientSecret) return null;
  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(c.tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    console.error("[msGraph] token error", r.status, (await r.text().catch(() => "")).slice(0, 300));
    return null;
  }
  const j: any = await r.json().catch(() => ({}));
  if (!j?.access_token) return null;
  _tok = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return _tok.value;
}

export type GraphMessage = {
  id: string;
  from: string | null;
  subject: string;
  text: string;
  receivedDateTime: string;
};

// New messages in the watched mailbox's inbox with receivedDateTime strictly AFTER
// sinceISO, oldest-first (so watermarking is monotonic). Plain-text body requested
// via the Prefer header; falls back to stripping HTML if the server returns HTML.
export async function listInboxSince(sinceISO: string, top = 25): Promise<GraphMessage[]> {
  const token = await getGraphToken();
  if (!token) return [];
  const c = await graphCreds();
  const mbox = encodeURIComponent(c.mailbox);
  const url =
    `https://graph.microsoft.com/v1.0/users/${mbox}/mailFolders/inbox/messages` +
    `?$filter=${encodeURIComponent(`receivedDateTime gt ${sinceISO}`)}` +
    `&$orderby=${encodeURIComponent("receivedDateTime asc")}` +
    `&$top=${Math.max(1, Math.min(50, top))}` +
    `&$select=id,subject,from,receivedDateTime,body,bodyPreview`;
  const r = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      Prefer: 'outlook.body-content-type="text"',
      "content-type": "application/json",
    },
  });
  if (!r.ok) {
    console.error("[msGraph] list error", r.status, (await r.text().catch(() => "")).slice(0, 400));
    return [];
  }
  const j: any = await r.json().catch(() => ({}));
  const items: any[] = Array.isArray(j?.value) ? j.value : [];
  return items.map((m) => {
    let text: string = m?.body?.content || m?.bodyPreview || "";
    // If the Prefer header wasn't honored the body is HTML — strip tags.
    if (/<[a-z!/][^>]*>/i.test(text)) text = text.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
    return {
      id: String(m?.id || ""),
      from: (m?.from?.emailAddress?.address || "").toLowerCase() || null,
      subject: String(m?.subject || "").slice(0, 200),
      text: String(text).replace(/ /g, " ").slice(0, 8000),
      receivedDateTime: String(m?.receivedDateTime || ""),
    };
  });
}

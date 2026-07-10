// Admin: verify + auto-wire the Calendly webhook subscription so bookings reach
// the CRM (/api/calendly/webhook). Without this, every booking silently bypasses
// the funnel — no Engaged bump, no shield release, no meeting record (this was
// live-blind from launch until 2026-07-10). GET = status; POST = register.
// Auth-gated via the /api/admin matcher in proxy.ts.
// Needs CALENDLY_PAT (personal access token) in app_settings or env — created at
// calendly.com → Integrations → API & Webhooks → Personal Access Tokens.
import { NextResponse } from "next/server";
import crypto from "crypto";
import { cfg, setSetting } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEBHOOK = (process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com") + "/api/calendly/webhook";
const EVENTS = ["invitee.created", "invitee.canceled"];

async function cal(pat: string, path: string, init?: RequestInit) {
  const r = await fetch(`https://api.calendly.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const j = await r.json().catch(() => ({} as any));
  if (!r.ok) throw new Error(j?.message || j?.title || `Calendly ${r.status}`);
  return j;
}

async function context(pat: string) {
  const me = await cal(pat, "/users/me");
  const user: string = me?.resource?.uri;
  const org: string = me?.resource?.current_organization;
  if (!user || !org) throw new Error("Calendly /users/me returned no user/organization uri");
  const subs = await cal(pat, `/webhook_subscriptions?organization=${encodeURIComponent(org)}&scope=organization&count=100`);
  const ours = (subs?.collection || []).filter((s: any) => s?.callback_url === WEBHOOK);
  return { user, org, ours, all: subs?.collection || [] };
}

export async function GET() {
  const pat = await cfg("CALENDLY_PAT");
  if (!pat) {
    return NextResponse.json({
      configured: false,
      missing: "CALENDLY_PAT",
      hint: "Create a Personal Access Token at calendly.com → Integrations → API & Webhooks, store it as app_settings key CALENDLY_PAT, then POST here to register the webhook.",
      expected: WEBHOOK,
    });
  }
  try {
    const { org, ours, all } = await context(pat);
    const active = ours.find((s: any) => s?.state === "active");
    return NextResponse.json({
      configured: true, organization: org, expected: WEBHOOK,
      registered: !!active, state: active?.state || null,
      events: active?.events || null, createdAt: active?.created_at || null,
      otherSubscriptions: all.length - ours.length,
      signingKeyStored: !!(await cfg("CALENDLY_WEBHOOK_SIGNING_KEY")),
    });
  } catch (e: any) {
    const msg = e?.message || "lookup failed";
    const hint = /permission|denied|403/i.test(msg)
      ? "The PAT works but its user isn't a Calendly org admin/owner — organization webhooks need an admin's token."
      : "PAT rejected or expired — mint a fresh Personal Access Token in Calendly.";
    return NextResponse.json({ configured: true, error: msg, hint }, { status: 502 });
  }
}

export async function POST() {
  const pat = await cfg("CALENDLY_PAT");
  if (!pat) return NextResponse.json({ ok: false, error: "CALENDLY_PAT not set (app_settings or env)" }, { status: 503 });
  try {
    const { org, ours } = await context(pat);
    const active = ours.find((s: any) => s?.state === "active");
    const haveKey = !!(await cfg("CALENDLY_WEBHOOK_SIGNING_KEY"));
    if (active && haveKey) {
      return NextResponse.json({ ok: true, alreadyRegistered: true, uri: active.uri, events: active.events, note: "Subscription active + signing key stored — nothing to do." });
    }
    // A subscription without our stored signing key can't be verified — Calendly
    // does NOT return keys after creation (the caller PROVIDES one at create time),
    // so the only remedy is delete + recreate with a key we generate.
    if (active && !haveKey) {
      const uuid = String(active.uri || "").split("/").pop();
      if (uuid) await cal(pat, `/webhook_subscriptions/${uuid}`, { method: "DELETE" }).catch(() => {});
    }
    // WE generate the signing key and hand it to Calendly at creation (their API
    // takes signing_key as a caller-provided parameter — it never generates one).
    const signingKey = crypto.randomBytes(32).toString("hex");
    const created = await cal(pat, "/webhook_subscriptions", {
      method: "POST",
      body: JSON.stringify({ url: WEBHOOK, events: EVENTS, organization: org, scope: "organization", signing_key: signingKey }),
    });
    const res = created?.resource || {};
    // Persist only after Calendly accepted the subscription — the receiver reads
    // env OR app_settings and starts verifying (and creating unmatched leads) from
    // the moment this lands.
    await setSetting("CALENDLY_WEBHOOK_SIGNING_KEY", signingKey);
    return NextResponse.json({
      ok: true, registered: true, uri: res?.uri || null, events: res?.events || EVENTS,
      callbackUrl: res?.callback_url || WEBHOOK, signingKeyStored: true,
      recreated: !!active,
    });
  } catch (e: any) {
    const msg = e?.message || "registration failed";
    const hint = /permission|denied|403/i.test(msg)
      ? "PAT user must be a Calendly org admin/owner to create organization webhooks."
      : undefined;
    return NextResponse.json({ ok: false, error: msg, ...(hint ? { hint } : {}) }, { status: 502 });
  }
}

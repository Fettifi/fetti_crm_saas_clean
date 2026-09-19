// Resend delivery webhook → makes e-sign work like DocuSign's delivery tracking.
// When an email DELIVERS, BOUNCES, or is marked spam, Resend POSTs here and we flip
// the matching e-sign recipient's `delivery` state — so a mistyped/undeliverable
// address shows "✕ delivery failed" in the envelope list (instead of silently never
// arriving) and the team gets an immediate alert.
//
// SETUP (Ramon, one-time): in the Resend dashboard → Webhooks → add endpoint
//   https://app.fettifi.com/api/webhooks/resend  (events: email.delivered,
//   email.bounced, email.complained). Copy the signing secret into Vercel env as
//   RESEND_WEBHOOK_SECRET. Public route (Resend calls it) — verified by signature.
import { NextRequest, NextResponse } from "next/server";
import { alertOwnerSms } from "@/lib/phoneMessages";
import crypto from "crypto";
import { listRequests, mutateRequest } from "@/lib/esign";
import { logActivity } from "@/lib/activity";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { senderFrom } from "@/lib/notify/mailFrom";
import { recordEmailBounce } from "@/lib/comms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Svix signature verification (Resend uses Svix). Best-effort: only enforced when a
// secret is configured AND signature headers are present.
function verify(secret: string, h: Headers, body: string): boolean {
  try {
    const id = h.get("svix-id"), ts = h.get("svix-timestamp"), sig = h.get("svix-signature");
    if (!id || !ts || !sig) return false;
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
    return sig.split(" ").some((p) => p.split(",")[1] === expected);
  } catch { return false; }
}

async function alertBounce(env: any, name: string, email: string, kind: string) {
  const key = process.env.RESEND_API_KEY, from = senderFrom();
  const to = process.env.LEAD_NOTIFY_EMAIL || "ramon@fettifi.com";
  if (!key || !from) return;
  const verb = kind === "complained" ? "was marked as spam by" : "could not be delivered to";
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [to],
        subject: `⚠️ Signature email ${kind === "complained" ? "marked spam" : "bounced"}: ${name}`,
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#0f172a">
          <p>Heads up — the document <strong>"${env.title}"</strong> ${verb} <strong>${name}</strong> at <span style="font-family:monospace">${email}</span>.</p>
          <p>The email address is likely wrong. Open E-Sign, void this envelope, and resend it to the correct address.</p>
        </div>`,
      }),
    });
  } catch { /* best-effort */ }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  // FAIL CLOSED: an unset secret used to mean "accept everything", so this route's safety
  // depended on an env var happening to be present. Without the secret nothing here can be
  // trusted — a forged bounce flips a live signer to "delivery failed" and pages the team.
  if (!secret) return NextResponse.json({ error: "webhook secret not configured" }, { status: 503 });
  if (!verify(secret, req.headers, body)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let evt: any; try { evt = JSON.parse(body); } catch { return NextResponse.json({ ok: true }); }
  const map: Record<string, "delivered" | "bounced" | "complained"> = {
    "email.delivered": "delivered", "email.bounced": "bounced", "email.complained": "complained",
  };
  const delivery = map[evt?.type];
  const rawTo = evt?.data?.to;
  const emails = (Array.isArray(rawTo) ? rawTo : rawTo ? [rawTo] : []).map((e: any) => String(e).toLowerCase().trim()).filter(Boolean);
  if (!delivery || !emails.length) return NextResponse.json({ ok: true });

  // DELIVERY RECEIPTS for EVERY CRM email: stamp the matching Conversations row
  // (matched by Resend email id logged as providerId) with delivered/bounced —
  // and PAGE the owner on any bounce/complaint anywhere in the system.
  const emailId = String(evt?.data?.email_id || "");
  if (emailId) {
    try {
      const { data: rows } = await supabaseAdmin
        .from("activity_log").select("id, lead_id, detail").eq("action", "comms.message")
        .filter("detail->>providerId", "eq", emailId).limit(1);
      const rowMatch = (rows || [])[0];
      if (rowMatch) {
        const det: any = rowMatch.detail || {};
        if (!(det.delivery === "bounced" && delivery === "delivered")) {
          det.delivery = delivery; det.delivery_at = new Date().toISOString();
          await supabaseAdmin.from("activity_log").update({ detail: det }).eq("id", rowMatch.id);
        }
        if (delivery === "bounced" || delivery === "complained") {
          const subj = String(evt?.data?.subject || "").slice(0, 80);
          await alertOwnerSms(`⚠️ Email ${delivery}: "${subj}" to ${emails[0]} — resend or call them.`);
        }
      }
    } catch (e) { console.error("[resend webhook] receipt stamp failed:", e); }
  }

  // SUPPRESSION. Stamping the conversation row "bounced" was never enough on its own —
  // the drip read none of it and re-mailed the dead address on the next cycle. Feed the
  // suppression list so the send primitives refuse it from here on (lib/comms.ts).
  if (delivery === "bounced" || delivery === "complained") {
    const b = evt?.data?.bounce || {};
    for (const addr of emails) {
      await recordEmailBounce(addr, {
        kind: delivery,
        bounceType: b?.type ?? null,
        subType: b?.subType ?? null,
        message: b?.message ?? null,
      }).catch(() => {});
    }
  }

  // Only e-sign emails (subject "Please sign: …") matter for envelope delivery tracking;
  // skip the envelope scan for nurture/lead/preapproval emails.
  if (!/^Please sign:/i.test(String(evt?.data?.subject || ""))) return NextResponse.json({ ok: true });

  try {
    // The list read only finds WHICH envelopes this address belongs to. The write itself is a
    // compare-and-set against the fresh row (mutateRequest): the alerts below await network calls,
    // and saving the stale list copy afterwards could silently reopen an envelope that was signed,
    // voided or completed by the sender in the meantime.
    const reqs = await listRequests();
    // ATTRIBUTE THE EVENT TO THE EMAIL THAT WAS SENT, NOT TO EVERY ENVELOPE THAT KNOWS THE
    // ADDRESS. Matching on address alone stamped `email_delivered` onto every open envelope a
    // recipient appeared in — including recipients still `pending` (never routed) and envelopes
    // whose email this event was not about — and the Certificate of Completion then printed
    // deliveries that never happened (8 of 37 envelopes carried more deliveries than sends).
    // When the send recorded Resend's message id on the recipient, that id is the match; a
    // recipient that has not been sent anything can never be "delivered".
    const emailId = String(evt?.data?.email_id || "").trim();
    const matches = (rc: { email?: string | null; status?: string; emailId?: string | null }) => {
      if (rc.status === "pending" || rc.status === "not_signed") return false;
      if (emailId && rc.emailId) return rc.emailId === emailId;
      return !!rc.email && emails.includes(rc.email.toLowerCase().trim());
    };
    for (const listed of reqs) {
      if (listed.status === "completed" || listed.status === "voided") continue;
      if (!(listed.recipients || []).some(matches)) continue;
      const hit: { name: string; email: string }[] = [];
      const out = await mutateRequest(listed.token, (env) => {
        hit.length = 0;
        if (env.status === "completed" || env.status === "voided") return false;
        for (const rc of env.recipients || []) {
          if (!matches(rc)) continue;
          // Don't downgrade a confirmed delivery back to "sent"; bounce/complaint always wins.
          if (rc.delivery === "bounced" && delivery === "delivered") continue;
          rc.delivery = delivery;
          rc.deliveryAt = new Date().toISOString();
          env.events = [...(env.events || []), { type: `email_${delivery}`, at: rc.deliveryAt, detail: `${rc.name} <${rc.email}> — email ${delivery}` }];
          hit.push({ name: rc.name, email: String(rc.email) });
        }
        return hit.length > 0;
      }).catch((e) => { console.error("[resend webhook] envelope update", listed.token, e); return null; });
      if (!out?.applied || (delivery !== "bounced" && delivery !== "complained")) continue;
      for (const h of hit) {
        await logActivity({
          entity_type: "loan_file", entity_id: out.env.loan_file_id || out.env.token,
          loan_file_id: out.env.loan_file_id || null, lead_id: out.env.lead_id || null,
          actor: "system", action: "esign.delivery_failed",
          detail: { title: out.env.title, signer: h.name, email: h.email, type: delivery },
        }).catch(() => {});
        await alertBounce(out.env, h.name, h.email, delivery);
      }
    }
  } catch (e) { console.error("[resend webhook]", e); }
  return NextResponse.json({ ok: true });
}

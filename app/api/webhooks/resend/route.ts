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
import crypto from "crypto";
import { listRequests, saveRequest } from "@/lib/esign";
import { logActivity } from "@/lib/activity";

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
  const key = process.env.RESEND_API_KEY, from = process.env.LEAD_RESPONSE_FROM_EMAIL;
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
  if (secret && !verify(secret, req.headers, body)) {
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
  // Only e-sign emails (subject "Please sign: …") matter for envelope delivery tracking;
  // skip the envelope scan for nurture/lead/preapproval emails.
  if (!/^Please sign:/i.test(String(evt?.data?.subject || ""))) return NextResponse.json({ ok: true });

  try {
    const reqs = await listRequests();
    for (const env of reqs) {
      if (env.status === "completed" || env.status === "voided") continue;
      let changed = false;
      for (const rc of env.recipients || []) {
        if (rc.email && emails.includes(rc.email.toLowerCase().trim())) {
          // Don't downgrade a confirmed delivery back to "sent"; bounce/complaint always wins.
          if (rc.delivery === "bounced" && delivery === "delivered") continue;
          rc.delivery = delivery;
          rc.deliveryAt = new Date().toISOString();
          changed = true;
          env.events = env.events || [];
          env.events.push({ type: `email_${delivery}`, at: rc.deliveryAt, detail: `${rc.name} <${rc.email}> — email ${delivery}` });
          if (delivery === "bounced" || delivery === "complained") {
            await logActivity({
              entity_type: "loan_file", entity_id: env.loan_file_id || env.token,
              loan_file_id: env.loan_file_id || null, lead_id: env.lead_id || null,
              actor: "system", action: "esign.delivery_failed",
              detail: { title: env.title, signer: rc.name, email: rc.email, type: delivery },
            }).catch(() => {});
            await alertBounce(env, rc.name, rc.email, delivery);
          }
        }
      }
      if (changed) { env.updated_at = new Date().toISOString(); await saveRequest(env); }
    }
  } catch (e) { console.error("[resend webhook]", e); }
  return NextResponse.json({ ok: true });
}

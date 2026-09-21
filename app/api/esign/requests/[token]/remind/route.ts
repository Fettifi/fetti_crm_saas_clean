import { NextRequest, NextResponse } from "next/server";
import { mutateRequest, activeRecipient, getRequest } from "@/lib/esign";
import { sendSignRequest } from "@/lib/notify/docRequest";
import { logActivity } from "@/lib/activity";

// RESEND THE SIGNING LINK TO WHOEVER IT IS WAITING ON.
//
// There was no way to nudge a signer. If a borrower lost the email the only options were to
// void a live envelope and rebuild it — which throws away the audit trail and any signature
// already collected on a multi-signer document — or to read the link down the phone. So a
// document sat unsigned because the email was in a spam folder.
//
// This re-sends the SAME link to the SAME person. It creates nothing, changes no signature,
// and moves no one's turn. Auth-gated by the /api/esign/requests matcher in proxy.ts.
//
//   POST /api/esign/requests/<envelope token>/remind
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A signer should not be emailed twice in the same hour because a button was clicked twice.
// Four hours is a nudge; anything faster is pestering someone about their own mortgage.
const MIN_GAP_MS = 4 * 60 * 60 * 1000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const force = new URL(req.url).searchParams.get("force") === "1";

  const env = await getRequest(token);
  if (!env) return NextResponse.json({ error: "not found" }, { status: 404 });

  // WHOSE TURN IS IT. Never email someone whose turn has not come — a sequential envelope
  // routes one signer at a time, and a reminder to signer 2 while signer 1 is still holding
  // it would hand out a link that refuses them.
  const who = activeRecipient(env);
  if (!who) {
    const why = env.status === "completed" ? "This envelope is already complete."
      : env.status === "voided" ? "This envelope was voided."
      : env.status === "declined" ? "This envelope was declined."
      : "Everyone has already signed.";
    return NextResponse.json({ error: why }, { status: 409 });
  }
  if (!who.email && !who.phone) {
    return NextResponse.json({ error: `No email or phone on file for ${who.name}, so there's nowhere to send it.`, link: `${req.nextUrl.origin}/sign/${who.token}` }, { status: 422 });
  }
  // A bounced or spam-flagged address will bounce again. Say so and hand back the link
  // rather than quietly sending into a hole.
  if ((who.delivery === "bounced" || who.delivery === "complained") && !force) {
    return NextResponse.json({
      error: `${who.name}'s email previously ${who.delivery === "bounced" ? "bounced" : "was marked as spam"} (${who.email}). Fix the address or send them this link directly.`,
      link: `${req.nextUrl.origin}/sign/${who.token}`, needsNewAddress: true,
    }, { status: 409 });
  }
  const last = who.remindedAt ? Date.parse(who.remindedAt) : 0;
  if (last && Date.now() - last < MIN_GAP_MS && !force) {
    const mins = Math.ceil((MIN_GAP_MS - (Date.now() - last)) / 60000);
    return NextResponse.json({ error: `Already reminded ${who.name} recently — try again in about ${mins > 60 ? `${Math.round(mins / 60)} hours` : `${mins} minutes`}.`, link: `${req.nextUrl.origin}/sign/${who.token}` }, { status: 429 });
  }

  const link = `${req.nextUrl.origin}/sign/${who.token}`;
  let sent: string[] = []; let emailId: string | null = null;
  try {
    const out = await sendSignRequest({
      to_name: who.name, to_email: who.email, to_phone: who.phone,
      link, title: env.title, leadId: env.lead_id, loanFileId: env.loan_file_id,
    });
    sent = out.sent;
    emailId = out.emailId ?? null;
  } catch (e) { console.error("[esign/remind] send failed", e); }

  // NOTHING LEFT. Do not record a reminder that did not happen, and give the sender the
  // link so the borrower is not stuck waiting on a channel that is down.
  if (!sent.length) {
    return NextResponse.json({ error: `Couldn't reach ${who.name} on any channel. Send them this link directly.`, link }, { status: 502 });
  }

  const at = new Date().toISOString();
  await mutateRequest(token, (fresh) => {
    const rc = (fresh.recipients || []).find((r) => r.token === who.token);
    if (!rc) return false;
    // A reminder does not advance anyone: a "pending" recipient whose link has now actually
    // been sent becomes "sent"; a "viewed" recipient stays "viewed" — they already opened it.
    if (rc.status === "pending") rc.status = "sent";
    rc.remindedAt = at;
    rc.reminderCount = (rc.reminderCount || 0) + 1;
    if (sent.includes("email")) { rc.delivery = "sent"; rc.emailId = emailId || null; }
    fresh.events = [...(fresh.events || []), { type: "reminded", at, detail: `Reminder sent to ${rc.name} via ${sent.join(" + ")}` }];
    return true;
  }).catch((e) => { console.error("[esign/remind] could not record the reminder", e); return null; });

  await logActivity({
    entity_type: "esign", entity_id: token,
    loan_file_id: env.loan_file_id || undefined,
    actor: "user", action: "esign.reminded",
    detail: { title: env.title, signer: who.name, via: sent, reminder: (who.reminderCount || 0) + 1 },
  }).catch(() => {});

  return NextResponse.json({ ok: true, sent, signer: who.name, via: sent.join(" + "), link });
}

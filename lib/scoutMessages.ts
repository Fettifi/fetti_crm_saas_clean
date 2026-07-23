// Seller-outreach copy for Deal Scout. One place for every word a seller sees,
// so tone and compliance stay consistent.
//
// Positioning rules (non-negotiable):
//  - Ramon is a DIRECT BUYER responding to the seller's own published for-sale
//    listing. This is an invited business inquiry about THEIR ad — never a pitch
//    for services, never agent solicitation.
//  - Capital source stays open ("I can close quickly", never "our own money").
//  - SMS always carries the STOP opt-out line; sends are one human click per
//    deal from /scout — nothing here is ever blast/automated.
import type { ScoutDeal } from "@/lib/scoutStore";

function firstName(d: ScoutDeal): string {
  const n = (d.seller_name || "").trim();
  if (!n || /property owner/i.test(n)) return "";
  return n.split(/\s+/)[0];
}

function shortAddr(d: ScoutDeal): string {
  return d.address + (d.city ? `, ${d.city}` : "");
}

export function meetingSms(d: ScoutDeal, calendlyUrl: string): string {
  const hi = firstName(d) ? `Hi ${firstName(d)},` : "Hi,";
  return (
    `${hi} I saw your for-sale-by-owner listing at ${shortAddr(d)}. ` +
    `I'm a direct buyer — no agent, no commissions — and I'd like to talk about a straightforward offer. ` +
    `Grab any time on my calendar and it books instantly: ${calendlyUrl} ` +
    `— Ramon, Fetti Capital. Reply STOP to opt out.`
  );
}

export function meetingEmailSubject(d: ScoutDeal): string {
  return `About your listing at ${shortAddr(d)} — direct buyer`;
}

export function meetingEmailHtml(d: ScoutDeal, calendlyUrl: string): string {
  const hi = firstName(d) ? `Hi ${firstName(d)},` : "Hello,";
  return (
    `${hi}<br><br>` +
    `I came across your for-sale-by-owner listing at <b>${shortAddr(d)}</b> and I'm interested as a <b>direct buyer</b> — ` +
    `I'm not an agent and there are no commissions on my side of the table.<br><br>` +
    `I buy investment property, I do my own numbers, and I can move quickly when a deal makes sense for both of us. ` +
    `If you'd like to talk, pick any time that works on my calendar and it goes straight into my schedule — no phone tag:<br><br>` +
    `<a href="${calendlyUrl}" style="display:inline-block;background:#047857;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Pick a time to talk</a><br><br>` +
    `Or just reply to this email — it comes straight to me.<br><br>` +
    `Ramon Dent<br>Fetti Capital<br>` +
    `<span style="color:#64748b;font-size:12px">You're receiving this one-time note because your property is publicly listed for sale by owner. ` +
    `If you'd rather not hear from me, reply "no thanks" and I won't contact you again.</span>`
  );
}

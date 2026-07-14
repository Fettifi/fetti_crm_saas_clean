// Full, official email signature for Mark (Fetti's spokesperson) — appended to every
// automated follow-up email so they read like a real loan officer's email, not spam:
// logo, name, company, office line, contact, licensing, address, and a confidentiality
// footer. Office phone + mailing address are pulled from app_settings (OFFICE_PHONE,
// COMPANY_MAILING_ADDRESS) so they can be set without a redeploy; each line only renders
// when its value exists, so nothing ever shows a broken placeholder.
import { cfg } from "@/lib/settings";
import { LICENSING_SHORT } from "@/lib/legal";

const SITE = "https://fettifi.com";
const ASSET_BASE = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://app.fettifi.com").replace(/\/$/, "");

export async function markSignatureHtml(): Promise<string> {
  const phone = ((await cfg("OFFICE_PHONE")) || "").trim();
  const address = ((await cfg("COMPANY_MAILING_ADDRESS")) || "").trim();
  const fromEnv = process.env.LEAD_RESPONSE_FROM_EMAIL || "";
  const m = fromEnv.match(/<([^>]+)>/);
  const contactEmail = ((await cfg("CONTACT_EMAIL")) || (m ? m[1] : "loans@fettifi.com")).trim();

  const emerald = "#0c7a52", slate = "#0f172a", body = "#475569", faint = "#94a3b8";
  const phonePart = phone
    ? `<span style="white-space:nowrap">&#128222; Office: <a href="tel:${phone.replace(/[^0-9+]/g, "")}" style="color:${body};text-decoration:none">${phone}</a></span>&nbsp;&nbsp;&bull;&nbsp;&nbsp;`
    : "";
  const addressLine = address
    ? `<div style="margin-top:6px;font-size:11px;color:${faint}">${address}</div>`
    : "";

  return `
  <table cellpadding="0" cellspacing="0" role="presentation" style="margin-top:28px;border-top:2px solid ${emerald};padding-top:16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <tr>
      <td style="vertical-align:top;padding-right:14px">
        <img src="${ASSET_BASE}/fetti-emblem.png" width="48" height="48" alt="Fetti Financial Services LLC" style="display:block;border-radius:8px" />
      </td>
      <td style="vertical-align:top;font-size:13px;line-height:1.5">
        <div style="font-size:16px;font-weight:700;color:${slate}">Mark</div>
        <div style="font-size:12px;font-weight:600;color:${emerald}">Client Concierge &middot; Fetti Financial Services LLC</div>
        <div style="margin-top:7px;font-size:12px;color:${body}">
          ${phonePart}<span style="white-space:nowrap">&#9993; <a href="mailto:${contactEmail}" style="color:${body};text-decoration:none">${contactEmail}</a></span>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<span style="white-space:nowrap">&#127760; <a href="${SITE}" style="color:${body};text-decoration:none">fettifi.com</a></span>
        </div>
        ${addressLine}
        <div style="margin-top:9px;font-size:10px;color:${faint};line-height:1.5">${LICENSING_SHORT} &middot; Equal Housing Opportunity &#127968;</div>
      </td>
    </tr>
  </table>
  <div style="margin-top:14px;font-size:9px;color:#cbd5e1;line-height:1.45;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    This email is from Fetti Financial Services LLC and may contain confidential information intended only for the addressee. If you received it in error, please notify us and delete it. This is an advertisement, not a commitment to lend; all loans are subject to credit approval and program guidelines. To stop receiving these emails, reply &ldquo;unsubscribe.&rdquo;
  </div>`;
}

// Full company-branded signature for borrower-facing follow-ups — a real loan officer's
// email footer: Fetti logo, tagline, name + title, full contact (phone/email/web),
// licensing (NMLS + CA), Equal Housing Opportunity, mailing address, and the CAN-SPAM
// advertisement + one-click unsubscribe. All text renders even if a client blocks the
// remote logo image. Office phone / address come from app_settings (OFFICE_PHONE,
// COMPANY_MAILING_ADDRESS) with authoritative fallbacks.
export async function markSignatureLite(unsubscribeUrl?: string): Promise<string> {
  const phone = ((await cfg("OFFICE_PHONE")) || "+1 424.675.6295").trim();
  const address = ((await cfg("COMPANY_MAILING_ADDRESS")) || "5777 W Century Blvd Suite 1435\nLos Angeles, CA 90045").trim();
  const addressHtml = address.split(/\n|,\s*(?=Los Angeles)/).map((l) => l.trim()).filter(Boolean).join(", ");
  const fromEnv = process.env.LEAD_RESPONSE_FROM_EMAIL || "";
  const fm = fromEnv.match(/<([^>]+)>/);
  const email = ((await cfg("CONTACT_EMAIL")) || (fm ? fm[1] : "hello@fettifi.com")).trim();
  const emerald = "#0c7a52", slate = "#0f172a", body = "#475569", faint = "#94a3b8";
  const unsub = unsubscribeUrl
    ? ` To stop receiving these, <a href="${unsubscribeUrl}" style="color:#cbd5e1">unsubscribe</a>.`
    : ` To stop receiving these, reply &ldquo;unsubscribe.&rdquo;`;
  return `
  <div style="margin-top:26px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${body}">
    <div style="border-top:2px solid ${emerald};max-width:430px;margin-bottom:14px"></div>
    <img src="${ASSET_BASE}/fetti-logo.png" width="132" alt="Fetti Financial Services LLC" style="display:block;height:auto;margin-bottom:4px" />
    <div style="font-weight:800;color:${emerald};letter-spacing:.6px;font-size:12px">WE DO MONEY!</div>
    <div style="margin-top:11px;font-weight:700;color:${slate};font-size:15px">Mark</div>
    <div style="font-weight:600;color:${emerald};font-size:12px">Client Concierge &middot; Fetti Financial Services LLC</div>
    <div style="margin-top:8px;font-size:12px;color:${body}">
      &#128222; <a href="tel:${phone.replace(/[^0-9+]/g, "")}" style="color:${body};text-decoration:none">${phone}</a>
      &nbsp;&middot;&nbsp; &#9993; <a href="mailto:${email}" style="color:${body};text-decoration:none">${email}</a>
      &nbsp;&middot;&nbsp; &#127760; <a href="${SITE}" style="color:${body};text-decoration:none">fettifi.com</a>
    </div>
    <div style="margin-top:4px;font-size:11px;color:${faint}">${addressHtml}</div>
    <div style="margin-top:8px;font-size:10.5px;color:${faint}">NMLS #2267023 &nbsp;&middot;&nbsp; CA #60DBO-153798 &nbsp;&middot;&nbsp; &#127968; Equal Housing Opportunity</div>
    <div style="margin-top:12px;font-size:9.5px;color:#cbd5e1;line-height:1.45;max-width:540px">This is an advertisement from Fetti Financial Services LLC, not a commitment to lend; all loans are subject to credit approval and program guidelines.${unsub}</div>
  </div>`;
}

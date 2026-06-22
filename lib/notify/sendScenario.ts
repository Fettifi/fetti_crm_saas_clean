// Email a shopped loan scenario (PDF attached) to wholesale lenders for pricing + approval.
// Mirrors lib/notify/sendPreapproval.ts: same Resend transport, no-ops gracefully if unconfigured.

import { fmtMoney, type Scenario } from "@/lib/scenario";
import { BRAND } from "@/lib/brand";

async function sendOne(to: string, subject: string, html: string, pdfB64: string, filename: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_RESPONSE_FROM_EMAIL; // e.g. "Fetti Financial <hello@fettifi.com>"
  if (!key || !from) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [to], subject,
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#0f172a">${html}</div>`,
        attachments: [{ filename, content: pdfB64 }],
      }),
    });
    return res.ok;
  } catch { return false; }
}

export async function sendScenarioToWholesalers(
  s: Scenario,
  pdfBytes: Uint8Array,
  wholesalers: { company: string; contact_name?: string | null; email?: string | null }[]
): Promise<string[]> {
  const pdfB64 = Buffer.from(pdfBytes).toString("base64");
  const filename = `Scenario-${s.scenario_number}.pdf`;
  const subject =
    "Pricing request: " + (s.loan_type || "Loan") + " " + fmtMoney(s.loan_amount) +
    (s.state ? " in " + s.state : "") + " — Scenario " + s.scenario_number;
  const sent: string[] = [];

  for (const w of wholesalers) {
    if (!w.email) continue;
    const greet = w.contact_name || "there";
    const parts = [
      s.loan_type ? `${s.loan_type} loan` : "Loan",
      `of ${fmtMoney(s.loan_amount)}`,
      [s.property_type, s.occupancy].filter(Boolean).join(" / ") ? `on a ${[s.property_type, s.occupancy].filter(Boolean).join(" / ")}` : null,
      s.state ? `in ${s.state}` : null,
      s.credit_score != null ? `${s.credit_score} FICO` : null,
      s.ltv != null ? `${s.ltv}% LTV` : null,
    ].filter(Boolean);
    if (String(s.loan_type || "").toLowerCase().includes("dscr")) {
      if (s.monthly_rent != null) parts.push(`${fmtMoney(s.monthly_rent)}/mo rent`);
      if (s.dscr != null) parts.push(`${s.dscr} DSCR`);
    }
    const summary = parts.join(", ") + ".";
    const html =
      `Hi ${greet},<br><br>` +
      `We have a deal we'd love to get your pricing on: ${summary}<br><br>` +
      `The full scenario is attached — please reply with your rate, points, max LTV, term, and any conditions/approval.<br><br>` +
      `— ${BRAND.company} · NMLS #${BRAND.nmls}`;
    if (await sendOne(w.email, subject, html, pdfB64, filename)) sent.push(w.company);
  }
  return sent;
}

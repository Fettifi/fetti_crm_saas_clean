// Email a pre-approval letter (PDF attached) to the borrower and/or the agent.
// Both recipients are optional — only configured/provided ones get an email.
// No-ops gracefully if Resend isn't configured.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";

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

export async function sendPreapprovalEmails(
  l: any,
  pdfBytes: Uint8Array,
  opts: { borrower_email?: string | null; agent_email?: string | null }
): Promise<string[]> {
  const pdfB64 = Buffer.from(pdfBytes).toString("base64");
  const filename = `Pre-Approval-${l.letter_number}.pdf`;
  const link = `${APP_URL}/letter/${l.share_token}`;
  const sent: string[] = [];

  if (opts.borrower_email) {
    const first = (l.borrower_name || "there").split(" ")[0];
    const html = `Hi ${first},<br><br>Congratulations — your <b>pre-approval letter</b> from Fetti Financial Services is attached, and you can view or download it anytime here:<br><a href="${link}">${link}</a><br><br>Share it with your real estate agent or seller when you're ready to make an offer. A Fetti specialist will be in touch with next steps.<br><br>— Fetti Financial Services LLC · NMLS #2267023`;
    if (await sendOne(opts.borrower_email, "Your Fetti Financial Services LLC pre-approval letter", html, pdfB64, filename)) sent.push("borrower");
  }
  if (opts.agent_email) {
    const html = `Hello,<br><br>Attached is the <b>pre-approval letter</b> for your client <b>${l.borrower_name}</b>${l.loan_amount ? ` (up to $${Math.round(Number(l.loan_amount)).toLocaleString()})` : ""}, issued by Fetti Financial Services.<br><br>View online: <a href="${link}">${link}</a><br><br>We'd love to be your lending partner — fast closes, constant updates. Reach out anytime.<br><br>— Fetti Financial Services LLC · NMLS #2267023`;
    if (await sendOne(opts.agent_email, `Pre-approval for your client ${l.borrower_name}`, html, pdfB64, filename)) sent.push("agent");
  }
  return sent;
}

// SEND CLIENT MAIL AS ramon@fettifi.com, THROUGH GRAPH, WITH PROOF.
//
// Written 2026-09-08 after AppleScript-to-Outlook failed three ways in one afternoon, each
// one SILENTLY:
//   • it sent Tim Bryant's package from ramon.dent@lausd.net — the LAUSD account is Outlook's
//     default and New Outlook exposes NO accounts to AppleScript (exchange/imap/pop all
//     report 0), so the account cannot be chosen;
//   • setting `sender` explicitly made the message vanish — reported "sent", never delivered,
//     not left in Drafts;
//   • `delete` and `move` on a message report success and do nothing.
// Nothing in that path fails loudly, so nothing in it can be trusted without an external check.
//
// This replaces it. Graph picks the mailbox explicitly (/users/{from}), createReply threads
// into the real conversation (In-Reply-To + References), and the send is auditable in Sent
// Items. Attachments over 3MB go through an upload session, which the inline route rejects.
//
// NEEDS (application permissions, admin-consented, on app "Fetti CRM Mail Poll"):
//   Mail.ReadWrite  — createReply writes a draft
//   Mail.Send       — sends it
// Preflight refuses to run without both, naming what is missing, rather than half-sending.
//
//   npx tsx --conditions=react-server scripts/send-as-ramon.ts --check
//   npx tsx --conditions=react-server scripts/send-as-ramon.ts --to <addr> --reply-to-id <id> \
//       --body-html <file> --attach-dir <dir> [--send]
import "./_env";
import { getGraphToken } from "../lib/msGraph";
import { readFileSync, readdirSync, statSync } from "fs";

const G = "https://graph.microsoft.com/v1.0";
const FROM = process.env.SEND_AS || "ramon@fettifi.com";

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (n: string) => process.argv.includes(`--${n}`);

async function roles(tok: string): Promise<string[]> {
  return JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString()).roles || [];
}

/** Refuse rather than half-send. A missing role must be named, not discovered as a 403 midway. */
async function preflight(tok: string): Promise<string[]> {
  const have = await roles(tok);
  return ["Mail.ReadWrite", "Mail.Send"].filter((r) => !have.includes(r));
}

async function main() {
  const tok = await getGraphToken();
  if (!tok) throw new Error("no Graph token — MS_GRAPH_* not configured");
  const missing = await preflight(tok);

  if (has("check") || !arg("to")) {
    console.log(`app roles : ${(await roles(tok)).sort().join(", ") || "(none)"}`);
    console.log(`send-as   : ${FROM}`);
    console.log(missing.length
      ? `\nNOT READY — still missing: ${missing.join(", ")}\nGrant them as APPLICATION permissions and click "Grant admin consent".`
      : `\nREADY — ${FROM} can send with threading and a Sent Items record.`);
    return;
  }
  if (missing.length) throw new Error(`refusing to send — missing ${missing.join(", ")}. Run with --check.`);

  const to = arg("to")!;
  const replyToId = arg("reply-to-id");
  const bodyHtml = readFileSync(arg("body-html")!, "utf8");
  const dir = arg("attach-dir");
  const H = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };

  // createReply keeps the conversation intact: same thread in the recipient's client.
  let id: string;
  if (replyToId) {
    const r = await fetch(`${G}/users/${FROM}/messages/${encodeURIComponent(replyToId)}/createReply`, { method: "POST", headers: H });
    const d: any = await r.json();
    if (!r.ok) throw new Error(`createReply ${r.status}: ${JSON.stringify(d).slice(0, 300)}`);
    id = d.id;
    // Replace recipients outright: createReply seeds them from the original, which on a
    // CC'd thread would quietly include people who must not receive the attachments.
    const patch = await fetch(`${G}/users/${FROM}/messages/${encodeURIComponent(id)}`, {
      method: "PATCH", headers: H,
      body: JSON.stringify({
        body: { contentType: "HTML", content: bodyHtml + (d.body?.content || "") },
        toRecipients: [{ emailAddress: { address: to } }],
        ccRecipients: [],
      }),
    });
    if (!patch.ok) throw new Error(`patch ${patch.status}: ${(await patch.text()).slice(0, 300)}`);
  } else {
    const r = await fetch(`${G}/users/${FROM}/messages`, {
      method: "POST", headers: H,
      body: JSON.stringify({ subject: arg("subject") || "(no subject)", body: { contentType: "HTML", content: bodyHtml }, toRecipients: [{ emailAddress: { address: to } }] }),
    });
    const d: any = await r.json();
    if (!r.ok) throw new Error(`create ${r.status}: ${JSON.stringify(d).slice(0, 300)}`);
    id = d.id;
  }

  if (dir) {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith(".") || name.endsWith(".txt")) continue;
      const p = `${dir}/${name}`, size = statSync(p).size, buf = readFileSync(p);
      if (size < 3 * 1024 * 1024) {
        const r = await fetch(`${G}/users/${FROM}/messages/${encodeURIComponent(id)}/attachments`, {
          method: "POST", headers: H,
          body: JSON.stringify({ "@odata.type": "#microsoft.graph.fileAttachment", name, contentBytes: buf.toString("base64") }),
        });
        if (!r.ok) throw new Error(`attach ${name} ${r.status}: ${(await r.text()).slice(0, 200)}`);
      } else {
        // Over 3MB the inline route 413s; an upload session is the only path.
        const s0 = await fetch(`${G}/users/${FROM}/messages/${encodeURIComponent(id)}/attachments/createUploadSession`, {
          method: "POST", headers: H, body: JSON.stringify({ AttachmentItem: { attachmentType: "file", name, size } }),
        });
        const s: any = await s0.json();
        if (!s0.ok) throw new Error(`session ${name}: ${JSON.stringify(s).slice(0, 200)}`);
        const CH = 4 * 1024 * 1024;
        for (let o = 0; o < size; o += CH) {
          const end = Math.min(o + CH, size) - 1;
          const up = await fetch(s.uploadUrl, {
            method: "PUT",
            headers: { "Content-Length": String(end - o + 1), "Content-Range": `bytes ${o}-${end}/${size}` },
            body: buf.subarray(o, end + 1),
          });
          if (!up.ok && up.status !== 201 && up.status !== 202) throw new Error(`chunk ${name} ${up.status}`);
        }
      }
      console.log(`  attached ${name} (${(size / 1048576).toFixed(2)} MB)`);
    }
  }

  // Read the draft back and show what will go out. A send is not reported until it is proven.
  const v = await fetch(`${G}/users/${FROM}/messages/${encodeURIComponent(id)}?$select=subject,toRecipients,ccRecipients,hasAttachments`, { headers: H });
  const vd: any = await v.json();
  console.log(`\n  from    : ${FROM}`);
  console.log(`  subject : ${vd.subject}`);
  console.log(`  to      : ${(vd.toRecipients || []).map((t: any) => t.emailAddress.address).join(", ")}`);
  console.log(`  cc      : ${(vd.ccRecipients || []).map((t: any) => t.emailAddress.address).join(", ") || "(none)"}`);

  if (!has("send")) { console.log(`\nDRAFT ONLY — re-run with --send to deliver. id=${id}`); return; }
  const s = await fetch(`${G}/users/${FROM}/messages/${encodeURIComponent(id)}/send`, { method: "POST", headers: H });
  if (!s.ok) throw new Error(`send ${s.status}: ${(await s.text()).slice(0, 300)}`);
  console.log("\nSENT — verify in Sent Items before reporting it as delivered.");
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });

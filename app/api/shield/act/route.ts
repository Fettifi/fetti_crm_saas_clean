// Owner one-click resolve from the quarantine email/digest:
//   GET  /api/shield/act?lead=<id>&action=promote|dismiss&t=<hmac32>  → confirmation page
//   POST (the page's button)                                          → executes
// Public by design — the HMAC token (leadShield.shieldActionToken) is the auth,
// same trust model as the unsubscribe and magic-apply links. The GET only RENDERS:
// email scanners and link unfurlers prefetch GETs, and a prefetch must never
// promote or dismiss a lead. Idempotent on the POST.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { verifyShieldToken, promoteQuarantined, dismissQuarantined } from "@/lib/leadShield";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// promote replays the full agent pipeline synchronously — needs headroom
export const maxDuration = 120;

const esc = (v: string) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const page = (title: string, body: string, ok = true) => new NextResponse(
  `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center;max-width:440px;padding:24px"><div style="font-size:40px">${ok ? "🛡️" : "⚠️"}</div><h2 style="margin:12px 0 8px">${title}</h2><div style="color:#94a3b8;line-height:1.5">${body}</div></div></body>`,
  { status: ok ? 200 : 401, headers: { "Content-Type": "text/html; charset=utf-8" } },
);

type Checked = { leadId: string; action: "promote" | "dismiss"; name: string; resolved: string | null } | { error: NextResponse };

async function check(req: NextRequest): Promise<Checked> {
  if (!(await rateLimit(`shieldact:${clientIp(req)}`, 30, 600))) return { error: page("Slow down", "Too many attempts — wait a few minutes.", false) };
  const leadId = req.nextUrl.searchParams.get("lead") || "";
  const action = req.nextUrl.searchParams.get("action") || "";
  const t = req.nextUrl.searchParams.get("t") || "";
  if (!leadId || !verifyShieldToken(leadId, action, t)) return { error: page("Invalid link", "This link is not valid.", false) };
  const { data: row } = await supabaseAdmin.from("leads").select("id, full_name, stage, raw").eq("id", leadId).maybeSingle();
  if (!row) return { error: page("Not found", "That lead no longer exists.", false) };
  const name = esc(String((row as any).full_name || "the lead")).slice(0, 80);
  const inReview = String((row as any).stage || "").toLowerCase() === "review";
  return { leadId, action: action as "promote" | "dismiss", name, resolved: inReview ? null : ((row as any).raw?.shield?.resolution || "released") };
}

// GET: render the confirmation page only — never mutate on a GET.
export async function GET(req: NextRequest) {
  const c = await check(req);
  if ("error" in c) return c.error;
  if (c.resolved) return page("Already resolved", `${c.name} was already ${c.resolved === "dismissed" ? "dismissed as junk" : "released"} — nothing else to do.`);
  const qs = req.nextUrl.searchParams.toString().replace(/"/g, "&quot;");
  const verb = c.action === "promote"
    ? { btn: "✓ Yes — release into the pipeline", color: "#0c7a52", desc: `Release <b>${c.name}</b>? First touch and the agent pipeline run immediately.` }
    : { btn: "✕ Yes — dismiss as junk", color: "#7f1d1d", desc: `Dismiss <b>${c.name}</b> as junk? The lead is marked Dead; nothing was ever sent to them.` };
  return page("Confirm", `${verb.desc}<br><br><form method="POST" action="/api/shield/act?${qs}"><button type="submit" style="background:${verb.color};color:#fff;font-weight:600;padding:10px 22px;border-radius:8px;border:0;font-size:15px;cursor:pointer">${verb.btn}</button></form>`);
}

// POST: execute (the confirmation button submits here).
export async function POST(req: NextRequest) {
  const c = await check(req);
  if ("error" in c) return c.error;
  if (c.resolved) return page("Already resolved", `${c.name} was already ${c.resolved === "dismissed" ? "dismissed as junk" : "released"} — nothing else to do.`);
  if (c.action === "promote") {
    const ok = await promoteQuarantined(c.leadId, "owner:email-link", "owner_promote");
    return ok
      ? page("Released ✓", `${c.name} is back in the pipeline — first touch and the agent pipeline are running now.`)
      : page("Could not release", "Try again from the CRM leads screen.", false);
  }
  const ok = await dismissQuarantined(c.leadId, "owner:email-link");
  return ok
    ? page("Dismissed ✓", `${c.name} is marked junk (Dead, paused). Nothing was ever sent to them, and Meta never counts them.`)
    : page("Could not dismiss", "Try again from the CRM leads screen.", false);
}

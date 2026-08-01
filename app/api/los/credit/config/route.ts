// GET/POST /api/los/credit/config — set the Credco endpoint + credentials from inside the
// CRM instead of a Vercel env round-trip and a redeploy.
//
// Auth-gated by the /api/los matcher. Two rules make this safe enough to hold a bureau
// credential:
//   • The password is stored ENCRYPTED (lib/crypto encryptField) and is NEVER returned —
//     GET reports only whether each value is present, plus a masked tail so the LO can tell
//     which account is wired without the secret leaving the server.
//   • Anything already set in Vercel env WINS (see credcoCreds) and cannot be overwritten
//     from here, so a properly-configured production deploy can't be repointed through the UI.
import { NextRequest, NextResponse } from "next/server";
import { setSetting } from "@/lib/settings";
import { encryptField } from "@/lib/crypto";
import { credcoCreds } from "@/lib/credit";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tail = (v?: string) => (v ? `••••${String(v).slice(-4)}` : null);

export async function GET() {
  const c = await credcoCreds();
  return NextResponse.json({
    configured: !!(c.url && c.user && c.password),
    url: c.url || null,                       // an endpoint is not a secret
    account: c.account || null,
    user: c.user || null,
    passwordSet: !!c.password,
    passwordHint: tail(c.password),
    envLocked: !!(process.env.CREDCO_URL && process.env.CREDCO_USER && process.env.CREDCO_PASSWORD),
  });
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({} as any));
    const clean = (v: unknown) => { const s = String(v ?? "").trim(); return s || null; };

    const url = clean(b.url);
    // Refuse plain HTTP outright: a credit request carries the borrower's full SSN and date
    // of birth, and sending that unencrypted would be an FCRA/GLBA problem, not a style one.
    if (url && !/^https:\/\//i.test(url)) {
      return NextResponse.json({ error: "The endpoint must be https." }, { status: 400 });
    }

    const saved: string[] = [];
    if (url) { await setSetting("CREDCO_URL", url); saved.push("url"); }
    const account = clean(b.account);
    if (account) { await setSetting("CREDCO_ACCOUNT", account); saved.push("account"); }
    const user = clean(b.user);
    if (user) { await setSetting("CREDCO_USER", user); saved.push("user"); }
    const password = clean(b.password);
    if (password) {
      const enc = encryptField(password);
      if (!enc) return NextResponse.json({ error: "Could not encrypt the password — check the app encryption key." }, { status: 500 });
      await setSetting("CREDCO_PASSWORD", enc);
      saved.push("password");
    }
    if (!saved.length) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });

    // Log WHAT changed, never the values.
    await logActivity({
      entity_type: "system", entity_id: "credco", actor: "user", action: "credco.config",
      detail: { fields: saved },
    }).catch(() => {});

    const c = await credcoCreds();
    return NextResponse.json({ ok: true, saved, configured: !!(c.url && c.user && c.password) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

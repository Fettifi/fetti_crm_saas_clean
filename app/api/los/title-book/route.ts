// Title/escrow-company address book — the LO's saved list of title companies + contacts,
// shown as a dropdown on the loan-file title-order panel so a pick auto-fills company /
// contact / email / mortgagee clause. Persisted in app_settings (key `title_companies`).
// Auth-gated by the /api/los matcher. No fabricated contacts — the LO fills real emails.
import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = "title_companies";
type Co = { company: string; contact?: string; email?: string; phone?: string; clause?: string };

// Starter scaffold — company names the LO can complete with the right contact/email once
// (which then persists). Emails are intentionally BLANK: never invent a contact address.
const DEFAULTS: Co[] = [
  { company: "Amour Escrow", contact: "Euan Smith", email: "euan@amourescrow.com" },
  { company: "First American Title", contact: "", email: "" },
  { company: "Fidelity National Title", contact: "", email: "" },
  { company: "Chicago Title", contact: "", email: "" },
  { company: "Stewart Title", contact: "", email: "" },
];

const s = (v: any, n = 120) => String(v ?? "").trim().slice(0, n);

async function read(): Promise<Co[]> {
  try {
    const raw = await getSetting(KEY);
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr) && arr.length) return arr; }
  } catch { /* fall through to defaults */ }
  return DEFAULTS;
}

export async function GET() {
  return NextResponse.json({ companies: await read() });
}

// Upsert a single company (matched on company+contact, case-insensitive) and persist.
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const one: Co = {
    company: s(b.company, 80), contact: s(b.contact, 80),
    email: s(b.email, 120).toLowerCase(), phone: s(b.phone, 40), clause: s(b.clause, 240),
  };
  if (!one.company) return NextResponse.json({ error: "Company name is required." }, { status: 400 });
  if (one.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(one.email)) return NextResponse.json({ error: "That email doesn't look valid." }, { status: 400 });
  const list = await read();
  const idx = list.findIndex((c) => c.company.toLowerCase() === one.company.toLowerCase() && (c.contact || "").toLowerCase() === (one.contact || "").toLowerCase());
  if (idx >= 0) list[idx] = { ...list[idx], ...one }; else list.push(one);
  const ok = await setSetting(KEY, JSON.stringify(list.slice(0, 60)));
  if (!ok) return NextResponse.json({ error: "Couldn't save." }, { status: 500 });
  return NextResponse.json({ ok: true, companies: list });
}

// Remove one by company+contact.
export async function DELETE(req: NextRequest) {
  const company = s(req.nextUrl.searchParams.get("company"), 80).toLowerCase();
  const contact = s(req.nextUrl.searchParams.get("contact"), 80).toLowerCase();
  if (!company) return NextResponse.json({ error: "company required" }, { status: 400 });
  const list = (await read()).filter((c) => !(c.company.toLowerCase() === company && (c.contact || "").toLowerCase() === contact));
  await setSetting(KEY, JSON.stringify(list));
  return NextResponse.json({ ok: true, companies: list });
}

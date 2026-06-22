// Scenario Desk — the wholesale-lender directory the loan officer shops scenarios to.
// List, upsert, and delete wholesalers. Persistence is delegated entirely to
// lib/scenarioStore (never touch supabase here).
import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import type { Wholesaler } from "@/lib/scenario";
import { listWholesalers, saveWholesaler, deleteWholesaler, genId } from "@/lib/scenarioStore";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const wholesalers = await listWholesalers();
    return NextResponse.json({ wholesalers });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const company = String(b.company || "").trim();
    if (!company) return NextResponse.json({ error: "company required" }, { status: 400 });

    const isCreate = !b.id;
    const now = new Date().toISOString();

    const wholesaler: Wholesaler = {
      id: isCreate ? genId() : String(b.id),
      company,
      contact_name: b.contact_name || null,
      email: b.email || null,
      phone: b.phone || null,
      lender_type: b.lender_type || null,
      programs: b.programs || null,
      notes: b.notes || null,
      active: typeof b.active === "boolean" ? b.active : true,
      created_at: isCreate ? now : b.created_at || now,
    };

    const saved = await saveWholesaler(wholesaler);

    try {
      await logActivity({
        entity_type: "wholesaler",
        entity_id: saved.id,
        actor: "lo",
        action: isCreate ? "wholesaler.created" : "wholesaler.updated",
        detail: { company: saved.company, lender_type: saved.lender_type, active: saved.active },
      });
    } catch {}

    return NextResponse.json({ wholesaler: saved }, { status: isCreate ? 201 : 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await deleteWholesaler(id);
    try {
      await logActivity({ entity_type: "wholesaler", entity_id: id, actor: "lo", action: "wholesaler.deleted" });
    } catch {}
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

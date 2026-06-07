// Org tasks — the Enterprise Brain's next-best-actions as trackable to-dos.
// GET: open tasks (+ a few recently completed). PATCH { id, status }: complete/reopen.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data: open } = await supabaseAdmin
    .from("org_tasks").select("*").eq("status", "open")
    .order("priority", { ascending: false }).order("created_at", { ascending: false }).limit(50);
  const { data: done } = await supabaseAdmin
    .from("org_tasks").select("*").eq("status", "done")
    .order("completed_at", { ascending: false }).limit(10);
  return NextResponse.json({ open: open || [], done: done || [] });
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, status } = await req.json();
    if (!id || !["open", "done"].includes(status)) return NextResponse.json({ error: "id + valid status required" }, { status: 400 });
    const patch: Record<string, unknown> = { status, completed_at: status === "done" ? new Date().toISOString() : null };
    const { data, error } = await supabaseAdmin.from("org_tasks").update(patch).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logActivity({ entity_type: "org", entity_id: id, actor: "lo", action: status === "done" ? "task.completed" : "task.reopened", detail: { title: data.title } });
    return NextResponse.json({ task: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

// Optional: let an LO add their own task.
export async function POST(req: NextRequest) {
  try {
    const { title, detail } = await req.json();
    if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
    const dedup_key = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 80);
    const { data, error } = await supabaseAdmin.from("org_tasks")
      .insert([{ title: String(title).slice(0, 200), detail: detail || null, source: "manual", status: "open", dedup_key }]).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ task: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

// Org tasks — the Enterprise Brain's next-best-actions as trackable to-dos.
// GET: open tasks (+ a few recently completed). PATCH { id, status }: complete/reopen.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

// XP reward per task — brain-suggested quests are worth a little more.
export const xpFor = (source?: string) => 10 + (source === "brain" ? 5 : 0);

export async function GET() {
  const { data: open } = await supabaseAdmin
    .from("org_tasks").select("*").eq("status", "open")
    .order("priority", { ascending: false }).order("created_at", { ascending: false }).limit(50);
  const { data: done } = await supabaseAdmin
    .from("org_tasks").select("*").eq("status", "done")
    .order("completed_at", { ascending: false }).limit(12);

  // ---- Game stats (XP / level / streak) computed from completed quests ----
  const { data: allDone } = await supabaseAdmin
    .from("org_tasks").select("completed_at, source").eq("status", "done").limit(5000);
  const dayStr = (d: Date) => d.toISOString().slice(0, 10);
  const today = dayStr(new Date());
  const weekAgo = Date.now() - 7 * 86400000;
  const days = new Set<string>();
  let xp = 0, brain_done = 0, done_today = 0, done_week = 0;
  for (const t of (allDone || []) as any[]) {
    xp += xpFor(t.source);
    if (t.source === "brain") brain_done++;
    if (t.completed_at) {
      const d = new Date(t.completed_at);
      days.add(dayStr(d));
      if (dayStr(d) === today) done_today++;
      if (d.getTime() >= weekAgo) done_week++;
    }
  }
  // Streak: consecutive days up to today (with a 1-day grace so it only breaks
  // after a full missed day).
  let streak = 0;
  const cursor = new Date();
  if (!days.has(dayStr(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (days.has(dayStr(cursor))) { streak++; cursor.setUTCDate(cursor.getUTCDate() - 1); }

  const levelSize = 100;
  const level = Math.floor(xp / levelSize) + 1;
  const xpInLevel = xp % levelSize;
  const RANKS = ["Rookie", "Hustler", "Closer", "Rainmaker", "Mogul", "Legend"];
  const rank = RANKS[Math.min(RANKS.length - 1, Math.floor((level - 1) / 3))];

  const stats = {
    xp, level, xpInLevel, xpToNext: levelSize - xpInLevel, levelSize, rank,
    streak, done_today, done_week, total_done: (allDone || []).length, brain_done,
  };
  return NextResponse.json({ open: open || [], done: done || [], stats });
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

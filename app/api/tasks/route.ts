// Org tasks (quests) for the gamified Quest Log.
// GET ?player=<id>: open + recently-cleared quests, plus that player's game stats
//   (XP from their cleared quests + bosses they defeated, level, streak).
// PATCH { id, status, completed_by }: complete/reopen a quest.
// POST { title }: add a side quest.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { xpFor, levelInfo, dayStr, streakFrom } from "@/lib/game";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const playerId = req.nextUrl.searchParams.get("player");
  // Resolve the acting player (default to the owner).
  let player: any = null;
  if (playerId) {
    const { data } = await supabaseAdmin.from("players").select("*").eq("id", playerId).maybeSingle();
    player = data;
  }
  if (!player) {
    const { data } = await supabaseAdmin.from("players").select("*").eq("is_owner", true).limit(1).maybeSingle();
    player = data;
  }
  if (!player) {
    // First-ever load: create the owner so stats + the player picker work immediately.
    const { data } = await supabaseAdmin.from("players")
      .insert([{ name: "You", role: "Owner / Broker", emoji: "👑", is_owner: true }]).select().single();
    player = data;
  }
  const isOwner = !!player?.is_owner;

  const { data: open } = await supabaseAdmin
    .from("org_tasks").select("*").eq("status", "open")
    .order("priority", { ascending: false }).order("created_at", { ascending: false }).limit(50);
  const { data: done } = await supabaseAdmin
    .from("org_tasks").select("*").eq("status", "done")
    .order("completed_at", { ascending: false }).limit(12);

  // This player's cleared quests (owner also inherits legacy unattributed ones).
  const { data: myDone } = await supabaseAdmin
    .from("org_tasks").select("completed_at, source, completed_by").eq("status", "done").limit(5000);
  const mine = (myDone || []).filter((t: any) =>
    player && (t.completed_by === player.id || (isOwner && !t.completed_by)));

  const days = new Set<string>();
  let xp = 0, brain_done = 0, done_today = 0, done_week = 0;
  const today = dayStr(new Date());
  const weekAgo = Date.now() - 7 * 86400000;
  for (const t of mine as any[]) {
    xp += xpFor(t.source);
    if (t.source === "brain") brain_done++;
    if (t.completed_at) {
      const d = new Date(t.completed_at); days.add(dayStr(d));
      if (dayStr(d) === today) done_today++;
      if (d.getTime() >= weekAgo) done_week++;
    }
  }
  // Bonus XP from boss battles this player defeated.
  let bosses_won = 0;
  if (player) {
    const { data: bosses } = await supabaseAdmin
      .from("boss_battles").select("reward_xp").eq("status", "defeated").eq("defeated_by", player.id);
    for (const b of (bosses || []) as any[]) { xp += b.reward_xp || 0; bosses_won++; }
  }

  const stats = {
    ...levelInfo(xp),
    streak: streakFrom(days),
    done_today, done_week, total_done: mine.length, brain_done, bosses_won,
    player: player ? { id: player.id, name: player.name, emoji: player.emoji, is_owner: player.is_owner } : null,
  };
  return NextResponse.json({ open: open || [], done: done || [], stats });
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, status, completed_by } = await req.json();
    if (!id || !["open", "done"].includes(status)) return NextResponse.json({ error: "id + valid status required" }, { status: 400 });
    const patch: Record<string, unknown> = {
      status,
      completed_at: status === "done" ? new Date().toISOString() : null,
      completed_by: status === "done" ? (completed_by || null) : null,
    };
    const { data, error } = await supabaseAdmin.from("org_tasks").update(patch).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logActivity({ entity_type: "org", entity_id: id, actor: "lo", action: status === "done" ? "task.completed" : "task.reopened", detail: { title: data.title } });
    return NextResponse.json({ task: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

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

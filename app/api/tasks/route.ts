// Org tasks (quests) for the gamified Quest Log, with Daily/Weekly/Monthly goals.
// GET ?player=<id>: open quests grouped-ready (with cadence + done_this_period),
//   recently-cleared, that player's game stats (XP from the completions log +
//   bosses), and the calendar subscription URL.
// PATCH { id, status?, completed_by?, due_at? }: complete (logs a completion;
//   recurring quests stay open and reset next period) / reopen / set due date.
// POST { title, cadence?, due_at? }: add a side quest as a daily/weekly/monthly goal.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { xpFor, levelInfo, dayStr, streakFrom, doneThisPeriod, CADENCES } from "@/lib/game";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const randomToken = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "")
    : Math.random().toString(16).slice(2) + Date.now().toString(16)).slice(0, 28);

function toIso(due?: string | null): string | null {
  if (!due) return null;
  const s = String(due);
  const d = new Date(s.length === 10 ? `${s}T09:00:00` : s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
const cadenceOf = (v: any) => (CADENCES as readonly string[]).includes(v) ? v : "once";

async function ownerCalUrl(): Promise<string | null> {
  const { data: owner } = await supabaseAdmin.from("players").select("id, cal_token").eq("is_owner", true).limit(1).maybeSingle();
  if (!owner) return null;
  let token = owner.cal_token;
  if (!token) { token = randomToken(); await supabaseAdmin.from("players").update({ cal_token: token }).eq("id", owner.id); }
  return `${APP_URL}/api/calendar/feed?token=${token}`;
}

export async function GET(req: NextRequest) {
  const playerId = req.nextUrl.searchParams.get("player");
  let player: any = null;
  if (playerId) { const { data } = await supabaseAdmin.from("players").select("*").eq("id", playerId).maybeSingle(); player = data; }
  if (!player) { const { data } = await supabaseAdmin.from("players").select("*").eq("is_owner", true).limit(1).maybeSingle(); player = data; }
  if (!player) { const { data } = await supabaseAdmin.from("players").insert([{ name: "You", role: "Owner / Broker", emoji: "👑", is_owner: true }]).select().single(); player = data; }
  const isOwner = !!player?.is_owner;

  const { data: openRaw } = await supabaseAdmin
    .from("org_tasks").select("*").eq("status", "open")
    .order("priority", { ascending: false }).order("created_at", { ascending: false }).limit(100);
  const open = (openRaw || []).map((t: any) => ({ ...t, cadence: t.cadence || "once", done_this_period: doneThisPeriod(t.cadence || "once", t.last_done_at) }));

  const { data: done } = await supabaseAdmin
    .from("org_tasks").select("*").eq("status", "done").order("completed_at", { ascending: false }).limit(12);

  // XP / streak / counts from the completions log (handles recurring quests).
  const { data: comps } = await supabaseAdmin
    .from("quest_completions").select("player_id, source, xp, completed_at").limit(8000);
  const mine = (comps || []).filter((c: any) => player && (c.player_id === player.id || (isOwner && !c.player_id)));
  const days = new Set<string>();
  let xp = 0, brain_done = 0, done_today = 0, done_week = 0;
  const today = dayStr(new Date()); const weekAgo = Date.now() - 7 * 86400000;
  for (const c of mine as any[]) {
    xp += c.xp || 0;
    if (c.source === "brain") brain_done++;
    if (c.completed_at) {
      const d = new Date(c.completed_at); days.add(dayStr(d));
      if (dayStr(d) === today) done_today++;
      if (d.getTime() >= weekAgo) done_week++;
    }
  }
  let bosses_won = 0;
  if (player) {
    const { data: bosses } = await supabaseAdmin.from("boss_battles").select("reward_xp").eq("status", "defeated").eq("defeated_by", player.id);
    for (const b of (bosses || []) as any[]) { xp += b.reward_xp || 0; bosses_won++; }
  }

  const stats = {
    ...levelInfo(xp), streak: streakFrom(days),
    done_today, done_week, total_done: mine.length, brain_done, bosses_won,
    player: player ? { id: player.id, name: player.name, emoji: player.emoji, is_owner: player.is_owner } : null,
  };
  const calendar_url = await ownerCalUrl();
  return NextResponse.json({ open, done: done || [], stats, calendar_url });
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, status, completed_by, due_at } = await req.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    if (status === undefined && due_at !== undefined) {
      const { data, error } = await supabaseAdmin.from("org_tasks").update({ due_at: toIso(due_at) }).eq("id", id).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ task: data });
    }
    if (!["open", "done"].includes(status)) return NextResponse.json({ error: "valid status required" }, { status: 400 });

    const { data: task } = await supabaseAdmin.from("org_tasks").select("*").eq("id", id).maybeSingle();
    if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });
    const cadence = task.cadence || "once";

    if (status === "done") {
      // Recurring quest already cleared this period? Don't double-count.
      if (cadence !== "once" && doneThisPeriod(cadence, task.last_done_at)) {
        return NextResponse.json({ task, already: true });
      }
      // Log the completion (this is what XP is computed from).
      await supabaseAdmin.from("quest_completions").insert([{ task_id: id, player_id: completed_by || null, source: task.source, xp: xpFor(task.source) }]);
      const patch: Record<string, unknown> = { last_done_at: new Date().toISOString() };
      if (cadence === "once") { patch.status = "done"; patch.completed_at = new Date().toISOString(); patch.completed_by = completed_by || null; }
      const { data, error } = await supabaseAdmin.from("org_tasks").update(patch).eq("id", id).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await logActivity({ entity_type: "org", entity_id: id, actor: "lo", action: "task.completed", detail: { title: task.title, cadence } });
      return NextResponse.json({ task: data });
    }

    // reopen a one-time quest
    const { data, error } = await supabaseAdmin.from("org_tasks").update({ status: "open", completed_at: null, completed_by: null }).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ task: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { title, detail, cadence, due_at } = await req.json();
    if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
    const dedup_key = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 80) + ":" + cadenceOf(cadence);
    const { data, error } = await supabaseAdmin.from("org_tasks")
      .insert([{ title: String(title).slice(0, 200), detail: detail || null, source: "manual", status: "open", dedup_key, cadence: cadenceOf(cadence), due_at: toIso(due_at) }]).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ task: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

// Players + leaderboard. Each player's XP = XP from quests they cleared + bonus
// XP from boss battles they defeated. The owner inherits legacy unattributed
// quest completions so the leaderboard is populated from day one.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { xpFor, levelInfo } from "@/lib/game";

export const dynamic = "force-dynamic";

async function ensureOwner() {
  const { data } = await supabaseAdmin.from("players").select("id").eq("is_owner", true).limit(1).maybeSingle();
  if (data) return;
  await supabaseAdmin.from("players").insert([{ name: "You", role: "Owner / Broker", emoji: "👑", is_owner: true }]);
}

export async function GET() {
  await ensureOwner();
  const { data: players } = await supabaseAdmin.from("players").select("*").order("created_at");
  const { data: doneTasks } = await supabaseAdmin
    .from("org_tasks").select("source, completed_by").eq("status", "done").limit(5000);
  const { data: bosses } = await supabaseAdmin
    .from("boss_battles").select("reward_xp, defeated_by").eq("status", "defeated");

  const board = (players || []).map((p: any) => {
    let xp = 0;
    for (const t of (doneTasks || []) as any[]) {
      if (t.completed_by === p.id || (p.is_owner && !t.completed_by)) xp += xpFor(t.source);
    }
    for (const b of (bosses || []) as any[]) if (b.defeated_by === p.id) xp += b.reward_xp || 0;
    return { id: p.id, name: p.name, role: p.role, emoji: p.emoji, is_owner: p.is_owner, ...levelInfo(xp) };
  });
  board.sort((a: any, b: any) => b.xp - a.xp);
  return NextResponse.json({ players: board });
}

export async function POST(req: NextRequest) {
  try {
    const { name, role, emoji } = await req.json();
    if (!name || !String(name).trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
    const { data, error } = await supabaseAdmin.from("players").insert([{
      name: String(name).trim().slice(0, 60), role: role ? String(role).slice(0, 60) : "Loan Officer",
      emoji: emoji || "🧑‍💼", is_owner: false,
    }]).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ player: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

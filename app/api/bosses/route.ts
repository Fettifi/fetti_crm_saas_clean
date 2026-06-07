// Boss Battles — big multi-step goals. Each objective you clear chips the boss's
// HP; clear them all and you defeat it for a big bonus XP reward (credited to the
// acting player so it counts on the leaderboard).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data: active } = await supabaseAdmin
    .from("boss_battles").select("*").eq("status", "active").order("created_at");
  const { data: defeated } = await supabaseAdmin
    .from("boss_battles").select("*").eq("status", "defeated").order("defeated_at", { ascending: false }).limit(6);
  return NextResponse.json({ active: active || [], defeated: defeated || [] });
}

// PATCH { boss_id, index, done, player } — toggle one objective. Defeats the boss
// when every objective is complete.
export async function PATCH(req: NextRequest) {
  try {
    const { boss_id, index, done, player } = await req.json();
    const { data: boss } = await supabaseAdmin.from("boss_battles").select("*").eq("id", boss_id).maybeSingle();
    if (!boss) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (boss.status === "defeated") return NextResponse.json({ boss, defeated: true });

    const objectives = Array.isArray(boss.objectives) ? boss.objectives : [];
    if (typeof index === "number" && objectives[index]) objectives[index].done = !!done;

    const allDone = objectives.length > 0 && objectives.every((o: any) => o.done);
    const patch: Record<string, unknown> = { objectives };
    if (allDone) { patch.status = "defeated"; patch.defeated_by = player || null; patch.defeated_at = new Date().toISOString(); }

    const { data: updated, error } = await supabaseAdmin.from("boss_battles").update(patch).eq("id", boss_id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (allDone) {
      await logActivity({ entity_type: "org", entity_id: boss_id, actor: "lo", action: "boss.defeated", detail: { title: boss.title, reward_xp: boss.reward_xp } });
    }
    return NextResponse.json({ boss: updated, defeated: allDone, reward_xp: allDone ? boss.reward_xp : 0 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

// POST { title, description, emoji, objectives: string[], reward_xp } — create a boss.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.title || !Array.isArray(b.objectives) || !b.objectives.length) {
      return NextResponse.json({ error: "title + objectives[] required" }, { status: 400 });
    }
    const objectives = b.objectives.slice(0, 12).map((label: string) => ({ label: String(label).slice(0, 160), done: false }));
    const { data, error } = await supabaseAdmin.from("boss_battles").insert([{
      title: String(b.title).slice(0, 120), description: b.description ? String(b.description).slice(0, 300) : null,
      emoji: b.emoji || "🐉", objectives, reward_xp: Math.max(25, Math.min(1000, Number(b.reward_xp) || 100)), status: "active",
    }]).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ boss: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

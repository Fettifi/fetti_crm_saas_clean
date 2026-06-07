// Public calendar subscription feed. Calendar apps fetch this URL on a schedule
// (they can't send auth cookies), so it's gated by an unguessable ?token that
// matches the owner's cal_token. Returns open quests that have a due date as
// timed events with a 1-hour reminder.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { buildICS, type ICSEvent } from "@/lib/ics";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token || token.length < 12) return new NextResponse("Invalid", { status: 400 });

  const { data: owner } = await supabaseAdmin
    .from("players").select("id").eq("cal_token", token).maybeSingle();
  if (!owner) return new NextResponse("Not found", { status: 404 });

  const { data: tasks } = await supabaseAdmin
    .from("org_tasks").select("id, title, source, due_at").eq("status", "open").not("due_at", "is", null).limit(500);

  const events: ICSEvent[] = (tasks || []).map((t: any) => ({
    uid: `quest-${t.id}@fettifi.com`,
    title: `🎯 ${t.title}`,
    start: new Date(t.due_at),
    description: t.source === "brain" ? "Suggested by your Fetti Enterprise Brain. Complete in your Quest Log." : "Fetti Quest Log task.",
    reminderMinutes: 60,
  }));

  const ics = buildICS(events);
  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="fetti-quests.ics"',
      "Cache-Control": "public, max-age=300",
    },
  });
}

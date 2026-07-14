// DAILY TIKTOK REMINDER — the one channel that needs a human hand. IG + FB
// auto-post; TikTok can't (no API for our account), so each morning (after the
// content cron generates the day's card at 16:00 UTC) this emails Ramon a nudge
// with today's hook + the one-tap /tiktok-today link. Server-side cron → fires
// regardless of any app being open.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { sendEmail } from "@/lib/comms";

export const dynamic = "force-dynamic";
const APP = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const today = new Date().toISOString().slice(0, 10);
    // Today's hook (episode video takes priority as the thing to post).
    const { data: ep } = await supabaseAdmin.from("content_posts")
      .select("hook").eq("type", "reel_video").gte("scheduled_for", today)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { data: card } = await supabaseAdmin.from("content_posts")
      .select("hook").eq("type", "tiktok_daily").eq("status", "tiktok_only").eq("scheduled_for", today)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    // Nothing valid to post today (no episode + card held/absent) → don't nudge to an
    // empty page; skip the reminder rather than drive to a broken card.
    if (!ep && !card) {
      return NextResponse.json({ ok: true, sent: false, note: "no ready TikTok asset today" });
    }
    const isEpisode = !!ep;
    const hook = (ep?.hook || card?.hook || "Today's Fetti post").toString();
    const link = `${APP}/tiktok-today`;

    const to = (process.env.LEAD_NOTIFY_EMAIL_TO || "ramon@fettifi.com").trim();
    const subject = `📱 Post today's TikTok — ${hook.slice(0, 60)}`;
    const html = `<div style="font:16px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:520px">
      <p style="font-size:18px;font-weight:700;margin:0 0 8px">Today's Fetti TikTok is ready 🦉</p>
      <p style="margin:0 0 4px;color:#475569">${isEpisode ? "🎬 <b>Episode day</b> — post the video (best reach)." : "Today's hook:"}</p>
      <p style="font-size:17px;font-weight:600;margin:0 0 16px">“${hook.replace(/</g, "&lt;")}”</p>
      <p style="margin:0 0 18px">
        <a href="${link}" style="background:#e11d48;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;display:inline-block">Open today's post →</a>
      </p>
      <ol style="margin:0 0 16px;padding-left:18px;color:#334155">
        <li>Download the ${isEpisode ? "video" : "card"}</li>
        <li>Post on TikTok &amp; add your music</li>
        <li>Tap “Copy caption” and paste</li>
      </ol>
      <p style="color:#94a3b8;font-size:13px;margin:0">Instagram &amp; Facebook already auto-posted today. TikTok is the one that needs your hand — about 60 seconds.</p>
    </div>`;
    const text = `Today's Fetti TikTok is ready.\n\n${isEpisode ? "EPISODE DAY — post the video (best reach).\n" : ""}Hook: "${hook}"\n\nPost it: ${link}\n1) Download  2) Post + add music  3) Copy caption & paste\n\nIG & FB already auto-posted. TikTok needs your hand (~60s).`;

    const r = await sendEmail(to, subject, { html, text });
    await supabaseAdmin.from("activity_log").insert([{
      entity_type: "system", entity_id: "tiktok-reminder", actor: "system", action: "cron.ran",
      detail: { cron: "tiktok-reminder", to, sent: r.ok, hook, episode: isEpisode },
    }]).select("id").maybeSingle().then(() => {}, () => {});
    return NextResponse.json({ ok: true, sent: r.ok, to, hook, episode: isEpisode });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

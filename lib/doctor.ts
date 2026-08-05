// Fetti CRM Doctor — always-on health monitor + auto-repair. Runs a battery of
// checks and FIXES safe issues itself (no approval needed): seeds the owner
// player, generates a missing calendar token, refills an empty content queue,
// and verifies the lead funnel can write. Stores a report and alerts on trouble.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { generateBatch } from "@/lib/content";
import { healMetaToken } from "@/lib/metaHeal";
import { recordHeartbeat, checkContinuity, pingWatchdog, type Continuity } from "@/lib/heartbeat";
import { commsChecks } from "@/lib/commsHealth";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";

type Check = { name: string; ok: boolean; level: "critical" | "warn" | "info"; detail: string };
type Repair = { name: string; detail: string };

const randomToken = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "")
    : Math.random().toString(16).slice(2)).slice(0, 28);

export async function runDoctor(): Promise<{ status: string; checks: Check[]; repairs: Repair[]; continuity: Continuity[] }> {
  const checks: Check[] = [];
  const repairs: Repair[] = [];
  let continuity: Continuity[] = [];
  const add = (name: string, ok: boolean, level: Check["level"], detail = "") => checks.push({ name, ok, level, detail });

  // 1) Database tables reachable
  const tables = ["leads", "loan_files", "loan_documents", "org_tasks", "players", "boss_battles", "content_posts", "activity_log", "org_insights", "wizard_events"];
  for (const t of tables) {
    try {
      const { error } = await supabaseAdmin.from(t).select("*", { count: "exact", head: true });
      add(`db:${t}`, !error, "critical", error ? error.message : "ok");
    } catch (e) { add(`db:${t}`, false, "critical", e instanceof Error ? e.message : "error"); }
  }

  // 2) Owner player exists — AUTO-REPAIR
  try {
    let { data: owner } = await supabaseAdmin.from("players").select("id, cal_token").eq("is_owner", true).limit(1).maybeSingle();
    if (!owner) {
      const { data } = await supabaseAdmin.from("players").insert([{ name: "You", role: "Owner / Broker", emoji: "👑", is_owner: true }]).select().single();
      owner = data; repairs.push({ name: "owner_player", detail: "Created missing owner player." });
    }
    add("owner_player", !!owner, "warn", owner ? "present" : "missing");
    // 3) Calendar token — AUTO-REPAIR
    if (owner && !owner.cal_token) {
      await supabaseAdmin.from("players").update({ cal_token: randomToken() }).eq("id", owner.id);
      repairs.push({ name: "cal_token", detail: "Generated missing calendar feed token." });
      add("cal_token", true, "info", "repaired");
    } else add("cal_token", true, "info", owner?.cal_token ? "present" : "n/a");
  } catch (e) { add("owner_player", false, "warn", e instanceof Error ? e.message : "error"); }

  // 4) Lead funnel can write — round-trip test
  try {
    const email = `doctor+${Date.now()}@fetti-internal.test`;
    const { data, error } = await supabaseAdmin.from("leads").insert([{ email, source: "doctor_healthcheck", stage: "New Lead" }]).select("id").single();
    if (error) add("lead_funnel_write", false, "critical", error.message);
    else { await supabaseAdmin.from("leads").delete().eq("id", data.id); add("lead_funnel_write", true, "critical", "ok"); }
  } catch (e) { add("lead_funnel_write", false, "critical", e instanceof Error ? e.message : "error"); }

  // 5) Content queue not empty — AUTO-REPAIR (refill)
  try {
    const { count } = await supabaseAdmin.from("content_posts").select("*", { count: "exact", head: true }).eq("status", "queued");
    if ((count || 0) === 0 && process.env.OPENAI_API_KEY) {
      try {
        const rows = await generateBatch();
        if (rows.length) { await supabaseAdmin.from("content_posts").insert(rows); repairs.push({ name: "content_refill", detail: `Generated ${rows.length} fresh posts (queue was empty).` }); }
        add("content_queue", true, "warn", "refilled");
      } catch (e) { add("content_queue", false, "warn", "empty + refill failed: " + (e instanceof Error ? e.message : "")); }
    } else add("content_queue", true, "warn", `${count || 0} queued`);
  } catch (e) { add("content_queue", false, "warn", e instanceof Error ? e.message : "error"); }

  // 6) Required + optional env present
  const reqEnv = ["OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET"];
  for (const k of reqEnv) add(`env:${k}`, !!process.env[k], "critical", process.env[k] ? "set" : "MISSING");
  const optEnv = ["RESEND_API_KEY", "TWILIO_AUTH_TOKEN", "LEAD_NOTIFY_WEBHOOK", "META_ACCESS_TOKEN", "NEXT_PUBLIC_META_PIXEL_ID", "NEXT_PUBLIC_TIKTOK_PIXEL_ID"];
  for (const k of optEnv) add(`env:${k}`, !!process.env[k], "info", process.env[k] ? "set" : "not set");

  // 6b) Meta (Facebook) auto-post — SELF-HEAL: validate + auto-refresh the token.
  try {
    const heal = await healMetaToken();
    if (heal.status === "healed") repairs.push({ name: "meta_token", detail: heal.detail });
    const ok = heal.status === "healthy" || heal.status === "healed" || heal.status === "not_configured";
    add("meta_facebook_connection", ok, heal.status === "needs_reauth" ? "warn" : "info", `${heal.status}: ${heal.detail}`);
  } catch (e) { add("meta_facebook_connection", false, "warn", e instanceof Error ? e.message : "error"); }

  // 7) Public pages serving
  for (const p of ["/", "/apply/form", "/home", "/quote", "/links"]) {
    try {
      const r = await fetch(`${APP_URL}${p}`, { method: "GET", signal: AbortSignal.timeout(8000) });
      add(`page:${p}`, r.ok || r.status === 307, "warn", `HTTP ${r.status}`);
    } catch (e) { add(`page:${p}`, false, "warn", e instanceof Error ? e.message : "error"); }
  }

  // 8) CONTINUITY OF COMPUTE — are the scheduled jobs still firing? If a cron
  // stopped (Vercel outage, plan limit, bad deploy), flag it loudly here.
  try {
    continuity = await checkContinuity();
    for (const c of continuity) {
      // STALLED outranks every other state: the job IS firing but never finishing its
      // work, which a plain "last ran" heartbeat reports as healthy. That false-green is
      // exactly how the nurture lock bug ran unnoticed for 13 days — never soften it.
      if (c.stalled) {
        add(`cron:${c.name}`, false, "critical",
          `⛔ STALLED — the route fired ${c.lastAttempt ? `at ${c.lastAttempt}` : "recently"} but the job has not COMPLETED${c.lastRun ? ` since ${c.lastRun} (${c.ageHours}h)` : " ever"}. It is erroring or bailing on a guard every run.`);
      } else if (c.lastRun === null) add(`cron:${c.name}`, true, "info", "no heartbeat yet (will populate on next run)");
      else add(`cron:${c.name}`, !c.overdue, c.overdue ? "critical" : "info",
        c.overdue ? `⛔ OVERDUE — last ran ${c.ageHours}h ago (expected ≤${c.expectedHours}h). Compute may be stalled.` : `ran ${c.ageHours}h ago`);
    }
  } catch (e) { add("continuity_check", false, "warn", e instanceof Error ? e.message : "error"); }

  // THE PHONE. Added 2026-08-05 after the office line sat dead on a busy signal for two days
  // while this function reported "healthy" every hour. It checked ten database tables and the
  // content queue; it never once asked whether callers could reach us.
  try {
    for (const c of await commsChecks()) add(c.name, c.ok, c.level, c.detail);
  } catch (e) { add("comms_health", false, "warn", e instanceof Error ? e.message : "error"); }

  const criticalDown = checks.some((c) => c.level === "critical" && !c.ok);
  const warnDown = checks.some((c) => c.level === "warn" && !c.ok);
  const status = criticalDown ? "down" : warnDown ? "degraded" : "healthy";

  // The doctor ran — record its own heartbeat and ping the external watchdog so
  // an outside monitor confirms the system's compute is alive.
  await recordHeartbeat("doctor");
  await pingWatchdog();

  // Persist + alert on trouble
  try {
    await supabaseAdmin.from("doctor_reports").insert([{ status, checks, repairs }]);
    if (status !== "healthy") { await alertDiscord(status, checks, repairs); await alertEmail(status, checks); }
  } catch { /* best-effort */ }

  return { status, checks, repairs, continuity };
}

// EMAIL, NOT SMS. The thing most likely to be broken is Twilio, and an alarm that reports
// through the system it is watching is not an alarm. When the office line sat dead for two days
// the only notification path was a webhook nobody was reading. This one lands in his inbox.
async function alertEmail(status: string, checks: Check[]) {
  const key = process.env.RESEND_API_KEY, to = process.env.LEAD_NOTIFY_EMAIL_TO, from = process.env.LEAD_NOTIFY_EMAIL_FROM;
  if (!(key && to && from)) { console.error("[doctor] alert email SKIPPED — missing", { key: !!key, to: !!to, from: !!from }); return; }
  const failed = checks.filter((c) => !c.ok);
  const crit = failed.filter((c) => c.level === "critical");
  // Lead with what is actually broken for the business, not with a check name.
  const headline = crit.some((c) => c.name.startsWith("twilio:"))
    ? "The phone may be down — callers could be getting a busy signal"
    : `CRM ${status}`;
  const rows = failed.map((c) => `${c.level === "critical" ? "⛔" : "⚠️"}  ${c.name}\n     ${c.detail}`).join("\n\n");
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: to.split(",").map((s) => s.trim()),
        subject: `${crit.length ? "⛔" : "⚠️"} ${headline}`,
        html: `<p style="font:15px system-ui"><b>${headline}</b></p><pre style="font:13px ui-monospace,monospace;white-space:pre-wrap">${rows.replace(/</g, "&lt;")}</pre>`,
      }),
    });
    if (!r.ok) console.error("[doctor] alert email REJECTED:", r.status, (await r.text()).slice(0, 300));
  } catch (e: any) { console.error("[doctor] alert email failed:", e?.message); }
}

async function alertDiscord(status: string, checks: Check[], repairs: Repair[]) {
  const url = process.env.LEAD_NOTIFY_WEBHOOK;
  if (!url) return;
  const failed = checks.filter((c) => !c.ok).map((c) => `• ${c.name}: ${c.detail}`).join("\n").slice(0, 1500);
  const fixed = repairs.map((r) => `✓ ${r.detail}`).join("\n");
  const content = `🩺 **CRM Doctor: ${status.toUpperCase()}**\n${failed || "—"}${fixed ? `\n\nAuto-repaired:\n${fixed}` : ""}`;
  try { await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) }); } catch { /* */ }
}

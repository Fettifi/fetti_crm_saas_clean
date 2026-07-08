// System-wide self-healing. Reconciles desired-vs-actual state and auto-completes
// any work that should have happened but didn't — no approval needed. Idempotent:
// once a gap is filled it won't be touched again. Caps keep cost bounded per run.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { ensureLoanFileForLead } from "@/lib/los";
import { getAgent } from "@/lib/agents/agents";
import { runAgent } from "@/lib/agents/runner";
import { logActivity } from "@/lib/activity";
import { generateBatch } from "@/lib/content";
import { healMetaToken } from "@/lib/metaHeal";

export type HealAction = { name: string; detail: string };

const STAGES = ["capture", "qualify", "structure", "process", "close"] as const;
const isReal = (l: any) => (l.email || l.phone) && l.source !== "doctor_healthcheck" && !String(l.email || "").includes("@fetti-internal.test");

export async function reconcile(): Promise<HealAction[]> {
  const repairs: HealAction[] = [];
  const sinceISO = new Date(Date.now() - 7 * 86400000).toISOString();

  // Pull recent leads once.
  const { data: leadsRaw } = await supabaseAdmin.from("leads").select("*").gte("created_at", sinceISO).order("created_at", { ascending: false }).limit(500);
  const leads = (leadsRaw || []).filter(isReal);
  const ids = leads.map((l: any) => l.id);

  // 1) A loan file opens ONLY for a real loan — a lead that COMPLETED a full
  //    application (stage "Application"). Plain leads STAY in the leads pipeline until
  //    a teammate converts them (POST /api/los/files) or they finish the app, so the
  //    healer no longer back-fills a file for every inquiry — it only completes files
  //    for finished applications whose synchronous open was missed.
  // Skip leads whose loan file was DELIBERATELY deleted (raw.los_deleted_at) — otherwise
  // the healer resurrects a file the LO just removed. A real new borrower upload can still
  // re-open one; this only blocks automatic re-creation.
  const applicationLeads = leads.filter((l: any) => String(l.stage || "") === "Application" && !(l.raw && l.raw.los_deleted_at));
  if (applicationLeads.length) {
    const appIds = applicationLeads.map((l: any) => l.id);
    const { data: files } = await supabaseAdmin.from("loan_files").select("lead_id").in("lead_id", appIds);
    const have = new Set((files || []).map((f: any) => f.lead_id));
    let made = 0;
    for (const l of applicationLeads) {
      if (have.has(l.id)) continue;
      try { if (await ensureLoanFileForLead(l)) made++; } catch { /* */ }
      if (made >= 25) break;
    }
    if (made) { repairs.push({ name: "loan_files", detail: `Opened ${made} loan file(s) for completed applications.` }); await logActivity({ entity_type: "org", actor: "agent:healer", action: "heal.loan_files", detail: { count: made } }); }
  }

  // 2) Every real lead should have its agent pipeline run. Re-run any with none.
  if (ids.length) {
    const { data: ar } = await supabaseAdmin.from("lead_agents").select("lead_id").in("lead_id", ids);
    const have = new Set((ar || []).map((a: any) => a.lead_id));
    let ran = 0;
    for (const l of leads) {
      if (have.has(l.id)) continue;
      // Shield quarantine: agents are DEFERRED for Review leads (promotion replays
      // them) — the healer must not run them through the back door.
      if (String(l.stage || "").toLowerCase() === "review") continue;
      for (const stage of STAGES) {
        try {
          const agent = getAgent(stage); if (!agent) continue;
          const r = await runAgent(agent, l);
          await supabaseAdmin.from("lead_agents").insert([{ lead_id: l.id, stage, summary: r.summary, output_json: r.output }]);
        } catch { /* */ }
      }
      ran++;
      if (ran >= 5) break; // cap: 5 leads * 5 agents = 25 model calls/run
    }
    if (ran) { repairs.push({ name: "agent_pipeline", detail: `Re-ran the 5-agent pipeline for ${ran} lead(s) that had none.` }); await logActivity({ entity_type: "org", actor: "agent:healer", action: "heal.agents", detail: { leads: ran } }); }
  }

  // 3) Content engine should never be empty.
  try {
    const { count } = await supabaseAdmin.from("content_posts").select("*", { count: "exact", head: true }).eq("status", "queued");
    if ((count || 0) === 0 && process.env.OPENAI_API_KEY) {
      const rows = await generateBatch();
      if (rows.length) { await supabaseAdmin.from("content_posts").insert(rows); repairs.push({ name: "content_refill", detail: `Generated ${rows.length} posts (queue was empty).` }); }
    }
  } catch { /* */ }

  // 4) Owner player + calendar token must exist.
  try {
    let { data: owner } = await supabaseAdmin.from("players").select("id, cal_token").eq("is_owner", true).limit(1).maybeSingle();
    if (!owner) { const { data } = await supabaseAdmin.from("players").insert([{ name: "You", role: "Owner / Broker", emoji: "👑", is_owner: true }]).select().single(); owner = data; repairs.push({ name: "owner_player", detail: "Recreated owner profile." }); }
    if (owner && !owner.cal_token) {
      const t = (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "") : Math.random().toString(16).slice(2)).slice(0, 28);
      await supabaseAdmin.from("players").update({ cal_token: t }).eq("id", owner.id); repairs.push({ name: "cal_token", detail: "Regenerated calendar token." });
    }
  } catch { /* */ }

  // 5b) Shield recheck: gray-band Review leads >24h old whose phone never got a
  //     Lookup (budget/timeout at intake) get one now — a clean mobile line drops
  //     the risk below threshold and auto-releases them. Bounded + best-effort.
  try {
    const { lookupPhone, promoteQuarantined } = await import("@/lib/leadShield");
    const dayAgo = new Date(Date.now() - 24 * 3600000).toISOString();
    const reviewLeads = (leadsRaw || []).filter((l: any) =>
      String(l.stage || "").toLowerCase() === "review" &&
      l.created_at < dayAgo && l.phone &&
      l.raw?.shield?.band === "gray" && !l.raw?.shield?.lookup &&
      !l.raw?.shield?.resolved_at && l.raw?.shield?.recheck_at == null);
    let rechecked = 0, released = 0;
    for (const l of reviewLeads.slice(0, 10)) {
      const raw = l.raw && typeof l.raw === "object" ? l.raw : {};
      raw.shield = { ...(raw.shield || {}), recheck_at: new Date().toISOString() };
      const lu = await lookupPhone(String(l.phone).replace(/\D/g, "").slice(-10));
      if (lu) raw.shield.lookup = lu;
      await supabaseAdmin.from("leads").update({ raw }).eq("id", l.id);
      rechecked++;
      const risk = Number(raw.shield.risk || 0);
      if (lu && lu.valid && lu.lineType === "mobile" && risk - 15 < 60) {
        if (await promoteQuarantined(l.id, "shield", "auto:recheck_mobile")) released++;
      }
    }
    if (rechecked) repairs.push({ name: "shield_recheck", detail: `Re-checked ${rechecked} quarantined lead(s) via phone lookup; auto-released ${released}.` });
  } catch { /* best-effort */ }

  // 5c) Shield lookup-cache hygiene: app_settings rows older than 90 days are
  //     dead weight (the read path re-fetches past TTL anyway). Best-effort.
  try {
    await supabaseAdmin.from("app_settings").delete()
      .like("key", "shield:lookup:%")
      .lt("updated_at", new Date(Date.now() - 90 * 86400000).toISOString());
  } catch { /* fail open */ }

  // 5) Meta token self-heal.
  try {
    const m = await healMetaToken();
    if (m.status === "healed") repairs.push({ name: "meta_token", detail: m.detail });
  } catch { /* */ }

  return repairs;
}

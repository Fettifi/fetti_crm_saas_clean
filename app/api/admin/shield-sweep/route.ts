// Retro-sweep: run the shield's FREE signals over EXISTING early-stage leads and
// quarantine standing junk — the reactive clear-bots pass, productized. No deletes,
// fully reversible (promote restores pre_quarantine_stage + replays the pipeline).
//   GET  ?dry_run=1 (default) → the would-quarantine list with scores
//   GET  ?apply=1             → executes (stage → Review, paused, raw.shield.retro)
// Auth: CRON_SECRET bearer/header (also proxy-gated under /api/admin for sessions).
// Scope guard: New Lead / Contacted only, AND zero human-engagement evidence
// (no inbound message, no doc upload, no booked call) — an engaged borrower can
// never be swept no matter what their name looks like.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { scoreSignals, checkPhonePattern, editDistance, type ShieldSignal } from "@/lib/leadShield";
import { cfg } from "@/lib/settings";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const internal = req.headers.get("x-fetti-internal");
  if (!secret || (auth !== `Bearer ${secret}` && internal !== secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const apply = req.nextUrl.searchParams.get("apply") === "1";
  const qTh = Number((await cfg("SHIELD_RISK_QUARANTINE").catch(() => ""))) || 60;
  const csv = (s: string | null) => String(s || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const extraDisposable = csv(await cfg("SHIELD_DISPOSABLE_EXTRA").catch(() => ""));
  const allowDomains = csv(await cfg("SHIELD_ALLOW_DOMAINS").catch(() => ""));
  const extraFakes = csv(await cfg("SHIELD_FAKE_NAMES_EXTRA").catch(() => ""));

  const { data: leads } = await supabaseAdmin
    .from("leads")
    .select("id, full_name, first_name, last_name, email, phone, stage, source, created_at, nurture_paused, raw, credit_score, property_value, loan_amount_requested")
    .order("created_at", { ascending: true })
    .limit(2000);
  const scope = (leads || []).filter((l: any) =>
    /^(new lead|contacted|new)$/i.test(String(l.stage || "")) &&
    !/fetti-internal\.test/.test(String(l.email || "")));

  // Human-engagement evidence: inbound comms or borrower activity in the log.
  const ids = scope.map((l: any) => l.id);
  const engaged = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data: acts } = await supabaseAdmin
      .from("activity_log").select("lead_id, action, detail")
      .in("lead_id", chunk)
      .in("action", ["comms.message", "doc.uploaded", "calendly.booked", "lead.stage.advanced"])
      .limit(5000);
    for (const a of acts || []) {
      const d = (a as any).detail || {};
      if ((a as any).action === "comms.message" && d.direction !== "inbound") continue;
      engaged.add((a as any).lead_id);
    }
  }

  // Mutated-identity groups across the whole scope (same phone, ≥3 far-apart first names).
  const byPhone = new Map<string, any[]>();
  for (const l of scope) {
    const p = String(l.phone || "").replace(/\D/g, "").slice(-10);
    if (p) { if (!byPhone.has(p)) byPhone.set(p, []); byPhone.get(p)!.push(l); }
  }
  const groupHit = new Set<string>();
  for (const rows of byPhone.values()) {
    if (rows.length < 2) continue;
    const firsts: string[] = [];
    for (const r of rows) {
      const f = String(r.full_name || "").trim().toLowerCase().split(/\s+/)[0];
      if (!f) continue;
      if (!firsts.some((x) => x === f || editDistance(x, f) <= 2 || x.startsWith(f) || f.startsWith(x))) firsts.push(f);
    }
    if (firsts.length >= 3) for (const r of rows) groupHit.add(r.id);
  }

  const hits: Array<{ id: string; name: string | null; email: string | null; phone: string | null; stage: string; risk: number; signals: string[] }> = [];
  for (const l of scope) {
    if (engaged.has(l.id)) continue;
    const { risk, signals } = scoreSignals(
      { body: l as any, channel: "api", ip: null, internal: true },
      { extraDisposable, allowDomains, extraFakes },
    );
    const sigs: ShieldSignal[] = [...signals.filter((s) => !["transport.api", "fst.missing", "ua.missing"].includes(s.key))];
    if (groupHit.has(l.id)) sigs.push({ key: "identity.multi_name", pts: 60, ev: "hard" });
    const ph = checkPhonePattern(l.phone);
    if (ph && !sigs.some((s) => s.key === ph.key)) sigs.push(ph);
    const total = Math.max(0, sigs.reduce((a, s) => a + s.pts, 0));
    const hard = sigs.some((s) => s.ev === "hard");
    if (hard || total >= qTh) {
      hits.push({ id: l.id, name: l.full_name, email: l.email, phone: l.phone, stage: l.stage, risk: total, signals: sigs.map((s) => `${s.key}:${s.pts}`) });
      if (apply) {
        const raw = (l.raw && typeof l.raw === "object" ? l.raw : {}) as Record<string, any>;
        raw.shield = {
          version: 1, verdict: "quarantine", band: hard || total >= 90 ? "junk" : "gray", risk: total,
          signals: sigs, channel: "api", retro: true,
          quarantined_at: new Date().toISOString(), pre_quarantine_stage: l.stage,
        };
        await supabaseAdmin.from("leads").update({ stage: "Review", nurture_paused: true, raw }).eq("id", l.id);
        await logActivity({ entity_type: "lead", entity_id: l.id, lead_id: l.id, actor: "shield", action: "shield.quarantine", detail: { retro: true, risk: total, signals: raw.shield.signals.map((s: any) => s.key) } }).catch(() => {});
      }
    }
  }

  if (apply) {
    await logActivity({ entity_type: "shield", entity_id: "sweep", actor: "shield", action: "shield.sweep", detail: { scanned: scope.length, engaged_skipped: engaged.size, quarantined: hits.length } }).catch(() => {});
  }
  return NextResponse.json({ ok: true, mode: apply ? "applied" : "dry_run", scanned: scope.length, engaged_skipped: engaged.size, hits: hits.length, leads: hits });
}

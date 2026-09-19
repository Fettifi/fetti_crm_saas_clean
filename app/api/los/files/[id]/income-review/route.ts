// Persisted LO income review for a loan file. The AI verify-income route is a pure
// compute (nothing sticks); this is where the LOAN OFFICER's discretion lives and
// SURVIVES a reload: which AI flags were accepted vs omitted (with the LO's reason),
// which income lines count, and any income the LO adds back that the AI held behind a
// flag. Stored as one JSON blob in app_settings under los_income_review:<fileId>.
//   GET  -> { review }            (null if the file was never reviewed)
//   POST { review }               save the whole review blob (debounced by the UI)
//   POST { event:{action,detail}} append one audit line (used when a flag is omitted)
// Auth: /api/los/* is session-gated in proxy.ts, so only a signed-in team member here.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { getSetting, setSetting } from "@/lib/settings";
import { logActivity } from "@/lib/activity";
import { incomeDriftState } from "@/lib/income/driftGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const validId = (id: string) => /^[\w-]{6,64}$/.test(id);
const keyFor = (id: string) => `los_income_review:${id}`;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validId(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const raw = await getSetting(keyFor(id));
  let review: any = null;
  try { review = raw ? JSON.parse(raw) : null; } catch { review = null; }
  if (review && typeof review === "object") {
    // THE SCREEN RESTORES ITS OWN SNAPSHOT, NOT THE LATEST READ. The review blob embeds the
    // `verified` result it was saved with; the verify cache (los_income_verify) is written by
    // every verify. When the cache is NEWER — a re-verify through the API, or a recompute after
    // an engine change — this screen kept showing the older worksheet (2026-09-17: Natasha
    // Oiye's review carried the $21,106 three-line read under an override of $17,763 while the
    // cache held the corrected two-line $17,763). Overlay the newer read, drop the choices that
    // were keyed to the old worksheet's row positions, and say so.
    try {
      const envRaw = await getSetting(`los_income_verify:${id}`);
      const env = envRaw ? JSON.parse(envRaw) : null;
      const oldAt = review.verified?.verifiedAt ? Date.parse(review.verified.verifiedAt) : 0;
      if (env?.payload && env.verifiedAt && review.verified && Date.parse(env.verifiedAt) > oldAt) {
        const previousChoices = { lineIncluded: review.lineIncluded || {}, lineBorrower: review.lineBorrower || {}, flagDecisions: review.flagDecisions || {}, flagNotes: review.flagNotes || {} };
        const dropped = Object.values(previousChoices).some((o: any) => o && Object.keys(o).length > 0);
        review.verifiedRefreshed = {
          from: review.verified.verifiedAt || null, to: env.verifiedAt,
          previousIncome: Math.round(Number(review.verified.qualifyingMonthlyIncome) || 0),
          income: Math.round(Number(env.payload.qualifyingMonthlyIncome) || 0),
          droppedChoices: dropped,
        };
        review.verified = { ...env.payload, verifiedAt: env.verifiedAt, cached: true };
        // Row-position choices belong to the worksheet they were made on. Borrower exclusions,
        // added lines, the income override and the text-matched QC acknowledgement carry over.
        review.lineIncluded = {}; review.lineBorrower = {}; review.flagDecisions = {}; review.flagNotes = {};
        if (dropped) await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, actor: "system", action: "income.review_refreshed", detail: { ...review.verifiedRefreshed, previousChoices } }).catch(() => {});
      }
    } catch { /* the review still loads without the overlay */ }
    // Is the number this screen shows one the current engine still reproduces from the file's
    // own facts? Names shipped vs recomputed so the LO can see a stale read before trusting it.
    try { review.incomeDrift = await incomeDriftState(id); } catch { /* advisory */ }
  }
  return NextResponse.json({ review });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validId(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const { data: f } = await supabaseAdmin.from("loan_files").select("id").eq("id", id).maybeSingle();
  if (!f) return NextResponse.json({ error: "loan file not found" }, { status: 404 });

  let body: any = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad body" }, { status: 400 }); }

  // Audit breadcrumb — an LO overriding an underwriting flag should be on the record.
  // The action label is advisory (allow-listed, not free-text) and the detail is size-
  // capped, so this insider-only path can't forge a misleading action or bloat the audit
  // table (mirrors the size cap the review blob already enforces below).
  const AUDIT_ACTIONS = new Set(["income.flag_omitted", "income.flag_accepted", "income.flag_reviewed"]);
  if (body?.event && typeof body.event === "object") {
    const action = AUDIT_ACTIONS.has(String(body.event.action)) ? String(body.event.action) : "income.flag_reviewed";
    const detStr = JSON.stringify(body.event.detail ?? {});
    const detail = detStr.length > 8_000 ? { truncated: true, bytes: detStr.length } : (body.event.detail || {});
    await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, actor: "loan_officer", action, detail }).catch(() => {});
    if (!body.review) return NextResponse.json({ ok: true });
  }

  const review = body?.review;
  if (!review || typeof review !== "object") return NextResponse.json({ error: "no review" }, { status: 400 });
  const str = JSON.stringify(review);
  if (str.length > 300_000) return NextResponse.json({ error: "review too large" }, { status: 413 });
  const ok = await setSetting(keyFor(id), str);
  if (!ok) return NextResponse.json({ error: "save failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// PORTFOLIO LOAN FILE — the property set behind one loan file.
//
// Stored per file under app_settings (`FILE_PORTFOLIO:<id>`), the same pattern
// `FILE_DISPOSITION:<id>` and `los_file_notes:<id>` already use, because loan_files has no
// jsonb column and this project has no migration runner.
//
// A file with no portfolio behaves exactly as it always has — every handler here returns
// `portfolio: null` and touches nothing. Attaching one never rewrites loan_files.property_value,
// loan_amount or property_address: those columns feed company volume on the dashboard, the LTV on
// a wholesaler shopping sheet and a pre-approval letter a listing agent reads, and a sum across
// properties that are merely being LOOKED AT would make each of those confidently wrong rather
// than obviously blank. The columns keep describing the primary property; the set's arithmetic is
// reported here, split into committed and identified so nothing can blend them.
//
// Staff-gated by the /api/los matcher in proxy.ts.
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { getSetting, setSetting } from "@/lib/settings";
import { logActivity } from "@/lib/activity";
import {
  filePortfolioKey, parsePortfolio, emptyPortfolio, fromUwPortfolio,
  addProperty, updateProperty, dropProperty, setPrimary,
  rollup, purposeClass, primaryProperty, activeProperties, isFail,
  OCCUPANCIES, PROPERTY_STATUSES, type FilePortfolio, type Occupancy,
} from "@/lib/losPortfolio";

export const dynamic = "force-dynamic";
const MAX_PROPERTIES = 200;   // one app_settings text row; ~3.5KB at six, ~120KB at the cap

async function loadFile(id: string) {
  const { data } = await supabaseAdmin.from("loan_files").select("id, lead_id, file_number").eq("id", id).maybeSingle();
  return data as { id: string; lead_id: string | null; file_number: string } | null;
}
async function loadPortfolio(id: string): Promise<FilePortfolio | null> {
  return parsePortfolio(await getSetting(filePortfolioKey(id)));
}
async function save(id: string, p: FilePortfolio): Promise<boolean> {
  return setSetting(filePortfolioKey(id), JSON.stringify(p));
}
/** Everything a caller needs, computed in one place so the page and the API cannot disagree. */
function view(p: FilePortfolio | null) {
  if (!p) return { portfolio: null, rollup: null, purpose: null, primary: null };
  return { portfolio: p, rollup: rollup(p), purpose: purposeClass(p), primary: primaryProperty(p) };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const file = await loadFile(id);
    if (!file) return NextResponse.json({ error: "loan file not found" }, { status: 404 });
    return NextResponse.json({ ok: true, ...view(await loadPortfolio(id)) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

// PUT — create the portfolio on this file, empty or imported from a saved /underwrite doc.
// Refuses to clobber an existing one: detach explicitly first, so nobody loses a property list
// to a repeated click.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const file = await loadFile(id);
    if (!file) return NextResponse.json({ error: "loan file not found" }, { status: 404 });
    if (await loadPortfolio(id)) {
      return NextResponse.json({ error: "This file already has a portfolio. Detach it first (DELETE) if you mean to replace it." }, { status: 409 });
    }
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const now = new Date().toISOString();
    const name = typeof body.name === "string" ? body.name : `${file.file_number} portfolio`;
    const occ = body.occupancy as Occupancy | undefined;
    if (occ && !OCCUPANCIES.includes(occ)) {
      return NextResponse.json({ error: `occupancy must be one of ${OCCUPANCIES.join(", ")}` }, { status: 400 });
    }

    let p: FilePortfolio;
    if (typeof body.uw_portfolio_id === "string" && body.uw_portfolio_id) {
      // COPY, never point at it. /underwrite deletes its saved docs with no reference check, and a
      // 40-row screening sheet is a candidate list, not this file's collateral.
      const raw = await getSetting(`uw_portfolio_${body.uw_portfolio_id}`);
      if (!raw) return NextResponse.json({ error: `No saved portfolio "${body.uw_portfolio_id}" — it may have been deleted in /underwrite.` }, { status: 404 });
      let doc: { id: string; name: string; rows: { id: string; address: string }[] };
      try { doc = JSON.parse(raw); } catch { return NextResponse.json({ error: "That saved portfolio could not be read." }, { status: 422 }); }
      if (!Array.isArray(doc?.rows) || !doc.rows.length) return NextResponse.json({ error: "That saved portfolio has no properties." }, { status: 422 });
      const sel = Array.isArray(body.property_ids) ? (body.property_ids as string[]) : undefined;
      p = fromUwPortfolio(doc as never, { loanFileId: id, newId: () => randomUUID(), now, selectIds: sel, occupancy: occ ?? null });
      if (!p.properties.length) return NextResponse.json({ error: "None of the selected rows had an address." }, { status: 422 });
      if (p.properties.length > MAX_PROPERTIES) return NextResponse.json({ error: `That portfolio has ${p.properties.length} properties; the limit on one file is ${MAX_PROPERTIES}.` }, { status: 422 });
      p.name = typeof body.name === "string" ? body.name : doc.name;
    } else {
      p = emptyPortfolio(id, name, now);
    }

    if (!(await save(id, p))) return NextResponse.json({ error: "Couldn't save the portfolio — please try again." }, { status: 500 });
    await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: file.lead_id, actor: "lo",
      action: "file.portfolio_attached", detail: { name: p.name, properties: p.properties.length, source: p.source?.id ?? null } }).catch(() => {});
    return NextResponse.json({ ok: true, ...view(p) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

// PATCH — one action per call: add | update | drop | primary | rename.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const file = await loadFile(id);
    if (!file) return NextResponse.json({ error: "loan file not found" }, { status: 404 });
    const p = await loadPortfolio(id);
    if (!p) return NextResponse.json({ error: "This file has no portfolio yet. Create one first (PUT)." }, { status: 409 });

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = String(body.action || "");
    const now = new Date().toISOString();
    let next: FilePortfolio;
    let detail: Record<string, unknown> = {};

    if (action === "add") {
      if (activeProperties(p).length >= MAX_PROPERTIES) return NextResponse.json({ error: `A file is limited to ${MAX_PROPERTIES} properties.` }, { status: 422 });
      const input = (body.property || {}) as Record<string, unknown>;
      if (input.status && !PROPERTY_STATUSES.includes(input.status as never)) return NextResponse.json({ error: `status must be one of ${PROPERTY_STATUSES.join(", ")}` }, { status: 400 });
      if (input.occupancy && !OCCUPANCIES.includes(input.occupancy as never)) return NextResponse.json({ error: `occupancy must be one of ${OCCUPANCIES.join(", ")}` }, { status: 400 });
      const r = addProperty(p, input as never, randomUUID(), now);
      if (isFail(r)) return NextResponse.json({ error: r.error }, { status: 400 });
      next = r.portfolio; detail = { address: r.property.address, status: r.property.status };
    } else if (action === "update") {
      const r = updateProperty(p, String(body.property_id || ""), (body.patch || {}) as never, now);
      if (isFail(r)) return NextResponse.json({ error: r.error }, { status: 400 });
      next = r; detail = { property_id: body.property_id, fields: Object.keys((body.patch || {}) as object) };
    } else if (action === "drop") {
      const r = dropProperty(p, String(body.property_id || ""), String(body.reason || ""), now);
      if (isFail(r)) return NextResponse.json({ error: r.error }, { status: 400 });
      next = r; detail = { property_id: body.property_id, reason: body.reason };
    } else if (action === "primary") {
      const r = setPrimary(p, String(body.property_id || ""), now);
      if (isFail(r)) return NextResponse.json({ error: r.error }, { status: 400 });
      next = r; detail = { property_id: body.property_id };
    } else if (action === "rename") {
      const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (!name) return NextResponse.json({ error: "name cannot be blank" }, { status: 400 });
      next = { ...p, name, updated_at: now }; detail = { name };
    } else {
      return NextResponse.json({ error: "action must be one of add, update, drop, primary, rename" }, { status: 400 });
    }

    if (!(await save(id, next))) return NextResponse.json({ error: "Couldn't save the change — please try again." }, { status: 500 });
    await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: file.lead_id, actor: "lo",
      action: `file.portfolio_${action}`, detail }).catch(() => {});
    return NextResponse.json({ ok: true, ...view(next) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

// DELETE — detach the portfolio. The loan file and its single-property columns are untouched,
// so the file simply goes back to being an ordinary one-property file.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const file = await loadFile(id);
    if (!file) return NextResponse.json({ error: "loan file not found" }, { status: 404 });
    const p = await loadPortfolio(id);
    if (!p) return NextResponse.json({ ok: true, portfolio: null });
    if (!(await setSetting(filePortfolioKey(id), ""))) return NextResponse.json({ error: "Couldn't detach the portfolio — please try again." }, { status: 500 });
    await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: file.lead_id, actor: "lo",
      action: "file.portfolio_detached", detail: { name: p.name, properties: p.properties.length } }).catch(() => {});
    return NextResponse.json({ ok: true, portfolio: null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

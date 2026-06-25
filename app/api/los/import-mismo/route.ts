import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { assembleUrla, urlaCompleteness, normalizeState } from "@/lib/urla";
import { encryptUrlaSsns } from "@/lib/crypto";
import { parseMismo34 } from "@/lib/mismoImport";
import { createLoanFileFromLead } from "@/lib/los";
import { logActivity } from "@/lib/activity";

// Import a MISMO 3.4 / Calyx Point 1003 XML into the LOS.
//   POST /api/los/import-mismo?file=<id>   -> merge into an existing loan file
//   POST /api/los/import-mismo             -> create a new lead + loan file from the XML
// Body: multipart/form-data, field "xml" = the .xml file.
// Auth-gated via the /api/los matcher. SSNs are encrypted at rest; the original
// file is archived to storage so nothing is lost.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BUCKET = "loan-docs";
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

// Overlay parsed (patch) values onto the current URLA without wiping existing
// data: empty strings / undefined never overwrite; arrays replace only when the
// patch has items; borrowers merge index-wise.
function overlay(base: any, patch: any): any {
  if (patch === undefined || patch === null) return base;
  if (Array.isArray(patch)) return patch.length ? patch : base;
  if (typeof patch === "object") {
    const out: any = base && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};
    for (const k of Object.keys(patch)) out[k] = overlay(out[k], patch[k]);
    return out;
  }
  if (typeof patch === "string" && patch.trim() === "") return base;
  return patch;
}

export async function POST(req: NextRequest) {
  try {
    const fileId = req.nextUrl.searchParams.get("file");

    // 1) Read + validate the upload.
    const form = await req.formData().catch(() => null);
    const file = form?.get("xml") as File | null;
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Attach the MISMO XML as form field 'xml'." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 8 MB)." }, { status: 413 });
    }
    const xml = await file.text();
    // Accept a namespaced or default-namespaced root (<MESSAGE>, <MESSAGE xmlns=…>,
    // <ns:MESSAGE>) — the old strict check rejected valid Point/MISMO exports that
    // prefix the root, which read to the user as "import doesn't work".
    if (!/<(?:[A-Za-z0-9_]+:)?MESSAGE[\s>/]/i.test(xml)) {
      return NextResponse.json({ error: "That doesn't look like a MISMO 1003 XML (no <MESSAGE> root). In Calyx Point, export via Interfaces → MISMO 3.4 (ULAD)." }, { status: 422 });
    }

    // 2) Parse.
    let parsed;
    try { parsed = parseMismo34(xml); }
    catch (e: any) { return NextResponse.json({ error: e?.message || "Could not parse the file." }, { status: 422 }); }
    const p = parsed.urla;
    const b0 = p.borrowers[0] || {};

    // Parsed OK but nothing recognizable inside → almost certainly the WRONG export
    // (Point's native file, or a Fannie Mae 3.2 / DU file) rather than MISMO 3.4 / ULAD.
    // Tell the LO exactly that instead of "succeeding" into a blank 1003.
    if (!p.borrowers.length && p.loan?.amount == null && !p.property?.address && !(p.assets || []).length) {
      return NextResponse.json({
        error: "Parsed the XML but found no 1003 data in it. In Calyx Point, export via Interfaces → MISMO 3.4 (ULAD) — not the native Point file. Fannie Mae 3.2 / DU files aren't supported here.",
      }, { status: 422 });
    }

    // 3) Resolve (or create) the loan file + lead.
    let loanFile: any = null;
    let lead: any = null;

    if (fileId) {
      const { data: lf } = await supabaseAdmin.from("loan_files").select("*").eq("id", fileId).maybeSingle();
      if (!lf) return NextResponse.json({ error: "Loan file not found." }, { status: 404 });
      loanFile = lf;
      if (lf.lead_id) {
        const { data } = await supabaseAdmin.from("leads").select("*").eq("id", lf.lead_id).maybeSingle();
        lead = data;
      }
      if (!lead) return NextResponse.json({ error: "This loan file has no linked lead record." }, { status: 409 });
    } else {
      // Create a fresh lead from the parsed application, then a loan file.
      const fullName = b0.fullName || [b0.firstName, b0.lastName].filter(Boolean).join(" ") || "Imported Borrower";
      const state = normalizeState(p.property?.address?.state || b0.currentAddress?.state);
      const propAddr = [p.property?.address?.street, p.property?.address?.city, p.property?.address?.state, p.property?.address?.zip]
        .filter(Boolean).join(", ") || null;
      const liquid = (p.assets || []).reduce((sum, a) => sum + (a.balance || 0), 0) || null;
      const leadRow: any = {
        first_name: b0.firstName || null,
        last_name: b0.lastName || null,
        full_name: fullName,
        email: b0.email || null,
        phone: b0.cellPhone || b0.homePhone || null,
        state: state || null,
        loan_purpose: p.loan?.purpose || null,
        occupancy: p.property?.occupancy || null,
        property_address: propAddr,
        property_value: p.property?.presentValue ?? null,
        loan_amount_requested: p.loan?.amount ?? null,
        income: b0.income?.total ?? null,
        liquid_assets: liquid,
        source: `MISMO import${parsed.summary.originationSystem ? ` (${parsed.summary.originationSystem})` : ""}`,
      };
      const { data: newLead, error: leadErr } = await supabaseAdmin.from("leads").insert([leadRow]).select().single();
      if (leadErr || !newLead) throw new Error("Could not create lead: " + (leadErr?.message || "unknown"));
      lead = newLead;
      loanFile = await createLoanFileFromLead(lead);
      if (!loanFile) throw new Error("Lead created but loan file creation failed.");
    }

    // 4) Merge parsed data over whatever's already on file (nothing lost).
    const current = assembleUrla(lead, loanFile);
    const merged: any = overlay(current, p);
    merged.borrowers = (p.borrowers.length ? p.borrowers : current.borrowers).map(
      (pb: any, i: number) => overlay(current.borrowers?.[i] || {}, pb)
    );
    if (!merged.borrowers.length) merged.borrowers = [{}];
    merged.meta = { ...(current.meta || {}), source: "mismo-import", importedAt: new Date().toISOString() };

    // 5) Persist URLA (SSN encrypted at rest), mirror first-class columns.
    const raw = lead.raw && typeof lead.raw === "object" ? lead.raw : {};
    raw.urla = encryptUrlaSsns(merged);
    const { error: upErr } = await supabaseAdmin.from("leads").update({ raw }).eq("id", lead.id);
    if (upErr) throw new Error("Saving the 1003 failed: " + upErr.message);

    const leadPatch: any = {};
    if (merged.loan?.amount) leadPatch.loan_amount_requested = merged.loan.amount;
    if (merged.borrowers[0]?.income?.total) leadPatch.income = merged.borrowers[0].income.total;
    if (merged.property?.presentValue) leadPatch.property_value = merged.property.presentValue;
    if (Object.keys(leadPatch).length) await supabaseAdmin.from("leads").update(leadPatch).eq("id", lead.id);

    // Keep the loan_files denormalized display fields fresh.
    const filePatch: any = { updated_at: new Date().toISOString() };
    const bn = merged.borrowers[0]?.fullName || [merged.borrowers[0]?.firstName, merged.borrowers[0]?.lastName].filter(Boolean).join(" ");
    if (bn) filePatch.borrower_name = bn;
    if (merged.property?.presentValue) filePatch.property_value = merged.property.presentValue;
    if (merged.loan?.amount) filePatch.loan_amount = merged.loan.amount;
    if (parsed.summary.propertyAddress) filePatch.property_address = parsed.summary.propertyAddress;
    if (b0.email) filePatch.email = b0.email;
    if (b0.cellPhone || b0.homePhone) filePatch.phone = b0.cellPhone || b0.homePhone;
    await supabaseAdmin.from("loan_files").update(filePatch).eq("id", loanFile.id);

    // 6) Archive the original XML so the source of truth is never lost.
    let archived = false;
    try {
      const safeName = (file.name || "import.xml").replace(/[^\w.\-]+/g, "_").slice(-80);
      const path = `${loanFile.id}/imports/${Date.now()}-${safeName}`;
      const { error: stErr } = await supabaseAdmin.storage.from(BUCKET).upload(path, xml, {
        contentType: "application/xml", upsert: false,
      });
      if (!stErr) {
        await supabaseAdmin.from("loan_documents").insert([{
          loan_file_id: loanFile.id,
          name: `Imported 1003 (MISMO XML) — ${file.name || "Calyx Point export"}`,
          category: "Origination",
          required: false,
          status: "accepted",
          uploaded_by: "system",
          storage_path: path,
          file_name: file.name || "1003.xml",
        }]);
        archived = true;
      }
    } catch { /* archival is best-effort; the structured data is already saved */ }

    await logActivity({
      entity_type: "loan_file", entity_id: loanFile.id, loan_file_id: loanFile.id, lead_id: lead.id,
      actor: "lo", action: "loan_file.mismo_imported",
      detail: { borrowers: parsed.summary.borrowers, lenderLoanId: parsed.summary.lenderLoanId, system: parsed.summary.originationSystem, archived },
    });

    const completeness = urlaCompleteness(assembleUrla({ ...lead, raw }, loanFile));
    return NextResponse.json({
      ok: true,
      fileId: loanFile.id,
      fileNumber: loanFile.file_number,
      leadId: lead.id,
      created: !fileId,
      archived,
      summary: parsed.summary,
      warnings: parsed.warnings,
      completeness,
    });
  } catch (e: any) {
    console.error("[los/import-mismo] error:", e);
    return NextResponse.json({ error: e?.message || "Import failed." }, { status: 500 });
  }
}

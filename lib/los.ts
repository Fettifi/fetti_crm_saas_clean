// Built-in Loan Origination System (LOS) core.
// - Loan files (the working file for a deal), with a unique share token that
//   becomes the borrower's custom document link.
// - Auto-generated document checklist + compliance milestones per product.
// - Helpers to create a file from a lead and keep one file per lead.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";

// LOS pipeline stages, in order.
export const STAGES = [
  "Application",
  "Processing",
  "Underwriting",
  "Approved",
  "Clear to Close",
  "Funded",
  "Closed",
] as const;

export function shareToken(): string {
  // Unguessable, URL-safe. Two UUIDs of entropy, hex, no dashes.
  const rnd = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(16).slice(2) + Date.now().toString(16);
  return (rnd() + rnd()).slice(0, 28);
}

export function fileNumber(): string {
  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `FF-${ym}-${rand}`;
}

type Doc = { name: string; category: string; required: boolean };

// Document checklist tailored to the product. Investment/DSCR never ask for
// personal income docs; business/commercial ask for entity + business docs.
export function docChecklistFor(product?: string, occupancy?: string): Doc[] {
  const p = (product || "").toLowerCase();
  const isDscr = p.includes("dscr") || p.includes("airbnb") || p.includes("rental");
  const isFlip = /(flip|rehab|construction|bridge)/.test(p);
  const isBiz = /(commercial|sba|business|working capital|equipment)/.test(p);
  const isInvestor = isDscr || isFlip || /invest|multi-?family/.test(p) || occupancy === "Investor" || occupancy === "Investment/Commercial";
  const isPurchase = p.includes("purchase") || p.includes("buy") || isFlip;

  const base: Doc[] = [
    { name: "Government-issued photo ID", category: "Identity", required: true },
    { name: "Bank statements — last 2 months", category: "Assets", required: true },
  ];
  if (isPurchase) base.push({ name: "Purchase contract", category: "Property", required: true });

  if (isBiz) {
    return [
      ...base,
      { name: "Entity documents (Articles, Operating Agreement, EIN)", category: "Business", required: true },
      { name: "Business bank statements — last 3 months", category: "Business", required: true },
      { name: "Year-to-date P&L and balance sheet", category: "Business", required: true },
      { name: "Business tax returns — last 2 years", category: "Business", required: false },
      { name: "Rent roll / lease agreements (if applicable)", category: "Property", required: false },
      { name: "Property insurance quote", category: "Property", required: true },
    ];
  }
  if (isDscr) {
    return [
      ...base,
      { name: "Lease agreement or market rent estimate (Form 1007)", category: "Property", required: true },
      { name: "Property insurance quote", category: "Property", required: true },
      { name: "Entity documents (if vesting in an LLC)", category: "Business", required: false },
      { name: "Mortgage statement (if refinance)", category: "Property", required: false },
      // NOTE: DSCR qualifies on property cash flow — no pay stubs / tax returns.
    ];
  }
  if (isFlip) {
    return [
      ...base,
      { name: "Scope of work / rehab budget", category: "Project", required: true },
      { name: "After-repair value (ARV) comps or appraisal", category: "Project", required: true },
      { name: "Track record of prior projects (if any)", category: "Experience", required: false },
      { name: "Contractor bid (if applicable)", category: "Project", required: false },
      { name: "Property insurance (builder's risk)", category: "Property", required: true },
    ];
  }
  if (isInvestor) {
    // Any other business-purpose investment loan (e.g. Multi-Family Investor
    // Financing, Investment HELOC) — qualifies on the PROPERTY, never on the
    // borrower's personal income. No pay stubs / W-2s / personal tax returns.
    return [
      ...base,
      { name: "Rent roll / lease agreements", category: "Property", required: true },
      { name: "Property insurance quote", category: "Property", required: true },
      { name: "Entity documents (if vesting in an LLC)", category: "Business", required: false },
      { name: "Mortgage statement (if refinance)", category: "Property", required: false },
    ];
  }
  // Consumer (owner-occupied) — full income/asset documentation.
  return [
    ...base,
    { name: "Pay stubs — last 30 days", category: "Income", required: true },
    { name: "W-2s — last 2 years", category: "Income", required: true },
    { name: "Tax returns — last 2 years", category: "Income", required: false },
    { name: "Homeowners insurance quote", category: "Property", required: true },
    { name: "Gift letter (if using gift funds)", category: "Assets", required: false },
    { name: "Down payment assistance approval (if applicable)", category: "Assets", required: false },
  ];
}

type Comp = { key: string; label: string; done: boolean };

// Compliance milestones. Consumer loans are TRID-regulated; business/investment
// (business-purpose) loans are TRID-exempt and tracked more lightly.
export function complianceFor(product?: string, occupancy?: string): Comp[] {
  const p = (product || "").toLowerCase();
  const isBizPurpose =
    /(dscr|airbnb|rental|flip|rehab|construction|bridge|commercial|sba|business|working capital|equipment|invest|multi-?family)/.test(p) ||
    occupancy === "Investor" || occupancy === "Investment/Commercial";
  if (isBizPurpose) {
    return [
      { key: "term_sheet", label: "Term sheet issued", done: false },
      { key: "entity_verified", label: "Entity / vesting verified", done: false },
      { key: "appraisal_bpo", label: "Appraisal / BPO ordered", done: false },
      { key: "insurance_binder", label: "Insurance binder received", done: false },
      { key: "title_ordered", label: "Title ordered", done: false },
    ];
  }
  const items: Comp[] = [
    { key: "le_3day", label: "Loan Estimate delivered within 3 business days", done: false },
    { key: "intent_to_proceed", label: "Intent to Proceed received", done: false },
    { key: "initial_disclosures", label: "Initial disclosures e-signed", done: false },
    { key: "appraisal_ordered", label: "Appraisal ordered", done: false },
    { key: "cd_3day", label: "Closing Disclosure delivered ≥3 business days before closing", done: false },
  ];
  if (p.includes("refinance") || p.includes("refi") || p.includes("heloc") || p.includes("equity")) {
    items.push({ key: "rescission", label: "Right of Rescission (3-day) honored", done: false });
  }
  return items;
}

export type LoanFile = Record<string, any>;

// Create a loan file from a lead, seed its document checklist + compliance, and
// log the activity. Returns the created file (with a fresh share token).
export async function createLoanFileFromLead(lead: LoanFile): Promise<LoanFile | null> {
  const product = lead.loan_purpose || lead.product || null;
  const token = shareToken();
  const row = {
    file_number: fileNumber(),
    lead_id: lead.id,
    share_token: token,
    borrower_name: lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(" ") || null,
    email: lead.email || null,
    phone: lead.phone || null,
    product,
    occupancy: lead.occupancy || null,
    property_address: lead.property_address || null,
    property_value: lead.property_value ?? null,
    loan_amount: lead.loan_amount_requested ?? null,
    state: lead.state || null,
    stage: "Application",
    status: "active",
    compliance: complianceFor(product, lead.occupancy),
  };
  const { data: file, error } = await supabaseAdmin.from("loan_files").insert([row]).select().single();
  if (error || !file) {
    console.warn("[los] create loan file failed:", error?.message);
    return null;
  }
  const docs = docChecklistFor(product, lead.occupancy).map((d) => ({
    loan_file_id: file.id, name: d.name, category: d.category, required: d.required, status: "needed", uploaded_by: "system",
  }));
  if (docs.length) await supabaseAdmin.from("loan_documents").insert(docs);
  await logActivity({
    entity_type: "loan_file", entity_id: file.id, loan_file_id: file.id, lead_id: lead.id,
    actor: "system", action: "loan_file.created",
    detail: { file_number: file.file_number, product, docs: docs.length },
  });
  return file;
}

// Auto-advance Application -> Processing once every REQUIRED document is in.
// Called after a borrower upload or an LO document review. Only moves the first
// stage automatically; later stages need a human decision.
export async function maybeAdvanceStage(loanFileId: string): Promise<void> {
  try {
    const { data: file } = await supabaseAdmin
      .from("loan_files").select("id, stage, lead_id").eq("id", loanFileId).maybeSingle();
    if (!file || file.stage !== "Application") return;
    const { data: req } = await supabaseAdmin
      .from("loan_documents").select("status").eq("loan_file_id", loanFileId).eq("required", true);
    if (!req || !req.length) return;
    const allIn = req.every((d: any) => d.status === "received" || d.status === "accepted");
    if (!allIn) return;
    await supabaseAdmin.from("loan_files")
      .update({ stage: "Processing", updated_at: new Date().toISOString() }).eq("id", loanFileId);
    // All required documents are in — this is now a COMPLETE APPLICATION, not a
    // raw lead. Mark the lead "Application" so the Leads view and the
    // Applications view stay cleanly separated.
    if (file.lead_id) {
      try {
        await supabaseAdmin.from("leads")
          .update({ stage: "Application" }).eq("id", file.lead_id);
      } catch (e) { console.warn("[los] mark lead application failed", e); }
    }
    await logActivity({
      entity_type: "loan_file", entity_id: loanFileId, loan_file_id: loanFileId, lead_id: file.lead_id,
      actor: "system", action: "stage.changed",
      detail: { stage: "Processing", reason: "all required documents received" },
    });
  } catch (e) {
    console.warn("[los] maybeAdvanceStage failed:", e);
  }
}

// One loan file per lead. Returns the existing file or creates one.
export async function ensureLoanFileForLead(lead: LoanFile): Promise<LoanFile | null> {
  if (!lead?.id) return null;
  const { data: existing } = await supabaseAdmin
    .from("loan_files").select("*").eq("lead_id", lead.id).limit(1).maybeSingle();
  if (existing) return existing;
  return createLoanFileFromLead(lead);
}

// ---- Lead-scoped upload link + lazy LOS promotion ----
// A lead can be handed a WORKING document-upload link without yet occupying the LOS.
// The link's token lives on the LEAD (raw.upload_token). The borrower can upload any
// time (never hindered); the loan file opens LAZILY on their first upload — the real
// signal a lead is a loan — so tire-kickers who never upload never clutter the LOS.

// Ensure the lead has a stable upload token (in raw.upload_token). Idempotent.
export async function ensureLeadUploadToken(lead: any): Promise<string | null> {
  if (!lead?.id) return null;
  const raw = lead.raw && typeof lead.raw === "object" ? lead.raw : {};
  if (raw.upload_token) return String(raw.upload_token);
  const t = shareToken();
  raw.upload_token = t;
  const { error } = await supabaseAdmin.from("leads").update({ raw }).eq("id", lead.id);
  if (error) { console.warn("[los] ensureLeadUploadToken failed:", error.message); return null; }
  lead.raw = raw;
  return t;
}

// Resolve a borrower-portal token to its target. A token belongs EITHER to an existing
// loan file (loan_files.share_token) OR to a lead with no file yet (raw.upload_token).
// A lead token keeps working AFTER a file opens (mapped via lead_id) so the borrower's
// original link never breaks.
export async function resolvePortalToken(token: string): Promise<{ file: any | null; lead: any | null }> {
  if (!token || token.length < 12) return { file: null, lead: null };
  const { data: file } = await supabaseAdmin.from("loan_files").select("*").eq("share_token", token).maybeSingle();
  if (file) {
    let lead: any = null;
    if (file.lead_id) { const r = await supabaseAdmin.from("leads").select("*").eq("id", file.lead_id).maybeSingle(); lead = r.data; }
    return { file, lead };
  }
  const { data: lead } = await supabaseAdmin.from("leads").select("*").eq("raw->>upload_token", token).maybeSingle();
  if (lead) {
    const { data: existing } = await supabaseAdmin.from("loan_files").select("*").eq("lead_id", lead.id).maybeSingle();
    return { file: existing || null, lead };
  }
  return { file: null, lead: null };
}

// Promote a lead INTO the LOS — open its loan file the moment it shows real intent
// (first document upload). Idempotent. The new file ADOPTS the lead's upload token as
// its share_token, so the borrower's link is seamless before and after promotion.
export async function promoteLeadToLoanFile(lead: any): Promise<LoanFile | null> {
  if (!lead?.id) return null;
  const { data: existing } = await supabaseAdmin.from("loan_files").select("*").eq("lead_id", lead.id).maybeSingle();
  if (existing) return existing;
  const file = await createLoanFileFromLead(lead);
  if (!file) return null;
  const leadToken = lead.raw && typeof lead.raw === "object" ? lead.raw.upload_token : null;
  if (leadToken && leadToken !== file.share_token) {
    const { error } = await supabaseAdmin.from("loan_files").update({ share_token: leadToken }).eq("id", file.id);
    if (!error) file.share_token = leadToken;
  }
  // Real re-open (borrower actually uploaded a doc) → clear the deletion guard so the
  // lead reflects reality: the file is live again, not "deleted".
  if (lead.raw && typeof lead.raw === "object" && lead.raw.los_deleted_at) {
    const raw = { ...lead.raw }; delete raw.los_deleted_at;
    const { error } = await supabaseAdmin.from("leads").update({ raw }).eq("id", lead.id);
    if (!error) lead.raw = raw;
  }
  await logActivity({
    entity_type: "loan_file", entity_id: file.id, loan_file_id: file.id, lead_id: lead.id,
    actor: "borrower", action: "lead.promoted", detail: { reason: "first document upload", file_number: file.file_number },
  }).catch(() => {});
  return file;
}

// ---- Permanent deletion (cascade) ----
// Removes a loan file and EVERYTHING tied to it. When purgeStorage is true, the
// uploaded files (borrower docs + e-signed PDFs) are erased from the loan-docs
// bucket too — irreversible. Used by the LOS + Leads delete buttons (double-
// confirmed in the UI). Service-role only (callers must auth-gate).
const DOCS_BUCKET = "loan-docs";

export async function deleteLoanFileCascade(
  fileId: string,
  opts: { purgeStorage?: boolean } = {},
): Promise<{ files: number; docs: number; storage: number }> {
  const out = { files: 0, docs: 0, storage: 0 };
  const { data: fileRow } = await supabaseAdmin
    .from("loan_files").select("lead_id").eq("id", fileId).maybeSingle();
  const { data: docs } = await supabaseAdmin
    .from("loan_documents").select("id, storage_path").eq("loan_file_id", fileId);

  if (opts.purgeStorage) {
    const paths = new Set<string>();
    for (const d of docs || []) if (d.storage_path) paths.add(d.storage_path as string);
    // Also sweep anything left under the file's own folder (orphans).
    try {
      const { data: listed } = await supabaseAdmin.storage.from(DOCS_BUCKET).list(fileId);
      for (const o of listed || []) paths.add(`${fileId}/${o.name}`);
    } catch { /* listing best-effort */ }
    if (paths.size) {
      try {
        const { data: removed } = await supabaseAdmin.storage.from(DOCS_BUCKET).remove([...paths]);
        out.storage = (removed || []).length;
      } catch { /* removal best-effort */ }
    }
  }

  await supabaseAdmin.from("loan_documents").delete().eq("loan_file_id", fileId);
  out.docs = (docs || []).length;
  await supabaseAdmin.from("activity_log").delete().eq("loan_file_id", fileId);
  await supabaseAdmin.from("preapprovals").delete().eq("loan_file_id", fileId);
  await supabaseAdmin.from("loan_files").delete().eq("id", fileId);
  out.files = 1;
  // Flag the lead so the hourly self-heal cron doesn't resurrect this deleted file
  // (ensureLoanFileForLead backfills "Application" leads that lack a file). A genuine
  // new borrower upload can still re-open a file; this only blocks auto-recreation.
  if ((fileRow as any)?.lead_id) {
    try {
      const { data: lead } = await supabaseAdmin.from("leads").select("raw").eq("id", (fileRow as any).lead_id).maybeSingle();
      const raw = (lead as any)?.raw && typeof (lead as any).raw === "object" ? (lead as any).raw : {};
      raw.los_deleted_at = new Date().toISOString();
      await supabaseAdmin.from("leads").update({ raw }).eq("id", (fileRow as any).lead_id);
    } catch { /* best-effort */ }
  }
  return out;
}

export async function deleteLeadCascade(
  leadId: string,
  opts: { purgeStorage?: boolean } = {},
): Promise<{ files: number; docs: number; storage: number }> {
  const totals = { files: 0, docs: 0, storage: 0 };
  const { data: files } = await supabaseAdmin.from("loan_files").select("id").eq("lead_id", leadId);
  for (const f of files || []) {
    const r = await deleteLoanFileCascade(f.id as string, opts);
    totals.files += r.files; totals.docs += r.docs; totals.storage += r.storage;
  }
  await supabaseAdmin.from("lead_agents").delete().eq("lead_id", leadId);
  await supabaseAdmin.from("activity_log").delete().eq("lead_id", leadId);
  await supabaseAdmin.from("preapprovals").delete().eq("lead_id", leadId);
  await supabaseAdmin.from("leads").delete().eq("id", leadId);
  return totals;
}

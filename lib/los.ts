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
  const isInvestor = isDscr || isFlip || occupancy === "Investor" || occupancy === "Investment/Commercial";
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
    /(dscr|airbnb|rental|flip|rehab|construction|bridge|commercial|sba|business|working capital|equipment)/.test(p) ||
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

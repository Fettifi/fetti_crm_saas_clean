// Public, token-gated view for the borrower's custom link. The token belongs EITHER
// to a real loan file OR to a lead that hasn't opened a file yet (lead-scoped upload
// link). Either way the borrower sees their document checklist and can upload — but a
// plain lead never occupies the LOS until their FIRST upload opens the file.
// Returns only borrower-safe fields (no internal notes, scores, or activity).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { cfg } from "@/lib/settings";
import { resolvePortalToken, docChecklistFor } from "@/lib/los";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 12) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { file, lead } = await resolvePortalToken(token);
  const calendly = (await cfg("CALENDLY_URL")) || "";

  // Existing loan file — the borrower's live file + its real document checklist.
  if (file) {
    const { data: documents } = await supabaseAdmin
      .from("loan_documents")
      .select("id, name, category, required, status, file_name, notes, updated_at")
      .eq("loan_file_id", file.id)
      .order("required", { ascending: false }).order("created_at");
    return NextResponse.json({
      file: {
        file_number: file.file_number, borrower_name: file.borrower_name, product: file.product,
        stage: file.stage, status: file.status, property_address: file.property_address, state: file.state,
      },
      documents: documents || [],
      calendly,
    });
  }

  // Lead with no file yet — show a PREVIEW checklist (from the product) so they know
  // what to upload; the LOS file opens on their first actual upload. Log the portal
  // view ONCE as a leading "intent" signal so the team can see a lead is engaging.
  if (lead) {
    try {
      if (!(lead.raw && typeof lead.raw === "object" && lead.raw.portal_viewed_at)) {
        const raw = lead.raw && typeof lead.raw === "object" ? lead.raw : {};
        raw.portal_viewed_at = new Date().toISOString();
        await supabaseAdmin.from("leads").update({ raw }).eq("id", lead.id);
        await logActivity({
          entity_type: "lead", entity_id: lead.id, lead_id: lead.id, actor: "borrower",
          action: "portal.viewed", detail: { via: "upload-link" },
        }).catch(() => {});
      }
    } catch { /* best-effort signal */ }

    const preview = docChecklistFor(lead.loan_purpose, lead.occupancy).map((d) => ({
      id: `needed:${d.name}`, name: d.name, category: d.category, required: d.required, status: "needed",
    }));
    const borrower_name = lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "";
    return NextResponse.json({
      file: {
        file_number: "", borrower_name, product: lead.loan_purpose || "Your loan",
        stage: "Application", status: "lead", property_address: lead.property_address || null, state: lead.state || null,
      },
      documents: preview,
      calendly,
    });
  }

  return NextResponse.json({ error: "not found" }, { status: 404 });
}

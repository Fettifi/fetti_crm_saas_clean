// Public, token-gated view of a loan file for the borrower's custom link.
// Returns only borrower-safe fields + the document checklist (no internal notes,
// scores, or activity).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 12) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { data: file } = await supabaseAdmin
    .from("loan_files")
    .select("id, file_number, borrower_name, product, stage, status, property_address, state, created_at")
    .eq("share_token", token).maybeSingle();
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data: documents } = await supabaseAdmin
    .from("loan_documents")
    .select("id, name, category, required, status, file_name, updated_at")
    .eq("loan_file_id", file.id)
    .order("required", { ascending: false }).order("created_at");
  return NextResponse.json({
    file: {
      file_number: file.file_number, borrower_name: file.borrower_name, product: file.product,
      stage: file.stage, status: file.status, property_address: file.property_address, state: file.state,
    },
    documents: documents || [],
  });
}

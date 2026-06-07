// LOS document management for the loan officer: request a new document, update a
// document's status, or get a signed URL to view an uploaded file.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { maybeAdvanceStage } from "@/lib/los";

export const dynamic = "force-dynamic";
const BUCKET = "loan-docs";

// GET ?doc_id=...  -> signed URL to view the uploaded file (10 min).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const docId = req.nextUrl.searchParams.get("doc_id");
  if (!docId) return NextResponse.json({ error: "doc_id required" }, { status: 400 });
  const { data: doc } = await supabaseAdmin.from("loan_documents").select("storage_path").eq("id", docId).eq("loan_file_id", id).maybeSingle();
  if (!doc?.storage_path) return NextResponse.json({ error: "no file uploaded" }, { status: 404 });
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(doc.storage_path, 600);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}

// POST { name, category, required } -> request a new document on this file.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const b = await req.json();
    if (!b.name) return NextResponse.json({ error: "name required" }, { status: 400 });
    const { data: doc, error } = await supabaseAdmin.from("loan_documents").insert([{
      loan_file_id: id, name: String(b.name).slice(0, 160), category: b.category || "Other",
      required: b.required !== false, status: "needed", uploaded_by: "lo",
    }]).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logActivity({ entity_type: "document", entity_id: doc.id, loan_file_id: id, actor: "lo", action: "doc.requested", detail: { name: doc.name } });
    return NextResponse.json({ document: doc }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

// PATCH { doc_id, status, notes } -> accept/reject/mark a document.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const b = await req.json();
    if (!b.doc_id) return NextResponse.json({ error: "doc_id required" }, { status: 400 });
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof b.status === "string") patch.status = b.status;       // needed | received | accepted | rejected
    if (typeof b.notes === "string") patch.notes = b.notes;
    const { data: doc, error } = await supabaseAdmin
      .from("loan_documents").update(patch).eq("id", b.doc_id).eq("loan_file_id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logActivity({ entity_type: "document", entity_id: doc.id, loan_file_id: id, actor: "lo", action: "doc.reviewed", detail: { name: doc.name, status: doc.status } });
    await maybeAdvanceStage(id);
    return NextResponse.json({ document: doc });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

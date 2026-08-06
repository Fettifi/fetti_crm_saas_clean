// ATTACH LOAN-FILE DOCUMENTS TO AN OUTLOOK EMAIL, FROM INSIDE OUTLOOK.
//
// Ramon, 2026-08-06: dragging a document out of the LOS into an Outlook compose window does
// nothing. That is not a bug in the drag — Chromium hands the OS a *promised* file, and Outlook
// is not a reliable promise target (Finder and Mail are). Dropping into Outlook on the web cannot
// work at all: a drag between two browser tabs never materialises a File for the receiving page.
//
// So Outlook gets the mechanism Outlook actually supports: Office.js
// `item.addFileAttachmentAsync(uri, name)`, which fetches the URI ITSELF and embeds a real
// attachment in the draft. Nothing is downloaded, nothing is saved to a folder.
//
// THE URI MUST BE FETCHABLE WITHOUT OUR SESSION. Office (and, in several configurations, the
// Exchange service rather than the client) performs that fetch, carrying none of the staff
// cookies. Our own /api/los/... doc route is session-gated and would 401 there. So this returns
// SHORT-LIVED SUPABASE SIGNED URLs — public by possession, expiring in 15 minutes, which is
// ample for an attachment that is fetched the moment the LO clicks Attach.
//
//   GET /api/outlook/attach                 -> recent loan files (id, number, borrower)
//   GET /api/outlook/attach?file=<id>       -> that file's uploaded documents + signed URLs
//
// Auth: the add-in Bearer key (lib/outlookAuth), same as the compose/transcribe endpoints.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { requireAddinAuth } from "@/lib/outlookAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "loan-docs";
const SIGNED_TTL_SECONDS = 900;

export async function GET(req: NextRequest) {
  const denied = await requireAddinAuth(req);
  if (denied) return denied;

  const fileId = req.nextUrl.searchParams.get("file");

  // ── the picker: which loan file are we attaching from ──────────────────────────────────────
  if (!fileId) {
    const q = (req.nextUrl.searchParams.get("q") || "").trim();
    let sel = supabaseAdmin
      .from("loan_files")
      .select("id, file_number, borrower_name, status, updated_at")
      .order("updated_at", { ascending: false })
      .limit(40);
    if (q) sel = sel.or(`borrower_name.ilike.%${q}%,file_number.ilike.%${q}%`);
    const { data, error } = await sel;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ files: data || [] });
  }

  // ── the documents on that file, each with a URL Office can fetch ───────────────────────────
  const { data: docs, error } = await supabaseAdmin
    .from("loan_documents")
    .select("id, name, file_name, storage_path, status, category")
    .eq("loan_file_id", fileId)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const uploaded = ((docs || []) as any[]).filter((d) => d.storage_path);
  const out: any[] = [];
  for (const d of uploaded) {
    // Sign each path individually: createSignedUrls (plural) fails the WHOLE batch if any single
    // object is missing, which would hide every other document behind one stale row.
    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(d.storage_path as string, SIGNED_TTL_SECONDS);
    if (sErr || !signed?.signedUrl) continue;   // skip the unreachable one, keep the rest
    // The name Outlook shows on the attachment. Fall back to the checklist label plus the real
    // extension so an underwriter never receives something called "document".
    const ext = String(d.storage_path).split(".").pop() || "pdf";
    const attachName = String(d.file_name || `${d.name}.${ext}`).replace(/[\r\n"\\/]/g, "-").slice(0, 120);
    out.push({ id: d.id, label: d.name, name: attachName, status: d.status, url: signed.signedUrl });
  }

  const { data: file } = await supabaseAdmin
    .from("loan_files").select("file_number, borrower_name").eq("id", fileId).maybeSingle();

  return NextResponse.json({
    file: file || null,
    documents: out,
    expiresInSeconds: SIGNED_TTL_SECONDS,
    skipped: uploaded.length - out.length,
  });
}

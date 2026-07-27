// Direct-to-storage upload for the BORROWER portal — the same Vercel ~4.5MB request-body
// ceiling that silently killed staff uploads (see ../../los/files/[id]/upload-url). This
// side matters more: borrowers upload bank statements and tax returns, which are routinely
// well over the limit, and the portal could only tell them "(too large)" with no way to
// succeed. Gated by the borrower's own share token, exactly like the multipart route.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { resolvePortalToken, promoteLeadToLoanFile } from "@/lib/los";

export const dynamic = "force-dynamic";
const BUCKET = "loan-docs";
const ALLOWED = /\.(pdf|png|jpe?g|heic|heif|webp|gif|bmp|tiff?|doc|docx|xls|xlsx|csv|txt)$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const { file: existingFile, lead } = await resolvePortalToken(token);
    let file: any = existingFile;
    // Mirrors the multipart route: a borrower arriving with only a lead gets their loan
    // file created on first upload, so the two paths can't diverge.
    if (!file && lead) file = await promoteLeadToLoanFile(lead);
    if (!file) return NextResponse.json({ error: "invalid link" }, { status: 404 });

    const body = await req.json().catch(() => ({} as any));
    const raw = String(body?.fileName || "").trim();
    if (!raw) return NextResponse.json({ error: "fileName is required" }, { status: 400 });
    const safeName = raw.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    if (!ALLOWED.test(safeName)) return NextResponse.json({ error: "Unsupported file type." }, { status: 400 });

    // Path is server-derived and scoped to this borrower's own loan file.
    const path = `${file.id}/${Date.now()}-${safeName}`;
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: error?.message || "Couldn't start the upload." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, path, url: data.signedUrl, fileName: safeName });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

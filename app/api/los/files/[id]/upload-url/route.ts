// Direct-to-storage upload for LOAN DOCUMENTS.
//
// Vercel rejects any request body over ~4.5MB BEFORE the function runs, returning a raw
// FUNCTION_PAYLOAD_TOO_LARGE that the UI could only report as "Connection error during
// upload." The route's own "max 25MB" check was therefore unreachable, and every bank
// statement or tax return above ~4.5MB silently failed (confirmed 2026-07-26 on the Asia
// Dearman file: a 1MB body reached the auth gate and returned 401, a 6MB body was rejected
// by the platform with 413 before any of our code ran).
//
// Same remedy already used for e-sign PDFs: hand the browser a signed URL, let it PUT the
// file straight to Supabase storage with no Vercel in the middle, then post only the
// metadata back to /upload. Staff-gated by the /api/los matcher in proxy.ts.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

export const dynamic = "force-dynamic";
const BUCKET = "loan-docs";
const ALLOWED = /\.(pdf|png|jpe?g|heic|heif|webp|gif|bmp|tiff?|doc|docx|xls|xlsx|csv|txt)$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { data: file } = await supabaseAdmin.from("loan_files").select("id").eq("id", id).maybeSingle();
    if (!file) return NextResponse.json({ error: "loan file not found" }, { status: 404 });

    const body = await req.json().catch(() => ({} as any));
    const raw = String(body?.fileName || "").trim();
    if (!raw) return NextResponse.json({ error: "fileName is required" }, { status: 400 });
    // Same sanitising and allow-list as the multipart route, applied BEFORE a URL is issued
    // so an unsupported type can never get a writable path.
    const safeName = raw.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    if (!ALLOWED.test(safeName)) return NextResponse.json({ error: "Unsupported file type." }, { status: 400 });

    // The path is derived server-side and always scoped under this loan file's folder, so a
    // client can never aim the signed URL at another borrower's documents.
    const path = `${file.id}/${Date.now()}-${safeName}`;
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: error?.message || "Couldn't create an upload URL." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, path, url: data.signedUrl, token: data.token, fileName: safeName });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

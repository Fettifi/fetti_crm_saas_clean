// Direct-to-storage upload for e-sign PDFs. Vercel rejects request bodies over
// ~4.5MB BEFORE the function runs — so posting the PDF through /api/esign/requests
// died with a raw platform error ("Connection error." in the UI) for any normal
// scanned document. The sender page now: (1) gets a signed upload URL here,
// (2) PUTs the PDF straight to Supabase storage (no Vercel body limit),
// (3) posts only metadata + the storage path to /api/esign/requests.
// Auth-gated by the /api/esign matcher in proxy.ts.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { ESIGN_BUCKET, newToken } from "@/lib/esign";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const path = `esign/uploads/${newToken()}.pdf`;
    const { data, error } = await supabaseAdmin.storage.from(ESIGN_BUCKET).createSignedUploadUrl(path);
    if (error || !data?.signedUrl) return NextResponse.json({ error: error?.message || "Couldn't create an upload URL." }, { status: 500 });
    return NextResponse.json({ ok: true, path, url: data.signedUrl });
  } catch (e: any) {
    console.error("[esign/upload-url]", e?.message || e);
    return NextResponse.json({ error: "Upload URL failed." }, { status: 500 });
  }
}

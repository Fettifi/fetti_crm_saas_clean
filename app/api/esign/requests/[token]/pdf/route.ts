import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { ESIGN_BUCKET, getRequest } from "@/lib/esign";

// LO-facing download of an envelope's documents, BY ENVELOPE TOKEN. Auth-gated via the
// /api/esign/requests matcher (the public signer route lives under /api/esign/sign).
//   ?doc=signed (default) → the signed copy (falls back to the source if not signed yet)
//   ?doc=cert             → the Certificate of Completion (available once completed)
//   ?doc=source           → the original uploaded PDF
// This is what surfaces the signed doc + certificate back in the E-Sign screen.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const env = await getRequest(token);
  if (!env) return NextResponse.json({ error: "not found" }, { status: 404 });

  const want = req.nextUrl.searchParams.get("doc") || "signed";
  const path =
    want === "cert" ? env.cert_path :
    want === "source" ? env.source_path :
    (env.signed_path || env.source_path);
  if (!path) {
    return NextResponse.json(
      { error: want === "cert" ? "No certificate yet — it's generated once every signer completes." : "Not available." },
      { status: 404 },
    );
  }

  const { data, error } = await supabaseAdmin.storage.from(ESIGN_BUCKET).download(path);
  if (error || !data) return NextResponse.json({ error: "file unavailable" }, { status: 404 });
  const buf = Buffer.from(await data.arrayBuffer());
  const label = want === "cert" ? "Certificate-of-Completion" : want === "source" ? "Original" : "Signed";
  const safe = (env.title || "document").replace(/[^a-zA-Z0-9]+/g, "-");
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${label}-${safe}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

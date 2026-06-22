import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { ESIGN_BUCKET, getByRecipientToken } from "@/lib/esign";

// Public PDF stream for the signer's iframe (same-origin → satisfies CSP).
// [token] is a recipient token. Serves the working signed copy if present,
// otherwise the source; ?doc=cert serves the Certificate of Completion.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await getByRecipientToken(token);
  if (!res) return NextResponse.json({ error: "not found" }, { status: 404 });
  const env = res.env;
  const want = req.nextUrl.searchParams.get("doc");
  const path = want === "cert" ? (env.cert_path || env.signed_path || env.source_path) : (env.signed_path || env.source_path);
  const { data, error } = await supabaseAdmin.storage.from(ESIGN_BUCKET).download(path);
  if (error || !data) return NextResponse.json({ error: "file unavailable" }, { status: 404 });
  const buf = Buffer.from(await data.arrayBuffer());
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${(env.title || "document").replace(/[^\w.\-]+/g, "_")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

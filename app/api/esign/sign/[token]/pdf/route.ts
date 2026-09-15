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
  const { env, recipient } = res;
  // A recipient who never signed an envelope the sender completed without them has no further
  // business with it: the executed copy and its certificate carry the signers' emails, IP addresses
  // and devices. The sender is told their link stops working — this is what makes that true.
  if (env.closed_by_sender && recipient.status !== "signed") {
    return NextResponse.json({ error: "This envelope is closed." }, { status: 410 });
  }
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

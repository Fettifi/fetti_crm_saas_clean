import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { sendUploadLink } from "@/lib/notify/docRequest";
import { borrowerCode } from "@/lib/borrowerCode";
import { logActivity } from "@/lib/activity";
import { cfg } from "@/lib/settings";

// One-click "send the borrower their secure upload link" — bound to THIS loan
// file only (its own share_token). Auth-gated via the /api/los matcher.
//   POST /api/los/files/[id]/send-link
//   body (optional): { to_name, to_email, to_phone, note }  — overrides the
//   borrower contact (e.g. to text a different number). Defaults to the file's
//   borrower email/phone on record.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { data: file } = await supabaseAdmin
      .from("loan_files")
      .select("id, file_number, borrower_name, email, phone, share_token")
      .eq("id", id)
      .maybeSingle();
    if (!file) return NextResponse.json({ error: "Loan file not found." }, { status: 404 });
    if (!file.share_token) return NextResponse.json({ error: "This file has no secure link yet." }, { status: 409 });

    const body = await req.json().catch(() => ({}));
    const to_name = body?.to_name || file.borrower_name || "there";
    const to_email = body?.to_email ?? file.email ?? null;
    const to_phone = body?.to_phone ?? file.phone ?? null;
    if (!to_email && !to_phone) {
      return NextResponse.json({ error: "No email or phone to send to. Add the borrower's contact on the lead, or pass one in." }, { status: 422 });
    }

    const origin = req.nextUrl.origin;
    const link = `${origin}/file/${file.share_token}`;
    const code = borrowerCode(file.borrower_name, file.id);

    const { sent } = await sendUploadLink({
      to_name, to_email, to_phone, link, code,
      file_number: file.file_number,
      note: typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null,
      calendly: (await cfg("CALENDLY_URL")) || null,
    });

    await logActivity({
      entity_type: "loan_file", entity_id: file.id, loan_file_id: file.id,
      actor: "lo", action: "borrower_link.sent",
      detail: { code, channels: sent, to: to_email ? "email" : "", phone: to_phone ? "sms" : "" },
    });

    return NextResponse.json({
      ok: true,
      sent,
      code,
      link,
      message: sent.length
        ? `Sent the upload link via ${sent.join(" + ")}.`
        : "No email/SMS channel is configured to deliver it. The link is ready to copy and send manually.",
    });
  } catch (e: any) {
    console.error("[los/send-link] error:", e);
    return NextResponse.json({ error: e?.message || "Failed to send link." }, { status: 500 });
  }
}

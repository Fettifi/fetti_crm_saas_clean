// Borrower document upload via their custom link. Multipart: `file` (required)
// and optional `doc_id` to satisfy a specific requested document. Stores to the
// private loan-docs bucket, marks the document received, and logs the activity.
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { maybeAdvanceStage, resolvePortalToken, promoteLeadToLoanFile } from "@/lib/los";
import { advanceLeadStage } from "@/lib/leadStage";
import { sendSms, sendEmail, logComms } from "@/lib/comms";
import { cfg } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const BUCKET = "loan-docs";
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED = /\.(pdf|png|jpe?g|heic|webp|doc|docx|xls|xlsx|csv|txt)$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    // Resolve the token to a loan file OR a lead with no file yet. A borrower can
    // upload from a lead-scoped link before any LOS file exists — and the FIRST
    // upload is exactly what OPENS the file (promotes the lead into the LOS). This is
    // how a lead enters the LOS only when it shows real intent, never just for existing.
    const { file: existingFile, lead } = await resolvePortalToken(token);
    let file: any = existingFile;
    if (!file) {
      if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
      file = await promoteLeadToLoanFile(lead);
      if (!file) return NextResponse.json({ error: "Could not open your file — please contact your Fetti specialist." }, { status: 500 });
    }

    const form = await req.formData();
    const upload = form.get("file");
    let docId = form.get("doc_id") ? String(form.get("doc_id")) : null;
    // The lead-preview checklist (before a file exists) sends a synthetic id
    // "needed:<name>"; now that the file exists, map it to the real seeded doc row so
    // the borrower's first upload satisfies the item they intended.
    if (docId && docId.startsWith("needed:")) {
      const wantName = docId.slice("needed:".length);
      const { data: match } = await supabaseAdmin.from("loan_documents")
        .select("id").eq("loan_file_id", file.id).eq("name", wantName).order("created_at").limit(1).maybeSingle();
      docId = match?.id || null;
    }
    if (!(upload instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
    if (upload.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 25MB)." }, { status: 400 });
    const safeName = upload.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    if (!ALLOWED.test(safeName)) return NextResponse.json({ error: "Unsupported file type." }, { status: 400 });

    const stamp = Date.now();
    const path = `${file.id}/${stamp}-${safeName}`;
    const buf = Buffer.from(await upload.arrayBuffer());
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, {
      contentType: upload.type || "application/octet-stream", upsert: false,
    });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    let doc;
    if (docId) {
      const { data: reqRow } = await supabaseAdmin.from("loan_documents")
        .select("id, name, category, status, storage_path").eq("id", docId).eq("loan_file_id", file.id).maybeSingle();
      const alreadySatisfied = !!reqRow?.storage_path && (reqRow.status === "received" || reqRow.status === "accepted");
      if (reqRow && !alreadySatisfied) {
        // First file for this request (or replacing a rejected/needed one) → fill the request row.
        const { data } = await supabaseAdmin.from("loan_documents").update({
          status: "received", storage_path: path, file_name: safeName, size_bytes: upload.size,
          uploaded_by: "borrower", updated_at: new Date().toISOString(),
        }).eq("id", docId).eq("loan_file_id", file.id).select().single();
        doc = data;
      } else if (reqRow) {
        // Request already satisfied → this is an ADDITIONAL file for the SAME line item
        // (e.g. a 2nd pay stub, another bank-statement month, back of an ID). Each row holds
        // exactly one storage_path, so we keep the extra file as its OWN row — nothing is
        // overwritten. Named after the request so it stays grouped; required:false so it
        // never re-blocks completion. This is how a borrower attaches multiple docs to one request.
        const { data } = await supabaseAdmin.from("loan_documents").insert([{
          loan_file_id: file.id, name: `${reqRow.name} — additional`, category: reqRow.category || "Additional",
          required: false, status: "received", storage_path: path, file_name: safeName, size_bytes: upload.size,
          uploaded_by: "borrower", notes: `Additional file for: ${reqRow.name}`,
        }]).select().single();
        doc = data;
      }
    }
    if (!doc) {
      // Generic upload (not tied to a checklist item) = an ADDITIONAL document.
      // Dedupe by file name so the same file uploaded twice REPLACES, never duplicates.
      const { data: dupe } = await supabaseAdmin.from("loan_documents")
        .select("id").eq("loan_file_id", file.id).eq("file_name", safeName)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (dupe?.id) {
        const { data } = await supabaseAdmin.from("loan_documents").update({
          status: "received", storage_path: path, size_bytes: upload.size,
          uploaded_by: "borrower", updated_at: new Date().toISOString(),
        }).eq("id", dupe.id).eq("loan_file_id", file.id).select().single();
        doc = data;
      } else {
        const { data } = await supabaseAdmin.from("loan_documents").insert([{
          loan_file_id: file.id, name: safeName, category: "Additional", required: false,
          status: "received", storage_path: path, file_name: safeName, size_bytes: upload.size, uploaded_by: "borrower",
        }]).select().single();
        doc = data;
      }
    }

    await logActivity({
      entity_type: "document", entity_id: doc?.id, loan_file_id: file.id, lead_id: file.lead_id,
      actor: "borrower", action: "doc.uploaded", detail: { name: doc?.name || safeName, size: upload.size },
    });

    // THE LOS GATE: a real document upload is what makes this a real application.
    // The loan file was just opened (promoteLeadToLoanFile above) and the lead now
    // enters the "Application" stage — the ONLY path into the LOS/applications area.
    // Completing the wizard form alone never gets here. Forward-only, so an already
    // Submitted/Funded loan is never knocked backward.
    if (file.lead_id) {
      try {
        const { autoPromoteIfQuarantined } = await import("@/lib/leadShield");
        await autoPromoteIfQuarantined(file.lead_id, "doc_upload");
      } catch { /* best-effort */ }
      try {
        await advanceLeadStage(file.lead_id, "Application", { actor: "borrower", reason: "uploaded a document" });
        await supabaseAdmin.from("leads").update({ last_nurture_at: new Date().toISOString() }).eq("id", file.lead_id);
      } catch (e) { console.warn("[upload] application promote failed", e); }

      // DOCS-IN = THE HOTTEST SIGNAL IN THE FUNNEL (Ramon, 2026-07-12): uploading
      // personal documents is a costly commitment — behaviorally, this is the
      // moment escalation to a HUMAN conversation converts hardest, and delay
      // bleeds it. Fires ONCE per lead (raw.docs_hot_at): top-priority BOOK-THE-
      // CALL task for the team + a consent-gated personal invite to grab time on
      // the calendar. Runs after the ACK so the borrower's upload stays snappy.
      const leadId = file.lead_id as string;
      after(async () => {
        try {
          const { data: lead } = await supabaseAdmin
            .from("leads").select("id, full_name, first_name, email, phone, loan_purpose, raw").eq("id", leadId).maybeSingle();
          if (!lead) return;
          const raw = (lead as any).raw && typeof (lead as any).raw === "object" ? (lead as any).raw : {};
          if (raw.docs_hot_at) return; // once per lead
          if (/@fetti-internal\.test$/i.test((lead as any).email || "")) return;
          raw.docs_hot_at = new Date().toISOString();
          await supabaseAdmin.from("leads").update({ raw }).eq("id", leadId);

          const name = ((lead as any).first_name || (lead as any).full_name || "there").split(" ")[0];
          const calendly = (await cfg("CALENDLY_URL")) || "";

          // Top-priority task — outranks everything; the play is a same-day call.
          await supabaseAdmin.from("org_tasks").insert([{
            title: `🔥 DOCS IN — book the call with ${(lead as any).full_name || name} TODAY`.slice(0, 200),
            detail: `${(lead as any).full_name || name} just uploaded documents (${(lead as any).loan_purpose || "loan"}) — they've shared personal info, the trust window is OPEN. Call or get them booked now${calendly ? `: ${calendly}` : "."}`,
            source: "docs_hot", status: "open", priority: 10,
            dedup_key: `docshot:${leadId}`.slice(0, 80), cadence: "once", due_at: new Date().toISOString(),
          }]).select("id");

          // Personal invite (know-first, short). SMS only with express consent —
          // the same gate nurture uses; email otherwise.
          const consentObj = raw.consent && typeof raw.consent === "object" ? raw.consent : {};
          const smsOk = !raw.historical_import && raw.sms_consent !== false && !raw.sms_optout_at &&
            (raw.sms_consent === true || consentObj.sms_optin === true);
          const bookLine = calendly ? ` Grab a time that works here: ${calendly}` : " I'll call you shortly to map it out.";
          const msg = `${name}, your documents just landed — you're officially in motion. Next step is a quick call to map your exact path.${bookLine} — Mark at Fetti (Reply STOP to opt out.)`;
          if (smsOk && (lead as any).phone) {
            const r = await sendSms((lead as any).phone, msg);
            if (r.ok) await logComms({ leadId, channel: "sms", direction: "outbound", type: "docs_hot", body: msg, to: (lead as any).phone, status: "sent", providerId: r.sid, actor: "mark" });
          } else if ((lead as any).email) {
            const body = `Hey ${name} — your documents just came through, so you're officially in motion.\n\nThe next step is a quick call to map your exact path and keep this moving.${calendly ? `\n\nGrab a time that works: ${calendly}` : "\n\nWe'll reach out shortly to set it up."}\n\n— Mark at Fetti Financial Services`;
            const r = await sendEmail((lead as any).email, "your documents are in — next step", { text: body });
            if (r.ok) await logComms({ leadId, channel: "email", direction: "outbound", type: "docs_hot", subject: "your documents are in — next step", body, to: (lead as any).email, status: "sent", providerId: r.id, actor: "mark" });
          }
        } catch (e) { console.warn("[upload] docs-hot flow failed", e); }
      });
    }

    await maybeAdvanceStage(file.id);
    return NextResponse.json({ ok: true, document: { id: doc?.id, name: doc?.name, status: "received" } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

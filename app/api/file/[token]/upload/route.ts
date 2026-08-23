// Borrower document upload via their custom link. Multipart: `file` (required)
// and optional `doc_id` to satisfy a specific requested document. Stores to the
// private loan-docs bucket, marks the document received, and logs the activity.
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { maybeAdvanceStage, resolvePortalToken, promoteLeadToLoanFile } from "@/lib/los";
import { isHeic, heicToJpeg, heicNameToJpg } from "@/lib/heic";
import { advanceLeadStage } from "@/lib/leadStage";
import { unpooled } from "@/lib/storageBytes";

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

    // A JSON body means the browser already PUT the file straight to storage on a signed
    // URL (see ./upload-url) because it exceeds Vercel's ~4.5MB request-body ceiling. Only
    // the INTAKE differs — every doc-row rule below (needed: mapping, re-upload handling,
    // versioning) is shared, so the two paths can never drift apart.
    const isDirect = (req.headers.get("content-type") || "").includes("application/json");
    let form: FormData | null = null;
    let upload: any = null;
    let docId: string | null = null;
    let directPath: string | null = null, directName = "", directSize = 0;
    if (isDirect) {
      const b = await req.json().catch(() => ({} as any));
      directPath = String(b?.storage_path || "");
      if (!directPath.startsWith(`${file.id}/`)) return NextResponse.json({ error: "bad storage path" }, { status: 400 });
      const { data: obj } = await supabaseAdmin.storage.from(BUCKET).list(file.id, { search: directPath.split("/").slice(1).join("/") });
      if (!obj?.length) return NextResponse.json({ error: "upload did not complete — please try again" }, { status: 400 });
      directName = String(b?.file_name || directPath.split("/").pop() || "document").slice(0, 120);
      // STORAGE IS THE AUTHORITY ON SIZE, NOT THE BROWSER.
      // This read `Number(b?.size_bytes) || obj[0]?.metadata?.size` — the client's claim first,
      // the object's real metadata only as a fallback — while `obj` was already fetched two lines
      // above. On 2026-08-06 one document was recorded as 86,596 bytes against a 87,448-byte
      // object, which is enough to make any size-based comparison permanently unsatisfiable.
      // The bytes in the bucket are the fact; what the browser said it was about to send is not.
      directSize = Number(obj[0]?.metadata?.size) || Number(b?.size_bytes) || 0;
      // Phone photos are HEIC and usually large enough to take this signed-URL path, so this
      // is where most borrower captures actually arrive. Convert in place so the LO can see it.
      if (isHeic(directName, null)) {
        const { data: dl } = await supabaseAdmin.storage.from(BUCKET).download(directPath);
        if (dl) {
          const c = await heicToJpeg(Buffer.from(await dl.arrayBuffer()));
          if (c.ok) {
            const jpgPath = directPath.replace(/\.(heic|heif)$/i, "") + ".jpg";
            const { error: e2 } = await supabaseAdmin.storage.from(BUCKET)
              .upload(jpgPath, unpooled(c.jpeg), { contentType: "image/jpeg", upsert: true });
            if (!e2) { directPath = jpgPath; directName = heicNameToJpg(directName); directSize = c.jpeg.length; }
          } else console.warn(`[portal-upload] HEIC convert failed for ${directName}: ${c.reason}`);
        }
      }
      docId = b?.doc_id ? String(b.doc_id) : null;
    } else {
      form = await req.formData();
      upload = form.get("file");
      docId = form.get("doc_id") ? String(form.get("doc_id")) : null;
    }
    // The lead-preview checklist (before a file exists) sends a synthetic id
    // "needed:<name>"; now that the file exists, map it to the real seeded doc row so
    // the borrower's first upload satisfies the item they intended.
    if (docId && docId.startsWith("needed:")) {
      const wantName = docId.slice("needed:".length);
      const { data: match } = await supabaseAdmin.from("loan_documents")
        .select("id").eq("loan_file_id", file.id).eq("name", wantName).order("created_at").limit(1).maybeSingle();
      docId = match?.id || null;
    }
    if (!isDirect) {
      if (!(upload instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
      if (upload.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 25MB)." }, { status: 400 });
    }
    const safeName = isDirect ? directName : upload.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    if (!ALLOWED.test(safeName)) return NextResponse.json({ error: "Unsupported file type." }, { status: 400 });
    const stamp = Date.now();
    // Read the bytes BEFORE deciding the stored name: a HEIC becomes a JPEG, which changes
    // the filename, the MIME type and the size that go on the document row.
    const buf: Buffer | null = isDirect ? null : Buffer.from(await upload.arrayBuffer());
    let storeName = safeName;
    let heicOriginal: Buffer | null = null;
    let convertedBuf: Buffer | null = null;
    if (!isDirect && buf && isHeic(safeName, buf)) {
      const c = await heicToJpeg(buf);
      if (c.ok) { heicOriginal = buf; convertedBuf = c.jpeg; storeName = heicNameToJpg(safeName); }
      else console.warn(`[portal-upload] HEIC convert failed for ${safeName}: ${c.reason} — storing the original`);
    }
    const uploadSize = isDirect ? directSize : (convertedBuf?.length ?? upload.size);
    const path = isDirect ? directPath! : `${file.id}/${stamp}-${storeName}`;
    // SECURITY: never persist the client-supplied MIME type — derive it from the
    // validated extension so a spoofed text/html type can't later be served inline.
    const _ext = storeName.toLowerCase().split(".").pop() || "";
    const _CT: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", heif: "image/heic", tif: "image/tiff", tiff: "image/tiff" };
    if (!isDirect) {
      const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(path, convertedBuf ?? buf!, {
        contentType: convertedBuf ? "image/jpeg" : (_CT[_ext] || "application/octet-stream"), upsert: false,
      });
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
      if (heicOriginal) {
        await supabaseAdmin.storage.from(BUCKET).upload(`${path}.original.heic`, heicOriginal, {
          contentType: "image/heic", upsert: false,
        }).catch(() => {});
      }
    }

    let doc;
    if (docId) {
      const { data: reqRow } = await supabaseAdmin.from("loan_documents")
        .select("id, name, category, status, storage_path").eq("id", docId).eq("loan_file_id", file.id).maybeSingle();
      const alreadySatisfied = !!reqRow?.storage_path && (reqRow.status === "received" || reqRow.status === "accepted");
      if (reqRow && !alreadySatisfied) {
        // First file for this request (or replacing a rejected/needed one) → fill the request row.
        const { data } = await supabaseAdmin.from("loan_documents").update({
          status: "received", storage_path: path, file_name: storeName, size_bytes: uploadSize,
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
          required: false, status: "received", storage_path: path, file_name: storeName, size_bytes: uploadSize,
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
          status: "received", storage_path: path, size_bytes: uploadSize,
          uploaded_by: "borrower", updated_at: new Date().toISOString(),
        }).eq("id", dupe.id).eq("loan_file_id", file.id).select().single();
        doc = data;
      } else {
        const { data } = await supabaseAdmin.from("loan_documents").insert([{
          loan_file_id: file.id, name: safeName, category: "Additional", required: false,
          status: "received", storage_path: path, file_name: storeName, size_bytes: uploadSize, uploaded_by: "borrower",
        }]).select().single();
        doc = data;
      }
    }

    await logActivity({
      entity_type: "document", entity_id: doc?.id, loan_file_id: file.id, lead_id: file.lead_id,
      actor: "borrower", action: "doc.uploaded", detail: { name: doc?.name || storeName, size: uploadSize },
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

          // Top-priority task — outranks everything; the play is a same-day human call.
          await supabaseAdmin.from("org_tasks").insert([{
            title: `🔥 DOCS IN — connect with ${(lead as any).full_name || name} TODAY`.slice(0, 200),
            detail: `${(lead as any).full_name || name} just uploaded documents (${(lead as any).loan_purpose || "loan"}) — they've shared personal info, the trust window is OPEN. They were offered video/phone/talk-now; reach out and lock a real conversation.`,
            source: "docs_hot", status: "open", priority: 10,
            dedup_key: `docshot:${leadId}`.slice(0, 80), cadence: "once", due_at: new Date().toISOString(),
          }]).select("id");

          // WHITE-GLOVE CONNECT: offer all three ways to reach a real person (video /
          // phone / talk now) via the connect page — de-duped inside offerConnection
          // (won't double-message if the app-completion offer just went out).
          const { offerConnection } = await import("@/lib/connect");
          await offerConnection({ id: leadId }, { trigger: "docs" });
        } catch (e) { console.warn("[upload] docs-hot flow failed", e); }
      });
    }

    await maybeAdvanceStage(file.id);
    return NextResponse.json({ ok: true, document: { id: doc?.id, name: doc?.name, status: "received" } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

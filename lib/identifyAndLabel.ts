// IDENTIFY ONE STORED DOCUMENT AND WRITE THE RESULT BACK — ONE COPY, THREE CALLERS.
//
// The staff "Identify" action, the staff "Identify all" sweep and the borrower's own upload all
// need exactly this: fetch the bytes, work out what the document is, rename it if (and only if)
// its current name is a machine artefact, and record the verdict. Written once because the last
// time two builders each held their own copy of a rule (lib/docNaming.ts) the scanner and the
// mirror drifted apart and produced two files for one document.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { cfg } from "@/lib/settings";
import { identifyDocument, checkAgainstSlot, mayRelabel, type Identification, type SlotVerdict } from "@/lib/docIdentify";

const BUCKET = "loan-docs";
const MAX_IDENTIFY_BYTES = 24 * 1024 * 1024;   // roughly the vision API's own ceiling
export const AUTO_TAG = "[auto-id]";

export function mediaTypeOf(name: string): string {
  const ext = (name || "").toLowerCase().split(".").pop() || "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "";
}

/** Keep whatever a human wrote in notes; replace only our own tagged line. */
export function mergeNotes(existing: string | null | undefined, line: string): string {
  const kept = String(existing || "").split("\n").filter((l) => !l.trim().startsWith(AUTO_TAG));
  return [...kept, `${AUTO_TAG} ${line}`].join("\n").trim().slice(0, 2000);
}

export function summarise(ident: Identification, uploadedAs: string): string {
  if (ident.kind === "unknown") {
    return `not identified — ${ident.reason || "no verdict"}${ident.legible ? "" : " (image not legible)"}; filed as "${uploadedAs}".`;
  }
  const ev = ident.evidence.length ? ` Evidence: ${ident.evidence.slice(0, 3).join("; ")}.` : "";
  const multi = ident.details.containsMultiple?.length
    ? ` NOTE — this file contains several documents: ${ident.details.containsMultiple.join(", ")}.` : "";
  return `${ident.label} (${ident.kind}, ${ident.confidence} confidence, by ${ident.method}). Uploaded as "${uploadedAs}".${ev}${multi}`;
}

export type ApplyResult =
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string }
  | {
      ok: true; skipped?: false;
      identification: Identification;
      slot: SlotVerdict;
      renamed: string | null;
      renameBlocked: string | null;
      document: any;
    };

/**
 * Read the document behind `docId` and label it.
 *
 * WHAT IT WILL AND WILL NOT CHANGE:
 *  • Renames ONLY a machine name — a raw filename, a scanner string, a portal download name.
 *  • NEVER renames a checklist requirement. Those names are what the borrower and the lender are
 *    being asked for; rewriting "W-2s — last 2 years" to "Driver's license" deletes the
 *    requirement. A contradiction is recorded as a MISMATCH instead, which is the more valuable
 *    output — that exact case was live on Joseph Hixon's file when this was written.
 *  • Never touches `status`. Whether a document satisfies its condition is the LO's call.
 */
export async function applyIdentification(
  loanFileId: string,
  docId: string,
  opts: { apply?: boolean; actor?: string; timeoutMs?: number } = {},
): Promise<ApplyResult> {
  const apply = opts.apply !== false;
  const { data: doc, error: dErr } = await supabaseAdmin
    .from("loan_documents")
    .select("id, loan_file_id, name, category, file_name, storage_path, notes, status")
    .eq("id", docId).eq("loan_file_id", loanFileId).maybeSingle();
  // A select against a missing column returns null WITH an error rather than throwing — read it.
  if (dErr) return { ok: false, error: dErr.message };
  if (!doc) return { ok: false, error: "document not found on this file" };
  if (!doc.storage_path) return { ok: false, error: "nothing uploaded for this item yet" };

  const mediaType = mediaTypeOf(doc.file_name || doc.storage_path);
  if (!mediaType) return { ok: true, skipped: true, reason: `identification supports PDF and images; "${doc.file_name}" is neither.` };

  const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(BUCKET).download(doc.storage_path);
  if (dlErr || !blob) return { ok: false, error: dlErr?.message || "could not read the stored file" };
  const buf = Buffer.from(await blob.arrayBuffer());
  if (buf.length > MAX_IDENTIFY_BYTES) {
    return { ok: true, skipped: true, reason: `file is ${(buf.length / 1048576).toFixed(1)}MB — too large to read; shrink it first.` };
  }

  const apiKey = ((await cfg("ANTHROPIC_API_KEY")) || "").trim();
  const ident = await identifyDocument({ buf, fileName: doc.file_name || "", mediaType, apiKey, timeoutMs: opts.timeoutMs ?? 90000 });

  const uploadedAs = doc.name || doc.file_name || "(unnamed)";
  const slot = checkAgainstSlot(doc.name || "", ident);
  const relabel = mayRelabel(doc.name || "", doc.file_name);

  let line = summarise(ident, uploadedAs);
  if (slot.verdict === "mismatch") line = `⚠ MISMATCH — ${slot.message} ${line}`;

  const patch: Record<string, any> = { notes: mergeNotes(doc.notes, line), updated_at: new Date().toISOString() };
  let renamedTo: string | null = null;
  // Rename only a machine name, only on a real identification, and never on a low-confidence
  // one — a confident-looking wrong label is worse than the filename it replaced, because the
  // filename is visibly untrustworthy and a label is not.
  if (apply && relabel && ident.kind !== "unknown" && ident.confidence !== "low" && ident.label) {
    patch.name = ident.label.slice(0, 160);
    if (ident.category) patch.category = ident.category;
    renamedTo = patch.name;
  }

  let updated: any = doc;
  if (apply) {
    const { data, error } = await supabaseAdmin.from("loan_documents").update(patch)
      .eq("id", docId).eq("loan_file_id", loanFileId).select().single();
    if (error) return { ok: false, error: error.message };
    updated = data;
    await logActivity({
      entity_type: "document", entity_id: docId, loan_file_id: loanFileId,
      actor: opts.actor || "system", action: "doc.identified",
      detail: {
        kind: ident.kind, confidence: ident.confidence, method: ident.method,
        uploaded_as: uploadedAs, renamed_to: renamedTo, slot: slot.verdict,
      },
    });
  }

  return {
    ok: true, identification: ident, slot, renamed: renamedTo,
    renameBlocked: !relabel && ident.kind !== "unknown"
      ? "the current name is a checklist requirement or was typed by a person — left as is" : null,
    document: updated,
  };
}

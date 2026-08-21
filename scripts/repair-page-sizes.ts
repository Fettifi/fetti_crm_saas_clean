// ONE-TIME REPAIR: put documents with non-paper page sizes back onto real paper.
//
// Built by passing image PIXELS to addPage() as POINTS, these carry pages of 24-57 INCHES.
// They render fine and fail everywhere physical: portals refuse them, printing is wrong.
// Fixed at the source in lib/imageToPdf.ts + combine-docs; this repairs what already exists.
//
// Non-destructive and in the same order the to-pdf route uses: upload the new object, repoint
// the row, and only THEN rename the source to `.original.pdf`. Until the row update lands the
// document still points at the untouched original.
//
//   npx tsx scripts/repair-page-sizes.ts            # dry run
//   npx tsx scripts/repair-page-sizes.ts --apply
import "./_env";
import { requireLiveDb, rows } from "./_liveDb";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { normalizePageSizes, pageIsOversized } from "../lib/pdfPageSize";
import { PDFDocument } from "pdf-lib";

const APPLY = process.argv.includes("--apply");
const BUCKET = "loan-docs";

(async () => {
  await requireLiveDb("repair-page-sizes");
  const ds = await rows<any>("repair", supabaseAdmin.from("loan_documents")
    .select("id,loan_file_id,name,file_name,storage_path,size_bytes").not("storage_path","is",null), { minRows: 1 });
  const files = await rows<any>("repair", supabaseAdmin.from("loan_files").select("id,borrower_name"));
  const who = new Map(files.map(f => [f.id, f.borrower_name || "?"]));
  const pdfs = ds.filter(d => /\.pdf$/i.test(d.file_name || ""));

  let fixed = 0, skipped = 0, failed = 0;
  for (const d of pdfs) {
    const { data } = await supabaseAdmin.storage.from(BUCKET).download(d.storage_path);
    if (!data) { failed++; continue; }
    const buf = Buffer.from(await data.arrayBuffer());
    let over = false;
    try {
      const pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
      over = pdf.getPages().some(p => pageIsOversized(p.getWidth(), p.getHeight()));
    } catch { continue; }
    if (!over) { skipped++; continue; }

    const r = await normalizePageSizes(buf);
    if (!r.changed) { skipped++; continue; }
    // Never file something that is not a valid PDF, and never lose a page.
    const check = await PDFDocument.load(r.pdf);
    if (check.getPageCount() !== r.pages) { console.log(`  PAGE LOSS on ${d.file_name} — skipped`); failed++; continue; }

    console.log(`  ${r.from} -> ${r.to}  ${String(r.pages).padStart(2)}pp  ${(buf.length/1048576).toFixed(2)} -> ${(r.pdf.length/1048576).toFixed(2)} MB  ${who.get(d.loan_file_id)} · ${d.file_name}`);
    if (!APPLY) { fixed++; continue; }

    const base = (d.file_name || "document").replace(/\.[^.]+$/, "");
    const newPath = `${d.loan_file_id}/${Date.now()}-${base.replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(newPath, r.pdf, { contentType: "application/pdf", upsert: false });
    if (upErr) { console.log(`    upload failed: ${upErr.message}`); failed++; continue; }
    const { error: rowErr } = await supabaseAdmin.from("loan_documents")
      .update({ storage_path: newPath, size_bytes: r.pdf.length, updated_at: new Date().toISOString() }).eq("id", d.id);
    if (rowErr) { await supabaseAdmin.storage.from(BUCKET).remove([newPath]); console.log(`    row failed: ${rowErr.message}`); failed++; continue; }
    const { error: mvErr } = await supabaseAdmin.storage.from(BUCKET).move(d.storage_path, `${d.storage_path}.original.pdf`);
    if (mvErr) console.log(`    (original left at ${d.storage_path}: ${mvErr.message})`);
    fixed++;
  }
  console.log(`\n${APPLY ? "REPAIRED" : "would repair"} ${fixed} · already paper ${skipped} · failed ${failed}`);
  if (!APPLY) console.log("Re-run with --apply.");
})();

// STEP 2 OF THE GUEST PHOTO UPLOAD: the browser has already PUT the bytes to the signed URL,
// this records who sent them.
//
// The bytes are safe before this route runs, which is the design (see lib/eventPhotos.ts):
// if this call fails, the picture is still in the bucket and still shows up in the gallery —
// only the guest's name and note are lost. That ordering is deliberate. The other way round,
// a flaky hotel wifi at the reception loses photographs.
//
// STORAGE IS THE AUTHORITY ON SIZE, NOT THE BROWSER — the object's own metadata decides, the
// client's claim is only a fallback. A loan document was once recorded 852 bytes short of the
// object it described because the claim was trusted first.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { isHeic, heicToJpeg, heicNameToJpg } from "@/lib/heic";
import sharp from "sharp";
import { unpooled } from "@/lib/storageBytes";
import {
  PHOTO_BUCKET, PHOTO_PREFIX, addPhoto, hashIp, kindOf, listPhotos, uploadsOpen, budgetState,
  keepOriginals, SHRINK_OVER_BYTES, SHRINK_MAX_EDGE, SHRINK_QUALITY,
} from "@/lib/eventPhotos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Public: just enough for the page to say how many pictures have come in. No names, no links. */
export async function GET() {
  try {
    const list = await listPhotos();
    const gate = await uploadsOpen();
    const budget = await budgetState(list);
    return NextResponse.json({
      ok: true,
      count: list.length,
      open: gate.open && !budget.full,
      closed_reason: !gate.open ? gate.reason
        : budget.full ? "The album is full for now — text Ramon and he'll make room for the rest."
        : null,
    });
  } catch {
    return NextResponse.json({ ok: true, count: 0, open: true, closed_reason: null });
  }
}

export async function POST(req: NextRequest) {
  try {
    const gate = await uploadsOpen();
    if (!gate.open) return NextResponse.json({ error: gate.reason }, { status: 403 });

    const b = await req.json().catch(() => ({} as any));
    let path = String(b?.path || "");
    // The only path this route will ever touch is one the upload-url route minted.
    if (!path.startsWith(`${PHOTO_PREFIX}/`) || path.includes("..")) {
      return NextResponse.json({ error: "bad path" }, { status: 400 });
    }

    // Prove the object is really there. Without this, anyone could stuff the index with
    // rows pointing at nothing, and the gallery would show broken tiles for every one.
    const name = path.slice(PHOTO_PREFIX.length + 1);
    const { data: objs, error: listErr } = await supabaseAdmin.storage
      .from(PHOTO_BUCKET).list(PHOTO_PREFIX, { search: name, limit: 1 });
    if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });
    const obj = (objs || []).find((o: any) => o.name === name);
    if (!obj) return NextResponse.json({ error: "The upload didn't finish — please try again." }, { status: 400 });

    let fileName = String(b?.file_name || name).slice(0, 120);
    let sizeBytes = Number((obj as any)?.metadata?.size) || Number(b?.size_bytes) || 0;
    let contentType = String((obj as any)?.metadata?.mimetype || b?.content_type || "application/octet-stream");
    let kind = kindOf(fileName) || "image";

    // iPhones shoot HEIC, and no browser but Safari can render it — so half the gallery would
    // be unopenable tiles on Ramon's laptop. Convert in place, exactly like the borrower portal.
    if (kind === "image" && isHeic(fileName, null)) {
      const { data: dl } = await supabaseAdmin.storage.from(PHOTO_BUCKET).download(path);
      if (dl) {
        const c = await heicToJpeg(Buffer.from(await dl.arrayBuffer()), 3200, 88);
        if (c.ok) {
          const jpgPath = path.replace(/\.(heic|heif)$/i, "") + ".jpg";
          const { error: upErr } = await supabaseAdmin.storage.from(PHOTO_BUCKET)
            .upload(jpgPath, unpooled(c.jpeg), { contentType: "image/jpeg", upsert: true });
          if (!upErr) {
            await supabaseAdmin.storage.from(PHOTO_BUCKET).remove([path]);
            path = jpgPath; fileName = heicNameToJpg(fileName);
            sizeBytes = c.jpeg.length; contentType = "image/jpeg";
          }
        } else {
          console.warn(`[event-photos] HEIC convert failed for ${fileName}: ${c.reason}`);
        }
      }
    }

    // Downscale the big stills. A modern phone JPEG is 3-5MB and the album shares its quota
    // with the loan documents, so an untouched camera roll would eat the budget in ~60 pictures.
    // 3200px at q88 still prints cleanly at 8x10 and is typically half the size. Set
    // `...:photos:keep_originals` to "1" once storage is upgraded and this stops happening.
    //
    // EVERY EXIT FROM THIS BLOCK NAMES ITSELF. The first version returned a bare 200 whichever
    // way it went — download null, no size gain, upload error, sharp throwing — so a resize
    // that never ran was indistinguishable from one that did, and the first end-to-end run
    // against production recorded a 4.84MB photo as 4.84MB with nothing anywhere saying why.
    // A step that can silently do nothing must report, or the budget it protects is fiction.
    let shrink = "not needed";
    if (kind === "image" && sizeBytes > SHRINK_OVER_BYTES && !(await keepOriginals())) {
      try {
        const { data: dl, error: dlErr } = await supabaseAdmin.storage.from(PHOTO_BUCKET).download(path);
        if (!dl) {
          shrink = `skipped: could not read it back (${dlErr?.message || "no data"})`;
        } else {
          const orig = Buffer.from(await dl.arrayBuffer());
          const small = await sharp(orig)
            .rotate() // honour EXIF orientation before the metadata is dropped
            .resize({ width: SHRINK_MAX_EDGE, height: SHRINK_MAX_EDGE, fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: SHRINK_QUALITY, mozjpeg: true })
            .toBuffer();
          // Only keep the new one if it is actually smaller — re-encoding can grow a file.
          if (small.length >= orig.length) {
            shrink = `skipped: no gain (${orig.length} -> ${small.length})`;
          } else {
            const jpgPath = path.replace(/\.[a-z0-9]+$/i, "") + ".jpg";
            const { error: upErr } = await supabaseAdmin.storage.from(PHOTO_BUCKET)
              .upload(jpgPath, unpooled(small), { contentType: "image/jpeg", upsert: true });
            if (upErr) {
              shrink = `skipped: could not store the smaller copy (${upErr.message})`;
            } else {
              if (jpgPath !== path) await supabaseAdmin.storage.from(PHOTO_BUCKET).remove([path]);
              path = jpgPath;
              fileName = fileName.replace(/\.[a-z0-9]+$/i, "") + ".jpg";
              shrink = `applied: ${sizeBytes} -> ${small.length}`;
              sizeBytes = small.length; contentType = "image/jpeg";
            }
          }
        }
      } catch (e) {
        // A failed resize must leave the original photograph exactly where it is.
        shrink = `failed: ${e instanceof Error ? e.message : String(e)}`;
      }
      if (!shrink.startsWith("applied")) console.warn(`[event-photos] shrink ${shrink} for ${fileName}`);
    }

    const uploader = String(b?.uploader || "").trim().slice(0, 60) || null;
    const note = String(b?.note || "").trim().slice(0, 280) || null;

    const photo = await addPhoto({
      path, file_name: fileName, content_type: contentType, size_bytes: sizeBytes, kind,
      uploader, note, ip: hashIp(req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip")),
    });

    return NextResponse.json({
      ok: true,
      photo: { id: photo.id, file_name: photo.file_name, kind: photo.kind },
      // What actually happened to the bytes. The guest's page ignores this; the verification
      // asserts on it, which is the only reason a silent no-op can ever be caught.
      processing: { shrink, bytes: photo.size_bytes },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

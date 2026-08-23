// STEP 1 OF THE GUEST PHOTO UPLOAD: hand the browser a signed URL it can PUT straight to.
//
// Public on purpose — a guest at a party has no login and never will. What makes that safe
// is that the client chooses NOTHING that matters: the bucket, the prefix and the object
// path are all derived here, the file type is checked against an allow-list, the size is
// capped, the window is time-boxed, and one source can only commit so many per hour.
//
// It has to be direct-to-storage rather than a multipart POST because Vercel caps a request
// body at ~4.5MB. A single iPhone video clears that before it finishes recording, and the
// borrower portal already learned this lesson the expensive way — see
// app/api/file/[token]/upload-url/route.ts.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import {
  PHOTO_BUCKET, PHOTO_PREFIX, MAX_PER_IP_PER_HOUR, MAX_PHOTOS,
  kindOf, maxBytesFor, safeFileName, hashIp, uploadsOpen, listPhotos, recentFromIp, budgetState,
} from "@/lib/eventPhotos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const gate = await uploadsOpen();
    if (!gate.open) return NextResponse.json({ error: gate.reason }, { status: 403 });

    const b = await req.json().catch(() => ({} as any));
    const fileName = safeFileName(String(b?.file_name || ""));
    if (!fileName) return NextResponse.json({ error: "No file name." }, { status: 400 });

    const kind = kindOf(fileName);
    if (!kind) {
      return NextResponse.json({ error: `We can't take "${fileName}" — photos and videos only.` }, { status: 400 });
    }
    const size = Number(b?.size_bytes) || 0;
    const cap = maxBytesFor(kind);
    if (size > cap) {
      return NextResponse.json(
        { error: `That ${kind === "video" ? "video" : "photo"} is ${(size / 1048576).toFixed(0)}MB — the limit is ${cap / 1048576}MB.` },
        { status: 400 },
      );
    }

    // Flood guard. Counts what this source has actually COMMITTED in the last hour, so a
    // family sharing one hotel wifi still gets 150 pictures through before it bites.
    const ip = hashIp(req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"));
    const list = await listPhotos();
    if (list.length >= MAX_PHOTOS) {
      return NextResponse.json({ error: "This gallery is full — please text Ramon." }, { status: 429 });
    }
    // The album shares one storage quota with the borrower loan documents. It stops at its own
    // budget so a party can never be the reason a bank statement fails to upload.
    const budget = await budgetState(list);
    if (budget.full) {
      return NextResponse.json(
        { error: "The album is full for now — text Ramon and he'll make room for the rest." },
        { status: 507 },
      );
    }
    if (recentFromIp(list, ip) >= MAX_PER_IP_PER_HOUR) {
      return NextResponse.json({ error: "That's a lot of photos at once — give it an hour and send the rest." }, { status: 429 });
    }

    // Server-derived path. A guest cannot name it, overwrite someone else's, or escape the prefix.
    // Digits only, and deliberately NOT via a character class of dash-colon-T: Tailwind scans
    // .ts files for class candidates, reads any bracketed token containing a colon as an
    // arbitrary CSS property, and emitted an invalid rule into globals.css that failed the
    // entire production build. A regex in a route file can break the stylesheet — so the
    // literal is avoided here too, comments included, because the scanner reads those as well.
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const path = `${PHOTO_PREFIX}/${stamp}-${Math.random().toString(36).slice(2, 8)}-${fileName}`;

    const { data, error } = await supabaseAdmin.storage.from(PHOTO_BUCKET).createSignedUploadUrl(path);
    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: error?.message || "Couldn't start the upload." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, path, url: data.signedUrl, token: data.token, file_name: fileName, kind });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

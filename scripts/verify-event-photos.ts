// THE GUEST PHOTO PIPELINE, PROVED END TO END AGAINST A REAL DEPLOYMENT.
//
//   npx tsx scripts/verify-event-photos.ts                      (production)
//   PHOTOS_BASE=http://localhost:3000 npx tsx scripts/verify-event-photos.ts
//
// This does not check that the code exists. It drives the actual endpoints a guest's phone
// will hit, pushes real bytes through them, and then ATTACKS them — because the house failure
// is a mechanism that is present and does nothing. Every guard here is made to FAIL on purpose
// (wrong file type, oversized video, forged path, an object that was never uploaded, an
// unauthenticated read of the album) and the run fails if any of them quietly says yes.
//
// It finishes by DELETING everything it made and proving it is gone from both the bucket and
// the index — a verification that leaves test rows in a real album is not a clean run.
import "./_env";
import { requireLiveDb } from "./_liveDb";
import sharp from "sharp";
import { request as httpsRequest } from "node:https";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { PHOTO_BUCKET, PHOTO_PREFIX, listPhotos, removePhoto } from "../lib/eventPhotos";

const BASE = (process.env.PHOTOS_BASE || "https://fettifi.com").replace(/\/$/, "");
const APP_BASE = process.env.PHOTOS_APP_BASE || "https://app.fettifi.com";

let bad = 0;
const ok = (c: boolean, m: string, detail = "") => {
  console.log(`  ${c ? "ok  " : "FAIL"}  ${m}${detail ? ` — ${detail}` : ""}`);
  if (!c) bad++;
};

// The upload uses node:https, NOT fetch. undici gives up 300 seconds after the request
// starts if no response headers have arrived, and on this machine the path to Supabase storage
// measures ~16 KB/s (64KB in 4.4s, 512KB in 32s, both verified with curl) — so a legitimate
// 5MB photo takes minutes and undici kills it mid-flight. That timeout is a property of this
// office link, not of the endpoint: the same PUT from a phone finishes in seconds. A verify
// script that fails on the tester's own uplink teaches nothing about the product.
function putBytes(url: string, body: Buffer, contentType: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpsRequest(
      { method: "PUT", hostname: u.hostname, path: u.pathname + u.search,
        headers: { "Content-Type": contentType, "Content-Length": body.length } },
      (res) => { res.resume(); res.on("end", () => resolve(res.statusCode || 0)); },
    );
    req.setTimeout(20 * 60_000, () => req.destroy(new Error("upload timed out after 20 minutes")));
    req.on("error", reject);
    req.end(body);
  });
}

async function postJson(path: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({} as any));
  return { status: r.status, j };
}

async function main() {
  await requireLiveDb("verify:event-photos");
  console.log(`\nGUEST PHOTOS — end to end against ${BASE}\n`);

  // ---------------------------------------------------------------- the page a guest lands on
  const pageRes = await fetch(`${BASE}/photos`);
  const pageHtml = await pageRes.text();
  ok(pageRes.status === 200, "GET /photos serves the upload page", `HTTP ${pageRes.status}`);
  ok(/Share your photos/i.test(pageHtml), "the page says what it is");
  ok(/noindex/i.test(pageHtml) || /noindex/i.test(pageRes.headers.get("x-robots-tag") || ""),
    "the page is noindex — a private event page must not land in search");

  const status = await fetch(`${BASE}/api/photos`).then((r) => r.json()).catch(() => ({} as any));
  ok(status?.open === true, "uploads are open", `open=${status?.open} ${status?.closed_reason || ""}`);

  // ------------------------------------------------------------------------- the guards, attacked
  const exe = await postJson("/api/photos/upload-url", { file_name: "payload.exe", size_bytes: 1024 });
  ok(exe.status === 400, "REFUSES a non-media file type", `HTTP ${exe.status}`);

  const huge = await postJson("/api/photos/upload-url", { file_name: "long.mp4", size_bytes: 80 * 1024 * 1024 });
  ok(huge.status === 400, "REFUSES a video past the storage ceiling", `HTTP ${huge.status}`);

  const escape = await postJson("/api/photos", { path: "loan-docs/../secret.pdf", file_name: "x.jpg" });
  ok(escape.status === 400, "REFUSES a path outside the event prefix", `HTTP ${escape.status}`);

  const ghost = await postJson("/api/photos", { path: `${PHOTO_PREFIX}/never-uploaded-${Date.now()}.jpg`, file_name: "g.jpg" });
  ok(ghost.status === 400, "REFUSES to index an object that was never uploaded", `HTTP ${ghost.status}`);

  // ------------------------------------------------------------- a real photograph, start to finish
  // A stand-in for what a guest's phone actually sends: 4032x3024, the iPhone's own 12MP
  // frame, carrying enough noise to clear the 4MB threshold.
  //
  // The first version of this check used a 2600px frame and FAILED — 4.8MB in, 4.78MB out —
  // and the failure was the test's, not the code's: the resize targets a 3200px long edge and
  // 2600 is already under it, so the route re-encoded a file it had no reason to shrink. A
  // test image smaller than the thing being tested proves nothing. At real phone dimensions
  // the same path takes 4.84MB to 2.23MB (measured locally against the identical sharp
  // pipeline), which is the behaviour the storage budget depends on.
  let original = Buffer.alloc(0);
  for (const quality of [85, 92]) {
    original = await sharp({
      create: {
        width: 4032, height: 3024, channels: 3 as const,
        background: { r: 120, g: 130, b: 110 },
        noise: { type: "gaussian" as const, mean: 128, sigma: 25 },
      },
    }).jpeg({ quality }).toBuffer();
    if (original.length > 4.2 * 1024 * 1024) break;
  }
  // If this ever failed, every downscale check below would be measuring a file that was never
  // eligible for downscaling — and would pass for the wrong reason.
  ok(original.length > 4 * 1024 * 1024, "test photo is over the shrink threshold",
    `${(original.length / 1048576).toFixed(1)}MB at 4032x3024`);

  const testName = `zz-verify-probe-${Date.now()}.jpg`;
  const signed = await postJson("/api/photos/upload-url", {
    file_name: testName, size_bytes: original.length,
  });
  ok(signed.status === 200 && !!signed.j?.url, "hands back a signed upload URL", `HTTP ${signed.status}`);
  if (!signed.j?.url) { console.error("\ncannot continue without an upload URL"); process.exit(1); }

  const t0 = Date.now();
  const putStatus = await putBytes(signed.j.url, original, "image/jpeg");
  ok(putStatus >= 200 && putStatus < 300, "the browser can PUT the bytes straight to storage",
    `HTTP ${putStatus} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const commit = await postJson("/api/photos", {
    path: signed.j.path, file_name: signed.j.file_name, size_bytes: original.length,
    content_type: "image/jpeg", uploader: "VERIFY PROBE", note: "automated check — deleted at the end",
  });
  ok(commit.status === 200, "the photo is recorded", `HTTP ${commit.status} ${commit.j?.error || ""}`);
  // The route now says what it did to the bytes, so a resize that quietly did nothing shows up
  // as a reason instead of as an unexplained number.
  ok(String(commit.j?.processing?.shrink || "").startsWith("applied"),
    "the route REPORTS the downscale it performed", String(commit.j?.processing?.shrink || "(no report)"));

  const index = await listPhotos();
  const mine = index.find((p) => p.file_name === testName || p.path.endsWith(testName));
  ok(!!mine, "it appears in the album index");
  ok(!!mine && mine.uploader === "VERIFY PROBE", "the guest's name rode along with it");
  // "smaller" is not the bar — a re-encode shaves a fraction off anything. The album's storage
  // budget is sized on the assumption that a phone photo lands at roughly half what was sent.
  ok(!!mine && mine.size_bytes > 0 && mine.size_bytes < original.length * 0.75,
    "the oversized photo was DOWNSCALED on arrival, not merely re-encoded",
    mine ? `${(original.length / 1048576).toFixed(2)}MB → ${(mine.size_bytes / 1048576).toFixed(2)}MB` +
      ` (${Math.round((1 - mine.size_bytes / original.length) * 100)}% smaller)` : "");

  // The bucket is private. Prove it by trying to read the object the way a stranger would.
  const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${mine?.path || signed.j.path}`;
  const pub = await fetch(publicUrl);
  ok(pub.status !== 200, "the photograph is NOT readable without a signed link", `HTTP ${pub.status}`);

  const { data: bucketRow } = await supabaseAdmin.storage.listBuckets();
  const bucket = (bucketRow || []).find((b: any) => b.name === PHOTO_BUCKET);
  ok(!!bucket && (bucket as any).public === false, "the bucket itself is private");

  // ------------------------------------------------------------------ the album needs a login
  const album = await fetch(`${APP_BASE}/api/rsvp/photos`, { redirect: "manual" });
  ok(album.status === 401, "the album API refuses an unauthenticated read", `HTTP ${album.status}`);
  const albumPage = await fetch(`${APP_BASE}/rsvp/photos`, { redirect: "manual" });
  ok([301, 302, 307, 308].includes(albumPage.status), "the album page sends a stranger to /login", `HTTP ${albumPage.status}`);

  // ------------------------------------------------------------------------------- clean up
  const removed = await removePhoto(mine?.path || signed.j.path);
  ok(!!removed, "the probe was found and removed from the index");
  const after = await listPhotos();
  ok(!after.some((p) => p.file_name === testName), "the probe is gone from the index");
  const { data: left } = await supabaseAdmin.storage.from(PHOTO_BUCKET).list(PHOTO_PREFIX, { search: testName });
  ok((left || []).length === 0, "the probe's bytes are gone from the bucket");

  console.log(bad === 0
    ? `\nALL CHECKS PASSED — a guest can send a photo, and nobody else can read it.\n`
    : `\n${bad} CHECK(S) FAILED.\n`);
  process.exit(bad === 0 ? 0 : 1);
}

main();

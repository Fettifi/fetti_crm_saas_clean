// CREATE THE PRIVATE BUCKET THE GUEST PHOTOS LAND IN. Idempotent — safe to re-run.
//
//   npx tsx scripts/setup-event-photos.ts
//
// PRIVATE, and it must stay that way: a public bucket means every photograph from the day is
// one guessable URL away from anyone. The gallery reads through short-lived signed URLs
// instead (app/api/rsvp/photos), which is the same posture as loan-docs.
import "./_env";
import { requireLiveDb } from "./_liveDb";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { PHOTO_BUCKET, MAX_VIDEO_BYTES } from "../lib/eventPhotos";

async function main() {
  await requireLiveDb("setup:event-photos");

  const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets();
  if (listErr) { console.error("Couldn't list buckets:", listErr.message); process.exit(1); }

  const existing = (buckets || []).find((b: any) => b.name === PHOTO_BUCKET);
  if (existing) {
    console.log(`bucket "${PHOTO_BUCKET}" already exists (public=${(existing as any).public})`);
    if ((existing as any).public) {
      console.error("REFUSING TO LEAVE IT PUBLIC — flipping it back to private.");
      const { error } = await supabaseAdmin.storage.updateBucket(PHOTO_BUCKET, { public: false });
      if (error) { console.error("  couldn't make it private:", error.message); process.exit(1); }
      console.log("  now private.");
    }
    return;
  }

  const { error } = await supabaseAdmin.storage.createBucket(PHOTO_BUCKET, {
    public: false,
    fileSizeLimit: MAX_VIDEO_BYTES,
  });
  if (error) { console.error("createBucket failed:", error.message); process.exit(1); }
  console.log(`created private bucket "${PHOTO_BUCKET}" (limit ${MAX_VIDEO_BYTES / 1048576}MB/file)`);
}

main();

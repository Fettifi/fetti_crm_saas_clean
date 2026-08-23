// GUEST PHOTOS FROM THE VOW RENEWAL — the pictures 150 people take on their phones and
// otherwise never send.
//
// A guest scans a QR on the invitation or on a card at the party, lands on /photos, and
// their camera roll goes straight into a PRIVATE Supabase bucket. No app, no login, no
// account, no "which cloud service do you use". That is the whole point: the moment you
// ask a wedding guest to sign in, the photo never arrives.
//
// TWO RULES THIS FILE EXISTS TO HOLD:
//
// 1. STORAGE IS THE AUTHORITY, THIS INDEX IS A CONVENIENCE. The bytes land in the bucket
//    BEFORE anything is written here (the browser PUTs to a signed URL — Vercel's ~4.5MB
//    request-body ceiling makes a proxied upload useless for a 40MB video). So a commit
//    that fails leaves a real photo in the bucket with no index row. The gallery therefore
//    lists the BUCKET and joins this index for the extras (who sent it, their note) — a
//    dropped index write costs a caption, never a picture.
//
// 2. IT IS ONE JSON BLOB IN app_settings, NOT A TABLE — same reason as the guest list in
//    lib/rsvp.ts: this machine has the Supabase service key but no Postgres URL, so DDL
//    needs Ramon's dashboard. Concurrency is handled properly anyway, via casSetting():
//    read, modify, write only if updated_at is unchanged, retry on a lost race. At a party
//    thirty people upload in the same minute; last-writer-wins would silently eat captions.
import { getSettingRow, casSetting, getSetting } from "./settings";
import { supabaseAdmin } from "./supabaseAdminClient";
import { EVENT_KEY as RSVP_KEY } from "./rsvp";

/** Private bucket. Never make this public — see the gallery route for signed reads. */
export const PHOTO_BUCKET = "event-photos";
/** Every object lives under this prefix, so the bucket can host another event later. */
export const PHOTO_PREFIX = "vow-renewal-2026";

export const PHOTOS_KEY = `${RSVP_KEY}:photos`;
/** Kill switch: set to "1" to stop accepting uploads before the window closes. */
export const PHOTOS_CLOSED_KEY = `${RSVP_KEY}:photos:closed`;
/** Storage budget for this album, in MB. See BUDGET_MB_DEFAULT for why it exists. */
export const PHOTOS_BUDGET_KEY = `${RSVP_KEY}:photos:budget_mb`;
/** Set to "1" to stop downscaling big photos once storage is no longer tight. */
export const PHOTOS_KEEP_ORIGINALS_KEY = `${RSVP_KEY}:photos:keep_originals`;

// The day itself, as an instant rather than the printed sentence in lib/rsvp. The QR is on an
// invitation that lands in a mailbox WEEKS before the party, so the page has to know whether
// it is being scanned in advance or on the night — "send us what you saw" is the wrong
// sentence to show someone holding an invitation to an event that has not happened.
export const EVENT_INSTANT = Date.parse("2026-09-19T16:00:00-07:00");
export const eventHasHappened = () => Date.now() > EVENT_INSTANT;

// The upload window. Open now so the invitation QR works the day it lands in a mailbox,
// and it shuts by itself six weeks after the party — an upload endpoint that stays open to
// the whole internet forever is a bucket somebody else eventually fills.
export const UPLOADS_OPEN_UNTIL = "2026-10-31T23:59:59-07:00";

// Caps. The blob is rewritten on every add, so it cannot grow without limit.
export const MAX_PHOTOS = 2500;
export const MAX_PER_IP_PER_HOUR = 150;
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024;  // 40MB — a 48MP ProRAW still fits
// 50MB is not a preference, it is the Supabase project's hard ceiling (measured 2026-08-23:
// a bucket asking for 100MB is rejected outright with "The object exceeded the maximum
// allowed size"). Promising more here would let a guest watch a 90MB video upload and fail.
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

// THE GUEST ALBUM MUST NOT BE ABLE TO STARVE THE LOAN FILES.
//
// Storage is ONE quota shared with loan-docs, which held 610MB of borrower documents on
// 2026-08-23 out of ~0.76GB used project-wide. If a wedding filled the remaining room, the
// next borrower to upload a bank statement would fail — a party would have broken the part
// of this system that earns money. So the album gets an explicit budget and closes itself
// when it reaches it, instead of quietly consuming whatever is left.
//
// Raise it the moment storage is upgraded — it is one setting, no deploy:
//   UPDATE app_settings SET value = '4000' WHERE key = 'rsvp:vow-renewal-2026:photos:budget_mb';
export const BUDGET_MB_DEFAULT = 200;

/** Images bigger than this are downscaled on arrival (unless keep_originals is set). */
export const SHRINK_OVER_BYTES = 4 * 1024 * 1024;
export const SHRINK_MAX_EDGE = 3200;   // still prints cleanly at 8x10
export const SHRINK_QUALITY = 88;

const IMAGE_EXT = /\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?|dng)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|3gp)$/i;

export type PhotoKind = "image" | "video";

export type EventPhoto = {
  id: string;
  path: string;            // object path inside PHOTO_BUCKET
  file_name: string;
  content_type: string;
  size_bytes: number;
  kind: PhotoKind;
  uploader: string | null; // the guest's name, if they typed one — never required
  note: string | null;
  created_at: string;
  ip: string | null;       // HASHED, and only so one source can't flood the bucket
};

export function kindOf(fileName: string): PhotoKind | null {
  if (IMAGE_EXT.test(fileName)) return "image";
  if (VIDEO_EXT.test(fileName)) return "video";
  return null;
}

export function maxBytesFor(kind: PhotoKind): number {
  return kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

/** Filenames are guest-supplied and go into a storage path — strip everything else. */
export function safeFileName(raw: string): string {
  return String(raw || "").replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_{3,}/g, "__").slice(-120);
}

/** Non-reversible, salted with the service key so the stored value isn't a rainbow-table IP. */
export function hashIp(ip: string | null | undefined): string | null {
  const raw = String(ip || "").split(",")[0].trim();
  if (!raw) return null;
  // Node-only (these routes are runtime "nodejs"); require keeps this file importable from
  // anywhere without pulling crypto into a client bundle.
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256")
    .update(raw + "|" + (process.env.SUPABASE_SERVICE_ROLE_KEY || "fetti"))
    .digest("hex")
    .slice(0, 16);
}

/** Bytes this album is using, against its budget. Read from the index — cheap, and within a
 *  rounding error of the bucket because every per-file cap is enforced before the upload. */
export async function budgetState(list?: EventPhoto[]): Promise<{ usedBytes: number; budgetBytes: number; full: boolean }> {
  const photos = list ?? (await listPhotos());
  const mb = Number(await getSetting(PHOTOS_BUDGET_KEY)) || BUDGET_MB_DEFAULT;
  const budgetBytes = mb * 1024 * 1024;
  const usedBytes = photos.reduce((n, p) => n + (Number(p.size_bytes) || 0), 0);
  return { usedBytes, budgetBytes, full: usedBytes >= budgetBytes };
}

export async function keepOriginals(): Promise<boolean> {
  return (await getSetting(PHOTOS_KEEP_ORIGINALS_KEY)) === "1";
}

export async function uploadsOpen(): Promise<{ open: boolean; reason: string }> {
  if ((await getSetting(PHOTOS_CLOSED_KEY)) === "1") {
    return { open: false, reason: "Photo uploads are closed. Text Ramon if you still have pictures to send." };
  }
  if (Date.now() > Date.parse(UPLOADS_OPEN_UNTIL)) {
    return { open: false, reason: "Photo uploads for this event have closed. Text Ramon if you still have pictures to send." };
  }
  return { open: true, reason: "" };
}

async function read(): Promise<{ list: EventPhoto[]; stamp: string | null }> {
  const row = await getSettingRow(PHOTOS_KEY);
  if (!row?.value) return { list: [], stamp: row?.updated_at ?? null };
  try {
    const parsed = JSON.parse(row.value);
    return { list: Array.isArray(parsed) ? parsed : [], stamp: row.updated_at ?? null };
  } catch {
    // A corrupt blob must not read as "no photos" — the next write would erase the captions
    // for every picture already sent. Refuse loudly instead (same rule as the guest list).
    throw new Error(`${PHOTOS_KEY} is not valid JSON — refusing to overwrite the photo index`);
  }
}

export async function listPhotos(): Promise<EventPhoto[]> {
  return (await read()).list;
}

/** How many this source has committed in the last hour — the flood guard's input. */
export function recentFromIp(list: EventPhoto[], ipHash: string | null, windowMs = 3600_000): number {
  if (!ipHash) return 0;
  const since = Date.now() - windowMs;
  return list.filter((p) => p.ip === ipHash && Date.parse(p.created_at) >= since).length;
}

export type AddInput = Omit<EventPhoto, "id" | "created_at">;

/** Append one photo to the index. Retries the whole read-modify-write on a lost race. */
export async function addPhoto(input: AddInput): Promise<EventPhoto> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { list, stamp } = await read();
    if (list.length >= MAX_PHOTOS) throw new Error("This gallery is full — please text Ramon.");
    if (list.some((p) => p.path === input.path)) {
      // Idempotent: a retried commit of the same object must not double-list it.
      return list.find((p) => p.path === input.path)!;
    }
    const now = new Date().toISOString();
    const photo: EventPhoto = {
      id: `p_${now.replace(/\D/g, "")}_${Math.random().toString(36).slice(2, 8)}`,
      ...input,
      created_at: now,
    };
    if (await casSetting(PHOTOS_KEY, stamp, JSON.stringify([...list, photo]))) return photo;
    await new Promise((r) => setTimeout(r, 40 + Math.floor(Math.random() * 120)));
  }
  throw new Error("Couldn't save that photo's details — please try again.");
}

/** Drop one photo from the index AND from storage. Returns the entry that was removed. */
export async function removePhoto(idOrPath: string): Promise<EventPhoto | null> {
  let removed: EventPhoto | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const { list, stamp } = await read();
    const idx = list.findIndex((p) => p.id === idOrPath || p.path === idOrPath);
    if (idx < 0) { removed = null; break; }
    removed = list[idx];
    const next = list.filter((_, i) => i !== idx);
    if (await casSetting(PHOTOS_KEY, stamp, JSON.stringify(next))) break;
    await new Promise((r) => setTimeout(r, 40 + Math.floor(Math.random() * 120)));
  }
  // Delete the object whether or not it had an index row — the bucket is the authority, so
  // "remove this picture" has to reach the bytes even when the caption was never saved.
  const path = removed?.path || (idOrPath.startsWith(`${PHOTO_PREFIX}/`) ? idOrPath : null);
  if (path) await supabaseAdmin.storage.from(PHOTO_BUCKET).remove([path]);
  return removed;
}

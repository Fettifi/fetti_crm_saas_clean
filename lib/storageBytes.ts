// UPLOADING A GENERATED IMAGE: HAND STORAGE ITS OWN BYTES, NOT A VIEW INTO SOMEBODY ELSE'S.
//
// 2026-08-23, proved in production. A guest photo arrived at 4.83MB, the resize ran and produced
// a 2.2MB JPEG, and storing it failed with:
//
//     ArrayBuffer: SharedArrayBuffer is not allowed.
//
// sharp's `.toBuffer()` hands back a Node Buffer that is a VIEW over a buffer it does not own
// exclusively. The Supabase storage client (undici underneath) refuses to send that, and the
// refusal arrives as an ordinary `{ error }` — so every caller that only checked "did it throw"
// carried on with the original file and reported success. The photo was recorded at its full
// size, nothing errored, and the album's whole storage budget quietly stopped meaning anything.
//
// It only happens in production. Locally the same code path writes the smaller file every time,
// which is what makes this family of bug expensive — the identical shape already cost this repo
// a "SOI not found in JPEG" that only appeared once deployed (see the pdf-lib byteOffset note in
// lib/pdfCompress).
//
// So: copy into a fresh Uint8Array that owns its memory, and pass THAT to .upload().
export function unpooled(buf: Uint8Array | Buffer): Uint8Array {
  // `new Uint8Array(typedArray)` copies the CONTENTS into a newly allocated buffer — it does not
  // wrap. That is the entire point: the result is backed by memory nothing else has a view into.
  return new Uint8Array(buf);
}

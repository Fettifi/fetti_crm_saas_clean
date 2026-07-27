// heic-convert ships no type declarations. Declaring just the call we make is lighter than a
// @types dependency and keeps the signature honest at the call site. Must live in its own
// ambient file — a `declare module` inside lib/heic.ts is treated as an AUGMENTATION, which
// TypeScript rejects for a module that has no types to augment (TS2665).
declare module "heic-convert" {
  const convert: (opts: {
    buffer: Buffer;
    format: "JPEG" | "PNG";
    quality?: number;   // 0..1
  }) => Promise<ArrayBuffer>;
  export default convert;
}

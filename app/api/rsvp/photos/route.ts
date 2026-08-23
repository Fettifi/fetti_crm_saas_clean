// RAMON'S SIDE OF THE GUEST PHOTOS — list, view, download, delete.
//
// AUTHORIZATION IS THE PROXY'S JOB. This sits under /api/rsvp, which proxy.ts lists in
// apiProtected AND in config.matcher, so it cannot be reached without a real signed-in
// session. Same door as the guest list, deliberately: the two belong to one event.
//
// IT LISTS THE BUCKET, NOT THE INDEX. Storage is the authority — a photo whose commit call
// failed on party wifi is still a photograph, and it will appear here with whatever metadata
// did survive. The index only ever adds the guest's name and note on top.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { PHOTO_BUCKET, PHOTO_PREFIX, listPhotos, removePhoto, kindOf } from "@/lib/eventPhotos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_TTL = 60 * 60; // an hour is plenty to browse an album

type Row = {
  id: string; path: string; file_name: string; kind: "image" | "video";
  size_bytes: number; content_type: string; uploader: string | null; note: string | null;
  created_at: string | null; indexed: boolean;
};

export async function GET(req: NextRequest) {
  try {
    const page = Math.max(0, Number(req.nextUrl.searchParams.get("page")) || 0);
    const perPage = Math.min(120, Math.max(12, Number(req.nextUrl.searchParams.get("per")) || 60));

    // Paged, because a storage listing has a server-side page cap: one call asking for 10,000
    // does not fail, it just returns the first page — and an album that stops at some invisible
    // number, showing a confident total, is the worst possible way to lose a photograph.
    const objects: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabaseAdmin.storage
        .from(PHOTO_BUCKET)
        .list(PHOTO_PREFIX, { limit: 1000, offset, sortBy: { column: "created_at", order: "desc" } });
      // An error here must never read as "no photos" — that is the shape that makes an empty
      // gallery look like a quiet answer instead of a broken one.
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      objects.push(...(data || []));
      if ((data || []).length < 1000) break;
    }

    const index = await listPhotos().catch(() => []);
    const byPath = new Map(index.map((p) => [p.path, p]));

    const all = objects
      // Supabase returns a placeholder row for an empty folder; it has no metadata/id.
      .filter((o: any) => o?.name && o.name !== ".emptyFolderPlaceholder")
      .map((o: any): Row => {
        const path = `${PHOTO_PREFIX}/${o.name}`;
        const meta = byPath.get(path);
        return {
          id: meta?.id || path,
          path,
          file_name: meta?.file_name || o.name,
          kind: meta?.kind || kindOf(o.name) || "image",
          size_bytes: Number(o?.metadata?.size) || meta?.size_bytes || 0,
          content_type: o?.metadata?.mimetype || meta?.content_type || "application/octet-stream",
          uploader: meta?.uploader || null,
          note: meta?.note || null,
          created_at: meta?.created_at || o?.created_at || null,
          indexed: !!meta,
        };
      })
      .sort((a: Row, b: Row) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

    const slice = all.slice(page * perPage, page * perPage + perPage);
    const { data: signed } = await supabaseAdmin.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(slice.map((p: Row) => p.path), SIGNED_TTL);
    const urlByPath = new Map((signed || []).map((s: any) => [s.path, s.signedUrl]));

    return NextResponse.json({
      ok: true,
      total: all.length,
      page,
      per: perPage,
      has_more: (page + 1) * perPage < all.length,
      bytes_total: all.reduce((n: number, p: Row) => n + p.size_bytes, 0),
      uploaders: Array.from(new Set(index.map((p) => p.uploader).filter(Boolean))).sort(),
      photos: slice.map((p: Row) => ({ ...p, url: urlByPath.get(p.path) || null })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

/** Remove one picture — from the index AND from the bucket. */
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const removed = await removePhoto(id);
    return NextResponse.json({ ok: true, removed: removed?.file_name || id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

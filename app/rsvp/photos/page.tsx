"use client";

// THE ALBUM — everything guests sent, for Ramon and Piaget.
//
// Login-gated by the "/rsvp" prefix in lib/routeAccess.ts, which is the same door as the guest
// list. Images are served through short-lived SIGNED urls: the bucket is private, and it stays
// private — nothing here is ever a public link.
import { useCallback, useEffect, useState } from "react";

type Photo = {
  id: string; path: string; file_name: string; kind: "image" | "video";
  size_bytes: number; content_type: string; uploader: string | null; note: string | null;
  created_at: string | null; indexed: boolean; url: string | null;
};

const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (iso: string | null) =>
  !iso ? "" : new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function PhotosGallery() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [total, setTotal] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [uploaders, setUploaders] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Photo | null>(null);

  const load = useCallback(async (p: number, append: boolean) => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/rsvp/photos?page=${p}`);
      const j = await r.json();
      if (!r.ok) { setErr(j?.error || "Couldn't load the album."); return; }
      setPhotos((prev) => (append ? [...prev, ...(j.photos || [])] : j.photos || []));
      setTotal(j.total || 0); setBytes(j.bytes_total || 0);
      setUploaders(j.uploaders || []); setHasMore(!!j.has_more); setPage(p);
    } catch (e: any) { setErr(e?.message || "Couldn't load the album."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(0, false); }, [load]);

  // The overlay owes the phone's back button an entry, or Back leaves the whole page.
  useEffect(() => {
    if (!open) return;
    history.pushState({ lightbox: true }, "");
    const onPop = () => setOpen(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open]);
  const closeViewer = () => {
    if (history.state?.lightbox) history.back();
    else setOpen(null);
  };

  async function remove(p: Photo) {
    if (!confirm(`Delete ${p.file_name}? This removes the file for good.`)) return;
    const r = await fetch(`/api/rsvp/photos?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
    if (r.ok) { setPhotos((prev) => prev.filter((x) => x.id !== p.id)); setTotal((t) => Math.max(0, t - 1)); setOpen(null); }
    else setErr("Couldn't delete that one.");
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-bold">Photos from the day</h1>
          <a href="/rsvp" className="text-sm text-emerald-400 hover:text-emerald-300">← guest list</a>
        </div>
        <p className="text-slate-400 text-sm mt-1">
          {total} {total === 1 ? "picture" : "pictures"}
          {bytes > 0 && ` · ${(bytes / 1073741824).toFixed(2)} GB`}
          {uploaders.length > 0 && ` · from ${uploaders.length} named ${uploaders.length === 1 ? "guest" : "guests"}`}
        </p>
        <p className="text-slate-500 text-xs mt-2">
          Guests upload at <span className="text-slate-300">fettifi.com/photos</span> — the QR code on the
          invitation and the cards points there.
        </p>

        {err && <div className="mt-4 text-sm rounded-lg px-3 py-2 border text-red-300 bg-red-950/20 border-red-900/40">{err}</div>}

        {!loading && total === 0 && (
          <div className="mt-8 rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-400 text-sm">
            Nothing yet. As guests scan the code, their photos land here.
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {photos.map((p) => (
            <button key={p.id} onClick={() => setOpen(p)}
              className="group relative aspect-square overflow-hidden rounded-xl border border-slate-800 bg-slate-900 text-left">
              {p.kind === "video" ? (
                <div className="w-full h-full flex items-center justify-center text-3xl text-slate-500">▶</div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.url || ""} alt={p.file_name} loading="lazy"
                  className="w-full h-full object-cover transition group-hover:scale-[1.03]" />
              )}
              {(p.uploader || p.kind === "video") && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
                  <div className="text-[11px] text-white truncate">
                    {p.kind === "video" ? "video" : ""}{p.kind === "video" && p.uploader ? " · " : ""}{p.uploader || ""}
                  </div>
                </div>
              )}
            </button>
          ))}
        </div>

        {hasMore && (
          <div className="mt-6 text-center">
            <button onClick={() => load(page + 1, true)} disabled={loading}
              className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg px-5 py-2 text-sm font-medium">
              {loading ? "Loading…" : "Show more"}
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" onClick={closeViewer}>
          <div className="flex items-center justify-between p-3 text-sm" onClick={(e) => e.stopPropagation()}>
            <div className="min-w-0">
              <div className="truncate font-medium">{open.uploader || "Someone"} · {mb(open.size_bytes)}</div>
              <div className="text-slate-400 text-xs truncate">
                {when(open.created_at)}{open.note ? ` · "${open.note}"` : ""}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <a href={open.url || "#"} download={open.file_name} target="_blank" rel="noreferrer"
                className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-semibold">Download</a>
              <button onClick={() => remove(open)} className="rounded-lg bg-slate-800 hover:bg-red-900/60 px-3 py-1.5 text-xs">Delete</button>
              <button onClick={closeViewer} className="rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs">Close</button>
            </div>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center p-3" onClick={(e) => e.stopPropagation()}>
            {open.kind === "video" ? (
              <video src={open.url || ""} controls playsInline className="max-h-full max-w-full rounded-lg" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={open.url || ""} alt={open.file_name} className="max-h-full max-w-full object-contain rounded-lg" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

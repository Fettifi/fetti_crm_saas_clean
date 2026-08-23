"use client";

// WHAT A GUEST SEES AFTER SCANNING THE QR CODE.
//
// Written for one situation: someone standing at a party, one-handed, on hotel wifi, who has
// no intention of installing anything. So — no login, no account, no app, no "which cloud do
// you use", and the very first thing on screen is the button that opens their camera roll.
// The name field is optional and sits BELOW the button, because asking for it first is where
// people quit.
//
// Uploads go straight to storage on a signed URL (XHR, not fetch, purely because fetch cannot
// report upload progress and a 90MB video with no moving bar reads as "broken"). Two at a
// time: enough to use the bandwidth, few enough that a phone on bad wifi doesn't stall them
// all at once. Every failure is named out loud — a wedding guest who thinks their photos went
// through and lost them is the failure this whole page exists to avoid.
import { useCallback, useEffect, useRef, useState } from "react";

type Item = {
  key: string;
  file: File;
  status: "queued" | "uploading" | "done" | "failed";
  pct: number;
  error?: string;
};

// Mirrors lib/eventPhotos.ts. 50MB is the storage project's hard ceiling, not a preference —
// checking it here means a guest is told before a 90MB video spends four minutes uploading.
const MAX_IMAGE_MB = 40;
const MAX_VIDEO_MB = 50;
const isVideo = (f: File) => /^video\//i.test(f.type) || /\.(mp4|mov|m4v|webm|3gp)$/i.test(f.name);

export default function Uploader({ eventLabel, eventDate }: { eventLabel: string; eventDate: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [closed, setClosed] = useState<string | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const running = useRef(0);
  const queue = useRef<Item[]>([]);
  // Read inside async callbacks, so the name typed after a queue starts still gets attached.
  const meta = useRef({ name: "", note: "" });
  useEffect(() => { meta.current = { name, note }; }, [name, note]);

  // Remember the guest between visits — most people upload again later, from the same phone,
  // when they get home and find the good ones.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("fetti:photos:name");
      if (saved) setName(saved);
    } catch { /* private browsing */ }
  }, []);
  useEffect(() => {
    try { if (name.trim()) localStorage.setItem("fetti:photos:name", name.trim()); } catch { /* ignore */ }
  }, [name]);

  // If uploads have been closed, say so before anyone picks 40 photos and watches them fail.
  useEffect(() => {
    fetch("/api/photos")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && j.open === false) setClosed(j.closed_reason || "Photo uploads are closed."); })
      .catch(() => { /* the upload itself will report any real problem */ });
  }, []);

  const update = useCallback((key: string, patch: Partial<Item>) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }, []);

  const pump = useCallback(() => {
    while (running.current < 2 && queue.current.length) {
      const item = queue.current.shift()!;
      running.current++;
      void send(item).finally(() => { running.current--; pump(); });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(item: Item) {
    const f = item.file;
    update(item.key, { status: "uploading", pct: 0 });
    try {
      const su = await fetch("/api/photos/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only what the route actually reads. The real content type comes from the object's
        // own storage metadata at commit time, which is the one source that cannot be spoofed.
        body: JSON.stringify({ file_name: f.name, size_bytes: f.size }),
      });
      const sj = await su.json().catch(() => ({} as any));
      if (!su.ok || !sj?.url) { update(item.key, { status: "failed", error: sj?.error || "Couldn't start" }); return; }

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", sj.url, true);
        xhr.setRequestHeader("Content-Type", f.type || "application/octet-stream");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) update(item.key, { pct: Math.round((e.loaded / e.total) * 95) });
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`transfer failed (${xhr.status})`)));
        xhr.onerror = () => reject(new Error("connection dropped"));
        xhr.ontimeout = () => reject(new Error("connection timed out"));
        xhr.send(f);
      });

      update(item.key, { pct: 97 });
      const rec = await fetch("/api/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: sj.path, file_name: sj.file_name, size_bytes: f.size, content_type: f.type,
          uploader: meta.current.name, note: meta.current.note,
        }),
      });
      if (!rec.ok) {
        const j = await rec.json().catch(() => ({} as any));
        // The bytes ARE in the bucket at this point — the gallery lists storage, not the
        // index — so this is only ever a lost caption. Never tell a guest their photo is gone.
        update(item.key, { status: "done", pct: 100, error: j?.error ? "sent (name not saved)" : undefined });
        return;
      }
      update(item.key, { status: "done", pct: 100, error: undefined });
    } catch (e) {
      update(item.key, { status: "failed", error: e instanceof Error ? e.message : "failed" });
    }
  }

  function add(files: FileList | null) {
    if (!files?.length) return;
    const next: Item[] = [];
    for (const f of Array.from(files)) {
      const capMb = isVideo(f) ? MAX_VIDEO_MB : MAX_IMAGE_MB;
      const key = `${f.name}:${f.size}:${f.lastModified}:${Math.random().toString(36).slice(2, 7)}`;
      if (f.size > capMb * 1024 * 1024) {
        next.push({
          key, file: f, status: "failed", pct: 0,
          error: isVideo(f)
            ? `video is too long for the album (over ${capMb}MB) — text it to Ramon instead`
            : `too big (over ${capMb}MB)`,
        });
        continue;
      }
      next.push({ key, file: f, status: "queued", pct: 0 });
    }
    setItems((prev) => [...prev, ...next]);
    queue.current.push(...next.filter((i) => i.status === "queued"));
    pump();
  }

  function retry(item: Item) {
    update(item.key, { status: "queued", pct: 0, error: undefined });
    queue.current.push(item);
    pump();
  }

  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "failed");
  const working = items.some((i) => i.status === "uploading" || i.status === "queued");

  return (
    <main className="min-h-[100dvh] bg-[#FAF6EF] text-[#20291F]">
      {/* Hidden inputs — the visible buttons drive them, so the tap target is ours to size. */}
      <input ref={pickRef} type="file" accept="image/*,video/*" multiple className="hidden"
        onChange={(e) => { add(e.target.files); e.currentTarget.value = ""; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { add(e.target.files); e.currentTarget.value = ""; }} />

      <div className="mx-auto max-w-lg px-5 py-10 sm:py-14">
        <p className="text-center text-[11px] tracking-[0.28em] uppercase text-[#1F5D3A]/70">
          {eventDate}
        </p>
        <h1 className="mt-3 text-center font-serif text-[2.1rem] leading-tight text-[#1F5D3A] sm:text-4xl">
          Share your photos
        </h1>
        <div className="mx-auto mt-4 h-px w-16 bg-[#C9A227]" />
        <p className="mt-4 text-center text-[15px] leading-relaxed text-[#4A5347]">
          You were there for {eventLabel.replace(/^our\b/i, "our")} — send us what you saw. Pick as many
          photos and videos as you like; they go straight to us.
        </p>

        {closed ? (
          <div className="mt-8 rounded-2xl border border-[#C9A227]/40 bg-white p-5 text-center text-[15px] text-[#4A5347]">
            {closed}
          </div>
        ) : (
          <>
            <button
              onClick={() => pickRef.current?.click()}
              className="mt-8 w-full rounded-2xl bg-[#1F5D3A] px-6 py-5 text-center text-[17px] font-semibold text-[#FAF6EF] shadow-sm transition active:scale-[0.99]"
            >
              Choose photos &amp; videos
            </button>
            <button
              onClick={() => cameraRef.current?.click()}
              className="mt-3 w-full rounded-2xl border border-[#1F5D3A]/25 bg-white px-6 py-4 text-center text-[15px] font-medium text-[#1F5D3A] transition active:scale-[0.99]"
            >
              Take a picture now
            </button>

            <div className="mt-6 space-y-3">
              <label className="block">
                <span className="text-[13px] font-medium text-[#4A5347]">Your name <span className="font-normal text-[#8A907F]">(so we know who to thank)</span></span>
                <input
                  value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional"
                  className="mt-1.5 w-full rounded-xl border border-[#DED5C4] bg-white px-4 py-3 text-[16px] outline-none focus:border-[#1F5D3A]"
                />
              </label>
              <label className="block">
                <span className="text-[13px] font-medium text-[#4A5347]">A note <span className="font-normal text-[#8A907F]">(optional)</span></span>
                <input
                  value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything you want to say"
                  className="mt-1.5 w-full rounded-xl border border-[#DED5C4] bg-white px-4 py-3 text-[16px] outline-none focus:border-[#1F5D3A]"
                />
              </label>
            </div>
          </>
        )}

        {items.length > 0 && (
          <div className="mt-8">
            <div className="flex items-baseline justify-between">
              <h2 className="font-serif text-lg text-[#1F5D3A]">
                {done} of {items.length} sent
              </h2>
              {working && <span className="text-[12px] text-[#8A907F]">keep this page open</span>}
            </div>

            <ul className="mt-3 divide-y divide-[#EAE2D3] overflow-hidden rounded-2xl border border-[#EAE2D3] bg-white">
              {items.map((i) => (
                <li key={i.key} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] text-[#20291F]">{i.file.name}</div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#F0EADD]">
                      <div
                        className={`h-full rounded-full transition-[width] duration-200 ${i.status === "failed" ? "bg-[#B4462F]" : "bg-[#1F5D3A]"}`}
                        style={{ width: `${i.status === "failed" ? 100 : i.pct}%` }}
                      />
                    </div>
                    {i.error && <div className="mt-1 text-[12px] text-[#B4462F]">{i.error}</div>}
                  </div>
                  <div className="shrink-0 text-[12px]">
                    {i.status === "done" && <span className="text-[#1F5D3A]">✓ sent</span>}
                    {i.status === "uploading" && <span className="text-[#8A907F]">{i.pct}%</span>}
                    {i.status === "queued" && <span className="text-[#8A907F]">waiting</span>}
                    {i.status === "failed" && (
                      <button onClick={() => retry(i)} className="rounded-lg border border-[#1F5D3A]/30 px-2.5 py-1 font-medium text-[#1F5D3A]">
                        Try again
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {done > 0 && !working && failed.length === 0 && (
              <p className="mt-4 text-center font-serif text-[17px] text-[#1F5D3A]">
                Thank you — {done === 1 ? "it's" : "they're"} with us. 💚
              </p>
            )}
            {failed.length > 0 && !working && (
              <p className="mt-4 text-center text-[13px] text-[#B4462F]">
                {failed.length} didn&apos;t make it. Tap <em>Try again</em> next to each one.
              </p>
            )}
          </div>
        )}

        <p className="mt-10 text-center text-[12px] leading-relaxed text-[#8A907F]">
          Your pictures go privately to us — nothing is posted publicly.
          <br />
          Large videos take a minute on wifi — anything over {MAX_VIDEO_MB}MB is too big to send here.
          <br />
          You can come back and add more at any time.
        </p>
      </div>
    </main>
  );
}

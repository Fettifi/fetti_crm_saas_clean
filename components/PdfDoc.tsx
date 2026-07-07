"use client";

// DocuSign-style PDF canvas with a field overlay.
//  • mode "place": click the armed tool onto the page to drop a field; drag to
//    reposition; ✕ to remove. Coordinates are stored as page-relative fractions
//    (top-left origin) so they map exactly to the server-side pdf-lib stamp.
//  • mode "sign": fields render filled with the signer's adopted signature /
//    initials / date / name.
import { useCallback, useEffect, useRef, useState } from "react";

export type EsignFieldType = "signature" | "initials" | "date" | "name" | "text";
export type EsignField = { id: string; type: EsignFieldType; page: number; xPct: number; yPct: number; wPct: number; hPct: number; recipientId?: string; mine?: boolean; value?: string };

export const FIELD_SIZE: Record<EsignFieldType, { w: number; h: number }> = {
  signature: { w: 0.24, h: 0.06 },
  initials: { w: 0.11, h: 0.05 },
  date: { w: 0.16, h: 0.032 },
  name: { w: 0.24, h: 0.032 },
  text: { w: 0.3, h: 0.035 },
};
const LABEL: Record<EsignFieldType, string> = { signature: "Signature", initials: "Initials", date: "Date", name: "Name", text: "Text" };

type PageInfo = { num: number; w: number; h: number };

export default function PdfDoc({
  src, data, mode, fields, onChange, tool, onToolUsed, signatureImg, signerName, activeRecipientId, recipientColors, recipientLabels,
}: {
  src?: string;
  data?: Uint8Array;
  mode: "place" | "sign";
  fields: EsignField[];
  onChange?: (f: EsignField[]) => void;
  tool?: EsignFieldType | null;
  onToolUsed?: () => void;
  signatureImg?: string | null;
  signerName?: string;
  activeRecipientId?: string;                       // place mode: who placed fields belong to
  recipientColors?: Record<string, string>;         // recipientId -> hex color
  recipientLabels?: Record<string, string>;         // recipientId -> short name
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<any>(null);
  const canvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({});
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  // Load the document and compute display sizes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs: any = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        // Clone bytes — pdf.js transfers the buffer to its worker (detaches it).
        const docParams: any = data ? { data: data.slice(0), isEvalSupported: false } : { url: src, isEvalSupported: false };
        const doc = await pdfjs.getDocument(docParams).promise;
        if (cancelled) return;
        docRef.current = doc;
        const width = Math.min(wrapRef.current?.clientWidth || 800, 900);
        const infos: PageInfo[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = width / base.width;
          const vp = page.getViewport({ scale });
          infos.push({ num: i, w: vp.width, h: vp.height });
        }
        if (!cancelled) setPages(infos);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Could not load the document.");
      }
    })();
    return () => { cancelled = true; };
  }, [src, data]);

  // Render each page into its canvas once mounted.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const doc = docRef.current; if (!doc) return;
      for (const p of pages) {
        const canvas = canvasRefs.current[p.num]; if (!canvas) continue;
        const page = await doc.getPage(p.num);
        const cssScale = p.w / page.getViewport({ scale: 1 }).width;
        // Oversample the canvas backing store (2–3×) so the document stays CRISP and
        // readable when the signer zooms/enlarges it. CSS size stays p.w × p.h.
        const RES = Math.min(3, Math.max(2, (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1) * 1.5));
        const vp = page.getViewport({ scale: cssScale * RES });
        canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
        canvas.style.width = `${p.w}px`; canvas.style.height = `${p.h}px`;
        const ctx = canvas.getContext("2d"); if (!ctx) continue;
        try { await page.render({ canvasContext: ctx, viewport: vp }).promise; } catch { /* */ }
        if (cancelled) return;
      }
    })();
    return () => { cancelled = true; };
  }, [pages]);

  const placeAt = useCallback((pageNum: number, e: React.MouseEvent) => {
    if (mode !== "place" || !tool || !onChange) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const sz = FIELD_SIZE[tool];
    let xPct = (e.clientX - rect.left) / rect.width - sz.w / 2;
    let yPct = (e.clientY - rect.top) / rect.height - sz.h / 2;
    xPct = Math.max(0, Math.min(1 - sz.w, xPct));
    yPct = Math.max(0, Math.min(1 - sz.h, yPct));
    const f: EsignField = { id: Math.random().toString(36).slice(2, 9), type: tool, page: pageNum, xPct, yPct, wPct: sz.w, hPct: sz.h, recipientId: activeRecipientId };
    onChange([...fields, f]);
    onToolUsed?.();
  }, [mode, tool, fields, onChange, onToolUsed]);

  function startDrag(field: EsignField, e: React.PointerEvent) {
    if (mode !== "place" || !onChange) return;
    e.stopPropagation();
    const overlay = (e.currentTarget as HTMLElement).parentElement!;
    const rect = overlay.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      let xPct = (ev.clientX - rect.left) / rect.width - field.wPct / 2;
      let yPct = (ev.clientY - rect.top) / rect.height - field.hPct / 2;
      xPct = Math.max(0, Math.min(1 - field.wPct, xPct));
      yPct = Math.max(0, Math.min(1 - field.hPct, yPct));
      onChange(fields.map((x) => x.id === field.id ? { ...x, xPct, yPct } : x));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  // Drag the corner grip to RESIZE a placed field (min sizes keep it usable; the
  // stored fractions map 1:1 onto the server-side pdf-lib stamp, so what you see
  // is exactly what prints).
  function startResize(field: EsignField, e: React.PointerEvent) {
    if (mode !== "place" || !onChange) return;
    e.stopPropagation(); e.preventDefault();
    const overlay = (e.currentTarget as HTMLElement).closest("[data-overlay]") as HTMLElement;
    const rect = overlay.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      let wPct = (ev.clientX - rect.left) / rect.width - field.xPct;
      let hPct = (ev.clientY - rect.top) / rect.height - field.yPct;
      wPct = Math.max(0.04, Math.min(1 - field.xPct, wPct));
      hPct = Math.max(0.015, Math.min(1 - field.yPct, hPct));
      onChange(fields.map((x) => x.id === field.id ? { ...x, wPct, hPct } : x));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  if (err) return <div className="text-sm text-red-500 p-4">⚠️ {err}</div>;

  return (
    <div ref={wrapRef} className="space-y-3">
      {!pages.length && <div className="text-sm text-slate-400 p-4 flex items-center gap-2">Loading document…</div>}
      {pages.map((p) => (
        <div key={p.num} className="relative mx-auto shadow-lg" style={{ width: p.w, height: p.h }}>
          <canvas ref={(el) => { canvasRefs.current[p.num] = el; }} className="block" style={{ width: p.w, height: p.h }} />
          <div
            data-overlay
            className={`absolute inset-0 ${mode === "place" && tool ? "cursor-crosshair" : ""}`}
            onClick={(e) => placeAt(p.num, e)}
          >
            {fields.filter((f) => f.page === p.num).map((f) => {
              const color = (mode === "place" && f.recipientId && recipientColors?.[f.recipientId]) || null;
              const notMine = mode === "sign" && f.mine === false;
              const style: React.CSSProperties = { left: `${f.xPct * 100}%`, top: `${f.yPct * 100}%`, width: `${f.wPct * 100}%`, height: `${f.hPct * 100}%` };
              if (color) { style.borderColor = color; style.background = color + "22"; style.color = color; }
              return (
                <div
                  key={f.id}
                  onPointerDown={(e) => startDrag(f, e)}
                  className={`absolute flex items-center justify-center text-[10px] rounded ${mode === "place" ? "border-2 border-dashed border-sky-500 bg-sky-500/15 text-sky-700 cursor-move" : notMine ? "border border-slate-300 bg-slate-200/40 text-slate-400" : "border border-emerald-500/60 bg-emerald-500/5"}`}
                  style={style}
                >
                  {mode === "place" ? (
                    <>
                      <span className="pointer-events-none font-semibold truncate px-0.5">{LABEL[f.type]}{f.recipientId && recipientLabels?.[f.recipientId] ? ` · ${recipientLabels[f.recipientId]}` : ""}</span>
                      {onChange && (
                        <button onClick={(e) => { e.stopPropagation(); onChange(fields.filter((x) => x.id !== f.id)); }}
                          className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-4 h-4 leading-none text-[10px]">×</button>
                      )}
                      {onChange && (
                        <span onPointerDown={(e) => startResize(f, e)} title="Drag to resize"
                          className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-sky-500 border border-white rounded-sm cursor-nwse-resize" />
                      )}
                    </>
                  ) : notMine ? (
                    <span className="text-[9px]">{recipientLabels?.[f.recipientId || ""] || "Other signer"}</span>
                  ) : (f.type === "signature" || f.type === "initials") ? (
                    signatureImg
                      ? <img src={signatureImg} alt="" className="max-w-full max-h-full object-contain" />
                      : <span className="text-emerald-600 font-semibold">{LABEL[f.type]}</span>
                  ) : f.type === "text" ? (
                    onChange ? (
                      <input value={f.value || ""} placeholder="Type here…"
                        onChange={(e) => onChange(fields.map((x) => x.id === f.id ? { ...x, value: e.target.value } : x))}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="w-full h-full bg-amber-50/90 border border-amber-400 rounded px-1 text-slate-900 focus:outline-none focus:border-emerald-500"
                        style={{ fontSize: "clamp(8px,1.4vw,13px)" }} />
                    ) : <span className="text-slate-900 truncate px-1" style={{ fontSize: "clamp(8px,1.4vw,13px)" }}>{f.value || ""}</span>
                  ) : (
                    <span className="text-slate-900 truncate px-1" style={{ fontSize: "clamp(8px,1.4vw,13px)" }}>
                      {f.type === "date" ? today : (signerName || "Name")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

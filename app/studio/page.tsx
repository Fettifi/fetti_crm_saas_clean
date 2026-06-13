"use client";

// Fetti Creative Studio — in-CRM ad builder (Canva-style) with a MARK SPOKESPERSON
// mode (GEICO-gecko style): Mark the owl stands in the ad with a speech bubble and
// — for video — DELIVERS the line in his own voice (ElevenLabs TTS muxed into the
// recording). Export a branded PNG or an animated MP4/webm. NMLS + Equal Housing
// disclosure is baked into every export.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, Download, Video, Upload, Image as ImageIcon } from "lucide-react";
import { withMarkSignoff } from "@/lib/markPersona";

const FORMATS: Record<string, { w: number; h: number; label: string; gen: string }> = {
  square: { w: 1080, h: 1080, label: "Square 1:1", gen: "1024x1024" },
  portrait: { w: 1080, h: 1350, label: "Portrait 4:5", gen: "1024x1536" },
  story: { w: 1080, h: 1920, label: "Story / Reel 9:16", gen: "1024x1536" },
};

// Mark's voiceover lines — street-smart money mentor, every clip closes with
// "Fetti. We do money." (see lib/markPersona.ts for the character brief).
const TEMPLATES = [
  { key: "DSCR Purchase", headline: "DSCR Loans", sub: "Qualify on the rental income — not your tax returns.", cta: "Apply in 2 min",
    line: "I'm Mark, with Fetti. Own a rental — or ready to? We qualify you on the property's income, not your tax returns. Close in your L-L-C, in any state. Two minutes to start, and the capital is ready when you are. Fetti. We do money.",
    prompt: "attractive modern American single-family rental home, manicured lawn, bright daylight, blue sky" },
  { key: "DSCR Cash-Out", headline: "Cash Out Your Rentals", sub: "Refinance on the property's cash flow. Close in your LLC.", cta: "Get my options",
    line: "Mark here. You have equity sitting in your rentals — let's put it to work. We qualify on the property's cash flow, not your paperwork. Pull your cash out, fund the next deal. Start below. Fetti. We do money.",
    prompt: "beautiful suburban investment property exterior at golden hour" },
  { key: "Fix & Flip", headline: "Fund Your Flip", sub: "Purchase + rehab, fast close, interest-only.", cta: "Get funded",
    line: "Mark here. Found a flip? We fund the purchase and the rehab, close fast, and keep you interest-only through the project. You move quick — we move quicker. Let's fund it. Fetti. We do money.",
    prompt: "house mid-renovation with fresh exterior remodel, bright" },
  { key: "Refinance", headline: "Lower Your Payment", sub: "Cut your rate or tap your equity — we shop the whole market.", cta: "See my rate",
    line: "I'm Mark, with Fetti. Looking for a lower payment, or cash from your home? We're a lender and a broker — so we fund it ourselves, or shop the whole market for your best terms. Never one bank's menu. See your numbers in two minutes. Fetti. We do money.",
    prompt: "warm inviting suburban home exterior, lush landscaping, sunny" },
  { key: "Bank-Statement", headline: "Self-Employed? No Problem.", sub: "Qualify on bank deposits, not tax returns.", cta: "Apply now",
    line: "Mark here. Self-employed? Your tax returns rarely show what you truly earn — so we don't use them. We qualify you on your bank deposits instead. Built by entrepreneurs who understand. Start below. Fetti. We do money.",
    prompt: "modern home office and an attractive home, entrepreneurial, bright and clean" },
];

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/); const lines: string[] = []; let line = "";
  for (const w of words) { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line); return lines;
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export default function CreativeStudio() {
  const [fmt, setFmt] = useState("square");
  const [headline, setHeadline] = useState(TEMPLATES[0].headline);
  const [sub, setSub] = useState(TEMPLATES[0].sub);
  const [cta, setCta] = useState(TEMPLATES[0].cta);
  const [prompt, setPrompt] = useState(TEMPLATES[0].prompt);
  const [markMode, setMarkMode] = useState(true);
  const [voiceover, setVoiceover] = useState(true);
  const [line, setLine] = useState(TEMPLATES[0].line);
  const [bg, setBg] = useState<HTMLImageElement | null>(null);
  const [gen, setGen] = useState(false);
  const [rec, setRec] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const embRef = useRef<HTMLImageElement | null>(null);
  const markRef = useRef<HTMLImageElement | null>(null);

  const draw = useCallback((zoom = 1, alpha = 1, markIn = 1, bob = 0) => {
    const c = canvasRef.current; if (!c) return;
    const F = FORMATS[fmt]; if (c.width !== F.w) c.width = F.w; if (c.height !== F.h) c.height = F.h;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const W = F.w, H = F.h, s = W / 1080;
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#0f172a"; ctx.fillRect(0, 0, W, H);
    if (bg) { const scale = Math.max(W / bg.width, H / bg.height) * zoom; const dw = bg.width * scale, dh = bg.height * scale; ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh); }
    const g = ctx.createLinearGradient(0, H * 0.3, 0, H); g.addColorStop(0, "rgba(2,6,23,0)"); g.addColorStop(1, "rgba(2,6,23,0.94)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (embRef.current) ctx.drawImage(embRef.current, 50 * s, 50 * s, 92 * s, 92 * s);

    // Mark spokesperson (bottom-right), with a speech bubble holding the headline.
    let textRightLimit = W - 100 * s;
    if (markMode && markRef.current) {
      const m = markRef.current; const mh = H * 0.62; const mw = mh * (m.width / m.height);
      const mx = W - mw - 20 * s; const my = H - mh + (1 - markIn) * mh * 0.5 + bob; // slide up on entrance + bob
      ctx.globalAlpha = markIn; ctx.drawImage(m, mx, my, mw, mh); ctx.globalAlpha = 1;
      textRightLimit = mx - 30 * s;
      // speech bubble (headline) near Mark's head
      ctx.font = `800 ${52 * s}px -apple-system, "Inter", Arial`;
      const bw = Math.min(W * 0.66, 620 * s); const bl = wrap(ctx, headline, bw - 60 * s);
      const bh = bl.length * 60 * s + 50 * s; const bx = 44 * s; const by = 150 * s;
      ctx.globalAlpha = Math.min(markIn * 1.2, 1);
      roundRect(ctx, bx, by, bw, bh, 28 * s); ctx.fillStyle = "rgba(255,255,255,0.96)"; ctx.fill();
      // tail toward Mark
      ctx.beginPath(); ctx.moveTo(bx + bw - 60 * s, by + bh); ctx.lineTo(bx + bw - 10 * s, by + bh + 46 * s); ctx.lineTo(bx + bw - 110 * s, by + bh); ctx.closePath(); ctx.fillStyle = "rgba(255,255,255,0.96)"; ctx.fill();
      ctx.fillStyle = "#0f172a"; let ty = by + 64 * s; bl.forEach((l) => { ctx.fillText(l, bx + 30 * s, ty); ty += 60 * s; });
      ctx.globalAlpha = 1;
    }

    // bottom copy: (sub + CTA always; headline here only when Mark is OFF)
    ctx.globalAlpha = alpha; ctx.textBaseline = "alphabetic";
    const subLines = sub ? (() => { ctx.font = `500 ${36 * s}px -apple-system, "Inter", Arial`; return wrap(ctx, sub, textRightLimit - 50 * s); })() : [];
    const hlLines = !markMode && headline ? (() => { ctx.font = `800 ${74 * s}px -apple-system, "Inter", Arial`; return wrap(ctx, headline, textRightLimit - 50 * s); })() : [];
    const ctaH = cta ? 92 * s : 0;
    let y = H - 120 * s - ctaH - subLines.length * 48 * s - (hlLines.length ? hlLines.length * 82 * s : 0);
    if (hlLines.length) { ctx.fillStyle = "#fff"; ctx.font = `800 ${74 * s}px -apple-system, "Inter", Arial`; hlLines.forEach((l) => { ctx.fillText(l, 50 * s, y); y += 82 * s; }); }
    if (subLines.length) { ctx.fillStyle = "#cbd5e1"; ctx.font = `500 ${36 * s}px -apple-system, "Inter", Arial`; y += 4 * s; subLines.forEach((l) => { ctx.fillText(l, 50 * s, y); y += 48 * s; }); }
    if (cta) {
      ctx.font = `700 ${36 * s}px -apple-system, "Inter", Arial`; const label = cta + "   →"; const tw = ctx.measureText(label).width;
      const pw = tw + 60 * s, ph = 80 * s, px = 50 * s, py = y + 22 * s;
      roundRect(ctx, px, py, pw, ph, 40 * s); ctx.fillStyle = "#10b981"; ctx.fill(); ctx.fillStyle = "#04231a"; ctx.fillText(label, px + 30 * s, py + 53 * s);
    }
    ctx.globalAlpha = alpha * 0.85; ctx.fillStyle = "#94a3b8"; ctx.font = `400 ${18 * s}px Arial`;
    ctx.fillText("Fetti Financial Services LLC · NMLS #2267023 · Equal Housing Opportunity", 50 * s, H - 38 * s);
    ctx.globalAlpha = 1;
  }, [fmt, bg, headline, sub, cta, markMode]);

  useEffect(() => { const i = new Image(); i.src = "/fetti-emblem.png"; i.onload = () => { embRef.current = i; draw(); }; }, [draw]);
  useEffect(() => { const i = new Image(); i.src = "/cedi.png"; i.onload = () => { markRef.current = i; draw(); }; }, [draw]);
  useEffect(() => { draw(); }, [draw]);

  function applyTemplate(t: typeof TEMPLATES[number]) { setHeadline(t.headline); setSub(t.sub); setCta(t.cta); setPrompt(t.prompt); setLine(t.line); }

  async function generate() {
    setGen(true); setMsg(null);
    try {
      const r = await fetch("/api/studio/image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, size: FORMATS[fmt].gen }) });
      const j = await r.json(); if (!r.ok) { setMsg("⚠️ " + (j.error || "Generation failed.")); return; }
      const img = new Image(); img.onload = () => setBg(img); img.src = j.dataUrl;
    } catch { setMsg("⚠️ Connection error."); } finally { setGen(false); }
  }
  function uploadBg(file: File) { const url = URL.createObjectURL(file); const img = new Image(); img.onload = () => { setBg(img); URL.revokeObjectURL(url); }; img.src = url; }
  function downloadPng() { draw(); const c = canvasRef.current; if (!c) return; c.toBlob((b) => { if (!b) return; const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `fetti-ad-${fmt}.png`; a.click(); URL.revokeObjectURL(a.href); }, "image/png"); }

  function pickMime(): string {
    const opts = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=h264", "video/webm;codecs=vp9", "video/webm"];
    for (const o of opts) if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(o)) return o;
    return "video/webm";
  }

  async function downloadVideo() {
    const c = canvasRef.current; if (!c) return;
    setRec(true); setMsg(null);
    let audioEl: HTMLAudioElement | null = null; let ac: AudioContext | null = null;
    try {
      const vstream = c.captureStream(30);
      const tracks: MediaStreamTrack[] = [...vstream.getVideoTracks()];
      let durMs = 9000;

      // Mark's voiceover: fetch TTS, route through WebAudio, mux into the recording.
      if (markMode && voiceover && line.trim()) {
        setMsg("🎙️ Generating Mark's voiceover…");
        const tr = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: withMarkSignoff(line) }) });
        if (tr.ok) {
          const blob = await tr.blob(); const url = URL.createObjectURL(blob);
          audioEl = new Audio(url); audioEl.crossOrigin = "anonymous";
          await new Promise<void>((res) => { audioEl!.onloadedmetadata = () => res(); audioEl!.onerror = () => res(); setTimeout(res, 4000); });
          if (audioEl.duration && isFinite(audioEl.duration)) durMs = Math.max(4000, Math.min(audioEl.duration * 1000 + 600, 30000));
          ac = new AudioContext();
          const srcNode = ac.createMediaElementSource(audioEl);
          const dest = ac.createMediaStreamDestination();
          srcNode.connect(dest); srcNode.connect(ac.destination);
          tracks.push(...dest.stream.getAudioTracks());
        } else { setMsg("⚠️ Voiceover failed — recording video without audio."); }
      }

      const mime = pickMime();
      const recr = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      const chunks: BlobPart[] = [];
      recr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recr.onstop = () => {
        const ext = mime.includes("mp4") ? "mp4" : "webm";
        const blob = new Blob(chunks, { type: mime.split(";")[0] });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `fetti-mark-ad-${fmt}.${ext}`; a.click(); URL.revokeObjectURL(a.href);
        try { ac?.close(); } catch { /* */ }
        setRec(false);
        setMsg(ext === "webm" ? "✓ Saved (.webm). Meta prefers .mp4 — for that, use Chrome. The PNG always works too." : "✓ Mark's video saved (.mp4) — ready to upload to Meta.");
      };

      setMsg("🎬 Recording Mark…");
      recr.start();
      if (audioEl) { try { await audioEl.play(); } catch { /* */ } }
      const t0 = performance.now();
      const loop = (t: number) => {
        const e = Math.min((t - t0) / durMs, 1);
        const bob = markMode ? Math.sin((t - t0) / 120) * 5 : 0; // subtle "talking" bob
        draw(1 + 0.08 * e, Math.min(e / 0.15, 1), Math.min(e / 0.25, 1), bob);
        if (e < 1) requestAnimationFrame(loop); else setTimeout(() => recr.state !== "inactive" && recr.stop(), 200);
      };
      requestAnimationFrame(loop);
    } catch {
      try { ac?.close(); } catch { /* */ }
      setRec(false); setMsg("⚠️ Your browser blocked recording. Use the PNG, or try Chrome.");
    }
  }

  const inp = "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none";

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Sparkles className="w-6 h-6 text-emerald-400" /> Creative Studio</h1>
        <p className="text-slate-400 text-sm mt-1">Build branded ad images & videos in-house. Mark 🦉 can present the ad and speak the line in his own voice. NMLS disclosure baked in.</p>

        <div className="flex flex-wrap gap-2 mt-4">
          {TEMPLATES.map((t) => (<button key={t.key} onClick={() => applyTemplate(t)} className="text-xs px-3 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200">{t.key}</button>))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-5">
          <div className="space-y-4">
            <div>
              <label className="text-xs text-slate-500">Format</label>
              <div className="flex gap-2 mt-1">{Object.entries(FORMATS).map(([k, v]) => (<button key={k} onClick={() => setFmt(k)} className={`text-xs px-3 py-1.5 rounded-lg ${fmt === k ? "bg-emerald-500 text-slate-950 font-semibold" : "bg-slate-800 text-slate-300"}`}>{v.label}</button>))}</div>
            </div>

            <div className="flex items-center gap-4 bg-slate-900/40 border border-slate-800 rounded-xl px-4 py-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={markMode} onChange={(e) => setMarkMode(e.target.checked)} className="accent-emerald-500" /> 🦉 Feature Mark (spokesperson)</label>
              <label className={`flex items-center gap-2 text-sm cursor-pointer ${markMode ? "" : "opacity-40"}`}><input type="checkbox" disabled={!markMode} checked={voiceover} onChange={(e) => setVoiceover(e.target.checked)} className="accent-emerald-500" /> 🎙️ Mark's voice (video)</label>
            </div>

            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 space-y-2">
              <label className="text-xs text-slate-500">Background — describe it, then Generate (AI), or Upload</label>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} className={inp} />
              <div className="flex gap-2">
                <button onClick={generate} disabled={gen} className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-3 py-2 rounded-lg text-sm flex items-center justify-center gap-2">{gen ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {gen ? "Generating…" : "Generate (AI)"}</button>
                <label className="bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2 cursor-pointer"><Upload className="w-4 h-4" /> Upload<input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBg(f); }} /></label>
              </div>
            </div>

            <div><label className="text-xs text-slate-500">Headline {markMode && "(Mark's speech bubble)"}</label><input value={headline} onChange={(e) => setHeadline(e.target.value)} className={inp} /></div>
            <div><label className="text-xs text-slate-500">Subtext</label><input value={sub} onChange={(e) => setSub(e.target.value)} className={inp} /></div>
            <div><label className="text-xs text-slate-500">Button text</label><input value={cta} onChange={(e) => setCta(e.target.value)} className={inp} /></div>
            {markMode && voiceover && <div><label className="text-xs text-slate-500">🎙️ Mark says (voiceover script)</label><textarea value={line} onChange={(e) => setLine(e.target.value)} rows={3} className={inp} /></div>}

            <div className="flex gap-2 pt-1">
              <button onClick={downloadPng} className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-3 py-2.5 rounded-lg text-sm flex items-center justify-center gap-2"><Download className="w-4 h-4" /> Download Image</button>
              <button onClick={downloadVideo} disabled={rec} className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 font-bold px-3 py-2.5 rounded-lg text-sm flex items-center justify-center gap-2">{rec ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />} {rec ? "Recording…" : "Download Video"}</button>
            </div>
            {msg && <div className="text-xs text-slate-300">{msg}</div>}
            <p className="text-[11px] text-slate-600">Video length follows Mark's voiceover. Keep the script ~8–15 seconds. Best in Chrome (records .mp4). Don&apos;t switch tabs while it records.</p>
          </div>

          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 flex items-center justify-center relative">
            {!bg && <div className="absolute text-slate-600 text-sm flex items-center gap-2"><ImageIcon className="w-4 h-4" /> Generate or upload a background</div>}
            <canvas ref={canvasRef} className="max-h-[70vh] max-w-full rounded-lg shadow-lg" style={{ aspectRatio: `${FORMATS[fmt].w}/${FORMATS[fmt].h}` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

// Fetti Creative Studio — in-CRM ad builder with MARK as spokesperson + the
// performance levers that actually drive attention & retention on Meta:
//  • a scroll-stopping HOOK that flashes big in the first ~1.8s, then settles
//  • burned-in CAPTIONS synced to Mark's voiceover (85% watch muted)
//  • 9:16 default (Reels/Stories), fast zoom, Mark talking-bob
//  • 3 hook options per template to A/B test
// Exports a branded PNG or an animated MP4/webm (canvas + MediaRecorder + WebAudio
// voiceover). NMLS #2267023 + Equal Housing baked into every export.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, Download, Video, Upload, Image as ImageIcon } from "lucide-react";
import { withMarkSignoff } from "@/lib/markPersona";

const FORMATS: Record<string, { w: number; h: number; label: string; gen: string }> = {
  story: { w: 1080, h: 1920, label: "Reel / Story 9:16", gen: "1024x1536" },
  portrait: { w: 1080, h: 1350, label: "Portrait 4:5", gen: "1024x1536" },
  square: { w: 1080, h: 1080, label: "Square 1:1", gen: "1024x1024" },
};

const TEMPLATES = [
  { key: "DSCR Purchase", headline: "DSCR Loans", sub: "Qualify on the rental income — not your tax returns.", cta: "Apply in 2 min",
    hooks: ["No tax returns needed.", "Buy rentals on the rent.", "Qualify on the property."],
    line: "I'm Mark, with Fetti. Own a rental — or ready to? We qualify you on the property's income, not your tax returns. Close in your L-L-C, in any state. Two minutes to start, and the capital is ready when you are. Fetti. We do money.",
    prompt: "attractive modern American single-family rental home, manicured lawn, bright daylight, blue sky" },
  { key: "DSCR Cash-Out", headline: "Cash Out Your Rentals", sub: "Refinance on the property's cash flow. Close in your LLC.", cta: "Get my options",
    hooks: ["Pull cash from your rentals.", "Your equity = your next deal.", "Cash out, no tax returns."],
    line: "Mark here. You have equity sitting in your rentals — let's put it to work. We qualify on the property's cash flow, not your paperwork. Pull your cash out, fund the next deal. Start below. Fetti. We do money.",
    prompt: "beautiful suburban investment property exterior at golden hour" },
  { key: "Fix & Flip", headline: "Fund Your Flip", sub: "Purchase + rehab, fast close, interest-only.", cta: "Get funded",
    hooks: ["Fund your next flip.", "Purchase + rehab, covered.", "Close fast on flips."],
    line: "Mark here. Found a flip? We fund the purchase and the rehab, close fast, and keep you interest-only through the project. You move quick — we move quicker. Let's fund it. Fetti. We do money.",
    prompt: "house mid-renovation with fresh exterior remodel, bright" },
  { key: "Refinance", headline: "Lower Your Payment", sub: "Cut your rate or tap your equity — we shop the whole market.", cta: "See my rate",
    hooks: ["Lower your payment.", "One bank isn't your best deal.", "Tap your home's equity."],
    line: "I'm Mark, with Fetti. Looking for a lower payment, or cash from your home? We're a lender and a broker — so we fund it ourselves, or shop the whole market for your best terms. Never one bank's menu. See your numbers in two minutes. Fetti. We do money.",
    prompt: "warm inviting suburban home exterior, lush landscaping, sunny" },
  { key: "Bank-Statement", headline: "Self-Employed? No Problem.", sub: "Qualify on bank deposits, not tax returns.", cta: "Apply now",
    hooks: ["Self-employed? You still qualify.", "No tax returns. Bank statements.", "Your real income counts."],
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
// Split a voiceover script into short caption phrases (~5 words / clause).
function chunkScript(text: string): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" "); const out: string[] = []; let cur: string[] = [];
  for (const w of words) { cur.push(w); const end = /[.!?,]$/.test(w); if (cur.length >= 5 || (end && cur.length >= 3)) { out.push(cur.join(" ")); cur = []; } }
  if (cur.length) out.push(cur.join(" ")); return out;
}

export default function CreativeStudio() {
  const [fmt, setFmt] = useState("story");
  const [headline, setHeadline] = useState(TEMPLATES[0].headline);
  const [sub, setSub] = useState(TEMPLATES[0].sub);
  const [cta, setCta] = useState(TEMPLATES[0].cta);
  const [prompt, setPrompt] = useState(TEMPLATES[0].prompt);
  const [hook, setHook] = useState(TEMPLATES[0].hooks[0]);
  const [hookOpts, setHookOpts] = useState<string[]>(TEMPLATES[0].hooks);
  const [markMode, setMarkMode] = useState(true);
  const [voiceover, setVoiceover] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [line, setLine] = useState(TEMPLATES[0].line);
  const [bg, setBg] = useState<HTMLImageElement | null>(null);
  const [gen, setGen] = useState(false);
  const [rec, setRec] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const embRef = useRef<HTMLImageElement | null>(null);
  const markRef = useRef<HTMLImageElement | null>(null);

  const draw = useCallback((zoom = 1, alpha = 1, markIn = 1, bob = 0, caption = "", hookBig = 0, videoMode = false) => {
    const c = canvasRef.current; if (!c) return;
    const F = FORMATS[fmt]; if (c.width !== F.w) c.width = F.w; if (c.height !== F.h) c.height = F.h;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const W = F.w, H = F.h, s = W / 1080;
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#0f172a"; ctx.fillRect(0, 0, W, H);
    if (bg) { const scale = Math.max(W / bg.width, H / bg.height) * zoom; const dw = bg.width * scale, dh = bg.height * scale; ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh); }
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "rgba(2,6,23,0.55)"); g.addColorStop(0.4, "rgba(2,6,23,0.1)"); g.addColorStop(1, "rgba(2,6,23,0.94)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (embRef.current) ctx.drawImage(embRef.current, 50 * s, 50 * s, 92 * s, 92 * s);

    // HOOK eyebrow (top) — fades in as the big hook fades out
    if (hook) {
      ctx.globalAlpha = 1 - hookBig; ctx.font = `800 ${34 * s}px -apple-system, "Inter", Arial`;
      const tw = ctx.measureText(hook.toUpperCase()).width; roundRect(ctx, 50 * s, 160 * s, tw + 44 * s, 58 * s, 29 * s);
      ctx.fillStyle = "#10b981"; ctx.fill(); ctx.fillStyle = "#04231a"; ctx.fillText(hook.toUpperCase(), 72 * s, 199 * s); ctx.globalAlpha = 1;
    }

    // MARK spokesperson (bottom-right)
    if (markMode && markRef.current) {
      const m = markRef.current; const mh = H * (fmt === "story" ? 0.52 : 0.6); const mw = mh * (m.width / m.height);
      const mx = W - mw - 10 * s; const my = H - mh + (1 - markIn) * mh * 0.5 + bob;
      ctx.globalAlpha = markIn; ctx.drawImage(m, mx, my, mw, mh); ctx.globalAlpha = 1;
    }

    // Speech bubble with headline — only in the static/image layout (not video)
    if (!videoMode && markMode) {
      ctx.font = `800 ${52 * s}px -apple-system, "Inter", Arial`; const bw = Math.min(W * 0.66, 620 * s); const bl = wrap(ctx, headline, bw - 60 * s);
      const bh = bl.length * 60 * s + 50 * s; const bx = 44 * s; const by = 250 * s;
      roundRect(ctx, bx, by, bw, bh, 28 * s); ctx.fillStyle = "rgba(255,255,255,0.96)"; ctx.fill();
      ctx.beginPath(); ctx.moveTo(bx + bw - 60 * s, by + bh); ctx.lineTo(bx + bw - 10 * s, by + bh + 44 * s); ctx.lineTo(bx + bw - 110 * s, by + bh); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#0f172a"; let ty = by + 64 * s; bl.forEach((l) => { ctx.fillText(l, bx + 30 * s, ty); ty += 60 * s; });
    }

    ctx.textBaseline = "alphabetic";
    // bottom copy
    const ctaY = H - 200 * s;
    if (!videoMode) { // static: headline (if no Mark) + sub
      let y = ctaY - 30 * s;
      if (sub) { ctx.fillStyle = "#e2e8f0"; ctx.font = `600 ${38 * s}px -apple-system, "Inter", Arial`; const sl = wrap(ctx, sub, (markMode ? W * 0.6 : W - 100 * s)); y -= sl.length * 48 * s; sl.forEach((l, i) => ctx.fillText(l, 50 * s, y + i * 48 * s)); }
    }
    // CAPTIONS (video): big centered phrase, synced to the voiceover
    if (videoMode && captions && caption) {
      ctx.textAlign = "center"; ctx.font = `800 ${52 * s}px -apple-system, "Inter", Arial`;
      const cl = wrap(ctx, caption, W * 0.82); const lh = 64 * s; const blockH = cl.length * lh;
      const cy = H * 0.66 - blockH / 2;
      const bw = W * 0.86; roundRect(ctx, (W - bw) / 2, cy - 12 * s, bw, blockH + 36 * s, 20 * s); ctx.fillStyle = "rgba(2,6,23,0.6)"; ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.lineWidth = 8 * s; ctx.strokeStyle = "rgba(0,0,0,0.55)";
      cl.forEach((l, i) => { const yy = cy + 46 * s + i * lh; ctx.strokeText(l, W / 2, yy); ctx.fillText(l, W / 2, yy); });
      ctx.textAlign = "left";
    }
    // CTA pill
    if (cta) {
      ctx.font = `700 ${36 * s}px -apple-system, "Inter", Arial`; const label = cta + "   →"; const tw = ctx.measureText(label).width;
      const pw = tw + 60 * s, ph = 80 * s, px = 50 * s;
      roundRect(ctx, px, ctaY, pw, ph, 40 * s); ctx.fillStyle = "#10b981"; ctx.fill(); ctx.fillStyle = "#04231a"; ctx.fillText(label, px + 30 * s, ctaY + 53 * s);
    }
    // BIG HOOK overlay (first ~1.8s of video) — the scroll-stopper
    if (hookBig > 0.01) {
      ctx.globalAlpha = Math.min(hookBig * 1.3, 1); ctx.textAlign = "center"; ctx.fillStyle = "#fff";
      ctx.font = `900 ${96 * s}px -apple-system, "Inter", Arial`; const hl = wrap(ctx, hook, W * 0.86); const lh = 104 * s; const startY = H * 0.42 - (hl.length - 1) * lh / 2;
      ctx.lineWidth = 12 * s; ctx.strokeStyle = "rgba(0,0,0,0.5)";
      hl.forEach((l, i) => { ctx.strokeText(l, W / 2, startY + i * lh); ctx.fillText(l, W / 2, startY + i * lh); });
      ctx.textAlign = "left"; ctx.globalAlpha = 1;
    }
    // compliance footer
    ctx.globalAlpha = 0.85; ctx.fillStyle = "#cbd5e1"; ctx.font = `400 ${17 * s}px Arial`;
    ctx.fillText("Fetti Financial Services LLC · NMLS #2267023 · Equal Housing Opportunity", 50 * s, H - 40 * s); ctx.globalAlpha = 1;
  }, [fmt, bg, headline, sub, cta, hook, markMode, captions]);

  useEffect(() => { const i = new Image(); i.src = "/fetti-emblem.png"; i.onload = () => { embRef.current = i; draw(); }; }, [draw]);
  useEffect(() => { const i = new Image(); i.src = "/cedi.png"; i.onload = () => { markRef.current = i; draw(); }; }, [draw]);
  useEffect(() => { draw(); }, [draw]);

  function applyTemplate(t: typeof TEMPLATES[number]) { setHeadline(t.headline); setSub(t.sub); setCta(t.cta); setPrompt(t.prompt); setLine(t.line); setHookOpts(t.hooks); setHook(t.hooks[0]); }

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
      const spoken = withMarkSignoff(line); const caps = chunkScript(spoken);
      const vstream = c.captureStream(30); const tracks: MediaStreamTrack[] = [...vstream.getVideoTracks()]; let durMs = 9000;
      if (markMode && voiceover && line.trim()) {
        setMsg("🎙️ Generating Mark's voiceover…");
        const tr = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: spoken }) });
        if (tr.ok) {
          const blob = await tr.blob(); const url = URL.createObjectURL(blob); audioEl = new Audio(url); audioEl.crossOrigin = "anonymous";
          await new Promise<void>((res) => { audioEl!.onloadedmetadata = () => res(); audioEl!.onerror = () => res(); setTimeout(res, 4000); });
          if (audioEl.duration && isFinite(audioEl.duration)) durMs = Math.max(4000, Math.min(audioEl.duration * 1000 + 500, 30000));
          ac = new AudioContext(); const srcNode = ac.createMediaElementSource(audioEl); const dest = ac.createMediaStreamDestination();
          srcNode.connect(dest); srcNode.connect(ac.destination); tracks.push(...dest.stream.getAudioTracks());
        } else setMsg("⚠️ Voiceover failed — recording without audio.");
      }
      const mime = pickMime(); const recr = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      const chunks: BlobPart[] = []; recr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recr.onstop = () => {
        const ext = mime.includes("mp4") ? "mp4" : "webm"; const blob = new Blob(chunks, { type: mime.split(";")[0] });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `fetti-mark-ad-${fmt}.${ext}`; a.click(); URL.revokeObjectURL(a.href);
        try { ac?.close(); } catch { /* */ } setRec(false);
        setMsg(ext === "webm" ? "✓ Saved (.webm). Meta prefers .mp4 — use Chrome for that. The PNG always works too." : "✓ Mark's video saved (.mp4) — captions + voice, ready for Meta.");
      };
      setMsg("🎬 Recording Mark…"); recr.start(); if (audioEl) { try { await audioEl.play(); } catch { /* */ } }
      const t0 = performance.now();
      const loop = (t: number) => {
        const el = (t - t0) / 1000; const e = Math.min((t - t0) / durMs, 1);
        const hookBig = Math.max(0, 1 - el / 1.8); const markIn = Math.min(el / 0.5, 1); const bob = Math.sin(el * 5) * 5 * s_();
        const ci = Math.min(caps.length - 1, Math.floor(e * caps.length));
        draw(1 + 0.06 * e, 1, markIn, bob, caps[ci] || "", hookBig, true);
        if (e < 1) requestAnimationFrame(loop); else setTimeout(() => recr.state !== "inactive" && recr.stop(), 200);
      };
      function s_() { const c2 = canvasRef.current; return c2 ? c2.width / 1080 : 1; }
      requestAnimationFrame(loop);
    } catch { try { ac?.close(); } catch { /* */ } setRec(false); setMsg("⚠️ Your browser blocked recording. Use the PNG, or try Chrome."); }
  }

  const inp = "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none";

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Sparkles className="w-6 h-6 text-emerald-400" /> Creative Studio</h1>
        <p className="text-slate-400 text-sm mt-1">Mark-fronted ad images & videos built for attention: scroll-stopping hook, captions synced to his voice, 9:16. NMLS disclosure baked in.</p>

        <div className="flex flex-wrap gap-2 mt-4">{TEMPLATES.map((t) => (<button key={t.key} onClick={() => applyTemplate(t)} className="text-xs px-3 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200">{t.key}</button>))}</div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-5">
          <div className="space-y-4">
            <div><label className="text-xs text-slate-500">Format</label><div className="flex gap-2 mt-1">{Object.entries(FORMATS).map(([k, v]) => (<button key={k} onClick={() => setFmt(k)} className={`text-xs px-3 py-1.5 rounded-lg ${fmt === k ? "bg-emerald-500 text-slate-950 font-semibold" : "bg-slate-800 text-slate-300"}`}>{v.label}</button>))}</div></div>

            <div className="bg-slate-900/40 border border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={markMode} onChange={(e) => setMarkMode(e.target.checked)} className="accent-emerald-500" /> 🦉 Mark</label>
              <label className={`flex items-center gap-2 text-sm cursor-pointer ${markMode ? "" : "opacity-40"}`}><input type="checkbox" disabled={!markMode} checked={voiceover} onChange={(e) => setVoiceover(e.target.checked)} className="accent-emerald-500" /> 🎙️ Voice</label>
              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} className="accent-emerald-500" /> 💬 Captions</label>
            </div>

            <div>
              <label className="text-xs text-slate-500">Hook (first frame — test all 3)</label>
              <div className="flex flex-wrap gap-2 mt-1">{hookOpts.map((h) => (<button key={h} onClick={() => setHook(h)} className={`text-xs px-3 py-1.5 rounded-lg ${hook === h ? "bg-emerald-500 text-slate-950 font-semibold" : "bg-slate-800 text-slate-300"}`}>{h}</button>))}</div>
              <input value={hook} onChange={(e) => setHook(e.target.value)} className={inp + " mt-2"} />
            </div>

            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 space-y-2">
              <label className="text-xs text-slate-500">Background — describe it, then Generate (AI), or Upload</label>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} className={inp} />
              <div className="flex gap-2">
                <button onClick={generate} disabled={gen} className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-3 py-2 rounded-lg text-sm flex items-center justify-center gap-2">{gen ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {gen ? "Generating…" : "Generate (AI)"}</button>
                <label className="bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2 cursor-pointer"><Upload className="w-4 h-4" /> Upload<input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBg(f); }} /></label>
              </div>
            </div>

            <div><label className="text-xs text-slate-500">Headline {markMode && "(speech bubble)"}</label><input value={headline} onChange={(e) => setHeadline(e.target.value)} className={inp} /></div>
            <div><label className="text-xs text-slate-500">Subtext (image only)</label><input value={sub} onChange={(e) => setSub(e.target.value)} className={inp} /></div>
            <div><label className="text-xs text-slate-500">Button</label><input value={cta} onChange={(e) => setCta(e.target.value)} className={inp} /></div>
            {markMode && voiceover && <div><label className="text-xs text-slate-500">🎙️ Mark says (voiceover + captions)</label><textarea value={line} onChange={(e) => setLine(e.target.value)} rows={3} className={inp} /></div>}

            <div className="flex gap-2 pt-1">
              <button onClick={downloadPng} className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-3 py-2.5 rounded-lg text-sm flex items-center justify-center gap-2"><Download className="w-4 h-4" /> Image</button>
              <button onClick={downloadVideo} disabled={rec} className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 font-bold px-3 py-2.5 rounded-lg text-sm flex items-center justify-center gap-2">{rec ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />} {rec ? "Recording…" : "Video"}</button>
            </div>
            {msg && <div className="text-xs text-slate-300">{msg}</div>}
            <p className="text-[11px] text-slate-600">Hook flashes first ~1.8s, captions sync to Mark's voice, clip length follows the voiceover. Best in Chrome (records .mp4). Don&apos;t switch tabs while recording.</p>
          </div>

          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 flex items-center justify-center relative">
            {!bg && <div className="absolute text-slate-600 text-sm flex items-center gap-2"><ImageIcon className="w-4 h-4" /> Generate or upload a background</div>}
            <canvas ref={canvasRef} className="max-h-[72vh] max-w-full rounded-lg shadow-lg" style={{ aspectRatio: `${FORMATS[fmt].w}/${FORMATS[fmt].h}` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

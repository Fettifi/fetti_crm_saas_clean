"use client";

// Fetti Creative Studio — in-CRM AI video ad engine with MARK as spokesperson +
// the performance levers that actually drive attention & retention on Meta:
//  • a scroll-stopping HOOK that flashes big in the first ~1.8s, then settles
//  • burned-in CAPTIONS synced to Mark's voiceover (85% watch muted)
//  • 9:16 default (Reels/Stories), fast zoom, Mark talking-bob
//  • 3 hook options per template to A/B test
//  • BATCH mode: one click renders N finished Mark video ads (fresh AI scripts →
//    AI background → Mark voiceover → captioned 9:16 MP4), ready to A/B on Meta.
// Exports a branded PNG or an animated MP4/webm (canvas + MediaRecorder + WebAudio
// voiceover). NMLS #2267023 + Equal Housing baked into every export.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, Download, Video, Upload, Image as ImageIcon, Film } from "lucide-react";
import { withMarkSignoff, MARK_VOICE_ID } from "@/lib/markPersona";

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
  { key: "Fix & Flip", headline: "Fund Your Flip", sub: "Up to 100% of the deal — purchase + rehab — for the right project. Fast close.", cta: "Get funded",
    hooks: ["Fund your next flip.", "100% of the deal — purchase + rehab.", "Close fast on flips."],
    line: "Mark here. Found a flip? Under the right circumstances we can fund a hundred percent of the deal — purchase and rehab — close fast, and keep you interest-only through the project. You move quick, we move quicker. Let's fund it. Fetti. We do money.",
    prompt: "house mid-renovation with fresh exterior remodel, bright" },
  { key: "Refinance", headline: "Lower Your Payment", sub: "Cut your rate or tap your equity — we get it funded.", cta: "See my rate",
    hooks: ["Lower your payment.", "The loan your bank won't do.", "Tap your home's equity."],
    line: "I'm Mark, with Fetti. Looking for a lower payment, or cash from your home? We're a nonbank lender — we get it funded, including the refinances banks turn down. See your numbers in two minutes. Fetti. We do money.",
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
function slug(s: string): string { return (s || "ad").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "ad"; }

// ── One layout, used by the live preview, the single export, and the batch ──
type Scene = {
  bg: HTMLImageElement | null; emblem: HTMLImageElement | null; mark: HTMLImageElement | null;
  headline: string; sub: string; cta: string; hook: string; line: string;
  markMode: boolean; captions: boolean; voiceover: boolean;
};
type Anim = { zoom?: number; markIn?: number; bob?: number; caption?: string; hookBig?: number; videoMode?: boolean };

function drawScene(c: HTMLCanvasElement, F: { w: number; h: number }, scene: Scene, anim: Anim = {}) {
  if (c.width !== F.w) c.width = F.w; if (c.height !== F.h) c.height = F.h;
  const ctx = c.getContext("2d"); if (!ctx) return;
  const { bg, emblem, mark, headline, sub, cta, hook, markMode, captions } = scene;
  const { zoom = 1, markIn = 1, bob = 0, caption = "", hookBig = 0, videoMode = false } = anim;
  const W = F.w, H = F.h, s = W / 1080;
  const tall = H / W > 1.6; // story (9:16) gets a slightly smaller Mark than 4:5 / 1:1
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#0f172a"; ctx.fillRect(0, 0, W, H);
  if (bg) { const scale = Math.max(W / bg.width, H / bg.height) * zoom; const dw = bg.width * scale, dh = bg.height * scale; ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh); }
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "rgba(2,6,23,0.55)"); g.addColorStop(0.4, "rgba(2,6,23,0.1)"); g.addColorStop(1, "rgba(2,6,23,0.94)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (emblem) ctx.drawImage(emblem, 50 * s, 50 * s, 92 * s, 92 * s);

  // HOOK eyebrow (top) — fades in as the big hook fades out
  if (hook) {
    ctx.globalAlpha = 1 - hookBig; ctx.font = `800 ${34 * s}px -apple-system, "Inter", Arial`;
    const tw = ctx.measureText(hook.toUpperCase()).width; roundRect(ctx, 50 * s, 160 * s, tw + 44 * s, 58 * s, 29 * s);
    ctx.fillStyle = "#10b981"; ctx.fill(); ctx.fillStyle = "#04231a"; ctx.fillText(hook.toUpperCase(), 72 * s, 199 * s); ctx.globalAlpha = 1;
  }

  // MARK spokesperson (bottom-right)
  if (markMode && mark) {
    const mh = H * (tall ? 0.52 : 0.6); const mw = mh * (mark.width / mark.height);
    const mx = W - mw - 10 * s; const my = H - mh + (1 - markIn) * mh * 0.5 + bob;
    ctx.globalAlpha = markIn; ctx.drawImage(mark, mx, my, mw, mh); ctx.globalAlpha = 1;
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
  if (!videoMode) { // static: sub
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
  // compliance footer — baked into EVERY frame
  ctx.globalAlpha = 0.85; ctx.fillStyle = "#cbd5e1"; ctx.font = `400 ${17 * s}px Arial`;
  ctx.fillText("Fetti Financial Services LLC · NMLS #2267023 · Equal Housing Opportunity", 50 * s, H - 40 * s); ctx.globalAlpha = 1;
}

// ── Multi-scene ANIMATED production ──────────────────────────────────────────
// A storyboard = ordered cartoon scenes (beats). Each frame composites the current
// beat's AI cartoon scene (Ken Burns) crossfading from the previous, an animated
// Mark (entrance + bob + audio-driven "talk"), kinetic word-by-word captions, a big
// emphasis word, a progress bar, CTA on the final beat, and the compliance footer.
type Storyboard = { title: string; product: string; beats: { kind: string; vo: string; caption: string; bigText?: string; bgPrompt: string }[] };
type ProdFrame = {
  bg: HTMLImageElement | null; prevBg?: HTMLImageElement | null; trans: number; kb: number; drift: number;
  emblem: HTMLImageElement | null; mark: HTMLImageElement | null; markIn: number; bob: number; talk: number;
  caption: string; capReveal: number; bigText?: string; bigIn: number; isCta: boolean; cta: string; progress: number;
  pop?: number; swayT?: number;
};
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number, scale: number, dx: number, dy: number) {
  const sc = Math.max(W / img.width, H / img.height) * scale; const dw = img.width * sc, dh = img.height * sc;
  ctx.drawImage(img, (W - dw) / 2 + dx, (H - dh) / 2 + dy, dw, dh);
}
function drawProductionFrame(c: HTMLCanvasElement, F: { w: number; h: number }, st: ProdFrame) {
  if (c.width !== F.w) c.width = F.w; if (c.height !== F.h) c.height = F.h;
  const ctx = c.getContext("2d"); if (!ctx) return;
  const W = F.w, H = F.h, s = W / 1080, tall = H / W > 1.6;
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#0f172a"; ctx.fillRect(0, 0, W, H);
  const kbScale = 1 + 0.1 * st.kb, dx = st.drift * 36 * s * (st.kb - 0.5);
  if (st.prevBg && st.trans < 1) { ctx.globalAlpha = 1; drawCover(ctx, st.prevBg, W, H, 1.1, -dx, 0); }
  if (st.bg) { ctx.globalAlpha = st.prevBg && st.trans < 1 ? st.trans : 1; drawCover(ctx, st.bg, W, H, kbScale, dx, 0); ctx.globalAlpha = 1; }
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "rgba(2,6,23,0.5)"); g.addColorStop(0.45, "rgba(2,6,23,0.08)"); g.addColorStop(1, "rgba(2,6,23,0.95)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(0, 0, W, 6 * s); ctx.fillStyle = "#10b981"; ctx.fillRect(0, 0, W * Math.min(st.progress, 1), 6 * s);
  if (st.emblem) ctx.drawImage(st.emblem, 50 * s, 40 * s, 84 * s, 84 * s);
  if (st.bigText) {
    const k = st.bigIn, alpha = Math.min(k * 1.4, 1), scl = 0.7 + 0.3 * k;
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(W / 2, H * 0.3); ctx.scale(scl, scl); ctx.textAlign = "center";
    ctx.font = `900 ${92 * s}px -apple-system, "Inter", Arial`; ctx.lineWidth = 14 * s; ctx.strokeStyle = "rgba(2,6,23,0.6)"; ctx.fillStyle = "#fde047";
    wrap(ctx, st.bigText, W * 0.8).forEach((l, i) => { ctx.strokeText(l, 0, i * 104 * s); ctx.fillText(l, 0, i * 104 * s); });
    ctx.restore(); ctx.textAlign = "left";
  }
  if (st.mark) {
    const pop = st.pop || 0;
    const mh = H * (tall ? 0.5 : 0.58) * (1 + 0.03 * st.talk + 0.07 * pop), mw = mh * (st.mark.width / st.mark.height);
    const cx = W - mw / 2 - 6 * s;
    const cy = H - mh / 2 + (1 - st.markIn) * mh * 0.6 + st.bob - (8 * st.talk + 16 * pop) * s;
    const tilt = Math.sin(st.swayT || 0) * 0.04 + pop * 0.05; // gentle sway + emphasis lean
    ctx.save(); ctx.globalAlpha = st.markIn; ctx.translate(cx, cy); ctx.rotate(tilt); ctx.drawImage(st.mark, -mw / 2, -mh / 2, mw, mh); ctx.restore(); ctx.globalAlpha = 1;
  }
  if (st.caption) {
    const words = st.caption.split(" "); const k = Math.max(1, Math.ceil(st.capReveal * words.length)); const shown = words.slice(0, k).join(" ");
    ctx.textAlign = "center"; ctx.font = `800 ${54 * s}px -apple-system, "Inter", Arial`;
    const cl = wrap(ctx, shown, W * 0.84); const lh = 66 * s; const blockH = cl.length * lh; const cy = H * 0.7 - blockH / 2;
    const bw = W * 0.9; roundRect(ctx, (W - bw) / 2, cy - 26 * s, bw, blockH + 30 * s, 22 * s); ctx.fillStyle = "rgba(2,6,23,0.62)"; ctx.fill();
    ctx.fillStyle = "#fff"; ctx.lineWidth = 9 * s; ctx.strokeStyle = "rgba(0,0,0,0.55)";
    cl.forEach((l, i) => { const yy = cy + i * lh; ctx.strokeText(l, W / 2, yy); ctx.fillText(l, W / 2, yy); });
    ctx.textAlign = "left";
  }
  if (st.isCta && st.cta) {
    ctx.textAlign = "center"; ctx.font = `800 ${40 * s}px -apple-system, "Inter", Arial`; const label = st.cta + "   →"; const tw = ctx.measureText(label).width;
    const pw = tw + 70 * s, ph = 92 * s, px = (W - pw) / 2, py = H - 230 * s; roundRect(ctx, px, py, pw, ph, 46 * s); ctx.fillStyle = "#10b981"; ctx.fill();
    ctx.fillStyle = "#04231a"; ctx.fillText(label, W / 2, py + 60 * s); ctx.textAlign = "left";
  }
  ctx.globalAlpha = 0.85; ctx.fillStyle = "#cbd5e1"; ctx.font = `400 ${17 * s}px Arial`;
  ctx.fillText("Fetti Financial Services LLC · NMLS #2267023 · Equal Housing Opportunity", 50 * s, H - 34 * s); ctx.globalAlpha = 1;
}

function pickMime(): string {
  const opts = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=h264", "video/webm;codecs=vp9", "video/webm"];
  for (const o of opts) if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(o)) return o;
  return "video/webm";
}
function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => rej(new Error("img")); im.src = src; });
}

type Batch = { running: boolean; done: number; total: number; label: string };

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
  const [ideas, setIdeas] = useState<any[]>([]);
  const [loadingIdeas, setLoadingIdeas] = useState(false);
  const [batchN, setBatchN] = useState(3);
  const [batch, setBatch] = useState<Batch>({ running: false, done: 0, total: 0, label: "" });
  // Animated multi-scene production
  const [prodTopic, setProdTopic] = useState("");
  const [prodBeats, setProdBeats] = useState(5);
  const [producing, setProducing] = useState(false);
  const [prodStatus, setProdStatus] = useState("");
  const [aivid, setAivid] = useState<{ available: boolean; provider: string | null }>({ available: false, provider: null });
  const [music, setMusic] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const embRef = useRef<HTMLImageElement | null>(null);
  const markRef = useRef<HTMLImageElement | null>(null);

  // Build the current editor scene (for preview + single export).
  const editorScene = useCallback((): Scene => ({
    bg, emblem: embRef.current, mark: markRef.current, headline, sub, cta, hook, line, markMode, captions, voiceover,
  }), [bg, headline, sub, cta, hook, line, markMode, captions, voiceover]);

  const draw = useCallback(() => {
    const c = canvasRef.current; if (!c) return;
    drawScene(c, FORMATS[fmt], editorScene());
  }, [fmt, editorScene]);

  useEffect(() => { const i = new Image(); i.src = "/fetti-emblem.png"; i.onload = () => { embRef.current = i; draw(); }; }, [draw]);
  useEffect(() => { const i = new Image(); i.src = "/mark-golden-owl.png?v=vest"; i.onload = () => { markRef.current = i; draw(); }; }, [draw]);
  useEffect(() => { draw(); }, [draw]);
  // Load the auto-generated (daily-refreshed) idea queue on mount.
  useEffect(() => { (async () => { try { const r = await fetch("/api/studio/ideas"); if (r.ok) { const j = await r.json(); setIdeas(j.concepts || []); } } catch { /* */ } })(); }, []);
  useEffect(() => { (async () => { try { const r = await fetch("/api/studio/aivideo"); if (r.ok) setAivid(await r.json()); } catch { /* */ } })(); }, []);

  function applyTemplate(t: typeof TEMPLATES[number]) { setHeadline(t.headline); setSub(t.sub); setCta(t.cta); setPrompt(t.prompt); setLine(t.line); setHookOpts(t.hooks); setHook(t.hooks[0]); }
  function applyConcept(c: any) {
    if (c.headline) setHeadline(c.headline); if (c.sub) setSub(c.sub); if (c.cta) setCta(c.cta);
    if (c.prompt) setPrompt(c.prompt); if (c.line) setLine(c.line);
    if (Array.isArray(c.hooks) && c.hooks.length) { setHookOpts(c.hooks); setHook(c.hooks[0]); }
  }
  async function autoIdeas() {
    setLoadingIdeas(true);
    try { const r = await fetch("/api/studio/ideas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n: 6 }) }); const j = await r.json(); if (r.ok && j.concepts?.length) setIdeas(j.concepts); }
    catch { /* */ } finally { setLoadingIdeas(false); }
  }

  async function generate() {
    setGen(true); setMsg(null);
    try {
      const r = await fetch("/api/studio/image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, size: FORMATS[fmt].gen }) });
      const j = await r.json(); if (!r.ok) { setMsg("⚠️ " + (j.error || "Generation failed.")); return; }
      const img = new Image(); img.onload = () => setBg(img); img.src = j.dataUrl;
    } catch { setMsg("⚠️ Connection error."); } finally { setGen(false); }
  }
  function uploadBg(file: File) { const url = URL.createObjectURL(file); const img = new Image(); img.onload = () => { setBg(img); URL.revokeObjectURL(url); }; img.src = url; }
  function downloadPng() { draw(); const c = canvasRef.current; if (!c) return; c.toBlob((b) => { if (!b) return; downloadBlob(b, `fetti-ad-${fmt}.png`); }, "image/png"); }

  async function genBgImage(p: string): Promise<HTMLImageElement | null> {
    try {
      const r = await fetch("/api/studio/image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: p, size: FORMATS[fmt].gen }) });
      const j = await r.json(); if (!r.ok || !j.dataUrl) return null;
      return await loadImage(j.dataUrl);
    } catch { return null; }
  }

  // Record one Mark video to a Blob (canvas animation + ElevenLabs Mark voiceover,
  // captions synced, compliance baked in). Used by single export AND the batch.
  function recordOne(scene: Scene, onStatus?: (s: string) => void): Promise<{ blob: Blob; ext: string }> {
    return new Promise(async (resolve, reject) => {
      const c = canvasRef.current; if (!c) { reject(new Error("no canvas")); return; }
      const F = FORMATS[fmt];
      let audioEl: HTMLAudioElement | null = null; let ac: AudioContext | null = null;
      try {
        const spoken = withMarkSignoff(scene.line); const caps = chunkScript(spoken);
        drawScene(c, F, scene, { videoMode: true, markIn: 0, hookBig: 1, caption: caps[0] || "" }); // prime first frame + size
        const vstream = c.captureStream(30); const tracks: MediaStreamTrack[] = [...vstream.getVideoTracks()]; let durMs = 9000;
        if (scene.markMode && scene.voiceover && scene.line.trim()) {
          onStatus?.("🎙️ Generating Mark's voiceover…");
          const tr = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: spoken, voiceId: MARK_VOICE_ID }) });
          if (tr.ok) {
            const blob = await tr.blob(); const url = URL.createObjectURL(blob); audioEl = new Audio(url); audioEl.crossOrigin = "anonymous";
            await new Promise<void>((res) => { audioEl!.onloadedmetadata = () => res(); audioEl!.onerror = () => res(); setTimeout(res, 4000); });
            if (audioEl.duration && isFinite(audioEl.duration)) durMs = Math.max(4000, Math.min(audioEl.duration * 1000 + 500, 30000));
            ac = new AudioContext(); const srcNode = ac.createMediaElementSource(audioEl); const dest = ac.createMediaStreamDestination();
            srcNode.connect(dest); srcNode.connect(ac.destination); tracks.push(...dest.stream.getAudioTracks());
          } else onStatus?.("⚠️ Voiceover failed — recording without audio.");
        }
        const mime = pickMime(); const recr = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 8_000_000 });
        const chunks: BlobPart[] = []; recr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        recr.onstop = () => {
          const ext = mime.includes("mp4") ? "mp4" : "webm"; const blob = new Blob(chunks, { type: mime.split(";")[0] });
          try { ac?.close(); } catch { /* */ }
          resolve({ blob, ext });
        };
        const s = F.w / 1080;
        onStatus?.("🎬 Recording Mark…"); recr.start(); if (audioEl) { try { await audioEl.play(); } catch { /* */ } }
        const t0 = performance.now();
        const loop = (t: number) => {
          const el = (t - t0) / 1000; const e = Math.min((t - t0) / durMs, 1);
          const hookBig = Math.max(0, 1 - el / 1.8); const markIn = Math.min(el / 0.5, 1); const bob = Math.sin(el * 5) * 5 * s;
          const ci = Math.min(caps.length - 1, Math.floor(e * caps.length));
          drawScene(c, F, scene, { zoom: 1 + 0.06 * e, markIn, bob, caption: caps[ci] || "", hookBig, videoMode: true });
          if (e < 1) requestAnimationFrame(loop); else setTimeout(() => recr.state !== "inactive" && recr.stop(), 200);
        };
        requestAnimationFrame(loop);
      } catch (err) { try { ac?.close(); } catch { /* */ } reject(err as Error); }
    });
  }

  // Render a multi-scene ANIMATED short: one Mark voiceover for the whole script,
  // beats timed by line length, each its own cartoon scene with Ken Burns + crossfade,
  // animated Mark (entrance + bob + audio-driven talk), kinetic captions, CTA. → MP4.
  function recordProduction(sb: Storyboard, bgs: (HTMLImageElement | null)[], onStatus?: (s: string) => void): Promise<{ blob: Blob; ext: string }> {
    return new Promise(async (resolve, reject) => {
      const c = canvasRef.current; if (!c) { reject(new Error("no canvas")); return; }
      const F = FORMATS[fmt]; const beats = sb.beats; const ctaLabel = cta || "Apply now";
      let audioEl: HTMLAudioElement | null = null; let ac: AudioContext | null = null;
      try {
        drawProductionFrame(c, F, { bg: bgs[0], trans: 1, kb: 0, drift: -1, emblem: embRef.current, mark: markRef.current, markIn: 0, bob: 0, talk: 0, caption: beats[0].caption, capReveal: 0, bigText: beats[0].bigText, bigIn: 0, isCta: false, cta: ctaLabel, progress: 0 });
        const vstream = c.captureStream(30); const tracks: MediaStreamTrack[] = [...vstream.getVideoTracks()];
        let durMs = beats.length * 5000; let analyser: AnalyserNode | null = null; let adata: any = null;
        onStatus?.("🎙️ Recording Mark's voiceover…");
        const tr = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: beats.map((b) => b.vo).join("  "), voiceId: MARK_VOICE_ID }) });
        if (tr.ok) {
          const blob = await tr.blob(); const url = URL.createObjectURL(blob); audioEl = new Audio(url); audioEl.crossOrigin = "anonymous";
          await new Promise<void>((res) => { audioEl!.onloadedmetadata = () => res(); audioEl!.onerror = () => res(); setTimeout(res, 5000); });
          if (audioEl.duration && isFinite(audioEl.duration)) durMs = Math.max(6000, Math.min(audioEl.duration * 1000 + 400, 75000));
          ac = new AudioContext(); const srcNode = ac.createMediaElementSource(audioEl); const dest = ac.createMediaStreamDestination();
          srcNode.connect(dest); srcNode.connect(ac.destination); tracks.push(...dest.stream.getAudioTracks());
          analyser = ac.createAnalyser(); analyser.fftSize = 256; srcNode.connect(analyser); adata = new Uint8Array(analyser.frequencyBinCount);
          // Subtle music bed (synthesized soft pad) mixed into the RECORDING only — not the live monitor.
          if (music) {
            try {
              const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 820;
              const mg = ac.createGain(); mg.gain.value = 0.045; lp.connect(mg); mg.connect(dest);
              [196.0, 261.63, 329.63].forEach((f) => { const o = ac!.createOscillator(); o.type = "sine"; o.frequency.value = f; const og = ac!.createGain(); og.gain.value = 0.34; o.connect(og); og.connect(lp); o.start(); });
            } catch { /* music is optional */ }
          }
        } else onStatus?.("⚠️ Voiceover failed — recording silent.");
        const weights = beats.map((b) => Math.max(8, b.vo.length)); const wsum = weights.reduce((a, b) => a + b, 0);
        const starts: number[] = []; let accW = 0; for (let i = 0; i < beats.length; i++) { starts.push((accW / wsum) * durMs); accW += weights[i]; }
        const endOf = (i: number) => (i < beats.length - 1 ? starts[i + 1] : durMs);
        const mime = pickMime(); const recr = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 8_000_000 });
        const chunks: BlobPart[] = []; recr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        recr.onstop = () => { const ext = mime.includes("mp4") ? "mp4" : "webm"; const blob = new Blob(chunks, { type: mime.split(";")[0] }); try { ac?.close(); } catch { /* */ } resolve({ blob, ext }); };
        const sc = F.w / 1080;
        onStatus?.("🎬 Animating Mark…"); recr.start(); const t0 = performance.now(); if (audioEl) { try { await audioEl.play(); } catch { /* */ } }
        const loop = (t: number) => {
          const ms = audioEl && !audioEl.paused && audioEl.currentTime > 0 ? audioEl.currentTime * 1000 : t - t0;
          const tt = Math.min(ms, durMs);
          let bi = 0; while (bi < beats.length - 1 && tt >= endOf(bi)) bi++;
          const bstart = starts[bi], blen = Math.max(1, endOf(bi) - bstart), bp = Math.min(1, (tt - bstart) / blen), localEl = (tt - bstart) / 1000;
          let talk = 0; if (analyser && adata) { analyser.getByteFrequencyData(adata); let sum = 0; for (let i = 0; i < adata.length; i++) sum += adata[i]; talk = Math.min(sum / adata.length / 110, 1); }
          const beat = beats[bi];
          drawProductionFrame(c, F, {
            bg: bgs[bi], prevBg: bi > 0 ? bgs[bi - 1] : null, trans: Math.min(localEl / 0.45, 1), kb: bp, drift: bi % 2 ? 1 : -1,
            emblem: embRef.current, mark: markRef.current, markIn: Math.min(tt / 600, 1), bob: Math.sin((tt / 1000) * 5) * 5 * sc, talk,
            caption: beat.caption, capReveal: Math.min(bp / 0.55, 1), bigText: beat.kind !== "cta" ? beat.bigText : undefined, bigIn: Math.min(localEl / 0.4, 1),
            isCta: beat.kind === "cta", cta: ctaLabel, progress: tt / durMs,
            pop: Math.max(0, 1 - localEl / 0.45), swayT: (tt / 1000) * 2,
          });
          if (tt < durMs && (!audioEl || !audioEl.ended)) requestAnimationFrame(loop); else setTimeout(() => recr.state !== "inactive" && recr.stop(), 250);
        };
        requestAnimationFrame(loop);
      } catch (err) { try { ac?.close(); } catch { /* */ } reject(err as Error); }
    });
  }

  async function produceShort() {
    if (rec || batch.running || producing) return;
    setProducing(true); setMsg(null);
    try {
      setProdStatus("✍️ Storyboarding the short…");
      const r = await fetch("/api/studio/storyboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic: prodTopic, beats: prodBeats }) });
      const j = await r.json();
      if (!r.ok || !j.storyboard) { setMsg(j.error || "Couldn't storyboard — check the OpenAI key."); return; }
      const sb: Storyboard = j.storyboard;
      const bgs: (HTMLImageElement | null)[] = [];
      for (let i = 0; i < sb.beats.length; i++) {
        setProdStatus(`🎨 Illustrating scene ${i + 1}/${sb.beats.length}…`);
        bgs.push(await genBgImage(`${sb.beats[i].bgPrompt}, vibrant flat-vector cartoon illustration, bold clean outlines, bright saturated colors, playful, NO text, no words, no logos`));
      }
      const { blob, ext } = await recordProduction(sb, bgs, setProdStatus);
      downloadBlob(blob, `fetti-mark-short-${slug(sb.product || prodTopic || "short")}.${ext}`);
      setMsg(ext === "webm" ? "✓ Animated short saved (.webm — use Chrome for .mp4)." : "✓ Animated Mark short saved (.mp4) — multi-scene, captioned, voiced.");
    } catch (e: any) { setMsg("⚠️ " + (e?.message || "Production failed. Try Chrome.")); } finally { setProducing(false); setProdStatus(""); }
  }

  async function tryAiVideo() {
    setMsg(null);
    try {
      const r = await fetch("/api/studio/aivideo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: `Bring this cartoon scene to life: ${prodTopic || headline}. Gentle lively motion, the golden-owl character gestures naturally.` }) });
      const j = await r.json();
      setMsg(j.error || (j.status === "queued" ? "AI video queued with your provider — result polling will finish once your key is confirmed." : "AI video unavailable."));
    } catch { setMsg("⚠️ AI video request failed."); }
  }

  async function downloadVideo() {
    setRec(true); setMsg(null);
    try {
      const { blob, ext } = await recordOne(editorScene(), setMsg);
      downloadBlob(blob, `fetti-mark-ad-${fmt}.${ext}`);
      setMsg(ext === "webm" ? "✓ Saved (.webm). Meta prefers .mp4 — use Chrome for that. The PNG always works too." : "✓ Mark's video saved (.mp4) — captions + voice, ready for Meta.");
    } catch { setMsg("⚠️ Your browser blocked recording. Use the PNG, or try Chrome."); } finally { setRec(false); }
  }

  // BATCH: render N finished Mark video ads back-to-back. Fresh AI concepts (if the
  // idea queue is short) → AI background per variant → Mark voiceover → captioned
  // 9:16 MP4 → download. Sequential (one canvas/recorder at a time). A/B-ready.
  async function renderBatch() {
    if (rec || batch.running) return;
    setMsg(null);
    const n = Math.min(Math.max(batchN, 1), 8);
    let cs: any[] = ideas;
    if (cs.length < n) {
      setBatch({ running: true, done: 0, total: n, label: "Writing fresh Mark scripts…" });
      try {
        const r = await fetch("/api/studio/ideas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n: Math.max(n, 6) }) });
        const j = await r.json(); if (r.ok && j.concepts?.length) { cs = j.concepts; setIdeas(cs); }
      } catch { /* */ }
    }
    cs = (cs || []).slice(0, n);
    if (!cs.length) { setMsg("⚠️ Couldn't generate concepts — check OpenAI key, then retry."); setBatch({ running: false, done: 0, total: 0, label: "" }); return; }
    setBatch({ running: true, done: 0, total: cs.length, label: "" });
    let saved = 0; let lastExt = "mp4";
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      const head = c.headline || `Variant ${i + 1}`;
      setBatch({ running: true, done: i, total: cs.length, label: `Variant ${i + 1}/${cs.length}: ${head} — generating background…` });
      const bgImg = await genBgImage(c.prompt || prompt);
      const scene: Scene = {
        bg: bgImg, emblem: embRef.current, mark: markRef.current,
        headline: head, sub: c.sub || "", cta: c.cta || "Apply now",
        hook: (Array.isArray(c.hooks) && c.hooks[0]) || head, line: c.line || line,
        markMode: true, captions: true, voiceover: true,
      };
      try {
        const { blob, ext } = await recordOne(scene, (st) => setBatch((b) => ({ ...b, label: `Variant ${i + 1}/${cs.length}: ${head} — ${st}` })));
        lastExt = ext; downloadBlob(blob, `fetti-mark-${slug(c.product || head)}-${i + 1}.${ext}`); saved++;
      } catch { /* skip a failed variant, keep going */ }
      setBatch((b) => ({ ...b, done: i + 1 }));
    }
    setBatch({ running: false, done: cs.length, total: cs.length, label: "" });
    setMsg(saved
      ? `✓ Batch done — ${saved} Mark video ad${saved === 1 ? "" : "s"} saved${lastExt === "webm" ? " (.webm — use Chrome for .mp4)" : " (.mp4)"}. A/B test them on Meta.`
      : "⚠️ Batch finished but nothing saved — your browser may have blocked recording. Try Chrome.");
  }

  const inp = "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none";
  const working = rec || batch.running;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Sparkles className="w-6 h-6 text-emerald-400" /> Creative Studio</h1>
        <p className="text-slate-400 text-sm mt-1">Mark-narrated informational short videos: a curiosity hook, one useful thing taught in plain English, captions synced to his voice, 9:16. Company NMLS #2267023 disclosure baked into every export.</p>

        <div className="flex flex-wrap gap-2 mt-4">{TEMPLATES.map((t) => (<button key={t.key} onClick={() => applyTemplate(t)} className="text-xs px-3 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200">{t.key}</button>))}</div>

        {/* Ad Factory — auto-generated fresh ideas (daily cron + on-demand) */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 mt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold flex items-center gap-2">🤖 Ad Factory <span className="text-xs text-slate-500 font-normal hidden sm:inline">— fresh AI ad ideas in Mark&apos;s voice, auto-refreshed daily</span></div>
            <button onClick={autoIdeas} disabled={loadingIdeas} className="text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5">{loadingIdeas ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}{loadingIdeas ? "Thinking…" : "Generate ideas"}</button>
          </div>
          {ideas.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">
              {ideas.map((c, i) => (
                <button key={i} onClick={() => applyConcept(c)} className="text-left bg-slate-900 border border-slate-800 hover:border-emerald-500/60 rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-wide text-emerald-400">{c.product}</div>
                  <div className="text-sm font-semibold mt-0.5 truncate">{(c.hooks && c.hooks[0]) || c.headline}</div>
                  <div className="text-xs text-slate-500 mt-1 h-8 overflow-hidden">{(c.line || "").slice(0, 95)}…</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-600 mt-2">Click <b>Generate ideas</b> for a fresh batch (they also auto-refresh daily). Tap any idea to load its hooks, script &amp; copy into the editor — then Generate the image and export.</div>
          )}
        </div>

        {/* Batch Engine — one click renders N finished Mark video ads for A/B testing */}
        <div className="bg-gradient-to-r from-emerald-950/50 to-slate-900/40 border border-emerald-800/40 rounded-xl p-4 mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold flex items-center gap-2"><Film className="w-4 h-4 text-emerald-400" /> Batch Engine
              <span className="text-xs text-slate-500 font-normal hidden sm:inline">— one click → multiple finished Mark video ads (script → voice → captioned 9:16), A/B-ready</span></div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400">Variants</label>
              <input type="number" min={1} max={8} value={batchN} onChange={(e) => setBatchN(Math.min(8, Math.max(1, Number(e.target.value) || 1)))} disabled={working} className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white disabled:opacity-50" />
              <button onClick={renderBatch} disabled={working} className="text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5">{batch.running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Film className="w-3.5 h-3.5" />}{batch.running ? "Rendering…" : `Make ${batchN} video ad${batchN === 1 ? "" : "s"}`}</button>
            </div>
          </div>
          {batch.running ? (
            <div className="mt-3">
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${batch.total ? (batch.done / batch.total) * 100 : 5}%` }} /></div>
              <div className="text-xs text-emerald-300/80 mt-2">{batch.label || `Rendered ${batch.done}/${batch.total}…`} <span className="text-slate-500">— keep this tab focused; each clip records in real time.</span></div>
            </div>
          ) : (
            <div className="text-xs text-slate-600 mt-2">Uses your Ad Factory ideas (or writes fresh ones), then auto-generates a background, Mark&apos;s voiceover &amp; captions for each — and downloads every finished <b>9:16 .mp4</b>. Toggles below are forced on for the batch. Records in real time, so {batchN} clips take a few minutes.</div>
          )}
        </div>

        {/* Animated Short Studio — multi-scene cartoon production with Mark */}
        <div className="bg-gradient-to-r from-indigo-950/50 to-slate-900/40 border border-indigo-800/40 rounded-xl p-4 mt-4">
          <div className="text-sm font-semibold flex items-center gap-2"><Film className="w-4 h-4 text-indigo-300" /> Animated Short Studio
            <span className="text-xs text-slate-500 font-normal hidden sm:inline">— a real multi-scene cartoon production: storyboard → a cartoon scene per beat → animated Mark + kinetic captions → 9:16 .mp4</span></div>
          <div className="flex flex-wrap items-end gap-2 mt-3">
            <div className="flex-1 min-w-[200px]"><label className="text-xs text-slate-500">Topic (optional — leave blank for a fresh pick)</label>
              <input value={prodTopic} onChange={(e) => setProdTopic(e.target.value)} placeholder="e.g. how DSCR loans qualify on the rent" disabled={producing} className={inp} /></div>
            <div><label className="text-xs text-slate-500">Scenes</label>
              <input type="number" min={3} max={7} value={prodBeats} onChange={(e) => setProdBeats(Math.min(7, Math.max(3, Number(e.target.value) || 5)))} disabled={producing} className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-sm text-white disabled:opacity-50" /></div>
            <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer pb-2"><input type="checkbox" checked={music} onChange={(e) => setMusic(e.target.checked)} disabled={producing} className="accent-emerald-500" /> 🎵 Music</label>
            <button onClick={produceShort} disabled={producing || working} className="bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm flex items-center gap-2">{producing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}{producing ? "Producing…" : "Produce animated short"}</button>
            <button onClick={tryAiVideo} disabled={producing} title={aivid.available ? `True AI animation via ${aivid.provider}` : "Add a video API key (FAL_KEY / Runway) to enable true AI animation"} className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${aivid.available ? "bg-fuchsia-600 hover:bg-fuchsia-500 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}><Sparkles className="w-4 h-4" /> {aivid.available ? "AI Video" : "AI Video (add key)"}</button>
          </div>
          {producing
            ? <div className="text-xs text-indigo-300/90 mt-2">{prodStatus || "Working…"} <span className="text-slate-500">— keep this tab focused; it records in real time.</span></div>
            : <div className="text-xs text-slate-600 mt-2">Writes a hook → teach → CTA storyboard, illustrates a unique cartoon scene per beat, then animates Mark (entrance, motion, talks to his voiceover) with scene transitions, Ken-Burns motion &amp; word-by-word captions. Uses the Format + Mark voice below. Best in Chrome (.mp4).</div>}
        </div>

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
              <button onClick={downloadPng} disabled={working} className="flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold px-3 py-2.5 rounded-lg text-sm flex items-center justify-center gap-2"><Download className="w-4 h-4" /> Image</button>
              <button onClick={downloadVideo} disabled={working} className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 font-bold px-3 py-2.5 rounded-lg text-sm flex items-center justify-center gap-2">{rec ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />} {rec ? "Recording…" : "Video"}</button>
            </div>
            {msg && <div className="text-xs text-slate-300">{msg}</div>}
            <p className="text-[11px] text-slate-600">Hook flashes first ~1.8s, captions sync to Mark's voice, clip length follows the voiceover. Best in Chrome (records .mp4). Don&apos;t switch tabs while recording.</p>
          </div>

          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 flex items-center justify-center relative">
            {!bg && !batch.running && <div className="absolute text-slate-600 text-sm flex items-center gap-2"><ImageIcon className="w-4 h-4" /> Generate or upload a background</div>}
            <canvas ref={canvasRef} className="max-h-[72vh] max-w-full rounded-lg shadow-lg" style={{ aspectRatio: `${FORMATS[fmt].w}/${FORMATS[fmt].h}` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

// Public e-signature page: /sign/<recipientToken>. Multi-signer aware — enforces
// signing order, only fills this signer's fields, supports decline-to-sign.
import { use, useEffect, useRef, useState } from "react";
import { Loader2, PenLine, Check, ShieldCheck, Clock, XCircle } from "lucide-react";
import { LICENSING_SHORT } from "@/lib/legal";
import PdfDoc, { EsignField } from "@/components/PdfDoc";

type Meta = {
  title: string; signer_name: string; status: string; envelopeStatus: string;
  signed: boolean; declined: boolean; voided: boolean; yourTurn: boolean;
  waitingFor: string | null; fields: (EsignField & { mine: boolean })[];
};

// Module-level so typing your name doesn't remount the form (was defined inside the
// page → recreated each keystroke → input lost focus / "one character at a time").
function Shell({ meta, children }: { meta: Meta; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900"><div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2"><img src="/fetti-emblem.png" alt="Fetti Financial Services LLC" width={32} height={32} className="w-8 h-8" /><div className="text-emerald-600 font-extrabold">Fetti<span className="text-slate-900"> Financial Services</span></div></div>
      <h1 className="text-2xl font-bold mt-4">{meta.title}</h1>
      <p className="text-slate-500 text-sm mt-1">For: {meta.signer_name}</p>
      {children}
      <p className="text-[11px] text-slate-400 mt-6 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-emerald-500/70" /> Encrypted and private to you and your Fetti loan team.</p>
      <p className="text-[10px] text-slate-400 mt-2">{LICENSING_SHORT}</p>
    </div></div>
  );
}

export default function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState("");
  const [adopted, setAdopted] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(false);

  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/esign/sign/${token}`);
      if (!r.ok) { setNotFound(true); setLoading(false); return; }
      const j: Meta = await r.json();
      setMeta(j); setTyped(j.signer_name || ""); setDone(!!j.signed); setCompleted(j.envelopeStatus === "completed"); setDeclined(!!j.declined); setLoading(false);
    })();
  }, [token]);

  useEffect(() => {
    const c = canvasRef.current; if (!c || mode !== "draw" || adopted) return;
    const ctx = c.getContext("2d")!; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.strokeStyle = "#0f172a";
    let drawing = false;
    const pos = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }; };
    const down = (e: PointerEvent) => { drawing = true; drawn.current = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
    const move = (e: PointerEvent) => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
    const up = () => { drawing = false; };
    c.addEventListener("pointerdown", down); c.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    return () => { c.removeEventListener("pointerdown", down); c.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [mode, adopted]);

  function clearPad() { const c = canvasRef.current; if (c) c.getContext("2d")!.clearRect(0, 0, c.width, c.height); drawn.current = false; }
  function buildPng(): string | null {
    if (mode === "draw") { if (!drawn.current) return null; return canvasRef.current!.toDataURL("image/png"); }
    const name = typed.trim(); if (!name) return null;
    const off = document.createElement("canvas"); off.width = 600; off.height = 200;
    const ctx = off.getContext("2d")!; ctx.fillStyle = "#0f172a";
    ctx.font = "italic 64px 'Brush Script MT','Segoe Script','Snell Roundhand',cursive"; ctx.textBaseline = "middle";
    ctx.fillText(name, 20, 110); return off.toDataURL("image/png");
  }
  function adopt() { setErr(null); const png = buildPng(); if (!png) { setErr(mode === "draw" ? "Draw your signature first." : "Type your name first."); return; } setAdopted(png); }

  async function submit() {
    setErr(null);
    if (!adopted) { setErr("Adopt your signature first."); return; }
    if (!consent) { setErr("Please check the consent box."); return; }
    setSubmitting(true);
    try {
      const r = await fetch(`/api/esign/sign/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signatureDataUrl: adopted, typedName: typed.trim(), consent: true }) });
      const j = await r.json();
      if (r.ok) { setDone(true); setCompleted(!!j.completed); } else setErr(j.error || "Signing failed.");
    } catch { setErr("Connection error."); }
    setSubmitting(false);
  }
  async function decline() {
    const reason = prompt("Decline to sign — optional reason:") ?? "";
    if (reason === null) return;
    setSubmitting(true);
    try { const r = await fetch(`/api/esign/sign/${token}/decline`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }); if (r.ok) setDeclined(true); } catch { /* */ }
    setSubmitting(false);
  }

  if (loading) return <Center><Loader2 className="w-6 h-6 animate-spin text-emerald-600" /></Center>;
  if (notFound || !meta) return <Center><p className="text-slate-500">This signing link is invalid or has expired. Please contact your Fetti specialist.</p></Center>;

  // Shell is now module-level (above) — passing `meta` as a prop.

  if (meta.voided) return <Shell meta={meta}><Box icon={<XCircle className="w-10 h-10 text-red-500 mx-auto" />} title="This document was voided" sub="The sender canceled this envelope. Please contact your Fetti specialist." /></Shell>;
  if (declined || meta.declined) return <Shell meta={meta}><Box icon={<XCircle className="w-10 h-10 text-red-500 mx-auto" />} title="Declined" sub="This document was declined to sign." /></Shell>;
  if (done) return <Shell meta={meta}><div className="mt-6 bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
    <Check className="w-10 h-10 text-emerald-600 mx-auto" />
    <h2 className="text-xl font-bold mt-2">Thank you — you've signed!</h2>
    <p className="text-slate-600 text-sm mt-1">{completed ? "All signers are complete. The signed copy was sent to your Fetti loan team." : "We'll route it to the next signer and notify your loan team when everyone has signed."}</p>
    {completed && <div className="flex items-center justify-center gap-4 mt-4">
      <a href={`/api/esign/sign/${token}/pdf`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-emerald-700 underline">View signed document</a>
      <a href={`/api/esign/sign/${token}/pdf?doc=cert`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-sky-700 underline">Certificate of Completion</a>
    </div>}
  </div></Shell>;
  if (!meta.yourTurn) return <Shell meta={meta}><Box icon={<Clock className="w-10 h-10 text-amber-500 mx-auto" />} title="Almost your turn" sub={meta.waitingFor ? `Waiting on ${meta.waitingFor} to sign first. You'll get a fresh link when it's your turn.` : "This envelope isn't active for you right now."} /></Shell>;

  return (
    <Shell meta={meta}>
      <div className="mt-4 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-slate-600">Review the full document before signing.</p>
        <a href={`/api/esign/sign/${token}/pdf`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-emerald-700 underline whitespace-nowrap">Open / enlarge as PDF ↗</a>
      </div>
      <div className="mt-2 rounded-xl overflow-hidden bg-slate-200 p-3 max-h-[65vh] overflow-y-auto">
        <PdfDoc src={`/api/esign/sign/${token}/pdf`} mode="sign" fields={meta.fields || []} signatureImg={adopted} signerName={meta.signer_name} recipientLabels={{}} />
      </div>
      <div className="mt-5 bg-white border border-slate-300 rounded-2xl p-5">
        <div className="flex items-center gap-2 text-sm font-semibold"><PenLine className="w-4 h-4 text-emerald-600" /> Adopt your signature</div>
        {adopted ? (
          <div className="mt-3 flex items-center gap-3">
            <img src={adopted} alt="Your signature" className="h-14 border border-slate-200 rounded bg-slate-50 px-2" />
            <button onClick={() => { setAdopted(null); clearPad(); }} className="text-xs text-slate-500 hover:text-slate-800 underline">Redo</button>
            <span className="text-xs text-emerald-600">✓ Placed on the document</span>
          </div>
        ) : (
          <>
            <div className="flex gap-2 mt-3">
              <button onClick={() => setMode("draw")} className={`text-xs px-3 py-1.5 rounded-lg ${mode === "draw" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}>Draw</button>
              <button onClick={() => setMode("type")} className={`text-xs px-3 py-1.5 rounded-lg ${mode === "type" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}>Type</button>
            </div>
            {mode === "draw" ? (
              <div className="mt-3"><canvas ref={canvasRef} width={600} height={160} className="w-full h-[160px] border border-dashed border-slate-300 rounded-lg bg-slate-50 touch-none" /><button onClick={clearPad} className="text-xs text-slate-500 hover:text-slate-800 mt-1">Clear</button></div>
            ) : (
              <div className="mt-3"><input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your full legal name" className="w-full border border-slate-300 rounded-lg px-3 py-2" /><div className="mt-2 h-[70px] border border-slate-200 rounded-lg bg-slate-50 flex items-center px-4 text-3xl text-slate-900" style={{ fontFamily: "'Brush Script MT','Segoe Script','Snell Roundhand',cursive", fontStyle: "italic" }}>{typed || "Your signature"}</div></div>
            )}
            <button onClick={adopt} className="mt-3 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg">Adopt &amp; place</button>
          </>
        )}
        <label className="flex items-start gap-2 mt-4 text-sm text-slate-700"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 accent-emerald-600" /><span>I agree to sign this document electronically. My electronic signature is legally binding, equivalent to a handwritten signature under the U.S. ESIGN Act and applicable UETA.</span></label>
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
        <button onClick={submit} disabled={submitting || !adopted} className="mt-4 w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl py-3 flex items-center justify-center gap-2">{submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <PenLine className="w-5 h-5" />} Finish &amp; sign</button>
        <button onClick={decline} disabled={submitting} className="mt-2 w-full text-slate-500 hover:text-red-600 text-xs">Decline to sign</button>
      </div>
    </Shell>
  );
}

function Box({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-6 text-center">{icon}<h2 className="text-xl font-bold mt-2">{title}</h2><p className="text-slate-600 text-sm mt-1">{sub}</p></div>;
}
function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-100 flex items-center justify-center px-6 text-center">{children}</div>;
}

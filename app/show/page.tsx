"use client";

// THE RAY & MARK STUDIO — the Writers' Room. Generate new "We Do Money" episodes in
// canon (5-beat "Owl Always Knew" engine), browse the library, read the script, and
// hear the read (Ray -> Cartesia, Mark -> ElevenLabs). Powered by lib/show/* + /api/show.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, Trash2, Volume2, Copy, Check, Feather } from "lucide-react";

type Line = { speaker: "RAY" | "MARK" | "VO"; text: string; onscreen?: string };
type Episode = {
  id: string; number: number; title: string; logline: string; borrower: string;
  lessonTag: string; signatureMove: string; ledgerCallback: string; newLedgerEntry: string;
  beats: { beat: string; summary: string }[]; lines: Line[]; cta: string; flagship?: boolean; created_at: string;
};
type Concept = { name: string; premise: string };

export default function ShowPage() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [ledger, setLedger] = useState<string[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [brief, setBrief] = useState("");
  const [concept, setConcept] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [voicing, setVoicing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/show");
      if (r.ok) { const j = await r.json(); setEpisodes(j.episodes || []); setLedger(j.ledger || []); setConcepts(j.concepts || []); if (!selId && j.episodes?.length) setSelId(j.episodes[0].id); }
    } catch { /* */ }
  }, [selId]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = episodes.find((e) => e.id === selId) || null;

  async function write() {
    setWriting(true); setErr(null); setMsg(null);
    try {
      const r = await fetch("/api/show", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brief: brief.trim() || undefined, concept: concept || undefined }) });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Couldn't write the episode."); return; }
      setEpisodes((p) => [j.episode, ...p]);
      setSelId(j.episode.id);
      setBrief(""); setConcept(null);
      setMsg(`Episode #${j.episode.number} — "${j.episode.title}" is in the library.`);
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Generation failed"); }
    finally { setWriting(false); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this episode?")) return;
    try { await fetch(`/api/show?id=${id}`, { method: "DELETE" }); setEpisodes((p) => p.filter((e) => e.id !== id)); if (selId === id) setSelId(null); } catch { /* */ }
  }

  async function voice(id: string) {
    setVoicing(true); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/show/${id}/voice`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Voicing failed."); return; }
      const clips = (j.lines || []).filter((l: any) => l.audio).map((l: any) => `data:audio/mpeg;base64,${l.audio}`);
      if (!clips.length) { setErr("No audio came back — check the voice keys."); return; }
      setMsg(`Voiced ${j.voiced} line(s) — playing the read.`);
      playQueue(clips, 0);
    } catch (e) { setErr(e instanceof Error ? e.message : "Voicing failed"); }
    finally { setVoicing(false); }
  }

  function playQueue(clips: string[], i: number) {
    if (i >= clips.length) return;
    const a = new Audio(clips[i]);
    audioRef.current = a;
    a.onended = () => playQueue(clips, i + 1);
    a.play().catch(() => {});
  }

  function copyScript() {
    if (!sel) return;
    const txt = `${sel.title}\n${sel.logline}\n\n` + sel.lines.map((l) => `${l.speaker}: ${l.text}${l.onscreen ? `\n   [on-screen: ${l.onscreen}]` : ""}`).join("\n\n") + `\n\nCTA: ${sel.cta}`;
    navigator.clipboard?.writeText(txt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }

  const chip = (sp: string) =>
    sp === "RAY" ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
    : sp === "MARK" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
    : "bg-slate-500/15 text-slate-300 border-slate-500/30";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-3xl">🦉</span>
          <h1 className="text-2xl md:text-3xl font-bold">Ray &amp; Mark Studio</h1>
        </div>
        <p className="text-slate-400 mb-6 text-sm">The Writers&apos; Room for <span className="text-emerald-400 font-semibold">&ldquo;Ray &amp; Mark — We Do Money&rdquo;</span> — short-form videos where <strong>Ray</strong> (Fetti&apos;s founder, the brains) and <strong>Mark</strong> (the owl co-host) break down a real lending scenario. Mark brings the deal; Ray solves it.</p>

        {err && <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{err}</div>}
        {msg && <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">{msg}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
          {/* LEFT — writers' room + library + ledger */}
          <div className="space-y-5">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center gap-2 mb-3 font-semibold"><Sparkles size={16} className="text-emerald-400" /> Write a new episode</div>
              <textarea
                value={brief} onChange={(e) => setBrief(e.target.value)}
                placeholder="Optional: a deal or lesson to build on (anonymized) — e.g. 'self-employed flipper, write-offs, vacant duplex, cash-out refi'. Leave blank to let the room pick."
                rows={3}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm placeholder:text-slate-500 focus:border-emerald-500 outline-none"
              />
              <div className="mt-2">
                <div className="text-xs text-slate-500 mb-1">Or start from a scenario:</div>
                <div className="flex flex-wrap gap-1.5">
                  {concepts.map((c) => (
                    <button key={c.name} title={c.premise} onClick={() => setConcept(concept === c.name ? null : c.name)}
                      className={`text-[11px] px-2 py-1 rounded-full border transition ${concept === c.name ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-200" : "border-slate-700 text-slate-400 hover:border-slate-500"}`}>
                      {c.name.replace(/\s*\(.*\)/, "")}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={write} disabled={writing}
                className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 text-sm font-semibold">
                {writing ? <><Loader2 size={15} className="animate-spin" /> Writing…</> : <><Feather size={15} /> Write episode</>}
              </button>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="font-semibold mb-2 text-sm">Episode Library ({episodes.length})</div>
              <div className="space-y-1.5 max-h-[40vh] overflow-auto pr-1">
                {episodes.map((e) => (
                  <button key={e.id} onClick={() => setSelId(e.id)}
                    className={`w-full text-left rounded-lg px-3 py-2 border transition ${selId === e.id ? "bg-emerald-500/10 border-emerald-500/40" : "border-slate-800 hover:border-slate-700"}`}>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500 tabular-nums">#{e.number}</span>
                      <span className="font-medium truncate">{e.title}</span>
                      {e.flagship && <span className="text-[10px] px-1.5 rounded bg-amber-500/20 text-amber-300">flagship</span>}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">{e.lessonTag}</div>
                  </button>
                ))}
                {!episodes.length && <div className="text-xs text-slate-500">No episodes yet — write the first one.</div>}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="font-semibold mb-2 text-sm flex items-center gap-2">📁 Case Log</div>
              <p className="text-[11px] text-slate-500 mb-2">The running list of real scenarios Ray &amp; Mark have broken down. Each episode adds one and can call a past one back.</p>
              <ul className="space-y-1">
                {ledger.map((l, i) => <li key={i} className="text-xs text-slate-300 flex gap-2"><span className="text-emerald-500">•</span>{l}</li>)}
              </ul>
            </div>
          </div>

          {/* RIGHT — episode detail */}
          <div>
            {!sel ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-10 text-center text-slate-500">Select an episode, or write a new one.</div>
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="text-xs text-slate-500">Episode #{sel.number}{sel.flagship ? " · flagship" : ""}</div>
                    <h2 className="text-xl font-bold">{sel.title}</h2>
                    <p className="text-sm text-slate-400 mt-1">{sel.logline}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => voice(sel.id)} disabled={voicing} title="Hear the read (Ray + Mark)"
                      className="flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 px-3 py-1.5 text-xs font-medium">
                      {voicing ? <Loader2 size={13} className="animate-spin" /> : <Volume2 size={13} />} Voice
                    </button>
                    <button onClick={copyScript} title="Copy script" className="flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-medium">
                      {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                    </button>
                    <button onClick={() => remove(sel.id)} title="Delete" className="rounded-lg bg-slate-800 hover:bg-red-900/50 px-2.5 py-1.5 text-xs"><Trash2 size={13} /></button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4 text-xs">
                  <Meta label="The scenario" value={sel.borrower} />
                  <Meta label="Takeaway" value={sel.lessonTag} />
                  <Meta label="Fetti solution" value={sel.signatureMove} />
                  <Meta label="Callback to a past case" value={sel.ledgerCallback} />
                </div>

                {/* the script */}
                <div className="space-y-2.5">
                  {sel.lines.map((l, i) => (
                    <div key={i} className="rounded-lg bg-slate-950/60 border border-slate-800 p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${chip(l.speaker)}`}>{l.speaker}</span>
                        {l.speaker === "RAY" && <span className="text-[10px] text-slate-600">Cartesia</span>}
                        {l.speaker === "MARK" && <span className="text-[10px] text-slate-600">ElevenLabs</span>}
                      </div>
                      <p className="text-sm text-slate-100 leading-relaxed">{l.text}</p>
                      {l.onscreen && <p className="text-[11px] text-emerald-400/80 mt-1">▸ on-screen: {l.onscreen}</p>}
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-emerald-500/80 mb-1">Caption / CTA</div>
                  <p className="text-sm text-slate-200">{sel.cta}</p>
                </div>

                {sel.newLedgerEntry && (
                  <div className="mt-3 text-xs text-slate-500">📁 New case logged: <span className="text-slate-300">{sel.newLedgerEntry}</span></div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="rounded-lg bg-slate-950/60 border border-slate-800 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-slate-200">{value}</div>
    </div>
  );
}

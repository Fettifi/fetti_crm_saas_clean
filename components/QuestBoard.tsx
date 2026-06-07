"use client";

// Gamified task list — "Quest Log". Real tasks from /api/tasks (the Enterprise
// Brain's next-best-actions + your own side quests) become quests that pay XP.
// Complete them to gain XP, level up, climb ranks, and keep your daily streak
// alive — with confetti, sound, and unlockable achievements to stay focused.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Flame, Trophy, Swords, Plus, Volume2, VolumeX, Check, Sparkles,
  Star, Zap, Brain, Loader2, Target,
} from "lucide-react";

type Task = { id: string; title: string; source: string; priority?: number };
type Stats = {
  xp: number; level: number; xpInLevel: number; xpToNext: number; levelSize: number; rank: string;
  streak: number; done_today: number; done_week: number; total_done: number; brain_done: number;
};
type Data = { open: Task[]; done: Task[]; stats: Stats };

const xpFor = (source?: string) => 10 + (source === "brain" ? 5 : 0);

export default function QuestBoard() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [newQuest, setNewQuest] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [levelUp, setLevelUp] = useState<{ level: number; rank: string } | null>(null);
  const [muted, setMuted] = useState(false);
  const lastLevel = useRef<number | null>(null);

  useEffect(() => { setMuted(localStorage.getItem("quest_muted") === "1"); }, []);

  const load = useCallback(async () => {
    const r = await fetch("/api/tasks");
    if (r.ok) {
      const j: Data = await r.json();
      setData(j);
      if (lastLevel.current === null) lastLevel.current = j.stats.level;
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // ---- juice: sound + confetti ---------------------------------------------
  function tone(freqs: number[], dur = 0.12) {
    if (muted || typeof window === "undefined") return;
    try {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
      const ac = new Ctx();
      freqs.forEach((f, i) => {
        const o = ac.createOscillator(); const g = ac.createGain();
        o.type = "triangle"; o.frequency.value = f;
        const t0 = ac.currentTime + i * dur;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(ac.destination); o.start(t0); o.stop(t0 + dur);
      });
      setTimeout(() => ac.close(), (freqs.length + 1) * dur * 1000 + 100);
    } catch { /* ignore */ }
  }
  function confetti(big = false) {
    if (typeof document === "undefined") return;
    const c = document.createElement("canvas");
    c.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999";
    c.width = window.innerWidth; c.height = window.innerHeight;
    document.body.appendChild(c);
    const ctx = c.getContext("2d")!;
    const colors = ["#10b981", "#34d399", "#fbbf24", "#60a5fa", "#f472b6", "#a78bfa"];
    const N = big ? 180 : 80;
    const parts = Array.from({ length: N }, (_, i) => ({
      x: c.width / 2, y: c.height / 3,
      vx: (((i * 73) % 100) / 100 - 0.5) * (big ? 18 : 12),
      vy: -6 - (((i * 37) % 100) / 100) * (big ? 14 : 9),
      g: 0.3 + (((i * 17) % 100) / 100) * 0.3,
      s: 4 + ((i * 13) % 6), c: colors[i % colors.length], rot: i, vr: ((i % 7) - 3) * 0.2,
    }));
    let frame = 0;
    const tick = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      parts.forEach((p) => {
        p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 1.6); ctx.restore();
      });
      frame++;
      if (frame < (big ? 120 : 80)) requestAnimationFrame(tick); else c.remove();
    };
    tick();
  }

  function toggleMute() {
    const next = !muted; setMuted(next);
    localStorage.setItem("quest_muted", next ? "1" : "0");
  }

  async function addQuest(e: React.FormEvent) {
    e.preventDefault();
    if (!newQuest.trim()) return;
    const title = newQuest.trim(); setNewQuest("");
    await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
    load();
  }

  async function complete(t: Task) {
    setBusy(t.id);
    const reward = xpFor(t.source);
    // optimistic remove
    setData((d) => d ? { ...d, open: d.open.filter((x) => x.id !== t.id) } : d);
    setToast(`+${reward} XP`);
    confetti(false); tone([660, 880]);
    setTimeout(() => setToast(null), 1200);
    await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, status: "done" }) });
    const r = await fetch("/api/tasks");
    if (r.ok) {
      const j: Data = await r.json();
      setData(j);
      if (lastLevel.current !== null && j.stats.level > lastLevel.current) {
        setLevelUp({ level: j.stats.level, rank: j.stats.rank });
        confetti(true); tone([523, 659, 784, 1047], 0.16);
        setTimeout(() => setLevelUp(null), 2600);
      }
      lastLevel.current = j.stats.level;
    }
    setBusy(null);
  }

  if (loading) return <div className="flex items-center gap-2 text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading your quest log…</div>;
  if (!data) return <div className="text-slate-400">Couldn&apos;t load quests.</div>;

  const { open, done, stats } = data;
  const pct = Math.round((stats.xpInLevel / stats.levelSize) * 100);

  const achievements = [
    { label: "First Blood", emoji: "🩸", got: stats.total_done >= 1, desc: "Complete your first quest" },
    { label: "On Fire", emoji: "🔥", got: stats.streak >= 3, desc: "3-day streak" },
    { label: "Unstoppable", emoji: "⚡", got: stats.streak >= 7, desc: "7-day streak" },
    { label: "Centurion", emoji: "💯", got: stats.xp >= 100, desc: "Earn 100 XP" },
    { label: "Brain's Hand", emoji: "🧠", got: stats.brain_done >= 1, desc: "Clear an AI-suggested quest" },
    { label: "Machine", emoji: "🤖", got: stats.done_today >= 5, desc: "5 quests in one day" },
  ];

  return (
    <div className="relative">
      {/* XP toast */}
      {toast && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[9998] bg-emerald-500 text-slate-950 font-extrabold px-5 py-2 rounded-full shadow-lg animate-bounce">{toast}</div>
      )}
      {/* Level-up banner */}
      {levelUp && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center pointer-events-none">
          <div className="bg-gradient-to-br from-indigo-600 to-emerald-500 text-white px-10 py-7 rounded-3xl shadow-2xl text-center scale-110">
            <div className="text-xs uppercase tracking-[0.3em] opacity-80">Level Up!</div>
            <div className="text-5xl font-black mt-1">LV {levelUp.level}</div>
            <div className="text-lg font-semibold mt-1">🏆 {levelUp.rank}</div>
          </div>
        </div>
      )}

      {/* HERO */}
      <div className="rounded-3xl border border-indigo-500/30 bg-gradient-to-br from-indigo-600/15 via-slate-900/0 to-emerald-600/10 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-emerald-500 flex items-center justify-center shadow-lg">
                <span className="text-3xl font-black text-white">{stats.level}</span>
              </div>
              <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-bold bg-slate-950 border border-slate-700 rounded-full px-2 py-0.5">LVL</span>
            </div>
            <div>
              <div className="text-2xl font-extrabold flex items-center gap-2">{stats.rank} <Star className="w-5 h-5 text-yellow-400" /></div>
              <div className="text-sm text-slate-400">{stats.xp} XP total · {stats.total_done} quests cleared</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className="flex items-center gap-1 text-2xl font-black text-orange-400"><Flame className="w-6 h-6" />{stats.streak}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">day streak</div>
            </div>
            <button onClick={toggleMute} className="text-slate-500 hover:text-white p-2" title={muted ? "Unmute" : "Mute"}>
              {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
          </div>
        </div>
        {/* XP bar */}
        <div className="mt-5">
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <span>Level {stats.level}</span>
            <span>{stats.xpInLevel}/{stats.levelSize} XP · {stats.xpToNext} to level {stats.level + 1}</span>
          </div>
          <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-3 bg-gradient-to-r from-emerald-500 to-indigo-400 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="flex gap-4 mt-4 text-sm">
          <span className="text-slate-300"><Zap className="w-4 h-4 inline text-yellow-400" /> {stats.done_today} cleared today</span>
          <span className="text-slate-300"><Target className="w-4 h-4 inline text-emerald-400" /> {stats.done_week} this week</span>
        </div>
      </div>

      {/* QUESTS */}
      <div className="mt-6">
        <h2 className="text-lg font-bold flex items-center gap-2"><Swords className="w-5 h-5 text-indigo-400" /> Active Quests <span className="text-slate-500 text-sm font-normal">({open.length})</span></h2>

        <form onSubmit={addQuest} className="flex gap-2 mt-3">
          <input value={newQuest} onChange={(e) => setNewQuest(e.target.value)} placeholder="Add a side quest…"
            className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:border-emerald-500 focus:outline-none" />
          <button type="submit" className="bg-slate-800 hover:bg-slate-700 px-4 rounded-xl flex items-center gap-1 text-sm"><Plus className="w-4 h-4" /> Add</button>
        </form>

        <div className="space-y-2.5 mt-4">
          {open.length === 0 && (
            <div className="text-center py-10 text-slate-500">
              <Sparkles className="w-8 h-8 mx-auto mb-2 text-emerald-400/60" />
              All quests cleared. You&apos;re on top of it — add a side quest or let the Brain suggest your next move.
            </div>
          )}
          {open.map((t) => {
            const reward = xpFor(t.source);
            return (
              <div key={t.id} className="group flex items-center justify-between gap-3 bg-slate-900/50 border border-slate-800 hover:border-indigo-500/40 rounded-xl px-4 py-3 transition">
                <div className="flex items-center gap-3 min-w-0">
                  <button onClick={() => complete(t)} disabled={busy === t.id}
                    className="w-9 h-9 rounded-lg border-2 border-slate-600 group-hover:border-emerald-500 flex items-center justify-center shrink-0 transition hover:bg-emerald-500/20">
                    {busy === t.id ? <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> : <Check className="w-4 h-4 text-transparent group-hover:text-emerald-400" />}
                  </button>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{t.title}</div>
                    {t.source === "brain" && <div className="text-[10px] text-indigo-400/80 flex items-center gap-1"><Brain className="w-3 h-3" /> suggested by the Brain</div>}
                  </div>
                </div>
                <span className="shrink-0 text-xs font-bold text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-full px-2.5 py-1">+{reward} XP</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ACHIEVEMENTS */}
      <div className="mt-8">
        <h2 className="text-lg font-bold flex items-center gap-2"><Trophy className="w-5 h-5 text-yellow-400" /> Achievements</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
          {achievements.map((a) => (
            <div key={a.label} className={`rounded-xl border px-4 py-3 ${a.got ? "border-yellow-400/40 bg-yellow-400/5" : "border-slate-800 bg-slate-900/30 opacity-60"}`}>
              <div className="text-2xl">{a.got ? a.emoji : "🔒"}</div>
              <div className="font-semibold text-sm mt-1">{a.label}</div>
              <div className="text-[11px] text-slate-500">{a.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* RECENTLY CLEARED */}
      {done.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm uppercase tracking-wide text-slate-500">Recently cleared</h2>
          <div className="space-y-1.5 mt-2">
            {done.map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-sm text-slate-500">
                <Check className="w-3.5 h-3.5 text-emerald-500/70" /> <span className="line-through">{t.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

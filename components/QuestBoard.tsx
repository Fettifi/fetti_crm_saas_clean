"use client";

// Gamified Quest Log: real tasks (Enterprise Brain + side quests) as XP-paying
// quests, plus multi-step Boss Battles and a team Leaderboard. "Playing as" a
// player credits XP to them so loan officers compete.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Flame, Trophy, Swords, Plus, Volume2, VolumeX, Check, Sparkles, Star, Zap,
  Brain, Loader2, Target, Skull, Crown, ChevronDown, UserPlus, Calendar, CalendarPlus, Link2,
} from "lucide-react";

type Task = { id: string; title: string; source: string; due_at?: string | null; cadence?: string; done_this_period?: boolean };
type Stats = {
  xp: number; level: number; xpInLevel: number; xpToNext: number; levelSize: number; rank: string;
  streak: number; done_today: number; done_week: number; total_done: number; brain_done: number; bosses_won: number;
  player: { id: string; name: string; emoji: string; is_owner: boolean } | null;
};
type Boss = { id: string; title: string; description?: string; emoji: string; objectives: { label: string; done: boolean }[]; reward_xp: number; status: string };
type Player = { id: string; name: string; role?: string; emoji: string; is_owner: boolean; xp: number; level: number; rank: string };

const xpFor = (source?: string) => 10 + (source === "brain" ? 5 : 0);
const gcal = (title: string, dueIso: string) => {
  const start = new Date(dueIso); const end = new Date(start.getTime() + 30 * 60000);
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent("🎯 " + title)}&dates=${f(start)}/${f(end)}&details=${encodeURIComponent("Fetti Quest Log")}`;
};
const fmtDue = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const isOverdue = (iso: string) => new Date(iso).getTime() < Date.now();

export default function QuestBoard() {
  const [open, setOpen] = useState<Task[]>([]);
  const [done, setDone] = useState<Task[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [bosses, setBosses] = useState<Boss[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newQuest, setNewQuest] = useState("");
  const [cadence, setCadence] = useState("once");
  const [dueInput, setDueInput] = useState("");
  const [calUrl, setCalUrl] = useState<string | null>(null);
  const [showCal, setShowCal] = useState(false);
  const [copiedCal, setCopiedCal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [levelUp, setLevelUp] = useState<{ level: number; rank: string } | null>(null);
  const [bossWin, setBossWin] = useState<{ title: string; xp: number } | null>(null);
  const [combo, setCombo] = useState<{ label: string; xp: number } | null>(null);
  const [muted, setMuted] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [tn, setTn] = useState(""); const [tr, setTr] = useState("");
  const lastLevel = useRef<number | null>(null);

  useEffect(() => {
    setMuted(localStorage.getItem("quest_muted") === "1");
    setCurrentId(localStorage.getItem("quest_player"));
  }, []);

  const loadTasks = useCallback(async (pid: string | null) => {
    const r = await fetch(`/api/tasks${pid ? `?player=${pid}` : ""}`);
    if (r.ok) {
      const j = await r.json();
      setOpen(j.open); setDone(j.done); setStats(j.stats);
      if (j.calendar_url) setCalUrl(j.calendar_url);
      if (lastLevel.current === null) lastLevel.current = j.stats.level;
      return j.stats as Stats;
    }
    return null;
  }, []);

  const loadMeta = useCallback(async () => {
    const [pr, br] = await Promise.all([fetch("/api/players"), fetch("/api/bosses")]);
    if (pr.ok) setPlayers((await pr.json()).players);
    if (br.ok) setBosses((await br.json()).active);
  }, []);

  useEffect(() => { (async () => { await Promise.all([loadTasks(currentId), loadMeta()]); setLoading(false); })(); }, [currentId, loadTasks, loadMeta]);

  // ---- juice ----------------------------------------------------------------
  function tone(freqs: number[], dur = 0.12) {
    if (muted || typeof window === "undefined") return;
    try {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext); const ac = new Ctx();
      freqs.forEach((f, i) => {
        const o = ac.createOscillator(); const g = ac.createGain(); o.type = "triangle"; o.frequency.value = f;
        const t0 = ac.currentTime + i * dur;
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(ac.destination); o.start(t0); o.stop(t0 + dur);
      });
      setTimeout(() => ac.close(), (freqs.length + 1) * dur * 1000 + 100);
    } catch { /* ignore */ }
  }
  function confetti(big = false) {
    if (typeof document === "undefined") return;
    const c = document.createElement("canvas");
    c.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999";
    c.width = window.innerWidth; c.height = window.innerHeight; document.body.appendChild(c);
    const ctx = c.getContext("2d")!; const colors = ["#10b981", "#34d399", "#fbbf24", "#60a5fa", "#f472b6", "#a78bfa"];
    const N = big ? 200 : 80;
    const parts = Array.from({ length: N }, (_, i) => ({
      x: c.width / 2, y: c.height / 3, vx: (((i * 73) % 100) / 100 - 0.5) * (big ? 20 : 12),
      vy: -6 - (((i * 37) % 100) / 100) * (big ? 16 : 9), g: 0.3 + (((i * 17) % 100) / 100) * 0.3,
      s: 4 + ((i * 13) % 6), c: colors[i % colors.length], rot: i, vr: ((i % 7) - 3) * 0.2,
    }));
    let frame = 0;
    const tick = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      parts.forEach((p) => { p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 1.6); ctx.restore(); });
      frame++; if (frame < (big ? 140 : 80)) requestAnimationFrame(tick); else c.remove();
    };
    tick();
  }
  function toggleMute() { const n = !muted; setMuted(n); localStorage.setItem("quest_muted", n ? "1" : "0"); }

  function pickPlayer(id: string) {
    setCurrentId(id); localStorage.setItem("quest_player", id); setPickerOpen(false);
    lastLevel.current = null; // re-baseline level for the new player
  }

  async function addQuest(e: React.FormEvent) {
    e.preventDefault(); if (!newQuest.trim()) return;
    const title = newQuest.trim(); const due = dueInput; const cad = cadence; setNewQuest(""); setDueInput("");
    await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, cadence: cad, due_at: due || undefined }) });
    loadTasks(currentId);
  }

  async function setDue(id: string, due: string) {
    setOpen((o) => o.map((t) => t.id === id ? { ...t, due_at: due || null } : t));
    await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, due_at: due || null }) });
    loadTasks(currentId);
  }
  function copyCal() {
    if (!calUrl) return;
    navigator.clipboard?.writeText(calUrl); setCopiedCal(true); setTimeout(() => setCopiedCal(false), 1500);
  }

  async function addTeammate(e: React.FormEvent) {
    e.preventDefault(); if (!tn.trim()) return;
    await fetch("/api/players", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: tn.trim(), role: tr.trim() || "Loan Officer" }) });
    setTn(""); setTr(""); setShowAdd(false); loadMeta();
  }

  async function complete(t: Task) {
    if (t.done_this_period) return;
    setBusy(t.id);
    const once = (t.cadence || "once") === "once";
    if (once) setOpen((o) => o.filter((x) => x.id !== t.id));
    else setOpen((o) => o.map((x) => x.id === t.id ? { ...x, done_this_period: true } : x));
    setToast(`+${xpFor(t.source)} XP`); confetti(false); tone([660, 880]);
    setTimeout(() => setToast(null), 1200);
    const r = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, status: "done", completed_by: currentId }) });
    const j = await r.json().catch(() => null);
    const s = await loadTasks(currentId); loadMeta();
    if (j && j.bonus) {
      setCombo(j.bonus); confetti(true); tone([523, 659, 784, 1047, 1318], 0.14);
      setTimeout(() => setCombo(null), 2600);
    }
    if (s && lastLevel.current !== null && s.level > lastLevel.current) {
      setLevelUp({ level: s.level, rank: s.rank }); confetti(true); tone([523, 659, 784, 1047], 0.16);
      setTimeout(() => setLevelUp(null), 2600);
    }
    if (s) lastLevel.current = s.level;
    setBusy(null);
  }

  async function toggleObjective(boss: Boss, index: number, done: boolean) {
    // optimistic
    setBosses((bs) => bs.map((b) => b.id === boss.id ? { ...b, objectives: b.objectives.map((o, i) => i === index ? { ...o, done } : o) } : b));
    if (done) { tone([700]); }
    const r = await fetch("/api/bosses", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ boss_id: boss.id, index, done, player: currentId }) });
    const j = await r.json();
    if (j.defeated) {
      setBossWin({ title: boss.title, xp: boss.reward_xp }); confetti(true); tone([392, 523, 659, 784, 1047], 0.16);
      setTimeout(() => setBossWin(null), 3000);
    }
    await Promise.all([loadMeta(), loadTasks(currentId)]);
  }

  if (loading) return <div className="flex items-center gap-2 text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading your quest log…</div>;
  if (!stats) return <div className="text-slate-400">Couldn&apos;t load the quest log.</div>;

  const pct = Math.round((stats.xpInLevel / stats.levelSize) * 100);
  const me = stats.player;
  const groups = [
    { label: "Daily Goals", emoji: "🌅", items: open.filter((t) => t.cadence === "daily") },
    { label: "Weekly Goals", emoji: "📅", items: open.filter((t) => t.cadence === "weekly") },
    { label: "Monthly Goals", emoji: "🗓️", items: open.filter((t) => t.cadence === "monthly") },
    { label: "Quests", emoji: "🎯", items: open.filter((t) => !t.cadence || t.cadence === "once") },
  ];
  const questRow = (t: Task) => {
    const dp = t.done_this_period;
    return (
      <div key={t.id} className={`group flex items-center justify-between gap-3 rounded-xl px-4 py-3 transition border ${dp ? "bg-slate-900/30 border-slate-800 opacity-60" : "bg-slate-900/50 border-slate-800 hover:border-indigo-500/40"}`}>
        <div className="flex items-start gap-3 min-w-0">
          <button onClick={() => complete(t)} disabled={busy === t.id || dp} className={`mt-0.5 w-9 h-9 rounded-lg border-2 flex items-center justify-center shrink-0 transition ${dp ? "border-emerald-500 bg-emerald-500/20" : "border-slate-600 group-hover:border-emerald-500 hover:bg-emerald-500/20"}`}>
            {busy === t.id ? <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> : <Check className={`w-4 h-4 ${dp ? "text-emerald-400" : "text-transparent group-hover:text-emerald-400"}`} />}
          </button>
          <div className="min-w-0">
            <div className={`font-medium truncate ${dp ? "line-through text-slate-500" : ""}`}>{t.title}</div>
            {t.source === "brain" && <div className="text-[10px] text-indigo-400/80 flex items-center gap-1"><Brain className="w-3 h-3" /> suggested by the Brain</div>}
            {dp && <div className="text-[10px] text-emerald-400/80">✓ done this {t.cadence === "daily" ? "day" : t.cadence === "weekly" ? "week" : "month"} — resets soon</div>}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <input type="date" value={t.due_at ? t.due_at.slice(0, 10) : ""} onChange={(e) => setDue(t.id, e.target.value)} className="bg-slate-800/60 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-300 focus:border-emerald-500 focus:outline-none" />
              {t.due_at && <span className={`text-[11px] ${isOverdue(t.due_at) ? "text-red-400" : "text-slate-400"}`}>{isOverdue(t.due_at) ? "⚠ overdue" : `📅 ${fmtDue(t.due_at)}`}</span>}
              {t.due_at && <a href={gcal(t.title, t.due_at)} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-400 hover:underline flex items-center gap-0.5"><CalendarPlus className="w-3 h-3" /> add to Google</a>}
            </div>
          </div>
        </div>
        <span className="shrink-0 text-xs font-bold text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-full px-2.5 py-1">+{xpFor(t.source)} XP</span>
      </div>
    );
  };
  const achievements = [
    { label: "First Blood", emoji: "🩸", got: stats.total_done >= 1, desc: "Clear your first quest" },
    { label: "On Fire", emoji: "🔥", got: stats.streak >= 3, desc: "3-day streak" },
    { label: "Unstoppable", emoji: "⚡", got: stats.streak >= 7, desc: "7-day streak" },
    { label: "Centurion", emoji: "💯", got: stats.xp >= 100, desc: "Earn 100 XP" },
    { label: "Brain's Hand", emoji: "🧠", got: stats.brain_done >= 1, desc: "Clear an AI quest" },
    { label: "Boss Slayer", emoji: "⚔️", got: stats.bosses_won >= 1, desc: "Defeat a boss" },
  ];

  return (
    <div className="relative">
      {toast && <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[9998] bg-emerald-500 text-slate-950 font-extrabold px-5 py-2 rounded-full shadow-lg animate-bounce">{toast}</div>}
      {levelUp && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center pointer-events-none">
          <div className="bg-gradient-to-br from-indigo-600 to-emerald-500 text-white px-10 py-7 rounded-3xl shadow-2xl text-center scale-110">
            <div className="text-xs uppercase tracking-[0.3em] opacity-80">Level Up!</div>
            <div className="text-5xl font-black mt-1">LV {levelUp.level}</div>
            <div className="text-lg font-semibold mt-1">🏆 {levelUp.rank}</div>
          </div>
        </div>
      )}
      {bossWin && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center pointer-events-none">
          <div className="bg-gradient-to-br from-red-600 to-amber-500 text-white px-10 py-7 rounded-3xl shadow-2xl text-center scale-110">
            <div className="text-xs uppercase tracking-[0.3em] opacity-80">⚔️ Boss Defeated!</div>
            <div className="text-3xl font-black mt-1">{bossWin.title}</div>
            <div className="text-xl font-bold mt-1">+{bossWin.xp} XP</div>
          </div>
        </div>
      )}
      {combo && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center pointer-events-none">
          <div className="bg-gradient-to-br from-orange-500 to-yellow-400 text-slate-950 px-10 py-7 rounded-3xl shadow-2xl text-center scale-110">
            <div className="text-xs uppercase tracking-[0.3em] opacity-80">🔥 Combo Bonus!</div>
            <div className="text-2xl font-black mt-1">{combo.label}</div>
            <div className="text-xl font-extrabold mt-1">+{combo.xp} XP</div>
          </div>
        </div>
      )}

      {/* HERO + player selector */}
      <div className="rounded-3xl border border-indigo-500/30 bg-gradient-to-br from-indigo-600/15 via-slate-900/0 to-emerald-600/10 p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-emerald-500 flex items-center justify-center shadow-lg"><span className="text-3xl font-black text-white">{stats.level}</span></div>
              <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-bold bg-slate-950 border border-slate-700 rounded-full px-2 py-0.5">LVL</span>
            </div>
            <div>
              <div className="text-2xl font-extrabold flex items-center gap-2">{stats.rank} <Star className="w-5 h-5 text-yellow-400" /></div>
              <div className="text-sm text-slate-400">{stats.xp} XP · {stats.total_done} cleared · {stats.bosses_won} bosses</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-center">
              <div className="flex items-center gap-1 text-2xl font-black text-orange-400"><Flame className="w-6 h-6" />{stats.streak}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">streak</div>
            </div>
            <button onClick={toggleMute} className="text-slate-500 hover:text-white p-2">{muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}</button>
          </div>
        </div>

        {/* Playing as */}
        {me && (
          <div className="relative mt-4 inline-block">
            <button onClick={() => setPickerOpen((v) => !v)} className="flex items-center gap-2 text-sm bg-slate-900/70 border border-slate-700 hover:border-indigo-500/50 rounded-full pl-2 pr-3 py-1.5">
              <span className="text-lg">{me.emoji}</span> Playing as <b>{me.name}</b> <ChevronDown className="w-4 h-4" />
            </button>
            {pickerOpen && (
              <div className="absolute z-20 mt-2 w-56 bg-slate-900 border border-slate-700 rounded-xl p-1 shadow-xl">
                {players.map((p) => (
                  <button key={p.id} onClick={() => pickPlayer(p.id)} className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-sm hover:bg-slate-800 ${me.id === p.id ? "text-emerald-400" : ""}`}>
                    <span className="text-lg">{p.emoji}</span> {p.name} <span className="ml-auto text-xs text-slate-500">Lv{p.level}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-4">
          <div className="flex justify-between text-xs text-slate-400 mb-1"><span>Level {stats.level}</span><span>{stats.xpInLevel}/{stats.levelSize} XP · {stats.xpToNext} to next</span></div>
          <div className="h-3 bg-slate-800 rounded-full overflow-hidden"><div className="h-3 bg-gradient-to-r from-emerald-500 to-indigo-400 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="flex gap-4 mt-4 text-sm">
          <span className="text-slate-300"><Zap className="w-4 h-4 inline text-yellow-400" /> {stats.done_today} today</span>
          <span className="text-slate-300"><Target className="w-4 h-4 inline text-emerald-400" /> {stats.done_week} this week</span>
        </div>
      </div>

      {/* BOSS BATTLES */}
      {bosses.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-bold flex items-center gap-2"><Skull className="w-5 h-5 text-red-400" /> Boss Battles</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
            {bosses.map((b) => {
              const total = b.objectives.length; const cleared = b.objectives.filter((o) => o.done).length;
              const hp = total ? Math.round(((total - cleared) / total) * 100) : 100;
              return (
                <div key={b.id} className="rounded-2xl border border-red-500/30 bg-gradient-to-br from-red-600/10 to-slate-900/0 p-5">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{b.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold">{b.title}</div>
                      {b.description && <div className="text-xs text-slate-400">{b.description}</div>}
                    </div>
                    <span className="text-xs font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2.5 py-1">+{b.reward_xp} XP</span>
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between text-[11px] text-slate-400 mb-1"><span>BOSS HP</span><span>{total - cleared}/{total} objectives left</span></div>
                    <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden"><div className="h-2.5 bg-gradient-to-r from-red-600 to-red-400 transition-all duration-500" style={{ width: `${hp}%` }} /></div>
                  </div>
                  <div className="space-y-1.5 mt-3">
                    {b.objectives.map((o, i) => (
                      <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={o.done} onChange={(e) => toggleObjective(b, i, e.target.checked)} className="accent-red-500" />
                        <span className={o.done ? "text-slate-500 line-through" : "text-slate-200"}>{o.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* QUESTS */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2"><Swords className="w-5 h-5 text-indigo-400" /> Active Quests <span className="text-slate-500 text-sm font-normal">({open.length})</span></h2>
          <button onClick={() => setShowCal((v) => !v)} className="text-xs flex items-center gap-1 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg"><Calendar className="w-3.5 h-3.5" /> Connect calendar</button>
        </div>

        {showCal && (
          <div className="mt-3 rounded-xl border border-emerald-500/30 bg-slate-900/60 p-4">
            <div className="font-semibold flex items-center gap-2 text-sm"><Calendar className="w-4 h-4 text-emerald-400" /> Subscribe to your quests</div>
            <p className="text-xs text-slate-400 mt-1">Any quest with a due date appears on your calendar with a 1-hour reminder — and stays in sync automatically.</p>
            <div className="flex gap-2 mt-3">
              <input readOnly value={calUrl || "Generating…"} onFocus={(e) => e.currentTarget.select()} className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300 font-mono" />
              <button onClick={copyCal} className="bg-emerald-600/80 hover:bg-emerald-500 px-3 rounded-lg text-xs font-semibold flex items-center gap-1">{copiedCal ? <Check className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}{copiedCal ? "Copied" : "Copy"}</button>
            </div>
            <div className="text-[11px] text-slate-500 mt-3 space-y-1">
              <div><b className="text-slate-400">Google:</b> Settings → Add calendar → From URL → paste.</div>
              <div><b className="text-slate-400">Apple:</b> Calendar → File → New Calendar Subscription → paste.</div>
              <div><b className="text-slate-400">Outlook:</b> Add calendar → Subscribe from web → paste.</div>
            </div>
          </div>
        )}

        <form onSubmit={addQuest} className="flex flex-wrap gap-2 mt-3">
          <input value={newQuest} onChange={(e) => setNewQuest(e.target.value)} placeholder="Add your own goal…" className="flex-1 min-w-[180px] bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:border-emerald-500 focus:outline-none" />
          <select value={cadence} onChange={(e) => setCadence(e.target.value)} title="Goal type" className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-300 focus:border-emerald-500 focus:outline-none">
            <option value="once">🎯 One-time</option>
            <option value="daily">🌅 Daily</option>
            <option value="weekly">📅 Weekly</option>
            <option value="monthly">🗓️ Monthly</option>
          </select>
          <input type="date" value={dueInput} onChange={(e) => setDueInput(e.target.value)} title="Due date (optional)" className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-300 focus:border-emerald-500 focus:outline-none" />
          <button type="submit" className="bg-slate-800 hover:bg-slate-700 px-4 rounded-xl flex items-center gap-1 text-sm"><Plus className="w-4 h-4" /> Add</button>
        </form>

        {open.length === 0 && <div className="text-center py-8 text-slate-500"><Sparkles className="w-8 h-8 mx-auto mb-2 text-emerald-400/60" />No goals yet — add a daily, weekly, or monthly goal above, or let the Brain suggest your next move.</div>}

        {groups.map((g) => g.items.length > 0 && (
          <div key={g.label} className="mt-5">
            <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <span>{g.emoji}</span> {g.label}
              <span className="text-xs text-slate-500 font-normal">({g.items.filter((t) => !t.done_this_period).length} left)</span>
            </h3>
            <div className="space-y-2.5 mt-2">{g.items.map(questRow)}</div>
          </div>
        ))}
      </div>

      {/* LEADERBOARD */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2"><Crown className="w-5 h-5 text-yellow-400" /> Leaderboard</h2>
          <button onClick={() => setShowAdd((v) => !v)} className="text-xs flex items-center gap-1 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg"><UserPlus className="w-3.5 h-3.5" /> Add teammate</button>
        </div>
        {showAdd && (
          <form onSubmit={addTeammate} className="flex flex-wrap gap-2 mt-3">
            <input value={tn} onChange={(e) => setTn(e.target.value)} placeholder="Name" className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none" />
            <input value={tr} onChange={(e) => setTr(e.target.value)} placeholder="Role (e.g. Loan Officer)" className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none" />
            <button type="submit" className="bg-emerald-600/80 hover:bg-emerald-500 px-4 rounded-lg text-sm font-semibold">Add</button>
          </form>
        )}
        <div className="space-y-2 mt-3">
          {players.map((p, i) => (
            <div key={p.id} className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${me?.id === p.id ? "border-emerald-500/40 bg-emerald-500/5" : "border-slate-800 bg-slate-900/40"}`}>
              <span className="w-7 text-center text-lg">{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : <span className="text-slate-600 text-sm">#{i + 1}</span>}</span>
              <span className="text-2xl">{p.emoji}</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate">{p.name} {p.is_owner && <Crown className="w-3.5 h-3.5 inline text-yellow-400" />}</div>
                <div className="text-xs text-slate-500">{p.rank} · Level {p.level}{p.role ? ` · ${p.role}` : ""}</div>
              </div>
              <div className="text-right shrink-0"><div className="font-black text-emerald-400">{p.xp}</div><div className="text-[10px] text-slate-500">XP</div></div>
            </div>
          ))}
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
    </div>
  );
}

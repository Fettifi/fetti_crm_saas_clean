'use client';

// Real, persistent task list backed by org_tasks via /api/tasks. Starts empty;
// you add your own. Completing a task marks it done server-side.
import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Circle, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import VoiceInput from '@/components/apply/VoiceInput';

interface Task { id: string; title: string; status: string; }

export default function TaskList() {
  const [open, setOpen] = useState<Task[]>([]);
  const [done, setDone] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTask, setNewTask] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/tasks');
      if (r.ok) { const j = await r.json(); setOpen(j.open || []); setDone(j.done || []); }
    } catch { /* */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const title = newTask.trim();
    if (!title || busy) return;
    setBusy(true); setNewTask('');
    try {
      await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
      await load();
    } catch { /* */ }
    setBusy(false);
  }

  // Speak a task → it's added to the list. Reuses the VoiceInput mic (Web Speech).
  async function addTaskFromVoice(text: string) {
    const title = text.trim();
    if (!title) return;
    try {
      await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
      toast.success('Task added: ' + title);
      await load();
    } catch { toast.error("Couldn't add that task — try again."); }
  }

  async function complete(id: string) {
    try {
      await fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status: 'done' }) });
      await load();
    } catch { /* */ }
  }

  const total = open.length + done.length;

  return (
    <div className="max-w-4xl">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-50">My Tasks</h2>
            <p className="text-xs text-slate-400">Your tasks — add your own; they save automatically.</p>
          </div>
          <div className="text-xs text-slate-500 font-mono">{done.length}/{total} COMPLETED</div>
        </div>

        <form onSubmit={addTask} className="mb-6 relative">
          <input
            type="text" value={newTask} onChange={(e) => setNewTask(e.target.value)}
            placeholder="Add a new task..."
            className="w-full bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all"
          />
          <button type="submit" disabled={!newTask.trim() || busy}
            className="absolute right-2 top-2 p-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          </button>
        </form>

        {/* Speak a task and it's added — tap the mic. (Chrome, Edge, or Safari) */}
        <div className="flex items-center gap-3 mb-6 -mt-3">
          <VoiceInput onTranscript={addTaskFromVoice} />
          <span className="text-xs text-slate-500">Tap the mic and just say your task</span>
        </div>

        <div className="space-y-2">
          {loading ? (
            <div className="text-center py-10 text-slate-500 text-sm flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</div>
          ) : total === 0 ? (
            <div className="text-center py-10 text-slate-600 text-sm">No tasks yet. Add one above!</div>
          ) : (
            <>
              {open.map((task) => (
                <div key={task.id} className="group flex items-center gap-3 p-3 rounded-xl border bg-slate-900/40 border-slate-800 hover:border-slate-700 transition-all">
                  <button onClick={() => complete(task.id)} className="flex-shrink-0 text-slate-500 hover:text-emerald-400 transition-colors"><Circle size={20} /></button>
                  <span className="flex-1 text-sm text-slate-200">{task.title}</span>
                </div>
              ))}
              {done.map((task) => (
                <div key={task.id} className="flex items-center gap-3 p-3 rounded-xl border bg-slate-900/20 border-slate-800/50 opacity-60">
                  <span className="flex-shrink-0 text-emerald-500"><CheckCircle2 size={20} /></span>
                  <span className="flex-1 text-sm text-slate-500 line-through">{task.title}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

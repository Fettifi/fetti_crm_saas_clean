'use client';

import React, { useState } from 'react';
import { CheckCircle2, Circle, Plus, Trash2 } from 'lucide-react';

interface Task {
  id: string;
  text: string;
  completed: boolean;
}

export default function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([
    { id: '1', text: 'Review quarterly goals', completed: false },
    { id: '2', text: 'Update client contact info', completed: true },
    { id: '3', text: 'Prepare for team meeting', completed: false },
  ]);
  const [newTask, setNewTask] = useState('');

  const addTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.trim()) return;
    setTasks([
      ...tasks,
      { id: Date.now().toString(), text: newTask, completed: false },
    ]);
    setNewTask('');
  };

  const toggleTask = (id: string) => {
    setTasks(
      tasks.map((t) =>
        t.id === id ? { ...t, completed: !t.completed } : t
      )
    );
  };

  const deleteTask = (id: string) => {
    setTasks(tasks.filter((t) => t.id !== id));
  };

  return (
    <div className="max-w-4xl">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-50">My Tasks</h2>
            <p className="text-xs text-slate-400">Manage your daily to-dos.</p>
          </div>
          <div className="text-xs text-slate-500 font-mono">
            {tasks.filter((t) => t.completed).length}/{tasks.length} COMPLETED
          </div>
        </div>

        <form onSubmit={addTask} className="mb-6 relative">
          <input
            type="text"
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            placeholder="Add a new task..."
            className="w-full bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all"
          />
          <button
            type="submit"
            disabled={!newTask.trim()}
            className="absolute right-2 top-2 p-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Plus size={16} />
          </button>
        </form>

        <div className="space-y-2">
          {tasks.length === 0 ? (
            <div className="text-center py-10 text-slate-600 text-sm">
              No tasks yet. Add one above!
            </div>
          ) : (
            tasks.map((task) => (
              <div
                key={task.id}
                className={`group flex items-center gap-3 p-3 rounded-xl border transition-all ${
                  task.completed
                    ? 'bg-slate-900/20 border-slate-800/50 opacity-60'
                    : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                }`}
              >
                <button
                  onClick={() => toggleTask(task.id)}
                  className={`flex-shrink-0 transition-colors ${
                    task.completed ? 'text-emerald-500' : 'text-slate-500 hover:text-emerald-400'
                  }`}
                >
                  {task.completed ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                </button>
                
                <span
                  className={`flex-1 text-sm ${
                    task.completed ? 'text-slate-500 line-through' : 'text-slate-200'
                  }`}
                >
                  {task.text}
                </span>

                <button
                  onClick={() => deleteTask(task.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-all"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

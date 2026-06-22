"use client";

// Reusable destructive-delete confirmation. Double-check: the user must type DELETE
// to arm the button. The "erase files from the server" checkbox (default on) controls
// whether stored documents are permanently purged from the loan-docs bucket too.
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";

export default function DeleteConfirm({
  open, name, kind, busy, onCancel, onConfirm,
}: {
  open: boolean;
  name: string;
  kind: "lead" | "loan file";
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (purgeStorage: boolean) => void;
}) {
  const [purge, setPurge] = useState(true);
  const [typed, setTyped] = useState("");
  useEffect(() => { if (open) { setTyped(""); setPurge(true); } }, [open]);
  if (!open) return null;
  const armed = typed.trim().toUpperCase() === "DELETE";
  const tied = kind === "lead" ? "its loan file, documents, agent runs, and activity" : "its documents and activity";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl border border-red-500/40 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-red-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold text-white">Delete this {kind}?</h3>
            <p className="text-sm text-slate-400 mt-1">
              <span className="text-slate-200 font-semibold">{name || "This record"}</span> — permanently removes the {kind} and {tied}. This cannot be undone.
            </p>
          </div>
          <button onClick={onCancel} aria-label="Close" className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <label className="flex items-start gap-2 mt-4 text-sm text-slate-300 cursor-pointer">
          <input type="checkbox" checked={purge} onChange={(e) => setPurge(e.target.checked)} className="accent-red-500 mt-0.5" />
          <span><b>Also erase uploaded files from the server</b> — IDs, statements, signed PDFs, everywhere they exist. Permanently wipes them from storage. Uncheck to keep the files.</span>
        </label>

        <div className="mt-4">
          <label className="text-xs text-slate-500">Type <b className="text-red-300">DELETE</b> to confirm</label>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" autoFocus
            className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-red-500 focus:outline-none" />
        </div>

        <div className="flex gap-2 mt-4">
          <button onClick={onCancel} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-2.5 rounded-lg">Cancel</button>
          <button onClick={() => onConfirm(purge)} disabled={!armed || busy}
            className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-lg flex items-center justify-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Delete permanently
          </button>
        </div>
      </div>
    </div>
  );
}

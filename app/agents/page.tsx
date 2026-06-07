"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Loader2, Play, Inbox, CheckCircle2, Layers, FileText, Flag } from "lucide-react";

type Lead = { id: string; full_name: string | null; email: string | null; phone: string | null; loan_purpose: string | null; tier: string | null; stage: string | null };

const STAGES = [
  { stage: "capture", name: "Capture Agent", tagline: "Intake & enrichment", icon: Inbox },
  { stage: "qualify", name: "Qualify Agent", tagline: "Fit against the lending box", icon: CheckCircle2 },
  { stage: "structure", name: "Structure Agent", tagline: "Product & terms", icon: Layers },
  { stage: "process", name: "Process Agent", tagline: "Docs & conditions", icon: FileText },
  { stage: "close", name: "Close Agent", tagline: "Path to funding", icon: Flag },
];

function Value({ k, v }: { k: string; v: any }) {
  if (v === null || v === undefined || v === "") return null;
  const label = k.replace(/_/g, " ");
  if (Array.isArray(v)) {
    return (
      <div className="mt-2">
        <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
        <ul className="list-disc list-inside text-sm text-slate-200 mt-1 space-y-0.5">
          {v.map((x, i) => <li key={i}>{typeof x === "string" ? x : JSON.stringify(x)}</li>)}
        </ul>
      </div>
    );
  }
  return (
    <div className="mt-2">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-sm text-slate-200">{String(v)}</div>
    </div>
  );
}

export default function AgentsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [runs, setRuns] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loadingLeads, setLoadingLeads] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("leads")
        .select("id, full_name, email, phone, loan_purpose, tier, stage")
        .order("created_at", { ascending: false })
        .limit(100);
      setLeads((data as Lead[]) || []);
      setLoadingLeads(false);
    })();
  }, []);

  async function selectLead(l: Lead) {
    setSelected(l);
    setRuns({});
    const res = await fetch(`/api/agents/runs?lead_id=${l.id}`);
    const json = await res.json();
    if (json.runs) {
      const mapped: Record<string, any> = {};
      for (const stage of Object.keys(json.runs)) {
        mapped[stage] = { summary: json.runs[stage].summary, output: json.runs[stage].output_json };
      }
      setRuns(mapped);
    }
  }

  async function runStage(stage: string) {
    if (!selected) return;
    setBusy(stage);
    try {
      const res = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: selected.id, stage }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setRuns((p) => ({ ...p, [stage]: { summary: json.summary, output: json.output } }));
    } catch (e) {
      setRuns((p) => ({ ...p, [stage]: { summary: `Error: ${e instanceof Error ? e.message : e}`, output: {} } }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold">🧠 Five-Agent Mortgage Operations</h1>
        <p className="text-slate-400 text-sm mt-1">
          Pick a lead, then run each agent across the loan lifecycle. Agents advise — you decide.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 mt-6">
          {/* Lead list */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-3 h-[70vh] overflow-auto">
            <div className="text-xs uppercase tracking-wide text-slate-500 px-2 py-1">Leads</div>
            {loadingLeads && <div className="text-slate-500 text-sm p-2 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
            {!loadingLeads && leads.length === 0 && <div className="text-slate-500 text-sm p-2">No leads yet.</div>}
            {leads.map((l) => (
              <button
                key={l.id}
                onClick={() => selectLead(l)}
                className={`w-full text-left px-3 py-2 rounded-lg mb-1 ${selected?.id === l.id ? "bg-emerald-500/15 border border-emerald-500/40" : "hover:bg-slate-800"}`}
              >
                <div className="text-sm font-medium">{l.full_name || l.email || l.phone || "Lead"}</div>
                <div className="text-xs text-slate-500">{l.loan_purpose || "—"} · {l.tier || "untiered"}</div>
              </button>
            ))}
          </div>

          {/* Agent pipeline */}
          <div>
            {!selected && <div className="text-slate-500 mt-10 text-center">Select a lead to run the agents.</div>}
            {selected && (
              <div className="space-y-4">
                <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
                  <div className="font-semibold">{selected.full_name || "Lead"}</div>
                  <div className="text-sm text-slate-400">{selected.email} · {selected.phone} · {selected.loan_purpose}</div>
                </div>
                {STAGES.map((s) => {
                  const run = runs[s.stage];
                  return (
                    <div key={s.stage} className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <s.icon className="w-5 h-5 text-emerald-400" />
                          <div>
                            <div className="font-semibold">{s.name}</div>
                            <div className="text-xs text-slate-500">{s.tagline}</div>
                          </div>
                        </div>
                        <button
                          onClick={() => runStage(s.stage)}
                          disabled={busy === s.stage}
                          className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 text-sm font-semibold px-4 py-2 rounded-full"
                        >
                          {busy === s.stage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                          {run ? "Re-run" : "Run"}
                        </button>
                      </div>
                      {run && (
                        <div className="mt-3 border-t border-slate-800 pt-3">
                          <div className="text-sm text-slate-100 font-medium">{run.summary}</div>
                          {run.output && Object.entries(run.output)
                            .filter(([k]) => k !== "summary")
                            .map(([k, v]) => <Value key={k} k={k} v={v} />)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

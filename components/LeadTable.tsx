"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import DeleteConfirm from "@/components/DeleteConfirm";
import { leadQuality } from "@/lib/leadQuality";

type Lead = {
  id: string;
  created_at: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
  loan_purpose: string | null;
  credit_band: string | null;
  stage: string | null;
  source: string | null;
  lead_source: string | null;
  tier: string | null;
  score: number | null;
  portal_viewed_at: string | null; // borrower opened their upload link (leading "about to engage" signal)
  shield: { band?: string; risk?: number; signals?: Array<{ key: string; pts: number; note?: string }>; verify_email_sent_at?: string | null } | null;
};

// Lead QUALITY badge (how fundable) — distinct from the Stage badge (how far along).
// Driven by the canonical tier/score so the 1–2 qualified leads jump out of a list
// dominated by Tier-3 traffic.
function QualityBadge({ tier, score }: { tier: string | null; score: number | null }) {
  const q = leadQuality({ tier, score });
  if (q.key === "unknown") return <span className="text-slate-600">—</span>;
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${q.cls}`} title={`${tier || "untiered"}${score != null ? ` · score ${score}` : ""}`}>{q.label}</span>;
}

// A lead is "paid" if it came from an ad (LP paid_* source, or a paid traffic source).
const PAID_RE = /google|bing|cpc|ppc|paid|adwords|gclid|fbclid|meta|facebook/i;
function isPaid(l: { source: string | null; lead_source: string | null }): boolean {
  return /^paid_/.test(l.source || "") || PAID_RE.test(l.lead_source || "") || PAID_RE.test(l.source || "");
}

// A lead becomes a "complete application" once its file has all required docs
// (stage advances to Processing+) — those are kept separate from raw leads.
const APP_STAGES = ["application", "processing", "underwriting", "approved", "clear to close", "funded", "closed"];
function lifecycle(stage: string | null): "lead" | "engaged" | "application" {
  const s = (stage || "").toLowerCase();
  if (APP_STAGES.some((a) => s.includes(a))) return "application";
  if (s === "engaged") return "engaged";
  return "lead";
}
function StageBadge({ stage }: { stage: string | null }) {
  const k = lifecycle(stage);
  const map = {
    lead: ["New lead", "bg-slate-700/60 text-slate-300"],
    engaged: ["Engaged", "bg-amber-500/20 text-amber-300"],
    application: ["Application ✓", "bg-emerald-500/20 text-emerald-300"],
  } as const;
  const [label, cls] = map[k];
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

export default function LeadTable() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"leads" | "applications" | "all" | "review">("leads");
  const [shieldBusy, setShieldBusy] = useState<string | null>(null);
  // LOS: create-or-fetch a loan file (+ borrower link) per lead, on demand.
  const [losBusy, setLosBusy] = useState<string | null>(null);
  const [losFile, setLosFile] = useState<Record<string, { id: string; token: string }>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [delTarget, setDelTarget] = useState<Lead | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  async function doDelete(purge: boolean) {
    if (!delTarget) return;
    setDelBusy(true);
    try {
      const r = await fetch(`/api/leads?id=${delTarget.id}&purge=${purge ? 1 : 0}`, { method: "DELETE" });
      if (r.ok) { setLeads((ls) => ls.filter((x) => x.id !== delTarget.id)); setDelTarget(null); }
      else { const j = await r.json().catch(() => ({})); alert(j.error || "Delete failed."); }
    } catch { alert("Connection error deleting the lead."); } finally { setDelBusy(false); }
  }

  async function createFile(leadId: string) {
    setLosBusy(leadId);
    try {
      const r = await fetch("/api/los/files", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId }),
      });
      const j = await r.json();
      if (r.ok && j.file) {
        setLosFile((m) => ({ ...m, [leadId]: { id: j.file.id, token: j.file.share_token } }));
        try {
          await navigator.clipboard?.writeText(`${window.location.origin}/file/${j.file.share_token}`);
          setCopied(leadId); setTimeout(() => setCopied(null), 1500);
        } catch { /* clipboard may be blocked; link still on the row */ }
      } else {
        alert(j.error || "Could not create loan file.");
      }
    } finally { setLosBusy(null); }
  }
  async function resolveShield(leadId: string, action: "promote" | "dismiss") {
    setShieldBusy(leadId);
    try {
      const r = await fetch("/api/shield/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId, action }) });
      if (r.ok) setLeads((ls) => ls.map((x) => x.id === leadId ? { ...x, stage: action === "promote" ? "New Lead" : "Dead", shield: null } : x));
    } finally { setShieldBusy(null); }
  }
  function copyLink(leadId: string) {
    const f = losFile[leadId]; if (!f) return;
    navigator.clipboard?.writeText(`${window.location.origin}/file/${f.token}`);
    setCopied(leadId); setTimeout(() => setCopied(null), 1500);
  }

  useEffect(() => {
    let mounted = true;

    async function loadLeads() {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from("leads")
        // NOTE: do not embed applications(...) — that table/relationship does not
        // exist, which made the whole query fail (PGRST200) and the leads page show
        // nothing. Select only real columns on the leads table.
        .select(
          "id, created_at, full_name, email, phone, state, loan_purpose, credit_band, stage, source, lead_source, tier, score, portal_viewed_at:raw->>portal_viewed_at, shield:raw->shield, deal_screen:raw->deal_screen"
        )
        .order("created_at", { ascending: false })
        .limit(200);

      if (!mounted) return;

      if (error) {
        console.error(error);
        setError(error.message);
      } else if (data) {
        setLeads(data as Lead[]);
      }

      setLoading(false);
    }

    loadLeads();
    const channel = supabase
      .channel("leads-changes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "leads" },
        () => {
          loadLeads();
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  if (loading) {
    return <div className="text-sm text-slate-400">Loading leads...</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-700 bg-red-900/40 px-3 py-2 text-xs text-red-200">
        Failed to load leads: {error}
      </div>
    );
  }

  if (!leads.length) {
    return (
      <div className="text-sm text-slate-400">
        No leads yet. Connect your Fetti LeadGen app or use the Apply page to
        submit a test lead.
      </div>
    );
  }

  const inReview = (l: Lead) => String(l.stage || "").toLowerCase() === "review";
  const counts = {
    leads: leads.filter((l) => lifecycle(l.stage) !== "application" && !inReview(l)).length,
    applications: leads.filter((l) => lifecycle(l.stage) === "application").length,
    review: leads.filter(inReview).length,
    all: leads.length,
  };
  const shown = leads.filter((l) =>
    view === "all" ? true
    : view === "review" ? inReview(l)
    : view === "applications" ? lifecycle(l.stage) === "application"
    : lifecycle(l.stage) !== "application" && !inReview(l)
  );
  // Surface the most fundable leads first (quality rank), then newest — so your
  // 1–2 qualified leads sit at the top instead of being buried by Tier-3 traffic.
  const sorted = [...shown].sort((a, b) => {
    const rb = leadQuality({ tier: b.tier, score: b.score }).rank;
    const ra = leadQuality({ tier: a.tier, score: a.score }).rank;
    if (rb !== ra) return rb - ra;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });

  const Tab = ({ id, label }: { id: typeof view; label: string }) => (
    <button onClick={() => setView(id)}
      className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${view === id ? "bg-emerald-600 text-slate-950" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
      {label} <span className="opacity-70">({counts[id]})</span>
    </button>
  );

  return (
    <div>
    <div className="flex items-center gap-2 mb-3">
      <Tab id="leads" label="Leads" />
      <Tab id="applications" label="Applications" />
      {counts.review > 0 && (
        <button onClick={() => setView("review")}
          className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${view === "review" ? "bg-amber-500 text-slate-950" : "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"}`}>
          🛡️ Review <span className="opacity-70">({counts.review})</span>
        </button>
      )}
      <Tab id="all" label="All" />
      <span className="text-[11px] text-slate-500 ml-1">Raw leads stay separate from complete applications.</span>
    </div>
    {!shown.length ? (
      <div className="text-sm text-slate-400">{view === "applications" ? "No complete applications yet — they appear here once a borrower's required docs are all in." : "No leads in this view."}</div>
    ) : (
    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
      <table className="min-w-full text-left text-xs">
        <thead className="border-b border-slate-800 bg-slate-900/80 text-slate-300">
          <tr>
            <th className="px-3 py-2">Created</th>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Quality</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">Phone</th>
            <th className="px-3 py-2">State</th>
            <th className="px-3 py-2">Purpose</th>
            <th className="px-3 py-2">Credit</th>
            <th className="px-3 py-2">Stage</th>
            <th className="px-3 py-2">Source</th>
            <th className="px-3 py-2">Deal Score</th>
            <th className="px-3 py-2">LOS file</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {sorted.map((lead) => (
            <tr key={lead.id} className="hover:bg-slate-900">
              <td className="px-3 py-2 text-slate-400">
                {lead.created_at
                  ? new Date(lead.created_at).toLocaleString()
                  : "—"}
              </td>
              <td className="px-3 py-2">{lead.full_name ?? "—"}</td>
              <td className="px-3 py-2"><QualityBadge tier={lead.tier} score={lead.score} /></td>
              <td className="px-3 py-2">{lead.email ?? "—"}</td>
              <td className="px-3 py-2">{lead.phone ?? "—"}</td>
              <td className="px-3 py-2">{lead.state ?? "—"}</td>
              <td className="px-3 py-2">{lead.loan_purpose ?? "—"}</td>
              <td className="px-3 py-2">{lead.credit_band ?? "—"}</td>
              <td className="px-3 py-2">
                {inReview(lead) ? (
                  <div className="min-w-[190px]">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300"
                      title={(lead.shield?.signals || []).map((x) => x.key + " +" + x.pts + (x.note ? " (" + x.note + ")" : "")).join(String.fromCharCode(10)) || "shield quarantine"}>
                      🛡️ Held — {((lead.shield?.signals || []).filter((x) => x.pts > 0).sort((a, b) => b.pts - a.pts)[0]?.key || "review").replace(/[._]/g, " ")}
                    </span>
                    <div className="flex gap-1 mt-1">
                      <button disabled={shieldBusy === lead.id} onClick={() => resolveShield(lead.id, "promote")}
                        className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-600 text-slate-950 hover:bg-emerald-500 disabled:opacity-40"
                        title="Real person — release into the pipeline (first touch + agents run now)">✓ Real</button>
                      <button disabled={shieldBusy === lead.id} onClick={() => resolveShield(lead.id, "dismiss")}
                        className="text-[10px] font-semibold px-2 py-0.5 rounded bg-red-900/70 text-red-200 hover:bg-red-900 disabled:opacity-40"
                        title="Junk/bot — mark Dead (nothing was ever sent to them)">✕ Junk</button>
                    </div>
                    {lead.shield?.verify_email_sent_at && <span className="block mt-0.5 text-[9px] text-slate-500">verify email sent — no click yet</span>}
                  </div>
                ) : (
                <StageBadge stage={lead.stage} />
                )}
                {lead.portal_viewed_at && lifecycle(lead.stage) === "lead" && (
                  <span className="block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 w-fit"
                    title={`Borrower opened their secure upload link — about to send documents (${new Date(lead.portal_viewed_at).toLocaleString()})`}>👀 Opened upload link</span>
                )}
              </td>
              <td className="px-3 py-2">
                <span>{lead.source ?? "generated"}</span>
                {isPaid(lead) && <span className="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300">Paid</span>}
                {lead.lead_source && lead.lead_source !== lead.source && <span className="block text-[10px] text-slate-500">{lead.lead_source}</span>}
              </td>
              <td className="px-3 py-2">
                {(() => {
                  // Deal screen lives in raw.deal_screen (written by lib/leadPipeline.ts) —
                  // the old code read a never-fetched applications relation, so this column
                  // rendered "—" forever.
                  // @ts-ignore
                  const ds = lead.deal_screen;
                  const score = ds?.dealScore;
                  if (score == null || score === 0) return <span className="text-slate-600">—</span>;
                  const color = score > 80 ? 'text-emerald-400' : score > 50 ? 'text-yellow-400' : 'text-red-400';
                  return <span className={`font-mono font-bold ${color}`} title={ds?.verdict || ""}>{score}</span>;
                })()}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <span className="flex items-center gap-2">
                  {losFile[lead.id] ? (
                    <>
                      <button onClick={() => copyLink(lead.id)} className="text-emerald-400 hover:text-emerald-300">
                        {copied === lead.id ? "✓ Copied" : "🔗 Copy link"}
                      </button>
                      <a href={`/los/${losFile[lead.id].id}`} className="text-slate-400 hover:text-white underline">Open</a>
                    </>
                  ) : (
                    <button onClick={() => createFile(lead.id)} disabled={losBusy === lead.id}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-50">
                      {losBusy === lead.id ? "…" : "📁 Create file + link"}
                    </button>
                  )}
                  <button onClick={() => setDelTarget(lead)} title="Delete lead permanently" className="text-slate-600 hover:text-red-400 px-1">🗑</button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    )}
    <DeleteConfirm open={!!delTarget} name={delTarget?.full_name || delTarget?.email || "this lead"} kind="lead" busy={delBusy} onCancel={() => setDelTarget(null)} onConfirm={doDelete} />
    </div>
  );
}

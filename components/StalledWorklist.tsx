"use client";

// "NEEDS YOU TODAY" — the stalled-file worklist, on the pipeline board.
//
// This renders lib/stalledFiles.ts (via /api/los/stalled) in the place the work
// actually gets done. See the header of app/api/los/stalled/route.ts for why the
// daily email alone was not enough: the digest correctly stays quiet for a week
// after raising a file, so "no email" reads as "nothing wrong" while the backlog
// grows behind it.
//
// Ranking is NOT re-derived here. The server sorts by severity — borrowers who are
// waiting on US first, then most decayed, then longest quiet — and this component
// renders that order as given. Any client-side re-sort would silently disagree with
// the email digest, and the two would drift apart with nobody able to say which one
// was right.
//
// Read-only. Every button here navigates or opens the user's own phone/mail client;
// nothing in this component sends anything to a borrower.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, AlertTriangle, ChevronDown, ChevronRight, Phone, Mail, RefreshCw } from "lucide-react";

export type StalledFile = {
  id: string;
  fileNumber: string | null;
  borrower: string | null;
  email: string | null;
  phone: string | null;
  stage: string | null;
  product: string | null;
  state: string | null;
  loanAmount: number | null;
  days: number;
  bucket: "warm" | "cold" | "frozen";
  flag: "awaiting_us" | "no_outreach" | "out_of_touch" | null;
  severity: number;
  lastTouch: string | null;
  outreachDays: number | null;
  replyDays: number | null;
  deliveredDays: number | null;
  docsDelivered: number;
  action: string;
};

type Counts = {
  total: number; blocked: number; awaitingUs: number; neverContacted: number;
  frozen: number; cold: number; warm: number; oldestDays: number;
};

const money = (n: number | null) =>
  typeof n === "number" && n > 0 ? `$${Math.round(n).toLocaleString("en-US")}` : null;

// The one line that separates "this file is old" from "this person was abandoned".
function silenceLine(f: StalledFile): string {
  if (f.flag === "no_outreach") return "never contacted — no outbound message on record";
  const parts: string[] = [];
  parts.push(f.outreachDays == null ? "no outbound on record" : `we last wrote ${f.outreachDays}d ago`);
  if (f.deliveredDays != null && f.docsDelivered > 0)
    parts.push(`they uploaded ${f.docsDelivered} doc${f.docsDelivered === 1 ? "" : "s"}, last ${f.deliveredDays}d ago`);
  if (f.replyDays != null) parts.push(`they replied ${f.replyDays}d ago`);
  return parts.join(" · ");
}

function Row({ f }: { f: StalledFile }) {
  const urgent = f.flag === "awaiting_us" || f.flag === "no_outreach";
  const edge = urgent || f.bucket === "frozen" ? "border-l-red-500" : f.bucket === "cold" ? "border-l-amber-500" : "border-l-emerald-500";
  const bits = [f.stage || "—", f.product, f.state, money(f.loanAmount)].filter(Boolean).join(" · ");

  return (
    <div className={`border-l-[3px] ${edge} ${urgent ? "bg-red-950/30" : "bg-slate-900/50"} rounded-r-lg px-3 py-2.5`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <Link href={`/los/${f.id}`} className="font-semibold text-white hover:text-emerald-400">
            {f.borrower || f.fileNumber || "(unnamed file)"}
          </Link>
          <span className="text-slate-400 text-sm"> — <b className="text-slate-200">{f.days} days quiet</b></span>
          <div className="text-[11px] text-slate-500 mt-0.5 truncate">
            {bits}{f.lastTouch ? ` · last event: ${f.lastTouch}` : ""}
          </div>
          <div className={`text-[11px] mt-0.5 ${urgent ? "text-red-300 font-semibold" : "text-slate-500"}`}>
            {silenceLine(f)}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {f.phone && (
            <a href={`tel:${f.phone}`} title={`Call ${f.phone}`}
              className="flex items-center gap-1 text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-500 text-slate-950 rounded-lg px-2.5 py-1.5">
              <Phone className="w-3.5 h-3.5" /> Call
            </a>
          )}
          {f.email && (
            <a href={`mailto:${f.email}`} title={`Email ${f.email}`}
              className="flex items-center gap-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5">
              <Mail className="w-3.5 h-3.5" /> Email
            </a>
          )}
          <Link href={`/los/${f.id}`}
            className="text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5">
            Open file
          </Link>
        </div>
      </div>
      <div className="text-xs text-emerald-300/90 mt-1.5">→ {f.action}</div>
    </div>
  );
}

export default function StalledWorklist() {
  const [files, setFiles] = useState<StalledFile[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const r = await fetch("/api/los/stalled");
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setFiles(j.files || []); setCounts(j.counts || null);
    } catch (e: any) {
      // A failed load must never render as "no stalled files" — that is the exact
      // false all-clear this whole feature exists to prevent.
      setErr(e?.message || "Could not load the worklist");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  if (loading && !files.length && !err) {
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Checking which files have gone quiet…
      </div>
    );
  }

  if (err) {
    return (
      <div className="mt-6 bg-amber-950/40 border border-amber-800/60 rounded-xl px-4 py-3 text-sm text-amber-200 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> Stalled-file worklist unavailable — {err}. This is <b>not</b> an all-clear.</span>
        <button onClick={load} className="text-xs font-semibold bg-amber-800/60 hover:bg-amber-700/60 rounded-lg px-2.5 py-1.5 shrink-0">Retry</button>
      </div>
    );
  }

  // A genuinely empty worklist is the goal state, and it should feel like one.
  if (!files.length) {
    return (
      <div className="mt-6 bg-emerald-950/30 border border-emerald-800/50 rounded-xl px-4 py-3 text-sm text-emerald-300">
        ✓ Every open file has been touched in the last 7 days. Nothing is going cold.
      </div>
    );
  }

  const blocked = files.filter((f) => f.flag === "awaiting_us" || f.flag === "no_outreach");
  const rest = files.filter((f) => !blocked.includes(f));
  const shown = showAll ? rest : rest.slice(0, 5);

  return (
    <div className="mt-6 bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-900/60 text-left">
        <span className="flex items-center gap-2 min-w-0">
          {open ? <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />}
          <span className="font-semibold text-white">Needs you today</span>
          <span className="text-sm text-slate-400 truncate">
            {counts?.blocked ? (
              <><b className="text-red-400">{counts.blocked} waiting on us</b> · {counts.total} file{counts.total === 1 ? "" : "s"} quiet · oldest {counts.oldestDays}d</>
            ) : (
              <>{counts?.total} file{counts?.total === 1 ? "" : "s"} gone quiet · oldest {counts?.oldestDays}d</>
            )}
          </span>
        </span>
        <span onClick={(e) => { e.stopPropagation(); load(); }} title="Refresh the worklist"
          className="text-slate-500 hover:text-emerald-400 shrink-0">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          <p className="text-[11px] text-slate-500">
            Open files nobody has touched in a week or more. Working an existing file is the shortest path to a funding — a new lead is not.
          </p>

          {blocked.length > 0 && (
            <div className="space-y-2">
              <div className="bg-red-900/50 border border-red-800/60 rounded-lg px-3 py-2">
                <div className="text-sm font-bold text-red-200">⚡ START HERE — these borrowers are waiting on US ({blocked.length})</div>
                <div className="text-[11px] text-red-300/80 mt-0.5">
                  They replied or handed over documents and got silence back. They already said yes with their actions.
                </div>
              </div>
              {blocked.map((f) => <Row key={f.id} f={f} />)}
            </div>
          )}

          {rest.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Also gone quiet ({rest.length})
                {counts && ` — ${counts.frozen} frozen 30d+ · ${counts.cold} cold 14d+ · ${counts.warm} warm 7d+`}
              </div>
              {shown.map((f) => <Row key={f.id} f={f} />)}
              {rest.length > shown.length && (
                <button onClick={() => setShowAll(true)} className="text-xs font-semibold text-emerald-400 hover:text-emerald-300">
                  Show {rest.length - shown.length} more →
                </button>
              )}
              {showAll && rest.length > 5 && (
                <button onClick={() => setShowAll(false)} className="text-xs font-semibold text-slate-400 hover:text-slate-300">
                  Show fewer
                </button>
              )}
            </div>
          )}

          <p className="text-[10px] text-slate-600">Internal only — nothing on this panel contacts a borrower.</p>
        </div>
      )}
    </div>
  );
}

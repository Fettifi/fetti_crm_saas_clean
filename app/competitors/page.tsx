"use client";

// Competitor Watch — legal competitor social intelligence.
// Tracks the top lending competitors' PUBLIC aggregate metrics (IG follower counts
// + top posts by engagement via the sanctioned business_discovery API) and deep-links
// their live ads in Meta's public Ad Library. The "hit-list" is where Fetti
// out-engages: comment as the brand on the posts their audience is already on.
// NO follower lists, NO commenter identities, NO scraping — those are illegal/ToS
// violations and this page exists so we win the same audience the legal way.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, Eye, ExternalLink, TrendingUp, Megaphone } from "lucide-react";

type TopPost = { caption: string; likes: number; comments: number; engagement: number; at: string | null; url: string | null };
type Row = {
  name: string; ig: string; adLibraryUrl: string; igUrl: string;
  ig_metrics: { followers: number | null; mediaCount: number | null; topPosts: TopPost[] } | null;
  ig_error?: string;
};

export default function CompetitorsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [igBlocked, setIgBlocked] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    const r = await fetch(`/api/competitors${refresh ? "?refresh=1" : ""}`);
    if (r.ok) {
      const j = await r.json();
      setRows(j.results || []);
      setFetchedAt(j.fetchedAt || null);
      setIgBlocked(j.igBlocked || null);
    }
    setLoading(false); setRefreshing(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Cross-competitor engagement hit-list: the hottest recent posts anywhere in the set.
  const hitList = rows
    .flatMap((r) => (r.ig_metrics?.topPosts || []).map((p) => ({ ...p, who: r.name, ig: r.ig })))
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 10);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        <Link href="/leads" className="text-slate-400 hover:text-white text-sm">← CRM</Link>
        <div className="flex items-start justify-between gap-3 mt-2">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Eye className="w-5 h-5 text-emerald-400" /> Competitor Watch</h1>
            <p className="text-slate-500 text-sm">Legal competitive intel: public metrics + live ads for the lenders we compete with. No follower scraping, no cold-contacting their audience — we out-content and out-engage them instead.</p>
          </div>
          <button onClick={() => load(true)} disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 px-3 py-1.5 text-xs font-medium shrink-0">
            {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
          </button>
        </div>
        {fetchedAt && <p className="text-[11px] text-slate-600 mt-1">Data as of {new Date(fetchedAt).toLocaleString()}</p>}

        {igBlocked && (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[13px] text-amber-200">
            ⚠️ IG metrics locked: {igBlocked}
          </div>
        )}

        {loading ? (
          <div className="mt-10 flex justify-center"><Loader2 className="animate-spin text-slate-500" /></div>
        ) : (
          <>
            {/* Engagement hit-list — where Fetti shows up next */}
            {hitList.length > 0 && (
              <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                <div className="font-semibold text-sm flex items-center gap-2 mb-2"><TrendingUp size={15} className="text-emerald-400" /> Engagement hit-list — their hottest posts right now</div>
                <p className="text-[11px] text-slate-500 mb-2">Open each post and leave a genuinely useful comment as Fetti (teach, don&apos;t pitch). Their audience sees it; the algorithm learns Fetti belongs in that feed.</p>
                <ul className="space-y-1.5">
                  {hitList.map((p, i) => (
                    <li key={i} className="text-xs text-slate-300 flex items-center gap-2">
                      <span className="text-emerald-500 font-mono w-5">{i + 1}.</span>
                      <span className="text-slate-500 shrink-0">[{p.who}]</span>
                      <span className="truncate flex-1">{p.caption || "(no caption)"}</span>
                      <span className="text-slate-500 shrink-0">♥ {p.likes.toLocaleString()} · 💬 {p.comments.toLocaleString()}</span>
                      {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="text-emerald-400 hover:text-emerald-300 shrink-0"><ExternalLink size={12} /></a>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Competitor cards */}
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {rows.map((r) => (
                <div key={r.ig} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-sm">{r.name}</div>
                      <a href={r.igUrl} target="_blank" rel="noreferrer" className="text-[11px] text-slate-500 hover:text-slate-300">@{r.ig}</a>
                    </div>
                    {r.ig_metrics?.followers != null && (
                      <div className="text-right">
                        <div className="text-sm font-bold text-emerald-400">{r.ig_metrics.followers.toLocaleString()}</div>
                        <div className="text-[10px] text-slate-600">followers</div>
                      </div>
                    )}
                  </div>
                  {r.ig_metrics?.topPosts?.length ? (
                    <div className="mt-2 text-[11px] text-slate-400">
                      Top post: “{r.ig_metrics.topPosts[0].caption?.slice(0, 90) || "…"}” — ♥ {r.ig_metrics.topPosts[0].likes.toLocaleString()}, 💬 {r.ig_metrics.topPosts[0].comments.toLocaleString()}
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] text-slate-600">{r.ig_error ? "IG metrics pending token upgrade" : "No post data yet"}</div>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <a href={r.adLibraryUrl} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200">
                      <Megaphone size={11} /> Their live ads (Ad Library)
                    </a>
                    <a href={r.igUrl} target="_blank" rel="noreferrer"
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200">Instagram</a>
                  </div>
                </div>
              ))}
            </div>

            {/* The legal playbook — the strategy lives in the product */}
            <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="font-semibold text-sm mb-2">📖 The legal audience-capture playbook</div>
              <ul className="space-y-1.5 text-[12px] text-slate-400">
                <li><span className="text-slate-200 font-medium">1. Out-comment them.</span> Use the hit-list above — a sharp, teaching comment from Fetti on their hottest post is seen by their audience, free, and 100% legal.</li>
                <li><span className="text-slate-200 font-medium">2. Mirror what works.</span> Their Ad Library shows every ad they&apos;re paying to run. Beat the angle, don&apos;t copy the creative.</li>
                <li><span className="text-slate-200 font-medium">3. Same feeds, better content.</span> Ray &amp; Mark episodes + Mark chat target the same topics/hashtags — the algorithm puts us in front of the same people.</li>
                <li><span className="text-slate-200 font-medium">4. Google: bid their brand terms.</span> Bidding &quot;rocket mortgage rates&quot; is legal (never use their trademark in ad copy). Warm, high-intent searchers.</li>
                <li><span className="text-slate-200 font-medium">5. Retarget our own engagers.</span> Custom audiences of people who engaged Fetti&apos;s page/pixel — already running in the warm-audience ad set.</li>
                <li className="text-slate-600 pt-1">❌ Never: scraping follower/commenter lists (Meta ToS + lawsuits), cold-texting scraped contacts (TCPA — $500–$1,500 per text), buying competitor audience data. One violation costs more than a year of ad spend.</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

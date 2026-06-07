"use client";

// Lead-Gen Launchpad: ready-to-run assets for every channel + tracked links +
// a budget plan + an AI generator for fresh social content. Everything here is
// copy-pasteable; traffic attributes back to the CRM as scored leads.
import { useState } from "react";
import { Copy, Check, Sparkles, Loader2, Megaphone, Share2, Users, Send, Search, DollarSign, LinkIcon } from "lucide-react";
import { LINKS, BUDGET, GOOGLE_ADS, META_ADS, SOCIAL, REFERRAL, OUTREACH, SEO_TITLES } from "@/lib/growth-content";

function Copyable({ text, label, className = "" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}
      className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 ${className}`}>
      {done ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />} {label || (done ? "Copied" : "Copy")}
    </button>
  );
}
function Card({ title, icon: Icon, children }: any) {
  return (
    <section className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
      <h2 className="text-lg font-bold flex items-center gap-2 mb-3"><Icon className="w-5 h-5 text-emerald-400" /> {title}</h2>
      {children}
    </section>
  );
}
const Block = ({ children }: any) => <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-3 text-sm text-slate-300">{children}</div>;

export default function GrowthHub() {
  const [topic, setTopic] = useState("");
  const [gen, setGen] = useState<any[]>([]);
  const [genBusy, setGenBusy] = useState(false);

  async function generate() {
    setGenBusy(true);
    try {
      const r = await fetch("/api/growth/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic }) });
      const j = await r.json(); setGen(j.posts || []);
    } finally { setGenBusy(false); }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold">🚀 Lead-Gen Launchpad</h1>
          <p className="text-slate-400 text-sm mt-1">Run these and traffic from every channel lands as a tracked lead in your CRM. Start with the tracked links + Google ads.</p>
        </div>

        {/* Budget */}
        <Card title="Your monthly plan (~$1,000)" icon={DollarSign}>
          <div className="space-y-2">
            {BUDGET.split.map((b) => (
              <div key={b.channel} className="flex items-start justify-between gap-3 border-b border-slate-800/60 pb-2">
                <div><div className="font-medium">{b.channel}</div><div className="text-xs text-slate-500">{b.note}</div></div>
                <div className="font-bold text-emerald-400 shrink-0">${b.amount}</div>
              </div>
            ))}
          </div>
          <div className="text-xs text-slate-400 mt-3">Free engines running alongside: {BUDGET.free.join(" · ")}.</div>
        </Card>

        {/* Tracked links */}
        <Card title="Tracked links — paste these everywhere" icon={LinkIcon}>
          <p className="text-xs text-slate-500 mb-3">Each link tags the lead's source so you know what's working. Put the bio links in your IG/TikTok profiles.</p>
          <div className="space-y-2">
            {Object.entries(LINKS).map(([k, url]) => (
              <div key={k} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-400 w-32 shrink-0 capitalize">{k.replace(/([A-Z])/g, " $1")}</span>
                <code className="flex-1 truncate text-[11px] text-slate-300 bg-slate-950/50 px-2 py-1 rounded">{url}</code>
                <Copyable text={url} />
              </div>
            ))}
          </div>
        </Card>

        {/* Google Ads */}
        <Card title="Google Search Ads" icon={Megaphone}>
          <div className="text-xs text-slate-400 mb-3">Budget: {GOOGLE_ADS.dailyBudget}. Final URL → use the <b>Google</b> tracked link above.</div>
          {GOOGLE_ADS.campaigns.map((c) => (
            <div key={c.name} className="mb-4">
              <div className="font-semibold text-emerald-300">{c.name}</div>
              <div className="mt-2 text-xs"><span className="text-slate-500">Keywords:</span> {c.keywords.join(", ")} <Copyable text={c.keywords.join("\n")} label="Copy keywords" className="ml-1" /></div>
              <div className="mt-2 grid sm:grid-cols-2 gap-2">
                <Block><div className="text-[11px] text-slate-500 mb-1">Headlines</div>{c.headlines.map((h, i) => <div key={i}>• {h}</div>)}<Copyable text={c.headlines.join("\n")} label="Copy" className="mt-2" /></Block>
                <Block><div className="text-[11px] text-slate-500 mb-1">Descriptions</div>{c.descriptions.map((d, i) => <div key={i} className="mb-1">• {d}</div>)}<Copyable text={c.descriptions.join("\n")} label="Copy" className="mt-1" /></Block>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">Negatives: {c.negatives.join(", ")}</div>
            </div>
          ))}
          <ul className="text-xs text-slate-400 list-disc list-inside">{GOOGLE_ADS.setup.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Card>

        {/* Meta Ads */}
        <Card title="Meta (Instagram / Facebook) Ads" icon={Megaphone}>
          <div className="text-xs text-slate-400 mb-3">Budget: {META_ADS.dailyBudget}. Install the Meta Pixel on your site for retargeting + conversion tracking.</div>
          <div className="text-xs text-slate-500 mb-1">Audiences</div>
          <ul className="text-sm text-slate-300 list-disc list-inside mb-3">{META_ADS.audiences.map((a, i) => <li key={i}>{a}</li>)}</ul>
          <div className="space-y-2">
            {META_ADS.angles.map((a, i) => (
              <Block key={i}>
                <div className="font-medium">{a.hook}</div>
                <div className="text-slate-400 mt-1">{a.primary}</div>
                <div className="text-[11px] text-slate-500 mt-1">Headline: {a.headline}</div>
                <Copyable text={`${a.primary}`} label="Copy ad text" className="mt-2" />
              </Block>
            ))}
          </div>
        </Card>

        {/* Social engine */}
        <Card title="Instagram + TikTok content engine" icon={Share2}>
          <div className="text-sm text-slate-300">{SOCIAL.cadence}</div>
          <div className="text-xs text-slate-500 mt-2">Content pillars: {SOCIAL.pillars.join(" · ")}</div>

          <div className="flex gap-2 mt-4">
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Optional theme (e.g. first-time buyers)…" className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none" />
            <button onClick={generate} disabled={genBusy} className="bg-emerald-600/80 hover:bg-emerald-500 px-4 rounded-lg text-sm font-semibold flex items-center gap-1">
              {genBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Generate 5 fresh posts
            </button>
          </div>

          <div className="space-y-2 mt-4">
            {(gen.length ? gen : SOCIAL.posts).map((p: any, i: number) => (
              <Block key={i}>
                <div className="font-medium">🎬 {p.hook}</div>
                <div className="text-slate-400 text-xs mt-1"><b>Script:</b> {p.script}</div>
                <div className="text-slate-300 text-xs mt-1"><b>Caption:</b> {p.caption}</div>
                <div className="text-emerald-400/80 text-[11px] mt-1">{p.hashtags}</div>
                <Copyable text={`${p.caption}\n\n${p.hashtags}`} label="Copy caption" className="mt-2" />
              </Block>
            ))}
          </div>
        </Card>

        {/* Referral partners */}
        <Card title="Referral partner outreach (free, compounding)" icon={Users}>
          <div className="text-xs text-slate-500">Target: {REFERRAL.who.join(" · ")}</div>
          <div className="text-xs text-slate-500 mt-1">Find them: {REFERRAL.where.join(" · ")}</div>
          <div className="text-[11px] text-amber-400/80 mt-2">Tip: create a tracked link per partner on the Referral Partners page (/start?ref=THEIR_CODE) so you can see who sends the best leads.</div>
          <div className="space-y-2 mt-3">
            <Block><div className="text-[11px] text-slate-500 mb-1">Email — “{REFERRAL.email.subject}”</div><div className="whitespace-pre-wrap text-xs">{REFERRAL.email.body}</div><Copyable text={`${REFERRAL.email.subject}\n\n${REFERRAL.email.body}`} label="Copy email" className="mt-2" /></Block>
            <Block><div className="text-[11px] text-slate-500 mb-1">SMS</div><div className="text-xs">{REFERRAL.sms}</div><Copyable text={REFERRAL.sms} label="Copy SMS" className="mt-2" /></Block>
            <Block><div className="text-[11px] text-slate-500 mb-1">DM</div><div className="text-xs">{REFERRAL.dm}</div><Copyable text={REFERRAL.dm} label="Copy DM" className="mt-2" /></Block>
          </div>
        </Card>

        {/* Direct outreach */}
        <Card title="Direct outreach & reactivation" icon={Send}>
          <div className="space-y-2">
            <Block><div className="text-[11px] text-slate-500 mb-1">Past-client reactivation (text/email)</div><div className="text-xs">{OUTREACH.pastClients}</div><Copyable text={OUTREACH.pastClients} className="mt-2" /></Block>
            <Block><div className="text-[11px] text-slate-500 mb-1">Facebook group value post</div><div className="text-xs">{OUTREACH.fbGroup}</div><Copyable text={OUTREACH.fbGroup} className="mt-2" /></Block>
            <Block><div className="text-[11px] text-slate-500 mb-1">LinkedIn connect</div><div className="text-xs">{OUTREACH.linkedin}</div><Copyable text={OUTREACH.linkedin} className="mt-2" /></Block>
          </div>
        </Card>

        {/* SEO */}
        <Card title="SEO content to publish" icon={Search}>
          <div className="text-xs text-slate-500 mb-2">Your /lending pages are already live. Publish these guides to pull organic traffic:</div>
          <ul className="text-sm text-slate-300 list-disc list-inside">{SEO_TITLES.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </Card>
      </div>
    </div>
  );
}

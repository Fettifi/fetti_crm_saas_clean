"use client";
// The guest list, for Ramon and his wife. Deliberately plain: who's coming, how many
// heads, who hasn't answered. Add someone by hand, change an answer, remove a duplicate.
import { useEffect, useState } from "react";

type Rsvp = {
  id: string; name: string; phone: string | null; party: number;
  status: "yes" | "no" | "maybe"; note: string | null; source: string;
  confirmed_sent: boolean; created_at: string; updated_at: string;
};
type Summary = { responded: number; yes: number; no: number; maybe: number; heads_confirmed: number; heads_if_maybes_come: number };

const fmtPhone = (p: string | null) =>
  !p ? "" : p.length === 10 ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : p;

export default function RsvpPage() {
  const [rsvps, setRsvps] = useState<Rsvp[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [event, setEvent] = useState<{ label: string; date: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [party, setParty] = useState("1");
  const [status, setStatus] = useState<"yes" | "no" | "maybe">("yes");
  const [notify, setNotify] = useState(true);

  async function load() {
    try {
      const r = await fetch("/api/rsvp", { headers: {} });
      const j = await r.json();
      setRsvps(j.rsvps || []); setSummary(j.summary || null); setEvent(j.event || null);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy("add"); setMsg(null);
    try {
      const r = await fetch("/api/rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, party: Number(party) || 1, status, notify, source: "manual" }),
      });
      const j = await r.json();
      if (!r.ok) setMsg({ ok: false, text: j.error || "Couldn't save that." });
      else {
        setName(""); setPhone(""); setParty("1"); setStatus("yes");
        const t = j.texted === "sent" ? " · confirmation texted"
          : j.texted ? ` · ${j.texted}` : "";
        setMsg({ ok: true, text: `${j.rsvp.name} saved${t}.` });
        await load();
      }
    } catch (err: any) { setMsg({ ok: false, text: err?.message || "Couldn't save that." }); }
    finally { setBusy(null); }
  }

  async function setAnswer(r: Rsvp, next: Rsvp["status"]) {
    setBusy(r.id); setMsg(null);
    try {
      const res = await fetch("/api/rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: r.name, phone: r.phone, party: r.party, status: next, notify: false, source: r.source }),
      });
      if (res.ok) await load();
    } finally { setBusy(null); }
  }

  async function remove(r: Rsvp) {
    if (!confirm(`Remove ${r.name} from the list?`)) return;
    setBusy(r.id);
    try { await fetch(`/api/rsvp?id=${encodeURIComponent(r.id)}`, { method: "DELETE"}); await load(); }
    finally { setBusy(null); }
  }

  const chip = (s: Rsvp["status"]) =>
    s === "yes" ? "bg-emerald-600/80 text-white"
    : s === "maybe" ? "bg-amber-600/80 text-white"
    : "bg-slate-700 text-slate-300";

  const order = { yes: 0, maybe: 1, no: 2 } as const;
  const sorted = [...rsvps].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-bold">Guest list</h1>
          <a href="/rsvp/photos" className="text-sm text-emerald-400 hover:text-emerald-300">photos from the day →</a>
        </div>
        <p className="text-slate-400 text-sm mt-1">
          {event?.label || "Vow renewal"} · {event?.date || "September 19, 2026"}
        </p>

        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            {[
              { k: "Coming", v: summary.heads_confirmed, sub: `${summary.yes} yes` },
              { k: "Maybe", v: summary.maybe, sub: `up to ${summary.heads_if_maybes_come} heads` },
              { k: "Can't come", v: summary.no, sub: "declined" },
              { k: "Responded", v: summary.responded, sub: "total replies" },
            ].map((c) => (
              <div key={c.k} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                <div className="text-2xl font-bold">{c.v}</div>
                <div className="text-xs text-slate-300">{c.k}</div>
                <div className="text-[11px] text-slate-500">{c.sub}</div>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={add} className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="text-sm font-semibold mb-3">Add someone</div>
          <div className="grid sm:grid-cols-4 gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required
              className="sm:col-span-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (for the confirmation text)" inputMode="tel"
              className="sm:col-span-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm" />
            <input value={party} onChange={(e) => setParty(e.target.value)} inputMode="numeric" placeholder="How many"
              className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm" />
            <select value={status} onChange={(e) => setStatus(e.target.value as any)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm">
              <option value="yes">Coming</option>
              <option value="maybe">Maybe</option>
              <option value="no">Can't come</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-slate-300 px-1">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              Text them a confirmation
            </label>
            <button disabled={busy === "add"} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg px-4 py-2 text-sm font-semibold">
              {busy === "add" ? "Saving…" : "Add to list"}
            </button>
          </div>
        </form>

        {msg && (
          <div className={`mt-3 text-sm rounded-lg px-3 py-2 border ${msg.ok ? "text-emerald-300 bg-emerald-950/20 border-emerald-800/40" : "text-red-300 bg-red-950/20 border-red-900/40"}`}>
            {msg.text}
          </div>
        )}

        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 divide-y divide-slate-800">
          {loading && <div className="p-4 text-slate-400 text-sm">Loading…</div>}
          {!loading && sorted.length === 0 && (
            <div className="p-6 text-slate-400 text-sm">
              Nobody has RSVP'd yet. Add someone above, or they'll appear here as they call in.
            </div>
          )}
          {sorted.map((r) => (
            <div key={r.id} className="p-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">
                  {r.name}
                  {r.party > 1 && <span className="text-slate-400 font-normal"> · party of {r.party}</span>}
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {fmtPhone(r.phone) || "no phone"} · {r.source}
                  {r.confirmed_sent && r.status !== "no" && " · confirmed by text"}
                  {r.note && ` · ${r.note}`}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {(["yes", "maybe", "no"] as const).map((s) => (
                  <button key={s} onClick={() => setAnswer(r, s)} disabled={busy === r.id}
                    title={s === "yes" ? "Coming" : s === "maybe" ? "Maybe" : "Can't come"}
                    className={`text-[11px] px-2 py-1 rounded ${r.status === s ? chip(s) : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                    {s === "yes" ? "Coming" : s === "maybe" ? "Maybe" : "No"}
                  </button>
                ))}
                <button onClick={() => remove(r)} disabled={busy === r.id}
                  className="text-xs px-1.5 py-1 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800">🗑</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

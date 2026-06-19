"use client";

import { useEffect, useState, useCallback } from "react";

type Testimonial = {
  id: string;
  source: string;
  author_name: string;
  author_location?: string;
  loan_type?: string;
  loan_amount?: number | null;
  state?: string;
  rating: number;
  quote: string;
  consent: boolean;
  status: "pending" | "approved" | "rejected";
  public: boolean;
  created_at: string;
};

type GoogleState = {
  placeId: string;
  configured: boolean;
  rating: number | null;
  count: number;
  reviews: number;
  fetched_at: number | null;
};

const LOAN_TYPES = [
  ["dscr", "DSCR rental"],
  ["fix-and-flip", "Fix & flip"],
  ["hard-money", "Hard money"],
  ["bridge", "Bridge"],
  ["home-purchase", "Home purchase"],
  ["refinance", "Refinance / cash-out"],
  ["business", "Business"],
  ["commercial-real-estate", "Commercial RE"],
  ["rental-property", "Rental property"],
  ["sba", "SBA"],
];

const EMPTY_WIN = {
  author_name: "",
  author_location: "",
  loan_type: "dscr",
  loan_amount: "",
  state: "",
  rating: 5,
  quote: "",
  consent: false,
};

export default function ProofAdminPage() {
  const [items, setItems] = useState<Testimonial[]>([]);
  const [google, setGoogle] = useState<GoogleState | null>(null);
  const [placeId, setPlaceId] = useState("");
  const [win, setWin] = useState({ ...EMPTY_WIN });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/settings/proof", { cache: "no-store" });
      if (r.status === 401) {
        setMsg("Please sign in to manage social proof.");
        setLoading(false);
        return;
      }
      const j = await r.json();
      setItems(j.testimonials || []);
      setGoogle(j.google || null);
      setPlaceId(j.google?.placeId || "");
    } catch {
      setMsg("Could not load.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(payload: any, okMsg?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/settings/proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) {
        setMsg(j.error || "Something went wrong.");
      } else {
        if (okMsg) setMsg(okMsg);
        await load();
      }
    } catch {
      setMsg("Network error.");
    }
    setBusy(false);
  }

  async function addWin(e: React.FormEvent) {
    e.preventDefault();
    if (!win.consent) {
      setMsg("Confirm you have the client's permission before publishing.");
      return;
    }
    await act(
      {
        action: "add",
        ...win,
        loan_amount: win.loan_amount ? Number(String(win.loan_amount).replace(/[^0-9.]/g, "")) : undefined,
        rating: Number(win.rating),
      },
      "Win published."
    );
    setWin({ ...EMPTY_WIN });
  }

  const pending = items.filter((t) => t.status === "pending");
  const published = items.filter((t) => t.status === "approved" && t.public);
  const rejected = items.filter((t) => t.status === "rejected");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Social proof</h1>
        <p className="mt-1 text-sm text-slate-500">
          Real Google reviews and consented client wins shown on the public site. Nothing is fabricated — borrower
          submissions land here for your approval before they ever go live.
        </p>

        {msg ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
            {msg}
          </div>
        ) : null}

        {/* ---- Google reviews config ---- */}
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-bold text-slate-900">Google reviews</h2>
          <p className="mt-1 text-sm text-slate-500">
            Paste your Google Business <span className="font-mono text-xs">Place ID</span> to pull real 4–5★ reviews.
            {google?.configured ? (
              <span className="ml-1 text-emerald-700">
                Connected · {google.rating ?? "—"}★ from {google.count} ratings ({google.reviews} shown).
              </span>
            ) : (
              <span className="ml-1 text-slate-400">Not connected yet.</span>
            )}
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={placeId}
              onChange={(e) => setPlaceId(e.target.value)}
              placeholder="ChIJ… (find at developers.google.com/maps place id finder)"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
            <button
              disabled={busy}
              onClick={() => act({ action: "set_place_id", placeId }, "Saved & pulled reviews.")}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              Save &amp; sync
            </button>
            {google?.configured ? (
              <button
                disabled={busy}
                onClick={() => act({ action: "sync_google" }, "Refreshed from Google.")}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-emerald-400 disabled:opacity-50"
              >
                Refresh
              </button>
            ) : null}
          </div>
        </section>

        {/* ---- Add a client win ---- */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-bold text-slate-900">Add a client win</h2>
          <p className="mt-1 text-sm text-slate-500">Enter a real, consented testimonial. It publishes immediately.</p>
          <form onSubmit={addWin} className="mt-4 grid gap-3 sm:grid-cols-2">
            <input
              required
              value={win.author_name}
              onChange={(e) => setWin({ ...win, author_name: e.target.value })}
              placeholder="Client name (e.g. John S.)"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
            <input
              value={win.author_location}
              onChange={(e) => setWin({ ...win, author_location: e.target.value })}
              placeholder="Location (e.g. Tampa, FL)"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
            <select
              value={win.loan_type}
              onChange={(e) => setWin({ ...win, loan_type: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
            >
              {LOAN_TYPES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <input
              value={win.loan_amount}
              onChange={(e) => setWin({ ...win, loan_amount: e.target.value })}
              placeholder="Loan amount (e.g. 450000)"
              inputMode="numeric"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
            <input
              value={win.state}
              onChange={(e) => setWin({ ...win, state: e.target.value })}
              placeholder="State (e.g. FL)"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
            <select
              value={win.rating}
              onChange={(e) => setWin({ ...win, rating: Number(e.target.value) })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
            >
              {[5, 4, 3, 2, 1].map((r) => (
                <option key={r} value={r}>
                  {r} stars
                </option>
              ))}
            </select>
            <textarea
              required
              value={win.quote}
              onChange={(e) => setWin({ ...win, quote: e.target.value })}
              placeholder="What they said…"
              rows={3}
              className="sm:col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
            <label className="sm:col-span-2 flex items-start gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={win.consent}
                onChange={(e) => setWin({ ...win, consent: e.target.checked })}
                className="mt-0.5"
              />
              I confirm this is a real client who gave permission to share this publicly.
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                Publish win
              </button>
            </div>
          </form>
        </section>

        {/* ---- Pending moderation ---- */}
        <section className="mt-6">
          <h2 className="font-bold text-slate-900">
            Pending review {pending.length ? <span className="text-amber-600">({pending.length})</span> : null}
          </h2>
          {loading ? (
            <p className="mt-2 text-sm text-slate-400">Loading…</p>
          ) : pending.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">No submissions waiting.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {pending.map((t) => (
                <Row key={t.id} t={t} busy={busy} onApprove={() => act({ action: "approve", id: t.id }, "Approved.")} onReject={() => act({ action: "reject", id: t.id })} onDelete={() => act({ action: "delete", id: t.id })} />
              ))}
            </div>
          )}
        </section>

        {/* ---- Published ---- */}
        <section className="mt-8">
          <h2 className="font-bold text-slate-900">Published ({published.length})</h2>
          {published.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">Nothing published yet.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {published.map((t) => (
                <Row key={t.id} t={t} busy={busy} onReject={() => act({ action: "reject", id: t.id }, "Unpublished.")} onDelete={() => act({ action: "delete", id: t.id })} />
              ))}
            </div>
          )}
        </section>

        {rejected.length > 0 ? (
          <section className="mt-8">
            <h2 className="font-bold text-slate-400">Rejected ({rejected.length})</h2>
            <div className="mt-3 space-y-3">
              {rejected.map((t) => (
                <Row key={t.id} t={t} busy={busy} muted onApprove={() => act({ action: "approve", id: t.id }, "Published.")} onDelete={() => act({ action: "delete", id: t.id })} />
              ))}
            </div>
          </section>
        ) : null}

        <p className="mt-10 text-xs text-slate-400">
          Collect more wins automatically: share{" "}
          <a href="/share-your-win" className="font-semibold text-emerald-600 hover:underline">
            fettifi.com/share-your-win
          </a>{" "}
          with closed clients. Submissions arrive here for approval.
        </p>
      </div>
    </div>
  );
}

function Row({
  t,
  busy,
  muted,
  onApprove,
  onReject,
  onDelete,
}: {
  t: Testimonial;
  busy: boolean;
  muted?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${muted ? "border-slate-200 bg-slate-50 opacity-70" : "border-slate-200 bg-white"} shadow-sm`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">
            {t.author_name}
            <span className="ml-2 text-xs font-normal text-slate-400">
              {t.rating}★ · {t.loan_type || "—"} {t.loan_amount ? `· $${Number(t.loan_amount).toLocaleString()}` : ""}{" "}
              {t.state ? `· ${t.state}` : ""} · {t.source}
            </span>
          </p>
          <p className="mt-1 text-sm text-slate-600">&ldquo;{t.quote}&rdquo;</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {onApprove ? (
            <button disabled={busy} onClick={onApprove} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
              Publish
            </button>
          ) : null}
          {onReject ? (
            <button disabled={busy} onClick={onReject} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-amber-400 disabled:opacity-50">
              {t.public ? "Unpublish" : "Reject"}
            </button>
          ) : null}
          {onDelete ? (
            <button disabled={busy} onClick={onDelete} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:border-red-400 hover:text-red-600 disabled:opacity-50">
              Delete
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

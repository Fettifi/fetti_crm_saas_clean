"use client";

// LO-side per-borrower CREDIT CARD AUTHORIZATION panel (inside the loan file).
// Set a blanket amount for the loan transaction, send the borrower a secure link to
// e-sign + provide their card, then see the card-on-file and reveal it (access-logged)
// to key into the credit vendor. The card is stored encrypted; the CVV is never stored.
import { useCallback, useEffect, useState } from "react";
import { CreditCard, Loader2, Copy, Check, Eye, ShieldCheck, Send } from "lucide-react";

type Auth = { status: string; amount: number; scope: string; borrowerName?: string; cardholder?: string; brand?: string; last4?: string; exp?: string; billingZip?: string; signedAt?: string; revealedAt?: string; cvvOnFile?: boolean; cvvExpiresAt?: string } | null;
type Row = { index: number; name: string; auth: Auth };

export default function CardAuthPanel({ fileId }: { fileId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [link, setLink] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState<number | null>(null);
  const [revealed, setRevealed] = useState<Record<number, { pan: string; exp: string; cardholder: string; cvv?: string }>>({});
  const [sendMsg, setSendMsg] = useState<Record<number, string>>({});
  const [alsoEmail, setAlsoEmail] = useState<Record<number, string>>({});
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/los/files/${fileId}/card-auth`);
      const j = await r.json();
      if (r.ok) setRows(j.borrowers || []);
    } finally { setLoading(false); }
  }, [fileId]);
  useEffect(() => { load(); }, [load]);

  async function sendRequest(i: number) {
    setBusy(i); setErr("");
    try {
      const amt = Number(String(amount[i] ?? "").replace(/[^0-9.]/g, "")) || 0;
      const r = await fetch(`/api/los/files/${fileId}/card-auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ borrowerIndex: i, amount: amt }) });
      const j = await r.json();
      if (!r.ok) { setErr(j?.error || "Could not create the request."); return; }
      setLink((m) => ({ ...m, [i]: j.link }));
      await load();
    } finally { setBusy(null); }
  }
  function copy(i: number, url: string) { navigator.clipboard?.writeText(url); setCopied(i); setTimeout(() => setCopied(null), 1500); }
  async function sendToBorrower(i: number) {
    setBusy(i); setErr(""); setSendMsg((m) => ({ ...m, [i]: "" }));
    try {
      const amt = Number(String(amount[i] ?? "").replace(/[^0-9.]/g, "")) || 0;
      const cc = String(alsoEmail[i] ?? "").trim();
      const r = await fetch(`/api/los/files/${fileId}/card-auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ borrowerIndex: i, amount: amt, action: "send", ...(cc ? { also_email: cc } : {}) }) });
      const j = await r.json();
      if (j.link) setLink((m) => ({ ...m, [i]: j.link }));
      setSendMsg((m) => ({ ...m, [i]: (!r.ok ? "⚠ " : (j.sent?.length ? "✓ " : "⚠ ")) + (j.message || j.error || "") }));
      if (r.ok) await load();
    } finally { setBusy(null); }
  }
  async function reveal(i: number) {
    setBusy(i); setErr("");
    try {
      const r = await fetch(`/api/los/files/${fileId}/card-auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ borrowerIndex: i, action: "reveal" }) });
      const j = await r.json();
      if (!r.ok) { setErr(j?.error || "Could not reveal the card."); return; }
      setRevealed((m) => ({ ...m, [i]: { pan: j.pan, exp: j.exp, cardholder: j.cardholder, cvv: j.cvv } }));
    } finally { setBusy(null); }
  }
  async function clearCvv(i: number) {
    setBusy(i); setErr("");
    try {
      await fetch(`/api/los/files/${fileId}/card-auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ borrowerIndex: i, action: "clear_cvv" }) });
      setRevealed((m) => { const n = { ...m }; if (n[i]) n[i] = { ...n[i], cvv: undefined }; return n; });
      await load();
    } finally { setBusy(null); }
  }

  if (loading) return null;
  if (!rows.length) return null;

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mt-4">
      <div className="flex items-center gap-2 mb-1">
        <CreditCard className="w-4 h-4 text-emerald-400" />
        <div className="text-xs uppercase tracking-wide text-slate-500">Credit card authorization</div>
      </div>
      <p className="text-[11px] text-slate-500 mb-3">Per borrower: send a secure link to e-sign a <span className="text-slate-300">blanket authorization</span> for this loan&apos;s fees (you set the max amount) and provide a card. The card is stored <span className="text-slate-300">encrypted</span>; the CVV is never stored. Reveal it to key into the credit vendor — every reveal is logged.</p>
      {err && <div className="text-[11px] text-red-300 mb-2">{err}</div>}

      <div className="space-y-3">
        {rows.map((row) => {
          const a = row.auth;
          const authed = a?.status === "authorized";
          const rev = revealed[row.index];
          return (
            <div key={row.index} className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-sm text-white">{row.name}</div>
                {authed
                  ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">✓ Authorized</span>
                  : a?.status === "requested"
                    ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">Awaiting borrower</span>
                    : <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">Not requested</span>}
              </div>

              {authed && a ? (
                <div className="mt-2 text-[12px] text-slate-300 space-y-1">
                  <div>{a.brand} •••• {a.last4} · exp {a.exp} · ZIP {a.billingZip}</div>
                  <div className="text-slate-500 text-[11px]">Cardholder {a.cardholder} · blanket up to ${Number(a.amount || 0).toLocaleString()} · signed {a.signedAt ? new Date(a.signedAt).toLocaleDateString() : "—"} · {a.cvvOnFile ? <span className="text-emerald-400/80">CVV available until {a.cvvExpiresAt ? new Date(a.cvvExpiresAt).toLocaleDateString() : "—"}</span> : <span className="text-slate-600">CVV cleared</span>}{a.revealedAt ? ` · last revealed ${new Date(a.revealedAt).toLocaleString()}` : ""}</div>
                  {rev ? (
                    <div className="mt-1 space-y-1.5">
                      <div className="bg-slate-950 border border-emerald-700/40 rounded-lg px-3 py-2 font-mono text-emerald-300 text-sm flex items-center justify-between gap-2">
                        <span>{rev.pan.replace(/(.{4})/g, "$1 ").trim()} · {rev.exp}{rev.cvv ? ` · CVV ${rev.cvv}` : ""} · {rev.cardholder}</span>
                        <button onClick={() => { navigator.clipboard?.writeText(rev.pan); setCopied(row.index); setTimeout(() => setCopied(null), 1500); }} className="text-slate-400 hover:text-white shrink-0">{copied === row.index ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}</button>
                      </div>
                      {rev.cvv ? <button onClick={() => clearCvv(row.index)} className="text-[11px] text-amber-300 hover:text-amber-200">🗑 Clear CVV now (do this once you&apos;ve charged the card)</button>
                        : <span className="text-[10px] text-slate-500">CVV not available — it auto-deletes after 48h for security; the signed card-on-file authorization still lets you charge.</span>}
                    </div>
                  ) : (
                    <button onClick={() => reveal(row.index)} disabled={busy === row.index} className="mt-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                      {busy === row.index ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />} Reveal card number
                    </button>
                  )}
                  <div className="flex items-center gap-3 pt-1">
                    <a href={`/api/los/files/${fileId}/card-auth/pdf?b=${row.index}`} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-sky-300 hover:text-sky-200">⬇ Download authorization (PDF)</a>
                    <button onClick={() => sendRequest(row.index)} disabled={busy === row.index} className="text-[11px] text-slate-400 hover:text-slate-200">Re-send link</button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  <div className="flex items-end gap-2 flex-wrap">
                    <div>
                      <label className="text-[10px] text-slate-500 mb-1 block">Blanket amount (max for this loan)</label>
                      <input value={amount[row.index] ?? (a?.amount ? String(a.amount) : "")} onChange={(e) => setAmount((m) => ({ ...m, [row.index]: e.target.value }))} placeholder="$ e.g. 150" className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none w-40" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 mb-1 block">Also email a copy to (optional)</label>
                      <input type="email" value={alsoEmail[row.index] ?? ""} onChange={(e) => setAlsoEmail((m) => ({ ...m, [row.index]: e.target.value }))} placeholder="spouse / partner email" className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none w-56" />
                    </div>
                    <button onClick={() => sendToBorrower(row.index)} disabled={busy === row.index} title="Email + text the borrower their secure authorization link (and a copy to the extra email, if set)" className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                      {busy === row.index ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send{alsoEmail[row.index]?.trim() ? " to both" : " to borrower"}
                    </button>
                    <button onClick={() => sendRequest(row.index)} disabled={busy === row.index} className="text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-50 px-3 py-1.5 rounded-lg text-slate-200">Get link to copy</button>
                    {link[row.index] && (
                      <button onClick={() => copy(row.index, link[row.index])} className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-slate-200">
                        {copied === row.index ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />} Copy
                      </button>
                    )}
                  </div>
                  {sendMsg[row.index] && <div className={`text-[11px] ${sendMsg[row.index].startsWith("✓") ? "text-emerald-300" : "text-amber-300"}`}>{sendMsg[row.index]}</div>}
                  {link[row.index] && <div className="text-[10px] font-mono text-slate-500 truncate">{link[row.index]}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

"use client";

// Borrower-facing CREDIT CARD AUTHORIZATION (/card-auth/<fileShareToken>?b=<index>).
// The borrower reviews a BLANKET authorization for this loan transaction (set amount),
// provides their card, and e-signs. The card number is retained ENCRYPTED server-side; the
// security code is collected but NEVER RETAINED past its short TTL — PCI 3.2.2 prohibits
// storing it after authorization, encrypted or not, and the signed card-on-file
// authorization is what permits the charge.
//
// When the code has since expired and the LO is ready to key a charge, `?cvv=1` reopens this
// page in a CVV-ONLY mode: the borrower re-supplies three digits against the card already on
// file. That is the compliant answer to "we did not use it immediately" — ask again, never keep.
import { use, useEffect, useState } from "react";
import { Loader2, ShieldCheck, CheckCircle2, CreditCard } from "lucide-react";
import { LICENSING_SHORT } from "@/lib/legal";

type Info = { company: string; nmls: string; fileNumber?: string; borrowerName?: string; amount: number; scope: string; authText: string; alreadyAuthorized: boolean; last4?: string };

export default function CardAuthPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [b, setB] = useState<string>("0");
  const [sig, setSig] = useState<string>("");
  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [done, setDone] = useState<{ brand: string; last4: string } | null>(null);
  // ?cvv=1 — the card is already on file; we only need the security code again.
  const cvvOnly = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("cvv") === "1";
  const [code, setCode] = useState("");
  const [codeDone, setCodeDone] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeErr, setCodeErr] = useState<string | null>(null);
  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setCodeBusy(true); setCodeErr(null);
    try {
      const r = await fetch(`/api/card-auth/${token}?b=${encodeURIComponent(b)}&s=${encodeURIComponent(sig)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "cvv_refresh", cvv: code }),
      });
      const j = await r.json();
      if (!r.ok) setCodeErr(j.error || "Could not save that code.");
      else setCodeDone(true);
    } catch (err: any) { setCodeErr(err?.message || "Could not save that code."); }
    finally { setCodeBusy(false); }
  }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [f, setF] = useState({ cardholder: "", cardNumber: "", expMonth: "", expYear: "", cvv: "", billingZip: "", signature: "", consent: false });

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const bi = qs.get("b") || "0";
    const s = qs.get("s") || "";
    setB(bi); setSig(s);
    const q = `b=${encodeURIComponent(bi)}&s=${encodeURIComponent(s)}`;
    // TELL THE BORROWER WHAT IS ACTUALLY WRONG. Every non-OK response used to collapse into
    // "invalid or has expired" — so an authorization sent without its dollar limit (a blank box
    // in the LOS) reached the borrower as a dead, expired link. Carry the server's own reason.
    fetch(`/api/card-auth/${token}?${q}`)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) { setNotFound(true); setLoadErr(j?.error || ""); setLoading(false); return; }
        setInfo(j); if (j.alreadyAuthorized) setDone({ brand: "", last4: j.last4 || "" }); setLoading(false);
      })
      .catch(() => { setNotFound(true); setLoading(false); });
  }, [token]);

  async function submit() {
    setErr("");
    if (!f.consent) { setErr("Please check the authorization box."); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/card-auth/${token}?b=${encodeURIComponent(b)}&s=${encodeURIComponent(sig)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const j = await r.json();
      if (!r.ok) { setErr(j?.error || "Could not submit."); return; }
      setDone({ brand: j.brand, last4: j.last4 });
    } catch { setErr("Connection error. Please try again."); } finally { setBusy(false); }
  }

  const fmtCard = (v: string) => v.replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim();

  if (loading) return <Center><Loader2 className="w-6 h-6 animate-spin text-emerald-600" /></Center>;
  if (notFound || !info) return <Center><p className="text-slate-500">{loadErr || "This authorization link is invalid or has expired. Please contact your Fetti specialist."}</p></Center>;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="max-w-lg mx-auto px-4 py-10">
        <div className="flex items-center gap-2">
          <img src="/fetti-emblem.png" alt="Fetti Financial Services LLC" width={36} height={36} className="w-9 h-9" />
          <div className="text-emerald-600 font-extrabold text-lg">Fetti<span className="text-slate-900"> Financial Services</span> <span className="text-slate-400 text-[0.7em] font-bold align-middle">LLC</span></div>
        </div>

        {done && cvvOnly && !codeDone ? (
          <div className="mt-8">
            <ShieldCheck className="w-10 h-10 text-emerald-500 mx-auto" />
            <h1 className="text-xl font-bold mt-3 text-center">Confirm your security code</h1>
            <p className="text-slate-500 mt-2 text-center text-sm">
              We have your card{done.last4 ? ` ending ${done.last4}` : ""} on file and your signed authorization.
              For your security we don't keep the 3-digit code on the back, so please enter it once more
              and we'll process the charge you already approved.
            </p>
            <form onSubmit={submitCode} className="mt-6 max-w-[220px] mx-auto">
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                inputMode="numeric" autoComplete="cc-csc" autoFocus placeholder="•••"
                className="w-full text-center tracking-[0.5em] text-2xl border rounded-xl px-4 py-3" />
              <button disabled={codeBusy || code.length < 3}
                className="w-full mt-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl">
                {codeBusy ? "Sending…" : "Confirm"}
              </button>
            </form>
            {codeErr && <p className="text-red-600 text-sm mt-3 text-center">{codeErr}</p>}
            <p className="text-[11px] text-slate-400 mt-6 text-center">{LICENSING_SHORT}</p>
          </div>
        ) : done ? (
          <div className="mt-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
            <h1 className="text-xl font-bold mt-3">{codeDone ? "Thank you" : "Authorization received"}</h1>
            <p className="text-slate-500 mt-1">{codeDone
              ? `We've got it${info.borrowerName ? `, ${info.borrowerName.split(" ")[0]}` : ""} — your card${done.last4 ? ` ending ${done.last4}` : ""} will be charged as authorized. You can close this page.`
              : `Thank you${info.borrowerName ? `, ${info.borrowerName.split(" ")[0]}` : ""}. Your card${done.last4 ? ` ending ${done.last4}` : ""} is on file for your loan, and your authorization has been recorded. You can close this page.`}</p>
            <p className="text-[11px] text-slate-400 mt-6">{LICENSING_SHORT}</p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold mt-5">Credit Card Authorization</h1>
            <p className="text-slate-500 mt-1 text-sm">{info.borrowerName ? `${info.borrowerName} · ` : ""}{info.fileNumber ? `File ${info.fileNumber}` : ""}</p>

            {/* The blanket authorization the borrower agrees to */}
            <div className="mt-5 bg-slate-50 border border-slate-200 rounded-2xl p-4">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">Authorization</div>
              <p className="text-[13px] leading-relaxed text-slate-700">{info.authText}</p>
            </div>

            <div className="mt-5 space-y-3">
              <Field label="Cardholder name"><input value={f.cardholder} onChange={(e) => setF({ ...f, cardholder: e.target.value })} className={inp} placeholder="Name as it appears on the card" autoComplete="cc-name" /></Field>
              <Field label="Card number"><div className="relative"><CreditCard className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><input value={fmtCard(f.cardNumber)} onChange={(e) => setF({ ...f, cardNumber: e.target.value })} inputMode="numeric" className={inp + " pl-9"} placeholder="1234 5678 9012 3456" autoComplete="cc-number" /></div></Field>
              <div className="grid grid-cols-4 gap-2">
                <Field label="Exp. month"><input value={f.expMonth} onChange={(e) => setF({ ...f, expMonth: e.target.value.replace(/\D/g, "").slice(0, 2) })} inputMode="numeric" className={inp} placeholder="MM" autoComplete="cc-exp-month" /></Field>
                <Field label="Exp. year"><input value={f.expYear} onChange={(e) => setF({ ...f, expYear: e.target.value.replace(/\D/g, "").slice(0, 2) })} inputMode="numeric" className={inp} placeholder="YY" autoComplete="cc-exp-year" /></Field>
                <Field label="CVV"><input value={f.cvv} onChange={(e) => setF({ ...f, cvv: e.target.value.replace(/\D/g, "").slice(0, 4) })} inputMode="numeric" className={inp} placeholder="•••" autoComplete="cc-csc" /></Field>
                <Field label="Billing ZIP"><input value={f.billingZip} onChange={(e) => setF({ ...f, billingZip: e.target.value })} inputMode="numeric" className={inp} placeholder="ZIP" autoComplete="postal-code" /></Field>
              </div>

              <label className="flex items-start gap-2 text-[13px] text-slate-700 mt-1">
                <input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} className="accent-emerald-600 mt-0.5" />
                <span>I have read and agree to the authorization above, and I am the cardholder or am authorized to use this card.</span>
              </label>
              <Field label="Sign — type your full name"><input value={f.signature} onChange={(e) => setF({ ...f, signature: e.target.value })} className={inp + " font-semibold"} placeholder="Your full legal name" /></Field>

              {err && <div className="text-[13px] text-red-600">{err}</div>}
              <button onClick={submit} disabled={busy} className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-2xl py-3 text-sm flex items-center justify-center gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Authorize & sign
              </button>
              <p className="text-[11px] text-slate-400 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 shrink-0 text-emerald-500/70" /> Your card is encrypted and visible only to your Fetti loan team. Submitted over a secure connection.</p>
              <p className="text-[10px] text-slate-400">{LICENSING_SHORT}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const inp = "w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-[11px] text-slate-500 mb-1 block">{label}</span>{children}</label>;
}
function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-white flex items-center justify-center px-6 text-center">{children}</div>;
}

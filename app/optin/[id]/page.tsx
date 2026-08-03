// ONE SCREEN, ONE DECISION: may we text you?
//
// Email-only leads reply 0 times out of 128; leads who also get a text reply 20.6%. The only
// invitation we ever made was a line of text inside three of seven drip emails, and 228 sends
// of it produced exactly one grant. This is the ask made properly: the full disclosure, a
// genuinely unchecked box, no re-application, nothing else on the page competing with it.
"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

const DISCLOSURE =
  "I agree that Fetti Financial Services LLC (NMLS #2267023) may send me account, application " +
  "and appointment text messages (SMS) at the number on file. Consent is not a condition of any " +
  "service. Message frequency varies; Msg & data rates may apply. Reply STOP to opt out, HELP for help.";

export default function OptInPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  // UNCHECKED BY DEFAULT, always. A pre-ticked consent box is not consent.
  const [agreed, setAgreed] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "done" | "optedout" | "error">("idle");

  async function submit() {
    if (!agreed) return;
    setState("saving");
    try {
      const r = await fetch("/api/optin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: params.id, t: search.get("t") }),
      });
      if (r.ok) setState("done");
      else setState(r.status === 409 ? "optedout" : "error");
    } catch { setState("error"); }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-5 py-16">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-white">Want updates by text?</h1>
        <p className="mt-3 text-sm text-slate-300 leading-relaxed">
          Most questions on a loan file take one line to answer, and a text gets you a reply the
          same day instead of sitting in an inbox. Nothing changes on your application — this
          only tells us it&apos;s okay to reach you that way.
        </p>

        {state === "done" ? (
          <div className="mt-6 rounded-xl border border-emerald-700/60 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            You&apos;re set — we&apos;ll text you at the number on your file. Reply STOP any time and it stops.
          </div>
        ) : state === "optedout" ? (
          <div className="mt-6 rounded-xl border border-slate-700 bg-slate-900/70 p-4 text-sm text-slate-300">
            You previously asked us to stop texting, so we&apos;ve left it that way. If you&apos;ve
            changed your mind, just send us a text and we&apos;ll pick it up from there.
          </div>
        ) : (
          <>
            <label className="mt-6 flex items-start gap-3 cursor-pointer rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
              />
              <span className="text-[11px] leading-relaxed text-slate-400">{DISCLOSURE}</span>
            </label>
            <button
              onClick={submit}
              disabled={!agreed || state === "saving"}
              className="mt-4 w-full rounded-full bg-emerald-600 py-3 font-bold text-white disabled:opacity-40 hover:bg-emerald-500"
            >
              {state === "saving" ? "Saving…" : "Yes, you can text me"}
            </button>
            {state === "error" && (
              <p className="mt-3 text-sm text-red-400">That link didn&apos;t work. Reply to any of our emails and we&apos;ll sort it out.</p>
            )}
          </>
        )}
      </div>
    </main>
  );
}

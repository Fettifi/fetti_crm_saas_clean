// The root Suspense fallback — it ships inside the SSR'd HTML of EVERY route, including the public
// marketing pages. Two consequences that were live until 2026-08-12:
//
//   1. This markup used an <h1>. So the first h1 Google saw on fettifi.com/lending/dscr-loans-florida
//      was "Fetti CRM", not "DSCR Loans in Florida" — the strongest on-page relevance signal on a
//      page we want ranking for "dscr loan florida" was pointing at the wrong thing, and every
//      public page also carried a duplicate h1.
//   2. It said "Fetti CRM" — internal tooling branding flashed at borrowers on the public site.
//
// A loading splash is not a heading. It is decorative text, so it is a <p>, and it names the
// company rather than the internal tool. Keep it that way: nothing in here may be an h1.
export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900 text-gray-100">
      <div className="flex flex-col items-center gap-4">
        <img
          src="/fetti-logo.png"
          alt="Fetti"
          className="h-32 w-32 rounded-2xl bg-white p-4 shadow-xl"
        />
        <div className="h-10 w-10 rounded-full border-4 border-gray-600 border-t-green-500 animate-spin" />
        <p className="text-2xl font-bold mt-2 tracking-wide">Fetti Financial Services</p>
        <p className="text-sm text-gray-400">We Do Money…</p>
      </div>
    </div>
  );
}

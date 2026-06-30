import Link from "next/link";

// Shared light-theme public header — keeps every marketing/borrower page on-brand.
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/home" className="flex items-center gap-2.5">
          <img src="/fetti-emblem.png" alt="Fetti Financial Services LLC logo" width={36} height={36} className="w-9 h-9" />
          <span className="text-lg font-extrabold tracking-tight text-slate-900">Fetti<span className="text-emerald-600"> Financial Services</span> <span className="text-slate-400 text-[0.7em] font-bold align-middle">LLC</span></span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-5 text-sm">
          <Link href="/lending" className="text-slate-600 hover:text-slate-900 transition hidden md:inline">Programs</Link>
          <Link href="/calculator" className="text-slate-600 hover:text-slate-900 transition hidden md:inline">Calculator</Link>
          <Link href="/quote" className="text-slate-600 hover:text-slate-900 transition hidden sm:inline">Instant Quote</Link>
          <Link href="/apply/form" className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-2 rounded-full transition shadow-sm shadow-emerald-600/20">Apply</Link>
        </nav>
      </div>
    </header>
  );
}

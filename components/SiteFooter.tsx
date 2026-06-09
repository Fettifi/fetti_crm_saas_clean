import Link from "next/link";
import { LICENSING_NOTE } from "@/lib/legal";

// Shared light-theme public footer with brand, tagline, and the compliance note.
export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <img src="/fetti-emblem.png" alt="Fetti Financial Services LLC logo" width={32} height={32} className="w-8 h-8" />
            <div className="leading-tight">
              <span className="font-extrabold tracking-tight text-slate-900">Fetti<span className="text-emerald-600"> Financial Services</span> <span className="text-slate-400 text-[0.7em] font-bold align-middle">LLC</span></span>
              <p className="text-xs font-bold text-emerald-600">We DO Money!</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
            <Link href="/lending" className="hover:text-slate-900 transition">Programs</Link>
            <Link href="/quote" className="hover:text-slate-900 transition">Instant Quote</Link>
            <Link href="/apply/form" className="hover:text-slate-900 transition">Apply</Link>
            <Link href="/privacy" className="hover:text-slate-900 transition">Privacy</Link>
            <Link href="/terms" className="hover:text-slate-900 transition">Terms</Link>
          </nav>
        </div>
        <div className="mt-8 pt-8 border-t border-slate-200 text-xs text-slate-500 leading-relaxed">
          {LICENSING_NOTE}
        </div>
      </div>
    </footer>
  );
}

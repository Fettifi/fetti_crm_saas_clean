export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Workspace Settings</h2>
        <p className="text-xs text-slate-400">
          Configure Fetti CRM for your mortgage & investment pipeline.
        </p>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
        <div>
          <h3 className="text-sm font-semibold mb-1">Supabase Connection</h3>
          <p className="text-xs text-slate-400 mb-3">
            This app reads from your Supabase project using the public anon key. Set these
            values in Vercel or your hosting environment.
          </p>
          <ul className="text-xs space-y-1">
            <li>
              <code className="rounded bg-slate-900 px-2 py-1">NEXT_PUBLIC_SUPABASE_URL</code>
            </li>
            <li>
              <code className="rounded bg-slate-900 px-2 py-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
            </li>
          </ul>
        </div>

        <div className="border-t border-slate-800/80 pt-4">
          <h3 className="text-sm font-semibold mb-1">Branding</h3>
          <p className="text-xs text-slate-400 mb-3">
            Colors and logo are wired for the Fetti brand. You can swap these in
            <code className="mx-1 rounded bg-slate-900 px-1 py-0.5">tailwind.config.ts</code>
            and the <code className="mx-1 rounded bg-slate-900 px-1 py-0.5">Sidebar</code> component.
          </p>
        </div>
      </section>
    </div>
  );
}

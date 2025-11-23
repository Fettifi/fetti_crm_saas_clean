export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="text-sm text-slate-400">
        Workspace settings, Supabase connection, and branding live here.
      </p>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-300 space-y-2">
        <p className="font-semibold text-slate-200">Supabase Connection</p>
        <p>
          This app reads from your Supabase project using the public anon key.
          Set these values in Vercel:
        </p>
        <ul className="list-disc pl-4">
          <li>NEXT_PUBLIC_SUPABASE_URL</li>
          <li>NEXT_PUBLIC_SUPABASE_ANON_KEY</li>
        </ul>
      </div>
    </div>
  );
}

import AppLayout from "@/components/AppLayout";
import CalendlySettings from "@/components/CalendlySettings";
import MetaConnect from "@/components/MetaConnect";

export default function SettingsPage() {
  return (
    <AppLayout
      title="Settings"
      description="Workspace settings, Supabase connection, and branding live here."
    >
      <MetaConnect />
      <CalendlySettings />
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
    </AppLayout>
  );
}

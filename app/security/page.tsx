"use client";

// Staff security settings — enroll multi-factor authentication (TOTP) for GLBA.
// Scan the QR with Google Authenticator / Authy / 1Password, verify once, done.
// Recovery if a device is lost: an admin can remove the factor in the Supabase
// dashboard (Authentication → Users → the user → remove MFA), so no permanent lockout.
import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { ShieldCheck, Loader2, Check, Trash2 } from "lucide-react";

export default function SecurityPage() {
  const [supabase, setSupabase] = useState<any>(null);
  const [factors, setFactors] = useState<any[]>([]);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && key) setSupabase(createBrowserClient(url, key));
  }, []);

  const loadFactors = async (sb: any) => {
    try {
      const { data } = await sb.auth.mfa.listFactors();
      setFactors(data?.totp || []);
    } catch { /* ignore */ }
  };
  useEffect(() => { if (supabase) loadFactors(supabase); }, [supabase]);

  async function startEnroll() {
    setBusy(true); setMsg(null);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Fetti CRM ${Date.now()}` });
      if (error) throw error;
      setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } catch (e: any) { setMsg({ text: e?.message || "Could not start enrollment." }); }
    setBusy(false);
  }

  async function verifyEnroll() {
    if (!enroll || code.length < 6) return;
    setBusy(true); setMsg(null);
    try {
      const { data: ch, error: cErr } = await supabase.auth.mfa.challenge({ factorId: enroll.id });
      if (cErr) throw cErr;
      const { error: vErr } = await supabase.auth.mfa.verify({ factorId: enroll.id, challengeId: ch.id, code });
      if (vErr) throw vErr;
      setMsg({ ok: true, text: "✓ Multi-factor authentication enabled. You'll enter a code at login from now on." });
      setEnroll(null); setCode("");
      await loadFactors(supabase);
    } catch (e: any) { setMsg({ text: e?.message || "Invalid code — try the current 6 digits." }); }
    setBusy(false);
  }

  async function removeFactor(id: string) {
    if (!confirm("Remove this authenticator? You'll no longer be prompted for a code at login.")) return;
    setBusy(true);
    try { await supabase.auth.mfa.unenroll({ factorId: id }); await loadFactors(supabase); }
    catch (e: any) { setMsg({ text: e?.message || "Could not remove." }); }
    setBusy(false);
  }

  const verified = factors.filter((f) => f.status === "verified");

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldCheck className="w-6 h-6 text-emerald-400" /> Security · Multi-Factor Authentication</h1>
        <p className="text-slate-400 text-sm mt-1">Required for compliance (GLBA Safeguards Rule). Adds a 6-digit code from your phone at login.</p>

        {msg && <div className={`mt-4 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-500/10 border border-emerald-500/40 text-emerald-200" : "bg-amber-500/10 border border-amber-500/40 text-amber-200"}`}>{msg.text}</div>}

        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 mt-5">
          {verified.length > 0 ? (
            <>
              <div className="flex items-center gap-2 text-emerald-300 font-semibold"><Check className="w-5 h-5" /> MFA is ON</div>
              <div className="mt-3 space-y-2">
                {verified.map((f) => (
                  <div key={f.id} className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm">
                    <span>🔐 {f.friendly_name || "Authenticator"} · <span className="text-slate-500">added {f.created_at ? new Date(f.created_at).toLocaleDateString() : ""}</span></span>
                    <button onClick={() => removeFactor(f.id)} disabled={busy} className="text-slate-400 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            </>
          ) : enroll ? (
            <>
              <div className="text-sm text-slate-300 mb-3">1) Scan this with <b>Google Authenticator</b>, <b>Authy</b>, or <b>1Password</b>:</div>
              <div className="bg-white rounded-lg p-3 inline-block">
                {/* qr_code is an SVG data URL */}
                <img src={enroll.qr} alt="MFA QR code" width={180} height={180} />
              </div>
              <div className="text-xs text-slate-500 mt-2">Can&apos;t scan? Enter this key manually: <span className="font-mono text-slate-300 break-all">{enroll.secret}</span></div>
              <div className="text-sm text-slate-300 mt-4 mb-1">2) Enter the 6-digit code it shows:</div>
              <div className="flex gap-2">
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="123456"
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm w-32 tracking-widest text-center focus:border-emerald-500 focus:outline-none" />
                <button onClick={verifyEnroll} disabled={busy || code.length < 6} className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm flex items-center gap-2">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Verify & enable
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-400">No authenticator enrolled yet. Add one to secure your account and meet compliance requirements.</p>
              <button onClick={startEnroll} disabled={busy || !supabase} className="mt-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm flex items-center gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Set up authenticator
              </button>
            </>
          )}
        </div>
        <p className="text-[11px] text-slate-600 mt-3">Lost your device? An admin can remove your MFA in the Supabase dashboard (Authentication → Users) so you&apos;re never permanently locked out.</p>
      </div>
    </div>
  );
}

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Shield, Mail, Lock, ArrowRight } from 'lucide-react';

export default function PortalLogin() {
    const router = useRouter();
    const [step, setStep] = useState<'email' | 'code'>('email');
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSendCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const res = await fetch('/api/portal/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'send_code', email })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to send code');

            setStep('code');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const res = await fetch('/api/portal/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'verify_code', email, code })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Invalid code');

            // Store session (simple local storage for demo, cookie in prod)
            localStorage.setItem('portal_session', data.leadId);

            router.push(`/portal/${data.leadId}`);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-slate-900 rounded-2xl border border-slate-800 p-8 shadow-2xl">
                <div className="flex justify-center mb-6">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                        <Shield className="w-8 h-8 text-emerald-500" />
                    </div>
                </div>

                <h1 className="text-2xl font-bold text-white text-center mb-2">Secure Portal Access</h1>
                <p className="text-slate-400 text-center mb-8">
                    {step === 'email' ? "Enter your email to receive a secure access code." : `Enter the code sent to ${email}`}
                </p>

                {error && (
                    <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-3 rounded-lg mb-6 text-sm text-center">
                        {error}
                    </div>
                )}

                {step === 'email' ? (
                    <form onSubmit={handleSendCode} className="space-y-4">
                        <div className="relative">
                            <Mail className="absolute left-3 top-3.5 w-5 h-5 text-slate-500" />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="name@example.com"
                                required
                                className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-3 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {loading ? <Loader2 className="animate-spin" /> : <>Send Code <ArrowRight className="w-4 h-4" /></>}
                        </button>
                    </form>
                ) : (
                    <form onSubmit={handleVerifyCode} className="space-y-4">
                        <div className="relative">
                            <Lock className="absolute left-3 top-3.5 w-5 h-5 text-slate-500" />
                            <input
                                type="text"
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                placeholder="123456"
                                required
                                maxLength={6}
                                className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-white focus:outline-none focus:border-emerald-500 transition-colors tracking-widest text-center text-lg"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-3 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {loading ? <Loader2 className="animate-spin" /> : "Verify & Access"}
                        </button>
                        <button
                            type="button"
                            onClick={() => setStep('email')}
                            className="w-full text-slate-500 text-sm hover:text-slate-300 transition-colors"
                        >
                            Change Email
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}

import React, { useState } from 'react';
import { Copy, Check, Share2 } from 'lucide-react';

export default function ReferralWidget() {
    const [copied, setCopied] = useState(false);
    const referralLink = "https://fetti.app/invite/u/john-doe-123"; // Mock unique link

    const handleCopy = () => {
        navigator.clipboard.writeText(referralLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="bg-slate-900 border border-emerald-500/30 rounded-xl p-6 mt-6 max-w-md mx-auto text-center shadow-2xl shadow-emerald-900/20">
            <div className="flex justify-center mb-4">
                <div className="bg-emerald-500/20 p-3 rounded-full">
                    <Share2 className="w-8 h-8 text-emerald-400" />
                </div>
            </div>

            <h3 className="text-xl font-bold text-white mb-2">Unlock the Full Market Report</h3>
            <p className="text-slate-400 mb-6 text-sm">
                Refer 3 friends to get our $500 Premium Investment Report for free.
            </p>

            {/* Progress Bar */}
            <div className="mb-6">
                <div className="flex justify-between text-xs text-slate-400 mb-2">
                    <span>0 Referrals</span>
                    <span className="text-emerald-400 font-medium">1 / 3 Joined</span>
                    <span>3 Referrals</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 w-1/3 transition-all duration-500" />
                </div>
            </div>

            {/* Link Box */}
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg p-2 mb-4">
                <code className="flex-1 text-slate-300 text-sm truncate px-2">
                    {referralLink}
                </code>
                <button
                    onClick={handleCopy}
                    className="p-2 hover:bg-slate-800 rounded-md transition-colors text-emerald-500"
                >
                    {copied ? <Check size={18} /> : <Copy size={18} />}
                </button>
            </div>

            <p className="text-xs text-slate-500">
                Your friends get fast-tracked approval when they use your link.
            </p>
        </div>
    );
}

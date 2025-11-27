"use client";

import Image from "next/image";

export default function FettiLogo() {
  return (
    <div className="flex items-center space-x-3 p-4">
      <Image
        src="/FETTI-LOGO.png"
        alt="Fetti Logo"
        width={64}      // ⬅️ perfect size: visible but not huge
        height={64}
        priority
      />
      <div>
        <div className="text-xl font-bold text-white">Fetti CRM</div>
        <div className="text-xs text-slate-400">WE DO MONEY.</div>
      </div>
    </div>
  );
}

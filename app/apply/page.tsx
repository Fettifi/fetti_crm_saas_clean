// FETTI DESIGN LOCK:
// This file controls the public /apply multi-step flow and visual design.
// Feature agents MAY wire data and small UX tweaks, but MUST NOT:
// - Replace the overall layout or dark Fetti theme
// - Remove the step-by-step conversational flow
// Major redesigns require an explicit task in fetti_feature_plan.md.

"use client";

"use client";

import ChatInterface from "@/components/apply/ChatInterface";

export default function ApplyPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            Fetti CRM Lead Capture
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Chat with Fetti to start your application. Use voice or upload documents to speed things up!
          </p>
        </div>

        <ChatInterface />
      </div>
    </div>
  );
}


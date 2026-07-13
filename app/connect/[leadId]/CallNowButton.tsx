"use client";
import { useState } from "react";

export default function CallNowButton({ leadId, t }: { leadId: string; t: string }) {
  const [state, setState] = useState<"idle" | "calling" | "team" | "err">("idle");

  const go = async () => {
    setState("calling");
    try {
      const r = await fetch("/api/connect/call-now", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ lead: leadId, t }),
      }).then((x) => x.json());
      if (r.ok && r.calling) setState("calling");
      else if (r.ok) setState("team");
      else setState("err");
    } catch { setState("err"); }
  };

  if (state === "calling")
    return <div style={{ padding: "18px 20px", borderRadius: 16, background: "#052e1a", border: "1px solid #10b981", color: "#d1fae5", fontWeight: 600 }}>📞 Connecting you now — your phone will ring in about a minute. Answer and you&apos;re straight through to our team.</div>;
  if (state === "team")
    return <div style={{ padding: "18px 20px", borderRadius: 16, background: "#0b1220", border: "1px solid #334155", color: "#cbd5e1", fontWeight: 600 }}>Got it — a member of our team will call you shortly. If you&apos;d like a set time, book one above.</div>;
  if (state === "err")
    return <div style={{ padding: "18px 20px", borderRadius: 16, background: "#2a0b12", border: "1px solid #f43f5e", color: "#fecdd3" }}>Something hiccuped — please book a time above and we&apos;ll take great care of you.</div>;

  return (
    <button onClick={go} style={{ width: "100%", padding: "20px", borderRadius: 16, border: "none", background: "#e11d48", color: "#fff", fontSize: 18, fontWeight: 800, cursor: "pointer", textAlign: "left" }}>
      ☎️ Talk right now
      <span style={{ display: "block", fontSize: 14, fontWeight: 500, opacity: 0.9, marginTop: 4 }}>We&apos;ll ring your phone and connect you with our team</span>
    </button>
  );
}

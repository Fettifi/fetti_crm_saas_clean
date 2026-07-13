// Borrower-facing WHITE-GLOVE CONNECT page. Reached from the warm text/email we
// send the moment a borrower finishes their application or uploads documents.
// Three ways to reach a REAL person: book a video call, schedule a phone call, or
// talk right now. HMAC-token gated (no login). Warm, human, mobile-first.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { connectTokenValid, bookingLinks } from "@/lib/connect";
import CallNowButton from "./CallNowButton";

export const dynamic = "force-dynamic";

const shell: React.CSSProperties = { minHeight: "100vh", background: "#05080f", color: "#e2e8f0", fontFamily: "-apple-system,Segoe UI,Arial,sans-serif", padding: "40px 20px" };
const card: React.CSSProperties = { maxWidth: 460, margin: "0 auto" };
const optBase: React.CSSProperties = { display: "block", width: "100%", boxSizing: "border-box", padding: "20px", borderRadius: 16, textDecoration: "none", fontSize: 18, fontWeight: 800, marginBottom: 14, border: "1px solid #1e293b", background: "#0f172a", color: "#f8fafc" };

export default async function ConnectPage({ params, searchParams }: { params: Promise<{ leadId: string }>; searchParams: Promise<{ t?: string }> }) {
  const { leadId } = await params;
  const { t } = await searchParams;

  if (!t || !connectTokenValid(leadId, t || "")) {
    return (
      <div style={shell}><div style={card}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>This link has expired</h1>
        <p style={{ color: "#94a3b8" }}>Reply to our last text or email and we&apos;ll send you a fresh one — we&apos;d love to connect.</p>
      </div></div>
    );
  }

  const { data: lead } = await supabaseAdmin.from("leads").select("first_name, full_name, loan_purpose").eq("id", leadId).maybeSingle();
  const name = String(lead?.first_name || lead?.full_name || "").split(/\s+/)[0];
  const { video, phone } = await bookingLinks();

  return (
    <div style={shell}><div style={card}>
      <div style={{ fontSize: 40, marginBottom: 8 }}>🦉</div>
      <h1 style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.2, margin: "0 0 8px" }}>
        {name ? `${name}, you're in motion.` : "You're in motion."}
      </h1>
      <p style={{ color: "#94a3b8", fontSize: 16, lineHeight: 1.55, margin: "0 0 28px" }}>
        This is the part where a real person from Fetti maps your exact path with you — no forms, no runaround. Pick whatever&apos;s easiest:
      </p>

      {video && (
        <a href={video} target="_blank" rel="noreferrer" style={optBase}>
          📹 Book a video call
          <span style={{ display: "block", fontSize: 14, fontWeight: 500, color: "#94a3b8", marginTop: 4 }}>Pick a time — we&apos;ll send the link</span>
        </a>
      )}
      {phone && (
        <a href={phone} target="_blank" rel="noreferrer" style={optBase}>
          📞 Schedule a phone call
          <span style={{ display: "block", fontSize: 14, fontWeight: 500, color: "#94a3b8", marginTop: 4 }}>Grab a slot that works for you</span>
        </a>
      )}

      <CallNowButton leadId={leadId} t={t || ""} />

      <p style={{ color: "#64748b", fontSize: 13, lineHeight: 1.5, marginTop: 28 }}>
        Fetti Financial Services LLC · NMLS #2267023 · Equal Housing Opportunity. A licensed member of our team will speak with you — we&apos;re here to get you to your goal.
      </p>
    </div></div>
  );
}

// Fire the "Lead" conversion across Meta, TikTok, and Google when someone
// submits an application or quote. Safe to call even if no pixels are configured.
export function trackLead(value?: number) {
  if (typeof window === "undefined") return;
  const w = window as any;
  try { w.fbq?.("track", "Lead", value ? { value, currency: "USD" } : undefined); } catch { /* */ }
  try { w.ttq?.track("SubmitForm", value ? { value, currency: "USD" } : undefined); } catch { /* */ }
  try {
    const sendTo = process.env.NEXT_PUBLIC_GOOGLE_CONVERSION; // "AW-XXXX/label"
    if (w.gtag && sendTo) w.gtag("event", "conversion", { send_to: sendTo, value: value || 0, currency: "USD" });
  } catch { /* */ }
}

// Fire a DISTINCT "completed full application" conversion — lets you bid harder
// in Meta/Google for borrowers who finished the 1003, not just any lead.
export function trackApplication(value?: number) {
  if (typeof window === "undefined") return;
  const w = window as any;
  try { w.fbq?.("track", "SubmitApplication", value ? { value, currency: "USD" } : undefined); } catch { /* */ }
  try { w.ttq?.track("CompleteRegistration", value ? { value, currency: "USD" } : undefined); } catch { /* */ }
  try {
    const sendTo = process.env.NEXT_PUBLIC_GOOGLE_APP_CONVERSION || process.env.NEXT_PUBLIC_GOOGLE_CONVERSION;
    if (w.gtag && sendTo) w.gtag("event", "conversion", { send_to: sendTo, value: value || 0, currency: "USD" });
  } catch { /* */ }
}

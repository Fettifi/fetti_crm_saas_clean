// Client half of the lead shield's timing check. Forms call armFormShield()
// on mount (fetches a SERVER-SIGNED timestamp token) and spread shieldFields()
// into the /api/apply payload. The server trusts only the signed token's age —
// `ft`/`js` are advisory. Everything fails soft: no token just means a weak
// +15 signal server-side, never a blocked borrower.
let fstToken: string | null = null;
let mountedAt = 0;

export async function armFormShield(): Promise<void> {
  mountedAt = Date.now();
  try {
    const r = await fetch("/api/apply/token", { cache: "no-store" });
    const j = await r.json();
    fstToken = typeof j?.fst === "string" ? j.fst : null;
  } catch { fstToken = null; }
}

export function shieldFields(): { fst?: string; ft?: number; js: 1 } {
  return {
    ...(fstToken ? { fst: fstToken } : {}),
    ...(mountedAt ? { ft: Date.now() - mountedAt } : {}),
    js: 1,
  };
}

/** Fire the ad pixel ONLY for real, shield-passed leads (bots/honeypot get tracking:false). */
export function shouldTrack(j: any): boolean {
  return !!j?.lead_id && j?.tracking !== false;
}

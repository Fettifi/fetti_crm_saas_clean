// A FILE THE BORROWER AND THE BROKER AGREED NOT TO WORK YET.
//
// 2026-10-14. Ramon spoke to Andrej Strapko by phone and agreed that nothing moves on the other four
// properties until 78 Oxford St in Rochester closes. That agreement lives in a conversation; the
// LOS knows nothing about it. All four files are status=active, stage=Application, each with seven
// required documents outstanding and his email on the row — which is precisely the shape "Remind
// All" sweeps up. One click and the borrower gets four more chases on files his broker just told
// him were parked, which is the kind of thing that makes a client stop trusting the paperwork.
//
// `mayChaseDocs(status, stage)` cannot express this. Those columns describe where a file IS, and a
// hold is about what we have PROMISED — a different fact, and one no stage value is honest about.
// Setting stage to "Closed" to silence the chaser would be a lie told to a pipeline report.
//
// So: an explicit, reasoned, per-file hold. It carries WHY and WHEN, because a hold with no reason
// becomes a mystery nobody dares lift. Stored in app_settings (no migration available from here;
// the e-sign envelopes use the same table) under `chase_hold:<loanFileId>`.
//
// This suppresses OUTBOUND CHASING ONLY. It is not a freeze on the file: documents still upload,
// conditions still clear, and a borrower-initiated action is never blocked. Lifting it is one
// delete.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

export type ChaseHold = {
  loanFileId: string;
  reason: string;      // shown to the LO, so write it for a human
  at: string;          // ISO
  by?: string | null;
  until?: string | null; // free text: the condition that lifts it, e.g. "78 Oxford St closes"
};

const KEY = (id: string) => `chase_hold:${id}`;

/** Every hold, as a map. One query — the bulk chaser must not issue a lookup per file. */
export async function getChaseHolds(): Promise<Map<string, ChaseHold>> {
  const out = new Map<string, ChaseHold>();
  try {
    const { data } = await supabaseAdmin
      .from("app_settings").select("key, value").like("key", "chase_hold:%");
    for (const r of data || []) {
      const v = typeof r.value === "string" ? JSON.parse(r.value) : r.value;
      if (v?.loanFileId) out.set(String(v.loanFileId), v as ChaseHold);
    }
  } catch {
    // A hold we cannot read must not become a hold that does not exist. Callers treat a throw as
    // "unknown" and the routes below fail CLOSED rather than chase a file they cannot verify.
    throw new Error("could not read chase holds");
  }
  return out;
}

export async function getChaseHold(loanFileId: string): Promise<ChaseHold | null> {
  const { data } = await supabaseAdmin
    .from("app_settings").select("value").eq("key", KEY(loanFileId)).maybeSingle();
  if (!data) return null;
  const v = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
  return (v || null) as ChaseHold | null;
}

export async function setChaseHold(h: ChaseHold): Promise<void> {
  await supabaseAdmin.from("app_settings").upsert({ key: KEY(h.loanFileId), value: h });
}

export async function clearChaseHold(loanFileId: string): Promise<void> {
  await supabaseAdmin.from("app_settings").delete().eq("key", KEY(loanFileId));
}

/** One line an LO can read without opening anything. */
export const holdLabel = (h: ChaseHold): string =>
  `on hold — ${h.reason}${h.until ? ` (lifts when ${h.until})` : ""}`;

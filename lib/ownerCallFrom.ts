// WHAT CALLER ID PENNY USES WHEN SHE RINGS RAMON.
//
// Deliberately NOT the client-facing number. On 2026-08-06 TWILIO_FROM was switched to the
// toll-free (866) 493-3884 so borrowers see one number everywhere — correct for anything a client
// receives. But that same constant governed the calls Penny places TO Ramon's cell: the press-1
// live transfer and the hot-lead pager. The record is unambiguous:
//
//     Jul 22 – Jul 27, from (920) 754-3647 : completed, completed, completed, completed, completed
//     Aug  5 and Aug 6, from (866) 493-3884: no-answer, no-answer  (0s, $0)
//
// A toll-free number ringing a mobile is precisely what carrier spam filtering and iOS "Silence
// Unknown Callers" suppress. Two data points are not proof, but the asymmetry is stark and the
// cost of being wrong is that he misses a lender holding on the line.
//
// So the two things split: clients see the 866, and the phone in his pocket sees the number it
// has actually been answering for a month. OWNER_CALL_FROM (app_settings) overrides, so switching
// it back later needs no deploy.
import { cfg } from "@/lib/settings";

export async function ownerCallFrom(): Promise<string> {
  const explicit = ((await cfg("OWNER_CALL_FROM")) || "").trim();
  if (explicit) return explicit;
  // The 10DLC line, which has a five-for-five connection record to his cell.
  const legacy = (process.env.TWILIO_VOICE_FROM || "+19207543647").trim();
  return legacy || (process.env.TWILIO_FROM || "").trim();
}

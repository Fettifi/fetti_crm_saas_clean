// Consumer referral loop. Each lead gets a deterministic short code derived from
// its id; sharing fettifi.com/r/<code> tags the new lead's `referrer` with that
// code, so referees trace back to the referrer for tracking (and any reward you
// structure). PURE (client-safe) — no server imports.
//
// RESPA NOTE: paying cash for referrals that result in a closed mortgage is a
// RESPA Section 8 issue. The mechanic here (sharing + attribution + tracking) is
// clean; any monetary reward must be structured with counsel. Reward copy is
// configurable and defaults to a warm, no-cash-promise message.

export function referralCode(leadId: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < leadId.length; i++) { h ^= leadId.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  let h2 = 5381 >>> 0;
  for (let i = 0; i < leadId.length; i++) { h2 = (Math.imul(h2, 33) + leadId.charCodeAt(i)) >>> 0; }
  const s = ((h >>> 0).toString(36) + (h2 >>> 0).toString(36)).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (s + "FETTI").slice(0, 7);
}

const APP = "https://fettifi.com";
export function referralLink(code: string): string { return `${APP}/r/${code}`; }

export function referralShareText(code: string): string {
  return `I'm working with Fetti Financial Services on my mortgage — they actually shop the whole market for you. See what you qualify for in 2 min (no credit pull): ${referralLink(code)}`;
}

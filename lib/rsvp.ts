// THE VOW-RENEWAL GUEST LIST.
//
// Ramon and his wife's vow renewal, Saturday 2026-09-19. People phone in to RSVP, so the
// list has to be writable from a phone call, from a text, and by hand — and every writer
// has to see the same list.
//
// It lives as ONE JSON blob in app_settings rather than its own table. That is deliberate:
// this machine has no Postgres URL, only the Supabase service key, so DDL would need
// Ramon's dashboard — and a guest list is a hundred rows nobody queries relationally.
// Concurrency is handled properly anyway, through casSetting(): read the row, modify,
// write only if updated_at is unchanged, retry on a lost race. Last-writer-wins would
// silently drop an RSVP taken while another was being saved, and a dropped RSVP is
// someone standing outside a venue that isn't expecting them.
//
// Matching is by PHONE, normalized to last-10. A guest who calls twice must not appear
// twice, and "Mike" on Tuesday and "Michael" on Friday from the same number are one guest.
import { getSettingRow, casSetting, getSetting } from "./settings";

export const EVENT_KEY = "rsvp:vow-renewal-2026";
// NOT hard-coded with a name I was never told. The first draft of this file invented a
// name for Ramon's wife and put it on the guest list — a fabricated fact one step away
// from a text message to real guests. It reads from settings, and falls back to a label
// that names nobody.
export const EVENT_LABEL_KEY = "rsvp:vow-renewal-2026:label";
export const EVENT_LABEL_FALLBACK = "our vow renewal";
export const EVENT_DATE = "Saturday, September 19, 2026";

export async function eventLabel(): Promise<string> {
  return (await getSetting(EVENT_LABEL_KEY)) || EVENT_LABEL_FALLBACK;
}

export type RsvpStatus = "yes" | "no" | "maybe";
export type Rsvp = {
  id: string;
  name: string;
  phone: string | null;      // E.164-ish, digits only, last 10 used for matching
  party: number;             // total heads INCLUDING this guest
  status: RsvpStatus;
  note: string | null;
  source: "voice" | "sms" | "manual" | "link";
  confirmed_sent: boolean;   // did we text them a confirmation
  created_at: string;
  updated_at: string;
};

export const last10 = (p: string | null | undefined) => String(p || "").replace(/\D/g, "").slice(-10);

export function summarize(list: Rsvp[]) {
  const yes = list.filter((r) => r.status === "yes");
  const maybe = list.filter((r) => r.status === "maybe");
  const no = list.filter((r) => r.status === "no");
  return {
    responded: list.length,
    yes: yes.length,
    no: no.length,
    maybe: maybe.length,
    // Heads, not responses — the number the venue and the caterer actually need.
    heads_confirmed: yes.reduce((n, r) => n + (Number(r.party) || 1), 0),
    heads_if_maybes_come: [...yes, ...maybe].reduce((n, r) => n + (Number(r.party) || 1), 0),
  };
}

async function read(): Promise<{ list: Rsvp[]; stamp: string | null }> {
  const row = await getSettingRow(EVENT_KEY);
  if (!row?.value) return { list: [], stamp: row?.updated_at ?? null };
  try {
    const parsed = JSON.parse(row.value);
    return { list: Array.isArray(parsed) ? parsed : [], stamp: row.updated_at ?? null };
  } catch {
    // A corrupt blob must not read as "no guests" — that would let the next write erase
    // the real list. Refuse loudly instead.
    throw new Error(`${EVENT_KEY} is not valid JSON — refusing to overwrite the guest list`);
  }
}

export async function listRsvps(): Promise<Rsvp[]> {
  return (await read()).list;
}

export type UpsertInput = {
  name: string;
  phone?: string | null;
  party?: number;
  status?: RsvpStatus;
  note?: string | null;
  source?: Rsvp["source"];
};

/** Record or update one RSVP. Returns the row and whether this replaced an earlier answer. */
export async function upsertRsvp(input: UpsertInput): Promise<{ rsvp: Rsvp; changed: boolean; previous: RsvpStatus | null }> {
  const name = String(input.name || "").trim().slice(0, 80);
  if (!name) throw new Error("a name is required");
  const phoneDigits = last10(input.phone);
  const party = Math.min(Math.max(Number(input.party) || 1, 1), 20);
  const status: RsvpStatus = input.status || "yes";

  // Retry the whole read-modify-write on a lost race, never merge stale state.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { list, stamp } = await read();
    const idx = phoneDigits
      ? list.findIndex((r) => last10(r.phone) === phoneDigits)
      : list.findIndex((r) => r.name.toLowerCase() === name.toLowerCase() && !r.phone);
    const now = new Date().toISOString();
    const prev = idx >= 0 ? list[idx] : null;

    const rsvp: Rsvp = {
      id: prev?.id || `r_${now.replace(/\D/g, "")}_${Math.abs(hash(name + phoneDigits)).toString(36)}`,
      name,
      phone: phoneDigits || prev?.phone || null,
      party,
      status,
      note: input.note ?? prev?.note ?? null,
      source: input.source || prev?.source || "manual",
      // A changed answer deserves a fresh confirmation, so clear the flag when it moves.
      confirmed_sent: prev && prev.status === status && prev.party === party ? prev.confirmed_sent : false,
      created_at: prev?.created_at || now,
      updated_at: now,
    };

    const next = [...list];
    if (idx >= 0) next[idx] = rsvp; else next.push(rsvp);

    if (await casSetting(EVENT_KEY, stamp, JSON.stringify(next))) {
      return { rsvp, changed: !!prev, previous: prev?.status ?? null };
    }
  }
  throw new Error("the guest list was being written by someone else — try again");
}

export async function markConfirmationSent(id: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { list, stamp } = await read();
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const next = [...list];
    next[idx] = { ...next[idx], confirmed_sent: true };
    if (await casSetting(EVENT_KEY, stamp, JSON.stringify(next))) return;
  }
}

export async function removeRsvp(id: string): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { list, stamp } = await read();
    const next = list.filter((r) => r.id !== id);
    if (next.length === list.length) return false;
    if (await casSetting(EVENT_KEY, stamp, JSON.stringify(next))) return true;
  }
  return false;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}

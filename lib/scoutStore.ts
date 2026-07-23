// Deal Scout persistence — FSBO acquisition targets Ramon negotiates directly
// (as the BUYER, no listing agents). Same storage-agnostic DAL pattern as
// lib/scenarioStore.ts: one JSON doc in the service-role-only app_settings
// table under key "SCOUT_DEALS" — zero new DDL. Deal volume is tiny (dozens),
// and every caller goes through these functions, so moving to a dedicated
// table later is an internal change here only.
//
// IMPORTANT: scout deals are deliberately NOT rows in `leads`. Sellers are not
// borrowers — inserting them there would put them in the nurture/concierge
// blast radius. All seller outreach happens only from the /scout endpoints,
// one explicit human click per deal.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

const KEY = "SCOUT_DEALS";

export type ScoutStatus =
  | "new"            // imported, not yet reviewed
  | "verified"       // Ramon eyeballed it: worth pursuing
  | "invited"        // meeting invite (SMS/email + Calendly) sent to seller
  | "replied"        // seller responded (manual mark or inbound hook)
  | "meeting_booked" // seller booked on Calendly
  | "loi_sent"       // offer letter delivered
  | "under_contract" // deal moving
  | "passed";        // archived

export type ScoutEvent = { at: string; kind: string; detail?: string };

export type ScoutLoi = {
  offer_price: number;
  earnest?: number | null;
  close_days?: number | null;
  inspection_days?: number | null;
  financing?: string | null;
  valid_days?: number | null;
  sent_at?: string | null;
  sign_link?: string | null;     // /sign/<recipientToken> when routed through e-sign
  esign_token?: string | null;   // envelope token
};

export type ScoutDeal = {
  id: string;
  address: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  price: number;                 // asking price
  monthly_rent?: number | null;  // rent estimate used for DSCR
  // DSCR screen results (flattened from the scorer's `analysis`)
  dscr_at_max_ltv?: number | null;
  breakeven_ltv?: number | null;
  max_loan_at_target_dscr?: number | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  property_type?: string | null;
  days_on_market?: number | null;
  url?: string | null;
  // direct-to-seller contact (FSBO)
  seller_name?: string | null;
  seller_phone?: string | null;
  seller_email?: string | null;
  // workflow
  status: ScoutStatus;
  optout?: boolean;              // seller asked not to be contacted — hard stop
  notes?: string | null;
  events: ScoutEvent[];
  loi?: ScoutLoi | null;
  created_at: string;
  updated_at: string;
};

// app_settings.value may be text or jsonb — handle both (same as scenarioStore).
async function readAll(): Promise<ScoutDeal[]> {
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
    const v = (data as any)?.value;
    if (v == null) return [];
    const parsed = typeof v === "string" ? JSON.parse(v || "[]") : v;
    return Array.isArray(parsed) ? (parsed as ScoutDeal[]) : [];
  } catch { return []; }
}

async function writeAll(arr: ScoutDeal[]): Promise<void> {
  await supabaseAdmin
    .from("app_settings")
    .upsert({ key: KEY, value: JSON.stringify(arr), updated_at: new Date().toISOString() }, { onConflict: "key" });
}

// Stable id from the property identity so re-importing a refreshed scrape
// merges into the same deal (status/events survive) instead of duplicating.
export function dealId(address: string, zip?: string | null): string {
  const s = `${address} ${zip || ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, 80) || "deal";
}

export async function listDeals(): Promise<ScoutDeal[]> {
  const arr = await readAll();
  // Strongest cash-flow first (matches the scorer's ranking), passed deals last.
  return arr.sort((a, b) => {
    if ((a.status === "passed") !== (b.status === "passed")) return a.status === "passed" ? 1 : -1;
    return (b.dscr_at_max_ltv || 0) - (a.dscr_at_max_ltv || 0);
  });
}

export async function getDeal(id: string): Promise<ScoutDeal | null> {
  const arr = await readAll();
  return arr.find((d) => d.id === id) || null;
}

export async function saveDeal(d: ScoutDeal): Promise<ScoutDeal> {
  const arr = await readAll();
  const now = new Date().toISOString();
  const next: ScoutDeal = { ...d, updated_at: now, events: Array.isArray(d.events) ? d.events : [] };
  const idx = arr.findIndex((x) => x.id === d.id);
  if (idx >= 0) arr[idx] = next; else arr.unshift(next);
  await writeAll(arr);
  return next;
}

export async function deleteDeal(id: string): Promise<void> {
  const arr = await readAll();
  await writeAll(arr.filter((d) => d.id !== id));
}

/** Append an event and optionally advance status, in one write. */
export async function recordEvent(
  id: string,
  kind: string,
  detail?: string,
  status?: ScoutStatus
): Promise<ScoutDeal | null> {
  const arr = await readAll();
  const idx = arr.findIndex((x) => x.id === id);
  if (idx < 0) return null;
  const now = new Date().toISOString();
  const d = arr[idx];
  d.events = [...(d.events || []), { at: now, kind, ...(detail ? { detail } : {}) }];
  if (status) d.status = status;
  d.updated_at = now;
  arr[idx] = d;
  await writeAll(arr);
  return d;
}

/** Import scored listings from the deal-scout screener (accepts its JSON export
 *  verbatim — scorer field names like `monthly_rent`/`zip_code` are mapped).
 *  Merges by stable id: fresh market data updates, workflow fields survive. */
export async function importDeals(rows: any[]): Promise<{ added: number; updated: number }> {
  const arr = await readAll();
  const now = new Date().toISOString();
  let added = 0, updated = 0;
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const address = String(r.address || "").trim();
    const price = Number(r.price) || 0;
    if (!address || price <= 0) continue;
    const zip = r.zip ?? r.zip_code ?? null;
    const id = dealId(address, zip);
    const fresh = {
      address,
      city: r.city ?? null,
      state: r.state ?? null,
      zip: zip != null ? String(zip) : null,
      price,
      monthly_rent: Number(r.monthly_rent ?? r.rent) || null,
      dscr_at_max_ltv: Number(r.dscr_at_max_ltv) || null,
      breakeven_ltv: Number(r.breakeven_ltv) || null,
      max_loan_at_target_dscr: Number(r.max_loan_at_target_dscr) || null,
      beds: r.beds ?? null,
      baths: r.baths ?? null,
      sqft: r.sqft ?? null,
      property_type: r.property_type ?? null,
      days_on_market: r.days_on_market ?? null,
      url: r.url ?? null,
      seller_name: r.seller_name || null,
      seller_phone: r.seller_phone ? String(r.seller_phone) : null,
      seller_email: r.seller_email || null,
    };
    const idx = arr.findIndex((x) => x.id === id);
    if (idx >= 0) {
      // Never let a re-import clobber workflow state or a manually-added contact.
      const prev = arr[idx];
      arr[idx] = {
        ...prev,
        ...fresh,
        seller_name: fresh.seller_name || prev.seller_name,
        seller_phone: fresh.seller_phone || prev.seller_phone,
        seller_email: fresh.seller_email || prev.seller_email,
        updated_at: now,
      };
      updated++;
    } else {
      arr.unshift({
        id, ...fresh, status: "new", events: [{ at: now, kind: "imported" }],
        created_at: now, updated_at: now,
      } as ScoutDeal);
      added++;
    }
  }
  await writeAll(arr);
  return { added, updated };
}

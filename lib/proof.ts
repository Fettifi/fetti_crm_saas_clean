// Social-proof data layer.
//
// CORE RULE: this module only ever surfaces REAL, verifiable proof — real Google
// reviews authored by real customers, and borrower wins that were explicitly
// CONSENTED to and approved by an admin. Nothing is fabricated or seeded. That is
// deliberate: fake reviews/followers are an FTC violation for a lender (16 CFR
// Part 465) and platform-ban bait. Real proof is the only kind we display.
//
// Storage: app_settings (key/value JSON), written only via the service-role
// admin client on the server. We do NOT create a dedicated table because DDL
// isn't reachable headlessly in this environment — this matches how the rest of
// the CRM persists runtime data (scenarios, pricer model, ad ideas, etc.).

import { randomUUID } from "crypto";
import { getSetting, setSetting, cfg } from "@/lib/settings";

// ---- keys -------------------------------------------------------------------
const TESTIMONIALS_KEY = "TESTIMONIALS";          // JSON array of Testimonial
const GOOGLE_CACHE_KEY = "GOOGLE_REVIEWS_CACHE";  // JSON GoogleCache
const PLACE_ID_KEY = "GOOGLE_PLACE_ID";           // string (Google Business place id)

// How long a cached Google pull is considered fresh (ms). Google Places returns
// at most ~5 reviews per call and rate-limits, so we cache aggressively.
const GOOGLE_TTL_MS = 1000 * 60 * 60 * 12; // 12h

// Hard ceiling on stored testimonials so a flood of (pending) submissions can't
// bloat the app_settings JSON. Approved+public wins are always kept; only the
// oldest non-public entries are pruned when over the cap.
const MAX_TESTIMONIALS = 3000;

// ---- types ------------------------------------------------------------------
export type TestimonialStatus = "pending" | "approved" | "rejected";

export type Testimonial = {
  id: string;
  source: "borrower" | "manual";   // borrower self-submit vs admin-entered
  author_name: string;             // "John M." — first name + last initial only
  author_location?: string;        // "Tampa, FL"
  loan_type?: string;              // dscr | fix-and-flip | home-purchase | ...
  loan_amount?: number | null;
  state?: string;
  rating: number;                  // 1..5
  quote: string;
  closing_date?: string | null;    // ISO date
  consent: boolean;                // explicit permission to publish
  status: TestimonialStatus;
  public: boolean;                 // shown publicly only when true
  created_at: string;
  updated_at: string;
};

export type GoogleReview = {
  id: string;
  source: "google";
  author_name: string;
  author_photo?: string;
  rating: number;
  quote: string;
  relative_time?: string;          // "a month ago"
  profile_url?: string;
};

type GoogleCache = {
  fetched_at: number;
  place_id: string;
  rating: number | null;
  count: number;
  reviews: GoogleReview[];
};

export type ProofData = {
  hasProof: boolean;
  rating: number | null;           // aggregate star rating (Google) if available
  count: number;                   // total Google rating count
  reviews: GoogleReview[];         // real Google reviews (>= 4 stars)
  wins: Testimonial[];             // approved + public borrower wins
};

// ---- testimonials (borrower wins) ------------------------------------------
async function readTestimonials(): Promise<Testimonial[]> {
  const raw = await getSetting(TESTIMONIALS_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as Testimonial[]) : [];
  } catch {
    return [];
  }
}

async function writeTestimonials(list: Testimonial[]): Promise<void> {
  await setSetting(TESTIMONIALS_KEY, JSON.stringify(enforceCap(list)));
}

// Keep all published wins; if we're over the cap, drop the oldest non-public
// (rejected/pending) entries first. Published proof is never pruned.
function enforceCap(list: Testimonial[]): Testimonial[] {
  if (list.length <= MAX_TESTIMONIALS) return list;
  const keep = list.filter((t) => t.public && t.status === "approved");
  const rest = list
    .filter((t) => !(t.public && t.status === "approved"))
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")); // newest first
  const room = Math.max(0, MAX_TESTIMONIALS - keep.length);
  return [...keep, ...rest.slice(0, room)];
}

/** All testimonials, newest first — admin/moderation view. */
export async function listTestimonials(): Promise<Testimonial[]> {
  const list = await readTestimonials();
  return list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

/** Only approved + public wins, newest closing first — what the public sees. */
export async function approvedWins(loanType?: string): Promise<Testimonial[]> {
  const list = await readTestimonials();
  return list
    .filter((t) => t.public && t.status === "approved" && t.consent)
    .filter((t) => (loanType ? normalizeType(t.loan_type) === normalizeType(loanType) : true))
    .sort((a, b) => (b.closing_date || b.created_at || "").localeCompare(a.closing_date || a.created_at || ""));
}

function normalizeType(t?: string): string {
  return (t || "").toLowerCase().replace(/[^a-z]/g, "");
}

type NewTestimonial = {
  source?: "borrower" | "manual";
  author_name: string;
  author_location?: string;
  loan_type?: string;
  loan_amount?: number | null;
  state?: string;
  rating?: number;
  quote: string;
  closing_date?: string | null;
  consent: boolean;
  // admin-entered wins can be auto-approved; borrower submissions never are.
  approve?: boolean;
};

export async function addTestimonial(input: NewTestimonial): Promise<Testimonial> {
  const now = new Date().toISOString();
  const source = input.source === "manual" ? "manual" : "borrower";
  const approved = source === "manual" && input.approve === true && input.consent === true;
  const t: Testimonial = {
    id: randomUUID(),
    source,
    author_name: cleanName(input.author_name).slice(0, 60),
    author_location: trimUndef(input.author_location, 80),
    loan_type: trimUndef(input.loan_type, 40),
    loan_amount:
      typeof input.loan_amount === "number" && isFinite(input.loan_amount) && input.loan_amount > 0
        ? input.loan_amount
        : null,
    state: trimUndef(input.state, 24),
    rating: clampRating(input.rating),
    quote: String(input.quote || "").trim().slice(0, 600),
    closing_date: input.closing_date || null,
    consent: input.consent === true,
    status: approved ? "approved" : "pending",
    public: approved,
    created_at: now,
    updated_at: now,
  };
  const list = await readTestimonials();
  list.push(t);
  await writeTestimonials(list);
  return t;
}

export async function updateTestimonial(
  id: string,
  patch: Partial<Pick<Testimonial, "status" | "public" | "quote" | "author_name" | "author_location" | "loan_type" | "loan_amount" | "state" | "rating">>
): Promise<Testimonial | null> {
  const list = await readTestimonials();
  const i = list.findIndex((t) => t.id === id);
  if (i < 0) return null;
  const next: Testimonial = { ...list[i], ...patch, updated_at: new Date().toISOString() };
  // Approving publishes; rejecting un-publishes. A win can only be public if it
  // is approved AND carries consent — belt-and-suspenders against accidental
  // exposure of an unconsented quote.
  if (patch.status === "approved") next.public = next.consent === true;
  if (patch.status === "rejected") next.public = false;
  if (typeof patch.rating === "number") next.rating = clampRating(patch.rating);
  list[i] = next;
  await writeTestimonials(list);
  return next;
}

export async function deleteTestimonial(id: string): Promise<boolean> {
  const list = await readTestimonials();
  const next = list.filter((t) => t.id !== id);
  if (next.length === list.length) return false;
  await writeTestimonials(next);
  return true;
}

// ---- google reviews ---------------------------------------------------------
function googleKey(): string {
  return (
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ||
    ""
  );
}

export async function getPlaceId(): Promise<string | null> {
  return (await cfg(PLACE_ID_KEY)) || null;
}

export async function setPlaceId(placeId: string): Promise<void> {
  await setSetting(PLACE_ID_KEY, String(placeId || "").trim());
}

async function readGoogleCache(): Promise<GoogleCache | null> {
  const raw = await getSetting(GOOGLE_CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GoogleCache;
  } catch {
    return null;
  }
}

/**
 * Pull live reviews from the Google Places API (New) for the configured place,
 * keep only >= 4 stars, and cache. Real third-party reviews only. Returns the
 * cache (or null if not configured / on error — callers degrade gracefully).
 */
export async function syncGoogleReviews(force = false): Promise<GoogleCache | null> {
  const placeId = await getPlaceId();
  const key = googleKey();
  if (!placeId || !key) return readGoogleCache(); // nothing configured — keep whatever we had

  if (!force) {
    const cached = await readGoogleCache();
    if (cached && cached.place_id === placeId && Date.now() - cached.fetched_at < GOOGLE_TTL_MS) {
      return cached;
    }
  }

  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "rating,userRatingCount,reviews",
      },
      // Server-side; don't let Next cache the upstream call (we cache ourselves).
      cache: "no-store",
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn("[proof] Google Places error:", j?.error?.message || res.status);
      return readGoogleCache();
    }
    const reviews: GoogleReview[] = (Array.isArray(j.reviews) ? j.reviews : [])
      .map((r: any, idx: number): GoogleReview => ({
        id: `g_${placeId}_${idx}`,
        source: "google",
        author_name: r?.authorAttribution?.displayName || "Google reviewer",
        author_photo: safeGooglePhoto(r?.authorAttribution?.photoUri),
        rating: Number(r?.rating) || 0,
        quote: String(r?.originalText?.text || r?.text?.text || "").trim(),
        relative_time: r?.relativePublishTimeDescription || undefined,
        profile_url: r?.authorAttribution?.uri || undefined,
      }))
      .filter((r: GoogleReview) => r.rating >= 4 && r.quote.length > 0);

    const cache: GoogleCache = {
      fetched_at: Date.now(),
      place_id: placeId,
      rating: typeof j.rating === "number" ? j.rating : null,
      count: typeof j.userRatingCount === "number" ? j.userRatingCount : 0,
      reviews,
    };
    await setSetting(GOOGLE_CACHE_KEY, JSON.stringify(cache));
    return cache;
  } catch (e: any) {
    console.warn("[proof] Google sync failed:", e?.message || e);
    return readGoogleCache();
  }
}

// ---- public aggregate -------------------------------------------------------
/**
 * The single read used by every public surface. Pulls cached Google reviews
 * (refreshing in the background if stale) and approved borrower wins. Never
 * throws — on any failure it returns an empty, badge-only proof set so the page
 * still renders truthful credential badges.
 */
export async function getProofData(loanType?: string): Promise<ProofData> {
  try {
    const [cache, wins] = await Promise.all([syncGoogleReviews(false), approvedWins(loanType)]);
    const reviews = cache?.reviews ?? [];
    return {
      hasProof: reviews.length > 0 || wins.length > 0,
      rating: cache?.rating ?? null,
      count: cache?.count ?? 0,
      reviews,
      wins,
    };
  } catch {
    return { hasProof: false, rating: null, count: 0, reviews: [], wins: [] };
  }
}

// ---- helpers ----------------------------------------------------------------
// Only trust reviewer avatars served from Google's own image hosts over https.
// Anything else is dropped so we never render an attacker-influenced <img src>.
function safeGooglePhoto(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const ok =
      u.protocol === "https:" &&
      (u.hostname.endsWith(".googleusercontent.com") ||
        u.hostname.endsWith(".gstatic.com") ||
        u.hostname.endsWith(".google.com"));
    return ok ? url : undefined;
  } catch {
    return undefined;
  }
}

function clampRating(n?: number): number {
  const r = Math.round(Number(n));
  if (!isFinite(r)) return 5;
  return Math.min(5, Math.max(1, r));
}

function trimUndef(s?: string, max = 120): string | undefined {
  const v = (s || "").trim().slice(0, max);
  return v ? v : undefined;
}

/**
 * Privacy guard: collapse a full last name to an initial so we never publish a
 * borrower's full identity (e.g. "John Smith" -> "John S."). First-name-only and
 * already-initialled inputs pass through unchanged.
 */
function cleanName(name: string): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || "A Fetti client";
  const first = parts[0];
  const lastInitial = parts[parts.length - 1][0]?.toUpperCase();
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

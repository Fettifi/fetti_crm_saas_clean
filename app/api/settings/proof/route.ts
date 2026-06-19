// ADMIN moderation + config for social proof. Under the /api/settings prefix, so
// proxy.ts already gates it to authenticated CRM users (401 otherwise).
//
// GET  -> all testimonials (incl. pending) + Google config/status
// POST -> { action: 'add' | 'approve' | 'reject' | 'delete' | 'set_place_id' | 'sync_google', ... }
import { NextRequest, NextResponse } from "next/server";
import {
  listTestimonials,
  addTestimonial,
  updateTestimonial,
  deleteTestimonial,
  getPlaceId,
  setPlaceId,
  syncGoogleReviews,
} from "@/lib/proof";

export const dynamic = "force-dynamic";

export async function GET() {
  const [testimonials, placeId, cache] = await Promise.all([
    listTestimonials(),
    getPlaceId(),
    syncGoogleReviews(false),
  ]);
  return NextResponse.json({
    testimonials,
    google: {
      placeId: placeId || "",
      configured: !!placeId,
      rating: cache?.rating ?? null,
      count: cache?.count ?? 0,
      reviews: cache?.reviews?.length ?? 0,
      fetched_at: cache?.fetched_at ?? null,
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const action = String(body.action || "");

  try {
    switch (action) {
      case "add": {
        if (!body.author_name || !body.quote) {
          return NextResponse.json({ error: "Name and quote are required." }, { status: 422 });
        }
        if (body.consent !== true) {
          return NextResponse.json({ error: "Mark consent to publish this win." }, { status: 422 });
        }
        const t = await addTestimonial({
          source: "manual",
          author_name: body.author_name,
          author_location: body.author_location,
          loan_type: body.loan_type,
          loan_amount: typeof body.loan_amount === "number" ? body.loan_amount : undefined,
          state: body.state,
          rating: body.rating,
          quote: body.quote,
          closing_date: body.closing_date,
          consent: true,
          approve: true, // admin-entered + consented -> publish immediately
        });
        return NextResponse.json({ ok: true, testimonial: t });
      }
      case "approve": {
        const t = await updateTestimonial(String(body.id), { status: "approved" });
        if (!t) return NextResponse.json({ error: "Not found." }, { status: 404 });
        return NextResponse.json({ ok: true, testimonial: t });
      }
      case "reject": {
        const t = await updateTestimonial(String(body.id), { status: "rejected" });
        if (!t) return NextResponse.json({ error: "Not found." }, { status: 404 });
        return NextResponse.json({ ok: true, testimonial: t });
      }
      case "delete": {
        const ok = await deleteTestimonial(String(body.id));
        return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
      }
      case "set_place_id": {
        await setPlaceId(String(body.placeId || ""));
        const cache = await syncGoogleReviews(true); // pull immediately with the new id
        return NextResponse.json({
          ok: true,
          google: { configured: !!body.placeId, rating: cache?.rating ?? null, count: cache?.count ?? 0, reviews: cache?.reviews?.length ?? 0 },
        });
      }
      case "sync_google": {
        const cache = await syncGoogleReviews(true);
        return NextResponse.json({
          ok: true,
          google: { rating: cache?.rating ?? null, count: cache?.count ?? 0, reviews: cache?.reviews?.length ?? 0 },
        });
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error." }, { status: 500 });
  }
}

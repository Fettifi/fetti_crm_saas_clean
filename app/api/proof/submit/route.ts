// PUBLIC borrower-submission endpoint. A real client shares a win here. It lands
// as PENDING + private and never appears publicly until an admin approves it in
// /settings/proof — so this open endpoint can't be used to inject visible fake
// reviews. Consent is required and recorded.
import { NextRequest, NextResponse } from "next/server";
import { addTestimonial } from "@/lib/proof";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Per-IP throttle (5 submissions / hour). Pairs with the honeypot + the
  // admin-approval gate so this open endpoint can't be used to flood moderation.
  if (!(await rateLimit(`proof-submit:${clientIp(req)}`, 5, 3600))) {
    return NextResponse.json(
      { error: "You've submitted a few times already — thanks! Please try again later." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => ({} as any));

  // Honeypot: bots fill hidden fields. Humans never touch `company`.
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return NextResponse.json({ ok: true }, { status: 200 }); // silently drop
  }

  const author_name = String(body.author_name || "").trim();
  const quote = String(body.quote || "").trim();
  const consent = body.consent === true || body.consent === "true";

  if (!author_name || author_name.length < 2) {
    return NextResponse.json({ error: "Please add your name." }, { status: 422 });
  }
  if (!quote || quote.length < 10) {
    return NextResponse.json({ error: "Please share a sentence about your experience." }, { status: 422 });
  }
  if (!consent) {
    return NextResponse.json({ error: "We need your permission to share this publicly." }, { status: 422 });
  }

  try {
    await addTestimonial({
      source: "borrower",
      author_name,
      author_location: body.author_location,
      loan_type: body.loan_type,
      loan_amount: typeof body.loan_amount === "number" ? body.loan_amount : undefined,
      state: body.state,
      rating: body.rating,
      quote,
      consent: true,
      approve: false, // borrower submissions ALWAYS go to moderation
    });
    return NextResponse.json({
      ok: true,
      message: "Thank you! Your story is in review and may be featured soon.",
    });
  } catch (e: any) {
    return NextResponse.json({ error: "Could not save right now. Please try again." }, { status: 500 });
  }
}

// Deploy verification: which commit is this domain actually serving?
// Public on purpose (a commit SHA reveals nothing) — it exists so "did the
// deploy really promote to app.fettifi.com?" is a one-curl answer instead of
// guesswork against Vercel's (SAML-locked) API.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    ref: process.env.VERCEL_GIT_COMMIT_REF || null,
    env: process.env.VERCEL_ENV || "local",
  });
}

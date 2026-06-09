// Issue a signed upload URL so the browser can upload a recorded video DIRECTLY to
// Supabase Storage (bypasses Vercel's ~4.5MB request-body limit for serverless
// functions). Returns the path/token to upload with, plus the eventual public URL.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { filename } = await req.json();
    const safe = String(filename || "video.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");
    const ext = safe.includes(".") ? safe.split(".").pop() : "mp4";
    const path = `tiktok/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
    const { data, error } = await supabaseAdmin.storage.from("content").createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ error: error?.message || "could not create upload url" }, { status: 500 });
    const publicUrl = supabaseAdmin.storage.from("content").getPublicUrl(path).data.publicUrl;
    return NextResponse.json({ path: data.path, token: data.token, signedUrl: data.signedUrl, publicUrl });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

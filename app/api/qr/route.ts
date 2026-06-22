import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";

// QR code generator (PNG). Public — encodes a public URL for the show overlay /
// description. Default: the /tv capture link.
//   GET /api/qr?text=https://fettifi.com/tv
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const text = (req.nextUrl.searchParams.get("text") || "https://fettifi.com/tv").slice(0, 600);
  try {
    const png = await QRCode.toBuffer(text, {
      width: 700, margin: 2, errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    });
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "qr failed" }, { status: 500 });
  }
}

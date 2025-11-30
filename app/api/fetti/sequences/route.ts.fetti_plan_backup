import { NextResponse } from "next/server";
import { getFettiSequences } from "@/lib/fettiSequences";

export async function GET() {
  try {
    const fetti = getFettiSequences();
    return NextResponse.json(fetti);
  } catch (err) {
    console.error("Error loading Fetti sequences:", err);
    return new NextResponse("Error loading Fetti sequences", { status: 500 });
  }
}

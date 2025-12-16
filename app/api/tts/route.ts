import { NextRequest, NextResponse } from 'next/server';
import { streamAudio } from '@/lib/integrations/elevenlabs';

export async function POST(req: NextRequest) {
    try {
        const { text, voiceId } = await req.json();

        if (!text) {
            return NextResponse.json({ error: 'Text is required' }, { status: 400 });
        }

        // Preprocess text for better TTS pronunciation
        // 1. Convert Currency: $90,200 -> ninety thousand two hundred dollars
        const spokenText = text.replace(/\$([\d,]+)(\.\d{2})?/g, (match: string, numStr: string, cents: string) => {
            const cleanNum = parseInt(numStr.replace(/,/g, ''), 10);
            const words = numToWords(cleanNum);

            if (cents) {
                const centVal = parseInt(cents.substring(1), 10);
                return `${words} dollars and ${numToWords(centVal)} cents`;
            }
            return `${words} dollars`;
        });

        const audioBuffer = await streamAudio(spokenText, voiceId);

        if (!audioBuffer) {
            console.error('[TTS API] Audio buffer is null. Check server logs for upstream API errors.');
            return NextResponse.json({ error: 'Failed to generate audio. Upstream API failed.' }, { status: 500 });
        }

        return new NextResponse(audioBuffer, {
            headers: {
                'Content-Type': 'audio/mpeg',
                'Content-Length': audioBuffer.byteLength.toString(),
            },
        });

    } catch (error) {
        console.error('TTS API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

function numToWords(n: number): string {
    if (n === 0) return "zero";
    const units = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
    const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

    if (n < 20) return units[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? " " + units[n % 10] : "");
    if (n < 1000) return units[Math.floor(n / 100)] + " hundred" + (n % 100 !== 0 ? " " + numToWords(n % 100) : "");
    if (n < 1000000) return numToWords(Math.floor(n / 1000)) + " thousand" + (n % 1000 !== 0 ? " " + numToWords(n % 1000) : "");
    if (n < 1000000000) return numToWords(Math.floor(n / 1000000)) + " million" + (n % 1000000 !== 0 ? " " + numToWords(n % 1000000) : "");
    if (n < 1000000000000) return numToWords(Math.floor(n / 1000000000)) + " billion" + (n % 1000000000 !== 0 ? " " + numToWords(n % 1000000000) : "");
    return n.toString(); // Fallback for huge numbers
}

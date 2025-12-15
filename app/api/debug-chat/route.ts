import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

async function* runDebugLogic() {
    yield JSON.stringify({ type: 'debug', message: 'Debug stream started' }) + '\n';
    await new Promise(resolve => setTimeout(resolve, 1000));
    yield JSON.stringify({ type: 'debug', message: 'Debug stream working' }) + '\n';
}

export async function POST(req: NextRequest) {
    const stream = new ReadableStream({
        async start(controller) {
            const generator = runDebugLogic();
            try {
                for await (const chunk of generator) {
                    controller.enqueue(new TextEncoder().encode(chunk));
                }
                controller.close();
            } catch (e) {
                console.error("Stream error:", e);
                controller.error(e);
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
        }
    });
}

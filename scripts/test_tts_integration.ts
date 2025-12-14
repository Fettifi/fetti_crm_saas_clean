
import { streamAudio } from '../lib/integrations/elevenlabs';
import fs from 'fs';
import path from 'path';

// Mock process.env if needed, though we rely on hardcoded key for now
// process.env.OPENAI_API_KEY = '...'; 

async function test() {
    try {
        console.log("Testing streamAudio with custom voice NBA1cQRTWFj793Oifdaj...");
        const buffer = await streamAudio("Hello, this is a test of the custom voice.", "NBA1cQRTWFj793Oifdaj");

        if (buffer) {
            console.log("Success! Buffer size:", buffer.byteLength);
            const outputPath = path.join(process.cwd(), "test_output_integration.mp3");
            fs.writeFileSync(outputPath, Buffer.from(buffer));
            console.log("Saved to:", outputPath);
        } else {
            console.error("Failed: Buffer is null");
        }
    } catch (e) {
        console.error("Error executing streamAudio:", e);
    }
}

test();

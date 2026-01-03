
import fetch from 'node-fetch';
import fs from 'fs';

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const VOICE_ID = 'NBA1cQRTWFj793Oifdaj';
const API_KEY = process.env.ELEVENLABS_API_KEY;

async function test() {
    if (!API_KEY) {
        console.error("ELEVENLABS_API_KEY is missing from environment.");
        return;
    }

    console.log(`Testing ElevenLabs with voice ${VOICE_ID}...`);

    try {
        const response = await fetch(`${ELEVENLABS_API_URL}/${VOICE_ID}/stream`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': API_KEY
            },
            body: JSON.stringify({
                text: "Hello, this is a simplified test of the custom voice.",
                model_id: 'eleven_turbo_v2_5',
                voice_settings: { stability: 0.5, similarity_boost: 0.75 }
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            console.error(`Error: ${response.status} - ${err}`);
            return;
        }

        const buffer = await response.arrayBuffer();
        console.log("Success! Buffer size:", buffer.byteLength);
        fs.writeFileSync("test_output_simple.mp3", Buffer.from(buffer));
        console.log("Saved to: test_output_simple.mp3");
    } catch (e) {
        console.error("Fetch Error:", e);
    }
}

test();

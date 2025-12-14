import { NextResponse } from 'next/server';

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const OPENAI_API_URL = 'https://api.openai.com/v1/audio/speech';

// Default Voice IDs
const ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel
const OPENAI_VOICE_ID = 'shimmer'; // Female, clear

export async function streamAudio(text: string, voiceId: string = ELEVENLABS_VOICE_ID): Promise<ArrayBuffer | null> {
    // User-provided keys (Hardcoded for immediate fix)
    const HARDCODED_KEY = 'sk_34414a3f6cf40fd7582612bab354b47b96d438643dfa45c7'; // Verified Valid
    const ENV_OPENAI_KEY = process.env.OPENAI_API_KEY;

    // Helper to determine if a string is an OpenAI voice
    const isOpenAIVoice = (id: string) => ['shimmer', 'alloy', 'echo', 'fable', 'onyx', 'nova'].includes(id);

    // 1. Determine Primary Intent
    const intentIsOpenAI = isOpenAIVoice(voiceId);

    // 2. Select Key (Prioritize Hardcoded if it matches intent, otherwise try to be smart)
    let apiKey = HARDCODED_KEY;

    if (!apiKey) {
        console.warn('TTS API Key is missing.');
        return null;
    }

    // 3. Define the Runners
    const runOpenAI = async (key: string, vId: string) => {
        // Auto-correct typo
        if (key.startsWith('sk_')) key = key.replace('sk_', 'sk-');

        const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'tts-1-hd', input: text, voice: isOpenAIVoice(vId) ? vId : 'shimmer' }),
        });
        if (!response.ok) throw new Error(`OpenAI Error: ${response.statusText}`);
        return await response.arrayBuffer();
    };

    const runElevenLabs = async (key: string, vId: string) => {
        const response = await fetch(`${ELEVENLABS_API_URL}/${isOpenAIVoice(vId) ? ELEVENLABS_VOICE_ID : vId}/stream`, {
            method: 'POST',
            headers: { 'Accept': 'audio/mpeg', 'Content-Type': 'application/json', 'xi-api-key': key },
            body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
        });
        if (!response.ok) throw new Error(`ElevenLabs Error: ${response.statusText}`);
        return await response.arrayBuffer();
    };

    // 4. Execution Strategy: Try Primary -> Catch -> Try Secondary
    try {
        if (intentIsOpenAI) {
            return await runOpenAI(apiKey, voiceId);
        } else {
            return await runElevenLabs(apiKey, voiceId);
        }
    } catch (primaryError) {
        console.warn('Primary TTS failed. Attempting Cross-Provider Fallback...', primaryError);

        try {
            // If Primary was OpenAI, try ElevenLabs with the same key
            if (intentIsOpenAI) {
                return await runElevenLabs(apiKey, voiceId);
            }
            // If Primary was ElevenLabs, try OpenAI with the same key
            else {
                return await runOpenAI(apiKey, voiceId);
            }
        } catch (secondaryError) {
            console.error('All TTS attempts failed.', secondaryError);
            return null;
        }
    }
}

import { NextResponse } from 'next/server';

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const OPENAI_API_URL = 'https://api.openai.com/v1/audio/speech';

// Default Voice IDs
const ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel
const OPENAI_VOICE_ID = 'shimmer'; // Female, clear

export async function streamAudio(text: string, voiceId: string = ELEVENLABS_VOICE_ID): Promise<ArrayBuffer | null> {
    // Keys
    const ENV_ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
    const ENV_OPENAI_KEY = process.env.OPENAI_API_KEY;
    const HARDCODED_KEY = 'sk_34414a3f6cf40fd7582612bab354b47b96d438643dfa45c7'; // Backup (OpenAI)

    // Helper to determine if a string is an OpenAI voice
    const isOpenAIVoice = (id: string) => ['shimmer', 'alloy', 'echo', 'fable', 'onyx', 'nova'].includes(id);

    // Runners
    const runOpenAI = async (key: string, vId: string) => {
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

    // Strategy 1: Explicit Intent (If user asks for OpenAI voice, try OpenAI first)
    if (isOpenAIVoice(voiceId)) {
        if (ENV_OPENAI_KEY) {
            try { return await runOpenAI(ENV_OPENAI_KEY, voiceId); } catch (e) { console.warn('OpenAI Env Key failed', e); }
        }
        // Fallback to hardcoded
        try { return await runOpenAI(HARDCODED_KEY, voiceId); } catch (e) { console.warn('OpenAI Hardcoded Key failed', e); }
    }

    // Strategy 2: Default / ElevenLabs Intent
    // Try ElevenLabs Env Key first
    if (ENV_ELEVENLABS_KEY) {
        try {
            return await runElevenLabs(ENV_ELEVENLABS_KEY, voiceId);
        } catch (e) {
            console.warn('ElevenLabs Env Key failed', e);
        }
    }

    // Fallback: Try OpenAI (Env)
    if (ENV_OPENAI_KEY) {
        try {
            return await runOpenAI(ENV_OPENAI_KEY, voiceId);
        } catch (e) {
            console.warn('OpenAI Fallback (Env) failed', e);
        }
    }

    // Final Fallback: Try OpenAI (Hardcoded)
    try {
        return await runOpenAI(HARDCODED_KEY, voiceId);
    } catch (e) {
        console.error('All TTS attempts failed.', e);
        return null;
    }
}

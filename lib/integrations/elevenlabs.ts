import { NextResponse } from 'next/server';

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const OPENAI_API_URL = 'https://api.openai.com/v1/audio/speech';

// Default Voice IDs
const ELEVENLABS_VOICE_ID = 'NBA1cQRTWFj793Oifdaj'; // Custom Voice (Rupee)
const OPENAI_VOICE_ID = 'shimmer'; // Female, clear

export async function streamAudio(text: string, voiceId: string = ELEVENLABS_VOICE_ID): Promise<ArrayBuffer | null> {
    // Keys
    const ENV_ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
    const ENV_OPENAI_KEY = process.env.OPENAI_API_KEY;
    // SECURITY: never hardcode credentials. The OpenAI fallback uses the env var.
    const HARDCODED_KEY = process.env.OPENAI_API_KEY || '';

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
    if (ENV_ELEVENLABS_KEY) {
        try {
            console.log(`[TTS] Attempting ElevenLabs... (Voice: ${voiceId})`);
            return await runElevenLabs(ENV_ELEVENLABS_KEY, voiceId);
        } catch (e: any) {
            console.warn(`[TTS] ElevenLabs failed: ${e.message}. Falling back to OpenAI.`);
        }
    } else {
        console.warn('[TTS] ELEVENLABS_API_KEY is missing. Falling back to OpenAI.');
    }

    // Fallback: Try OpenAI (Env)
    if (ENV_OPENAI_KEY) {
        try {
            console.log('[TTS] Attempting OpenAI fallback (Env)...');
            return await runOpenAI(ENV_OPENAI_KEY, voiceId);
        } catch (e: any) {
            console.warn(`[TTS] OpenAI Env fallback failed: ${e.message}`);
        }
    }

    // Final Fallback: Try OpenAI (Hardcoded)
    try {
        console.log('[TTS] Attempting Final Fallback (OpenAI Hardcoded)...');
        return await runOpenAI(HARDCODED_KEY, voiceId);
    } catch (e: any) {
        console.error('[TTS CRITICAL FAILURE] All attempts failed.', e.message);
        return null;
    }
}

import { useState, useEffect, useRef } from 'react';

export function useRupeeVoice() {
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [selectedVoice, setSelectedVoice] = useState<string>('');
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [debugStatus, setDebugStatus] = useState<string>('');

    const audioContextRef = useRef<AudioContext | null>(null);

    // Initialize/resume the Web Audio context.
    const initAudioContext = () => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        if (audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume();
        }
    };

    // Resume the Web Audio context on EVERY user interaction (clicking the mic
    // counts). Web Audio is NOT subject to Safari's per-site "Stop Media with
    // Sound" auto-play policy once the context is running — unlike <audio>.play(),
    // which Safari blocks when called from the mic's speech-recognition callback
    // (no fresh gesture). This is what makes mic-triggered ElevenLabs replies
    // actually play on Mac Safari. We keep the listeners (not one-shot) because
    // Safari can re-suspend the context after idle.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const resume = () => {
            try {
                if (!audioContextRef.current) {
                    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                }
                if (audioContextRef.current.state === 'suspended') {
                    audioContextRef.current.resume();
                }
            } catch { /* noop */ }
        };
        window.addEventListener('pointerdown', resume);
        window.addEventListener('keydown', resume);
        window.addEventListener('touchstart', resume);
        return () => {
            window.removeEventListener('pointerdown', resume);
            window.removeEventListener('keydown', resume);
            window.removeEventListener('touchstart', resume);
        };
    }, []);

    // Load Voices
    useEffect(() => {
        if (typeof window === 'undefined') return;

        const loadVoices = () => {
            const available = window.speechSynthesis.getVoices();
            setVoices(available);

            const CUSTOM_VOICE = 'NBA1cQRTWFj793Oifdaj'; // Rupee custom ElevenLabs voice ("Pii")
            const OPENAI_VOICES = ['shimmer', 'alloy', 'echo', 'fable', 'onyx', 'nova'];
            const saved = localStorage.getItem('rupee_voice');
            // Honor a saved NEURAL voice (20-char ElevenLabs id or an OpenAI voice).
            // Migrate any stale BROWSER-voice preference back to the custom voice, so
            // Rupee speaks in the branded ElevenLabs voice by default.
            const isNeural = !!saved && (saved.length === 20 || OPENAI_VOICES.includes(saved));
            if (isNeural) {
                setSelectedVoice(saved as string);
            } else {
                setSelectedVoice(CUSTOM_VOICE);
                localStorage.setItem('rupee_voice', CUSTOM_VOICE);
            }
        };

        loadVoices();
        loadVoices();

        // Use addEventListener for better compatibility
        window.speechSynthesis.addEventListener('voiceschanged', loadVoices);

        return () => {
            window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
        };
    }, []);

    const speakText = async (text: string, voiceOverride?: string) => {
        if (isMuted || typeof window === 'undefined') return;

        const currentVoice = voiceOverride || selectedVoice;

        // Stop any current playback
        window.speechSynthesis.cancel();

        // NEURAL TTS (ElevenLabs / OpenAI)
        const isElevenLabsId = (id: string) => id.length === 20;
        const isOpenAIId = (id: string) => ['shimmer', 'alloy', 'echo', 'fable', 'onyx', 'nova'].includes(id);

        if (isElevenLabsId(currentVoice) || isOpenAIId(currentVoice)) {
            try {
                setDebugStatus(`Requesting ${currentVoice}...`);
                const response = await fetch('/api/tts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, voiceId: currentVoice })
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || `API Error ${response.status}`);
                }

                const arrayBuffer = await response.arrayBuffer();

                // Play through the Web Audio context (resumed on the user's first
                // interaction). Web Audio bypasses Safari's <audio> auto-play policy,
                // so this works even when triggered by the mic transcript callback.
                if (!audioContextRef.current) {
                    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                }
                const ctx = audioContextRef.current;
                if (ctx.state === 'suspended') {
                    try { await ctx.resume(); } catch { /* noop */ }
                }

                const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                const gainNode = ctx.createGain();
                gainNode.gain.value = 2.5; // modest boost; ElevenLabs is a bit quiet
                source.connect(gainNode);
                gainNode.connect(ctx.destination);

                setDebugStatus('Playing neural voice...');
                setIsSpeaking(true);
                source.onended = () => setIsSpeaking(false);
                source.start(0);

                setTimeout(() => setDebugStatus(''), 3000);
                return;
            } catch (e: any) {
                // Neural TTS not configured (no ElevenLabs/OpenAI key) or upstream failed.
                // Fall back to the free, built-in browser voice silently — no scary toast.
                console.warn('Neural TTS unavailable, using browser voice.', e);
                setDebugStatus('Using browser voice');
                setTimeout(() => setDebugStatus(''), 2000);
            }
        } else {
            setDebugStatus(`Using Browser Voice: ${currentVoice}`);
            setTimeout(() => setDebugStatus(''), 3000);
        }

        // BROWSER TTS (Fallback) — always works, no API key needed.
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        const named = (currentVoice && !isElevenLabsId(currentVoice) && !isOpenAIId(currentVoice))
            ? voices.find(v => v.name === currentVoice)
            : undefined;
        // When falling back from a neural voice id, pick a pleasant English voice.
        const chosen = named
            || voices.find(v => /en[-_]US/i.test(v.lang) && /(Samantha|Google US English|Aria|Jenny|Natural|Zira)/i.test(v.name))
            || voices.find(v => /^en/i.test(v.lang));
        if (chosen) utterance.voice = chosen;

        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        window.speechSynthesis.speak(utterance);
    };

    return {
        voices,
        selectedVoice,
        setSelectedVoice,
        isSpeaking,
        isMuted,
        setIsMuted,
        speakText,
        debugStatus,
        initAudioContext
    };
}

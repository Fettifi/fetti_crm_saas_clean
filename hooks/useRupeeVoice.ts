import { useState, useEffect, useRef } from 'react';

export function useRupeeVoice() {
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [selectedVoice, setSelectedVoice] = useState<string>('');
    const selectedVoiceRef = useRef<string>('');
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [debugStatus, setDebugStatus] = useState<string>('');

    const audioContextRef = useRef<AudioContext | null>(null);
    const htmlAudioRef = useRef<HTMLAudioElement | null>(null);
    const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);
    const VOICE_GAIN = 2.8; // amplify ElevenLabs above 100% (1.0 = normal)

    // Kept for compatibility (callers invoke initAudioContext on send).
    const initAudioContext = () => {
        try {
            if (!audioContextRef.current) {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            }
            if (audioContextRef.current.state === 'suspended') audioContextRef.current.resume();
        } catch { /* noop */ }
    };

    // Create ONE reusable <audio> element and unlock it on the first user
    // interaction (clicking the mic / typing counts). HTML5 <audio> plays
    // reliably on Mac Safari (Web Audio was silent there). Priming this element
    // inside a real gesture lets later mic-triggered replies — which have no fresh
    // gesture — play through the same, already-unlocked element.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const audio = new Audio();
        audio.preload = 'auto';
        htmlAudioRef.current = audio;
        const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
        let unlocked = false;
        const unlock = () => {
            if (unlocked) return;
            const a = htmlAudioRef.current;
            if (!a) return;
            try {
                a.src = SILENT;
                const p = a.play();
                if (p) p.then(() => {
                    a.pause();
                    // Build the gain-boost graph INSIDE the gesture so it's audible
                    // on Safari: <audio> -> MediaElementSource -> Gain(>1) -> output.
                    try {
                        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
                        if (!audioContextRef.current) audioContextRef.current = new Ctx();
                        const ctx = audioContextRef.current;
                        if (ctx.state === 'suspended') ctx.resume();
                        if (!mediaSourceRef.current) {
                            mediaSourceRef.current = ctx.createMediaElementSource(a);
                            gainNodeRef.current = ctx.createGain();
                            gainNodeRef.current.gain.value = VOICE_GAIN;
                            mediaSourceRef.current.connect(gainNodeRef.current);
                            gainNodeRef.current.connect(ctx.destination);
                        }
                    } catch (err) { console.warn('voice gain graph unavailable:', err); }
                    unlocked = true;
                }).catch(() => {});
            } catch { /* noop */ }
        };
        window.addEventListener('pointerdown', unlock);
        window.addEventListener('keydown', unlock);
        window.addEventListener('touchstart', unlock);
        return () => {
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
            window.removeEventListener('touchstart', unlock);
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
            const resolved = isNeural ? (saved as string) : CUSTOM_VOICE;
            setSelectedVoice(resolved);
            selectedVoiceRef.current = resolved; // keep ref current for stale-closure callers (mic)
            if (!isNeural) localStorage.setItem('rupee_voice', CUSTOM_VOICE);
        };

        loadVoices();
        loadVoices();

        // Use addEventListener for better compatibility
        window.speechSynthesis.addEventListener('voiceschanged', loadVoices);

        return () => {
            window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
        };
    }, []);

    // Keep the ref in sync with any external change (e.g. the dashboard selector).
    useEffect(() => {
        if (selectedVoice) selectedVoiceRef.current = selectedVoice;
    }, [selectedVoice]);

    const speakText = async (text: string, voiceOverride?: string) => {
        if (isMuted || typeof window === 'undefined') return;

        // Read from the ref so callers with a stale closure (e.g. the mic's
        // recognition handler bound on mount) still get the CURRENT voice.
        const currentVoice = voiceOverride || selectedVoiceRef.current || selectedVoice;

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

                // Play the ElevenLabs MP3 through the reusable, gesture-unlocked
                // HTML5 <audio> element. This is what actually produces sound on
                // Mac Safari (Web Audio was silent). If autoplay is genuinely
                // blocked, play() rejects -> caught -> browser-voice fallback.
                const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
                const url = URL.createObjectURL(blob);
                const audio = htmlAudioRef.current || new Audio();
                audio.src = url;
                audio.volume = 1.0;
                audio.onended = () => { setIsSpeaking(false); URL.revokeObjectURL(url); };
                audio.onerror = () => { setIsSpeaking(false); URL.revokeObjectURL(url); };

                // If the element is routed through the gain graph, the context must
                // be running or it will be silent. Resume it (no-op if not routed).
                try {
                    if (audioContextRef.current?.state === 'suspended') await audioContextRef.current.resume();
                } catch { /* noop */ }

                setDebugStatus('Playing neural voice...');
                setIsSpeaking(true);
                await audio.play();

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

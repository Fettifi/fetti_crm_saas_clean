import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';

export function useRupeeVoice() {
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [selectedVoice, setSelectedVoice] = useState<string>('');
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [debugStatus, setDebugStatus] = useState<string>('');

    const audioContextRef = useRef<AudioContext | null>(null);

    // Initialize AudioContext
    const initAudioContext = () => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        if (audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume();
        }
    };

    // Load Voices
    useEffect(() => {
        if (typeof window === 'undefined') return;

        const loadVoices = () => {
            const available = window.speechSynthesis.getVoices();
            setVoices(available);

            const saved = localStorage.getItem('rupee_voice');
            if (saved) {
                setSelectedVoice(saved);
            } else {
                setSelectedVoice('shimmer'); // Default
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

                if (!audioContextRef.current) {
                    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                }
                const audioContext = audioContextRef.current;

                if (audioContext.state === 'suspended') {
                    await audioContext.resume();
                }

                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                const source = audioContext.createBufferSource();
                source.buffer = audioBuffer;

                const gainNode = audioContext.createGain();
                gainNode.gain.value = 6.0; // Boost volume

                source.connect(gainNode);
                gainNode.connect(audioContext.destination);

                setDebugStatus('Playing Neural Audio (Max Boost)...');
                setIsSpeaking(true);
                source.start(0);
                source.onended = () => setIsSpeaking(false);

                setTimeout(() => setDebugStatus(''), 3000);
                return;
            } catch (e: any) {
                console.warn('Neural TTS failed, falling back to browser voice.', e);
                setDebugStatus(`Error: ${e.message}. Fallback.`);
                toast.error(`Voice Error: ${e.message}. Using fallback.`);
            }
        } else {
            setDebugStatus(`Using Browser Voice: ${currentVoice}`);
            setTimeout(() => setDebugStatus(''), 3000);
        }

        // BROWSER TTS (Fallback)
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        if (currentVoice && !isElevenLabsId(currentVoice) && !isOpenAIId(currentVoice)) {
            const voice = voices.find(v => v.name === currentVoice);
            if (voice) utterance.voice = voice;
        }

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

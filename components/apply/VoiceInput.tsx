'use client';

import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Headphones, Loader2 } from 'lucide-react';

interface VoiceInputProps {
    onTranscript: (text: string) => void;
    isProcessing?: boolean;
}

export default function VoiceInput({ onTranscript, isProcessing = false }: VoiceInputProps) {
    const [isListening, setIsListening] = useState(false);
    const [handsFreeMode, setHandsFreeMode] = useState(false);
    const [isSupported, setIsSupported] = useState(false);
    const recognitionRef = useRef<any>(null);
    const silenceTimer = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (typeof window !== 'undefined' && (window as any).webkitSpeechRecognition) {
            setIsSupported(true);
            const recognition = new (window as any).webkitSpeechRecognition();
            recognition.continuous = true; // Always true for better control, we manage stops manually
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onresult = (event: any) => {
                // Clear silence timer on any speech
                if (silenceTimer.current) clearTimeout(silenceTimer.current);

                let finalTranscript = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        finalTranscript += event.results[i][0].transcript;
                    }
                }

                if (finalTranscript.trim()) {
                    console.log("Voice Input Final:", finalTranscript);
                    onTranscript(finalTranscript);

                    // If NOT hands-free, stop after one command
                    if (!handsFreeMode) {
                        setIsListening(false);
                        recognition.stop();
                    }
                }

                // Silence Detection for Hands-Free (Optional, but good for "end of turn")
                // For now, we rely on isFinal.
            };

            recognition.onerror = (event: any) => {
                console.error('Speech recognition error', event.error);
                if (event.error === 'not-allowed') {
                    setHandsFreeMode(false); // Disable hands-free if denied
                    alert('Microphone access denied.');
                }
                // Ignore 'no-speech' and 'aborted'
            };

            recognition.onend = () => {
                // Auto-restart if Hands-Free is ON and NOT processing
                if (handsFreeMode && !isProcessing) {
                    console.log("Hands-Free: Restarting listener...");
                    try {
                        recognition.start();
                    } catch (e) {
                        // Ignore "already started" errors
                    }
                } else {
                    setIsListening(false);
                }
            };

            recognitionRef.current = recognition;
        }
    }, [onTranscript, handsFreeMode, isProcessing]);

    // Effect: Manage Listening State based on Props & Mode
    useEffect(() => {
        if (!recognitionRef.current) return;

        if (isProcessing) {
            // Stop listening while AI is thinking/speaking
            if (isListening) {
                recognitionRef.current.stop();
                setIsListening(false);
            }
        } else {
            // Resume listening if Hands-Free is ON
            if (handsFreeMode && !isListening) {
                try {
                    recognitionRef.current.start();
                    setIsListening(true);
                } catch (e) {
                    // Ignore
                }
            }
        }
    }, [isProcessing, handsFreeMode]);

    const toggleListening = () => {
        if (!isSupported) return;

        if (isListening) {
            recognitionRef.current.stop();
            setHandsFreeMode(false); // Manual stop disables hands-free
        } else {
            recognitionRef.current.start();
            setIsListening(true);
        }
    };

    const toggleHandsFree = () => {
        setHandsFreeMode(!handsFreeMode);
    };

    if (!isSupported) return null;

    return (
    return (
        <div className="flex items-center gap-2">
            {/* Hands-Free Toggle */}
            <button
                type="button"
                onClick={toggleHandsFree}
                className={`p-2 rounded-full transition-all duration-300 ${handsFreeMode
                    ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.3)]'
                    : 'text-slate-500 hover:text-emerald-400 hover:bg-slate-800'
                    }`}
                title={handsFreeMode ? 'Hands-Free ON (Always Listening)' : 'Enable Hands-Free Mode'}
            >
                <Headphones size={16} />
            </button>

            {/* Main Mic Button */}
            <button
                type="button"
                onClick={toggleListening}
                className={`p-3 rounded-full transition-all duration-300 ${isListening
                    ? 'bg-red-500 text-white animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.4)]'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                title={isListening ? 'Stop listening' : 'Start voice input'}
            >
                {isListening ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
        </div>
    );
    );
}

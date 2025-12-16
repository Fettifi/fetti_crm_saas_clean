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

    // Refs for state access inside callbacks without re-binding
    const recognitionRef = useRef<any>(null);
    const handsFreeModeRef = useRef(handsFreeMode);
    const isProcessingRef = useRef(isProcessing);
    const silenceTimer = useRef<NodeJS.Timeout | null>(null);

    // Update refs when props/state change
    useEffect(() => {
        handsFreeModeRef.current = handsFreeMode;
    }, [handsFreeMode]);

    useEffect(() => {
        isProcessingRef.current = isProcessing;

        // Smart Pause Logic
        if (recognitionRef.current) {
            if (isProcessing) {
                if (isListening) {
                    console.log("VoiceInput: Pausing for AI response...");
                    recognitionRef.current.stop();
                    setIsListening(false);
                }
            } else {
                if (handsFreeModeRef.current && !isListening) {
                    console.log("VoiceInput: Resuming hands-free...");
                    try {
                        recognitionRef.current.start();
                        setIsListening(true);
                    } catch (e) {
                        // Ignore if already started
                    }
                }
            }
        }
    }, [isProcessing, isListening]); // Added isListening to ensure we don't loop, but logic handles it

    // Initialize Speech Recognition (ONCE)
    useEffect(() => {
        if (typeof window !== 'undefined' && (window as any).webkitSpeechRecognition) {
            setIsSupported(true);
            const recognition = new (window as any).webkitSpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onresult = (event: any) => {
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
                    if (!handsFreeModeRef.current) {
                        setIsListening(false);
                        recognition.stop();
                    }
                }
            };

            recognition.onerror = (event: any) => {
                console.error('Speech recognition error', event.error);
                if (event.error === 'not-allowed') {
                    setHandsFreeMode(false);
                    alert('Microphone access denied.');
                }
            };

            recognition.onend = () => {
                // Auto-restart if Hands-Free is ON and NOT processing
                // Use REFS to get fresh state
                if (handsFreeModeRef.current && !isProcessingRef.current) {
                    console.log("Hands-Free: Auto-restarting listener...");
                    try {
                        recognition.start();
                        setIsListening(true);
                    } catch (e) {
                        // Ignore
                    }
                } else {
                    setIsListening(false);
                }
            };

            recognitionRef.current = recognition;

            // Cleanup
            return () => {
                if (recognitionRef.current) {
                    recognitionRef.current.abort();
                }
            };
        }
    }, []); // Empty dependency array = Run once on mount

    const toggleListening = () => {
        if (!isSupported || !recognitionRef.current) return;

        if (isListening) {
            recognitionRef.current.stop();
            setHandsFreeMode(false);
        } else {
            try {
                recognitionRef.current.start();
                setIsListening(true);
            } catch (e) {
                console.error("Failed to start:", e);
            }
        }
    };

    const toggleHandsFree = () => {
        const newState = !handsFreeMode;
        setHandsFreeMode(newState);

        // If turning ON, ensure we start listening
        if (newState && !isListening && !isProcessing) {
            try {
                recognitionRef.current.start();
                setIsListening(true);
            } catch (e) {
                // Ignore
            }
        }
    };

    if (!isSupported) return null;

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
                {isProcessing && handsFreeMode ? (
                    <Loader2 size={16} className="animate-spin text-emerald-500/50" />
                ) : (
                    <Headphones size={16} />
                )}
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
}

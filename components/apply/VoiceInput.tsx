'use client';

import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff } from 'lucide-react';

interface VoiceInputProps {
    onTranscript: (text: string) => void;
}

export default function VoiceInput({ onTranscript }: VoiceInputProps) {
    const [isListening, setIsListening] = useState(false);
    const [isSupported, setIsSupported] = useState(false);
    const recognitionRef = useRef<any>(null);

    useEffect(() => {
        if (typeof window !== 'undefined' && (window as any).webkitSpeechRecognition) {
            setIsSupported(true);
            const recognition = new (window as any).webkitSpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = false;
            recognition.lang = 'en-US';

            recognition.onresult = (event: any) => {
                const transcript = event.results[0][0].transcript;
                onTranscript(transcript);
                setIsListening(false);
            };

            recognition.onerror = (event: any) => {
                console.error('Speech recognition error', event.error);
                if (event.error === 'not-allowed') {
                    alert('Microphone access denied. Please allow microphone access in your browser settings.');
                } else if (event.error === 'no-speech') {
                    // Ignore no-speech errors, just stop listening
                } else {
                    alert(`Voice input error: ${event.error}`);
                }
                setIsListening(false);
            };

            recognition.onend = () => {
                setIsListening(false);
            };

            recognitionRef.current = recognition;
        }
    }, [onTranscript]);

    const toggleListening = () => {
        if (!isSupported) return;

        if (isListening) {
            recognitionRef.current.stop();
        } else {
            recognitionRef.current.start();
            setIsListening(true);
        }
    };

    if (!isSupported) return null;

    return (
        <button
            type="button"
            onClick={toggleListening}
            className={`p-3 rounded-full transition-colors ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
            title={isListening ? 'Stop listening' : 'Start voice input'}
        >
            {isListening ? <MicOff size={20} /> : <Mic size={20} />}
        </button>
    );
}

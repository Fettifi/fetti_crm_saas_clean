'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Mic, Send, Sparkles, Volume2, VolumeX, Paperclip, X, Loader2, Terminal } from 'lucide-react';
import VoiceInput from '@/components/apply/VoiceInput';
import { supabase } from '@/lib/supabaseClient';

interface Message {
    id: string;
    role: 'user' | 'system';
    content: string;
}

export default function AssistantInterface() {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: 'init',
            role: 'system',
            content: "I'm Rupee, your Co-Founder. Let's build."
        }
    ]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [selectedVoice, setSelectedVoice] = useState<string>('');
    const [debugStatus, setDebugStatus] = useState<string>(''); // Debugging
    const [chunkCount, setChunkCount] = useState(0);
    const [lastChunkType, setLastChunkType] = useState<string>('none');
    const [parseError, setParseError] = useState<string>(''); // Nuclear Option
    const [debugLog, setDebugLog] = useState<string[]>([]); // Debug Log
    const [showDebug, setShowDebug] = useState(false); // Toggle Debug Panel
    const [showTerminal, setShowTerminal] = useState(false); // Toggle Mini Terminal
    const [terminalInput, setTerminalInput] = useState(''); // Terminal Input

    // Progress Bar State
    const [progress, setProgress] = useState(0);
    const [statusMessage, setStatusMessage] = useState('');

    const fileInputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isTyping, statusMessage]);

    // Load Voices
    useEffect(() => {
        if (typeof window === 'undefined') return;

        const loadVoices = () => {
            const available = window.speechSynthesis.getVoices();
            setVoices(available);

            // Try to restore from local storage or find best default
            const saved = localStorage.getItem('rupee_voice');
            if (saved) {
                setSelectedVoice(saved);
            } else {
                // Default to Neural (Rachel)
                setSelectedVoice('21m00Tcm4TlvDq8ikWAM');
            }
        };

        loadVoices();
        window.speechSynthesis.onvoiceschanged = loadVoices;

        return () => {
            window.speechSynthesis.onvoiceschanged = null;
        };
    }, []);

    // Text-to-Speech (Rupee Voice)
    const speakText = async (text: string, voiceOverride?: string) => {
        if (isMuted || typeof window === 'undefined') return;

        const currentVoice = voiceOverride || selectedVoice;

        // Stop any current playback
        window.speechSynthesis.cancel();

        // NEURAL TTS (ElevenLabs / OpenAI)
        // Robust Check: ElevenLabs IDs are 20 chars, OpenAI IDs are specific names
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

                // Use the pre-initialized (unlocked) context if available
                if (!audioContextRef.current) {
                    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                }
                const audioContext = audioContextRef.current;

                // Ensure it's running
                if (audioContext.state === 'suspended') {
                    await audioContext.resume();
                }

                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

                const source = audioContext.createBufferSource();
                source.buffer = audioBuffer;

                // Volume Boost (Gain Node)
                const gainNode = audioContext.createGain();
                gainNode.gain.value = 6.0; // Boost volume by 6.0x (High Gain)

                source.connect(gainNode);
                gainNode.connect(audioContext.destination);

                setDebugStatus('Playing Neural Audio (Max Boost)...');
                source.start(0);

                setTimeout(() => setDebugStatus(''), 3000);
                return;
            } catch (e: any) {
                console.warn('Neural TTS failed, falling back to browser voice.', e);
                setDebugStatus(`Error: ${e.message}. Fallback.`);
                // Fallback to browser voice if API fails (e.g. no key)
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

        window.speechSynthesis.speak(utterance);
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onloadend = () => {
            setSelectedImage(reader.result as string);
        };
        reader.readAsDataURL(file);
    };

    // Audio Context Ref (Persistent)
    const audioContextRef = useRef<AudioContext | null>(null);

    // Initialize AudioContext on first user interaction
    const initAudioContext = () => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        if (audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume();
        }
    };

    // Supabase Persistence

    const [conversationId, setConversationId] = useState<string | null>(null);

    // Load History on Mount
    useEffect(() => {
        const loadHistory = async () => {
            const savedId = localStorage.getItem('rupee_conversation_id');
            if (savedId) {
                setConversationId(savedId);
                const { data, error } = await supabase
                    .from('messages')
                    .select('*')
                    .eq('conversation_id', savedId)
                    .order('created_at', { ascending: true });

                if (data && data.length > 0) {
                    setMessages(data.map(m => ({
                        id: m.id,
                        role: m.role as 'user' | 'system',
                        content: m.content
                    })));
                }
            } else {
                // Create new conversation
                const { data, error } = await supabase
                    .from('conversations')
                    .insert([{ title: 'New Chat' }])
                    .select()
                    .single();

                if (data) {
                    setConversationId(data.id);
                    localStorage.setItem('rupee_conversation_id', data.id);
                }
            }
        };
        loadHistory();
    }, []);

    const saveMessage = async (role: 'user' | 'system', content: string) => {
        if (!conversationId) return;
        await supabase.from('messages').insert([{
            conversation_id: conversationId,
            role,
            content
        }]);
    };

    const handleSendMessage = async (text: string) => {
        if (!text.trim() && !selectedImage) return;

        // CRITICAL: Resume AudioContext immediately on user gesture (Safari Fix)
        initAudioContext();

        const userMsg: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: text
        };

        setMessages(prev => [...prev, userMsg]);
        saveMessage('user', text); // Save to Supabase
        setInput('');
        setIsTyping(true);
        setProgress(5); // Optimistic start for Safari
        setIsTyping(true);
        setProgress(5); // Optimistic start for Safari
        setStatusMessage('Connecting...');
        setDebugLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] Connecting...`]);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: 'co-founder', // Unified Oracle Mode
                    history: [...messages, userMsg], // Send full history
                    message: text,
                    images: selectedImage ? [selectedImage] : undefined
                })
            });

            // Clear image after sending
            setSelectedImage(null);

            if (!response.body) throw new Error("No response body");

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let done = false;
            let buffer = '';

            while (!done) {
                const { value, done: doneReading } = await reader.read();
                done = doneReading;
                const chunkValue = decoder.decode(value, { stream: true });
                setDebugLog(prev => [...prev, `[Chunk] ${chunkValue.substring(0, 50)}...`]);

                buffer += chunkValue;
                const lines = buffer.split('\n');

                // Keep the last line in the buffer as it might be incomplete
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim() === '') continue;
                    try {
                        setChunkCount(prev => prev + 1);
                        const data = JSON.parse(line);
                        setLastChunkType(data.type);

                        if (data.type === 'status') {
                            console.log("Status Update:", data.message, data.progress); // DEBUG
                            setDebugLog(prev => [...prev, `[Status] ${data.message} (${data.progress}%)`]);
                            setStatusMessage(data.message);
                            setProgress(data.progress);
                            // Allow UI to update
                            await new Promise(r => setTimeout(r, 10));
                        } else if (data.type === 'result') {
                            setMessages(prev => [...prev, {
                                id: Date.now().toString(),
                                role: 'system',
                                content: data.message
                            }]);

                            saveMessage('system', data.message);
                            speakText(data.message);

                            // Reset UI
                            setProgress(100);
                            setTimeout(() => {
                                setProgress(0);
                                setStatusMessage('');
                            }, 2000);
                        } else if (data.type === 'debug') {
                            setDebugLog(prev => [...prev, `[Server Debug] ${data.message}`]);
                        } else if (data.type === 'error') {
                            console.error("Stream Error:", data.message);
                            setStatusMessage(`Error: ${data.message}`);
                            setProgress(0);
                        }
                    } catch (e: any) {
                        console.warn("Failed to parse chunk:", line);
                        setParseError(e.message);
                    }
                }
            }

        } catch (error) {
            console.error('Chat error:', error);
            setIsTyping(false);
            setStatusMessage("Connection Failed");
            setDebugLog(prev => [...prev, `[Error] ${error}`]);
        }
    };

    const handleTerminalSubmit = async (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && terminalInput.trim()) {
            const cmd = terminalInput.trim();
            setTerminalInput('');
            setDebugLog(prev => [...prev, `[USER] $ ${cmd}`]);

            // Send to backend as 'dev_console' mode
            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        mode: 'dev_console',
                        history: [], // Terminal is stateless/one-shot for now
                        message: cmd
                    })
                });

                if (!response.body) throw new Error("No response body");

                // Reuse the same stream reader logic (simplified)
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let done = false;
                let buffer = '';

                while (!done) {
                    const { value, done: doneReading } = await reader.read();
                    done = doneReading;
                    const chunkValue = decoder.decode(value, { stream: true });

                    buffer += chunkValue;
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.trim() === '') continue;
                        try {
                            const data = JSON.parse(line);
                            if (data.type === 'status') {
                                setDebugLog(prev => [...prev, `[Status] ${data.message}`]);
                            } else if (data.type === 'result') {
                                setDebugLog(prev => [...prev, `[Result] ${data.message}`]);
                            } else if (data.type === 'error') {
                                setDebugLog(prev => [...prev, `[Error] ${data.message}`]);
                            }
                        } catch (e) { }
                    }
                }
            } catch (error: any) {
                setDebugLog(prev => [...prev, `[Error] ${error.message}`]);
            }
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-120px)] min-h-[500px] w-full max-w-4xl mx-auto bg-slate-950 rounded-3xl border border-slate-800 shadow-2xl relative">
            {/* Background Effects */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-emerald-900/20 via-slate-950 to-slate-950 pointer-events-none rounded-3xl" />

            {/* Sticky Header Container (Wraps Header + Progress Bar) */}
            <div className="sticky top-0 z-50 bg-slate-950/90 backdrop-blur-md rounded-t-3xl border-b border-white/5">
                {/* Header Content */}
                <div className="p-6 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_15px_rgba(16,185,129,0.5)]" />
                            <div className="absolute inset-0 w-3 h-3 rounded-full bg-emerald-500 animate-ping opacity-20" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-emerald-400 font-bold tracking-[0.2em] text-xs uppercase drop-shadow-[0_0_10px_rgba(52,211,153,0.3)]">Rupee // Oracle</span>
                            <span className="text-[9px] text-emerald-500/40 font-mono tracking-widest">SYSTEM ONLINE (v2.0)</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        {/* Terminal Toggle */}
                        <button
                            onClick={() => setShowTerminal(!showTerminal)}
                            className={`transition-colors ${showTerminal ? 'text-emerald-400' : 'text-slate-500 hover:text-white'}`}
                            title="Toggle Terminal"
                        >
                            <Terminal size={18} />
                        </button>

                        {/* Voice Selector */}
                        <select
                            value={selectedVoice}
                            onChange={(e) => {
                                const newVoice = e.target.value;
                                setSelectedVoice(newVoice);
                                localStorage.setItem('rupee_voice', newVoice);
                                speakText("I'm Rupee.", newVoice);
                            }}
                            className="bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-emerald-500 max-w-[150px] truncate"
                        >
                            <option value="21m00Tcm4TlvDq8ikWAM">Neural (ElevenLabs)</option>
                            <option value="NBA1cQRTWFj793Oifdaj">Custom Voice (ElevenLabs)</option>
                            <option value="shimmer">Shimmer (OpenAI)</option>
                            <option disabled>──────────</option>
                            {voices.map(voice => (
                                <option key={voice.name} value={voice.name}>
                                    {voice.name}
                                </option>
                            ))}
                        </select>

                        <button
                            onClick={() => setIsMuted(!isMuted)}
                            className="text-slate-500 hover:text-white transition-colors"
                        >
                            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                        </button>
                    </div>
                </div>

                {/* Progress Bar (Inside Sticky Container) */}
                <div className={`transition-all duration-300 ease-in-out overflow-hidden border-t border-emerald-500/30 ${(progress > 0 || statusMessage) ? 'h-12 opacity-100' : 'h-0 opacity-0'}`}>
                    <div className="h-full flex items-center px-6 gap-4 bg-emerald-900/50">
                        <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                        <div className="flex-1">
                            <div className="flex justify-between text-xs text-emerald-200 mb-1 font-mono">
                                <span>{statusMessage}</span>
                                <span>{progress}%</span>
                            </div>
                            <div className="h-1 bg-emerald-950 rounded-full overflow-hidden">
                                <div
                                    className={`h-full bg-emerald-400 transition-all duration-300 ease-out shadow-[0_0_10px_rgba(52,211,153,0.5)] ${(statusMessage.startsWith('Terminal:') || statusMessage.startsWith('Editing:') || statusMessage.startsWith('Researching:'))
                                        ? 'animate-pulse bg-gradient-to-r from-emerald-400 via-emerald-200 to-emerald-400 bg-[length:200%_100%] animate-shimmer'
                                        : ''
                                        }`}
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>



            {/* Debug Status */}
            {debugStatus && (
                <div className="absolute top-16 right-6 z-20 bg-black/80 text-emerald-400 text-[10px] px-2 py-1 rounded border border-emerald-500/30 font-mono">
                    {debugStatus}
                </div>
            )}

            {/* Mini Terminal Screen */}
            {showTerminal && (
                <div className="absolute top-20 left-6 right-6 bottom-24 z-30 bg-black/95 border border-emerald-500/50 rounded-xl shadow-2xl overflow-hidden flex flex-col font-mono text-xs backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200">
                    {/* Terminal Header */}
                    <div className="bg-emerald-900/20 border-b border-emerald-500/30 p-3 flex justify-between items-center backdrop-blur-md">
                        <div className="flex items-center gap-3">
                            <div className="relative">
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                                <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping opacity-50" />
                            </div>
                            <span className="text-emerald-400 font-bold tracking-widest text-[10px] uppercase">Rupee // Dev Core</span>
                        </div>
                        <button onClick={() => setShowTerminal(false)} className="text-emerald-700 hover:text-emerald-400 transition-colors">
                            <X size={14} />
                        </button>
                    </div>

                    {/* Terminal Content */}
                    <div className="flex-1 p-4 overflow-y-auto scrollbar-thin scrollbar-thumb-emerald-900 scrollbar-track-transparent space-y-2 pb-20">
                        <div className="text-emerald-600/50 text-[10px] mb-4 font-mono">
                            System initialized. Connected to local environment.<br />
                            Waiting for command...
                        </div>
                        {debugLog.map((log, i) => (
                            <div key={i} className={`break-words font-medium ${log.startsWith('[USER]') ? 'text-white' : 'text-emerald-400/90'}`}>
                                {log.startsWith('[USER]') ? '' : <span className="text-emerald-700 mr-2">$</span>}
                                {log.replace('[Chunk]', '').replace('[Status]', '').replace('[Result]', '').replace('[USER]', '')}
                            </div>
                        ))}
                    </div>

                    {/* Floating Antigravity Command Bar */}
                    <div className="absolute bottom-4 left-4 right-4">
                        <div className="bg-slate-950/90 backdrop-blur-xl border border-emerald-500/30 rounded-full p-1.5 flex items-center gap-3 shadow-[0_0_20px_rgba(16,185,129,0.1)] transition-all focus-within:border-emerald-500/60 focus-within:shadow-[0_0_25px_rgba(16,185,129,0.2)]">
                            <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                                <Terminal size={14} className="text-emerald-400" />
                            </div>
                            <input
                                type="text"
                                value={terminalInput}
                                onChange={(e) => setTerminalInput(e.target.value)}
                                onKeyDown={handleTerminalSubmit}
                                className="flex-1 bg-transparent border-none focus:ring-0 text-emerald-100 placeholder:text-emerald-700/50 font-mono text-xs h-full"
                                placeholder="Execute command..."
                                autoFocus
                            />
                            <div className="pr-3">
                                <span className="text-[10px] text-emerald-800 font-mono">CMD+K</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content Area */}
            <div className="flex-1 relative z-10 flex flex-col">

                {/* Visualizer / Avatar Area */}
                <div className="flex-1 flex items-center justify-center min-h-[200px]">
                    <div className="relative">
                        {/* The Orb */}
                        <div className={`w-32 h-32 rounded-full bg-gradient-to-br from-emerald-500 to-teal-700 blur-xl opacity-20 animate-pulse ${isTyping ? 'duration-500 scale-110' : 'duration-[3000ms]'}`} />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className={`w-24 h-24 rounded-full border border-emerald-500/30 flex items-center justify-center backdrop-blur-sm transition-all duration-500 ${isTyping ? 'scale-105 border-emerald-400/50' : ''}`}>
                                <Sparkles className={`text-emerald-400 w-8 h-8 ${isTyping ? 'animate-spin-slow' : ''}`} />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Chat Stream */}
                <div className="flex-1 overflow-y-auto px-8 pb-32 space-y-6 max-h-[400px] scrollbar-thin scrollbar-thumb-slate-800">
                    {messages.map((msg) => (
                        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-center'}`}>
                            <div className={`max-w-xl ${msg.role === 'user'
                                ? 'bg-slate-800/50 text-slate-200 px-4 py-2 rounded-2xl rounded-tr-sm text-sm'
                                : 'text-center'
                                }`}>
                                {msg.role === 'system' ? (
                                    <div className="flex flex-col gap-2">
                                        <p className="text-lg md:text-xl font-light text-slate-100 leading-relaxed animate-in fade-in slide-in-from-bottom-2">
                                            {msg.content}
                                        </p>
                                        <button
                                            onClick={() => speakText(msg.content)}
                                            className="self-start text-xs text-emerald-500/50 hover:text-emerald-400 flex items-center gap-1 transition-colors"
                                        >
                                            <Volume2 size={12} /> Replay Audio
                                        </button>
                                    </div>
                                ) : (
                                    msg.content
                                )}
                            </div>
                        </div>
                    ))}
                    {isTyping && progress === 0 && (
                        <div className="flex justify-center">
                            <span className="text-emerald-500/50 text-sm animate-pulse">Thinking...</span>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

            </div>



            {/* Floating Antigravity Input Bar (Fixed Positioning - Nuclear Option) */}
            <div className="fixed bottom-10 left-0 right-0 z-[9999] flex justify-center pointer-events-none px-4">
                <div className="w-full max-w-3xl pointer-events-auto bg-slate-950/90 backdrop-blur-2xl border border-emerald-500/50 rounded-full p-2 flex items-center gap-3 shadow-[0_0_50px_rgba(16,185,129,0.3)] transition-all hover:scale-[1.01] hover:shadow-[0_0_80px_rgba(16,185,129,0.4)] ring-1 ring-white/10">
                    {/* DEBUG: VoiceInput Disabled */}
                    {/* <VoiceInput onTranscript={(text) => {
                        setInput(text);
                        handleSendMessage(text);
                    }} /> */}
                    <div className="text-red-500 text-[10px] font-mono whitespace-nowrap">DEBUG: BAR RENDERED</div>

                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        accept="image/*"
                        className="hidden"
                    />

                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className={`p-2 rounded-full transition-all duration-300 ${selectedImage ? 'text-emerald-400 bg-emerald-400/10 shadow-[0_0_15px_rgba(52,211,153,0.3)]' : 'text-slate-400 hover:text-emerald-300 hover:bg-slate-800'}`}
                    >
                        <Paperclip size={20} />
                    </button>

                    {selectedImage && (
                        <div className="absolute bottom-full left-6 mb-4 animate-in fade-in slide-in-from-bottom-2">
                            <div className="relative group">
                                <img src={selectedImage} alt="Preview" className="h-24 w-24 object-cover rounded-xl border border-emerald-500/30 shadow-2xl" />
                                <button
                                    onClick={() => setSelectedImage(null)}
                                    className="absolute -top-2 -right-2 bg-slate-950 border border-emerald-500/50 rounded-full p-1.5 text-emerald-400 hover:text-white hover:bg-red-500/20 hover:border-red-500 transition-colors shadow-lg"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        </div>
                    )}

                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(input)}
                        placeholder="Ask Rupee anything..."
                        className="flex-1 bg-transparent border-none focus:ring-0 text-emerald-50 placeholder:text-emerald-700/50 px-2 font-light tracking-wide"
                    />

                    <button
                        onClick={() => handleSendMessage(input)}
                        disabled={!input.trim()}
                        className="p-3 bg-gradient-to-br from-emerald-500 to-emerald-700 hover:from-emerald-400 hover:to-emerald-600 text-white rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] active:scale-95"
                    >
                        <Send size={18} />
                    </button>
                </div>
            </div>

            {/* Debug Panel Toggle */}
            <button
                onClick={() => setShowDebug(!showDebug)}
                className="absolute bottom-2 right-2 z-50 text-[10px] text-slate-700 hover:text-slate-500"
            >
                {showDebug ? 'Hide Debug' : 'Show Debug'}
            </button>

            {/* Debug Panel */}
            {showDebug && (
                <div className="absolute bottom-16 right-6 z-40 w-80 bg-black/90 border border-slate-700 rounded-lg p-3 text-[10px] font-mono text-green-400 shadow-2xl max-h-60 overflow-y-auto">
                    <div className="flex justify-between border-b border-slate-800 pb-1 mb-2">
                        <span>Stream Debugger</span>
                        <button onClick={() => setDebugLog([])} className="text-slate-500 hover:text-white">Clear</button>
                    </div>
                    <div className="space-y-1">
                        {debugLog.map((log, i) => (
                            <div key={i} className="break-words border-b border-slate-800/50 pb-0.5">{log}</div>
                        ))}
                        {debugLog.length === 0 && <div className="text-slate-600 italic">Waiting for connection...</div>}
                    </div>
                </div>
            )}
        </div>
    );
}

'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Mic, Send, Sparkles, Volume2, VolumeX, Paperclip, X } from 'lucide-react';
import VoiceInput from '@/components/apply/VoiceInput';

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
            content: "I'm online. Ready to build, partner."
        }
    ]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isTyping]);

    // Text-to-Speech (Rupee Voice)
    const speakText = (text: string) => {
        if (isMuted || typeof window === 'undefined') return;
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;
        utterance.pitch = 1.1;

        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(v =>
            (v.name.includes('Female') && v.lang.includes('en-US')) ||
            v.name.includes('Samantha') ||
            v.name.includes('Google US English') ||
            v.name.includes('Victoria')
        );
        if (preferredVoice) utterance.voice = preferredVoice;

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

    const handleSendMessage = async (text: string) => {
        if (!text.trim() && !selectedImage) return;

        const userMsg: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: text
        };

        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsTyping(true);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: 'co-founder', // Flag for backend
                    history: [...messages, userMsg], // Send full history
                    message: text,
                    images: selectedImage ? [selectedImage] : undefined
                })
            });

            // Clear image after sending
            setSelectedImage(null);

            const data = await response.json();

            const sysMsg: Message = {
                id: Date.now().toString(),
                role: 'system',
                content: data.message
            };

            setMessages(prev => [...prev, sysMsg]);
            speakText(data.message);

        } catch (error) {
            console.error('Chat error:', error);
        } finally {
            setIsTyping(false);
        }
    };

    return (
        <div className="flex flex-col h-[700px] w-full max-w-4xl mx-auto bg-slate-950 rounded-3xl border border-slate-800 shadow-2xl overflow-hidden relative">
            {/* Background Effects */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-emerald-900/20 via-slate-950 to-slate-950 pointer-events-none" />

            {/* Header */}
            <div className="relative z-10 p-6 flex justify-between items-center border-b border-white/5">
                <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_15px_rgba(16,185,129,0.5)]" />
                    <span className="text-emerald-400 font-medium tracking-widest text-xs uppercase">Rupee // Co-Founder Mode</span>
                </div>
                <button
                    onClick={() => setIsMuted(!isMuted)}
                    className="text-slate-500 hover:text-white transition-colors"
                >
                    {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
            </div>

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
                <div className="flex-1 overflow-y-auto px-8 pb-4 space-y-6 max-h-[400px] scrollbar-thin scrollbar-thumb-slate-800">
                    {messages.map((msg) => (
                        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-center'}`}>
                            <div className={`max-w-xl ${msg.role === 'user'
                                ? 'bg-slate-800/50 text-slate-200 px-4 py-2 rounded-2xl rounded-tr-sm text-sm'
                                : 'text-center'
                                }`}>
                                {msg.role === 'system' ? (
                                    <p className="text-lg md:text-xl font-light text-slate-100 leading-relaxed animate-in fade-in slide-in-from-bottom-2">
                                        {msg.content}
                                    </p>
                                ) : (
                                    msg.content
                                )}
                            </div>
                        </div>
                    ))}
                    {isTyping && (
                        <div className="flex justify-center">
                            <span className="text-emerald-500/50 text-sm animate-pulse">Thinking...</span>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

            </div>

            {/* Input Bar */}
            <div className="relative z-10 p-6 pt-0">
                <div className="bg-slate-900/80 backdrop-blur-md border border-slate-700/50 rounded-full p-2 flex items-center gap-2 shadow-lg">
                    <VoiceInput onTranscript={(text) => {
                        setInput(text);
                        handleSendMessage(text);
                    }} />

                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        accept="image/*"
                        className="hidden"
                    />

                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className={`p-2 rounded-full transition-colors ${selectedImage ? 'text-emerald-400 bg-emerald-400/10' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                    >
                        <Paperclip size={20} />
                    </button>

                    {selectedImage && (
                        <div className="absolute bottom-full left-6 mb-2">
                            <div className="relative group">
                                <img src={selectedImage} alt="Preview" className="h-20 w-20 object-cover rounded-lg border border-slate-700 shadow-lg" />
                                <button
                                    onClick={() => setSelectedImage(null)}
                                    className="absolute -top-2 -right-2 bg-slate-900 border border-slate-700 rounded-full p-1 text-slate-400 hover:text-white"
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
                        className="flex-1 bg-transparent border-none focus:ring-0 text-white placeholder:text-slate-500 px-2"
                    />

                    <button
                        onClick={() => handleSendMessage(input)}
                        disabled={!input.trim()}
                        className="p-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Send size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
}

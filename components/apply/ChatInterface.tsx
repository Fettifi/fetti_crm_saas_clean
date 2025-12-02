'use client';

import { useState, useEffect, useRef } from 'react';
import { Send } from 'lucide-react';
import VoiceInput from './VoiceInput';
import FileUploader from './FileUploader';
import { INITIAL_STATE, ConversationState, getNextStep, Message } from '@/lib/apply/conversation-logic';
import { ExtractedData } from '@/lib/apply/document-processor';
import supabase from '@/lib/supabaseClient';

export default function ChatInterface() {
    const [state, setState] = useState<ConversationState>(INITIAL_STATE);
    const [input, setInput] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [state.history]);

    const handleSendMessage = async (text: string) => {
        if (!text.trim()) return;

        // Optimistically add user message
        const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text };
        const nextState = getNextStep({ ...state, history: [...state.history] }, text);

        // If nextStep returns a new state, update it. 
        // Note: getNextStep already handles adding the user message to history in its return
        if (nextState.step) {
            setState(prev => ({ ...prev, ...nextState }));

            // Check for completion
            if (nextState.step === 'COMPLETE') {
                await submitApplication(nextState.data!);
            }
        } else {
            // If logic didn't return a state change (shouldn't happen with current logic but safe fallback)
            setState(prev => ({ ...prev, history: [...prev.history, userMsg] }));
        }

        setInput('');
    };

    const handleExtraction = (data: ExtractedData) => {
        let systemMsg = '';
        const updates: Partial<ConversationState['data']> = {};

        if (data.documentType === 'ID' && data.fullName) {
            updates.fullName = data.fullName;
            systemMsg = `I've scanned your ID. Hello, ${data.fullName}! I've skipped the name question.`;
        } else if (data.documentType === 'BankStatement' && data.revenue) {
            updates.revenue = data.revenue;
            systemMsg = `I see an annual revenue of $${data.revenue.toLocaleString()}. Impressive! I've saved that for you.`;
        } else if ((data.documentType === 'W2' || data.documentType === 'Paystub') && data.employerName) {
            updates.employerName = data.employerName;
            updates.monthlyIncome = data.monthlyIncome;
            systemMsg = `Got it. You work at ${data.employerName} earning about $${data.monthlyIncome?.toLocaleString()}/mo. I've updated your employment info.`;
        } else {
            systemMsg = "I couldn't quite read that document, but I've attached it to your file.";
        }

        setState(prev => ({
            ...prev,
            data: { ...prev.data, ...updates },
            history: [
                ...prev.history,
                { id: `sys_${Date.now()}`, role: 'system', content: systemMsg, type: 'text' }
            ]
        }));

        // Trigger next step logic if needed - for now just acknowledge
    };

    const submitApplication = async (data: ConversationState['data']) => {
        setIsSubmitting(true);
        try {
            // 1. Create Lead
            const { data: leadData, error: leadError } = await supabase
                .from("leads")
                .insert([{
                    full_name: data.fullName || 'Unknown',
                    email: data.email || 'unknown@example.com',
                    phone: data.phone,
                    source: "fetti-conversational-apply",
                }])
                .select()
                .single();

            if (leadError) throw leadError;

            // 2. Create Application
            const { error: appError } = await supabase.from("applications").insert([{
                contact_id: leadData.id,
                status: "SUBMITTED",
                // Store extra data in a JSONB field if available, or map to columns
            }]);

            if (appError) throw appError;

        } catch (error) {
            console.error('Submission error:', error);
            setState(prev => ({
                ...prev,
                history: [...prev.history, { id: 'error', role: 'system', content: "Oops, something went wrong submitting your application. Please try again." }]
            }));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex flex-col h-[600px] w-full max-w-2xl mx-auto bg-slate-950 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="bg-slate-900/80 p-4 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold">
                        F
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold text-slate-100">Fetti Assistant</h2>
                        <p className="text-xs text-slate-400">AI-Powered Application</p>
                    </div>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {state.history.map((msg) => (
                    <div
                        key={msg.id}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                        <div
                            className={`max-w-[80%] p-3 rounded-2xl ${msg.role === 'user'
                                ? 'bg-emerald-600 text-white rounded-tr-none'
                                : 'bg-slate-800 text-slate-200 rounded-tl-none'
                                }`}
                        >
                            <p className="text-sm leading-relaxed">{msg.content}</p>
                            {msg.options && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {msg.options.map((opt) => (
                                        <button
                                            key={opt}
                                            onClick={() => handleSendMessage(opt)}
                                            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-medium transition-colors"
                                        >
                                            {opt}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-slate-900/50 border-t border-slate-800">
                {state.step === 'COMPLETE' ? (
                    <div className="text-center text-emerald-400 font-medium py-2">
                        Application Submitted Successfully!
                    </div>
                ) : (
                    <div className="flex items-end gap-2">
                        <div className="flex-1 bg-slate-950 border border-slate-700 rounded-xl p-2 focus-within:border-emerald-500/50 transition-colors">
                            <textarea
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSendMessage(input);
                                    }
                                }}
                                placeholder="Type your answer..."
                                className="w-full bg-transparent border-none focus:ring-0 text-sm text-slate-200 resize-none h-10 max-h-32"
                                rows={1}
                            />
                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/50">
                                <FileUploader onExtraction={handleExtraction} />
                                <span className="text-[10px] text-slate-500">Press Enter to send</span>
                            </div>
                        </div>

                        <VoiceInput onTranscript={(text) => setInput(text)} />

                        <button
                            onClick={() => handleSendMessage(input)}
                            disabled={!input.trim() || isSubmitting}
                            className="p-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <Send size={20} />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

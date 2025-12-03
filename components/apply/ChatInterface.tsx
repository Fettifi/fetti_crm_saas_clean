'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Mic, Send, Paperclip, FileText, Loader2, ShieldCheck, Building2, Home } from 'lucide-react';
import VoiceInput from './VoiceInput';
import FileUploader from './FileUploader';
import ReferralWidget from '@/components/growth/ReferralWidget';
import { INITIAL_STATE, ConversationState, Message, getNextStep, MortgageProduct } from '@/lib/apply/conversation-logic';
import { ExtractedData } from '@/lib/apply/document-processor';
import { supabase } from '@/lib/supabaseClient';

import { useSearchParams } from 'next/navigation';
import { scheduleStandardSequence, triggerBehavioralEmail } from '@/lib/automations/scheduler';

interface ChatInterfaceProps {
    initialProduct?: string | null;
}

export default function ChatInterface({ initialProduct }: ChatInterfaceProps) {
    const searchParams = useSearchParams();

    // Initialize state with product if provided
    const [state, setState] = useState<ConversationState>(() => {
        if (initialProduct) {
            return INITIAL_STATE;
        }
        return INITIAL_STATE;
    });

    const [input, setInput] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isTyping, setIsTyping] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [state.history, isTyping]);

    // Handle Initial Product Injection
    useEffect(() => {
        if (initialProduct && state.step === 'INIT') {
            // Logic to handle initial product can go here
        }
    }, [initialProduct, state.step]);


    const handleSendMessage = async (text: string, attachment?: { base64: string, mimeType: string }) => {
        if (!text.trim() && !attachment) return;

        const userMsg: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: text || (attachment ? 'Uploaded a document' : '')
        };

        // Optimistic update
        setState(prev => ({ ...prev, history: [...prev.history, userMsg] }));
        setInput('');
        setIsTyping(true);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    history: [...state.history, userMsg],
                    state: state,
                    attachment // Send attachment to API
                })
            });

            const data = await response.json();

            // Construct new system message
            const sysMsg: Message = {
                id: Date.now().toString(),
                role: 'system',
                content: data.message,
                type: data.uiType,
                options: data.options
            };

            setState(prev => ({
                ...prev,
                step: data.nextStep,
                data: { ...prev.data, ...data.extractedData },
                history: [...prev.history, sysMsg]
            }));

            if (data.nextStep === 'COMPLETE') {
                await submitApplication({ ...state.data, ...data.extractedData }, state.dealScore);
            }

        } catch (error) {
            console.error('Chat error:', error);
            // Fallback error message
            setState(prev => ({
                ...prev,
                history: [...prev.history, { id: Date.now().toString(), role: 'system', content: "I'm having trouble connecting. Please try again.", type: 'text' }]
            }));
        } finally {
            setIsTyping(false);
        }
    };

    const handleVoiceInput = (text: string) => {
        setInput(text);
    };

    const handleFileUpload = (file: File) => {
        // This is handled by FileUploader component now
    };

    const handleExtraction = (data: ExtractedData) => {
        // If we have base64 data, send it to the LLM for analysis
        if (data.base64 && data.mimeType) {
            handleSendMessage(`I've uploaded my ${data.documentType}.`, {
                base64: data.base64,
                mimeType: data.mimeType
            });
        } else {
            // Fallback for legacy mock extraction
            let systemMsg = '';
            const updates: any = {};

            if (data.documentType === 'ID' && data.fullName) {
                updates.fullName = data.fullName;
                systemMsg = `Thanks! I've extracted your name: ${data.fullName}.`;
            } else if (data.documentType === 'BankStatement' && data.revenue) {
                updates.revenue = data.revenue;
                systemMsg = `I see an annual revenue of $${data.revenue.toLocaleString()}. Impressive! I've saved that for you.`;
            } else {
                systemMsg = "I couldn't quite read that document, but I've attached it to your file.";
            }

            if (systemMsg) {
                const msg: Message = { id: Date.now().toString(), role: 'system', content: systemMsg, type: 'text' };
                setState(prev => ({
                    ...prev,
                    data: { ...prev.data, ...updates },
                    history: [...prev.history, msg]
                }));
            }
        }
    };

    const submitApplication = async (data: ConversationState['data'], score: ConversationState['dealScore']) => {
        setIsSubmitting(true);
        try {
            if (!data.email) {
                throw new Error("Missing email address");
            }

            console.log("Submitting application for:", data.email);

            // 1. Create Lead
            const { data: leadData, error: leadError } = await supabase
                .from("leads")
                .insert([{
                    first_name: data.fullName?.split(' ')[0] || 'Unknown',
                    last_name: data.fullName?.split(' ').slice(1).join(' ') || '',
                    email: data.email,
                    status: 'New',
                    source: 'AI_Chat_Apply',
                    utm_source: searchParams.get('utm_source'),
                    utm_medium: searchParams.get('utm_medium'),
                    utm_campaign: searchParams.get('utm_campaign'),
                }])
                .select()
                .single();

            if (leadError) {
                console.error("Lead creation error:", leadError);
                throw leadError;
            }

            if (leadError) throw leadError;

            // 2. Create Application
            if (leadData) {
                const { error: appError } = await supabase
                    .from("applications")
                    .insert([{
                        lead_id: leadData.id,
                        status: 'Draft',
                        loan_amount: data.purchasePrice || 0, // Fallback to purchasePrice
                        property_address: data.propertyAddress,
                        notes: JSON.stringify(data)
                    }]);

                if (appError) throw appError;

                // 3. Trigger Automations
                await scheduleStandardSequence(leadData.id);

                if (score.probability === 'High') {
                    await triggerBehavioralEmail(leadData.id, 'FAST_TRACK');
                }

                await triggerBehavioralEmail(leadData.id, 'REFERRAL_REWARD');

                // Save leadId to state for ReferralWidget
                setState(prev => ({ ...prev, data: { ...prev.data, leadId: leadData.id } }));

                // Add success message with Portal Link
                const origin = typeof window !== 'undefined' && window.location.origin ? window.location.origin : '';
                const portalLink = `${origin}/portal/${leadData.id}`;

                const successMsg: Message = {
                    id: 'final_success',
                    role: 'system',
                    content: `Application submitted successfully! \n\n**Next Steps:**\n1. Access your secure portal here: [Application Portal](${portalLink})\n2. Check your email for your access code.\n3. Upload your documents to fast-track your approval.`,
                    type: 'text'
                };
                setState(prev => ({ ...prev, history: [...prev.history, successMsg] }));
            }
        } catch (error: any) {
            console.error('Submission error:', error);
            const errorMsg: Message = {
                id: Date.now().toString(),
                role: 'system',
                content: `I encountered an error submitting your application: ${error.message || 'Unknown error'}. \n\nPlease try again or contact support with this reference: ${data.email}`,
                type: 'text'
            };
            setState(prev => ({ ...prev, history: [...prev.history, errorMsg] }));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex flex-col h-[600px] w-full max-w-2xl mx-auto bg-slate-950 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="bg-slate-900 p-4 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    </div>
                    <div>
                        <h2 className="font-semibold text-white">Frank</h2>
                        <p className="text-xs text-slate-400">Loan Coordinator • Online</p>
                    </div>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-800">
                {state.history.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] p-3 rounded-2xl ${msg.role === 'user'
                            ? 'bg-emerald-600 text-white rounded-tr-none'
                            : 'bg-slate-900 text-slate-200 border border-slate-800 rounded-tl-none'
                            }`}>
                            {msg.content}

                            {/* Options Rendering */}
                            {msg.options && msg.options.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {msg.options.map((opt) => (
                                        <button
                                            key={opt}
                                            onClick={() => handleSendMessage(opt)}
                                            className="text-xs bg-slate-800 hover:bg-emerald-600/20 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500/50 text-slate-300 px-3 py-2 rounded-full transition-all"
                                        >
                                            {opt}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Upload Rendering */}
                            {msg.type === 'upload' && (
                                <div className="mt-3">
                                    <FileUploader onExtraction={handleExtraction} />
                                </div>
                            )}

                            {/* Verification Rendering */}
                            {(msg.type === 'verify_identity' || msg.type === 'verify_assets' || msg.type === 'verify_property') && (
                                <div className="mt-3 bg-slate-950 border border-emerald-900/30 rounded-lg p-3 flex items-center gap-3">
                                    <ShieldCheck className="text-emerald-500 w-5 h-5" />
                                    <div className="text-xs text-emerald-400">
                                        {msg.type === 'verify_identity' && "Secure Identity Verification Active"}
                                        {msg.type === 'verify_assets' && "Bank-Level Encryption Active"}
                                        {msg.type === 'verify_property' && "Real-Time AVM Valuation"}
                                    </div>
                                    <button
                                        onClick={() => handleSendMessage("Verify Now")} // Simulate click
                                        className="ml-auto text-xs bg-emerald-600 text-white px-3 py-1 rounded hover:bg-emerald-500"
                                    >
                                        Connect
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {isTyping && (
                    <div className="flex justify-start">
                        <div className="bg-slate-900 p-3 rounded-2xl rounded-tl-none border border-slate-800">
                            <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                        </div>
                    </div>
                )}

                {/* Referral Widget on Complete */}
                {state.step === 'COMPLETE' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                        <ReferralWidget leadId={state.data.leadId} />
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-slate-900 border-t border-slate-800">
                <div className="flex items-center gap-2">
                    <VoiceInput onTranscript={handleVoiceInput} />

                    <div className="flex-1 relative">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(input)}
                            placeholder={state.step === 'COMPLETE' ? "Application submitted." : "Type your answer..."}
                            disabled={state.step === 'COMPLETE' || isSubmitting}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all"
                        />
                    </div>

                    <button
                        onClick={() => handleSendMessage(input)}
                        disabled={!input.trim() || state.step === 'COMPLETE' || isSubmitting}
                        className="p-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Send size={20} />
                    </button>
                </div>
            </div>
        </div >
    );
}

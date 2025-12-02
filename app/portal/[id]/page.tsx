'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Loader2, Upload, CheckCircle, FileText, Shield } from 'lucide-react';

export default function ApplicationPortal() {
    const params = useParams();
    const router = useRouter();
    const id = params.id as string;
    const [application, setApplication] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState<string | null>(null);

    useEffect(() => {
        const session = localStorage.getItem('portal_session');
        if (!session || session !== id) {
            router.push('/portal/login');
            return;
        }
        if (id) fetchApplication();
    }, [id]);

    const fetchApplication = async () => {
        try {
            const { data, error } = await supabase
                .from('applications')
                .select('*, leads(*)')
                .eq('lead_id', id)
                .single();

            if (error) throw error;
            setApplication(data);
        } catch (error) {
            console.error('Error fetching application:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleUpload = async (file: File, docType: string) => {
        setUploading(docType);
        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${id}/${docType}_${Date.now()}.${fileExt}`;
            const { error: uploadError } = await supabase.storage
                .from('documents')
                .upload(fileName, file);

            if (uploadError) throw uploadError;

            alert('Document uploaded successfully!');
        } catch (error) {
            console.error('Upload error:', error);
            alert('Upload failed.');
        } finally {
            setUploading(null);
        }
    };

    if (loading) return <div className="flex items-center justify-center h-screen bg-slate-950 text-white"><Loader2 className="animate-spin" /></div>;

    if (!application) return <div className="flex items-center justify-center h-screen bg-slate-950 text-white">Application not found.</div>;

    const documents = [
        { id: 'id_proof', label: 'Government ID / Passport', required: true },
        { id: 'bank_statements', label: 'Last 3 Months Bank Statements', required: true },
        { id: 'tax_returns', label: 'Last 2 Years Tax Returns', required: false },
        { id: 'entity_docs', label: 'Business Entity Docs (LLC/Corp)', required: false },
    ];

    return (
        <div className="min-h-screen bg-slate-950 text-white p-6">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-bold">Application Portal</h1>
                        <p className="text-slate-400">ID: {id}</p>
                    </div>
                    <div className="bg-emerald-500/10 text-emerald-500 px-4 py-2 rounded-full border border-emerald-500/20 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        {application.status || 'Under Review'}
                    </div>
                </div>

                {/* Main Content */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Status Card */}
                    <div className="md:col-span-2 space-y-6">
                        <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800">
                            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                                <FileText className="text-emerald-500" />
                                Required Documents
                            </h2>
                            <p className="text-slate-400 mb-6">
                                Please upload the following documents to finalize your loan application.
                                These files are stored securely and encrypted.
                            </p>

                            <div className="space-y-4">
                                {documents.map((doc) => (
                                    <div key={doc.id} className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-slate-900 flex items-center justify-center border border-slate-800">
                                                <Upload className="w-5 h-5 text-slate-400" />
                                            </div>
                                            <div>
                                                <h3 className="font-medium">{doc.label}</h3>
                                                {doc.required && <span className="text-xs text-rose-400">Required</span>}
                                            </div>
                                        </div>
                                        <label className="cursor-pointer bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2">
                                            {uploading === doc.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                                            Upload
                                            <input
                                                type="file"
                                                className="hidden"
                                                onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0], doc.id)}
                                            />
                                        </label>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Sidebar */}
                    <div className="space-y-6">
                        <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800">
                            <h3 className="font-semibold mb-4">Your Loan Officer</h3>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                                    <span className="font-bold text-emerald-500">F</span>
                                </div>
                                <div>
                                    <p className="font-medium">Frank</p>
                                    <p className="text-xs text-slate-400">Senior Loan Coordinator</p>
                                </div>
                            </div>
                            <button className="w-full bg-slate-800 hover:bg-slate-700 text-white py-2 rounded-lg transition-colors text-sm">
                                Contact Support
                            </button>
                        </div>

                        <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800">
                            <h3 className="font-semibold mb-4 flex items-center gap-2">
                                <Shield className="w-4 h-4 text-emerald-500" />
                                Secure Portal
                            </h3>
                            <p className="text-xs text-slate-400">
                                Your data is protected with bank-level 256-bit encryption.
                                Only authorized underwriting personnel have access to your documents.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

'use client';

import { useState } from 'react';
import { Upload, FileText, Loader2 } from 'lucide-react';
import { processDocument, ExtractedData } from '@/lib/apply/document-processor';

interface FileUploaderProps {
    onExtraction: (data: ExtractedData) => void;
}

export default function FileUploader({ onExtraction }: FileUploaderProps) {
    const [isProcessing, setIsProcessing] = useState(false);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsProcessing(true);
        try {
            const data = await processDocument(file);
            onExtraction(data);
        } catch (error) {
            console.error('Extraction failed', error);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="relative">
            <input
                type="file"
                id="file-upload"
                className="hidden"
                onChange={handleFileChange}
                accept=".pdf,.jpg,.jpeg,.png"
                disabled={isProcessing}
            />
            <label
                htmlFor="file-upload"
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-slate-700 bg-slate-900/50 text-slate-400 cursor-pointer hover:bg-slate-800/50 transition-colors ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
            >
                {isProcessing ? (
                    <>
                        <Loader2 size={16} className="animate-spin" />
                        <span className="text-xs">Scanning...</span>
                    </>
                ) : (
                    <>
                        <Upload size={16} />
                        <span className="text-xs">Upload ID or Bank Statement</span>
                    </>
                )}
            </label>
        </div>
    );
}

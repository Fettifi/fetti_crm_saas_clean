import { supabase } from '@/lib/supabaseClient';

export interface ExtractedData {
    fullName?: string;
    address?: string;
    revenue?: number;
    employerName?: string;
    monthlyIncome?: number;
    documentType: 'ID' | 'BankStatement' | 'W2' | 'Paystub' | 'Unknown';
    fileUrl?: string;
}

export async function uploadDocument(file: File): Promise<string | null> {
    try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `uploads/${fileName}`;

        const { error } = await supabase.storage
            .from('documents')
            .upload(filePath, file);

        if (error) {
            console.error('Upload error:', error);
            return null;
        }

        const { data } = supabase.storage
            .from('documents')
            .getPublicUrl(filePath);

        return data.publicUrl;
    } catch (error) {
        console.error('Upload exception:', error);
        return null;
    }
}

export async function processDocument(file: File): Promise<ExtractedData> {
    // 1. Upload File
    const fileUrl = await uploadDocument(file);

    // Simulate processing delay (Mock OCR)
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const fileName = file.name.toLowerCase();
    let data: ExtractedData = { documentType: 'Unknown', fileUrl: fileUrl || undefined };

    if (fileName.includes('id') || fileName.includes('license') || fileName.includes('passport')) {
        data = {
            ...data,
            documentType: 'ID',
            fullName: 'John Doe', // Mock extraction
            address: '123 Main St, Springfield, IL',
        };
    } else if (fileName.includes('bank') || fileName.includes('statement')) {
        data = {
            ...data,
            documentType: 'BankStatement',
            revenue: 500000, // Mock extraction
        };
    } else if (fileName.includes('w2') || fileName.includes('w-2')) {
        data = {
            ...data,
            documentType: 'W2',
            employerName: 'Acme Corp',
            monthlyIncome: 8500,
        };
    } else if (fileName.includes('paystub') || fileName.includes('pay')) {
        data = {
            ...data,
            documentType: 'Paystub',
            employerName: 'Acme Corp',
            monthlyIncome: 8500,
        };
    }

    return data;
}

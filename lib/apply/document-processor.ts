import { supabase } from '@/lib/supabaseClient';

export interface ExtractedData {
    fullName?: string;
    address?: string;
    revenue?: number;
    employerName?: string;
    monthlyIncome?: number;
    documentType: 'ID' | 'BankStatement' | 'W2' | 'Paystub' | 'Unknown';
    fileUrl?: string;
    base64?: string; // New field for Vision API
    mimeType?: string; // New field for Vision API
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
    // 2. Convert to Base64 for Vision API (Priority)
    const base64Promise = new Promise<{ base64: string, mimeType: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            let mimeType = file.type;

            // Fallback for missing mime type
            if (!mimeType) {
                const ext = file.name.split('.').pop()?.toLowerCase();
                if (ext === 'pdf') mimeType = 'application/pdf';
                else if (ext === 'png') mimeType = 'image/png';
                else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
                else mimeType = 'application/octet-stream';
            }

            // If image, compress it
            if (mimeType.startsWith('image/')) {
                const img = new Image();
                img.src = result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_WIDTH = 1024;
                    const scaleSize = MAX_WIDTH / img.width;
                    canvas.width = MAX_WIDTH;
                    canvas.height = img.height * scaleSize;

                    const ctx = canvas.getContext('2d');
                    ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);

                    const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
                    const compressedBase64 = compressedDataUrl.split(',')[1];
                    resolve({ base64: compressedBase64, mimeType: 'image/jpeg' });
                };
                img.onerror = (err) => {
                    console.warn('Image compression failed, using original', err);
                    resolve({ base64: result.split(',')[1], mimeType });
                };
            } else {
                // Return original for PDF/other
                resolve({ base64: result.split(',')[1], mimeType });
            }
        };
        reader.onerror = error => reject(error);
    });

    // 2. Upload File (Secondary - don't block UI if this fails)
    const uploadPromise = uploadDocument(file).catch(err => {
        console.error("Background upload failed:", err);
        return null;
    });

    const [base64Data, fileUrl] = await Promise.all([base64Promise, uploadPromise]);

    const fileName = file.name.toLowerCase();
    let data: ExtractedData = {
        documentType: 'Unknown',
        fileUrl: fileUrl || undefined,
        base64: base64Data.base64,
        mimeType: base64Data.mimeType
    };

    // Basic filename heuristics (can be removed once Vision is active, but good as fallback)
    if (fileName.includes('id') || fileName.includes('license') || fileName.includes('passport')) {
        data.documentType = 'ID';
    } else if (fileName.includes('bank') || fileName.includes('statement')) {
        data.documentType = 'BankStatement';
    } else if (fileName.includes('w2') || fileName.includes('w-2')) {
        data.documentType = 'W2';
    } else if (fileName.includes('paystub') || fileName.includes('pay')) {
        data.documentType = 'Paystub';
    }

    return data;
}

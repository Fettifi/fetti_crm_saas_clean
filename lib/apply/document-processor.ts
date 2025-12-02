export interface ExtractedData {
    fullName?: string;
    address?: string;
    revenue?: number;
    documentType: 'ID' | 'BankStatement' | 'Unknown';
}

export async function processDocument(file: File): Promise<ExtractedData> {
    // Simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const fileName = file.name.toLowerCase();

    if (fileName.includes('id') || fileName.includes('license') || fileName.includes('passport')) {
        return {
            documentType: 'ID',
            fullName: 'John Doe', // Mock extraction
            address: '123 Main St, Springfield, IL',
        };
    }

    if (fileName.includes('bank') || fileName.includes('statement')) {
        return {
            documentType: 'BankStatement',
            revenue: 500000, // Mock extraction
        };
    }

    return {
        documentType: 'Unknown',
    };
}

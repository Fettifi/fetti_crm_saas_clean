export interface ExtractedData {
    fullName?: string;
    address?: string;
    revenue?: number;
    employerName?: string;
    monthlyIncome?: number;
    documentType: 'ID' | 'BankStatement' | 'W2' | 'Paystub' | 'Unknown';
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

    if (fileName.includes('w2') || fileName.includes('w-2')) {
        return {
            documentType: 'W2',
            employerName: 'Acme Corp',
            monthlyIncome: 8500,
        };
    }

    if (fileName.includes('paystub') || fileName.includes('pay')) {
        return {
            documentType: 'Paystub',
            employerName: 'Acme Corp',
            monthlyIncome: 8500,
        };
    }

    return {
        documentType: 'Unknown',
    };
}

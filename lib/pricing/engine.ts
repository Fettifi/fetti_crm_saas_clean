import { PricingRequest, Quote } from './types';
import { getMockQuotes } from './investors/mock';
// import { predictPricing } from '../intelligence/pricing-prediction'; // TODO: Implement
// import { detectPdfOverlay } from '../intelligence/pdf-overlay'; // TODO: Implement

export class PricingEngine {
    async calculateQuote(request: PricingRequest): Promise<Quote[]> {
        console.log('Calculating quote for request:', request);

        // 1. Validate Eligibility (Basic pre-checks)
        const validationErrors = this.validateEligibility(request);
        if (validationErrors.length > 0) {
            console.warn('Validation failed:', validationErrors);
            // In a real scenario, we might return early or flag these
        }

        // 2. Get Quotes from Investors (Mock for now)
        const quotes = await getMockQuotes(request);

        // 3. Apply Intelligence (Stubs)
        // const predictedPricing = await predictPricing(request);
        // console.log('Predicted Pricing:', predictedPricing);

        return quotes;
    }

    validateEligibility(request: PricingRequest): string[] {
        const errors: string[] = [];
        if (request.amount <= 0) errors.push('Amount must be positive');
        if (request.term <= 0) errors.push('Term must be positive');
        if (request.creditScore < 300 || request.creditScore > 850) errors.push('Invalid credit score');
        return errors;
    }
}

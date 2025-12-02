import { Investor, PricingRequest, Quote } from '../types';

export const MOCK_INVESTORS: Investor[] = [
    {
        id: 'inv_001',
        name: 'Alpha Capital',
        criteria: {
            minCreditScore: 600,
            minRevenue: 100000,
            restrictedIndustries: ['Gambling', 'Adult'],
            restrictedStates: ['NY', 'CA'],
            maxAmount: 500000,
        },
    },
    {
        id: 'inv_002',
        name: 'Beta Funding',
        criteria: {
            minCreditScore: 550,
            minRevenue: 50000,
            restrictedIndustries: [],
            restrictedStates: [],
            maxAmount: 200000,
        },
    },
    {
        id: 'inv_003',
        name: 'Gamma Ventures',
        criteria: {
            minCreditScore: 680,
            minRevenue: 250000,
            restrictedIndustries: ['Construction'],
            restrictedStates: [],
            maxAmount: 1000000,
        },
    },
];

export async function getMockQuotes(request: PricingRequest): Promise<Quote[]> {
    // Simulate API latency
    await new Promise((resolve) => setTimeout(resolve, 500));

    return MOCK_INVESTORS.map((investor) => {
        const { criteria } = investor;
        let status: Quote['status'] = 'approved';
        let reason: string | undefined;

        if (request.creditScore < criteria.minCreditScore) {
            status = 'rejected';
            reason = 'Credit score too low';
        } else if (request.revenue < criteria.minRevenue) {
            status = 'rejected';
            reason = 'Revenue too low';
        } else if (criteria.restrictedIndustries.includes(request.industry)) {
            status = 'rejected';
            reason = 'Restricted industry';
        } else if (criteria.restrictedStates.includes(request.state)) {
            status = 'rejected';
            reason = 'Restricted state';
        } else if (request.amount > criteria.maxAmount) {
            status = 'referral';
            reason = 'Amount exceeds limit';
        }

        // Simple mock rate calculation
        const baseRate = 0.10; // 10%
        const riskFactor = (850 - request.creditScore) / 1000;
        const rate = status === 'approved' ? baseRate + riskFactor : 0;
        const payment = status === 'approved' ? (request.amount * (1 + rate)) / request.term : 0;

        return {
            investorId: investor.id,
            investorName: investor.name,
            amount: request.amount,
            term: request.term,
            rate: Number(rate.toFixed(4)),
            payment: Number(payment.toFixed(2)),
            status,
            reason,
        };
    });
}

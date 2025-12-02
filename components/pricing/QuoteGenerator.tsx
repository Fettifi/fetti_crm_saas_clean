'use client';

import { useState } from 'react';
import { PricingEngine } from '@/lib/pricing/engine';
import { PricingRequest, Quote } from '@/lib/pricing/types';

export default function QuoteGenerator() {
    const [loading, setLoading] = useState(false);
    const [quotes, setQuotes] = useState<Quote[]>([]);
    const [formData, setFormData] = useState<PricingRequest>({
        dealId: `deal_${Date.now()}`,
        amount: 100000,
        term: 12,
        creditScore: 700,
        revenue: 500000,
        industry: 'Technology',
        state: 'CA',
    });

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({
            ...prev,
            [name]: name === 'amount' || name === 'term' || name === 'creditScore' || name === 'revenue'
                ? Number(value)
                : value,
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setQuotes([]);

        try {
            const engine = new PricingEngine();
            const results = await engine.calculateQuote(formData);
            setQuotes(results);
        } catch (error) {
            console.error('Error generating quote:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow border">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium mb-1">Amount</label>
                    <input
                        type="number"
                        name="amount"
                        value={formData.amount}
                        onChange={handleInputChange}
                        className="w-full p-2 border rounded"
                        required
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium mb-1">Term (Months)</label>
                    <input
                        type="number"
                        name="term"
                        value={formData.term}
                        onChange={handleInputChange}
                        className="w-full p-2 border rounded"
                        required
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium mb-1">Credit Score</label>
                    <input
                        type="number"
                        name="creditScore"
                        value={formData.creditScore}
                        onChange={handleInputChange}
                        className="w-full p-2 border rounded"
                        required
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium mb-1">Annual Revenue</label>
                    <input
                        type="number"
                        name="revenue"
                        value={formData.revenue}
                        onChange={handleInputChange}
                        className="w-full p-2 border rounded"
                        required
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium mb-1">Industry</label>
                    <input
                        type="text"
                        name="industry"
                        value={formData.industry}
                        onChange={handleInputChange}
                        className="w-full p-2 border rounded"
                        required
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium mb-1">State</label>
                    <input
                        type="text"
                        name="state"
                        value={formData.state}
                        onChange={handleInputChange}
                        className="w-full p-2 border rounded"
                        required
                    />
                </div>
                <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
                >
                    {loading ? 'Generating Quotes...' : 'Get Quotes'}
                </button>
            </form>

            {quotes.length > 0 && (
                <div className="mt-6 space-y-4">
                    <h3 className="font-semibold text-lg">Quotes</h3>
                    {quotes.map((quote) => (
                        <div
                            key={quote.investorId}
                            className={`p-4 rounded border ${quote.status === 'approved' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                                }`}
                        >
                            <div className="flex justify-between items-start">
                                <div>
                                    <h4 className="font-bold">{quote.investorName}</h4>
                                    <p className="text-sm capitalize text-gray-700">Status: {quote.status}</p>
                                    {quote.reason && <p className="text-sm text-red-600">{quote.reason}</p>}
                                </div>
                                {quote.status === 'approved' && (
                                    <div className="text-right">
                                        <p className="text-xl font-bold">{(quote.rate * 100).toFixed(2)}%</p>
                                        <p className="text-sm text-gray-600">${quote.payment.toLocaleString()}/mo</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

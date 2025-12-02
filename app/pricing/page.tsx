import QuoteGenerator from '@/components/pricing/QuoteGenerator';

export default function PricingPage() {
    return (
        <div className="container mx-auto py-10">
            <h1 className="text-3xl font-bold mb-8">Pricing Engine</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                    <h2 className="text-xl font-semibold mb-4">Generate New Quote</h2>
                    <QuoteGenerator />
                </div>
                <div>
                    <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
                    <div className="bg-white p-6 rounded-lg shadow border">
                        <p className="text-gray-500">No recent quotes generated.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

import ChatInterface from '@/components/apply/ChatInterface';
import { Metadata } from 'next';

type Props = {
    params: Promise<{ product: string }>
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { product: productSlug } = await params;
    const product = productSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return {
        title: `Apply for ${product} | Fetti CRM`,
        description: `Get funded fast with our ${product} program. Verified leads get instant approval.`,
    };
}

export default async function ProductApplyPage({ params }: Props) {
    const { product } = await params;
    // Map URL slug to internal product ID
    const productMap: Record<string, string> = {
        'fix-and-flip': 'FixAndFlip',
        'construction': 'Construction',
        'bridge': 'Bridge',
        'refinance': 'Refinance',
        'purchase': 'Purchase',
    };

    const selectedProduct = productMap[product] || null;

    return (
        <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-24 bg-slate-950">
            <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm lg:flex mb-8">
                <p className="fixed left-0 top-0 flex w-full justify-center border-b border-slate-800 bg-gradient-to-b from-slate-900 pb-6 pt-8 backdrop-blur-2xl lg:static lg:w-auto lg:rounded-xl lg:border lg:bg-slate-900/50 lg:p-4 text-emerald-400">
                    Fetti CRM &nbsp;
                    <span className="font-bold text-white">Autonomous Closer</span>
                </p>
            </div>

            <div className="w-full max-w-2xl mb-8 text-center">
                <h1 className="text-3xl font-bold text-white mb-2 capitalize">
                    {product.replace(/-/g, ' ')} Application
                </h1>
                <p className="text-slate-400">
                    Fast-track your funding with our AI-powered application.
                </p>
            </div>

            <ChatInterface initialProduct={selectedProduct} />
        </main>
    );
}

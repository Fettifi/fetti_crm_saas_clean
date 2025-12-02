export type LoanType = 'Business' | 'Mortgage' | null;
export type MortgageProduct = 'Purchase' | 'Refinance' | 'Construction' | 'Other' | null;

export interface ConversationState {
    step: string;
    loanType: LoanType;
    data: {
        // Common
        fullName?: string;
        email?: string;
        phone?: string;

        // Business
        revenue?: number;
        industry?: string;

        // Mortgage (1003 Sections)
        mortgageProduct?: MortgageProduct;
        propertyType?: string;
        propertyAddress?: string;
        occupancy?: 'Primary' | 'Secondary' | 'Investment';

        // Employment & Income
        employerName?: string;
        position?: string;
        yearsEmployed?: number;
        monthlyIncome?: number;

        // Assets
        liquidAssets?: number; // Cash, Bank accounts

        // Declarations
        bankruptcy?: boolean;
        lawsuits?: boolean;

        // Meta
        downPayment?: number;
        creditScore?: number;
    };
    history: Message[];
}

export interface Message {
    id: string;
    role: 'system' | 'user';
    content: string;
    type?: 'text' | 'options' | 'upload';
    options?: string[];
}

export const INITIAL_STATE: ConversationState = {
    step: 'INIT',
    loanType: null,
    data: {},
    history: [
        {
            id: 'welcome',
            role: 'system',
            content: "Hi! I'm Fetti, your AI assistant. I can help you apply for a loan quickly. To get started, what's your full name?",
            type: 'text',
        },
    ],
};

export function getNextStep(state: ConversationState, input: string): Partial<ConversationState> {
    const { step, loanType, data } = state;
    const nextData = { ...data };
    let nextStep = step;
    let nextMessage: Message | null = null;

    switch (step) {
        case 'INIT':
            nextData.fullName = input;
            nextStep = 'ASK_LOAN_TYPE';
            nextMessage = {
                id: 'ask_loan_type',
                role: 'system',
                content: `Nice to meet you, ${input}! Are you looking for a Business Loan or a Mortgage Loan?`,
                type: 'options',
                options: ['Business Loan', 'Mortgage Loan'],
            };
            break;

        case 'ASK_LOAN_TYPE':
            if (input.toLowerCase().includes('business')) {
                nextStep = 'BUSINESS_REVENUE';
                nextMessage = {
                    id: 'ask_revenue',
                    role: 'system',
                    content: "Great! Let's talk business. What is your annual revenue? (You can also upload a bank statement to skip this!)",
                    type: 'upload',
                };
                return { step: nextStep, loanType: 'Business', data: nextData, history: [...state.history, { id: Date.now().toString(), role: 'user', content: input }, nextMessage] };
            } else if (input.toLowerCase().includes('mortgage')) {
                nextStep = 'MORTGAGE_PRODUCT';
                nextMessage = {
                    id: 'ask_mortgage_product',
                    role: 'system',
                    content: "Exciting! What are you looking to do today?",
                    type: 'options',
                    options: ['Purchase a Home', 'Refinance', 'Construction Loan', 'Other'],
                };
                return { step: nextStep, loanType: 'Mortgage', data: nextData, history: [...state.history, { id: Date.now().toString(), role: 'user', content: input }, nextMessage] };
            } else {
                nextMessage = {
                    id: 'ask_loan_type_retry',
                    role: 'system',
                    content: "I didn't quite catch that. Business Loan or Mortgage Loan?",
                    type: 'options',
                    options: ['Business Loan', 'Mortgage Loan'],
                };
            }
            break;

        // --- Mortgage Flow (1003) ---

        case 'MORTGAGE_PRODUCT':
            if (input.toLowerCase().includes('purchase')) nextData.mortgageProduct = 'Purchase';
            else if (input.toLowerCase().includes('refinance')) nextData.mortgageProduct = 'Refinance';
            else if (input.toLowerCase().includes('construction')) nextData.mortgageProduct = 'Construction';
            else nextData.mortgageProduct = 'Other';

            nextStep = 'MORTGAGE_PROPERTY';
            nextMessage = {
                id: 'ask_property',
                role: 'system',
                content: "Got it. Tell me about the property. Is it a Single Family Home, Condo, or something else?",
                type: 'text',
            };
            break;

        case 'MORTGAGE_PROPERTY':
            nextData.propertyType = input;
            nextStep = 'MORTGAGE_EMPLOYMENT';
            nextMessage = {
                id: 'ask_employment',
                role: 'system',
                content: "Thanks. Now, let's cover employment. Who is your current employer and what is your position? (You can upload a W2 or Paystub to speed this up!)",
                type: 'upload',
            };
            break;

        case 'MORTGAGE_EMPLOYMENT':
            // Simple extraction if they typed it
            nextData.employerName = input;
            nextStep = 'MORTGAGE_INCOME';
            nextMessage = {
                id: 'ask_income',
                role: 'system',
                content: "And what is your approximate monthly income from this job?",
                type: 'text',
            };
            break;

        case 'MORTGAGE_INCOME':
            nextData.monthlyIncome = parseInt(input.replace(/[^0-9]/g, '')) || 0;
            nextStep = 'MORTGAGE_ASSETS';
            nextMessage = {
                id: 'ask_assets',
                role: 'system',
                content: "Almost done with the financials. What is the total value of your liquid assets (Cash, Checking, Savings)?",
                type: 'text',
            };
            break;

        case 'MORTGAGE_ASSETS':
            nextData.liquidAssets = parseInt(input.replace(/[^0-9]/g, '')) || 0;
            nextStep = 'MORTGAGE_DECLARATIONS';
            nextMessage = {
                id: 'ask_declarations',
                role: 'system',
                content: "Last step - just a quick legal check. Have you declared bankruptcy in the last 7 years?",
                type: 'options',
                options: ['Yes', 'No'],
            };
            break;

        case 'MORTGAGE_DECLARATIONS':
            nextData.bankruptcy = input.toLowerCase().includes('yes');
            nextStep = 'ASK_EMAIL';
            nextMessage = {
                id: 'ask_email',
                role: 'system',
                content: "Perfect, thanks for all that info. What's the best email address to send your application summary to?",
                type: 'text',
            };
            break;

        // --- Business Flow ---

        case 'BUSINESS_REVENUE':
            nextData.revenue = parseInt(input.replace(/[^0-9]/g, '')) || 0;
            nextStep = 'ASK_EMAIL';
            nextMessage = {
                id: 'ask_email',
                role: 'system',
                content: "Got it. What's the best email address to reach you at?",
                type: 'text',
            };
            break;

        // --- Common ---

        case 'ASK_EMAIL':
            nextData.email = input;
            nextStep = 'COMPLETE';
            nextMessage = {
                id: 'complete',
                role: 'system',
                content: "Fantastic! I've gathered all the necessary information for your 1003 application. Submitting it to our underwriting team now...",
                type: 'text',
            };
            break;
    }

    if (nextMessage) {
        return {
            step: nextStep,
            data: nextData,
            history: [...state.history, { id: Date.now().toString(), role: 'user', content: input }, nextMessage],
        };
    }

    return {};
}

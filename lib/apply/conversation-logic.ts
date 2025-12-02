export type LoanType = 'Business' | 'Mortgage' | null;

export interface ConversationState {
    step: string;
    loanType: LoanType;
    data: {
        fullName?: string;
        email?: string;
        phone?: string;
        revenue?: number;
        industry?: string;
        propertyType?: string;
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
                nextStep = 'MORTGAGE_PROPERTY';
                nextMessage = {
                    id: 'ask_property',
                    role: 'system',
                    content: "Exciting! What type of property are you looking to buy? (e.g., Single Family, Condo, Multi-unit)",
                    type: 'text',
                };
                return { step: nextStep, loanType: 'Mortgage', data: nextData, history: [...state.history, { id: Date.now().toString(), role: 'user', content: input }, nextMessage] };
            } else {
                // Fallback
                nextMessage = {
                    id: 'ask_loan_type_retry',
                    role: 'system',
                    content: "I didn't quite catch that. Business Loan or Mortgage Loan?",
                    type: 'options',
                    options: ['Business Loan', 'Mortgage Loan'],
                };
            }
            break;

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

        case 'MORTGAGE_PROPERTY':
            nextData.propertyType = input;
            nextStep = 'ASK_EMAIL';
            nextMessage = {
                id: 'ask_email',
                role: 'system',
                content: "Understood. What's the best email address to reach you at?",
                type: 'text',
            };
            break;

        case 'ASK_EMAIL':
            nextData.email = input;
            nextStep = 'COMPLETE';
            nextMessage = {
                id: 'complete',
                role: 'system',
                content: "Perfect! I have everything I need to get your application started. Submitting now...",
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

import { calculateDealScore, DealScore } from '@/lib/intelligence/deal-scorer';
import { logInteraction } from '@/lib/learning/optimization-engine';
import { verifyIdentity, verifyAssets, verifyProperty } from '@/lib/intelligence/lead-enrichment';
import { scheduleStandardSequence, triggerBehavioralEmail } from '@/lib/automations/scheduler';

export type LoanType = 'Business' | 'Mortgage' | null;
export type BusinessProduct = 'MCA' | 'Line of Credit' | 'Working Capital' | 'Factoring' | null;
export type MortgageProduct = 'Purchase' | 'Refinance' | 'New Construction' | 'FixAndFlip' | 'Bridge' | 'Other' | null;

export interface ConversationState {
    step: string;
    loanType: LoanType;
    dealScore: DealScore;
    data: {
        // Common
        fullName?: string;
        email?: string;
        phone?: string;
        leadId?: string;

        // Business
        businessProduct?: BusinessProduct;
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

        // Investment Specific
        purchasePrice?: number;
        rehabBudget?: number;
        arv?: number; // After Repair Value
        experience?: string; // 0, 1-2, 3+
        exitStrategy?: string;

        // Verification Flags
        identityVerified?: boolean;
        assetsVerified?: boolean;
        propertyVerified?: boolean;
    };
    history: Message[];
}

export interface Message {
    id: string;
    role: 'system' | 'user';
    content: string;
    type?: 'text' | 'options' | 'upload' | 'verify_identity' | 'verify_assets' | 'verify_property'; // Added new types
    options?: string[];
}

export const INITIAL_STATE: ConversationState = {
    step: 'INIT',
    loanType: null,
    dealScore: { score: 50, probability: 'Medium', recommendation: '', missingCriticalInfo: [] },
    data: {},
    history: [
        {
            id: 'welcome',
            role: 'system',
            content: "Hi! I'm Fetti, your AI assistant. I'm here to get you funded. To start, what's your full name?",
            type: 'text',
        },
    ],
};

// --- Dynamic Graph Logic ---

export function getNextStep(state: ConversationState, input: string): Partial<ConversationState> {
    const { step, data } = state;
    const nextData = { ...data };

    // 1. Capture Data based on current step
    captureData(step, input, nextData);

    // 2. Recalculate Score
    const newScore = calculateDealScore(nextData);

    // 3. Determine Next Step based on Graph & Score
    const { nextStep, nextMessage } = determineNextMove(step, nextData, newScore, input);

    // 4. Log Interaction
    logInteraction(step, 'complete');
    logInteraction(nextStep, 'view');

    if (nextMessage) {
        return {
            step: nextStep,
            dealScore: newScore,
            data: nextData,
            history: [...state.history, { id: Date.now().toString(), role: 'user', content: input }, nextMessage],
        };
    }

    return {};
}

function captureData(step: string, input: string, data: any) {
    const cleanNum = (str: string) => parseInt(str.replace(/[^0-9]/g, '')) || 0;

    switch (step) {
        case 'INIT': data.fullName = input; break;
        case 'ASK_LOAN_TYPE': /* Handled in logic */ break;
        case 'BUSINESS_PRODUCT': /* Handled in logic, but let's save string */ data.businessProduct = input; break;
        case 'BUSINESS_REVENUE': data.revenue = cleanNum(input); break;
        case 'MORTGAGE_PRODUCT': /* Handled in logic */ break;
        case 'MORTGAGE_LOAN_AMOUNT': data.purchasePrice = cleanNum(input); break; // Map to purchasePrice for now to align with DB
        case 'MORTGAGE_PROPERTY': data.propertyType = input; break;
        case 'MORTGAGE_EMPLOYMENT': data.employerName = input; break;
        case 'MORTGAGE_INCOME': data.monthlyIncome = cleanNum(input); break;
        case 'MORTGAGE_ASSETS': data.liquidAssets = cleanNum(input); break;
        case 'MORTGAGE_DECLARATIONS': data.bankruptcy = input.toLowerCase().includes('yes'); break;
        case 'INV_PURCHASE_PRICE': data.purchasePrice = cleanNum(input); break;
        case 'INV_REHAB_BUDGET': data.rehabBudget = cleanNum(input); break;
        case 'INV_LAND_VALUE': data.purchasePrice = cleanNum(input); break; // Map Land Value to Purchase Price/Asset Value
        case 'INV_CONST_BUDGET': data.rehabBudget = cleanNum(input); break; // Map Const Budget to Rehab/Project Budget
        case 'INV_ARV': data.arv = cleanNum(input); break;
        case 'INV_EXPERIENCE': data.experience = input; break;
        case 'INV_EXIT_STRATEGY': data.exitStrategy = input; break;
        case 'INV_BRIDGE_AMOUNT': data.purchasePrice = cleanNum(input); break; // New capture for Bridge
        case 'ASK_EMAIL': data.email = input; break;

        // Verification Captures (Simulated)
        case 'VERIFY_IDENTITY':
            data.identityVerified = true;
            data.creditScore = 740; // Mock enrichment
            break;
        case 'VERIFY_ASSETS':
            data.assetsVerified = true;
            data.liquidAssets = 125000; // Mock enrichment
            break;
        case 'VERIFY_PROPERTY':
            data.propertyVerified = true;
            // data.arv = 850000; // Could enrich here
            break;
    }
}

function determineNextMove(currentStep: string, data: any, score: DealScore, lastInput: string): { nextStep: string, nextMessage: Message } {
    let nextStep = currentStep;
    let nextMessage: Message = { id: 'error', role: 'system', content: "Thinking...", type: 'text' };

    // --- Objection Handling / Intervention ---
    if (score.probability === 'Low' && currentStep !== 'OBJECTION_HANDLING' && currentStep !== 'ASK_LOAN_TYPE') {
        return {
            nextStep: 'OBJECTION_HANDLING',
            nextMessage: {
                id: 'intervention',
                role: 'system',
                content: "I noticed some factors might make approval tricky. Would you be open to adding a co-signer or looking at alternative programs to boost your chances?",
                type: 'options',
                options: ['Yes, tell me more', 'No, continue as is'],
            }
        };
    }

    if (currentStep === 'OBJECTION_HANDLING') {
        if (lastInput.toLowerCase().includes('yes')) {
            return {
                nextStep: 'MORTGAGE_ASSETS',
                nextMessage: { id: 'pivot', role: 'system', content: "Great. Strong assets can often offset other factors. What is the total value of your liquid assets?", type: 'text' }
            };
        } else {
            return {
                nextStep: 'MORTGAGE_ASSETS',
                nextMessage: { id: 'continue', role: 'system', content: "Understood. Let's proceed. What is the total value of your liquid assets?", type: 'text' }
            };
        }
    }

    // --- Main Graph Traversal ---

    switch (currentStep) {
        case 'INIT':
            // New: Verify Identity immediately for "Velvet Rope" feel
            nextStep = 'VERIFY_IDENTITY';
            nextMessage = {
                id: 'verify_id',
                role: 'system',
                content: `Welcome, ${data.fullName}. To access our exclusive rates, we need to verify your identity securely.`,
                type: 'verify_identity', // New UI type
            };
            break;

        case 'VERIFY_IDENTITY':
            nextStep = 'ASK_LOAN_TYPE';
            nextMessage = {
                id: 'ask_loan_type',
                role: 'system',
                content: "Identity Verified. Access Granted. Are you looking for a Business Loan or a Mortgage Loan?",
                type: 'options',
                options: ['Business Loan', 'Mortgage Loan'],
            };
            break;

        case 'ASK_LOAN_TYPE':
            if (lastInput.toLowerCase().includes('business')) {
                nextStep = 'BUSINESS_PRODUCT';
                nextMessage = {
                    id: 'ask_biz_prod',
                    role: 'system',
                    content: "Business Funding. Smart choice. Which product fits your needs?",
                    type: 'options',
                    options: ['MCA', 'Line of Credit', 'Working Capital', 'Factoring']
                };
            } else {
                nextStep = 'MORTGAGE_PRODUCT';
                nextMessage = { id: 'ask_mortgage_product', role: 'system', content: "Real Estate. Excellent. What's the strategy? Purchase, Refi, Fix & Flip, or New Construction?", type: 'options', options: ['Purchase', 'Refinance', 'Fix & Flip', 'New Construction', 'Bridge'] };
            }
            break;

        case 'BUSINESS_PRODUCT':
            nextStep = 'BUSINESS_REVENUE';
            nextMessage = { id: 'ask_revenue', role: 'system', content: "Got it. What's your annual revenue? (Upload a bank statement to skip!)", type: 'upload' };
            break;

        case 'MORTGAGE_PRODUCT':
            const lower = lastInput.toLowerCase();
            if (lower.includes('fix')) {
                nextStep = 'INV_PURCHASE_PRICE';
                nextMessage = { id: 'ask_pp', role: 'system', content: "Fix & Flip. High potential. What's the purchase price?", type: 'text' };
            } else if (lower.includes('construction')) {
                nextStep = 'INV_LAND_VALUE';
                nextMessage = { id: 'ask_land', role: 'system', content: "New Construction. What's the land value?", type: 'text' };
            } else if (lower.includes('bridge')) {
                nextStep = 'INV_BRIDGE_AMOUNT';
                nextMessage = { id: 'ask_bridge_amt', role: 'system', content: "Bridge Loan. Speed is key. How much capital do you need?", type: 'text' };
            } else {
                nextStep = 'MORTGAGE_LOAN_AMOUNT';
                nextMessage = { id: 'ask_amt', role: 'system', content: "Standard Mortgage. How much are you looking to borrow?", type: 'text' };
            }
            break;

        case 'MORTGAGE_LOAN_AMOUNT':
            nextStep = 'MORTGAGE_PROPERTY';
            nextMessage = { id: 'ask_prop', role: 'system', content: "Got it. What type of property is this?", type: 'text' };
            break;

        // ... (Investment Steps) ...
        case 'INV_PURCHASE_PRICE':
            nextStep = 'INV_REHAB_BUDGET';
            nextMessage = { id: 'ask_rehab', role: 'system', content: "And the rehab budget?", type: 'text' };
            break;
        case 'INV_REHAB_BUDGET':
            nextStep = 'INV_ARV';
            nextMessage = { id: 'ask_arv', role: 'system', content: "What's the After Repair Value (ARV)?", type: 'text' };
            break;
        case 'INV_LAND_VALUE':
            nextStep = 'INV_CONST_BUDGET';
            nextMessage = { id: 'ask_const', role: 'system', content: "Construction budget?", type: 'text' };
            break;
        case 'INV_CONST_BUDGET':
            nextStep = 'INV_ARV';
            nextMessage = { id: 'ask_arv', role: 'system', content: "Projected ARV?", type: 'text' };
            break;
        case 'INV_BRIDGE_AMOUNT':
            nextStep = 'INV_EXIT_STRATEGY';
            nextMessage = { id: 'ask_exit', role: 'system', content: "Got it. What's your exit strategy?", type: 'text' };
            break;
        case 'INV_ARV':
            // New: Verify Property Value
            nextStep = 'VERIFY_PROPERTY';
            nextMessage = { id: 'verify_prop', role: 'system', content: "Checking property valuations...", type: 'verify_property' };
            break;
        case 'VERIFY_PROPERTY':
            nextStep = 'INV_EXPERIENCE';
            nextMessage = { id: 'ask_exp', role: 'system', content: "Valuation confirmed. How many similar projects have you done in the last 3 years?", type: 'options', options: ['0', '1-2', '3+'] };
            break;
        case 'INV_EXPERIENCE':
        case 'INV_EXIT_STRATEGY':
            // New: Verify Assets instead of asking
            nextStep = 'VERIFY_ASSETS';
            nextMessage = { id: 'verify_assets', role: 'system', content: "To finalize your pre-approval, please connect your primary bank account securely.", type: 'verify_assets' };
            break;

        // ... (Standard Steps) ...
        case 'MORTGAGE_PROPERTY':
            nextStep = 'MORTGAGE_EMPLOYMENT';
            nextMessage = { id: 'ask_emp', role: 'system', content: "Employment info. Who do you work for? (Upload W2/Paystub supported)", type: 'upload' };
            break;
        case 'MORTGAGE_EMPLOYMENT':
            nextStep = 'MORTGAGE_INCOME';
            nextMessage = { id: 'ask_inc', role: 'system', content: "Monthly income?", type: 'text' };
            break;
        case 'MORTGAGE_INCOME':
            nextStep = 'VERIFY_ASSETS'; // Use verification here too
            nextMessage = { id: 'verify_assets', role: 'system', content: "To finalize your pre-approval, please connect your primary bank account securely.", type: 'verify_assets' };
            break;

        // ... (Closing Steps) ...
        case 'BUSINESS_REVENUE':
        case 'VERIFY_ASSETS': // Replaces MORTGAGE_ASSETS
        case 'MORTGAGE_ASSETS':
            // Fast Track Check
            if (score.probability === 'High') {
                nextStep = 'ASK_EMAIL';
                nextMessage = { id: 'ask_email_fast', role: 'system', content: "Your profile is verified and excellent. I'm fast-tracking this. What's your email to send the funding agreement?", type: 'text' };
                // Trigger Fast Track Email (Note: We need leadId here, which we don't have in this pure function. 
                // Ideally this happens in the UI component or a side effect handler. 
                // For now, we'll assume the UI handles the side effect based on the message ID or we'd need to refactor to async/side-effects.)
            } else {
                nextStep = 'MORTGAGE_DECLARATIONS';
                nextMessage = { id: 'ask_dec', role: 'system', content: "Just a few final checks. Any bankruptcy in the last 7 years?", type: 'options', options: ['Yes', 'No'] };
            }
            break;

        case 'MORTGAGE_DECLARATIONS':
            nextStep = 'ASK_EMAIL';
            nextMessage = { id: 'ask_email', role: 'system', content: "Got it. What's your email to finalize the application?", type: 'text' };
            break;

        case 'ASK_EMAIL':
            nextStep = 'COMPLETE';
            nextMessage = { id: 'complete', role: 'system', content: "Application submitted! Our underwriting team is reviewing your verified file now.", type: 'text' };
            break;
    }

    return { nextStep, nextMessage };
}

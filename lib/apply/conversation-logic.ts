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
            content: "Hi! I'm Frank, your Loan Coordinator. I'm here to get you funded. To start, what's your full name?",
            type: 'text',
        },
    ],
};

// --- Dynamic Graph Logic ---

export function getNextStep(state: ConversationState, input: string): Partial<ConversationState> {
    const { step, data } = state;
    const nextData = { ...data };

    // 1. Validate Input
    const validationError = validateInput(step, input);
    if (validationError) {
        return {
            history: [...state.history, { id: Date.now().toString(), role: 'user', content: input }, { id: Date.now().toString() + '_err', role: 'system', content: validationError, type: 'text' }],
        };
    }

    // 2. Capture Data based on current step
    captureData(step, input, nextData);

    // 3. Recalculate Score
    const newScore = calculateDealScore(nextData);

    // 4. Determine Next Step based on Graph & Score
    const { nextStep, nextMessage } = determineNextMove(step, nextData, newScore, input);

    // 5. Log Interaction
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

function parseNumber(input: string): number {
    const lower = input.toLowerCase().trim();
    let multiplier = 1;
    if (lower.endsWith('k')) multiplier = 1000;
    else if (lower.endsWith('m')) multiplier = 1000000;
    else if (lower.endsWith('b')) multiplier = 1000000000;

    const numStr = lower.replace(/[^0-9.]/g, '');
    const num = parseFloat(numStr);
    return isNaN(num) ? 0 : Math.floor(num * multiplier);
}

export function validateInput(step: string, input: string): string | null {
    switch (step) {
        case 'INIT':
            if (input.length < 2) return "Please enter your full name.";
            break;
        case 'ASK_EMAIL':
            if (!input.includes('@') || !input.includes('.')) return "Please enter a valid email address.";
            break;
        case 'BUSINESS_REVENUE':
        case 'MORTGAGE_INCOME':
        case 'MORTGAGE_ASSETS':
        case 'INV_PURCHASE_PRICE':
        case 'INV_REHAB_BUDGET':
        case 'INV_LAND_VALUE':
        case 'INV_CONST_BUDGET':
        case 'INV_ARV':
        case 'INV_BRIDGE_AMOUNT':
        case 'MORTGAGE_LOAN_AMOUNT':
            if (parseNumber(input) <= 0) return "Please enter a valid amount greater than 0 (e.g., 100k, 50000).";
            break;
    }
    return null;
}

export function captureData(step: string, input: string, data: any) {
    switch (step) {
        case 'INIT': data.fullName = input; break;
        case 'ASK_LOAN_TYPE': /* Handled in logic */ break;
        case 'BUSINESS_PRODUCT': /* Handled in logic, but let's save string */ data.businessProduct = input; break;
        case 'BUSINESS_REVENUE': data.revenue = parseNumber(input); break;
        case 'MORTGAGE_PRODUCT': /* Handled in logic */ break;
        case 'MORTGAGE_LOAN_AMOUNT': data.purchasePrice = parseNumber(input); break; // Map to purchasePrice for now to align with DB
        case 'MORTGAGE_PROPERTY': data.propertyType = input; break;
        case 'MORTGAGE_EMPLOYMENT': data.employerName = input; break;
        case 'MORTGAGE_INCOME': data.monthlyIncome = parseNumber(input); break;
        case 'MORTGAGE_ASSETS': data.liquidAssets = parseNumber(input); break;
        case 'MORTGAGE_DECLARATIONS': data.bankruptcy = input.toLowerCase().includes('yes'); break;
        case 'INV_PURCHASE_PRICE': data.purchasePrice = parseNumber(input); break;
        case 'INV_REHAB_BUDGET': data.rehabBudget = parseNumber(input); break;
        case 'INV_LAND_VALUE': data.purchasePrice = parseNumber(input); break; // Map Land Value to Purchase Price/Asset Value
        case 'INV_CONST_BUDGET': data.rehabBudget = parseNumber(input); break; // Map Const Budget to Rehab/Project Budget
        case 'INV_ARV': data.arv = parseNumber(input); break;
        case 'INV_EXPERIENCE': data.experience = input; break;
        case 'INV_EXIT_STRATEGY': data.exitStrategy = input; break;
        case 'INV_BRIDGE_AMOUNT': data.purchasePrice = parseNumber(input); break; // New capture for Bridge
        case 'ASK_EMAIL':
            const emailMatch = input.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            data.email = emailMatch ? emailMatch[0] : input.trim();
            break;

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

function getAcknowledgement(step: string, input: string): string {
    const lower = input.toLowerCase();
    const acknowledgements = [
        "Got it.", "Understood.", "Okay.", "Noted.", "Great.", "Perfect.", "Thanks."
    ];
    const randomAck = () => acknowledgements[Math.floor(Math.random() * acknowledgements.length)];

    switch (step) {
        case 'INIT':
            return `Nice to meet you, ${input.split(' ')[0]}.`;
        case 'ASK_LOAN_TYPE':
            return lower.includes('business') ? "Business growth is what we do best." : "Real estate is a solid investment.";
        case 'BUSINESS_PRODUCT':
            return "That's a popular choice for flexibility.";
        case 'MORTGAGE_PRODUCT':
            if (lower.includes('fix')) return "Fix & Flip projects can be very lucrative.";
            if (lower.includes('construction')) return "Building from the ground up. Exciting.";
            if (lower.includes('bridge')) return "Bridge loans are great for speed.";
            return "A classic choice.";
        case 'BUSINESS_REVENUE':
        case 'MORTGAGE_INCOME':
            return "That's a healthy number.";
        default:
            return randomAck();
    }
}

function determineNextMove(currentStep: string, data: any, score: DealScore, lastInput: string): { nextStep: string, nextMessage: Message } {
    let nextStep = currentStep;
    let nextMessage: Message = { id: 'error', role: 'system', content: "Thinking...", type: 'text' };

    const ack = getAcknowledgement(currentStep, lastInput);

    // --- Objection Handling / Intervention ---
    if (score.probability === 'Low' && currentStep !== 'OBJECTION_HANDLING' && currentStep !== 'ASK_LOAN_TYPE') {
        return {
            nextStep: 'OBJECTION_HANDLING',
            nextMessage: {
                id: 'intervention',
                role: 'system',
                content: "I'm analyzing the numbers, and it looks like approval might be tight with the current profile. Would you be open to adding a co-signer or exploring alternative programs to boost your chances?",
                type: 'options',
                options: ['Yes, tell me more', 'No, continue as is'],
            }
        };
    }

    if (currentStep === 'OBJECTION_HANDLING') {
        if (lastInput.toLowerCase().includes('yes')) {
            return {
                nextStep: 'MORTGAGE_ASSETS',
                nextMessage: { id: 'pivot', role: 'system', content: "That's the spirit. Strong assets can often offset other factors. What is the total value of your liquid assets (cash, stocks, etc.)?", type: 'text' }
            };
        } else {
            return {
                nextStep: 'MORTGAGE_ASSETS',
                nextMessage: { id: 'continue', role: 'system', content: "Understood. We'll do our best with what we have. Moving on, what is the total value of your liquid assets?", type: 'text' }
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
                content: `${ack} To fast-track your approval, you can upload your ID or Passport now. It's completely optional but helps us get you the best rates.`,
                type: 'upload',
                options: ['I uploaded it', 'Skip for now']
            };
            break;

        case 'VERIFY_IDENTITY':
            nextStep = 'ASK_LOAN_TYPE';
            nextMessage = {
                id: 'ask_loan_type',
                role: 'system',
                content: "Got it. Let's move on. Are you looking for a Business Loan or a Mortgage Loan?",
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
                    content: `${ack} Which specific product are you interested in?`,
                    type: 'options',
                    options: ['MCA', 'Line of Credit', 'Working Capital', 'Factoring']
                };
            } else {
                nextStep = 'MORTGAGE_PRODUCT';
                nextMessage = { id: 'ask_mortgage_product', role: 'system', content: `${ack} What's the strategy for this property?`, type: 'options', options: ['Purchase', 'Refinance', 'Fix & Flip', 'New Construction', 'Bridge'] };
            }
            break;

        case 'BUSINESS_PRODUCT':
            nextStep = 'BUSINESS_REVENUE';
            nextMessage = { id: 'ask_revenue', role: 'system', content: `${ack} To get you the best offer, I need to know your annual revenue. (You can also upload a bank statement if that's easier!)`, type: 'upload' };
            break;

        case 'MORTGAGE_PRODUCT':
            const lower = lastInput.toLowerCase();
            if (lower.includes('fix')) {
                nextStep = 'INV_PURCHASE_PRICE';
                nextMessage = { id: 'ask_pp', role: 'system', content: `${ack} What's the purchase price of the property?`, type: 'text' };
            } else if (lower.includes('construction')) {
                nextStep = 'INV_LAND_VALUE';
                nextMessage = { id: 'ask_land', role: 'system', content: `${ack} What is the current value of the land?`, type: 'text' };
            } else if (lower.includes('bridge')) {
                nextStep = 'INV_BRIDGE_AMOUNT';
                nextMessage = { id: 'ask_bridge_amt', role: 'system', content: `${ack} How much capital do you need for this bridge loan?`, type: 'text' };
            } else {
                nextStep = 'MORTGAGE_LOAN_AMOUNT';
                nextMessage = { id: 'ask_amt', role: 'system', content: `${ack} How much are you looking to borrow?`, type: 'text' };
            }
            break;

        case 'MORTGAGE_LOAN_AMOUNT':
            nextStep = 'MORTGAGE_PROPERTY';
            nextMessage = { id: 'ask_prop', role: 'system', content: "Got it. And what type of property is this (e.g., Single Family, Condo, Multi-unit)?", type: 'text' };
            break;

        // ... (Investment Steps) ...
        case 'INV_PURCHASE_PRICE':
            nextStep = 'INV_REHAB_BUDGET';
            nextMessage = { id: 'ask_rehab', role: 'system', content: "Okay. And what is your estimated rehab budget?", type: 'text' };
            break;
        case 'INV_REHAB_BUDGET':
            nextStep = 'INV_ARV';
            nextMessage = { id: 'ask_arv', role: 'system', content: "Makes sense. What do you project the After Repair Value (ARV) will be?", type: 'text' };
            break;
        case 'INV_LAND_VALUE':
            nextStep = 'INV_CONST_BUDGET';
            nextMessage = { id: 'ask_const', role: 'system', content: "Okay. What is your total construction budget?", type: 'text' };
            break;
        case 'INV_CONST_BUDGET':
            nextStep = 'INV_ARV';
            nextMessage = { id: 'ask_arv', role: 'system', content: "Got it. What is the projected ARV upon completion?", type: 'text' };
            break;
        case 'INV_BRIDGE_AMOUNT':
            nextStep = 'INV_EXIT_STRATEGY';
            nextMessage = { id: 'ask_exit', role: 'system', content: "Understood. What is your exit strategy for this loan?", type: 'text' };
            break;
        case 'INV_ARV':
            // New: Verify Property Value
            nextStep = 'VERIFY_PROPERTY';
            nextMessage = { id: 'verify_prop', role: 'system', content: "Let me quickly check the property valuations in that area...", type: 'verify_property' };
            break;
        case 'VERIFY_PROPERTY':
            nextStep = 'INV_EXPERIENCE';
            nextMessage = { id: 'ask_exp', role: 'system', content: "Valuation looks consistent. How many similar projects have you successfully completed in the last 3 years?", type: 'options', options: ['0', '1-2', '3+'] };
            break;
        case 'INV_EXPERIENCE':
        case 'INV_EXIT_STRATEGY':
            // New: Verify Assets instead of asking
            nextStep = 'VERIFY_ASSETS';
            nextMessage = { id: 'verify_assets', role: 'system', content: "To finalize your pre-approval, please connect your primary bank account securely. This helps us verify reserves.", type: 'verify_assets' };
            break;

        // ... (Standard Steps) ...
        case 'MORTGAGE_PROPERTY':
            nextStep = 'MORTGAGE_EMPLOYMENT';
            nextMessage = { id: 'ask_emp', role: 'system', content: "Thanks. Now for employment info. Who is your current employer? (You can upload a W2 or Paystub if you prefer)", type: 'upload' };
            break;
        case 'MORTGAGE_EMPLOYMENT':
            nextStep = 'MORTGAGE_INCOME';
            nextMessage = { id: 'ask_inc', role: 'system', content: "And what is your gross monthly income?", type: 'text' };
            break;
        case 'MORTGAGE_INCOME':
            nextStep = 'VERIFY_ASSETS'; // Use verification here too
            nextMessage = { id: 'verify_assets', role: 'system', content: `${ack} To finalize your pre-approval, please connect your primary bank account securely.`, type: 'verify_assets' };
            break;

        // ... (Closing Steps) ...
        case 'BUSINESS_REVENUE':
        case 'VERIFY_ASSETS': // Replaces MORTGAGE_ASSETS
        case 'MORTGAGE_ASSETS':
            // Fast Track Check
            if (score.probability === 'High') {
                nextStep = 'ASK_EMAIL';
                nextMessage = { id: 'ask_email_fast', role: 'system', content: "Your profile is verified and looks excellent. I'm fast-tracking this application. What's the best email to send the funding agreement to?", type: 'text' };
            } else {
                nextStep = 'MORTGAGE_DECLARATIONS';
                nextMessage = { id: 'ask_dec', role: 'system', content: "Just a few final compliance checks. Have you declared bankruptcy in the last 7 years?", type: 'options', options: ['Yes', 'No'] };
            }
            break;

        case 'MORTGAGE_DECLARATIONS':
            nextStep = 'ASK_EMAIL';
            nextMessage = { id: 'ask_email', role: 'system', content: "Understood. What's the best email address to send your application summary to?", type: 'text' };
            break;

        case 'ASK_EMAIL':
            nextStep = 'COMPLETE';
            nextMessage = { id: 'complete', role: 'system', content: "Perfect. Application submitted! Our underwriting team is reviewing your verified file right now. You'll hear from us shortly.", type: 'text' };
            break;
    }

    return { nextStep, nextMessage };
}

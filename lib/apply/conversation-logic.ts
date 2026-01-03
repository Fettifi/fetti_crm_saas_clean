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

        // URLA 1003 Additional Fields
        dob?: string;
        ssn?: string;
        maritalStatus?: 'Married' | 'Separated' | 'Unmarried';
        citizenship?: 'US Citizen' | 'Permanent Resident' | 'Non-Permanent Resident';
        currentAddress?: string;
        yearsAtAddress?: number;
        previousAddress?: string;
        monthlyDebt?: number;

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
            content: "I'm Rupee, your Co-Founder. Let's get you funded. What's your full name?",
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
        case 'MORTGAGE_MONTHLY_DEBT':
            if (parseNumber(input) <= 0) return "Please enter a valid amount greater than 0 (e.g., 100k, 50000).";
            break;
        case 'MORTGAGE_DOB':
            if (!input.match(/^\d{2}\/\d{2}\/\d{4}$/)) return "Please enter your date of birth in MM/DD/YYYY format.";
            break;
        case 'MORTGAGE_SSN':
            if (input.replace(/[^0-9]/g, '').length < 4) return "Please enter at least the last 4 digits of your SSN.";
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
        case 'MORTGAGE_PROPERTY_ADDRESS': data.propertyAddress = input; break;
        case 'MORTGAGE_OCCUPANCY': data.occupancy = input as any; break;
        case 'MORTGAGE_EMPLOYMENT': data.employerName = input; break;
        case 'MORTGAGE_INCOME': data.monthlyIncome = parseNumber(input); break;
        case 'MORTGAGE_ASSETS': data.liquidAssets = parseNumber(input); break;
        case 'MORTGAGE_DECLARATIONS': data.bankruptcy = input.toLowerCase().includes('yes'); break;
        case 'MORTGAGE_LAWSUITS': data.lawsuits = input.toLowerCase().includes('yes'); break;
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
        case 'MORTGAGE_DOB': data.dob = input; break;
        case 'MORTGAGE_SSN': data.ssn = input; break;
        case 'MORTGAGE_MARITAL': data.maritalStatus = input as any; break;
        case 'MORTGAGE_CITIZENSHIP': data.citizenship = input as any; break;
        case 'MORTGAGE_CURRENT_ADDRESS': data.currentAddress = input; break;
        case 'MORTGAGE_YEARS_AT_ADDRESS': data.yearsAtAddress = parseNumber(input); break;
        case 'MORTGAGE_PREVIOUS_ADDRESS': data.previousAddress = input; break;
        case 'MORTGAGE_MONTHLY_DEBT': data.monthlyDebt = parseNumber(input); break;
    }
}

function getAcknowledgement(step: string, input: string): string {
    const lower = input.toLowerCase();
    const acknowledgements = [
        "On it.", "Copy that.", "Cool.", "Logged.", "Solid.", "Love it.", "Cheers."
    ];
    const randomAck = () => acknowledgements[Math.floor(Math.random() * acknowledgements.length)];

    switch (step) {
        case 'INIT':
            return `Nice to meet you, ${input.split(' ')[0]}. Let's build.`;
        case 'ASK_LOAN_TYPE':
            return lower.includes('business') ? "Business. High leverage. I like it." : "Real estate. Classic wealth builder.";
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
            nextStep = 'MORTGAGE_PROPERTY_ADDRESS';
            nextMessage = { id: 'ask_prop_addr', role: 'system', content: "Got it. What is the address of the property you're looking to finance?", type: 'text' };
            break;

        case 'MORTGAGE_PROPERTY_ADDRESS':
            nextStep = 'MORTGAGE_PROPERTY';
            nextMessage = { id: 'ask_prop', role: 'system', content: "Thanks. And what type of property is this (e.g., Single Family, Condo, Multi-unit)?", type: 'text' };
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
            nextStep = 'MORTGAGE_OCCUPANCY';
            nextMessage = { id: 'ask_occ', role: 'system', content: "Got it. Will this be your primary residence, a secondary home, or an investment property?", type: 'options', options: ['Primary', 'Secondary', 'Investment'] };
            break;
        case 'MORTGAGE_OCCUPANCY':
            nextStep = 'MORTGAGE_EMPLOYMENT';
            nextMessage = { id: 'ask_emp', role: 'system', content: "Thanks. Now for employment info. Who is your current employer? (You can upload a W2 or Paystub if you prefer)", type: 'upload' };
            break;
        case 'MORTGAGE_EMPLOYMENT':
            nextStep = 'MORTGAGE_INCOME';
            nextMessage = { id: 'ask_inc', role: 'system', content: "And what is your gross monthly income?", type: 'text' };
            break;
        case 'MORTGAGE_INCOME':
            nextStep = 'MORTGAGE_DOB';
            nextMessage = { id: 'ask_dob', role: 'system', content: "Got it. What is your date of birth? (MM/DD/YYYY)", type: 'text' };
            break;

        case 'MORTGAGE_DOB':
            nextStep = 'MORTGAGE_SSN';
            nextMessage = { id: 'ask_ssn', role: 'system', content: "Thanks. And for compliance, what is your Social Security Number?", type: 'text' };
            break;

        case 'MORTGAGE_SSN':
            nextStep = 'MORTGAGE_MARITAL';
            nextMessage = { id: 'ask_marital', role: 'system', content: "What is your marital status?", type: 'options', options: ['Married', 'Separated', 'Unmarried'] };
            break;

        case 'MORTGAGE_MARITAL':
            nextStep = 'MORTGAGE_CITIZENSHIP';
            nextMessage = { id: 'ask_citizenship', role: 'system', content: "What is your citizenship status?", type: 'options', options: ['US Citizen', 'Permanent Resident', 'Non-Permanent Resident'] };
            break;

        case 'MORTGAGE_CITIZENSHIP':
            nextStep = 'MORTGAGE_CURRENT_ADDRESS';
            nextMessage = { id: 'ask_curr_addr', role: 'system', content: "What is your current home address?", type: 'text' };
            break;

        case 'MORTGAGE_CURRENT_ADDRESS':
            nextStep = 'MORTGAGE_YEARS_AT_ADDRESS';
            nextMessage = { id: 'ask_years_addr', role: 'system', content: "How many years have you lived there?", type: 'text' };
            break;

        case 'MORTGAGE_YEARS_AT_ADDRESS':
            if (data.yearsAtAddress < 2) {
                nextStep = 'MORTGAGE_PREVIOUS_ADDRESS';
                nextMessage = { id: 'ask_prev_addr', role: 'system', content: "Since it's been less than 2 years, what was your previous address?", type: 'text' };
            } else {
                nextStep = 'MORTGAGE_MONTHLY_DEBT';
                nextMessage = { id: 'ask_debt', role: 'system', content: "Almost done. What is your total monthly debt (car payments, credit cards, etc.)?", type: 'text' };
            }
            break;

        case 'MORTGAGE_PREVIOUS_ADDRESS':
            nextStep = 'MORTGAGE_MONTHLY_DEBT';
            nextMessage = { id: 'ask_debt', role: 'system', content: "Thanks. What is your total monthly debt (car payments, credit cards, etc.)?", type: 'text' };
            break;

        case 'MORTGAGE_MONTHLY_DEBT':
            nextStep = 'VERIFY_ASSETS';
            nextMessage = { id: 'verify_assets', role: 'system', content: `${ack} To finalize your pre-approval, please connect your primary bank account securely.`, type: 'verify_assets' };
            break;

        // ... (Closing Steps) ...
        case 'BUSINESS_REVENUE':
        case 'VERIFY_ASSETS': // Replaces MORTGAGE_ASSETS
        case 'MORTGAGE_ASSETS':
            nextStep = 'MORTGAGE_DECLARATIONS';
            nextMessage = { id: 'ask_dec', role: 'system', content: "Just a few final compliance checks. Have you declared bankruptcy in the last 7 years?", type: 'options', options: ['Yes', 'No'] };
            break;

        case 'MORTGAGE_DECLARATIONS':
            nextStep = 'MORTGAGE_LAWSUITS';
            nextMessage = { id: 'ask_lawsuits', role: 'system', content: "Are you a party to a lawsuit?", type: 'options', options: ['Yes', 'No'] };
            break;

        case 'MORTGAGE_LAWSUITS':
            nextStep = 'ASK_EMAIL';
            nextMessage = { id: 'ask_email', role: 'system', content: "Understood. What's the best email address to send your application summary to?", type: 'text' };
            break;

        case 'ASK_EMAIL':
            nextStep = 'COMPLETE';
            nextMessage = { id: 'complete', role: 'system', content: "Perfect. Application submitted! Our underwriting team is reviewing your verified file right now. You'll hear from us shortly.", type: 'text' };
            break;

        default:
            // Safety Net: If we end up in an unknown state, don't loop forever.
            console.warn(`[Conversation Logic] Unknown step: ${currentStep}. Defaulting to COMPLETE.`);
            nextStep = 'COMPLETE';
            nextMessage = { id: 'fallback', role: 'system', content: "I've gathered all the necessary information for now. A specialist will reach out to you shortly to finalize the details.", type: 'text' };
            break;
    }

    return { nextStep, nextMessage };
}

/**
 * URLA 1003 Standard Interfaces
 */
export interface URLA1003Section1 {
    loanAmount: number;
    propertyAddress: string;
    propertyType: string;
    occupancy: string;
}

export interface URLA1003Section2 {
    borrower: {
        fullName: string;
        email: string;
        phone: string;
        dob: string;
        ssn: string;
        maritalStatus: string;
        citizenship: string;
    };
}

export interface URLA1003Section3 {
    currentAddress: string;
    yearsAtAddress: number;
    previousAddress: string;
}

export interface URLA1003Section4 {
    employment: {
        employerName: string;
        monthlyIncome: number;
    };
    monthlyDebt: number;
}

export interface URLA1003Section5 {
    liquidAssets: number;
}

export interface URLA1003Section6 {
    declarations: {
        bankruptcy: boolean;
        lawsuits: boolean;
    };
}

export interface URLA1003Data {
    section1: URLA1003Section1;
    section2: URLA1003Section2;
    section3: URLA1003Section3;
    section4: URLA1003Section4;
    section5: URLA1003Section5;
    section6: URLA1003Section6;
    meta: {
        exportedAt: string;
        version: string;
    };
}

/**
 * URLA1003Exporter handles the transformation and validation of application data
 * into the standard 1003 format.
 */
export class URLA1003Exporter {
    private data: ConversationState['data'];

    constructor(data: ConversationState['data']) {
        this.data = data || {};
    }

    private maskSSN(ssn?: string): string {
        if (!ssn) return 'N/A';
        const digits = ssn.replace(/[^0-9]/g, '');
        return digits.length >= 4 ? `***-**-${digits.slice(-4)}` : 'N/A';
    }

    private sanitizeString(val?: string): string {
        return val?.trim() || 'N/A';
    }

    private sanitizeNumber(val?: number): number {
        return typeof val === 'number' ? val : 0;
    }

    public export(): URLA1003Data {
        return {
            section1: {
                loanAmount: this.sanitizeNumber(this.data.purchasePrice),
                propertyAddress: this.sanitizeString(this.data.propertyAddress),
                propertyType: this.sanitizeString(this.data.propertyType),
                occupancy: this.sanitizeString(this.data.occupancy),
            },
            section2: {
                borrower: {
                    fullName: this.sanitizeString(this.data.fullName),
                    email: this.sanitizeString(this.data.email),
                    phone: this.sanitizeString(this.data.phone),
                    dob: this.sanitizeString(this.data.dob),
                    ssn: this.maskSSN(this.data.ssn),
                    maritalStatus: this.sanitizeString(this.data.maritalStatus),
                    citizenship: this.sanitizeString(this.data.citizenship),
                }
            },
            section3: {
                currentAddress: this.sanitizeString(this.data.currentAddress),
                yearsAtAddress: this.sanitizeNumber(this.data.yearsAtAddress),
                previousAddress: this.sanitizeString(this.data.previousAddress),
            },
            section4: {
                employment: {
                    employerName: this.sanitizeString(this.data.employerName),
                    monthlyIncome: this.sanitizeNumber(this.data.monthlyIncome),
                },
                monthlyDebt: this.sanitizeNumber(this.data.monthlyDebt),
            },
            section5: {
                liquidAssets: this.sanitizeNumber(this.data.liquidAssets),
            },
            section6: {
                declarations: {
                    bankruptcy: !!this.data.bankruptcy,
                    lawsuits: !!this.data.lawsuits,
                }
            },
            meta: {
                exportedAt: new Date().toISOString(),
                version: '1.1.0'
            }
        };
    }
}

/**
 * Formats application data into the 1003 standard.
 * @param data The conversation state data to format.
 * @returns A structured URLA1003Data object.
 */
export function format1003Data(data: ConversationState['data']): URLA1003Data {
    const exporter = new URLA1003Exporter(data);
    return exporter.export();
}

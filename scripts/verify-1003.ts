
import { format1003Data, INITIAL_STATE, getNextStep } from '../lib/apply/conversation-logic';

/**
 * Permanent Verification Script for 1003 Logic
 * This script verifies:
 * 1. Data capture for all 1003 fields.
 * 2. Formatting logic for 1003 export.
 * 3. Robustness against missing or malformed data.
 */

function verify1003() {
    console.log("🔍 Starting 1003 Logic Verification...");

    // 1. Test Data Capture
    console.log("\n--- Testing Data Capture ---");
    let state = INITIAL_STATE;
    const inputs = {
        'INIT': 'John Doe',
        'VERIFY_IDENTITY': 'Skip',
        'ASK_LOAN_TYPE': 'Mortgage Loan',
        'MORTGAGE_PRODUCT': 'Purchase',
        'MORTGAGE_LOAN_AMOUNT': '500000',
        'MORTGAGE_PROPERTY_ADDRESS': '123 Main St',
        'MORTGAGE_PROPERTY': 'Single Family',
        'MORTGAGE_OCCUPANCY': 'Primary',
        'MORTGAGE_EMPLOYMENT': 'Tech Corp',
        'MORTGAGE_INCOME': '10000',
        'MORTGAGE_DOB': '01/01/1980',
        'MORTGAGE_SSN': '1234',
        'MORTGAGE_MARITAL': 'Married',
        'MORTGAGE_CITIZENSHIP': 'US Citizen',
        'MORTGAGE_CURRENT_ADDRESS': '456 Oak Ave',
        'MORTGAGE_YEARS_AT_ADDRESS': '5',
        'MORTGAGE_MONTHLY_DEBT': '2000',
        'VERIFY_ASSETS': 'Skip',
        'MORTGAGE_DECLARATIONS': 'No',
        'MORTGAGE_LAWSUITS': 'No',
        'ASK_EMAIL': 'john@example.com'
    };

    for (const [step, input] of Object.entries(inputs)) {
        if (state.step !== step) {
            console.error(`❌ Unexpected step: expected ${step}, got ${state.step}`);
            process.exit(1);
        }
        state = { ...state, ...getNextStep(state, input) };
    }

    const captured = state.data;
    const required = ['propertyAddress', 'occupancy', 'lawsuits', 'ssn', 'dob'];
    for (const field of required) {
        if ((captured as any)[field] === undefined) {
            console.error(`❌ Missing captured field: ${field}`);
            process.exit(1);
        }
    }
    console.log("✅ Data capture verified.");

    // 2. Test Formatting
    console.log("\n--- Testing Formatting ---");
    const formatted = format1003Data(captured);

    // Type check (implicit via TypeScript, but let's verify structure)
    if (formatted.section1.propertyAddress !== '123 Main St') {
        console.error("❌ Formatting mismatch in Section 1");
        process.exit(1);
    }
    if (formatted.section2.borrower.ssn !== '***-**-1234') {
        console.error("❌ SSN masking failed");
        process.exit(1);
    }
    if (!formatted.meta.exportedAt || formatted.meta.version !== '1.1.0') {
        console.error("❌ Meta information missing or incorrect version");
        process.exit(1);
    }
    console.log("✅ Formatting verified.");

    // 3. Test Robustness
    console.log("\n--- Testing Robustness ---");
    const emptyFormatted = format1003Data({} as any);
    if (emptyFormatted.section1.propertyAddress !== 'N/A') {
        console.error("❌ Robustness check failed: expected N/A for missing address");
        process.exit(1);
    }
    if (emptyFormatted.section2.borrower.ssn !== 'N/A') {
        console.error("❌ Robustness check failed: expected N/A for missing SSN");
        process.exit(1);
    }
    console.log("✅ Robustness verified.");

    console.log("\n✨ 1003 Logic Verification Successful!");
}

verify1003();

import { model } from '@/lib/gemini';

type AgentName = 'Sherlock' | 'Saul' | 'Wolf';

const PERSONAS: Record<AgentName, string> = {
    Sherlock: `
        You are Sherlock, a Senior Underwriter. You are cynical, risk-averse, and obsessed with details.
        Your job is to protect the bank's capital. You look for fraud, inconsistencies, and risk.
        Output concise, blunt assessments. Start with "RISK ASSESSMENT:".
    `,
    Saul: `
        You are Saul, the Compliance Officer. You are pedantic and rule-bound.
        Your job is to ensure we follow Fair Lending, KYC, and AML laws.
        Output precise legal/compliance warnings. Start with "COMPLIANCE CHECK:".
    `,
    Wolf: `
        You are Wolf, a Wall Street Market Analyst. You are aggressive and data-driven.
        Your job is to analyze market trends and asset value.
        Output high-energy market insights. Start with "MARKET INTEL:".
    `
};

export async function consultBoardroom(agent: AgentName, query: string, context: any): Promise<string> {
    console.log(`[Boardroom] Consulting ${agent} on: "${query}"`);

    const systemPrompt = PERSONAS[agent];
    const fullPrompt = `
        ${systemPrompt}

        **Context:**
        ${JSON.stringify(context)}

        **Query:**
        ${query}

        Provide your expert opinion. Be brief.
    `;

    try {
        const result = await model.generateContent(fullPrompt);
        const response = result.response.text();
        return response;
    } catch (error) {
        console.error(`[Boardroom] Error consulting ${agent}:`, error);
        return `${agent} is currently unavailable. Proceed with caution.`;
    }
}

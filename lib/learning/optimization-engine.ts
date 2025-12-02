export interface InteractionEvent {
    stepId: string;
    action: 'view' | 'complete' | 'drop_off';
    timestamp: number;
}

// Mock database for analytics
const analyticsLog: InteractionEvent[] = [];

export function logInteraction(stepId: string, action: 'view' | 'complete' | 'drop_off') {
    analyticsLog.push({
        stepId,
        action,
        timestamp: Date.now(),
    });
    // In a real app, this would push to Supabase or Mixpanel
    console.log(`[Analytics] ${stepId}: ${action}`);
}

export function getDropOffRate(stepId: string): number {
    const views = analyticsLog.filter(e => e.stepId === stepId && e.action === 'view').length;
    const completions = analyticsLog.filter(e => e.stepId === stepId && e.action === 'complete').length;

    if (views === 0) return 0;
    return 1 - (completions / views);
}

export async function optimizePrompt(stepId: string, currentPrompt: string): Promise<string> {
    // Stub: In a real system, this would call an LLM to rewrite the prompt
    // based on drop-off data.
    const dropOff = getDropOffRate(stepId);

    if (dropOff > 0.5) {
        return `${currentPrompt} (Hint: Most people answer this quickly!)`; // Mock optimization
    }

    return currentPrompt;
}

import { supabase } from './supabaseClient';

const LOG_THROTTLE_MS = 100;
let lastLogTime = 0;

export async function logActivity(action: string, details: any = {}) {
    const now = Date.now();
    if (now - lastLogTime < LOG_THROTTLE_MS) {
        // Skip logging if too frequent to avoid rate limits
        return;
    }
    lastLogTime = now;

    try {
        // Attempt to log to 'user_activity' table
        // Using a fire-and-forget approach to not block UI
        const { error } = await supabase
            .from('user_activity')
            .insert([
                {
                    action,
                    details,
                    path: typeof window !== 'undefined' ? window.location.pathname : '',
                    timestamp: new Date().toISOString(),
                }
            ]);

        if (error) {
            if (error.message.includes("Supabase not configured")) {
                // Expected in dev/mock mode, suppress or log to console
                console.debug("[Logger] Supabase not configured, skipping log:", action);
            } else {
                console.warn("[Logger] Error logging activity:", error.message);
            }
        }
    } catch (err) {
        console.error("[Logger] Unexpected error:", err);
    }
}


import { supabase } from './supabaseClient';

export async function logActivity(action: string, details: any = {}) {
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

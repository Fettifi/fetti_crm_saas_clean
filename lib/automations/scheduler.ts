import { supabase } from '@/lib/supabaseClient';
import { STANDARD_SEQUENCE, BEHAVIORAL_TRIGGERS, EmailTemplate } from './templates';

export async function scheduleStandardSequence(leadId: string) {
    const queueItems = STANDARD_SEQUENCE.map(template => ({
        lead_id: leadId,
        template_id: template.id,
        subject: template.subject,
        body: template.body,
        scheduled_at: new Date(Date.now() + template.delayHours * 60 * 60 * 1000).toISOString(),
        status: 'pending',
    }));

    const { error } = await supabase
        .from('automation_queue')
        .insert(queueItems);

    if (error) {
        console.error('Failed to schedule sequence:', error);
    } else {
        console.log(`Scheduled ${queueItems.length} emails for lead ${leadId}`);
    }
}

export async function triggerBehavioralEmail(leadId: string, trigger: keyof typeof BEHAVIORAL_TRIGGERS) {
    const template = BEHAVIORAL_TRIGGERS[trigger];

    const { error } = await supabase
        .from('automation_queue')
        .insert([{
            lead_id: leadId,
            template_id: template.id,
            subject: template.subject,
            body: template.body,
            scheduled_at: new Date(Date.now() + template.delayHours * 60 * 60 * 1000).toISOString(),
            status: 'pending',
        }]);

    if (error) {
        console.error(`Failed to trigger ${trigger}:`, error);
    } else {
        console.log(`Triggered ${trigger} for lead ${leadId}`);
    }
}

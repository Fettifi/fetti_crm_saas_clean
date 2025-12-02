export type EmailTemplate = {
    id: string;
    subject: string;
    body: string;
    delayHours: number; // Delay from trigger event
};

export const STANDARD_SEQUENCE: EmailTemplate[] = [
    {
        id: 'seq_2h',
        subject: "Let's Get Your Deal Funded",
        body: "Send me the property address, purchase price, and what you're trying to accomplish. I'll take it from here. Whether it's DSCR, Fix & Flip, Hard Money, or a refi - we move fast.",
        delayHours: 2,
    },
    {
        id: 'seq_24h',
        subject: "Ready When You Are",
        body: "Whether it's DSCR, Fix & Flip, Hard Money, or a refi - I can structure funding fast. Reply with the numbers and I'll send options.",
        delayHours: 24,
    },
    {
        id: 'seq_day2',
        subject: "Your Funding Options Inside",
        body: "I can structure multiple loan paths for you. Send me the property address, purchase price, and your target timeline.",
        delayHours: 48,
    },
    {
        id: 'seq_day5',
        subject: "Don't Let This Deal Slip",
        body: "If this is DSCR, rates move. If this is a flip, capital is available today. Let's finalize your structure before the window closes.",
        delayHours: 120,
    },
    {
        id: 'seq_week2',
        subject: "Funding Window Open",
        body: "If you're still working your deal in CA, FL, MI, or OH, I can get you an approval path. Reply with the basics and I'll build options.",
        delayHours: 336,
    },
    {
        id: 'seq_week3',
        subject: "You Still Working Deals?",
        body: "Even if the last one didn't work, we can structure the next. Send me your buy box (price range, state, property type) and I'll align funding.",
        delayHours: 504,
    },
    {
        id: 'seq_week4',
        subject: "Still Need Funding?",
        body: "I help investors, flippers, and landlords get deals done. New projects, refis, cash-out, DSCR, and flip funding are all on the table.",
        delayHours: 672,
    },
    {
        id: 'seq_day35',
        subject: "Got Any New Properties?",
        body: "If you've moved on to a new deal, forward it here and I'll run numbers. We do money - simple as that.",
        delayHours: 840,
    },
    {
        id: 'seq_day50',
        subject: "Reconnect on Funding",
        body: "Let's reconnect. If you have any current or upcoming deals in CA, FL, MI, or OH, reply back and I'll get you structured.",
        delayHours: 1200,
    },
    {
        id: 'seq_day90',
        subject: "We're Still Here When You're Ready",
        body: "Deals come and go. When you're ready for the next one, reply to this email with the address and your goal. I'll take it from there.",
        delayHours: 2160,
    },
];

export const BEHAVIORAL_TRIGGERS = {
    FAST_TRACK: {
        id: 'fast_track',
        subject: "Priority Access: You're Pre-Qualified",
        body: "Your profile indicates you're a perfect fit for our expedited funding program. I've moved your application to the front of the line. When can we speak?",
        delayHours: 0, // Immediate
    },
    VERIFICATION_HELP: {
        id: 'verify_help',
        subject: "Trouble verifying your identity?",
        body: "I noticed you didn't complete the identity check. Is there something I can help with? Reply here and I can manually verify you.",
        delayHours: 1, // 1 hour after drop-off
    },
    REFERRAL_REWARD: {
        id: 'referral_invite',
        subject: "Unlock Your Premium Market Report",
        body: "Thanks for applying. Want our $500 Market Report for free? Use your unique link below to refer 3 friends: {{referral_link}}",
        delayHours: 0.5, // 30 mins after apply
    },
};

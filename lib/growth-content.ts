// Lead-gen Launchpad content + tracked links. Authored, copy-pasteable assets
// for every channel, plus the exact UTM links so traffic attributes back to the
// CRM as scored leads. Budget plan tuned for ~$1,000/mo ($500–$2k band).
import { BRAND } from "@/lib/brand";

const BASE = "https://app.fettifi.com";
export const link = (path: string, params: Record<string, string>) =>
  `${BASE}${path}?${new URLSearchParams(params).toString()}`;

// Channel attribution links — paste these everywhere so leads are tagged.
export const LINKS = {
  google: link("/start", { utm_source: "google", utm_medium: "cpc", utm_campaign: "search" }),
  meta: link("/start", { utm_source: "meta", utm_medium: "paid_social", utm_campaign: "prospecting" }),
  instagramBio: link("/links", { utm_source: "instagram", utm_medium: "bio" }),
  tiktokBio: link("/links", { utm_source: "tiktok", utm_medium: "bio" }),
  email: link("/quote", { utm_source: "email", utm_medium: "outreach" }),
  sms: link("/apply/form", { utm_source: "sms", utm_medium: "outreach" }),
  facebookGroups: link("/quote", { utm_source: "facebook", utm_medium: "group" }),
  linkedin: link("/start", { utm_source: "linkedin", utm_medium: "outreach" }),
};

export const BUDGET = {
  monthly: 1000,
  split: [
    { channel: "Google Search Ads", amount: 550, note: "High-intent buyers/investors actively searching. Best ROI to start." },
    { channel: "Meta (Instagram/Facebook) Ads", amount: 350, note: "Retarget site visitors + prospect homebuyers & real-estate investors." },
    { channel: "Tools / link-in-bio / boosting", amount: 100, note: "Boost your best organic posts; spread across IG/TikTok." },
  ],
  free: ["Referral-partner outreach", "Organic IG/TikTok content", "Past-client reactivation", "SEO pages (already live)"],
};

// ---- Google Ads ----
export const GOOGLE_ADS = {
  dailyBudget: "$18/day (~$550/mo)",
  campaigns: [
    {
      name: "Investor / DSCR (all 50 states)",
      keywords: ["dscr loan", "dscr loan {state}", "rental property loan", "no income verification mortgage", "airbnb loan", "fix and flip loan", "hard money lender near me"],
      negatives: ["jobs", "calculator", "free", "rates today", "definition"],
      headlines: ["DSCR Loans — Qualify on Rent", "No Tax Returns. Rental Income Only", "Fund Your Next Rental Fast", "Investor Loans in All 50 States", "Fetti Financial Services LLC — DSCR Experts"],
      descriptions: ["DSCR, fix & flip, and bridge loans — close in days, not months. Get your custom quote.", "Qualify on the property's cash flow, not pay stubs. Start your free quote now."],
    },
    {
      name: "Home buyers (FL / MI / CA)",
      keywords: ["mortgage broker near me", "fha loan {city}", "first time home buyer loan", "va loan {city}", "down payment assistance {state}", "pre approval mortgage"],
      negatives: ["jobs", "amortization", "usda map", "calculator"],
      headlines: ["Get Pre-Approved Fast", "FHA, VA & First-Time Buyer Loans", "Down Payment Assistance Available", "Licensed in FL, MI & CA", "Fetti Financial Services"],
      descriptions: ["Buy with as little as 0–3.5% down. See what you qualify for in 2 minutes — no credit pull.", "Local, licensed, fast. Apply online and a specialist follows up the same day."],
    },
  ],
  setup: ["Goal: Leads. Conversion = form submit on /apply/form & /quote.", "Use the Google link below as Final URL so leads attribute.", "Start broad-ish, add negatives weekly. Bid: Maximize Conversions.", "Add sitelinks: Get a Quote, Investor Loans, First-Time Buyers, Apply."],
};

// ---- Meta (IG/FB) Ads ----
export const META_ADS = {
  dailyBudget: "$12/day (~$350/mo)",
  audiences: [
    "Retargeting: everyone who visited app.fettifi.com (install the Meta Pixel).",
    "Real estate investors: interests = Real estate investing, BiggerPockets, Airbnb hosting, DSCR.",
    "Homebuyers FL/MI/CA: age 28–55, interests = First-time home buyer, Zillow, Realtor.com.",
    "Lookalike 1% of your lead list once you have 100+ leads.",
  ],
  angles: [
    { hook: "Tired of banks saying no to your rental?", primary: "DSCR loans qualify on the property's rent — not your tax returns. Investors are closing in days with Fetti. Get your quote 👇", headline: "DSCR Loans — No Tax Returns" },
    { hook: "Think you can't buy a home yet? Let's check.", primary: "FHA from 3.5% down, VA $0 down, plus down payment assistance. See what you qualify for in 2 minutes — no credit pull. 🏡", headline: "Get Pre-Approved Today" },
    { hook: "Your equity could be working for you.", primary: "Cash-out, HELOC, or fund your next flip. One quick form and a real specialist reaches out the same day.", headline: "Unlock Your Equity" },
  ],
};

// ---- Organic social (IG / TikTok) ----
export const SOCIAL = {
  cadence: "Post 1 Reel/TikTok + 1 story daily. Reuse the same video on both. Put your link-in-bio everywhere.",
  pillars: ["Myth-busting (no-tax-return loans, 0-down)", "Client wins / closings", "Quick tips for buyers & investors", "Behind-the-scenes / your story", "Market & rate context (no promises)"],
  posts: [
    { hook: "POV: the bank said no but the rental still got funded 🏦❌", script: "Show a property → text overlay 'DSCR = qualify on RENT, not your W-2'. End: 'Comment RENT and I'll send the steps.'", caption: "DSCR loans qualify on the property's cash flow — no tax returns. Investors, this is your unlock. Link in bio. #realestateinvesting #dscr #rentalproperty", hashtags: "#realestateinvesting #dscr #rentalproperty #airbnbinvesting #mortgagebroker" },
    { hook: "3 ways to buy a home with almost nothing down 👇", script: "Fast cuts: 1) FHA 3.5% 2) VA $0 3) Down payment assistance. 'Which one is you? Comment below.'", caption: "You might be closer to owning than you think. FHA, VA, and assistance programs. Link in bio to check — no credit pull. #firsttimehomebuyer #fha #downpaymentassistance", hashtags: "#firsttimehomebuyer #fha #valoan #downpaymentassistance #homebuyingtips" },
    { hook: "Stop letting your equity sit there 💸", script: "Talk to camera: 'If you've owned 2+ years you might be sitting on $50k+ you can use.' Show uses: flip, debt, reno.", caption: "Cash-out, HELOC, or fund your next deal. DM me EQUITY. #homeequity #heloc #realestate", hashtags: "#homeequity #heloc #cashoutrefi #realestateinvesting" },
    { hook: "Self-employed and got denied? Watch this.", script: "'Banks want 2 years of tax returns. We don't.' Explain bank-statement loans in 15s.", caption: "Bank-statement & P&L loans for business owners. No tax returns. Link in bio. #selfemployed #businessowner #mortgage", hashtags: "#selfemployed #businessowner #mortgagetips #bankstatementloan" },
    { hook: "How much home can YOU actually afford? (free, 2 min)", script: "Screen-record the /quote tool giving an instant estimate.", caption: "Instant estimate, no credit pull. Link in bio 🔗 #homebuying #preapproval #mortgagebroker", hashtags: "#homebuying #preapproval #mortgagebroker #firsttimebuyer" },
  ],
  generatePrompt: "Generate fresh IG/TikTok Reel scripts for a mortgage broker.",
};

// ---- Referral partner outreach ----
export const REFERRAL = {
  who: ["Real estate agents (buyer's agents especially)", "Wholesalers & flippers", "Property managers", "CPAs & financial advisors", "Insurance agents", "Investor meetup / REIA organizers"],
  where: ["Search 'realtors near me' / your farm area", "Local Facebook real estate groups", "Zillow agent directory", "Local REIA / BiggerPockets meetups", "Instagram: agents posting listings in your states"],
  email: {
    subject: "Quick partnership idea — fast loans for your buyers",
    body: `Hi {first} — I'm with ${BRAND.company} (NMLS #${BRAND.nmls}). I help your buyers close fast — FHA/VA/first-time, plus DSCR & fix-and-flip for the investors.\n\nI'd love to be your go-to lender. I send updates on every file, respond in minutes, and your clients get a smooth close. Want to send me your next pre-qual and see how I work?\n\nHere's a link you can give clients to get started: {link}\n\n— {you}, ${BRAND.company}`,
  },
  sms: `Hi {first}, it's {you} with Fetti Financial Services LLC. I close your buyers fast (FHA/VA + investor loans) and keep you updated on every file. Send me your next deal? Clients can start here: {link}`,
  dm: `Hey {first}! Love your listings in {area}. I'm a mortgage broker with Fetti Financial Services LLC — fast pre-approvals + investor loans. Open to teaming up so your buyers close smoothly? I send a tracked link your clients can use anytime.`,
};

// ---- Direct / reactivation outreach ----
export const OUTREACH = {
  pastClients: `Hi {first}! Rates and programs change constantly — want me to run a free 2-min review to see if you can save or pull cash from your equity? No pull, no obligation. Start here: {link}`,
  fbGroup: `(Value post, not spammy) "PSA for {city} investors: you don't need tax returns to finance a rental — DSCR loans qualify on the rent. Happy to explain how it works, just comment or DM." Link in bio/comments.`,
  linkedin: `Hi {first}, connecting with local {city} real estate pros. I'm a mortgage broker focused on fast closes + investor financing. If you ever have a buyer who needs a reliable lender, I'd love to be a resource. Here's my client link: {link}`,
};

// ---- SEO content to publish (titles → already have /lending pages) ----
export const SEO_TITLES = [
  "DSCR Loans Explained: Qualify on Rent, Not Your W-2",
  "First-Time Home Buyer Programs in Florida (FHA, Down Payment Assistance)",
  "Fix & Flip Financing 101: How Much Can You Borrow?",
  "Bank-Statement Loans for the Self-Employed",
  "How to Buy a Rental With No Tax Returns",
];

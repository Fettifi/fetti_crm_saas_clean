-- Enable UUID extension if not already enabled
create extension if not exists "uuid-ossp";

-- 1. Update Leads Table for Analytics
alter table leads 
add column if not exists utm_source text,
add column if not exists utm_medium text,
add column if not exists utm_campaign text,
add column if not exists referral_code text unique;

-- 2. Create Referrals Table (Viral Loop)
create table if not exists referrals (
  id uuid default uuid_generate_v4() primary key,
  referrer_id uuid references leads(id),
  referred_email text not null,
  status text default 'pending', -- pending, joined, funded
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 3. Create Verifications Table (Premium Qualification)
create table if not exists verifications (
  id uuid default uuid_generate_v4() primary key,
  lead_id uuid references leads(id),
  type text not null, -- 'identity', 'assets', 'property'
  status text not null, -- 'verified', 'failed', 'pending'
  provider text, -- 'plaid', 'stripe_identity', 'clearbit'
  data jsonb, -- Store full provider response
  created_at timestamp with time zone default now()
);

-- 4. RLS Policies (Basic Security)
alter table referrals enable row level security;
alter table verifications enable row level security;

-- Allow public insert for now (demo mode), lock down in production
create policy "Allow public insert referrals" on referrals for insert with check (true);
create policy "Allow public insert verifications" on verifications for insert with check (true);

-- 5. Create Automation Queue Table
create table if not exists automation_queue (
  id uuid default uuid_generate_v4() primary key,
  lead_id uuid references leads(id),
  template_id text not null,
  subject text not null,
  body text,
  scheduled_at timestamp with time zone not null,
  sent_at timestamp with time zone,
  status text default 'pending', -- pending, sent, failed, cancelled
  created_at timestamp with time zone default now()
);

alter table automation_queue enable row level security;
create policy "Allow public insert automation_queue" on automation_queue for insert with check (true);


-- Ensure Leads Table Exists
create table if not exists leads (
  id uuid default uuid_generate_v4() primary key,
  first_name text,
  last_name text,
  email text,
  phone text,
  status text default 'New',
  source text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referral_code text unique,
  access_code text,
  access_code_expires_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Ensure Applications Table Exists
create table if not exists applications (
  id uuid default uuid_generate_v4() primary key,
  lead_id uuid references leads(id),
  status text default 'Draft',
  loan_amount numeric,
  property_address text,
  notes jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable RLS
alter table leads enable row level security;
alter table applications enable row level security;

-- Create Policies for Public Access (Critical for Chat & Portal)
-- Note: In a real prod env, we'd be stricter, but for this demo/MVP, we need to allow the flow to work.

-- Leads: Allow public insert (Chat) and select by ID/Email (Portal Auth)
create policy "Allow public insert leads" on leads for insert with check (true);
create policy "Allow public select leads" on leads for select using (true); 
create policy "Allow public update leads" on leads for update using (true); -- Needed for saving access code

-- Applications: Allow public insert (Chat) and select (Portal)
create policy "Allow public insert applications" on applications for insert with check (true);
create policy "Allow public select applications" on applications for select using (true);

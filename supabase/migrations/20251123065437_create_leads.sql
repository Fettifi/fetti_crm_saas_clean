create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  first_name text,
  last_name text,
  email text,
  phone text,
  state text,
  occupancy text,
  loan_purpose text,
  credit_band text,
  property_value numeric,
  liquid_assets numeric,
  notes text,
  score integer,
  stage text not null default 'New'
);

alter table public.leads enable row level security;

create policy "Leads are readable by authenticated users"
on public.leads for select
to authenticated
using ( true );

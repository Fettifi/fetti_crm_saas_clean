create table if not exists rupee_memory (
  id uuid default gen_random_uuid() primary key,
  topic text not null,
  insight text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table rupee_memory enable row level security;

-- Allow public read/write (for demo purposes, or restrict to authenticated users)
create policy "Allow public access" on rupee_memory for all using (true) with check (true);

-- Create Conversations Table
create table if not exists conversations (
  id uuid default uuid_generate_v4() primary key,
  title text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Create Messages Table
create table if not exists messages (
  id uuid default uuid_generate_v4() primary key,
  conversation_id uuid references conversations(id) on delete cascade,
  role text not null, -- 'user' or 'system'
  content text not null,
  created_at timestamp with time zone default now()
);

-- Enable RLS
alter table conversations enable row level security;
alter table messages enable row level security;

-- Create Policies (Public for demo simplicity, can be tightened later)
create policy "Public conversations select" on conversations for select using (true);
create policy "Public conversations insert" on conversations for insert with check (true);
create policy "Public conversations update" on conversations for update using (true);

create policy "Public messages select" on messages for select using (true);
create policy "Public messages insert" on messages for insert with check (true);

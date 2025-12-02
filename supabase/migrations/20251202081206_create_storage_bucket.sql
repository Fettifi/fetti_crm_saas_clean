insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict (id) do nothing;

drop policy if exists "Public Uploads" on storage.objects;
create policy "Public Uploads"
on storage.objects for insert
with check ( bucket_id = 'documents' );

drop policy if exists "Public Downloads" on storage.objects;
create policy "Public Downloads"
on storage.objects for select
using ( bucket_id = 'documents' );

-- CLOSE THE PUBLIC-BUCKET LANDMINE LEFT BY 20251202081206_create_storage_bucket.sql.
--
-- That migration, still in version control and still replayable against any fresh environment:
--
--     insert into storage.buckets (id, name, public) values ('documents','documents', true)
--     create policy "Public Uploads"   on storage.objects for insert with check ( bucket_id = 'documents' )
--     create policy "Public Downloads" on storage.objects for select using  ( bucket_id = 'documents' )
--
-- A PUBLIC bucket plus a blanket anon insert AND select on every object in it. On a mortgage CRM
-- the objects are borrower pay stubs, bank statements, tax returns and IDs.
--
-- MEASURED ON PRODUCTION 2026-10-16 BEFORE WRITING THIS, because a migration file is not the
-- live state and reporting either one as the other is its own mistake:
--     buckets: loan-docs public=false, documents public=false, content public=true, event-photos public=false
--     anonymous list on loan-docs and documents -> []  (RLS filtering, not an error)
--     a REAL borrower document: service-role GET 200, anon GET 400, public-URL GET 400
-- So production is NOT exposed — someone flipped the bucket private after that migration ran, and
-- the live policies do not grant anon read. The defect is that the REPO still describes the unsafe
-- shape, so a fresh deploy, a branch database, or a `supabase db reset` recreates it silently.
--
-- The 2025-12-02 migration is left untouched: it has already been applied, and editing an applied
-- migration breaks checksums for every environment that ran it. This corrects forward instead.
--
-- NOTE the real bucket for loan documents is 'loan-docs' (lib/scanFile.ts, combine-docs,
-- file/[token]/upload all use it). 'documents' is the legacy name from that first migration.
-- Both are locked here so neither can drift public.

-- 1. Neither document bucket may be public. `public = true` makes every object readable by URL
--    with no token at all, which no storage policy can claw back.
update storage.buckets set public = false where id in ('documents', 'loan-docs');

-- 2. Drop the blanket anon grants. Named exactly as the 2025-12-02 migration created them.
drop policy if exists "Public Uploads"   on storage.objects;
drop policy if exists "Public Downloads" on storage.objects;

-- 3. No replacement anon policy is created, deliberately. Every legitimate reader and writer of
--    these buckets goes through the service role in a server route that has already authenticated
--    the caller — the borrower portal's token routes (app/api/file/[token]/*), the LO's LOS routes,
--    and the scan agent. None of them needs an anon policy, and granting one "just in case" is how
--    the original hole was opened.

-- 4. Belt and braces for the next person: if a bucket is ever flipped public by hand in the
--    dashboard, this comment is where to look.
comment on table storage.buckets is
  'loan-docs and documents MUST stay public=false — they hold borrower pay stubs, bank statements, tax returns and IDs. See 20261016030000_storage_bucket_lockdown.sql.';

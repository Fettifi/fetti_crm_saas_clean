-- PROPERTY RADAR — in-house PropertyShark/PropertyRadar replacement.
-- Spine: radar_parcels keyed (county_fips, apn); events feed distress flags;
-- radar_lists holds saved list-builder filters (monitors diff against them);
-- radar_contacts holds skip-trace results.
--
-- Security model matches 20260713153000_portal_rls_lockdown.sql: RLS ENABLED with
-- NO policies -> anon key has zero access; all reads/writes go through server
-- routes using the service-role key. Do NOT add anon policies.
--
-- TCPA: radar_contacts.manual_dial_only defaults TRUE and nothing may flip it in
-- bulk — skip-traced numbers carry no consent and must never enter auto-SMS paths.

create table if not exists radar_parcels (
  id bigint generated always as identity primary key,
  state text not null,                          -- 'FL' | 'CA' | 'MI' ...
  county_fips text not null,                    -- 5-digit FIPS, e.g. 12086
  county_name text,
  apn text not null,                            -- normalized: uppercase, alphanumeric only
  situs_addr text,
  situs_city text,
  situs_zip text,
  use_code text,                                -- raw county/DOR use code
  use_class text,                               -- sfr|condo|multi_2_4|multi_5plus|commercial|land|mobile|other
  year_built int,
  living_area int,
  land_sqft bigint,
  units int,
  just_value bigint,                            -- county market/just value (dollars)
  assessed_value bigint,
  last_sale_price bigint,
  last_sale_date date,
  prior_sale_price bigint,
  prior_sale_date date,
  owner_name text,
  owner_name_2 text,
  owner_mail_addr text,
  owner_mail_city text,
  owner_mail_state text,
  owner_mail_zip text,
  homestead boolean,                            -- owner-occupied exemption claimed (null = unknown)
  absentee boolean default false,               -- mailing address != situs
  lat double precision,
  lng double precision,
  has_nod boolean default false,
  has_tax_default boolean default false,
  has_trustee_sale boolean default false,
  distress_score int default 0,
  last_distress_at date,
  source text,                                  -- 'fl_nal' | 'ca_gis' | 'event_seed' ...
  roll_year int,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (county_fips, apn)
);

create index if not exists radar_parcels_state_idx on radar_parcels (state);
create index if not exists radar_parcels_county_idx on radar_parcels (county_fips);
create index if not exists radar_parcels_zip_idx on radar_parcels (situs_zip);
create index if not exists radar_parcels_use_class_idx on radar_parcels (use_class);
create index if not exists radar_parcels_absentee_idx on radar_parcels (absentee) where absentee;
create index if not exists radar_parcels_sale_date_idx on radar_parcels (last_sale_date);
create index if not exists radar_parcels_distress_idx on radar_parcels (distress_score) where distress_score > 0;
create index if not exists radar_parcels_owner_idx on radar_parcels (owner_name);

create table if not exists radar_events (
  id bigint generated always as identity primary key,
  state text not null,
  county_fips text,
  county_name text,
  apn text,                                     -- null until matched to a parcel
  situs_addr text,
  situs_city text,
  situs_zip text,
  event_type text not null,                     -- deed|nod|nts|trustee_sale|tax_default|listing
  event_date date,
  amount bigint,                                -- sale price / default amount / opening bid
  owner_name text,
  parties jsonb,
  detail jsonb,
  source text not null,                         -- 'cnpa'|'county_taxlist'|'fl_sdf'|'recorder'...
  source_ref text not null,                     -- provider-side id: idempotency BEFORE side effects
  created_at timestamptz default now(),
  unique (source, source_ref)
);

create index if not exists radar_events_type_date_idx on radar_events (event_type, event_date desc);
create index if not exists radar_events_parcel_idx on radar_events (county_fips, apn);
create index if not exists radar_events_zip_idx on radar_events (situs_zip);

create table if not exists radar_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  monitor boolean default false,                -- Phase 3: nightly diff + alert
  last_run_at timestamptz,
  last_count int,
  created_at timestamptz default now()
);

create table if not exists radar_contacts (
  id bigint generated always as identity primary key,
  county_fips text,
  apn text,
  owner_name text,
  phones jsonb,
  emails jsonb,
  mailing jsonb,
  source text,                                  -- 'skiptrace:<vendor>'|'title_farm'|'notice'
  traced_at timestamptz,
  dnc_checked boolean default false,
  dnc boolean,
  manual_dial_only boolean not null default true,  -- TCPA hard line: no consent = no auto-text, ever
  created_at timestamptz default now(),
  unique (county_fips, apn, owner_name)
);

alter table radar_parcels enable row level security;
alter table radar_events enable row level security;
alter table radar_lists enable row level security;
alter table radar_contacts enable row level security;
-- No policies on purpose: anon denied by default; service-role bypasses RLS.

-- 0015_dim_geo_alias.sql
-- Province-name alias table: Shipnity exports provinces as English non-ISO
-- spellings ("Nakorn Ratchasima", "Chonburi", ...). Map raw spelling -> ISO
-- province_code so the transform (0016) can resolve them instead of TH-XX.
-- Auto-seeds canonical ISO en+th names, then 10 Shipnity-specific spellings
-- observed in the Aug file. Applied via MCP 2026-08-10; backfilled 2026-08-11.

create table analytics.dim_geo_alias (
  id uuid primary key default gen_random_uuid(),
  alias_raw text not null unique,
  province_code text not null references analytics.dim_geo (province_code),
  created_at timestamptz not null default now()
);
create index idx_dim_geo_alias_province on analytics.dim_geo_alias (province_code);

alter table analytics.dim_geo_alias enable row level security;
create policy read_all on analytics.dim_geo_alias
  for select using (auth.role() = 'authenticated' or auth.role() = 'service_role');

-- auto aliases from canonical ISO en + th names (robust for other files)
insert into analytics.dim_geo_alias (alias_raw, province_code)
select province_name_en, province_code from analytics.dim_geo where province_name_en is not null
union
select province_name_th, province_code from analytics.dim_geo where province_name_th is not null
on conflict (alias_raw) do nothing;

-- Shipnity-specific spellings observed in the Aug file (30 distinct)
insert into analytics.dim_geo_alias (alias_raw, province_code) values
('Nakorn Ratchasima','TH-30'),
('Chonburi','TH-20'),
('Pathum thani','TH-13'),
('Chainart','TH-18'),
('Chantaburi','TH-22'),
('Lopburi','TH-16'),
('Ayutthaya','TH-14'),
('Phisanulok','TH-65'),
('Nakorn Srithammarat','TH-80'),
('Chachongsao','TH-24')
on conflict (alias_raw) do update set province_code = excluded.province_code;

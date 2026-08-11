-- 0017_normalize_phone_search_path.sql
-- Pin search_path on analytics.normalize_th_phone (was role-mutable → flagged by
-- Supabase security advisor 0011). Pure helper (no table access), but pinned for
-- hygiene. Applied via MCP 2026-08-10; backfilled to repo 2026-08-11.

create or replace function analytics.normalize_th_phone(p_phone_raw text)
returns text
language plpgsql
immutable
set search_path = pg_temp
as $$
declare
  v_digits text;
begin
  if p_phone_raw is null or trim(p_phone_raw) = '' then return null; end if;
  if p_phone_raw ~ '[*xX]{2,}' then return null; end if;
  v_digits := regexp_replace(p_phone_raw, '[^0-9]', '', 'g');
  if v_digits = '' or length(v_digits) < 9 then return null; end if;
  if left(v_digits, 2) = '66' and length(v_digits) = 11 then
    return '+' || v_digits;
  elsif left(v_digits, 1) = '0' and length(v_digits) = 10 then
    return '+66' || substring(v_digits from 2);
  elsif length(v_digits) = 9 then
    return '+66' || v_digits;
  else
    return null;
  end if;
end;
$$;

revoke execute on function analytics.normalize_th_phone(text) from public, anon, authenticated;
grant execute on function analytics.normalize_th_phone(text) to service_role;

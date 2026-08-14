-- 0032_bulk_action_codes.sql
-- Owner change (2026-08-13): CSV `action` column uses short codes — A = add+edit
-- (upsert), D = delete. Blank still = upsert (delete must be explicit). Accept
-- the long words too (add/edit/delete) so older files keep working.
-- Forward-only fix to product_upsert_bulk from 0031 (history not rewritten).

create or replace function analytics.product_upsert_bulk(
  p_shop_id uuid,
  p_rows jsonb
)
 returns table(row_index int, sku text, status text, error text)
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  r jsonb;
  i int := 0;
  v_sku text;
  v_action text;
  v_active boolean;
begin
  if p_shop_id is null then
    raise exception 'product_upsert_bulk: p_shop_id is required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'product_upsert_bulk: p_rows must be a json array';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  for r in select * from jsonb_array_elements(p_rows)
  loop
    i := i + 1;
    v_sku := btrim(coalesce(r ->> 'sku', ''));
    v_action := lower(btrim(coalesce(r ->> 'action', '')));
    begin
      -- delete ONLY on explicit 'd'/'delete'; everything else (a/add/edit/blank) = upsert
      if v_action in ('d', 'delete') then
        perform analytics.product_delete(p_shop_id, v_sku);
        row_index := i; sku := v_sku; status := 'deleted'; error := null;
      else
        v_active := case lower(coalesce(nullif(btrim(r ->> 'is_active'), ''), 'true'))
                      when 'false' then false when '0' then false when 'no' then false else true end;
        perform analytics.product_upsert(
          p_shop_id,
          v_sku,
          r ->> 'name',
          nullif(btrim(coalesce(r ->> 'category', '')), ''),
          coalesce(nullif(btrim(r ->> 'cost_type'), ''), 'fixed'),
          nullif(btrim(coalesce(r ->> 'unit_cost', '')), '')::numeric,
          nullif(btrim(coalesce(r ->> 'silver_weight_g', '')), '')::numeric,
          nullif(btrim(coalesce(r ->> 'silver_purity', '')), '')::numeric,
          nullif(btrim(coalesce(r ->> 'labor_cost', '')), '')::numeric,
          nullif(btrim(coalesce(r ->> 'list_price', '')), '')::numeric,
          nullif(btrim(coalesce(r ->> 'barcode', '')), ''),
          nullif(btrim(coalesce(r ->> 'supplier', '')), ''),
          nullif(btrim(coalesce(r ->> 'note', '')), ''),
          v_active
        );
        row_index := i; sku := v_sku; status := 'ok'; error := null;
      end if;
      return next;
    exception when others then
      row_index := i; sku := v_sku; status := 'error'; error := sqlerrm;
      return next;
    end;
  end loop;
end;
$$;
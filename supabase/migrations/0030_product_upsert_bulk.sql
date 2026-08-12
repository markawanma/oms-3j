-- 0030_product_upsert_bulk.sql
-- Phase C1e — bulk SKU import. Batch wrapper over analytics.product_upsert so a
-- CSV upload of many rows is one round-trip instead of N. Per-row subtransaction
-- (BEGIN/EXCEPTION): a bad row is skipped and reported, good rows still commit —
-- partial success, no all-or-nothing abort. Reuses product_upsert so ALL
-- validation/gate/write logic stays in one place (no duplicated rules here).

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
  v_active boolean;
begin
  if p_shop_id is null then
    raise exception 'product_upsert_bulk: p_shop_id is required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'product_upsert_bulk: p_rows must be a json array';
  end if;

  -- gate once up front (product_upsert re-checks per row too — cheap, service_role short-circuits)
  perform analytics.crm_require_owner_admin(p_shop_id);

  for r in select * from jsonb_array_elements(p_rows)
  loop
    i := i + 1;
    v_sku := btrim(coalesce(r ->> 'sku', ''));
    begin
      v_active := case lower(coalesce(nullif(btrim(r ->> 'is_active'), ''), 'true'))
                    when 'false' then false
                    when '0' then false
                    when 'no' then false
                    else true
                  end;

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
      return next;
    exception when others then
      row_index := i; sku := v_sku; status := 'error'; error := sqlerrm;
      return next;
    end;
  end loop;
end;
$$;

revoke execute on function analytics.product_upsert_bulk(uuid, jsonb) from public, anon, authenticated;
grant execute on function analytics.product_upsert_bulk(uuid, jsonb) to authenticated, service_role;

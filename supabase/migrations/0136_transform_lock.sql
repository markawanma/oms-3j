-- 0136_transform_lock.sql
-- เติม advisory lock ให้ analytics.transform_pending_order_lines — แยกออกจาก 0135
-- เพราะ dry-run ของ 0135 ไม่ได้ครอบส่วนนี้ (Tech Lead 18 ก.ย. 69 — ห้ามลงของที่ยังไม่ได้ซ้อม)
--
-- ปัญหา: 0133 เขียนคอมเมนต์ว่า advisory lock กัน stock_sync_sales ไม่ให้ชนกับ
-- import/ลบ/กู้คืน — ไม่จริงทั้งหมด: transform_pending_order_lines คือตัวที่เขียน
-- fact_order_item.qty จริง (ต้นทางของ target ใน stock_sync_sales) แต่ไม่เคยถือ lock นี้
-- เลยตั้งแต่ 0041
--
-- body ที่เหลือคัดลอกจากนิยามที่รันอยู่จริงบน prod — ยืนยันด้วย md5 ของ body
-- ที่ตัดคอมเมนต์/ช่องว่างออกแล้วว่าตรงกันเป๊ะ ต่างแค่ lock ที่เพิ่ม (b9aaa5f7d81c...)
-- ⚠️ ห้าม apply ก่อน dry-run — ฟังก์ชันนี้เจ้าของใช้จริงทุกครั้งที่นำเข้าไฟล์

-- ============================================================================
-- 3. analytics.transform_pending_order_lines — เพิ่ม advisory lock เท่านั้น
--    (ไม่เคยมีมาตั้งแต่ 0041 แม้ 0133's header comment จะอ้างว่า "ไม่มีทางวิ่ง
--    ซ้อนกับ import/ลบ/กู้คืน" ก็ตาม — ไม่จริง เพราะฟังก์ชันนี้ไม่ได้ถือ lock นี้)
--    body ที่เหลือคัดลอกเป๊ะจากนิยามล่าสุดใน repo (0115 §3, tombstone-aware —
--    ยืนยันแล้วว่าไม่มี migration ไหนแก้ทับอีกหลังจากนั้น) ไม่ได้ลอกจาก 0109
-- ============================================================================

create or replace function analytics.transform_pending_order_lines(p_shop_id uuid, p_batch_id uuid)
 returns table(transformed_count integer, orphan_count integer, skipped_blank_count integer, unknown_sku_count integer, errored_count integer)
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_row analytics.stg_order_line_import%rowtype;
  v_item analytics.stg_order_line_import%rowtype;
  v_fo record;
  v_product_id uuid;
  v_unit_cost numeric(12, 2);
  v_category text;
  v_sku_norm text;
  v_stripped_len int;
  v_stripped text;
  v_match_count int;
  v_match_note text;
  v_tier3_conclusive boolean;
  v_weak_order boolean;
  v_new_item_id uuid;
  v_cogs numeric(12, 2);
  v_transformed int := 0;
  v_orphan int := 0;
  v_skipped_blank int := 0;
  v_unknown int := 0;
  v_errored int := 0;
begin
  if p_shop_id is null or p_batch_id is null then
    raise exception 'transform_pending_order_lines: p_shop_id and p_batch_id are required';
  end if;

  -- 0135: same advisory-lock key as stock_sync_sales (0133) / import_delete_
  -- orders + import_restore_orders (0115) — this function WRITES fact_order_
  -- item.qty (the actual source of truth stock_sync_sales's target subquery
  -- sums from), but had never taken this lock despite 0133's header comment
  -- claiming it did. Locking here queues line-item import against concurrent
  -- stock_sync_sales/import_delete_orders/import_restore_orders calls for the
  -- same shop instead of letting them interleave (fact_order_item rows
  -- disappearing/reappearing mid-reconcile). pg_advisory_xact_lock: the same
  -- session re-acquiring the same key is a cheap no-op (not a deadlock); two
  -- different sessions just queue, they don't lock each other out permanently.
  perform pg_advisory_xact_lock(hashtext('analytics.fact_order:' || p_shop_id::text));

  for v_row in
    select * from analytics.stg_order_line_import
    where shop_id = p_shop_id and batch_id = p_batch_id and import_status in ('pending', 'orphan', 'error')
    order by source_order_no, line_no
  loop
    begin
      if v_row.sku_raw is null then
        update analytics.stg_order_line_import set import_status = 'skipped_blank', error_detail = null where id = v_row.id;
        v_skipped_blank := v_skipped_blank + 1;
        continue;
      end if;
      if v_row.source_order_no is null then
        update analytics.stg_order_line_import set import_status = 'error', error_detail = 'source_order_no is null on a non-blank SKU row' where id = v_row.id;
        v_errored := v_errored + 1;
        continue;
      end if;
      perform 1 from analytics.fact_order fo where fo.shop_id = p_shop_id and fo.source_order_no = v_row.source_order_no;
      if not found then
        -- QA gate 12 ก.ย. 69: an order with no LIVE fact_order might still
        -- be a deliberately-deleted one, not a genuine orphan (line arrived
        -- before its order report). Check the tombstone BEFORE falling
        -- through to 'orphan' — same precedence 0114 already uses on the
        -- order-header side. Does not increment v_orphan (this is not a
        -- data-quality gap to wait out; it's an expected, permanent state
        -- until/unless the order is restored) and does not overwrite
        -- fact_order_item_id (nothing to link — 'not found' means it was
        -- already null or is being re-set null on a fresh row).
        if exists (
          select 1 from analytics.fact_order_deleted fod
          where fod.shop_id = p_shop_id and fod.source_order_no = v_row.source_order_no and fod.restored_at is null
        ) then
          update analytics.stg_order_line_import set import_status = 'tombstoned', error_detail = 'order deleted (tombstone)' where id = v_row.id;
          continue;
        end if;
        update analytics.stg_order_line_import set import_status = 'orphan', error_detail = 'no fact_order for source_order_no: ' || v_row.source_order_no where id = v_row.id;
        v_orphan := v_orphan + 1;
        continue;
      end if;
      -- 0109: a matching fact_order exists. Promote this row back to
      -- 'pending' if it is currently stuck at 'orphan' or 'error' so phase 2
      -- below (and any subsequent call) can pick it up. Rows already
      -- 'pending' (the normal happy path -- freshly inserted, order already
      -- existed) are left alone by the `is distinct from` guard: no
      -- redundant UPDATE, no behavior change on the path that already
      -- worked.
      if v_row.import_status is distinct from 'pending' then
        update analytics.stg_order_line_import
           set import_status = 'pending', error_detail = null
         where id = v_row.id;
      end if;
    exception when others then
      update analytics.stg_order_line_import set import_status = 'error', error_detail = sqlerrm where id = v_row.id;
      v_errored := v_errored + 1;
    end;
  end loop;

  for v_fo in
    select distinct fo.id as fact_order_id, fo.source_order_no
    from analytics.stg_order_line_import s
    join analytics.fact_order fo on fo.shop_id = p_shop_id and fo.source_order_no = s.source_order_no
    where s.shop_id = p_shop_id and s.batch_id = p_batch_id and s.import_status = 'pending' and s.sku_raw is not null
  loop
    delete from analytics.fact_order_item where fact_order_id = v_fo.fact_order_id;
    v_cogs := 0;
    v_weak_order := false;
    for v_item in
      select * from analytics.stg_order_line_import s
      where s.shop_id = p_shop_id and s.source_order_no = v_fo.source_order_no and s.sku_raw is not null and s.import_status <> 'skipped_blank'
      order by s.line_no
    loop
      begin
        v_product_id := null; v_unit_cost := null; v_category := null; v_match_note := null; v_match_count := null;
        v_tier3_conclusive := false;

        select vp.product_id, vp.effective_unit_cost, vp.category
          into v_product_id, v_unit_cost, v_category
          from analytics.v_dim_product vp
          where vp.shop_id = p_shop_id and vp.is_active and vp.sku = v_item.sku_raw;

        if v_product_id is null then
          v_sku_norm := regexp_replace(v_item.sku_raw, '^[^A-Za-z0-9]+', '');
          v_stripped_len := length(v_item.sku_raw) - length(v_sku_norm);
          v_stripped := left(v_item.sku_raw, v_stripped_len);

          if v_sku_norm <> '' and v_stripped_len <= 2 and v_sku_norm ~ '[A-Za-z]'
             and (v_stripped_len = 0 or v_stripped !~ '[[:alpha:]]') then
            select sub.product_id, sub.effective_unit_cost, sub.category, sub.cnt
              into v_product_id, v_unit_cost, v_category, v_match_count
              from (
                select vp.product_id, vp.effective_unit_cost, vp.category,
                       count(*) over () as cnt
                  from analytics.v_dim_product vp
                  where vp.shop_id = p_shop_id and vp.is_active
                    and regexp_replace(vp.sku, '^[^A-Za-z0-9]+', '') = v_sku_norm
                  limit 1
              ) sub;

            if v_match_count = 1 then
              v_match_note := 'จับคู่ด้วยรหัสที่ตัดอักขระนำหน้า: ' || v_item.sku_raw || ' -> ' || v_sku_norm;
            else
              if coalesce(v_match_count, 0) = 0 then
                v_tier3_conclusive := true;
              end if;
              v_product_id := null; v_unit_cost := null; v_category := null;
            end if;
          end if;
        end if;

        if v_product_id is null then
          select sub.product_id, sub.effective_unit_cost, sub.category, sub.cnt
            into v_product_id, v_unit_cost, v_category, v_match_count
            from (
              select vp.product_id, vp.effective_unit_cost, vp.category,
                     count(*) over () as cnt
                from analytics.v_dim_product vp
                where vp.shop_id = p_shop_id and not vp.is_active and vp.sku = v_item.sku_raw
                limit 1
            ) sub;

          if v_match_count = 1 then
            if v_tier3_conclusive then
              v_match_note := 'จับคู่กับสินค้าที่ปิดการขาย (ใช้ต้นทุนเดิม): ' || v_item.sku_raw;
            else
              v_match_note := 'จับคู่กับสินค้าที่ปิดการขาย (ใช้ต้นทุนเดิม) — ยังพิสูจน์ไม่ได้ว่าไม่มีคู่แฝดที่ยังขายอยู่ — ต้องตรวจมือ: ' || v_item.sku_raw;
              v_weak_order := true;
            end if;
          else
            v_product_id := null; v_unit_cost := null; v_category := null;
          end if;
        end if;

        if v_product_id is null then
          v_unknown := v_unknown + 1;
          v_weak_order := true;
          v_match_note := 'ไม่พบสินค้าในระบบ ต้นทุนถูกนับเป็น 0: ' || v_item.sku_raw;
        end if;
        if v_category = 'เงินแท่ง' then
          v_unit_cost := round(coalesce(v_item.unit_price, 0) / 1.2, 2);
        end if;
        insert into analytics.fact_order_item (shop_id, fact_order_id, product_id, sku_snapshot, product_name_snapshot, qty, unit_price, unit_cost_snapshot)
        values (p_shop_id, v_fo.fact_order_id, v_product_id, v_item.sku_raw, v_item.product_name_raw, coalesce(v_item.qty, 1), coalesce(v_item.unit_price, 0), v_unit_cost)
        returning id into v_new_item_id;
        update analytics.stg_order_line_import set fact_order_item_id = v_new_item_id, import_status = 'transformed', error_detail = v_match_note where id = v_item.id;
        v_transformed := v_transformed + 1;
        v_cogs := v_cogs + coalesce(v_item.qty, 1) * coalesce(v_unit_cost, 0);
      exception when others then
        update analytics.stg_order_line_import set import_status = 'error', error_detail = sqlerrm where id = v_item.id;
        v_errored := v_errored + 1;
        v_weak_order := true;
      end;
    end loop;
    update analytics.fact_order
       set cogs = v_cogs,
           profit = round(revenue - v_cogs, 2),
           profit_status = case when v_weak_order then 'estimated' else 'actual' end::analytics.profit_status_t
     where id = v_fo.fact_order_id;
  end loop;

  return query select v_transformed, v_orphan, v_skipped_blank, v_unknown, v_errored;
end;
$function$;

revoke execute on function analytics.transform_pending_order_lines(uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.transform_pending_order_lines(uuid, uuid) to service_role;

notify pgrst, 'reload schema';

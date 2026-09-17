-- 0109_orphan_rematch_fix.sql
-- ✅ APPLIED 4 ก.ย. 69 (version 20260904101452) — ไฟล์ถูกเก็บเข้า main 14 ก.ย. 69
--    หลังค้างอยู่บน branch fix/orphan-rematch
-- ⚠️ 0115 (12 ก.ย. 69) create or replace ฟังก์ชันตัวเดียวกันนี้ทับไปแล้ว โดยลอก
--    นิยามสดจาก pg_get_functiondef จึงพา logic ของ 0109 ติดไปครบ (ยืนยันกับ DB
--    จริงแล้ว 14 ก.ย. 69: ทั้ง orphan scan และ reset-to-pending ยังอยู่)
--    ⇒ ห้ามรัน 0109 ซ้ำเดี่ยวๆ บน DB ที่มี 0115 แล้ว จะย้อนฟังก์ชันกลับไปเป็น
--    เวอร์ชันที่ไม่มี tombstone check ของระบบตรวจจับใบยกเลิก
-- Bug: /crm/import promises "จะจับคู่และคำนวณกำไรให้อัตโนมัติเมื่อนำเข้ารายงาน
-- ยอดขายของออเดอร์นั้นแล้ว" -- that has never been true. Phase 1 of
-- analytics.transform_pending_order_lines (0095 body, verified byte-identical
-- to 0094's phase 1 -- 0096 did not touch this function, see its header
-- comment line "ห้ามแตะ: ... analytics.transform_pending_order_lines") only
-- ever DEMOTES a row to 'orphan' or 'error'. There has never been a branch
-- that PROMOTES a row back to 'pending' once its parent analytics.fact_order
-- shows up later. Phase 2 only ever picks up s.import_status = 'pending', so
-- a row stuck at 'orphan' or 'error' is stuck forever, even after the order
-- it belongs to is imported.
--
-- Confirmed on production 4-Sep-69: SKU report imported before the order
-- report -> 235 rows landed in 'orphan'. Order report then imported 225
-- orders successfully. Manually calling transform_pending_order_lines()
-- afterwards returned transformed_count:0 across the board. A query
-- confirmed 235 of the 243 orphan rows (207 orders) already have a matching
-- fact_order and were simply never re-checked. The UI has no path around
-- this either: OrderImportClient.tsx marks a re-uploaded SKU file
-- status:"duplicate" and `eligible = items.filter(it => it.status === "ok")`
-- drops it, so there is no user-triggered retry.
--
-- Fix: exactly one new branch in phase 1, placed after the existing
-- `if not found then ... end if;` block (i.e. only reached once a matching
-- fact_order has been confirmed to exist). Any row that is not already
-- 'pending' (covers both 'orphan' and 'error') is promoted back to 'pending'
-- and its stale error_detail ("no fact_order for source_order_no: ...", or
-- whatever sqlerrm left behind) is cleared so it doesn't lie to whoever
-- reads it next. Rows already 'pending' are left untouched by the `is
-- distinct from` guard -- no redundant UPDATE on the already-happy path.
--
-- Why this is safe to run repeatedly (see scripts/verify-0109.sql for the
-- proof, not just this claim):
--   - skipped_blank rows are excluded from phase 1's own `for` loop WHERE
--     clause (`import_status in ('pending','orphan','error')`) -- this new
--     branch cannot see them, let alone revive them.
--   - transformed rows are excluded the same way -- also cannot be touched.
--   - Once a promoted row is picked up by phase 2 in the SAME function call
--     (phase 2 re-queries import_status = 'pending' fresh, and PL/pgSQL
--     statements in one transaction see the effects of earlier statements in
--     that same transaction), it is written to fact_order_item and flipped
--     to 'transformed'. On a second call, it no longer matches phase 1's
--     WHERE clause (not pending/orphan/error) and is not touched again --
--     that is what makes the whole fix idempotent, not any change to phase
--     2's own delete-then-reinsert logic, which is untouched here.
--   - The 8 old orphan rows (Jan/Feb/Mar/Aug) whose fact_order genuinely
--     does not exist still fall into the `if not found` branch and `continue`
--     before ever reaching the new code -- they stay 'orphan'.
--
-- Everything else in the function body below is copied verbatim from 0095
-- (the current live definition -- 0096 does not redefine it). Signature
-- (p_shop_id uuid, p_batch_id uuid) is unchanged, so plain `create or
-- replace` is safe (3j-migration-traps #1, no drop needed). Grant is
-- re-issued anyway (#2 -- grants do not survive `create or replace`),
-- reproduced identically to what 0095 set: revoke from public/anon/
-- authenticated, grant execute to service_role only.

create or replace function analytics.transform_pending_order_lines(p_shop_id uuid, p_batch_id uuid)
 returns table(transformed_count integer, orphan_count integer, skipped_blank_count integer, unknown_sku_count integer, errored_count integer)
 language plpgsql security definer set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_row analytics.stg_order_line_import%rowtype;
  v_item analytics.stg_order_line_import%rowtype;
  v_fo record;
  v_product_id uuid;
  v_unit_cost numeric(12, 2);
  v_category text;                         -- 0042
  v_sku_norm text;                         -- 0093: sku_raw with leading junk stripped
  v_stripped_len int;                      -- 0094: how many leading chars were stripped
  v_stripped text;                         -- 0095 fix 3: the actual stripped leading run
  v_match_count int;                       -- 0094: count(*) over() from the single-statement tier 3 / tier 2' lookup
  v_match_note text;                       -- 0093: tier-3/tier-2' breadcrumb for error_detail, else null
  v_tier3_conclusive boolean;              -- 0095 fix 2: true only when tier 3 ran and proved cnt = 0
  v_weak_order boolean;                    -- 0095 fix 1: true when this order must not be stamped 'actual'
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
    v_weak_order := false; -- 0095 fix 1: per-order flag, reset alongside v_cogs
    for v_item in
      select * from analytics.stg_order_line_import s
      where s.shop_id = p_shop_id and s.source_order_no = v_fo.source_order_no and s.sku_raw is not null and s.import_status <> 'skipped_blank'
      order by s.line_no
    loop
      begin
        v_product_id := null; v_unit_cost := null; v_category := null; v_match_note := null; v_match_count := null;
        v_tier3_conclusive := false; -- 0095 fix 2: per-item, only tier 3's own "cnt = 0" branch sets this true

        -- 0093 tier 1: exact sku match, active products only. Unchanged
        -- happy path for every SKU that is already clean.
        select vp.product_id, vp.effective_unit_cost, vp.category
          into v_product_id, v_unit_cost, v_category
          from analytics.v_dim_product vp
          where vp.shop_id = p_shop_id and vp.is_active and vp.sku = v_item.sku_raw;

        if v_product_id is null then
          -- 0093 tier 3 (tier 2 deliberately skipped here -- see 0094
          -- header comment): normalize both sides, strip a LEADING run of
          -- non-alphanumeric chars only, compare against active products,
          -- require a unique hit.
          -- 0094 guards: stripped prefix must be <= 2 chars, and the
          -- normalized needle must contain at least one letter.
          -- 0095 fix 3: ALSO require the stripped run itself to contain no
          -- real letter (Thai included) -- see header comment for why
          -- `[[:alpha:]]` is the one intentional exception here.
          v_sku_norm := regexp_replace(v_item.sku_raw, '^[^A-Za-z0-9]+', '');
          v_stripped_len := length(v_item.sku_raw) - length(v_sku_norm);
          v_stripped := left(v_item.sku_raw, v_stripped_len);

          if v_sku_norm <> '' and v_stripped_len <= 2 and v_sku_norm ~ '[A-Za-z]'
             and (v_stripped_len = 0 or v_stripped !~ '[[:alpha:]]') then
            -- 0094: single statement (count(*) over () + limit 1) instead of
            -- 0093's separate count(*) then select ... into -- avoids the
            -- two-statement race described in the 0094 header comment.
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
              -- 0095 fix 2: v_match_count is null (not 0) when the subquery
              -- returned zero rows -- coalesce is required. Only a
              -- genuine cnt = 0 proves no active twin exists; cnt > 1
              -- proves ambiguity, not absence, so it must NOT set
              -- v_tier3_conclusive.
              if coalesce(v_match_count, 0) = 0 then
                v_tier3_conclusive := true;
              end if;
              -- cnt is 0 (no active candidate) or > 1 (ambiguous) -- treat
              -- as no match, do not guess, do not leave a fake match_note.
              v_product_id := null; v_unit_cost := null; v_category := null;
            end if;
          end if;
        end if;

        if v_product_id is null then
          -- 0094 tier 2': exact (non-normalized) match against an INACTIVE
          -- product, reached when tier 1 found nothing AND tier 3 either
          -- found nothing or was skipped by its guards.
          -- 0095 fix 2: v_tier3_conclusive (set above) now gates whether
          -- this is trustworthy enough to call 'actual'. Match is still
          -- accepted and costed either way -- 0094's trade-off stands (a
          -- wrong-but-costed match beats a silent $0 COGS) -- but an
          -- inconclusive tier 3 now flips v_weak_order so the order is
          -- stamped 'estimated', not 'actual'.
          select sub.product_id, sub.effective_unit_cost, sub.category, sub.cnt
            into v_product_id, v_unit_cost, v_category, v_match_count
            from (
              select vp.product_id, vp.effective_unit_cost, vp.category,
                     count(*) over () as cnt
                from analytics.v_dim_product vp
                where vp.shop_id = p_shop_id and not vp.is_active and vp.sku = v_item.sku_raw
                limit 1
            ) sub;

          -- NOTE: uq_product_shop_sku (shop_id, sku) means cnt here can only
          -- ever be 0 or 1 -- the `= 1` check (vs. `>= 1`) is therefore
          -- effectively dead code for the ">1" case. Left as-is (matches
          -- the tier 3 pattern above and costs nothing), known and
          -- intentional, not an oversight.
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
          v_weak_order := true; -- 0095 fix 1(a): unknown item -> order profit cannot be called 'actual'
          -- 0094 fix 3: unknown SKUs must always leave a breadcrumb -- 0093
          -- left error_detail null here, so a $0-cost line was invisible
          -- unless someone thought to check.
          v_match_note := 'ไม่พบสินค้าในระบบ ต้นทุนถูกนับเป็น 0: ' || v_item.sku_raw;
        end if;
        -- 0042: silver bars are spot-priced (sold ~spot+20%); real cost tracks
        -- the sale price, not the fixed catalog cost -> price / 1.2 (16.7% margin).
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
        -- 0095 fix 1(c): an item that threw is NOT inserted into
        -- fact_order_item at all -- it does not contribute $0 cost, it
        -- vanishes from the order entirely. That is strictly worse than an
        -- unknown SKU, so the order must not claim 'actual' either.
        -- (backend-dev flagged this gap; the brief only listed unknown and
        -- unproven-tier-2' -- adding it here rather than leaving a third
        -- silent path to an overstated profit.)
        v_weak_order := true;
      end;
    end loop;
    -- 0095 fix 1: 'actual' is no longer unconditional -- any item that was
    -- unknown or matched via an unproven tier 2' hit flips this order to
    -- 'estimated'. Cast is required: a bare CASE produces text, and
    -- text -> analytics.profit_status_t is not an implicit UPDATE SET cast
    -- (same error 0047 hit on the sibling function).
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

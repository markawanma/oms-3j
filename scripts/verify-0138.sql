-- scripts/verify-0138.sql
--
-- ชุดทดสอบของ supabase/migrations/0138_stock_lot_tables.sql (L1 ของ
-- design-inventory-lot-costing.md — stock_lot/stock_lot_consumption + D1:
-- production_order_done เลิก stamp ต้นทุนกลับ product → insert lot แทน)
--
-- ตาม skill 3j-migration-traps #11: do $$ ... $$ block เดียว จบด้วย
-- `raise exception` เสมอ ⇒ ทั้ง transaction rollback ไม่ว่าผลจะผ่าน/ไม่ผ่าน —
-- อ่านผลจาก error message นี้. ใช้เป็นทั้ง dry-run (ก่อน apply 0138 จริง —
-- Part 0 ติดตั้งตาราง/trigger/ฟังก์ชัน/view ใหม่ชั่วคราวในทรานแซคชันนี้เอง)
-- และ post-apply verify (รันซ้ำหลัง apply จริงผ่าน MCP apply_migration —
-- ทุกอย่างใน Part 0 เป็น idempotent: create table/index if not exists,
-- create or replace function/view, drop+create trigger — รันซ้ำได้ปลอดภัย)
--
-- 💰 แตะต้นทุนที่ล็อกถาวร + สต็อก + ledger — shop/SKU สังเคราะห์ทั้งหมด
-- สร้างขึ้นในทรานแซคชันนี้เอง ไม่แตะ shop/SKU จริงเลย
--
-- ⚠️ ไม่ได้ทดสอบ analytics.transform_pending_order_lines แบบ end-to-end ผ่าน
-- staged import จริง (ต้องสร้าง stg_import_batch + stg_order_line_import +
-- fact_order ที่ match กัน — setup ใหญ่สำหรับฟังก์ชันที่ 0138 ไม่ได้แตะเลย)
-- ใช้หลักฐานที่แน่นกว่าแทน: [T20] พิสูจน์ว่า v_dim_product.effective_unit_cost
-- (คอลัมน์เดียวที่ transform_pending_order_lines อ่านจาก view นี้) ตรงเป๊ะ
-- ทุก SKU จริงก่อน-หลัง 0138 (เทียบด้วย string_agg ทั้งชุด ไม่ใช่สุ่มดู) — ถ้า
-- อินพุตของฟังก์ชันไม่เปลี่ยนและตัวฟังก์ชันเองไม่ถูกแก้ (grep ยืนยันแล้วว่า
-- 0138 ไม่มีคำว่า transform_pending_order_lines เลย) ผลลัพธ์ต้องเหมือนเดิม
-- — เป็นข้อจำกัดที่แจ้ง Tech Lead ตรงๆ ไม่ใช่การเดาว่าผ่าน
--
-- โครงสร้างไฟล์:
--   Part 0  — apply DDL ของ 0138 verbatim (ไม่รวม backfill do-block ท้ายไฟล์
--             จริง — ทดสอบ logic นั้นแยกใน Part 8 โดย scope ด้วย shop_id
--             สังเคราะห์ เพื่อไม่ให้ผลทดสอบขึ้นกับสถานะข้อมูลจริงบน prod ตอนรัน)
--   Part 1  — setup: shop + SKU สังเคราะห์
--   Part 2  — CHECK constraint ของ analytics.stock_lot (T1-T5)
--   Part 3  — derive-shop trigger: ข้ามร้าน (T6-T8)
--   Part 4  — grant/RLS ของ 2 ตาราง + 2 view ใหม่ (T9)
--   Part 5  — production_order_done: ไม่ stamp cost กลับ product, สร้าง lot,
--             idempotent, ABBA fix แบบ static (T10-T14)
--   Part 6  — v_stock_lot / v_stock_lot_mismatch ถูกต้อง (T15-T16)
--   Part 7  — v_dim_product: คอลัมน์ lot ใหม่ + effective_unit_cost ไม่เปลี่ยน (T17-T18)
--   Part 8  — backfill logic (คัดลอกจาก migration จริง scope ด้วย shop_id) (T19)
--   Part 9  — เคสห้ามพัง: production_order_cancel / adjust_stock ปกติ (T21-T22)

do $$
declare
  v_log text := E'\n=== verify 0138 (stock_lot tables + production_order_done lot) ===\n';

  v_before_dim_snapshot text;
  v_after_dim_snapshot  text;

  v_shop        uuid := gen_random_uuid();
  v_shop_ok     uuid := gen_random_uuid(); -- backfill scenario A (all valid)
  v_shop_bad    uuid := gen_random_uuid(); -- backfill scenario B (null cost)

  v_p_fixed     uuid; -- fixed, unit_cost=100 — สงวนไว้ใช้เฉพาะ Part 5-7 (flow สะอาด
                       -- ห้ามใช้ใน Part 2-3 เพราะจะปนกับ lot ที่ Part 2-3 สร้างทดสอบ)
  v_p_spot      uuid; -- spot, weight=10, purity=0.925, labor=20 — สงวนไว้ Part 5-7 เหมือนกัน
  v_p_raw       uuid; -- fixed, unit_cost=10 — ใช้เฉพาะ Part 2-3 (CHECK/trigger ตรงๆ)

  v_p_bf_ok     uuid; -- shop_ok: fixed, unit_cost=55, track_stock=true, on_hand=20
  v_p_bf_notrack uuid; -- shop_ok: track_stock=false, on_hand=5 (ไม่ควรเข้าเงื่อนไข)
  v_p_bf_zero   uuid; -- shop_ok: track_stock=true, on_hand=0 (ไม่ควรเข้าเงื่อนไข)
  v_p_bf_null   uuid; -- shop_bad: fixed, unit_cost=null, track_stock=true, on_hand=8

  v_spot_price  numeric := 72; -- ราคาเงินสังเคราะห์ของวันนี้

  v_order_id    uuid;
  v_item_res    jsonb;
  v_item_id_spot  uuid;
  v_item_id_fixed uuid;
  v_res         jsonb;

  v_caught      boolean;
  v_code        text;
  v_msg         text;

  v_before_cost_type text; v_before_unit_cost numeric; v_before_track boolean; v_before_since date;
  v_after_cost_type  text; v_after_unit_cost  numeric; v_after_track  boolean; v_after_since  date;

  v_lot_count   int;
  -- 🔴 ห้ามใช้ analytics.stock_lot%rowtype ที่นี่ — PL/pgSQL คอมไพล์ทั้งบล็อก
  -- (รวม declare) ก่อนรัน — ตารางเพิ่งถูกสร้างใน Part 0 ตอนรัน
  -- ⇒ 42P01 "relation does not exist" ตั้งแต่ยังไม่เริ่ม (dry-run จับได้ 19 ก.ย. 69)
  v_lot_id            uuid;
  v_lot_shop_id       uuid;
  v_lot_source        text;
  v_lot_unit_cost     numeric;
  v_lot_qty_in        int;
  v_lot_qty_remaining int;
  v_lot_received_on   date;
  v_lot2_id     uuid;

  v_qty_on_hand int;
  v_mismatch_qty int;

  v_def         text;
  v_fifo_lock_count int;

  v_priv_anon boolean; v_priv_auth boolean; v_priv_svc boolean;
  v_rls_enabled boolean; v_policy_count int;

  v_missing_cost_skus text;
  v_inserted_count int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -----------------------------------------------------------------------
  -- 🔴 snapshot v_dim_product.effective_unit_cost ของ SKU จริงทั้งหมด
  -- ก่อนแตะอะไรเลย (ก่อน Part 0 replace view) — ใช้เทียบใน T20
  -----------------------------------------------------------------------
  select string_agg(product_id::text || ':' || coalesce(effective_unit_cost::text, 'NULL'), ',' order by product_id)
    into v_before_dim_snapshot
  from analytics.v_dim_product;

  -----------------------------------------------------------------------
  -- Part 0: apply 0138's DDL verbatim (ไม่รวม backfill do-block ท้ายไฟล์จริง)
  -----------------------------------------------------------------------
  execute $ddl$
    create table if not exists analytics.stock_lot (
      id                        uuid primary key default gen_random_uuid(),
      shop_id                   uuid not null references public.shop (id) on delete cascade,
      product_id                uuid not null references public.product (id) on delete restrict,
      source                    text not null check (source in ('production', 'opening', 'purchase')),
      unit_cost                 numeric(12, 2) not null check (unit_cost >= 0),
      qty_in                    int not null check (qty_in > 0 and qty_in <= 100000),
      qty_remaining             int not null check (qty_remaining between 0 and qty_in),
      received_on               date not null,
      production_order_item_id  uuid references analytics.production_order_item (id) on delete restrict,
      note                      text,
      created_at                timestamptz not null default now(),
      updated_at                timestamptz not null default now()
    );

    create unique index if not exists uq_stock_lot_production_order_item
      on analytics.stock_lot (production_order_item_id)
      where production_order_item_id is not null;

    create index if not exists idx_stock_lot_fifo
      on analytics.stock_lot (shop_id, product_id, received_on, created_at)
      where qty_remaining > 0;

    alter table analytics.stock_lot enable row level security;
    revoke all on analytics.stock_lot from public, anon, authenticated;
    grant all on analytics.stock_lot to service_role;

    create or replace function analytics.stock_lot_derive_shop()
     returns trigger
     language plpgsql
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $f1$
    declare
      v_product_shop_id uuid;
    begin
      select shop_id into v_product_shop_id from public.product where id = new.product_id;
      if v_product_shop_id is null then
        raise exception 'stock_lot: ไม่พบ SKU (product_id=%)', new.product_id using errcode = '22023';
      end if;
      new.shop_id := v_product_shop_id;
      return new;
    end;
    $f1$;

    revoke execute on function analytics.stock_lot_derive_shop() from public, anon, authenticated;

    drop trigger if exists trg_stock_lot_derive_shop on analytics.stock_lot;
    create trigger trg_stock_lot_derive_shop
      before insert or update of product_id on analytics.stock_lot
      for each row execute function analytics.stock_lot_derive_shop();

    create table if not exists analytics.stock_lot_consumption (
      shop_id         uuid not null references public.shop (id) on delete cascade,
      source_order_no text not null,
      product_id      uuid not null references public.product (id) on delete restrict,
      lot_id          uuid not null references analytics.stock_lot (id) on delete restrict,
      qty             int not null check (qty > 0),
      updated_at      timestamptz not null default now(),
      primary key (shop_id, source_order_no, product_id, lot_id)
    );

    alter table analytics.stock_lot_consumption enable row level security;
    revoke all on analytics.stock_lot_consumption from public, anon, authenticated;
    grant all on analytics.stock_lot_consumption to service_role;

    create or replace function analytics.stock_lot_consumption_derive_shop()
     returns trigger
     language plpgsql
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $f2$
    declare
      v_product_shop_id uuid;
      v_lot_shop_id     uuid;
      v_lot_product_id  uuid;
    begin
      select shop_id into v_product_shop_id from public.product where id = new.product_id;
      if v_product_shop_id is null then
        raise exception 'stock_lot_consumption: ไม่พบ SKU (product_id=%)', new.product_id using errcode = '22023';
      end if;

      select shop_id, product_id into v_lot_shop_id, v_lot_product_id
        from analytics.stock_lot where id = new.lot_id;
      if v_lot_shop_id is null then
        raise exception 'stock_lot_consumption: ไม่พบ lot (lot_id=%)', new.lot_id using errcode = '22023';
      end if;
      if v_lot_shop_id <> v_product_shop_id or v_lot_product_id <> new.product_id then
        raise exception 'stock_lot_consumption: lot (lot_id=%) ไม่ตรงกับ SKU/ร้านของรายการนี้', new.lot_id using errcode = '22023';
      end if;

      new.shop_id := v_product_shop_id;
      return new;
    end;
    $f2$;

    revoke execute on function analytics.stock_lot_consumption_derive_shop() from public, anon, authenticated;

    drop trigger if exists trg_stock_lot_consumption_derive_shop on analytics.stock_lot_consumption;
    create trigger trg_stock_lot_consumption_derive_shop
      before insert or update of product_id, lot_id on analytics.stock_lot_consumption
      for each row execute function analytics.stock_lot_consumption_derive_shop();
  $ddl$;

  -- production_order_done — signature เดิม (uuid,uuid,jsonb,numeric,uuid) —
  -- body คัดลอกจาก supabase/migrations/0138_stock_lot_tables.sql คำต่อคำ
  execute $ddl_done$
    create or replace function analytics.production_order_done(
      p_shop_id             uuid,
      p_production_order_id uuid,
      p_items               jsonb default null,
      p_expected_spot_thb_per_gram numeric default null,
      p_actor               uuid default null
    )
     returns jsonb
     language plpgsql
     security definer
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body_done$
    declare
      v_order          analytics.production_order%rowtype;
      v_today          date := (now() at time zone 'Asia/Bangkok')::date;
      v_work           jsonb;
      v_elem           jsonb;
      v_qty_done       int;
      v_total_qty_done numeric := 0;
      v_needs_spot     boolean;
      v_spot           numeric;
      v_product        public.product%rowtype;
      v_calc           jsonb;
      v_unit_cost      numeric;
      v_before         jsonb;
      v_after          jsonb;
      v_result         jsonb;
    begin
      if p_shop_id is null or p_production_order_id is null then
        raise exception 'production_order_done: p_shop_id and p_production_order_id are required';
      end if;
      if p_items is not null and jsonb_typeof(p_items) <> 'array' then
        raise exception 'production_order_done: p_items ต้องเป็น json array' using errcode = '22023';
      end if;

      perform analytics.crm_require_owner_admin(p_shop_id);

      select * into v_order from analytics.production_order
        where id = p_production_order_id and shop_id = p_shop_id
        for update;
      if not found then
        raise exception 'production_order_done: ไม่พบใบผลิต % ในร้านนี้', p_production_order_id using errcode = '22023';
      end if;

      if v_order.status = 'done' then
        select coalesce(jsonb_agg(jsonb_build_object(
            'product_id', poi.product_id, 'sku', p.sku, 'qty_done', poi.qty_done,
            'unit_cost', poi.unit_cost, 'prev_cost_type', poi.prev_cost_type, 'prev_unit_cost', poi.prev_unit_cost
          )), '[]'::jsonb)
          into v_result
        from analytics.production_order_item poi
        join public.product p on p.id = poi.product_id
        where poi.production_order_id = p_production_order_id;

        return jsonb_build_object('production_order_id', p_production_order_id, 'po_no', v_order.po_no,
          'status', v_order.status, 'already_done', true, 'items', v_result);
      end if;

      if v_order.status = 'cancelled' then
        raise exception 'production_order_done: ใบ % ถูกยกเลิกไปแล้ว ทำ done ไม่ได้', v_order.po_no using errcode = '22023';
      end if;

      select coalesce(jsonb_agg(jsonb_build_object(
          'id', poi.id, 'product_id', poi.product_id, 'qty_planned', poi.qty_planned,
          'qty_done_resolved', coalesce(
            (select (ov ->> 'qty_done')::int from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) ov
              where (ov ->> 'product_id')::uuid = poi.product_id),
            poi.qty_planned
          )
        )), '[]'::jsonb)
        into v_work
      from analytics.production_order_item poi
      where poi.production_order_id = p_production_order_id;

      if v_work = '[]'::jsonb then
        raise exception 'production_order_done: ใบ % ไม่มีรายการให้ผลิต (ใบว่าง)', v_order.po_no using errcode = '22023';
      end if;

      for v_elem in select * from jsonb_array_elements(v_work) loop
        v_qty_done := (v_elem ->> 'qty_done_resolved')::int;
        if v_qty_done is null or not (v_qty_done >= 0 and v_qty_done <= 100000) then
          raise exception 'production_order_done: qty_done ของ SKU (product_id=%) ต้องอยู่ระหว่าง 0-100000', v_elem ->> 'product_id' using errcode = '22023';
        end if;
        v_total_qty_done := v_total_qty_done + v_qty_done;
      end loop;

      if v_total_qty_done = 0 then
        raise exception 'production_order_done: ทุกรายการในใบ % ผลิตได้ 0 ชิ้น — ถ้าไม่ได้ผลิตจริงให้ยกเลิกใบนี้แทน (analytics.production_order_cancel)', v_order.po_no using errcode = '22023';
      end if;

      select exists (
        select 1 from jsonb_array_elements(v_work) e
        join public.product p on p.id = (e ->> 'product_id')::uuid
        where p.cost_type = 'spot' and (e ->> 'qty_done_resolved')::int > 0
      ) into v_needs_spot;

      if v_needs_spot then
        v_spot := analytics.production_spot_resolve(p_shop_id, v_order.spot_override_thb_per_gram);
      end if;

      if v_needs_spot then
        if p_expected_spot_thb_per_gram is null then
          raise exception 'production_order_done: ใบนี้ใช้ราคาเงินคำนวณต้นทุน ต้องส่งราคาที่หน้าจอเห็น (p_expected_spot_thb_per_gram) มาด้วยเสมอ — กดยืนยันจากหน้าใบผลิตเท่านั้น'
            using errcode = '22023';
        end if;
        if not (abs(v_spot - p_expected_spot_thb_per_gram) <= 0.0001) then
          raise exception 'production_order_done: ราคาเงินเปลี่ยนไประหว่างที่เปิดหน้าต่างนี้ค้างไว้ (ตอนเปิดหน้าต่างเห็นราคา % บาท/กรัม แต่ตอนนี้ระบบคำนวณได้ % บาท/กรัม) — ปิดหน้าต่างยืนยันนี้แล้วเปิดใบผลิตใหม่อีกครั้งเพื่อดูราคาล่าสุดก่อนยืนยัน', p_expected_spot_thb_per_gram, v_spot using errcode = '22023';
        end if;
      end if;

      for v_elem in select * from jsonb_array_elements(v_work) loop
        v_qty_done := (v_elem ->> 'qty_done_resolved')::int;

        if v_qty_done = 0 then
          update analytics.production_order_item
             set qty_done = 0, updated_at = now()
           where id = (v_elem ->> 'id')::uuid;
          continue;
        end if;

        select * into v_product from public.product
          where id = (v_elem ->> 'product_id')::uuid and shop_id = p_shop_id
          for update;
        if not found then
          raise exception 'production_order_done: ไม่พบ SKU (product_id=%) ในร้านนี้', v_elem ->> 'product_id' using errcode = '22023';
        end if;
        if not v_product.is_active then
          raise exception 'production_order_done: SKU % ปิดใช้งานแล้ว ผลิตไม่ได้', v_product.sku using errcode = '22023';
        end if;
        if v_product.sku ~* '^live' then
          raise exception 'production_order_done: SKU % เป็น SKU เฉพาะไลฟ์ (live*) ผลิตไม่ได้', v_product.sku using errcode = '22023';
        end if;

        if v_product.cost_type = 'spot' and v_spot is null then
          raise exception 'production_order_done: SKU % ถูกเปลี่ยนเป็นโหมดราคาเงินระหว่างที่กำลังบันทึกใบนี้ — เปิดใบผลิตใหม่อีกครั้งเพื่อคำนวณต้นทุนใหม่', v_product.sku using errcode = '22023';
        end if;
        v_calc := analytics.production_cost_calc(
          p_shop_id, v_product.id,
          case when v_product.cost_type = 'spot' then v_spot else null end
        );
        v_unit_cost := (v_calc ->> 'unit_cost')::numeric;
        if v_unit_cost is null then
          raise exception 'production_order_done: คำนวณต้นทุน SKU % ไม่ได้ (unit_cost เป็น null)', v_product.sku using errcode = '22023';
        end if;

        v_before := jsonb_build_object('cost_type', v_product.cost_type, 'unit_cost', v_product.unit_cost,
          'track_stock', v_product.track_stock, 'track_stock_since', v_product.track_stock_since);

        update analytics.production_order_item
           set qty_done = v_qty_done, unit_cost = v_unit_cost,
               prev_cost_type = v_product.cost_type, prev_unit_cost = v_product.unit_cost,
               updated_at = now()
         where id = (v_elem ->> 'id')::uuid;

        insert into public.central_stock (product_id) values (v_product.id)
          on conflict (product_id) do nothing;

        perform public.adjust_stock(p_shop_id, v_product.id, v_qty_done, 'po:' || (v_elem ->> 'id'));

        update public.product
           set track_stock = true,
               track_stock_since = coalesce(v_product.track_stock_since, v_today),
               updated_at = now()
         where id = v_product.id;

        insert into analytics.stock_lot (
          shop_id, product_id, source, unit_cost, qty_in, qty_remaining, received_on,
          production_order_item_id, note
        ) values (
          p_shop_id, v_product.id, 'production', v_unit_cost, v_qty_done, v_qty_done, v_today,
          (v_elem ->> 'id')::uuid, 'po_no=' || v_order.po_no
        )
        on conflict (production_order_item_id) where production_order_item_id is not null do nothing;

        v_after := jsonb_build_object('cost_type', v_product.cost_type, 'unit_cost', v_product.unit_cost,
          'track_stock', true, 'track_stock_since', coalesce(v_product.track_stock_since, v_today));

        insert into analytics.catalog_audit_log (shop_id, product_id, sku, action, before, after, changed_by)
        values (p_shop_id, v_product.id, v_product.sku, 'edit', v_before, v_after, coalesce(p_actor, auth.uid()));
      end loop;

      update analytics.production_order
         set status = 'done', done_at = now()
       where id = p_production_order_id;

      select coalesce(jsonb_agg(jsonb_build_object(
          'product_id', poi.product_id, 'sku', p.sku, 'qty_done', poi.qty_done,
          'unit_cost', poi.unit_cost, 'prev_cost_type', poi.prev_cost_type, 'prev_unit_cost', poi.prev_unit_cost
        )), '[]'::jsonb)
        into v_result
      from analytics.production_order_item poi
      join public.product p on p.id = poi.product_id
      where poi.production_order_id = p_production_order_id;

      return jsonb_build_object('production_order_id', p_production_order_id, 'po_no', v_order.po_no,
        'status', 'done', 'already_done', false, 'items', v_result);
    end;
    $body_done$;

    revoke execute on function analytics.production_order_done(uuid, uuid, jsonb, numeric, uuid) from public, anon, authenticated;
    grant execute on function analytics.production_order_done(uuid, uuid, jsonb, numeric, uuid) to service_role;
  $ddl_done$;

  execute $ddl_views$
    create or replace view analytics.v_stock_lot
      with (security_invoker = true) as
    select
      sl.id as lot_id, sl.shop_id, sl.product_id, p.sku, p.name as product_name,
      sl.source, sl.unit_cost, sl.qty_in, sl.qty_remaining, sl.received_on,
      sl.production_order_item_id, sl.note, sl.created_at, sl.updated_at,
      round(
        sum(sl.unit_cost * sl.qty_remaining) over (partition by sl.product_id)
        / sum(sl.qty_remaining) over (partition by sl.product_id),
      2) as sku_cost_avg_remaining
    from analytics.stock_lot sl
    join public.product p on p.id = sl.product_id
    where sl.qty_remaining > 0;

    revoke all on analytics.v_stock_lot from public, anon, authenticated;
    grant select on analytics.v_stock_lot to service_role;

    create or replace view analytics.v_stock_lot_mismatch
      with (security_invoker = true) as
    select
      p.id as product_id, p.shop_id, p.sku, p.name as product_name,
      coalesce(sum(sl.qty_remaining), 0) as lot_qty_remaining_total,
      coalesce(cs.qty_on_hand, 0) as central_stock_qty_on_hand,
      coalesce(sum(sl.qty_remaining), 0) - coalesce(cs.qty_on_hand, 0) as mismatch_qty
    from public.product p
    left join public.central_stock cs on cs.product_id = p.id
    left join analytics.stock_lot sl on sl.product_id = p.id and sl.qty_remaining > 0
    where p.track_stock
    group by p.id, p.shop_id, p.sku, p.name, cs.qty_on_hand
    having coalesce(sum(sl.qty_remaining), 0) <> coalesce(cs.qty_on_hand, 0);

    revoke all on analytics.v_stock_lot_mismatch from public, anon, authenticated;
    grant select on analytics.v_stock_lot_mismatch to service_role;

    create or replace view analytics.v_dim_product
      with (security_invoker = true) as
    select
      p.id as product_id, p.shop_id, p.sku, p.name,
      (case p.cost_type
        when 'spot' then round(coalesce(p.silver_weight_g, 0) * coalesce(s.silver_spot_thb_per_gram, 0)
                                * coalesce(p.silver_purity, 0.925) + coalesce(p.labor_cost, 0), 2)
        else p.unit_cost
      end)::numeric(12, 2) as unit_cost,
      p.is_active, p.category, p.created_at, p.updated_at, p.cost_type, p.silver_weight_g,
      coalesce(p.silver_purity, 0.925) as silver_purity, p.labor_cost, p.list_price,
      p.unit_cost as manual_unit_cost,
      (case p.cost_type
        when 'spot' then round(coalesce(p.silver_weight_g, 0) * coalesce(s.silver_spot_thb_per_gram, 0)
                                * coalesce(p.silver_purity, 0.925) + coalesce(p.labor_cost, 0), 2)
        else p.unit_cost
      end)::numeric(12, 2) as effective_unit_cost,
      case
        when p.list_price is not null and p.list_price > 0 then
          round((p.list_price - (case p.cost_type
            when 'spot' then round(coalesce(p.silver_weight_g, 0) * coalesce(s.silver_spot_thb_per_gram, 0)
                                    * coalesce(p.silver_purity, 0.925) + coalesce(p.labor_cost, 0), 2)
            else p.unit_cost end)) / p.list_price, 4)
        else null
      end as margin_pct,
      coalesce(lot.qty_remaining_total, 0) as lot_qty_on_hand,
      lot.cost_avg_remaining as lot_cost_avg,
      coalesce(lot.lot_count, 0) as lot_count
    from public.product p
    left join analytics.shop_setting s on s.shop_id = p.shop_id
    left join (
      select product_id, sum(qty_remaining) as qty_remaining_total,
        round(sum(unit_cost * qty_remaining) / sum(qty_remaining), 2) as cost_avg_remaining,
        count(*) as lot_count
      from analytics.stock_lot
      where qty_remaining > 0
      group by product_id
    ) lot on lot.product_id = p.id;
  $ddl_views$;

  v_log := v_log || '[Part 0] apply 0138 DDL verbatim (2 ตาราง + 2 trigger fn + production_order_done + 3 view): OK (no error)' || E'\n';

  -----------------------------------------------------------------------
  -- Part 1: setup
  -----------------------------------------------------------------------
  insert into public.shop (id, name) values (v_shop, 'ZZ TEST verify-0138');
  insert into public.shop (id, name) values (v_shop_ok, 'ZZ TEST verify-0138 backfill-ok');
  insert into public.shop (id, name) values (v_shop_bad, 'ZZ TEST verify-0138 backfill-bad');

  v_p_fixed := analytics.product_upsert(v_shop, 'ZZ138-FIX', 'ทดสอบ fixed', null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_spot  := analytics.product_upsert(v_shop, 'ZZ138-SPOT', 'ทดสอบ spot', null, 'spot', null, 10, 0.925, 20, null, null, null, null, true);
  v_p_raw   := analytics.product_upsert(v_shop, 'ZZ138-RAW', 'ทดสอบ constraint/trigger ตรงๆ', null, 'fixed', 10, null, null, null, null, null, null, null, true);

  v_p_bf_ok      := analytics.product_upsert(v_shop_ok, 'ZZ138-BF-OK',      'backfill cost มี',    null, 'fixed', 55,   null, null, null, null, null, null, null, true);
  v_p_bf_notrack := analytics.product_upsert(v_shop_ok, 'ZZ138-BF-NOTRACK', 'backfill ไม่ track',  null, 'fixed', 30,   null, null, null, null, null, null, null, true);
  v_p_bf_zero    := analytics.product_upsert(v_shop_ok, 'ZZ138-BF-ZERO',    'backfill on_hand=0',  null, 'fixed', 40,   null, null, null, null, null, null, null, true);
  v_p_bf_null    := analytics.product_upsert(v_shop_bad, 'ZZ138-BF-NULL',   'backfill cost null',  null, 'fixed', null, null, null, null, null, null, null, null, true);

  perform analytics.oem_metal_price_set(v_shop, 'silver', v_spot_price, (now() at time zone 'Asia/Bangkok')::date, 'manual');

  v_log := v_log || '[Part 1] setup 3 shop + 7 SKU สังเคราะห์: OK' || E'\n';

  -----------------------------------------------------------------------
  -- Part 2: CHECK constraints ของ analytics.stock_lot (T1-T5)
  -----------------------------------------------------------------------
  -- 🔴 ใช้ v_p_raw (ไม่ใช่ v_p_fixed/v_p_spot) ตลอด Part 2-3 โดยตั้งใจ — Part 5-7
  -- ต้องการ v_p_fixed/v_p_spot ที่ "สะอาด" (มีแค่ lot จาก production_order_done
  -- เท่านั้น) เพื่อเทียบ qty/avg-cost/lot_count แบบตัวเลขตรงๆ ถ้าปนกับ lot ที่
  -- สร้างทดสอบตรงในนี้ ตัวเลขที่คาดในภายหลังจะผิดหมด
  v_caught := false;
  begin
    insert into analytics.stock_lot (shop_id, product_id, source, unit_cost, qty_in, qty_remaining, received_on)
    values (v_shop, v_p_raw, 'opening', 10, 5, -1, current_date);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T1] qty_remaining=-1 ถูกปฏิเสธ (CHECK between 0 and qty_in): %s\n', case when v_caught then 'OK' else 'FAIL' end);

  v_caught := false;
  begin
    insert into analytics.stock_lot (shop_id, product_id, source, unit_cost, qty_in, qty_remaining, received_on)
    values (v_shop, v_p_raw, 'opening', 10, 5, 6, current_date);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T2] qty_remaining=6 > qty_in=5 ถูกปฏิเสธ: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  v_caught := false;
  begin
    insert into analytics.stock_lot (shop_id, product_id, source, unit_cost, qty_in, qty_remaining, received_on)
    values (v_shop, v_p_raw, 'opening', -5, 5, 5, current_date);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T3] unit_cost=-5 ถูกปฏิเสธ (CHECK >= 0): %s\n', case when v_caught then 'OK' else 'FAIL' end);

  v_caught := false;
  begin
    insert into analytics.stock_lot (shop_id, product_id, source, unit_cost, qty_in, qty_remaining, received_on)
    values (v_shop, v_p_raw, 'opening', 10, 0, 0, current_date);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T4] qty_in=0 ถูกปฏิเสธ (CHECK > 0): %s\n', case when v_caught then 'OK' else 'FAIL' end);

  v_caught := false;
  begin
    insert into analytics.stock_lot (shop_id, product_id, source, unit_cost, qty_in, qty_remaining, received_on)
    values (v_shop, v_p_raw, 'stolen', 10, 5, 5, current_date);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T5] source=''stolen'' (นอก 3 ค่า) ถูกปฏิเสธ: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 3: derive-shop trigger — ข้ามร้าน (T6-T8) — ยังใช้ v_p_raw ต่อ
  -----------------------------------------------------------------------
  insert into analytics.stock_lot (shop_id, product_id, source, unit_cost, qty_in, qty_remaining, received_on)
  values (gen_random_uuid(), v_p_raw, 'opening', 10, 5, 5, current_date)
  returning id, shop_id into v_lot_id, v_lot_shop_id;
  v_log := v_log || format('[T6] insert shop_id มั่ว (gen_random_uuid) + product ของ v_shop ⇒ trigger เขียนทับเป็น shop_id จริง (ได้ %s คาด %s): %s\n',
    v_lot_shop_id, v_shop, case when v_lot_shop_id = v_shop then 'OK' else 'FAIL' end);

  v_caught := false;
  begin
    insert into analytics.stock_lot_consumption (shop_id, source_order_no, product_id, lot_id, qty)
    values (gen_random_uuid(), 'ZZ-ORDER-1', v_p_spot, v_lot_id, 1); -- v_lot เป็นของ v_p_raw ไม่ใช่ v_p_spot
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T7] stock_lot_consumption: product_id ไม่ตรงกับ lot จริง ถูกปฏิเสธ: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  insert into analytics.stock_lot_consumption (shop_id, source_order_no, product_id, lot_id, qty)
  values (gen_random_uuid(), 'ZZ-ORDER-2', v_p_raw, v_lot_id, 2)
  returning shop_id into v_lot2_id; -- reuse variable ชั่วคราวเพื่ออ่านค่ากลับ (uuid)
  v_log := v_log || format('[T8] stock_lot_consumption: product/lot ตรงกัน + shop_id มั่ว ⇒ trigger เขียนทับถูก (ได้ %s คาด %s): %s\n',
    v_lot2_id, v_shop, case when v_lot2_id = v_shop then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 4: grant/RLS ของ 2 ตาราง + 2 view ใหม่ (T9) — ห้ามผ่าน case 5
  -----------------------------------------------------------------------
  declare
    v_objs text[] := array['analytics.stock_lot', 'analytics.stock_lot_consumption', 'analytics.v_stock_lot', 'analytics.v_stock_lot_mismatch'];
    v_obj text;
    v_all_ok boolean := true;
    v_bad text := '';
  begin
    foreach v_obj in array v_objs loop
      select has_table_privilege('anon', v_obj, 'select') into v_priv_anon;
      select has_table_privilege('authenticated', v_obj, 'select') into v_priv_auth;
      select has_table_privilege('service_role', v_obj, 'select') into v_priv_svc;
      if v_priv_anon is distinct from false or v_priv_auth is distinct from false or v_priv_svc is distinct from true then
        v_all_ok := false;
        v_bad := v_bad || format('%s(anon=%s,auth=%s,svc=%s) ', v_obj, v_priv_anon, v_priv_auth, v_priv_svc);
      end if;
    end loop;

    select relrowsecurity into v_rls_enabled from pg_class where oid = 'analytics.stock_lot'::regclass;
    select count(*) into v_policy_count from pg_policies where schemaname = 'analytics' and tablename = 'stock_lot';
    if v_rls_enabled is distinct from true or v_policy_count <> 0 then
      v_all_ok := false;
      v_bad := v_bad || format('stock_lot RLS=%s policy_count=%s (คาด true/0) ', v_rls_enabled, v_policy_count);
    end if;

    select relrowsecurity into v_rls_enabled from pg_class where oid = 'analytics.stock_lot_consumption'::regclass;
    select count(*) into v_policy_count from pg_policies where schemaname = 'analytics' and tablename = 'stock_lot_consumption';
    if v_rls_enabled is distinct from true or v_policy_count <> 0 then
      v_all_ok := false;
      v_bad := v_bad || format('stock_lot_consumption RLS=%s policy_count=%s (คาด true/0) ', v_rls_enabled, v_policy_count);
    end if;

    if v_all_ok then
      v_log := v_log || '[T9] 2 ตาราง + 2 view: anon=false, authenticated=false, service_role=true, RLS enabled ไม่มี policy: OK' || E'\n';
    else
      v_log := v_log || format('[T9] FAIL: %s\n', v_bad);
    end if;
  end;

  -----------------------------------------------------------------------
  -- Part 5: production_order_done — ไม่ stamp cost กลับ product, สร้าง lot,
  -- idempotent (T10-T14)
  -----------------------------------------------------------------------
  select cost_type, unit_cost, track_stock, track_stock_since
    into v_before_cost_type, v_before_unit_cost, v_before_track, v_before_since
  from public.product where id = v_p_spot;

  v_res := analytics.production_order_save(v_shop, null, 'T10 spot lot', null);
  v_order_id := (v_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_order_id, v_p_spot, 5);
  v_item_id_spot := (v_item_res ->> 'id')::uuid;

  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_spot;
  v_log := v_log || format('[T10-pre] central_stock ก่อน done: %s (คาด null — ยังไม่มีแถว): %s\n', v_qty_on_hand, case when v_qty_on_hand is null then 'OK' else 'FAIL' end);

  perform analytics.production_order_done(v_shop, v_order_id, null, v_spot_price, null);

  select cost_type, unit_cost, track_stock, track_stock_since
    into v_after_cost_type, v_after_unit_cost, v_after_track, v_after_since
  from public.product where id = v_p_spot;

  v_log := v_log || format('[T10a] 🔴 cost_type ยังเป็น ''spot'' ไม่ถูก stamp เป็น ''fixed'' (ได้ %s): %s\n',
    v_after_cost_type, case when v_after_cost_type = 'spot' then 'OK' else 'FAIL — D1 ไม่ถูกปิด' end);
  v_log := v_log || format('[T10b] 🔴 unit_cost ไม่ถูกแตะ (ก่อน=%s หลัง=%s ต้องเท่ากัน): %s\n',
    v_before_unit_cost, v_after_unit_cost, case when v_before_unit_cost is distinct from v_after_unit_cost then 'FAIL — D1 ไม่ถูกปิด' else 'OK' end);
  v_log := v_log || format('[T10c] track_stock เปิดจริง + track_stock_since=วันนี้ (ได้ %s/%s): %s\n',
    v_after_track, v_after_since, case when v_after_track = true and v_after_since = (now() at time zone 'Asia/Bangkok')::date then 'OK' else 'FAIL' end);

  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_spot;
  v_log := v_log || format('[T10d] central_stock เข้าปกติ (ได้ %s คาด 5): %s\n', v_qty_on_hand, case when v_qty_on_hand = 5 then 'OK' else 'FAIL' end);

  select count(*) into v_lot_count from analytics.stock_lot where production_order_item_id = v_item_id_spot;
  select source, unit_cost, qty_in, qty_remaining
    into v_lot_source, v_lot_unit_cost, v_lot_qty_in, v_lot_qty_remaining
    from analytics.stock_lot where production_order_item_id = v_item_id_spot;
  v_log := v_log || format('[T10e] lot ถูกสร้าง 1 แถว (ได้ %s), source=%s, qty_in=qty_remaining=%s/%s, unit_cost=%s (คาด 10*72*0.925+20=686.00): %s\n',
    v_lot_count, v_lot_source, v_lot_qty_in, v_lot_qty_remaining, v_lot_unit_cost,
    case when v_lot_count = 1 and v_lot_source = 'production' and v_lot_qty_in = 5 and v_lot_qty_remaining = 5
      and v_lot_unit_cost = 686.00 then 'OK' else 'FAIL' end);

  -- T11: done ซ้ำ — idempotent, ไม่สร้าง lot ซ้ำ
  v_res := analytics.production_order_done(v_shop, v_order_id);
  select count(*) into v_lot_count from analytics.stock_lot where production_order_item_id = v_item_id_spot;
  v_log := v_log || format('[T11] done ซ้ำ already_done=%s (คาด true), lot ยังมีแค่ %s แถว (คาด 1): %s\n',
    v_res ->> 'already_done', v_lot_count,
    case when (v_res ->> 'already_done')::boolean and v_lot_count = 1 then 'OK' else 'FAIL' end);

  -- T12: fixed-cost SKU flow ปกติ ก็ต้องสร้าง lot ด้วย (ไม่ใช่แค่ spot)
  v_res := analytics.production_order_save(v_shop, null, 'T12 fixed lot', null);
  v_order_id := (v_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_order_id, v_p_fixed, 3);
  v_item_id_fixed := (v_item_res ->> 'id')::uuid;
  perform analytics.production_order_done(v_shop, v_order_id);

  select count(*) into v_lot_count from analytics.stock_lot where production_order_item_id = v_item_id_fixed;
  select source, unit_cost, qty_in, qty_remaining
    into v_lot_source, v_lot_unit_cost, v_lot_qty_in, v_lot_qty_remaining
    from analytics.stock_lot where production_order_item_id = v_item_id_fixed;
  v_log := v_log || format('[T12] fixed SKU ก็สร้าง lot เหมือนกัน (ได้ %s แถว, unit_cost=%s คาด 100, qty=%s คาด 3): %s\n',
    v_lot_count, v_lot_unit_cost, v_lot_qty_in,
    case when v_lot_count = 1 and v_lot_unit_cost = 100 and v_lot_qty_in = 3 then 'OK' else 'FAIL' end);

  -- 🔴 T12b (Tech Lead 19 ก.ย. 69): ด่านราคาเงิน fail-closed ของ 0132 ต้องยังทำงาน
  -- 0138 คัดลอก production_order_done มาทั้งตัว (~260 บรรทัด) — grep เจอข้อความ
  -- ของด่านอยู่จริง แต่ถ้า logic ถูกลอกเพี้ยนจะไม่มีใครรู้ ⇒ ต้องทดสอบพฤติกรรมจริง
  -- เคส: SKU โหมดราคาเงิน แต่ไม่ส่งราคาที่หน้าจอเห็นมา ⇒ ต้อง raise 22023 ห้ามผลิตผ่าน
  v_res := analytics.production_order_save(v_shop, null, 'T12b spot guard', null);
  v_order_id := (v_res ->> 'id')::uuid;
  perform analytics.production_order_item_set(v_shop, v_order_id, v_p_spot, 2);
  v_caught := false; v_code := null; v_msg := null;
  begin
    perform analytics.production_order_done(v_shop, v_order_id);
  exception when others then
    v_caught := true; get stacked diagnostics v_code = returned_sqlstate, v_msg = message_text;
  end;
  select count(*) into v_lot_count from analytics.stock_lot sl
    join analytics.production_order_item poi on poi.id = sl.production_order_item_id
   where poi.production_order_id = v_order_id;
  v_log := v_log || format('[T12b] 🔴 ด่านราคาเงินของ 0132 ยังปิดอยู่: ไม่ส่งราคาที่หน้าจอเห็น ⇒ raise=%s code=%s (คาด 22023), lot ที่ถูกสร้าง=%s (คาด 0): %s' || E'
',
    v_caught, coalesce(v_code,'(none)'), v_lot_count,
    case when v_caught and v_code = '22023' and v_lot_count = 0 then 'OK' else 'FAIL — ด่านของ 0132 หายระหว่างคัดลอก' end);

  -- T13: static — cost-stamp เดิมถูกเอาออกจริง + lot insert อยู่จริง + for update 2 ครั้ง
  select pg_get_functiondef('analytics.production_order_done(uuid,uuid,jsonb,numeric,uuid)'::regprocedure) into v_def;
  v_log := v_log || format('[T13a] ไม่มีการ stamp cost_type=''fixed''/unit_cost กลับ product แล้ว: %s\n',
    case when v_def not like '%set cost_type = ''fixed''%unit_cost = v_unit_cost%' then 'OK' else 'FAIL' end);
  v_log := v_log || format('[T13b] มี insert into analytics.stock_lot จริง: %s\n',
    case when v_def like '%insert into analytics.stock_lot%' then 'OK' else 'FAIL' end);

  -- 🔴 ใช้ 'for update;' (มี ; ปิดท้าย) ไม่ใช่แค่ 'for update' — ตัวฟังก์ชันจริงมี
  -- คอมเมนต์ที่พิมพ์คำว่า "for update" ปนอยู่ด้วย (บรรทัดอธิบาย ABBA fix) ซึ่งจะ
  -- ทำให้นับเกินเป็น 3 ถ้านับแค่ substring เปล่าๆ — เฉพาะ SQL clause จริงเท่านั้น
  -- ที่ตามด้วย ; ทันที
  select count(*) into v_fifo_lock_count from regexp_matches(v_def, 'for update;', 'g');
  v_log := v_log || format('[T13c] 🔴 ABBA fix: จำนวน ''for update;'' (SQL clause จริง ไม่นับคอมเมนต์) ในฟังก์ชัน = %s (คาด 2 — production_order lock + product lock ใหม่): %s\n',
    v_fifo_lock_count, case when v_fifo_lock_count = 2 then 'OK' else 'FAIL' end);

  -- T14: grant + ไม่มี overload
  select has_function_privilege('anon', 'analytics.production_order_done(uuid,uuid,jsonb,numeric,uuid)', 'execute') into v_priv_anon;
  select has_function_privilege('authenticated', 'analytics.production_order_done(uuid,uuid,jsonb,numeric,uuid)', 'execute') into v_priv_auth;
  select has_function_privilege('service_role', 'analytics.production_order_done(uuid,uuid,jsonb,numeric,uuid)', 'execute') into v_priv_svc;
  v_log := v_log || format('[T14] production_order_done grant anon=%s auth=%s svc=%s (คาด f/f/t), overload_count=%s (คาด 1): %s\n',
    v_priv_anon, v_priv_auth, v_priv_svc,
    (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'production_order_done'),
    case when v_priv_anon = false and v_priv_auth = false and v_priv_svc = true
      and (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'production_order_done') = 1
      then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 6: v_stock_lot / v_stock_lot_mismatch (T15-T16)
  -----------------------------------------------------------------------
  select sku_cost_avg_remaining into v_before_unit_cost -- reuse var
    from analytics.v_stock_lot where product_id = v_p_fixed limit 1;
  v_log := v_log || format('[T15] v_stock_lot: v_p_fixed sku_cost_avg_remaining=%s (คาด 100.00 — lot เดียว qty 3 @100): %s\n',
    v_before_unit_cost, case when v_before_unit_cost = 100.00 then 'OK' else 'FAIL' end);

  select mismatch_qty into v_mismatch_qty from analytics.v_stock_lot_mismatch where product_id = v_p_fixed;
  v_log := v_log || format('[T16a] v_stock_lot_mismatch: v_p_fixed ไม่ควรมีแถว (lot=on_hand=3) (ได้ %s): %s\n',
    coalesce(v_mismatch_qty::text, '(no row)'), case when v_mismatch_qty is null then 'OK' else 'FAIL' end);

  update public.central_stock set qty_on_hand = qty_on_hand + 10 where product_id = v_p_fixed; -- บังคับให้ mismatch จริง
  select mismatch_qty into v_mismatch_qty from analytics.v_stock_lot_mismatch where product_id = v_p_fixed;
  v_log := v_log || format('[T16b] บังคับ on_hand ให้ไม่ตรง lot (+10 นอกช่องทาง lot) ⇒ view จับได้ (ได้ mismatch_qty=%s คาด -10): %s\n',
    v_mismatch_qty, case when v_mismatch_qty = -10 then 'OK' else 'FAIL' end);
  update public.central_stock set qty_on_hand = qty_on_hand - 10 where product_id = v_p_fixed; -- คืนค่าเดิม (ทรานแซคชันนี้ rollback อยู่แล้ว แต่คืนเพื่อไม่ให้เทสต์ถัดไปในไฟล์นี้งง)

  -----------------------------------------------------------------------
  -- Part 7: v_dim_product — คอลัมน์ lot ใหม่ + effective_unit_cost ไม่เปลี่ยน (T17-T18)
  -----------------------------------------------------------------------
  select lot_qty_on_hand, lot_cost_avg, lot_count into v_qty_on_hand, v_before_unit_cost, v_lot_count
    from analytics.v_dim_product where product_id = v_p_fixed;
  v_log := v_log || format('[T17] v_dim_product.v_p_fixed: lot_qty_on_hand=%s (คาด 3), lot_cost_avg=%s (คาด 100.00), lot_count=%s (คาด 1): %s\n',
    v_qty_on_hand, v_before_unit_cost, v_lot_count,
    case when v_qty_on_hand = 3 and v_before_unit_cost = 100.00 and v_lot_count = 1 then 'OK' else 'FAIL' end);

  select string_agg(product_id::text || ':' || coalesce(effective_unit_cost::text, 'NULL'), ',' order by product_id)
    into v_after_dim_snapshot
  from analytics.v_dim_product
  where shop_id not in (v_shop, v_shop_ok, v_shop_bad);

  v_log := v_log || format('[T18] 🔴 v_dim_product.effective_unit_cost ของ SKU จริงทั้งหมด (ก่อน 0138) ตรงเป๊ะกับหลัง 0138 (%s แถว): %s\n',
    (select count(*) from analytics.v_dim_product where shop_id not in (v_shop, v_shop_ok, v_shop_bad)),
    case when v_before_dim_snapshot = v_after_dim_snapshot then 'OK' else 'FAIL — effective_unit_cost เปลี่ยน ตรวจ diff ด่วน' end);

  -----------------------------------------------------------------------
  -- Part 8: backfill logic (คัดลอกจาก do-block จริงใน 0138_stock_lot_tables.sql
  -- scope ด้วย shop_id สังเคราะห์ เพื่อไม่ให้ผลขึ้นกับสถานะข้อมูลจริง) (T19)
  -----------------------------------------------------------------------

  -- ทำให้ shop_ok มีสภาวะ: bf_ok track+on_hand=20 (ควร backfill), bf_notrack
  -- track=false (ไม่ควร), bf_zero track+on_hand=0 (ไม่ควร)
  update public.product set track_stock = true, track_stock_since = current_date - 5 where id = v_p_bf_ok;
  insert into public.central_stock (product_id, qty_on_hand) values (v_p_bf_ok, 20);

  update public.product set track_stock = false where id = v_p_bf_notrack;
  insert into public.central_stock (product_id, qty_on_hand) values (v_p_bf_notrack, 5);

  update public.product set track_stock = true, track_stock_since = current_date - 5 where id = v_p_bf_zero;
  insert into public.central_stock (product_id, qty_on_hand) values (v_p_bf_zero, 0);

  update public.product set track_stock = true, track_stock_since = current_date - 3 where id = v_p_bf_null;
  insert into public.central_stock (product_id, qty_on_hand) values (v_p_bf_null, 8);

  -- Scenario A (v_shop_ok): validation ต้องไม่เจออะไร (ไม่มี null cost ใน shop นี้)
  select string_agg(p.sku, ', ')
    into v_missing_cost_skus
  from public.product p
  join public.central_stock cs on cs.product_id = p.id
  join analytics.v_dim_product v on v.product_id = p.id
  where p.shop_id = v_shop_ok
    and p.track_stock
    and cs.qty_on_hand > 0
    and v.effective_unit_cost is null
    and not exists (select 1 from analytics.stock_lot sl where sl.product_id = p.id and sl.source = 'opening');

  v_log := v_log || format('[T19a] shop_ok validation: v_missing_cost_skus=%s (คาด null — ไม่มี SKU cost null ใน shop นี้): %s\n',
    coalesce(v_missing_cost_skus, '(null)'), case when v_missing_cost_skus is null then 'OK' else 'FAIL' end);

  insert into analytics.stock_lot (shop_id, product_id, source, unit_cost, qty_in, qty_remaining, received_on, note)
  select p.shop_id, p.id, 'opening', v.effective_unit_cost, cs.qty_on_hand, cs.qty_on_hand,
    coalesce(p.track_stock_since, (now() at time zone 'Asia/Bangkok')::date), 'backfill test'
  from public.product p
  join public.central_stock cs on cs.product_id = p.id
  join analytics.v_dim_product v on v.product_id = p.id
  where p.shop_id = v_shop_ok
    and p.track_stock
    and cs.qty_on_hand > 0
    and not exists (select 1 from analytics.stock_lot sl where sl.product_id = p.id and sl.source = 'opening');

  select count(*) into v_inserted_count from analytics.stock_lot where shop_id = v_shop_ok and source = 'opening';
  v_log := v_log || format('[T19b] shop_ok backfill: สร้าง opening lot %s แถว (คาด 1 — เฉพาะ bf_ok, ไม่ใช่ notrack/zero): %s\n',
    v_inserted_count, case when v_inserted_count = 1 then 'OK' else 'FAIL' end);

  select unit_cost, qty_in, qty_remaining, received_on
    into v_lot_unit_cost, v_lot_qty_in, v_lot_qty_remaining, v_lot_received_on
    from analytics.stock_lot where shop_id = v_shop_ok and source = 'opening' limit 1;
  v_log := v_log || format('[T19c] opening lot ของ bf_ok: unit_cost=%s (คาด 55.00), qty_in=qty_remaining=%s (คาด 20), received_on=%s (คาด track_stock_since): %s\n',
    v_lot_unit_cost, v_lot_qty_in, v_lot_received_on,
    case when v_lot_unit_cost = 55.00 and v_lot_qty_in = 20 and v_lot_qty_remaining = 20 and v_lot_received_on = current_date - 5 then 'OK' else 'FAIL' end);

  -- รัน insert เดิมซ้ำ (idempotency ของ backfill — not exists guard)
  insert into analytics.stock_lot (shop_id, product_id, source, unit_cost, qty_in, qty_remaining, received_on, note)
  select p.shop_id, p.id, 'opening', v.effective_unit_cost, cs.qty_on_hand, cs.qty_on_hand,
    coalesce(p.track_stock_since, (now() at time zone 'Asia/Bangkok')::date), 'backfill test rerun'
  from public.product p
  join public.central_stock cs on cs.product_id = p.id
  join analytics.v_dim_product v on v.product_id = p.id
  where p.shop_id = v_shop_ok
    and p.track_stock
    and cs.qty_on_hand > 0
    and not exists (select 1 from analytics.stock_lot sl where sl.product_id = p.id and sl.source = 'opening');

  select count(*) into v_inserted_count from analytics.stock_lot where shop_id = v_shop_ok and source = 'opening';
  v_log := v_log || format('[T19d] backfill รันซ้ำ (idempotent) ยังมีแค่ %s แถว (คาด 1 — ไม่ซ้ำ): %s\n',
    v_inserted_count, case when v_inserted_count = 1 then 'OK' else 'FAIL' end);

  -- Scenario B (v_shop_bad): validation ต้องเจอ bf_null แล้ว raise ⇒ ไม่ insert อะไรเลย
  v_caught := false; v_missing_cost_skus := null;
  begin
    select string_agg(p.sku, ', ')
      into v_missing_cost_skus
    from public.product p
    join public.central_stock cs on cs.product_id = p.id
    join analytics.v_dim_product v on v.product_id = p.id
    where p.shop_id = v_shop_bad
      and p.track_stock
      and cs.qty_on_hand > 0
      and v.effective_unit_cost is null
      and not exists (select 1 from analytics.stock_lot sl where sl.product_id = p.id and sl.source = 'opening');

    if v_missing_cost_skus is not null then
      raise exception 'stock_lot backfill: SKU ต่อไปนี้ effective_unit_cost เป็น null: %' using errcode = '22023';
    end if;
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T19e] 🔴 shop_bad: bf_null (effective_unit_cost=null) ทำให้ validation raise (ห้ามใส่ 0 เงียบๆ): %s\n',
    case when v_caught then 'OK' else 'FAIL — validation ไม่จับ null cost' end);

  select count(*) into v_inserted_count from analytics.stock_lot where shop_id = v_shop_bad;
  v_log := v_log || format('[T19f] shop_bad: ไม่มี lot ถูกสร้างเลยหลัง validation raise (ได้ %s แถว คาด 0): %s\n',
    v_inserted_count, case when v_inserted_count = 0 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 9: เคสห้ามพัง — production_order_cancel / adjust_stock ปกติ (T21-T22)
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop, null, 'T21 cancel regression', null);
  v_order_id := (v_res ->> 'id')::uuid;
  perform analytics.production_order_item_set(v_shop, v_order_id, v_p_fixed, 2);
  perform analytics.production_order_cancel(v_shop, v_order_id, 'ทดสอบ regression 0138');
  select status into v_before_cost_type from analytics.production_order where id = v_order_id; -- reuse var (text)
  v_log := v_log || format('[T21] production_order_cancel ยังทำงานปกติ (ไม่ถูกแตะโดย 0138) สถานะ=%s (คาด cancelled): %s\n',
    v_before_cost_type, case when v_before_cost_type = 'cancelled' then 'OK' else 'FAIL' end);

  v_caught := false;
  begin
    perform public.adjust_stock(v_shop, v_p_fixed, -100000, 'zz138-overselling-check');
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T22] adjust_stock ยัง reject การขายเกินสต็อกปกติ (ไม่ถูกแตะโดย 0138): %s\n',
    case when v_caught then 'OK' else 'FAIL' end);

  v_log := v_log || E'\n=== ALL CHECKS LOGGED ABOVE — ตรวจทุกบรรทัดหา FAIL (transaction จะ rollback เสมอ) ===\n';
  raise exception '%', v_log;
end $$;

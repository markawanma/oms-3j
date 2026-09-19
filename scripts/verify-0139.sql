-- scripts/verify-0139.sql
--
-- ชุดทดสอบของ supabase/migrations/0139_stock_lot_hardening.sql (ปิดหนี้
-- security ของ 0138 — stock_lot แก้/ลบอิสระ, production_order_done fail-open
-- ตอน insert lot ชนกัน, deadlock คู่ done×done, UUID รั่วในข้อความ error)
--
-- ตาม skill 3j-migration-traps #11: do $$ ... $$ block เดียว จบด้วย
-- `raise exception` เสมอ ⇒ ทั้ง transaction rollback ไม่ว่าผลจะผ่าน/ไม่ผ่าน —
-- อ่านผลจาก error message นี้. ใช้เป็นทั้ง dry-run (ก่อน apply 0139 จริง —
-- Part 0 ติดตั้ง trigger/ฟังก์ชันใหม่ของ 0139 ทับของเดิมในทรานแซคชันนี้เอง
-- สมมติว่า 0138 apply ไปแล้วจริงบน DB เป้าหมาย — ไม่ต้องลอก DDL ของ 0138 มา
-- ซ้ำเหมือน verify-0138.sql เพราะ 0138 "apply แล้ว" ตาม git log) และ post-apply
-- verify (รันซ้ำหลัง apply จริงผ่าน MCP apply_migration — ทุกอย่างใน Part 0
-- เป็น idempotent: create or replace function/trigger, drop+create trigger,
-- revoke/grant — รันซ้ำได้ปลอดภัย)
--
-- 💰 แตะต้นทุนที่ล็อกถาวร + สต็อก + ledger — shop/SKU สังเคราะห์ทั้งหมด (prefix
-- ZZ139) สร้างขึ้นในทรานแซคชันนี้เอง ไม่แตะ shop/SKU จริงเลย
--
-- ⚠️ TRUNCATE guard (§1 ของ 0139): ไม่รัน `truncate analytics.stock_lot` ตรงๆ
-- แม้จะอยู่ใน do-block ที่ rollback เสมอ — เลือกพิสูจน์ด้วย static check แทน
-- (grant-level: has_table_privilege('service_role', ..., 'truncate') ต้องเป็น
-- false ซึ่งบล็อก TRUNCATE ได้เองอยู่แล้วก่อนถึง trigger ด้วยซ้ำ + ยืนยันว่า
-- trigger ผูกอยู่จริงใน pg_trigger) เพราะไม่มี precedent ในรีโปที่ทดสอบ TRUNCATE
-- ตรงบนตารางที่มีข้อมูลจริงอยู่ (ต่างจาก UPDATE/DELETE ที่ทดสอบผ่าน begin/
-- exception เป็นปกติ) — เลือกความระมัดระวังสูงสุดตามหลัก skill ข้อ 11
--
-- โครงสร้างไฟล์:
--   Part 0  — apply 0139 DDL verbatim (3 กลุ่ม: stock_lot hardening,
--             trigger UUID redaction, production_order_done 3 fixes)
--   Part 1  — setup: shop 2 ร้าน (สลับ shop_id ทดสอบ) + SKU สังเคราะห์
--   Part 2  — analytics.stock_lot deny_mutation: ห้ามผ่าน #1/#2 (T1-T2i)
--   Part 3  — analytics.stock_lot deny_mutation: ห้ามพัง — qty_remaining แก้ได้
--             + updated_at ขยับจริง (T3), DELETE ถูกปฏิเสธ (T4)
--   Part 4  — production_order_done fail-open → fail-closed: จำลอง lot ค้าง
--             อยู่ก่อน done แล้วธุรกรรมต้องถอยทั้งก้อน (T5)
--   Part 5  — static: v_work jsonb_agg เรียงตาม product_id (T6), advisory
--             lock key ถูกต้อง + ไม่ชนกับ fact_order family (T7)
--   Part 6  — trigger error message ไม่มี UUID หลุด (T8a-T8d)
--   Part 7  — เคสห้ามพัง: production_order_done ปกติ fixed+spot (T9),
--             0132 fail-closed spot gate ยังทำงาน (T10), done ซ้ำ idempotent
--             (T11), production_order_cancel/save/item_set ไม่ถูกแตะ (T12)
--   Part 8  — grant/overload ของ production_order_done (T13), TRUNCATE guard
--             แบบ static (T14)
--   Part 9  — v_dim_product.effective_unit_cost ของ SKU จริงไม่ขยับ (T15)

do $$
declare
  v_log text := E'\n=== verify 0139 (stock_lot hardening + production_order_done fixes) ===\n';

  v_before_dim_snapshot text;
  v_after_dim_snapshot  text;

  v_shop  uuid := gen_random_uuid();
  v_shop2 uuid := gen_random_uuid(); -- ใช้เฉพาะเป็นเป้า "เปลี่ยน shop_id" ใน T2d

  v_p_raw        uuid; -- Part 2-3: unit_cost/qty_in/source/product_id/note/received_on/id/created_at + delete + qty_remaining
  v_p_raw_target uuid; -- Part 2: เป้าที่ถูกต้อง (valid FK) สำหรับทดสอบเปลี่ยน product_id (T2c)
  v_p_item_a     uuid; -- Part 2: SKU สำหรับ item guard (T2e — เปลี่ยน production_order_item_id)
  v_p_item_b     uuid; -- Part 2: SKU สำหรับ item guard ตัวที่สอง (เป้าสลับของ T2e)
  v_p_conflict   uuid; -- Part 4: fail-open→fail-closed guard
  v_p_fixed_ok   uuid; -- Part 7: fixed flow สะอาด (ไม่ปนกับ Part 2-4)
  v_p_spot_ok    uuid; -- Part 7: spot flow สะอาด (ใช้ซ้ำ T9/T10/T11)

  v_spot_price numeric := 72;

  v_lot_id_guard  uuid; -- Part 2: แถวทดสอบคอลัมน์ของตาย (unit_cost/qty_in/source/product_id/shop_id/note/received_on/id/created_at)
  v_lot_id_item   uuid; -- Part 2: แถวทดสอบ production_order_item_id (T2e)
  v_lot_id_qty    uuid; -- Part 3: แถวทดสอบ qty_remaining (T3)
  v_lot_id_raw    uuid; -- Part 6: แถวสำหรับทดสอบ mismatch message ของ consumption trigger
  v_backdated     timestamptz;

  v_order_id      uuid; -- scratch ใช้ซ้ำหลายที่
  v_item_id       uuid; -- scratch ใช้ซ้ำหลายที่
  v_res           jsonb;
  v_item_res      jsonb;

  v_order_guard2   uuid;
  v_item_id_guard2a uuid;
  v_item_id_guard2b uuid;

  v_order_conflict uuid;
  v_item_id_conflict uuid;

  v_order_fixed uuid; v_item_id_fixed uuid;
  v_order_spot  uuid; v_item_id_spot  uuid;
  v_order_gate  uuid;

  v_caught boolean;
  v_code   text;
  v_msg    text;

  v_qty_after      int;
  v_updated_after  timestamptz;

  v_track_before boolean; v_track_after boolean;
  v_stock_before int;     v_stock_after int;
  v_status_after text;
  v_lot_count    int;

  v_def text;
  v_pos_orderby   int;
  v_pos_into_work int;
  v_pos_lock_new  int;
  v_pos_lock_old  int;

  v_priv_anon          boolean;
  v_priv_auth          boolean;
  v_priv_svc_select    boolean;
  v_priv_svc_insert    boolean;
  v_priv_svc_update    boolean;
  v_priv_svc_delete    boolean;
  v_priv_svc_truncate  boolean;

  v_trunc_trigger_count int;
  v_overload_count      int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -----------------------------------------------------------------------
  -- 🔴 snapshot v_dim_product.effective_unit_cost ของ SKU จริงทั้งหมด
  -- ก่อนแตะอะไรเลย — ใช้เทียบใน T15 (0139 ไม่แตะ v_dim_product/production_
  -- cost_calc เลย ควรเหมือนเดิมเป๊ะ)
  -----------------------------------------------------------------------
  select string_agg(product_id::text || ':' || coalesce(effective_unit_cost::text, 'NULL'), ',' order by product_id)
    into v_before_dim_snapshot
  from analytics.v_dim_product;

  -----------------------------------------------------------------------
  -- Part 0: apply 0139's DDL verbatim (สมมติ 0138 apply แล้วจริงบน DB
  -- เป้าหมาย — ตาม git log "0138 apply แล้ว" ก่อน 0139 นี้เสมอ)
  -----------------------------------------------------------------------

  -- §1: stock_lot updated_at + deny_mutation + deny_truncate + แคบ grant
  execute $ddl_lot$
    drop trigger if exists trg_stock_lot_updated_at on analytics.stock_lot;
    create trigger trg_stock_lot_updated_at
      before update on analytics.stock_lot
      for each row execute function public.set_updated_at();

    create or replace function analytics.stock_lot_deny_mutation()
     returns trigger
     language plpgsql
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $f_deny$
    begin
      if tg_op = 'DELETE' then
        raise exception 'stock_lot: ห้ามลบ lot ต้นทุน — ต้นทุนตามรอบผลิตต้องคงอยู่ตลอดไปเป็นหลักฐานย้อนหลัง' using errcode = '22023';
      end if;

      if new.id                       is distinct from old.id
         or new.shop_id                is distinct from old.shop_id
         or new.product_id             is distinct from old.product_id
         or new.source                 is distinct from old.source
         or new.unit_cost              is distinct from old.unit_cost
         or new.qty_in                 is distinct from old.qty_in
         or new.received_on            is distinct from old.received_on
         or new.production_order_item_id is distinct from old.production_order_item_id
         or new.note                   is distinct from old.note
         or new.created_at             is distinct from old.created_at
      then
        raise exception 'stock_lot: แก้ได้เฉพาะ qty_remaining เท่านั้น (ต้นทุน/จำนวนรับเข้า/แหล่งที่มา/SKU/ร้าน/ใบผลิตอ้างอิง/หมายเหตุ/วันที่รับเข้า ล็อกถาวรตั้งแต่สร้าง lot)' using errcode = '22023';
      end if;

      return new;
    end;
    $f_deny$;

    revoke execute on function analytics.stock_lot_deny_mutation() from public, anon, authenticated;

    drop trigger if exists trg_stock_lot_deny_mutation on analytics.stock_lot;
    create trigger trg_stock_lot_deny_mutation
      before update or delete on analytics.stock_lot
      for each row execute function analytics.stock_lot_deny_mutation();

    create or replace function analytics.stock_lot_deny_truncate()
     returns trigger
     language plpgsql
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $f_trunc$
    begin
      raise exception 'stock_lot: ห้าม TRUNCATE ตาราง % — ต้นทุนตามรอบผลิตต้องคงอยู่ตลอดไปเป็นหลักฐานย้อนหลัง ไม่มีคำสั่งลบทั้งตาราง', tg_table_name
        using errcode = '22023';
    end;
    $f_trunc$;

    revoke execute on function analytics.stock_lot_deny_truncate() from public, anon, authenticated;

    drop trigger if exists trg_stock_lot_deny_truncate on analytics.stock_lot;
    create trigger trg_stock_lot_deny_truncate
      before truncate on analytics.stock_lot
      for each statement execute function analytics.stock_lot_deny_truncate();

    revoke all on analytics.stock_lot from service_role;
    grant select, insert, update on analytics.stock_lot to service_role;
  $ddl_lot$;

  -- §2: derive_shop trigger — เลิกปล่อย UUID ดิบสู่ข้อความ error
  execute $ddl_redact$
    create or replace function analytics.stock_lot_derive_shop()
     returns trigger
     language plpgsql
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $f_derive1$
    declare
      v_product_shop_id uuid;
    begin
      select shop_id into v_product_shop_id from public.product where id = new.product_id;
      if v_product_shop_id is null then
        raise warning 'stock_lot_derive_shop: product_id=% ไม่พบใน public.product (insert/update ถูกปฏิเสธ)', new.product_id;
        raise exception 'stock_lot: ไม่พบ SKU ที่อ้างอิง — ตรวจสอบว่า SKU นี้ยังมีอยู่ในระบบและไม่ได้ถูกลบไป' using errcode = '22023';
      end if;
      new.shop_id := v_product_shop_id;
      return new;
    end;
    $f_derive1$;

    revoke execute on function analytics.stock_lot_derive_shop() from public, anon, authenticated;

    drop trigger if exists trg_stock_lot_derive_shop on analytics.stock_lot;
    create trigger trg_stock_lot_derive_shop
      before insert or update of product_id on analytics.stock_lot
      for each row execute function analytics.stock_lot_derive_shop();

    create or replace function analytics.stock_lot_consumption_derive_shop()
     returns trigger
     language plpgsql
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $f_derive2$
    declare
      v_product_shop_id uuid;
      v_lot_shop_id     uuid;
      v_lot_product_id  uuid;
    begin
      select shop_id into v_product_shop_id from public.product where id = new.product_id;
      if v_product_shop_id is null then
        raise warning 'stock_lot_consumption_derive_shop: product_id=% ไม่พบใน public.product', new.product_id;
        raise exception 'stock_lot_consumption: ไม่พบ SKU ที่อ้างอิง — ตรวจสอบว่า SKU นี้ยังมีอยู่ในระบบ' using errcode = '22023';
      end if;

      select shop_id, product_id into v_lot_shop_id, v_lot_product_id
        from analytics.stock_lot where id = new.lot_id;
      if v_lot_shop_id is null then
        raise warning 'stock_lot_consumption_derive_shop: lot_id=% ไม่พบใน analytics.stock_lot', new.lot_id;
        raise exception 'stock_lot_consumption: ไม่พบ lot ต้นทุนที่อ้างอิง — ตรวจสอบว่า lot นี้ยังมีอยู่ในระบบ' using errcode = '22023';
      end if;
      if v_lot_shop_id <> v_product_shop_id or v_lot_product_id <> new.product_id then
        raise warning 'stock_lot_consumption_derive_shop: lot_id=% (shop=%,product=%) ไม่ตรงกับ product_id=% (shop=%) ที่ระบุ',
          new.lot_id, v_lot_shop_id, v_lot_product_id, new.product_id, v_product_shop_id;
        raise exception 'stock_lot_consumption: lot ต้นทุนที่ระบุไม่ตรงกับ SKU/ร้านของรายการนี้' using errcode = '22023';
      end if;

      new.shop_id := v_product_shop_id;
      return new;
    end;
    $f_derive2$;

    revoke execute on function analytics.stock_lot_consumption_derive_shop() from public, anon, authenticated;

    drop trigger if exists trg_stock_lot_consumption_derive_shop on analytics.stock_lot_consumption;
    create trigger trg_stock_lot_consumption_derive_shop
      before insert or update of product_id, lot_id on analytics.stock_lot_consumption
      for each row execute function analytics.stock_lot_consumption_derive_shop();
  $ddl_redact$;

  -- §3: production_order_done — signature เดิม (uuid,uuid,jsonb,numeric,uuid)
  -- body คัดลอกจาก supabase/migrations/0139_stock_lot_hardening.sql คำต่อคำ
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
      v_lot_inserted   int;
    begin
      if p_shop_id is null or p_production_order_id is null then
        raise exception 'production_order_done: p_shop_id and p_production_order_id are required';
      end if;
      if p_items is not null and jsonb_typeof(p_items) <> 'array' then
        raise exception 'production_order_done: p_items ต้องเป็น json array' using errcode = '22023';
      end if;

      perform analytics.crm_require_owner_admin(p_shop_id);

      perform pg_advisory_xact_lock(hashtext('analytics.production_order_done:' || p_shop_id::text));

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
        ) order by poi.product_id), '[]'::jsonb)
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

        get diagnostics v_lot_inserted = row_count;
        if v_lot_inserted = 0 then
          raise exception 'production_order_done: พบ lot ต้นทุนของ SKU % ผูกกับรายการนี้อยู่ก่อนแล้ว (ใบ %) — ข้อมูลไม่สอดคล้องกัน ห้ามลองกดใหม่เอง แจ้งทีมพัฒนาก่อน', v_product.sku, v_order.po_no using errcode = '22023';
        end if;

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

  v_log := v_log || '[Part 0] apply 0139 DDL verbatim (stock_lot hardening + 2 trigger fn redaction + production_order_done): OK (no error)' || E'\n';

  -----------------------------------------------------------------------
  -- Part 1: setup
  -----------------------------------------------------------------------
  insert into public.shop (id, name) values (v_shop, 'ZZ TEST verify-0139');
  insert into public.shop (id, name) values (v_shop2, 'ZZ TEST verify-0139 shop2 (swap target)');

  v_p_raw        := analytics.product_upsert(v_shop, 'ZZ139-RAW',    'ทดสอบคอลัมน์ของตาย',        null, 'fixed', 10, null, null, null, null, null, null, null, true);
  v_p_raw_target := analytics.product_upsert(v_shop, 'ZZ139-TARGET', 'เป้าเปลี่ยน product_id',     null, 'fixed', 15, null, null, null, null, null, null, null, true);
  v_p_item_a     := analytics.product_upsert(v_shop, 'ZZ139-ITEMA',  'ทดสอบ item_id (ต้นทาง)',     null, 'fixed', 20, null, null, null, null, null, null, null, true);
  v_p_item_b     := analytics.product_upsert(v_shop, 'ZZ139-ITEMB',  'ทดสอบ item_id (ปลายทาง)',    null, 'fixed', 25, null, null, null, null, null, null, null, true);
  v_p_conflict   := analytics.product_upsert(v_shop, 'ZZ139-CONF',   'ทดสอบ fail-open→fail-closed', null, 'fixed', 30, null, null, null, null, null, null, null, true);
  v_p_fixed_ok   := analytics.product_upsert(v_shop, 'ZZ139-FIXOK',  'flow ปกติ fixed',            null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_spot_ok    := analytics.product_upsert(v_shop, 'ZZ139-SPOTOK', 'flow ปกติ spot',             null, 'spot', null, 10, 0.925, 20, null, null, null, null, true);

  perform analytics.oem_metal_price_set(v_shop, 'silver', v_spot_price, (now() at time zone 'Asia/Bangkok')::date, 'manual');

  v_log := v_log || '[Part 1] setup 2 shop + 7 SKU สังเคราะห์ (prefix ZZ139): OK' || E'\n';

  -----------------------------------------------------------------------
  -- Part 2: stock_lot deny_mutation — ห้ามผ่าน #1/#2 (T1-T2i) ทีละคอลัมน์
  -----------------------------------------------------------------------
  insert into analytics.stock_lot (shop_id, product_id, source, unit_cost, qty_in, qty_remaining, received_on, note)
  values (v_shop, v_p_raw, 'opening', 50, 10, 10, current_date, 'T139 guard row')
  returning id into v_lot_id_guard;

  -- T1: unit_cost
  v_caught := false; v_code := null;
  begin
    update analytics.stock_lot set unit_cost = 99999 where id = v_lot_id_guard;
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_log := v_log || format('[T1] update unit_cost ถูกปฏิเสธ (errcode=%s คาด 22023): %s\n',
    coalesce(v_code, '(none)'), case when v_caught and v_code = '22023' then 'OK' else 'FAIL' end);

  -- T2a: qty_in
  v_caught := false; v_code := null;
  begin
    update analytics.stock_lot set qty_in = 999 where id = v_lot_id_guard;
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_log := v_log || format('[T2a] update qty_in ถูกปฏิเสธ (errcode=%s): %s\n',
    coalesce(v_code, '(none)'), case when v_caught and v_code = '22023' then 'OK' else 'FAIL' end);

  -- T2b: source (สลับเป็นค่า enum ที่ valid — 'purchase' — เพื่อแยกให้ชัดว่า
  -- โดน deny_mutation ปฏิเสธ ไม่ใช่โดน CHECK constraint)
  v_caught := false; v_code := null;
  begin
    update analytics.stock_lot set source = 'purchase' where id = v_lot_id_guard;
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_log := v_log || format('[T2b] update source (ค่า valid ''purchase'') ถูกปฏิเสธ (errcode=%s): %s\n',
    coalesce(v_code, '(none)'), case when v_caught and v_code = '22023' then 'OK' else 'FAIL' end);

  -- T2c: product_id (เปลี่ยนไปยัง SKU อื่นที่มีอยู่จริง — valid FK — ยืนยันว่า
  -- โดน deny_mutation ปฏิเสธก่อนถึง derive_shop trigger)
  v_caught := false; v_code := null;
  begin
    update analytics.stock_lot set product_id = v_p_raw_target where id = v_lot_id_guard;
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_log := v_log || format('[T2c] update product_id (เป้า valid) ถูกปฏิเสธ (errcode=%s): %s\n',
    coalesce(v_code, '(none)'), case when v_caught and v_code = '22023' then 'OK' else 'FAIL' end);

  -- T2d: shop_id (เปลี่ยนไปยัง shop สังเคราะห์อีกอันที่มีอยู่จริง)
  v_caught := false; v_code := null;
  begin
    update analytics.stock_lot set shop_id = v_shop2 where id = v_lot_id_guard;
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_log := v_log || format('[T2d] update shop_id (เป้า valid) ถูกปฏิเสธ (errcode=%s): %s\n',
    coalesce(v_code, '(none)'), case when v_caught and v_code = '22023' then 'OK' else 'FAIL' end);

  -- 🔴 ตัดสินใจเอง (D1/D2 ในหัวไฟล์ migration) — note/received_on/id/created_at
  -- ไม่ได้อยู่ใน 6 คอลัมน์ที่บรีฟระบุ แต่ตัดสินใจล็อกด้วย ต้องพิสูจน์ว่าล็อกจริง
  -- T2f: note
  v_caught := false; v_code := null;
  begin
    update analytics.stock_lot set note = 'แก้แล้ว' where id = v_lot_id_guard;
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_log := v_log || format('[T2f] 🔴(D1) update note ถูกปฏิเสธ (errcode=%s): %s\n',
    coalesce(v_code, '(none)'), case when v_caught and v_code = '22023' then 'OK' else 'FAIL' end);

  -- T2g: received_on
  v_caught := false; v_code := null;
  begin
    update analytics.stock_lot set received_on = current_date - 30 where id = v_lot_id_guard;
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_log := v_log || format('[T2g] 🔴(D1) update received_on ถูกปฏิเสธ (errcode=%s — received_on กำหนดลำดับ FIFO): %s\n',
    coalesce(v_code, '(none)'), case when v_caught and v_code = '22023' then 'OK' else 'FAIL' end);

  -- T2h: id (PK)
  v_caught := false; v_code := null;
  begin
    update analytics.stock_lot set id = gen_random_uuid() where id = v_lot_id_guard;
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_log := v_log || format('[T2h] 🔴(D2) update id (PK) ถูกปฏิเสธ (errcode=%s): %s\n',
    coalesce(v_code, '(none)'), case when v_caught and v_code = '22023' then 'OK' else 'FAIL' end);

  -- T2i: created_at
  v_caught := false; v_code := null;
  begin
    update analytics.stock_lot set created_at = now() - interval '10 days' where id = v_lot_id_guard;
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_log := v_log || format('[T2i] 🔴(D2) update created_at ถูกปฏิเสธ (errcode=%s): %s\n',
    coalesce(v_code, '(none)'), case when v_caught and v_code = '22023' then 'OK' else 'FAIL' end);

  -- T2e: production_order_item_id — ต้องใช้แถวที่มีค่านี้ไม่ null อยู่ก่อนแล้ว
  -- (v_lot_id_guard มีค่า null ⇒ set null ซ้ำจะไม่ถือว่า "เปลี่ยน" ตาม IS
  -- DISTINCT FROM) — สร้างใบผลิต 2 รายการแยกไว้เป็นเป้าสลับ
  v_res := analytics.production_order_save(v_shop, null, 'T139 guard item_id column test', null);
  v_order_guard2 := (v_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_order_guard2, v_p_item_a, 2);
  v_item_id_guard2a := (v_item_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_order_guard2, v_p_item_b, 3);
  v_item_id_guard2b := (v_item_res ->> 'id')::uuid;

  insert into analytics.stock_lot (shop_id, product_id, source, unit_cost, qty_in, qty_remaining, received_on, production_order_item_id, note)
  values (v_shop, v_p_item_a, 'production', 20, 2, 2, current_date, v_item_id_guard2a, 'T139 guard row มี item_id')
  returning id into v_lot_id_item;

  v_caught := false; v_code := null;
  begin
    update analytics.stock_lot set production_order_item_id = v_item_id_guard2b where id = v_lot_id_item;
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_log := v_log || format('[T2e] update production_order_item_id (สลับไปแถวอื่นที่ valid) ถูกปฏิเสธ (errcode=%s): %s\n',
    coalesce(v_code, '(none)'), case when v_caught and v_code = '22023' then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 3: ห้ามพัง — qty_remaining แก้ได้ + updated_at ขยับจริง (T3),
  -- DELETE ถูกปฏิเสธเสมอ (T4)
  -----------------------------------------------------------------------
  -- 🔴 ทั้งทรานแซคชันนี้ now() คืนค่าเดียวกันตลอด (transaction_timestamp) —
  -- เทียบ updated_at ว่า "ขยับ" ด้วยการ backdate ตอน insert แล้วดูว่าถูกเขียน
  -- ทับเป็นค่าปัจจุบันหลัง UPDATE ไม่ใช่เทียบกับเวลาจริงที่ผ่านไป
  v_backdated := now() - interval '1 day';
  insert into analytics.stock_lot (shop_id, product_id, source, unit_cost, qty_in, qty_remaining, received_on, updated_at)
  values (v_shop, v_p_raw, 'opening', 10, 5, 5, current_date, v_backdated)
  returning id into v_lot_id_qty;

  update analytics.stock_lot set qty_remaining = qty_remaining - 1 where id = v_lot_id_qty;
  select qty_remaining, updated_at into v_qty_after, v_updated_after from analytics.stock_lot where id = v_lot_id_qty;
  v_log := v_log || format('[T3] update qty_remaining ผ่านจริง (ได้ %s คาด 4) และ updated_at ขยับจาก backdated (ได้ %s > %s): %s\n',
    v_qty_after, v_updated_after, v_backdated,
    case when v_qty_after = 4 and v_updated_after > v_backdated then 'OK' else 'FAIL' end);

  -- T4: DELETE ปฏิเสธเสมอ (ใช้ v_lot_id_guard ที่ยังไม่ถูกแตะจริงเลย เพราะทุก
  -- UPDATE ใน Part 2 ถูกปฏิเสธหมด แถวยังเป็นค่าดั้งเดิม)
  v_caught := false; v_code := null;
  begin
    delete from analytics.stock_lot where id = v_lot_id_guard;
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  select count(*) into v_lot_count from analytics.stock_lot where id = v_lot_id_guard;
  v_log := v_log || format('[T4] delete stock_lot ถูกปฏิเสธ (errcode=%s), แถวยังอยู่ (ได้ %s แถว คาด 1): %s\n',
    coalesce(v_code, '(none)'), v_lot_count,
    case when v_caught and v_code = '22023' and v_lot_count = 1 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 4: production_order_done fail-open → fail-closed (T5) — จำลอง
  -- สถานะ "มี lot ผูก item นี้อยู่ก่อนแล้ว แต่ใบยัง open" (เคสข้อมูลเพี้ยน/แก้
  -- นอกช่องทาง RPC ที่ 0138 ปล่อยผ่านแบบเงียบๆ)
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop, null, 'T5 fail-open guard', null);
  v_order_conflict := (v_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_order_conflict, v_p_conflict, 4);
  v_item_id_conflict := (v_item_res ->> 'id')::uuid;

  -- จำลอง lot ที่ค้างอยู่ก่อน (ไม่ได้เกิดจาก production_order_done จริง —
  -- insert ตรงเพื่อจำลองสถานะที่ไม่ควรเกิดได้ในทางปกติ)
  insert into analytics.stock_lot (shop_id, product_id, source, unit_cost, qty_in, qty_remaining, received_on, production_order_item_id, note)
  values (v_shop, v_p_conflict, 'production', 999.99, 4, 4, current_date, v_item_id_conflict, 'T5: จำลอง lot ค้างอยู่ก่อน (ข้อมูลเพี้ยน)');

  select track_stock into v_track_before from public.product where id = v_p_conflict;
  select qty_on_hand into v_stock_before from public.central_stock where product_id = v_p_conflict;

  v_caught := false; v_code := null; v_msg := null;
  begin
    perform analytics.production_order_done(v_shop, v_order_conflict);
  exception when others then
    v_caught := true; get stacked diagnostics v_code = returned_sqlstate, v_msg = message_text;
  end;

  select status into v_status_after from analytics.production_order where id = v_order_conflict;
  select track_stock into v_track_after from public.product where id = v_p_conflict;
  select qty_on_hand into v_stock_after from public.central_stock where product_id = v_p_conflict;
  select count(*) into v_lot_count from analytics.stock_lot where production_order_item_id = v_item_id_conflict;

  v_log := v_log || format('[T5a] 🔴 done บนใบที่มี lot ผูก item อยู่ก่อนแล้ว raise=%s code=%s (คาด 22023): %s\n',
    v_caught, coalesce(v_code, '(none)'), case when v_caught and v_code = '22023' then 'OK' else 'FAIL — fail-open ยังไม่ถูกปิด' end);
  v_log := v_log || format('[T5b] ทั้งธุรกรรมถอย: order status ยังเป็น %s (คาด open), track_stock ยังเป็น %s (คาด false), central_stock qty_on_hand ยังเป็น %s (คาด null — ไม่มีแถว), lot ยังมีแค่ %s แถว (คาด 1 — ไม่ซ้ำ): %s\n',
    v_status_after, v_track_after, coalesce(v_stock_after::text, 'NULL'), v_lot_count,
    case when v_status_after = 'open' and v_track_after = false and v_stock_after is null
      and coalesce(v_track_before, false) = false and v_stock_before is null and v_lot_count = 1
    then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 5: static — v_work jsonb_agg เรียงตาม product_id (T6), advisory
  -- lock key ถูกต้อง + ไม่ชนกับ fact_order family (T7)
  -----------------------------------------------------------------------
  select pg_get_functiondef('analytics.production_order_done(uuid,uuid,jsonb,numeric,uuid)'::regprocedure) into v_def;

  v_pos_orderby   := position('order by poi.product_id' in v_def);
  v_pos_into_work := position('into v_work' in v_def);
  v_log := v_log || format('[T6] v_work jsonb_agg มี ''order by poi.product_id'' (pos=%s) ก่อน ''into v_work'' (pos=%s): %s\n',
    v_pos_orderby, v_pos_into_work,
    case when v_pos_orderby > 0 and v_pos_into_work > 0 and v_pos_orderby < v_pos_into_work then 'OK' else 'FAIL' end);

  v_pos_lock_new := position('hashtext(''analytics.production_order_done:''' in v_def);
  v_pos_lock_old := position('hashtext(''analytics.fact_order:''' in v_def);
  v_log := v_log || format('[T7] advisory lock key = ''analytics.production_order_done:'' (pos=%s), ไม่มี ''analytics.fact_order:'' โผล่ในฟังก์ชันนี้ (pos=%s คาด 0): %s\n',
    v_pos_lock_new, v_pos_lock_old,
    case when v_pos_lock_new > 0 and v_pos_lock_old = 0 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 6: trigger error message ไม่มี UUID หลุด (T8a-T8d) — เทียบด้วย regex
  -- UUID มาตรฐาน 8-4-4-4-12
  -----------------------------------------------------------------------
  -- T8a: stock_lot_derive_shop — product ไม่มีจริง
  v_caught := false; v_msg := null;
  begin
    insert into analytics.stock_lot (shop_id, product_id, source, unit_cost, qty_in, qty_remaining, received_on)
    values (v_shop, gen_random_uuid(), 'opening', 10, 1, 1, current_date);
  exception when others then v_caught := true; get stacked diagnostics v_msg = message_text;
  end;
  v_log := v_log || format('[T8a] stock_lot_derive_shop (product ไม่พบ) ข้อความไม่มี UUID (msg=%s): %s\n',
    v_msg, case when v_caught and v_msg !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' then 'OK' else 'FAIL' end);

  -- T8b: stock_lot_consumption_derive_shop — product ไม่มีจริง
  v_caught := false; v_msg := null;
  begin
    insert into analytics.stock_lot_consumption (shop_id, source_order_no, product_id, lot_id, qty)
    values (v_shop, 'ZZ139-ORDER-1', gen_random_uuid(), v_lot_id_guard, 1);
  exception when others then v_caught := true; get stacked diagnostics v_msg = message_text;
  end;
  v_log := v_log || format('[T8b] stock_lot_consumption_derive_shop (product ไม่พบ) ข้อความไม่มี UUID (msg=%s): %s\n',
    v_msg, case when v_caught and v_msg !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' then 'OK' else 'FAIL' end);

  -- T8c: stock_lot_consumption_derive_shop — lot ไม่มีจริง
  v_caught := false; v_msg := null;
  begin
    insert into analytics.stock_lot_consumption (shop_id, source_order_no, product_id, lot_id, qty)
    values (v_shop, 'ZZ139-ORDER-2', v_p_raw, gen_random_uuid(), 1);
  exception when others then v_caught := true; get stacked diagnostics v_msg = message_text;
  end;
  v_log := v_log || format('[T8c] stock_lot_consumption_derive_shop (lot ไม่พบ) ข้อความไม่มี UUID (msg=%s): %s\n',
    v_msg, case when v_caught and v_msg !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' then 'OK' else 'FAIL' end);

  -- T8d: stock_lot_consumption_derive_shop — lot มีจริงแต่ไม่ตรง SKU (v_lot_id_guard เป็นของ v_p_raw ไม่ใช่ v_p_raw_target)
  v_caught := false; v_msg := null;
  begin
    insert into analytics.stock_lot_consumption (shop_id, source_order_no, product_id, lot_id, qty)
    values (v_shop, 'ZZ139-ORDER-3', v_p_raw_target, v_lot_id_guard, 1);
  exception when others then v_caught := true; get stacked diagnostics v_msg = message_text;
  end;
  v_log := v_log || format('[T8d] stock_lot_consumption_derive_shop (lot ไม่ตรง SKU) ข้อความไม่มี UUID (msg=%s): %s\n',
    v_msg, case when v_caught and v_msg !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 7: เคสห้ามพัง — production_order_done ปกติ fixed+spot (T9), 0132
  -- fail-closed spot gate ยังทำงาน (T10), done ซ้ำ idempotent (T11),
  -- production_order_cancel/save/item_set ไม่ถูกแตะ (T12)
  -----------------------------------------------------------------------
  -- T9a: fixed flow ปกติ
  v_res := analytics.production_order_save(v_shop, null, 'T9 fixed ok', null);
  v_order_fixed := (v_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_order_fixed, v_p_fixed_ok, 3);
  v_item_id_fixed := (v_item_res ->> 'id')::uuid;
  perform analytics.production_order_done(v_shop, v_order_fixed);

  select count(*) into v_lot_count from analytics.stock_lot where production_order_item_id = v_item_id_fixed;
  select qty_on_hand into v_stock_after from public.central_stock where product_id = v_p_fixed_ok;
  select status into v_status_after from analytics.production_order where id = v_order_fixed;
  v_log := v_log || format('[T9a] fixed SKU ปกติ: lot สร้าง %s แถว (คาด 1), central_stock=%s (คาด 3), status=%s (คาด done): %s\n',
    v_lot_count, v_stock_after, v_status_after,
    case when v_lot_count = 1 and v_stock_after = 3 and v_status_after = 'done' then 'OK' else 'FAIL' end);

  -- T9b: spot flow ปกติ (ส่ง p_expected_spot_thb_per_gram ถูกต้อง)
  v_res := analytics.production_order_save(v_shop, null, 'T9 spot ok', null);
  v_order_spot := (v_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_order_spot, v_p_spot_ok, 5);
  v_item_id_spot := (v_item_res ->> 'id')::uuid;
  perform analytics.production_order_done(v_shop, v_order_spot, null, v_spot_price, null);

  select count(*) into v_lot_count from analytics.stock_lot where production_order_item_id = v_item_id_spot;
  select qty_on_hand into v_stock_after from public.central_stock where product_id = v_p_spot_ok;
  select status into v_status_after from analytics.production_order where id = v_order_spot;
  v_log := v_log || format('[T9b] spot SKU ปกติ (ส่งราคาถูกต้อง): lot สร้าง %s แถว (คาด 1), central_stock=%s (คาด 5), status=%s (คาด done): %s\n',
    v_lot_count, v_stock_after, v_status_after,
    case when v_lot_count = 1 and v_stock_after = 5 and v_status_after = 'done' then 'OK' else 'FAIL' end);

  -- T10: 0132 fail-closed gate — spot SKU ไม่ส่ง p_expected_spot_thb_per_gram
  -- ต้อง raise 22023 และห้ามมี lot เกิด
  v_res := analytics.production_order_save(v_shop, null, 'T10 spot gate', null);
  v_order_gate := (v_res ->> 'id')::uuid;
  perform analytics.production_order_item_set(v_shop, v_order_gate, v_p_spot_ok, 2);
  v_caught := false; v_code := null;
  begin
    perform analytics.production_order_done(v_shop, v_order_gate);
  exception when others then
    v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  select count(*) into v_lot_count from analytics.stock_lot sl
    join analytics.production_order_item poi on poi.id = sl.production_order_item_id
   where poi.production_order_id = v_order_gate;
  v_log := v_log || format('[T10] 🔴 ด่านราคาเงินของ 0132 ยังปิดอยู่: raise=%s code=%s (คาด 22023), lot ที่ถูกสร้าง=%s (คาด 0): %s\n',
    v_caught, coalesce(v_code, '(none)'), v_lot_count,
    case when v_caught and v_code = '22023' and v_lot_count = 0 then 'OK' else 'FAIL — ด่านของ 0132 หายระหว่างแก้ 0139' end);

  -- T11: กด done ซ้ำบนใบที่ done แล้ว (v_order_fixed จาก T9a) — idempotent
  v_res := analytics.production_order_done(v_shop, v_order_fixed);
  select count(*) into v_lot_count from analytics.stock_lot where production_order_item_id = v_item_id_fixed;
  v_log := v_log || format('[T11] done ซ้ำ already_done=%s (คาด true), lot ยังมีแค่ %s แถว (คาด 1 — ไม่สร้างซ้ำ): %s\n',
    v_res ->> 'already_done', v_lot_count,
    case when (v_res ->> 'already_done')::boolean and v_lot_count = 1 then 'OK' else 'FAIL' end);

  -- T12: production_order_cancel/save/item_set ไม่ถูกแตะ — regression เบา
  v_res := analytics.production_order_save(v_shop, null, 'T12 cancel regression', null);
  v_order_id := (v_res ->> 'id')::uuid;
  perform analytics.production_order_item_set(v_shop, v_order_id, v_p_fixed_ok, 2);
  perform analytics.production_order_cancel(v_shop, v_order_id, 'ทดสอบ regression 0139');
  select status into v_status_after from analytics.production_order where id = v_order_id;
  v_log := v_log || format('[T12] production_order_save/item_set/cancel ยังทำงานปกติ (ไม่ถูกแตะโดย 0139) สถานะ=%s (คาด cancelled): %s\n',
    v_status_after, case when v_status_after = 'cancelled' then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 8: grant/overload ของ production_order_done (T13), TRUNCATE guard
  -- แบบ static — ไม่รัน TRUNCATE ตรงบนตารางจริง (ดูหมายเหตุหัวไฟล์) (T14)
  -----------------------------------------------------------------------
  select has_function_privilege('anon', 'analytics.production_order_done(uuid,uuid,jsonb,numeric,uuid)', 'execute') into v_priv_anon;
  select has_function_privilege('authenticated', 'analytics.production_order_done(uuid,uuid,jsonb,numeric,uuid)', 'execute') into v_priv_auth;
  select count(*) into v_overload_count from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'production_order_done';
  v_log := v_log || format('[T13] production_order_done grant anon=%s auth=%s (คาด f/f), overload_count=%s (คาด 1): %s\n',
    v_priv_anon, v_priv_auth, v_overload_count,
    case when v_priv_anon = false and v_priv_auth = false and v_overload_count = 1 then 'OK' else 'FAIL' end);

  select has_table_privilege('service_role', 'analytics.stock_lot', 'select')   into v_priv_svc_select;
  select has_table_privilege('service_role', 'analytics.stock_lot', 'insert')   into v_priv_svc_insert;
  select has_table_privilege('service_role', 'analytics.stock_lot', 'update')   into v_priv_svc_update;
  select has_table_privilege('service_role', 'analytics.stock_lot', 'delete')   into v_priv_svc_delete;
  select has_table_privilege('service_role', 'analytics.stock_lot', 'truncate') into v_priv_svc_truncate;
  select count(*) into v_trunc_trigger_count
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = 'stock_lot' and c.relnamespace = 'analytics'::regnamespace
     and t.tgname = 'trg_stock_lot_deny_truncate' and not t.tgisinternal;
  v_log := v_log || format('[T14] stock_lot grant service_role select=%s insert=%s update=%s (คาดทั้งหมด true) delete=%s truncate=%s (คาดทั้งคู่ false) + trg_stock_lot_deny_truncate ผูกอยู่จริง (%s แถว คาด 1): %s\n',
    v_priv_svc_select, v_priv_svc_insert, v_priv_svc_update, v_priv_svc_delete, v_priv_svc_truncate, v_trunc_trigger_count,
    case when v_priv_svc_select and v_priv_svc_insert and v_priv_svc_update
      and v_priv_svc_delete = false and v_priv_svc_truncate = false and v_trunc_trigger_count = 1
    then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 9: v_dim_product.effective_unit_cost ของ SKU จริงไม่ขยับ (T15) —
  -- 0139 ไม่แตะ v_dim_product/production_cost_calc เลย
  -----------------------------------------------------------------------
  select string_agg(product_id::text || ':' || coalesce(effective_unit_cost::text, 'NULL'), ',' order by product_id)
    into v_after_dim_snapshot
  from analytics.v_dim_product
  where shop_id not in (v_shop, v_shop2);

  v_log := v_log || format('[T15] 🔴 v_dim_product.effective_unit_cost ของ SKU จริงทั้งหมด (ก่อน 0139) ตรงเป๊ะกับหลัง 0139 (%s แถว): %s\n',
    (select count(*) from analytics.v_dim_product where shop_id not in (v_shop, v_shop2)),
    case when v_before_dim_snapshot = v_after_dim_snapshot then 'OK' else 'FAIL — effective_unit_cost เปลี่ยน ตรวจ diff ด่วน' end);

  v_log := v_log || E'\n=== ALL CHECKS LOGGED ABOVE — ตรวจทุกบรรทัดหา FAIL (transaction จะ rollback เสมอ) ===\n';
  raise exception '%', v_log;
end $$;

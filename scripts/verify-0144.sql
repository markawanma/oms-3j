-- scripts/verify-0144.sql
--
-- ชุดทดสอบของ supabase/migrations/0144_item_set_new_design.sql — เพิ่ม
-- พารามิเตอร์ท้ายสุด p_is_new_design boolean default null ให้ analytics.
-- production_order_item_set (0131) เพื่อเปิดช่องทาง RPC จริงในการตั้งค่าออกแบบ
-- ต่อรอบผลิต (ก่อนหน้านี้ทำได้ทางเดียวคือ UPDATE ตรง ซึ่ง verify-0143.sql ใช้
-- เป็น workaround ใน Part 4 มาก่อน)
--
-- ตาม skill 3j-migration-traps ข้อ 11: do-block เดียว จบด้วย `raise exception`
-- เสมอ ⇒ ทั้ง transaction rollback ไม่ว่าผลจะผ่าน/ไม่ผ่าน — อ่านผลจาก error
-- message นี้. Part 0 ติดตั้ง DDL ของ 0144 ทับของเดิมในทรานแซกชันนี้เอง (สมมติ
-- ว่า 0131-0143 apply ไปแล้วจริงบน DB เป้าหมาย ไม่ต้องลอก DDL ของไฟล์เหล่านั้น
-- มาซ้ำ) ใช้เป็นทั้ง dry-run (ก่อน apply จริง) และ post-apply verify (รันซ้ำ
-- หลัง apply ผ่าน MCP apply_migration — Part 0 idempotent: drop+create+revoke+
-- grant รันซ้ำได้ปลอดภัย)
--
-- 💰 แตะต้นทุน/สต็อก/ใบผลิต — shop/SKU/ใบผลิตสังเคราะห์ทั้งหมด (prefix ZZ144)
-- สร้างในทรานแซกชันนี้เอง ไม่แตะของจริงเลย ยกเว้น Part 0 ที่ "อ่าน" (ไม่เขียน)
-- analytics.v_dim_product ของ SKU จริงทั้งหมดเพื่อพิสูจน์ว่าไม่ขยับแม้แถวเดียว
-- (เคสห้ามผ่าน #13 — 0144 ไม่แตะ v_dim_product/production_cost_calc เลย)
--
-- 🔴 หมายเหตุ dollar-quote (3j-migration-traps ข้อ 15): outer do-block ใช้ tag
-- v144, DDL ของ 0144 ห่อด้วย EXECUTE ใช้ tag ddl0144 (ตามแพทเทิร์นของ
-- verify-0139.sql เพราะ body ของฟังก์ชันที่จะสร้างใหม่มีตัวคั่นดอลลาร์ของตัวเอง
-- อยู่แล้ว) ตัวคั่นชั้นในสุด (ตัว body ฟังก์ชัน) ใช้ tag bodyiset — ตัวคั่นทั้ง
-- สามชั้นคนละชื่อกันเป๊ะ ไม่มีจุดไหนในไฟล์นี้ที่มีเครื่องหมายดอลลาร์ติดกันสอง
-- ตัวเลย (ตรวจด้วยตาก่อนส่งแล้ว) — เนื้อ DDL คัดลอกจาก
-- supabase/migrations/0144_item_set_new_design.sql คำต่อคำ (เปลี่ยนแค่ชื่อ
-- ตัวคั่นดอลลาร์ของ body ฟังก์ชันจากตัวเปล่าเป็น bodyiset เพื่อให้ซ้อนกับ
-- ตัวคั่นชั้นนอกได้ — ความหมาย/ลอจิกเหมือนเดิม 100%)
--
-- โครงสร้างไฟล์:
--   Part 0  — snapshot v_dim_product ของจริงก่อนแตะอะไร → apply 0144 DDL
--             verbatim → ตรวจ overload/grant → snapshot ซ้ำ → เทียบเป๊ะ
--             (เคสห้ามผ่าน #5, #6, #13)
--   Part 1  — setup: shop สังเคราะห์ (ZZ144) + rate 24 คู่ + ราคาเงินวันนี้ +
--             SKU 16 ตัวครบ 3 โหมด (fixed/spot/spec) สำหรับทุก part ด้านล่าง
--   Part 2  — T1/T2: เรียกแบบเดิมไม่ส่ง p_is_new_design บนรายการที่เป็น
--             true/false อยู่ ⇒ ต้องคงค่าเดิม (เคสห้ามผ่าน #1, #2) + qty_planned
--             อัปเดตได้ปกติผ่าน on-conflict เหมือนเดิม (เคสไม่พัง #10) + รายการ
--             ใหม่ที่ไม่ส่ง arg นี้เลย default false ตามคอลัมน์
--   Part 3  — T3/T4: เพิ่มรายการ SKU ปกติแบบเดิม (fixed/spot) ยังทำงานครบ qty
--             ถูก ไม่ raise + done สำเร็จ สต็อก/lot ถูกต้อง (เคสไม่พัง #9)
--   Part 4  — T5: SKU spec คู่แฝดสเปคเดียวกัน (ติ๊ก/ไม่ติ๊ก) ในใบเดียวกัน —
--             เทียบ production_order_preview ต้องต่างกันเท่ากับ nre_per_piece
--             เป๊ะ (เคสห้ามผ่าน #7)
--   Part 5  — T6: กด done ใบ Part 4 ต่อ — production_order_item.unit_cost และ
--             stock_lot.unit_cost ต้องรวมค่าออกแบบเต็มจำนวนสำหรับรายการที่
--             ติ๊ก และต้องตรงกับที่ preview เห็นก่อนกดเป๊ะ (เคสห้ามผ่าน #8)
--   Part 6  — T7: ใบผลิตผสม 3 โหมด (fixed+spot+spec) เดียวกัน preview+done
--             สำเร็จ สต็อก/lot เข้าครบ 3 รายการ (เคสไม่พัง #12)
--   Part 7  — T8: production_order_save/item_remove/preview/cancel ไม่ถูกแตะ
--             — เรียกได้ปกติทั้งชุดในเส้นทางเดียว (เคสไม่พัง #11)
--   Part 8  — T9-T14: 🔴 trap #17 — ยิงฟังก์ชันใหม่ (พร้อม p_is_new_design)
--             ใส่ใบที่ done แล้วและ cancelled แล้ว ครบทั้ง 3 โหมด (fixed/spot/
--             spec) = 6 เคส ต้องถูกปฏิเสธทุกเคส และ is_new_design ของรายการ
--             เดิมต้องไม่ถูกแตะ (เคสห้ามผ่าน #3, #4)
--   Part 9  — T15/T16: UPDATE ตรงบน is_new_design ของรายการในใบที่ done/
--             cancelled แล้ว ต้องถูกปฏิเสธโดย trigger เดิม
--             analytics.production_order_item_deny_mutation (0131 §5b — ไม่ได้
--             ถูกแก้โดย 0144 แต่ครอบคอลัมน์นี้อยู่แล้วโดยอัตโนมัติเพราะไม่มี
--             `of column_name` กำกับ — พิสูจน์ด้วยเทสต์ตามที่หัวไฟล์ migration
--             ระบุไว้ว่าจะทำ)

do $v144$
declare
  v_log text := E'\n=== verify 0144 (production_order_item_set + p_is_new_design) ===\n';

  -- Part 0
  v_real_before text;
  v_real_after  text;
  v_overload_count int;
  v_arg_list    text;
  v_priv_anon   boolean;
  v_priv_auth   boolean;
  v_priv_svc    boolean;

  -- Part 1 setup
  v_shop       uuid := gen_random_uuid();
  v_rate_date  date := (now() at time zone 'Asia/Bangkok')::date - 1;
  v_today      date := (now() at time zone 'Asia/Bangkok')::date;
  v_spot_price numeric := 72;

  -- products
  v_p_ctrl_fixed    uuid;
  v_p_ctrl_spot     uuid;
  v_p_toggle_true   uuid;
  v_p_toggle_false  uuid;
  v_p_spec_notick   uuid;
  v_p_spec_tick     uuid;
  v_p_mix_fixed     uuid;
  v_p_mix_spot      uuid;
  v_p_mix_spec      uuid;
  v_p_smoke         uuid;
  v_p_fixed_done    uuid;
  v_p_spot_done     uuid;
  v_p_spec_done     uuid;
  v_p_fixed_cancel  uuid;
  v_p_spot_cancel   uuid;
  v_p_spec_cancel   uuid;

  -- orders
  v_o_toggle1     uuid;
  v_o_toggle2     uuid;
  v_o_fixed_ctrl  uuid;
  v_o_spot_ctrl   uuid;
  v_o_twin        uuid;
  v_o_mix         uuid;
  v_o_smoke       uuid;
  v_o_fixed_done  uuid;
  v_o_spot_done   uuid;
  v_o_spec_done   uuid;
  v_o_fixed_cancel uuid;
  v_o_spot_cancel  uuid;
  v_o_spec_cancel  uuid;

  -- items
  v_item_id             uuid; -- scratch เดินหน้าทีละ test ไม่ข้ามความหมาย
  v_item_a_id           uuid;
  v_item_b_id           uuid;
  v_item_smoke_id       uuid;
  v_item_fixed_done_id  uuid;
  v_item_spot_done_id   uuid;
  v_item_spec_done_id   uuid;
  v_item_fixed_cancel_id uuid;
  v_item_spot_cancel_id  uuid;
  v_item_spec_cancel_id  uuid;

  -- results
  v_res      jsonb;
  v_item_res jsonb;
  v_item_a   jsonb; -- preview item element ของ twin ที่ไม่ติ๊ก
  v_item_b   jsonb; -- preview item element ของ twin ที่ติ๊ก

  -- column reads (typed แยกตามความหมาย — 3j-migration-traps ข้อ 16)
  v_qty_planned  int;
  v_is_new_design  boolean;
  v_is_new_design2 boolean;
  v_stock_ok boolean; -- ผลตรวจ central_stock ของ Part 6 (T7c) เท่านั้น — แยกจาก v_caught (error-catch)

  -- ต้นทุน (numeric ล้วน แยกตัวแปรตามความหมาย ห้ามยืมกัน)
  v_notick_unit_cost     numeric;
  v_tick_unit_cost       numeric;
  v_nre_per_piece        numeric;
  v_nre_per_piece_notick numeric;
  v_poi_unit_cost_a      numeric;
  v_poi_unit_cost_b      numeric;
  v_lot_unit_cost_a      numeric;
  v_lot_unit_cost_b      numeric;

  -- error-catch scratch
  v_caught boolean;
  v_code   text;

  -- misc counts
  v_lot_count   int;
  v_stock_after int;
  v_item_count  int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -----------------------------------------------------------------------
  -- Part 0: snapshot ของจริงก่อนแตะอะไรเลย → apply 0144 DDL verbatim →
  -- ตรวจ overload/grant → snapshot ซ้ำ → เทียบเป๊ะ
  -----------------------------------------------------------------------
  select string_agg(product_id::text || ':' || coalesce(effective_unit_cost::text, 'NULL'), ',' order by product_id)
    into v_real_before
  from analytics.v_dim_product;

  -- ยืนยันก่อนแตะอะไรว่ามี signature 4-arg เก่าอยู่จริง (ไม่ใช่ signature อื่น
  -- ที่บังเอิญไม่มีมาก่อนหน้าเลย)
  select count(*) into v_overload_count
  from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'production_order_item_set';
  v_log := v_log || format('[Part 0a] ก่อนแตะอะไร: production_order_item_set มี %s overload (คาด 1 ตัว = 4-arg เดิม): %s' || E'\n',
    v_overload_count, case when v_overload_count = 1 then 'OK' else 'FAIL — สมมติฐานเริ่มต้นผิด ตรวจ DB ก่อน apply' end);

  execute $ddl0144$
    drop function if exists analytics.production_order_item_set(uuid, uuid, uuid, int);

    create or replace function analytics.production_order_item_set(
      p_shop_id             uuid,
      p_production_order_id uuid,
      p_product_id          uuid,
      p_qty_planned         int,
      p_is_new_design       boolean default null
    )
     returns jsonb
     language plpgsql
     security definer
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $bodyiset$
    declare
      v_order   analytics.production_order%rowtype;
      v_product public.product%rowtype;
      v_item    analytics.production_order_item%rowtype;
    begin
      if p_shop_id is null or p_production_order_id is null or p_product_id is null then
        raise exception 'production_order_item_set: p_shop_id, p_production_order_id, p_product_id are required';
      end if;
      if p_qty_planned is null or not (p_qty_planned > 0 and p_qty_planned <= 100000) then
        raise exception 'production_order_item_set: p_qty_planned ต้องอยู่ระหว่าง 1-100000' using errcode = '22023';
      end if;

      perform analytics.crm_require_owner_admin(p_shop_id);

      select * into v_order from analytics.production_order where id = p_production_order_id and shop_id = p_shop_id for update;
      if not found then
        raise exception 'production_order_item_set: ไม่พบใบผลิต % ในร้านนี้', p_production_order_id using errcode = '22023';
      end if;
      if v_order.status <> 'open' then
        raise exception 'production_order_item_set: ใบ % สถานะ % แล้ว เพิ่ม/แก้รายการไม่ได้', v_order.po_no, v_order.status using errcode = '22023';
      end if;

      select * into v_product from public.product where id = p_product_id and shop_id = p_shop_id;
      if not found then
        raise exception 'production_order_item_set: ไม่พบ SKU % ในร้านนี้', p_product_id using errcode = '22023';
      end if;
      if not v_product.is_active then
        raise exception 'production_order_item_set: SKU % ปิดใช้งานแล้ว ใส่ในใบผลิตไม่ได้', v_product.sku using errcode = '22023';
      end if;
      if v_product.sku ~* '^live' then
        raise exception 'production_order_item_set: SKU % เป็น SKU เฉพาะไลฟ์ (live*) ไม่นับสต็อก ใส่ในใบผลิตไม่ได้', v_product.sku using errcode = '22023';
      end if;

      insert into analytics.production_order_item as poi (production_order_id, product_id, qty_planned, is_new_design)
      values (p_production_order_id, p_product_id, p_qty_planned, coalesce(p_is_new_design, false))
      on conflict (production_order_id, product_id) do update
        set qty_planned   = excluded.qty_planned,
            is_new_design  = case when p_is_new_design is null then poi.is_new_design else p_is_new_design end,
            updated_at     = now()
      returning * into v_item;

      return jsonb_build_object(
        'id', v_item.id, 'product_id', v_item.product_id, 'sku', v_product.sku,
        'name', v_product.name, 'qty_planned', v_item.qty_planned,
        'is_new_design', v_item.is_new_design
      );
    end;
    $bodyiset$;

    revoke execute on function analytics.production_order_item_set(uuid, uuid, uuid, int, boolean) from public, anon, authenticated;
    grant execute on function analytics.production_order_item_set(uuid, uuid, uuid, int, boolean) to service_role;
  $ddl0144$;

  v_log := v_log || '[Part 0b] apply 0144 DDL verbatim (drop 4-arg + create 5-arg + revoke/grant): OK (no error)' || E'\n';

  select count(*) into v_overload_count
  from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'production_order_item_set';
  v_log := v_log || format('[Part 0c] 🔴 หลัง apply: production_order_item_set มี %s overload (คาด 1 ตัว — 4-arg เดิมถูก drop แล้ว, ไม่ใช่ overload ใหม่ซ้อนของเดิม — เคสห้ามผ่าน #5): %s' || E'\n',
    v_overload_count, case when v_overload_count = 1 then 'OK' else 'FAIL — มี overload ค้าง' end);

  select has_function_privilege('anon', 'analytics.production_order_item_set(uuid, uuid, uuid, int, boolean)', 'execute') into v_priv_anon;
  select has_function_privilege('authenticated', 'analytics.production_order_item_set(uuid, uuid, uuid, int, boolean)', 'execute') into v_priv_auth;
  select has_function_privilege('service_role', 'analytics.production_order_item_set(uuid, uuid, uuid, int, boolean)', 'execute') into v_priv_svc;
  v_log := v_log || format('[Part 0d] 🔴 grant ของ signature ใหม่: anon=%s auth=%s svc=%s (คาด f/f/t — เคสห้ามผ่าน #6): %s' || E'\n',
    v_priv_anon, v_priv_auth, v_priv_svc,
    case when v_priv_anon = false and v_priv_auth = false and v_priv_svc = true then 'OK' else 'FAIL' end);

  -- ยืนยันว่า signature เดียวที่เหลืออยู่คือตัวใหม่จริง (มี p_is_new_design)
  -- ไม่ใช่ตัวเก่าที่บังเอิญนับได้ 1 ตัวเท่ากัน — เช็คแบบ static ผ่าน
  -- pg_get_function_identity_arguments ไม่พึ่งพฤติกรรม error-raising ของ
  -- has_function_privilege บน signature ที่ไม่มีอยู่ (ต่างกันไปตามเวอร์ชัน)
  select pg_get_function_identity_arguments(oid) into v_arg_list
  from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'production_order_item_set';
  v_log := v_log || format('[Part 0e] signature ที่เหลืออยู่ตัวเดียว = "%s" มี p_is_new_design จริง (ไม่ใช่ตัวเก่า 4-arg): %s' || E'\n',
    v_arg_list, case when v_arg_list ilike '%is_new_design%' then 'OK' else 'FAIL — signature เดิมยังอยู่ (overload ซ้อน)' end);

  select string_agg(product_id::text || ':' || coalesce(effective_unit_cost::text, 'NULL'), ',' order by product_id)
    into v_real_after
  from analytics.v_dim_product;

  v_log := v_log || format('[Part 0f] 🔴 v_dim_product.effective_unit_cost ของ SKU จริงทั้งหมด ไม่ขยับแม้แถวเดียว (%s แถว, เคสห้ามผ่าน #13 — 0144 ไม่แตะ v_dim_product/production_cost_calc เลย): %s' || E'\n',
    (select count(*) from analytics.v_dim_product),
    case when v_real_before = v_real_after then 'OK' else 'FAIL — ตัวเลขขยับ ตรวจ diff ด่วน' end);

  -----------------------------------------------------------------------
  -- Part 1: setup shop/SKU/rate สังเคราะห์ (prefix ZZ144) — ใช้ร่วมทุก part
  -----------------------------------------------------------------------
  insert into public.shop (id, name) values (v_shop, 'ZZ TEST verify-0144');

  perform analytics.oem_metal_price_set(v_shop, 'silver', v_spot_price, v_today, 'manual');

  -- rate 24 คู่ (ชุดเดียวกับ verify-0141/0142/0143) ให้ item_kind='แหวน'/
  -- polish_tier='เรียบ' silver ไม่มีพลอย/ไม่มีชุบ is_complete=true ได้จริง
  insert into analytics.oem_cost_rate (shop_id, rate_key, scope, effective_from, value) values
    (v_shop, 'reject_rate_cast_pct', '-', v_rate_date, 0.02),
    (v_shop, 'reject_rate_polish_pct', '-', v_rate_date, 0.01),
    (v_shop, 'labor_thb_per_day', 'ฉีดเทียน', v_rate_date, 500),
    (v_shop, 'work_hours_per_day', 'ฉีดเทียน', v_rate_date, 8),
    (v_shop, 'wax_inject_pieces_per_hour', '-', v_rate_date, 20),
    (v_shop, 'wax_material_thb_per_piece', '-', v_rate_date, 5),
    (v_shop, 'labor_thb_per_day', 'หล่อ', v_rate_date, 600),
    (v_shop, 'work_hours_per_day', 'หล่อ', v_rate_date, 8),
    (v_shop, 'cut_sprue_minutes_per_piece', '-', v_rate_date, 2),
    (v_shop, 'labor_thb_per_day', 'ขัด', v_rate_date, 550),
    (v_shop, 'work_hours_per_day', 'ขัด', v_rate_date, 8),
    (v_shop, 'polish_pieces_per_day', 'เรียบ', v_rate_date, 40),
    (v_shop, 'labor_thb_per_day', 'QC', v_rate_date, 500),
    (v_shop, 'work_hours_per_day', 'QC', v_rate_date, 8),
    (v_shop, 'qc_pieces_per_day', '-', v_rate_date, 100),
    (v_shop, 'pack_cost_thb_per_piece', '-', v_rate_date, 5),
    (v_shop, 'flask_capacity_pieces', 'แหวน', v_rate_date, 20),
    (v_shop, 'flask_cost_thb', '-', v_rate_date, 150),
    (v_shop, 'sprue_loss_pct', 'silver', v_rate_date, 0.05),
    (v_shop, 'recovery_rate_pct', 'silver', v_rate_date, 0.9),
    (v_shop, 'polish_loss_pct', 'silver', v_rate_date, 0.02),
    (v_shop, 'cad_fee_thb', '-', v_rate_date, 2000),
    (v_shop, 'print3d_cost_thb', '-', v_rate_date, 150),
    (v_shop, 'rubber_mold_cost_thb', '-', v_rate_date, 300);

  v_p_ctrl_fixed   := analytics.product_upsert(v_shop, 'ZZ144-CTRLFIXED',   'regression fixed control',      null, 'fixed', 88, null, null, null, 150, null, null, null, true);
  v_p_ctrl_spot    := analytics.product_upsert(v_shop, 'ZZ144-CTRLSPOT',    'regression spot control',       null, 'spot', null, 10, 0.925, 20, 300, null, null, null, true);
  v_p_toggle_true  := analytics.product_upsert(v_shop, 'ZZ144-TOGTRUE',    'toggle ควรคง true',             null, 'fixed', 50, null, null, null, null, null, null, null, true);
  v_p_toggle_false := analytics.product_upsert(v_shop, 'ZZ144-TOGFALSE',   'toggle ควรคง false',            null, 'fixed', 50, null, null, null, null, null, null, null, true);
  v_p_mix_fixed    := analytics.product_upsert(v_shop, 'ZZ144-MIXFIXED',   'ใบผสม fixed',                   null, 'fixed', 60, null, null, null, null, null, null, null, true);
  v_p_mix_spot     := analytics.product_upsert(v_shop, 'ZZ144-MIXSPOT',    'ใบผสม spot',                    null, 'spot', null, 5, 0.925, 10, null, null, null, null, true);
  v_p_smoke        := analytics.product_upsert(v_shop, 'ZZ144-SMOKE',      'regression smoke RPC เดิม',      null, 'fixed', 40, null, null, null, null, null, null, null, true);
  v_p_fixed_done   := analytics.product_upsert(v_shop, 'ZZ144-FIXDONE',    'trap17 fixed done',              null, 'fixed', 70, null, null, null, null, null, null, null, true);
  v_p_spot_done    := analytics.product_upsert(v_shop, 'ZZ144-SPOTDONE',   'trap17 spot done',               null, 'spot', null, 8, 0.925, 15, null, null, null, null, true);
  v_p_fixed_cancel := analytics.product_upsert(v_shop, 'ZZ144-FIXCANCEL',  'trap17 fixed cancelled',         null, 'fixed', 75, null, null, null, null, null, null, null, true);
  v_p_spot_cancel  := analytics.product_upsert(v_shop, 'ZZ144-SPOTCANCEL', 'trap17 spot cancelled',          null, 'spot', null, 6, 0.925, 12, null, null, null, null, true);

  -- SKU โหมด spec ทุกตัวต้องตั้งผ่าน product_make_spec_set เท่านั้น (0142
  -- บล็อก product_upsert) — สร้างเป็น fixed ก่อนแล้วพลิกโหมด
  v_p_spec_notick := analytics.product_upsert(v_shop, 'ZZ144-SPECNOTICK', 'spec คู่แฝด ไม่ติ๊ก', null, 'fixed', null, 3.5, 0.925, null, null, null, null, null, true);
  perform analytics.product_make_spec_set(v_shop, v_p_spec_notick, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ'));

  v_p_spec_tick := analytics.product_upsert(v_shop, 'ZZ144-SPECTICK', 'spec คู่แฝด ติ๊ก', null, 'fixed', null, 3.5, 0.925, null, null, null, null, null, true);
  perform analytics.product_make_spec_set(v_shop, v_p_spec_tick, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ'));

  v_p_mix_spec := analytics.product_upsert(v_shop, 'ZZ144-MIXSPEC', 'ใบผสม spec', null, 'fixed', null, 3.5, 0.925, null, null, null, null, null, true);
  perform analytics.product_make_spec_set(v_shop, v_p_mix_spec, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ'));

  v_p_spec_done := analytics.product_upsert(v_shop, 'ZZ144-SPECDONE', 'trap17 spec done', null, 'fixed', null, 3.5, 0.925, null, null, null, null, null, true);
  perform analytics.product_make_spec_set(v_shop, v_p_spec_done, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ'));

  v_p_spec_cancel := analytics.product_upsert(v_shop, 'ZZ144-SPECCANCEL', 'trap17 spec cancelled', null, 'fixed', null, 3.5, 0.925, null, null, null, null, null, true);
  perform analytics.product_make_spec_set(v_shop, v_p_spec_cancel, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ'));

  v_log := v_log || '[Part 1] setup 1 shop + 24 rate + ราคาเงินวันนี้ + 16 SKU สังเคราะห์ (prefix ZZ144, ครบ 3 โหมด): OK' || E'\n';

  -----------------------------------------------------------------------
  -- Part 2 (T1/T2): เรียกแบบเดิมไม่ส่ง p_is_new_design ⇒ คงค่าเดิม (เคสห้าม
  -- ผ่าน #1, #2) + qty_planned อัปเดตผ่าน on-conflict ปกติ (เคสไม่พัง #10)
  -----------------------------------------------------------------------
  -- T1: รายการที่เป็น true อยู่ ต้องคง true เมื่อเรียกซ้ำไม่ส่ง arg
  v_res := analytics.production_order_save(v_shop, null, 'T1 toggle true', null);
  v_o_toggle1 := (v_res ->> 'id')::uuid;

  v_item_res := analytics.production_order_item_set(v_shop, v_o_toggle1, v_p_toggle_true, 4, true);
  v_item_id := (v_item_res ->> 'id')::uuid;
  select qty_planned, is_new_design into v_qty_planned, v_is_new_design
    from analytics.production_order_item where id = v_item_id;
  v_log := v_log || format('[T1a] สร้างรายการ ติ๊ก is_new_design=true: qty_planned=%s (คาด 4) is_new_design=%s (คาด true): %s' || E'\n',
    v_qty_planned, v_is_new_design, case when v_qty_planned = 4 and v_is_new_design = true then 'OK' else 'FAIL' end);

  -- เรียกซ้ำแบบเดิม 4-arg (ไม่ส่ง p_is_new_design เลย) พร้อมเปลี่ยน qty
  v_item_res := analytics.production_order_item_set(v_shop, v_o_toggle1, v_p_toggle_true, 9);
  select qty_planned, is_new_design into v_qty_planned, v_is_new_design
    from analytics.production_order_item where id = v_item_id;
  v_log := v_log || format('[T1b] 🔴 เรียกแบบเดิม 4-arg ซ้ำ: qty_planned=%s (คาด 9 — on-conflict อัปเดตปกติ, เคสไม่พัง #10) is_new_design=%s (คาด true ยังคงเดิม ไม่ถูกรีเซ็ตเป็น false — เคสห้ามผ่าน #1): %s' || E'\n',
    v_qty_planned, v_is_new_design, case when v_qty_planned = 9 and v_is_new_design = true then 'OK' else 'FAIL' end);

  -- T2: รายการที่เป็น false อยู่ ต้องคง false เมื่อเรียกซ้ำไม่ส่ง arg
  v_res := analytics.production_order_save(v_shop, null, 'T2 toggle false', null);
  v_o_toggle2 := (v_res ->> 'id')::uuid;

  v_item_res := analytics.production_order_item_set(v_shop, v_o_toggle2, v_p_toggle_false, 3, false);
  v_item_id := (v_item_res ->> 'id')::uuid;
  select qty_planned, is_new_design into v_qty_planned, v_is_new_design
    from analytics.production_order_item where id = v_item_id;
  v_log := v_log || format('[T2a] สร้างรายการ ระบุ is_new_design=false ชัดเจน: qty_planned=%s (คาด 3) is_new_design=%s (คาด false): %s' || E'\n',
    v_qty_planned, v_is_new_design, case when v_qty_planned = 3 and v_is_new_design = false then 'OK' else 'FAIL' end);

  v_item_res := analytics.production_order_item_set(v_shop, v_o_toggle2, v_p_toggle_false, 7);
  select qty_planned, is_new_design into v_qty_planned, v_is_new_design
    from analytics.production_order_item where id = v_item_id;
  v_log := v_log || format('[T2b] 🔴 เรียกแบบเดิม 4-arg ซ้ำ: qty_planned=%s (คาด 7) is_new_design=%s (คาด false ยังคงเดิม — เคสห้ามผ่าน #2): %s' || E'\n',
    v_qty_planned, v_is_new_design, case when v_qty_planned = 7 and v_is_new_design = false then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 3 (T3/T4): เพิ่มรายการปกติ fixed/spot ยังทำงานครบ + done สำเร็จ
  -- (เคสไม่พัง #9) — รวมยืนยัน "รายการใหม่ไม่ส่ง arg เลย default false ตาม
  -- คอลัมน์" ไปในตัว
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop, null, 'T3 fixed regression', null);
  v_o_fixed_ctrl := (v_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_o_fixed_ctrl, v_p_ctrl_fixed, 6);
  select is_new_design into v_is_new_design from analytics.production_order_item where id = (v_item_res ->> 'id')::uuid;
  v_log := v_log || format('[T3a] เพิ่มรายการ fixed ใหม่ไม่ส่ง p_is_new_design เลย: is_new_design=%s (คาด false ตาม default คอลัมน์): %s' || E'\n',
    v_is_new_design, case when v_is_new_design = false then 'OK' else 'FAIL' end);

  perform analytics.production_order_done(v_shop, v_o_fixed_ctrl);
  select qty_on_hand into v_stock_after from public.central_stock where product_id = v_p_ctrl_fixed;
  select count(*) into v_lot_count from analytics.stock_lot where product_id = v_p_ctrl_fixed;
  v_log := v_log || format('[T3b] done fixed สำเร็จ: central_stock=%s (คาด 6) lot=%s แถว (คาด 1): %s' || E'\n',
    v_stock_after, v_lot_count, case when v_stock_after = 6 and v_lot_count = 1 then 'OK' else 'FAIL' end);

  v_res := analytics.production_order_save(v_shop, null, 'T4 spot regression', null);
  v_o_spot_ctrl := (v_res ->> 'id')::uuid;
  perform analytics.production_order_item_set(v_shop, v_o_spot_ctrl, v_p_ctrl_spot, 5, false);
  perform analytics.production_order_done(v_shop, v_o_spot_ctrl, null, v_spot_price, null);
  select qty_on_hand into v_stock_after from public.central_stock where product_id = v_p_ctrl_spot;
  select count(*) into v_lot_count from analytics.stock_lot where product_id = v_p_ctrl_spot;
  v_log := v_log || format('[T4] done spot สำเร็จ (ระบุ is_new_design=false ชัดเจน — ไม่มีผลกับ spot): central_stock=%s (คาด 5) lot=%s แถว (คาด 1): %s' || E'\n',
    v_stock_after, v_lot_count, case when v_stock_after = 5 and v_lot_count = 1 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 4 (T5): SKU spec คู่แฝดสเปคเดียวกัน ติ๊ก/ไม่ติ๊ก ในใบเดียว — เทียบ
  -- production_order_preview ต้องต่างกันเท่ากับ nre_per_piece เป๊ะ (เคสห้าม
  -- ผ่าน #7)
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop, null, 'T5 twin spec cost', null);
  v_o_twin := (v_res ->> 'id')::uuid;

  v_item_res := analytics.production_order_item_set(v_shop, v_o_twin, v_p_spec_notick, 5);
  v_item_a_id := (v_item_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_o_twin, v_p_spec_tick, 5, true);
  v_item_b_id := (v_item_res ->> 'id')::uuid;

  v_res := analytics.production_order_preview(v_shop, v_o_twin);
  select elem into v_item_a from jsonb_array_elements(v_res -> 'items') elem where (elem ->> 'product_id')::uuid = v_p_spec_notick;
  select elem into v_item_b from jsonb_array_elements(v_res -> 'items') elem where (elem ->> 'product_id')::uuid = v_p_spec_tick;

  v_notick_unit_cost     := (v_item_a ->> 'unit_cost')::numeric;
  v_tick_unit_cost       := (v_item_b ->> 'unit_cost')::numeric;
  v_nre_per_piece_notick := (v_item_a -> 'cost_calc' ->> 'nre_per_piece')::numeric;
  v_nre_per_piece        := (v_item_b -> 'cost_calc' ->> 'nre_per_piece')::numeric;

  v_log := v_log || format('[T5a] preview สะท้อน is_new_design ถูกต้อง: twin ไม่ติ๊ก=%s (คาด false) twin ติ๊ก=%s (คาด true): %s' || E'\n',
    v_item_a ->> 'is_new_design', v_item_b ->> 'is_new_design',
    case when (v_item_a ->> 'is_new_design')::boolean = false and (v_item_b ->> 'is_new_design')::boolean = true then 'OK' else 'FAIL' end);

  v_log := v_log || format('[T5b] twin ไม่ติ๊ก: nre_per_piece=%s (คาด 0): %s' || E'\n',
    v_nre_per_piece_notick, case when v_nre_per_piece_notick = 0 then 'OK' else 'FAIL' end);

  v_log := v_log || format('[T5c] 🔴 twin ติ๊ก: nre_per_piece=%s (คาด 490 = (2000+150+300)/5) unit_cost ติ๊ก=%s ไม่ติ๊ก=%s ส่วนต่าง=%s (ต้อง = nre_per_piece เป๊ะ — เคสห้ามผ่าน #7): %s' || E'\n',
    v_nre_per_piece, v_tick_unit_cost, v_notick_unit_cost, v_tick_unit_cost - v_notick_unit_cost,
    case when v_nre_per_piece = 490 and (v_tick_unit_cost - v_notick_unit_cost) = v_nre_per_piece then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 5 (T6): กด done ต่อจาก Part 4 — production_order_item.unit_cost
  -- และ stock_lot.unit_cost ต้องรวมค่าออกแบบเต็มจำนวนสำหรับรายการที่ติ๊ก และ
  -- ตรงกับที่ preview เห็นก่อนกดเป๊ะ (เคสห้ามผ่าน #8)
  -----------------------------------------------------------------------
  v_res := analytics.production_order_done(v_shop, v_o_twin, null, v_spot_price, null);

  select unit_cost into v_poi_unit_cost_a from analytics.production_order_item where id = v_item_a_id;
  select unit_cost into v_poi_unit_cost_b from analytics.production_order_item where id = v_item_b_id;
  select unit_cost into v_lot_unit_cost_a from analytics.stock_lot where production_order_item_id = v_item_a_id;
  select unit_cost into v_lot_unit_cost_b from analytics.stock_lot where production_order_item_id = v_item_b_id;

  v_log := v_log || format('[T6a] production_order_item.unit_cost หลัง done ตรงกับที่ preview เห็นก่อนกดเป๊ะ: ไม่ติ๊ก poi=%s (คาด %s) ติ๊ก poi=%s (คาด %s): %s' || E'\n',
    v_poi_unit_cost_a, v_notick_unit_cost, v_poi_unit_cost_b, v_tick_unit_cost,
    case when v_poi_unit_cost_a = v_notick_unit_cost and v_poi_unit_cost_b = v_tick_unit_cost then 'OK' else 'FAIL' end);

  v_log := v_log || format('[T6b] 🔴 stock_lot.unit_cost ของรายการที่ติ๊ก รวมค่าออกแบบเต็มจำนวนจริง (ไม่ใช่ถูกตัดทิ้งเงียบๆ — เคสห้ามผ่าน #8): lot ไม่ติ๊ก=%s (คาด = poi %s) lot ติ๊ก=%s (คาด = poi %s): %s' || E'\n',
    v_lot_unit_cost_a, v_poi_unit_cost_a, v_lot_unit_cost_b, v_poi_unit_cost_b,
    case when v_lot_unit_cost_a = v_poi_unit_cost_a and v_lot_unit_cost_b = v_poi_unit_cost_b then 'OK' else 'FAIL' end);

  v_log := v_log || format('[T6c] ส่วนต่าง stock_lot.unit_cost ระหว่างติ๊ก/ไม่ติ๊ก = nre_per_piece เป๊ะ (%s = %s): %s' || E'\n',
    v_lot_unit_cost_b - v_lot_unit_cost_a, v_nre_per_piece,
    case when (v_lot_unit_cost_b - v_lot_unit_cost_a) = v_nre_per_piece then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 6 (T7): ใบผลิตผสม 3 โหมด (fixed+spot+spec) เดียวกัน preview+done
  -- สำเร็จ สต็อก/lot เข้าครบ 3 รายการ (เคสไม่พัง #12)
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop, null, 'T7 mixed modes', null);
  v_o_mix := (v_res ->> 'id')::uuid;
  perform analytics.production_order_item_set(v_shop, v_o_mix, v_p_mix_fixed, 3);
  perform analytics.production_order_item_set(v_shop, v_o_mix, v_p_mix_spot, 2, false);
  perform analytics.production_order_item_set(v_shop, v_o_mix, v_p_mix_spec, 4, true);

  v_res := analytics.production_order_preview(v_shop, v_o_mix);
  v_log := v_log || format('[T7a] preview ใบผสม 3 โหมด: spot_price_thb_per_gram=%s (คาดไม่ null) items=%s แถว (คาด 3): %s' || E'\n',
    v_res ->> 'spot_price_thb_per_gram', jsonb_array_length(v_res -> 'items'),
    case when v_res ->> 'spot_price_thb_per_gram' is not null and jsonb_array_length(v_res -> 'items') = 3 then 'OK' else 'FAIL' end);

  v_res := analytics.production_order_done(v_shop, v_o_mix, null, v_spot_price, null);
  v_log := v_log || format('[T7b] done ใบผสม 3 โหมดสำเร็จ: status=%s (คาด done) items=%s แถว (คาด 3): %s' || E'\n',
    v_res ->> 'status', jsonb_array_length(v_res -> 'items'),
    case when v_res ->> 'status' = 'done' and jsonb_array_length(v_res -> 'items') = 3 then 'OK' else 'FAIL' end);

  select
    (select qty_on_hand from public.central_stock where product_id = v_p_mix_fixed) = 3
    and (select qty_on_hand from public.central_stock where product_id = v_p_mix_spot) = 2
    and (select qty_on_hand from public.central_stock where product_id = v_p_mix_spec) = 4
  into v_stock_ok;
  select count(*) into v_lot_count
    from analytics.stock_lot sl
    join analytics.production_order_item poi on poi.id = sl.production_order_item_id
   where poi.production_order_id = v_o_mix;
  v_log := v_log || format('[T7c] central_stock ทั้ง 3 SKU ตรงตาม qty (3/2/4)=%s (คาด true), lot เกิดครบ %s แถว (คาด 3): %s' || E'\n',
    v_stock_ok, v_lot_count, case when v_stock_ok and v_lot_count = 3 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 7 (T8): production_order_save/item_remove/preview/cancel ไม่ถูก
  -- แตะโดย 0144 — เรียกได้ปกติทั้งเส้นทาง (เคสไม่พัง #11)
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop, null, 'T8 smoke', null);
  v_o_smoke := (v_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_o_smoke, v_p_smoke, 4);
  v_item_smoke_id := (v_item_res ->> 'id')::uuid;

  v_res := analytics.production_order_preview(v_shop, v_o_smoke);
  v_item_count := jsonb_array_length(v_res -> 'items');
  v_log := v_log || format('[T8a] production_order_preview ปกติ: items=%s แถว (คาด 1): %s' || E'\n',
    v_item_count, case when v_item_count = 1 then 'OK' else 'FAIL' end);

  perform analytics.production_order_item_remove(v_shop, v_o_smoke, v_p_smoke);
  v_res := analytics.production_order_preview(v_shop, v_o_smoke);
  v_item_count := jsonb_array_length(v_res -> 'items');
  v_log := v_log || format('[T8b] production_order_item_remove ปกติ + preview ใบว่างไม่ raise: items=%s แถว (คาด 0): %s' || E'\n',
    v_item_count, case when v_item_count = 0 then 'OK' else 'FAIL' end);

  v_res := analytics.production_order_save(v_shop, v_o_smoke, 'T8 smoke แก้ note แล้ว', null);
  v_log := v_log || format('[T8c] production_order_save (แก้ note ใบเดิม) ปกติ: note=%s: %s' || E'\n',
    v_res ->> 'note', case when v_res ->> 'note' = 'T8 smoke แก้ note แล้ว' then 'OK' else 'FAIL' end);

  v_res := analytics.production_order_cancel(v_shop, v_o_smoke, 'ทดสอบ regression verify-0144');
  v_log := v_log || format('[T8d] production_order_cancel ปกติ: status=%s (คาด cancelled) — RPC เดิมทั้ง 5 ตัว (save/item_set/preview/item_remove/cancel) ไม่ถูก 0144 แตะจริง: %s' || E'\n',
    v_res ->> 'status', case when v_res ->> 'status' = 'cancelled' then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 8 (T9-T14): 🔴 trap #17 — ยิงฟังก์ชันใหม่ (พร้อม p_is_new_design)
  -- ใส่ใบที่ done/cancelled แล้ว ครบทั้ง 3 โหมด = 6 เคส ต้องถูกปฏิเสธทุกเคส
  -- และ is_new_design ของรายการเดิมต้องไม่ถูกแตะ (เคสห้ามผ่าน #3, #4)
  -----------------------------------------------------------------------

  -- T9: fixed, done
  v_res := analytics.production_order_save(v_shop, null, 'T9 fixed done', null);
  v_o_fixed_done := (v_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_o_fixed_done, v_p_fixed_done, 5); -- old-style เหมือนข้อมูลเก่า
  v_item_fixed_done_id := (v_item_res ->> 'id')::uuid;
  perform analytics.production_order_done(v_shop, v_o_fixed_done);
  v_caught := false; v_code := null;
  begin
    perform analytics.production_order_item_set(v_shop, v_o_fixed_done, v_p_fixed_done, 5, true);
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  select is_new_design into v_is_new_design from analytics.production_order_item where id = v_item_fixed_done_id;
  v_log := v_log || format('[T9] fixed+done: item_set ใหม่ถูกปฏิเสธ (raise=%s code=%s คาด 22023), is_new_design เดิมไม่ถูกแตะ=%s (คาด false): %s' || E'\n',
    v_caught, coalesce(v_code, '(none)'), v_is_new_design,
    case when v_caught and v_code = '22023' and v_is_new_design = false then 'OK' else 'FAIL' end);

  -- T10: spot, done
  v_res := analytics.production_order_save(v_shop, null, 'T10 spot done', null);
  v_o_spot_done := (v_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_o_spot_done, v_p_spot_done, 4);
  v_item_spot_done_id := (v_item_res ->> 'id')::uuid;
  perform analytics.production_order_done(v_shop, v_o_spot_done, null, v_spot_price, null);
  v_caught := false; v_code := null;
  begin
    perform analytics.production_order_item_set(v_shop, v_o_spot_done, v_p_spot_done, 4, true);
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  select is_new_design into v_is_new_design from analytics.production_order_item where id = v_item_spot_done_id;
  v_log := v_log || format('[T10] spot+done: item_set ใหม่ถูกปฏิเสธ (raise=%s code=%s), is_new_design เดิมไม่ถูกแตะ=%s (คาด false): %s' || E'\n',
    v_caught, coalesce(v_code, '(none)'), v_is_new_design,
    case when v_caught and v_code = '22023' and v_is_new_design = false then 'OK' else 'FAIL' end);

  -- T11: spec, done
  v_res := analytics.production_order_save(v_shop, null, 'T11 spec done', null);
  v_o_spec_done := (v_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_o_spec_done, v_p_spec_done, 3);
  v_item_spec_done_id := (v_item_res ->> 'id')::uuid;
  perform analytics.production_order_done(v_shop, v_o_spec_done, null, v_spot_price, null);
  v_caught := false; v_code := null;
  begin
    perform analytics.production_order_item_set(v_shop, v_o_spec_done, v_p_spec_done, 3, true);
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  select is_new_design into v_is_new_design from analytics.production_order_item where id = v_item_spec_done_id;
  v_log := v_log || format('[T11] spec+done: item_set ใหม่ถูกปฏิเสธ (raise=%s code=%s), is_new_design เดิมไม่ถูกแตะ=%s (คาด false): %s' || E'\n',
    v_caught, coalesce(v_code, '(none)'), v_is_new_design,
    case when v_caught and v_code = '22023' and v_is_new_design = false then 'OK' else 'FAIL' end);

  -- T12: fixed, cancelled
  v_res := analytics.production_order_save(v_shop, null, 'T12 fixed cancelled', null);
  v_o_fixed_cancel := (v_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_o_fixed_cancel, v_p_fixed_cancel, 5);
  v_item_fixed_cancel_id := (v_item_res ->> 'id')::uuid;
  perform analytics.production_order_cancel(v_shop, v_o_fixed_cancel, 'trap17 fixed cancelled');
  v_caught := false; v_code := null;
  begin
    perform analytics.production_order_item_set(v_shop, v_o_fixed_cancel, v_p_fixed_cancel, 5, true);
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  select is_new_design into v_is_new_design from analytics.production_order_item where id = v_item_fixed_cancel_id;
  v_log := v_log || format('[T12] fixed+cancelled: item_set ใหม่ถูกปฏิเสธ (raise=%s code=%s), is_new_design เดิมไม่ถูกแตะ=%s (คาด false): %s' || E'\n',
    v_caught, coalesce(v_code, '(none)'), v_is_new_design,
    case when v_caught and v_code = '22023' and v_is_new_design = false then 'OK' else 'FAIL' end);

  -- T13: spot, cancelled
  v_res := analytics.production_order_save(v_shop, null, 'T13 spot cancelled', null);
  v_o_spot_cancel := (v_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_o_spot_cancel, v_p_spot_cancel, 4);
  v_item_spot_cancel_id := (v_item_res ->> 'id')::uuid;
  perform analytics.production_order_cancel(v_shop, v_o_spot_cancel, 'trap17 spot cancelled');
  v_caught := false; v_code := null;
  begin
    perform analytics.production_order_item_set(v_shop, v_o_spot_cancel, v_p_spot_cancel, 4, true);
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  select is_new_design into v_is_new_design from analytics.production_order_item where id = v_item_spot_cancel_id;
  v_log := v_log || format('[T13] spot+cancelled: item_set ใหม่ถูกปฏิเสธ (raise=%s code=%s), is_new_design เดิมไม่ถูกแตะ=%s (คาด false): %s' || E'\n',
    v_caught, coalesce(v_code, '(none)'), v_is_new_design,
    case when v_caught and v_code = '22023' and v_is_new_design = false then 'OK' else 'FAIL' end);

  -- T14: spec, cancelled
  v_res := analytics.production_order_save(v_shop, null, 'T14 spec cancelled', null);
  v_o_spec_cancel := (v_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_o_spec_cancel, v_p_spec_cancel, 2);
  v_item_spec_cancel_id := (v_item_res ->> 'id')::uuid;
  perform analytics.production_order_cancel(v_shop, v_o_spec_cancel, 'trap17 spec cancelled');
  v_caught := false; v_code := null;
  begin
    perform analytics.production_order_item_set(v_shop, v_o_spec_cancel, v_p_spec_cancel, 2, true);
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  select is_new_design into v_is_new_design2 from analytics.production_order_item where id = v_item_spec_cancel_id;
  v_log := v_log || format('[T14] 🔴 spec+cancelled (ครบ 6/6 ของ trap #17 — fixed/spot/spec x done/cancelled): item_set ใหม่ถูกปฏิเสธ (raise=%s code=%s), is_new_design เดิมไม่ถูกแตะ=%s (คาด false): %s' || E'\n',
    v_caught, coalesce(v_code, '(none)'), v_is_new_design2,
    case when v_caught and v_code = '22023' and v_is_new_design2 = false then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 9 (T15/T16): UPDATE ตรงบน is_new_design ของรายการในใบ done/
  -- cancelled ต้องถูกปฏิเสธโดย trigger เดิม
  -- analytics.production_order_item_deny_mutation (0131 §5b — ไม่ถูกแก้โดย
  -- 0144 แต่ครอบคอลัมน์นี้อยู่แล้วเพราะ trigger ผูกกับ "ทุกคอลัมน์" ไม่มี
  -- `of column_name` กำกับ) — พิสูจน์ตามที่หัวไฟล์ migration ระบุว่าจะทำ แทน
  -- การเพิ่ม trigger ใหม่ที่ไม่จำเป็น
  -----------------------------------------------------------------------
  v_caught := false; v_code := null;
  begin
    update analytics.production_order_item set is_new_design = true where id = v_item_spec_done_id;
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  select is_new_design into v_is_new_design from analytics.production_order_item where id = v_item_spec_done_id;
  v_log := v_log || format('[T15] UPDATE ตรง is_new_design บนรายการในใบ done ถูกปฏิเสธโดย trg_production_order_item_deny_mutation (raise=%s code=%s), ค่ายังเป็น=%s (คาด false): %s' || E'\n',
    v_caught, coalesce(v_code, '(none)'), v_is_new_design,
    case when v_caught and v_code = '22023' and v_is_new_design = false then 'OK' else 'FAIL' end);

  v_caught := false; v_code := null;
  begin
    update analytics.production_order_item set is_new_design = true where id = v_item_spec_cancel_id;
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  select is_new_design into v_is_new_design2 from analytics.production_order_item where id = v_item_spec_cancel_id;
  v_log := v_log || format('[T16] UPDATE ตรง is_new_design บนรายการในใบ cancelled ถูกปฏิเสธเช่นกัน (raise=%s code=%s), ค่ายังเป็น=%s (คาด false): %s' || E'\n',
    v_caught, coalesce(v_code, '(none)'), v_is_new_design2,
    case when v_caught and v_code = '22023' and v_is_new_design2 = false then 'OK' else 'FAIL' end);

  v_log := v_log || E'\n=== ALL CHECKS LOGGED ABOVE — ตรวจทุกบรรทัดหา FAIL (transaction จะ rollback เสมอ) ===\n';
  raise exception '%', v_log;
end $v144$;

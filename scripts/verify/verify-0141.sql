-- scripts/verify-0141.sql
--
-- ชุดทดสอบของ supabase/migrations/0141_product_make_spec.sql (โหมดที่ 3 ของ
-- ต้นทุน "คำนวณจากสเปค" — public.product.make_spec + analytics.production_
-- cost_calc branch 'spec' + analytics.product_make_spec_set/clear)
--
-- ตาม skill 3j-migration-traps ข้อ 11: do $$ ... $$ block เดียว จบด้วย
-- `raise exception` เสมอ ⇒ ทั้ง transaction rollback ไม่ว่าผลจะผ่าน/ไม่ผ่าน —
-- อ่านผลจาก error message นี้. ใช้เป็นทั้ง dry-run (Part 0 ติดตั้ง DDL ของ
-- 0141 ทับของเดิมในทรานแซคชันนี้เอง — สมมติว่า 0131/0132/0139/0140 apply ไป
-- แล้วจริงบน DB เป้าหมาย ไม่ต้องลอก DDL ของไฟล์เหล่านั้นมาซ้ำ) และ post-apply
-- verify (รันซ้ำหลัง apply จริงผ่าน MCP apply_migration — Part 0 เป็น
-- idempotent ทั้งหมด: alter table add column if not exists, drop+create
-- function, revoke/grant — รันซ้ำได้ปลอดภัย) แบบเดียวกับ verify-0139.sql
--
-- 💰 แตะต้นทุน/สต็อก — shop/SKU สังเคราะห์ทั้งหมด (prefix ZZ141) สร้างขึ้นใน
-- ทรานแซคชันนี้เอง ไม่แตะ shop/SKU จริงเลย
--
-- โครงสร้างไฟล์:
--   Part 0  — apply 0141 DDL verbatim (7 กลุ่ม: 2 alter table + 5 function)
--   Part 1  — snapshot v_dim_product.effective_unit_cost ของ SKU จริงก่อนแตะ
--             อะไรเลย (เทียบใน Part 9 — เคสห้ามผ่าน #1)
--   Part 2  — setup: shop สังเคราะห์ + SKU ทุกแบบ + seed oem_cost_rate 24 คู่
--             (rate_key,scope) ให้ is_complete=true ได้จริง + ราคาเงินวันนี้
--   Part 3  — product_make_spec_set/clear: metal!=silver ปฏิเสธ (T1), whitelist
--             คีย์ (is_new_design ที่แอบส่งมาต้องหาย) (T2), gem_count>0 ไม่มี
--             gem_tier ปฏิเสธ (T3), set สำเร็จ + validation ส่งกลับ (T4),
--             clear แล้ว idempotent (T5)
--   Part 4  — product_upsert guard: SKU ใหม่ตั้ง spec ตรงๆ ไม่ได้ (T6), SKU มี
--             make_spec แล้วตั้ง spec ต่อได้ (T7)
--   Part 5  — production_cost_calc branch 'spec' ตรง: make_spec null ปฏิเสธ
--             (T8), น้ำหนักไม่ครบปฏิเสธ (T9), p_qty<=0 ปฏิเสธ (T10), metal
--             ไม่ใช่ silver (ข้อมูลเพี้ยนนอกช่องทาง RPC) ปฏิเสธ (T11), rate
--             ไม่ครบ (shop อื่นไม่มี rate เลย) ปฏิเสธ 22023 (T12), happy path
--             is_complete=true + breakdown ถูกต้อง (T13)
--   Part 6  — ความแม่นของสูตร: is_new_design ต่างกัน 490.00 เป๊ะ (T14), qty
--             ต่างกัน (preview≠done กันไม่ให้เกิด) 20.00 เป๊ะ (T15)
--   Part 7  — integration ผ่านใบผลิตจริง: preview ไม่ส่ง p_items ใช้
--             qty_planned (T16), preview ส่ง p_items ใช้ qty_done ตรงกับที่จะ
--             done จริง (T17 — เคสห้ามผ่าน #5), done ไม่ส่ง
--             p_expected_spot_thb_per_gram บนใบที่มี spec ปฏิเสธ 22023 ไม่มี
--             lot เกิด (T18 — เคสห้ามผ่าน #2), done สำเร็จด้วย qty_done≠
--             qty_planned แล้ว unit_cost/lot ตรงกับ qty_done ไม่ใช่ qty_planned
--             (T19), prev_cost_type='spec' ผ่าน CHECK ไม่ raise 23514 (เคสห้าม
--             ผ่าน #4 — พิสูจน์ทางอ้อมจาก T19 สำเร็จ), cost_calc snapshot ถูก
--             เขียนจริง (T20), ใบผสม fixed+spot+spec ในใบเดียว done พร้อมกัน
--             ไม่พัง (T21 — เคสห้ามพัง)
--   Part 8  — static: overload count (T22), grant anon/authenticated (T23),
--             CHECK constraint ยอมรับ 'spec' ทั้งสองตัว (T24)
--   Part 9  — 🔴 v_dim_product.effective_unit_cost ของ SKU จริงไม่ขยับ (T25 —
--             เคสห้ามผ่าน #1)

do $$
declare
  v_log text := E'\n=== verify 0141 (product.make_spec + production_cost_calc spec branch) ===\n';

  v_before_dim_snapshot text;
  v_after_dim_snapshot  text;

  v_shop  uuid := gen_random_uuid();
  v_shop_norate uuid := gen_random_uuid(); -- T12: shop ที่ไม่มี rate เลย

  v_rate_date date := (now() at time zone 'Asia/Bangkok')::date - 1;
  v_spot_price numeric := 72;

  v_p_fixed   uuid; -- regression: fixed เดิม
  v_p_spot    uuid; -- regression: spot เดิม
  v_p_raw     uuid; -- ยังไม่ตั้งสเปค ใช้ทดสอบ guard ต่างๆ
  v_p_norate  uuid; -- shop ไม่มี rate เลย (T12)

  v_make_spec jsonb;
  v_res       jsonb;
  v_item_res  jsonb;

  v_caught boolean;
  v_code   text;
  v_msg    text;

  v_calc_a jsonb;
  v_calc_b jsonb;
  v_unit_a numeric;
  v_unit_b numeric;

  v_order_id  uuid;
  v_item_id_1 uuid;
  v_item_id_2 uuid;
  v_item_id_3 uuid;

  v_preview jsonb;
  v_preview_item jsonb;

  v_lot_count int;
  v_stock_after int;
  v_lot_unit_cost numeric;   -- stock_lot.unit_cost เป็น numeric(12,2) ห้ามอ่านลง int (ปัดเศษเงียบ)
  v_status_after text;
  v_poi_unit_cost numeric;
  v_poi_cost_calc jsonb;

  v_overload_count int;
  v_priv_anon boolean;
  v_priv_auth boolean;
  v_priv_svc  boolean;
  v_condef    text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -----------------------------------------------------------------------
  -- 🔴 snapshot v_dim_product.effective_unit_cost ของ SKU จริงทั้งหมด ก่อน
  -- แตะอะไรเลย — ใช้เทียบใน Part 9 (0141 ไม่แตะ v_dim_product เลย)
  -----------------------------------------------------------------------
  select string_agg(product_id::text || ':' || coalesce(effective_unit_cost::text, 'NULL'), ',' order by product_id)
    into v_before_dim_snapshot
  from analytics.v_dim_product;

  -----------------------------------------------------------------------
  -- Part 0: apply 0141's DDL verbatim
  -----------------------------------------------------------------------

  -- §1: public.product.make_spec + cost_type รับ 'spec'
  execute $ddl_alter$
    alter table public.product add column if not exists make_spec jsonb;

    do $inner1$
    begin
      if not exists (select 1 from pg_constraint where conname = 'product_make_spec_shape_check') then
        alter table public.product add constraint product_make_spec_shape_check
          check (make_spec is null or jsonb_typeof(make_spec) = 'object');
      end if;
    end $inner1$;

    alter table public.product drop constraint if exists product_cost_type_check;
    alter table public.product add constraint product_cost_type_check
      check (cost_type in ('fixed', 'spot', 'spec'));

    alter table analytics.production_order_item
      add column if not exists is_new_design boolean not null default false,
      add column if not exists cost_calc     jsonb;

    do $inner2$
    declare
      v_conname text;
    begin
      select conname into v_conname
      from pg_constraint
      where conrelid = 'analytics.production_order_item'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%prev_cost_type%';

      if v_conname is not null then
        execute format('alter table analytics.production_order_item drop constraint %I', v_conname);
      end if;

      alter table analytics.production_order_item
        add constraint production_order_item_prev_cost_type_check
        check (prev_cost_type is null or prev_cost_type in ('fixed', 'spot', 'spec'));
    end $inner2$;
  $ddl_alter$;

  -- §2: analytics.production_cost_calc — branch 'spec'
  execute $ddl_cost_calc$
    drop function if exists analytics.production_cost_calc(uuid, uuid, numeric);

    create or replace function analytics.production_cost_calc(
      p_shop_id                   uuid,
      p_product_id                uuid,
      p_spot_price_thb_per_gram   numeric default null,
      p_qty                       int default null,
      p_is_new_design             boolean default false
    )
     returns jsonb
     language plpgsql
     security definer
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body_cost_calc$
    declare
      v_product         public.product%rowtype;
      v_spot            numeric;
      v_unit_cost       numeric;
      v_spec_input      jsonb;
      v_cost_result     jsonb;
      v_is_complete     boolean;
      v_metal_per_piece numeric;
      v_labor_per_piece numeric;
      v_batch_per_piece numeric;
      v_cost_piece      numeric;
      v_nre_cost        numeric;
      v_nre_per_piece   numeric;
      v_cost_calc       jsonb;
    begin
      if p_shop_id is null or p_product_id is null then
        raise exception 'production_cost_calc: p_shop_id and p_product_id are required';
      end if;
      if p_spot_price_thb_per_gram is not null and not (p_spot_price_thb_per_gram >= 5 and p_spot_price_thb_per_gram <= 500) then
        raise exception 'production_cost_calc: p_spot_price_thb_per_gram ต้องอยู่ระหว่าง 5-500 บาท/กรัม' using errcode = '22023';
      end if;
      perform analytics.crm_require_owner_admin(p_shop_id);

      select * into v_product from public.product where id = p_product_id and shop_id = p_shop_id;
      if not found then
        raise exception 'production_cost_calc: ไม่พบ SKU (product_id=%) ในร้านนี้', p_product_id using errcode = '22023';
      end if;

      if v_product.cost_type = 'spot' then
        if v_product.silver_weight_g is null or v_product.silver_weight_g <= 0 then
          raise exception 'production_cost_calc: SKU % เป็นโหมด spot แต่ยังไม่กรอกน้ำหนักเงิน (silver_weight_g) — กรอกที่ /catalog ก่อนสั่งผลิต', v_product.sku using errcode = '22023';
        end if;
        v_spot := coalesce(p_spot_price_thb_per_gram, analytics.production_spot_resolve(p_shop_id, null));
        v_unit_cost := round(coalesce(v_product.silver_weight_g, 0) * coalesce(v_spot, 0)
                              * coalesce(v_product.silver_purity, 0.925) + coalesce(v_product.labor_cost, 0), 2);

      elsif v_product.cost_type = 'spec' then
        if v_product.make_spec is null then
          raise exception 'production_cost_calc: SKU % เป็นโหมด spec แต่ยังไม่ได้ตั้งสเปค (make_spec) — ตั้งที่ /catalog ก่อนสั่งผลิต (analytics.product_make_spec_set)', v_product.sku using errcode = '22023';
        end if;
        if v_product.silver_weight_g is null or v_product.silver_weight_g <= 0 then
          raise exception 'production_cost_calc: SKU % เป็นโหมด spec แต่ยังไม่กรอกน้ำหนักเงิน (silver_weight_g) — กรอกที่ /catalog ก่อนสั่งผลิต', v_product.sku using errcode = '22023';
        end if;
        if coalesce(v_product.make_spec ->> 'metal', '') <> 'silver' then
          raise exception 'production_cost_calc: SKU % สเปคโลหะไม่ใช่เงิน (metal=%) — เฟสนี้รองรับเฉพาะเครื่องประดับเงินเท่านั้น (production_spot_resolve ไม่รองรับทอง/ทองเหลือง)', v_product.sku, v_product.make_spec ->> 'metal' using errcode = '22023';
        end if;
        if p_qty is null or p_qty <= 0 then
          raise exception 'production_cost_calc: SKU % เป็นโหมด spec ต้องระบุจำนวนที่จะผลิต (p_qty > 0) — ต้นทุนต่อชิ้นของโหมดนี้ขึ้นกับจำนวนที่ผลิตจริง', v_product.sku using errcode = '22023';
        end if;

        v_spot := coalesce(p_spot_price_thb_per_gram, analytics.production_spot_resolve(p_shop_id, null));

        v_spec_input := v_product.make_spec || jsonb_build_object(
          'qty', p_qty,
          'weight_g', v_product.silver_weight_g,
          'purity', coalesce(v_product.silver_purity, 0.925),
          'is_new_design', coalesce(p_is_new_design, false),
          'metal_price_thb_per_gram', v_spot
        );

        v_cost_result := analytics.oem_cost_calc(p_shop_id, v_spec_input);
        v_is_complete := (v_cost_result ->> 'is_complete')::boolean;
        if not v_is_complete then
          raise exception 'production_cost_calc: SKU % คำนวณต้นทุนไม่ครบ — ยังไม่ได้กรอกอัตราต้นทุนที่ /oem/rates (%)', v_product.sku,
            (select string_agg(e ->> 'question_th', ' / ') from jsonb_array_elements(v_cost_result -> 'missing') e)
            using errcode = '22023';
        end if;

        v_metal_per_piece := (v_cost_result -> '_raw' ->> 'metal_per_piece')::numeric;
        v_labor_per_piece := (v_cost_result -> '_raw' ->> 'labor_per_piece')::numeric;
        v_batch_per_piece := (v_cost_result -> '_raw' ->> 'batch_per_piece')::numeric;
        v_cost_piece      := (v_cost_result -> '_raw' ->> 'cost_piece')::numeric;
        v_nre_cost      := coalesce((v_cost_result -> '_raw' ->> 'nre_cost')::numeric, 0);
        v_nre_per_piece := round(v_nre_cost / p_qty, 2);
        v_unit_cost     := round(v_cost_piece + v_nre_cost / p_qty, 2);

        v_cost_calc := jsonb_build_object(
          'is_complete', v_is_complete,
          'missing', v_cost_result -> 'missing',
          'price_source', v_cost_result ->> 'price_source',
          'labor_steps', v_cost_result -> 'labor_steps',
          'batch_lines', v_cost_result -> 'batch_lines',
          'metal_per_piece', round(v_metal_per_piece, 2),
          'labor_per_piece', round(v_labor_per_piece, 2),
          'batch_per_piece', round(v_batch_per_piece, 2),
          'cost_piece', round(v_cost_piece, 2),
          'nre_cost', round(v_nre_cost, 2),
          'nre_per_piece', v_nre_per_piece,
          'qty', p_qty,
          'is_new_design', coalesce(p_is_new_design, false),
          'metal_price_thb_per_gram', v_spot,
          'unit_cost', v_unit_cost
        );

      else
        v_unit_cost := v_product.unit_cost;
        if v_unit_cost is null then
          raise exception 'production_cost_calc: SKU % ยังไม่มีต้นทุน (unit_cost) — กรอกที่ /catalog ก่อนสั่งผลิต', v_product.sku using errcode = '22023';
        end if;
      end if;

      return jsonb_build_object(
        'product_id', v_product.id,
        'sku', v_product.sku,
        'cost_type', v_product.cost_type,
        'silver_weight_g', v_product.silver_weight_g,
        'silver_purity', coalesce(v_product.silver_purity, 0.925),
        'labor_cost', v_product.labor_cost,
        'spot_price_thb_per_gram', case when v_product.cost_type in ('spot', 'spec') then v_spot else null end,
        'prev_cost_type', v_product.cost_type,
        'prev_unit_cost', v_product.unit_cost,
        'unit_cost', v_unit_cost,
        'cost_calc', v_cost_calc
      );
    end;
    $body_cost_calc$;

    revoke execute on function analytics.production_cost_calc(uuid, uuid, numeric, int, boolean) from public, anon, authenticated;
    grant execute on function analytics.production_cost_calc(uuid, uuid, numeric, int, boolean) to service_role;
  $ddl_cost_calc$;

  -- §3: analytics.production_order_preview — +p_items
  execute $ddl_preview$
    drop function if exists analytics.production_order_preview(uuid, uuid);

    create or replace function analytics.production_order_preview(
      p_shop_id             uuid,
      p_production_order_id uuid,
      p_items               jsonb default null
    )
     returns jsonb
     language plpgsql
     security definer
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body_preview$
    declare
      v_order      analytics.production_order%rowtype;
      v_spot       numeric;
      v_needs_spot boolean;
      v_items      jsonb;
    begin
      if p_shop_id is null or p_production_order_id is null then
        raise exception 'production_order_preview: p_shop_id and p_production_order_id are required';
      end if;
      if p_items is not null and jsonb_typeof(p_items) <> 'array' then
        raise exception 'production_order_preview: p_items ต้องเป็น json array' using errcode = '22023';
      end if;
      perform analytics.crm_require_owner_admin(p_shop_id);

      select * into v_order from analytics.production_order where id = p_production_order_id and shop_id = p_shop_id;
      if not found then
        raise exception 'production_order_preview: ไม่พบใบผลิต % ในร้านนี้', p_production_order_id using errcode = '22023';
      end if;
      if v_order.status <> 'open' then
        raise exception 'production_order_preview: ใบ % สถานะ % แล้ว — ดูค่าที่ stamp ไปแล้วจากรายการใบผลิตได้เลย ไม่ต้อง preview ซ้ำ', v_order.po_no, v_order.status using errcode = '22023';
      end if;

      select exists (
        select 1 from analytics.production_order_item poi
        join public.product p on p.id = poi.product_id
        where poi.production_order_id = p_production_order_id and p.cost_type in ('spot', 'spec')
      ) into v_needs_spot;

      if v_needs_spot then
        v_spot := analytics.production_spot_resolve(p_shop_id, v_order.spot_override_thb_per_gram);
      end if;

      select coalesce(jsonb_agg(
          calc.result || jsonb_build_object(
            'item_id', poi.id, 'qty_planned', poi.qty_planned, 'qty_used', q.qty_used,
            'is_new_design', coalesce(poi.is_new_design, false)
          )
          order by poi.created_at
        ), '[]'::jsonb)
        into v_items
      from analytics.production_order_item poi
      join public.product p on p.id = poi.product_id
      cross join lateral (
        select coalesce(
          (select (ov ->> 'qty_done')::int from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) ov
            where (ov ->> 'product_id')::uuid = poi.product_id),
          poi.qty_planned
        ) as qty_used
      ) q
      cross join lateral (
        select case
          when q.qty_used = 0 then jsonb_build_object(
            'product_id', poi.product_id, 'sku', p.sku, 'cost_type', p.cost_type,
            'unit_cost', null, 'skipped', true
          )
          else analytics.production_cost_calc(
            p_shop_id, poi.product_id,
            case when p.cost_type in ('spot', 'spec') then v_spot else null end,
            q.qty_used,
            coalesce(poi.is_new_design, false)
          )
        end as result
      ) calc
      where poi.production_order_id = p_production_order_id;

      return jsonb_build_object(
        'production_order_id', p_production_order_id,
        'po_no', v_order.po_no,
        'spot_price_thb_per_gram', v_spot,
        'items', v_items
      );
    end;
    $body_preview$;

    revoke execute on function analytics.production_order_preview(uuid, uuid, jsonb) from public, anon, authenticated;
    grant execute on function analytics.production_order_preview(uuid, uuid, jsonb) to service_role;
  $ddl_preview$;

  -- §4: analytics.production_order_done — signature เดิม body ขยาย logic
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
            'unit_cost', poi.unit_cost, 'prev_cost_type', poi.prev_cost_type, 'prev_unit_cost', poi.prev_unit_cost,
            'cost_calc', poi.cost_calc
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
          'is_new_design', coalesce(poi.is_new_design, false),
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
        where p.cost_type in ('spot', 'spec') and (e ->> 'qty_done_resolved')::int > 0
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

        if v_product.cost_type in ('spot', 'spec') and v_spot is null then
          raise exception 'production_order_done: SKU % ถูกเปลี่ยนเป็นโหมดที่ต้องใช้ราคาเงินระหว่างที่กำลังบันทึกใบนี้ — เปิดใบผลิตใหม่อีกครั้งเพื่อคำนวณต้นทุนใหม่', v_product.sku using errcode = '22023';
        end if;
        v_calc := analytics.production_cost_calc(
          p_shop_id, v_product.id,
          case when v_product.cost_type in ('spot', 'spec') then v_spot else null end,
          v_qty_done,
          coalesce((v_elem ->> 'is_new_design')::boolean, false)
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
               cost_calc = v_calc -> 'cost_calc',
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
          'unit_cost', poi.unit_cost, 'prev_cost_type', poi.prev_cost_type, 'prev_unit_cost', poi.prev_unit_cost,
          'cost_calc', poi.cost_calc
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

  -- §5: product_make_spec_set / product_make_spec_clear
  execute $ddl_spec_set$
    create or replace function analytics.product_make_spec_set(
      p_shop_id    uuid,
      p_product_id uuid,
      p_make_spec  jsonb,
      p_actor      uuid default null
    )
     returns jsonb
     language plpgsql
     security definer
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body_spec_set$
    declare
      v_old          public.product%rowtype;
      v_new          public.product%rowtype;
      v_metal        text;
      v_item_kind    text;
      v_polish_tier  text;
      v_plating_type text;
      v_gem_tier     text;
      v_gem_count    numeric;
      v_clean_spec   jsonb;
      v_check_input  jsonb;
      v_check_result jsonb;
    begin
      if p_shop_id is null or p_product_id is null then
        raise exception 'product_make_spec_set: p_shop_id and p_product_id are required';
      end if;
      if p_make_spec is null or jsonb_typeof(p_make_spec) <> 'object' then
        raise exception 'product_make_spec_set: p_make_spec must be a json object' using errcode = '22023';
      end if;

      perform analytics.crm_require_owner_admin(p_shop_id);

      select * into v_old from public.product where id = p_product_id and shop_id = p_shop_id;
      if not found then
        raise exception 'product_make_spec_set: ไม่พบ SKU (product_id=%) ในร้านนี้', p_product_id using errcode = '22023';
      end if;

      v_metal := p_make_spec ->> 'metal';
      if v_metal is distinct from 'silver' then
        raise exception 'product_make_spec_set: make_spec.metal ต้องเป็น silver เท่านั้น (เฟสแรกยังไม่รองรับทอง/ทองเหลืองสำหรับผลิตเอง)' using errcode = '22023';
      end if;

      v_item_kind := nullif(btrim(p_make_spec ->> 'item_kind'), '');
      if v_item_kind is null then
        raise exception 'product_make_spec_set: make_spec.item_kind is required' using errcode = '22023';
      end if;
      v_polish_tier := nullif(btrim(p_make_spec ->> 'polish_tier'), '');
      if v_polish_tier is null then
        raise exception 'product_make_spec_set: make_spec.polish_tier is required' using errcode = '22023';
      end if;
      v_plating_type := nullif(btrim(p_make_spec ->> 'plating_type'), '');
      v_gem_tier      := nullif(btrim(p_make_spec ->> 'gem_tier'), '');
      v_gem_count     := coalesce(nullif(p_make_spec ->> 'gem_count', '')::numeric, 0);

      v_clean_spec := jsonb_build_object(
        'metal', v_metal,
        'item_kind', v_item_kind,
        'polish_tier', v_polish_tier,
        'plating_type', v_plating_type,
        'gem_tier', v_gem_tier,
        'gem_count', v_gem_count
      );

      v_check_input := v_clean_spec || jsonb_build_object(
        'qty', 1,
        'weight_g', coalesce(v_old.silver_weight_g, 1),
        'purity', coalesce(v_old.silver_purity, 0.925),
        'is_new_design', false
      );
      v_check_result := analytics.oem_cost_calc(p_shop_id, v_check_input);

      update public.product
         set make_spec = v_clean_spec, cost_type = 'spec', updated_at = now()
       where id = p_product_id
      returning * into v_new;

      insert into analytics.catalog_audit_log (shop_id, product_id, sku, action, before, after, changed_by)
      values (p_shop_id, v_new.id, v_new.sku, 'edit', to_jsonb(v_old), to_jsonb(v_new), coalesce(p_actor, auth.uid()));

      return jsonb_build_object(
        'product_id', v_new.id, 'sku', v_new.sku, 'cost_type', v_new.cost_type,
        'make_spec', v_new.make_spec,
        'validation', jsonb_build_object(
          'is_complete', v_check_result ->> 'is_complete',
          'missing', v_check_result -> 'missing'
        )
      );
    end;
    $body_spec_set$;

    revoke execute on function analytics.product_make_spec_set(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
    grant execute on function analytics.product_make_spec_set(uuid, uuid, jsonb, uuid) to authenticated, service_role;

    create or replace function analytics.product_make_spec_clear(
      p_shop_id    uuid,
      p_product_id uuid,
      p_actor      uuid default null
    )
     returns jsonb
     language plpgsql
     security definer
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body_spec_clear$
    declare
      v_old public.product%rowtype;
      v_new public.product%rowtype;
    begin
      if p_shop_id is null or p_product_id is null then
        raise exception 'product_make_spec_clear: p_shop_id and p_product_id are required';
      end if;
      perform analytics.crm_require_owner_admin(p_shop_id);

      select * into v_old from public.product where id = p_product_id and shop_id = p_shop_id;
      if not found then
        raise exception 'product_make_spec_clear: ไม่พบ SKU (product_id=%) ในร้านนี้', p_product_id using errcode = '22023';
      end if;

      if v_old.cost_type = 'fixed' and v_old.make_spec is null then
        return jsonb_build_object('product_id', v_old.id, 'sku', v_old.sku, 'cost_type', v_old.cost_type, 'already_cleared', true);
      end if;

      update public.product
         set cost_type = 'fixed', make_spec = null, updated_at = now()
       where id = p_product_id
      returning * into v_new;

      insert into analytics.catalog_audit_log (shop_id, product_id, sku, action, before, after, changed_by)
      values (p_shop_id, v_new.id, v_new.sku, 'edit', to_jsonb(v_old), to_jsonb(v_new), coalesce(p_actor, auth.uid()));

      return jsonb_build_object('product_id', v_new.id, 'sku', v_new.sku, 'cost_type', v_new.cost_type, 'already_cleared', false);
    end;
    $body_spec_clear$;

    revoke execute on function analytics.product_make_spec_clear(uuid, uuid, uuid) from public, anon, authenticated;
    grant execute on function analytics.product_make_spec_clear(uuid, uuid, uuid) to authenticated, service_role;
  $ddl_spec_set$;

  -- §6: analytics.product_upsert — guard cost_type='spec'
  execute $ddl_upsert$
    create or replace function analytics.product_upsert(
      p_shop_id uuid,
      p_sku text,
      p_name text,
      p_category text default null,
      p_cost_type text default 'fixed',
      p_unit_cost numeric default null,
      p_silver_weight_g numeric default null,
      p_silver_purity numeric default null,
      p_labor_cost numeric default null,
      p_list_price numeric default null,
      p_barcode text default null,
      p_supplier text default null,
      p_note text default null,
      p_is_active boolean default true
    )
     returns uuid
     language plpgsql
     security definer
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body_upsert$
    declare
      v_old public.product;
      v_new public.product;
      v_action text;
    begin
      if p_shop_id is null or p_sku is null or btrim(p_sku) = '' or p_name is null or btrim(p_name) = '' then
        raise exception 'product_upsert: p_shop_id, p_sku, p_name are required';
      end if;
      if p_cost_type not in ('fixed', 'spot', 'spec') then
        raise exception 'product_upsert: p_cost_type must be fixed, spot, or spec';
      end if;
      if p_cost_type = 'spot' and (p_silver_weight_g is null or p_silver_weight_g <= 0) then
        raise exception 'product_upsert: spot cost requires silver_weight_g > 0';
      end if;
      if p_silver_purity is not null and (p_silver_purity <= 0 or p_silver_purity > 1) then
        raise exception 'product_upsert: p_silver_purity must be in (0,1]';
      end if;
      if p_unit_cost is not null and p_unit_cost < 0 then
        raise exception 'product_upsert: p_unit_cost must be >= 0';
      end if;
      if p_labor_cost is not null and p_labor_cost < 0 then
        raise exception 'product_upsert: p_labor_cost must be >= 0';
      end if;
      if p_list_price is not null and p_list_price < 0 then
        raise exception 'product_upsert: p_list_price must be >= 0';
      end if;

      perform analytics.crm_require_owner_admin(p_shop_id);

      select * into v_old from public.product where shop_id = p_shop_id and sku = btrim(p_sku);
      v_action := case when v_old.id is null then 'add' else 'edit' end;

      if p_cost_type = 'spec' and (v_old.id is null or v_old.make_spec is null) then
        raise exception 'product_upsert: SKU % ยังไม่เคยตั้งสเปค — ตั้งค่า cost_type=spec ต้องผ่าน analytics.product_make_spec_set เท่านั้น', btrim(p_sku) using errcode = '22023';
      end if;

      insert into public.product (
        shop_id, sku, name, category, cost_type, unit_cost, silver_weight_g,
        silver_purity, labor_cost, list_price, barcode, supplier, note, is_active
      ) values (
        p_shop_id, btrim(p_sku), btrim(p_name), p_category, p_cost_type, p_unit_cost, p_silver_weight_g,
        p_silver_purity, p_labor_cost, p_list_price, p_barcode, p_supplier, p_note, coalesce(p_is_active, true)
      )
      on conflict (shop_id, sku) do update set
        name = excluded.name,
        category = excluded.category,
        cost_type = excluded.cost_type,
        unit_cost = excluded.unit_cost,
        silver_weight_g = excluded.silver_weight_g,
        silver_purity = excluded.silver_purity,
        labor_cost = excluded.labor_cost,
        list_price = excluded.list_price,
        barcode = excluded.barcode,
        supplier = excluded.supplier,
        note = excluded.note,
        is_active = excluded.is_active,
        updated_at = now()
      returning * into v_new;

      insert into analytics.catalog_audit_log (shop_id, product_id, sku, action, before, after, changed_by)
      values (
        p_shop_id, v_new.id, v_new.sku, v_action,
        case when v_old.id is null then null else to_jsonb(v_old) end,
        to_jsonb(v_new), auth.uid()
      );

      return v_new.id;
    end;
    $body_upsert$;

    revoke execute on function analytics.product_upsert(uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, text, boolean)
      from public, anon, authenticated;
    grant execute on function analytics.product_upsert(uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, text, boolean)
      to authenticated, service_role;
  $ddl_upsert$;

  v_log := v_log || '[Part 0] apply 0141 DDL verbatim (2 alter table + 5 function): OK (no error)' || E'\n';

  -----------------------------------------------------------------------
  -- Part 2: setup
  -----------------------------------------------------------------------
  insert into public.shop (id, name) values (v_shop, 'ZZ TEST verify-0141');
  insert into public.shop (id, name) values (v_shop_norate, 'ZZ TEST verify-0141 no-rate shop');

  v_p_fixed  := analytics.product_upsert(v_shop, 'ZZ141-FIXED', 'regression fixed', null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_spot   := analytics.product_upsert(v_shop, 'ZZ141-SPOT',  'regression spot',  null, 'spot', null, 10, 0.925, 20, null, null, null, null, true);
  v_p_raw    := analytics.product_upsert(v_shop, 'ZZ141-RAW',   'ยังไม่ตั้งสเปค',    null, 'fixed', 50, null, null, null, null, null, null, null, true);
  v_p_norate := analytics.product_upsert(v_shop_norate, 'ZZ141-NORATE', 'shop ไม่มี rate เลย', null, 'fixed', 10, null, null, null, null, null, null, null, true);

  perform analytics.oem_metal_price_set(v_shop, 'silver', v_spot_price, (now() at time zone 'Asia/Bangkok')::date, 'manual');

  -- seed oem_cost_rate: ครบพอให้ item_kind='แหวน'/polish_tier='เรียบ' silver
  -- ไม่มีพลอย/ไม่มีชุบ is_complete=true ได้จริง (21 คู่) + 3 คู่ NRE (cad/
  -- print3d/mold) สำหรับ T14 (is_new_design=true)
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

  v_log := v_log || '[Part 2] setup 2 shop + 4 SKU สังเคราะห์ (prefix ZZ141) + 24 rate + ราคาเงินวันนี้: OK' || E'\n';

  -----------------------------------------------------------------------
  -- Part 3: product_make_spec_set/clear
  -----------------------------------------------------------------------
  v_make_spec := jsonb_build_object('metal', 'gold', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ');
  v_caught := false; v_code := null;
  begin
    perform analytics.product_make_spec_set(v_shop, v_p_raw, v_make_spec);
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_log := v_log || format('[T1] make_spec.metal=gold ถูกปฏิเสธ (errcode=%s คาด 22023): %s\n',
    coalesce(v_code, '(none)'), case when v_caught and v_code = '22023' then 'OK' else 'FAIL' end);

  -- T2: whitelist คีย์ — แนบ is_new_design ปนมาด้วย ต้องหายหลังบันทึก
  v_make_spec := jsonb_build_object(
    'metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ',
    'is_new_design', true, 'junk_field', 'ไม่ควรอยู่รอด'
  );
  v_res := analytics.product_make_spec_set(v_shop, v_p_raw, v_make_spec);
  v_log := v_log || format('[T2] 🔴 is_new_design/junk_field ที่แนบมาถูก whitelist ทิ้ง (make_spec=%s ไม่ควรมีคีย์แปลกปลอม): %s\n',
    v_res -> 'make_spec',
    case when not (v_res -> 'make_spec' ? 'is_new_design') and not (v_res -> 'make_spec' ? 'junk_field')
      and (v_res -> 'make_spec' ->> 'metal') = 'silver'
    then 'OK' else 'FAIL' end);

  -- T3: gem_count>0 ไม่มี gem_tier — ปฏิเสธ (propagate จาก oem_cost_calc)
  v_make_spec := jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ', 'gem_count', 2);
  v_caught := false; v_code := null;
  begin
    perform analytics.product_make_spec_set(v_shop, v_p_raw, v_make_spec);
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_log := v_log || format('[T3] gem_count>0 ไม่มี gem_tier ถูกปฏิเสธ (errcode=%s): %s\n',
    coalesce(v_code, '(none)'), case when v_caught then 'OK' else 'FAIL' end);

  -- T4: set สำเร็จ (จาก T2 อยู่แล้ว) — cost_type พลิกเป็น spec จริง +
  -- validation ส่งกลับมี is_complete=true (rate ครบหมดแล้วจาก Part 2)
  select cost_type into v_status_after from public.product where id = v_p_raw;
  v_log := v_log || format('[T4] product.cost_type พลิกเป็น spec จริงหลัง set (ได้ %s): %s\n',
    v_status_after, case when v_status_after = 'spec' then 'OK' else 'FAIL' end);

  -- T5: clear แล้ว idempotent
  v_res := analytics.product_make_spec_clear(v_shop, v_p_raw);
  select cost_type, make_spec into v_status_after, v_make_spec from public.product where id = v_p_raw;
  v_res := analytics.product_make_spec_clear(v_shop, v_p_raw); -- ซ้ำ
  v_log := v_log || format('[T5] clear แล้ว cost_type=%s (คาด fixed) make_spec=%s (คาด null), clear ซ้ำ already_cleared=%s (คาด true): %s\n',
    v_status_after, v_make_spec, v_res ->> 'already_cleared',
    case when v_status_after = 'fixed' and v_make_spec is null and (v_res ->> 'already_cleared')::boolean
    then 'OK' else 'FAIL' end);

  -- ตั้งสเปคจริงอีกครั้งให้ v_p_raw ไว้ใช้ต่อใน Part 5-7 (ยังไม่กรอกน้ำหนัก)
  v_make_spec := jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ');
  perform analytics.product_make_spec_set(v_shop, v_p_raw, v_make_spec);

  -----------------------------------------------------------------------
  -- Part 4: product_upsert guard
  -----------------------------------------------------------------------
  v_caught := false; v_code := null;
  begin
    perform analytics.product_upsert(v_shop, 'ZZ141-NEWSPEC', 'SKU ใหม่ตั้ง spec ตรงๆ', null, 'spec', null, null, null, null, null, null, null, null, true);
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_log := v_log || format('[T6] product_upsert SKU ใหม่ตั้ง cost_type=spec ตรงๆ (ไม่เคยตั้งสเปค) ถูกปฏิเสธ (errcode=%s): %s\n',
    coalesce(v_code, '(none)'), case when v_caught and v_code = '22023' then 'OK' else 'FAIL' end);

  -- T7: v_p_raw มี make_spec แล้ว (จาก Part 3) — product_upsert ตั้ง cost_type=
  -- spec ต่อได้ (แก้ฟิลด์อื่นพร้อมกัน เช่น silver_weight_g)
  v_caught := false;
  begin
    perform analytics.product_upsert(v_shop, 'ZZ141-RAW', 'ยังไม่ตั้งสเปค', null, 'spec', null, 3.5, 0.925, null, null, null, null, null, true);
  exception when others then v_caught := true; v_msg := sqlerrm;
  end;
  select cost_type into v_status_after from public.product where id = v_p_raw;
  v_log := v_log || format('[T7] product_upsert ตั้ง cost_type=spec ต่อได้เมื่อ make_spec มีอยู่แล้ว (ไม่ raise=%s, cost_type=%s คาด spec): %s\n',
    not v_caught, v_status_after,
    case when not v_caught and v_status_after = 'spec' then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 5: production_cost_calc branch 'spec' ตรง
  -----------------------------------------------------------------------
  -- T8: make_spec null (ใช้ v_p_fixed ซึ่งไม่เคยตั้งสเปคเลย แต่ต้องพลิก
  -- cost_type เป็น spec ตรงๆ ผ่าน DB เพื่อจำลอง defense-in-depth — service_role
  -- bypass RLS ทำได้)
  update public.product set cost_type = 'spec' where id = v_p_fixed;
  v_caught := false; v_code := null;
  begin
    perform analytics.production_cost_calc(v_shop, v_p_fixed, null, 5, false);
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_log := v_log || format('[T8] cost_type=spec แต่ make_spec เป็น null ถูกปฏิเสธ (errcode=%s): %s\n',
    coalesce(v_code, '(none)'), case when v_caught and v_code = '22023' then 'OK' else 'FAIL' end);
  update public.product set cost_type = 'fixed' where id = v_p_fixed; -- คืนสภาพ

  -- T9: v_p_raw มี make_spec+cost_type=spec แล้ว (จาก T7) แต่ silver_weight_g
  -- ถูกตั้งไว้แล้วใน T7 (3.5) — ทดสอบ "ยังไม่กรอกน้ำหนัก" ต้องใช้ SKU ใหม่
  -- แยกต่างหาก (🔴 ห้ามใช้ v_p_spot ตรงนี้ — v_p_spot ต้องคงเป็นโหมด spot
  -- ล้วนไว้ทดสอบ regression ใน T21b ห้ามพลิกโหมดมันโดยไม่ตั้งใจ)
  declare
    v_p_noweight uuid;
  begin
    v_p_noweight := analytics.product_upsert(v_shop, 'ZZ141-NOWEIGHT', 'ยังไม่กรอกน้ำหนัก', null, 'fixed', 10, null, null, null, null, null, null, null, true);
    perform analytics.product_make_spec_set(v_shop, v_p_noweight, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ'));
    v_caught := false; v_code := null;
    begin
      perform analytics.production_cost_calc(v_shop, v_p_noweight, null, 5, false);
    exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
    end;
    v_log := v_log || format('[T9] cost_type=spec แต่ silver_weight_g ยังไม่กรอก ถูกปฏิเสธ (errcode=%s): %s\n',
      coalesce(v_code, '(none)'), case when v_caught and v_code = '22023' then 'OK' else 'FAIL' end);
  end;

  -- T10: p_qty <= 0
  v_caught := false; v_code := null;
  begin
    perform analytics.production_cost_calc(v_shop, v_p_raw, null, 0, false);
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_log := v_log || format('[T10] p_qty=0 บน SKU โหมด spec ถูกปฏิเสธ (errcode=%s): %s\n',
    coalesce(v_code, '(none)'), case when v_caught and v_code = '22023' then 'OK' else 'FAIL' end);

  -- T11: make_spec.metal ไม่ใช่ silver (จำลองข้อมูลเพี้ยนนอกช่องทาง RPC —
  -- service_role เขียนตรงได้ ไม่มี CHECK บังคับเนื้อหา metal)
  update public.product set make_spec = make_spec || jsonb_build_object('metal', 'gold') where id = v_p_raw;
  v_caught := false; v_code := null;
  begin
    perform analytics.production_cost_calc(v_shop, v_p_raw, null, 5, false);
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_log := v_log || format('[T11] 🔴 make_spec.metal=gold (ข้อมูลเพี้ยนนอก RPC) ถูกปฏิเสธที่ read-time ด้วย (errcode=%s): %s\n',
    coalesce(v_code, '(none)'), case when v_caught and v_code = '22023' then 'OK' else 'FAIL' end);
  update public.product set make_spec = make_spec || jsonb_build_object('metal', 'silver') where id = v_p_raw; -- คืนสภาพ

  -- T12: shop ไม่มี rate เลย — is_complete=false ⇒ raise 22023 (ไม่ใช่คืนค่า null เงียบๆ)
  perform analytics.product_make_spec_set(v_shop_norate, v_p_norate, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ'));
  perform analytics.product_upsert(v_shop_norate, 'ZZ141-NORATE', 'shop ไม่มี rate เลย', null, 'spec', null, 3.5, 0.925, null, null, null, null, null, true);
  v_caught := false; v_code := null;
  begin
    perform analytics.production_cost_calc(v_shop_norate, v_p_norate, 72, 5, false);
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_log := v_log || format('[T12] shop ไม่มี rate เลย (is_complete=false) ทำให้ production_cost_calc raise 22023 (ไม่ใช่คืนต้นทุนครึ่งๆ กลางๆ): %s\n',
    case when v_caught and v_code = '22023' then 'OK' else 'FAIL' end);

  -- T13: happy path — v_p_raw ตอนนี้: cost_type=spec, silver_weight_g=3.5
  -- (จาก T7), metal=silver (คืนสภาพจาก T11)
  v_calc_a := analytics.production_cost_calc(v_shop, v_p_raw, 72, 5, false);
  v_unit_a := (v_calc_a ->> 'unit_cost')::numeric;
  v_log := v_log || format('[T13] happy path spec: unit_cost=%s (ต้อง > 0), cost_calc.is_complete=%s (คาด true): %s\n',
    v_unit_a, v_calc_a -> 'cost_calc' ->> 'is_complete',
    case when v_unit_a > 0 and (v_calc_a -> 'cost_calc' ->> 'is_complete')::boolean then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 6: ความแม่นของสูตร (exact numeric — numeric type ไม่มี floating drift)
  -----------------------------------------------------------------------
  -- T14: is_new_design true vs false ต่างกันเป๊ะ 490.00 (nre=2000+150+300=2450,
  -- หารด้วย qty=5)
  v_calc_a := analytics.production_cost_calc(v_shop, v_p_raw, 72, 5, false);
  v_calc_b := analytics.production_cost_calc(v_shop, v_p_raw, 72, 5, true);
  v_unit_a := (v_calc_a ->> 'unit_cost')::numeric;
  v_unit_b := (v_calc_b ->> 'unit_cost')::numeric;
  v_log := v_log || format('[T14] 🔴 is_new_design=true เพิ่มต้นทุนเต็ม nre/qty เป๊ะ: unit_cost(false)=%s unit_cost(true)=%s delta=%s (คาด 490.00): %s\n',
    v_unit_a, v_unit_b, round(v_unit_b - v_unit_a, 2),
    case when round(v_unit_b - v_unit_a, 2) = 490.00 then 'OK' else 'FAIL' end);

  -- T15: qty ต่างกัน (5 vs 3) ต่างกันเป๊ะ 20.00 (batch 150/3=50 - 150/5=30)
  -- — นี่คือเหตุผลที่ preview ต้องใช้ qty เดียวกับ done (เคสห้ามผ่าน #5)
  v_calc_a := analytics.production_cost_calc(v_shop, v_p_raw, 72, 5, false);
  v_calc_b := analytics.production_cost_calc(v_shop, v_p_raw, 72, 3, false);
  v_unit_a := (v_calc_a ->> 'unit_cost')::numeric;
  v_unit_b := (v_calc_b ->> 'unit_cost')::numeric;
  v_log := v_log || format('[T15] 🔴 qty ต่างกันทำให้ unit_cost ต่างกันจริง (พิสูจน์ว่า preview≠done qty จะได้เลขคนละตัว): unit_cost(qty=5)=%s unit_cost(qty=3)=%s delta=%s (คาด 20.00): %s\n',
    v_unit_a, v_unit_b, round(v_unit_b - v_unit_a, 2),
    case when round(v_unit_b - v_unit_a, 2) = 20.00 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 7: integration ผ่านใบผลิตจริง
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop, null, 'T16-21 spec integration', null);
  v_order_id := (v_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_order_id, v_p_raw, 5); -- spec, qty_planned=5
  v_item_id_1 := (v_item_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_order_id, v_p_fixed, 4); -- fixed
  v_item_id_2 := (v_item_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_order_id, v_p_spot, 3); -- spot
  v_item_id_3 := (v_item_res ->> 'id')::uuid;

  -- T16: preview ไม่ส่ง p_items -> ใช้ qty_planned (5) -> ตรงกับ direct call qty=5
  v_preview := analytics.production_order_preview(v_shop, v_order_id);
  select e into v_preview_item from jsonb_array_elements(v_preview -> 'items') e where (e ->> 'item_id')::uuid = v_item_id_1;
  v_log := v_log || format('[T16] preview ไม่ส่ง p_items ใช้ qty_planned=5: unit_cost=%s (คาดเท่ากับ direct call qty=5 = %s): %s\n',
    v_preview_item ->> 'unit_cost', v_unit_a,
    case when (v_preview_item ->> 'unit_cost')::numeric = v_unit_a then 'OK' else 'FAIL' end);

  -- T17: 🔴 preview ส่ง p_items qty_done=3 -> ต้องตรงกับ direct call qty=3
  -- (เคสห้ามผ่าน #5 — ตัวเลขที่ preview แสดง ต้อง = ตัวเลขที่ done จะบันทึก)
  v_preview := analytics.production_order_preview(v_shop, v_order_id,
    jsonb_build_array(jsonb_build_object('product_id', v_p_raw, 'qty_done', 3)));
  select e into v_preview_item from jsonb_array_elements(v_preview -> 'items') e where (e ->> 'item_id')::uuid = v_item_id_1;
  v_log := v_log || format('[T17] 🔴 preview ส่ง p_items qty_done=3: unit_cost=%s (คาดเท่ากับ direct call qty=3 = %s ไม่ใช่ qty_planned=5 = %s): %s\n',
    v_preview_item ->> 'unit_cost', v_unit_b, v_unit_a,
    case when (v_preview_item ->> 'unit_cost')::numeric = v_unit_b then 'OK' else 'FAIL' end);

  -- T18: 🔴 done ไม่ส่ง p_expected_spot_thb_per_gram บนใบที่มี spec item —
  -- ปฏิเสธ 22023 + ไม่มี lot เกิดเลยสักแถว (เคสห้ามผ่าน #2 ขยายครอบ spec)
  v_caught := false; v_code := null;
  begin
    perform analytics.production_order_done(v_shop, v_order_id);
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  select count(*) into v_lot_count from analytics.stock_lot sl
    join analytics.production_order_item poi on poi.id = sl.production_order_item_id
   where poi.production_order_id = v_order_id;
  select status into v_status_after from analytics.production_order where id = v_order_id;
  v_log := v_log || format('[T18] 🔴 done ใบมี spec item โดยไม่ส่ง p_expected_spot_thb_per_gram: raise=%s code=%s (คาด 22023), lot ที่เกิด=%s (คาด 0), order status=%s (คาด open): %s\n',
    v_caught, coalesce(v_code, '(none)'), v_lot_count, v_status_after,
    case when v_caught and v_code = '22023' and v_lot_count = 0 and v_status_after = 'open' then 'OK' else 'FAIL — ด่านราคาเงินรั่วสำหรับโหมด spec' end);

  -- T19: done สำเร็จด้วย qty_done=3 (≠ qty_planned=5) — unit_cost/lot ต้อง
  -- ตรงกับ qty=3 (v_unit_b) ไม่ใช่ qty=5 (v_unit_a) — พิสูจน์ preview=done เป๊ะ
  -- และพิสูจน์ prev_cost_type='spec' ผ่าน CHECK ไม่ raise 23514 (เคสห้ามผ่าน #4)
  v_res := analytics.production_order_done(v_shop, v_order_id,
    jsonb_build_array(jsonb_build_object('product_id', v_p_raw, 'qty_done', 3)),
    v_spot_price);

  select unit_cost, cost_calc into v_poi_unit_cost, v_poi_cost_calc
    from analytics.production_order_item where id = v_item_id_1;
  select unit_cost into v_lot_unit_cost from analytics.stock_lot where production_order_item_id = v_item_id_1;
  select status into v_status_after from analytics.production_order where id = v_order_id;
  v_log := v_log || format('[T19] done qty_done=3 (≠qty_planned=5): production_order_item.unit_cost=%s stock_lot.unit_cost=%s (ทั้งคู่คาด=%s ค่า qty=3 ไม่ใช่ %s ค่า qty=5), order status=%s (คาด done, ไม่ raise 23514 จาก prev_cost_type=spec): %s\n',
    v_poi_unit_cost, v_lot_unit_cost, v_unit_b, v_unit_a, v_status_after,
    case when v_poi_unit_cost = v_unit_b and v_lot_unit_cost = v_unit_b and v_status_after = 'done' then 'OK' else 'FAIL' end);

  -- T20: cost_calc snapshot ถูกเขียนจริง (มี breakdown เต็ม ไม่ใช่ null)
  v_log := v_log || format('[T20] production_order_item.cost_calc snapshot ถูกเขียน (is_complete=%s, unit_cost ใน snapshot=%s ตรงกับ unit_cost ของ item=%s): %s\n',
    v_poi_cost_calc ->> 'is_complete', v_poi_cost_calc ->> 'unit_cost', v_poi_unit_cost,
    case when v_poi_cost_calc is not null and (v_poi_cost_calc ->> 'is_complete')::boolean
      and (v_poi_cost_calc ->> 'unit_cost')::numeric = v_poi_unit_cost
    then 'OK' else 'FAIL' end);

  -- T21: ใบผสม fixed+spot+spec (v_order_id เดียวกัน) — done() ตัวเดียวกันนั้น
  -- ต้องปิด item fixed/spot ให้ครบด้วย ไม่ใช่แค่ spec (ห้ามพัง)
  select qty_on_hand into v_stock_after from public.central_stock where product_id = v_p_fixed;
  v_log := v_log || format('[T21] ใบผสม fixed+spot+spec: fixed item central_stock=%s (คาด 4, qty_planned เพราะไม่ได้ override), order status=%s (คาด done): %s\n',
    v_stock_after, v_status_after,
    case when v_stock_after = 4 and v_status_after = 'done' then 'OK' else 'FAIL' end);
  select qty_on_hand into v_stock_after from public.central_stock where product_id = v_p_spot;
  v_log := v_log || format('[T21b] spot item central_stock=%s (คาด 3): %s\n',
    v_stock_after, case when v_stock_after = 3 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 8: static — overload/grant/CHECK constraint
  -----------------------------------------------------------------------
  select count(*) into v_overload_count from pg_proc
    where pronamespace = 'analytics'::regnamespace and proname = 'production_cost_calc';
  v_log := v_log || format('[T22a] analytics.production_cost_calc มี %s ตัว (คาด 1 — ไม่มี overload ค้างจาก signature เดิม): %s\n',
    v_overload_count, case when v_overload_count = 1 then 'OK' else 'FAIL' end);

  select count(*) into v_overload_count from pg_proc
    where pronamespace = 'analytics'::regnamespace and proname = 'production_order_preview';
  v_log := v_log || format('[T22b] analytics.production_order_preview มี %s ตัว (คาด 1): %s\n',
    v_overload_count, case when v_overload_count = 1 then 'OK' else 'FAIL' end);

  select has_function_privilege('anon', 'analytics.production_cost_calc(uuid,uuid,numeric,int,boolean)', 'execute') into v_priv_anon;
  select has_function_privilege('authenticated', 'analytics.production_cost_calc(uuid,uuid,numeric,int,boolean)', 'execute') into v_priv_auth;
  select has_function_privilege('service_role', 'analytics.production_cost_calc(uuid,uuid,numeric,int,boolean)', 'execute') into v_priv_svc;
  v_log := v_log || format('[T23a] production_cost_calc grant anon=%s auth=%s svc=%s (คาด f/f/t — internal-only ตาม oem-quote-invariants #1): %s\n',
    v_priv_anon, v_priv_auth, v_priv_svc,
    case when v_priv_anon = false and v_priv_auth = false and v_priv_svc then 'OK' else 'FAIL' end);

  select has_function_privilege('anon', 'analytics.product_make_spec_set(uuid,uuid,jsonb,uuid)', 'execute') into v_priv_anon;
  select has_function_privilege('authenticated', 'analytics.product_make_spec_set(uuid,uuid,jsonb,uuid)', 'execute') into v_priv_auth;
  v_log := v_log || format('[T23b] product_make_spec_set grant anon=%s (คาด f) auth=%s (คาด t — เหมือน product_upsert): %s\n',
    v_priv_anon, v_priv_auth,
    case when v_priv_anon = false and v_priv_auth then 'OK' else 'FAIL' end);

  select pg_get_constraintdef(oid) into v_condef from pg_constraint
    where conrelid = 'public.product'::regclass and conname = 'product_cost_type_check';
  v_log := v_log || format('[T24a] product_cost_type_check ยอมรับ spec (def=%s): %s\n',
    v_condef, case when v_condef ilike '%spec%' then 'OK' else 'FAIL' end);

  select pg_get_constraintdef(oid) into v_condef from pg_constraint
    where conrelid = 'analytics.production_order_item'::regclass and conname = 'production_order_item_prev_cost_type_check';
  v_log := v_log || format('[T24b] production_order_item_prev_cost_type_check ยอมรับ spec (def=%s): %s\n',
    v_condef, case when v_condef ilike '%spec%' then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 9: 🔴 v_dim_product.effective_unit_cost ของ SKU จริงไม่ขยับ (เคส
  -- ห้ามผ่าน #1 — 0141 ไม่แตะ view นี้เลย ต้องเหมือนเดิมเป๊ะทุกแถว)
  -----------------------------------------------------------------------
  select string_agg(product_id::text || ':' || coalesce(effective_unit_cost::text, 'NULL'), ',' order by product_id)
    into v_after_dim_snapshot
  from analytics.v_dim_product
  where shop_id not in (v_shop, v_shop_norate);

  v_log := v_log || format('[T25] 🔴 v_dim_product.effective_unit_cost ของ SKU จริงทั้งหมด (ก่อน 0141) ตรงเป๊ะกับหลัง 0141 (%s แถว): %s\n',
    (select count(*) from analytics.v_dim_product where shop_id not in (v_shop, v_shop_norate)),
    case when v_before_dim_snapshot = v_after_dim_snapshot then 'OK' else 'FAIL — effective_unit_cost เปลี่ยน ตรวจ diff ด่วน' end);

  v_log := v_log || E'\n=== ALL CHECKS LOGGED ABOVE — ตรวจทุกบรรทัดหา FAIL (transaction จะ rollback เสมอ) ===\n';
  raise exception '%', v_log;
end $$;

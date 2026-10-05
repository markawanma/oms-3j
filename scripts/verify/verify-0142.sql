-- scripts/verify-0142.sql
--
-- ชุดทดสอบของ supabase/migrations/0142_make_spec_hardening.sql (ปิด 3 HIGH +
-- 2 MEDIUM ที่ security review ของ 0141 เจอ)
--
-- ตาม skill 3j-migration-traps ข้อ 11: do $$ ... $$ block เดียว จบด้วย
-- `raise exception` เสมอ ⇒ ทั้ง transaction rollback ไม่ว่าผลจะผ่าน/ไม่ผ่าน —
-- อ่านผลจาก error message นี้. ใช้เป็นทั้ง dry-run (Part 0 ติดตั้ง DDL ของ
-- 0142 ทับของเดิมในทรานแซกชันนี้เอง — สมมติว่า 0131/0132/0139/0140/0141
-- apply ไปแล้วจริงบน DB เป้าหมาย ไม่ต้องลอก DDL ของไฟล์เหล่านั้นมาซ้ำ) และ
-- post-apply verify (รันซ้ำหลัง apply จริงผ่าน MCP apply_migration — Part 0
-- เป็น idempotent ทั้งหมด: create-or-replace function, drop+add constraint —
-- รันซ้ำได้ปลอดภัย) แบบเดียวกับ verify-0139.sql / verify-0141.sql
--
-- 💰 แตะต้นทุน/สต็อก/CHECK constraint ของ public.product ทั้งตาราง — shop/SKU
-- สังเคราะห์ทั้งหมด (prefix ZZ142) สร้างขึ้นในทรานแซกชันนี้เอง ไม่แตะของจริง
-- เลย ยกเว้น Part 1/Part 9 ที่ "อ่าน" (ไม่เขียน) v_dim_product ของ SKU จริง
-- เพื่อพิสูจน์ว่าไม่ขยับ
--
-- โครงสร้างไฟล์:
--   Part 0  — apply 0142 DDL verbatim (5 create-or-replace function + 2 alter
--             table add constraint)
--   Part 1  — snapshot v_dim_product.effective_unit_cost ของ SKU จริงทั้งหมด
--             ก่อนแตะอะไรเลย (เทียบใน Part 9 — เคสห้ามผ่าน #13)
--   Part 2  — setup: shop สังเคราะห์ + SKU ทุกแบบ + seed oem_cost_rate 24 คู่
--             (ให้ is_complete=true ได้จริง) + 1 คู่พิเศษสำหรับ T7b (rate เก่า
--             ปี 2020 ค่าต่างจากปัจจุบันมาก — พิสูจน์ว่า as_of_date ที่ฉีดมา
--             ไม่มีผล) + ราคาเงินวันนี้
--   Part 3  — HIGH-1: product_make_spec_clear บน spot (T1) / fixed (T2) /
--             spec (T3)
--   Part 4  — HIGH-2: product_upsert ปฏิเสธพลิกออกจาก spec (T4) /
--             product_upsert_bulk แถวไม่มี cost_type ก็ถูกปฏิเสธเหมือนกัน
--             (T5, ไม่ใช่พลิกเงียบ)
--   Part 5  — HIGH-2 ชั้น CHECK: update ตรง cost_type='spec' make_spec=null
--             ถูกปฏิเสธ (T6)
--   Part 6  — MEDIUM-1: CHECK ปฏิเสธการฉีด as_of_date ผ่าน UPDATE ตรง (T7a) +
--             ถึงฉีดผ่านได้ (ปลด constraint ชั่วคราวในทรานแซกชันนี้ที่ยังไง
--             ก็ rollback อยู่แล้ว) ก็ไม่เปลี่ยนต้นทุน (T7b)
--   Part 7  — HIGH-3: SKU spec ไม่มีต้นทุน ⇒ transform ตั้ง estimated + โน้ต
--             (T8) เทียบกับ SKU ปกติที่มีต้นทุนยัง actual เหมือนเดิมในตัวเดียว
--             (T11+T12 รวมกัน — ลอก T1 จาก verify-0136.sql)
--   Part 8  — MEDIUM-2: breakdown 4 ก้อนบวกกลับ = unit_cost เป๊ะ หลาย qty
--             ทั้งติ๊ก/ไม่ติ๊กแบบใหม่ (T9)
--   Part 9  — 🟢: product_make_spec_set ปฏิเสธ SKU live*/ปิดใช้งาน (T10)
--   Part 10 — integration: ใบผลิตผสม fixed+spot+spec ตัวเดียว preview+done
--             ครบ (T14)
--   Part 11 — static: overload count + grant ครบ 5 ฟังก์ชัน (T15) + advisory
--             lock ของ transform_pending_order_lines ยังอยู่
--   Part 12 — 🔴 v_dim_product.effective_unit_cost ของ SKU จริงไม่ขยับ (T13)

do $$
declare
  v_log text := E'\n=== verify 0142 (make_spec hardening: 3 HIGH + 2 MEDIUM) ===\n';

  v_before_dim_snapshot text;
  v_after_dim_snapshot  text;

  v_shop uuid := gen_random_uuid();
  v_rate_date date := (now() at time zone 'Asia/Bangkok')::date - 1;
  v_spot_price numeric := 72;

  v_p_fixed        uuid; -- fixed, unit_cost=100 — ใช้ regression + T6 + T11/T12
  v_p_spot         uuid; -- spot, weight=10 purity=0.925 labor=20 — T1
  v_p_spec_clear   uuid; -- ตั้ง spec แล้วเคลียร์ทิ้งใน T3
  v_p_spec_main    uuid; -- ตั้ง spec ค้างไว้ตลอด — T4,T5,T7a,T7b,T9
  v_p_spec_nocost  uuid; -- spec แต่ไม่เคยมี unit_cost — T8
  v_p_spot2        uuid; -- spot อีกตัว ไว้ผสมในใบผลิต T14

  v_make_spec jsonb;
  v_res       jsonb;
  v_calc      jsonb;
  v_calc_b    jsonb;

  v_caught boolean;
  v_code   text;

  v_status_after text;
  v_before_cost  numeric;
  v_after_cost   numeric;

  v_bulk_status text;
  v_bulk_error  text;

  v_unit_baseline numeric;
  v_unit_injected numeric;

  v_metal_r numeric; v_labor_r numeric; v_batch_r numeric; v_nre_r numeric; v_unit_c numeric;

  v_ch    uuid;
  v_batch uuid;
  v_fo_normal  uuid;
  v_fo_nocost  uuid;

  v_order_id uuid;
  v_done_res jsonb;
  v_items    jsonb;

  v_overload_count int;
  v_def text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -----------------------------------------------------------------------
  -- 🔴 Part 1: snapshot v_dim_product.effective_unit_cost ของ SKU จริงทั้งหมด
  -- ก่อนแตะอะไรเลย — ใช้เทียบใน Part 12 (0142 ไม่แตะ v_dim_product เลย และ
  -- HIGH-1/HIGH-2 ต้องไม่ทำให้ SKU จริงตัวไหนขยับ)
  -----------------------------------------------------------------------
  select string_agg(product_id::text || ':' || coalesce(effective_unit_cost::text, 'NULL'), ',' order by product_id)
    into v_before_dim_snapshot
  from analytics.v_dim_product;

  -----------------------------------------------------------------------
  -- Part 0: apply 0142's DDL verbatim
  -----------------------------------------------------------------------

  -- §1: product_make_spec_clear (HIGH-1)
  execute $ddl_clear$
    create or replace function analytics.product_make_spec_clear(
      p_shop_id    uuid,
      p_product_id uuid,
      p_actor      uuid default null
    )
     returns jsonb
     language plpgsql
     security definer
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body_clear$
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

      if v_old.cost_type <> 'spec' then
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
    $body_clear$;

    revoke execute on function analytics.product_make_spec_clear(uuid, uuid, uuid) from public, anon, authenticated;
    grant execute on function analytics.product_make_spec_clear(uuid, uuid, uuid) to service_role;
  $ddl_clear$;

  -- §2: product_upsert (HIGH-2 ชั้น 1)
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

      if v_old.id is not null and v_old.cost_type = 'spec' and p_cost_type <> 'spec' then
        raise exception 'product_upsert: SKU % อยู่โหมด "คำนวณจากสเปค" (spec) อยู่ — พลิกออกจากโหมดนี้ต้องผ่าน analytics.product_make_spec_clear เท่านั้น (กันต้นทุนพลิกเงียบโดยไม่ผ่าน audit log)', btrim(p_sku) using errcode = '22023';
      end if;

      insert into public.product (
        shop_id, sku, name, category, cost_type, unit_cost, silver_weight_g,
        silver_purity, labor_cost, list_price, barcode, supplier, note, is_active,
        -- 0142: พา make_spec เดิมไปกับแถวที่เสนอด้วย (Postgres ตรวจ CHECK
        -- กับแถวนั้นก่อนจะรู้ว่าชน unique) ไม่งั้น upsert SKU โหมด spec โดน 23514
        make_spec
      ) values (
        p_shop_id, btrim(p_sku), btrim(p_name), p_category, p_cost_type, p_unit_cost, p_silver_weight_g,
        p_silver_purity, p_labor_cost, p_list_price, p_barcode, p_supplier, p_note, coalesce(p_is_active, true),
        v_old.make_spec
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

  -- §3: CHECK constraint HIGH-2 ชั้น 2 — plain DDL ไม่มี dollar-quote ไม่ต้อง execute
  alter table public.product drop constraint if exists product_spec_requires_make_spec_check;
  alter table public.product add constraint product_spec_requires_make_spec_check
    check (cost_type <> 'spec' or make_spec is not null);

  -- §4: production_cost_calc (MEDIUM-1 + MEDIUM-2 + 🟢 not-true fix)
  execute $ddl_cost_calc$
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
      v_metal_per_piece_r numeric;
      v_labor_per_piece_r numeric;
      v_batch_per_piece_r numeric;
      v_as_of_used      date;
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
        v_as_of_used := (now() at time zone 'Asia/Bangkok')::date;

        v_spec_input := v_product.make_spec || jsonb_build_object(
          'qty', p_qty,
          'weight_g', v_product.silver_weight_g,
          'purity', coalesce(v_product.silver_purity, 0.925),
          'is_new_design', coalesce(p_is_new_design, false),
          'metal_price_thb_per_gram', v_spot,
          'as_of_date', v_as_of_used
        );

        v_cost_result := analytics.oem_cost_calc(p_shop_id, v_spec_input);
        v_is_complete := (v_cost_result ->> 'is_complete')::boolean;
        if v_is_complete is not true then
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

        v_metal_per_piece_r := round(v_metal_per_piece, 2);
        v_labor_per_piece_r := round(v_labor_per_piece, 2);
        v_batch_per_piece_r := v_unit_cost - v_metal_per_piece_r - v_labor_per_piece_r - v_nre_per_piece;

        v_cost_calc := jsonb_build_object(
          'is_complete', v_is_complete,
          'missing', v_cost_result -> 'missing',
          'price_source', v_cost_result ->> 'price_source',
          'as_of_date', v_cost_result -> '_raw' ->> 'as_of_date',
          'labor_steps', v_cost_result -> 'labor_steps',
          'batch_lines', v_cost_result -> 'batch_lines',
          'metal_per_piece', v_metal_per_piece_r,
          'labor_per_piece', v_labor_per_piece_r,
          'batch_per_piece', v_batch_per_piece_r,
          'cost_piece', v_metal_per_piece_r + v_labor_per_piece_r + v_batch_per_piece_r,
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

  -- §5: CHECK constraint MEDIUM-1 (forbidden keys) — plain DDL
  alter table public.product drop constraint if exists product_make_spec_forbidden_keys_check;
  alter table public.product add constraint product_make_spec_forbidden_keys_check
    check (make_spec is null or not (make_spec ?| array['as_of_date', 'is_new_design', 'metal_price_thb_per_gram']));

  -- §6: product_make_spec_set (🟢 is_active/live guard + grant tighten)
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

      if not v_old.is_active then
        raise exception 'product_make_spec_set: SKU % ปิดใช้งานแล้ว ตั้งสเปคไม่ได้', v_old.sku using errcode = '22023';
      end if;
      if v_old.sku ~* '^live' then
        raise exception 'product_make_spec_set: SKU % เป็น SKU เฉพาะไลฟ์ (live*) ผลิตเองไม่ได้ ตั้งสเปคไม่ได้', v_old.sku using errcode = '22023';
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
    grant execute on function analytics.product_make_spec_set(uuid, uuid, jsonb, uuid) to service_role;
  $ddl_spec_set$;

  -- §7: transform_pending_order_lines (HIGH-3)
  execute $ddl_transform$
    create or replace function analytics.transform_pending_order_lines(p_shop_id uuid, p_batch_id uuid)
     returns table(transformed_count integer, orphan_count integer, skipped_blank_count integer, unknown_sku_count integer, errored_count integer)
     language plpgsql
     security definer
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body_transform$
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

            if v_product_id is not null and v_unit_cost is null then
              v_weak_order := true;
              v_match_note := coalesce(v_match_note || ' | ', '')
                || 'SKU ' || v_item.sku_raw || ' จับคู่ได้แต่ยังไม่มีต้นทุน (unit_cost เป็น null) — กำไรของใบนี้เป็นค่าประมาณ ตรวจที่ /catalog';
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
    $body_transform$;

    revoke execute on function analytics.transform_pending_order_lines(uuid, uuid) from public, anon, authenticated;
    grant execute on function analytics.transform_pending_order_lines(uuid, uuid) to service_role;
  $ddl_transform$;

  v_log := v_log || '[Part 0] apply 0142 DDL verbatim (5 function + 2 constraint): OK (no error)' || E'\n';

  -----------------------------------------------------------------------
  -- Part 2: setup
  -----------------------------------------------------------------------
  insert into public.shop (id, name) values (v_shop, 'ZZ TEST verify-0142');

  select id into v_ch from analytics.dim_channel where code = 'tiktok';
  if v_ch is null then
    raise exception 'verify-0142 setup: analytics.dim_channel ไม่มีแถว tiktok';
  end if;

  v_p_fixed  := analytics.product_upsert(v_shop, 'ZZ142-FIXED', 'regression fixed', null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_spot   := analytics.product_upsert(v_shop, 'ZZ142-SPOT',  'regression spot',  null, 'spot', null, 10, 0.925, 20, null, null, null, null, true);
  v_p_spot2  := analytics.product_upsert(v_shop, 'ZZ142-SPOT2', 'spot สำหรับใบผลิตผสม', null, 'spot', null, 5, 0.925, 10, null, null, null, null, true);
  v_p_spec_clear  := analytics.product_upsert(v_shop, 'ZZ142-SPEC-CLEAR', 'จะเคลียร์ใน T3', null, 'fixed', 50, null, null, null, null, null, null, null, true);
  v_p_spec_main   := analytics.product_upsert(v_shop, 'ZZ142-SPEC-MAIN', 'spec ค้างไว้ตลอด', null, 'fixed', 60, null, null, null, null, null, null, null, true);
  v_p_spec_nocost := analytics.product_upsert(v_shop, 'ZZ142-SPEC-NOCOST', 'spec ไม่มีต้นทุนเลย', null, 'fixed', null, null, null, null, null, null, null, null, true);

  perform analytics.oem_metal_price_set(v_shop, 'silver', v_spot_price, (now() at time zone 'Asia/Bangkok')::date, 'manual');

  -- rate ปกติ (21 คู่ + 3 คู่ NRE) เหมือน verify-0141's Part 2 — ให้
  -- item_kind='แหวน'/polish_tier='เรียบ' silver ไม่มีพลอย/ไม่มีชุบ
  -- is_complete=true ได้จริง
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
    (v_shop, 'rubber_mold_cost_thb', '-', v_rate_date, 300),
    -- T7b: rate เก่าปี 2020 ของ pack_cost_thb_per_piece ค่าสูงลิ่ว (999 แทน 5)
    -- — ถ้า as_of_date ที่ฉีดผ่าน make_spec มีผลจริง unit_cost จะพุ่งขึ้นราว
    -- +994 บาท/ชิ้น ทันที (pack cost บวกตรงเข้า labor_sum ไม่ผ่านตัวหาร)
    (v_shop, 'pack_cost_thb_per_piece', '-', '2020-01-01'::date, 999);

  v_log := v_log || '[Part 2] setup 1 shop + 6 SKU สังเคราะห์ (prefix ZZ142) + 25 rate (รวม rate เก่าปี 2020 สำหรับ T7b) + ราคาเงินวันนี้: OK' || E'\n';

  -----------------------------------------------------------------------
  -- Part 3 (HIGH-1): product_make_spec_clear
  -----------------------------------------------------------------------
  -- T1: clear บน SKU โหมด spot — ต้องยังเป็น spot เป๊ะ ไม่แตะอะไรเลย (เดิมจะ
  -- พลิกเป็น fixed เงียบๆ — บั๊กที่พิสูจน์แล้วจริงบนแท่งเงิน 6 ตัว)
  select analytics.v_dim_product.effective_unit_cost into v_before_cost from analytics.v_dim_product where product_id = v_p_spot;
  v_res := analytics.product_make_spec_clear(v_shop, v_p_spot);
  select cost_type into v_status_after from public.product where id = v_p_spot;
  select analytics.v_dim_product.effective_unit_cost into v_after_cost from analytics.v_dim_product where product_id = v_p_spot;
  v_log := v_log || format('[T1] 🔴 clear บน spot: cost_type หลัง=%s (คาด spot ไม่ใช่ fixed), effective_unit_cost ก่อน=%s หลัง=%s (ต้องเท่ากัน), already_cleared=%s: %s\n',
    v_status_after, v_before_cost, v_after_cost, v_res ->> 'already_cleared',
    case when v_status_after = 'spot' and v_before_cost = v_after_cost and (v_res ->> 'already_cleared')::boolean
    then 'OK' else 'FAIL' end);

  -- T2: clear บน SKU โหมด fixed — idempotent เหมือนเดิม
  v_res := analytics.product_make_spec_clear(v_shop, v_p_fixed);
  select cost_type, unit_cost into v_status_after, v_before_cost from public.product where id = v_p_fixed;
  v_log := v_log || format('[T2] clear บน fixed: cost_type=%s (คาด fixed) unit_cost=%s (คาด 100) already_cleared=%s: %s\n',
    v_status_after, v_before_cost, v_res ->> 'already_cleared',
    case when v_status_after = 'fixed' and v_before_cost = 100 and (v_res ->> 'already_cleared')::boolean
    then 'OK' else 'FAIL' end);

  -- T3: clear บน SKU โหมด spec จริง — ต้องยังทำงาน (กลับเป็น fixed + make_spec null)
  perform analytics.product_make_spec_set(v_shop, v_p_spec_clear, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ'));
  v_res := analytics.product_make_spec_clear(v_shop, v_p_spec_clear);
  select cost_type, make_spec into v_status_after, v_make_spec from public.product where id = v_p_spec_clear;
  v_log := v_log || format('[T3] clear บน spec: cost_type=%s (คาด fixed) make_spec=%s (คาด null) already_cleared=%s (คาด false): %s\n',
    v_status_after, v_make_spec, v_res ->> 'already_cleared',
    case when v_status_after = 'fixed' and v_make_spec is null and not (v_res ->> 'already_cleared')::boolean
    then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 4 (HIGH-2 ชั้น 1): product_upsert / product_upsert_bulk
  -----------------------------------------------------------------------
  perform analytics.product_make_spec_set(v_shop, v_p_spec_main, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ'));
  perform analytics.product_upsert(v_shop, 'ZZ142-SPEC-MAIN', 'spec ค้างไว้ตลอด', null, 'spec', null, 3.5, 0.925, null, null, null, null, null, true);

  -- T4: product_upsert(cost_type='fixed') บน SKU spec ⇒ ปฏิเสธ 22023
  v_caught := false; v_code := null;
  begin
    perform analytics.product_upsert(v_shop, 'ZZ142-SPEC-MAIN', 'พยายามพลิกออก', null, 'fixed', 999, null, null, null, null, null, null, null, true);
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  select cost_type into v_status_after from public.product where id = v_p_spec_main;
  v_log := v_log || format('[T4] product_upsert(cost_type=fixed) บน SKU spec ถูกปฏิเสธ (errcode=%s), cost_type ยังเป็น %s (คาด spec ไม่ขยับ): %s\n',
    coalesce(v_code, '(none)'), v_status_after,
    case when v_caught and v_code = '22023' and v_status_after = 'spec' then 'OK' else 'FAIL' end);

  -- T5: product_upsert_bulk แถวไม่มี cost_type บน SKU spec ⇒ ถูกปฏิเสธ (ไม่ใช่พลิกเงียบ)
  select status, error into v_bulk_status, v_bulk_error
    from analytics.product_upsert_bulk(v_shop, jsonb_build_array(jsonb_build_object('sku', 'ZZ142-SPEC-MAIN', 'name', 'พยายามพลิกออกผ่าน bulk')))
    limit 1;
  select cost_type into v_status_after from public.product where id = v_p_spec_main;
  v_log := v_log || format('[T5] bulk แถวไม่มี cost_type บน SKU spec: status=%s (คาด error) error มีคำว่า spec=%s, cost_type ยังเป็น %s (คาด spec): %s\n',
    v_bulk_status, (v_bulk_error like '%spec%'), v_status_after,
    case when v_bulk_status = 'error' and v_bulk_error like '%spec%' and v_status_after = 'spec' then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 5 (HIGH-2 ชั้น 2 — table CHECK)
  -----------------------------------------------------------------------
  -- T6: update ตรง cost_type='spec' make_spec=null ⇒ CHECK ปฏิเสธ (ใช้ v_p_fixed
  -- ซึ่งไม่เคยตั้งสเปคเลย make_spec เป็น null อยู่แล้ว)
  v_caught := false; v_code := null;
  begin
    update public.product set cost_type = 'spec' where id = v_p_fixed; -- make_spec ยัง null
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  select cost_type into v_status_after from public.product where id = v_p_fixed;
  v_log := v_log || format('[T6] update ตรง cost_type=spec make_spec=null ถูก CHECK ปฏิเสธ (errcode=%s คาด 23514), cost_type ยังเป็น %s (คาด fixed ไม่ขยับ): %s\n',
    coalesce(v_code, '(none)'), v_status_after,
    case when v_caught and v_code = '23514' and v_status_after = 'fixed' then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 6 (MEDIUM-1): as_of_date injection
  -----------------------------------------------------------------------
  -- T7a: update ตรงฉีด as_of_date เข้า make_spec ที่มีอยู่แล้ว (v_p_spec_main) ⇒ CHECK ปฏิเสธ
  v_caught := false; v_code := null;
  begin
    update public.product set make_spec = make_spec || jsonb_build_object('as_of_date', '2020-01-01') where id = v_p_spec_main;
  exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
  end;
  select make_spec into v_make_spec from public.product where id = v_p_spec_main;
  v_log := v_log || format('[T7a] update ตรงฉีด as_of_date ลง make_spec ถูก CHECK ปฏิเสธ (errcode=%s คาด 23514), make_spec ไม่มีคีย์ as_of_date (%s): %s\n',
    coalesce(v_code, '(none)'), not (v_make_spec ? 'as_of_date'),
    case when v_caught and v_code = '23514' and not (v_make_spec ? 'as_of_date') then 'OK' else 'FAIL' end);

  -- T7b: baseline ก่อน (ไม่มี as_of_date ปน) แล้วปลด CHECK ชั่วคราว (ทรานแซกชัน
  -- นี้ rollback อยู่แล้วจาก raise exception ท้ายไฟล์ — ปลอดภัย) ฉีด
  -- as_of_date=2020-01-01 (ปีที่ pack_cost=999 แทน 5) ตรงๆ แล้วพิสูจน์ว่า
  -- production_cost_calc ยังใช้เรตวันนี้ (5) ไม่ใช่ปี 2020 (999) — ถ้า MEDIUM-1
  -- ไม่ทำงาน unit_cost จะต่างกันราว 994 บาท/ชิ้นทันที
  v_calc := analytics.production_cost_calc(v_shop, v_p_spec_main, 72, 5, false);
  v_unit_baseline := (v_calc ->> 'unit_cost')::numeric;

  alter table public.product drop constraint product_make_spec_forbidden_keys_check;
  update public.product set make_spec = make_spec || jsonb_build_object('as_of_date', '2020-01-01') where id = v_p_spec_main;
  v_calc_b := analytics.production_cost_calc(v_shop, v_p_spec_main, 72, 5, false);
  v_unit_injected := (v_calc_b ->> 'unit_cost')::numeric;
  update public.product set make_spec = make_spec - 'as_of_date' where id = v_p_spec_main; -- คืนสภาพ
  alter table public.product add constraint product_make_spec_forbidden_keys_check
    check (make_spec is null or not (make_spec ?| array['as_of_date', 'is_new_design', 'metal_price_thb_per_gram']));

  v_log := v_log || format('[T7b] 🔴 ฉีด as_of_date=2020-01-01 ได้ (ปลด CHECK ชั่วคราวเพื่อทดสอบ) แต่ unit_cost ไม่ขยับ: baseline=%s injected=%s (ต้องเท่ากันเป๊ะ ไม่ใช่ +994): %s\n',
    v_unit_baseline, v_unit_injected,
    case when v_unit_baseline = v_unit_injected then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 7 (HIGH-3): transform_pending_order_lines
  -----------------------------------------------------------------------
  perform analytics.product_make_spec_set(v_shop, v_p_spec_nocost, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ'));
  -- v_p_spec_nocost: cost_type='spec' แต่ unit_cost คอลัมน์ยังเป็น null เสมอ
  -- (product_make_spec_set ไม่แตะ unit_cost เลย) ⇒ v_dim_product.effective_
  -- unit_cost = null (else p.unit_cost) — จำลองเคสจริงของ HIGH-3

  insert into analytics.stg_import_batch (id, shop_id, source_type, file_hash)
    values (gen_random_uuid(), v_shop, 'excel_line_item_report', 'zz142-normal-hash')
    returning id into v_batch;
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
    values (v_shop, 'ZZ142-O-NORMAL', v_ch, (now() at time zone 'Asia/Bangkok')::date, 300)
    returning id into v_fo_normal;
  insert into analytics.stg_order_line_import (shop_id, batch_id, source_order_no, line_no, sku_raw, product_name_raw, qty, unit_price, import_status, raw)
    values (v_shop, v_batch, 'ZZ142-O-NORMAL', 1, 'ZZ142-FIXED', 'ทดสอบ transform ปกติ', 3, 100, 'pending', '{}'::jsonb);

  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
    values (v_shop, 'ZZ142-O-NOCOST', v_ch, (now() at time zone 'Asia/Bangkok')::date, 300)
    returning id into v_fo_nocost;
  insert into analytics.stg_order_line_import (shop_id, batch_id, source_order_no, line_no, sku_raw, product_name_raw, qty, unit_price, import_status, raw)
    values (v_shop, v_batch, 'ZZ142-O-NOCOST', 1, 'ZZ142-SPEC-NOCOST', 'ทดสอบ transform spec ไม่มีต้นทุน', 2, 100, 'pending', '{}'::jsonb);

  perform analytics.transform_pending_order_lines(v_shop, v_batch);

  -- T12 (ลอก T1 จาก verify-0136.sql) + T11 (ไม่ regress): order ปกติต้องแปลง
  -- ครบ cogs ถูก และ profit_status='actual' เหมือนเดิม
  declare
    v_items_n int; v_cogs_n numeric; v_status_n text;
  begin
    select count(*), max(fo.cogs), max(fo.profit_status::text) into v_items_n, v_cogs_n, v_status_n
      from analytics.fact_order_item foi join analytics.fact_order fo on fo.id = foi.fact_order_id
     where foi.fact_order_id = v_fo_normal;
    v_log := v_log || format('[T11+T12] order ปกติ (SKU มีต้นทุนจริง): fact_order_item=%s (คาด 1) cogs=%s (คาด 300 = 3x100) profit_status=%s (คาด actual — ห้าม regress): %s\n',
      v_items_n, v_cogs_n, v_status_n,
      case when v_items_n = 1 and v_cogs_n = 300 and v_status_n = 'actual' then 'OK' else 'FAIL' end);
  end;

  -- T8: order ที่มี SKU spec ไม่มีต้นทุน ⇒ profit_status='estimated' + โน้ตชื่อ SKU
  declare
    v_items_c int; v_cogs_c numeric; v_status_c text; v_note_c text;
  begin
    select count(*), max(fo.cogs), max(fo.profit_status::text) into v_items_c, v_cogs_c, v_status_c
      from analytics.fact_order_item foi join analytics.fact_order fo on fo.id = foi.fact_order_id
     where foi.fact_order_id = v_fo_nocost;
    select error_detail into v_note_c from analytics.stg_order_line_import
      where shop_id = v_shop and source_order_no = 'ZZ142-O-NOCOST' and line_no = 1;
    v_log := v_log || format('[T8] 🔴 order ที่มี SKU spec ไม่มีต้นทุน: fact_order_item=%s (คาด 1, product_id ไม่ null) cogs=%s (คาด 0) profit_status=%s (คาด estimated) โน้ต="%s" (ต้องมีคำว่า unit_cost เป็น null): %s\n',
      v_items_c, v_cogs_c, v_status_c, v_note_c,
      case when v_items_c = 1 and v_cogs_c = 0 and v_status_c = 'estimated' and v_note_c like '%unit_cost เป็น null%' then 'OK' else 'FAIL' end);
  end;

  -----------------------------------------------------------------------
  -- Part 8 (MEDIUM-2): breakdown บวกกลับ = unit_cost เป๊ะ
  -----------------------------------------------------------------------
  declare
    v_qtys int[] := array[3, 5, 7, 11];
    v_q int;
    v_nd boolean;
    v_all_ok boolean := true;
    v_detail text := '';
  begin
    foreach v_q in array v_qtys loop
      foreach v_nd in array array[false, true] loop
        v_calc := analytics.production_cost_calc(v_shop, v_p_spec_main, 72, v_q, v_nd);
        v_metal_r := (v_calc -> 'cost_calc' ->> 'metal_per_piece')::numeric;
        v_labor_r := (v_calc -> 'cost_calc' ->> 'labor_per_piece')::numeric;
        v_batch_r := (v_calc -> 'cost_calc' ->> 'batch_per_piece')::numeric;
        v_nre_r   := (v_calc -> 'cost_calc' ->> 'nre_per_piece')::numeric;
        v_unit_c  := (v_calc -> 'cost_calc' ->> 'unit_cost')::numeric;
        if (v_metal_r + v_labor_r + v_batch_r + v_nre_r) <> v_unit_c then
          v_all_ok := false;
          v_detail := v_detail || format('qty=%s is_new_design=%s: sum=%s unit_cost=%s ไม่เท่ากัน | ',
            v_q, v_nd, v_metal_r + v_labor_r + v_batch_r + v_nre_r, v_unit_c);
        end if;
      end loop;
    end loop;
    v_log := v_log || format('[T9] breakdown 4 ก้อนบวกกลับ = unit_cost เป๊ะ ทุก qty (3,5,7,11) x is_new_design(false,true) = 8 เคส: %s\n',
      case when v_all_ok then 'OK' else 'FAIL — ' || v_detail end);
  end;

  -----------------------------------------------------------------------
  -- Part 9 (🟢): product_make_spec_set ปฏิเสธ live*/ปิดใช้งาน
  -----------------------------------------------------------------------
  declare
    v_p_live uuid;
    v_p_inactive uuid;
  begin
    v_p_live := analytics.product_upsert(v_shop, 'live10', 'SKU เฉพาะไลฟ์', null, 'fixed', 10, null, null, null, null, null, null, null, true);
    v_p_inactive := analytics.product_upsert(v_shop, 'ZZ142-INACTIVE', 'SKU ปิดใช้งาน', null, 'fixed', 10, null, null, null, null, null, null, null, false);

    v_caught := false; v_code := null;
    begin
      perform analytics.product_make_spec_set(v_shop, v_p_live, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ'));
    exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
    end;
    v_log := v_log || format('[T10a] product_make_spec_set บน SKU live* ถูกปฏิเสธ (errcode=%s): %s\n',
      coalesce(v_code, '(none)'), case when v_caught and v_code = '22023' then 'OK' else 'FAIL' end);

    v_caught := false; v_code := null;
    begin
      perform analytics.product_make_spec_set(v_shop, v_p_inactive, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ'));
    exception when others then v_caught := true; get stacked diagnostics v_code = returned_sqlstate;
    end;
    v_log := v_log || format('[T10b] product_make_spec_set บน SKU ปิดใช้งาน ถูกปฏิเสธ (errcode=%s): %s\n',
      coalesce(v_code, '(none)'), case when v_caught and v_code = '22023' then 'OK' else 'FAIL' end);
  end;

  -----------------------------------------------------------------------
  -- Part 10: integration — ใบผลิตผสม fixed+spot+spec ตัวเดียว preview+done
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop, null, 'ZZ142 ใบผสม 3 โหมด', null, false, false, null);
  v_order_id := (v_res ->> 'id')::uuid;
  perform analytics.production_order_item_set(v_shop, v_order_id, v_p_fixed, 2);
  perform analytics.production_order_item_set(v_shop, v_order_id, v_p_spot2, 4);
  perform analytics.production_order_item_set(v_shop, v_order_id, v_p_spec_main, 5);

  v_done_res := analytics.production_order_done(v_shop, v_order_id, null, 72, null);
  v_items := v_done_res -> 'items';
  v_log := v_log || format('[T14] production_order_done ใบผสม fixed+spot+spec: status=%s (คาด done) items=%s แถว (คาด 3) unit_cost ทุกตัว not null=%s: %s\n',
    v_done_res ->> 'status', jsonb_array_length(v_items),
    not exists (select 1 from jsonb_array_elements(v_items) e where e ->> 'unit_cost' is null),
    case when v_done_res ->> 'status' = 'done' and jsonb_array_length(v_items) = 3
      and not exists (select 1 from jsonb_array_elements(v_items) e where e ->> 'unit_cost' is null)
    then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 11: static — overload + grant + advisory lock
  -----------------------------------------------------------------------
  v_log := v_log || '--- static checks ---' || E'\n';

  select count(*) into v_overload_count from pg_proc where pronamespace='analytics'::regnamespace and proname='product_make_spec_clear';
  v_log := v_log || format('[T15a] product_make_spec_clear ไม่มี overload: %s ตัว (คาด 1): %s\n', v_overload_count, case when v_overload_count = 1 then 'OK' else 'FAIL' end);
  select count(*) into v_overload_count from pg_proc where pronamespace='analytics'::regnamespace and proname='product_make_spec_set';
  v_log := v_log || format('[T15b] product_make_spec_set ไม่มี overload: %s ตัว (คาด 1): %s\n', v_overload_count, case when v_overload_count = 1 then 'OK' else 'FAIL' end);
  select count(*) into v_overload_count from pg_proc where pronamespace='analytics'::regnamespace and proname='product_upsert';
  v_log := v_log || format('[T15c] product_upsert ไม่มี overload: %s ตัว (คาด 1): %s\n', v_overload_count, case when v_overload_count = 1 then 'OK' else 'FAIL' end);
  select count(*) into v_overload_count from pg_proc where pronamespace='analytics'::regnamespace and proname='production_cost_calc';
  v_log := v_log || format('[T15d] production_cost_calc ไม่มี overload: %s ตัว (คาด 1): %s\n', v_overload_count, case when v_overload_count = 1 then 'OK' else 'FAIL' end);
  select count(*) into v_overload_count from pg_proc where pronamespace='analytics'::regnamespace and proname='transform_pending_order_lines';
  v_log := v_log || format('[T15e] transform_pending_order_lines ไม่มี overload: %s ตัว (คาด 1): %s\n', v_overload_count, case when v_overload_count = 1 then 'OK' else 'FAIL' end);

  v_log := v_log || format('[T15f] grant product_make_spec_clear: anon=%s auth=%s svc=%s (คาด f/f/t — ตัดเหลือ service_role): %s\n',
    has_function_privilege('anon','analytics.product_make_spec_clear(uuid,uuid,uuid)','execute'),
    has_function_privilege('authenticated','analytics.product_make_spec_clear(uuid,uuid,uuid)','execute'),
    has_function_privilege('service_role','analytics.product_make_spec_clear(uuid,uuid,uuid)','execute'),
    case when not has_function_privilege('anon','analytics.product_make_spec_clear(uuid,uuid,uuid)','execute')
      and not has_function_privilege('authenticated','analytics.product_make_spec_clear(uuid,uuid,uuid)','execute')
      and has_function_privilege('service_role','analytics.product_make_spec_clear(uuid,uuid,uuid)','execute')
    then 'OK' else 'FAIL' end);

  v_log := v_log || format('[T15g] grant product_make_spec_set: anon=%s auth=%s svc=%s (คาด f/f/t — ตัดเหลือ service_role): %s\n',
    has_function_privilege('anon','analytics.product_make_spec_set(uuid,uuid,jsonb,uuid)','execute'),
    has_function_privilege('authenticated','analytics.product_make_spec_set(uuid,uuid,jsonb,uuid)','execute'),
    has_function_privilege('service_role','analytics.product_make_spec_set(uuid,uuid,jsonb,uuid)','execute'),
    case when not has_function_privilege('anon','analytics.product_make_spec_set(uuid,uuid,jsonb,uuid)','execute')
      and not has_function_privilege('authenticated','analytics.product_make_spec_set(uuid,uuid,jsonb,uuid)','execute')
      and has_function_privilege('service_role','analytics.product_make_spec_set(uuid,uuid,jsonb,uuid)','execute')
    then 'OK' else 'FAIL' end);

  v_log := v_log || format('[T15h] grant product_upsert: auth=%s svc=%s (คาด t/t — ไม่เปลี่ยน): %s\n',
    has_function_privilege('authenticated','analytics.product_upsert(uuid,text,text,text,text,numeric,numeric,numeric,numeric,numeric,text,text,text,boolean)','execute'),
    has_function_privilege('service_role','analytics.product_upsert(uuid,text,text,text,text,numeric,numeric,numeric,numeric,numeric,text,text,text,boolean)','execute'),
    case when has_function_privilege('authenticated','analytics.product_upsert(uuid,text,text,text,text,numeric,numeric,numeric,numeric,numeric,text,text,text,boolean)','execute')
      and has_function_privilege('service_role','analytics.product_upsert(uuid,text,text,text,text,numeric,numeric,numeric,numeric,numeric,text,text,text,boolean)','execute')
    then 'OK' else 'FAIL' end);

  select pg_get_functiondef('analytics.transform_pending_order_lines(uuid,uuid)'::regprocedure) into v_def;
  v_log := v_log || format('[T15i] transform_pending_order_lines ยังมี advisory lock key เดิม (ห้ามทำหาย): %s\n',
    case when v_def like '%pg_advisory_xact_lock%' and v_def like '%analytics.fact_order:%' then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- 🔴 Part 12: v_dim_product.effective_unit_cost ของ SKU จริงไม่ขยับเลย (T13)
  -----------------------------------------------------------------------
  -- v_before_dim_snapshot (Part 1) ถ่ายก่อน insert shop ZZ142 เลย ⇒ มีแต่ SKU
  -- จริงอยู่แล้วโดยธรรมชาติ (v_shop ยังไม่มีแถวใน public.shop ตอนนั้น) ตัด
  -- shop_id=v_shop ออกจาก snapshot "หลัง" ให้เหลือเฉพาะ SKU จริงเทียบกันตรงๆ
  select string_agg(product_id::text || ':' || coalesce(effective_unit_cost::text, 'NULL'), ',' order by product_id)
    into v_after_dim_snapshot
  from analytics.v_dim_product
  where shop_id <> v_shop;

  v_log := v_log || format('[T13] 🔴 v_dim_product.effective_unit_cost ของ SKU จริงทั้งหมดไม่ขยับเลย (ก่อน=หลัง): %s\n',
    case when v_before_dim_snapshot = v_after_dim_snapshot then 'OK' else 'FAIL — เปลี่ยนไปแล้ว ตรวจ diff ด่วน' end);

  v_log := v_log || E'\n=== ALL CHECKS LOGGED ABOVE — ตรวจทุกบรรทัดหา FAIL (transaction จะ rollback เสมอ) ===\n';
  raise exception '%', v_log;
end $$;

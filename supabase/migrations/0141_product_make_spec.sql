-- 0141_product_make_spec.sql
--
-- ทำไม: 0140 แยกชั้น "ต้นทุน" (analytics.oem_cost_calc) ออกจาก "ราคาขาย" ของ
-- เครื่องคิด OEM แต่ยังไม่มีใครเรียกมันจริง — ไฟล์นี้คือ "รอบถัดไป" ที่ 0140
-- บอกไว้ในหัวไฟล์ตัวเอง: เปิดโหมดที่ 3 ของต้นทุน SKU ("คำนวณจากสเปค") ให้
-- ใบผลิตเข้าสต็อกเรียกเครื่องคิดต้นทุนโรงงานได้ ตามที่เจ้าของสั่งเอง 19 ก.ย. 69
-- (docs/3j-jewelry/oms/design-own-production-costing.md, มติ C1-C5): "เอา
-- ผลิต OEM มาวางสำหรับผลิตเอง แต่ไม่คิด Margin ไม่ต้องคำนวณ floor"
--
-- 🔴 แก้จาก design เดิม 1 จุด (Tech Lead อนุมัติแล้ว — ดู task brief): design
-- เขียนว่า is_new_design อยู่ใน make_spec (ระดับ SKU) ซึ่งผิดเจตนาเจ้าของ —
-- เจ้าของพูดว่า "ค่าออกแบบมีให้ติ๊กเหมือนกัน แต่ถ้าผลิตซ้ำไม่ต้องคิดเลย" ⇒
-- ออกแบบครั้งเดียว รอบแรกติ๊ก รอบถัดไปไม่ติ๊ก ⇒ เป็นคุณสมบัติของ "รอบผลิต"
-- ไม่ใช่ของ SKU (เก็บที่ SKU จะคิดค่าแบบซ้ำทุกรอบตลอดไป ตรงข้ามกับที่สั่ง)
-- ⇒ ย้ายไปเก็บที่ analytics.production_order_item.is_new_design แทน (ระดับ
-- รายการ — ใบเดียวอาจมีทั้งแบบใหม่และแบบเดิมปนกัน)
--
-- ขอบเขตรอบนี้ (SQL อย่างเดียว ไม่แตะ TypeScript — UI เป็นเฟสแยกต่อจากนี้):
--   1. public.product.make_spec jsonb + cost_type รับ 'spec' + guard metal=silver
--   2. analytics.production_order_item.is_new_design (ไม่ใช่ SKU) + .cost_calc
--      (snapshot) + ขยาย CHECK ของ prev_cost_type ให้รับ 'spec'
--   3. analytics.production_cost_calc — เพิ่ม branch 'spec' (signature ใหม่:
--      +p_qty +p_is_new_design) เรียก analytics.oem_cost_calc (0140)
--   4. analytics.production_order_preview (+p_items เพื่อ preview ด้วย
--      qty_done เดียวกับที่ done จะใช้) / analytics.production_order_done
--      (signature เดิม — แค่ขยาย logic ภายใน) — ขยาย v_needs_spot + guard M-b
--      ของ 0132 ให้ครอบ 'spec'
--   5. analytics.product_make_spec_set / product_make_spec_clear + guard ใน
--      analytics.product_upsert (รับ 'spec' เฉพาะเมื่อ make_spec มีอยู่แล้ว)
--
-- ตั้งใจไม่ทำรอบนี้ (จากทั้ง design เดิม §8 และเหตุผลของตัวเอง):
--   - ไม่แตะ analytics.v_dim_product เด็ดขาด — 'spec' ตกลง `else p.unit_cost`
--     ของ CASE เดิมเองอยู่แล้ว (CASE เช็คแค่ 'spot' vs else) ⇒ ศูนย์การแก้ไข
--     กำไรย้อนหลังของ SKU จริงไม่ขยับแม้แถวเดียว (เคสห้ามผ่าน #1)
--   - ไม่แตะ analytics.v_production_order_item — ยังไม่มี column list สำหรับ
--     is_new_design/cost_calc รอบนี้ (append-only ปลอดภัยตาม trap #3 แต่ไม่มี
--     UI มาใช้ในรอบนี้ ปล่อยให้เฟส UI เพิ่มพร้อมกับที่มันต้องใช้จริง — กันงอก
--     surface ที่ไม่มีใครทดสอบ)
--   - ไม่รองรับ gold/brass (analytics.production_spot_resolve รองรับแค่เงิน)
--     ⇒ make_spec.metal ต้องเป็น 'silver' เท่านั้น เฟสแรก (บังคับทั้งตอน set
--     และตอนคำนวณจริงใน production_cost_calc — defense-in-depth)
--   - ไม่มี RPC toggle is_new_design แยก (เช่น production_order_item_set_flag)
--     — คอลัมน์นี้มี default false และยังไม่มีทางตั้งเป็น true ผ่าน RPC สาธารณะ
--     ในรอบนี้ (แก้ผ่าน DB ตรงได้ผ่าน service_role เท่านั้น) 🔴 ตัดสินใจเอง:
--     ไม่ได้อยู่ใน brief ข้อไหนเลย เพิ่มเข้ามาจะขยาย signature ของ
--     production_order_item_set ซึ่งบรีฟไม่ได้สั่ง — ปล่อยให้เฟส UI เพิ่ม RPC
--     ตัวนี้พร้อมกับฟอร์มจริง (ลด surface ที่ไม่มีการทดสอบ end-to-end จริงในรอบนี้)
--     ทดสอบ logic การคำนวณผ่านการ UPDATE ตรงในชุดทดสอบแทน (service_role
--     bypass RLS ได้อยู่แล้ว ไม่ต้องมี RPC ก็ยืนยัน logic ได้)
--   - ไม่แตะ analytics.production_order_item_set / _remove / _cancel /
--     analytics.oem_price_calc / oem_quote_save / oem_receipt_* /
--     public.stock_lot / stock_sync_sales / transform_pending_order_lines —
--     signature และ body เดิมทุกตัวคงอยู่
--
-- 🔴 traps ที่ต้องระวัง (skill 3j-migration-traps):
--   #1 signature เปลี่ยน = overload ใหม่ ⇒ drop function ก่อนเสมอ:
--      production_cost_calc (+2 args), production_order_preview (+1 arg)
--      ต้อง drop signature เดิมก่อน — production_order_done ไม่เปลี่ยน
--      signature (เพิ่มแค่ logic ภายใน + อ่าน poi.is_new_design ที่มีอยู่แล้ว)
--      ใช้ create or replace ตรงๆ ได้ แต่ยัง re-grant ตามข้อ 2 (defense-in-depth
--      เหมือน 0139 ทำกับฟังก์ชันเดียวกันนี้มาก่อน)
--   #2 grant หายทุกครั้งที่ replace — re-state revoke/grant ทุกฟังก์ชันที่แตะ
--   #3 เพิ่มคอลัมน์ table ปกติ (ไม่ใช่ view) ไม่ติดกับดักนี้ — append-only ไม่
--      กระทบอะไรเลยสำหรับ table จริง (ต่างจาก view ที่ห้ามแทรกกลาง)
--   #4 NaN/Infinity — p_qty เป็น int (ปลอดภัยจาก cast แล้ว); ราคาที่ resolve
--      ผ่าน production_spot_resolve มี not(between) guard อยู่แล้วจาก 0131
--   #11 ทดสอบผ่าน do-block + raise บังคับ rollback เสมอ — scripts/verify-0141.sql
--
-- อ้างอิง: docs/3j-jewelry/oms/design-own-production-costing.md,
-- supabase/migrations/0140_oem_cost_calc_extract.sql (oem_cost_calc ที่เรียก),
-- 0131_production_order.sql + 0132_production_order_security_fixes.sql +
-- 0139_stock_lot_hardening.sql (นิยามล่าสุดของ production_cost_calc/
-- production_order_preview/production_order_done — body ด้านล่างลอกมาจาก 0139
-- คำต่อคำแล้วแก้เฉพาะจุดที่ทำเครื่องหมาย "0141" ไว้), 0028_sku_cost_margin.sql
-- (product_cost_type_check), 0031_catalog_management.sql (product_upsert),
-- skill oem-quote-invariants

-- ============================================================================
-- 1. public.product.make_spec + cost_type รับ 'spec'
-- ============================================================================

alter table public.product
  add column if not exists make_spec jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_make_spec_shape_check') then
    alter table public.product add constraint product_make_spec_shape_check
      check (make_spec is null or jsonb_typeof(make_spec) = 'object');
  end if;
end $$;

comment on column public.product.make_spec is
  '0141: {metal, item_kind, polish_tier, plating_type|null, gem_tier|null,
   gem_count} — เขียนได้ทาง analytics.product_make_spec_set เท่านั้น (validate
   ผ่าน analytics.oem_cost_calc จริงก่อนบันทึก). ห้ามมี is_new_design ปนอยู่
   ในนี้เด็ดขาด (มติเจ้าของ 19 ก.ย.: ค่าออกแบบเป็นคุณสมบัติของ "รอบผลิต"
   analytics.production_order_item ไม่ใช่ของ SKU — ผลิตซ้ำไม่คิดค่าแบบ).
   น้ำหนัก/ความบริสุทธิ์ใช้คอลัมน์เดิม silver_weight_g/silver_purity (fact
   หนึ่งอยู่ชั้นเดียว). เฟสแรกรองรับเฉพาะ metal=silver.';

-- product_cost_type_check ตั้งชื่อไว้แล้วชัดเจนตั้งแต่ 0028 (ไม่ใช่ unnamed
-- inline check) — drop-if-exists ด้วยชื่อที่รู้แน่นอนได้เลย ไม่ต้องเสี่ยงเดา
alter table public.product drop constraint if exists product_cost_type_check;
alter table public.product add constraint product_cost_type_check
  check (cost_type in ('fixed', 'spot', 'spec'));

-- ============================================================================
-- 2. analytics.production_order_item.is_new_design + .cost_calc + ขยาย CHECK
--    ของ prev_cost_type ให้รับ 'spec'
-- ============================================================================

alter table analytics.production_order_item
  add column if not exists is_new_design boolean not null default false,
  add column if not exists cost_calc     jsonb;

comment on column analytics.production_order_item.is_new_design is
  '0141: มติเจ้าของ 19 ก.ย. 69 — ย้ายมาจาก design เดิมที่เขียนไว้ผิดที่ (SKU).
   เจ้าของ: "ค่าออกแบบมีให้ติ๊กเหมือนกัน แต่ถ้าผลิตซ้ำไม่ต้องคิดเลย" ⇒ เป็น
   คุณสมบัติของรอบผลิต ไม่ใช่ของ SKU. ติ๊ก = analytics.production_cost_calc
   บวก nre_cost/qty เข้าต้นทุนต่อชิ้นของรอบนี้เต็มจำนวน (ห้ามเฉลี่ยตามอายุ
   ก้อนยาง — เจ้าของสั่งเอง: "อายุก้อนยางไม่ได้ซีเรียสแล้ว ต้นทุนไม่ได้เยอะ
   ประมาณ 300 บาทไม่เกินนี้"). default false = ผลิตซ้ำ ไม่คิดค่าแบบ. ยังไม่มี
   RPC toggle สาธารณะรอบนี้ (ตั้งใจ — ดูหัวไฟล์) เฟส UI จะเพิ่มให้.';
comment on column analytics.production_order_item.cost_calc is
  '0141: snapshot breakdown ต้นทุนเต็มจาก analytics.production_cost_calc
   (เฉพาะ cost_type=spec ตอน done — null สำหรับ fixed/spot, พฤติกรรมเดิมของ
   สองโหมดนั้นไม่เปลี่ยน) เขียนโดย analytics.production_order_done ตอน done
   เท่านั้น ก่อนหน้านั้นเป็น null เสมอ (เหมือน unit_cost/prev_cost_type/
   prev_unit_cost — มี deny_mutation trigger ของ 0131 คุ้มครองหลัง done อยู่แล้ว
   ไม่ต้องเพิ่ม trigger ใหม่).';

-- prev_cost_type เป็น unnamed inline CHECK มาตั้งแต่ 0131 (ไม่ใช่ constraint
-- ที่ตั้งชื่อไว้) — หาชื่อจริงจาก pg_constraint ก่อนเสมอ (3j-migration-traps:
-- ห้ามเดาชื่อ autogenerated) แพทเทิร์นเดียวกับ 0075/0082
do $$
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
end;
$$;

-- ============================================================================
-- 3. analytics.production_cost_calc — เพิ่ม branch 'spec'. signature เปลี่ยน
--    (+p_qty +p_is_new_design) ⇒ drop signature เดิมก่อนเสมอ (trap #1)
-- ============================================================================

drop function if exists analytics.production_cost_calc(uuid, uuid, numeric);

create or replace function analytics.production_cost_calc(
  p_shop_id                   uuid,
  p_product_id                uuid,
  p_spot_price_thb_per_gram   numeric default null,
  -- 0141: บังคับเฉพาะ cost_type='spec' — ต้นทุนต่อชิ้นของโหมดนี้ขึ้นกับจำนวน
  -- ที่ผลิตจริง (ค่าแฟลสก์/ถังชุบ/ค่าแบบถูกหารด้วยจำนวนนี้ ไม่ใช่ per-piece
  -- คงที่เหมือน fixed/spot) preview/done ต้องส่ง qty เดียวกันเป๊ะ (qty_done ที่
  -- กรอกในหน้าต่างยืนยัน ไม่ใช่ qty_planned เสมอไป — ไม่งั้นเลขที่เห็นก่อนกด
  -- ≠ เลขที่ถูกบันทึกจริงเมื่อผลิตได้ไม่ครบ) ไม่ใช้เลยสำหรับ fixed/spot
  -- (พฤติกรรมเดิมเป๊ะ — ห้ามแตะ)
  p_qty                       int default null,
  -- 0141: เฉพาะ cost_type='spec' — ติ๊กแล้วบวก nre_cost/p_qty เข้าต้นทุนต่อ
  -- ชิ้นของรอบนี้เต็มจำนวน (มติเจ้าของ 19 ก.ย. — ห้ามเฉลี่ยตามอายุก้อนยาง)
  -- ไม่ติ๊ก = ไม่บวกเลย (oem_cost_calc เองคิด nre_cost=0 เมื่อ is_new_design=
  -- false อยู่แล้ว ไม่ต้อง branch ซ้ำที่นี่). ไม่มีผลกับ fixed/spot
  p_is_new_design             boolean default false
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_product         public.product%rowtype;
  v_spot            numeric;
  v_unit_cost       numeric;
  -- 0141: เฉพาะ branch 'spec'
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
    -- 🔴 นิพจน์เดียวกับ analytics.v_dim_product (0028) คำต่อคำ — ห้ามแก้ที่นี่
    -- โดยไม่แก้ที่นั่นด้วย ไม่งั้นตัวเลขใน /catalog กับในใบผลิตจะไม่ตรงกัน
    v_unit_cost := round(coalesce(v_product.silver_weight_g, 0) * coalesce(v_spot, 0)
                          * coalesce(v_product.silver_purity, 0.925) + coalesce(v_product.labor_cost, 0), 2);

  elsif v_product.cost_type = 'spec' then
    -- 0141: โหมดที่ 3 — "คำนวณจากสเปค" เรียก analytics.oem_cost_calc (0140,
    -- ชั้นต้นทุนล้วน ไม่มี margin/floor) ตามที่เจ้าของสั่ง
    if v_product.make_spec is null then
      raise exception 'production_cost_calc: SKU % เป็นโหมด spec แต่ยังไม่ได้ตั้งสเปค (make_spec) — ตั้งที่ /catalog ก่อนสั่งผลิต (analytics.product_make_spec_set)', v_product.sku using errcode = '22023';
    end if;
    -- ข้อความเดียวกับ branch 'spot' ข้างบน ตามที่สั่ง (แค่สลับคำว่า spot->spec)
    if v_product.silver_weight_g is null or v_product.silver_weight_g <= 0 then
      raise exception 'production_cost_calc: SKU % เป็นโหมด spec แต่ยังไม่กรอกน้ำหนักเงิน (silver_weight_g) — กรอกที่ /catalog ก่อนสั่งผลิต', v_product.sku using errcode = '22023';
    end if;
    -- defense-in-depth: ซ้ำกับ guard ตอน product_make_spec_set (write-time) —
    -- เผื่อ make_spec ถูกแก้นอกช่องทาง RPC (pattern เดียวกับ live-SKU check
    -- ของ 0131 ที่เช็คทั้งตอนใส่ในใบและตอน done)
    if coalesce(v_product.make_spec ->> 'metal', '') <> 'silver' then
      raise exception 'production_cost_calc: SKU % สเปคโลหะไม่ใช่เงิน (metal=%) — เฟสนี้รองรับเฉพาะเครื่องประดับเงินเท่านั้น (production_spot_resolve ไม่รองรับทอง/ทองเหลือง)', v_product.sku, v_product.make_spec ->> 'metal' using errcode = '22023';
    end if;
    if p_qty is null or p_qty <= 0 then
      raise exception 'production_cost_calc: SKU % เป็นโหมด spec ต้องระบุจำนวนที่จะผลิต (p_qty > 0) — ต้นทุนต่อชิ้นของโหมดนี้ขึ้นกับจำนวนที่ผลิตจริง', v_product.sku using errcode = '22023';
    end if;

    v_spot := coalesce(p_spot_price_thb_per_gram, analytics.production_spot_resolve(p_shop_id, null));

    -- 🔴 ห้าม oem_cost_calc lookup ราคาเงินเอง (0131 §M1 — ใบผลิตห้ามใช้ราคา
    -- เก่า) ส่งราคาที่ resolve ไว้แล้วข้างบนเข้าไปตรงๆ ผ่าน
    -- metal_price_thb_per_gram เสมอทุก call path (ไม่มีทางลืมส่ง — บังคับที่
    -- โครงสร้าง ไม่ใช่วินัย caller)
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
    -- nre_cost เป็นก้อนรวม (cad+print3d+mold) ไม่ใช่ per-piece — oem_cost_calc
    -- เองคิดเป็น 0 อยู่แล้วเมื่อ is_new_design=false จึงไม่ต้อง case แยกที่นี่
    v_nre_cost      := coalesce((v_cost_result -> '_raw' ->> 'nre_cost')::numeric, 0);
    v_nre_per_piece := round(v_nre_cost / p_qty, 2);
    v_unit_cost     := round(v_cost_piece + v_nre_cost / p_qty, 2);

    -- breakdown เต็มสำหรับหน้าจอ/snapshot — ประกอบทีละ field จาก _raw ที่คลี่
    -- แล้วเท่านั้น ไม่ spread ก้อน _raw ดิบออกไป (แพทเทิร์นเดียวกับ
    -- oem-quote-invariants #1 "ประกอบทีละ field ห้าม spread" — ที่นี่ฟังก์ชัน
    -- นี้เป็น service_role-only ล้วน ไม่มี anon/authenticated เรียกถึง แต่ยังคง
    -- วินัยเดียวกันเพื่อไม่ให้ _raw รั่วไหลเป็นนิสัย)
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

  else -- fixed
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
    -- 0141: null สำหรับ fixed/spot (พฤติกรรมเดิมของสองโหมดนั้นไม่เปลี่ยน —
    -- เพิ่มคีย์ใหม่เข้า jsonb เดิมเท่านั้น ไม่แตะค่าคีย์อื่นที่มีอยู่แล้วเลย)
    'cost_calc', v_cost_calc
  );
end;
$$;

revoke execute on function analytics.production_cost_calc(uuid, uuid, numeric, int, boolean) from public, anon, authenticated;
grant execute on function analytics.production_cost_calc(uuid, uuid, numeric, int, boolean) to service_role;

-- ============================================================================
-- 4a. analytics.production_order_preview — เพิ่ม p_items (0141) เพื่อ preview
--     ด้วย qty เดียวกับที่ done จะใช้จริง (resolution เดียวกับ done เป๊ะ) —
--     signature เปลี่ยน ⇒ drop ก่อนเสมอ (trap #1)
-- ============================================================================

drop function if exists analytics.production_order_preview(uuid, uuid);

create or replace function analytics.production_order_preview(
  p_shop_id             uuid,
  p_production_order_id uuid,
  -- 0141: [{"product_id":"...", "qty_done": N}, ...] จำนวนที่กรอกในหน้าต่าง
  -- ยืนยัน (ก่อนกด done จริง) — resolution เดียวกับ production_order_done เป๊ะ
  -- (coalesce ต่อ product_id ไม่พบใน array = ใช้ qty_planned) 🔴 กระทบเฉพาะ
  -- cost_type='spec' (batch/NRE หารด้วยจำนวนที่ผลิตจริง — fixed/spot ไม่ขึ้น
  -- กับ qty เลย ค่าต่อชิ้นคงที่เสมอ) ไม่ส่ง = ใช้ qty_planned ทั้งใบ เหมือน
  -- 0131 เดิมทุกประการ (caller เก่าไม่พัง)
  p_items               jsonb default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
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

  -- 0141: ครอบ 'spec' ด้วย (เดิมครอบแค่ 'spot') — โหมด spec ก็ใช้ราคาเงินจริง
  -- เหมือนกัน (oem_cost_calc รองรับแค่เนื้อเงินเฟสแรก)
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
  -- 0141: resolution เดียวกับ production_order_done เป๊ะ — คือหัวใจของ
  -- "เคสห้ามผ่าน #5" (ตัวเลขที่ preview แสดง ต้อง = ตัวเลขที่ done บันทึก)
  cross join lateral (
    select coalesce(
      (select (ov ->> 'qty_done')::int from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) ov
        where (ov ->> 'product_id')::uuid = poi.product_id),
      poi.qty_planned
    ) as qty_used
  ) q
  -- qty_used=0 (ตั้งใจกรอกว่า "ไม่ได้ผลิตชิ้นนี้เลย" ในหน้าต่างยืนยัน) ต้อง
  -- "ไม่พัง" ทั้ง preview — production_order_done เองก็ skip การคำนวณต้นทุน
  -- ทั้งหมดเมื่อ qty_done_resolved=0 (ดู `if v_qty_done = 0 then continue`)
  -- production_cost_calc โหมด spec จะ raise ถ้า p_qty<=0 ⇒ ต้อง short-circuit
  -- ก่อนเรียกมัน ไม่งั้นบรรทัดเดียวที่ตั้งใจข้ามจะทำให้ preview ทั้งใบพังหมด
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
$$;

revoke execute on function analytics.production_order_preview(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function analytics.production_order_preview(uuid, uuid, jsonb) to service_role;

-- ============================================================================
-- 4b. analytics.production_order_done — signature เดิมเป๊ะ (uuid, uuid, jsonb,
--     numeric, uuid — ไม่ drop function) แค่ขยาย logic ภายในให้ครอบ 'spec':
--     v_needs_spot, guard M-b ของ 0132, เรียก production_cost_calc ด้วย
--     qty+is_new_design ของ item นั้น, เขียน cost_calc snapshot กลับ item.
--     body ลอกมาจาก 0139_stock_lot_hardening.sql คำต่อคำ แก้เฉพาะจุดที่ทำ
--     เครื่องหมาย "0141" ไว้เท่านั้น
-- ============================================================================

create or replace function analytics.production_order_done(
  p_shop_id             uuid,
  p_production_order_id uuid,
  -- p_items: [{"product_id": "...", "qty_done": N}, ...] override จำนวนที่
  -- ผลิตได้จริงต่อ SKU (ถ้าไม่ส่ง หรือ SKU ไม่อยู่ใน array นี้ ⇒ ใช้ qty_planned)
  p_items               jsonb default null,
  -- 0132 M1: ราคาเงินที่ client เห็นตอน preview (production_order_preview,
  -- 0131 §11) — ถ้าไม่ตรงกับราคาที่ resolve ได้จริง ณ ตอนนี้ (v_spot ด้านล่าง)
  -- ให้ raise แทนที่จะ stamp ต้นทุนที่เจ้าของไม่เคยเห็นแบบเงียบๆ
  -- fail-closed: ใบที่ใช้ราคาเงินจริง (v_needs_spot — 0141: รวม 'spec' ด้วย)
  -- ต้องส่ง arg นี้มาเสมอ — null = raise ไม่ใช่ "ข้ามการเทียบ" ใบที่ทุกบรรทัด
  -- เป็น fixed ไม่แตะเงื่อนไขนี้เลย
  p_expected_spot_thb_per_gram numeric default null,
  -- 0132 M4: coalesce(p_actor, auth.uid()) — auth.uid() เป็น null เสมอเพราะ
  -- เรียกผ่าน service client. null = พฤติกรรมเดิมทุกประการ (caller เก่าไม่พัง)
  p_actor               uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
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

  -- 0139 fix #3 (deadlock คู่ done×done): lock ต่อ (shop, ฟังก์ชันนี้) ก่อนแตะ
  -- แถวใดๆ เลย — คนละ key กับ 'analytics.fact_order:' ที่ import ใช้
  perform pg_advisory_xact_lock(hashtext('analytics.production_order_done:' || p_shop_id::text));

  select * into v_order from analytics.production_order
    where id = p_production_order_id and shop_id = p_shop_id
    for update;
  if not found then
    raise exception 'production_order_done: ไม่พบใบผลิต % ในร้านนี้', p_production_order_id using errcode = '22023';
  end if;

  -- idempotency: กด done ซ้ำ (สถานะ done อยู่แล้ว) → คืนผลเดิม ไม่ raise (ไม่แตะ
  -- lot ซ้ำ — ผ่านทางไม่ถึงลูปด้านล่างเลย)
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

  -- cancelled เป็นปลายทาง — done ทับไม่ได้
  if v_order.status = 'cancelled' then
    raise exception 'production_order_done: ใบ % ถูกยกเลิกไปแล้ว ทำ done ไม่ได้', v_order.po_no using errcode = '22023';
  end if;

  -- ประกอบ qty_done ต่อ item ครั้งเดียว (ใช้ p_items override ถ้ามี ไม่งั้นใช้
  -- qty_planned) — 0141: เพิ่ม is_new_design ของแต่ละ item เข้ามาด้วย (อ่านจาก
  -- คอลัมน์ที่มีอยู่แล้ว ไม่ใช่จาก p_items) `order by poi.product_id` (0139
  -- fix #3 — ปิด ABBA deadlock) คงไว้เหมือนเดิม
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

  -- รอบที่ 1: validate ทุกบรรทัดก่อนแตะสต็อกบรรทัดแรก
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

  -- resolve ราคาเงินครั้งเดียวต่อใบ เฉพาะเมื่อมีอย่างน้อย 1 รายการที่จะผลิตจริง
  -- (qty_done>0) เป็นโหมดที่ต้องใช้ราคาเงิน — 0141: ครอบ 'spec' ด้วย (เดิม
  -- ครอบแค่ 'spot') — ห้าม fallback ราคาเมื่อวาน
  select exists (
    select 1 from jsonb_array_elements(v_work) e
    join public.product p on p.id = (e ->> 'product_id')::uuid
    where p.cost_type in ('spot', 'spec') and (e ->> 'qty_done_resolved')::int > 0
  ) into v_needs_spot;

  if v_needs_spot then
    v_spot := analytics.production_spot_resolve(p_shop_id, v_order.spot_override_thb_per_gram);
  end if;

  -- 0132 M1 (fail-closed): เทียบราคาเงินที่ client "คาดหวัง" กับราคาที่ resolve
  -- ได้จริง ณ ตอนนี้ — 0141: v_needs_spot ขยายครอบ 'spec' แล้ว ⇒ ด่านนี้ครอบ
  -- 'spec' โดยอัตโนมัติ ไม่ต้องแก้อะไรเพิ่มตรงนี้ (เคสห้ามผ่าน #2)
  if v_needs_spot then
    if p_expected_spot_thb_per_gram is null then
      raise exception 'production_order_done: ใบนี้ใช้ราคาเงินคำนวณต้นทุน ต้องส่งราคาที่หน้าจอเห็น (p_expected_spot_thb_per_gram) มาด้วยเสมอ — กดยืนยันจากหน้าใบผลิตเท่านั้น'
        using errcode = '22023';
    end if;
    if not (abs(v_spot - p_expected_spot_thb_per_gram) <= 0.0001) then
      raise exception 'production_order_done: ราคาเงินเปลี่ยนไประหว่างที่เปิดหน้าต่างนี้ค้างไว้ (ตอนเปิดหน้าต่างเห็นราคา % บาท/กรัม แต่ตอนนี้ระบบคำนวณได้ % บาท/กรัม) — ปิดหน้าต่างยืนยันนี้แล้วเปิดใบผลิตใหม่อีกครั้งเพื่อดูราคาล่าสุดก่อนยืนยัน', p_expected_spot_thb_per_gram, v_spot using errcode = '22023';
    end if;
  end if;

  -- รอบที่ 2: mutate จริง — ลำดับ load-bearing เดิม (0131/0132/0138/0139 —
  -- ห้ามสลับ): snapshot item -> ensure central_stock+adjust_stock -> insert
  -- stock_lot -> พลิกสถานะเป็นบรรทัดสุดท้าย
  for v_elem in select * from jsonb_array_elements(v_work) loop
    v_qty_done := (v_elem ->> 'qty_done_resolved')::int;

    if v_qty_done = 0 then
      -- ไม่ได้ผลิตจริงสำหรับรายการนี้ — บันทึกแค่ qty_done=0 ไม่แตะต้นทุน/สต็อก/lot
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

    -- 0132 M-b, ขยาย 0141: กันเคส product.cost_type ถูกพลิกเป็นโหมดที่ต้องใช้
    -- ราคาเงินคั่นกลาง (READ COMMITTED) แล้ว production_cost_calc ไปหยิบราคา
    -- สดเอง ⇒ ข้ามการเทียบ M1 — raise แทนการเดาต่อ (เดิมเช็คแค่ 'spot')
    if v_product.cost_type in ('spot', 'spec') and v_spot is null then
      raise exception 'production_order_done: SKU % ถูกเปลี่ยนเป็นโหมดที่ต้องใช้ราคาเงินระหว่างที่กำลังบันทึกใบนี้ — เปิดใบผลิตใหม่อีกครั้งเพื่อคำนวณต้นทุนใหม่', v_product.sku using errcode = '22023';
    end if;
    -- 0141: ส่ง qty_done จริง (ไม่ใช่ qty_planned) + is_new_design ของ item
    -- นี้เข้า production_cost_calc — สำหรับ fixed/spot สองค่านี้ไม่มีผลเลย
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

    -- (1) snapshot ลง item ก่อน — ใบยังเป็น open ตอนนี้ ผ่าน trigger กันแก้ —
    -- 0141: เพิ่ม cost_calc (breakdown เต็ม — null สำหรับ fixed/spot)
    update analytics.production_order_item
       set qty_done = v_qty_done, unit_cost = v_unit_cost,
           prev_cost_type = v_product.cost_type, prev_unit_cost = v_product.unit_cost,
           cost_calc = v_calc -> 'cost_calc',
           updated_at = now()
     where id = (v_elem ->> 'id')::uuid;

    -- (2) ensure central_stock แถวมีอยู่ก่อนเสมอ
    insert into public.central_stock (product_id) values (v_product.id)
      on conflict (product_id) do nothing;

    perform public.adjust_stock(p_shop_id, v_product.id, v_qty_done, 'po:' || (v_elem ->> 'id'));

    -- (3) เปิด track_stock เหมือนเดิม (ห้ามเลื่อน track_stock_since ถ้าเปิดอยู่
    -- แล้ว) — ไม่ stamp cost_type/unit_cost กลับ product (D1, 0138)
    update public.product
       set track_stock = true,
           track_stock_since = coalesce(v_product.track_stock_since, v_today),
           updated_at = now()
     where id = v_product.id;

    -- สร้าง lot ต้นทุนของรอบผลิตนี้ — v_unit_cost มาจาก production_cost_calc
    -- ด้านบนแล้ว (ครอบทั้ง fixed/spot/spec โดยอัตโนมัติ ไม่ต้องแก้จุดนี้)
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

  -- (4) พลิกสถานะเป็นบรรทัดสุดท้ายของฟังก์ชันเท่านั้น
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
$$;

-- signature ไม่เปลี่ยน (uuid, uuid, jsonb, numeric, uuid) — ไม่ต้อง drop
-- function (trap #1) แต่ยังต้อง re-state revoke/grant เสมอ (ข้อ 2 —
-- defense-in-depth ตามแบบ 0139 ทำกับฟังก์ชันเดียวกันนี้มาก่อน)
revoke execute on function analytics.production_order_done(uuid, uuid, jsonb, numeric, uuid) from public, anon, authenticated;
grant execute on function analytics.production_order_done(uuid, uuid, jsonb, numeric, uuid) to service_role;

-- ============================================================================
-- 5a. analytics.product_make_spec_set — ตั้งสเปคของ SKU + พลิก cost_type เป็น
--     'spec'. validate สเปคโดยยิงผ่าน analytics.oem_cost_calc จริง (single
--     source of truth เดียวกับที่ใบผลิตจะใช้จริง) — input พังต้อง raise
--     (malformed call) ส่วน rate หาย (is_complete=false) บันทึกได้แต่แค่เตือน
--     ไปตกที่ตอน done แทน (ตามที่สั่ง)
-- ============================================================================

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
as $$
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
  -- เฟสแรกบังคับ silver เท่านั้น — production_spot_resolve รองรับแค่เนื้อเงิน
  -- ปฏิเสธที่นี่ (write-time) + ซ้ำอีกชั้นใน production_cost_calc (read-time —
  -- defense-in-depth เดียวกับ live-SKU check ของ 0131)
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

  -- 🔴 whitelist คีย์เอง — "ประกอบใหม่" จาก 6 คีย์ที่อนุญาตเท่านั้น ไม่ใช่แค่
  -- validate แล้วเก็บ p_make_spec ดิบ กัน caller ใส่ is_new_design (หรือคีย์
  -- แปลกอื่น) แนบมาแล้วมันไปฝังอยู่ระดับ SKU ถาวรโดยไม่มีใครตั้งใจ — is_new_design
  -- ต้องอยู่ที่ "รอบผลิต" (analytics.production_order_item) เท่านั้นตามมติ
  -- เจ้าของ 19 ก.ย. — ด่านนี้บังคับที่โครงสร้าง ไม่ใช่พึ่งวินัย caller
  v_clean_spec := jsonb_build_object(
    'metal', v_metal,
    'item_kind', v_item_kind,
    'polish_tier', v_polish_tier,
    'plating_type', v_plating_type,
    'gem_tier', v_gem_tier,
    'gem_count', v_gem_count
  );

  -- validate ผ่าน oem_cost_calc จริง — ยิงด้วย qty=1/น้ำหนักของ SKU เองถ้ามี
  -- (fallback 1 กรัมถ้ายังไม่กรอก — เจ้าของกำลังทยอยกรอกน้ำหนักอยู่ ไม่บล็อก
  -- การตั้งสเปคก่อน) ราคาเงินไม่ส่ง (ปล่อย lookup ปกติ) เพราะจุดนี้ตรวจแค่
  -- "สเปคเรียกได้ไม่พัง" ไม่ใช่ตรวจว่า rate ครบ — ปล่อยให้ raise ทะลุขึ้นไปตรงๆ
  -- ถ้า input พัง (เช่น gem_count>0 แต่ไม่มี gem_tier) คือด่าน validate ตัวจริง
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
    -- rate หายได้ตอน set (แค่เตือน — ไปตกที่ done จริง) — ส่งกลับให้ UI บอก
    -- เจ้าของว่ายังกรอก rate ไม่ครบ ถ้าอยากรู้ก่อนสั่งผลิตจริง
    'validation', jsonb_build_object(
      'is_complete', v_check_result ->> 'is_complete',
      'missing', v_check_result -> 'missing'
    )
  );
end;
$$;

revoke execute on function analytics.product_make_spec_set(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function analytics.product_make_spec_set(uuid, uuid, jsonb, uuid) to authenticated, service_role;

-- ============================================================================
-- 5b. analytics.product_make_spec_clear — ถอยกลับ 'fixed' + ล้าง make_spec.
--     idempotent: เคลียร์ซ้ำ (fixed อยู่แล้ว + make_spec เป็น null อยู่แล้ว)
--     คืนผลเดิม ไม่เขียน audit log ซ้ำ
-- ============================================================================

create or replace function analytics.product_make_spec_clear(
  p_shop_id    uuid,
  p_product_id uuid,
  p_actor      uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
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
$$;

revoke execute on function analytics.product_make_spec_clear(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.product_make_spec_clear(uuid, uuid, uuid) to authenticated, service_role;

-- ============================================================================
-- 6. analytics.product_upsert — รับ 'spec' เฉพาะเมื่อ make_spec มีอยู่แล้ว
--    (กันหน้าแคตตาล็อกบันทึกทั่วไปแล้วพลิกโหมดกลับเงียบๆ โดยไม่เคยผ่าน
--    product_make_spec_set) แก้ body อย่างเดียว signature เดิมเป๊ะ (14 args)
--    — ไม่ drop function; product_upsert_bulk (0032) ไม่ต้องแก้ เพราะมันแค่
--    forward ทุก arg เดิมไปที่ product_upsert อยู่แล้ว การ์ดนี้จึงครอบ
--    bulk import ด้วยโดยอัตโนมัติ (แถวไหนพังแค่แถวนั้น error ใบอื่นผ่านต่อ)
-- ============================================================================

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
as $$
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

  -- 0141: 'spec' รับได้เฉพาะเมื่อ SKU นี้เคยตั้งสเปคผ่าน
  -- analytics.product_make_spec_set มาก่อนแล้วเท่านั้น (make_spec ไม่ null) —
  -- SKU ใหม่ (v_old.id ยังไม่มี) ไม่มีทางผ่านด่านนี้ได้เลยเพราะยังไม่เคยมี
  -- make_spec แน่ๆ ต้องไปตั้งสเปคก่อนเสมอ กันหน้าแคตตาล็อกทั่วไป (บันทึก
  -- ราคา/ชื่อ ฯลฯ) พลิกโหมด SKU ไปเป็น spec เงียบๆ โดยไม่เคยยิงผ่าน
  -- oem_cost_calc validate เลย (product_upsert เองไม่มีความรู้เรื่องสเปค)
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
$$;

-- signature ไม่เปลี่ยน (14 args) — 0029 เคยบันทึกไว้ว่า grant ติดมาเองไม่ต้อง
-- re-issue แต่ทีมยึดวินัย "re-grant ทุกครั้งที่แตะ ไม่มีข้อยกเว้น" (skill
-- 3j-migration-traps ข้อ 2) — re-state ให้ตรงกับที่ 0028 ตั้งไว้เป๊ะ (defense-in-depth)
revoke execute on function analytics.product_upsert(uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function analytics.product_upsert(uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, text, boolean)
  to authenticated, service_role;

notify pgrst, 'reload schema';

-- 0139_stock_lot_hardening.sql
-- ปิดหนี้ security ของ 0138_stock_lot_tables.sql (L1 ของ FIFO lot costing) —
-- security review พิสูจน์บน DB จริงแล้วว่าทั้ง 5 ข้อด้านล่างเกิดได้จริงวันนี้:
--
--   1. analytics.stock_lot แก้/ลบได้อิสระ — `update stock_lot set unit_cost =
--      99999` สำเร็จ, `delete` สำเร็จ, updated_at ไม่ขยับตอน UPDATE (ไม่มี
--      trigger set_updated_at เลยตั้งแต่ 0138)
--   2. analytics.production_order_done: `on conflict (production_order_item_id)
--      ... do nothing` ตอน insert lot เป็น fail-open — ถ้ามี lot ผูก item นั้น
--      อยู่ก่อนแล้ว (ข้อมูลเพี้ยน/แก้นอกช่องทาง RPC) ฟังก์ชันจะปรับสต็อก +
--      พลิกสถานะ done สำเร็จ แต่ไม่ได้บันทึกต้นทุนรอบนี้เลย โดยไม่มีใครรู้
--   3. analytics.production_order_done: `jsonb_agg` ตอนประกอบ v_work ไม่มี
--      `order by` ⇒ สองใบที่มี SKU เดียวกันคนละลำดับ กด done พร้อมกัน = 40P01
--      (deadlock) สุ่มตาย เพราะสอง session ล็อกแถว product ต่างลำดับกัน
--   4. analytics.stock_lot_derive_shop / stock_lot_consumption_derive_shop ปล่อย
--      product_id=<uuid> / lot_id=<uuid> ดิบถึงข้อความ error ที่ผู้ใช้เห็น
--   5. production_order_done ถูก create-or-replace ซ้ำ (0131→0132→0138) — ต้อง
--      re-state revoke/grant ทุกครั้งตามธรรมเนียม (3j-migration-traps ข้อ 2)
--      แม้ signature จะไม่เปลี่ยนก็ตาม (defense-in-depth)
--
-- ขอบเขตรอบนี้ (ตั้งใจแคบ — ตาม brief):
--   §1 analytics.stock_lot: เพิ่ม trg_stock_lot_updated_at, trg_stock_lot_deny_
--      mutation (DELETE ปฏิเสธเสมอ, UPDATE อนุญาตเฉพาะ qty_remaining),
--      trg_stock_lot_deny_truncate (statement-level), แคบ grant service_role
--      เหลือ select/insert/update (ตัด delete/truncate)
--   §2 analytics.stock_lot_derive_shop / stock_lot_consumption_derive_shop:
--      แยก raise warning (UUID ดิบ → Postgres log) ออกจาก raise exception
--      (ข้อความกลางภาษาคน → ผู้ใช้) — pattern เดียวกับ 0137 บรรทัด ~127-134
--   §3 analytics.production_order_done (signature เดิม uuid,uuid,jsonb,numeric,
--      uuid — ไม่ drop function): fail-open→fail-closed ของ insert lot (get
--      diagnostics + raise ถ้า 0 แถว), order by poi.product_id ใน v_work
--      jsonb_agg (ปิด ABBA), pg_advisory_xact_lock คนละ key จาก fact_order
--      family, re-state revoke/grant
--
-- ❌ ไม่แตะรอบนี้ (ตั้งใจ):
--   - analytics.stock_lot_consumption: ยังว่าง ไม่มี caller — ยังไม่ใส่ deny_
--     mutation/updated_at/truncate-guard ให้ เพราะ 0139+ (FIFO consumption จริง)
--     ต้องมาเขียน/ลบ/แก้แถวในตารางนี้ (ผูกกับการคืนของตอนยกเลิก/ลด qty) —
--     ใส่ trigger กันแก้ตอนนี้จะล็อกฟีเจอร์ที่ยังไม่เขียนโค้ดจริง ยังไม่รู้ว่า
--     caller ต้องการแก้คอลัมน์ไหนบ้าง (คนละเหตุผลกับ stock_lot ที่รู้ชัดแล้วว่า
--     FIFO ต้องการแก้แค่ qty_remaining) — แก้ error message ของ derive_shop
--     trigger ของตารางนี้เท่านั้น (§2) เพราะเป็นการรั่วข้อมูลที่แก้ได้แยกจาก
--     การล็อก mutation
--   - ไม่แตะ table/column structure ของ analytics.stock_lot (ไม่มี ALTER TABLE)
--   - ไม่แตะ production_cost_calc/production_spot_resolve/production_order_
--     preview/production_order_save/production_order_item_set/
--     production_order_item_remove/production_order_cancel/v_stock_lot/
--     v_stock_lot_mismatch/v_dim_product — signature และ body เดิมทุกตัวคงอยู่
--
-- 🔴 ตัดสินใจเอง (ไม่มีในบรีฟ ต้องรายงาน Tech Lead):
--   D1 — note/received_on ของ stock_lot ล็อกด้วยเช่นกัน (บรีฟให้ตัดสินเอง):
--        received_on กำหนดลำดับ FIFO โดยตรงผ่าน idx_stock_lot_fifo (shop_id,
--        product_id, received_on, created_at) — ถ้าแก้ได้อิสระจะสลับลำดับกิน
--        ของได้โดยไม่มีร่องรอย ส่วน note เป็น provenance เดียวที่บอกที่มาของ
--        ต้นทุน (po_no) ไม่มี caller ไหนในระบบวันนี้ต้องการแก้ 2 ฟิลด์นี้หลัง
--        สร้าง lot แล้วจริง — ถ้าอนาคตมี use case แก้ note (เช่น พิมพ์ผิด) ให้
--        เปิดเฉพาะคอลัมน์นั้นเป็น migration แยกพร้อมเหตุผลใหม่
--   D2 — id/created_at ของ stock_lot ก็ล็อกด้วย (ไม่ได้อยู่ใน 6 คอลัมน์ที่บรีฟ
--        ระบุ) ตาม pattern เดียวกับ analytics.production_order_deny_mutation
--        (0131) ที่ล็อก created_at/created_by ของ production_order — คอลัมน์
--        identity ควรล็อกเป็นค่าเริ่มต้นเสมอ ไม่ใช่แค่คอลัมน์ที่มีคนขอ
--   D3 — เลือกเขียน analytics.stock_lot_deny_truncate() ใหม่แทนใช้ analytics.
--        oem_receipt_deny_truncate() ซ้ำ (บรีฟให้เช็คว่าใช้ซ้ำได้ไหม): ข้อความ
--        ของฟังก์ชันเดิมอ้างอิง "analytics.oem_receipt_void" ตรงๆ ซึ่งไม่ใช่
--        วิธีแก้ปัญหาของ stock_lot เลย — ใช้ซ้ำแล้วข้อความจะผิด/สร้างความสับสน
--        ให้คนอ่าน error ในอนาคต เขียนฟังก์ชันใหม่ที่ใช้ tg_table_name แทน
--        (generic เหมือนกัน แต่ข้อความถูกต้องกับบริบท)
--
-- อ้างอิง: supabase/migrations/0138_stock_lot_tables.sql (นิยามล่าสุดของทุก
-- object ที่ไฟล์นี้แก้ — body ของ production_order_done ลอกมาจากไฟล์นั้นคำต่อ
-- คำแล้วแก้เฉพาะจุดที่ทำเครื่องหมาย "0139 fix #" ไว้), 0132_production_order_
-- security_fixes.sql (M1/M2/M4 ที่ต้องไม่หาย), 0131_production_order.sql
-- (deny_mutation pattern ต้นแบบ), 0087_oem_reissue_hardening.sql (deny_truncate
-- pattern ต้นแบบ), 0137_track_stock_set_idem_fix.sql (raise warning → raise
-- exception redaction pattern), skill 3j-migration-traps

-- ============================================================================
-- §1. analytics.stock_lot — updated_at trigger + deny mutation + deny truncate
--     + แคบ grant service_role
-- ============================================================================

drop trigger if exists trg_stock_lot_updated_at on analytics.stock_lot;
create trigger trg_stock_lot_updated_at
  before update on analytics.stock_lot
  for each row execute function public.set_updated_at();

-- UPDATE อนุญาตเฉพาะ qty_remaining (FIFO consumption รอบหน้าใช้ลด/คืนค่านี้) —
-- คอลัมน์อื่นทั้งหมดล็อกถาวรตั้งแต่สร้าง lot รวม id/created_at (identity, D2)
-- และ note/received_on (D1 — received_on กำหนดลำดับ FIFO ผ่าน idx_stock_lot_fifo)
-- DELETE ปฏิเสธเสมอ — ต้นทุนตามรอบผลิตต้องคงอยู่ตลอดไปเป็นหลักฐานย้อนหลัง
create or replace function analytics.stock_lot_deny_mutation()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
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
$$;

revoke execute on function analytics.stock_lot_deny_mutation() from public, anon, authenticated;

comment on function analytics.stock_lot_deny_mutation() is
  '0139: trigger function กัน UPDATE/DELETE ตรงบน analytics.stock_lot (แม้ผ่าน
   service_role ซึ่งมี BYPASSRLS) — DELETE ปฏิเสธเสมอ, UPDATE อนุญาตเฉพาะ
   qty_remaining (FIFO consumption ใช้ลด/คืนค่านี้) คอลัมน์อื่นล็อกถาวรรวม
   note/received_on/id/created_at (ตัดสินใจ 0139 — ดูหัวไฟล์ D1/D2). pattern
   เดียวกับ analytics.production_order_deny_mutation (0131).';

drop trigger if exists trg_stock_lot_deny_mutation on analytics.stock_lot;
create trigger trg_stock_lot_deny_mutation
  before update or delete on analytics.stock_lot
  for each row execute function analytics.stock_lot_deny_mutation();

-- TRUNCATE ทะลุ trigger แถว (for each row ไม่ยิงตอน TRUNCATE ตามสเปก Postgres)
-- ปิด 2 ชั้นเหมือน 0087: revoke ที่ต้นตอ + statement-level trigger กันเผื่อ
-- วันหน้ามีคน grant กลับมาโดยไม่อ่าน comment นี้ — เขียนฟังก์ชันใหม่แทนใช้
-- analytics.oem_receipt_deny_truncate() ซ้ำ เพราะข้อความของฟังก์ชันนั้นอ้างอิง
-- analytics.oem_receipt_void ตรงๆ ซึ่งไม่เกี่ยวกับ stock_lot เลย (D3)
create or replace function analytics.stock_lot_deny_truncate()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
begin
  raise exception 'stock_lot: ห้าม TRUNCATE ตาราง % — ต้นทุนตามรอบผลิตต้องคงอยู่ตลอดไปเป็นหลักฐานย้อนหลัง ไม่มีคำสั่งลบทั้งตาราง', tg_table_name
    using errcode = '22023';
end;
$$;

revoke execute on function analytics.stock_lot_deny_truncate() from public, anon, authenticated;

comment on function analytics.stock_lot_deny_truncate() is
  '0139: trigger function กัน TRUNCATE บน analytics.stock_lot — statement-level
   แยกจาก analytics.oem_receipt_deny_truncate (0087) เพราะข้อความของฟังก์ชันนั้น
   อ้างอิง analytics.oem_receipt_void ซึ่งไม่เกี่ยวกับ stock_lot เลย (D3, ดูหัว
   ไฟล์) ใช้ซ้ำแล้วข้อความจะผิด/สร้างความสับสนให้คนอ่าน error.';

drop trigger if exists trg_stock_lot_deny_truncate on analytics.stock_lot;
create trigger trg_stock_lot_deny_truncate
  before truncate on analytics.stock_lot
  for each statement execute function analytics.stock_lot_deny_truncate();

-- แคบ grant ของ service_role: ตัด DELETE/TRUNCATE ออก (การป้องกันชั้นที่ 1 —
-- ทำงานก่อน trigger เสมอ เพราะ Postgres เช็ค table privilege ก่อนพิจารณา
-- trigger ใดๆ) เหลือแค่สิ่งที่ caller ที่มีอยู่จริงวันนี้ต้องใช้จริง
revoke all on analytics.stock_lot from service_role;
grant select, insert, update on analytics.stock_lot to service_role;

comment on table analytics.stock_lot is
  '0138 (L1 ของ design-inventory-lot-costing.md): 1 แถว = ของเข้า 1 ครั้งต่อ SKU
   (production = จากใบผลิต, opening = backfill ยอดคงเหลือตอนเริ่มระบบ lot,
   purchase = ซื้อเข้า — ยังไม่มี caller วันนี้). unit_cost ล็อกที่ตอนรับเข้า
   ไม่เปลี่ยนตามราคาตลาดทีหลัง (มติเจ้าของ D1, 19 ก.ย. 69). qty_remaining ลดลง
   ตอนขาย (FIFO consumption — ยังไม่ implement). RLS เปิดไม่มี policy — อ่าน/
   เขียนได้เฉพาะ service_role (ข้อมูลต้นทุนห้ามหลุดถึง authenticated ตรง).
   0139: UPDATE ถูกจำกัดเหลือแค่ qty_remaining เท่านั้น (trg_stock_lot_deny_
   mutation), DELETE/TRUNCATE ปฏิเสธเสมอ, grant service_role เหลือ select/
   insert/update (ตัด delete/truncate) — ปิดช่องแก้/ลบ lot ต้นทุนที่ล็อกถาวรไป
   แบบไม่มีร่องรอย.';

-- ============================================================================
-- §2. stock_lot_derive_shop / stock_lot_consumption_derive_shop — เลิกปล่อย
--     UUID ดิบสู่ข้อความ error ที่ผู้ใช้เห็น (raise warning เก็บ UUID ไว้ที่
--     Postgres log แทน — pattern เดียวกับ 0137 บรรทัด ~127-134)
-- ============================================================================

create or replace function analytics.stock_lot_derive_shop()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
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
$$;

revoke execute on function analytics.stock_lot_derive_shop() from public, anon, authenticated;

comment on function analytics.stock_lot_derive_shop() is
  '0138/0139: derive stock_lot.shop_id จาก product_id เสมอ (ไม่รับตรงจาก caller)
   — ปิดช่อง "insert lot ข้ามร้าน" ที่ระดับ DB แม้ caller ส่ง shop_id ผิดมา
   (pattern เดียวกับ analytics.production_order_item_derive_shop, 0131). 0139:
   ข้อความ error ที่ผู้ใช้เห็นไม่มี UUID ดิบอีกต่อไป (raise warning เก็บไว้ที่
   Postgres log แทน).';

drop trigger if exists trg_stock_lot_derive_shop on analytics.stock_lot;
create trigger trg_stock_lot_derive_shop
  before insert or update of product_id on analytics.stock_lot
  for each row execute function analytics.stock_lot_derive_shop();

create or replace function analytics.stock_lot_consumption_derive_shop()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
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
$$;

revoke execute on function analytics.stock_lot_consumption_derive_shop() from public, anon, authenticated;

comment on function analytics.stock_lot_consumption_derive_shop() is
  '0138/0139: derive stock_lot_consumption.shop_id จาก product_id เสมอ + cross-
   validate ว่า lot_id เป็นของ SKU/ร้านเดียวกันจริง — ปิดช่อง "insert ข้ามร้าน"
   หรือ "ผูก consumption กับ lot ของ SKU อื่น" ที่ระดับ DB (0139 จะเป็น caller
   หลัก). 0139: ข้อความ error ที่ผู้ใช้เห็นไม่มี UUID ดิบอีกต่อไป (raise warning
   เก็บไว้ที่ Postgres log แทน) — ตัวตารางเองยังไม่ใส่ deny_mutation/truncate-
   guard รอบนี้ (ดูหัวไฟล์ §เหตุผลที่ไม่แตะ stock_lot_consumption).';

drop trigger if exists trg_stock_lot_consumption_derive_shop on analytics.stock_lot_consumption;
create trigger trg_stock_lot_consumption_derive_shop
  before insert or update of product_id, lot_id on analytics.stock_lot_consumption
  for each row execute function analytics.stock_lot_consumption_derive_shop();

-- ============================================================================
-- §3. analytics.production_order_done — 3 fix (signature เดิม uuid, uuid,
--     jsonb, numeric, uuid — ไม่ drop function, 3j-migration-traps ข้อ 1)
--     body ลอกมาจาก 0138_stock_lot_tables.sql คำต่อคำ แก้เฉพาะจุดที่มาร์ค
--     "0139 fix #" ไว้เท่านั้น
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
  -- fail-closed: ใบที่ใช้ราคาเงินจริง (v_needs_spot) ต้องส่ง arg นี้มาเสมอ —
  -- null = raise ไม่ใช่ "ข้ามการเทียบ" ใบที่ทุกบรรทัดเป็น fixed ไม่แตะเงื่อนไขนี้
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
  v_lot_inserted   int; -- 0139 fix #2
begin
  if p_shop_id is null or p_production_order_id is null then
    raise exception 'production_order_done: p_shop_id and p_production_order_id are required';
  end if;
  if p_items is not null and jsonb_typeof(p_items) <> 'array' then
    raise exception 'production_order_done: p_items ต้องเป็น json array' using errcode = '22023';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  -- 0139 fix #3 (deadlock คู่ done×done): lock ต่อ (shop, ฟังก์ชันนี้) ก่อนแตะ
  -- แถวใดๆ เลย ทำให้สอง session ที่กด done พร้อมกันในร้านเดียวกันต้องรอกันเป็น
  -- คิว ไม่มีทางชนกันตอนพยายามล็อกแถว production_order/product พร้อมกันคนละ
  -- ลำดับอีกต่อไป (คู่กับ order by poi.product_id ด้านล่างที่ปิด ABBA ระหว่าง
  -- SKU ต่างลำดับในรอบเดียวกัน) — 🔴 คนละ key กับ 'analytics.fact_order:' ที่
  -- 0114/0115/0117/0133/0135/0136 ใช้ล็อกตอนนำเข้าไฟล์ยอดขาย/reconcile โดยตั้งใจ
  -- (คนละ critical section กันจริง — ถ้าใช้ key เดียวกันการกดใบผลิตจะไปบล็อก
  -- การนำเข้าไฟล์ยอดขายโดยไม่จำเป็น)
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
        'unit_cost', poi.unit_cost, 'prev_cost_type', poi.prev_cost_type, 'prev_unit_cost', poi.prev_unit_cost
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
  -- qty_planned) เก็บลง v_work แล้ววนอ่านซ้ำ 2 รอบ (validate แล้วค่อย mutate)
  -- 0139 fix #3: `order by poi.product_id` ใน jsonb_agg — ล็อกลำดับให้ทุก
  -- caller (ไม่ว่าใบไหน) ประมวลผล/ล็อกแถว product ตามลำดับ product_id จากน้อย
  -- ไปมากเสมอ ⇒ สอง session ที่มี SKU เดียวกันคนละลำดับใน v_items ของตัวเอง จะ
  -- ยัง `for update` แถว product ตามลำดับเดียวกัน ปิด ABBA deadlock (40P01)
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
  -- (qty_done>0) เป็นโหมด spot — ห้าม fallback ราคาเมื่อวาน
  select exists (
    select 1 from jsonb_array_elements(v_work) e
    join public.product p on p.id = (e ->> 'product_id')::uuid
    where p.cost_type = 'spot' and (e ->> 'qty_done_resolved')::int > 0
  ) into v_needs_spot;

  if v_needs_spot then
    v_spot := analytics.production_spot_resolve(p_shop_id, v_order.spot_override_thb_per_gram);
  end if;

  -- 0132 M1 (fail-closed): เทียบราคาเงินที่ client "คาดหวัง" กับราคาที่ resolve
  -- ได้จริง ณ ตอนนี้ — ก่อนแตะสต็อก/ต้นทุนบรรทัดแรกเสมอ. เทียบเฉพาะตอน
  -- v_needs_spot จริง; ไม่ null-safe compare เพื่อกัน NaN/Infinity หลุดผ่าน
  -- (3j-migration-traps ข้อ 4 — not(<=) ไม่ใช่ <=)
  if v_needs_spot then
    if p_expected_spot_thb_per_gram is null then
      raise exception 'production_order_done: ใบนี้ใช้ราคาเงินคำนวณต้นทุน ต้องส่งราคาที่หน้าจอเห็น (p_expected_spot_thb_per_gram) มาด้วยเสมอ — กดยืนยันจากหน้าใบผลิตเท่านั้น'
        using errcode = '22023';
    end if;
    if not (abs(v_spot - p_expected_spot_thb_per_gram) <= 0.0001) then
      raise exception 'production_order_done: ราคาเงินเปลี่ยนไประหว่างที่เปิดหน้าต่างนี้ค้างไว้ (ตอนเปิดหน้าต่างเห็นราคา % บาท/กรัม แต่ตอนนี้ระบบคำนวณได้ % บาท/กรัม) — ปิดหน้าต่างยืนยันนี้แล้วเปิดใบผลิตใหม่อีกครั้งเพื่อดูราคาล่าสุดก่อนยืนยัน', p_expected_spot_thb_per_gram, v_spot using errcode = '22023';
    end if;
  end if;

  -- รอบที่ 2: mutate จริง
  --
  -- 🔴 ลำดับ load-bearing (0131/0132/0138 — ห้ามสลับ):
  --   1) เขียน snapshot ลง production_order_item (unit_cost/prev_*) ก่อน
  --   2) ensure central_stock แถวมีอยู่ + adjust_stock
  --   3) insert analytics.stock_lot (ต้นทุนของรอบผลิตนี้ — D1 0138) + ยังคง
  --      set track_stock/since เหมือนเดิม
  --   4) พลิก production_order.status = 'done' เป็นบรรทัดสุดท้ายของฟังก์ชัน
  -- ต้องพลิกสถานะ "หลังสุด" เท่านั้น เพราะ trigger
  -- analytics.production_order_item_deny_mutation เช็คสถานะใบแม่สดทุกครั้งที่
  -- UPDATE item — ถ้าพลิกสถานะเป็น done ก่อนเขียนข้อ (1) ธุรกรรมนี้จะกัดตัวเอง
  for v_elem in select * from jsonb_array_elements(v_work) loop
    v_qty_done := (v_elem ->> 'qty_done_resolved')::int;

    if v_qty_done = 0 then
      -- ไม่ได้ผลิตจริงสำหรับรายการนี้ — บันทึกแค่ qty_done=0 ไม่แตะต้นทุน/สต็อก/lot
      update analytics.production_order_item
         set qty_done = 0, updated_at = now()
       where id = (v_elem ->> 'id')::uuid;
      continue;
    end if;

    -- 🔴 0138: `for update` ปิด ABBA deadlock กับ analytics.product_track_stock_
    -- set (0137) ซึ่งล็อก product ก่อน central_stock — ฟังก์ชันนี้ (ก่อนหน้านี้)
    -- ล็อก central_stock (ผ่าน adjust_stock ด้านล่าง) ก่อนล็อก product ทีหลัง
    -- กลับลำดับกัน ⇒ ล็อกที่นี่ให้เกิดก่อนแตะ central_stock เสมอ (security
    -- review ของ 0135, MEDIUM-1) — คนละเรื่องกับ advisory lock ของ 0139 ด้านบน
    -- (แถวต่อแถวเทียบกับทั้งฟังก์ชันต่อ shop)
    select * into v_product from public.product
      where id = (v_elem ->> 'product_id')::uuid and shop_id = p_shop_id
      for update;
    if not found then
      raise exception 'production_order_done: ไม่พบ SKU (product_id=%) ในร้านนี้', v_elem ->> 'product_id' using errcode = '22023';
    end if;
    if not v_product.is_active then
      raise exception 'production_order_done: SKU % ปิดใช้งานแล้ว ผลิตไม่ได้', v_product.sku using errcode = '22023';
    end if;
    -- เช็คซ้ำตอน done เผื่อ SKU ถูก rename เป็น live* หลังถูกใส่ในใบไปแล้ว
    if v_product.sku ~* '^live' then
      raise exception 'production_order_done: SKU % เป็น SKU เฉพาะไลฟ์ (live*) ผลิตไม่ได้', v_product.sku using errcode = '22023';
    end if;

    -- 0132 M-b: กันเคส product.cost_type ถูกพลิกเป็น spot คั่นกลาง (READ COMMITTED)
    -- แล้ว production_cost_calc ไปหยิบราคาสดเอง ⇒ ข้ามการเทียบ M1 — raise แทนการเดาต่อ
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

    -- v_before/v_after ของ audit log ไม่รวม cost_type/unit_cost เป็น "เปลี่ยน"
    -- (ฟังก์ชันนี้เลิก stamp ต้นทุนกลับ product ตั้งแต่ 0138 — D1) ต้นทุนของ
    -- รอบผลิตนี้ไปอยู่ที่ stock_lot แถวใหม่ด้านล่างแทน
    v_before := jsonb_build_object('cost_type', v_product.cost_type, 'unit_cost', v_product.unit_cost,
      'track_stock', v_product.track_stock, 'track_stock_since', v_product.track_stock_since);

    -- (1) snapshot ลง item ก่อน — ใบยังเป็น open ตอนนี้ ผ่าน trigger กันแก้
    update analytics.production_order_item
       set qty_done = v_qty_done, unit_cost = v_unit_cost,
           prev_cost_type = v_product.cost_type, prev_unit_cost = v_product.unit_cost,
           updated_at = now()
     where id = (v_elem ->> 'id')::uuid;

    -- (2) ensure central_stock แถวมีอยู่ก่อนเสมอ — SKU จาก generator ไม่มีแถวนี้
    -- มาตั้งแต่ต้น adjust_stock จะ raise ข้อความหลอก "would go negative" ถ้าไม่มี
    -- แถวให้ UPDATE เจอเลย
    insert into public.central_stock (product_id) values (v_product.id)
      on conflict (product_id) do nothing;

    perform public.adjust_stock(p_shop_id, v_product.id, v_qty_done, 'po:' || (v_elem ->> 'id'));

    -- (3) เปิด track_stock เหมือนเดิม (ห้ามเลื่อน track_stock_since ถ้าเปิดอยู่
    -- แล้ว — coalesce ค่าเดิมไว้ก่อนเสมอ) — ไม่ stamp cost_type/unit_cost กลับ
    -- product อีกต่อไป (D1, 0138)
    update public.product
       set track_stock = true,
           track_stock_since = coalesce(v_product.track_stock_since, v_today),
           updated_at = now()
     where id = v_product.id;

    -- สร้าง lot ต้นทุนของรอบผลิตนี้ — on conflict ผูกกับ partial unique index
    -- (production_order_item_id) กัน insert lot ซ้ำ
    insert into analytics.stock_lot (
      shop_id, product_id, source, unit_cost, qty_in, qty_remaining, received_on,
      production_order_item_id, note
    ) values (
      p_shop_id, v_product.id, 'production', v_unit_cost, v_qty_done, v_qty_done, v_today,
      (v_elem ->> 'id')::uuid, 'po_no=' || v_order.po_no
    )
    on conflict (production_order_item_id) where production_order_item_id is not null do nothing;

    -- 0139 fix #2: `on conflict do nothing` เดิมเป็น fail-open — ถ้ามี lot ผูก
    -- item นี้อยู่ก่อนแล้ว (ในทางปกติเข้าไม่ถึงบรรทัดนี้ เพราะเคส "done ซ้ำ"
    -- ถูก early-return ไปตั้งแต่ต้นฟังก์ชันแล้ว แต่ถ้าข้อมูลเพี้ยนหรือมีคนแก้
    -- นอกช่องทาง RPC) เดิมฟังก์ชันจะคืนสำเร็จทั้งที่ไม่ได้บันทึกต้นทุนรอบนี้เลย
    -- ทั้งที่สต็อกถูกปรับเพิ่มไปแล้วและสถานะกำลังจะพลิกเป็น done — ไม่มีใครรู้
    -- ⇒ get diagnostics เช็คว่า insert ได้จริง ถ้าไม่ได้ raise ทั้งธุรกรรมถอย
    -- (การ snapshot item + adjust_stock + stamp track_stock ที่ทำไปแล้วใน
    -- iteration นี้ rollback กลับไปด้วยเพราะทั้งฟังก์ชันเป็น atomic statement)
    get diagnostics v_lot_inserted = row_count;
    if v_lot_inserted = 0 then
      raise exception 'production_order_done: พบ lot ต้นทุนของ SKU % ผูกกับรายการนี้อยู่ก่อนแล้ว (ใบ %) — ข้อมูลไม่สอดคล้องกัน ห้ามลองกดใหม่เอง แจ้งทีมพัฒนาก่อน', v_product.sku, v_order.po_no using errcode = '22023';
    end if;

    v_after := jsonb_build_object('cost_type', v_product.cost_type, 'unit_cost', v_product.unit_cost,
      'track_stock', true, 'track_stock_since', coalesce(v_product.track_stock_since, v_today));

    -- 0132 M4: coalesce(p_actor, auth.uid())
    insert into analytics.catalog_audit_log (shop_id, product_id, sku, action, before, after, changed_by)
    values (p_shop_id, v_product.id, v_product.sku, 'edit', v_before, v_after, coalesce(p_actor, auth.uid()));
  end loop;

  -- (4) พลิกสถานะเป็นบรรทัดสุดท้ายของฟังก์ชันเท่านั้น
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
$$;

-- signature ไม่เปลี่ยน (uuid, uuid, jsonb, numeric, uuid) — ไม่ต้อง drop function
-- (3j-migration-traps ข้อ 1) แต่ยังต้อง re-state revoke/grant เสมอ (ข้อ 2 —
-- defense-in-depth ตามบรีฟ แม้ signature เดิมจะไม่ทำให้ grant หายจริงก็ตาม)
revoke execute on function analytics.production_order_done(uuid, uuid, jsonb, numeric, uuid) from public, anon, authenticated;
grant execute on function analytics.production_order_done(uuid, uuid, jsonb, numeric, uuid) to service_role;

notify pgrst, 'reload schema';

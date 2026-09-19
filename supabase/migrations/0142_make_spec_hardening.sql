-- 0142_make_spec_hardening.sql
--
-- ทำไม: security review ของ 0141 (โหมดต้นทุน "คำนวณจากสเปค") เจอ 3 HIGH + 2
-- MEDIUM แล้วเจ้าของรันพิสูจน์จริงบน DB แล้วทั้งหมด — 0141 apply ขึ้น prod
-- ไปแล้ว (merge 7cf6e73) แปลว่าทุกช่องข้างล่างเปิดอยู่จริงตอนนี้ รอแค่มีคนใช้
-- (สถานะ 19 ก.ย. 69: cost_type='spec' = 0 SKU, production_order_item ที่มี
-- is_new_design/cost_calc = 0 แถว ⇒ ยังไม่มีข้อมูลจริงเสียหายสักแถว — ปิดก่อน
-- มีคนใช้จริง ไม่ใช่ incident response)
--
-- 🔴 HIGH-1 (แก้ในไฟล์นี้ §1): product_make_spec_clear early-return แคบไป —
-- เช็คแค่ "cost_type='fixed' และ make_spec is null" แล้วไม่ตรงก็ตกไป UPDATE
-- คำสั่ง cost_type='fixed' แบบไม่มีเงื่อนไข ⇒ เรียก clear ใส่ SKU โหมด 'spot'
-- (make_spec เป็น null อยู่แล้วโดยธรรมชาติ ไม่เคยตั้งสเปค) จะถูกพลิกเป็น
-- 'fixed' ทันที แล้ว v_dim_product หยิบ unit_cost เก่าที่ 0134 ไม่เคยล้างทิ้ง
-- ขึ้นมาใช้ (พิสูจน์จริงบนแท่งเงิน 6 ตัว: 1,166.01 -> 1,713.00 = +47%) ถ้าสั่ง
-- ผลิต SKU นั้นต่อ เลขที่ผิดจะ stamp ลง stock_lot ถาวร
--
-- 🔴 HIGH-2 (§2 ชั้น RPC + §3 ชั้น CHECK): 0141 กันทาง "เข้า" spec ไว้แล้ว
-- (product_upsert ปฏิเสธ p_cost_type='spec' ถ้า make_spec ยังไม่เคยตั้ง) แต่
-- ไม่มีด่านกันทาง "ออก" — product_upsert(cost_type='fixed', ...) บน SKU โหมด
-- spec พลิกสำเร็จเงียบๆ แล้ว make_spec ค้างเป็นขยะ (ยืนยันจากไฟล์จริงแล้วว่า
-- product_upsert_bulk, supabase/migrations/0032_bulk_action_codes.sql,
-- forward cost_type ผ่าน `coalesce(nullif(btrim(r->>'cost_type'),''),'fixed')`
-- เข้า product_upsert ตัวเดียวกันเป๊ะ ⇒ แถว CSV ที่ไม่มีคอลัมน์ cost_type จะ
-- ส่ง 'fixed' เข้ามาเสมอ ⇒ การ์ดเดียวใน product_upsert ครอบทั้ง /catalog
-- โดยตรงและ bulk import โดยไม่ต้องแก้ 0032) ปิดด้วย 2 ชั้น: RPC guard (แจ้ง
-- เหตุผลได้ชัด) + table CHECK (กัน UPDATE ตรงผ่าน service_role ที่ตั้ง
-- cost_type='spec' โดยไม่มี make_spec — CHECK ตรวจความสมบูรณ์ของแถวปัจจุบัน
-- เท่านั้น ไม่ใช่กฎการเปลี่ยนสถานะ ดังนั้นยังไม่ปิด UPDATE ตรงที่พลิกออกจาก
-- spec (cost_type='fixed' ขณะ make_spec ยังไม่ null) — ทางนั้นต้องพึ่ง RPC
-- guard เท่านั้น (ดูหมายเหตุท้ายไฟล์ "จุดที่ตัดสินใจเอง")
--
-- ⚠️ ราคาที่ต้องจ่าย (เหมือนที่ Tech Lead เตือนไว้ในบรีฟ): หลังใส่ guard นี้
-- /catalog จะบันทึกแก้ไข SKU โหมด spec ไม่ได้เลย (lib/catalog/types.ts ยังไม่
-- รู้จัก cost_type='spec' ณ วันนี้ — grep แล้วยืนยันว่ายังเป็นแค่
-- "fixed" | "spot") จนกว่าเฟส UI จะตามให้ทัน — fail-closed ตั้งใจ ดีกว่าพลิก
-- โหมดเงียบๆ โดยเจ้าของไม่รู้ตัว (ตอนนี้ 0 SKU เป็น spec จริง จึงยังไม่กระทบ
-- ใครเลย)
--
-- 🔴 HIGH-3 (§7): analytics.v_dim_product (0028, ไม่แตะรอบนี้ตามที่สั่ง) ให้
-- effective_unit_cost = NULL สำหรับ cost_type='spec' (CASE เช็คแค่ 'spot' vs
-- else) ⇒ analytics.transform_pending_order_lines (0136) คำนวณ
-- cogs += qty * coalesce(unit_cost, 0) แล้วไม่เคยติ๊ก v_weak_order ให้ ⇒
-- COGS ออกมาเป็น 0 แต่ profit_status ยังเป็น 'actual' — คลาสเดียวกับบั๊ก
-- กำไรเงินแท่ง ÷1.2 ที่เจอเช้าวันเดียวกัน (กำไรเกินจริงโดยระบบบอกว่าเชื่อถือ
-- ได้) แก้รอบนี้ = ทำให้มันดังแทนเงียบ (ไม่ใช่ cutover — การตัดสินว่า spec
-- อ่านต้นทุนจาก lot_cost_avg หรือ production_order_item.unit_cost ล่าสุด เป็น
-- มติที่ต้องถามเจ้าของ พันกับงาน cutover กำไรเงินแท่ง D3 ที่ยังค้าง) —
-- 🔴 ไม่แตะ v_dim_product/effective_unit_cost เลยสักบรรทัดตามที่สั่ง
--
-- 🟡 MEDIUM-1 (§4): production_cost_calc ทำ
-- `v_product.make_spec || jsonb_build_object(...)` โดย make_spec เป็นฐาน
-- (ซ้ายของ ||) คีย์ที่ jsonb_build_object ไม่ทับ (เช่น as_of_date) จะรอดเข้า
-- v_spec_input แล้ว oem_cost_calc (0140) ใช้ as_of_date นั้นกับ **ทุก** rate
-- lookup ไม่ใช่แค่ราคาโลหะ (สเปรปฏิเสธ/พอลิช/labor ทุกขั้น/flask/plating/nre
-- — grep v_as_of ใน 0140 เจอ 20+ จุด) ⇒ ฉีด as_of_date ย้อนหลังเปลี่ยนต้นทุน
-- ทั้งใบได้ ซ้อนกับ trap #6: ไม่ฉีดอะไรเลยก็ยังผิดได้เอง เพราะ oem_cost_calc
-- fallback เป็น `current_date` ซึ่งเป็น UTC — ช่วง 00:00-07:00 ไทย เรตที่กรอก
-- วันนี้ยังไม่มีผล แก้ด้วยการทับ as_of_date ด้วยวันที่ไทยเสมอ (ปิดทั้งสอง
-- ปัญหาพร้อมกัน) + CHECK ที่ตารางห้าม make_spec มีคีย์ต้องห้าม 3 ตัว
-- (as_of_date, is_new_design, metal_price_thb_per_gram — สองตัวหลังกันไว้
-- เผื่ออนาคตด้วยเหตุผลเดียวกัน) + เก็บ as_of_date ที่ใช้จริงลง cost_calc
-- snapshot เพื่อพิสูจน์ย้อนหลังได้ว่าใบผลิตนี้คิดด้วยเรตของวันไหน
--
-- 🟡 MEDIUM-2 (§4 ไฟล์เดียวกับ MEDIUM-1): metal/labor/batch/nre_per_piece
-- ปัดเศษแยกกัน 4 ตัวจากค่าดิบอิสระกัน แต่ unit_cost ปัดจากผลรวมดิบ ⇒ คลาดได้
-- ~0.01-0.02 ต่อใบ และ breakdown นี้ขึ้นจอให้เจ้าของเห็นตรงๆ (ผิด
-- oem-quote-invariants ข้อ 3 — ผลรวมส่วนย่อยต้องเท่ายอดเต็มเป๊ะ) แก้ด้วยปัด
-- metal/labor/nre_per_piece ก่อน แล้วให้ batch_per_piece เป็นเศษที่เหลือ
--
-- 🟢 เก็บด้วย (§5, §6): product_make_spec_set/_clear grant ตัดเหลือ
-- service_role (เดิมให้ authenticated ด้วย ทั้งที่ยังไม่มี TypeScript เรียก
-- เลยสักที่ — grep แล้วยืนยัน ตรงกับ production_cost_calc ในไฟล์เดียวกันที่
-- service_role อย่างเดียวอยู่แล้ว) · product_make_spec_set เพิ่มเช็ค is_active
-- และ sku ~* '^live' (live* ผลิตเองไม่ได้อยู่แล้วตามมติ 17 ก.ย. — เดิมด่านนี้
-- มีแค่ตอน production_order_done ไม่มีตอนตั้งสเปค) · `if not v_is_complete`
-- เปลี่ยนเป็น `if v_is_complete is not true` (null ไม่ยิง raise ผิดที่ — เดิม
-- ถ้า is_complete cast ไม่ได้/เป็น null คำสั่ง `if not null` จะไม่ raise เลย
-- แล้วโค้ดจะพยายามอ่าน _raw ที่ไม่สมบูรณ์ต่อ)
--
-- 🔴 traps ที่ต้องระวัง (skill 3j-migration-traps):
--   #1 signature ไม่เปลี่ยนสักฟังก์ชันในไฟล์นี้ (แก้ body อย่างเดียวทั้งหมด)
--      ⇒ ไม่ต้อง drop function แต่ยัง re-grant ทุกตัวเสมอ (ข้อ 2)
--   #2 grant หายทุกครั้งที่ replace — re-state revoke/grant ครบทุกฟังก์ชันที่
--      แตะ (5 ตัว: product_make_spec_clear, product_upsert,
--      production_cost_calc, product_make_spec_set,
--      transform_pending_order_lines)
--   #3 table ปกติไม่ติดกับดัก 42P16 (เฉพาะ view) — CHECK constraint เพิ่มได้
--      อิสระ ไม่กระทบ column order
--   #6 UTC vs เวลาไทย — แก้ตรงตามที่อธิบายใน MEDIUM-1 ข้างบน
--   #11 ทดสอบผ่าน do-block + raise บังคับ rollback เสมอ —
--      scripts/verify-0142.sql
--
-- 🔴 จุดที่ตัดสินใจเอง (ไม่ได้อยู่ในบรีฟตรงๆ — บอกไว้ตรงนี้ตามกติกา):
--   1. table CHECK ของ HIGH-2 (`cost_type <> 'spec' or make_spec is not
--      null`) กันได้แค่ "แถวที่เป็น spec ต้องมี make_spec คู่กันเสมอ" ไม่ได้
--      กัน "การพลิกออกจาก spec ด้วย UPDATE ตรง" (คือ update ... set
--      cost_type='fixed' while make_spec ยังไม่ null ก็ยังผ่าน CHECK นี้ได้
--      เพราะเงื่อนไข short-circuit ที่ cost_type<>'spec' ก่อน) ทางนั้นยังพึ่ง
--      RPC guard (product_upsert) อย่างเดียว — service_role ที่รัน UPDATE
--      ตรงยังพลิกออกได้อยู่ (แต่ทางนั้นเป็น backend ที่เชื่อถือได้อยู่แล้ว
--      เทียบเท่าคนที่ทำ DDL ได้ ไม่ใช่ผู้ใช้ทั่วไปผ่าน RLS) ตรงกับที่บรีฟให้
--      ตัวอย่างไว้คำต่อคำ (`check (cost_type <> 'spec' or make_spec is not
--      null)`) จึงใช้ตามนั้น ไม่ได้เพิ่ม trigger ป้องกันการเปลี่ยนสถานะเพราะ
--      บรีฟไม่ได้ขอและเพิ่ม surface ที่ไม่ได้ขอ
--   2. HIGH-3: ติดป้าย estimated เมื่อ "SKU จับคู่ได้แล้วแต่ unit_cost เป็น
--      null" เท่านั้น — ไม่ครอบเคส unit_cost เป็นเลขเก่าที่ค้างอยู่ (SKU เคย
--      เป็น fixed มี unit_cost แล้วค่อยถูกตั้งเป็น spec ทีหลัง — product_
--      make_spec_set ไม่แตะ unit_cost คอลัมน์เลย) เพราะการตรวจแบบนั้นต้องรู้
--      cost_type ของ SKU ที่จับคู่ได้ (ต้องเพิ่ม vp.cost_type เข้า select
--      list ของ v_dim_product query ในลูป ซึ่งเป็นการขยาย surface ที่บรีฟ
--      ไม่ได้ขอ) และ HIGH-1 ปิดช่องทางหลักที่ทำให้เกิดค่าเก่าค้างไปแล้ว (clear
--      ไม่พลิก spot/fixed เงียบๆ อีกต่อไป) เหลือแค่เคส fixed-มีราคา-ก่อน
--      -กลายเป็น-spec-ทีหลัง ซึ่งยังไม่เคยเกิดจริง (0 SKU) — บันทึกไว้เป็น
--      known gap ไม่ใช่ปิดเงียบ
--
-- อ้างอิง: supabase/migrations/0141_product_make_spec.sql (สิ่งที่แก้รอบนี้),
-- 0140_oem_cost_calc_extract.sql (as_of_date/_raw), 0136_transform_lock.sql
-- (นิยามล่าสุดของ transform_pending_order_lines — body ด้านล่างลอกมาคำต่อคำ),
-- 0032_bulk_action_codes.sql (ยืนยัน bulk forward ผ่าน product_upsert),
-- skill oem-quote-invariants, skill 3j-migration-traps

-- ============================================================================
-- 1. HIGH-1 — analytics.product_make_spec_clear: early-return ต้องแยกให้ชัด
--    ว่า "ไม่มีอะไรต้องเคลียร์" (โหมดไม่ใช่ spec เลย — ไม่แตะอะไรทั้งนั้น)
--    ออกจาก "เคลียร์จริง" (โหมด spec เท่านั้น) เดิมเช็คแค่กรณีเดียว
--    (fixed+make_spec null) แล้วปล่อยกรณีอื่นทั้งหมด (รวม spot) ตกไปโดน
--    UPDATE คำสั่ง cost_type='fixed' ตายตัว
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

  -- 0142 HIGH-1: ต้องเป็นโหมด spec เท่านั้นถึงจะ "มีอะไรให้เคลียร์" — SKU โหมด
  -- fixed/spot (make_spec เป็น null อยู่แล้วโดยธรรมชาติ เพราะไม่เคยผ่าน
  -- product_make_spec_set) ต้อง early-return แบบไม่แตะคอลัมน์ไหนเลย เดิมเช็ค
  -- แค่ `cost_type='fixed' and make_spec is null` ⇒ SKU โหมด spot (make_spec
  -- ก็ null เหมือนกัน แต่ cost_type ไม่ใช่ 'fixed') หลุดเงื่อนไขนี้ไปโดน UPDATE
  -- ด้านล่างพลิกเป็น 'fixed' แบบไม่มีเงื่อนไข (บั๊กที่พิสูจน์แล้วจริง — ดูหัว
  -- ไฟล์) เงื่อนไขใหม่ `<> 'spec'` ครอบทั้ง fixed และ spot ด้วยตรรกะเดียว ไม่
  -- ต้องแจกแจงทีละโหมด (โหมดใหม่ในอนาคตก็ปลอดภัยโดยไม่ต้องมีใครจำมาแก้)
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
$$;

-- 🟢: ตัดเหลือ service_role ให้ตรงกับ production_cost_calc ในไฟล์เดียวกัน —
-- ยังไม่มี TypeScript เรียก RPC นี้เลยสักที่ (grep repo แล้วยืนยัน) ตัด
-- authenticated ออกตอนนี้ ไม่รอให้เฟส UI มาทีหลังค่อยแก้
revoke execute on function analytics.product_make_spec_clear(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.product_make_spec_clear(uuid, uuid, uuid) to service_role;

-- ============================================================================
-- 2. HIGH-2 ชั้น 1 (RPC guard) — analytics.product_upsert: 0141 กันทาง "เข้า"
--    spec ไว้แล้ว (p_cost_type='spec' ต้องมี make_spec อยู่ก่อน) เพิ่มด่านกัน
--    ทาง "ออก" — SKU ที่อยู่โหมด spec อยู่แล้ว ห้ามพลิกไปโหมดอื่นผ่าน
--    product_upsert เด็ดขาด (ทั้งทาง /catalog ตรงๆ และทาง product_upsert_bulk
--    ที่ forward ผ่านฟังก์ชันนี้ — ยืนยันจาก 0032_bulk_action_codes.sql แล้ว)
--    ต้องไปทาง analytics.product_make_spec_clear เท่านั้นถึงจะออกจาก spec ได้
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

  -- 0142 HIGH-2 ชั้น 1: ทิศตรงข้าม — SKU ที่อยู่โหมด spec อยู่แล้ว (v_old.
  -- cost_type='spec') ห้ามพลิกไปโหมดอื่นผ่านทางนี้เด็ดขาด ไม่ว่าจะเรียกตรง
  -- จาก /catalog หรือผ่าน product_upsert_bulk (แถว CSV ที่ไม่มีคอลัมน์
  -- cost_type จะ coalesce เป็น 'fixed' — ดูหัวไฟล์) พลิกออกได้ทางเดียวคือ
  -- analytics.product_make_spec_clear (มี audit log + เคลียร์ make_spec คู่
  -- กันเสมอ ไม่ปล่อยให้ make_spec ค้างเป็นขยะ) v_old.id is not null กันไว้
  -- ชัดเจนแม้ว่า v_old.cost_type ของแถวที่ไม่มีอยู่จะเป็น null (<> 'spec'
  -- ประเมินเป็น unknown/false อยู่แล้วก็ตาม — กันงงตอนอ่านย้อนหลัง)
  if v_old.id is not null and v_old.cost_type = 'spec' and p_cost_type <> 'spec' then
    raise exception 'product_upsert: SKU % อยู่โหมด "คำนวณจากสเปค" (spec) อยู่ — พลิกออกจากโหมดนี้ต้องผ่าน analytics.product_make_spec_clear เท่านั้น (กันต้นทุนพลิกเงียบโดยไม่ผ่าน audit log)', btrim(p_sku) using errcode = '22023';
  end if;

  insert into public.product (
    shop_id, sku, name, category, cost_type, unit_cost, silver_weight_g,
    silver_purity, labor_cost, list_price, barcode, supplier, note, is_active,
    -- 0142: ต้องพา make_spec เดิมติดไปกับ "แถวที่เสนอจะแทรก" ด้วย เพราะ Postgres
    -- ตรวจ CHECK กับแถวนั้นก่อนจะรู้ว่าชน unique แล้วไหลไป do update ⇒ ถ้าไม่พาไป
    -- product_spec_requires_make_spec_check จะตีตกทุกครั้งที่ upsert SKU โหมด spec
    -- (เจอจากรอบซ้อม 19 ก.ย. — 23514) · SKU ใหม่ v_old.make_spec เป็น null อยู่แล้ว
    -- และ p_cost_type='spec' ถูกด่านด้านบนปฏิเสธไปก่อนแล้ว จึงไม่ชน CHECK
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
$$;

-- signature ไม่เปลี่ยน (14 args) — re-grant ตามวินัย "ทุกครั้งที่แตะ ไม่มี
-- ข้อยกเว้น" (skill 3j-migration-traps ข้อ 2)
revoke execute on function analytics.product_upsert(uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function analytics.product_upsert(uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, text, boolean)
  to authenticated, service_role;

-- ============================================================================
-- 3. HIGH-2 ชั้น 2 (table CHECK) — กัน UPDATE ตรงผ่าน service_role ที่ตั้ง
--    cost_type='spec' โดยไม่มี make_spec คู่กัน (เคสที่ RPC guard ชั้น 1 คุม
--    ไม่ถึง เพราะไม่ได้ผ่าน product_upsert เลย) นี่คือด่านความสมบูรณ์ของแถว
--    ("ถ้าเป็น spec ต้องมี spec") ไม่ใช่ด่านกฎการเปลี่ยนสถานะ — ดู "จุดที่
--    ตัดสินใจเอง" ข้อ 1 ในหัวไฟล์สำหรับขอบเขตที่ยังไม่ครอบ
-- ============================================================================

alter table public.product drop constraint if exists product_spec_requires_make_spec_check;
alter table public.product add constraint product_spec_requires_make_spec_check
  check (cost_type <> 'spec' or make_spec is not null);

-- ============================================================================
-- 4. MEDIUM-1 + MEDIUM-2 + 🟢 (if not v_is_complete) —
--    analytics.production_cost_calc: signature เดิมเป๊ะ (uuid, uuid, numeric,
--    int, boolean) ไม่ drop function แก้ body เฉพาะ branch 'spec' เท่านั้น
--    (branch 'spot'/'fixed' ไม่แตะสักบรรทัด) body ที่เหลือคัดลอกจาก 0141
--    คำต่อคำ
-- ============================================================================

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
  -- 0142 MEDIUM-2: ค่าที่ปัดเศษแล้วของ metal/labor/batch — ปัด 3 ก้อนนี้ (+
  -- nre_per_piece ที่ปัดอยู่แล้วเดิม) ก่อน แล้วให้ batch เป็นเศษที่เหลือ เพื่อ
  -- ให้ metal_r+labor_r+batch_r+nre_r = unit_cost เป๊ะเสมอ (oem-quote-invariants
  -- ข้อ 3) — v_metal_per_piece/v_labor_per_piece/v_batch_per_piece ด้านบนยัง
  -- เก็บค่าดิบไว้เหมือนเดิมสำหรับคำนวณ v_cost_piece/v_unit_cost (ห้ามเปลี่ยน
  -- สูตรนั้น — เป็นค่าที่ผูกกับ v_cost_piece ที่ oem_cost_calc คำนวณมาแล้ว)
  v_metal_per_piece_r numeric;
  v_labor_per_piece_r numeric;
  v_batch_per_piece_r numeric;
  -- 0142 MEDIUM-1: วันที่ไทยที่ใช้จริงในการคำนวณรอบนี้ — ทับ as_of_date ที่
  -- อาจฉีดมาจาก make_spec เสมอ (ดูหัวไฟล์) แล้วเก็บลง snapshot เพื่อพิสูจน์
  -- ย้อนหลังได้
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

    -- 0142 MEDIUM-1: วันที่ไทยของ "ตอนนี้" — คำนวณครั้งเดียว ใช้ทั้งทับ
    -- as_of_date ที่ส่งเข้า oem_cost_calc และเก็บลง snapshot ด้านล่าง
    v_as_of_used := (now() at time zone 'Asia/Bangkok')::date;

    -- 🔴 ห้าม oem_cost_calc lookup ราคาเงินเอง (0131 §M1 — ใบผลิตห้ามใช้ราคา
    -- เก่า) ส่งราคาที่ resolve ไว้แล้วข้างบนเข้าไปตรงๆ ผ่าน
    -- metal_price_thb_per_gram เสมอทุก call path (ไม่มีทางลืมส่ง — บังคับที่
    -- โครงสร้าง ไม่ใช่วินัย caller)
    --
    -- 0142 MEDIUM-1: ทับ as_of_date ด้วยวันที่ไทยเสมอ ไม่ว่า v_product.
    -- make_spec จะมีคีย์นี้ปนมาหรือไม่ (ปกติไม่มี — product_make_spec_set
    -- whitelist คีย์ตอนเขียนอยู่แล้ว และมี CHECK ที่ตารางกันไว้อีกชั้น ดู §5
    -- ในไฟล์นี้ — แต่จุดนี้คือ defense-in-depth ตัวที่ 3: ต่อให้ทั้งสองชั้น
    -- นั้นถูกข้ามไปได้ด้วยเหตุผลใดก็ตาม ที่นี่ก็ยังบังคับใช้วันที่ไทยของ
    -- "ตอนนี้" อยู่ดี ไม่ใช่ค่าที่ make_spec แอบพกมา) jsonb_build_object อยู่
    -- ขวาของ || เสมอชนะคีย์ชื่อเดียวกันจากซ้าย (make_spec) — นี่คือกลไกที่
    -- ปิดทั้งการฉีดค่าย้อนหลังและปัญหา current_date=UTC พร้อมกัน (ไม่ระบุ
    -- as_of_date เลย = oem_cost_calc fallback เป็น current_date ซึ่งเป็น UTC
    -- — ช่วง 00:00-07:00 ไทยจะเหลื่อมวัน)
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
    -- 0142 🟢: `if not v_is_complete` เดิมไม่ raise เมื่อ v_is_complete เป็น
    -- null (cast พังหรือ key หาย) แล้วปล่อยให้โค้ดด้านล่างพยายามอ่าน _raw ที่
    -- อาจไม่สมบูรณ์ต่อ — `is not true` ปฏิบัติกับ null เหมือน false (ปฏิเสธ)
    if v_is_complete is not true then
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

    -- 0142 MEDIUM-2: ปัด metal/labor ก่อน (nre_per_piece ปัดแล้วด้านบน) แล้ว
    -- ให้ batch เป็นเศษที่เหลือ ⇒ metal_r+labor_r+batch_r+nre_r = unit_cost
    -- เป๊ะเสมอ (unit_cost คำนวณจากค่าดิบล้วนด้านบน ไม่ใช่ผลรวมของ 4 ค่าที่
    -- ปัดแล้ว — invariant เดียวกับ "คำนวณตัวหนึ่งแล้วอีกตัวเป็นเศษที่เหลือ")
    v_metal_per_piece_r := round(v_metal_per_piece, 2);
    v_labor_per_piece_r := round(v_labor_per_piece, 2);
    v_batch_per_piece_r := v_unit_cost - v_metal_per_piece_r - v_labor_per_piece_r - v_nre_per_piece;

    -- breakdown เต็มสำหรับหน้าจอ/snapshot — ประกอบทีละ field จาก _raw ที่คลี่
    -- แล้วเท่านั้น ไม่ spread ก้อน _raw ดิบออกไป (แพทเทิร์นเดียวกับ
    -- oem-quote-invariants #1 "ประกอบทีละ field ห้าม spread" — ที่นี่ฟังก์ชัน
    -- นี้เป็น service_role-only ล้วน ไม่มี anon/authenticated เรียกถึง แต่ยังคง
    -- วินัยเดียวกันเพื่อไม่ให้ _raw รั่วไหลเป็นนิสัย)
    v_cost_calc := jsonb_build_object(
      'is_complete', v_is_complete,
      'missing', v_cost_result -> 'missing',
      'price_source', v_cost_result ->> 'price_source',
      -- 0142 MEDIUM-1: บันทึกวันที่ที่ใช้จริง (จาก _raw.as_of_date ที่
      -- oem_cost_calc สะท้อนกลับมา — ต้องเท่ากับ v_as_of_used ที่ส่งเข้าไป
      -- เป๊ะ เพราะทับด้วยคีย์เดียวกันข้างบนแล้ว) ให้พิสูจน์ย้อนหลังได้ว่า
      -- ใบผลิตนี้คิดด้วยเรตของวันไหน
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
-- 5. MEDIUM-1 (ต่อ) — CHECK ที่ตาราง product ห้าม make_spec มีคีย์ต้องห้าม 3
--    ตัว (as_of_date/is_new_design/metal_price_thb_per_gram) — defense-in-
--    depth ชั้นเขียน (write-time) คู่กับชั้นอ่าน (read-time, §4 ข้างบน) กัน
--    ทุกทางเขียน ไม่ใช่แค่ product_make_spec_set (ที่ whitelist คีย์อยู่แล้ว)
-- ============================================================================

alter table public.product drop constraint if exists product_make_spec_forbidden_keys_check;
alter table public.product add constraint product_make_spec_forbidden_keys_check
  check (make_spec is null or not (make_spec ?| array['as_of_date', 'is_new_design', 'metal_price_thb_per_gram']));

-- ============================================================================
-- 6. 🟢 — analytics.product_make_spec_set: เพิ่มเช็ค is_active และ
--    sku ~* '^live' (live* ผลิตเองไม่ได้อยู่แล้วตามมติ 17 ก.ย. 69 —
--    production_order_done เช็คอยู่แล้วตอน done แต่ตอนตั้งสเปคยังไม่เช็ค เลย
--    ตั้งสเปคของ SKU ไลฟ์/ปิดใช้งานได้ทั้งที่ใช้จริงไม่ได้) + grant ตัดเหลือ
--    service_role (ดู §1 เหตุผลเดียวกัน — ยังไม่มี TypeScript เรียก)
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

  -- 0142 🟢: SKU ปิดใช้งานแล้วตั้งสเปคไม่ได้ — ไม่มีประโยชน์ (ผลิตไม่ได้อยู่
  -- แล้ว) และกันสับสนกับ product_upsert ที่ปิด/เปิด is_active ได้อิสระจาก
  -- cost_type (คนละด่านกัน อย่าให้ตั้งสเปคค้างไว้บน SKU ที่ปิดขายไปแล้ว)
  if not v_old.is_active then
    raise exception 'product_make_spec_set: SKU % ปิดใช้งานแล้ว ตั้งสเปคไม่ได้', v_old.sku using errcode = '22023';
  end if;
  -- 0142 🟢: SKU เฉพาะไลฟ์ (live*) ผลิตเองไม่ได้ตามมติ 17 ก.ย. 69 — เดิมด่าน
  -- นี้เช็คแค่ตอน production_order_done (pattern เดียวกับ 0131) ทำให้ตั้งสเปค
  -- ของ SKU ที่ใช้จริงไม่ได้ค้างไว้ได้เงียบๆ เช็คเพิ่มตั้งแต่ write-time
  if v_old.sku ~* '^live' then
    raise exception 'product_make_spec_set: SKU % เป็น SKU เฉพาะไลฟ์ (live*) ผลิตเองไม่ได้ ตั้งสเปคไม่ได้', v_old.sku using errcode = '22023';
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
grant execute on function analytics.product_make_spec_set(uuid, uuid, jsonb, uuid) to service_role;

-- ============================================================================
-- 7. HIGH-3 — analytics.transform_pending_order_lines: signature เดิมเป๊ะ
--    (uuid, uuid) ไม่ drop function — body คัดลอกจาก
--    supabase/migrations/0136_transform_lock.sql คำต่อคำ (ยืนยันแล้วว่าเป็น
--    นิยามล่าสุด — grep ทั้งรีโปไม่เจอ create-or-replace ของฟังก์ชันนี้หลัง
--    0136 เลย) แก้เฉพาะจุดที่ทำเครื่องหมาย "0142" ไว้เท่านั้น — ห้ามลอกพลาด
--    สักบรรทัด (~190 บรรทัด) เหมือนที่ 0136 เตือนไว้ในหัวไฟล์ตัวเอง
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

        -- 0142 HIGH-3: SKU จับคู่ได้ (v_product_id ไม่ null) แต่ effective_
        -- unit_cost เป็น null (เคสหลักตอนนี้: cost_type='spec' — v_dim_product
        -- (0028) ยังไม่รู้จักโหมดนี้ ให้ else p.unit_cost ซึ่งเป็น null สำหรับ
        -- SKU ที่ไม่เคยมีต้นทุน fixed มาก่อน — ตั้งใจไม่แก้ v_dim_product
        -- รอบนี้ ดูหัวไฟล์) ถ้าไม่ทำอะไรเพิ่ม COGS จะถูกนับเป็น 0 เงียบๆ ผ่าน
        -- `coalesce(v_unit_cost, 0)` ด้านล่าง แต่ profit_status จะยังเป็น
        -- 'actual' เพราะไม่มีอะไรติ๊ก v_weak_order ให้ — ระบบจะบอกว่ากำไรนี้
        -- "เชื่อถือได้" ทั้งที่ต้นทุนเป็น 0 ปลอมๆ (คลาสเดียวกับบั๊กกำไรเงิน
        -- แท่ง ÷1.2 ข้างบน) บังคับติดป้าย estimated + โน้ตชื่อ SKU ไว้แทน —
        -- ไม่กระทบ SKU ที่มีต้นทุนปกติเลย (v_unit_cost ไม่ null สำหรับ SKU
        -- เหล่านั้น เงื่อนไขนี้จึงไม่ทำงาน — เคสห้ามผ่าน #11) และไม่กระทบแถว
        -- ที่ v_product_id เป็น null (unknown_sku มีข้อความ/ธง weak_order ของ
        -- ตัวเองอยู่แล้วด้านบน) หรือแถวหมวดเงินแท่งที่เพิ่งถูกบังคับ unit_cost
        -- ไปแล้วเมื่อกี้ (ค่าเป็น 0 ไม่ใช่ null จึงไม่เข้าเงื่อนไขนี้ — ไม่แตะ
        -- พฤติกรรมเดิมของบั๊ก ÷1.2 ที่ยังรอมติ D3 แยกต่างหาก)
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
$function$;

revoke execute on function analytics.transform_pending_order_lines(uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.transform_pending_order_lines(uuid, uuid) to service_role;

notify pgrst, 'reload schema';

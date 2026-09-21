-- 0144_item_set_new_design.sql
--
-- ทำไม: 0141 เพิ่ม analytics.production_order_item.is_new_design (boolean not
-- null default false) เพื่อให้ผลิตครั้งแรกคิดค่าออกแบบ (nre_cost/qty บวกเข้า
-- ต้นทุนต่อชิ้นของรอบนั้น) แต่หัวไฟล์ 0141 เขียนไว้ตรงๆ ว่า "ตั้งใจไม่ทำ" RPC
-- toggle รอบนั้น (เหตุผลเดิม: ลด surface ที่ไม่มี UI มาทดสอบ end-to-end จริง) —
-- ผลคือทีมหน้าจอไม่มีทางตั้งค่านี้เป็น true ได้เลยผ่านช่องทางปกติ (มีแต่ทาง
-- แก้ตรง DB ผ่าน service_role ซึ่งไม่ใช่ workflow จริง) ⇒ ทุกใบผลิตถือเป็น
-- "ผลิตซ้ำ" เสมอ ค่าออกแบบไม่เคยถูกคิดจริงสักใบ ทั้งที่เจ้าของสั่งไว้ตั้งแต่
-- 19 ก.ย. 69 ว่าต้องมีช่องติ๊ก (docs/3j-jewelry/oms/design-own-production-
-- costing.md, มติ C1-C5): "ค่าออกแบบมีให้ติ๊กเหมือนกัน แต่ถ้าผลิตซ้ำไม่ต้องคิดเลย"
--
-- งาน: ขยาย analytics.production_order_item_set (0131) เพิ่มพารามิเตอร์ท้ายสุด
-- p_is_new_design boolean default null — null = "ไม่ได้ส่งมา ไม่ต้องแตะค่าเดิม"
-- (แพทเทิร์นเดียวกับ p_initial_qty ของ 0135 H1 — "default null ไม่ใช่ false")
-- ⇒ caller เดิมที่ไม่ส่ง arg นี้ (หน้าจอเดิม, ชุดทดสอบเดิมใน verify-0141.sql/
-- verify-0143.sql ที่เรียกแบบ 4-arg) พฤติกรรมเหมือนเดิมทุกประการ — รายการใหม่
-- ยัง default false ตามคอลัมน์ (0141) เหมือนเดิม
--
-- 🔴 signature เปลี่ยน (+1 arg) ⇒ drop signature เดิมก่อนเสมอ (3j-migration-
-- traps #1) แล้ว re-grant (#2) — ตรวจ signature จริงจาก 0131 บรรทัด 564-624
-- ก่อนเขียนไฟล์นี้แล้ว (ไม่ได้เดา): (uuid, uuid, uuid, int) → service_role
-- เท่านั้น ไม่เคย grant authenticated (ต่างจาก product_make_spec_set — ฟังก์ชัน
-- production_order_* ทั้งชุดเรียกผ่าน server action ด้วย service client เท่านั้น)
--
-- ขอบเขต/หนี้ที่ตัดสินใจเอง (ไม่อยู่ในบรีฟ แต่ต้องบันทึกตรงๆ):
--   1. production_order_item_set เวอร์ชันเดิม (0131) ไม่เคยเขียน
--      analytics.catalog_audit_log เลย (ตรวจโค้ดจริงจาก 0131/0132 แล้ว —
--      ต่างจาก production_order_done ที่เขียน audit ทุกครั้งตอนผลิตเสร็จจริง
--      และ product_make_spec_set/_clear/product_upsert ที่เขียน audit ทุกครั้ง
--      ที่แก้ SKU) ⇒ รอบนี้ "ไม่เพิ่ม" audit ตามที่บรีฟสั่งไว้ตรงๆ (นอกขอบเขต)
--      🔴 หนี้ที่เหลือ: การติ๊ก/ถอดติ๊ก is_new_design เปลี่ยนต้นทุนได้หลักร้อย
--      ถึงพันบาทต่อใบ (nre_cost/qty เต็มจำนวน) แต่ไม่มี audit trail แยกว่า
--      ใครติ๊กเมื่อไหร่ที่ระดับ item — ตอน production_order_done จริงจะมี
--      catalog_audit_log บันทึก before/after ของ product (cost_type/unit_cost)
--      อยู่แล้ว แต่ "ใครสั่งติ๊กตอนเพิ่มรายการ" ไม่ถูกบันทึกแยก แนะนำให้เพิ่ม
--      พร้อมกับ UI จริง (จะได้ actor ที่กดจริงจาก session ไม่ใช่แค่ service_role)
--   2. ไม่แตะ trg_production_order_item_deny_mutation (0131 §5b) — ตรวจนิยาม
--      จริงแล้ว (ไม่ได้เดา): `before update or delete on ... for each row`
--      ไม่มี `of column_name` กำกับ ⇒ ครอบ UPDATE ของ "ทุกคอลัมน์" ของแถวรวมถึง
--      is_new_design อยู่แล้วโดยอัตโนมัติ (พิสูจน์ด้วยเทสต์แทนการแก้โค้ดที่ไม่
--      จำเป็น — ดู T-DENY-* ใน scripts/verify-0144.sql) นอกจากนี้ตัวฟังก์ชันเอง
--      ก็เช็ค v_order.status <> 'open' และ raise ก่อนแตะแถวใดๆ อยู่แล้วเหมือน
--      โค้ดเดิม 100% (defense สองชั้นเหมือน pattern เดิมของทั้งไฟล์นี้)
--   3. ไม่แตะ trg_production_order_item_derive_shop — ผูกกับ
--      `update of production_order_id, product_id` เท่านั้น ไม่ครอบ
--      is_new_design (ตั้งใจตั้งแต่ 0131: "qty_planned/qty_done-only update
--      ไม่ต้อง re-validate shop/live-SKU ซ้ำ" — is_new_design เป็นคุณสมบัติ
--      กลุ่มเดียวกับ qty_planned ไม่ใช่กลุ่มที่ต้อง re-validate shop/SKU)
--
-- 🔴 traps ที่ต้องระวัง (skill 3j-migration-traps):
--   #1  drop signature เดิมก่อน create or replace (ทำแล้วด้านล่าง)
--   #2  re-grant ทุกครั้งที่ replace (ทำแล้วด้านล่าง)
--   #11 ทดสอบผ่าน do-block + raise บังคับ rollback เสมอ — scripts/verify-0144.sql
--       (ไม่แตะข้อมูลจริงเลย — shop/SKU/ใบผลิตสังเคราะห์ทั้งหมด prefix ZZ144)
--   #14 insert...on conflict do update — ค่าที่จะคง (null=ไม่แตะ) ต้องอ่านจาก
--       แถวเป้าหมาย (alias `poi`) ไม่ใช่จาก `excluded` (excluded คือแถวที่เสนอ
--       ใหม่ ซึ่งถ้าอ่านจากตรงนั้นตอน null จะได้ false เสมอ ไม่ใช่ค่าเดิม) —
--       ไม่มี CHECK constraint ผูกกับ is_new_design เลยรอบนี้ (ตรวจ pg_constraint
--       ของ analytics.production_order_item แล้ว) จึงไม่ติดกับดักคอลัมน์หาย
--       จาก CHECK แบบ 0142 แต่ยังคงรูปแบบปลอดภัย (อ่านจาก poi.*) ไว้เผื่ออนาคต
--   #15 ใช้ tag เฉพาะในทุก dollar-quote ของ verify script ห้ามมีลำดับ
--       สัญลักษณ์ดอลลาร์ซ้อนกันสองตัวโผล่ในคอมเมนต์ภายในบล็อก
--   #16 ตัวแปรทดสอบห้ามใช้ซ้ำข้ามชนิด — unit_cost เป็น numeric(12,2) ต้องมี
--       ตัวแปร numeric ของตัวเอง แยกจาก qty_planned (int) และ is_new_design
--       (boolean) ไม่ยืมกัน
--   #17 ต้องมีเคส "ยิงฟังก์ชันใหม่ใส่ข้อมูลเก่าทุกโหมด/ทุกสถานะที่มีอยู่จริง"
--       ไม่ใช่แค่ fixture ใหม่ — verify-0144.sql ยิงใส่รายการทั้ง 3 โหมด
--       (fixed/spot/spec) บนใบที่ done แล้ว และใบที่ cancelled แล้ว (6 เคส)
--       ไม่ใช่แค่ใบ open ที่สร้างมาทดสอบของใหม่โดยเฉพาะ
--
-- อ้างอิง: 0131_production_order.sql (นิยามเดิมของ production_order_item_set,
-- บรรทัด 557-624 + trigger §5b/§5c), 0135_stock_sync_sales_hardening.sql H1
-- (แพทเทิร์น default null = ไม่แตะค่าเดิม), 0141_product_make_spec.sql
-- (is_new_design column + เหตุผลที่ยังไม่มี RPC รอบนั้น), skill
-- 3j-migration-traps, skill oem-quote-invariants

-- ============================================================================
-- analytics.production_order_item_set — เพิ่มพารามิเตอร์ท้ายสุด p_is_new_design
-- ============================================================================

drop function if exists analytics.production_order_item_set(uuid, uuid, uuid, int);

create or replace function analytics.production_order_item_set(
  p_shop_id             uuid,
  p_production_order_id uuid,
  p_product_id          uuid,
  p_qty_planned         int,
  -- 🔴 default null = "ไม่ได้ส่งมา ไม่ต้องแตะค่าเดิม" (แพทเทิร์นเดียวกับ
  -- p_initial_qty ของ 0135 H1) — caller เดิมที่ไม่ส่ง arg นี้พฤติกรรมเหมือนเดิม
  -- ทุกประการ ทั้งตอนเพิ่มรายการใหม่ (ได้ default false ตามคอลัมน์ของ 0141)
  -- และตอนแก้รายการเดิม (คงค่า is_new_design ที่มีอยู่แล้วไว้ ไม่เปลี่ยน)
  p_is_new_design       boolean default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_order   analytics.production_order%rowtype;
  v_product public.product%rowtype;
  v_item    analytics.production_order_item%rowtype;
begin
  if p_shop_id is null or p_production_order_id is null or p_product_id is null then
    raise exception 'production_order_item_set: p_shop_id, p_production_order_id, p_product_id are required';
  end if;
  -- p_qty_planned เป็น int อยู่แล้ว (NaN/Infinity พังตั้งแต่ cast พารามิเตอร์ —
  -- 3j-migration-traps ข้อ 4 ตัวเลือก "int ปลอดภัยอยู่แล้ว")
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
        -- null = ไม่แตะ ⇒ คงค่าที่แถวเดิมมีอยู่ก่อน UPDATE นี้ (อ้างอิงผ่าน alias
        -- ของตารางเป้าหมาย `poi.is_new_design` — ค่าก่อนสเตทเมนต์นี้ทำงาน — ไม่ใช่
        -- `excluded.is_new_design` ซึ่งเป็นค่าที่แถวที่เสนอ insert จะมี ถ้าอ่าน
        -- จากตรงนั้นตอน null จะได้ false เสมอ ไม่ใช่ค่าเดิมของแถว — trap #14)
        is_new_design  = case when p_is_new_design is null then poi.is_new_design else p_is_new_design end,
        updated_at     = now()
  returning * into v_item;

  return jsonb_build_object(
    'id', v_item.id, 'product_id', v_item.product_id, 'sku', v_product.sku,
    'name', v_product.name, 'qty_planned', v_item.qty_planned,
    'is_new_design', v_item.is_new_design
  );
end;
$$;

revoke execute on function analytics.production_order_item_set(uuid, uuid, uuid, int, boolean) from public, anon, authenticated;
grant execute on function analytics.production_order_item_set(uuid, uuid, uuid, int, boolean) to service_role;

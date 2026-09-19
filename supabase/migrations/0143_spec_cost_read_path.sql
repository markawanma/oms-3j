-- 0143_spec_cost_read_path.sql
--
-- ทำไม: 0141 เปิดโหมดต้นทุน cost_type='spec' แต่ไม่มีฝั่งอ่าน — analytics.
-- v_dim_product.effective_unit_cost ตกไปที่ `else p.unit_cost` ของ CASE เดิม
-- (เช็คแค่ 'spot' vs else) ⇒ SKU spec ทุกตัวคืน null หรือเลข unit_cost เก่าที่
-- ค้างอยู่ ⇒ COGS ที่ transform_pending_order_lines คำนวณกลายเป็น 0. 0142 ปิด
-- ช่องอันตราย (กำไรโชว์ 'actual' ทั้งที่ต้นทุนเป็น 0 ปลอม) ด้วยการบังคับติดป้าย
-- 'estimated' แทน — แต่ต้นทุนยังเป็น 0/null อยู่ดี รอบนี้คือการเปิดให้มันอ่าน
-- ต้นทุนได้จริง
--
-- ✅ มติเจ้าของ 19 ก.ย. 69: "จากต้นทุนของรอบผลิตล่าสุด (ง่ายกว่า) — เอาแบบนี้"
--
-- 🔴 การตัดสินใจเพิ่มของ Tech Lead (พร้อมเหตุผล — ตามที่สั่งให้เขียนไว้ในหัวไฟล์):
--
-- ต้นทุนแคตตาล็อกของ SKU โหมด spec = ต้นทุนต่อชิ้นของรอบผลิตล่าสุดที่ done
-- แล้ว "หักส่วนค่าออกแบบ (NRE) ออก" เหตุผล: รอบที่ติ๊ก "แบบใหม่" มี NRE
-- (CAD/ก้อนยาง/ปริ้น 3D) หารเข้าไปในต้นทุนต่อชิ้น ซึ่งถูกต้องสำหรับ "lot นั้น"
-- (stock_lot.unit_cost ของ lot นั้นยังเก็บเต็มรวม NRE เหมือนเดิม — ไม่แตะ) แต่
-- ถ้าเอาไปเป็นต้นทุนแคตตาล็อก (สิ่งที่ตอบคำถาม "ผลิตเพิ่มอีกชิ้นต้นทุนเท่าไร")
-- มันจะติดค่าออกแบบไปกับทุกชิ้นที่ขายต่อจากนี้จนกว่าจะผลิตรอบใหม่ — ขัดกับที่
-- เจ้าของพูดไว้ตอนออกแบบฟีเจอร์นี้ (0141 หัวไฟล์): "ผลิตซ้ำไม่ต้องคิดเลย"
--
-- ขอบเขตรอบนี้ (SQL อย่างเดียว — view เดียว ไม่แตะ TypeScript/RPC/ตาราง):
--   1. analytics.v_dim_product — เพิ่ม branch 'spec' ให้ unit_cost/
--      effective_unit_cost (สองคอลัมน์นิยามเหมือนกัน ต้องแก้คู่กัน) +
--      margin_pct (คำนวณต้นทุนซ้ำในสูตรเดียวกัน ต้องแก้ด้วยไม่งั้นกำไรของ spec
--      จะคิดจากเลขคนละตัวกับต้นทุนที่แสดง)
--
-- ตั้งใจไม่ทำรอบนี้:
--   - ไม่แตะ analytics.transform_pending_order_lines เลย (0142 HIGH-3 เขียน
--     ตรรกะ estimated/actual ไว้ถูกแล้ว: ตั้ง estimated เมื่อ unit_cost is
--     null — พอ view ตัวนี้คืนค่าจริง SKU ที่ผลิตแล้วจะกลับเป็น actual เอง
--     โดยอัตโนมัติ ไม่ต้องแก้โค้ดที่จุดนั้นเลย)
--   - ไม่แตะ stock_lot.unit_cost / production_order_done / production_cost_calc
--     — ต้นทุนเต็ม (รวม NRE) ของแต่ละ lot ยังคงเดิมเป๊ะ การหัก NRE เกิดขึ้น
--     "ตอนอ่าน" ที่ view เท่านั้น ไม่ใช่ตอนเขียนลง lot
--   - ไม่เพิ่ม index ใหม่ — analytics.production_order_item(product_id) มี
--     index อยู่แล้ว (idx_production_order_item_product, ยืนยันจากไฟล์
--     0131_production_order.sql บรรทัด ~190 โดยตรง ไม่ได้เดา) พอสำหรับ
--     LATERAL join ที่กรองด้วย product_id ด้านล่าง
--
-- 🔴 การตัดสินใจเพิ่มอีกจุด (ไม่ได้อยู่ในบรีฟตรงๆ): กรองแถวที่ใช้เลือก "รอบ
-- ล่าสุด" ด้วย `poi.cost_calc is not null` เพิ่มจากที่บรีฟสั่ง (status='done'
-- + done_at ล่าสุด) เหตุผล: cost_calc ถูกเขียนโดย production_order_done
-- เฉพาะตอนที่ SKU เป็นโหมด 'spec' ตอน done เท่านั้น (null สำหรับ fixed/spot —
-- ดูคอมเมนต์ 0141 บนคอลัมน์นี้) ⇒ ถ้า SKU เคยถูกผลิตตอนยังเป็นโหมด fixed/spot
-- มาก่อน แล้วค่อยถูกพลิกเป็น spec ทีหลัง (ผ่าน product_make_spec_set — ยังไม่
-- เคยเกิดจริงวันนี้ แต่เป็นไปได้ตาม flow ที่มีอยู่) รอบผลิตเก่านั้นจะเป็น
-- "รอบ done ล่าสุด" ของ product_id นี้ทั้งที่ไม่ใช่รอบที่คำนวณแบบสเปคเลย — ถ้า
-- ไม่กรองออก แคตตาล็อกจะโชว์เลขทุนเก่าจากโหมดก่อนหน้าซึ่งไม่ตรงกับความหมาย
-- "ต้นทุนตามสเปคปัจจุบัน" เลย กรองด้วย cost_calc is not null ทำให้เคสนี้ตกไป
-- อยู่ในกลุ่ม "ยังไม่เคยผลิต [ภายใต้สเปคปัจจุบัน]" ⇒ null ⇒ estimated (ปลอดภัย
-- กว่าเลขทุนหลอกจากโหมดเก่า) — ไม่กระทบ flow ปกติ (SKU ที่เป็น spec มาตั้งแต่
-- ต้นจะมี cost_calc ไม่ null อยู่แล้วทุกรอบที่ done ภายใต้โหมด spec)
--
-- ⚠️ ข้อจำกัดที่ยังไม่ได้แก้ (ตามที่เจ้าของ/Tech Lead รับทราบแล้วว่าอาจเป็น
-- ปัญหา — บันทึกไว้ตรงๆ ไม่ปิดเงียบ): รอบผลิตล่าสุดที่ผลิตจำนวนน้อยมาก (เช่น
-- ทดสอบ 2 ชิ้น) จะทำให้ค่าคงที่ต่อรอบ (ค่าแฟลสก์/ถังชุบ) เฉลี่ยลงต่อชิ้นสูง
-- ผิดปกติ แล้วเลขนั้นจะกลายเป็นต้นทุนแคตตาล็อกค้างอยู่จนกว่าจะมีรอบผลิตใหม่ —
-- เป็นผลข้างเคียงที่มากับ "ง่ายกว่า" ตามที่เจ้าของเลือกเอง (มติ 19 ก.ย.) ไม่ใช่
-- บั๊ก แต่เป็น technical debt ที่ควรพิจารณาแก้ต่อ (เช่น ถ่วงน้ำหนักหลายรอบ
-- ล่าสุด หรือเตือนบนจอเมื่อรอบล่าสุด qty ต่ำผิดปกติ) — ไม่ได้อยู่ในขอบเขตของ
-- บรีฟรอบนี้ จึงไม่แก้ที่นี่
--
-- 🔴 traps ที่ต้องระวัง (skill 3j-migration-traps):
--   #3 create or replace view — คอลัมน์เดิมต้องเป็น prefix เดิมเป๊ะ · select
--      list 20 คอลัมน์แรกลอกมาจาก supabase/migrations/0138_stock_lot_tables.sql
--      คำต่อคำ (ยืนยันแล้วว่าเป็นฉบับล่าสุดที่ define view นี้ — grep ทั้งรีโป
--      ไม่เจอ create/create-or-replace ของ view นี้หลัง 0138 เลย) รอบนี้ไม่ได้
--      เพิ่ม/ลด/ย้ายคอลัมน์แม้ตัวเดียว — แก้แค่นิพจน์ *ภายใน* คอลัมน์ unit_cost/
--      effective_unit_cost/margin_pct ที่มีอยู่แล้ว จึงไม่มีความเสี่ยง 42P16 เลย
--      ในทางทฤษฎี (แต่ยัง diff ordinal_position/column_name/data_type ใน
--      scripts/verify-0143.sql เพื่อพิสูจน์ ไม่เชื่อเปล่าๆ)
--   #2 CREATE OR REPLACE VIEW คงโครง OID เดิม ⇒ grant ที่มีอยู่แล้ว (จาก
--      0123/0124: anon/authenticated ถูก revoke ทั้ง schema analytics ไปแล้ว,
--      service_role เข้าถึงได้เพราะ BYPASSRLS) ไม่หายไปไหน ไม่ต้อง grant ใหม่
--      (ตรวจซ้ำใน verify-0143.sql อยู่ดี ไม่เชื่อเปล่าๆ)
--   ห้ามใช้ subquery แบบ non-lateral ที่ aggregate ทั้งตาราง (คำเตือนเฉพาะของ
--      บรีฟนี้ — transform_pending_order_lines เรียก v_dim_product ในลูปสูงสุด
--      ~2,000 ครั้งต่อการนำเข้า 1 ไฟล์) ⇒ ใช้ LEFT JOIN LATERAL ที่กรองด้วย
--      product_id + ORDER BY + LIMIT 1 (correlated, ใช้ index ต่อแถว) แทนการ
--      GROUP BY ทั้งตารางแบบที่ 0138 ทำกับ stock_lot (ซึ่งเป็นรูปแบบที่บรีฟ
--      บอกให้เลี่ยงสำหรับ join ตัวใหม่นี้โดยเฉพาะ — ของเดิมใน 0138 ไม่แตะ)
--
-- อ้างอิง: supabase/migrations/0138_stock_lot_tables.sql (นิยามล่าสุดของ
-- v_dim_product — ลอกมาเป็นฐาน), 0141_product_make_spec.sql (cost_calc/
-- nre_per_piece snapshot shape), 0142_make_spec_hardening.sql (transform
-- estimated/actual logic ที่ไม่ต้องแตะ, ยืนยัน 0 SKU เป็น spec วันนี้),
-- 0131_production_order.sql (idx_production_order_item_product, deny-mutation
-- triggers), skill 3j-migration-traps, skill oem-quote-invariants

-- ============================================================================
-- analytics.v_dim_product — เพิ่ม branch 'spec' ให้ unit_cost/
-- effective_unit_cost + margin_pct. select list 20 คอลัมน์เหมือนเดิมทุก
-- ประการ (ชื่อ/ลำดับ/ชนิด) — ต่างจาก 0138 แค่ตรง 3 จุดที่ทำเครื่องหมาย
-- "0143" ไว้เท่านั้น
-- ============================================================================

create or replace view analytics.v_dim_product
  with (security_invoker = true) as
select
  p.id as product_id,
  p.shop_id,
  p.sku,
  p.name,
  (case p.cost_type
    when 'spot' then round(coalesce(p.silver_weight_g, 0) * coalesce(s.silver_spot_thb_per_gram, 0)
                            * coalesce(p.silver_purity, 0.925) + coalesce(p.labor_cost, 0), 2)
    -- 0143: โหมด "คำนวณจากสเปค" — ต้นทุนของรอบผลิตล่าสุดที่ done แล้ว หัก NRE
    -- ออก (spec_lot.unit_cost_less_nre จาก LATERAL join ด้านล่าง) null เมื่อ
    -- ยังไม่เคยมีรอบผลิตที่ done ภายใต้โหมดนี้เลย (ไม่ fallback ไปที่ป.unit_cost
    -- ที่อาจเป็นเลขเก่าค้างจากโหมดก่อนหน้า — เคสห้ามผ่าน #3)
    when 'spec' then spec_lot.unit_cost_less_nre
    else p.unit_cost
  end)::numeric(12, 2) as unit_cost,
  p.is_active,
  p.category,
  p.created_at,
  p.updated_at,
  p.cost_type,
  p.silver_weight_g,
  coalesce(p.silver_purity, 0.925) as silver_purity,
  p.labor_cost,
  p.list_price,
  p.unit_cost as manual_unit_cost,
  (case p.cost_type
    when 'spot' then round(coalesce(p.silver_weight_g, 0) * coalesce(s.silver_spot_thb_per_gram, 0)
                            * coalesce(p.silver_purity, 0.925) + coalesce(p.labor_cost, 0), 2)
    -- 0143: นิพจน์เดียวกับ unit_cost ข้างบนเป๊ะ (สองคอลัมน์นี้นิยามเหมือนกัน
    -- มาตั้งแต่ 0028 — ต้องแก้คู่กันเสมอ)
    when 'spec' then spec_lot.unit_cost_less_nre
    else p.unit_cost
  end)::numeric(12, 2) as effective_unit_cost,
  case
    when p.list_price is not null and p.list_price > 0 then
      round((p.list_price - (case p.cost_type
        when 'spot' then round(coalesce(p.silver_weight_g, 0) * coalesce(s.silver_spot_thb_per_gram, 0)
                                * coalesce(p.silver_purity, 0.925) + coalesce(p.labor_cost, 0), 2)
        -- 0143: margin_pct คำนวณต้นทุนซ้ำในสูตรของตัวเอง (ไม่ได้อ้าง
        -- unit_cost คอลัมน์ข้างบน) ต้องเติม branch 'spec' ที่นี่ด้วย ไม่งั้น
        -- margin ของ SKU spec จะคิดจาก else p.unit_cost (เลขคนละตัวกับที่
        -- แสดงในคอลัมน์ unit_cost/effective_unit_cost — เคสห้ามผ่าน #2)
        when 'spec' then spec_lot.unit_cost_less_nre
        else p.unit_cost end)) / p.list_price, 4)
    else null
  end as margin_pct,
  coalesce(lot.qty_remaining_total, 0) as lot_qty_on_hand,
  lot.cost_avg_remaining as lot_cost_avg,
  coalesce(lot.lot_count, 0) as lot_count
from public.product p
left join analytics.shop_setting s on s.shop_id = p.shop_id
left join (
  select
    product_id,
    sum(qty_remaining) as qty_remaining_total,
    round(sum(unit_cost * qty_remaining) / sum(qty_remaining), 2) as cost_avg_remaining,
    count(*) as lot_count
  from analytics.stock_lot
  where qty_remaining > 0
  group by product_id
) lot on lot.product_id = p.id
-- 0143: LATERAL แทน aggregate subquery ทั้งตาราง (คำเตือนเฉพาะของบรีฟนี้ —
-- ห้ามซ้ำรอยแบบ `lot` ข้างบนสำหรับ join ตัวนี้) `where poi.product_id = p.id`
-- ใช้ idx_production_order_item_product (0131) ทำให้แต่ละแถวของ p ที่ถูก
-- query (v_dim_product แทบทุกจุดในระบบ query ผ่าน WHERE sku=.../shop_id=...
-- ซึ่ง planner ผลักลงไปกรอง p ก่อนแล้ว) ทำ nested-loop ต่อแถวที่ถูกใช้จริง
-- ไม่ใช่ scan ทั้งตาราง production_order_item ทุกครั้งที่เรียก view
left join lateral (
  select poi.unit_cost - coalesce((poi.cost_calc ->> 'nre_per_piece')::numeric, 0)
    as unit_cost_less_nre
  from analytics.production_order_item poi
  join analytics.production_order po on po.id = poi.production_order_id
  where poi.product_id = p.id
    and po.status = 'done'
    -- 0143 (จุดที่ตัดสินใจเอง — ดูหัวไฟล์): เฉพาะรอบที่ถูกคำนวณแบบสเปคจริง
    -- (cost_calc ไม่ null ได้ก็ต่อเมื่อ SKU เป็น cost_type='spec' ตอน done
    -- เท่านั้น — 0141) กัน "รอบผลิตเก่าจากโหมด fixed/spot ก่อนพลิกเป็น spec"
    -- หลุดมาเป็นต้นทุนแคตตาล็อกของสเปคปัจจุบัน
    and jsonb_typeof(poi.cost_calc) = 'object'   -- 0143 fix: cost_calc ของรอบ
    -- โหมด fixed/spot เป็น JSON null (jsonb_typeof='null') ไม่ใช่ SQL NULL
    -- ⇒ "is not null" ตาบอด ปล่อยรอบโหมดเก่าหลุดมาเป็นต้นทุนสเปค (เจอจากรอบซ้อม T7b)
  order by po.done_at desc nulls last, poi.updated_at desc, poi.id desc
  limit 1
) spec_lot on true;

-- CREATE OR REPLACE VIEW คงโครง OID เดิม ⇒ grant ที่มีอยู่แล้ว (0123/0124 —
-- anon/authenticated ถูก revoke ทั้ง schema analytics ไปแล้ว, service_role
-- เข้าถึงได้เพราะ BYPASSRLS) ไม่หายไปไหน ไม่ต้อง grant ใหม่ (ยืนยันซ้ำใน
-- scripts/verify-0143.sql)

notify pgrst, 'reload schema';

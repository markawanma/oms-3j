-- 0135_stock_sync_sales_hardening.sql
-- ปิด finding จาก security review บน P1.5 (0133) ก่อนต่อยอด lot costing (0136 —
-- docs/3j-jewelry/oms/design-inventory-lot-costing.md บอกไว้ตรงว่า "0135 ต้อง
-- จบก่อน เพราะ 0136 replace RPC ตัวเดียวกัน")
--
-- ⚠️ SQL อย่างเดียว — ไม่แตะ TypeScript (ยังไม่มี TS เรียก RPC ทั้ง 2 ตัวจาก 0133
--    ⇒ ความเสี่ยงเดิมยังไม่กระทบใครจริง แต่ปิดไว้ก่อนต่อ wiring)
-- ⚠️ 💰 แตะ stock ledger — security ต้องผ่านก่อน merge (กติกา QA)
-- ⚠️ ห้าม apply เอง — Tech Lead dry-run (scripts/verify-0135.sql) แล้ว apply
--    ผ่าน MCP เท่านั้น (skill supabase-migrate)
--
-- ไม่เปลี่ยน signature ของฟังก์ชันไหนเลย (product_track_stock_set ยังเป็น
-- (uuid,uuid,boolean,int) · stock_sync_sales ยังเป็น (uuid,text[]) ·
-- transform_pending_order_lines ยังเป็น (uuid,uuid)) ⇒ create or replace ตรงๆ
-- ปลอดภัย ไม่มี overload ค้าง (3j-migration-traps #1) — grant ยังต้อง
-- revoke/grant ใหม่ทุกตัวเพราะ create or replace ทำ grant หาย (#2)
--
-- ============================================================================
-- H1 — p_initial_qty เปลี่ยนความหมายจาก "บวกเพิ่ม" เป็น "ตั้งเป็น" 🔴
-- ============================================================================
-- ของเดิม /products/new เขียน central_stock.qty_on_hand = initialStock ตรงๆ
-- (lib/actions/products.ts) และ /stock's adjustStock(productId, newOnHand)
-- (lib/actions/stock.ts) ก็ใช้ความหมาย "ตั้งเป็น" ทั้งคู่ — product_track_stock_
-- set ของ 0133 เป็นตัวเดียวที่ทำ "บวกเพิ่ม" (เรียก adjust_stock ด้วย +p_initial_qty
-- ตรงๆ) ซึ่งขัดกับทั้งระบบและเป็น oversell risk ตรงๆ: SKU ที่มีของอยู่แล้ว 15 ชิ้น
-- (เช่น มาจาก production_order_done) พอเปิดนับแล้วกรอก 15 (ยอดที่นับได้จริงตอนนี้)
-- จะกลายเป็น 30 เงียบๆ
--
-- แก้: อ่าน qty_on_hand ปัจจุบันแบบ `for update` (ล็อกกันแข่งกับ adjust_stock
-- ตัวอื่นที่อาจวิ่งพร้อมกัน — stock_sync_sales/production_order_done/ui adjust)
-- แล้ว v_delta := p_initial_qty − qty_on_hand ปัจจุบัน · เรียก adjust_stock
-- เฉพาะเมื่อ v_delta ≠ 0 (adjust_stock เองก็ปฏิเสธ delta=0 อยู่แล้ว 0007) · idem
-- key เปลี่ยนจาก 'init:<product>:<since>' เป็น 'init:<product>:<since>:<target>'
-- (มี "ยอดเป้าหมาย" อยู่ในคีย์) — ไม่งั้นแก้ยอดแล้วเรียกใหม่ (กรอกผิดแล้วกรอกใหม่,
-- หรือปิด→เปิดใหม่ด้วยยอดต่างจากเดิม) จะชนคีย์เดิมที่ adjust_stock เคยบันทึกไว้
-- ด้วย delta คนละค่า แล้วได้ 23505 อ่านไม่รู้เรื่อง
--
-- ผลพ่วง [D] (แทนที่ decision [A] เดิมบางส่วน — coalesce ของ track_stock_since
-- ยังจริงอยู่ ไม่เปลี่ยน แต่ด่าน 23505-กันเปิดซ้ำที่ผูกไว้กับด่านนั้นต้องเอาออก):
-- ด่านเดิม "if v_product.track_stock_since is not null and v_qty > 0 then raise"
-- (ที่ Tech Lead ใส่เองตอนตรวจ 0133) มีไว้กัน idem key ชนตอนเปิดซ้ำใน "บวกเพิ่ม"
-- semantics เก่า — พอเปลี่ยนเป็น "ตั้งเป็น" ด่านนั้นกลายเป็นของผิดที่ขวางงานจริง
-- (ปิดนับ → เปิดใหม่พร้อมยอดที่นับได้ = สิ่งที่ถูกต้องต้องทำได้) ⇒ เอาออกทั้งด่าน
-- เก็บไว้แค่ "ห้ามเลื่อน track_stock_since ถ้าเคยเปิดมาก่อน" ซึ่งเป็นกติกาคนละเรื่อง
--
-- ยังไม่ทำในรอบนี้ (ตัดสินใจแล้ว — ตรงกับ H2 ในบรีฟ + L3 ใน design-inventory-
-- lot-costing.md): flow "นับใหม่" ที่รู้จัก lot จะมาใน 0136/L1 — 🔴 ห้ามต่อ UI/
-- wiring ของ product_track_stock_set จนกว่า 0136 จะมี flow นั้น ต่อตอนนี้จะชนกับ
-- delta ที่ค้างใน last_error ของ lot แล้วตัดซ้ำ (คำเตือนเดียวกับที่ design doc
-- บอกไว้สำหรับ L3)
--
-- ============================================================================
-- M1 — ด่าน live* หายไปใน stock_sync_sales (defense-in-depth) + ปิดไม่ได้ถ้าเปิดพลาด
-- ============================================================================
-- (ก) stock_sync_sales เชื่อ p.track_stock อย่างเดียว — ถ้า live SKU ตัวไหนมี
-- track_stock=true จากทางอื่นที่ไม่ใช่ RPC นี้ (SQL ตรงบน prod / งานทดสอบ / RPC
-- ในอนาคตที่ลืมด่าน) จะโดนตัดสต็อกทุกคืน ขัดมติเจ้าของ (live* ไม่นับสต็อกเด็ดขาด)
-- ⇒ เพิ่ม `and p.sku !~* '^live'` ทั้งสองฝั่งของ full outer join (เหมือน
-- p.track_stock ที่กรองทั้งสองฝั่งอยู่แล้วตาม decision [B] ของ 0133) — ใส่ฝั่งเดียว
-- จะทำให้ live SKU กลายเป็น "target หาย" แล้วคืนสต็อกทั้งก้อนผิดๆ (บั๊กเดียวกับที่
-- [B] กันไว้)
-- (ข) product_track_stock_set บล็อกทั้งเปิดและปิดสำหรับ live SKU มาตั้งแต่ 0133 —
-- ถ้าเปิดพลาดมาได้จากทางอื่น (ตาม (ก)) จะปิดผ่าน RPC นี้ไม่ได้เลย ต้องไป SQL ตรง
-- บน prod ซึ่งทีมนี้ห้ามตัวเอง ⇒ เปลี่ยนด่านเป็น `if p_enabled and sku ~* '^live'`
-- — ปิดต้องผ่านได้เสมอไม่ว่า sku จะเป็นอะไร มีแต่ "เปิด" เท่านั้นที่ต้องกันไว้
--
-- ============================================================================
-- M2/M3 — exception handling ใน stock_sync_sales กลืนของที่ไม่ควรกลืน +
-- last_error หลุด raw Postgres message
-- ============================================================================
-- เดิม `exception when others` จับทุก error ⇒ 42501 (permission denied) /
-- 40P01 (deadlock) / 57014 (timeout) จะถูกบันทึกเป็น last_error เหมือน "ของไม่พอ"
-- แล้ว return {"deducted":0,...} หน้าตาเหมือนสำเร็จ ⇒ สต็อกไม่ขยับทั้งระบบโดยไม่มี
-- ใครรู้ ⇒ จับเฉพาะ sqlstate 'P0001' (ของไม่พอ — adjust_stock 0007) · '23505'
-- (idem key ชน) · '23514' (check constraint) — ที่เหลือ `raise;` (bare re-raise)
-- ให้ทั้ง call ล้ม ("หยุดแล้วให้คนมาดู" ถูกกว่า "เดินต่อโดยไม่ตัดสต็อก")
--
-- last_error เปลี่ยนจากข้อความ Postgres ดิบ (หลุดชื่อฟังก์ชันภายใน + UUID) เป็น
-- ข้อความสำหรับคนอ่าน + คอลัมน์ใหม่ last_error_code (sqlstate) ให้ฝั่งเรียกแยกเคส
-- ได้โดยไม่ต้อง parse ข้อความ · ข้อความดิบไปที่ `raise warning` (เข้า Postgres
-- log แทน) · failed[] ที่ return ก็ใช้ข้อความสำหรับคนเหมือนกัน + เพิ่ม sku (ทั้ง
-- tgt/ap subquery เพิ่ม p.sku ในผลลัพธ์ — UI รอบหน้าไม่ต้อง join เอง)
--
-- เรื่องเล็กที่พ่วง: raise exception ที่ไม่ได้ใส่ errcode ("p_shop_id is
-- required" ทั้งใน stock_sync_sales และ product_track_stock_set) ⇒ ใส่ 22023
-- (ของเดิม default เป็น P0001 จาก plpgsql เอง — ผิดกติกาที่ตั้งไว้ว่าเฉพาะ 22023
-- เท่านั้นที่ตั้งใจให้ผู้ใช้เห็น)
--
-- ============================================================================
-- M5 — ใบที่ถูกลบต้องคืนสต็อกเสมอ แม้ผู้เรียกไม่ได้ส่งเลขใบนั้นมา
-- ============================================================================
-- ฝั่ง applied กรอง sa.source_order_no = any(p_source_order_nos) เดิม ⇒ ถ้า
-- caller ส่งรายการจำกัดแล้วลืมใส่เลขใบที่ลบ สต็อกจะไม่ถูกคืน (ฝากความถูกต้องไว้กับ
-- วินัยคนเขียน TS) ⇒ เพิ่ม `or not exists (select 1 from fact_order fo2 where
-- fo2.shop_id=sa.shop_id and fo2.source_order_no=sa.source_order_no)` — ถ้า
-- ออเดอร์นั้นไม่มีอยู่จริงแล้ว (ลบไปแล้ว) ให้ reconcile มันเสมอไม่ว่า caller จะขอ
-- เลขใบนั้นมาหรือไม่ ใช้ unique index uq_fact_order_shop_source_order_no (0010)
-- anti-join ถูกมาก
--
-- ============================================================================
-- F6 — loop ไม่มี order by (เตรียมทางให้ FIFO ของ 0136/L1)
-- ============================================================================
-- เดิม `for v_rec in select ...` ไม่มี order by ⇒ ลำดับกินสต็อกในแบตช์เดียวเป็น
-- แบบสุ่ม งาน lot (0136) ต้องการลำดับที่คาดเดาได้ ⇒ เพิ่ม order_date (min ของ
-- fo.order_date ต่อ (order,product) — ดึงมาได้แทบไม่มีต้นทุนเพิ่มเพราะ query เดิม
-- already join analytics.fact_order อยู่แล้ว), source_order_no, product_id —
-- แถวที่ order_date เป็น null (มีแต่ applied ไม่มี target แล้ว เช่นใบถูกลบ) ให้
-- nulls last (ไม่กระทบผลลัพธ์ ตัดสต็อกตามลำดับ business date ก่อน ที่เหลือ
-- deterministic ด้วย source_order_no/product_id)
--
-- ============================================================================
-- คอมเมนต์ที่ไม่จริง (แก้ให้ตรง) + advisory lock ที่ขาดไปจริง
-- ============================================================================
-- คอมเมนต์ใน 0133 เขียนว่า advisory lock "ไม่มีทางวิ่งซ้อนกับ import/ลบ/กู้คืน"
-- — ไม่จริงทั้งหมด: analytics.transform_pending_order_lines (0115 — ตัวที่เขียน
-- fact_order_item.qty จริง เรียกจาก lib/actions/import-line-items.ts) ไม่ได้จับ
-- lock ตัวนี้เลยตั้งแต่ 0041 ⇒ เพิ่ม pg_advisory_xact_lock(hashtext(
-- 'analytics.fact_order:'||p_shop_id::text)) ที่หัวฟังก์ชัน (key เดียวกับ 0115/
-- 0133 ⇒ เข้าคิว ไม่ deadlock — session เดียวกันถือ key ซ้ำได้โดยไม่ติด, สอง
-- session แข่งกันจะรอเฉยๆ ไม่ล็อกตาย) ไม่เปลี่ยน signature/พฤติกรรมอื่นเลย
-- body ที่เหลือคัดลอกจากนิยามล่าสุดใน repo เป๊ะ (0115 §3 — บันทึกไว้ว่าลอกจาก
-- pg_get_functiondef สดของ DB ตอนนั้น เป็นเวอร์ชันล่าสุดที่ไม่มี migration ไหน
-- แก้ทับอีกหลังจากนั้น) ไม่ได้ลอกจาก 0109 (เก่ากว่า ไม่มี tombstone check)
--
-- ============================================================================
-- ทดสอบ: scripts/verify-0135.sql (do-block + raise บังคับ rollback,
-- 3j-migration-traps #11) — ครอบเคสใหม่ทั้งหมดข้างบน + เคสห้ามพังจาก verify-0133
-- (ยกเว้น T12/T14 ที่ทดสอบพฤติกรรมเดิมที่ H1/[D] เปลี่ยนไปตั้งใจ — แทนที่ด้วยเคส
-- ใหม่ที่สะท้อน semantics "ตั้งเป็น")
-- ============================================================================

-- ============================================================================
-- 0. analytics.stock_sale_applied — เพิ่มคอลัมน์ last_error_code (M3)
-- ============================================================================

alter table analytics.stock_sale_applied
  add column if not exists last_error_code text;

comment on column analytics.stock_sale_applied.last_error_code is
  '0135 (M3): sqlstate ของ last_error ล่าสุด (เฉพาะ P0001/23505/23514 — ตัวอื่น '
  'ทำให้ทั้ง call ล้มตั้งแต่ต้น ไม่มีทางมาถึงคอลัมน์นี้) null เมื่อ delta กลับเป็น 0 '
  'พร้อมกับ last_error เอง — ให้ฝั่งเรียกแยกเคสได้โดยไม่ต้อง parse ข้อความ';

-- ============================================================================
-- 1. analytics.product_track_stock_set — H1 (ตั้งเป็น ไม่ใช่บวกเพิ่ม) + M1(ข)
--    (ปิดได้เสมอ) + M3 (errcode ของ required-param raise)
-- ============================================================================

create or replace function analytics.product_track_stock_set(
  p_shop_id     uuid,
  p_product_id  uuid,
  p_enabled     boolean,
  p_initial_qty int default 0
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_product     public.product%rowtype;
  v_today       date := (now() at time zone 'Asia/Bangkok')::date;
  v_since       date;
  v_qty         int;
  v_on_hand     int;
  v_reserved    int;
  v_delta       int;
  v_idem_key    text;
  v_was_enabled boolean;
  v_sqlstate    text;
begin
  if p_shop_id is null or p_product_id is null then
    raise exception 'product_track_stock_set: p_shop_id and p_product_id are required' using errcode = '22023';
  end if;
  if p_enabled is null then
    raise exception 'product_track_stock_set: p_enabled is required' using errcode = '22023';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_product from public.product
    where id = p_product_id and shop_id = p_shop_id
    for update;
  if not found then
    raise exception 'product_track_stock_set: ไม่พบ SKU % ในร้านนี้', p_product_id using errcode = '22023';
  end if;
  v_was_enabled := v_product.track_stock;

  -- live-SKU ไม่นับสต็อกเด็ดขาด (มติเจ้าของ §8 ข้อ 1) — 0135 M1(ข): บล็อกเฉพาะ
  -- ตอน "เปิด" เท่านั้น (เดิมบล็อกทั้งเปิด/ปิด — ถ้า track_stock=true หลุดมาได้
  -- จากทางอื่นที่ไม่ใช่ RPC นี้ การปิดผ่าน RPC นี้ต้องทำได้เสมอ ไม่งั้นต้องไป SQL
  -- ตรงบน prod ซึ่งทีมนี้ห้ามตัวเอง)
  if p_enabled and v_product.sku ~* '^live' then
    raise exception 'product_track_stock_set: SKU % เป็น SKU เฉพาะไลฟ์ (live*) ไม่นับสต็อก (มติเจ้าของ 17 ก.ย. 69)', v_product.sku using errcode = '22023';
  end if;

  if not p_enabled then
    -- ปิด: แค่ปิดธง ห้ามล้าง ledger/stock_sale_applied/track_stock_since —
    -- ประวัติทั้งหมดยังอยู่เผื่อเปิดใหม่ในอนาคต (idempotent ถ้าปิดซ้ำ — update
    -- เดิมซ้ำไม่มีผลข้างเคียง) ทำงานได้แม้ sku เป็น live* ที่หลุดมาแบบผิดปกติ
    update public.product
       set track_stock = false, updated_at = now()
     where id = p_product_id;

    return jsonb_build_object(
      'product_id', p_product_id, 'track_stock', false,
      'track_stock_since', v_product.track_stock_since, 'already_enabled', v_was_enabled
    );
  end if;

  -- เปิด (หรือ "ตั้งยอดใหม่ให้ตรงกับที่นับได้" ถ้าเปิดอยู่แล้ว/เคยเปิดมาก่อน) —
  -- 0135 H1: p_initial_qty คือ "ตั้งเป็น" เสมอ ไม่ใช่ "บวกเพิ่ม" ให้สอดคล้องกับ
  -- /products/new (insert central_stock ตรง) และ /stock's adjustStock ที่ใช้
  -- ความหมายนี้อยู่แล้วทั้งคู่ — SKU ที่มีของอยู่แล้ว 15 ชิ้น เปิดนับแล้วกรอก 15
  -- (ยอดที่นับได้จริง) ต้องยังเป็น 15 ไม่ใช่ 30
  v_qty := coalesce(p_initial_qty, 0);
  if not (v_qty >= 0 and v_qty <= 100000) then
    raise exception 'product_track_stock_set: p_initial_qty ต้องอยู่ระหว่าง 0-100000 (ได้ %)', p_initial_qty using errcode = '22023';
  end if;

  -- ห้ามเลื่อน track_stock_since ถ้าเคยเปิดมาก่อน (ปิดแล้วเปิดใหม่ก็ไม่เลื่อน) —
  -- คอลัมน์นี้กำหนดขอบเขตว่าออเดอร์วันไหนถูกนับเป็น target ใน stock_sync_sales
  -- (สืบทอดจาก 0133 decision [A] — ยังจริงอยู่แม้ด่าน 23505-กันเปิดซ้ำเดิมถูก
  -- เอาออกไปแล้วก็ตาม คนละเรื่องกัน)
  v_since := coalesce(v_product.track_stock_since, v_today);

  -- ensure central_stock แถวมีอยู่ก่อนเสมอ ก่อน "for update" (SKU จาก generator
  -- ไม่มีแถวนี้มาตั้งแต่ต้น มีแค่ตอน /products/new เท่านั้น)
  insert into public.central_stock (product_id) values (p_product_id)
    on conflict (product_id) do nothing;

  -- 0135 H1: อ่านยอดปัจจุบันแบบ for update ก่อนคำนวณ delta — ล็อกแถวกันแข่งกับ
  -- adjust_stock ตัวอื่น (stock_sync_sales / production_order_done / ui adjust)
  -- ที่อาจวิ่งพร้อมกันในอีก session
  select qty_on_hand, qty_reserved into v_on_hand, v_reserved
    from public.central_stock where product_id = p_product_id for update;

  v_delta := v_qty - coalesce(v_on_hand, 0);

  if v_delta <> 0 then
    -- 0135 H1: idem key ต้องมี "ยอดเป้าหมาย" (v_qty) อยู่ในคีย์ ไม่ใช่แค่
    -- (product, since) เฉยๆ — ไม่งั้นแก้ยอดแล้วเรียกใหม่ (กรอกผิดแล้วกรอกใหม่,
    -- หรือปิด→เปิดใหม่ด้วยยอดต่างจากเดิม) จะชนคีย์เดิมที่ adjust_stock บันทึกไว้
    -- ด้วย delta คนละค่า แล้วโดน 23505
    v_idem_key := 'init:' || p_product_id::text || ':' || v_since::text || ':' || v_qty::text;
    begin
      perform public.adjust_stock(p_shop_id, p_product_id, v_delta, v_idem_key);
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      if v_sqlstate = 'P0001' then
        -- adjust_stock's "would go negative or below reserved balance" (0007)
        -- — แปลงเป็นข้อความที่คนอ่านรู้เรื่อง + errcode 22023 ตามกติกาที่ตั้งไว้
        -- ว่าเฉพาะ 22023 เท่านั้นที่ตั้งใจให้ผู้ใช้เห็น (0135 H1)
        raise exception 'product_track_stock_set: ตั้งยอดสต็อกของ SKU % เป็น % ไม่ได้ (ปัจจุบันมียอดถูกจองไว้ % ชิ้น ตั้งต่ำกว่ายอดจองไม่ได้)', v_product.sku, v_qty, coalesce(v_reserved, 0) using errcode = '22023';
      else
        -- sqlstate อื่น (เช่น 23505 — idem key เดิมชนด้วย delta คนละค่าจริงๆ)
        -- ไม่ใช่เคสที่ตั้งใจแปลงข้อความ ปล่อยขึ้นไปตามเดิม
        raise;
      end if;
    end;
  end if;

  update public.product
     set track_stock = true, track_stock_since = v_since, updated_at = now()
   where id = p_product_id;

  return jsonb_build_object(
    'product_id', p_product_id, 'track_stock', true,
    'track_stock_since', v_since, 'qty_target', v_qty, 'delta_applied', v_delta,
    'already_enabled', v_was_enabled
  );
end;
$$;

revoke execute on function analytics.product_track_stock_set(uuid, uuid, boolean, int) from public, anon, authenticated;
grant  execute on function analytics.product_track_stock_set(uuid, uuid, boolean, int) to service_role;

-- ============================================================================
-- 2. analytics.stock_sync_sales — M1(ก) live guard ทั้งสองฝั่ง + M2 narrow
--    exception + M3 last_error/last_error_code ที่คนอ่านรู้เรื่อง + sku ใน
--    failed[] + M5 anti-join ใบที่ถูกลบ + F6 order by
-- ============================================================================

create or replace function analytics.stock_sync_sales(
  p_shop_id           uuid,
  p_source_order_nos  text[] default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_rec       record;
  v_delta     int;
  v_idem_key  text;
  v_deducted  int := 0;
  v_returned  int := 0;
  v_failed    jsonb := '[]'::jsonb;
  v_err       text;
  v_sqlstate  text;
  v_friendly  text;
begin
  if p_shop_id is null then
    raise exception 'stock_sync_sales: p_shop_id is required' using errcode = '22023';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  -- key เดียวกับ 0114 (transform_pending_orders) / 0115 (import_delete_orders,
  -- import_restore_orders, และตอนนี้ transform_pending_order_lines เองด้วย —
  -- ดู fix ท้ายไฟล์นี้) ⇒ ไม่มีทางวิ่งซ้อนกับ import/ลบ/กู้คืน/transform ของ
  -- shop เดียวกัน
  perform pg_advisory_xact_lock(hashtext('analytics.fact_order:' || p_shop_id::text));

  for v_rec in
    select
      coalesce(tgt.source_order_no, ap.source_order_no) as source_order_no,
      coalesce(tgt.product_id, ap.product_id)           as product_id,
      coalesce(tgt.sku, ap.sku)                          as sku,
      coalesce(tgt.target_qty, 0)                        as target_qty,
      coalesce(ap.qty_applied, 0)                        as qty_applied,
      coalesce(ap.sync_seq, 0)                           as sync_seq,
      ap.last_error                                      as last_error,
      ap.last_error_code                                 as last_error_code,
      tgt.order_date                                      as order_date
    from (
      -- target = ยอดที่ "ควรตัดไปแล้ว" ตอนนี้ ต่อ (ออเดอร์, สินค้า) — คำนวณสด
      -- ทุกครั้ง ไม่เก็บ snapshot inner join กับ product ทำให้ product_id ที่เป็น
      -- null (SKU import ไม่ match) หลุดออกจาก target โดยอัตโนมัติ (ข้ามเงียบ
      -- ตามที่ design ต้องการ ไม่ต้องเขียนเงื่อนไขแยก)
      -- 0135 M1(ก): เพิ่ม p.sku !~* '^live' — กัน defense-in-depth เผื่อ live
      -- SKU ตัวไหนมี track_stock=true หลุดมาจากทางอื่นที่ไม่ใช่
      -- product_track_stock_set (SQL ตรง/RPC อื่นในอนาคตที่ลืมด่าน)
      -- 0135 F6: min(fo.order_date) เตรียมทางให้ order by แบบ FIFO-ready
      select fo.source_order_no, foi.product_id, p.sku,
             sum(foi.qty)::int as target_qty,
             min(fo.order_date) as order_date
      from analytics.fact_order fo
      join analytics.fact_order_item foi on foi.fact_order_id = fo.id
      join public.product p on p.id = foi.product_id and p.shop_id = fo.shop_id
      where fo.shop_id = p_shop_id
        and p.track_stock
        and p.sku !~* '^live'
        and fo.order_date >= p.track_stock_since
        and (p_source_order_nos is null or fo.source_order_no = any (p_source_order_nos))
      group by fo.source_order_no, foi.product_id, p.sku
    ) tgt
    full outer join (
      -- applied = ตัดไปแล้วเท่าไรจากรอบก่อนๆ — join กับ product แล้วกรอง
      -- p.track_stock ด้วย (ไม่ใช่กรองแค่ shop_id/source_order_no) เพื่อไม่ให้
      -- SKU ที่ถูกปิด track_stock ไปแล้วโผล่มาเป็น "target หาย" แล้วโดนคืนสต็อก
      -- ผิดๆ (0133 decision [B]) + 0135 M1(ก): p.sku !~* '^live' เหตุผลเดียวกับ
      -- ฝั่ง tgt — ใส่ฝั่งเดียวจะทำให้ live SKU กลายเป็น "target หาย" คืนสต็อกผิด
      -- + 0135 M5: เพิ่ม "or not exists (fact_order ของออเดอร์นี้)" — ถ้า
      -- caller ส่ง p_source_order_nos แบบจำกัดแล้วลืมใส่เลขใบที่ถูกลบ ให้
      -- reconcile ใบนั้นอยู่ดี (ใช้ uq_fact_order_shop_source_order_no, 0010,
      -- anti-join ถูก) ไม่ฝากความถูกต้องไว้กับวินัยคนเขียน TS ฝั่งเดียว
      select sa.source_order_no, sa.product_id, p.sku, sa.qty_applied, sa.sync_seq,
             sa.last_error, sa.last_error_code
      from analytics.stock_sale_applied sa
      join public.product p on p.id = sa.product_id and p.shop_id = sa.shop_id
      where sa.shop_id = p_shop_id
        and p.track_stock
        and p.sku !~* '^live'
        and (
          p_source_order_nos is null
          or sa.source_order_no = any (p_source_order_nos)
          or not exists (
            select 1 from analytics.fact_order fo2
            where fo2.shop_id = sa.shop_id and fo2.source_order_no = sa.source_order_no
          )
        )
    ) ap
      on ap.source_order_no = tgt.source_order_no and ap.product_id = tgt.product_id
    -- 0135 F6: deterministic order (เดิมไม่มี order by เลย — ลำดับกินสต็อกใน
    -- แบตช์เดียวเป็นแบบสุ่ม) ⇒ order_date (business date จาก fact_order) ก่อน
    -- เตรียมทางให้ FIFO ของ 0136/L1 (ของเก่าออกก่อนต้องอิงวันที่ขาย ไม่ใช่ลำดับ
    -- ที่ query วิ่งเจอ) ตามด้วย source_order_no, product_id ให้ deterministic
    -- เต็มสำหรับแถวที่ order_date เป็น null (มีแต่ applied ไม่มี target แล้ว —
    -- เช่นใบถูกลบ) nulls last: ไม่กระทบผลลัพธ์ (คืนสต็อกได้เหมือนกันไม่ว่าลำดับไหน)
    order by order_date nulls last, source_order_no, product_id
  loop
    v_delta := v_rec.target_qty - v_rec.qty_applied;
    if v_delta = 0 then
      -- idempotent: ไม่มีอะไรเปลี่ยน ไม่แตะ ledger เลย ไม่ต้องมี idem key ด้วยซ้ำ
      -- แต่ถ้ารอบก่อนเคยพลาดไว้ (last_error ค้าง) แล้วรอบนี้ตรงกันแล้ว ต้องล้างข้อความทิ้ง
      -- ไม่งั้นหน้าจอจะโชว์ "สต็อกไม่พอ" ค้างทั้งที่ไม่เหลือปัญหาแล้ว
      if v_rec.last_error is not null or v_rec.last_error_code is not null then
        update analytics.stock_sale_applied
           set last_error = null, last_error_code = null, updated_at = now()
         where shop_id = p_shop_id
           and source_order_no = v_rec.source_order_no
           and product_id = v_rec.product_id;
      end if;
      continue;
    end if;

    -- seq ใหม่ทุกครั้งที่มีการปรับจริง ⇒ idem key ของ adjust_stock ไม่ชนกันเอง
    -- ข้ามรอบ sync (0007's signed-delta guard คุมกันการเรียกซ้ำ key เดิมด้วย
    -- delta ต่างอยู่แล้วเป็นชั้นที่สอง)
    v_idem_key := 'sale:' || v_rec.source_order_no || ':' || v_rec.product_id::text || ':' || (v_rec.sync_seq + 1)::text;

    begin
      -- ensure central_stock แถวมีอยู่ก่อนเสมอ (defense-in-depth — SKU ที่
      -- track_stock=true ควรมีแถวนี้แล้วจาก product_track_stock_set/production_
      -- order_done แต่ insert...on conflict do nothing ไม่มีต้นทุนถ้าซ้ำ)
      insert into public.central_stock (product_id) values (v_rec.product_id)
        on conflict (product_id) do nothing;

      -- v_delta > 0: ขายเพิ่ม/ยังตัดไม่ครบ ⇒ ต้องหักสต็อกเพิ่ม -v_delta (ติดลบ)
      -- v_delta < 0: ออเดอร์หาย/จำนวนลดลง ⇒ ต้องคืนสต็อก -v_delta (เป็นบวก)
      perform public.adjust_stock(p_shop_id, v_rec.product_id, -v_delta, v_idem_key);

      insert into analytics.stock_sale_applied (shop_id, source_order_no, product_id, qty_applied, sync_seq, last_error, last_error_code, updated_at)
      values (p_shop_id, v_rec.source_order_no, v_rec.product_id, v_rec.target_qty, v_rec.sync_seq + 1, null, null, now())
      on conflict (shop_id, source_order_no, product_id)
      do update set qty_applied = excluded.qty_applied, sync_seq = excluded.sync_seq, last_error = null, last_error_code = null, updated_at = now();

      if v_delta > 0 then
        v_deducted := v_deducted + v_delta;
      else
        v_returned := v_returned + (-v_delta);
      end if;
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_err = message_text;

      -- 0135 M2: จับเฉพาะสิ่งที่ "ของไม่พอ"/"ข้อมูลไม่ผ่าน" จริงๆ (P0001 จาก
      -- adjust_stock 0007 · 23505 idem key ชน · 23514 check constraint) ตัวอื่น
      -- (42501 permission denied · 40P01 deadlock · 57014 timeout · ฯลฯ) ต้อง
      -- ทำให้ทั้ง call ล้ม ไม่ใช่ถูกกลืนแล้วรายงานเหมือนสำเร็จ ("หยุดแล้วให้คนมา
      -- ดู" ถูกกว่า "เดินต่อโดยไม่ตัดสต็อกแล้วไม่มีใครรู้")
      if v_sqlstate not in ('P0001', '23505', '23514') then
        raise;
      end if;

      -- 0135 M3: ข้อความดิบ (หลุดชื่อฟังก์ชันภายใน + UUID) ไปที่ Postgres log
      -- แทน ไม่ใช่ last_error ที่ผู้ใช้เห็น
      raise warning 'stock_sync_sales: order=% product=% sqlstate=% %', v_rec.source_order_no, v_rec.product_id, v_sqlstate, v_err;

      v_friendly := case
        when v_sqlstate = 'P0001' and v_delta > 0 then format('ของในระบบไม่พอให้ตัด (ต้องตัด %s ชิ้น)', v_delta)
        when v_sqlstate = 'P0001' then format('ปรับสต็อกไม่สำเร็จ (คืนสต็อก %s ชิ้นไม่ได้)', -v_delta)
        when v_sqlstate = '23505' then 'ปรับสต็อกไม่สำเร็จ (idempotency key ชนกัน) — ติดต่อทีมพัฒนา'
        else 'ปรับสต็อกไม่สำเร็จ (ข้อมูลไม่ผ่านเงื่อนไขตรวจสอบ) — ติดต่อทีมพัฒนา'
      end;

      -- ตัดไม่ได้ (สต็อกไม่พอ) หรือ error ที่รับรู้แล้วอีก 2 แบบ ⇒ เก็บ last_error/
      -- last_error_code ไว้ที่แถวนั้น (qty_applied/sync_seq *ไม่* ขยับ ⇒ รอบ sync
      -- ถัดไปจะได้ delta เดิม + idem key เดิม ⇒ retry ได้เอง) แล้วไปคู่ถัดไป
      -- ไม่ล้มทั้ง batch (pattern เดียวกับ 0041)
      insert into analytics.stock_sale_applied (shop_id, source_order_no, product_id, qty_applied, sync_seq, last_error, last_error_code, updated_at)
      values (p_shop_id, v_rec.source_order_no, v_rec.product_id, v_rec.qty_applied, v_rec.sync_seq, v_friendly, v_sqlstate, now())
      on conflict (shop_id, source_order_no, product_id)
      do update set last_error = excluded.last_error, last_error_code = excluded.last_error_code, updated_at = now();

      v_failed := v_failed || jsonb_build_object(
        'source_order_no', v_rec.source_order_no, 'product_id', v_rec.product_id, 'sku', v_rec.sku,
        'delta', v_delta, 'error', v_friendly
      );
    end;
  end loop;

  return jsonb_build_object('deducted', v_deducted, 'returned', v_returned, 'failed', v_failed);
end;
$$;

revoke execute on function analytics.stock_sync_sales(uuid, text[]) from public, anon, authenticated;
grant  execute on function analytics.stock_sync_sales(uuid, text[]) to service_role;

-- ============================================================================
-- 3. analytics.transform_pending_order_lines — เพิ่ม advisory lock เท่านั้น
--    (ไม่เคยมีมาตั้งแต่ 0041 แม้ 0133's header comment จะอ้างว่า "ไม่มีทางวิ่ง
--    ซ้อนกับ import/ลบ/กู้คืน" ก็ตาม — ไม่จริง เพราะฟังก์ชันนี้ไม่ได้ถือ lock นี้)
--    body ที่เหลือคัดลอกเป๊ะจากนิยามล่าสุดใน repo (0115 §3, tombstone-aware —
--    ยืนยันแล้วว่าไม่มี migration ไหนแก้ทับอีกหลังจากนั้น) ไม่ได้ลอกจาก 0109
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

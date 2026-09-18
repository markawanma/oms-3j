-- 0134_silver_bar_cost_from_kilo_price.sql
-- มติเจ้าของ 18 ก.ย. 69 — ต้นทุนเงินแท่งผิดมาตลอด แก้ที่ฐาน ไม่ใช่แก้ตัวเลขทีละตัว
--
-- ปัญหาที่เจ้าของจับได้: SKU เงินแท่ง 1 บาท บันทึกต้นทุน 1,713 บาท ทั้งที่ต้นทุนจริงไม่ถึง
-- ต้นเหตุ: ต้นทุนเงินแท่งทั้ง 6 ตัวเป็น cost_type='fixed' ที่พิมพ์มือใส่ไว้ ไม่ผูกกับราคาเงิน
-- หลักฐานชัดที่สุดคือ S-1kg. บันทึก 79,380 = kilo_sell_vat (79,394) ณ ตอนนั้นพอดี
-- ⇒ มีคนเอา "ราคาขายให้ลูกค้ารวม VAT" มาใส่ช่องต้นทุน แล้วไม่มีใครอัปเดตอีกเลย
-- (ราคาเงินตกลงมา ~30% ระหว่างปี ตัวเลขจึงค้างสูงขึ้นเรื่อยๆ)
--
-- ============================================================================
-- สูตรราคาขายของชีตเจ้าของ — ถอดจากข้อมูลจริงใน analytics.silver_price_history
-- ============================================================================
--   ราคาขาย = (เนื้อเงิน + ค่าบล็อก) × 1.11 × 1.07
--   ตรวจกับของจริง 18 ก.ย.: แท่ง 1 บาท (1,089 + 100) × 1.11 × 1.07 = 1,412 = sell_1 ✅
--                          แท่ง 10 บาท (10,890 + 300) × 1.11 × 1.07 = 13,290 = sell_10 ✅
--   และ margin_component_1 = 130.8 = (1,089 + 100) × 0.11 พอดี ✅
--   (11% = ค่ากำเหน็จที่เจ้าของบอกว่า "คิดบวกกำไรไปด้วยแล้ว" · 1.07 = VAT)
--
--   ⇒ ต้นทุนจริง = เนื้อเงิน + ค่าบล็อก เท่านั้น
--     11% เป็นกำไรของร้าน และ VAT เป็นภาษี — ทั้งคู่ไม่ใช่ต้นทุน
--     นี่คือเหตุผลที่เจ้าของบอกว่า "ค่าขึ้นรูปแพงไปหน่อย" ตอนเห็นส่วนต่าง 322 บาท
--     ที่ Tech Lead ยกมา — เจ้าของถูก ส่วนต่างนั้นมีกำไร+VAT ปนอยู่ ค่าบล็อกจริงคือ 100
--
-- ============================================================================
-- 1. ราคาเงินต่อกรัม = ราคาขายออก 1 กก. ก่อน VAT ÷ 1000  (คำสั่งเจ้าของตรงตัว)
-- ============================================================================
-- ของเดิมใช้ silver_value_per_baht ÷ 15.244 ซึ่ง "เกือบ" เท่ากัน (71.4379 vs 71.5000)
-- แต่ silver_value_per_baht ถูกปัดเป็นจำนวนเต็มบาทในชีตก่อนถึงเรา ⇒ คลาดสะสม
-- ได้ ~10 บาทต่อแท่ง 10 บาท ส่วน kilo_sell เป็นเลขเต็มความละเอียด
-- เก็บทางเก่าไว้เป็น fallback เผื่อแถว backfill เก่าที่ไม่มี kilo_sell

create or replace function analytics.silver_spot_sync_from_history()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_per_gram numeric;
  v_as_of_date date;
  v_today date;
  v_last_updated timestamptz;
  v_manual_exists boolean;
begin
  -- มติเจ้าของ 18 ก.ย. 69: ต่อกรัม = ราคาขายออก 1 กก. ก่อน VAT ÷ 1000
  if new.kilo_sell is not null and new.kilo_sell > 0 then
    v_per_gram := round(new.kilo_sell / 1000.0, 4);
  elsif new.silver_value_per_baht is not null and new.silver_value_per_baht > 0 then
    v_per_gram := round(new.silver_value_per_baht / 15.244, 4);
  else
    return new;
  end if;

  -- fail closed: null ต้องไม่หลุดผ่านด่านช่วง (3j-migration-traps #4)
  if v_per_gram is null or not (v_per_gram >= 5 and v_per_gram <= 500) then
    raise warning 'silver_spot_sync_from_history: kilo_sell=% / per_baht=% -> %/ก. นอกช่วง 5–500 ไม่ sync (shop_id=%, captured_at=%)',
      new.kilo_sell, new.silver_value_per_baht, v_per_gram, new.shop_id, new.captured_at;
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('silver_spot:' || new.shop_id::text, 0));

  v_as_of_date := (new.captured_at at time zone 'Asia/Bangkok')::date;
  v_today := (now() at time zone 'Asia/Bangkok')::date;

  if v_as_of_date = v_today then
    select ss.silver_spot_updated_at into v_last_updated
    from analytics.shop_setting ss where ss.shop_id = new.shop_id;

    if v_last_updated is not null and new.captured_at < v_last_updated then
      raise notice 'silver_spot_sync_from_history: captured_at=% เก่ากว่า silver_spot_updated_at=% ที่มีอยู่ (shop_id=%) — ข้าม sync',
        new.captured_at, v_last_updated, new.shop_id;
      return new;
    end if;

    select exists (
      select 1 from analytics.oem_metal_price
      where shop_id = new.shop_id and metal = 'silver' and as_of_date = v_as_of_date and source = 'manual'
    ) into v_manual_exists;

    if v_manual_exists then
      raise notice 'silver_spot_sync_from_history: shop_id=% มี manual entry ของวัน % อยู่แล้ว — ข้าม sync (manual ชนะทั้งวัน)',
        new.shop_id, v_as_of_date;
      return new;
    end if;

    insert into analytics.shop_setting as ss (
      shop_id, silver_spot_thb_per_gram, silver_spot_updated_at, updated_at, updated_by
    )
    values (new.shop_id, v_per_gram, new.captured_at, now(), null)
    on conflict (shop_id) do update
      set silver_spot_thb_per_gram = v_per_gram,
          silver_spot_updated_at   = new.captured_at,
          updated_at               = now(),
          updated_by               = null
      where ss.silver_spot_updated_at is null or new.captured_at >= ss.silver_spot_updated_at;

    insert into analytics.oem_metal_price as omp (
      shop_id, metal, as_of_date, price_thb_per_gram, source, updated_by, updated_at
    )
    values (new.shop_id, 'silver', v_as_of_date, v_per_gram, 'sheet', null, now())
    on conflict (shop_id, metal, as_of_date) do update
      set price_thb_per_gram = v_per_gram, source = 'sheet', updated_by = null, updated_at = now()
      where omp.source <> 'manual';
  elsif v_as_of_date > v_today then
    raise warning 'silver_spot_sync_from_history: captured_at=% -> as_of_date=% อยู่ในอนาคต (วันนี้ไทย=%, shop_id=%) — ไม่ sync',
      new.captured_at, v_as_of_date, v_today, new.shop_id;
    return new;
  else
    insert into analytics.oem_metal_price as omp (
      shop_id, metal, as_of_date, price_thb_per_gram, source, updated_by, updated_at
    )
    values (new.shop_id, 'silver', v_as_of_date, v_per_gram, 'sheet', null, now())
    on conflict (shop_id, metal, as_of_date) do update
      set price_thb_per_gram = v_per_gram, source = 'sheet', updated_by = null, updated_at = now()
      where omp.source <> 'manual';
  end if;

  return new;
end;
$function$;

-- ============================================================================
-- 2. ปรับราคาของวันนี้ให้เป็นสูตรใหม่ทันที ไม่ต้องรอ capture รอบถัดไป
--    (source='manual' ยังชนะเสมอ ตามกติกา 0126 — ไม่แตะ)
-- ============================================================================

update analytics.oem_metal_price
   set price_thb_per_gram = 71.5000, updated_at = now()
 where shop_id = 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7' and metal = 'silver'
   and as_of_date = (now() at time zone 'Asia/Bangkok')::date and source <> 'manual';

update analytics.shop_setting
   set silver_spot_thb_per_gram = 71.5000, updated_at = now()
 where shop_id = 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7';

-- ============================================================================
-- 3. เงินแท่ง 6 ตัว: เลิกใช้ต้นทุนพิมพ์มือ → คำนวณตามราคาเงินวันนั้นอัตโนมัติ
--    สูตรระบบ (production_cost_calc / v_dim_product):
--      น้ำหนักกรัม × ราคาเงินต่อกรัม × ความบริสุทธิ์ + labor_cost
--    ⇒ labor_cost = ค่าบล็อกตามขนาด (จาก block_fee_* ในชีต 18 ก.ย. 69)
--    ⇒ ความบริสุทธิ์ 0.999 (แท่ง 999 ไม่ใช่เครื่องประดับ 925)
--    น้ำหนัก = มาตราไทย 1 บาท = 15.244 ก. (ค่าเดียวกับที่ระบบใช้อยู่แล้ว
--    ไม่ได้ถอดจากตัวเลขราคา — ห้ามอนุมานหน่วยวัดจากราคา)
--
--    ถ้าค่าบล็อกในชีตเปลี่ยน ให้แก้ที่ labor_cost ช่องเดียว ไม่ต้องแตะสูตร
-- ============================================================================

update public.product p
   set silver_weight_g = v.grams,
       silver_purity   = 0.999,
       labor_cost      = v.block_fee,
       cost_type       = 'spot',
       updated_at      = now()
  from (values
    ('S-0.5bath', 7.622::numeric,   65::numeric),
    ('S-1bath',  15.244::numeric,  100::numeric),
    ('S-3bath',  45.732::numeric,  200::numeric),
    ('S-5bath',  76.220::numeric,  300::numeric),
    ('S-10bath',152.440::numeric,  300::numeric),
    ('S-1kg.', 1000.000::numeric, 1500::numeric)
  ) as v(sku, grams, block_fee)
 where p.sku = v.sku and p.shop_id = 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7';

-- ============================================================================
-- ผลที่คาด (ราคาเงิน 71.50/ก. วันที่ 18 ก.ย. 69) — dry-run + post-apply ยืนยันครบ 6 ตัว
--   S-0.5bath   609.43  (เดิม    870, -30.0%)
--   S-1bath    1188.86  (เดิม  1,713, -30.6%)
--   S-3bath    3466.57  (เดิม  5,053, -31.4%)
--   S-5bath    5744.28  (เดิม  8,392, -31.6%)
--   S-10bath  11188.56  (เดิม 16,525, -32.3%)
--   S-1kg.    72928.50  (เดิม 79,380,  -8.1%)
--
-- ไม่แตะกำไรย้อนหลัง — fact_order_item.unit_cost_snapshot / fact_order.cogs
-- ถูก snapshot ไว้ตอนนำเข้าแล้ว ตรงตามที่เจ้าของสั่งไว้ว่า "ปรับราคาแล้วไม่ต้อง
-- ไปแก้กำไรย้อนหลัง" (17 ก.ย. 69) — และเรามีราคาเงินย้อนหลังแค่ตั้งแต่ 31 ส.ค.
-- จึงคำนวณต้นทุนจริงของยอดขาย ม.ค.–ส.ค. ให้แม่นไม่ได้อยู่ดี
--
-- หนี้ที่รู้ตัว: ค่าบล็อกยัง hardcode ต่อ SKU (ชีตมี block_fee_* อยู่แล้ว
-- ถ้าอยากให้วิ่งตามชีตด้วยต้องต่อท่อเพิ่ม) · เจ้าของแจ้งว่าจะกลับมาสรุปวิธีคิด
-- ราคางานเงินแท่งให้ครบ (ค่าบล็อก + กำเหน็จ 11%) อีกที
-- ============================================================================

notify pgrst, 'reload schema';

-- 0125_silver_spot_from_sheet.sql
-- Fixes analytics.shop_setting.silver_spot_thb_per_gram = 1,097 (hand-keyed
-- 26 ส.ค. 69) — that value is the sheet's PER-BAHT price (1 บาท = 15.244 ก.),
-- not per-gram, so v_dim_product's spot-mode cost calc (0028: weight_g ×
-- silver_spot_thb_per_gram × purity + labor) overcosted by ~15x for any SKU
-- using cost_type='spot' with a weight set (15.2 ก. × 1,097 × 0.999 ≈ ฿16,657
-- instead of ≈฿1,030).
--
-- Owner decision, 17 ก.ย. 69:
--   1. ราคาต่อกรัมต้องมาจากชีตราคาของร้าน "อัตโนมัติทุกเช้า" ไม่ใช่กรอกมือ —
--      source = analytics.silver_price_history.silver_value_per_baht (0102,
--      เขียนโดย scripts/capture-silver-price-sheet.mjs) ÷ 15.244.
--   2. spot mode ใช้กับเครื่องประดับ 925 ด้วย ไม่ใช่แค่เงินแท่ง (weight × spot
--      × purity + labor) — v_dim_product (0028) และ computeEffectiveCost()
--      (lib/catalog/types.ts) คำนวณแบบนี้อยู่แล้วสำหรับ cost_type='spot' ทุก
--      SKU ไม่ว่าประเภทไหน (purity default 0.925 เมื่อไม่กรอก) ⇒ ไม่ต้องแก้
--      สูตรใดๆ เพิ่ม บั๊กอยู่ที่ตัวเลข "ราคาต่อกรัม" ผิด ไม่ใช่สูตรผิด
--
-- 15.244 ยืนยันแล้วว่าเป็นค่าคงที่ที่ repo ใช้จริง (grep "15.2" ทั้ง repo):
-- components/domain/catalog/ProductImport.tsx ตัวอย่างแถว spot ใช้ 15.244
-- ตรงๆ, lib/oem/display.ts ใช้ 15.24 (ปัดเพื่อแสดงผลให้ลูกค้า อ้างว่า
-- "หน่วยชั่งมาตรฐานไทย"). ไม่พบค่าคงที่อื่นในระบบ (ไม่มี 15.2 เวอร์ชันอื่น) —
-- ใช้ 15.244 เต็มความละเอียดในการคำนวณ (เก็บทศนิยมมากกว่าค่าที่ใช้แสดงผล).
--
-- ทำไมต้องเป็น trigger ไม่ใช่ UPDATE ครั้งเดียว: ชีตอัปเดตทุกเช้าโดย capture
-- script ที่รันนอก migration นี้ (cron ภายนอก) — shop_setting ต้องตามให้สด
-- ทุกครั้งที่มี capture ใหม่จริง โดยไม่ต้องมีใครมา apply migration ซ้ำทุกวัน.
--
-- 🔴 ขอบเขตเพิ่ม (architect, หลัง scope เดิม): analytics.oem_price_calc (0062
-- ~บรรทัด 215) อ่านราคาเงินจาก analytics.oem_metal_price ก่อน (fallback มา
-- shop_setting.silver_spot_thb_per_gram เฉพาะตอน oem_metal_price ไม่มีแถว) —
-- sync แค่ shop_setting ที่เดียวจะทำให้ต้นทุนใบเสนอราคา OEM กับต้นทุน SKU ใน
-- catalog/dashboard วันเดียวกันเพี้ยนกันทันทีที่วันไหนมีคน manual กรอก
-- oem_metal_price ไว้ (ตอนนี้ตารางว่างเปล่าจริงตามที่ตรวจแล้ว — ดู memory
-- silver-bar-demand-collapse — แปลว่า fallback ทำงานเหมือน sync กันอยู่แล้ว
-- โดยบังเอิญ แต่จะพังทันทีที่มีแถวแรกเข้า oem_metal_price ถ้าไม่ sync คู่กัน)
-- ⇒ trigger เดียวกันนี้เขียนทั้ง 2 ที่ ไม่แตะ 0062 เลย (0062 อ่าน "แถวล่าสุดที่
-- as_of_date <= วันที่คำนวณ" อยู่แล้ว แค่ทำให้มีแถวที่ถูกต้องให้มันอ่านพอ) —
-- ดู schema oem_metal_price ที่ 0061:192 (unit เดียวกันคือ "ต่อกรัม เนื้อ
-- 999" ก่อนคูณ purity/loss rate อื่นๆ ที่ 0062 — ไม่ต้องแปลงหน่วยเพิ่ม
-- ตรงกับ shop_setting.silver_spot_thb_per_gram เป๊ะ).
--
-- ============================================================================
-- 1. Trigger function — sync silver_spot_thb_per_gram (shop_setting) +
--    price_thb_per_gram ของแถว metal='silver' วันนั้น (oem_metal_price) จาก
--    ทุกแถวใหม่ของ silver_price_history ที่มี silver_value_per_baht ใช้ได้จริง.
--
--    security definer (ต่างจาก trigger guard เดิมในระบบ เช่น
--    oem_doc_counter_deny_mutation/0088 ซึ่งไม่ใช้ security definer เพราะแค่
--    raise exception ไม่ได้เขียนข้าม table) — ตัวนี้ INSERT/UPDATE ข้ามไปยัง
--    analytics.shop_setting + analytics.oem_metal_price ซึ่งมี RLS policy
--    owner_admin_update/owner_admin_write ผูกกับ auth.uid() (0028/0061) ปกติ
--    INSERT บน silver_price_history วิ่งผ่าน service-role client เท่านั้น
--    อยู่แล้ว (bypass RLS ทุกตารางโดยธรรมชาติ ดูคอมเมนต์ 0102) แต่ pin เป็น
--    security definer ไว้เป็น defense-in-depth เผื่ออนาคตมี caller อื่นที่
--    ไม่ใช่ service role มา insert ตารางนี้ — pin search_path ตามธรรมเนียมทุก
--    security definer function ในระบบ.
-- ============================================================================

create or replace function analytics.silver_spot_sync_from_history()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
begin
  -- silver_value_per_baht เป็น null ได้ตามปกติ (cross-check ของ parseSheet
  -- ล้มเฉพาะบางฟิลด์ได้ แต่ column check ของ 0102 กัน <=0/NaN ไว้แล้วที่ชั้น
  -- ตาราง) — เช็คซ้ำตรงนี้กันเผื่อ null ไหลผ่านมาจาก caller อื่นในอนาคต และ
  -- ไม่ทำอะไรเลยถ้าแถวนี้ไม่มีราคาต่อบาทให้ใช้ (ไม่ sync ราคาว่างทับของเดิม).
  if new.silver_value_per_baht is null or new.silver_value_per_baht <= 0 then
    return new;
  end if;

  insert into analytics.shop_setting as ss (shop_id, silver_spot_thb_per_gram, silver_spot_updated_at)
  values (new.shop_id, round(new.silver_value_per_baht / 15.244, 4), new.captured_at)
  on conflict (shop_id) do update
    set silver_spot_thb_per_gram = round(new.silver_value_per_baht / 15.244, 4),
        silver_spot_updated_at   = new.captured_at
    -- กัน capture เก่ากว่ามาถึงทีหลัง (retry/backfill/manual insert ย้อนหลัง)
    -- ทับราคาสดล่าสุดด้วยราคาเก่ากว่า — sync เฉพาะเมื่อยังไม่เคย sync เลย
    -- (silver_spot_updated_at is null) หรือแถวนี้ใหม่กว่า/เท่ากับที่ sync ไว้.
    where ss.silver_spot_updated_at is null or new.captured_at >= ss.silver_spot_updated_at;

  -- oem_metal_price: PK คือ (shop_id, metal, as_of_date) — ต่างจาก shop_setting
  -- ที่เก็บ "ค่าปัจจุบัน" แถวเดียวตลอดกาล ตารางนี้แบ่งเป็นรายวันอยู่แล้ว (วันทาง
  -- ธุรกิจของไทย ไม่ใช่ UTC — 3j-migration-traps ข้อ 6) จึงไม่ต้องกันการยิงย้อน
  -- ข้ามวันแบบ shop_setting ข้างบน (แถวของวันนั้นๆ ไม่แตะแถวของวันอื่น) แต่ยัง
  -- ต้องกันแคปเจอร์ 2 ครั้งในวันเดียวกันมาไม่เรียงลำดับ (retry มาถึงทีหลังแต่
  -- captured_at เก่ากว่า) ทับราคาสดกว่าด้วยราคาเก่ากว่า — เทียบ updated_at เดิม
  -- ของแถว (ตั้งเป็น now() ตอนเขียนเสมอ) ไม่ได้ตรงกับ captured_at ของ source
  -- โดยตรง แต่ต้องมี guard บางอย่าง จึงใช้ "insert เดิมมาจาก source เก่ากว่า
  -- ไหม" ผ่าน note ใน raw ไม่คุ้มความซับซ้อน — เลือก insert แบบ "ค่าล่าสุดของ
  -- วันนั้นชนะ" ตรงกับพฤติกรรม oem_metal_price_set (0061) เองอยู่แล้ว ("same-
  -- day re-entry collapses to a correction") ไม่ใช่พฤติกรรมใหม่ที่ต้องกันเพิ่ม.
  insert into analytics.oem_metal_price (shop_id, metal, as_of_date, price_thb_per_gram, source, updated_at)
  values (
    new.shop_id, 'silver',
    (new.captured_at at time zone 'Asia/Bangkok')::date,
    round(new.silver_value_per_baht / 15.244, 4),
    'sheet', now()
  )
  on conflict (shop_id, metal, as_of_date) do update
    set price_thb_per_gram = round(new.silver_value_per_baht / 15.244, 4),
        source             = 'sheet',
        updated_at         = now();

  return new;
end;
$$;

revoke execute on function analytics.silver_spot_sync_from_history() from public, anon, authenticated;
-- ไม่ grant ให้ role ไหนเลย: ฟังก์ชันนี้ถูกเรียกผ่าน trigger เท่านั้น ไม่ใช่ RPC
-- ตรง — การ fire trigger ไม่เช็ค EXECUTE privilege ของ role ที่ทำ INSERT
-- (Postgres เช็คแค่ตอน CREATE TRIGGER ซึ่งรันโดยเจ้าของ migration/superuser)
-- ตามธรรมเนียมเดียวกับ analytics.oem_doc_counter_deny_mutation (0088).

drop trigger if exists silver_spot_sync_from_history on analytics.silver_price_history;
create trigger silver_spot_sync_from_history
  after insert on analytics.silver_price_history
  for each row execute function analytics.silver_spot_sync_from_history();

-- AFTER INSERT เท่านั้น (ไม่ใช่ AFTER INSERT OR UPDATE): ตรวจ
-- scripts/capture-silver-price-sheet.mjs แล้ว — insert() ตรงๆ ไม่มี
-- `on conflict do nothing`, ชนกับ unique(shop_id, sheet_row_hash) ของ 0102
-- (ราคาไม่เปลี่ยนจาก capture ก่อนหน้า) จะโยน error 23505 ที่ฝั่ง JS ดัก+ข้ามเอง
-- (บรรทัด "ℹ️ ราคาไม่เปลี่ยน... ข้ามการบันทึก") แปลว่าแถวไม่ถูกเขียนจริงเมื่อ
-- ราคาเดิม — ไม่มี path UPDATE บนตารางนี้เลย (append-only ตามคอมเมนต์ 0102)
-- AFTER INSERT อย่างเดียวจึงครบทุกเคสที่ควร sync.

-- ============================================================================
-- 2. Backfill ครั้งเดียว — ใช้แถวล่าสุดที่มี silver_value_per_baht ใช้ได้ต่อ
--    ร้าน แก้ค่า 1,097 (ต่อบาท) ที่กรอกมือค้างอยู่ให้กลายเป็นค่าต่อกรัมที่ถูกต้อง
--    ทั้ง shop_setting และ oem_metal_price (แถว metal='silver' ของวันนั้น) —
--    สอง INSERT ต่างคำสั่งกัน (ต้องคนละ statement) แต่ query เดียวกันเป๊ะ
--    (CTE เขียนซ้ำ) เพื่อให้สองตารางได้ตัวเลข/วันที่ตรงกัน.
-- ============================================================================

with latest as (
  select distinct on (h.shop_id)
    h.shop_id, h.silver_value_per_baht, h.captured_at
  from analytics.silver_price_history h
  where h.silver_value_per_baht is not null and h.silver_value_per_baht > 0
  order by h.shop_id, h.captured_at desc
)
insert into analytics.shop_setting as ss (shop_id, silver_spot_thb_per_gram, silver_spot_updated_at)
select l.shop_id, round(l.silver_value_per_baht / 15.244, 4), l.captured_at
from latest l
on conflict (shop_id) do update
  set silver_spot_thb_per_gram = excluded.silver_spot_thb_per_gram,
      silver_spot_updated_at   = excluded.silver_spot_updated_at
  where ss.silver_spot_updated_at is null or excluded.silver_spot_updated_at >= ss.silver_spot_updated_at;

with latest as (
  select distinct on (h.shop_id)
    h.shop_id, h.silver_value_per_baht, h.captured_at
  from analytics.silver_price_history h
  where h.silver_value_per_baht is not null and h.silver_value_per_baht > 0
  order by h.shop_id, h.captured_at desc
)
insert into analytics.oem_metal_price (shop_id, metal, as_of_date, price_thb_per_gram, source, updated_at)
select l.shop_id, 'silver', (l.captured_at at time zone 'Asia/Bangkok')::date,
       round(l.silver_value_per_baht / 15.244, 4), 'sheet', l.captured_at
from latest l
on conflict (shop_id, metal, as_of_date) do update
  set price_thb_per_gram = excluded.price_thb_per_gram,
      source             = 'sheet',
      updated_at         = excluded.updated_at;

-- shop ที่ไม่เคยมี silver_price_history เลย (ไม่มี capture รันมาก่อน) จะไม่ถูก
-- แตะโดย backfill นี้ทั้งสองก้อน — silver_spot_thb_per_gram ของ shop นั้นค้าง
-- ค่าเดิม (อาจยังเป็น 1,097 ถ้าเคยกรอกมือ) และ oem_metal_price ยังไม่มีแถวเลย
-- จนกว่าจะมี capture แรกวิ่งเข้า trigger เอง. ยอมรับได้: migration นี้แก้ "sync
-- ทำงานถูกจากนี้ไป" ไม่ใช่ "ล้างข้อมูลเก่าที่ไม่มีต้นทางให้แก้" — ตรวจแล้วว่า
-- shop เดียวที่ใช้งานจริงมี capture history แล้ว.
--
-- 🔴 หนี้ที่รู้ตัว: backfill นี้เติม oem_metal_price ให้แค่ "วันนี้" (วันของ
-- capture ล่าสุด) เท่านั้น ไม่ได้ไล่ backfill ย้อนหลังทุกวันที่มีอยู่ใน
-- silver_price_history — ใบเสนอราคา OEM ที่จะออกของวันก่อนหน้านี้ (ถ้ามี) จะ
-- ยังตกไป fallback shop_setting เหมือนเดิม (พฤติกรรมเดิมก่อน migration นี้
-- ไม่เปลี่ยน ไม่ใช่ regression) ไม่ backfill ย้อนหลังทุกวันเพราะไม่มีใครขอ
-- และ oem_price_calc (0062) ที่ต้องอ่านมันเป็นราคา ณ "วันนี้"/อนาคตเท่านั้น
-- (ใบเสนอราคาใหม่ ไม่ใช่พิมพ์ซ้ำใบเก่า — เอกสารที่ออกแล้ว snapshot ราคาไว้เอง
-- ตาม oem-quote-invariants §7 อยู่แล้ว จึงไม่กระทบใบเก่า).

comment on column analytics.shop_setting.silver_spot_thb_per_gram is
  'ราคาเงินสปอตต่อกรัม (เนื้อเงิน 999) — sync อัตโนมัติจาก '
  'analytics.silver_price_history.silver_value_per_baht หาร 15.244 ทุกครั้งที่ '
  'scripts/capture-silver-price-sheet.mjs เขียนแถวใหม่ (trigger '
  'analytics.silver_spot_sync_from_history, 0125). ห้ามกรอกราคาต่อบาทตรงนี้ — '
  'ค่านี้คูณตรงกับน้ำหนักกรัมใน v_dim_product (0028) กรอกผิดหน่วยเคยทำต้นทุน '
  'SKU โหมด spot เกินจริง ~15 เท่า (บั๊ก ฿1,097 ที่แก้ใน 0125). กรอกมือได้ในหน้า '
  '/settings เฉพาะกรณีฉุกเฉิน (จะถูก sync ทับที่ capture ครั้งถัดไป).';

-- ============================================================================
-- 3. shop_setting_upsert — เพิ่มเพดานบน (>500) ให้ p_silver_spot_thb_per_gram.
--    ราคาต่อกรัมของเงิน/ทองไม่มีทางถึง 500 บาทจริง (ราคาต่อบาท ~1,000 หาร
--    15.244 ยังไม่ถึง 100) — ค่าที่เกิน 500 คือกรอกผิดหน่วย (เอาราคาต่อบาทมา
--    กรอกตรงๆ) เกือบแน่นอน กันที่ RPC (ชั้นที่บังคับจริงเสมอ ไม่ว่าจะเรียกผ่าน
--    UI หรือไม่) ไม่ใช่กันแค่ที่ฟอร์ม — ตาม memory "role-single-level: กฎที่
--    ต้องบังคับจริงให้ไปอยู่ที่ DB ไม่ใช่ที่ปุ่ม". signature เดิมเป๊ะ (uuid,
--    numeric, numeric, numeric) — ไม่ใช่ overload ใหม่ (ดู 3j-migration-traps
--    ข้อ 1) แต่ grant ก็ยังหายทุกครั้งที่ replace (ข้อ 2) จึง re-grant ท้าย
--    บล็อกนี้เหมือนเดิม. Body ที่เหลือคัดลอกจาก 0028 คำต่อคำ แก้เฉพาะเงื่อนไข
--    validate ของ p_silver_spot_thb_per_gram บรรทัดเดียว.
-- ============================================================================

create or replace function analytics.shop_setting_upsert(
  p_shop_id uuid,
  p_silver_spot_thb_per_gram numeric default null,
  p_blended_margin_pct numeric default null,
  p_target_ad_gp_share numeric default null
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
begin
  if p_shop_id is null then
    raise exception 'shop_setting_upsert: p_shop_id is required';
  end if;
  if p_blended_margin_pct is not null and (p_blended_margin_pct <= 0 or p_blended_margin_pct >= 1) then
    raise exception 'shop_setting_upsert: p_blended_margin_pct must be in (0,1)';
  end if;
  if p_target_ad_gp_share is not null and (p_target_ad_gp_share <= 0 or p_target_ad_gp_share > 1) then
    raise exception 'shop_setting_upsert: p_target_ad_gp_share must be in (0,1]';
  end if;
  -- not(between) กัน NaN/Infinity หลุดผ่าน (3j-migration-traps ข้อ 4) —
  -- 'NaN'::numeric > 0 เป็น true ใน Postgres แต่ 'NaN' <= 500 เป็น false เสมอ
  -- ดังนั้น not(x >= 0 and x <= 500) จับ NaN ได้ครบ ไม่ต้องเช็คแยก
  if p_silver_spot_thb_per_gram is not null and not (p_silver_spot_thb_per_gram >= 0 and p_silver_spot_thb_per_gram <= 500) then
    raise exception 'shop_setting_upsert: p_silver_spot_thb_per_gram must be between 0 and 500 (ต่อกรัม ไม่ใช่ต่อบาท — 1 บาท = 15.244 กรัม)';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  insert into analytics.shop_setting as ss (
    shop_id, silver_spot_thb_per_gram, silver_spot_updated_at,
    blended_margin_pct, target_ad_gp_share, updated_by, updated_at
  ) values (
    p_shop_id, p_silver_spot_thb_per_gram,
    case when p_silver_spot_thb_per_gram is not null then now() else null end,
    coalesce(p_blended_margin_pct, 0.20), coalesce(p_target_ad_gp_share, 0.50), auth.uid(), now()
  )
  on conflict (shop_id) do update set
    silver_spot_thb_per_gram = coalesce(p_silver_spot_thb_per_gram, ss.silver_spot_thb_per_gram),
    silver_spot_updated_at   = case when p_silver_spot_thb_per_gram is not null then now() else ss.silver_spot_updated_at end,
    blended_margin_pct       = coalesce(p_blended_margin_pct, ss.blended_margin_pct),
    target_ad_gp_share       = coalesce(p_target_ad_gp_share, ss.target_ad_gp_share),
    updated_by               = auth.uid(),
    updated_at               = now();
end;
$$;

revoke execute on function analytics.shop_setting_upsert(uuid, numeric, numeric, numeric)
  from public, anon, authenticated;
grant execute on function analytics.shop_setting_upsert(uuid, numeric, numeric, numeric)
  to authenticated, service_role;

notify pgrst, 'reload schema';

-- ============================================================================
-- Dry-run (Tech Lead รันแยกผ่าน MCP ก่อน apply จริง ไม่ใช่ส่วนหนึ่งของไฟล์นี้ —
-- 3j-migration-traps ข้อ 11/12: do-block + raise บังคับ rollback, ตรวจ state
-- ก่อน-หลังไม่ขยับ). ตัวอย่าง (แทน <SHOP_ID> ด้วย shop จริง):
--
-- do $$
-- declare
--   v_log text := E'\n=== ผลทดสอบ 0125 ===\n';
--   v_shop_id uuid := '<SHOP_ID>';
--   v_before numeric;
--   v_after numeric;
--   v_oem_price numeric;
--   v_today date := (now() at time zone 'Asia/Bangkok')::date;
-- begin
--   select silver_spot_thb_per_gram into v_before from analytics.shop_setting where shop_id = v_shop_id;
--   v_log := v_log || format('ก่อน insert: silver_spot_thb_per_gram = %s\n', v_before);
--
--   -- แถวปลอม: silver_value_per_baht = 1000 -> คาดว่า spot จะกลายเป็น
--   -- round(1000/15.244,4) = 65.5876
--   insert into analytics.silver_price_history (shop_id, sheet_row_hash, silver_value_per_baht, captured_at)
--   values (v_shop_id, 'dry-run-0125-' || gen_random_uuid()::text, 1000, now());
--
--   select silver_spot_thb_per_gram into v_after from analytics.shop_setting where shop_id = v_shop_id;
--   if v_after = 65.5876 then
--     v_log := v_log || 'T1 shop_setting sync: OK (65.5876)\n';
--   else
--     v_log := v_log || format('T1 shop_setting sync: FAIL (ได้ %s)\n', v_after);
--   end if;
--
--   -- T3 (ขอบเขตเพิ่มจาก architect): oem_metal_price ต้องได้ค่าเดียวกันเป๊ะ
--   -- สำหรับวันนี้ (as_of_date = วันนี้ตามเวลาไทย, metal='silver')
--   select price_thb_per_gram into v_oem_price
--     from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   if v_oem_price = v_after then
--     v_log := v_log || format('T3 oem_metal_price ตรงกับ shop_setting: OK (%s = %s)\n', v_oem_price, v_after);
--   else
--     v_log := v_log || format('T3 oem_metal_price MISMATCH: oem_metal_price=%s shop_setting=%s\n', v_oem_price, v_after);
--   end if;
--
--   -- ทดสอบ gate >500 บน RPC (ต้องปฏิเสธ)
--   begin
--     perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
--     perform analytics.shop_setting_upsert(v_shop_id, 501, null, null);
--     v_log := v_log || 'T2 gate >500: FAIL ผ่านทั้งที่ควรปฏิเสธ\n';
--   exception when others then
--     v_log := v_log || 'T2 gate >500: OK ปฏิเสธ\n';
--   end;
--
--   raise exception '%', v_log; -- บังคับ rollback ทั้งก้อน — DB ไม่ขยับจริง
-- end $$;
-- ============================================================================

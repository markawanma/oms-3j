-- 0126_silver_spot_sanity_bounds.sql
-- Security review of 0125 (already applied) — NO-GO ชั่วคราว, ต้องแก้ก่อน merge:
--
--   H1  trigger silver_spot_sync_from_history sync ทุกค่าที่ silver_value_per_baht
--       > 0 แม้ผลหารออกมาไร้สาระ (เช่นชีตสลับคอลัมน์/พิมพ์ผิดหลักจนได้ราคาต่อ
--       บาทเป็นหลักแสน) — ไม่มี sanity bound เลยหลังผ่าน 0125's <=0 guard
--   H2(ก) shop_setting_upsert (ทางกรอกมือที่ /settings) ไม่เขียน oem_metal_price
--       เลย — แปลว่าต้นทุน SKU (shop_setting) กับใบเสนอราคา OEM (oem_metal_price,
--       ซึ่ง oem_price_calc อ่านก่อนเสมอ — 0062) ใช้คนละราคาได้ทันทีที่เจ้าของ
--       กรอกมือ ไม่ต้องรอ capture รอบถัดไป
--   M1  trigger (ฝั่งชีต) ทับราคาที่กรอกมือ (manual, จาก H2(ก)) ของวันเดียวกัน
--       ได้เงียบๆ — capture รอบถัดไปในวันนั้นจะเขียนทับค่าที่เจ้าของเพิ่งแก้มือ
--   M2  floor ของ validator ทุกชั้น (types.ts / catalog.ts / RPC เดิม) อนุญาต 0
--       — ราคาเงินสปอตจริงไม่มีทางเป็น 0 ได้ (สินค้ามีมูลค่าเสมอ)
--
-- SILVER_SPOT_FLOOR = 5, SILVER_SPOT_CEILING = 500 (บาท/กรัม) — ค่าคงที่นี้
-- ต้องตรงกันทั้ง 3 ที่: trigger analytics.silver_spot_sync_from_history
-- (ข้างล่าง), RPC analytics.shop_setting_upsert (ข้างล่าง), และฝั่ง client
-- lib/catalog/types.ts (silverSpotValidationError/MAX_SILVER_SPOT_THB_PER_GRAM
-- — แก้ในไฟล์ TS แยกต่างหาก commit เดียวกันนี้) เปลี่ยนต้องเปลี่ยนพร้อมกันทั้ง
-- 3 จุด ไม่งั้นชั้นหนึ่งจะเข้มกว่าอีกชั้นแบบไม่ตั้งใจ
--
-- 15.244: ยังใช้ค่าคงที่นี้ต่อ (ยืนยันซ้ำจาก 0125 — grep "15.2" ทั้ง repo แล้ว
-- นี่คือค่าที่ระบบใช้คำนวณจริง lib/oem/display.ts มี 15.24 อยู่ด้วยแต่นั่นคือ
-- เวอร์ชันปัดสำหรับ "แสดงผล" ให้ลูกค้าดูเท่านั้น ไม่ใช่ค่าที่ใช้คำนวณ).
--
-- ============================================================================
-- 1. Trigger — เพิ่ม sanity bound (H1) + เขียน oem_metal_price แบบ "manual
--    ชนะทั้งวัน" (M1) + shop_setting.updated_at ตามด้วย (M1).
-- ============================================================================

create or replace function analytics.silver_spot_sync_from_history()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_per_gram numeric;
begin
  if new.silver_value_per_baht is null then
    return new;
  end if;

  v_per_gram := round(new.silver_value_per_baht / 15.244, 4);

  -- H1: SILVER_SPOT_FLOOR/CEILING = 5/500 บาท/กรัม (เนื้อเงิน 999) — ราคา
  -- จริงไม่มีทางต่ำกว่า 5 หรือเกิน 500 บาท/กรัม นอกช่วงนี้คือข้อมูลชีตเพี้ยน
  -- (คอลัมน์สลับ/เลขหลุดหลักเพิ่ม เช่น 152,440 ต่อบาท -> ~10,000/ก.) ปฏิเสธ
  -- ไม่ sync แต่ไม่ทำให้ insert silver_price_history เดิมล้มเหลว (แค่ไม่ sync
  -- ต่อ) — ใช้ warning ไม่ใช่ exception เพราะแถวประวัติเองยังถูกต้อง (แค่ค่า
  -- แปลงหน่วยจากมันดูไม่น่าเชื่อ) capture script ควรเห็น warning นี้ใน log.
  -- not(between) ฆ่า NaN/Infinity ให้ฟรีด้วย (3j-migration-traps ข้อ 4).
  if not (v_per_gram >= 5 and v_per_gram <= 500) then
    raise warning 'silver_spot_sync_from_history: silver_value_per_baht=% -> %/ก. นอกช่วง 5–500 ไม่ sync (shop_id=%, captured_at=%)',
      new.silver_value_per_baht, v_per_gram, new.shop_id, new.captured_at;
    return new;
  end if;

  insert into analytics.shop_setting as ss (
    shop_id, silver_spot_thb_per_gram, silver_spot_updated_at, updated_at
  )
  values (new.shop_id, v_per_gram, new.captured_at, now())
  on conflict (shop_id) do update
    set silver_spot_thb_per_gram = v_per_gram,
        silver_spot_updated_at   = new.captured_at,
        updated_at               = now()          -- M1: touch the row-level timestamp too
    -- กัน capture เก่ากว่ามาถึงทีหลัง (retry/backfill/manual insert ย้อนหลัง)
    -- ทับราคาสดล่าสุดด้วยราคาเก่ากว่า (ไม่ใช่เรื่อง manual/sheet — เรื่อง
    -- ลำดับเวลาของ capture เอง — shop_setting ไม่มีคอลัมน์ source แยกแบบ
    -- oem_metal_price จึงกันได้แค่ระดับนี้).
    where ss.silver_spot_updated_at is null or new.captured_at >= ss.silver_spot_updated_at;

  -- oem_metal_price: M1 — "manual ชนะทั้งวัน" ถ้าเจ้าของเพิ่งกรอกมือให้วันนี้
  -- ผ่าน shop_setting_upsert (H2(ก) ข้างล่าง, source='manual') ห้าม capture
  -- จากชีตรอบถัดไปในวันเดียวกันทับเงียบๆ — WHERE กันไว้ที่ DO UPDATE (แถวแรก
  -- ของวันที่ยังไม่มี conflict ยัง insert ได้ปกติ, WHERE มีผลเฉพาะตอนชนกัน).
  -- updated_by ถูกล้างกลับเป็น null ตอน sheet เขียนทับ (เจ้าของไม่ได้เป็นคน
  -- ยืนยันราคาที่มาจากชีตอัตโนมัติ).
  insert into analytics.oem_metal_price as omp (
    shop_id, metal, as_of_date, price_thb_per_gram, source, updated_by, updated_at
  )
  values (
    new.shop_id, 'silver', (new.captured_at at time zone 'Asia/Bangkok')::date,
    v_per_gram, 'sheet', null, now()
  )
  on conflict (shop_id, metal, as_of_date) do update
    set price_thb_per_gram = v_per_gram,
        source             = 'sheet',
        updated_by         = null,
        updated_at         = now()
    where omp.source <> 'manual';

  return new;
end;
$$;

revoke execute on function analytics.silver_spot_sync_from_history() from public, anon, authenticated;
-- (เหตุผลไม่ grant ให้ใครเลย: ดูคอมเมนต์เดียวกันใน 0125 — trigger ไม่เช็ค
-- EXECUTE privilege ตอน fire แค่ตอน CREATE TRIGGER)

-- trigger เดิมยังใช้ได้ (ชื่อ/ตารางเดิม เพียงแค่ create or replace ฟังก์ชัน
-- ข้างบนพอ ไม่ต้อง drop/create trigger ใหม่)

-- ============================================================================
-- 2. shop_setting_upsert — H2(ก): เขียน oem_metal_price(source='manual') คู่
--    กันเสมอเมื่อมีการกรอก/แก้ spot มือ + M2: floor เป็น 5 (ปฏิเสธ 0).
--    signature เดิมเป๊ะ (uuid, numeric, numeric, numeric) — ไม่ใช่ overload
--    ใหม่ (3j-migration-traps ข้อ 1) แต่ grant หายทุกครั้งที่ replace (ข้อ 2)
--    จึง re-grant ท้ายบล็อกนี้เหมือนเดิม.
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
  -- M2: SILVER_SPOT_FLOOR/CEILING = 5/500 — ต้องตรงกับ trigger
  -- analytics.silver_spot_sync_from_history ข้างบน. not(between) กัน
  -- NaN/Infinity (3j-migration-traps ข้อ 4); 0 ถูกปฏิเสธแล้วเพราะ floor=5.
  if p_silver_spot_thb_per_gram is not null and not (p_silver_spot_thb_per_gram >= 5 and p_silver_spot_thb_per_gram <= 500) then
    raise exception 'shop_setting_upsert: p_silver_spot_thb_per_gram must be between 5 and 500 (ต่อกรัม ไม่ใช่ต่อบาท — 1 บาท = 15.244 กรัม)';
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

  -- H2(ก): มีการกรอก/แก้ spot มือ -> เขียน oem_metal_price ของวันนี้ (เวลา
  -- ไทย) ให้ตรงกันด้วย เสมอทับค่าที่มีอยู่ไม่ว่า source เดิมจะเป็นอะไร (ต่าง
  -- จาก trigger ฝั่งชีตข้างบนซึ่งห้ามทับ manual — call นี้เองคือ "manual" ที่
  -- ควรชนะ) ทำเฉพาะตอนมีค่าใหม่ส่งมาจริง (ไม่ใช่แค่แก้ margin/ad-share).
  if p_silver_spot_thb_per_gram is not null then
    insert into analytics.oem_metal_price as omp (
      shop_id, metal, as_of_date, price_thb_per_gram, source, updated_by, updated_at
    ) values (
      p_shop_id, 'silver', (now() at time zone 'Asia/Bangkok')::date,
      p_silver_spot_thb_per_gram, 'manual', auth.uid(), now()
    )
    on conflict (shop_id, metal, as_of_date) do update
      set price_thb_per_gram = excluded.price_thb_per_gram,
          source             = 'manual',
          updated_by         = excluded.updated_by,
          updated_at         = now();
  end if;
end;
$$;

revoke execute on function analytics.shop_setting_upsert(uuid, numeric, numeric, numeric)
  from public, anon, authenticated;
grant execute on function analytics.shop_setting_upsert(uuid, numeric, numeric, numeric)
  to authenticated, service_role;

notify pgrst, 'reload schema';

-- ============================================================================
-- หนี้ที่รู้ตัว (บันทึกแยก ไม่ทำในรอบนี้ตามที่ Tech Lead สั่ง):
--   H2(ข) freshness gate ใน oem_price_calc (0062) — ตอนนี้ oem_metal_price
--   ไม่มีเพดานอายุ ใบเสนอราคาที่คำนวณวันนี้ยังอ่านราคาของเมื่อวาน/เก่ากว่าได้
--   ถ้าวันนี้ยังไม่มี capture/manual entry เข้ามาเลย (fallback "แถวล่าสุดที่
--   as_of_date <= วันนี้" ของ 0062 ไม่เช็คว่าห่างมากี่วัน) — เทียบกับ§5 ของ
--   oem-quote-invariants ("ราคาไม่สด = ออกใบไม่ได้") ยังไม่ครบสำหรับ silver
--   metal price โดยเฉพาะ ต้องแก้ 0062 ซึ่งอยู่นอกขอบเขตที่สั่งไว้รอบนี้.
-- ============================================================================

-- ============================================================================
-- Dry-run (Tech Lead รันแยกผ่าน MCP ก่อน apply จริง ไม่ใช่ส่วนหนึ่งของไฟล์นี้ —
-- 3j-migration-traps ข้อ 11: do-block + raise บังคับ rollback, ตรวจ state
-- ก่อน-หลังไม่ขยับ). หมายเหตุ: insert silver_price_history ต้องใส่
-- sheet_row_hash (not null, unique ต่อ shop) ตัวอย่าง (แทน <SHOP_ID>):
--
-- do $$
-- declare
--   v_log text := E'\n=== ผลทดสอบ 0126 ===\n';
--   v_shop_id uuid := '<SHOP_ID>';
--   v_today date := (now() at time zone 'Asia/Bangkok')::date;
--   v_oem numeric;
--   v_ss numeric;
-- begin
--   perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
--
--   -- (ค) spot=0 ผ่าน RPC ต้อง raise (floor=5)
--   begin
--     perform analytics.shop_setting_upsert(v_shop_id, 0, null, null);
--     v_log := v_log || 'C spot=0: FAIL ผ่านทั้งที่ควรปฏิเสธ\n';
--   exception when others then
--     v_log := v_log || 'C spot=0: OK ปฏิเสธ\n';
--   end;
--
--   -- (ข) manual 70 แล้ว sheet capture เข้าวันเดียวกัน -> oem_metal_price
--   -- ต้องคง 70 (M1 "manual ชนะทั้งวัน") ส่วน shop_setting จะเปลี่ยนตามชีต
--   -- (พฤติกรรมเดิม ไม่ใช่สิ่งที่เคสนี้ทดสอบ)
--   perform analytics.shop_setting_upsert(v_shop_id, 70, null, null);
--   insert into analytics.silver_price_history (shop_id, sheet_row_hash, silver_value_per_baht, captured_at)
--   values (v_shop_id, 'dry-run-0126-b-' || gen_random_uuid()::text, 1000, now()); -- -> 65.5876/ก. ถ้า sync ได้
--   select price_thb_per_gram into v_oem from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   if v_oem = 70 then
--     v_log := v_log || 'B manual ชนะ: OK (ยังเป็น 70)\n';
--   else
--     v_log := v_log || format('B manual ชนะ: FAIL (ได้ %s)\n', v_oem);
--   end if;
--
--   -- (ก) silver_value_per_baht = 152,440 -> ~10,000/ก. นอกช่วง 5-500 ต้อง
--   -- ไม่ sync เลย (ทั้ง shop_setting และ oem_metal_price ต้องไม่ขยับจากค่า
--   -- ก่อนหน้า — เทียบกับ v_oem/v_ss ที่จับไว้ก่อนบรรทัดนี้)
--   select silver_spot_thb_per_gram into v_ss from analytics.shop_setting where shop_id = v_shop_id;
--   insert into analytics.silver_price_history (shop_id, sheet_row_hash, silver_value_per_baht, captured_at)
--   values (v_shop_id, 'dry-run-0126-a-' || gen_random_uuid()::text, 152440, now());
--   perform 1 from analytics.shop_setting where shop_id = v_shop_id and silver_spot_thb_per_gram = v_ss;
--   if found then
--     v_log := v_log || 'A นอกช่วง 5-500: OK (shop_setting ไม่ขยับ, ดู server log หา WARNING คู่กัน)\n';
--   else
--     v_log := v_log || 'A นอกช่วง 5-500: FAIL (shop_setting ขยับทั้งที่ไม่ควร sync)\n';
--   end if;
--
--   raise exception '%', v_log; -- บังคับ rollback ทั้งก้อน — DB ไม่ขยับจริง
-- end $$;
-- ============================================================================

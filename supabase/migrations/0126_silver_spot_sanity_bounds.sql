-- 0126_silver_spot_sanity_bounds.sql
-- ✅ APPLIED 17 ก.ย. 69 via MCP (version 20260917073609)
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
--       [แก้เพิ่มหลัง dry-run 17 ก.ย. 69: ดีไซน์แรกกัน "ทับเงียบๆ" ไว้แค่ที่
--       oem_metal_price (WHERE บน DO UPDATE) — dry-run เคส B พบว่า shop_setting
--       ไม่มีคอลัมน์ source เลยโดน sheet ทับต่อไปตามปกติ (manual 70 -> sheet
--       capture วันเดียวกัน -> shop_setting กลายเป็น 65.5996 ทั้งที่
--       oem_metal_price ยังเป็น 70) เปิดช่องที่ H2(ก) ตั้งใจปิดกลับมาทันที —
--       Tech Lead ตัดสิน: กติกาต้องเป็น "manual ชนะทั้งวัน ทั้ง 2 ตาราง" ไม่ใช่
--       แค่ oem_metal_price — แก้ด้วยการเช็คก่อนเขียนอะไรทั้งสิ้นว่าวันนี้มี
--       manual entry อยู่แล้วไหม ถ้ามีไม่แตะทั้งสองตารางเลย]
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
-- 🔴 อัปเดต (0127, code review): "3 ที่" ข้างบนเป็นข้อมูลเก่าแล้ว — 0127 เพิ่ม
-- ชั้นที่ 4 (analytics.oem_metal_price_set รับค่า silver ตรงจากหน้า
-- /oem/rates โดยไม่เคยผ่าน bound นี้มาก่อน — S1 ใน 0127's header) และแก้บั๊ก
-- B1/S2/S3 ที่พบในสองฟังก์ชันข้างล่างนี้ด้วย ดู 0127 สำหรับรายละเอียดครบ.
--
-- 15.244: ยังใช้ค่าคงที่นี้ต่อ (ยืนยันซ้ำจาก 0125 — grep "15.2" ทั้ง repo แล้ว
-- นี่คือค่าที่ระบบใช้คำนวณจริง lib/oem/display.ts มี 15.24 อยู่ด้วยแต่นั่นคือ
-- เวอร์ชันปัดสำหรับ "แสดงผล" ให้ลูกค้าดูเท่านั้น ไม่ใช่ค่าที่ใช้คำนวณ).
--
-- ============================================================================
-- 1. Trigger — เพิ่ม sanity bound (H1) + "manual ชนะทั้งวัน ทั้ง 2 ตาราง" (M1,
--    ตัดสินหลัง dry-run 17 ก.ย. 69) + shop_setting.updated_at ตามด้วย (M1).
-- ============================================================================

create or replace function analytics.silver_spot_sync_from_history()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_per_gram numeric;
  v_as_of_date date;
  v_manual_exists boolean;
begin
  if new.silver_value_per_baht is null then
    return new;
  end if;

  v_as_of_date := (new.captured_at at time zone 'Asia/Bangkok')::date;

  -- M1: "manual ชนะทั้งวัน ทั้ง 2 ตาราง" — ถ้าเจ้าของกรอกมือให้วันนี้แล้ว
  -- (ผ่าน shop_setting_upsert, H2(ก) ข้างล่าง, เขียน oem_metal_price
  -- source='manual') ห้าม capture จากชีตรอบถัดไปในวันเดียวกันแตะทั้ง
  -- shop_setting และ oem_metal_price เลย เช็คตรงนี้ก่อนเขียนอะไรทั้งสิ้น —
  -- ตั้งใจไม่มีทางออกอัตโนมัติให้ชีต "กลับมาชนะ" ในวันเดียวกัน (เจ้าของกรอก
  -- ผิดตอนเช้าแล้วอยากให้ชีตทับตอนบ่าย -> ให้กรอกมือแก้ใหม่ ไม่ต้องรอชีต —
  -- Tech Lead ยืนยัน 17 ก.ย. 69) ข้ามวันแล้ว as_of_date เปลี่ยน เงื่อนไขนี้
  -- เป็น false เองโดยธรรมชาติ ไม่ต้องมี cron ไปเคลียร์อะไร.
  select exists (
    select 1 from analytics.oem_metal_price
    where shop_id = new.shop_id and metal = 'silver' and as_of_date = v_as_of_date and source = 'manual'
  ) into v_manual_exists;

  if v_manual_exists then
    raise notice 'silver_spot_sync_from_history: shop_id=% มี manual entry ของวัน % อยู่แล้ว — ข้าม sync ทั้ง shop_setting และ oem_metal_price (manual ชนะทั้งวัน)',
      new.shop_id, v_as_of_date;
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
    -- กัน capture เก่ากว่ามาถึงทีหลัง (retry/backfill ย้อนหลัง) ทับราคาสด
    -- ล่าสุดด้วยราคาเก่ากว่า — เรื่องลำดับเวลาของ capture เอง ไม่เกี่ยวกับ
    -- manual/sheet (การกัน manual ทำไปแล้วข้างบนก่อนถึงบรรทัดนี้).
    where ss.silver_spot_updated_at is null or new.captured_at >= ss.silver_spot_updated_at;

  insert into analytics.oem_metal_price as omp (
    shop_id, metal, as_of_date, price_thb_per_gram, source, updated_by, updated_at
  )
  values (
    new.shop_id, 'silver', v_as_of_date,
    v_per_gram, 'sheet', null, now()
  )
  on conflict (shop_id, metal, as_of_date) do update
    set price_thb_per_gram = v_per_gram,
        source             = 'sheet',
        updated_by         = null,  -- เจ้าของไม่ได้เป็นคนยืนยันราคาจากชีต
        updated_at         = now()
    -- belt-and-braces: ด่านหลักคือ v_manual_exists ข้างบนแล้ว (กันไปตั้งแต่
    -- ก่อน insert ก้อนนี้) WHERE นี้เผื่อ race หายาก (สอง capture/manual
    -- เขียนพร้อมกันข้าม transaction ระหว่างที่ select exists ข้างบนอ่านไป
    -- แล้วแต่ยังไม่ถึงบรรทัดนี้) ไม่มีต้นทุนเพิ่มที่ต้องเสีย จึงเก็บไว้.
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
-- ลำดับเคสตั้งใจ C -> A -> B (ไม่ใช่ C -> B -> A): A ต้องรันตอนที่ยังไม่มี
-- manual entry ของวันนี้เลย ไม่งั้น manual-guard (M1) จะกันไปก่อนถึง H1 bound
-- check จริง แล้วเคส A จะ "ผ่าน" ด้วยเหตุผลผิด (ดักที่ manual-guard ไม่ใช่
-- H1) — เรียง B ไว้ท้ายสุดเพราะมันสร้าง manual entry ค้างไว้.
--
-- do $$
-- declare
--   v_log text := E'\n=== ผลทดสอบ 0126 ===\n';
--   v_shop_id uuid := '<SHOP_ID>';
--   v_today date := (now() at time zone 'Asia/Bangkok')::date;
--   v_oem numeric;
--   v_ss numeric;
--   v_ss_before numeric;
--   v_oem_before numeric;
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
--   -- (ก) silver_value_per_baht = 152,440 -> ~10,000/ก. นอกช่วง 5-500 ต้อง
--   -- ไม่ sync เลย (รันก่อนเคส B ตั้งใจ — ตอนนี้ยังไม่มี manual entry ของ
--   -- วันนี้ ดังนั้นถ้า state ไม่ขยับ แปลว่า H1 bound check เป็นคนกันจริง
--   -- ไม่ใช่ manual-guard บังเอิญกันแทน) ทั้ง shop_setting และ oem_metal_price
--   -- ต้องไม่ขยับจากค่าก่อนหน้า.
--   select silver_spot_thb_per_gram into v_ss_before from analytics.shop_setting where shop_id = v_shop_id;
--   select price_thb_per_gram into v_oem_before from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   insert into analytics.silver_price_history (shop_id, sheet_row_hash, silver_value_per_baht, captured_at)
--   values (v_shop_id, 'dry-run-0126-a-' || gen_random_uuid()::text, 152440, now());
--   select silver_spot_thb_per_gram into v_ss from analytics.shop_setting where shop_id = v_shop_id;
--   select price_thb_per_gram into v_oem from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   if v_ss is not distinct from v_ss_before and v_oem is not distinct from v_oem_before then
--     v_log := v_log || 'A นอกช่วง 5-500: OK (shop_setting/oem_metal_price ไม่ขยับ, ดู server log หา WARNING คู่กัน)\n';
--   else
--     v_log := v_log || format('A นอกช่วง 5-500: FAIL (shop_setting %s->%s, oem_metal_price %s->%s)\n', v_ss_before, v_ss, v_oem_before, v_oem);
--   end if;
--
--   -- (ข) manual 70 แล้ว sheet capture เข้าวันเดียวกัน -> "manual ชนะทั้งวัน
--   -- ทั้ง 2 ตาราง" (M1 หลัง dry-run 17 ก.ย. 69) ทั้ง oem_metal_price และ
--   -- shop_setting ต้องคง 70 (ไม่ใช่แค่ oem_metal_price เหมือนดีไซน์แรก)
--   perform analytics.shop_setting_upsert(v_shop_id, 70, null, null);
--   insert into analytics.silver_price_history (shop_id, sheet_row_hash, silver_value_per_baht, captured_at)
--   values (v_shop_id, 'dry-run-0126-b-' || gen_random_uuid()::text, 1000, now()); -- -> 65.5996/ก. ถ้า sync ได้ (ไม่ควร sync)
--   select price_thb_per_gram into v_oem from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   select silver_spot_thb_per_gram into v_ss from analytics.shop_setting where shop_id = v_shop_id;
--   if v_oem = 70 and v_ss = 70 then
--     v_log := v_log || 'B manual ชนะทั้ง 2 ตาราง: OK (oem_metal_price=70, shop_setting=70)\n';
--   else
--     v_log := v_log || format('B manual ชนะทั้ง 2 ตาราง: FAIL (oem_metal_price=%s, shop_setting=%s)\n', v_oem, v_ss);
--   end if;
--
--   raise exception '%', v_log; -- บังคับ rollback ทั้งก้อน — DB ไม่ขยับจริง
-- end $$;
-- ============================================================================

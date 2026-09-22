-- 0129_oem_metal_price_set_manual_guard.sql
--
-- 🔴 APPLIED ไปแล้ว — ห้าม apply ซ้ำ
--    version 20260917082918 · ลง production (udqmamplbymxnknkjnkz) 17 ก.ย. 69
--    ไฟล์นี้มีไว้ให้ประวัติ migration ในรีโปครบ ไม่ใช่ของที่รอลง
--
-- ═══ ไฟล์นี้ถูกกู้ย้อนหลัง 23 ก.ย. 69 ═══
--
-- ทำไมถึงต้องกู้: 0129 ถูก apply ลง DB จริงตั้งแต่ 17 ก.ย. แต่ไฟล์ไม่เคยเข้า
-- รีโปเลย (ไม่มีในบรานช์ไหนที่ยังมีชีวิต) ⇒ ใครสร้าง DB ใหม่จาก migration
-- ทั้งชุด (staging / branch DB / restore) จะได้สถานะ **ไม่ตรงกับ production**
-- คือขาดด่าน S2 ด้านล่าง โดยไม่มีอะไรบอกว่าขาด — บทเรียนเดียวกับ 0107-0109
-- (memory "migrations-0107-0109-off-main") แต่หนักกว่า เพราะรอบนั้นไฟล์แค่ค้าง
-- นอก main ส่วนรอบนี้ไฟล์หายจากรีโปสนิท
--
-- กู้มาจากไหน: `supabase_migrations.schema_migrations.statements` ของ version
-- 20260917082918 บน DB จริง — คือ SQL ที่ถูกส่งเข้า DB ตอน apply จริงๆ ⇒ เป็น
-- แหล่งที่ถูกต้องที่สุด DDL ทั้งสองก้อนด้านล่างคัดลอกมา **คำต่อคำ** ไม่แก้แม้แต่
-- คอมเมนต์ (พิสูจน์ด้วยการซ้อมรันแล้ว — ดู "การพิสูจน์" ท้ายหัวไฟล์)
--
-- ⚠️ อย่าเอา draft ที่ commit c07d07a มาใช้แทนไฟล์นี้: ต้นฉบับที่คนเขียนไว้
-- (commit c07d07a "fix(0129): oem_metal_price_set manual guard — round 3
-- review", บรานช์ fix/silver-spot-round3 ที่ไม่เคย merge/push และตอนนี้
-- unreachable) ยาว 31,490 ตัวอักษร มีคอมเมนต์อธิบายยาวกว่านี้มาก + dry-run
-- block D1-D5/E1-E8 แต่ตอน apply จริงมีการย่อคอมเมนต์ในตัวฟังก์ชันลง ⇒ body
-- ที่อยู่บน production ตรงกับ "ฉบับย่อ" ที่อยู่ในไฟล์นี้ ไม่ตรงกับ draft นั้น
-- (ต่างกันเฉพาะคอมเมนต์ ตรรกะเหมือนกันทุกบรรทัด) ถ้าเอา draft มาใช้ replay จะ
-- ได้ฟังก์ชันที่ "เหมือนแต่ไม่เท่า" ของจริง
--
-- ═══ 0129 ทำอะไร (2 ฟังก์ชัน ไม่ใช่ตัวเดียวอย่างที่ชื่อไฟล์บอก) ═══
--
--   1. analytics.silver_spot_sync_from_history()  [trigger]
--      Nit 1: captured_at ที่ตกเป็นวันไทย "หลังวันนี้" = clock skew ของเครื่อง
--      ที่รัน capture script ไม่ใช่ backfill จริง — แยกเป็น `elsif
--      v_as_of_date > v_today` warning แล้วไม่ sync แทนที่จะไหลลง else
--      (backdated) แล้วสร้างแถว "พรุ่งนี้" ที่ไม่มีใครในระบบรออ่าน
--
--   2. analytics.oem_metal_price_set(uuid, text, numeric, date, text)
--      S2 (ของจริงตามชื่อไฟล์): RPC ตัวนี้ไม่เคยมีด่าน "manual ชนะทั้งวัน"
--      แบบที่ trigger มี (0126/0127) ⇒ คนเรียกที่ส่ง source='sheet'/'feed'
--      ทับ manual entry ของวันเดียวกันได้เงียบๆ = ประตูหลังของด่านที่ 0127
--      อุดไว้ฝั่ง trigger. เช็คหลังจับ advisory lock แล้ว raise ถ้ามี manual
--      ของ as_of_date นั้นอยู่ — scope ด้วย v_as_of ไม่ใช่ v_today ⇒ คุ้ม
--      manual ที่ย้อนวันด้วย ไม่ใช่แค่ของวันนี้
--      Nit 2: mirror-insert ลง shop_setting เลิก hardcode 0.20/0.50 ให้
--      blended_margin_pct/target_ad_gp_share — ใช้ column default จริงของ
--      ตาราง (0028) แทน จะได้ไม่มีสำเนาเลขชุดที่สองไว้เพี้ยนทีหลัง
--
--   ทั้งคู่เป็น `create or replace` บน signature เดิม ไม่ใช่ overload ใหม่
--   (3j-migration-traps ข้อ 1)
--
-- ═══ 🔴 จุดเดียวที่ไฟล์นี้ "ไม่" ตรงกับของที่ apply ไป — grant ═══
--
-- ของที่ apply จริงเมื่อ 17 ก.ย. บรรทัดสุดท้ายเป็น:
--     grant execute on function analytics.oem_metal_price_set(...)
--       to authenticated, service_role;
-- ไฟล์นี้เขียนเป็น `to service_role;` อย่างเดียว — **ตั้งใจเปลี่ยน**
-- เหตุผล: บรรทัดนั้นคือ boilerplate ที่ลอกต่อกันมา (3j-migration-traps ข้อ 2
-- ฉบับเก่า) และมันคือตัวที่ grant `authenticated` กลับเข้ามาหลัง 0123 revoke
-- ไปแล้ว — 0147_revoke_legacy_grants.sql (รอ apply) มีหน้าที่ถอนมันออก ถ้า
-- ไฟล์นี้ลอกของเดิมมา ปลายทางของ replay จะเป็น "เปิด" แล้ว 0147 ต้องตามปิด
-- ทีหลัง เขียน service_role อย่างเดียวตั้งแต่ต้น ⇒ replay ได้ปลายทางเดียวกับ
-- 0147 ไม่ว่าจะรันถึง 0147 หรือไม่ (3j-migration-traps ข้อ 18)
--
-- ⚠️ หัวไฟล์ 0147 ไล่ที่มาของ grant ตัวนี้ไว้ว่า "0127:353 · 0128:420" —
-- **ตกไฟล์นี้ไป** เพราะตอนตรวจ (22 ก.ย.) ไล่จากไฟล์ในรีโป ซึ่งตอนนั้นไม่มี
-- 0129 ที่มาล่าสุดจริงๆ ของ `authenticated=X/postgres` บน
-- oem_metal_price_set คือบรรทัด grant ของ 0129 นี้ (17 ก.ย. 08:29 ซึ่งมา
-- หลัง 0128 ที่ 08:12) ไม่ใช่ 0128 — ข้อสรุปของ 0147 ไม่เปลี่ยน (ยังต้อง
-- revoke อยู่ดี) แต่บรรทัดที่อ้างถึงคลาดเคลื่อน
--
-- ส่วน revoke ของ silver_spot_sync_from_history() ไม่แตะ — ของเดิมไม่มี grant
-- คืนอยู่แล้ว (trigger function ไม่ต้องมีใคร execute ตรง)
--
-- ═══ การพิสูจน์ (23 ก.ย. 69) ═══
--
--   1. node scripts/run-sql.mjs supabase/migrations/0129_oem_metal_price_set_manual_guard.sql
--      (โหมดซ้อม ROLLBACK เสมอ — ไม่ใส่ --commit) ผ่าน ไม่มี error
--
--   2. เทียบ md5(pg_get_functiondef) ก่อน/หลัง ในทรานแซกชันเดียวกัน:
--      • analytics.oem_metal_price_set(uuid,text,numeric,date,text)
--        → ✅ ตรงกันเป๊ะ (860364d93dc87079e599760ac3b4af41) ด้วยไฟล์นี้ไฟล์เดียว
--      • analytics.silver_spot_sync_from_history()
--        → ❗ รันไฟล์นี้ไฟล์เดียว **ไม่ตรง** — และนั่นถูกต้องแล้ว: 0134
--          (silver_bar_cost_from_kilo_price ลง 18 ก.ย.) replace ฟังก์ชันนี้
--          ทับอีกรอบ "หลัง" 0129 ⇒ ของที่อยู่บน production ตอนนี้เป็นของ
--          0134 ไม่ใช่ของ 0129 · ซ้อม replay ตามลำดับจริง 0129 → 0134
--          → ✅ ตรงกันเป๊ะ (a14175ef8776133aaf6353eba2e1bf37)
--      • ไม่มี signature เกิดใหม่หรือหายไป (ไม่มี overload หลุด)
--
--   🔴 กับดักที่เจอระหว่างพิสูจน์ (ไม่ได้แก้ในไฟล์นี้ — เป็นปัญหาระดับรีโป):
--   ไฟล์นี้ใช้ line ending เป็น LF ตั้งใจ ไม่ใช่ CRLF · รีโปตั้ง
--   core.autocrlf=true ⇒ blob เก็บ LF แต่เช็คเอาต์ออกมาเป็น CRLF ⇒ ถ้าเอาไฟล์
--   .sql จาก working tree ไป replay ตรงๆ \r จะติดเข้าไปใน body ระหว่าง
--   $$...$$ ทำให้ฟังก์ชันที่ได้ "เหมือนแต่ไม่เท่า" ของบน production —
--   พิสูจน์แล้วจริงในรอบนี้: 0134 จาก working tree (มี \r 184 ตัว) ให้ md5
--   ไม่ตรง แต่พอแปลงเป็น LF ก่อน (sed 's/\r$//') แล้วตรงทันที ⇒ ใครจะ
--   rebuild DB จาก migration ทั้งชุดบน Windows ต้องแปลงเป็น LF ก่อนเสมอ
--
-- ═══ หนี้ที่รู้ตัวและ "ไม่" ได้อยู่ในไฟล์นี้ ═══
-- commit c07d07a ที่หายไปมีการแก้ฝั่ง TypeScript ติดมาด้วย 4 ไฟล์ ซึ่ง
-- **ไม่เคยขึ้น main เหมือนกัน** และยังไม่ได้กู้ในรอบนี้ (เป็นงานคนละก้อน
-- ต้องผ่าน review/QA ของมันเอง) — สรุปไว้ในรายงานส่งมอบของบรานช์
-- fix/restore-0129


create or replace function analytics.silver_spot_sync_from_history()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_per_gram numeric;
  v_as_of_date date;
  v_today date;
  v_last_updated timestamptz;
  v_manual_exists boolean;
begin
  if new.silver_value_per_baht is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('silver_spot:' || new.shop_id::text, 0));

  v_per_gram := round(new.silver_value_per_baht / 15.244, 4);

  if not (v_per_gram >= 5 and v_per_gram <= 500) then
    raise warning 'silver_spot_sync_from_history: silver_value_per_baht=% -> %/ก. นอกช่วง 5–500 ไม่ sync (shop_id=%, captured_at=%)',
      new.silver_value_per_baht, v_per_gram, new.shop_id, new.captured_at;
    return new;
  end if;

  v_as_of_date := (new.captured_at at time zone 'Asia/Bangkok')::date;
  v_today := (now() at time zone 'Asia/Bangkok')::date;

  if v_as_of_date = v_today then
    select ss.silver_spot_updated_at into v_last_updated
    from analytics.shop_setting ss where ss.shop_id = new.shop_id;

    if v_last_updated is not null and new.captured_at < v_last_updated then
      raise notice 'silver_spot_sync_from_history: captured_at=% เก่ากว่า silver_spot_updated_at=% ที่มีอยู่ (shop_id=%) — ข้าม sync ทั้ง 2 ตาราง (retry/backfill มาไม่เรียงลำดับ)',
        new.captured_at, v_last_updated, new.shop_id;
      return new;
    end if;

    select exists (
      select 1 from analytics.oem_metal_price
      where shop_id = new.shop_id and metal = 'silver' and as_of_date = v_as_of_date and source = 'manual'
    ) into v_manual_exists;

    if v_manual_exists then
      raise notice 'silver_spot_sync_from_history: shop_id=% มี manual entry ของวัน % อยู่แล้ว — ข้าม sync ทั้ง shop_setting และ oem_metal_price (manual ชนะทั้งวัน)',
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
    values (
      new.shop_id, 'silver', v_as_of_date,
      v_per_gram, 'sheet', null, now()
    )
    on conflict (shop_id, metal, as_of_date) do update
      set price_thb_per_gram = v_per_gram,
          source             = 'sheet',
          updated_by         = null,
          updated_at         = now()
      where omp.source <> 'manual';
  elsif v_as_of_date > v_today then
    -- Nit 1: captured_at ในอนาคต = clock skew — ไม่สร้างแถว "พรุ่งนี้"
    raise warning 'silver_spot_sync_from_history: captured_at=% -> as_of_date=% อยู่ในอนาคต (วันนี้ไทย=%, shop_id=%) — ไม่ sync (ตรวจนาฬิกาเครื่องที่รัน capture script)',
      new.captured_at, v_as_of_date, v_today, new.shop_id;
    return new;
  else
    -- Backdated: เขียนเฉพาะ oem_metal_price ของวันนั้น ไม่แตะ shop_setting ไม่ทับ manual
    -- หนี้ (Nit 3): ยังไม่กัน out-of-order ของ 2 แถวในวันเดียวกันในอดีต
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
          updated_by         = null,
          updated_at         = now()
      where omp.source <> 'manual';
  end if;

  return new;
end;
$$;

revoke execute on function analytics.silver_spot_sync_from_history() from public, anon, authenticated;

create or replace function analytics.oem_metal_price_set(
  p_shop_id uuid,
  p_metal text,
  p_price numeric,
  p_as_of date default null,
  p_source text default 'manual'
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_today date;
  v_as_of date;
begin
  if p_shop_id is null or p_metal is null or p_price is null then
    raise exception 'oem_metal_price_set: p_shop_id, p_metal, p_price are required';
  end if;
  if p_metal not in ('silver', 'gold', 'brass') then
    raise exception 'oem_metal_price_set: p_metal must be silver/gold/brass';
  end if;

  if p_metal = 'silver' then
    if not (p_price >= 5 and p_price <= 500) then
      raise exception 'oem_metal_price_set: p_price must be between 5 and 500 (ต่อกรัม ไม่ใช่ต่อบาท — 1 บาท = 15.244 กรัม)';
    end if;
  else
    if not (p_price > 0) then
      raise exception 'oem_metal_price_set: p_price must be > 0';
    end if;
  end if;

  if p_source not in ('manual', 'feed', 'sheet') then
    raise exception 'oem_metal_price_set: p_source must be manual/feed/sheet';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  v_today := (now() at time zone 'Asia/Bangkok')::date;
  v_as_of := coalesce(p_as_of, v_today);

  if p_metal = 'silver' then
    perform pg_advisory_xact_lock(hashtextextended('silver_spot:' || p_shop_id::text, 0));

    -- S2: source ที่ไม่ใช่ manual ห้ามทับ manual ของวันเดียวกัน (manual ชนะทั้งวัน)
    if p_source <> 'manual' and exists (
      select 1 from analytics.oem_metal_price
      where shop_id = p_shop_id and metal = 'silver' and as_of_date = v_as_of and source = 'manual'
    ) then
      raise exception 'oem_metal_price_set: shop_id=% มี manual entry ของวัน % อยู่แล้ว — manual ชนะทั้งวัน ไม่ให้ source=% ทับ',
        p_shop_id, v_as_of, p_source;
    end if;
  end if;

  insert into analytics.oem_metal_price (shop_id, metal, as_of_date, price_thb_per_gram, source, updated_by, updated_at)
  values (p_shop_id, p_metal, v_as_of, p_price, p_source, auth.uid(), now())
  on conflict (shop_id, metal, as_of_date) do update set
    price_thb_per_gram = excluded.price_thb_per_gram, source = excluded.source,
    updated_by = auth.uid(), updated_at = now();

  if p_metal = 'silver' and v_as_of = v_today then
    -- Nit 2: ใช้ column default ของ blended_margin_pct/target_ad_gp_share
    insert into analytics.shop_setting as ss (
      shop_id, silver_spot_thb_per_gram, silver_spot_updated_at, updated_by, updated_at
    ) values (
      p_shop_id, p_price, now(), null, now()
    )
    on conflict (shop_id) do update set
      silver_spot_thb_per_gram = p_price,
      silver_spot_updated_at   = now(),
      updated_at               = now(),
      updated_by               = null;
  end if;
end;
$$;

revoke execute on function analytics.oem_metal_price_set(uuid, text, numeric, date, text) from public, anon, authenticated;
grant execute on function analytics.oem_metal_price_set(uuid, text, numeric, date, text) to service_role;

notify pgrst, 'reload schema';

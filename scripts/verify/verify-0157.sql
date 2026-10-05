-- scripts/verify-0157.sql
-- ตรวจ supabase/migrations/0157_gem_quiz_v2_five_stones.sql หลัง apply
-- (ตามรูปแบบ "self-rolling-back do-block" ของ skill 3j-migration-traps #11/
-- supabase-migrate: ทุกเคสเก็บผลลง v_log แล้ว raise exception ปิดท้ายเสมอ —
-- exception บังคับ rollback ทั้ง transaction อัตโนมัติ ไม่มีแถวทดสอบค้างใน DB
-- ไม่ว่าผลจะ PASS หรือ FAIL)
--
-- รันด้วย: node scripts/run-sql.mjs scripts/verify-0157.sql   (ไม่ใส่ --commit
-- — สคริปต์นี้ raise exception เองอยู่แล้วเพื่อบังคับ rollback แต่ run-sql.mjs
-- ก็ ROLLBACK ให้เสมอเมื่อไม่มี --commit เป็นเกราะอีกชั้น)
--
-- ⚠️ ก่อน/หลังรันสคริปต์นี้ ให้ตรวจเพิ่มด้วยมือ (trap #11: "อย่าเชื่อว่า
-- rollback เอง"):
--   select count(*) from analytics.gem_quiz_response;
-- ค่าต้องเท่ากันทั้งก่อนและหลัง (T5 insert 1 แถวชั่วคราวภายในทรานแซกชันนี้
-- เท่านั้น ไม่เคย COMMIT)
--
-- 🔴 ข้อจำกัดของ T10 (md5 ของ gem_quiz_submit): สคริปต์นี้พิสูจน์ได้แค่ว่า
-- "ระหว่างที่สคริปต์นี้รัน ไม่มีอะไรไปแก้ gem_quiz_submit" — ไม่สามารถพิสูจน์ว่า
-- "migration 0157 ไม่ได้แก้ submit เทียบกับก่อน apply" เพราะสคริปต์นี้รัน
-- *หลัง* apply ไปแล้วเสมอ ไม่มี baseline ของตัวเองก่อนหน้านั้น — ด่านนั้นต้องทำ
-- แยกโดย devops ตามคอมเมนต์หัวไฟล์ 0157 (จับ md5 ก่อน apply ไว้ก่อน แล้วเทียบ
-- กับค่าที่ T10 พิมพ์ออกมาใน v_log ของรอบนี้)
do $verify0157$
declare
  v_log text := E'\n=== verify-0157 ===\n';
  v_shop_id uuid;
  v_submit_md5_before text;
  v_submit_md5_after text;
  v_stats_overload_count int;
  v_inactive_count int;
begin
  select id into v_shop_id from public.shop limit 1;
  if v_shop_id is null then
    raise exception 'verify-0157: ไม่พบแถวใน public.shop เลย — ทดสอบไม่ได้ (ไม่ใช่ความผิดของ migration, เตรียม shop ตัวอย่างก่อน)';
  end if;

  v_submit_md5_before := md5(pg_get_functiondef(
    'analytics.gem_quiz_submit(uuid, smallint, text, text[], jsonb, text[], boolean)'::regprocedure
  ));

  -- T1: 7 พลอยที่ประกาศเลิกใช้ ต้อง is_active=false ครบทุกตัว
  select count(*) into v_inactive_count
  from analytics.gem_quiz_stone
  where code in ('pearl', 'nil', 'ruby', 'sapphire', 'busarakham', 'iolite', 'kyanite')
    and not is_active;
  if v_inactive_count = 7 then
    v_log := v_log || 'T1 OK: 7 พลอยปิดจริง (is_active=false)' || E'\n';
  else
    v_log := v_log || format('T1 FAIL: พบ %s/7 ที่ปิดจริง (คาดว่าต้องครบ 7)', v_inactive_count) || E'\n';
  end if;

  -- T2: 5 พลอยที่เหลือต้อง active ครบ + sort_order/label ตรง gemOrder
  if (
    select count(*) from analytics.gem_quiz_stone
    where code in ('garnet', 'amethyst', 'citrine', 'peridot', 'blue_topaz') and is_active
  ) = 5 then
    v_log := v_log || 'T2 OK: 5 พลอยที่เหลือ active ครบ' || E'\n';
  else
    v_log := v_log || 'T2 FAIL: พลอยที่ควร active ไม่ครบ 5' || E'\n';
  end if;

  if (select sort_order from analytics.gem_quiz_stone where code = 'garnet') = 10
     and (select sort_order from analytics.gem_quiz_stone where code = 'amethyst') = 20
     and (select sort_order from analytics.gem_quiz_stone where code = 'citrine') = 30
     and (select sort_order from analytics.gem_quiz_stone where code = 'peridot') = 40
     and (select sort_order from analytics.gem_quiz_stone where code = 'blue_topaz') = 50
     and (select label_th from analytics.gem_quiz_stone where code = 'amethyst') = 'อเมทิสต์'
  then
    v_log := v_log || 'T3 OK: sort_order ตาม gemOrder ของแพ็กเกจ + label อเมทิสต์ ถูกต้อง' || E'\n';
  else
    v_log := v_log || 'T3 FAIL: sort_order/label ไม่ตรงกับที่ migration ควรเซ็ต' || E'\n';
  end if;

  -- T4: liked มี code ที่ปิดแล้ว (ruby) ผ่าน gem_quiz_submit ⇒ ต้องถูกปฏิเสธด้วย 22023
  -- 🔴 2::smallint — bare integer literal ไม่ cast เองในบริบท function call
  -- (int4→int2 เป็น assignment cast ไม่ใช่ implicit cast) พลาดจุดเดียวกับที่เคย
  -- แก้ไปแล้วใน verify-0154.sql รอบที่แล้ว (memory: Postgres gotchas)
  begin
    perform analytics.gem_quiz_submit(
      v_shop_id, 2::smallint, 'direct',
      array['ruby'],
      '{"birth_day":"sun","intention":"career","feeling":"energy","jewelry_type":"ring"}'::jsonb,
      array['garnet'], false
    );
    v_log := v_log || 'T4 FAIL: liked=[ruby] (พลอยปิดแล้ว) ผ่านทั้งที่ควรถูกปฏิเสธ' || E'\n';
  exception
    when sqlstate '22023' then
      v_log := v_log || 'T4 OK: liked=[ruby] ถูกปฏิเสธด้วย 22023 ตามที่คาด' || E'\n';
    when others then
      v_log := v_log || format('T4 FAIL: ถูกปฏิเสธด้วย errcode อื่นที่ไม่คาดคิด: %s / %s', sqlstate, sqlerrm) || E'\n';
  end;

  -- T5: insert ด้วย 5 พลอยที่เหลือ + answer key v2 ครบ ⇒ ต้องสำเร็จ (แถวนี้อยู่
  -- ในทรานแซกชันนี้เท่านั้น — ถูก rollback ทิ้งท้ายสุดของสคริปต์ ไม่เคย commit)
  declare
    v_count_before int;
    v_count_after int;
  begin
    select count(*) into v_count_before from analytics.gem_quiz_response where shop_id = v_shop_id;
    perform analytics.gem_quiz_submit(
      v_shop_id, 2::smallint, 'direct',
      array['garnet', 'citrine'],
      '{"birth_day":"sun","intention":"career","feeling":"energy","jewelry_type":"ring"}'::jsonb,
      array['garnet'], false
    );
    select count(*) into v_count_after from analytics.gem_quiz_response where shop_id = v_shop_id;
    if v_count_after = v_count_before + 1 then
      v_log := v_log || 'T5 OK: insert ด้วย 5 พลอยที่เหลือ + answer key v2 ครบ ⇒ สำเร็จ (1 แถวใหม่ชั่วคราว)' || E'\n';
    else
      v_log := v_log || format('T5 FAIL: จำนวนแถวก่อน/หลังไม่ตรงที่คาด (%s -> %s)', v_count_before, v_count_after) || E'\n';
    end if;
  exception
    when others then
      v_log := v_log || format('T5 FAIL: insert ที่ควรสำเร็จกลับถูกปฏิเสธ: %s / %s', sqlstate, sqlerrm) || E'\n';
  end;

  -- T6: ยืนยันว่า DB เองไม่ได้ผูก key ตายตัว (design doc §3.2: "DB (answers
  -- cap/regex/512B): ไม่แก้" — ด่าน "answers ต้องมีครบ 4 key" อยู่ที่ validate.ts
  -- ฝั่ง TS เท่านั้น ไม่ใช่ gem_quiz_submit) — ส่ง answers ที่มี key เดียวเข้า RPC
  -- ตรงๆ ต้องยังผ่านด่าน DB ได้ (เพื่อพิสูจน์ว่า submit ไม่ถูกแก้ให้เข้มขึ้น)
  begin
    perform analytics.gem_quiz_submit(
      v_shop_id, 2::smallint, 'direct',
      array['garnet'],
      '{"birth_day":"sun"}'::jsonb,
      array['garnet'], false
    );
    v_log := v_log || 'T6 OK: DB ไม่ผูก key ตายตัว (ด่าน "answers ครบ 4 key" อยู่ที่ validate.ts ฝั่ง TS เท่านั้น)' || E'\n';
  exception
    when others then
      v_log := v_log || format('T6 FAIL: DB ปฏิเสธ answers key เดียว ทั้งที่ design doc สั่งห้ามแก้ด่านนี้: %s / %s', sqlstate, sqlerrm) || E'\n';
  end;

  -- T7: gem_quiz_stats มี overload เดียว (create or replace ไม่ได้สร้างฟังก์ชัน
  -- ใหม่ซ้อน signature เดิม — 3j-migration-traps #1)
  select count(*) into v_stats_overload_count
  from pg_proc
  where pronamespace = 'analytics'::regnamespace and proname = 'gem_quiz_stats';
  if v_stats_overload_count = 1 then
    v_log := v_log || 'T7 OK: gem_quiz_stats มี overload เดียว' || E'\n';
  else
    v_log := v_log || format('T7 FAIL: gem_quiz_stats มี %s overload (คาดว่าต้องมี 1) — ตรวจ pg_get_function_identity_arguments', v_stats_overload_count) || E'\n';
  end if;

  -- T8: gem_quiz_stats เรียกได้จริงและคืน liked_first/daily_breakdown ตามที่ 0157 เพิ่ม
  -- 🔴 crm_require_owner_admin เช็ค auth.role() = 'service_role' — auth.role()
  -- อ่านจาก GUC request.jwt.claim.role (ของจริงมาจาก JWT ที่ PostgREST ถอดให้)
  -- ไม่ใช่ Postgres session role เลย (`set local role` เปลี่ยนคนละอย่าง ไม่มีผล
  -- กับ auth.role() — ยืนยันจาก pg_get_functiondef('auth.role()') สดแล้ว) ต้องตั้ง
  -- GUC นี้ตรงๆ เพื่อจำลองว่าถูกเรียกผ่าน service-role client เหมือนของจริง
  declare
    v_stats jsonb;
  begin
    set local request.jwt.claim.role = 'service_role';
    v_stats := analytics.gem_quiz_stats(v_shop_id, current_date - 1, current_date + 1, true);
    if v_stats ? 'liked_first' and v_stats ? 'daily_breakdown' then
      v_log := v_log || 'T8 OK: gem_quiz_stats (as service_role) คืน liked_first + daily_breakdown' || E'\n';
    else
      v_log := v_log || 'T8 FAIL: ไม่พบ liked_first/daily_breakdown ใน jsonb ที่คืน' || E'\n';
    end if;
  exception
    when others then
      v_log := v_log || format('T8 FAIL: เรียก gem_quiz_stats แล้ว error: %s / %s', sqlstate, sqlerrm) || E'\n';
  end;

  -- T9 / R-11 (3j-migration-traps #18.5): จำลองวันที่กำแพงชั้นนอก (schema
  -- usage) หลุดกลับไปให้ authenticated ชั่วคราว ภายในทรานแซกชันทดสอบนี้เท่านั้น
  -- — ต้องยังตกที่ 42501 permission denied เพราะด่านที่สองคือ grant ระดับ
  -- ฟังก์ชันเอง (revoke...from authenticated ใน 0157) ยังปิดอยู่เสมอ
  begin
    grant usage on schema analytics to authenticated;
    set local role authenticated;
    begin
      perform analytics.gem_quiz_stats(v_shop_id, current_date, current_date, true);
      v_log := v_log || 'T9/R-11 FAIL: authenticated เรียก gem_quiz_stats ผ่าน ทั้งที่ควรถูกบล็อกที่ชั้นฟังก์ชัน' || E'\n';
    exception
      when sqlstate '42501' then
        v_log := v_log || 'T9/R-11 OK: authenticated ยังถูกบล็อกด้วย 42501 แม้ schema usage หลุดกลับมาชั่วคราว' || E'\n';
      when others then
        v_log := v_log || format('T9/R-11 FAIL: ถูกบล็อกด้วย errcode อื่นที่ไม่คาดคิด: %s / %s', sqlstate, sqlerrm) || E'\n';
    end;
    reset role;
    revoke usage on schema analytics from authenticated;
  exception
    when others then
      reset role;
      v_log := v_log || format('T9/R-11 FAIL (setup/teardown error ของเทสต์เอง ไม่ใช่ของ gem_quiz_stats): %s / %s', sqlstate, sqlerrm) || E'\n';
  end;

  -- T10: md5 ของ gem_quiz_submit ไม่เปลี่ยนระหว่างที่สคริปต์นี้รัน (ดูข้อจำกัด
  -- ที่อธิบายไว้ในคอมเมนต์หัวไฟล์ — ด่าน "ไม่เปลี่ยนเทียบกับก่อน apply จริง"
  -- ต้องให้ devops ทำแยกด้วยค่าที่จับไว้ก่อน apply)
  v_submit_md5_after := md5(pg_get_functiondef(
    'analytics.gem_quiz_submit(uuid, smallint, text, text[], jsonb, text[], boolean)'::regprocedure
  ));
  if v_submit_md5_before = v_submit_md5_after then
    v_log := v_log || format('T10 OK: md5(gem_quiz_submit) ไม่เปลี่ยนระหว่างสคริปต์นี้รัน = %s', v_submit_md5_before) || E'\n';
  else
    v_log := v_log || 'T10 FAIL: md5(gem_quiz_submit) เปลี่ยนระหว่างสคริปต์นี้รัน — ตรวจด่วน มีอะไรแก้ submit อยู่' || E'\n';
  end if;

  v_log := v_log || E'\n=== จบการทดสอบ — raise exception ด้านล่างบังคับ ROLLBACK ทั้งหมด (T5 ไม่ถูก commit) ===\n';
  raise exception '%', v_log;
end;
$verify0157$;

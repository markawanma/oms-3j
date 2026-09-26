-- scripts/verify-0152.sql
-- ทดสอบ 0152_content_post_update_type_active_gate.sql — do-block + raise
-- exception บังคับ rollback เสมอ (3j-migration-traps #11) — ห้ามรันด้วย
-- --commit. รันเดี่ยวได้หลัง apply 0152 จริงแล้ว:
--   node scripts/run-sql.mjs scripts/verify-0152.sql
--
-- Fixture: content_type ชั่วคราว 1 แถว is_active=false (code ไม่ชนกับ 5 แถว
-- seed จริงของ 0145) + content_post ชั่วคราว 1 แถว (ประกอบเดียวกับ
-- verify-0151.sql) — ลบทิ้งเองก่อน raise ปิดท้าย และ raise เองก็บังคับ
-- rollback อีกชั้นอยู่แล้ว (สองชั้นตั้งใจ ไม่ใช่ซ้ำซ้อนเปล่าประโยชน์).
--
-- อ่านผลจาก NOTICE — นับ FAIL ด้วย: grep -cE ': FAIL'

do $verify0152$
declare
  v_log text := E'\n=== verify-0152 (content_post_update_type — is_active gate) ===\n';

  v_sig_count      int;
  v_sig_args       text;
  v_defaults_count int;

  v_real_shop_id    uuid;
  v_fixture_post_id uuid;

  v_reject_ok      boolean;
  v_sqlstate_got   text;
  v_msg_got        text;
  v_code_after     text;

  v_priv_anon          boolean;
  v_priv_authenticated boolean;
  v_priv_service_role  boolean;

  -- โค้ดชั่วคราวที่ไม่ชนกับ 5 แถว seed จริงของ 0145 (drive_live/knowledge/
  -- craft/customer/announce) — ตั้งชื่อให้ชัดว่าเป็นของทดสอบ ไม่ใช่ของจริง
  v_inactive_code constant text := '__verify0152_inactive__';
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- --------------------------------------------------------------------
  -- T1 — signature เดียว ไม่เกิด overload (create or replace ไม่เปลี่ยน arg
  -- list ⇒ ไม่ควรมี overload หลุด แต่ตรวจซ้ำเสมอตาม 3j-migration-traps #1)
  -- --------------------------------------------------------------------
  select count(*), string_agg(pg_get_function_identity_arguments(oid), '; '), sum(pronargdefaults)
  into v_sig_count, v_sig_args, v_defaults_count
  from pg_proc
  where pronamespace = 'analytics'::regnamespace and proname = 'content_post_update_type';

  if v_sig_count = 1 and v_sig_args = 'p_shop_id uuid, p_post_id uuid, p_content_type_code text' and v_defaults_count = 0 then
    v_log := v_log || 'T1 (signature เดียว, args ตรง, ไม่มี default): PASS' || E'\n';
  else
    v_log := v_log || format('T1: FAIL — count=%s args=%s defaults=%s', v_sig_count, v_sig_args, v_defaults_count) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- Setup
  -- --------------------------------------------------------------------
  select id into v_real_shop_id from public.shop order by id limit 1;
  if v_real_shop_id is null then
    v_log := v_log || 'SETUP: FAIL — ไม่พบ public.shop แม้แต่แถวเดียว ทดสอบต่อไม่ได้' || E'\n';
    raise exception '%', v_log;
  end if;

  insert into analytics.content_type (code, label_th, color_hex, sort_order, is_active)
  values (v_inactive_code, 'ทดสอบ 0152 (ปลดระวางแล้ว)', '#000000', 999, false);

  insert into analytics.content_post (
    shop_id, platform, external_id, post_url, posted_at, posted_date_th, content_type_code, status, updated_at
  ) values (
    v_real_shop_id, 'tiktok',
    'https://www.tiktok.com/@__verify0152_test__/video/900000000000000003',
    'https://www.tiktok.com/@__verify0152_test__/video/900000000000000003',
    now() - interval '1 day', ((now() - interval '1 day') at time zone 'Asia/Bangkok')::date,
    null, 'active', now() - interval '30 days'
  )
  returning id into v_fixture_post_id;

  -- --------------------------------------------------------------------
  -- T_gate_inactive — code ที่ is_active=false ต้องถูกปฏิเสธด้วย 22023,
  -- ข้อความต้องพูดถึง "ปลดระวางแล้ว" (ไม่ใช่แค่ "ไม่ถูกต้อง" แบบ 0151 เดิม),
  -- content_type_code ของ post ต้องไม่ขยับ (ยังเป็น null เหมือนตอนสร้าง)
  -- --------------------------------------------------------------------
  v_reject_ok := false;
  v_sqlstate_got := null;
  v_msg_got := null;
  begin
    perform analytics.content_post_update_type(v_real_shop_id, v_fixture_post_id, v_inactive_code);
  exception when others then
    v_reject_ok := true;
    get stacked diagnostics v_sqlstate_got = returned_sqlstate, v_msg_got = message_text;
  end;

  select cp.content_type_code into v_code_after from analytics.content_post cp where cp.id = v_fixture_post_id;

  if v_reject_ok and v_sqlstate_got = '22023' and v_msg_got like '%ปลดระวางแล้ว%' and v_code_after is null then
    v_log := v_log || 'T_gate_inactive (code ที่ is_active=false ถูกปฏิเสธด้วย 22023, ข้อความพูดถึงปลดระวาง, state ไม่ขยับ): PASS' || E'\n';
  else
    v_log := v_log || format('T_gate_inactive: FAIL — reject=%s sqlstate=%s msg=%s after=%s',
      v_reject_ok, coalesce(v_sqlstate_got, '(none)'), coalesce(v_msg_got, '(none)'), coalesce(v_code_after, '(null)')) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T_still_works_active — เคส "ห้ามพัง": code จริงที่ยัง is_active=true
  -- (seed จริงจาก 0145) ต้องยังตั้งค่าได้เหมือนก่อน 0152 ทุกอย่าง
  -- --------------------------------------------------------------------
  v_reject_ok := false;
  begin
    perform analytics.content_post_update_type(v_real_shop_id, v_fixture_post_id, 'craft');
  exception when others then
    v_reject_ok := true;
  end;

  select cp.content_type_code into v_code_after from analytics.content_post cp where cp.id = v_fixture_post_id;

  if not v_reject_ok and v_code_after = 'craft' then
    v_log := v_log || 'T_still_works_active (code จริงที่ยัง active ตั้งค่าได้ปกติ — ไม่พัง): PASS' || E'\n';
  else
    v_log := v_log || format('T_still_works_active: FAIL — reject=%s after=%s (คาด craft)', v_reject_ok, coalesce(v_code_after, '(null)')) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T7 — grant model ไม่เปลี่ยนจาก 0151 (create or replace ทำ grant หายทุก
  -- ครั้ง — ต้องเช็คว่า 0152 re-grant ครบจริง, 3j-migration-traps #2/#18)
  -- --------------------------------------------------------------------
  select has_function_privilege('anon', 'analytics.content_post_update_type(uuid,uuid,text)', 'execute') into v_priv_anon;
  select has_function_privilege('authenticated', 'analytics.content_post_update_type(uuid,uuid,text)', 'execute') into v_priv_authenticated;
  select has_function_privilege('service_role', 'analytics.content_post_update_type(uuid,uuid,text)', 'execute') into v_priv_service_role;

  if v_priv_anon is false and v_priv_authenticated is false and v_priv_service_role is true then
    v_log := v_log || 'T7 (has_function_privilege: anon/authenticated=false, service_role=true): PASS' || E'\n';
  else
    v_log := v_log || format('T7: FAIL — anon=%s authenticated=%s service_role=%s', v_priv_anon, v_priv_authenticated, v_priv_service_role) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- Cleanup ชัดเจน (นอกจาก raise ท้ายสุดที่ rollback อยู่แล้ว — ตั้งใจกันสองชั้น)
  -- --------------------------------------------------------------------
  delete from analytics.content_post where id = v_fixture_post_id;
  delete from analytics.content_type where code = v_inactive_code;

  raise exception '%', v_log;  -- บังคับ rollback ทั้งก้อน (3j-migration-traps #11)
end;
$verify0152$;

-- scripts/verify-0145.sql
-- ทดสอบ 0145_content_taxonomy.sql — do-block + raise exception บังคับ rollback
-- เสมอ (3j-migration-traps #11) ห้ามรันแยกเป็น script ที่ COMMIT.
--
-- วิธีรัน (ต้องรันหลัง DDL ของ 0145 มีอยู่จริงในทรานแซกชันเดียวกันหรือหลัง
-- apply จริงแล้ว):
--   ต่อไฟล์ supabase/migrations/0145_content_taxonomy.sql + ไฟล์นี้เข้าด้วยกัน
--   แล้วรันผ่าน node scripts/run-sql.mjs (dry-run เดียวกัน) — หรือหลัง Tech
--   Lead apply 0145 จริงแล้ว: node scripts/run-sql.mjs scripts/verify-0145.sql
--
-- แก้รอบ 2 (22 ก.ย. 69, security round 1 CONDITIONAL GO): เพิ่ม T_H1 (บล็อก
-- apply), T_M2/T_M5/T_M6/T_M8 ใหม่ + แก้ T_clip_brief (M7: นับรอบจริง +
-- ตัวเลขถูกต้อง 16 ไม่ใช่ 65)
--
-- อ่านผลจาก NOTICE — บรรทัดรูปแบบ "ชื่อเทสต์: PASS/FAIL" ทุกข้อ
-- นับ FAIL ด้วย: grep -o ': FAIL' (ไม่ grep คำว่า FAIL เฉยๆ)

do $verify0145$
declare
  v_log text := E'\n=== verify-0145 (content_taxonomy) ===\n';

  -- ชนิดแยกตามความหมายเสมอ (3j-migration-traps #16) ห้ามใช้ซ้ำข้ามชนิด/ความหมาย
  v_col_count      int;
  v_board_rows     int;
  v_board_cols     text;
  v_expect_cols    text[];
  v_actual_cols    text[];
  v_oct_campaigns  int;
  v_oct_steps      int;
  v_oct_artifacts  int;
  v_oct_gates      int;
  v_kpi_md5        text;
  v_kpi_md5_expect text := 'b629889d6df7928b7fbbafff2bcdd7af';  -- captured pre-migration 22 ก.ย. 69, 55 แถว
  v_ambiguous_null_count int;
  v_ambiguous_total_count int;
  v_check_pass     boolean;
  v_clip_brief_row record;
  v_clip_brief_iter_count int := 0;
  v_clip_brief_fail_count int := 0;

  -- T_H1 (security H1, บล็อก apply) — updated_at ของ campaign_step ห้ามถูก
  -- backfill ทุบ. baseline capture สดก่อน migration 22 ก.ย. 69.
  v_updated_at_md5        text;
  v_updated_at_md5_expect text := 'e7fb67243e5287fb53e304c72cdd22c6';
  v_updated_at_distinct   int;

  -- T_M2 — mapping ที่ backfill เขียนจริงต้องถูก ไม่ใช่แค่ฝั่ง null
  v_mapped_total     int;
  v_mapping_mismatch int;

  -- T_M5/T_M6 — grant/schema privilege ตรวจแบบทนต่อ PUBLIC + column-level grant
  -- (role_table_grants เดิมมองไม่เห็นทั้งสองอย่างนี้)
  v_tbl  text;
  v_role text;
  v_priv text;
  v_priv_leak_count  int := 0;
  v_public_acl_count int;
  v_su_authenticated boolean;
  v_su_anon          boolean;
  v_su_service_role  boolean;

  -- T_M8 — re-seed ต้องไม่ทับสีที่เจ้าของแก้เอง (on conflict do nothing)
  v_seed_color_after text;
begin
  -- --------------------------------------------------------------------
  -- T1 — v_campaign_board: 33 คอลัมน์เดิม ชื่อ/ลำดับ/ชนิด เหมือนเดิมเป๊ะ
  -- (baseline hardcode จาก information_schema.columns ที่ query สดก่อน
  -- migration, 22 ก.ย. 69) + คอลัมน์ใหม่ 3 ตัวต่อท้ายที่ตำแหน่ง 34-36
  -- --------------------------------------------------------------------
  v_expect_cols := array[
    '1|step_id|uuid', '2|campaign_id|uuid', '3|shop_id|uuid', '4|campaign_name|text',
    '5|campaign_type|text', '6|trigger_kind|text', '7|campaign_status|text', '8|anchor_date|date',
    '9|primary_channels|ARRAY', '10|campaign_blocked_reason|text', '11|campaign_note|text', '12|seq|integer',
    '13|step_kind|text', '14|offset_start_days|integer', '15|offset_end_days|integer', '16|resolved_start|date',
    '17|resolved_end|date', '18|days_until|integer', '19|audience_segment|text', '20|audience_live_count|integer',
    '21|channel|text', '22|goal_kpi|text', '23|step_status|text', '24|step_blocked_reason|text',
    '25|artifacts|jsonb', '26|art_total|bigint', '27|art_done|bigint', '28|gates|jsonb',
    '29|effective_status|text', '30|step_title|text', '31|source_reco_key|text', '32|step_origin|text',
    '33|start_time|text'
  ];

  select array_agg(ordinal_position::text || '|' || column_name || '|' || data_type order by ordinal_position)
  into v_actual_cols
  from information_schema.columns
  where table_schema = 'analytics' and table_name = 'v_campaign_board'
    and ordinal_position <= 33;

  if v_actual_cols = v_expect_cols then
    v_log := v_log || 'T1a (33 คอลัมน์เดิม ชื่อ/ลำดับ/ชนิดตรงเป๊ะ): PASS' || E'\n';
  else
    v_log := v_log || format('T1a: FAIL — ได้ %s', v_actual_cols) || E'\n';
  end if;

  select string_agg(ordinal_position::text || '|' || column_name || '|' || data_type, ', ' order by ordinal_position)
  into v_board_cols
  from information_schema.columns
  where table_schema = 'analytics' and table_name = 'v_campaign_board'
    and ordinal_position between 34 and 36;

  if v_board_cols = '34|goal_kpi_code|text, 35|goal_kpi_code_source|text, 36|content_type_code|text' then
    v_log := v_log || 'T1b (3 คอลัมน์ใหม่ต่อท้ายตำแหน่ง 34-36): PASS' || E'\n';
  else
    v_log := v_log || format('T1b: FAIL — ได้ %s', coalesce(v_board_cols, '(null)')) || E'\n';
  end if;

  select count(*) into v_col_count
  from information_schema.columns
  where table_schema = 'analytics' and table_name = 'v_campaign_board';
  if v_col_count = 36 then
    v_log := v_log || 'T1c (รวมทั้งหมด 36 คอลัมน์ ไม่มีคอลัมน์เกิน): PASS' || E'\n';
  else
    v_log := v_log || format('T1c: FAIL — รวม %s คอลัมน์', v_col_count) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T2 — board ยังอ่านได้ ไม่ error และได้ครบ 55 step (ตัวแทนของ
  -- /marketing/calendar, [stepId], /marketing/copilot ซึ่งอ่าน view นี้ —
  -- backend-dev ทดสอบได้แค่ระดับ query, หน้าเว็บจริงเป็นหน้าที่ QA)
  -- --------------------------------------------------------------------
  begin
    select count(*) into v_board_rows from analytics.v_campaign_board;
    if v_board_rows = 55 then
      v_log := v_log || 'T2 (select * from v_campaign_board ไม่ error ได้ 55 แถว): PASS' || E'\n';
    else
      v_log := v_log || format('T2: FAIL — ได้ %s แถว ไม่ใช่ 55', v_board_rows) || E'\n';
    end if;
  exception when others then
    v_log := v_log || format('T2: FAIL — query error: %s', sqlerrm) || E'\n';
  end;

  -- --------------------------------------------------------------------
  -- T3 — ปฏิทิน ต.ค. 69 (seed 0120, ระบุด้วยชื่อ 4 แคมเปญตรงๆ — anchor_date
  -- range เพียงอย่างเดียวจับ "แคมเปญเทศกาล (5 ขั้น)" ปนมาด้วย ยืนยันด้วย query
  -- สดแล้วว่าไม่ใช่ของ 0120) จำนวนแถวต้องเท่าเดิมเป๊ะหลัง apply
  -- --------------------------------------------------------------------
  select count(*) into v_oct_campaigns from analytics.campaign
  where name in ('คลิปดันไลฟ์ (สลับสัปดาห์)', 'เงินเดือน ต.ค. (15–18)', 'การ์ดในกล่อง → LINE OA', 'ปฏิทินโพสต์ ต.ค. 69 — evergreen');

  select count(*) into v_oct_steps from analytics.campaign_step cs
  join analytics.campaign cp on cp.id = cs.campaign_id
  where cp.name in ('คลิปดันไลฟ์ (สลับสัปดาห์)', 'เงินเดือน ต.ค. (15–18)', 'การ์ดในกล่อง → LINE OA', 'ปฏิทินโพสต์ ต.ค. 69 — evergreen');

  select count(*) into v_oct_artifacts from analytics.step_artifact sa
  join analytics.campaign_step cs on cs.id = sa.step_id
  join analytics.campaign cp on cp.id = cs.campaign_id
  where cp.name in ('คลิปดันไลฟ์ (สลับสัปดาห์)', 'เงินเดือน ต.ค. (15–18)', 'การ์ดในกล่อง → LINE OA', 'ปฏิทินโพสต์ ต.ค. 69 — evergreen');

  select count(*) into v_oct_gates from analytics.step_gate sg
  join analytics.campaign_step cs on cs.id = sg.step_id
  join analytics.campaign cp on cp.id = cs.campaign_id
  where cp.name in ('คลิปดันไลฟ์ (สลับสัปดาห์)', 'เงินเดือน ต.ค. (15–18)', 'การ์ดในกล่อง → LINE OA', 'ปฏิทินโพสต์ ต.ค. 69 — evergreen');

  if v_oct_campaigns = 4 and v_oct_steps = 26 and v_oct_artifacts = 26 and v_oct_gates = 2 then
    v_log := v_log || 'T3 (ปฏิทิน ต.ค. 69: 4 campaign/26 step/26 artifact/2 gate เท่าเดิม): PASS' || E'\n';
  else
    v_log := v_log || format('T3: FAIL — ได้ campaign=%s step=%s artifact=%s gate=%s',
      v_oct_campaigns, v_oct_steps, v_oct_artifacts, v_oct_gates) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T4 — goal_kpi เดิมของทั้ง 55 แถวต้องเหมือนเดิมทุกตัวอักษร (md5 เทียบกับ
  -- ค่าที่ capture ไว้ก่อน migration)
  -- --------------------------------------------------------------------
  select md5(string_agg(coalesce(goal_kpi, ''), '|' order by id)) into v_kpi_md5
  from analytics.campaign_step;

  if v_kpi_md5 = v_kpi_md5_expect then
    v_log := v_log || 'T4 (goal_kpi เดิมของ 55 แถว ไม่ถูกแตะแม้แต่ตัวอักษรเดียว — md5 ตรง): PASS' || E'\n';
  else
    v_log := v_log || format('T4: FAIL — md5 ได้ %s คาด %s', v_kpi_md5, v_kpi_md5_expect) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T_H1 🔴 (security round 1, บล็อก apply) — backfill ต้องไม่ทุบ updated_at
  -- เดิมของ campaign_step. baseline: md5 + count(distinct) capture สดก่อน
  -- migration วันที่ 22 ก.ย. 69 (มี trigger trg_campaign_step_updated_at ที่
  -- set new.updated_at=now() แบบไม่มีเงื่อนไข — 3j-migration-traps #19)
  -- --------------------------------------------------------------------
  select md5(string_agg(updated_at::text, '|' order by id)) into v_updated_at_md5
  from analytics.campaign_step;

  if v_updated_at_md5 = v_updated_at_md5_expect then
    v_log := v_log || 'T_H1_md5 (updated_at ของทั้ง 55 แถว ไม่ถูกแตะจาก backfill — md5 ตรง): PASS' || E'\n';
  else
    v_log := v_log || format('T_H1_md5: FAIL — md5 ได้ %s คาด %s', v_updated_at_md5, v_updated_at_md5_expect) || E'\n';
  end if;

  select count(distinct updated_at) into v_updated_at_distinct from analytics.campaign_step;
  if v_updated_at_distinct = 7 then
    v_log := v_log || 'T_H1_distinct (count(distinct updated_at) ยังเป็น 7 เท่าเดิม ไม่ยุบเหลือ 1): PASS' || E'\n';
  else
    v_log := v_log || format('T_H1_distinct: FAIL — ได้ %s ค่า distinct (คาด 7)', v_updated_at_distinct) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T5 — content_type.color_hex CHECK ตีตกค่าไม่ถูกต้องทุกเคส (ทำใน
  -- savepoint ย่อยแยกแต่ละเคส กันเคสหนึ่ง error แล้วพาทั้ง block ตาย)
  -- --------------------------------------------------------------------
  v_check_pass := true;
  begin
    insert into analytics.content_type (code, label_th, color_hex) values ('__test_bad1', 'x', '#ABC');
    v_check_pass := false; -- ไม่ควรถึงบรรทัดนี้
  exception when check_violation then
    null; -- ตามคาด
  end;

  begin
    insert into analytics.content_type (code, label_th, color_hex) values ('__test_bad2', 'x', '#GGGGGG');
    v_check_pass := false;
  exception when check_violation then
    null;
  end;

  begin
    insert into analytics.content_type (code, label_th, color_hex) values ('__test_bad3', 'x', 'a2191d');
    v_check_pass := false;
  exception when check_violation then
    null;
  end;

  begin
    insert into analytics.content_type (code, label_th, color_hex) values ('__test_bad4', 'x', '#A2191D');
    v_check_pass := false;
  exception when check_violation then
    null;
  end;

  if v_check_pass then
    v_log := v_log || 'T5 (color_hex CHECK ตีตก #ABC/#GGGGGG/a2191d/#A2191D ครบทั้ง 4 เคส): PASS' || E'\n';
  else
    v_log := v_log || 'T5: FAIL — มีอย่างน้อย 1 เคสที่ควรถูกปฏิเสธแต่ insert ผ่าน' || E'\n';
  end if;

  -- ยืนยันด้วยว่าค่าที่ถูกต้องยังผ่านได้ปกติ (ด่านไม่แน่นเกินจนฆ่าเคสจริง)
  begin
    insert into analytics.content_type (code, label_th, color_hex) values ('__test_good', 'x', '#123abc');
    delete from analytics.content_type where code = '__test_good';
    v_log := v_log || 'T5b (color_hex ที่ถูกต้อง #123abc ยัง insert ผ่านได้ปกติ): PASS' || E'\n';
  exception when others then
    v_log := v_log || format('T5b: FAIL — ค่าที่ถูกต้องกลับถูกปฏิเสธ: %s', sqlerrm) || E'\n';
  end;

  -- --------------------------------------------------------------------
  -- T_M2 — mapping ที่ backfill "เขียนจริง" ต้องถูก ไม่ใช่แค่ตรวจฝั่ง null
  -- (T10 ด้านล่างตรวจแค่ 17 แถว ambiguous — เคสนี้ตรวจ 38 แถวที่ backfill
  -- เขียนค่าจริง ถ้า mapping ผิดที่ไหนสักที่ T10 อย่างเดียวจะไม่จับ)
  -- --------------------------------------------------------------------
  select count(*) into v_mapped_total from analytics.campaign_step where goal_kpi_code is not null;

  select count(*) into v_mapping_mismatch from analytics.campaign_step
  where (step_kind in ('pre_live_hook', 'teaser', 'live_cta') and goal_kpi_code is distinct from 'drive_live')
     or (step_kind in ('segment_offer', 'last_call', 'main_day', 'post_sale', 'followup_nudge') and goal_kpi_code is distinct from 'drive_sku')
     or (step_kind = 'insert_card' and goal_kpi_code is distinct from 'collect_line')
     or (step_kind in ('content_task', 'vip_private_access', 'reconnect') and goal_kpi_code is not null);

  if v_mapped_total = 38 and v_mapping_mismatch = 0 then
    v_log := v_log || 'T_M2 (goal_kpi_code ที่ backfill เขียนจริงถูก mapping ครบทุก step_kind, รวม 38 แถว): PASS' || E'\n';
  else
    v_log := v_log || format('T_M2: FAIL — mapped_total=%s (คาด 38) mismatch=%s (คาด 0)', v_mapped_total, v_mapping_mismatch) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T10 — goal_kpi_code ของ step_kind กำกวม (content_task/vip_private_access/
  -- reconnect) ต้องเป็น null ทุกแถว ไม่เดา
  -- --------------------------------------------------------------------
  select
    count(*) filter (where goal_kpi_code is not null or goal_kpi_code_source is not null),
    count(*)
  into v_ambiguous_null_count, v_ambiguous_total_count
  from analytics.campaign_step
  where step_kind in ('content_task', 'vip_private_access', 'reconnect');

  if v_ambiguous_null_count = 0 and v_ambiguous_total_count > 0 then
    v_log := v_log || format('T10 (goal_kpi_code เป็น null ทุกแถวของ content_task/vip_private_access/reconnect, n=%s): PASS', v_ambiguous_total_count) || E'\n';
  else
    v_log := v_log || format('T10: FAIL — %s / %s แถวมีค่าไม่ใช่ null', v_ambiguous_null_count, v_ambiguous_total_count) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- ห้ามพัง (A) — assert_clip_brief_valid ต้องยังผ่านกับ artifact เดิมทุกแถว
  -- ที่มี clip_brief (migration นี้ไม่แตะ step_artifact เลย แต่บรีฟสั่งให้
  -- ทดสอบไว้ตรงๆ). M7 (security 22 ก.ย. 69): ของจริงมี clip_brief 16 แถว
  -- ไม่ใช่ 65 (65 คือ step_artifact ทั้งหมด — เลขผิดในบรีฟรอบแรก) + ต้อง assert
  -- ว่าลูปวนจริง ไม่ใช่ผ่านเพราะไม่วนสักรอบ (0 rows ก็ v_fail_count=0 เหมือนกัน)
  -- --------------------------------------------------------------------
  for v_clip_brief_row in
    select id, clip_brief from analytics.step_artifact where clip_brief is not null
  loop
    v_clip_brief_iter_count := v_clip_brief_iter_count + 1;
    begin
      perform analytics.assert_clip_brief_valid(v_clip_brief_row.clip_brief);
    exception when others then
      v_clip_brief_fail_count := v_clip_brief_fail_count + 1;
    end;
  end loop;

  if v_clip_brief_iter_count = 16 and v_clip_brief_fail_count = 0 then
    v_log := v_log || 'T_clip_brief (วนครบ 16 แถวที่มี clip_brief จริง, assert_clip_brief_valid ผ่านทุกแถว): PASS' || E'\n';
  else
    v_log := v_log || format('T_clip_brief: FAIL — วนไป %s แถว (คาด 16), fail=%s', v_clip_brief_iter_count, v_clip_brief_fail_count) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T_M8 — re-seed content_type (on conflict do nothing) ต้องไม่ทับสีที่
  -- เจ้าของแก้เอง (ของเดิมใช้ do update ซึ่งขัดกับคอมเมนต์ "ห้าม re-palette")
  -- --------------------------------------------------------------------
  update analytics.content_type set color_hex = '#000000' where code = 'drive_live';

  insert into analytics.content_type (code, label_th, color_hex, sort_order) values
    ('drive_live', 'พาเข้าไลฟ์', '#a2191d', 10),
    ('knowledge', 'ความรู้', '#1f3a5f', 20),
    ('craft', 'ช่าง/โรงงาน', '#6b4a2e', 30),
    ('customer', 'ลูกค้า/ความสัมพันธ์', '#4f7f6a', 40),
    ('announce', 'เทศกาล/ประกาศ', '#8a8f94', 50)
  on conflict (code) do nothing;

  select color_hex into v_seed_color_after from analytics.content_type where code = 'drive_live';

  if v_seed_color_after = '#000000' then
    v_log := v_log || 'T_M8 (รัน seed ซ้ำไม่ทับสีที่เจ้าของแก้เอง — on conflict do nothing ถูกต้อง): PASS' || E'\n';
  else
    v_log := v_log || format('T_M8: FAIL — สีถูกทับกลับเป็น %s', v_seed_color_after) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- ห้ามพัง (B) / T_M5 — grant model: content_type/v_campaign_board ต้องไม่มี
  -- anon/authenticated เข้าถึงได้เลยไม่ว่าทางไหน. M5 (security 22 ก.ย. 69):
  -- information_schema.role_table_grants เดิมมองไม่เห็น grantee=PUBLIC และ
  -- ไม่นับ column-level grant ⇒ เปลี่ยนไปใช้ has_table_privilege ตรงๆ (เช็คผล
  -- ACL ที่ resolve แล้วจริง) + เช็ค relacl ว่าไม่มี grantee ว่าง (=PUBLIC)
  -- --------------------------------------------------------------------
  foreach v_tbl in array array['content_type', 'v_campaign_board'] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      foreach v_priv in array array['select', 'insert', 'update', 'delete'] loop
        if has_table_privilege(v_role, 'analytics.' || v_tbl, v_priv) then
          v_priv_leak_count := v_priv_leak_count + 1;
        end if;
      end loop;
    end loop;
  end loop;

  select count(*) into v_public_acl_count
  from pg_class c
  cross join lateral aclexplode(c.relacl) a
  where c.relnamespace = 'analytics'::regnamespace
    and c.relname in ('content_type', 'v_campaign_board')
    and a.grantee = 0;  -- grantee=0 ใน aclexplode() คือ PUBLIC

  if v_priv_leak_count = 0 and v_public_acl_count = 0 then
    v_log := v_log || 'T_M5 (has_table_privilege: anon/authenticated ไม่มี select/insert/update/delete บน content_type/v_campaign_board + ไม่มี PUBLIC ใน relacl): PASS' || E'\n';
  else
    v_log := v_log || format('T_M5: FAIL — priv_leak_count=%s public_acl_count=%s', v_priv_leak_count, v_public_acl_count) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T_M6 — invariant หลักที่กันทุกอย่างอยู่ (0123): authenticated/anon ต้องไม่มี
  -- USAGE บนสคีมา analytics เลย ถ้าวันหนึ่งมีใครเปิดกลับ เทสต์นี้ต้องกรีดร้อง
  -- --------------------------------------------------------------------
  select has_schema_privilege('authenticated', 'analytics', 'usage') into v_su_authenticated;
  select has_schema_privilege('anon', 'analytics', 'usage') into v_su_anon;
  select has_schema_privilege('service_role', 'analytics', 'usage') into v_su_service_role;

  if v_su_authenticated is false and v_su_anon is false and v_su_service_role is true then
    v_log := v_log || 'T_M6 (has_schema_privilege: authenticated/anon=false, service_role=true บนสคีมา analytics): PASS' || E'\n';
  else
    v_log := v_log || format('T_M6: FAIL — authenticated=%s anon=%s service_role=%s', v_su_authenticated, v_su_anon, v_su_service_role) || E'\n';
  end if;

  -- clean up test-only content_type rows ถ้ามีหลงเหลือ (กัน error ระหว่างทาง)
  delete from analytics.content_type where code like '\_\_test\_%';

  raise exception '%', v_log;  -- บังคับ rollback ทั้งก้อน (3j-migration-traps #11) — DB ไม่ขยับจริง
end;
$verify0145$;

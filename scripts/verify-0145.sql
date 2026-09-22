-- scripts/verify-0145.sql
-- ทดสอบ 0145_content_taxonomy.sql — do-block + raise exception บังคับ rollback
-- เสมอ (3j-migration-traps #11) ห้ามรันแยกเป็น script ที่ COMMIT.
--
-- วิธีรัน (ต้องรันหลัง DDL ของ 0145 มีอยู่จริงในทรานแซกชันเดียวกันหรือหลัง
-- apply จริงแล้ว):
--   node scripts/run-sql.mjs supabase/migrations/0145_content_taxonomy.sql   (เตรียม schema ใน dry-run เดียวกันไม่ได้ ต้องต่อไฟล์)
--   หรือรันไฟล์รวม 0145+verify ในทรานแซกชันเดียว (ที่ backend-dev ใช้ตอนซ้อม)
--   หรือหลัง Tech Lead apply 0145 จริงแล้ว: node scripts/run-sql.mjs scripts/verify-0145.sql
--
-- อ่านผลจาก NOTICE — บรรทัดรูปแบบ "ชื่อเทสต์: PASS/FAIL" ทุกข้อ
-- นับ FAIL ด้วย: grep -o ': FAIL' (ไม่ grep คำว่า FAIL เฉยๆ)

do $verify0145$
declare
  v_log text := E'\n=== verify-0145 (content_taxonomy) ===\n';

  -- ชนิดแยกตามความหมายเสมอ (3j-migration-traps #16) ห้ามใช้ซ้ำข้ามชนิด/ความหมาย
  v_col_count      int;
  v_new_col_count  int;
  v_mismatch_count int;
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
  v_clip_brief_fail_count int := 0;
  v_grant_leak_count int;
  i int;
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
  -- ห้ามพัง (A) — assert_clip_brief_valid ต้องยังผ่านกับ 65 artifact เดิม
  -- ทุกแถวที่มี clip_brief (migration นี้ไม่แตะ step_artifact เลย แต่บรีฟสั่ง
  -- ให้ทดสอบไว้ตรงๆ)
  -- --------------------------------------------------------------------
  for v_clip_brief_row in
    select id, clip_brief from analytics.step_artifact where clip_brief is not null
  loop
    begin
      perform analytics.assert_clip_brief_valid(v_clip_brief_row.clip_brief);
    exception when others then
      v_clip_brief_fail_count := v_clip_brief_fail_count + 1;
    end;
  end loop;

  if v_clip_brief_fail_count = 0 then
    v_log := v_log || 'T_clip_brief (assert_clip_brief_valid ผ่านทุกแถวที่มี clip_brief เดิม): PASS' || E'\n';
  else
    v_log := v_log || format('T_clip_brief: FAIL — %s แถว fail', v_clip_brief_fail_count) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- ห้ามพัง (B) — grant model: content_type/v_campaign_board ต้องไม่มี
  -- anon/authenticated หลุดเข้ามา (0123 ปิดไว้แล้ว ต้องไม่เปิดกลับ)
  -- --------------------------------------------------------------------
  select count(*) into v_grant_leak_count
  from information_schema.role_table_grants
  where table_schema = 'analytics'
    and table_name in ('content_type', 'v_campaign_board')
    and grantee in ('anon', 'authenticated');

  if v_grant_leak_count = 0 then
    v_log := v_log || 'T_grant (content_type/v_campaign_board ไม่มี grant หลุดให้ anon/authenticated): PASS' || E'\n';
  else
    v_log := v_log || format('T_grant: FAIL — พบ %s grant(s) หลุด', v_grant_leak_count) || E'\n';
  end if;

  -- clean up test-only content_type rows ถ้ามีหลงเหลือ (กัน error ระหว่างทาง)
  delete from analytics.content_type where code like '\_\_test\_%';

  raise exception '%', v_log;  -- บังคับ rollback ทั้งก้อน (3j-migration-traps #11) — DB ไม่ขยับจริง
end;
$verify0145$;

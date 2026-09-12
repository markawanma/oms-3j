-- scripts/verify-0116-label-resolve.sql
-- Rehearses every guard in 0116_label_review_resolve.sql against REAL
-- fixture data (2 throwaway shops), inside a single do-block that ends with
-- a forced `raise exception` (3j-migration-traps skill #11) — the whole
-- transaction rolls back automatically, so nothing here ever touches real
-- state.
--
-- Run this AFTER 0116 is applied (it calls the new RPCs directly — they do
-- not exist beforehand). Safe to re-run any number of times afterward: every
-- fixture row it creates lives only inside the transaction it's rolled back
-- with, and it never touches any real shop/order/page (2 throwaway shops
-- named `__verify_0116_shop_a__` / `__verify_0116_shop_b__`, deleted by T12
-- before the forced rollback anyway).
--
-- Read the result from the RAISE's error message (v_log), not from any
-- table — DB state never changes regardless of pass/fail.
--
-- Run via Supabase MCP execute_sql (NOT apply_migration — this is a read/
-- verify script, not DDL, per supabase-migrate skill's "execute_sql is for
-- reads/verification" note).

do $$
declare
  v_log text := E'\n=== ผลทดสอบ 0116_label_review_resolve ===\n';

  v_shop_a uuid;
  v_shop_b uuid;
  v_channel_id uuid;
  v_bkk_date date; -- L3: Thai business day, not UTC current_date (3j-migration-traps #6)
  v_province_x text; -- real province #1 (not TH-XX)
  v_province_y text; -- real province #2 (not TH-XX, != v_province_x)

  v_order1 uuid;      -- T1-T4 fixture (single order, no shared tracking)
  v_order4a uuid;
  v_order4b uuid;     -- T8-T10 fixture (2 orders sharing one tracking_no)
  v_order_t9c uuid;   -- T9c: label_apply_matched real-write path (H1)

  v_label_file uuid;
  v_page1 uuid;        -- T5: resolve-twice
  v_page3 uuid;        -- T7: bad taught snippet
  v_page4 uuid;        -- T8/T9/T10: multi-order resolve + revert
  v_page5 uuid;        -- T9a: conflicting re-parse
  v_page6 uuid;        -- T9b: agreeing re-parse (guard skip)
  v_page7 uuid;        -- T11: ignore
  v_page8 uuid;        -- T14: null-tracking resolve
  v_page9 uuid;        -- T15: zero-match resolve
  v_page_t9c uuid;     -- T9c: label_apply_matched real-write path (H1)

  v_audit_t3b_id uuid;
  v_applied_orders int;
  v_apply_result record;
  v_prov1 text;
  v_prov4a text;
  v_prov4b text;
  v_src4a text;
  v_status text;
  v_evidence int;
  v_prov_t9c text;
  v_src_t9c text;

  v_t0_count bigint;
  v_t0_revenue numeric;
  v_final_count bigint;
  v_final_revenue numeric;
begin
  -- service_role short-circuit (crm_require_owner_admin) — transaction-local,
  -- see 3j-migration-traps skill #11's note on testing role-gated functions.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select count(*), coalesce(sum(revenue), 0) into v_t0_count, v_t0_revenue
    from analytics.fact_order;

  select id into v_channel_id from analytics.dim_channel limit 1;
  if v_channel_id is null then
    raise exception 'verify-0116: no analytics.dim_channel rows exist — cannot build test fixtures';
  end if;

  -- L3 fix (12 ก.ย. 69, QA): fixtures used bare current_date (UTC) — wrong
  -- between 00:00-07:00 Thai time (skill 3j-migration-traps #6). Use the
  -- Thai business day everywhere instead, and assert dim_date actually
  -- covers it (it's seeded 2019-01-01..2035-12-31 per 0010, so this should
  -- never fail in practice — but fail loudly instead of a cryptic FK
  -- violation on the fact_order inserts below if it ever doesn't).
  v_bkk_date := (now() at time zone 'Asia/Bangkok')::date;
  if not exists (select 1 from analytics.dim_date where date_key = v_bkk_date) then
    raise exception 'verify-0116: analytics.dim_date has no row for today (BKK) = % — cannot build test fixtures', v_bkk_date;
  end if;

  select province_code into v_province_x
    from analytics.dim_geo where province_code <> 'TH-XX' order by province_code limit 1;
  select province_code into v_province_y
    from analytics.dim_geo where province_code <> 'TH-XX' order by province_code offset 1 limit 1;
  if v_province_x is null or v_province_y is null or v_province_x = v_province_y then
    raise exception 'verify-0116: need >=2 distinct real province_code rows in analytics.dim_geo — cannot build test fixtures';
  end if;

  insert into public.shop (name) values ('__verify_0116_shop_a__') returning id into v_shop_a;
  insert into public.shop (name) values ('__verify_0116_shop_b__') returning id into v_shop_b;

  -- ==========================================================================
  -- Fixtures
  -- ==========================================================================

  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, province_code, revenue)
  values (v_shop_a, '__V0116_O1__', v_channel_id, v_bkk_date, v_province_x, 1000)
  returning id into v_order1;

  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, tracking_no, province_code, revenue)
  values (v_shop_a, '__V0116_O4A__', v_channel_id, v_bkk_date, '__V0116_TRACK_MULTI__', 'TH-XX', 500)
  returning id into v_order4a;
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, tracking_no, province_code, revenue)
  values (v_shop_a, '__V0116_O4B__', v_channel_id, v_bkk_date, '__V0116_TRACK_MULTI__', 'TH-XX', 500)
  returning id into v_order4b;

  insert into analytics.label_file (shop_id, storage_path, file_name, file_sha256, file_size_bytes, status)
  values (v_shop_a, 'verify-0116/fixture.pdf', 'fixture.pdf', encode(gen_random_bytes(32), 'hex'), 100, 'parsed')
  returning id into v_label_file;

  insert into analytics.stg_label_page (label_file_id, shop_id, page_no, match_status, tracking_no, province_code, match_detail)
  values (v_label_file, v_shop_a, 1, 'needs_review', null, null, '{}'::jsonb)
  returning id into v_page1;

  insert into analytics.stg_label_page (label_file_id, shop_id, page_no, match_status, tracking_no, province_code, match_detail)
  values (v_label_file, v_shop_a, 3, 'needs_review', '__V0116_TRACK_T7__', v_province_x, '{}'::jsonb)
  returning id into v_page3;
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, tracking_no, province_code, revenue)
  values (v_shop_a, '__V0116_O_T7__', v_channel_id, v_bkk_date, '__V0116_TRACK_T7__', 'TH-XX', 300);

  insert into analytics.stg_label_page (label_file_id, shop_id, page_no, match_status, tracking_no, province_code, match_detail)
  values (v_label_file, v_shop_a, 4, 'needs_review', '__V0116_TRACK_MULTI__', v_province_x, '{}'::jsonb)
  returning id into v_page4;

  insert into analytics.stg_label_page (label_file_id, shop_id, page_no, match_status, tracking_no, province_code, match_detail)
  values (v_label_file, v_shop_a, 7, 'needs_review', null, null, '{}'::jsonb)
  returning id into v_page7;

  insert into analytics.stg_label_page (label_file_id, shop_id, page_no, match_status, tracking_no, province_code, match_detail)
  values (v_label_file, v_shop_a, 8, 'needs_review', null, null, '{}'::jsonb)
  returning id into v_page8;

  insert into analytics.stg_label_page (label_file_id, shop_id, page_no, match_status, tracking_no, province_code, match_detail)
  values (v_label_file, v_shop_a, 9, 'needs_review', '__V0116_TRACK_NOORDER__', v_province_x, '{}'::jsonb)
  returning id into v_page9;

  -- ==========================================================================
  -- T1 (เคสห้ามผ่าน): set ข้าม shop -> ปฏิเสธ
  -- ==========================================================================
  begin
    perform analytics.label_set_order_province(v_shop_b, v_order1, v_province_y, 'other', null);
    v_log := v_log || 'T1: FAIL - เขียนข้าม shop ผ่านทั้งที่ควรถูกปฏิเสธ' || E'\n';
  exception when others then
    v_log := v_log || 'T1: OK - เขียนข้าม shop ถูกปฏิเสธ (' || sqlerrm || ')' || E'\n';
  end;

  -- ==========================================================================
  -- T2 (เคสห้ามผ่าน): set ทับค่าจริงโดยไม่มี reason code -> ปฏิเสธ
  -- order1.province_code = v_province_x (ค่าจริง ไม่ใช่ TH-XX)
  -- ==========================================================================
  begin
    perform analytics.label_set_order_province(v_shop_a, v_order1, v_province_y, null, null);
    v_log := v_log || 'T2: FAIL - ทับค่าจริงโดยไม่มี reason ผ่านทั้งที่ควรถูกปฏิเสธ' || E'\n';
  exception when others then
    v_log := v_log || 'T2: OK - ทับค่าจริงไม่มี reason ถูกปฏิเสธ (' || sqlerrm || ')' || E'\n';
  end;

  -- ==========================================================================
  -- T3 (เคสห้ามผ่าน): reason code นอกชุด -> ปฏิเสธ
  -- ==========================================================================
  begin
    perform analytics.label_set_order_province(v_shop_a, v_order1, v_province_y, 'bogus_code_xyz', null);
    v_log := v_log || 'T3: FAIL - reason code นอกชุดผ่านทั้งที่ควรถูกปฏิเสธ' || E'\n';
  exception when others then
    v_log := v_log || 'T3: OK - reason code นอกชุดถูกปฏิเสธ (' || sqlerrm || ')' || E'\n';
  end;

  -- ==========================================================================
  -- T3b (setup, ไม่ใช่เคสทดสอบ): valid set ต้องผ่าน — เก็บ audit_log_id ไว้ใช้ T4
  -- ==========================================================================
  begin
    perform analytics.label_set_order_province(v_shop_a, v_order1, v_province_y, 'wrong_label', 'ทดสอบ T3b');

    select id into v_audit_t3b_id
      from analytics.crm_audit_log
     where shop_id = v_shop_a and entity_type = 'fact_order' and entity_id = v_order1 and action = 'province_set'
     order by created_at desc limit 1;

    select province_code into v_prov1 from analytics.fact_order where id = v_order1;
    if v_prov1 = v_province_y and v_audit_t3b_id is not null then
      v_log := v_log || 'T3b: OK (setup) - set ค่าจริงพร้อม reason ผ่าน, province=' || v_prov1 || E'\n';
    else
      v_log := v_log || 'T3b: FAIL (setup) - set ไม่ได้ผลตามคาด province=' || coalesce(v_prov1, '<null>') || E'\n';
    end if;
  exception when others then
    v_log := v_log || 'T3b: FAIL (setup) - เกิด error ไม่คาดคิด: ' || sqlerrm || E'\n';
  end;

  -- เขียนทับอีกรอบ (กลับไปที่ v_province_x) เพื่อให้ audit ของ T3b กลายเป็น "เก่า" —
  -- current ตอนนี้จะไม่ตรงกับ after ของ audit T3b อีกต่อไป
  begin
    perform analytics.label_set_order_province(v_shop_a, v_order1, v_province_x, 'customer_moved', 'ทดสอบทำให้ audit เก่า');
  exception when others then
    v_log := v_log || 'T3c: FAIL (setup) - เกิด error ไม่คาดคิดตอนเขียนทับรอบสอง: ' || sqlerrm || E'\n';
  end;

  -- ==========================================================================
  -- T4 (เคสห้ามผ่าน): revert เมื่อค่าปัจจุบัน != after ของ audit -> ปฏิเสธ
  -- (v_audit_t3b_id มี after.province_code = v_province_y แต่ปัจจุบัน order1 = v_province_x แล้ว)
  -- ==========================================================================
  begin
    if v_audit_t3b_id is null then
      raise exception 'T4 setup ล้มเหลว — ไม่มี v_audit_t3b_id ให้ทดสอบ';
    end if;
    perform analytics.label_revert_province_audit(v_shop_a, v_order1, v_audit_t3b_id);
    v_log := v_log || 'T4: FAIL - revert audit เก่าผ่านทั้งที่ค่าปัจจุบันไม่ตรง ควรถูกปฏิเสธ' || E'\n';
  exception when others then
    v_log := v_log || 'T4: OK - revert audit เก่าถูกปฏิเสธ (' || sqlerrm || ')' || E'\n';
  end;

  -- ==========================================================================
  -- T5 (เคสห้ามผ่าน): resolve page ที่ apply แล้ว -> ปฏิเสธ
  -- ==========================================================================
  begin
    -- page1 ไม่มี tracking_no — ใช้ไม่ได้กับ resolve (จะโดน guard อื่นก่อน) จึง
    -- ต้องผูก tracking ให้ page1 ก่อน แล้วสร้างออเดอร์รองรับ
    update analytics.stg_label_page set tracking_no = '__V0116_TRACK_T5__' where id = v_page1;
    insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, tracking_no, province_code, revenue)
    values (v_shop_a, '__V0116_O_T5__', v_channel_id, v_bkk_date, '__V0116_TRACK_T5__', 'TH-XX', 200);

    perform analytics.label_resolve_page(v_shop_a, v_page1, v_province_x, null, null, null);
    select match_status into v_status from analytics.stg_label_page where id = v_page1;
    if v_status <> 'manual_applied' then
      v_log := v_log || 'T5 setup: FAIL - resolve ครั้งแรกไม่สำเร็จ status=' || coalesce(v_status, '<null>') || E'\n';
    end if;
  exception when others then
    v_log := v_log || 'T5 setup: FAIL - เกิด error ไม่คาดคิดตอน resolve ครั้งแรก: ' || sqlerrm || E'\n';
  end;

  begin
    perform analytics.label_resolve_page(v_shop_a, v_page1, v_province_y, 'other', null, null);
    v_log := v_log || 'T5: FAIL - resolve page ที่ apply แล้วผ่านทั้งที่ควรถูกปฏิเสธ' || E'\n';
  exception when others then
    v_log := v_log || 'T5: OK - resolve page ที่ apply แล้วถูกปฏิเสธ (' || sqlerrm || ')' || E'\n';
  end;

  -- ==========================================================================
  -- T6 (เคสห้ามผ่าน): crm_set_order_override ส่ง province_code -> ปฏิเสธ
  -- ==========================================================================
  begin
    perform analytics.crm_set_order_override(v_order1, jsonb_build_object('province_code', v_province_x), 'ทดสอบ');
    v_log := v_log || 'T6: FAIL - crm_set_order_override รับ province_code ทั้งที่ควรถูกปฏิเสธ' || E'\n';
  exception when others then
    v_log := v_log || 'T6: OK - crm_set_order_override ปฏิเสธ province_code (' || sqlerrm || ')' || E'\n';
  end;

  -- ==========================================================================
  -- T7 (เคสห้ามผ่าน): pattern มีตัวเลข >=3 หลักติดกัน -> ปฏิเสธ (ทั้งคำสั่งต้องล้ม
  -- ทั้งก้อน — province ต้องไม่ถูกเขียนด้วย)
  -- ==========================================================================
  begin
    perform analytics.label_resolve_page(v_shop_a, v_page3, v_province_x, null, null, 'บ้านเลขที่123 ซอย');
    v_log := v_log || 'T7: FAIL - taught snippet มีเลข 3 หลักผ่านทั้งที่ควรถูกปฏิเสธ' || E'\n';
  exception when others then
    select match_status into v_status from analytics.stg_label_page where id = v_page3;
    if v_status = 'needs_review' then
      v_log := v_log || 'T7: OK - taught snippet ผิดรูปแบบถูกปฏิเสธทั้งคำสั่ง (page ยังเป็น needs_review, ' || sqlerrm || ')' || E'\n';
    else
      v_log := v_log || 'T7: FAIL - ถูกปฏิเสธแต่ page เปลี่ยนสถานะไปแล้ว (status=' || coalesce(v_status,'<null>') || ') ไม่ atomic' || E'\n';
    end if;
  end;

  -- ==========================================================================
  -- T8 (เคสต้องไม่พัง): resolve page ที่ tracking ตรงหลาย fact_order -> ทุกใบได้จังหวัด
  -- ==========================================================================
  begin
    select applied_orders into v_applied_orders
      from analytics.label_resolve_page(v_shop_a, v_page4, v_province_x, null, null, null);

    select province_code into v_prov4a from analytics.fact_order where id = v_order4a;
    select province_code into v_prov4b from analytics.fact_order where id = v_order4b;

    if v_applied_orders = 2 and v_prov4a = v_province_x and v_prov4b = v_province_x then
      v_log := v_log || 'T8: OK - resolve page หลายออเดอร์ (tracking เดียวกัน) ได้จังหวัดครบทั้ง 2 ใบ' || E'\n';
    else
      v_log := v_log || format(
        'T8: FAIL - applied_orders=%s O4A=%s O4B=%s (คาด 2/%s/%s)',
        v_applied_orders, v_prov4a, v_prov4b, v_province_x, v_province_x
      ) || E'\n';
    end if;
  exception when others then
    v_log := v_log || 'T8: FAIL - เกิด error ไม่คาดคิด: ' || sqlerrm || E'\n';
  end;

  -- ==========================================================================
  -- T9a (เคสต้องไม่พัง): หลัง resolve, label_apply_matched รอบถัดไปไม่ทับ (guard
  -- TH-XX) และใบที่ไม่ตรง -> conflict
  -- ==========================================================================
  begin
    insert into analytics.stg_label_page (label_file_id, shop_id, page_no, match_status, tracking_no, province_code, match_detail)
    values (v_label_file, v_shop_a, 5, 'matched', '__V0116_TRACK_MULTI__', v_province_y, '{}'::jsonb) -- ตั้งใจให้ไม่ตรงกับ v_province_x ที่ตั้งไว้แล้ว
    returning id into v_page5;

    select * into v_apply_result from analytics.label_apply_matched(v_shop_a, v_label_file);
    -- label_apply_matched ประมวลผลทุกหน้า 'matched' ที่ applied_at is null ในไฟล์
    -- เดียวกัน — ไฟล์นี้มีแค่ page5 อยู่ในสถานะนั้น ณ จุดนี้ (page1/3/4 ผ่านสถานะ
    -- อื่นไปแล้วตั้งแต่ T5/T7/T8)
    select match_status into v_status from analytics.stg_label_page where id = v_page5;
    select province_code into v_prov4a from analytics.fact_order where id = v_order4a;
    select province_code into v_prov4b from analytics.fact_order where id = v_order4b;

    if v_status = 'conflict' and v_apply_result.conflict_cnt = 1 and v_apply_result.applied = 0
       and v_prov4a = v_province_x and v_prov4b = v_province_x then
      v_log := v_log || 'T9a: OK - label_apply_matched ไม่ทับค่าที่ resolve มือไว้ และขึ้น conflict ถูกต้อง' || E'\n';
    else
      v_log := v_log || format(
        'T9a: FAIL - status=%s applied=%s conflict_cnt=%s O4A=%s O4B=%s',
        v_status, v_apply_result.applied, v_apply_result.conflict_cnt, v_prov4a, v_prov4b
      ) || E'\n';
    end if;
  exception when others then
    v_log := v_log || 'T9a: FAIL - เกิด error ไม่คาดคิด: ' || sqlerrm || E'\n';
  end;

  -- ==========================================================================
  -- T9b (เคสต้องไม่พัง): label_apply_matched รอบถัดไป เจอค่าที่ "ตรง" กับที่ resolve
  -- มือไว้แล้ว -> skipped_has_province (ไม่ทับ ไม่ error)
  -- ==========================================================================
  begin
    insert into analytics.stg_label_page (label_file_id, shop_id, page_no, match_status, tracking_no, province_code, match_detail)
    values (v_label_file, v_shop_a, 6, 'matched', '__V0116_TRACK_MULTI__', v_province_x, '{}'::jsonb) -- ตรงกับค่าที่มีอยู่แล้ว
    returning id into v_page6;

    select * into v_apply_result from analytics.label_apply_matched(v_shop_a, v_label_file);
    select match_status into v_status from analytics.stg_label_page where id = v_page6;

    if v_status = 'matched' and v_apply_result.applied = 0 and v_apply_result.skipped_has_province >= 1 then
      v_log := v_log || 'T9b: OK - label_apply_matched ข้ามหน้าที่ค่าตรงกันอยู่แล้ว (skipped_has_province)' || E'\n';
    else
      v_log := v_log || format(
        'T9b: FAIL - status=%s applied=%s skipped=%s', v_status, v_apply_result.applied, v_apply_result.skipped_has_province
      ) || E'\n';
    end if;
  exception when others then
    v_log := v_log || 'T9b: FAIL - เกิด error ไม่คาดคิด: ' || sqlerrm || E'\n';
  end;

  -- ==========================================================================
  -- T9c (H1 fix, 12 ก.ย. 69): label_apply_matched's SUCCESSFUL WRITE path
  -- (order genuinely TH-XX, gets written) must stamp province_source='label'.
  -- T9a hits conflict, T9b hits skip — neither ever exercised the real write
  -- branch, so H1's fix (adding `province_source = 'label',` to the UPDATE)
  -- had zero coverage before this case.
  -- ==========================================================================
  begin
    insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, tracking_no, province_code, revenue)
    values (v_shop_a, '__V0116_O_T9C__', v_channel_id, v_bkk_date, '__V0116_TRACK_T9C__', 'TH-XX', 600)
    returning id into v_order_t9c;

    insert into analytics.stg_label_page (label_file_id, shop_id, page_no, match_status, tracking_no, province_code, match_detail)
    values (v_label_file, v_shop_a, 11, 'matched', '__V0116_TRACK_T9C__', v_province_y, '{}'::jsonb)
    returning id into v_page_t9c;

    -- this call also reprocesses page6 (still 'matched', applied_at null
    -- since T9b's skip path never sets it — see 0097) harmlessly re-skipping
    -- it again, so don't assert an exact `applied` count here, only that
    -- OUR order actually got written.
    perform analytics.label_apply_matched(v_shop_a, v_label_file);

    select province_code, province_source into v_prov_t9c, v_src_t9c from analytics.fact_order where id = v_order_t9c;
    select match_status into v_status from analytics.stg_label_page where id = v_page_t9c;

    if v_prov_t9c = v_province_y and v_src_t9c = 'label' and v_status = 'matched' then
      v_log := v_log || 'T9c: OK - label_apply_matched เขียนจังหวัดจริง + stamp province_source=''label''' || E'\n';
    else
      v_log := v_log || format('T9c: FAIL - province=%s province_source=%s page_status=%s', v_prov_t9c, v_src_t9c, v_status) || E'\n';
    end if;
  exception when others then
    v_log := v_log || 'T9c: FAIL - เกิด error ไม่คาดคิด: ' || sqlerrm || E'\n';
  end;

  -- ==========================================================================
  -- T10 (เคสต้องไม่พัง): revert คืน prev + status กลับ
  -- ==========================================================================
  begin
    perform analytics.label_revert_page(v_shop_a, v_page4);

    select province_code, province_source into v_prov4a, v_src4a from analytics.fact_order where id = v_order4a;
    select province_code into v_prov4b from analytics.fact_order where id = v_order4b;
    select match_status into v_status from analytics.stg_label_page where id = v_page4;

    if v_prov4a = 'TH-XX' and v_prov4b = 'TH-XX' and v_src4a = 'import' and v_status = 'needs_review' then
      v_log := v_log || 'T10: OK - revert_page คืนค่าเดิม (TH-XX) ทั้ง 2 ออเดอร์ และ status กลับเป็น needs_review' || E'\n';
    else
      v_log := v_log || format(
        'T10: FAIL - O4A=%s(src=%s) O4B=%s page_status=%s', v_prov4a, v_src4a, v_prov4b, v_status
      ) || E'\n';
    end if;
  exception when others then
    v_log := v_log || 'T10: FAIL - เกิด error ไม่คาดคิด: ' || sqlerrm || E'\n';
  end;

  -- ==========================================================================
  -- T11 (เคสต้องไม่พัง): ignore ออกจากคิว + เรียกซ้ำต้องถูกปฏิเสธ (idempotency guard)
  -- ==========================================================================
  begin
    perform analytics.label_ignore_page(v_shop_a, v_page7, 'other', 'ไม่ใช่ใบปะหน้า');
    select match_status into v_status from analytics.stg_label_page where id = v_page7;
    if v_status = 'ignored' then
      v_log := v_log || 'T11: OK - ignore page สำเร็จ, status=ignored (ไม่อยู่ใน PENDING_REVIEW_STATUSES ฝั่ง TS อีกต่อไป)' || E'\n';
    else
      v_log := v_log || 'T11: FAIL - status หลัง ignore = ' || coalesce(v_status, '<null>') || E'\n';
    end if;
  exception when others then
    v_log := v_log || 'T11: FAIL - เกิด error ไม่คาดคิด: ' || sqlerrm || E'\n';
  end;

  begin
    perform analytics.label_ignore_page(v_shop_a, v_page7, 'other', null);
    v_log := v_log || 'T11b: FAIL - ignore page ซ้ำผ่านทั้งที่ควรถูกปฏิเสธ (idempotency guard หาย)' || E'\n';
  exception when others then
    v_log := v_log || 'T11b: OK - ignore page ซ้ำถูกปฏิเสธ (' || sqlerrm || ')' || E'\n';
  end;

  -- ==========================================================================
  -- เพิ่มเติม (ไม่ได้อยู่ใน brief แต่ทดสอบ guard อื่นที่เขียนเองในไฟล์นี้) —
  -- ต้องรันก่อน T12 (T12 ลบ fixture ทั้งหมดทิ้ง)
  -- ==========================================================================

  -- T13: province_code ที่ไม่มีจริงใน dim_geo -> ปฏิเสธ
  begin
    perform analytics.label_set_order_province(v_shop_a, v_order1, '__NOT_A_REAL_PROVINCE__', 'other', null);
    v_log := v_log || 'T13: FAIL - province_code ปลอมผ่านทั้งที่ควรถูกปฏิเสธ' || E'\n';
  exception when others then
    v_log := v_log || 'T13: OK - province_code ปลอมถูกปฏิเสธ (' || sqlerrm || ')' || E'\n';
  end;

  -- T14: resolve page ที่ไม่มี tracking_no -> ปฏิเสธ (ต้องใช้ ignore แทน)
  begin
    perform analytics.label_resolve_page(v_shop_a, v_page8, v_province_x, null, null, null);
    v_log := v_log || 'T14: FAIL - resolve page ที่ไม่มี tracking_no ผ่านทั้งที่ควรถูกปฏิเสธ' || E'\n';
  exception when others then
    v_log := v_log || 'T14: OK - resolve page ไม่มี tracking_no ถูกปฏิเสธ (' || sqlerrm || ')' || E'\n';
  end;

  -- T15: resolve page ที่ tracking ไม่ตรงออเดอร์ใดเลย -> ปฏิเสธ (ยังไม่นำเข้าออเดอร์)
  begin
    perform analytics.label_resolve_page(v_shop_a, v_page9, v_province_x, null, null, null);
    v_log := v_log || 'T15: FAIL - resolve page ที่ยังไม่พบออเดอร์ผ่านทั้งที่ควรถูกปฏิเสธ' || E'\n';
  exception when others then
    v_log := v_log || 'T15: OK - resolve page ที่ยังไม่พบออเดอร์ถูกปฏิเสธ (' || sqlerrm || ')' || E'\n';
  end;

  -- ==========================================================================
  -- T17-T20 (QA, 12 ก.ย. 69): cross-shop สำหรับ RPC ที่ยังไม่เคยทดสอบข้าม shop —
  -- ทุกตัวส่ง v_shop_b (ไม่ใช่เจ้าของจริง) พร้อม page/order ของ v_shop_a จริง.
  -- ปลอดภัยที่จะใช้ fixture ที่ "ใช้ไปแล้ว" ได้ (page1=manual_applied จาก T5,
  -- page7=ignored จาก T11, page4=needs_review จาก T10's revert, order1=มีอยู่
  -- แน่นอน) เพราะทุกฟังก์ชันเช็ค shop_id ตอน SELECT...FOR UPDATE ตัวแรกสุด
  -- ก่อนเช็ค match_status เสมอ — shop ผิดต้องโดนปฏิเสธไม่ว่า record จะอยู่ใน
  -- สถานะไหนก็ตาม (สถานะไม่ควรมีผลต่อผลลัพธ์ของ guard นี้เลย).
  -- ==========================================================================
  begin
    perform analytics.label_resolve_page(v_shop_b, v_page1, v_province_x, 'other', null, null);
    v_log := v_log || 'T17: FAIL - resolve_page ข้าม shop ผ่านทั้งที่ควรถูกปฏิเสธ' || E'\n';
  exception when others then
    v_log := v_log || 'T17: OK - resolve_page ข้าม shop ถูกปฏิเสธ (' || sqlerrm || ')' || E'\n';
  end;

  begin
    perform analytics.label_ignore_page(v_shop_b, v_page7, null, null);
    v_log := v_log || 'T18: FAIL - ignore_page ข้าม shop ผ่านทั้งที่ควรถูกปฏิเสธ' || E'\n';
  exception when others then
    v_log := v_log || 'T18: OK - ignore_page ข้าม shop ถูกปฏิเสธ (' || sqlerrm || ')' || E'\n';
  end;

  begin
    perform analytics.label_revert_page(v_shop_b, v_page4);
    v_log := v_log || 'T19: FAIL - revert_page ข้าม shop ผ่านทั้งที่ควรถูกปฏิเสธ' || E'\n';
  exception when others then
    v_log := v_log || 'T19: OK - revert_page ข้าม shop ถูกปฏิเสธ (' || sqlerrm || ')' || E'\n';
  end;

  begin
    perform analytics.label_revert_order_province(v_shop_b, v_order1);
    v_log := v_log || 'T20: FAIL - revert_order_province ข้าม shop ผ่านทั้งที่ควรถูกปฏิเสธ' || E'\n';
  exception when others then
    v_log := v_log || 'T20: OK - revert_order_province ข้าม shop ถูกปฏิเสธ (' || sqlerrm || ')' || E'\n';
  end;

  -- T16 (เพิ่มเติม): resolve พร้อม taught snippet ที่ถูกรูปแบบ -> เก็บลง
  -- label_text_rule (evidence_count=1) แล้ว resolve อีกครั้งด้วย snippet+จังหวัด
  -- เดิม (คนละ page/tracking) -> evidence_count เพิ่มเป็น 2 แทนการสร้างแถวใหม่
  begin
    insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, tracking_no, province_code, revenue)
    values (v_shop_a, '__V0116_O_T16__', v_channel_id, v_bkk_date, '__V0116_TRACK_NOORDER__', 'TH-XX', 400);

    perform analytics.label_resolve_page(v_shop_a, v_page9, v_province_x, null, null, 'ใกล้วัดใหญ่');

    select evidence_count into v_evidence
      from analytics.label_text_rule
     where shop_id = v_shop_a and kind = 'alias' and pattern = 'ใกล้วัดใหญ่' and province_code = v_province_x;

    if v_evidence = 1 then
      v_log := v_log || 'T16a: OK - taught snippet ถูกรูปแบบถูกเก็บลง label_text_rule (active=false, evidence_count=1)' || E'\n';
    else
      v_log := v_log || 'T16a: FAIL - evidence_count=' || coalesce(v_evidence::text, '<ไม่พบแถว>') || E'\n';
    end if;
  exception when others then
    v_log := v_log || 'T16a: FAIL - เกิด error ไม่คาดคิด: ' || sqlerrm || E'\n';
  end;

  begin
    insert into analytics.stg_label_page (label_file_id, shop_id, page_no, match_status, tracking_no, province_code, match_detail)
    values (v_label_file, v_shop_a, 10, 'needs_review', '__V0116_TRACK_T16B__', v_province_x, '{}'::jsonb);
    insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, tracking_no, province_code, revenue)
    values (v_shop_a, '__V0116_O_T16B__', v_channel_id, v_bkk_date, '__V0116_TRACK_T16B__', 'TH-XX', 400);

    perform analytics.label_resolve_page(
      v_shop_a,
      (select id from analytics.stg_label_page where label_file_id = v_label_file and page_no = 10),
      v_province_x, null, null, 'ใกล้วัดใหญ่'
    );

    select evidence_count into v_evidence
      from analytics.label_text_rule
     where shop_id = v_shop_a and kind = 'alias' and pattern = 'ใกล้วัดใหญ่' and province_code = v_province_x;

    if v_evidence = 2 then
      v_log := v_log || 'T16b: OK - สอน pattern+จังหวัดเดิมซ้ำ -> evidence_count เพิ่มเป็น 2 (ไม่สร้างแถวซ้ำ)' || E'\n';
    else
      v_log := v_log || 'T16b: FAIL - evidence_count=' || coalesce(v_evidence::text, '<ไม่พบแถว>') || E'\n';
    end if;
  exception when others then
    v_log := v_log || 'T16b: FAIL - เกิด error ไม่คาดคิด: ' || sqlerrm || E'\n';
  end;

  -- ==========================================================================
  -- T12: snapshot count/revenue ท้ายสุด = T0 (ลบ fixture ทั้งหมดแล้วเทียบ) —
  -- รันเป็นลำดับสุดท้ายเสมอ เพราะลบ fixture ทิ้งทั้งหมด
  -- ==========================================================================
  begin
    delete from public.shop where id in (v_shop_a, v_shop_b); -- cascade ลบ fact_order/stg_label_page/label_file/crm_audit_log/crm_order_override ที่ผูกกับ 2 ร้านนี้ทั้งหมด

    select count(*), coalesce(sum(revenue), 0) into v_final_count, v_final_revenue
      from analytics.fact_order;

    if v_final_count = v_t0_count and v_final_revenue = v_t0_revenue then
      v_log := v_log || format('T12: OK - นับ/ยอดรวมกลับเท่า T0 พอดี (count=%s, revenue=%s)', v_final_count, v_final_revenue) || E'\n';
    else
      v_log := v_log || format(
        'T12: FAIL - T0 count=%s revenue=%s แต่ตอนนี้ count=%s revenue=%s',
        v_t0_count, v_t0_revenue, v_final_count, v_final_revenue
      ) || E'\n';
    end if;
  exception when others then
    v_log := v_log || 'T12: FAIL - เกิด error ไม่คาดคิดตอนลบ fixture/เทียบยอด: ' || sqlerrm || E'\n';
  end;

  raise exception '%', v_log; -- บังคับ rollback ทั้งหมด (trap #11) — DB ไม่ขยับเลย
end $$;

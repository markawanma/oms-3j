-- scripts/verify/qa-0160-pre.sql  (QA R2-D2, 7 ต.ค. 69) — baseline "ก่อน 0159/0160" ของคิววางลิงก์เดิม + หน้าประวัติ/KPI
--
-- รัน: ไฟล์นี้ + 0159 + 0160 + qa-0160-extra.sql ต่อเป็นไฟล์เดียว แล้วรันแบบไม่ใส่ --commit
--   cat scripts/verify/qa-0160-pre.sql supabase/migrations/0159_content_piece_workflow.sql supabase/migrations/0160_content_piece_post_views.sql \
--       scripts/verify/qa-0160-extra.sql > tmp.sql && node scripts/run-sql.mjs tmp.sql
-- ไฟล์นี้ "ไม่เขียนอะไรค้าง" : ทุกเคสรันใน subtransaction แล้ว raise sentinel ให้ถอยเอง (ผลเก็บในตัวแปร plpgsql ซึ่งไม่ถูก rollback) ·
-- ผลลง temp table qa160_pre + GUC qa160.* (ระดับทรานแซกชัน) · ส่วน D ของ qa-0160-extra.sql เทียบผลเดิมกับผลหลัง 0160
-- ⚠️ ต้องรันก่อน 0159 (ถ้ารันหลัง baseline = หลัง 0159 ซึ่งยังเทียบ 0160 ได้ แต่ไม่ครอบ 0159) · ใช้ได้ทั้งสองกรณี (ไม่อ้างคอลัมน์ใหม่)
-- พารามิเตอร์ชุดเดียวกับ lib/marketing/content-types.ts buildContentPostUpsertParams (external_id = origin+path · canonical url · caption trim)

-- ทรานแซกชันนี้ทำตัวเป็น service_role แบบที่แอปเรียกจริง (auth.role() = 'service_role' ผ่าน crm_require_owner_admin) — ค่าคงอยู่ถึงจบทรานแซกชัน
select set_config('request.jwt.claims', '{"role":"service_role"}', true), set_config('request.jwt.claim.role', 'service_role', true);

create temp table if not exists qa160_pre (k text primary key, v text);

-- ภาพแถว content_post เฉพาะคอลัมน์เดิม (ไม่อ้าง step_id/hook_id — ไม่มีก่อน 0159)
create or replace function pg_temp.qx_row(p_id uuid) returns text
 language sql as $f$
  select coalesce((select concat_ws('|', platform, external_id, post_url, posted_at::text, posted_date_th::text,
                  coalesce(content_type_code, '∅'), coalesce(left(caption_snapshot, 40), '∅') || '#' || coalesce(length(caption_snapshot)::text, '∅'),
                  status, (artifact_id is not null)::text, (created_by is null)::text)
                from analytics.content_post where id = p_id), 'NOROW')
$f$;

create or replace function pg_temp.qx_case(p_case int) returns text
 language plpgsql as $f$
declare
  v_shop uuid := (select id from public.shop order by id limit 1);
  v_a1   uuid := (select a.id from analytics.step_artifact a where a.shop_id = (select id from public.shop order by id limit 1) order by a.id limit 1);
  v_ct   text := (select code from analytics.content_type order by code limit 1);
  v_id   uuid;
  v_id2  uuid;
  v_out  text := '';
  v_n    int;
  v_t    text;
  r      record;
  c_tt   constant text := 'https://www.tiktok.com/@qa160diff/video/';
begin
  begin
    if p_case = 1 then            -- โพสต์นอกแผน TikTok + แคปชั่นไทย/emoji (มี space ท้าย ต้องถูก trim)
      v_id := analytics.content_post_upsert(v_shop, 'tiktok', c_tt || '1', c_tt || '1', now() - interval '1 day', null, null, 'แคปชั่นทดสอบ 🔥  ');
      v_out := 'OK ' || pg_temp.qx_row(v_id);
    elsif p_case = 2 then         -- วางซ้ำลิงก์เดิม (2 ครั้ง · ครั้งหลัง null หมด = ต้อง preserve) → id เดิม
      v_id  := analytics.content_post_upsert(v_shop, 'tiktok', c_tt || '2', c_tt || '2', now() - interval '3 days', v_ct, v_a1, 'cap เดิม');
      v_id2 := analytics.content_post_upsert(v_shop, 'tiktok', c_tt || '2', c_tt || '2', now() - interval '3 days', null, null, null);
      v_out := 'OK same_id=' || (v_id = v_id2) || ' ' || pg_temp.qx_row(v_id2);
    elsif p_case = 3 then         -- โพสต์ที่ผูก artifact จริง + ประเภทเนื้อหา
      v_id := analytics.content_post_upsert(v_shop, 'tiktok', c_tt || '3', c_tt || '3', now() - interval '2 days', v_ct, v_a1, null);
      v_out := 'OK ' || pg_temp.qx_row(v_id);
    elsif p_case = 4 then         -- FB / IG / LINE OA
      v_id  := analytics.content_post_upsert(v_shop, 'facebook', 'https://www.facebook.com/qa160diff/posts/4', 'https://www.facebook.com/qa160diff/posts/4', now() - interval '1 day');
      v_id2 := analytics.content_post_upsert(v_shop, 'instagram', 'https://www.instagram.com/p/qa160diff4/', 'https://www.instagram.com/p/qa160diff4/', now() - interval '1 day');
      v_out := 'OK ' || pg_temp.qx_row(v_id) || ' ;; ' || pg_temp.qx_row(v_id2) || ' ;; '
               || pg_temp.qx_row(analytics.content_post_upsert(v_shop, 'line_oa', 'qa160diff-line-4', 'https://example.com/qa160diff-line-4', now() - interval '1 day'));
    elsif p_case = 5 then perform analytics.content_post_upsert(v_shop, 'youtube', c_tt || '5', c_tt || '5', now() - interval '1 day'); v_out := 'NOERR';
    elsif p_case = 6 then perform analytics.content_post_upsert(v_shop, 'tiktok', c_tt || '6', 'ftp://example.com/x', now() - interval '1 day'); v_out := 'NOERR';
    elsif p_case = 7 then perform analytics.content_post_upsert(v_shop, 'tiktok', c_tt || '7', c_tt || '7', now() + interval '2 hours'); v_out := 'NOERR';
    elsif p_case = 8 then perform analytics.content_post_upsert(v_shop, 'tiktok', c_tt || '8', c_tt || '8', now() - interval '1 day', null, gen_random_uuid()); v_out := 'NOERR';
    elsif p_case = 9 then perform analytics.content_post_upsert(v_shop, 'tiktok', c_tt || '9', c_tt || '9', now() - interval '1 day', 'no_such_type_code'); v_out := 'NOERR';
    elsif p_case = 10 then perform analytics.content_post_upsert(v_shop, 'tiktok', '   ', c_tt || '10', now() - interval '1 day'); v_out := 'NOERR';
    elsif p_case = 11 then perform analytics.content_post_upsert(v_shop, 'tiktok', repeat('x', 501), c_tt || '11', now() - interval '1 day'); v_out := 'NOERR';
    elsif p_case = 12 then perform analytics.content_post_upsert(v_shop, 'tiktok', c_tt || '12', 'https://example.com/' || repeat('u', 490), now() - interval '1 day'); v_out := 'NOERR';
    elsif p_case = 13 then perform analytics.content_post_upsert(v_shop, 'tiktok', c_tt || '13', c_tt || '13', null); v_out := 'NOERR';
    elsif p_case = 14 then        -- โพสต์ที่ถูกตั้ง deleted แล้ววางซ้ำ = ปฏิเสธ
      v_id := analytics.content_post_upsert(v_shop, 'tiktok', c_tt || '14', c_tt || '14', now() - interval '1 day');
      perform analytics.content_post_set_status(v_shop, v_id, 'deleted');
      perform analytics.content_post_upsert(v_shop, 'tiktok', c_tt || '14', c_tt || '14', now() - interval '1 day');
      v_out := 'NOERR';
    elsif p_case = 15 then        -- ext ยาว 500 พอดี · url 500 พอดี ผ่าน
      v_id := analytics.content_post_upsert(v_shop, 'tiktok', repeat('e', 500), 'https://example.com/' || repeat('u', 480), now() - interval '1 day');
      v_out := 'OK ' || length((select external_id from analytics.content_post where id = v_id)) || '/' || length((select post_url from analytics.content_post where id = v_id));
    elsif p_case = 16 then        -- อายุ 2 วัน: อยู่ในคิว (หน้าต่าง 1-2) → กรอก metric → ออกจากคิว · t7 ยังไม่ถึง 5 วัน
      v_id := analytics.content_post_upsert(v_shop, 'tiktok', c_tt || '16', c_tt || '16', now() - interval '2 days', v_ct);
      select count(*), min(read_round::text) into v_n, v_t from analytics.v_content_entry_queue where post_id = v_id;
      v_out := 'inq=' || v_n || ' round=' || coalesce(v_t, '∅');
      perform analytics.content_post_metric_upsert(v_shop, v_id, 1000, 10, 2, 50, 10, 'manual');
      select count(*) into v_n from analytics.v_content_entry_queue where post_id = v_id;
      v_out := v_out || ' after_metric_inq=' || v_n;
      select 't7=' || coalesce(t7_captured_on::text, '∅') || ' reason=' || coalesce(t7_unavailable_reason, '∅') || ' view=' || coalesce(t7_view_count::text, '∅') into v_t
        from analytics.v_content_post_t7 where post_id = v_id;
      v_out := v_out || ' ' || coalesce(v_t, 'NOT_IN_T7');
    elsif p_case = 17 then        -- อายุ 7 วัน + metric → T+7 มีค่า · save_rate 0.0500
      v_id := analytics.content_post_upsert(v_shop, 'tiktok', c_tt || '17', c_tt || '17', now() - interval '7 days');
      perform analytics.content_post_metric_upsert(v_shop, v_id, 1000, 10, 2, 50, 10, 'manual');
      select 'age=' || t7_age_days || ' save_rate=' || save_rate || ' share_rate=' || share_rate || ' inq=' ||
             (select count(*) from analytics.v_content_entry_queue q where q.post_id = v_id) into v_out
        from analytics.v_content_post_t7 where post_id = v_id;
    elsif p_case = 18 then        -- caption ยาว 100,000 ตัวอักษร (ไม่มีเพดานฝั่ง DB — บันทึกพฤติกรรมเดิม)
      v_id := analytics.content_post_upsert(v_shop, 'tiktok', c_tt || '18', c_tt || '18', now() - interval '1 day', null, null, repeat('ก', 100000));
      v_out := 'OK len=' || (select length(caption_snapshot) from analytics.content_post where id = v_id);
    elsif p_case = 19 then        -- ext ต่างแค่ตัวพิมพ์/เว้นวรรคท้าย → btrim เท่านั้น (ตัวพิมพ์ต่างกัน = แถวต่าง)
      v_id  := analytics.content_post_upsert(v_shop, 'tiktok', c_tt || 'AbC', c_tt || 'AbC', now() - interval '1 day');
      v_id2 := analytics.content_post_upsert(v_shop, 'tiktok', c_tt || 'abc', c_tt || 'abc', now() - interval '1 day');
      v_out := 'OK case_distinct=' || (v_id <> v_id2) || ' trim_same=' || (analytics.content_post_upsert(v_shop, 'tiktok', c_tt || 'AbC  ', c_tt || 'AbC', now() - interval '1 day') = v_id);
    elsif p_case = 20 then        -- posted_at = -infinity (ช่องเดิมของ 0148: ไม่มีขอบล่าง) บันทึกผล
      v_id := analytics.content_post_upsert(v_shop, 'tiktok', c_tt || '20', c_tt || '20', '-infinity'::timestamptz);
      v_out := 'OK posted_date_th=' || (select posted_date_th::text from analytics.content_post where id = v_id);
      begin
        perform count(*) from analytics.v_content_entry_queue;
        v_out := v_out || ' queue_select=ok';
      exception when others then v_out := v_out || ' queue_select=ERR ' || sqlstate;
      end;
      begin
        perform count(*) from analytics.v_content_post_t7;
        v_out := v_out || ' t7_select=ok';
      exception when others then v_out := v_out || ' t7_select=ERR ' || sqlstate;
      end;
    elsif p_case = 21 then        -- ของจริง: วางซ้ำทุกโพสต์จริง (ค่าเดิมเป๊ะ) = ไม่เปลี่ยนแถว (ยกเว้น updated_at) · id เดิม
      v_n := 0;
      for r in select * from analytics.content_post where shop_id = v_shop and status = 'active' order by id loop
        if analytics.content_post_upsert(v_shop, r.platform, r.external_id, r.post_url, r.posted_at) = r.id then v_n := v_n + 1; end if;
      end loop;
      v_out := 'OK same_id=' || v_n || '/' || (select count(*) from analytics.content_post where shop_id = v_shop and status = 'active')
               || ' md5=' || (select md5(coalesce(string_agg(pg_temp.qx_row(id), E'\n' order by id), '')) from analytics.content_post);
    end if;
    if v_out = 'NOERR' then v_out := 'FAIL-NOT-REJECTED'; end if;
    raise exception 'qa_rollback' using errcode = 'QA001';
  exception
    when sqlstate 'QA001' then null;
    when others then
      v_out := 'ERR ' || sqlstate || ' ' || left(regexp_replace(sqlerrm, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<uuid>', 'g'), 120);
  end;
  return v_out;
end $f$;

do $qa160pre$
declare
  v_shop uuid;
  i int;
begin
  select id into v_shop from public.shop order by id limit 1;
  if (select count(*) from public.shop) <> 1 then raise exception 'qa-0160-pre: คาดร้านเดียว'; end if;
  for i in 1..21 loop
    insert into qa160_pre values ('U' || i, pg_temp.qx_case(i));
  end loop;
  -- snapshot ของ view ที่หน้าประวัติ/KPI/คิวใช้ (คอลัมน์ + จำนวนแถว + md5 ของทุกแถว)
  insert into qa160_pre values ('V_t7',
    (select count(*)::text from analytics.v_content_post_t7) || '/' ||
    (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum) from pg_attribute a
      where a.attrelid = 'analytics.v_content_post_t7'::regclass and a.attnum > 0 and not a.attisdropped) || '/' ||
    (select md5(coalesce(string_agg(t::text, E'\n' order by t.post_id), '')) from analytics.v_content_post_t7 t));
  insert into qa160_pre values ('V_queue',
    (select count(*)::text from analytics.v_content_entry_queue) || '/' ||
    (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum) from pg_attribute a
      where a.attrelid = 'analytics.v_content_entry_queue'::regclass and a.attnum > 0 and not a.attisdropped) || '/' ||
    (select md5(coalesce(string_agg(t::text, E'\n' order by t.post_id), '')) from analytics.v_content_entry_queue t));
  insert into qa160_pre values ('N', (select count(*)::text from qa160_pre));
  raise notice 'qa-0160-pre: baseline % รายการ (ก่อน 0159/0160) · ร้าน %', (select count(*) from qa160_pre), v_shop;
end
$qa160pre$;

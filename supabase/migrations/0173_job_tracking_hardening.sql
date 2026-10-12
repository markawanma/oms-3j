-- 0173_job_tracking_hardening.sql — แก้ J1 ตามผล security (H1 M1 M2 L1 L4) + QA (2 5 6 + ข้อสังเกต) + มติเจ้าของ 12 ต.ค. (ชื่อแบบ + น้ำหนักทองส่งต่อ)
-- ✅ APPLIED 12 ต.ค. 69 ผ่าน node scripts/run-sql.mjs --commit --record (version 20261012112304 · name 0173_job_tracking_hardening) — ห้าม apply ซ้ำ (บรรทัดนี้เพิ่มหลัง apply เป็นคอมเมนต์ล้วน)
-- แก้ต่อจาก 0172 (apply แล้ว แก้ไฟล์เดิมไม่ได้) — ตารางใหม่ 0 · เพิ่มคอลัมน์ worker.failed_window_start · แทนที่ฟังก์ชัน job_*/worker_* ที่ระบุ · ไม่แตะ oem_*/production_*
--
-- H1  worker_pin_verify: ตัวนับ PIN ผิดเดิม reset ทุก 15 นาที -> เดาเงียบๆ ได้ไม่จำกัด ·
--     ใหม่: หน้าต่าง 24 ชม. ยึดครั้งแรก (failed_window_start) · ล็อก 15 นาทีที่ครั้งที่ 5 · ตั้งแต่ครั้งที่ 10 ล็อก 1 ชม. ทุกครั้ง · ครั้งที่ 15 = ล็อกถาวร
--     (locked_until='infinity' ต้องให้ออฟฟิศปลดล็อก/รีเซ็ต PIN) · login สำเร็จ/worker_pin_set/worker_unlock ล้างหน้าต่าง ·
--     งบผิดต่อ token <= 20 ครั้ง/วัน (วันไทย) เกินแล้ว token นั้น verify ไม่ได้ (แม้ใส่ถูก) จนพิมพ์ใหม่ (token ใหม่ = hash ใหม่ = งบใหม่)
--     สาขา infinity แยก code locked_office ก่อนคำนวณ retry (extract epoch ของ infinity ทำ int overflow)
-- M1  job_core_receive: เทียบน้ำหนักรับกับน้ำหนักออกของขั้นก่อน — ทองต่างเกิน 0.05 g = handoff_mismatch (ทุกช่องทาง · ออฟฟิศแก้ได้โดยย้อนขั้นก่อนแล้วส่งใหม่) ·
--     เงิน/ทองเหลืองไม่บล็อก · v_job_stage_loss.handoff_gap_g (ต่อท้ายสุด)
-- M2  worker_unlock (owner/admin · ไม่ revoke session เดิม) + v_worker_lock ให้ออฟฟิศเห็นสถานะล็อก
-- L1  job_worker_resolve.held_by = null เมื่อไม่มี session
-- L4  rate limit: token ที่ไม่มีในระบบไม่เขียนถังนับ (ไม่เปิดช่องบวม) · ถัง ip นับเฉพาะ action เขียน (300/10นาที) และ verify PIN (100/10นาที) ·
--     resolve/โหลดหน้าไม่นับ ip (Wi-Fi เดียวทั้งโรงงาน) · ล้างแถวเก่า > 2 วันทุกครั้ง (จำกัด 200 แถว) แทนสุ่ม 2%
-- QA2 v_job_board.board_column ('awaiting_close' = ส่งต่อครบแต่ยังไม่ปิดงาน) · QA5 resolve: next_action='all_done' + job_closed สำหรับ token ที่เคยถูกต้องของใบที่ปิด/ยกเลิก
--     (แยกได้เฉพาะ hash ที่ตรงแถวจริง — token สุ่มได้ invalid_token เหมือนเดิม ไม่เปิด oracle)
-- QA6 ขั้นก่อนหน้าบังคับชั่งแต่ยังไม่มีน้ำหนักออก -> ไม่ auto-close (prev_not_sent) ทุกโลหะ
-- QA-อื่น job_pin_ok ปฏิเสธรูปซ้ำคู่ (1212 1313) · worker_upsert ปฏิเสธ stage_codes ว่าง + ชื่อผ่าน oem_customer_text_clean · ข้าม QC/แพ็กไม่ได้ (RPC + trigger)
-- ชื่อแบบ: job_create_from_quote_item บังคับ p_design_label (ออฟฟิศตั้ง/ยืนยัน) · job_design_label_set แก้ทีหลังได้ (job_guard ยอมแก้ design_label เฉพาะใบที่ยังไม่ปิด)
-- สัญญา RPC ที่เปลี่ยน: ดูสรุปท้ายรอบ (code ใหม่ locked_office token_budget_exhausted handoff_mismatch all_done · board_column · worker_unlock · job_design_label_set)

create temp table _j173_fn_base on commit drop as
select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h
from pg_proc p
where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
  and (p.proname like 'oem\_%' or p.proname like 'production\_%');

create temp table _j173_col_base on commit drop as
select md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''),
                      ',' order by table_name, ordinal_position)) as h,
       count(*) as n
from information_schema.columns
where table_schema = 'analytics'
  and (table_name like 'oem\_%' or table_name like 'v\_oem\_%' or table_name like 'production\_order%' or table_name like 'v\_production\_order%');


-- ============================================================================
-- 1. schema: หน้าต่างนับ PIN ผิด · action 'unlock' ใน worker_audit · ตัวนับกลาง
-- ============================================================================
alter table analytics.worker add column failed_window_start timestamptz;
comment on column analytics.worker.failed_window_start is
  '0173: เวลาที่ PIN ผิดครั้งแรกของหน้าต่าง 24 ชม. (ยึดครั้งแรก ไม่เลื่อนตามครั้งหลัง) · null = ไม่มีหน้าต่างค้าง';

alter table analytics.worker_audit drop constraint worker_audit_action_check;
alter table analytics.worker_audit add constraint worker_audit_action_check
  check (action in ('create', 'update', 'deactivate', 'reactivate', 'pin_set', 'unlock'));

-- เพิ่มตัวนับ (key, window) แล้วคืนค่าใหม่ — ใช้กับถัง rate limit และงบผิดต่อ token
create or replace function analytics.job_counter_bump(p_key text, p_window timestamptz)
 returns int
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare v int;
begin
  insert into analytics.worker_rate_limit as r (key, window_start, hits) values (p_key, p_window, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into v;
  return v;
end;
$f$;


create or replace function analytics.job_rate_limit_hit(p_key text, p_max int)
 returns boolean
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_win  timestamptz := to_timestamp(floor(extract(epoch from now()) / 600) * 600);
  v_hits int;
begin
  -- ล้างแถวเก่าทุกครั้ง (จำกัด 200 แถว/ครั้ง ใช้ index window_start) — เดิมสุ่ม 2% ไม่แน่นอน (security L4)
  delete from analytics.worker_rate_limit
   where ctid = any (array(select w.ctid from analytics.worker_rate_limit w where w.window_start < now() - interval '2 days' limit 200));
  insert into analytics.worker_rate_limit as r (key, window_start, hits)
  values (p_key, v_win, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  return v_hits <= p_max;
end;
$f$;

-- ============================================================================
-- 2. job_worker_auth ฉบับใหม่ (เพิ่ม p_ip_class -> signature เปลี่ยน ต้อง drop ตัวเดิมก่อน กัน overload — migration-traps ข้อ 1)
--    ลำดับ: ถัง ip (เฉพาะ write/pin) -> รูปแบบ hash -> หา token (ทุกสถานะ) ไม่พบ = invalid_token โดยไม่เขียนถังใดๆ ->
--    ถังต่อ token (เฉพาะ token ที่มีจริง) -> token ถูกเพิกถอน: ใบ done/cancelled = job_closed, นอกนั้น invalid_token ->
--    lock ใบ -> ตรวจ token ซ้ำ -> ใบปิด = job_closed -> session + worker.is_active สด
-- ============================================================================
drop function if exists analytics.job_worker_auth(text, text, text, boolean, boolean);

create or replace function analytics.job_worker_auth(
  p_token_hash       text,
  p_session_hash     text,
  p_ip_hash          text,
  p_require_session  boolean,
  p_lock             boolean,
  p_ip_class         text
)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_tok    analytics.job_token%rowtype;
  v_job    analytics.job%rowtype;
  v_w      analytics.worker%rowtype;
  v_status text;
  v_jno    text;
begin
  if p_ip_class in ('write', 'pin') and p_ip_hash is not null and p_ip_hash ~ '^[0-9a-f]{64}$' then
    if not analytics.job_rate_limit_hit(case p_ip_class when 'pin' then 'ipp:' else 'ipw:' end || left(p_ip_hash, 32),
                                        case p_ip_class when 'pin' then 100 else 300 end) then
      return analytics.job_fail('rate_limited', 'ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
    end if;
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return analytics.job_fail('invalid_token', 'ลิงก์หรือ QR นี้ใช้ไม่ได้ — ขอพิมพ์ใบงานใหม่จากออฟฟิศ');
  end if;

  select * into v_tok from analytics.job_token t where t.token_hash = p_token_hash;
  if not found then
    -- token สุ่ม: ไม่เขียนอะไรลงถัง (กันตารางบวมจากการยิงสุ่ม) — พึ่งเพดาน ip ของ action เขียน/verify PIN
    return analytics.job_fail('invalid_token', 'ลิงก์หรือ QR นี้ใช้ไม่ได้ — ขอพิมพ์ใบงานใหม่จากออฟฟิศ');
  end if;
  if not analytics.job_rate_limit_hit('tok:' || left(p_token_hash, 32), 60) then
    return analytics.job_fail('rate_limited', 'ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
  end if;

  if v_tok.revoked_at is not null then
    -- แยก "ใบปิดแล้ว" ออกจาก "QR ถูกแทนที่" ได้เฉพาะเมื่อ hash ตรงแถวจริงเท่านั้น (ผู้ถือ QR ใบนั้นเอง)
    select j.status, j.job_no into v_status, v_jno from analytics.job j where j.id = v_tok.job_id;
    if v_status in ('done', 'cancelled') then
      return analytics.job_fail('job_closed', 'ใบงานนี้ปิดแล้ว', jsonb_build_object('job_no', v_jno));
    end if;
    return analytics.job_fail('invalid_token', 'ลิงก์หรือ QR นี้ใช้ไม่ได้ — ขอพิมพ์ใบงานใหม่จากออฟฟิศ');
  end if;

  if p_lock then
    select * into v_job from analytics.job j where j.id = v_tok.job_id for update;
    perform 1 from analytics.job_token t where t.id = v_tok.id and t.revoked_at is null;
    if not found then
      return analytics.job_fail('invalid_token', 'ลิงก์หรือ QR นี้ใช้ไม่ได้ — ขอพิมพ์ใบงานใหม่จากออฟฟิศ');
    end if;
  else
    select * into v_job from analytics.job j where j.id = v_tok.job_id;
  end if;
  if v_job.status in ('done', 'cancelled') then
    return analytics.job_fail('job_closed', 'ใบงานนี้ปิดแล้ว', jsonb_build_object('job_no', v_job.job_no));
  end if;

  if p_session_hash is not null and p_session_hash ~ '^[0-9a-f]{64}$' then
    select w.* into v_w
      from analytics.worker_session s
      join analytics.worker w on w.id = s.worker_id and w.shop_id = s.shop_id
     where s.session_hash = p_session_hash and s.revoked_at is null and s.expires_at > now()
       and w.is_active and w.shop_id = v_job.shop_id;
  end if;
  if p_require_session and v_w.id is null then
    return analytics.job_fail('session_required', 'กรุณาเลือกชื่อและใส่ PIN ก่อน', jsonb_build_object('job_no', v_job.job_no));
  end if;
  return jsonb_build_object('ok', true, 'job_id', v_job.id, 'shop_id', v_job.shop_id, 'worker_id', v_w.id,
                            'worker_name', v_w.display_name, 'session_expired', p_session_hash is not null and v_w.id is null);
end;
$f$;


-- ============================================================================
-- 3. worker_pin_verify ฉบับใหม่ (H1) + worker_unlock (M2)
-- ============================================================================
create or replace function analytics.worker_pin_verify(
  p_token_hash text,
  p_worker_id  uuid,
  p_pin        text,
  p_user_agent text default null,
  p_ip_hash    text default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a     jsonb;
  v_w     analytics.worker%rowtype;
  v_att   int;
  v_raw   text;
  v_exp   timestamptz;
  v_lock  timestamptz;
  v_day   timestamptz := date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
  v_bkey  text;
  v_spent int;
  v_new   boolean;
begin
  v_a := analytics.job_worker_auth(p_token_hash, null, p_ip_hash, false, false, 'pin');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;

  -- งบผิดต่อ token ต่อวัน (<= 20): เกินแล้ว token นี้ verify ไม่ได้อีก แม้ใส่ถูก — ต้องพิมพ์ใบงานใหม่ (hash ใหม่ = งบใหม่)
  v_bkey := 'pf:' || left(p_token_hash, 32);
  select r.hits into v_spent from analytics.worker_rate_limit r where r.key = v_bkey and r.window_start = v_day;
  if coalesce(v_spent, 0) >= 20 then
    return analytics.job_fail('token_budget_exhausted', 'ใส่ PIN ผิดครบกำหนดของใบงานนี้ในวันนี้แล้ว — ให้ออฟฟิศพิมพ์ใบงานใหม่');
  end if;

  select * into v_w from analytics.worker w where w.id = p_worker_id and w.shop_id = (v_a ->> 'shop_id')::uuid for update;
  if not found or not v_w.is_active then
    return analytics.job_fail('bad_credentials', 'ชื่อหรือ PIN ไม่ถูกต้อง');
  end if;
  if v_w.locked_until is not null and v_w.locked_until > now() then
    -- ล็อกถาวร (infinity) แยกก่อนคำนวณ retry — extract(epoch from infinity) ทำ int overflow
    if v_w.locked_until = 'infinity'::timestamptz then
      return analytics.job_fail('locked_office', 'บัญชีช่างถูกล็อกเพราะใส่ PIN ผิดหลายครั้ง — ให้ออฟฟิศปลดล็อกหรือรีเซ็ต PIN');
    end if;
    return analytics.job_fail('locked', 'ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว — ลองใหม่ภายหลัง หรือให้ออฟฟิศรีเซ็ต PIN',
                              jsonb_build_object('locked_until', v_w.locked_until,
                                                 'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_w.locked_until - now())))::int)));
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return analytics.job_fail('bad_credentials', 'ชื่อหรือ PIN ไม่ถูกต้อง');
  end if;

  if extensions.crypt(p_pin, v_w.pin_hash) = v_w.pin_hash then
    update analytics.worker set failed_attempts = 0, failed_window_start = null, last_failed_at = null, locked_until = null where id = v_w.id;
    delete from analytics.worker_session where expires_at < now() - interval '1 day';
    v_raw := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
    v_exp := clock_timestamp() + interval '12 hours';
    insert into analytics.worker_session (shop_id, worker_id, session_hash, expires_at, device_hint)
    values (v_w.shop_id, v_w.id, analytics.job_sha256_hex(v_raw), v_exp, analytics.job_device_hint(p_user_agent, p_ip_hash));
    return jsonb_build_object('ok', true, 'session_token', v_raw, 'expires_at', v_exp,
                              'worker', jsonb_build_object('id', v_w.id, 'display_name', v_w.display_name));
  end if;

  -- PIN ผิด: นับสะสมในหน้าต่าง 24 ชม. ที่ยึดครั้งแรก (เว้นระยะนานแค่ไหนก็ยังนับ) · ล็อก 15 นาทีที่ครั้งที่ 5 · >= 10 ล็อก 1 ชม. · 15 ล็อกถาวร
  v_new := v_w.failed_window_start is null or v_w.failed_window_start < now() - interval '24 hours';
  v_att := case when v_new then 1 else v_w.failed_attempts + 1 end;
  v_spent := analytics.job_counter_bump(v_bkey, v_day);
  v_lock := case when v_att >= 15 then 'infinity'::timestamptz
                 when v_att >= 10 then now() + interval '1 hour'
                 when v_att = 5 then now() + interval '15 minutes'
                 else null end;
  update analytics.worker
     set failed_attempts = v_att, last_failed_at = now(), locked_until = v_lock,
         failed_window_start = case when v_new then now() else failed_window_start end
   where id = v_w.id;
  if v_lock = 'infinity'::timestamptz then
    return analytics.job_fail('locked_office', 'บัญชีช่างถูกล็อกเพราะใส่ PIN ผิดหลายครั้ง — ให้ออฟฟิศปลดล็อกหรือรีเซ็ต PIN');
  elsif v_lock is not null then
    return analytics.job_fail('locked', 'ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว — ลองใหม่ภายหลัง หรือให้ออฟฟิศรีเซ็ต PIN',
                              jsonb_build_object('locked_until', v_lock, 'retry_after_seconds', case when v_att >= 10 then 3600 else 900 end));
  end if;
  return analytics.job_fail('bad_credentials', 'ชื่อหรือ PIN ไม่ถูกต้อง',
    jsonb_build_object('attempts_left', case when v_att < 5 then 5 - v_att when v_att < 10 then 10 - v_att else 1 end,
                       'attempts_until_office', 15 - v_att, 'token_budget_left', greatest(0, 20 - v_spent)));
end;
$f$;

-- ปลดล็อกช่าง (owner/admin) — ล้างตัวนับ+หน้าต่าง+การล็อก (รวมล็อกถาวร) · ไม่ revoke session เดิม (ต่างจาก worker_pin_set)
create or replace function analytics.worker_unlock(p_shop_id uuid, p_worker_id uuid, p_actor uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_w     analytics.worker%rowtype;
begin
  if p_shop_id is null or p_worker_id is null then
    raise exception 'worker_unlock: p_shop_id และ p_worker_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'worker_unlock: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  select * into v_w from analytics.worker where id = p_worker_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'ไม่พบช่างในร้านนี้' using errcode = '22023', hint = 'worker_not_found';
  end if;
  update analytics.worker set failed_attempts = 0, failed_window_start = null, last_failed_at = null, locked_until = null where id = p_worker_id;
  insert into analytics.worker_audit (shop_id, worker_id, action, actor, detail)
  values (p_shop_id, p_worker_id, 'unlock', v_actor,
          jsonb_build_object('was_locked', v_w.locked_until is not null and v_w.locked_until > now(),
                             'was_permanent', v_w.locked_until = 'infinity'::timestamptz, 'failed_attempts', v_w.failed_attempts));
  return jsonb_build_object('worker_id', p_worker_id, 'unlocked', true,
                            'was_locked', v_w.locked_until is not null and v_w.locked_until > now());
end;
$f$;


create or replace function analytics.worker_pin_set(p_shop_id uuid, p_worker_id uuid, p_pin text default null, p_actor uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_pin   text;
  v_gen   boolean := false;
  v_w     analytics.worker%rowtype;
begin
  if p_shop_id is null or p_worker_id is null then
    raise exception 'worker_pin_set: p_shop_id และ p_worker_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'worker_pin_set: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  select * into v_w from analytics.worker where id = p_worker_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'ไม่พบช่างในร้านนี้' using errcode = '22023', hint = 'worker_not_found';
  end if;
  v_pin := p_pin;
  if v_pin is null then
    v_pin := analytics.job_pin_generate();
    v_gen := true;
  elsif not analytics.job_pin_ok(v_pin) then
    raise exception 'PIN ต้องเป็นตัวเลข 4 หลัก และห้ามเป็นเลขซ้ำ/เรียงต่อเนื่อง/เดาง่าย' using errcode = '22023', hint = 'pin_invalid';
  end if;
  -- รีเซ็ต PIN = ปลดล็อก + ล้างตัวนับ + ทุก session เดิมของช่างคนนี้หมดอายุทันที
  update analytics.worker
     set pin_hash = extensions.crypt(v_pin, extensions.gen_salt('bf', 8)), failed_attempts = 0, failed_window_start = null, last_failed_at = null, locked_until = null
   where id = p_worker_id;
  update analytics.worker_session set revoked_at = clock_timestamp() where worker_id = p_worker_id and revoked_at is null;
  insert into analytics.worker_audit (shop_id, worker_id, action, actor, detail)
  values (p_shop_id, p_worker_id, 'pin_set', v_actor, jsonb_build_object('pin_generated', v_gen));
  return jsonb_build_object('worker_id', p_worker_id, 'pin', case when v_gen then v_pin else null end, 'pin_generated', v_gen);
end;
$f$;

create or replace function analytics.job_pin_ok(p_pin text)
 returns boolean
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $f$
  select p_pin ~ '^[0-9]{4}$'
     and p_pin !~ '^(.)\1{3}$'
     and p_pin !~ '^(..)\1$'
     and p_pin <> all (array['0123', '1234', '2345', '3456', '4567', '5678', '6789', '3210', '4321', '5432', '6543', '7654', '8765', '9876', '0000', '2580'])
$f$;

create or replace function analytics.worker_upsert(
  p_shop_id      uuid,
  p_id           uuid default null,
  p_display_name text default null,
  p_stage_codes  text[] default '{}',
  p_pin          text default null,
  p_actor        uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_name  text;
  v_codes text[];
  v_pin   text;
  v_w     analytics.worker%rowtype;
  v_gen   boolean := false;
begin
  if p_shop_id is null then
    raise exception 'worker_upsert: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'worker_upsert: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  -- ชื่อช่างผ่านด่านเดียวกับชื่อลูกค้า OEM (ห้าม control/bidi/ล่องหน) แล้วค่อยบังคับมีตัวอักษรจริง ≤ 60
  v_name := analytics.job_text_clean(analytics.oem_customer_text_clean(p_display_name, 'ชื่อช่าง'), 'ชื่อช่าง', 60, true);
  v_codes := analytics.worker_codes_clean(p_shop_id, p_stage_codes);
  if cardinality(v_codes) = 0 then
    raise exception 'ต้องเลือกขั้นตอนที่ช่างทำได้อย่างน้อย 1 ขั้น (ไม่รองรับ "ทุกขั้น" แบบเว้นว่างอีกต่อไป)' using errcode = '22023', hint = 'stages_required';
  end if;

  if p_id is null then
    v_pin := p_pin;
    if v_pin is null then
      v_pin := analytics.job_pin_generate();
      v_gen := true;
    elsif not analytics.job_pin_ok(v_pin) then
      raise exception 'PIN ต้องเป็นตัวเลข 4 หลัก และห้ามเป็นเลขซ้ำ/เรียงต่อเนื่อง/เดาง่าย' using errcode = '22023', hint = 'pin_invalid';
    end if;
    begin
      insert into analytics.worker (shop_id, display_name, stage_codes, pin_hash, created_by)
      values (p_shop_id, v_name, v_codes, extensions.crypt(v_pin, extensions.gen_salt('bf', 8)), v_actor)
      returning * into v_w;
    exception when unique_violation then
      raise exception 'มีช่างชื่อ "%" อยู่แล้ว', v_name using errcode = '22023', hint = 'worker_name_taken';
    end;
    insert into analytics.worker_audit (shop_id, worker_id, action, actor, detail)
    values (p_shop_id, v_w.id, 'create', v_actor, jsonb_build_object('display_name', v_name, 'stage_codes', to_jsonb(v_codes), 'pin_generated', v_gen));
    return jsonb_build_object('id', v_w.id, 'display_name', v_w.display_name, 'stage_codes', to_jsonb(v_w.stage_codes),
                              'pin', case when v_gen then v_pin else null end, 'pin_generated', v_gen);
  end if;

  if p_pin is not null then
    raise exception 'แก้ช่างเดิมไม่รับ PIN — ใช้ worker_pin_set เพื่อรีเซ็ต PIN' using errcode = '22023', hint = 'use_pin_set';
  end if;
  select * into v_w from analytics.worker where id = p_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'ไม่พบช่างในร้านนี้' using errcode = '22023', hint = 'worker_not_found';
  end if;
  begin
    update analytics.worker set display_name = v_name, stage_codes = v_codes where id = p_id returning * into v_w;
  exception when unique_violation then
    raise exception 'มีช่างชื่อ "%" อยู่แล้ว', v_name using errcode = '22023', hint = 'worker_name_taken';
  end;
  insert into analytics.worker_audit (shop_id, worker_id, action, actor, detail)
  values (p_shop_id, p_id, 'update', v_actor, jsonb_build_object('display_name', v_name, 'stage_codes', to_jsonb(v_codes)));
  return jsonb_build_object('id', v_w.id, 'display_name', v_w.display_name, 'stage_codes', to_jsonb(v_w.stage_codes), 'pin', null, 'pin_generated', false);
end;
$f$;

create or replace function analytics.job_stage_skip(p_shop_id uuid, p_job_id uuid, p_stage_code text, p_reason text, p_actor uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor  uuid := coalesce(p_actor, auth.uid());
  v_job    analytics.job%rowtype;
  v_s      analytics.job_stage%rowtype;
  v_s2     analytics.job_stage%rowtype;
  v_reason text;
begin
  v_job := analytics.job_office_begin('job_stage_skip', p_shop_id, p_job_id, v_actor);
  v_reason := analytics.job_text_clean(p_reason, 'เหตุผลที่ข้ามขั้น', 200, true);
  select * into v_s from analytics.job_stage where job_id = p_job_id and stage_code = p_stage_code;
  if not found then
    raise exception 'ใบงานนี้ไม่มีขั้นตอนที่ระบุ' using errcode = '22023', hint = 'stage_not_found';
  end if;
  if v_s.stage_code in ('qc', 'pack') then
    raise exception 'ข้ามขั้น QC และแพ็กไม่ได้ — ทุกใบงานต้องผ่านสองขั้นนี้' using errcode = '22023', hint = 'stage_required';
  end if;
  if v_s.status <> 'pending' then
    raise exception 'ข้ามได้เฉพาะขั้นที่ยังไม่ได้รับงาน (ขั้นนี้สถานะ %)', v_s.status using errcode = '22023', hint = 'stage_not_pending';
  end if;
  update analytics.job_stage set status = 'skipped', skip_reason = v_reason where id = v_s.id returning * into v_s2;
  perform analytics.job_event_write(p_job_id, v_s.id, 'stage_skip', analytics.job_today(), v_actor, null, 'job_page', null,
    jsonb_build_object('stage_code', v_s.stage_code, 'reason', v_reason,
                       'before', analytics.job_stage_state(v_s), 'after', analytics.job_stage_state(v_s2)));
  return jsonb_build_object('ok', true, 'job_no', v_job.job_no, 'stage_code', v_s.stage_code, 'status', 'skipped');
end;
$f$;

create or replace function analytics.job_stage_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job    analytics.job%rowtype;
  v_prev   analytics.job_stage%rowtype;
  v_exp_in int;
begin
  if tg_op = 'DELETE' then
    raise exception 'job_stage: ห้ามลบขั้นของใบงาน' using errcode = '22023';
  end if;
  select * into v_job from analytics.job where id = new.job_id;
  if not found then
    raise exception 'job_stage: ไม่พบใบงาน' using errcode = '22023';
  end if;
  if new.shop_id is null then
    new.shop_id := v_job.shop_id;
  elsif new.shop_id <> v_job.shop_id then
    raise exception 'job_stage: ขั้นต้องอยู่ร้านเดียวกับใบงาน' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    if v_job.status <> 'open' then
      raise exception 'job_stage: เพิ่มขั้นได้เฉพาะตอนสร้างใบงาน' using errcode = '22023';
    end if;
    if new.status <> 'pending' then
      raise exception 'job_stage: ขั้นใหม่ต้องเริ่มที่ pending' using errcode = '22023';
    end if;
    if not exists (select 1 from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = new.stage_code and d.is_active) then
      raise exception 'job_stage: ขั้น % ถูกปิดใช้งานหรือไม่มีในทะเบียน', new.stage_code using errcode = '22023';
    end if;
    -- ลำดับใน job ต้องไม่ขัดกับ seq_default ของทะเบียน (design §3 ข้อ 12)
    if exists (
         select 1
           from analytics.job_stage s
           join analytics.job_stage_def d  on d.shop_id = s.shop_id and d.code = s.stage_code
           join analytics.job_stage_def dn on dn.shop_id = new.shop_id and dn.code = new.stage_code
          where s.job_id = new.job_id
            and ((s.seq < new.seq and d.seq_default > dn.seq_default) or (s.seq > new.seq and d.seq_default < dn.seq_default))) then
      raise exception 'job_stage: ลำดับขั้นต้องเรียงตามลำดับมาตรฐานของทะเบียนขั้นตอน' using errcode = '22023';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.job_id <> old.job_id or new.shop_id <> old.shop_id or new.stage_code <> old.stage_code
     or new.seq <> old.seq or new.weigh_required <> old.weigh_required then
    raise exception 'job_stage: ห้ามเปลี่ยนใบงาน/ขั้น/ลำดับ/กติกาชั่งของขั้นที่สร้างแล้ว' using errcode = '22023';
  end if;
  if v_job.status in ('done', 'cancelled') then
    raise exception 'job_stage: ใบงาน % สถานะ % แล้ว แก้ขั้นไม่ได้', v_job.job_no, v_job.status using errcode = '22023';
  end if;

  if new.status = old.status then
    if old.status in ('received', 'sent') and analytics.job_stage_state(new) is distinct from analytics.job_stage_state(old) then
      raise exception 'job_stage: ขั้นที่รับ/ส่งแล้วแก้ตรงไม่ได้ — ใช้ย้อนขั้น (job_stage_reopen) พร้อมเหตุผล' using errcode = '22023';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if old.status = 'pending' and new.status = 'received' then
    if v_job.status = 'on_hold' then
      raise exception 'job_stage: ใบงานถูกพักอยู่ รับงานไม่ได้' using errcode = '22023';
    end if;
    if exists (select 1 from analytics.job_stage s where s.job_id = new.job_id and s.seq < new.seq and s.status = 'pending') then
      raise exception 'job_stage: รับงานข้ามลำดับไม่ได้ — ขั้นก่อนหน้ายังไม่มีใครรับหรือข้าม' using errcode = '22023';
    end if;
    if exists (select 1 from analytics.job_stage s where s.job_id = new.job_id and s.id <> new.id and s.status = 'received') then
      raise exception 'job_stage: ยังมีขั้นอื่นที่รับค้างอยู่ — ต้องส่งต่อก่อน' using errcode = '22023';
    end if;
    select * into v_prev from analytics.job_stage s
     where s.job_id = new.job_id and s.seq < new.seq and s.status <> 'skipped' order by s.seq desc limit 1;
    if found then
      if v_prev.status <> 'sent' then
        raise exception 'job_stage: ขั้นก่อนหน้ายังไม่ถูกส่งต่อ' using errcode = '22023';
      end if;
      v_exp_in := v_prev.qty_out;
      if new.received_on < v_prev.sent_on then
        raise exception 'job_stage: วันรับ (%) ต้องไม่ก่อนวันส่งของขั้นก่อนหน้า (%)', new.received_on, v_prev.sent_on using errcode = '22023';
      end if;
    else
      v_exp_in := v_job.qty_planned;
    end if;
    if new.qty_in is distinct from v_exp_in then
      raise exception 'job_stage: จำนวนเข้า (%) ต้องเท่าจำนวนที่ส่งออกจากขั้นก่อนหน้า (%)', new.qty_in, v_exp_in using errcode = '22023';
    end if;
  elsif old.status = 'pending' and new.status = 'skipped' then
    if new.stage_code in ('qc', 'pack') then
      raise exception 'job_stage: ข้ามขั้น QC และแพ็กไม่ได้' using errcode = '22023';
    end if;
  elsif old.status = 'received' and new.status = 'sent' then
    if new.auto_closed and v_job.metal = 'gold' then
      raise exception 'job_stage: งานทองปิดขั้นอัตโนมัติไม่ได้ — ต้องกดส่งต่อพร้อมน้ำหนักออก' using errcode = '22023';
    end if;
  elsif (old.status = 'received' and new.status = 'pending')
     or (old.status = 'sent' and new.status = 'received')
     or (old.status = 'skipped' and new.status = 'pending') then
    -- ย้อนขั้น: ทำได้เมื่อไม่มีขั้นถัดไปที่ received/sent อยู่ (design §3 ข้อ 4)
    if exists (select 1 from analytics.job_stage s where s.job_id = new.job_id and s.seq > new.seq and s.status in ('received', 'sent')) then
      raise exception 'job_stage: ย้อนข้ามขั้นที่ขั้นถัดไปรับหรือส่งไปแล้วไม่ได้ — ย้อนทีละขั้นจากขั้นล่าสุด' using errcode = '22023';
    end if;
  else
    raise exception 'job_stage: เปลี่ยนสถานะ % -> % ไม่ได้', old.status, new.status using errcode = '22023';
  end if;

  new.updated_at := now();
  return new;
end;
$f$;

create or replace function analytics.job_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_item_shop   uuid;
  v_item_seq    int;
  v_item_input  jsonb;
  v_q_status    text;
  v_q_root      uuid;
  v_po_status   text;
  v_poi_product uuid;
  v_prod_shop   uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'job: ห้ามลบใบงาน — ยกเลิกด้วย job_cancel แทน (เก็บไว้เป็นหลักฐานการผลิต)' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'open' or new.done_at is not null or new.cancelled_at is not null
       or new.qty_good is not null or new.qty_scrap is not null or new.weight_final_g is not null then
      raise exception 'job: ใบงานใหม่ต้องเริ่มที่สถานะ open และยังไม่มีผลปิดงาน' using errcode = '22023';
    end if;
    if new.source_kind = 'oem' then
      select i.shop_id, i.seq, i.input, q.status, coalesce(q.root_quote_id, q.id)
        into v_item_shop, v_item_seq, v_item_input, v_q_status, v_q_root
        from analytics.oem_quote_item i
        join analytics.oem_quote q on q.id = i.quote_id
       where i.id = new.oem_quote_item_id;
      if not found then
        raise exception 'job: ไม่พบรายการใบเสนอราคา' using errcode = '22023';
      end if;
      if v_item_shop <> new.shop_id then
        raise exception 'job: รายการใบเสนอราคาเป็นของร้านอื่น สร้างใบงานข้ามร้านไม่ได้' using errcode = '22023';
      end if;
      if v_q_status <> 'won' then
        raise exception 'job: สร้างใบงานได้เฉพาะใบเสนอราคาที่ได้งานแล้ว (won) — ใบนี้สถานะ %', v_q_status using errcode = '22023';
      end if;
      if new.root_quote_id <> v_q_root or new.oem_item_seq <> v_item_seq then
        raise exception 'job: ดีล/ลำดับรายการไม่ตรงกับใบเสนอราคา' using errcode = '22023';
      end if;
      if new.metal is distinct from (v_item_input ->> 'metal') then
        raise exception 'job: โลหะของใบงานไม่ตรงกับรายการใบเสนอราคา' using errcode = '22023';
      end if;
    else
      select poi.shop_id, po.status, poi.product_id
        into v_item_shop, v_po_status, v_poi_product
        from analytics.production_order_item poi
        join analytics.production_order po on po.id = poi.production_order_id
       where poi.id = new.production_order_item_id;
      if not found then
        raise exception 'job: ไม่พบรายการในใบผลิต' using errcode = '22023';
      end if;
      if v_item_shop <> new.shop_id then
        raise exception 'job: รายการใบผลิตเป็นของร้านอื่น สร้างใบงานข้ามร้านไม่ได้' using errcode = '22023';
      end if;
      if v_po_status <> 'open' then
        raise exception 'job: สร้างใบงานได้เฉพาะใบผลิตที่ยังเปิดอยู่ (open) — ใบนี้สถานะ %', v_po_status using errcode = '22023';
      end if;
      if new.product_id is distinct from v_poi_product then
        raise exception 'job: สินค้าของใบงานไม่ตรงกับรายการใบผลิต' using errcode = '22023';
      end if;
    end if;
    if new.product_id is not null then
      select p.shop_id into v_prod_shop from public.product p where p.id = new.product_id;
      if v_prod_shop is distinct from new.shop_id then
        raise exception 'job: สินค้าเป็นของร้านอื่น' using errcode = '22023';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.shop_id <> old.shop_id or new.seq <> old.seq or new.source_kind <> old.source_kind
     or new.oem_quote_item_id is distinct from old.oem_quote_item_id
     or new.root_quote_id is distinct from old.root_quote_id
     or new.oem_item_seq is distinct from old.oem_item_seq
     or new.production_order_item_id is distinct from old.production_order_item_id
     or new.product_id is distinct from old.product_id
     or new.sku_snapshot is distinct from old.sku_snapshot
     or new.metal <> old.metal or new.qty_planned <> old.qty_planned or new.weigh_required <> old.weigh_required
     or new.created_at <> old.created_at or new.created_by <> old.created_by then
    raise exception 'job: ห้ามเปลี่ยนข้อมูลตั้งต้นของใบงาน (ร้าน/เลขที่/ต้นทาง/แบบ/โลหะ/จำนวน) — ยกเลิกแล้วสร้างใหม่' using errcode = '22023';
  end if;
  if old.status in ('done', 'cancelled') then
    raise exception 'job: ใบงาน % สถานะ % แล้ว แก้ไม่ได้', old.job_no, old.status using errcode = '22023';
  end if;
  if new.status <> old.status and not (
       (old.status = 'open' and new.status in ('in_progress', 'on_hold', 'done', 'cancelled'))
    or (old.status = 'in_progress' and new.status in ('open', 'on_hold', 'done', 'cancelled'))
    or (old.status = 'on_hold' and new.status in ('open', 'in_progress', 'done', 'cancelled'))) then
    raise exception 'job: เปลี่ยนสถานะ % -> % ไม่ได้', old.status, new.status using errcode = '22023';
  end if;
  if new.status = 'done' and exists (
       select 1 from analytics.job_stage s where s.job_id = new.id and s.status in ('pending', 'received')) then
    raise exception 'job: ปิดงานไม่ได้ — ยังมีขั้นที่ยังไม่รับ/ยังไม่ส่งต่อ' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$f$;

create or replace function analytics.job_core_receive(
  p_job_id        uuid,
  p_expected_seq  int,
  p_occurred_on   date,
  p_weight_in     numeric,
  p_worker_id     uuid,
  p_assignee      text,
  p_channel       text,
  p_actor         uuid,
  p_device_hint   text,
  p_enforce_scope boolean
)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job     analytics.job%rowtype;
  v_t       analytics.job_stage%rowtype;
  v_t2      analytics.job_stage%rowtype;
  v_p       analytics.job_stage%rowtype;
  v_p2      analytics.job_stage%rowtype;
  v_today   date := analytics.job_today();
  v_codes   text[];
  v_name    text;
  v_paid    numeric;
  v_def     text;
  v_auto    text := null;
  v_gap     numeric := null;
begin
  select * into v_job from analytics.job where id = p_job_id;
  if not found then
    return analytics.job_fail('job_not_found', 'ไม่พบใบงาน');
  end if;
  if v_job.status in ('done', 'cancelled') then
    return analytics.job_fail('job_closed', 'ใบงานนี้ปิดแล้ว รับงานไม่ได้');
  end if;
  if v_job.status = 'on_hold' then
    return analytics.job_fail('job_on_hold', 'ใบงานนี้ถูกพักไว้ รับงานไม่ได้ — แจ้งออฟฟิศ');
  end if;
  if p_expected_seq is null then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;

  select * into v_t from analytics.job_stage where job_id = p_job_id and seq = p_expected_seq;
  if not found then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  if v_t.status = 'received' then
    select coalesce(w.display_name, v_t.assignee_name, 'ผู้รับก่อนหน้า') into v_name
      from (select 1) x left join analytics.worker w on w.id = v_t.worker_id;
    return analytics.job_fail('already_received', format('ขั้นนี้ถูกรับไปแล้วโดย %s', v_name), jsonb_build_object('by', v_name));
  end if;
  if v_t.status <> 'pending' then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  if exists (select 1 from analytics.job_stage s where s.job_id = p_job_id and s.seq < v_t.seq and s.status = 'pending') then
    return analytics.job_fail('out_of_order', 'รับงานข้ามลำดับไม่ได้ — ขั้นก่อนหน้ายังไม่มีใครรับหรือข้าม');
  end if;

  -- วันที่: ช่างผ่าน QR = วันนี้เสมอ · ออฟฟิศย้อนได้ <= 14 วัน ไม่อนาคต (design §3 ข้อ 9 · มติ Q3)
  if p_occurred_on is null
     or p_occurred_on > v_today
     or (p_channel = 'worker_qr' and p_occurred_on <> v_today)
     or p_occurred_on < v_today - 14 then
    return analytics.job_fail('date_invalid', 'วันที่รับงานต้องไม่ใช่อนาคตและย้อนหลังได้ไม่เกิน 14 วัน (ช่างสแกนผ่าน QR ใช้วันนี้เท่านั้น)');
  end if;

  if p_worker_id is null and p_assignee is null then
    return analytics.job_fail('who_required', 'ต้องระบุผู้รับงาน');
  end if;
  if p_enforce_scope and p_worker_id is not null then
    select w.stage_codes into v_codes from analytics.worker w where w.id = p_worker_id;
    if coalesce(cardinality(v_codes), 0) > 0 and not (v_t.stage_code = any (v_codes)) then
      select d.name_th into v_def from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_t.stage_code;
      return analytics.job_fail('stage_not_allowed', format('งานนี้อยู่ขั้น "%s" ซึ่งคุณไม่ได้รับผิดชอบ', coalesce(v_def, v_t.stage_code)));
    end if;
  end if;

  if not analytics.job_weight_ok(p_weight_in) then
    return analytics.job_fail('weight_invalid', 'น้ำหนักเข้าต้องมากกว่า 0 และไม่เกิน 100,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)');
  end if;
  if v_t.weigh_required and p_weight_in is null then
    return analytics.job_fail('weight_required', 'ขั้นนี้ต้องชั่งน้ำหนักก่อนรับงาน');
  end if;

  -- ด่านมัดจำ (design §3 ข้อ 13 · มติ Q4): รับขั้นแรกของงาน OEM ที่ดีลยังไม่มีเงินเข้าเลย ต้องมีเหตุผลที่ออฟฟิศบันทึกไว้
  if v_job.source_kind = 'oem'
     and not exists (select 1 from analytics.job_stage s where s.job_id = p_job_id and s.status in ('received', 'sent')) then
    select coalesce(v.paid_thb, 0) into v_paid
      from analytics.oem_quote_item i
      join analytics.v_oem_quote v on v.id = i.quote_id
     where i.id = v_job.oem_quote_item_id;
    if coalesce(v_paid, 0) <= 0 and v_job.start_gate_note is null then
      return analytics.job_fail('awaiting_deposit', 'รอมัดจำ — ดีลนี้ยังไม่มีเงินเข้า แจ้งออฟฟิศให้บันทึกเหตุผลก่อนเริ่มงาน');
    end if;
  end if;

  -- ขั้นก่อนหน้า (ข้ามขั้นที่ skipped): ถ้ายังถือค้าง = ปิดอัตโนมัติ (ยกเว้นทอง) — ยืนยันฝ่ายเดียว (design §5.1 ข้อ 4)
  select * into v_p from analytics.job_stage s
   where s.job_id = p_job_id and s.seq < v_t.seq and s.status <> 'skipped' order by s.seq desc limit 1;
  if found then
    if v_p.status = 'received' then
      if v_job.metal = 'gold' then
        return analytics.job_fail('prev_not_sent', 'งานทอง: ขั้นก่อนหน้ายังไม่ได้กดส่งต่อ — ผู้ถือต้องกดส่งต่อพร้อมน้ำหนักออกก่อน');
      end if;
      -- QA 6: ขั้นก่อนหน้าบังคับชั่ง (เงิน: หล่อ/ตัดต้น/ขัด) และยังไม่มีน้ำหนักออก = ห้ามปิดอัตโนมัติ (ไม่งั้นรายงานน้ำหนักหายมีรูเงียบๆ)
      if v_p.weigh_required then
        return analytics.job_fail('prev_not_sent', 'ขั้นก่อนหน้าต้องชั่งน้ำหนักออกก่อน — ให้ผู้ถือกดส่งต่อพร้อมน้ำหนัก หรือแจ้งออฟฟิศกรอกแทน');
      end if;
      if p_occurred_on < v_p.received_on then
        return analytics.job_fail('date_invalid', 'วันรับต้องไม่ก่อนวันที่ขั้นก่อนหน้ารับงาน');
      end if;
      update analytics.job_stage
         set status = 'sent', sent_on = p_occurred_on, qty_out = qty_in, auto_closed = true
       where id = v_p.id
       returning * into v_p2;
      perform analytics.job_event_write(p_job_id, v_p.id, 'stage_send', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
        jsonb_build_object('stage_code', v_p.stage_code, 'auto_closed', true, 'closed_by_receive_of', v_t.stage_code,
                           'before', analytics.job_stage_state(v_p), 'after', analytics.job_stage_state(v_p2)));
      v_auto := v_p.stage_code;
      v_p := v_p2;
    elsif v_p.status <> 'sent' then
      return analytics.job_fail('out_of_order', 'รับงานข้ามลำดับไม่ได้ — ขั้นก่อนหน้ายังไม่เสร็จ');
    end if;
    if p_occurred_on < v_p.sent_on then
      return analytics.job_fail('date_invalid', 'วันรับต้องไม่ก่อนวันที่ขั้นก่อนหน้าส่งต่อ');
    end if;
  end if;

  -- M1: น้ำหนักที่รับ vs น้ำหนักที่ขั้นก่อนหน้าส่งออก · ทอง ต่างเกิน 0.05 g = ปฏิเสธ (ต้องชั่งใหม่/ให้ออฟฟิศย้อนขั้นก่อนแก้) ·
  -- เงิน/ทองเหลือง ไม่บล็อก แต่เก็บส่วนต่างไว้ใน event + v_job_stage_loss.handoff_gap_g
  if v_p.id is not null and v_p.status = 'sent' and v_p.weight_out_g is not null and p_weight_in is not null then
    v_gap := p_weight_in - v_p.weight_out_g;
    if v_job.metal = 'gold' and abs(v_gap) > 0.05 then
      return analytics.job_fail('handoff_mismatch',
        format('น้ำหนักที่รับไม่ตรงกับที่ขั้นก่อนส่งมา (ต่าง %s g เกิน 0.05 g) — ชั่งใหม่หรือแจ้งออฟฟิศ', trim_scale(abs(v_gap))::text),
        jsonb_build_object('gap_g', v_gap, 'prev_weight_out_g', v_p.weight_out_g));
    end if;
  end if;

  update analytics.job_stage
     set status = 'received', received_on = p_occurred_on, worker_id = p_worker_id, assignee_name = p_assignee,
         qty_in = case when v_p.id is not null then v_p.qty_out else v_job.qty_planned end,
         weight_in_g = p_weight_in
   where id = v_t.id
   returning * into v_t2;

  if v_job.weight_start_g is null and p_weight_in is not null and v_t.weigh_required then
    update analytics.job set weight_start_g = p_weight_in where id = p_job_id;
  end if;

  perform analytics.job_event_write(p_job_id, v_t.id, 'stage_receive', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
    jsonb_build_object('stage_code', v_t.stage_code,
                       'auto_closed_prev', v_auto, 'handoff_gap_g', v_gap,
                       'before', analytics.job_stage_state(v_t), 'after', analytics.job_stage_state(v_t2)));

  select d.name_th into v_def from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_t.stage_code;
  return jsonb_build_object('ok', true, 'action', 'receive', 'job_no', v_job.job_no, 'stage_seq', v_t.seq, 'stage_code', v_t.stage_code,
                            'stage_name', v_def, 'received_on', p_occurred_on, 'qty_in', v_t2.qty_in, 'weight_in_g', v_t2.weight_in_g,
                            'prev_auto_closed', v_auto is not null, 'handoff_gap_g', v_gap);
end;
$f$;

create or replace function analytics.job_worker_receive(
  p_token_hash   text,
  p_session_hash text,
  p_expected_seq int,
  p_weight_in_g  numeric default null,
  p_user_agent   text default null,
  p_ip_hash      text default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a jsonb;
  v_r jsonb;
begin
  v_a := analytics.job_worker_auth(p_token_hash, p_session_hash, p_ip_hash, true, true, 'write');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_r := analytics.job_core_receive((v_a ->> 'job_id')::uuid, p_expected_seq, analytics.job_today(), p_weight_in_g,
                                    (v_a ->> 'worker_id')::uuid, null, 'worker_qr', null,
                                    analytics.job_device_hint(p_user_agent, p_ip_hash), true);
  -- 2 มือถือรับขั้นเดียวกันพร้อมกัน: ตัวหลังได้ "รับแล้วโดย X" (ok) ไม่ใช่ error
  if v_r ->> 'code' = 'already_received' then
    return jsonb_build_object('ok', true, 'already', true, 'message', v_r ->> 'message', 'by', v_r ->> 'by');
  end if;
  return v_r;
end;
$f$;

create or replace function analytics.job_worker_send(
  p_token_hash     text,
  p_session_hash   text,
  p_expected_seq   int,
  p_weight_out_g   numeric default null,
  p_qty_scrap      int default 0,
  p_scrap_reason   text default null,
  p_metal_added_g  numeric default 0,
  p_weight_note    text default null,
  p_scrap_weight_g numeric default null,
  p_user_agent     text default null,
  p_ip_hash        text default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a jsonb;
  v_r jsonb;
begin
  v_a := analytics.job_worker_auth(p_token_hash, p_session_hash, p_ip_hash, true, true, 'write');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_r := analytics.job_core_send((v_a ->> 'job_id')::uuid, p_expected_seq, analytics.job_today(), p_weight_out_g, p_qty_scrap,
                                 p_scrap_reason, p_metal_added_g, p_weight_note, p_scrap_weight_g, (v_a ->> 'worker_id')::uuid,
                                 'worker_qr', null, analytics.job_device_hint(p_user_agent, p_ip_hash), true);
  if v_r ->> 'code' = 'already_sent' then
    return jsonb_build_object('ok', true, 'already', true, 'message', v_r ->> 'message');
  end if;
  return v_r;
end;
$f$;

create or replace function analytics.job_worker_resolve(p_token_hash text, p_session_hash text default null, p_ip_hash text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a        jsonb;
  v_job      analytics.job%rowtype;
  v_worker   uuid;
  v_wcodes   text[];
  v_hold     analytics.job_stage%rowtype;
  v_pend     analytics.job_stage%rowtype;
  v_prev     analytics.job_stage%rowtype;
  v_action   text := 'none';
  v_seq      int;
  v_code     text;
  v_name     text;
  v_need_w   boolean := false;
  v_prev_w   numeric := null;
  v_holder   text := null;
  v_paid     numeric;
  v_stages   jsonb;
  v_workers  jsonb := '[]'::jsonb;
  v_started  boolean;
begin
  v_a := analytics.job_worker_auth(p_token_hash, p_session_hash, p_ip_hash, false, false, 'none');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  select * into v_job from analytics.job where id = (v_a ->> 'job_id')::uuid;
  v_worker := nullif(v_a ->> 'worker_id', '')::uuid;

  select * into v_hold from analytics.job_stage where job_id = v_job.id and status = 'received' limit 1;
  select * into v_pend from analytics.job_stage where job_id = v_job.id and status = 'pending' order by seq limit 1;
  select exists (select 1 from analytics.job_stage where job_id = v_job.id and status in ('received', 'sent')) into v_started;
  if v_hold.id is not null then
    select coalesce(w.display_name, v_hold.assignee_name) into v_holder from (select 1) x left join analytics.worker w on w.id = v_hold.worker_id;
  end if;

  if v_hold.id is null and v_pend.id is null then
    -- QA 5: ทุกขั้นส่งต่อ/ข้ามครบแล้วแต่ออฟฟิศยังไม่ปิดงาน — ไม่ใช่ "ให้ระบุตัว"
    v_action := 'all_done';
  elsif v_worker is null then
    v_action := 'identify';
    -- รายชื่อช่างที่ทำขั้นถัดไปของงานนี้ได้ (ขั้นที่ถือค้างหรือขั้นที่รอรับ) — เฉพาะ id + ชื่อ
    select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'display_name', w.display_name) order by w.display_name), '[]'::jsonb)
      into v_workers
      from analytics.worker w
     where w.shop_id = v_job.shop_id and w.is_active
       and (cardinality(w.stage_codes) = 0
            or (v_hold.id is not null and v_hold.stage_code = any (w.stage_codes))
            or (v_pend.id is not null and v_pend.stage_code = any (w.stage_codes)));
  else
    select w.stage_codes into v_wcodes from analytics.worker w where w.id = v_worker;
    if v_hold.id is not null and v_hold.worker_id = v_worker then
      v_action := 'send'; v_seq := v_hold.seq; v_code := v_hold.stage_code; v_need_w := v_hold.weigh_required;
    elsif v_pend.id is not null then
      v_seq := v_pend.seq; v_code := v_pend.stage_code; v_need_w := v_pend.weigh_required;
      if v_job.status = 'on_hold' then
        v_action := 'on_hold';
      elsif cardinality(v_wcodes) > 0 and not (v_pend.stage_code = any (v_wcodes)) then
        v_action := 'not_your_stage';
      elsif v_hold.id is not null and v_job.metal = 'gold' then
        v_action := 'prev_not_sent';
      else
        v_action := 'receive';
        if v_job.source_kind = 'oem' and not v_started then
          select coalesce(v.paid_thb, 0) into v_paid
            from analytics.oem_quote_item i join analytics.v_oem_quote v on v.id = i.quote_id where i.id = v_job.oem_quote_item_id;
          if coalesce(v_paid, 0) <= 0 and v_job.start_gate_note is null then
            v_action := 'awaiting_deposit';
          end if;
        end if;
        select * into v_prev from analytics.job_stage
         where job_id = v_job.id and seq < v_pend.seq and status <> 'skipped' order by seq desc limit 1;
        v_prev_w := v_prev.weight_out_g;
      end if;
    elsif v_hold.id is not null then
      v_action := 'held_by_other'; v_seq := v_hold.seq; v_code := v_hold.stage_code;
    end if;
  end if;

  select d.name_th into v_name from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_code;

  select coalesce(jsonb_agg(
           jsonb_build_object('seq', s.seq, 'code', s.stage_code, 'name', d.name_th, 'status', s.status)
           || case when v_worker is not null then
                jsonb_build_object('received_on', s.received_on, 'sent_on', s.sent_on,
                                   'worker_name', coalesce(w.display_name, s.assignee_name), 'auto_closed', s.auto_closed)
              else '{}'::jsonb end
           order by s.seq), '[]'::jsonb)
    into v_stages
    from analytics.job_stage s
    join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
    left join analytics.worker w on w.id = s.worker_id
   where s.job_id = v_job.id;

  return jsonb_build_object(
    'ok', true,
    'job', case when v_worker is null
             then jsonb_build_object('job_no', v_job.job_no, 'status', v_job.status, 'stages', v_stages)
             else jsonb_build_object('job_no', v_job.job_no, 'status', v_job.status, 'design_label', v_job.design_label,
                                     'sku', v_job.sku_snapshot, 'metal', v_job.metal, 'qty_planned', v_job.qty_planned,
                                     'due_date', v_job.due_date, 'stages', v_stages) end,
    'viewer', case when v_worker is null then null
              else jsonb_build_object('worker_id', v_worker, 'display_name', v_a ->> 'worker_name') end,
    'session_expired', (v_a ->> 'session_expired')::boolean,
    'next_action', v_action,
    'action_stage', case when v_seq is null then null
                      else jsonb_build_object('seq', v_seq, 'code', v_code, 'name', v_name, 'weight_required', v_need_w) end,
    'prev_weight_out_g', v_prev_w,
    -- L1: ชื่อผู้ถือเห็นได้เฉพาะช่างที่ระบุตัวแล้ว
    'held_by', case when v_worker is null then null else v_holder end,
    'workers', v_workers,
    'scrap_reasons', case when v_action = 'send' then to_jsonb(array['porosity', 'broken', 'wrong_design', 'missing', 'other']) else '[]'::jsonb end
  );
end;
$f$;

create or replace function analytics.job_create_from_quote_item(
  p_shop_id         uuid,
  p_quote_item_id   uuid,
  p_stage_codes     text[],
  p_due_date        date default null,
  p_start_gate_note text default null,
  p_design_label    text default null,
  p_note            text default null,
  p_actor           uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_info  jsonb;
  v_gate  text;
  v_label text;
  v_note  text;
  v_dup   record;
begin
  if p_shop_id is null or p_quote_item_id is null then
    raise exception 'job_create_from_quote_item: p_shop_id และ p_quote_item_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'job_create_from_quote_item: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  -- กันสร้างซ้ำพร้อมกัน: ล็อกแถวใบเสนอราคาของ item นี้ก่อนตรวจ/นับเลข
  perform 1 from analytics.oem_quote q join analytics.oem_quote_item i on i.quote_id = q.id
   where i.id = p_quote_item_id and q.shop_id = p_shop_id for share of q;
  v_info := analytics.job_source_info(p_shop_id, 'oem', p_quote_item_id);
  if v_info -> 'existing_job' <> 'null'::jsonb then
    raise exception 'รายการนี้มีใบงาน % อยู่แล้ว — ถ้าต้องการสร้างใหม่ให้ยกเลิกใบเดิมก่อน', v_info -> 'existing_job' ->> 'job_no'
      using errcode = '22023', hint = 'job_exists';
  end if;
  v_gate := analytics.job_text_clean(p_start_gate_note, 'เหตุผลที่เริ่มผลิตก่อนมัดจำ', 500, false);
  if (v_info ->> 'deposit_missing')::boolean and v_gate is null then
    raise exception 'ดีลนี้ยังไม่มีเงินมัดจำเข้า — ต้องระบุเหตุผลที่ยอมเริ่มผลิตก่อน (start_gate_note)' using errcode = '22023', hint = 'start_gate_required';
  end if;
  if v_gate is not null and not analytics.oem_note_present(v_gate) then
    raise exception 'เหตุผลที่เริ่มผลิตก่อนมัดจำต้องมีตัวอักษรหรือตัวเลขจริง' using errcode = '22023', hint = 'start_gate_required';
  end if;
  -- มติเจ้าของ 12 ต.ค.: ใบงาน OEM ต้องให้ออฟฟิศตั้ง/ยืนยันชื่อเรียกภายในเสมอ (ค่าเริ่มต้นจาก job_stage_suggest.design_label ให้ UI เติมให้แก้ได้)
  -- ช่าง/ใบพิมพ์แสดงเฉพาะชื่อนี้ ไม่ดึง snapshot ของใบเสนอราคาเอง
  if nullif(btrim(coalesce(p_design_label, '')), '') is null then
    raise exception 'ใบงาน OEM ต้องตั้งชื่อเรียกภายใน (design_label) โดยออฟฟิศก่อนสร้าง' using errcode = '22023', hint = 'design_label_required';
  end if;
  v_label := analytics.job_text_clean(p_design_label, 'ชื่อเรียกใบงาน', 200, true);
  v_note := analytics.job_text_clean(p_note, 'หมายเหตุ', 500, false);

  return analytics.job_create_insert(p_shop_id, 'oem', p_quote_item_id, (v_info ->> 'root_quote_id')::uuid, (v_info ->> 'item_seq')::int,
    null, nullif(v_info ->> 'product_id', '')::uuid, v_label, nullif(v_info ->> 'sku', ''), v_info ->> 'metal', (v_info ->> 'qty')::int,
    p_due_date, v_gate, v_note, p_stage_codes, (v_info ->> 'is_new_design')::boolean, v_actor);
end;
$f$;

-- ============================================================================
-- 4. แก้ชื่อเรียกใบงานภายหลัง (owner/admin) — job_guard ยอมแก้ design_label เฉพาะใบที่ยังไม่ปิด
-- ============================================================================
create or replace function analytics.job_design_label_set(p_shop_id uuid, p_job_id uuid, p_design_label text, p_actor uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_job   analytics.job%rowtype;
  v_label text;
begin
  v_job := analytics.job_office_begin('job_design_label_set', p_shop_id, p_job_id, v_actor);
  v_label := analytics.job_text_clean(p_design_label, 'ชื่อเรียกใบงาน', 200, true);
  update analytics.job set design_label = v_label where id = p_job_id;
  perform analytics.job_event_write(p_job_id, null, 'note', analytics.job_today(), v_actor, null, 'job_page', null,
    jsonb_build_object('kind', 'design_label', 'before', v_job.design_label, 'after', v_label));
  return jsonb_build_object('ok', true, 'job_no', v_job.job_no, 'design_label', v_label);
end;
$f$;


-- ============================================================================
-- 5. view — เพิ่มคอลัมน์ต่อท้ายเท่านั้น (migration-traps ข้อ 3: คอลัมน์เดิมต้องเป็น prefix ลำดับเดิมเป๊ะ · ลอกจาก 0172 ซึ่งเป็นฉบับล่าสุด)
--    v_job_board: + board_column ('awaiting_close' = ส่งต่อ/ข้ามครบทุกขั้นแต่ออฟฟิศยังไม่ปิดงาน · done/cancelled · หรือรหัสขั้นปัจจุบัน) + handoff_gap_g (ส่วนต่างน้ำหนักส่งมอบสูงสุดของใบ)
--    v_job_stage_loss: + handoff_gap_g = น้ำหนักที่ขั้นนี้รับ - น้ำหนักที่ขั้นก่อนหน้า (ที่ไม่ถูกข้าม) ส่งออก (null เมื่อไม่มีน้ำหนักคู่กัน)
-- ============================================================================
create or replace view analytics.v_job_stage_loss
  with (security_invoker = true) as
select x.*,
       case when x.loss_warn_pct is null or x.loss_pct is null then false else x.loss_pct > x.loss_warn_pct end as warn,
       hg.handoff_gap_g
from (
  select s.id as job_stage_id, s.job_id, s.shop_id, j.job_no, j.metal, s.stage_code, d.name_th as stage_name, s.status,
         s.worker_id, w.display_name as worker_name,
         s.weight_in_g, s.weight_out_g, s.metal_added_g, s.scrap_weight_g,
         (s.weight_in_g is not null and s.weight_out_g is not null) as weighed,
         (s.status = 'sent' and (s.weight_in_g is null or s.weight_out_g is null)) as not_weighed,
         case when s.weight_in_g is not null and s.weight_out_g is not null
              then s.weight_in_g + s.metal_added_g - s.weight_out_g - coalesce(s.scrap_weight_g, 0) end as loss_g,
         case when s.weight_in_g is not null and s.weight_out_g is not null and s.weight_in_g > 0
              then round((s.weight_in_g + s.metal_added_g - s.weight_out_g - coalesce(s.scrap_weight_g, 0)) / s.weight_in_g * 100, 2) end as loss_pct,
         d.loss_warn_pct
    from analytics.job_stage s
    join analytics.job j on j.id = s.job_id
    join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
    left join analytics.worker w on w.id = s.worker_id
) x
left join lateral (
  select case when x.weight_in_g is not null and pv.weight_out_g is not null and pv.status = 'sent' then x.weight_in_g - pv.weight_out_g end as handoff_gap_g
    from analytics.job_stage me
    join analytics.job_stage pv on pv.job_id = me.job_id and pv.seq < me.seq and pv.status <> 'skipped'
   where me.id = x.job_stage_id
   order by pv.seq desc limit 1) hg on true;

create or replace view analytics.v_job_board
  with (security_invoker = true) as
select
  j.id, j.shop_id, j.job_no, j.seq, j.source_kind,
  case j.source_kind when 'oem' then aq.quote_no else po.po_no end as source_ref,
  j.design_label, j.sku_snapshot, j.metal, j.qty_planned, j.status, j.due_date,
  j.current_stage_code, d.name_th as current_stage_name, cs.status as current_stage_status,
  coalesce(w.display_name, cs.assignee_name) as holder_name,
  (analytics.job_today() - coalesce(cs.received_on, ps.last_sent_on, analytics.job_bkk_date(j.created_at)))::int as days_in_stage,
  (j.due_date is not null and j.status in ('open', 'in_progress', 'on_hold') and j.due_date < analytics.job_today()) as is_overdue,
  ev.last_event_at,
  ev.last_scan_at,
  (j.status in ('open', 'in_progress') and analytics.job_bkk_date(coalesce(ev.last_event_at, j.created_at)) < analytics.job_today() - 3) as is_stale,
  st.stage_count, st.stage_done_count, st.has_auto_closed,
  (j.source_kind = 'oem' and coalesce(pay.paid, 0) <= 0) as deposit_missing,
  (j.start_gate_note is not null) as start_gate_note_present,
  (j.source_kind = 'oem' and j.status not in ('done', 'cancelled') and aqi.qty is distinct from j.qty_planned) as quote_qty_mismatch,
  aqi.qty as quote_item_qty,
  j.created_at, j.done_at, j.cancelled_at,
  case when j.status in ('done', 'cancelled') then j.status when j.current_stage_code is null then 'awaiting_close' else j.current_stage_code end as board_column,
  hg.handoff_gap_g
from analytics.job j
left join analytics.job_stage cs on cs.job_id = j.id and cs.stage_code = j.current_stage_code
left join analytics.job_stage_def d on d.shop_id = j.shop_id and d.code = j.current_stage_code
left join analytics.worker w on w.id = cs.worker_id
left join lateral (select max(s.sent_on) as last_sent_on from analytics.job_stage s where s.job_id = j.id) ps on true
left join lateral (
  select max(e.recorded_at) as last_event_at, max(e.recorded_at) filter (where e.channel = 'worker_qr') as last_scan_at
    from analytics.job_event e where e.job_id = j.id) ev on true
left join lateral (
  select count(*)::int as stage_count,
         (count(*) filter (where s.status in ('sent', 'skipped')))::int as stage_done_count,
         coalesce(bool_or(s.auto_closed), false) as has_auto_closed
    from analytics.job_stage s where s.job_id = j.id) st on true
left join lateral (
  select q.id, q.quote_no from analytics.oem_quote q
   where j.source_kind = 'oem' and coalesce(q.root_quote_id, q.id) = j.root_quote_id
   order by (q.status = 'superseded'), q.created_at desc limit 1) aq on true
left join lateral (select coalesce(v.paid_thb, 0) as paid from analytics.v_oem_quote v where v.id = aq.id) pay on true
left join lateral (select i.qty from analytics.oem_quote_item i where i.quote_id = aq.id and i.seq = j.oem_item_seq) aqi on true
left join analytics.production_order_item poi on poi.id = j.production_order_item_id
left join analytics.production_order po on po.id = poi.production_order_id
left join lateral (select max(abs(l.handoff_gap_g)) as handoff_gap_g from analytics.v_job_stage_loss l where l.job_id = j.id) hg on true;

-- v_worker_lock: ให้ออฟฟิศเห็นว่าใครถูกล็อก/ผิดไปกี่ครั้งในหน้าต่างนี้ (ไม่มี pin_hash) · lock_state: none | temporary | office (ล็อกถาวร ต้อง worker_unlock หรือรีเซ็ต PIN)
create or replace view analytics.v_worker_lock
  with (security_invoker = true) as
select w.id as worker_id, w.shop_id, w.display_name, w.is_active,
       w.failed_attempts, w.failed_window_start, w.last_failed_at, w.locked_until,
       case when w.locked_until is null or w.locked_until <= now() then 'none'
            when w.locked_until = 'infinity'::timestamptz then 'office'
            else 'temporary' end as lock_state,
       (w.failed_window_start is not null and w.failed_window_start >= now() - interval '24 hours') as in_window
  from analytics.worker w;

-- ============================================================================
-- 6. สิทธิ์ — service_role เท่านั้น (เหมือน 0172: ปิดทุกอย่างก่อน เปิดเฉพาะที่ตั้งใจ)
-- ============================================================================
revoke all on analytics.v_worker_lock from public, anon, authenticated, service_role;
grant select on analytics.v_worker_lock to service_role;
grant select on analytics.v_job_board, analytics.v_job_stage_loss to service_role;
-- worker: คอลัมน์ใหม่ที่ออฟฟิศอ่านได้ (ไม่ใช่ pin_hash)
grant select (failed_window_start, last_failed_at) on analytics.worker to service_role;

do $g$
declare
  r record;
  v_rpc constant text[] := array[
    'job_stage_suggest', 'job_create_from_quote_item', 'job_create_from_production_item', 'job_token_issue', 'job_token_revoke',
    'job_office_receive', 'job_office_send', 'job_stage_skip', 'job_stage_reopen', 'job_set_due', 'job_start_gate_note_set',
    'job_done', 'job_cancel', 'worker_upsert', 'worker_pin_set', 'worker_set_active', 'worker_unlock', 'job_design_label_set',
    'worker_pin_verify', 'job_worker_logout', 'job_worker_resolve', 'job_worker_receive', 'job_worker_send',
    'job_today', 'job_bkk_date', 'job_stage_state'];
  v_n int;
  v_dup text;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace and (p.proname like 'job\_%' or p.proname like 'worker\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname = any (v_rpc) then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
  select string_agg(proname, ', ') into v_dup from (
    select proname from pg_proc where pronamespace = 'analytics'::regnamespace and (proname like 'job\_%' or proname like 'worker\_%')
    group by proname having count(*) > 1) d;
  if v_dup is not null then
    raise exception '0173: พบ overload ของฟังก์ชัน: %', v_dup;
  end if;
  select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = any (v_rpc);
  if v_n <> cardinality(v_rpc) then
    raise exception '0173: RPC ที่ประกาศไว้ % ตัว แต่พบใน pg_proc % ตัว', cardinality(v_rpc), v_n;
  end if;
end;
$g$;

-- ============================================================================
-- 7. ยืนยันว่า migration นี้ไม่แตะของเดิม OEM/ผลิต (md5 ฟังก์ชัน + schema ตาราง ก่อน-หลังเท่ากัน ไม่งั้น raise -> rollback ทั้งไฟล์)
-- ============================================================================
do $c$
declare
  v_changed text;
  v_n_before int;
  v_n_after  int;
  v_col_h    text;
  v_col_n    int;
  v_h0       text;
  v_n0       int;
begin
  select string_agg(b.sig, ', ') into v_changed
    from _j173_fn_base b
    left join pg_proc p on p.oid = to_regprocedure(b.sig)
   where p.oid is null or md5(pg_get_functiondef(p.oid)) <> b.h;
  if v_changed is not null then
    raise exception '0173 แตะฟังก์ชัน OEM/production เดิม (md5 ไม่เท่า/หาย): %', v_changed;
  end if;
  select count(*) into v_n_before from _j173_fn_base;
  select count(*) into v_n_after from pg_proc
   where pronamespace = 'analytics'::regnamespace and prokind = 'f' and (proname like 'oem\_%' or proname like 'production\_%');
  if v_n_before <> v_n_after then
    raise exception '0173: จำนวนฟังก์ชัน oem_*/production_* เปลี่ยน % -> %', v_n_before, v_n_after;
  end if;
  select h, n into v_h0, v_n0 from _j173_col_base;
  select md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''),
                        ',' order by table_name, ordinal_position)), count(*)
    into v_col_h, v_col_n
    from information_schema.columns
   where table_schema = 'analytics'
     and (table_name like 'oem\_%' or table_name like 'v\_oem\_%' or table_name like 'production\_order%' or table_name like 'v\_production\_order%');
  if v_col_h is distinct from v_h0 or v_col_n <> v_n0 then
    raise exception '0173 แตะโครงสร้างตาราง/view OEM หรือใบผลิตเดิม (คอลัมน์ % -> %)', v_n0, v_col_n;
  end if;
  raise notice '0173: ฟังก์ชัน oem_*/production_* เดิม % ตัว md5 เท่าเดิมทั้งหมด · คอลัมน์ตาราง/view OEM+ผลิตเดิม % คอลัมน์ เท่าเดิม', v_n_before, v_n0;
end;
$c$;

notify pgrst, 'reload schema';

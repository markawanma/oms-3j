-- 0174_job_tracking_hardening2.sql — แก้ J1 รอบ 2 ตาม security รอบ 2 (N1-N4 + งบ atomic) + QA (N1 N3) · Tech Lead ตัดสินแล้วทุกข้อ
-- ✅ APPLIED 12 ต.ค. 69 ผ่าน node scripts/run-sql.mjs --commit --record (version 20261012123138 · name 0174_job_tracking_hardening2) — ห้าม apply ซ้ำ (บรรทัดนี้เพิ่มหลัง apply เป็นคอมเมนต์ล้วน)
-- ต่อจาก 0172/0173 (apply แล้ว แก้ไฟล์เดิมไม่ได้) — ตารางใหม่ 0 · คอลัมน์ใหม่ 0 · แทนที่ฟังก์ชัน job_*/worker_* ที่ระบุ + เพิ่มคอลัมน์ต่อท้าย view · ไม่แตะ oem_*/production_*
--
-- N1  ผู้รับงานทองต้องชั่งแบบไม่รู้คำตอบ: job_worker_resolve งานทอง prev_weight_out_g = null · handoff_mismatch ไม่บอกขนาดส่วนต่าง/น้ำหนักขั้นก่อน (ไม่คืน gap_g) ·
--     บันทึก job_event (event_type 'weigh', payload.kind='handoff_mismatch') ทุกครั้งที่ไม่ตรง · v_job_board.handoff_mismatch_count · เงิน/ทองเหลืองส่ง prev ตามเดิม
-- N2  login สำเร็จ = ปลดเฉพาะล็อกชั่วคราว (locked_until=null) · ตัวนับ/หน้าต่างไม่ล้าง (หมดเองตาม 24 ชม. หรือ worker_unlock / worker_pin_set) · v_worker_lock.pin_warning
-- N3  ถัง rate limit: resolve ใช้ tov: 120/10 นาที แยกจาก tok: 60 (PIN + action เขียน)
-- N4  handoff เทียบเฉพาะเมื่อทั้งขั้นก่อนและขั้นนี้บังคับชั่ง (weigh_required ทั้งคู่) — core + v_job_stage_loss + v_job_board
-- QA-N1 resolve: ขั้นก่อนบังคับชั่ง (หรืองานทอง) ยังไม่ส่งต่อ -> next_action = prev_not_sent ตั้งแต่ resolve
-- QA-N3 ชื่อช่าง/ชื่อเรียกภายใน: ปฏิเสธ < และ > (job_label_clean) นอกเหนือจากด่านอักขระควบคุม/bidi เดิม
-- งบผิดต่อ token ทำเป็น atomic: จองช่องด้วย insert .. on conflict .. where hits < max returning ก่อนตรวจ PIN (พร้อมกันกี่ตัวก็ไม่เกิน 20) · ใส่ถูกคืนช่อง
-- สัญญา RPC ที่เปลี่ยน: ดูสรุปท้ายรอบ

create temp table _j174_fn_base on commit drop as
select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h
from pg_proc p
where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
  and (p.proname like 'oem\_%' or p.proname like 'production\_%');

create temp table _j174_col_base on commit drop as
select md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''),
                      ',' order by table_name, ordinal_position)) as h,
       count(*) as n
from information_schema.columns
where table_schema = 'analytics'
  and (table_name like 'oem\_%' or table_name like 'v\_oem\_%' or table_name like 'production\_order%' or table_name like 'v\_production\_order%');


-- ============================================================================
-- 1. helper ภายใน (ไม่ grant ให้ role ไหน)
-- ============================================================================

-- ชื่อที่ผู้ใช้พิมพ์และไปแสดงบนหน้าจอช่าง/ใบพิมพ์ (ชื่อช่าง/ชื่อเรียกใบงาน): ด่านข้อความเดิม (ต้องมีตัวอักษรจริง · ห้าม control/bidi/ล่องหน/ขึ้นบรรทัดใหม่) + ห้าม < >
-- ทำไม: React escape ให้อยู่แล้ว แต่ข้อความนี้ไหลไป QR/ใบพิมพ์/log/อีเมลในอนาคตได้ — ตัดตั้งแต่ต้นทางถูกกว่าไล่กันทุกปลายทาง
create or replace function analytics.job_label_clean(p_val text, p_label text, p_max int)
 returns text
 language plpgsql
 immutable
 set search_path to 'pg_catalog', 'analytics', 'pg_temp'
as $f$
declare v text := analytics.job_text_clean(p_val, p_label, p_max, true);
begin
  if v ~ '[<>]' then
    raise exception '%ห้ามมีเครื่องหมาย < หรือ >', p_label using errcode = '22023', hint = 'text_invalid';
  end if;
  return v;
end;
$f$;

-- งบแบบ atomic: จองช่อง 1 ช่องถ้ายังไม่ถึง p_max (คืนค่านับใหม่) · เต็มแล้วคืน null — ON CONFLICT DO UPDATE ... WHERE ล็อกแถวและตรวจเงื่อนไขในคำสั่งเดียว
create or replace function analytics.job_budget_take(p_key text, p_window timestamptz, p_max int)
 returns int
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare v int;
begin
  insert into analytics.worker_rate_limit as r (key, window_start, hits) values (p_key, p_window, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1 where r.hits < p_max
  returning r.hits into v;
  return v;
end;
$f$;

create or replace function analytics.job_budget_give(p_key text, p_window timestamptz)
 returns void
 language sql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
  update analytics.worker_rate_limit set hits = greatest(hits - 1, 0) where key = p_key and window_start = p_window
$f$;


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
  -- N3: โหลดหน้า/resolve ใช้ถัง tov: (120/10 นาที) แยกจากถัง tok: (60) ของ PIN + action เขียน — คนโหลดหน้าซ้ำห้ามทำให้ช่างตัวจริง login ไม่ได้
  if not analytics.job_rate_limit_hit(case when p_ip_class = 'none' then 'tov:' else 'tok:' end || left(p_token_hash, 32),
                                      case when p_ip_class = 'none' then 120 else 60 end) then
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

  -- งบผิดต่อ token ต่อวัน (<= 20) แบบ atomic: จองช่องก่อนตรวจ PIN (insert .. on conflict .. where hits < max returning) — พร้อมกันกี่ตัวก็ไม่เกิน 20 ·
  -- เต็มแล้ว token นี้ verify ไม่ได้แม้ใส่ถูก · ใส่ถูกคืนช่อง (นับเฉพาะครั้งที่ผิด)
  v_spent := analytics.job_budget_take(v_bkey, v_day, 20);
  if v_spent is null then
    return analytics.job_fail('token_budget_exhausted', 'ใส่ PIN ผิดครบกำหนดของใบงานนี้ในวันนี้แล้ว — ให้ออฟฟิศพิมพ์ใบงานใหม่');
  end if;

  if extensions.crypt(p_pin, v_w.pin_hash) = v_w.pin_hash then
    perform analytics.job_budget_give(v_bkey, v_day);
    -- N2: สำเร็จ = ปลดเฉพาะล็อกชั่วคราวที่หมดอายุแล้ว · ตัวนับ/หน้าต่าง 24 ชม. ไม่ล้าง (ผิด 4 สลับถูก ×5 ต้องยังล็อกที่ครั้งที่ 5) —
    -- ล้างได้แค่ครบ 24 ชม. / worker_unlock / worker_pin_set
    update analytics.worker set locked_until = null where id = v_w.id;
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
  -- N4: เทียบเฉพาะเมื่อทั้งขั้นก่อนและขั้นนี้บังคับชั่ง (เทียน/ปูนไม่ถูกเทียบกับหล่อ)
  if v_p.id is not null and v_p.status = 'sent' and v_p.weight_out_g is not null and p_weight_in is not null
     and v_t.weigh_required and v_p.weigh_required then
    v_gap := p_weight_in - v_p.weight_out_g;
    if v_job.metal = 'gold' and abs(v_gap) > 0.05 then
      -- N1: ผู้รับต้องชั่งแบบไม่รู้คำตอบ — ข้อความ/ผลลัพธ์ไม่บอกขนาดส่วนต่างหรือน้ำหนักขั้นก่อน · แต่บันทึก event ทุกครั้งที่ไม่ตรงให้ออฟฟิศเห็น
      -- (event_type 'weigh' ที่ 0172 ประกาศไว้แต่ยังไม่ใช้ · payload.kind = handoff_mismatch · คนเรียกฝั่งออฟฟิศ raise ทำให้ event นี้ถอยกลับ ซึ่งยอมรับได้: ออฟฟิศเห็น error ตรงๆ)
      perform analytics.job_event_write(p_job_id, v_t.id, 'weigh', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
        jsonb_build_object('kind', 'handoff_mismatch', 'stage_code', v_t.stage_code, 'weight_in_g', p_weight_in,
                           'prev_weight_out_g', v_p.weight_out_g, 'gap_g', v_gap));
      return analytics.job_fail('handoff_mismatch', 'น้ำหนักที่รับไม่ตรงกับที่ขั้นก่อนส่งมา — ชั่งใหม่ ถ้ายังไม่ตรงให้แจ้งออฟฟิศ');
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
                            'prev_auto_closed', v_auto is not null,
                            'handoff_gap_g', case when v_job.metal = 'gold' then null else v_gap end);
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
      elsif v_hold.id is not null and (v_job.metal = 'gold' or v_hold.weigh_required) then
        -- QA N1: ขั้นก่อนบังคับชั่ง (หรืองานทอง) ยังไม่ส่งต่อ -> บอกตั้งแต่ resolve ไม่ใช่ให้กดแล้วไป fail
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
        -- N1: งานทองไม่ส่งน้ำหนักขั้นก่อนให้ผู้รับ (ชั่งแบบไม่รู้คำตอบ) · เงิน/ทองเหลืองส่งตามเดิม
        v_prev_w := case when v_job.metal = 'gold' then null else v_prev.weight_out_g end;
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
  v_name := analytics.job_label_clean(analytics.oem_customer_text_clean(p_display_name, 'ชื่อช่าง'), 'ชื่อช่าง', 60);
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
  v_label := analytics.job_label_clean(p_design_label, 'ชื่อเรียกใบงาน', 200);
  update analytics.job set design_label = v_label where id = p_job_id;
  perform analytics.job_event_write(p_job_id, null, 'note', analytics.job_today(), v_actor, null, 'job_page', null,
    jsonb_build_object('kind', 'design_label', 'before', v_job.design_label, 'after', v_label));
  return jsonb_build_object('ok', true, 'job_no', v_job.job_no, 'design_label', v_label);
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
  v_label := analytics.job_label_clean(p_design_label, 'ชื่อเรียกใบงาน', 200);
  v_note := analytics.job_text_clean(p_note, 'หมายเหตุ', 500, false);

  return analytics.job_create_insert(p_shop_id, 'oem', p_quote_item_id, (v_info ->> 'root_quote_id')::uuid, (v_info ->> 'item_seq')::int,
    null, nullif(v_info ->> 'product_id', '')::uuid, v_label, nullif(v_info ->> 'sku', ''), v_info ->> 'metal', (v_info ->> 'qty')::int,
    p_due_date, v_gate, v_note, p_stage_codes, (v_info ->> 'is_new_design')::boolean, v_actor);
end;
$f$;

create or replace function analytics.job_create_from_production_item(
  p_shop_id                  uuid,
  p_production_order_item_id uuid,
  p_stage_codes              text[],
  p_due_date                 date default null,
  p_design_label             text default null,
  p_note                     text default null,
  p_actor                    uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_info  jsonb;
  v_label text;
  v_note  text;
begin
  if p_shop_id is null or p_production_order_item_id is null then
    raise exception 'job_create_from_production_item: p_shop_id และ p_production_order_item_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'job_create_from_production_item: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  perform 1 from analytics.production_order po join analytics.production_order_item poi on poi.production_order_id = po.id
   where poi.id = p_production_order_item_id and po.shop_id = p_shop_id for share of po;
  v_info := analytics.job_source_info(p_shop_id, 'production', p_production_order_item_id);
  if v_info -> 'existing_job' <> 'null'::jsonb then
    raise exception 'รายการนี้มีใบงาน % อยู่แล้ว — ถ้าต้องการสร้างใหม่ให้ยกเลิกใบเดิมก่อน', v_info -> 'existing_job' ->> 'job_no'
      using errcode = '22023', hint = 'job_exists';
  end if;
  v_label := coalesce(case when nullif(btrim(coalesce(p_design_label, '')), '') is null then null
                          else analytics.job_label_clean(p_design_label, 'ชื่อแบบ', 200) end, v_info ->> 'design_label');
  v_note := analytics.job_text_clean(p_note, 'หมายเหตุ', 500, false);

  return analytics.job_create_insert(p_shop_id, 'production', null, null, null, p_production_order_item_id,
    nullif(v_info ->> 'product_id', '')::uuid, v_label, nullif(v_info ->> 'sku', ''), v_info ->> 'metal', (v_info ->> 'qty')::int,
    p_due_date, null, v_note, p_stage_codes, (v_info ->> 'is_new_design')::boolean, v_actor);
end;
$f$;

-- ============================================================================
-- 2. view — เพิ่มคอลัมน์ต่อท้ายเท่านั้น (migration-traps ข้อ 3 · ลอกจากฉบับล่าสุดคือ 0173/0172)
--    v_job_stage_loss.handoff_gap_g: เงื่อนไขเดียวกับ core (ทั้งสองขั้นบังคับชั่ง) — คอลัมน์เดิม ความหมายแคบลง
--    v_job_board: + handoff_mismatch_count (จำนวนครั้งที่ช่างรับน้ำหนักทองไม่ตรง — event 'weigh' payload.kind=handoff_mismatch)
--    v_worker_lock: + pin_warning
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
  select case when x.weight_in_g is not null and pv.weight_out_g is not null and pv.status = 'sent' and me.weigh_required and pv.weigh_required
              then x.weight_in_g - pv.weight_out_g end as handoff_gap_g
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
  hg.handoff_gap_g,
  hmc.handoff_mismatch_count
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
left join lateral (select max(abs(l.handoff_gap_g)) as handoff_gap_g from analytics.v_job_stage_loss l where l.job_id = j.id) hg on true
left join lateral (select count(*)::int as handoff_mismatch_count from analytics.job_event e
                    where e.job_id = j.id and e.event_type = 'weigh' and e.payload ->> 'kind' = 'handoff_mismatch') hmc on true;

create or replace view analytics.v_worker_lock
  with (security_invoker = true) as
select w.id as worker_id, w.shop_id, w.display_name, w.is_active,
       w.failed_attempts, w.failed_window_start, w.last_failed_at, w.locked_until,
       case when w.locked_until is null or w.locked_until <= now() then 'none'
            when w.locked_until = 'infinity'::timestamptz then 'office'
            else 'temporary' end as lock_state,
       (w.failed_window_start is not null and w.failed_window_start >= now() - interval '24 hours') as in_window,
       -- N2: ผิดตั้งแต่ 3 ครั้งในหน้าต่าง 24 ชม. (login สำเร็จไม่ล้างตัวนับแล้ว จึงต้องเตือนออฟฟิศ)
       (w.failed_attempts >= 3 and w.failed_window_start is not null and w.failed_window_start >= now() - interval '24 hours') as pin_warning
  from analytics.worker w;

-- ============================================================================
-- 3. สิทธิ์ — service_role เท่านั้น (เหมือน 0172: ปิดทุกอย่างก่อน เปิดเฉพาะที่ตั้งใจ)
-- ============================================================================
revoke all on analytics.v_job_board, analytics.v_job_stage_loss, analytics.v_worker_lock from public, anon, authenticated, service_role;
grant select on analytics.v_job_board, analytics.v_job_stage_loss, analytics.v_worker_lock to service_role;

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
    raise exception '0174: พบ overload ของฟังก์ชัน: %', v_dup;
  end if;
  select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = any (v_rpc);
  if v_n <> cardinality(v_rpc) then
    raise exception '0174: RPC ที่ประกาศไว้ % ตัว แต่พบใน pg_proc % ตัว', cardinality(v_rpc), v_n;
  end if;
end;
$g$;

-- ============================================================================
-- 4. ยืนยันว่า migration นี้ไม่แตะของเดิม OEM/ผลิต (md5 ฟังก์ชัน + schema ตาราง ก่อน-หลังเท่ากัน ไม่งั้น raise -> rollback ทั้งไฟล์)
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
    from _j174_fn_base b
    left join pg_proc p on p.oid = to_regprocedure(b.sig)
   where p.oid is null or md5(pg_get_functiondef(p.oid)) <> b.h;
  if v_changed is not null then
    raise exception '0174 แตะฟังก์ชัน OEM/production เดิม (md5 ไม่เท่า/หาย): %', v_changed;
  end if;
  select count(*) into v_n_before from _j174_fn_base;
  select count(*) into v_n_after from pg_proc
   where pronamespace = 'analytics'::regnamespace and prokind = 'f' and (proname like 'oem\_%' or proname like 'production\_%');
  if v_n_before <> v_n_after then
    raise exception '0174: จำนวนฟังก์ชัน oem_*/production_* เปลี่ยน % -> %', v_n_before, v_n_after;
  end if;
  select h, n into v_h0, v_n0 from _j174_col_base;
  select md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''),
                        ',' order by table_name, ordinal_position)), count(*)
    into v_col_h, v_col_n
    from information_schema.columns
   where table_schema = 'analytics'
     and (table_name like 'oem\_%' or table_name like 'v\_oem\_%' or table_name like 'production\_order%' or table_name like 'v\_production\_order%');
  if v_col_h is distinct from v_h0 or v_col_n <> v_n0 then
    raise exception '0174 แตะโครงสร้างตาราง/view OEM หรือใบผลิตเดิม (คอลัมน์ % -> %)', v_n0, v_col_n;
  end if;
  raise notice '0174: ฟังก์ชัน oem_*/production_* เดิม % ตัว md5 เท่าเดิมทั้งหมด · คอลัมน์ตาราง/view OEM+ผลิตเดิม % คอลัมน์ เท่าเดิม', v_n_before, v_n0;
end;
$c$;

notify pgrst, 'reload schema';

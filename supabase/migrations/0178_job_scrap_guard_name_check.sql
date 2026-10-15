-- 0178_job_scrap_guard_name_check.sql — security (M1/L1) ตรวจ UI ของ M1: ช่างส่งน้ำหนักเศษที่ขั้นที่ไม่ถามเศษ → ทองหายแต่ loss ไม่มีธง · เศษมากกว่าส่วนที่หายทำให้ loss ติดลบ · ชื่อแบบการบันทึกกันอักขระล่องหนที่ชั้นตารางไม่ได้
-- ต่อจาก 0172-0177 (apply บน production แล้ว แก้ไฟล์เดิมไม่ได้ · def ต้นทางของ 2 ฟังก์ชันที่ replace ลอกจากฉบับที่ apply จริง: job_core_send = 0172 (0173-0177 ไม่ได้แตะ) · job_record_profile_upsert = 0176)
-- ⚠️ ยังไม่ APPLY — dry-run เท่านั้น (apply หลัง Tech Lead ตรวจ + security ผ่าน)
-- 🔴 apply ด้วย node scripts/run-sql.mjs --commit --record เท่านั้น (ไฟล์พึ่งทรานแซกชันที่ runner ครอบทั้งไฟล์: temp table on commit drop) · ห้าม supabase db push · ไฟล์ต้องเป็น LF
--
-- ทำไม (M1 Medium): loss ของขั้น = in + added - out - scrap (v_job_stage_loss) — ใครส่ง scrap เพิ่มได้ loss ลดลง · ช่างยิง server action ตรงด้วย {weightOut: 49, scrapWeight: 1} ที่ขั้นที่แบบบันทึกไม่ถามเศษ
--   ⇒ ทองหาย 1 g แต่ loss = 0 ไม่มีธง · ช่องทางช่างเท่านั้น (ออฟฟิศบันทึกเศษได้ทุกขั้นตามเดิม)
--   แก้ 2 ด่านใน job_core_send (ฟังก์ชันภายในที่ทุกช่องทางผ่าน):
--   (1) scrap_weight_not_asked — ช่อง worker_qr ส่ง p_scrap_weight (ไม่ null) ที่ขั้น scrap_weight_ask = false = ปฏิเสธ · ออฟฟิศ (job_page/daily_sheet) ไม่ถูกจำกัด
--   (2) scrap_over — เศษ > weight_in + metal_added - weight_out (ส่วนที่หายไปก่อนหักเศษ) = ปฏิเสธ ทุกช่องทาง · เฉพาะเมื่อมีทั้ง weight_in และ weight_out (ตรงกับเงื่อนไขที่ v_job_stage_loss คำนวณ loss) ไม่งั้นข้าม
--   ข้อความ error ไม่มีตัวเลขน้ำหนัก (N1 ทอง) · ไม่มี UPDATE ข้อมูล (ไม่มี trigger ยิง) · ไม่เพิ่ม CHECK ตาราง job_stage (แถวเดิมอาจไม่เข้าเกณฑ์ — ดู raise notice ข้อ 1)
-- ทำไม (L1 Low): CHECK job_record_profile.name / job.profile_name กันแค่ <> + btrim — U+200B/U+202E (bidi) หลุดถ้าเขียนตรงโดยไม่ผ่าน job_label_clean ⇒ เพิ่ม analytics.oem_note_valid (ชุดเดียวกับ note/เหตุผลทุกช่อง) · job_record_profile_upsert ให้ hint name_invalid
--
-- 1 pre-check: md5 ฟังก์ชันที่ replace ต้องเป็นฉบับที่ apply จริง (คำนวณออฟไลน์จาก pg_get_functiondef ของไฟล์ต้นทาง · ตรวจวิธีคำนวณกับ md5 prod ของ job_plan_compute ตรงเป๊ะ) หรือฉบับ 0178 (รันซ้ำ)
--    · แถวเดิมต้องผ่าน CHECK ใหม่ (assert) · แจ้งจำนวนขั้นที่ปิดแล้วซึ่ง scrap > ส่วนที่หาย (ไม่แก้ — แจ้งอย่างเดียว)
-- 2 CHECK: job_record_profile.name (ชื่อใหม่ jrp_name_ck แทนชื่ออัตโนมัติเดิม) · job.profile_name (job_profile_pair_ck)
-- 3 replace: job_core_send (def 0172) · job_record_profile_upsert (def 0176) — signature เดิม (ไม่เกิด overload)
-- 4 สิทธิ์ + post-check (md5 ฟังก์ชันอื่นไม่ขยับ · updated_at ไม่ขยับ · trigger เปิดครบ)
--
-- ตัดสินเอง (นอก design/brief):
--  (1) ด่าน scrap_weight_not_asked อยู่ใน job_core_send (เงื่อนไข p_channel = 'worker_qr') ไม่ใช่ job_worker_send ตามที่บรีฟระบุ — เหตุผล: (ก) ลำดับด่านถูก: ตรวจหลัง not_holder/already_sent/stage_changed
--      (ช่างที่ไม่ใช่ผู้ถือหรือกดซ้ำได้ข้อความเดิม ไม่ใช่ error เรื่องเศษ) · (ข) replace ฟังก์ชันเดียว (ไม่แตะ security definer wrapper ของช่าง) · (ค) wrapper ช่างตัวอื่นในอนาคตที่ใช้ช่อง worker_qr ได้ด่านนี้เองโดยไม่ต้องจำ
--      ช่อง worker_qr ใช้ได้เฉพาะ job_worker_send เท่านั้น (office ผ่าน job_office_send ที่ปฏิเสธช่องอื่นนอกจาก job_page/daily_sheet) ⇒ พฤติกรรมที่ช่าง/ออฟฟิศเห็นเหมือนที่บรีฟสั่งทุกประการ
--  (2) ใบเดิม (profile_id null): ช่างส่งเศษไม่ได้เช่นกัน — ใบเดิมทุกขั้น scrap_weight_ask = false (คอลัมน์ default false ตอน 0176 · J1 ไม่มีแนวคิด "ถามเศษ") และ UI ใบเดิมไม่เคยส่งเศษ (job_worker_resolve ให้ scrap_weight_ask = false · ไม่มี
--      ช่องเศษบนจอ) ⇒ ไม่มีเคสที่พัง · ไม่ทำข้อยกเว้นให้ใบเดิม เพราะข้อยกเว้นนั้นคือช่องเดิมที่ security เจอ (ใบเดิมคือใบทองที่ชั่งทุกขั้น — ที่อันตรายที่สุด)
--  (3) scrap_over เทียบแบบ exact (ไม่มี tolerance) — น้ำหนักทุกตัวทศนิยม ≤ 3 ตำแหน่ง (job_weight_ok) เลขไม่มีเศษลอย · เศษ = ส่วนที่หายพอดี → ผ่าน (loss = 0) · ถ้าหน้างานเจอเครื่องชั่งคลาดเคลื่อนจนเศษเกินนิดเดียว ต้องชั่งใหม่ตามที่บรีฟสั่ง
--  (4) null: ข้ามด่าน scrap_over เมื่อ weight_in หรือ weight_out ว่าง (v_job_stage_loss ไม่คำนวณ loss ในกรณีนั้น ⇒ ไม่มีอะไรให้บิดเบือน) · เศษไม่ส่งมา (null) = ไม่ตรวจทั้ง 2 ด่าน
--  (5) upsert: เก็บ hint เดิม text_invalid ไว้สำหรับ < > (TS map อยู่แล้ว) — ที่เหลือที่ job_label_clean ปฏิเสธ (ว่าง/ล่องหน/ขึ้นบรรทัดใหม่/ยาว/ไม่มีตัวอักษรจริง) ได้ hint name_invalid (เดิมไม่มี hint)
--  (6) CHECK ใหม่ไม่เพิ่ม "ห้ามขึ้นบรรทัดใหม่/tab" (oem_note_valid อนุญาต LF/CR/tab) — ทางเข้า RPC ปฏิเสธอยู่แล้วที่ job_text_clean · บรีฟสั่งแค่ oem_note_valid · จดเป็นหนี้เล็ก (เขียนตรงด้วย service_role ใส่ \n ในชื่อได้)
-- ไม่มีราคา/ต้นทุนในทุก object ของไฟล์นี้

-- baseline ก่อนแตะ: ฟังก์ชันทุกตัวในสคีมา (md5) + ตัวชี้วัด updated_at ของ job/job_stage/job_record_profile — ตรวจท้ายไฟล์ว่าไม่มีอะไรขยับนอกรายการที่ตั้งใจแทนที่
create temp table _j178_fn_base on commit drop as
select p.oid::regprocedure::text as sig, p.proname, md5(pg_get_functiondef(p.oid)) as h
from pg_proc p
where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f';

create temp table _j178_row_base on commit drop as
select 'job'::text as t, count(*) as n, count(distinct updated_at) as nd, coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') as h from analytics.job
union all
select 'job_stage', count(*), count(distinct updated_at), coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') from analytics.job_stage
union all
select 'job_record_profile', count(*), count(distinct updated_at), coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') from analytics.job_record_profile;

-- ============================================================================
-- 0. pre-check
-- ============================================================================
do $p$
declare
  r record;
  v_n int;
  v_h text;
  v_bad_prof int;
  v_bad_job int;
  v_over int;
begin
  -- ไฟล์นี้พึ่งทรานแซกชันที่ runner ครอบทั้งไฟล์ (temp table on commit drop) — รันแบบ autocommit ตารางหายทันที ⇒ บรรทัดนี้ล้มก่อน DDL ใดๆ
  perform 1 from pg_temp._j178_fn_base limit 1;
  if to_regprocedure('analytics.job_rate_pct(uuid,text,text,date)') is null or to_regclass('analytics.job_record_profile') is null then
    raise exception '0178: ยังไม่พบ 0176/0177 (job_record_profile / job_rate_pct) — apply ก่อน';
  end if;
  -- md5: h_a/h_b = ฉบับที่ apply จริง (LF / CRLF — 0172 apply จาก working tree ที่ git ทำ CRLF ได้ จึงรับทั้งสองรูป · 0176 เป็น LF ล้วน) · h_new = ฉบับ 0178 (รันซ้ำ)
  for r in
    select * from (values
      ('job_core_send', 'b072eae032ad4d51e89d0f9882a2978e', '328555fe115f62551aa6e8e0668be4b3', '7ba90dd8cee307928f7aebd6ada94b95'),
      ('job_record_profile_upsert', '9b471e19404ee736c8256a9f0651b559', '9b471e19404ee736c8256a9f0651b559', 'c0f74711e1229bebaa17d4be84fc2521')
    ) as v(n, h_a, h_b, h_new)
  loop
    select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = r.n;
    if v_n <> 1 then
      raise exception '0178: % มี % signature (ต้องมี 1) — หยุดตรวจ overload', r.n, v_n;
    end if;
    select md5(pg_get_functiondef(p.oid)) into v_h from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = r.n;
    if v_h not in (r.h_a, r.h_b, r.h_new) then
      raise exception '0178: def ของ % บน DB ไม่ใช่ฉบับที่ apply (md5 % / %) และไม่ใช่ฉบับ 0178 (md5 %) — DB มี md5 % — มีคนแก้นอก migration · หยุด ห้าม replace ทับ', r.n, r.h_a, r.h_b, r.h_new, v_h;
    end if;
  end loop;

  -- แถวเดิมต้องผ่าน CHECK ใหม่ — ไม่ผ่านแม้แถวเดียว = หยุด (ไม่แก้ข้อมูลให้เอง)
  select count(*) into v_bad_prof from analytics.job_record_profile where not analytics.oem_note_valid(name);
  select count(*) into v_bad_job from analytics.job where profile_name is not null and not analytics.oem_note_valid(profile_name);
  if v_bad_prof > 0 or v_bad_job > 0 then
    raise exception '0178: ชื่อแบบเดิมไม่ผ่าน oem_note_valid — job_record_profile % แถว · job.profile_name % แถว — หยุด ตรวจข้อมูลก่อน', v_bad_prof, v_bad_job;
  end if;

  -- แจ้งอย่างเดียว: ขั้นที่ส่งแล้วซึ่งเศษมากกว่าส่วนที่หาย (ด่าน scrap_over ใหม่จะปฏิเสธการส่งแบบนี้ · ข้อมูลเดิมไม่ถูกแก้)
  select count(*) into v_over
    from analytics.job_stage s
   where s.weight_in_g is not null and s.weight_out_g is not null and s.scrap_weight_g is not null
     and s.scrap_weight_g > s.weight_in_g + s.metal_added_g - s.weight_out_g;
  raise notice '0178: ขั้นเดิมที่ scrap_weight_g > ส่วนที่หาย (loss ติดลบ) = % แถว (ไม่แก้ข้อมูล)', v_over;
end;
$p$;

-- ============================================================================
-- 1. CHECK ชื่อแบบ (L1) — เพิ่ม oem_note_valid · ประกาศชื่อ constraint ชัดเจน (เดิม inline = ชื่ออัตโนมัติ)
--    ADD CONSTRAINT ตรวจแถวเดิมทั้งตาราง (แถวเดิมผ่านจากการ assert ข้างบน) · ไม่ยิง trigger · ไม่ขยับ updated_at
-- ============================================================================
do $k$
declare
  v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
     where c.conrelid = 'analytics.job_record_profile'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%btrim(name)%'
  loop
    execute format('alter table analytics.job_record_profile drop constraint %I', v_name);
  end loop;
  alter table analytics.job_record_profile add constraint jrp_name_ck
    check (name = btrim(name) and length(name) between 1 and 60 and name !~ '[<>]' and analytics.oem_note_valid(name));
end;
$k$;

alter table analytics.job drop constraint if exists job_profile_pair_ck;
alter table analytics.job add constraint job_profile_pair_ck
  check ((profile_id is null) = (profile_name is null)
         and (profile_name is null or (length(profile_name) between 1 and 60 and profile_name !~ '[<>]' and analytics.oem_note_valid(profile_name))));

-- ============================================================================
-- 2. job_core_send (def ต้นทาง 0172:1036 · ไม่มีการแก้ใน 0173-0177)
--    เพิ่ม: v_room · ด่าน scrap_weight_not_asked (ช่อง worker_qr) ก่อนตรวจน้ำหนัก · ด่าน scrap_over หลัง weight_over
-- ============================================================================
create or replace function analytics.job_core_send(
  p_job_id         uuid,
  p_expected_seq   int,
  p_occurred_on    date,
  p_weight_out     numeric,
  p_qty_scrap      int,
  p_scrap_reason   text,
  p_metal_added    numeric,
  p_weight_note    text,
  p_scrap_weight   numeric,
  p_worker_id      uuid,
  p_channel        text,
  p_actor          uuid,
  p_device_hint    text,
  p_enforce_holder boolean
)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job    analytics.job%rowtype;
  v_s      analytics.job_stage%rowtype;
  v_s2     analytics.job_stage%rowtype;
  v_today  date := analytics.job_today();
  v_scrap  int := coalesce(p_qty_scrap, 0);
  v_added  numeric := coalesce(p_metal_added, 0);
  v_reason text := null;
  v_note   text := null;
  v_name   text;
  v_def    text;
  v_room   numeric;
  v_next   record;
  v_codes  constant text[] := array['porosity', 'broken', 'wrong_design', 'missing', 'other'];
begin
  select * into v_job from analytics.job where id = p_job_id;
  if not found then
    return analytics.job_fail('job_not_found', 'ไม่พบใบงาน');
  end if;
  if v_job.status in ('done', 'cancelled') then
    return analytics.job_fail('job_closed', 'ใบงานนี้ปิดแล้ว ส่งต่อไม่ได้');
  end if;
  if p_expected_seq is null then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  select * into v_s from analytics.job_stage where job_id = p_job_id and seq = p_expected_seq;
  if not found or v_s.status = 'skipped' then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  if v_s.status = 'sent' then
    return analytics.job_fail('already_sent', 'ขั้นนี้ส่งต่อไปแล้ว');
  end if;
  if v_s.status = 'pending' then
    return analytics.job_fail('not_received', 'ขั้นนี้ยังไม่ได้รับงาน ส่งต่อไม่ได้');
  end if;

  -- ช่างส่งต่อได้เฉพาะขั้นที่ตัวเองรับ (design §3 ข้อ 18) · ออฟฟิศไม่ถูกจำกัด
  if p_enforce_holder and v_s.worker_id is distinct from p_worker_id then
    select coalesce(w.display_name, v_s.assignee_name, 'ผู้ถืออื่น') into v_name
      from (select 1) x left join analytics.worker w on w.id = v_s.worker_id;
    return analytics.job_fail('not_holder', format('งานนี้อยู่กับ %s ไม่ใช่คุณ', v_name), jsonb_build_object('by', v_name));
  end if;

  if p_occurred_on is null
     or p_occurred_on > v_today
     or (p_channel = 'worker_qr' and p_occurred_on <> v_today)
     or p_occurred_on < v_today - 14 then
    return analytics.job_fail('date_invalid', 'วันที่ส่งต่อต้องไม่ใช่อนาคตและย้อนหลังได้ไม่เกิน 14 วัน (ช่างสแกนผ่าน QR ใช้วันนี้เท่านั้น)');
  end if;
  if p_occurred_on < v_s.received_on then
    return analytics.job_fail('date_invalid', 'วันที่ส่งต่อต้องไม่ก่อนวันที่รับงานของขั้นนี้');
  end if;

  -- จำนวน: เข้า = ออก + เสีย · ของหายต้องเป็นเสียเหตุผล missing (ไม่มีช่อง "หายเฉยๆ")
  if v_scrap < 0 or v_scrap > v_s.qty_in then
    return analytics.job_fail('qty_invalid', format('จำนวนของเสียต้องอยู่ระหว่าง 0 ถึง %s ชิ้น', v_s.qty_in));
  end if;
  if v_scrap > 0 then
    v_reason := nullif(btrim(p_scrap_reason), '');
    if v_reason is null or not (
         v_reason = any (v_codes)
         or (analytics.oem_note_present(v_reason) and analytics.oem_note_valid(v_reason) and length(v_reason) <= 200 and v_reason !~ '[\r\n\t]')
       ) then
      return analytics.job_fail('reason_required', 'ของเสียต้องระบุเหตุผล (รูพรุน/หัก/ผิดแบบ/หาย/อื่นๆ)');
    end if;
  elsif nullif(btrim(p_scrap_reason), '') is not null then
    return analytics.job_fail('reason_unexpected', 'ไม่มีของเสีย จึงไม่ต้องระบุเหตุผลของเสีย');
  end if;

  -- 0178 M1: ช่างส่งน้ำหนักเศษได้เฉพาะขั้นที่แบบการบันทึกถามเศษ (scrap_weight_ask) · ใบเดิมทุกขั้น ask=false = ส่งเศษไม่ได้ · ออฟฟิศไม่ถูกจำกัด · ข้อความไม่มีตัวเลขน้ำหนัก (N1)
  if p_channel = 'worker_qr' and p_scrap_weight is not null and not v_s.scrap_weight_ask then
    return analytics.job_fail('scrap_weight_not_asked', 'ขั้นนี้ไม่ได้บันทึกเศษโลหะ — โหลดหน้าใหม่');
  end if;

  -- น้ำหนัก
  if not analytics.job_weight_ok(p_weight_out) then
    return analytics.job_fail('weight_invalid', 'น้ำหนักออกต้องมากกว่า 0 และไม่เกิน 100,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)');
  end if;
  if not analytics.job_weight_ok(v_added, true) or not analytics.job_weight_ok(p_scrap_weight) then
    return analytics.job_fail('weight_invalid', 'น้ำหนักเติมโลหะ/เศษที่เก็บได้ไม่ถูกต้อง (ทศนิยมไม่เกิน 3 ตำแหน่ง ไม่เกิน 100,000 กรัม)');
  end if;
  if v_s.weigh_required and p_weight_out is null then
    return analytics.job_fail('weight_required', 'ขั้นนี้ต้องชั่งน้ำหนักออกก่อนส่งต่อ');
  end if;
  if v_added > 0 then
    begin
      v_note := analytics.job_text_clean(p_weight_note, 'หมายเหตุเติมโลหะ', 200, true);
    exception when others then
      return analytics.job_fail('note_required', 'เติมโลหะต้องระบุหมายเหตุ');
    end;
  elsif nullif(btrim(p_weight_note), '') is not null then
    begin
      v_note := analytics.job_text_clean(p_weight_note, 'หมายเหตุน้ำหนัก', 200, false);
    exception when others then
      return analytics.job_fail('note_invalid', 'หมายเหตุน้ำหนักมีอักขระที่ไม่อนุญาตหรือยาวเกิน 200 ตัวอักษร');
    end;
  end if;
  if p_weight_out is not null and v_s.weight_in_g is not null and p_weight_out > v_s.weight_in_g + v_added then
    return analytics.job_fail('weight_over',
      format('น้ำหนักออกมากกว่าน้ำหนักเข้า %s g — ถ้าเติมโลหะให้ระบุเติมโลหะพร้อมหมายเหตุ',
             trim_scale(p_weight_out - v_s.weight_in_g - v_added)::text));
  end if;
  -- 0178 M1: เศษต้องไม่เกินส่วนที่หายไป (loss = in + added - out - scrap ต้อง >= 0) · คำนวณเฉพาะเมื่อมีทั้งน้ำหนักเข้า/ออก (ตรงกับ v_job_stage_loss) · ค่าใดเป็น null = ข้าม (ไม่ใช่ผ่านหรือตก — ไม่มี loss ให้บิดเบือน)
  v_room := case when p_weight_out is not null and v_s.weight_in_g is not null then v_s.weight_in_g + v_added - p_weight_out end;
  if p_scrap_weight is not null and v_room is not null and p_scrap_weight > v_room then
    return analytics.job_fail('scrap_over', 'น้ำหนักเศษมากกว่าส่วนที่หายไป — ชั่งใหม่');
  end if;

  update analytics.job_stage
     set status = 'sent', sent_on = p_occurred_on, qty_out = qty_in - v_scrap, qty_scrap = v_scrap, scrap_reason = v_reason,
         weight_out_g = p_weight_out, metal_added_g = v_added, weight_note = v_note, scrap_weight_g = p_scrap_weight
   where id = v_s.id
   returning * into v_s2;

  perform analytics.job_event_write(p_job_id, v_s.id, 'stage_send', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
    jsonb_build_object('stage_code', v_s.stage_code, 'auto_closed', false,
                       'before', analytics.job_stage_state(v_s), 'after', analytics.job_stage_state(v_s2)));

  select s.seq, s.stage_code, d.name_th into v_next
    from analytics.job_stage s
    join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
   where s.job_id = p_job_id and s.status = 'pending' order by s.seq limit 1;
  select d.name_th into v_def from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_s.stage_code;

  return jsonb_build_object('ok', true, 'action', 'send', 'job_no', v_job.job_no, 'stage_seq', v_s.seq, 'stage_code', v_s.stage_code,
                            'stage_name', v_def, 'sent_on', p_occurred_on, 'qty_out', v_s2.qty_out, 'qty_scrap', v_s2.qty_scrap,
                            'weight_out_g', v_s2.weight_out_g,
                            'next_stage', case when v_next.stage_code is null then null
                                          else jsonb_build_object('seq', v_next.seq, 'code', v_next.stage_code, 'name', v_next.name_th) end);
end;
$f$;

-- ============================================================================
-- 3. job_record_profile_upsert (def ต้นทาง 0176:432) — แก้เฉพาะการเรียก job_label_clean: ห่อให้ hint name_invalid (L1)
--    สร้าง/แก้แบบ — พารามิเตอร์ null = "ไม่เปลี่ยน" (ตอนแก้) · p_stages = รายการทั้งชุดแทนที่ของเดิม · ไม่แตะใบงานที่ใช้แบบนี้อยู่ (snapshot)
-- ============================================================================
create or replace function analytics.job_record_profile_upsert(
  p_shop_id               uuid,
  p_id                    uuid default null,
  p_name                  text default null,
  p_note                  text default null,
  p_stages                jsonb default null,
  p_is_active             boolean default null,
  p_seq                   int default null,
  p_require_final_weight boolean default null,
  p_actor                 uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor   uuid := coalesce(p_actor, auth.uid());
  v_cur     analytics.job_record_profile%rowtype;
  v_name    text;
  v_msg     text;
  v_hint    text;
  v_note    text;
  v_id      uuid;
  v_el      jsonb;
  v_k       text;
  v_code    text;
  v_present boolean;
  v_flag    text;
  v_flags   boolean[];
  v_seen    text[] := '{}';
  v_ok      jsonb := '[]'::jsonb;
begin
  if p_shop_id is null then
    raise exception 'job_record_profile_upsert: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'job_record_profile_upsert: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  perform analytics.job_stage_def_ensure(p_shop_id);
  perform analytics.job_record_profile_ensure(p_shop_id);

  if p_id is not null then
    select * into v_cur from analytics.job_record_profile where id = p_id and shop_id = p_shop_id for update;
    if not found then
      raise exception 'ไม่พบแบบการบันทึกในร้านนี้' using errcode = '22023', hint = 'profile_not_found';
    end if;
  end if;

  if p_name is not null then
    -- 0178 L1: ชื่อที่ job_label_clean ปฏิเสธ (ว่าง/ล่องหน/ขึ้นบรรทัดใหม่/ยาว) ได้ hint name_invalid (pg_exception_hint คืน '' ไม่ใช่ null เมื่อไม่มี hint — ต้อง nullif) · < > คง hint เดิม text_invalid
    begin
      v_name := analytics.job_label_clean(p_name, 'ชื่อแบบ', 60);
    exception when sqlstate '22023' then
      get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
      raise exception '%', v_msg using errcode = '22023', hint = coalesce(nullif(v_hint, ''), 'name_invalid');
    end;
  elsif p_id is null then
    raise exception 'ต้องระบุชื่อแบบ' using errcode = '22023', hint = 'name_required';
  else
    v_name := v_cur.name;
  end if;
  if exists (select 1 from analytics.job_record_profile p
              where p.shop_id = p_shop_id and lower(p.name) = lower(v_name) and p.id is distinct from p_id) then
    raise exception 'มีแบบชื่อ "%" อยู่แล้ว', v_name using errcode = '22023', hint = 'name_dup';
  end if;
  v_note := case when p_note is not null then analytics.job_text_clean(p_note, 'คำอธิบายแบบ', 200, false)
                 when p_id is not null then v_cur.note end;
  if p_seq is not null and not (p_seq between 1 and 10000) then
    raise exception 'ลำดับต้องอยู่ระหว่าง 1 ถึง 10,000' using errcode = '22023', hint = 'seq_invalid';
  end if;
  if p_id is not null and p_is_active is false and v_cur.is_active and (v_cur.is_default or v_cur.is_default_gold) then
    raise exception 'ปิดแบบที่เป็นค่าเริ่มไม่ได้ — ตั้งแบบอื่นเป็นค่าเริ่มก่อน' using errcode = '22023', hint = 'default_cannot_close';
  end if;

  -- ตรวจ p_stages ทั้งชุดก่อนเขียน: array ≤ 100 · แต่ละรายการ object · key ที่รู้จักเท่านั้น · flag ต้อง boolean จริง · ขั้นมีในร้าน · ไม่ซ้ำ · ชั่ง/เศษเฉพาะขั้นที่มีโลหะ
  if p_stages is not null then
    if jsonb_typeof(p_stages) is distinct from 'array' then
      raise exception 'รายการขั้นต้องเป็น array' using errcode = '22023', hint = 'stage_invalid';
    end if;
    if jsonb_array_length(p_stages) > 100 then
      raise exception 'รายการขั้นยาวเกินไป (ไม่เกิน 100)' using errcode = '22023', hint = 'stage_invalid';
    end if;
    for v_el in select value from jsonb_array_elements(p_stages) loop
      if jsonb_typeof(v_el) is distinct from 'object' then
        raise exception 'แต่ละรายการขั้นต้องเป็น object' using errcode = '22023', hint = 'stage_invalid';
      end if;
      for v_k in select jsonb_object_keys(v_el) loop
        if v_k not in ('stage_code', 'weigh', 'scrap_qty', 'scrap_weight') then
          raise exception 'รายการขั้นมี key ที่ไม่รู้จัก: %', left(v_k, 40) using errcode = '22023', hint = 'stage_invalid';
        end if;
      end loop;
      if jsonb_typeof(v_el -> 'stage_code') is distinct from 'string' then
        raise exception 'stage_code ต้องเป็นข้อความ' using errcode = '22023', hint = 'stage_invalid';
      end if;
      v_code := v_el ->> 'stage_code';
      v_flags := '{}';
      foreach v_flag in array array['weigh', 'scrap_qty', 'scrap_weight'] loop
        if v_el ? v_flag and jsonb_typeof(v_el -> v_flag) is distinct from 'boolean' then
          raise exception 'flag % ต้องเป็น true/false จริง', v_flag using errcode = '22023', hint = 'stage_invalid';
        end if;
        v_flags := v_flags || coalesce((v_el ->> v_flag)::boolean, false);
      end loop;
      select d.metal_present into v_present from analytics.job_stage_def d where d.shop_id = p_shop_id and d.code = v_code;
      if v_present is null then
        raise exception 'ไม่พบขั้น % ในทะเบียนของร้านนี้', left(v_code, 40) using errcode = '22023', hint = 'stage_invalid';
      end if;
      if v_code = any (v_seen) then
        raise exception 'ขั้น % ซ้ำในรายการ', v_code using errcode = '22023', hint = 'stage_dup';
      end if;
      v_seen := v_seen || v_code;
      if (v_flags[1] or v_flags[3]) and not v_present then
        raise exception 'ขั้น % ไม่มีโลหะอยู่ในมือ — ตั้งชั่งน้ำหนัก/น้ำหนักเศษไม่ได้', v_code using errcode = '22023', hint = 'flag_not_applicable';
      end if;
      if v_flags[1] or v_flags[2] or v_flags[3] then
        v_ok := v_ok || jsonb_build_array(jsonb_build_object('stage_code', v_code, 'weigh', v_flags[1], 'scrap_qty', v_flags[2], 'scrap_weight', v_flags[3]));
      end if;
    end loop;
  end if;

  begin
    if p_id is null then
      insert into analytics.job_record_profile (shop_id, name, note, require_final_weight, is_active, seq, created_by, updated_by)
      values (p_shop_id, v_name, v_note, coalesce(p_require_final_weight, false), coalesce(p_is_active, true), coalesce(p_seq, 100), v_actor, v_actor)
      returning id into v_id;
    else
      update analytics.job_record_profile
         set name = v_name, note = v_note,
             require_final_weight = coalesce(p_require_final_weight, require_final_weight),
             is_active = coalesce(p_is_active, is_active), seq = coalesce(p_seq, seq), updated_by = v_actor
       where id = p_id and shop_id = p_shop_id
       returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception 'มีแบบชื่อ "%" อยู่แล้ว', v_name using errcode = '22023', hint = 'name_dup';
  end;

  if p_stages is not null then
    delete from analytics.job_record_profile_stage where profile_id = v_id;
    insert into analytics.job_record_profile_stage (profile_id, shop_id, stage_code, weigh, scrap_qty, scrap_weight)
    select v_id, p_shop_id, e ->> 'stage_code', (e ->> 'weigh')::boolean, (e ->> 'scrap_qty')::boolean, (e ->> 'scrap_weight')::boolean
      from jsonb_array_elements(v_ok) e;
  end if;

  return analytics.job_profile_json(v_id) || jsonb_build_object('jobs_open', (
    select count(*)::int from analytics.job j where j.profile_id = v_id and j.status not in ('done', 'cancelled')));
end;
$f$;

-- ============================================================================
-- 4. สิทธิ์ — service_role เท่านั้น (ข้อ 18) · job_core_send = ภายใน ไม่ grant ใคร · job_record_profile_upsert = RPC ออฟฟิศ (service_role)
--    replace ไม่เปลี่ยน signature ⇒ ไม่เกิด overload (ตรวจท้าย) · ปิดทั้งสามชื่อ (public, anon, authenticated) เสมอ
-- ============================================================================
revoke all on function analytics.job_core_send(uuid, int, date, numeric, int, text, numeric, text, numeric, uuid, text, uuid, text, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function analytics.job_record_profile_upsert(uuid, uuid, text, text, jsonb, boolean, int, boolean, uuid) from public, anon, authenticated;
grant execute on function analytics.job_record_profile_upsert(uuid, uuid, text, text, jsonb, boolean, int, boolean, uuid) to service_role;

-- ============================================================================
-- 5. ยืนยันว่าไม่มีอะไรขยับนอกรายการที่ตั้งใจ (md5 ฟังก์ชันทุกตัว · ไม่มีฟังก์ชันใหม่/overload · updated_at · trigger เปิดครบ · CHECK ใหม่อยู่ครบ · สิทธิ์)
-- ============================================================================
do $c$
declare
  v_changed text;
  v_unexpected text;
  v_dup text;
  v_row record;
  v_n int;
  c_replaced constant text[] := array['job_core_send', 'job_record_profile_upsert'];
begin
  select string_agg(b.sig, ', ') into v_changed
    from _j178_fn_base b
    left join pg_proc p on p.oid = to_regprocedure(b.sig)
   where not (b.proname = any (c_replaced))
     and (p.oid is null or md5(pg_get_functiondef(p.oid)) <> b.h);
  if v_changed is not null then
    raise exception '0178 แตะฟังก์ชันที่ไม่ได้ตั้งใจแตะ (md5 ไม่เท่า/หาย): %', v_changed;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_unexpected
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
     and p.oid::regprocedure::text not in (select sig from _j178_fn_base);
  if v_unexpected is not null then
    raise exception '0178 มีฟังก์ชันใหม่/signature ใหม่ที่ไม่ได้ประกาศ (overload?): %', v_unexpected;
  end if;
  select string_agg(proname, ', ') into v_dup from (
    select proname from pg_proc where pronamespace = 'analytics'::regnamespace and proname = any (c_replaced) group by proname having count(*) <> 1) d;
  if v_dup is not null then
    raise exception '0178: พบ overload ของฟังก์ชัน: %', v_dup;
  end if;
  -- ฉบับใหม่ลงจริง
  if pg_get_functiondef('analytics.job_core_send(uuid,int,date,numeric,int,text,numeric,text,numeric,uuid,text,uuid,text,boolean)'::regprocedure) not like '%scrap_weight_not_asked%'
     or pg_get_functiondef('analytics.job_core_send(uuid,int,date,numeric,int,text,numeric,text,numeric,uuid,text,uuid,text,boolean)'::regprocedure) not like '%scrap_over%'
     or pg_get_functiondef('analytics.job_record_profile_upsert(uuid,uuid,text,text,jsonb,boolean,int,boolean,uuid)'::regprocedure) not like '%name_invalid%' then
    raise exception '0178: ฟังก์ชันใหม่ไม่ลงตามที่ตั้งใจ';
  end if;
  -- CHECK ใหม่อยู่ครบ (ทั้ง 2 ตารางมี oem_note_valid · ไม่เหลือ CHECK ชื่อเก่าซ้ำ)
  select count(*) into v_n from pg_constraint c
   where c.conrelid = 'analytics.job_record_profile'::regclass and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%btrim(name)%';
  if v_n <> 1 or not exists (select 1 from pg_constraint c where c.conrelid = 'analytics.job_record_profile'::regclass and c.conname = 'jrp_name_ck'
                                and pg_get_constraintdef(c.oid) like '%oem_note_valid(name)%') then
    raise exception '0178: CHECK ชื่อของ job_record_profile ไม่ถูกต้อง (พบ % ตัวที่เกี่ยวกับ btrim(name))', v_n;
  end if;
  if not exists (select 1 from pg_constraint c where c.conrelid = 'analytics.job'::regclass and c.conname = 'job_profile_pair_ck'
                    and pg_get_constraintdef(c.oid) like '%oem_note_valid(profile_name)%') then
    raise exception '0178: CHECK job_profile_pair_ck ไม่มี oem_note_valid';
  end if;
  -- สิทธิ์: core = ไม่มีใครรันได้ · upsert = service_role เท่านั้น
  if has_function_privilege('anon', 'analytics.job_core_send(uuid,int,date,numeric,int,text,numeric,text,numeric,uuid,text,uuid,text,boolean)', 'execute')
     or has_function_privilege('authenticated', 'analytics.job_core_send(uuid,int,date,numeric,int,text,numeric,text,numeric,uuid,text,uuid,text,boolean)', 'execute')
     or has_function_privilege('service_role', 'analytics.job_core_send(uuid,int,date,numeric,int,text,numeric,text,numeric,uuid,text,uuid,text,boolean)', 'execute')
     or has_function_privilege('anon', 'analytics.job_record_profile_upsert(uuid,uuid,text,text,jsonb,boolean,int,boolean,uuid)', 'execute')
     or has_function_privilege('authenticated', 'analytics.job_record_profile_upsert(uuid,uuid,text,text,jsonb,boolean,int,boolean,uuid)', 'execute')
     or not has_function_privilege('service_role', 'analytics.job_record_profile_upsert(uuid,uuid,text,text,jsonb,boolean,int,boolean,uuid)', 'execute') then
    raise exception '0178: สิทธิ์ execute ผิดรูป (core ต้องไม่มีใครรัน · upsert ต้อง service_role เท่านั้น)';
  end if;
  -- updated_at ของ job/job_stage/job_record_profile ต้องเท่าเดิมเป๊ะ (ไม่มี UPDATE ในไฟล์นี้ · ADD CONSTRAINT ไม่ยิง trigger)
  for v_row in
    select b.t, b.n, b.nd, b.h,
           case b.t when 'job' then (select count(*) from analytics.job)
                    when 'job_stage' then (select count(*) from analytics.job_stage)
                    else (select count(*) from analytics.job_record_profile) end as n2,
           case b.t when 'job' then (select count(distinct updated_at) from analytics.job)
                    when 'job_stage' then (select count(distinct updated_at) from analytics.job_stage)
                    else (select count(distinct updated_at) from analytics.job_record_profile) end as nd2,
           case b.t when 'job' then (select coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') from analytics.job)
                    when 'job_stage' then (select coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') from analytics.job_stage)
                    else (select coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') from analytics.job_record_profile) end as h2
      from _j178_row_base b
  loop
    if v_row.n <> v_row.n2 or v_row.nd <> v_row.nd2 or v_row.h <> v_row.h2 then
      raise exception '0178: updated_at ของ % ขยับ (n % -> %, distinct % -> %)', v_row.t, v_row.n, v_row.n2, v_row.nd, v_row.nd2;
    end if;
  end loop;
  if exists (select 1 from pg_trigger t where t.tgrelid in ('analytics.job'::regclass, 'analytics.job_stage'::regclass, 'analytics.job_event'::regclass,
                                                          'analytics.job_record_profile'::regclass, 'analytics.job_record_profile_stage'::regclass)
                and not t.tgisinternal and t.tgenabled <> 'O') then
    raise exception '0178: มี trigger บนตารางใบงาน/แบบการบันทึกที่ไม่ได้อยู่ในสถานะเปิด (O)';
  end if;
  raise notice '0178: ฟังก์ชันเดิมนอกรายการแทนที่ md5 เท่าเดิมทั้งหมด · updated_at ไม่ขยับ · CHECK ชื่อ 2 ตารางมี oem_note_valid · สิทธิ์ถูกต้อง';
end;
$c$;

notify pgrst, 'reload schema';

-- 0194_stage_order_gem_before_buff.sql — เรียงขั้นใหม่ "ตัดต้น -> แต่ง -> ฝังพลอย -> ขัด -> ชุบ -> QC -> แพ็ก" (ฝังพลอยมาก่อนขัด) · มติเจ้าของ 27 ต.ค. 69
-- สถานะ: ยังไม่ apply · 🔴 ห้าม apply ก่อน 0192 และ 0193 (ไม่ใช่ข้อห้ามของ DB — แต่ verify-0192.std() สมมติ "ขัดก่อนฝังพลอย" ⇒ ลง 0194 ก่อน = ชุดทดสอบ 0192 FAIL · pre-check ไฟล์นี้เตือน (warning) ถ้ายังไม่เห็น 0192/0193 ในประวัติ ไม่ raise เพราะต้อง dry-run ได้ก่อน)
-- apply ด้วย node scripts/run-sql.mjs --commit --record เท่านั้น (ห้าม supabase db push) · ชุดทดสอบ scripts/verify/verify-0194.sql (ส่วน A) + verify-0194-b.sql (ส่วน B)
-- 🔴 ส่วน "สลับ seq ใบค้าง" (ระหว่างบรรทัด PART B BEGIN/END) มี alter table analytics.job_stage disable trigger ⇒ ล็อกตาราง job_stage ตลอดทรานแซกชัน ⇒ รันนอกเวลางานเท่านั้น (หลัง 23:00 ตอนช่างไม่กดงาน)
--    ถ้าไม่มีใบค้างเข้าเงื่อนไข ส่วนนั้นไม่ล็อกอะไรเลย (ตรวจก่อนล็อก) · ส่วนที่เหลือของไฟล์ไม่มี disable trigger — dry-run กลางวันได้โดยตัดบล็อก PART B ออก
--
-- ทำไม: หน้างานฝังพลอยก่อนขัด (ขัดเป็นขั้นสุดท้ายก่อนชุบ — ขัดหลังฝังพลอยเพื่อให้ผิวโลหะรอบหัวเม็ดเรียบ) · 0184 เคยตั้ง "แต่ง -> ขัด -> ฝังพลอย" ⇒ ทับด้วยลำดับใหม่นี้
--
-- มติเจ้าของ: (ก) ใบค้างที่ยังไม่เริ่มทั้งขัดและฝังพลอย -> สลับตามลำดับใหม่ · ใบที่เริ่มขั้นใดแล้วเดินเดิมจนจบ (ข) ทุกแบบสินค้า ลำดับเดียวทั้งร้าน
--           (ค) ขั้นขัดไม่ต้องชั่ง — ทางเลือก ค-1: weigh_default=false ที่ทะเบียนอย่างเดียว ไม่แตะแบบบันทึกของทอง (ไฟล์นี้) · ค-2 (ถ้าเจ้าของเลือก) แยกเป็น 0195
--
-- โมเดล (ตัดสินแล้ว — เหตุผล):
--  1. ย้าย buff 92 -> 105 (ไม่ย้าย gem_set) — gem_set คงที่ 100 · ช่องว่าง 105 ว่างทุกร้าน (unique (shop_id, seq_default)) · UPDATE จังหวะเดียวไม่ชนกลางทาง
--     guard ค่าเดิม (seq_default = 92) ⇒ รันซ้ำไม่ทำอะไร · ไม่มี trigger บน job_stage_def (ตรวจ pg_trigger 27 ต.ค. 69)
--     weigh_default = false ของ buff: ไม่มีใครอ่านแล้วนอกจาก job_stage_def_ensure (ตั้งแต่ 0176 ใบรับ flag จาก job_record_profile_stage) ⇒ มีผลแค่ seed ร้านใหม่
--  2. job_stage_def_ensure ชุดใหม่ (ลอก 0184 แก้ลำดับ + buff 105 + weigh false) · ไม่เปลี่ยน arg list · proacl เท่าเดิม ({postgres=X/postgres}) · ไม่ grant ใคร
--  3. job_stage_guard — แก้เฉพาะบล็อก "ลำดับใน job ต้องไม่ขัดกับ seq_default" ของ INSERT (ลอก definition สดจาก pg_get_functiondef 27 ต.ค. 69 ฉบับหลัง 0183 · md5 pre-check ท้ายหัวนี้)
--     ปัญหา: ด่านอ่านทะเบียนปัจจุบัน แต่ใบเก่าที่ผ่าน ขัด->ฝังพลอย ไปแล้ว (แบบ JB-0041) มี seq ตามผังเก่า ⇒ แยกส่วนย่อย (job_lot_split_core) / ได้รับเพิ่มแล้ว (job_discrepancy_arrive_core)
--     ที่ loop INSERT ขั้นของส่วนย่อยตาม seq ของใบแม่ จะชนด่านลำดับ -> raise ⇒ ใบเก่าแยกส่วนไม่ได้ (เส้น UPDATE รับ/ส่ง/ย้อน/ข้าม ใช้ job_stage.seq ไม่อ่านทะเบียน ⇒ ไม่พัง)
--     แก้: ใบแม่ = ด่านทะเบียนเดิมเป๊ะ · ส่วนย่อย = ต้องเป็นสำเนา (รหัสขั้น, seq) ของใบแม่เท่านั้น (hint split_link) — แน่นกว่าเดิม (เดิมส่วนย่อยที่ seq เรียงตามทะเบียนแต่ไม่ตรงใบแม่ผ่านได้) ไม่มี GUC bypass
--     ตัดทิ้ง: ข้ามด่านลำดับเมื่อเป็นส่วนย่อย (หลวมเกิน)
--  4. สลับ seq ใบค้าง (PART B) — เงื่อนไขทั่วไป ไม่ hardcode job_no/id: ใบแม่ (parent_job_id is null) status open/in_progress/on_hold · มี buff และ gem_set · ทั้งคู่ pending · buff.seq < gem_set.seq
--     ไม่ติดกัน (buff.seq + 1 <> gem_set.seq) หรือใบมีส่วนย่อย ⇒ raise (ให้คนตัดสิน — ส่วนย่อยคัดลอก seq ใบแม่ ถ้าสลับใบแม่แล้วส่วนย่อยไม่ตาม ใบจะเพี้ยน)
--     guard ปฏิเสธ new.seq <> old.seq ⇒ ปิด trg_job_stage_guard ชั่วคราว (ไม่ปิด trg_job_stage_sync) · 3 จังหวะกัน unique (job_id, seq): buff->100 · gem_set->seq เดิมของ buff · buff->seq เดิมของ gem_set
--     (seq check 1..100 ⇒ ค่ากลาง 100) · updated_at = now() เฉพาะ 2 แถว · ไม่เขียน job_event (CHECK บังคับ actor — เหตุผลเดียวกับ 0184 ข้อ 6)
--     ปิดท้าย: job_stage ทุกแถวยกเว้น 2 แถวที่ตั้งใจเท่าเดิมเป๊ะ · job เท่าเดิมยกเว้น current_stage_code/updated_at ของใบที่สลับ · job_event เท่าเดิม · trigger กลับมา enabled ไม่งั้น raise ถอยทั้งก้อน
--  5. job_source_info ไม่แก้ — ชุดค่าเริ่มเรียงผ่าน job_sort_stage_codes (order by seq_default) ⇒ ได้ finish, gem_set, buff เองจากทะเบียนใหม่ · job_validate_stage_codes อ่าน seq_default สด ⇒ ใบใหม่ [.., buff, gem_set, ..] ถูกปฏิเสธ stages_order (ตั้งใจ)
--  6. ไม่แตะ worker.stage_codes (ไม่ผูกลำดับ) · ไม่แตะ rate OEM · ไม่แตะ job_record_profile_stage (ค-1)
--
-- หนี้ / ข้อจำกัด (บอกตรงๆ):
--  · ใบทอง + gem_set ชั่งทุกขั้น ⇒ weight_out (รวมพลอย) > weight_in ชน js_weight_ck / weight_over ใน job_core_send — ยังไม่เกิด (บน prod ไม่มีใบทองที่มี gem_set) แต่ใบทองใบแรกที่มีพลอยจะติด — ไม่ใช่ของ 0194
--  · ใบทอง ค-1: ทองที่หายตอนขัดดูได้จาก buff.in − buff.out และ handoff gem_set.out <-> buff.in (±0.05) — ไม่มีการชั่งขัดแยกจากฝัง
--  · ชุดทดสอบเก่า verify-0172..0191 ที่สร้างใบ "ขัดก่อนฝังพลอย" รันซ้ำหลัง 0194 ไม่ได้ (stages_order)
--  · race 2 connection ไม่มีเทสต์ (do-block ทรานแซกชันเดียวจำลองไม่ได้) — ส่วน PART B กันด้วยล็อกตาราง + อ่านใบเข้าเงื่อนไขใหม่หลังล็อก

set local lock_timeout = '8s';

-- baseline: ฟังก์ชันอื่นทั้งสคีมา (md5 นิยาม + สิทธิ์) ต้องเท่าเดิมหลังไฟล์นี้ — ยกเว้น 2 ตัวที่ตั้งใจแก้
create temp table _j194_fn_base on commit drop as
  select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h, coalesce(p.proacl::text, 'NULL') as acl
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p') and p.proname not in ('job_stage_guard', 'job_stage_def_ensure');
create temp table _j194_acl_base on commit drop as
  select p.oid::regprocedure::text as sig, coalesce(p.proacl::text, 'NULL') as acl
    from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('job_stage_guard', 'job_stage_def_ensure');
create temp table _j194_def_base on commit drop as select * from analytics.job_stage_def;

-- ============================================================================
-- 0. pre-check — ฟังก์ชันที่จะ replace ต้องเป็นฉบับที่ลอกมา (หรือฉบับใหม่ของไฟล์นี้ = รันซ้ำ) · ไม่งั้นมีคน replace ทับนอกไฟล์ ⇒ หยุด
-- ============================================================================
do $pre$
declare
  v_g text;
  v_e text;
  v_n int;
begin
  select md5(pg_get_functiondef(p.oid)) into v_g from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_stage_guard';
  select md5(pg_get_functiondef(p.oid)) into v_e from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_stage_def_ensure';
  if v_g is null or v_g not in ('ea1258e01ab33739a5fefbd34cd4586b', 'f78049fa169cfb0e9e1d689f4c0a3943') then
    raise exception '0194: job_stage_guard บน DB ไม่ใช่ฉบับที่ลอกมา (md5 %) — มีคน replace ทับหลัง 0183 · ลอก definition สดใหม่ก่อน', v_g;
  end if;
  if v_e is null or v_e not in ('3f80a71f7210d6d3d3202f0b35a4e21f', 'c751a76d5f18845c72f5aaf6497814e0') then
    raise exception '0194: job_stage_def_ensure บน DB ไม่ใช่ฉบับ 0184 (md5 %) — มีคน replace ทับ · ลอก definition สดใหม่ก่อน', v_e;
  end if;
  -- ลำดับ apply (เตือนอย่างเดียว — ดูหัวไฟล์)
  if not exists (select 1 from supabase_migrations.schema_migrations where left(name, 4) = '0192')
     or not exists (select 1 from supabase_migrations.schema_migrations where left(name, 4) = '0193') then
    raise warning '0194: ยังไม่เห็น 0192/0193 ในประวัติ migration — ห้าม apply จริงก่อน 2 ไฟล์นั้น (dry-run ได้)';
  end if;
  -- ทะเบียนทุกร้านต้องเป็นผังที่รู้จัก: buff อยู่ 92 (ก่อน) หรือ 105 (หลัง) · ก่อนย้าย gem_set ต้องอยู่ 100 และช่อง 105 ว่าง (ไม่งั้น unique ชนกลางทาง)
  select count(*) into v_n from analytics.job_stage_def b where b.code = 'buff' and b.seq_default not in (92, 105);
  if v_n > 0 then
    raise exception '0194: มี % ร้านที่ buff.seq_default ไม่ใช่ 92/105 — ผังไม่ใช่ผัง 0184 ตรวจก่อน', v_n;
  end if;
  select count(*) into v_n from analytics.job_stage_def b
   where b.code = 'buff' and b.seq_default = 92
     and (not exists (select 1 from analytics.job_stage_def g where g.shop_id = b.shop_id and g.code = 'gem_set' and g.seq_default = 100)
          or exists (select 1 from analytics.job_stage_def o where o.shop_id = b.shop_id and o.seq_default = 105));
  if v_n > 0 then
    raise exception '0194: มี % ร้านที่ gem_set ไม่ได้อยู่ 100 หรือช่อง 105 ไม่ว่าง — ย้าย buff ไป 105 ไม่ได้', v_n;
  end if;
end;
$pre$;

-- ============================================================================
-- 1. ทะเบียน: buff 92 -> 105 + weigh_default false (ค-1) · where ค่าเดิม ⇒ รันซ้ำไม่แตะแถวเดิม
-- ============================================================================
update analytics.job_stage_def set seq_default = 105, weigh_default = false where code = 'buff' and seq_default = 92;

-- ============================================================================
-- 2. job_stage_def_ensure — ชุดใหม่ (ร้านใหม่ 14 แถว ไม่มี polish · gem_set 100 ก่อน buff 105 · buff ไม่ชั่งค่าเริ่ม)
--    ตัวฟังก์ชันลอกจาก 0184 แก้เฉพาะรายการ values
-- ============================================================================
create or replace function analytics.job_stage_def_ensure(p_shop_id uuid)
 returns void
 language sql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
  insert into analytics.job_stage_def (shop_id, code, name_th, seq_default, cost_block, batch_kind, weigh_default, metal_present)
  select p_shop_id, v.code, v.name_th, v.seq, v.cost_block, v.batch_kind, v.weigh_default, v.metal_present
  from (values
    ('cad',            'ออกแบบ CAD',               10,  'nre',       null,           false, false),
    ('print3d',        'ปริ้น 3D ต้นแบบ',          20,  'nre',       null,           false, false),
    ('mold',           'อัดก้อนยาง',               30,  'nre',       null,           false, false),
    ('wax_inject',     'ฉีดเทียน',                 40,  'per_piece', null,           false, false),
    ('wax_tree',       'ติดต้นเทียน',              50,  'batch',     null,           false, false),
    ('invest_burnout', 'ปั่นปูน เทปูน เผา',        60,  'batch',     'flask',        false, false),
    ('cast',           'หล่อ',                     70,  'batch',     'flask',        true,  true),
    ('cut_sprue',      'ตัดต้น',                   80,  'per_piece', null,           true,  true),
    ('finish',         'แต่ง',                     91,  'per_piece', null,           true,  true),
    ('gem_set',        'ฝังพลอย',                  100, 'per_piece', null,           false, true),
    ('buff',           'ขัด',                      105, 'per_piece', null,           false, true),
    ('plating',        'ชุบ',                      110, 'batch',     'plating_tank', false, true),
    ('qc',             'ตรวจ QC',                  120, 'per_piece', null,           false, true),
    ('pack',           'แพ็ก',                     130, 'per_piece', null,           false, true)
  ) as v(code, name_th, seq, cost_block, batch_kind, weigh_default, metal_present)
  on conflict (shop_id, code) do nothing
$f$;
revoke execute on function analytics.job_stage_def_ensure(uuid) from public, anon, authenticated;

-- ============================================================================
-- 3. job_stage_guard — ลอกสดจาก DB (md5 ea1258e01ab33739a5fefbd34cd4586b) แก้เฉพาะบล็อก "ลำดับใน job ต้องไม่ขัดกับ seq_default" + บรรทัดคอมเมนต์ 0194 หลัง begin
-- ============================================================================
CREATE OR REPLACE FUNCTION analytics.job_stage_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
declare
  v_job    analytics.job%rowtype;
  v_prev   analytics.job_stage%rowtype;
  v_exp_in int;
  v_link   int;
  v_wlink  numeric;
begin
  -- 0194: แก้เฉพาะบล็อก "ลำดับใน job ต้องไม่ขัดกับ seq_default" ของ INSERT (ใบแม่ = ด่านทะเบียนเดิม · ส่วนย่อย = ต้องเป็นสำเนาของใบแม่) — ที่เหลือลอกจากฉบับหลัง 0183 ตรงๆ
  -- 0183: + arrive_discrepancy_id — ขั้นที่รับขาดของส่วนที่เกิดจาก "ได้รับเพิ่มแล้ว" ทำหน้าที่เป็นขั้นต้นทางของส่วน (แทน split_from_stage_id · ไม่มี qty_split_out)
  -- 0181: ส่วนย่อย (แยก/ยกเลิก/ส่วนต่าง) — ของเดิมทุกข้อคงไว้ · เพิ่ม: qty_split_out (ผูกกับส่วนที่ชี้ขั้นนี้) · split_from_stage_id · โซ่จำนวนหักส่วนต่าง · ห้าม auto-close/ย้อนขั้นที่แยก
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
    if new.qty_split_out <> 0 then
      raise exception 'job_stage: ขั้นใหม่ต้องมี qty_split_out = 0' using errcode = '22023';
    end if;
    -- ส่วนย่อยคัดลอกขั้นจากใบแม่ — ขั้นที่ถูกปิดใช้งานทีหลังก็ต้องคัดลอกได้ (ใบแม่เองยังเช็คทะเบียนตามเดิม)
    if v_job.parent_job_id is null
       and not exists (select 1 from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = new.stage_code and d.is_active) then
      raise exception 'job_stage: ขั้น % ถูกปิดใช้งานหรือไม่มีในทะเบียน', new.stage_code using errcode = '22023';
    end if;
    if new.split_from_stage_id is not null then
      if v_job.parent_job_id is null
         or not exists (select 1 from analytics.job_stage ps join analytics.job pj on pj.id = ps.job_id
                         where ps.id = new.split_from_stage_id and ps.stage_code = new.stage_code
                           and (pj.id = v_job.parent_job_id or pj.parent_job_id = v_job.parent_job_id)) then
        raise exception 'job_stage: split_from_stage_id ต้องชี้ขั้นเดียวกันของใบแม่/ส่วนในต้นไม้เดียวกัน' using errcode = '22023', hint = 'split_link';
      end if;
      if exists (select 1 from analytics.job_stage x where x.job_id = new.job_id and (x.split_from_stage_id is not null or x.arrive_discrepancy_id is not null)) then
        raise exception 'job_stage: 1 ส่วนมีขั้นแยกได้ขั้นเดียว' using errcode = '22023', hint = 'split_link';
      end if;
    end if;
    -- 0183: ขั้นที่รับขาดของส่วนที่เกิดจากได้รับเพิ่มแล้ว: ต้องเป็นส่วนย่อย · ชี้แถวส่วนต่าง resolved/arrived ของใบแม่เดียวกัน · ขั้นเดียวกับขั้นผู้รับของส่วนต่าง · 1 ส่วนมีได้ขั้นเดียว
    if new.arrive_discrepancy_id is not null then
      if v_job.parent_job_id is null or new.split_from_stage_id is not null
         or not exists (select 1 from analytics.job_discrepancy ad join analytics.job_stage ats on ats.id = ad.to_stage_id
                         where ad.id = new.arrive_discrepancy_id and ad.status = 'resolved' and ad.resolved_kind = 'arrived'
                           and ad.root_job_id = v_job.parent_job_id and ats.stage_code = new.stage_code) then
        raise exception 'job_stage: arrive_discrepancy_id ต้องชี้ส่วนต่าง arrived ของใบแม่เดียวกัน ที่ขั้นเดียวกัน' using errcode = '22023', hint = 'arrive_link';
      end if;
      if exists (select 1 from analytics.job_stage x where x.job_id = new.job_id and (x.split_from_stage_id is not null or x.arrive_discrepancy_id is not null)) then
        raise exception 'job_stage: 1 ส่วนมีขั้นแยกได้ขั้นเดียว' using errcode = '22023', hint = 'arrive_link';
      end if;
    end if;
    -- 0194: ลำดับใน job ต้องไม่ขัดกับ seq_default ของทะเบียน (design §3 ข้อ 12) — เฉพาะใบแม่ (ผังตามทะเบียนปัจจุบัน)
    --   ส่วนย่อย = สำเนาของใบแม่ (split/arrive คัดลอก (รหัสขั้น, seq) ของใบแม่ตรงๆ) ⇒ ต้องตรงใบแม่เป๊ะ แทนการเทียบทะเบียน
    --   เหตุผล: ใบเก่าที่ผ่านลำดับเดิมไปแล้วมี seq ตามผังเก่า ถ้าเทียบทะเบียนใหม่ส่วนย่อยของมันจะถูกปฏิเสธ — ด่านนี้แน่นกว่าเดิม ไม่มีทาง bypass
    if v_job.parent_job_id is null then
      if exists (
           select 1
             from analytics.job_stage s
             join analytics.job_stage_def d  on d.shop_id = s.shop_id and d.code = s.stage_code
             join analytics.job_stage_def dn on dn.shop_id = new.shop_id and dn.code = new.stage_code
            where s.job_id = new.job_id
              and ((s.seq < new.seq and d.seq_default > dn.seq_default) or (s.seq > new.seq and d.seq_default < dn.seq_default))) then
        raise exception 'job_stage: ลำดับขั้นต้องเรียงตามลำดับมาตรฐานของทะเบียนขั้นตอน' using errcode = '22023';
      end if;
    elsif not exists (select 1 from analytics.job_stage ps
                       where ps.job_id = v_job.parent_job_id and ps.stage_code = new.stage_code and ps.seq = new.seq) then
      raise exception 'job_stage: ขั้นของส่วนย่อยต้องเป็นสำเนา (รหัส, ลำดับ) ของใบแม่' using errcode = '22023', hint = 'split_link';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.job_id <> old.job_id or new.shop_id <> old.shop_id or new.stage_code <> old.stage_code or new.seq <> old.seq
     or new.split_from_stage_id is distinct from old.split_from_stage_id or new.arrive_discrepancy_id is distinct from old.arrive_discrepancy_id then
    raise exception 'job_stage: ห้ามเปลี่ยนใบงาน/ขั้น/ลำดับของขั้นที่สร้างแล้ว' using errcode = '22023';
  end if;
  -- 0176: flag ชั่ง/ของเสียเปลี่ยนได้เฉพาะขั้นที่ยังไม่เริ่ม (pending/skipped · ไม่เปลี่ยนสถานะพร้อมกัน) และยังไม่มีขั้นไหนของใบถูกรับ/ส่ง — ทางเดียวคือ job_profile_apply
  if (new.weigh_required <> old.weigh_required or new.scrap_qty_ask <> old.scrap_qty_ask or new.scrap_weight_ask <> old.scrap_weight_ask)
     and not (old.status in ('pending', 'skipped') and new.status = old.status
              and not exists (select 1 from analytics.job_stage s where s.job_id = new.job_id and s.status in ('received', 'sent'))) then
    raise exception 'job_stage: ห้ามเปลี่ยนกติกาชั่ง/ของเสียของขั้นหลังช่างรับงานขั้นแรกแล้ว (เปลี่ยนได้ก่อนเริ่มผ่านการเปลี่ยนแบบการบันทึกเท่านั้น)' using errcode = '22023', hint = 'started';
  end if;
  if v_job.status in ('done', 'cancelled') then
    raise exception 'job_stage: ใบงาน % สถานะ % แล้ว แก้ขั้นไม่ได้', v_job.job_no, v_job.status using errcode = '22023';
  end if;
  if (new.qty_split_out is distinct from old.qty_split_out or new.weight_split_out_g is distinct from old.weight_split_out_g) and old.status <> 'received' then
    raise exception 'job_stage: qty_split_out เปลี่ยนได้เฉพาะขั้นที่ถืออยู่ (received)' using errcode = '22023', hint = 'has_split';
  end if;

  if new.status = old.status then
    if old.status in ('received', 'sent') and analytics.job_stage_state(new) is distinct from analytics.job_stage_state(old) then
      -- ข้อยกเว้นเดียว: ขั้น received เปลี่ยนเฉพาะ qty_split_out/qty_scrap/scrap_reason ตอนแยก (เพิ่ม — เหลือผู้ถืออย่างน้อย 1 ชิ้น) หรือคืนชิ้นจากส่วนที่ยกเลิก (ลด — ของเสียเท่าเดิม)
      if not (old.status = 'received'
              and (analytics.job_stage_state(new) - 'qty_split_out' - 'weight_split_out_g' - 'qty_scrap' - 'scrap_reason')
                  = (analytics.job_stage_state(old) - 'qty_split_out' - 'weight_split_out_g' - 'qty_scrap' - 'scrap_reason')
              and ((new.qty_split_out > old.qty_split_out and new.qty_scrap >= old.qty_scrap and new.weight_split_out_g >= old.weight_split_out_g)
                   or (new.qty_split_out < old.qty_split_out and new.weight_split_out_g <= old.weight_split_out_g and new.qty_scrap = old.qty_scrap and new.scrap_reason is not distinct from old.scrap_reason))
              and new.qty_split_out + new.qty_scrap < new.qty_in) then
        raise exception 'job_stage: ขั้นที่รับ/ส่งแล้วแก้ตรงไม่ได้ — ใช้ย้อนขั้น (job_stage_reopen) พร้อมเหตุผล' using errcode = '22023';
      end if;
      -- qty_split_out ต้องเท่ากับผลรวมจำนวนของส่วนที่ชี้ขั้นนี้ (ไม่นับส่วนที่ยกเลิกแบบคืนชิ้น) — แก้ตรงๆ โดยไม่มีส่วนรองรับไม่ได้
      select coalesce(sum(lj.qty_planned), 0) into v_link
        from analytics.job_stage ls join analytics.job lj on lj.id = ls.job_id
       where ls.split_from_stage_id = new.id and not (lj.status = 'cancelled' and lj.cancel_scrap_qty is null);
      if new.qty_split_out <> v_link then
        raise exception 'job_stage: qty_split_out ต้องเท่ากับผลรวมจำนวนของส่วนที่แยกจากขั้นนี้' using errcode = '22023', hint = 'split_link';
      end if;
      -- H2: น้ำหนักที่แยกออก (ทองที่ขั้นชั่ง) ต้องเท่า Σ น้ำหนักออกของขั้นแยกของส่วนที่ชี้ขั้นนี้ — กระทบยอดน้ำหนักได้เสมอ
      select coalesce(sum(ls.weight_out_g), 0) into v_wlink
        from analytics.job_stage ls join analytics.job lj on lj.id = ls.job_id
       where ls.split_from_stage_id = new.id and not (lj.status = 'cancelled' and lj.cancel_scrap_qty is null);
      if new.weight_split_out_g <> v_wlink then
        raise exception 'job_stage: weight_split_out_g ต้องเท่าผลรวมน้ำหนักของส่วนที่แยกจากขั้นนี้' using errcode = '22023', hint = 'split_link';
      end if;
    end if;
    new.updated_at := now();
    return new;
  end if;

  -- เปลี่ยนสถานะ: qty_split_out ห้ามขยับพร้อมกัน (received→sent คงค่าเดิม — js_sent_ck ใช้ค่านั้น)
  if new.qty_split_out is distinct from old.qty_split_out or new.weight_split_out_g is distinct from old.weight_split_out_g then
    raise exception 'job_stage: ห้ามเปลี่ยน qty_split_out พร้อมเปลี่ยนสถานะ' using errcode = '22023', hint = 'has_split';
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
      -- 0181: ผู้รับได้ = ที่ขั้นก่อนส่งออก − ส่วนต่างที่บันทึกไว้ (open/resolved ที่ไม่ถูก void) — ไม่มีส่วนต่าง ⇒ นิยามเดิมเป๊ะ
      v_exp_in := v_prev.qty_out - analytics.job_disc_active_qty(v_prev.id, new.id);
      if new.received_on < v_prev.sent_on then
        raise exception 'job_stage: วันรับ (%) ต้องไม่ก่อนวันส่งของขั้นก่อนหน้า (%)', new.received_on, v_prev.sent_on using errcode = '22023';
      end if;
    else
      v_exp_in := v_job.qty_planned;
    end if;
    if new.qty_in is distinct from v_exp_in then
      raise exception 'job_stage: จำนวนเข้า (%) ต้องเท่าจำนวนที่ส่งออกจากขั้นก่อนหน้า (%) หักส่วนต่างที่บันทึก', new.qty_in, v_exp_in using errcode = '22023';
    end if;
  elsif old.status = 'pending' and new.status = 'skipped' then
    -- ข้ามขั้น QC/แพ็กไม่ได้ · ยกเว้นเดียว: ส่วนย่อยที่รับช่วงมา (split_inherit) ข้ามขั้นที่ใบแม่ผ่านไปแล้ว — ต้องมีขั้นแยกของส่วนนั้นอยู่ถัดไป (ตั้งตอนสร้างส่วนเท่านั้น)
    if new.stage_code in ('qc', 'pack')
       and not (v_job.parent_job_id is not null and new.skip_reason = 'split_inherit'
                and exists (select 1 from analytics.job_stage x where x.job_id = new.job_id and x.seq > new.seq and (x.split_from_stage_id is not null or x.arrive_discrepancy_id is not null))) then
      raise exception 'job_stage: ข้ามขั้น QC และแพ็กไม่ได้' using errcode = '22023';
    end if;
  elsif old.status = 'received' and new.status = 'sent' then
    -- 0176: ขั้นที่ต้องชั่งปิดอัตโนมัติไม่ได้ทุกโลหะ + ใบทองเดิม (ก่อน profile) ปิดอัตโนมัติไม่ได้ทุกขั้นเหมือน J1
    if new.auto_closed and (new.weigh_required or (v_job.metal = 'gold' and v_job.profile_id is null)) then
      raise exception 'job_stage: งานทอง/ขั้นที่ต้องชั่งปิดขั้นอัตโนมัติไม่ได้ — ต้องกดส่งต่อพร้อมน้ำหนักออก' using errcode = '22023';
    end if;
    if new.auto_closed and old.qty_split_out > 0 then
      raise exception 'job_stage: ขั้นที่แยกส่วนออกไปแล้วปิดอัตโนมัติไม่ได้ — ผู้ถือต้องกดส่งต่อส่วนที่เหลือเอง' using errcode = '22023', hint = 'prev_not_sent';
    end if;
  elsif (old.status = 'received' and new.status = 'pending')
     or (old.status = 'sent' and new.status = 'received')
     or (old.status = 'skipped' and new.status = 'pending') then
    -- ย้อนขั้น: ทำได้เมื่อไม่มีขั้นถัดไปที่ received/sent อยู่ (design §3 ข้อ 4)
    if exists (select 1 from analytics.job_stage s where s.job_id = new.job_id and s.seq > new.seq and s.status in ('received', 'sent')) then
      raise exception 'job_stage: ย้อนข้ามขั้นที่ขั้นถัดไปรับหรือส่งไปแล้วไม่ได้ — ย้อนทีละขั้นจากขั้นล่าสุด' using errcode = '22023';
    end if;
    -- 0181: ขั้นที่แยกส่วนออก/เป็นขั้นแยกของส่วนย่อย/รับช่วงมา (split_inherit)/เป็นต้นทางของส่วนต่างย้อนไม่ได้ (ขั้นที่ "รับ" แล้วมีส่วนต่างย้อนได้ — ออฟฟิศ void ส่วนต่างต่อ)
    if old.qty_split_out > 0 or old.split_from_stage_id is not null or old.arrive_discrepancy_id is not null
       or (old.status = 'skipped' and old.skip_reason = 'split_inherit')
       or analytics.job_disc_active_qty(old.id, null) > 0 then
      raise exception 'job_stage: ขั้นนี้มีการแยกส่วน/ส่วนต่างอ้างอิงอยู่ ย้อนขั้นไม่ได้ (has_split)' using errcode = '22023', hint = 'has_split';
    end if;
  else
    raise exception 'job_stage: เปลี่ยนสถานะ % -> % ไม่ได้', old.status, new.status using errcode = '22023';
  end if;

  new.updated_at := now();
  return new;
end;
$function$
;
revoke execute on function analytics.job_stage_guard() from public, anon, authenticated;

-- ============================================================================
-- 4. สลับ seq ใบค้างที่ยังไม่เริ่มทั้งขัดและฝังพลอย (มติ ก) — 🔴 มี disable trigger = ล็อก job_stage ⇒ รันนอกเวลางาน
--    ไม่มีใบเข้าเงื่อนไข = ไม่ล็อกอะไร · dry-run กลางวัน: ตัดบรรทัดระหว่าง PART B BEGIN ถึง PART B END ออกก่อน
-- ============================================================================
-- >>> PART B BEGIN
do $swap194$
declare
  c        record;
  v_n      int;
  v_bad    text;
  v_en     "char";
  v_nsw    int := 0;
  v_ev0    text;
  v_ev1    text;
begin
  -- 1) ดูก่อนว่ามีใบเข้าเงื่อนไขไหม (ยังไม่ล็อก) — ไม่มี = จบ
  if not exists (
       select 1 from analytics.job j
         join analytics.job_stage b on b.job_id = j.id and b.stage_code = 'buff'
         join analytics.job_stage g on g.job_id = j.id and g.stage_code = 'gem_set'
        where j.parent_job_id is null and j.status in ('open', 'in_progress', 'on_hold')
          and b.status = 'pending' and g.status = 'pending' and b.seq < g.seq) then
    raise notice '0194: ไม่มีใบค้างที่ต้องสลับ (ขัด/ฝังพลอย ยังไม่เริ่มทั้งคู่) — ข้ามส่วนสลับ ไม่ล็อกตาราง';
    return;
  end if;

  -- 2) ล็อก (disable trigger = ล็อกตารางจนจบทรานแซกชัน — ไม่มีใครเขียน job_stage ได้) แล้วอ่านสถานะก่อนแก้
  alter table analytics.job_stage disable trigger trg_job_stage_guard;
  create temp table _j194_sb on commit drop as select * from analytics.job_stage;
  create temp table _j194_jb on commit drop as select * from analytics.job;
  select count(*)::text || '/' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '') into v_ev0 from analytics.job_event x;
  create temp table _j194_swapped (job_id uuid, buff_id uuid, gem_id uuid, buff_seq int, gem_seq int) on commit drop;

  -- 3) อ่านใบเข้าเงื่อนไขใหม่ (หลังล็อก) แล้วตรวจก่อนแตะ — ผิดเงื่อนไขข้อไหน raise ถอยทั้งก้อน
  for c in
    select j.id as job_id, j.job_no, b.id as buff_id, b.seq as buff_seq, g.id as gem_id, g.seq as gem_seq
      from analytics.job j
      join analytics.job_stage b on b.job_id = j.id and b.stage_code = 'buff'
      join analytics.job_stage g on g.job_id = j.id and g.stage_code = 'gem_set'
     where j.parent_job_id is null and j.status in ('open', 'in_progress', 'on_hold')
       and b.status = 'pending' and g.status = 'pending' and b.seq < g.seq
     order by j.job_no
  loop
    if c.buff_seq + 1 <> c.gem_seq then
      raise exception '0194: ใบ % ขัด(seq %) กับฝังพลอย(seq %) ไม่ติดกัน — สลับอัตโนมัติไม่ได้ ให้คนตัดสินใจ', c.job_no, c.buff_seq, c.gem_seq;
    end if;
    if exists (select 1 from analytics.job k where k.parent_job_id = c.job_id) then
      raise exception '0194: ใบ % มีส่วนย่อย — สลับ seq ใบแม่อย่างเดียวไม่ได้ (ส่วนย่อยคัดลอก seq ใบแม่) ให้คนตัดสินใจ', c.job_no;
    end if;
    if exists (select 1 from analytics.job_stage x where x.job_id = c.job_id and x.seq = 100) then
      raise exception '0194: ใบ % มีขั้น seq 100 อยู่แล้ว — ใช้เป็นค่ากลางตอนสลับไม่ได้', c.job_no;
    end if;
    -- 3 จังหวะ กัน unique (job_id, seq) ชนกลางทาง: buff -> 100 · gem_set -> seq เดิมของ buff · buff -> seq เดิมของ gem_set
    update analytics.job_stage set seq = 100 where id = c.buff_id and seq = c.buff_seq and status = 'pending';
    if not found then raise exception '0194: ใบ % สลับจังหวะ 1 ไม่สำเร็จ', c.job_no; end if;
    update analytics.job_stage set seq = c.buff_seq, updated_at = now() where id = c.gem_id and seq = c.gem_seq and status = 'pending';
    if not found then raise exception '0194: ใบ % สลับจังหวะ 2 ไม่สำเร็จ', c.job_no; end if;
    update analytics.job_stage set seq = c.gem_seq, updated_at = now() where id = c.buff_id and seq = 100 and status = 'pending';
    if not found then raise exception '0194: ใบ % สลับจังหวะ 3 ไม่สำเร็จ', c.job_no; end if;
    insert into _j194_swapped values (c.job_id, c.buff_id, c.gem_id, c.buff_seq, c.gem_seq);
    v_nsw := v_nsw + 1;
  end loop;

  alter table analytics.job_stage enable trigger trg_job_stage_guard;
  select t.tgenabled into v_en from pg_trigger t where t.tgrelid = 'analytics.job_stage'::regclass and t.tgname = 'trg_job_stage_guard';
  if v_en is distinct from 'O' then
    raise exception '0194: trg_job_stage_guard ไม่กลับมา enabled (tgenabled = %)', v_en;
  end if;

  -- 4) ด่านหลังสลับ: แตะเฉพาะ 2 แถวต่อใบที่สลับ
  select count(*) into v_n from analytics.job_stage;
  if v_n <> (select count(*) from _j194_sb) then
    raise exception '0194: จำนวนแถว job_stage เปลี่ยน (% -> %)', (select count(*) from _j194_sb), v_n;
  end if;
  -- ขั้นที่ไม่ใช่ 2 แถวที่ตั้งใจ = เหมือนเดิมทุกคอลัมน์ (รวม seq/updated_at)
  select count(*) into v_n
    from _j194_sb b join analytics.job_stage a on a.id = b.id
   where a.id not in (select buff_id from _j194_swapped union select gem_id from _j194_swapped)
     and to_jsonb(a) is distinct from to_jsonb(b);
  if v_n > 0 then
    raise exception '0194: ขั้นนอกเป้าหมาย % แถวถูกแก้ระหว่างสลับ', v_n;
  end if;
  -- 2 แถวที่สลับ = เปลี่ยนเฉพาะ seq + updated_at · seq สลับตำแหน่งกันจริง
  select count(*) into v_n
    from _j194_sb b join analytics.job_stage a on a.id = b.id
   where a.id in (select buff_id from _j194_swapped union select gem_id from _j194_swapped)
     and (to_jsonb(a) - 'seq' - 'updated_at') is distinct from (to_jsonb(b) - 'seq' - 'updated_at');
  if v_n > 0 then
    raise exception '0194: ขั้นที่สลับ % แถวมีคอลัมน์อื่นนอกจาก seq/updated_at เปลี่ยน', v_n;
  end if;
  select count(*) into v_n
    from _j194_swapped s
    join analytics.job_stage ab on ab.id = s.buff_id
    join analytics.job_stage ag on ag.id = s.gem_id
   where ab.seq = s.gem_seq and ag.seq = s.buff_seq and ab.stage_code = 'buff' and ag.stage_code = 'gem_set' and ab.status = 'pending' and ag.status = 'pending';
  if v_n <> v_nsw then
    raise exception '0194: สลับสำเร็จ % จาก % ใบเท่านั้น', v_n, v_nsw;
  end if;
  -- job: ใบที่ไม่เกี่ยว = เหมือนเดิมทั้งแถว · ใบที่สลับ = เปลี่ยนได้เฉพาะ current_stage_code/updated_at (trg_job_stage_sync คำนวณขั้นปัจจุบันใหม่)
  select count(*) into v_n from _j194_jb;
  if v_n <> (select count(*) from analytics.job) then
    raise exception '0194: จำนวนแถว job เปลี่ยน';
  end if;
  select string_agg(a.job_no, ', ') into v_bad
    from _j194_jb b join analytics.job a on a.id = b.id
   where case when a.id in (select job_id from _j194_swapped)
              then (to_jsonb(a) - 'current_stage_code' - 'updated_at') is distinct from (to_jsonb(b) - 'current_stage_code' - 'updated_at')
              else to_jsonb(a) is distinct from to_jsonb(b) end;
  if v_bad is not null then
    raise exception '0194: ใบงานขยับนอกเงื่อนไข: %', v_bad;
  end if;
  select count(*)::text || '/' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '') into v_ev1 from analytics.job_event x;
  if v_ev1 is distinct from v_ev0 then
    raise exception '0194: job_event ขยับระหว่างสลับ (ต้องไม่เขียน event)';
  end if;
  raise notice '0194: สลับ ขัด/ฝังพลอย ให้ % ใบ (ด่านหลังสลับผ่าน)', v_nsw;
end;
$swap194$;
-- <<< PART B END

-- ============================================================================
-- 5. ด่านหลังทำ (ส่วน A — ไม่แตะใบงาน) — ผิดข้อไหน raise ถอยทั้งก้อน
-- ============================================================================
do $chk194$
declare
  v_shop   record;
  v_order  constant text[] := array['cad', 'print3d', 'mold', 'wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'polish', 'finish', 'gem_set', 'buff', 'plating', 'qc', 'pack'];
  v_n      int;
  v_src    text;
  v_en     "char";
begin
  for v_shop in select distinct shop_id from analytics.job_stage_def loop
    -- ลำดับสัมพัทธ์ของชุดมาตรฐานต้องเรียงเพิ่มเข้มงวด (polish ปิดแล้วยังอยู่ระหว่าง cut_sprue กับ finish)
    select count(*) into v_n
      from (select d.code, d.seq_default, array_position(v_order, d.code) as pos from analytics.job_stage_def d where d.shop_id = v_shop.shop_id and d.code = any (v_order)) a
      join (select d.code, d.seq_default, array_position(v_order, d.code) as pos from analytics.job_stage_def d where d.shop_id = v_shop.shop_id and d.code = any (v_order)) b
        on a.pos < b.pos and a.seq_default >= b.seq_default;
    if v_n > 0 then
      raise exception '0194: ร้าน % ลำดับ seq_default ของขั้นมาตรฐานไม่เรียงตามลำดับงานใหม่ (% คู่ผิด)', v_shop.shop_id, v_n;
    end if;
    if (select count(*) from analytics.job_stage_def d where d.shop_id = v_shop.shop_id and d.code = 'buff' and d.seq_default = 105 and d.is_active
           and d.cost_block = 'per_piece' and d.batch_kind is null and not d.weigh_default and d.metal_present) <> 1 then
      raise exception '0194: ร้าน % buff ต้องอยู่ 105 · เปิดใช้งาน · per_piece · ไม่ชั่งค่าเริ่ม · มีโลหะ', v_shop.shop_id;
    end if;
  end loop;

  -- ทะเบียนแถวอื่นไม่ขยับ: ทุกแถวยกเว้น buff เท่าเดิมเป๊ะ · buff เปลี่ยนเฉพาะ seq_default/weigh_default
  select count(*) into v_n
    from _j194_def_base b join analytics.job_stage_def a on a.shop_id = b.shop_id and a.code = b.code
   where case when a.code = 'buff' then (to_jsonb(a) - 'seq_default' - 'weigh_default') is distinct from (to_jsonb(b) - 'seq_default' - 'weigh_default')
              else to_jsonb(a) is distinct from to_jsonb(b) end;
  if v_n > 0 or (select count(*) from analytics.job_stage_def) <> (select count(*) from _j194_def_base) then
    raise exception '0194: ทะเบียนขั้นขยับนอกเงื่อนไข (% แถว) หรือจำนวนแถวเปลี่ยน', v_n;
  end if;

  -- ไม่มี overload · guard ใหม่มีด่านส่วนย่อยจริง · ensure ใหม่ลำดับถูก
  if (select count(*) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('job_stage_guard', 'job_stage_def_ensure')) <> 2 then
    raise exception '0194: job_stage_guard/job_stage_def_ensure ต้องมีอย่างละ 1 signature (overload หลุด?)';
  end if;
  select p.prosrc into v_src from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_stage_guard';
  if position('ขั้นของส่วนย่อยต้องเป็นสำเนา (รหัส, ลำดับ) ของใบแม่' in v_src) = 0 then
    raise exception '0194: job_stage_guard ไม่ใช่ฉบับใหม่ (ไม่พบด่านสำเนาของส่วนย่อย)';
  end if;
  select p.prosrc into v_src from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_stage_def_ensure';
  if v_src !~ '''buff'',\s*''ขัด'',\s*105,\s*''per_piece'',\s*null,\s*false,\s*true'
     or v_src !~ '''gem_set'',\s*''ฝังพลอย'',\s*100,' then
    raise exception '0194: job_stage_def_ensure ไม่ใช่ฉบับใหม่';
  end if;

  -- สิทธิ์ 2 ตัวที่แก้ = เท่าเดิมเป๊ะ · ฟังก์ชันอื่นทั้งสคีมา (นิยาม + สิทธิ์) เท่าเดิม · จำนวนฟังก์ชันเท่าเดิม
  if exists (select 1 from _j194_acl_base b join pg_proc p on p.oid::regprocedure::text = b.sig where coalesce(p.proacl::text, 'NULL') <> b.acl) then
    raise exception '0194: proacl ของ job_stage_guard/job_stage_def_ensure เปลี่ยนไปจากก่อนรัน';
  end if;
  select count(*) into v_n
    from _j194_fn_base b join pg_proc p on p.pronamespace = 'analytics'::regnamespace and p.oid::regprocedure::text = b.sig
   where md5(pg_get_functiondef(p.oid)) = b.h and coalesce(p.proacl::text, 'NULL') = b.acl;
  if v_n <> (select count(*) from _j194_fn_base)
     or (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and prokind in ('f', 'p')) <> (select count(*) from _j194_fn_base) + 2 then
    raise exception '0194: ฟังก์ชันอื่นในสคีมา analytics ขยับ (ตรง % จาก %) หรือจำนวนฟังก์ชันเปลี่ยน', v_n, (select count(*) from _j194_fn_base);
  end if;

  -- guard trigger ต้อง enabled (ส่วนสลับปิดชั่วคราวแล้วเปิดกลับ)
  select t.tgenabled into v_en from pg_trigger t where t.tgrelid = 'analytics.job_stage'::regclass and t.tgname = 'trg_job_stage_guard';
  if v_en is distinct from 'O' then
    raise exception '0194: trg_job_stage_guard ไม่ enabled (tgenabled = %)', v_en;
  end if;
  raise notice '0194: ทะเบียน/ฟังก์ชัน/สิทธิ์/trigger ผ่านด่านหลังทำครบ';
end;
$chk194$;

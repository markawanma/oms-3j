-- 0184_split_polish_stage.sql — แยกขั้น "แต่ง ขัด" (polish) เป็น 2 ขั้น "แต่ง" (finish) -> "ขัด" (buff) · หน้างานขอ 20 ต.ค. 69 (ใช้จริง 21 ต.ค.)
-- สถานะ: ยังไม่ apply · apply ด้วย node scripts/run-sql.mjs --commit --record เท่านั้น (ห้าม supabase db push) · ชุดทดสอบ scripts/verify/verify-0184.sql
--
-- ทำไม: ช่างทำ "แต่ง" กับ "ขัด" เป็นคนละจังหวะ/คนละคน — ขั้นเดียวบันทึกน้ำหนักเข้า-ออกคร่อมสองงานไม่ได้ ใบใหม่ต้องแยกให้รับ/ส่งต่อทีละขั้น
--       ลำดับใหม่: ตัดต้น -> แต่ง -> ขัด -> ฝังพลอย
--
-- โมเดล (ตัดสินแล้ว — เหตุผล):
--  1. ไม่ rename `polish` — ใบเก่า/ประวัติ/event ที่อ้าง polish ต้องยังเป็น "แต่ง ขัด" ตามที่เกิดจริง (job_stage.stage_code เปลี่ยนไม่ได้อยู่แล้ว · FK ผูก (shop_id, code))
--     ⇒ ตั้ง polish.is_active = false (ทะเบียนเดิมรองรับ "ปิดขั้นที่ไม่ใช้โดยไม่ลบ")
--     - ใบใหม่เลือก polish ไม่ได้: job_validate_stage_codes ปฏิเสธ (stages_unknown) ตั้งแต่ 0172 อยู่แล้ว + job_stage_guard ปฏิเสธ INSERT ขั้นปิดใช้งานของใบแม่ ⇒ ไม่ต้องเพิ่มด่าน
--     - job_sort_stage_codes กรอง is_active ⇒ ชุดแนะนำไม่มี polish แม้ฟังก์ชันใดเผลอใส่มา
--     - ใบที่เปิดอยู่ (open 2 ใบ pending · in_progress 1 ใบ) ไม่แตะ — เดินผ่านขั้น polish เดิมจนจบ (รับ/ส่ง/ย้อน/แยกส่วนย่อยทำงานเหมือนเดิม: ด่าน is_active มีเฉพาะตอน INSERT ขั้นของใบแม่)
--  2. code ใหม่ finish = "แต่ง" · buff = "ขัด" — per_piece · weigh_default true · metal_present true · batch_kind null (เหมือน polish เป๊ะ) ⇒ กฎทอง "ชั่งทุกขั้นที่โลหะอยู่ในมือ" ครอบเองผ่าน metal_present
--     (job_profile_state.gold_unguarded · แบบทอง = weigh <- metal_present) ไม่ต้องแก้ฟังก์ชันกฎทอง
--  3. seq_default ช่วงห่าง x10 (cad 10 ... cut_sprue 80 · polish 90 · finish 91 · buff 92 · gem_set 100 · plating 110 · qc 120 · pack 130) — ให้แทรกขั้นใหม่ทีหลังได้โดยไม่ต้องเลื่อนทั้งทะเบียนอีก
--     - สัมพัทธ์เท่าเดิมทุกคู่ ⇒ trigger job_stage_guard (เทียบ seq_default ของใบกับทะเบียน) + job_validate_stage_codes (ลำดับ) + ใบเก่าทุกใบยังถูกต้อง
--     - unique (shop_id, seq_default) ⇒ UPDATE 2 จังหวะ (+500 ก่อน แล้วตั้งค่าจริง) เพื่อไม่ให้ชนกลางทาง · check 1..1000 ผ่านทั้งสองจังหวะ (513 / 130)
--     - ไม่มี trigger บน job_stage_def (ตรวจ pg_trigger แล้ว) ⇒ UPDATE ไม่ทิ้งรอยอะไรนอกจากค่าที่ตั้งใจเปลี่ยน · ไม่มีที่ไหนเก็บค่า seq_default ซ้ำ (ทุก view/ฟังก์ชันอ่านสดจากทะเบียน · ไม่มีเลขตายตัว/between)
--  4. job_stage_def_ensure (SQL เดิม) เขียนชุดใหม่: ร้านใหม่ได้ 14 แถว (finish/buff ไม่มี polish) seq ชุดเดียวกับร้านเดิม · ร้านเดิมที่เรียก ensure ซ้ำไม่ได้แถวเพิ่ม (on conflict do nothing)
--  5. job_source_info — ชุดขั้นค่าเริ่มของใบ OEM/ใบผลิต: แทน 'polish' ด้วย 'finish', 'buff' · ลอก definition สดจาก DB (pg_get_functiondef 20 ต.ค. 69 ก่อนเขียนไฟล์) ไม่ลอกจาก 0181 — แก้เฉพาะ 2 บรรทัด v_codes
--     (งาน PM-A "ใบผลิตเลือกโลหะ" ที่จะ replace job_source_info ต่อ ต้องลอก definition จากฟังก์ชันหลังไฟล์นี้ — ดู design-production-item-metal.md)
--  6. worker ทุกคนที่มี polish ใน stage_codes -> เพิ่ม finish, buff (คง polish ไว้ — ใบเก่าที่ค้างขั้น polish ช่างยังรับ/ส่งได้ · job_worker_resolve/job_core_receive เช็ค stage_codes)
--     - ช่างที่ stage_codes ว่าง (= ทุกขั้น) ไม่แตะ · UPDATE แคบ: เฉพาะแถวที่มี polish และยังไม่มี finish+buff ครบ ⇒ รันซ้ำไม่แตะแถวเดิม (worker_guard ตั้ง updated_at เฉพาะแถวที่เปลี่ยนจริง — ข้อ 19)
--     - ไม่เขียน worker_audit: คอลัมน์ actor not null (ต้องเป็น uuid ผู้ทำรายการ) ไม่มีผู้ใช้จริงในงานระบบ ⇒ ประวัติของการเปลี่ยนนี้คือไฟล์นี้ + version ใน schema_migrations
--  7. แบบการบันทึก (job_record_profile_stage) ทุกแบบที่มีแถว polish -> คัดลอก flag (weigh/scrap_qty/scrap_weight) ไปให้ finish และ buff (insert อย่างเดียว · ไม่ UPDATE job_record_profile ⇒ updated_at ของแบบไม่ขยับ)
--     - คง polish ไว้ในแบบ: ใบเก่าที่เปลี่ยนแบบ (job_profile_set -> job_profile_apply อ่านแถวตามขั้นของใบ) ยังได้ flag ของขั้น polish เดิม · หน้าตั้งค่าแบบ (visibleStageDefs) โชว์แถวขั้นปิดใช้งานเฉพาะที่ยังมี flag อยู่แล้ว — พฤติกรรมเดิมของ UI
--     - แบบ "ชั่งเฉพาะหล่อ" (มีแต่ cast) ไม่มีแถว polish ⇒ finish/buff ก็ไม่มี flag = ความหมายเดียวกับ polish เดิม
--  8. ใบที่เปิดอยู่ ไม่แตะ — ปิดท้ายไฟล์เทียบ md5 job/job_stage/job_event ก่อน-หลัง ถ้าขยับ = raise ถอยทั้งก้อน
--
-- ตัดสินใจเอง (นอกเหนือบรีฟ): ดูท้ายไฟล์ "หนี้/ข้อจำกัด"
-- สิทธิ์: ฟังก์ชันทั้งสองตัวเป็นตัวช่วยภายใน (proacl = {postgres=X/postgres} ตั้งแต่ก่อนไฟล์นี้) — revoke 3 ชื่อซ้ำ + ไม่ grant ให้ใคร = เท่าเดิมเป๊ะ (ข้อ 2/18 ของ 3j-migration-traps · verify เทียบ proacl ก่อน-หลัง)
-- overload: ไม่เปลี่ยน arg list ทั้งสองตัว (ข้อ 1) · post-check ท้ายไฟล์นับ signature = 1

-- เก็บ md5 ของตารางใบงานก่อนแตะอะไร (เทียบท้ายไฟล์ — ใบเปิดอยู่ต้องไม่ขยับ)
create temp table _j184_base on commit drop as
  select 'job'::text as t, count(*) as n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from analytics.job x
  union all select 'job_stage', count(*), coalesce(md5(string_agg(x::text, '|' order by x::text)), '') from analytics.job_stage x
  union all select 'job_event', count(*), coalesce(md5(string_agg(x::text, '|' order by x::text)), '') from analytics.job_event x;
create temp table _j184_acl_base on commit drop as
  select p.oid::regprocedure::text as sig, coalesce(p.proacl::text, 'NULL') as acl
    from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('job_source_info', 'job_stage_def_ensure');

-- ============================================================================
-- 1. job_stage_def_ensure — ชุดใหม่ (ร้านใหม่: 14 แถว ไม่มี polish · seq x10)
--    ลอกตัวฟังก์ชันจากฉบับสดบน DB (= 0172) แก้เฉพาะรายการ values
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
    ('buff',           'ขัด',                      92,  'per_piece', null,           true,  true),
    ('gem_set',        'ฝังพลอย',                  100, 'per_piece', null,           false, true),
    ('plating',        'ชุบ',                      110, 'batch',     'plating_tank', false, true),
    ('qc',             'ตรวจ QC',                  120, 'per_piece', null,           false, true),
    ('pack',           'แพ็ก',                     130, 'per_piece', null,           false, true)
  ) as v(code, name_th, seq, cost_block, batch_kind, weigh_default, metal_present)
  on conflict (shop_id, code) do nothing
$f$;
revoke execute on function analytics.job_stage_def_ensure(uuid) from public, anon, authenticated;

-- ============================================================================
-- 2. เลื่อน seq_default ของร้านที่ยังเป็นผังเดิม (polish = 9 และยังไม่มี finish) เป็น x10 — 2 จังหวะ ไม่ชน unique
--    guard ตามผังเดิมของแต่ละร้าน ⇒ รันซ้ำไม่เลื่อนซ้ำ (หลังรอบแรก polish = 90 ไม่ตรงเงื่อนไขอีก)
-- ============================================================================
do $renum$
declare
  v_shops uuid[];
begin
  select coalesce(array_agg(d.shop_id), '{}') into v_shops
    from analytics.job_stage_def d
   where d.code = 'polish' and d.seq_default = 9
     and not exists (select 1 from analytics.job_stage_def f where f.shop_id = d.shop_id and f.code in ('finish', 'buff'));
  if cardinality(v_shops) = 0 then
    return;
  end if;
  -- จังหวะ 1: +500 (ช่วง 501..513 ไม่ชนค่าเดิม 1..13 · ไม่เกิน check 1000)
  update analytics.job_stage_def set seq_default = seq_default + 500
   where shop_id = any (v_shops) and seq_default between 1 and 13;
  -- จังหวะ 2: ค่าจริง = (เลขเดิม) x 10 ⇒ 10..130 (ค่าจริงไม่ชนแถวที่ยังรอ +500 เพราะทุกแถวของร้านถูกยกไปพร้อมกันแล้ว)
  update analytics.job_stage_def set seq_default = (seq_default - 500) * 10
   where shop_id = any (v_shops) and seq_default between 501 and 513;
  if exists (select 1 from analytics.job_stage_def d where d.shop_id = any (v_shops) and d.seq_default > 500) then
    raise exception '0184: เลื่อน seq_default ไม่ครบ — มีแถวค้างช่วง 501+ (ผังขั้นมีรหัสนอกชุดมาตรฐาน 13 ขั้น?)';
  end if;
end;
$renum$;

-- ============================================================================
-- 3. เติม finish/buff ให้ทุกร้าน (ensure ตัวใหม่ — แหล่งความจริงเดียวของชุดขั้น) · 4. ปิด polish
-- ============================================================================
select analytics.job_stage_def_ensure(s.id) from public.shop s;

update analytics.job_stage_def set is_active = false where code = 'polish' and is_active;

-- ============================================================================
-- 5. worker ที่มี polish -> + finish, buff (เรียง/ไม่ซ้ำแบบเดียวกับ worker_codes_clean)
-- ============================================================================
update analytics.worker w
   set stage_codes = (select coalesce(array_agg(distinct c order by c), '{}') from unnest(w.stage_codes || array['finish', 'buff']) c)
 where 'polish' = any (w.stage_codes) and not (w.stage_codes @> array['finish', 'buff']);

-- ============================================================================
-- 6. แบบการบันทึก: คัดลอก flag ของ polish ไป finish + buff (insert อย่างเดียว · แถวที่มีอยู่แล้วไม่ทับ)
-- ============================================================================
insert into analytics.job_record_profile_stage (profile_id, shop_id, stage_code, weigh, scrap_qty, scrap_weight)
select ps.profile_id, ps.shop_id, n.code, ps.weigh, ps.scrap_qty, ps.scrap_weight
  from analytics.job_record_profile_stage ps
 cross join (values ('finish'), ('buff')) as n(code)
 where ps.stage_code = 'polish'
on conflict (profile_id, stage_code) do nothing;

-- ============================================================================
-- 7. job_source_info — ชุดขั้นค่าเริ่ม: finish, buff แทน polish (ลอกสดจาก DB · แก้ 2 บรรทัด v_codes)
-- ============================================================================
CREATE OR REPLACE FUNCTION analytics.job_source_info(p_shop_id uuid, p_source_kind text, p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
declare
  v_metal     text;
  v_new       boolean;
  v_gem       int;
  v_plating   text;
  v_i         record;
  v_p         record;
  v_paid      numeric;
  v_existing  record;
  v_label     text;
  v_codes     text[];
  v_pmetal    text;
  v_tw        numeric;
  v_tw_src    text;
begin
  -- 0181: existing_job นับเฉพาะใบแม่ (parent_job_id is null) — ส่วนย่อยไม่ใช่ "ใบงานซ้ำ"
  if p_source_kind = 'oem' then
    select i.id, i.shop_id, i.seq, i.qty, i.input, i.product_id, i.sku_snapshot, i.product_name_snapshot,
           q.id as quote_id, q.status as quote_status, coalesce(q.root_quote_id, q.id) as root_id
      into v_i
      from analytics.oem_quote_item i
      join analytics.oem_quote q on q.id = i.quote_id
     where i.id = p_item_id and i.shop_id = p_shop_id;
    if not found then
      raise exception 'ไม่พบรายการในใบเสนอราคา' using errcode = '22023', hint = 'item_not_found';
    end if;
    if v_i.quote_status <> 'won' then
      raise exception 'สร้างใบงานได้เฉพาะใบเสนอราคาที่ได้งานแล้ว (won) — ใบนี้สถานะ %', v_i.quote_status
        using errcode = '22023', hint = 'quote_not_won';
    end if;
    v_metal := v_i.input ->> 'metal';
    if v_metal = 'product' then
      raise exception 'รายการสินค้า/บริการไม่ใช่งานผลิต สร้างใบงานไม่ได้' using errcode = '22023', hint = 'metal_unsupported';
    elsif v_metal = 'silver999' then
      raise exception 'เงินแท่งไม่มีขั้นตอนผลิตในโรงงาน สร้างใบงานไม่ได้' using errcode = '22023', hint = 'metal_unsupported';
    elsif v_metal is null or v_metal not in ('silver', 'gold', 'brass') then
      raise exception 'รายการนี้ไม่ระบุโลหะที่ใบงานรองรับ (เงิน/ทอง/ทองเหลือง)' using errcode = '22023', hint = 'metal_unsupported';
    end if;
    v_new := coalesce((v_i.input ->> 'is_new_design') = 'true', false);
    v_gem := case when (v_i.input ->> 'gem_count') ~ '^[0-9]+$' then (v_i.input ->> 'gem_count')::int else 0 end;
    v_plating := nullif(btrim(coalesce(v_i.input ->> 'plating_type', '')), '');
    select coalesce(v.paid_thb, 0) into v_paid from analytics.v_oem_quote v where v.id = v_i.quote_id;
    select j.id, j.job_no into v_existing from analytics.job j
     where j.status <> 'cancelled' and (j.oem_quote_item_id = v_i.id or (j.root_quote_id = v_i.root_id and j.oem_item_seq = v_i.seq)) and j.parent_job_id is null limit 1;
    v_label := coalesce(nullif(btrim(v_i.product_name_snapshot), ''), nullif(btrim(v_i.sku_snapshot), ''),
                        coalesce(nullif(v_i.input ->> 'item_kind', ''), 'งาน OEM') || ' #' || v_i.seq);
    v_tw := case when (v_i.input ->> 'weight_g') ~ '^[0-9]{1,6}(\.[0-9]+)?$' then round((v_i.input ->> 'weight_g')::numeric, 3) end;
    if v_tw is not null and not (v_tw > 0 and v_tw <= 10000) then v_tw := null; end if;
    v_tw_src := case when v_tw is null then null else 'quote' end;
    v_codes := array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'finish', 'buff', 'qc', 'pack'];
    if v_new then v_codes := array['cad', 'print3d', 'mold'] || v_codes; end if;
    if v_gem > 0 then v_codes := v_codes || 'gem_set'::text; end if;
    if v_plating is not null and v_plating not in ('none', 'null') then v_codes := v_codes || 'plating'::text; end if;
    return jsonb_build_object('source_kind', 'oem', 'item_id', v_i.id, 'quote_id', v_i.quote_id, 'root_quote_id', v_i.root_id,
      'item_seq', v_i.seq, 'metal', v_metal, 'qty', v_i.qty, 'is_new_design', v_new, 'design_label', left(v_label, 200),
      'sku', left(v_i.sku_snapshot, 100), 'product_id', v_i.product_id, 'deposit_missing', coalesce(v_paid, 0) <= 0,
      'existing_job', case when v_existing.id is null then null else jsonb_build_object('id', v_existing.id, 'job_no', v_existing.job_no) end,
      'suggested_stage_codes', to_jsonb(analytics.job_sort_stage_codes(p_shop_id, v_codes)),
      'target_piece_g', v_tw, 'target_piece_g_source', v_tw_src);
  elsif p_source_kind = 'production' then
    select poi.id, poi.shop_id, poi.qty_planned, poi.is_new_design, poi.product_id,
           po.status as po_status, p.sku, p.name, p.cost_type, p.make_spec, p.silver_weight_g
      into v_p
      from analytics.production_order_item poi
      join analytics.production_order po on po.id = poi.production_order_id
      join public.product p on p.id = poi.product_id
     where poi.id = p_item_id and poi.shop_id = p_shop_id;
    if not found then
      raise exception 'ไม่พบรายการในใบผลิต' using errcode = '22023', hint = 'item_not_found';
    end if;
    if v_p.po_status <> 'open' then
      raise exception 'สร้างใบงานได้เฉพาะใบผลิตที่ยังเปิดอยู่ (open) — ใบนี้สถานะ %', v_p.po_status using errcode = '22023', hint = 'po_not_open';
    end if;
    v_pmetal := v_p.make_spec ->> 'metal';
    v_metal := case
      when v_pmetal in ('silver', 'gold', 'brass') then v_pmetal
      when v_pmetal is null and v_p.cost_type in ('fixed', 'spot') then 'silver'
      else null end;
    if v_metal is null then
      raise exception 'ระบุโลหะของสินค้านี้ไม่ได้ (ใบงานรองรับเงิน/ทอง/ทองเหลือง) — ตรวจสเปกการผลิตของสินค้าก่อน' using errcode = '22023', hint = 'metal_unsupported';
    end if;
    select j.id, j.job_no into v_existing from analytics.job j where j.status <> 'cancelled' and j.production_order_item_id = v_p.id and j.parent_job_id is null limit 1;
    v_tw := case when v_metal = 'silver' and v_p.silver_weight_g > 0 and v_p.silver_weight_g <= 10000 then round(v_p.silver_weight_g, 3) end;
    v_tw_src := case when v_tw is null then null else 'product' end;
    v_codes := array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'finish', 'buff', 'qc', 'pack'];
    if coalesce(v_p.is_new_design, false) then v_codes := array['cad', 'print3d', 'mold'] || v_codes; end if;
    return jsonb_build_object('source_kind', 'production', 'item_id', v_p.id, 'metal', v_metal, 'qty', v_p.qty_planned,
      'is_new_design', coalesce(v_p.is_new_design, false), 'design_label', left(coalesce(nullif(btrim(v_p.name), ''), v_p.sku), 200),
      'sku', left(v_p.sku, 100), 'product_id', v_p.product_id, 'deposit_missing', false,
      'existing_job', case when v_existing.id is null then null else jsonb_build_object('id', v_existing.id, 'job_no', v_existing.job_no) end,
      'suggested_stage_codes', to_jsonb(analytics.job_sort_stage_codes(p_shop_id, v_codes)),
      'target_piece_g', v_tw, 'target_piece_g_source', v_tw_src);
  end if;
  raise exception 'source_kind ต้องเป็น oem หรือ production' using errcode = '22023', hint = 'source_invalid';
end;
$function$
;
revoke execute on function analytics.job_source_info(uuid, text, uuid) from public, anon, authenticated;

-- ============================================================================
-- 8. ด่านหลังทำ — ผิดข้อไหน raise ถอยทั้งก้อน (ไม่พึ่ง verify อย่างเดียว)
-- ============================================================================
do $chk$
declare
  v_shop   record;
  v_order  constant text[] := array['cad', 'print3d', 'mold', 'wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'polish', 'finish', 'buff', 'gem_set', 'plating', 'qc', 'pack'];
  v_n      int;
  v_bad    text;
  v_src    text;
begin
  for v_shop in select distinct shop_id from analytics.job_stage_def loop
    -- ลำดับสัมพัทธ์ของชุดมาตรฐานต้องเรียงเพิ่มเข้มงวด (polish ที่ถูกปิดยังอยู่ระหว่าง cut_sprue กับ finish)
    select count(*) into v_n
      from (select d.code, d.seq_default, array_position(v_order, d.code) as pos from analytics.job_stage_def d where d.shop_id = v_shop.shop_id and d.code = any (v_order)) a
      join (select d.code, d.seq_default, array_position(v_order, d.code) as pos from analytics.job_stage_def d where d.shop_id = v_shop.shop_id and d.code = any (v_order)) b
        on a.pos < b.pos and a.seq_default >= b.seq_default;
    if v_n > 0 then
      raise exception '0184: ร้าน % ลำดับ seq_default ของขั้นมาตรฐานไม่เรียงตามลำดับงาน (% คู่ผิด)', v_shop.shop_id, v_n;
    end if;
    if (select count(*) from analytics.job_stage_def d where d.shop_id = v_shop.shop_id and d.code in ('finish', 'buff') and d.is_active
           and d.cost_block = 'per_piece' and d.batch_kind is null and d.weigh_default and d.metal_present) <> 2 then
      raise exception '0184: ร้าน % ต้องมี finish และ buff ที่เปิดใช้งาน (per_piece · ชั่ง · มีโลหะ)', v_shop.shop_id;
    end if;
    if exists (select 1 from analytics.job_stage_def d where d.shop_id = v_shop.shop_id and d.code = 'polish' and d.is_active) then
      raise exception '0184: ร้าน % polish ต้องปิดใช้งาน', v_shop.shop_id;
    end if;
  end loop;

  select string_agg(w.display_name, ', ') into v_bad from analytics.worker w
   where 'polish' = any (w.stage_codes) and not (w.stage_codes @> array['finish', 'buff']);
  if v_bad is not null then
    raise exception '0184: ช่างที่มี polish แต่ไม่ได้ finish/buff: %', v_bad;
  end if;

  select count(*) into v_n
    from analytics.job_record_profile_stage ps
   where ps.stage_code = 'polish'
     and (select count(*) from analytics.job_record_profile_stage x
           where x.profile_id = ps.profile_id and x.stage_code in ('finish', 'buff')
             and (x.weigh, x.scrap_qty, x.scrap_weight) = (ps.weigh, ps.scrap_qty, ps.scrap_weight)) <> 2;
  if v_n > 0 then
    raise exception '0184: แบบการบันทึก % แบบที่มี polish แต่ finish/buff ไม่ได้ flag เดียวกัน', v_n;
  end if;

  -- ไม่มี overload (ข้อ 1) · ชุดขั้นค่าเริ่มของ job_source_info เปลี่ยนแล้วจริง
  if (select count(*) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('job_source_info', 'job_stage_def_ensure')) <> 2 then
    raise exception '0184: job_source_info/job_stage_def_ensure ต้องมีอย่างละ 1 signature (overload หลุด?)';
  end if;
  select p.prosrc into v_src from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_source_info';
  if v_src like '%''polish''%' or (length(v_src) - length(replace(v_src, '''cut_sprue'', ''finish'', ''buff'', ''qc'', ''pack''', ''))) / length('''cut_sprue'', ''finish'', ''buff'', ''qc'', ''pack''') <> 2 then
    raise exception '0184: job_source_info ยังมี polish หรือชุด finish/buff ไม่ครบทั้ง 2 ทาง (oem/production)';
  end if;

  -- สิทธิ์เท่าเดิมเป๊ะ (ไม่มีใครได้ EXECUTE เพิ่ม)
  if exists (select 1 from _j184_acl_base b join pg_proc p on p.oid::regprocedure::text = b.sig
              where coalesce(p.proacl::text, 'NULL') <> b.acl) then
    raise exception '0184: proacl ของ job_source_info/job_stage_def_ensure เปลี่ยนไปจากก่อนรัน';
  end if;

  -- ใบงานทุกใบไม่ขยับ (job · job_stage · job_event)
  select string_agg(b.t, ', ') into v_bad
    from _j184_base b
    join (select 'job'::text as t, count(*) as n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from analytics.job x
          union all select 'job_stage', count(*), coalesce(md5(string_agg(x::text, '|' order by x::text)), '') from analytics.job_stage x
          union all select 'job_event', count(*), coalesce(md5(string_agg(x::text, '|' order by x::text)), '') from analytics.job_event x) a
      on a.t = b.t and (a.n, a.h) is distinct from (b.n, b.h);
  if v_bad is not null then
    raise exception '0184: ตารางใบงานขยับระหว่าง migration: % (ต้องไม่แตะใบที่เปิดอยู่)', v_bad;
  end if;
  raise notice '0184: ผังขั้น/ช่าง/แบบการบันทึก/ฟังก์ชัน/ใบงานผ่านด่านหลังทำครบ';
end;
$chk$;

-- ============================================================================
-- หนี้ / ข้อจำกัด / ตัดสินใจเอง (บอกตรงๆ)
--  · polish ยังอยู่ในทะเบียน (ปิดใช้งาน) และใน stage_codes ของช่างเดิม: ถอดออกได้ทีหลังเมื่อไม่มีใบเปิดที่ค้างขั้น polish (ตอนนี้ pending 2 ใบ · in_progress 1 ใบ) — หน้า /jobs/workers โชว์รหัส "polish" ตรงๆ ใต้ชื่อช่างที่ยังถือรหัสนี้
--    (รายการติ๊กใน dialog แสดงเฉพาะขั้นเปิดใช้งาน จึงติ๊ก polish ใหม่ไม่ได้ — ช่างที่มีอยู่แล้วยังถือค่าเดิมต่อไปเวลากดบันทึก)
--  · เส้นอัตราของเสีย reject_rate_polish_pct / polish_loss_pct / polish_pieces_per_day (ตารางเรตต้นทุน OEM) ยังเป็นเรตเดียวของ "แต่ง+ขัด" รวม — ไม่แยก (ราคาเสนอ/แผนเนื้อโลหะอ่านเรตตามคีย์ ไม่ผูกกับรหัสขั้นใบงาน)
--  · ชุดทดสอบเก่า (verify-0172..0183) สร้างใบด้วย polish ตรงๆ — หลัง 0184 apply จะถูกปฏิเสธ (stages_unknown) ถ้ารันซ้ำ: ต้องแก้ std() เป็น finish+buff (ลำดับขั้นเลื่อน +1) ก่อนรันใหม่
--  · job_record_profile_upsert ยังรับขั้นที่ปิดใช้งานได้ (polish) — ไม่กระทบ (ใบใหม่ไม่ใช้) ไม่เพิ่มด่าน เพราะ UI เดิมต้องบันทึกแบบที่ยังมี flag ของขั้นปิดอยู่ได้
-- ============================================================================

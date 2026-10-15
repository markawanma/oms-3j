-- 0177_job_plan_rate_unit_fix.sql — แก้บั๊ก High ใน 0175: หน่วย % ของอัตราเสีย/ก้านต้น หารด้วย 100 ซ้ำ (+ หนี้ S5 / N11 / สูตรแผนโลหะที่เดียว)
-- ต่อจาก 0175 + 0176 (apply บน production แล้ว แก้ไฟล์เดิมไม่ได้ · def ต้นทางของ 3 ฟังก์ชันที่ replace ลอกจากฉบับ 0175 ที่ apply จริง — 0176 ไม่ได้แตะ)
-- ⚠️ ยังไม่ APPLY — dry-run เท่านั้น (apply หลัง Tech Lead ตรวจ)
-- 🔴 apply ด้วย node scripts/run-sql.mjs --commit --record เท่านั้น (ไฟล์พึ่งทรานแซกชันที่ runner ครอบทั้งไฟล์ · ถ้าต้องแก้ใบเดิมจะ disable/enable trigger ในทรานแซกชันเดียว) · ห้าม supabase db push · ไฟล์ต้องเป็น LF
--
-- บั๊ก (QA เจอ): oem_cost_rate เก็บ pct เป็น "สัดส่วน 0..1" (oem_rate_upsert ปฏิเสธ >= 1 ที่ 0061:485 · /oem/rates คูณ 100 ตอนแสดง · oem_cost_calc ใช้ตรง 1 - r_cast ที่ 0140:212)
--   ค่าจริง: cast 0.03 · polish 0.02 · plate 0.02 · sprue เงิน 0.05 (= 3%/2%/2%/5%) แต่ 0175 ถือว่าเป็น % แล้วหาร 100 อีกรอบ
--   (job_plan_compute: 1 + sprue/100 · job_plan_suggest: v_rc/100 + guard < 100) ⇒ สั่ง 30 แนะนำ 31 (ถูก 32) · แผน 320.284 g (ถูก 336.130 g) · UI ขึ้น "หล่อเสีย 0.03%"
--
-- วิธีแก้ (มติ Tech Lead: แก้ที่จุดอ่าน rate — เล็กสุด): อ่านผ่าน analytics.job_rate_pct() = oem_rate_value × 100 ที่เดียว ⇒ ตัวแปร/basis/payload เป็นหน่วย % จริง (5 = 5%)
--   สูตรที่หาร 100 อยู่แล้ว (job_plan_formula · job_plan_basis_assert · suggest · guard < 100) คงเดิม ⇒ ถูกต้องอัตโนมัติ · UI ที่แสดง *_pct เป็น % ถูกเอง
--   ห้ามแตะ oem_cost_rate / oem_cost_calc / ฝั่ง OEM (ตัวนั้นถูกอยู่แล้ว) · ฟังก์ชันของงานใบงานเรียก oem_rate_value ตรงๆ ไม่ได้อีก (verify-0177 ตรวจที่ catalog)
--
-- 1 helper ใหม่ (ภายใน ไม่ grant): job_rate_pct
-- 2 replace (def ต้นทาง 0175): job_plan_compute (อ่าน rate ผ่าน job_rate_pct · เรียก job_plan_formula แทนสูตรซ้ำ · N11) · job_plan_suggest (อ่าน rate ผ่าน job_rate_pct) · job_plan_set (S5)
-- 3 ใบเดิมที่มีแผนผิดหน่วย (status <> cancelled และ metal_plan_basis มี sprue_loss_pct เป็นตัวเลข): คำนวณ basis/แผนใหม่ด้วยหน่วยถูก (ปิด trg_job_guard ชั่วคราวใน tx เดียว + assert ด้วย job_plan_basis_assert) ·
--    ใบ cancelled ปล่อยไว้ · รันซ้ำไม่คูณ 100 ซ้ำ (ทำเฉพาะตอน job_plan_compute บน DB ยังเป็นฉบับ 0175)
--
-- ตัดสินเอง (นอก design):
--  (1) helper job_rate_pct แทนการคูณ 100 ทีละจุด — เหตุผล: "ทุกจุดที่อ่าน rate" เหลือที่เดียวและตรวจที่ catalog ได้ (ฟังก์ชัน job_* ที่มี oem_rate_value ในตัวเอง ต้องไม่มี)
--  (2) S5: ใช้ coalesce(basis.target_source, 'input') ในกิ่ง "target ไม่เปลี่ยน" — กันกรณีใบมี target แต่ basis ว่าง (job_guard ปฏิเสธ basis ที่ไม่มีที่มา)
--  (3) N11: ลบ pre-check nullif(btrim(...)) — job_text_clean(…, true) ปฏิเสธค่าว่าง/ช่องว่างทุกชนิดอยู่แล้ว และ exception block เดิมแปลงเป็น hint plan_reason_required เหมือนเดิม (ข้อความเปลี่ยนเป็นของ job_text_clean · hint เท่าเดิม · TS map ตาม hint)
--  (4) ไม่ได้เขียน job_event ตอนแก้ใบเดิม — job_event ต้องมี actor/worker (je_who_ck) ซึ่ง migration ไม่มี · แจ้งทาง raise notice แทน
-- ไม่มีราคา/ต้นทุนในทุก object ของไฟล์นี้ (อัตราส่วน % ของน้ำหนักเท่านั้น)

-- baseline ก่อนแตะ: ฟังก์ชันทุกตัวในสคีมา (md5) + updated_at ของ job (ตรวจท้ายไฟล์ว่าไม่มีอะไรขยับนอกรายการที่ตั้งใจ) + ใบ cancelled ที่มีแผน (ต้องไม่ถูกแก้)
create temp table _j177_fn_base on commit drop as
select p.oid::regprocedure::text as sig, p.proname, md5(pg_get_functiondef(p.oid)) as h
from pg_proc p
where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f';

create temp table _j177_row_base on commit drop as
select count(*) as n, count(distinct updated_at) as nd, coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') as h from analytics.job;

create temp table _j177_cancel_base on commit drop as
select coalesce(md5(string_agg(id::text || ':' || metal_plan_basis::text || ':' || coalesce(metal_plan_g::text, ''), '|' order by id)), '') as h, count(*) as n
from analytics.job where status = 'cancelled' and metal_plan_basis is not null;

-- ============================================================================
-- 0. pre-check: ฟังก์ชันที่จะ replace ต้องเป็นฉบับ 0175 ที่ apply จริง (md5 ที่ query สดจาก prod 15 ต.ค.) หรือฉบับ 0177 ที่ล็อก md5 ไว้ (รันซ้ำ) — อย่างอื่น = มีคนแก้นอก migration → หยุด (ข้อ 21)
--    _j177_ctl.first_run = job_plan_compute บน DB ยังเป็นฉบับ 0175 (ยังไม่เคยแก้หน่วย) — ใช้กันแก้ใบเดิมซ้ำ
-- ============================================================================
create temp table _j177_ctl (first_run boolean not null) on commit drop;

do $p$
declare
  r record;
  v_n int;
  v_h text;
begin
  -- ไฟล์นี้พึ่งทรานแซกชันที่ runner ครอบทั้งไฟล์ (temp table on commit drop) — รันแบบ autocommit ตารางหายทันที ⇒ บรรทัดนี้ล้มก่อน DDL ใดๆ
  perform 1 from pg_temp._j177_fn_base limit 1;
  if to_regprocedure('analytics.job_plan_formula(integer,numeric,numeric)') is null
     or to_regprocedure('analytics.job_plan_basis_assert(analytics.job)') is null then
    raise exception '0177: ยังไม่พบ 0176 (job_plan_formula / job_plan_basis_assert) — apply 0176 ก่อน';
  end if;
  for r in
    select * from (values
      ('job_plan_compute', 'ad064bce47bdc403bce4150c1c5bd8ac', '__H0177_COMPUTE__'),
      ('job_plan_suggest', '16348ddd4bea294c9f989782abf12044', '__H0177_SUGGEST__'),
      ('job_plan_set', '28a29bf4a4e22b4663c6d8f98ca38c92', '__H0177_SET__')
    ) as v(n, h_0175, h_0177)
  loop
    select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = r.n;
    if v_n <> 1 then
      raise exception '0177: % มี % signature (ต้องมี 1) — หยุดตรวจ overload', r.n, v_n;
    end if;
    select md5(pg_get_functiondef(p.oid)) into v_h from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = r.n;
    if v_h not in (r.h_0175, r.h_0177) then
      raise exception '0177: def ของ % บน DB ไม่ใช่ฉบับ 0175 ที่ apply (md5 %) และไม่ใช่ฉบับ 0177 (md5 %) — มีคนแก้นอก migration · หยุด ห้าม replace ทับ', r.n, r.h_0175, r.h_0177;
    end if;
  end loop;
  insert into _j177_ctl
    select md5(pg_get_functiondef(p.oid)) = 'ad064bce47bdc403bce4150c1c5bd8ac'
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_plan_compute';
end;
$p$;

-- ============================================================================
-- 1. helper: อ่าน rate ของ OEM เป็นหน่วย % จริง (5 = 5%) — oem_cost_rate เก็บสัดส่วน 0..1 · ที่เดียวที่แปลง · ภายใน (ไม่ grant)
--    null in = null out · ค่าแปลก (NaN/ติดลบ/มหาศาล) ปล่อยผ่านให้ผู้เรียกตรวจช่วงเอง (compute: 0..500 · suggest: 0..<100)
-- ============================================================================
create or replace function analytics.job_rate_pct(p_shop_id uuid, p_rate_key text, p_scope text, p_as_of date)
 returns numeric
 language sql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
  select analytics.oem_rate_value(p_shop_id, p_rate_key, p_scope, p_as_of) * 100
$f$;

-- ============================================================================
-- 2. job_plan_compute (def ต้นทาง 0175:414) — v_sprue เป็น % จริง · สูตรเรียก job_plan_formula (ที่เดียวกับ job_plan_basis_assert) · N11
--    ปกติ: qty_planned × target_piece_g × (1 + sprue_loss_pct/100) · ไม่มี target ⇒ {null,null} · ไม่มี rate ก้านต้นและไม่ override ⇒ metal_plan_g = null + basis.missing (ไม่ใช่ 0 — ข้อ 13)
--    override: เจ้าของกำหนดเอง ต้องมีเหตุผล (oem_note_present) · เก็บ computed_g ไว้เทียบ
-- ============================================================================
create or replace function analytics.job_plan_compute(
  p_shop_id         uuid,
  p_metal           text,
  p_qty_planned     int,
  p_target_piece_g  numeric,
  p_override_g      numeric,
  p_override_reason text,
  p_target_source   text default null
)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_today    date := analytics.job_today();
  v_sprue    numeric;
  v_missing  jsonb := '[]'::jsonb;
  v_computed numeric := null;
  v_reason   text := null;
  v_plan     numeric;
begin
  if p_target_piece_g is null then
    if p_override_g is not null or p_override_reason is not null then
      raise exception 'ตั้งแผนโลหะเองได้เมื่อมีน้ำหนักเป้าหมายต่อชิ้นเท่านั้น' using errcode = '22023', hint = 'plan_target_required';
    end if;
    return jsonb_build_object('metal_plan_g', null, 'basis', null);
  end if;
  if p_qty_planned is null or not (p_qty_planned between 1 and 100000) then
    raise exception 'จำนวนเริ่มผลิตต้องอยู่ระหว่าง 1 ถึง 100,000' using errcode = '22023', hint = 'qty_planned_invalid';
  end if;
  if not (p_target_piece_g > 0 and p_target_piece_g <= 10000 and p_target_piece_g = round(p_target_piece_g, 3)) then
    raise exception 'น้ำหนักเป้าหมายต่อชิ้นต้องมากกว่า 0 ไม่เกิน 10,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)' using errcode = '22023', hint = 'target_invalid';
  end if;
  if p_target_source is not null and p_target_source not in ('quote', 'product', 'input') then
    raise exception 'ที่มาของน้ำหนักเป้าหมายไม่ถูกต้อง' using errcode = '22023', hint = 'target_source_invalid';
  end if;
  if p_override_g is null and p_override_reason is not null then
    raise exception 'ส่งเหตุผลมาโดยไม่มีน้ำหนักโลหะที่กำหนดเอง' using errcode = '22023', hint = 'plan_override_missing';
  end if;
  if p_override_g is not null and not (p_override_g > 0 and p_override_g <= 100000 and p_override_g = round(p_override_g, 3)) then
    raise exception 'โลหะที่กำหนดเองต้องมากกว่า 0 ไม่เกิน 100,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)' using errcode = '22023', hint = 'plan_override_invalid';
  end if;

  -- 0177: v_sprue เป็น % จริง (5 = 5%) — rate ในตาราง OEM เป็นสัดส่วน 0..1 (job_rate_pct คูณ 100 ให้)
  v_sprue := analytics.job_rate_pct(p_shop_id, 'sprue_loss_pct', p_metal, v_today);
  if v_sprue is not null and not (v_sprue >= 0 and v_sprue <= 500) then
    v_sprue := null;  -- ค่าที่ไม่สมเหตุผล (ติดลบ/NaN/มหาศาล) = ถือว่าไม่มี rate ไม่ใช้คำนวณ
  end if;
  if v_sprue is null then
    v_missing := jsonb_build_array(format('sprue_loss_pct[%s]', p_metal));
  else
    v_computed := analytics.job_plan_formula(p_qty_planned, p_target_piece_g, v_sprue);
    if not (v_computed > 0 and v_computed <= 100000) then
      if p_override_g is null then
        raise exception 'โลหะที่ต้องเตรียมเกิน 100,000 กรัม — ตรวจจำนวน/น้ำหนักต่อชิ้น' using errcode = '22023', hint = 'plan_too_large';
      end if;
      v_computed := null;
    end if;
  end if;

  if p_override_g is not null then
    -- N11: ไม่มี pre-check nullif(btrim()) ซ้ำ — job_text_clean(…, true) ปฏิเสธค่าว่าง/ช่องว่างทุกชนิด และ exception block นี้แปลงเป็น plan_reason_required
    begin
      v_reason := analytics.job_text_clean(p_override_reason, 'เหตุผลที่กำหนดน้ำหนักโลหะเอง', 200, true);
    exception when sqlstate '22023' then
      raise exception '%', sqlerrm using errcode = '22023', hint = 'plan_reason_required';
    end;
    v_plan := p_override_g;
    v_missing := '[]'::jsonb;  -- กำหนดเองแล้ว ไม่ต้องใช้ rate
  else
    v_plan := v_computed;
  end if;

  return jsonb_build_object('metal_plan_g', v_plan, 'basis', jsonb_build_object(
    'target_piece_g', p_target_piece_g, 'target_source', p_target_source, 'qty_planned', p_qty_planned, 'sprue_loss_pct', v_sprue, 'sprue_rate_as_of', v_today,
    'formula', 'qty_planned*target_piece_g*(1+sprue_loss_pct/100)', 'computed_g', v_computed,
    'override_g', p_override_g, 'override_reason', v_reason, 'missing', v_missing));
end;
$f$;

-- ============================================================================
-- 3. job_plan_suggest (def ต้นทาง 0175:602) — rate reject อ่านผ่าน job_rate_pct (หน่วย % จริง) · สูตร/guard < 100 เดิม
--    rate >= 100% (สัดส่วน >= 1) / ติดลบ / NaN / null = ถือว่าไม่มี rate ตามเดิม (กันตัวหารศูนย์/ติดลบ — migration-traps ข้อ 4-5)
-- ============================================================================
create or replace function analytics.job_plan_suggest(
  p_shop_id        uuid,
  p_source_kind    text,
  p_item_id        uuid,
  p_qty_planned    int default null,
  p_target_piece_g numeric default null,
  p_stage_codes    text[] default null
)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_today   date := analytics.job_today();
  v_info    jsonb;
  v_qty_ord int;
  v_has_pl  boolean;
  v_rc      numeric;
  v_rp      numeric;
  v_rpl     numeric;
  v_missing jsonb := '[]'::jsonb;
  v_suggest int := null;
  v_den     numeric;
  v_sug_n   numeric;
  v_eff     int;
  v_target  numeric;
  v_tsrc    text;
  v_metal   text;
  v_plan    jsonb;
begin
  if p_shop_id is null or p_item_id is null then
    raise exception 'job_plan_suggest: p_shop_id และ p_item_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if p_qty_planned is not null and not (p_qty_planned between 1 and 100000) then
    raise exception 'จำนวนเริ่มผลิตต้องอยู่ระหว่าง 1 ถึง 100,000' using errcode = '22023', hint = 'qty_planned_invalid';
  end if;
  if p_target_piece_g is not null
     and not (p_target_piece_g > 0 and p_target_piece_g <= 10000 and p_target_piece_g = round(p_target_piece_g, 3)) then
    raise exception 'น้ำหนักเป้าหมายต่อชิ้นต้องมากกว่า 0 ไม่เกิน 10,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)' using errcode = '22023', hint = 'target_invalid';
  end if;

  if p_stage_codes is not null and cardinality(p_stage_codes) > 50 then
    raise exception 'รายการขั้นตอนมากเกินไป' using errcode = '22023', hint = 'stage_codes_invalid';
  end if;

  v_info := analytics.job_source_info(p_shop_id, p_source_kind, p_item_id);
  v_qty_ord := (v_info ->> 'qty')::int;
  v_metal := v_info ->> 'metal';
  -- ชุบหรือไม่: ตามขั้นที่ออฟฟิศติ๊กจริง (p_stage_codes) · ไม่ส่ง = ตามขั้นที่ระบบเสนอ
  v_has_pl := case when p_stage_codes is not null then 'plating' = any (p_stage_codes)
                   else (v_info -> 'suggested_stage_codes') ? 'plating' end;

  -- 0177: rate reject เป็น % จริง (3 = 3%) — job_rate_pct คูณ 100 จากสัดส่วนในตาราง OEM
  v_rc := analytics.job_rate_pct(p_shop_id, 'reject_rate_cast_pct', '-', v_today);
  v_rp := analytics.job_rate_pct(p_shop_id, 'reject_rate_polish_pct', '-', v_today);
  v_rpl := case when v_has_pl then analytics.job_rate_pct(p_shop_id, 'reject_rate_plate_pct', '-', v_today) else 0 end;
  -- ค่าที่ไม่สมเหตุผล (null/ติดลบ/NaN/>= 100) = ถือว่าไม่มี rate — กันตัวหารศูนย์/ติดลบ (migration-traps ข้อ 4-5)
  if v_rc is null or not (v_rc >= 0 and v_rc < 100) then
    v_rc := null; v_missing := v_missing || to_jsonb('reject_rate_cast_pct[-]'::text);
  end if;
  if v_rp is null or not (v_rp >= 0 and v_rp < 100) then
    v_rp := null; v_missing := v_missing || to_jsonb('reject_rate_polish_pct[-]'::text);
  end if;
  if v_has_pl and (v_rpl is null or not (v_rpl >= 0 and v_rpl < 100)) then
    v_rpl := null; v_missing := v_missing || to_jsonb('reject_rate_plate_pct[-]'::text);
  end if;

  if v_rc is not null and v_rp is not null and (v_rpl is not null or not v_has_pl) then
    v_den := (1 - v_rc / 100) * (1 - v_rp / 100) * (1 - coalesce(v_rpl, 0) / 100);
    v_sug_n := ceil(v_qty_ord / v_den);
    if v_sug_n between 1 and 100000 then
      v_suggest := v_sug_n::int;
    else
      v_missing := v_missing || to_jsonb('qty_planned_suggest_over_limit'::text);
    end if;
  end if;

  v_eff := coalesce(p_qty_planned, v_suggest, v_qty_ord);
  v_target := coalesce(p_target_piece_g, nullif(v_info ->> 'target_piece_g', '')::numeric);
  v_tsrc := case when p_target_piece_g is not null then 'input' else v_info ->> 'target_piece_g_source' end;
  v_plan := analytics.job_plan_compute(p_shop_id, v_metal, v_eff, v_target, null, null, v_tsrc);
  if jsonb_typeof(v_plan -> 'basis') = 'object' then
    v_missing := v_missing || (v_plan -> 'basis' -> 'missing');
  end if;

  return jsonb_build_object(
    'qty_order', v_qty_ord, 'qty_planned_suggest', v_suggest, 'buffer_qty', v_suggest - v_qty_ord, 'qty_planned_eff', v_eff, 'under_planned', v_eff < v_qty_ord,
    'reject_basis', jsonb_build_object('cast_pct', v_rc, 'polish_pct', v_rp, 'plate_pct', case when v_has_pl then v_rpl else null end, 'has_plating', v_has_pl),
    'target_piece_g', v_target, 'target_piece_g_source', v_tsrc, 'metal', v_metal,
    'metal_plan_g', v_plan -> 'metal_plan_g', 'metal_plan_basis', v_plan -> 'basis', 'missing', v_missing);
end;
$f$;

-- ============================================================================
-- 4. job_plan_set (def ต้นทาง 0175:1196) — S5: ที่มาน้ำหนักเป้าหมาย (target_source) ไม่ถูกทับเป็น 'input' เมื่อ target ไม่เปลี่ยน
--    (แก้เฉพาะ override/เหตุผล โดยน้ำหนักเป้าหมายเท่าเดิม ⇒ คงที่มาเดิม quote/product) · เปลี่ยน target หรือล้างแผน = 'input' เหมือนเดิม
-- ============================================================================
create or replace function analytics.job_plan_set(
  p_shop_id         uuid,
  p_job_id          uuid,
  p_target_piece_g  numeric,
  p_override_g      numeric default null,
  p_override_reason text default null,
  p_actor           uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_job   analytics.job%rowtype;
  v_job2  analytics.job%rowtype;
  v_plan  jsonb;
begin
  v_job := analytics.job_office_begin('job_plan_set', p_shop_id, p_job_id, v_actor);
  if exists (select 1 from analytics.job_stage s where s.job_id = p_job_id and s.stage_code = 'cast' and s.status in ('received', 'sent')) then
    raise exception 'แก้แผนโลหะไม่ได้ — ขั้นหล่อถูกรับไปแล้ว' using errcode = '22023', hint = 'cast_started';
  end if;
  v_plan := analytics.job_plan_compute(p_shop_id, v_job.metal, v_job.qty_planned, p_target_piece_g, p_override_g, p_override_reason,
    case when p_target_piece_g is not distinct from v_job.target_piece_g
         then coalesce(v_job.metal_plan_basis ->> 'target_source', 'input')
         else 'input' end);
  update analytics.job
     set target_piece_g = p_target_piece_g,
         metal_plan_g = (v_plan ->> 'metal_plan_g')::numeric,
         metal_plan_basis = case when jsonb_typeof(v_plan -> 'basis') = 'object' then v_plan -> 'basis' end
   where id = p_job_id
   returning * into v_job2;
  perform analytics.job_event_write(p_job_id, null, 'plan_change', analytics.job_today(), v_actor, null, 'job_page', null,
    jsonb_build_object('kind', 'plan',
                       'before', jsonb_build_object('target_piece_g', v_job.target_piece_g, 'metal_plan_g', v_job.metal_plan_g),
                       'after', jsonb_build_object('target_piece_g', v_job2.target_piece_g, 'metal_plan_g', v_job2.metal_plan_g,
                                                   'override', p_override_g is not null)));
  return jsonb_build_object('ok', true, 'job_no', v_job.job_no, 'target_piece_g', v_job2.target_piece_g, 'metal_plan_g', v_job2.metal_plan_g,
                            'plan_missing', coalesce(v_job2.metal_plan_basis -> 'missing', '[]'::jsonb));
end;
$f$;

-- ============================================================================
-- 5. ใบเดิมที่มีแผนผิดหน่วย: ใบที่สร้างหลัง 0175 (status <> cancelled) basis.sprue_loss_pct เก็บเป็นสัดส่วน (0.05) แต่ควรเป็น % (5)
--    ⇒ คำนวณ sprue_loss_pct / computed_g / metal_plan_g ใหม่จากข้อมูลบนใบเอง (qty_planned · target_piece_g · basis เดิม × 100) — ไม่ดึง rate ใหม่ (ใช้อัตราที่ใบนั้นจดไว้ตอนสร้าง ตาม sprue_rate_as_of)
--    override_g/override_reason ไม่แตะ (เจ้าของกำหนดเอง) · metal_plan_g เปลี่ยนเฉพาะใบที่ไม่ override
--    ปิด trg_job_guard ชั่วคราว (ใบ done/ขั้นหล่อรับแล้วแก้แผนไม่ได้ตามปกติ · ข้อ 19: ไม่ขยับ updated_at — เป็นการแก้ของระบบ ไม่ใช่คนแก้) แล้วเปิดกลับในทรานแซกชันเดียว + assert ด้วย job_plan_basis_assert
--    ใบ cancelled ปล่อยไว้ · ทำเฉพาะตอน first_run (กันรันซ้ำแล้วคูณ 100 ซ้ำ) · ไม่มีใบเข้าเงื่อนไข ⇒ ไม่ปิด trigger เลย
-- ============================================================================
do $fx$
declare
  r         analytics.job%rowtype;
  v_ids     uuid[] := '{}';
  v_n       int;
  v_s       numeric;
  v_comp    numeric;
  v_plan    numeric;
  v_basis   jsonb;
  v_ov      text;
  v_cp      text;
begin
  if not (select first_run from _j177_ctl) then
    raise notice '0177: job_plan_compute เป็นฉบับ 0177 อยู่แล้ว (รันซ้ำ) — ข้ามการแก้แผนของใบเดิม';
    return;
  end if;
  select count(*) into v_n from analytics.job
   where status <> 'cancelled' and metal_plan_basis is not null and jsonb_typeof(metal_plan_basis -> 'sprue_loss_pct') = 'number';
  if v_n = 0 then
    raise notice '0177: ไม่มีใบ (ไม่ใช่ cancelled) ที่มีแผนผิดหน่วย — ไม่แก้ใบใด · ไม่ปิด trigger';
    return;
  end if;
  alter table analytics.job disable trigger trg_job_guard;
  for r in
    select * from analytics.job
     where status <> 'cancelled' and metal_plan_basis is not null and jsonb_typeof(metal_plan_basis -> 'sprue_loss_pct') = 'number'
     order by created_at, id
     for update
  loop
    v_s := (r.metal_plan_basis ->> 'sprue_loss_pct')::numeric * 100;
    v_ov := jsonb_typeof(r.metal_plan_basis -> 'override_g');
    v_cp := jsonb_typeof(r.metal_plan_basis -> 'computed_g');
    v_comp := null;
    if v_cp = 'number' then
      v_comp := analytics.job_plan_formula(r.qty_planned, r.target_piece_g, v_s);
      if not (v_comp > 0 and v_comp <= 100000) then
        if v_ov <> 'number' then
          raise exception '0177: แผนโลหะของ % หลังแก้หน่วยเกิน 100,000 g (% g) และไม่มี override — หยุดให้คนตัดสิน', r.job_no, v_comp;
        end if;
        v_comp := null;
      end if;
    end if;
    v_plan := case when v_ov = 'number' then r.metal_plan_g else v_comp end;
    v_basis := r.metal_plan_basis || jsonb_build_object('sprue_loss_pct', v_s, 'computed_g', v_comp);
    update analytics.job set metal_plan_basis = v_basis, metal_plan_g = v_plan where id = r.id;
    v_ids := v_ids || r.id;
    raise notice '0177: แก้แผนใบ % (%): sprue % -> %, computed_g % -> %, metal_plan_g % -> %', r.job_no, r.status,
      r.metal_plan_basis ->> 'sprue_loss_pct', v_s, r.metal_plan_basis ->> 'computed_g', v_comp, r.metal_plan_g, v_plan;
  end loop;
  alter table analytics.job enable trigger trg_job_guard;
  perform analytics.job_plan_basis_assert(j) from analytics.job j where j.id = any (v_ids);
end;
$fx$;

-- ============================================================================
-- 6. สิทธิ์ — service_role เท่านั้น (แบบเดียวกับ 0176 §7: ปิดทุกอย่างก่อน เปิดเฉพาะ RPC ที่ตั้งใจ · helper/trigger/ภายใน = ไม่ grant ใคร) + overload guard + นับ RPC
--    job_rate_pct = ภายใน ไม่ grant
-- ============================================================================
do $g$
declare
  r record;
  v_rpc constant text[] := array[
    'job_stage_suggest', 'job_create_from_quote_item', 'job_create_from_production_item', 'job_token_issue', 'job_token_revoke',
    'job_office_receive', 'job_office_send', 'job_stage_skip', 'job_stage_reopen', 'job_set_due', 'job_start_gate_note_set',
    'job_done', 'job_cancel', 'worker_upsert', 'worker_pin_set', 'worker_set_active', 'worker_unlock', 'job_design_label_set',
    'worker_pin_verify', 'job_worker_logout', 'job_worker_resolve', 'job_worker_receive', 'job_worker_send',
    'job_today', 'job_bkk_date', 'job_stage_state',
    -- 0175
    'job_plan_suggest', 'job_qty_planned_set', 'job_plan_set', 'job_surplus_set',
    -- 0176
    'job_record_profile_list', 'job_record_profile_upsert', 'job_record_profile_set_default', 'job_profile_set'];
  v_n int;
  v_dup text;
  v_leak text;
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
    raise exception '0177: พบ overload ของฟังก์ชัน: %', v_dup;
  end if;
  select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = any (v_rpc);
  if v_n <> cardinality(v_rpc) then
    raise exception '0177: RPC ที่ประกาศไว้ % ตัว แต่พบใน pg_proc % ตัว', cardinality(v_rpc), v_n;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_leak
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and (p.proname like 'job\_%' or p.proname like 'worker\_%')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
          or (has_function_privilege('service_role', p.oid, 'execute') <> (p.proname = any (v_rpc))));
  if v_leak is not null then
    raise exception '0177: สิทธิ์ execute ผิดรูป: %', v_leak;
  end if;
end;
$g$;

-- ============================================================================
-- 7. ยืนยันว่าไม่มีอะไรขยับนอกรายการที่ตั้งใจ (md5 ฟังก์ชันทุกตัวในสคีมา · updated_at ของใบ · ใบ cancelled ที่มีแผนไม่ถูกแตะ · trigger เปิดครบ ·
--    ฟังก์ชันงานใบงานไม่อ่าน oem_rate_value ตรง)
-- ============================================================================
do $c$
declare
  v_changed text;
  v_unexpected text;
  v_direct text;
  v_row record;
  c_replaced constant text[] := array['job_plan_compute', 'job_plan_suggest', 'job_plan_set'];
  c_new constant text[] := array['job_rate_pct'];
begin
  select string_agg(b.sig, ', ') into v_changed
    from _j177_fn_base b
    left join pg_proc p on p.oid = to_regprocedure(b.sig)
   where not (b.proname = any (c_replaced))
     and (p.oid is null or md5(pg_get_functiondef(p.oid)) <> b.h);
  if v_changed is not null then
    raise exception '0177 แตะฟังก์ชันที่ไม่ได้ตั้งใจแตะ (md5 ไม่เท่า/หาย): %', v_changed;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_unexpected
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
     and p.oid::regprocedure::text not in (select sig from _j177_fn_base)
     and not (p.proname = any (c_replaced)) and not (p.proname = any (c_new));
  if v_unexpected is not null then
    raise exception '0177 มีฟังก์ชันใหม่ที่ไม่ได้ประกาศ: %', v_unexpected;
  end if;
  -- ฟังก์ชัน job_* (ยกเว้น helper job_rate_pct เอง) ต้องไม่อ่าน rate ตรง — ทางเดียวที่ถูกหน่วยคือ job_rate_pct
  select string_agg(p.oid::regprocedure::text, ', ') into v_direct
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.proname like 'job\_%' and p.proname <> 'job_rate_pct'
     and pg_get_functiondef(p.oid) ilike '%oem_rate_value%';
  if v_direct is not null then
    raise exception '0177: ฟังก์ชันงานใบงานอ่าน oem_rate_value ตรง (ต้องผ่าน job_rate_pct): %', v_direct;
  end if;
  -- updated_at ของใบ (รวมใบที่แก้แผน — trigger ปิดอยู่ตอนแก้) ต้องเท่าเดิมเป๊ะ · ใบ cancelled ที่มีแผนต้องไม่ถูกแตะ
  select b.n, b.nd, b.h,
         (select count(*) from analytics.job) as n2,
         (select count(distinct updated_at) from analytics.job) as nd2,
         (select coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') from analytics.job) as h2
    into v_row from _j177_row_base b;
  if v_row.n <> v_row.n2 or v_row.nd <> v_row.nd2 or v_row.h <> v_row.h2 then
    raise exception '0177: updated_at ของ job ขยับ (n % -> %, distinct % -> %)', v_row.n, v_row.n2, v_row.nd, v_row.nd2;
  end if;
  if (select coalesce(md5(string_agg(id::text || ':' || metal_plan_basis::text || ':' || coalesce(metal_plan_g::text, ''), '|' order by id)), '')
        from analytics.job where status = 'cancelled' and metal_plan_basis is not null)
     is distinct from (select h from _j177_cancel_base) then
    raise exception '0177: ใบ cancelled ที่มีแผนถูกแก้ (ต้องปล่อยไว้)';
  end if;
  if exists (select 1 from pg_trigger t where t.tgrelid in ('analytics.job'::regclass, 'analytics.job_stage'::regclass, 'analytics.job_event'::regclass)
                and not t.tgisinternal and t.tgenabled <> 'O') then
    raise exception '0177: มี trigger บนตารางใบงานที่ไม่ได้อยู่ในสถานะเปิด (O)';
  end if;
  raise notice '0177: ฟังก์ชันเดิมนอกรายการแทนที่ md5 เท่าเดิมทั้งหมด · updated_at ใบเดิมไม่ขยับ · ใบ cancelled ไม่ถูกแตะ · ไม่มีฟังก์ชันงานใบงานอ่าน rate ตรง';
end;
$c$;

notify pgrst, 'reload schema';

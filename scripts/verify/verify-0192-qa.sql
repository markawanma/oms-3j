-- scripts/verify/verify-0192-qa.sql
-- ชุดทดสอบ QA เสริมของ G1b "พลอยที่ต้องสั่งซื้อ" (supabase/migrations/0192_gems_to_buy_g1b.sql) — เขียนโดย QA แยกจาก verify-0192.sql ของ backend-dev
-- เติมเฉพาะเคสที่ verify-0192.sql ยังไม่ครอบ "จริง" (ตรวจแล้วว่าเทสต์เดิมครอบอะไรแล้ว ดูหัวไฟล์ verify-0192.sql) — ไม่ซ้ำกับของเดิม
-- self-rolling-back (3j-migration-traps ข้อ 11): ทุกกลุ่มรันใน sub-transaction ที่ถอยกลับเสมอ + จบด้วย `raise exception` ⇒ ถอยทั้งก้อน · อ่านผลจาก error message · exit 1 คือผลที่คาด · [FAIL] >= 1 = ไม่ผ่าน
-- dry-run: ต่อ 0192 + ไฟล์นี้ (LF — ข้อ 20) เป็นไฟล์เดียวแล้วรันไม่ใส่ --commit · หลัง apply 0192: รันไฟล์นี้เดี่ยวๆ ได้ · 🔴 ห้ามรันพร้อม agent/session อื่น · ห้าม --commit/--record กับไฟล์นี้
-- ข้อมูลทดสอบ: ร้านสังเคราะห์ ZZ TEST verify-0192-qa A/B (insert public.shop + shop_member ตรง ตามแพทเทิร์น verify-0190/0192 — ข้อยกเว้นเดียวที่ไม่ผ่าน RPC) · SKU/ใบผลิต/ใบงาน/ชนิด/รายการ/ราคา/พลอยในใบ/ติ๊ก/ช่าง/QR/session สร้างผ่าน RPC ของระบบทั้งหมด
-- ไม่แตะ trigger (ไม่มี disable trigger) · ไม่ลบ/แก้แถวของร้านจริง · ราคาทดสอบเป็นเลขสังเคราะห์ของร้านทดสอบ ไม่ใช่ราคาจริง
--
-- ============ ตาราง "เคสในบรีฟ QA → เทสต์ในไฟล์นี้" (ที่ verify-0192.sql ครอบแล้ว = เขียนว่า "เดิม") ============
--  ห้ามผ่าน
--   staff/ผู้จัดการ/anon เรียก 3 RPC                      -> เดิม P1 P1c P2 (staff · คนนอก · anon/authenticated) · เพิ่ม QP1 (admin/owner ของร้าน A ใช้ p_shop_id ร้าน B ทั้ง 3 RPC) QP2 (p_shop_id null ทั้ง 3 RPC)
--                                                          หมายเหตุ: shop_member.role มีแค่ owner/admin/staff (enum) — "ผู้จัดการ" คือช่าง QR ไม่ใช่สมาชิกร้าน เรียก RPC service_role ไม่ได้ · QW3 ตรวจว่าทาง W3 ของผู้จัดการไม่เห็นข้อมูลติ๊ก
--   ร้านอื่นติ๊กด้วย line_id ของเรา                         -> เดิม F4 (ทั้งสองทิศ) · เพิ่ม QF2 (ชุดผสมแถวดี + แถวร้านอื่น ทั้งติ๊กและยกเลิก — แถวดีต้องไม่ขยับ)
--   ติ๊กแถวใบปิด/ยกเลิก/ขั้นฝังรับแล้ว all-or-nothing         -> เดิม F1 F2 F5 (ผสมกับใบ cancelled เท่านั้น) · เพิ่ม QF1 (ผสมกับขั้นฝังรับแล้ว) QF3 (ผสม uuid ไม่มีจริง) QF4 QF5 (ยกเลิกติ๊กชุดผสมกับใบปิด/ขั้นฝังรับแล้ว — แถวดีที่ติ๊กไว้ต้องคงติ๊ก) QF9 (ยกเลิกติ๊กแถวใบ cancelled ที่ติ๊กไว้ = job_closed) QF9b (ขั้นฝังรับแล้วหลังติ๊ก ยกเลิกติ๊กไม่ได้)
--   line_ids ว่าง/null/>200/ซ้ำ/ไม่ใช่ uuid               -> เดิม F6 (ว่าง/null/มี null/201/2 มิติ) · เพิ่ม QF6 (ซ้ำ = นับเป็น 1 ไม่ error ไม่ log ซ้ำ) · "ไม่ใช่ uuid" ตก 22P02 ที่ชั้น cast ก่อนถึง body (ชั้น TS ตรวจแล้ว: gems.purchase.test.ts)
--   summary/mark มีคีย์ราคาแม้ null                         -> เดิม L1 L1c · เพิ่ม QW3 (ทางช่าง W3: gem_get/gem_set ไม่มีคีย์ติ๊ก) QS (payload จริงทั้ง 3 ตัวไม่มีคีย์ราคา — badkeys + has_px)
--   ติ๊กซ้ำหลังยอดลด ordered_qty ลด (M1)                    -> เดิม M5e M5f (ต่อชิ้น) · เพิ่ม QM1 (ยอดลดจากการเปลี่ยน qty_planned แล้วติ๊กซ้ำ — ordered_qty ต้องไม่ลด)
--   ลบแถวที่ติ๊กแล้วเพิ่มกลับ → removed_after_order (M2)      -> เดิม R1-R3 (ผ่าน office job_gem_bom_set) · เพิ่ม QW3 (ผ่านทาง W3 job_worker_gem_set: ลบ→โผล่ · เพิ่มกลับยังโผล่ · ติ๊กใหม่หาย)
--   แก้ ordered_* ตรงนอก RPC (L1)                           -> เดิม P10 P6 P7 · เพิ่ม QL1 (INSERT ตรงที่มีค่าติ๊ก = 42501 · INSERT ธรรมดาผ่าน = ไม่ใช่ล้มด้วยเหตุอื่น)
--   cost ใช้ราคา canonical แทน snapshot หลังรวมชื่อ          -> เดิม C4 · เพิ่ม QC4 (snapshot ไม่มีราคาแต่ canonical มี = ต้อง null ไม่ยืมราคา canonical · ส่วนสั่งแล้ว/ส่วนเหลือแยกกัน)
--   ราคาที่มีผลพรุ่งนี้ (วันไทย) ถูกใช้                       -> เดิม C3 (+30 วัน) · เพิ่ม QC1 (ราคา วันนี้ ใช้ · พรุ่งนี้ไม่ใช้ · เก่ากว่าไม่ใช้ เมื่อมีครบสามช่วง) QC2 (session TimeZone ต่างไทยจน current_date ≠ วันไทย — ต้นทุนยังใช้วันไทย) · mutant QM1
--   ไม่มีราคาได้ 0                                         -> เดิม C2 C3 C7
--   ยอดรวม cost ≠ ผลรวมแถว (ยอดคี่ 3.335 × 7)               -> เดิม C5 (0.3333 × 7) · เพิ่ม QC3 (3.335 × 7 = 23.345 ปัดขึ้น 23.35 ต่อกลุ่ม · รวม 2 กลุ่ม = 46.70 ไม่ใช่ 46.69 · totals = Σ แถวเป๊ะ) · mutant QM3 · QC3b (INFO: ส่วนสั่งแล้ว+ส่วนเหลือในกลุ่มเดียวอาจต่างจากยอดเต็ม 0.01)
--  ต้องไม่พัง
--   owner และ admin ทำได้ทั้งคู่                            -> เดิม P1b · เพิ่ม QF10 (admin ยกเลิกติ๊กของ owner แล้วติ๊กใหม่ · ข้ามผู้ติ๊ก) QF11 (ติ๊กซ้ำโดยอีกคน = changed 0 ไม่แย่งชื่อผู้ติ๊ก)
--   ยกเลิกติ๊กแล้วติ๊กใหม่                                 -> เดิม M4/M5a · เพิ่ม QF10 (state/log/ordered_by/ordered_qty ครบ)
--   ติ๊กซ้ำ = changed 0 ไม่ error                           -> เดิม M2 · เพิ่ม QF11 QF6
--   ใบมีเผื่อชิ้นจากสวิตช์เผื่อของเสีย                        -> เพิ่ม QB (qty_order 10 · qty_planned 12 × 3/ชิ้น = 36 ไม่ใช่ 30 · ติ๊กแล้ว ordered_qty = 36)
--   ออฟฟิศ replace_core / W3 job_worker_gem_set หลังมีติ๊ก   -> เดิม M7 (job_gem_bom_set → replace_core) · เพิ่ม QW3 (W3 จริง: ผู้จัดการ QR เปิดใบ → ติ๊ก → แก้พลอยผ่าน job_worker_gem_set แถวคง id คงติ๊ก) — fixture สร้างไม่ได้ = SKIP
--   ใบไม่มีขั้นฝังไม่โผล่ · ขั้นฝังแต่ไม่มีพลอย = unspecified    -> เดิม A3 A5 · เพิ่ม QST (std ไม่มีพลอย/มีพลอย ไม่โผล่ทั้งกลุ่มและ unspecified · stdg ไม่มีพลอย = unspecified)
--   ส่วนย่อยของล็อต (parent_job_id) ไม่นับซ้ำ                 -> เพิ่ม QL (แบ่งล็อตจริงผ่าน job_lot_split: ลูกไม่มี BOM · ไม่โผล่ · ยอด = ต่อชิ้น × qty_planned ของแม่ ไม่เปลี่ยน) QL2 (ลูกรับขั้นฝัง = แม่หายจากรายการ ตามที่ออกแบบ — INFO ความเสี่ยง)
--  wire / mapper: ไฟล์ QS พิมพ์ PAYLOAD_SUMMARY/PAYLOAD_MARK/PAYLOAD_COST (JSON จริงจาก DB ของร้านสังเคราะห์) ให้ดึงไปเป็น fixture ของ lib/jobs/gem-purchase.dbshape.test.ts
-- mutant ของไฟล์นี้ (ต้องถูกจับ): QM1-QM6 ท้ายไฟล์

set local statement_timeout = '9min';

create temp table _vq_fx (k text primary key, id uuid not null) on commit drop;

create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text
 language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n'
$c$;
create function pg_temp.skip(p_id text, p_desc text) returns text language sql as $c$ select format('[SKIP] %s  %s', p_id, p_desc) || E'\n' $c$;
create function pg_temp.info(p_id text, p_desc text) returns text language sql as $c$ select format('[INFO] %s  %s', p_id, p_desc) || E'\n' $c$;
create function pg_temp.fx(p_k text) returns uuid language sql as $c$ select id from _vq_fx where k = p_k $c$;
create function pg_temp.setfx(p_k text, p_id uuid) returns void language sql as $c$
  insert into _vq_fx (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id $c$;
create function pg_temp.own() returns uuid language sql as $c$ select pg_temp.fx('u_owner') $c$;
create function pg_temp.adm() returns uuid language sql as $c$ select pg_temp.fx('u_admin') $c$;
create function pg_temp.stf() returns uuid language sql as $c$ select pg_temp.fx('u_staff') $c$;
create function pg_temp.nom() returns uuid language sql as $c$ select '00000000-0000-0000-0000-0000000000a1'::uuid $c$;
-- รัน SQL ที่คืน jsonb: สำเร็จ = ค่าที่คืน · ล้ม = {_err,_state,_hint,_detail}
create function pg_temp.q(p_sql text) returns jsonb
 language plpgsql as $c$
declare v jsonb; v_msg text; v_state text; v_hint text; v_detail text;
begin
  execute p_sql into v;
  return coalesce(v, '{}'::jsonb);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  return jsonb_build_object('_err', v_msg, '_state', v_state, '_hint', v_hint, '_detail', v_detail);
end;
$c$;
-- รัน SQL เดี่ยว: สำเร็จ = 'OK' · ล้ม = 'sqlstate|hint'
create function pg_temp.err(p_sql text) returns text
 language plpgsql as $c$
declare v_state text; v_hint text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  return v_state || '|' || coalesce(v_hint, '');
end;
$c$;
create function pg_temp.hint(r jsonb) returns text language sql as $c$ select coalesce(r ->> '_state', 'OK') || '|' || coalesce(r ->> '_hint', '') $c$;
-- mutant ของฟังก์ชัน: แทนที่ข้อความในนิยามแล้ว execute — ไม่เจอข้อความ = raise (กัน mutant ที่ไม่ได้ mutate จริง)
create function pg_temp.mutate(p_sig text, p_from text, p_to text) returns void
 language plpgsql as $c$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef(p_sig::regprocedure);
  v_new := replace(v_def, p_from, p_to);
  if v_new = v_def then raise exception 'MUTANT_NOT_APPLIED: % : %', p_sig, left(p_from, 80); end if;
  execute v_new;
end;
$c$;
create function pg_temp.keys_deep(j jsonb) returns setof text
 language plpgsql as $c$
declare r record; e jsonb;
begin
  if jsonb_typeof(j) = 'object' then
    for r in select key, value from jsonb_each(j) loop
      return next r.key;
      return query select * from pg_temp.keys_deep(r.value);
    end loop;
  elsif jsonb_typeof(j) = 'array' then
    for e in select value from jsonb_array_elements(j) loop
      return query select * from pg_temp.keys_deep(e);
    end loop;
  end if;
end;
$c$;
create function pg_temp.badkeys(j jsonb) returns text
 language sql as $c$
  select coalesce(string_agg(distinct k, ','), '') from pg_temp.keys_deep(j) k where k ~* '(cost|price|thb|margin|unit_cost|customer|profit|buyer|client|quote_?no|po_?no|invoice|receipt|deposit|paid|grand_?total|subtotal|vat|tax_?id|phone|email|address|nre_|baht|supplier|tier)' $c$;
-- คีย์ของสถานะติ๊ก/ยอดสั่งซื้อ ที่ห้ามรั่วไปทางช่าง
create function pg_temp.purchase_keys(j jsonb) returns text
 language sql as $c$
  select coalesce(string_agg(distinct k, ','), '') from pg_temp.keys_deep(j) k where k ~* '(is_ordered|qty_ordered|ordered_at|ordered_by|ordered_qty|qty_remaining|qty_excess|purchase|removed_after_order)' $c$;
create function pg_temp.has_px(j jsonb) returns boolean language sql as $c$
  select exists (select 1 from analytics.gem_item_price p where p.shop_id in (pg_temp.fx('A'), pg_temp.fx('B')) and p.price_thb_per_unit >= 1000 and position(trim_scale(p.price_thb_per_unit)::text in coalesce(j::text, '')) > 0) $c$;
create function pg_temp.std() returns text language sql as $c$ select '{wax_inject,wax_tree,invest_burnout,cast,cut_sprue,finish,buff,qc,pack}' $c$;
create function pg_temp.stdg() returns text language sql as $c$ select '{wax_inject,wax_tree,invest_burnout,cast,cut_sprue,finish,buff,gem_set,qc,pack}' $c$;

-- ============================================================================
-- helper (เรียก RPC ของระบบ · named args ตรงกับ migration) — ลอกแพทเทิร์นจาก verify-0192.sql
-- ============================================================================
create function pg_temp.shp(p_shop uuid, p_name text) returns uuid language sql as $c$ select id from analytics.gem_shape where shop_id = p_shop and name = p_name $c$;
create function pg_temp.ccreate(p_shop uuid, p_name text, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_catalog_create(%L, %L, %L, %L, %L, %L)', p_shop, coalesce(p_actor, pg_temp.own()), 'type', p_name, null, true)) $c$;
create function pg_temp.icreate(p_shop uuid, p_line jsonb, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_item_create(%L, %L, %L::jsonb, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_line, true)) $c$;
create function pg_temp.price(p_shop uuid, p_item uuid, p_price text, p_eff text default null, p_note text default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_price_set(%L, %L, %L, %L::numeric, %L::date, %L, %L)', p_shop, pg_temp.own(), p_item, p_price, p_eff, null, p_note)) $c$;
create function pg_temp.bset(p_shop uuid, p_job uuid, p_lines jsonb, p_reason text default null, p_actor uuid default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_gem_bom_set(p_shop_id=>%L, p_job_id=>%L, p_gem_lines=>%L::jsonb, p_actor=>%L, p_reason=>%L, p_force=>%L)', p_shop, p_job, p_lines, coalesce(p_actor, pg_temp.own()), p_reason, true)) $c$;
create function pg_temp.mrg(p_shop uuid, p_kind text, p_from uuid, p_into uuid) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_merge(%L, %L, %L, %L, %L)', p_shop, pg_temp.own(), p_kind, p_from, p_into)) $c$;
create function pg_temp.ln(p_item uuid, p_qty int, p_pos text default null) returns jsonb
 language sql as $c$ select jsonb_build_object('gem_item_id', p_item, 'qty_per_piece', p_qty, 'position', p_pos) $c$;
create function pg_temp.sm(p_shop uuid, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_purchase_summary(%L, %L)', p_shop, coalesce(p_actor, pg_temp.own()))) $c$;
create function pg_temp.cs(p_shop uuid, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_purchase_summary_cost(%L, %L)', p_shop, coalesce(p_actor, pg_temp.own()))) $c$;
create function pg_temp.mk(p_shop uuid, p_ids uuid[], p_ordered boolean, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_purchase_mark(%L, %L::uuid[], %L, %L)', p_shop, p_ids, p_ordered, coalesce(p_actor, pg_temp.own()))) $c$;
create function pg_temp.grp(p_sm jsonb, p_item uuid) returns jsonb
 language sql as $c$ select g from jsonb_array_elements(p_sm -> 'groups') g where g ->> 'canonical_item_id' = p_item::text $c$;
create function pg_temp.cgrp(p_c jsonb, p_item uuid) returns jsonb
 language sql as $c$ select g from jsonb_array_elements(p_c -> 'groups') g where g ->> 'canonical_item_id' = p_item::text $c$;
create function pg_temp.gjob(p_grp jsonb, p_job uuid) returns jsonb
 language sql as $c$ select j from jsonb_array_elements(p_grp -> 'jobs') j where j ->> 'job_id' = p_job::text $c$;
create function pg_temp.in_sm(p_sm jsonb, p_job uuid) returns boolean
 language sql as $c$ select exists (select 1 from jsonb_array_elements(p_sm -> 'groups') g, jsonb_array_elements(g -> 'jobs') j where j ->> 'job_id' = p_job::text) $c$;
create function pg_temp.in_unspec(p_sm jsonb, p_job uuid) returns boolean
 language sql as $c$ select exists (select 1 from jsonb_array_elements(p_sm -> 'unspecified_jobs') u where u ->> 'job_id' = p_job::text) $c$;
create function pg_temp.in_removed(p_sm jsonb, p_job uuid) returns boolean
 language sql as $c$ select exists (select 1 from jsonb_array_elements(p_sm -> 'removed_after_order') e where e ->> 'job_id' = p_job::text) $c$;
create function pg_temp.lid(p_job uuid, p_item uuid) returns uuid
 language sql as $c$ select id from analytics.job_gem_bom where job_id = p_job and gem_item_id = p_item $c$;
create function pg_temp.nlog(p_shop uuid, p_action text) returns int
 language sql as $c$ select count(*)::int from analytics.gem_purchase_mark_log where shop_id = p_shop and action = p_action $c$;
create function pg_temp.ticked(p_line uuid) returns boolean
 language sql as $c$ select coalesce((select ordered_at is not null from analytics.job_gem_bom where id = p_line), false) $c$;
-- สถานะการติ๊ก + log ทั้งหมดของ 2 ร้านทดสอบ (เทียบว่า "ไม่มีอะไรเกิด" หลังคำขอที่ถูกปฏิเสธ)
create function pg_temp.msnap() returns text
 language sql as $c$
  select md5(coalesce((select string_agg(b.id::text || '|' || coalesce(b.ordered_at::text, '') || '|' || coalesce(b.ordered_by::text, '') || '|' || coalesce(b.ordered_qty::text, '') || '|' || b.qty_per_piece::text, ',' order by b.id)
                         from analytics.job_gem_bom b where b.shop_id in (pg_temp.fx('A'), pg_temp.fx('B'))), '')
          || '#' || (select count(*)::text from analytics.gem_purchase_mark_log)) $c$;

-- ใบผลิต + ใบงาน (ผ่าน RPC ออฟฟิศเดิม) — คืน job id · due_days ไม่ null = กำหนดส่งวันนี้ + n · p_planned = จำนวนเริ่มผลิต (เผื่อชิ้น)
create function pg_temp.newjob(p_shop uuid, p_product uuid, p_codes text, p_lines jsonb, p_qty int, p_due_days int default null, p_planned int default null) returns uuid
 language plpgsql as $c$
declare o uuid; r jsonb; j jsonb; jid uuid;
begin
  o := (analytics.production_order_save(p_shop, null, 'vq192', null) ->> 'id')::uuid;
  r := pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>%L, p_pending_product_label=>%L, p_metal=>%L, p_purity=>%L, p_weight_g=>%L, p_weight_source=>%L)',
    p_shop, o, p_product, p_qty, null, null, null, null, null));
  if r ? '_err' then raise exception 'newjob: ใส่รายการใบผลิตไม่ได้ %', r::text; end if;
  j := pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L, p_qty_planned=>%L, p_gem_lines=>%L::jsonb, p_gem_force=>%L)',
    p_shop, r ->> 'id', p_codes, pg_temp.nom(), p_planned, p_lines, true));
  if j ? '_err' then raise exception 'newjob: สร้างใบไม่ได้ % | %', j ->> '_err', j ->> '_hint'; end if;
  jid := (j ->> 'job_id')::uuid;
  if p_due_days is not null then
    perform analytics.job_set_due(p_shop, jid, analytics.job_today() + p_due_days, pg_temp.nom());
  end if;
  return jid;
end;
$c$;
-- ช่างรับ/ส่งขั้นถัดไปของใบ (ผ่าน RPC ออฟฟิศเดิม) · p_send = true ส่งต่อด้วย
create function pg_temp.step(p_shop uuid, p_job uuid, p_send boolean) returns text
 language plpgsql as $c$
declare sq int; cd text; r jsonb;
begin
  select s.seq, s.stage_code into sq, cd from analytics.job_stage s where s.job_id = p_job and s.status = 'pending' order by s.seq limit 1;
  if sq is null then return null; end if;
  r := pg_temp.q(format('select analytics.job_office_receive(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L, p_weight_in_g=>null, p_assignee_name=>%L, p_actor=>%L)', p_shop, p_job, sq, analytics.job_today(), 'x', pg_temp.nom()));
  if r ? '_err' then
    r := pg_temp.q(format('select analytics.job_office_receive(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L, p_weight_in_g=>%L, p_assignee_name=>%L, p_actor=>%L)', p_shop, p_job, sq, analytics.job_today(), 50, 'x', pg_temp.nom()));
  end if;
  if r ? '_err' then raise exception 'step receive % ล้ม: %', cd, r::text; end if;
  if p_send then
    r := pg_temp.q(format('select analytics.job_office_send(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L, p_weight_out_g=>null, p_qty_scrap=>0, p_actor=>%L)', p_shop, p_job, sq, analytics.job_today(), pg_temp.nom()));
    if r ? '_err' then
      r := pg_temp.q(format('select analytics.job_office_send(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L, p_weight_out_g=>%L, p_qty_scrap=>0, p_actor=>%L)', p_shop, p_job, sq, analytics.job_today(), 49, pg_temp.nom()));
    end if;
    if r ? '_err' then raise exception 'step send % ล้ม: %', cd, r::text; end if;
  end if;
  return cd;
end;
$c$;
-- ส่งขั้นที่ถืออยู่ (received) ของใบ — ใช้กับใบที่ถือขั้นค้างอยู่ก่อนเดินต่อ
create function pg_temp.send_cur(p_shop uuid, p_job uuid) returns void
 language plpgsql as $c$
declare sq int; r jsonb;
begin
  select s.seq into sq from analytics.job_stage s where s.job_id = p_job and s.status = 'received' order by s.seq limit 1;
  if sq is null then return; end if;
  r := pg_temp.q(format('select analytics.job_office_send(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L, p_weight_out_g=>null, p_qty_scrap=>0, p_actor=>%L)', p_shop, p_job, sq, analytics.job_today(), pg_temp.nom()));
  if r ? '_err' then
    r := pg_temp.q(format('select analytics.job_office_send(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L, p_weight_out_g=>%L, p_qty_scrap=>0, p_actor=>%L)', p_shop, p_job, sq, analytics.job_today(), 49, pg_temp.nom()));
  end if;
  if r ? '_err' then raise exception 'send_cur ล้ม: %', r::text; end if;
end;
$c$;
create function pg_temp.walk_to(p_shop uuid, p_job uuid, p_code text) returns void
 language plpgsql as $c$
declare cd text; n int := 0;
begin
  loop
    select s.stage_code into cd from analytics.job_stage s where s.job_id = p_job and s.status = 'pending' order by s.seq limit 1;
    exit when cd is null or cd = p_code;
    perform pg_temp.step(p_shop, p_job, true);
    n := n + 1;
    if n > 20 then raise exception 'walk_to วนเกิน'; end if;
  end loop;
end;
$c$;
-- สร้างชนิด + รายการ (รูปทรงกลม) ผูกคีย์ไว้ใน fx: ชนิด = 't' || คีย์ · รายการ = คีย์
create function pg_temp.mkitem(p_shop uuid, p_key text, p_type text, p_size numeric, p_actor uuid default null) returns uuid
 language plpgsql as $c$
declare t uuid; it uuid; sh uuid;
begin
  t := (pg_temp.ccreate(p_shop, p_type, p_actor) ->> 'id')::uuid;
  sh := pg_temp.shp(p_shop, 'กลม');
  it := (pg_temp.icreate(p_shop, jsonb_build_object('type_id', t, 'shape_id', sh, 'size_a', p_size), p_actor) -> 'item' ->> 'gem_item_id')::uuid;
  if t is null or it is null then raise exception 'mkitem % ล้ม', p_key; end if;
  perform pg_temp.setfx('t' || p_key, t);
  perform pg_temp.setfx(p_key, it);
  return it;
end;
$c$;

-- ============================================================================
-- S. setup — ร้านสังเคราะห์ A/B · สมาชิก · SKU · ชนิด/รายการ/ราคา (ผ่าน RPC) — ใบงานสร้างในแต่ละกลุ่ม (กลุ่มถอยกลับเองได้)
-- ============================================================================
create function pg_temp.q_setup() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  u1 uuid; u2 uuid; u3 uuid; p uuid; i int; n_price int;
  today date := analytics.job_today();
begin
  insert into public.shop (id, name) values (a, 'ZZ TEST verify-0192-qa A'), (b, 'ZZ TEST verify-0192-qa B');
  perform pg_temp.setfx('A', a); perform pg_temp.setfx('B', b);
  select m.user_id into u1 from public.shop_member m where m.role = 'owner' order by m.user_id limit 1;
  select m.user_id into u2 from public.shop_member m where m.role = 'owner' order by m.user_id desc limit 1;
  select m.user_id into u3 from public.shop_member m where m.role = 'admin' order by m.user_id limit 1;
  if u1 is null or u2 is null or u3 is null or u1 = u2 then
    raise exception 'setup: ต้องมี owner 2 คน (ต่างกัน) + admin 1 คน ใน shop_member จริงเพื่อยืมเป็นผู้ทำรายการ';
  end if;
  insert into public.shop_member (shop_id, user_id, role) values (a, u1, 'owner'), (a, u3, 'admin'), (a, u2, 'staff'), (b, u2, 'owner');
  perform pg_temp.setfx('u_owner', u1); perform pg_temp.setfx('u_admin', u3); perform pg_temp.setfx('u_staff', u2);
  perform analytics.gem_shape_ensure(a); perform analytics.gem_shape_ensure(b);
  perform analytics.job_stage_def_ensure(a); perform analytics.job_record_profile_ensure(a);
  perform analytics.job_stage_def_ensure(b); perform analytics.job_record_profile_ensure(b);
  perform pg_temp.setfx('rnd', pg_temp.shp(a, 'กลม'));
  for i in 1..9 loop
    p := analytics.product_upsert(a, 'ZZ192Q-A' || i, 'แหวนทดสอบ QA ' || i, null, 'fixed', 50, null, null, null, null, null, null, null, true);
    perform pg_temp.setfx('pA' || i, p);
  end loop;
  p := analytics.product_upsert(b, 'ZZ192Q-B1', 'SKU ร้าน B QA', null, 'fixed', 70, null, null, null, null, null, null, null, true);
  perform pg_temp.setfx('pB1', p);
  -- รายการ (รูปทรงกลม · ขนาดไม่ซ้ำกัน) — iT1..iT4 ไม่มีราคา · iPx ราคาสามช่วง · iO1/iO2 ราคาเลขคี่ · iMc ไม่มีราคา/iMd มีราคา (ไว้รวมชื่อ)
  perform pg_temp.mkitem(a, 'iT1', 'ZZQ ชนิดหนึ่ง', 3);
  perform pg_temp.mkitem(a, 'iT2', 'ZZQ ชนิดสอง', 4);
  perform pg_temp.mkitem(a, 'iT3', 'ZZQ ชนิดสาม', 5);
  perform pg_temp.mkitem(a, 'iT4', 'ZZQ ชนิดสี่', 6);
  perform pg_temp.mkitem(a, 'iW', 'ZZQ ชนิดช่าง', 6.5);
  perform pg_temp.mkitem(a, 'iPx', 'ZZQ ชนิดราคา', 7);
  perform pg_temp.mkitem(a, 'iO1', 'ZZQ ชนิดคี่หนึ่ง', 8);
  perform pg_temp.mkitem(a, 'iO2', 'ZZQ ชนิดคี่สอง', 9);
  perform pg_temp.mkitem(a, 'iMc', 'ZZQ ชนิดรวมต้นทาง', 1.1);
  perform pg_temp.mkitem(a, 'iMd', 'ZZQ ชนิดรวมปลายทาง', 1.1);
  perform pg_temp.mkitem(b, 'iBt', 'ZZQ บีทับทิม', 3, u2);
  -- ราคา (เลขสังเคราะห์ของร้านทดสอบ): iPx 4100.1111 (วันนี้ − 10 · ต้อง note) · 5200.2222 (วันนี้) · 6300.3333 (พรุ่งนี้) · iO1/iO2 3.335 · iMd 80
  perform pg_temp.price(a, pg_temp.fx('iPx'), '4100.1111', (today - 10)::text, 'qa ทดสอบราคาย้อนหลัง');
  perform pg_temp.price(a, pg_temp.fx('iPx'), '5200.2222');
  perform pg_temp.price(a, pg_temp.fx('iPx'), '6300.3333', (today + 1)::text);
  perform pg_temp.price(a, pg_temp.fx('iO1'), '3.335');
  perform pg_temp.price(a, pg_temp.fx('iO2'), '3.335');
  perform pg_temp.price(a, pg_temp.fx('iMd'), '80');
  select count(*) into n_price from analytics.gem_item_price where shop_id = a;
  v := v || pg_temp.chk('QS0', 'setup: ร้าน A/B · สมาชิก owner/admin/staff · SKU 9+1 · รายการ 10+1 · ราคา 6 แถว (iPx 3 ช่วง: วันนี้−10 = 4100.1111 / วันนี้ = 5200.2222 / พรุ่งนี้ = 6300.3333 · iO1/iO2 3.335 · iMd 80)',
    n_price = 6 and pg_temp.fx('iT1') is not null and pg_temp.fx('iBt') is not null and pg_temp.fx('pA9') is not null and pg_temp.fx('pB1') is not null);
  return v;
end;
$c$;

-- ============================================================================
-- QP. สิทธิ์ (เติมจาก P1/P1c/P2 เดิม)
-- ============================================================================
create function pg_temp.q_perm() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A'); b uuid := pg_temp.fx('B');
  s0 text; ok boolean := true; bad text := ''; x uuid; jq uuid; l uuid;
begin
  jq := pg_temp.newjob(a, pg_temp.fx('pA1'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(pg_temp.fx('iT1'), 1)), 2, 3);
  l := pg_temp.lid(jq, pg_temp.fx('iT1'));
  s0 := pg_temp.msnap();
  -- QP1: ผู้ใช้ owner/admin ของร้าน A แต่ใช้ p_shop_id ของร้าน B (ไม่ใช่สมาชิกร้าน B) → ปฏิเสธทั้ง 3 RPC · ไม่เขียนอะไร
  foreach x in array array[pg_temp.own(), pg_temp.adm()] loop
    if pg_temp.hint(pg_temp.sm(b, x)) <> '42501|gem_actor_forbidden' or pg_temp.hint(pg_temp.cs(b, x)) <> '42501|gem_actor_forbidden'
       or pg_temp.hint(pg_temp.mk(b, array[l], true, x)) <> '42501|gem_actor_forbidden' then
      ok := false; bad := bad || x::text || ' ';
    end if;
  end loop;
  v := v || pg_temp.chk('QP1', '🔴 owner/admin ของร้าน A ใช้ p_shop_id ร้าน B (ไม่ใช่สมาชิก): สรุป · ต้นทุน · ติ๊ก (แม้ส่ง line_id จริงของร้าน A) → 42501/gem_actor_forbidden · ไม่เขียนอะไร · ที่หลุด: ' || coalesce(nullif(bad, ''), 'ไม่มี'),
    ok and pg_temp.msnap() = s0);
  -- QP2: p_shop_id null → 22023 ทั้ง 3 RPC (ไม่ตกไปเป็นร้านว่าง/ทุกร้าน)
  v := v || pg_temp.chk('QP2', 'p_shop_id = null → 22023 ทั้ง 3 RPC (สรุป · ต้นทุน · ติ๊ก) · ไม่เขียนอะไร',
    pg_temp.err(format('select analytics.gem_purchase_summary(null, %L)', pg_temp.own())) = '22023|'
    and pg_temp.err(format('select analytics.gem_purchase_summary_cost(null, %L)', pg_temp.own())) = '22023|'
    and pg_temp.err(format('select analytics.gem_purchase_mark(null, ARRAY[%L::uuid], true, %L)', l, pg_temp.own())) = '22023|'
    and pg_temp.msnap() = s0);
  -- QP3: staff ลองติ๊ก/ยกเลิกติ๊กแถวจริงที่ติ๊กไว้แล้วโดย owner — ต้องไม่แตะ (กัน staff ยกเลิกติ๊กของ owner)
  perform pg_temp.mk(a, array[l], true);
  s0 := pg_temp.msnap();
  v := v || pg_temp.chk('QP3', 'staff ยกเลิกติ๊กแถวที่ owner ติ๊กไว้ → 42501/gem_actor_forbidden · แถวยังติ๊กอยู่ · ไม่มี log ใหม่',
    pg_temp.hint(pg_temp.mk(a, array[l], false, pg_temp.stf())) = '42501|gem_actor_forbidden' and pg_temp.ticked(l) and pg_temp.msnap() = s0);
  return v;
end;
$c$;

-- ============================================================================
-- QF/QB/QM/QL. การติ๊ก: ชุดผสม all-or-nothing · ซ้ำ · สองผู้ใช้ · ใบปิด · ขั้นฝังรับแล้ว · เผื่อชิ้น · ยอดลดจาก qty_planned · เขียนตรง
-- ============================================================================
create function pg_temp.q_mark() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A'); b uuid := pg_temp.fx('B');
  iT1 uuid := pg_temp.fx('iT1'); iT2 uuid := pg_temp.fx('iT2'); iT4 uuid := pg_temp.fx('iT4'); iBt uuid := pg_temp.fx('iBt');
  j1 uuid; j2 uuid; j3 uuid; j4 uuid; js uuid; jb uuid; jbuf uuid;
  l1 uuid; l2 uuid; l3 uuid; l4 uuid; ls uuid; lb uuid; lbuf uuid;
  r jsonb; s jsonb; raw jsonb; s0 text; n_ord int; n_un int; ok boolean; g jsonb; qo_before bigint;
begin
  j1 := pg_temp.newjob(a, pg_temp.fx('pA1'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iT1, 2)), 5, 3);   -- ต้องใช้ 10
  j2 := pg_temp.newjob(a, pg_temp.fx('pA2'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iT1, 1)), 4, 5);   -- 4
  j3 := pg_temp.newjob(a, pg_temp.fx('pA3'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iT1, 1)), 3, 7);   -- 3 (ติ๊กแล้วยกเลิกใบ)
  j4 := pg_temp.newjob(a, pg_temp.fx('pA4'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iT1, 1)), 2, 9);   -- 2 (แถวดี ไม่ติ๊ก)
  js := pg_temp.newjob(a, pg_temp.fx('pA5'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iT1, 1)), 2, 11);  -- 2 (ติ๊กแล้วขั้นฝังถูกรับ)
  jb := pg_temp.newjob(b, pg_temp.fx('pB1'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iBt, 1)), 2, 5);   -- ร้าน B
  l1 := pg_temp.lid(j1, iT1); l2 := pg_temp.lid(j2, iT1); l3 := pg_temp.lid(j3, iT1); l4 := pg_temp.lid(j4, iT1); ls := pg_temp.lid(js, iT1); lb := pg_temp.lid(jb, iBt);
  r := pg_temp.mk(a, array[l1, l2, l3, ls], true);
  v := v || pg_temp.chk('QM0', 'ติ๊ก 4 แถว (owner) สำเร็จ: changed 4 · l4 (ไม่ได้ส่ง) ยังไม่ติ๊ก · ordered_qty ของ l1 = 10',
    (r ->> 'changed') = '4' and not pg_temp.ticked(l4) and (select ordered_qty from analytics.job_gem_bom where id = l1) = 10);

  -- QF10: ยกเลิกติ๊กโดยอีกคน (admin ยกเลิกของ owner) แล้วติ๊กใหม่ด้วย admin — state/log/ordered_by/ordered_qty ครบ
  n_ord := pg_temp.nlog(a, 'ordered'); n_un := pg_temp.nlog(a, 'unordered');
  r := pg_temp.mk(a, array[l1], false, pg_temp.adm());
  ok := (r ->> 'changed') = '1' and not pg_temp.ticked(l1) and (select ordered_by is null and ordered_qty is null from analytics.job_gem_bom where id = l1);
  r := pg_temp.mk(a, array[l1], true, pg_temp.adm());
  v := v || pg_temp.chk('QF10', 'admin ยกเลิกติ๊กของ owner (changed 1 · ล้างครบสามคอลัมน์) แล้วติ๊กใหม่ด้วย admin: changed 1 · ordered_by = admin · ordered_qty = 10 · log ordered +1 · unordered +1 — owner/admin ทำได้ทั้งคู่ ข้ามผู้ติ๊ก',
    ok and (r ->> 'changed') = '1' and (select ordered_by from analytics.job_gem_bom where id = l1) = pg_temp.adm() and (select ordered_qty from analytics.job_gem_bom where id = l1) = 10
    and pg_temp.nlog(a, 'ordered') = n_ord + 1 and pg_temp.nlog(a, 'unordered') = n_un + 1);
  -- QF11: ติ๊กซ้ำโดยอีกคน (owner ติ๊กแถวที่ admin ติ๊กไว้ ยอดเท่าเดิม) = changed 0 · ordered_by ยังเป็น admin (ไม่แย่งชื่อ) · ไม่มี log ใหม่
  r := pg_temp.mk(a, array[l1], true);
  v := v || pg_temp.chk('QF11', 'ติ๊กซ้ำโดยอีกคน (ยอดเท่าเดิม): changed 0 · unchanged 1 · ordered_by ยังเป็นคนติ๊กคนแรก (admin) · ไม่มี log ใหม่',
    (r ->> 'changed') = '0' and (r ->> 'unchanged') = '1' and (select ordered_by from analytics.job_gem_bom where id = l1) = pg_temp.adm() and pg_temp.nlog(a, 'ordered') = n_ord + 1);

  -- ใบปิด: ยกเลิก j3 ทั้งที่ติ๊กไว้ · ขั้นฝังรับแล้ว: js เดินถึงขั้นฝังแล้วรับ
  perform analytics.job_cancel(a, j3, 'verify 0192 qa ยกเลิกใบที่ติ๊กไว้', pg_temp.nom());
  perform pg_temp.walk_to(a, js, 'gem_set');
  perform pg_temp.step(a, js, false);
  s := pg_temp.sm(a);
  v := v || pg_temp.chk('QF0', 'fixture: j3 cancelled · js ขั้นฝังรับแล้ว (received) · ทั้งสองไม่โผล่ในสรุป · แถวของทั้งสองยังติ๊กค้างในตาราง · l1 l4 ยังโผล่',
    (select status from analytics.job where id = j3) = 'cancelled' and (select status from analytics.job_stage where job_id = js and stage_code = 'gem_set') = 'received'
    and not pg_temp.in_sm(s, j3) and not pg_temp.in_sm(s, js) and pg_temp.ticked(l3) and pg_temp.ticked(ls) and pg_temp.in_sm(s, j1) and pg_temp.in_sm(s, j4));

  -- QF9: ยกเลิกติ๊ก/ติ๊กแถวของใบ cancelled ที่ติ๊กไว้ → job_closed · ไม่ขยับ
  s0 := pg_temp.msnap();
  v := v || pg_temp.chk('QF9', 'แถวใบ cancelled ที่ติ๊กไว้: ยกเลิกติ๊ก → 22023/job_closed · ติ๊กซ้ำ → job_closed · แถวยังติ๊กอยู่ · ไม่มี log ใหม่',
    pg_temp.hint(pg_temp.mk(a, array[l3], false)) = '22023|job_closed' and pg_temp.hint(pg_temp.mk(a, array[l3], true)) = '22023|job_closed' and pg_temp.ticked(l3) and pg_temp.msnap() = s0);
  -- QF9b: ติ๊กไว้ก่อนแล้วขั้นฝังถูกรับ → ยกเลิกติ๊กไม่ได้ (ไม่อยู่ในรายการแล้ว) · ไม่ขยับ
  v := v || pg_temp.chk('QF9b', 'แถวที่ติ๊กไว้ แล้วขั้นฝังถูกรับ: ยกเลิกติ๊ก → 22023/gem_stage_started · ติ๊กซ้ำ → gem_stage_started · แถวยังติ๊กอยู่ · ไม่มี log ใหม่',
    pg_temp.hint(pg_temp.mk(a, array[ls], false)) = '22023|gem_stage_started' and pg_temp.hint(pg_temp.mk(a, array[ls], true)) = '22023|gem_stage_started' and pg_temp.ticked(ls) and pg_temp.msnap() = s0);

  -- QF1: ติ๊กชุดผสม [แถวดี l4 + แถวขั้นฝังรับแล้ว ls] → ปฏิเสธทั้งชุด l4 ไม่ถูกติ๊ก
  r := pg_temp.mk(a, array[l4, ls], true);
  v := v || pg_temp.chk('QF1', '🔴 ชุดผสม [แถวดี + แถวขั้นฝังรับแล้ว] ติ๊ก → 22023/gem_stage_started ทั้งชุด · แถวดี l4 ไม่ถูกติ๊ก (all-or-nothing) · ไม่มี log ใหม่',
    pg_temp.hint(r) = '22023|gem_stage_started' and not pg_temp.ticked(l4) and pg_temp.msnap() = s0);
  -- QF2: ชุดผสม [แถวดี + แถวร้านอื่น] ทั้งติ๊กและยกเลิก → purchase_line_not_found · แถวดีไม่ขยับ (ทั้งแถวที่ยังไม่ติ๊ก l4 และที่ติ๊กอยู่ l1)
  v := v || pg_temp.chk('QF2', '🔴 ชุดผสม [แถวดี + line_id ร้านอื่น]: ติ๊ก (l4) และยกเลิกติ๊ก (l1 ที่ติ๊กอยู่) → 22023/purchase_line_not_found ทั้งชุด · l4 ไม่ถูกติ๊ก · l1 ยังติ๊ก · แถวร้าน B ไม่ถูกติ๊ก',
    pg_temp.hint(pg_temp.mk(a, array[l4, lb], true)) = '22023|purchase_line_not_found' and pg_temp.hint(pg_temp.mk(a, array[l1, lb], false)) = '22023|purchase_line_not_found'
    and not pg_temp.ticked(l4) and pg_temp.ticked(l1) and not pg_temp.ticked(lb) and pg_temp.msnap() = s0);
  -- QF3: ชุดผสม [แถวดี + uuid ที่ไม่มีจริง]
  v := v || pg_temp.chk('QF3', 'ชุดผสม [แถวดี + uuid ที่ไม่มีจริง] → purchase_line_not_found · l4 ไม่ถูกติ๊ก',
    pg_temp.hint(pg_temp.mk(a, array[l4, gen_random_uuid()], true)) = '22023|purchase_line_not_found' and not pg_temp.ticked(l4) and pg_temp.msnap() = s0);
  -- QF4/QF5: ยกเลิกติ๊กชุดผสม [l1 ที่ติ๊กอยู่ + แถวใบปิด/ขั้นฝังรับแล้ว] → ปฏิเสธทั้งชุด · l1 คงติ๊ก
  v := v || pg_temp.chk('QF4', '🔴 ยกเลิกติ๊กชุดผสม [l1 ที่ติ๊กอยู่ + แถวใบ cancelled] → job_closed ทั้งชุด · l1 ยังติ๊กอยู่ (ไม่ถูกยกเลิกครึ่งทาง) · ไม่มี log ใหม่',
    pg_temp.hint(pg_temp.mk(a, array[l1, l3], false)) = '22023|job_closed' and pg_temp.ticked(l1) and pg_temp.msnap() = s0);
  v := v || pg_temp.chk('QF5', '🔴 ยกเลิกติ๊กชุดผสม [l1 ที่ติ๊กอยู่ + แถวขั้นฝังรับแล้ว] → gem_stage_started ทั้งชุด · l1 ยังติ๊กอยู่ · ไม่มี log ใหม่',
    pg_temp.hint(pg_temp.mk(a, array[l1, ls], false)) = '22023|gem_stage_started' and pg_temp.ticked(l1) and pg_temp.msnap() = s0);

  -- QF6: ซ้ำ [l4,l4,l4] = นับเป็น 1 แถว ไม่ error · log ordered +1 เดียว · ยกเลิกซ้ำก็เช่นกัน
  n_ord := pg_temp.nlog(a, 'ordered'); n_un := pg_temp.nlog(a, 'unordered');
  r := pg_temp.mk(a, array[l4, l4, l4], true);
  ok := r ->> '_err' is null and (r ->> 'requested') = '1' and (r ->> 'changed') = '1' and (r ->> 'unchanged') = '0' and jsonb_array_length(r -> 'lines') = 1 and pg_temp.ticked(l4);
  v := v || pg_temp.chk('QF6a', 'line_ids ซ้ำ [l4,l4,l4] (ติ๊ก): ไม่ error · requested 1 · changed 1 · lines 1 แถว · log ordered +1 เดียว', ok and pg_temp.nlog(a, 'ordered') = n_ord + 1);
  r := pg_temp.mk(a, array[l4, l4], false);
  v := v || pg_temp.chk('QF6b', 'line_ids ซ้ำ [l4,l4] (ยกเลิกติ๊ก): ไม่ error · requested 1 · changed 1 · log unordered +1 เดียว · l4 กลับเป็นไม่ติ๊ก',
    r ->> '_err' is null and (r ->> 'requested') = '1' and (r ->> 'changed') = '1' and pg_temp.nlog(a, 'unordered') = n_un + 1 and not pg_temp.ticked(l4));

  -- QM1: ยอดลดจากการเปลี่ยน qty_planned (ไม่ใช่ qty_per_piece) แล้วติ๊กซ้ำ — ordered_qty ต้องไม่ลด · ติ๊กไว้ 4 → เพิ่มเป็น 7 → ติ๊กซ้ำ = 7 → ลดกลับ 4 → ติ๊กซ้ำ = ยัง 7
  raw := pg_temp.q(format('select analytics.job_qty_planned_set(p_shop_id=>%L, p_job_id=>%L, p_qty_planned=>%L, p_reason=>%L, p_actor=>%L)', a, j2, 7, 'verify 0192 qa เพิ่มเผื่อ', pg_temp.nom()));
  if raw ? '_err' or raw ->> 'ok' = 'false' then
    v := v || pg_temp.skip('QM1', 'job_qty_planned_set ไม่รับ (' || coalesce(raw ->> '_err', raw ->> 'error', raw::text) || ') — เคสยอดลดจาก qty_planned ไม่ได้ทดสอบ');
  else
    r := pg_temp.mk(a, array[l2], true);
    ok := (r ->> 'changed') = '1' and (select ordered_qty from analytics.job_gem_bom where id = l2) = 7;
    raw := pg_temp.q(format('select analytics.job_qty_planned_set(p_shop_id=>%L, p_job_id=>%L, p_qty_planned=>%L, p_reason=>%L, p_actor=>%L)', a, j2, 4, 'verify 0192 qa ลดกลับ', pg_temp.nom()));
    n_ord := pg_temp.nlog(a, 'ordered');
    r := pg_temp.mk(a, array[l2], true);
    s := pg_temp.sm(a); g := pg_temp.grp(s, iT1);
    v := v || pg_temp.chk('QM1', '🔴 ติ๊กไว้ 4 → qty_planned 4→7 ติ๊กซ้ำ (ordered 7) → qty_planned กลับ 4 แล้วติ๊กซ้ำ: changed 0 · ordered_qty ยัง 7 (ไม่ลด) · qty_excess 3 · changed_after_order = true · ไม่มี log ใหม่',
      ok and not (raw ? '_err') and (r ->> 'changed') = '0' and (select ordered_qty from analytics.job_gem_bom where id = l2) = 7
      and (pg_temp.gjob(g, j2) ->> 'qty_needed_now') = '4' and (pg_temp.gjob(g, j2) ->> 'qty_excess') = '3' and (pg_temp.gjob(g, j2) ->> 'changed_after_order') = 'true' and pg_temp.nlog(a, 'ordered') = n_ord);
  end if;

  -- QB: ใบมีเผื่อชิ้น (qty_order 10 · qty_planned 12) × 3/ชิ้น = 36 (ไม่ใช่ 30) · ติ๊กแล้ว ordered_qty = 36
  begin
    jbuf := pg_temp.newjob(a, pg_temp.fx('pA6'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iT2, 3)), 10, 4, 12);
    if (select qty_order from analytics.job where id = jbuf) is distinct from 10 or (select qty_planned from analytics.job where id = jbuf) is distinct from 12 then
      v := v || pg_temp.skip('QB', 'สร้างใบเผื่อชิ้นไม่ได้ตามที่ตั้ง (qty_order/qty_planned = ' || coalesce((select qty_order::text || '/' || qty_planned::text from analytics.job where id = jbuf), '?') || ')');
    else
      lbuf := pg_temp.lid(jbuf, iT2);
      s := pg_temp.sm(a);
      g := pg_temp.grp(s, iT2);
      ok := (g ->> 'qty_needed_now') = '36' and (pg_temp.gjob(g, jbuf) ->> 'qty_needed_now') = '36' and (g ->> 'qty_needed_now') <> '30';
      r := pg_temp.mk(a, array[lbuf], true);
      v := v || pg_temp.chk('QB', 'ใบมีเผื่อชิ้น (qty_order 10 · qty_planned 12 = มีเผื่อ 2 จากสวิตช์) × 3 ต่อชิ้น: ต้องใช้ 36 (ตาม qty_planned ไม่ใช่ qty_order = 30 · ไม่บวกเผื่อแตกซ้ำ) · ติ๊กแล้ว ordered_qty = 36 · เหลือ 0',
        ok and (r ->> 'changed') = '1' and (select ordered_qty from analytics.job_gem_bom where id = lbuf) = 36 and (r -> 'lines' -> 0 ->> 'qty_remaining') = '0');
    end if;
  exception when others then
    v := v || pg_temp.skip('QB', 'fixture ใบเผื่อชิ้นล้ม (' || sqlerrm || ')');
  end;

  -- QL1: เขียน ordered_* ตรงนอก RPC ด้วย INSERT — ต้อง 42501/gem_purchase_direct · INSERT ธรรมดา (positive control) ต้องผ่าน (ไม่ใช่ล้มเพราะเหตุอื่น)
  v := v || pg_temp.chk('QL1a', 'positive control: INSERT แถวพลอยธรรมดา (ไม่มี ordered_*) เข้าใบ j4 ผ่าน — เทสต์ QL1 ที่คาด 42501 จึงมีความหมาย',
    pg_temp.err(format('insert into analytics.job_gem_bom (shop_id, job_id, line_seq, gem_item_id, gem_label, qty_per_piece, source, created_by) values (%L, %L, 2, %L, %L, 1, %L, %L)',
                       a, j4, iT4, 'qa-control', 'manual', pg_temp.own())) = 'OK');
  v := v || pg_temp.chk('QL1b', '🔴 INSERT ตรงที่มี ordered_at/by/qty (ข้าม gem_purchase_mark) → 42501/gem_purchase_direct (แม้ในนาม postgres) · แถวไม่ถูกสร้าง',
    pg_temp.err(format('insert into analytics.job_gem_bom (shop_id, job_id, line_seq, gem_item_id, gem_label, qty_per_piece, source, created_by, ordered_at, ordered_by, ordered_qty) values (%L, %L, 3, %L, %L, 1, %L, %L, now(), %L, 3)',
                       a, j4, pg_temp.fx('iW'), 'qa-direct', 'manual', pg_temp.own(), pg_temp.own())) = '42501|gem_purchase_direct'
    and not exists (select 1 from analytics.job_gem_bom where job_id = j4 and gem_item_id = pg_temp.fx('iW')));
  return v;
end;
$c$;

-- ============================================================================
-- QC. ต้นทุนประมาณ: ราคาตามวันไทย (วันนี้ใช้ · พรุ่งนี้ไม่ใช้ · เก่ากว่าไม่ใช้) · เขตเวลา session ต่างไทย · ยอดคี่ · snapshot vs canonical
-- ============================================================================
create function pg_temp.q_cost() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A'); today date := analytics.job_today();
  iPx uuid := pg_temp.fx('iPx'); iO1 uuid := pg_temp.fx('iO1'); iO2 uuid := pg_temp.fx('iO2'); iMc uuid := pg_temp.fx('iMc'); iMd uuid := pg_temp.fx('iMd');
  jpx uuid; jo uuid; jo2 uuid; jmc uuid; jmd uuid;
  c jsonb; c2 jsonb; g jsonb; g1 jsonb; g2 jsonb; sm jsonb; sumg numeric; tz_old text; tz_new text; d_cur date; r jsonb; gd jsonb;
  full_cost numeric;
begin
  -- QC1: ราคาสามช่วง (วันนี้−10 = 4100.1111 · วันนี้ = 5200.2222 · พรุ่งนี้ = 6300.3333) ใช้ของวันนี้ → 3 เม็ด = 15600.67 (ไม่ใช่ 12300.33 ของเก่า · ไม่ใช่ 18901.00 ของพรุ่งนี้)
  jpx := pg_temp.newjob(a, pg_temp.fx('pA1'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iPx, 1)), 3, 3);
  c := pg_temp.cs(a);
  g := pg_temp.cgrp(c, iPx);
  v := v || pg_temp.chk('QC1', '🔴 ราคา 3 ช่วง (วันนี้ไทย−10 = 4100.1111 · วันนี้ = 5200.2222 · พรุ่งนี้ = 6300.3333): ต้นทุน 3 เม็ด = 15600.67 (ราคาของวันนี้ · ไม่ใช่ 12300.33 ของเก่า · ไม่ใช่ 18901.00 ของพรุ่งนี้) · missing_price = false',
    c ->> '_err' is null and (g ->> 'cost_remaining_thb')::numeric = 15600.67 and (g ->> 'missing_price') = 'false'
    and (select count(*) from analytics.gem_item_price where gem_item_id = iPx) = 3 and (c ->> 'today_bkk') = today::text);
  -- QC2: session TimeZone ต่างไทยจน current_date ≠ วันไทย — ต้นทุนต้องยังใช้วันไทย (ถ้าใช้ current_date: Pago_Pago = เมื่อวาน → ราคาเก่า · Kiritimati = พรุ่งนี้ → ราคาพรุ่งนี้)
  tz_old := current_setting('TimeZone');
  tz_new := case when extract(hour from (now() at time zone 'Asia/Bangkok')) < 17 then 'Pacific/Pago_Pago' else 'Pacific/Kiritimati' end;
  perform set_config('TimeZone', tz_new, true);
  d_cur := current_date;
  c2 := pg_temp.cs(a);
  perform set_config('TimeZone', tz_old, true);
  v := v || pg_temp.chk('QC2a', 'precondition: ใน session TimeZone=' || tz_new || ' current_date (' || d_cur::text || ') ต่างจากวันไทย (' || today::text || ') — ไม่งั้น QC2 ไม่มีความหมาย', d_cur <> today);
  v := v || pg_temp.chk('QC2', '🔴 session TimeZone=' || tz_new || ' (current_date ≠ วันไทย): ต้นทุนยัง 15600.67 และ today_bkk = วันไทย (ไม่ใช้ current_date ของ session/UTC)',
    c2 ->> '_err' is null and (pg_temp.cgrp(c2, iPx) ->> 'cost_remaining_thb')::numeric = 15600.67 and (c2 ->> 'today_bkk') = today::text);

  -- QC3: ยอดคี่ 3.335 × 7 = 23.345 → ปัดต่อกลุ่ม 23.35 · สองกลุ่ม = 46.70 (ปัดผลรวมดิบ = 46.69 ซึ่งต้องไม่ใช่ค่าที่รายงาน) · totals = Σ แถวเป๊ะ
  jo := pg_temp.newjob(a, pg_temp.fx('pA2'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iO1, 1), pg_temp.ln(iO2, 1)), 7, 6);
  c := pg_temp.cs(a);
  g1 := pg_temp.cgrp(c, iO1); g2 := pg_temp.cgrp(c, iO2);
  select coalesce(sum((x ->> 'cost_remaining_thb')::numeric), 0) into sumg from jsonb_array_elements(c -> 'groups') x where (x ->> 'cost_remaining_thb') is not null;
  v := v || pg_temp.chk('QC3', '🔴 ยอดคี่: 7 × 3.335 = 23.345 → แต่ละกลุ่ม 23.35 (ปัดขึ้น) · สองกลุ่มรวม 46.70 (≠ ปัดผลรวมดิบ 46.69) · totals.cost_remaining_thb = Σ แถวที่แสดงเป๊ะ',
    (g1 ->> 'cost_remaining_thb')::numeric = 23.35 and (g2 ->> 'cost_remaining_thb')::numeric = 23.35
    and (g1 ->> 'cost_remaining_thb')::numeric + (g2 ->> 'cost_remaining_thb')::numeric = 46.70 and round(2 * 7 * 3.335, 2) = 46.70 - 0.01
    and (c -> 'totals' ->> 'cost_remaining_thb')::numeric = sumg);
  -- QC3b: กลุ่มเดียว (iO1) 14 เม็ด = 46.69 · ติ๊กใบแรก (7) → สั่งแล้ว 23.35 + เหลือ 23.35 = 46.70 (INFO: ผลบวกสองส่วนอาจต่างจากยอดเต็ม 0.01 — จอแท็บ "สั่งแล้ว" ไม่มีคอลัมน์ต้นทุน ตาม UX 4.7)
  jo2 := pg_temp.newjob(a, pg_temp.fx('pA3'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iO1, 1)), 7, 6);
  c := pg_temp.cs(a); g1 := pg_temp.cgrp(c, iO1); full_cost := (g1 ->> 'cost_remaining_thb')::numeric;
  r := pg_temp.mk(a, array[pg_temp.lid(jo, iO1)], true);
  c2 := pg_temp.cs(a); g2 := pg_temp.cgrp(c2, iO1);
  v := v || pg_temp.chk('QC3b', 'กลุ่ม iO1 (14 เม็ด × 3.335): ก่อนติ๊กต้นทุน 46.69 · หลังติ๊กใบแรก: สั่งแล้ว 7 = 23.35 · เหลือ 7 = 23.35 (แต่ละส่วนปัดของตัวเองที่ DB)',
    full_cost = 46.69 and (g2 ->> 'cost_ordered_thb')::numeric = 23.35 and (g2 ->> 'cost_remaining_thb')::numeric = 23.35);
  v := v || pg_temp.info('QC3b', format('ผลบวกส่วนสั่งแล้ว+ส่วนเหลือ = %s เทียบยอดเต็มก่อนติ๊ก %s (ต่าง %s บาท) — สังเกตเท่านั้น: ถ้าจอแสดงทั้งสองส่วนคู่กันแล้วให้ผู้ใช้บวกเอง จะต่าง 0.01',
    (g2 ->> 'cost_ordered_thb')::numeric + (g2 ->> 'cost_remaining_thb')::numeric, full_cost, (g2 ->> 'cost_ordered_thb')::numeric + (g2 ->> 'cost_remaining_thb')::numeric - full_cost));

  -- QC4: snapshot ไม่มีราคาแต่ canonical มี — ต้องไม่ยืมราคา canonical · iMc (ไม่มีราคา) ถูกรวมเข้า iMd (80) · ใบ jmc ใช้ iMc 4 เม็ด · ใบ jmd ใช้ iMd 5 เม็ด
  jmc := pg_temp.newjob(a, pg_temp.fx('pA4'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iMc, 1)), 4, 6);
  jmd := pg_temp.newjob(a, pg_temp.fx('pA5'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iMd, 1)), 5, 6);
  c := pg_temp.cs(a);
  v := v || pg_temp.chk('QC4a', 'ก่อนรวมชื่อ: iMc ไม่มีราคา = null + missing_price · iMd 5 × 80 = 400.00',
    (pg_temp.cgrp(c, iMc) -> 'cost_remaining_thb') = 'null'::jsonb and (pg_temp.cgrp(c, iMc) ->> 'missing_price') = 'true' and (pg_temp.cgrp(c, iMd) ->> 'cost_remaining_thb')::numeric = 400.00);
  r := pg_temp.mrg(a, 'type', pg_temp.fx('tiMc'), pg_temp.fx('tiMd'));
  sm := pg_temp.sm(a);
  c := pg_temp.cs(a);
  gd := pg_temp.cgrp(c, iMd);
  v := v || pg_temp.chk('QC4', '🔴 หลังรวม iMc→iMd: กลุ่ม canonical iMd = 9 เม็ด 2 ใบ · ต้นทุนส่วนเหลือ = null + missing_price (แถว iMc ใน snapshot ไม่มีราคา — ห้ามยืม 80 ของ canonical มาคิด 9 × 80 = 720 และห้ามเป็น 400 โดยไม่บอก) · complete = false',
    r ->> '_err' is null and (pg_temp.grp(sm, iMd) ->> 'qty_needed_now') = '9' and (pg_temp.grp(sm, iMd) ->> 'job_count') = '2' and pg_temp.grp(sm, iMc) is null
    and (gd -> 'cost_remaining_thb') = 'null'::jsonb and (gd ->> 'missing_price_remaining') = 'true' and (gd ->> 'missing_price') = 'true' and (c -> 'totals' ->> 'complete') = 'false');
  -- ติ๊กใบ jmc (iMc 4 เม็ด): ส่วนเหลือ = เฉพาะ iMd 5 × 80 = 400.00 (ราคาครบ) · ส่วนสั่งแล้ว = null + missing_price_ordered (snapshot iMc ไม่มีราคา)
  r := pg_temp.mk(a, array[pg_temp.lid(jmc, iMc)], true);
  c := pg_temp.cs(a);
  gd := pg_temp.cgrp(c, iMd);
  v := v || pg_temp.chk('QC4b', 'ติ๊กใบ jmc (iMc 4 เม็ด): ส่วนเหลือ (เฉพาะ iMd 5 เม็ด) = 400.00 ราคาครบ · ส่วนสั่งแล้ว = null + missing_price_ordered (ไม่ใช่ 4 × 80 = 320) — แยกส่วนถูก',
    (r ->> 'changed') = '1' and (gd ->> 'cost_remaining_thb')::numeric = 400.00 and (gd ->> 'missing_price_remaining') = 'false'
    and (gd -> 'cost_ordered_thb') = 'null'::jsonb and (gd ->> 'missing_price_ordered') = 'true' and (gd ->> 'qty_ordered') = '4' and (gd ->> 'qty_remaining') = '5');
  return v;
end;
$c$;

-- ============================================================================
-- QW3. ผู้จัดการ QR (W3) เปิดใบพร้อมพลอย → ติ๊กที่ออฟฟิศ → W3 job_worker_gem_set แก้พลอย (คงติ๊ก · ลบ/เพิ่มกลับ → removed_after_order) · ไม่รั่วคีย์ติ๊กไปทางช่าง
-- ============================================================================
create function pg_temp.q_w3() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A'); iW uuid := pg_temp.fx('iW'); tW uuid := pg_temp.fx('tiW'); rnd uuid := pg_temp.fx('rnd');
  w jsonb; r jsonb; sess jsonb; tokh text; sh text; wid uuid; j uuid; l uuid; l2 uuid; g jsonb; g2 jsonb; r2 jsonb; r3 jsonb; s jsonb; gr jsonb; gl_ jsonb; n_rm int; ok boolean;
begin
  -- fixture: ผู้จัดการ (can_open_job) + QR ร้าน + PIN session + เปิดใบพร้อมพลอย 2 เม็ดต่อชิ้น
  begin
    w := pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_id=>%L, p_display_name=>%L, p_stage_codes=>%L::text[], p_pin=>%L, p_actor=>%L, p_can_open_job=>%L, p_can_external=>%L)',
      a, null, 'ZZ-QA ผู้จัดการ', '{qc}', '2468', pg_temp.nom(), true, false));
    if w ? '_err' or w ->> 'id' is null then raise exception 'worker_upsert: %', w::text; end if;
    wid := (w ->> 'id')::uuid;
    r := analytics.shop_intake_token_issue(a, pg_temp.nom());
    tokh := analytics.job_sha256_hex(r ->> 'token');
    sess := pg_temp.q(format('select analytics.worker_pin_verify_intake(%L, %L, %L, %L, null)', tokh, wid, '2468', 'verify-qa/1.0'));
    if sess ->> 'ok' is distinct from 'true' then raise exception 'worker_pin_verify_intake: %', sess::text; end if;
    sh := analytics.job_sha256_hex(sess ->> 'session_token');
    gl_ := jsonb_build_array(jsonb_build_object('type_id', tW, 'shape_id', rnd, 'size_a', 6.5, 'qty_per_piece', 2));
    r := pg_temp.q(format('select analytics.job_worker_open(p_token_hash=>%L, p_session_hash=>%L, p_idem_key=>%L, p_product_id=>%L, p_pending_label=>%L, p_metal=>%L, p_purity=>%L, p_weight_g=>%L, p_qty_order=>%L, p_qty_planned=>%L, p_due_date=>%L, p_is_new_design=>%L, p_note=>%L, p_user_agent=>%L, p_ip_hash=>%L, p_gem_lines=>%L::jsonb, p_gem_answer=>%L, p_gem_force=>%L::jsonb)',
      tokh, sh, 'ik' || replace(gen_random_uuid()::text, '-', ''), null, 'แหวน QA W3', 'silver', null, null, 2, null, null, null, null, 'verify-qa/1.0', null, gl_, 'has', null));
    if r ->> 'ok' is distinct from 'true' then raise exception 'job_worker_open: %', r::text; end if;
    select id into j from analytics.job where shop_id = a and job_no = r ->> 'job_no';
    l := pg_temp.lid(j, iW);
    if j is null or l is null then raise exception 'เปิดใบแล้วไม่พบใบ/แถวพลอย (job_no=%)', r ->> 'job_no'; end if;
  exception when others then
    return v || pg_temp.skip('QW3', 'fixture W3 สร้างไม่ได้ (' || sqlerrm || ') — เคส W3 ทั้งกลุ่มไม่ได้ทดสอบ');
  end;
  s := pg_temp.sm(a);
  v := v || pg_temp.chk('QW3a', 'ใบที่ผู้จัดการเปิดผ่าน QR (ขั้นฝัง pending · พลอย 2/ชิ้น × 2 ชิ้น = 4) โผล่ในสรุป · ออฟฟิศติ๊กได้ (changed 1 · ordered_qty 4)',
    pg_temp.in_sm(s, j) and (pg_temp.grp(s, iW) ->> 'qty_needed_now') = '4');
  r2 := pg_temp.mk(a, array[l], true);
  g := pg_temp.q(format('select analytics.job_worker_gem_get(%L, %L, %L, %L)', tokh, sh, j, null));
  v := v || pg_temp.chk('QW3b', '🔴 W3 job_worker_gem_get หลังติ๊ก: ok · มี rev · ไม่มีคีย์ติ๊ก/ยอดสั่ง/removed_after_order (ผู้จัดการไม่เห็นสถานะสั่งซื้อ) · ไม่มีคีย์ราคา',
    (r2 ->> 'changed') = '1' and g ->> 'ok' = 'true' and g ->> 'rev' is not null and pg_temp.purchase_keys(g) = '' and pg_temp.badkeys(g) = '' and not pg_temp.has_px(g));
  -- แก้พลอยเป็น 3/ชิ้น ผ่าน W3: แถวเดิมคง id · ติ๊กคง (ordered_qty 4) · ต้องใช้ 6 เหลือ 2 changed_after_order
  r3 := pg_temp.q(format('select analytics.job_worker_gem_set(%L, %L, %L, %L::jsonb, %L, %L::jsonb, %L)', tokh, sh, j,
    jsonb_build_array(jsonb_build_object('type_id', tW, 'shape_id', rnd, 'size_a', 6.5, 'qty_per_piece', 3)), g ->> 'rev', null, null));
  s := pg_temp.sm(a); gr := pg_temp.grp(s, iW);
  v := v || pg_temp.chk('QW3c', '🔴 W3 job_worker_gem_set หลังมีติ๊ก (ต้องไม่พัง): ok · แถวเดิมคง id · ติ๊กคง (ordered_qty 4 · ordered_by = ผู้ติ๊ก) · ต้องใช้ 6 สั่งแล้ว 4 เหลือ 2 · changed_after_order = true · ผลของ W3 ไม่มีคีย์ติ๊ก/ราคา',
    r3 ->> 'ok' = 'true' and pg_temp.lid(j, iW) = l and (select ordered_qty from analytics.job_gem_bom where id = l) = 4 and (select ordered_by from analytics.job_gem_bom where id = l) = pg_temp.own()
    and (pg_temp.gjob(gr, j) ->> 'qty_needed_now') = '6' and (pg_temp.gjob(gr, j) ->> 'qty_ordered') = '4' and (pg_temp.gjob(gr, j) ->> 'qty_remaining') = '2' and (pg_temp.gjob(gr, j) ->> 'changed_after_order') = 'true'
    and pg_temp.purchase_keys(r3) = '' and pg_temp.badkeys(r3) = '' and not pg_temp.has_px(r3));
  -- ลบพลอยทั้งหมดผ่าน W3 (แถวที่ติ๊กไว้ถูกลบ) → log line_removed · ใบโผล่ทั้ง unspecified_jobs และ removed_after_order
  g2 := pg_temp.q(format('select analytics.job_worker_gem_get(%L, %L, %L, %L)', tokh, sh, j, null));
  n_rm := pg_temp.nlog(a, 'line_removed');
  r3 := pg_temp.q(format('select analytics.job_worker_gem_set(%L, %L, %L, %L::jsonb, %L, %L::jsonb, %L)', tokh, sh, j, '[]', g2 ->> 'rev', null, null));
  s := pg_temp.sm(a);
  v := v || pg_temp.chk('QW3d', '🔴 W3 ลบพลอยทั้งหมดของใบที่ติ๊กไว้: ok · log line_removed +1 (qty 4) · ใบโผล่ใน unspecified_jobs (ขั้นฝัง pending ไม่มีแถว) และ removed_after_order (เตือนสั่งซ้ำ) · ไม่มีคีย์ราคา',
    r3 ->> 'ok' = 'true' and pg_temp.lid(j, iW) is null and pg_temp.nlog(a, 'line_removed') = n_rm + 1
    and exists (select 1 from analytics.gem_purchase_mark_log where job_id = j and action = 'line_removed' and qty = 4 and actor is null)
    and pg_temp.in_unspec(s, j) and pg_temp.in_removed(s, j) and pg_temp.badkeys(s) = '' and not pg_temp.has_px(s));
  -- เพิ่มกลับผ่าน W3 (แถวใหม่ไม่มีติ๊ก) → ยังเตือน removed_after_order · ติ๊กแถวใหม่แล้วคำเตือนหาย
  g2 := pg_temp.q(format('select analytics.job_worker_gem_get(%L, %L, %L, %L)', tokh, sh, j, null));
  r3 := pg_temp.q(format('select analytics.job_worker_gem_set(%L, %L, %L, %L::jsonb, %L, %L::jsonb, %L)', tokh, sh, j, gl_, g2 ->> 'rev', null, null));
  l2 := pg_temp.lid(j, iW);
  s := pg_temp.sm(a);
  ok := r3 ->> 'ok' = 'true' and l2 is not null and l2 <> l and not pg_temp.ticked(l2) and pg_temp.in_removed(s, j) and not pg_temp.in_unspec(s, j) and (pg_temp.grp(s, iW) ->> 'qty_remaining') = '4';
  r2 := pg_temp.mk(a, array[l2], true);
  s := pg_temp.sm(a);
  v := v || pg_temp.chk('QW3e', '🔴 W3 เพิ่มพลอยกลับ: แถวใหม่ (id ใหม่) ไม่มีติ๊ก · ยังโผล่ removed_after_order · ไม่ใช่ unspecified แล้ว · เหลือ 4 → ติ๊กแถวใหม่แล้วคำเตือนหาย',
    ok and (r2 ->> 'changed') = '1' and not pg_temp.in_removed(s, j));
  return v;
end;
$c$;

-- ============================================================================
-- QL. ส่วนย่อยของล็อต (parent_job_id) ไม่นับซ้ำ · QST. ใบไม่มีขั้นฝัง/ไม่มีพลอย
-- ============================================================================
create function pg_temp.q_lot() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A'); iT3 uuid := pg_temp.fx('iT3');
  j uuid; l uuid; sq int; hold int; r jsonb; child uuid; s jsonb; g jsonb; pl_before int; pl_after int; pc int; n_bom int; ok boolean; r2 jsonb;
begin
  j := pg_temp.newjob(a, pg_temp.fx('pA1'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iT3, 2)), 6, 4);
  l := pg_temp.lid(j, iT3);
  r2 := pg_temp.mk(a, array[l], true);
  select qty_planned into pl_before from analytics.job where id = j;
  begin
    perform pg_temp.step(a, j, false);
    select s2.seq, s2.qty_in - s2.qty_scrap - s2.qty_split_out into sq, hold from analytics.job_stage s2 where s2.job_id = j and s2.status = 'received' order by s2.seq limit 1;
    r := pg_temp.q(format('select analytics.job_lot_split(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_qty=>%L, p_qty_scrap=>%L, p_scrap_reason=>null, p_qty_hold=>%L, p_actor=>%L, p_weight_move_g=>null)',
      a, j, sq, 2, 0, hold, pg_temp.nom()));
    if r ? '_err' or r ->> 'ok' = 'false' then raise exception 'job_lot_split: %', r::text; end if;
    select id into child from analytics.job where parent_job_id = j limit 1;
    if child is null then raise exception 'แยกส่วนแล้วไม่พบส่วนย่อย'; end if;
  exception when others then
    return v || pg_temp.skip('QL', 'fixture แบ่งล็อตสร้างไม่ได้ (' || sqlerrm || ') — เคสส่วนย่อยไม่ได้ทดสอบ');
  end;
  select qty_planned into pl_after from analytics.job where id = j;
  select qty_planned into pc from analytics.job where id = child;
  select count(*) into n_bom from analytics.job_gem_bom where job_id = child;
  s := pg_temp.sm(a); g := pg_temp.grp(s, iT3);
  ok := pg_temp.in_sm(s, j) and not pg_temp.in_sm(s, child) and n_bom = 0 and (g ->> 'job_count') = '1' and jsonb_array_length(g -> 'jobs') = 1;
  v := v || pg_temp.chk('QL1', '🔴 แบ่งล็อต (แม่ 6 → ส่วนย่อย ' || pc || '): ส่วนย่อยไม่มี BOM · ไม่โผล่ในสรุป · แม่โผล่ใบเดียว (job_count 1) · ยอดต้องใช้ = 2/ชิ้น × qty_planned ของแม่ (' || pl_after || ') ไม่เปลี่ยนจากก่อนแบ่ง (' || pl_before || ') · ไม่นับซ้ำแม่+ส่วนย่อย',
    ok and pl_after = pl_before and (g ->> 'qty_needed_now')::int = 2 * pl_after and (pg_temp.gjob(g, j) ->> 'qty_ordered')::int = 2 * pl_before);
  v := v || pg_temp.chk('QL1b', 'ส่วนย่อยติ๊กตรงไม่ได้: gem_purchase_mark ด้วย line_id ของแม่ยังทำได้ตามปกติ (unchanged) · ไม่มีแถวพลอยของส่วนย่อยให้ติ๊ก',
    (pg_temp.mk(a, array[l], true) ->> 'unchanged') = '1');
  -- QL2: ส่วนย่อยเดินไปรับขั้นฝังก่อน → แม่หายจากรายการทั้งใบ (ตามนิยามต้นไม้ · ตรง job_gem_bom_get 'started') — ยืนยันพฤติกรรมจริง
  begin
    perform pg_temp.send_cur(a, child);
    perform pg_temp.walk_to(a, child, 'gem_set');
    perform pg_temp.step(a, child, false);
    s := pg_temp.sm(a);
    v := v || pg_temp.chk('QL2', 'ส่วนย่อยรับขั้นฝังแล้ว (แม่ยังมีขั้นฝัง pending): แม่หายจากรายการทั้งใบ — ตรงนิยามต้นไม้ (job_gem_bom_get = started) · สถานะขั้นฝังของแม่ = ' || coalesce((select status from analytics.job_stage where job_id = j and stage_code = 'gem_set'), '?'),
      not pg_temp.in_sm(s, j) and (select status from analytics.job_stage where job_id = child and stage_code = 'gem_set') = 'received');
    v := v || pg_temp.info('QL2', 'ความเสี่ยงสินค้า: ส่วนย่อย 2 ชิ้นรับขั้นฝังแล้ว → แม่อีก ' || (pl_after - pc) || ' ชิ้นที่ยังไม่ถึงขั้นฝัง หายจาก "พลอยที่ต้องสั่ง" ทั้งก้อน (ผู้สั่งซื้อจะไม่เห็นว่ายังต้องใช้พลอยของอีก ' || (pl_after - pc) || ' ชิ้น) — เป็นข้อจำกัดที่ backend-dev บันทึกไว้แล้ว ไม่ใช่บั๊กของโค้ด');
  exception when others then
    v := v || pg_temp.skip('QL2', 'เดินส่วนย่อยไปรับขั้นฝังไม่ได้ (' || sqlerrm || ')');
  end;
  return v;
end;
$c$;

create function pg_temp.q_stage() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A'); iT1 uuid := pg_temp.fx('iT1');
  jns uuid; jng uuid; jun uuid; s jsonb; ok boolean := true; n_before int; n_after int;
begin
  jns := pg_temp.newjob(a, pg_temp.fx('pA2'), pg_temp.std(), '[]'::jsonb, 2, 4);                       -- ไม่มีขั้นฝัง · ไม่มีพลอย
  jun := pg_temp.newjob(a, pg_temp.fx('pA4'), pg_temp.stdg(), '[]'::jsonb, 2, 4);                      -- มีขั้นฝัง · ไม่มีพลอย = unspecified
  begin
    jng := pg_temp.newjob(a, pg_temp.fx('pA3'), pg_temp.std(), jsonb_build_array(pg_temp.ln(iT1, 1)), 2, 4);   -- ไม่มีขั้นฝัง แต่มีแถวพลอย
  exception when others then
    jng := null;
    v := v || pg_temp.skip('QST-b', 'สร้างใบไม่มีขั้นฝังที่มีแถวพลอยไม่ได้ (' || sqlerrm || ')');
  end;
  s := pg_temp.sm(a);
  v := v || pg_temp.chk('QST-a', 'ใบไม่มีขั้นฝังและไม่มีพลอย: ไม่โผล่ทั้งกลุ่มและ unspecified_jobs (ไม่ใช่ "ยังไม่ระบุพลอย")',
    not pg_temp.in_sm(s, jns) and not pg_temp.in_unspec(s, jns));
  if jng is not null then
    v := v || pg_temp.chk('QST-b', 'ใบไม่มีขั้นฝังแต่มีแถวพลอย: ไม่โผล่ในกลุ่ม · ไม่ใช่ unspecified', not pg_temp.in_sm(s, jng) and not pg_temp.in_unspec(s, jng));
  end if;
  v := v || pg_temp.chk('QST-c', 'ใบมีขั้นฝัง pending แต่ไม่มีพลอย: อยู่ใน unspecified_jobs · totals.unspecified_jobs นับรวม · ไม่โผล่ในกลุ่ม',
    pg_temp.in_unspec(s, jun) and not pg_temp.in_sm(s, jun) and (s -> 'totals' ->> 'unspecified_jobs')::int >= 1);
  return v;
end;
$c$;

-- ============================================================================
-- QS. payload จริงจาก DB (ร้านสังเคราะห์) — พิมพ์ PAYLOAD_* ให้ดึงไปเป็น fixture ของเทสต์ mapper (lib/jobs/gem-purchase.dbshape.test.ts) · ตรวจไม่รั่วราคา
-- ============================================================================
create function pg_temp.q_shape() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A');
  iT1 uuid := pg_temp.fx('iT1'); iT3 uuid := pg_temp.fx('iT3'); iT4 uuid := pg_temp.fx('iT4'); iPx uuid := pg_temp.fx('iPx'); iMd uuid := pg_temp.fx('iMd');
  js1 uuid; js2 uuid; js3 uuid; jpx uuid; r jsonb; rm jsonb; s jsonb; c jsonb; raw jsonb;
begin
  -- js1: 2 รายการ — iT1 ติ๊กแล้วแก้เพิ่ม (changed_after_order) · iT4 ยังไม่ติ๊ก  · js2: ติ๊กแล้วลบพลอย (removed_after_order + unspecified) · js3: ไม่มีพลอย · jpx: มีราคา
  js1 := pg_temp.newjob(a, pg_temp.fx('pA1'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iT1, 2), pg_temp.ln(iT4, 1)), 3, 2);
  js2 := pg_temp.newjob(a, pg_temp.fx('pA2'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iT3, 1)), 2, 3);
  js3 := pg_temp.newjob(a, pg_temp.fx('pA3'), pg_temp.stdg(), '[]'::jsonb, 2, 6);
  jpx := pg_temp.newjob(a, pg_temp.fx('pA4'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iPx, 1)), 4, 5);
  perform pg_temp.mk(a, array[pg_temp.lid(js1, iT1), pg_temp.lid(js2, iT3)], true);
  perform pg_temp.bset(a, js1, jsonb_build_array(pg_temp.ln(iT1, 3), pg_temp.ln(iT4, 1)));
  perform pg_temp.bset(a, js2, '[]'::jsonb);
  rm := pg_temp.mk(a, array[pg_temp.lid(js1, iT4)], true);
  s := pg_temp.sm(a);
  c := pg_temp.cs(a);
  v := v || pg_temp.chk('QS1', 'payload จริง: สรุปมีกลุ่ม · ใบที่ติ๊ก+เปลี่ยนยอด (changed_after_order) · unspecified_jobs · removed_after_order · ต้นทุนมีกลุ่ม null ไม่มีราคา และกลุ่มมีราคา',
    s ->> '_err' is null and c ->> '_err' is null and rm ->> '_err' is null
    and (pg_temp.gjob(pg_temp.grp(s, iT1), js1) ->> 'changed_after_order') = 'true' and pg_temp.in_unspec(s, js3) and pg_temp.in_unspec(s, js2) and pg_temp.in_removed(s, js2)
    and (pg_temp.cgrp(c, iT1) -> 'cost_remaining_thb') = 'null'::jsonb and (pg_temp.cgrp(c, iPx) ->> 'cost_remaining_thb')::numeric = 20800.89);
  v := v || pg_temp.chk('QS2', '🔴 payload จริง: สรุป + ผลติ๊ก ไม่มีคีย์ราคา/ต้นทุน/ผู้ขาย (badkeys) และไม่มีเลขราคาที่ตั้งไว้ใน payload · ต้นทุนมีราคา (positive control)',
    pg_temp.badkeys(s) = '' and pg_temp.badkeys(rm) = '' and not pg_temp.has_px(s) and not pg_temp.has_px(rm) and pg_temp.badkeys(c) <> '' and position('20800.89' in c::text) > 0);
  -- แทนค่าผู้ใช้จริงที่ยืมมา (ordered_by) ก่อนพิมพ์ออกไปเป็น fixture
  v := v || 'PAYLOAD_SUMMARY=' || replace(replace(replace(s::text, pg_temp.own()::text, '99999999-9999-4999-8999-999999999991'), pg_temp.adm()::text, '99999999-9999-4999-8999-999999999992'), pg_temp.stf()::text, '99999999-9999-4999-8999-999999999993') || E'\n';
  v := v || 'PAYLOAD_MARK=' || replace(replace(replace(rm::text, pg_temp.own()::text, '99999999-9999-4999-8999-999999999991'), pg_temp.adm()::text, '99999999-9999-4999-8999-999999999992'), pg_temp.stf()::text, '99999999-9999-4999-8999-999999999993') || E'\n';
  v := v || 'PAYLOAD_COST=' || c::text || E'\n';
  return v;
end;
$c$;

create function pg_temp.q_run(p_grp text) returns text
 language plpgsql as $c$
begin
  return case p_grp
    when 'perm' then pg_temp.q_perm()
    when 'mark' then pg_temp.q_mark()
    when 'cost' then pg_temp.q_cost()
    when 'w3' then pg_temp.q_w3()
    when 'lot' then pg_temp.q_lot()
    when 'stage' then pg_temp.q_stage()
    when 'shape' then pg_temp.q_shape()
    else null end;
end;
$c$;

create function pg_temp.snap() returns text
 language plpgsql as $c$
declare v text := ''; t text; n text;
begin
  foreach t in array array['analytics.job', 'analytics.job_stage', 'analytics.job_event', 'analytics.job_token', 'analytics.job_counter', 'analytics.job_photo', 'analytics.worker', 'analytics.worker_session', 'analytics.worker_rate_limit',
    'analytics.production_order', 'analytics.production_order_item', 'analytics.production_order_counter', 'analytics.shop_intake_token', 'analytics.stock_lot', 'public.central_stock', 'public.product', 'public.shop', 'public.shop_member',
    'analytics.gem_shape', 'analytics.gem_type', 'analytics.gem_item', 'analytics.gem_item_price', 'analytics.gem_item_price_audit', 'analytics.gem_catalog_event', 'analytics.product_gem_bom', 'analytics.job_gem_bom', 'analytics.gem_purchase_mark_log', 'analytics.catalog_audit_log'] loop
    if to_regclass(t) is not null then
      execute format('select count(*)::text || ''/'' || coalesce(md5(string_agg(x::text, ''|'' order by x::text)), '''') from %s x', t) into n;
      v := v || t || '=' || n || ';';
    end if;
  end loop;
  return md5(v);
end;
$c$;

-- ============================================================================
-- mutant: ถอด/ย้อนด่านทีละตัวแล้วเทสต์ต้องล้มจริง (id ที่คาด) — กลุ่มที่เกี่ยวรันซ้ำใน sub-transaction ที่ถอยกลับ
--   step = [f, เป้าหมาย, ข้อความเดิม, ข้อความใหม่] · ไม่ล้ม = เทสต์ไม่ได้ป้องกันด่านนั้น
-- ============================================================================
create function pg_temp.q_mut() returns text
 language plpgsql as $c$
declare
  v text := ''; s text; k int; muts jsonb; m jsonb; st jsonb; hit int; i text; killed int := 0; total int;
  sg_mark constant text := 'analytics.gem_purchase_mark(uuid,uuid[],boolean,uuid)';
  sg_cost constant text := 'analytics.gem_purchase_summary_cost(uuid,uuid)';
begin
  muts := jsonb_build_array(
    jsonb_build_object('id', 'QM1', 'grp', 'cost', 'what', '🔴 ต้นทุนใช้ current_date ของ session แทนวันไทย (job_today)', 'steps', jsonb_build_array(jsonb_build_array(sg_cost, 'v_today date := analytics.job_today();', 'v_today date := current_date;')), 'expect', jsonb_build_array('QC2')),
    jsonb_build_object('id', 'QM2', 'grp', 'mark', 'what', 'ติ๊กไม่ dedupe line_ids (ซ้ำ = นับ found ไม่ตรง)', 'steps', jsonb_build_array(jsonb_build_array(sg_mark, 'select array_agg(distinct x) into v_ids from unnest(p_line_ids) as x;', 'select array_agg(x) into v_ids from unnest(p_line_ids) as x;')), 'expect', jsonb_build_array('QF6a', 'QF6b')),
    jsonb_build_object('id', 'QM3', 'grp', 'cost', 'what', 'ปัดเศษเป็นตัดทิ้ง (trunc) แทน round — ยอดคี่ 23.345 ได้ 23.34', 'steps', jsonb_build_array(jsonb_build_array(sg_cost, 'round(coalesce(g.raw_remaining, 0), 2)', 'trunc(coalesce(g.raw_remaining, 0), 2)')), 'expect', jsonb_build_array('QC3')),
    jsonb_build_object('id', 'QM4', 'grp', 'cost', 'what', '🔴 ต้นทุนใช้ราคา canonical แทน snapshot (ยืมราคา iMd มาคิดแถว iMc ที่ไม่มีราคา)', 'steps', jsonb_build_array(jsonb_build_array(sg_cost, 'where p.gem_item_id = l.snapshot_item_id', 'where p.gem_item_id = l.canonical_item_id')), 'expect', jsonb_build_array('QC4', 'QC4b')),
    jsonb_build_object('id', 'QM5', 'grp', 'mark', 'what', '🔴 ติ๊กไม่ตรวจขั้นฝังรับแล้ว (ชุดผสมแถวดี+แถวขั้นฝังรับแล้ว ผ่านทั้งชุด/ครึ่งทาง)', 'steps', jsonb_build_array(jsonb_build_array(sg_mark, 'and not exists (select 1 from analytics.v_gem_purchase_line l where l.line_id = g.id);', 'and false;')), 'expect', jsonb_build_array('QF1', 'QF5', 'QF9b')),
    jsonb_build_object('id', 'QM6', 'grp', 'mark', 'what', '🔴 ติ๊ก/ยกเลิกติ๊กไม่ตรวจใบ done/cancelled (hint ผิด)', 'steps', jsonb_build_array(jsonb_build_array(sg_mark, 'where g.id = any (v_ids) and j.status in (''done'', ''cancelled'');', 'where g.id = any (v_ids) and false;')), 'expect', jsonb_build_array('QF9', 'QF4')));
  total := jsonb_array_length(muts);
  for k in 0 .. total - 1 loop
    m := muts -> k; s := '';
    begin
      for st in select value from jsonb_array_elements(m -> 'steps') loop
        perform pg_temp.mutate(st ->> 0, st ->> 1, st ->> 2);
      end loop;
      s := pg_temp.q_run(m ->> 'grp');
      raise exception 'MX_ROLLBACK';
    exception when others then
      if sqlerrm <> 'MX_ROLLBACK' then s := s || '[FAIL] MX-crash-' || (m ->> 'id') || '  ' || sqlerrm || E'\n'; end if;
    end;
    hit := 0;
    for i in select jsonb_array_elements_text(m -> 'expect') loop
      if position('[FAIL] ' || i || ' ' in s) > 0 then hit := hit + 1; end if;
    end loop;
    if hit = jsonb_array_length(m -> 'expect') then
      killed := killed + 1; v := v || format('[OK] %s  mutant ถูกจับ (%s/%s id): %s', m ->> 'id', hit, jsonb_array_length(m -> 'expect'), m ->> 'what') || E'\n';
    else
      v := v || format('[FAIL] %s  mutant รอด (จับได้ %s/%s id ที่คาด): %s%s', m ->> 'id', hit, jsonb_array_length(m -> 'expect'), m ->> 'what',
        case when position('MX-crash-' || (m ->> 'id') in s) > 0 then ' · ' || substr(s, position('MX-crash-' || (m ->> 'id') in s), 200) else '' end) || E'\n';
    end if;
  end loop;
  v := v || pg_temp.chk('QMX', format('mutant ถูกจับครบ %s/%s', killed, total), killed = total);
  return v;
end;
$c$;

-- ============================================================================
-- runner
-- ============================================================================
do $vq$
declare
  v_msg text := E'\n=== verify 0192 QA ===\n';
  v_snap0 text; v_hit int; v_fail int; v_ok int; v_skip int; v_info int; v_ctx text; s text; grp text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  create temp table _vq_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h, p.proacl::text as acl
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p');
  v_snap0 := pg_temp.snap();
  begin
    v_msg := v_msg || pg_temp.q_setup();
    foreach grp in array array['perm', 'mark', 'cost', 'w3', 'lot', 'stage', 'shape'] loop
      s := '';
      begin
        s := pg_temp.q_run(grp);
        raise exception 'QRB';
      exception when others then
        if sqlerrm <> 'QRB' then
          get stacked diagnostics v_ctx = pg_exception_context;
          s := coalesce(s, '') || format('[FAIL] %s-crash  กลุ่มนี้ raise นอกเทสต์: %s %s | %s', grp, sqlstate, sqlerrm, left(replace(v_ctx, E'\n', ' <- '), 500)) || E'\n';
        end if;
      end;
      v_msg := v_msg || coalesce(s, '');
    end loop;
    v_msg := v_msg || pg_temp.q_mut();
    select count(*) into v_hit from _vq_orig o join pg_proc p on p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p') and p.oid::regprocedure::text = o.sig
     where md5(pg_get_functiondef(p.oid)) = o.h and p.proacl::text is not distinct from o.acl;
    v_msg := v_msg || pg_temp.chk('QMY', format('หลัง mutant: md5 นิยาม + สิทธิ์ของฟังก์ชันทุกตัวในสคีมา analytics (%s ตัว) เท่าเดิมเป๊ะ', (select count(*) from _vq_orig)),
      v_hit = (select count(*) from _vq_orig) and (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and prokind in ('f', 'p')) = (select count(*) from _vq_orig));
    raise exception 'VQ_ROLLBACK';
  exception when others then
    get stacked diagnostics v_ctx = pg_exception_context;
    if sqlerrm <> 'VQ_ROLLBACK' then v_msg := v_msg || format('[FAIL] QS-crash  ชุดหลัก raise นอกกลุ่ม: %s %s | %s', sqlstate, sqlerrm, left(replace(v_ctx, E'\n', ' <- '), 600)) || E'\n'; end if;
  end;
  v_msg := v_msg || pg_temp.chk('QK0', 'ชุดทดสอบไม่ทิ้งรอย: snapshot (job/ใบผลิต/ตัวนับ/QR/ช่าง/session/product/shop/สมาชิก/ตารางพลอยทั้งหมด/log การติ๊ก/audit) เท่าเดิมหลังถอยกลับ', pg_temp.snap() = v_snap0);
  v_fail := (length(v_msg) - length(replace(v_msg, '[FAIL]', ''))) / length('[FAIL]');
  v_skip := (length(v_msg) - length(replace(v_msg, '[SKIP]', ''))) / length('[SKIP]');
  v_ok := (length(v_msg) - length(replace(v_msg, '[OK]', ''))) / length('[OK]');
  v_info := (length(v_msg) - length(replace(v_msg, '[INFO]', ''))) / length('[INFO]');
  v_msg := v_msg || format(E'\n--- สรุป QA: OK %s · FAIL %s · SKIP %s · INFO %s ---', v_ok, v_fail, v_skip, v_info);
  raise exception '%', v_msg;
end;
$vq$;

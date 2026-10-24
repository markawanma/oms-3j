-- scripts/verify/verify-0192.sql
-- ตรวจ supabase/migrations/0192_gems_to_buy_g1b.sql (G1b พลอยที่ต้องสั่งซื้อ: สรุปยอดข้ามใบที่ขั้นฝังยังไม่รับ + ติ๊ก "สั่งแล้ว" (เก็บจำนวน ณ ตอนติ๊ก) + ต้นทุนประมาณ owner/admin เท่านั้น)
-- self-rolling-back (3j-migration-traps ข้อ 11): ทุกเคสอยู่ในทรานแซกชันเดียว จบด้วย `raise exception` เสมอ ⇒ ถอยทั้งก้อน · อ่านผลจาก error message · exit 1 คือผลที่คาด · [FAIL] >= 1 = ไม่ผ่าน
-- ต้องมี 0172-0191 อยู่ใน DB แล้ว · dry-run: ต่อ 0192 + ไฟล์นี้ (ไฟล์ LF — ข้อ 20) เป็นไฟล์เดียวแล้วรันไม่ใส่ --commit · หลัง apply: รันไฟล์นี้เดี่ยวๆ ได้
-- 🔴 อย่ารันพร้อม agent/session อื่น (สร้างข้อมูลทดสอบจริงในทรานแซกชันที่ถอยกลับ + ล็อกแถวใบ/พลอยของร้านสังเคราะห์เท่านั้น — ไม่แตะร้านจริง ยกเว้น golden ไม่มีในไฟล์นี้)
-- ข้อมูลทดสอบ: ร้านสังเคราะห์ ZZ TEST verify-0192 A/B (insert public.shop + public.shop_member ตรง ตามแพทเทิร์น verify-0190 — ข้อยกเว้นเดียวที่ไม่ผ่าน RPC · ยืม auth user จริงเป็นสมาชิกร้านสังเคราะห์ในทรานแซกชันนี้เท่านั้น) ·
--   SKU/ใบผลิต/ใบงาน/ชนิด/รายการ/ราคา/พลอยในใบ/การติ๊ก สร้างผ่าน RPC ของระบบทั้งหมด · ราคาทดสอบใช้เลขแปลกที่ไม่ซ้ำกับค่าอื่นเพื่อ grep หาการรั่ว (7391.2468 · 9999.9999)
-- ⚠️ ไฟล์นี้เขียนโดยไม่ได้รันกับ DB จริง (worktree ของผู้เขียนไม่มี SUPABASE_DB_URL) — dry-run รอบแรกอาจเจอ FAIL/crash จากการเขียนเทสต์ผิด (ไม่ใช่ตัว migration) ต้องไล่ดูทีละ id
--
-- ============ ตารางแมป "ข้อในบรีฟ → เทสต์ที่ครอบ" (ข้อไหนไม่มีเทสต์ครอบ = เขียนว่า "ไม่มี" พร้อมเหตุผล) ============
--  เคสห้ามผ่าน
--   staff/anon/authenticated อ่าน/ติ๊ก (สรุป · ติ๊ก · ต้นทุน)
--        -> P1 P1c (staff · คนนอกร้าน · คนที่เป็นสมาชิกร้านอื่น: 42501 gem_actor_forbidden · actor ว่าง: actor_required) · P1b (admin ผ่าน — ต้องไม่พัง) · P2 (anon/authenticated ยิง RPC ทั้ง 3 ตัวด้วย null ตก 42501 — จำลองกำแพงสคีมาหลุด ข้อ 18.5) · P3 (วิว/ตาราง log service_role อ่านตรงไม่ได้ · แก้ ordered_* ตรงไม่ได้) · P4 (ไม่มี overload · pin search_path · EXECUTE) · mutant MU6
--   ร้านอื่น (IDOR line_ids)                                  -> F4 (ทั้งสองทิศ A→B และ B→A · state ไม่ขยับ) · mutant MU3
--   ใบปิด/ยกเลิก โผล่ในยอด หรือติ๊กได้                       -> A3 (ไม่โผล่: ใบ cancelled · ใบ done ถ้าสร้างได้) · F1 (ติ๊ก cancelled = job_closed) · F5 (ชุดผสมถูกปฏิเสธทั้งชุด) · P7 (UPDATE ตรงบนใบ cancelled ตก job_closed — กำแพงที่ตาราง) · mutant MU1 MU10
--   ใบที่ขั้นฝังรับแล้ว (received) โผล่/ติ๊กได้               -> A3 A4 (parity กับ gem_stage ของ job_gem_bom_get ทุกสถานะ none/pending/started/skipped) · F2 · mutant MU2 MU11
--   ใบที่ไม่มีขั้นฝัง / ขั้นฝัง skipped โผล่/ติ๊กได้            -> A3 A4 · F3 · mutant MU2
--   นับซ้ำแม่+ส่วนย่อย                                        -> ❌ ไม่มีเทสต์ SQL: ส่วนย่อยห้ามมี BOM (trigger job_gem_bom_guard ของ 0190 + view กรอง parent_job_id is null) แต่ชุดนี้ไม่มี fixture แบ่งล็อต (ต้องมีใบที่ช่างส่งต่อบางส่วน) · ไม่มี mutant
--   ยกเลิกแล้วสร้างใหม่นับซ้ำ (R8)                            -> A2 (ยอดรวมนับเฉพาะใบใหม่ ไม่นับใบ cancelled ที่ BOM ยังอยู่) A3 · mutant MU10
--   ราคาใน view/RPC ที่ไม่ใช่ cost                            -> L1 (สรุป + ผลติ๊ก ไม่มีคีย์ราคา และไม่มีเลขราคาจริง 7391.2468/9999.9999 ใน payload) L1b (positive control: ราคายังอยู่ทาง RPC ต้นทุน — เทสต์รั่วมีความหมาย) L2 (วิว/ตาราง log ไม่มีคอลัมน์ราคา) · mutant MU5
--   cost ใช้ canonical แทน snapshot                           -> C4 (รวมชื่อ A→B ราคาต่าง: ต้นทุน = Σ จำนวนต่อแถว × ราคา id ใน snapshot ของแถวนั้น) · mutant MU4
--   ไม่มีราคา = ตัวเลขเดา                                     -> C2 (null + missing_price · ไม่ใช่ 0) C3 (ราคาที่มีผลในอนาคตอย่างเดียว = ไม่มีราคา) C7 (ส่วนที่จำนวน 0 ไม่ต้องมีราคา — ต้องไม่พัง) · mutant MU7 MU8
--  ติ๊กสั่งแล้ว / UX H1-H8
--   H1 เก็บจำนวน ณ ตอนติ๊ก · ที่เหลือ/เกิน/changed_after_order  -> M1 M5a M5b M5c M5d (ใบแก้จำนวนต่อชิ้น/จำนวนเริ่มผลิตหลังติ๊ก — ติ๊กไม่ถูกล้าง ที่เหลือ = ส่วนต่าง)
--   H2 bulk all-or-nothing · idempotent · คืนสถานะสดของแถว       -> M2 (ซ้ำ = changed 0 ไม่มี log) M3 (ติ๊กทั้งกลุ่ม) M4 (undo = ตรงข้ามด้วยรายการเดิม) F5 F6 (input ผิดทุกแบบ) · mutant MU9
--   H3 ต่อใบ: job_no · design_label · due · qty · ordered_at/by · earliest_due -> A2 M1
--   H5 unspecified_jobs                                         -> A5
--   H6 server_now + today_bkk (เวลาไทยจาก DB)                    -> A6
--   H7 รหัสขั้นฝัง gem_set จริง + ใบที่มีขั้นฝังจริงต้องโผล่        -> A7 (ใบที่ gem_set pending โผล่) A4
--   H8 ตรวจ owner/admin ซ้ำที่ DB                                -> P1 P1b P1c
--   แก้พลอยใบภายหลัง (replace_core): แถวเดิมคง id → คงติ๊ก · แถวที่ติ๊กถูกลบ → log -> M6 M7
--   audit event (ทุกการติ๊ก/ยกเลิก/แถวถูกลบ · append-only)        -> M1 M4 M6 P8
--  ต้องไม่พัง
--   job_gem_bom_get / หน้าช่าง (resolve) / A5 ไม่มี key ติ๊ก       -> M8 M9 · แก้พลอยผ่าน job_gem_bom_set ตอนมีติ๊กยังใช้ได้ (M7)
--   verify-0190 / verify-0191 ผ่าน                                -> รันแยกต่อ 0192 (ดูสรุปส่งมอบ) — ไม่รวมในไฟล์นี้
--   ฟังก์ชันเดิมทุกตัว md5 เท่าเดิม                                -> post-check ของ migration (1) + MY ท้ายไฟล์นี้
-- ไม่มีเทสต์ครอบ (บอกตรงๆ):
--   · นับซ้ำแม่+ส่วนย่อย (ดูด้านบน) · ใบ on_hold (ไม่มี RPC ตั้งสถานะ — view รวมไว้ตามบรีฟแต่ไม่ได้ยิงจริง)
--   · การแข่งกันจริงของ 2 connection (2 คนติ๊กพร้อมกัน · ติ๊กชนกับช่างรับขั้นฝัง · ติ๊กชนกับออฟฟิศแก้พลอย) — do-block เป็น connection เดียว · พิสูจน์ได้เฉพาะโครงสร้าง (ล็อก job share → แถวพลอย for update ลำดับเดียวกับ replace_core)
--   · เวลาไทย 00:00-07:00: today_bkk/ราคา ณ วันนี้ใช้ analytics.job_today() — ไม่ได้จำลองนาฬิกา (A6 เทียบกับ job_today() และวันไทยจาก now() เท่านั้น)
--   · ผู้ใช้ owner/admin จริงของระบบ (ยืมเป็นสมาชิกร้านสังเคราะห์) — ไม่ได้ทดสอบ JWT ของผู้ใช้จริง · หน้าเว็บ/คัดลอกข้อความ/ใบพิมพ์ = TS/UI ไม่ใช่ SQL

set local statement_timeout = '30min';

create temp table _v192_fx (k text primary key, id uuid not null) on commit drop;
create temp table _v192_kv (k text primary key, v text not null) on commit drop;

create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text
 language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n'
$c$;
create function pg_temp.skip(p_id text, p_desc text) returns text language sql as $c$ select format('[SKIP] %s  %s', p_id, p_desc) || E'\n' $c$;
create function pg_temp.fx(p_k text) returns uuid language sql as $c$ select id from _v192_fx where k = p_k $c$;
create function pg_temp.setfx(p_k text, p_id uuid) returns void language sql as $c$
  insert into _v192_fx (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id $c$;
create function pg_temp.kv(p_k text) returns text language sql as $c$ select v from _v192_kv where k = p_k $c$;
create function pg_temp.setkv(p_k text, p_v text) returns void language sql as $c$
  insert into _v192_kv (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $c$;
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
create function pg_temp.asrole(p_role text, p_sql text) returns text
 language plpgsql as $c$
declare v_state text;
begin
  execute format('set local role %I', p_role);
  execute p_sql;
  reset role;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  reset role;
  return v_state;
end;
$c$;
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
-- mutant ของ view: regexp บน pg_get_viewdef (รูปแบบ pretty ของ Postgres) — ไม่เจอ = raise
create function pg_temp.mutate_view(p_view text, p_re text, p_to text) returns void
 language plpgsql as $c$
declare v_def text; v_new text;
begin
  v_def := pg_get_viewdef(p_view::regclass, true);
  v_new := regexp_replace(v_def, p_re, p_to);
  if v_new = v_def then raise exception 'MUTANT_NOT_APPLIED: view % : %', p_view, left(p_re, 80); end if;
  execute format('create or replace view %s as %s', p_view, v_new);
end;
$c$;
-- key ทุกระดับของ jsonb (ตรวจว่าผลไม่มี key เงิน/ต้นทุน)
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
-- เลขราคา ≥ 1,000 ที่ตั้งไว้ในตารางราคา (เลขแปลก) โผล่ใน payload ไหม
create function pg_temp.has_px(j jsonb) returns boolean language sql as $c$
  select exists (select 1 from analytics.gem_item_price p where p.price_thb_per_unit >= 1000 and position(trim_scale(p.price_thb_per_unit)::text in coalesce(j::text, '')) > 0)
      or exists (select 1 from analytics.gem_item_price_audit a where a.new_price >= 1000 and position(trim_scale(a.new_price)::text in coalesce(j::text, '')) > 0) $c$;
create function pg_temp.std() returns text language sql as $c$ select '{wax_inject,wax_tree,invest_burnout,cast,cut_sprue,finish,buff,qc,pack}' $c$;
create function pg_temp.stdg() returns text language sql as $c$ select '{wax_inject,wax_tree,invest_burnout,cast,cut_sprue,finish,buff,gem_set,qc,pack}' $c$;

-- ============================================================================
-- helper ตัวช่วย (เรียก RPC ของระบบ · named args ตรงกับ migration)
-- ============================================================================
create function pg_temp.shp(p_shop uuid, p_name text) returns uuid language sql as $c$ select id from analytics.gem_shape where shop_id = p_shop and name = p_name $c$;
create function pg_temp.ccreate(p_shop uuid, p_name text, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_catalog_create(%L, %L, %L, %L, %L, %L)', p_shop, coalesce(p_actor, pg_temp.own()), 'type', p_name, null, true)) $c$;
create function pg_temp.icreate(p_shop uuid, p_line jsonb, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_item_create(%L, %L, %L::jsonb, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_line, true)) $c$;
create function pg_temp.price(p_shop uuid, p_item uuid, p_price text, p_eff text default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_price_set(%L, %L, %L, %L::numeric, %L::date, %L, %L)', p_shop, pg_temp.own(), p_item, p_price, p_eff, null, null)) $c$;
create function pg_temp.bset(p_shop uuid, p_job uuid, p_lines jsonb, p_reason text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_gem_bom_set(p_shop_id=>%L, p_job_id=>%L, p_gem_lines=>%L::jsonb, p_actor=>%L, p_reason=>%L, p_force=>%L)', p_shop, p_job, p_lines, pg_temp.own(), p_reason, true)) $c$;
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
create function pg_temp.gjob(p_grp jsonb, p_job uuid) returns jsonb
 language sql as $c$ select j from jsonb_array_elements(p_grp -> 'jobs') j where j ->> 'job_id' = p_job::text $c$;
create function pg_temp.in_sm(p_sm jsonb, p_job uuid) returns boolean
 language sql as $c$ select exists (select 1 from jsonb_array_elements(p_sm -> 'groups') g, jsonb_array_elements(g -> 'jobs') j where j ->> 'job_id' = p_job::text) $c$;
create function pg_temp.lid(p_job uuid, p_item uuid) returns uuid
 language sql as $c$ select id from analytics.job_gem_bom where job_id = p_job and gem_item_id = p_item $c$;
create function pg_temp.nlog(p_shop uuid, p_action text) returns int
 language sql as $c$ select count(*)::int from analytics.gem_purchase_mark_log where shop_id = p_shop and action = p_action $c$;
-- สถานะการติ๊ก + log ทั้งหมดของ 2 ร้านทดสอบ (เทียบว่า "ไม่มีอะไรเกิด" หลังคำขอที่ถูกปฏิเสธ)
create function pg_temp.msnap() returns text
 language sql as $c$
  select md5(coalesce((select string_agg(b.id::text || '|' || coalesce(b.ordered_at::text, '') || '|' || coalesce(b.ordered_qty::text, '') || '|' || b.qty_per_piece::text, ',' order by b.id)
                         from analytics.job_gem_bom b where b.shop_id in (pg_temp.fx('A'), pg_temp.fx('B'))), '')
          || '#' || (select count(*)::text from analytics.gem_purchase_mark_log)) $c$;
create function pg_temp.dec(p_x text) returns numeric language sql as $c$ select p_x::numeric $c$;

-- ใบผลิต + ใบงาน (ผ่าน RPC ออฟฟิศเดิม) — คืน job id · due_days ไม่ null = ตั้งกำหนดส่งเป็นวันนี้ + n
create function pg_temp.newjob(p_shop uuid, p_product uuid, p_codes text, p_lines jsonb, p_qty int, p_due_days int default null) returns uuid
 language plpgsql as $c$
declare o uuid; r jsonb; j jsonb; jid uuid;
begin
  o := (analytics.production_order_save(p_shop, null, 'v192', null) ->> 'id')::uuid;
  r := pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>%L, p_pending_product_label=>%L, p_metal=>%L, p_purity=>%L, p_weight_g=>%L, p_weight_source=>%L)',
    p_shop, o, p_product, p_qty, null, null, null, null, null));
  if r ? '_err' then raise exception 'newjob: ใส่รายการใบผลิตไม่ได้ %', r::text; end if;
  j := pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L, p_gem_lines=>%L::jsonb, p_gem_force=>%L)',
    p_shop, r ->> 'id', p_codes, pg_temp.nom(), p_lines, true));
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

-- ============================================================================
-- S. setup — ร้านสังเคราะห์ A/B · สมาชิก · SKU · แคตตาล็อก · ราคา · ใบงานทุกสถานะ (ผ่าน RPC)
-- ============================================================================
create function pg_temp.g_setup() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  u1 uuid; u2 uuid; u3 uuid;
  p uuid; r jsonb;
  rnd uuid; tR uuid; tG uuid; tN uuid; tF uuid; tQ1 uuid; tQ2 uuid; tA uuid; tB uuid; tBt uuid;
  iR uuid; iG uuid; iN uuid; iF uuid; iQ1 uuid; iQ2 uuid; iA uuid; iB uuid; iBt uuid;
  j uuid; jd uuid; ok boolean; bshape uuid;
begin
  insert into public.shop (id, name) values (a, 'ZZ TEST verify-0192 A'), (b, 'ZZ TEST verify-0192 B');
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
  rnd := pg_temp.shp(a, 'กลม'); bshape := pg_temp.shp(b, 'กลม');
  perform pg_temp.setfx('rnd', rnd);
  -- SKU ร้าน A (ไม่มีแม่แบบพลอย — พลอยส่งผ่าน p_gem_lines เสมอ) · ร้าน B
  p := analytics.product_upsert(a, 'ZZ192-A1', 'แหวนทดสอบ A1', null, 'fixed', 88, null, null, null, 150, null, null, null, true); perform pg_temp.setfx('pA1', p);
  p := analytics.product_upsert(a, 'ZZ192-A2', 'แหวนทดสอบ A2', null, 'fixed', 50, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pA2', p);
  p := analytics.product_upsert(a, 'ZZ192-A3', 'แหวนทดสอบ A3', null, 'fixed', 55, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pA3', p);
  p := analytics.product_upsert(a, 'ZZ192-A4', 'แหวนทดสอบ A4', null, 'fixed', 60, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pA4', p);
  p := analytics.product_upsert(a, 'ZZ192-A5', 'แหวนทดสอบ A5', null, 'fixed', 65, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pA5', p);
  p := analytics.product_upsert(b, 'ZZ192-B1', 'SKU ร้าน B', null, 'fixed', 70, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pB1', p);
  -- แคตตาล็อก: ชื่อแยกกันชัด (p_force=true ใน helper อยู่แล้วกันตัวดักคล้าย)
  tR := (pg_temp.ccreate(a, 'ZZ192 ทับทิม') ->> 'id')::uuid;      tG := (pg_temp.ccreate(a, 'ZZ192 โกเมน') ->> 'id')::uuid;
  tN := (pg_temp.ccreate(a, 'ZZ192 ไพลิน') ->> 'id')::uuid;       tF := (pg_temp.ccreate(a, 'ZZ192 เพทาย') ->> 'id')::uuid;
  tQ1 := (pg_temp.ccreate(a, 'ZZ192 สปิเนล') ->> 'id')::uuid;     tQ2 := (pg_temp.ccreate(a, 'ZZ192 มูนสโตน') ->> 'id')::uuid;
  tA := (pg_temp.ccreate(a, 'ZZ192 อเมทิสต์เอ') ->> 'id')::uuid;   tB := (pg_temp.ccreate(a, 'ZZ192 อเมทิสต์บี') ->> 'id')::uuid;
  tBt := (pg_temp.ccreate(b, 'ZZ192 บีทับทิม', u2) ->> 'id')::uuid;
  iR := (pg_temp.icreate(a, jsonb_build_object('type_id', tR, 'shape_id', rnd, 'size_a', 3)) -> 'item' ->> 'gem_item_id')::uuid;
  iG := (pg_temp.icreate(a, jsonb_build_object('type_id', tG, 'shape_id', rnd, 'size_a', 4)) -> 'item' ->> 'gem_item_id')::uuid;
  iN := (pg_temp.icreate(a, jsonb_build_object('type_id', tN, 'shape_id', rnd, 'size_a', 8)) -> 'item' ->> 'gem_item_id')::uuid;
  iF := (pg_temp.icreate(a, jsonb_build_object('type_id', tF, 'shape_id', rnd, 'size_a', 2)) -> 'item' ->> 'gem_item_id')::uuid;
  iQ1 := (pg_temp.icreate(a, jsonb_build_object('type_id', tQ1, 'shape_id', rnd, 'size_a', 1.5)) -> 'item' ->> 'gem_item_id')::uuid;
  iQ2 := (pg_temp.icreate(a, jsonb_build_object('type_id', tQ2, 'shape_id', rnd, 'size_a', 1.5)) -> 'item' ->> 'gem_item_id')::uuid;
  iA := (pg_temp.icreate(a, jsonb_build_object('type_id', tA, 'shape_id', rnd, 'size_a', 5)) -> 'item' ->> 'gem_item_id')::uuid;
  iB := (pg_temp.icreate(a, jsonb_build_object('type_id', tB, 'shape_id', rnd, 'size_a', 5)) -> 'item' ->> 'gem_item_id')::uuid;
  iBt := (pg_temp.icreate(b, jsonb_build_object('type_id', tBt, 'shape_id', bshape, 'size_a', 3), u2) -> 'item' ->> 'gem_item_id')::uuid;
  perform pg_temp.setfx('tA', tA); perform pg_temp.setfx('tB', tB);
  perform pg_temp.setfx('iR', iR); perform pg_temp.setfx('iG', iG); perform pg_temp.setfx('iN', iN); perform pg_temp.setfx('iF', iF);
  perform pg_temp.setfx('iQ1', iQ1); perform pg_temp.setfx('iQ2', iQ2); perform pg_temp.setfx('iA', iA); perform pg_temp.setfx('iB', iB); perform pg_temp.setfx('iBt', iBt);
  -- ราคา (เลขแปลก — ต้องไม่โผล่นอกทาง RPC ต้นทุน) · iN ไม่มีราคา · iF มีเฉพาะราคาที่มีผลในอนาคต
  perform pg_temp.price(a, iR, '7391.2468'); perform pg_temp.price(a, iG, '9999.9999');
  perform pg_temp.price(a, iA, '111.1111'); perform pg_temp.price(a, iB, '222.2222');
  perform pg_temp.price(a, iQ1, '0.3333'); perform pg_temp.price(a, iQ2, '0.3333');
  perform pg_temp.price(a, iF, '50', (analytics.job_today() + 30)::text);
  v := v || pg_temp.chk('S0', 'setup: ร้าน A/B · สมาชิก owner/admin/staff · SKU · ชนิด/รายการ 9 รายการ (ร้าน B 1) · ราคา 7 รายการ (iN ไม่มี · iF อนาคตอย่างเดียว)',
    iR is not null and iG is not null and iN is not null and iF is not null and iQ1 is not null and iQ2 is not null and iA is not null and iB is not null and iBt is not null
    and (select count(*) from analytics.gem_item_price where shop_id = a) = 7);

  -- ใบงานร้าน A (ทุกสถานะที่ต้องแยกให้ถูก) · ขั้นฝังจริงคือ gem_set (UX H7)
  j := pg_temp.newjob(a, pg_temp.fx('pA1'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iR, 2), pg_temp.ln(iG, 1)), 3, 10); perform pg_temp.setfx('J1', j);   -- R 6 · G 3
  j := pg_temp.newjob(a, pg_temp.fx('pA2'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iR, 1)), 5, 3); perform pg_temp.setfx('J2', j);                       -- R 5 · due เร็วสุด
  j := pg_temp.newjob(a, pg_temp.fx('pA3'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iR, 4)), 2, 5); perform pg_temp.setfx('J3', j);                       -- จะถูกยกเลิก
  perform analytics.job_cancel(a, j, 'verify 0192 ยกเลิกแล้วสร้างใหม่ (R8)', pg_temp.nom());
  j := pg_temp.newjob(a, pg_temp.fx('pA3'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iR, 4)), 2, 20); perform pg_temp.setfx('J3b', j);                     -- สร้างใหม่ R 8
  j := pg_temp.newjob(a, pg_temp.fx('pA4'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iR, 9)), 2, 1); perform pg_temp.setfx('J4', j);                       -- ขั้นฝังรับแล้ว
  perform pg_temp.walk_to(a, j, 'gem_set'); perform pg_temp.step(a, j, false);
  v := v || pg_temp.chk('S1', 'J4: ขั้นฝัง gem_set ถูกรับ (received) จริง · J3 cancelled · J3b ใบใหม่', (select status from analytics.job_stage where job_id = j and stage_code = 'gem_set') = 'received'
    and (select status from analytics.job where id = pg_temp.fx('J3')) = 'cancelled' and (select status from analytics.job where id = pg_temp.fx('J3b')) = 'open');
  -- J5: ไม่มีขั้นฝัง (std) แต่มีแถวพลอย · J6: ขั้นฝังถูกข้าม · J7: ปิด (done) ถ้าทำได้
  begin
    j := pg_temp.newjob(a, pg_temp.fx('pA4'), pg_temp.std(), jsonb_build_array(pg_temp.ln(iR, 7)), 2, 2); perform pg_temp.setfx('J5', j);
  exception when others then
    v := v || pg_temp.skip('S2', 'สร้างใบไม่มีขั้นฝังที่มีแถวพลอยไม่ได้ (' || sqlerrm || ') — เคส "ไม่มีขั้นฝัง" ไม่ได้ทดสอบ');
  end;
  begin
    j := pg_temp.newjob(a, pg_temp.fx('pA4'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iR, 8)), 2, 2);
    perform analytics.job_stage_skip(a, j, 'gem_set', 'verify 0192 ข้ามขั้นฝัง', pg_temp.nom());
    perform pg_temp.setfx('J6', j);
  exception when others then
    v := v || pg_temp.skip('S3', 'ข้ามขั้นฝังไม่ได้ (' || sqlerrm || ') — เคส skipped ไม่ได้ทดสอบ');
  end;
  begin
    jd := pg_temp.newjob(a, pg_temp.fx('pA4'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iR, 6)), 2, 2);
    loop
      exit when pg_temp.step(a, jd, true) is null;
    end loop;
    perform analytics.job_done(a, jd, 2, 0, null, null, pg_temp.nom());
    ok := (select status from analytics.job where id = jd) = 'done';
    if ok then perform pg_temp.setfx('J7', jd); end if;
  exception when others then
    v := v || pg_temp.skip('S4', 'ทำใบ done จริงไม่ได้ (' || sqlerrm || ') — ใช้ cancelled เป็นตัวแทน "ใบปิดแล้ว"');
  end;
  j := pg_temp.newjob(a, pg_temp.fx('pA3'), pg_temp.stdg(), '[]'::jsonb, 2, 6); perform pg_temp.setfx('J9', j);                                                -- ยังไม่ระบุพลอย
  j := pg_temp.newjob(a, pg_temp.fx('pA2'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iN, 5)), 2, 7); perform pg_temp.setfx('J10', j);                       -- ไม่มีราคา · 10
  j := pg_temp.newjob(a, pg_temp.fx('pA2'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iF, 2)), 3, 8); perform pg_temp.setfx('J11', j);                       -- ราคาอนาคตอย่างเดียว · 6
  j := pg_temp.newjob(a, pg_temp.fx('pA2'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iQ1, 1), pg_temp.ln(iQ2, 1)), 7, 9); perform pg_temp.setfx('J12', j);  -- ปัดเศษ · 7 + 7
  -- รวมชื่อ A→B ราคาต่าง: ใบ JA ใช้ iA (snapshot A) · ใบ JBm ใช้ iB — ยังไม่รวมตอนนี้ (รวมใน g_cost)
  j := pg_temp.newjob(a, pg_temp.fx('pA5'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iA, 3)), 2, 4); perform pg_temp.setfx('JA', j);                        -- iA 6
  j := pg_temp.newjob(a, pg_temp.fx('pA5'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iB, 1)), 4, 4); perform pg_temp.setfx('JBm', j);                       -- iB 4
  -- ร้าน B: ใบ + พลอย (ต้องไม่โผล่ในร้าน A · ใช้ทดสอบ IDOR)
  j := pg_temp.newjob(b, pg_temp.fx('pB1'), pg_temp.stdg(), jsonb_build_array(pg_temp.ln(iBt, 4)), 2, 5); perform pg_temp.setfx('JBx', j);
  v := v || pg_temp.chk('S5', 'fixture ใบงาน: ร้าน A 12 ใบ (ตามสถานะ) · ร้าน B 1 ใบ · แถวพลอยทุกแถวยังไม่มีการติ๊ก',
    (select count(*) from analytics.job where shop_id = a) >= 11 and (select count(*) from analytics.job where shop_id = b) = 1
    and not exists (select 1 from analytics.job_gem_bom where ordered_at is not null or ordered_by is not null or ordered_qty is not null));
  return v;
end;
$c$;

-- ============================================================================
-- A. สรุปยอด (ไม่มีราคา): นิยามใบที่ต้องใช้ · parity กับ job_gem_bom_get · unspecified · เวลาไทย · ไม่รั่วราคา
-- ============================================================================
create function pg_temp.g_sum() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A');
  iR uuid := pg_temp.fx('iR'); iG uuid := pg_temp.fx('iG'); iB uuid := pg_temp.fx('iB');
  s jsonb; gR jsonb; gG jsonb; gB jsonb; k text; r record; gs text; exp_in boolean; act_in boolean; ok boolean; bad text := '';
begin
  s := pg_temp.sm(a);
  v := v || pg_temp.chk('A0', 'สรุปเรียกได้ (owner) · ไม่ error', s ->> '_err' is null and jsonb_typeof(s -> 'groups') = 'array');
  gR := pg_temp.grp(s, iR); gG := pg_temp.grp(s, iG);
  -- ก่อนรวมชื่อ: iA และ iB เป็นคนละกลุ่ม → กลุ่ม = iR iG iN iF iQ1 iQ2 iA iB = 8 · ใบ = J1 J2 J3b J10 J11 J12 JA JBm = 8 · ที่ต้องใช้ = 19+3+10+6+7+7+6+4 = 62
  v := v || pg_temp.chk('A1', 'กลุ่ม 8 · ใบ 8 · ต้องใช้รวม 62 เม็ด · สั่งแล้ว 0 · เหลือ 62 · เกิน 0 (ไม่เผื่อแตก: ต่อชิ้น × จำนวนเริ่มผลิตเท่านั้น)',
    (s -> 'totals' ->> 'groups') = '8' and (s -> 'totals' ->> 'jobs') = '8' and (s -> 'totals' ->> 'qty_needed_now') = '62' and (s -> 'totals' ->> 'qty_ordered') = '0'
    and (s -> 'totals' ->> 'qty_remaining') = '62' and (s -> 'totals' ->> 'qty_excess') = '0');
  v := v || pg_temp.chk('A2', 'กลุ่มทับทิม (iR): ต้องใช้ 19 = J1 6 + J2 5 + J3b 8 (ใบ cancelled J3 ที่ BOM ยังอยู่ไม่นับซ้ำ — R8) · 3 ใบ · line_ids 3 · due เร็วสุด = J2 · มี job_no/design_label/due/qty ต่อใบ · โกเมน (iG) 3',
    (gR ->> 'qty_needed_now') = '19' and (gR ->> 'job_count') = '3' and jsonb_array_length(gR -> 'line_ids') = 3
    and (gR ->> 'earliest_due') = (analytics.job_today() + 3)::text and (gR ->> 'earliest_due_remaining') = (analytics.job_today() + 3)::text
    and (pg_temp.gjob(gR, pg_temp.fx('J1')) ->> 'qty_needed_now') = '6' and (pg_temp.gjob(gR, pg_temp.fx('J2')) ->> 'qty_needed_now') = '5' and (pg_temp.gjob(gR, pg_temp.fx('J3b')) ->> 'qty_needed_now') = '8'
    and (pg_temp.gjob(gR, pg_temp.fx('J1')) ->> 'job_no') = (select job_no from analytics.job where id = pg_temp.fx('J1'))
    and (pg_temp.gjob(gR, pg_temp.fx('J1')) ->> 'design_label') is not null and (pg_temp.gjob(gR, pg_temp.fx('J1')) ->> 'due_date') = (analytics.job_today() + 10)::text
    and (gR ->> 'label') = 'ZZ192 ทับทิม · กลม · 3 มม.' and (gG ->> 'qty_needed_now') = '3');
  -- A3: ใบที่ไม่ควรโผล่
  ok := not pg_temp.in_sm(s, pg_temp.fx('J3')) and not pg_temp.in_sm(s, pg_temp.fx('J4'))
        and (pg_temp.fx('J5') is null or not pg_temp.in_sm(s, pg_temp.fx('J5')))
        and (pg_temp.fx('J6') is null or not pg_temp.in_sm(s, pg_temp.fx('J6')))
        and (pg_temp.fx('J7') is null or not pg_temp.in_sm(s, pg_temp.fx('J7')))
        and not pg_temp.in_sm(s, pg_temp.fx('JBx'))
        and exists (select 1 from analytics.job_gem_bom where job_id = pg_temp.fx('J3')) and exists (select 1 from analytics.job_gem_bom where job_id = pg_temp.fx('J4'));
  v := v || pg_temp.chk('A3', 'ไม่โผล่ในยอด: ใบ cancelled (J3 — BOM ยังอยู่ในตาราง) · ขั้นฝังรับแล้ว (J4) · ไม่มีขั้นฝัง (J5) · ขั้นฝังถูกข้าม (J6) · ใบ done (J7) · ใบร้านอื่น (JBx) — ที่ fixture สร้างไม่ได้ = SKIP ใน S2-S4', ok);
  -- A4: parity กับ gem_stage ของ job_gem_bom_get (นิยามเดียว) ทุกใบของร้าน A + นิยามเดียวกับ job_gem_state เมื่อมีแถว/ไม่มีแถว
  for r in select j.id, j.status, j.parent_job_id from analytics.job j where j.shop_id = a loop
    gs := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, r.id)) ->> 'gem_stage';
    exp_in := r.parent_job_id is null and r.status in ('open', 'in_progress', 'on_hold') and gs = 'pending';
    act_in := exists (select 1 from analytics.v_gem_purchase_job x where x.job_id = r.id);
    if exp_in is distinct from act_in then bad := bad || r.id::text || ' (gem_stage=' || coalesce(gs, 'null') || ' status=' || r.status || ' ใน view=' || act_in::text || '); '; end if;
    if act_in and (analytics.job_gem_state(a, r.id) <> case when exists (select 1 from analytics.job_gem_bom b where b.job_id = r.id) then 'specified' else 'unspecified' end) then
      bad := bad || r.id::text || ' (job_gem_state ขัดกัน); ';
    end if;
  end loop;
  v := v || pg_temp.chk('A4', 'parity: v_gem_purchase_job = (ใบแม่ open/in_progress/on_hold ∧ gem_stage ของ job_gem_bom_get = pending) ทุกใบของร้าน (none/pending/started/skipped/cancelled/done) · ใบใน view ที่มีแถว = specified ไม่มี = unspecified ตาม job_gem_state · ที่ขัด: ' || coalesce(nullif(bad, ''), 'ไม่มี'), bad = '');
  -- A5: unspecified_jobs (J9 ไม่มีแถวพลอย แต่ขั้นฝัง pending)
  v := v || pg_temp.chk('A5', 'unspecified_jobs: มี J9 (ขั้นฝัง pending ไม่มีแถวพลอย) · ไม่มี J1 · ไม่มี J4 (ขั้นฝังรับแล้ว) · totals.unspecified_jobs = 1 · ครบ job_id/job_no/design_label/due_date',
    jsonb_array_length(s -> 'unspecified_jobs') = 1 and (s -> 'unspecified_jobs' -> 0 ->> 'job_id') = pg_temp.fx('J9')::text
    and (s -> 'unspecified_jobs' -> 0 ->> 'job_no') is not null and (s -> 'unspecified_jobs' -> 0 ->> 'design_label') is not null
    and (s -> 'unspecified_jobs' -> 0 ->> 'due_date') = (analytics.job_today() + 6)::text and (s -> 'totals' ->> 'unspecified_jobs') = '1');
  -- A6: เวลาไทยจาก DB
  v := v || pg_temp.chk('A6', 'today_bkk = analytics.job_today() (วันไทย ไม่ใช่ current_date UTC) · server_now รูป ISO +07:00 และวันตรงกับวันไทยจาก now()',
    (s ->> 'today_bkk') = analytics.job_today()::text and (s ->> 'server_now') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$'
    and left(s ->> 'server_now', 10) = ((now() at time zone 'Asia/Bangkok')::date)::text);
  -- A7: UX H7 — ใบที่มีขั้นฝังจริง (gem_set) ต้องโผล่
  v := v || pg_temp.chk('A7', 'H7: J1 มีขั้น gem_set จริงใน DB (pending) และโผล่ในหน้า · รหัสขั้นฝังใน job_stage_def ของร้านคือ gem_set',
    exists (select 1 from analytics.job_stage where job_id = pg_temp.fx('J1') and stage_code = 'gem_set' and status = 'pending') and pg_temp.in_sm(s, pg_temp.fx('J1'))
    and exists (select 1 from analytics.job_stage_def where shop_id = a and code = 'gem_set'));
  -- L1: ไม่รั่วราคา
  v := v || pg_temp.chk('L1', '🔴 payload สรุป: ไม่มีคีย์ราคา/ต้นทุน/ผู้ขาย (แม้เป็น null) · ไม่มีเลขราคาจริง 7391.2468/9999.9999 ที่ตั้งไว้',
    pg_temp.badkeys(s) = '' and not pg_temp.has_px(s) and position('7391' in s::text) = 0 and position('9999.99' in s::text) = 0);
  -- L2: วิว/ตาราง log ไม่มีคอลัมน์ราคา
  v := v || pg_temp.chk('L2', 'v_gem_purchase_job / _line / _summary / gem_purchase_mark_log ไม่มีคอลัมน์ที่ดูเป็นราคา/ต้นทุน/ผู้ขาย',
    not exists (select 1 from information_schema.columns where table_schema = 'analytics'
                 and table_name in ('v_gem_purchase_job', 'v_gem_purchase_line', 'v_gem_purchase_summary', 'gem_purchase_mark_log') and column_name ~* '(price|cost|thb|supplier)'));
  return v;
end;
$c$;

-- ============================================================================
-- C. ต้นทุนประมาณ (owner/admin · RPC แยก): ราคา snapshot ไม่ใช่ canonical · ไม่มีราคา = null · ปัด 2 ตำแหน่ง · ผลรวม = Σ แถวเป๊ะ
-- ============================================================================
create function pg_temp.g_cost() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A');
  c jsonb; gR jsonb; gN jsonb; gF jsonb; gQ1 jsonb; gQ2 jsonb; gB jsonb; sm jsonb; r jsonb; sumg numeric;
begin
  c := pg_temp.cs(a);
  gR := (select g from jsonb_array_elements(c -> 'groups') g where g ->> 'canonical_item_id' = pg_temp.fx('iR')::text);
  gN := (select g from jsonb_array_elements(c -> 'groups') g where g ->> 'canonical_item_id' = pg_temp.fx('iN')::text);
  gF := (select g from jsonb_array_elements(c -> 'groups') g where g ->> 'canonical_item_id' = pg_temp.fx('iF')::text);
  gQ1 := (select g from jsonb_array_elements(c -> 'groups') g where g ->> 'canonical_item_id' = pg_temp.fx('iQ1')::text);
  gQ2 := (select g from jsonb_array_elements(c -> 'groups') g where g ->> 'canonical_item_id' = pg_temp.fx('iQ2')::text);
  v := v || pg_temp.chk('C1', 'ต้นทุนที่เหลือ: ทับทิม 19 × 7391.2468 = 140433.69 (ปัด 2 ตำแหน่งที่ DB) · โกเมน 3 × 9999.9999 = 30000.00 · สั่งแล้ว 0 → cost_ordered = 0 (ไม่ใช่ null)',
    c ->> '_err' is null and (gR ->> 'cost_remaining_thb')::numeric = 140433.69 and (gR ->> 'cost_ordered_thb')::numeric = 0 and (gR ->> 'missing_price') = 'false'
    and ((select g from jsonb_array_elements(c -> 'groups') g where g ->> 'canonical_item_id' = pg_temp.fx('iG')::text) ->> 'cost_remaining_thb')::numeric = 30000.00);
  v := v || pg_temp.chk('C2', '🔴 ไม่มีราคา (iN) = cost null + missing_price (ไม่เดา · ไม่ใช่ 0) · totals.complete = false · groups_missing_price นับถูก (iN + iF = 2)',
    (gN -> 'cost_remaining_thb') = 'null'::jsonb and (gN ->> 'missing_price_remaining') = 'true' and (gN ->> 'missing_price') = 'true'
    and (c -> 'totals' ->> 'complete') = 'false' and (c -> 'totals' ->> 'groups_missing_price') = '2');
  v := v || pg_temp.chk('C3', '🔴 ราคาที่มีผลในอนาคตอย่างเดียว (iF effective_from = วันนี้ + 30) = ยังไม่มีราคา (null + missing_price) — ราคา ณ วันนี้ไทย ไม่ใช่ราคาล่าสุดที่ตั้งไว้',
    (gF -> 'cost_remaining_thb') = 'null'::jsonb and (gF ->> 'missing_price') = 'true');
  -- C4: รวมชื่อ A→B ที่ราคาต่าง (111.1111 vs 222.2222) — ต้นทุนต้องคิดจาก gem_item_id ใน snapshot ของแถว ไม่ใช่ canonical
  r := pg_temp.mrg(a, 'type', pg_temp.fx('tA'), pg_temp.fx('tB'));
  sm := pg_temp.sm(a); c := pg_temp.cs(a);
  gB := (select g from jsonb_array_elements(c -> 'groups') g where g ->> 'canonical_item_id' = pg_temp.fx('iB')::text);
  v := v || pg_temp.chk('C4a', 'รวมชื่อ อเมทิสต์เอ→บี สำเร็จ: iA ชี้ iB (merged_into) · ใบ JA ยังอ้าง iA ใน snapshot (BOM ไม่ถูกแตะ)',
    r ->> '_err' is null and (select merged_into from analytics.gem_item where id = pg_temp.fx('iA')) = pg_temp.fx('iB') and pg_temp.lid(pg_temp.fx('JA'), pg_temp.fx('iA')) is not null);
  v := v || pg_temp.chk('C4b', 'หลังรวม: กลุ่ม canonical = iB รวม 2 ใบ ต้องใช้ 6 + 4 = 10 · กลุ่ม iA หายจากรายการ (ไม่นับซ้ำ) · กลุ่มรวม 7',
    (pg_temp.grp(sm, pg_temp.fx('iB')) ->> 'qty_needed_now') = '10' and (pg_temp.grp(sm, pg_temp.fx('iB')) ->> 'job_count') = '2' and pg_temp.grp(sm, pg_temp.fx('iA')) is null
    and (sm -> 'totals' ->> 'groups') = '7' and (sm -> 'totals' ->> 'qty_needed_now') = '62');
  v := v || pg_temp.chk('C4', '🔴 ต้นทุนกลุ่มที่รวมชื่อ = 6 × ราคาของ iA (snapshot ของ JA) + 4 × ราคาของ iB = 666.6666 + 888.8888 = 1555.56 (ถ้าใช้ canonical ทั้งกลุ่ม = 10 × 222.2222 = 2222.22 ซึ่งผิด)',
    (gB ->> 'cost_remaining_thb')::numeric = 1555.56 and (gB ->> 'cost_remaining_thb')::numeric <> 2222.22);
  -- C5: ปัดเศษ: 7 × 0.3333 = 2.3331 → 2.33 ต่อกลุ่ม · ผลรวมทั้งหมด = Σ ค่าที่ปัดแล้วของกลุ่ม (ไม่ใช่ปัดผลรวม)
  select coalesce(sum((g ->> 'cost_remaining_thb')::numeric), 0) into sumg from jsonb_array_elements(c -> 'groups') g where (g ->> 'cost_remaining_thb') is not null;
  v := v || pg_temp.chk('C5', 'ปัด 2 ตำแหน่งต่อกลุ่ม (สปิเนล/มูนสโตน 7 × 0.3333 = 2.3331 → 2.33 ทั้งคู่) · totals.cost_remaining_thb = Σ ค่ากลุ่มที่ปัดแล้วเป๊ะ (= 171993.91) ไม่ใช่ปัดผลรวมดิบ',
    (gQ1 ->> 'cost_remaining_thb')::numeric = 2.33 and (gQ2 ->> 'cost_remaining_thb')::numeric = 2.33
    and (c -> 'totals' ->> 'cost_remaining_thb')::numeric = sumg and sumg = 171993.91);
  v := v || pg_temp.chk('L1b', 'positive control: ราคาจริงโผล่ใน payload ต้นทุนได้ (RPC เดียวที่ผสมราคา) — ทำให้เทสต์ L1 ที่หาเลขราคาไม่เจอในสรุป "มีความหมาย"',
    position('140433.69' in c::text) > 0 and pg_temp.badkeys(c) <> '');
  return v;
end;
$c$;

-- ============================================================================
-- M. ติ๊ก "สั่งแล้ว": ติ๊ก · ซ้ำ · bulk · undo · ยอดเปลี่ยนหลังติ๊ก · replace_core คง/ลบแถว · log · ไม่รั่วไปที่อื่น
-- ============================================================================
create function pg_temp.g_mark() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A');
  iR uuid := pg_temp.fx('iR'); iG uuid := pg_temp.fx('iG'); iN uuid := pg_temp.fx('iN');
  j1 uuid := pg_temp.fx('J1'); j2 uuid := pg_temp.fx('J2'); j3b uuid := pg_temp.fx('J3b');
  l1 uuid; l2 uuid; l3 uuid; lg uuid; ids uuid[];
  r jsonb; s jsonb; gR jsonb; c jsonb; n_log int; l1_old uuid; jn uuid; ok boolean; tokh text; tk jsonb; res jsonb; raw jsonb;
begin
  l1 := pg_temp.lid(j1, iR); l2 := pg_temp.lid(j2, iR); l3 := pg_temp.lid(j3b, iR); lg := pg_temp.lid(j1, iG);
  -- M1: ติ๊กแถวเดียว (R ของ J1 = 6 เม็ด)
  r := pg_temp.mk(a, array[l1], true);
  s := pg_temp.sm(a); gR := pg_temp.grp(s, iR);
  v := v || pg_temp.chk('M1', 'ติ๊ก R ของ J1: changed 1 · lines คืนสถานะสด (ต้องใช้ 6 · สั่งแล้ว 6 · เหลือ 0) · กลุ่มทับทิม สั่งแล้ว 6 เหลือ 13 · ใบ J1 is_ordered มี ordered_at/ordered_by = ผู้ติ๊ก · ใบอื่นไม่ติ๊ก · โกเมนไม่ขยับ · ตาราง ordered_qty = 6 · log ordered 1',
    r ->> '_err' is null and (r ->> 'changed') = '1' and (r ->> 'unchanged') = '0' and (r -> 'lines' -> 0 ->> 'qty_ordered') = '6' and (r -> 'lines' -> 0 ->> 'qty_remaining') = '0' and (r -> 'lines' -> 0 ->> 'is_ordered') = 'true'
    and (gR ->> 'qty_ordered') = '6' and (gR ->> 'qty_remaining') = '13' and (gR ->> 'qty_needed_now') = '19'
    and (pg_temp.gjob(gR, j1) ->> 'is_ordered') = 'true' and (pg_temp.gjob(gR, j1) ->> 'ordered_at') is not null and (pg_temp.gjob(gR, j1) ->> 'ordered_by') = pg_temp.own()::text
    and (pg_temp.gjob(gR, j2) ->> 'is_ordered') = 'false' and (pg_temp.gjob(gR, j2) ->> 'ordered_at') is null and (pg_temp.gjob(gR, j2) ->> 'ordered_by') is null
    and (pg_temp.grp(s, iG) ->> 'qty_remaining') = '3' and (select ordered_qty from analytics.job_gem_bom where id = l1) = 6 and (select ordered_by from analytics.job_gem_bom where id = l1) = pg_temp.own()
    and pg_temp.nlog(a, 'ordered') = 1 and (gR ->> 'earliest_due_remaining') = (analytics.job_today() + 3)::text);
  c := pg_temp.cs(a); gR := (select g from jsonb_array_elements(c -> 'groups') g where g ->> 'canonical_item_id' = iR::text);
  v := v || pg_temp.chk('M1c', 'ต้นทุนหลังติ๊กบางส่วน: สั่งแล้ว 6 × 7391.2468 = 44347.48 · ที่เหลือ 13 × 7391.2468 = 96086.21 · รวม = 140433.69 (ผลบวกส่วนที่ปัดแล้ว = ยอดเดิมเป๊ะ)',
    (gR ->> 'cost_ordered_thb')::numeric = 44347.48 and (gR ->> 'cost_remaining_thb')::numeric = 96086.21 and (gR ->> 'cost_ordered_thb')::numeric + (gR ->> 'cost_remaining_thb')::numeric = 140433.69);
  -- M2: ติ๊กซ้ำ = ไม่ error ไม่เขียน log
  n_log := pg_temp.nlog(a, 'ordered');
  r := pg_temp.mk(a, array[l1], true);
  v := v || pg_temp.chk('M2', 'ติ๊กซ้ำแถวที่ติ๊กแล้วและตรงยอด: ไม่ error · changed 0 · unchanged 1 · ไม่มี log ใหม่ · ordered_at เดิมไม่ขยับ',
    r ->> '_err' is null and (r ->> 'changed') = '0' and (r ->> 'unchanged') = '1' and pg_temp.nlog(a, 'ordered') = n_log);
  -- M3: ติ๊กทั้งกลุ่ม (ส่ง line_ids ของกลุ่มจาก summary) — J1 ติ๊กแล้ว · J2/J3b ใหม่
  ids := array(select (x #>> '{}')::uuid from jsonb_array_elements(pg_temp.grp(pg_temp.sm(a), iR) -> 'line_ids') x);
  r := pg_temp.mk(a, ids, true);
  s := pg_temp.sm(a); gR := pg_temp.grp(s, iR);
  v := v || pg_temp.chk('M3', 'ติ๊กทั้งกลุ่มทับทิม (3 แถว): changed 2 unchanged 1 · เหลือ 0 สั่งแล้ว 19 · กลุ่มยังอยู่ในผล (ต้องหาเจอเพื่อยกเลิกติ๊ก) · totals.qty_remaining = 62 − 19 = 43 · log ordered รวม 3',
    (r ->> 'changed') = '2' and (r ->> 'unchanged') = '1' and jsonb_array_length(r -> 'lines') = 3 and gR is not null and (gR ->> 'qty_remaining') = '0' and (gR ->> 'qty_ordered') = '19'
    and (s -> 'totals' ->> 'qty_remaining') = '43' and (s -> 'totals' ->> 'qty_ordered') = '19' and pg_temp.nlog(a, 'ordered') = 3 and (gR ->> 'earliest_due_remaining') is null);
  -- M4: undo ด้วยรายการเดิมและค่าตรงข้าม + undo ซ้ำ
  r := pg_temp.mk(a, ids, false);
  s := pg_temp.sm(a); gR := pg_temp.grp(s, iR);
  v := v || pg_temp.chk('M4', 'ยกเลิกติ๊กทั้งกลุ่ม (รายการเดิม · ค่าตรงข้าม): changed 3 · เหลือ 19 สั่งแล้ว 0 · ตาราง ordered_* เป็น null ทั้งสามคอลัมน์ · log unordered 3 · ยกเลิกซ้ำ = changed 0 ไม่มี log ใหม่',
    (r ->> 'changed') = '3' and (gR ->> 'qty_remaining') = '19' and (gR ->> 'qty_ordered') = '0'
    and not exists (select 1 from analytics.job_gem_bom where id = any (ids) and (ordered_at is not null or ordered_by is not null or ordered_qty is not null))
    and pg_temp.nlog(a, 'unordered') = 3 and (pg_temp.mk(a, ids, false) ->> 'changed') = '0' and pg_temp.nlog(a, 'unordered') = 3);
  -- M5: ยอดเปลี่ยนหลังติ๊ก (H1) — J2: 1/ชิ้น × 5 = 5 · ติ๊กไว้ 5 แล้วแก้เป็น 2/ชิ้น (10) · ติ๊กใหม่ · ลดกลับ · เปลี่ยนจำนวนเริ่มผลิต
  perform pg_temp.mk(a, array[l2], true);
  r := pg_temp.bset(a, j2, jsonb_build_array(pg_temp.ln(iR, 2)));
  s := pg_temp.sm(a); gR := pg_temp.grp(s, iR);
  v := v || pg_temp.chk('M5a', 'H1: ติ๊กไว้ 5 แล้วใบแก้เป็น 2/ชิ้น (ต้องใช้ 10): แถวเดิมคง id · ติ๊กไม่ถูกล้าง (ordered_qty ยัง 5) · ต้องใช้ 10 สั่งไว้ 5 เหลือ 5 · changed_after_order = true · is_ordered ยัง true',
    r ->> '_err' is null and pg_temp.lid(j2, iR) = l2 and (select ordered_qty from analytics.job_gem_bom where id = l2) = 5
    and (pg_temp.gjob(gR, j2) ->> 'qty_needed_now') = '10' and (pg_temp.gjob(gR, j2) ->> 'qty_ordered') = '5' and (pg_temp.gjob(gR, j2) ->> 'qty_remaining') = '5'
    and (pg_temp.gjob(gR, j2) ->> 'changed_after_order') = 'true' and (pg_temp.gjob(gR, j2) ->> 'is_ordered') = 'true');
  r := pg_temp.mk(a, array[l2], true);
  s := pg_temp.sm(a); gR := pg_temp.grp(s, iR);
  v := v || pg_temp.chk('M5b', 'ติ๊กซ้ำหลังยอดเปลี่ยน: ปรับ ordered_qty เป็น 10 (สั่งส่วนต่างแล้ว) · changed 1 · เหลือ 0 · changed_after_order = false · log ordered +1',
    (r ->> 'changed') = '1' and (select ordered_qty from analytics.job_gem_bom where id = l2) = 10 and (pg_temp.gjob(gR, j2) ->> 'qty_remaining') = '0' and (pg_temp.gjob(gR, j2) ->> 'changed_after_order') = 'false');
  r := pg_temp.bset(a, j2, jsonb_build_array(pg_temp.ln(iR, 1)));
  s := pg_temp.sm(a); gR := pg_temp.grp(s, iR);
  v := v || pg_temp.chk('M5c', 'ใบลดกลับเป็น 1/ชิ้น (ต้องใช้ 5) หลังสั่ง 10: สั่งเกิน 5 (qty_excess) · เหลือ 0 · changed_after_order = true · totals.qty_excess = 5',
    (pg_temp.gjob(gR, j2) ->> 'qty_needed_now') = '5' and (pg_temp.gjob(gR, j2) ->> 'qty_ordered') = '10' and (pg_temp.gjob(gR, j2) ->> 'qty_excess') = '5' and (pg_temp.gjob(gR, j2) ->> 'qty_remaining') = '0'
    and (pg_temp.gjob(gR, j2) ->> 'changed_after_order') = 'true' and (s -> 'totals' ->> 'qty_excess') = '5');
  perform pg_temp.mk(a, array[l2], false);
  -- M5d: เปลี่ยนจำนวนเริ่มผลิต (qty_planned) หลังติ๊ก — ผ่าน job_qty_planned_set (ถ้า RPC ยอมรับ)
  begin
    perform pg_temp.mk(a, array[l2], true);
    raw := pg_temp.q(format('select analytics.job_qty_planned_set(p_shop_id=>%L, p_job_id=>%L, p_qty_planned=>%L, p_reason=>%L, p_actor=>%L)', a, j2, 8, 'verify 0192 เพิ่มจำนวน', pg_temp.nom()));
    if raw ? '_err' then
      v := v || pg_temp.skip('M5d', 'job_qty_planned_set ไม่รับ (' || coalesce(raw ->> '_err', '') || ') — เคสเปลี่ยนจำนวนเริ่มผลิตหลังติ๊กไม่ได้ทดสอบ');
    else
      s := pg_temp.sm(a); gR := pg_temp.grp(s, iR);
      v := v || pg_temp.chk('M5d', 'H1: เปลี่ยนจำนวนเริ่มผลิต 5 → 8 หลังติ๊ก 5: ต้องใช้ 8 · สั่งไว้ 5 · เหลือ 3 (ส่วนต่าง) · changed_after_order = true (trigger ที่ตารางมองไม่เห็นกรณีนี้ — คิดที่ view)',
        (pg_temp.gjob(gR, j2) ->> 'qty_needed_now') = '8' and (pg_temp.gjob(gR, j2) ->> 'qty_ordered') = '5' and (pg_temp.gjob(gR, j2) ->> 'qty_remaining') = '3' and (pg_temp.gjob(gR, j2) ->> 'changed_after_order') = 'true');
      perform pg_temp.q(format('select analytics.job_qty_planned_set(p_shop_id=>%L, p_job_id=>%L, p_qty_planned=>%L, p_reason=>%L, p_actor=>%L)', a, j2, 5, 'verify 0192 คืนค่า', pg_temp.nom()));
    end if;
    perform pg_temp.mk(a, array[l2], false);
  exception when others then
    v := v || pg_temp.skip('M5d', 'ทดสอบเปลี่ยนจำนวนเริ่มผลิตไม่ได้ (' || sqlerrm || ')');
  end;
  -- M6: แถวที่ติ๊กไว้ถูกลบโดยแก้พลอยของใบ → log line_removed · ติ๊กไม่ฟื้นกลับตอนเพิ่มแถวใหม่
  perform pg_temp.mk(a, array[lg], true);
  n_log := pg_temp.nlog(a, 'line_removed');
  r := pg_temp.bset(a, j1, jsonb_build_array(pg_temp.ln(iR, 2)));
  v := v || pg_temp.chk('M6a', 'แก้พลอย J1 เอารายการโกเมน (ติ๊กไว้ 3) ออก: แถวถูกลบ · log line_removed +1 (qty 3) — ของที่สั่งไปแล้วหายเงียบๆ ไม่ได้',
    r ->> '_err' is null and pg_temp.lid(j1, iG) is null and pg_temp.nlog(a, 'line_removed') = n_log + 1
    and exists (select 1 from analytics.gem_purchase_mark_log where line_id = lg and action = 'line_removed' and qty = 3 and actor is null));
  r := pg_temp.bset(a, j1, jsonb_build_array(pg_temp.ln(iR, 2), pg_temp.ln(iG, 1)));
  s := pg_temp.sm(a);
  v := v || pg_temp.chk('M6b', 'เพิ่มโกเมนกลับ: แถวใหม่ (id ใหม่) ไม่มีติ๊ก — ติ๊กเก่าไม่ฟื้น · โกเมนเหลือ 3 สั่งแล้ว 0',
    pg_temp.lid(j1, iG) is not null and pg_temp.lid(j1, iG) <> lg and (pg_temp.grp(s, iG) ->> 'qty_remaining') = '3' and (pg_temp.grp(s, iG) ->> 'qty_ordered') = '0');
  lg := pg_temp.lid(j1, iG);
  -- M7: แก้เฉพาะตำแหน่ง (จำนวนเท่าเดิม) → แถวเดิมคง id และคงติ๊ก · job_gem_bom_set ตอนมีติ๊กยังใช้ได้
  perform pg_temp.mk(a, array[l1], true);
  r := pg_temp.bset(a, j1, jsonb_build_array(pg_temp.ln(iR, 2, 'ซ้าย'), pg_temp.ln(iG, 1)));
  s := pg_temp.sm(a);
  v := v || pg_temp.chk('M7', 'แก้ตำแหน่งอย่างเดียว (จำนวนเท่าเดิม): แถว R เดิมคง id · คงติ๊ก (ordered_qty 6) · is_ordered ยัง true · ไม่ error (job_gem_bom_set ใช้ได้ตอนมีติ๊ก ต้องไม่พัง)',
    r ->> '_err' is null and pg_temp.lid(j1, iR) = l1 and (select ordered_qty from analytics.job_gem_bom where id = l1) = 6 and (pg_temp.gjob(pg_temp.grp(s, iR), j1) ->> 'is_ordered') = 'true');
  perform pg_temp.mk(a, array[l1], false);
  -- M8: job_gem_bom_get ไม่มี key ของการติ๊ก/ที่เหลือ (ต้องไม่พัง — ผลเดิม)
  r := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, j1));
  v := v || pg_temp.chk('M8', 'job_gem_bom_get ยังใช้ได้ · window/lines/state ครบ · ไม่มี key ordered/remaining/purchase ของ 0192',
    r ->> '_err' is null and r ->> 'window' is not null and jsonb_array_length(r -> 'lines') = 2 and not exists (select 1 from pg_temp.keys_deep(r) k where k ~* '(is_ordered|qty_ordered|ordered_at|ordered_by|ordered_qty|qty_remaining|purchase)'));
  -- M9: หน้าช่าง (resolve ก่อน/หลัง PIN ไม่จำเป็น — ก่อน PIN) ไม่มี key ของการติ๊ก
  begin
    tk := analytics.job_token_issue(a, j1, null, pg_temp.nom());
    tokh := analytics.job_sha256_hex(tk ->> 'token');
    res := pg_temp.q(format('select analytics.job_worker_resolve(%L, %L, %L)', tokh, null, null));
    v := v || pg_temp.chk('M9', 'หน้าช่าง (job_worker_resolve) ใช้ได้ · ไม่มี key ordered/remaining/purchase (ไม่รั่วสถานะสั่งซื้อไปหน้าช่าง)',
      res ->> '_err' is null and not exists (select 1 from pg_temp.keys_deep(res) k where k ~* '(is_ordered|qty_ordered|ordered_at|ordered_by|ordered_qty|qty_remaining|purchase)'));
  exception when others then
    v := v || pg_temp.skip('M9', 'ออก QR/เรียก resolve ไม่ได้ (' || sqlerrm || ')');
  end;
  -- P8: log append-only
  v := v || pg_temp.chk('P8', 'gem_purchase_mark_log append-only: UPDATE/DELETE ตรงถูกปฏิเสธ · TRUNCATE ถูกปฏิเสธ',
    pg_temp.err('update analytics.gem_purchase_mark_log set qty = qty + 1') <> 'OK' and pg_temp.err('delete from analytics.gem_purchase_mark_log') <> 'OK'
    and pg_temp.err('truncate analytics.gem_purchase_mark_log') <> 'OK');
  -- C7: กลุ่มที่ติ๊กครบแล้วไม่มีราคา: ส่วนที่เหลือ = 0 ไม่ต้องมีราคา (cost_remaining = 0 ไม่ใช่ null) · ส่วนสั่งแล้ว = null + missing (ไม่เดา)
  perform pg_temp.mk(a, array[pg_temp.lid(pg_temp.fx('J10'), iN)], true);
  c := pg_temp.cs(a);
  v := v || pg_temp.chk('C7', 'iN (ไม่มีราคา) ติ๊กครบ: cost_remaining = 0 และ missing_price_remaining = false (ส่วนที่จำนวน 0 ไม่ต้องมีราคา) · ส่วนสั่งแล้ว = null + missing_price_ordered (ไม่เดา) — ต้องไม่พัง',
    ((select g from jsonb_array_elements(c -> 'groups') g where g ->> 'canonical_item_id' = iN::text) ->> 'cost_remaining_thb')::numeric = 0
    and ((select g from jsonb_array_elements(c -> 'groups') g where g ->> 'canonical_item_id' = iN::text) ->> 'missing_price_remaining') = 'false'
    and ((select g from jsonb_array_elements(c -> 'groups') g where g ->> 'canonical_item_id' = iN::text) -> 'cost_ordered_thb') = 'null'::jsonb
    and ((select g from jsonb_array_elements(c -> 'groups') g where g ->> 'canonical_item_id' = iN::text) ->> 'missing_price_ordered') = 'true');
  perform pg_temp.mk(a, array[pg_temp.lid(pg_temp.fx('J10'), iN)], false);
  -- L1c: ผลติ๊กไม่รั่วราคา
  r := pg_temp.mk(a, array[l1], true);
  v := v || pg_temp.chk('L1c', '🔴 ผลของ gem_purchase_mark ไม่มีคีย์ราคา/ต้นทุน และไม่มีเลขราคาจริง',
    pg_temp.badkeys(r) = '' and not pg_temp.has_px(r));
  perform pg_temp.mk(a, array[l1], false);
  return v;
end;
$c$;

-- ============================================================================
-- F. เคสห้ามผ่านของการติ๊ก: ใบปิด · ขั้นฝังรับแล้ว · ไม่มีขั้นฝัง/ข้าม · ร้านอื่น (IDOR) · ชุดผสม · input ผิด — ทุกข้อ state ต้องไม่ขยับ
-- ============================================================================
create function pg_temp.g_forbid() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A'); b uuid := pg_temp.fx('B');
  iR uuid := pg_temp.fx('iR');
  l1 uuid := pg_temp.lid(pg_temp.fx('J1'), iR);
  l3 uuid := pg_temp.lid(pg_temp.fx('J3'), iR);
  l4 uuid := pg_temp.lid(pg_temp.fx('J4'), iR);
  l5 uuid; l6 uuid; l7 uuid; lb uuid := pg_temp.lid(pg_temp.fx('JBx'), pg_temp.fx('iBt'));
  s0 text; r jsonb; ok boolean; ids201 uuid[];
begin
  l5 := pg_temp.lid(pg_temp.fx('J5'), iR); l6 := pg_temp.lid(pg_temp.fx('J6'), iR); l7 := pg_temp.lid(pg_temp.fx('J7'), iR);
  s0 := pg_temp.msnap();
  r := pg_temp.mk(a, array[l3], true);
  v := v || pg_temp.chk('F1', 'ติ๊กแถวของใบ cancelled (J3) → 22023/job_closed · ไม่เขียนอะไร (ติ๊ก/log ไม่ขยับ)', pg_temp.hint(r) = '22023|job_closed' and pg_temp.msnap() = s0);
  if l7 is not null then
    v := v || pg_temp.chk('F1b', 'ติ๊กแถวของใบ done (J7) → job_closed · ยกเลิกติ๊กก็ปฏิเสธ', pg_temp.hint(pg_temp.mk(a, array[l7], true)) = '22023|job_closed' and pg_temp.hint(pg_temp.mk(a, array[l7], false)) = '22023|job_closed' and pg_temp.msnap() = s0);
  end if;
  v := v || pg_temp.chk('F2', 'ติ๊ก/ยกเลิกติ๊กแถวของใบที่ขั้นฝังรับแล้ว (J4) → 22023/gem_stage_started · ไม่เขียนอะไร',
    pg_temp.hint(pg_temp.mk(a, array[l4], true)) = '22023|gem_stage_started' and pg_temp.hint(pg_temp.mk(a, array[l4], false)) = '22023|gem_stage_started' and pg_temp.msnap() = s0
    and (select ordered_at from analytics.job_gem_bom where id = l4) is null);
  ok := (l5 is null or pg_temp.hint(pg_temp.mk(a, array[l5], true)) = '22023|gem_stage_started') and (l6 is null or pg_temp.hint(pg_temp.mk(a, array[l6], true)) = '22023|gem_stage_started');
  v := v || pg_temp.chk('F3', 'ติ๊กแถวของใบที่ไม่มีขั้นฝัง (J5) / ขั้นฝังถูกข้าม (J6) → gem_stage_started · ไม่เขียนอะไร (fixture ที่สร้างไม่ได้ = SKIP ใน S2/S3)', ok and pg_temp.msnap() = s0);
  -- F4: IDOR ทั้งสองทิศ
  v := v || pg_temp.chk('F4', '🔴 IDOR: line_id ของร้าน B ผ่านร้าน A → purchase_line_not_found · line_id ของร้าน A ผ่านร้าน B (owner ร้าน B) → purchase_line_not_found · ไม่เขียนอะไร · ข้อความเดียวกับ uuid ที่ไม่มีจริง',
    pg_temp.hint(pg_temp.mk(a, array[lb], true)) = '22023|purchase_line_not_found' and pg_temp.hint(pg_temp.mk(b, array[l1], true, pg_temp.stf())) = '22023|purchase_line_not_found'
    and pg_temp.hint(pg_temp.mk(a, array[gen_random_uuid()], true)) = '22023|purchase_line_not_found' and pg_temp.msnap() = s0
    and (select ordered_at from analytics.job_gem_bom where id = lb) is null);
  -- F5: ชุดผสม (แถวถูกต้อง + แถวใบปิด) → ปฏิเสธทั้งชุด แถวถูกต้องไม่ถูกติ๊ก
  r := pg_temp.mk(a, array[l1, l3], true);
  v := v || pg_temp.chk('F5', 'ชุดผสม [แถวถูกต้อง J1 + แถวใบ cancelled J3] → job_closed ทั้งชุด · แถว J1 ไม่ถูกติ๊ก (all-or-nothing) · log ไม่ขยับ',
    pg_temp.hint(r) = '22023|job_closed' and (select ordered_at from analytics.job_gem_bom where id = l1) is null and pg_temp.msnap() = s0);
  -- F6: input ผิด
  select array_agg(gen_random_uuid()) into ids201 from generate_series(1, 201);
  v := v || pg_temp.chk('F6', 'input ผิด: ids ว่าง/null/มี null/201 แถว/2 มิติ → purchase_lines_invalid · ordered null → ordered_invalid · ไม่เขียนอะไร · 200 แถวพอดีผ่านด่านรูปร่าง (ไปตกที่ not_found — ต้องไม่พัง)',
    pg_temp.hint(pg_temp.q(format('select analytics.gem_purchase_mark(%L, null, true, %L)', a, pg_temp.own()))) = '22023|purchase_lines_invalid'
    and pg_temp.hint(pg_temp.q(format('select analytics.gem_purchase_mark(%L, %L::uuid[], true, %L)', a, '{}', pg_temp.own()))) = '22023|purchase_lines_invalid'
    and pg_temp.hint(pg_temp.q(format('select analytics.gem_purchase_mark(%L, ARRAY[%L::uuid, null::uuid], true, %L)', a, l1, pg_temp.own()))) = '22023|purchase_lines_invalid'
    and pg_temp.hint(pg_temp.mk(a, ids201, true)) = '22023|purchase_lines_invalid'
    and pg_temp.hint(pg_temp.q(format('select analytics.gem_purchase_mark(%L, %L::uuid[], true, %L)', a, format('{{%s,%s},{%s,%s}}', l1, l1, l1, l1), pg_temp.own()))) = '22023|purchase_lines_invalid'
    and pg_temp.hint(pg_temp.q(format('select analytics.gem_purchase_mark(%L, ARRAY[%L::uuid], null, %L)', a, l1, pg_temp.own()))) = '22023|ordered_invalid'
    and pg_temp.hint(pg_temp.mk(a, ids201[1:200], true)) = '22023|purchase_line_not_found'
    and pg_temp.msnap() = s0);
  return v;
end;
$c$;

-- ============================================================================
-- P. สิทธิ์: staff/คนนอก/สมาชิกร้านอื่น · actor ว่าง · anon/authenticated · ตาราง/วิว · overload · search_path
-- ============================================================================
create function pg_temp.g_perm() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A'); b uuid := pg_temp.fx('B');
  l1 uuid := pg_temp.lid(pg_temp.fx('J1'), pg_temp.fx('iR'));
  s0 text; r record; who text; sql_ text; bad text := ''; n int; ok boolean; w text; x uuid;
  c_rpc constant text[] := array['gem_purchase_summary', 'gem_purchase_mark', 'gem_purchase_summary_cost'];
begin
  s0 := pg_temp.msnap();
  ok := true;
  foreach x in array array[pg_temp.stf(), pg_temp.nom(), '00000000-0000-0000-0000-0000000000b2'::uuid] loop
    if pg_temp.hint(pg_temp.sm(a, x)) <> '42501|gem_actor_forbidden' or pg_temp.hint(pg_temp.mk(a, array[l1], true, x)) <> '42501|gem_actor_forbidden' then
      ok := false; bad := bad || x::text || ' ';
    end if;
  end loop;
  v := v || pg_temp.chk('P1', '🔴 staff (สมาชิกร้าน A ระดับ staff · เป็น owner ร้าน B) · ผู้ใช้ที่ไม่ใช่สมาชิก · uuid มั่ว: สรุป + ติ๊ก → 42501/gem_actor_forbidden · ไม่เขียนอะไร · ที่หลุด: ' || coalesce(nullif(bad, ''), 'ไม่มี'),
    ok and pg_temp.msnap() = s0);
  v := v || pg_temp.chk('P1c', '🔴 ต้นทุน: staff · คนนอก · ผู้ใช้มั่ว → 42501/gem_actor_forbidden (ราคาพลอย = ต้นทุน) · actor ว่างทั้ง 3 RPC → 22023/actor_required',
    pg_temp.hint(pg_temp.cs(a, pg_temp.stf())) = '42501|gem_actor_forbidden' and pg_temp.hint(pg_temp.cs(a, pg_temp.nom())) = '42501|gem_actor_forbidden'
    and pg_temp.err(format('select analytics.gem_purchase_summary_cost(%L, null)', a)) = '22023|actor_required'
    and pg_temp.err(format('select analytics.gem_purchase_summary(%L, null)', a)) = '22023|actor_required'
    and pg_temp.err(format('select analytics.gem_purchase_mark(%L, ARRAY[%L::uuid], true, null)', a, l1)) = '22023|actor_required');
  -- P1b: admin ผ่านทั้ง 3 (ต้องไม่พัง) — ติ๊กแล้วยกเลิกคืน
  v := v || pg_temp.chk('P1b', 'admin (สมาชิกระดับ admin) ใช้ได้ทั้ง 3 RPC: สรุป · ติ๊ก · ต้นทุน (ต้องไม่พัง — ตรงกับ "owner/admin เท่านั้น")',
    pg_temp.sm(a, pg_temp.adm()) ->> '_err' is null and pg_temp.cs(a, pg_temp.adm()) ->> '_err' is null
    and (pg_temp.mk(a, array[l1], true, pg_temp.adm()) ->> 'changed') = '1' and (select ordered_by from analytics.job_gem_bom where id = l1) = pg_temp.adm()
    and (pg_temp.mk(a, array[l1], false, pg_temp.adm()) ->> 'changed') = '1');
  -- P2: 18.5 จำลองกำแพงสคีมาหลุด แล้วยิงทั้ง 3 RPC ด้วย null ทุกพารามิเตอร์ในฐานะ anon/authenticated → ตก 42501 (Postgres เช็ค EXECUTE ก่อน body)
  grant usage on schema analytics to anon, authenticated;
  bad := '';
  foreach who in array array['anon', 'authenticated'] loop
    for r in select p.proname, p.pronargs from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = any (c_rpc) order by p.proname loop
      sql_ := format('select analytics.%I(%s)', r.proname, (select coalesce(string_agg('null', ', '), '') from generate_series(1, r.pronargs)));
      if pg_temp.asrole(who, sql_) <> '42501' then bad := bad || who || ':' || r.proname || '; '; end if;
    end loop;
  end loop;
  revoke usage on schema analytics from anon, authenticated;
  v := v || pg_temp.chk('P2', '18.5: ยิง RPC 3 ตัวด้วย null ทุกพารามิเตอร์ในฐานะ anon และ authenticated (จำลองกำแพงสคีมาหลุด) → ตก 42501 ทั้งหมด · ที่หลุด: ' || coalesce(nullif(bad, ''), 'ไม่มี'), bad = '');
  -- P3: วิว/ตาราง log: role ฝั่งแอป (รวม service_role) อ่านตรงไม่ได้ · เขียนคอลัมน์ติ๊กตรงไม่ได้
  ok := true;
  foreach w in array array['analytics.v_gem_purchase_job', 'analytics.v_gem_purchase_line', 'analytics.v_gem_purchase_summary', 'analytics.gem_purchase_mark_log'] loop
    foreach who in array array['anon', 'authenticated', 'service_role'] loop
      if has_table_privilege(who, w, 'select') or pg_temp.asrole(who, 'select count(*) from ' || w) <> '42501' then ok := false; bad := bad || who || ':' || w || '; '; end if;
    end loop;
  end loop;
  v := v || pg_temp.chk('P3', 'วิว 3 ตัว + ตาราง log: anon/authenticated/service_role อ่านตรงไม่ได้ (42501) · service_role UPDATE/INSERT job_gem_bom (ตั้ง ordered_*) ตรงไม่ได้ · ที่หลุด: ' || coalesce(nullif(bad, ''), 'ไม่มี'),
    ok and pg_temp.asrole('service_role', 'update analytics.job_gem_bom set ordered_at = now()') = '42501'
    and pg_temp.asrole('service_role', 'delete from analytics.gem_purchase_mark_log') = '42501');
  -- P4: ไม่มี overload · definer pin search_path · EXECUTE: RPC = service_role เท่านั้น · helper trigger ไม่มี role ไหน · ทั้งสคีมาไม่มี PUBLIC/anon/authenticated
  select count(*) into n from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = any (c_rpc || array['job_gem_bom_ordered_log']);
  bad := '';
  for r in select p.oid, p.proname, p.prosecdef, p.proconfig, p.proacl from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = any (c_rpc || array['job_gem_bom_ordered_log']) loop
    if has_function_privilege('anon', r.oid, 'execute') or has_function_privilege('authenticated', r.oid, 'execute') or r.proacl is null
       or exists (select 1 from aclexplode(r.proacl) a2 where a2.grantee = 0 and a2.privilege_type = 'EXECUTE')
       or has_function_privilege('service_role', r.oid, 'execute') is distinct from (r.proname = any (c_rpc))
       or (r.proname = any (c_rpc) and (not r.prosecdef or not exists (select 1 from unnest(coalesce(r.proconfig, '{}')) cfg where cfg like 'search_path=%'))) then
      bad := bad || r.proname || '; ';
    end if;
  end loop;
  v := v || pg_temp.chk('P4', 'ฟังก์ชันใหม่ 4 ตัว: ไม่มี overload (ชื่อละ 1 signature) · RPC security definer + pin search_path · EXECUTE = service_role เท่านั้น (trigger function ไม่มี role ไหน) · ที่ผิด: ' || coalesce(nullif(bad, ''), 'ไม่มี'),
    bad = '' and n = 4 and not exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a3 where p.pronamespace = 'analytics'::regnamespace and a3.privilege_type = 'EXECUTE' and (a3.grantee = 0 or a3.grantee = 'anon'::regrole or a3.grantee = 'authenticated'::regrole)));
  -- P6: กำแพงที่ตาราง (CHECK): ordered ทั้งสามค่าไป/มาพร้อมกัน · qty > 0
  v := v || pg_temp.chk('P6', 'CHECK ที่ตาราง: ตั้ง ordered_at ค่าเดียว → 23514 · ordered_qty = 0 → 23514 · ตั้งครบสามค่าผ่าน (แล้วถอยกลับด้วยการล้าง — ต้องไม่พัง)',
    pg_temp.err(format('update analytics.job_gem_bom set ordered_at = now() where id = %L', l1)) = '23514|'
    and pg_temp.err(format('update analytics.job_gem_bom set ordered_at = now(), ordered_by = %L, ordered_qty = 0 where id = %L', pg_temp.own(), l1)) = '23514|'
    and pg_temp.err(format('update analytics.job_gem_bom set ordered_at = now(), ordered_by = %L, ordered_qty = 6 where id = %L', pg_temp.own(), l1)) = 'OK'
    and pg_temp.err(format('update analytics.job_gem_bom set ordered_at = null, ordered_by = null, ordered_qty = null where id = %L', l1)) = 'OK');
  -- P7: ใบ cancelled: UPDATE ตรงที่ตั้ง ordered_* ตก job_closed (กำแพงที่ตาราง ผ่าน job_gem_bom_guard — แม้ RPC ถูกแก้ผิด)
  v := v || pg_temp.chk('P7', 'ใบ cancelled (J3): UPDATE job_gem_bom ตั้ง ordered_* ตรง → 22023/job_closed (กำแพงที่ตาราง)',
    pg_temp.err(format('update analytics.job_gem_bom set ordered_at = now(), ordered_by = %L, ordered_qty = 8 where job_id = %L', pg_temp.own(), pg_temp.fx('J3'))) = '22023|job_closed');
  v := v || pg_temp.chk('P9', 'ร้าน B มองไม่เห็นยอดร้าน A และกลับกัน: สรุปร้าน B มีเฉพาะใบ B (1 กลุ่ม) · สรุปร้าน A ไม่มีรายการ/ใบของ B',
    (pg_temp.sm(b, pg_temp.stf()) -> 'totals' ->> 'groups') = '1' and (pg_temp.sm(b, pg_temp.stf()) -> 'totals' ->> 'jobs') = '1'
    and not pg_temp.in_sm(pg_temp.sm(b, pg_temp.stf()), pg_temp.fx('J1')) and not pg_temp.in_sm(pg_temp.sm(a), pg_temp.fx('JBx')));
  return v;
end;
$c$;

-- ============================================================================
-- รวมกลุ่มเทสต์หลัก (ใช้ซ้ำใน mutant) · snapshot ตารางจริง · mutant · runner
-- ============================================================================
create function pg_temp.g_all() returns text
 language plpgsql as $c$
declare v text := '';
begin
  v := v || pg_temp.g_setup();
  v := v || pg_temp.g_sum();
  v := v || pg_temp.g_cost();
  v := v || pg_temp.g_mark();
  v := v || pg_temp.g_forbid();
  v := v || pg_temp.g_perm();
  return v;
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
-- M. mutant: ถอด/ย้อนด่านทีละตัวแล้วเทสต์ต้องล้มจริง (id ที่คาด) — ไม่ล้ม = เทสต์ไม่ได้ป้องกันด่านนั้น
--    step = [ชนิด f|v, เป้าหมาย, ข้อความเดิม (v = regexp), ข้อความใหม่]
-- ============================================================================
create function pg_temp.g_mut() returns text
 language plpgsql as $c$
declare
  v text := ''; s text; k int; muts jsonb; m jsonb; st jsonb; hit int; i text; killed int := 0; total int;
  sg_mark constant text := 'analytics.gem_purchase_mark(uuid,uuid[],boolean,uuid)';
  sg_sum constant text := 'analytics.gem_purchase_summary(uuid,uuid)';
  sg_cost constant text := 'analytics.gem_purchase_summary_cost(uuid,uuid)';
begin
  muts := jsonb_build_array(
    jsonb_build_object('id', 'MU1', 'what', 'ติ๊กไม่ตรวจใบ done/cancelled (ตกไปที่ด่านขั้นฝังแทน — hint ผิด)', 'steps', jsonb_build_array(jsonb_build_array('f', sg_mark, 'where g.id = any (v_ids) and j.status in (''done'', ''cancelled'');', 'where g.id = any (v_ids) and false;')), 'expect', jsonb_build_array('F1', 'F5')),
    jsonb_build_object('id', 'MU2', 'what', 'ติ๊กไม่ตรวจว่าขั้นฝังยังไม่รับ (ใบที่รับแล้ว/ไม่มีขั้นฝัง/ข้าม ติ๊กได้)', 'steps', jsonb_build_array(jsonb_build_array('f', sg_mark, 'and not exists (select 1 from analytics.v_gem_purchase_line l where l.line_id = g.id);', 'and false;')), 'expect', jsonb_build_array('F2')),
    jsonb_build_object('id', 'MU3', 'what', 'IDOR: ล็อก/หาแถวพลอยโดยไม่กรองร้าน (line_id ร้านอื่นผ่านด่านค้นหา)', 'steps', jsonb_build_array(jsonb_build_array('f', sg_mark, 'select g.id from analytics.job_gem_bom g where g.shop_id = p_shop_id and g.id = any (v_ids) order by g.id for update) x;', 'select g.id from analytics.job_gem_bom g where g.id = any (v_ids) order by g.id for update) x;')), 'expect', jsonb_build_array('F4')),
    jsonb_build_object('id', 'MU4', 'what', '🔴 ต้นทุนใช้ canonical แทน gem_item_id ใน snapshot (ราคาของ A ถูกแทนด้วยราคาของ B)', 'steps', jsonb_build_array(jsonb_build_array('f', sg_cost, 'where p.gem_item_id = l.snapshot_item_id', 'where p.gem_item_id = l.canonical_item_id')), 'expect', jsonb_build_array('C4')),
    jsonb_build_object('id', 'MU5', 'what', '🔴 สรุป (ไม่ใช่ cost) แอบแนบราคา', 'steps', jsonb_build_array(jsonb_build_array('f', sg_sum, '''job_count'', s.job_count,', '''job_count'', s.job_count, ''price'', (select max(p.price_thb_per_unit) from analytics.gem_item_price p where p.shop_id = p_shop_id),')), 'expect', jsonb_build_array('L1')),
    jsonb_build_object('id', 'MU6', 'what', 'RPC ต้นทุนไม่ตรวจ actor owner/admin (staff อ่านต้นทุนได้)', 'steps', jsonb_build_array(jsonb_build_array('f', sg_cost, E'  perform analytics.gem_require_office(p_shop_id, p_actor);\n  with lp as (', E'  with lp as (')), 'expect', jsonb_build_array('P1c')),
    jsonb_build_object('id', 'MU7', 'what', '🔴 ไม่มีราคา → นับเป็น 0 (ตัวเลขเดา) แทน null + missing_price', 'steps', jsonb_build_array(jsonb_build_array('f', sg_cost, 'case when g.missing_price_remaining then null else round(coalesce(g.raw_remaining, 0), 2) end as cost_remaining_thb', 'round(coalesce(g.raw_remaining, 0), 2) as cost_remaining_thb')), 'expect', jsonb_build_array('C2', 'C3')),
    jsonb_build_object('id', 'MU8', 'what', 'ราคาที่มีผลในอนาคตถูกใช้ (ไม่จำกัด effective_from <= วันนี้ไทย)', 'steps', jsonb_build_array(jsonb_build_array('f', sg_cost, ' and p.effective_from <= v_today', '')), 'expect', jsonb_build_array('C3')),
    jsonb_build_object('id', 'MU9', 'what', 'ติ๊กซ้ำไม่ idempotent (เขียนทับ+log ทุกครั้ง)', 'steps', jsonb_build_array(jsonb_build_array('f', sg_mark, 'and (g.ordered_at is null or g.ordered_qty is distinct from g.qty_per_piece::bigint * j.qty_planned)', 'and true')), 'expect', jsonb_build_array('M2')),
    jsonb_build_object('id', 'MU10', 'what', 'ใบ cancelled/done นับในยอด (view นับสถานะปิด · R8 นับซ้ำ)', 'steps', jsonb_build_array(jsonb_build_array('v', 'analytics.v_gem_purchase_job', '''on_hold''::text\]', '''on_hold''::text, ''cancelled''::text]')), 'expect', jsonb_build_array('A2', 'A3')),
    jsonb_build_object('id', 'MU11', 'what', 'ขั้นฝังที่รับแล้ว (received) ยังนับเป็น "ยังไม่รับ" (view)', 'steps', jsonb_build_array(
        jsonb_build_array('v', 'analytics.v_gem_purchase_job', 'gs\.status = ''pending''::text', 'gs.status = ANY (ARRAY[''pending''::text, ''received''::text])'),
        jsonb_build_array('v', 'analytics.v_gem_purchase_job', 'ARRAY\[''received''::text, ''sent''::text\]', 'ARRAY[''sent''::text]')), 'expect', jsonb_build_array('A3', 'A4')));
  total := jsonb_array_length(muts);
  for k in 0 .. total - 1 loop
    m := muts -> k; s := '';
    begin
      for st in select value from jsonb_array_elements(m -> 'steps') loop
        if (st ->> 0) = 'f' then
          perform pg_temp.mutate(st ->> 1, st ->> 2, st ->> 3);
        else
          perform pg_temp.mutate_view(st ->> 1, st ->> 2, st ->> 3);
        end if;
      end loop;
      s := pg_temp.g_all();
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
        case when position('MX-crash-' || (m ->> 'id') in s) > 0 then ' · ' || substr(s, position('MX-crash-' || (m ->> 'id') in s), 160) else '' end) || E'\n';
    end if;
  end loop;
  v := v || pg_temp.chk('MX', format('mutant ถูกจับครบ %s/%s', killed, total), killed = total);
  return v;
end;
$c$;

-- ============================================================================
-- runner
-- ============================================================================
do $v192$
declare
  v_msg text := E'\n=== verify 0192 ===\n';
  v_snap0 text; v_hit int; v_fail int; v_ok int; v_skip int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  create temp table _v192_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h, p.proacl::text as acl
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p');
  v_snap0 := pg_temp.snap();
  begin
    v_msg := v_msg || pg_temp.g_all();
    v_msg := v_msg || pg_temp.g_mut();
    select count(*) into v_hit from _v192_orig o join pg_proc p on p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p') and p.oid::regprocedure::text = o.sig
     where md5(pg_get_functiondef(p.oid)) = o.h and p.proacl::text is not distinct from o.acl;
    v_msg := v_msg || pg_temp.chk('MY', format('หลัง mutant: md5 นิยาม + สิทธิ์ของฟังก์ชันทุกตัวในสคีมา analytics (%s ตัว) เท่าเดิมเป๊ะ', (select count(*) from _v192_orig)),
      v_hit = (select count(*) from _v192_orig) and (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and prokind in ('f', 'p')) = (select count(*) from _v192_orig));
    v_msg := v_msg || pg_temp.chk('MV', 'หลัง mutant: view ยอดสั่งกลับเป็นนิยามเดิม (ไม่นับ cancelled · ขั้นฝัง pending เท่านั้น) — pg_get_viewdef ไม่มี cancelled และไม่มี received',
      position('cancelled' in pg_get_viewdef('analytics.v_gem_purchase_job'::regclass, true)) = 0 and position('received' in pg_get_viewdef('analytics.v_gem_purchase_job'::regclass, true)) > 0);
    raise exception 'V192_ROLLBACK';
  exception when others then
    if sqlerrm <> 'V192_ROLLBACK' then v_msg := v_msg || format('[FAIL] S1-crash  ชุดหลัก raise นอกกลุ่ม: %s %s', sqlstate, sqlerrm) || E'\n'; end if;
  end;
  v_msg := v_msg || pg_temp.chk('K0', 'ชุดทดสอบไม่ทิ้งรอย: snapshot (job/ใบผลิต/ตัวนับ/QR/ช่าง/session/product/shop/สมาชิก/ตารางพลอยทั้งหมด/log การติ๊ก/audit) เท่าเดิมหลังถอยกลับ', pg_temp.snap() = v_snap0);
  v_fail := (length(v_msg) - length(replace(v_msg, '[FAIL]', ''))) / length('[FAIL]');
  v_skip := (length(v_msg) - length(replace(v_msg, '[SKIP]', ''))) / length('[SKIP]');
  v_ok := (length(v_msg) - length(replace(v_msg, '[OK]', ''))) / length('[OK]');
  v_msg := v_msg || format(E'\n--- สรุป: OK %s · FAIL %s · SKIP %s ---', v_ok, v_fail, v_skip);
  raise exception '%', v_msg;
end;
$v192$;

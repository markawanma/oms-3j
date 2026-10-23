-- scripts/verify/verify-0191.sql
-- ตรวจ supabase/migrations/0191_gems_w3.sql (W3: ผู้จัดการกรอก/แก้พลอยจากมือถือ · QR ร้าน + PIN · เปิดใบพร้อมพลอย · แก้พลอยของใบที่ตัวเองเปิดจนช่างเริ่มรับงาน · อ่านพลอย · แคตตาล็อกสำหรับหน้างาน · "ใบที่ฉันเปิด" + บรรทัดพลอย)
-- self-rolling-back (3j-migration-traps ข้อ 11): ทุกเคสอยู่ในทรานแซกชันเดียว จบด้วย `raise exception` เสมอ ⇒ ถอยทั้งก้อน · อ่านผลจาก error message · exit 1 คือผลที่คาด · [FAIL] >= 1 = ไม่ผ่าน
-- ต้องมี 0172-0190 อยู่ใน DB แล้ว · dry-run: ต่อ 0191 + ไฟล์นี้ (ไฟล์ LF — ข้อ 20) เป็นไฟล์เดียวแล้วรันไม่ใส่ --commit · หลัง apply: รันไฟล์นี้เดี่ยวๆ ได้
-- 🔴 รันนอกเวลาทำงานเท่านั้น และห้ามรันพร้อม session/agent อื่น: ไฟล์นี้ `alter table ... disable trigger` (user trigger) บน analytics.worker และ analytics.worker_session ในทรานแซกชันเพื่อจำลอง session หมดอายุ/ช่างปิดใช้ — คำสั่งนี้ขอล็อก SHARE ROW EXCLUSIVE ของสองตารางนี้ และล็อกค้างจนทรานแซกชันจบ (หลายนาที เพราะมี mutant ต่อท้าย) ⇒ การเขียนตาราง worker/worker_session ของคนอื่นระหว่างนั้น (ช่างล็อกอิน PIN · ผู้จัดการเปิดใบมือถือ) จะค้างรอจนไฟล์จบ · อ่านได้ปกติ · ไฟล์ถอยกลับเองเสมอ ไม่ทิ้งรอย (verify-0191-qa.sql ใช้คำสั่งเดียวกัน ข้อควรระวังเหมือนกัน)
-- ข้อมูลทดสอบ: ร้านสังเคราะห์ ZZ TEST verify-0191 A/B (insert public.shop + public.shop_member ตรง ตามแพทเทิร์น verify-0189/0190 — ข้อยกเว้นเดียวที่ไม่ผ่าน RPC · ยืม auth user จริงของร้านเป็นสมาชิกร้านสังเคราะห์ในทรานแซกชันนี้เท่านั้น)
--   ช่าง/QR ร้าน/SKU/ใบผลิต/ใบงาน/ชนิด/รูปทรง/ราคา/แม่แบบ/พลอยในใบ สร้างผ่าน RPC ของระบบทั้งหมด · ข้อยกเว้น (บอกตรงๆ): UPDATE worker_session.expires_at (จำลอง session หมดอายุ) · DELETE worker_rate_limit (ล้างถัง) · ทั้งสองเป็นการ์ดของ fixture ในทรานแซกชันที่ถอยกลับ
-- 🔴 ไม่แตะตัวนับเอกสารภาษี · production_order_done ต้อง md5 เดิม (Z1) · ราคาทดสอบเป็นเลขแปลกที่ไม่ซ้ำกับค่าอื่น (7391.2468 · 9999.9999 · 1234.5678) เพื่อ grep หาการรั่วในทุก response
--
-- ============ ตารางแมป "ข้อในบรีฟ → เทสต์ที่ครอบ" (ข้อไหนไม่มีเทสต์ครอบ = เขียนว่า "ไม่มี" พร้อมเหตุผล) ============
--  เคสห้ามผ่าน (ด่านที่ตก)
--   ไม่มี session / หมด / ช่าง inactive / ถอน can_open (ด่าน shop_intake_gem_auth · open: shop_intake_auth) -> เปิดใบ O13a O13b O13c O13e O13f · แก้ G8a G8b G8c G8d G8e · อ่าน/แคตตาล็อก (gem_get · gem_catalog) ตกด่านเดียวกัน: G8a G8d G8e G8g · ถังไม่เผาของผู้จัดการ G8h G8r3 · mutant MU12 MU13 MU13b MU13c MU15 MU15c
--   token ร้านเพิกถอน (invalid_token)                                                                    -> O13d G8g G8i (แก้+อ่าน+แคตตาล็อกครบ) · mutant MU14
--   ใบของช่างอื่น / ใบออฟฟิศ / ร้านอื่น / ไม่พบ (order_not_found ข้อความเดียวกัน · ด่านที่ job_worker_photo_job) -> G3a G3b G3c G3d G3e (G3a-G3d ยิงทั้ง gem_set และ gem_get · G3e เฉพาะ gem_set) · mutant MU2 MU16
--   ส่วนย่อย (lot child)                                                                                 -> G3f (id ของส่วนย่อยถูกปฏิเสธ) · ❌ ไม่มีเทสต์ trigger job_gem_bom_guard ฝั่งส่วนย่อย (ของ 0190 — ต้องเปิดแบ่งล็อต)
--   ใบ done / cancelled                                                                                   -> G4c (cancelled) G4d (done = ใบผลิตปิด) · mutant MU21 · ❌ on_hold: ไม่มี RPC ที่ตั้งสถานะนี้ (ถึงไม่ได้) จึงไม่มีเทสต์ — โค้ด job_not_open อยู่ใน job_worker_gem_block
--   ขั้นแรกรับแล้ว (รวม race "รับระหว่างแก้": get editable → รับ → บันทึก)                                  -> G4a (รวมลำดับ get → รับ → บันทึก) G4b · mutant MU1 MU23 · ❌ race จริง 2 connection ไม่มีเทสต์ (do-block เป็น connection เดียว · ล็อกแถวใบพิสูจน์ได้แค่ว่าอยู่ในนิยาม: G4f)
--   ใบไม่มีขั้นฝัง (no_gem_stage)                                                                         -> G5a G5b · mutant MU4
--   แถวผิด: qty 0/NaN/>1000/ไม่ใช่เลขเต็ม · ขนาดผิด · has_length ไม่ตรง · >30 แถว · ชนิด/รูปทรง/รายการร้านอื่น · ปิดใช้งาน · คีย์แปลก (price) · ชื่อผิด · ตำแหน่งผิด
--        -> เปิดใบ O8q O8s O8h O8l O8t O8k O8n O8p O8x (ไม่มีอะไรถูกสร้าง O8z) · แก้ G6q G6s G6h G6l G6t G6k G6n G6p G6z (BOM/event ไม่ขยับ) · "merged" = resolve ไปปลายทาง (ตามมติ G1a design §9.3 — ตัดสินเอง) O8m1 O8m2 · mutant MU17
--   force โดยไม่ถูกถาม / blanket / ชื่อซ้ำเป๊ะ + force                                                    -> เปิดใบ O9c O9d O9e O9f O9g · แก้ G7c G7d G7e G7f · mutant MU5 MU6 MU7
--   'has' แต่ 0 แถว · SKU ไม่มีแม่แบบไม่ตอบ ('template') · answer/args ผิด                                    -> O7 O6 O12 · mutant MU10 MU11
--   พลอยผิดตอนเปิด → ไม่มี PO/ใบงาน/ตัวนับ/QR/event/ชื่อใหม่เกิด                                            -> O8z O9a O11 O12 O13a-O13f (allst เท่าเดิม: PO/job/token/event/ตัวนับ/ชนิด/รูปทรง/รายการ/BOM)
--   ราคาไม่อยู่ในทุก response (ตั้งราคาเลขแปลกแล้ว grep ทุกผลลัพธ์ + key)                                    -> X1 (เปิด/replay/get/catalog/set ok/similar/invalid/conflict/list/resolve หน้าช่าง) X1b (event) X1c (ราคายังอยู่ทาง RPC ราคา = เทสต์รั่วมีความหมาย)
--   ใบมีพลอยแต่ไม่มีขั้นฝัง (ขั้น gem_set ถูกปิดใช้ในร้าน → has/template ต้องถอยทั้งก้อน not_ready ไม่ใช่สำเร็จเงียบๆ) -> O15a O15b · mutant MU29
--   ชื่อพลอยใหม่ท่วมแคตตาล็อก (เพดาน 40 ชื่อ/ผู้จัดการ/24 ชม. — ตัดสินเอง ไม่ได้อยู่ในบรีฟ) -> เปิดใบ O14a-O14e (รวมต่อใบ) · O14f (นับต่อผู้จัดการ: ชนิด) O14g (นับต่อผู้จัดการ: รูปทรง) · แก้ G9a-G9d · mutant MU26 MU27 (ชนิด) MU27b (รูปทรง) MU28
--   รายการพลอยใหม่ท่วมตาราง gem_item ด้วยขนาดขยะ (เพดาน 120 รายการ/ผู้จัดการ/24 ชม. — security M1) -> เปิดใบ O16a-O16d · แก้ G10a-G10d · mutant MU30 (MU28 ครอบการแปลง gem_name_cap ของทั้งชื่อและรายการ)
--   รายการที่ออฟฟิศปิดใช้ทีหลังและอยู่ในใบอยู่แล้ว ต้องไม่ทำให้ผู้จัดการแก้ใบนั้นไม่ได้ (ต้องไม่พัง) + รายการปิดใช้ที่ไม่อยู่ในใบต้องยังถูกปฏิเสธ gem_inactive (security M2) -> G11a G11b (ไม่พัง) G11c G11d (ห้ามผ่าน) · mutant MU31
--   (เทสต์ฟีเจอร์ปกติที่ไม่ได้ผูกกับเคสห้ามผ่านข้อใดโดยตรง) -> R1 R1b (อ่าน) · G1-G1f (แก้จริง) · G2b G2c (CAS เพิ่มเติม) · O1-O4 O1b-O1e O3b O10b (เปิดใบพร้อมพลอยทุกคำตอบ) · O9a-O9g2 · C1-C1e (แคตตาล็อก) · L1a-L1e (ใบที่ฉันเปิด + บรรทัดพลอย) · X1a · G4pre G6u G6x · S0 (setup) · K0 (ไม่ทิ้งรอย) · MX MY (สรุป mutant / md5 ฟังก์ชันเท่าเดิม)
--   anon/authenticated execute · overload · service_role เฉพาะ RPC                                         -> P1 P2 P3 P4 P5 (18.5) · mutant — (ครอบด้วย post-check ของ migration + P1-P5 · ไม่มี mutant — เหตุ: สิทธิ์เป็นผลของ grant ไม่ใช่ตรรกะในนิยามฟังก์ชัน)
--  ต้องไม่พัง
--   job_worker_open เดิมทุกแบบเมื่อไม่ส่งพลอย (ไม่มีแม่แบบ/ไม่มี SKU/มีแม่แบบ → ได้ขั้นฝัง+คัดลอก) / replay เดิม      -> O0 O0b O0c O10 (+ รัน verify-0187/0188/0189/0190 แยก — ต้อง 0 FAIL)
--   ใบออฟฟิศ/แม่แบบ SKU เดิม · office แก้พลอยของใบที่ผู้จัดการเปิด · create ด้วย p_gem_lines ของ office            -> Z2 Z3 Z4
--   W2 รูป · "ใบที่ฉันเปิด" เดิม (editable · photos_count · ไม่เห็นใบคนอื่น · ถอนสิทธิ์ = ว่าง)                    -> L2 L3 (+ verify-0189 แยก)
--   golden job_source_info · ฟังก์ชันเดิมทุกตัว md5 เท่าเดิม (post-check ของ migration) · production_order_done · replace_core · prepare · rpc ใหม่/เดิม  -> Z1 Z5 (+ migration post-check (1))
--   ตัวสร้าง "ช่างเห็นพลอยของใบที่ผู้จัดการกรอก" (job_worker_resolve หลัง PIN)                                  -> Z6
-- ไม่มีเทสต์ครอบ (บอกตรงๆ):
--   · การแข่งกันจริงของ 2 connection (ผู้จัดการแก้ vs ช่างรับขั้นแรก · 2 เครื่องแก้พร้อมกัน · 2 คนพิมพ์ชื่อใหม่เดียวกันพร้อมกัน) — do-block เป็น connection เดียว · พิสูจน์ได้แค่ "ตรวจใต้ล็อกแถวใบ" (G4f) + CAS ตามลำดับ (G2) + unique/on conflict ของ 0190
--   · on_hold: ไม่มี RPC ตั้งสถานะ (ไม่มีทางเข้า) · ส่วนย่อยที่มี BOM (trigger ของ 0190)
--   · UI/TS (หน้าจอ W-4/W-10 ยังไม่มี) — เทสต์ TS: lib/jobs/worker-server.gems.test.ts · lib/actions/job-worker.gems.test.ts (mock RPC)
--   · เวลา: หน้าต่างถังจำกัดอัตรา 10 นาที — ไม่ได้จำลองนาฬิกา (นับครั้งเท่านั้น)

set local statement_timeout = '30min';

create temp table _v191_fx (k text primary key, id uuid not null) on commit drop;
create temp table _v191_kv (k text primary key, v text not null) on commit drop;

create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text
 language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n'
$c$;
create function pg_temp.fx(p_k text) returns uuid language sql as $c$ select id from _v191_fx where k = p_k $c$;
create function pg_temp.setfx(p_k text, p_id uuid) returns void language sql as $c$
  insert into _v191_fx (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id $c$;
create function pg_temp.kv(p_k text) returns text language sql as $c$ select v from _v191_kv where k = p_k $c$;
create function pg_temp.setkv(p_k text, p_v text) returns void language sql as $c$
  insert into _v191_kv (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $c$;
-- เก็บ id จากผล RPC ของ fixture — ผลไม่มี id (ล้ม) = หยุดพร้อมบอกผลดิบ (ไม่ให้ null ไหลต่อเงียบๆ)
create function pg_temp.sfx(p_k text, r jsonb) returns void language plpgsql as $c$
begin
  if r ->> 'id' is null then raise exception 'setup % ล้ม: %', p_k, r::text; end if;
  perform pg_temp.setfx(p_k, (r ->> 'id')::uuid);
end;
$c$;
create function pg_temp.own() returns uuid language sql as $c$ select pg_temp.fx('u_owner') $c$;
-- ผู้ทำรายการฝั่งออฟฟิศของร้านนั้น (owner ที่ยืมมาเป็นสมาชิกร้านสังเคราะห์) — แคตตาล็อก/ราคาตรวจว่า actor เป็นสมาชิก owner/admin ของ "ร้านนั้น"
create function pg_temp.afor(p_shop uuid) returns uuid language sql as $c$
  select m.user_id from public.shop_member m where m.shop_id = p_shop and m.role = 'owner' order by m.user_id limit 1 $c$;
create function pg_temp.act() returns uuid language sql as $c$ select '00000000-0000-0000-0000-0000000000a1'::uuid $c$;
create function pg_temp.std() returns text language sql as $c$ select '{wax_inject,wax_tree,invest_burnout,cast,cut_sprue,finish,buff,qc,pack}' $c$;
create function pg_temp.stdg() returns text language sql as $c$ select '{wax_inject,wax_tree,invest_burnout,cast,cut_sprue,finish,buff,gem_set,qc,pack}' $c$;
-- ราคาทดสอบ (เลขแปลก — ต้องไม่โผล่ที่ไหนนอกทาง RPC ราคา)
create function pg_temp.px() returns text language sql as $c$ select '7391.2468' $c$;
-- รัน SQL ที่คืน jsonb: สำเร็จ = ค่าที่คืน · ล้ม = {_err,_state,_hint}
create function pg_temp.q(p_sql text) returns jsonb
 language plpgsql as $c$
declare v jsonb; v_msg text; v_state text; v_hint text;
begin
  execute p_sql into v;
  return coalesce(v, '{}'::jsonb);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
  return jsonb_build_object('_err', v_msg, '_state', v_state, '_hint', v_hint);
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
-- แทนที่ข้อความในนิยามฟังก์ชันแล้ว execute (mutant) — ไม่เจอข้อความ = raise (กัน mutant ที่ไม่ได้ mutate จริง)
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
-- key ทุกระดับของ jsonb (ตรวจว่าผลฝั่งช่างไม่มี key เงิน/ต้นทุน/ลูกค้า)
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
  select coalesce(string_agg(distinct k, ','), '') from pg_temp.keys_deep(j) k where k ~* '(cost|price|thb|margin|unit_cost|customer|profit|buyer|client|quote_?no|po_?no|invoice|receipt|deposit|paid|grand_?total|subtotal|vat|tax_?id|phone|email|address|nre_|baht|supplier|tier|target_piece_g|breakage|created_by|worker_id)' $c$;
-- สแกนทุกราคา ≥ 1,000 ที่ตั้งไว้ในตารางราคา/audit ว่าโผล่ในผลลัพธ์ไหม (ไม่ใช่แค่ราคาปัจจุบัน)
create function pg_temp.has_px(j jsonb) returns boolean language sql as $c$
  select exists (select 1 from analytics.gem_item_price p where p.price_thb_per_unit >= 1000 and position(trim_scale(p.price_thb_per_unit)::text in coalesce(j::text, '')) > 0)
      or exists (select 1 from analytics.gem_item_price_audit a where a.new_price >= 1000 and position(trim_scale(a.new_price)::text in coalesce(j::text, '')) > 0) $c$;
create function pg_temp.ik() returns text language sql as $c$ select 'ik' || replace(gen_random_uuid()::text, '-', '') $c$;
create function pg_temp.th() returns text language sql as $c$ select pg_temp.kv('tokh_a') $c$;

-- ภาพรวมสถานะของร้าน (ใช้เทียบว่า "ไม่มีอะไรเกิด") — รวมตารางพลอย (ไม่รวมราคา)
create function pg_temp.ctr(p_shop uuid) returns text language sql as $c$
  select coalesce((select last_no from analytics.job_counter where shop_id = p_shop), 0) || '/' || coalesce((select last_no from analytics.production_order_counter where shop_id = p_shop), 0) $c$;
create function pg_temp.shop_state(p_shop uuid) returns text language sql as $c$
  select (select count(*) from analytics.production_order where shop_id = p_shop) || '/' || (select count(*) from analytics.job where shop_id = p_shop)
         || '/' || (select count(*) from analytics.job_token where shop_id = p_shop) || '/' || (select count(*) from analytics.job_event where shop_id = p_shop)
         || '/' || pg_temp.ctr(p_shop) || '/' || (select count(*) from analytics.production_order_item where shop_id = p_shop) $c$;
create function pg_temp.gsnap(p_shop uuid) returns text
 language sql as $c$
  select md5(coalesce((select string_agg(t::text, '|' order by t.id) from analytics.gem_type t where t.shop_id = p_shop), '')
          || '#' || coalesce((select string_agg(s::text, '|' order by s.id) from analytics.gem_shape s where s.shop_id = p_shop), '')
          || '#' || coalesce((select string_agg(i::text, '|' order by i.id) from analytics.gem_item i where i.shop_id = p_shop), '')
          || '#' || coalesce((select string_agg(b::text, '|' order by b.id) from analytics.job_gem_bom b where b.shop_id = p_shop), '')
          || '#' || coalesce((select string_agg(b::text, '|' order by b.id) from analytics.product_gem_bom b where b.shop_id = p_shop), '')) $c$;
create function pg_temp.allst(p_shop uuid) returns text language sql as $c$ select pg_temp.shop_state(p_shop) || '#' || pg_temp.gsnap(p_shop) $c$;
create function pg_temp.n_type(p_shop uuid) returns int language sql as $c$ select count(*)::int from analytics.gem_type where shop_id = p_shop $c$;
create function pg_temp.n_shape(p_shop uuid) returns int language sql as $c$ select count(*)::int from analytics.gem_shape where shop_id = p_shop $c$;
create function pg_temp.n_item(p_shop uuid) returns int language sql as $c$ select count(*)::int from analytics.gem_item where shop_id = p_shop $c$;
create function pg_temp.n_bom(p_job uuid) returns int language sql as $c$ select count(*)::int from analytics.job_gem_bom where job_id = p_job $c$;
create function pg_temp.n_bev(p_job uuid) returns int language sql as $c$ select count(*)::int from analytics.job_event where job_id = p_job and event_type = 'bom_change' $c$;
create function pg_temp.n_price() returns bigint language sql as $c$ select (select count(*) from analytics.gem_item_price) + (select count(*) from analytics.gem_item_price_audit) $c$;
create function pg_temp.bomhash(p_job uuid) returns text language sql as $c$
  select coalesce(md5(string_agg(b::text, '|' order by b.line_seq)), 'none') from analytics.job_gem_bom b where b.job_id = p_job $c$;
create function pg_temp.has_stage(p_job uuid) returns boolean language sql as $c$ select exists (select 1 from analytics.job_stage s where s.job_id = p_job and s.stage_code = 'gem_set') $c$;
create function pg_temp.typ(p_shop uuid, p_name text) returns uuid language sql as $c$ select id from analytics.gem_type where shop_id = p_shop and name = p_name $c$;
create function pg_temp.shp(p_shop uuid, p_name text) returns uuid language sql as $c$ select id from analytics.gem_shape where shop_id = p_shop and name = p_name $c$;
create function pg_temp.jid(p_shop uuid, p_job_no text) returns uuid language sql as $c$ select id from analytics.job where shop_id = p_shop and job_no = p_job_no $c$;

-- ============================================================================
-- helper เรียก RPC ฝั่งออฟฟิศ (ใช้สร้าง fixture)
-- ============================================================================
create function pg_temp.wu(p_shop uuid, p_name text, p_pin text, p_id uuid default null, p_codes text default '{qc}', p_open boolean default null, p_ext boolean default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_id=>%L, p_display_name=>%L, p_stage_codes=>%L::text[], p_pin=>%L, p_actor=>%L, p_can_open_job=>%L, p_can_external=>%L)',
    p_shop, p_id, p_name, p_codes, p_pin, pg_temp.act(), p_open, p_ext)) $c$;
create function pg_temp.po(p_shop uuid, p_note text default 'verify0191') returns uuid
 language sql as $c$ select (analytics.production_order_save(p_shop, null, p_note, null) ->> 'id')::uuid $c$;
create function pg_temp.iset(p_shop uuid, p_order uuid, p_product uuid, p_qty int) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>%L)', p_shop, p_order, p_product, p_qty)) $c$;
-- ใบผลิตออฟฟิศ + รายการ + ใบงาน (ผ่าน RPC ออฟฟิศเดิม) · p_codes = text[] literal
create function pg_temp.office_job(p_shop uuid, p_product uuid, p_codes text default null) returns jsonb
 language plpgsql as $c$
declare o uuid; r jsonb; j jsonb;
begin
  o := pg_temp.po(p_shop, 'office-v191');
  r := pg_temp.iset(p_shop, o, p_product, 3);
  j := pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L)',
    p_shop, r ->> 'id', coalesce(p_codes, pg_temp.stdg()), pg_temp.act()));
  return jsonb_build_object('po', o, 'item', r ->> 'id', 'job', j ->> 'job_id', 'job_no', j ->> 'job_no', 'err', j -> '_err', 'res', j);
end;
$c$;
create function pg_temp.icreate(p_shop uuid, p_line jsonb, p_force boolean default false) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_item_create(%L, %L, %L::jsonb, %L)', p_shop, pg_temp.afor(p_shop), p_line, p_force)) $c$;
create function pg_temp.ccreate(p_shop uuid, p_kind text, p_name text, p_hl boolean default null, p_force boolean default false) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_catalog_create(%L, %L, %L, %L, %L, %L)', p_shop, pg_temp.afor(p_shop), p_kind, p_name, p_hl, p_force)) $c$;
create function pg_temp.price(p_shop uuid, p_item uuid, p_price text) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_price_set(%L, %L, %L, %L::numeric, null, null, null)', p_shop, pg_temp.afor(p_shop), p_item, p_price)) $c$;
create function pg_temp.sact(p_shop uuid, p_kind text, p_id uuid, p_active boolean) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_catalog_set_active(%L, %L, %L, %L, %L)', p_shop, pg_temp.afor(p_shop), p_kind, p_id, p_active)) $c$;
create function pg_temp.mrg(p_shop uuid, p_kind text, p_from uuid, p_into uuid) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_merge(%L, %L, %L, %L, %L)', p_shop, pg_temp.afor(p_shop), p_kind, p_from, p_into)) $c$;
create function pg_temp.tset(p_shop uuid, p_product uuid, p_lines jsonb) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.product_gem_bom_set(p_shop_id=>%L, p_product_id=>%L, p_gem_lines=>%L::jsonb, p_actor=>%L, p_force=>false)', p_shop, p_product, p_lines, pg_temp.afor(p_shop))) $c$;
create function pg_temp.oset(p_shop uuid, p_job uuid, p_lines jsonb, p_reason text default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.job_gem_bom_set(p_shop_id=>%L, p_job_id=>%L, p_gem_lines=>%L::jsonb, p_actor=>%L, p_reason=>%L, p_force=>false)', p_shop, p_job, p_lines, pg_temp.act(), p_reason)) $c$;
-- ช่างรับขั้นแรกของใบ (ผ่าน RPC ออฟฟิศเดิม) — ลองไม่ใส่น้ำหนักก่อน ไม่ผ่านค่อยใส่
create function pg_temp.rcv(p_shop uuid, p_job uuid) returns jsonb
 language plpgsql as $c$
declare r jsonb; sq int;
begin
  select min(s.seq) into sq from analytics.job_stage s where s.job_id = p_job and s.status = 'pending';
  r := pg_temp.q(format('select analytics.job_office_receive(%L, %L, %L, %L, null, null, ''x'', ''job_page'', %L)', p_shop, p_job, sq, analytics.job_today(), pg_temp.act()));
  if r ? '_err' or r ->> 'ok' = 'false' then
    r := pg_temp.q(format('select analytics.job_office_receive(%L, %L, %L, %L, %L::numeric, null, ''x'', ''job_page'', %L)', p_shop, p_job, sq, analytics.job_today(), 5, pg_temp.act()));
  end if;
  return r;
end;
$c$;
create function pg_temp.received(p_job uuid) returns boolean
 language sql as $c$ select exists (select 1 from analytics.job_stage s where s.job_id = p_job and s.status in ('received', 'sent')) $c$;
-- จำลอง session หมดอายุ (ปิด trigger ผู้ใช้ชั่วคราวเพราะ CHECK ต้อง issued_at < expires_at) / ช่างถูกปิดใช้โดย "session ยังไม่ถูกเพิกถอน" (worker_set_active เพิกถอน session ให้เอง จึงใช้ UPDATE ตรง — พิสูจน์ว่าด่านเช็ค is_active สดเอง)
create function pg_temp.expire_session(p_hash text) returns void language plpgsql as $c$
begin
  alter table analytics.worker_session disable trigger user;
  update analytics.worker_session set issued_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' where session_hash = p_hash;
  alter table analytics.worker_session enable trigger user;
end;
$c$;
create function pg_temp.deact_raw(p_worker uuid) returns void language plpgsql as $c$
begin
  alter table analytics.worker disable trigger user;
  update analytics.worker set is_active = false where id = p_worker;
  alter table analytics.worker enable trigger user;
end;
$c$;
create function pg_temp.dn(p_shop uuid, p_order uuid) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.production_order_done(%L, %L, null, %L, null)', p_shop, p_order, '{}'::jsonb)) $c$;
create function pg_temp.bind(p_shop uuid, p_item uuid, p_prod uuid) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.production_order_item_bind_product(%L, %L, %L, %L)', p_shop, p_item, p_prod, pg_temp.act())) $c$;
create function pg_temp.ack(p_shop uuid, p_po uuid) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.production_order_acknowledge(%L, %L, %L)', p_shop, p_po, pg_temp.act())) $c$;

-- ============================================================================
-- helper เรียก RPC ฝั่งช่าง (หน้างาน)
-- ============================================================================
create function pg_temp.rlclear(p jsonb) returns void language plpgsql as $c$
begin
  if coalesce(p ->> 'rl', '0') <> '1' then delete from analytics.worker_rate_limit; end if;
end;
$c$;
-- เปิดใบ: p = {idem product label metal purity weight qty planned due newd note ip gl(jsonb) ga gf(jsonb) rl}
create function pg_temp.opn(p_sess text, p jsonb, p_tokh text default null) returns jsonb
 language plpgsql as $c$
begin
  perform pg_temp.rlclear(p);
  return pg_temp.q(format('select analytics.job_worker_open(p_token_hash=>%L, p_session_hash=>%L, p_idem_key=>%L, p_product_id=>%L, p_pending_label=>%L, p_metal=>%L, p_purity=>%L, p_weight_g=>%L, p_qty_order=>%L, p_qty_planned=>%L, p_due_date=>%L, p_is_new_design=>%L, p_note=>%L, p_user_agent=>%L, p_ip_hash=>%L, p_gem_lines=>%L::jsonb, p_gem_answer=>%L, p_gem_force=>%L::jsonb)',
    coalesce(p_tokh, pg_temp.th()), p_sess, coalesce(p ->> 'idem', pg_temp.ik()), p ->> 'product', p ->> 'label', p ->> 'metal', p ->> 'purity', p ->> 'weight',
    coalesce(p ->> 'qty', '2'), p ->> 'planned', p ->> 'due', p ->> 'newd', p ->> 'note', 'verify-ua/1.0', p ->> 'ip', p -> 'gl', p ->> 'ga', p -> 'gf'));
end;
$c$;
-- เปิดใบแบบไม่มี SKU (เงิน) ที่ต้องสำเร็จ → คืนผล + {job, po}
create function pg_temp.go(p_sess text, p jsonb default '{}'::jsonb) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  r := pg_temp.opn(p_sess, case when p ? 'product' then p else jsonb_build_object('label', 'แหวน W3', 'metal', 'silver') || p end);
  if r ->> 'ok' is distinct from 'true' then raise exception 'go ล้ม: %', r::text; end if;
  return r || jsonb_build_object('job', pg_temp.jid(pg_temp.fx('A'), r ->> 'job_no'));
end;
$c$;
create function pg_temp.gst(p_sess text, p_job uuid, p_lines jsonb, p_rev text, p jsonb default '{}'::jsonb, p_tokh text default null) returns jsonb
 language plpgsql as $c$
begin
  perform pg_temp.rlclear(p);
  return pg_temp.q(format('select analytics.job_worker_gem_set(%L, %L, %L, %L::jsonb, %L, %L::jsonb, %L)', coalesce(p_tokh, pg_temp.th()), p_sess, p_job, p_lines, p_rev, p -> 'gf', p ->> 'ip'));
end;
$c$;
create function pg_temp.ggt(p_sess text, p_job uuid, p jsonb default '{}'::jsonb, p_tokh text default null) returns jsonb
 language plpgsql as $c$
begin
  perform pg_temp.rlclear(p);
  return pg_temp.q(format('select analytics.job_worker_gem_get(%L, %L, %L, %L)', coalesce(p_tokh, pg_temp.th()), p_sess, p_job, p ->> 'ip'));
end;
$c$;
create function pg_temp.gct(p_sess text, p_product uuid default null, p jsonb default '{}'::jsonb, p_tokh text default null) returns jsonb
 language plpgsql as $c$
begin
  perform pg_temp.rlclear(p);
  return pg_temp.q(format('select analytics.job_worker_gem_catalog(%L, %L, %L, %L)', coalesce(p_tokh, pg_temp.th()), p_sess, p ->> 'ip', p_product));
end;
$c$;
create function pg_temp.pmy(p_sess text, p jsonb default '{}'::jsonb, p_tokh text default null) returns jsonb
 language plpgsql as $c$
begin
  perform pg_temp.rlclear(p);
  return pg_temp.q(format('select analytics.job_worker_my_intake_list(%L, %L, %L)', coalesce(p_tokh, pg_temp.th()), p_sess, p ->> 'ip'));
end;
$c$;
create function pg_temp.pin_in(p_worker uuid, p_pin text, p_tokh text default null) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  r := pg_temp.q(format('select analytics.worker_pin_verify_intake(%L, %L, %L, %L, null)', coalesce(p_tokh, pg_temp.th()), p_worker, p_pin, 'verify-ua/1.0'));
  if (r ->> 'ok') = 'true' then r := r || jsonb_build_object('session_hash', analytics.job_sha256_hex(r ->> 'session_token')); end if;
  return r;
end;
$c$;
create function pg_temp.pin_job(p_tokh text, p_worker uuid, p_pin text) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  r := pg_temp.q(format('select analytics.worker_pin_verify(%L, %L, %L, %L, null)', p_tokh, p_worker, p_pin, 'verify-ua/1.0'));
  if (r ->> 'ok') = 'true' then r := r || jsonb_build_object('session_hash', analytics.job_sha256_hex(r ->> 'session_token')); end if;
  return r;
end;
$c$;
-- แถวพลอย (jsonb ตัดค่า null ออก): ชนิด+รูปทรง+ขนาด+จำนวน+ตำแหน่ง
create function pg_temp.gl(p_type uuid, p_shape uuid, p_a numeric, p_b numeric, p_qty int, p_pos text default null) returns jsonb
 language sql as $c$
  select jsonb_strip_nulls(jsonb_build_object('type_id', p_type, 'shape_id', p_shape, 'size_a', p_a, 'size_b', p_b, 'qty_per_piece', p_qty, 'position', p_pos)) $c$;
-- 2 แถวมาตรฐาน: โกเมน·ไข่·4×6 ×2 (ล้อมรอบ) + CZ·กลม·1.5 ×30
create function pg_temp.std2() returns jsonb language sql as $c$
  select jsonb_build_array(pg_temp.gl(pg_temp.fx('tG'), pg_temp.fx('sOval'), 4, 6, 2, 'ล้อมรอบ'), pg_temp.gl(pg_temp.fx('tC'), pg_temp.fx('sRound'), 1.5, null, 30)) $c$;
-- แถวที่พิมพ์ "ชนิดใหม่" n ชื่อ (ชื่อห่างกันไกล ไม่ชนตัวดักชื่อคล้าย) — p_off แยกชุดชื่อ · p_shapes = ใช้รูปทรงใหม่แทนชนิดใหม่ n ชื่อ
create function pg_temp.newnames(p_n int, p_off int, p_shapes boolean default false) returns jsonb language sql as $c$
  select jsonb_agg(case when p_shapes
    then jsonb_build_object('type_id', pg_temp.fx('tC'), 'new_shape', jsonb_build_object('name', 'S' || translate(md5(i::text || ':' || p_off::text), '0123456789', 'ghijklmnop'), 'has_length', false), 'size_a', 3, 'qty_per_piece', 1)
    else jsonb_build_object('new_type_name', 'N' || translate(md5(i::text || ':' || p_off::text), '0123456789', 'ghijklmnop'), 'shape_id', pg_temp.fx('sRound'), 'size_a', 3, 'qty_per_piece', 1) end)
    from generate_series(1, p_n) i $c$;
-- แถวที่ใช้ชนิด/รูปทรงที่มีอยู่ แต่ "ขนาดใหม่" n แถว (ไม่สร้างชื่อใหม่ — สร้างแค่รายการ) · p_off แยกชุดขนาด (ขนาด = g + p_off/100 มม. · ไม่ซ้ำข้ามชุด)
create function pg_temp.newitems(p_n int, p_off int) returns jsonb language sql as $c$
  select jsonb_agg(pg_temp.gl(pg_temp.fx('tC'), pg_temp.fx('sRound'), (g + 40 + p_off / 100.0)::numeric(5, 2), null, 1)) from generate_series(1, p_n) g $c$;
-- ชุดเคสแถวผิด → คืนรายการเคสที่ "ไม่ตรงคาด" (ว่าง = ตรงคาดทุกเคส) · p_call = 'open' | 'set' · เคส = {id, lines, code, row, field}
create function pg_temp.run_bad(p_call text, p_sess text, p_job uuid, p_rev text, p_cases jsonb) returns text
 language plpgsql as $c$
declare c jsonb; r jsonb; bad text := '';
begin
  for c in select value from jsonb_array_elements(p_cases) loop
    if p_call = 'open' then
      r := pg_temp.opn(p_sess, jsonb_build_object('label', 'แหวนผิด', 'metal', 'silver', 'ga', 'has', 'gl', c -> 'lines'));
    else
      r := pg_temp.gst(p_sess, p_job, c -> 'lines', p_rev);
    end if;
    if not (r ->> 'ok' = 'false' and r ->> 'code' = 'gem_line_invalid' and r ->> 'gem_code' = c ->> 'code'
            and (c ->> 'row' is null or r ->> 'gem_row' = c ->> 'row') and (c ->> 'field' is null or r ->> 'gem_field' = c ->> 'field')) then
      bad := bad || (c ->> 'id') || '=' || left(r::text, 120) || ' ; ';
    end if;
  end loop;
  return bad;
end;
$c$;

-- ============================================================================
-- A. setup (ร้านสังเคราะห์ ZZ191 A/B — insert public.shop + shop_member ตรง: ข้อยกเว้นที่ไม่ผ่าน RPC · บอกตรงๆ) · ที่เหลือผ่าน RPC ของระบบ
-- ============================================================================
create function pg_temp.g_setup() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  u1 uuid; u2 uuid;
  p uuid; r jsonb; j jsonb; s jsonb; it uuid;
begin
  insert into public.shop (id, name) values (a, 'ZZ TEST verify-0191 A'), (b, 'ZZ TEST verify-0191 B');
  perform pg_temp.setfx('A', a); perform pg_temp.setfx('B', b);
  -- ยืม auth user จริง (FK shop_member.user_id → auth.users) เป็น owner ของร้านสังเคราะห์ในทรานแซกชันนี้เท่านั้น (ผู้ตั้งราคา/แม่แบบ/แคตตาล็อกฝั่งออฟฟิศ)
  select m.user_id into u1 from public.shop_member m where m.role = 'owner' order by m.user_id limit 1;
  select m.user_id into u2 from public.shop_member m where m.role = 'owner' order by m.user_id desc limit 1;
  if u1 is null or u2 is null then
    raise exception 'setup: ต้องมี owner ใน shop_member จริงเพื่อยืมเป็นผู้ทำรายการ';
  end if;
  insert into public.shop_member (shop_id, user_id, role) values (a, u1, 'owner'), (b, u2, 'owner');
  perform pg_temp.setfx('u_owner', u1);
  perform analytics.job_stage_def_ensure(a); perform analytics.job_record_profile_ensure(a);
  perform analytics.job_stage_def_ensure(b); perform analytics.job_record_profile_ensure(b);
  perform analytics.gem_shape_ensure(a); perform analytics.gem_shape_ensure(b);
  -- SKU ร้าน A: pT มีแม่แบบพลอย · pN/pN2 ไม่มีแม่แบบ · ปิดใช้งาน · live* · ร้าน B
  p := analytics.product_upsert(a, 'ZZ191-T', 'แหวนมีแม่แบบพลอย', null, 'fixed', 88, null, null, null, 150, null, null, null, true); perform pg_temp.setfx('pT', p);
  p := analytics.product_upsert(a, 'ZZ191-N', 'แหวนไม่มีแม่แบบ N', null, 'fixed', 55, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pN', p);
  p := analytics.product_upsert(a, 'ZZ191-N2', 'แหวนไม่มีแม่แบบ N2', null, 'fixed', 50, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pN2', p);
  p := analytics.product_upsert(a, 'ZZ191-FIXB', 'แหวนสำหรับผูก SKU', null, 'fixed', 50, null, null, null, null, null, null, null, true); perform pg_temp.setfx('fixb', p);
  p := analytics.product_upsert(a, 'ZZ191-OFF', 'ปิดใช้งาน', null, 'fixed', 10, null, null, null, null, null, null, null, false); perform pg_temp.setfx('pOFF', p);
  p := analytics.product_upsert(a, 'live191', 'live sku', null, 'fixed', 10, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pLIVE', p);
  p := analytics.product_upsert(b, 'ZZ191-B', 'SKU ร้าน B', null, 'fixed', 70, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pB', p);
  -- ช่างร้าน A: wM/wM2 = ผู้จัดการ · wN = ช่างฝังทั่วไป (ไม่ใช่ผู้จัดการ) · ร้าน B: wMB
  r := pg_temp.wu(a, 'ZZ-M ผู้จัดการ', '2468', null, '{qc}', true, false);  perform pg_temp.sfx('wM', r);
  r := pg_temp.wu(a, 'ZZ-M2 ผู้จัดการสอง', '1357', null, '{qc,pack}', true, false); perform pg_temp.sfx('wM2', r);
  r := pg_temp.wu(a, 'ZZ-N ช่างฝัง', '8642', null, '{gem_set,qc}', null, null); perform pg_temp.sfx('wN', r);
  r := pg_temp.wu(b, 'ZZ-MB ผู้จัดการร้านอื่น', '3690', null, '{qc}', true, false); perform pg_temp.sfx('wMB', r);
  -- QR ร้าน A/B
  r := analytics.shop_intake_token_issue(a, pg_temp.act()); perform pg_temp.setkv('tokh_a', analytics.job_sha256_hex(r ->> 'token'));
  r := analytics.shop_intake_token_issue(b, pg_temp.act()); perform pg_temp.setkv('tokh_b', analytics.job_sha256_hex(r ->> 'token'));
  -- แคตตาล็อกพลอย (ผ่าน RPC ออฟฟิศ): ชนิด/รายการ/ราคา/แม่แบบ
  r := pg_temp.ccreate(a, 'type', 'โกเมน'); perform pg_temp.sfx('tG', r);
  r := pg_temp.ccreate(a, 'type', 'CZ'); perform pg_temp.sfx('tC', r);
  r := pg_temp.ccreate(a, 'type', 'Garnet'); perform pg_temp.sfx('tGa', r);
  r := pg_temp.ccreate(a, 'type', 'Amethyst'); perform pg_temp.sfx('tAm', r);
  r := pg_temp.ccreate(a, 'type', 'Opal'); perform pg_temp.sfx('tM1', r);
  r := pg_temp.ccreate(a, 'type', 'Zircon'); perform pg_temp.sfx('tM2', r);
  r := pg_temp.ccreate(a, 'type', 'Quartz'); perform pg_temp.sfx('tIn', r);
  r := pg_temp.ccreate(a, 'shape', 'Briolette', true); perform pg_temp.sfx('sBr', r);
  r := pg_temp.ccreate(b, 'type', 'ทับทิมบี'); perform pg_temp.sfx('tB', r);
  perform pg_temp.setfx('sOval', pg_temp.shp(a, 'ไข่')); perform pg_temp.setfx('sRound', pg_temp.shp(a, 'กลม')); perform pg_temp.setfx('sHeart', pg_temp.shp(a, 'หัวใจ'));
  perform pg_temp.setfx('sRoundB', pg_temp.shp(b, 'กลม'));
  r := pg_temp.icreate(a, jsonb_build_object('type_id', pg_temp.fx('tG'), 'shape_id', pg_temp.fx('sOval'), 'size_a', 4, 'size_b', 6, 'qty_per_piece', 1)); perform pg_temp.setfx('iG1', (r -> 'item' ->> 'gem_item_id')::uuid);
  r := pg_temp.icreate(a, jsonb_build_object('type_id', pg_temp.fx('tC'), 'shape_id', pg_temp.fx('sRound'), 'size_a', 1.5, 'qty_per_piece', 1)); perform pg_temp.setfx('iC1', (r -> 'item' ->> 'gem_item_id')::uuid);
  r := pg_temp.icreate(b, jsonb_build_object('type_id', pg_temp.fx('tB'), 'shape_id', pg_temp.fx('sRoundB'), 'size_a', 3, 'qty_per_piece', 1)); perform pg_temp.setfx('iB', (r -> 'item' ->> 'gem_item_id')::uuid);
  if pg_temp.fx('iG1') is null or pg_temp.fx('iC1') is null or pg_temp.fx('iB') is null then raise exception 'setup: สร้างรายการพลอยไม่ได้'; end if;
  perform pg_temp.price(a, pg_temp.fx('iG1'), pg_temp.px());
  perform pg_temp.price(a, pg_temp.fx('iC1'), '9999.9999');
  perform pg_temp.price(b, pg_temp.fx('iB'), '1234.5678');
  -- แม่แบบ SKU pT = [โกเมน·ไข่·4×6 ×2 ล้อมรอบ] + [CZ·กลม·1.5 ×30]
  r := pg_temp.tset(a, pg_temp.fx('pT'), jsonb_build_array(jsonb_build_object('gem_item_id', pg_temp.fx('iG1'), 'qty_per_piece', 2, 'position', 'ล้อมรอบ'), jsonb_build_object('gem_item_id', pg_temp.fx('iC1'), 'qty_per_piece', 30)));
  if r ? '_err' then raise exception 'setup: ตั้งแม่แบบ SKU ไม่ได้ %', r::text; end if;
  -- ใบงานออฟฟิศ (มีขั้นฝัง · ไม่มีพลอย) + QR ใบงาน — ใบออฟฟิศ (เป้าหมายต้องห้าม) + ทางล็อกอินของช่าง wN
  j := pg_temp.office_job(a, pg_temp.fx('pN2'));
  if j ->> 'job' is null then raise exception 'setup: สร้างใบงานออฟฟิศไม่ได้ %', j::text; end if;
  perform pg_temp.setfx('jOff', (j ->> 'job')::uuid);
  r := analytics.job_token_issue(a, pg_temp.fx('jOff'), null, pg_temp.act());
  perform pg_temp.setkv('jobtokh_a', analytics.job_sha256_hex(r ->> 'token'));
  -- session: M/M2/MB ล็อกอินที่ QR ร้าน · N ล็อกอินที่ QR ใบงาน (ไม่มีสิทธิ์เปิดใบ)
  s := pg_temp.pin_in(pg_temp.fx('wM'), '2468');  perform pg_temp.setkv('sM', s ->> 'session_hash');
  s := pg_temp.pin_in(pg_temp.fx('wM2'), '1357'); perform pg_temp.setkv('sM2', s ->> 'session_hash');
  s := pg_temp.pin_in(pg_temp.fx('wMB'), '3690', pg_temp.kv('tokh_b')); perform pg_temp.setkv('sMB', s ->> 'session_hash');
  s := pg_temp.pin_job(pg_temp.kv('jobtokh_a'), pg_temp.fx('wN'), '8642'); perform pg_temp.setkv('sN', s ->> 'session_hash');
  v := v || pg_temp.chk('S0', 'setup: ร้าน A/B · SKU 6+1 · ช่าง M/M2/N/MB · QR ร้าน · ชนิด/รูปทรง/รายการ + ราคาเลขแปลก + แม่แบบ pT (2 แถว) · ใบงานออฟฟิศ · session M/M2/MB/N ครบ',
    pg_temp.kv('sM') is not null and pg_temp.kv('sM2') is not null and pg_temp.kv('sMB') is not null and pg_temp.kv('sN') is not null
    and (select count(*) from analytics.product_gem_bom where product_id = pg_temp.fx('pT')) = 2 and pg_temp.n_price() >= 3);
  return v;
end;
$c$;

-- ============================================================================
-- O. เปิดใบพร้อมพลอย (job_worker_open) — ทุกกลุ่มถอยกลับด้วย raise 'rb_191'
-- ============================================================================
create function pg_temp.g_191_open() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); b uuid := pg_temp.fx('B');
  sM text := pg_temp.kv('sM'); sM2 text := pg_temp.kv('sM2'); sN text := pg_temp.kv('sN');
  wM uuid := pg_temp.fx('wM'); wM2 uuid := pg_temp.fx('wM2');
  tG uuid := pg_temp.fx('tG'); tC uuid := pg_temp.fx('tC'); tB uuid := pg_temp.fx('tB'); tGa uuid := pg_temp.fx('tGa'); tAm uuid := pg_temp.fx('tAm');
  tM1 uuid := pg_temp.fx('tM1'); tM2 uuid := pg_temp.fx('tM2'); tIn uuid := pg_temp.fx('tIn');
  sOval uuid := pg_temp.fx('sOval'); sRound uuid := pg_temp.fx('sRound'); sBr uuid := pg_temp.fx('sBr'); sRoundB uuid := pg_temp.fx('sRoundB');
  pT uuid := pg_temp.fx('pT'); pN uuid := pg_temp.fx('pN'); pN2 uuid := pg_temp.fx('pN2'); iB uuid := pg_temp.fx('iB');
  o jsonb; o2 jsonb; o3 jsonb; r jsonb; j uuid; s0 text; s1 text; ik text; bad text; n0 int; n1 int; n2 int; k int; cases jsonb; ev analytics.job_event; pl jsonb; wY uuid; sY text;
begin
  -- O0: ต้องไม่พัง — เปิดใบแบบเดิม (ไม่ส่งพลอยเลย) ทั้ง 3 แบบ: ไม่มี SKU · SKU ไม่มีแม่แบบ · SKU มีแม่แบบ (ได้ขั้นฝัง + พลอยคัดลอกมา)
  begin
    s0 := pg_temp.allst(a);
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน O0')); j := (o ->> 'job')::uuid;
    v := v || pg_temp.chk('O0', 'ต้องไม่พัง: ไม่ส่งพลอย (ไม่มี SKU) ok · key เดิมครบ · ไม่มีขั้นฝัง · ไม่มี BOM · ไม่มี event bom_change · gem.count 0 state not_needed · ไม่มี key เงิน',
      o ->> 'already' = 'false' and o ->> 'order_no' is not null and o ->> 'job_no' ~ '^JB-' and (o ->> 'token') ~ '^[A-Za-z0-9_-]{16,64}$' and o ->> 'design_label' = 'แหวน O0' and o ->> 'sku_pending' = 'true'
      and o ->> 'metal' = 'silver' and o ->> 'qty_order' = '2' and o ->> 'qty_planned' = '2' and o ->> 'status' = 'open'
      and not pg_temp.has_stage(j) and pg_temp.n_bom(j) = 0 and pg_temp.n_bev(j) = 0 and (o #>> '{gem,count}')::int = 0 and o #>> '{gem,state}' = 'not_needed' and pg_temp.badkeys(o) = '' and not pg_temp.has_px(o));
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O0-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    o := pg_temp.go(sM, jsonb_build_object('product', pT, 'qty', 2)); j := (o ->> 'job')::uuid;
    v := v || pg_temp.chk('O0b', 'ต้องไม่พัง: SKU มีแม่แบบ ไม่ส่งพลอย = ได้ขั้นฝัง + คัดลอกแม่แบบ 2 แถว (source product · ผู้สร้าง = ช่าง) เหมือน W1 เดิม',
      pg_temp.has_stage(j) and pg_temp.n_bom(j) = 2 and not exists (select 1 from analytics.job_gem_bom g where g.job_id = j and g.source <> 'product') and (o #>> '{gem,count}')::int = 2 and o #>> '{gem,state}' = 'specified');
    o := pg_temp.go(sM, jsonb_build_object('product', pN, 'qty', 2)); j := (o ->> 'job')::uuid;
    v := v || pg_temp.chk('O0c', 'ต้องไม่พัง: SKU ไม่มีแม่แบบ ไม่ส่งพลอย = ไม่มีขั้นฝัง ไม่มี BOM (ผลเดิมของ W1)', not pg_temp.has_stage(j) and pg_temp.n_bom(j) = 0 and (o #>> '{gem,count}')::int = 0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O0b-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O1: 'has' 2 แถว (รายการที่มี) → ใบมีขั้นฝังจากพลอยจริง · BOM source shopfloor · event bom_change = ช่าง · intake_open บอกคำตอบ
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน O1', 'qty', 3, 'planned', 5, 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    v := v || pg_temp.chk('O1', 'has 2 แถว: ok · ขั้นฝังเกิด 1 ขั้น เรียงระหว่าง buff กับ qc · gem.count 2 · gem.total = (2+30) x 5 = 160 · state specified',
      o ->> 'ok' = 'true' and (select array_agg(s.stage_code order by s.seq) from analytics.job_stage s where s.job_id = j) = array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'finish', 'buff', 'gem_set', 'qc', 'pack']
      and (o #>> '{gem,count}')::int = 2 and (o #>> '{gem,total}')::int = 160 and o #>> '{gem,state}' = 'specified');
    v := v || pg_temp.chk('O1b', 'BOM 2 แถว: source shopfloor · ผู้สร้าง = ช่าง (created_by null) · ฉลาก DB ประกอบเอง "โกเมน · ไข่ · 4×6 มม." / "CZ · กลม · 1.5 มม." · ตำแหน่งเก็บ',
      (select array_agg(g.gem_label order by g.line_seq) from analytics.job_gem_bom g where g.job_id = j) = array['โกเมน · ไข่ · 4×6 มม.', 'CZ · กลม · 1.5 มม.']
      and (select count(*) from analytics.job_gem_bom g where g.job_id = j and g.source = 'shopfloor' and g.created_by is null and g.created_by_worker_id = wM) = 2
      and (select g.position_note from analytics.job_gem_bom g where g.job_id = j and g.line_seq = 1) = 'ล้อมรอบ');
    select * into ev from analytics.job_event e where e.job_id = j and e.event_type = 'bom_change';
    v := v || pg_temp.chk('O1c', 'event bom_change 1 รายการ: actor null · worker = ผู้จัดการ · ช่อง worker_qr · phase create · source shopfloor · payload ไม่มี key ราคา',
      pg_temp.n_bev(j) = 1 and ev.actor is null and ev.worker_id = wM and ev.channel = 'worker_qr' and ev.payload ->> 'phase' = 'create' and ev.payload ->> 'source' = 'shopfloor' and pg_temp.badkeys(ev.payload - 'worker_id') = ''
      and not pg_temp.has_px(ev.payload));
    select * into ev from analytics.job_event e where e.job_id = j and e.event_type = 'intake_open';
    v := v || pg_temp.chk('O1d', 'event intake_open บอกคำตอบพลอย: gem_answer has · gem_lines 2 · (ผู้เปิด = ช่าง actor null)', ev.payload ->> 'gem_answer' = 'has' and (ev.payload ->> 'gem_lines')::int = 2 and ev.actor is null and ev.worker_id = wM);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  -- O1e: 'has' ทับแม่แบบของ SKU (ผู้จัดการแก้แถว) — ใช้แถวที่ส่ง ไม่คัดลอกแม่แบบ
  begin
    o := pg_temp.go(sM, jsonb_build_object('product', pT, 'ga', 'has', 'gl', jsonb_build_array(pg_temp.gl(tC, sRound, 1.5, null, 4)))); j := (o ->> 'job')::uuid;
    v := v || pg_temp.chk('O1e', 'SKU มีแม่แบบ + has + แถวที่แก้ → BOM = 1 แถวที่ส่ง (ไม่ใช่แม่แบบ 2 แถว) · ขั้นฝังมี 1 ขั้น',
      pg_temp.n_bom(j) = 1 and (select qty_per_piece from analytics.job_gem_bom where job_id = j) = 4 and (select count(*) from analytics.job_stage s where s.job_id = j and s.stage_code = 'gem_set') = 1);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O1e-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O2: พิมพ์ชนิด/รูปทรงใหม่ → เข้าแคตตาล็อกตอนบันทึก (ผู้สร้าง = ช่าง) · ไม่มีราคา
  begin
    n0 := pg_temp.n_type(a); n1 := pg_temp.n_shape(a); n2 := pg_temp.n_item(a);
    k := pg_temp.n_price();
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน O2', 'ga', 'has', 'gl', jsonb_build_array(
      jsonb_build_object('new_type_name', 'บุษราคัม', 'new_shape', jsonb_build_object('name', 'ทรงใบไม้', 'has_length', true), 'size_a', 6, 'size_b', 4, 'qty_per_piece', 3)))); j := (o ->> 'job')::uuid;
    v := v || pg_temp.chk('O2', 'ชนิด+รูปทรง+รายการใหม่เข้าแคตตาล็อก (+1/+1/+1) · created_by_worker_id = ผู้จัดการ · has_length ตามที่ตอบ · ขนาดกลับด้านเรียงเป็น 4×6 · ไม่มีราคาเกิด · ผลบอกชื่อใหม่',
      pg_temp.n_type(a) = n0 + 1 and pg_temp.n_shape(a) = n1 + 1 and pg_temp.n_item(a) = n2 + 1
      and exists (select 1 from analytics.gem_type t where t.shop_id = a and t.name = 'บุษราคัม' and t.created_by_worker_id = wM and t.created_by is null)
      and exists (select 1 from analytics.gem_shape s where s.shop_id = a and s.name = 'ทรงใบไม้' and s.has_length and s.created_by_worker_id = wM and not s.is_seed)
      and (select g.gem_label from analytics.job_gem_bom g where g.job_id = j) = 'บุษราคัม · ทรงใบไม้ · 4×6 มม.' and pg_temp.n_price() = k
      and o #> '{gem,created_types}' = '["บุษราคัม"]'::jsonb and o #> '{gem,created_shapes}' = '["ทรงใบไม้"]'::jsonb);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O2-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O3: 'none' = ไม่มีขั้นฝัง แม้ SKU มีแม่แบบ (ถอด gem_set · ไม่คัดลอกแม่แบบ) · O4: 'template' ตามแม่แบบ
  begin
    o := pg_temp.go(sM, jsonb_build_object('product', pT, 'ga', 'none')); j := (o ->> 'job')::uuid;
    v := v || pg_temp.chk('O3', 'none + SKU มีแม่แบบ: ไม่มีขั้นฝัง · ไม่มี BOM · gem.count 0 · state not_needed · ไม่มี bom_change',
      not pg_temp.has_stage(j) and pg_temp.n_bom(j) = 0 and (o #>> '{gem,count}')::int = 0 and o #>> '{gem,state}' = 'not_needed' and pg_temp.n_bev(j) = 0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O3-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    o := pg_temp.go(sM, jsonb_build_object('product', pN, 'ga', 'none', 'gl', '[]'::jsonb)); j := (o ->> 'job')::uuid;
    v := v || pg_temp.chk('O3b', 'none + lines [] (SKU ไม่มีแม่แบบ) ok · ไม่มีขั้นฝัง', not pg_temp.has_stage(j) and pg_temp.n_bom(j) = 0);
    o := pg_temp.go(sM, jsonb_build_object('product', pT, 'ga', 'template')); j := (o ->> 'job')::uuid;
    v := v || pg_temp.chk('O4', 'template + SKU มีแม่แบบ: ได้ขั้นฝัง + แม่แบบ 2 แถว (source product) · gem.count 2 · state specified',
      pg_temp.has_stage(j) and pg_temp.n_bom(j) = 2 and not exists (select 1 from analytics.job_gem_bom g where g.job_id = j and g.source <> 'product') and (o #>> '{gem,count}')::int = 2 and o #>> '{gem,state}' = 'specified');
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O6: SKU ไม่มีแม่แบบ/ไม่มี SKU แล้วไม่ตอบ (template) = ปฏิเสธ gem_answer_required · ไม่มีอะไรเกิด
  begin
    s0 := pg_temp.allst(a);
    o := pg_temp.opn(sM, jsonb_build_object('product', pN, 'ga', 'template'));
    o2 := pg_temp.opn(sM, jsonb_build_object('label', 'แหวนไม่มี SKU', 'metal', 'silver', 'ga', 'template'));
    o3 := pg_temp.opn(sM, jsonb_build_object('product', pg_temp.fx('pOFF'), 'ga', 'template'));
    v := v || pg_temp.chk('O6', 'template + SKU ไม่มีแม่แบบ / ไม่มี SKU → gem_answer_required · SKU ปิดใช้ → sku_invalid (ด่านเดิมมาก่อน) · ไม่มีอะไรเกิด (PO/ใบงาน/ตัวนับ/ชนิด/BOM เท่าเดิม)',
      o ->> 'code' = 'gem_answer_required' and o2 ->> 'code' = 'gem_answer_required' and o3 ->> 'code' = 'sku_invalid' and pg_temp.allst(a) = s0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O6-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  -- O7: has แต่ไม่มีแถว (null / [] / ไม่ใช่ array)
  begin
    s0 := pg_temp.allst(a);
    o := pg_temp.opn(sM, jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'has'));
    o2 := pg_temp.opn(sM, jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'has', 'gl', '[]'::jsonb));
    o3 := pg_temp.opn(sM, jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'has', 'gl', '{"a":1}'::jsonb));
    v := v || pg_temp.chk('O7', 'has + 0 แถว (ไม่ส่ง / [] / object) → gem_lines_required ทั้ง 3 · ไม่มีอะไรเกิด',
      o ->> 'code' = 'gem_lines_required' and o2 ->> 'code' = 'gem_lines_required' and o3 ->> 'code' = 'gem_lines_required' and pg_temp.allst(a) = s0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O7-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O8: แถวผิด (ไม่มีอะไรถูกสร้าง) — ทุกเคสต้องตกเป็น gem_line_invalid + รหัส + แถว + ช่อง
  begin
    s0 := pg_temp.allst(a);
    cases := jsonb_build_array(
      jsonb_build_object('id', 'q0', 'code', 'qty_invalid', 'row', 1, 'field', 'qty_per_piece', 'lines', jsonb_build_array(pg_temp.gl(tG, sOval, 4, 6, 0))),
      jsonb_build_object('id', 'q1001', 'code', 'qty_invalid', 'row', 1, 'field', 'qty_per_piece', 'lines', jsonb_build_array(pg_temp.gl(tG, sOval, 4, 6, 1001))),
      jsonb_build_object('id', 'qneg', 'code', 'qty_invalid', 'row', 1, 'field', 'qty_per_piece', 'lines', jsonb_build_array(pg_temp.gl(tG, sOval, 4, 6, -1))),
      jsonb_build_object('id', 'qNaN', 'code', 'qty_invalid', 'row', 1, 'field', 'qty_per_piece', 'lines', jsonb_build_array(jsonb_build_object('type_id', tG, 'shape_id', sOval, 'size_a', 4, 'size_b', 6, 'qty_per_piece', 'NaN'))),
      jsonb_build_object('id', 'qabc', 'code', 'qty_invalid', 'row', 1, 'field', 'qty_per_piece', 'lines', jsonb_build_array(jsonb_build_object('type_id', tG, 'shape_id', sOval, 'size_a', 4, 'size_b', 6, 'qty_per_piece', 'abc'))),
      jsonb_build_object('id', 'q1.5', 'code', 'qty_invalid', 'row', 1, 'field', 'qty_per_piece', 'lines', jsonb_build_array(jsonb_build_object('type_id', tG, 'shape_id', sOval, 'size_a', 4, 'size_b', 6, 'qty_per_piece', 1.5))),
      jsonb_build_object('id', 'qnull', 'code', 'qty_invalid', 'row', 1, 'field', 'qty_per_piece', 'lines', jsonb_build_array(jsonb_build_object('type_id', tG, 'shape_id', sOval, 'size_a', 4, 'size_b', 6))),
      jsonb_build_object('id', 'q2row', 'code', 'qty_invalid', 'row', 2, 'field', 'qty_per_piece', 'lines', jsonb_build_array(pg_temp.gl(tG, sOval, 4, 6, 1), pg_temp.gl(tC, sRound, 1.5, null, 0))));
    bad := pg_temp.run_bad('open', sM, null, null, cases);
    v := v || pg_temp.chk('O8q', 'qty 0 / 1001 / ติดลบ / "NaN" / "abc" / 1.5 / ไม่ส่ง / แถวที่ 2 ผิด → gem_line_invalid qty_invalid ตรงแถว+ช่อง · ผิด: ' || bad, bad = '');
    cases := jsonb_build_array(
      jsonb_build_object('id', 's0', 'code', 'size_invalid', 'row', 1, 'field', 'size_a', 'lines', jsonb_build_array(pg_temp.gl(tC, sRound, 0, null, 1))),
      jsonb_build_object('id', 's101', 'code', 'size_invalid', 'row', 1, 'field', 'size_a', 'lines', jsonb_build_array(pg_temp.gl(tC, sRound, 101, null, 1))),
      jsonb_build_object('id', 'sneg', 'code', 'size_invalid', 'row', 1, 'field', 'size_a', 'lines', jsonb_build_array(pg_temp.gl(tC, sRound, -2, null, 1))),
      jsonb_build_object('id', 'sNaN', 'code', 'size_invalid', 'row', 1, 'field', 'size_a', 'lines', jsonb_build_array(jsonb_build_object('type_id', tC, 'shape_id', sRound, 'size_a', 'NaN', 'qty_per_piece', 1))),
      jsonb_build_object('id', 'sInf', 'code', 'size_invalid', 'row', 1, 'field', 'size_a', 'lines', jsonb_build_array(jsonb_build_object('type_id', tC, 'shape_id', sRound, 'size_a', 'Infinity', 'qty_per_piece', 1))),
      jsonb_build_object('id', 's1e2', 'code', 'size_invalid', 'row', 1, 'field', 'size_a', 'lines', jsonb_build_array(jsonb_build_object('type_id', tC, 'shape_id', sRound, 'size_a', '1e2', 'qty_per_piece', 1))),
      jsonb_build_object('id', 's3dec', 'code', 'size_invalid', 'row', 1, 'field', 'size_a', 'lines', jsonb_build_array(pg_temp.gl(tC, sRound, 1.234, null, 1))),
      jsonb_build_object('id', 'smiss', 'code', 'size_required', 'row', 1, 'field', 'size_a', 'lines', jsonb_build_array(jsonb_build_object('type_id', tC, 'shape_id', sRound, 'qty_per_piece', 1))));
    bad := pg_temp.run_bad('open', sM, null, null, cases);
    v := v || pg_temp.chk('O8s', 'ขนาด ≤ 0 / > 100 / ติดลบ / NaN / Infinity / 1e2 / ทศนิยม 3 / ไม่ส่ง → gem_line_invalid size_invalid|size_required · ผิด: ' || bad, bad = '');
    cases := jsonb_build_array(
      jsonb_build_object('id', 'h1', 'code', 'size_b_unexpected', 'row', 1, 'field', 'size_b', 'lines', jsonb_build_array(pg_temp.gl(tC, sRound, 3, 3, 1))),
      jsonb_build_object('id', 'h2', 'code', 'size_b_required', 'row', 1, 'field', 'size_b', 'lines', jsonb_build_array(pg_temp.gl(tG, sOval, 4, null, 1))),
      jsonb_build_object('id', 'h3', 'code', 'size_invalid', 'row', 1, 'field', 'size_b', 'lines', jsonb_build_array(jsonb_build_object('type_id', tG, 'shape_id', sOval, 'size_a', 4, 'size_b', 0, 'qty_per_piece', 1))),
      jsonb_build_object('id', 'h4', 'code', 'size_invalid', 'row', 1, 'field', 'size_b', 'lines', jsonb_build_array(jsonb_build_object('type_id', tG, 'shape_id', sOval, 'size_a', 4, 'size_b', 'NaN', 'qty_per_piece', 1))));
    bad := pg_temp.run_bad('open', sM, null, null, cases);
    v := v || pg_temp.chk('O8h', 'has_length ไม่ตรงรูปทรง: ทรงกลมใส่ size_b · ทรงไข่ไม่ใส่ size_b · size_b 0/NaN → ปฏิเสธตรงช่อง · ผิด: ' || bad, bad = '');
    cases := jsonb_build_array(
      jsonb_build_object('id', 'l31', 'code', 'too_many_lines', 'row', 31, 'lines', (select jsonb_agg(pg_temp.gl(tC, sRound, g::numeric, null, 1)) from generate_series(1, 31) g)));
    bad := pg_temp.run_bad('open', sM, null, null, cases);
    v := v || pg_temp.chk('O8l', '31 แถว → too_many_lines (แถว 31) · ผิด: ' || bad, bad = '');
    cases := jsonb_build_array(
      jsonb_build_object('id', 't1', 'code', 'gem_type_invalid', 'row', 1, 'field', 'type', 'lines', jsonb_build_array(pg_temp.gl(tB, sRound, 3, null, 1))),
      jsonb_build_object('id', 't2', 'code', 'gem_type_invalid', 'row', 1, 'field', 'type', 'lines', jsonb_build_array(pg_temp.gl(gen_random_uuid(), sRound, 3, null, 1))),
      jsonb_build_object('id', 't3', 'code', 'gem_shape_invalid', 'row', 1, 'field', 'shape', 'lines', jsonb_build_array(pg_temp.gl(tC, sRoundB, 3, null, 1))),
      jsonb_build_object('id', 't4', 'code', 'gem_item_invalid', 'row', 1, 'field', 'gem_item_id', 'lines', jsonb_build_array(jsonb_build_object('gem_item_id', iB, 'qty_per_piece', 1))),
      jsonb_build_object('id', 't5', 'code', 'gem_item_invalid', 'row', 1, 'field', 'gem_item_id', 'lines', jsonb_build_array(jsonb_build_object('gem_item_id', 'not-a-uuid', 'qty_per_piece', 1))),
      jsonb_build_object('id', 't6', 'code', 'type_required', 'row', 1, 'field', 'type', 'lines', jsonb_build_array(jsonb_build_object('type_id', tC, 'new_type_name', 'ไพลิน', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1))),
      jsonb_build_object('id', 't7', 'code', 'shape_required', 'row', 1, 'field', 'shape', 'lines', jsonb_build_array(jsonb_build_object('type_id', tC, 'size_a', 3, 'qty_per_piece', 1))),
      jsonb_build_object('id', 't8', 'code', 'line_invalid', 'row', 1, 'field', 'type_id', 'lines', jsonb_build_array(jsonb_build_object('gem_item_id', pg_temp.fx('iC1'), 'type_id', tC, 'qty_per_piece', 1))));
    bad := pg_temp.run_bad('open', sM, null, null, cases);
    v := v || pg_temp.chk('O8t', 'ชนิด/รูปทรง/รายการของร้านอื่น · uuid สุ่ม · ไม่ใช่ uuid · ส่งทั้ง type_id+ชื่อใหม่ · ไม่ส่งรูปทรง · gem_item_id ปนช่องอื่น → ปฏิเสธตรงช่อง · ผิด: ' || bad, bad = '');
    cases := jsonb_build_array(
      jsonb_build_object('id', 'k1', 'code', 'line_invalid', 'row', 1, 'field', 'price', 'lines', jsonb_build_array(jsonb_build_object('type_id', tC, 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1, 'price', 5))),
      jsonb_build_object('id', 'k2', 'code', 'line_invalid', 'row', 1, 'field', 'cost', 'lines', jsonb_build_array(jsonb_build_object('type_id', tC, 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1, 'cost', 5))),
      jsonb_build_object('id', 'k3', 'code', 'line_invalid', 'row', 1, 'field', 'line', 'lines', jsonb_build_array(to_jsonb(5))),
      jsonb_build_object('id', 'k4', 'code', 'line_invalid', 'row', 2, 'field', 'supplier', 'lines', jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 1), jsonb_build_object('type_id', tC, 'shape_id', sRound, 'size_a', 4, 'qty_per_piece', 1, 'supplier', 'x'))));
    bad := pg_temp.run_bad('open', sM, null, null, cases);
    v := v || pg_temp.chk('O8k', 'แถวมี key แปลก (price/cost/supplier) หรือไม่ใช่ object → line_invalid ตรงแถว (ไม่ทิ้งเงียบ) · ผิด: ' || bad, bad = '');
    cases := jsonb_build_array(
      jsonb_build_object('id', 'n1', 'code', 'name_invalid', 'row', 1, 'field', 'type', 'lines', jsonb_build_array(jsonb_build_object('new_type_name', '12', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1))),
      jsonb_build_object('id', 'n2', 'code', 'name_invalid', 'row', 1, 'field', 'type', 'lines', jsonb_build_array(jsonb_build_object('new_type_name', 'a', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1))),
      jsonb_build_object('id', 'n3', 'code', 'name_invalid', 'row', 1, 'field', 'type', 'lines', jsonb_build_array(jsonb_build_object('new_type_name', '<b>ผิด</b>', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1))),
      jsonb_build_object('id', 'n4', 'code', 'name_invalid', 'row', 1, 'field', 'shape', 'lines', jsonb_build_array(jsonb_build_object('type_id', tC, 'new_shape', jsonb_build_object('name', '1', 'has_length', false), 'size_a', 3, 'qty_per_piece', 1))),
      jsonb_build_object('id', 'n5', 'code', 'shape_new_invalid', 'row', 1, 'field', 'shape', 'lines', jsonb_build_array(jsonb_build_object('type_id', tC, 'new_shape', jsonb_build_object('name', 'ทรงใหม่'), 'size_a', 3, 'qty_per_piece', 1))),
      jsonb_build_object('id', 'n6', 'code', 'name_invalid', 'row', 1, 'field', 'type', 'lines', jsonb_build_array(jsonb_build_object('new_type_name', repeat('ก', 41), 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1))),
      jsonb_build_object('id', 'n7', 'code', 'name_invalid', 'row', 1, 'field', 'type', 'lines', jsonb_build_array(jsonb_build_object('new_type_name', '๑๒', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1))));
    bad := pg_temp.run_bad('open', sM, null, null, cases);
    v := v || pg_temp.chk('O8n', 'ชื่อใหม่ผิด: เลขล้วน/ตัวเดียว/มี < >/ยาวเกิน 40/เลขไทยล้วน · รูปทรงใหม่ไม่ระบุ has_length → ปฏิเสธตรงช่อง · ผิด: ' || bad, bad = '');
    cases := jsonb_build_array(
      jsonb_build_object('id', 'p1', 'code', 'position_invalid', 'row', 1, 'field', 'position', 'lines', jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 1, '<b>'))),
      jsonb_build_object('id', 'p2', 'code', 'position_invalid', 'row', 1, 'field', 'position', 'lines', jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 1, repeat('ก', 41)))),
      jsonb_build_object('id', 'p3', 'code', 'position_invalid', 'row', 1, 'field', 'position', 'lines', jsonb_build_array(jsonb_build_object('type_id', tC, 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1, 'position', 5))));
    bad := pg_temp.run_bad('open', sM, null, null, cases);
    v := v || pg_temp.chk('O8p', 'ตำแหน่งผิด: มี < > / ยาวเกิน 40 / ไม่ใช่ข้อความ → position_invalid · ผิด: ' || bad, bad = '');
    v := v || pg_temp.chk('O8z', 'พลอยผิดทุกแบบข้างบน (O8q-O8p ~40 เคส) → ไม่มี PO/ใบงาน/QR/event/ตัวนับ/ชนิด/รูปทรง/รายการ/BOM เกิดเลย (allst เท่าเดิมเป๊ะ)', pg_temp.allst(a) = s0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O8-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  -- O8x: ปิดใช้งาน / merged (resolve ไปปลายทาง ตามมติ G1a — ไม่ปฏิเสธ · ปลายทางปิดใช้ = ปฏิเสธ)
  begin
    perform pg_temp.sact(a, 'type', tIn, false);
    s0 := pg_temp.allst(a);
    cases := jsonb_build_array(
      jsonb_build_object('id', 'x1', 'code', 'gem_inactive', 'row', 1, 'field', 'type', 'lines', jsonb_build_array(pg_temp.gl(tIn, sRound, 3, null, 1))),
      jsonb_build_object('id', 'x2', 'code', 'gem_inactive', 'row', 1, 'field', 'type', 'lines', jsonb_build_array(jsonb_build_object('new_type_name', 'Quartz', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1))));
    bad := pg_temp.run_bad('open', sM, null, null, cases);
    v := v || pg_temp.chk('O8x', 'ชนิดที่ปิดใช้งาน (เลือกด้วย id / พิมพ์ชื่อเดียวกัน) → gem_inactive ตรงช่อง · ไม่มีอะไรเกิด · ผิด: ' || bad, bad = '' and pg_temp.allst(a) = s0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O8x-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    r := pg_temp.mrg(a, 'type', tM1, tM2);
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน O8m1', 'ga', 'has', 'gl', jsonb_build_array(pg_temp.gl(tM1, sRound, 3, null, 2)))); j := (o ->> 'job')::uuid;
    v := v || pg_temp.chk('O8m1', 'ชนิดที่ถูกรวมแล้ว (merged) = resolve ไปตัวปลายทาง (มติ G1a design §9.3 — ไม่ปฏิเสธ) · ใบได้ชนิดปลายทาง "Zircon · กลม · 3 มม." · รวมชื่อสำเร็จ: ' || coalesce(r ->> '_err', 'ok'),
      r ? '_err' = false and (select g.gem_label from analytics.job_gem_bom g where g.job_id = j) = 'Zircon · กลม · 3 มม.');
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O8m1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    r := pg_temp.mrg(a, 'type', tM1, tM2);
    perform pg_temp.sact(a, 'type', tM2, false);
    s0 := pg_temp.allst(a);
    o := pg_temp.opn(sM, jsonb_build_object('label', 'แหวน O8m2', 'metal', 'silver', 'ga', 'has', 'gl', jsonb_build_array(pg_temp.gl(tM1, sRound, 3, null, 2))));
    v := v || pg_temp.chk('O8m2', 'ชนิดที่ถูกรวมไปหาปลายทางที่ "ปิดใช้งาน" → gem_inactive · ไม่มีอะไรเกิด', o ->> 'code' = 'gem_line_invalid' and o ->> 'gem_code' = 'gem_inactive' and pg_temp.allst(a) = s0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O8m2-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O9: ตัวดักชื่อคล้าย — คืน similar (ไม่เขียนอะไร) · force เฉพาะชื่อที่ถูกถามในคำขอนั้น
  begin
    s0 := pg_temp.allst(a);
    pl := jsonb_build_array(jsonb_build_object('new_type_name', 'Garnett', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1));
    o := pg_temp.opn(sM, jsonb_build_object('label', 'แหวน O9', 'metal', 'silver', 'ga', 'has', 'gl', pl));
    v := v || pg_temp.chk('O9a', 'ชื่อคล้าย (Garnett ~ Garnet) ไม่ force → gem_similar + similar[] (kind type · ชื่อที่พิมพ์ · ชื่อที่มี) · ไม่มี PO/ใบงาน/ชนิดใหม่เกิด',
      o ->> 'ok' = 'false' and o ->> 'code' = 'gem_similar' and o #>> '{similar,0,kind}' = 'type' and o #>> '{similar,0,name}' = 'Garnett' and o #>> '{similar,0,matches,0,name}' = 'Garnet'
      and pg_temp.allst(a) = s0 and not exists (select 1 from analytics.gem_type where shop_id = a and name = 'Garnett') and pg_temp.badkeys(o) = '');
    o := pg_temp.opn(sM, jsonb_build_object('label', 'แหวน O9', 'metal', 'silver', 'ga', 'has', 'gl', pl, 'gf', jsonb_build_array(jsonb_build_object('kind', 'type', 'name', 'Garnett'))));
    j := pg_temp.jid(a, o ->> 'job_no');
    v := v || pg_temp.chk('O9b', 'force เฉพาะชื่อที่ถูกถาม (type Garnett) → ok · ชนิด Garnett เข้าแคตตาล็อก (ผู้สร้างช่าง) · ใบมีพลอย',
      o ->> 'ok' = 'true' and exists (select 1 from analytics.gem_type t where t.shop_id = a and t.name = 'Garnett' and t.created_by_worker_id = wM) and pg_temp.n_bom(j) = 1 and o #> '{gem,created_types}' = '["Garnett"]'::jsonb);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O9-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    s0 := pg_temp.allst(a);
    pl := jsonb_build_array(jsonb_build_object('new_type_name', 'Garnett', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1));
    o := pg_temp.opn(sM, jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'has', 'gl', pl, 'gf', jsonb_build_array(jsonb_build_object('kind', 'type', 'name', 'Other'))));
    o2 := pg_temp.opn(sM, jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'has', 'gl', pl, 'gf', jsonb_build_array(jsonb_build_object('kind', 'shape', 'name', 'Garnett'))));
    v := v || pg_temp.chk('O9c', 'force ชื่ออื่นที่ไม่ได้ถูกถาม / ชื่อเดียวกันแต่ผิด kind → ยัง gem_similar (ไม่ปลดคำถาม) · ไม่มีอะไรเกิด', o ->> 'code' = 'gem_similar' and o2 ->> 'code' = 'gem_similar' and pg_temp.allst(a) = s0);
    pl := jsonb_build_array(jsonb_build_object('new_type_name', 'Garnett', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1), jsonb_build_object('new_type_name', 'Amethist', 'shape_id', sRound, 'size_a', 4, 'qty_per_piece', 1));
    o := pg_temp.opn(sM, jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'has', 'gl', pl, 'gf', jsonb_build_array(jsonb_build_object('kind', 'type', 'name', 'Garnett'))));
    v := v || pg_temp.chk('O9d', 'ชื่อคล้าย 2 ชื่อ force แค่ชื่อเดียว → ยัง gem_similar (ชื่อที่ 2 ยังไม่ถูก force) · ไม่มีอะไรเกิด', o ->> 'code' = 'gem_similar' and pg_temp.allst(a) = s0
      and exists (select 1 from jsonb_array_elements(o -> 'similar') e where e ->> 'name' = 'Amethist'));
    o := pg_temp.opn(sM, jsonb_build_object('label', 'แหวน O9d', 'metal', 'silver', 'ga', 'has', 'gl', pl, 'gf', jsonb_build_array(jsonb_build_object('kind', 'type', 'name', 'Garnett'), jsonb_build_object('kind', 'type', 'name', 'Amethist'))));
    v := v || pg_temp.chk('O9d2', 'force ครบทั้ง 2 ชื่อที่ถูกถาม → ok · เกิด 2 ชนิด', o ->> 'ok' = 'true' and exists (select 1 from analytics.gem_type where shop_id = a and name = 'Garnett') and exists (select 1 from analytics.gem_type where shop_id = a and name = 'Amethist'));
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O9d-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    s0 := pg_temp.allst(a);
    pl := jsonb_build_array(jsonb_build_object('new_type_name', 'Garnett', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1));
    bad := '';
    for r in select value from jsonb_array_elements('[true, "x", {}, [1], [{"kind":"type","name":"Garnett","extra":1}], [{"kind":"bad","name":"Garnett"}], [{"kind":"type"}], [{"kind":"type","name":5}], [5]]'::jsonb) union all select (select jsonb_agg(jsonb_build_object('kind', 'type', 'name', 'Garnett')) from generate_series(1, 61)) loop
      o := pg_temp.opn(sM, jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'has', 'gl', pl, 'gf', r));
      if o ->> 'code' is distinct from 'gem_force_invalid' then bad := bad || left(r::text, 40) || '=>' || coalesce(o ->> 'code', o::text) || ' ; '; end if;
    end loop;
    v := v || pg_temp.chk('O9e', 'force ผิดรูป (boolean true · สตริง · object · element ไม่ใช่ object · key แปลก · kind ผิด · ไม่มีชื่อ · ชื่อไม่ใช่ข้อความ · เกิน 60 ตัว) → gem_force_invalid · ไม่มีอะไรเกิด · ผิด: ' || bad, bad = '' and pg_temp.allst(a) = s0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O9e-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    n0 := pg_temp.n_type(a);
    pl := jsonb_build_array(jsonb_build_object('new_type_name', 'GARNET', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1));
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน O9f', 'ga', 'has', 'gl', pl, 'gf', jsonb_build_array(jsonb_build_object('kind', 'type', 'name', 'GARNET')))); j := (o ->> 'job')::uuid;
    v := v || pg_temp.chk('O9f', 'ชื่อซ้ำเป๊ะหลัง normalize (GARNET = Garnet) + force → ไม่สร้างชนิดซ้ำ · ใช้ตัวเดิมให้ (reused) · ฉลากใช้ชื่อเดิม',
      pg_temp.n_type(a) = n0 and (select g.gem_label from analytics.job_gem_bom g where g.job_id = j) = 'Garnet · กลม · 3 มม.' and o #>> '{gem,reused,0,kind}' = 'type' and o #>> '{gem,reused,0,name}' = 'Garnet');
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน O9f2', 'ga', 'has', 'gl', pl));
    v := v || pg_temp.chk('O9f2', 'ชื่อซ้ำเป๊ะไม่ส่ง force → ไม่ต้องถาม (ใช้ตัวเดิมเงียบๆ) · ไม่เกิดชนิดซ้ำ', o ->> 'ok' = 'true' and pg_temp.n_type(a) = n0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O9f-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    s0 := pg_temp.allst(a);
    pl := jsonb_build_array(jsonb_build_object('type_id', tC, 'new_shape', jsonb_build_object('name', 'Brioletta', 'has_length', true), 'size_a', 3, 'size_b', 5, 'qty_per_piece', 1));
    o := pg_temp.opn(sM, jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'has', 'gl', pl));
    v := v || pg_temp.chk('O9g', 'รูปทรงชื่อคล้าย (Brioletta ~ Briolette) ไม่ force → gem_similar kind shape · ไม่มีอะไรเกิด', o ->> 'code' = 'gem_similar' and o #>> '{similar,0,kind}' = 'shape' and pg_temp.allst(a) = s0);
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน O9g', 'ga', 'has', 'gl', pl, 'gf', jsonb_build_array(jsonb_build_object('kind', 'shape', 'name', 'Brioletta'))));
    v := v || pg_temp.chk('O9g2', 'force รูปทรง (kind shape) → ok · เกิดรูปทรง Brioletta (has_length true)', exists (select 1 from analytics.gem_shape where shop_id = a and name = 'Brioletta' and has_length));
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O9g-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O10: idem replay = ใบเดิม ไม่ทำซ้ำ (ไม่เชื่อพลอยที่ส่งซ้ำ) · key ของช่างอื่น = idem_conflict
  begin
    ik := pg_temp.ik();
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน O10', 'idem', ik, 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    s1 := pg_temp.allst(a);
    o2 := pg_temp.opn(sM, jsonb_build_object('label', 'ชื่ออื่น', 'metal', 'silver', 'idem', ik, 'ga', 'none'));
    v := v || pg_temp.chk('O10', 'replay (key เดิม · พลอย/คำตอบต่างจากเดิม) → already · ใบเดิม · ไม่มี token · gem จาก DB (count 2 · specified) · ไม่ทำซ้ำ: ทุกตาราง/ตัวนับเท่าเดิม',
      o2 ->> 'ok' = 'true' and o2 ->> 'already' = 'true' and o2 ->> 'job_no' = o ->> 'job_no' and (o2 ->> 'token') is null and (o2 #>> '{gem,count}')::int = 2 and o2 #>> '{gem,state}' = 'specified'
      and (o2 #>> '{gem,total}')::int = 64 and pg_temp.allst(a) = s1 and pg_temp.badkeys(o2) = '');
    o3 := pg_temp.opn(sM2, jsonb_build_object('label', 'x', 'metal', 'silver', 'idem', ik, 'ga', 'has', 'gl', pg_temp.std2()));
    v := v || pg_temp.chk('O10b', 'key เดียวกันจากผู้จัดการคนอื่น → idem_conflict · ไม่มีอะไรเปลี่ยน', o3 ->> 'code' = 'idem_conflict' and pg_temp.allst(a) = s1);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O10-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O11: ล้มกลางทางหลังพลอยผ่าน (SKU มีใบเปิดอยู่ = job_exists) → ชื่อพลอยใหม่ต้องไม่หลงเหลือในแคตตาล็อก
  begin
    r := pg_temp.office_job(a, pN);
    s0 := pg_temp.allst(a);
    o := pg_temp.opn(sM, jsonb_build_object('product', pN, 'ga', 'has', 'gl', jsonb_build_array(jsonb_build_object('new_type_name', 'หายไปไหน', 'new_shape', jsonb_build_object('name', 'ทรงหาย', 'has_length', false), 'size_a', 3, 'qty_per_piece', 1))));
    v := v || pg_temp.chk('O11', 'SKU มีใบเปิดอยู่ (job_exists) + พลอยพิมพ์ชื่อใหม่ → ปฏิเสธ · ชนิด/รูปทรง/รายการใหม่ "ไม่เกิด" · allst เท่าเดิม (ล้มกลางทาง = ถอยทั้งก้อน)',
      o ->> 'code' = 'job_exists' and pg_temp.allst(a) = s0 and not exists (select 1 from analytics.gem_type where shop_id = a and name = 'หายไปไหน') and not exists (select 1 from analytics.gem_shape where shop_id = a and name = 'ทรงหาย'));
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O11-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O12: คำตอบ/อาร์กิวเมนต์พลอยผิดรูป
  begin
    s0 := pg_temp.allst(a);
    bad := '';
    for r in select value from jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('id', 'maybe', 'code', 'gem_answer_invalid', 'p', jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'maybe')),
      jsonb_build_object('id', 'none+lines', 'code', 'gem_args_invalid', 'p', jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'none', 'gl', pg_temp.std2())),
      jsonb_build_object('id', 'null+lines', 'code', 'gem_args_invalid', 'p', jsonb_build_object('label', 'x', 'metal', 'silver', 'gl', pg_temp.std2())),
      jsonb_build_object('id', 'template+lines', 'code', 'gem_args_invalid', 'p', jsonb_build_object('product', pT, 'ga', 'template', 'gl', pg_temp.std2())),
      jsonb_build_object('id', 'null+force', 'code', 'gem_args_invalid', 'p', jsonb_build_object('label', 'x', 'metal', 'silver', 'gf', '[]'::jsonb)),
      jsonb_build_object('id', 'none+force', 'code', 'gem_args_invalid', 'p', jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'none', 'gf', '[]'::jsonb)),
      jsonb_build_object('id', 'template+force', 'code', 'gem_args_invalid', 'p', jsonb_build_object('product', pT, 'ga', 'template', 'gf', '[]'::jsonb)))) loop
      o := pg_temp.opn(sM, r -> 'p');
      if o ->> 'code' is distinct from r ->> 'code' then bad := bad || (r ->> 'id') || '=>' || coalesce(o ->> 'code', o::text) || ' ; '; end if;
    end loop;
    v := v || pg_temp.chk('O12', 'คำตอบผิด (maybe) / none+แถว / ไม่ตอบ+แถว / template+แถว / force กับคำตอบที่ไม่ใช่ has → gem_answer_invalid | gem_args_invalid · ไม่มีอะไรเกิด · ผิด: ' || bad, bad = '' and pg_temp.allst(a) = s0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O12-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O13: ด่านสิทธิ์ของ open (ถือพลอยใหม่มาด้วย — ต้องไม่สร้างชื่อใหม่/อะไรเลย)
  begin
    s0 := pg_temp.allst(a);
    pl := jsonb_build_array(jsonb_build_object('new_type_name', 'ไม่ควรเกิด', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1));
    o := pg_temp.opn(null, jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'has', 'gl', pl));
    v := v || pg_temp.chk('O13a', 'ไม่มี session (null) → session_required · ไม่มีอะไรเกิด', o ->> 'code' = 'session_required' and pg_temp.allst(a) = s0);
    o := pg_temp.opn(sN, jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'has', 'gl', pl));
    v := v || pg_temp.chk('O13b', 'ช่างทั่วไป (ไม่ใช่ผู้จัดการ · session ถูกต้อง) → not_allowed · ไม่มีอะไรเกิด', o ->> 'code' = 'not_allowed' and pg_temp.allst(a) = s0);
    perform pg_temp.expire_session(sM2);
    o := pg_temp.opn(sM2, jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'has', 'gl', pl));
    v := v || pg_temp.chk('O13c', 'session หมดอายุ → session_required · ไม่มีอะไรเกิด', o ->> 'code' = 'session_required' and pg_temp.allst(a) = s0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O13-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    s0 := pg_temp.allst(a);
    pl := jsonb_build_array(jsonb_build_object('new_type_name', 'ไม่ควรเกิด', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1));
    perform analytics.shop_intake_token_revoke(a, pg_temp.act());
    o := pg_temp.opn(sM, jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'has', 'gl', pl));
    v := v || pg_temp.chk('O13d', 'QR ร้านถูกเพิกถอน → invalid_token · ไม่มีอะไรเกิด', o ->> 'code' = 'invalid_token' and pg_temp.allst(a) = s0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O13d-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    s0 := pg_temp.allst(a);
    pl := jsonb_build_array(jsonb_build_object('new_type_name', 'ไม่ควรเกิด', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1));
    r := pg_temp.wu(a, 'ZZ-Y ผู้จัดการปิดใช้', '5555', null, '{qc}', true, false); wY := (r ->> 'id')::uuid;
    r := pg_temp.pin_in(wY, '5555'); sY := r ->> 'session_hash';
    perform pg_temp.deact_raw(wY);
    o := pg_temp.opn(sY, jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'has', 'gl', pl));
    v := v || pg_temp.chk('O13e', 'ช่าง (ผู้จัดการ) ถูกปิดใช้งานหลังล็อกอิน → session_required · ไม่มีอะไรเกิด', o ->> 'code' = 'session_required' and pg_temp.allst(a) = s0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O13e-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    s0 := pg_temp.allst(a);
    pl := jsonb_build_array(jsonb_build_object('new_type_name', 'ไม่ควรเกิด', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1));
    perform pg_temp.wu(a, 'ZZ-M2 ผู้จัดการสอง', null, wM2, '{qc,pack}', false, null);
    o := pg_temp.opn(sM2, jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'has', 'gl', pl));
    v := v || pg_temp.chk('O13f', 'ถอนสิทธิ์ can_open_job ระหว่างกรอก → not_allowed · ไม่มีอะไรเกิด', o ->> 'code' = 'not_allowed' and pg_temp.allst(a) = s0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O13f-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O14: เพดานชื่อพลอยใหม่ 40 ชื่อ (ชนิด+รูปทรง) ต่อผู้จัดการต่อ 24 ชม. — นับเฉพาะชื่อที่เกิดใหม่จริง
  begin
    n0 := pg_temp.n_type(a) + pg_temp.n_shape(a);
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน O14a', 'ga', 'has', 'gl', pg_temp.newnames(30, 1)));
    v := v || pg_temp.chk('O14a', 'ชื่อใหม่ 30 ชื่อ (≤ 40) → ok · เกิด 30 ชนิดจริง', o ->> 'ok' = 'true' and pg_temp.n_type(a) + pg_temp.n_shape(a) = n0 + 30);
    s0 := pg_temp.allst(a);
    o := pg_temp.opn(sM, jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'has', 'gl', pg_temp.newnames(6, 2) || pg_temp.newnames(5, 3, true)));
    v := v || pg_temp.chk('O14b', 'อีก 11 ชื่อ (ชนิด 6 + รูปทรง 5 → 30 + 11 = 41 > 40) → gem_name_cap · ไม่มีอะไรเกิด (allst เท่าเดิม)', o ->> 'code' = 'gem_name_cap' and pg_temp.allst(a) = s0 and pg_temp.badkeys(o) = '');
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน O14c', 'ga', 'has', 'gl', pg_temp.newnames(5, 2) || pg_temp.newnames(5, 3, true)));
    v := v || pg_temp.chk('O14c', 'อีก 10 ชื่อ (ชนิด 5 + รูปทรง 5 → รวม 40 พอดี) → ok', o ->> 'ok' = 'true' and pg_temp.n_type(a) + pg_temp.n_shape(a) = n0 + 40);
    s0 := pg_temp.allst(a);
    o := pg_temp.opn(sM, jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'has', 'gl', pg_temp.newnames(1, 4)));
    v := v || pg_temp.chk('O14d', 'ชื่อที่ 41 → gem_name_cap · ไม่มีอะไรเกิด', o ->> 'code' = 'gem_name_cap' and pg_temp.allst(a) = s0);
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน O14e', 'ga', 'has', 'gl', jsonb_build_array(jsonb_build_object('new_type_name', (select t.name from analytics.gem_type t where t.shop_id = a and t.name like 'N%' order by t.name limit 1), 'shape_id', sRound, 'size_a', 5, 'qty_per_piece', 1))));
    v := v || pg_temp.chk('O14e', 'ถึงเพดานแล้ว พิมพ์ชื่อที่มีอยู่ (ใช้ตัวเดิม — ไม่นับเป็นชื่อใหม่) → ยัง ok', o ->> 'ok' = 'true' and pg_temp.n_type(a) + pg_temp.n_shape(a) = n0 + 40);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O14-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  -- O14f/O14g: เพดานนับ "ต่อผู้จัดการ" (assert จริงในบล็อกของตัวเอง — ผู้จัดการ M ใช้ชื่อใหม่ครบ 40 ชื่อแล้ว ผู้จัดการ M2 ต้องสร้างชื่อใหม่ได้) · แยกชนิด (O14f) / รูปทรง (O14g) เพื่อให้ mutant ของแต่ละ subquery ถูกจับด้วย id ของตัวเอง
  begin
    perform pg_temp.opn(sM, jsonb_build_object('label', 'M-30', 'metal', 'silver', 'ga', 'has', 'gl', pg_temp.newnames(30, 31)));
    perform pg_temp.opn(sM, jsonb_build_object('label', 'M-10', 'metal', 'silver', 'ga', 'has', 'gl', pg_temp.newnames(10, 32)));
    o2 := pg_temp.opn(sM, jsonb_build_object('label', 'M-ต้องตก', 'metal', 'silver', 'ga', 'has', 'gl', pg_temp.newnames(1, 33)));
    o := pg_temp.opn(sM2, jsonb_build_object('label', 'แหวน O14f', 'metal', 'silver', 'ga', 'has', 'gl', pg_temp.newnames(5, 39)));
    v := v || pg_temp.chk('O14f', 'เพดานนับต่อผู้จัดการ (ชนิด): M ใช้ครบ 40 ชื่อ (ชื่อที่ 41 ตก ' || coalesce(o2 ->> 'code', 'ผ่าน') || ') แต่ M2 สร้างชื่อใหม่ได้ · ชื่อที่ออฟฟิศสร้างไม่นับ', o2 ->> 'code' = 'gem_name_cap' and o ->> 'ok' = 'true');
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O14f-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    perform pg_temp.opn(sM, jsonb_build_object('label', 'M-30s', 'metal', 'silver', 'ga', 'has', 'gl', pg_temp.newnames(30, 41, true)));
    perform pg_temp.opn(sM, jsonb_build_object('label', 'M-10s', 'metal', 'silver', 'ga', 'has', 'gl', pg_temp.newnames(10, 42, true)));
    o2 := pg_temp.opn(sM, jsonb_build_object('label', 'M-ต้องตก', 'metal', 'silver', 'ga', 'has', 'gl', pg_temp.newnames(1, 43, true)));
    o := pg_temp.opn(sM2, jsonb_build_object('label', 'แหวน O14g', 'metal', 'silver', 'ga', 'has', 'gl', pg_temp.newnames(5, 49, true)));
    v := v || pg_temp.chk('O14g', 'เพดานนับต่อผู้จัดการ (รูปทรง): M ใช้ครบ 40 รูปทรง (ชื่อที่ 41 ตก ' || coalesce(o2 ->> 'code', 'ผ่าน') || ') แต่ M2 สร้างรูปทรงใหม่ได้', o2 ->> 'code' = 'gem_name_cap' and o ->> 'ok' = 'true');
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O14g-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O16: เพดานรายการพลอยใหม่ 120 รายการ/ผู้จัดการ/24 ชม. (security M1) — ขนาดใหม่ล้วน ไม่สร้างชื่อใหม่ แต่สร้างรายการ
  begin
    n0 := pg_temp.n_item(a);
    for k in 1 .. 4 loop
      o := pg_temp.opn(sM, jsonb_build_object('label', 'O16-' || k, 'metal', 'silver', 'ga', 'has', 'gl', pg_temp.newitems(30, k)));
      if o ->> 'ok' is distinct from 'true' then exit; end if;
    end loop;
    v := v || pg_temp.chk('O16a', '4 ใบ x 30 รายการใหม่ (ขนาดใหม่ ไม่มีชื่อใหม่) = 120 พอดี → ok ทั้งหมด · เกิด 120 รายการ · ชนิด/รูปทรงไม่เพิ่ม', o ->> 'ok' = 'true' and pg_temp.n_item(a) = n0 + 120);
    s0 := pg_temp.allst(a);
    o := pg_temp.opn(sM, jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'has', 'gl', pg_temp.newitems(1, 5)));
    v := v || pg_temp.chk('O16b', 'รายการที่ 121 → gem_name_cap · ไม่มีอะไรเกิด (allst เท่าเดิม)', o ->> 'code' = 'gem_name_cap' and pg_temp.allst(a) = s0);
    o := pg_temp.go(sM, jsonb_build_object('label', 'O16-reuse', 'ga', 'has', 'gl', pg_temp.newitems(30, 4)));
    v := v || pg_temp.chk('O16c', 'ถึงเพดานแล้ว ใช้รายการที่มีอยู่ (ไม่ใช่รายการใหม่) → ยัง ok (ต้องไม่พัง)', o ->> 'ok' = 'true' and pg_temp.n_item(a) = n0 + 120);
    o := pg_temp.opn(sM2, jsonb_build_object('label', 'O16-M2', 'metal', 'silver', 'ga', 'has', 'gl', pg_temp.newitems(30, 7)));
    v := v || pg_temp.chk('O16d', 'เพดานนับต่อผู้จัดการ: M2 สร้างรายการใหม่ได้ (รายการที่ออฟฟิศสร้างไม่นับ)', o ->> 'ok' = 'true');
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O16-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O15: ร้านปิดใช้งานขั้นฝัง (job_stage_def gem_set is_active=false → ระบบเสนอ/เรียงขั้นนี้ไม่ได้) → has/template ต้องไม่ได้ "ใบมีพลอยแต่ไม่มีขั้นฝัง" เงียบๆ = ถอยทั้งก้อน (not_ready)
  begin
    update analytics.job_stage_def set is_active = false where shop_id = a and code = 'gem_set';
    s0 := pg_temp.allst(a);
    o := pg_temp.opn(sM, jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'has', 'gl', pg_temp.std2()));
    o2 := pg_temp.opn(sM, jsonb_build_object('product', pT, 'ga', 'template'));
    v := v || pg_temp.chk('O15a', 'ขั้นฝังถูกปิดใช้ในร้าน + has → not_ready · ไม่มีใบ/พลอย/ตัวนับเกิด (allst เท่าเดิม)', o ->> 'code' = 'not_ready' and pg_temp.allst(a) = s0);
    v := v || pg_temp.chk('O15b', 'ขั้นฝังถูกปิดใช้ในร้าน + template (SKU มีแม่แบบ) → not_ready (ไม่ใช่ใบที่พลอยหาย/ไม่มีขั้นเงียบๆ) · ไม่มีอะไรเกิด', o2 ->> 'code' = 'not_ready' and pg_temp.allst(a) = s0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('O15-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;

-- ============================================================================
-- S. แก้พลอย (job_worker_gem_set) + อ่าน (job_worker_gem_get) — ทุกกลุ่มถอยกลับด้วย raise 'rb_191'
-- ============================================================================
-- แถวสำหรับส่งกลับ: จากผลของ get (gem_item_id + จำนวน + ตำแหน่ง) — ใช้ "แก้ทั้งชุดโดยคงรายการเดิม"
create function pg_temp.back(g jsonb) returns jsonb language sql as $c$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('gem_item_id', e ->> 'gem_item_id', 'qty_per_piece', (e ->> 'qty_per_piece')::int, 'position', e ->> 'position')) order by o), '[]'::jsonb)
    from jsonb_array_elements(g -> 'lines') with ordinality as t(e, o) $c$;
create function pg_temp.g_191_set() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); b uuid := pg_temp.fx('B');
  sM text := pg_temp.kv('sM'); sM2 text := pg_temp.kv('sM2'); sN text := pg_temp.kv('sN'); sMB text := pg_temp.kv('sMB'); tokb text := pg_temp.kv('tokh_b');
  wM uuid := pg_temp.fx('wM'); wM2 uuid := pg_temp.fx('wM2'); wN uuid := pg_temp.fx('wN');
  tG uuid := pg_temp.fx('tG'); tC uuid := pg_temp.fx('tC'); tB uuid := pg_temp.fx('tB'); tIn uuid := pg_temp.fx('tIn');
  sOval uuid := pg_temp.fx('sOval'); sRound uuid := pg_temp.fx('sRound'); sRoundB uuid := pg_temp.fx('sRoundB');
  pN uuid := pg_temp.fx('pN'); iB uuid := pg_temp.fx('iB'); jOff uuid := pg_temp.fx('jOff'); pT uuid := pg_temp.fx('pT'); iG1 uuid := pg_temp.fx('iG1');
  o jsonb; r0 jsonb; r jsonb; r1 jsonb; r2 jsonb; g jsonb; l jsonb; j uuid; j2 uuid; s0 text; s1 text; h0 text; h1 text; bad text; n0 int; cases jsonb; ev analytics.job_event; pl jsonb;
  st text; k int; rev0 text; item uuid; po uuid; sq int; lot uuid; st_keys text;
begin
  -- R1: อ่านพลอยของใบตัวเอง
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน R1', 'qty', 3, 'planned', 5, 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    g := pg_temp.ggt(sM, j);
    st_keys := (select string_agg(k2, ',' order by k2 collate "C") from jsonb_object_keys(g -> 'lines' -> 0) k2);
    v := v || pg_temp.chk('R1', 'get ใบตัวเอง: ok · editable true · lock_code ว่าง · มีขั้นฝัง · state specified · rev = ลายนิ้วมือจริง · 2 แถวเรียงตามลำดับ · qty_total = จำนวน/ชิ้น x เริ่มผลิต (10 / 150) · max_lines 30',
      g ->> 'ok' = 'true' and (g ->> 'editable')::boolean and g ->> 'lock_code' is null and (g ->> 'has_gem_stage')::boolean and g ->> 'state' = 'specified' and g ->> 'rev' = analytics.job_gem_rev(j)
      and jsonb_array_length(g -> 'lines') = 2 and g #>> '{lines,0,label}' = 'โกเมน · ไข่ · 4×6 มม.' and g #>> '{lines,1,label}' = 'CZ · กลม · 1.5 มม.'
      and (g #>> '{lines,0,qty_total}')::int = 10 and (g #>> '{lines,1,qty_total}')::int = 150 and (g ->> 'max_lines')::int = 30 and g #>> '{job,job_no}' = o ->> 'job_no');
    v := v || pg_temp.chk('R1b', 'แต่ละแถวมี key เท่านี้ (ไม่มีราคา/ผู้ขาย/ผู้สร้าง/วันที่): ' || st_keys,
      st_keys = 'gem_item_id,has_length,label,position,qty_per_piece,qty_total,shape_id,shape_name,size_a,size_b,type_id,type_name' and pg_temp.badkeys(g) = '' and not pg_temp.has_px(g));
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('R1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- G1: แก้ได้จริง (แก้จำนวน · ลบแถว · เพิ่มแถว) + event ของช่าง + ฉลาก snapshot คงเดิม
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน G1', 'qty', 3, 'planned', 5, 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    g := pg_temp.ggt(sM, j);
    select min(created_at) into st from analytics.job_gem_bom where job_id = j and line_seq = 1;
    r := pg_temp.gst(sM, j, jsonb_build_array(
      jsonb_build_object('gem_item_id', g #>> '{lines,0,gem_item_id}', 'qty_per_piece', 3, 'position', 'ล้อมรอบ'),
      pg_temp.gl(tC, sRound, 2, null, 10, 'ข้าง')), g ->> 'rev');
    v := v || pg_temp.chk('G1', 'แก้ทั้งชุด (คงแถว 1 แก้จำนวน 2→3 · ลบ CZ 1.5 · เพิ่ม CZ 2) → ok changed · count 2 · state specified · rev ใหม่ = ลายนิ้วมือจริงและต่างจากเดิม',
      r ->> 'ok' = 'true' and (r ->> 'changed')::boolean and (r ->> 'count')::int = 2 and r ->> 'state' = 'specified' and r ->> 'rev' = analytics.job_gem_rev(j) and r ->> 'rev' <> g ->> 'rev'
      and r #>> '{lines,0,label}' = 'โกเมน · ไข่ · 4×6 มม.' and r #>> '{lines,1,label}' = 'CZ · กลม · 2 มม.' and (r #>> '{lines,0,qty_total}')::int = 15 and (r #>> '{lines,1,qty_total}')::int = 50);
    v := v || pg_temp.chk('G1b', 'แถวที่ส่ง gem_item_id คงแถวเดิม (created_at เท่าเดิม · ฉลาก snapshot คงเดิม) · แถวใหม่ source shopfloor ผู้สร้าง = ช่าง · แถวที่หายถูกลบ',
      (select min(created_at) from analytics.job_gem_bom where job_id = j and line_seq = 1) = st::timestamptz and pg_temp.n_bom(j) = 2
      and not exists (select 1 from analytics.job_gem_bom where job_id = j and gem_label = 'CZ · กลม · 1.5 มม.')
      and exists (select 1 from analytics.job_gem_bom where job_id = j and gem_label = 'CZ · กลม · 2 มม.' and source = 'shopfloor' and created_by_worker_id = wM and created_by is null));
    select * into ev from analytics.job_event e where e.job_id = j and e.event_type = 'bom_change' and e.payload ->> 'phase' = 'free_before_start';
    v := v || pg_temp.chk('G1c', 'event bom_change (แก้): actor null · worker = ผู้จัดการ · ช่อง worker_qr · source shopfloor · before 2 แถว/after 2 แถว (label · qty_per_piece · position เท่านั้น) · ไม่มีราคา · รวมเป็น 2 event (create + แก้)',
      pg_temp.n_bev(j) = 2 and ev.actor is null and ev.worker_id = wM and ev.channel = 'worker_qr' and ev.payload ->> 'source' = 'shopfloor' and jsonb_array_length(ev.payload -> 'before') = 2 and jsonb_array_length(ev.payload -> 'after') = 2
      and (select string_agg(k2, ',' order by k2 collate "C") from jsonb_object_keys(ev.payload -> 'after' -> 0) k2) = 'label,position,qty_per_piece' and not pg_temp.has_px(ev.payload) and ev.payload -> 'reason' is null);
    g := pg_temp.ggt(sM, j);
    r1 := pg_temp.gst(sM, j, pg_temp.back(g), g ->> 'rev');
    v := v || pg_temp.chk('G1d', 'ส่งชุดเดิมซ้ำ (ไม่เปลี่ยนอะไร) → ok changed=false · ไม่เพิ่ม event · rev เท่าเดิม', r1 ->> 'ok' = 'true' and not (r1 ->> 'changed')::boolean and pg_temp.n_bev(j) = 2 and r1 ->> 'rev' = g ->> 'rev');
    r1 := pg_temp.gst(sM, j, '[]'::jsonb, g ->> 'rev');
    g := pg_temp.ggt(sM, j);
    v := v || pg_temp.chk('G1e', 'เหลือ 0 แถวได้ (ใบมีขั้นฝัง) → ok count 0 · state unspecified (เตือน ไม่บล็อก) · rev empty · get เห็นว่าง', r1 ->> 'ok' = 'true' and (r1 ->> 'count')::int = 0 and r1 ->> 'state' = 'unspecified' and r1 ->> 'rev' = 'empty' and jsonb_array_length(g -> 'lines') = 0 and g ->> 'rev' = 'empty' and (g ->> 'editable')::boolean);
    r1 := pg_temp.gst(sM, j, jsonb_build_array(pg_temp.gl(tG, sOval, 4, 6, 7)), 'empty');
    v := v || pg_temp.chk('G1f', 'จาก 0 แถวกลับมามีพลอยด้วย rev empty → ok · state specified', r1 ->> 'ok' = 'true' and (r1 ->> 'count')::int = 1 and r1 ->> 'state' = 'specified');
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- G2: CAS กัน 2 เครื่อง — เครื่องที่ถือ rev เก่า = gem_conflict ไม่ทับเงียบ
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน G2', 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    r0 := pg_temp.ggt(sM, j);
    r1 := pg_temp.gst(sM, j, jsonb_build_array(pg_temp.gl(tG, sOval, 4, 6, 9)), r0 ->> 'rev');
    h0 := pg_temp.bomhash(j); n0 := pg_temp.n_bev(j);
    r2 := pg_temp.gst(sM, j, jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 1)), r0 ->> 'rev');
    v := v || pg_temp.chk('G2', 'เครื่อง 1 แก้สำเร็จ → เครื่อง 2 ถือ rev เก่า → gem_conflict · BOM/event ไม่ขยับ (ไม่ทับเงียบ)',
      r1 ->> 'ok' = 'true' and r2 ->> 'ok' = 'false' and r2 ->> 'code' = 'gem_conflict' and pg_temp.bomhash(j) = h0 and pg_temp.n_bev(j) = n0 and (select qty_per_piece from analytics.job_gem_bom where job_id = j) = 9);
    r2 := pg_temp.gst(sM, j, jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 1)), r1 ->> 'rev');
    v := v || pg_temp.chk('G2b', 'โหลดใหม่แล้วใช้ rev ล่าสุด → แก้ได้ (ต้องไม่พัง)', r2 ->> 'ok' = 'true' and (r2 ->> 'count')::int = 1);
    bad := '';
    foreach st in array array['', 'zzz', 'ABCDEF0123456789ABCDEF0123456789', 'empty ', '0123456789abcdef0123456789abcde'] loop
      r2 := pg_temp.gst(sM, j, jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 2)), st);
      if r2 ->> 'code' is distinct from 'gem_rev_invalid' then bad := bad || '[' || st || ']=>' || coalesce(r2 ->> 'code', 'x') || ' ; '; end if;
    end loop;
    r2 := pg_temp.gst(sM, j, jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 2)), null);
    if r2 ->> 'code' is distinct from 'gem_rev_invalid' then bad := bad || '[null]=>' || coalesce(r2 ->> 'code', 'x') || ' ; '; end if;
    v := v || pg_temp.chk('G2c', 'rev ว่าง/ผิดรูป/ตัวพิมพ์ใหญ่/ขาด 1 ตัว/null → gem_rev_invalid (ไม่ข้าม CAS) · ผิด: ' || bad, bad = '' and (select qty_per_piece from analytics.job_gem_bom where job_id = j) = 1);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G2-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- G3: ใบที่ไม่ใช่ของช่างคนนี้ (ด่านเจ้าของ) — ข้อความเดียวกันทุกกรณี order_not_found
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน G3', 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    g := pg_temp.ggt(sM, j); rev0 := g ->> 'rev'; h0 := pg_temp.bomhash(j); n0 := pg_temp.n_bev(j);
    pl := jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 1));
    r := pg_temp.gst(sM2, j, pl, rev0); r1 := pg_temp.ggt(sM2, j);
    v := v || pg_temp.chk('G3a', 'ผู้จัดการคนอื่น (ร้านเดียวกัน) แก้/อ่านใบของ M → order_not_found ทั้งคู่ · BOM/event ไม่ขยับ', r ->> 'code' = 'order_not_found' and r1 ->> 'code' = 'order_not_found' and pg_temp.bomhash(j) = h0 and pg_temp.n_bev(j) = n0);
    r := pg_temp.gst(sM, jOff, pl, 'empty'); r1 := pg_temp.ggt(sM, jOff);
    v := v || pg_temp.chk('G3b', 'ใบออฟฟิศ (opened_via office · มีขั้นฝัง) → order_not_found ทั้งแก้และอ่าน · ไม่มี BOM เกิด', r ->> 'code' = 'order_not_found' and r1 ->> 'code' = 'order_not_found' and pg_temp.n_bom(jOff) = 0);
    r := pg_temp.gst(sMB, j, pl, rev0, '{}'::jsonb, tokb); r1 := pg_temp.ggt(sMB, j, '{}'::jsonb, tokb);
    v := v || pg_temp.chk('G3c', 'ผู้จัดการร้านอื่น (token+session ร้าน B) → order_not_found ทั้งแก้และอ่าน · BOM ไม่ขยับ', r ->> 'code' = 'order_not_found' and r1 ->> 'code' = 'order_not_found' and pg_temp.bomhash(j) = h0);
    r := pg_temp.gst(sM, gen_random_uuid(), pl, rev0); r1 := pg_temp.gst(sM, null, pl, rev0); r2 := pg_temp.ggt(sM, null);
    v := v || pg_temp.chk('G3d', 'job id สุ่ม / null → order_not_found', r ->> 'code' = 'order_not_found' and r1 ->> 'code' = 'order_not_found' and r2 ->> 'code' = 'order_not_found');
    r := pg_temp.gst(sM, j, pl, rev0, '{}'::jsonb, tokb);
    v := v || pg_temp.chk('G3e', 'session ของร้าน A + token ร้าน B (ข้ามร้าน) → session_required · BOM ไม่ขยับ', r ->> 'code' = 'session_required' and pg_temp.bomhash(j) = h0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G3-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    -- G3f: ส่วนย่อย (lot child) ของใบที่ผู้จัดการเปิด → ไม่ใช่เป้าหมาย (parent ต้อง null)
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน G3f', 'qty', 4, 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    perform pg_temp.rcv(a, j);
    select s.seq into sq from analytics.job_stage s where s.job_id = j and s.status = 'received' order by s.seq limit 1;
    r := pg_temp.q(format('select analytics.job_lot_split(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_qty=>1, p_qty_scrap=>0, p_scrap_reason=>null, p_qty_hold=>(select s.qty_in - s.qty_scrap - s.qty_split_out from analytics.job_stage s where s.job_id = %L and s.seq = %L), p_actor=>%L, p_weight_move_g=>null)', a, j, sq, j, sq, pg_temp.act()));
    select id into lot from analytics.job where parent_job_id = j limit 1;
    r1 := pg_temp.gst(sM, lot, jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 1)), 'empty'); r2 := pg_temp.ggt(sM, lot);
    v := v || pg_temp.chk('G3f', 'id ของส่วนย่อย (ใบลูก) → order_not_found ทั้งแก้และอ่าน · ไม่มี BOM เกิดที่ส่วนย่อย · แยกส่วนสำเร็จ: ' || coalesce(r ->> '_err', 'ok'),
      lot is not null and r1 ->> 'code' = 'order_not_found' and r2 ->> 'code' = 'order_not_found' and pg_temp.n_bom(lot) = 0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G3f-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- G4: ล็อก — ช่างเริ่มรับงาน / ยกเลิก / ปิด
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน G4', 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    g := pg_temp.ggt(sM, j);
    r := pg_temp.rcv(a, j);
    v := v || pg_temp.chk('G4pre', 'จำลองช่างรับขั้นแรก (RPC ออฟฟิศ job_office_receive): มีขั้น received/sent · ' || coalesce(r ->> '_err', r ->> 'code', 'ok'), pg_temp.received(j));
    h0 := pg_temp.bomhash(j); n0 := pg_temp.n_bev(j);
    r := pg_temp.gst(sM, j, jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 1)), g ->> 'rev');
    v := v || pg_temp.chk('G4a', 'ขั้นแรกถูกรับแล้ว (รวม race: เปิดหน้าแก้ editable=true → ช่างรับ → กดบันทึก) → job_locked (ไม่ใช่ gem_conflict/สำเร็จ) · BOM/event ไม่ขยับ',
      (g ->> 'editable')::boolean and r ->> 'ok' = 'false' and r ->> 'code' = 'job_locked' and pg_temp.bomhash(j) = h0 and pg_temp.n_bev(j) = n0);
    g := pg_temp.ggt(sM, j);
    v := v || pg_temp.chk('G4b', 'ตอนล็อก: get ยังอ่านได้ (2 แถว) · editable false · lock_code job_locked · my list: gem_editable false', g ->> 'ok' = 'true' and not (g ->> 'editable')::boolean and g ->> 'lock_code' = 'job_locked' and jsonb_array_length(g -> 'lines') = 2
      and exists (select 1 from jsonb_array_elements(pg_temp.pmy(sM) -> 'jobs') e where (e ->> 'job_id')::uuid = j and not (e ->> 'gem_editable')::boolean));
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน G4c', 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    perform analytics.job_cancel(a, j, 'verify W3 G4c', pg_temp.act());
    h0 := pg_temp.bomhash(j);
    r := pg_temp.gst(sM, j, jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 1)), analytics.job_gem_rev(j)); g := pg_temp.ggt(sM, j);
    v := v || pg_temp.chk('G4c', 'ใบ cancelled → job_cancelled · get lock_code job_cancelled · BOM ไม่ขยับ', r ->> 'code' = 'job_cancelled' and g ->> 'lock_code' = 'job_cancelled' and not (g ->> 'editable')::boolean and pg_temp.bomhash(j) = h0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G4c-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน G4d', 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    select production_order_item_id into item from analytics.job where id = j;
    select production_order_id into po from analytics.production_order_item where id = item;
    perform pg_temp.ack(a, po);
    perform pg_temp.bind(a, item, pg_temp.fx('fixb'));
    r := pg_temp.dn(a, po);
    h0 := pg_temp.bomhash(j);
    r1 := pg_temp.gst(sM, j, jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 1)), analytics.job_gem_rev(j)); g := pg_temp.ggt(sM, j);
    v := v || pg_temp.chk('G4d', 'ใบผลิตปิดแล้ว (production_order_done · ' || coalesce(r ->> '_err', coalesce(r ->> 'status', '?')) || ') → job_closed · get lock_code job_closed · BOM ไม่ขยับ',
      r ->> 'status' = 'done' and r1 ->> 'code' = 'job_closed' and g ->> 'lock_code' = 'job_closed' and pg_temp.bomhash(j) = h0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G4d-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  v := v || pg_temp.chk('G4f', 'ล็อกแถวใบ (for update) มาก่อนตรวจหน้าต่าง/CAS ในนิยาม job_worker_gem_set (race พิสูจน์ได้แค่โครงสร้าง — ไม่มีเทสต์ 2 connection)',
    position('for update' in pg_get_functiondef('analytics.job_worker_gem_set(text,text,uuid,jsonb,text,jsonb,text)'::regprocedure)) > 0
    and position('for update' in pg_get_functiondef('analytics.job_worker_gem_set(text,text,uuid,jsonb,text,jsonb,text)'::regprocedure)) < position('job_worker_gem_block(v_job)' in pg_get_functiondef('analytics.job_worker_gem_set(text,text,uuid,jsonb,text,jsonb,text)'::regprocedure))
    and position('job_worker_gem_block(v_job)' in pg_get_functiondef('analytics.job_worker_gem_set(text,text,uuid,jsonb,text,jsonb,text)'::regprocedure)) < position('job_gem_rev(v_job) is distinct from p_expected_rev' in pg_get_functiondef('analytics.job_worker_gem_set(text,text,uuid,jsonb,text,jsonb,text)'::regprocedure)));

  -- G5: ใบไม่มีขั้นฝัง → no_gem_stage ("แจ้งออฟฟิศเพิ่มขั้น" — ระบบไม่เพิ่มขั้นเอง)
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน G5', 'ga', 'none')); j := (o ->> 'job')::uuid;
    g := pg_temp.ggt(sM, j); h0 := pg_temp.bomhash(j);
    r := pg_temp.gst(sM, j, jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 1)), g ->> 'rev');
    v := v || pg_temp.chk('G5a', 'ใบตอบ "ไม่มีพลอย" (ไม่มีขั้นฝัง) → get: has_gem_stage false · editable false · lock_code no_gem_stage · แก้ → no_gem_stage · ไม่มี BOM · ระบบไม่เพิ่มขั้นให้เอง',
      not (g ->> 'has_gem_stage')::boolean and not (g ->> 'editable')::boolean and g ->> 'lock_code' = 'no_gem_stage' and r ->> 'code' = 'no_gem_stage' and pg_temp.n_bom(j) = 0 and not pg_temp.has_stage(j) and pg_temp.bomhash(j) = h0);
    o := pg_temp.go(sM, jsonb_build_object('product', pN)); j := (o ->> 'job')::uuid;
    r := pg_temp.gst(sM, j, jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 1)), 'empty');
    v := v || pg_temp.chk('G5b', 'ใบที่เปิดแบบเดิม (SKU ไม่มีแม่แบบ ไม่มีขั้นฝัง) → no_gem_stage', r ->> 'code' = 'no_gem_stage' and pg_temp.n_bom(j) = 0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G5-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- G6: แถวผิดตอนแก้ — BOM/event ไม่ขยับ
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน G6', 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    g := pg_temp.ggt(sM, j); rev0 := g ->> 'rev'; h0 := pg_temp.bomhash(j); n0 := pg_temp.n_bev(j); s0 := pg_temp.allst(a);
    cases := jsonb_build_array(
      jsonb_build_object('id', 'q0', 'code', 'qty_invalid', 'row', 1, 'field', 'qty_per_piece', 'lines', jsonb_build_array(pg_temp.gl(tG, sOval, 4, 6, 0))),
      jsonb_build_object('id', 'q1001', 'code', 'qty_invalid', 'row', 1, 'field', 'qty_per_piece', 'lines', jsonb_build_array(pg_temp.gl(tG, sOval, 4, 6, 1001))),
      jsonb_build_object('id', 'qNaN', 'code', 'qty_invalid', 'row', 1, 'field', 'qty_per_piece', 'lines', jsonb_build_array(jsonb_build_object('type_id', tG, 'shape_id', sOval, 'size_a', 4, 'size_b', 6, 'qty_per_piece', 'NaN'))),
      jsonb_build_object('id', 'q1.5', 'code', 'qty_invalid', 'row', 1, 'field', 'qty_per_piece', 'lines', jsonb_build_array(jsonb_build_object('type_id', tG, 'shape_id', sOval, 'size_a', 4, 'size_b', 6, 'qty_per_piece', 1.5))));
    bad := pg_temp.run_bad('set', sM, j, rev0, cases);
    v := v || pg_temp.chk('G6q', 'qty 0 / 1001 / NaN / 1.5 ตอนแก้ → gem_line_invalid qty_invalid ตรงแถว+ช่อง · ผิด: ' || bad, bad = '');
    cases := jsonb_build_array(
      jsonb_build_object('id', 's0', 'code', 'size_invalid', 'row', 1, 'field', 'size_a', 'lines', jsonb_build_array(pg_temp.gl(tC, sRound, 0, null, 1))),
      jsonb_build_object('id', 's101', 'code', 'size_invalid', 'row', 1, 'field', 'size_a', 'lines', jsonb_build_array(pg_temp.gl(tC, sRound, 101, null, 1))),
      jsonb_build_object('id', 'sNaN', 'code', 'size_invalid', 'row', 1, 'field', 'size_a', 'lines', jsonb_build_array(jsonb_build_object('type_id', tC, 'shape_id', sRound, 'size_a', 'NaN', 'qty_per_piece', 1))),
      jsonb_build_object('id', 's3dec', 'code', 'size_invalid', 'row', 1, 'field', 'size_a', 'lines', jsonb_build_array(pg_temp.gl(tC, sRound, 1.234, null, 1))));
    bad := pg_temp.run_bad('set', sM, j, rev0, cases);
    v := v || pg_temp.chk('G6s', 'ขนาด 0 / 101 / NaN / ทศนิยม 3 ตอนแก้ → size_invalid · ผิด: ' || bad, bad = '');
    cases := jsonb_build_array(
      jsonb_build_object('id', 'h1', 'code', 'size_b_unexpected', 'row', 1, 'field', 'size_b', 'lines', jsonb_build_array(pg_temp.gl(tC, sRound, 3, 3, 1))),
      jsonb_build_object('id', 'h2', 'code', 'size_b_required', 'row', 1, 'field', 'size_b', 'lines', jsonb_build_array(pg_temp.gl(tG, sOval, 4, null, 1))));
    bad := pg_temp.run_bad('set', sM, j, rev0, cases);
    v := v || pg_temp.chk('G6h', 'has_length ไม่ตรงตอนแก้ → size_b_unexpected | size_b_required · ผิด: ' || bad, bad = '');
    cases := jsonb_build_array(jsonb_build_object('id', 'l31', 'code', 'too_many_lines', 'row', 31, 'lines', (select jsonb_agg(pg_temp.gl(tC, sRound, g2::numeric, null, 1)) from generate_series(1, 31) g2)));
    bad := pg_temp.run_bad('set', sM, j, rev0, cases);
    v := v || pg_temp.chk('G6l', '31 แถวตอนแก้ → too_many_lines · ผิด: ' || bad, bad = '');
    cases := jsonb_build_array(
      jsonb_build_object('id', 't1', 'code', 'gem_type_invalid', 'row', 1, 'field', 'type', 'lines', jsonb_build_array(pg_temp.gl(tB, sRound, 3, null, 1))),
      jsonb_build_object('id', 't3', 'code', 'gem_shape_invalid', 'row', 1, 'field', 'shape', 'lines', jsonb_build_array(pg_temp.gl(tC, sRoundB, 3, null, 1))),
      jsonb_build_object('id', 't4', 'code', 'gem_item_invalid', 'row', 1, 'field', 'gem_item_id', 'lines', jsonb_build_array(jsonb_build_object('gem_item_id', iB, 'qty_per_piece', 1))));
    bad := pg_temp.run_bad('set', sM, j, rev0, cases);
    v := v || pg_temp.chk('G6t', 'ชนิด/รูปทรง/รายการของร้านอื่นตอนแก้ → gem_type_invalid | gem_shape_invalid | gem_item_invalid · ผิด: ' || bad, bad = '');
    cases := jsonb_build_array(
      jsonb_build_object('id', 'k1', 'code', 'line_invalid', 'row', 1, 'field', 'price', 'lines', jsonb_build_array(jsonb_build_object('type_id', tC, 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1, 'price', 5))),
      jsonb_build_object('id', 'k3', 'code', 'line_invalid', 'row', 1, 'field', 'line', 'lines', jsonb_build_array(to_jsonb(5))));
    bad := pg_temp.run_bad('set', sM, j, rev0, cases);
    v := v || pg_temp.chk('G6k', 'key แปลก (price) / ไม่ใช่ object ตอนแก้ → line_invalid · ผิด: ' || bad, bad = '');
    cases := jsonb_build_array(
      jsonb_build_object('id', 'n1', 'code', 'name_invalid', 'row', 1, 'field', 'type', 'lines', jsonb_build_array(jsonb_build_object('new_type_name', '12', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1))),
      jsonb_build_object('id', 'n5', 'code', 'shape_new_invalid', 'row', 1, 'field', 'shape', 'lines', jsonb_build_array(jsonb_build_object('type_id', tC, 'new_shape', jsonb_build_object('name', 'ทรงใหม่'), 'size_a', 3, 'qty_per_piece', 1))));
    bad := pg_temp.run_bad('set', sM, j, rev0, cases);
    v := v || pg_temp.chk('G6n', 'ชื่อใหม่ผิด/รูปทรงใหม่ไม่ระบุ has_length ตอนแก้ → ปฏิเสธ · ผิด: ' || bad, bad = '');
    cases := jsonb_build_array(
      jsonb_build_object('id', 'p1', 'code', 'position_invalid', 'row', 1, 'field', 'position', 'lines', jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 1, '<b>'))),
      jsonb_build_object('id', 'p2', 'code', 'position_invalid', 'row', 1, 'field', 'position', 'lines', jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 1, repeat('ก', 41)))));
    bad := pg_temp.run_bad('set', sM, j, rev0, cases);
    v := v || pg_temp.chk('G6p', 'ตำแหน่งผิดตอนแก้ → position_invalid · ผิด: ' || bad, bad = '');
    r := pg_temp.gst(sM, j, null, rev0); r1 := pg_temp.gst(sM, j, '{"a":1}'::jsonb, rev0); r2 := pg_temp.gst(sM, j, '"x"'::jsonb, rev0);
    v := v || pg_temp.chk('G6u', 'p_lines เป็น null / object / string → gem_line_invalid lines_invalid (แถว 0 ช่อง lines)',
      r ->> 'gem_code' = 'lines_invalid' and r1 ->> 'gem_code' = 'lines_invalid' and r2 ->> 'gem_code' = 'lines_invalid' and r ->> 'gem_row' = '0' and r ->> 'gem_field' = 'lines');
    perform pg_temp.sact(a, 'type', tIn, false);
    s1 := pg_temp.allst(a);
    r := pg_temp.gst(sM, j, jsonb_build_array(pg_temp.gl(tIn, sRound, 3, null, 1)), rev0);
    v := v || pg_temp.chk('G6x', 'ชนิดที่ปิดใช้งาน → gem_inactive', r ->> 'gem_code' = 'gem_inactive' and pg_temp.allst(a) = s1);
    v := v || pg_temp.chk('G6z', 'แถวผิดทุกแบบ (~25 เคส) → BOM/event/ชนิด/รูปทรง/รายการของใบไม่ขยับ (bomhash · n_bev · allst เท่าเดิม · rev เท่าเดิม)',
      pg_temp.bomhash(j) = h0 and pg_temp.n_bev(j) = n0 and analytics.job_gem_rev(j) = rev0 and pg_temp.allst(a) = s1);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G6-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- G7: ตัวดักชื่อคล้าย + force ตอนแก้
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน G7', 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    g := pg_temp.ggt(sM, j); rev0 := g ->> 'rev'; h0 := pg_temp.bomhash(j); s0 := pg_temp.allst(a);
    pl := jsonb_build_array(jsonb_build_object('new_type_name', 'Garnett', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1));
    r := pg_temp.gst(sM, j, pl, rev0);
    v := v || pg_temp.chk('G7a', 'ชื่อคล้ายตอนแก้ ไม่ force → gem_similar + similar[] · ไม่เขียนอะไร (allst เท่าเดิม)',
      r ->> 'code' = 'gem_similar' and r #>> '{similar,0,name}' = 'Garnett' and r #>> '{similar,0,matches,0,name}' = 'Garnet' and pg_temp.allst(a) = s0 and pg_temp.badkeys(r) = '');
    r := pg_temp.gst(sM, j, pl, rev0, jsonb_build_object('gf', jsonb_build_array(jsonb_build_object('kind', 'type', 'name', 'Other'))));
    r1 := pg_temp.gst(sM, j, pl, rev0, jsonb_build_object('gf', jsonb_build_array(jsonb_build_object('kind', 'shape', 'name', 'Garnett'))));
    v := v || pg_temp.chk('G7c', 'force ชื่ออื่น/ผิด kind (ไม่ได้ถูกถาม) → ยัง gem_similar · ไม่เขียนอะไร', r ->> 'code' = 'gem_similar' and r1 ->> 'code' = 'gem_similar' and pg_temp.allst(a) = s0);
    pl := jsonb_build_array(jsonb_build_object('new_type_name', 'Garnett', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1), jsonb_build_object('new_type_name', 'Amethist', 'shape_id', sRound, 'size_a', 4, 'qty_per_piece', 1));
    r := pg_temp.gst(sM, j, pl, rev0, jsonb_build_object('gf', jsonb_build_array(jsonb_build_object('kind', 'type', 'name', 'Garnett'))));
    v := v || pg_temp.chk('G7d', 'คล้าย 2 ชื่อ force แค่ 1 → ยัง gem_similar (ชื่อที่ 2) · ไม่เขียนอะไร', r ->> 'code' = 'gem_similar' and pg_temp.allst(a) = s0 and exists (select 1 from jsonb_array_elements(r -> 'similar') e where e ->> 'name' = 'Amethist'));
    r := pg_temp.gst(sM, j, pl, rev0, jsonb_build_object('gf', 'true'::jsonb));
    r1 := pg_temp.gst(sM, j, pl, rev0, jsonb_build_object('gf', '[5]'::jsonb));
    v := v || pg_temp.chk('G7e', 'force เป็น boolean true / array ที่ element ผิด → gem_force_invalid (ไม่ใช่ blanket) · ไม่เขียนอะไร', r ->> 'code' = 'gem_force_invalid' and r1 ->> 'code' = 'gem_force_invalid' and pg_temp.allst(a) = s0);
    r := pg_temp.gst(sM, j, pl, rev0, jsonb_build_object('gf', jsonb_build_array(jsonb_build_object('kind', 'type', 'name', 'Garnett'), jsonb_build_object('kind', 'type', 'name', 'Amethist'))));
    v := v || pg_temp.chk('G7b', 'force ครบทั้ง 2 ชื่อที่ถูกถาม → ok · เกิด 2 ชนิด · ผลบอกชื่อใหม่', r ->> 'ok' = 'true' and (r ->> 'count')::int = 2 and r #> '{summary,created_types}' = '["Garnett","Amethist"]'::jsonb
      and exists (select 1 from analytics.gem_type where shop_id = a and name = 'Garnett' and created_by_worker_id = wM));
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G7-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน G7f', 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    g := pg_temp.ggt(sM, j); n0 := pg_temp.n_type(a);
    pl := jsonb_build_array(jsonb_build_object('new_type_name', 'GARNET', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1));
    r := pg_temp.gst(sM, j, pl, g ->> 'rev', jsonb_build_object('gf', jsonb_build_array(jsonb_build_object('kind', 'type', 'name', 'GARNET'))));
    v := v || pg_temp.chk('G7f', 'ชื่อซ้ำเป๊ะหลัง normalize + force → ไม่สร้างชนิดซ้ำ · ใช้ตัวเดิม (reused) · ฉลากชื่อเดิม', r ->> 'ok' = 'true' and pg_temp.n_type(a) = n0 and r #>> '{lines,0,label}' = 'Garnet · กลม · 3 มม.' and r #>> '{summary,reused,0,name}' = 'Garnet');
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G7f-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- G8: ด่านสิทธิ์ของ gem_set/gem_get (BOM ต้องไม่ขยับ)
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน G8', 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    g := pg_temp.ggt(sM, j); rev0 := g ->> 'rev'; h0 := pg_temp.bomhash(j); n0 := pg_temp.n_bev(j);
    pl := jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 1));
    bad := '';
    foreach st in array array['', 'zzz', repeat('A', 64), repeat('g', 64), repeat('a', 63)] loop
      r := pg_temp.gst(nullif(st, ''), j, pl, rev0); r1 := pg_temp.ggt(nullif(st, ''), j); r2 := pg_temp.gct(nullif(st, ''));
      if r ->> 'code' is distinct from 'session_required' or r1 ->> 'code' is distinct from 'session_required' or r2 ->> 'code' is distinct from 'session_required' then bad := bad || '[' || st || '] ; '; end if;
    end loop;
    r := pg_temp.gst(repeat('a', 64), j, pl, rev0);
    v := v || pg_temp.chk('G8a', 'ไม่มี session / hash ผิดรูป / ตัวพิมพ์ใหญ่ / hash ที่ไม่มีจริง → session_required ทั้ง gem_set · gem_get · gem_catalog · BOM ไม่ขยับ · ผิด: ' || bad,
      bad = '' and r ->> 'code' = 'session_required' and pg_temp.bomhash(j) = h0 and pg_temp.n_bev(j) = n0);
    r := pg_temp.gst(sN, j, pl, rev0); r1 := pg_temp.ggt(sN, j); r2 := pg_temp.gct(sN);
    v := v || pg_temp.chk('G8e', 'ช่างทั่วไป (ไม่มี can_open_job · session ถูกต้อง) → not_allowed ทั้ง gem_set · gem_get · gem_catalog · BOM ไม่ขยับ', r ->> 'code' = 'not_allowed' and r1 ->> 'code' = 'not_allowed' and r2 ->> 'code' = 'not_allowed' and pg_temp.bomhash(j) = h0);
    perform pg_temp.rlclear('{}'::jsonb);
    for k in 1 .. 30 loop perform pg_temp.gst(sN, j, pl, rev0, '{"rl":"1"}'::jsonb); end loop;
    v := v || pg_temp.chk('G8h', 'ช่างที่ไม่มีสิทธิ์ยิงรัว 30 ครั้ง → ไม่เผาถังต่อช่างของใครเลย (ไม่มีแถว wg:/wgr: ของ N)', not exists (select 1 from analytics.worker_rate_limit where key in ('wg:' || wN::text, 'wgr:' || wN::text)));
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G8-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    o := pg_temp.go(sM2, jsonb_build_object('label', 'แหวน G8b', 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    g := pg_temp.ggt(sM2, j); rev0 := g ->> 'rev'; h0 := pg_temp.bomhash(j);
    pl := jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 1));
    perform pg_temp.expire_session(sM2);
    r := pg_temp.gst(sM2, j, pl, rev0); r1 := pg_temp.ggt(sM2, j);
    v := v || pg_temp.chk('G8b', 'session หมดอายุ → session_required (แก้/อ่าน) · BOM ไม่ขยับ', r ->> 'code' = 'session_required' and r1 ->> 'code' = 'session_required' and pg_temp.bomhash(j) = h0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G8b-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    o := pg_temp.go(sM2, jsonb_build_object('label', 'แหวน G8c', 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    g := pg_temp.ggt(sM2, j); rev0 := g ->> 'rev'; h0 := pg_temp.bomhash(j);
    pl := jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 1));
    perform pg_temp.deact_raw(wM2);
    r := pg_temp.gst(sM2, j, pl, rev0); r1 := pg_temp.ggt(sM2, j);
    v := v || pg_temp.chk('G8c', 'ช่างถูกปิดใช้งานหลังล็อกอิน → session_required (แก้/อ่าน) · BOM ไม่ขยับ', r ->> 'code' = 'session_required' and r1 ->> 'code' = 'session_required' and pg_temp.bomhash(j) = h0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G8c-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    o := pg_temp.go(sM2, jsonb_build_object('label', 'แหวน G8d', 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    g := pg_temp.ggt(sM2, j); rev0 := g ->> 'rev'; h0 := pg_temp.bomhash(j);
    pl := jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 1));
    perform pg_temp.wu(a, 'ZZ-M2 ผู้จัดการสอง', null, wM2, '{qc,pack}', false, null);
    r := pg_temp.gst(sM2, j, pl, rev0); r1 := pg_temp.ggt(sM2, j); r2 := pg_temp.gct(sM2);
    v := v || pg_temp.chk('G8d', 'ถอนสิทธิ์ can_open_job หลังเปิดใบ → not_allowed ทั้ง gem_set · gem_get · gem_catalog · BOM ไม่ขยับ · "ใบที่ฉันเปิด" ว่าง',
      r ->> 'code' = 'not_allowed' and r1 ->> 'code' = 'not_allowed' and r2 ->> 'code' = 'not_allowed' and pg_temp.bomhash(j) = h0 and jsonb_array_length(pg_temp.pmy(sM2) -> 'jobs') = 0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G8d-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน G8g', 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    g := pg_temp.ggt(sM, j); rev0 := g ->> 'rev'; h0 := pg_temp.bomhash(j);
    pl := jsonb_build_array(pg_temp.gl(tC, sRound, 3, null, 1));
    perform analytics.shop_intake_token_revoke(a, pg_temp.act());
    r := pg_temp.gst(sM, j, pl, rev0); r1 := pg_temp.ggt(sM, j); r2 := pg_temp.gct(sM);
    v := v || pg_temp.chk('G8g', 'QR ร้านถูกเพิกถอน → invalid_token ทั้ง gem_set · gem_get · gem_catalog · BOM ไม่ขยับ', r ->> 'code' = 'invalid_token' and r1 ->> 'code' = 'invalid_token' and r2 ->> 'code' = 'invalid_token' and pg_temp.bomhash(j) = h0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G8g-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    -- token สุ่มที่ไม่มีจริง / null → invalid_token และไม่เขียนถังใดๆ (ยกเว้นถัง IP ถ้าส่ง ip)
    perform pg_temp.rlclear('{}'::jsonb);
    r := pg_temp.q(format('select analytics.job_worker_gem_set(%L, %L, null, ''[]''::jsonb, ''empty'', null, null)', repeat('b', 64), repeat('c', 64)));
    r1 := pg_temp.q(format('select analytics.job_worker_gem_get(null, %L, null, null)', repeat('c', 64)));
    r2 := pg_temp.q(format('select analytics.job_worker_gem_catalog(%L, %L, null, null)', 'zz', repeat('c', 64)));
    v := v || pg_temp.chk('G8i', 'token สุ่ม/null/ผิดรูป → invalid_token ทั้ง 3 RPC · ไม่เขียนแถวถังใดๆ (กันตารางบวมจากการยิงสุ่ม)',
      r ->> 'code' = 'invalid_token' and r1 ->> 'code' = 'invalid_token' and r2 ->> 'code' = 'invalid_token' and not exists (select 1 from analytics.worker_rate_limit));
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G8i-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- G8r: จำกัดอัตรา (ถังต่อ IP · ต่อช่าง · นับหลัง session valid)
  begin
    perform pg_temp.rlclear('{}'::jsonb);
    bad := '';
    -- ใช้ token สุ่ม (ไม่ถึงถังต่อช่าง) เพื่อวัดถังต่อ IP ล้วนๆ: ด่าน IP มาก่อนตรวจ token
    for k in 1 .. 300 loop
      r := pg_temp.q(format('select analytics.job_worker_gem_set(%L, %L, null, ''[]''::jsonb, ''empty'', null, %L)', repeat('b', 64), repeat('c', 64), repeat('a', 64)));
      if r ->> 'code' is distinct from 'invalid_token' then bad := bad || k::text || ':' || coalesce(r ->> 'code', 'x') || ' '; exit; end if;
    end loop;
    r := pg_temp.q(format('select analytics.job_worker_gem_set(%L, %L, null, ''[]''::jsonb, ''empty'', null, %L)', repeat('b', 64), repeat('c', 64), repeat('a', 64)));
    v := v || pg_temp.chk('G8r1', 'ถังต่อ IP (เขียน · ถังเดียวกับเปิดใบ/รูป): ครั้งที่ 1-300 ผ่านด่านถัง · ครั้งที่ 301 → rate_limited · ' || bad, bad = '' and r ->> 'code' = 'rate_limited');
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G8r1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    perform pg_temp.rlclear('{}'::jsonb);
    bad := '';
    for k in 1 .. 20 loop
      r := pg_temp.gst(sM, null, '[]'::jsonb, 'empty', jsonb_build_object('rl', '1'));
      if r ->> 'code' is distinct from 'order_not_found' then bad := bad || k::text || ':' || coalesce(r ->> 'code', 'x') || ' '; exit; end if;
    end loop;
    r := pg_temp.gst(sM, null, '[]'::jsonb, 'empty', jsonb_build_object('rl', '1'));
    v := v || pg_temp.chk('G8r2', 'ถังต่อช่าง (เขียน): ครั้งที่ 1-20 ผ่าน · ครั้งที่ 21 → rate_limited · ' || bad, bad = '' and r ->> 'code' = 'rate_limited');
    perform pg_temp.rlclear('{}'::jsonb);
    for k in 1 .. 30 loop perform pg_temp.gst(repeat('d', 64), null, '[]'::jsonb, 'empty', '{"rl":"1"}'::jsonb); end loop;
    r := pg_temp.gst(sM, null, '[]'::jsonb, 'empty', jsonb_build_object('rl', '1'));
    v := v || pg_temp.chk('G8r3', 'session ปลอมยิง 30 ครั้ง ไม่เผาถังผู้จัดการตัวจริง (นับหลังพบ session ที่ valid) → ครั้งถัดไปของ M ผ่าน · wg:M = 1',
      r ->> 'code' = 'order_not_found' and (select hits from analytics.worker_rate_limit where key = 'wg:' || wM::text limit 1) = 1);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G8r2-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    perform pg_temp.rlclear('{}'::jsonb);
    bad := '';
    for k in 1 .. 120 loop
      r := pg_temp.ggt(sM, null, '{"rl":"1"}'::jsonb);
      if r ->> 'code' is distinct from 'order_not_found' then bad := bad || k::text || ':' || coalesce(r ->> 'code', 'x') || ' '; exit; end if;
    end loop;
    r := pg_temp.ggt(sM, null, '{"rl":"1"}'::jsonb); r1 := pg_temp.gct(sM, null, '{"rl":"1"}'::jsonb);
    v := v || pg_temp.chk('G8r4', 'ถังต่อช่าง (อ่าน get+catalog ใช้ร่วมกัน): 1-120 ผ่าน · 121 → rate_limited ทั้ง get และ catalog · ' || bad, bad = '' and r ->> 'code' = 'rate_limited' and r1 ->> 'code' = 'rate_limited');
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G8r4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- G9: เพดานชื่อพลอยใหม่ 40 ชื่อ/ผู้จัดการ/24 ชม. ตอนแก้ (ชุดเดียวกับตอนเปิดใบ)
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน G9', 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    g := pg_temp.ggt(sM, j);
    n0 := pg_temp.n_type(a);
    r := pg_temp.gst(sM, j, pg_temp.newnames(30, 21), g ->> 'rev');
    v := v || pg_temp.chk('G9a', 'แก้ด้วยชื่อใหม่ 30 ชื่อ (≤ 40) → ok · เกิด 30 ชนิด', r ->> 'ok' = 'true' and pg_temp.n_type(a) = n0 + 30);
    g := pg_temp.ggt(sM, j); h0 := pg_temp.bomhash(j); s0 := pg_temp.allst(a);
    r := pg_temp.gst(sM, j, pg_temp.newnames(11, 22), g ->> 'rev');
    v := v || pg_temp.chk('G9b', 'อีก 11 ชื่อ (30 + 11 = 41 > 40) → gem_name_cap · BOM/ชนิด ไม่ขยับ', r ->> 'code' = 'gem_name_cap' and pg_temp.bomhash(j) = h0 and pg_temp.allst(a) = s0);
    r := pg_temp.gst(sM, j, pg_temp.newnames(10, 22), g ->> 'rev');
    v := v || pg_temp.chk('G9c', 'อีก 10 ชื่อ (รวม 40 พอดี) → ok', r ->> 'ok' = 'true' and pg_temp.n_type(a) = n0 + 40);
    g := pg_temp.ggt(sM, j);
    r := pg_temp.gst(sM, j, pg_temp.newnames(1, 23), g ->> 'rev');
    r1 := pg_temp.gst(sM, j, pg_temp.back(g), g ->> 'rev');
    v := v || pg_temp.chk('G9d', 'ชื่อที่ 41 → gem_name_cap · แก้ที่ไม่สร้างชื่อใหม่ (ส่งชุดเดิม) ยังทำได้ (ต้องไม่พัง)', r ->> 'code' = 'gem_name_cap' and r1 ->> 'ok' = 'true');
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G9-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- G10: เพดานรายการพลอยใหม่ 120 รายการ/ผู้จัดการ/24 ชม. ตอนแก้ (security M1) — ขนาดใหม่ล้วน
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน G10', 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    n0 := pg_temp.n_item(a);
    for k in 1 .. 4 loop
      g := pg_temp.ggt(sM, j);
      r := pg_temp.gst(sM, j, pg_temp.newitems(30, 10 + k), g ->> 'rev');
      if r ->> 'ok' is distinct from 'true' then exit; end if;
    end loop;
    v := v || pg_temp.chk('G10a', 'แก้ 4 ครั้ง x 30 รายการใหม่ (ขนาดใหม่) = 120 พอดี → ok ทั้งหมด · เกิด 120 รายการ', r ->> 'ok' = 'true' and pg_temp.n_item(a) = n0 + 120);
    g := pg_temp.ggt(sM, j); h0 := pg_temp.bomhash(j); s0 := pg_temp.allst(a);
    r := pg_temp.gst(sM, j, pg_temp.newitems(1, 20), g ->> 'rev');
    v := v || pg_temp.chk('G10b', 'รายการที่ 121 → gem_name_cap · BOM/รายการ ไม่ขยับ', r ->> 'code' = 'gem_name_cap' and pg_temp.bomhash(j) = h0 and pg_temp.allst(a) = s0);
    r1 := pg_temp.gst(sM, j, pg_temp.back(g), g ->> 'rev');
    v := v || pg_temp.chk('G10c', 'ถึงเพดานแล้ว แก้ที่ไม่สร้างรายการใหม่ (ส่งชุดเดิมกลับ) ยังทำได้ (ต้องไม่พัง)', r1 ->> 'ok' = 'true');
    o := pg_temp.go(sM2, jsonb_build_object('label', 'แหวน G10-M2', 'ga', 'has', 'gl', pg_temp.std2())); j2 := (o ->> 'job')::uuid;
    g := pg_temp.ggt(sM2, j2);
    r2 := pg_temp.gst(sM2, j2, pg_temp.newitems(30, 30), g ->> 'rev');
    v := v || pg_temp.chk('G10d', 'เพดานนับต่อผู้จัดการ: M2 สร้างรายการใหม่ได้ตอนแก้ (รายการที่ M/ออฟฟิศสร้างไม่นับ)', r2 ->> 'ok' = 'true');
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G10-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- G11: ออฟฟิศปิดใช้รายการที่อยู่ในใบอยู่แล้ว → ผู้จัดการยังแก้ใบนั้นได้ (security M2) แต่ปิดแล้วที่ "ไม่ได้อยู่ในใบ" ยังใช้ไม่ได้
  begin
    o := pg_temp.go(sM, jsonb_build_object('product', pT, 'ga', 'template')); j := (o ->> 'job')::uuid;
    r0 := pg_temp.sact(a, 'item', iG1, false);
    g := pg_temp.ggt(sM, j);
    r := pg_temp.gst(sM, j, pg_temp.back(g), g ->> 'rev');
    v := v || pg_temp.chk('G11a', 'รายการในใบถูกออฟฟิศปิดใช้ทีหลัง → ผู้จัดการส่งชุดเดิมกลับ (แก้จำนวนได้) ต้อง ok ไม่ติด gem_inactive · ปิดใช้สำเร็จจริง',
      (r0 ->> 'is_active')::boolean = false and not exists (select 1 from analytics.gem_item where id = iG1 and is_active) and g ->> 'ok' = 'true' and r ->> 'ok' = 'true');
    g := pg_temp.ggt(sM, j);
    r := pg_temp.gst(sM, j, jsonb_build_array(jsonb_build_object('gem_item_id', g #>> '{lines,0,gem_item_id}', 'qty_per_piece', 4)), g ->> 'rev');
    v := v || pg_temp.chk('G11b', 'แก้จำนวนของรายการที่ถูกปิดใช้ + ลบอีกแถว → ok · แถวที่ปิดใช้ยังอยู่ในใบ', r ->> 'ok' = 'true' and exists (select 1 from analytics.job_gem_bom where job_id = j and gem_item_id = iG1 and qty_per_piece = 4));
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน G11-อื่น', 'ga', 'has', 'gl', jsonb_build_array(pg_temp.gl(tC, sRound, 1.5, null, 5)))); j2 := (o ->> 'job')::uuid;
    g := pg_temp.ggt(sM, j2); h0 := pg_temp.bomhash(j2);
    r1 := pg_temp.gst(sM, j2, jsonb_build_array(jsonb_build_object('gem_item_id', iG1, 'qty_per_piece', 1)), g ->> 'rev');
    v := v || pg_temp.chk('G11c', 'ปิดใช้แล้วและ "ไม่ได้อยู่ในใบนี้" (อยู่ในใบอื่น) → ยัง gem_inactive · BOM ใบนี้ไม่ขยับ', r1 ->> 'code' = 'gem_line_invalid' and r1 ->> 'gem_code' = 'gem_inactive' and pg_temp.bomhash(j2) = h0);
    r := pg_temp.icreate(a, jsonb_build_object('type_id', tC, 'shape_id', sRound, 'size_a', 7, 'qty_per_piece', 1)); item := (r -> 'item' ->> 'gem_item_id')::uuid;
    r0 := pg_temp.sact(a, 'item', item, false);
    g := pg_temp.ggt(sM, j); h1 := pg_temp.bomhash(j);
    r2 := pg_temp.gst(sM, j, pg_temp.back(g) || jsonb_build_array(jsonb_build_object('gem_item_id', item, 'qty_per_piece', 1)), g ->> 'rev');
    v := v || pg_temp.chk('G11d', 'ส่งชุดเดิมของใบ + รายการอื่นที่ปิดใช้ (ไม่ได้อยู่ในใบ) → gem_inactive · ข้อยกเว้นแคบเฉพาะรายการที่อยู่ในใบ · BOM ไม่ขยับ',
      (r0 ->> 'is_active')::boolean = false and r2 ->> 'code' = 'gem_line_invalid' and r2 ->> 'gem_code' = 'gem_inactive' and pg_temp.bomhash(j) = h1);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('G11-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;

-- ============================================================================
-- C. แคตตาล็อก · "ใบที่ฉันเปิด" · ราคาไม่รั่ว · สิทธิ์ · ต้องไม่พัง
-- ============================================================================
create function pg_temp.g_191_misc() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); b uuid := pg_temp.fx('B');
  sM text := pg_temp.kv('sM'); sM2 text := pg_temp.kv('sM2'); sN text := pg_temp.kv('sN');
  wM uuid := pg_temp.fx('wM'); wN uuid := pg_temp.fx('wN');
  tG uuid := pg_temp.fx('tG'); tC uuid := pg_temp.fx('tC'); tIn uuid := pg_temp.fx('tIn'); tM1 uuid := pg_temp.fx('tM1'); tM2 uuid := pg_temp.fx('tM2');
  sOval uuid := pg_temp.fx('sOval'); sRound uuid := pg_temp.fx('sRound');
  pT uuid := pg_temp.fx('pT'); pN uuid := pg_temp.fx('pN'); pB uuid := pg_temp.fx('pB'); pOFF uuid := pg_temp.fx('pOFF'); pLIVE uuid := pg_temp.fx('pLIVE');
  o jsonb; o2 jsonb; r jsonb; r1 jsonb; r2 jsonb; g jsonb; l jsonb; e jsonb; j uuid; j2 uuid; j3 uuid; j4 uuid; k int; bad text; st text; s0 text; pid uuid; sig text; sess text; tokh text; ev analytics.job_event; agg jsonb; item uuid;
  keys text;
begin
  -- C1: แคตตาล็อกสำหรับหน้างาน (ไม่มีราคา · เฉพาะที่ใช้ได้ · ขนาดที่เคยใช้ ≤ 6 ต่อคู่)
  begin
    for k in 2 .. 9 loop perform pg_temp.icreate(a, jsonb_build_object('type_id', tC, 'shape_id', sRound, 'size_a', k, 'qty_per_piece', 1)); end loop;
    perform pg_temp.sact(a, 'type', tIn, false);
    perform pg_temp.mrg(a, 'type', tM1, tM2);
    g := pg_temp.gct(sM);
    v := v || pg_temp.chk('C1', 'catalog: ok · ชนิดที่ใช้ได้เท่านั้น (ไม่มี Quartz ที่ปิดใช้ · Opal ที่ถูกรวม · ทับทิมบีของร้าน B) · มี โกเมน CZ Garnet Amethyst Zircon · max_lines 30',
      g ->> 'ok' = 'true' and not exists (select 1 from jsonb_array_elements(g -> 'types') t where t ->> 'name' in ('Quartz', 'Opal', 'ทับทิมบี'))
      and (select count(*) from jsonb_array_elements(g -> 'types') t where t ->> 'name' in ('โกเมน', 'CZ', 'Garnet', 'Amethyst', 'Zircon')) = 5 and (g ->> 'max_lines')::int = 30);
    v := v || pg_temp.chk('C1b', 'catalog: รูปทรง ≥ 13 (seed 12 + Briolette) พร้อม has_length · key ของชนิด = id,name · รูปทรง = has_length,id,name · ไม่มีราคา/ผู้ขาย/ผู้สร้าง/วันที่',
      jsonb_array_length(g -> 'shapes') >= 13 and exists (select 1 from jsonb_array_elements(g -> 'shapes') s where s ->> 'name' = 'ไข่' and (s ->> 'has_length')::boolean) and exists (select 1 from jsonb_array_elements(g -> 'shapes') s where s ->> 'name' = 'กลม' and not (s ->> 'has_length')::boolean)
      and (select string_agg(k2, ',' order by k2 collate "C") from jsonb_object_keys(g -> 'types' -> 0) k2) = 'id,name'
      and (select string_agg(k2, ',' order by k2 collate "C") from jsonb_object_keys(g -> 'shapes' -> 0) k2) = 'has_length,id,name'
      and pg_temp.badkeys(g) = '' and not pg_temp.has_px(g) and (select count(*) from jsonb_object_keys(g)) = 7);
    v := v || pg_temp.chk('C1c', 'catalog: ขนาดที่เคยใช้ ≤ 6 ต่อ (ชนิด x รูปทรง) — CZ·กลม มี 9 ขนาดแต่ส่ง 6 · ทั้งหมด ≤ 600 · key = shape_id,size_a,size_b,type_id · ไม่มี template เมื่อไม่ส่ง SKU',
      (select count(*) from jsonb_array_elements(g -> 'sizes') z where (z ->> 'type_id')::uuid = tC and (z ->> 'shape_id')::uuid = sRound) = 6 and jsonb_array_length(g -> 'sizes') <= 600
      and (select string_agg(k2, ',' order by k2 collate "C") from jsonb_object_keys(g -> 'sizes' -> 0) k2) = 'shape_id,size_a,size_b,type_id' and not (g ->> 'has_template')::boolean and g -> 'template' = '[]'::jsonb);
    g := pg_temp.gct(sM, pT);
    v := v || pg_temp.chk('C1d', 'catalog + SKU มีแม่แบบ → has_template true · template 2 แถว (ฉลาก/ชนิด/รูปทรง/ขนาด/จำนวน/ตำแหน่ง) · key เท่านั้นที่กำหนด · ไม่มีราคา',
      (g ->> 'has_template')::boolean and jsonb_array_length(g -> 'template') = 2 and g #>> '{template,0,label}' = 'โกเมน · ไข่ · 4×6 มม.' and (g #>> '{template,0,qty_per_piece}')::int = 2 and g #>> '{template,0,position}' = 'ล้อมรอบ'
      and (g #>> '{template,1,qty_per_piece}')::int = 30 and (select string_agg(k2, ',' order by k2 collate "C") from jsonb_object_keys(g -> 'template' -> 0) k2) = 'gem_item_id,has_length,label,position,qty_per_piece,shape_id,shape_name,size_a,size_b,type_id,type_name'
      and pg_temp.badkeys(g) = '' and not pg_temp.has_px(g));
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('C1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    -- C1e: SKU ที่ไม่ผ่านเงื่อนไข (ไม่มีแม่แบบ · ร้านอื่น · ปิดใช้ · live* · ไม่พบ) = ผลเหมือนกันทุกกรณี (ไม่บอกว่ามี SKU นั้นในระบบ) — ทดสอบให้ SKU ปิดใช้/live มีแม่แบบจริงแล้วยังไม่ถึงผู้จัดการ
    pid := analytics.product_upsert(a, 'ZZ191-TOFF', 'แหวนแม่แบบแล้วปิดใช้', null, 'fixed', 40, null, null, null, null, null, null, null, true);
    r := pg_temp.tset(a, pid, jsonb_build_array(jsonb_build_object('gem_item_id', pg_temp.fx('iG1'), 'qty_per_piece', 1)));
    perform analytics.product_upsert(a, 'ZZ191-TOFF', 'แหวนแม่แบบแล้วปิดใช้', null, 'fixed', 40, null, null, null, null, null, null, null, false);
    r1 := pg_temp.tset(a, pLIVE, jsonb_build_array(jsonb_build_object('gem_item_id', pg_temp.fx('iG1'), 'qty_per_piece', 1)));
    bad := '';
    for e in select jsonb_build_object('id', x.id, 'p', x.p) from (values ('pN', pN), ('pB(ร้านอื่น)', pB), ('pOFF', pOFF), ('ปิดใช้แต่มีแม่แบบ', pid), ('live*', pLIVE), ('สุ่ม', gen_random_uuid())) x(id, p) loop
      g := pg_temp.gct(sM, (e ->> 'p')::uuid);
      if not (g ->> 'ok' = 'true' and g ->> 'has_template' = 'false' and g -> 'template' = '[]'::jsonb) then bad := bad || (e ->> 'id') || '=>' || left(g::text, 80) || ' ; '; end if;
    end loop;
    v := v || pg_temp.chk('C1e', 'SKU ไม่มีแม่แบบ / ร้านอื่น / ปิดใช้ (แม้มีแม่แบบ) / live* (แม้มีแม่แบบ) / สุ่ม → has_template false · template [] เหมือนกัน (ไม่เปิดเผย) · ตั้งแม่แบบ SKU ปิดใช้/live สำเร็จ: ' || coalesce(r ->> '_err', 'ok') || '/' || coalesce(r1 ->> '_err', 'ok') || ' · ผิด: ' || bad,
      bad = '' and not (r ? '_err'));
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('C1e-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- L: "ใบที่ฉันเปิด" + บรรทัดพลอย (W-9)
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน L-has', 'qty', 3, 'planned', 5, 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน L-none', 'ga', 'none')); j2 := (o ->> 'job')::uuid;
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน L-zero', 'ga', 'has', 'gl', pg_temp.std2())); j3 := (o ->> 'job')::uuid;
    r := pg_temp.gst(sM, j3, '[]'::jsonb, analytics.job_gem_rev(j3));
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน L-lock', 'ga', 'has', 'gl', pg_temp.std2())); j4 := (o ->> 'job')::uuid;
    perform pg_temp.rcv(a, j4);
    l := pg_temp.pmy(sM);
    keys := (select string_agg(k2, ',' order by k2 collate "C") from jsonb_object_keys(l -> 'jobs' -> 0) k2);
    v := v || pg_temp.chk('L1a', 'รายการ: ใบ has (specified · 2 รายการ · 160 เม็ด = 32 x 5 · แก้ได้)',
      exists (select 1 from jsonb_array_elements(l -> 'jobs') e2 where (e2 ->> 'job_id')::uuid = j and e2 ->> 'gem_state' = 'specified' and (e2 ->> 'gem_count')::int = 2 and (e2 ->> 'gem_pieces')::int = 160 and (e2 ->> 'gem_editable')::boolean and (e2 ->> 'editable')::boolean));
    v := v || pg_temp.chk('L1b', 'ใบ none (ไม่มีขั้นฝัง): not_needed · 0 · 0 · แก้พลอยไม่ได้ (แต่รูป editable ยังเป็นจริง = ตัดสินแยกกัน)',
      exists (select 1 from jsonb_array_elements(l -> 'jobs') e2 where (e2 ->> 'job_id')::uuid = j2 and e2 ->> 'gem_state' = 'not_needed' and (e2 ->> 'gem_count')::int = 0 and (e2 ->> 'gem_pieces')::int = 0 and not (e2 ->> 'gem_editable')::boolean and (e2 ->> 'editable')::boolean));
    v := v || pg_temp.chk('L1c', 'ใบมีขั้นฝังแต่ล้างพลอยเหลือ 0: unspecified (⚑ ยังไม่ระบุพลอย) · 0 · แก้ได้',
      exists (select 1 from jsonb_array_elements(l -> 'jobs') e2 where (e2 ->> 'job_id')::uuid = j3 and e2 ->> 'gem_state' = 'unspecified' and (e2 ->> 'gem_count')::int = 0 and (e2 ->> 'gem_editable')::boolean));
    v := v || pg_temp.chk('L1d', 'ใบที่ช่างรับขั้นแรกแล้ว: ยังเห็นพลอย (specified · 2) แต่ gem_editable false และ editable (รูป) false',
      exists (select 1 from jsonb_array_elements(l -> 'jobs') e2 where (e2 ->> 'job_id')::uuid = j4 and e2 ->> 'gem_state' = 'specified' and (e2 ->> 'gem_count')::int = 2 and not (e2 ->> 'gem_editable')::boolean and not (e2 ->> 'editable')::boolean));
    v := v || pg_temp.chk('L1e', 'key ต่อใบ = ของ W2 เดิมครบ + gem_state/gem_count/gem_pieces/gem_editable เท่านั้น (ไม่มีราคา) · ' || keys,
      keys = 'created_at,design_label,editable,gem_count,gem_editable,gem_pieces,gem_state,job_id,job_no,metal,my_photos_count,order_no,photos_count,qty,status' and pg_temp.badkeys(l) = '' and not pg_temp.has_px(l) and (l ->> 'max_photos')::int = 3);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('L1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน ของ M', 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    o2 := pg_temp.go(sM2, jsonb_build_object('label', 'แหวน ของ M2', 'ga', 'has', 'gl', pg_temp.std2())); j2 := (o2 ->> 'job')::uuid;
    l := pg_temp.pmy(sM); r := pg_temp.pmy(sM2);
    v := v || pg_temp.chk('L2', 'ต้องไม่พัง: ผู้จัดการเห็นเฉพาะใบของตัวเอง (ไม่เห็นใบของ M2 / ไม่เห็นใบออฟฟิศ) และกลับกัน',
      exists (select 1 from jsonb_array_elements(l -> 'jobs') e2 where (e2 ->> 'job_id')::uuid = j) and not exists (select 1 from jsonb_array_elements(l -> 'jobs') e2 where (e2 ->> 'job_id')::uuid in (j2, pg_temp.fx('jOff')))
      and exists (select 1 from jsonb_array_elements(r -> 'jobs') e2 where (e2 ->> 'job_id')::uuid = j2) and not exists (select 1 from jsonb_array_elements(r -> 'jobs') e2 where (e2 ->> 'job_id')::uuid in (j, pg_temp.fx('jOff'))));
    perform pg_temp.wu(a, 'ZZ-M ผู้จัดการ', null, wM, '{qc}', false, null);
    l := pg_temp.pmy(sM);
    v := v || pg_temp.chk('L3', 'ต้องไม่พัง: ถอนสิทธิ์ can_open_job → open_allowed false · รายการว่าง (ไม่ใช่ error)', l ->> 'ok' = 'true' and l ->> 'open_allowed' = 'false' and jsonb_array_length(l -> 'jobs') = 0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('L2-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- X1: ราคาพลอยไม่หลุดถึงผู้จัดการ/ช่างทุกช่องทาง (ราคาเลขแปลก 7391.2468 · 9999.9999 · 1234.5678 อยู่ในตารางราคา — ต้องไม่ปรากฏใน response/error ใดๆ)
  begin
    agg := '[]'::jsonb;
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน X1', 'qty', 3, 'planned', 5, 'ga', 'has', 'gl', pg_temp.std2(), 'idem', 'ikX1aaaaaaaaaaaaaaaaaaaa')); j := (o ->> 'job')::uuid;
    agg := agg || jsonb_build_array(o);
    o2 := pg_temp.opn(sM, jsonb_build_object('label', 'ซ้ำ', 'metal', 'silver', 'idem', 'ikX1aaaaaaaaaaaaaaaaaaaa', 'ga', 'has', 'gl', pg_temp.std2())); agg := agg || jsonb_build_array(o2);
    agg := agg || jsonb_build_array(pg_temp.opn(sM, jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'has', 'gl', jsonb_build_array(jsonb_build_object('new_type_name', 'Garnett', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1)))));
    agg := agg || jsonb_build_array(pg_temp.opn(sM, jsonb_build_object('label', 'x', 'metal', 'silver', 'ga', 'has', 'gl', jsonb_build_array(jsonb_build_object('gem_item_id', pg_temp.fx('iG1'), 'qty_per_piece', 0, 'price', 7391.2468)))));
    agg := agg || jsonb_build_array(pg_temp.opn(sM, jsonb_build_object('product', pT, 'ga', 'template')));
    g := pg_temp.ggt(sM, j); agg := agg || jsonb_build_array(g);
    agg := agg || jsonb_build_array(pg_temp.gct(sM, pT));
    r := pg_temp.gst(sM, j, pg_temp.back(g), g ->> 'rev'); agg := agg || jsonb_build_array(r);
    agg := agg || jsonb_build_array(pg_temp.gst(sM, j, pg_temp.back(g), g ->> 'rev'));
    agg := agg || jsonb_build_array(pg_temp.gst(sM, j, jsonb_build_array(jsonb_build_object('new_type_name', 'Garnett', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1)), r ->> 'rev'));
    agg := agg || jsonb_build_array(pg_temp.gst(sM, j, jsonb_build_array(jsonb_build_object('gem_item_id', pg_temp.fx('iC1'), 'qty_per_piece', 0, 'price', 9999.9999)), r ->> 'rev'));
    agg := agg || jsonb_build_array(pg_temp.pmy(sM));
    -- ผลของ RPC ราคา (ออฟฟิศ) ยังมีเลขราคา = เทสต์การรั่วมีความหมาย (ไม่ใช่ตรวจเลขที่ไม่เคยมี)
    l := pg_temp.q(format('select analytics.gem_catalog_list(%L, %L, false)', a, pg_temp.own()));
    v := v || pg_temp.chk('X1', 'ผลของ ' || jsonb_array_length(agg) || ' คำขอ (เปิดใบ/replay/ชื่อคล้าย/แถวผิดพร้อมคีย์ price/SKU แม่แบบ · get · catalog+template · set ok/ไม่เปลี่ยน/ชื่อคล้าย/แถวผิด · ใบที่ฉันเปิด) ไม่มีเลขราคา (ทุกราคา ≥ 1,000 ในตารางราคา+audit) ในข้อความ/ตัวเลข',
      not pg_temp.has_px(agg));
    v := v || pg_temp.chk('X1a', 'ไม่มี key ราคา/ต้นทุน/ผู้ขาย/ผู้สร้าง/เผื่อแตก/ชั้นราคา/worker_id ในทุกผลลัพธ์ข้างบน · ' || pg_temp.badkeys(agg), pg_temp.badkeys(agg) = '');
    v := v || pg_temp.chk('X1c', 'เทสต์รั่วมีความหมาย: ราคาเลขแปลกยังอยู่ทาง RPC ราคาฝั่งออฟฟิศ (gem_catalog_list มี 7391.2468) และตารางราคามี ≥ 3 รายการ',
      position('7391.2468' in l::text) > 0 and pg_temp.n_price() >= 3 and pg_temp.has_px(l));
    select * into ev from analytics.job_event where job_id = j and event_type = 'bom_change' and payload ->> 'phase' = 'free_before_start';
    v := v || pg_temp.chk('X1b', 'payload ของ event bom_change/intake_open ไม่มีราคา',
      not pg_temp.has_px((select jsonb_agg(e3.payload) from analytics.job_event e3 where e3.job_id = j and e3.event_type in ('bom_change', 'intake_open'))));
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('X1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- Z6: ช่างฝัง (หน้า /w/<token> หลัง PIN) เห็นพลอยที่ผู้จัดการกรอก — ไม่มีราคา
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน Z6', 'qty', 3, 'planned', 5, 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    tokh := analytics.job_sha256_hex(o ->> 'token');
    r := pg_temp.pin_job(tokh, wN, '8642'); sess := r ->> 'session_hash';
    g := pg_temp.q(format('select analytics.job_worker_resolve(%L, %L, null)', tokh, sess));
    v := v || pg_temp.chk('Z6', 'ต้องไม่พัง/บูรณาการ: ช่างฝังล็อกอินที่ QR ใบงาน (ที่ผู้จัดการเปิด) → resolve เห็นพลอย 2 แถว (ฉลาก+จำนวน) · state specified · ไม่มีเลขราคา · ล็อกอิน: ' || coalesce(r ->> '_err', coalesce(r ->> 'code', 'ok')),
      r ->> 'ok' = 'true' and g ->> 'ok' = 'true' and not pg_temp.has_px(g) and position('โกเมน · ไข่ · 4×6 มม.' in g::text) > 0 and position('CZ · กลม · 1.5 มม.' in g::text) > 0 and position('specified' in g::text) > 0);
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('Z6-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- Z: ต้องไม่พัง — ของเดิมที่ 0191 ไม่ควรแตะ
  v := v || pg_temp.chk('Z1', 'production_order_done (ฟังก์ชัน 💰) ไม่ถูกแตะ: md5 ตรงค่าที่ล็อกไว้ใน 0187', (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'production_order_done') = '56cc6d4c97fa1e3feca56012bcf190f3');
  v := v || pg_temp.chk('Z5', 'core ที่ 0190 ให้ไว้ไม่ถูก replace: job_gem_bom_replace_core · gem_lines_prepare · job_gem_state · job_gem_edit_window md5 เท่าที่ลอกจาก DB 23 ต.ค. · job_worker_open เหลือ signature เดียว (18 args) · signature เดิม (15 args) หายไป',
    (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_gem_bom_replace_core') = '3ad6f2241e0365f7f559282a0ca77846'
    and (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'gem_lines_prepare') = '16308318f328a83ec9abd563071d9530'
    and (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_gem_state') = 'd8b803f44d2cd770280ce412a23aa4eb'
    and (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_gem_edit_window') = '3f32118a5ea654d07f29bad1bb7e7575'
    and (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'job_worker_open') = 1
    and to_regprocedure('analytics.job_worker_open(text,text,text,uuid,text,text,numeric,numeric,integer,integer,date,boolean,text,text,text)') is null
    and to_regprocedure('analytics.job_worker_open(text,text,text,uuid,text,text,numeric,numeric,integer,integer,date,boolean,text,text,text,jsonb,text,jsonb)') is not null);
  begin
    -- Z2: ใบออฟฟิศ + แม่แบบ SKU เดิม (create ด้วย p_gem_lines ของออฟฟิศ · ไม่ส่ง = คัดลอกแม่แบบ) ทำงานเหมือนเดิม
    o := pg_temp.office_job(a, pT);
    v := v || pg_temp.chk('Z2', 'ต้องไม่พัง: ออฟฟิศสร้างใบจาก SKU มีแม่แบบ (ขั้นฝัง + ไม่ส่งพลอย) → คัดลอกแม่แบบ 2 แถว source product (job_create_* ของ 0190 ไม่ถูกแตะ)',
      o ->> 'job' is not null and pg_temp.n_bom((o ->> 'job')::uuid) = 2 and not exists (select 1 from analytics.job_gem_bom g2 where g2.job_id = (o ->> 'job')::uuid and g2.source <> 'product'));
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('Z2-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    -- Z3/Z4: ออฟฟิศแก้พลอยของใบที่ผู้จัดการเปิด (ไม่ต้องเหตุผลตอนยังไม่เริ่ม) · ผู้จัดการที่ถือ rev เก่าได้ gem_conflict · เห็นของออฟฟิศหลังโหลดใหม่
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน Z3', 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    g := pg_temp.ggt(sM, j);
    r := pg_temp.oset(a, j, jsonb_build_array(jsonb_build_object('gem_item_id', pg_temp.fx('iC1'), 'qty_per_piece', 5)));
    v := v || pg_temp.chk('Z3', 'ต้องไม่พัง: ออฟฟิศ (job_gem_bom_set) แก้พลอยของใบที่ผู้จัดการเปิด ได้โดยไม่ต้องเหตุผล (window free_before_start) · ผล: ' || coalesce(r ->> '_err', 'ok'),
      not (r ? '_err') and pg_temp.n_bom(j) = 1 and r ->> 'window' = 'free_before_start');
    r1 := pg_temp.gst(sM, j, pg_temp.back(g), g ->> 'rev');
    g := pg_temp.ggt(sM, j);
    v := v || pg_temp.chk('Z4', 'หลังออฟฟิศแก้: ผู้จัดการที่ถือ rev เก่า = gem_conflict (ไม่ทับงานออฟฟิศ) · โหลดใหม่เห็น 1 แถวของออฟฟิศ', r1 ->> 'code' = 'gem_conflict' and jsonb_array_length(g -> 'lines') = 1 and g #>> '{lines,0,label}' = 'CZ · กลม · 1.5 มม.');
    raise exception 'rb_191';
  exception when others then
    if sqlerrm <> 'rb_191' then v := v || pg_temp.chk('Z3-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;

-- ============================================================================
-- P. สิทธิ์ (18.1 · 18.5): anon/authenticated/PUBLIC ห้าม execute · service_role เฉพาะ RPC · ไม่มี overload · search_path pin
-- ============================================================================
create function pg_temp.g_191_perm() returns text
 language plpgsql as $c$
declare
  v text := ''; s text; st text := ''; x text; n int;
  rpc constant text[] := array['job_worker_open', 'job_worker_my_intake_list', 'job_worker_gem_catalog', 'job_worker_gem_get', 'job_worker_gem_set'];
  helper constant text[] := array['shop_intake_gem_auth', 'job_worker_gem_block', 'job_gem_rev', 'job_worker_gem_precheck', 'job_worker_gem_fail', 'job_worker_gem_summary', 'job_worker_gem_name_cap', 'job_worker_gem_item_cap'];
begin
  v := v || pg_temp.chk('P1', 'RPC ช่าง 5 ตัว: service_role execute ได้ · anon/authenticated ไม่ได้ · เป็น security definer · pin search_path',
    (select bool_and(has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and p.prosecdef
                     and exists (select 1 from unnest(p.proconfig) c2 where c2 like 'search_path=%'))
       from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = any (rpc)));
  v := v || pg_temp.chk('P2', 'helper 8 ตัว: ไม่มี role ฝั่งแอปถือ execute (service_role/anon/authenticated ไม่ได้) · pin search_path',
    (select bool_and(not has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
                     and exists (select 1 from unnest(p.proconfig) c2 where c2 like 'search_path=%'))
       from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = any (helper)));
  v := v || pg_temp.chk('P3', 'ไม่มีฟังก์ชันใดในสคีมา analytics ที่ PUBLIC (grantee 0) ถือ EXECUTE · ไม่มี overload ของ 13 ชื่อ (หนึ่งแถวต่อชื่อ)',
    not exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a2 where p.pronamespace = 'analytics'::regnamespace and a2.privilege_type = 'EXECUTE' and (a2.grantee = 0 or a2.grantee = 'anon'::regrole or a2.grantee = 'authenticated'::regrole))
    and (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and proname = any (rpc || helper)) = 13);
  begin
    execute 'grant usage on schema analytics to authenticated';
    execute 'grant usage on schema analytics to anon';
    foreach s in array array[
      'select analytics.job_worker_open(null, null, null)',
      'select analytics.job_worker_my_intake_list(null, null, null)',
      'select analytics.job_worker_gem_catalog(null, null, null, null)',
      'select analytics.job_worker_gem_get(null, null, null, null)',
      'select analytics.job_worker_gem_set(null, null, null, null, null, null, null)'] loop
      st := st || pg_temp.asrole('authenticated', s) || '/' || pg_temp.asrole('anon', s) || ',';
    end loop;
    v := v || pg_temp.chk('P4', 'จำลองวันที่กำแพงสคีมาหลุด (grant usage ให้ authenticated+anon ในทรานแซกชันทดสอบ) → ยิง RPC ทั้ง 5 (args null) = 42501 ทุกตัวทั้งสอง role · ได้: ' || st, st = repeat('42501/42501,', 5));
    st := '';
    foreach s in array array[
      'select analytics.shop_intake_gem_auth(null, null, null, null)',
      'select analytics.job_worker_gem_block(null)',
      'select analytics.job_gem_rev(null)',
      'select analytics.job_worker_gem_precheck(null, null, null, null)',
      'select analytics.job_worker_gem_fail(null, null)',
      'select analytics.job_worker_gem_summary(null)',
      'select analytics.job_worker_gem_name_cap()',
      'select analytics.job_worker_gem_item_cap()'] loop
      st := st || pg_temp.asrole('authenticated', s) || '/' || pg_temp.asrole('service_role', s) || ',';
    end loop;
    v := v || pg_temp.chk('P5', 'helper ทั้ง 8: authenticated และ service_role ยิงตรง = 42501 (ไม่มีทางเรียก helper ข้ามด่านของ RPC) · ได้: ' || st, st = repeat('42501/42501,', 8));
    raise exception 'rb_191P';
  exception when others then
    if sqlerrm <> 'rb_191P' then v := v || pg_temp.chk('P4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;

-- ============================================================================
-- M. mutant: ถอด/ย้อนด่านทีละตัวแล้วเทสต์ต้องล้มจริง (id ที่คาด) — ไม่ล้ม = เทสต์ไม่ได้ป้องกันด่านนั้น
-- ============================================================================
create function pg_temp.snap() returns text
 language plpgsql as $c$
declare v text := ''; t text; n text;
begin
  foreach t in array array['analytics.job', 'analytics.job_stage', 'analytics.job_event', 'analytics.job_token', 'analytics.worker', 'analytics.worker_session',
    'analytics.job_counter', 'analytics.production_order', 'analytics.production_order_item', 'analytics.production_order_counter', 'analytics.shop_intake_token',
    'analytics.gem_type', 'analytics.gem_shape', 'analytics.gem_item', 'analytics.job_gem_bom', 'analytics.product_gem_bom', 'analytics.gem_item_price', 'analytics.gem_item_price_audit', 'analytics.gem_catalog_event',
    'public.product', 'public.shop', 'public.shop_member'] loop
    if to_regclass(t) is not null then
      execute format('select count(*)::text || ''/'' || coalesce(md5(string_agg(x::text, ''|'' order by x::text)), '''') from %s x', t) into n;
      v := v || t || '=' || n || ';';
    end if;
  end loop;
  return md5(v);
end;
$c$;

create function pg_temp.g_191_all() returns text
 language plpgsql as $c$
begin
  return pg_temp.g_191_open() || pg_temp.g_191_set() || pg_temp.g_191_misc();
end;
$c$;

create function pg_temp.g_191_mut() returns text
 language plpgsql as $c$
declare
  v text := ''; s text; k int; muts jsonb; m jsonb; st jsonb; hit int; i text; killed int := 0; total int;
  sg_open constant text := 'analytics.job_worker_open(text,text,text,uuid,text,text,numeric,numeric,integer,integer,date,boolean,text,text,text,jsonb,text,jsonb)';
  sg_set constant text := 'analytics.job_worker_gem_set(text,text,uuid,jsonb,text,jsonb,text)';
  sg_get constant text := 'analytics.job_worker_gem_get(text,text,uuid,text)';
  sg_cat constant text := 'analytics.job_worker_gem_catalog(text,text,text,uuid)';
  sg_blk constant text := 'analytics.job_worker_gem_block(uuid)';
  sg_auth constant text := 'analytics.shop_intake_gem_auth(text,text,text,text)';
  sg_force constant text := 'analytics.job_worker_gem_precheck(uuid,uuid,jsonb,jsonb,uuid[])';
  sg_fail constant text := 'analytics.job_worker_gem_fail(text,text)';
  sg_my constant text := 'analytics.job_worker_my_intake_list(text,text,text)';
begin
  muts := jsonb_build_array(
    jsonb_build_object('id', 'MU1', 'what', 'block: ช่างรับขั้นแรกแล้วไม่ล็อก (ถอดทั้งเงื่อนไข in_progress และ window)', 'steps', jsonb_build_array(jsonb_build_array(sg_blk, 'if v_job.status = ''in_progress'' or analytics.job_gem_edit_window(v_job.id) is distinct from ''free_before_start'' then', 'if false then')), 'expect', jsonb_build_array('G4a')),
    jsonb_build_object('id', 'MU2', 'what', 'set: ไม่ผูกใบกับผู้เปิด (หาใบจาก id ตรงๆ → ใบช่างอื่น/ใบออฟฟิศแก้ได้)', 'steps', jsonb_build_array(jsonb_build_array(sg_set, 'v_job := analytics.job_worker_photo_job(v_shop, v_wid, null, p_job_id);', 'select j.id into v_job from analytics.job j where j.id = p_job_id and j.shop_id = v_shop and j.parent_job_id is null;')), 'expect', jsonb_build_array('G3a', 'G3b')),
    jsonb_build_object('id', 'MU3', 'what', 'set: ไม่ตรวจ CAS (rev) → เครื่องที่ถือ rev เก่าทับได้', 'steps', jsonb_build_array(jsonb_build_array(sg_set, 'if analytics.job_gem_rev(v_job) is distinct from p_expected_rev then', 'if false then')), 'expect', jsonb_build_array('G2')),
    jsonb_build_object('id', 'MU4', 'what', 'block: ไม่ตรวจว่าใบมีขั้นฝัง (ใบไม่มีขั้นฝังแก้พลอยได้)', 'steps', jsonb_build_array(jsonb_build_array(sg_blk, 'and gs.stage_code = ''gem_set'' and gs.status = ''pending'') then', 'and gs.stage_code = ''gem_set'' and gs.status = ''pending'') and false then')), 'expect', jsonb_build_array('G5a', 'G5b')),
    jsonb_build_object('id', 'MU5', 'what', 'force: ชื่อที่ไม่ถูกถามก็ผ่าน (ถอดการเช็คครอบคลุม — blanket)', 'steps', jsonb_build_array(jsonb_build_array(sg_force, 'if not v_covered then', 'if false then')), 'expect', jsonb_build_array('O9c', 'O9d', 'G7c', 'G7d')),
    jsonb_build_object('id', 'MU6', 'what', 'force: จับคู่ด้วย kind อย่างเดียว ไม่เทียบชื่อ (force ชื่ออื่นปลดคำถาม)', 'steps', jsonb_build_array(jsonb_build_array(sg_force, 'and analytics.gem_name_norm(f.value ->> ''name'') = analytics.gem_name_norm(v_el ->> ''name''));', ');')), 'expect', jsonb_build_array('O9c', 'G7c')),
    jsonb_build_object('id', 'MU7', 'what', 'open: ไม่ผ่านตัวดักชื่อคล้าย/force (ส่ง force=false เสมอ) → force ที่ถูกต้องก็ไม่ผ่าน', 'steps', jsonb_build_array(jsonb_build_array(sg_open, 'v_gforce := analytics.job_worker_gem_precheck(v_shop, v_wid, p_gem_lines, p_gem_force);', 'v_gforce := false;')), 'expect', jsonb_build_array('O9b')),
    jsonb_build_object('id', 'MU8', 'what', 'open: ตอบ none แล้วขั้นฝังยังอยู่', 'steps', jsonb_build_array(jsonb_build_array(sg_open, 'v_codes := array_remove(v_codes, ''gem_set'');', 'v_codes := v_codes;')), 'expect', jsonb_build_array('O3')),
    jsonb_build_object('id', 'MU9', 'what', 'open: ตอบ has แต่ไม่เพิ่มขั้นฝัง (ขั้นไม่เกิดจากพลอย) → ใบถอยทั้งก้อน (gem_stage_missing) — ด่านหลังกันใบมีพลอยแต่ไม่มีขั้น', 'steps', jsonb_build_array(jsonb_build_array(sg_open, 'v_codes := analytics.job_sort_stage_codes(v_shop, v_codes || ''gem_set''::text);', 'v_codes := v_codes;')), 'expect', jsonb_build_array('O1-crash')),
    jsonb_build_object('id', 'MU10', 'what', 'open: template + SKU ไม่มีแม่แบบก็ผ่าน (ไม่บังคับให้ตอบ)', 'steps', jsonb_build_array(jsonb_build_array(sg_open, 'if p_product_id is null or not exists (select 1 from analytics.product_gem_bom b where b.shop_id = v_shop and b.product_id = p_product_id) then', 'if false then')), 'expect', jsonb_build_array('O6')),
    jsonb_build_object('id', 'MU11', 'what', 'open: has แต่ 0 แถวก็ผ่าน', 'steps', jsonb_build_array(jsonb_build_array(sg_open, 'if p_gem_lines is null or jsonb_typeof(p_gem_lines) <> ''array'' or jsonb_array_length(p_gem_lines) = 0 then', 'if false then')), 'expect', jsonb_build_array('O7')),
    jsonb_build_object('id', 'MU12', 'what', 'auth: ไม่ตรวจ can_open_job (ผู้ถูกถอนสิทธิ์/ช่างทั่วไปแก้พลอยได้)', 'steps', jsonb_build_array(jsonb_build_array(sg_auth, 'if not v_w.can_open_job then', 'if false then')), 'expect', jsonb_build_array('G8e', 'G8d')),
    jsonb_build_object('id', 'MU13', 'what', 'auth: session หมดอายุแล้วยังใช้ได้', 'steps', jsonb_build_array(jsonb_build_array(sg_auth, 's.revoked_at is null and s.expires_at > now()', 's.revoked_at is null')), 'expect', jsonb_build_array('G8b')),
    jsonb_build_object('id', 'MU13b', 'what', 'auth: ช่างที่ถูกปิดใช้งาน (session ยังไม่ถูกเพิกถอน) ยังใช้ได้', 'steps', jsonb_build_array(jsonb_build_array(sg_auth, 'and w.is_active and w.shop_id = v_tok.shop_id', 'and w.shop_id = v_tok.shop_id')), 'expect', jsonb_build_array('G8c')),
    jsonb_build_object('id', 'MU13c', 'what', 'auth: session ข้ามร้านใช้ได้ (ไม่เทียบร้านของ token)', 'steps', jsonb_build_array(jsonb_build_array(sg_auth, 'and w.is_active and w.shop_id = v_tok.shop_id', 'and w.is_active')), 'expect', jsonb_build_array('G3e')),
    jsonb_build_object('id', 'MU14', 'what', 'auth: QR ร้านที่ถูกเพิกถอนยังใช้ได้', 'steps', jsonb_build_array(jsonb_build_array(sg_auth, 'if not found or v_tok.revoked_at is not null then', 'if not found then')), 'expect', jsonb_build_array('G8g')),
    jsonb_build_object('id', 'MU15', 'what', 'auth: ไม่มีถังจำกัดอัตราต่อช่าง', 'steps', jsonb_build_array(jsonb_build_array(sg_auth, 'if not analytics.job_rate_limit_hit(case p_bucket when ''write'' then ''wg:'' else ''wgr:'' end', 'if false and not analytics.job_rate_limit_hit(case p_bucket when ''write'' then ''wg:'' else ''wgr:'' end')), 'expect', jsonb_build_array('G8r2', 'G8r4')),
    jsonb_build_object('id', 'MU15b', 'what', 'auth: ไม่มีถังต่อ IP', 'steps', jsonb_build_array(jsonb_build_array(sg_auth, 'if not analytics.job_rate_limit_hit(case p_bucket when ''write'' then ''ipw:'' else ''ipr:'' end', 'if false and not analytics.job_rate_limit_hit(case p_bucket when ''write'' then ''ipw:'' else ''ipr:'' end')), 'expect', jsonb_build_array('G8r1')),
    jsonb_build_object('id', 'MU15c', 'what', 'auth: ถังต่อช่างนับก่อนตรวจ can_open (คนไม่มีสิทธิ์เผาถังของผู้จัดการได้)', 'steps', jsonb_build_array(
        jsonb_build_array(sg_auth, 'if not v_w.can_open_job then', 'if not analytics.job_rate_limit_hit(case p_bucket when ''write'' then ''wg:'' else ''wgr:'' end || v_w.id::text, 9999) or not v_w.can_open_job then')), 'expect', jsonb_build_array('G8h')),
    jsonb_build_object('id', 'MU16', 'what', 'get: ไม่ผูกใบกับผู้เปิด (อ่านใบช่างอื่น/ใบออฟฟิศได้)', 'steps', jsonb_build_array(jsonb_build_array(sg_get, 'v_job := analytics.job_worker_photo_job(v_shop, v_wid, null, p_job_id);', 'select j.id into v_job from analytics.job j where j.id = p_job_id and j.shop_id = v_shop and j.parent_job_id is null;')), 'expect', jsonb_build_array('G3a', 'G3b')),
    jsonb_build_object('id', 'MU17', 'what', 'fail: แถวผิดไม่ถูกแปลงเป็น gem_line_invalid (หลุดเป็นข้อผิดพลาดทั่วไป)', 'steps', jsonb_build_array(jsonb_build_array(sg_fail, 'v_code := coalesce(v_d ->> ''code'', case when p_hint in (''lines_invalid'', ''line_invalid'', ''too_many_lines'') then p_hint end);', 'v_code := null;')), 'expect', jsonb_build_array('O8q', 'G6q')),
    jsonb_build_object('id', 'MU18', 'what', 'my list: gem_editable เป็นจริงเสมอ', 'steps', jsonb_build_array(jsonb_build_array(sg_my, '''gem_editable'', analytics.job_worker_gem_block(j.id) is null) as o', '''gem_editable'', true) as o')), 'expect', jsonb_build_array('L1b', 'L1d')),
    jsonb_build_object('id', 'MU19', 'what', 'set: เรียก core โดยไม่ส่ง worker (ผู้ทำรายการหาย)', 'steps', jsonb_build_array(jsonb_build_array(sg_set, 'v_res := analytics.job_gem_bom_replace_core(v_job, p_lines, v_force, null, v_wid, null, ''shopfloor'', ''free_before_start'');', 'v_res := analytics.job_gem_bom_replace_core(v_job, p_lines, v_force, null, null, null, ''shopfloor'', ''free_before_start'');')), 'expect', jsonb_build_array('G1')),
    jsonb_build_object('id', 'MU20', 'what', 'catalog: คืนแม่แบบของ SKU ที่ปิดใช้/live* (ถอดเงื่อนไข active/live)', 'steps', jsonb_build_array(jsonb_build_array(sg_cat, 'if found and v_prod.is_active and v_prod.sku !~* ''^live'' then', 'if found then')), 'expect', jsonb_build_array('C1e')),
    jsonb_build_object('id', 'MU21', 'what', 'block: ไม่แยกใบ cancelled (ตกไปเป็น job_closed)', 'steps', jsonb_build_array(jsonb_build_array(sg_blk, 'if v_job.status = ''cancelled'' or v_po = ''cancelled'' then', 'if false then')), 'expect', jsonb_build_array('G4c')),
    jsonb_build_object('id', 'MU22', 'what', 'force: ไม่ตรวจรูปร่างรายการ force (boolean true เข้ามาได้)', 'steps', jsonb_build_array(jsonb_build_array(sg_force, 'if jsonb_typeof(v_f) <> ''array'' or jsonb_array_length(v_f) > 60 then', 'if false then')), 'expect', jsonb_build_array('O9e')),
    jsonb_build_object('id', 'MU23', 'what', 'set: ไม่เรียก block (ไม่ตรวจล็อก/ปิด/ไม่มีขั้นฝัง)', 'steps', jsonb_build_array(jsonb_build_array(sg_set, 'v_block := analytics.job_worker_gem_block(v_job);', 'v_block := null;')), 'expect', jsonb_build_array('G4a', 'G5a')),
    jsonb_build_object('id', 'MU24', 'what', 'open: ไม่ตรวจคำตอบ answer ที่ไม่รู้จัก', 'steps', jsonb_build_array(jsonb_build_array(sg_open, 'if p_gem_answer is not null and p_gem_answer not in (''none'', ''has'', ''template'') then', 'if false then')), 'expect', jsonb_build_array('O12')),
    jsonb_build_object('id', 'MU25', 'what', 'gem_get: ไม่ปิดด่านสิทธิ์ read (ใช้ bucket write ผิด) — ถอดถังอ่านต่อช่าง', 'steps', jsonb_build_array(jsonb_build_array(sg_auth, 'case p_bucket when ''write'' then 20 else 120 end', 'case p_bucket when ''write'' then 20 else 99999 end')), 'expect', jsonb_build_array('G8r4')),
    jsonb_build_object('id', 'MU26', 'what', 'force: ไม่มีเพดานชื่อพลอยใหม่ต่อวัน (ท่วมแคตตาล็อกด้วยชื่อขยะได้)', 'steps', jsonb_build_array(jsonb_build_array(sg_force, 'if v_exist + v_newn > analytics.job_worker_gem_name_cap() then', 'if false then')), 'expect', jsonb_build_array('O14b', 'O14d', 'G9b')),
    jsonb_build_object('id', 'MU27', 'what', 'precheck: เพดานนับ "ชนิด" ของคนอื่นด้วย (ไม่ผูกกับผู้จัดการคนที่สร้าง) → ผู้จัดการอีกคนโดนด้วย', 'steps', jsonb_build_array(jsonb_build_array(sg_force, 'where t.shop_id = p_shop_id and t.created_by_worker_id = p_worker_id and t.created_at', 'where t.shop_id = p_shop_id and t.created_at')), 'expect', jsonb_build_array('O14f')),
    jsonb_build_object('id', 'MU27b', 'what', 'precheck: เพดานนับ "รูปทรง" ของคนอื่นด้วย (subquery ของรูปทรงไม่ผูกผู้สร้าง)', 'steps', jsonb_build_array(jsonb_build_array(sg_force, 'where s.shop_id = p_shop_id and s.created_by_worker_id = p_worker_id and s.created_at', 'where s.shop_id = p_shop_id and s.created_at')), 'expect', jsonb_build_array('O14g')),
    jsonb_build_object('id', 'MU30', 'what', 'precheck: ไม่มีเพดานรายการพลอยใหม่ (ท่วมตาราง gem_item ด้วยขนาดขยะได้ — security M1)', 'steps', jsonb_build_array(jsonb_build_array(sg_force, 'if v_exist + v_newi > analytics.job_worker_gem_item_cap() then', 'if false then')), 'expect', jsonb_build_array('O16b', 'G10b')),
    jsonb_build_object('id', 'MU31', 'what', 'set: ไม่ส่งรายการที่ใบถืออยู่แล้วเข้า precheck (รายการที่ออฟฟิศปิดใช้ทีหลังทำให้ผู้จัดการแก้ใบไม่ได้ — security M2)', 'steps', jsonb_build_array(jsonb_build_array(sg_set, 'p_force, array(select g.gem_item_id from analytics.job_gem_bom g where g.job_id = v_job));', 'p_force, ''{}''::uuid[]);')), 'expect', jsonb_build_array('G11a')),
    jsonb_build_object('id', 'MU29', 'what', 'open: ไม่ตรวจว่าได้ขั้นฝังจริงหลังสร้าง (has/template ที่ขั้นถูกปิดใช้ → ใบมีพลอยแต่ไม่มีขั้นเงียบๆ)', 'steps', jsonb_build_array(jsonb_build_array(sg_open, 'if p_gem_answer in (''has'', ''template'') and not exists (select 1 from analytics.job_stage s where s.job_id = v_jobrow.id and s.stage_code = ''gem_set'') then', 'if false then')), 'expect', jsonb_build_array('O15a', 'O15b')),
    jsonb_build_object('id', 'MU28', 'what', 'fail: ไม่แปลง gem_name_cap (หลุดเป็นข้อผิดพลาดทั่วไป)', 'steps', jsonb_build_array(jsonb_build_array(sg_fail, 'if p_hint = ''gem_name_cap'' then', 'if false then')), 'expect', jsonb_build_array('O14b', 'G9b')));
  total := jsonb_array_length(muts);
  for k in 0 .. total - 1 loop
    m := muts -> k; s := '';
    begin
      for st in select value from jsonb_array_elements(m -> 'steps') loop
        perform pg_temp.mutate(st ->> 0, st ->> 1, st ->> 2);
      end loop;
      s := pg_temp.g_191_all();
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
      v := v || format('[FAIL] %s  mutant รอด (จับได้ %s/%s id ที่คาด): %s', m ->> 'id', hit, jsonb_array_length(m -> 'expect'), m ->> 'what') || E'\n';
    end if;
  end loop;
  v := v || pg_temp.chk('MX', format('mutant ถูกจับครบ %s/%s', killed, total), killed = total);
  return v;
end;
$c$;

-- ============================================================================
-- runner
-- ============================================================================
do $v191$
declare
  v_msg text := E'\n=== verify 0191 ===\n';
  v_snap0 text; v_hit int; v_fail int; v_ok int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  create temp table _v191_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h, p.proacl::text as acl
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p');
  v_snap0 := pg_temp.snap();
  begin
    v_msg := v_msg || pg_temp.g_setup();
    v_msg := v_msg || pg_temp.g_191_perm();
    v_msg := v_msg || pg_temp.g_191_open();
    v_msg := v_msg || pg_temp.g_191_set();
    v_msg := v_msg || pg_temp.g_191_misc();
    v_msg := v_msg || pg_temp.g_191_mut();
    select count(*) into v_hit from _v191_orig o join pg_proc p on p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p') and p.oid::regprocedure::text = o.sig
     where md5(pg_get_functiondef(p.oid)) = o.h and p.proacl::text is not distinct from o.acl;
    v_msg := v_msg || pg_temp.chk('MY', format('หลัง mutant: md5 นิยาม + สิทธิ์ของฟังก์ชันทุกตัวในสคีมา analytics (%s ตัว) เท่าเดิมเป๊ะ', (select count(*) from _v191_orig)),
      v_hit = (select count(*) from _v191_orig) and (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and prokind in ('f', 'p')) = (select count(*) from _v191_orig));
    raise exception 'V191_ROLLBACK';
  exception when others then
    if sqlerrm <> 'V191_ROLLBACK' then v_msg := v_msg || format('[FAIL] S1-crash  ชุดหลัก raise นอกกลุ่ม: %s %s', sqlstate, sqlerrm) || E'\n'; end if;
  end;
  v_msg := v_msg || pg_temp.chk('K0', 'ชุดทดสอบไม่ทิ้งรอย: snapshot (job/ใบผลิต/QR ร้าน/ช่าง/session/ตัวนับ/ชนิด/รูปทรง/รายการ/BOM/ราคา/product/shop) เท่าเดิมหลังถอยกลับ', pg_temp.snap() = v_snap0);
  v_fail := (length(v_msg) - length(replace(v_msg, '[FAIL]', ''))) / length('[FAIL]');
  v_ok := (length(v_msg) - length(replace(v_msg, '[OK]', ''))) / length('[OK]');
  v_msg := v_msg || format(E'\n--- สรุป: OK %s · FAIL %s ---', v_ok, v_fail);
  raise exception '%', v_msg;
end;
$v191$;

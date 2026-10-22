-- scripts/verify/verify-0190.sql
-- ตรวจ supabase/migrations/0190_gems_g1a.sql (G1a พลอย: แคตตาล็อก ชนิด·รูปทรง·ขนาด + ราคา (แยกตาราง ออฟฟิศเท่านั้น) + BOM ต่อใบ + แม่แบบ SKU + ข้อมูลพลอยหน้าช่าง/A5)
-- self-rolling-back (3j-migration-traps ข้อ 11): ทุกเคสอยู่ในทรานแซกชันเดียว จบด้วย `raise exception` เสมอ ⇒ ถอยทั้งก้อน · อ่านผลจาก error message · exit 1 คือผลที่คาด · [FAIL] >= 1 = ไม่ผ่าน
-- ต้องมี 0172-0189 อยู่ใน DB แล้ว · dry-run: ต่อ 0190 + ไฟล์นี้ (ไฟล์ LF — ข้อ 20) เป็นไฟล์เดียวแล้วรันไม่ใส่ --commit · หลัง apply: รันไฟล์นี้เดี่ยวๆ ได้
-- ข้อมูลทดสอบ: ร้านสังเคราะห์ ZZ TEST verify-0190 A/B (insert public.shop + public.shop_member ตรง ตามแพทเทิร์น verify-0188/0189 — ข้อยกเว้นเดียวที่ไม่ผ่าน RPC · ยืม auth user จริงของร้านเป็นสมาชิกร้านสังเคราะห์ในทรานแซกชันนี้เท่านั้น) ·
--   SKU/ช่าง/ใบผลิต/ใบงาน/ชนิด/รายการ/ราคา/แม่แบบ สร้างผ่าน RPC ของระบบทั้งหมด · ส่วน golden ใช้ร้านจริง (อ่าน product จริง + สร้างใบผลิตชั่วคราวผ่าน RPC แล้วถอยกลับ — ตรวจตัวนับหลังรันซ้ำใน K0)
-- 🔴 ไม่แตะตัวนับเอกสารภาษี · production_order_done ต้อง md5 เดิม (G3) · ราคาทดสอบใช้เลขแปลกที่ไม่ซ้ำกับค่าอื่นเพื่อ grep หาการรั่ว (7391.2468)
--
-- ============ ตารางแมป "ข้อในบรีฟ → เทสต์ที่ครอบ" (ข้อไหนไม่มีเทสต์ครอบ = เขียนว่า "ไม่มี" พร้อมเหตุผล) ============
--  เคสห้ามผ่าน (หลัก)
--   ราคาหลุด (resolve หลัง/ก่อน PIN · รายการ dropdown · BOM · แม่แบบ · plan/stage suggest · create ใบ · วิว · event · audit — ราคาเลขแปลก 7391.2468/9999.9999 ต้องไม่ปรากฏ · ไม่มี key ราคา)
--        -> P5 (สแกนทุกราคา ≥ 1,000 ที่ตั้งไว้ ใน 18 พื้นผิว) P5b (key) P5c (ราคายังอยู่ทาง RPC ราคา = เทสต์รั่วมีความหมาย) · P6 P6a P6b (สิทธิ์ตาราง · service_role/anon/authenticated อ่านตรงไม่ได้ · view ไม่มีคอลัมน์ราคา) · R1 (key ของ gems ล็อก 4 ตัว) · mutant MU10
--        ❌ ไม่มีเทสต์ SQL: หน้าพิมพ์ A5 (PrintableJob) และ HTML/RSC ของ /w/<token> จริง — TS: lib/jobs/print.test.ts · worker-view.test.ts (ล็อก key + ไม่มีราคา) · ไม่ได้ยิงหน้าเว็บจริงใน SQL
--   qty 0 / 1.5 / 1001 / ข้อความ / NaN / ว่าง / ติดลบ                 -> C6-q1..q8 · mutant MU5
--   size ≤ 0 / > 100 / ทศนิยม 3 / 'NaN' / 'Infinity' / '1e2'            -> C6-s1..s6 s10 s11 · mutant MU6 · (ราคา NaN/Infinity/ทศนิยม 5 -> P2 · mutant MU17)
--   size_b ผิดกับ has_length (ไม่ควรมี / ขาด / 0)                         -> C4a C4b · C6-s7 s8 s9 · กำแพงที่ตาราง: C9a · mutant MU18
--   type/shape/item ร้านอื่น · ไม่พบ · ปิดใช้ (merged = resolve ไปปลายทาง — ตัดสินเอง)  -> C6-t1 t2 t3 t6 t7 i1 i2 i3 · C8a C8b · M4a M4b M4c (merged resolve ไม่ล้ม)
--   > 30 แถว                                                             -> C6l1 (31 แถวปฏิเสธ) · C6l2 (30 แถวผ่าน — ต้องไม่พัง)
--   ชื่อ < 2 ตัว / ตัวเลขล้วน / ล่องหน / < > / ยาว > 40 / ไม่ใช่ข้อความ    -> C6-n1..n12 ns2 · N16a-x (gem_name_ok ตรงๆ) · C9c (CHECK ที่ตาราง) · mutant MU13
--   norm เท่ากันเป๊ะ + force = ไม่สร้างแถวซ้ำ                              -> C2 C2b (เส้นทางบันทึกใบ: ใช้ตัวเดิมเงียบๆ) · C3c C7a C7c (สร้าง/เปลี่ยนชื่อตรงๆ: name_exists แม้ force) · C4d (รูปทรง) · mutant MU3
--   ตัวดักคล้าย (server ตัดสิน · ไม่ส่ง force = คืน similar[] ไม่เขียนอะไร)   -> N1-N14c (ชุดเคสเตือน/ไม่เตือน UX §3.4) · C3a C3b C4c C7d T5b T5c · mutant MU1 MU2
--   merge ทำให้ gem_label ของใบเปลี่ยน                                    -> M2d (md5 job_gem_bom ทุกแถวเท่าเดิม · ใบเปิด+ใบยกเลิก) · R4 J7d (เปลี่ยนชื่อ → ฉลากหน้าช่าง/ใบเดิมไม่เปลี่ยน) · mutant MU8 · J6 (ใบ done จริง — แก้ไม่ได้)
--   merge ลงตัวเอง / ตัวที่ถูกรวม / จากตัวที่ถูกรวม / ปลายทางปิดใช้ / ร้านอื่น / kind ผิด / แม่แบบเกิน 1,000 -> M3a M3z M3h · mutant MU9
--   ราคา A ไม่ย้ายตอนรวม · แม่แบบ SKU ตามไป                              -> M2c M2t · mutant MU16
--   has_length แก้ไม่ได้เมื่อถูกใช้                                        -> M6a (RPC + UPDATE ตรง) M6b (ยังไม่ถูกใช้แก้ได้ — ต้องไม่พัง)
--   แก้พลอยหลังขั้นฝังรับต้องมีเหตุผล (whitelist) · ใบ done/cancelled ล็อก  -> J3a J3b J3c J3e J4a-J4e J6 · mutant MU7 MU11
--   สิทธิ์ราคา/แคตตาล็อก (staff · ไม่ใช่สมาชิก · ร้านอื่น · actor ว่าง)       -> P3 P3b P3c · mutant MU4
--   anon/authenticated · overload · search_path · ทั้งสคีมา                -> S1 S2 (18.5) S3 S4 S5 S5b S6 S7
--  ต้องไม่พัง
--   ใบงานเดิม (ไม่มี BOM) stage list เดิม — golden ทุก SKU จริง (276 SKU ร้านจริง)  -> G1 (+ ใน migration: job_source_info ทุก item จริง 74 รายการเท่าเดิม · post-check 4) · T3 T6b · mutant MU12 MU14
--   production_order_done md5 เท่าเดิม                                     -> G3 (+ post-check (1) ของ migration: ฟังก์ชันเดิมทุกตัวนอกรายการ 344 ตัว md5 เท่าเดิม)
--   verify-0187/0188/0189 ผ่าน                                             -> รันแยกต่อ 0190 (ดูสรุปส่งมอบ) — ไม่รวมในไฟล์นี้
--   W1 job_worker_open ทำงานเดิม (ยังไม่รับ gem)                           -> W1a W1c W1d (SKU ไม่มีแม่แบบ/ไม่มี SKU = เดิมเป๊ะ) · W1b (SKU มีแม่แบบ = ได้ขั้นฝัง+BOM — พฤติกรรมใหม่ที่ตั้งใจ) · mutant MU14
--   A5 ใบไม่มีพลอย = เดิมเป๊ะ                                              -> R2 (resolve ไม่มี key gems/gems_state เมื่อไม่มีขั้นฝังและไม่มี BOM · key ของ job เท่าเดิม) · R3 (ก่อน PIN ไม่มี gems) · ❌ DOM ของ A5 = TS (print.test.ts)
--   ชื่อใหม่เข้าแคตตาล็อกในทรานแซกชันเดียวกับใบ (ล้ม = ไม่เกิดทั้งใบ+ชื่อ+ตัวนับ)  -> C1 T5 T5b T5d Q1 (job_create_from_quote_item ใบเสนอราคา OEM จริง ถอยกลับ)
--   BOM ต่อใบ/แม่แบบ/ขั้นฝัง                                                -> T1-T7c · J1w-J7e · M0-M8
--  รอบแก้ตาม security/QA 22 ต.ค. (0190 ยังไม่ apply — แก้ในไฟล์เดิม)
--   audit ราคา (old/new · append-only · note บังคับเมื่อแก้ทับ/ย้อนหลัง · history คืน audit)       -> P7a P7b P7c P7d P7e · mutant MU19 MU20
--   รวมชื่อไม่ล้มเมื่ออีกฝั่งของรายการถูกปิดใช้ (QA N1/N2) · INSERT ตรงยังตรวจทั้งสองฝั่ง          -> M9a M9b M9c · mutant MU21
--   แก้ใบหลังรวมชื่อ แถวเดิมคงฉลาก snapshot (QA M5) · ส่ง canonical แทน id เดิม = ไม่เปลี่ยน           -> M5e M5f · mutant MU22
--   แถวที่ "พิมพ์ชื่อ" (ไม่ส่ง gem_item_id) ไม่จับคู่ข้ามการรวมชื่อ → ฉลากใหม่ตามชื่อปัจจุบัน (ครอบโดย verify-0190-qa.sql M3 ร่วมกับ M5e/M5f ที่นี่ — ไม่มี mutant แยก)
--   วิวอ่านด้วย service_role ได้ (security M2)                                                     -> V1
--   เลขล้วนทุกระบบเลข ("๑๒" · "١٢" · "１２" · "²³") ตก (QA NC1) · seed บาแก็ตต์                       -> N16y1-y8 · C0b · mutant MU13 MU13b
--   ❌ ไม่มีเทสต์ใน verify นี้: idempotent (รัน 0190 ซ้ำได้) — ทำเป็นขั้นตอน dry-run: ต่อไฟล์ 0190 สองรอบ (รอบสองเปลี่ยนชื่อ temp table _m190_ → _m190b_) ผ่านแล้ว · gem_merge_blocked (ไม่มีทางเข้าในสถานะปกติหลังแก้ trigger — กันไว้เป็นข้อความชัดเท่านั้น)
--  รอบแก้ตาม review 22 ต.ค. (Blocker 1 + S1-S6)
--   B1 replace_core: ส่ง [แถวใหม่นำหน้า, แถวเดิมด้วย gem_item_id] → แถวเดิมคง id/ฉลาก/source/created_at                    -> M5g M5h · mutant MU23
--   S1 TS norm ตัดเฉพาะ \p{P} ตรง DB (DB เก็บสัญลักษณ์ $ + < = > ^ ` | ~ ใน norm)                                    -> N15b (+ shop-gems.qa.test.ts กวาดทุกจุดรหัส U+0001-1FFFF เทียบ DB จริง)
--   S2 รวมตำแหน่งทีละคำ (ไม่ใช่ substring) ทั้ง gem_lines_prepare และ gem_merge (แม่แบบ SKU)                           -> S2a S2b S2b2 S2c · mutant MU24 MU25
--   S3 นิยาม "ยังไม่ระบุพลอย" ที่เดียว analytics.job_gem_state (get · resolve · getJobDetail/ใบพิมพ์)                  -> S3a-S3e (+ R2b เดิม) · mutant MU26 MU27 MU28
--   S4 gem_similar_hits ตัวเดียว (prepare · catalog_create · catalog_rename)                                         -> C3a C4c (prepare) · ชุด N เดิม · ที่เหลือครอบโดยชุดเก่าของ create/rename
--   L2 gem_name_ok = ต้องมี [[:alpha:]] อย่างน้อย 1 ตัว (แทนรายการระบบเลข) · สระ/วรรณยุกต์ลอยๆ/"+1"/"$$" ตก          -> N16y9-N16y13 · mutant MU13 MU13b
--   audit CHECK ที่ตาราง: insert ย้อนหลังต้องมี note                                                                 -> P7f
--   N1 ถอด p_require_qty · N2 ถอด v_i                                                                              -> (ไม่มีเทสต์แยก — ชุดเดิมทั้งหมดยังผ่าน)
-- ไม่มีเทสต์ครอบ (บอกตรงๆ):
--   · การแข่งกันจริงของ 2 connection (2 คนพิมพ์ชื่อเดียวกันพร้อมกัน → ได้ตัวเดียว · merge กับสร้างใบพร้อมกัน) — do-block เป็น connection เดียว · พิสูจน์ได้เฉพาะโครงสร้าง: unique index uq_gem_type_norm + ON CONFLICT DO NOTHING + re-select อยู่ในนิยาม (C9c ยิง unique ตรงต้องชน) และ guard ล็อก FOR SHARE ชนิด/รูปทรง (trigger) vs gem_merge ล็อก FOR UPDATE · ต้องลอง UAT 2 มือถือ
--   · ส่วนย่อย (lot child) ห้ามมี BOM — trigger job_gem_bom_guard + RPC (lot_no_gems) มีในโค้ด แต่ไม่มี fixture แบ่งล็อตในชุดนี้ (ต้องมีใบที่ช่างส่งต่อบางส่วน)
--   · เวลาไทย 00:00-07:00: effective_from ที่เว้นว่างใช้ analytics.job_today() (แปลงเวลาไทยเหมือน J1) — ไม่ได้จำลองนาฬิกา
--   · หน้าพิมพ์/หน้าช่างจริง (HTML · RSC payload) — SQL ตรวจได้เฉพาะผลของ RPC (R1 P5) · ไม่ได้ยิงเว็บ
--   · ผู้ใช้ owner/admin จริงของระบบ (ยืมเป็นสมาชิกร้านสังเคราะห์ในทรานแซกชัน) — ไม่ได้ทดสอบ JWT ของผู้ใช้จริง (RPC นี้ตรวจ p_actor ที่ DB เพราะ service_role ผ่าน crm_require_owner_admin เสมอ)

set local statement_timeout = '30min';

create temp table _v190_fx (k text primary key, id uuid not null) on commit drop;
create temp table _v190_kv (k text primary key, v text not null) on commit drop;

create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text
 language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n'
$c$;
create function pg_temp.skip(p_id text, p_desc text) returns text language sql as $c$ select format('[SKIP] %s  %s', p_id, p_desc) || E'\n' $c$;
create function pg_temp.fx(p_k text) returns uuid language sql as $c$ select id from _v190_fx where k = p_k $c$;
create function pg_temp.setfx(p_k text, p_id uuid) returns void language sql as $c$
  insert into _v190_fx (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id $c$;
create function pg_temp.kv(p_k text) returns text language sql as $c$ select v from _v190_kv where k = p_k $c$;
create function pg_temp.setkv(p_k text, p_v text) returns void language sql as $c$
  insert into _v190_kv (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $c$;
-- ผู้ทำรายการ: owner (สมาชิก owner ของร้าน A) · ผู้ใช้ที่ไม่ใช่สมาชิก · admin · staff (สมาชิกระดับ staff ของร้าน A)
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
-- detail ของแถวพลอย {row, field, code}
create function pg_temp.dtl(r jsonb) returns jsonb language plpgsql as $c$
begin
  return (r ->> '_detail')::jsonb;
exception when others then
  return null;
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
-- key ทุกระดับของ jsonb (ตรวจว่าผลฝั่งช่าง/ฟอร์มไม่มี key เงิน/ต้นทุน)
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
-- ตัวเลขราคาทดสอบ (เลขแปลก — ต้องไม่โผล่ที่ไหนนอกทาง RPC ราคา)
create function pg_temp.px() returns text language sql as $c$ select '7391.2468' $c$;
create function pg_temp.std() returns text language sql as $c$ select '{wax_inject,wax_tree,invest_burnout,cast,cut_sprue,finish,buff,qc,pack}' $c$;
create function pg_temp.stdg() returns text language sql as $c$ select '{wax_inject,wax_tree,invest_burnout,cast,cut_sprue,finish,buff,gem_set,qc,pack}' $c$;

-- ============================================================================
-- helper ตัวช่วย
-- ============================================================================
-- ภาพรวมตารางพลอยของร้าน (ใช้เทียบว่า "ไม่มีอะไรเกิด" หลังคำขอที่ถูกปฏิเสธ) — ไม่รวมราคา
create function pg_temp.gsnap(p_shop uuid) returns text
 language sql as $c$
  select md5(coalesce((select string_agg(t::text, '|' order by t.id) from analytics.gem_type t where t.shop_id = p_shop), '')
          || '#' || coalesce((select string_agg(s::text, '|' order by s.id) from analytics.gem_shape s where s.shop_id = p_shop), '')
          || '#' || coalesce((select string_agg(i::text, '|' order by i.id) from analytics.gem_item i where i.shop_id = p_shop), '')
          || '#' || coalesce((select string_agg(b::text, '|' order by b.id) from analytics.job_gem_bom b where b.shop_id = p_shop), '')
          || '#' || coalesce((select string_agg(b::text, '|' order by b.id) from analytics.product_gem_bom b where b.shop_id = p_shop), '')
          || '#' || coalesce((select string_agg(e::text, '|' order by e.id) from analytics.job_event e where e.shop_id = p_shop and e.event_type = 'bom_change'), '')) $c$;
create function pg_temp.n_type(p_shop uuid) returns int language sql as $c$ select count(*)::int from analytics.gem_type where shop_id = p_shop $c$;
create function pg_temp.n_shape(p_shop uuid) returns int language sql as $c$ select count(*)::int from analytics.gem_shape where shop_id = p_shop $c$;
create function pg_temp.n_item(p_shop uuid) returns int language sql as $c$ select count(*)::int from analytics.gem_item where shop_id = p_shop $c$;
create function pg_temp.n_bom(p_job uuid) returns int language sql as $c$ select count(*)::int from analytics.job_gem_bom where job_id = p_job $c$;
create function pg_temp.n_ev(p_job uuid) returns int language sql as $c$ select count(*)::int from analytics.job_event where job_id = p_job and event_type = 'bom_change' $c$;
create function pg_temp.shp(p_shop uuid, p_name text) returns uuid language sql as $c$ select id from analytics.gem_shape where shop_id = p_shop and name = p_name $c$;
create function pg_temp.typ(p_shop uuid, p_name text) returns uuid language sql as $c$ select id from analytics.gem_type where shop_id = p_shop and name = p_name $c$;
-- ข้อความที่ผู้ใช้เห็นต้องไม่มีเลขราคา
-- แม่แบบของ SKU เป็นแถวรูปแบบ gem_item_id (ส่งกลับเข้า product_gem_bom_set ได้ตรงๆ)
create function pg_temp.tpl_lines(p_shop uuid, p_product uuid) returns jsonb language sql as $c$
  select coalesce(jsonb_agg(jsonb_build_object('gem_item_id', b.gem_item_id, 'qty_per_piece', b.qty_per_piece, 'position', b.position_note) order by b.line_seq), '[]'::jsonb)
    from analytics.product_gem_bom b where b.product_id = p_product and b.shop_id = p_shop $c$;
-- สแกนทุกราคา ≥ 1,000 ที่ตั้งไว้ในตารางราคา (7391.2468 · 9999.9999 · ... — เลขแปลกที่ไม่ซ้ำกับค่าอื่น) ว่าโผล่ในผลลัพธ์ไหม (ไม่ใช่แค่ราคาปัจจุบัน — กันรั่วราคาอื่นของรายการเดียวกัน เช่น max/ล่าสุด)
create function pg_temp.has_px(j jsonb) returns boolean language sql as $c$
  select exists (select 1 from analytics.gem_item_price p where p.price_thb_per_unit >= 1000 and position(trim_scale(p.price_thb_per_unit)::text in coalesce(j::text, '')) > 0)
      or exists (select 1 from analytics.gem_item_price_audit a where a.new_price >= 1000 and position(trim_scale(a.new_price)::text in coalesce(j::text, '')) > 0) $c$;

-- เรียก RPC (named args) — p คือ jsonb ของพารามิเตอร์
create function pg_temp.bset(p_shop uuid, p_job uuid, p_lines jsonb, p_actor uuid default null, p_reason text default null, p_force boolean default false) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_gem_bom_set(p_shop_id=>%L, p_job_id=>%L, p_gem_lines=>%L::jsonb, p_actor=>%L, p_reason=>%L, p_force=>%L)', p_shop, p_job, p_lines, coalesce(p_actor, pg_temp.nom()), p_reason, p_force)) $c$;
create function pg_temp.tset(p_shop uuid, p_product uuid, p_lines jsonb, p_actor uuid default null, p_force boolean default false) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.product_gem_bom_set(p_shop_id=>%L, p_product_id=>%L, p_gem_lines=>%L::jsonb, p_actor=>%L, p_force=>%L)', p_shop, p_product, p_lines, coalesce(p_actor, pg_temp.own()), p_force)) $c$;
create function pg_temp.icreate(p_shop uuid, p_line jsonb, p_force boolean default false, p_actor uuid default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.gem_item_create(%L, %L, %L::jsonb, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_line, p_force)) $c$;
create function pg_temp.price(p_shop uuid, p_item uuid, p_price text, p_eff text default null, p_actor uuid default null, p_sup text default null, p_note text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.gem_price_set(%L, %L, %L, %L::numeric, %L::date, %L, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_item, p_price, p_eff, p_sup, p_note)) $c$;
create function pg_temp.clist(p_shop uuid, p_actor uuid default null, p_all boolean default false) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_catalog_list(%L, %L, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_all)) $c$;
create function pg_temp.olist(p_shop uuid) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_options_list(%L)', p_shop)) $c$;
create function pg_temp.mprev(p_shop uuid, p_kind text, p_from uuid, p_into uuid, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_merge_preview(%L, %L, %L, %L, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_kind, p_from, p_into)) $c$;
create function pg_temp.mrg(p_shop uuid, p_kind text, p_from uuid, p_into uuid, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_merge(%L, %L, %L, %L, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_kind, p_from, p_into)) $c$;
create function pg_temp.ccreate(p_shop uuid, p_kind text, p_name text, p_hl boolean default null, p_force boolean default false, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_catalog_create(%L, %L, %L, %L, %L, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_kind, p_name, p_hl, p_force)) $c$;
create function pg_temp.ren(p_shop uuid, p_kind text, p_id uuid, p_name text, p_force boolean default false, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_catalog_rename(%L, %L, %L, %L, %L, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_kind, p_id, p_name, p_force)) $c$;
create function pg_temp.sact(p_shop uuid, p_kind text, p_id uuid, p_active boolean, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_catalog_set_active(%L, %L, %L, %L, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_kind, p_id, p_active)) $c$;
create function pg_temp.rmv(p_shop uuid, p_kind text, p_id uuid, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_catalog_remove(%L, %L, %L, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_kind, p_id)) $c$;
create function pg_temp.hl(p_shop uuid, p_id uuid, p_hl boolean, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_shape_set_has_length(%L, %L, %L, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_id, p_hl)) $c$;

-- ใบผลิต + รายการ + ใบงาน (ผ่าน RPC ออฟฟิศเดิม · p_codes = text[] literal) · คืน {po, item, job, job_no, res}
create function pg_temp.po(p_shop uuid, p_note text default 'verify0190') returns uuid
 language sql as $c$ select (analytics.production_order_save(p_shop, null, p_note, null) ->> 'id')::uuid $c$;
create function pg_temp.iset(p_shop uuid, p_order uuid, p_product uuid, p_qty int, p_label text default null, p_metal text default null, p_purity numeric default null, p_weight numeric default null, p_wsrc text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>%L, p_pending_product_label=>%L, p_metal=>%L, p_purity=>%L, p_weight_g=>%L, p_weight_source=>%L)',
    p_shop, p_order, p_product, p_qty, p_label, p_metal, p_purity, p_weight, p_wsrc)) $c$;
-- p_gem: null = ไม่ส่งอาร์กิวเมนต์ (ค่าเริ่ม = คัดลอกแม่แบบถ้ามีขั้นฝัง) · jsonb ใดๆ = ส่งไป ('[]' = ไม่มีพลอย)
create function pg_temp.mkjob(p_shop uuid, p_product uuid, p_codes text default null, p_gem jsonb default null, p_force boolean default false, p_qty int default 3) returns jsonb
 language plpgsql as $c$
declare o uuid; r jsonb; j jsonb;
begin
  o := pg_temp.po(p_shop, 'v190');
  r := pg_temp.iset(p_shop, o, p_product, p_qty);
  if r ? '_err' then return jsonb_build_object('err', r ->> '_err', 'stage', 'item'); end if;
  j := pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L%s)',
    p_shop, r ->> 'id', coalesce(p_codes, pg_temp.std()), pg_temp.nom(),
    case when p_gem is null then '' else format(', p_gem_lines=>%L::jsonb, p_gem_force=>%L', p_gem, p_force) end));
  return jsonb_build_object('po', o, 'item', r ->> 'id', 'job', j ->> 'job_id', 'job_no', j ->> 'job_no', 'res', j, 'err', j ->> '_err', 'hint', j ->> '_hint', 'state', j ->> '_state', 'detail', j ->> '_detail');
end;
$c$;
-- ช่างรับ/ส่งขั้นถัดไปของใบ (ผ่าน RPC ออฟฟิศเดิม) · p_send = true ส่งต่อด้วย · คืน stage_code ที่ทำ
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
  -- ส่งทุกขั้นก่อนหน้า p_code ให้เสร็จ แล้วหยุดก่อนขั้น p_code (ไม่รับ)
  loop
    select s.stage_code into cd from analytics.job_stage s where s.job_id = p_job and s.status = 'pending' order by s.seq limit 1;
    exit when cd is null or cd = p_code;
    perform pg_temp.step(p_shop, p_job, true);
    n := n + 1;
    if n > 20 then raise exception 'walk_to วนเกิน'; end if;
  end loop;
end;
$c$;
create function pg_temp.w_res(p_tokh text, p_sesh text default null, p_ip text default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.job_worker_resolve(%L, %L, %L)', p_tokh, p_sesh, p_ip)) $c$;
create function pg_temp.login(p_tokh text, p_worker uuid, p_pin text) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  r := pg_temp.q(format('select analytics.worker_pin_verify(%L, %L, %L, %L, %L)', p_tokh, p_worker, p_pin, 'verify-ua/1.0', null));
  if (r ->> 'ok') = 'true' then
    r := r || jsonb_build_object('session_hash', analytics.job_sha256_hex(r ->> 'session_token'));
  end if;
  return r;
end;
$c$;
create function pg_temp.wu(p_shop uuid, p_name text, p_pin text, p_codes text default '{qc}', p_open boolean default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_id=>null, p_display_name=>%L, p_stage_codes=>%L::text[], p_pin=>%L, p_actor=>%L, p_can_open_job=>%L, p_can_external=>null)',
    p_shop, p_name, p_codes, p_pin, pg_temp.nom(), p_open)) $c$;

-- ============================================================================
-- A. setup (ร้านสังเคราะห์ ZZ190 A/B — insert public.shop + shop_member ตรง: ข้อยกเว้นที่ไม่ผ่าน RPC · บอกตรงๆ) · ที่เหลือผ่าน RPC ของระบบ
-- ============================================================================
create function pg_temp.g_setup() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  u1 uuid; u2 uuid; u3 uuid;
  p uuid; r jsonb; j jsonb; w uuid;
begin
  insert into public.shop (id, name) values (a, 'ZZ TEST verify-0190 A'), (b, 'ZZ TEST verify-0190 B');
  perform pg_temp.setfx('A', a); perform pg_temp.setfx('B', b);
  -- ยืม auth user จริง (FK shop_member.user_id → auth.users): owner 2 คน (ต่างกัน) + admin 1 คน — เป็นสมาชิกร้านสังเคราะห์ในทรานแซกชันนี้เท่านั้น
  select m.user_id into u1 from public.shop_member m where m.role = 'owner' order by m.user_id limit 1;
  select m.user_id into u2 from public.shop_member m where m.role = 'owner' order by m.user_id desc limit 1;
  select m.user_id into u3 from public.shop_member m where m.role = 'admin' order by m.user_id limit 1;
  if u1 is null or u2 is null or u3 is null or u1 = u2 then
    raise exception 'setup: ต้องมี owner 2 คน (ต่างกัน) + admin 1 คน ใน shop_member จริงเพื่อยืมเป็นผู้ทำรายการ';
  end if;
  insert into public.shop_member (shop_id, user_id, role) values (a, u1, 'owner'), (a, u3, 'admin'), (a, u2, 'staff'), (b, u2, 'owner');
  perform pg_temp.setfx('u_owner', u1); perform pg_temp.setfx('u_admin', u3); perform pg_temp.setfx('u_staff', u2);
  perform analytics.gem_shape_ensure(a);  -- เหมือนจอเปิดรายการพลอย (gem_options_list) ครั้งแรก = seed รูปทรง 12
  perform analytics.job_stage_def_ensure(a); perform analytics.job_record_profile_ensure(a);
  perform analytics.job_stage_def_ensure(b); perform analytics.job_record_profile_ensure(b);
  -- SKU ร้าน A (แม่แบบพลอยกับ SKU ที่ไม่มีแม่แบบ) · ร้าน B
  p := analytics.product_upsert(a, 'ZZ190-A1', 'แหวนทดสอบ A1', null, 'fixed', 88, null, null, null, 150, null, null, null, true); perform pg_temp.setfx('pA1', p);
  p := analytics.product_upsert(a, 'ZZ190-A2', 'แหวนทดสอบ A2', null, 'fixed', 50, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pA2', p);
  p := analytics.product_upsert(a, 'ZZ190-A3', 'แหวนไม่มีแม่แบบ A3', null, 'fixed', 55, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pA3', p);
  p := analytics.product_upsert(a, 'ZZ190-A4', 'แหวนทดสอบ A4', null, 'fixed', 60, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pA4', p);
  p := analytics.product_upsert(a, 'ZZ190-W0', 'แหวนหน้างาน W0 (ไม่มีแม่แบบ)', null, 'fixed', 40, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pW0', p);
  p := analytics.product_upsert(a, 'ZZ190-W1', 'แหวนหน้างาน W1 (มีแม่แบบ)', null, 'fixed', 40, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pW1', p);
  p := analytics.product_upsert(b, 'ZZ190-B1', 'SKU ร้าน B', null, 'fixed', 70, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pB1', p);
  -- ของฝั่งร้าน B (ชนิด/รายการ) — ใช้ทดสอบ "ร้านอื่น"
  r := pg_temp.ccreate(b, 'type', 'ทับทิมบี', null, false, u2);
  if r ? '_err' then raise exception 'setup: สร้างชนิดร้าน B ไม่ได้ %', r::text; end if;
  perform pg_temp.setfx('tB', (r ->> 'id')::uuid);
  perform pg_temp.setfx('sB', pg_temp.shp(b, 'กลม'));
  r := pg_temp.icreate(b, jsonb_build_object('type_id', pg_temp.fx('tB'), 'shape_id', pg_temp.fx('sB'), 'size_a', 3), false, u2);
  if r ? '_err' then raise exception 'setup: สร้างรายการร้าน B ไม่ได้ %', r::text; end if;
  perform pg_temp.setfx('iB', (r -> 'item' ->> 'gem_item_id')::uuid);
  -- ใบงานตั้งต้น J1 (มีขั้นฝัง ไม่มีพลอย) + QR ใบงาน + ช่างฝัง (ใช้ทดสอบ resolve หน้าช่าง)
  j := pg_temp.mkjob(a, pg_temp.fx('pA1'), pg_temp.stdg());
  if j ->> 'job' is null then raise exception 'setup: สร้างใบงานตั้งต้นไม่ได้ %', j::text; end if;
  perform pg_temp.setfx('J1', (j ->> 'job')::uuid); perform pg_temp.setkv('J1_no', j ->> 'job_no');
  r := analytics.job_token_issue(a, pg_temp.fx('J1'), null, pg_temp.nom());
  perform pg_temp.setkv('tokh_J1', analytics.job_sha256_hex(r ->> 'token'));
  r := pg_temp.wu(a, 'ZZ-W ช่างฝัง', '2468', '{gem_set,qc}', null);
  perform pg_temp.setfx('wW', (r ->> 'id')::uuid);
  r := pg_temp.login(pg_temp.kv('tokh_J1'), pg_temp.fx('wW'), '2468');
  perform pg_temp.setkv('sW', r ->> 'session_hash');
  v := v || pg_temp.chk('S0', 'setup: ร้าน A/B · สมาชิก owner/admin/staff · SKU 4+1 · ใบงานตั้งต้น J1 (มีขั้น gem_set ไม่มีพลอย) · QR ใบงาน + ช่างฝัง login',
    pg_temp.kv('sW') is not null and pg_temp.kv('tokh_J1') is not null and pg_temp.fx('J1') is not null);
  return v;
end;
$c$;

-- ============================================================================
-- B. ฟังก์ชันบริสุทธิ์: norm · similar · ชื่อที่เก็บได้ · ฉลากขนาด
-- ============================================================================
create function pg_temp.g_pure() returns text
 language plpgsql as $c$
declare v text := '';
begin
  -- ชุดเคส UX §3.4 (ต้องเตือน = true · ต้องไม่เตือน = false)
  v := v || coalesce((select string_agg(pg_temp.chk(t.id, format('similar(%L, %L) = %s', t.a, t.b, t.e), analytics.gem_name_similar(t.a, t.b) is not distinct from t.e), '')
    from (values
      ('N1', 'โกเมน', 'โกเมนต์', true), ('N2', 'อเมทิสต์', 'อเมทิส', true), ('N2b', 'อะเมทิส', 'อเมทิสต์', true),
      ('N3', 'CZ', 'cz', true), ('N4', 'CZ', 'C Z', true), ('N5', 'ไพลิน', 'ไพลิน ', true), ('N5b', 'ＣＺ', 'cz', true), ('N5c', E'C​Z', 'cz', true),
      ('N6', 'ทับทิม', 'ไพลิน', false), ('N7', 'ซิทริน', 'เพอริดอท', false), ('N8', 'กลม', 'หยดน้ำ', false),
      ('N9', 'CZ', 'AZ', false), ('N10', 'CZ', 'CZX', false), ('N11', 'กลม', 'กลมๆ', false),
      ('N12', 'หัวใจ', 'ทรงหัวใจ', true), ('N13', 'Blue Topaz', 'บลูโทแพซ', false), ('N14', 'CZ', 'เพชรรัสเซีย', false),
      ('N14b', 'Blue Topaz', 'White Topaz', false), ('N14c', '', 'โกเมน', false)
    ) as t(id, a, b, e)), '');
  -- norm: ตัดช่องว่าง/วรรคตอน/ล่องหน · ตัวเล็ก · ไม่ตัดสระ/วรรณยุกต์ไทย
  v := v || pg_temp.chk('N15', 'gem_name_norm: "  C  Z " · "C.Z" · "ＣＺ" → cz · "ไพลิน " ไม่ตัดสระ · null → ว่าง',
    analytics.gem_name_norm('  C  Z ') = 'cz' and analytics.gem_name_norm('C.Z') = 'cz' and analytics.gem_name_norm('ＣＺ') = 'cz'
    and analytics.gem_name_norm('ไพลิน ') = 'ไพลิน' and analytics.gem_name_norm(null) = '');
  -- 🔴 S1: [[:punct:]] ของ DB = วรรคตอน (\p{P}) เท่านั้น — สัญลักษณ์ ($ + < = > ^ ` | ~) อยู่ใน norm (TS normalizeGemName ตรงกัน — shop-gems.qa.test.ts กวาดทุกจุดรหัสเทียบแล้ว)
  v := v || pg_temp.chk('N15b', 'gem_name_norm: "C$Z" → c$z · "CZ+" → cz+ · "C-Z" → cz · "C.Z." → cz · "CZ·" (U+00B7) → cz · "(CZ)" → cz',
    analytics.gem_name_norm('C$Z') = 'c$z' and analytics.gem_name_norm('CZ+') = 'cz+' and analytics.gem_name_norm('C-Z') = 'cz' and analytics.gem_name_norm('C.Z.') = 'cz'
    and analytics.gem_name_norm(E'CZ\u00b7') = 'cz' and analytics.gem_name_norm('(CZ)') = 'cz');
  -- ชื่อที่เก็บได้ (gem_name_ok) — ต้องผ่าน / ต้องไม่ผ่าน
  v := v || coalesce((select string_agg(pg_temp.chk('N16' || t.id, format('gem_name_ok(%L) = %s', left(t.a, 24), t.e), analytics.gem_name_ok(t.a) is not distinct from t.e), '')
    from (values
      ('a', 'โกเมน', true), ('b', 'CZ', true), ('c', '6 เหลี่ยม', true), ('d', repeat('ก', 40), true), ('e', 'ไข่', true),
      ('f', 'a', false), ('g', '', false), ('h', ' โกเมน', false), ('i', 'โกเมน ', false), ('j', 'โก  เมน', false), ('k', '12', false),
      ('l', '1.5', false), ('m', '..', false), ('n', 'ab<c', false), ('o', E'x\ty', false), ('p', E'ก​ข', false), ('q', E'​​', false),
      ('r', '😀😀', false), ('s', repeat('ก', 41), false), ('t', E'⠀⠀', false), ('u', E'\u0085\u0085', false), ('v', 'x>', false),
      ('w', E'ab cd', false), ('x', E'  ', false),
      ('y1', '๑๒', false), ('y2', '١٢', false), ('y3', '１２', false), ('y4', '²³', false), ('y5', '๑๒๓๔', false), ('y6', '๑ก', true), ('y7', 'A๑', true), ('y8', '6 เหลี่ยม', true),
      ('y9', E'ิิ', false), ('y10', 'ก็', true), ('y11', '+1', false), ('y12', '$$', false), ('y13', '日本', true)
    ) as t(id, a, e)), '');
  v := v || pg_temp.chk('N17', 'gem_size_label: 4.00×6.00 → "4×6" · 1.50 → "1.5" · 2.25 → "2.25" · 100.00 → "100"',
    analytics.gem_size_label(4.00, 6.00) = '4×6' and analytics.gem_size_label(1.50, null) = '1.5' and analytics.gem_size_label(2.25, null) = '2.25' and analytics.gem_size_label(100.00, null) = '100'
    and analytics.gem_label_compose('โกเมน', 'ไข่', '4×6') = 'โกเมน · ไข่ · 4×6 มม.');
  return v;
end;
$c$;

-- ============================================================================
-- C. แคตตาล็อก: ชื่อใหม่เข้าเองตอนบันทึก · norm ซ้ำ=ใช้ตัวเดิม · ตัวดักคล้าย · ตรวจแถวไม่ผ่าน · ชนิด/รูปทรงปิดใช้
-- ============================================================================
create function pg_temp.g_cat() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A');
  j uuid := pg_temp.fx('J1');
  oval uuid := pg_temp.shp(a, 'ไข่');
  rnd uuid := pg_temp.shp(a, 'กลม');
  r jsonb; r2 jsonb; d jsonb;
  n_t int; n_s int; n_i int; s0 text; tgem uuid; row_ record; ln text; ok boolean; line_ok boolean;
begin
  v := v || pg_temp.chk('C0b', 'seed รูปทรง: ชื่อ "บาแก็ตต์" ตามเอกสารเจ้าของ (ไม่ใช่ "บาเกต") · ครบ 12 ชื่อที่ยืนยันแล้ว',
    pg_temp.shp(a, 'บาแก็ตต์') is not null and pg_temp.shp(a, 'บาเกต') is null and (select count(*) from analytics.gem_shape where shop_id = a and is_seed) = 12);
  v := v || pg_temp.chk('C0', 'ร้านใหม่: มีรูปทรง seed 12 แบบ (ไข่ 2 ค่า · กลม 1 ค่า · หัวใจ 1 ค่า · คุชชั่น 2 ค่า) · ไม่มีชนิด · ไม่มีรายการ · ไม่มีราคา',
    pg_temp.n_shape(a) = 12 and pg_temp.n_type(a) = 0 and pg_temp.n_item(a) = 0
    and (select has_length from analytics.gem_shape where id = oval) and not (select has_length from analytics.gem_shape where id = rnd)
    and not (select has_length from analytics.gem_shape where shop_id = a and name = 'หัวใจ') and (select has_length from analytics.gem_shape where shop_id = a and name = 'คุชชั่น')
    and not exists (select 1 from analytics.gem_item_price p where p.shop_id = a));

  -- C1: พิมพ์ชนิดใหม่ + รูปทรง/ขนาดกลับด้าน (6×4 → 4×6) ตอนบันทึกใบ → เข้าแคตตาล็อกในทรานแซกชันเดียวกัน · ฉลาก DB ประกอบ · event bom_change
  r := pg_temp.bset(a, j, format('[{"new_type_name":"โกเมน","shape_id":"%s","size_a":6,"size_b":4,"qty_per_piece":2,"position":"บ่าซ้าย-ขวา"}]', oval)::jsonb, pg_temp.own());
  tgem := pg_temp.typ(a, 'โกเมน');
  perform pg_temp.setfx('tGem', tgem);
  v := v || pg_temp.chk('C1', 'พิมพ์ชนิดใหม่ "โกเมน" + ไข่ 6×4 ตอนบันทึกใบ → ชนิดเข้าแคตตาล็อกเอง · รายการ 4×6 (สลับให้) · ฉลาก "โกเมน · ไข่ · 4×6 มม." · 1 แถวใน BOM · changed · event 1 (phase free_before_start)',
    r ->> 'changed' = 'true' and tgem is not null and pg_temp.n_type(a) = 1 and pg_temp.n_item(a) = 1
    and (select count(*) from analytics.gem_item i where i.gem_type_id = tgem and i.gem_shape_id = oval and i.size_a = 4 and i.size_b = 6) = 1
    and (r -> 'lines' -> 0 ->> 'label') = 'โกเมน · ไข่ · 4×6 มม.' and (r -> 'lines' -> 0 ->> 'qty_total') = '6'
    and pg_temp.n_bom(j) = 1 and pg_temp.n_ev(j) = 1 and r ->> 'window' = 'free_before_start'
    and (select payload ->> 'phase' from analytics.job_event where job_id = j and event_type = 'bom_change' order by recorded_at limit 1) = 'free_before_start'
    and (r -> 'summary' -> 'created_types' -> 0 ->> 'name') = 'โกเมน'
    and (select created_by from analytics.gem_type where id = tgem) = pg_temp.own());
  perform pg_temp.setfx('iGemOval', (select id from analytics.gem_item where gem_type_id = tgem and gem_shape_id = oval));

  -- C2: พิมพ์ซ้ำ (ช่องว่าง/ตัวเล็กใหญ่ต่าง) = ใช้ตัวเดิมเงียบๆ ไม่ใช่ error · force=true ก็ไม่สร้างแถวซ้ำ · ไม่เปลี่ยนอะไร → ไม่มี event ใหม่
  r := pg_temp.bset(a, j, format('[{"new_type_name":"  โกเมน  ","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":2,"position":"บ่าซ้าย-ขวา"}]', oval)::jsonb, pg_temp.own(), null, true);
  v := v || pg_temp.chk('C2', 'ชื่อเท่ากันหลัง normalize + p_force=true → ไม่สร้างแถวซ้ำ (ชนิดยัง 1 · รายการยัง 1) · reused บอกใช้ตัวเดิม · ไม่เปลี่ยน = changed=false ไม่มี event ใหม่',
    r ->> '_err' is null and pg_temp.n_type(a) = 1 and pg_temp.n_item(a) = 1 and r ->> 'changed' = 'false' and pg_temp.n_ev(j) = 1
    and jsonb_array_length(r -> 'summary' -> 'reused') >= 1 and (r -> 'summary' -> 'reused' -> 0 ->> 'name') = 'โกเมน');
  r := pg_temp.bset(a, j, format('[{"new_type_name":"โกเมน","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":2,"position":"บ่าซ้าย-ขวา"}]', oval)::jsonb, pg_temp.own());
  v := v || pg_temp.chk('C2b', 'พิมพ์ชื่อเดิมซ้ำโดยไม่ force → ผ่านเงียบๆ (ไม่ใช่ gem_similar) · ไม่มีแถวซ้ำ', r ->> '_err' is null and pg_temp.n_type(a) = 1);

  -- C3: ตัวดักชื่อคล้าย — "โกเมนต์" ขณะมี "โกเมน": ไม่ส่ง force = คืน similar[] ไม่เขียนอะไร · force = เพิ่มใหม่ได้
  s0 := pg_temp.gsnap(a);
  r := pg_temp.bset(a, j, format('[{"new_type_name":"โกเมนต์","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":1}]', oval)::jsonb, pg_temp.own());
  d := pg_temp.dtl(r);
  v := v || pg_temp.chk('C3a', 'ชื่อคล้าย + ไม่ส่ง p_force → 22023/gem_similar · detail.similar[0].matches มี "โกเมน" · ไม่เขียนอะไรเลย (snapshot เท่าเดิม)',
    pg_temp.hint(r) = '22023|gem_similar' and d -> 'similar' -> 0 ->> 'name' = 'โกเมนต์' and d -> 'similar' -> 0 ->> 'kind' = 'type'
    and (d -> 'similar' -> 0 -> 'matches' -> 0 ->> 'name') = 'โกเมน' and (d -> 'similar' -> 0 -> 'rows' ->> 0) = '1' and pg_temp.gsnap(a) = s0);
  r := pg_temp.icreate(a, format('{"new_type_name":"โกเมนต์","shape_id":"%s","size_a":4,"size_b":6}', oval)::jsonb, true);
  perform pg_temp.setfx('tGemT', pg_temp.typ(a, 'โกเมนต์'));
  perform pg_temp.setfx('iGemTOval', (r -> 'item' ->> 'gem_item_id')::uuid);
  v := v || pg_temp.chk('C3b', 'ยืนยันเพิ่มใหม่ (p_force=true) → สร้างชนิด "โกเมนต์" + รายการได้ (ตัวดักไม่ใช่ตัวบล็อก) · ชนิดรวม 2',
    r ->> '_err' is null and pg_temp.fx('tGemT') is not null and pg_temp.n_type(a) = 2 and (r ->> 'created') = 'true');
  r := pg_temp.ccreate(a, 'type', 'โกเมนต์', null, true);
  v := v || pg_temp.chk('C3c', 'สร้างชนิดตรงๆ ชื่อที่ norm เท่ากับที่มี + p_force=true → ยังปฏิเสธ name_exists (force ใช้ข้ามเฉพาะ "คล้าย") · ไม่มีแถวใหม่',
    pg_temp.hint(r) = '22023|name_exists' and pg_temp.n_type(a) = 2);

  -- C4: รูปทรงใหม่ (fancy cut) พิมพ์เองได้ + ถามจำนวนค่าขนาดตอนสร้าง
  r := pg_temp.bset(a, j, format('[{"type_id":"%s","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":2,"position":"บ่าซ้าย-ขวา"},{"type_id":"%s","new_shape":{"name":"ทรงใบไม้","has_length":false},"size_a":5,"qty_per_piece":1}]', tgem, oval, tgem)::jsonb, pg_temp.own());
  perform pg_temp.setfx('sLeaf', pg_temp.shp(a, 'ทรงใบไม้'));
  v := v || pg_temp.chk('C4', 'รูปทรงใหม่ "ทรงใบไม้" (1 ค่า) พิมพ์ตอนบันทึกใบ → เข้าแคตตาล็อกเอง has_length=false · รายการ 5 มม. · BOM 2 แถว',
    r ->> '_err' is null and pg_temp.fx('sLeaf') is not null and not (select has_length from analytics.gem_shape where id = pg_temp.fx('sLeaf')) and pg_temp.n_bom(j) = 2
    and (select created_by from analytics.gem_shape where id = pg_temp.fx('sLeaf')) = pg_temp.own());
  r := pg_temp.bset(a, j, format('[{"type_id":"%s","shape_id":"%s","size_a":5,"size_b":5,"qty_per_piece":1}]', tgem, pg_temp.fx('sLeaf'))::jsonb, pg_temp.own());
  v := v || pg_temp.chk('C4a', 'รูปทรง 1 ค่า (ทรงใบไม้) แต่ใส่ size_b → ปฏิเสธ size_b_unexpected ที่ช่อง size_b แถว 1', pg_temp.hint(r) = '22023|size_b_unexpected' and pg_temp.dtl(r) ->> 'field' = 'size_b' and pg_temp.dtl(r) ->> 'row' = '1');
  r := pg_temp.bset(a, j, format('[{"type_id":"%s","shape_id":"%s","size_a":5,"qty_per_piece":1}]', tgem, oval)::jsonb, pg_temp.own());
  v := v || pg_temp.chk('C4b', 'รูปทรง 2 ค่า (ไข่) แต่ใส่ size_a ค่าเดียว → ปฏิเสธ size_b_required', pg_temp.hint(r) = '22023|size_b_required' and pg_temp.dtl(r) ->> 'field' = 'size_b');
  s0 := pg_temp.gsnap(a);
  r := pg_temp.bset(a, j, format('[{"type_id":"%s","new_shape":{"name":"ทรงใบไม","has_length":false},"size_a":5,"qty_per_piece":1}]', tgem)::jsonb, pg_temp.own());
  d := pg_temp.dtl(r);
  v := v || pg_temp.chk('C4c', 'ตัวดักคล้ายใช้กับรูปทรงด้วย ("ทรงใบไม" ↔ "ทรงใบไม้") → gem_similar kind=shape · ไม่เขียนอะไร',
    pg_temp.hint(r) = '22023|gem_similar' and d -> 'similar' -> 0 ->> 'kind' = 'shape' and pg_temp.gsnap(a) = s0);
  r := pg_temp.bset(a, j, format('[{"type_id":"%s","new_shape":{"name":"ไข่","has_length":false},"size_a":5,"size_b":6,"qty_per_piece":1}]', tgem)::jsonb, pg_temp.own());
  v := v || pg_temp.chk('C4d', 'พิมพ์รูปทรงใหม่ชื่อ "ไข่" (ซ้ำ seed) พร้อม has_length=false → ใช้ "ไข่" ตัวเดิม (2 ค่า — ของที่มีชนะ) ไม่สร้างแถวใหม่ · ขนาด 5×6 ผ่าน',
    r ->> '_err' is null and (select count(*) from analytics.gem_shape where shop_id = a and name_norm = 'ไข่') = 1 and pg_temp.n_shape(a) = 13);
  -- กลับไปสถานะ C4 (ไข่ 4×6 + ใบไม้ 5)
  r := pg_temp.bset(a, j, format('[{"type_id":"%s","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":2,"position":"บ่าซ้าย-ขวา"},{"type_id":"%s","shape_id":"%s","size_a":5,"qty_per_piece":1}]', tgem, oval, tgem, pg_temp.fx('sLeaf'))::jsonb, pg_temp.own());

  -- C5: แถวซ้ำ (4×6 กับ 6×4) รวมให้ · บวกจำนวน · ตำแหน่งต่อกัน · รวมเกิน 1,000 ปฏิเสธ
  r := pg_temp.bset(a, j, format('[{"type_id":"%s","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":2,"position":"ซ้าย"},{"type_id":"%s","shape_id":"%s","size_a":6,"size_b":4,"qty_per_piece":3,"position":"ขวา"}]', tgem, oval, tgem, oval)::jsonb, pg_temp.own());
  v := v || pg_temp.chk('C5', 'แถวซ้ำ (ไข่ 4×6 กับ 6×4 = ขนาดเดียวกันหลังเรียง) → รวมเป็น 1 แถว qty 5 · ตำแหน่ง "ซ้าย, ขวา" · summary.merged_rows บอกแถว 1,2',
    r ->> '_err' is null and pg_temp.n_bom(j) = 1 and (r -> 'lines' -> 0 ->> 'qty_per_piece') = '5' and (r -> 'lines' -> 0 ->> 'position') = 'ซ้าย, ขวา'
    and (r -> 'summary' -> 'merged_rows' -> 0 -> 'rows') = '[1, 2]'::jsonb);
  r := pg_temp.bset(a, j, format('[{"type_id":"%s","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":600},{"type_id":"%s","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":500}]', tgem, oval, tgem, oval)::jsonb, pg_temp.own());
  v := v || pg_temp.chk('C5b', 'รวมแถวซ้ำแล้วเกิน 1,000 → ปฏิเสธ qty_invalid (ที่แถวที่ทำให้เกิน)', pg_temp.hint(r) = '22023|qty_invalid' and pg_temp.dtl(r) ->> 'row' = '2');

  -- C6: ตารางเคสที่ต้องถูกปฏิเสธ — แต่ละเคสต้องตกที่ hint + ช่องที่ถูกต้อง และไม่เขียนอะไร (snapshot เท่าเดิมทั้งก้อน)
  s0 := pg_temp.gsnap(a); ok := true;
  for row_ in select * from (values
    ('q1', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":0}', 'qty_per_piece', 'qty_invalid', 1),
    ('q2', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1001}', 'qty_per_piece', 'qty_invalid', 1),
    ('q3', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1.5}', 'qty_per_piece', 'qty_invalid', 1),
    ('q4', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":"abc"}', 'qty_per_piece', 'qty_invalid', 1),
    ('q5', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":"NaN"}', 'qty_per_piece', 'qty_invalid', 1),
    ('q6', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":null}', 'qty_per_piece', 'qty_invalid', 1),
    ('q7', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":-1}', 'qty_per_piece', 'qty_invalid', 1),
    ('q8', '{"type_id":"$T","shape_id":"$R","size_a":2}', 'qty_per_piece', 'qty_invalid', 1),
    ('s1', '{"type_id":"$T","shape_id":"$R","size_a":0,"qty_per_piece":1}', 'size_a', 'size_invalid', 1),
    ('s2', '{"type_id":"$T","shape_id":"$R","size_a":-1,"qty_per_piece":1}', 'size_a', 'size_invalid', 1),
    ('s3', '{"type_id":"$T","shape_id":"$R","size_a":100.01,"qty_per_piece":1}', 'size_a', 'size_invalid', 1),
    ('s4', '{"type_id":"$T","shape_id":"$R","size_a":1.234,"qty_per_piece":1}', 'size_a', 'size_invalid', 1),
    ('s5', '{"type_id":"$T","shape_id":"$R","size_a":"NaN","qty_per_piece":1}', 'size_a', 'size_invalid', 1),
    ('s6', '{"type_id":"$T","shape_id":"$R","qty_per_piece":1}', 'size_a', 'size_required', 1),
    ('s7', '{"type_id":"$T","shape_id":"$R","size_a":2,"size_b":3,"qty_per_piece":1}', 'size_b', 'size_b_unexpected', 1),
    ('s8', '{"type_id":"$T","shape_id":"$O","size_a":2,"qty_per_piece":1}', 'size_b', 'size_b_required', 1),
    ('s9', '{"type_id":"$T","shape_id":"$O","size_a":2,"size_b":0,"qty_per_piece":1}', 'size_b', 'size_invalid', 1),
    ('s10', '{"type_id":"$T","shape_id":"$R","size_a":"1e2","qty_per_piece":1}', 'size_a', 'size_invalid', 1),
    ('s11', '{"type_id":"$T","shape_id":"$R","size_a":"Infinity","qty_per_piece":1}', 'size_a', 'size_invalid', 1),
    ('t1', '{"type_id":"00000000-0000-4000-8000-000000000001","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'type', 'gem_type_invalid', 1),
    ('t2', '{"type_id":"$TB","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'type', 'gem_type_invalid', 1),
    ('t3', '{"type_id":"not-a-uuid","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'type', 'gem_type_invalid', 1),
    ('t4', '{"type_id":"$T","new_type_name":"ซิทริน","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'type', 'type_required', 1),
    ('t5', '{"shape_id":"$R","size_a":2,"qty_per_piece":1}', 'type', 'type_required', 1),
    ('t6', '{"type_id":"$T","shape_id":"00000000-0000-4000-8000-000000000002","size_a":2,"qty_per_piece":1}', 'shape', 'gem_shape_invalid', 1),
    ('t7', '{"type_id":"$T","shape_id":"$SB","size_a":2,"qty_per_piece":1}', 'shape', 'gem_shape_invalid', 1),
    ('t8', '{"type_id":"$T","shape_id":"$R","new_shape":{"name":"ทรงดาว","has_length":false},"size_a":2,"qty_per_piece":1}', 'shape', 'shape_required', 1),
    ('t9', '{"type_id":"$T","size_a":2,"qty_per_piece":1}', 'shape', 'shape_required', 1),
    ('n1', '{"new_type_name":"a","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'type', 'name_invalid', 1),
    ('n2', '{"new_type_name":"12","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'type', 'name_invalid', 1),
    ('n3', '{"new_type_name":"..","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'type', 'name_invalid', 1),
    ('n4', '{"new_type_name":"​​","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'type', 'name_invalid', 1),
    ('n5', '{"new_type_name":"ab<c","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'type', 'name_invalid', 1),
    ('n6', '{"new_type_name":"กกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกก","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'type', 'name_invalid', 1),
    ('n7', '{"new_type_name":"1.5","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'type', 'name_invalid', 1),
    ('n8', '{"new_type_name":"a\tb","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'type', 'name_invalid', 1),
    ('n9', '{"new_type_name":"   ","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'type', 'name_invalid', 1),
    ('n10', '{"new_type_name":"😀😀","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'type', 'name_invalid', 1),
    ('n11', '{"new_type_name":"⠀⠀","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'type', 'name_invalid', 1),
    ('n12', '{"new_type_name":123,"shape_id":"$R","size_a":2,"qty_per_piece":1}', 'type', 'name_invalid', 1),
    ('ns1', '{"type_id":"$T","new_shape":{"name":"ทรงดาว"},"size_a":2,"qty_per_piece":1}', 'shape', 'shape_new_invalid', 1),
    ('ns2', '{"type_id":"$T","new_shape":{"name":"x","has_length":false},"size_a":2,"qty_per_piece":1}', 'shape', 'name_invalid', 1),
    ('ns3', '{"type_id":"$T","new_shape":{"name":"ทรงดาว","has_length":"yes"},"size_a":2,"qty_per_piece":1}', 'shape', 'shape_new_invalid', 1),
    ('ns4', '{"type_id":"$T","new_shape":{"name":"ทรงดาว","has_length":false,"price":1},"size_a":2,"qty_per_piece":1}', 'shape', 'shape_new_invalid', 1),
    ('p1', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1,"position":"กกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกก"}', 'position', 'position_invalid', 1),
    ('p2', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1,"position":"<x>"}', 'position', 'position_invalid', 1),
    ('p3', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1,"position":123}', 'position', 'position_invalid', 1),
    ('k1', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1,"price":10}', 'price', 'line_invalid', 1),
    ('k2', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1,"cost":10}', 'cost', 'line_invalid', 1),
    ('k3', '{"gem_item_id":"$I","type_id":"$T","qty_per_piece":1}', 'type_id', 'line_invalid', 1),
    ('k4', '"abc"', 'line', 'line_invalid', 1),
    ('i1', '{"gem_item_id":"00000000-0000-4000-8000-000000000003","qty_per_piece":1}', 'gem_item_id', 'gem_item_invalid', 1),
    ('i2', '{"gem_item_id":"$IB","qty_per_piece":1}', 'gem_item_id', 'gem_item_invalid', 1),
    ('i3', '{"gem_item_id":"x","qty_per_piece":1}', 'gem_item_id', 'gem_item_invalid', 1)
  ) as t(id, ln, fld, code, rw) loop
    ln := replace(replace(replace(replace(replace(replace(row_.ln, '$TB', pg_temp.fx('tB')::text), '$SB', pg_temp.fx('sB')::text), '$IB', pg_temp.fx('iB')::text),
            '$T', tgem::text), '$R', rnd::text), '$O', oval::text);
    ln := replace(ln, '$I', pg_temp.fx('iGemOval')::text);
    r := pg_temp.bset(a, j, ('[' || ln || ']')::jsonb, pg_temp.own());
    d := pg_temp.dtl(r);
    line_ok := pg_temp.hint(r) = '22023|' || row_.code and d ->> 'field' = row_.fld and d ->> 'row' = row_.rw::text;
    if not line_ok then
      v := v || pg_temp.chk('C6-' || row_.id, format('ต้องถูกปฏิเสธ %s ที่ช่อง %s แต่ได้ %s | field=%s', row_.code, row_.fld, pg_temp.hint(r), d ->> 'field'), false);
      ok := false;
    end if;
  end loop;
  v := v || pg_temp.chk('C6', 'ตารางเคสต้องถูกปฏิเสธ 64 แถว (qty 0/1.5/1001/ข้อความ/NaN · size ≤0/>100/ทศนิยม 3/NaN/Infinity/1e2 · size_b ผิด · type/shape/item ร้านอื่น/ไม่พบ · ชื่อสั้น/ตัวเลขล้วน/ล่องหน/<>/ยาว · key แปลก เช่น price) ตกที่รหัส+ช่องที่ถูกต้องทุกแถว', ok);
  v := v || pg_temp.chk('C6z', 'ทุกเคสที่ถูกปฏิเสธ ไม่เขียนอะไรเลย (ชนิด/รูปทรง/รายการ/BOM/event เท่าเดิมทั้งก้อน)', pg_temp.gsnap(a) = s0);
  -- แถวเกิน 30 · lines ไม่ใช่ array · null
  s0 := pg_temp.gsnap(a);
  r := pg_temp.bset(a, j, (select jsonb_agg(jsonb_build_object('type_id', tgem, 'shape_id', rnd, 'size_a', g * 0.5, 'qty_per_piece', 1)) from generate_series(1, 31) g), pg_temp.own());
  v := v || pg_temp.chk('C6l1', '31 แถว → ปฏิเสธ too_many_lines ก่อนเขียนอะไร', pg_temp.hint(r) = '22023|too_many_lines' and pg_temp.gsnap(a) = s0);
  r := pg_temp.bset(a, j, (select jsonb_agg(jsonb_build_object('type_id', tgem, 'shape_id', rnd, 'size_a', g * 0.5, 'qty_per_piece', 1)) from generate_series(1, 30) g), pg_temp.own());
  v := v || pg_temp.chk('C6l2', '30 แถว (เต็มเพดาน) → ผ่าน (ต้องไม่พัง) · BOM 30 แถว', r ->> '_err' is null and pg_temp.n_bom(j) = 30);
  r := pg_temp.bset(a, j, '{"a":1}'::jsonb, pg_temp.own());
  v := v || pg_temp.chk('C6l3', 'lines เป็น object (ไม่ใช่ array) → ปฏิเสธ lines_invalid', pg_temp.hint(r) = '22023|lines_invalid');
  r := pg_temp.q(format('select analytics.job_gem_bom_set(p_shop_id=>%L, p_job_id=>%L, p_gem_lines=>null, p_actor=>%L)', a, j, pg_temp.own()));
  v := v || pg_temp.chk('C6l4', 'lines = null → ปฏิเสธ lines_invalid (ส่ง [] ถ้าไม่มีพลอย)', pg_temp.hint(r) = '22023|lines_invalid');
  -- กลับสู่ BOM ของใบ J1: โกเมน ไข่ 4×6 ×2
  r := pg_temp.bset(a, j, format('[{"type_id":"%s","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":2,"position":"บ่าซ้าย-ขวา"}]', tgem, oval)::jsonb, pg_temp.own());
  v := v || pg_temp.chk('C6r', 'กลับเป็น 1 แถว (ลบ 29 แถวที่เกินออกได้) · ฉลาก snapshot ของแถวเดิมยังเป็นฉลากเดิม', r ->> '_err' is null and pg_temp.n_bom(j) = 1 and (r -> 'lines' -> 0 ->> 'label') = 'โกเมน · ไข่ · 4×6 มม.');

  -- C7: สร้าง/เปลี่ยนชื่อตรงๆ — norm ชนแถวอื่น = ปฏิเสธเสมอ (force ไม่ช่วย) · เปลี่ยนตัวพิมพ์ของตัวเองได้ · คล้าย = เตือน
  r := pg_temp.ccreate(a, 'type', 'cz', null, false);
  r2 := pg_temp.ccreate(a, 'type', 'C Z', null, true);
  perform pg_temp.setfx('tCz', (r ->> 'id')::uuid);
  v := v || pg_temp.chk('C7a', 'สร้าง "cz" ได้ · สร้าง "C Z" + force → name_exists (norm เท่ากัน force ไม่ช่วย) · ไม่มีแถวซ้ำ',
    r ->> '_err' is null and pg_temp.hint(r2) = '22023|name_exists' and (select count(*) from analytics.gem_type where shop_id = a and name_norm = 'cz') = 1);
  r := pg_temp.ren(a, 'type', pg_temp.fx('tCz'), 'CZ');
  v := v || pg_temp.chk('C7b', 'เปลี่ยน "cz" → "CZ" (ตัวเองเปลี่ยนตัวพิมพ์) ผ่าน · มี event rename', r ->> '_err' is null and (select name from analytics.gem_type where id = pg_temp.fx('tCz')) = 'CZ'
    and exists (select 1 from analytics.gem_catalog_event where subject_id = pg_temp.fx('tCz') and event_type = 'rename'));
  r := pg_temp.ren(a, 'type', pg_temp.fx('tCz'), 'โกเมน', true);
  v := v || pg_temp.chk('C7c', 'เปลี่ยนชื่อไปซ้ำของแถวอื่น (โกเมน) + force → ปฏิเสธ name_exists', pg_temp.hint(r) = '22023|name_exists');
  r := pg_temp.ccreate(a, 'type', 'อเมทิสต์', null, false);
  r2 := pg_temp.ccreate(a, 'type', 'อเมทิส', null, false);
  v := v || pg_temp.chk('C7d', 'สร้าง "อเมทิส" ขณะมี "อเมทิสต์" → gem_similar (สร้างตรงๆ ก็ถูกดัก) · force = สร้างได้',
    pg_temp.hint(r2) = '22023|gem_similar' and pg_temp.hint(pg_temp.ccreate(a, 'type', 'อเมทิส', null, true)) = 'OK|');
  r := pg_temp.ccreate(a, 'shape', 'ทรงดาว', null, false);
  v := v || pg_temp.chk('C7e', 'สร้างรูปทรงโดยไม่ระบุ has_length → ปฏิเสธ shape_new_invalid · kind ผิด → kind_invalid',
    pg_temp.hint(r) = '22023|shape_new_invalid' and pg_temp.hint(pg_temp.ccreate(a, 'item', 'x', null)) = '22023|kind_invalid');

  -- C8: ชนิด/รูปทรง/รายการที่ปิดใช้งาน — เลือกด้วย id หรือพิมพ์ชื่อซ้ำ = ปฏิเสธ gem_inactive · เปิดกลับแล้วใช้ได้
  r := pg_temp.sact(a, 'type', pg_temp.fx('tCz'), false);
  r2 := pg_temp.bset(a, j, format('[{"type_id":"%s","shape_id":"%s","size_a":2,"qty_per_piece":1}]', pg_temp.fx('tCz'), rnd)::jsonb, pg_temp.own());
  v := v || pg_temp.chk('C8a', 'ชนิดที่ปิดใช้งาน เลือกด้วย id → ปฏิเสธ gem_inactive', r ->> '_err' is null and pg_temp.hint(r2) = '22023|gem_inactive' and pg_temp.dtl(r2) ->> 'field' = 'type');
  r2 := pg_temp.bset(a, j, format('[{"new_type_name":"cz","shape_id":"%s","size_a":2,"qty_per_piece":1}]', rnd)::jsonb, pg_temp.own());
  v := v || pg_temp.chk('C8b', 'พิมพ์ชื่อที่ตรงกับชนิดที่ปิดใช้งาน → ปฏิเสธ gem_inactive (ไม่สร้างซ้ำ · ไม่เปิดให้เอง)', pg_temp.hint(r2) = '22023|gem_inactive' and (select count(*) from analytics.gem_type where shop_id = a and name_norm = 'cz') = 1);
  r2 := pg_temp.olist(a);
  v := v || pg_temp.chk('C8c', 'gem_options_list ไม่มีชนิดที่ปิดใช้งาน · ไม่มี key ราคา/ผู้สร้าง/ผู้ขาย', not (r2::text like '%"CZ"%') and pg_temp.badkeys(r2) = '' and r2 -> 'types' @> jsonb_build_array(jsonb_build_object('id', tgem, 'name', 'โกเมน')));
  r := pg_temp.sact(a, 'type', pg_temp.fx('tCz'), true);
  r2 := pg_temp.bset(a, j, format('[{"type_id":"%s","shape_id":"%s","size_a":2,"qty_per_piece":1}]', pg_temp.fx('tCz'), rnd)::jsonb, pg_temp.own());
  v := v || pg_temp.chk('C8d', 'เปิดชนิดกลับ → ใช้ได้ (ต้องไม่พัง) · event active_set 2 ครั้ง', r ->> '_err' is null and r2 ->> '_err' is null and (select count(*) from analytics.gem_catalog_event where subject_id = pg_temp.fx('tCz') and event_type = 'active_set') = 2);
  r := pg_temp.bset(a, j, format('[{"type_id":"%s","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":2,"position":"บ่าซ้าย-ขวา"}]', tgem, oval)::jsonb, pg_temp.own());

  -- C9: กำแพงที่ตาราง (ยิงตรงในฐานะเจ้าของตาราง — ไม่ผ่าน RPC): size_b ไม่ตรง has_length · แก้ขนาด/ย้ายชนิดตรง · ชื่อผิด CHECK · ชื่อซ้ำ unique
  v := v || pg_temp.chk('C9a', 'INSERT gem_item ตรง: รูปทรง 1 ค่าแต่มี size_b → 22023 size_b_mismatch (trigger gem_item_guard)',
    pg_temp.err(format('insert into analytics.gem_item (shop_id, gem_type_id, gem_shape_id, size_a, size_b) values (%L, %L, %L, 1, 2)', a, tgem, rnd)) = '22023|size_b_mismatch');
  v := v || pg_temp.chk('C9b', 'UPDATE gem_item ตรง: แก้ size_a → 42501 · ย้าย gem_type_id โดยไม่ผ่าน gem_merge → 42501',
    pg_temp.err(format('update analytics.gem_item set size_a = 5 where id = %L', pg_temp.fx('iGemOval'))) = '42501|'
    and pg_temp.err(format('update analytics.gem_item set gem_type_id = %L where id = %L', pg_temp.fx('tGemT'), pg_temp.fx('iGemOval'))) = '42501|');
  v := v || pg_temp.chk('C9c', 'INSERT gem_type ตรง: ชื่อ "x" (สั้น) → 23514 (CHECK) · ชื่อ "12" → 23514 · ชื่อซ้ำ norm ("โกเมน ") ไม่ได้ → 23505 (unique)',
    pg_temp.err(format('insert into analytics.gem_type (shop_id, name) values (%L, %L)', a, 'x')) = '23514|'
    and pg_temp.err(format('insert into analytics.gem_type (shop_id, name) values (%L, %L)', a, '12')) = '23514|'
    and pg_temp.err(format('insert into analytics.gem_type (shop_id, name) values (%L, %L)', a, 'โกเมน')) = '23505|');
  v := v || pg_temp.chk('C9d', 'INSERT gem_item ตรง: ขนาด 0 / 100.01 / NaN → 23514 (CHECK not(between)) · ซ้ำ (ชนิด+รูปทรง+ขนาด) → 23505',
    pg_temp.err(format('insert into analytics.gem_item (shop_id, gem_type_id, gem_shape_id, size_a) values (%L, %L, %L, 0)', a, tgem, rnd)) = '23514|'
    and pg_temp.err(format('insert into analytics.gem_item (shop_id, gem_type_id, gem_shape_id, size_a) values (%L, %L, %L, 100.01)', a, tgem, rnd)) in ('23514|', '22003|')
    and pg_temp.err(format('insert into analytics.gem_item (shop_id, gem_type_id, gem_shape_id, size_a) values (%L, %L, %L, %L::numeric)', a, tgem, rnd, 'NaN')) = '23514|'
    and pg_temp.err(format('insert into analytics.gem_item (shop_id, gem_type_id, gem_shape_id, size_a, size_b) values (%L, %L, %L, 4, 6)', a, tgem, oval)) = '23505|');
  v := v || pg_temp.chk('C9e', 'ชนิด/รูปทรงที่ถูกใช้ลบตรงไม่ได้ (FK restrict) · gem_catalog_event append-only (UPDATE/DELETE → 42501) · TRUNCATE ไม่ได้',
    pg_temp.err(format('delete from analytics.gem_type where id = %L', tgem)) = '23503|'
    and pg_temp.err(format('update analytics.gem_catalog_event set payload = %L::jsonb', '{}')) = '42501|'
    and pg_temp.err('delete from analytics.gem_catalog_event') = '42501|'
    and pg_temp.err('truncate analytics.gem_catalog_event') = '42501|' and pg_temp.err('truncate analytics.job_gem_bom') = '42501|');
  return v;
end;
$c$;
-- ============================================================================
-- D. ราคาพลอย: ตั้ง/ประวัติ/วันที่มีผล · ค่าที่ต้องปฏิเสธ · สิทธิ์ actor · 🔴 ราคาไม่หลุดทุก RPC ที่ไม่ใช่ราคา
-- ============================================================================
create function pg_temp.g_price() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A');
  b uuid := pg_temp.fx('B');
  j uuid := pg_temp.fx('J1');
  it uuid := pg_temp.fx('iGemOval');
  it2 uuid := pg_temp.fx('iGemTOval');
  today date := analytics.job_today();
  r jsonb; r2 jsonb; row_ record; ok boolean; s0 text; n0 int; out_ jsonb; lst text := '';
begin
  -- P1: ตั้งราคา (เลขแปลก) · วันเดียวกันตั้งซ้ำ = แก้ราคาเดิม · ย้อนหลัง/ล่วงหน้าได้ · ประวัติเรียงใหม่→เก่า · ราคาปัจจุบัน = แถวล่าสุดที่มีผลแล้ว
  r := pg_temp.price(a, it, '5555.1111', null, null, 'ร้านทดสอบ', 'ราคาแรก');
  v := v || pg_temp.chk('P1a', 'ตั้งราคาครั้งแรก (วันที่ว่าง = วันนี้ไทย) → ผ่าน · replaced=false', r ->> '_err' is null and (r ->> 'effective_from')::date = today and r ->> 'replaced' = 'false');
  r := pg_temp.price(a, it, pg_temp.px(), null, null, null, 'แก้ราคาเป็นราคาจริง');
  v := v || pg_temp.chk('P1b', 'ตั้งซ้ำวันเดียวกัน → แก้ราคาเดิม (replaced=true · ไม่เกิด 2 แถว)', r ->> '_err' is null and r ->> 'replaced' = 'true' and (select count(*) from analytics.gem_item_price where gem_item_id = it and effective_from = today) = 1);
  r := pg_temp.price(a, it, '100.5', (today - 30)::text, null, null, 'ราคาเก่าย้อนหลังจากใบเสนอราคาเดิม');
  r2 := pg_temp.price(a, it, '9999.9999', (today + 10)::text);
  v := v || pg_temp.chk('P1c', 'ราคาย้อนหลัง (วันนี้-30) และล่วงหน้า (วันนี้+10) ตั้งได้ · ประวัติ 3 แถว', r ->> '_err' is null and r2 ->> '_err' is null and (select count(*) from analytics.gem_item_price where gem_item_id = it) = 3);
  r := pg_temp.q(format('select analytics.gem_price_history(%L, %L, %L)', a, pg_temp.own(), it));
  v := v || pg_temp.chk('P1d', 'gem_price_history: เรียงใหม่→เก่า · แถวแรกเป็นราคาล่วงหน้า 9999.9999 · มีผู้ตั้ง', r -> 'rows' -> 0 ->> 'price' = '9999.9999' and r -> 'rows' -> 2 ->> 'price' = '100.5000' and jsonb_array_length(r -> 'rows') = 3 and (r -> 'rows' -> 0 ->> 'updated_by')::uuid = pg_temp.own());
  r := pg_temp.clist(a);
  select x into r2 from jsonb_array_elements(r -> 'items') x where (x ->> 'gem_item_id')::uuid = it;
  v := v || pg_temp.chk('P1e', 'gem_catalog_list: ราคาปัจจุบันของรายการ = แถวที่มีผลแล้วล่าสุด (7391.2468 วันนี้ — ไม่ใช่ราคาล่วงหน้า) · has_price · price_rows 3 · used_jobs_open ≥ 1',
    r2 ->> 'price' = '7391.2468' and (r2 ->> 'price_effective_from')::date = today and r2 ->> 'has_price' = 'true' and (r2 ->> 'price_rows')::int = 3 and (r2 ->> 'used_jobs_open')::int >= 1 and r2 ->> 'price_supplier' is null);
  select x into r2 from jsonb_array_elements(r -> 'items') x where (x ->> 'gem_item_id')::uuid = it2;
  v := v || pg_temp.chk('P1f', 'รายการที่ยังไม่มีราคา: has_price=false · price เป็น null (ไม่ใช่ 0) · price_rows 0', r2 ->> 'has_price' = 'false' and r2 -> 'price' = 'null'::jsonb and (r2 ->> 'price_rows')::int = 0);

  -- P2: ค่าที่ต้องปฏิเสธ (ราคา · วันที่ · ข้อความ) · ขอบที่ต้องผ่าน · ไม่เขียนอะไรเมื่อปฏิเสธ
  select count(*) into n0 from analytics.gem_item_price where shop_id = a; ok := true;
  for row_ in select * from (values
    ('z0', '0', null, 'price_invalid'), ('z1', '-1', null, 'price_invalid'), ('z2', 'NaN', null, 'price_invalid'), ('z3', 'Infinity', null, 'price_invalid'),
    ('z4', '1000000.01', null, 'price_invalid'), ('z5', '1.23456', null, 'price_invalid'), ('z6', null, null, 'price_invalid'),
    ('d1', '10', '2019-12-31', 'date_invalid'), ('d2', '10', (today + 366)::text, 'date_invalid')
  ) as t(id, p, d, code) loop
    r := pg_temp.price(a, it2, row_.p, row_.d);
    if pg_temp.hint(r) <> '22023|' || row_.code then
      v := v || pg_temp.chk('P2-' || row_.id, format('ราคา %s วันที่ %s ต้องปฏิเสธ %s แต่ได้ %s', row_.p, row_.d, row_.code, pg_temp.hint(r)), false); ok := false;
    end if;
  end loop;
  v := v || pg_temp.chk('P2', 'ราคา 0 / ติดลบ / NaN / Infinity / > 1,000,000 / ทศนิยม 5 ตำแหน่ง / ว่าง · วันที่ < 2020 / เกินวันนี้+365 → ปฏิเสธครบ', ok);
  v := v || pg_temp.chk('P2z', 'ที่ปฏิเสธไม่เขียนแถวราคา (จำนวนแถวราคาเท่าเดิม)', (select count(*) from analytics.gem_item_price where shop_id = a) = n0);
  r := pg_temp.price(a, it2, '1000000', (today + 365)::text);
  r2 := pg_temp.price(a, it2, '0.0001', '2020-01-01', null, null, 'ขอบล่างของวันที่');
  v := v || pg_temp.chk('P2b', 'ขอบต้องผ่าน: ราคา 1,000,000 + วันที่ วันนี้+365 · ราคา 0.0001 + วันที่ 2020-01-01', r ->> '_err' is null and r2 ->> '_err' is null);
  r := pg_temp.price(a, it2, '10', null, null, '<b>');
  r2 := pg_temp.price(a, it2, '10', null, null, null, E'​');
  v := v || pg_temp.chk('P2c', 'ผู้ขาย "<b>" / หมายเหตุล่องหน → ปฏิเสธ text_invalid', pg_temp.hint(r) = '22023|text_invalid' and pg_temp.hint(r2) in ('22023|text_invalid', '22023|'));
  r := pg_temp.price(a, pg_temp.fx('iB'), '10');
  v := v || pg_temp.chk('P2d', 'ตั้งราคารายการของร้านอื่น → ปฏิเสธ gem_item_invalid', pg_temp.hint(r) = '22023|gem_item_invalid');
  delete from analytics.gem_item_price where gem_item_id = it2;

  -- P7: 🔴 audit การแก้ราคา (security M1): old/new ทุกครั้ง · แก้ทับวันเดิม/ย้อนหลังต้องมี note (whitelist) · append-only · ไม่มีสิทธิ์อ่านตรง
  select count(*) into n0 from analytics.gem_item_price_audit where gem_item_id = it;
  v := v || pg_temp.chk('P7a', 'audit: ราคา 4 ครั้งของรายการ (ตั้งแรก · แก้ทับ · ย้อนหลัง · ล่วงหน้า) = 4 แถว · แถวแรก action=insert old=null · แถวแก้ทับ action=update old=5555.1111 new=7391.2468 พร้อม note · ผู้ตั้งคือ actor',
    n0 = 4 and exists (select 1 from analytics.gem_item_price_audit a where a.gem_item_id = it and a.action = 'insert' and a.old_price is null and a.new_price = 5555.1111)
    and exists (select 1 from analytics.gem_item_price_audit a where a.gem_item_id = it and a.action = 'update' and a.old_price = 5555.1111 and a.new_price = 7391.2468 and a.note = 'แก้ราคาเป็นราคาจริง' and a.actor = pg_temp.own()));
  s0 := md5(coalesce((select string_agg(p::text, '|' order by p.effective_from) from analytics.gem_item_price p where p.gem_item_id = it), '')) || '/' || (select count(*) from analytics.gem_item_price_audit where gem_item_id = it);
  ok := true;
  foreach lst in array array['', ' ', E'\u200b', '.', '👍', E'\u0085', E'\u2800', '<b>', '-'] loop
    r := pg_temp.price(a, it, '4444.4444', null, null, null, lst);
    if pg_temp.hint(r) not like '22023|%' then ok := false; v := v || pg_temp.chk('P7b-' || md5(lst), format('แก้ทับวันเดิมด้วย note %L ต้องถูกปฏิเสธ แต่ได้ %s', lst, pg_temp.hint(r)), false); end if;
  end loop;
  r := pg_temp.price(a, it, '4444.4444');
  v := v || pg_temp.chk('P7b', 'แก้ทับวันเดิม (วันนี้) โดยไม่มี note / note ไม่มีตัวอักษรจริง (ว่าง · ช่องว่าง · ล่องหน · "." · อีโมจิ · NEL · U+2800 · <> · "-") → ปฏิเสธ note_required · ราคาและ audit ไม่ขยับ',
    ok and pg_temp.hint(r) = '22023|note_required' and s0 = md5(coalesce((select string_agg(p::text, '|' order by p.effective_from) from analytics.gem_item_price p where p.gem_item_id = it), '')) || '/' || (select count(*) from analytics.gem_item_price_audit where gem_item_id = it));
  r := pg_temp.price(a, it2, '4444.4444', (today - 1)::text);
  r2 := pg_temp.price(a, it2, '4444.4444', (today - 1)::text, null, null, 'ราคาเมื่อวานจากใบแจ้งหนี้');
  v := v || pg_temp.chk('P7c', 'ตั้งราคาย้อนหลัง (วันนี้-1 = ก่อนวันนี้ไทย) แม้ไม่มีแถวเดิม โดยไม่มี note → ปฏิเสธ note_required · มี note → ผ่าน · ล่วงหน้า/วันนี้ครั้งแรก ไม่ต้องมี note (P1a P1c)',
    pg_temp.hint(r) = '22023|note_required' and r2 ->> '_err' is null and exists (select 1 from analytics.gem_item_price_audit a where a.gem_item_id = it2 and a.action = 'insert' and a.note = 'ราคาเมื่อวานจากใบแจ้งหนี้'));
  r := pg_temp.q(format('select analytics.gem_price_history(%L, %L, %L)', a, pg_temp.own(), it));
  v := v || pg_temp.chk('P7d', 'gem_price_history คืนแถว audit (action · old/new · note · actor · เวลา) 4 แถว ของรายการนี้ ไม่มีของรายการอื่น', jsonb_array_length(r -> 'audit') = 4 and exists (select 1 from jsonb_array_elements(r -> 'audit') x where x ->> 'action' = 'update' and x ->> 'old_price' = '5555.1111'));
  v := v || pg_temp.chk('P7e', 'audit append-only: UPDATE/DELETE/TRUNCATE ตรง → 42501 · แถวที่ action=update ไม่มี note ตรง → 23514 (CHECK ที่ตาราง) · service_role/anon/authenticated อ่านตรงไม่ได้',
    pg_temp.err('update analytics.gem_item_price_audit set note = null') = '42501|' and pg_temp.err('delete from analytics.gem_item_price_audit') = '42501|' and pg_temp.err('truncate analytics.gem_item_price_audit') = '42501|'
    and pg_temp.err(format('insert into analytics.gem_item_price_audit (shop_id, gem_item_id, effective_from, action, old_price, new_price, actor) values (%L, %L, %L, %L, 1, 2, %L)', a, it, today, 'update', pg_temp.own())) = '23514|'
    and not has_table_privilege('service_role', 'analytics.gem_item_price_audit', 'select') and not has_table_privilege('anon', 'analytics.gem_item_price_audit', 'select') and not has_table_privilege('authenticated', 'analytics.gem_item_price_audit', 'select')
    and pg_temp.asrole('service_role', 'select count(*) from analytics.gem_item_price_audit') = '42501');
  -- P7f: CHECK ที่ตาราง audit: insert ย้อนหลัง (ก่อนวันนี้ไทย) ไม่มี note → 23514 · insert วันนี้ไม่มี note ผ่าน · insert ย้อนหลังมี note ผ่าน (RPC ตรวจซ้ำอีกชั้น แต่กำแพงอยู่ที่ตาราง)
  v := v || pg_temp.chk('P7f', 'audit insert ย้อนหลังไม่มี note ตรง → 23514 · insert วันนี้ไม่มี note → OK · insert ย้อนหลังมี note → OK',
    pg_temp.err(format('insert into analytics.gem_item_price_audit (shop_id, gem_item_id, effective_from, action, new_price, actor) values (%L, %L, %L, %L, 2, %L)', a, it, today - 1, 'insert', pg_temp.own())) = '23514|'
    and pg_temp.err(format('insert into analytics.gem_item_price_audit (shop_id, gem_item_id, effective_from, action, new_price, actor) values (%L, %L, %L, %L, 2, %L)', a, it, today + 1, 'insert', pg_temp.own())) = 'OK'
    and pg_temp.err(format('insert into analytics.gem_item_price_audit (shop_id, gem_item_id, effective_from, action, new_price, note, actor) values (%L, %L, %L, %L, 2, %L, %L)', a, it, today - 2, 'insert', 'ย้อนหลัง', pg_temp.own())) = 'OK');
  delete from analytics.gem_item_price where gem_item_id = it2;

  -- P3: ผู้ทำรายการต้องเป็นสมาชิก owner/admin ของร้านจริง (staff / ไม่ใช่สมาชิก / ว่าง = ปฏิเสธ — แม้ผู้เรียกเป็น service_role) · admin ผ่าน
  ok := true;
  for row_ in select * from (values
    ('nom', pg_temp.nom()), ('stf', pg_temp.stf())
  ) as t(who, actor) loop
    for lst in select unnest(array[
        format('select analytics.gem_catalog_list(%L, %L, false)', a, row_.actor),
        format('select analytics.gem_price_set(%L, %L, %L, 10::numeric, null, null, null)', a, row_.actor, it2),
        format('select analytics.gem_price_history(%L, %L, %L)', a, row_.actor, it),
        format('select analytics.gem_catalog_create(%L, %L, %L, %L, null, false)', a, row_.actor, 'type', 'ทดสอบสิทธิ์'),
        format('select analytics.gem_item_create(%L, %L, %L::jsonb, false)', a, row_.actor, '{}'),
        format('select analytics.gem_catalog_rename(%L, %L, %L, %L, %L, false)', a, row_.actor, 'type', pg_temp.fx('tGem'), 'ทดสอบสิทธิ์'),
        format('select analytics.gem_catalog_set_active(%L, %L, %L, %L, true)', a, row_.actor, 'type', pg_temp.fx('tGem')),
        format('select analytics.gem_catalog_remove(%L, %L, %L, %L)', a, row_.actor, 'type', pg_temp.fx('tGem')),
        format('select analytics.gem_merge_preview(%L, %L, %L, %L, %L)', a, row_.actor, 'type', pg_temp.fx('tGem'), pg_temp.fx('tGemT')),
        format('select analytics.gem_merge(%L, %L, %L, %L, %L)', a, row_.actor, 'type', pg_temp.fx('tGem'), pg_temp.fx('tGemT')),
        format('select analytics.gem_shape_set_has_length(%L, %L, %L, true)', a, row_.actor, pg_temp.shp(a, 'ไข่'))]) loop
      if pg_temp.err(lst) <> '42501|gem_actor_forbidden' then
        ok := false; v := v || pg_temp.chk('P3-' || row_.who, 'ต้องปฏิเสธ gem_actor_forbidden แต่ได้ ' || pg_temp.err(lst) || ' : ' || left(lst, 60), false);
      end if;
    end loop;
  end loop;
  v := v || pg_temp.chk('P3', 'RPC แคตตาล็อก/ราคา 11 ตัว × (staff · ไม่ใช่สมาชิก) → 42501 gem_actor_forbidden ทั้งหมด (ราคาอ่าน/เขียนไม่ได้)', ok);
  v := v || pg_temp.chk('P3b', 'actor ว่าง → actor_required · admin ผ่าน gem_catalog_list · owner ผ่าน',
    pg_temp.err(format('select analytics.gem_price_history(%L, null, %L)', a, it)) = '22023|actor_required'
    and pg_temp.err(format('select analytics.gem_catalog_list(%L, %L, false)', a, pg_temp.adm())) = 'OK'
    and pg_temp.err(format('select analytics.gem_catalog_list(%L, %L, false)', a, pg_temp.own())) = 'OK');
  v := v || pg_temp.chk('P3c', 'owner ของร้าน A ใช้กับร้าน B ไม่ได้ (ไม่ใช่สมาชิก B) · owner ร้าน B ใช้ร้านตัวเองได้',
    pg_temp.err(format('select analytics.gem_catalog_list(%L, %L, false)', b, pg_temp.own())) = '42501|gem_actor_forbidden'
    and pg_temp.err(format('select analytics.gem_catalog_list(%L, %L, false)', b, pg_temp.stf())) = 'OK');

  return v;
end;
$c$;

-- รวมผลสแกนราคารั่วของพื้นผิวที่ไม่ใช่ราคา (เรียกหลังมีข้อมูลครบ: แม่แบบ + ใบ + ช่าง)
create function pg_temp.g_leak() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A');
  j uuid := pg_temp.fx('J1');
  it uuid := pg_temp.fx('iGemOval');
  jm jsonb; items jsonb := '{}'::jsonb; k text; bad text := ''; badk text := ''; r jsonb; po uuid; ri jsonb;
begin
  -- ผลของ RPC/วิว/ตาราง/event ที่ผู้จัดการ-ช่าง-ฟอร์ม-ใบพิมพ์ถึง — ทุกอันต้องไม่มีตัวเลขราคา
  po := pg_temp.po(a, 'leak');
  ri := pg_temp.iset(a, po, pg_temp.fx('pA1'), 2);
  items := jsonb_build_object(
    'options', pg_temp.olist(a),
    'job_get', pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, j)),
    'tpl_get', pg_temp.q(format('select analytics.product_gem_bom_get(%L, %L)', a, pg_temp.fx('pA1'))),
    'bset', pg_temp.bset(a, j, jsonb_build_array(jsonb_build_object('gem_item_id', it, 'qty_per_piece', 2, 'position', 'บ่าซ้าย-ขวา')), pg_temp.own()),
    'tset', pg_temp.tset(a, pg_temp.fx('pA1'), pg_temp.tpl_lines(a, pg_temp.fx('pA1')), pg_temp.own()),
    'plan', pg_temp.q(format('select analytics.job_plan_suggest(%L, %L, %L)', a, 'production', ri ->> 'id')),
    'stage', pg_temp.q(format('select analytics.job_stage_suggest(%L, %L, %L)', a, 'production', ri ->> 'id')),
    'resolve', pg_temp.w_res(pg_temp.kv('tokh_J1'), pg_temp.kv('sW')),
    'resolve_nopin', pg_temp.w_res(pg_temp.kv('tokh_J1'), null),
    'mkjob', (select jsonb_agg(res) from (select pg_temp.mkjob(a, pg_temp.fx('pA1'), pg_temp.stdg()) -> 'res' as res) x),
    'v_job', coalesce((select jsonb_agg(to_jsonb(x)) from analytics.v_job_gem_requirement x where x.shop_id = a), '[]'::jsonb),
    'v_prod', coalesce((select jsonb_agg(to_jsonb(x)) from analytics.v_product_gem_bom x where x.shop_id = a), '[]'::jsonb),
    'tbl_job_bom', coalesce((select jsonb_agg(to_jsonb(x)) from analytics.job_gem_bom x where x.shop_id = a), '[]'::jsonb),
    'tbl_prod_bom', coalesce((select jsonb_agg(to_jsonb(x)) from analytics.product_gem_bom x where x.shop_id = a), '[]'::jsonb),
    'tbl_item', coalesce((select jsonb_agg(to_jsonb(x)) from analytics.gem_item x where x.shop_id = a), '[]'::jsonb),
    'tbl_type', coalesce((select jsonb_agg(to_jsonb(x)) from analytics.gem_type x where x.shop_id = a), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(x)) from analytics.job_event x where x.shop_id = a), '[]'::jsonb),
    'cat_events', coalesce((select jsonb_agg(to_jsonb(x)) from analytics.gem_catalog_event x where x.shop_id = a), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(to_jsonb(x)) from analytics.catalog_audit_log x where x.shop_id = a), '[]'::jsonb));
  for k in select jsonb_object_keys(items) loop
    if pg_temp.has_px(items -> k) then bad := bad || k || ','; end if;
  end loop;
  -- key ที่ดูเป็นราคา/ต้นทุนในผลของ RPC ที่ช่าง/ฟอร์มถึง (ไม่รวม stage_suggest/plan ที่มี key เดิมของ J1 เช่น deposit_missing — เทียบเฉพาะ gem_*)
  for k in select unnest(array['options', 'job_get', 'tpl_get', 'bset', 'tset', 'resolve', 'v_job', 'v_prod', 'tbl_job_bom', 'tbl_prod_bom', 'tbl_item', 'tbl_type']) loop
    if pg_temp.badkeys(items -> k) <> '' then badk := badk || k || '[' || pg_temp.badkeys(items -> k) || '],'; end if;
  end loop;
  if pg_temp.badkeys(items -> 'plan' -> 'gem_bom') <> '' then badk := badk || 'plan.gem_bom,'; end if;
  v := v || pg_temp.chk('P5', '🔴 เลขราคา 7391.2468 ไม่ปรากฏในผลของ RPC/วิว/ตาราง/event ที่ไม่ใช่ราคาทั้ง 18 พื้นผิว (รายการ dropdown · BOM · แม่แบบ · plan/stage suggest · create ใบ · resolve หลัง/ก่อน PIN · วิว · event · audit) · พื้นผิวที่รั่ว: ' || coalesce(nullif(bad, ''), 'ไม่มี'), bad = '');
  v := v || pg_temp.chk('P5b', 'ไม่มี key ที่ดูเป็นราคา/ต้นทุน/ผู้ขาย/tier ในผลเหล่านั้น: ' || coalesce(nullif(badk, ''), 'ไม่มี'), badk = '');
  -- ราคายังอยู่ที่ตารางราคา (ไม่ได้หายไปเฉยๆ — ต้องเห็นได้ทาง RPC ราคา)
  v := v || pg_temp.chk('P5c', 'ราคายังอ่านได้ทาง RPC ราคา (gem_catalog_list) — ตรวจว่าเทสต์รั่วมีความหมาย (ถ้าราคาไม่อยู่ที่ไหนเลย การไม่เจอไม่พิสูจน์อะไร)',
    position('7391.2468' in pg_temp.clist(a)::text) > 0);
  -- P6: สิทธิ์ตาราง: ไม่มี role ไหนอ่านตารางราคาตรง
  v := v || pg_temp.chk('P6', 'ตาราง gem_item_price: service_role/anon/authenticated อ่านตรงไม่ได้ (has_table_privilege) · ตารางไม่มีราคา (gem_item/job_gem_bom/product_gem_bom) service_role อ่านได้อย่างเดียว',
    not has_table_privilege('service_role', 'analytics.gem_item_price', 'select') and not has_table_privilege('anon', 'analytics.gem_item_price', 'select') and not has_table_privilege('authenticated', 'analytics.gem_item_price', 'select')
    and has_table_privilege('service_role', 'analytics.job_gem_bom', 'select') and not has_table_privilege('service_role', 'analytics.job_gem_bom', 'insert')
    and not has_table_privilege('service_role', 'analytics.gem_item', 'update') and not has_table_privilege('service_role', 'analytics.product_gem_bom', 'delete'));
  r := jsonb_build_object('sr', pg_temp.asrole('service_role', 'select count(*) from analytics.gem_item_price'),
    'sr_ins', pg_temp.asrole('service_role', format('insert into analytics.job_gem_bom (shop_id, job_id, line_seq, gem_item_id, gem_label, qty_per_piece, source) values (%L, %L, 9, %L, %L, 1, %L)', a, j, it, 'ทดสอบ · ทดสอบ · 1 มม.', 'manual')));
  v := v || pg_temp.chk('P6a', 'ยิงจริงในฐานะ service_role: SELECT gem_item_price → 42501 · INSERT job_gem_bom ตรง → 42501', r ->> 'sr' = '42501' and r ->> 'sr_ins' = '42501');
  v := v || pg_temp.chk('P6b', 'view พลอยไม่มีคอลัมน์ราคา/ต้นทุน/ผู้ขาย',
    not exists (select 1 from information_schema.columns where table_schema = 'analytics' and table_name in ('v_job_gem_requirement', 'v_product_gem_bom') and column_name ~* '(price|cost|thb|supplier)'));
  return v;
end;
$c$;

-- ============================================================================
-- E. แม่แบบพลอยของ SKU + คัดลอกเข้าใบ + ขั้นฝังจากแม่แบบ + plan/stage suggest + ตั้งเป็นแม่แบบจากใบ
-- ============================================================================
create function pg_temp.g_tpl() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A');
  oval uuid := pg_temp.shp(a, 'ไข่');
  rnd uuid := pg_temp.shp(a, 'กลม');
  tgem uuid := pg_temp.fx('tGem');
  p1 uuid := pg_temp.fx('pA1');
  r jsonb; r2 jsonb; j jsonb; po uuid; ri jsonb; sj text; n0 int; nj0 int; s0 text; ca0 int; tb int;
  jt jsonb;
begin
  -- T1: ตั้งแม่แบบ (พิมพ์ชนิดใหม่ "ทับทิม" + รูปทรงกลมที่มี) · audit · อ่านกลับ
  select count(*) into ca0 from analytics.catalog_audit_log where product_id = p1;
  r := pg_temp.tset(a, p1, format('[{"type_id":"%s","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":2,"position":"บ่าซ้าย-ขวา"},{"new_type_name":"ทับทิม","shape_id":"%s","size_a":1.5,"qty_per_piece":30,"position":"ล้อมรอบ"}]', tgem, oval, rnd)::jsonb, pg_temp.own());
  perform pg_temp.setfx('tRuby', pg_temp.typ(a, 'ทับทิม'));
  perform pg_temp.setfx('iRuby', (select id from analytics.gem_item where gem_type_id = pg_temp.fx('tRuby') and size_a = 1.5));
  v := v || pg_temp.chk('T1', 'ตั้งแม่แบบ SKU: 2 แถว (โกเมนไข่ 4×6 ×2 · ทับทิมกลม 1.5 ×30) · ชนิด "ทับทิม" เข้าแคตตาล็อกเอง · catalog_audit_log เพิ่ม 1 (action edit · before ว่าง after 2 แถว) · อ่านกลับตรง',
    r ->> '_err' is null and r ->> 'changed' = 'true' and (select count(*) from analytics.product_gem_bom where product_id = p1) = 2 and pg_temp.fx('tRuby') is not null
    and (select count(*) from analytics.catalog_audit_log where product_id = p1) = ca0 + 1
    and (select action from analytics.catalog_audit_log where product_id = p1 order by changed_at desc, id desc limit 1) = 'edit'
    and (select jsonb_array_length(after -> 'gem_bom') from analytics.catalog_audit_log where product_id = p1 order by changed_at desc, id desc limit 1) = 2
    and (select jsonb_array_length(before -> 'gem_bom') from analytics.catalog_audit_log where product_id = p1 order by changed_at desc, id desc limit 1) = 0
    and (pg_temp.q(format('select analytics.product_gem_bom_get(%L, %L)', a, p1)) -> 'lines' -> 1 ->> 'label') = 'ทับทิม · กลม · 1.5 มม.');
  r := pg_temp.tset(a, p1, pg_temp.tpl_lines(a, p1), pg_temp.own());
  v := v || pg_temp.chk('T1b', 'ตั้งซ้ำค่าเดิมทุกอย่าง → changed=false · audit ไม่เพิ่ม (รูปแบบ line จาก get ส่งกลับได้ตรง)', r ->> '_err' is null and r ->> 'changed' = 'false' and (select count(*) from analytics.catalog_audit_log where product_id = p1) = ca0 + 1);
  v := v || pg_temp.chk('T1c', 'SKU ของร้านอื่น / ไม่พบ → gem_product_invalid · actor ว่าง → actor_required · แถวพลอยผิด → ปฏิเสธเหมือนใบ (qty 0) · ไม่เขียนอะไร',
    pg_temp.hint(pg_temp.tset(a, pg_temp.fx('pB1'), '[]'::jsonb)) = '22023|gem_product_invalid'
    and pg_temp.err(format('select analytics.product_gem_bom_set(%L, %L, %L::jsonb, null, false)', a, p1, '[]')) = '22023|actor_required'
    and pg_temp.hint(pg_temp.tset(a, p1, format('[{"type_id":"%s","shape_id":"%s","size_a":2,"qty_per_piece":0}]', tgem, rnd)::jsonb)) = '22023|qty_invalid'
    and (select count(*) from analytics.product_gem_bom where product_id = p1) = 2);
  -- T1d: รายการที่ปิดใช้งานแล้ว: แถวเดิมในแม่แบบส่งซ้ำได้ · เพิ่มแถวใหม่ที่อ้างรายการปิดไม่ได้
  r := pg_temp.sact(a, 'item', pg_temp.fx('iRuby'), false);
  r2 := pg_temp.tset(a, p1, pg_temp.tpl_lines(a, p1), pg_temp.own());
  v := v || pg_temp.chk('T1d', 'รายการที่ปิดใช้งาน: แถวเดิมในแม่แบบส่งซ้ำได้ (changed=false) · SKU อื่นเพิ่มรายการที่ปิด → gem_inactive',
    r ->> '_err' is null and r2 ->> '_err' is null and r2 ->> 'changed' = 'false'
    and pg_temp.hint(pg_temp.tset(a, pg_temp.fx('pA2'), jsonb_build_array(jsonb_build_object('gem_item_id', pg_temp.fx('iRuby'), 'qty_per_piece', 1)))) = '22023|gem_inactive');
  r := pg_temp.sact(a, 'item', pg_temp.fx('iRuby'), true);

  -- T2: ใบใหม่ที่มีขั้นฝัง + ไม่ส่ง p_gem_lines → คัดลอกแม่แบบ SKU (source product) · event bom_change phase create · ผลคืน gem_source
  j := pg_temp.mkjob(a, p1, pg_temp.stdg());
  jt := j -> 'res';
  v := v || pg_temp.chk('T2', 'สร้างใบ (ขั้นฝังมี · ไม่ส่งพลอย) → คัดลอกแม่แบบ 2 แถว source=product · ฉลาก/จำนวน/ตำแหน่งตรง · gem_source=template · event bom_change phase=create 1 ครั้ง',
    j ->> 'err' is null and (jt ->> 'gem_lines') = '2' and jt ->> 'gem_source' = 'template' and pg_temp.n_bom((j ->> 'job')::uuid) = 2
    and (select count(*) from analytics.job_gem_bom where job_id = (j ->> 'job')::uuid and source = 'product') = 2
    and (select gem_label from analytics.job_gem_bom where job_id = (j ->> 'job')::uuid and line_seq = 2) = 'ทับทิม · กลม · 1.5 มม.'
    and (select qty_per_piece from analytics.job_gem_bom where job_id = (j ->> 'job')::uuid and line_seq = 2) = 30
    and pg_temp.n_ev((j ->> 'job')::uuid) = 1 and (select payload ->> 'phase' from analytics.job_event where job_id = (j ->> 'job')::uuid and event_type = 'bom_change') = 'create');
  perform pg_temp.setfx('jT', (j ->> 'job')::uuid);
  -- T2b: แก้แม่แบบทีหลัง → ใบที่เปิดแล้วไม่เปลี่ยน
  s0 := (select md5(string_agg(b::text, '|' order by b.id)) from analytics.job_gem_bom b where b.job_id = pg_temp.fx('jT'));
  r := pg_temp.tset(a, p1, format('[{"type_id":"%s","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":9}]', tgem, oval)::jsonb, pg_temp.own());
  v := v || pg_temp.chk('T2b', 'แก้แม่แบบ (เหลือ 1 แถว qty 9) → ใบที่เปิดแล้วไม่เปลี่ยน (job_gem_bom ของใบเดิม md5 เท่าเดิม)', r ->> '_err' is null and s0 = (select md5(string_agg(b::text, '|' order by b.id)) from analytics.job_gem_bom b where b.job_id = pg_temp.fx('jT')));
  r := pg_temp.tset(a, p1, format('[{"type_id":"%s","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":2,"position":"บ่าซ้าย-ขวา"},{"type_id":"%s","shape_id":"%s","size_a":1.5,"qty_per_piece":30,"position":"ล้อมรอบ"}]', tgem, oval, pg_temp.fx('tRuby'), rnd)::jsonb, pg_temp.own());

  -- T3: ใบที่ไม่มีขั้นฝัง → ระบบไม่เพิ่มขั้นให้ และไม่คัดลอกแม่แบบ
  j := pg_temp.mkjob(a, p1, pg_temp.std());
  v := v || pg_temp.chk('T3', 'สร้างใบจาก SKU ที่มีแม่แบบแต่ "ไม่มีขั้นฝัง" → ไม่มี BOM · ไม่มีขั้น gem_set ในใบ (ระบบไม่เพิ่มให้) · gem_source=none',
    j ->> 'err' is null and pg_temp.n_bom((j ->> 'job')::uuid) = 0 and (j -> 'res' ->> 'gem_lines') = '0' and j -> 'res' ->> 'gem_source' = 'none'
    and not exists (select 1 from analytics.job_stage where job_id = (j ->> 'job')::uuid and stage_code = 'gem_set'));
  -- T4: p_gem_lines = [] = ระบุว่าไม่มีพลอย (ไม่คัดลอกแม่แบบ แม้มีขั้นฝัง)
  j := pg_temp.mkjob(a, p1, pg_temp.stdg(), '[]'::jsonb);
  v := v || pg_temp.chk('T4', 'ส่ง p_gem_lines = [] (มีขั้นฝัง · SKU มีแม่แบบ) → ไม่คัดลอก · BOM ว่าง · gem_source=none_explicit · ไม่มี event bom_change',
    j ->> 'err' is null and pg_temp.n_bom((j ->> 'job')::uuid) = 0 and j -> 'res' ->> 'gem_source' = 'none_explicit' and pg_temp.n_ev((j ->> 'job')::uuid) = 0);

  -- T5: สร้างใบพร้อมพลอยที่พิมพ์เอง (SKU ไม่มีแม่แบบ) — ชื่อใหม่เข้าแคตตาล็อกในทรานแซกชันเดียวกับใบ · ล้ม = ไม่เกิดทั้งใบและชื่อ
  n0 := pg_temp.n_type(a);
  j := pg_temp.mkjob(a, pg_temp.fx('pA2'), pg_temp.stdg(), format('[{"new_type_name":"ซิทริน","shape_id":"%s","size_a":2,"qty_per_piece":4,"position":"บนหัวแหวน"}]', rnd)::jsonb);
  v := v || pg_temp.chk('T5', 'สร้างใบพร้อมพลอยที่พิมพ์ชนิดใหม่ "ซิทริน" → ใบเกิด + ชนิดเข้าแคตตาล็อก (ทรานแซกชันเดียว) · BOM 1 แถว source=manual · gem_source=input · created_by = ผู้เปิด',
    j ->> 'err' is null and pg_temp.n_type(a) = n0 + 1 and pg_temp.n_bom((j ->> 'job')::uuid) = 1 and j -> 'res' ->> 'gem_source' = 'input'
    and (select source from analytics.job_gem_bom where job_id = (j ->> 'job')::uuid) = 'manual' and (j -> 'res' -> 'gem_summary' -> 'created_types' -> 0 ->> 'name') = 'ซิทริน');
  perform pg_temp.setfx('tCit', pg_temp.typ(a, 'ซิทริน'));
  n0 := pg_temp.n_type(a);
  select count(*) into nj0 from analytics.job where shop_id = a;
  s0 := pg_temp.gsnap(a);
  tb := (select last_no from analytics.job_counter where shop_id = a);
  j := pg_temp.mkjob(a, pg_temp.fx('pA2'), pg_temp.stdg(), format('[{"new_type_name":"ซิทริ","shape_id":"%s","size_a":2,"qty_per_piece":4}]', rnd)::jsonb);
  v := v || pg_temp.chk('T5b', 'ตัวดักคล้ายตอนสร้างใบ ("ซิทริ" ↔ "ซิทริน") ไม่ส่ง force → gem_similar · ไม่เกิดใบ · ตัวนับเลขใบไม่ขยับ · ชนิดไม่เพิ่ม (ทรานแซกชันเดียว)',
    j ->> 'hint' = 'gem_similar' and (select count(*) from analytics.job where shop_id = a) = nj0 and (select last_no from analytics.job_counter where shop_id = a) = tb and pg_temp.n_type(a) = n0);
  j := pg_temp.mkjob(a, pg_temp.fx('pA2'), pg_temp.stdg(), format('[{"new_type_name":"ซิทริ","shape_id":"%s","size_a":2,"qty_per_piece":4}]', rnd)::jsonb, true);
  v := v || pg_temp.chk('T5c', 'ส่ง p_gem_force=true → ใบเกิดและชนิด "ซิทริ" เข้าแคตตาล็อก', j ->> 'err' is null and pg_temp.n_type(a) = n0 + 1);
  j := pg_temp.mkjob(a, pg_temp.fx('pA2'), pg_temp.stdg(), format('[{"type_id":"%s","shape_id":"%s","size_a":2,"qty_per_piece":0}]', tgem, rnd)::jsonb);
  v := v || pg_temp.chk('T5d', 'แถวพลอยผิด (qty 0) ตอนสร้างใบ → ปฏิเสธ qty_invalid · ไม่เกิดใบ (พลอยผิด = ไม่เปิดเลย)', j ->> 'hint' = 'qty_invalid' and (select count(*) from analytics.job where shop_id = a) = nj0 + 1);
  j := pg_temp.mkjob(a, pg_temp.fx('pA2'), pg_temp.std(), '"ไม่ใช่ array"'::jsonb);
  v := v || pg_temp.chk('T5e', 'p_gem_lines ไม่ใช่ array → ปฏิเสธ lines_invalid', j ->> 'hint' = 'lines_invalid');

  -- T6: plan/stage suggest: SKU ที่มีแม่แบบ → แถวแม่แบบ (ไม่มีราคา) + ขั้นฝังถูกเสนอ · SKU ไม่มีแม่แบบ → ว่าง + ไม่มีขั้นฝัง (golden ผลเดิม)
  po := pg_temp.po(a, 'v190-sug');
  ri := pg_temp.iset(a, po, p1, 2);
  r := pg_temp.q(format('select analytics.job_plan_suggest(%L, %L, %L, 5)', a, 'production', ri ->> 'id'));
  r2 := pg_temp.q(format('select analytics.job_stage_suggest(%L, %L, %L)', a, 'production', ri ->> 'id'));
  v := v || pg_temp.chk('T6a', 'SKU มีแม่แบบ: job_stage_suggest เสนอ gem_set (default_selected) · gem_template_count=2 · job_plan_suggest.gem_bom 2 แถว มี qty_total = ต่อชิ้น × จำนวนเริ่มผลิต (5)',
    (r2 -> 'suggested_stage_codes') ? 'gem_set' and (r2 ->> 'gem_template_count') = '2'
    and exists (select 1 from jsonb_array_elements(r2 -> 'stages') s where s ->> 'code' = 'gem_set' and (s ->> 'default_selected')::boolean)
    and jsonb_array_length(r -> 'gem_bom') = 2 and (r -> 'gem_bom' -> 0 ->> 'qty_total') = '10' and (r -> 'gem_bom' -> 1 ->> 'qty_total') = '150' and (r ->> 'gem_template_count') = '2'
    and (r -> 'gem_bom' -> 0 ->> 'label') = 'โกเมน · ไข่ · 4×6 มม.');
  po := pg_temp.po(a, 'v190-sug2');
  ri := pg_temp.iset(a, po, pg_temp.fx('pA3'), 2);
  r := pg_temp.q(format('select analytics.job_plan_suggest(%L, %L, %L, 5)', a, 'production', ri ->> 'id'));
  r2 := pg_temp.q(format('select analytics.job_stage_suggest(%L, %L, %L)', a, 'production', ri ->> 'id'));
  v := v || pg_temp.chk('T6b', 'SKU ไม่มีแม่แบบ: ไม่เสนอ gem_set (รายการขั้นเดิม 9 ขั้น) · gem_bom = [] · gem_template_count=0',
    not ((r2 -> 'suggested_stage_codes') ? 'gem_set') and jsonb_array_length(r2 -> 'suggested_stage_codes') = 9 and (r2 ->> 'gem_template_count') = '0' and r -> 'gem_bom' = '[]'::jsonb);

  -- T7: "ตั้งเป็นแม่แบบ SKU" จากพลอยของใบ (SKU ต้องมี) · ใบไม่มี SKU = no_product
  j := pg_temp.mkjob(a, pg_temp.fx('pA3'), pg_temp.stdg(), format('[{"type_id":"%s","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":3,"position":"ซ้าย"},{"type_id":"%s","shape_id":"%s","size_a":1.5,"qty_per_piece":12}]', tgem, oval, pg_temp.fx('tRuby'), rnd)::jsonb);
  r := pg_temp.q(format('select analytics.product_gem_bom_from_job(%L, %L, %L)', a, j ->> 'job', pg_temp.own()));
  v := v || pg_temp.chk('T7', 'ตั้งเป็นแม่แบบจากใบ → SKU ของใบมีแม่แบบ 2 แถว ตรงพลอยของใบ (qty 3 · 12) · มี audit',
    r ->> '_err' is null and r ->> 'changed' = 'true' and (select count(*) from analytics.product_gem_bom where product_id = pg_temp.fx('pA3')) = 2
    and (select qty_per_piece from analytics.product_gem_bom where product_id = pg_temp.fx('pA3') order by line_seq limit 1) = 3
    and exists (select 1 from analytics.catalog_audit_log where product_id = pg_temp.fx('pA3') and action = 'edit'));
  po := pg_temp.po(a, 'v190-nosku');
  ri := pg_temp.iset(a, po, null, 2, 'แบบไม่มีรหัส', 'silver');
  j := pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L)', a, ri ->> 'id', pg_temp.std(), pg_temp.nom()));
  v := v || pg_temp.chk('T7b', 'ใบที่ไม่มี SKU → ตั้งเป็นแม่แบบไม่ได้ (no_product)', j ->> '_err' is null and pg_temp.hint(pg_temp.q(format('select analytics.product_gem_bom_from_job(%L, %L, %L)', a, j ->> 'job_id', pg_temp.own()))) = '22023|no_product');
  -- ทำให้ pA3 กลับไม่มีแม่แบบ (ใช้ต่อเป็น "SKU ไม่มีแม่แบบ" ที่อื่น)
  r := pg_temp.tset(a, pg_temp.fx('pA3'), '[]'::jsonb, pg_temp.own());
  v := v || pg_temp.chk('T7c', 'ล้างแม่แบบ ([]) → แม่แบบว่าง · changed=true · ล้างซ้ำ changed=false', r ->> 'changed' = 'true' and (select count(*) from analytics.product_gem_bom where product_id = pg_temp.fx('pA3')) = 0
    and pg_temp.tset(a, pg_temp.fx('pA3'), '[]'::jsonb, pg_temp.own()) ->> 'changed' = 'false');
  return v;
end;
$c$;
-- ============================================================================
-- F. แก้พลอยของใบ: หน้าต่างแก้ (ก่อนเริ่ม · ขั้นอื่นรับแล้ว · ขั้นฝังรับแล้ว = เหตุผลบังคับ · ปิด/ยกเลิก = ล็อก) + getter + ประวัติ
-- ============================================================================
create function pg_temp.g_job() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A');
  b uuid := pg_temp.fx('B');
  oval uuid := pg_temp.shp(a, 'ไข่');
  rnd uuid := pg_temp.shp(a, 'กลม');
  tgem uuid := pg_temp.fx('tGem');
  j jsonb; jid uuid; r jsonb; r2 jsonb; ln1 jsonb; ln2 jsonb; s0 text; cd text; n0 int; ok boolean; reason text; jd uuid; jc uuid;
  d_lines jsonb;
begin
  ln1 := jsonb_build_array(jsonb_build_object('type_id', tgem, 'shape_id', oval, 'size_a', 4, 'size_b', 6, 'qty_per_piece', 2, 'position', 'บ่า'));
  ln2 := jsonb_build_array(jsonb_build_object('type_id', tgem, 'shape_id', oval, 'size_a', 4, 'size_b', 6, 'qty_per_piece', 3, 'position', 'บ่า'));
  j := pg_temp.mkjob(a, pg_temp.fx('pA4'), pg_temp.stdg(), ln1);
  jid := (j ->> 'job')::uuid;
  perform pg_temp.setfx('J2', jid);
  r := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jid));
  v := v || pg_temp.chk('J1w', 'ใบใหม่ที่ยังไม่มีขั้นใดถูกรับ: window=free_before_start · state=specified · gem_stage=pending · BOM 1 แถว qty_total = 2 × จำนวนเริ่มผลิต 3 = 6',
    r ->> 'window' = 'free_before_start' and r ->> 'state' = 'specified' and r ->> 'gem_stage' = 'pending' and (r -> 'lines' -> 0 ->> 'qty_total') = '6');
  -- ช่างรับ+ส่งขั้นแรก → ออฟฟิศแก้ได้โดยไม่ต้องเหตุผล (window = office_free)
  cd := pg_temp.step(a, jid, true);
  r := pg_temp.bset(a, jid, ln2, pg_temp.own());
  v := v || pg_temp.chk('J2', 'ขั้นแรกส่งต่อแล้ว (ก่อนขั้นฝัง) → window=office_free · ออฟฟิศแก้พลอยได้โดยไม่ต้องเหตุผล · event phase=office_free',
    cd = 'wax_inject' and r ->> '_err' is null and r ->> 'window' = 'office_free' and r ->> 'changed' = 'true'
    and exists (select 1 from analytics.job_event where job_id = jid and event_type = 'bom_change' and payload ->> 'phase' = 'office_free'));
  -- ไปถึงขั้นฝัง แล้วรับขั้นฝัง
  perform pg_temp.walk_to(a, jid, 'gem_set');
  r := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jid));
  v := v || pg_temp.chk('J3pre', 'ส่งทุกขั้นก่อนขั้นฝังแล้ว (ขั้นฝังยัง pending) → window ยัง office_free · gem_stage=pending', r ->> 'window' = 'office_free' and r ->> 'gem_stage' = 'pending');
  cd := pg_temp.step(a, jid, false);
  r := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jid));
  v := v || pg_temp.chk('J3w', 'ช่างรับขั้นฝัง (gem_set received) → window=reason_required · gem_stage=started', cd = 'gem_set' and r ->> 'window' = 'reason_required' and r ->> 'gem_stage' = 'started');
  s0 := pg_temp.gsnap(a);
  r := pg_temp.bset(a, jid, ln1, pg_temp.own());
  v := v || pg_temp.chk('J3a', 'หลังขั้นฝังรับ แก้พลอยโดยไม่มีเหตุผล → ปฏิเสธ reason_required · ไม่เขียนอะไร', pg_temp.hint(r) = '22023|reason_required' and pg_temp.gsnap(a) = s0);
  ok := true;
  foreach reason in array array['', ' ', E'​', '.', '👍', E'\u0085', E'⠀', '<b>', '-', E' '] loop
    r := pg_temp.bset(a, jid, ln1, pg_temp.own(), reason);
    if pg_temp.hint(r) <> '22023|reason_required' then ok := false; v := v || pg_temp.chk('J3b-' || md5(reason), format('เหตุผล %L ต้องถูกปฏิเสธ reason_required แต่ได้ %s', reason, pg_temp.hint(r)), false); end if;
  end loop;
  v := v || pg_temp.chk('J3b', 'เหตุผลที่ไม่มีตัวอักษร/ตัวเลขจริง (ว่าง · ช่องว่าง · ล่องหน · "." · อีโมจิ · NEL · U+2800 · < > · "-" · NBSP) ต้องถูกปฏิเสธ — whitelist oem_note_present', ok);
  r := pg_temp.bset(a, jid, ln1, pg_temp.own(), 'พลอยแตก เปลี่ยนเป็น 2 เม็ด');
  v := v || pg_temp.chk('J3c', 'เหตุผลที่มีตัวอักษรจริง → ผ่าน · event phase=reason_required มี reason และ before/after (ฉลาก+จำนวน — ไม่มีราคา)',
    r ->> '_err' is null and r ->> 'changed' = 'true'
    and exists (select 1 from analytics.job_event where job_id = jid and event_type = 'bom_change' and payload ->> 'phase' = 'reason_required' and payload ->> 'reason' = 'พลอยแตก เปลี่ยนเป็น 2 เม็ด'
                  and (payload -> 'before' -> 0 ->> 'qty_per_piece') = '3' and (payload -> 'after' -> 0 ->> 'qty_per_piece') = '2'));
  r := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jid));
  v := v || pg_temp.chk('J3d', 'job_gem_bom_get: history 3 รายการ (create · office_free · reason_required) · มีรายการที่มีเหตุผลและ before/after (เรียงตามเวลาจริง — ในทรานแซกชันทดสอบ now() เท่ากัน จึงไม่ตรวจลำดับ)', jsonb_array_length(r -> 'history') = 3 and exists (select 1 from jsonb_array_elements(r -> 'history') h where h ->> 'reason' = 'พลอยแตก เปลี่ยนเป็น 2 เม็ด' and h ->> 'phase' = 'reason_required' and jsonb_array_length(h -> 'before') = 1));
  r := pg_temp.bset(a, jid, ln1, pg_temp.own(), 'x');
  v := v || pg_temp.chk('J3e', 'เหตุผลสั้นแต่มีตัวอักษรจริง ("x") → ผ่านได้ (ต้องไม่พัง — เกณฑ์คือตัวอักษรจริง ไม่ใช่ความยาว) · ค่าเดิมไม่เปลี่ยน = changed=false', r ->> '_err' is null and r ->> 'changed' = 'false');

  -- ใบที่ยกเลิก = ล็อก: RPC ปฏิเสธ + กำแพงที่ตาราง (insert/update/delete ตรง)
  j := pg_temp.mkjob(a, pg_temp.fx('pA4'), pg_temp.stdg(), ln1);
  jc := (j ->> 'job')::uuid;
  perform analytics.job_cancel(a, jc, 'verify 0190 ยกเลิกเพื่อทดสอบล็อก', pg_temp.nom());
  s0 := pg_temp.gsnap(a);
  r := pg_temp.bset(a, jc, ln2, pg_temp.own());
  v := v || pg_temp.chk('J4a', 'ใบ cancelled: แก้พลอยผ่าน RPC → ปฏิเสธ job_closed · ไม่เขียนอะไร', pg_temp.hint(r) = '22023|job_closed' and pg_temp.gsnap(a) = s0);
  v := v || pg_temp.chk('J4b', 'ใบ cancelled: UPDATE job_gem_bom ตรง (qty) → job_closed',
    pg_temp.err(format('update analytics.job_gem_bom set qty_per_piece = 9 where job_id = %L', jc)) = '22023|job_closed');
  v := v || pg_temp.chk('J4c', 'ใบ cancelled: DELETE job_gem_bom ตรง → job_closed', pg_temp.err(format('delete from analytics.job_gem_bom where job_id = %L', jc)) = '22023|job_closed');
  v := v || pg_temp.chk('J4d', 'ใบ cancelled: INSERT job_gem_bom ตรง → job_closed (กำแพงที่ตาราง แม้ RPC ถูกแก้ผิด)',
    pg_temp.err(format('insert into analytics.job_gem_bom (shop_id, job_id, line_seq, gem_item_id, gem_label, qty_per_piece, source) values (%L, %L, 5, %L, %L, 1, %L)',
      a, jc, pg_temp.fx('iGemOval'), 'โกเมน · ไข่ · 4×6 มม.', 'manual')) = '22023|job_closed');
  perform pg_temp.setfx('Jc', jc);
  v := v || pg_temp.chk('J4e', 'ใบที่ยกเลิกยังอ่านพลอยได้ (job_gem_bom_get) — อ่านอย่างเดียว · window=closed', pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jc)) ->> 'window' = 'closed'
    and jsonb_array_length(pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jc)) -> 'lines') = 1);

  -- ร้านอื่น/ผู้ทำรายการว่าง
  r := pg_temp.bset(b, pg_temp.fx('J1'), ln1, pg_temp.stf());
  v := v || pg_temp.chk('J5a', 'ใบของร้าน A แก้ผ่านร้าน B → ปฏิเสธ job_not_found (ไม่รู้ว่าใบมีจริง)', pg_temp.hint(r) = '22023|job_not_found');
  v := v || pg_temp.chk('J5b', 'ไม่มีผู้ทำรายการ → actor_required · getter ใบร้านอื่น → job_not_found',
    pg_temp.err(format('select analytics.job_gem_bom_set(p_shop_id=>%L, p_job_id=>%L, p_gem_lines=>%L::jsonb, p_actor=>null)', a, pg_temp.fx('J1'), '[]')) = '22023|actor_required'
    and pg_temp.err(format('select analytics.job_gem_bom_get(%L, %L)', b, pg_temp.fx('J1'))) = '22023|job_not_found');

  -- ใบที่ปิดจริง (done): ข้ามทุกขั้นแล้วปิด — ถ้า RPC เดิมไม่ยอมให้ทำ = SKIP (ไม่เดา)
  j := pg_temp.mkjob(a, pg_temp.fx('pA4'), pg_temp.stdg(), ln1, false, 2);
  jd := (j ->> 'job')::uuid;
  begin
    loop
      exit when pg_temp.step(a, jd, true) is null;   -- รับ+ส่งทุกขั้นตามจริง (QC/แพ็กข้ามไม่ได้)
    end loop;
    perform analytics.job_done(a, jd, 2, 0, null, null, pg_temp.nom());
    ok := (select status from analytics.job where id = jd) = 'done';
  exception when others then
    ok := false;
    v := v || pg_temp.skip('J6', 'ทำใบ done จริงไม่ได้ในชุดนี้ (' || sqlerrm || ') — ใช้ cancelled แทนเป็นตัวแทนของ "ใบปิดแล้ว" (J4)');
  end;
  if ok then
    s0 := pg_temp.gsnap(a);
    v := v || pg_temp.chk('J6', 'ใบ done จริง: แก้พลอยผ่าน RPC → job_closed · DELETE/UPDATE ตรง → job_closed · ไม่เขียนอะไร',
      pg_temp.hint(pg_temp.bset(a, jd, ln2, pg_temp.own())) = '22023|job_closed' and pg_temp.gsnap(a) = s0
      and pg_temp.err(format('delete from analytics.job_gem_bom where job_id = %L', jd)) = '22023|job_closed'
      and pg_temp.err(format('update analytics.job_gem_bom set qty_per_piece = 9 where job_id = %L', jd)) = '22023|job_closed'
      and pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jd)) ->> 'window' = 'closed');
    perform pg_temp.setfx('Jd', jd);
  end if;

  -- getter: เทียบแม่แบบ · ฉลาก snapshot กับชื่อปัจจุบัน (renamed) · canonical
  r := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, pg_temp.fx('jT')));
  v := v || pg_temp.chk('J7a', 'ใบที่คัดลอกจากแม่แบบ (SKU มีแม่แบบ): differs_from_template=false · template ส่งมาด้วย 2 แถว · source=product · via=office',
    r ->> 'differs_from_template' = 'false' and jsonb_array_length(r -> 'template') = 2 and (r -> 'lines' -> 0 ->> 'source') = 'product');
  r := pg_temp.tset(a, pg_temp.fx('pA1'), format('[{"type_id":"%s","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":7}]', tgem, oval)::jsonb, pg_temp.own());
  r := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, pg_temp.fx('jT')));
  v := v || pg_temp.chk('J7b', 'แม่แบบเปลี่ยนทีหลัง → ใบที่มีอยู่ differs_from_template=true (ปุ่ม "ตั้งเป็นแม่แบบ" ขึ้น) · ใบไม่เปลี่ยน', r ->> 'differs_from_template' = 'true' and jsonb_array_length(r -> 'lines') = 2);
  r := pg_temp.tset(a, pg_temp.fx('pA1'), format('[{"type_id":"%s","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":2,"position":"บ่าซ้าย-ขวา"},{"type_id":"%s","shape_id":"%s","size_a":1.5,"qty_per_piece":30,"position":"ล้อมรอบ"}]', tgem, oval, pg_temp.fx('tRuby'), rnd)::jsonb, pg_temp.own());
  r := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, pg_temp.fx('J1')));
  v := v || pg_temp.chk('J7c', 'getter: lines มี canonical_item_id = gem_item_id เมื่อรายการไม่ถูกรวม · template ส่งมาเมื่อใบมี SKU',
    (r -> 'lines' -> 0 ->> 'canonical_item_id') = (r -> 'lines' -> 0 ->> 'gem_item_id') and r -> 'template' is not null);
  r := pg_temp.ren(a, 'type', tgem, 'โกเมนเอ็กซ์', true);
  r2 := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, pg_temp.fx('J1')));
  v := v || pg_temp.chk('J7d', 'เปลี่ยนชื่อชนิดทีหลัง → ฉลาก snapshot ของใบเดิม ("โกเมน · ไข่ …") ไม่เปลี่ยน · renamed=true บอกว่าชื่อปัจจุบันต่าง',
    r ->> '_err' is null and (r2 -> 'lines' -> 0 ->> 'label') = 'โกเมน · ไข่ · 4×6 มม.' and (r2 -> 'lines' -> 0 ->> 'renamed') = 'true');
  r := pg_temp.ren(a, 'type', tgem, 'โกเมน', true);
  v := v || pg_temp.chk('J7e', 'เปลี่ยนชื่อกลับ → ผ่าน (ชื่อเดิมของตัวเองที่ถูกเปลี่ยนไป ไม่ชนตัวเอง)', r ->> '_err' is null and (select name from analytics.gem_type where id = tgem) = 'โกเมน');
  return v;
end;
$c$;

-- ============================================================================
-- G. รวมชื่อ A→B: preview · ผลที่เกิด · snapshot ไม่ขยับ · ราคา A ไม่ย้าย · ด่านห้ามผ่าน · พิมพ์ชื่อเก่า/id เก่า resolve ไปปลายทาง · guard · has_length · ลบ
-- ============================================================================
create function pg_temp.g_merge() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A');
  oval uuid := pg_temp.shp(a, 'ไข่');
  rnd uuid := pg_temp.shp(a, 'กลม');
  x uuid; y uuid; x1 uuid; y1 uuid; y2 uuid; p1 uuid; q1 uuid; px uuid; qx uuid;
  r jsonb; r2 jsonb; j jsonb; jm uuid; jc uuid; s0 text; s_jobs text; prev jsonb; n int; ok boolean; k int;
  pA4 uuid := pg_temp.fx('pA4'); pA2 uuid := pg_temp.fx('pA2'); pA3 uuid := pg_temp.fx('pA3'); jn uuid; ev jsonb;
begin
  -- fixtures: X "ไพลิน" (ปลายทาง) · Y "ไพลินี" (ชื่อซ้ำที่จะเลิกใช้ — พิมพ์ด้วย force)
  r := pg_temp.ccreate(a, 'type', 'ไพลิน', null, false); x := (r ->> 'id')::uuid; perform pg_temp.setfx('tX', x);
  r := pg_temp.icreate(a, jsonb_build_object('type_id', x, 'shape_id', rnd, 'size_a', 3));
  x1 := (r -> 'item' ->> 'gem_item_id')::uuid;
  r := pg_temp.icreate(a, jsonb_build_object('new_type_name', 'ไพลินี', 'shape_id', rnd, 'size_a', 3), true);
  y := pg_temp.typ(a, 'ไพลินี'); y1 := (r -> 'item' ->> 'gem_item_id')::uuid; perform pg_temp.setfx('tY', y);
  r := pg_temp.icreate(a, jsonb_build_object('type_id', y, 'shape_id', oval, 'size_a', 3, 'size_b', 5));
  y2 := (r -> 'item' ->> 'gem_item_id')::uuid;
  r := pg_temp.price(a, y1, '1234.5678'); r2 := pg_temp.price(a, y2, '5555.1111');
  v := v || pg_temp.chk('M0', 'fixture รวมชื่อ: ชนิด X "ไพลิน" (กลม 3) · Y "ไพลินี" (กลม 3 ชนกับ X · ไข่ 3×5 ไม่ชน) · ราคา y1 1234.5678 · y2 5555.1111 · x1 ไม่มีราคา',
    x1 is not null and y1 is not null and y2 is not null and r ->> '_err' is null and r2 ->> '_err' is null and not exists (select 1 from analytics.gem_item_price where gem_item_id = x1));
  r := pg_temp.tset(a, pA4, jsonb_build_array(jsonb_build_object('gem_item_id', y1, 'qty_per_piece', 2, 'position', 'ซ้าย'), jsonb_build_object('gem_item_id', x1, 'qty_per_piece', 3), jsonb_build_object('gem_item_id', y2, 'qty_per_piece', 1)));
  r2 := pg_temp.tset(a, pA2, jsonb_build_array(jsonb_build_object('gem_item_id', y1, 'qty_per_piece', 4)));
  j := pg_temp.mkjob(a, pA4, pg_temp.stdg(), jsonb_build_array(jsonb_build_object('gem_item_id', y1, 'qty_per_piece', 2, 'position', 'ซ้าย')));
  jm := (j ->> 'job')::uuid; perform pg_temp.setfx('Jm', jm);
  j := pg_temp.mkjob(a, pA3, pg_temp.stdg(), jsonb_build_array(jsonb_build_object('gem_item_id', y1, 'qty_per_piece', 1)));
  jc := (j ->> 'job')::uuid;
  perform analytics.job_cancel(a, jc, 'verify 0190 merge snapshot', pg_temp.nom());
  v := v || pg_temp.chk('M0b', 'fixture: แม่แบบ pA4 (y1·x1·y2) + pA2 (y1) · ใบเปิด Jm อ้าง y1 · ใบยกเลิก Jc อ้าง y1 · ฉลาก snapshot "ไพลินี · กลม · 3 มม."',
    r ->> '_err' is null and r2 ->> '_err' is null and pg_temp.n_bom(jm) = 1 and pg_temp.n_bom(jc) = 1
    and (select gem_label from analytics.job_gem_bom where job_id = jm) = 'ไพลินี · กลม · 3 มม.');
  s_jobs := (select md5(string_agg(b::text, '|' order by b.id)) from analytics.job_gem_bom b where b.shop_id = a);

  -- M1: preview (อ่านอย่างเดียว)
  s0 := pg_temp.gsnap(a);
  prev := pg_temp.mprev(a, 'type', y, x);
  v := v || pg_temp.chk('M1', 'preview รวม "ไพลินี"→"ไพลิน": ย้าย 1 (ไข่ 3×5) · รวมเป็นรายการเดียว 1 (กลม 3) · ราคาที่ไม่ย้าย 1 · ปลายทางไม่มีราคา 1 · แม่แบบย้ายตาม 1 + บวกจำนวน 1 · ใบเปิดที่ใช้ 1 / ทั้งหมด 2 · snapshots_unchanged · ไม่เขียนอะไร',
    prev ->> '_err' is null and (prev ->> 'items_moved') = '1' and (prev ->> 'items_collapsed') = '1' and (prev ->> 'prices_not_moved') = '1' and (prev ->> 'collapsed_missing_price_on_target') = '1'
    and (prev ->> 'template_lines_repointed') = '1' and (prev ->> 'template_lines_summed') = '1' and (prev ->> 'template_qty_overflow') = '0'
    and (prev ->> 'jobs_open_using') = '1' and (prev ->> 'jobs_using_total') = '2' and prev ->> 'snapshots_unchanged' = 'true'
    and prev -> 'from' ->> 'name' = 'ไพลินี' and prev -> 'into' ->> 'name' = 'ไพลิน' and pg_temp.gsnap(a) = s0);

  -- M3 (ก่อนรวมจริง): ด่านห้ามผ่าน — ทุกเคสต้องไม่เขียนอะไร
  ok := true; s0 := pg_temp.gsnap(a);
  for k in 1..8 loop
    r := case k
      when 1 then pg_temp.mrg(a, 'type', x, x)
      when 2 then pg_temp.mrg(a, 'type', pg_temp.fx('tB'), x)
      when 3 then pg_temp.mrg(a, 'type', x, pg_temp.fx('tB'))
      when 4 then pg_temp.mrg(a, 'shape', rnd, oval)
      when 5 then pg_temp.mrg(a, 'item', x, y)
      when 6 then pg_temp.mrg(a, 'type', null, x)
      when 7 then pg_temp.mrg(a, 'type', x, null)
      else '{}'::jsonb end;
    if k = 8 then
      -- ปลายทางปิดใช้งาน
      perform pg_temp.sact(a, 'type', pg_temp.fx('tCz'), false);
      r := pg_temp.mrg(a, 'type', pg_temp.fx('tRuby'), pg_temp.fx('tCz'));
      perform pg_temp.sact(a, 'type', pg_temp.fx('tCz'), true);
    end if;
    if pg_temp.hint(r) <> '22023|' || (array['gem_merge_self', 'gem_not_found', 'gem_not_found', 'has_length_mismatch', 'kind_invalid', 'gem_merge_invalid', 'gem_merge_invalid', 'gem_merge_into_inactive'])[k] then
      ok := false; v := v || pg_temp.chk('M3-' || k, 'merge ต้องถูกปฏิเสธ แต่ได้ ' || pg_temp.hint(r), false);
    end if;
  end loop;
  v := v || pg_temp.chk('M3a', 'merge ลงตัวเอง → gem_merge_self · ชนิดร้านอื่น (จาก/ไปยัง) → gem_not_found · รูปทรงจำนวนค่าขนาดต่างกัน → has_length_mismatch · kind ผิด · id ว่าง · ปลายทางปิดใช้งาน → ปฏิเสธทั้ง 8 แบบ', ok);
  v := v || pg_temp.chk('M3z', 'ที่ปฏิเสธไม่เขียนอะไร (snapshot เท่าเดิม ยกเว้นเปิด/ปิดชนิดทดสอบ — event active_set 2 รายการ)', (select count(*) from analytics.gem_catalog_event where subject_id = pg_temp.fx('tCz') and event_type = 'active_set') = 4);
  -- M3h: รวมแล้วแม่แบบ SKU เกิน 1,000/ชิ้น → ปฏิเสธทั้งการรวม
  r := pg_temp.ccreate(a, 'type', 'ทัวร์มาลีน', null, false); px := (r ->> 'id')::uuid;
  r := pg_temp.icreate(a, jsonb_build_object('type_id', px, 'shape_id', rnd, 'size_a', 7)); p1 := (r -> 'item' ->> 'gem_item_id')::uuid;
  r := pg_temp.icreate(a, jsonb_build_object('new_type_name', 'ทัวร์มาลีนี', 'shape_id', rnd, 'size_a', 7), true); qx := pg_temp.typ(a, 'ทัวร์มาลีนี'); q1 := (r -> 'item' ->> 'gem_item_id')::uuid;
  r := pg_temp.tset(a, pA2, jsonb_build_array(jsonb_build_object('gem_item_id', y1, 'qty_per_piece', 4), jsonb_build_object('gem_item_id', p1, 'qty_per_piece', 600), jsonb_build_object('gem_item_id', q1, 'qty_per_piece', 500)));
  s0 := pg_temp.gsnap(a);
  r2 := pg_temp.mrg(a, 'type', qx, px);
  v := v || pg_temp.chk('M3h', 'รวมแล้วแม่แบบ SKU เดียวกันมีจำนวนต่อชิ้น 600+500 > 1,000 → ปฏิเสธ merge_qty_overflow ทั้งการรวม · ไม่เขียนอะไร',
    pg_temp.hint(r2) = '22023|merge_qty_overflow' and pg_temp.gsnap(a) = s0 and (select merged_into from analytics.gem_type where id = qx) is null);
  r := pg_temp.tset(a, pA2, jsonb_build_array(jsonb_build_object('gem_item_id', y1, 'qty_per_piece', 4)));

  -- M2: รวมจริง Y→X
  r := pg_temp.mrg(a, 'type', y, x);
  v := v || pg_temp.chk('M2', 'รวม "ไพลินี"→"ไพลิน": สำเร็จ · ผลตรงกับ preview (ย้าย 1 · ชน 1 · ราคาไม่ย้าย 1) · Y ถูกปิดและชี้ merged_into=X · y1 ชี้ x1 และปิด · y2 ย้ายมาอยู่ใต้ X (ยังใช้งาน)',
    r ->> '_err' is null and (r ->> 'items_moved') = (prev ->> 'items_moved') and (r ->> 'items_collapsed') = (prev ->> 'items_collapsed') and (r ->> 'prices_not_moved') = (prev ->> 'prices_not_moved')
    and (select merged_into = x and not is_active from analytics.gem_type where id = y)
    and (select merged_into = x1 and not is_active from analytics.gem_item where id = y1)
    and (select gem_type_id = x and is_active and merged_into is null from analytics.gem_item where id = y2));
  v := v || pg_temp.chk('M2t', 'แม่แบบ SKU ตามไปที่รายการปลายทาง: pA4 เหลือ 2 แถว (x1 รวม 3+2=5 ตำแหน่ง "ซ้าย" · y2 ×1) · pA2 ชี้ x1 ×4 · ไม่มีแถวอ้างรายการที่ถูกรวม (y1)',
    (select count(*) from analytics.product_gem_bom where product_id = pA4) = 2
    and (select qty_per_piece from analytics.product_gem_bom where product_id = pA4 and gem_item_id = x1) = 5
    and (select position_note from analytics.product_gem_bom where product_id = pA4 and gem_item_id = x1) = 'ซ้าย'
    and (select qty_per_piece from analytics.product_gem_bom where product_id = pA2 and gem_item_id = x1) = 4
    and not exists (select 1 from analytics.product_gem_bom where gem_item_id = y1));
  v := v || pg_temp.chk('M2c', '🔴 ราคาของ A ไม่ย้าย: ราคา y1 ยังอยู่ที่ y1 (1 แถว) · x1 ยังไม่มีราคา · ราคา y2 ตามรายการไปอยู่ใต้ "ไพลิน" (catalog list เห็น 5555.1111 ใต้ X)',
    (select count(*) from analytics.gem_item_price where gem_item_id = y1) = 1 and not exists (select 1 from analytics.gem_item_price where gem_item_id = x1)
    and (select count(*) from analytics.gem_item_price where gem_item_id = y2) = 1
    and exists (select 1 from jsonb_array_elements(pg_temp.clist(a) -> 'items') i where (i ->> 'gem_item_id')::uuid = y2 and (i ->> 'type_id')::uuid = x and i ->> 'price' = '5555.1111')
    and exists (select 1 from jsonb_array_elements(pg_temp.clist(a) -> 'items') i where (i ->> 'gem_item_id')::uuid = x1 and i ->> 'has_price' = 'false'));
  v := v || pg_temp.chk('M2d', '🔴 snapshot ไม่ขยับ: job_gem_bom ทุกแถวของร้าน md5 เท่าก่อนรวม · ใบเปิด Jm ยังเป็น "ไพลินี · กลม · 3 มม." · ใบยกเลิก Jc เท่าเดิม',
    s_jobs = (select md5(string_agg(b::text, '|' order by b.id)) from analytics.job_gem_bom b where b.shop_id = a)
    and (select gem_label from analytics.job_gem_bom where job_id = jm) = 'ไพลินี · กลม · 3 มม.' and (select gem_label from analytics.job_gem_bom where job_id = jc) = 'ไพลินี · กลม · 3 มม.');
  ev := (select payload from analytics.gem_catalog_event where subject_id = y and event_type = 'merge');
  v := v || pg_temp.chk('M2e', 'บันทึกประวัติการรวม (ใคร/ชื่อ/จำนวน) · GUC ย้ายอ้างอิงปิดแล้วหลังรวม (ไม่รั่วไปคำสั่งถัดไป)',
    ev ->> 'into' = x::text and ev ->> 'from_name' = 'ไพลินี' and ev ->> 'into_name' = 'ไพลิน' and (ev ->> 'items_moved') = '1'
    and (select actor from analytics.gem_catalog_event where subject_id = y and event_type = 'merge') = pg_temp.own()
    and coalesce(current_setting('analytics.gem_merge', true), '') in ('', 'off'));
  r := pg_temp.olist(a);
  v := v || pg_temp.chk('M2f', 'รายการพลอยในฟอร์ม (gem_options_list): ไม่มี "ไพลินี" · ไม่มี y1 · มี y2 ใต้ "ไพลิน"',
    not exists (select 1 from jsonb_array_elements(r -> 'types') t where t ->> 'id' = y::text) and not exists (select 1 from jsonb_array_elements(r -> 'items') i where i ->> 'gem_item_id' = y1::text)
    and exists (select 1 from jsonb_array_elements(r -> 'items') i where i ->> 'gem_item_id' = y2::text and i ->> 'type_id' = x::text));
  r := pg_temp.clist(a, null, true);
  v := v || pg_temp.chk('M2g', 'catalog list (รวมที่ปิด): "ไพลินี" ขึ้น merged_into_name = "ไพลิน" (ป้าย "รวมเข้ากับ …")', exists (select 1 from jsonb_array_elements(r -> 'types') t where t ->> 'id' = y::text and t ->> 'merged_into_name' = 'ไพลิน' and t ->> 'is_active' = 'false'));

  -- M4: พิมพ์ชื่อเก่า/ใช้ id เก่า (ใบที่ค้างระหว่างรวมชื่อ) → resolve ไปปลายทาง ไม่ล้ม ไม่สร้างแถวซ้ำ
  j := pg_temp.mkjob(a, pA3, pg_temp.stdg(), '[]'::jsonb);
  jn := (j ->> 'job')::uuid;
  n := pg_temp.n_type(a);
  r := pg_temp.bset(a, jn, format('[{"new_type_name":"ไพลินี","shape_id":"%s","size_a":3,"qty_per_piece":1}]', rnd)::jsonb, pg_temp.own());
  v := v || pg_temp.chk('M4a', 'พิมพ์ชื่อที่ถูกรวมไปแล้ว ("ไพลินี") → ใช้ "ไพลิน" ให้ (reused) · ไม่สร้างชนิดใหม่ · แถวชี้ x1 (ปลายทาง) · ฉลากใช้ชื่อปัจจุบัน',
    r ->> '_err' is null and pg_temp.n_type(a) = n and (r -> 'summary' -> 'reused' -> 0 ->> 'name') = 'ไพลิน' and (select gem_item_id from analytics.job_gem_bom where job_id = jn) = x1
    and (r -> 'lines' -> 0 ->> 'label') = 'ไพลิน · กลม · 3 มม.');
  r := pg_temp.bset(a, jn, format('[{"type_id":"%s","shape_id":"%s","size_a":3,"size_b":5,"qty_per_piece":2}]', y, oval)::jsonb, pg_temp.own());
  v := v || pg_temp.chk('M4b', 'ส่ง type_id ของชนิดที่ถูกรวม (Y) → resolve ไป X · รายการ = y2 (ไข่ 3×5 ที่ย้ายมาใต้ X) ไม่ปฏิเสธ (ตัดสินเอง — UX A3/A6)',
    r ->> '_err' is null and (select gem_item_id from analytics.job_gem_bom where job_id = jn) = y2);
  r := pg_temp.bset(a, jn, jsonb_build_array(jsonb_build_object('gem_item_id', y1, 'qty_per_piece', 2)), pg_temp.own());
  v := v || pg_temp.chk('M4c', 'ส่ง gem_item_id ของรายการที่ถูกรวม (y1) → resolve ไป x1 · ไม่ปฏิเสธ', r ->> '_err' is null and (select gem_item_id from analytics.job_gem_bom where job_id = jn) = x1);

  -- M5: กำแพงที่ตารางหลังรวม (ยิงตรง)
  v := v || pg_temp.chk('M5a', 'ย้อนการรวม/แก้ชื่อ/เปิดใช้ชนิดที่ถูกรวม ตรง → ปฏิเสธ gem_merged_locked',
    pg_temp.err(format('update analytics.gem_type set merged_into = null where id = %L', y)) = '22023|gem_merged_locked'
    and pg_temp.err(format('update analytics.gem_type set name = %L where id = %L', 'ไพลินีสอง', y)) = '22023|gem_merged_locked'
    and pg_temp.err(format('update analytics.gem_type set is_active = true where id = %L', y)) in ('22023|gem_merged_locked', '23514|'));
  v := v || pg_temp.chk('M5b', 'แก้ merged_into ของรายการตรง (ไม่ผ่าน gem_merge) → 42501 · ตั้งตัวเองเป็นปลายทางของตัวเองไม่ได้ (CHECK)',
    pg_temp.err(format('update analytics.gem_item set merged_into = null where id = %L', y1)) = '42501|'
    and pg_temp.err(format('update analytics.gem_type set merged_into = %L where id = %L', x, x)) in ('23514|', '22023|gem_merge_invalid'));
  v := v || pg_temp.chk('M5c', 'RPC: เปลี่ยนชื่อ/เปิดใช้ชนิดที่ถูกรวม · ตั้งราคารายการที่ถูกรวม → gem_merged_locked',
    pg_temp.hint(pg_temp.ren(a, 'type', y, 'ไพลินสาม')) = '22023|gem_merged_locked' and pg_temp.hint(pg_temp.sact(a, 'type', y, true)) = '22023|gem_merged_locked'
    and pg_temp.hint(pg_temp.price(a, y1, '10')) = '22023|gem_merged_locked');
  v := v || pg_temp.chk('M5d', 'สร้างรายการใต้ชนิดที่ถูกรวม · แม่แบบ/ใบอ้างรายการที่ถูกรวมตรง → gem_ref_inactive',
    pg_temp.err(format('insert into analytics.gem_item (shop_id, gem_type_id, gem_shape_id, size_a) values (%L, %L, %L, 9)', a, y, rnd)) = '22023|gem_ref_inactive'
    and pg_temp.err(format('insert into analytics.product_gem_bom (shop_id, product_id, line_seq, gem_item_id, qty_per_piece) values (%L, %L, 9, %L, 1)', a, pA3, y1)) = '22023|gem_ref_inactive'
    and pg_temp.err(format('insert into analytics.job_gem_bom (shop_id, job_id, line_seq, gem_item_id, gem_label, qty_per_piece, source) values (%L, %L, 9, %L, %L, 1, %L)', a, jn, y1, 'ไพลินี · กลม · 3 มม.', 'manual')) = '22023|gem_ref_inactive');

  -- M5e: 🔴 QA M5 — แก้จำนวนแถวเดียวหลังรวมชื่อ โดยส่งแถวกลับด้วย id เดิมของ snapshot (y1 ที่ถูกรวมเข้า x1) → แถวเดิมอยู่ต่อ ฉลาก snapshot ไม่ถูกเขียนทับ ไม่ลบ-แทรกใหม่
  s0 := (select id::text from analytics.job_gem_bom where job_id = jm limit 1);
  r := pg_temp.bset(a, jm, jsonb_build_array(jsonb_build_object('gem_item_id', y1, 'qty_per_piece', 5, 'position', 'ซ้าย')), pg_temp.own());
  v := v || pg_temp.chk('M5e', 'ส่งแถวด้วย gem_item_id ของรายการที่ถูกรวม (y1) + แก้จำนวน 2→5 → แถวเดิมคงอยู่ (id แถวเดิม · gem_item_id = y1 · ฉลาก "ไพลินี · กลม · 3 มม.") จำนวนเป็น 5 · ไม่เกิดแถวใหม่ · changed',
    r ->> '_err' is null and r ->> 'changed' = 'true' and pg_temp.n_bom(jm) = 1
    and (select id::text from analytics.job_gem_bom where job_id = jm) = s0 and (select gem_item_id from analytics.job_gem_bom where job_id = jm) = y1
    and (select gem_label from analytics.job_gem_bom where job_id = jm) = 'ไพลินี · กลม · 3 มม.' and (select qty_per_piece from analytics.job_gem_bom where job_id = jm) = 5);
  r := pg_temp.bset(a, jm, jsonb_build_array(jsonb_build_object('gem_item_id', x1, 'qty_per_piece', 5, 'position', 'ซ้าย')), pg_temp.own());
  v := v || pg_temp.chk('M5f', 'ส่ง id ของรายการปลายทาง (x1 — canonical) แทน y1 ที่เก็บไว้ → จับคู่กับแถวเดิม ไม่เปลี่ยนอะไร (changed=false · ฉลากเดิมอยู่ต่อ)',
    r ->> '_err' is null and r ->> 'changed' = 'false' and (select gem_label from analytics.job_gem_bom where job_id = jm) = 'ไพลินี · กลม · 3 มม.');

  -- M6: has_length แก้ไม่ได้เมื่อมีรายการใช้ · แก้ได้เมื่อไม่มี
  v := v || pg_temp.chk('M6a', 'แก้จำนวนค่าขนาดของรูปทรง "ไข่" ที่มีรายการใช้ (RPC และ UPDATE ตรง) → ปฏิเสธ has_length_locked',
    pg_temp.hint(pg_temp.hl(a, oval, false)) = '22023|has_length_locked'
    and pg_temp.err(format('update analytics.gem_shape set has_length = false where id = %L', oval)) = '22023|has_length_locked'
    and (select has_length from analytics.gem_shape where id = oval));
  r := pg_temp.ccreate(a, 'shape', 'ทรงดาว', false, false);
  perform pg_temp.setfx('sStar', (r ->> 'id')::uuid);
  r2 := pg_temp.hl(a, pg_temp.fx('sStar'), true);
  v := v || pg_temp.chk('M6b', 'รูปทรงที่ยังไม่มีรายการใช้ ("ทรงดาว") แก้ has_length ได้ · มี event has_length_set', r ->> '_err' is null and r2 ->> '_err' is null and (select has_length from analytics.gem_shape where id = pg_temp.fx('sStar'))
    and exists (select 1 from analytics.gem_catalog_event where subject_id = pg_temp.fx('sStar') and event_type = 'has_length_set'));

  -- M7: ลบได้เฉพาะที่ไม่ถูกใช้เลย
  v := v || pg_temp.chk('M7a', 'ลบชนิด "ไพลิน" (มีรายการ) / รูปทรง "ไข่" (มีรายการ) / รายการที่ใบอ้าง / รายการที่ถูกรวม (y1 — ใบ Jm Jc อ้าง) → gem_in_use',
    pg_temp.hint(pg_temp.rmv(a, 'type', x)) = '22023|gem_in_use' and pg_temp.hint(pg_temp.rmv(a, 'shape', oval)) = '22023|gem_in_use'
    and pg_temp.hint(pg_temp.rmv(a, 'item', pg_temp.fx('iGemOval'))) = '22023|gem_in_use' and pg_temp.hint(pg_temp.rmv(a, 'item', y1)) = '22023|gem_in_use'
    and pg_temp.hint(pg_temp.rmv(a, 'type', y)) = '22023|gem_in_use' and (pg_temp.dtl(pg_temp.rmv(a, 'item', y1)) ->> 'jobs')::int >= 2);
  r := pg_temp.icreate(a, jsonb_build_object('type_id', x, 'shape_id', rnd, 'size_a', 9));
  r2 := pg_temp.price(a, (r -> 'item' ->> 'gem_item_id')::uuid, '12.5');
  perform pg_temp.setfx('iTmp', (r -> 'item' ->> 'gem_item_id')::uuid);
  r := pg_temp.rmv(a, 'item', pg_temp.fx('iTmp'));
  v := v || pg_temp.chk('M7b', 'รายการที่ไม่ถูกใช้ (มีราคา) ลบได้ · ราคาถูกลบตาม · event remove บอก prices_deleted=1 (ไม่มีตัวเลขราคา)',
    r ->> '_err' is null and not exists (select 1 from analytics.gem_item where id = pg_temp.fx('iTmp')) and not exists (select 1 from analytics.gem_item_price where gem_item_id = pg_temp.fx('iTmp'))
    and (select (payload ->> 'prices_deleted')::int from analytics.gem_catalog_event where subject_id = pg_temp.fx('iTmp') and event_type = 'remove') = 1
    and not pg_temp.has_px((select payload from analytics.gem_catalog_event where subject_id = pg_temp.fx('iTmp') and event_type = 'remove')));
  r := pg_temp.rmv(a, 'shape', pg_temp.fx('sStar'));
  r2 := pg_temp.ccreate(a, 'type', 'ไม่มีใครใช้ทับทิม', null, false);
  perform pg_temp.setfx('tUnused', (r2 ->> 'id')::uuid);
  ok := (r ->> '_err' is null) and not exists (select 1 from analytics.gem_shape where id = pg_temp.fx('sStar'));
  r := pg_temp.rmv(a, 'type', pg_temp.fx('tUnused'));
  r2 := pg_temp.rmv(a, 'type', pg_temp.fx('tUnused'));
  v := v || pg_temp.chk('M7c', 'รูปทรง/ชนิดที่ไม่ถูกใช้ลบได้ (ทรงดาว · ชนิดที่เพิ่งสร้าง) · ลบซ้ำ → gem_not_found',
    ok and r ->> '_err' is null and pg_temp.hint(r2) = '22023|gem_not_found');

  -- M9: 🔴 QA N1/N2 — รวมได้แม้อีกฝั่งของรายการถูกปิดใช้งานไปแล้ว (ปิด = ซ่อนจาก dropdown ไม่ใช่ล็อกการดูแลแคตตาล็อก) · ตรวจเฉพาะฝั่งที่เปลี่ยน
  r := pg_temp.ccreate(a, 'type', 'ZZ190 เอ', null, true); px := (r ->> 'id')::uuid;
  r := pg_temp.ccreate(a, 'type', 'ZZ190 บี', null, true); qx := (r ->> 'id')::uuid;
  r := pg_temp.ccreate(a, 'shape', 'ทรงปิดภายหลัง 190', false, true); perform pg_temp.setfx('sCl', (r ->> 'id')::uuid);
  r := pg_temp.icreate(a, jsonb_build_object('type_id', px, 'shape_id', pg_temp.fx('sCl'), 'size_a', 2), true);
  perform pg_temp.sact(a, 'shape', pg_temp.fx('sCl'), false);
  r := pg_temp.mrg(a, 'type', px, qx);
  v := v || pg_temp.chk('M9a', 'รวมชนิดที่มีรายการใช้ "รูปทรงที่ปิดใช้งานแล้ว" → รวมได้ · รายการย้ายใต้ปลายทาง (รูปทรงยังปิดอยู่) — ไม่ล้ม gem_ref_inactive',
    r ->> '_err' is null and (select gem_type_id = qx from analytics.gem_item where gem_shape_id = pg_temp.fx('sCl') and size_a = 2) and not (select is_active from analytics.gem_shape where id = pg_temp.fx('sCl')));
  r := pg_temp.ccreate(a, 'type', 'ZZ190 ซี', null, true); px := (r ->> 'id')::uuid;
  r := pg_temp.ccreate(a, 'shape', 'ZZ190 ทรงหนึ่ง', false, true); perform pg_temp.setfx('s1', (r ->> 'id')::uuid);
  r := pg_temp.ccreate(a, 'shape', 'ZZ190 ทรงสอง', false, true); perform pg_temp.setfx('s2', (r ->> 'id')::uuid);
  r := pg_temp.icreate(a, jsonb_build_object('type_id', px, 'shape_id', pg_temp.fx('s1'), 'size_a', 2), true);
  perform pg_temp.sact(a, 'type', px, false);
  r := pg_temp.mrg(a, 'shape', pg_temp.fx('s1'), pg_temp.fx('s2'));
  v := v || pg_temp.chk('M9b', 'รวมรูปทรงที่มีรายการของ "ชนิดที่ปิดใช้งานแล้ว" → รวมได้ · รายการย้ายใต้รูปทรงปลายทาง',
    r ->> '_err' is null and (select gem_shape_id = pg_temp.fx('s2') from analytics.gem_item where gem_type_id = px and size_a = 2));
  v := v || pg_temp.chk('M9c', 'กำแพงที่ตารางยังอยู่: สร้างรายการใหม่ใต้ชนิดที่ปิดใช้ตรง → gem_ref_inactive (INSERT ตรวจทั้งสองฝั่งเสมอ)',
    pg_temp.err(format('insert into analytics.gem_item (shop_id, gem_type_id, gem_shape_id, size_a) values (%L, %L, %L, 7)', a, px, pg_temp.fx('s2'))) = '22023|gem_ref_inactive');

  -- V1: 🔴 security M2 — วิวอ่านด้วย service_role ได้ (ไม่เรียกฟังก์ชันของ schema ที่ถูกถอนสิทธิ์)
  v := v || pg_temp.chk('V1', 'set local role service_role: select ทั้ง v_job_gem_requirement และ v_product_gem_bom ไม่ error · canonical_item_id ของแถวที่ชี้รายการถูกรวม = รายการปลายทาง',
    pg_temp.asrole('service_role', 'select count(*) from analytics.v_job_gem_requirement') = 'OK' and pg_temp.asrole('service_role', 'select count(*) from analytics.v_product_gem_bom') = 'OK'
    and (select canonical_item_id from analytics.v_job_gem_requirement where job_id = jm) = x1);

  -- M8: รวมรูปทรง (ชนิดข้อมูลที่สอง): 1 ค่า → 1 ค่า · ขนาดชนกันรวม · ที่ไม่ชนย้าย
  r := pg_temp.ccreate(a, 'shape', 'ทรงหยก', false, false); perform pg_temp.setfx('sJ1', (r ->> 'id')::uuid);
  r := pg_temp.ccreate(a, 'shape', 'ทรงหยกี', false, true); perform pg_temp.setfx('sJ2', (r ->> 'id')::uuid);
  r := pg_temp.icreate(a, jsonb_build_object('type_id', x, 'shape_id', pg_temp.fx('sJ1'), 'size_a', 1));
  r := pg_temp.icreate(a, jsonb_build_object('type_id', x, 'shape_id', pg_temp.fx('sJ1'), 'size_a', 2));
  r := pg_temp.icreate(a, jsonb_build_object('type_id', x, 'shape_id', pg_temp.fx('sJ2'), 'size_a', 1));
  prev := pg_temp.mprev(a, 'shape', pg_temp.fx('sJ1'), pg_temp.fx('sJ2'));
  r := pg_temp.mrg(a, 'shape', pg_temp.fx('sJ1'), pg_temp.fx('sJ2'));
  v := v || pg_temp.chk('M8', 'รวมรูปทรง "ทรงหยก"→"ทรงหยกี": ย้าย 1 (ขนาด 2) · ชน 1 (ขนาด 1) ตรง preview · รูปทรง A ปิดและชี้ปลายทาง · รายการขนาด 2 ย้ายไปใต้รูปทรงปลายทาง',
    r ->> '_err' is null and (prev ->> 'items_moved') = '1' and (prev ->> 'items_collapsed') = '1' and (r ->> 'items_moved') = '1' and (r ->> 'items_collapsed') = '1'
    and (select merged_into = pg_temp.fx('sJ2') and not is_active from analytics.gem_shape where id = pg_temp.fx('sJ1'))
    and (select count(*) from analytics.gem_item where gem_shape_id = pg_temp.fx('sJ2') and merged_into is null) = 2);
  return v;
end;
$c$;

-- ============================================================================
-- H. หน้าช่าง (job_worker_resolve): พลอยแสดงหลังระบุตัว · snapshot · ไม่มีราคา · ใบเดิมเหมือนเดิมเป๊ะ
-- ============================================================================
create function pg_temp.g_res() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A');
  j1 uuid := pg_temp.fx('J1');
  tgem uuid := pg_temp.fx('tGem');
  r jsonb; r2 jsonb; j jsonb; jn uuid; tk jsonb; tkh text; sess text; keys_ text[]; g jsonb;
  c_old constant text[] := array['design_label', 'due_date', 'has_profile', 'job_no', 'metal', 'profile_name', 'qty_planned', 'sku', 'stages', 'status'];
begin
  r := pg_temp.w_res(pg_temp.kv('tokh_J1'), pg_temp.kv('sW'));
  g := r -> 'job' -> 'gems';
  select array_agg(k order by k) into keys_ from jsonb_object_keys(g -> 0) k;
  v := v || pg_temp.chk('R1', 'ช่างระบุตัวแล้ว: job.gems = [{label, position, qty_per_piece, qty_total}] เท่านั้น (key ล็อกครบ 4 ตัว · ไม่มีราคา/เผื่อแตก/tier) · gems_state=specified · qty_total = 2 × 3 = 6 · ฉลากจาก snapshot',
    r ->> 'ok' = 'true' and jsonb_array_length(g) = 1 and keys_ @> array['label', 'position', 'qty_per_piece', 'qty_total'] and keys_ <@ array['label', 'position', 'qty_per_piece', 'qty_total'] and r -> 'job' ->> 'gems_state' = 'specified'
    and g -> 0 ->> 'label' = 'โกเมน · ไข่ · 4×6 มม.' and g -> 0 ->> 'qty_total' = '6' and g -> 0 ->> 'qty_per_piece' = '2' and g -> 0 ->> 'position' = 'บ่าซ้าย-ขวา'
    and pg_temp.badkeys(r -> 'job' -> 'gems') = '');
  r2 := pg_temp.w_res(pg_temp.kv('tokh_J1'), null);
  select array_agg(k order by k) into keys_ from jsonb_object_keys(r2 -> 'job') k;
  v := v || pg_temp.chk('R3', 'ก่อนระบุตัว (ไม่มี session): ไม่มี gems/gems_state (เหมือนรูป — คนถือ QR ปลอมไม่เห็นรายละเอียดงาน) · key ของ job เท่าเดิม',
    r2 ->> 'ok' = 'true' and keys_ @> array['has_profile', 'job_no', 'stages', 'status'] and keys_ <@ array['has_profile', 'job_no', 'stages', 'status'] and not (r2 -> 'job' ? 'gems') and not (r2 -> 'job' ? 'gems_state'));
  -- ใบที่ไม่มีขั้นฝังและไม่มี BOM = ผลเดิมเป๊ะ (ไม่มี key ใหม่)
  j := pg_temp.mkjob(a, pg_temp.fx('pA3'), pg_temp.std(), null);
  jn := (j ->> 'job')::uuid;
  tk := analytics.job_token_issue(a, jn, null, pg_temp.nom());
  tkh := analytics.job_sha256_hex(tk ->> 'token');
  sess := (pg_temp.login(tkh, pg_temp.fx('wW'), '2468')) ->> 'session_hash';
  r := pg_temp.w_res(tkh, sess);
  select array_agg(k order by k) into keys_ from jsonb_object_keys(r -> 'job') k;
  v := v || pg_temp.chk('R2', 'ใบที่ไม่มีขั้นฝังและไม่มีพลอย → job ไม่มี key gems/gems_state เลย · key ทั้งหมดเท่าเดิมของ J1 (A5/หน้าช่างของใบเดิม = เดิมเป๊ะ)',
    sess is not null and r ->> 'ok' = 'true' and keys_ @> c_old and keys_ <@ c_old and not (r -> 'job' ? 'gems'));
  -- ใบที่มีขั้นฝังแต่ยังไม่ระบุพลอย → gems_state = unspecified · gems = []
  j := pg_temp.mkjob(a, pg_temp.fx('pA3'), pg_temp.stdg(), '[]'::jsonb);
  jn := (j ->> 'job')::uuid;
  tk := analytics.job_token_issue(a, jn, null, pg_temp.nom());
  tkh := analytics.job_sha256_hex(tk ->> 'token');
  sess := (pg_temp.login(tkh, pg_temp.fx('wW'), '2468')) ->> 'session_hash';
  r := pg_temp.w_res(tkh, sess);
  v := v || pg_temp.chk('R2b', 'ใบที่มีขั้นฝังแต่ไม่ระบุพลอย → gems_state=unspecified · gems=[] (จอเตือน "ยังไม่ระบุพลอย")', r -> 'job' ->> 'gems_state' = 'unspecified' and r -> 'job' -> 'gems' = '[]'::jsonb);
  -- ฉลาก snapshot: เปลี่ยนชื่อชนิดทีหลัง หน้าช่างยังเห็นฉลากตอนสั่ง
  r := pg_temp.ren(a, 'type', tgem, 'โกเมนเอ็กซ์', true);
  r2 := pg_temp.w_res(pg_temp.kv('tokh_J1'), pg_temp.kv('sW'));
  v := v || pg_temp.chk('R4', 'เปลี่ยนชื่อชนิดทีหลัง → หน้าช่างยังเห็นฉลากเดิม "โกเมน · ไข่ · 4×6 มม." (snapshot ไม่ join แคตตาล็อก)', r ->> '_err' is null and r2 -> 'job' -> 'gems' -> 0 ->> 'label' = 'โกเมน · ไข่ · 4×6 มม.');
  r := pg_temp.ren(a, 'type', tgem, 'โกเมน', true);
  -- qty_total ตามจำนวนเริ่มผลิต (แก้ได้จนขั้นแรกรับ)
  r := pg_temp.q(format('select analytics.job_qty_planned_set(%L, %L, 5, %L, %L)', a, j1, 'verify 0190', pg_temp.nom()));
  r2 := pg_temp.w_res(pg_temp.kv('tokh_J1'), pg_temp.kv('sW'));
  v := v || pg_temp.chk('R5', 'แก้จำนวนเริ่มผลิต 3→5 → qty_total บนหน้าช่างเป็น 2 × 5 = 10 (คำนวณตอนอ่าน ไม่ drift) · getter ฝั่งออฟฟิศตรงกัน',
    r ->> '_err' is null and r2 -> 'job' -> 'gems' -> 0 ->> 'qty_total' = '10' and (pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, j1)) -> 'lines' -> 0 ->> 'qty_total') = '10');
  return v;
end;
$c$;
-- ============================================================================
-- I. W1: ผู้จัดการเปิดใบจากมือถือ (job_worker_open — 0190 ไม่แตะ) ทำงานเดิม · SKU มีแม่แบบ = ได้ขั้นฝัง + BOM คัดลอก
-- ============================================================================
create function pg_temp.opn(p_tokh text, p_sess text, p jsonb) returns jsonb
 language plpgsql as $c$
begin
  -- ถังจำกัดอัตรานับทุกครั้งที่เรียก — ล้างก่อน (fixture: DELETE ตรง — ยกเว้นเดียวที่ไม่ผ่าน RPC เหมือน verify-0189)
  delete from analytics.worker_rate_limit where key like 'wo:%' or key like 'sio:%' or key like 'ipw:%';
  return pg_temp.q(format('select analytics.job_worker_open(p_token_hash=>%L, p_session_hash=>%L, p_idem_key=>%L, p_product_id=>%L, p_pending_label=>%L, p_metal=>%L, p_qty_order=>%L, p_user_agent=>%L, p_ip_hash=>null)',
    p_tokh, p_sess, 'ik' || replace(gen_random_uuid()::text, '-', ''), p ->> 'product', p ->> 'label', p ->> 'metal', coalesce(p ->> 'qty', '2'), 'verify-ua/1.0'));
end;
$c$;

create function pg_temp.g_w1() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A');
  tk jsonb; tokh text; w uuid; s jsonb; sess text; r jsonb; jid uuid; codes text[];
  oval uuid := pg_temp.shp(a, 'ไข่');
  tgem uuid := pg_temp.fx('tGem');
begin
  tk := analytics.shop_intake_token_issue(a, pg_temp.nom());
  tokh := analytics.job_sha256_hex(tk ->> 'token');
  r := pg_temp.wu(a, 'ZZ-M ผู้จัดการ', '1357', '{qc}', true);
  w := (r ->> 'id')::uuid;
  s := pg_temp.q(format('select analytics.worker_pin_verify_intake(%L, %L, %L, %L, %L)', tokh, w, '1357', 'verify-ua/1.0', null));
  sess := analytics.job_sha256_hex(s ->> 'session_token');
  -- W1a: SKU ไม่มีแม่แบบ → เดิมเป๊ะ: ขั้นมาตรฐาน 9 ขั้น (ไม่มีขั้นฝัง) · ไม่มี BOM
  r := pg_temp.opn(tokh, sess, jsonb_build_object('product', pg_temp.fx('pW0')));
  jid := (select j.id from analytics.job j where j.shop_id = a and j.job_no = r ->> 'job_no');
  select array_agg(stage_code order by seq) into codes from analytics.job_stage where job_id = jid;
  v := v || pg_temp.chk('W1a', 'W1 เปิดใบจากมือถือ (SKU ไม่มีแม่แบบ) ทำงานเดิม: ok · ขั้น = 9 ขั้นมาตรฐาน (ไม่มี gem_set) · ไม่มี BOM · QR ออกให้',
    r ->> 'ok' = 'true' and codes = string_to_array(trim(both '{}' from pg_temp.std()), ',') and pg_temp.n_bom(jid) = 0 and r ->> 'token' is not null);
  -- W1b: SKU มีแม่แบบ → ได้ขั้นฝัง (จาก job_source_info) + BOM คัดลอก (source product · event มี worker ไม่มี actor)
  r := pg_temp.tset(a, pg_temp.fx('pW1'), jsonb_build_array(jsonb_build_object('gem_item_id', pg_temp.fx('iGemOval'), 'qty_per_piece', 2, 'position', 'บ่า'), jsonb_build_object('gem_item_id', pg_temp.fx('iRuby'), 'qty_per_piece', 30)));
  r := pg_temp.opn(tokh, sess, jsonb_build_object('product', pg_temp.fx('pW1')));
  jid := (select j.id from analytics.job j where j.shop_id = a and j.job_no = r ->> 'job_no');
  select array_agg(stage_code order by seq) into codes from analytics.job_stage where job_id = jid;
  v := v || pg_temp.chk('W1b', 'W1 เปิดใบ SKU ที่มีแม่แบบ → มีขั้น gem_set (ระบบเสนอจากแม่แบบ) + BOM คัดลอก 2 แถว source=product · event bom_change มี worker_id ไม่มี actor · เปิดสำเร็จ (ไม่พัง)',
    r ->> 'ok' = 'true' and 'gem_set' = any (codes) and pg_temp.n_bom(jid) = 2 and (select count(*) from analytics.job_gem_bom where job_id = jid and source = 'product') = 2
    and exists (select 1 from analytics.job_event where job_id = jid and event_type = 'bom_change' and worker_id = w and actor is null and channel = 'worker_qr'));
  -- W1c: ไม่มี SKU (พิมพ์ชื่อแบบ) → เดิมเป๊ะ
  r := pg_temp.opn(tokh, sess, jsonb_build_object('label', 'แบบหน้างานไม่มีรหัส 0190', 'metal', 'silver'));
  jid := (select j.id from analytics.job j where j.shop_id = a and j.job_no = r ->> 'job_no');
  v := v || pg_temp.chk('W1c', 'W1 เปิดใบแบบไม่มี SKU → ok · ไม่มี BOM · ไม่มี gem_set', r ->> 'ok' = 'true' and pg_temp.n_bom(jid) = 0 and not exists (select 1 from analytics.job_stage where job_id = jid and stage_code = 'gem_set'));
  v := v || pg_temp.chk('W1d', 'job_worker_open ไม่ถูกแตะ (นิยามไม่มีเครื่องหมาย 0190) · ผลเปิดใบไม่มี key พลอย/ราคา',
    not exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_worker_open' and position('0190' in pg_get_functiondef(p.oid)) > 0)
    and not (r ? 'gems') and pg_temp.badkeys(r) = '');
  return v;
end;
$c$;

-- ============================================================================
-- J. golden: ทุก SKU จริงที่ active ในร้านจริง — job_stage_suggest/job_plan_suggest เท่าเดิมเมื่อไม่มีแม่แบบ (oracle = ขั้นมาตรฐาน 9 ขั้นตามกติกา 0172/0186) · สร้างใบผลิตชั่วคราวผ่าน RPC แล้วถอยกลับ
-- ============================================================================
create function pg_temp.g_golden() returns text
 language plpgsql as $c$
declare
  v text := '';
  rs uuid; po uuid; ri jsonb; r jsonb; r2 jsonb; pr_ record;
  n int := 0; bad int := 0; err int := 0; badlist text := ''; errs text := '';
  exp jsonb := to_jsonb(string_to_array(trim(both '{}' from pg_temp.std()), ','));
  gem_total int;
begin
  select pr.shop_id into rs from public.product pr where pr.shop_id not in (pg_temp.fx('A'), pg_temp.fx('B')) group by pr.shop_id order by count(*) desc limit 1;
  if rs is null then return pg_temp.skip('G1', 'ไม่มีร้านจริงในฐานข้อมูล'); end if;
  po := pg_temp.po(rs, 'golden-0190');
  for pr_ in select pr.id, pr.sku from public.product pr where pr.shop_id = rs and pr.is_active and pr.sku !~* '^live' order by pr.sku loop
    ri := pg_temp.iset(rs, po, pr_.id, 1);
    if ri ? '_err' then
      err := err + 1; errs := errs || pr_.sku || ':' || left(ri ->> '_err', 40) || ' | ';
      continue;
    end if;
    r := pg_temp.q(format('select analytics.job_stage_suggest(%L, %L, %L)', rs, 'production', ri ->> 'id'));
    r2 := pg_temp.q(format('select analytics.job_plan_suggest(%L, %L, %L)', rs, 'production', ri ->> 'id'));
    if r ? '_err' or r2 ? '_err' then
      err := err + 1; errs := errs || pr_.sku || ':' || left(coalesce(r ->> '_err', r2 ->> '_err'), 40) || ' | ';
      continue;
    end if;
    n := n + 1;
    if r -> 'suggested_stage_codes' is distinct from exp or r ->> 'gem_template_count' <> '0' or r2 -> 'gem_bom' is distinct from '[]'::jsonb or r2 ->> 'gem_template_count' <> '0'
       or exists (select 1 from jsonb_array_elements(r -> 'stages') s where s ->> 'code' = 'gem_set' and (s ->> 'default_selected')::boolean) then
      bad := bad + 1; badlist := badlist || pr_.sku || ',';
    end if;
  end loop;
  select count(*) into gem_total from analytics.product_gem_bom where shop_id = rs;
  v := v || pg_temp.chk('G1', format('golden: ทุก SKU จริง (ร้านจริง %s SKU ที่ส่งตรวจได้ · error ที่ตรวจไม่ได้ %s) → job_stage_suggest เสนอขั้นมาตรฐาน 9 ขั้นเท่าเดิม ไม่มี gem_set · gem_template_count=0 · job_plan_suggest.gem_bom=[] · ขั้นที่ผิด: %s',
    n, err, coalesce(nullif(badlist, ''), 'ไม่มี')), bad = 0 and n > 0 and gem_total = 0);
  if err > 0 then
    v := v || pg_temp.skip('G1e', format('SKU ที่ job_stage_suggest/plan ตรวจไม่ได้ %s รายการ (error เดิมของ job_source_info ไม่เกี่ยวพลอย): %s', err, left(errs, 400)));
  end if;
  v := v || pg_temp.chk('G3', 'production_order_done (ฟังก์ชัน 💰) ไม่ถูกแตะ: md5 ตรงค่าที่ล็อกไว้ (56cc6d4c… เหมือน verify-0189)',
    (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'production_order_done') = '56cc6d4c97fa1e3feca56012bcf190f3');
  return v;
end;
$c$;

-- ============================================================================
-- K. job_create_from_quote_item + p_gem_lines (ใบเสนอราคา OEM จริงที่สร้างใบได้ — ถอยกลับ) · SKIP ถ้าไม่มี item ที่ eligible
-- ============================================================================
create function pg_temp.g_quote() returns text
 language plpgsql as $c$
declare
  v text := '';
  rs uuid; it record; si jsonb; codes text[]; r jsonb; jid uuid; found_ boolean := false; n0 int;
begin
  select pr.shop_id into rs from public.product pr where pr.shop_id not in (pg_temp.fx('A'), pg_temp.fx('B')) group by pr.shop_id order by count(*) desc limit 1;
  for it in select i.id from analytics.oem_quote_item i where i.shop_id = rs order by i.created_at desc loop
    begin
      si := analytics.job_source_info(rs, 'oem', it.id);
    exception when others then
      continue;
    end;
    if si -> 'existing_job' = 'null'::jsonb then
      found_ := true;
      codes := array(select e from jsonb_array_elements_text(si -> 'suggested_stage_codes') with ordinality as t(e, o) order by o);
      n0 := (select count(*) from analytics.gem_type where shop_id = rs);
      r := pg_temp.q(format('select analytics.job_create_from_quote_item(p_shop_id=>%L, p_quote_item_id=>%L, p_stage_codes=>%L::text[], p_start_gate_note=>%L, p_design_label=>%L, p_actor=>%L, p_gem_lines=>%L::jsonb)',
        rs, it.id, codes, 'verify 0190 เริ่มก่อนมัดจำ', 'ZZ verify 0190', pg_temp.nom(),
        '[{"new_type_name":"ZZ ชนิดทดสอบ 0190","new_shape":{"name":"ZZ ทรงทดสอบ 0190","has_length":false},"size_a":2,"qty_per_piece":3}]'));
      jid := nullif(r ->> 'job_id', '')::uuid;
      v := v || pg_temp.chk('Q1', 'job_create_from_quote_item (ใบเสนอราคา OEM จริงที่ eligible) + p_gem_lines พิมพ์ชนิด/รูปทรงใหม่ → สร้างใบสำเร็จ · BOM 1 แถว source=manual · ชนิดใหม่เข้าแคตตาล็อก · gem_source=input (ถอยกลับหลังเทสต์)',
        r ->> '_err' is null and jid is not null and r ->> 'gem_source' = 'input' and (r ->> 'gem_lines') = '1' and pg_temp.n_bom(jid) = 1
        and (select count(*) from analytics.gem_type where shop_id = rs) = n0 + 1);
      exit;
    end if;
  end loop;
  if not found_ then
    v := v || pg_temp.skip('Q1', 'ไม่มีรายการใบเสนอราคา OEM ที่สร้างใบงานได้ในร้านจริงตอนนี้ — ไม่ได้ทดสอบ job_create_from_quote_item + p_gem_lines (ใช้ job_create_insert ตัวเดียวกับทางใบผลิต ซึ่งทดสอบแล้ว T2-T5)');
  end if;
  return v;
end;
$c$;

-- ============================================================================
-- L. สิทธิ์ (S): anon/authenticated/PUBLIC · overload · definer pin search_path · ตาราง · (ข้อ 18.5 จำลองกำแพงชั้นนอกหลุด)
-- ============================================================================
create function pg_temp.g_perm() returns text
 language plpgsql as $c$
declare
  v text := '';
  r record; sql_ text; bad text := ''; n int; who text;
  c_rpc constant text[] := array[
    'gem_options_list', 'gem_catalog_list', 'gem_catalog_create', 'gem_item_create', 'gem_catalog_rename', 'gem_shape_set_has_length',
    'gem_merge_preview', 'gem_merge', 'gem_catalog_set_active', 'gem_catalog_remove', 'gem_price_set', 'gem_price_history',
    'product_gem_bom_get', 'product_gem_bom_set', 'product_gem_bom_from_job', 'job_gem_bom_get', 'job_gem_bom_set',
    'job_create_from_quote_item', 'job_create_from_production_item', 'job_plan_suggest', 'job_worker_resolve', 'job_gem_state'];
  c_int constant text[] := array[
    'gem_name_norm', 'gem_name_lev', 'gem_name_similar', 'gem_name_ok', 'gem_size_label', 'gem_label_compose', 'gem_line_fail', 'gem_name_clean',
    'gem_type_guard', 'gem_shape_guard', 'gem_item_guard', 'gem_item_live', 'product_gem_bom_guard', 'job_gem_bom_guard',
    'gem_shape_ensure', 'gem_type_canonical', 'gem_shape_canonical', 'gem_item_canonical', 'gem_item_json', 'gem_num_parse', 'gem_int_parse',
    'gem_require_office', 'gem_lines_prepare', 'job_gem_edit_window', 'job_gem_bom_replace_core', 'gem_merge_check', 'gem_merge_plan', 'gem_similar_hits',
    'job_source_info', 'job_create_insert', 'job_create_from_production_item_core'];
begin
  -- S1: ฟังก์ชัน RPC → service_role เท่านั้น (anon/authenticated/PUBLIC ไม่มี) · helper ภายใน → ไม่มี role ไหนเลย
  for r in select p.oid, p.oid::regprocedure::text as sig, p.proname, p.proacl from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = any (c_rpc || c_int) loop
    if has_function_privilege('anon', r.oid, 'execute') or has_function_privilege('authenticated', r.oid, 'execute')
       or r.proacl is null or exists (select 1 from aclexplode(r.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
       or has_function_privilege('service_role', r.oid, 'execute') is distinct from (r.proname = any (c_rpc)) then
      bad := bad || r.sig || '; ';
    end if;
  end loop;
  select count(*) into n from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = any (c_rpc || c_int);
  v := v || pg_temp.chk('S1', format('สิทธิ์ execute ของ %s ฟังก์ชัน (RPC %s + helper %s): anon/authenticated/PUBLIC ไม่มี · RPC = service_role เท่านั้น · helper ไม่มี role ไหน · ผิด: %s', n, cardinality(c_rpc), cardinality(c_int), coalesce(nullif(bad, ''), 'ไม่มี')),
    bad = '' and n = cardinality(c_rpc) + cardinality(c_int));
  -- S2: 18.5 — จำลองวันที่กำแพงชั้นนอกหลุด (grant usage ของสคีมา) แล้วยิง RPC ทุกตัวด้วย null ทุกพารามิเตอร์ → ต้องตก 42501 (Postgres เช็ค EXECUTE ก่อน body รัน จึงไม่เขียนอะไร)
  grant usage on schema analytics to anon, authenticated;
  bad := '';
  foreach who in array array['anon', 'authenticated'] loop
    for r in select p.proname, p.pronargs from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = any (c_rpc) order by p.proname loop
      sql_ := format('select analytics.%I(%s)', r.proname, (select coalesce(string_agg('null', ', '), '') from generate_series(1, r.pronargs)));
      if pg_temp.asrole(who, sql_) <> '42501' then bad := bad || who || ':' || r.proname || '; '; end if;
    end loop;
  end loop;
  revoke usage on schema analytics from anon, authenticated;
  v := v || pg_temp.chk('S2', '18.5: ยิง RPC 21 ตัวด้วย null ทุกพารามิเตอร์ในฐานะ anon และ authenticated (จำลองกำแพงสคีมาหลุด) → ตก 42501 ทั้งหมด · ที่หลุด: ' || coalesce(nullif(bad, ''), 'ไม่มี'), bad = '');
  -- S3: ไม่มี overload (ชื่อละ 1 signature) ทั้ง RPC/helper/ฟังก์ชันที่ replace
  select string_agg(proname, ', ') into bad from (select proname from pg_proc where pronamespace = 'analytics'::regnamespace and proname = any (c_rpc || c_int) group by proname having count(*) > 1) d;
  v := v || pg_temp.chk('S3', 'ไม่มี overload ของฟังก์ชัน 0190 / ที่ replace (job_create_* เปลี่ยน signature แล้ว drop ตัวเดิมครบ) · เกิน: ' || coalesce(bad, 'ไม่มี'), bad is null);
  -- S4: definer ทุกตัวของ RPC ต้อง pin search_path
  select string_agg(p.proname, ', ') into bad from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.proname = any (c_rpc) and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  v := v || pg_temp.chk('S4', 'RPC security definer ทุกตัว pin search_path · ที่ไม่ pin: ' || coalesce(bad, 'ไม่มี'), bad is null);
  -- S5: ตาราง/วิว: RLS · ไม่มี policy · สิทธิ์
  select string_agg(c.relname, ', ') into bad from pg_class c where c.relnamespace = 'analytics'::regnamespace and c.relkind = 'r'
    and c.relname in ('gem_shape', 'gem_type', 'gem_item', 'gem_item_price', 'gem_catalog_event', 'product_gem_bom', 'job_gem_bom')
    and (not c.relrowsecurity or exists (select 1 from pg_policy pl where pl.polrelid = c.oid)
         or has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select')
         or has_table_privilege('service_role', c.oid, 'insert') or has_table_privilege('service_role', c.oid, 'update') or has_table_privilege('service_role', c.oid, 'delete') or has_table_privilege('service_role', c.oid, 'truncate'));
  v := v || pg_temp.chk('S5', 'ตาราง 7 ตัว: RLS เปิด · ไม่มี policy · anon/authenticated ไม่มีสิทธิ์ · service_role ไม่มี insert/update/delete/truncate · ผิด: ' || coalesce(bad, 'ไม่มี'), bad is null);
  v := v || pg_temp.chk('S5b', 'view 2 ตัว: anon/authenticated ไม่มีสิทธิ์ · service_role select ได้',
    not has_table_privilege('anon', 'analytics.v_job_gem_requirement', 'select') and not has_table_privilege('authenticated', 'analytics.v_product_gem_bom', 'select')
    and has_table_privilege('service_role', 'analytics.v_job_gem_requirement', 'select') and has_table_privilege('service_role', 'analytics.v_product_gem_bom', 'select'));
  -- S6: ฟังก์ชันใน analytics ที่ PUBLIC/anon/authenticated ถือ EXECUTE (ทั้งสคีมา — ตรวจเหมือน scripts/check-analytics-grants.sql)
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p cross join lateral aclexplode(p.proacl) a
   where p.pronamespace = 'analytics'::regnamespace and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  v := v || pg_temp.chk('S6', 'ทั้งสคีมา analytics: ไม่มีฟังก์ชันที่ PUBLIC/anon/authenticated ถือ EXECUTE · ที่พบ: ' || coalesce(bad, 'ไม่มี'), bad is null);
  v := v || pg_temp.chk('S7', 'GUC ย้ายอ้างอิง analytics.gem_merge ไม่ค้างเป็น on หลังชุดทดสอบ', coalesce(current_setting('analytics.gem_merge', true), '') in ('', 'off'));
  return v;
end;
$c$;
-- ============================================================================
-- R3. รอบแก้ตาม review (22 ต.ค. · Blocker 1 + S2 + S3): replace_core จับคู่แถวเดิมเมื่อมีแถวใหม่นำหน้า · รวมตำแหน่งทีละคำ · นิยาม "ยังไม่ระบุพลอย" ที่เดียว
-- ============================================================================
create function pg_temp.g_r3() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := pg_temp.fx('A'); b uuid := pg_temp.fx('B');
  rnd uuid := pg_temp.shp(a, 'กลม');
  jm uuid := pg_temp.fx('Jm');
  pA1 uuid := pg_temp.fx('pA1'); pA2 uuid := pg_temp.fx('pA2'); pA3 uuid := pg_temp.fx('pA3');
  r jsonb; r2 jsonb; j jsonb; g jsonb;
  s0 text; c0 text; src0 text; lbl0 text; iold uuid; seq0 int;
  tP uuid; tQ uuid; iP uuid; iQ uuid;
  jn uuid; jn2 uuid; jn3 uuid; jx uuid;
  nb int;
begin
  -- B1 🔴 (review): ใบมีแถว A (ฉลาก snapshot เก่า) → ส่ง [แถวใหม่ B นำหน้า, {gem_item_id: A}] → แถว A ต้องได้ id/ฉลาก/source/created_at เดิม (ไม่ลบ-แทรกใหม่)
  select id::text, created_at::text, source, gem_label, gem_item_id into s0, c0, src0, lbl0, iold from analytics.job_gem_bom where job_id = jm;
  r := pg_temp.bset(a, jm, jsonb_build_array(
         jsonb_build_object('new_type_name', 'ZZB1 พลอยใหม่', 'shape_id', rnd, 'size_a', 7, 'qty_per_piece', 1),
         jsonb_build_object('gem_item_id', iold, 'qty_per_piece', 5, 'position', 'ซ้าย')), pg_temp.own());
  v := v || pg_temp.chk('M5g', 'B1: ส่ง [แถวใหม่นำหน้า, แถวเดิมด้วย gem_item_id] → แถวเดิมคง id/ฉลาก snapshot เดิม/source/created_at · line_seq ขยับเป็น 2 · แถวใหม่ได้ฉลากปัจจุบัน',
    r ->> '_err' is null and pg_temp.n_bom(jm) = 2
    and exists (select 1 from analytics.job_gem_bom x where x.job_id = jm and x.id::text = s0 and x.gem_item_id = iold and x.gem_label = lbl0 and x.source = src0 and x.created_at::text = c0 and x.line_seq = 2 and x.qty_per_piece = 5)
    and exists (select 1 from analytics.job_gem_bom x where x.job_id = jm and x.line_seq = 1 and x.gem_label = 'ZZB1 พลอยใหม่ · กลม · 7 มม.'));
  r := pg_temp.bset(a, jm, jsonb_build_array(jsonb_build_object('gem_item_id', iold, 'qty_per_piece', 5, 'position', 'ซ้าย')), pg_temp.own());
  v := v || pg_temp.chk('M5h', 'B1 (ต้องไม่พัง): ถอนแถวใหม่ออก เหลือแถวเดิมแถวเดียว → id/ฉลากเดิมยังอยู่ · แถวใหม่ถูกลบ',
    r ->> '_err' is null and pg_temp.n_bom(jm) = 1 and exists (select 1 from analytics.job_gem_bom x where x.job_id = jm and x.id::text = s0 and x.gem_label = lbl0 and x.line_seq = 1));

  -- S2: รวมตำแหน่งทีละคำ ไม่ใช่ substring ("ซ้าย" อยู่ใน "ซ้ายบน" ≠ ซ้ำ) — ตรงกับ mergeDuplicateGemRows ฝั่ง TS
  tP := (pg_temp.ccreate(a, 'type', 'ZZS2 พี', null, true) ->> 'id')::uuid;
  tQ := (pg_temp.ccreate(a, 'type', 'ZZS2 คิว', null, true) ->> 'id')::uuid;
  iP := (pg_temp.icreate(a, jsonb_build_object('type_id', tP, 'shape_id', rnd, 'size_a', 6), true) -> 'item' ->> 'gem_item_id')::uuid;
  iQ := (pg_temp.icreate(a, jsonb_build_object('type_id', tQ, 'shape_id', rnd, 'size_a', 6), true) -> 'item' ->> 'gem_item_id')::uuid;
  v := v || pg_temp.chk('S2z', 'fixture: ชนิด ZZS2 พี/คิว · รายการกลม 6 มม. ของแต่ละชนิด', iP is not null and iQ is not null and iP <> iQ);
  r := pg_temp.bset(a, jm, jsonb_build_array(jsonb_build_object('gem_item_id', iP, 'qty_per_piece', 1, 'position', 'ซ้ายบน'), jsonb_build_object('gem_item_id', iP, 'qty_per_piece', 1, 'position', 'ซ้าย')), pg_temp.own());
  v := v || pg_temp.chk('S2a', 'แถวซ้ำ ตำแหน่ง "ซ้ายบน" + "ซ้าย" → "ซ้ายบน, ซ้าย" (ไม่กลืน "ซ้าย" เพราะอยู่ใน "ซ้ายบน") · จำนวนรวม 2 · 1 แถว',
    r ->> '_err' is null and pg_temp.n_bom(jm) = 1 and (select position_note from analytics.job_gem_bom where job_id = jm) = 'ซ้ายบน, ซ้าย' and (select qty_per_piece from analytics.job_gem_bom where job_id = jm) = 2);
  r := pg_temp.bset(a, jm, jsonb_build_array(jsonb_build_object('gem_item_id', iP, 'qty_per_piece', 1, 'position', 'ซ้าย, ขวา'), jsonb_build_object('gem_item_id', iP, 'qty_per_piece', 1, 'position', 'ขวา')), pg_temp.own());
  v := v || pg_temp.chk('S2b', '(ต้องไม่พัง) "ซ้าย, ขวา" + "ขวา" → ยัง "ซ้าย, ขวา" (ซ้ำจริง ไม่ต่อซ้ำ) · จำนวนรวม 2',
    r ->> '_err' is null and (select position_note from analytics.job_gem_bom where job_id = jm) = 'ซ้าย, ขวา' and (select qty_per_piece from analytics.job_gem_bom where job_id = jm) = 2);
  r := pg_temp.bset(a, jm, jsonb_build_array(jsonb_build_object('gem_item_id', iP, 'qty_per_piece', 1, 'position', 'ซ้าย'), jsonb_build_object('gem_item_id', iP, 'qty_per_piece', 1, 'position', 'ซ้าย')), pg_temp.own());
  v := v || pg_temp.chk('S2b2', '(ต้องไม่พัง) "ซ้าย" + "ซ้าย" → "ซ้าย" · จำนวนรวม 2',
    r ->> '_err' is null and (select position_note from analytics.job_gem_bom where job_id = jm) = 'ซ้าย' and (select qty_per_piece from analytics.job_gem_bom where job_id = jm) = 2);
  -- คืนใบ jm เป็นแถวเดิม (M5 ใช้ต่อ)
  r := pg_temp.bset(a, jm, jsonb_build_array(jsonb_build_object('gem_item_id', iold, 'qty_per_piece', 5, 'position', 'ซ้าย')), pg_temp.own());
  -- แม่แบบ SKU ตอนรวมชื่อ: A "ซ้าย" รวมเข้า B "ซ้ายบน" → "ซ้ายบน, ซ้าย" (ไม่กลืน)
  r := pg_temp.tset(a, pA2, jsonb_build_array(jsonb_build_object('gem_item_id', iP, 'qty_per_piece', 1, 'position', 'ซ้ายบน'), jsonb_build_object('gem_item_id', iQ, 'qty_per_piece', 1, 'position', 'ซ้าย')));
  r2 := pg_temp.mrg(a, 'type', tQ, tP);
  g := pg_temp.q(format('select analytics.product_gem_bom_get(%L, %L)', a, pA2));
  v := v || pg_temp.chk('S2c', 'รวมชื่อ ZZS2 คิว→พี: แม่แบบ SKU 2 แถวชนกัน → 1 แถว จำนวน 2 · ตำแหน่ง "ซ้ายบน, ซ้าย" (ไม่กลืนด้วย substring)',
    r ->> '_err' is null and r2 ->> '_err' is null and jsonb_array_length(g -> 'lines') = 1 and (g -> 'lines' -> 0 ->> 'qty_per_piece') = '2' and (g -> 'lines' -> 0 ->> 'position') = 'ซ้ายบน, ซ้าย');

  -- S3: นิยาม "ยังไม่ระบุพลอย" = analytics.job_gem_state ที่เดียว (get · resolve · getJobDetail อ่านจากที่นี่)
  j := pg_temp.mkjob(a, pA3, pg_temp.stdg(), '[]'::jsonb); jn := (j ->> 'job')::uuid;
  g := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jn));
  v := v || pg_temp.chk('S3a', 'ใบมีขั้นฝัง (pending) ไม่มีพลอย → unspecified · job_gem_bom_get.state เท่ากัน', analytics.job_gem_state(a, jn) = 'unspecified' and g ->> 'state' = 'unspecified');
  j := pg_temp.mkjob(a, pA3, pg_temp.stdg(), '[]'::jsonb); jn3 := (j ->> 'job')::uuid;
  perform pg_temp.walk_to(a, jn3, 'gem_set');
  perform pg_temp.step(a, jn3, false);
  g := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jn3));
  v := v || pg_temp.chk('S3b', 'ขั้นฝังรับแล้ว (received) ยังไม่ส่ง · ไม่มีพลอย → ยัง unspecified · get เท่ากัน',
    (select status from analytics.job_stage where job_id = jn3 and stage_code = 'gem_set') = 'received' and analytics.job_gem_state(a, jn3) = 'unspecified' and g ->> 'state' = 'unspecified');
  j := pg_temp.mkjob(a, pA3, pg_temp.stdg(), '[]'::jsonb); jn2 := (j ->> 'job')::uuid;
  perform pg_temp.walk_to(a, jn2, 'qc');
  g := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jn2));
  v := v || pg_temp.chk('S3c', 'ขั้นฝังส่งต่อแล้ว (sent) ไม่มีพลอย → not_needed (ไม่ใช่ unspecified — นิยามเดียวกับหน้าช่าง) · get เท่ากัน',
    (select status from analytics.job_stage where job_id = jn2 and stage_code = 'gem_set') = 'sent' and analytics.job_gem_state(a, jn2) = 'not_needed' and g ->> 'state' = 'not_needed');
  j := pg_temp.mkjob(a, pA1, pg_temp.std()); jx := (j ->> 'job')::uuid;
  g := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jx));
  v := v || pg_temp.chk('S3d', 'ใบไม่มีขั้นฝัง ไม่มีพลอย → not_needed · ใบที่มีพลอย (jm) → specified · get เท่ากัน ทั้งสอง',
    analytics.job_gem_state(a, jx) = 'not_needed' and g ->> 'state' = 'not_needed' and analytics.job_gem_state(a, jm) = 'specified'
    and (pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jm)) ->> 'state') = 'specified');
  v := v || pg_temp.chk('S3e', 'ข้ามร้าน: เรียกด้วย shop B กับใบของ shop A → not_needed (ไม่รั่วว่าใบนั้นมีขั้นฝัง/พลอย) · id มั่ว → not_needed',
    analytics.job_gem_state(b, jn) = 'not_needed' and analytics.job_gem_state(b, jm) = 'not_needed' and analytics.job_gem_state(a, '00000000-0000-0000-0000-00000000dead') = 'not_needed');
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
  v := v || pg_temp.g_pure();
  v := v || pg_temp.g_cat();
  v := v || pg_temp.g_price();
  v := v || pg_temp.g_tpl();
  v := v || pg_temp.g_leak();
  v := v || pg_temp.g_job();
  v := v || pg_temp.g_merge();
  v := v || pg_temp.g_res();
  v := v || pg_temp.g_r3();
  v := v || pg_temp.g_w1();
  return v;
end;
$c$;

create function pg_temp.snap() returns text
 language plpgsql as $c$
declare v text := ''; t text; n text;
begin
  foreach t in array array['analytics.job', 'analytics.job_stage', 'analytics.job_event', 'analytics.job_token', 'analytics.job_counter', 'analytics.job_photo', 'analytics.worker', 'analytics.worker_session', 'analytics.worker_rate_limit',
    'analytics.production_order', 'analytics.production_order_item', 'analytics.production_order_counter', 'analytics.shop_intake_token', 'analytics.stock_lot', 'public.central_stock', 'public.product', 'public.shop', 'public.shop_member',
    'analytics.gem_shape', 'analytics.gem_type', 'analytics.gem_item', 'analytics.gem_item_price', 'analytics.gem_catalog_event', 'analytics.product_gem_bom', 'analytics.job_gem_bom', 'analytics.catalog_audit_log'] loop
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
-- ============================================================================
create function pg_temp.g_mut() returns text
 language plpgsql as $c$
declare
  v text := ''; s text; k int; muts jsonb; m jsonb; st jsonb; hit int; i text; killed int := 0; total int;
  sg_sim constant text := 'analytics.gem_name_similar(text,text)';
  sg_prep constant text := 'analytics.gem_lines_prepare(uuid,jsonb,boolean,uuid,uuid,uuid[])';
  sg_off constant text := 'analytics.gem_require_office(uuid,uuid)';
  sg_set constant text := 'analytics.job_gem_bom_set(uuid,uuid,jsonb,uuid,text,boolean)';
  sg_res constant text := 'analytics.job_worker_resolve(text,text,text)';
  sg_mchk constant text := 'analytics.gem_merge_check(uuid,text,uuid,uuid,boolean)';
  sg_opt constant text := 'analytics.gem_options_list(uuid)';
  sg_grd constant text := 'analytics.job_gem_bom_guard()';
  sg_ins constant text := 'analytics.job_create_insert(uuid,text,uuid,uuid,integer,uuid,uuid,text,text,text,integer,date,text,text,text[],boolean,uuid,integer,numeric,jsonb,uuid,uuid,jsonb,boolean)';
  sg_ok constant text := 'analytics.gem_name_ok(text)';
  sg_src constant text := 'analytics.job_source_info(uuid,text,uuid)';
  sg_tset constant text := 'analytics.product_gem_bom_set(uuid,uuid,jsonb,uuid,boolean)';
  sg_mrg constant text := 'analytics.gem_merge(uuid,uuid,text,uuid,uuid)';
  sg_price constant text := 'analytics.gem_price_set(uuid,uuid,uuid,numeric,date,text,text)';
  sg_ng constant text := 'analytics.gem_item_guard()';
begin
  muts := jsonb_build_array(
    jsonb_build_object('id', 'MU1', 'what', 'ตัวดักคล้าย: ชื่อสั้น ≤ 3 ตัวอักษรไม่ถูกจำกัดให้เทียบเท่ากันอย่างเดียว (CZ↔AZ เตือนมั่ว)', 'steps', jsonb_build_array(jsonb_build_array(sg_sim, '  if v_min <= 3 then return false; end if;', '  if false then return false; end if;')), 'expect', jsonb_build_array('N9', 'N10')),
    jsonb_build_object('id', 'MU2', 'what', 'ตัวดักคล้ายถูกถอด (ไม่ส่ง force ก็ผ่าน)', 'steps', jsonb_build_array(jsonb_build_array(sg_prep, 'if jsonb_array_length(v_hits) > 0 and not v_force then', 'if false then')), 'expect', jsonb_build_array('C3a', 'C4c')),
    jsonb_build_object('id', 'MU3', 'what', 'ชื่อที่ norm เท่ากับของที่มีไม่ถูก resolve ไปตัวเดิม (หาด้วย norm ไม่เจอ)', 'steps', jsonb_build_array(jsonb_build_array(sg_prep, 'select * into v_t from analytics.gem_type t where t.shop_id = p_shop_id and t.name_norm = v_tnorm;', 'select * into v_t from analytics.gem_type t where t.shop_id = p_shop_id and t.name_norm = v_tnorm || ''zz'';')), 'expect', jsonb_build_array('C2b')),
    jsonb_build_object('id', 'MU4', 'what', 'ไม่ตรวจว่า actor เป็นสมาชิก owner/admin (staff/คนนอกอ่านราคา-จัดการแคตตาล็อกได้)', 'steps', jsonb_build_array(jsonb_build_array(sg_off, 'if not exists (select 1 from public.shop_member m where m.shop_id = p_shop_id and m.user_id = p_actor and m.role in (''owner'', ''admin'')) then', 'if false then')), 'expect', jsonb_build_array('P3')),
    jsonb_build_object('id', 'MU5', 'what', 'เพดานจำนวนต่อชิ้นขยับ 1,000 → 100,000', 'steps', jsonb_build_array(jsonb_build_array(sg_prep, 'if v_qty is null or not (v_qty between 1 and 1000) then', 'if v_qty is null or not (v_qty between 1 and 100000) then')), 'expect', jsonb_build_array('C6-q2', 'C6')),
    jsonb_build_object('id', 'MU6', 'what', 'ขนาดไม่ตรวจทศนิยม ≤ 2 (cast เข้าคอลัมน์ปัดเงียบ)', 'steps', jsonb_build_array(jsonb_build_array(sg_prep, 'if not (v_a > 0 and v_a <= 100) or v_a <> round(v_a, 2) then', 'if not (v_a > 0 and v_a <= 100) then')), 'expect', jsonb_build_array('C6-s4')),
    jsonb_build_object('id', 'MU7', 'what', 'แก้พลอยหลังขั้นฝังรับโดยไม่ต้องมีเหตุผล', 'steps', jsonb_build_array(jsonb_build_array(sg_set, 'if v_window = ''reason_required'' and v_reason is null then', 'if false then')), 'expect', jsonb_build_array('J3a')),
    jsonb_build_object('id', 'MU8', 'what', 'หน้าช่างอ่านฉลากจากแคตตาล็อกสด (ไม่ใช้ snapshot) — ชื่อเปลี่ยนแล้วใบเก่าเปลี่ยนตาม', 'steps', jsonb_build_array(jsonb_build_array(sg_res, 'jsonb_build_object(''label'', g.gem_label,', 'jsonb_build_object(''label'', (analytics.gem_item_json(g.gem_item_id) ->> ''label''),')), 'expect', jsonb_build_array('R4')),
    jsonb_build_object('id', 'MU9', 'what', 'merge ลงตัวเองไม่ถูกปฏิเสธ', 'steps', jsonb_build_array(jsonb_build_array(sg_mchk, 'if p_from = p_into then', 'if false then')), 'expect', jsonb_build_array('M3a')),
    jsonb_build_object('id', 'MU10', 'what', '🔴 รายการ dropdown (gem_options_list) แอบแนบราคา', 'steps', jsonb_build_array(jsonb_build_array(sg_opt, '''size_label'', x.size_label) order by x.size_a', '''size_label'', x.size_label, ''price'', (select max(p.price_thb_per_unit) from analytics.gem_item_price p where p.gem_item_id = x.id)) order by x.size_a')), 'expect', jsonb_build_array('P5')),
    jsonb_build_object('id', 'MU11', 'what', 'trigger ของ job_gem_bom ไม่กันใบ done/cancelled (กำแพงที่ตารางถูกถอด)', 'steps', jsonb_build_array(jsonb_build_array(sg_grd, '  if v_job.status in (''done'', ''cancelled'') then', '  if false then')), 'expect', jsonb_build_array('J4d')),
    jsonb_build_object('id', 'MU12', 'what', 'ใบที่ไม่มีขั้นฝังก็คัดลอกแม่แบบ (ถอนเงื่อนไข gem_set)', 'steps', jsonb_build_array(jsonb_build_array(sg_ins, 'elsif p_product_id is not null and ''gem_set'' = any (p_codes)', 'elsif p_product_id is not null and true')), 'expect', jsonb_build_array('T3')),
    jsonb_build_object('id', 'MU13', 'what', 'ชื่อที่เป็นตัวเลขล้วนผ่าน (ถอดด่านเลขล้วนทุกระบบเลข)', 'steps', jsonb_build_array(jsonb_build_array(sg_ok, '     and analytics.gem_name_norm(p_name) ~ ''[[:alpha:]]''', '')), 'expect', jsonb_build_array('N16k', 'N16l', 'N16y1', 'N16y2', 'N16y11', 'C6-n2', 'C6-n7')),
    jsonb_build_object('id', 'MU13b', 'what', 'ด่านตัวอักษรจริงเหลือแค่ "ไม่ใช่เลข ASCII" (เลขไทย/อารบิก-อินดิกหลุด)', 'steps', jsonb_build_array(jsonb_build_array(sg_ok, '~ ''[[:alpha:]]''', '~ ''[^0-9]''')), 'expect', jsonb_build_array('N16y1', 'N16y2', 'N16y5')),
    jsonb_build_object('id', 'MU14', 'what', 'SKU ที่มีแม่แบบไม่ถูกเสนอขั้นฝัง (job_source_info)', 'steps', jsonb_build_array(jsonb_build_array(sg_src, '      if v_tpl > 0 then v_codes := v_codes || ''gem_set''::text; end if;', '      null;')), 'expect', jsonb_build_array('T6a', 'W1b')),
    jsonb_build_object('id', 'MU15', 'what', 'ตั้งแม่แบบ SKU ไม่เขียน audit log', 'steps', jsonb_build_array(jsonb_build_array(sg_tset, E'  if v_changed then\n    insert into analytics.catalog_audit_log', E'  if false then\n    insert into analytics.catalog_audit_log')), 'expect', jsonb_build_array('T1')),
    jsonb_build_object('id', 'MU16', 'what', 'รวมชื่อแล้วแม่แบบ SKU ไม่ย้ายตามไปรายการปลายทาง', 'steps', jsonb_build_array(jsonb_build_array(sg_mrg, 'update analytics.product_gem_bom set gem_item_id = r.b_id, updated_at = now() where id = l.id;', 'null;')), 'expect', jsonb_build_array('M2t')),
    jsonb_build_object('id', 'MU17', 'what', 'ราคา: ถอดด่าน not(between) + ทศนิยม (NaN/Infinity/0 ไหลเข้า)', 'steps', jsonb_build_array(jsonb_build_array(sg_price, 'if p_price is null or not (p_price > 0 and p_price <= 1000000) or p_price <> round(p_price, 4) then', 'if p_price is null then')), 'expect', jsonb_build_array('P2')),
    jsonb_build_object('id', 'MU19', 'what', 'แก้ราคาทับวันเดิม/ย้อนหลังโดยไม่ต้องมี note', 'steps', jsonb_build_array(jsonb_build_array(sg_price, 'if (v_had or v_eff < v_today) and (v_note is null or not analytics.oem_note_present(v_note)) then', 'if false then')), 'expect', jsonb_build_array('P7b', 'P7c')),
    jsonb_build_object('id', 'MU20', 'what', 'ไม่บันทึก audit ก่อน upsert ราคา', 'steps', jsonb_build_array(jsonb_build_array(sg_price, 'values (p_shop_id, p_item_id, v_eff, case when v_had then ''update'' else ''insert'' end, v_old.price_thb_per_unit, p_price, v_old.supplier, v_sup, v_note, p_actor);', 'select p_shop_id, p_item_id, v_eff, ''insert'', null::numeric, p_price, null, null, null, p_actor where false;')), 'expect', jsonb_build_array('P7a', 'P7d')),
    jsonb_build_object('id', 'MU21', 'what', 'trigger ของ gem_item ตรวจ "ปิดใช้งาน" ทั้งสองฝั่งตอนย้าย (รวมชื่อล้มเมื่ออีกฝั่งปิด)', 'steps', jsonb_build_array(jsonb_build_array(sg_ng, '    v_chk_t := new.gem_type_id is distinct from old.gem_type_id;', '    v_chk_t := true;'), jsonb_build_array(sg_ng, '    v_chk_s := new.gem_shape_id is distinct from old.gem_shape_id;', '    v_chk_s := true;')), 'expect', jsonb_build_array('M9a', 'M9b')),
    jsonb_build_object('id', 'MU22', 'what', 'แก้ใบหลังรวมชื่อ: ไม่จับคู่แถวเดิมด้วย canonical (ลบ-แทรกใหม่ ฉลาก snapshot ถูกเขียนทับ)', 'steps', jsonb_build_array(jsonb_build_array('analytics.job_gem_bom_replace_core(uuid,jsonb,boolean,uuid,uuid,text,text,text,uuid[])', ' or analytics.gem_item_canonical(g.gem_item_id) = (v_ln ->> ''gem_item_id'')::uuid)', ' or false)')), 'expect', jsonb_build_array('M5e')),
    jsonb_build_object('id', 'MU23', 'what', '🔴 B1: จับคู่แถวเดิมด้วย not(id = any(v_map)) — v_map มี NULL ทำให้แถวเดิมที่ตามหลังแถวใหม่ถูกลบ-แทรกใหม่ (ฉลาก snapshot ถูกทับ)', 'steps', jsonb_build_array(jsonb_build_array('analytics.job_gem_bom_replace_core(uuid,jsonb,boolean,uuid,uuid,text,text,text,uuid[])', 'and g.id <> all (array_remove(v_map, null))   --', 'and not (g.id = any (v_map))   --')), 'expect', jsonb_build_array('M5g')),
    jsonb_build_object('id', 'MU24', 'what', 'S2: รวมแถวซ้ำตอนบันทึกใบใช้ substring (ตำแหน่ง "ซ้าย" กลืนหายใน "ซ้ายบน")', 'steps', jsonb_build_array(jsonb_build_array(sg_prep, 'not (v_pos2 = any (string_to_array(v_pos, '', '')))', 'position(v_pos2 in v_pos) = 0')), 'expect', jsonb_build_array('S2a')),
    jsonb_build_object('id', 'MU25', 'what', 'S2: รวมชื่อแล้วแม่แบบ SKU รวมตำแหน่งด้วย substring', 'steps', jsonb_build_array(jsonb_build_array(sg_mrg, 'l.position_note = any (string_to_array(coalesce(v_lb.position_note, ''''), '', ''))', 'position(l.position_note in coalesce(v_lb.position_note, '''')) > 0')), 'expect', jsonb_build_array('S2c')),
    jsonb_build_object('id', 'MU26', 'what', 'S3: job_gem_state ไม่นับขั้นฝังที่รับแล้ว (received) เป็น "ยังไม่ระบุ"', 'steps', jsonb_build_array(jsonb_build_array('analytics.job_gem_state(uuid,uuid)', 'gs.status in (''pending'', ''received'')', 'gs.status in (''pending'')')), 'expect', jsonb_build_array('S3b')),
    jsonb_build_object('id', 'MU27', 'what', 'S3: job_gem_state ไม่กรองร้าน (ใบร้านอื่นรั่วว่ามีขั้นฝัง)', 'steps', jsonb_build_array(jsonb_build_array('analytics.job_gem_state(uuid,uuid)', 'where gj.shop_id = p_shop_id and (gj.id', 'where (gj.id')), 'expect', jsonb_build_array('S3e')),
    jsonb_build_object('id', 'MU28', 'what', 'S3: job_gem_state ไม่ดูแถวพลอย (มีพลอยก็ยังบอก unspecified)', 'steps', jsonb_build_array(jsonb_build_array('analytics.job_gem_state(uuid,uuid)', 'g.shop_id = p_shop_id and g.job_id = p_root_job_id) then ''specified''', 'false) then ''specified''')), 'expect', jsonb_build_array('S3d')),
    jsonb_build_object('id', 'MU18', 'what', 'trigger ของ gem_item ไม่เช็ค size_b ตรงกับ has_length (กำแพงที่ตาราง)', 'steps', jsonb_build_array(jsonb_build_array(sg_ng, '  if v_s.has_length is distinct from (new.size_b is not null) then', '  if false then')), 'expect', jsonb_build_array('C9a')));
  total := jsonb_array_length(muts);
  for k in 0 .. total - 1 loop
    m := muts -> k; s := '';
    begin
      for st in select value from jsonb_array_elements(m -> 'steps') loop
        perform pg_temp.mutate(st ->> 0, st ->> 1, st ->> 2);
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
do $v190$
declare
  v_msg text := E'\n=== verify 0190 ===\n';
  v_snap0 text; v_hit int; v_fail int; v_ok int; v_skip int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  create temp table _v190_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h, p.proacl::text as acl
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p');
  v_snap0 := pg_temp.snap();
  begin
    v_msg := v_msg || pg_temp.g_all();
    v_msg := v_msg || pg_temp.g_perm();
    v_msg := v_msg || pg_temp.g_golden();
    v_msg := v_msg || pg_temp.g_quote();
    v_msg := v_msg || pg_temp.g_mut();
    select count(*) into v_hit from _v190_orig o join pg_proc p on p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p') and p.oid::regprocedure::text = o.sig
     where md5(pg_get_functiondef(p.oid)) = o.h and p.proacl::text is not distinct from o.acl;
    v_msg := v_msg || pg_temp.chk('MY', format('หลัง mutant: md5 นิยาม + สิทธิ์ของฟังก์ชันทุกตัวในสคีมา analytics (%s ตัว) เท่าเดิมเป๊ะ', (select count(*) from _v190_orig)),
      v_hit = (select count(*) from _v190_orig) and (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and prokind in ('f', 'p')) = (select count(*) from _v190_orig));
    raise exception 'V190_ROLLBACK';
  exception when others then
    if sqlerrm <> 'V190_ROLLBACK' then v_msg := v_msg || format('[FAIL] S1-crash  ชุดหลัก raise นอกกลุ่ม: %s %s', sqlstate, sqlerrm) || E'\n'; end if;
  end;
  v_msg := v_msg || pg_temp.chk('K0', 'ชุดทดสอบไม่ทิ้งรอย: snapshot (job/ใบผลิต/ตัวนับ/QR ร้าน/ช่าง/session/product/shop/สมาชิก/ตารางพลอยทั้งหมด/audit) เท่าเดิมหลังถอยกลับ', pg_temp.snap() = v_snap0);
  v_fail := (length(v_msg) - length(replace(v_msg, '[FAIL]', ''))) / length('[FAIL]');
  v_skip := (length(v_msg) - length(replace(v_msg, '[SKIP]', ''))) / length('[SKIP]');
  v_ok := (length(v_msg) - length(replace(v_msg, '[OK]', ''))) / length('[OK]');
  v_msg := v_msg || format(E'\n--- สรุป: OK %s · FAIL %s · SKIP %s ---', v_ok, v_fail, v_skip);
  raise exception '%', v_msg;
end;
$v190$;

-- scripts/verify/verify-0162.sql
-- ตรวจ supabase/migrations/0162_content_feedback_verdict_inbox.sql หลัง apply (หรือต่อท้าย 0161 + 0162 ใน dry-run เดียว)
-- self-rolling-back do-block ตาม 3j-migration-traps #11: ทุกเคสเก็บผลลง v_log แล้ว raise exception ปิดท้ายเสมอ ⇒ ทั้งทรานแซกชัน rollback ·
-- ผลทดสอบออกทาง error message · DB ไม่ขยับ ไม่ว่า PASS หรือ FAIL (ร้านทดสอบ B/C/X + แคมเปญ/ข้อเสนอ/สรุป/ออเดอร์ทดสอบ สร้างในทรานแซกชันแล้วหายพร้อม rollback)
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0162.sql
-- dry-run ก่อน apply: ต่อไฟล์ 0161 + 0162 + ไฟล์นี้เป็นไฟล์เดียว (0161 ยังไม่ apply ⇒ ต้องมีก่อนเสมอ) แล้วรันแบบไม่ใส่ --commit
-- ผล: run-sql พิมพ์ "ล้มเหลว" พร้อม message = v_log (ช่องทางรายงานผลปกติ) · [FAIL] ≥ 1 = ไม่ผ่าน · [SKIP] = พิสูจน์ในไฟล์นี้ไม่ได้ (บอกเหตุผลไว้)
--
-- ⚠️ ข้อมูลจริงไม่ถูกแก้ — ทุกเคสที่เขียน/แก้ใช้แถวของร้านทดสอบ B/C/X ที่สร้างเอง · ส่วนที่แตะข้อมูลจริง (N8d-f: propose/confirm บนแคมเปญเก่าจริง 1 แถว) อยู่ใน
--    ทรานแซกชันที่ rollback · ร้านจริงต้องมีร้านเดียวใน public.shop
-- ⚠️ ไฟล์นี้มีการ grant ชั่วคราวใน ทรานแซกชัน (usage สคีมา → authenticated · insert/update/delete บน recommendation_log / content_weekly_summary → service_role)
--    แล้ว revoke กลับก่อนจบ และพิสูจน์ซ้ำว่ากลับสู่เดิม (Y20j · Y22h · Y23b) — ทั้งหมดอยู่ใน rollback
--
-- ============ ตารางแมป "เคสในสเปก §13.7/§13.8/§13.x + บรีฟรอบนี้ → assertion" (id ใน log) ============
--  Y13 plan_set ปฏิเสธ: key ผิด/ชนิดผิด/NaN/นอกช่วง/วัน/pair/ขอบเขตไม่ใช่ orders/ข้อความ/actor/ร้านอื่น/ปิดแล้ว/ai บนชิ้น posted → Y13a-k + Y13z · ต้องไม่พัง Y13m1-m10 (ตั้งเต็ม 12 key · no-change · json null · ล้างเป็นคู่ · ai ก่อนเริ่ม · owner บน posted)
--  Y14 propose ปฏิเสธ: หลักฐานผิด 8 แบบ/verdict/actor/ด่าน 4 ชิ้น/ปิดแล้ว/ร้านอื่น → Y14a-d + Y14z · ต้องไม่พัง Y14m1-m7 · ai ทับข้อเสนอ owner = 42501 → Y14e1-e3
--  Y15 confirm ปฏิเสธ: actor/CAS null+ผิด/verdict/บทเรียน-note ผิด/ร้านอื่น → Y15a-e + Y15z · ด่าน 4 ชิ้น → G3/G3b/G7 · ⚠️ "ชิ้น in_review ค้าง = ปฏิเสธ" ของสเปกเดิมถูกทับด้วย Q12 → Q12b (ผ่าน + บันทึก)
--  Y16 trigger campaign (service_role) → Y16a-h + Y16z · ต้องไม่พัง Y16i-l (status done · blocked_reason/note/anchor · INSERT ธรรมดา · ค่าเดิมทับค่าเดิม)
--  Y17 recommendation_create ปฏิเสธ → Y17a-h + Y17z · Y18 กันซ้ำ (RPC + index ตาราง) → Y18a-c + Y18z · ต้องไม่พัง Y18d-e · R1-R6
--  Y19 recommendation_respond ปฏิเสธ → Y19a-f + Y19z (รวมแถวจริงที่ตอบแล้ว) · ต้องไม่พัง R3-R5b · N12 (หมดเวลา/ตอบช้า/14 วัน/acceptance) → N12a-e
--  Y20 reco เขียนตรง: service_role 42501 → Y20a-d · grant กลับ → trigger 55000 → Y20e-i + Y20j-z · postgres แก้เนื้อหาแถวที่ตอบแล้ว 55000 → Y20k-l · ต้องไม่พัง N16a-d (MCP/postgres) · Y20m
--  Y21 weekly_summary_upsert ปฏิเสธ → Y21a-f + Y21z · ห้ามทับเงียบ (ai/system ทับของ owner) → Y21g1-g3 · ต้องไม่พัง W1-W6 (สร้าง/ส่งซ้ำไม่เขียน/ทับ revision/CRLF/emoji ZWJ)
--  Y22 weekly เขียนตรง (service_role 42501 → grant กลับ → trigger 55000) → Y22a-j · Y23 authenticated/anon → Y23a-c (13 ตัว: ฟังก์ชันไม่ใช่ trigger 9 + view 2 + ตาราง 2)
--  N1  ข้อมูลเดิมไม่ขยับ → N1a-b · P1 · (md5 ทุกตาราง = ด่านท้ายไฟล์ migration ตอนรัน) · N2 view เดิม (v_campaign_board · v_recommendation_acceptance) → N2a-b · N4 ฟังก์ชัน 0148-0161 ไม่ถูกแตะ → N4 + ด่านท้ายไฟล์ (md5 ทั้ง schema)
--  N8  แคมเปญเก่า 100%: summary 1 แถว/แคมเปญ · stage · flow เต็มบนแคมเปญเก่าจริง (propose → inbox → confirm → ปิด) → N8a-f
--  N10 threshold_too_narrow = นิพจน์เดียวกับ v_content_piece + ผลจริง 3 กรณี → N10a-d · N11 inbox 3 แขน (reco จริง · risk_gate ตรง owner_questions · ตัวนับกอง 4) → N11a-f
--  N13 FK SET NULL (summary/step/campaign) แถวประวัติ reco อยู่ครบ → N13a-d · N16 weekly brief task เดิม/MCP (postgres insert + ปิดข้อเสนอเก่าตรง) → N16a-d
--  N17 ไม่มี \r + signature เดียวต่อชื่อ + idempotent (dry-run 0161→0162→0161→0162 แยก · ด่านท้ายไฟล์ผ่าน 2 รอบ) → N17a · A1b · N18 วันไทย → N18a-c
--  Q12 ปิดแคมเปญที่มีชิ้นค้าง: ผ่าน + result_open_pieces + payload + ชิ้นค้าง/ยกเลิกไม่นับ + บทเรียน→signal + ยืนยันซ้ำ + CAS ('' / none) → Q12a-o · G1-G8
--  Q10 weekly ฉบับเต็ม (markdown 80,000 · เก็บ newline) → W1 · Y21d
--  ORD metric ออเดอร์ระดับแคมเปญ: ช่วงวัน/ช่องทาง/กลุ่มสินค้า/ตะกร้าผสม/ข้ามร้าน/ศูนย์ที่รู้/ไม่รู้ช่วงวัน/ข้อมูลไม่ถึง/เกณฑ์ >=,<=/ด่านคำตัดสิน/payload → O1-O18 · A5g-s (CHECK)
--  A   โครงสร้าง/สิทธิ์/overload/trigger/FK/CHECK/index → A1-A5
--  ไม่มีเทสต์ครอบ (บอกตรงๆ): ท้ายไฟล์ [SKIP] — N9/N15 (grep แอป · กดหน้าเดิม) · race 2 connection (for update) · เวลาคร่อม 00:00-07:00 · TRUNCATE ตอนถูก grant กลับ · SET ROLE เป็น postgres
--
-- ============ mutant ที่ทำให้ verify ล้มจริง (ลองแล้ว 28 แบบ — V = verify จับ · G = ด่านท้ายไฟล์ migration จับก่อน) ============
--  M01 confirm ยอม ai/system → Y15a1/a2 V · M02 CAS ยอม null → Y15b1 V · M03 Q12 กลับไปปฏิเสธเมื่อมีชิ้นค้าง → Q12b/c/e-h V · M04 ด่าน 4 ชิ้นไม่กรองชิ้น posted → G7 V ·
--  M05 CHECK ขอบเขต orders ไม่ coalesce → A5g V · M06 ปิด trigger campaign → Y16a-f V · M07 ไม่ถอด revoke recommendation_log → G · M08 ไม่มี unique index → G ·
--  M09 weekly ai ทับของ owner → Y21g1-g3 V · M10 propose ai ทับข้อเสนอ owner → Y14e1-e3 V · M11 respond ไม่มี CAS → Y19f/R5/R5b V · M12 create ไม่ตรวจซ้ำ → Y18a V ·
--  M13 respond ไม่ตรวจ marker → Y19d1 V · M14 plan_set ไม่เช็คปิดแล้ว → Y13j1/j2 V · M15 view orders ไม่กรอง affinity → O1/O4/O7 V · M16 expired 14→140 วัน → N11a/N12d V ·
--  M17 confirm ข้ามด่านเนื้อหา → G3/G3b/G5 V · M18 weekly ไม่ short-circuit → W2-W4 V · M19 bidi regex ไม่รวม 202A-202E → Y21dd/W1 V · M20 gate orders ไม่ตรวจเกณฑ์ → O15b V ·
--  M21 signal บทเรียนซ้ำไม่ตรวจ → Q12j/k V · M22 reco ตอบแล้วแก้เนื้อหาได้ → Y20k/l V · M23 FK summary CASCADE → G + N13a ·
--  M24 ai ตั้งแผนบนแคมเปญที่โพสต์แล้ว → Y13k1/k2 V · M25 late กลับด้าน → R3/N12b V · M26 confirm ไม่ตั้ง status done → Q12b/N8e/O17 V · M27 weekly ไม่ clean บรรทัด → Y21cd/cf V ·
--  M28 inbox risk_gate รวมชิ้นที่ posted → N11e/N11f V (เคยหลุดรอบแรก → เพิ่ม N11f)
--  ⚠️ mutant "ถอด for update" (ทั้ง 6 RPC) = ไม่ล้าง — ต้องใช้ 2 connection (do-block เดียวจำลองไม่ได้) → [SKIP] ท้ายไฟล์

-- ============ รอบแก้ตาม security (CONDITIONAL GO — High 3) + QA (PASS with notes) 7 ต.ค. 69 — ตารางแมป "ข้อในบรีฟ → เทสต์ที่ครอบ" ============
--  SEC-H1 validated/invalidated บน orders ต้อง covers_window = true · data_through ทั้งร้านไม่กรองช่องทาง · ร้านไม่มีข้อมูลเลย (null) = ไม่ครอบ → H1a-H1m (ข้อมูลยังไม่ถึง · ขอบ D+2 ตก / D+1 ผ่าน · tiktok ศูนย์ออเดอร์ในช่วงที่ร้านมีข้อมูลครบ = ผ่าน · ร้านไม่มีออเดอร์ = 55000 "ไม่มีข้อมูลเลย" · inconclusive ยังเสนอ/ยืนยันได้ H1f/H1f2) + qa-0162-extra C8c/C8d บนแคมเปญ 10.10 จริง
--  SEC-H2 คำตอบเจ้าของแก้ย้อนหลังไม่ได้ (owner_response แยกจาก outcome_note · guard ล็อก owner_action/owner_response/acted_at/acted_by/acted_by_role ทุก role รวม postgres) → H2a-H2p · outcome_note แก้ได้ H2l · แถวเก่าที่ acted_by_role ว่างยังปิดตรงได้ H2n/N16b/N16c · A5t-A5v CHECK
--         ❌ ไม่มีเทสต์ครอบ: postgres ตั้ง acted_by_role = owner เองบนแถว pending (ปลอมคำตอบ) = ข้อจำกัดที่ยอมรับ (D18) — บันทึกเป็น [NOTE] H2q ไม่ใช่ pass/fail
--  SEC-M1 CAS token ของเนื้อหาที่เจ้าของเห็น (confirm + respond) บังคับไม่ null · เนื้อหาเปลี่ยน = 55000 → M1a-M1r (token เปลี่ยนเมื่อข้อเสนอ/หลักฐาน/แผนเปลี่ยน · ไม่เปลี่ยนเมื่อแก้ status/note/outcome_note · view ตรงฟังก์ชัน) · helper q_conf/q_rresp ส่ง token 'auto' ทุกเคสเดิม
--  SEC-M2 ai/system แก้แผนไม่ได้เมื่อเริ่มแล้ว/มีข้อเสนอคำตัดสิน (ขอบ anchor = วันนี้ ตก · พรุ่งนี้ ผ่าน · ค่า metric_date_from ใหม่ที่ถอยมาวันนี้/ก่อนหน้า ตก · owner ผ่านเสมอ) → S2a-S2j + S2z
--  SEC-M3 content_bidi_present_ ขยาย + ข้อความสั้นตรวจซ้ำ → Y17i-<codepoint> (36 ตัว) · Y17j1-3 · Y17k1-2 (ZWJ/ZWNJ/tab/LF/CR ต้องผ่าน) · Y21h-<codepoint> (22 ตัวในเนื้อหา Brief) · Y21c (บรรทัดสรุป) · Y13g/Y14a/Y15d5-6/Y19d3 (ข้อความสั้นของ plan/propose/confirm/respond)
--         ⚠️ content_text_clean ของ 0158 ไม่ถูกแก้ — ช่องของ 0158-0161 (content_signal/hook ฯลฯ) ยังไม่ครอบชุดใหม่: ❌ ไม่มีเทสต์ครอบ (นอกขอบเขตไฟล์นี้ · รอ Tech Lead ตัดสิน)
--  SEC-M5 db.ts cleanupTenant/hasDbEnv → supabase/tests/db-helper-guards.test.ts (9 เคสไม่ต่อ DB) · guard SQL ของ cleanupTenant (ชื่อ + อายุ 1 ชม. + for update) พิสูจน์ด้วย do-block บน DB จริง (ROLLBACK) — ❌ ไม่มีไฟล์ถาวรใน repo ครอบส่วน SQL (ต้องมี DB · รันครั้งเดียวตอนแก้)
--  SEC-Low recommendation_log revoke all + grant select → A3d (ACL ตรง) · Y20j · ด่านท้ายไฟล์ · service_role ตั้ง status done ตรง → Y16i/Y16i2a-c/Y16i3/Y16i4 · INSERT ปลอม "เจ้าของยืนยัน" ครบตาม CHECK → Y16m (mutant 3) / Y16m2 · แคมเปญที่ยกเลิกทุกชิ้น → X1-X6
--         ⚠️ campaign.status ไม่มีค่า cancelled (CHECK 0049) — ตีความเป็น "ยกเลิกทุกชิ้น" และฟันได้แค่ inconclusive/not_measured (มติ Q12) — บอก Tech Lead แล้ว
--  QA-1   บรรทัดสรุปเพดาน 1000 → W7 (1000 ผ่าน) · W8 (5×1000 + body 80000) · Y21ce (1001 ตก) · qa-0162-realbrief.mjs 8/8
--  QA-4   p_lesson null = คงเดิม / '' = ล้าง → Q12l-Q12l4 · qa-0162-extra C11b (แคมเปญจริง)
--  QA-5   create ชื่อซ้ำ pending → id เดิม created=false (+ conflict) → Y18a · Y18b · Y18b2 (พารามิเตอร์เดิมเป๊ะ = conflict false) · Y18b3 (ไม่ทับเงียบ) · Y18c (index ชั้นตาราง)
--         ❌ ไม่มีเทสต์ครอบ: แขน "insert ... on conflict do nothing แล้วอ่านแถวเดิมกลับ" (สองคำสั่งแข่งกันผ่านการตรวจพร้อมกัน) — ต้องใช้ 2 connection
--
-- ============ mutant รอบแก้ (19 แบบ — ล้มทุกแบบ · V = verify ล้ม · G = ด่านท้ายไฟล์ migration จับ) ============
--  Mutant 1 (ของ Tech Lead) ลบ source/kind/shop_id ออกจาก tuple ใน guard → H2h/H2i/H2j/H2z V
--  Mutant 2 (ของ Tech Lead) ลบ 200E 200F 061C 2060-2064 ออกจาก regex → Y17i-8206/8207/1564/8288/8292 + Y21h-… + W1-W4 (ถูกเนื้อหาล่องหนลอดเข้าไป) V
--  Mutant 3 (ของ Tech Lead) ลบ confirmed_at/_by_role/result_open_pieces ออกจาก num_nonnulls ตอน INSERT → Y16m V
--  M4 confirm ไม่เทียบ token → M1c2/M1e/M1f/M1g/M1h/M1j/M1k V · M18 confirm ยอม token null → M1b/M1c V · M5 respond ไม่เทียบ token → M1n2/M1p V (+ ABORT เพราะแถวถูกตอบไปก่อนเคสถัดไป)
--  M6 gate ไม่เช็ค covers_window → H1b-H1g/H1m V · M7 data_through กรองช่องทางกลับ → H1i/H1j/H1k V
--  M8 ด่านเริ่มแล้วใช้ > แทน >= → S2a/S2b V · M9 ai แก้แผนหลังมีข้อเสนอได้ → S2i1-S2i3 V · M10 ไม่ตรวจวันเริ่มช่วงนับใหม่ของ ai → S2g/S2g2/S2h V
--  M11 service_role ตั้ง status done ได้ → Y16i/Y16i3 V · M12 ไม่ล็อกคำตอบเจ้าของ → H2b-H2g/H2o/H2z V · M13 ไม่ส่งบทเรียน = ทับเป็นว่าง → Q12l/Q12l2 V · M14 เพดานสรุปกลับ 300 → W7/W8 V
--  M15 ไม่กันแคมเปญยกเลิกทุกชิ้น → X1-X3 V · M16 conflict ไม่เทียบเนื้อหา → Y18a/Y18b V · M17 plan_set ไม่ตรวจ bidi ข้อความสั้น → Y13gi-Y13gk V · M19 revoke แค่ i/u/d/truncate (แบบเดิม) → G
--  ⚠️ mutant "ถอด for update" (ทั้ง 6 RPC) = ไม่ล้าง — ต้องใช้ 2 connection → [SKIP] ท้ายไฟล์ (เหมือนรอบก่อน)

-- ---------- helper (temp function — หายพร้อมทรานแซกชัน) ----------

create or replace function pg_temp.vx(p_sql text, p_expect text[], p_like text default null) returns text
 language plpgsql as $vx$
declare
  v_state text; v_msg text;
begin
  execute p_sql;
  return 'FAIL ผ่านทั้งที่ควรปฏิเสธ';
exception when others then
  get stacked diagnostics v_msg = message_text;
  v_state := sqlstate;
  if v_state = any (p_expect) then
    if p_like is not null and position(p_like in v_msg) = 0 then
      return 'FAIL sqlstate ถูก (' || v_state || ') แต่ข้อความไม่มี "' || p_like || '" → ' || left(v_msg, 200);
    end if;
    return 'OK ' || v_state || ' msg=' || left(v_msg, 90);
  end if;
  return 'FAIL sqlstate=' || v_state || ' msg=' || left(v_msg, 160);
end $vx$;

create or replace function pg_temp.vok(p_sql text) returns text
 language plpgsql as $vk$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return 'FAIL ควรสำเร็จแต่ตก sqlstate=' || sqlstate || ' msg=' || left(sqlerrm, 200);
end $vk$;

create or replace function pg_temp.vl(p_id text, p_what text, p_res text) returns text
 language sql as $vl$
  select '[' || case when p_res like 'OK%' and p_res not like '%FAIL%' then 'OK' else 'FAIL' end || '] ' || p_id || ' ' || p_what || ' → ' || p_res || E'\n'
$vl$;

create or replace function pg_temp.vb(p_id text, p_what text, p_cond boolean, p_detail text default '') returns text
 language sql as $vb$
  select '[' || case when p_cond is true then 'OK' else 'FAIL' end || '] ' || p_id || ' ' || p_what
         || case when p_detail <> '' then ' → ' || p_detail else '' end || E'\n'
$vb$;

-- รัน p_sql ภายใต้ role จริง (set local role) · reset role ทุกทาง
create or replace function pg_temp.vr(p_role text, p_sql text, p_expect text[], p_like text default null) returns text
 language plpgsql as $vr$
declare v_res text;
begin
  execute format('set local role %I', p_role);
  v_res := pg_temp.vx(p_sql, p_expect, p_like);
  execute 'reset role';
  return v_res;
exception when others then
  execute 'reset role';
  raise;
end $vr$;

create or replace function pg_temp.vro(p_role text, p_sql text) returns text
 language plpgsql as $vro$
declare v_res text;
begin
  execute format('set local role %I', p_role);
  v_res := pg_temp.vok(p_sql);
  execute 'reset role';
  return v_res;
exception when others then
  execute 'reset role';
  raise;
end $vro$;

-- ผลลัพธ์ของ SQL ที่ "ควรสำเร็จ" เป็นข้อความ (jsonb::text) — ล้มเหลวคืน 'ERR sqlstate msg' (ไว้เทียบใน assertion)
create or replace function pg_temp.vj(p_sql text) returns jsonb
 language plpgsql as $vj$
declare v_j jsonb;
begin
  execute p_sql into v_j;
  return v_j;
exception when others then
  return jsonb_build_object('error', sqlstate, 'msg', left(sqlerrm, 200));
end $vj$;

-- ตัวช่วยประกอบคำสั่งเรียก RPC (format %L ครอบทุกค่า — null ได้)
create or replace function pg_temp.q_plan(p_shop uuid, p_camp uuid, p_set text, p_role text) returns text
 language sql as $q$
  select format('select analytics.campaign_plan_set(%L::uuid,%L::uuid,%L::jsonb,%L)', p_shop, p_camp, p_set, p_role)
$q$;
create or replace function pg_temp.q_prop(p_shop uuid, p_camp uuid, p_verdict text, p_note text, p_role text) returns text
 language sql as $q$
  select format('select analytics.campaign_verdict_propose(%L::uuid,%L::uuid,%L,%L,%L)', p_shop, p_camp, p_verdict, p_note, p_role)
$q$;
-- p_tok = 'auto' → token ปัจจุบันจาก analytics.campaign_verdict_token_ ณ ตอนรันคำสั่ง (เหมือนหน้าจอที่เพิ่งอ่านล่าสุด) · ส่งค่าอื่น/null = ใช้ตามนั้น (ทดสอบ token เก่า/ผิด)
create or replace function pg_temp.q_conf(p_shop uuid, p_camp uuid, p_verdict text, p_lesson text, p_role text, p_note text, p_exp text, p_tok text default 'auto') returns text
 language sql as $q$
  select format('select analytics.campaign_verdict_confirm(%L::uuid,%L::uuid,%L,%L,%L,%L,%L,%s)', p_shop, p_camp, p_verdict, p_lesson, p_role, p_note, p_exp,
                case when p_tok = 'auto' then format('analytics.campaign_verdict_token_(%L::uuid)', p_camp) else format('%L', p_tok) end)
$q$;
create or replace function pg_temp.q_rcreate(p_shop uuid, p_title text, p_detail text, p_role text, p_kind text default 'proposal',
                                             p_source text default 'agent', p_effort int default null, p_resp text default null,
                                             p_def text default null, p_camp uuid default null, p_step uuid default null, p_sum uuid default null) returns text
 language sql as $q$
  select format('select to_jsonb(analytics.recommendation_create(%L::uuid,%L,%L,%L,%L,%L,%L::int,%L::date,%L,%L::uuid,%L::uuid,%L::uuid))',
                p_shop, p_title, p_detail, p_role, p_kind, p_source, p_effort, p_resp, p_def, p_camp, p_step, p_sum)
$q$;
create or replace function pg_temp.q_rresp(p_shop uuid, p_id uuid, p_action text, p_resp text, p_role text, p_tok text default 'auto') returns text
 language sql as $q$
  select format('select analytics.recommendation_respond(%L::uuid,%L::uuid,%L,%L,%L,%s)', p_shop, p_id, p_action, p_resp, p_role,
                case when p_tok = 'auto' then format('analytics.recommendation_token_(%L::uuid)', p_id) else format('%L', p_tok) end)
$q$;
create or replace function pg_temp.q_wsum(p_shop uuid, p_week text, p_brief text, p_lines text, p_body text, p_role text,
                                          p_no int default null, p_path text default null) returns text
 language sql as $q$
  select format('select analytics.content_weekly_summary_upsert(%L::uuid,%L::date,%L::date,%L::text[],%L,%L,%L::int,%L)', p_shop, p_week, p_brief, p_lines, p_body, p_role, p_no, p_path)
$q$;

create or replace function pg_temp.ext() returns text
 language sql as $ex$ select 'v162-' || substr(gen_random_uuid()::text, 1, 12) $ex$;
create or replace function pg_temp.url(p_ext text default null) returns text
 language sql as $ur$ select 'https://www.tiktok.com/@verify162/video/' || coalesce(p_ext, substr(gen_random_uuid()::text, 1, 12)) $ur$;

-- สร้างแคมเปญทดสอบผ่าน RPC จริง: ชิ้นแรกวันที่ p_anchor (null = ไอเดียไม่มีวัน ⇒ แคมเปญไม่มี anchor) · คืน campaign_id
create or replace function pg_temp.mk_camp(p_shop uuid, p_anchor date) returns uuid
 language plpgsql as $mc$
declare v_s uuid;
begin
  v_s := analytics.content_piece_create(p_shop, 'verify-0162 camp ' || substr(gen_random_uuid()::text, 1, 8), 'short_clip', 'tiktok', 'jewelry_925', 'owner', p_anchor);
  return (select campaign_id from analytics.campaign_step where id = v_s);
end $mc$;

-- ชิ้นงานในแคมเปญที่มีอยู่ (วันเดียวกับ anchor ⇒ offset 0) ไล่ถึง in_review (ลอก verify-0161 mk_step)
create or replace function pg_temp.mk_piece_in(p_shop uuid, p_camp uuid, p_anchor date) returns uuid
 language plpgsql as $mp$
declare
  v_s uuid;
  v_a uuid;
begin
  v_s := analytics.content_piece_create(p_shop, 'verify-0162 piece ' || substr(gen_random_uuid()::text, 1, 8), 'short_clip', 'tiktok', 'jewelry_925', 'owner', p_anchor, null, p_camp);
  perform analytics.content_piece_advance(p_shop, v_s, 'drafting', 'owner');
  select a.id into v_a from analytics.step_artifact a where a.step_id = v_s;
  perform analytics.content_hook_upsert(p_shop, v_s, 'A', 'verify hook A', 'question', null, 'owner', null);
  perform analytics.content_hook_upsert(p_shop, v_s, 'B', 'verify hook B', 'fact', null, 'owner', null);
  perform analytics.campaign_set_artifact_content(v_a, 'verify body',
    jsonb_build_object('segments', jsonb_build_array(jsonb_build_object('role', 'hook')),
                       'shots', jsonb_build_array(jsonb_build_object('id', 's1', 'desc', 'ถ่ายหน้าโต๊ะ'),
                                                  jsonb_build_object('id', 's2', 'desc', 'ใกล้ๆ'))));
  perform analytics.content_piece_advance(p_shop, v_s, 'in_review', 'owner');
  return v_s;
end $mp$;

-- ชิ้นที่โพสต์แล้ว (+ metric T+7 ถ้า p_t7) ในแคมเปญ · p_idx 1..8 ทำให้วันโพสต์ต่างกัน (ย้อน 11-idx วัน) · คืน step id
create or replace function pg_temp.mk_posted_in(p_shop uuid, p_camp uuid, p_anchor date, p_idx int, p_t7 boolean) returns uuid
 language plpgsql as $mpo$
declare
  v_s    uuid;
  v_hook uuid;
  v_ext  text := pg_temp.ext();
  v_post uuid;
  v_day  date;
begin
  v_s := pg_temp.mk_piece_in(p_shop, p_camp, p_anchor);
  perform analytics.content_gate_record(p_shop, v_s, 'fact_check', 'passed', 'owner', jsonb_build_object('sources', jsonb_build_array('https://example.com/a')));
  perform analytics.content_gate_record(p_shop, v_s, 'brand_rule', 'passed', 'owner');
  perform analytics.content_gate_record(p_shop, v_s, 'risk_owner', 'passed', 'owner');
  perform analytics.content_piece_advance(p_shop, v_s, 'approved', 'owner', null, 45);
  perform analytics.content_piece_advance(p_shop, v_s, 'produced', 'owner');
  select id into v_hook from analytics.content_hook where step_id = v_s and label = 'A';
  perform analytics.content_piece_post(p_shop, v_s, 'tiktok', v_ext, pg_temp.url(v_ext), now() - make_interval(days => 11 - p_idx), 'owner', v_hook, null, null, null);
  if p_t7 then
    select p.id, p.posted_date_th into v_post, v_day from analytics.content_post p where p.step_id = v_s;
    insert into analytics.content_post_metric (shop_id, post_id, captured_on, age_days, view_count, like_count, comment_count, save_count, share_count, source, sources, is_regression)
    values (p_shop, v_post, v_day + 7, 7, 1000, 100, null, 30 + p_idx, null, 'manual', array['manual'], false);
  end if;
  return v_s;
end $mpo$;

-- ออเดอร์ทดสอบ (insert ตรงโดย postgres) พร้อม line item ตาม product_id ที่ส่งมา · p_prods ว่าง = ออเดอร์ไม่มี line item
create or replace function pg_temp.mkord(p_shop uuid, p_channel uuid, p_day date, p_prods uuid[]) returns uuid
 language plpgsql as $mo$
declare
  v_id uuid;
  v_p  uuid;
begin
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values (p_shop, 'V162-' || substr(gen_random_uuid()::text, 1, 12), p_channel, p_day, 100)
  returning id into v_id;
  foreach v_p in array coalesce(p_prods, '{}'::uuid[]) loop
    insert into analytics.fact_order_item (shop_id, fact_order_id, product_id, qty, unit_price) values (p_shop, v_id, v_p, 1, 100);
  end loop;
  return v_id;
end $mo$;

-- ภาพรวมแถวที่ "ไม่ควรขยับ" หลัง reject (campaign 1 แถว · reco ทั้งร้าน · weekly ทั้งร้าน)
create or replace function pg_temp.csnap(p_camp uuid) returns text
 language sql as $cs$
  select md5(coalesce((select concat_ws('|', status, result_verdict, result_note, hypothesis, metric_code, baseline_value, baseline_spread, baseline_as_of,
                                          baseline_note, pass_threshold, pass_op, metric_channel_code, metric_affinity, metric_date_from, metric_date_to,
                                          result_verdict_proposed, result_proposed_note, result_proposed_at, result_proposed_by_role,
                                          result_verdict_confirmed_at, result_verdict_confirmed_by_role, lesson, result_open_pieces, updated_at)
                         from analytics.campaign where id = p_camp), ''))
$cs$;
create or replace function pg_temp.rsnap(p_shop uuid) returns text
 language sql as $rs$
  select (select count(*) from analytics.recommendation_log where shop_id = p_shop) || ':' ||
         md5(coalesce((select string_agg(concat_ws('|', id, owner_action, acted_at, outcome_note, title, detail, respond_by, default_action, kind, updated_at), ',' order by id)
                         from analytics.recommendation_log where shop_id = p_shop), ''))
$rs$;
create or replace function pg_temp.wsnap(p_shop uuid) returns text
 language sql as $ws$
  select (select count(*) from analytics.content_weekly_summary where shop_id = p_shop) || ':' ||
         md5(coalesce((select string_agg(concat_ws('|', id, week_start, brief_date, brief_no, array_to_string(summary_lines, '~'), body_md, source_path, revision, updated_by_role, updated_at), ',' order by id)
                         from analytics.content_weekly_summary where shop_id = p_shop), ''))
$ws$;

do $verify0162$
declare
  c_fn      constant text := '^(content_bidi_present_|campaign_open_pieces_|campaign_verdict_gate_|campaign_verdict_token_|recommendation_token_|content_weekly_summary_guard|campaign_result_guard|recommendation_log_guard|campaign_plan_set|campaign_verdict_propose|campaign_verdict_confirm|recommendation_create|recommendation_respond|content_weekly_summary_upsert)$';
  v_log     text := E'\n=== verify-0162 ===\n';
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
  v_shop    uuid;
  v_shopB   uuid;
  v_shopC   uuid;
  v_shopX   uuid;
  v_n       bigint;
  v_n2      bigint;
  v_r       text;
  v_s1      text;
  v_s2      text;
  v_bad     text;
  v_j       jsonb;
  v_j2      jsonb;
  v_b       boolean;
  v_id      uuid;
  v_id2     uuid;
  v_id3     uuid;
  v_cA      uuid;   -- แคมเปญหลักของร้าน B (ไอเดียไม่มีวัน)
  v_cB      uuid;   -- แคมเปญมี anchor
  v_cC      uuid;   -- แคมเปญที่จะปิดแล้ว
  v_cD      uuid;   -- แคมเปญที่มีชิ้น posted
  v_cE      uuid;   -- แคมเปญของร้าน C
  v_cF      uuid;   -- save_rate gate
  v_cG      uuid;   -- orders
  v_cL      uuid;   -- แคมเปญเก่าจริง (ร้านจริง)
  v_cH      uuid;
  v_cI      uuid;
  v_cJ      uuid;
  v_cK      uuid;
  v_cG2     uuid;
  v_cM      uuid;   -- SEC-M2: anchor = วันนี้
  v_cM2     uuid;   -- anchor = พรุ่งนี้
  v_cM3     uuid;   -- anchor ผ่านมาแล้ว + ช่วงนับอนาคต
  v_cM4     uuid;   -- anchor อนาคต + จะมีข้อเสนอ
  v_cN      uuid;   -- ไม่มี anchor
  v_cX      uuid;   -- ยกเลิกทุกชิ้น
  v_cY      uuid;   -- ยกเลิก 1 + ยังค้าง 1
  v_cO      uuid;   -- SEC-H1 orders: ข้อมูลยังไม่ถึง
  v_cO2     uuid;
  v_cO3     uuid;
  v_cT      uuid;   -- SEC-M1 token
  v_rT      uuid;
  v_rO      uuid;   -- SEC-H2 ข้อเสนอที่เจ้าของตอบผ่าน RPC
  v_tok     text;
  v_tok2    text;
  v_tok3    text;
  v_mon     date;
  v_step    uuid;
  v_step2   uuid;
  v_sig     uuid;
  v_k       text;
  v_i       int;
  v_anchor  date;
  v_prod_bar uuid;
  v_prod_jw  uuid;
  v_prod_nt  uuid;
  v_ch_line  uuid;
  v_ch_tt    uuid;
  v_day     date;
  v_snapA   text;
  v_snapR   text;
  v_snapW   text;
  v_t0      text;
  v_t1      text;
  r         record;
  v_fail    int;
  v_ok      int;
begin
  begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);

  select count(*) into v_n from public.shop;
  if v_n <> 1 then
    raise exception 'verify-0162: ต้องมีร้านเดียวใน public.shop (พบ %) — ทดสอบไม่ได้', v_n;
  end if;
  select id into v_shop from public.shop;

  ----------------------------------------------------------------------------
  -- N1/P: ข้อมูลจริง "ก่อนแตะอะไร" — 0162 ไม่ขยับของเดิม (ด่านท้ายไฟล์ migration เทียบ md5 ตอน apply · ที่นี่ยืนยันค่าผลลัพธ์)
  ----------------------------------------------------------------------------
  select count(*) into v_n from analytics.recommendation_log where kind <> 'proposal' or respond_by is not null or default_action is not null
     or related_step_id is not null or summary_id is not null or created_by_role is not null or acted_by_role is not null;
  v_log := v_log || pg_temp.vb('N1a', 'recommendation_log แถวเดิมทุกแถว: kind = proposal · คอลัมน์ใหม่อื่นว่างหมด (ไม่เดา role ของของเก่า)', v_n = 0, 'ผิดปกติ ' || v_n || ' แถว');
  select count(*) into v_n from analytics.campaign
   where num_nonnulls(metric_code, baseline_value, baseline_spread, baseline_as_of, baseline_note, pass_threshold, pass_op, metric_channel_code, metric_affinity,
                      metric_date_from, metric_date_to, result_verdict_proposed, result_proposed_note, result_proposed_at, result_proposed_by_role,
                      result_verdict_confirmed_at, result_verdict_confirmed_by_role, lesson, result_open_pieces) > 0;
  v_log := v_log || pg_temp.vb('N1b', 'campaign ทุกแถวจริง: คอลัมน์ใหม่ทั้ง 19 ว่างหมด · ไม่มีใครถูกตั้ง metric/คำตัดสินให้โดย migration', v_n = 0, 'ผิดปกติ ' || v_n || ' แถว');
  select count(*) into v_n from analytics.campaign where id = '75a252d4-6de4-4c07-81d0-aa712098bca2'
     and result_verdict = 'not_measured' and result_verdict_confirmed_at is null and result_verdict_proposed is null and lesson is null
     and status = 'scheduled' and (metric_code is null or metric_code = 'orders');
  select count(*) into v_n2 from analytics.campaign where id = '75a252d4-6de4-4c07-81d0-aa712098bca2';
  v_log := v_log || pg_temp.vb('P1', 'แคมเปญ 10.10 (75a252d4…): ยังไม่ยืนยันคำตัดสิน · ไม่มีข้อเสนอ · status เดิม scheduled (Tech Lead ตั้ง metric ภายหลังผ่าน campaign_plan_set)', v_n2 = 0 or v_n = 1, v_n || '/' || v_n2);
  select count(*) into v_n from analytics.v_campaign_summary where shop_id = v_shop;
  select count(*) into v_n2 from analytics.campaign where shop_id = v_shop;
  v_log := v_log || pg_temp.vb('N8a', 'v_campaign_summary 1 แถวต่อแคมเปญจริงทุกแถว (รวมแคมเปญเก่า)', v_n = v_n2 and v_n > 0, v_n || '/' || v_n2);
  select count(*) into v_n from analytics.v_campaign_summary s
   where s.shop_id = v_shop and s.pieces_total = 0 and (s.verdict_display is not null or s.awaiting_confirm or s.orders_actual is not null or s.pieces_open <> 0);
  v_log := v_log || pg_temp.vb('N8b', 'แคมเปญเก่าที่ไม่มีชิ้น (pieces_total 0): verdict_display ว่าง (ไม่แสดง not_measured เป็นคำตัดสิน) · ไม่รอยืนยัน · ไม่มี orders_actual', v_n = 0, 'ผิดปกติ ' || v_n);
  select count(*) into v_n from analytics.v_campaign_summary s join analytics.campaign c on c.id = s.campaign_id
   where s.shop_id = v_shop and s.stage <> case when c.status = 'done' then 'closed' when s.pieces_total > 0 and s.pieces_open = 0 and s.pieces_posted > 0 then 'awaiting_read'
                                                 when s.pieces_posted > 0 or s.pieces_in_progress > 0 or c.status in ('active', 'blocked', 'waiting_data') then 'running' else 'draft' end;
  v_log := v_log || pg_temp.vb('N8c', 'stage ของแคมเปญจริงทุกแถว = สูตรในสเปก (คำนวณซ้ำอิสระ)', v_n = 0, 'ไม่ตรง ' || v_n);
  -- N11: แขน reco ของ inbox ตรงกับตารางจริง (นับตาม effective_action คำนวณอิสระ)
  select count(*) into v_n from analytics.v_recommendation_inbox i join analytics.recommendation_log rl on rl.id = i.item_id
   where i.item_kind = 'reco' and i.shop_id = v_shop
     and i.effective_action is distinct from (case when rl.owner_action <> 'pending' then rl.owner_action
                                                    when rl.respond_by is null and now() - rl.created_at > interval '14 days' then 'expired' else 'pending' end);
  v_log := v_log || pg_temp.vb('N11a', 'inbox แขน reco ของข้อเสนอจริง: effective_action = กติกา 0101 (done/rejected คงเดิม · pending เกิน 14 วัน = expired)', v_n = 0, 'ไม่ตรง ' || v_n);
  select count(*) into v_n from analytics.v_recommendation_inbox where item_kind = 'risk_gate' and shop_id = v_shop;
  select owner_questions into v_n2 from analytics.v_content_inbox_counts where shop_id = v_shop;
  v_log := v_log || pg_temp.vb('N11b', 'inbox item_kind risk_gate ของร้านจริง = v_content_inbox_counts.owner_questions (0160)', v_n = coalesce(v_n2, 0), v_n || '/' || coalesce(v_n2::text, 'null'));
  select count(*) into v_n from analytics.v_recommendation_acceptance where shop_id = v_shop;
  v_log := v_log || pg_temp.vb('N2a', 'v_recommendation_acceptance (0101) ยัง select ได้ และคอลัมน์ครบ 9 (ไม่ถูกแตะ)', (select count(*) from information_schema.columns where table_schema = 'analytics' and table_name = 'v_recommendation_acceptance') = 9, 'แถว ' || v_n);
  select count(*) into v_n from analytics.v_campaign_board where shop_id = v_shop;
  v_log := v_log || pg_temp.vb('N2b', 'v_campaign_board (0160/0145) ยัง select ได้ ไม่ error', v_n >= 0, 'แถว ' || v_n);

  insert into public.shop (name) values ('verify-0162 shop B') returning id into v_shopB;
  insert into public.shop (name) values ('verify-0162 shop C') returning id into v_shopC;
  insert into public.shop (name) values ('verify-0162 shop X') returning id into v_shopX;

  ----------------------------------------------------------------------------
  -- A. โครงสร้าง / สิทธิ์ / overload / trigger / FK / วันไทย
  ----------------------------------------------------------------------------
  select count(*) into v_n from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname ~ c_fn;
  v_log := v_log || pg_temp.vb('A1', 'ฟังก์ชันของ 0162 มี 14 ตัว (helper 5 + trigger 3 + RPC 6) signature เดียวต่อชื่อ (trap #1)', v_n = 14, 'พบ ' || v_n);
  select string_agg(x.proname || '=' || x.n, ', ') into v_bad
    from (select p.proname, count(*) n from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname ~ c_fn group by p.proname having count(*) <> 1) x;
  v_log := v_log || pg_temp.vb('A1b', 'pg_proc ต่อชื่อ = 1 ทั้ง 14 ชื่อ', v_bad is null, coalesce(v_bad, '-'));
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.pronamespace = 'analytics'::regnamespace and p.proname ~ c_fn and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  v_log := v_log || pg_temp.vb('A2', 'ไม่มี PUBLIC/anon/authenticated ถือ EXECUTE บนฟังก์ชันของ 0162 (trap #18 · aclexplode+acldefault)', v_bad is null, coalesce(v_bad, '-'));
  select count(*) into v_n from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname ~ c_fn and has_function_privilege('service_role', p.oid, 'execute');
  v_log := v_log || pg_temp.vb('A2b', 'service_role เรียกได้ครบ 14 ตัว (RPC definer ต้องรันได้)', v_n = 14, 'พบ ' || v_n);
  select string_agg(c.relname, ', ') into v_bad from pg_class c
   where c.relnamespace = 'analytics'::regnamespace and c.relname in ('v_campaign_summary', 'v_recommendation_inbox') and not coalesce(c.reloptions @> array['security_invoker=true'], false);
  v_log := v_log || pg_temp.vb('A3', 'view ใหม่ 2 ตัวเป็น security_invoker', v_bad is null, coalesce(v_bad, '-'));
  select string_agg(c.relname || ':' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ', ') into v_bad
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.relnamespace = 'analytics'::regnamespace and c.relname in ('v_campaign_summary', 'v_recommendation_inbox', 'content_weekly_summary')
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  v_log := v_log || pg_temp.vb('A3b', 'ไม่มี PUBLIC/anon/authenticated บน view ใหม่ + content_weekly_summary', v_bad is null, coalesce(v_bad, '-'));
  select string_agg(a.privilege_type, ',') into v_bad
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.oid = 'analytics.content_weekly_summary'::regclass and a.grantee = 'service_role'::regrole and a.privilege_type <> 'SELECT';
  v_log := v_log || pg_temp.vb('A3c', 'service_role เขียนตรงลง content_weekly_summary ไม่ได้ (มีแค่ SELECT) — บทเรียน 0161 H1/M3', v_bad is null, coalesce(v_bad, '-'));
  -- SEC-Low: revoke all + grant select — ทุกสิทธิ์นอกจาก SELECT (รวม REFERENCES/TRIGGER) ต้องไม่มี · อ่านจาก ACL ตรง
  select string_agg(a.privilege_type, ',') into v_bad
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.oid = 'analytics.recommendation_log'::regclass and a.grantee = 'service_role'::regrole and a.privilege_type <> 'SELECT';
  v_log := v_log || pg_temp.vb('A3d', 'service_role มีแค่ SELECT บน recommendation_log (ไม่มี INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER — ประวัติการตัดสินของเจ้าของ)',
    v_bad is null and has_table_privilege('service_role', 'analytics.recommendation_log'::regclass, 'SELECT'), coalesce(v_bad, '-'));
  v_log := v_log || pg_temp.vb('A3e', 'content_weekly_summary เปิด RLS', (select c.relrowsecurity from pg_class c where c.oid = 'analytics.content_weekly_summary'::regclass));
  v_log := v_log || pg_temp.vb('A3f', 'ตารางแม่ที่ cascade เข้าประวัติยังถอดสิทธิ์ลบจาก service_role (0161 H1): public.shop · campaign · campaign_step',
    not has_table_privilege('service_role', 'public.shop'::regclass, 'DELETE') and not has_table_privilege('service_role', 'analytics.campaign'::regclass, 'DELETE')
    and not has_table_privilege('service_role', 'analytics.campaign_step'::regclass, 'DELETE'));
  select string_agg(c.conname || ':' || c.confdeltype::text, ', ') into v_bad from pg_constraint c
   where c.conrelid = 'analytics.recommendation_log'::regclass and c.contype = 'f'
     and c.confrelid in ('analytics.campaign_step'::regclass, 'analytics.content_weekly_summary'::regclass, 'analytics.campaign'::regclass) and c.confdeltype <> 'n';
  v_log := v_log || pg_temp.vb('A4', 'FK ที่ชี้เข้า recommendation_log (campaign/step/summary) เป็น ON DELETE SET NULL ทั้งหมด — ไม่มี cascade ลบประวัติ', v_bad is null, coalesce(v_bad, '-'));
  select count(*) into v_n from pg_trigger t where t.tgrelid = 'analytics.campaign'::regclass and not t.tgisinternal and t.tgenabled = 'O';
  select count(*) into v_n2 from pg_trigger t where t.tgrelid = 'analytics.recommendation_log'::regclass and not t.tgisinternal and t.tgenabled = 'O';
  v_log := v_log || pg_temp.vb('A4b', 'trigger เปิดอยู่: campaign 2 (guard + updated_at) · recommendation_log 2 · content_weekly_summary 2', v_n = 2 and v_n2 = 2
    and (select count(*) from pg_trigger t where t.tgrelid = 'analytics.content_weekly_summary'::regclass and not t.tgisinternal and t.tgenabled = 'O') = 2, v_n || '/' || v_n2);
  select count(*) into v_n from pg_index i join pg_class c on c.oid = i.indexrelid
   where i.indrelid = 'analytics.recommendation_log'::regclass and c.relname = 'uq_recommendation_log_pending_title' and i.indisunique and i.indpred is not null;
  v_log := v_log || pg_temp.vb('A4c', 'uq_recommendation_log_pending_title เป็น partial unique index', v_n = 1);

  -- CHECK ระดับตาราง (postgres ตรง — ด่านถัดไปจากชนิดข้อมูล) · แคมเปญ A = ไอเดียไม่มีวันของร้าน B
  v_cA := pg_temp.mk_camp(v_shopB, null);
  v_log := v_log || pg_temp.vl('A5a', 'campaign.metric_code = bogus → CHECK', pg_temp.vx(format('update analytics.campaign set metric_code = %L where id = %L', 'bogus', v_cA), array['23514']));
  v_log := v_log || pg_temp.vl('A5b', 'campaign.baseline_value = NaN → CHECK (trap #4 · not between)', pg_temp.vx(format('update analytics.campaign set baseline_value = %L::numeric where id = %L', 'NaN', v_cA), array['23514']));
  v_log := v_log || pg_temp.vl('A5c', 'campaign.pass_threshold = 1e12+1 → CHECK', pg_temp.vx(format('update analytics.campaign set pass_threshold = 1000000000001, pass_op = %L where id = %L', '>=', v_cA), array['23514']));
  v_log := v_log || pg_temp.vl('A5d', 'campaign.baseline_spread ติดลบ → CHECK', pg_temp.vx(format('update analytics.campaign set baseline_spread = -1 where id = %L', v_cA), array['23514']));
  v_log := v_log || pg_temp.vl('A5e', 'campaign.pass_op = > → CHECK', pg_temp.vx(format('update analytics.campaign set pass_threshold = 1, pass_op = %L where id = %L', '>', v_cA), array['23514']));
  v_log := v_log || pg_temp.vl('A5f', 'campaign pass_threshold มีแต่ pass_op ว่าง → CHECK คู่', pg_temp.vx(format('update analytics.campaign set pass_threshold = 5 where id = %L', v_cA), array['23514']));
  v_log := v_log || pg_temp.vl('A5g', 'campaign ตั้งขอบเขตออเดอร์ทั้งที่ metric_code ว่าง → CHECK (coalesce กัน null ผ่านเงียบ — trap #13)',
    pg_temp.vx(format('update analytics.campaign set metric_channel_code = %L where id = %L', 'line_oa', v_cA), array['23514']));
  v_log := v_log || pg_temp.vl('A5h', 'campaign ตั้งขอบเขตออเดอร์ทั้งที่ metric_code = save_rate → CHECK',
    pg_temp.vx(format('update analytics.campaign set metric_code = %L, metric_affinity = %L where id = %L', 'save_rate', 'bar', v_cA), array['23514']));
  v_log := v_log || pg_temp.vl('A5i', 'campaign metric_date_from มีแต่ to ว่าง → CHECK', pg_temp.vx(format('update analytics.campaign set metric_code = %L, metric_date_from = %L where id = %L', 'orders', v_today, v_cA), array['23514']));
  v_log := v_log || pg_temp.vl('A5j', 'campaign metric_date_to < from → CHECK', pg_temp.vx(format('update analytics.campaign set metric_code = %L, metric_date_from = %L, metric_date_to = %L where id = %L', 'orders', v_today, v_today - 1, v_cA), array['23514']));
  v_log := v_log || pg_temp.vl('A5k', 'campaign metric_date ช่วง 400 วัน → CHECK', pg_temp.vx(format('update analytics.campaign set metric_code = %L, metric_date_from = %L, metric_date_to = %L where id = %L', 'orders', v_today, v_today + 400, v_cA), array['23514']));
  v_log := v_log || pg_temp.vl('A5l', 'campaign metric_date_to = infinity → CHECK', pg_temp.vx(format('update analytics.campaign set metric_code = %L, metric_date_from = %L, metric_date_to = %L::date where id = %L', 'orders', v_today, 'infinity', v_cA), array['23514']));
  v_log := v_log || pg_temp.vl('A5m', 'campaign result_verdict_proposed ไม่มี at/by_role/note → CHECK consistency', pg_temp.vx(format('update analytics.campaign set result_verdict_proposed = %L where id = %L', 'validated', v_cA), array['23514']));
  v_log := v_log || pg_temp.vl('A5n', 'campaign result_verdict_confirmed_at ไม่มี by_role/open_pieces → CHECK consistency', pg_temp.vx(format('update analytics.campaign set result_verdict_confirmed_at = now() where id = %L', v_cA), array['23514']));
  v_log := v_log || pg_temp.vl('A5o', 'campaign confirmed_by_role = ai → CHECK', pg_temp.vx(format('update analytics.campaign set result_verdict_confirmed_at = now(), result_verdict_confirmed_by_role = %L, result_open_pieces = 0 where id = %L', 'ai', v_cA), array['23514']));
  v_log := v_log || pg_temp.vl('A5p', 'campaign lesson ยาว 501 → CHECK', pg_temp.vx(format('update analytics.campaign set lesson = repeat(%L, 501) where id = %L', 'ก', v_cA), array['23514']));
  v_log := v_log || pg_temp.vl('A5q', 'campaign result_proposed_note ยาว 2 → CHECK', pg_temp.vx(format('update analytics.campaign set result_verdict_proposed = %L, result_proposed_note = %L, result_proposed_at = now(), result_proposed_by_role = %L where id = %L', 'validated', 'ok', 'ai', v_cA), array['23514']));
  v_log := v_log || pg_temp.vl('A5r', 'campaign result_open_pieces ติดลบ → CHECK', pg_temp.vx(format('update analytics.campaign set result_verdict_confirmed_at = now(), result_verdict_confirmed_by_role = %L, result_open_pieces = -1 where id = %L', 'owner', v_cA), array['23514']));
  v_log := v_log || pg_temp.vl('A5s', 'ต้องไม่พัง: campaign ตั้ง metric orders + ขอบเขตครบ + เกณฑ์ครบ โดย postgres ผ่าน CHECK ทั้งหมด',
    pg_temp.vok(format('update analytics.campaign set metric_code = %L, metric_channel_code = %L, metric_affinity = %L, metric_date_from = %L, metric_date_to = %L, pass_threshold = 6, pass_op = %L where id = %L', 'orders', 'line_oa', 'bar', v_today, v_today + 3, '>=', v_cA)));
  execute format('update analytics.campaign set metric_code = null, metric_channel_code = null, metric_affinity = null, metric_date_from = null, metric_date_to = null, pass_threshold = null, pass_op = null where id = %L', v_cA);
  v_log := v_log || pg_temp.vb('A5t', 'recommendation_log.owner_response มีคอลัมน์ (text) + CHECK ความยาว 1-1000 (ตรวจกับแถวจริงทีหลัง A5u-v)', exists (select 1 from information_schema.columns where table_schema = 'analytics' and table_name = 'recommendation_log' and column_name = 'owner_response' and data_type = 'text')
    and exists (select 1 from pg_constraint c where c.conrelid = 'analytics.recommendation_log'::regclass and c.conname = 'recommendation_log_owner_response_check' and c.convalidated));

  ----------------------------------------------------------------------------
  -- fixture แคมเปญ (ร้าน B ยกเว้น cE ของร้าน C)
  --   cA ไอเดียไม่มีวัน (plan_set หลัก) · cB มี anchor + ชิ้น planned · cC ปิดแล้ว (postgres ตั้งตรง) · cD มีชิ้น posted · cE ร้าน C
  ----------------------------------------------------------------------------
  v_anchor := v_today + 5;
  v_cB := pg_temp.mk_camp(v_shopB, v_anchor);
  v_cC := pg_temp.mk_camp(v_shopB, null);
  update analytics.campaign set result_verdict = 'inconclusive', result_verdict_confirmed_at = now(), result_verdict_confirmed_by_role = 'owner', result_open_pieces = 0 where id = v_cC;
  v_cD := pg_temp.mk_camp(v_shopB, v_anchor);
  perform pg_temp.mk_posted_in(v_shopB, v_cD, v_anchor, 1, false);
  v_cE := pg_temp.mk_camp(v_shopC, null);
  select count(*) into v_n from analytics.campaign_step where campaign_id = v_cD and piece_status = 'posted';
  v_log := v_log || pg_temp.vb('F0', 'fixture: แคมเปญ cD มีชิ้น posted 1 ชิ้นผ่าน RPC จริง (content_piece_post)', v_n = 1, 'posted ' || v_n);

  ----------------------------------------------------------------------------
  -- Y13: campaign_plan_set ต้องถูกปฏิเสธ (ยิงบน cA ที่ว่าง · ค่าที่ "ถูก" = {"hypothesis":"สมมติฐานทดสอบ"} ⇒ ตกเพราะข้อที่ทดสอบเท่านั้น)
  ----------------------------------------------------------------------------
  v_snapA := pg_temp.csnap(v_cA);
  v_log := v_log || pg_temp.vl('Y13a', 'key พิมพ์ผิด hypotesis → 22023 ระบุชื่อ key', pg_temp.vx(pg_temp.q_plan(v_shopB, v_cA, '{"hypotesis":"x"}', 'owner'), array['22023'], 'hypotesis'));
  v_i := 0;
  foreach v_k in array array['[]', '{}', 'null', '"x"', '5'] loop
    v_i := v_i + 1;
    v_log := v_log || pg_temp.vl('Y13b' || chr(96 + v_i), 'p_set ผิดรูป ' || v_k, pg_temp.vx(pg_temp.q_plan(v_shopB, v_cA, v_k, 'owner'), array['22023']));
  end loop;
  v_log := v_log || pg_temp.vl('Y13b6', 'p_set เป็น SQL NULL', pg_temp.vx(format('select analytics.campaign_plan_set(%L::uuid,%L::uuid,null::jsonb,%L)', v_shopB, v_cA, 'owner'), array['22023']));
  v_i := 0;
  foreach v_k in array array['{"baseline_value":"NaN"}', '{"baseline_value":"5"}', '{"baseline_value":true}', '{"baseline_value":[1]}', '{"baseline_value":10000000000000}',
                             '{"baseline_value":-1000000000001}', '{"baseline_spread":-1}', '{"baseline_spread":1000000000001}',
                             '{"pass_threshold":1000000000001,"pass_op":">="}', '{"pass_threshold":"NaN","pass_op":">="}'] loop
    v_i := v_i + 1;
    v_log := v_log || pg_temp.vl('Y13c' || chr(96 + v_i), 'ตัวเลขผิด ' || v_k, pg_temp.vx(pg_temp.q_plan(v_shopB, v_cA, v_k, 'owner'), array['22023']));
  end loop;
  v_i := 0;
  foreach v_k in array array[format('{"baseline_as_of":"%s"}', v_today + 1), '{"baseline_as_of":"2026-02-30"}', '{"baseline_as_of":"infinity"}',
                             '{"baseline_as_of":"2019-12-31"}', '{"baseline_as_of":20260101}', '{"baseline_as_of":"2026-1-1"}', '{"baseline_as_of":true}',
                             format('{"metric_code":"orders","metric_date_from":"%s","metric_date_to":"2100-01-01"}', v_today)] loop
    v_i := v_i + 1;
    v_log := v_log || pg_temp.vl('Y13d' || chr(96 + v_i), 'วันที่ผิด ' || v_k, pg_temp.vx(pg_temp.q_plan(v_shopB, v_cA, v_k, 'owner'), array['22023']));
  end loop;
  v_i := 0;
  foreach v_k in array array['{"pass_op":">"}', '{"pass_op":5}', '{"pass_op":">=","pass_threshold":null}', '{"pass_threshold":5}', '{"metric_code":"bogus"}', '{"metric_code":5}',
                             '{"metric_affinity":"x"}', '{"metric_affinity":5}'] loop
    v_i := v_i + 1;
    v_log := v_log || pg_temp.vl('Y13e' || chr(96 + v_i), 'เกณฑ์/metric/กลุ่มสินค้าผิด ' || v_k, pg_temp.vx(pg_temp.q_plan(v_shopB, v_cA, v_k, 'owner'), array['22023']));
  end loop;
  v_i := 0;
  foreach v_k in array array['{"metric_channel_code":"line_oa"}', '{"metric_affinity":"bar"}', format('{"metric_date_from":"%s","metric_date_to":"%s"}', v_today, v_today),
                             '{"metric_code":"save_rate","metric_affinity":"bar"}', '{"metric_code":"none","metric_channel_code":"line_oa"}',
                             format('{"metric_code":"orders","metric_date_from":"%s"}', v_today), format('{"metric_code":"orders","metric_date_to":"%s"}', v_today),
                             format('{"metric_code":"orders","metric_date_from":"%s","metric_date_to":"%s"}', v_today, v_today - 1),
                             format('{"metric_code":"orders","metric_date_from":"%s","metric_date_to":"%s"}', v_today, v_today + 367),
                             '{"metric_code":"orders","metric_channel_code":"nope"}', '{"metric_code":"orders","metric_channel_code":5}'] loop
    v_i := v_i + 1;
    v_log := v_log || pg_temp.vl('Y13f' || chr(96 + v_i), 'ขอบเขตนับออเดอร์ผิด/ไม่ใช่ metric orders ' || v_k, pg_temp.vx(pg_temp.q_plan(v_shopB, v_cA, v_k, 'owner'), array['22023']));
  end loop;
  v_log := v_log || pg_temp.vl('Y13f2', 'ช่องทางผิดต้องบอกรหัสที่มีจริง (line_oa) ในข้อความ', pg_temp.vx(pg_temp.q_plan(v_shopB, v_cA, '{"metric_code":"orders","metric_channel_code":"nope"}', 'owner'), array['22023'], 'line_oa'));
  v_i := 0;
  foreach v_k in array array[format('{"hypothesis":"%s"}', (chr(8203) || chr(8203) || chr(8203))), '{"hypothesis":"   "}', format('{"hypothesis":"%s"}', repeat('ก', 1001)), '{"hypothesis":"[ต้องยืนยัน: ตัวเลข] ลดราคาแล้วขายดี"}',
                             '{"hypothesis":5}', '{"hypothesis":true}', format('{"baseline_note":"%s"}', repeat('ก', 501)), '{"baseline_note":"[ ต้อง  ยืนยัน ฐาน]"}',
                             format('{"hypothesis":"ก%sข"}', chr(917569)), format('{"baseline_note":"ก%sข"}', chr(173)), format('{"hypothesis":"ก%sข"}', chr(12644))] loop
    v_i := v_i + 1;
    v_log := v_log || pg_temp.vl('Y13g' || chr(96 + v_i), 'ข้อความผิด (ZWSP ล้วน/ว่าง/ยาว/marker/ชนิดผิด) ' || left(replace(v_k, chr(8203), '<ZWSP>'), 50), pg_temp.vx(pg_temp.q_plan(v_shopB, v_cA, v_k, 'owner'), array['22023']));
  end loop;
  v_log := v_log || pg_temp.vl('Y13h1', 'actor assistant (ไม่รู้จัก)', pg_temp.vx(pg_temp.q_plan(v_shopB, v_cA, '{"hypothesis":"สมมติฐานทดสอบ"}', 'assistant'), array['22023']));
  v_log := v_log || pg_temp.vl('Y13h2', 'actor null', pg_temp.vx(pg_temp.q_plan(v_shopB, v_cA, '{"hypothesis":"สมมติฐานทดสอบ"}', null), array['22023']));
  v_log := v_log || pg_temp.vl('Y13h3', 'shop null', pg_temp.vx(format('select analytics.campaign_plan_set(null::uuid,%L::uuid,%L::jsonb,%L)', v_cA, '{"hypothesis":"x"}', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('Y13h4', 'campaign null', pg_temp.vx(format('select analytics.campaign_plan_set(%L::uuid,null::uuid,%L::jsonb,%L)', v_shopB, '{"hypothesis":"x"}', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('Y13i1', 'แคมเปญของร้านอื่น (ส่ง shop B + campaign ของร้าน C) → ไม่พบ', pg_temp.vx(pg_temp.q_plan(v_shopB, v_cE, '{"hypothesis":"สมมติฐานทดสอบ"}', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('Y13i2', 'campaign สุ่ม', pg_temp.vx(pg_temp.q_plan(v_shopB, gen_random_uuid(), '{"hypothesis":"สมมติฐานทดสอบ"}', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('Y13j1', 'campaign ที่ปิดแล้ว (เจ้าของยืนยัน) actor owner → 55000', pg_temp.vx(pg_temp.q_plan(v_shopB, v_cC, '{"hypothesis":"สมมติฐานทดสอบ"}', 'owner'), array['55000']));
  v_log := v_log || pg_temp.vl('Y13j2', 'campaign ที่ปิดแล้ว actor ai → 55000 (ปิดแล้วแก้ไม่ได้ทุก actor)', pg_temp.vx(pg_temp.q_plan(v_shopB, v_cC, '{"hypothesis":"สมมติฐานทดสอบ"}', 'ai'), array['55000']));
  v_log := v_log || pg_temp.vl('Y13k1', 'actor ai บนแคมเปญที่มีชิ้น posted → 42501', pg_temp.vx(pg_temp.q_plan(v_shopB, v_cD, '{"hypothesis":"สมมติฐานทดสอบ"}', 'ai'), array['42501']));
  v_log := v_log || pg_temp.vl('Y13k2', 'actor system บนแคมเปญที่มีชิ้น posted → 42501', pg_temp.vx(pg_temp.q_plan(v_shopB, v_cD, '{"hypothesis":"สมมติฐานทดสอบ"}', 'system'), array['42501']));
  v_log := v_log || pg_temp.vb('Y13z', 'reject ทั้งชุดแล้วแคมเปญ cA/cC/cD ไม่ถูกเขียนอะไร (snapshot เท่าเดิม)', pg_temp.csnap(v_cA) = v_snapA);
  v_log := v_log || pg_temp.vb('Y13z2', 'ไม่มีการเขียน updated_at ของ cD จากการ reject (ค่า ai/ปิดแล้ว ไม่เปลี่ยนแถว)', (select hypothesis from analytics.campaign where id = v_cD) is null);

  -- ต้องไม่พัง: ตั้งแผนเต็มชุดโดย owner · json null ล้าง · เปลี่ยน metric พร้อมล้างขอบเขต · ai บนแคมเปญที่ยังไม่มีชิ้น posted
  v_j := pg_temp.vj(pg_temp.q_plan(v_shopB, v_cA,
    format('{"hypothesis":"  สมมติฐาน   ทดสอบ ","metric_code":"orders","baseline_value":0.5,"baseline_spread":1,"baseline_as_of":"%s","baseline_note":"ฐานทดสอบ","pass_threshold":6,"pass_op":">=","metric_channel_code":"line_oa","metric_affinity":"bar","metric_date_from":"%s","metric_date_to":"%s"}',
           v_today, v_today, v_today + 3), 'owner'));
  select * into r from analytics.campaign where id = v_cA;
  v_log := v_log || pg_temp.vb('Y13m1', 'owner ตั้งแผนเต็มชุด 12 key: payload changed ครบ 12 · hypothesis ถูก clean (ช่องว่างซ้อนยุบ) · ค่าลงตาราง',
    (select count(*) from jsonb_object_keys(v_j -> 'changed')) = 12 and r.hypothesis = 'สมมติฐาน ทดสอบ' and r.metric_code = 'orders' and r.baseline_value = 0.5
    and r.pass_threshold = 6 and r.pass_op = '>=' and r.metric_channel_code = 'line_oa' and r.metric_affinity = 'bar' and r.metric_date_from = v_today and r.metric_date_to = v_today + 3
    and (v_j -> 'changed' -> 'pass_op' ->> 'from') is null and (v_j -> 'changed' -> 'pass_op' ->> 'to') = '>=', left(v_j::text, 200));
  v_log := v_log || pg_temp.vl('Y13m2', 'ตั้งซ้ำเหมือนเดิมทุก key → 22023 ไม่มีค่าเปลี่ยน (ไม่เขียน/ไม่ทับเงียบ)',
    pg_temp.vx(pg_temp.q_plan(v_shopB, v_cA, '{"metric_code":"orders","baseline_value":0.5,"pass_op":">="}', 'owner'), array['22023'], 'ไม่มีค่าเปลี่ยน'));
  v_j := pg_temp.vj(pg_temp.q_plan(v_shopB, v_cA, '{"baseline_note":null}', 'owner'));
  select baseline_note into v_s1 from analytics.campaign where id = v_cA;
  v_log := v_log || pg_temp.vb('Y13m3', 'json null = ล้าง: baseline_note เป็น null · changed มีแค่ key เดียว · to เป็น json null', v_s1 is null and (select count(*) from jsonb_object_keys(v_j -> 'changed')) = 1
    and jsonb_typeof(v_j -> 'changed' -> 'baseline_note' -> 'to') = 'null', left(v_j::text, 160));
  v_log := v_log || pg_temp.vl('Y13m4', 'เปลี่ยน metric เป็น save_rate โดยไม่ล้างขอบเขตออเดอร์ → 22023 (ไม่ล้างเงียบ)',
    pg_temp.vx(pg_temp.q_plan(v_shopB, v_cA, '{"metric_code":"save_rate"}', 'owner'), array['22023']));
  v_j := pg_temp.vj(pg_temp.q_plan(v_shopB, v_cA, '{"metric_code":"save_rate","metric_channel_code":null,"metric_affinity":null,"metric_date_from":null,"metric_date_to":null}', 'owner'));
  select * into r from analytics.campaign where id = v_cA;
  v_log := v_log || pg_temp.vb('Y13m5', 'เปลี่ยน metric เป็น save_rate พร้อมล้างขอบเขตในคำสั่งเดียว ผ่าน · เกณฑ์เดิมยังอยู่', r.metric_code = 'save_rate' and r.metric_channel_code is null and r.metric_date_from is null
    and r.pass_threshold = 6, left(v_j::text, 160));
  v_j := pg_temp.vj(pg_temp.q_plan(v_shopB, v_cA, '{"baseline_value":0,"pass_threshold":null,"pass_op":null}', 'owner'));
  select * into r from analytics.campaign where id = v_cA;
  v_log := v_log || pg_temp.vb('Y13m6', 'ล้างเกณฑ์เป็นคู่ได้ · baseline_value = 0 รับได้ (ศูนย์เป็นค่าจริง ไม่ใช่ว่าง — trap #13)', r.pass_threshold is null and r.pass_op is null and r.baseline_value = 0, left(v_j::text, 160));
  v_log := v_log || pg_temp.vl('Y13m7', 'ai ตั้งสมมติฐานบนแคมเปญที่ยังไม่มีชิ้น posted ผ่าน (AI เสนอสมมติฐานก่อนเริ่ม)', pg_temp.vok(pg_temp.q_plan(v_shopB, v_cB, '{"hypothesis":"AI เสนอสมมติฐาน"}', 'ai')));
  v_log := v_log || pg_temp.vl('Y13m8', 'system ตั้งฐานบนแคมเปญที่ยังไม่มีชิ้น posted ผ่าน', pg_temp.vok(pg_temp.q_plan(v_shopB, v_cB, '{"baseline_value":2}', 'system')));
  v_log := v_log || pg_temp.vl('Y13m9', 'owner แก้แผนบนแคมเปญที่มีชิ้น posted ผ่าน (ย้ายเสาได้เฉพาะเจ้าของ)', pg_temp.vok(pg_temp.q_plan(v_shopB, v_cD, '{"hypothesis":"เจ้าของปรับสมมติฐาน"}', 'owner')));
  v_log := v_log || pg_temp.vl('Y13m10', 'เกณฑ์ threshold ติดลบ/ศูนย์ผ่านได้ (ขอบเขตค่าจริง −1e12..1e12)', pg_temp.vok(pg_temp.q_plan(v_shopB, v_cB, '{"pass_threshold":-5,"pass_op":"<="}', 'owner')));
  ----------------------------------------------------------------------------
  -- SEC-M2 (ข้อ S): ai/system แก้แผนแคมเปญไม่ได้เมื่อ "เริ่มแล้ว" (วันนี้ไทย >= coalesce(metric_date_from, anchor_date)) หรือมีข้อเสนอคำตัดสินแล้ว ·
  -- owner แก้ได้เสมอ (ที่ยังไม่ปิด) · ขอบ: anchor = วันนี้ ตก (>=) / พรุ่งนี้ ผ่าน · ค่าใหม่ที่ดึงวันเริ่มถอยมาวันนี้/ก่อนหน้าก็ตก
  ----------------------------------------------------------------------------
  v_cM  := pg_temp.mk_camp(v_shopB, v_today);
  v_cM2 := pg_temp.mk_camp(v_shopB, v_today + 1);
  v_cM3 := pg_temp.mk_camp(v_shopB, v_today - 3);
  v_cM4 := pg_temp.mk_camp(v_shopB, v_today + 4);
  v_cN  := pg_temp.mk_camp(v_shopB, null);
  v_snapA := pg_temp.csnap(v_cM);
  v_log := v_log || pg_temp.vl('S2a', 'ai แก้แผนบนแคมเปญที่ anchor = วันนี้ (เริ่มแล้ว · ขอบ >=) → 42501 "เริ่มแล้ว"', pg_temp.vx(pg_temp.q_plan(v_shopB, v_cM, '{"hypothesis":"AI แก้หลังเริ่ม"}', 'ai'), array['42501'], 'เริ่มแล้ว'));
  v_log := v_log || pg_temp.vl('S2b', 'system แก้แผนบนแคมเปญที่ anchor = วันนี้ → 42501', pg_temp.vx(pg_temp.q_plan(v_shopB, v_cM, '{"baseline_value":3}', 'system'), array['42501'], 'เริ่มแล้ว'));
  v_log := v_log || pg_temp.vl('S2b2', 'ai แก้แผนบนแคมเปญที่ anchor ผ่านมา 3 วัน (ไม่มี metric_date_from) → 42501', pg_temp.vx(pg_temp.q_plan(v_shopB, v_cM3, '{"hypothesis":"AI แก้หลังเริ่ม"}', 'ai'), array['42501'], 'เริ่มแล้ว'));
  v_log := v_log || pg_temp.vb('S2z', 'reject แล้วแคมเปญ cM ไม่ถูกเขียนอะไร', pg_temp.csnap(v_cM) = v_snapA);
  v_log := v_log || pg_temp.vl('S2c', 'ต้องไม่พัง: owner แก้แผนบนแคมเปญที่เริ่มแล้ว (anchor = วันนี้) ผ่าน', pg_temp.vok(pg_temp.q_plan(v_shopB, v_cM, '{"hypothesis":"เจ้าของแก้หลังเริ่ม"}', 'owner')));
  v_log := v_log || pg_temp.vl('S2d', 'ต้องไม่พัง: ai แก้แผนบนแคมเปญที่ anchor = พรุ่งนี้ (ขอบ — ยังไม่เริ่ม) ผ่าน', pg_temp.vok(pg_temp.q_plan(v_shopB, v_cM2, '{"hypothesis":"AI เสนอก่อนเริ่ม"}', 'ai')));
  v_log := v_log || pg_temp.vl('S2e', 'owner ตั้งช่วงนับอนาคต (วันนี้+2..+5) บนแคมเปญที่ anchor ผ่านมาแล้ว ผ่าน', pg_temp.vok(pg_temp.q_plan(v_shopB, v_cM3,
    format('{"metric_code":"orders","metric_date_from":"%s","metric_date_to":"%s"}', v_today + 2, v_today + 5), 'owner')));
  v_log := v_log || pg_temp.vl('S2f', 'ต้องไม่พัง: ai แก้สมมติฐานเมื่อ anchor ผ่านมาแล้วแต่ metric_date_from เป็นอนาคต (ยังไม่เริ่มจริง) ผ่าน', pg_temp.vok(pg_temp.q_plan(v_shopB, v_cM3, '{"hypothesis":"AI เสนอก่อนช่วงนับเริ่ม"}', 'ai')));
  v_log := v_log || pg_temp.vl('S2g', 'ai ดึง metric_date_from ถอยมาเป็นวันนี้ (ค่าใหม่ — เลือกช่วงหลังเห็นยอด) → 42501', pg_temp.vx(pg_temp.q_plan(v_shopB, v_cM3,
    format('{"metric_date_from":"%s","metric_date_to":"%s"}', v_today, v_today + 5), 'ai'), array['42501'], 'วันนี้หรือก่อนหน้า'));
  v_log := v_log || pg_temp.vl('S2g2', 'ai ดึง metric_date_from ถอยไปเมื่อวาน → 42501', pg_temp.vx(pg_temp.q_plan(v_shopB, v_cM3,
    format('{"metric_date_from":"%s","metric_date_to":"%s"}', v_today - 1, v_today + 5), 'ai'), array['42501'], 'วันนี้หรือก่อนหน้า'));
  v_log := v_log || pg_temp.vl('S2h', 'ต้องไม่พัง: ai ขยับ metric_date_from ไปวันอนาคตอื่น (วันนี้+3..+6) ผ่าน', pg_temp.vok(pg_temp.q_plan(v_shopB, v_cM3,
    format('{"metric_date_from":"%s","metric_date_to":"%s"}', v_today + 3, v_today + 6), 'ai')));
  v_log := v_log || pg_temp.vl('S2i0', 'ai เสนอ inconclusive บน cM4 (anchor อนาคต) ผ่าน', pg_temp.vok(pg_temp.q_prop(v_shopB, v_cM4, 'inconclusive', 'ข้อมูลยังไม่พอ', 'ai')));
  v_log := v_log || pg_temp.vl('S2i1', 'ai แก้แผนหลังมีข้อเสนอคำตัดสินแล้ว (แม้ anchor ยังเป็นอนาคต) → 42501 "ข้อเสนอคำตัดสิน"', pg_temp.vx(pg_temp.q_plan(v_shopB, v_cM4, '{"pass_threshold":1,"pass_op":">="}', 'ai'), array['42501'], 'ข้อเสนอคำตัดสิน'));
  v_log := v_log || pg_temp.vl('S2i2', 'system แก้แผนหลังมีข้อเสนอคำตัดสินแล้ว → 42501', pg_temp.vx(pg_temp.q_plan(v_shopB, v_cM4, '{"baseline_value":9}', 'system'), array['42501'], 'ข้อเสนอคำตัดสิน'));
  v_log := v_log || pg_temp.vl('S2i3', 'ต้องไม่พัง: owner แก้แผนหลังมีข้อเสนอคำตัดสิน ผ่าน', pg_temp.vok(pg_temp.q_plan(v_shopB, v_cM4, '{"pass_threshold":1,"pass_op":">="}', 'owner')));
  v_log := v_log || pg_temp.vl('S2j', 'ต้องไม่พัง: ai แก้แผนบนแคมเปญที่ไม่มี anchor/ช่วงนับ (ไม่รู้วันเริ่ม = ยังไม่เริ่ม) ผ่าน', pg_temp.vok(pg_temp.q_plan(v_shopB, v_cN, '{"hypothesis":"AI เสนอบนไอเดียไม่มีวัน"}', 'ai')));

  -- N10: threshold_too_narrow = สูตรเดียวกับ v_content_piece (0159) + ผลจริง
  v_s1 := regexp_replace(regexp_replace(substring(pg_get_viewdef('analytics.v_campaign_summary'::regclass) from 'abs\(\(\w+\.pass_threshold - \w+\.baseline_value\)\) < \w+\.baseline_spread'), '\w+\.', '', 'g'), '\s+', ' ', 'g');
  v_s2 := regexp_replace(regexp_replace(substring(pg_get_viewdef('analytics.v_content_piece'::regclass) from 'abs\(\(\w+\.pass_threshold - \w+\.baseline_value\)\) < \w+\.baseline_spread'), '\w+\.', '', 'g'), '\s+', ' ', 'g');
  v_log := v_log || pg_temp.vb('N10a', 'threshold_too_narrow ใน v_campaign_summary = นิพจน์เดียวกับ v_content_piece (viewdef หลังตัด alias)', v_s1 is not null and v_s1 = v_s2, coalesce(v_s1, 'null') || ' / ' || coalesce(v_s2, 'null'));
  perform pg_temp.vj(pg_temp.q_plan(v_shopB, v_cB, '{"baseline_value":10,"baseline_spread":5,"pass_threshold":12,"pass_op":">="}', 'owner'));
  select threshold_too_narrow into v_b from analytics.v_campaign_summary where campaign_id = v_cB;
  v_log := v_log || pg_temp.vb('N10b', 'ฐาน 10 ± 5 เกณฑ์ 12 → แคบเกินไป (true)', v_b is true);
  perform pg_temp.vj(pg_temp.q_plan(v_shopB, v_cB, '{"pass_threshold":20}', 'owner'));
  select threshold_too_narrow into v_b from analytics.v_campaign_summary where campaign_id = v_cB;
  v_log := v_log || pg_temp.vb('N10c', 'เกณฑ์ 20 (ห่างฐาน 10 > spread 5) → false', v_b is false);
  perform pg_temp.vj(pg_temp.q_plan(v_shopB, v_cB, '{"baseline_spread":null}', 'owner'));
  select threshold_too_narrow into v_b from analytics.v_campaign_summary where campaign_id = v_cB;
  v_log := v_log || pg_temp.vb('N10d', 'ไม่มี spread → false (ไม่ใช่ null — คำนวณไม่ได้ ไม่เตือนมั่ว)', v_b is false);

  ----------------------------------------------------------------------------
  -- Y14: campaign_verdict_propose ต้องถูกปฏิเสธ (ยิงบน cA: metric save_rate · ไม่มีชิ้น posted · ยังไม่ปิด)
  ----------------------------------------------------------------------------
  select * into r from analytics.campaign where id = v_cA;
  v_log := v_log || pg_temp.vb('F1', 'fixture: cA metric save_rate · ยังไม่มีข้อเสนอ · ยังไม่ยืนยัน', r.metric_code = 'save_rate' and r.result_verdict_proposed is null and r.result_verdict_confirmed_at is null);
  v_snapA := pg_temp.csnap(v_cA);
  v_i := 0;
  foreach v_k in array array['', 'ok', (chr(8203) || chr(8203) || chr(8203)), '   ', '[ต้องยืนยัน: ตัวเลข] ลดราคาแล้วขายดี', '[ ต้อง  ยืนยัน ยอด]',
                             'หลักฐาน' || chr(917569) || 'ซ่อน', 'หลักฐาน' || chr(173) || 'ซ่อน'] loop
    v_i := v_i + 1;
    v_log := v_log || pg_temp.vl('Y14a' || chr(96 + v_i), 'หลักฐานผิด: ' || replace(replace(v_k, chr(8203), '<ZWSP>'), E'\n', ' '),
      pg_temp.vx(pg_temp.q_prop(v_shopB, v_cA, 'inconclusive', v_k, 'ai'), array['22023']));
  end loop;
  v_log := v_log || pg_temp.vl('Y14a7', 'หลักฐานเป็น SQL NULL', pg_temp.vx(format('select analytics.campaign_verdict_propose(%L::uuid,%L::uuid,%L,null,%L)', v_shopB, v_cA, 'inconclusive', 'ai'), array['22023']));
  v_log := v_log || pg_temp.vl('Y14a8', 'หลักฐานยาว 1001', pg_temp.vx(pg_temp.q_prop(v_shopB, v_cA, 'inconclusive', repeat('ก', 1001), 'ai'), array['22023']));
  v_log := v_log || pg_temp.vl('Y14b1', 'คำตัดสิน maybe', pg_temp.vx(pg_temp.q_prop(v_shopB, v_cA, 'maybe', 'หลักฐานทดสอบ', 'ai'), array['22023']));
  v_log := v_log || pg_temp.vl('Y14b2', 'คำตัดสิน null', pg_temp.vx(pg_temp.q_prop(v_shopB, v_cA, null, 'หลักฐานทดสอบ', 'ai'), array['22023']));
  v_log := v_log || pg_temp.vl('Y14b3', 'actor assistant', pg_temp.vx(pg_temp.q_prop(v_shopB, v_cA, 'inconclusive', 'หลักฐานทดสอบ', 'assistant'), array['22023']));
  v_log := v_log || pg_temp.vl('Y14c1', 'validated บน metric save_rate ที่ชิ้นมี T+7 < 4 → 55000 ระบุ "ครบ 4 ชิ้น"', pg_temp.vx(pg_temp.q_prop(v_shopB, v_cA, 'validated', 'หลักฐานทดสอบ', 'ai'), array['55000'], 'ครบ 4 ชิ้น'));
  v_log := v_log || pg_temp.vl('Y14c2', 'invalidated บน metric save_rate ที่ชิ้นมี T+7 < 4 → 55000', pg_temp.vx(pg_temp.q_prop(v_shopB, v_cA, 'invalidated', 'หลักฐานทดสอบ', 'ai'), array['55000']));
  v_log := v_log || pg_temp.vl('Y14c3', 'owner เสนอ validated บน save_rate < 4 ชิ้น ก็ตกด่านเดียวกัน (ด่านเนื้อหาไม่ยกเว้นเจ้าของ)', pg_temp.vx(pg_temp.q_prop(v_shopB, v_cA, 'validated', 'หลักฐานทดสอบ', 'owner'), array['55000']));
  v_log := v_log || pg_temp.vl('Y14d1', 'เสนอบนแคมเปญที่ปิดแล้ว → 55000', pg_temp.vx(pg_temp.q_prop(v_shopB, v_cC, 'inconclusive', 'หลักฐานทดสอบ', 'ai'), array['55000']));
  v_log := v_log || pg_temp.vl('Y14d2', 'แคมเปญของร้านอื่น', pg_temp.vx(pg_temp.q_prop(v_shopB, v_cE, 'inconclusive', 'หลักฐานทดสอบ', 'ai'), array['22023']));
  v_log := v_log || pg_temp.vb('Y14z', 'reject ทั้งชุดแล้ว cA ไม่ถูกเขียนอะไร', pg_temp.csnap(v_cA) = v_snapA);

  -- ต้องไม่พัง: inconclusive/not_measured เสนอได้เสมอ (แม้ metric save_rate ที่ยังไม่ครบ 4) · เสนอซ้ำคืนค่าเก่า · ไม่แตะ result_verdict/status
  v_j := pg_temp.vj(pg_temp.q_prop(v_shopB, v_cA, 'inconclusive', 'ข้อมูล T+7 ยังไม่ครบ 4 ชิ้น', 'ai'));
  select * into r from analytics.campaign where id = v_cA;
  v_log := v_log || pg_temp.vb('Y14m1', 'ai เสนอ inconclusive ผ่านแม้ยังไม่ครบ 4 ชิ้น: awaiting_owner · proposed ลงตาราง · result_verdict ยัง not_measured · status ไม่เปลี่ยน · ไม่ใช่คำตัดสิน',
    (v_j ->> 'proposed') = 'inconclusive' and (v_j ->> 'awaiting_owner') = 'true' and (v_j ->> 'previous_proposed') is null and r.result_verdict_proposed = 'inconclusive'
    and r.result_proposed_by_role = 'ai' and r.result_verdict = 'not_measured' and r.result_verdict_confirmed_at is null and r.status = 'scheduled', left(v_j::text, 200));
  select * into r from analytics.v_campaign_summary where campaign_id = v_cA;
  v_log := v_log || pg_temp.vb('Y14m2', 'v_campaign_summary: verdict_display = proposed:inconclusive · awaiting_confirm true · stage ไม่ใช่ closed', r.verdict_display = 'proposed:inconclusive' and r.awaiting_confirm and r.stage <> 'closed', coalesce(r.verdict_display, 'null') || '/' || r.stage);
  select * into r from analytics.v_recommendation_inbox where item_id = v_cA and item_kind = 'campaign_verdict';
  v_log := v_log || pg_temp.vb('Y14m3', 'inbox แขน campaign_verdict โผล่: kind question · pending · respond_via campaign_verdict_confirm · source agent (ai) · detail ขึ้นต้นด้วยคำตัดสิน · ไม่มีค่าเริ่มต้น',
    r.item_id = v_cA and r.kind = 'question' and r.effective_action = 'pending' and r.respond_via = 'campaign_verdict_confirm' and r.source = 'agent' and r.detail like 'inconclusive — %'
    and r.default_action is null and r.shop_id = v_shopB, coalesce(r.detail, 'null'));
  v_j := pg_temp.vj(pg_temp.q_prop(v_shopB, v_cA, 'not_measured', 'เปลี่ยนข้อเสนอเป็นยังไม่ได้วัด', 'system'));
  v_log := v_log || pg_temp.vb('Y14m4', 'เสนอซ้ำ (system) ทับได้ — previous_proposed คืนค่าเก่า (ไม่ทับเงียบ) · by_role เป็น system', (v_j ->> 'previous_proposed') = 'inconclusive' and (v_j ->> 'previous_proposed_by_role') = 'ai'
    and (select result_proposed_by_role from analytics.campaign where id = v_cA) = 'system', left(v_j::text, 200));
  -- ข้อเสนอของ owner: ai/system ทับไม่ได้ (ตัดสินใจ E) · owner ทับของตัวเองได้
  v_log := v_log || pg_temp.vl('Y14m5', 'owner เสนอ inconclusive (ทับของ system ได้)', pg_temp.vok(pg_temp.q_prop(v_shopB, v_cA, 'inconclusive', 'เจ้าของเสนอเอง', 'owner')));
  v_log := v_log || pg_temp.vl('Y14e1', 'ai ทับข้อเสนอของ owner → 42501', pg_temp.vx(pg_temp.q_prop(v_shopB, v_cA, 'not_measured', 'AI ขอทับ', 'ai'), array['42501']));
  v_log := v_log || pg_temp.vl('Y14e2', 'system ทับข้อเสนอของ owner → 42501', pg_temp.vx(pg_temp.q_prop(v_shopB, v_cA, 'not_measured', 'ระบบขอทับ', 'system'), array['42501']));
  select result_verdict_proposed, result_proposed_by_role into v_s1, v_s2 from analytics.campaign where id = v_cA;
  v_log := v_log || pg_temp.vb('Y14e3', 'ข้อเสนอของ owner ยังอยู่หลังถูก AI/ระบบพยายามทับ', v_s1 = 'inconclusive' and v_s2 = 'owner', v_s1 || '/' || v_s2);
  select metric_code into v_s1 from analytics.campaign where id = v_cB;
  v_log := v_log || pg_temp.vb('Y14m6', 'fixture: cB เป็นแคมเปญที่ metric ว่าง (ไม่มี metric ที่ต้องเฝ้า) พร้อมทดสอบด่านเนื้อหา', v_s1 is null);
  v_log := v_log || pg_temp.vl('Y14m7', 'cB เสนอ validated โดย ai ผ่านด่านเนื้อหา (metric ว่าง)', pg_temp.vok(pg_temp.q_prop(v_shopB, v_cB, 'validated', 'หลักฐานแคมเปญ cB', 'ai')));

  ----------------------------------------------------------------------------
  -- ด่าน 4 ชิ้น (cF · metric save_rate): 3 ชิ้นที่มี T+7 + 1 ชิ้นโพสต์แล้วไม่มี T+7 + ชิ้นค้าง 1 (ชิ้นแรกของแคมเปญ) ⇒ ไม่ครบ · เพิ่มชิ้นที่ 4 ⇒ ผ่าน
  ----------------------------------------------------------------------------
  v_anchor := v_today + 5;
  v_cF := pg_temp.mk_camp(v_shopB, v_anchor);
  perform pg_temp.mk_posted_in(v_shopB, v_cF, v_anchor, 1, true);
  perform pg_temp.mk_posted_in(v_shopB, v_cF, v_anchor, 2, true);
  perform pg_temp.mk_posted_in(v_shopB, v_cF, v_anchor, 3, true);
  perform pg_temp.mk_posted_in(v_shopB, v_cF, v_anchor, 4, false);
  perform pg_temp.vj(pg_temp.q_plan(v_shopB, v_cF, '{"metric_code":"save_rate"}', 'owner'));
  select * into r from analytics.v_campaign_summary where campaign_id = v_cF;
  v_log := v_log || pg_temp.vb('G1', 'cF: pieces_total 5 · posted 4 · open 1 (ชิ้นแรก planned) · pieces_measured 3 (ชิ้นที่ 4 ไม่มี T+7) · posts_active_n 4 · posts_measured_n 3 · stage running',
    r.pieces_total = 5 and r.pieces_posted = 4 and r.pieces_open = 1 and r.pieces_measured = 3 and r.posts_active_n = 4 and r.posts_measured_n = 3 and r.stage = 'running',
    concat_ws('|', r.pieces_total, r.pieces_posted, r.pieces_open, r.pieces_measured, r.posts_active_n, r.posts_measured_n, r.stage));
  v_log := v_log || pg_temp.vl('G2', 'ai เสนอ validated ที่ 3 ชิ้นมี T+7 → 55000 "(มี 3)"', pg_temp.vx(pg_temp.q_prop(v_shopB, v_cF, 'validated', 'หลักฐานทดสอบ', 'ai'), array['55000'], '(มี 3)'));
  v_log := v_log || pg_temp.vl('G3', 'owner ยืนยัน validated ที่ 3 ชิ้น (expected none) → 55000 ด่านเดียวกัน', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cF, 'validated', null, 'owner', null, 'none'), array['55000'], 'ครบ 4 ชิ้น'));
  v_log := v_log || pg_temp.vl('G3b', 'owner ยืนยัน invalidated ที่ 3 ชิ้น → 55000', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cF, 'invalidated', null, 'owner', null, 'none'), array['55000']));
  select count(*) into v_n from analytics.campaign where id = v_cF and result_verdict_confirmed_at is not null;
  v_log := v_log || pg_temp.vb('G3z', 'reject แล้ว cF ยังไม่ถูกยืนยัน', v_n = 0);
  perform pg_temp.mk_posted_in(v_shopB, v_cF, v_anchor, 5, true);
  select pieces_measured into v_n from analytics.v_campaign_summary where campaign_id = v_cF;
  v_log := v_log || pg_temp.vb('G4', 'เพิ่มชิ้นที่ 5 (มี T+7) → pieces_measured 4 (นับ distinct ชิ้น)', v_n = 4, 'pieces_measured ' || v_n);
  v_log := v_log || pg_temp.vl('G5', 'ครบ 4 ชิ้น: ai เสนอ validated ผ่าน (ชิ้นค้าง 1 ไม่ขวาง — Q12)', pg_temp.vok(pg_temp.q_prop(v_shopB, v_cF, 'validated', 'ครบ 4 ชิ้นแล้ว save สูงกว่าฐาน', 'ai')));

  ----------------------------------------------------------------------------
  -- Y15: campaign_verdict_confirm ต้องถูกปฏิเสธ (ยิงบน cB: ai เสนอ validated ไว้แล้ว · metric ว่าง)
  ----------------------------------------------------------------------------
  v_snapA := pg_temp.csnap(v_cB);
  v_log := v_log || pg_temp.vl('Y15a1', 'confirm actor ai → 42501', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cB, 'validated', null, 'ai', null, 'validated'), array['42501']));
  v_log := v_log || pg_temp.vl('Y15a2', 'confirm actor system → 42501', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cB, 'validated', null, 'system', null, 'validated'), array['42501']));
  v_log := v_log || pg_temp.vl('Y15a3', 'confirm actor assistant → 22023', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cB, 'validated', null, 'assistant', null, 'validated'), array['22023']));
  v_log := v_log || pg_temp.vl('Y15b1', 'p_expected_proposed = null → 22023 (compare-and-set ห้ามข้ามด้วย null)', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cB, 'validated', null, 'owner', null, null), array['22023']));
  v_log := v_log || pg_temp.vl('Y15b2', 'p_expected_proposed = maybe → 22023', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cB, 'validated', null, 'owner', null, 'maybe'), array['22023']));
  v_log := v_log || pg_temp.vl('Y15b3', 'คาดว่ายังไม่มีข้อเสนอ (none) แต่มี validated → 55000', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cB, 'validated', null, 'owner', null, 'none'), array['55000'], 'ข้อเสนอเปลี่ยนไปแล้ว'));
  v_log := v_log || pg_temp.vl('Y15b4', 'คาด invalidated แต่ข้อเสนอจริง validated → 55000', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cB, 'validated', null, 'owner', null, 'invalidated'), array['55000']));
  v_log := v_log || pg_temp.vl('Y15b5', 'คาดว่าไม่มีข้อเสนอ (ค่าว่าง) แต่มีข้อเสนอ → 55000', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cB, 'validated', null, 'owner', null, ''), array['55000']));
  v_log := v_log || pg_temp.vl('Y15c1', 'คำตัดสิน maybe → 22023', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cB, 'maybe', null, 'owner', null, 'validated'), array['22023']));
  v_log := v_log || pg_temp.vl('Y15c2', 'คำตัดสิน null → 22023', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cB, null, null, 'owner', null, 'validated'), array['22023']));
  v_log := v_log || pg_temp.vl('Y15d1', 'บทเรียนมี [ต้องยืนยัน → 22023', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cB, 'validated', '[ต้องยืนยัน: ตัวเลข] ลดแล้วขายดี', 'owner', null, 'validated'), array['22023']));
  v_log := v_log || pg_temp.vl('Y15d2', 'บทเรียนยาว 301 → 22023 (เพดาน = content_signal.summary)', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cB, 'validated', repeat('ก', 301), 'owner', null, 'validated'), array['22023']));
  v_log := v_log || pg_temp.vl('Y15d3', 'หมายเหตุมี marker → 22023', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cB, 'validated', null, 'owner', '[ ต้อง ยืนยัน ]', 'validated'), array['22023']));
  v_log := v_log || pg_temp.vl('Y15d4', 'หมายเหตุยาว 1001 → 22023', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cB, 'validated', null, 'owner', repeat('ก', 1001), 'validated'), array['22023']));
  v_log := v_log || pg_temp.vl('Y15d5', 'บทเรียนมี Unicode Tag (content_text_clean ไม่ลบ) → 22023 "ล่องหน"', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cB, 'validated', 'บทเรียน' || chr(917569) || 'ซ่อน', 'owner', null, 'validated'), array['22023'], 'ล่องหน'));
  v_log := v_log || pg_temp.vl('Y15d6', 'หมายเหตุมี soft hyphen → 22023 "ล่องหน"', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cB, 'validated', null, 'owner', 'หมายเหตุ' || chr(173) || 'ซ่อน', 'validated'), array['22023'], 'ล่องหน'));
  v_log := v_log || pg_temp.vl('Y15e1', 'แคมเปญของร้านอื่น → 22023', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cE, 'inconclusive', null, 'owner', null, 'none'), array['22023']));
  v_log := v_log || pg_temp.vl('Y15e2', 'shop null → 22023', pg_temp.vx(format('select analytics.campaign_verdict_confirm(null::uuid,%L::uuid,%L,null,%L,null,%L)', v_cB, 'validated', 'owner', 'validated'), array['22023']));
  v_log := v_log || pg_temp.vb('Y15z', 'reject ทั้งชุดแล้ว cB ไม่ถูกเขียนอะไร (ไม่ปิด · ไม่เปลี่ยน status)', pg_temp.csnap(v_cB) = v_snapA);
  v_log := v_log || pg_temp.vl('Y15f1', 'cF ที่ครบ 4 ชิ้นแล้ว: owner ยืนยัน validated แต่คาดว่า none ขณะ ai เสนอ validated → 55000 (CAS ก่อนด่านอื่น)', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cF, 'validated', null, 'owner', null, 'none'), array['55000'], 'ข้อเสนอเปลี่ยนไปแล้ว'));
  -- ชิ้นที่ยกเลิก/ค้างไม่นับในผล (Q12): ย้ายชิ้นที่ 5 (มี T+7) เป็น cancelled ด้วยทางลัดของ fixture (GUC ของ RPC workflow · ทรานแซกชันทดสอบจะ rollback) ⇒ เหลือ 3 ชิ้นที่นับได้
  select s.id into v_step from analytics.campaign_step s where s.campaign_id = v_cF and s.piece_status = 'posted' order by s.seq desc limit 1;
  perform set_config('c2.piece_rpc', '1', true);
  update analytics.campaign_step set piece_status = 'cancelled' where id = v_step;
  perform set_config('c2.piece_rpc', '', true);
  select * into r from analytics.v_campaign_summary where campaign_id = v_cF;
  v_log := v_log || pg_temp.vb('G6', 'ชิ้นที่ 5 ถูกยกเลิก: pieces_cancelled 1 · pieces_posted 5→4 · pieces_measured 4→3 (ชิ้น cancelled ไม่นับในผล) · open 1 (ไม่รวม cancelled)',
    r.pieces_cancelled = 1 and r.pieces_posted = 4 and r.pieces_measured = 3 and r.pieces_open = 1, concat_ws('|', r.pieces_cancelled, r.pieces_posted, r.pieces_measured, r.pieces_open));
  v_log := v_log || pg_temp.vl('G7', 'ชิ้นที่ยกเลิกไม่นับในด่านด่าน 4 ชิ้น: ai เสนอ validated → 55000 "(มี 3)" (นับ posted เท่านั้น)', pg_temp.vx(pg_temp.q_prop(v_shopB, v_cF, 'validated', 'หลักฐานทดสอบ', 'ai'), array['55000'], '(มี 3)'));
  perform set_config('c2.piece_rpc', '1', true);
  update analytics.campaign_step set piece_status = 'posted' where id = v_step;
  perform set_config('c2.piece_rpc', '', true);
  select pieces_measured into v_n from analytics.v_campaign_summary where campaign_id = v_cF;
  v_log := v_log || pg_temp.vb('G8', 'คืนชิ้นที่ 5 เป็น posted (fixture) → pieces_measured กลับเป็น 4', v_n = 4, 'ได้ ' || v_n);

  ----------------------------------------------------------------------------
  -- Q12 + ยืนยันสำเร็จ: ปิดแคมเปญได้ทุกเมื่อแม้มีชิ้นค้าง (cA: ชิ้นเดียวยังเป็น idea) · บันทึกจำนวนชิ้นค้าง · บทเรียน → signal · CAS · ยืนยันซ้ำ
  ----------------------------------------------------------------------------
  select count(*) into v_n from analytics.campaign_step where campaign_id = v_cA and piece_status is not null and piece_status not in ('posted', 'cancelled');
  v_log := v_log || pg_temp.vb('Q12a', 'fixture: cA มีชิ้นค้าง 1 (idea) ก่อนยืนยัน', v_n = 1, 'ค้าง ' || v_n);
  v_j := pg_temp.vj(pg_temp.q_conf(v_shopB, v_cA, 'inconclusive', '  บทเรียน   แคมเปญ A ', 'owner', 'ปิดทั้งที่ยังมีชิ้นค้าง', 'inconclusive'));
  select * into r from analytics.campaign where id = v_cA;
  v_log := v_log || pg_temp.vb('Q12b', 'owner ปิดแคมเปญที่มีชิ้นค้าง 1 ชิ้น ผ่าน (ไม่ปฏิเสธ — มติ Q12): verdict/note/lesson(clean)/status done/confirmed_at/by_role/result_open_pieces = 1',
    v_j ? 'verdict' and r.result_verdict = 'inconclusive' and r.result_note = 'ปิดทั้งที่ยังมีชิ้นค้าง' and r.lesson = 'บทเรียน แคมเปญ A' and r.status = 'done'
    and r.result_verdict_confirmed_at is not null and r.result_verdict_confirmed_by_role = 'owner' and r.result_open_pieces = 1, left(v_j::text, 220));
  v_log := v_log || pg_temp.vb('Q12c', 'payload: open_pieces 1 · open_by_status {idea:1} · excluded_from_result 1 · proposed_was inconclusive · status done · previous_verdict null',
    (v_j ->> 'open_pieces') = '1' and (v_j -> 'open_by_status' ->> 'idea') = '1' and (v_j ->> 'excluded_from_result') = '1' and (v_j ->> 'proposed_was') = 'inconclusive'
    and (v_j ->> 'status') = 'done' and (v_j ->> 'previous_verdict') is null, left(v_j::text, 220));
  v_log := v_log || pg_temp.vb('Q12d', 'proposed_* ไม่ถูกล้างหลังยืนยัน (เก็บประวัติว่า AI/owner เสนออะไร)', r.result_verdict_proposed = 'inconclusive' and r.result_proposed_by_role = 'owner' and r.result_proposed_note is not null);
  select count(*) into v_n from analytics.content_signal where shop_id = v_shopB and kind = 'insight' and origin_campaign_id = v_cA;
  v_sig := (v_j ->> 'signal_id')::uuid;
  v_log := v_log || pg_temp.vb('Q12e', 'บทเรียน → content_signal insight 1 แถว (origin_campaign_id = cA · signal_created true · summary = บทเรียนที่ clean แล้ว)',
    v_n = 1 and (v_j ->> 'signal_created') = 'true' and (select summary from analytics.content_signal where id = v_sig) = 'บทเรียน แคมเปญ A', 'signal ' || v_n);
  select * into r from analytics.v_campaign_summary where campaign_id = v_cA;
  v_log := v_log || pg_temp.vb('Q12f', 'v_campaign_summary หลังปิด: stage closed · verdict_display = inconclusive (ค่าที่ยืนยัน ไม่ใช่ proposed:) · awaiting_confirm false · result_open_pieces 1 · pieces_open 1',
    r.stage = 'closed' and r.verdict_display = 'inconclusive' and not r.awaiting_confirm and r.result_open_pieces = 1 and r.pieces_open = 1, coalesce(r.verdict_display, 'null') || '/' || r.stage);
  select count(*) into v_n from analytics.v_recommendation_inbox where item_kind = 'campaign_verdict' and item_id = v_cA;
  v_log := v_log || pg_temp.vb('Q12g', 'หลังยืนยัน cA หายจาก inbox (campaign_verdict)', v_n = 0, 'พบ ' || v_n);
  v_log := v_log || pg_temp.vl('Q12h', 'ปิดแล้ว: propose ตกด่านปิดแล้ว → 55000', pg_temp.vx(pg_temp.q_prop(v_shopB, v_cA, 'inconclusive', 'หลักฐานทดสอบ', 'owner'), array['55000']));
  v_log := v_log || pg_temp.vl('Q12i', 'ปิดแล้ว: plan_set ตกด่านปิดแล้ว → 55000 (ทุก actor)', pg_temp.vx(pg_temp.q_plan(v_shopB, v_cA, '{"hypothesis":"แก้หลังปิด"}', 'owner'), array['55000']));
  -- ยืนยันซ้ำ (เปลี่ยนใจ): ข้อความบทเรียนเดิม = ไม่สร้าง signal ซ้ำ · คืน signal เดิม · previous_* คืนค่าเก่า
  v_j2 := pg_temp.vj(pg_temp.q_conf(v_shopB, v_cA, 'not_measured', 'บทเรียน แคมเปญ A', 'owner', null, 'inconclusive'));
  select count(*) into v_n from analytics.content_signal where shop_id = v_shopB and kind = 'insight' and origin_campaign_id = v_cA;
  v_log := v_log || pg_temp.vb('Q12j', 'ยืนยันซ้ำ (เปลี่ยนใจเป็น not_measured) บทเรียนเดิม: signal ยัง 1 · signal_created false · คืน signal เดิม · previous_verdict inconclusive · status ยัง done · note เดิมคงอยู่ (null = คงของเดิม)',
    v_n = 1 and (v_j2 ->> 'signal_created') = 'false' and (v_j2 ->> 'signal_id') = v_sig::text and (v_j2 ->> 'previous_verdict') = 'inconclusive'
    and (select result_verdict from analytics.campaign where id = v_cA) = 'not_measured' and (select result_note from analytics.campaign where id = v_cA) = 'ปิดทั้งที่ยังมีชิ้นค้าง', left(v_j2::text, 220));
  v_j2 := pg_temp.vj(pg_temp.q_conf(v_shopB, v_cA, 'not_measured', 'บทเรียนใหม่ของแคมเปญ A', 'owner', null, 'inconclusive'));
  select count(*) into v_n from analytics.content_signal where shop_id = v_shopB and kind = 'insight' and origin_campaign_id = v_cA;
  v_log := v_log || pg_temp.vb('Q12k', 'บทเรียนข้อความใหม่ = signal ใหม่ (รวม 2) · previous_lesson คืนบทเรียนเก่า', v_n = 2 and (v_j2 ->> 'previous_lesson') = 'บทเรียน แคมเปญ A' and (v_j2 ->> 'signal_created') = 'true', left(v_j2::text, 200));
  -- QA-4 (ข้อ V): p_lesson null = "ไม่ส่ง" → คงบทเรียนเดิม (ไม่ทับเป็นว่าง · ไม่สร้าง signal ซ้ำ) · '' / อักขระล่องหนล้วน = ตั้งใจล้าง · ข้อความ = ตั้งใหม่
  v_j2 := pg_temp.vj(pg_temp.q_conf(v_shopB, v_cA, 'not_measured', null, 'owner', null, 'inconclusive'));
  select count(*) into v_n from analytics.content_signal where shop_id = v_shopB and kind = 'insight' and origin_campaign_id = v_cA;
  v_log := v_log || pg_temp.vb('Q12l', 'ยืนยันซ้ำโดยไม่ส่งบทเรียน (null) ผ่าน · บทเรียนในแถวคงเดิม (ไม่ทับเป็นว่าง) · lesson_kept true · previous_lesson = บทเรียนเดิม · ไม่สร้าง signal เพิ่ม (ยัง 2)',
    (select lesson from analytics.campaign where id = v_cA) = 'บทเรียนใหม่ของแคมเปญ A' and (v_j2 ->> 'lesson_kept') = 'true' and (v_j2 ->> 'previous_lesson') = 'บทเรียนใหม่ของแคมเปญ A'
    and (v_j2 ->> 'signal_created') = 'false' and (v_j2 ->> 'signal_id') is null and v_n = 2, left(v_j2::text, 200));
  v_j2 := pg_temp.vj(pg_temp.q_conf(v_shopB, v_cA, 'not_measured', '', 'owner', null, 'inconclusive'));
  v_log := v_log || pg_temp.vb('Q12l2', 'ยืนยันซ้ำโดยส่ง "" (ตั้งใจล้าง) → บทเรียนในแถวเป็น null · lesson_kept false · previous_lesson คืนค่าเก่าให้เห็น (ไม่ทับเงียบ)',
    (select lesson from analytics.campaign where id = v_cA) is null and (v_j2 ->> 'lesson_kept') = 'false' and (v_j2 ->> 'previous_lesson') = 'บทเรียนใหม่ของแคมเปญ A', left(v_j2::text, 200));
  v_j2 := pg_temp.vj(pg_temp.q_conf(v_shopB, v_cA, 'not_measured', null, 'owner', null, 'inconclusive'));
  v_log := v_log || pg_temp.vb('Q12l3', 'บทเรียนว่างอยู่แล้ว + ไม่ส่ง (null) → ยังว่าง (ไม่เกิดบทเรียนขึ้นเอง) · lesson_kept true', (select lesson from analytics.campaign where id = v_cA) is null and (v_j2 ->> 'lesson_kept') = 'true', left(v_j2::text, 160));
  perform pg_temp.vj(pg_temp.q_conf(v_shopB, v_cA, 'not_measured', 'บทเรียนรอบสาม', 'owner', null, 'inconclusive'));
  v_j2 := pg_temp.vj(pg_temp.q_conf(v_shopB, v_cA, 'not_measured', chr(8203) || '  ' || chr(8203), 'owner', null, 'inconclusive'));
  v_log := v_log || pg_temp.vb('Q12l4', 'ส่งช่องว่าง/ZWSP ล้วน = ตั้งใจล้างเหมือน "" (หลัง clean ว่าง) → บทเรียนเป็น null · previous_lesson = บทเรียนรอบสาม',
    (select lesson from analytics.campaign where id = v_cA) is null and (v_j2 ->> 'lesson_kept') = 'false' and (v_j2 ->> 'previous_lesson') = 'บทเรียนรอบสาม', left(v_j2::text, 200));
  -- expected ว่าง/none ตอนไม่มีข้อเสนอ ผ่านได้ทั้งคู่ (cH/cI ไม่เคยถูกเสนอ)
  v_cH := pg_temp.mk_camp(v_shopB, null);
  v_cI := pg_temp.mk_camp(v_shopB, null);
  v_j := pg_temp.vj(pg_temp.q_conf(v_shopB, v_cH, 'inconclusive', null, 'owner', null, ''));
  v_log := v_log || pg_temp.vb('Q12m', 'expected ค่าว่าง (เจ้าของเห็นว่าไม่มีข้อเสนอ) ตอนไม่มีข้อเสนอจริง ผ่าน · proposed_was null · ไม่มีบทเรียน = ไม่มี signal', v_j ? 'verdict' and (v_j ->> 'proposed_was') is null and (v_j ->> 'signal_id') is null
    and (select result_open_pieces from analytics.campaign where id = v_cH) = 1, left(v_j::text, 200));
  v_j := pg_temp.vj(pg_temp.q_conf(v_shopB, v_cI, 'not_measured', null, 'owner', null, 'none'));
  v_log := v_log || pg_temp.vb('Q12n', 'expected none ตอนไม่มีข้อเสนอจริง ผ่าน', v_j ? 'verdict', left(v_j::text, 200));
  -- owner ขัดข้อเสนอ AI = ปกติ: cF ai เสนอ validated (G5) · เจ้าของยืนยัน invalidated ผ่าน (ครบ 4 ชิ้น) · เก็บทั้งสองค่า
  v_j := pg_temp.vj(pg_temp.q_conf(v_shopB, v_cF, 'invalidated', 'AI เสนอ validated แต่เจ้าของเห็นต่าง', 'owner', null, 'validated'));
  select * into r from analytics.campaign where id = v_cF;
  v_log := v_log || pg_temp.vb('Q12o', 'owner ยืนยัน invalidated ขัดกับข้อเสนอ AI (validated) ผ่านเมื่อครบ 4 ชิ้น · เก็บ proposed=validated ไว้ · ชิ้นค้าง 1 บันทึก',
    v_j ? 'verdict' and r.result_verdict = 'invalidated' and r.result_verdict_proposed = 'validated' and r.result_proposed_by_role = 'ai' and r.result_open_pieces = 1, left(v_j::text, 200));
  ----------------------------------------------------------------------------
  -- SEC-M1 (ข้อ Q): compare-and-set ด้วย token ของเนื้อหาที่เจ้าของเห็น — บังคับไม่ null · เนื้อหาเปลี่ยนระหว่างอ่าน = 55000 "ข้อมูลเปลี่ยนแล้ว รีเฟรชก่อน"
  --   e1/e3: expected_proposed ตรงกับข้อเสนอปัจจุบันเสมอ ⇒ ที่ตกต้องเป็นด่าน token เท่านั้น (mutant: ถอดด่าน token ⇒ ผ่านทั้งหมด)
  ----------------------------------------------------------------------------
  v_cT := pg_temp.mk_camp(v_shopB, null);
  perform pg_temp.vj(pg_temp.q_prop(v_shopB, v_cT, 'inconclusive', 'ข้อเสนอแรกของ cT', 'ai'));
  v_tok := analytics.campaign_verdict_token_(v_cT);
  select verdict_token into v_s1 from analytics.v_campaign_summary where campaign_id = v_cT;
  select content_token into v_s2 from analytics.v_recommendation_inbox where item_kind = 'campaign_verdict' and item_id = v_cT;
  v_log := v_log || pg_temp.vb('M1a', 'token = md5 (32 ฐานสิบหก) · v_campaign_summary.verdict_token ตรงฟังก์ชัน · v_recommendation_inbox.content_token (แขน campaign_verdict) ตรงกัน',
    v_tok ~ '^[0-9a-f]{32}$' and v_s1 = v_tok and v_s2 = v_tok, coalesce(v_tok, 'null') || '/' || coalesce(v_s1, 'null') || '/' || coalesce(v_s2, 'null'));
  v_log := v_log || pg_temp.vl('M1b', 'confirm token = null → 22023 (compare-and-set ห้ามข้ามด้วย null)', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cT, 'inconclusive', null, 'owner', null, 'inconclusive', null), array['22023'], 'p_expected_token'));
  v_log := v_log || pg_temp.vl('M1c', 'confirm token รูปผิด (abc / ตัวพิมพ์ใหญ่ / ว่าง) → 22023', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cT, 'inconclusive', null, 'owner', null, 'inconclusive', 'abc'), array['22023'])
    || pg_temp.vx(pg_temp.q_conf(v_shopB, v_cT, 'inconclusive', null, 'owner', null, 'inconclusive', upper(v_tok)), array['22023']) || pg_temp.vx(pg_temp.q_conf(v_shopB, v_cT, 'inconclusive', null, 'owner', null, 'inconclusive', ''), array['22023']));
  v_log := v_log || pg_temp.vl('M1c2', 'confirm token md5 รูปถูกแต่ไม่ใช่ของแคมเปญนี้ → 55000 "ข้อมูลแคมเปญเปลี่ยนแล้ว"', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cT, 'inconclusive', null, 'owner', null, 'inconclusive', repeat('0', 32)), array['55000'], 'ข้อมูลแคมเปญเปลี่ยนแล้ว'));
  perform pg_temp.vj(pg_temp.q_prop(v_shopB, v_cT, 'not_measured', 'AI เปลี่ยนข้อเสนอ', 'ai'));
  v_tok2 := analytics.campaign_verdict_token_(v_cT);
  v_log := v_log || pg_temp.vb('M1d', 'AI เปลี่ยนข้อเสนอ (verdict) → token เปลี่ยน', v_tok2 <> v_tok);
  v_log := v_log || pg_temp.vl('M1e', 'confirm ด้วย token เก่า (expected_proposed = ข้อเสนอปัจจุบัน ผ่านด่านแรก) → 55000 ที่ด่าน token', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cT, 'not_measured', null, 'owner', null, 'not_measured', v_tok), array['55000'], 'ข้อมูลแคมเปญเปลี่ยนแล้ว'));
  perform pg_temp.vj(pg_temp.q_prop(v_shopB, v_cT, 'not_measured', 'AI แก้ถ้อยคำหลักฐานเฉยๆ verdict เดิม', 'ai'));
  v_tok3 := analytics.campaign_verdict_token_(v_cT);
  v_log := v_log || pg_temp.vb('M1f', 'AI แก้เฉพาะหลักฐาน (verdict เท่าเดิม) → token เปลี่ยน', v_tok3 <> v_tok2);
  v_log := v_log || pg_temp.vl('M1g', 'confirm ด้วย token ก่อน AI แก้หลักฐาน (verdict ยังเท่าเดิม — expected_proposed อย่างเดียวจับไม่ได้) → 55000', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cT, 'not_measured', null, 'owner', null, 'not_measured', v_tok2), array['55000'], 'ข้อมูลแคมเปญเปลี่ยนแล้ว'));
  perform pg_temp.vj(pg_temp.q_plan(v_shopB, v_cT, '{"hypothesis":"เจ้าของแก้สมมติฐานระหว่างที่ AI เสนอ"}', 'owner'));
  v_tok := analytics.campaign_verdict_token_(v_cT);
  v_log := v_log || pg_temp.vb('M1h0', 'แก้แผน (สมมติฐาน) → token เปลี่ยน', v_tok <> v_tok3);
  v_log := v_log || pg_temp.vl('M1h', 'confirm ด้วย token ก่อนแผนเปลี่ยน → 55000 (token ครอบแผน/เกณฑ์ ไม่ใช่แค่ข้อเสนอ)', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cT, 'not_measured', null, 'owner', null, 'not_measured', v_tok3), array['55000'], 'ข้อมูลแคมเปญเปลี่ยนแล้ว'));
  update analytics.campaign set status = 'active', note = 'บันทึกบอร์ดที่ไม่เกี่ยวกับคำตัดสิน' where id = v_cT;
  v_log := v_log || pg_temp.vb('M1i', 'แก้ status/note ของบอร์ด (ไม่เกี่ยวกับสิ่งที่เจ้าของตัดสิน) → token ไม่เปลี่ยน (ไม่ชนปลอม)', analytics.campaign_verdict_token_(v_cT) = v_tok);
  v_j := pg_temp.vj(pg_temp.q_conf(v_shopB, v_cT, 'not_measured', null, 'owner', null, 'not_measured', v_tok));
  v_log := v_log || pg_temp.vb('M1j', 'confirm ด้วย token ปัจจุบัน ผ่าน (ต้องไม่พัง)', v_j ? 'verdict' and (v_j ->> 'verdict') = 'not_measured', left(v_j::text, 160));
  v_log := v_log || pg_temp.vl('M1k', 'ยืนยันซ้ำด้วย token ก่อนยืนยัน (คำตัดสินที่ยืนยันเปลี่ยนสถานะแล้ว) → 55000', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cT, 'not_measured', null, 'owner', null, 'not_measured', v_tok), array['55000'], 'ข้อมูลแคมเปญเปลี่ยนแล้ว'));
  -- ข้อเสนอ (reco): token ครอบเนื้อหา/เส้นตาย/ค่าเริ่มต้น/ลิงก์ · ไม่ครอบ outcome_note
  v_j := pg_temp.vj(pg_temp.q_rcreate(v_shopB, 'Verify Token Reco', 'เนื้อหาเดิม', 'ai'));
  v_rT := (v_j ->> 'id')::uuid;
  v_tok := analytics.recommendation_token_(v_rT);
  select content_token into v_s1 from analytics.v_recommendation_inbox where item_kind = 'reco' and item_id = v_rT;
  v_log := v_log || pg_temp.vb('M1l', 'recommendation_token_ = md5 · ตรง v_recommendation_inbox.content_token (แขน reco) · แขน risk_gate = null', v_tok ~ '^[0-9a-f]{32}$' and v_s1 = v_tok
    and not exists (select 1 from analytics.v_recommendation_inbox where item_kind = 'risk_gate' and content_token is not null), coalesce(v_tok, 'null'));
  v_log := v_log || pg_temp.vl('M1m', 'respond token = null → 22023', pg_temp.vx(pg_temp.q_rresp(v_shopB, v_rT, 'done', null, 'owner', null), array['22023'], 'p_expected_token'));
  v_log := v_log || pg_temp.vl('M1n', 'respond token รูปผิด (xyz / ตัวพิมพ์ใหญ่) → 22023', pg_temp.vx(pg_temp.q_rresp(v_shopB, v_rT, 'done', null, 'owner', 'xyz'), array['22023'])
    || pg_temp.vx(pg_temp.q_rresp(v_shopB, v_rT, 'done', null, 'owner', upper(v_tok)), array['22023']));
  v_log := v_log || pg_temp.vl('M1n2', 'respond token md5 รูปถูกแต่ผิดแถว → 55000 "ข้อมูลข้อเสนอเปลี่ยนแล้ว"', pg_temp.vx(pg_temp.q_rresp(v_shopB, v_rT, 'done', null, 'owner', repeat('f', 32)), array['55000'], 'ข้อมูลข้อเสนอเปลี่ยนแล้ว'));
  update analytics.recommendation_log set detail = 'เนื้อหาถูกแก้ระหว่างที่เจ้าของอ่าน' where id = v_rT;
  v_tok2 := analytics.recommendation_token_(v_rT);
  v_log := v_log || pg_temp.vb('M1o', 'แก้ detail ของข้อเสนอที่ยัง pending (postgres) → token เปลี่ยน', v_tok2 <> v_tok);
  v_log := v_log || pg_temp.vl('M1p', 'respond ด้วย token ก่อนแก้ → 55000 "ข้อมูลข้อเสนอเปลี่ยนแล้ว" (เจ้าของไม่ตอบข้อเสนอที่ไม่ใช่ฉบับที่เห็น)', pg_temp.vx(pg_temp.q_rresp(v_shopB, v_rT, 'done', null, 'owner', v_tok), array['55000'], 'ข้อมูลข้อเสนอเปลี่ยนแล้ว'));
  update analytics.recommendation_log set outcome_note = 'ทีมจดผลทีหลัง' where id = v_rT;
  v_log := v_log || pg_temp.vb('M1q', 'แก้ outcome_note (ผลที่ทีมจด) → token ไม่เปลี่ยน', analytics.recommendation_token_(v_rT) = v_tok2);
  v_j := pg_temp.vj(pg_temp.q_rresp(v_shopB, v_rT, 'done', 'ตอบตามฉบับที่เห็น', 'owner', v_tok2));
  v_log := v_log || pg_temp.vb('M1r', 'respond ด้วย token ปัจจุบัน ผ่าน (ต้องไม่พัง) · owner_response เก็บคำตอบ · outcome_note ที่ทีมจดไว้ไม่ถูกทับ', (v_j ->> 'owner_action') = 'done'
    and (select owner_response from analytics.recommendation_log where id = v_rT) = 'ตอบตามฉบับที่เห็น' and (select outcome_note from analytics.recommendation_log where id = v_rT) = 'ทีมจดผลทีหลัง', left(v_j::text, 160));

  ----------------------------------------------------------------------------
  -- SEC-Low (ข้อ X/B): แคมเปญที่ "ยกเลิกทุกชิ้น" ฟัน validated/invalidated ไม่ได้ (ปิดด้วย inconclusive/not_measured ได้ — มติ Q12) · ยกเลิกแค่บางชิ้นไม่ติด
  ----------------------------------------------------------------------------
  v_cX := pg_temp.mk_camp(v_shopB, null);
  select s.id into v_step from analytics.campaign_step s where s.campaign_id = v_cX limit 1;
  perform set_config('c2.piece_rpc', '1', true);
  update analytics.campaign_step set piece_status = 'cancelled' where id = v_step;
  perform set_config('c2.piece_rpc', '', true);
  v_log := v_log || pg_temp.vl('X1', 'ai เสนอ validated บนแคมเปญที่ยกเลิกทุกชิ้น → 55000 "ยกเลิกทุกชิ้น"', pg_temp.vx(pg_temp.q_prop(v_shopB, v_cX, 'validated', 'หลักฐานทดสอบ', 'ai'), array['55000'], 'ยกเลิกทุกชิ้น'));
  v_log := v_log || pg_temp.vl('X2', 'ai เสนอ invalidated บนแคมเปญที่ยกเลิกทุกชิ้น → 55000', pg_temp.vx(pg_temp.q_prop(v_shopB, v_cX, 'invalidated', 'หลักฐานทดสอบ', 'ai'), array['55000'], 'ยกเลิกทุกชิ้น'));
  v_log := v_log || pg_temp.vl('X3', 'owner ยืนยัน validated บนแคมเปญที่ยกเลิกทุกชิ้น → 55000 (ด่านเดียวกัน)', pg_temp.vx(pg_temp.q_conf(v_shopB, v_cX, 'validated', null, 'owner', null, 'none'), array['55000'], 'ยกเลิกทุกชิ้น'));
  v_log := v_log || pg_temp.vl('X4', 'ต้องไม่พัง: ai เสนอ inconclusive บนแคมเปญที่ยกเลิกทุกชิ้น ผ่าน', pg_temp.vok(pg_temp.q_prop(v_shopB, v_cX, 'inconclusive', 'ยกเลิกทั้งแคมเปญ', 'ai')));
  v_j := pg_temp.vj(pg_temp.q_conf(v_shopB, v_cX, 'inconclusive', null, 'owner', null, 'inconclusive'));
  v_log := v_log || pg_temp.vb('X5', 'ต้องไม่พัง: owner ปิดแคมเปญที่ยกเลิกทุกชิ้นด้วย inconclusive ผ่าน (มติ Q12 ปิดได้ทุกเมื่อ) · status done · open_pieces 0', v_j ? 'verdict' and (v_j ->> 'open_pieces') = '0'
    and (select status from analytics.campaign where id = v_cX) = 'done', left(v_j::text, 160));
  v_cY := pg_temp.mk_camp(v_shopB, null);
  select s.id into v_step from analytics.campaign_step s where s.campaign_id = v_cY limit 1;
  perform set_config('c2.piece_rpc', '1', true);
  update analytics.campaign_step set piece_status = 'cancelled' where id = v_step;
  perform set_config('c2.piece_rpc', '', true);
  perform analytics.content_piece_create(v_shopB, 'verify-0162 Y second piece', 'short_clip', 'tiktok', 'jewelry_925', 'owner', null, null, v_cY);
  v_log := v_log || pg_temp.vl('X6', 'ต้องไม่พัง: ยกเลิก 1 ชิ้น แต่ยังมีชิ้นค้าง 1 (ไม่ใช่ทุกชิ้น) ai เสนอ validated ผ่านด่านนี้ (metric ว่าง)', pg_temp.vok(pg_temp.q_prop(v_shopB, v_cY, 'validated', 'ยังมีชิ้นไม่ถูกยกเลิก', 'ai')));

  -- ข้อมูลจริง: แคมเปญเก่า (ไม่มี piece_status) ทั้ง flow propose → inbox → confirm → ปิด (N8) — ใน ROLLBACK
  select c.id into v_cL from analytics.campaign c
   where c.shop_id = v_shop and c.status <> 'done' and c.result_verdict_confirmed_at is null
     and not exists (select 1 from analytics.campaign_step s where s.campaign_id = c.id and s.piece_status is not null)
   order by c.created_at limit 1;
  if v_cL is null then
    v_log := v_log || E'[SKIP] N8d-h ไม่มีแคมเปญเก่าที่ยังไม่ปิดและไม่มีชิ้นใน workflow ใหม่ในร้านจริง — ทดสอบ flow บนแคมเปญจริงไม่ได้\n';
  else
    select status into v_s1 from analytics.campaign where id = v_cL;
    v_j := pg_temp.vj(pg_temp.q_prop(v_shop, v_cL, 'inconclusive', 'ข้อมูลยังไม่พอตัดสิน (ทดสอบ verify)', 'ai'));
    select count(*) into v_n from analytics.v_recommendation_inbox where item_kind = 'campaign_verdict' and item_id = v_cL and shop_id = v_shop;
    v_log := v_log || pg_temp.vb('N8d', 'แคมเปญเก่าจริง: ai เสนอ inconclusive ผ่าน (ไม่มี metric ⇒ ไม่ติดด่าน) → โผล่ inbox campaign_verdict', v_j ? 'proposed' and v_n = 1, left(v_j::text, 160));
    v_j := pg_temp.vj(pg_temp.q_conf(v_shop, v_cL, 'not_measured', 'บทเรียนทดสอบ verify แคมเปญเก่า', 'owner', null, 'inconclusive'));
    select * into r from analytics.v_campaign_summary where campaign_id = v_cL;
    select count(*) into v_n from analytics.v_recommendation_inbox where item_kind = 'campaign_verdict' and item_id = v_cL;
    v_log := v_log || pg_temp.vb('N8e', 'owner ยืนยัน not_measured บนแคมเปญเก่า: status done · verdict_display = not_measured · หายจาก inbox · pieces_open 0 → result_open_pieces 0',
      v_j ? 'verdict' and r.stage = 'closed' and r.verdict_display = 'not_measured' and v_n = 0 and r.result_open_pieces = 0 and r.status = 'done', left(v_j::text, 200) || ' (เดิม status ' || v_s1 || ')');
    select count(*) into v_n from analytics.content_signal where shop_id = v_shop and origin_campaign_id = v_cL and kind = 'insight';
    v_log := v_log || pg_temp.vb('N8f', 'บทเรียนของแคมเปญเก่า → signal origin_campaign_id', v_n = 1, 'signal ' || v_n);
  end if;

  ----------------------------------------------------------------------------
  -- Y16: trigger ด่านตาราง campaign — service_role เขียนสมมติฐาน/เกณฑ์/คำตัดสินตรงไม่ได้ (55000) · แต่คอลัมน์ของบอร์ดเดิมต้องไม่พัง
  ----------------------------------------------------------------------------
  v_cJ := pg_temp.mk_camp(v_shopB, null);
  v_snapA := pg_temp.csnap(v_cJ);
  v_log := v_log || pg_temp.vl('Y16a', 'service_role: update result_verdict = validated → 55000', pg_temp.vr('service_role', format('update analytics.campaign set result_verdict = %L where id = %L', 'validated', v_cJ), array['55000']));
  v_log := v_log || pg_temp.vl('Y16b', 'service_role: update hypothesis → 55000', pg_temp.vr('service_role', format('update analytics.campaign set hypothesis = %L where id = %L', 'x', v_cJ), array['55000']));
  v_log := v_log || pg_temp.vl('Y16c', 'service_role: update metric_code → 55000', pg_temp.vr('service_role', format('update analytics.campaign set metric_code = %L where id = %L', 'save_rate', v_cJ), array['55000']));
  v_log := v_log || pg_temp.vl('Y16d', 'service_role: ปลอมการยืนยันของเจ้าของ (confirmed_at + by_role + open_pieces) → 55000',
    pg_temp.vr('service_role', format('update analytics.campaign set result_verdict_confirmed_at = now(), result_verdict_confirmed_by_role = %L, result_open_pieces = 0 where id = %L', 'owner', v_cJ), array['55000']));
  v_log := v_log || pg_temp.vl('Y16e', 'service_role: ปลอมข้อเสนอ AI (proposed + note + at + by_role) → 55000',
    pg_temp.vr('service_role', format('update analytics.campaign set result_verdict_proposed = %L, result_proposed_note = %L, result_proposed_at = now(), result_proposed_by_role = %L where id = %L', 'validated', 'หลักฐานปลอม', 'ai', v_cJ), array['55000']));
  v_log := v_log || pg_temp.vl('Y16f', 'service_role: update lesson → 55000', pg_temp.vr('service_role', format('update analytics.campaign set lesson = %L where id = %L', 'x', v_cJ), array['55000']));
  v_log := v_log || pg_temp.vl('Y16g', 'service_role: INSERT campaign ที่ตั้ง hypothesis → 55000', pg_temp.vr('service_role',
    format('insert into analytics.campaign (shop_id, name, campaign_type, trigger_kind, hypothesis) values (%L, %L, %L, %L, %L)', v_shopB, 'verify16g', 'content_task', 'manual', 'x'), array['55000']));
  v_log := v_log || pg_temp.vl('Y16h', 'service_role: INSERT campaign ที่ตั้ง result_verdict = validated → 55000', pg_temp.vr('service_role',
    format('insert into analytics.campaign (shop_id, name, campaign_type, trigger_kind, result_verdict) values (%L, %L, %L, %L, %L)', v_shopB, 'verify16h', 'content_task', 'manual', 'validated'), array['55000']));
  v_log := v_log || pg_temp.vb('Y16z', 'reject ทั้งชุดแล้ว cJ ไม่ถูกเขียนอะไร', pg_temp.csnap(v_cJ) = v_snapA);
  -- SEC-Low (ข้อ X): ปิดแคมเปญ (status = done) ต้องผ่าน campaign_verdict_confirm — service_role ตั้งตรงไม่ได้ · สถานะอื่นของบอร์ดยังตั้งได้
  v_log := v_log || pg_temp.vl('Y16i', 'service_role update status = done → 55000 (ปิดผ่าน campaign_verdict_confirm เท่านั้น)', pg_temp.vr('service_role', format('update analytics.campaign set status = %L where id = %L', 'done', v_cJ), array['55000'], 'campaign_verdict_confirm'));
  v_log := v_log || pg_temp.vl('Y16i2a', 'ต้องไม่พัง: service_role update status = active (บอร์ดเดิม) ผ่าน', pg_temp.vro('service_role', format('update analytics.campaign set status = %L where id = %L', 'active', v_cJ)));
  v_log := v_log || pg_temp.vl('Y16i2b', 'ต้องไม่พัง: service_role update status = blocked + blocked_reason ผ่าน', pg_temp.vro('service_role', format('update analytics.campaign set status = %L, blocked_reason = %L where id = %L', 'blocked', 'รอของ', v_cJ)));
  v_log := v_log || pg_temp.vl('Y16i2c', 'ต้องไม่พัง: service_role update status = waiting_data ผ่าน', pg_temp.vro('service_role', format('update analytics.campaign set status = %L where id = %L', 'waiting_data', v_cJ)));
  v_log := v_log || pg_temp.vl('Y16i3', 'service_role INSERT campaign ที่ status = done → 55000', pg_temp.vr('service_role',
    format('insert into analytics.campaign (shop_id, name, campaign_type, trigger_kind, status) values (%L, %L, %L, %L, %L)', v_shopB, 'verify16i3', 'content_task', 'manual', 'done'), array['55000']));
  v_log := v_log || pg_temp.vl('Y16i4', 'ต้องไม่พัง: service_role update แถวที่ done อยู่แล้ว (status done → done ไม่เปลี่ยน) ผ่าน — guard เทียบค่าเดิม', pg_temp.vro('service_role', format('update analytics.campaign set status = %L, note = %L where id = %L', 'done', 'บันทึกหลังปิด', v_cA)));
  v_log := v_log || pg_temp.vl('Y16m', 'service_role INSERT ปลอม "เจ้าของยืนยันแล้ว" (confirmed_at + by_role + open_pieces ครบตาม CHECK) → 55000 (mutant: ถอดสามคอลัมน์นี้ออกจาก num_nonnulls)', pg_temp.vr('service_role',
    format('insert into analytics.campaign (shop_id, name, campaign_type, trigger_kind, result_verdict_confirmed_at, result_verdict_confirmed_by_role, result_open_pieces) values (%L, %L, %L, %L, now(), %L, 0)', v_shopB, 'verify16m', 'content_task', 'manual', 'owner'), array['55000']));
  v_log := v_log || pg_temp.vl('Y16m2', 'service_role INSERT ปลอมข้อเสนอ AI ครบชุด (proposed + note + at + by_role) → 55000', pg_temp.vr('service_role',
    format('insert into analytics.campaign (shop_id, name, campaign_type, trigger_kind, result_verdict_proposed, result_proposed_note, result_proposed_at, result_proposed_by_role) values (%L, %L, %L, %L, %L, %L, now(), %L)', v_shopB, 'verify16m2', 'content_task', 'manual', 'validated', 'หลักฐานปลอม', 'ai'), array['55000']));
  v_log := v_log || pg_temp.vl('Y16j', 'ต้องไม่พัง: service_role update blocked_reason + note + anchor_date ผ่าน', pg_temp.vro('service_role',
    format('update analytics.campaign set blocked_reason = %L, note = %L, anchor_date = %L where id = %L', 'รอของ', 'บันทึก', v_today, v_cJ)));
  v_log := v_log || pg_temp.vl('Y16k', 'ต้องไม่พัง: service_role INSERT campaign ธรรมดา (ไม่ตั้งคอลัมน์ที่ guard) ผ่าน', pg_temp.vro('service_role',
    format('insert into analytics.campaign (shop_id, name, campaign_type, trigger_kind) values (%L, %L, %L, %L)', v_shopB, 'verify16k', 'content_task', 'manual')));
  v_log := v_log || pg_temp.vl('Y16l', 'ต้องไม่พัง: service_role update ค่าเดิมทับค่าเดิม (hypothesis null → null) ผ่าน — guard เทียบค่าไม่ใช่ตรวจว่ามีคอลัมน์ใน SET', pg_temp.vro('service_role',
    format('update analytics.campaign set hypothesis = null, result_verdict = result_verdict where id = %L', v_cJ)));

  ----------------------------------------------------------------------------
  -- Weekly summary (Y21/Y22/N13) — สร้างก่อนเพราะ recommendation ใช้ summary_id
  ----------------------------------------------------------------------------
  v_mon := date_trunc('week', v_today::timestamp)::date - 7;   -- จันทร์ของสัปดาห์ก่อน (≤ วันนี้เสมอ)
  v_snapW := pg_temp.wsnap(v_shopB);
  v_i := 0;
  foreach v_k in array array[(v_mon + 1)::text, '2024-12-30', (v_mon + 14)::text, 'infinity', '-infinity'] loop
    v_i := v_i + 1;
    v_log := v_log || pg_temp.vl('Y21a' || chr(96 + v_i), 'week_start ผิด ' || v_k, pg_temp.vx(pg_temp.q_wsum(v_shopB, v_k, v_mon::text, '{"สรุปบรรทัดหนึ่ง"}', '# Brief', 'ai'), array['22023']));
  end loop;
  v_log := v_log || pg_temp.vl('Y21b1', 'brief_date = week_start − 1', pg_temp.vx(pg_temp.q_wsum(v_shopB, v_mon::text, (v_mon - 1)::text, '{"สรุป"}', '# Brief', 'ai'), array['22023']));
  v_log := v_log || pg_temp.vl('Y21b2', 'brief_date = week_start + 15', pg_temp.vx(pg_temp.q_wsum(v_shopB, v_mon::text, (v_mon + 15)::text, '{"สรุป"}', '# Brief', 'ai'), array['22023']));
  v_log := v_log || pg_temp.vl('Y21b3', 'brief_date เป็นวันในอนาคต', pg_temp.vx(pg_temp.q_wsum(v_shopB, v_mon::text, (v_today + 1)::text, '{"สรุป"}', '# Brief', 'ai'), array['22023']));
  v_log := v_log || pg_temp.vl('Y21b4', 'brief_date infinity', pg_temp.vx(pg_temp.q_wsum(v_shopB, v_mon::text, 'infinity', '{"สรุป"}', '# Brief', 'ai'), array['22023']));
  v_i := 0;
  foreach v_k in array array['{"1","2","3","4","5","6"}', '{}', '{""}', '{"   "}', format('{"%s"}', repeat('ก', 1001)), format('{"%s"}', chr(8203) || chr(8203)), format('{"ก%sข"}', chr(917569)), format('{"ก%sข"}', chr(173)),
                             '{{"a","b"},{"c","d"}}', '{"a",NULL}', '{NULL}'] loop
    v_i := v_i + 1;
    v_log := v_log || pg_temp.vl('Y21c' || chr(96 + v_i), 'สรุปผิด ' || left(replace(v_k, chr(8203), '<ZWSP>'), 40), pg_temp.vx(pg_temp.q_wsum(v_shopB, v_mon::text, v_mon::text, v_k, '# Brief', 'ai'), array['22023']));
  end loop;
  v_i := 0;
  foreach v_k in array array['', '   ', repeat('ก', 80001), 'ข้อความ' || chr(8238) || 'หลอก', 'ข้อความ' || chr(8203) || 'ซ่อน', 'ข้อความ' || chr(65279), 'ข้อความ' || chr(8296) || 'x'] loop
    v_i := v_i + 1;
    v_log := v_log || pg_temp.vl('Y21d' || chr(96 + v_i), 'เนื้อหาผิด (ว่าง/ยาว/อักขระ bidi-ล่องหน) #' || v_i, pg_temp.vx(pg_temp.q_wsum(v_shopB, v_mon::text, v_mon::text, '{"สรุป"}', v_k, 'ai'), array['22023']));
  end loop;
  v_log := v_log || pg_temp.vl('Y21e1', 'source_path = docs/x.md', pg_temp.vx(pg_temp.q_wsum(v_shopB, v_mon::text, v_mon::text, '{"สรุป"}', '# Brief', 'ai', null, 'docs/x.md'), array['22023']));
  v_log := v_log || pg_temp.vl('Y21e2', 'source_path ลอด path (../)', pg_temp.vx(pg_temp.q_wsum(v_shopB, v_mon::text, v_mon::text, '{"สรุป"}', '# Brief', 'ai', null, 'docs/3j-jewelry/marketing/weekly-brief/../../x.md'), array['22023']));
  v_log := v_log || pg_temp.vl('Y21e3', 'brief_no = 0', pg_temp.vx(pg_temp.q_wsum(v_shopB, v_mon::text, v_mon::text, '{"สรุป"}', '# Brief', 'ai', 0), array['22023']));
  v_log := v_log || pg_temp.vl('Y21e4', 'brief_no = 10000', pg_temp.vx(pg_temp.q_wsum(v_shopB, v_mon::text, v_mon::text, '{"สรุป"}', '# Brief', 'ai', 10000), array['22023']));
  v_log := v_log || pg_temp.vl('Y21f1', 'actor assistant', pg_temp.vx(pg_temp.q_wsum(v_shopB, v_mon::text, v_mon::text, '{"สรุป"}', '# Brief', 'assistant'), array['22023']));
  v_log := v_log || pg_temp.vl('Y21f2', 'actor null', pg_temp.vx(pg_temp.q_wsum(v_shopB, v_mon::text, v_mon::text, '{"สรุป"}', '# Brief', null), array['22023']));
  v_log := v_log || pg_temp.vl('Y21f3', 'shop null', pg_temp.vx(format('select analytics.content_weekly_summary_upsert(null::uuid,%L::date,%L::date,%L::text[],%L,%L)', v_mon, v_mon, '{"สรุป"}', '# Brief', 'ai'), array['22023']));
  v_log := v_log || pg_temp.vl('Y21f4', 'lines null', pg_temp.vx(format('select analytics.content_weekly_summary_upsert(%L::uuid,%L::date,%L::date,null::text[],%L,%L)', v_shopB, v_mon, v_mon, '# Brief', 'ai'), array['22023']));
  v_log := v_log || pg_temp.vl('Y21f5', 'body null', pg_temp.vx(format('select analytics.content_weekly_summary_upsert(%L::uuid,%L::date,%L::date,%L::text[],null,%L)', v_shopB, v_mon, v_mon, '{"สรุป"}', 'ai'), array['22023']));
  foreach v_i in array array[8206, 8207, 1564, 8288, 8292, 917505, 917631, 173, 6158, 8232, 8233, 65529, 65531, 12644, 4447, 1, 8, 11, 12, 14, 31, 127] loop
    v_log := v_log || pg_temp.vl('Y21h-' || v_i, 'เนื้อหา Brief มีอักขระ U+' || upper(to_hex(v_i)) || ' → 22023', pg_temp.vx(pg_temp.q_wsum(v_shopB, v_mon::text, v_mon::text, '{"สรุป"}', 'ข้อความ' || chr(v_i) || 'ต่อ', 'ai'), array['22023'], 'ล่องหน'));
  end loop;
  v_log := v_log || pg_temp.vb('Y21z', 'reject ทั้งชุดแล้วไม่มีสรุปสัปดาห์ถูกเขียนในร้าน B', pg_temp.wsnap(v_shopB) = v_snapW);

  -- ต้องไม่พัง: สร้างใหม่ · ส่งซ้ำเหมือนเดิม (ไม่เขียน) · ทับด้วยเนื้อหาใหม่ (revision) · CRLF → LF · emoji ZWJ ผ่าน · owner/ai ทับกัน
  v_j := pg_temp.vj(pg_temp.q_wsum(v_shopB, v_mon::text, v_mon::text, '{"  บรรทัด   หนึ่ง ","สอง"}', E'# Brief\r\nเนื้อหา ' || chr(128105) || chr(8205) || chr(128187) || E' ZWNJ' || chr(8204) || E' ผ่าน\r\n- ข้อ 1', 'ai', 7, 'docs/3j-jewelry/marketing/weekly-brief/2026-10-05.md'));
  v_id := (v_j ->> 'id')::uuid;
  select * into r from analytics.content_weekly_summary where id = v_id;
  v_log := v_log || pg_temp.vb('W1', 'สร้างใหม่: created true · changed true · revision 1 · lines ถูก clean (ช่องว่างซ้อนยุบ) · CRLF → LF · emoji ZWJ + ZWNJ ผ่าน · brief_no/source_path ลงตาราง · created/updated by_role = ai',
    (v_j ->> 'created') = 'true' and (v_j ->> 'revision') = '1' and r.summary_lines = array['บรรทัด หนึ่ง', 'สอง'] and position(E'\r' in r.body_md) = 0 and position(chr(8205) in r.body_md) > 0 and position(chr(8204) in r.body_md) > 0
    and r.brief_no = 7 and r.created_by_role = 'ai' and r.updated_by_role = 'ai' and r.revision = 1, left(v_j::text, 200));
  v_snapW := pg_temp.wsnap(v_shopB);
  v_j := pg_temp.vj(pg_temp.q_wsum(v_shopB, v_mon::text, v_mon::text, '{"บรรทัด หนึ่ง","สอง"}', E'# Brief\nเนื้อหา ' || chr(128105) || chr(8205) || chr(128187) || E' ZWNJ' || chr(8204) || E' ผ่าน\n- ข้อ 1', 'ai', 7, 'docs/3j-jewelry/marketing/weekly-brief/2026-10-05.md'));
  v_log := v_log || pg_temp.vb('W2', 'ส่งเนื้อหาเดิมซ้ำ (หลัง normalize CRLF/clean): changed false · created false · revision ยัง 1 · ไม่เขียนอะไร (updated_at/แถวเท่าเดิม)',
    (v_j ->> 'changed') = 'false' and (v_j ->> 'created') = 'false' and (v_j ->> 'revision') = '1' and pg_temp.wsnap(v_shopB) = v_snapW, left(v_j::text, 200));
  v_j := pg_temp.vj(pg_temp.q_wsum(v_shopB, v_mon::text, (v_mon + 2)::text, '{"บรรทัดใหม่"}', '# Brief ฉบับแก้', 'system', 7, null));
  select * into r from analytics.content_weekly_summary where id = v_id;
  select count(*) into v_n from analytics.content_weekly_summary where shop_id = v_shopB and week_start = v_mon;
  v_log := v_log || pg_temp.vb('W3', 'ส่งเนื้อหาใหม่สัปดาห์เดิม (system): ทับแถวเดิม (1 แถว) · revision 2 · previous_revision 1 · updated_by_role system · created_by_role ยัง ai · source_path ถูกล้างตามที่ส่ง',
    (v_j ->> 'changed') = 'true' and (v_j ->> 'revision') = '2' and (v_j ->> 'previous_revision') = '1' and v_n = 1 and r.body_md = '# Brief ฉบับแก้' and r.updated_by_role = 'system'
    and r.created_by_role = 'ai' and r.source_path is null and r.brief_date = v_mon + 2, left(v_j::text, 200));
  v_j := pg_temp.vj(pg_temp.q_wsum(v_shopB, v_mon::text, (v_mon + 2)::text, '{"เจ้าของแก้เอง"}', '# เจ้าของแก้', 'owner'));
  v_log := v_log || pg_temp.vb('W4', 'owner ทับได้ (revision 3 · updated_by_role owner)', (v_j ->> 'revision') = '3' and (select updated_by_role from analytics.content_weekly_summary where id = v_id) = 'owner', left(v_j::text, 160));
  v_snapW := pg_temp.wsnap(v_shopB);
  v_log := v_log || pg_temp.vl('Y21g1', 'ai ทับฉบับที่ owner เขียนล่าสุด → 42501 (ห้ามทับเงียบ)', pg_temp.vx(pg_temp.q_wsum(v_shopB, v_mon::text, (v_mon + 2)::text, '{"AI ทับ"}', '# AI ทับ', 'ai'), array['42501']));
  v_log := v_log || pg_temp.vl('Y21g2', 'system ทับฉบับที่ owner เขียนล่าสุด → 42501', pg_temp.vx(pg_temp.q_wsum(v_shopB, v_mon::text, (v_mon + 2)::text, '{"ระบบทับ"}', '# ระบบทับ', 'system'), array['42501']));
  v_log := v_log || pg_temp.vb('Y21g3', 'ฉบับของ owner ไม่ขยับหลังถูก AI/ระบบพยายามทับ', pg_temp.wsnap(v_shopB) = v_snapW);
  v_log := v_log || pg_temp.vl('W5', 'สัปดาห์อื่นของ ai สร้างใหม่ได้ (ไม่ติดฉบับของ owner)', pg_temp.vok(pg_temp.q_wsum(v_shopB, (v_mon - 7)::text, (v_mon - 7)::text, '{"สัปดาห์ก่อนหน้า"}', '# ก่อนหน้า', 'ai')));
  v_j := pg_temp.vj(pg_temp.q_wsum(v_shopC, v_mon::text, v_mon::text, '{"ร้าน C"}', '# C', 'ai'));
  v_id3 := (v_j ->> 'id')::uuid;
  v_log := v_log || pg_temp.vb('W6', 'ร้าน C สัปดาห์เดียวกันได้แถวแยก (unique ต่อ shop+week) · ร้าน B ไม่ถูกแตะ', v_id3 is not null and v_id3 <> v_id and (select count(*) from analytics.content_weekly_summary where week_start = v_mon and shop_id in (v_shopB, v_shopC)) = 2);

  -- QA-1 (ข้อ U): บรรทัดสรุปยาว 1000 ผ่าน (Brief #4 จริงยาว 613) · 1001 ตกที่ Y21ce · 5 บรรทัด × 1000 ผ่าน · เนื้อหาเต็ม 80000 ผ่าน
  v_j := pg_temp.vj(pg_temp.q_wsum(v_shopC, (v_mon - 7)::text, (v_mon - 7)::text, format('{"%s"}', repeat('ก', 1000)), '# ยาว', 'ai'));
  v_log := v_log || pg_temp.vb('W7', 'บรรทัดสรุปยาว 1000 ตัวอักษร ผ่าน (เพดานใหม่)', (v_j ->> 'created') = 'true' and (select length(summary_lines[1]) from analytics.content_weekly_summary where id = (v_j ->> 'id')::uuid) = 1000, left(v_j::text, 160));
  v_j := pg_temp.vj(pg_temp.q_wsum(v_shopC, (v_mon - 14)::text, (v_mon - 14)::text, format('{"%s","%s","%s","%s","%s"}', repeat('ก', 1000), repeat('ข', 1000), repeat('ค', 1000), repeat('ง', 1000), repeat('จ', 1000)), repeat('ก', 80000), 'ai'));
  v_log := v_log || pg_temp.vb('W8', '5 บรรทัด × 1000 + เนื้อหา 80000 ตัวอักษร ผ่านพร้อมกัน', (v_j ->> 'created') = 'true', left(v_j::text, 160));

  -- Y22: เขียนตรงโดย service_role — ชั้นแรก GRANT (42501) · ชั้นสอง trigger (55000 เมื่อมีคน grant กลับ) · postgres (เจ้าของตาราง) เขียนตรงได้
  v_log := v_log || pg_temp.vl('Y22a', 'service_role INSERT content_weekly_summary → 42501 (ไม่มีสิทธิ์)', pg_temp.vr('service_role',
    format('insert into analytics.content_weekly_summary (shop_id, week_start, brief_date, summary_lines, body_md, created_by_role, updated_by_role) values (%L, %L, %L, %L::text[], %L, %L, %L)', v_shopB, v_mon - 14, v_mon - 14, '{"x"}', '# x', 'ai', 'ai'), array['42501']));
  v_log := v_log || pg_temp.vl('Y22b', 'service_role UPDATE → 42501', pg_temp.vr('service_role', format('update analytics.content_weekly_summary set body_md = %L where id = %L', 'แก้ตรง', v_id), array['42501']));
  v_log := v_log || pg_temp.vl('Y22c', 'service_role DELETE → 42501', pg_temp.vr('service_role', format('delete from analytics.content_weekly_summary where id = %L', v_id), array['42501']));
  v_log := v_log || pg_temp.vl('Y22d', 'service_role TRUNCATE → 42501', pg_temp.vr('service_role', 'truncate analytics.content_weekly_summary', array['42501']));
  execute 'grant insert, update, delete on analytics.content_weekly_summary to service_role';
  v_log := v_log || pg_temp.vl('Y22e', 'ชั้นสอง (grant กลับชั่วคราว): service_role INSERT → trigger 55000', pg_temp.vr('service_role',
    format('insert into analytics.content_weekly_summary (shop_id, week_start, brief_date, summary_lines, body_md, created_by_role, updated_by_role) values (%L, %L, %L, %L::text[], %L, %L, %L)', v_shopB, v_mon - 14, v_mon - 14, '{"x"}', '# x', 'ai', 'ai'), array['55000']));
  v_log := v_log || pg_temp.vl('Y22f', 'ชั้นสอง: service_role UPDATE → trigger 55000', pg_temp.vr('service_role', format('update analytics.content_weekly_summary set body_md = %L where id = %L', 'แก้ตรง', v_id), array['55000']));
  v_log := v_log || pg_temp.vl('Y22g', 'ชั้นสอง: service_role DELETE → trigger 55000', pg_temp.vr('service_role', format('delete from analytics.content_weekly_summary where id = %L', v_id), array['55000']));
  execute 'revoke insert, update, delete on analytics.content_weekly_summary from service_role';
  select string_agg(a.privilege_type, ',') into v_bad
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.oid = 'analytics.content_weekly_summary'::regclass and a.grantee = 'service_role'::regrole and a.privilege_type <> 'SELECT';
  v_log := v_log || pg_temp.vb('Y22h', 'หลังทดสอบ สิทธิ์ service_role บน content_weekly_summary กลับเป็น SELECT อย่างเดียว', v_bad is null, coalesce(v_bad, '-'));
  v_log := v_log || pg_temp.vl('Y22i', 'ต้องไม่พัง: postgres (เจ้าของตาราง) INSERT ตรงผ่าน (verify/cleanup/MCP)', pg_temp.vok(
    format('insert into analytics.content_weekly_summary (shop_id, week_start, brief_date, summary_lines, body_md, created_by_role, updated_by_role) values (%L, %L, %L, %L::text[], %L, %L, %L)', v_shopB, v_mon - 14, v_mon - 14, '{"x"}', '# x', 'ai', 'ai')));
  v_log := v_log || pg_temp.vl('Y22j', 'service_role SELECT content_weekly_summary ได้ (อ่านผ่านฝั่ง server)', pg_temp.vro('service_role', format('select 1 from analytics.content_weekly_summary where shop_id = %L limit 1', v_shopB)));

  ----------------------------------------------------------------------------
  -- Y17: recommendation_create ต้องถูกปฏิเสธ (ฐานที่ถูก: title "ข้อเสนอทดสอบ" detail "รายละเอียดทดสอบ" actor ai)
  ----------------------------------------------------------------------------
  v_snapR := pg_temp.rsnap(v_shopB);
  v_log := v_log || pg_temp.vl('Y17a1', 'kind = risk_gate (ไม่ใช่แถว reco — C3-2)', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai', 'risk_gate'), array['22023']));
  v_log := v_log || pg_temp.vl('Y17a2', 'kind = bogus', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai', 'bogus'), array['22023']));
  v_log := v_log || pg_temp.vl('Y17a3', 'kind = null (null not in … ได้ null ไม่ใช่ true — trap ข้ามด่านเงียบ)', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai', null), array['22023']));
  v_log := v_log || pg_temp.vl('Y17a4', 'source = cron', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai', 'proposal', 'cron'), array['22023']));
  v_log := v_log || pg_temp.vl('Y17a5', 'source = null', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai', 'proposal', null), array['22023']));
  v_i := 0;
  foreach v_k in array array['', '   ', chr(8203) || chr(8203), repeat('ก', 201), '[ต้องยืนยัน: ราคา] ข้อเสนอ'] loop
    v_i := v_i + 1;
    v_log := v_log || pg_temp.vl('Y17b' || chr(96 + v_i), 'title ผิด ' || left(replace(v_k, chr(8203), '<ZWSP>'), 30), pg_temp.vx(pg_temp.q_rcreate(v_shopB, v_k, 'รายละเอียดทดสอบ', 'ai'), array['22023']));
  end loop;
  v_i := 0;
  foreach v_k in array array['', '   ', chr(8203) || chr(8203), repeat('ก', 4001), 'รายละเอียด' || chr(8238) || 'หลอก', 'รายละเอียด' || chr(8203) || 'ซ่อน'] loop
    v_i := v_i + 1;
    v_log := v_log || pg_temp.vl('Y17c' || chr(96 + v_i), 'detail ผิด (ว่าง/ยาว/bidi/ZWSP) #' || v_i, pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', v_k, 'ai'), array['22023']));
  end loop;
  v_log := v_log || pg_temp.vl('Y17d1', 'actor assistant', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'assistant'), array['22023']));
  v_log := v_log || pg_temp.vl('Y17d2', 'actor null', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', null), array['22023']));
  v_log := v_log || pg_temp.vl('Y17d3', 'shop null', pg_temp.vx(format('select analytics.recommendation_create(null::uuid,%L,%L,%L)', 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai'), array['22023']));
  v_log := v_log || pg_temp.vl('Y17d4', 'title null', pg_temp.vx(format('select analytics.recommendation_create(%L::uuid,null,%L,%L)', v_shopB, 'รายละเอียดทดสอบ', 'ai'), array['22023']));
  v_log := v_log || pg_temp.vl('Y17d5', 'detail null', pg_temp.vx(format('select analytics.recommendation_create(%L::uuid,%L,null,%L)', v_shopB, 'ข้อเสนอทดสอบ', 'ai'), array['22023']));
  v_log := v_log || pg_temp.vl('Y17e1', 'effort 0', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai', 'proposal', 'agent', 0), array['22023']));
  v_log := v_log || pg_temp.vl('Y17e2', 'effort 481', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai', 'proposal', 'agent', 481), array['22023']));
  v_i := 0;
  foreach v_k in array array[(v_today - 1)::text, (v_today + 91)::text, 'infinity', '-infinity'] loop
    v_i := v_i + 1;
    v_log := v_log || pg_temp.vl('Y17f' || chr(96 + v_i), 'respond_by ผิด ' || v_k, pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai', 'proposal', 'agent', null, v_k, 'ถือว่าปฏิเสธ'), array['22023']));
  end loop;
  v_log := v_log || pg_temp.vl('Y17g1', 'respond_by มีแต่ default_action null', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai', 'proposal', 'agent', null, (v_today + 3)::text, null), array['22023'], 'ค่าเริ่มต้น'));
  v_log := v_log || pg_temp.vl('Y17g2', 'respond_by มีแต่ default_action ว่าง/ช่องว่าง', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai', 'proposal', 'agent', null, (v_today + 3)::text, '   '), array['22023']));
  v_log := v_log || pg_temp.vl('Y17g3', 'respond_by มีแต่ default_action เป็น ZWSP ล้วน', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai', 'proposal', 'agent', null, (v_today + 3)::text, chr(8203)), array['22023']));
  v_log := v_log || pg_temp.vl('Y17g4', 'default_action มีแต่ respond_by null', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai', 'proposal', 'agent', null, null, 'ถือว่าปฏิเสธ'), array['22023'], 'เส้นตาย'));
  v_log := v_log || pg_temp.vl('Y17g5', 'default_action ยาว 501', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai', 'proposal', 'agent', null, (v_today + 3)::text, repeat('ก', 501)), array['22023']));
  select s.id into v_step from analytics.campaign_step s where s.shop_id = v_shop and s.piece_status is null limit 1;
  if v_step is null then
    v_log := v_log || E'[SKIP] Y17h1 ไม่มี step เก่า (piece_status ว่าง) ในร้านจริง — ทดสอบด่าน "ผูกได้เฉพาะชิ้นใน workflow ใหม่" ด้วยข้อมูลจริงไม่ได้\n';
  else
    v_log := v_log || pg_temp.vl('Y17h1', 'related_step_id ของ step เก่าจริง (piece_status ว่าง) → 22023', pg_temp.vx(pg_temp.q_rcreate(v_shop, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai', 'proposal', 'agent', null, null, null, null, v_step), array['22023'], 'workflow ใหม่'));
  end if;
  select s.id into v_step2 from analytics.campaign_step s where s.campaign_id = v_cE limit 1;
  v_log := v_log || pg_temp.vl('Y17h2', 'related_step_id ของร้านอื่น (ชิ้นของร้าน C ส่งกับร้าน B)', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai', 'proposal', 'agent', null, null, null, null, v_step2), array['22023']));
  v_log := v_log || pg_temp.vl('Y17h3', 'related_campaign_id ของร้านอื่น', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai', 'proposal', 'agent', null, null, null, v_cE), array['22023']));
  v_log := v_log || pg_temp.vl('Y17h4', 'summary_id ของร้านอื่น (สรุปของร้าน C)', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai', 'proposal', 'agent', null, null, null, null, null, v_id3), array['22023']));
  v_log := v_log || pg_temp.vl('Y17h5', 'related_campaign_id / step / summary สุ่ม (ไม่มีจริง)', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai', 'proposal', 'agent', null, null, null, gen_random_uuid()), array['22023']));
  select s.id into v_step from analytics.campaign_step s where s.campaign_id = v_cD and s.piece_status = 'posted' limit 1;
  v_log := v_log || pg_temp.vl('Y17h6', 'step ของแคมเปญ cD แต่ส่ง related_campaign_id = cB → ไม่ตรงกัน', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai', 'proposal', 'agent', null, null, null, v_cB, v_step), array['22023']));
  -- SEC-M3 (ข้อ T): detail ปฏิเสธอักขระล่องหน/ควบคุมทุกตัวในชุด — ชุดเดิม (กลุ่มที่ mutant ลบทิ้ง: 200E 200F 061C 2060-2064) + ชุดใหม่ ·
  --   tab/LF/CR/ZWJ/ZWNJ ต้องไม่ถูกปฏิเสธ (Y17k)
  foreach v_i in array array[8203, 8206, 8207, 1564, 8288, 8289, 8290, 8291, 8292, 8294, 8297, 8234, 8238, 65279, 917504, 917505, 917576, 917631, 173, 6158, 8232, 8233, 65529, 65530, 65531, 12644, 4447, 1, 2, 8, 11, 12, 14, 27, 31, 127] loop
    v_log := v_log || pg_temp.vl('Y17i-' || v_i, 'detail มีอักขระ U+' || upper(to_hex(v_i)) || ' → 22023', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียด' || chr(v_i) || 'ทดสอบ', 'ai'), array['22023'], 'ล่องหน'));
  end loop;
  -- ข้อความสั้น (title/default_action) ผ่าน content_text_clean ก่อน แล้วตรวจซ้ำด้วย content_bidi_present_ — อักขระชุดใหม่ที่ clean ไม่ลบต้องถูกปฏิเสธ
  v_log := v_log || pg_temp.vl('Y17j1', 'title มี Unicode Tag (U+E0041) — content_text_clean ไม่ลบ → 22023', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'หัวข้อ' || chr(917569) || 'ซ่อน', 'รายละเอียดทดสอบ', 'ai'), array['22023'], 'ล่องหน'));
  v_log := v_log || pg_temp.vl('Y17j2', 'title มี soft hyphen (U+00AD) → 22023', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'หัวข้อ' || chr(173) || 'ซ่อน', 'รายละเอียดทดสอบ', 'ai'), array['22023'], 'ล่องหน'));
  v_log := v_log || pg_temp.vl('Y17j3', 'default_action มี Unicode Tag → 22023', pg_temp.vx(pg_temp.q_rcreate(v_shopB, 'ข้อเสนอทดสอบ', 'รายละเอียดทดสอบ', 'ai', 'proposal', 'agent', null, (v_today + 3)::text, 'ถือว่า' || chr(917569) || 'ปฏิเสธ'), array['22023'], 'ล่องหน'));
  v_log := v_log || pg_temp.vb('Y17z', 'reject ทั้งชุดแล้วไม่มีแถว reco ถูกเขียนในร้าน B', pg_temp.rsnap(v_shopB) = v_snapR);
  v_log := v_log || pg_temp.vl('Y17k1', 'ต้องไม่พัง: detail มี ZWJ/ZWNJ/tab/LF/CR/ภาษาไทย/emoji ผ่าน (ร้าน C — ไม่ปนร้าน B)', pg_temp.vok(pg_temp.q_rcreate(v_shopC, 'Verify Allow Chars', 'ก' || chr(8205) || 'ข' || chr(8204) || 'ค' || E'\tแท็บ\nบรรทัดใหม่\r\nCRLF ' || chr(128105) || chr(8205) || chr(128187), 'ai')));
  v_log := v_log || pg_temp.vb('Y17k2', 'detail ที่ผ่านเก็บ ZWJ/ZWNJ/tab/LF ครบ · CR ถูกตัดทิ้ง (CRLF → LF)', (select position(chr(8205) in detail) > 0 and position(chr(8204) in detail) > 0 and position(E'\t' in detail) > 0 and position(E'\n' in detail) > 0 and position(E'\r' in detail) = 0
                                                                                  from analytics.recommendation_log where shop_id = v_shopC and title = 'Verify Allow Chars'));

  ----------------------------------------------------------------------------
  -- recommendation_create ต้องไม่พัง + กันซ้ำ (Y18) + inbox + FK SET NULL (N13)
  ----------------------------------------------------------------------------
  v_j := pg_temp.vj(pg_temp.q_rcreate(v_shopB, '  Verify Reco  Alpha ', E'บรรทัด 1\nบรรทัด 2 [ต้องยืนยัน: ราคา]', 'ai', 'proposal', 'weekly_brief', 30, (v_today + 7)::text, '  ถือว่าปฏิเสธ   ไม่ทำ ', v_cD, v_step, v_id));
  select * into r from analytics.recommendation_log where shop_id = v_shopB and lower(title) = 'verify reco alpha';
  v_log := v_log || pg_temp.vb('R1', 'สร้างข้อเสนอเต็มชุด: title/default_action ถูก clean · detail เก็บ newline + อนุญาต marker · created_by_role ai · kind/source/effort/respond_by/related_* ลงตาราง · pending · ยังไม่มี acted_*',
    r.id is not null and r.title = 'Verify Reco Alpha' and r.default_action = 'ถือว่าปฏิเสธ ไม่ทำ' and position(E'\n' in r.detail) > 0 and r.detail like '%[ต้องยืนยัน%' and r.created_by_role = 'ai' and r.kind = 'proposal'
    and r.source = 'weekly_brief' and r.effort_minutes_est = 30 and r.respond_by = v_today + 7 and r.related_campaign_id = v_cD and r.related_step_id = v_step and r.summary_id = v_id
    and r.owner_action = 'pending' and r.acted_at is null and r.acted_by_role is null, coalesce(v_j::text, 'null'));
  v_id2 := r.id;
  select * into r from analytics.v_recommendation_inbox where item_id = v_id2 and item_kind = 'reco';
  v_log := v_log || pg_temp.vb('R2', 'inbox แขน reco: pending · days_left 7 · is_late false · respond_via recommendation_respond · default_action แสดง · kind proposal · shop ตรง',
    r.effective_action = 'pending' and r.days_left = 7 and not r.is_late and r.respond_via = 'recommendation_respond' and r.default_action = 'ถือว่าปฏิเสธ ไม่ทำ' and r.kind = 'proposal' and r.shop_id = v_shopB,
    concat_ws('|', r.effective_action, r.days_left, r.is_late));
  v_snapR := pg_temp.rsnap(v_shopB);
  -- QA-5 (ข้อ W): ชื่อซ้ำที่ยัง pending ไม่ error แล้ว — คืน id เดิม created=false · เนื้อหาต่างจากเดิม = conflict=true (ไม่ทับเงียบ) · เนื้อหาเดิมเป๊ะ = conflict=false
  v_j := pg_temp.vj(pg_temp.q_rcreate(v_shopB, 'verify reco alpha', 'รายละเอียดอื่น', 'ai'));
  v_log := v_log || pg_temp.vb('Y18a', 'title ซ้ำแถว pending (ต่างตัวพิมพ์) เนื้อหาต่าง → คืน id เดิม · created=false · conflict=true (ไม่ error 23505 · ไม่ทับ)', (v_j ->> 'id') = v_id2::text and (v_j ->> 'created') = 'false' and (v_j ->> 'conflict') = 'true', left(v_j::text, 200));
  v_j := pg_temp.vj(pg_temp.q_rcreate(v_shopB, '  VERIFY   RECO ALPHA  ', 'รายละเอียดอื่นอีกแบบ', 'owner'));
  v_log := v_log || pg_temp.vb('Y18b', 'title ซ้ำแบบช่องว่างซ้อน/ท้าย (clean แล้วตรง) + actor owner → id เดิม · created=false · conflict=true', (v_j ->> 'id') = v_id2::text and (v_j ->> 'created') = 'false' and (v_j ->> 'conflict') = 'true', left(v_j::text, 200));
  v_j := pg_temp.vj(pg_temp.q_rcreate(v_shopB, '  Verify Reco  Alpha ', E'บรรทัด 1\nบรรทัด 2 [ต้องยืนยัน: ราคา]', 'ai', 'proposal', 'weekly_brief', 30, (v_today + 7)::text, '  ถือว่าปฏิเสธ   ไม่ทำ ', v_cD, v_step, v_id));
  v_log := v_log || pg_temp.vb('Y18b2', 'Brief รันซ้ำ (พารามิเตอร์เดิมเป๊ะ) → id เดิม · created=false · conflict=false (ไม่ใช่ความขัดแย้ง)', (v_j ->> 'id') = v_id2::text and (v_j ->> 'created') = 'false' and (v_j ->> 'conflict') = 'false', left(v_j::text, 200));
  select count(*) into v_n from analytics.recommendation_log where shop_id = v_shopB and lower(btrim(title)) = 'verify reco alpha';
  select detail into v_s1 from analytics.recommendation_log where id = v_id2;
  v_log := v_log || pg_temp.vb('Y18b3', 'หลังเรียกซ้ำ 3 รอบ: ยังมีแถวเดียว · detail เดิมไม่ถูกทับ (ไม่ทับเงียบ)', v_n = 1 and v_s1 like E'บรรทัด 1%', v_n || '/' || left(v_s1, 20));
  v_log := v_log || pg_temp.vl('Y18c', 'ชั้นตาราง: postgres INSERT ตรง title ซ้ำ pending → 23505 (unique index — กันสองคำสั่งแข่งกัน/MCP insert ซ้ำ)',
    pg_temp.vx(format('insert into analytics.recommendation_log (shop_id, source, title, detail) values (%L, %L, %L, %L)', v_shopB, 'adhoc', 'VERIFY RECO ALPHA', 'ซ้ำ'), array['23505']));
  v_log := v_log || pg_temp.vb('Y18z', 'reject แล้วไม่มีแถวเพิ่ม (snapshot ร้าน B เท่าเดิม)', pg_temp.rsnap(v_shopB) = v_snapR);
  v_log := v_log || pg_temp.vl('Y18d', 'ต้องไม่พัง: ร้านอื่นใช้ชื่อเดียวกันได้ (unique ต่อร้าน)', pg_temp.vok(pg_temp.q_rcreate(v_shopC, 'Verify Reco Alpha', 'ร้าน C ชื่อเดียวกัน', 'ai')));
  v_log := v_log || pg_temp.vl('Y18e', 'ต้องไม่พัง: ชื่อต่างกันเล็กน้อย (ต่อท้ายเลข) สร้างได้', pg_temp.vok(pg_temp.q_rcreate(v_shopB, 'Verify Reco Alpha 2', 'ชื่อต่างกัน', 'ai')));

  -- Y19: recommendation_respond ต้องถูกปฏิเสธ
  v_snapR := pg_temp.rsnap(v_shopB);
  v_log := v_log || pg_temp.vl('Y19a1', 'respond actor ai → 42501', pg_temp.vx(pg_temp.q_rresp(v_shopB, v_id2, 'done', null, 'ai'), array['42501']));
  v_log := v_log || pg_temp.vl('Y19a2', 'respond actor system → 42501', pg_temp.vx(pg_temp.q_rresp(v_shopB, v_id2, 'done', null, 'system'), array['42501']));
  v_log := v_log || pg_temp.vl('Y19a3', 'respond actor assistant → 22023', pg_temp.vx(pg_temp.q_rresp(v_shopB, v_id2, 'done', null, 'assistant'), array['22023']));
  v_i := 0;
  foreach v_k in array array['expired', 'pending', 'maybe', 'DONE'] loop
    v_i := v_i + 1;
    v_log := v_log || pg_temp.vl('Y19b' || chr(96 + v_i), 'action ผิด ' || v_k, pg_temp.vx(pg_temp.q_rresp(v_shopB, v_id2, v_k, 'เหตุผลทดสอบ', 'owner'), array['22023']));
  end loop;
  v_log := v_log || pg_temp.vl('Y19b5', 'action null', pg_temp.vx(pg_temp.q_rresp(v_shopB, v_id2, null, 'เหตุผลทดสอบ', 'owner'), array['22023']));
  v_i := 0;
  foreach v_k in array array['', '   ', 'ok', chr(8203) || chr(8203) || chr(8203)] loop
    v_i := v_i + 1;
    v_log := v_log || pg_temp.vl('Y19c' || chr(96 + v_i), 'rejected ไม่มีเหตุผลที่ใช้ได้ (ว่าง/ช่องว่าง/2 ตัว/ZWSP) #' || v_i, pg_temp.vx(pg_temp.q_rresp(v_shopB, v_id2, 'rejected', v_k, 'owner'), array['22023']));
  end loop;
  v_log := v_log || pg_temp.vl('Y19c5', 'rejected เหตุผล null', pg_temp.vx(pg_temp.q_rresp(v_shopB, v_id2, 'rejected', null, 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('Y19d1', 'คำตอบมี [ต้องยืนยัน → 22023', pg_temp.vx(pg_temp.q_rresp(v_shopB, v_id2, 'done', '[ต้องยืนยัน: ตัวเลข] ทำแล้ว', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('Y19d2', 'คำตอบยาว 1001 → 22023', pg_temp.vx(pg_temp.q_rresp(v_shopB, v_id2, 'done', repeat('ก', 1001), 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('Y19d3', 'คำตอบมี Unicode Tag (content_text_clean ไม่ลบ) → 22023 "ล่องหน"', pg_temp.vx(pg_temp.q_rresp(v_shopB, v_id2, 'done', 'ตอบ' || chr(917569) || 'ซ่อน', 'owner'), array['22023'], 'ล่องหน'));
  v_log := v_log || pg_temp.vl('Y19e1', 'id สุ่ม → 22023', pg_temp.vx(pg_temp.q_rresp(v_shopB, gen_random_uuid(), 'done', null, 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('Y19e2', 'id ของร้านอื่น (ข้อเสนอของร้าน C ส่งกับร้าน B) → 22023', pg_temp.vx(pg_temp.q_rresp(v_shopB, (select id from analytics.recommendation_log where shop_id = v_shopC limit 1), 'done', null, 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('Y19e3', 'shop null', pg_temp.vx(format('select analytics.recommendation_respond(null::uuid,%L::uuid,%L,null,%L)', v_id2, 'done', 'owner'), array['22023']));
  select r2.id into v_id3 from analytics.recommendation_log r2 where r2.shop_id = v_shop and r2.owner_action in ('done', 'rejected') limit 1;
  if v_id3 is null then
    v_log := v_log || E'[SKIP] Y19f ไม่มีข้อเสนอจริงที่ตอบแล้ว (done/rejected) ในร้านจริง — ทดสอบ "ตอบซ้ำ" บนข้อมูลจริงไม่ได้\n';
  else
    v_log := v_log || pg_temp.vl('Y19f', 'ข้อเสนอจริงที่ตอบแล้ว (done/rejected) ตอบซ้ำ → 55000 (compare-and-set ในตัว) · ไม่ทับคำตอบเจ้าของ', pg_temp.vx(pg_temp.q_rresp(v_shop, v_id3, 'done', 'ทับ', 'owner'), array['55000'], 'ตอบแล้ว'));
  end if;
  v_log := v_log || pg_temp.vb('Y19z', 'reject ทั้งชุดแล้ว ร้าน B ไม่ถูกเขียนอะไร', pg_temp.rsnap(v_shopB) = v_snapR);

  -- ต้องไม่พัง: done ไม่ต้องมีคำตอบ · payload · inbox · ตอบซ้ำถูกปฏิเสธ
  v_j := pg_temp.vj(pg_temp.q_rresp(v_shopB, v_id2, 'done', null, 'owner'));
  select * into r from analytics.recommendation_log where id = v_id2;
  v_log := v_log || pg_temp.vb('R3', 'owner ตอบ done (ไม่ใส่ข้อความ): owner_action done · acted_at · acted_by_role owner · outcome_note null · payload late false · was_expired false · default_action_was คืนค่าเริ่มต้น',
    r.owner_action = 'done' and r.acted_at is not null and r.acted_by_role = 'owner' and r.outcome_note is null and r.owner_response is null and (v_j ->> 'late') = 'false' and (v_j ->> 'was_expired') = 'false'
    and (v_j ->> 'default_action_was') = 'ถือว่าปฏิเสธ ไม่ทำ', left(v_j::text, 220));
  select * into r from analytics.v_recommendation_inbox where item_id = v_id2 and item_kind = 'reco';
  v_log := v_log || pg_temp.vb('R4', 'inbox หลังตอบ: effective_action done · is_late false · acted_at มี', r.effective_action = 'done' and not r.is_late and r.acted_at is not null);
  v_log := v_log || pg_temp.vl('R5', 'ตอบซ้ำแถวเดียวกัน (หลัง done) → 55000', pg_temp.vx(pg_temp.q_rresp(v_shopB, v_id2, 'rejected', 'เปลี่ยนใจ', 'owner'), array['55000']));
  v_log := v_log || pg_temp.vb('R5b', 'คำตอบแรกยังอยู่ (ไม่ถูกทับ)', (select owner_action from analytics.recommendation_log where id = v_id2) = 'done');
  v_log := v_log || pg_temp.vl('R6', 'หลังตอบแล้ว ชื่อเดิมสร้างใหม่ได้ (ไม่ใช่ pending)', pg_temp.vok(pg_temp.q_rcreate(v_shopB, 'Verify Reco Alpha', 'ข้อเสนอรอบใหม่ชื่อเดิม', 'ai')));

  -- N12: เส้นตายหมด → expired (แสดงค่าเริ่มต้น) · ตอบช้า → is_late · acceptance นับถูก
  v_j := pg_temp.vj(pg_temp.q_rcreate(v_shopB, 'Verify Reco Beta', 'ข้อเสนอที่จะหมดเวลา', 'ai', 'question', 'agent', null, (v_today + 1)::text, 'ใช้ค่าตั้งต้นเดิม'));
  select id into v_id3 from analytics.recommendation_log where shop_id = v_shopB and title = 'Verify Reco Beta';
  update analytics.recommendation_log set respond_by = v_today - 1 where id = v_id3;
  select * into r from analytics.v_recommendation_inbox where item_id = v_id3;
  v_log := v_log || pg_temp.vb('N12a', 'respond_by = เมื่อวาน (postgres ตั้ง) → inbox effective expired · days_left −1 · default_action ยังแสดง · owner_action ในตารางยัง pending (ไม่ mutate)',
    r.effective_action = 'expired' and r.days_left = -1 and r.default_action = 'ใช้ค่าตั้งต้นเดิม' and r.kind = 'question' and r.owner_action = 'pending', concat_ws('|', r.effective_action, r.days_left));
  v_j := pg_temp.vj(pg_temp.q_rresp(v_shopB, v_id3, 'rejected', 'เหตุผลปฏิเสธหลังหมดเวลา', 'owner'));
  select * into r from analytics.v_recommendation_inbox where item_id = v_id3;
  v_log := v_log || pg_temp.vb('N12b', 'ตอบ rejected หลังหมดเวลา ผ่าน (คำตอบจริงชนะค่าเริ่มต้น): payload late true · was_expired true · inbox effective rejected · is_late true',
    (v_j ->> 'late') = 'true' and (v_j ->> 'was_expired') = 'true' and r.effective_action = 'rejected' and r.is_late, left(v_j::text, 200));
  v_log := v_log || pg_temp.vb('N12b2', 'คำตอบของเจ้าของลง owner_response (ไม่ใช่ outcome_note) · acted_by_role owner · inbox แสดง owner_response', (select owner_response = 'เหตุผลปฏิเสธหลังหมดเวลา' and outcome_note is null and acted_by_role = 'owner' from analytics.recommendation_log where id = v_id3)
    and r.owner_response = 'เหตุผลปฏิเสธหลังหมดเวลา' and r.outcome_note is null);
  select coalesce(sum(done_count), 0), coalesce(sum(rejected_count), 0) into v_n, v_n2 from analytics.v_recommendation_acceptance where shop_id = v_shopB;
  -- เทียบกับการนับอิสระจากตารางดิบ (ไม่ผูกจำนวนตายตัว — ร้าน B ตอบหลายแถวจาก M1r / R3 / N12b)
  v_log := v_log || pg_temp.vb('N12c', 'v_recommendation_acceptance (0101) ของร้าน B นับ done / rejected ตรงกับแถวที่ตอบจริงในตาราง (นับอิสระ) · ต้องมีอย่างน้อย done 1 + rejected 1 (view เดิมยังคำนวณถูกกับแถวใหม่)',
    v_n = (select count(*) from analytics.recommendation_log where shop_id = v_shopB and owner_action = 'done') and v_n2 = (select count(*) from analytics.recommendation_log where shop_id = v_shopB and owner_action = 'rejected')
    and v_n >= 1 and v_n2 >= 1, v_n || '/' || v_n2);
  -- กติกา 14 วันของ 0101 ยังใช้กับแถวไม่มีเส้นตาย
  perform pg_temp.vj(pg_temp.q_rcreate(v_shopB, 'Verify Reco Gamma', 'ไม่มีเส้นตาย', 'ai'));
  select id into v_id3 from analytics.recommendation_log where shop_id = v_shopB and title = 'Verify Reco Gamma';
  select effective_action into v_s1 from analytics.v_recommendation_inbox where item_id = v_id3;
  update analytics.recommendation_log set created_at = now() - interval '15 days' where id = v_id3;
  select * into r from analytics.v_recommendation_inbox where item_id = v_id3;
  v_log := v_log || pg_temp.vb('N12d', 'ไม่มี respond_by: สด = pending · เกิน 14 วัน = expired (กติกา 0101 คงไว้) · days_left null · default_action null', v_s1 = 'pending' and r.effective_action = 'expired' and r.days_left is null and r.default_action is null, v_s1 || '/' || r.effective_action);
  v_j := pg_temp.vj(pg_temp.q_rresp(v_shopB, v_id3, 'done', null, 'owner'));
  v_log := v_log || pg_temp.vb('N12e', 'แถวที่ view ว่า expired (14 วัน) แต่ยัง pending ในตาราง ตอบได้ · was_expired true · late false', (v_j ->> 'was_expired') = 'true' and (v_j ->> 'late') = 'false', left(v_j::text, 200));

  -- Y20: เขียนตรงโดย service_role — ชั้นแรก GRANT (42501) · ชั้นสอง trigger (55000) · postgres ยังเขียนตรงได้ (N16 — weekly brief task เดิม/MCP) แต่แก้เนื้อหาแถวที่ตอบแล้วไม่ได้
  select id into v_id3 from analytics.recommendation_log where shop_id = v_shopB and title = 'Verify Reco Alpha 2';
  v_snapR := pg_temp.rsnap(v_shopB);
  v_log := v_log || pg_temp.vl('Y20a', 'service_role INSERT recommendation_log → 42501', pg_temp.vr('service_role', format('insert into analytics.recommendation_log (shop_id, source, title, detail) values (%L, %L, %L, %L)', v_shopB, 'agent', 'ตรง', 'ตรง'), array['42501']));
  v_log := v_log || pg_temp.vl('Y20b', 'service_role UPDATE owner_action = done → 42501', pg_temp.vr('service_role', format('update analytics.recommendation_log set owner_action = %L, acted_at = now() where id = %L', 'done', v_id3), array['42501']));
  v_log := v_log || pg_temp.vl('Y20c', 'service_role DELETE → 42501', pg_temp.vr('service_role', format('delete from analytics.recommendation_log where id = %L', v_id3), array['42501']));
  v_log := v_log || pg_temp.vl('Y20d', 'service_role TRUNCATE → 42501', pg_temp.vr('service_role', 'truncate analytics.recommendation_log', array['42501']));
  execute 'grant insert, update, delete on analytics.recommendation_log to service_role';
  v_log := v_log || pg_temp.vl('Y20e', 'ชั้นสอง (grant กลับชั่วคราว): service_role INSERT → trigger 55000', pg_temp.vr('service_role', format('insert into analytics.recommendation_log (shop_id, source, title, detail) values (%L, %L, %L, %L)', v_shopB, 'agent', 'ตรง', 'ตรง'), array['55000']));
  v_log := v_log || pg_temp.vl('Y20f', 'ชั้นสอง: service_role UPDATE owner_action → trigger 55000', pg_temp.vr('service_role', format('update analytics.recommendation_log set owner_action = %L, acted_at = now() where id = %L', 'done', v_id3), array['55000']));
  v_log := v_log || pg_temp.vl('Y20g', 'ชั้นสอง: service_role UPDATE title (เปลี่ยนเนื้อหา) → trigger 55000', pg_temp.vr('service_role', format('update analytics.recommendation_log set title = %L where id = %L', 'แก้ตรง', v_id3), array['55000']));
  v_log := v_log || pg_temp.vl('Y20h', 'ชั้นสอง: service_role DELETE → trigger 55000', pg_temp.vr('service_role', format('delete from analytics.recommendation_log where id = %L', v_id3), array['55000']));
  v_log := v_log || pg_temp.vl('Y20i', 'ชั้นสอง ต้องไม่พัง: service_role UPDATE ที่ไม่เปลี่ยนค่าอะไร (title = title) ผ่าน — guard เทียบค่า', pg_temp.vro('service_role', format('update analytics.recommendation_log set title = title where id = %L', v_id3)));
  execute 'revoke insert, update, delete on analytics.recommendation_log from service_role';
  select string_agg(a.privilege_type, ',') into v_bad
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.oid = 'analytics.recommendation_log'::regclass and a.grantee = 'service_role'::regrole and a.privilege_type <> 'SELECT';
  v_log := v_log || pg_temp.vb('Y20j', 'หลังทดสอบ service_role ไม่มีสิทธิ์เขียน/ลบ recommendation_log อีก', v_bad is null, coalesce(v_bad, '-'));
  v_log := v_log || pg_temp.vb('Y20z', 'reject ทั้งชุดแล้ว ร้าน B ไม่ถูกเขียนอะไร', pg_temp.rsnap(v_shopB) = v_snapR);
  v_log := v_log || pg_temp.vl('N16a', 'ต้องไม่พัง (weekly brief task เดิม/MCP): postgres INSERT ตรงลง recommendation_log ผ่าน',
    pg_temp.vok(format('insert into analytics.recommendation_log (shop_id, source, title, detail) values (%L, %L, %L, %L)', v_shopB, 'weekly_brief', 'Verify MCP Insert', 'แทรกตรงโดย postgres')));
  select id into v_id3 from analytics.recommendation_log where shop_id = v_shopB and title = 'Verify MCP Insert';
  v_log := v_log || pg_temp.vl('N16b', 'postgres ปิดข้อเสนอเก่าตรง (owner_action → done + acted_at) ผ่าน (Tech Lead ยกระดับ R7 → R10 แบบเดิม)', pg_temp.vok(format('update analytics.recommendation_log set owner_action = %L, acted_at = now(), outcome_note = %L where id = %L', 'rejected', 'ยกระดับเป็นข้อเสนอใหม่', v_id3)));
  v_log := v_log || pg_temp.vl('Y20k', 'postgres แก้ title ของแถวที่ตอบแล้ว → 55000 (เขียนประวัติ "เจ้าของตอบอะไร" ย้อนหลังไม่ได้ — ทุก role)', pg_temp.vx(format('update analytics.recommendation_log set title = %L where id = %L', 'แก้ย้อนหลัง', v_id3), array['55000']));
  v_log := v_log || pg_temp.vl('Y20l', 'postgres แก้ detail ของแถวที่ตอบแล้ว → 55000', pg_temp.vx(format('update analytics.recommendation_log set detail = %L where id = %L', 'แก้ย้อนหลัง', v_id3), array['55000']));
  v_log := v_log || pg_temp.vl('N16c', 'ต้องไม่พัง: postgres แก้ outcome_note/acted_by_role ของแถวที่ตอบแล้ว ผ่าน (ไม่ใช่เนื้อหาข้อเสนอ)', pg_temp.vok(format('update analytics.recommendation_log set outcome_note = %L where id = %L', 'แก้หมายเหตุผล', v_id3)));
  v_log := v_log || pg_temp.vl('N16d', 'ต้องไม่พัง: postgres แก้ title ของแถวที่ยัง pending ผ่าน (แก้คำผิด)', pg_temp.vok(format('update analytics.recommendation_log set title = %L where id = %L', 'Verify Reco Alpha 2 แก้คำผิด', (select id from analytics.recommendation_log where shop_id = v_shopB and title = 'Verify Reco Alpha 2'))));
  -- legacy: แถวที่ปิดตรงก่อน 0162 (acted_by_role ว่าง) ยังแก้ owner_response ได้ (ไม่ใช่คำตอบที่ RPC เขียน) · CHECK ความยาว 1-1000
  v_log := v_log || pg_temp.vl('A5u', 'owner_response = "" → CHECK (ว่างต้องเป็น null)', pg_temp.vx(format('update analytics.recommendation_log set owner_response = %L where id = %L', '', v_id3), array['23514']));
  v_log := v_log || pg_temp.vl('A5v', 'owner_response ยาว 1001 → CHECK', pg_temp.vx(format('update analytics.recommendation_log set owner_response = repeat(%L, 1001) where id = %L', 'ก', v_id3), array['23514']));
  v_log := v_log || pg_temp.vl('H2n', 'ต้องไม่พัง: แถวที่ปิดตรงก่อน 0162 (acted_by_role ว่าง) postgres ตั้ง owner_response ได้', pg_temp.vok(format('update analytics.recommendation_log set owner_response = %L where id = %L', 'บันทึกย้อนหลังโดยทีม', v_id3)));

  ----------------------------------------------------------------------------
  -- SEC-H2 (ข้อ R): คำตอบที่เจ้าของส่งผ่าน recommendation_respond แก้ย้อนหลังไม่ได้ ทุก role รวม postgres — owner_action / owner_response / acted_at / acted_by / acted_by_role
  --   outcome_note (ผลที่ทีมจดทีหลัง) แก้ได้ · เนื้อหาข้อเสนอ source/kind/shop_id ก็แก้ไม่ได้ (mutant 1: ลบสามตัวนี้ออกจาก tuple ใน guard)
  ----------------------------------------------------------------------------
  v_j := pg_temp.vj(pg_temp.q_rcreate(v_shopB, 'Verify Owner Answer', 'ข้อเสนอที่เจ้าของจะตอบ', 'ai'));
  v_rO := (v_j ->> 'id')::uuid;
  perform pg_temp.vj(pg_temp.q_rresp(v_shopB, v_rO, 'rejected', 'เจ้าของไม่เห็นด้วย เพราะราคา', 'owner'));
  select * into r from analytics.recommendation_log where id = v_rO;
  v_log := v_log || pg_temp.vb('H2a', 'เจ้าของตอบ rejected ผ่าน RPC: owner_response = ข้อความตอบ · outcome_note ว่าง · acted_by_role owner', r.owner_action = 'rejected' and r.owner_response = 'เจ้าของไม่เห็นด้วย เพราะราคา' and r.outcome_note is null and r.acted_by_role = 'owner' and r.acted_at is not null);
  v_snapR := pg_temp.rsnap(v_shopB);
  v_log := v_log || pg_temp.vl('H2b', 'postgres แก้ owner_action rejected → done (acted_at คงเดิม) → 55000', pg_temp.vx(format('update analytics.recommendation_log set owner_action = %L where id = %L', 'done', v_rO), array['55000'], 'ย้อนหลังไม่ได้'));
  v_log := v_log || pg_temp.vl('H2c', 'postgres แก้ owner_response เป็นข้อความอื่น → 55000', pg_temp.vx(format('update analytics.recommendation_log set owner_response = %L where id = %L', 'แก้คำตอบเจ้าของย้อนหลัง', v_rO), array['55000'], 'ย้อนหลังไม่ได้'));
  v_log := v_log || pg_temp.vl('H2d', 'postgres ล้าง owner_response เป็น null → 55000', pg_temp.vx(format('update analytics.recommendation_log set owner_response = null where id = %L', v_rO), array['55000']));
  v_log := v_log || pg_temp.vl('H2e', 'postgres แก้ acted_at (+1 นาที) → 55000', pg_temp.vx(format('update analytics.recommendation_log set acted_at = acted_at + interval %L where id = %L', '1 minute', v_rO), array['55000']));
  v_log := v_log || pg_temp.vl('H2f', 'postgres ล้าง acted_by_role (ปลดล็อกตัวเอง) → 55000', pg_temp.vx(format('update analytics.recommendation_log set acted_by_role = null where id = %L', v_rO), array['55000']));
  select u.id into v_id3 from auth.users u limit 1;
  if v_id3 is null then
    v_log := v_log || E'[SKIP] H2g ไม่มี auth.users ในฐานข้อมูล — ทดสอบแก้ acted_by (FK ไป auth.users) ไม่ได้\n';
  else
    v_log := v_log || pg_temp.vl('H2g', 'postgres ตั้ง acted_by (เดิม null) เป็นผู้ใช้จริง → 55000', pg_temp.vx(format('update analytics.recommendation_log set acted_by = %L where id = %L', v_id3, v_rO), array['55000']));
  end if;
  v_log := v_log || pg_temp.vl('H2h', 'postgres แก้ source ของแถวที่ตอบแล้ว → 55000 (mutant: ลบ source ออกจาก tuple)', pg_temp.vx(format('update analytics.recommendation_log set source = %L where id = %L', 'adhoc', v_rO), array['55000']));
  v_log := v_log || pg_temp.vl('H2i', 'postgres แก้ kind ของแถวที่ตอบแล้ว → 55000 (mutant: ลบ kind ออกจาก tuple)', pg_temp.vx(format('update analytics.recommendation_log set kind = %L where id = %L', 'question', v_rO), array['55000']));
  v_log := v_log || pg_temp.vl('H2j', 'postgres ย้ายแถวที่ตอบแล้วไปร้านอื่น (shop_id) → 55000 (mutant: ลบ shop_id ออกจาก tuple)', pg_temp.vx(format('update analytics.recommendation_log set shop_id = %L where id = %L', v_shopC, v_rO), array['55000']));
  v_log := v_log || pg_temp.vl('H2k', 'postgres แก้ title ของแถวที่ตอบแล้ว → 55000', pg_temp.vx(format('update analytics.recommendation_log set title = %L where id = %L', 'แก้ชื่อย้อนหลัง', v_rO), array['55000']));
  v_log := v_log || pg_temp.vb('H2z', 'แถวที่ตอบแล้วไม่ขยับหลังพยายามแก้ทุกแบบ (snapshot ร้าน B เท่าเดิม)', pg_temp.rsnap(v_shopB) = v_snapR);
  v_log := v_log || pg_temp.vl('H2l', 'ต้องไม่พัง: postgres จด outcome_note (ผลที่ทีมจดทีหลัง) บนแถวที่เจ้าของตอบแล้ว ผ่าน', pg_temp.vok(format('update analytics.recommendation_log set outcome_note = %L where id = %L', 'ผลหลังตอบ: ลูกค้าสั่งซื้อ 3 ชิ้น', v_rO)));
  v_log := v_log || pg_temp.vl('H2m', 'ต้องไม่พัง: update ที่ไม่เปลี่ยนค่าล็อก (owner_action = owner_action) บนแถวที่ตอบแล้ว ผ่าน — guard เทียบค่า', pg_temp.vok(format('update analytics.recommendation_log set owner_action = owner_action, owner_response = owner_response where id = %L', v_rO)));
  select owner_response, outcome_note into v_s1, v_s2 from analytics.v_recommendation_inbox where item_id = v_rO and item_kind = 'reco';
  v_log := v_log || pg_temp.vb('H2o', 'inbox แยกสองช่อง: owner_response = คำตอบเจ้าของ · outcome_note = ผลที่ทีมจด', v_s1 = 'เจ้าของไม่เห็นด้วย เพราะราคา' and v_s2 = 'ผลหลังตอบ: ลูกค้าสั่งซื้อ 3 ชิ้น', coalesce(v_s1, 'null') || ' / ' || coalesce(v_s2, 'null'));
  execute 'grant insert, update, delete on analytics.recommendation_log to service_role';
  v_log := v_log || pg_temp.vl('H2p', 'ชั้นสอง (grant กลับชั่วคราว): service_role แก้ owner_response ของแถวที่เจ้าของตอบ → 55000', pg_temp.vr('service_role', format('update analytics.recommendation_log set owner_response = %L where id = %L', 'service role แก้', v_rO), array['55000']));
  execute 'revoke insert, update, delete on analytics.recommendation_log from service_role';
  -- ข้อจำกัดที่รู้ (บันทึกเป็น NOTE ไม่ใช่ pass/fail): postgres (MCP ของ Tech Lead) ตั้ง acted_by_role = owner เองบนแถว pending ได้ = ปลอมว่าเจ้าของตอบ — guard แยก RPC กับ postgres ไม่ได้ (D18 ไม่มี GUC · ปิดเมื่อ A2)
  v_j := pg_temp.vj(pg_temp.q_rcreate(v_shopB, 'Verify Forge Note', 'ข้อเสนอสำหรับบันทึกข้อจำกัด', 'ai'));
  v_log := v_log || E'[NOTE] H2q postgres ปลอมคำตอบเจ้าของบนแถว pending (acted_by_role = owner ตั้งตรง) → ' ||
    pg_temp.vok(format('update analytics.recommendation_log set owner_action = %L, acted_at = now(), acted_by_role = %L, owner_response = %L where id = %L', 'done', 'owner', 'ปลอม', (v_j ->> 'id')::uuid)) ||
    E' — ผ่าน (ข้อจำกัดที่ยอมรับ: ผู้ถือสิทธิ์ postgres เชื่อได้ตาม D18 · ไม่ใช่ช่องของ service_role/แอป)\n';
  v_log := v_log || pg_temp.vl('Y20m', 'service_role SELECT recommendation_log ได้ (อ่านฝั่ง server)', pg_temp.vro('service_role', format('select 1 from analytics.recommendation_log where shop_id = %L limit 1', v_shopB)));

  -- FK SET NULL: ลบ step/summary/campaign (postgres) → แถว reco คงอยู่ คำตอบไม่หาย · RI รันด้วยสิทธิ์เจ้าของตาราง ผ่าน guard
  v_cK := pg_temp.mk_camp(v_shopB, null);
  select s.id into v_step2 from analytics.campaign_step s where s.campaign_id = v_cK limit 1;
  perform pg_temp.vj(pg_temp.q_rcreate(v_shopB, 'Verify Reco FK', 'ผูก campaign + step + summary', 'ai', 'proposal', 'agent', null, null, null, v_cK, v_step2, v_id));
  select id into v_id3 from analytics.recommendation_log where shop_id = v_shopB and title = 'Verify Reco FK';
  perform analytics.recommendation_respond(v_shopB, v_id3, 'done', 'ตอบก่อนลบแม่', 'owner', analytics.recommendation_token_(v_id3));
  delete from analytics.content_weekly_summary where id = v_id;
  select * into r from analytics.recommendation_log where id = v_id3;
  v_log := v_log || pg_temp.vb('N13a', 'ลบ weekly summary (postgres) → reco.summary_id = null · แถว reco + คำตอบ (done/owner_response) อยู่ครบ (ON DELETE SET NULL ผ่าน guard)', r.id is not null and r.summary_id is null and r.owner_action = 'done' and r.owner_response = 'ตอบก่อนลบแม่');
  delete from analytics.campaign_step where id = v_step2;
  select * into r from analytics.recommendation_log where id = v_id3;
  v_log := v_log || pg_temp.vb('N13b', 'ลบ step → reco.related_step_id = null · แถวยังอยู่', r.id is not null and r.related_step_id is null and r.related_campaign_id = v_cK and r.owner_action = 'done');
  delete from analytics.campaign where id = v_cK;
  select * into r from analytics.recommendation_log where id = v_id3;
  v_log := v_log || pg_temp.vb('N13c', 'ลบ campaign → reco.related_campaign_id = null · แถวยังอยู่ ไม่ cascade ลบประวัติ', r.id is not null and r.related_campaign_id is null and r.owner_action = 'done');
  v_log := v_log || pg_temp.vb('N13d', 'ลบ summary แล้ว สัปดาห์ของร้าน B ที่เหลือไม่ถูกแตะ (สัปดาห์ก่อนหน้ายังอยู่)', (select count(*) from analytics.content_weekly_summary where shop_id = v_shopB and week_start = v_mon - 7) = 1);

  -- N11c: ด่านความเสี่ยง (risk_owner) ของชิ้นที่ยังร่าง/รอรีวิว → แขน risk_gate ของ inbox · เจ้าของผ่านแล้วหาย · จำนวนตรง owner_questions (0160)
  v_cK := pg_temp.mk_camp(v_shopB, v_today + 6);
  v_step := pg_temp.mk_piece_in(v_shopB, v_cK, v_today + 6);
  select count(*) into v_n from analytics.v_recommendation_inbox where shop_id = v_shopB and item_kind = 'risk_gate';
  perform analytics.content_gate_record(v_shopB, v_step, 'risk_owner', 'pending', 'ai', jsonb_build_object('question', 'ควรใช้คำว่ารับซื้อคืนหรือไม่'));
  select * into r from analytics.v_recommendation_inbox where shop_id = v_shopB and item_kind = 'risk_gate';
  select owner_questions into v_n2 from analytics.v_content_inbox_counts where shop_id = v_shopB;
  v_log := v_log || pg_temp.vb('N11c', 'ai ตั้งด่าน risk_owner pending บนชิ้นรอรีวิว → inbox มี 1 แถว risk_gate: kind question · detail = คำถาม · respond_via content_gate_record · ไม่มีค่าเริ่มต้น/เส้นตาย · item_id = step · ตรง owner_questions (0160)',
    v_n = 0 and r.item_id = v_step and r.kind = 'question' and r.detail = 'ควรใช้คำว่ารับซื้อคืนหรือไม่' and r.respond_via = 'content_gate_record' and r.default_action is null and r.respond_by is null
    and r.related_step_id = v_step and r.related_campaign_id = v_cK and r.effective_action = 'pending' and v_n2 = 1 and r.title like 'ด่านความเสี่ยง: %', coalesce(r.detail, 'null'));
  perform analytics.content_gate_record(v_shopB, v_step, 'risk_owner', 'passed', 'owner');
  select count(*) into v_n from analytics.v_recommendation_inbox where shop_id = v_shopB and item_kind = 'risk_gate';
  select owner_questions into v_n2 from analytics.v_content_inbox_counts where shop_id = v_shopB;
  v_log := v_log || pg_temp.vb('N11d', 'เจ้าของผ่านด่านแล้ว → หายจาก inbox · owner_questions = 0 (นับตรงกัน)', v_n = 0 and v_n2 = 0, v_n || '/' || v_n2);
  -- ด่านเปิดค้างบนชิ้นที่โพสต์ไปแล้ว (ข้อมูลเก่า/แก้ตรง) ไม่ใช่คำถามที่รอเจ้าของ — เงื่อนไขเดียวกับ owner_questions: เฉพาะชิ้น drafting/in_review
  select s.id into v_step2 from analytics.campaign_step s where s.campaign_id = v_cD and s.piece_status = 'posted' limit 1;
  update analytics.step_gate set status = 'pending', note = 'ค้างหลังโพสต์' where step_id = v_step2 and gate_kind = 'risk_owner';
  get diagnostics v_n = row_count;
  select count(*) into v_n2 from analytics.v_recommendation_inbox where shop_id = v_shopB and item_kind = 'risk_gate' and item_id = v_step2;
  select owner_questions into v_i from analytics.v_content_inbox_counts where shop_id = v_shopB;
  v_log := v_log || pg_temp.vb('N11f', 'ด่าน risk_owner pending บนชิ้นที่ posted แล้ว (fixture: postgres ตั้งตรง) ไม่โผล่ใน inbox · owner_questions = 0 เท่ากัน (ไม่นับชิ้นที่พ้นขั้นแล้ว)',
    v_n = 1 and v_n2 = 0 and v_i = 0, concat_ws('|', v_n, v_n2, v_i));
  -- ตัวนับกอง 4 = count(*) where effective_action = pending ของ view เดียว (ไม่แยกสองแหล่ง)
  select count(*) into v_n from analytics.v_recommendation_inbox where shop_id = v_shopB and effective_action = 'pending';
  select (select count(*) from analytics.recommendation_log where shop_id = v_shopB and owner_action = 'pending'
            and not (respond_by is not null and respond_by < v_today) and not (respond_by is null and now() - created_at > interval '14 days'))
       + (select count(*) from analytics.campaign where shop_id = v_shopB and result_verdict_proposed is not null and result_verdict_confirmed_at is null) into v_n2;
  v_log := v_log || pg_temp.vb('N11e', 'ตัวนับกอง 4 (pending ใน inbox) = reco pending ที่ไม่หมดเวลา + แคมเปญรอยืนยัน (คำนวณซ้ำอิสระ)', v_n = v_n2, v_n || '/' || v_n2);

  ----------------------------------------------------------------------------
  -- O: metric ออเดอร์ระดับแคมเปญ (ร้าน X) — นับจาก v_content_order_daily ตามช่วงวัน · ช่องทาง · กลุ่มสินค้า
  --    วัน D = วันไทย − 2: line_oa A bar · B jewelry · C ตะกร้าผสม · D neutral · E ไม่มี line item · tiktok F jewelry×3 line · วัน D+1: line_oa G bar
  --    คาด (D · line_oa): all 5 · bar 2 (A,C) · jewelry 2 (B,C) · (D · tiktok all) 1 · ทุกช่องทาง all 6 · line bar D..D+1 = 3
  ----------------------------------------------------------------------------
  select product_id into v_prod_bar from analytics.v_product_affinity where affinity_group = 'bar' limit 1;
  select product_id into v_prod_jw from analytics.v_product_affinity where affinity_group = 'jewelry' limit 1;
  select product_id into v_prod_nt from analytics.v_product_affinity where affinity_group = 'neutral' limit 1;
  select id into v_ch_line from analytics.dim_channel where code = 'line_oa';
  select id into v_ch_tt from analytics.dim_channel where code = 'tiktok';
  if v_prod_bar is null or v_prod_jw is null or v_prod_nt is null or v_ch_line is null or v_ch_tt is null then
    v_log := v_log || E'[SKIP] O1-O14 ไม่มีสินค้า bar/jewelry/neutral หรือช่องทาง line_oa/tiktok ใน DB — สร้าง fixture ออเดอร์ไม่ได้\n';
  else
    v_day := v_today - 2;
    perform pg_temp.mkord(v_shopX, v_ch_line, v_day, array[v_prod_bar]);
    perform pg_temp.mkord(v_shopX, v_ch_line, v_day, array[v_prod_jw]);
    perform pg_temp.mkord(v_shopX, v_ch_line, v_day, array[v_prod_bar, v_prod_jw]);
    perform pg_temp.mkord(v_shopX, v_ch_line, v_day, array[v_prod_nt]);
    perform pg_temp.mkord(v_shopX, v_ch_line, v_day, '{}'::uuid[]);
    perform pg_temp.mkord(v_shopX, v_ch_tt, v_day, array[v_prod_jw, v_prod_jw, v_prod_jw]);
    perform pg_temp.mkord(v_shopX, v_ch_line, v_day + 1, array[v_prod_bar]);
    v_cG := pg_temp.mk_camp(v_shopX, v_day);
    v_j := pg_temp.vj(pg_temp.q_plan(v_shopX, v_cG, '{"metric_code":"orders","metric_channel_code":"line_oa","metric_affinity":"bar"}', 'owner'));
    select * into r from analytics.v_campaign_summary where campaign_id = v_cG;
    v_log := v_log || pg_temp.vb('O1', 'ไม่ตั้งช่วงวัน → ใช้ช่วงของ step (anchor D · offset 0) · line_oa + bar ในวัน D = 2 (A, C — ตะกร้าผสมนับ 1 ออเดอร์ · ไม่นับ neutral/ไม่มี line item/tiktok/วัน D+1) · orders_channel/affinity ตามที่ตั้ง',
      v_j ? 'changed' and r.orders_window_from = v_day and r.orders_window_to = v_day and r.orders_actual = 2 and r.orders_channel = 'line_oa' and r.orders_affinity = 'bar',
      concat_ws('|', r.orders_window_from, r.orders_window_to, r.orders_actual, left(v_j::text, 100)));
    v_log := v_log || pg_temp.vb('O2', 'orders_data_through = วันล่าสุดที่มีออเดอร์ line_oa ของร้าน (D+1) · covers_window true · threshold ยังไม่ตั้ง → orders_threshold_met null (ไม่เดา)',
      r.orders_data_through = v_day + 1 and r.orders_data_covers_window is true and r.orders_threshold_met is null, coalesce(r.orders_data_through::text, 'null'));
    perform pg_temp.vj(pg_temp.q_plan(v_shopX, v_cG, '{"metric_affinity":null}', 'owner'));
    select orders_actual into v_n from analytics.v_campaign_summary where campaign_id = v_cG;
    v_log := v_log || pg_temp.vb('O3', 'affinity null = all: line_oa วัน D = 5 (A,B,C,D,E)', v_n = 5, 'ได้ ' || v_n);
    perform pg_temp.vj(pg_temp.q_plan(v_shopX, v_cG, '{"metric_affinity":"jewelry"}', 'owner'));
    select orders_actual into v_n from analytics.v_campaign_summary where campaign_id = v_cG;
    v_log := v_log || pg_temp.vb('O4', 'affinity jewelry: line_oa วัน D = 2 (B, C — ตะกร้าผสมนับทั้ง bar และ jewelry)', v_n = 2, 'ได้ ' || v_n);
    perform pg_temp.vj(pg_temp.q_plan(v_shopX, v_cG, '{"metric_channel_code":null,"metric_affinity":"all"}', 'owner'));
    select orders_actual into v_n from analytics.v_campaign_summary where campaign_id = v_cG;
    v_log := v_log || pg_temp.vb('O5', 'ทุกช่องทาง + all: วัน D = 6 (line 5 + tiktok 1 — นับต่อออเดอร์ ไม่ใช่ต่อ line item)', v_n = 6, 'ได้ ' || v_n);
    perform pg_temp.vj(pg_temp.q_plan(v_shopX, v_cG, '{"metric_channel_code":"tiktok"}', 'owner'));
    select orders_actual into v_n from analytics.v_campaign_summary where campaign_id = v_cG;
    v_log := v_log || pg_temp.vb('O6', 'ช่องทาง tiktok + all: วัน D = 1', v_n = 1, 'ได้ ' || v_n);
    perform pg_temp.vj(pg_temp.q_plan(v_shopX, v_cG, format('{"metric_channel_code":"line_oa","metric_affinity":"bar","metric_date_from":"%s","metric_date_to":"%s"}', v_day, v_day + 1), 'owner'));
    select * into r from analytics.v_campaign_summary where campaign_id = v_cG;
    v_log := v_log || pg_temp.vb('O7', 'ตั้งช่วงวันชัดแจ้ง D..D+1: line_oa bar = 3 (A, C, G) · window ตามที่ตั้ง (ไม่ใช่ช่วงของ step)', r.orders_actual = 3 and r.orders_window_from = v_day and r.orders_window_to = v_day + 1, concat_ws('|', r.orders_actual, r.orders_window_from));
    perform pg_temp.vj(pg_temp.q_plan(v_shopX, v_cG, format('{"metric_date_from":"%s","metric_date_to":"%s"}', v_day + 1, v_day + 1), 'owner'));
    select orders_actual into v_n from analytics.v_campaign_summary where campaign_id = v_cG;
    v_log := v_log || pg_temp.vb('O8', 'ช่วงวัน D+1..D+1: line_oa bar = 1 (เฉพาะ G — ขอบวันไม่ล้ำเข้า/ออก)', v_n = 1, 'ได้ ' || v_n);
    perform pg_temp.vj(pg_temp.q_plan(v_shopX, v_cG, format('{"metric_date_from":"%s","metric_date_to":"%s"}', v_day - 5, v_day - 3), 'owner'));
    select * into r from analytics.v_campaign_summary where campaign_id = v_cG;
    v_log := v_log || pg_temp.vb('O9', 'ช่วงวันที่ไม่มีออเดอร์เลย: orders_actual = 0 (ศูนย์ที่รู้ ไม่ใช่ null) · covers_window true (ข้อมูลถึง D+1 เกินช่วงนั้นแล้ว)', r.orders_actual = 0 and r.orders_data_covers_window is true, coalesce(r.orders_actual::text, 'null'));
    perform pg_temp.vj(pg_temp.q_plan(v_shopX, v_cG, format('{"metric_date_from":"%s","metric_date_to":"%s"}', v_day, v_day + 5), 'owner'));
    select * into r from analytics.v_campaign_summary where campaign_id = v_cG;
    v_log := v_log || pg_temp.vb('O10', 'ช่วงวันที่ยาวเกินข้อมูล (D..D+5 · ข้อมูลถึง D+1): orders_data_covers_window false — หน้าจอเตือนว่ายอดอาจยังไม่ครบ (ไม่บล็อก)', r.orders_data_covers_window is false and r.orders_actual = 3, concat_ws('|', r.orders_data_covers_window, r.orders_actual));
    -- เกณฑ์: >= / <= (ต้องตั้งเป็นคู่) · คำใบ้เท่านั้น ไม่ใช่คำตัดสิน
    perform pg_temp.vj(pg_temp.q_plan(v_shopX, v_cG, format('{"metric_date_from":"%s","metric_date_to":"%s","pass_threshold":3,"pass_op":">="}', v_day, v_day + 1), 'owner'));
    select orders_threshold_met into v_b from analytics.v_campaign_summary where campaign_id = v_cG;
    v_log := v_log || pg_temp.vb('O11a', 'actual 3 >= 3 → orders_threshold_met true', v_b is true);
    perform pg_temp.vj(pg_temp.q_plan(v_shopX, v_cG, '{"pass_threshold":4}', 'owner'));
    select orders_threshold_met into v_b from analytics.v_campaign_summary where campaign_id = v_cG;
    v_log := v_log || pg_temp.vb('O11b', 'actual 3 >= 4 → false (ไม่ใช่ null)', v_b is false);
    perform pg_temp.vj(pg_temp.q_plan(v_shopX, v_cG, '{"pass_threshold":2,"pass_op":"<="}', 'owner'));
    select orders_threshold_met into v_b from analytics.v_campaign_summary where campaign_id = v_cG;
    v_log := v_log || pg_temp.vb('O11c', 'actual 3 <= 2 → false', v_b is false);
    perform pg_temp.vj(pg_temp.q_plan(v_shopX, v_cG, '{"pass_threshold":3}', 'owner'));
    select orders_threshold_met into v_b from analytics.v_campaign_summary where campaign_id = v_cG;
    v_log := v_log || pg_temp.vb('O11d', 'actual 3 <= 3 → true', v_b is true);
    -- ร้านอื่นไม่เห็นออเดอร์ของร้าน X · ไม่มีข้อมูลเลย = 0 / data_through null / covers false
    v_cB := pg_temp.mk_camp(v_shopB, v_day);
    perform pg_temp.vj(pg_temp.q_plan(v_shopB, v_cB, format('{"metric_code":"orders","metric_date_from":"%s","metric_date_to":"%s"}', v_day, v_day), 'owner'));
    select * into r from analytics.v_campaign_summary where campaign_id = v_cB;
    v_log := v_log || pg_temp.vb('O12', 'แคมเปญ orders ของร้าน B ช่วงเดียวกับออเดอร์ร้าน X: actual 0 (ไม่นับข้ามร้าน) · data_through null · covers_window false', r.orders_actual = 0 and r.orders_data_through is null and r.orders_data_covers_window is false,
      concat_ws('|', r.orders_actual, r.orders_data_through, r.orders_data_covers_window));
    -- ไม่รู้ช่วงวัน (ไม่มี anchor/step/dates): ไม่เดา
    v_cG2 := pg_temp.mk_camp(v_shopX, null);
    perform pg_temp.vj(pg_temp.q_plan(v_shopX, v_cG2, '{"metric_code":"orders","pass_threshold":1,"pass_op":">="}', 'owner'));
    select * into r from analytics.v_campaign_summary where campaign_id = v_cG2;
    v_log := v_log || pg_temp.vb('O13', 'ไม่รู้ช่วงวัน (ไม่มี anchor/dates): orders_window_* / orders_actual / threshold_met = null (ไม่เดาจากวันนี้)', r.orders_window_from is null and r.orders_actual is null and r.orders_threshold_met is null);
    -- ไม่ใช่ metric orders: orders_* ทั้งหมดต้องเป็น null (ไม่ใช่ 0)
    select count(*) into v_n from analytics.v_campaign_summary s
     where s.shop_id in (v_shop, v_shopB, v_shopX) and s.metric_code is distinct from 'orders'
       and (s.orders_actual is not null or s.orders_window_from is not null or s.orders_data_through is not null or s.orders_threshold_met is not null or s.orders_data_covers_window is not null);
    v_log := v_log || pg_temp.vb('O14', 'แคมเปญที่ metric ไม่ใช่ orders (รวมแคมเปญเก่าจริง): orders_* null ทุกคอลัมน์ (ไม่แสดง 0 หลอก)', v_n = 0, 'ผิดปกติ ' || v_n);
    -- ด่านคำตัดสินของ orders (ตัดสินใจ B)
    v_log := v_log || pg_temp.vl('O15a', 'ai เสนอ validated บน orders ที่ไม่ตั้งเกณฑ์ (cG2 — ตั้งแล้วแต่ cG ล้าง) → ตกที่ช่วงวัน: 55000 ระบุ "ช่วงวัน"', pg_temp.vx(pg_temp.q_prop(v_shopX, v_cG2, 'validated', 'หลักฐานทดสอบ', 'ai'), array['55000'], 'ช่วงวัน'));
    perform pg_temp.vj(pg_temp.q_plan(v_shopX, v_cG2, '{"pass_threshold":null,"pass_op":null}', 'owner'));
    v_log := v_log || pg_temp.vl('O15b', 'ai เสนอ validated บน orders ที่ยังไม่ตั้งเกณฑ์ → 55000 ระบุ "เกณฑ์"', pg_temp.vx(pg_temp.q_prop(v_shopX, v_cG2, 'validated', 'หลักฐานทดสอบ', 'ai'), array['55000'], 'เกณฑ์'));
    v_log := v_log || pg_temp.vl('O15c', 'owner ยืนยัน validated บน orders ที่ยังไม่ตั้งเกณฑ์ → 55000 (ด่านเดียวกัน)', pg_temp.vx(pg_temp.q_conf(v_shopX, v_cG2, 'validated', null, 'owner', null, 'none'), array['55000']));
    v_log := v_log || pg_temp.vl('O15d', 'ต้องไม่พัง: inconclusive บน orders ที่ไม่มีเกณฑ์/ช่วงวัน เสนอได้', pg_temp.vok(pg_temp.q_prop(v_shopX, v_cG2, 'inconclusive', 'ยังไม่ตั้งเกณฑ์ตัดสิน', 'ai')));
    v_log := v_log || pg_temp.vl('O15e', 'cG (เกณฑ์ครบ + ช่วงวันครบ): ai เสนอ validated ผ่าน', pg_temp.vok(pg_temp.q_prop(v_shopX, v_cG, 'validated', 'ออเดอร์ line bar ถึงเกณฑ์', 'ai')));
    v_j := pg_temp.vj(pg_temp.q_conf(v_shopX, v_cG, 'validated', 'โปรส่งฟรีแท่งเงินได้ผล', 'owner', null, 'validated'));
    v_log := v_log || pg_temp.vb('O16', 'owner ยืนยัน validated บน orders: payload มีบล็อก orders (actual 3 · window · threshold_met true · data_covers_window) · ชิ้นค้าง 0',
      v_j ? 'verdict' and (v_j -> 'orders' ->> 'actual') = '3' and (v_j -> 'orders' ->> 'threshold_met') = 'true' and (v_j -> 'orders' ->> 'window_from') = v_day::text and (v_j -> 'orders') ? 'data_covers_window',
      left(v_j::text, 300));
    select count(*) into v_n from analytics.campaign where id = v_cG and result_open_pieces is not null and status = 'done';
    v_log := v_log || pg_temp.vb('O17', 'orders cG ปิดแล้ว: status done + result_open_pieces บันทึก', v_n = 1);
    v_j := pg_temp.vj(pg_temp.q_conf(v_shopX, v_cG, 'inconclusive', null, 'owner', null, 'validated'));
    v_log := v_log || pg_temp.vb('O18', 'owner เปลี่ยนใจเป็น inconclusive บน orders ผ่าน (inconclusive ไม่ติดด่านเนื้อหา) · previous_verdict validated', v_j ? 'verdict' and (v_j ->> 'previous_verdict') = 'validated', left(v_j::text, 200));
    ----------------------------------------------------------------------------
    -- SEC-H1 (ข้อ B/P): validated/invalidated บน orders ต้องมีข้อมูลออเดอร์ "ของร้าน" ถึงวันสุดท้ายของช่วง (orders_data_covers_window = true)
    --   ร้าน X: ข้อมูลล่าสุด (ทุกช่องทาง) = D+1 · line_oa มีถึง D+1 · tiktok มีแค่ D (ช่องที่เงียบ — ต้องไม่ทำให้ถือว่าข้อมูลยังไม่ถึง)
    ----------------------------------------------------------------------------
    v_cO := pg_temp.mk_camp(v_shopX, v_day);
    perform pg_temp.vj(pg_temp.q_plan(v_shopX, v_cO, format('{"metric_code":"orders","metric_channel_code":"line_oa","metric_date_from":"%s","metric_date_to":"%s","pass_threshold":1,"pass_op":">="}', v_day, v_day + 5), 'owner'));
    select * into r from analytics.v_campaign_summary where campaign_id = v_cO;
    v_log := v_log || pg_temp.vb('H1a', 'ช่วง D..D+5 แต่ข้อมูลร้านถึง D+1: covers_window false · data_through = D+1', r.orders_data_covers_window is false and r.orders_data_through = v_day + 1, concat_ws('|', r.orders_data_covers_window, r.orders_data_through));
    v_log := v_log || pg_temp.vl('H1b', 'ai เสนอ validated บน orders ที่ข้อมูลยังไม่ถึงวันสุดท้าย → 55000 "ยังไม่ถึงวันสุดท้าย"', pg_temp.vx(pg_temp.q_prop(v_shopX, v_cO, 'validated', 'ยอดครบเกณฑ์แล้ว', 'ai'), array['55000'], 'ยังไม่ถึงวันสุดท้าย'));
    v_log := v_log || pg_temp.vl('H1c', 'ai เสนอ invalidated (ยอดวันท้ายที่ยังไม่เข้าอ่านเป็น 0 แล้วตีว่าแคมเปญล้มเหลว) → 55000', pg_temp.vx(pg_temp.q_prop(v_shopX, v_cO, 'invalidated', 'ยอดไม่ถึงเกณฑ์', 'ai'), array['55000'], 'ยังไม่ถึงวันสุดท้าย'));
    v_log := v_log || pg_temp.vl('H1d', 'owner เสนอ validated ก็ตกด่านเดียวกัน (ด่านเนื้อหาไม่ยกเว้นเจ้าของ)', pg_temp.vx(pg_temp.q_prop(v_shopX, v_cO, 'validated', 'เจ้าของเสนอเอง', 'owner'), array['55000'], 'ยังไม่ถึงวันสุดท้าย'));
    v_log := v_log || pg_temp.vl('H1e', 'owner ยืนยัน validated (expected none · token ปัจจุบัน) → 55000 ด่านข้อมูลยังไม่ถึง', pg_temp.vx(pg_temp.q_conf(v_shopX, v_cO, 'validated', null, 'owner', null, 'none'), array['55000'], 'ยังไม่ถึงวันสุดท้าย'));
    v_log := v_log || pg_temp.vl('H1e2', 'owner ยืนยัน invalidated → 55000 เช่นกัน', pg_temp.vx(pg_temp.q_conf(v_shopX, v_cO, 'invalidated', null, 'owner', null, 'none'), array['55000'], 'ยังไม่ถึงวันสุดท้าย'));
    v_log := v_log || pg_temp.vl('H1f', 'ต้องไม่พัง: ai เสนอ inconclusive บน orders ที่ข้อมูลยังไม่ถึง ผ่าน', pg_temp.vok(pg_temp.q_prop(v_shopX, v_cO, 'inconclusive', 'ข้อมูลออเดอร์ยังไม่ถึงวันสุดท้ายของช่วง', 'ai')));
    v_j := pg_temp.vj(pg_temp.q_conf(v_shopX, v_cO, 'inconclusive', null, 'owner', null, 'inconclusive'));
    v_log := v_log || pg_temp.vb('H1f2', 'ต้องไม่พัง: owner ยืนยัน inconclusive บน orders ที่ข้อมูลยังไม่ถึง ผ่าน (ปิดได้ทุกเมื่อ — Q12)', v_j ? 'verdict' and (v_j ->> 'verdict') = 'inconclusive', left(v_j::text, 160));
    -- ขอบ: ข้อมูลถึง D+1 · ช่วงสิ้นสุด D+2 ตก / สิ้นสุด D+1 ผ่าน
    v_cO2 := pg_temp.mk_camp(v_shopX, v_day);
    perform pg_temp.vj(pg_temp.q_plan(v_shopX, v_cO2, format('{"metric_code":"orders","metric_date_from":"%s","metric_date_to":"%s","pass_threshold":1,"pass_op":">="}', v_day + 1, v_day + 2), 'owner'));
    v_log := v_log || pg_temp.vl('H1g', 'ขอบ: ช่วงสิ้นสุด D+2 แต่ข้อมูลถึง D+1 (เกิน 1 วัน) → ai เสนอ validated 55000', pg_temp.vx(pg_temp.q_prop(v_shopX, v_cO2, 'validated', 'ทดสอบขอบ', 'ai'), array['55000'], 'ยังไม่ถึงวันสุดท้าย'));
    perform pg_temp.vj(pg_temp.q_plan(v_shopX, v_cO2, format('{"metric_date_to":"%s"}', v_day + 1), 'owner'));
    v_log := v_log || pg_temp.vl('H1h', 'ขอบ ต้องไม่พัง: ช่วงสิ้นสุด D+1 = ข้อมูลล่าสุดพอดี (>=) ai เสนอ validated ผ่าน', pg_temp.vok(pg_temp.q_prop(v_shopX, v_cO2, 'validated', 'ทดสอบขอบ', 'ai')));
    -- data_through คิดทั้งร้าน ไม่กรองช่องทาง: แคมเปญนับ tiktok ช่วง D+1 (tiktok มีแค่วัน D) · ร้านมีข้อมูลถึง D+1 จาก line_oa ⇒ covers true · ยอด 0 = ผลจริง
    v_cO3 := pg_temp.mk_camp(v_shopX, v_day);
    perform pg_temp.vj(pg_temp.q_plan(v_shopX, v_cO3, format('{"metric_code":"orders","metric_channel_code":"tiktok","metric_date_from":"%s","metric_date_to":"%s","pass_threshold":1,"pass_op":">="}', v_day + 1, v_day + 1), 'owner'));
    select * into r from analytics.v_campaign_summary where campaign_id = v_cO3;
    v_log := v_log || pg_temp.vb('H1i', 'แคมเปญนับ tiktok ช่วง D+1: orders_actual 0 · data_through = D+1 (ทั้งร้าน ไม่กรองช่องทาง) · covers_window true', r.orders_actual = 0 and r.orders_data_through = v_day + 1 and r.orders_data_covers_window is true,
      concat_ws('|', r.orders_actual, r.orders_data_through, r.orders_data_covers_window));
    v_log := v_log || pg_temp.vl('H1j', 'ต้องไม่พัง: ai เสนอ invalidated (tiktok ศูนย์ออเดอร์ในช่วงที่ข้อมูลร้านถึงแล้ว = ผลจริง) ผ่าน', pg_temp.vok(pg_temp.q_prop(v_shopX, v_cO3, 'invalidated', 'ช่อง tiktok ไม่มีออเดอร์ในช่วงที่ร้านมีข้อมูลครบ', 'ai')));
    v_j := pg_temp.vj(pg_temp.q_conf(v_shopX, v_cO3, 'invalidated', null, 'owner', null, 'invalidated'));
    v_log := v_log || pg_temp.vb('H1k', 'ต้องไม่พัง: owner ยืนยัน invalidated บน tiktok ศูนย์ออเดอร์ ผ่าน · payload actual 0 · threshold_met false · data_covers_window true', v_j ? 'verdict' and (v_j -> 'orders' ->> 'actual') = '0' and (v_j -> 'orders' ->> 'threshold_met') = 'false'
      and (v_j -> 'orders' ->> 'data_covers_window') = 'true', left(v_j::text, 260));
    -- ร้านที่ไม่มีออเดอร์เลย (ร้าน B): data_through null = ไม่ครอบ → validated ตก (ข้อความบอก "ไม่มีข้อมูลเลย")
    perform pg_temp.vj(pg_temp.q_plan(v_shopB, v_cB, '{"pass_threshold":1,"pass_op":">="}', 'owner'));
    select * into r from analytics.v_campaign_summary where campaign_id = v_cB;
    v_log := v_log || pg_temp.vb('H1l', 'fixture: cB (ร้าน B ไม่มีออเดอร์) metric orders + เกณฑ์ + ช่วงวัน: data_through null · covers false', r.metric_code = 'orders' and r.pass_threshold is not null and r.orders_data_through is null and r.orders_data_covers_window is false);
    v_log := v_log || pg_temp.vl('H1m', 'ร้านที่ไม่มีออเดอร์เลย: owner เสนอ validated → 55000 "ไม่มีข้อมูลเลย" (null ไม่ผ่านเงียบ)', pg_temp.vx(pg_temp.q_prop(v_shopB, v_cB, 'validated', 'เจ้าของเสนอ', 'owner'), array['55000'], 'ไม่มีข้อมูลเลย'));
  end if;

  ----------------------------------------------------------------------------
  -- Y23: role authenticated (แม้ได้ usage สคีมา) เรียก RPC/helper/อ่าน view/ตารางของ 0162 ไม่ได้ — 42501 (trap #18.5)
  ----------------------------------------------------------------------------
  execute 'grant usage on schema analytics to authenticated';
  v_n := 0; v_n2 := 0; v_bad := null;
  for r in
    select p.proname, p.pronargs from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype and p.proname ~ c_fn
     order by p.proname
  loop
    v_n := v_n + 1;
    begin
      execute 'set local role authenticated';
      execute format('select analytics.%I(%s)', r.proname, repeat('null,', r.pronargs - 1) || 'null');
      v_bad := coalesce(v_bad || ', ', '') || r.proname || ':ผ่าน';
    exception when others then
      if sqlstate = '42501' then v_n2 := v_n2 + 1; else v_bad := coalesce(v_bad || ', ', '') || r.proname || ':' || sqlstate; end if;
    end;
    execute 'reset role';
  end loop;
  for r in select unnest(array['v_campaign_summary', 'v_recommendation_inbox', 'content_weekly_summary', 'recommendation_log']) as vn loop
    v_n := v_n + 1;
    begin
      execute 'set local role authenticated';
      execute format('select 1 from analytics.%I limit 1', r.vn);
      v_bad := coalesce(v_bad || ', ', '') || r.vn || ':ผ่าน';
    exception when others then
      if sqlstate = '42501' then v_n2 := v_n2 + 1; else v_bad := coalesce(v_bad || ', ', '') || r.vn || ':' || sqlstate; end if;
    end;
    execute 'reset role';
  end loop;
  execute 'revoke usage on schema analytics from authenticated';
  v_log := v_log || pg_temp.vb('Y23a', 'authenticated เรียกฟังก์ชันไม่ใช่ trigger 11 ตัว (helper 5 + RPC 6) + อ่าน view 2 + ตาราง 2 → 42501 ครบ 15', v_n = 15 and v_n2 = 15 and v_bad is null, format('ทดสอบ %s · 42501 %s · ผิดปกติ: %s', v_n, v_n2, coalesce(v_bad, '-')));
  v_log := v_log || pg_temp.vb('Y23b', 'สิทธิ์ usage ของ authenticated บนสคีมากลับสู่เดิม (false) หลังทดสอบ', not has_schema_privilege('authenticated', 'analytics', 'usage'));
  v_log := v_log || pg_temp.vb('Y23c', 'anon ไม่มี usage และเรียกฟังก์ชันของ 0162 ไม่ได้', not has_schema_privilege('anon', 'analytics', 'usage')
    and not exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname ~ c_fn and has_function_privilege('anon', p.oid, 'execute')));

  ----------------------------------------------------------------------------
  -- N17/N18: ไม่มี \r ใน body · วันไทย
  ----------------------------------------------------------------------------
  select string_agg(p.proname, ', ') into v_bad from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname ~ c_fn and pg_get_functiondef(p.oid) ~ E'\r';
  v_log := v_log || pg_temp.vb('N17a', 'body ของฟังก์ชัน 0162 ไม่มี \r (LF ล้วน — ไม่เพี้ยนเพราะ CRLF ตอน replay)', v_bad is null, coalesce(v_bad, '-'));
  select string_agg(c.relname, ', ') into v_bad from pg_class c
   where c.relnamespace = 'analytics'::regnamespace and c.relname in ('v_campaign_summary', 'v_recommendation_inbox') and pg_get_viewdef(c.oid) ~* 'current_date';
  v_log := v_log || pg_temp.vb('N18a', 'view ใหม่ไม่มี current_date', v_bad is null, coalesce(v_bad, '-'));
  select string_agg(p.proname, ', ') into v_bad from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname ~ c_fn and pg_get_functiondef(p.oid) ~* 'current_date';
  v_log := v_log || pg_temp.vb('N18b', 'ฟังก์ชันใหม่ไม่มี current_date', v_bad is null, coalesce(v_bad, '-'));
  v_log := v_log || pg_temp.vb('N18c', 'Asia/Bangkok ปรากฏใน inbox + RPC ที่คิดวัน 5 ตัว',
    pg_get_viewdef('analytics.v_recommendation_inbox'::regclass) ~ 'Asia/Bangkok'
    and pg_get_functiondef('analytics.campaign_plan_set(uuid,uuid,jsonb,text)'::regprocedure) ~ 'Asia/Bangkok'
    and pg_get_functiondef('analytics.campaign_verdict_confirm(uuid,uuid,text,text,text,text,text,text)'::regprocedure) ~ 'Asia/Bangkok'
    and pg_get_functiondef('analytics.recommendation_create(uuid,text,text,text,text,text,integer,date,text,uuid,uuid,uuid)'::regprocedure) ~ 'Asia/Bangkok'
    and pg_get_functiondef('analytics.recommendation_respond(uuid,uuid,text,text,text,text)'::regprocedure) ~ 'Asia/Bangkok'
    and pg_get_functiondef('analytics.content_weekly_summary_upsert(uuid,date,date,text[],text,text,integer,text)'::regprocedure) ~ 'Asia/Bangkok');
  select string_agg(p.proname, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.proname in ('content_post_metric_upsert', 'content_post_upsert', 'content_piece_post', 'content_post_metric_amend', 'content_post_verdict_confirm')
     and pg_get_functiondef(p.oid) is null;
  v_log := v_log || pg_temp.vb('N4', 'ฟังก์ชัน 0148/0159/0161 ที่ C3 ห้ามแตะ (upsert · post · amend · verdict_confirm) ยังอยู่ครบ (ด่านท้ายไฟล์ migration เทียบ md5 ทั้ง schema)', v_bad is null
    and (select count(*) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('content_post_metric_upsert', 'content_post_upsert', 'content_piece_post', 'content_post_metric_amend', 'content_post_verdict_confirm')) = 5, coalesce(v_bad, '-'));

  ----------------------------------------------------------------------------
  -- ที่ไม่ครอบในไฟล์นี้ (บอกตรงๆ)
  ----------------------------------------------------------------------------
  v_log := v_log || E'[SKIP] N9/N15 (grep โค้ดแอป · กดหน้าเดิม) = ส่วน backend-dev grep (ทำแล้ว: ไม่มี hypothesis/result_*/recommendation_log ใน lib/ app/ components/ scripts/ packages/) + QA — ไฟล์นี้ตรวจฝั่ง DB เท่านั้น\n';
  v_log := v_log || E'[SKIP] การชนกันจริงของ 2 คำสั่งพร้อมกัน (for update ของ campaign/reco/weekly · create reco ซ้ำแข่งกัน — index เป็นตัวกันจริง) = ต้องใช้ 2 connection · do-block ทรานแซกชันเดียวจำลองไม่ได้\n';
  v_log := v_log || E'[SKIP] เวลาคร่อม 00:00-07:00 ไทยจริง (ด่านวันของ respond_by/week_start/brief_date) — ตรวจแบบ static (Asia/Bangkok + ไม่มี current_date) เท่านั้น\n';
  v_log := v_log || E'[SKIP] TRUNCATE recommendation_log / content_weekly_summary เมื่อถูก grant กลับ — กันที่ชั้น GRANT เท่านั้น (ไม่มี trigger TRUNCATE ระดับตาราง) · ทดสอบ 42501 ตอนไม่มีสิทธิ์ (Y20d/Y22d)\n';
  v_log := v_log || E'[SKIP] ผู้ถือ service key ที่ SET ROLE เป็น postgres/ฟังก์ชัน definer เองได้ = ผ่านทุกด่านตาราง (D18 — ด่านใช้ current_user อย่างเดียว ปิดเมื่อ A2)\n';
  v_log := v_log || E'[SKIP] verify-0158..0161 + qa-0161-extra + qa-0161-revoke-regression = รันแยกต่อท้าย 0161+0162 ใน dry-run เดียวกัน (ไม่ใช่ในไฟล์นี้)\n';

  exception when others then
    v_log := v_log || format(E'[FAIL] ABORT verify หยุดกลางทาง sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;
  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_ok   := (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4;
  v_log := v_log || format(E'\n=== สรุป: [OK] %s · [FAIL] %s — raise ด้านล่างบังคับ ROLLBACK ทั้งหมด ===\n', v_ok, v_fail);
  raise exception '%', v_log;
end;
$verify0162$;

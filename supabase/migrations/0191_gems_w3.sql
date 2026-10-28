-- 0191_gems_w3.sql — W3: ผู้จัดการกรอก/แก้พลอยจากมือถือ (QR ร้าน + PIN · ไม่ login) · เปิดใบพร้อมพลอย · แก้พลอยของใบที่ตัวเองเปิดจนช่างเริ่มรับงาน
-- สถานะ: ยังไม่ apply · dry-run เท่านั้น · apply ด้วย node scripts/run-sql.mjs --commit --record เท่านั้น (🔴 ห้าม supabase db push) · ชุดทดสอบ scripts/verify/verify-0191.sql · ไฟล์ต้องเป็น LF (ข้อ 20)
-- 🔴 ช่องสาธารณะที่ "เขียนข้อมูล" (QR ร้าน + PIN) → security ก่อน merge · ราคาพลอยห้ามถึงผู้จัดการ/ช่างทุกช่องทาง (RPC/ผลลัพธ์/error) — ไฟล์นี้ไม่แตะตารางราคา (gem_item_price/_audit) เลยแม้แต่คอลัมน์เดียว
-- 🔴 ลำดับ deploy: dry-run 0191 + verify-0191 (ต่อไฟล์เป็นไฟล์เดียว ไม่ใส่ --commit) → apply --commit --record → verify-0191 + verify-0187/0188/0189/0190 + `node scripts/run-sql.mjs scripts/check-analytics-grants.sql` → แล้วค่อย merge โค้ด TS
--   (merge โค้ดก่อน apply = action ใหม่เรียก RPC ที่ยังไม่มี → ฟังก์ชันพลอยฝั่งหน้างานล้ม · ไม่กระทบหน้าอื่น — แต่ job_worker_open เปลี่ยน signature: ต้อง apply ก่อนโค้ดที่ส่ง p_gem_*)
-- design: docs/3j-jewelry/oms/ux-gems.md §1 §2 §3 (W-4) §4 (W-6/7 W-9 W-10) §14.2 · design-job-plan-metal-gems.md §9 (หนี้ "W3 ต้องบังคับ ผู้เปิด + ขั้นแรกยังไม่รับ ก่อนเรียก core") · design-job-lots-shopfloor.md §7.4 (W1) §7.5 (W2)
--
-- ทำไม (ภาษาคน): ผู้จัดการเปิดใบที่หน้างานแล้วอยากบอกช่างฝังเลยว่าใช้พลอยอะไร เท่าไร ตรงไหน (และแก้ได้จนช่างเริ่มรับงาน) · มติเจ้าของ 21 ต.ค.: พิมพ์ชนิด/รูปทรงใหม่ได้เลย เข้าแคตตาล็อกตอนกดเปิดงาน · ตัวดักชื่อคล้าย = ถาม ไม่บล็อก
--   ⇒ พลอยต้องไปพร้อมใบ "ผ่านทั้งหมดหรือไม่เปิดเลย" (P11) · ทุกด่านอยู่ที่ DB: ร้านมาจาก token เท่านั้น · สิทธิ์ can_open_job ตรวจสดทุกครั้ง · แก้ได้เฉพาะใบที่ช่างคนนี้เปิดเอง ∧ ยังไม่มีขั้นใดถูกรับ ∧ ใบ open ∧ ใบมีขั้นฝัง
--
-- สิ่งที่ไฟล์นี้ทำ
--  1. helper ภายใน 8 ตัว (ไม่ grant ใคร): shop_intake_gem_auth (ด่านกลางของ RPC พลอยฝั่งช่าง · ถังต่อช่างแยกจากรูป) · job_worker_gem_block (ใบนี้แก้พลอยได้ไหม — นิยามเดียว) · job_gem_rev (ลายนิ้วมือของพลอยใบ = CAS กัน 2 เครื่อง) ·
--     job_worker_gem_precheck (ตัวดักชื่อคล้าย: force ต่อ "ชื่อที่ถูกถาม" ไม่ใช่ blanket + เพดานชื่อใหม่ต่อวัน) · job_worker_gem_name_cap (เพดาน 40 ชื่อ/ผู้จัดการ/24 ชม.) · job_worker_gem_item_cap (เพดาน 120 รายการใหม่/ผู้จัดการ/24 ชม.) · job_worker_gem_fail (error พลอย → ผลฝั่งช่าง ไม่ส่งข้อความดิบของ DB) · job_worker_gem_summary (สรุปชื่อใหม่/ชื่อที่ใช้ตัวเดิมให้ — ไม่มีราคา)
--  2. job_worker_open (drop signature เดิม 15 args + สร้างใหม่ 18 args + re-grant): + p_gem_lines jsonb · p_gem_answer text ('none' | 'has' | 'template' | null) · p_gem_force jsonb — ไม่ส่งพลอย = ทำงานเดิมเป๊ะ (verify-0187/0188/0189/0190 ผ่านเท่าเดิม)
--  3. job_worker_gem_set (แก้พลอยทั้งชุด) · job_worker_gem_get (อ่านพลอยของใบตัวเอง + rev + window) · job_worker_gem_catalog (ชนิด/รูปทรงที่ใช้ได้ + ขนาดที่เคยใช้ + แม่แบบ SKU — ไม่มีราคา)
--  4. job_worker_my_intake_list (replace · signature เดิม): + gem_state · gem_count · gem_pieces · gem_editable ต่อใบ (W-9)
--  ไม่แตะ: job_gem_bom_replace_core / gem_lines_prepare / job_create_* (เรียกใช้ตามที่เป็น) · production_order_done (💰 md5 เท่าเดิม) · ตรรกะออฟฟิศ · ตารางราคา
--
-- กติกา 'p_gem_answer' ของ job_worker_open
--   null        = ทำงานเดิม (ไม่ส่งพลอย · SKU ที่มีแม่แบบได้ขั้นฝัง+พลอยคัดลอกมาเอง — W1 เดิม) — ห้ามส่ง p_gem_lines/p_gem_force มาด้วย
--   'template'  = ตามแม่แบบ SKU "และต้องมีแม่แบบ" (ไม่มี = gem_answer_required · ux P8: SKU ไม่มีแม่แบบต้องตอบก่อน) — หน้าจอ W3 ส่งค่านี้แทน null เสมอ เพื่อให้ DB บังคับ "ต้องตอบ"
--   'none'      = ไม่มีพลอย → ไม่มีขั้นฝัง (ถอด gem_set ออกจากขั้นที่ระบบเสนอ) · ไม่คัดลอกแม่แบบ
--   'has'       = มีพลอย → ต้อง p_gem_lines 1-30 แถวครบ → ใบมีขั้นฝัง (เพิ่ม gem_set ถ้ายังไม่มี) · พลอยผิดแถวใด = ไม่เปิดทั้งก้อน (ไม่มี PO/ใบงาน/QR/ตัวนับขยับ)
--
-- ตัดสินเอง (นอก design/brief — เหตุผล)
--  (1) 'template' เป็นค่าที่ 4 ของ p_gem_answer: บรีฟสั่งทั้ง "null = ตามเดิม" และ "SKU ไม่มีแม่แบบไม่ตอบ = ห้ามผ่าน" แต่ verify-0187..0190 เปิดใบ SKU ไม่มีแม่แบบโดยไม่ส่งพลอยและต้องผ่านเท่าเดิม → null ต้องคงพฤติกรรมเดิม · ด่าน "ต้องตอบ" จึงบังคับกับ client ที่ส่ง 'template' (หน้าจอ W3) — client ที่ส่ง null ได้ใบเดิมๆ (ไม่มีขั้นฝัง) ซึ่งเป็นพฤติกรรมของวันนี้
--  (2) p_gem_force เป็น jsonb [{kind:'type'|'shape', name}] ไม่ใช่ boolean: force มีผลเฉพาะชื่อที่ DB รายงานว่าคล้ายใน "คำขอนี้" (probe ด้วย gem_lines_prepare แบบไม่ force ใน subtransaction ที่ถอยกลับเสมอ แล้วเทียบ norm) — ชื่อที่ไม่ได้ถูกถามไม่ปลดคำถามของชื่ออื่น · boolean true = ปฏิเสธ (gem_force_invalid)
--      ข้อจำกัด: DB ไม่มี state "เคยถามแล้ว" — client ที่รู้ชื่อล่วงหน้าส่ง force มาตั้งแต่ครั้งแรกก็ผ่าน (ตัวดักคล้ายคือคุณภาพข้อมูลไม่ใช่ด่านความปลอดภัย)
--  (3) job_worker_gem_set ต้องส่ง p_expected_rev (บังคับ): rev = md5 ของ (gem_item_id, จำนวน, ตำแหน่ง, ลำดับ) จาก job_worker_gem_get — 2 เครื่องของผู้จัดการคนเดียวกัน เครื่องที่ถือ rev เก่า = gem_conflict (ไม่ทับเงียบ)
--  (4) แก้ให้เหลือ 0 แถวได้ (p_lines = []) แม้ใบมีขั้นฝัง: ผลคือ gems_state = unspecified (หน้าจอเตือน amber — มติ 22 ต.ค. ไม่บล็อก) · ระบบไม่เพิ่ม/ลบขั้นฝังเองตอนแก้ภายหลัง (ux Q8 (ก)) → ใบที่ไม่มีขั้นฝัง = no_gem_stage "แจ้งออฟฟิศเพิ่มขั้น"
--  (5) job_worker_gem_catalog รับ p_product_id (ไม่บังคับ) คืนแม่แบบ SKU (ไม่มีราคา) ให้หน้าจอรู้ว่า SKU มีแม่แบบไหม (ตัดสินว่าจะถาม "ฝังพลอยไหม" หรือไม่) — เพิ่มจากบรีฟ (บรีฟระบุแค่ token+session)
--  (6) ถังจำกัดอัตราแยกจากรูป: เขียน (gem_set) wg:<ช่าง> 20/10 นาที · อ่าน (get/catalog) wgr:<ช่าง> 120/10 นาที — นับหลังพบ session ที่ valid และ can_open_job · ต่อ IP ใช้ ipw: 300 (เขียน · ถังเดียวกับเปิดใบ/รูป) · ipr: 240 (อ่าน) · ค่าเพดานทีมตั้ง ไม่ใช่ค่าเจ้าของ
--  (7) ไม่รับ p_user_agent ใน job_worker_gem_set (บรีฟระบุไว้): job_gem_bom_replace_core เขียน event bom_change โดยไม่มี device hint และบรีฟสั่งไม่ replace core → พารามิเตอร์นี้จะไม่มีที่ใช้ (ตายเปล่า) · event ยังบันทึกผู้ทำ = ช่าง (worker_id · channel worker_qr · actor null)
--  (8) race "ช่างรับขั้นแรกระหว่างแก้": ล็อกแถวใบ (for update) แล้วค่อยตรวจหน้าต่าง (เหมือนรูป W2) — รับที่ commit ก่อน = เห็นและปฏิเสธ · รับที่ยัง in-flight = เรียงต่อท้ายแก้ (ผลเท่ากับ "แก้ก่อนรับ") · ไม่ล็อกแถว job_stage (ลำดับล็อกกลับกับ job_core_receive → เสี่ยง deadlock) · ไม่มีเทสต์ 2 connection (do-block เป็น connection เดียว)
--  (9) เพดานชื่อพลอยใหม่ 40 ชื่อ (ชนิด+รูปทรง) ต่อผู้จัดการต่อ 24 ชม. (gem_name_cap · นับเฉพาะชื่อที่เกิดใหม่จริงจาก created_by_worker_id — ใช้ตัวเดิม/ออฟฟิศสร้าง ไม่นับ): บรีฟไม่ได้สั่งแต่ช่องสาธารณะนี้ "สร้างชื่อเข้าแคตตาล็อกเองได้" (มติ 21 ต.ค.) — ไม่มีเพดาน = ผู้ถือ PIN ผู้จัดการ (หรือคนเดา PIN 1234 ที่เจ้าของรับความเสี่ยง) ท่วมแคตตาล็อกด้วยชื่อขยะได้ 30 ชื่อต่อใบ · ux §3.6/Q3 ระบุ "[เพดานให้ architect]" ไว้แล้ว · ค่า 40 ทีมตั้ง ปรับที่ job_worker_gem_name_cap() ที่เดียว
--  (10) เพดานรายการพลอยใหม่ 120 รายการ (ชนิด x รูปทรง x ขนาด) ต่อผู้จัดการต่อ 24 ชม. (hint เดียวกับเพดานชื่อ gem_name_cap · นับ gem_item.created_by_worker_id) — security M1: เพดานชื่ออย่างเดียวไม่กัน "ขนาดสุ่ม 30 แถว x แก้ซ้ำ" ที่สร้างรายการได้ไม่จำกัดโดยไม่สร้างชื่อใหม่
--  (11) precheck รับ p_allow_item_ids (รายการที่ใบถืออยู่แล้ว) — security M2: ใบที่คัดลอกแม่แบบแล้วออฟฟิศปิดใช้รายการ ผู้จัดการต้องบันทึกแถวเดิมต่อได้ (เหมือน core) · id ปิดใช้ที่ "ไม่อยู่ในใบ" ยังตก gem_inactive
--  (12) ชื่อฟังก์ชัน job_worker_gem_precheck (เดิม _force) — ทำหน้าที่ probe ทั้งชื่อคล้าย/force/เพดาน ไม่ใช่แค่ force
--
-- ไม่มีเงิน/ต้นทุนในไฟล์นี้ · ไม่ UPDATE แถวเดิมใดๆ (ไม่ยิง trigger ของตารางใด — ข้อ 19) · post-check ล็อก: ฟังก์ชันเดิมนอกรายการ md5 เท่าเดิม (รวม production_order_done · job_gem_bom_replace_core · gem_lines_prepare) · แถวตารางเท่าเดิม · ไม่มี overload · ไม่มีสิทธิ์ anon/authenticated/PUBLIC

-- baseline: ฟังก์ชันทุกตัวในสคีมา (md5) + ตัวชี้วัดแถว
create temp table _m191_fn_base on commit drop as
select p.oid::regprocedure::text as sig, p.proname, md5(pg_get_functiondef(p.oid)) as h
from pg_proc p
where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f';

create temp table _m191_row_base on commit drop as
select 'job'::text as t, count(*) as n, coalesce(md5(string_agg(j::text, '|' order by j.id)), '') as h from analytics.job j
union all select 'job_stage', count(*), coalesce(md5(string_agg(s::text, '|' order by s.id)), '') from analytics.job_stage s
union all select 'job_event', count(*), coalesce(md5(string_agg(e::text, '|' order by e.id)), '') from analytics.job_event e
union all select 'job_token', count(*), coalesce(md5(string_agg(k.id::text || coalesce(k.revoked_at::text, ''), '|' order by k.id)), '') from analytics.job_token k
union all select 'job_counter', count(*), coalesce(md5(string_agg(c::text, '|' order by c::text)), '') from analytics.job_counter c
union all select 'production_order', count(*), coalesce(md5(string_agg(po::text, '|' order by po.id)), '') from analytics.production_order po
union all select 'production_order_item', count(*), coalesce(md5(string_agg(pi::text, '|' order by pi.id)), '') from analytics.production_order_item pi
union all select 'worker', count(*), coalesce(md5(string_agg(w::text, '|' order by w.id)), '') from analytics.worker w
union all select 'worker_session', count(*), coalesce(md5(string_agg(s::text, '|' order by s.id)), '') from analytics.worker_session s
union all select 'shop_intake_token', count(*), coalesce(md5(string_agg(t::text, '|' order by t.id)), '') from analytics.shop_intake_token t
union all select 'gem_type', count(*), coalesce(md5(string_agg(t::text, '|' order by t.id)), '') from analytics.gem_type t
union all select 'gem_shape', count(*), coalesce(md5(string_agg(s::text, '|' order by s.id)), '') from analytics.gem_shape s
union all select 'gem_item', count(*), coalesce(md5(string_agg(i::text, '|' order by i.id)), '') from analytics.gem_item i
union all select 'job_gem_bom', count(*), coalesce(md5(string_agg(b::text, '|' order by b.id)), '') from analytics.job_gem_bom b
union all select 'product_gem_bom', count(*), coalesce(md5(string_agg(b::text, '|' order by b.id)), '') from analytics.product_gem_bom b;

-- ============================================================================
-- 0. pre-check
-- ============================================================================
do $p$
declare
  v_n int;
  v_def text;
  r record;
begin
  perform 1 from pg_temp._m191_fn_base limit 1;  -- รันแบบ autocommit ตารางหาย ⇒ ล้มก่อน DDL ใดๆ
  if to_regclass('analytics.job_gem_bom') is null or to_regclass('analytics.gem_item') is null or to_regclass('analytics.product_gem_bom') is null
     or to_regclass('analytics.shop_intake_token') is null or to_regclass('analytics.worker_session') is null then
    raise exception '0191: ไม่พบ job_gem_bom / gem_item / product_gem_bom (0190) หรือ shop_intake_token / worker_session (0187) — apply 0187-0190 ก่อน';
  end if;
  if to_regprocedure('analytics.job_gem_bom_replace_core(uuid,jsonb,boolean,uuid,uuid,text,text,text,uuid[])') is null
     or to_regprocedure('analytics.gem_lines_prepare(uuid,jsonb,boolean,uuid,uuid,uuid[])') is null
     or to_regprocedure('analytics.job_gem_state(uuid,uuid)') is null
     or to_regprocedure('analytics.job_gem_edit_window(uuid)') is null
     or to_regprocedure('analytics.gem_item_json(uuid)') is null
     or to_regprocedure('analytics.gem_item_canonical(uuid)') is null
     or to_regprocedure('analytics.gem_item_live(uuid)') is null
     or to_regprocedure('analytics.gem_name_norm(text)') is null
     or to_regprocedure('analytics.gem_shape_ensure(uuid)') is null
     or to_regprocedure('analytics.job_worker_photo_job(uuid,uuid,text,uuid)') is null
     or to_regprocedure('analytics.shop_intake_auth(text,text,text,boolean,text)') is null
     or to_regprocedure('analytics.job_create_from_production_item_core(uuid,uuid,text[],date,text,text,uuid,uuid,integer,numeric,numeric,text,uuid,jsonb,boolean)') is null
     or to_regprocedure('analytics.job_sort_stage_codes(uuid,text[])') is null
     or to_regprocedure('analytics.job_fail(text,text,jsonb)') is null
     or to_regprocedure('analytics.job_rate_limit_hit(text,integer)') is null
     or to_regprocedure('analytics.job_event_write(uuid,uuid,text,date,uuid,uuid,text,text,jsonb)') is null
     or to_regprocedure('analytics.job_device_hint(text,text)') is null
     or to_regprocedure('analytics.job_today()') is null then
    raise exception '0191: ไม่พบฟังก์ชันที่ต้องใช้ (job_gem_bom_replace_core · gem_lines_prepare · job_gem_state · job_gem_edit_window · gem_item_* · job_worker_photo_job · shop_intake_auth · job_create_from_production_item_core ฯลฯ) — ตรวจ 0187-0190';
  end if;
  -- คอลัมน์ที่ฟังก์ชันใหม่อ่าน (job / job_gem_bom / product_gem_bom / job_stage / gem_item + created_by_worker_id/created_at ของ gem_type/gem_shape ที่เพดานนับ) (plpgsql ไม่ตรวจชื่อคอลัมน์ตอน create — ตรวจที่นี่ให้ล้มก่อน DDL)
  select count(*) into v_n from information_schema.columns
   where table_schema = 'analytics'
     and ((table_name = 'job' and column_name in ('id', 'shop_id', 'status', 'parent_job_id', 'qty_planned', 'job_no', 'design_label', 'production_order_item_id'))
       or (table_name = 'job_gem_bom' and column_name in ('job_id', 'gem_item_id', 'gem_label', 'qty_per_piece', 'position_note', 'line_seq'))
       or (table_name = 'product_gem_bom' and column_name in ('shop_id', 'product_id', 'gem_item_id', 'qty_per_piece', 'position_note', 'line_seq'))
       or (table_name = 'job_stage' and column_name in ('job_id', 'stage_code', 'status'))
       or (table_name = 'gem_item' and column_name in ('shop_id', 'gem_type_id', 'gem_shape_id', 'size_a', 'size_b', 'created_at', 'created_by_worker_id'))
       or (table_name in ('gem_type', 'gem_shape') and column_name in ('shop_id', 'created_by_worker_id', 'created_at')));
  if v_n <> 8 + 6 + 6 + 3 + 7 + 3 + 3 then
    raise exception '0191: คอลัมน์ของ job / job_gem_bom / product_gem_bom / job_stage / gem_item / gem_type / gem_shape ไม่ครบตามที่ใช้ (พบ % จาก 36)', v_n;
  end if;
  -- ฟังก์ชันที่ replace: ต้องมี signature เดียว และ def บน DB = ฉบับที่ลอก (md5 · ลอกสดจาก DB 23 ต.ค. 69) หรือเป็นฉบับ 0191 แล้ว (รันซ้ำ)
  for r in select * from (values
      ('job_worker_open', 'f38bb43b71cff787eb3caf73a06c0571'),
      ('job_worker_my_intake_list', '3ad116407a64741c8e15764eda98c2ab')) as t(fname, md5_expected) loop
    select count(*) into v_n from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = r.fname;
    if v_n <> 1 then
      raise exception '0191: % มี % signature (ต้องมี 1) — หยุดตรวจ overload ก่อน', r.fname, v_n;
    end if;
    select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = r.fname;
    if md5(v_def) <> r.md5_expected and position('0191' in v_def) = 0 then
      raise exception '0191: def ของ % บน DB ไม่ใช่ฉบับที่ลอก (md5 ไม่ตรง) — มีคนแก้นอก migration · หยุด ห้าม replace ทับ', r.fname;
    end if;
  end loop;
  -- ชื่อ object ใหม่ต้องยังไม่ถูกใช้ผิดประเภท (รันซ้ำได้ — มีอยู่แล้วต้องเป็นของไฟล์นี้)
  select count(*) into v_n from pg_proc p where p.pronamespace = 'analytics'::regnamespace
     and p.proname in ('shop_intake_gem_auth', 'job_worker_gem_block', 'job_gem_rev', 'job_worker_gem_precheck', 'job_worker_gem_fail', 'job_worker_gem_summary', 'job_worker_gem_name_cap', 'job_worker_gem_item_cap', 'job_worker_gem_set', 'job_worker_gem_get', 'job_worker_gem_catalog')
     and position('0191' in pg_get_functiondef(p.oid)) = 0;
  if v_n > 0 then
    raise exception '0191: มีฟังก์ชันชื่อเดียวกับของไฟล์นี้อยู่แล้วแต่ไม่ใช่ของ 0191 (% ตัว) — หยุด', v_n;
  end if;
  raise notice '0191: ใบงานเดิม % ใบ · ไม่มี UPDATE แถวเดิมในไฟล์นี้', (select count(*) from analytics.job);
end;
$p$;

-- ============================================================================
-- 1. helper ภายใน (ไม่ grant ใคร — เรียกจาก RPC definer ด้านล่างเท่านั้น)
-- ============================================================================

-- ด่านกลางของ RPC พลอยฝั่งช่าง: ip → รูปแบบ hash → token ร้าน (ไม่พบ = ไม่เขียนถัง) → เพิกถอน → session ช่าง (ร้านเดียวกัน · active) → can_open_job สด → ถังต่อช่าง
-- p_bucket: write (gem_set) | read (gem_get · gem_catalog) · คืน {ok, shop_id, worker_id} หรือ job_fail · ถังต่อช่างนับ "หลัง" พบ session ที่มีสิทธิ์ (คนถือ QR ปลอม cookie เผาถังผู้จัดการตัวจริงไม่ได้)
-- ลำดับเดียวกับ shop_intake_photo_auth (0189) แต่ถังต่อช่างแยกเป็นของพลอย (wg/wgr) — พลอยไม่เผาถังรูป และรูปไม่เผาถังพลอย (0191)
create or replace function analytics.shop_intake_gem_auth(p_token_hash text, p_session_hash text, p_ip_hash text, p_bucket text)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_tok analytics.shop_intake_token%rowtype;
  v_w   analytics.worker%rowtype;
begin
  -- 0191 W3: ด่านกลางของ RPC พลอยฝั่งช่าง
  if p_bucket is null or p_bucket not in ('write', 'read') then
    raise exception 'shop_intake_gem_auth: bucket ไม่ถูกต้อง' using errcode = '22023';
  end if;
  if p_ip_hash is not null and p_ip_hash ~ '^[0-9a-f]{64}$' then
    if not analytics.job_rate_limit_hit(case p_bucket when 'write' then 'ipw:' else 'ipr:' end || left(p_ip_hash, 32), case p_bucket when 'write' then 300 else 240 end) then
      return analytics.job_fail('rate_limited', 'ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
    end if;
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return analytics.job_fail('invalid_token', 'QR ร้านนี้ใช้ไม่ได้แล้ว');
  end if;
  select * into v_tok from analytics.shop_intake_token t where t.token_hash = p_token_hash;
  if not found or v_tok.revoked_at is not null then
    return analytics.job_fail('invalid_token', 'QR ร้านนี้ใช้ไม่ได้แล้ว');
  end if;
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then
    return analytics.job_fail('session_required', 'หมดเวลาแล้ว — ใส่ PIN ใหม่');
  end if;
  select w.* into v_w
    from analytics.worker_session s
    join analytics.worker w on w.id = s.worker_id and w.shop_id = s.shop_id
   where s.session_hash = p_session_hash and s.revoked_at is null and s.expires_at > now()
     and w.is_active and w.shop_id = v_tok.shop_id;
  if v_w.id is null then
    return analytics.job_fail('session_required', 'หมดเวลาแล้ว — ใส่ PIN ใหม่');
  end if;
  -- สิทธิ์ตรวจสดจาก DB ทุกครั้ง (ออฟฟิศถอนสิทธิ์หลังเปิดใบ = แก้/อ่านพลอยไม่ได้ทันที)
  if not v_w.can_open_job then
    return analytics.job_fail('not_allowed', 'บัญชีนี้ไม่มีสิทธิ์จัดการใบงานจากหน้างาน — แจ้งออฟฟิศ');
  end if;
  if not analytics.job_rate_limit_hit(case p_bucket when 'write' then 'wg:' else 'wgr:' end || v_w.id::text, case p_bucket when 'write' then 20 else 120 end) then
    return analytics.job_fail('rate_limited', 'ส่งถี่เกินไป — รอสักครู่แล้วลองใหม่');
  end if;
  return jsonb_build_object('ok', true, 'shop_id', v_tok.shop_id, 'worker_id', v_w.id);
end;
$f$;

-- ใบนี้ผู้จัดการแก้พลอยได้ไหม — นิยามเดียวของทั้ง gem_set · gem_get · my_intake_list: null = แก้ได้ · ไม่ใช่ null = job_fail พร้อม code
-- ลำดับ: ใบไม่ใช่ใบแม่/ไม่พบ → order_not_found · ยกเลิก (ใบ/ใบผลิต) → job_cancelled · ปิด (done / ใบผลิตไม่ open) → job_closed · ช่างเริ่มรับงานแล้ว (in_progress หรือ job_gem_edit_window ≠ free_before_start) → job_locked ·
-- สถานะอื่นที่ไม่ใช่ open (เช่น on_hold) → job_not_open · ใบไม่มีขั้นฝัง (gem_set ที่ pending) → no_gem_stage ("แจ้งออฟฟิศเพิ่มขั้น" — ระบบไม่เพิ่มขั้นเอง)
-- เรียกหลังล็อกแถวใบ (for update) เมื่อใช้เป็นด่านเขียน — เพื่อให้ชนกับ "ช่างรับงาน" แล้วเห็นผลที่ commit แล้ว
create or replace function analytics.job_worker_gem_block(p_job_id uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job analytics.job%rowtype;
  v_po  text;
begin
  -- 0191 W3: นิยามเดียวของ "ใบนี้ผู้จัดการแก้พลอยได้ไหม"
  select * into v_job from analytics.job where id = p_job_id;
  if not found or v_job.parent_job_id is not null then
    return analytics.job_fail('order_not_found', 'ไม่พบใบงานที่เปิดไว้ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  select po.status into v_po
    from analytics.production_order_item i join analytics.production_order po on po.id = i.production_order_id
   where i.id = v_job.production_order_item_id;
  if v_job.status = 'cancelled' or v_po = 'cancelled' then
    return analytics.job_fail('job_cancelled', 'ใบนี้ถูกยกเลิกแล้ว — แก้พลอยไม่ได้');
  end if;
  if v_job.status = 'done' or v_po is distinct from 'open' then
    return analytics.job_fail('job_closed', 'ใบนี้ปิดแล้ว — แก้พลอยไม่ได้');
  end if;
  if v_job.status = 'in_progress' or analytics.job_gem_edit_window(v_job.id) is distinct from 'free_before_start' then
    return analytics.job_fail('job_locked', 'ช่างรับงานแล้ว แก้พลอยไม่ได้ — แจ้งออฟฟิศ');
  end if;
  if v_job.status <> 'open' then
    return analytics.job_fail('job_not_open', 'ใบนี้ไม่อยู่ในสถานะที่แก้พลอยได้ — แจ้งออฟฟิศ');
  end if;
  if not exists (select 1 from analytics.job_stage gs join analytics.job gj on gj.id = gs.job_id
                  where (gj.id = v_job.id or gj.parent_job_id = v_job.id) and gs.stage_code = 'gem_set' and gs.status = 'pending') then
    return analytics.job_fail('no_gem_stage', 'ใบนี้ไม่มีขั้นฝังพลอย — แจ้งออฟฟิศให้เพิ่มขั้นก่อน');
  end if;
  return null;
end;
$f$;

-- ลายนิ้วมือของพลอยใบ (CAS) — เปลี่ยนเมื่อ รายการ/จำนวน/ตำแหน่ง/ลำดับ เปลี่ยน (ไม่รวมฉลาก snapshot) · ไม่มีแถว = 'empty' · ตรงกับสิ่งที่ job_gem_bom_replace_core ใช้ตัดสินว่า "เปลี่ยนไหม"
create or replace function analytics.job_gem_rev(p_job_id uuid)
 returns text
 language sql
 stable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
  -- 0191 W3: ลายนิ้วมือของพลอยใบ (CAS)
  select coalesce(md5(string_agg(g.gem_item_id::text || ':' || g.qty_per_piece || ':' || coalesce(g.position_note, '') || ':' || g.line_seq, '|' order by g.line_seq)), 'empty')
    from analytics.job_gem_bom g where g.job_id = p_job_id
$f$;

-- ตัวดักชื่อคล้าย: คืน p_force boolean ที่ส่งต่อให้ core — true เฉพาะเมื่อ "ทุกชื่อที่ DB รายงานว่าคล้าย (ในคำขอนี้)" อยู่ในรายการ force (kind + norm ตรงกัน)
--   รายการ force ผิดรูป/boolean/เกิน 60 = 22023 gem_force_invalid · ชื่อใน force ที่ไม่ตรงชื่อที่ถูกถามจริง = ไม่มีผล (ไม่ปลดคำถามของชื่ออื่น) · ยังมีชื่อที่ไม่ถูก force = raise gem_similar เดิม (ไม่เขียนอะไร)
--   probe = gem_lines_prepare แบบ p_force=false ใน subtransaction ที่ถอยกลับเสมอ (SQLSTATE W3P01 = ผ่านโดยไม่มีชื่อคล้าย) · แถวผิดอื่นๆ raise ต่อด้วย hint/detail เดิม · ใช้ก่อนสร้างอะไรทั้งสิ้น (open) หรือก่อนแก้ (gem_set)
create or replace function analytics.job_worker_gem_precheck(p_shop_id uuid, p_worker_id uuid, p_lines jsonb, p_force jsonb, p_allow_item_ids uuid[] default '{}'::uuid[])
 returns boolean
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_f       jsonb := coalesce(p_force, '[]'::jsonb);
  v_el      jsonb;
  v_state   text := 'ok';
  v_hint    text;
  v_detail  text;
  v_msg     text;
  v_sim     jsonb;
  v_covered boolean;
  v_prep    jsonb;
  v_newn    int := 0;
  v_newi    int := 0;
  v_fa      boolean := false;
  v_try     int;
  v_exist   int;
begin
  -- 0191 W3: ตัวดักชื่อคล้าย — force ต่อชื่อที่ถูกถาม + เพดานชื่อใหม่ต่อวัน
  if jsonb_typeof(v_f) <> 'array' or jsonb_array_length(v_f) > 60 then
    raise exception 'รายการยืนยันชื่อพลอยไม่ถูกต้อง' using errcode = '22023', hint = 'gem_force_invalid';
  end if;
  for v_el in select value from jsonb_array_elements(v_f) loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'รายการยืนยันชื่อพลอยไม่ถูกต้อง' using errcode = '22023', hint = 'gem_force_invalid';
    end if;
    if exists (select 1 from jsonb_object_keys(v_el) k where k <> all (array['kind', 'name']))
       or coalesce(v_el ->> 'kind', '') not in ('type', 'shape')
       or jsonb_typeof(v_el -> 'name') is distinct from 'string'
       or char_length(v_el ->> 'name') > 200 then
      raise exception 'รายการยืนยันชื่อพลอยไม่ถูกต้อง' using errcode = '22023', hint = 'gem_force_invalid';
    end if;
  end loop;
  -- probe สูงสุด 2 รอบ: รอบแรก p_force=false (ไม่มีชื่อคล้าย = จบ) · มีชื่อคล้ายและ "ทุกชื่อถูก force" → รอบสอง p_force=true เพื่อนับชื่อใหม่ที่จะเกิดจริง (ใช้กับเพดานชื่อใหม่ต่อวัน)
  for v_try in 1 .. 2 loop
    v_state := 'ok';
    v_detail := null;
    begin
      v_prep := analytics.gem_lines_prepare(p_shop_id, p_lines, v_fa, null, p_worker_id, coalesce(p_allow_item_ids, '{}'::uuid[]));
      v_newn := jsonb_array_length(coalesce(v_prep -> 'summary' -> 'created_types', '[]'::jsonb)) + jsonb_array_length(coalesce(v_prep -> 'summary' -> 'created_shapes', '[]'::jsonb));
      v_newi := jsonb_array_length(coalesce(v_prep -> 'summary' -> 'created_items', '[]'::jsonb));
      raise exception 'probe' using errcode = 'W3P01', detail = v_newn::text || ',' || v_newi::text;
    exception
      when sqlstate 'W3P01' then
        get stacked diagnostics v_detail = pg_exception_detail;
        v_newn := coalesce(nullif(split_part(v_detail, ',', 1), '')::int, 0);
        v_newi := coalesce(nullif(split_part(v_detail, ',', 2), '')::int, 0);
        v_state := 'ok';
      when sqlstate '22023' then
        get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail, v_msg = message_text;
        if v_hint is distinct from 'gem_similar' then
          raise exception '%', v_msg using errcode = '22023', hint = v_hint, detail = v_detail;
        end if;
        v_state := 'similar';
    end;
    exit when v_state = 'ok';
    begin
      v_sim := (v_detail::jsonb) -> 'similar';
    exception when others then
      v_sim := null;
    end;
    if v_sim is null or jsonb_typeof(v_sim) <> 'array' or jsonb_array_length(v_sim) = 0 then
      raise exception '%', v_msg using errcode = '22023', hint = 'gem_similar', detail = v_detail;
    end if;
    for v_el in select value from jsonb_array_elements(v_sim) loop
      v_covered := exists (select 1 from jsonb_array_elements(v_f) f
                            where f.value ->> 'kind' = v_el ->> 'kind' and analytics.gem_name_norm(f.value ->> 'name') = analytics.gem_name_norm(v_el ->> 'name'));
      if not v_covered then
        raise exception '%', v_msg using errcode = '22023', hint = 'gem_similar', detail = v_detail;
      end if;
    end loop;
    v_fa := true;
  end loop;
  if v_state <> 'ok' then
    raise exception '%', v_msg using errcode = '22023', hint = 'gem_similar', detail = v_detail;
  end if;
  -- เพดานชื่อใหม่ (ชนิด+รูปทรง) ที่ผู้จัดการคนเดียวสร้างได้ใน 24 ชม. — ช่องสาธารณะที่สร้างชื่อเข้าแคตตาล็อกได้เอง (มติ 21 ต.ค.) ต้องกันชื่อขยะท่วม · นับเฉพาะชื่อที่ "เกิดใหม่จริง" (ชื่อที่ใช้ตัวเดิมไม่นับ · ชื่อที่ออฟฟิศสร้างไม่นับ)
  if v_newn > 0 then
    select (select count(*) from analytics.gem_type t where t.shop_id = p_shop_id and t.created_by_worker_id = p_worker_id and t.created_at > now() - interval '24 hours')
         + (select count(*) from analytics.gem_shape s where s.shop_id = p_shop_id and s.created_by_worker_id = p_worker_id and s.created_at > now() - interval '24 hours')
      into v_exist;
    if v_exist + v_newn > analytics.job_worker_gem_name_cap() then
      raise exception 'เพิ่มชื่อพลอยใหม่ถี่เกินไป' using errcode = '22023', hint = 'gem_name_cap';
    end if;
  end if;
  -- เพดานรายการพลอยใหม่ (ชนิด x รูปทรง x ขนาด) — ขนาดสุ่ม 30 แถว x แก้ซ้ำ = รายการเกิดไม่จำกัดโดยไม่สร้างชื่อใหม่ (security M1) · ใช้ hint เดียวกับเพดานชื่อ
  if v_newi > 0 then
    select count(*) into v_exist from analytics.gem_item i where i.shop_id = p_shop_id and i.created_by_worker_id = p_worker_id and i.created_at > now() - interval '24 hours';
    if v_exist + v_newi > analytics.job_worker_gem_item_cap() then
      raise exception 'เพิ่มรายการพลอยใหม่ถี่เกินไป' using errcode = '22023', hint = 'gem_name_cap';
    end if;
  end if;
  return v_fa;
end;
$f$;

-- เพดานรายการพลอยใหม่ต่อผู้จัดการ ต่อ 24 ชม. — ค่าที่ทีมตั้ง (security M1 · 23 ต.ค.) · แก้ที่นี่ที่เดียว
create or replace function analytics.job_worker_gem_item_cap()
 returns int
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $f$
  -- 0191 W3: เพดานรายการใหม่ต่อวัน
  select 120
$f$;

-- เพดานชื่อพลอยใหม่ (ชนิด+รูปทรงรวมกัน) ต่อผู้จัดการ ต่อ 24 ชม. — ค่าที่ทีมตั้ง (ไม่ใช่ค่าเจ้าของ · ux §3.6 [เพดานให้ architect]) · แก้ที่นี่ที่เดียว
create or replace function analytics.job_worker_gem_name_cap()
 returns int
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $f$
  -- 0191 W3: เพดานชื่อใหม่ต่อวัน
  select 40
$f$;

-- error ของพลอย (22023 + hint + detail json {row, field, code}) → ผลฝั่งช่าง · ไม่ส่งข้อความดิบของ DB (ข้อความไทยตายตัว · รหัสจริงอยู่ใน gem_code ให้ TS แปลง) · ไม่ใช่ error ของพลอย = null (ผู้เรียกจัดการเอง)
create or replace function analytics.job_worker_gem_fail(p_hint text, p_detail text)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_d     jsonb;
  v_code  text;
  v_row   int;
  v_field text;
begin
  -- 0191 W3: error พลอย → ผลฝั่งช่าง (ไม่ส่งข้อความดิบ)
  begin
    v_d := p_detail::jsonb;
  exception when others then
    v_d := null;
  end;
  if v_d is not null and jsonb_typeof(v_d) <> 'object' then
    v_d := null;
  end if;
  if p_hint = 'gem_similar' then
    return analytics.job_fail('gem_similar', 'พบชื่อพลอยที่คล้ายกับที่มีอยู่แล้ว — ใช้ตัวที่มี หรือยืนยันเพิ่มเป็นชื่อใหม่',
      jsonb_build_object('similar', case when jsonb_typeof(v_d -> 'similar') = 'array' then v_d -> 'similar' else '[]'::jsonb end));
  end if;
  if p_hint = 'gem_force_invalid' then
    return analytics.job_fail('gem_force_invalid', 'ข้อมูลยืนยันชื่อพลอยไม่ถูกต้อง — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  if p_hint = 'gem_name_cap' then
    return analytics.job_fail('gem_name_cap', 'เพิ่มชื่อพลอยใหม่ถี่เกินไป — รอสักครู่ หรือใช้ชื่อที่มีในรายการ');
  end if;
  v_code := coalesce(v_d ->> 'code', case when p_hint in ('lines_invalid', 'line_invalid', 'too_many_lines') then p_hint end);
  if v_code is null or v_code !~ '^[a-z_]{1,40}$' then
    return null;
  end if;
  v_row := case when (v_d ->> 'row') ~ '^[0-9]{1,2}$' then (v_d ->> 'row')::int end;
  v_field := case when (v_d ->> 'field') ~ '^[a-z_]{1,30}$' then v_d ->> 'field' end;
  return analytics.job_fail('gem_line_invalid', 'ข้อมูลพลอยไม่ถูกต้อง — ตรวจแถวที่ระบุแล้วลองอีกครั้ง',
    jsonb_strip_nulls(jsonb_build_object('gem_code', v_code, 'gem_row', v_row, 'gem_field', v_field)));
end;
$f$;

-- สรุปผลของ replace_core ที่ส่งถึงช่างได้: ชื่อใหม่ที่เข้าแคตตาล็อก · ชื่อที่ "ใช้ตัวเดิมให้" · แถวที่รวมให้ — 🔴 ไม่มีราคา/ผู้ขาย/ผู้สร้าง
create or replace function analytics.job_worker_gem_summary(p_summary jsonb)
 returns jsonb
 language sql
 stable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
  -- 0191 W3: สรุปผลที่ส่งถึงช่างได้ (ไม่มีราคา)
  select jsonb_build_object(
    'created_types', (select coalesce(jsonb_agg(c.value ->> 'name'), '[]'::jsonb) from jsonb_array_elements(coalesce(p_summary -> 'created_types', '[]'::jsonb)) c),
    'created_shapes', (select coalesce(jsonb_agg(c.value ->> 'name'), '[]'::jsonb) from jsonb_array_elements(coalesce(p_summary -> 'created_shapes', '[]'::jsonb)) c),
    'reused', (select coalesce(jsonb_agg(jsonb_build_object('row', r.value -> 'row', 'kind', r.value -> 'kind', 'typed', r.value -> 'typed', 'name', r.value -> 'name')), '[]'::jsonb)
                 from jsonb_array_elements(coalesce(p_summary -> 'reused', '[]'::jsonb)) r),
    'merged_rows', (select coalesce(jsonb_agg(m.value -> 'rows'), '[]'::jsonb) from jsonb_array_elements(coalesce(p_summary -> 'merged_rows', '[]'::jsonb)) m))
$f$;

-- ============================================================================
-- 2. job_worker_open — เปิดใบพร้อมพลอย (ลอก def สดจาก DB 23 ต.ค. 69 ทุกบรรทัด แล้วแก้เฉพาะจุดที่มีคอมเมนต์ 0191)
--    drop signature เดิม (15 args) ก่อน: ข้อ 1 · ผลเดิมทุกแบบเมื่อไม่ส่ง p_gem_* (named args ⇒ arg ใหม่ไม่ส่ง = default)
-- ============================================================================
drop function if exists analytics.job_worker_open(text, text, text, uuid, text, text, numeric, numeric, integer, integer, date, boolean, text, text, text);

create or replace function analytics.job_worker_open(p_token_hash text, p_session_hash text, p_idem_key text, p_product_id uuid DEFAULT NULL::uuid, p_pending_label text DEFAULT NULL::text, p_metal text DEFAULT NULL::text, p_purity numeric DEFAULT NULL::numeric, p_weight_g numeric DEFAULT NULL::numeric, p_qty_order integer DEFAULT NULL::integer, p_qty_planned integer DEFAULT NULL::integer, p_due_date date DEFAULT NULL::date, p_is_new_design boolean DEFAULT NULL::boolean, p_note text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_ip_hash text DEFAULT NULL::text, p_gem_lines jsonb DEFAULT NULL::jsonb, p_gem_answer text DEFAULT NULL::text, p_gem_force jsonb DEFAULT NULL::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_a       jsonb;
  v_shop    uuid;
  v_wid     uuid;
  v_today   date := analytics.job_today();
  v_label   text;
  v_note    text;
  v_planned int;
  v_product public.product%rowtype;
  v_po      analytics.production_order%rowtype;
  v_seq     int;
  v_item    jsonb;
  v_item_id uuid;
  v_info    jsonb;
  v_codes   text[];
  v_job     jsonb;
  v_jobrow  analytics.job%rowtype;
  v_tok     jsonb;
  v_dup_no  text;
  v_hint    text;
  v_code    text;
  v_new     boolean := coalesce(p_is_new_design, false);
  v_detail  text;
  v_gforce  boolean := false;
  v_gfail   jsonb;
  v_gem     jsonb;
begin
  v_a := analytics.shop_intake_auth(p_token_hash, p_session_hash, p_ip_hash, true, 'open');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_shop := (v_a ->> 'shop_id')::uuid;
  v_wid := (v_a ->> 'worker_id')::uuid;
  -- สิทธิ์ตรวจสดจาก DB ทุกครั้ง (ออฟฟิศถอนสิทธิ์ระหว่างกรอก = ปฏิเสธ) · ก่อนถังต่อช่าง (wo:) — และถังต่อ token (sio:) ก็ไม่ถูกนับสำหรับ session ที่ไม่มีสิทธิ์ (shop_intake_auth) จึงไม่มีทางที่คนไม่มีสิทธิ์เผาถังของผู้จัดการตัวจริง
  if not (v_a ->> 'can_open')::boolean then
    return analytics.job_fail('not_allowed', 'บัญชีนี้ไม่มีสิทธิ์เปิดงานใหม่ — แจ้งออฟฟิศ');
  end if;
  if not analytics.job_rate_limit_hit('wo:' || v_wid::text, 10) then
    return analytics.job_fail('rate_limited', 'ส่งถี่เกินไป — รอสักครู่แล้วลองใหม่');
  end if;

  -- validate: คืน {ok:false, code} ไม่ raise (ไม่แตะข้อมูล) · ตัวเลขใช้ not(between) กัน NaN/Infinity (ข้อ 4)
  if p_idem_key is null or p_idem_key !~ '^[A-Za-z0-9_-]{16,64}$' then
    return analytics.job_fail('idem_invalid', 'ข้อมูลไม่ครบ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  if num_nonnulls(p_product_id, p_pending_label) <> 1 then
    return analytics.job_fail('sku_or_label', 'ต้องเลือกสินค้า หรือพิมพ์ชื่อแบบอย่างใดอย่างหนึ่ง');
  end if;
  if p_qty_order is null or not (p_qty_order between 1 and 100000) then
    return analytics.job_fail('qty_invalid', 'จำนวนต้องอยู่ระหว่าง 1 ถึง 100,000 ชิ้น');
  end if;
  v_planned := coalesce(p_qty_planned, p_qty_order);
  if not (v_planned between p_qty_order and 100000) then
    return analytics.job_fail('qty_invalid', 'จำนวนที่เริ่มผลิตต้องไม่น้อยกว่าจำนวนที่สั่ง และไม่เกิน 100,000 ชิ้น');
  end if;
  if p_due_date is not null and not (p_due_date >= v_today and p_due_date <= v_today + 730) then
    return analytics.job_fail('due_invalid', 'กำหนดเสร็จต้องไม่ย้อนหลังและไม่เกิน 2 ปีข้างหน้า');
  end if;
  if p_metal is not null and p_metal not in ('silver', 'gold', 'brass') then
    return analytics.job_fail('metal_invalid', 'เลือกวัสดุเป็นเงิน ทอง หรือทองเหลือง');
  end if;
  if p_purity is not null and not (p_purity >= 0.375 and p_purity <= 1 and p_purity = round(p_purity, 4)) then
    return analytics.job_fail('purity_invalid', 'เนื้อโลหะต้องอยู่ระหว่าง 37.50% ถึง 100%');
  end if;
  if p_weight_g is not null and not (p_weight_g > 0 and p_weight_g <= 10000 and p_weight_g = round(p_weight_g, 3)) then
    return analytics.job_fail('weight_invalid', 'น้ำหนักไม่ถูกต้อง (ตัวเลขมากกว่า 0 ทศนิยมไม่เกิน 3 ตำแหน่ง)');
  end if;
  if p_pending_label is not null then
    begin
      -- ยุบช่องว่างซ้อนเป็นช่องเดียวเหมือน production_order_item_set (0186 L3)
      v_label := regexp_replace(analytics.job_label_clean(p_pending_label, 'ชื่อแบบ', 200), '\s+', ' ', 'g');
    exception when sqlstate '22023' then
      return analytics.job_fail('name_invalid', 'ชื่อแบบไม่ถูกต้อง — ห้ามเว้นว่าง ห้ามขึ้นบรรทัดใหม่/อักขระล่องหน/เครื่องหมาย < > และต้องไม่ยาวเกินกำหนด');
    end;
    if p_metal is null then
      return analytics.job_fail('metal_required', 'สินค้าใหม่ต้องเลือกวัสดุ');
    end if;
    if p_metal = 'gold' and p_purity is null then
      return analytics.job_fail('gold_purity_required', 'ทองต้องใส่เนื้อทอง (ขั้นต่ำ 37.50%)');
    end if;
  end if;
  begin
    v_note := analytics.job_text_clean(p_note, 'หมายเหตุ', 500, false);
  exception when sqlstate '22023' then
    return analytics.job_fail('note_invalid', 'หมายเหตุไม่ถูกต้อง — ห้ามขึ้นบรรทัดใหม่/อักขระล่องหน และยาวไม่เกิน 500 ตัวอักษร');
  end;
  if p_product_id is not null then
    select * into v_product from public.product where id = p_product_id and shop_id = v_shop;
    -- ไม่พบ/ร้านอื่น/ปิดใช้/live* = ข้อความเดียวกัน (ไม่บอกว่ามี SKU นี้ในร้านอื่นไหม)
    if not found or not v_product.is_active or v_product.sku ~* '^live' then
      return analytics.job_fail('sku_invalid', 'เลือกสินค้านี้ไม่ได้ — เลือกสินค้าอื่น หรือแจ้งออฟฟิศ');
    end if;
  end if;
  -- 0191 W3: พลอยของใบ — validate รูปร่างก่อนแตะข้อมูล (คืน code ไม่ raise) · p_gem_answer: null = ทำงานเดิม · 'template' = ตามแม่แบบ SKU และต้องมีแม่แบบ · 'none' = ไม่มีพลอย (ไม่มีขั้นฝัง) · 'has' = มีพลอย (ต้อง 1-30 แถว → มีขั้นฝัง)
  if p_gem_answer is not null and p_gem_answer not in ('none', 'has', 'template') then
    return analytics.job_fail('gem_answer_invalid', 'เลือกก่อนว่าใบนี้ฝังพลอยไหม');
  end if;
  if p_gem_answer is distinct from 'has' and p_gem_force is not null then
    return analytics.job_fail('gem_args_invalid', 'ข้อมูลพลอยไม่ถูกต้อง — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  if p_gem_answer is null or p_gem_answer = 'template' then
    if p_gem_lines is not null then
      return analytics.job_fail('gem_args_invalid', 'ข้อมูลพลอยไม่ถูกต้อง — โหลดหน้าใหม่แล้วลองอีกครั้ง');
    end if;
  elsif p_gem_answer = 'none' then
    if p_gem_lines is not null and p_gem_lines <> '[]'::jsonb then
      return analytics.job_fail('gem_args_invalid', 'ตอบว่า "ไม่มีพลอย" แต่มีรายการพลอยมาด้วย — ตรวจแล้วลองอีกครั้ง');
    end if;
  else
    if p_gem_lines is null or jsonb_typeof(p_gem_lines) <> 'array' or jsonb_array_length(p_gem_lines) = 0 then
      return analytics.job_fail('gem_lines_required', 'เพิ่มพลอยอย่างน้อย 1 รายการ หรือเลือก "ไม่มีพลอย"');
    end if;
    if jsonb_array_length(p_gem_lines) > 30 then
      return analytics.job_fail('gem_line_invalid', 'พลอยต่อใบมีได้ไม่เกิน 30 รายการ', jsonb_build_object('gem_code', 'too_many_lines', 'gem_row', 31, 'gem_field', 'lines'));
    end if;
  end if;
  if p_gem_answer = 'template' then
    if p_product_id is null or not exists (select 1 from analytics.product_gem_bom b where b.shop_id = v_shop and b.product_id = p_product_id) then
      return analytics.job_fail('gem_answer_required', 'สินค้านี้ยังไม่มีแม่แบบพลอย — เลือกก่อนว่าฝังพลอยหรือไม่ฝังพลอย');
    end if;
  end if;

  -- กดซ้ำ/เน็ตสะดุด: key เดียวกันจากช่างคนเดียวกัน = ใบเดิม (ไม่ออก QR ซ้ำ — QR แสดงซ้ำไม่ได้ เก็บ hash) · key เดียวกันจากช่างอื่น = ปฏิเสธ
  perform pg_advisory_xact_lock(hashtextextended('intake:' || v_shop::text || ':' || p_idem_key, 0));
  select * into v_po from analytics.production_order po where po.shop_id = v_shop and po.intake_idem_key = p_idem_key;
  if found then
    if v_po.opened_by_worker_id is distinct from v_wid then
      return analytics.job_fail('idem_conflict', 'คำขอนี้ซ้ำกับของคนอื่น — โหลดหน้าใหม่แล้วลองอีกครั้ง');
    end if;
    select j.* into v_jobrow
      from analytics.job j join analytics.production_order_item i on i.id = j.production_order_item_id
     where i.production_order_id = v_po.id and j.parent_job_id is null order by (j.status = 'cancelled'), j.created_at desc limit 1;
    -- replay: ทุกค่ามาจาก DB (ไม่เชื่อค่าที่ client ส่งซ้ำมา) · status = สถานะจริงของใบ (ใบงานหรือใบผลิตถูกยกเลิกแล้ว = cancelled → หน้าจอบอก "ใบนี้ถูกยกเลิกแล้ว" ไม่ใช่ "เปิดไว้แล้ว")
    -- 0191: gem = สรุปพลอยจริงของใบ (จาก DB — ไม่เชื่อพลอยที่ส่งซ้ำมา · ไม่ทำซ้ำ)
    return jsonb_build_object('ok', true, 'already', true, 'order_no', v_po.po_no, 'job_no', v_jobrow.job_no,
                              'design_label', v_jobrow.design_label, 'metal', v_jobrow.metal, 'qty_order', v_jobrow.qty_order, 'qty_planned', v_jobrow.qty_planned,
                              'sku', v_jobrow.sku_snapshot, 'sku_pending', v_jobrow.product_id is null, 'due_date', v_jobrow.due_date,
                              'is_new_design', coalesce((select i.is_new_design from analytics.production_order_item i where i.id = v_jobrow.production_order_item_id), false),
                              'status', case when v_po.status = 'cancelled' then 'cancelled' else v_jobrow.status end,
                              'gem', jsonb_build_object('count', (select count(*) from analytics.job_gem_bom g where g.job_id = v_jobrow.id),
                                                        'total', coalesce((select sum(g.qty_per_piece)::bigint from analytics.job_gem_bom g where g.job_id = v_jobrow.id), 0) * coalesce(v_jobrow.qty_planned, 0),
                                                        'state', analytics.job_gem_state(v_shop, v_jobrow.id)));
  end if;

  -- 0191: ตัวดักชื่อคล้าย + ตรวจพลอยทุกแถว "ก่อนสร้างอะไรทั้งสิ้น" (probe ถอยกลับเสมอ) · พลอยผิด/ชื่อคล้ายที่ยังไม่ถูก force = คืน code ที่นี่ — ไม่มี PO/ใบงาน/QR/ตัวนับขยับ
  if p_gem_answer = 'has' then
    begin
      v_gforce := analytics.job_worker_gem_precheck(v_shop, v_wid, p_gem_lines, p_gem_force);
    exception when sqlstate '22023' then
      get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
      v_gfail := analytics.job_worker_gem_fail(v_hint, v_detail);
      return coalesce(v_gfail, analytics.job_fail('invalid_input', 'ข้อมูลไม่ถูกต้อง — ตรวจช่องที่กรอกแล้วลองอีกครั้ง'));
    end;
  end if;

  begin
    -- Q7: SKU นี้มีใบงานเปิดอยู่แล้ว = บล็อก (ใบเดียวต่อ SKU ในหน้างาน — ต้องการล็อตที่ 2 ให้แจ้งออฟฟิศ)
    if p_product_id is not null then
      -- 0188 (QA race): ผู้จัดการ 2 คนเปิด SKU เดียวกันพร้อมกัน (คนละ idem key) ต้องไม่ได้ใบซ้ำ — ล็อกต่อ (ร้าน, SKU) ก่อนเช็ค job_exists · คนหลังรอคนแรก commit แล้วเห็นใบของคนแรก
      -- ลำดับล็อกคงที่: idem key (ด้านบน) → SKU เสมอ (กัน deadlock) · ล็อกแบบ xact — ปล่อยเองตอนจบทรานแซกชัน (หรือตอน sub-block นี้ถอยตัวเอง ซึ่งยังไม่ได้เขียนอะไร)
      perform pg_advisory_xact_lock(hashtextextended('intake:product:' || v_shop::text || ':' || p_product_id::text, 0));
      select j.job_no into v_dup_no from analytics.job j
       where j.shop_id = v_shop and j.product_id = p_product_id and j.parent_job_id is null and j.status in ('open', 'in_progress', 'on_hold')
       order by j.created_at limit 1;
      if v_dup_no is not null then
        raise exception 'SKU นี้มีใบงาน % เปิดอยู่แล้ว', v_dup_no using errcode = '22023', hint = 'job_exists';
      end if;
    end if;
    perform analytics.job_stage_def_ensure(v_shop);
    -- ตัวนับใบผลิต: เหมือน production_order_save แต่ขั้นเดียว (insert .. on conflict .. do update ล็อกแถวตัวนับ ⇒ พร้อมกันก็ไม่ซ้ำเลข)
    insert into analytics.production_order_counter as c (shop_id, last_no) values (v_shop, 1)
    on conflict (shop_id) do update set last_no = c.last_no + 1
    returning c.last_no into v_seq;
    insert into analytics.production_order (shop_id, seq, note, created_by, opened_via, opened_by_worker_id, intake_idem_key)
    values (v_shop, v_seq, v_note, null, 'shopfloor', v_wid, p_idem_key)
    returning * into v_po;
    v_item := analytics.production_order_item_set(p_shop_id => v_shop, p_production_order_id => v_po.id, p_product_id => p_product_id,
      p_qty_planned => p_qty_order, p_is_new_design => v_new, p_pending_product_label => v_label,
      p_metal => p_metal, p_purity => p_purity, p_weight_g => p_weight_g, p_weight_source => case when p_weight_g is not null then 'input' end);
    v_item_id := (v_item ->> 'id')::uuid;
    v_info := analytics.job_source_info(v_shop, 'production', v_item_id);
    v_codes := array(select e from jsonb_array_elements_text(v_info -> 'suggested_stage_codes') with ordinality as t(e, o) order by o);
    -- 0191: ขั้นฝังพลอยเกิดจากคำตอบ — 'none' = ถอด gem_set ออก · 'has' = เพิ่ม gem_set ถ้ายังไม่มี (เรียงตามลำดับมาตรฐานของร้าน) · อื่นๆ = ตามที่ระบบเสนอ (แม่แบบ SKU เสนอ gem_set เอง)
    if p_gem_answer = 'none' then
      v_codes := array_remove(v_codes, 'gem_set');
    elsif p_gem_answer = 'has' and not ('gem_set' = any (v_codes)) then
      v_codes := analytics.job_sort_stage_codes(v_shop, v_codes || 'gem_set'::text);
    end if;
    -- p_gem_lines ของ core: null = คัดลอกแม่แบบ SKU (เฉพาะเมื่อใบมีขั้นฝัง) · '[]' = ไม่มีพลอย · แถว = บันทึกพลอย (ชื่อใหม่เข้าแคตตาล็อกในทรานแซกชันนี้)
    v_job := analytics.job_create_from_production_item_core(v_shop, v_item_id, v_codes, p_due_date, null, v_note, null, v_wid, v_planned, null, null, null, null,
      case p_gem_answer when 'none' then '[]'::jsonb when 'has' then p_gem_lines else null end, v_gforce);
    select * into v_jobrow from analytics.job where id = (v_job ->> 'job_id')::uuid;
    -- 'has'/'template' แล้วต้องได้ขั้นฝังจริง (ขั้นนี้ถูกปิดใช้งานในร้าน = job_sort_stage_codes ตัดทิ้งเงียบ) — ไม่ได้ = ถอยทั้งก้อน
    if p_gem_answer in ('has', 'template') and not exists (select 1 from analytics.job_stage s where s.job_id = v_jobrow.id and s.stage_code = 'gem_set') then
      raise exception 'ใบนี้ไม่มีขั้นฝังพลอย (ร้านยังตั้งขั้นนี้ไม่พร้อม)' using errcode = '22023', hint = 'gem_stage_missing';
    end if;
    v_tok := analytics.job_token_issue_core(v_jobrow, false, null, v_wid, 'traveler', null);
    perform analytics.job_event_write(v_jobrow.id, null, 'intake_open', v_today, null, v_wid, 'worker_qr', analytics.job_device_hint(p_user_agent, p_ip_hash),
      jsonb_build_object('po_no', v_po.po_no, 'sku_pending', p_product_id is null, 'metal', v_jobrow.metal,
                         'qty_order', p_qty_order, 'qty_planned', v_planned, 'is_new_design', v_new)
      || case when p_gem_answer is null then '{}'::jsonb else jsonb_build_object('gem_answer', p_gem_answer, 'gem_lines', coalesce((v_job ->> 'gem_lines')::int, 0)) end);
  exception when sqlstate '22023' then
    get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
    -- 0191: error ของพลอยที่หลุดมาถึงตรงนี้ (แข่งกับคนอื่นที่เปลี่ยนแคตตาล็อกระหว่าง probe กับสร้างจริง) — ถอยทั้งก้อนแล้ว · ไม่ส่งข้อความดิบ
    v_gfail := analytics.job_worker_gem_fail(v_hint, v_detail);
    if v_gfail is not null then
      return v_gfail;
    end if;
    v_code := case v_hint
      when 'job_exists' then 'job_exists'
      when 'no_gold_profile' then 'no_gold_profile'
      when 'no_default_profile' then 'no_default_profile'
      when 'qty_planned_invalid' then 'qty_invalid'
      when 'due_invalid' then 'due_invalid'
      when 'metal_required' then 'metal_required'
      when 'metal_unsupported' then 'metal_required'
      when 'metal_invalid' then 'metal_invalid'
      when 'gold_purity_required' then 'gold_purity_required'
      when 'purity_invalid' then 'purity_invalid'
      when 'brass_purity_locked' then 'purity_invalid'
      when 'weight_invalid' then 'weight_invalid'
      when 'weight_source_invalid' then 'weight_invalid'
      when 'stages_unknown' then 'not_ready'
      when 'stages_empty' then 'not_ready'
      when 'gem_stage_missing' then 'not_ready'
      else null end;
    -- ถอยทั้งก้อนแล้ว (PO/ใบงาน/ตัวนับ/QR ไม่เหลือ) · ข้อความให้ช่างผ่านตารางตายตัว — ไม่ส่งข้อความดิบของ DB (อาจมีชื่อตาราง/ฟังก์ชัน)
    return analytics.job_fail(coalesce(v_code, 'invalid_input'),
      case v_code
        when 'job_exists' then 'SKU นี้มีใบงานเปิดอยู่แล้ว — ถ้าต้องการเพิ่มจำนวน แจ้งออฟฟิศ หรือเลือกสินค้าอื่น'
        when 'no_gold_profile' then 'เปิดงานทองไม่ได้ตอนนี้ — ยังไม่มีแบบการบันทึกสำหรับงานทอง แจ้งออฟฟิศให้ตั้งก่อน'
        when 'no_default_profile' then 'เปิดงานไม่ได้ตอนนี้ — ร้านยังไม่ได้ตั้งแบบการบันทึกงาน แจ้งออฟฟิศให้ตั้งก่อน'
        when 'not_ready' then 'เปิดงานไม่ได้ตอนนี้ — ร้านยังตั้งขั้นตอนการผลิตไม่ครบ แจ้งออฟฟิศ'
        else 'ข้อมูลไม่ถูกต้อง — ตรวจช่องที่กรอกแล้วลองอีกครั้ง' end,
      case when v_code = 'job_exists' and v_dup_no is not null then jsonb_build_object('job_no', v_dup_no) else '{}'::jsonb end);
  end;

  -- 0191: สรุปพลอยของใบที่เพิ่งเปิด (จาก DB) — ไม่มีราคา
  select jsonb_build_object('count', count(*), 'total', coalesce(sum(g.qty_per_piece)::bigint, 0) * coalesce(v_jobrow.qty_planned, 0))
    into v_gem from analytics.job_gem_bom g where g.job_id = v_jobrow.id;
  v_gem := v_gem || jsonb_build_object('state', analytics.job_gem_state(v_shop, v_jobrow.id)) || analytics.job_worker_gem_summary(v_job -> 'gem_summary');
  return jsonb_build_object('ok', true, 'already', false, 'order_no', v_po.po_no, 'job_no', v_jobrow.job_no, 'token', v_tok ->> 'token',
                            'design_label', v_jobrow.design_label, 'sku', v_jobrow.sku_snapshot, 'sku_pending', v_jobrow.product_id is null,
                            'metal', v_jobrow.metal, 'qty_order', v_jobrow.qty_order, 'qty_planned', v_jobrow.qty_planned,
                            'is_new_design', v_new, 'due_date', v_jobrow.due_date, 'status', v_jobrow.status, 'gem', v_gem);
end;
$function$;

-- ============================================================================
-- 3. RPC ใหม่ (security definer · ไม่รับ p_shop_id — ร้านมาจาก token เท่านั้น)
-- ============================================================================

-- ชนิด/รูปทรงที่ใช้ได้ + ขนาดที่เคยใช้ (≤ 6 ต่อ ชนิด×รูปทรง · รวม ≤ 600) + แม่แบบพลอยของ SKU (ถ้าส่ง p_product_id) — 🔴 ไม่มีราคา/ผู้ขาย/ผู้สร้าง/วันที่สร้าง
--   ชนิด/รูปทรงที่ถูกรวมแล้ว/ปิดใช้งาน ไม่อยู่ในรายการ (ใบที่ค้างอ้าง id ที่ถูกรวม resolve ตอนบันทึก) · แม่แบบ: ใช้ id ปลายทาง (canonical) · SKU ไม่ผ่านเงื่อนไขเดียวกับเปิดใบ (ร้านอื่น/ปิดใช้/live*/ไม่พบ) = template null ข้อความเดียวกับ "ไม่มีแม่แบบ"
create or replace function analytics.job_worker_gem_catalog(p_token_hash text, p_session_hash text, p_ip_hash text default null, p_product_id uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a     jsonb;
  v_shop  uuid;
  v_types jsonb;
  v_shapes jsonb;
  v_sizes jsonb;
  v_tpl   jsonb := null;
  v_prod  public.product%rowtype;
begin
  -- 0191 W3: แคตตาล็อกพลอยสำหรับหน้างาน (ไม่มีราคา)
  v_a := analytics.shop_intake_gem_auth(p_token_hash, p_session_hash, p_ip_hash, 'read');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_shop := (v_a ->> 'shop_id')::uuid;
  perform analytics.gem_shape_ensure(v_shop);
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name), '[]'::jsonb) into v_types
    from (select t.id, t.name from analytics.gem_type t where t.shop_id = v_shop and t.is_active and t.merged_into is null order by t.name limit 1000) x;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'has_length', x.has_length) order by x.name), '[]'::jsonb) into v_shapes
    from (select s.id, s.name, s.has_length from analytics.gem_shape s where s.shop_id = v_shop and s.is_active and s.merged_into is null order by s.name limit 300) x;
  select coalesce(jsonb_agg(jsonb_build_object('type_id', y.gem_type_id, 'shape_id', y.gem_shape_id, 'size_a', trim_scale(y.size_a), 'size_b', trim_scale(y.size_b)) order by y.gem_type_id, y.gem_shape_id, y.rn), '[]'::jsonb) into v_sizes
    from (select z.* from (
            select i.gem_type_id, i.gem_shape_id, i.size_a, i.size_b,
                   row_number() over (partition by i.gem_type_id, i.gem_shape_id order by i.created_at desc, i.id) as rn
              from analytics.gem_item i
             where i.shop_id = v_shop and analytics.gem_item_live(i.id)) z
           where z.rn <= 6
           order by z.gem_type_id, z.gem_shape_id, z.rn
           limit 600) y;
  if p_product_id is not null then
    select * into v_prod from public.product p where p.id = p_product_id and p.shop_id = v_shop;
    if found and v_prod.is_active and v_prod.sku !~* '^live' then
      select jsonb_agg(jsonb_build_object(
               'gem_item_id', c.cid, 'label', c.j ->> 'label',
               'type_id', c.j -> 'type_id', 'type_name', c.j -> 'type_name', 'shape_id', c.j -> 'shape_id', 'shape_name', c.j -> 'shape_name', 'has_length', c.j -> 'has_length',
               'size_a', c.j -> 'size_a', 'size_b', c.j -> 'size_b', 'qty_per_piece', c.qty, 'position', c.pos) order by c.seq)
        into v_tpl
        from (select b.line_seq as seq, b.qty_per_piece as qty, b.position_note as pos, analytics.gem_item_canonical(b.gem_item_id) as cid,
                     analytics.gem_item_json(analytics.gem_item_canonical(b.gem_item_id)) as j
                from analytics.product_gem_bom b where b.shop_id = v_shop and b.product_id = p_product_id) c
       where c.j is not null;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'types', v_types, 'shapes', v_shapes, 'sizes', v_sizes,
                            'has_template', v_tpl is not null, 'template', coalesce(v_tpl, '[]'::jsonb), 'max_lines', 30);
end;
$f$;

-- พลอยของใบที่ช่างคนนี้เปิดเอง (W-10) + หน้าต่างแก้ + rev (CAS) — 🔴 ไม่มีราคา · ใบของคนอื่น/ใบออฟฟิศ/ส่วนย่อย/ร้านอื่น = order_not_found (ข้อความเดียวกันทุกกรณี)
--   ยังอ่านได้แม้ถูกล็อก (editable=false + lock_code) · ถูกถอน can_open_job = not_allowed (ไม่เห็นพลอยของใบเก่า)
create or replace function analytics.job_worker_gem_get(p_token_hash text, p_session_hash text, p_job_id uuid, p_ip_hash text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a     jsonb;
  v_shop  uuid;
  v_wid   uuid;
  v_job   uuid;
  v_row   analytics.job%rowtype;
  v_block jsonb;
  v_lines jsonb;
begin
  -- 0191 W3: อ่านพลอยของใบที่ช่างคนนี้เปิดเอง (ไม่มีราคา)
  v_a := analytics.shop_intake_gem_auth(p_token_hash, p_session_hash, p_ip_hash, 'read');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_shop := (v_a ->> 'shop_id')::uuid;
  v_wid := (v_a ->> 'worker_id')::uuid;
  if p_job_id is null then
    return analytics.job_fail('order_not_found', 'ไม่พบใบงานที่เปิดไว้ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  v_job := analytics.job_worker_photo_job(v_shop, v_wid, null, p_job_id);
  if v_job is null then
    return analytics.job_fail('order_not_found', 'ไม่พบใบงานที่เปิดไว้ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  select * into v_row from analytics.job where id = v_job and shop_id = v_shop;
  if not found then
    return analytics.job_fail('order_not_found', 'ไม่พบใบงานที่เปิดไว้ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  v_block := analytics.job_worker_gem_block(v_job);
  select coalesce(jsonb_agg(jsonb_build_object(
           'gem_item_id', g.gem_item_id, 'label', g.gem_label,
           'type_id', x.j -> 'type_id', 'type_name', x.j -> 'type_name', 'shape_id', x.j -> 'shape_id', 'shape_name', x.j -> 'shape_name', 'has_length', x.j -> 'has_length',
           'size_a', x.j -> 'size_a', 'size_b', x.j -> 'size_b',
           'qty_per_piece', g.qty_per_piece, 'qty_total', g.qty_per_piece::bigint * v_row.qty_planned, 'position', g.position_note) order by g.line_seq), '[]'::jsonb)
    into v_lines
    from analytics.job_gem_bom g
    cross join lateral (select coalesce(analytics.gem_item_json(analytics.gem_item_canonical(g.gem_item_id)), '{}'::jsonb) as j) x
   where g.job_id = v_job;
  return jsonb_build_object('ok', true,
    'job', jsonb_build_object('job_id', v_row.id, 'job_no', v_row.job_no, 'design_label', v_row.design_label, 'status', v_row.status, 'qty_planned', v_row.qty_planned),
    'state', analytics.job_gem_state(v_shop, v_job),
    'editable', v_block is null, 'lock_code', v_block ->> 'code',
    'has_gem_stage', exists (select 1 from analytics.job_stage gs join analytics.job gj on gj.id = gs.job_id
                              where (gj.id = v_job or gj.parent_job_id = v_job) and gs.stage_code = 'gem_set' and gs.status <> 'skipped'),
    'rev', analytics.job_gem_rev(v_job), 'lines', v_lines, 'max_lines', 30);
end;
$f$;

-- แก้พลอยทั้งชุดของใบที่ช่างคนนี้เปิดเอง (replace-all · all-or-nothing) — เรียก job_gem_bom_replace_core ด้วย p_worker_id หลังตรวจเงื่อนไขของตัวเองทุกข้อ
-- ด่าน: token ร้าน active + session + can_open_job สด + ถังต่อช่าง → ใบของช่างคนนี้ (ผู้เปิด) + เป็นใบแม่ + ล็อกแถวใบ → job_worker_gem_block (ยกเลิก/ปิด/ช่างรับแล้ว/ไม่ open/ไม่มีขั้นฝัง) → CAS (p_expected_rev) → ตัวดักชื่อคล้าย (force ต่อชื่อ) → core
-- ผิดแถวใด = ไม่เขียนอะไร (core + probe อยู่ใน sub-block เดียว) · คืน {ok, changed, count, lines[], summary, state, rev} — ไม่มีราคา · event bom_change: actor null · worker_id = ช่าง · channel worker_qr (เขียนโดย core)
create or replace function analytics.job_worker_gem_set(p_token_hash text, p_session_hash text, p_job_id uuid, p_lines jsonb, p_expected_rev text, p_force jsonb default null, p_ip_hash text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a      jsonb;
  v_shop   uuid;
  v_wid    uuid;
  v_job    uuid;
  v_row    analytics.job%rowtype;
  v_block  jsonb;
  v_force  boolean;
  v_res    jsonb;
  v_lines  jsonb;
  v_hint   text;
  v_detail text;
  v_gfail  jsonb;
begin
  -- 0191 W3: แก้พลอยทั้งชุดของใบที่ช่างคนนี้เปิดเอง
  v_a := analytics.shop_intake_gem_auth(p_token_hash, p_session_hash, p_ip_hash, 'write');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_shop := (v_a ->> 'shop_id')::uuid;
  v_wid := (v_a ->> 'worker_id')::uuid;
  -- รูปร่างพารามิเตอร์ (ไม่แตะข้อมูล)
  if p_job_id is null then
    return analytics.job_fail('order_not_found', 'ไม่พบใบงานที่เปิดไว้ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    return analytics.job_fail('gem_line_invalid', 'รายการพลอยไม่ถูกต้อง', jsonb_build_object('gem_code', 'lines_invalid', 'gem_row', 0, 'gem_field', 'lines'));
  end if;
  if jsonb_array_length(p_lines) > 30 then
    return analytics.job_fail('gem_line_invalid', 'พลอยต่อใบมีได้ไม่เกิน 30 รายการ', jsonb_build_object('gem_code', 'too_many_lines', 'gem_row', 31, 'gem_field', 'lines'));
  end if;
  if p_expected_rev is null or p_expected_rev !~ '^([0-9a-f]{32}|empty)$' then
    return analytics.job_fail('gem_rev_invalid', 'ข้อมูลพลอยของใบนี้เปลี่ยนไป — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  v_job := analytics.job_worker_photo_job(v_shop, v_wid, null, p_job_id);
  if v_job is null then
    return analytics.job_fail('order_not_found', 'ไม่พบใบงานที่เปิดไว้ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  -- ล็อกแถวใบก่อนตรวจหน้าต่าง/CAS (ข้อ 8 — เหมือนรูป W2) · ใบที่ถูกลบ/ย้ายร้านระหว่างทาง = order_not_found
  select * into v_row from analytics.job where id = v_job and shop_id = v_shop for update;
  if not found then
    return analytics.job_fail('order_not_found', 'ไม่พบใบงานที่เปิดไว้ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  v_block := analytics.job_worker_gem_block(v_job);
  if v_block is not null then
    return v_block;
  end if;
  if analytics.job_gem_rev(v_job) is distinct from p_expected_rev then
    return analytics.job_fail('gem_conflict', 'มีการแก้พลอยของใบนี้ไปแล้ว (อาจจากอีกเครื่อง) — โหลดหน้าใหม่แล้วแก้อีกครั้ง');
  end if;
  begin
    -- allow = รายการที่ใบนี้ถืออยู่แล้ว (ออฟฟิศอาจปิดใช้รายการหลังคัดลอกแม่แบบ — แถวเดิมต้องบันทึกต่อได้เหมือนที่ core ยอม · id ปิดใช้ที่ไม่อยู่ในใบยังตก gem_inactive) (security M2)
    v_force := analytics.job_worker_gem_precheck(v_shop, v_wid, p_lines, p_force, array(select g.gem_item_id from analytics.job_gem_bom g where g.job_id = v_job));
    v_res := analytics.job_gem_bom_replace_core(v_job, p_lines, v_force, null, v_wid, null, 'shopfloor', 'free_before_start');
  exception when sqlstate '22023' then
    get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
    v_gfail := analytics.job_worker_gem_fail(v_hint, v_detail);
    if v_gfail is not null then
      return v_gfail;
    end if;
    if v_hint = 'job_closed' then
      return analytics.job_fail('job_closed', 'ใบนี้ปิดแล้ว — แก้พลอยไม่ได้');
    end if;
    if v_hint in ('job_not_found', 'lot_no_gems') then
      return analytics.job_fail('order_not_found', 'ไม่พบใบงานที่เปิดไว้ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
    end if;
    return analytics.job_fail('invalid_input', 'ข้อมูลพลอยไม่ถูกต้อง — ตรวจแล้วลองอีกครั้ง');
  end;
  select coalesce(jsonb_agg(jsonb_build_object('gem_item_id', g.gem_item_id, 'label', g.gem_label, 'qty_per_piece', g.qty_per_piece,
                                               'qty_total', g.qty_per_piece::bigint * v_row.qty_planned, 'position', g.position_note) order by g.line_seq), '[]'::jsonb)
    into v_lines from analytics.job_gem_bom g where g.job_id = v_job;
  return jsonb_build_object('ok', true, 'changed', coalesce((v_res ->> 'changed')::boolean, false), 'count', jsonb_array_length(v_lines), 'lines', v_lines,
                            'summary', analytics.job_worker_gem_summary(v_res -> 'summary'),
                            'state', analytics.job_gem_state(v_shop, v_job), 'rev', analytics.job_gem_rev(v_job));
end;
$f$;

-- ============================================================================
-- 4. job_worker_my_intake_list — + บรรทัดพลอยของแต่ละใบ (W-9) · ลอก def สดจาก DB 23 ต.ค. 69 แล้วเพิ่มเฉพาะ 4 key ท้ายของแต่ละใบ (gem_*)
--    gem_state = specified | unspecified | not_needed (job_gem_state — นิยามเดียว) · gem_count = จำนวนรายการ · gem_pieces = รวมเม็ดทั้งใบ (จำนวน/ชิ้น × จำนวนที่เริ่มผลิต) · gem_editable = job_worker_gem_block ว่าง (ตัดสินที่เดียวกับ gem_set)
-- ============================================================================
create or replace function analytics.job_worker_my_intake_list(p_token_hash text, p_session_hash text, p_ip_hash text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a    jsonb;
  v_shop uuid;
  v_wid  uuid;
  v_jobs jsonb;
begin
  -- 0191 W3: + บรรทัดพลอยของแต่ละใบ (gem_*)
  v_a := analytics.shop_intake_photo_auth(p_token_hash, p_session_hash, p_ip_hash, 'list');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  if not (v_a ->> 'can_open')::boolean then
    return jsonb_build_object('ok', true, 'open_allowed', false, 'jobs', '[]'::jsonb);
  end if;
  v_shop := (v_a ->> 'shop_id')::uuid;
  v_wid := (v_a ->> 'worker_id')::uuid;
  select coalesce(jsonb_agg(x.o order by x.created_at desc, x.job_id), '[]'::jsonb) into v_jobs
    from (
      select j.id as job_id, j.created_at,
             jsonb_build_object(
               'job_id', j.id, 'order_no', po.po_no, 'job_no', j.job_no, 'design_label', j.design_label, 'metal', j.metal,
               'qty', j.qty_order, 'created_at', j.created_at, 'status', j.status,
               'photos_count', (select count(*) from analytics.job_photo p where p.job_id = j.id and p.deleted_at is null and p.kind = 'reference'),
               'my_photos_count', (select count(*) from analytics.job_photo p where p.job_id = j.id and p.deleted_at is null and p.kind = 'reference' and p.source = 'shopfloor'),
               'editable', analytics.job_worker_photo_block(j.id) is null,
               'gem_state', analytics.job_gem_state(v_shop, j.id),
               'gem_count', (select count(*) from analytics.job_gem_bom g where g.job_id = j.id),
               'gem_pieces', coalesce((select sum(g.qty_per_piece)::bigint from analytics.job_gem_bom g where g.job_id = j.id), 0) * j.qty_planned,
               'gem_editable', analytics.job_worker_gem_block(j.id) is null) as o
        from analytics.production_order po
        join analytics.production_order_item i on i.production_order_id = po.id
        join analytics.job j on j.production_order_item_id = i.id
       where po.shop_id = v_shop and j.shop_id = v_shop
         and po.opened_by_worker_id = v_wid and po.opened_via = 'shopfloor'
         and po.status = 'open'
         and j.parent_job_id is null and j.status not in ('done', 'cancelled')
         and j.created_at >= now() - interval '14 days'
       order by j.created_at desc, j.id
       limit 20) x;
  return jsonb_build_object('ok', true, 'open_allowed', true, 'jobs', v_jobs, 'max_photos', 3);
end;
$f$;

-- ============================================================================
-- 5. สิทธิ์ (ข้อ 2 · 18.1): ถอนทั้ง 4 ชื่อ แล้ว grant เฉพาะ RPC ช่างให้ service_role — helper ไม่ให้ใคร
-- ============================================================================
do $g$
declare
  r record;
  v_touched constant text[] := array[
    'shop_intake_gem_auth', 'job_worker_gem_block', 'job_gem_rev', 'job_worker_gem_precheck', 'job_worker_gem_fail', 'job_worker_gem_summary', 'job_worker_gem_name_cap', 'job_worker_gem_item_cap',
    'job_worker_open', 'job_worker_my_intake_list', 'job_worker_gem_catalog', 'job_worker_gem_get', 'job_worker_gem_set'];
  v_rpc constant text[] := array['job_worker_open', 'job_worker_my_intake_list', 'job_worker_gem_catalog', 'job_worker_gem_get', 'job_worker_gem_set'];
  v_n int;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace and p.proname = any (v_touched)
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname = any (v_rpc) then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
  -- ห้ามมี overload (migration-traps ข้อ 1): ต้องได้ "หนึ่งแถวต่อชื่อ" พอดีทุกชื่อที่ประกาศ
  select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = any (v_touched);
  if v_n <> cardinality(v_touched) then
    raise exception '0191: ฟังก์ชันที่ประกาศ % ตัว แต่พบใน pg_proc % ตัว (overload หลุด?)', cardinality(v_touched), v_n;
  end if;
end;
$g$;

-- ============================================================================
-- 6. post-check: ไม่แตะของเดิมนอกรายการ · ข้อมูลเดิมไม่ขยับ · สิทธิ์
-- ============================================================================
do $c$
declare
  v_changed text;
  v_new text;
  v_touched constant text[] := array['job_worker_open', 'job_worker_my_intake_list'];
  v_added constant text[] := array['shop_intake_gem_auth', 'job_worker_gem_block', 'job_gem_rev', 'job_worker_gem_precheck', 'job_worker_gem_fail', 'job_worker_gem_summary', 'job_worker_gem_name_cap', 'job_worker_gem_item_cap', 'job_worker_gem_catalog', 'job_worker_gem_get', 'job_worker_gem_set'];
begin
  -- (1) ฟังก์ชันเดิมนอกรายการ md5 ต้องเท่าเดิมเป๊ะ (ทุกตัวในสคีมา — รวม job_gem_bom_replace_core · gem_lines_prepare · job_create_* · job_worker_resolve · production_order_done)
  select string_agg(b.sig, ', ') into v_changed
    from _m191_fn_base b
    left join pg_proc p on p.oid = to_regprocedure(b.sig)
   where b.proname <> all (v_touched) and (p.oid is null or md5(pg_get_functiondef(p.oid)) <> b.h);
  if v_changed is not null then
    raise exception '0191 แตะฟังก์ชันเดิมนอกรายการ (md5 ไม่เท่า/หาย): %', v_changed;
  end if;
  -- (2) ฟังก์ชันที่ replace เปลี่ยนจริง (มีเครื่องหมาย 0191) · ฟังก์ชันใหม่ = รายการที่ประกาศเท่านั้น (ไม่มีตัวอื่นโผล่)
  if exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = any (v_touched) and position('0191' in pg_get_functiondef(p.oid)) = 0) then
    raise exception '0191: ฟังก์ชันที่ต้อง replace ยังไม่ใช่ฉบับ 0191';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_new
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
     and not exists (select 1 from _m191_fn_base b where b.sig = p.oid::regprocedure::text)
     and p.proname <> all (v_added || v_touched);
  if v_new is not null then
    raise exception '0191: พบฟังก์ชันใหม่นอกรายการที่ประกาศ: %', v_new;
  end if;
  -- (3) แถวเดิมไม่ขยับ
  select string_agg(b.t, ', ') into v_changed
    from _m191_row_base b
    join (select 'job'::text as t, count(*) as n, coalesce(md5(string_agg(j::text, '|' order by j.id)), '') as h from analytics.job j
          union all select 'job_stage', count(*), coalesce(md5(string_agg(s::text, '|' order by s.id)), '') from analytics.job_stage s
          union all select 'job_event', count(*), coalesce(md5(string_agg(e::text, '|' order by e.id)), '') from analytics.job_event e
          union all select 'job_token', count(*), coalesce(md5(string_agg(k.id::text || coalesce(k.revoked_at::text, ''), '|' order by k.id)), '') from analytics.job_token k
          union all select 'job_counter', count(*), coalesce(md5(string_agg(c::text, '|' order by c::text)), '') from analytics.job_counter c
          union all select 'production_order', count(*), coalesce(md5(string_agg(po::text, '|' order by po.id)), '') from analytics.production_order po
          union all select 'production_order_item', count(*), coalesce(md5(string_agg(pi::text, '|' order by pi.id)), '') from analytics.production_order_item pi
          union all select 'worker', count(*), coalesce(md5(string_agg(w::text, '|' order by w.id)), '') from analytics.worker w
          union all select 'worker_session', count(*), coalesce(md5(string_agg(s::text, '|' order by s.id)), '') from analytics.worker_session s
          union all select 'shop_intake_token', count(*), coalesce(md5(string_agg(t::text, '|' order by t.id)), '') from analytics.shop_intake_token t
          union all select 'gem_type', count(*), coalesce(md5(string_agg(t::text, '|' order by t.id)), '') from analytics.gem_type t
          union all select 'gem_shape', count(*), coalesce(md5(string_agg(s::text, '|' order by s.id)), '') from analytics.gem_shape s
          union all select 'gem_item', count(*), coalesce(md5(string_agg(i::text, '|' order by i.id)), '') from analytics.gem_item i
          union all select 'job_gem_bom', count(*), coalesce(md5(string_agg(b2::text, '|' order by b2.id)), '') from analytics.job_gem_bom b2
          union all select 'product_gem_bom', count(*), coalesce(md5(string_agg(b3::text, '|' order by b3.id)), '') from analytics.product_gem_bom b3) a on a.t = b.t
   where a.n <> b.n or a.h <> b.h;
  if v_changed is not null then
    raise exception '0191: แถวเดิมขยับในตาราง: %', v_changed;
  end if;
  -- (4) สิทธิ์: ไม่มี PUBLIC/anon/authenticated ถือ EXECUTE ฟังก์ชันใดในสคีมา · RPC ช่าง 5 ตัวเป็นของ service_role · helper ไม่เปิดให้ใคร
  select string_agg(p.oid::regprocedure::text, ', ') into v_new
    from pg_proc p cross join lateral aclexplode(p.proacl) a
   where p.pronamespace = 'analytics'::regnamespace and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  if v_new is not null then
    raise exception '0191: พบฟังก์ชันในสคีมา analytics ที่ PUBLIC/anon/authenticated ถือ EXECUTE: %', v_new;
  end if;
  select string_agg(p.proname, ', ') into v_new
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.proname = any (v_added || v_touched)
     and (has_function_privilege('service_role', p.oid, 'execute')) <> (p.proname in ('job_worker_open', 'job_worker_my_intake_list', 'job_worker_gem_catalog', 'job_worker_gem_get', 'job_worker_gem_set'));
  if v_new is not null then
    raise exception '0191: สิทธิ์ service_role ผิด (RPC ช่างต้อง execute ได้ · helper ต้องไม่ได้): %', v_new;
  end if;
  raise notice '0191: ฟังก์ชันเดิม % ตัว md5 เท่าเดิมทั้งหมด (ยกเว้น job_worker_open · job_worker_my_intake_list) · ฟังก์ชันใหม่ % ตัว · แถวเดิมไม่ขยับ',
    (select count(*) from _m191_fn_base) - (select count(*) from _m191_fn_base where proname = any (v_touched)), cardinality(v_added);
end;
$c$;

comment on function analytics.job_worker_open(text, text, text, uuid, text, text, numeric, numeric, integer, integer, date, boolean, text, text, text, jsonb, text, jsonb) is
  '0187 W1 + 0191 W3: เปิดใบผลิต+ใบงาน+QR ทรานแซกชันเดียว · พลอย: p_gem_answer none|has|template|null · p_gem_lines (≤ 30) · p_gem_force [{kind,name}] ต่อชื่อที่ถูกถาม · พลอยผิด = ไม่เปิดทั้งก้อน';
comment on function analytics.job_worker_gem_set(text, text, uuid, jsonb, text, jsonb, text) is
  '0191 W3: ผู้จัดการแก้พลอยทั้งชุดของใบที่ตัวเองเปิดจนช่างเริ่มรับงาน (ล็อกแถวใบ · CAS ด้วย rev · ตัวดักชื่อคล้ายต่อชื่อ) · เรียก job_gem_bom_replace_core ด้วย worker id · ไม่มีราคา';
comment on function analytics.job_worker_gem_get(text, text, uuid, text) is
  '0191 W3: พลอยของใบที่ช่างคนนี้เปิดเอง + หน้าต่างแก้ (editable/lock_code) + rev สำหรับ CAS — ไม่มีราคา';
comment on function analytics.job_worker_gem_catalog(text, text, text, uuid) is
  '0191 W3: ชนิด/รูปทรงที่ใช้ได้ + ขนาดที่เคยใช้ (≤ 6 ต่อคู่) + แม่แบบพลอยของ SKU (ถ้าส่ง p_product_id) — ไม่มีราคา/ผู้ขาย/ผู้สร้าง';
comment on function analytics.job_worker_my_intake_list(text, text, text) is
  '0189 W2 + 0191 W3: "ใบที่ฉันเปิด" บน hub QR ร้าน — เฉพาะใบของช่างใน session ที่ยังไม่ปิด/ยกเลิก (≤ 20 ใบ · 14 วัน) · editable/gem_editable คำนวณที่ DB · gem_state/gem_count/gem_pieces · ไม่คืนเนื้อ/น้ำหนัก/เงิน/ชื่อลูกค้า';

notify pgrst, 'reload schema';

-- 0181_job_lots_l1.sql — L1 ส่วนย่อยในร้าน (ส่งต่อ n จาก N) + ส่วนต่างรอชี้แจง + QR หลายใบไม่เพิกถอน (design-job-lots-shopfloor.md §1–§3 · §9 แถว L1 · §10 · §11.1/§11.4 · §12)
-- ต่อจาก 0172–0178 (apply บน production แล้ว แก้ไฟล์เดิมไม่ได้ · def ต้นทางของทุกฟังก์ชัน/view ที่ replace ลอกจากฉบับล่าสุดบน DB สด ณ 19 ต.ค. 69 ด้วย pg_get_functiondef/pg_get_viewdef และเทียบ md5 ที่ §0)
-- ⚠️ ยังไม่ APPLY — dry-run เท่านั้น (apply หลัง Tech Lead ส่ง "รันได้" + security ผ่าน)
-- 🔴 apply ด้วย node scripts/run-sql.mjs --commit --record เท่านั้น (พึ่งทรานแซกชันที่ runner ครอบทั้งไฟล์: temp table on commit drop) · ห้าม supabase db push · ไฟล์ต้องเป็น LF
--
-- ทำไม: เจ้าของสั่ง "ส่งต่อ n จาก N" (แบ่งงาน 100 ชิ้นไปทีละส่วน) + QR เดียวต่อใบ (ข1) + ไม่ชั่งตอนแบ่ง (ค1) + รับไม่ครบต้องใส่จำนวนจริงแล้วส่วนต่าง "รอชี้แจง" กลับไปขั้นก่อน (Q5)
-- แกนโมเดล = (ก): ส่วน = แถว job ที่มี parent_job_id (ชั้นเดียว ชี้ใบแม่เสมอ) ใช้ RPC/trigger J1 เดิมต่อส่วน · แก้ CHECK/trigger แบบ additive: ใบเดิมทุกใบ split_out = 0 ⇒ นิยามเดิมเป๊ะ
--
-- สิ่งที่ migration นี้ทำ
--  1 คอลัมน์: job (parent_job_id · lot_seq · qty_split_out · cancel_scrap_qty/reason) · job_stage (qty_split_out · split_from_stage_id) · job_token (purpose · lot_job_id) · worker.can_external · ตาราง job_discrepancy
--    CHECK: job_done_ck/js_sent_ck/js_not_sent_ck/js_idle_ck แก้เฉพาะเพิ่ม qty_split_out · unique 3 ตัวของ "1 รายการ = 1 ใบ" เพิ่ม parent_job_id is null · job_event_event_type_ck + split/split_cancel/discrepancy/discrepancy_resolve
--  2 helper: job_live_qty · job_disc_active_qty · job_identity_gap · job_tree_dominant_stage · job_lot_return_blocker · job_scrap_reason_valid
--  3 trigger/guard: job_discrepancy_guard (ใหม่) · job_guard · job_stage_guard · job_stage_sync · job_token_guard · job_stage_state (+ key qty_split_out เฉพาะเมื่อ > 0)
--  4 core: job_core_receive (+p_qty_received · ส่วนต่าง · ขั้นก่อนที่แยกแล้วปิดอัตโนมัติไม่ได้) · job_core_send (ส่งส่วนที่เหลือหลังแยก) · job_lot_split_core · job_lot_cancel_core · job_tree_assert/check
--  5 RPC ออฟฟิศ: job_lot_split · job_lot_cancel · job_discrepancy_resolve/void · job_token_list · job_office_receive(+p_qty_received) · job_token_issue(+purpose/lot) · job_token_revoke(+p_print_no) · job_done · job_cancel · job_stage_reopen · job_office_begin (ล็อกใบแม่ก่อน)
--  6 RPC ช่าง: job_worker_send/receive (พารามิเตอร์ใหม่ต่อท้าย default null) · job_worker_discrepancy_resolve · job_worker_lot_cancel · job_worker_resolve (+parts/my_actions/'multi')
--  7 views: v_job_board (+6 คอลัมน์ท้าย) · v_job_stage_loss (+not_comparable) · v_job_stage_from_events · v_production_order_job_mismatch · v_job_tree · v_job_tree_summary · v_job_tree_drift
--  8 สิทธิ์ service_role เท่านั้น (ข้อ 18) · RLS เปิดไม่มี policy · post-check: md5 ฟังก์ชันอื่นไม่ขยับ · updated_at ไม่ขยับ · trigger เปิดครบ · ไม่มี overload
--
-- ตัดสินเอง (นอก design/brief — เหตุผล)
--  (1) ลายเซ็น RPC ช่างต่างจากร่าง design: พารามิเตอร์ใหม่ (p_lot_job_id/p_qty_send/p_qty_hold · p_qty_received) "ต่อท้าย + default null" ไม่แทรกกลาง — เหตุผล: PostgREST ใช้ชื่ออาร์กิวเมนต์ ลำดับไม่มีผล · caller TS เดิม (lib/jobs/worker-server.ts) ที่ส่ง named args ยังเรียกได้โดยไม่พัง
--      ระหว่าง apply กับ deploy โค้ดใหม่ · ร่างต้องการ p_lot_job_id ไม่มี default ซึ่งทำให้ drop sig เดิมแล้ว caller เดิมพังทันที
--  (2) แยกส่วนอ้างขั้นด้วย (job, expected_seq) แบบเดียวกับ job_core_send (ไม่ใช่ p_from_stage_id ตามร่าง) — ใช้ stale-detection ชุดเดียวกับ J1 · ออฟฟิศ: job_lot_split(p_job_id = ใบที่ถือขั้นนั้น แม่หรือส่วน)
--  (3) ส่งไม่ครบจากหน้าช่างต้องส่ง p_qty_hold (จำนวนที่ถืออยู่ที่เห็นบนจอ) — ไม่ตรง = stage_changed: นี่คือกลไกของเคส "2 มือถือแยกส่วนเดียวพร้อมกัน/กดซ้ำ" (design §10 ข้อ 5 ที่ตัวหลังต้องได้ stage_changed) · ช่อง worker_qr ไม่ส่ง = qty_hold_required · ออฟฟิศไม่บังคับ
--  (4) ของเสียของขั้นมีเหตุผลเดียว: ของเสียที่บันทึกตอนแยก + ตอนส่งส่วนที่เหลือ ต่างเหตุผลกัน = เก็บ 'other' (เหตุผลแต่ละครั้งอยู่ใน event scrap/split) — design ไม่ได้ระบุกรณีบันทึกของเสียหลายครั้งในขั้นเดียว
--  (5) job_discrepancy.void: = แถวใหม่ status 'void' ชี้แถวเดิม (ไม่ UPDATE แถวเดิม) · ทำได้เมื่อขั้นผู้รับ (to_stage) ถูกย้อนเป็น pending แล้วเท่านั้น (ไม่งั้นจำนวนที่ผู้รับรับไปจะขัดกับโซ่) · ชิ้นกลับเข้าโซ่ทางเดียว = ผู้รับรับใหม่ด้วยจำนวนเต็ม — ไม่มีทาง "เพิ่มของเข้าโซ่" โดยไม่ผ่านออฟฟิศ
--      (design เขียนแค่ "void ด้วยแถวใหม่" — ผมเลือกนิยามนี้เพราะเป็นอันเดียวที่ผลรวมต้นไม้ยังตรง)
--  (6) ช่างยกเลิกส่วน (return_to_parent) ไม่ได้เมื่อการคืนจะเหลือขั้นแม่ split_out = 0 แต่มีของเสียที่บันทึกตอนแยกค้าง (ผิด js_not_sent_ck) — ตอบ scrap_recorded ให้ออฟฟิศเลือก "ยกเลิกเป็นของเสีย" (scrap) แทน
--  (7) [แก้ตาม security H1] รับไม่ครบ (m < n): เทียบน้ำหนักทุกครั้งที่ทั้งสองขั้นชั่ง — ทองรับครบ |gap| > 0.05 g = ปฏิเสธ (เดิมเป๊ะ) · ทองรับไม่ครบที่ "หนักกว่า" ที่ขั้นก่อนส่ง (gap > +0.05) = ปฏิเสธ · gap บันทึกลง job_discrepancy.weight_gap_g (ออฟฟิศเห็น)
--      ผู้ส่งชี้แจงส่วนต่างงานทองที่มี weight_gap_g เองไม่ได้ (office_required — ออฟฟิศเท่านั้น) · v_job_stage_loss ต่อท้าย handoff_gap_partial_g + v_job_board แสดง (แทน null เงียบ) · response ช่างยังไม่เห็น gap (N1)
--      [M1] รับไม่ครบขณะขั้นก่อนยังไม่ส่ง = prev_not_sent (ไม่ปิดขั้นก่อนอัตโนมัติด้วยจำนวนเต็มแล้วโยนความผิดให้ผู้ส่ง)
--  (13) [security H2 · มติเจ้าของ 19 ต.ค. "ทองชั่งตอนแบ่ง"] เฉพาะ metal='gold' และขั้นที่แยกตั้ง weigh_required: การแยก (ช่าง + ออฟฟิศ) ต้องส่ง p_weight_move_g (น้ำหนักส่วนที่แยกออก > 0 · ≤ 3 ทศนิยม · ต้องเหลือให้ผู้ถือ) —
--      ขั้นแยกของส่วนใหม่เก็บเป็น weight_in = weight_out = น้ำหนักนั้น (weigh_required) ⇒ ผู้รับขั้นถัดไปชั่งเทียบ ±0.05 g เหมือนส่งต่อปกติ · ขั้นแม่เก็บ weight_split_out_g (= Σ น้ำหนักของส่วน — guard บังคับ) ·
--      ส่งต่อส่วนที่เหลือ: น้ำหนักออก ≤ เข้า + เติม − น้ำหนักที่แยกไป · loss ของขั้นที่แยกหักน้ำหนักที่แยกไป (ไม่ null สำหรับทอง) · เงิน/ขั้นไม่ชั่ง = นับจำนวนอย่างเดียว (ค1) — ส่งน้ำหนักมา = weight_unexpected
--  (14) [M3] v_production_order_job_mismatch เทียบกับยอดดีทั้งต้นไม้ · [L4] job_lot_split ออฟฟิศต้องส่ง p_qty_hold ด้วย (บังคับทุกช่องทาง)
--  (15) [L7] post-check §9 (4) raise ถ้ามีส่วนย่อย/ขั้นที่แยกอยู่แล้ว = รันไฟล์นี้ซ้ำ "หลังเริ่มใช้งานจริง" ไม่ได้ (ตั้งใจ — ตรวจว่า apply ครั้งแรกบนข้อมูลที่ยังไม่มีส่วน) · รันซ้ำก่อนมีส่วนได้ (idempotent)
--  (16) [security re-review M-A] v_job_board ต่อท้าย tree_handoff_gap_g · tree_handoff_gap_partial_g · tree_handoff_mismatch_count (ใบแม่ + ส่วนที่ parent = ใบนั้น — handoff_* เดิมนับเฉพาะใบตัวเอง จึงมองไม่เห็นขั้นแรกของส่วนย่อย) · view ใหม่ v_job_tree_stage_loss (v_job_stage_loss ทั้งต้นไม้)
--  (17) [M-B] job_discrepancy.weight_sent_g/qty_sent = snapshot ตอนรับไม่ครบที่มีน้ำหนักเทียบ · analytics.job_disc_excess_g = gap + sent × qty/qty_sent (ลบ = โลหะหายเกินสัดส่วนชิ้น) · v_job_discrepancy + board.tree_weight_gap_excess_g ·
--       ออฟฟิศ resolve ทองที่ excess < -0.05 g ต้องเขียนคำอธิบายเป็นข้อความ (ไม่ใช่รหัสเหตุผลล้วน) = note_required
--  (18) [M-C] job_lot_cancel(+p_scrap_weight_g): ทอง + ส่วนมีขั้นชั่ง + นับเป็นของเสีย = scrap_weight_required · เก็บ job.cancel_scrap_weight_g · v_job_tree(+) / v_job_tree_summary.weight_scrap_cancel_g · drift 'cancel_weight'
--  (19) [L-2] ทอง + ช่างรับไม่ครบผ่าน QR ที่ชั่งไม่ผ่านครบ 3 ครั้งบนขั้นเดียวกัน = ครั้งที่ 3 ตอบ office_required และล็อกขั้นจนออฟฟิศรับแทน (event handoff_mismatch payload.partial = true) · ไม่กระทบเงิน/รับครบ/ออฟฟิศ
--  (20) แยกส่วน: น้ำหนักส่วนที่แยกเกินที่ถืออยู่ใช้รหัส weight_move_over (เดิม weight_over ซึ่งข้อความพูดเรื่อง "น้ำหนักออก/เติมโลหะ" ผิดบริบทฝั่งช่าง) · weight_over ยังใช้กับขั้นส่งต่อ/ของเสียที่เลิกใช้
--  (21) [L-1] board.tree_lot_first_gap_sum_g = ค่าต่ำสุดของผลรวม gap ขั้นแรกของทุกส่วนที่แยกจากขั้นเดียวกัน (ลบเกิน 0.05 = เตือนว่าหลายส่วนหายสะสม) · เป็นเพียงตัวเลขให้ UI เตือน ไม่บล็อก
--       หนี้ที่รู้: (a) ปลดล็อก L-2 = ออฟฟิศรับแทนเท่านั้น ไม่มีปุ่ม "ให้ช่างลองใหม่" (b) basis ของ weight_over ตอนยกเลิกส่วนเป็นของเสีย = น้ำหนักสูงสุดที่ส่วนนั้นเคยมี ไม่ใช่น้ำหนักปัจจุบันที่แม่นยำ
--  (8) can_external: เพิ่มคอลัมน์ worker.can_external (default false) ใน L1 เพราะ RPC ชี้แจงของ design ใช้สิทธิ์นี้ — ยังไม่มี UI/RPC ตั้งค่า (L2) · ไม่มีใครถือสิทธิ์นี้ตอน apply
--  (9) token_cap คง 5 (มติ Q8 18 ต.ค.) · job_token_issue ค่าเริ่ม p_revoke_previous = null ⇒ traveler ของใบที่ไม่มีส่วน = เพิกถอนของเก่า (เหมือน J1) · ใบที่มีส่วน/ใบย่อย/ใบส่งของ = ไม่เพิกถอน · ค่าที่ส่งมาชัดเจนชนะเสมอ
--      (TS ปัจจุบัน lib/actions/job-office-write.ts ส่ง boolean ชัดเจนเสมอ ⇒ พฤติกรรมเดิมไม่เปลี่ยนจนกว่า UI จะส่ง null)
--  (10) ไม่ทำใน L1 (ตามขอบเขต): contractor_id/ขั้นนอกร้าน/scrap code ของผู้รับจ้าง (L2) · production_receipt/stock_in/job_tree_close/close_state/shortfall_reason/tree_closed_by (L3) · intake/can_open_job (W1) · surplus ระดับต้นไม้ (surplus_* คิดเฉพาะใบแม่ตาม design §3)
--  (11) job.seq ของส่วนย่อยกินตัวนับร้านเหมือนใบทั่วไป (job_no ข้าม — ตามหนี้ที่ design §12 จดไว้) · label บนจอ = "JB-xxxx · ส่วนที่ n" ของใบแม่
--  (12) job_tree_assert/check เรียกเฉพาะต้นไม้ที่มีส่วนย่อย/แยก/ส่วนต่าง (ใบเดิมทุกใบข้ามทันที) — พฤติกรรม J1 ไม่ถูกตรวจเพิ่มจึงไม่พังจากข้อมูลเดิมที่อาจไม่ตรงนิยามใหม่
--
-- ไม่มีราคา/ต้นทุน/ชื่อลูกค้า/เลขเอกสารภาษีใน object ใดของไฟล์นี้ · ไม่แตะ production_order_done / stock_lot / oem_* (assert md5 ท้ายไฟล์)

-- baseline ก่อนแตะ: ฟังก์ชันทุกตัวในสคีมา (md5) + ตัวชี้วัด updated_at ของ job/job_stage/job_record_profile/worker
create temp table _j181_fn_base on commit drop as
select p.oid::regprocedure::text as sig, p.proname, md5(pg_get_functiondef(p.oid)) as h
from pg_proc p
where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f';

create temp table _j181_row_base on commit drop as
select 'job'::text as t, count(*) as n, count(distinct updated_at) as nd, coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') as h from analytics.job
union all
select 'job_stage', count(*), count(distinct updated_at), coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') from analytics.job_stage
union all
select 'job_record_profile', count(*), count(distinct updated_at), coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') from analytics.job_record_profile
union all
select 'worker', count(*), count(distinct updated_at), coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') from analytics.worker;

-- ============================================================================
-- 0. pre-check
-- ============================================================================
do $p$
declare
  r record;
  v_n int;
  v_h text;
  v_def text;
begin
  -- ไฟล์นี้พึ่งทรานแซกชันที่ runner ครอบทั้งไฟล์ (temp table on commit drop) — รันแบบ autocommit ตารางหายทันที ⇒ บรรทัดนี้ล้มก่อน DDL ใดๆ
  perform 1 from pg_temp._j181_fn_base limit 1;
  if to_regprocedure('analytics.job_rate_pct(uuid,text,text,date)') is null or to_regclass('analytics.job_record_profile') is null then
    raise exception '0181: ยังไม่พบ 0176/0177 (job_record_profile / job_rate_pct) — apply ก่อน';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'analytics' and table_name = 'job' and column_name = 'qty_order') is not true then
    raise exception '0181: ไม่พบ job.qty_order (0175) — apply 0175-0178 ก่อน';
  end if;

  -- md5: ฟังก์ชันที่ replace ต้องเป็นฉบับที่ apply จริง (md5 จาก pg_get_functiondef บน DB สด 19 ต.ค. 69) หรือฉบับ 0181 (รันซ้ำ — def มีเครื่องหมาย 0181 ในตัวฟังก์ชัน)
  for r in
    select * from (values
      ('job_cancel',            '7e2c6e43420d4719d045fa525716a3ef'),
      ('job_core_receive',      'a7a6fd32fcb7be3a4cdec82016665da2'),
      ('job_core_send',         '7ba90dd8cee307928f7aebd6ada94b95'),
      ('job_done',              '9724f6e02da5ad57d83e838475e449f6'),
      ('job_guard',             'f12fffe81780e44d01c3f7d58350eafb'),
      ('job_office_begin',      '6d9f8e37fc3eb6495965a95cec8ae58c'),
      ('job_office_receive',    'c7c9c56f08ec28f8d496cd62ff60c0ce'),
      ('job_source_info',       'a1a9b438b5dda3d21709f200f86beca9'),
      ('job_stage_guard',       '0e10b2b1b97742a3abbb5030c8fd0288'),
      ('job_stage_reopen',      '489a0fa98f766294378a4ecb378a7677'),
      ('job_stage_state',       'f69a871667942bd82243f9a29a30c7c9'),
      ('job_stage_sync',        '041e0b6931544123d4ce142958e9f9ae'),
      ('job_token_guard',       '8ec906de2388efad32bf29a69650ff8d'),
      ('job_token_issue',       '5eab784b14a58f8fb9921372ba3205a0'),
      ('job_token_revoke',      '76cc5696e760e7837bfef9ce0711e822'),
      ('job_worker_receive',    '09b92a90956d640574583f2177a4c4cc'),
      ('job_worker_resolve',    '6b31116d1d143b968b7627de3044eeb5'),
      ('job_worker_send',       'd2c77f031fe7c63d520e3b09e1b9190c')
    ) as v(n, h_old)
  loop
    select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = r.n;
    if v_n <> 1 then
      raise exception '0181: % มี % signature (ต้องมี 1) — หยุดตรวจ overload ก่อน', r.n, v_n;
    end if;
    select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = r.n;
    v_h := md5(v_def);
    if v_h <> r.h_old and position('0181' in v_def) = 0 then
      raise exception '0181: def ของ % บน DB ไม่ใช่ฉบับที่ลอกมา (md5 % ≠ %) และไม่ใช่ฉบับ 0181 — มีคนแก้นอก migration · หยุด ห้าม replace ทับ', r.n, v_h, r.h_old;
    end if;
  end loop;

  -- view ที่ replace: md5 ของ pg_get_viewdef = ฉบับที่ apply จริง หรือมีคอลัมน์ของ 0181 แล้ว (รันซ้ำ)
  for r in
    select * from (values
      ('v_job_board',                    '99140bb35925b537b3aac274befe6e5e', 'parent_job_id'),
      ('v_job_stage_from_events',        'c80d0f628389479c2095a676ce949245', 'split_cancel'),
      ('v_job_stage_loss',               'fe0ae51e079e0204734b6c88cc7df5fb', 'not_comparable'),
      ('v_production_order_job_mismatch','9207d0ce03d3944dafa6981a44b693b3', 'parent_job_id')
    ) as v(n, h_old, marker)
  loop
    select pg_get_viewdef(c.oid) into v_def from pg_class c where c.relnamespace = 'analytics'::regnamespace and c.relname = r.n and c.relkind = 'v';
    if v_def is null then
      raise exception '0181: ไม่พบ view % — apply 0172-0178 ก่อน', r.n;
    end if;
    if md5(v_def) <> r.h_old and position(r.marker in v_def) = 0 then
      raise exception '0181: def ของ view % บน DB ไม่ใช่ฉบับที่ลอกมา (md5 % ≠ %) — มีคนแก้นอก migration · หยุด', r.n, md5(v_def), r.h_old;
    end if;
  end loop;

  -- ใบเดิมต้องไม่มีร่องรอยของโมเดลใหม่ (รันครั้งแรก) — ถ้ามีคอลัมน์แล้ว = รันซ้ำ ต้องไม่มีส่วนย่อยที่ขัดกับ unique ใหม่
  raise notice '0181: ใบงานเดิม % ใบ · ขั้นเดิม % ขั้น (ไม่มีการ UPDATE แถวเดิม — default ของคอลัมน์ใหม่ไม่ยิง trigger)',
    (select count(*) from analytics.job), (select count(*) from analytics.job_stage);
end;
$p$;
-- ============================================================================
-- 1. โครงสร้าง: คอลัมน์ใหม่ (add column ... default = ไม่ยิง trigger · ไม่ UPDATE แถวเดิม — ข้อ 19) · CHECK/index ที่แก้แบบ additive (ใบเดิม split_out = 0 ⇒ นิยามเดิมเป๊ะ)
-- ============================================================================

-- 1.1 job: ส่วนย่อย = แถว job ที่มี parent_job_id (ชั้นเดียว ชี้ใบแม่เสมอ) · lot_seq รันไม่ใช้ซ้ำ · qty_split_out = Σ ของขั้น (เขียนผ่าน job_stage_sync เท่านั้น — job_guard บังคับเท่ากับ Σ)
alter table analytics.job
  add column if not exists parent_job_id       uuid,
  add column if not exists lot_seq             integer not null default 0,
  add column if not exists qty_split_out       integer not null default 0,
  add column if not exists cancel_scrap_qty    integer,
  add column if not exists cancel_scrap_reason text,
  -- M-C (security): น้ำหนักเศษของส่วนทองที่ยกเลิกเป็นของเสีย (ขั้นตั้งชั่ง) — ไม่ให้ทองหายไปกับ "ของเสีย" โดยไม่มีน้ำหนัก
  add column if not exists cancel_scrap_weight_g numeric(10,3);

do $ddl$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'analytics.job'::regclass and conname = 'job_parent_fk') then
    alter table analytics.job add constraint job_parent_fk
      foreign key (parent_job_id, shop_id) references analytics.job (id, shop_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'analytics.job'::regclass and conname = 'job_parent_self_ck') then
    alter table analytics.job add constraint job_parent_self_ck check (parent_job_id is distinct from id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'analytics.job'::regclass and conname = 'job_lot_seq_ck') then
    alter table analytics.job add constraint job_lot_seq_ck check ((parent_job_id is null) = (lot_seq = 0) and lot_seq between 0 and 1000);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'analytics.job'::regclass and conname = 'job_split_out_ck') then
    alter table analytics.job add constraint job_split_out_ck check (qty_split_out between 0 and 100000);
  end if;
  -- cancel_scrap_*: เฉพาะส่วนย่อยที่ยกเลิกแบบ scrap (cancel_scrap_qty null ที่ cancelled = ยกเลิกแบบคืนชิ้นให้ใบแม่) — qty อาจเป็น 0 (ไม่มีชิ้น live ตอนยกเลิก) แต่เหตุผลต้องมีเสมอ
  if not exists (select 1 from pg_constraint where conrelid = 'analytics.job'::regclass and conname = 'job_cancel_scrap_ck') then
    alter table analytics.job add constraint job_cancel_scrap_ck check (
      (cancel_scrap_qty is null and cancel_scrap_reason is null)
      or (status = 'cancelled' and parent_job_id is not null and cancel_scrap_qty between 0 and 100000
          and cancel_scrap_reason is not null and length(cancel_scrap_reason) <= 200 and analytics.oem_note_valid(cancel_scrap_reason)));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'analytics.job'::regclass and conname = 'job_cancel_scrap_w_ck') then
    alter table analytics.job add constraint job_cancel_scrap_w_ck check (
      cancel_scrap_weight_g is null or (cancel_scrap_qty is not null and cancel_scrap_weight_g > 0 and cancel_scrap_weight_g <= 100000));
  end if;
end;
$ddl$;

-- job_done_ck: ดี + เสีย + แยกออก = เริ่มผลิต (แถวเดิม qty_split_out = 0 ⇒ นิยามเดิมเป๊ะ)
alter table analytics.job drop constraint if exists job_done_ck;
alter table analytics.job add constraint job_done_ck check (
  status <> 'done'
  or (done_at is not null and qty_good is not null and qty_scrap is not null
      and (qty_good + qty_scrap + qty_split_out) = qty_planned
      and (metal <> 'gold' or not weigh_required or weight_final_g is not null)
      and (not require_final_weight or weight_final_g is not null)));

-- 1 item = 1 ใบแม่: unique เดิม 3 ตัวเพิ่ม parent_job_id is null (ส่วนย่อยคัดลอก source จากแม่ ต้องไม่ชน) — ไม่มี ON CONFLICT ที่อ้าง index เหล่านี้ (ตรวจแล้ว: ไม่มีฟังก์ชันใน analytics อ้าง)
drop index if exists analytics.uq_job_production_item;
create unique index uq_job_production_item on analytics.job (production_order_item_id)
  where status <> 'cancelled' and production_order_item_id is not null and parent_job_id is null;
drop index if exists analytics.uq_job_oem_item;
create unique index uq_job_oem_item on analytics.job (oem_quote_item_id)
  where status <> 'cancelled' and oem_quote_item_id is not null and parent_job_id is null;
drop index if exists analytics.uq_job_oem_deal_seq;
create unique index uq_job_oem_deal_seq on analytics.job (root_quote_id, oem_item_seq)
  where status <> 'cancelled' and root_quote_id is not null and parent_job_id is null;
create unique index if not exists uq_job_lot_seq on analytics.job (parent_job_id, lot_seq) where parent_job_id is not null;
create index if not exists idx_job_parent on analytics.job (parent_job_id) where parent_job_id is not null;

-- 1.2 job_stage
alter table analytics.job_stage
  add column if not exists qty_split_out       integer not null default 0,
  add column if not exists split_from_stage_id uuid,
  -- H2 (security · มติ 19 ต.ค.): ทองที่ขั้นชั่ง — น้ำหนักรวมของส่วนที่แยกออกจากขั้นนี้ (= Σ weight_out_g ของขั้นแยกของส่วนที่ชี้ขั้นนี้) · เงิน/ขั้นไม่ชั่ง = 0
  add column if not exists weight_split_out_g  numeric(10,3) not null default 0;

do $ddl$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'analytics.job_stage'::regclass and conname = 'js_split_from_fk') then
    alter table analytics.job_stage add constraint js_split_from_fk foreign key (split_from_stage_id) references analytics.job_stage (id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'analytics.job_stage'::regclass and conname = 'js_split_qty_ck') then
    alter table analytics.job_stage add constraint js_split_qty_ck
      check (qty_split_out between 0 and 100000 and split_from_stage_id is distinct from id and (not auto_closed or qty_split_out = 0));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'analytics.job_stage'::regclass and conname = 'js_split_weight_ck') then
    alter table analytics.job_stage add constraint js_split_weight_ck check (
      weight_split_out_g between 0 and 100000
      and (weight_split_out_g = 0 or (status in ('received', 'sent') and qty_split_out > 0 and weight_in_g is not null and weight_split_out_g < weight_in_g + metal_added_g))
      and (weight_out_g is null or weight_out_g + weight_split_out_g <= weight_in_g + metal_added_g));
  end if;
end;
$ddl$;
create index if not exists idx_job_stage_split_from on analytics.job_stage (split_from_stage_id) where split_from_stage_id is not null;

-- โซ่จำนวน: ออก + เสีย + แยกออก = เข้า · ของเสียก่อนส่งครั้งสุดท้ายได้เฉพาะขั้นที่เคยแยก (qty_split_out > 0) · pending/skipped ต้อง split_out = 0
alter table analytics.job_stage drop constraint if exists js_sent_ck;
alter table analytics.job_stage add constraint js_sent_ck check (
  status <> 'sent'
  or (sent_on is not null and sent_on >= received_on and qty_out is not null and (qty_out + qty_scrap + qty_split_out) = qty_in));
alter table analytics.job_stage drop constraint if exists js_not_sent_ck;
alter table analytics.job_stage add constraint js_not_sent_ck check (
  status = 'sent'
  or (sent_on is null and qty_out is null and weight_out_g is null
      and ((qty_scrap = 0 and scrap_reason is null) or qty_split_out > 0)
      and scrap_weight_g is null and metal_added_g = 0 and weight_note is null and not auto_closed));
alter table analytics.job_stage drop constraint if exists js_idle_ck;
alter table analytics.job_stage add constraint js_idle_ck check (
  status in ('received', 'sent')
  or (received_on is null and sent_on is null and worker_id is null and assignee_name is null and weight_in_g is null and weight_out_g is null
      and qty_in is null and qty_out is null and qty_scrap = 0 and scrap_reason is null and metal_added_g = 0 and scrap_weight_g is null
      and weight_note is null and not auto_closed and qty_split_out = 0));

-- 1.3 job_event: ชนิดเหตุการณ์ใหม่ของ L1
alter table analytics.job_event drop constraint if exists job_event_event_type_ck;
alter table analytics.job_event add constraint job_event_event_type_ck check (event_type = any (array[
  'create', 'stage_receive', 'stage_send', 'stage_skip', 'stage_reopen', 'weigh', 'scrap', 'batch_join', 'batch_leave', 'due_set', 'hold', 'resume',
  'photo_add', 'note', 'done', 'cancel', 'token_issue', 'token_revoke', 'plan_change', 'surplus_set', 'profile_set',
  'split', 'split_cancel', 'discrepancy', 'discrepancy_resolve']));

-- 1.4 job_token: purpose + lot_job_id เป็น "ป้าย" (ไม่ใช่ตัวจำกัดสิทธิ์ — token ใดก็เปิดทั้งใบ · ช่างถูกแยกส่วนจากตัวช่างที่ PIN)
alter table analytics.job_token
  add column if not exists purpose text not null default 'traveler',
  add column if not exists lot_job_id uuid;
do $ddl$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'analytics.job_token'::regclass and conname = 'job_token_purpose_ck') then
    alter table analytics.job_token add constraint job_token_purpose_ck
      check (purpose in ('traveler', 'sublot', 'delivery_note') and (purpose <> 'sublot' or lot_job_id is not null));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'analytics.job_token'::regclass and conname = 'job_token_lot_fk') then
    alter table analytics.job_token add constraint job_token_lot_fk
      foreign key (lot_job_id, shop_id) references analytics.job (id, shop_id) on delete restrict;
  end if;
end;
$ddl$;

-- 1.5 worker: สิทธิ์ "ดูแลงานนอกร้าน" (มติ Q3) — L1 ใช้เพื่อชี้แจงส่วนต่างแทนผู้ส่งเท่านั้น · ยังไม่มี UI ตั้งค่า (default false) · L2 ต่อยอด (ส่งออก/รับกลับ/ยกเลิกส่งออก)
alter table analytics.worker add column if not exists can_external boolean not null default false;

-- 1.6 job_discrepancy: ส่วนต่างรอชี้แจง (มติ Q5) — append-only · open→resolved ครั้งเดียว · void = แถวใหม่ชี้แถวเดิม (ไม่ UPDATE แถวเดิม)
create table if not exists analytics.job_discrepancy (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references public.shop (id) on delete restrict,
  root_job_id        uuid not null,
  job_id             uuid not null,
  from_stage_id      uuid not null,
  to_stage_id        uuid not null,
  qty                integer not null,
  status             text not null default 'open',
  resolved_kind      text,
  resolved_reason    text,
  resolved_by_worker uuid,
  resolved_by_actor  uuid,
  resolved_at        timestamptz,
  void_of_id         uuid references analytics.job_discrepancy (id) on delete restrict,
  void_reason        text,
  -- H1 (security): ส่วนต่างน้ำหนัก (น้ำหนักที่รับ − น้ำหนักที่ขั้นก่อนส่งออก) ตอนรับไม่ครบ · เห็นเฉพาะออฟฟิศ · null = ไม่มีน้ำหนักให้เทียบ
  weight_gap_g       numeric(10,3),
  -- M-B (security): snapshot น้ำหนัก/จำนวนที่ขั้นก่อนส่งตอนรับไม่ครบที่มีการชั่ง — ใช้คำนวณ weight_gap_excess_g (เนื้อโลหะที่หายเกินสัดส่วนชิ้นที่หาย)
  weight_sent_g      numeric(10,3),
  qty_sent           integer,
  created_by_worker  uuid,
  created_by_actor   uuid,
  created_at         timestamptz not null default clock_timestamp(),
  constraint jd_qty_ck check (qty between 1 and 100000),
  constraint jd_gap_ck check (weight_gap_g is null or abs(weight_gap_g) <= 100000),
  constraint jd_sent_ck check ((weight_gap_g is null) = (weight_sent_g is null) and (weight_sent_g is null) = (qty_sent is null)
                               and (weight_sent_g is null or (weight_sent_g > 0 and weight_sent_g <= 100000 and qty_sent > qty))),
  constraint jd_status_ck check (status in ('open', 'resolved', 'void')),
  constraint jd_kind_ck check (resolved_kind is null or resolved_kind in ('scrap', 'lost')),
  constraint jd_resolved_ck check (
    ((status = 'resolved') = (resolved_kind is not null))
    and ((status = 'resolved') = (resolved_reason is not null))
    and ((status = 'resolved') = (resolved_at is not null))
    and (status <> 'resolved' or resolved_by_worker is not null or resolved_by_actor is not null)
    and (resolved_reason is null or (length(resolved_reason) <= 200 and analytics.oem_note_valid(resolved_reason)))),
  constraint jd_void_ck check (
    ((status = 'void') = (void_of_id is not null))
    and ((status = 'void') = (void_reason is not null))
    and (void_reason is null or (length(void_reason) <= 200 and analytics.oem_note_present(void_reason) and analytics.oem_note_valid(void_reason)))),
  constraint jd_who_ck check (created_by_worker is not null or created_by_actor is not null),
  constraint jd_root_fk foreign key (root_job_id, shop_id) references analytics.job (id, shop_id) on delete restrict,
  constraint jd_job_fk foreign key (job_id, shop_id) references analytics.job (id, shop_id) on delete restrict,
  constraint jd_from_fk foreign key (from_stage_id, job_id) references analytics.job_stage (id, job_id) on delete restrict,
  constraint jd_to_fk foreign key (to_stage_id, job_id) references analytics.job_stage (id, job_id) on delete restrict,
  constraint jd_rw_fk foreign key (resolved_by_worker, shop_id) references analytics.worker (id, shop_id) on delete restrict,
  constraint jd_cw_fk foreign key (created_by_worker, shop_id) references analytics.worker (id, shop_id) on delete restrict
);
create unique index if not exists uq_job_discrepancy_void on analytics.job_discrepancy (void_of_id) where void_of_id is not null;
create index if not exists idx_job_discrepancy_root on analytics.job_discrepancy (root_job_id);
create index if not exists idx_job_discrepancy_job on analytics.job_discrepancy (job_id);
create index if not exists idx_job_discrepancy_from on analytics.job_discrepancy (from_stage_id);
create index if not exists idx_job_discrepancy_to on analytics.job_discrepancy (to_stage_id);
alter table analytics.job_discrepancy enable row level security;

comment on table analytics.job_discrepancy is
  '0181: ส่วนต่างตอนรับของไม่ครบ (n − m) รอผู้ส่งชี้แจง scrap/lost · ไม่ใช่ส่วนใหม่ (ไม่มีใครถือ) · append-only: open→resolved ครั้งเดียว · void = แถวใหม่ชี้แถวเดิม (ใช้ได้เมื่อขั้นผู้รับถูกย้อนเป็น pending) · ห้าม DELETE';
-- ============================================================================
-- 2. helper (อ่านอย่างเดียว) — นิยามเดียวใช้ร่วมกันทั้ง trigger/RPC/view: "ชิ้นที่เป็นของจริงตอนนี้" ของใบ + ส่วนต่างที่ยังนับ + ด่านระดับต้นไม้
-- ============================================================================
create or replace function analytics.job_scrap_reason_valid(p_val text)
 returns boolean
 language sql
 immutable
 set search_path to 'pg_catalog', 'analytics', 'pg_temp'
as $f$
  -- 0181: เหตุผลของเสีย/ชี้แจงส่วนต่าง = ชุดเดียวกับ job_core_send (code 5 ตัว หรือข้อความที่ผ่าน whitelist ≤ 200 ไม่มี LF/CR/tab)
  select p_val is not null and (
    p_val = any (array['porosity', 'broken', 'wrong_design', 'missing', 'other'])
    or (analytics.oem_note_present(p_val) and analytics.oem_note_valid(p_val) and length(p_val) <= 200 and p_val !~ '[\r\n\t]'))
$f$;

-- ส่วนต่างที่ยังนับอยู่ (open/resolved ที่ไม่ถูก void) ของคู่ขั้น from→to (to ว่าง = ทุกปลายทางของขั้นต้นทางนั้น)
create or replace function analytics.job_disc_active_qty(p_from_stage_id uuid, p_to_stage_id uuid default null)
 returns integer
 language sql
 stable
 set search_path to 'pg_catalog', 'analytics', 'pg_temp'
as $f$
  select coalesce(sum(d.qty), 0)::integer
    from analytics.job_discrepancy d
   where d.from_stage_id = p_from_stage_id and d.status in ('open', 'resolved')
     and (p_to_stage_id is null or d.to_stage_id = p_to_stage_id)
     and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d.id)
$f$;

-- ชิ้นที่ "อยู่ในมือ/กำลังรอรับ" ของใบ ณ ตอนนี้ (frontier): ขั้น received = เข้า − เสีย − แยกออก · ไม่มี received = ที่ขั้นล่าสุดที่ส่งแล้วส่งออก − ส่วนต่างที่ค้างไปขั้นถัดไป · ยังไม่เริ่ม = จำนวนเริ่มผลิต
-- ใบ done = ชิ้นดี · cancelled = 0
create or replace function analytics.job_live_qty(p_job_id uuid)
 returns integer
 language sql
 stable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
  select case
           when j.status = 'cancelled' then 0
           when j.status = 'done' then coalesce(j.qty_good, 0)
           else coalesce(
                  (select s.qty_in - s.qty_scrap - s.qty_split_out from analytics.job_stage s where s.job_id = j.id and s.status = 'received' limit 1),
                  (select p.qty_out - analytics.job_disc_active_qty(p.id, null) from analytics.job_stage p
                    where p.job_id = j.id and p.status = 'sent' order by p.seq desc limit 1),
                  j.qty_planned)
         end
    from analytics.job j
   where j.id = p_job_id
$f$;

-- ส่วนต่างของสมการ "เริ่มผลิต = ชิ้นที่เหลือ + เสีย + แยกออก + ส่วนต่าง (+ ที่ยกเลิกเป็นเสีย)" ต่อใบ · 0 = ตรง · null = ไม่นับ (ส่วนที่ยกเลิกแบบคืนชิ้นให้ใบแม่ · ใบแม่ที่ยกเลิกทั้งใบ)
create or replace function analytics.job_identity_gap(p_job_id uuid)
 returns integer
 language sql
 stable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
  select case
           when j.status = 'cancelled' and j.cancel_scrap_qty is null then null
           when j.status = 'done' then j.qty_planned - (coalesce(j.qty_good, 0) + coalesce(j.qty_scrap, 0) + j.qty_split_out)
           when j.status = 'cancelled' then j.qty_planned - (a.scrap + a.split + a.disc + j.cancel_scrap_qty)
           else j.qty_planned - (analytics.job_live_qty(j.id) + a.scrap + a.split + a.disc)
         end
    from analytics.job j
    cross join lateral (
      select coalesce(sum(s.qty_scrap), 0)::integer as scrap, coalesce(sum(s.qty_split_out), 0)::integer as split,
             coalesce(sum(analytics.job_disc_active_qty(s.id, null)), 0)::integer as disc
        from analytics.job_stage s where s.job_id = j.id) a
   where j.id = p_job_id
$f$;

-- ขั้นที่มีชิ้นมากสุดในต้นไม้ (ตำแหน่งการ์ดบอร์ดของใบแม่ที่แยก) · เท่ากัน = ขั้นต้นกว่า · ไม่มีชิ้นค้างขั้นไหน = null
create or replace function analytics.job_tree_dominant_stage(p_root uuid)
 returns text
 language sql
 stable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
  select x.stage_code from (
    select f.stage_code, sum(analytics.job_live_qty(j.id)) as q, min(d.seq_default) as sd
      from analytics.job j
      join lateral (select s.stage_code from analytics.job_stage s
                     where s.job_id = j.id and s.status in ('received', 'pending')
                     order by (s.status = 'received') desc, s.seq limit 1) f on true
      join analytics.job_stage_def d on d.shop_id = j.shop_id and d.code = f.stage_code
     where (j.id = p_root or j.parent_job_id = p_root) and j.status not in ('done', 'cancelled')
     group by f.stage_code) x
   order by x.q desc, x.sd
   limit 1
$f$;

-- ส่วนที่เป็น "ตัวบล็อก" การยกเลิกแบบคืนชิ้นให้ใบแม่ (null = คืนได้) — ใช้ร่วมกันทั้ง RPC ยกเลิกและ resolve (can_cancel_split)
create or replace function analytics.job_lot_return_blocker(p_lot_job_id uuid)
 returns text
 language plpgsql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_l  analytics.job%rowtype;
  v_s2 analytics.job_stage%rowtype;
  v_ms analytics.job_stage%rowtype;
begin
  -- 0181
  select * into v_l from analytics.job where id = p_lot_job_id;
  if not found or v_l.parent_job_id is null then return 'not_lot'; end if;
  if v_l.status in ('done', 'cancelled') then return 'job_closed'; end if;
  if exists (select 1 from analytics.job_discrepancy d
              where d.job_id = p_lot_job_id and d.status in ('open', 'resolved')
                and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d.id)) then
    return 'has_discrepancy';
  end if;
  select * into v_s2 from analytics.job_stage where job_id = p_lot_job_id and split_from_stage_id is not null;
  if not found then return 'not_lot'; end if;
  if exists (select 1 from analytics.job_stage s where s.job_id = p_lot_job_id and s.id <> v_s2.id and s.status in ('received', 'sent')) then
    return 'already_received';
  end if;
  if exists (select 1 from analytics.job_stage x join analytics.job c on c.id = x.job_id
              where x.split_from_stage_id in (select s.id from analytics.job_stage s where s.job_id = p_lot_job_id)
                and not (c.status = 'cancelled' and c.cancel_scrap_qty is null)) then
    return 'has_split';
  end if;
  select * into v_ms from analytics.job_stage where id = v_s2.split_from_stage_id;
  if v_ms.status is distinct from 'received' then return 'cannot_return'; end if;
  -- คืนชิ้นแล้วขั้นแม่จะเหลือ split_out = 0 แต่มีของเสียที่บันทึกตอนแยกค้าง = ผิดกติกา js_not_sent_ck (ของเสียก่อนส่งได้เฉพาะขั้นที่เคยแยก) — ให้ออฟฟิศเลือก "ยกเลิกเป็นของเสีย" แทน
  if v_ms.qty_split_out - v_l.qty_planned = 0 and v_ms.qty_scrap > 0 then return 'scrap_recorded'; end if;
  return null;
end;
$f$;

-- ============================================================================
-- 3. trigger/guard: job_discrepancy · job_stage_state · job_stage_sync · job_stage_guard · job_guard · job_token_guard
-- ============================================================================
-- M-B (security): เนื้อโลหะที่หายเกินสัดส่วนชิ้นที่หาย = gap + น้ำหนักส่งส่วนที่ "ควร" หายตามสัดส่วนชิ้น (ติดลบมาก = เนื้อหายมากกว่าที่ชิ้นที่หายอธิบายได้) · null = ไม่มีน้ำหนักให้เทียบ
create or replace function analytics.job_disc_excess_g(p_weight_gap numeric, p_weight_sent numeric, p_qty integer, p_qty_sent integer)
 returns numeric
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $f$
  select case when p_weight_gap is null or p_weight_sent is null or p_qty is null or p_qty_sent is null or p_qty_sent <= 0 then null
              else p_weight_gap + round(p_weight_sent * p_qty / p_qty_sent, 3) end
$f$;

create or replace function analytics.job_discrepancy_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job analytics.job%rowtype;
  v_f   analytics.job_stage%rowtype;
  v_t   analytics.job_stage%rowtype;
  v_o   analytics.job_discrepancy%rowtype;
begin
  -- 0181
  if tg_op = 'DELETE' then
    raise exception 'job_discrepancy: ห้ามลบ (append-only) — ออฟฟิศยกเลิกด้วย void แถวใหม่' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    select * into v_f from analytics.job_stage where id = new.from_stage_id;
    select * into v_t from analytics.job_stage where id = new.to_stage_id;
    select * into v_job from analytics.job where id = new.job_id;
    if v_f.id is null or v_t.id is null or v_job.id is null or v_f.job_id <> new.job_id or v_t.job_id <> new.job_id then
      raise exception 'job_discrepancy: ขั้นต้นทางและปลายทางต้องอยู่ในใบงานเดียวกัน' using errcode = '22023';
    end if;
    if v_job.shop_id <> new.shop_id or new.root_job_id is distinct from coalesce(v_job.parent_job_id, v_job.id) then
      raise exception 'job_discrepancy: ร้าน/ใบแม่ไม่ตรงกับใบงาน' using errcode = '22023';
    end if;
    if v_f.status <> 'sent' or v_t.status <> 'pending' or v_f.seq >= v_t.seq
       or exists (select 1 from analytics.job_stage x where x.job_id = new.job_id and x.seq > v_f.seq and x.seq < v_t.seq and x.status <> 'skipped') then
      raise exception 'job_discrepancy: ต้องเป็นขั้นที่ส่งแล้ว → ขั้นถัดไปที่ยังไม่รับ (ติดกัน)' using errcode = '22023';
    end if;
    if new.status = 'open' then
      if v_f.qty_out - analytics.job_disc_active_qty(new.from_stage_id, new.to_stage_id) - new.qty < 1 then
        raise exception 'job_discrepancy: ส่วนต่างต้องไม่ทำให้ผู้รับเหลือน้อยกว่า 1 ชิ้น' using errcode = '22023', hint = 'qty_invalid';
      end if;
    elsif new.status = 'void' then
      select * into v_o from analytics.job_discrepancy where id = new.void_of_id;
      if not found or v_o.status not in ('open', 'resolved') or v_o.from_stage_id <> new.from_stage_id or v_o.to_stage_id <> new.to_stage_id
         or v_o.qty <> new.qty or v_o.job_id <> new.job_id then
        raise exception 'job_discrepancy: void ต้องชี้แถวเดิม (open/resolved) ที่คู่ขั้น/จำนวนตรงกัน' using errcode = '22023';
      end if;
    else
      raise exception 'job_discrepancy: แถวใหม่ต้องเป็น open หรือ void' using errcode = '22023';
    end if;
    return new;
  end if;
  -- UPDATE: open -> resolved ครั้งเดียว · ทุกคอลัมน์อื่นห้ามขยับ · แถวที่ถูก void แล้วชี้แจงไม่ได้
  if old.status <> 'open' or new.status <> 'resolved' then
    raise exception 'job_discrepancy: แก้ได้เฉพาะ open → resolved ครั้งเดียว (ชี้แจงแล้วแก้ไม่ได้ — ให้ออฟฟิศ void)' using errcode = '22023', hint = 'already_resolved';
  end if;
  if (to_jsonb(new) - 'status' - 'resolved_kind' - 'resolved_reason' - 'resolved_by_worker' - 'resolved_by_actor' - 'resolved_at')
     is distinct from (to_jsonb(old) - 'status' - 'resolved_kind' - 'resolved_reason' - 'resolved_by_worker' - 'resolved_by_actor' - 'resolved_at') then
    raise exception 'job_discrepancy: แก้คอลัมน์อื่นนอกจากผลการชี้แจงไม่ได้' using errcode = '22023';
  end if;
  if exists (select 1 from analytics.job_discrepancy v where v.void_of_id = old.id) then
    raise exception 'job_discrepancy: แถวนี้ถูก void แล้ว ชี้แจงไม่ได้' using errcode = '22023', hint = 'voided';
  end if;
  return new;
end;
$f$;

drop trigger if exists trg_job_discrepancy_guard on analytics.job_discrepancy;
create trigger trg_job_discrepancy_guard before insert or update or delete on analytics.job_discrepancy
  for each row execute function analytics.job_discrepancy_guard();
drop trigger if exists trg_job_discrepancy_deny_truncate on analytics.job_discrepancy;
create trigger trg_job_discrepancy_deny_truncate before truncate on analytics.job_discrepancy
  for each statement execute function analytics.job_deny_truncate();

-- job_stage_state: เพิ่ม key qty_split_out เฉพาะเมื่อ > 0 (ขั้นเดิมทุกขั้น split_out = 0 ⇒ ผลเท่าเดิมเป๊ะ — v_job_stage_from_events เทียบกับ payload.after เดิมได้)
create or replace function analytics.job_stage_state(s analytics.job_stage)
 returns jsonb
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $f$
  -- 0181
  select jsonb_build_object(
    'status', s.status, 'received_on', s.received_on, 'sent_on', s.sent_on, 'worker_id', s.worker_id,
    'assignee_name', s.assignee_name, 'auto_closed', s.auto_closed, 'qty_in', s.qty_in, 'qty_out', s.qty_out,
    'qty_scrap', s.qty_scrap, 'scrap_reason', s.scrap_reason, 'weight_in_g', s.weight_in_g, 'weight_out_g', s.weight_out_g,
    'metal_added_g', s.metal_added_g, 'weight_note', s.weight_note, 'scrap_weight_g', s.scrap_weight_g, 'skip_reason', s.skip_reason)
    || case when s.qty_split_out > 0 then jsonb_build_object('qty_split_out', s.qty_split_out) else '{}'::jsonb end
    || case when s.weight_split_out_g > 0 then jsonb_build_object('weight_split_out_g', s.weight_split_out_g) else '{}'::jsonb end
$f$;

create or replace function analytics.job_stage_sync()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_cur    text;
  v_active boolean;
  v_status text;
  v_new    text;
  v_split  int;
begin
  -- 0181: + qty_split_out ของใบ = Σ ของขั้น (job_guard บังคับเท่ากัน — ทางเขียนทางเดียว)
  select s.stage_code into v_cur from analytics.job_stage s where s.job_id = new.job_id and s.status = 'received' limit 1;
  if v_cur is null then
    select s.stage_code into v_cur from analytics.job_stage s where s.job_id = new.job_id and s.status = 'pending' order by s.seq limit 1;
  end if;
  select exists (select 1 from analytics.job_stage s where s.job_id = new.job_id and s.status in ('received', 'sent')) into v_active;
  select j.status into v_status from analytics.job j where j.id = new.job_id;
  v_new := case when v_status in ('open', 'in_progress') then (case when v_active then 'in_progress' else 'open' end) else v_status end;
  select coalesce(sum(s.qty_split_out), 0) into v_split from analytics.job_stage s where s.job_id = new.job_id;
  update analytics.job j set current_stage_code = v_cur, status = v_new, qty_split_out = v_split
   where j.id = new.job_id and (j.current_stage_code is distinct from v_cur or j.status <> v_new or j.qty_split_out <> v_split);
  return null;
end;
$f$;

create or replace function analytics.job_stage_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job    analytics.job%rowtype;
  v_prev   analytics.job_stage%rowtype;
  v_exp_in int;
  v_link   int;
  v_wlink  numeric;
begin
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
      if exists (select 1 from analytics.job_stage x where x.job_id = new.job_id and x.split_from_stage_id is not null) then
        raise exception 'job_stage: 1 ส่วนมีขั้นแยกได้ขั้นเดียว' using errcode = '22023', hint = 'split_link';
      end if;
    end if;
    -- ลำดับใน job ต้องไม่ขัดกับ seq_default ของทะเบียน (design §3 ข้อ 12)
    if exists (
         select 1
           from analytics.job_stage s
           join analytics.job_stage_def d  on d.shop_id = s.shop_id and d.code = s.stage_code
           join analytics.job_stage_def dn on dn.shop_id = new.shop_id and dn.code = new.stage_code
          where s.job_id = new.job_id
            and ((s.seq < new.seq and d.seq_default > dn.seq_default) or (s.seq > new.seq and d.seq_default < dn.seq_default))) then
      raise exception 'job_stage: ลำดับขั้นต้องเรียงตามลำดับมาตรฐานของทะเบียนขั้นตอน' using errcode = '22023';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.job_id <> old.job_id or new.shop_id <> old.shop_id or new.stage_code <> old.stage_code or new.seq <> old.seq
     or new.split_from_stage_id is distinct from old.split_from_stage_id then
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
                and exists (select 1 from analytics.job_stage x where x.job_id = new.job_id and x.seq > new.seq and x.split_from_stage_id is not null)) then
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
    if old.qty_split_out > 0 or old.split_from_stage_id is not null
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
$f$;
create or replace function analytics.job_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_item_shop   uuid;
  v_item_seq    int;
  v_item_input  jsonb;
  v_q_status    text;
  v_q_root      uuid;
  v_po_status   text;
  v_poi_product uuid;
  v_prod_shop   uuid;
  v_item_qty    int;
  v_ov          text;
  v_cp          text;
  v_pf_name     text;
  v_pf_final    boolean;
  v_pf_active   boolean;
  v_pf_found    boolean;
  v_par         analytics.job%rowtype;
begin
  -- 0181: ส่วนย่อย (parent_job_id) — ชั้นเดียว · ข้อมูลต้นทาง/แบบ/โลหะต้องตรงใบแม่ · ไม่มีแผนโลหะ/ของเหลือ/เหตุผลมัดจำ · qty_split_out ต้องเท่า Σ ของขั้น · ปิด/ยกเลิกแม่ไม่ได้ขณะมีส่วนเปิด
  if tg_op = 'DELETE' then
    raise exception 'job: ห้ามลบใบงาน — ยกเลิกด้วย job_cancel แทน (เก็บไว้เป็นหลักฐานการผลิต)' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'open' or new.done_at is not null or new.cancelled_at is not null
       or new.qty_good is not null or new.qty_scrap is not null or new.weight_final_g is not null then
      raise exception 'job: ใบงานใหม่ต้องเริ่มที่สถานะ open และยังไม่มีผลปิดงาน' using errcode = '22023';
    end if;
    if new.qty_split_out <> 0 or new.cancel_scrap_qty is not null or new.cancel_scrap_reason is not null or new.cancel_scrap_weight_g is not null then
      raise exception 'job: ใบงานใหม่ต้องไม่มีการแยกส่วน/ของเสียจากการยกเลิกส่วน' using errcode = '22023';
    end if;
    if new.parent_job_id is not null then
      -- ส่วนย่อย: ตรวจกับใบแม่ (ไม่ตรวจต้นทาง/ใบเสนอราคา/ใบผลิตซ้ำ — แม่ผ่านด่านนั้นมาแล้ว) · ไม่บังคับแบบ active (แบบอาจถูกปิดใช้ทีหลัง — ส่วนรับ snapshot เดียวกับแม่)
      select * into v_par from analytics.job p where p.id = new.parent_job_id and p.shop_id = new.shop_id;
      if not found then
        raise exception 'job: ไม่พบใบแม่ของส่วนย่อยในร้านนี้' using errcode = '22023', hint = 'parent_invalid';
      end if;
      if v_par.parent_job_id is not null then
        raise exception 'job: ส่วนย่อยซ้อนกันไม่ได้ (ชั้นเดียว — ชี้ใบแม่เดิมเสมอ)' using errcode = '22023', hint = 'lot_nested';
      end if;
      if v_par.status in ('done', 'cancelled') then
        raise exception 'job: ใบแม่ปิดแล้ว แยกส่วนเพิ่มไม่ได้' using errcode = '22023', hint = 'parent_closed';
      end if;
      if new.source_kind is distinct from v_par.source_kind
         or new.oem_quote_item_id is distinct from v_par.oem_quote_item_id
         or new.root_quote_id is distinct from v_par.root_quote_id
         or new.oem_item_seq is distinct from v_par.oem_item_seq
         or new.production_order_item_id is distinct from v_par.production_order_item_id
         or new.product_id is distinct from v_par.product_id
         or new.sku_snapshot is distinct from v_par.sku_snapshot
         or new.metal is distinct from v_par.metal
         or new.profile_id is distinct from v_par.profile_id
         or new.profile_name is distinct from v_par.profile_name
         or new.require_final_weight is distinct from v_par.require_final_weight then
        raise exception 'job: ต้นทาง/แบบการบันทึก/โลหะของส่วนย่อยต้องตรงกับใบแม่' using errcode = '22023', hint = 'lot_mismatch';
      end if;
      if new.qty_order <> new.qty_planned or new.target_piece_g is not null or new.metal_plan_g is not null or new.metal_plan_basis is not null
         or new.surplus_disposition is not null or new.surplus_note is not null or new.start_gate_note is not null then
        raise exception 'job: ส่วนย่อยมีจำนวนสั่ง = จำนวนของตัวเอง และไม่มีแผนโลหะ/ของเหลือ/เหตุผลมัดจำ (อยู่ที่ใบแม่)' using errcode = '22023', hint = 'lot_mismatch';
      end if;
      return new;
    end if;
    -- 0176: ใบใหม่ต้องมีแบบการบันทึก (แบบ active ของร้านเดียวกัน) · ชื่อและ flag น้ำหนักสุทธิที่ snapshot ต้องตรงกับแบบ — ไม่งั้นใบเงียบๆ ไม่มีกติกา/ปลอมชื่อแบบ
    if new.profile_id is null then
      raise exception 'job: ใบงานใหม่ต้องมีแบบการบันทึก (profile_required)' using errcode = '22023', hint = 'profile_required';
    end if;
    select p.name, p.require_final_weight, p.is_active, true into v_pf_name, v_pf_final, v_pf_active, v_pf_found
      from analytics.job_record_profile p where p.id = new.profile_id and p.shop_id = new.shop_id;
    if v_pf_found is not true or not v_pf_active then
      raise exception 'job: แบบการบันทึกไม่ถูกต้อง (ไม่พบ/ของร้านอื่น/ปิดใช้งาน)' using errcode = '22023', hint = 'profile_invalid';
    end if;
    if new.profile_name is distinct from v_pf_name or new.require_final_weight is distinct from v_pf_final then
      raise exception 'job: ชื่อแบบ/กติกาน้ำหนักสุทธิของใบไม่ตรงกับแบบการบันทึก' using errcode = '22023', hint = 'profile_invalid';
    end if;
    if new.source_kind = 'oem' then
      select i.shop_id, i.seq, i.input, q.status, coalesce(q.root_quote_id, q.id), i.qty
        into v_item_shop, v_item_seq, v_item_input, v_q_status, v_q_root, v_item_qty
        from analytics.oem_quote_item i
        join analytics.oem_quote q on q.id = i.quote_id
       where i.id = new.oem_quote_item_id;
      if not found then
        raise exception 'job: ไม่พบรายการใบเสนอราคา' using errcode = '22023';
      end if;
      if v_item_shop <> new.shop_id then
        raise exception 'job: รายการใบเสนอราคาเป็นของร้านอื่น สร้างใบงานข้ามร้านไม่ได้' using errcode = '22023';
      end if;
      if v_q_status <> 'won' then
        raise exception 'job: สร้างใบงานได้เฉพาะใบเสนอราคาที่ได้งานแล้ว (won) — ใบนี้สถานะ %', v_q_status using errcode = '22023';
      end if;
      if new.root_quote_id <> v_q_root or new.oem_item_seq <> v_item_seq then
        raise exception 'job: ดีล/ลำดับรายการไม่ตรงกับใบเสนอราคา' using errcode = '22023';
      end if;
      if new.metal is distinct from (v_item_input ->> 'metal') then
        raise exception 'job: โลหะของใบงานไม่ตรงกับรายการใบเสนอราคา' using errcode = '22023';
      end if;
    else
      select poi.shop_id, po.status, poi.product_id, poi.qty_planned
        into v_item_shop, v_po_status, v_poi_product, v_item_qty
        from analytics.production_order_item poi
        join analytics.production_order po on po.id = poi.production_order_id
       where poi.id = new.production_order_item_id;
      if not found then
        raise exception 'job: ไม่พบรายการในใบผลิต' using errcode = '22023';
      end if;
      if v_item_shop <> new.shop_id then
        raise exception 'job: รายการใบผลิตเป็นของร้านอื่น สร้างใบงานข้ามร้านไม่ได้' using errcode = '22023';
      end if;
      if v_po_status <> 'open' then
        raise exception 'job: สร้างใบงานได้เฉพาะใบผลิตที่ยังเปิดอยู่ (open) — ใบนี้สถานะ %', v_po_status using errcode = '22023';
      end if;
      if new.product_id is distinct from v_poi_product then
        raise exception 'job: สินค้าของใบงานไม่ตรงกับรายการใบผลิต' using errcode = '22023';
      end if;
    end if;
    -- M1: จำนวนสั่ง = จำนวนจากต้นทางเสมอ (OEM = qty รายการใบเสนอราคา · ผลิต = qty_planned ของรายการใบผลิต) · ของเหลือตั้งตอนสร้างไม่ได้
    if new.qty_order is distinct from v_item_qty then
      raise exception 'job: จำนวนที่สั่ง (qty_order) ต้องตรงกับจำนวนในต้นทาง (%)', v_item_qty using errcode = '22023';
    end if;
    if new.surplus_disposition is not null or new.surplus_note is not null then
      raise exception 'job: ใบงานใหม่ตั้งการจัดการของเหลือไม่ได้' using errcode = '22023';
    end if;
    -- แผนโลหะต้องตรงกับ basis ที่อธิบายมัน (plan_drift) — helper เดียวกับ UPDATE (0176: ยกจากบล็อกที่ซ้ำกัน 2 ที่ของ 0175)
    perform analytics.job_plan_basis_assert(new);
    if new.product_id is not null then
      select p.shop_id into v_prod_shop from public.product p where p.id = new.product_id;
      if v_prod_shop is distinct from new.shop_id then
        raise exception 'job: สินค้าเป็นของร้านอื่น' using errcode = '22023';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.shop_id <> old.shop_id or new.seq <> old.seq or new.source_kind <> old.source_kind
     or new.oem_quote_item_id is distinct from old.oem_quote_item_id
     or new.root_quote_id is distinct from old.root_quote_id
     or new.oem_item_seq is distinct from old.oem_item_seq
     or new.production_order_item_id is distinct from old.production_order_item_id
     or new.product_id is distinct from old.product_id
     or new.sku_snapshot is distinct from old.sku_snapshot
     or new.metal <> old.metal or new.qty_order <> old.qty_order
     or new.created_at <> old.created_at or new.created_by <> old.created_by then
    raise exception 'job: ห้ามเปลี่ยนข้อมูลตั้งต้นของใบงาน (ร้าน/เลขที่/ต้นทาง/แบบ/โลหะ/จำนวน) — ยกเลิกแล้วสร้างใหม่' using errcode = '22023';
  end if;
  if old.status = 'cancelled' then
    raise exception 'job: ใบงาน % สถานะ % แล้ว แก้ไม่ได้', old.job_no, old.status using errcode = '22023';
  end if;
  -- 0181: ส่วนย่อย/จำนวนแยก/ของเสียจากการยกเลิกส่วน
  if new.parent_job_id is distinct from old.parent_job_id or new.lot_seq <> old.lot_seq then
    raise exception 'job: ห้ามเปลี่ยนใบแม่/ลำดับส่วนของใบงาน' using errcode = '22023', hint = 'lot_immutable';
  end if;
  if new.qty_split_out is distinct from (select coalesce(sum(s.qty_split_out), 0) from analytics.job_stage s where s.job_id = new.id) then
    raise exception 'job: qty_split_out ต้องเท่ากับผลรวมของขั้น — เขียนผ่านการแยกส่วนเท่านั้น' using errcode = '22023', hint = 'split_sum';
  end if;
  if (new.cancel_scrap_qty is distinct from old.cancel_scrap_qty or new.cancel_scrap_reason is distinct from old.cancel_scrap_reason or new.cancel_scrap_weight_g is distinct from old.cancel_scrap_weight_g)
     and not (old.status <> 'cancelled' and new.status = 'cancelled') then
    raise exception 'job: ของเสียจากการยกเลิกส่วนตั้งได้เฉพาะตอนยกเลิกส่วน' using errcode = '22023';
  end if;
  if new.parent_job_id is not null
     and (new.target_piece_g is not null or new.metal_plan_g is not null or new.metal_plan_basis is not null
          or new.surplus_disposition is not null or new.surplus_note is not null or new.start_gate_note is not null) then
    raise exception 'job: ส่วนย่อยไม่มีแผนโลหะ/ของเหลือ/เหตุผลมัดจำ (อยู่ที่ใบแม่)' using errcode = '22023', hint = 'lot_mismatch';
  end if;
  -- done แล้วแก้ไม่ได้ ยกเว้นการจัดการของเหลือ (surplus_*) — ทุกคอลัมน์อื่นต้องเท่าเดิมเป๊ะ (job_surplus_set เท่านั้นที่ใช้ช่องนี้)
  -- ตัด job_no ออกจากการเทียบ: เป็น generated column คำนวณหลัง BEFORE trigger จึงเป็น null ใน NEW เสมอ (design §8.4 ไม่ได้กันไว้ — verify B4b จับได้)
  if old.status = 'done'
     and (to_jsonb(new) - 'surplus_disposition' - 'surplus_note' - 'updated_at' - 'job_no')
         is distinct from (to_jsonb(old) - 'surplus_disposition' - 'surplus_note' - 'updated_at' - 'job_no') then
    raise exception 'job: ใบงาน % สถานะ % แล้ว แก้ไม่ได้ (ยกเว้นการจัดการของเหลือ)', old.job_no, old.status using errcode = '22023';
  end if;
  if new.status <> old.status and not (
       (old.status = 'open' and new.status in ('in_progress', 'on_hold', 'done', 'cancelled'))
    or (old.status = 'in_progress' and new.status in ('open', 'on_hold', 'done', 'cancelled'))
    or (old.status = 'on_hold' and new.status in ('open', 'in_progress', 'done', 'cancelled'))) then
    raise exception 'job: เปลี่ยนสถานะ % -> % ไม่ได้', old.status, new.status using errcode = '22023';
  end if;
  if new.status = 'done' and exists (
       select 1 from analytics.job_stage s where s.job_id = new.id and s.status in ('pending', 'received')) then
    raise exception 'job: ปิดงานไม่ได้ — ยังมีขั้นที่ยังไม่รับ/ยังไม่ส่งต่อ' using errcode = '22023';
  end if;
  -- 0181: ปิดใบแม่ไม่ได้ขณะมีส่วนย่อยเปิดอยู่ · ปิดใบ (แม่/ส่วน) ไม่ได้ขณะมีส่วนต่างรอชี้แจง · ยกเลิกแม่ที่มีส่วนย่อยไม่ได้
  if new.status = 'done' and old.status <> 'done' then
    if new.parent_job_id is null and exists (select 1 from analytics.job c where c.parent_job_id = new.id and c.status not in ('done', 'cancelled')) then
      raise exception 'job: ปิดใบงานไม่ได้ — ยังมีส่วนย่อยที่ยังไม่ปิด (parts_open)' using errcode = '22023', hint = 'parts_open';
    end if;
    if exists (select 1 from analytics.job_discrepancy d
                where d.status = 'open' and (d.job_id = new.id or (new.parent_job_id is null and d.root_job_id = new.id))
                  and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d.id)) then
      raise exception 'job: ปิดใบงานไม่ได้ — ยังมีส่วนต่างรอชี้แจง (parts_open)' using errcode = '22023', hint = 'parts_open';
    end if;
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' and new.parent_job_id is null
     and exists (select 1 from analytics.job c where c.parent_job_id = new.id and c.status <> 'cancelled') then
    raise exception 'job: ยกเลิกใบแม่ไม่ได้ — มีส่วนย่อยอยู่ (ยกเลิก/ปิดส่วนย่อยก่อน) (has_parts)' using errcode = '22023', hint = 'has_parts';
  end if;
  -- จำนวนเริ่มผลิตแก้ได้เฉพาะก่อนขั้นแรกถูกรับ (หลังจากนั้นจำนวนชิ้นในขั้นยึดตามค่านี้แล้ว)
  if new.qty_planned <> old.qty_planned
     and exists (select 1 from analytics.job_stage s where s.job_id = new.id and s.status in ('received', 'sent')) then
    raise exception 'job: แก้จำนวนเริ่มผลิตได้เฉพาะก่อนขั้นแรกถูกรับ' using errcode = '22023', hint = 'started';
  end if;
  -- 0176: แบบการบันทึก/กติกาชั่งของใบ แก้ได้ก่อนขั้นแรกถูกรับเท่านั้น (ทางเดียว = job_profile_apply) · profile_id ถอดคืนเป็น null ไม่ได้ · ใบเดิม (null) ตั้ง require_final_weight เองไม่ได้ ·
  -- แบบต้อง active ร้านเดียวกัน + ชื่อ/flag ตรงแบบ · weigh_required ต้องเท่า exists(ขั้นที่ weigh_required) ณ ตอนนั้น (weigh_drift)
  if new.weigh_required <> old.weigh_required or new.profile_id is distinct from old.profile_id
     or new.profile_name is distinct from old.profile_name or new.require_final_weight <> old.require_final_weight then
    if exists (select 1 from analytics.job_stage s where s.job_id = new.id and s.status in ('received', 'sent')) then
      raise exception 'job: แก้แบบการบันทึก/กติกาชั่งได้เฉพาะก่อนขั้นแรกถูกรับ' using errcode = '22023', hint = 'started';
    end if;
    if new.profile_id is null then
      if old.profile_id is not null or new.require_final_weight <> old.require_final_weight then
        raise exception 'job: ถอดแบบการบันทึกออกจากใบไม่ได้ (profile_invalid)' using errcode = '22023', hint = 'profile_invalid';
      end if;
    else
      select p.name, p.require_final_weight, p.is_active, true into v_pf_name, v_pf_final, v_pf_active, v_pf_found
        from analytics.job_record_profile p where p.id = new.profile_id and p.shop_id = new.shop_id;
      if v_pf_found is not true or not v_pf_active
         or new.profile_name is distinct from v_pf_name or new.require_final_weight is distinct from v_pf_final then
        raise exception 'job: แบบการบันทึกไม่ถูกต้อง/ชื่อหรือกติกาน้ำหนักสุทธิไม่ตรงแบบ (profile_invalid)' using errcode = '22023', hint = 'profile_invalid';
      end if;
    end if;
    if new.weigh_required is distinct from exists (select 1 from analytics.job_stage s where s.job_id = new.id and s.weigh_required) then
      raise exception 'job: weigh_required ไม่ตรงกับขั้นที่ต้องชั่งของใบ (weigh_drift)' using errcode = '22023', hint = 'weigh_drift';
    end if;
  end if;
  -- แผนโลหะแก้ได้จนกว่าขั้นหล่อ (cast) จะถูกรับ
  if (new.target_piece_g is distinct from old.target_piece_g or new.metal_plan_g is distinct from old.metal_plan_g
      or new.metal_plan_basis is distinct from old.metal_plan_basis)
     and exists (select 1 from analytics.job_stage s where s.job_id = new.id and s.stage_code = 'cast' and s.status in ('received', 'sent')) then
    raise exception 'job: แก้แผนโลหะได้เฉพาะก่อนขั้นหล่อถูกรับ' using errcode = '22023', hint = 'cast_started';
  end if;
  -- แผนโลหะต้องตรงกับ basis ที่อธิบายมัน (plan_drift) — helper เดียวกับ INSERT
  perform analytics.job_plan_basis_assert(new);
  if new.status <> 'done' and (new.surplus_disposition is not null or new.surplus_note is not null) then
    raise exception 'job: ตั้งการจัดการของเหลือได้เฉพาะใบงานที่ปิดแล้ว (done)' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$f$;

create or replace function analytics.job_token_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_status text;
  v_parent uuid;
begin
  -- 0181: token ออกให้ใบแม่เท่านั้น (ส่วนย่อย = QR อีกใบของใบแม่ — ป้าย lot_job_id ต้องเป็นส่วนของใบนี้) · purpose/lot_job_id แก้ภายหลังไม่ได้
  if tg_op = 'DELETE' then
    raise exception 'job_token: ห้ามลบ token — เพิกถอนแทน' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    select j.status, j.parent_job_id into v_status, v_parent from analytics.job j where j.id = new.job_id;
    if v_status is null or v_status in ('done', 'cancelled') then
      raise exception 'job_token: ออก token ให้ใบงานที่ปิดแล้วไม่ได้' using errcode = '22023';
    end if;
    if v_parent is not null then
      raise exception 'job_token: ออก QR ให้ส่วนย่อยไม่ได้ — ออกให้ใบแม่เท่านั้น (QR ใบแม่เปิดหน้าเดียวกันทุกส่วน)' using errcode = '22023', hint = 'lot_no_token';
    end if;
    if new.lot_job_id is not null
       and not exists (select 1 from analytics.job l where l.id = new.lot_job_id and l.parent_job_id = new.job_id and l.shop_id = new.shop_id) then
      raise exception 'job_token: lot_job_id ต้องเป็นส่วนย่อยของใบงานนี้' using errcode = '22023', hint = 'lot_invalid';
    end if;
    if new.revoked_at is not null then
      raise exception 'job_token: token ใหม่ต้องยังไม่ถูกเพิกถอน' using errcode = '22023';
    end if;
    return new;
  end if;
  if new.id <> old.id or new.shop_id <> old.shop_id or new.job_id <> old.job_id or new.token_hash <> old.token_hash
     or new.print_no <> old.print_no or new.issued_at <> old.issued_at or new.issued_by <> old.issued_by
     or new.purpose <> old.purpose or new.lot_job_id is distinct from old.lot_job_id then
    raise exception 'job_token: แก้ได้เฉพาะการเพิกถอน' using errcode = '22023';
  end if;
  if old.revoked_at is not null then
    raise exception 'job_token: token ที่เพิกถอนแล้วฟื้นหรือแก้ไม่ได้' using errcode = '22023';
  end if;
  return new;
end;
$f$;
-- ============================================================================
-- 4. core: job_core_receive (+ รับไม่ครบ → ส่วนต่าง) · job_core_send (+ ส่งส่วนที่เหลือหลังแยก) · job_tree_assert/check · แยกส่วน/ยกเลิกส่วน
-- ============================================================================
drop function if exists analytics.job_core_receive(uuid, integer, date, numeric, uuid, text, text, uuid, text, boolean);

create or replace function analytics.job_core_receive(p_job_id uuid, p_expected_seq integer, p_occurred_on date, p_weight_in numeric, p_worker_id uuid, p_assignee text, p_channel text, p_actor uuid, p_device_hint text, p_enforce_scope boolean, p_qty_received integer default null)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job     analytics.job%rowtype;
  v_t       analytics.job_stage%rowtype;
  v_t2      analytics.job_stage%rowtype;
  v_p       analytics.job_stage%rowtype;
  v_p2      analytics.job_stage%rowtype;
  v_today   date := analytics.job_today();
  v_codes   text[];
  v_name    text;
  v_def     text;
  v_auto    text := null;
  v_gap     numeric := null;
  v_base    int;
  v_qin     int;
  v_disc    uuid := null;
  v_n_mm    int;
begin
  -- 0181: p_qty_received (ผู้รับใส่จำนวนจริง · null = รับตามที่ส่ง) — น้อยกว่าที่ส่ง ⇒ ส่วนต่างรอชี้แจง (job_discrepancy) ที่ขั้นผู้ส่ง · ขั้นก่อนที่แยกส่วนออกไปแล้วปิดอัตโนมัติไม่ได้
  select * into v_job from analytics.job where id = p_job_id;
  if not found then
    return analytics.job_fail('job_not_found', 'ไม่พบใบงาน');
  end if;
  if v_job.status in ('done', 'cancelled') then
    return analytics.job_fail('job_closed', 'ใบงานนี้ปิดแล้ว รับงานไม่ได้');
  end if;
  if v_job.status = 'on_hold' then
    return analytics.job_fail('job_on_hold', 'ใบงานนี้ถูกพักไว้ รับงานไม่ได้ — แจ้งออฟฟิศ');
  end if;
  if p_expected_seq is null then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;

  select * into v_t from analytics.job_stage where job_id = p_job_id and seq = p_expected_seq;
  if not found then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  if v_t.status = 'received' then
    select coalesce(w.display_name, v_t.assignee_name, 'ผู้รับก่อนหน้า') into v_name
      from (select 1) x left join analytics.worker w on w.id = v_t.worker_id;
    return analytics.job_fail('already_received', format('ขั้นนี้ถูกรับไปแล้วโดย %s', v_name), jsonb_build_object('by', v_name));
  end if;
  if v_t.status <> 'pending' then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  if exists (select 1 from analytics.job_stage s where s.job_id = p_job_id and s.seq < v_t.seq and s.status = 'pending') then
    return analytics.job_fail('out_of_order', 'รับงานข้ามลำดับไม่ได้ — ขั้นก่อนหน้ายังไม่มีใครรับหรือข้าม');
  end if;

  -- วันที่: ช่างผ่าน QR = วันนี้เสมอ · ออฟฟิศย้อนได้ <= 14 วัน ไม่อนาคต (design §3 ข้อ 9 · มติ Q3)
  if p_occurred_on is null
     or p_occurred_on > v_today
     or (p_channel = 'worker_qr' and p_occurred_on <> v_today)
     or p_occurred_on < v_today - 14 then
    return analytics.job_fail('date_invalid', 'วันที่รับงานต้องไม่ใช่อนาคตและย้อนหลังได้ไม่เกิน 14 วัน (ช่างสแกนผ่าน QR ใช้วันนี้เท่านั้น)');
  end if;

  if p_worker_id is null and p_assignee is null then
    return analytics.job_fail('who_required', 'ต้องระบุผู้รับงาน');
  end if;
  if p_enforce_scope and p_worker_id is not null then
    select w.stage_codes into v_codes from analytics.worker w where w.id = p_worker_id;
    if not analytics.job_worker_can_do(v_codes, v_t.stage_code) then
      select d.name_th into v_def from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_t.stage_code;
      return analytics.job_fail('stage_not_allowed', format('งานนี้อยู่ขั้น "%s" ซึ่งคุณไม่ได้รับผิดชอบ', coalesce(v_def, v_t.stage_code)));
    end if;
  end if;

  if not analytics.job_weight_ok(p_weight_in) then
    return analytics.job_fail('weight_invalid', 'น้ำหนักเข้าต้องมากกว่า 0 และไม่เกิน 100,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)');
  end if;
  if v_t.weigh_required and p_weight_in is null then
    return analytics.job_fail('weight_required', 'ขั้นนี้ต้องชั่งน้ำหนักก่อนรับงาน');
  end if;

  -- ด่านมัดจำ (design §3 ข้อ 13 · มติ Q4): รับขั้นแรกของงาน OEM ที่ดีลยังไม่มีเงินเข้าเลย ต้องมีเหตุผลที่ออฟฟิศบันทึกไว้
  if analytics.job_deposit_blocked(v_job) then
    return analytics.job_fail('awaiting_deposit', 'รอมัดจำ — ดีลนี้ยังไม่มีเงินเข้า แจ้งออฟฟิศให้บันทึกเหตุผลก่อนเริ่มงาน');
  end if;

  -- ขั้นก่อนหน้า (ข้ามขั้นที่ skipped)
  select * into v_p from analytics.job_stage s
   where s.job_id = p_job_id and s.seq < v_t.seq and s.status <> 'skipped' order by s.seq desc limit 1;

  -- 0181: จำนวนที่รับได้ (ก่อนมีการเขียนใดๆ) — ขั้นก่อนที่ถือค้างจะถูกปิดอัตโนมัติด้วย qty_out = qty_in · หักส่วนต่างที่ยังนับอยู่ของคู่ขั้นนี้ (ถ้าขั้นนี้เคยถูกย้อนมา)
  if v_p.id is not null then
    v_base := (case when v_p.status = 'received' then v_p.qty_in else v_p.qty_out end) - analytics.job_disc_active_qty(v_p.id, v_t.id);
  else
    v_base := v_job.qty_planned;
  end if;
  if p_qty_received is not null and (p_qty_received < 1 or p_qty_received > v_base or (v_p.id is null and p_qty_received <> v_base)) then
    return analytics.job_fail('qty_invalid', 'จำนวนที่รับไม่ถูกต้อง — ต้องมากกว่า 0 และไม่เกินจำนวนที่ส่งมา (ขั้นแรกของใบรับครบจำนวนเสมอ)');
  end if;
  v_qin := coalesce(p_qty_received, v_base);
  -- M1 (security): รับไม่ครบขณะผู้ถือขั้นก่อนยังไม่ส่ง = ปิดขั้นก่อนอัตโนมัติด้วยจำนวนเต็มแล้วโยนความผิดให้ผู้ส่ง — ปฏิเสธ ให้ผู้ถือกดส่งต่อก่อน
  if v_p.id is not null and v_p.status = 'received' and v_qin < v_base then
    return analytics.job_fail('prev_not_sent', 'ขั้นก่อนหน้ายังไม่ได้กดส่งต่อ — รับไม่ครบไม่ได้ ให้ผู้ถือกดส่งต่อก่อน');
  end if;
  -- L-2 (security): ทอง + ช่างรับไม่ครบผ่าน QR ที่ชั่งไม่ผ่าน (gap > +0.05) ครบ 3 ครั้งบนขั้นนี้ = ล็อก ต้องให้ออฟฟิศรับ — กันไล่เดาน้ำหนักขั้นก่อนด้วยการลองซ้ำ
  -- (แคบ: เฉพาะทอง · เฉพาะรับไม่ครบ · เฉพาะช่าง · ไม่กระทบเงิน/รับครบ · ออฟฟิศรับแทนได้เสมอ = ปลดล็อก)
  v_n_mm := 0;
  if v_job.metal = 'gold' and p_channel = 'worker_qr' and v_qin < v_base and v_p.id is not null then
    select count(*) into v_n_mm from analytics.job_event e
     where e.job_stage_id = v_t.id and e.event_type = 'weigh'
       and e.payload->>'kind' = 'handoff_mismatch' and e.payload->>'partial' = 'true';
    if v_n_mm >= 3 then
      return analytics.job_fail('office_required', 'ขั้นนี้ชั่งรับไม่ตรงหลายครั้งแล้ว — แจ้งออฟฟิศให้เป็นผู้รับงาน');
    end if;
  end if;

  if v_p.id is not null then
    if v_p.status = 'received' then
      -- 0176: ใบทองเดิม (ก่อน profile) คงกติกา J1 · ใบที่มีแบบตัดสินจาก weigh_required ของขั้นก่อน (บล็อกถัดไป)
      if v_job.metal = 'gold' and v_job.profile_id is null then
        return analytics.job_fail('prev_not_sent', 'งานทอง: ขั้นก่อนหน้ายังไม่ได้กดส่งต่อ — ผู้ถือต้องกดส่งต่อพร้อมน้ำหนักออกก่อน');
      end if;
      -- QA 6: ขั้นก่อนหน้าบังคับชั่ง (เงิน: หล่อ/ตัดต้น/ขัด) และยังไม่มีน้ำหนักออก = ห้ามปิดอัตโนมัติ (ไม่งั้นรายงานน้ำหนักหายมีรูเงียบๆ)
      if v_p.weigh_required then
        return analytics.job_fail('prev_not_sent', 'ขั้นก่อนหน้าต้องชั่งน้ำหนักออกก่อน — ให้ผู้ถือกดส่งต่อพร้อมน้ำหนัก หรือแจ้งออฟฟิศกรอกแทน');
      end if;
      -- 0181: ขั้นก่อนแยกส่วนออกไปแล้ว (ผู้ถือยังค้างส่วนที่เหลือ) = ปิดอัตโนมัติไม่ได้ (qty_out = qty_in ผิดโซ่)
      if v_p.qty_split_out > 0 then
        return analytics.job_fail('prev_not_sent', 'ขั้นก่อนหน้ามีส่วนที่แยกออกไปแล้ว — ผู้ถือต้องกดส่งต่อส่วนที่เหลือก่อน');
      end if;
      if p_occurred_on < v_p.received_on then
        return analytics.job_fail('date_invalid', 'วันรับต้องไม่ก่อนวันที่ขั้นก่อนหน้ารับงาน');
      end if;
      update analytics.job_stage
         set status = 'sent', sent_on = p_occurred_on, qty_out = qty_in, auto_closed = true
       where id = v_p.id
       returning * into v_p2;
      perform analytics.job_event_write(p_job_id, v_p.id, 'stage_send', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
        jsonb_build_object('stage_code', v_p.stage_code, 'auto_closed', true, 'closed_by_receive_of', v_t.stage_code,
                           'before', analytics.job_stage_state(v_p), 'after', analytics.job_stage_state(v_p2)));
      v_auto := v_p.stage_code;
      v_p := v_p2;
    elsif v_p.status <> 'sent' then
      return analytics.job_fail('out_of_order', 'รับงานข้ามลำดับไม่ได้ — ขั้นก่อนหน้ายังไม่เสร็จ');
    end if;
    if p_occurred_on < v_p.sent_on then
      return analytics.job_fail('date_invalid', 'วันรับต้องไม่ก่อนวันที่ขั้นก่อนหน้าส่งต่อ');
    end if;
  end if;

  -- M1: น้ำหนักที่รับ vs น้ำหนักที่ขั้นก่อนหน้าส่งออก · ทอง ต่างเกิน 0.05 g = ปฏิเสธ (ต้องชั่งใหม่/ให้ออฟฟิศย้อนขั้นก่อนแก้) ·
  -- เงิน/ทองเหลือง ไม่บล็อก แต่เก็บส่วนต่างไว้ใน event + v_job_stage_loss.handoff_gap_g
  -- N4: เทียบเฉพาะเมื่อทั้งขั้นก่อนและขั้นนี้บังคับชั่ง (เทียน/ปูนไม่ถูกเทียบกับหล่อ)
  -- 0181 (H1 security): เทียบน้ำหนักทุกครั้งที่ทั้งสองขั้นชั่ง — รับครบ: ทอง |gap| > 0.05 = ปฏิเสธ (ด่านเดิมเป๊ะ) · รับไม่ครบ: ทองที่ "หนักกว่า" ที่ขั้นก่อนส่ง (gap > +0.05) = ปฏิเสธ
  -- (น้ำหนักน้อยลงตามจำนวนชิ้นเป็นเรื่องปกติ ไม่บล็อก) · gap บันทึกลง job_discrepancy.weight_gap_g ให้ออฟฟิศเห็น/ตัดสิน — ไม่ปิดด่านทองเงียบ
  if v_p.id is not null and v_p.status = 'sent' and v_p.weight_out_g is not null and p_weight_in is not null
     and v_t.weigh_required and v_p.weigh_required then
    v_gap := p_weight_in - v_p.weight_out_g;
    if v_job.metal = 'gold' and ((v_qin = v_base and abs(v_gap) > 0.05) or (v_qin < v_base and v_gap > 0.05)) then
      -- N1: ผู้รับต้องชั่งแบบไม่รู้คำตอบ — ข้อความ/ผลลัพธ์ไม่บอกขนาดส่วนต่างหรือน้ำหนักขั้นก่อน · แต่บันทึก event ทุกครั้งที่ไม่ตรงให้ออฟฟิศเห็น
      -- (event_type 'weigh' ที่ 0172 ประกาศไว้แต่ยังไม่ใช้ · payload.kind = handoff_mismatch · คนเรียกฝั่งออฟฟิศ raise ทำให้ event นี้ถอยกลับ ซึ่งยอมรับได้: ออฟฟิศเห็น error ตรงๆ)
      perform analytics.job_event_write(p_job_id, v_t.id, 'weigh', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
        jsonb_build_object('kind', 'handoff_mismatch', 'stage_code', v_t.stage_code, 'weight_in_g', p_weight_in,
                           'prev_weight_out_g', v_p.weight_out_g, 'gap_g', v_gap, 'partial', v_qin < v_base));
      if v_qin < v_base and p_channel = 'worker_qr' and v_n_mm + 1 >= 3 then
        return analytics.job_fail('office_required', 'ขั้นนี้ชั่งรับไม่ตรงหลายครั้งแล้ว — แจ้งออฟฟิศให้เป็นผู้รับงาน');
      end if;
      return analytics.job_fail('handoff_mismatch', 'น้ำหนักที่รับไม่ตรงกับที่ขั้นก่อนส่งมา — ชั่งใหม่ ถ้ายังไม่ตรงให้แจ้งออฟฟิศ');
    end if;
  end if;

  -- 0181: ส่วนต่าง (ต้องมาก่อน UPDATE ขั้น — job_stage_guard หักส่วนต่างที่บันทึกแล้วจากจำนวนเข้า)
  if v_qin < v_base then
    insert into analytics.job_discrepancy (shop_id, root_job_id, job_id, from_stage_id, to_stage_id, qty, status, created_by_worker, created_by_actor, weight_gap_g, weight_sent_g, qty_sent)
    values (v_job.shop_id, coalesce(v_job.parent_job_id, v_job.id), v_job.id, v_p.id, v_t.id, v_base - v_qin, 'open', p_worker_id, p_actor, v_gap,
            case when v_gap is not null then v_p.weight_out_g end, case when v_gap is not null then v_p.qty_out end)
    returning id into v_disc;
  end if;

  update analytics.job_stage
     set status = 'received', received_on = p_occurred_on, worker_id = p_worker_id, assignee_name = p_assignee,
         qty_in = v_qin,
         weight_in_g = p_weight_in
   where id = v_t.id
   returning * into v_t2;

  if v_job.weight_start_g is null and p_weight_in is not null and v_t.weigh_required then
    update analytics.job set weight_start_g = p_weight_in where id = p_job_id;
  end if;

  perform analytics.job_event_write(p_job_id, v_t.id, 'stage_receive', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
    jsonb_build_object('stage_code', v_t.stage_code,
                       'auto_closed_prev', v_auto, 'handoff_gap_g', v_gap,
                       'before', analytics.job_stage_state(v_t), 'after', analytics.job_stage_state(v_t2)));
  if v_disc is not null then
    perform analytics.job_event_write(p_job_id, v_p.id, 'discrepancy', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
      jsonb_build_object('discrepancy_id', v_disc, 'qty', v_base - v_qin, 'expected', v_base, 'received', v_qin,
                         'from_stage_code', v_p.stage_code, 'to_stage_code', v_t.stage_code));
  end if;
  perform analytics.job_tree_check(p_job_id);

  select d.name_th into v_def from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_t.stage_code;
  return jsonb_build_object('ok', true, 'action', 'receive', 'job_no', v_job.job_no, 'stage_seq', v_t.seq, 'stage_code', v_t.stage_code,
                            'stage_name', v_def, 'received_on', p_occurred_on, 'qty_in', v_t2.qty_in, 'weight_in_g', v_t2.weight_in_g,
                            'prev_auto_closed', v_auto is not null,
                            'handoff_gap_g', case when v_job.metal = 'gold' then null else v_gap end)
         || case when v_disc is not null then jsonb_build_object('discrepancy_qty', v_base - v_qin, 'discrepancy_id', v_disc) else '{}'::jsonb end;
end;
$f$;

create or replace function analytics.job_core_send(p_job_id uuid, p_expected_seq integer, p_occurred_on date, p_weight_out numeric, p_qty_scrap integer, p_scrap_reason text, p_metal_added numeric, p_weight_note text, p_scrap_weight numeric, p_worker_id uuid, p_channel text, p_actor uuid, p_device_hint text, p_enforce_holder boolean)
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
  v_hold   int;
  v_total  int;
  v_final_reason text;
begin
  -- 0181: ส่งส่วนที่เหลือหลังแยกส่วน — ผู้ถือ = เข้า − เสียที่บันทึกไว้ − แยกออก · ของเสียสะสม (ที่บันทึกตอนแยก + ตอนนี้) · qty_out = เข้า − เสียรวม − แยกออก (ไม่แยก ⇒ นิยามเดิมเป๊ะ)
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

  -- จำนวน: เข้า = ออก + เสีย + แยกออก · ของหายต้องเป็นเสียเหตุผล missing (ไม่มีช่อง "หายเฉยๆ")
  v_hold := v_s.qty_in - v_s.qty_scrap - v_s.qty_split_out;
  if v_scrap < 0 or v_scrap > v_hold then
    return analytics.job_fail('qty_invalid', format('จำนวนของเสียต้องอยู่ระหว่าง 0 ถึง %s ชิ้น', v_hold));
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
  -- 0181 (H2): หักน้ำหนักที่แยกออกเป็นส่วนย่อยแล้ว (ทองที่ขั้นชั่ง) — ไม่แยก = 0 เท่าเดิมเป๊ะ
  if p_weight_out is not null and v_s.weight_in_g is not null and p_weight_out > v_s.weight_in_g + v_added - v_s.weight_split_out_g then
    return analytics.job_fail('weight_over',
      format('น้ำหนักออกมากกว่าน้ำหนักเข้า %s g — ถ้าเติมโลหะให้ระบุเติมโลหะพร้อมหมายเหตุ',
             trim_scale(p_weight_out - v_s.weight_in_g - v_added + v_s.weight_split_out_g)::text));
  end if;
  -- 0178 M1: เศษต้องไม่เกินส่วนที่หายไป (loss = in + added - out - scrap ต้อง >= 0) · คำนวณเฉพาะเมื่อมีทั้งน้ำหนักเข้า/ออก (ตรงกับ v_job_stage_loss) · ค่าใดเป็น null = ข้าม (ไม่ใช่ผ่านหรือตก — ไม่มี loss ให้บิดเบือน)
  v_room := case when p_weight_out is not null and v_s.weight_in_g is not null then v_s.weight_in_g + v_added - p_weight_out - v_s.weight_split_out_g end;
  if p_scrap_weight is not null and v_room is not null and p_scrap_weight > v_room then
    return analytics.job_fail('scrap_over', 'น้ำหนักเศษมากกว่าส่วนที่หายไป — ชั่งใหม่');
  end if;

  v_total := v_s.qty_scrap + v_scrap;
  -- เหตุผลของเสียของขั้น = 1 ค่า: ของเสียใหม่เหตุผลเดียวกับที่บันทึกไว้ตอนแยก = คงเดิม · ต่างกัน = 'other' (เหตุผลแต่ละครั้งอยู่ใน event scrap/split)
  v_final_reason := case when v_scrap = 0 then v_s.scrap_reason
                         when v_s.qty_scrap = 0 then v_reason
                         when v_reason = v_s.scrap_reason then v_reason
                         else 'other' end;
  update analytics.job_stage
     set status = 'sent', sent_on = p_occurred_on, qty_out = qty_in - v_total - qty_split_out, qty_scrap = v_total, scrap_reason = v_final_reason,
         weight_out_g = p_weight_out, metal_added_g = v_added, weight_note = v_note, scrap_weight_g = p_scrap_weight
   where id = v_s.id
   returning * into v_s2;

  perform analytics.job_event_write(p_job_id, v_s.id, 'stage_send', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
    jsonb_build_object('stage_code', v_s.stage_code, 'auto_closed', false,
                       'before', analytics.job_stage_state(v_s), 'after', analytics.job_stage_state(v_s2)));
  perform analytics.job_tree_check(p_job_id);

  select s.seq, s.stage_code, d.name_th into v_next
    from analytics.job_stage s
    join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
   where s.job_id = p_job_id and s.status = 'pending' order by s.seq limit 1;
  select d.name_th into v_def from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_s.stage_code;

  return jsonb_build_object('ok', true, 'action', 'send', 'job_no', v_job.job_no, 'stage_seq', v_s.seq, 'stage_code', v_s.stage_code,
                            'stage_name', v_def, 'sent_on', p_occurred_on, 'qty_out', v_s2.qty_out, 'qty_scrap', v_s2.qty_scrap,
                            'weight_out_g', v_s2.weight_out_g,
                            'next_stage', case when v_next.stage_code is null then null
                                          else jsonb_build_object('seq', v_next.seq, 'code', v_next.stage_code, 'name', v_next.name_th) end)
         || case when v_s.qty_split_out > 0 then jsonb_build_object('qty_split_out', v_s.qty_split_out) else '{}'::jsonb end;
end;
$f$;

-- ด่านระดับต้นไม้: ผลรวมจำนวนของใบแม่ + ส่วนทั้งหมดต้องตรง (ดู v_job_tree_drift) · ไม่ตรง = raise ทั้งทรานแซกชันถอย · ข้อความไม่มี UUID
create or replace function analytics.job_tree_assert(p_root_job_id uuid)
 returns void
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare v_bad text;
begin
  select string_agg(distinct d.check_code, ',') into v_bad from analytics.v_job_tree_drift d where d.root_job_id = p_root_job_id;
  if v_bad is not null then
    raise exception 'ผลรวมจำนวนชิ้นของใบงานและส่วนย่อยไม่ตรงกัน — ระบบถอยรายการนี้ [%]', v_bad using errcode = '22023', hint = 'tree_sum_mismatch';
  end if;
end;
$f$;

-- เรียกท้ายทุก core ที่แตะจำนวน: ต้นไม้ที่ไม่มีส่วน/แยก/ส่วนต่าง (ใบเดิมทุกใบ) ข้ามทันที — พฤติกรรม J1 ไม่เปลี่ยน
create or replace function analytics.job_tree_check(p_job_id uuid)
 returns void
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare v_root uuid;
begin
  select coalesce(j.parent_job_id, j.id) into v_root from analytics.job j where j.id = p_job_id;
  if v_root is null then
    return;
  end if;
  if not exists (select 1 from analytics.job c where c.parent_job_id = v_root)
     and not exists (select 1 from analytics.job_stage s where s.job_id = v_root and s.qty_split_out > 0)
     and not exists (select 1 from analytics.job_discrepancy d where d.root_job_id = v_root) then
    return;
  end if;
  perform analytics.job_tree_assert(v_root);
end;
$f$;

-- แยกส่วน (ภายใน): ส่ง n จากที่ถือ N → ส่วนใหม่ (แถว job + ขั้นคัดลอกจากผู้แยก) · ผู้ถือเดิมเหลือ ≥ 1 ชิ้น
-- p_job_id = ใบที่ถือขั้นนั้น (ใบแม่หรือส่วนย่อย — แยกซ้อนได้แต่ส่วนใหม่ชี้ใบแม่เดิมเสมอ) · p_qty_hold = จำนวนที่ผู้เรียกเห็น (กัน 2 มือถือแยกซ้ำ → stage_changed) · น้ำหนักทุกชนิดห้ามส่งมา (มติ ค1)
create or replace function analytics.job_lot_split_core(p_job_id uuid, p_expected_seq integer, p_qty integer, p_qty_hold integer, p_qty_scrap integer, p_scrap_reason text,
                                                        p_weight_out numeric, p_metal_added numeric, p_scrap_weight numeric, p_weight_note text, p_weight_move numeric,
                                                        p_worker_id uuid, p_channel text, p_actor uuid, p_device_hint text, p_enforce_holder boolean)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_h      analytics.job%rowtype;
  v_root   analytics.job%rowtype;
  v_s      analytics.job_stage%rowtype;
  v_s2     analytics.job_stage%rowtype;
  v_ns     analytics.job_stage%rowtype;
  v_lot    analytics.job%rowtype;
  v_today  date := analytics.job_today();
  v_scrap  int := coalesce(p_qty_scrap, 0);
  v_hold   int;
  v_reason text := null;
  v_name   text;
  v_seq    int;
  v_lot_seq int;
  v_weigh  boolean;
  v_new_s  uuid;
  v_who_a  uuid;
  v_who_n  text;
  v_next   record;
  v_final_reason text;
  v_gold_w boolean;
  r        analytics.job_stage%rowtype;
  v_cur    analytics.job_stage%rowtype;
begin
  -- 0181 (design §3): ล็อกใบแม่ก่อนทุกอย่าง (ผู้เรียกล็อกไว้แล้ว — ล็อกซ้ำไม่มีผล) = ล็อกทั้งต้นไม้ · ไม่มีน้ำหนัก ไม่มีวันที่รับเข้า (ใช้วันนี้เวลาไทยเสมอ)
  select * into v_h from analytics.job where id = p_job_id;
  if not found then
    return analytics.job_fail('job_not_found', 'ไม่พบใบงาน');
  end if;
  select * into v_root from analytics.job where id = coalesce(v_h.parent_job_id, v_h.id) for update;
  select * into v_h from analytics.job where id = p_job_id;
  if v_h.status in ('done', 'cancelled') then
    return analytics.job_fail('job_closed', 'ใบงานนี้ปิดแล้ว แยกส่วนไม่ได้');
  end if;
  if v_h.status = 'on_hold' then
    return analytics.job_fail('job_on_hold', 'ใบงานนี้ถูกพักไว้ แยกส่วนไม่ได้ — แจ้งออฟฟิศ');
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
    return analytics.job_fail('not_received', 'ขั้นนี้ยังไม่ได้รับงาน แยกส่วนไม่ได้');
  end if;
  if p_enforce_holder and v_s.worker_id is distinct from p_worker_id then
    select coalesce(w.display_name, v_s.assignee_name, 'ผู้ถืออื่น') into v_name
      from (select 1) x left join analytics.worker w on w.id = v_s.worker_id;
    return analytics.job_fail('not_holder', format('งานนี้อยู่กับ %s ไม่ใช่คุณ', v_name), jsonb_build_object('by', v_name));
  end if;
  v_hold := v_s.qty_in - v_s.qty_scrap - v_s.qty_split_out;
  -- กัน 2 มือถือแยกส่วนเดียวกัน/กดซ้ำ: จำนวนที่ถืออยู่ต้องตรงกับที่ผู้เรียกเห็น · ช่องช่าง (worker_qr) บังคับส่งมาเสมอ — ไม่งั้นกดซ้ำแล้วเกิดส่วนซ้ำ
  -- L4 (security): บังคับทุกช่องทาง (ออฟฟิศด้วย) — กดซ้ำจากหน้าออฟฟิศก็สร้างส่วนซ้ำได้เหมือนกัน
  if p_qty_hold is null then
    return analytics.job_fail('qty_hold_required', 'ต้องระบุจำนวนที่ถืออยู่ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  if p_qty_hold is not null and p_qty_hold is distinct from v_hold then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  -- มติ ค1: ตอนแยกนับจำนวนอย่างเดียว — ห้ามส่งน้ำหนักออก/เติมโลหะ/เศษ/หมายเหตุน้ำหนักมาด้วย (ข้อความไม่มีตัวเลข)
  if p_weight_out is not null or coalesce(p_metal_added, 0) <> 0 or p_scrap_weight is not null or nullif(btrim(p_weight_note), '') is not null then
    return analytics.job_fail('weight_unexpected', 'การแยกส่วนนับจำนวนอย่างเดียว ไม่ต้องชั่งน้ำหนัก — โหลดหน้าใหม่');
  end if;
  -- H2 (security · มติเจ้าของ 19 ต.ค.: ทองชั่งตอนแบ่ง): เฉพาะทอง + ขั้นที่ตั้งชั่ง (weigh_required ตามแบบการบันทึก) ต้องชั่งน้ำหนักส่วนที่แยกออก (p_weight_move) —
  -- ส่วนใหม่เก็บเป็นน้ำหนักออกของขั้นแยก ให้ผู้รับขั้นถัดไปชั่งเทียบ ±0.05 g เหมือนส่งต่อปกติ · เงิน/ขั้นไม่ชั่ง = นับจำนวนอย่างเดียว (ค1) ส่งน้ำหนักมา = weight_unexpected
  v_gold_w := v_root.metal = 'gold' and v_s.weigh_required;
  if v_gold_w then
    if p_weight_move is null then
      return analytics.job_fail('weight_move_required', 'ทองที่ขั้นชั่ง: ต้องชั่งน้ำหนักส่วนที่แยกออกก่อน');
    end if;
    if p_weight_move <= 0 or not analytics.job_weight_ok(p_weight_move) then
      return analytics.job_fail('weight_invalid', 'น้ำหนักส่วนที่แยกออกต้องมากกว่า 0 และไม่เกิน 100,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)');
    end if;
    if v_s.weight_in_g is null or p_weight_move + v_s.weight_split_out_g >= v_s.weight_in_g + v_s.metal_added_g then
      return analytics.job_fail('weight_move_over', 'น้ำหนักส่วนที่แยกออกมากเกินน้ำหนักที่ถืออยู่ — ต้องเหลือน้ำหนักให้ผู้ถือ ชั่งใหม่');
    end if;
  elsif p_weight_move is not null then
    return analytics.job_fail('weight_unexpected', 'การแยกส่วนนับจำนวนอย่างเดียว ไม่ต้องชั่งน้ำหนัก — โหลดหน้าใหม่');
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 100000 or v_scrap < 0 or v_scrap > 100000 or p_qty + v_scrap > v_hold - 1 then
    return analytics.job_fail('qty_invalid', 'จำนวนที่แยก (รวมของเสีย) ต้องมากกว่า 0 และต้องเหลือกับผู้ถืออย่างน้อย 1 ชิ้น — ถ้าส่งทั้งหมดให้ใช้ส่งต่อปกติ');
  end if;
  if v_scrap > 0 then
    v_reason := nullif(btrim(p_scrap_reason), '');
    if v_reason is null or not analytics.job_scrap_reason_valid(v_reason) then
      return analytics.job_fail('reason_required', 'ของเสียต้องระบุเหตุผล (รูพรุน/หัก/ผิดแบบ/หาย/อื่นๆ)');
    end if;
  elsif nullif(btrim(p_scrap_reason), '') is not null then
    return analytics.job_fail('reason_unexpected', 'ไม่มีของเสีย จึงไม่ต้องระบุเหตุผลของเสีย');
  end if;
  if v_s.received_on > v_today then
    return analytics.job_fail('date_invalid', 'วันที่รับงานของขั้นนี้อยู่ในอนาคต แยกส่วนไม่ได้');
  end if;

  -- เลขส่วน: รันต่อจากเลขสูงสุดของใบแม่ (รวมส่วนที่ยกเลิก — ไม่ใช้ซ้ำ) · เลขใบงาน (seq) กินจากตัวนับร้านเหมือนใบทั่วไป (job_no ของส่วนไม่ใช้บนจอ)
  select coalesce(max(l.lot_seq), 0) + 1 into v_lot_seq from analytics.job l where l.parent_job_id = v_root.id;
  insert into analytics.job_counter as c (shop_id, last_no) values (v_root.shop_id, 1)
  on conflict (shop_id) do update set last_no = c.last_no + 1
  returning c.last_no into v_seq;
  -- ส่วนใหม่ไม่ชั่ง ⇒ weigh_required = มีขั้นหลังขั้นแยกที่ต้องชั่ง (ค่าเริ่มของ job_profile_apply: exists ขั้น weigh_required)
  select exists (select 1 from analytics.job_stage x where x.job_id = p_job_id and x.seq > v_s.seq and x.status <> 'skipped' and x.weigh_required) or v_gold_w into v_weigh;

  insert into analytics.job (shop_id, seq, source_kind, oem_quote_item_id, root_quote_id, oem_item_seq, production_order_item_id, product_id,
                             design_label, sku_snapshot, metal, qty_planned, qty_order, weigh_required, due_date, created_by,
                             profile_id, profile_name, require_final_weight, parent_job_id, lot_seq)
  values (v_root.shop_id, v_seq, v_root.source_kind, v_root.oem_quote_item_id, v_root.root_quote_id, v_root.oem_item_seq, v_root.production_order_item_id,
          v_root.product_id, v_root.design_label, v_root.sku_snapshot, v_root.metal, p_qty, p_qty, v_weigh, v_root.due_date,
          coalesce(p_actor, v_root.created_by), v_root.profile_id, v_root.profile_name, v_root.require_final_weight, v_root.id, v_lot_seq)
  returning * into v_lot;

  -- ขั้นของส่วนใหม่ = ขั้นของผู้แยก (flag ชั่ง/ของเสียลอก ยกเว้นขั้นแยก weigh_required = false) · ขั้นที่ผู้แยกยังไม่ถึง = pending/ที่ข้ามไว้คงข้าม
  for r in select s.* from analytics.job_stage s where s.job_id = p_job_id order by s.seq loop
    insert into analytics.job_stage (job_id, shop_id, stage_code, seq, weigh_required, scrap_qty_ask, scrap_weight_ask, split_from_stage_id)
    values (v_lot.id, v_lot.shop_id, r.stage_code, r.seq, case when r.id = v_s.id then v_gold_w else r.weigh_required end,
            r.scrap_qty_ask, r.scrap_weight_ask, case when r.id = v_s.id then v_s.id end);
  end loop;
  perform analytics.job_event_write(v_lot.id, null, 'create', v_today, p_actor, p_worker_id, p_channel, p_device_hint,
    jsonb_build_object('kind', 'split_lot', 'parent_job_id', v_root.id, 'lot_seq', v_lot_seq, 'qty_planned', p_qty,
                       'from_job_id', p_job_id, 'from_stage_code', v_s.stage_code, 'metal', v_root.metal, 'profile_id', v_root.profile_id));

  -- ผู้ถือเดิมของขั้นที่แยก = ผู้ส่งของส่วนใหม่ (ออฟฟิศแยกแทน — ผู้ทำจริงอยู่ใน event)
  v_who_a := v_s.worker_id;
  v_who_n := v_s.assignee_name;
  for r in select s.* from analytics.job_stage s where s.job_id = v_lot.id order by s.seq loop
    if r.seq < v_s.seq then
      update analytics.job_stage set status = 'skipped', skip_reason = 'split_inherit' where id = r.id returning * into v_ns;
      perform analytics.job_event_write(v_lot.id, r.id, 'stage_skip', v_today, p_actor, p_worker_id, p_channel, p_device_hint,
        jsonb_build_object('stage_code', r.stage_code, 'reason', 'split_inherit', 'before', analytics.job_stage_state(r), 'after', analytics.job_stage_state(v_ns)));
    elsif r.seq = v_s.seq then
      update analytics.job_stage
         set status = 'received', received_on = v_s.received_on, worker_id = v_who_a, assignee_name = v_who_n, qty_in = p_qty,
             weight_in_g = case when v_gold_w then p_weight_move end
       where id = r.id returning * into v_ns;
      perform analytics.job_event_write(v_lot.id, r.id, 'stage_receive', v_s.received_on, p_actor, p_worker_id, p_channel, p_device_hint,
        jsonb_build_object('stage_code', r.stage_code, 'split_inherit', true, 'before', analytics.job_stage_state(r), 'after', analytics.job_stage_state(v_ns)));
      v_new_s := r.id;
      v_cur := v_ns;
      update analytics.job_stage set status = 'sent', sent_on = v_today, qty_out = p_qty, weight_out_g = case when v_gold_w then p_weight_move end where id = v_cur.id returning * into v_ns;
      perform analytics.job_event_write(v_lot.id, v_cur.id, 'stage_send', v_today, p_actor, p_worker_id, p_channel, p_device_hint,
        jsonb_build_object('stage_code', v_cur.stage_code, 'auto_closed', false, 'split_inherit', true, 'before', analytics.job_stage_state(v_cur), 'after', analytics.job_stage_state(v_ns)));
    elsif exists (select 1 from analytics.job_stage o where o.job_id = p_job_id and o.seq = r.seq and o.status = 'skipped') then
      -- ขั้นหลังขั้นแยกที่ผู้แยกถูกข้ามไว้ (ออฟฟิศตัดสินว่างานนี้ไม่ผ่านขั้นนั้น) — ส่วนใหม่ข้ามตามเดิม
      update analytics.job_stage set status = 'skipped', skip_reason = (select o.skip_reason from analytics.job_stage o where o.job_id = p_job_id and o.seq = r.seq)
       where id = r.id returning * into v_ns;
      perform analytics.job_event_write(v_lot.id, r.id, 'stage_skip', v_today, p_actor, p_worker_id, p_channel, p_device_hint,
        jsonb_build_object('stage_code', r.stage_code, 'reason', v_ns.skip_reason, 'before', analytics.job_stage_state(r), 'after', analytics.job_stage_state(v_ns)));
    end if;
  end loop;

  -- ขั้นต้นทาง: บันทึกของเสียที่หายตอนแยก + จำนวนที่แยกออก (statement เดียว — guard ตรวจโซ่/เหลือ ≥ 1/ผูกกับส่วนที่ชี้ขั้นนี้)
  v_final_reason := case when v_scrap = 0 then v_s.scrap_reason
                         when v_s.qty_scrap = 0 then v_reason
                         when v_reason = v_s.scrap_reason then v_reason
                         else 'other' end;
  update analytics.job_stage
     set qty_split_out = qty_split_out + p_qty, qty_scrap = qty_scrap + v_scrap, scrap_reason = v_final_reason,
         weight_split_out_g = weight_split_out_g + case when v_gold_w then p_weight_move else 0 end
   where id = v_s.id
   returning * into v_s2;
  if v_scrap > 0 then
    perform analytics.job_event_write(p_job_id, v_s.id, 'scrap', v_today, p_actor, p_worker_id, p_channel, p_device_hint,
      jsonb_build_object('kind', 'split', 'qty', v_scrap, 'reason', v_reason, 'stage_code', v_s.stage_code));
  end if;
  perform analytics.job_event_write(p_job_id, v_s.id, 'split', v_today, p_actor, p_worker_id, p_channel, p_device_hint,
    jsonb_build_object('lot_job_id', v_lot.id, 'lot_seq', v_lot_seq, 'qty', p_qty, 'scrap_qty', v_scrap, 'stage_code', v_s.stage_code, 'weight_move_g', case when v_gold_w then p_weight_move end,
                       'before', analytics.job_stage_state(v_s), 'after', analytics.job_stage_state(v_s2)));
  perform analytics.job_tree_check(p_job_id);

  select s.seq, s.stage_code, d.name_th into v_next
    from analytics.job_stage s join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
   where s.job_id = v_lot.id and s.status = 'pending' order by s.seq limit 1;
  return jsonb_build_object('ok', true, 'action', 'split', 'lot_job_id', v_lot.id, 'lot_seq', v_lot_seq,
                            'label', v_root.job_no || ' · ส่วนที่ ' || v_lot_seq, 'qty', p_qty,
                            'parent_remaining', v_hold - p_qty - v_scrap, 'stage_seq', v_s.seq, 'stage_code', v_s.stage_code,
                            'next_stage', case when v_next.stage_code is null then null
                                          else jsonb_build_object('seq', v_next.seq, 'code', v_next.stage_code, 'name', v_next.name_th) end);
end;
$f$;

-- ยกเลิกส่วน (ภายใน): return_to_parent = คืนชิ้นให้ขั้นแม่ที่ยัง received · scrap = ชิ้น live ตอนนี้นับเป็นของเสียของต้นไม้ (ต้องมีเหตุผล) — ไม่มี "หายเฉยๆ"
create or replace function analytics.job_lot_cancel_core(p_lot_job_id uuid, p_disposition text, p_reason text, p_scrap_reason text, p_scrap_weight numeric,
                                                         p_worker_id uuid, p_channel text, p_actor uuid, p_device_hint text, p_enforce_splitter boolean)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_l      analytics.job%rowtype;
  v_ms     analytics.job_stage%rowtype;
  v_ms2    analytics.job_stage%rowtype;
  v_s2     analytics.job_stage%rowtype;
  v_blk    text;
  v_live   int;
  v_today  date := analytics.job_today();
  v_sreason text := null;
  v_who    uuid;
  v_wreq   boolean;
  v_wbasis numeric;
begin
  -- 0181 (M-C security: ทอง + ส่วนมีขั้นชั่ง + นับเป็นของเสีย ⇒ ต้องชั่งน้ำหนักของเสียที่เลิกใช้ ไม่งั้นทองหายจากยอดเงียบๆ)
  select * into v_l from analytics.job where id = p_lot_job_id;
  if not found or v_l.parent_job_id is null then
    return analytics.job_fail('not_lot', 'ไม่พบส่วนย่อยนี้');
  end if;
  perform 1 from analytics.job where id = v_l.parent_job_id for update;
  select * into v_l from analytics.job where id = p_lot_job_id;
  if p_disposition is null or p_disposition not in ('return_to_parent', 'scrap') then
    return analytics.job_fail('disposition_invalid', 'ต้องเลือกที่ไปของชิ้น: คืนให้ผู้ถือเดิม หรือนับเป็นของเสีย');
  end if;
  if v_l.status in ('done', 'cancelled') then
    return analytics.job_fail('job_closed', 'ส่วนนี้ปิดหรือยกเลิกไปแล้ว');
  end if;
  if exists (select 1 from analytics.job_discrepancy d where d.job_id = p_lot_job_id and d.status = 'open'
               and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d.id)) then
    return analytics.job_fail('discrepancy_open', 'ส่วนนี้มีส่วนต่างรอชี้แจง — ชี้แจงก่อนจึงยกเลิกได้');
  end if;
  if exists (select 1 from analytics.job_stage x join analytics.job c on c.id = x.job_id
              where x.split_from_stage_id in (select s.id from analytics.job_stage s where s.job_id = p_lot_job_id)
                and not (c.status = 'cancelled' and c.cancel_scrap_qty is null)) then
    return analytics.job_fail('has_split', 'ส่วนนี้มีส่วนที่แยกต่อออกไปแล้ว — ยกเลิกส่วนนั้นก่อน');
  end if;
  select * into v_s2 from analytics.job_stage where job_id = p_lot_job_id and split_from_stage_id is not null;
  select * into v_ms from analytics.job_stage where id = v_s2.split_from_stage_id;
  v_wreq := p_disposition = 'scrap' and v_l.metal = 'gold'
            and exists (select 1 from analytics.job_stage x where x.job_id = p_lot_job_id and x.status <> 'skipped' and x.weigh_required);
  if p_scrap_weight is not null and not v_wreq then
    return analytics.job_fail('weight_unexpected', 'ส่วนนี้ไม่ต้องระบุน้ำหนักของเสีย');
  end if;

  if p_disposition = 'return_to_parent' then
    v_blk := analytics.job_lot_return_blocker(p_lot_job_id);
    if v_blk is not null then
      return analytics.job_fail(v_blk, case v_blk
        when 'already_received' then 'มีคนรับส่วนนี้ไปแล้ว — ช่างยกเลิกเองไม่ได้ แจ้งออฟฟิศ'
        when 'cannot_return' then 'ผู้ถือเดิมส่งต่อส่วนที่เหลือไปแล้ว คืนชิ้นไม่ได้ — แจ้งออฟฟิศ'
        when 'scrap_recorded' then 'การแยกครั้งนี้มีของเสียที่บันทึกไว้ คืนชิ้นไม่ได้ — แจ้งออฟฟิศ (ยกเลิกเป็นของเสีย)'
        when 'has_discrepancy' then 'ส่วนนี้มีส่วนต่างบันทึกอยู่ — แจ้งออฟฟิศ'
        else 'ยกเลิกส่วนนี้ไม่ได้' end);
    end if;
    -- ช่าง: ยกเลิกได้เฉพาะส่วนที่ตัวเองแยก (ตาม event split) และยังเป็นผู้ถือขั้นแม่ — ออฟฟิศไม่ถูกจำกัด
    if p_enforce_splitter then
      select e.worker_id into v_who from analytics.job_event e
       where e.job_id = v_ms.job_id and e.event_type = 'split' and e.payload ->> 'lot_job_id' = p_lot_job_id::text limit 1;
      if v_who is distinct from p_worker_id or v_ms.worker_id is distinct from p_worker_id then
        return analytics.job_fail('not_splitter', 'ยกเลิกได้เฉพาะส่วนที่คุณแยกเอง และยังเป็นผู้ถือขั้นนี้');
      end if;
    end if;
  else
    if p_enforce_splitter then
      return analytics.job_fail('disposition_invalid', 'ช่างยกเลิกได้เฉพาะแบบคืนชิ้นให้ผู้ถือเดิม');
    end if;
    v_sreason := nullif(btrim(p_scrap_reason), '');
    if v_sreason is null or not analytics.job_scrap_reason_valid(v_sreason) then
      return analytics.job_fail('reason_required', 'ยกเลิกเป็นของเสียต้องระบุเหตุผล (รูพรุน/หัก/ผิดแบบ/หาย/อื่นๆ)');
    end if;
  end if;
  if v_wreq then
    if p_scrap_weight is null then
      return analytics.job_fail('scrap_weight_required', 'ทอง: ยกเลิกเป็นของเสียต้องชั่งน้ำหนักของเสียที่เลิกใช้');
    end if;
    if p_scrap_weight <= 0 or not analytics.job_weight_ok(p_scrap_weight) then
      return analytics.job_fail('weight_invalid', 'น้ำหนักของเสียต้องมากกว่า 0 และไม่เกิน 100,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)');
    end if;
    -- ไม่เกินน้ำหนักสูงสุดที่ส่วนนี้เคยมี (เข้า + เติมโลหะ / ออก ของทุกขั้น)
    select max(greatest(coalesce(x.weight_in_g + x.metal_added_g, 0), coalesce(x.weight_out_g, 0))) into v_wbasis
      from analytics.job_stage x where x.job_id = p_lot_job_id;
    if p_scrap_weight > coalesce(v_wbasis, 0) then
      return analytics.job_fail('weight_over', 'น้ำหนักของเสียมากกว่าน้ำหนักที่ส่วนนี้มีอยู่ — ชั่งใหม่');
    end if;
  end if;

  v_live := analytics.job_live_qty(p_lot_job_id);
  update analytics.job
     set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason,
         cancel_scrap_qty = case when p_disposition = 'scrap' then v_live end,
         cancel_scrap_reason = case when p_disposition = 'scrap' then v_sreason end,
         cancel_scrap_weight_g = case when v_wreq then p_scrap_weight end
   where id = p_lot_job_id;
  if p_disposition = 'return_to_parent' then
    update analytics.job_stage set qty_split_out = qty_split_out - v_l.qty_planned, weight_split_out_g = weight_split_out_g - coalesce(v_s2.weight_out_g, 0) where id = v_ms.id returning * into v_ms2;
  else
    select * into v_ms2 from analytics.job_stage where id = v_ms.id;
  end if;
  perform analytics.job_event_write(p_lot_job_id, null, 'split_cancel', v_today, p_actor, p_worker_id, p_channel, p_device_hint,
    jsonb_build_object('disposition', p_disposition, 'reason', p_reason, 'qty', v_l.qty_planned, 'live_qty', v_live, 'scrap_reason', v_sreason,
                       'scrap_weight_g', case when v_wreq then p_scrap_weight end));
  perform analytics.job_event_write(v_ms.job_id, v_ms.id, 'split_cancel', v_today, p_actor, p_worker_id, p_channel, p_device_hint,
    jsonb_build_object('lot_job_id', p_lot_job_id, 'lot_seq', v_l.lot_seq, 'disposition', p_disposition, 'qty', v_l.qty_planned, 'live_qty', v_live,
                       'before', analytics.job_stage_state(v_ms), 'after', analytics.job_stage_state(v_ms2)));
  perform analytics.job_tree_check(p_lot_job_id);
  return jsonb_build_object('ok', true, 'action', 'split_cancel', 'lot_job_id', p_lot_job_id, 'lot_seq', v_l.lot_seq,
                            'disposition', p_disposition, 'qty', v_l.qty_planned, 'live_qty', v_live);
end;
$f$;
-- job_source_info (0181): existing_job = ใบแม่เท่านั้น — ส่วนย่อยคัดลอก source จากแม่ ต้องไม่ถูกนับเป็น "รายการนี้มีใบงานอยู่แล้ว" (ฉบับเดิม + เงื่อนไข parent_job_id is null 2 จุด)
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
    v_codes := array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'polish', 'qc', 'pack'];
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
    v_codes := array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'polish', 'qc', 'pack'];
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
$function$;
-- ============================================================================
-- 5. RPC ออฟฟิศ (security definer · p_actor · crm_require_owner_admin ผ่าน job_office_begin) — ฉบับเดิม + ส่วนย่อย
-- ============================================================================
-- job_office_begin: ส่วนย่อยล็อกใบแม่ก่อนเสมอ (ช่างล็อกใบแม่ผ่าน job_worker_auth) — ลำดับล็อกเดียวกันทุกทาง กัน deadlock ระหว่างช่าง/ออฟฟิศที่แตะต้นไม้เดียวกัน
create or replace function analytics.job_office_begin(p_fn text, p_shop_id uuid, p_job_id uuid, p_actor uuid, p_allow_terminal boolean default false)
 returns analytics.job
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job analytics.job%rowtype;
  v_parent uuid;
begin
  -- 0181: ล็อกใบแม่ก่อนถ้า p_job_id เป็นส่วนย่อย
  if p_shop_id is null or p_job_id is null then
    raise exception '%: p_shop_id และ p_job_id จำเป็น', p_fn using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if p_actor is null then
    raise exception '%: ต้องระบุผู้ทำรายการ (p_actor)', p_fn using errcode = '22023', hint = 'actor_required';
  end if;
  select j.parent_job_id into v_parent from analytics.job j where j.id = p_job_id and j.shop_id = p_shop_id;
  if v_parent is not null then
    perform 1 from analytics.job where id = v_parent and shop_id = p_shop_id for update;
  end if;
  select * into v_job from analytics.job where id = p_job_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'ไม่พบใบงานในร้านนี้' using errcode = '22023', hint = 'job_not_found';
  end if;
  if not p_allow_terminal and v_job.status in ('done', 'cancelled') then
    raise exception 'ใบงาน % ปิดแล้ว (%) แก้ไขไม่ได้', v_job.job_no, v_job.status using errcode = '22023', hint = 'job_closed';
  end if;
  return v_job;
end;
$f$;

drop function if exists analytics.job_office_receive(uuid, uuid, integer, date, numeric, uuid, text, text, uuid);
create or replace function analytics.job_office_receive(p_shop_id uuid, p_job_id uuid, p_expected_seq integer, p_occurred_on date, p_weight_in_g numeric default null::numeric, p_worker_id uuid default null::uuid, p_assignee_name text default null::text, p_channel text default 'job_page'::text, p_actor uuid default null::uuid, p_qty_received integer default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor    uuid := coalesce(p_actor, auth.uid());
  v_job      analytics.job%rowtype;
  v_assignee text;
  v_r        jsonb;
begin
  -- 0181: + p_qty_received (รับไม่ครบ ⇒ ส่วนต่างรอชี้แจง) · p_job_id ชี้ส่วนย่อยได้ (ออฟฟิศกรอกแทนส่วนนั้น)
  v_job := analytics.job_office_begin('job_office_receive', p_shop_id, p_job_id, v_actor);
  if p_channel is null or p_channel not in ('job_page', 'daily_sheet') then
    raise exception 'ช่องทางต้องเป็น job_page หรือ daily_sheet' using errcode = '22023', hint = 'channel_invalid';
  end if;
  -- D2: ชื่อผู้รับงานที่ออฟฟิศพิมพ์ ต้องผ่านด่านเดียวกับชื่อช่าง (ห้าม < >) · job_text_clean ก่อน (ตัดช่องว่างทุกชนิด รวม U+3000/NBSP/tab → ว่าง = null ไม่ใช่ error)
  -- แล้ว job_label_clean เฉพาะเมื่อมีชื่อจริง (job_label_clean บังคับต้องมีตัวอักษร จึงเรียกกับค่าว่างไม่ได้)
  v_assignee := analytics.job_text_clean(p_assignee_name, 'ชื่อผู้รับงาน', 60, false);
  if v_assignee is not null then
    v_assignee := analytics.job_label_clean(v_assignee, 'ชื่อผู้รับงาน', 60);
  end if;
  if p_worker_id is not null and not exists (
       select 1 from analytics.worker w where w.id = p_worker_id and w.shop_id = p_shop_id and w.is_active) then
    raise exception 'ไม่พบช่างที่ใช้งานอยู่ในร้านนี้' using errcode = '22023', hint = 'worker_not_found';
  end if;
  v_r := analytics.job_core_receive(p_job_id, p_expected_seq, p_occurred_on, p_weight_in_g, p_worker_id, v_assignee,
                                    p_channel, v_actor, null, false, p_qty_received);
  if not (v_r ->> 'ok')::boolean then
    raise exception '%', v_r ->> 'message' using errcode = '22023', hint = v_r ->> 'code';
  end if;
  return v_r;
end;
$f$;

create or replace function analytics.job_lot_split(p_shop_id uuid, p_job_id uuid, p_expected_seq integer, p_qty integer, p_qty_scrap integer default 0, p_scrap_reason text default null, p_qty_hold integer default null, p_actor uuid default null, p_weight_move_g numeric default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_job   analytics.job%rowtype;
  v_r     jsonb;
begin
  -- 0181: ออฟฟิศแยกส่วนแทน (ทุกขั้นที่ใบถืออยู่ — ไม่จำกัดผู้ถือ) · p_job_id = ใบที่ถือขั้นนั้น (แม่/ส่วน) · ไม่ชั่ง · ช่อง job_page
  v_job := analytics.job_office_begin('job_lot_split', p_shop_id, p_job_id, v_actor);
  v_r := analytics.job_lot_split_core(p_job_id, p_expected_seq, p_qty, p_qty_hold, p_qty_scrap, p_scrap_reason, null, null, null, null, p_weight_move_g,
                                      null, 'job_page', v_actor, null, false);
  if not (v_r ->> 'ok')::boolean then
    raise exception '%', v_r ->> 'message' using errcode = '22023', hint = v_r ->> 'code';
  end if;
  return v_r;
end;
$f$;

create or replace function analytics.job_lot_cancel(p_shop_id uuid, p_lot_job_id uuid, p_reason text, p_disposition text, p_scrap_reason text default null, p_actor uuid default null, p_scrap_weight_g numeric default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor  uuid := coalesce(p_actor, auth.uid());
  v_job    analytics.job%rowtype;
  v_reason text;
  v_r      jsonb;
begin
  -- 0181: ออฟฟิศยกเลิกส่วนได้ทุกเมื่อ + เหตุผล + ที่ไปของชิ้น (return_to_parent | scrap) — ไม่มี "หายเฉยๆ"
  v_job := analytics.job_office_begin('job_lot_cancel', p_shop_id, p_lot_job_id, v_actor);
  v_reason := analytics.job_text_clean(p_reason, 'เหตุผลที่ยกเลิกส่วน', 200, true);
  v_r := analytics.job_lot_cancel_core(p_lot_job_id, p_disposition, v_reason, p_scrap_reason, p_scrap_weight_g, 'job_page', v_actor, null, false);
  if not (v_r ->> 'ok')::boolean then
    raise exception '%', v_r ->> 'message' using errcode = '22023', hint = v_r ->> 'code';
  end if;
  return v_r;
end;
$f$;

create or replace function analytics.job_discrepancy_resolve(p_shop_id uuid, p_discrepancy_id uuid, p_kind text, p_reason text, p_actor uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor  uuid := coalesce(p_actor, auth.uid());
  v_d      analytics.job_discrepancy%rowtype;
  v_job    analytics.job%rowtype;
  v_reason text;
begin
  -- 0181: ออฟฟิศชี้แจงส่วนต่างแทนผู้ส่งได้ทุกแถว open (scrap/lost + เหตุผล) · ครั้งเดียว
  if p_discrepancy_id is null then
    raise exception 'job_discrepancy_resolve: p_discrepancy_id จำเป็น' using errcode = '22023', hint = 'discrepancy_not_found';
  end if;
  select * into v_d from analytics.job_discrepancy where id = p_discrepancy_id and shop_id = p_shop_id;
  if not found then
    raise exception 'ไม่พบส่วนต่างนี้ในร้านนี้' using errcode = '22023', hint = 'discrepancy_not_found';
  end if;
  v_job := analytics.job_office_begin('job_discrepancy_resolve', p_shop_id, v_d.job_id, v_actor);
  select * into v_d from analytics.job_discrepancy where id = p_discrepancy_id;
  if v_d.status <> 'open' or exists (select 1 from analytics.job_discrepancy v where v.void_of_id = v_d.id) then
    raise exception 'ส่วนต่างนี้ชี้แจงแล้วหรือถูกยกเลิกแล้ว' using errcode = '22023', hint = 'already_resolved';
  end if;
  if p_kind is null or p_kind not in ('scrap', 'lost') then
    raise exception 'ต้องเลือกว่าเสียหาย (scrap) หรือหาย (lost)' using errcode = '22023', hint = 'kind_invalid';
  end if;
  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null or not analytics.job_scrap_reason_valid(v_reason) then
    raise exception 'ต้องระบุเหตุผล (รูพรุน/หัก/ผิดแบบ/หาย/อื่นๆ)' using errcode = '22023', hint = 'reason_required';
  end if;
  -- M-B (security): ทองที่น้ำหนักหายเกินสัดส่วนชิ้นที่ขาด (excess < -0.05 g) ต้องมีข้อความอธิบายจริง ไม่ใช่แค่รหัสเหตุผล — ปิดทองหายเงียบๆ ด้วยปุ่มเดียว
  if analytics.job_disc_excess_g(v_d.weight_gap_g, v_d.weight_sent_g, v_d.qty, v_d.qty_sent) < -0.05
     and v_job.metal = 'gold'
     and (v_reason = any (array['porosity', 'broken', 'wrong_design', 'missing', 'other']) or not analytics.oem_note_present(v_reason)) then
    raise exception 'ทอง: น้ำหนักหายมากกว่าสัดส่วนชิ้นที่ขาด — ต้องเขียนคำอธิบายเป็นข้อความ (ไม่ใช่แค่เลือกรหัสเหตุผล)' using errcode = '22023', hint = 'note_required';
  end if;
  update analytics.job_discrepancy
     set status = 'resolved', resolved_kind = p_kind, resolved_reason = v_reason, resolved_by_actor = v_actor, resolved_at = clock_timestamp()
   where id = p_discrepancy_id;
  perform analytics.job_event_write(v_d.job_id, v_d.from_stage_id, 'discrepancy_resolve', analytics.job_today(), v_actor, null, 'job_page', null,
    jsonb_build_object('discrepancy_id', v_d.id, 'qty', v_d.qty, 'kind', p_kind, 'reason', v_reason));
  perform analytics.job_tree_check(v_d.job_id);
  return jsonb_build_object('ok', true, 'discrepancy_id', v_d.id, 'qty', v_d.qty, 'kind', p_kind);
end;
$f$;

create or replace function analytics.job_discrepancy_void(p_shop_id uuid, p_discrepancy_id uuid, p_reason text, p_actor uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor  uuid := coalesce(p_actor, auth.uid());
  v_d      analytics.job_discrepancy%rowtype;
  v_job    analytics.job%rowtype;
  v_reason text;
  v_to     analytics.job_stage%rowtype;
  v_new    uuid;
begin
  -- 0181: ออฟฟิศ void ส่วนต่าง (ของไม่ได้หายจริง/บันทึกผิด) = แถวใหม่ชี้แถวเดิม ไม่แก้แถวเดิม · ทำได้เมื่อขั้นผู้รับถูกย้อนเป็น pending แล้ว (ชิ้นกลับเข้าโซ่ได้ทางเดียว: ผู้รับรับใหม่ด้วยจำนวนเต็ม)
  if p_discrepancy_id is null then
    raise exception 'job_discrepancy_void: p_discrepancy_id จำเป็น' using errcode = '22023', hint = 'discrepancy_not_found';
  end if;
  select * into v_d from analytics.job_discrepancy where id = p_discrepancy_id and shop_id = p_shop_id;
  if not found then
    raise exception 'ไม่พบส่วนต่างนี้ในร้านนี้' using errcode = '22023', hint = 'discrepancy_not_found';
  end if;
  v_job := analytics.job_office_begin('job_discrepancy_void', p_shop_id, v_d.job_id, v_actor);
  select * into v_d from analytics.job_discrepancy where id = p_discrepancy_id;
  v_reason := analytics.job_text_clean(p_reason, 'เหตุผลที่ยกเลิกส่วนต่าง', 200, true);
  if v_d.status not in ('open', 'resolved') or exists (select 1 from analytics.job_discrepancy v where v.void_of_id = v_d.id) then
    raise exception 'ส่วนต่างนี้ถูกยกเลิกไปแล้ว' using errcode = '22023', hint = 'voided';
  end if;
  select * into v_to from analytics.job_stage where id = v_d.to_stage_id;
  if v_to.status <> 'pending' then
    raise exception 'ยกเลิกส่วนต่างไม่ได้ — ขั้นผู้รับยังรับงานอยู่ (ย้อนขั้นผู้รับเป็นยังไม่รับก่อน)' using errcode = '22023', hint = 'stage_not_pending';
  end if;
  insert into analytics.job_discrepancy (shop_id, root_job_id, job_id, from_stage_id, to_stage_id, qty, status, void_of_id, void_reason, created_by_actor)
  values (v_d.shop_id, v_d.root_job_id, v_d.job_id, v_d.from_stage_id, v_d.to_stage_id, v_d.qty, 'void', v_d.id, v_reason, v_actor)
  returning id into v_new;
  perform analytics.job_event_write(v_d.job_id, v_d.from_stage_id, 'discrepancy', analytics.job_today(), v_actor, null, 'job_page', null,
    jsonb_build_object('action', 'void', 'discrepancy_id', v_d.id, 'void_id', v_new, 'qty', v_d.qty, 'reason', v_reason));
  perform analytics.job_tree_check(v_d.job_id);
  return jsonb_build_object('ok', true, 'discrepancy_id', v_d.id, 'void_id', v_new, 'qty', v_d.qty);
end;
$f$;

-- job_cancel: ส่วนย่อยยกเลิกด้วย job_lot_cancel (ต้องเลือกที่ไปของชิ้น) · ใบแม่ที่มีส่วนย่อยยกเลิกไม่ได้
create or replace function analytics.job_cancel(p_shop_id uuid, p_job_id uuid, p_reason text, p_actor uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor  uuid := coalesce(p_actor, auth.uid());
  v_job    analytics.job%rowtype;
  v_reason text;
  v_tokens int;
begin
  -- 0181
  v_job := analytics.job_office_begin('job_cancel', p_shop_id, p_job_id, v_actor);
  if v_job.parent_job_id is not null then
    raise exception 'ส่วนย่อยยกเลิกด้วย "ยกเลิกส่วน" (ต้องเลือกที่ไปของชิ้น) — ใช้ยกเลิกใบงานทั้งใบไม่ได้' using errcode = '22023', hint = 'use_lot_cancel';
  end if;
  if exists (select 1 from analytics.job c where c.parent_job_id = p_job_id and c.status <> 'cancelled') then
    raise exception 'ยกเลิกใบแม่ไม่ได้ — มีส่วนย่อยอยู่ (ยกเลิก/ปิดส่วนย่อยก่อน)' using errcode = '22023', hint = 'has_parts';
  end if;
  v_reason := analytics.job_text_clean(p_reason, 'เหตุผลที่ยกเลิกใบงาน', 300, true);
  with r as (
    update analytics.job_token set revoked_at = clock_timestamp(), revoke_reason = 'job_cancel'
     where job_id = p_job_id and revoked_at is null returning 1)
  select count(*) into v_tokens from r;
  update analytics.job set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason where id = p_job_id;
  perform analytics.job_event_write(p_job_id, null, 'cancel', analytics.job_today(), v_actor, null, 'job_page', null,
    jsonb_build_object('reason', v_reason, 'tokens_revoked', v_tokens));
  return jsonb_build_object('ok', true, 'job_no', v_job.job_no, 'status', 'cancelled');
end;
$f$;

-- job_stage_reopen: ขั้นที่แยกส่วนออก/เป็นขั้นแยกของส่วน/รับช่วงมา/เป็นต้นทางของส่วนต่าง ย้อนไม่ได้ (has_split)
create or replace function analytics.job_stage_reopen(p_shop_id uuid, p_job_id uuid, p_reason text, p_actor uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor  uuid := coalesce(p_actor, auth.uid());
  v_job    analytics.job%rowtype;
  v_s      analytics.job_stage%rowtype;
  v_s2     analytics.job_stage%rowtype;
  v_reason text;
begin
  -- 0181
  v_job := analytics.job_office_begin('job_stage_reopen', p_shop_id, p_job_id, v_actor);
  v_reason := analytics.job_text_clean(p_reason, 'เหตุผลที่ย้อนขั้น', 200, true);
  select * into v_s from analytics.job_stage where job_id = p_job_id and status <> 'pending' order by seq desc limit 1;
  if not found then
    raise exception 'ใบงานนี้ยังไม่มีความคืบหน้าให้ย้อน' using errcode = '22023', hint = 'nothing_to_reopen';
  end if;
  if v_s.qty_split_out > 0 or v_s.split_from_stage_id is not null or (v_s.status = 'skipped' and v_s.skip_reason = 'split_inherit')
     or analytics.job_disc_active_qty(v_s.id, null) > 0 then
    raise exception 'ย้อนขั้นไม่ได้ — ขั้นนี้มีการแยกส่วน/ส่วนต่างอ้างอิงอยู่ (ยกเลิกส่วนหรือ void ส่วนต่างก่อน)' using errcode = '22023', hint = 'has_split';
  end if;
  if v_s.status = 'received' then
    update analytics.job_stage
       set status = 'pending', received_on = null, worker_id = null, assignee_name = null, qty_in = null, weight_in_g = null
     where id = v_s.id returning * into v_s2;
  elsif v_s.status = 'sent' then
    update analytics.job_stage
       set status = 'received', sent_on = null, qty_out = null, qty_scrap = 0, scrap_reason = null, weight_out_g = null,
           metal_added_g = 0, weight_note = null, scrap_weight_g = null, auto_closed = false
     where id = v_s.id returning * into v_s2;
  else
    update analytics.job_stage set status = 'pending', skip_reason = null where id = v_s.id returning * into v_s2;
  end if;
  perform analytics.job_event_write(p_job_id, v_s.id, 'stage_reopen', analytics.job_today(), v_actor, null, 'job_page', null,
    jsonb_build_object('stage_code', v_s.stage_code, 'reason', v_reason,
                       'before', analytics.job_stage_state(v_s), 'after', analytics.job_stage_state(v_s2)));
  perform analytics.job_tree_check(p_job_id);
  return jsonb_build_object('ok', true, 'job_no', v_job.job_no, 'stage_code', v_s.stage_code, 'from', v_s.status, 'to', v_s2.status);
end;
$f$;

-- job_done: ดี + เสีย + แยกออก = เริ่มผลิต · ใบแม่ปิดไม่ได้ขณะมีส่วนเปิด/ส่วนต่างรอชี้แจง · ส่วนย่อยไม่แตะ token (ไม่มี token)
create or replace function analytics.job_done(p_shop_id uuid, p_job_id uuid, p_qty_good integer, p_qty_scrap integer, p_weight_final_g numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid, p_surplus_disposition text DEFAULT NULL::text, p_surplus_note text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor     uuid := coalesce(p_actor, auth.uid());
  v_job       analytics.job%rowtype;
  v_open      int;
  v_first     text;
  v_final_out int;
  v_note      text;
  v_tokens    int;
  v_today     date := analytics.job_today();
  v_surplus   int;
  v_disp      text := null;
  v_snote     text := null;
begin
  -- 0181
  v_job := analytics.job_office_begin('job_done', p_shop_id, p_job_id, v_actor);
  select count(*), min(d.name_th) into v_open, v_first
    from analytics.job_stage s join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
   where s.job_id = p_job_id and s.status in ('pending', 'received');
  if v_open > 0 then
    raise exception 'ปิดงานไม่ได้ — ยังมี % ขั้นที่ยังไม่เสร็จ (เช่น %)', v_open, v_first using errcode = '22023', hint = 'stages_open';
  end if;
  if (v_job.parent_job_id is null and exists (select 1 from analytics.job c where c.parent_job_id = p_job_id and c.status not in ('done', 'cancelled')))
     or exists (select 1 from analytics.job_discrepancy d
                 where d.status = 'open' and (d.job_id = p_job_id or (v_job.parent_job_id is null and d.root_job_id = p_job_id))
                   and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d.id)) then
    raise exception 'ปิดงานไม่ได้ — ยังมีส่วนย่อยที่ยังไม่ปิด หรือส่วนต่างรอชี้แจง' using errcode = '22023', hint = 'parts_open';
  end if;
  if p_qty_good is null or p_qty_scrap is null or p_qty_good < 0 or p_qty_scrap < 0 or p_qty_good > 100000 or p_qty_scrap > 100000
     or p_qty_good + p_qty_scrap + v_job.qty_split_out <> v_job.qty_planned then
    raise exception 'จำนวนดี + จำนวนเสีย + จำนวนที่แยกออก ต้องเท่ากับจำนวนที่วางแผน (% ชิ้น)', v_job.qty_planned using errcode = '22023', hint = 'qty_mismatch';
  end if;
  select s.qty_out into v_final_out from analytics.job_stage s
   where s.job_id = p_job_id and s.status = 'sent' order by s.seq desc limit 1;
  v_final_out := coalesce(v_final_out, v_job.qty_planned);
  if p_qty_good > v_final_out then
    raise exception 'จำนวนดี (%) มากกว่าจำนวนที่เหลือจากขั้นสุดท้าย (%) — ตรวจของเสียรายขั้นก่อน', p_qty_good, v_final_out
      using errcode = '22023', hint = 'qty_exceeds_final';
  end if;
  if not analytics.job_weight_ok(p_weight_final_g) then
    raise exception 'น้ำหนักสุทธิต้องมากกว่า 0 และไม่เกิน 100,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)' using errcode = '22023', hint = 'weight_invalid';
  end if;
  -- 0176: บังคับตาม snapshot ของใบ (flag ของแบบ) · ทองที่มีขั้นชั่งอย่างน้อย 1 ขั้น (weigh_required · ใบเดิมทุกใบ) = กติกา J1 เดิม (security M1) — แบบไม่ชั่งเท่านั้นที่ไม่บังคับ
  if p_weight_final_g is null and (v_job.require_final_weight or (v_job.metal = 'gold' and v_job.weigh_required)) then
    raise exception '%', case when v_job.metal = 'gold' then 'งานทองต้องระบุน้ำหนักสุทธิตอนปิดงาน' else 'ใบงานนี้ต้องระบุน้ำหนักสุทธิตอนปิดงาน' end
      using errcode = '22023', hint = 'weight_required';
  end if;
  v_note := coalesce(analytics.job_text_clean(p_note, 'หมายเหตุ', 500, false), v_job.note);

  v_surplus := p_qty_good - v_job.qty_order;
  if p_surplus_disposition is not null and p_surplus_disposition not in ('hold', 'spare', 'deliver', 'stock') then
    raise exception 'การจัดการของเหลือต้องเป็น hold / spare / deliver' using errcode = '22023', hint = 'surplus_invalid';
  end if;
  if v_surplus > 0 then
    if v_job.source_kind = 'production' then
      if p_surplus_disposition is not null and p_surplus_disposition <> 'stock' then
        raise exception 'ใบงานของใบผลิต: ของเหลือเข้าสต็อกเสมอ เลือกอย่างอื่นไม่ได้' using errcode = '22023', hint = 'surplus_production_stock_only';
      end if;
      v_disp := 'stock';
    else
      if p_surplus_disposition = 'stock' then
        raise exception 'งาน OEM: ของเหลือเป็นของลูกค้า เข้าสต็อกอัตโนมัติไม่ได้ — เลือก hold / spare / deliver' using errcode = '22023', hint = 'surplus_oem_no_stock';
      end if;
      v_disp := coalesce(p_surplus_disposition, 'hold');
    end if;
    v_snote := analytics.job_text_clean(p_surplus_note, 'หมายเหตุของเหลือ', 200, false);
  elsif p_surplus_disposition is not null or nullif(btrim(coalesce(p_surplus_note, '')), '') is not null then
    raise exception 'ไม่มีของเหลือ (จำนวนดีไม่เกินจำนวนที่สั่ง) แต่ส่งการจัดการของเหลือมา' using errcode = '22023', hint = 'surplus_unexpected';
  end if;

  with r as (
    update analytics.job_token set revoked_at = clock_timestamp(), revoke_reason = 'job_done'
     where job_id = p_job_id and revoked_at is null returning 1)
  select count(*) into v_tokens from r;

  update analytics.job
     set status = 'done', done_at = now(), qty_good = p_qty_good, qty_scrap = p_qty_scrap,
         weight_final_g = p_weight_final_g, note = v_note,
         surplus_disposition = v_disp, surplus_note = v_snote
   where id = p_job_id;

  perform analytics.job_event_write(p_job_id, null, 'done', v_today, v_actor, null, 'job_page', null,
    jsonb_build_object('qty_good', p_qty_good, 'qty_scrap', p_qty_scrap, 'weight_final_g', p_weight_final_g, 'tokens_revoked', v_tokens,
                       'qty_order', v_job.qty_order, 'surplus', greatest(v_surplus, 0), 'surplus_disposition', v_disp)
                       || case when v_job.qty_split_out > 0 then jsonb_build_object('qty_split_out', v_job.qty_split_out) else '{}'::jsonb end);
  perform analytics.job_tree_check(p_job_id);
  return jsonb_build_object('ok', true, 'job_no', v_job.job_no, 'status', 'done', 'qty_good', p_qty_good, 'qty_scrap', p_qty_scrap,
                            'surplus', greatest(v_surplus, 0), 'surplus_disposition', v_disp);
end;
$f$;

-- QR: ใบย่อย/ใบส่งของ = token ใหม่ของใบแม่ ไม่เพิกถอนตัวเก่า (ข1 · มติ 18 ต.ค.) · เพดาน 5 ใบที่ใช้งานอยู่ (Q8 — คงเดิม · ห้ามเพิกถอนอัตโนมัติเงียบ)
drop function if exists analytics.job_token_issue(uuid, uuid, boolean, uuid);
create or replace function analytics.job_token_issue(p_shop_id uuid, p_job_id uuid, p_revoke_previous boolean default null, p_actor uuid default null, p_purpose text default 'traveler', p_lot_job_id uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor   uuid := coalesce(p_actor, auth.uid());
  v_job     analytics.job%rowtype;
  v_paid    numeric;
  v_revoked int := 0;
  v_active  int;
  v_print   int;
  v_raw     text;
  v_hash    text;
  v_today   date := analytics.job_today();
  v_rev     boolean;
  v_lot     analytics.job%rowtype;
begin
  -- 0181: p_revoke_previous null = ค่าเริ่มตามชนิด: พิมพ์ใบงานหลัก (traveler) ของใบที่ไม่มีส่วนย่อย = เพิกถอนของเก่า (เหมือน J1) · ใบที่มีส่วนย่อย หรือใบย่อย/ใบส่งของ = ไม่เพิกถอน · ค่าที่ส่งมาชัดเจนชนะเสมอ
  if p_purpose is null or p_purpose not in ('traveler', 'sublot', 'delivery_note') then
    raise exception 'ชนิด QR ต้องเป็น traveler / sublot / delivery_note' using errcode = '22023', hint = 'purpose_invalid';
  end if;
  v_job := analytics.job_office_begin('job_token_issue', p_shop_id, p_job_id, v_actor);
  if v_job.parent_job_id is not null then
    raise exception 'ออก QR ให้ส่วนย่อยไม่ได้ — ออกให้ใบแม่ (QR ใบแม่เปิดหน้าเดียวกันทุกส่วน)' using errcode = '22023', hint = 'lot_no_token';
  end if;
  if p_lot_job_id is not null then
    select * into v_lot from analytics.job l where l.id = p_lot_job_id and l.parent_job_id = p_job_id and l.shop_id = p_shop_id;
    if not found or v_lot.status = 'cancelled' then
      raise exception 'ส่วนย่อยที่ระบุไม่อยู่ในใบงานนี้ (หรือถูกยกเลิกแล้ว)' using errcode = '22023', hint = 'lot_invalid';
    end if;
  end if;
  if (p_purpose = 'sublot' and p_lot_job_id is null) or (p_purpose = 'traveler' and p_lot_job_id is not null) then
    raise exception 'ใบย่อย (sublot) ต้องระบุส่วน · ใบงานหลัก (traveler) ห้ามระบุส่วน' using errcode = '22023', hint = 'lot_invalid';
  end if;
  if v_job.source_kind = 'oem' and v_job.start_gate_note is null then
    select coalesce(v.paid_thb, 0) into v_paid
      from analytics.oem_quote_item i join analytics.v_oem_quote v on v.id = i.quote_id
     where i.id = v_job.oem_quote_item_id;
    if coalesce(v_paid, 0) <= 0 then
      raise exception 'ดีลนี้ยังไม่มีเงินมัดจำ — บันทึกเหตุผลที่เริ่มผลิตก่อน แล้วค่อยพิมพ์ใบงาน' using errcode = '22023', hint = 'start_gate_required';
    end if;
  end if;

  v_rev := coalesce(p_revoke_previous,
                    p_purpose = 'traveler' and not exists (select 1 from analytics.job l where l.parent_job_id = p_job_id and l.status <> 'cancelled'));
  if v_rev then
    with r as (
      update analytics.job_token set revoked_at = clock_timestamp(), revoke_reason = 'reprint'
       where job_id = p_job_id and revoked_at is null returning 1)
    select count(*) into v_revoked from r;
    if v_revoked > 0 then
      perform analytics.job_event_write(p_job_id, null, 'token_revoke', v_today, v_actor, null, 'job_page', null,
        jsonb_build_object('reason', 'reprint', 'count', v_revoked));
    end if;
  end if;
  select count(*) into v_active from analytics.job_token where job_id = p_job_id and revoked_at is null;
  if v_active >= 5 then
    raise exception 'ใบงานนี้มี QR ที่ใช้งานอยู่ครบ 5 ใบแล้ว — เพิกถอนก่อนพิมพ์เพิ่ม' using errcode = '22023', hint = 'token_cap';
  end if;

  select coalesce(max(print_no), 0) + 1 into v_print from analytics.job_token where job_id = p_job_id;
  -- 32 bytes สุ่มจาก pgcrypto -> base64url 43 ตัวอักษร (ไม่มี padding)
  v_raw := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  v_hash := analytics.job_sha256_hex(v_raw);
  insert into analytics.job_token (shop_id, job_id, token_hash, print_no, issued_by, purpose, lot_job_id)
  values (v_job.shop_id, p_job_id, v_hash, v_print, v_actor, p_purpose, p_lot_job_id);

  perform analytics.job_event_write(p_job_id, null, 'token_issue', v_today, v_actor, null, 'job_page', null,
    jsonb_build_object('print_no', v_print, 'revoked_previous', v_revoked, 'purpose', p_purpose, 'lot_job_id', p_lot_job_id));

  return jsonb_build_object('token', v_raw, 'print_no', v_print, 'job_id', p_job_id, 'job_no', v_job.job_no,
                            'revoked_previous', v_revoked, 'purpose', p_purpose, 'lot_job_id', p_lot_job_id,
                            'lot_label', case when v_lot.id is null then null else v_job.job_no || ' · ส่วนที่ ' || v_lot.lot_seq end);
end;
$f$;

-- เพิกถอน QR: ไม่ระบุ p_print_no = ทุกใบที่ใช้งานอยู่ (เหมือนเดิม) · ระบุ = เฉพาะใบนั้น ("เพิกถอน QR ที่หาย")
drop function if exists analytics.job_token_revoke(uuid, uuid, text, uuid);
create or replace function analytics.job_token_revoke(p_shop_id uuid, p_job_id uuid, p_reason text, p_actor uuid default null, p_print_no integer default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor  uuid := coalesce(p_actor, auth.uid());
  v_job    analytics.job%rowtype;
  v_reason text;
  v_n      int;
begin
  -- 0181
  v_job := analytics.job_office_begin('job_token_revoke', p_shop_id, p_job_id, v_actor);
  v_reason := analytics.job_text_clean(p_reason, 'เหตุผลที่เพิกถอน QR', 200, true);
  with r as (
    update analytics.job_token set revoked_at = clock_timestamp(), revoke_reason = v_reason
     where job_id = p_job_id and revoked_at is null and (p_print_no is null or print_no = p_print_no) returning 1)
  select count(*) into v_n from r;
  if p_print_no is not null and v_n = 0 then
    raise exception 'ไม่พบ QR ใบที่ระบุ หรือถูกเพิกถอนไปแล้ว' using errcode = '22023', hint = 'token_not_found';
  end if;
  if v_n > 0 then
    perform analytics.job_event_write(p_job_id, null, 'token_revoke', analytics.job_today(), v_actor, null, 'job_page', null,
      jsonb_build_object('reason', v_reason, 'count', v_n, 'print_no', p_print_no));
  end if;
  return jsonb_build_object('job_id', p_job_id, 'job_no', v_job.job_no, 'revoked', v_n);
end;
$f$;

-- รายการ QR ของใบแม่ (ไม่มี token/hash — ตาราง job_token อ่านตรงไม่ได้) สำหรับหน้า "QR ที่ใช้งานอยู่ + เพิกถอนรายใบ"
create or replace function analytics.job_token_list(p_shop_id uuid, p_job_id uuid, p_actor uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_job   analytics.job%rowtype;
begin
  v_job := analytics.job_office_begin('job_token_list', p_shop_id, p_job_id, v_actor, true);
  return coalesce((
    select jsonb_agg(jsonb_build_object('print_no', t.print_no, 'purpose', t.purpose, 'lot_job_id', t.lot_job_id, 'lot_seq', l.lot_seq,
                                        'label', case when l.id is null then null else v_job.job_no || ' · ส่วนที่ ' || l.lot_seq end,
                                        'issued_at', t.issued_at, 'active', t.revoked_at is null, 'revoked_at', t.revoked_at,
                                        'revoke_reason', t.revoke_reason) order by t.print_no)
      from analytics.job_token t left join analytics.job l on l.id = t.lot_job_id
     where t.job_id = p_job_id), '[]'::jsonb);
end;
$f$;
-- ============================================================================
-- 6. RPC ช่าง (public ผ่าน token + PIN · security definer) — พารามิเตอร์ใหม่ต่อท้ายพร้อม default: caller เดิม (TS ที่ส่ง named args) ยังเรียกได้โดยไม่แก้ · null = ใบเดียว/ส่งทั้งหมด เหมือน J1
-- ============================================================================
drop function if exists analytics.job_worker_send(text, text, integer, numeric, integer, text, numeric, text, numeric, text, text);
create or replace function analytics.job_worker_send(p_token_hash text, p_session_hash text, p_expected_seq integer, p_weight_out_g numeric default null::numeric, p_qty_scrap integer default 0, p_scrap_reason text default null::text, p_metal_added_g numeric default 0, p_weight_note text default null::text, p_scrap_weight_g numeric default null::numeric, p_user_agent text default null::text, p_ip_hash text default null::text, p_lot_job_id uuid default null, p_qty_send integer default null, p_qty_hold integer default null, p_weight_move_g numeric default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a      jsonb;
  v_r      jsonb;
  v_root   uuid;
  v_target uuid;
  v_wid    uuid;
  v_hint   text;
  v_s      analytics.job_stage%rowtype;
  v_hold   int;
begin
  -- 0181: p_lot_job_id = ส่วนที่ถืออยู่ (ว่าง = ใบของ token) · p_qty_send ว่างหรือเท่าที่ถือ = ส่งทั้งหมด (job_core_send เดิม) · น้อยกว่า = แยกส่วน (ส่ง n จาก N) ต้องส่ง p_qty_hold (จำนวนที่เห็นบนจอ) กันกดซ้ำ/2 มือถือ
  v_a := analytics.job_worker_auth(p_token_hash, p_session_hash, p_ip_hash, true, true, 'write');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_root := (v_a ->> 'job_id')::uuid;
  v_wid := (v_a ->> 'worker_id')::uuid;
  v_hint := analytics.job_device_hint(p_user_agent, p_ip_hash);
  v_target := coalesce(p_lot_job_id, v_root);
  if v_target <> v_root and not exists (select 1 from analytics.job l where l.id = v_target and l.parent_job_id = v_root) then
    return analytics.job_fail('invalid_part', 'ไม่พบส่วนนี้ในใบงาน — โหลดหน้าใหม่');
  end if;
  select * into v_s from analytics.job_stage where job_id = v_target and seq = p_expected_seq;
  v_hold := case when v_s.status = 'received' then v_s.qty_in - v_s.qty_scrap - v_s.qty_split_out end;

  if p_qty_send is null or v_hold is null or p_qty_send = v_hold then
    -- น้ำหนักส่วนที่แยกออกใช้กับการแยกจริงเท่านั้น — ส่งทั้งหมดใช้น้ำหนักออกปกติ (ไม่ปล่อยทิ้งเงียบ)
    if p_weight_move_g is not null then
      return analytics.job_fail('weight_unexpected', 'ส่งต่อทั้งหมดใช้น้ำหนักออกตามปกติ ไม่ใช่น้ำหนักส่วนที่แยก — โหลดหน้าใหม่');
    end if;
    if v_hold is not null and p_qty_hold is not null and p_qty_hold <> v_hold then
      return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
    end if;
    v_r := analytics.job_core_send(v_target, p_expected_seq, analytics.job_today(), p_weight_out_g, p_qty_scrap,
                                   p_scrap_reason, p_metal_added_g, p_weight_note, p_scrap_weight_g, v_wid,
                                   'worker_qr', null, v_hint, true);
    if v_r ->> 'code' = 'already_sent' then
      return jsonb_build_object('ok', true, 'already', true, 'message', v_r ->> 'message');
    end if;
    return v_r;
  end if;
  return analytics.job_lot_split_core(v_target, p_expected_seq, p_qty_send, p_qty_hold, p_qty_scrap, p_scrap_reason,
                                      p_weight_out_g, p_metal_added_g, p_scrap_weight_g, p_weight_note, p_weight_move_g,
                                      v_wid, 'worker_qr', null, v_hint, true);
end;
$f$;

drop function if exists analytics.job_worker_receive(text, text, integer, numeric, text, text);
create or replace function analytics.job_worker_receive(p_token_hash text, p_session_hash text, p_expected_seq integer, p_weight_in_g numeric default null::numeric, p_user_agent text default null::text, p_ip_hash text default null::text, p_lot_job_id uuid default null, p_qty_received integer default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a      jsonb;
  v_r      jsonb;
  v_root   uuid;
  v_target uuid;
begin
  -- 0181: p_lot_job_id = ส่วนที่จะรับ · p_qty_received = จำนวนที่ได้จริง (ว่าง = ตามที่ส่ง) — น้อยกว่าที่ส่ง = ส่วนต่างรอชี้แจงกลับไปขั้นก่อน
  v_a := analytics.job_worker_auth(p_token_hash, p_session_hash, p_ip_hash, true, true, 'write');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_root := (v_a ->> 'job_id')::uuid;
  v_target := coalesce(p_lot_job_id, v_root);
  if v_target <> v_root and not exists (select 1 from analytics.job l where l.id = v_target and l.parent_job_id = v_root) then
    return analytics.job_fail('invalid_part', 'ไม่พบส่วนนี้ในใบงาน — โหลดหน้าใหม่');
  end if;
  v_r := analytics.job_core_receive(v_target, p_expected_seq, analytics.job_today(), p_weight_in_g,
                                    (v_a ->> 'worker_id')::uuid, null, 'worker_qr', null,
                                    analytics.job_device_hint(p_user_agent, p_ip_hash), true, p_qty_received);
  -- 2 มือถือรับขั้นเดียวกันพร้อมกัน: ตัวหลังได้ "รับแล้วโดย X" (ok) ไม่ใช่ error
  if v_r ->> 'code' = 'already_received' then
    return jsonb_build_object('ok', true, 'already', true, 'message', v_r ->> 'message', 'by', v_r ->> 'by');
  end if;
  return v_r;
end;
$f$;

create or replace function analytics.job_worker_discrepancy_resolve(p_token_hash text, p_session_hash text, p_discrepancy_id uuid, p_kind text, p_reason text, p_user_agent text default null, p_ip_hash text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a      jsonb;
  v_root   uuid;
  v_wid    uuid;
  v_d      analytics.job_discrepancy%rowtype;
  v_fs     analytics.job_stage%rowtype;
  v_ext    boolean;
  v_reason text;
begin
  -- 0181 (มติ Q5): ผู้ส่งของขั้นนั้น (หรือผู้มีสิทธิ์ดูแลงานนอกร้าน) ชี้แจงส่วนต่างเป็นเสียหาย (scrap) หรือหาย (lost) + เหตุผล · ครั้งเดียว
  v_a := analytics.job_worker_auth(p_token_hash, p_session_hash, p_ip_hash, true, true, 'write');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_root := (v_a ->> 'job_id')::uuid;
  v_wid := (v_a ->> 'worker_id')::uuid;
  select * into v_d from analytics.job_discrepancy where id = p_discrepancy_id and root_job_id = v_root;
  if not found then
    return analytics.job_fail('invalid_part', 'ไม่พบรายการส่วนต่างนี้ในใบงาน — โหลดหน้าใหม่');
  end if;
  select * into v_fs from analytics.job_stage where id = v_d.from_stage_id;
  select w.can_external into v_ext from analytics.worker w where w.id = v_wid;
  if v_fs.worker_id is distinct from v_wid and not coalesce(v_ext, false) then
    return analytics.job_fail('not_sender', 'ชี้แจงได้เฉพาะผู้ส่งงานขั้นนั้น (หรือผู้ดูแลงานนอกร้าน)');
  end if;
  if v_d.status <> 'open' or exists (select 1 from analytics.job_discrepancy v where v.void_of_id = v_d.id) then
    return analytics.job_fail('already_resolved', 'ส่วนต่างนี้ชี้แจงแล้วหรือถูกยกเลิกแล้ว');
  end if;
  -- H1 (security): ส่วนต่างของงานทองที่มีน้ำหนักเทียบ (weight_gap_g) ผู้ส่งชี้แจงเองไม่ได้ — กันผู้ส่งปิดด่านทองเอง (ชั่งเบากว่าแล้วเขียนว่า "หาย") · ออฟฟิศชี้แจงผ่าน job_discrepancy_resolve · ข้อความไม่มีตัวเลขน้ำหนัก (N1)
  if v_d.weight_gap_g is not null and exists (select 1 from analytics.job gj where gj.id = v_d.job_id and gj.metal = 'gold') then
    return analytics.job_fail('office_required', 'ส่วนต่างของงานทองที่มีน้ำหนักเทียบ ให้ออฟฟิศเป็นผู้ชี้แจง — แจ้งออฟฟิศ');
  end if;
  if p_kind is null or p_kind not in ('scrap', 'lost') then
    return analytics.job_fail('kind_invalid', 'ต้องเลือกว่าเสียหายหรือหาย');
  end if;
  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null or not analytics.job_scrap_reason_valid(v_reason) then
    return analytics.job_fail('reason_required', 'ต้องระบุเหตุผล (รูพรุน/หัก/ผิดแบบ/หาย/อื่นๆ)');
  end if;
  update analytics.job_discrepancy
     set status = 'resolved', resolved_kind = p_kind, resolved_reason = v_reason, resolved_by_worker = v_wid, resolved_at = clock_timestamp()
   where id = v_d.id;
  perform analytics.job_event_write(v_d.job_id, v_d.from_stage_id, 'discrepancy_resolve', analytics.job_today(), null, v_wid, 'worker_qr',
    analytics.job_device_hint(p_user_agent, p_ip_hash),
    jsonb_build_object('discrepancy_id', v_d.id, 'qty', v_d.qty, 'kind', p_kind, 'reason', v_reason));
  perform analytics.job_tree_check(v_d.job_id);
  return jsonb_build_object('ok', true, 'action', 'discrepancy_resolve', 'discrepancy_id', v_d.id, 'qty', v_d.qty, 'kind', p_kind);
end;
$f$;

create or replace function analytics.job_worker_lot_cancel(p_token_hash text, p_session_hash text, p_lot_job_id uuid, p_reason text default null, p_user_agent text default null, p_ip_hash text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a      jsonb;
  v_root   uuid;
  v_reason text;
begin
  -- 0181 (ข3): ช่างยกเลิกส่วนที่ตัวเองแยก (ในร้าน) ได้จนกว่าจะมีคนกดรับ — ชิ้นกลับขั้นแม่ที่ยังถืออยู่ · ออฟฟิศยกเลิกส่วนอื่น/ส่วนที่รับแล้วผ่าน job_lot_cancel
  v_a := analytics.job_worker_auth(p_token_hash, p_session_hash, p_ip_hash, true, true, 'write');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_root := (v_a ->> 'job_id')::uuid;
  if p_lot_job_id is null or not exists (select 1 from analytics.job l where l.id = p_lot_job_id and l.parent_job_id = v_root) then
    return analytics.job_fail('invalid_part', 'ไม่พบส่วนนี้ในใบงาน — โหลดหน้าใหม่');
  end if;
  begin
    v_reason := analytics.job_text_clean(p_reason, 'เหตุผล', 200, false);
  exception when others then
    return analytics.job_fail('reason_invalid', 'เหตุผลมีอักขระที่ไม่อนุญาตหรือยาวเกิน 200 ตัวอักษร');
  end;
  return analytics.job_lot_cancel_core(p_lot_job_id, 'return_to_parent', coalesce(v_reason, 'ช่างยกเลิกการแยกส่วน'), null, null,
                                       (v_a ->> 'worker_id')::uuid, 'worker_qr', null, analytics.job_device_hint(p_user_agent, p_ip_hash), true);
end;
$f$;

-- job_worker_resolve: ตอบจาก "ช่างที่ PIN" ทั้งต้นไม้ — key เดิมคงทุกตัว (ต้นไม้ส่วนเดียวไม่มีส่วนต่าง ⇒ next_action/action_stage/prev_weight_out_g เท่าเดิมเป๊ะ)
-- เพิ่ม parts[] (ภาพรวมทุกส่วน) + my_actions[] (ส่ง/รับ/ชี้แจง ที่ฉันทำได้) · หลายส่วนหรือมีส่วนต่างรอชี้แจง + ช่างระบุตัวแล้ว ⇒ next_action = 'multi' · ไม่มีราคา/ต้นทุน/ชื่อลูกค้า · น้ำหนักขั้นก่อน (ทอง N1) ไม่ออกใน my_actions
create or replace function analytics.job_worker_resolve(p_token_hash text, p_session_hash text default null::text, p_ip_hash text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a        jsonb;
  v_job      analytics.job%rowtype;
  v_worker   uuid;
  v_wcodes   text[];
  v_hold     analytics.job_stage%rowtype;
  v_pend     analytics.job_stage%rowtype;
  v_prev     analytics.job_stage%rowtype;
  v_action   text := 'none';
  v_seq      int;
  v_code     text;
  v_name     text;
  v_need_w   boolean := false;
  v_prev_w   numeric := null;
  v_holder   text := null;
  v_paid     numeric;
  v_stages   jsonb;
  v_workers  jsonb := '[]'::jsonb;
  v_started  boolean;
  v_sq       boolean;
  v_sw       boolean;
  v_multi    boolean;
  v_open_disc boolean;
  v_any_active boolean;
  v_can_ext  boolean := false;
  v_parts    jsonb := '[]'::jsonb;
  v_acts     jsonb := '[]'::jsonb;
  v_has_send boolean := false;
  p          analytics.job%rowtype;
  ph         analytics.job_stage%rowtype;
  pp         analytics.job_stage%rowtype;
  pv         analytics.job_stage%rowtype;
  v_lbl      text;
  v_fname    text;
  v_days     int;
  v_cancel   boolean;
  dr         record;
begin
  -- 0181
  v_a := analytics.job_worker_auth(p_token_hash, p_session_hash, p_ip_hash, false, false, 'none');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  select * into v_job from analytics.job where id = (v_a ->> 'job_id')::uuid;
  v_worker := nullif(v_a ->> 'worker_id', '')::uuid;

  select * into v_hold from analytics.job_stage where job_id = v_job.id and status = 'received' limit 1;
  select * into v_pend from analytics.job_stage where job_id = v_job.id and status = 'pending' order by seq limit 1;
  select exists (select 1 from analytics.job_stage where job_id = v_job.id and status in ('received', 'sent')) into v_started;
  if v_hold.id is not null then
    select coalesce(w.display_name, v_hold.assignee_name) into v_holder from (select 1) x left join analytics.worker w on w.id = v_hold.worker_id;
  end if;

  -- ต้นไม้: มีส่วนย่อย (ไม่ยกเลิก) หรือมีส่วนต่างรอชี้แจง = หลายส่วน · ใบเดี่ยวทั่วไปทั้งหมดเป็น false ⇒ ทางเดิมทุกบรรทัด
  select exists (select 1 from analytics.job_discrepancy d2 where d2.root_job_id = v_job.id and d2.status = 'open'
                    and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d2.id)) into v_open_disc;
  select (v_open_disc or exists (select 1 from analytics.job c where c.parent_job_id = v_job.id and c.status <> 'cancelled')) into v_multi;
  select exists (select 1 from analytics.job j join analytics.job_stage s on s.job_id = j.id
                  where (j.id = v_job.id or j.parent_job_id = v_job.id) and j.status not in ('done', 'cancelled') and s.status in ('received', 'pending')) into v_any_active;

  if not (v_any_active or v_open_disc) then
    -- QA 5: ทุกขั้นส่งต่อ/ข้ามครบแล้วแต่ออฟฟิศยังไม่ปิดงาน — ไม่ใช่ "ให้ระบุตัว"
    v_action := 'all_done';
  elsif v_worker is null then
    v_action := 'identify';
    -- รายชื่อช่างที่ทำงานของต้นไม้นี้ได้ (ขั้นที่ถือค้าง/ขั้นที่รอรับของทุกส่วน + ผู้ส่งที่มีส่วนต่างรอชี้แจง) — เฉพาะ id + ชื่อ
    select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'display_name', w.display_name) order by w.display_name), '[]'::jsonb)
      into v_workers
      from analytics.worker w
     where w.shop_id = v_job.shop_id and w.is_active
       and (cardinality(w.stage_codes) = 0
            or exists (select 1 from analytics.job j join analytics.job_stage s on s.job_id = j.id
                        where (j.id = v_job.id or j.parent_job_id = v_job.id) and j.status not in ('done', 'cancelled')
                          and s.stage_code = any (w.stage_codes)
                          and (s.status = 'received'
                               or (s.status = 'pending' and s.seq = (select min(s2.seq) from analytics.job_stage s2 where s2.job_id = j.id and s2.status = 'pending'))))
            or exists (select 1 from analytics.job_discrepancy d3 join analytics.job_stage fs on fs.id = d3.from_stage_id
                        where d3.root_job_id = v_job.id and d3.status = 'open'
                          and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d3.id)
                          and (fs.worker_id = w.id or w.can_external)));
  else
    select w.stage_codes, w.can_external into v_wcodes, v_can_ext from analytics.worker w where w.id = v_worker;
    if v_hold.id is not null and v_hold.worker_id = v_worker then
      v_action := 'send'; v_seq := v_hold.seq; v_code := v_hold.stage_code; v_need_w := v_hold.weigh_required;
    elsif v_pend.id is not null then
      v_seq := v_pend.seq; v_code := v_pend.stage_code; v_need_w := v_pend.weigh_required;
      if v_job.status = 'on_hold' then
        v_action := 'on_hold';
      elsif not analytics.job_worker_can_do(v_wcodes, v_pend.stage_code) then
        v_action := 'not_your_stage';
      elsif v_hold.id is not null and ((v_job.metal = 'gold' and v_job.profile_id is null) or v_hold.weigh_required or v_hold.qty_split_out > 0) then
        -- QA N1: ขั้นก่อนบังคับชั่ง (หรือใบทองเดิม) ยังไม่ส่งต่อ -> บอกตั้งแต่ resolve ไม่ใช่ให้กดแล้วไป fail · 0181: ขั้นก่อนที่แยกส่วนออกไปแล้วปิดอัตโนมัติไม่ได้ = ผู้ถือต้องส่งส่วนที่เหลือก่อน
        v_action := 'prev_not_sent';
      else
        v_action := 'receive';
        -- 0176 (D6): ด่านมัดจำใช้ helper เดียวกับ job_core_receive
        if analytics.job_deposit_blocked(v_job) then
          v_action := 'awaiting_deposit';
        end if;
        select * into v_prev from analytics.job_stage
         where job_id = v_job.id and seq < v_pend.seq and status <> 'skipped' order by seq desc limit 1;
        -- N1: งานทองไม่ส่งน้ำหนักขั้นก่อนให้ผู้รับ (ชั่งแบบไม่รู้คำตอบ) · เงิน/ทองเหลืองส่งตามเดิม
        v_prev_w := case when v_job.metal = 'gold' then null else v_prev.weight_out_g end;
      end if;
    elsif v_hold.id is not null then
      v_action := 'held_by_other'; v_seq := v_hold.seq; v_code := v_hold.stage_code;
    end if;

    -- 0181: parts[] + my_actions[] ทั้งต้นไม้ (เฉพาะช่างที่ระบุตัวแล้ว)
    for p in select j.* from analytics.job j where (j.id = v_job.id or j.parent_job_id = v_job.id) and j.status <> 'cancelled' order by j.lot_seq loop
      v_lbl := v_job.job_no || case when p.parent_job_id is null then '' else ' · ส่วนที่ ' || p.lot_seq end;
      select * into ph from analytics.job_stage where job_id = p.id and status = 'received' limit 1;
      select * into pp from analytics.job_stage where job_id = p.id and status = 'pending' order by seq limit 1;
      select d4.name_th into v_fname from analytics.job_stage_def d4 where d4.shop_id = p.shop_id and d4.code = coalesce(ph.stage_code, pp.stage_code);
      v_days := analytics.job_today() - coalesce(ph.received_on, (select max(s3.sent_on) from analytics.job_stage s3 where s3.job_id = p.id), analytics.job_bkk_date(p.created_at));
      v_cancel := p.parent_job_id is not null and analytics.job_lot_return_blocker(p.id) is null
                  and exists (select 1 from analytics.job_stage s4 join analytics.job_stage ms on ms.id = s4.split_from_stage_id
                               join analytics.job_event e on e.job_id = ms.job_id and e.event_type = 'split' and e.payload ->> 'lot_job_id' = p.id::text
                              where s4.job_id = p.id and e.worker_id = v_worker and ms.worker_id = v_worker);
      v_parts := v_parts || jsonb_build_object(
        'lot_job_id', p.id, 'label', v_lbl, 'lot_seq', p.lot_seq, 'status', p.status, 'qty_planned', p.qty_planned,
        'qty_live', analytics.job_live_qty(p.id), 'stage_code', coalesce(ph.stage_code, pp.stage_code), 'stage_name', v_fname,
        'holder_name', case when ph.id is null then null else (select coalesce(w2.display_name, ph.assignee_name) from (select 1) x2 left join analytics.worker w2 on w2.id = ph.worker_id) end,
        'days', v_days, 'is_mine', ph.id is not null and ph.worker_id = v_worker, 'can_cancel_split', v_cancel);
      if p.status = 'done' then
        continue;
      end if;
      if ph.id is not null and ph.worker_id = v_worker then
        v_has_send := true;
        v_acts := v_acts || jsonb_build_object('lot_job_id', p.id, 'label', v_lbl, 'action', 'send', 'stage_seq', ph.seq, 'stage_code', ph.stage_code,
          'stage_name', (select d5.name_th from analytics.job_stage_def d5 where d5.shop_id = p.shop_id and d5.code = ph.stage_code),
          'weight_required', ph.weigh_required, 'scrap_qty_ask', ph.scrap_qty_ask, 'scrap_weight_ask', ph.scrap_weight_ask,
          'qty_hold', ph.qty_in - ph.qty_scrap - ph.qty_split_out, 'qty_expected', null, 'discrepancy_id', null, 'qty', null);
      end if;
      if pp.id is not null and p.status <> 'on_hold'
         and analytics.job_worker_can_do(v_wcodes, pp.stage_code)
         and not (ph.id is not null and (ph.worker_id = v_worker or (p.metal = 'gold' and p.profile_id is null) or ph.weigh_required or ph.qty_split_out > 0))
         and not analytics.job_deposit_blocked(p) then
        select * into pv from analytics.job_stage where job_id = p.id and seq < pp.seq and status <> 'skipped' order by seq desc limit 1;
        v_acts := v_acts || jsonb_build_object('lot_job_id', p.id, 'label', v_lbl, 'action', 'receive', 'stage_seq', pp.seq, 'stage_code', pp.stage_code,
          'stage_name', (select d6.name_th from analytics.job_stage_def d6 where d6.shop_id = p.shop_id and d6.code = pp.stage_code),
          'weight_required', pp.weigh_required, 'scrap_qty_ask', pp.scrap_qty_ask, 'scrap_weight_ask', pp.scrap_weight_ask,
          'qty_hold', null,
          'qty_expected', case when pv.id is null then p.qty_planned
                               else (case when pv.status = 'received' then pv.qty_in else pv.qty_out end) - analytics.job_disc_active_qty(pv.id, pp.id) end,
          'discrepancy_id', null, 'qty', null);
      end if;
      for dr in select dd.id, dd.qty, (dd.weight_gap_g is not null and p.metal = 'gold') as office_only, fs.seq as f_seq, fs.stage_code as f_code
                 from analytics.job_discrepancy dd join analytics.job_stage fs on fs.id = dd.from_stage_id
                where dd.job_id = p.id and dd.status = 'open' and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = dd.id)
                  and (fs.worker_id = v_worker or v_can_ext)
                order by dd.created_at loop
        v_acts := v_acts || jsonb_build_object('lot_job_id', p.id, 'label', v_lbl, 'action', 'explain', 'stage_seq', dr.f_seq, 'stage_code', dr.f_code,
          'stage_name', (select d7.name_th from analytics.job_stage_def d7 where d7.shop_id = p.shop_id and d7.code = dr.f_code),
          'weight_required', false, 'scrap_qty_ask', false, 'scrap_weight_ask', false,
          'qty_hold', null, 'qty_expected', null, 'discrepancy_id', dr.id, 'qty', dr.qty, 'office_only', dr.office_only);
      end loop;
    end loop;
  end if;

  -- 0176: flag ถามของเสียของขั้นที่ action ชี้ (flag = ถาม ไม่ใช่ด่าน DB)
  if v_seq is not null then
    select s.scrap_qty_ask, s.scrap_weight_ask into v_sq, v_sw from analytics.job_stage s where s.job_id = v_job.id and s.seq = v_seq;
  end if;

  select d.name_th into v_name from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_code;

  select coalesce(jsonb_agg(
           jsonb_build_object('seq', s.seq, 'code', s.stage_code, 'name', d.name_th, 'status', s.status)
           || case when v_worker is not null then
                jsonb_build_object('received_on', s.received_on, 'sent_on', s.sent_on,
                                   'worker_name', coalesce(w.display_name, s.assignee_name), 'auto_closed', s.auto_closed)
              else '{}'::jsonb end
           order by s.seq), '[]'::jsonb)
    into v_stages
    from analytics.job_stage s
    join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
    left join analytics.worker w on w.id = s.worker_id
   where s.job_id = v_job.id;

  return jsonb_build_object(
    'ok', true,
    'job', case when v_worker is null
             then jsonb_build_object('job_no', v_job.job_no, 'status', v_job.status, 'stages', v_stages, 'has_profile', v_job.profile_id is not null)
             else jsonb_build_object('job_no', v_job.job_no, 'status', v_job.status, 'design_label', v_job.design_label,
                                     'sku', v_job.sku_snapshot, 'metal', v_job.metal, 'qty_planned', v_job.qty_planned,
                                     'due_date', v_job.due_date, 'stages', v_stages,
                                     'profile_name', v_job.profile_name, 'has_profile', v_job.profile_id is not null) end,
    'viewer', case when v_worker is null then null
              else jsonb_build_object('worker_id', v_worker, 'display_name', v_a ->> 'worker_name') end,
    'session_expired', (v_a ->> 'session_expired')::boolean,
    'next_action', case when v_multi and v_worker is not null then 'multi' else v_action end,
    'action_stage', case when v_seq is null or (v_multi and v_worker is not null) then null
                      else jsonb_build_object('seq', v_seq, 'code', v_code, 'name', v_name, 'weight_required', v_need_w,
                                           'scrap_qty_ask', coalesce(v_sq, true), 'scrap_weight_ask', coalesce(v_sw, false)) end,
    'prev_weight_out_g', case when v_multi and v_worker is not null then null else v_prev_w end,
    -- L1: ชื่อผู้ถือเห็นได้เฉพาะช่างที่ระบุตัวแล้ว
    'held_by', case when v_worker is null then null else v_holder end,
    'workers', v_workers,
    'scrap_reasons', case when (v_action = 'send' and not v_multi) or (v_multi and v_has_send)
                          then to_jsonb(array['porosity', 'broken', 'wrong_design', 'missing', 'other']) else '[]'::jsonb end,
    'parts', case when v_worker is null then null else v_parts end,
    'my_actions', case when v_worker is null then null else v_acts end
  );
end;
$f$;

-- v_job_stage_loss: ขั้นที่แยกส่วนออก (qty_split_out > 0) น้ำหนักเข้ารวมชิ้นที่แยกไป แต่น้ำหนักออกเป็นของส่วนที่เหลือ ⇒ loss_g/loss_pct = null + not_comparable (มติ ค1 ไม่ชั่งตอนแยก — ห้ามให้เกิดธง loss ปลอม)
-- handoff_gap_g ไม่คำนวณข้ามคู่ขั้นที่มีส่วนต่างรอชี้แจง/ชี้แจงแล้ว (จำนวนชิ้นต่างกัน น้ำหนักเทียบกันไม่ได้) · คอลัมน์เดิม 21 ตัวคงเป๊ะ + ต่อท้าย not_comparable
create or replace view analytics.v_job_stage_loss
  with (security_invoker = true) as
 SELECT x.job_stage_id,
    x.job_id,
    x.shop_id,
    x.job_no,
    x.metal,
    x.stage_code,
    x.stage_name,
    x.status,
    x.worker_id,
    x.worker_name,
    x.weight_in_g,
    x.weight_out_g,
    x.metal_added_g,
    x.scrap_weight_g,
    x.weighed,
    x.not_weighed,
    x.loss_g,
    x.loss_pct,
    x.loss_warn_pct,
        CASE
            WHEN ((x.loss_warn_pct IS NULL) OR (x.loss_pct IS NULL)) THEN false
            ELSE (x.loss_pct > x.loss_warn_pct)
        END AS warn,
    hg.handoff_gap_g,
    (x.qty_split_out > 0 AND x.weight_split_out_g = 0) AS not_comparable,
    hg.handoff_gap_partial_g
   FROM (( SELECT s.id AS job_stage_id,
            s.job_id,
            s.shop_id,
            j.job_no,
            j.metal,
            s.stage_code,
            d.name_th AS stage_name,
            s.status,
            s.worker_id,
            w.display_name AS worker_name,
            s.weight_in_g,
            s.weight_out_g,
            s.metal_added_g,
            s.scrap_weight_g,
            ((s.weight_in_g IS NOT NULL) AND (s.weight_out_g IS NOT NULL)) AS weighed,
            ((s.status = 'sent'::text) AND ((s.weight_in_g IS NULL) OR (s.weight_out_g IS NULL))) AS not_weighed,
                CASE
                    WHEN (s.qty_split_out > 0 AND s.weight_split_out_g = 0) THEN NULL::numeric
                    WHEN ((s.weight_in_g IS NOT NULL) AND (s.weight_out_g IS NOT NULL)) THEN (((s.weight_in_g + s.metal_added_g) - s.weight_out_g) - COALESCE(s.scrap_weight_g, (0)::numeric) - s.weight_split_out_g)
                    ELSE NULL::numeric
                END AS loss_g,
                CASE
                    WHEN (s.qty_split_out > 0 AND s.weight_split_out_g = 0) THEN NULL::numeric
                    WHEN ((s.weight_in_g IS NOT NULL) AND (s.weight_out_g IS NOT NULL) AND (s.weight_in_g > (0)::numeric)) THEN round((((((s.weight_in_g + s.metal_added_g) - s.weight_out_g) - COALESCE(s.scrap_weight_g, (0)::numeric) - s.weight_split_out_g) / s.weight_in_g) * (100)::numeric), 2)
                    ELSE NULL::numeric
                END AS loss_pct,
            d.loss_warn_pct,
            s.qty_split_out,
            s.weight_split_out_g
           FROM (((analytics.job_stage s
             JOIN analytics.job j ON ((j.id = s.job_id)))
             JOIN analytics.job_stage_def d ON (((d.shop_id = s.shop_id) AND (d.code = s.stage_code))))
             LEFT JOIN analytics.worker w ON ((w.id = s.worker_id)))) x
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN ((x.weight_in_g IS NOT NULL) AND (pv.weight_out_g IS NOT NULL) AND (pv.status = 'sent'::text) AND me.weigh_required AND pv.weigh_required
                          AND (NOT EXISTS ( SELECT 1
                                 FROM analytics.job_discrepancy dq
                                WHERE ((dq.from_stage_id = pv.id) AND (dq.to_stage_id = me.id) AND (dq.status = ANY (ARRAY['open'::text, 'resolved'::text]))
                                   AND (NOT EXISTS ( SELECT 1
                                         FROM analytics.job_discrepancy vq
                                        WHERE (vq.void_of_id = dq.id))))))) THEN (x.weight_in_g - pv.weight_out_g)
                    ELSE NULL::numeric
                END AS handoff_gap_g,
                CASE
                    WHEN ((x.weight_in_g IS NOT NULL) AND (pv.weight_out_g IS NOT NULL) AND (pv.status = 'sent'::text) AND me.weigh_required AND pv.weigh_required
                          AND (EXISTS ( SELECT 1
                                 FROM analytics.job_discrepancy dq
                                WHERE ((dq.from_stage_id = pv.id) AND (dq.to_stage_id = me.id) AND (dq.status = ANY (ARRAY['open'::text, 'resolved'::text]))
                                   AND (NOT EXISTS ( SELECT 1
                                         FROM analytics.job_discrepancy vq
                                        WHERE (vq.void_of_id = dq.id))))))) THEN (x.weight_in_g - pv.weight_out_g)
                    ELSE NULL::numeric
                END AS handoff_gap_partial_g
           FROM (analytics.job_stage me
             JOIN analytics.job_stage pv ON (((pv.job_id = me.job_id) AND (pv.seq < me.seq) AND (pv.status <> 'skipped'::text))))
          WHERE (me.id = x.job_stage_id)
          ORDER BY pv.seq DESC
         LIMIT 1) hg ON (true));

-- v_job_stage_from_events: เหตุการณ์ split / split_cancel เปลี่ยนสถานะของขั้นที่ถืออยู่ (qty_split_out/qty_scrap) — นับเป็นเหตุการณ์ล่าสุดของขั้นด้วย ไม่งั้น drift ปลอมทุกขั้นที่เคยแยก
create or replace view analytics.v_job_stage_from_events
  with (security_invoker = true) as
 SELECT s.id AS job_stage_id,
    s.job_id,
    s.shop_id,
    s.stage_code,
    s.status,
    le.event_id,
    le.after_state,
        CASE
            WHEN (le.after_state IS NULL) THEN (s.status <> 'pending'::text)
            ELSE (le.after_state <> analytics.job_stage_state(s.*))
        END AS drift
   FROM (analytics.job_stage s
     LEFT JOIN LATERAL ( SELECT e.id AS event_id,
            (e.payload -> 'after'::text) AS after_state
           FROM analytics.job_event e
          WHERE ((e.job_stage_id = s.id) AND (e.event_type = ANY (ARRAY['stage_receive'::text, 'stage_send'::text, 'stage_skip'::text, 'stage_reopen'::text, 'split'::text, 'split_cancel'::text])))
          ORDER BY e.recorded_at DESC, e.id DESC
         LIMIT 1) le ON (true));

-- v_production_order_job_mismatch (M3 security): เทียบ qty_done กับยอดดีของ "ทั้งต้นไม้" (ใบแม่ + ส่วนย่อยที่ไม่ยกเลิก) — ไม่ใช่ใบแม่ใบเดียว (ใบที่แบ่งส่วนจะเป็นรายการ mismatch ปลอม/ซ่อน mismatch จริง) · ใบแม่ done เท่านั้นที่ถูกเทียบ · คอลัมน์เดิมคงเป๊ะ (qty_good/qty_scrap = ผลรวมต้นไม้)
create or replace view analytics.v_production_order_job_mismatch
  with (security_invoker = true) as
 SELECT j.id AS job_id,
    j.shop_id,
    j.job_no,
    po.id AS production_order_id,
    po.po_no,
    poi.id AS production_order_item_id,
    p.sku,
    poi.qty_done,
    tt.qty_good,
    tt.qty_scrap
   FROM (((analytics.job j
     JOIN analytics.production_order_item poi ON ((poi.id = j.production_order_item_id)))
     JOIN analytics.production_order po ON ((po.id = poi.production_order_id)))
     JOIN product p ON ((p.id = poi.product_id)))
     CROSS JOIN LATERAL ( SELECT COALESCE(sum(t.qty_good) FILTER (WHERE (t.status = 'done'::text)), 0)::integer AS qty_good, COALESCE(sum(t.qty_scrap) FILTER (WHERE (t.status = 'done'::text)), 0)::integer AS qty_scrap FROM analytics.job t WHERE ((t.id = j.id) OR (t.parent_job_id = j.id)) AND NOT (t.status = 'cancelled'::text AND t.parent_job_id IS NOT NULL)) tt
  WHERE ((j.source_kind = 'production'::text) AND (j.status = 'done'::text) AND (j.parent_job_id IS NULL) AND (poi.qty_done IS NOT NULL) AND (poi.qty_done <> tt.qty_good));

-- v_job_tree: 1 แถวต่อใบในต้นไม้ (แม่ + ส่วน) · label = "JB-0020 · ส่วนที่ 2" (job_no ของส่วนไม่ใช้บนจอ) · qty_live = ชิ้นที่อยู่ในมือ/รอรับ ณ ตอนนี้ · ไม่มีต้นทุน
create or replace view analytics.v_job_tree
  with (security_invoker = true) as
 SELECT j.id AS job_id,
    COALESCE(j.parent_job_id, j.id) AS root_job_id,
    j.shop_id,
    j.parent_job_id,
    j.lot_seq,
    (r.job_no || CASE WHEN (j.parent_job_id IS NULL) THEN ''::text ELSE (' · ส่วนที่ '::text || j.lot_seq) END) AS label,
    j.job_no,
    j.status,
    j.qty_planned,
    analytics.job_live_qty(j.id) AS qty_live,
    a.stage_scrap AS qty_stage_scrap,
    j.qty_split_out,
    dsc.disc_open AS qty_discrepancy_open,
    dsc.disc_resolved AS qty_discrepancy_resolved,
    j.cancel_scrap_qty,
    j.cancel_scrap_weight_g,
    j.qty_good,
    j.qty_scrap AS qty_scrap_final,
    cur.stage_code,
    cur.stage_name,
    cur.stage_status,
    cur.holder_name,
    (analytics.job_today() - COALESCE(cur.received_on, ps.last_sent_on, analytics.job_bkk_date(j.created_at))) AS days_in_stage,
    qcs.qty_out AS qty_qc_passed,
    j.profile_name,
    j.design_label,
    j.metal
   FROM analytics.job j
     JOIN analytics.job r ON r.id = COALESCE(j.parent_job_id, j.id)
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(s.qty_scrap), 0)::integer AS stage_scrap
           FROM analytics.job_stage s
          WHERE s.job_id = j.id) a ON true
     LEFT JOIN LATERAL ( SELECT (COALESCE(sum(dq.qty) FILTER (WHERE dq.status = 'open'::text), 0))::integer AS disc_open,
            (COALESCE(sum(dq.qty) FILTER (WHERE dq.status = 'resolved'::text), 0))::integer AS disc_resolved
           FROM analytics.job_discrepancy dq
          WHERE dq.job_id = j.id AND dq.status = ANY (ARRAY['open'::text, 'resolved'::text])
            AND NOT EXISTS (SELECT 1 FROM analytics.job_discrepancy vq WHERE vq.void_of_id = dq.id)) dsc ON true
     LEFT JOIN LATERAL ( SELECT s.stage_code, d.name_th AS stage_name, s.status AS stage_status,
            COALESCE(w.display_name, s.assignee_name) AS holder_name, s.received_on
           FROM analytics.job_stage s
             JOIN analytics.job_stage_def d ON d.shop_id = s.shop_id AND d.code = s.stage_code
             LEFT JOIN analytics.worker w ON w.id = s.worker_id
          WHERE s.job_id = j.id AND s.status = ANY (ARRAY['received'::text, 'pending'::text])
          ORDER BY (s.status = 'received'::text) DESC, s.seq
         LIMIT 1) cur ON true
     LEFT JOIN LATERAL ( SELECT max(s.sent_on) AS last_sent_on FROM analytics.job_stage s WHERE s.job_id = j.id) ps ON true
     LEFT JOIN LATERAL ( SELECT s.qty_out FROM analytics.job_stage s WHERE s.job_id = j.id AND s.stage_code = 'qc'::text AND s.status = 'sent'::text) qcs ON true;

-- v_job_tree_summary: 1 แถวต่อใบแม่ — ยอดรวมต้นไม้ (บอร์ด/หน้าใบแม่) · sum_check = ผลรวมทุกถังเท่าจำนวนเริ่มผลิตของแม่ (ส่วนที่ยกเลิกแบบคืนชิ้นไม่นับ)
create or replace view analytics.v_job_tree_summary
  with (security_invoker = true) as
 SELECT r.id AS root_job_id,
    r.shop_id,
    r.job_no,
    r.qty_planned,
    r.qty_order,
    (count(*) FILTER (WHERE (t.status <> 'cancelled'::text)))::integer AS parts_count,
    (count(*) FILTER (WHERE (t.status = ANY (ARRAY['open'::text, 'in_progress'::text, 'on_hold'::text]))))::integer AS parts_open,
    (count(*) FILTER (WHERE (t.parent_job_id IS NOT NULL AND t.status NOT IN ('done'::text, 'cancelled'::text))))::integer AS lots_open,
    COALESCE(sum(t.qty_live) FILTER (WHERE (t.status <> ALL (ARRAY['done'::text, 'cancelled'::text]))), 0)::integer AS qty_live_total,
    COALESCE(sum(t.qty_good) FILTER (WHERE (t.status = 'done'::text)), 0)::integer AS qty_done_good,
    (COALESCE(sum(t.qty_stage_scrap) FILTER (WHERE (t.status <> 'done'::text)), 0)
      + COALESCE(sum(t.qty_scrap_final) FILTER (WHERE (t.status = 'done'::text)), 0)
      + COALESCE(sum(t.cancel_scrap_qty), 0))::integer AS qty_scrap_total,
    (COALESCE(sum(t.qty_discrepancy_open) FILTER (WHERE (t.status <> 'done'::text)), 0))::integer AS qty_pending_explanation,
    (COALESCE(sum(t.qty_discrepancy_resolved) FILTER (WHERE (t.status <> 'done'::text)), 0))::integer AS qty_discrepancy_resolved,
    COALESCE(sum(t.qty_qc_passed), 0)::integer AS qty_qc_passed_total,
    COALESCE(sum(t.cancel_scrap_weight_g), 0) AS weight_scrap_cancel_g,
    analytics.job_tree_dominant_stage(r.id) AS dominant_stage_code,
    (r.qty_planned = (COALESCE(sum(t.qty_live) FILTER (WHERE (t.status <> ALL (ARRAY['done'::text, 'cancelled'::text]))), 0)
      + COALESCE(sum(t.qty_good) FILTER (WHERE (t.status = 'done'::text)), 0)
      + COALESCE(sum(t.qty_stage_scrap) FILTER (WHERE (t.status <> 'done'::text)), 0)
      + COALESCE(sum(t.qty_scrap_final) FILTER (WHERE (t.status = 'done'::text)), 0)
      + COALESCE(sum(t.cancel_scrap_qty), 0)
      + COALESCE(sum(t.qty_discrepancy_open) FILTER (WHERE (t.status <> 'done'::text)), 0)
      + COALESCE(sum(t.qty_discrepancy_resolved) FILTER (WHERE (t.status <> 'done'::text)), 0))) AS sum_check
   FROM analytics.job r
     JOIN analytics.v_job_tree t ON t.root_job_id = r.id
        AND NOT (t.status = 'cancelled'::text AND t.parent_job_id IS NOT NULL AND t.cancel_scrap_qty IS NULL)
  WHERE r.parent_job_id IS NULL
  GROUP BY r.id, r.shop_id, r.job_no, r.qty_planned, r.qty_order;

-- v_job_tree_drift: ต้องว่างเสมอ (verify ยิงหลังทุกเทสต์) · job_tree_assert ใช้ view นี้ — 1 นิยามเดียว
create or replace view analytics.v_job_tree_drift
  with (security_invoker = true) as
 SELECT COALESCE(j.parent_job_id, j.id) AS root_job_id, j.id AS job_id, 'job_identity'::text AS check_code,
        (analytics.job_identity_gap(j.id))::text AS detail
   FROM analytics.job j
  WHERE analytics.job_identity_gap(j.id) IS NOT NULL AND analytics.job_identity_gap(j.id) <> 0
 UNION ALL
 SELECT COALESCE(j.parent_job_id, j.id), j.id, 'split_link'::text, (s.qty_split_out)::text
   FROM analytics.job_stage s JOIN analytics.job j ON j.id = s.job_id
  WHERE s.qty_split_out <> (SELECT COALESCE(sum(lj.qty_planned), 0)
                              FROM analytics.job_stage ls JOIN analytics.job lj ON lj.id = ls.job_id
                             WHERE ls.split_from_stage_id = s.id AND NOT (lj.status = 'cancelled'::text AND lj.cancel_scrap_qty IS NULL))
 UNION ALL
 SELECT COALESCE(j.parent_job_id, j.id), j.id, 'weight_link'::text, (s.weight_split_out_g)::text
   FROM analytics.job_stage s JOIN analytics.job j ON j.id = s.job_id
  WHERE s.weight_split_out_g <> (SELECT COALESCE(sum(ls.weight_out_g), 0)
                              FROM analytics.job_stage ls JOIN analytics.job lj ON lj.id = ls.job_id
                             WHERE ls.split_from_stage_id = s.id AND NOT (lj.status = 'cancelled'::text AND lj.cancel_scrap_qty IS NULL))
 UNION ALL
 SELECT COALESCE(j.parent_job_id, j.id), j.id, 'job_split_sum'::text, (j.qty_split_out)::text
   FROM analytics.job j
  WHERE j.qty_split_out <> (SELECT COALESCE(sum(s.qty_split_out), 0) FROM analytics.job_stage s WHERE s.job_id = j.id)
 UNION ALL
 SELECT j.parent_job_id, j.id, 'lot_split_stage'::text, NULL::text
   FROM analytics.job j
  WHERE j.parent_job_id IS NOT NULL
    AND (SELECT count(*) FROM analytics.job_stage s WHERE s.job_id = j.id AND s.split_from_stage_id IS NOT NULL) <> 1
 UNION ALL
 SELECT r.id, r.id, 'tree_sum'::text, (r.qty_planned)::text
   FROM analytics.job r
  WHERE r.parent_job_id IS NULL
    AND r.qty_planned <> (SELECT COALESCE(sum(t.qty_planned), 0) - COALESCE(sum((SELECT COALESCE(sum(s.qty_split_out), 0) FROM analytics.job_stage s WHERE s.job_id = t.id)), 0)
                            FROM analytics.job t
                           WHERE (t.id = r.id OR t.parent_job_id = r.id)
                             AND NOT (t.status = 'cancelled'::text AND t.parent_job_id IS NOT NULL AND t.cancel_scrap_qty IS NULL))
 UNION ALL
 SELECT d.root_job_id, d.job_id, 'discrepancy_chain'::text, (d.qty)::text
   FROM analytics.job_discrepancy d
   JOIN analytics.job_stage tos ON tos.id = d.to_stage_id
   JOIN analytics.job_stage fs ON fs.id = d.from_stage_id
  WHERE d.status IN ('open', 'resolved')
    AND NOT EXISTS (SELECT 1 FROM analytics.job_discrepancy v WHERE v.void_of_id = d.id)
    AND tos.status IN ('received', 'sent')
    AND tos.qty_in IS DISTINCT FROM (fs.qty_out - analytics.job_disc_active_qty(fs.id, tos.id))
 UNION ALL
 -- M-C: ส่วนทองที่ยกเลิกเป็นของเสียและมีขั้นชั่ง ต้องมีน้ำหนักของเสียที่เลิกใช้เสมอ (ไม่งั้นทองหายจากการกระทบยอดน้ำหนัก)
 SELECT j.parent_job_id, j.id, 'cancel_weight'::text, NULL::text
   FROM analytics.job j
  WHERE j.parent_job_id IS NOT NULL AND j.status = 'cancelled'::text AND j.cancel_scrap_qty IS NOT NULL AND j.metal = 'gold'
    AND EXISTS (SELECT 1 FROM analytics.job_stage s WHERE s.job_id = j.id AND s.status <> 'skipped'::text AND s.weigh_required)
    AND j.cancel_scrap_weight_g IS NULL;

-- v_job_tree_stage_loss (M-A): v_job_stage_loss ทั้งต้นไม้ — 1 แถวต่อขั้นของทุกใบ (แม่ + ส่วน) พร้อม root_job_id/lot_seq ให้หน้าใบแม่ดึงครั้งเดียว
-- (เฉพาะออฟฟิศ — มี handoff_gap_g/น้ำหนัก · ห้ามส่งให้ช่าง N1) · cancel_scrap_weight_g = น้ำหนักของเสียที่เลิกใช้ของใบนั้น (M-C) นับเข้ายอดน้ำหนักของต้นไม้
create or replace view analytics.v_job_tree_stage_loss
  with (security_invoker = true) as
 SELECT COALESCE(j.parent_job_id, j.id) AS root_job_id,
    j.lot_seq,
    j.cancel_scrap_weight_g,
    l.*
   FROM analytics.v_job_stage_loss l
     JOIN analytics.job j ON j.id = l.job_id;

-- v_job_discrepancy (M-B): ส่วนต่างพร้อมน้ำหนักเทียบ · weight_gap_excess_g = weight_gap_g + weight_sent_g × qty/qty_sent (ลบ = โลหะหายเกินสัดส่วนชิ้นที่ขาด) · เฉพาะออฟฟิศ (N1)
create or replace view analytics.v_job_discrepancy
  with (security_invoker = true) as
 SELECT d.id AS discrepancy_id,
    d.shop_id,
    d.root_job_id,
    d.job_id,
    d.from_stage_id,
    d.to_stage_id,
    d.qty,
    d.status,
    d.resolved_kind,
    d.resolved_reason,
    d.resolved_at,
    d.void_of_id,
    d.created_at,
    d.weight_gap_g,
    d.weight_sent_g,
    d.qty_sent,
    analytics.job_disc_excess_g(d.weight_gap_g, d.weight_sent_g, d.qty, d.qty_sent) AS weight_gap_excess_g,
    j.metal
   FROM analytics.job_discrepancy d
     JOIN analytics.job j ON j.id = d.job_id;
-- ============================================================================
-- 7. views (อ่านฝั่ง server เท่านั้น · security_invoker · service_role เท่านั้น) — ต่อท้ายคอลัมน์เดิมเท่านั้น (42P16) · ไม่มีต้นทุน/ราคา
-- ============================================================================
-- v_job_board: 44 คอลัมน์เดิมคงเป๊ะ (ลอกจาก definition บน DB สด — ฉบับล่าสุดที่ 0176 แก้) + ต่อท้าย: parent_job_id · lot_seq · parts_count · parts_open · qty_pending_explanation · dominant_stage_code · handoff_gap_partial_g (H1: ส่วนต่างน้ำหนักของคู่ขั้นที่รับไม่ครบ — แทนค่า null เงียบ)
-- quote_qty_mismatch ไม่นับส่วนย่อย (qty_order ของส่วน = จำนวนของส่วนเอง ไม่ใช่จำนวนในใบเสนอราคา) · TS กรองแถวส่วนย่อยออกจากการ์ด (parent_job_id is null)
create or replace view analytics.v_job_board
  with (security_invoker = true) as
select b.*,
       jj.parent_job_id,
       jj.lot_seq,
       lt.parts_count,
       lt.parts_open,
       lt.qty_pending_explanation,
       case when jj.parent_job_id is null then coalesce(analytics.job_tree_dominant_stage(jj.id), b.current_stage_code)
            else b.current_stage_code end as dominant_stage_code,
       hgp.gap as handoff_gap_partial_g,
       tg.gap as tree_handoff_gap_g,
       tgp.gap as tree_handoff_gap_partial_g,
       tmc.n as tree_handoff_mismatch_count,
       tex.v as tree_weight_gap_excess_g,
       tlg.v as tree_lot_first_gap_sum_g
  from (
 SELECT j.id,
    j.shop_id,
    j.job_no,
    j.seq,
    j.source_kind,
        CASE j.source_kind
            WHEN 'oem'::text THEN aq.quote_no
            ELSE po.po_no
        END AS source_ref,
    j.design_label,
    j.sku_snapshot,
    j.metal,
    j.qty_planned,
    j.status,
    j.due_date,
    j.current_stage_code,
    d.name_th AS current_stage_name,
    cs.status AS current_stage_status,
    COALESCE(w.display_name, cs.assignee_name) AS holder_name,
    (analytics.job_today() - COALESCE(cs.received_on, ps.last_sent_on, analytics.job_bkk_date(j.created_at))) AS days_in_stage,
    ((j.due_date IS NOT NULL) AND (j.status = ANY (ARRAY['open'::text, 'in_progress'::text, 'on_hold'::text])) AND (j.due_date < analytics.job_today())) AS is_overdue,
    ev.last_event_at,
    ev.last_scan_at,
    ((j.status = ANY (ARRAY['open'::text, 'in_progress'::text])) AND (analytics.job_bkk_date(COALESCE(ev.last_event_at, j.created_at)) < (analytics.job_today() - 3))) AS is_stale,
    st.stage_count,
    st.stage_done_count,
    st.has_auto_closed,
    ((j.source_kind = 'oem'::text) AND (COALESCE(pay.paid, (0)::numeric) <= (0)::numeric)) AS deposit_missing,
    (j.start_gate_note IS NOT NULL) AS start_gate_note_present,
    ((j.source_kind = 'oem'::text) AND (j.status <> ALL (ARRAY['done'::text, 'cancelled'::text])) AND (j.parent_job_id IS NULL) AND (aqi.qty IS DISTINCT FROM j.qty_order)) AS quote_qty_mismatch,
    aqi.qty AS quote_item_qty,
    j.created_at,
    j.done_at,
    j.cancelled_at,
        CASE
            WHEN (j.status = ANY (ARRAY['done'::text, 'cancelled'::text])) THEN j.status
            WHEN (j.current_stage_code IS NULL) THEN 'awaiting_close'::text
            ELSE j.current_stage_code
        END AS board_column,
    hg.handoff_gap_g,
    hmc.handoff_mismatch_count,
    j.qty_order,
        CASE
            WHEN (j.status = 'done'::text) THEN (j.qty_good - j.qty_order)
            ELSE NULL::integer
        END AS qty_surplus,
    ((j.status <> ALL (ARRAY['done'::text, 'cancelled'::text])) AND (j.qty_planned < j.qty_order)) AS under_planned,
    ((j.status = 'done'::text) AND (j.qty_good > j.qty_order) AND (j.surplus_disposition = 'hold'::text)) AS surplus_pending,
    j.surplus_disposition,
    j.target_piece_g,
    j.metal_plan_g,
    j.profile_name,
    COALESCE(pw.has_weigh, false) AS has_weigh,
    ((j.metal = 'gold'::text) AND (j.status <> ALL (ARRAY['done'::text, 'cancelled'::text])) AND COALESCE(pw.unguarded, false)) AS gold_unguarded
   FROM ((((((((((((((analytics.job j
     LEFT JOIN analytics.job_stage cs ON (((cs.job_id = j.id) AND (cs.stage_code = j.current_stage_code))))
     LEFT JOIN analytics.job_stage_def d ON (((d.shop_id = j.shop_id) AND (d.code = j.current_stage_code))))
     LEFT JOIN analytics.worker w ON ((w.id = cs.worker_id)))
     LEFT JOIN LATERAL ( SELECT max(s.sent_on) AS last_sent_on
           FROM analytics.job_stage s
          WHERE (s.job_id = j.id)) ps ON (true))
     LEFT JOIN LATERAL ( SELECT max(e.recorded_at) AS last_event_at,
            max(e.recorded_at) FILTER (WHERE (e.channel = 'worker_qr'::text)) AS last_scan_at
           FROM analytics.job_event e
          WHERE (e.job_id = j.id)) ev ON (true))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS stage_count,
            (count(*) FILTER (WHERE (s.status = ANY (ARRAY['sent'::text, 'skipped'::text]))))::integer AS stage_done_count,
            COALESCE(bool_or(s.auto_closed), false) AS has_auto_closed
           FROM analytics.job_stage s
          WHERE (s.job_id = j.id)) st ON (true))
     LEFT JOIN LATERAL ( SELECT q.id,
            q.quote_no
           FROM analytics.oem_quote q
          WHERE ((j.source_kind = 'oem'::text) AND (COALESCE(q.root_quote_id, q.id) = j.root_quote_id))
          ORDER BY (q.status = 'superseded'::text), q.created_at DESC
         LIMIT 1) aq ON (true))
     LEFT JOIN LATERAL ( SELECT COALESCE(v.paid_thb, (0)::numeric) AS paid
           FROM analytics.v_oem_quote v
          WHERE (v.id = aq.id)) pay ON (true))
     LEFT JOIN LATERAL ( SELECT i.qty
           FROM analytics.oem_quote_item i
          WHERE ((i.quote_id = aq.id) AND (i.seq = j.oem_item_seq))) aqi ON (true))
     LEFT JOIN analytics.production_order_item poi ON ((poi.id = j.production_order_item_id)))
     LEFT JOIN analytics.production_order po ON ((po.id = poi.production_order_id)))
     LEFT JOIN LATERAL ( SELECT max(abs(l.handoff_gap_g)) AS handoff_gap_g
           FROM analytics.v_job_stage_loss l
          WHERE (l.job_id = j.id)) hg ON (true))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS handoff_mismatch_count
           FROM analytics.job_event e
          WHERE ((e.job_id = j.id) AND (e.event_type = 'weigh'::text) AND ((e.payload ->> 'kind'::text) = 'handoff_mismatch'::text))) hmc ON (true))
     LEFT JOIN LATERAL ( SELECT bool_or(s.weigh_required) AS has_weigh,
            bool_or((d2.metal_present AND (NOT s.weigh_required) AND (s.status <> 'skipped'::text))) AS unguarded
           FROM (analytics.job_stage s
             JOIN analytics.job_stage_def d2 ON (((d2.shop_id = s.shop_id) AND (d2.code = s.stage_code))))
          WHERE (s.job_id = j.id)) pw ON (true))

  ) b
  join analytics.job jj on jj.id = b.id
  left join lateral (
    select (count(*) filter (where t.status <> 'cancelled'))::integer as parts_count,
           (count(*) filter (where t.status in ('open', 'in_progress', 'on_hold')))::integer as parts_open,
           coalesce((select sum(d.qty) from analytics.job_discrepancy d
                      where d.root_job_id = jj.id and d.status = 'open'
                        and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d.id)), 0)::integer as qty_pending_explanation
      from analytics.job t
     where jj.parent_job_id is null and (t.id = jj.id or t.parent_job_id = jj.id)
  ) lt on true
  left join lateral (select max(abs(l.handoff_gap_partial_g)) as gap from analytics.v_job_stage_loss l where l.job_id = jj.id) hgp on true
  -- M-A (security): คอลัมน์ tree_* นับทั้งต้นไม้ (ใบแม่ + ส่วนที่ parent_job_id = ใบนี้) — handoff_* เดิมนับเฉพาะใบตัวเอง จึงมองไม่เห็นการเทียบน้ำหนักของขั้นแรกของส่วนย่อย (บอร์ดกรองแถวส่วนทิ้ง)
  left join lateral (select max(abs(l.handoff_gap_g)) as gap
                       from analytics.v_job_stage_loss l join analytics.job t on t.id = l.job_id
                      where t.id = jj.id or t.parent_job_id = jj.id) tg on true
  left join lateral (select max(abs(l.handoff_gap_partial_g)) as gap
                       from analytics.v_job_stage_loss l join analytics.job t on t.id = l.job_id
                      where t.id = jj.id or t.parent_job_id = jj.id) tgp on true
  left join lateral (select (count(*))::integer as n
                       from analytics.job_event e join analytics.job t on t.id = e.job_id
                      where (t.id = jj.id or t.parent_job_id = jj.id) and e.event_type = 'weigh' and e.payload ->> 'kind' = 'handoff_mismatch') tmc on true
  -- M-B: น้ำหนักที่หายเกินสัดส่วนชิ้นที่ขาด (รวมทุกส่วนต่างที่ยังนับอยู่ของต้นไม้ · ลบ = หายเกิน) · null = ไม่มีส่วนต่างที่มีน้ำหนักเทียบ
  left join lateral (select sum(analytics.job_disc_excess_g(d.weight_gap_g, d.weight_sent_g, d.qty, d.qty_sent)) as v
                       from analytics.job_discrepancy d
                      where d.root_job_id = coalesce(jj.parent_job_id, jj.id) and d.job_id in (select t.id from analytics.job t where t.id = jj.id or t.parent_job_id = jj.id)
                        and d.status in ('open', 'resolved')
                        and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d.id)) tex on true
  -- L-1: ส่วนย่อยจากขั้นเดียวกันแต่ละใบผ่านด่าน ±0.05 g เดี่ยวๆ แต่ผลรวม gap ของขั้นแรกของทุกส่วน (ต่อขั้นต้นทาง) ติดลบเกิน 0.05 = เตือน (ค่าต่ำสุดของกลุ่ม · ลบ = หาย)
  left join lateral (select min(g.s) as v
                       from (select sum(l.handoff_gap_g) as s
                               from analytics.job t
                               join analytics.job_stage ls on ls.job_id = t.id and ls.split_from_stage_id is not null
                               join analytics.job_stage nx on nx.job_id = t.id
                                    and nx.seq = (select min(n.seq) from analytics.job_stage n where n.job_id = t.id and n.seq > ls.seq and n.status <> 'skipped')
                               join analytics.v_job_stage_loss l on l.job_stage_id = nx.id
                              where jj.parent_job_id is null and t.parent_job_id = jj.id and l.handoff_gap_g is not null
                              group by ls.split_from_stage_id) g) tlg on true;

-- ============================================================================
-- 8. สิทธิ์ — service_role เท่านั้น (migration-traps ข้อ 2, 7, 18) · ปิดทุกอย่างก่อนแล้วเปิดเฉพาะที่ตั้งใจ · เฉพาะ object ที่ไฟล์นี้แตะ (ไม่เหวี่ยงแห)
-- ============================================================================
revoke all on analytics.job_discrepancy from public, anon, authenticated, service_role;
grant select on analytics.job_discrepancy to service_role;
revoke all on analytics.v_job_tree, analytics.v_job_tree_summary, analytics.v_job_tree_drift, analytics.v_job_tree_stage_loss, analytics.v_job_discrepancy
  from public, anon, authenticated, service_role;
grant select on analytics.v_job_tree, analytics.v_job_tree_summary, analytics.v_job_tree_drift, analytics.v_job_tree_stage_loss, analytics.v_job_discrepancy to service_role;
revoke all on analytics.v_job_board, analytics.v_job_stage_loss, analytics.v_job_stage_from_events, analytics.v_production_order_job_mismatch
  from public, anon, authenticated, service_role;
grant select on analytics.v_job_board, analytics.v_job_stage_loss, analytics.v_job_stage_from_events, analytics.v_production_order_job_mismatch to service_role;
-- คอลัมน์ใหม่ของตารางที่ grant ระดับคอลัมน์ไว้ (job_token ซ่อน token_hash · worker ซ่อน pin_hash) — job/job_stage grant ทั้งตารางอยู่แล้ว
grant select (purpose, lot_job_id) on analytics.job_token to service_role;
grant select (can_external) on analytics.worker to service_role;

do $g$
declare
  r record;
  v_touched constant text[] := array[
    'job_scrap_reason_valid', 'job_disc_excess_g', 'job_disc_active_qty', 'job_live_qty', 'job_identity_gap', 'job_tree_dominant_stage', 'job_lot_return_blocker',
    'job_discrepancy_guard', 'job_tree_assert', 'job_tree_check', 'job_lot_split_core', 'job_lot_cancel_core',
    'job_lot_split', 'job_lot_cancel', 'job_discrepancy_resolve', 'job_discrepancy_void', 'job_token_list',
    'job_worker_discrepancy_resolve', 'job_worker_lot_cancel',
    'job_cancel', 'job_core_receive', 'job_core_send', 'job_done', 'job_guard', 'job_office_begin', 'job_office_receive', 'job_source_info',
    'job_stage_guard', 'job_stage_reopen', 'job_stage_state', 'job_stage_sync', 'job_token_guard', 'job_token_issue', 'job_token_revoke',
    'job_worker_receive', 'job_worker_resolve', 'job_worker_send'];
  -- RPC ที่เปิดให้ service_role (server action/RPC) · job_stage_state + 4 helper = ที่ view (security_invoker) เรียก
  v_rpc constant text[] := array[
    'job_lot_split', 'job_lot_cancel', 'job_discrepancy_resolve', 'job_discrepancy_void', 'job_token_list',
    'job_worker_discrepancy_resolve', 'job_worker_lot_cancel',
    'job_cancel', 'job_done', 'job_office_receive', 'job_stage_reopen', 'job_token_issue', 'job_token_revoke',
    'job_worker_receive', 'job_worker_resolve', 'job_worker_send',
    'job_stage_state', 'job_disc_excess_g', 'job_disc_active_qty', 'job_live_qty', 'job_identity_gap', 'job_tree_dominant_stage'];
  v_n int;
  v_dup text;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace and p.proname = any (v_touched)
  loop
    -- 4 ชื่อเสมอ: public/anon/authenticated มาจากคนละทาง (ข้อ 18.1)
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname = any (v_rpc) then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
  -- ห้ามมี overload (migration-traps ข้อ 1) ทั้ง job_* และ worker_*
  select string_agg(proname, ', ') into v_dup from (
    select proname from pg_proc where pronamespace = 'analytics'::regnamespace and (proname like 'job\_%' or proname like 'worker\_%')
    group by proname having count(*) > 1) d;
  if v_dup is not null then
    raise exception '0181: พบ overload ของฟังก์ชัน: %', v_dup;
  end if;
  select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = any (v_touched);
  if v_n <> cardinality(v_touched) then
    raise exception '0181: ฟังก์ชันที่ประกาศ % ตัว แต่พบใน pg_proc % ตัว', cardinality(v_touched), v_n;
  end if;
end;
$g$;

-- ============================================================================
-- 9. post-check: ไม่แตะของเดิมนอกรายการ · ข้อมูลเดิมไม่ขยับ · trigger เปิดครบ · view/คอลัมน์ใหม่เป็นไปตามที่ตั้งใจ
-- ============================================================================
do $c$
declare
  v_changed text;
  v_new text;
  v_n_before int;
  v_n_after int;
  v_bad int;
  r record;
  v_touched constant text[] := array[
    'job_cancel', 'job_core_receive', 'job_core_send', 'job_done', 'job_guard', 'job_office_begin', 'job_office_receive', 'job_source_info',
    'job_stage_guard', 'job_stage_reopen', 'job_stage_state', 'job_stage_sync', 'job_token_guard', 'job_token_issue', 'job_token_revoke',
    'job_worker_receive', 'job_worker_resolve', 'job_worker_send'];
  v_added constant text[] := array[
    'job_scrap_reason_valid', 'job_disc_excess_g', 'job_disc_active_qty', 'job_live_qty', 'job_identity_gap', 'job_tree_dominant_stage', 'job_lot_return_blocker',
    'job_discrepancy_guard', 'job_tree_assert', 'job_tree_check', 'job_lot_split_core', 'job_lot_cancel_core',
    'job_lot_split', 'job_lot_cancel', 'job_discrepancy_resolve', 'job_discrepancy_void', 'job_token_list',
    'job_worker_discrepancy_resolve', 'job_worker_lot_cancel'];
begin
  -- (1) ฟังก์ชันเดิมที่ไม่ได้ตั้งใจแก้ md5 ต้องเท่าเดิมเป๊ะ (oem_*/production_*/stock_*/worker_*/job_* อื่นๆ ทุกตัวในสคีมา)
  select string_agg(b.sig, ', ') into v_changed
    from _j181_fn_base b
    left join pg_proc p on p.oid = to_regprocedure(b.sig)
   where b.proname <> all (v_touched) and (p.oid is null or md5(pg_get_functiondef(p.oid)) <> b.h);
  if v_changed is not null then
    raise exception '0181 แตะฟังก์ชันเดิมนอกรายการ (md5 ไม่เท่า/หาย): %', v_changed;
  end if;
  -- (2) ฟังก์ชันที่ replace: ครบทุกตัวและเปลี่ยนจริง (มีเครื่องหมาย 0181) · ฟังก์ชันใหม่ = รายการที่ประกาศเท่านั้น
  select string_agg(n, ', ') into v_new
    from unnest(v_touched) as n
   where not exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = n and position('0181' in pg_get_functiondef(p.oid)) > 0);
  if v_new is not null then
    raise exception '0181: ฟังก์ชันที่ควรถูกแทนที่แต่ยังไม่ใช่ฉบับ 0181: %', v_new;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_new
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
     and not exists (select 1 from _j181_fn_base b where b.sig = p.oid::regprocedure::text)
     and not (p.proname = any (v_added) or p.proname = any (v_touched));
  if v_new is not null then
    raise exception '0181: มีฟังก์ชันใหม่นอกรายการที่ประกาศ: %', v_new;
  end if;
  -- (3) แถวเดิมไม่ขยับ: จำนวนแถว + updated_at (ข้อ 19 — ไม่มี UPDATE ใดยิง trigger)
  select string_agg(b.t, ', ') into v_changed
    from _j181_row_base b
    join (select 'job'::text as t, count(*) as n, count(distinct updated_at) as nd, coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') as h from analytics.job
          union all select 'job_stage', count(*), count(distinct updated_at), coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') from analytics.job_stage
          union all select 'job_record_profile', count(*), count(distinct updated_at), coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') from analytics.job_record_profile
          union all select 'worker', count(*), count(distinct updated_at), coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') from analytics.worker) a on a.t = b.t
   where a.n <> b.n or a.nd <> b.nd or a.h <> b.h;
  if v_changed is not null then
    raise exception '0181: แถวเดิมขยับ (จำนวน/updated_at) ในตาราง: %', v_changed;
  end if;
  -- (4) ใบเดิมทุกใบ = ใบแม่ส่วนเดียว: parent null · lot_seq 0 · split_out 0 (ทั้ง job และ job_stage) · token purpose traveler
  select count(*) into v_bad from analytics.job where parent_job_id is not null or lot_seq <> 0 or qty_split_out <> 0 or cancel_scrap_qty is not null or cancel_scrap_weight_g is not null;
  if v_bad > 0 then
    raise exception '0181: พบใบงาน % ใบที่ไม่ใช่ "ใบแม่ส่วนเดียว" (parent/lot_seq/split_out) — ควรเป็น 0 ตอน apply ครั้งแรก', v_bad;
  end if;
  select count(*) into v_bad from analytics.job_stage where qty_split_out <> 0 or split_from_stage_id is not null or weight_split_out_g <> 0;
  if v_bad > 0 then
    raise exception '0181: พบขั้นที่มี split_out/split_from % ขั้น — ควรเป็น 0 ตอน apply ครั้งแรก', v_bad;
  end if;
  -- (5) trigger ของตารางใบงาน/ช่างเปิดครบ (ENABLE ALWAYS/ORIGIN = 'O' หรือ 'A') · ตารางใหม่มี guard + deny truncate · RLS เปิด ไม่มี policy
  select count(*) into v_bad from pg_trigger t
   where t.tgrelid in ('analytics.job'::regclass, 'analytics.job_stage'::regclass, 'analytics.job_event'::regclass, 'analytics.job_token'::regclass,
                       'analytics.worker'::regclass, 'analytics.job_discrepancy'::regclass)
     and not t.tgisinternal and t.tgenabled not in ('O', 'A');
  if v_bad > 0 then
    raise exception '0181: พบ trigger ของตารางใบงาน/ช่าง/ส่วนต่างที่ไม่ได้เปิด % ตัว', v_bad;
  end if;
  if (select count(*) from pg_trigger t where t.tgrelid = 'analytics.job_discrepancy'::regclass and not t.tgisinternal) <> 2 then
    raise exception '0181: job_discrepancy ต้องมี trigger 2 ตัว (guard + deny truncate)';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'analytics.job_discrepancy'::regclass)
     or exists (select 1 from pg_policy where polrelid = 'analytics.job_discrepancy'::regclass) then
    raise exception '0181: job_discrepancy ต้องเปิด RLS และไม่มี policy';
  end if;
  -- (6) view v_job_board: 44 คอลัมน์เดิมเป็น prefix เหมือนเดิมเป๊ะ + 12 คอลัมน์ใหม่ต่อท้าย
  select count(*) into v_n_after from information_schema.columns where table_schema = 'analytics' and table_name = 'v_job_board';
  if v_n_after <> 56
     or (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
          where table_schema = 'analytics' and table_name = 'v_job_board' and ordinal_position > 44)
        <> 'parent_job_id,lot_seq,parts_count,parts_open,qty_pending_explanation,dominant_stage_code,handoff_gap_partial_g,tree_handoff_gap_g,tree_handoff_gap_partial_g,tree_handoff_mismatch_count,tree_weight_gap_excess_g,tree_lot_first_gap_sum_g' then
    raise exception '0181: v_job_board ต้องมี 56 คอลัมน์ (44 เดิม + 12 ใหม่ต่อท้าย) — พบ %', v_n_after;
  end if;
  -- (7) ข้อมูลเดิมผ่านนิยามใหม่ (แจ้งอย่างเดียว — ใบเดิมไม่ผ่านด่านต้นไม้ เพราะข้ามสำหรับต้นไม้ที่ไม่มีส่วน)
  select count(*) into v_bad from analytics.v_job_tree_drift;
  raise notice '0181: v_job_tree_drift บนข้อมูลเดิม = % แถว (แจ้งอย่างเดียว) · job_tree_assert ข้ามต้นไม้ที่ไม่มีส่วน/ส่วนต่างทุกใบ', v_bad;
  raise notice '0181: ฟังก์ชันเดิม % ตัว md5 เท่าเดิมทั้งหมด (ยกเว้น % ตัวที่ replace) · ฟังก์ชันใหม่ % ตัว',
    (select count(*) from _j181_fn_base) - (select count(*) from _j181_fn_base where proname = any (v_touched)),
    (select count(*) from _j181_fn_base where proname = any (v_touched)), cardinality(v_added);
end;
$c$;

comment on table analytics.job is
  '0172: ใบงานผลิต 1 ใบ = 1 source item (OEM quote item หรือ production order item) · เขียนผ่าน RPC job_* เท่านั้น · done/cancelled เป็นปลายทาง (trigger job_guard) · 0181: parent_job_id is null = ใบแม่ · มี parent_job_id = ส่วนย่อย (ส่งต่อ n จาก N) ชั้นเดียว';
comment on column analytics.job.qty_split_out is
  '0181: ชิ้นที่แยกออกเป็นส่วนย่อย (= Σ job_stage.qty_split_out · เขียนผ่าน trigger job_stage_sync เท่านั้น — job_guard บังคับเท่ากัน)';
comment on column analytics.job_stage.qty_split_out is
  '0181: ชิ้นที่ผู้ถือแยกออกเป็นส่วนย่อยขณะถือขั้นนี้ · = Σ จำนวนของส่วนที่ชี้ขั้นนี้ (job_stage_guard บังคับ) · ผู้ถือเหลืออย่างน้อย 1 ชิ้นเสมอ';
comment on column analytics.job_token.purpose is
  '0181: ป้ายชนิด QR (traveler/sublot/delivery_note) — ไม่ใช่ตัวจำกัดสิทธิ์: ทุก QR ของใบเปิดหน้าเดียวกัน ระบบแยกส่วนจากช่างที่ PIN';

notify pgrst, 'reload schema';

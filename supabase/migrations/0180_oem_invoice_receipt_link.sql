-- 0180_oem_invoice_receipt_link.sql
-- ใบแจ้งหนี้ OEM (phase I2) — ผูกใบเสร็จ/ใบกำกับภาษี (oem_receipt) กับใบแจ้งหนี้ + ปิดข้อ security ค้างจาก 0179 (M1 · M2 · L1)
-- design: docs/3j-jewelry/analytics/design-oem-invoice.md (§3 จับคู่ใบเสร็จ · §8 · §9 เคส 16-19 + A-J · §14 · §15)
--
-- 🔴 apply ด้วย `node scripts/run-sql.mjs supabase/migrations/0180_oem_invoice_receipt_link.sql --commit --record` เท่านั้น
--    ห้าม `supabase db push` · ไฟล์ต้องเป็น LF (traps ข้อ 20) · dry-run ก่อนเสมอ (ไม่ใส่ --commit) + รัน scripts/verify/verify-0180.sql
--    ยังไม่ apply — 💰 แตะ oem_receipt_issue (เอกสารภาษี) + ตัวนับเลขเอกสาร ⇒ security ผ่านก่อน apply/merge
--    ลำดับ deploy: apply migration -> merge/deploy TS (lib/actions/oem.ts ส่ง p_invoice_id/p_actor_id) · TS เดิมที่ยังไม่ deploy เรียกฟังก์ชันใหม่ได้
--    เพราะพารามิเตอร์ใหม่ทั้งสองมี default (PostgREST จับคู่ตามชื่อ — ไม่ใช่ PGRST202)
--
-- ============================ สิ่งที่ไฟล์นี้ทำ ============================
--   1. oem_require_actor_member (helper ใหม่) — L1: p_actor_id ต้องเป็นสมาชิกร้าน role owner/admin จริง (42501)
--      เหตุผล: crm_require_owner_admin คืนทันทีเมื่อ auth.role()='service_role' ไม่ตรวจสมาชิก ·
--      actor ที่รับจาก p_actor_id ต้องเพียง "มีอยู่ใน auth.users" — user ใดก็ได้ (แม้ไม่ใช่สมาชิกร้านนี้) ถูกบันทึกเป็นผู้ออก/ยกเลิกเอกสารได้
--   2. oem_receipt: + invoice_id (FK -> oem_invoice, on delete restrict) + invoice_no_snapshot · CHECK คู่ (null/null หรือมีทั้งคู่) ·
--      partial unique index (ใบแจ้งหนี้หนึ่งใบมีใบเสร็จ issued ได้ใบเดียว) · trigger BEFORE INSERT ตรวจความสมจริงของ link ที่ตารางเอง
--      (ใบแจ้งหนี้ issued · ร้าน/ดีลเดียวกัน · ยอดเท่า · snapshot เลขใบ = เลขจริง) — ด่านซ้ำกันคนเขียนตรงทะลุ RPC
--   3. v_oem_invoice: แก้ lateral ps จุดเดียว (0179 เตรียมไว้) — payment_state = void | paid | unpaid · receipt_id/receipt_no/received_date มีค่า ·
--      is_stale/is_overdue ไม่นับใบ paid (นิยามเดิมอ่าน ps.state อยู่แล้ว) · ใบเสร็จ void -> กลับเป็น unpaid เอง (derived ไม่มี UPDATE)
--   4. v_oem_receipt: append invoice_id + invoice_no_snapshot ท้ายสุด (r.* ถูกขยายตอน create view — คอลัมน์ใหม่ไม่โผล่เอง)
--   5. oem_receipt_issue: 9 args -> 11 args (+ p_invoice_id, p_actor_id ทั้งคู่ default null) — drop signature 9 args เดิม (traps ข้อ 1)
--      ไม่ส่ง invoice/actor = พฤติกรรม 0088 เดิมทุกประการ (golden เทียบกับ legacy ใน verify-0180) ·
--      ส่ง invoice = ด่านเพิ่ม (ล็อกแถว quote แถวเดิม + ล็อกแถวใบแจ้งหนี้): ร้านเดียวกัน · issued · ดีลเดียวกัน · ไม่ paid · ไม่ stale · ยอดเท่าเป๊ะ ·
--      kind map (deposit->deposit, balance->final) · reissue ต้องอ้าง invoice เดียวกับใบเดิม (ล็อกตัวที่ 6 ต่อจาก 5 ตัวของ 0087/0088)
--   6. L1: oem_invoice_issue / oem_invoice_void / oem_setting_set_payment_lines + oem_receipt_issue ใหม่ เรียก oem_require_actor_member
--   7. M1: ทุกการแก้ seller_payment_lines (ทั้งทาง RPC และเขียนตรง) -> แถว crm_audit_log action 'oem_payment_lines_set' (before/after)
--   8. M2: oem_doc_counter — revoke insert/update/delete/truncate จาก service_role + trigger BEFORE INSERT บังคับ last_no = 1
--
-- ============================ ตัดสินใจเรื่องใบเสร็จที่ออกก่อน 0180 (ทางเลือก ก/ข) ============================
-- สถานการณ์: IV-2610-001 (ใบมัดจำ OEM-2610-004, 56,800.00 THB) ออกจริงแล้ว 16 ต.ค. 69 ก่อน 0180 ลง · ถ้าลูกค้าโอนมัดจำแล้วเจ้าของบันทึกรับเงินผ่าน UI เดิม
-- (ไม่อ้างใบ) ก่อน 0180 ใบเสร็จนั้นจะไม่มี invoice_id และ IV-2610-001 กลายเป็น stale ·
-- ตรวจสดวันเขียนไฟล์นี้ (16 ต.ค. 69): ยังไม่มีใบเสร็จหลัง RT-2609-001 เลย (ตัวนับ RT-2608=18 RT-2609=1 IV-2610=1) = ยังไม่มีเคสจริง
--
--   (ก) ปล่อยตาม design — ไม่ backfill  ◀◀ ข้อเสนอของ backend-dev (ใช้ในไฟล์นี้)
--       void IV-2610-001 ด้วยเหตุผล "ลูกค้าโอนก่อนผูกใบ" (เส้นทาง flow C ของ design §3 — รองรับอยู่แล้ว) · ใบเสร็จคงเดิมไม่แตะ ·
--       ถ้ายังต้องเก็บเงินส่วนที่เหลือ ออกใบแจ้งหนี้ balance ใหม่ตามปกติ (ยอดรับสะสมอ่านจากใบเสร็จของดีลอยู่แล้ว)
--   (ข) backfill ครั้งเดียว — ❌ ไม่เลือก · เหตุผล
--       1) ใบเสร็จเป็นเอกสารภาษีตายตัว: ผูก = ต้องแก้แถว (invoice_id) ⇒ ต้องปิด trg_oem_receipt_deny_mutation ในทรานแซกชัน
--          (ช่องเดียวที่แก้เอกสารภาษีที่ออกแล้วได้ — ขัดหลัก "ออกแล้วห้ามแก้" แม้ค่าเดียวและแม้ชั่วคราว) ผ่าน security ยากและเป็นบรรทัดที่คนอื่นจะลอกไปใช้ต่อ
--       2) ตารางความสัมพันธ์แยก (oem_invoice_receipt_link) ทำให้ "ใบนี้ paid ไหม" มี 2 แหล่งความจริง (receipt.invoice_id vs link) —
--          view / ด่าน unique / ด่าน void ต้องดูทั้งสองที่ตลอดไป เพื่อรองรับเคสที่อาจเป็นศูนย์แถว
--       3) ใบแจ้งหนี้ไม่ใช่เอกสารภาษี: ผลของ (ก) = แค่ IV เก่าถูก void + กระดาษใบใหม่ (ถ้าจำเป็น) ไม่มีผลทางภาษี/บัญชี
--       4) การจับคู่อัตโนมัติ (ดีลเดียว + kind ตรง + ยอดเท่าเป๊ะ) เดาแทนมนุษย์ — ใบเสร็จที่ตรงเงื่อนไขอาจเป็นเงินคนละก้อน (โอนซ้ำ/โอนแทนอีกดีลที่ยอดเท่ากัน)
--   ที่ทำในไฟล์นี้เพื่อให้ตัดสินใจได้ตอน apply: pre-flight ข้างล่างรัน query นับ "ใบเสร็จ issued ที่ออกตั้งแต่วันออกใบแจ้งหนี้ ดีลเดียวกัน kind ตรง ยอดเท่าเป๊ะ
--   และใบแจ้งหนี้ issued ที่ยังไม่ผูก" แล้ว raise notice ในผล dry-run/commit — ถ้า notice > 0 ให้หยุดและให้เจ้าของตัดสินใจเป็นเคสๆ ก่อน --commit
--   (ต่อให้มี ก็ไม่เปลี่ยนความถูกต้องของ migration — แค่เป็นเคสที่ void IV แล้วออกใหม่ตามข้อ ก)
--
-- ============================ กับดัก (3j-migration-traps) ที่ไฟล์นี้ตั้งใจเลี่ยง ============================
--   ข้อ 1  oem_receipt_issue เปลี่ยน arg list -> drop signature 9 args · ท้ายไฟล์ assert ทุกชื่อมี signature เดียว
--   ข้อ 2/18 re-grant ครบทุกตัวที่แตะ: revoke ... from public, anon, authenticated แล้ว grant service_role เท่านั้น (ของใหม่ทุกตัว)
--   ข้อ 3  v_oem_invoice: 53 คอลัมน์ ชื่อ/ลำดับเดิมเป๊ะ (assert md5 รายชื่อคอลัมน์) · v_oem_receipt: append ท้ายเท่านั้น · v_oem_quote ไม่แตะ
--   ข้อ 4/13 ด่านยอดใช้ distinct-from กับค่าที่ client ส่ง (ไม่ปัดเศษ) · ด่าน is_stale: null = ตก (coalesce(...,true)) ไม่ใช่ผ่าน
--   ข้อ 6  วันทางธุรกิจ = เวลาไทย (ฟังก์ชันเดิมไม่ถูกแตะส่วนนี้)
--   ข้อ 19 ไฟล์นี้ไม่มี UPDATE/DELETE ตารางเดิมเลย (ADD COLUMN nullable ไม่ยิง trigger) · pre-flight เป็น SELECT ล้วน · assert ท้ายไฟล์ว่า
--          ตัวนับ/ใบเสร็จ/ใบแจ้งหนี้ md5 เท่าก่อน-หลัง
--   ข้อ 21 ฟังก์ชันที่ replace ลอกจาก pg_get_functiondef บน DB สด (16 ต.ค. 69) ไม่ใช่จากไฟล์ 0088/0179 — แก้เฉพาะจุดที่ระบุ (diff ต้นทางด้านล่าง) ·
--          md5 guard ก่อน replace (ถ้านิยามบน DB ไม่ตรง baseline = raise ถอยทั้งไฟล์ ไม่ทับของที่ใครแก้นอกแผน)
--
-- ฟังก์ชันที่ replace / ต้นทาง / baseline md5 (นิยามสดบน DB ก่อน apply):
--   analytics.oem_receipt_issue(9 args) 237152ffe9b75961c522bbe7994a836a  (ต้นทาง 0088) -> drop + create 11 args
--   analytics.oem_invoice_issue         c6087fb86bad5e755943e03b9e9ac221  (ต้นทาง 0179) -> เพิ่ม 1 บรรทัด L1 เท่านั้น
--   analytics.oem_invoice_void          6c1194c1e49bf00ef9c1ecb2085d48d3  (ต้นทาง 0179) -> เพิ่ม 1 บรรทัด L1 เท่านั้น
--   analytics.oem_setting_set_payment_lines c90115f15a8fcd7af83d798af7a3167a (ต้นทาง 0179) -> เพิ่ม 1 บรรทัด L1 เท่านั้น
--   view analytics.v_oem_invoice (97c56e6c9b9ca522e4805c677798119d) · v_oem_receipt (116f1ec779a67965963505e5ed7a633e)
-- ไม่แตะ (ตรวจแล้วไม่ต้องแก้): oem_receipt_void (ใบเสร็จ void แล้ว invoice กลับ unpaid ผ่าน view เอง · partial unique ไม่นับ void) ·
--   oem_receipt_deny_mutation (เทียบ to_jsonb(new)-4 คอลัมน์ ⇒ คอลัมน์ใหม่ถูกแช่แข็งอัตโนมัติ) · oem_doc_counter_deny_mutation (ข้อความ error ที่อ้าง
--   oem_receipt_issue ยอมรับเป็นหนี้เล็ก — ไม่แก้ฟังก์ชัน trigger ของเอกสารภาษี) · v_oem_quote · oem_setting_upsert · job_*
--
-- ⚠️ ข้อจำกัดที่รู้ตัว (รายงานใน handoff)
--   (ก) L1 บน oem_receipt_issue: ทางเดิม (ไม่ส่ง p_invoice_id และไม่ส่ง p_actor_id) ยังไม่บังคับ actor — เพื่อให้ TS เดิมใช้ได้ระหว่างช่วง apply->deploy ·
--       หลัง deploy TS ใหม่ (ส่ง p_actor_id ทุกครั้ง) แนะนำ 0181 บังคับ actor ทุกทาง
--   (ข) oem_receipt_void ยังไม่มี actor (voided_by = auth.uid() = null ใต้ service_role) — ไม่อยู่ใน brief ของรอบนี้
--   (ค) service_role ยังมีสิทธิ์ INSERT/UPDATE/DELETE ตรงบน oem_receipt (trigger กัน UPDATE/DELETE แต่ INSERT เขียนใบเสร็จปลอมได้ถ้าถือ key) — มีมาตั้งแต่ 0084
--       ไฟล์นี้ปิดเฉพาะ "link ปลอม" (trigger ข้อ 2) และ oem_doc_counter (ข้อ 8) ไม่ revoke ตาราง oem_receipt (นอก brief — เสนอให้ security พิจารณา)
--   (ง) race 2 connection (ออกใบเสร็จอ้างใบเดียวกันพร้อมกัน / void ใบแจ้งหนี้ชนกับออกใบเสร็จ) ไม่มีเทสต์ใน do-block เดียว — กันด้วย for update แถว quote + แถวใบแจ้งหนี้ + unique index

-- ============================================================================
-- 0. pre-flight — md5 guard (นิยามบน DB ต้องเท่า baseline หรือเป็นของ 0180 อยู่แล้ว) + นับเคสใบเสร็จก่อน 0180 + baseline ตัวนับ
--    SELECT ล้วน ไม่เขียนข้อมูล
-- ============================================================================
create temp table _pre0180 on commit drop as
select
  (select coalesce(md5(string_agg(shop_id::text || doc_key || last_no::text, ',' order by shop_id, doc_key)), '') from analytics.oem_doc_counter) as counters,
  (select coalesce(md5(string_agg(to_jsonb(i)::text, ',' order by i.id)), '') from analytics.oem_invoice i) as invoices,
  (select count(*) from analytics.oem_receipt) as n_receipts,
  (select count(*) from analytics.oem_invoice) as n_invoices;

do $g0180$
declare
  v_sig9  text := 'analytics.oem_receipt_issue(uuid,uuid,numeric,date,text,text,text,text,uuid)';
  v_sig11 text := 'analytics.oem_receipt_issue(uuid,uuid,numeric,date,text,text,text,text,uuid,uuid,uuid)';
  v_src   text;
  v_n     int;
  v_n_inv int;
begin
  -- oem_receipt_issue: ต้องเป็น 9 args baseline (หรือ 11 args ของ 0180 อยู่แล้ว = รันซ้ำ)
  if to_regprocedure(v_sig9) is not null then
    if md5(pg_get_functiondef(to_regprocedure(v_sig9))) <> '237152ffe9b75961c522bbe7994a836a' then
      raise exception '0180: oem_receipt_issue (9 args) บน DB ไม่ตรง baseline 0088 (md5 ต่าง) — มีคนแก้นอกแผน หยุดแล้วเทียบนิยามสดก่อน (traps ข้อ 21)';
    end if;
  elsif to_regprocedure(v_sig11) is null then
    raise exception '0180: ไม่พบ oem_receipt_issue ทั้ง 9 และ 11 args';
  end if;

  -- 3 ฟังก์ชันที่เติมบรรทัด L1: baseline หรือมีเครื่องหมาย 0180 L1 อยู่แล้ว
  for v_src, v_n in
    select p.proname || '|' || md5(pg_get_functiondef(p.oid)) || '|' || (position('0180 L1' in p.prosrc) > 0)::text, 1
      from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace
       and p.proname in ('oem_invoice_issue', 'oem_invoice_void', 'oem_setting_set_payment_lines')
  loop
    if v_src not in (
         'oem_invoice_issue|c6087fb86bad5e755943e03b9e9ac221|false',
         'oem_invoice_void|6c1194c1e49bf00ef9c1ecb2085d48d3|false',
         'oem_setting_set_payment_lines|c90115f15a8fcd7af83d798af7a3167a|false')
       and v_src not like '%|true' then
      raise exception '0180: นิยามบน DB ไม่ตรง baseline 0179 (%) — มีคนแก้นอกแผน หยุดแล้วเทียบนิยามสดก่อน', split_part(v_src, '|', 1);
    end if;
  end loop;

  -- view: baseline หรือเป็นของ 0180 อยู่แล้ว
  if md5(pg_get_viewdef('analytics.v_oem_invoice'::regclass)) <> '97c56e6c9b9ca522e4805c677798119d'
     and position('rc.receipt_no' in pg_get_viewdef('analytics.v_oem_invoice'::regclass)) = 0 then
    raise exception '0180: v_oem_invoice บน DB ไม่ตรง baseline 0179 — หยุดแล้วเทียบนิยามสดก่อน (traps ข้อ 3)';
  end if;
  if md5(pg_get_viewdef('analytics.v_oem_receipt'::regclass)) <> '116f1ec779a67965963505e5ed7a633e'
     and position('invoice_no_snapshot' in pg_get_viewdef('analytics.v_oem_receipt'::regclass)) = 0 then
    raise exception '0180: v_oem_receipt บน DB ไม่ตรง baseline (md5 ต่าง) — หยุดแล้วเทียบนิยามสดก่อน (traps ข้อ 3)';
  end if;

  -- CHECK action ของ crm_audit_log: baseline 11 action หรือมี oem_payment_lines_set อยู่แล้ว
  select count(*) into v_n from pg_constraint c
   where c.conrelid = 'analytics.crm_audit_log'::regclass and c.conname = 'crm_audit_log_action_check'
     and (md5(pg_get_constraintdef(c.oid)) = '11b38e5290e92506dec7f765bf2eb796'
          or position('oem_payment_lines_set' in pg_get_constraintdef(c.oid)) > 0);
  if v_n <> 1 then
    raise exception '0180: CHECK crm_audit_log_action_check บน DB ไม่ตรง baseline (มีคนเพิ่ม action ใหม่?) — ลอกรายการล่าสุดจาก pg_constraint แล้วอัปเดตไฟล์นี้ก่อน';
  end if;

  -- ข้อมูลประกอบการตัดสินใจ ก/ข (ข้างบน): ใบเสร็จที่ "ดูเหมือนควรผูก" ใบแจ้งหนี้ issued ที่ยังไม่มีใบเสร็จอ้าง (ใน 0180 ยังไม่มีคอลัมน์ invoice_id = ทุกใบยังไม่ผูก)
  select count(*) into v_n
    from analytics.oem_invoice i
    join analytics.oem_quote iq on iq.id = i.quote_id and iq.shop_id = i.shop_id
    join analytics.oem_receipt r on r.shop_id = i.shop_id and r.status = 'issued'
    join analytics.oem_quote rq on rq.id = r.quote_id
   where i.status = 'issued'
     and coalesce(rq.root_quote_id, rq.id) = coalesce(iq.root_quote_id, iq.id)
     and r.issue_date >= i.issue_date
     and r.amount_thb = i.amount_thb
     and r.kind = case i.kind when 'deposit' then 'deposit' else 'final' end;
  select count(*) into v_n_inv from analytics.oem_invoice i where i.status = 'issued';
  raise notice '0180 pre-flight: ใบแจ้งหนี้ issued % ใบ · ใบเสร็จที่ตรงเงื่อนไข backfill (ดีลเดียว+kind ตรง+ยอดเท่าเป๊ะ+ออกหลังใบแจ้งหนี้) % ใบ — ถ้า > 0 หยุดและให้เจ้าของตัดสินก่อน --commit (ดูหัวไฟล์ ทางเลือก ก/ข)', v_n_inv, v_n;
end
$g0180$;

-- ============================================================================
-- 1. L1 helper — actor ต้องเป็นสมาชิกร้าน (owner/admin) จริง
--    security definer เพื่ออ่าน public.shop_member โดยไม่พึ่งสิทธิ์ของผู้เรียก · เรียกจากฟังก์ชัน definer อื่นเท่านั้น
-- ============================================================================
create or replace function analytics.oem_require_actor_member(p_shop_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = public, analytics, extensions, pg_temp
as $f$
begin
  if p_shop_id is null or p_actor_id is null then
    raise exception 'oem_require_actor_member: ต้องระบุร้านและผู้ทำรายการ' using errcode = '22023', hint = 'actor_required';
  end if;
  if not exists (
    select 1 from public.shop_member m
     where m.shop_id = p_shop_id and m.user_id = p_actor_id and m.role in ('owner', 'admin')
  ) then
    -- ไม่ใส่ id ผู้ใช้ลงข้อความ (ข้อความอาจถูกส่งต่อถึง UI) — ใช้ 42501 แบบเดียวกับ crm_require_owner_admin
    raise exception 'oem: ผู้ทำรายการไม่ใช่เจ้าของ/แอดมินของร้านนี้' using errcode = '42501', hint = 'actor_not_member';
  end if;
end;
$f$;

revoke execute on function analytics.oem_require_actor_member(uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.oem_require_actor_member(uuid, uuid) to service_role;

-- ============================================================================
-- 2. oem_receipt: invoice_id + invoice_no_snapshot (nullable — ใบเสร็จเดิมทุกใบคง null) · unique · trigger ตรวจ link
--    ADD COLUMN nullable ไม่มี default = metadata-only ไม่ยิง trg_oem_receipt_deny_mutation ไม่ทับแถวเดิม
-- ============================================================================
alter table analytics.oem_receipt
  add column if not exists invoice_id uuid references analytics.oem_invoice (id) on delete restrict,
  add column if not exists invoice_no_snapshot text;

comment on column analytics.oem_receipt.invoice_id is
  '0180: ใบแจ้งหนี้ที่ใบเสร็จนี้ชำระ (null = รับเงินแบบไม่อ้างใบ) · กำหนดตอนออกใบเสร็จเท่านั้น (เอกสารภาษีแก้ไม่ได้) · ยอดต้องเท่าใบแจ้งหนี้เป๊ะ · ใบแจ้งหนี้หนึ่งใบมีใบเสร็จ issued ได้ใบเดียว';
comment on column analytics.oem_receipt.invoice_no_snapshot is
  '0180: เลขใบแจ้งหนี้ ณ ตอนออกใบเสร็จ (snapshot — ต้องเท่า oem_invoice.invoice_no ของ invoice_id) พิมพ์ซ้ำอีก 5 ปีต้องได้เลขเดิม';

alter table analytics.oem_receipt drop constraint if exists oem_receipt_invoice_pair_check;
alter table analytics.oem_receipt
  add constraint oem_receipt_invoice_pair_check check ((invoice_id is null) = (invoice_no_snapshot is null));

-- กำแพงสุดท้ายของ "ใบแจ้งหนี้หนึ่งใบ ผูกใบเสร็จ active ได้ใบเดียว" (ทะลุ RPC ก็ตกที่นี่ 23505) · void แล้วปล่อยให้ผูกใหม่ได้
create unique index if not exists oem_receipt_one_issued_per_invoice
  on analytics.oem_receipt (invoice_id)
  where status = 'issued' and invoice_id is not null;

-- ด่านซ้ำที่ตารางเอง: เขียน invoice_id ตรงโดยไม่ผ่าน RPC ก็ปลอม link ไม่ได้ (ร้าน/ดีล/ยอด/เลขใบ/สถานะ ต้องจริง)
create or replace function analytics.oem_receipt_check_invoice_link()
returns trigger
language plpgsql
security definer
set search_path = public, analytics, extensions, pg_temp
as $f$
declare
  v_inv      analytics.oem_invoice%rowtype;
  v_inv_root uuid;
  v_new_root uuid;
begin
  if new.invoice_id is null then
    return new;
  end if;
  select * into v_inv from analytics.oem_invoice where id = new.invoice_id;
  if not found or v_inv.shop_id is distinct from new.shop_id then
    raise exception 'oem_receipt: invoice_id ต้องชี้ใบแจ้งหนี้ของร้านเดียวกัน' using errcode = '22023', hint = 'invoice_not_found';
  end if;
  if v_inv.status <> 'issued' or new.status <> 'issued' then
    raise exception 'oem_receipt: อ้างใบแจ้งหนี้ได้เฉพาะใบเสร็จและใบแจ้งหนี้สถานะ issued' using errcode = '22023', hint = 'invoice_not_issued';
  end if;
  if v_inv.invoice_no is distinct from new.invoice_no_snapshot then
    raise exception 'oem_receipt: invoice_no_snapshot ต้องเท่าเลขที่ใบแจ้งหนี้จริง' using errcode = '22023', hint = 'invoice_snapshot_mismatch';
  end if;
  if v_inv.amount_thb is distinct from new.amount_thb then
    raise exception 'oem_receipt: ยอดใบเสร็จต้องเท่ายอดใบแจ้งหนี้ที่อ้างเป๊ะ' using errcode = '22023', hint = 'invoice_amount_mismatch';
  end if;
  select coalesce(q.root_quote_id, q.id) into v_inv_root from analytics.oem_quote q where q.id = v_inv.quote_id;
  select coalesce(q.root_quote_id, q.id) into v_new_root from analytics.oem_quote q where q.id = new.quote_id;
  if v_inv_root is null or v_inv_root is distinct from v_new_root then
    raise exception 'oem_receipt: ใบแจ้งหนี้ที่อ้างต้องอยู่ดีลเดียวกับใบเสร็จ' using errcode = '22023', hint = 'invoice_deal_mismatch';
  end if;
  return new;
end;
$f$;

revoke execute on function analytics.oem_receipt_check_invoice_link() from public, anon, authenticated;

drop trigger if exists trg_oem_receipt_check_invoice_link on analytics.oem_receipt;
create trigger trg_oem_receipt_check_invoice_link
  before insert on analytics.oem_receipt
  for each row execute function analytics.oem_receipt_check_invoice_link();

-- ============================================================================
-- 3. v_oem_invoice — แก้ lateral ps จุดเดียว (+ lateral rc หา "ใบเสร็จ issued ที่อ้างใบนี้")
--    select list = 53 คอลัมน์ ชื่อ/ลำดับ/ชนิดเดิมเป๊ะ (ลอกจาก 0179 ที่ md5 เท่านิยามบน DB — guard ข้างบน) · receipt_id/receipt_no/received_date มีค่าแล้ว
--    is_stale / is_overdue อ่าน ps.state อยู่แล้ว ⇒ ใบ paid ไม่ถูกนับ stale/overdue โดยไม่ต้องแก้นิยามสองคอลัมน์นั้น
--    void ใบเสร็จ -> rc ว่าง -> payment_state กลับเป็น unpaid เอง (ไม่มี UPDATE ที่ oem_invoice — ตารางนั้นแก้ได้แค่ 4 คอลัมน์ void)
-- ============================================================================
create or replace view analytics.v_oem_invoice with (security_invoker = true) as
select
  i.id,
  i.shop_id,
  i.quote_id,
  i.invoice_no,
  i.kind,
  i.status,
  i.amount_thb,
  i.vat_display,
  i.vat_rate,
  i.vat_base_thb,
  i.vat_amount_thb,
  i.issue_date,
  i.due_date,
  i.pay_before_work,
  i.description,
  i.note,
  i.seller_snapshot,
  i.payment_lines,
  i.buyer_legal_name,
  i.buyer_tax_id,
  i.buyer_branch_label,
  i.buyer_address,
  i.quote_no_snapshot,
  i.lines_snapshot,
  i.pieces_subtotal_snapshot,
  i.nre_price_snapshot,
  i.discount_thb_snapshot,
  i.grand_total_snapshot,
  i.deposit_amount_snapshot,
  i.deposit_pct_snapshot,
  i.paid_before_thb,
  i.balance_after_thb,
  i.void_reason,
  i.voided_at,
  i.replaces_invoice_id,
  i.created_at,
  q.quote_no,
  q.status as quote_status,
  coalesce(q.root_quote_id, q.id) as deal_root_id,
  (q.status <> 'superseded') as is_deal_active,
  act.id as active_quote_id,
  act.quote_no as deal_quote_no,
  act.status as deal_quote_status,
  act.quote_valid_until as quote_valid_until,
  act.grand_total as deal_grand_total,
  pay.paid_thb as deal_paid_thb,
  coalesce(
    act.status = 'expired'
    or (act.status = 'quoted' and act.quote_valid_until is not null
        and act.quote_valid_until < (now() at time zone 'Asia/Bangkok')::date),
    false) as deal_quote_expired,
  ps.state as payment_state,
  (i.status = 'issued' and ps.state = 'unpaid'
   and (act.grand_total is distinct from i.grand_total_snapshot
        or pay.paid_thb is distinct from i.paid_before_thb)) as is_stale,
  -- ใบมัดจำที่ due_date = วันที่ออก = "ชำระก่อนเริ่มงาน" (มติเจ้าของ) ไม่มีกำหนดวันจริง — ไม่นับเลยกำหนด (ไม่งั้นวันถัดไปขึ้นเลยกำหนดทุกใบ)
  (i.status = 'issued' and ps.state = 'unpaid'
   and not (i.kind = 'deposit' and i.due_date = i.issue_date)
   and i.due_date < (now() at time zone 'Asia/Bangkok')::date) as is_overdue,
  rc.id as receipt_id,
  rc.receipt_no as receipt_no,
  rc.received_date as received_date
from analytics.oem_invoice i
join analytics.oem_quote q on q.id = i.quote_id and q.shop_id = i.shop_id
-- ใบเสร็จ issued ที่อ้างใบแจ้งหนี้นี้ (partial unique index การันตี <= 1 แถว) · ใบเสร็จ void ไม่นับ ⇒ unpaid กลับมาเอง
left join lateral (
  select r.id, r.receipt_no, r.received_date
    from analytics.oem_receipt r
   where r.invoice_id = i.id and r.shop_id = i.shop_id and r.status = 'issued'
   order by r.created_at desc
   limit 1
) rc on true
-- ps: จุดเดียวที่ตัดสิน payment_state (0179 เตรียมไว้) — void ชนะทุกอย่าง · มีใบเสร็จ active = paid · ไม่งั้น unpaid
cross join lateral (
  select case when i.status = 'void' then 'void'
              when rc.id is not null then 'paid'
              else 'unpaid' end as state
) ps
left join lateral (
  select a.id, a.quote_no, a.status, a.grand_total, a.quote_valid_until
    from analytics.oem_quote a
   where a.shop_id = i.shop_id
     and coalesce(a.root_quote_id, a.id) = coalesce(q.root_quote_id, q.id)
     and a.status <> 'superseded'
   order by a.created_at desc
   limit 1
) act on true
left join lateral (
  select coalesce(sum(r.amount_thb), 0) as paid_thb
    from analytics.oem_receipt r
    join analytics.oem_quote rq on rq.id = r.quote_id
   where rq.root_quote_id = coalesce(q.root_quote_id, q.id)
     and r.status = 'issued'
) pay on true;

revoke all on analytics.v_oem_invoice from public, anon, authenticated, service_role;
grant select on analytics.v_oem_invoice to service_role;

-- ============================================================================
-- 4. v_oem_receipt — append invoice_id + invoice_no_snapshot ท้ายสุด (30 + quote_no + is_deal_active เดิมเป็น prefix เดิมเป๊ะ)
--    ลอกจาก pg_get_viewdef บน DB (16 ต.ค. 69) · ACL เดิมของ view ไม่ถูกแตะ (create or replace คง grant)
-- ============================================================================
create or replace view analytics.v_oem_receipt with (security_invoker = true) as
 select r.id,
    r.shop_id,
    r.quote_id,
    r.receipt_no,
    r.kind,
    r.status,
    r.amount_thb,
    r.vat_rate,
    r.vat_base_thb,
    r.vat_amount_thb,
    r.received_date,
    r.issue_date,
    r.payment_method,
    r.payment_ref,
    r.description,
    r.seller_snapshot,
    r.buyer_legal_name,
    r.buyer_tax_id,
    r.buyer_branch_label,
    r.buyer_address,
    r.quote_no_snapshot,
    r.grand_total_snapshot,
    r.paid_before_thb,
    r.balance_after_thb,
    r.void_reason,
    r.voided_at,
    r.voided_by,
    r.reissued_from_receipt_id,
    r.created_by,
    r.created_at,
    q.quote_no,
    q.status <> 'superseded'::text as is_deal_active,
    r.invoice_id,
    r.invoice_no_snapshot
   from analytics.oem_receipt r
     join analytics.oem_quote q on q.id = r.quote_id;

-- ============================================================================
-- 5. oem_receipt_issue — 9 args -> 11 args (+ p_invoice_id uuid default null, p_actor_id uuid default null)
--    นิยามสดจาก DB (0088) + แก้เฉพาะจุด: signature · ตัวแปร · actor (L1) · ด่านใบแจ้งหนี้หลังล็อก quote · insert 2 คอลัมน์ · created_by/updated_by = v_actor
--    drop signature เดิมก่อน (traps ข้อ 1) · grant service_role เท่านั้น (0088 เคย grant authenticated — ถูกถอนใน 0147 แล้ว ห้ามเปิดกลับ)
-- ============================================================================
drop function if exists analytics.oem_receipt_issue(uuid, uuid, numeric, date, text, text, text, text, uuid);

CREATE OR REPLACE FUNCTION analytics.oem_receipt_issue(p_shop_id uuid, p_quote_id uuid, p_amount_thb numeric, p_received_date date, p_kind text, p_payment_method text DEFAULT NULL::text, p_payment_ref text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_reissued_from uuid DEFAULT NULL::uuid, p_invoice_id uuid DEFAULT NULL::uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $f$
declare
  v_quote analytics.oem_quote%rowtype;
  v_set analytics.oem_setting%rowtype;
  v_customer analytics.oem_customer%rowtype;
  v_bkk_today date;
  v_bkk_month_start date;
  v_reissued_from_received_date date; -- 0086: วันรับเงินของใบเดิมที่ถูก void (เฉพาะตอน reissue)
  v_reissued_from_amount_thb numeric; -- 0087: ยอดเงินของใบเดิม ต้องเท่ากับ p_amount_thb
  v_reissued_from_kind text; -- 0087: ประเภทรับเงินของใบเดิม ต้องเท่ากับ p_kind
  v_reissued_from_root_quote_id uuid; -- 0087: root deal ของใบเดิม ต้องเท่ากับดีลของใบใหม่
  v_reissued_from_buyer_tax_id text; -- 0088: เลขผู้เสียภาษีผู้ซื้อที่ snapshot ไว้บนใบเดิม ต้องเท่ากับ v_customer.tax_id ปัจจุบัน
  v_paid_before numeric;
  v_vat_base numeric;
  v_vat_amount numeric;
  v_description text;
  v_payment_ref text;
  v_seller_snapshot jsonb;
  v_doc_key text;
  v_no int;
  v_receipt_no text;
  v_receipt_id uuid;
  -- 0180 (I2)
  v_actor uuid;
  v_reissued_from_invoice_id uuid; -- invoice ที่ใบเดิมอ้าง (ล็อกตัวที่ 6: reissue ต้องอ้าง invoice เดียวกัน)
  v_inv analytics.oem_invoice%rowtype;
  v_inv_root uuid;
  v_inv_state record;
begin
  if p_shop_id is null or p_quote_id is null then
    raise exception 'oem_receipt_issue: p_shop_id and p_quote_id are required';
  end if;
  -- range check แทน "<= 0" เดี่ยวๆ — บทเรียน 0083 (NaN > ทุกค่ารวม infinity)
  if p_amount_thb is null or not (p_amount_thb > 0 and p_amount_thb <= 100000000) then
    raise exception 'oem_receipt_issue: p_amount_thb must be a finite number > 0 and <= 100,000,000' using errcode = '22023';
  end if;
  if p_received_date is null then
    raise exception 'oem_receipt_issue: p_received_date is required';
  end if;
  if p_kind is null or p_kind not in ('deposit', 'partial', 'final') then
    raise exception 'oem_receipt_issue: p_kind must be deposit, partial, or final' using errcode = '22023';
  end if;
  if p_payment_method is not null and p_payment_method not in ('transfer', 'cash', 'other') then
    raise exception 'oem_receipt_issue: p_payment_method must be transfer, cash, other, or null' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  -- 0180 L1: ผู้ทำรายการ
  --   ทางเดิม (ไม่ส่ง p_invoice_id และไม่ส่ง p_actor_id) = พฤติกรรม 0088 ทุกประการ: actor = auth.uid() (service_role = null)
  --   ส่ง p_actor_id หรือ p_invoice_id = ต้องมี actor จริงที่เป็นสมาชิกร้าน (owner/admin) — ทางใบแจ้งหนี้ห้ามไม่มี actor
  v_actor := auth.uid();
  if p_actor_id is not null or p_invoice_id is not null then
    v_actor := coalesce(auth.uid(), (select u.id from auth.users u where u.id = p_actor_id));
    if v_actor is null then
      raise exception 'oem_receipt_issue: ต้องระบุผู้ทำรายการ (p_actor_id ที่มีอยู่จริง จาก session ฝั่ง server)' using errcode = '22023', hint = 'actor_required';
    end if;
    perform analytics.oem_require_actor_member(p_shop_id, v_actor);
  end if;

  -- ยืนยันว่า p_reissued_from ต้องชี้ไปใบที่ถูก void ไปแล้วในร้านนี้เท่านั้น และยังไม่
  -- เคยถูก reissue ซ้ำมาก่อน — 0086: ดึง received_date · 0087: ดึง amount/kind/root
  -- 0088: เพิ่ม r.buyer_tax_id ของใบเดิม ใช้เทียบที่ gate ใหม่หลัง select v_customer
  -- — ล็อกตัวผู้ซื้อของ reissue เข้ากับ snapshot บนใบเดิม กัน oem_quote_set_billing
  -- แก้ผู้ซื้อทับก่อน reissue
  if p_reissued_from is not null then
    select r.received_date, r.amount_thb, r.kind, coalesce(oq.root_quote_id, oq.id), r.buyer_tax_id, r.invoice_id
      into v_reissued_from_received_date, v_reissued_from_amount_thb, v_reissued_from_kind, v_reissued_from_root_quote_id, v_reissued_from_buyer_tax_id, v_reissued_from_invoice_id
      from analytics.oem_receipt r
      join analytics.oem_quote oq on oq.id = r.quote_id and oq.shop_id = r.shop_id
     where r.id = p_reissued_from and r.shop_id = p_shop_id and r.status = 'void';
    if not found then
      raise exception 'oem_receipt_issue: p_reissued_from ต้องชี้ไปใบเสร็จที่ถูกยกเลิก (void) แล้วในร้านนี้เท่านั้น' using errcode = '22023';
    end if;
    if exists (
      select 1 from analytics.oem_receipt
       where reissued_from_receipt_id = p_reissued_from and status = 'issued'
    ) then
      raise exception 'oem_receipt_issue: ใบเสร็จ % ถูก reissue ไปแล้ว ออกซ้ำอีกใบไม่ได้', p_reissued_from using errcode = '22023';
    end if;
  end if;

  -- timezone ไทย เสมอ — DB เป็น UTC ก่อน 07:00 ไทยจะเหลื่อมวัน
  v_bkk_today := (now() at time zone 'Asia/Bangkok')::date;
  v_bkk_month_start := date_trunc('month', v_bkk_today)::date;

  -- for update: กันสอง request ออกใบพร้อมกันแล้วอ่านสถานะ/paid เก่าทั้งคู่
  select * into v_quote
    from analytics.oem_quote
   where id = p_quote_id and shop_id = p_shop_id
   for update;
  if not found then
    raise exception 'oem_receipt_issue: quote % not found for this shop', p_quote_id;
  end if;

  -- 0087 §1: reissue ต้องผูกกับใบเดิมครบ 4 อย่าง (วันที่ + ยอดเงิน/kind/ดีล)
  -- ด่าน "ดีลเดียวกัน" ต้องอยู่ตรงนี้ (หลัง select v_quote for update) เพราะต้องใช้
  -- v_quote.root_quote_id ซึ่งยังไม่ถูกโหลด ณ จุดตรวจ p_reissued_from ด้านบน
  if p_reissued_from is not null then
    if p_amount_thb is distinct from v_reissued_from_amount_thb then
      raise exception 'oem_receipt_issue: reissue ต้องใช้ยอดเงินเดียวกับใบเดิมที่ถูกยกเลิกเท่านั้น (ใบเดิม % ยอด % บาท ใบใหม่ที่ขอออก % บาท) — ถ้ายอดเปลี่ยนไม่ใช่ reissue ของใบเดิมแล้ว ให้ออกใบใหม่ตามปกติโดยไม่ระบุ p_reissued_from',
        p_reissued_from, round(v_reissued_from_amount_thb, 2), round(p_amount_thb, 2)
        using errcode = '22023';
    end if;
    if p_kind is distinct from v_reissued_from_kind then
      raise exception 'oem_receipt_issue: reissue ต้องใช้ประเภทการรับเงิน (kind) เดียวกับใบเดิมที่ถูกยกเลิกเท่านั้น (ใบเดิม % เป็น "%" ใบใหม่ที่ขอออกเป็น "%")',
        p_reissued_from, v_reissued_from_kind, p_kind
        using errcode = '22023';
    end if;
    if coalesce(v_quote.root_quote_id, v_quote.id) is distinct from v_reissued_from_root_quote_id then
      raise exception 'oem_receipt_issue: reissue ต้องออกให้ดีลเดียวกับใบเดิมที่ถูกยกเลิกเท่านั้น — ใบเสนอราคา (p_quote_id) ที่ส่งมาอยู่คนละดีลกับใบเดิม % ห้ามใช้ reissue เป็นช่องทางออกใบให้ดีลอื่น',
        p_reissued_from
        using errcode = '22023';
    end if;
  end if;

  -- §4: ออกใบเสร็จได้เฉพาะใบสถานะ quoted/expired/won
  if v_quote.status not in ('quoted', 'expired', 'won') then
    raise exception 'oem_receipt_issue: ออกใบเสร็จได้เฉพาะใบสถานะ quoted, expired หรือ won เท่านั้น (ใบนี้สถานะ %) — ถ้าใบนี้ถูกต่อราคาไปแล้ว ให้ใช้ quote_id ของใบล่าสุดในดีลนี้แทน', v_quote.status
      using errcode = '22023';
  end if;
  if v_quote.grand_total is null then
    raise exception 'oem_receipt_issue: ใบเสนอราคานี้ยังไม่มียอดรวม (grand_total) — ข้อมูลผิดปกติ ติดต่อทีมพัฒนา';
  end if;

  -- 0180 (I2) ผูกใบเสร็จกับใบแจ้งหนี้ — ทุกด่านอยู่หลังล็อกแถว quote (for update ข้างบน) และก่อนออกเลขที่ (ล้ม = ไม่เผาเลข RT)
  -- ล็อกตัวที่ 6 ต่อจาก 5 ตัวของ 0087/0088: reissue ต้องอ้าง invoice เดียวกับใบเดิมเป๊ะ (ใบเดิมไม่เคยอ้าง = ใบใหม่ก็ต้องไม่อ้าง)
  if p_reissued_from is not null and v_reissued_from_invoice_id is distinct from p_invoice_id then
    raise exception 'oem_receipt_issue: reissue ต้องอ้างใบแจ้งหนี้ใบเดียวกับใบเดิมที่ถูกยกเลิก (ใบเดิมอ้าง % ใบใหม่ที่ขอออกอ้าง %) — ใบเดิมไม่เคยอ้างใบแจ้งหนี้ ใบใหม่ก็ต้องไม่อ้าง',
      coalesce(v_reissued_from_invoice_id::text, '(ไม่อ้าง)'), coalesce(p_invoice_id::text, '(ไม่อ้าง)')
      using errcode = '22023', hint = 'reissue_invoice_mismatch';
  end if;
  if p_invoice_id is not null then
    -- ล็อกแถวใบแจ้งหนี้ด้วย: serialize กับ oem_invoice_void (ล็อกแถวเดียวกัน แล้วอ่าน payment_state จาก view หลังได้ล็อก)
    select * into v_inv from analytics.oem_invoice where id = p_invoice_id and shop_id = p_shop_id for update;
    if not found then
      raise exception 'oem_receipt_issue: ไม่พบใบแจ้งหนี้ % ในร้านนี้', p_invoice_id using errcode = '22023', hint = 'invoice_not_found';
    end if;
    if v_inv.status <> 'issued' then
      raise exception 'oem_receipt_issue: อ้างใบแจ้งหนี้ได้เฉพาะใบสถานะ issued (% สถานะ %)', v_inv.invoice_no, v_inv.status using errcode = '22023', hint = 'invoice_not_issued';
    end if;
    select coalesce(iq.root_quote_id, iq.id) into v_inv_root
      from analytics.oem_quote iq where iq.id = v_inv.quote_id and iq.shop_id = p_shop_id;
    if v_inv_root is distinct from coalesce(v_quote.root_quote_id, v_quote.id) then
      raise exception 'oem_receipt_issue: ใบแจ้งหนี้ % อยู่คนละดีลกับใบเสนอราคาที่รับเงิน', v_inv.invoice_no using errcode = '22023', hint = 'invoice_deal_mismatch';
    end if;
    -- สถานะอ่านจาก v_oem_invoice ที่เดียว (นิยาม paid/stale มีที่เดียว): paid (มีใบเสร็จ issued อ้างอยู่แล้ว) หรืออ่านไม่ได้ = ปฏิเสธ
    select vi.payment_state, vi.is_stale into v_inv_state
      from analytics.v_oem_invoice vi where vi.id = p_invoice_id and vi.shop_id = p_shop_id;
    if not found or v_inv_state.payment_state is distinct from 'unpaid' then
      raise exception 'oem_receipt_issue: ใบแจ้งหนี้ % ถูกชำระแล้ว (มีใบเสร็จอ้างอยู่) — ยกเลิกใบเสร็จเดิมก่อนถ้าต้องการออกใหม่', v_inv.invoice_no using errcode = '22023', hint = 'invoice_paid';
    end if;
    -- stale (ยอดรวมของดีลหรือยอดรับสะสมเปลี่ยนหลังออกใบแจ้งหนี้) = ยอดบนกระดาษไม่ตรงความจริงแล้ว · null = ตก ไม่ใช่ผ่าน
    if coalesce(v_inv_state.is_stale, true) then
      raise exception 'oem_receipt_issue: ใบแจ้งหนี้ % ยอดเปลี่ยนแล้ว (stale) — ยกเลิกแล้วออกใบแจ้งหนี้ใหม่ก่อนรับเงิน', v_inv.invoice_no using errcode = '22023', hint = 'invoice_stale';
    end if;
    -- ยอดรับ = ยอดใบแจ้งหนี้ เป๊ะ (เทียบค่าที่ client ส่งมาโดยไม่ปัดเศษ — 100.004 ไม่ผ่านเป็น 100.00)
    if p_amount_thb is distinct from v_inv.amount_thb then
      raise exception 'oem_receipt_issue: ยอดรับ % บาท ไม่เท่ายอดใบแจ้งหนี้ % (% บาท) — โอนไม่ตรงยอดให้บันทึกรับเงินโดยไม่อ้างใบแจ้งหนี้ แล้วยกเลิกใบแจ้งหนี้',
        p_amount_thb, v_inv.invoice_no, v_inv.amount_thb using errcode = '22023', hint = 'invoice_amount_mismatch';
    end if;
    -- kind ใบเสร็จ map จากชนิดใบแจ้งหนี้: deposit -> deposit · balance -> final (partial ไม่ผูกใบแจ้งหนี้)
    if p_kind is distinct from (case v_inv.kind when 'deposit' then 'deposit' when 'balance' then 'final' end) then
      raise exception 'oem_receipt_issue: ใบแจ้งหนี้ % ชนิด % ต้องออกใบเสร็จชนิด % (ส่งมา %)', v_inv.invoice_no, v_inv.kind,
        (case v_inv.kind when 'deposit' then 'deposit' else 'final' end), p_kind using errcode = '22023', hint = 'invoice_kind_mismatch';
    end if;
  end if;

  -- §9: gate ข้อมูลผู้ขาย
  select * into v_set from analytics.oem_setting where shop_id = p_shop_id;
  if v_set.shop_id is null or not coalesce(v_set.seller_vat_registered, false) then
    raise exception 'oem_receipt_issue: ร้านยังไม่ได้ติ๊กสถานะจดทะเบียน VAT (ตั้งค่า > ข้อมูลร้าน) ออกใบเสร็จ/ใบกำกับภาษีไม่ได้จนกว่าจะติ๊กสถานะนี้ก่อน' using errcode = '22023';
  end if;
  if nullif(btrim(v_set.seller_legal_name), '') is null then
    raise exception 'oem_receipt_issue: ยังไม่ได้กรอกชื่อนิติบุคคลของร้าน (ตั้งค่า > ข้อมูลร้าน) — เอกสารภาษีต้องมีชื่อผู้ขายก่อนออกใบ' using errcode = '22023';
  end if;
  if nullif(btrim(v_set.seller_tax_id), '') is null then
    raise exception 'oem_receipt_issue: ยังไม่ได้กรอกเลขผู้เสียภาษีของร้าน (ตั้งค่า > ข้อมูลร้าน) — เอกสารภาษีต้องมีเลขผู้เสียภาษีของผู้ขายก่อนออกใบ' using errcode = '22023';
  end if;
  if v_set.seller_address_lines is null or jsonb_array_length(v_set.seller_address_lines) = 0 then
    raise exception 'oem_receipt_issue: ยังไม่ได้กรอกที่อยู่ของร้าน (ตั้งค่า > ข้อมูลร้าน) — เอกสารภาษีต้องมีที่อยู่ผู้ขายก่อนออกใบ' using errcode = '22023';
  end if;

  -- §9: gate ข้อมูลผู้ซื้อ
  if v_quote.customer_id is null then
    raise exception 'oem_receipt_issue: ใบนี้ยังไม่ได้ผูกข้อมูลผู้ซื้อ (ชื่อออกบิล/ที่อยู่) — ตั้งค่าก่อนออกใบเสร็จ' using errcode = '22023';
  end if;
  select * into v_customer from analytics.oem_customer where id = v_quote.customer_id and shop_id = p_shop_id;
  if not found or nullif(btrim(v_customer.legal_name), '') is null then
    raise exception 'oem_receipt_issue: ข้อมูลผู้ซื้อของใบนี้ยังไม่มีชื่อนิติบุคคล/ชื่อผู้ซื้อ — ตั้งค่าก่อนออกใบเสร็จ' using errcode = '22023';
  end if;

  -- 0088 §2: reissue ต้องเป็นผู้ซื้อรายเดิม (เทียบเลขผู้เสียภาษี) เท่านั้น —
  -- oem_quote_set_billing UPDATE แถว oem_customer เดิมทับตรงๆ ไม่ได้สร้างแถวใหม่
  -- แปลว่าระหว่างช่วง void ใบเดิม -> reissue ใบใหม่ เจ้าของ/แอดมินสามารถแก้ผู้ซื้อ
  -- ของดีลนี้เป็นคนละรายได้ผ่าน server action ปกติ ถ้าไม่ล็อกจุดนี้ reissue จะกลาย
  -- เป็นทางเดียวที่เหลือให้ออกใบกำกับภาษีย้อนงวดภาษีในชื่อใครก็ได้ (ด่านยอด/kind/
  -- ดีล/วันที่ของ 0087 ผ่านหมดเพราะเป็นดีลเดียวกันจริง)
  -- เทียบกับ snapshot buyer_tax_id บนใบเดิม ไม่ใช่ customer_id เพราะ customer_id
  -- เป็นแถวเดียวกันตลอดในเคสนี้ (ช่องโหว่คือเนื้อในแถวถูกแก้ทับ ไม่ใช่ FK เปลี่ยน)
  -- ล็อกเฉพาะ tax_id ตัวเดียว ไม่ล็อกทั้งก้อน — แก้ชื่อ/ที่อยู่/สาขาที่พิมพ์ผิดยัง
  -- ทำได้ผ่าน reissue เหมือนเดิม และ null -> null ผ่าน (บุคคลธรรมดา)
  if p_reissued_from is not null then
    if nullif(btrim(v_customer.tax_id), '') is distinct from nullif(btrim(v_reissued_from_buyer_tax_id), '') then
      raise exception 'oem_receipt_issue: reissue ต้องออกให้ผู้ซื้อรายเดิมเท่านั้น (ใบเดิม % ผูกผู้ซื้อเลขผู้เสียภาษี "%" แต่ข้อมูลผู้ซื้อปัจจุบันของดีลนี้เป็นเลขผู้เสียภาษี "%") — ถ้าผู้ซื้อเปลี่ยนจริง ต้องออกใบใหม่ตามปกติโดยไม่ระบุ p_reissued_from ไม่ใช่ reissue ใบเดิม',
        p_reissued_from, coalesce(v_reissued_from_buyer_tax_id, '(บุคคลธรรมดา/ไม่มีเลขผู้เสียภาษี)'), coalesce(v_customer.tax_id, '(บุคคลธรรมดา/ไม่มีเลขผู้เสียภาษี)')
        using errcode = '22023';
    end if;
  end if;

  -- 0086 §1(ค): ผู้ซื้อมี tax_id (= นิติบุคคล = ใบกำกับภาษีเต็มรูปตาม ป.รัษฎากร
  -- ม.86/4) ต้องมีที่อยู่และสาขาครบก่อนออกใบได้
  if nullif(btrim(v_customer.tax_id), '') is not null then
    if v_customer.address is null
       or jsonb_typeof(v_customer.address) <> 'object'
       or nullif(btrim(v_customer.address->>'line1'), '') is null
       or nullif(btrim(v_customer.address->>'subdistrict'), '') is null
       or nullif(btrim(v_customer.address->>'district'), '') is null
       or nullif(btrim(v_customer.address->>'province'), '') is null
       or nullif(btrim(v_customer.address->>'postalCode'), '') is null
    then
      raise exception 'oem_receipt_issue: ผู้ซื้อมีเลขผู้เสียภาษี (นิติบุคคล) ต้องกรอกที่อยู่ให้ครบก่อนออกใบกำกับภาษีเต็มรูป (บรรทัด 1, ตำบล/แขวง, อำเภอ/เขต, จังหวัด, รหัสไปรษณีย์) — ไปที่ปุ่ม "ผูกข้อมูลผู้ซื้อ" ของใบเสนอราคานี้แล้วกรอกที่อยู่ให้ครบ' using errcode = '22023';
    end if;
    if nullif(btrim(v_customer.branch_label), '') is null then
      raise exception 'oem_receipt_issue: ผู้ซื้อมีเลขผู้เสียภาษี (นิติบุคคล) ต้องกรอกสาขา (สำนักงานใหญ่ หรือ สาขาที่ ...) ก่อนออกใบกำกับภาษีเต็มรูป — ไปที่ปุ่ม "ผูกข้อมูลผู้ซื้อ" ของใบเสนอราคานี้แล้วกรอกสาขาให้ครบ' using errcode = '22023';
    end if;
  end if;

  -- §6: paid ระดับ deal — sum ทุกใบเสร็จ issued ใน chain เดียวกันผ่าน root_quote_id
  select coalesce(sum(r.amount_thb), 0) into v_paid_before
    from analytics.oem_receipt r
    join analytics.oem_quote rq on rq.id = r.quote_id
   where rq.root_quote_id = coalesce(v_quote.root_quote_id, v_quote.id)
     and r.status = 'issued';

  -- §6: กันจ่ายเกิน
  if round(v_paid_before + p_amount_thb, 2) > round(v_quote.grand_total, 2) then
    raise exception 'oem_receipt_issue: ยอดรับเงินรวม % บาท (สะสมแล้ว % + ครั้งนี้ %) เกินยอดรวมใบเสนอราคาทั้งดีล (% บาท) — รับเงินเกินยอดไม่ได้',
      round(v_paid_before + p_amount_thb, 2), round(v_paid_before, 2), round(p_amount_thb, 2), round(v_quote.grand_total, 2)
      using errcode = '22023';
  end if;

  if p_received_date > v_bkk_today then
    raise exception 'oem_receipt_issue: วันที่รับเงิน (%) เป็นวันในอนาคตไม่ได้ (วันนี้ตามเวลาไทยคือ %)', p_received_date, v_bkk_today
      using errcode = '22023';
  end if;

  -- 0086 §3: เปิดข้อยกเว้นเฉพาะ reissue ที่ received_date ตรงกับใบเดิมเป๊ะเท่านั้น
  -- 0087: "เป็น reissue" ถูกผูกเพิ่มกับยอดเงิน/kind/ดีลของใบเดิมแล้ว
  -- 0088: และตอนนี้ยังถูกผูกเพิ่มกับตัวผู้ซื้อ (tax_id) ของใบเดิมด้วย (gate ด้านบน)
  -- ปิดช่องทางลัดย้อนงวดภาษีในชื่อผู้ซื้อรายอื่นที่เหลืออยู่
  if p_reissued_from is not null then
    if p_received_date is distinct from v_reissued_from_received_date then
      raise exception 'oem_receipt_issue: reissue ต้องใช้วันที่รับเงินเดียวกับใบเดิมที่ถูกยกเลิกเท่านั้น (ใบเดิม % รับเงินวันที่ %) — วันที่รับเงินคือ tax point จริง เปลี่ยนวันที่ตอน reissue ไม่ได้', p_reissued_from, v_reissued_from_received_date
        using errcode = '22023';
    end if;
    -- received_date ตรงกับใบเดิมแล้ว = ไม่ใช่การย้อนงวดภาษีใหม่ ข้ามด่านงวดภาษีปกติ
  elsif p_received_date < v_bkk_month_start then
    raise exception 'oem_receipt_issue: วันที่รับเงิน (%) อยู่คนละงวดภาษีกับวันนี้ (เอกสารนี้จะออกในงวดเดือน %) — ออกย้อนหลังข้ามเดือนไม่ได้ ถ้าจำเป็นต้องบันทึกรับเงินของเดือนก่อน ให้ปรึกษาฝ่ายบัญชีก่อนดำเนินการ',
      p_received_date, to_char(v_bkk_today, 'YYYY-MM')
      using errcode = '22023';
  end if;

  -- ---- ผ่านทุกด่านแล้ว — คำนวณ + snapshot ----
  v_vat_base := round(p_amount_thb / (1 + v_quote.vat_rate), 2);
  v_vat_amount := p_amount_thb - v_vat_base;

  v_description := left(nullif(btrim(p_description), ''), 500);
  if v_description is null then
    v_description := case p_kind
      when 'deposit' then 'เงินมัดจำงาน OEM ตามใบเสนอราคา ' || v_quote.quote_no
      when 'partial' then 'ชำระเงินบางส่วนงาน OEM ตามใบเสนอราคา ' || v_quote.quote_no
      when 'final' then 'ชำระเงินงวดสุดท้ายงาน OEM ตามใบเสนอราคา ' || v_quote.quote_no
    end;
  end if;
  v_payment_ref := left(nullif(btrim(p_payment_ref), ''), 128);

  v_seller_snapshot := jsonb_build_object(
    'legal_name', v_set.seller_legal_name,
    'display_name', v_set.seller_display_name,
    'branch_label', v_set.seller_branch_label,
    'address_lines', v_set.seller_address_lines,
    'tax_id', v_set.seller_tax_id,
    'phone', v_set.seller_phone
  );

  -- §3: ออกเลขที่เอกสาร — counter row lock ภายใน transaction เดียวกับ insert
  -- 0088: ON CONFLICT DO UPDATE นี้ยิงเป็น UPDATE ที่ new.last_no = old.last_no + 1
  -- พอดี ผ่าน trg_oem_doc_counter_deny_mutation (§1) เสมอ ไม่ต้องแก้บรรทัดนี้
  v_doc_key := 'RT-' || to_char(v_bkk_today, 'YYMM');
  insert into analytics.oem_doc_counter as c (shop_id, doc_key, last_no)
  values (p_shop_id, v_doc_key, 1)
  on conflict (shop_id, doc_key) do update set last_no = c.last_no + 1
  returning last_no into v_no;
  v_receipt_no := v_doc_key || '-' || lpad(v_no::text, 3, '0');

  v_receipt_id := gen_random_uuid();
  insert into analytics.oem_receipt (
    id, shop_id, quote_id, receipt_no, kind, status,
    amount_thb, vat_rate, vat_base_thb, vat_amount_thb,
    received_date, issue_date, payment_method, payment_ref, description,
    seller_snapshot, buyer_legal_name, buyer_tax_id, buyer_branch_label, buyer_address,
    quote_no_snapshot, grand_total_snapshot, paid_before_thb, balance_after_thb,
    reissued_from_receipt_id, created_by, invoice_id, invoice_no_snapshot
  ) values (
    v_receipt_id, p_shop_id, p_quote_id, v_receipt_no, p_kind, 'issued',
    p_amount_thb, v_quote.vat_rate, v_vat_base, v_vat_amount,
    p_received_date, v_bkk_today, p_payment_method, v_payment_ref, v_description,
    v_seller_snapshot, v_customer.legal_name, v_customer.tax_id, v_customer.branch_label, v_customer.address,
    v_quote.quote_no, v_quote.grand_total, v_paid_before, (v_quote.grand_total - (v_paid_before + p_amount_thb)),
    p_reissued_from, v_actor, p_invoice_id, v_inv.invoice_no
  );

  -- คำสั่งเจ้าของข้อ 2: รับมัดจำ = รับงาน — ใบยังไม่ won ก็พลิกเป็น won ทันที
  if v_quote.status <> 'won' then
    update analytics.oem_quote
       set status = 'won', updated_by = v_actor, updated_at = now()
     where id = p_quote_id and shop_id = p_shop_id;
  end if;

  return v_receipt_id;
end;
$f$;

revoke execute on function analytics.oem_receipt_issue(uuid, uuid, numeric, date, text, text, text, text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.oem_receipt_issue(uuid, uuid, numeric, date, text, text, text, text, uuid, uuid, uuid) to service_role;

-- ============================================================================
-- 6. L1 — เติม perform oem_require_actor_member ใน 3 ฟังก์ชันของ 0179 (นิยามสดจาก DB + เพิ่ม 1 บรรทัดหลังด่าน actor_required)
--    create or replace signature เดิม (ไม่เกิด overload) — re-grant ครบ (traps ข้อ 2)
-- ============================================================================
CREATE OR REPLACE FUNCTION analytics.oem_invoice_issue(p_shop_id uuid, p_quote_id uuid, p_kind text, p_due_date date DEFAULT NULL::date, p_note text DEFAULT NULL::text, p_replaces_invoice_id uuid DEFAULT NULL::uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $f$
declare
  v_actor        uuid;
  v_addr_missing boolean;
  v_today        date;
  v_due          date;
  v_note         text;
  v_quote        analytics.oem_quote%rowtype;
  v_qv           record;
  v_set          analytics.oem_setting%rowtype;
  v_customer     analytics.oem_customer%rowtype;
  v_root         uuid;
  v_active_no    text;
  v_amount       numeric;
  v_paid_before  numeric;
  v_balance_after numeric;
  v_vat_mode     text;
  v_vat_display  text;
  v_vat_rate     numeric;
  v_vat_base     numeric;
  v_vat_amount   numeric;
  v_description  text;
  v_lines        jsonb;
  v_seller       jsonb;
  v_items_n      int;
  v_items_bad    int;
  v_items_total  numeric;
  v_open         record;
  v_rep          record;
  v_doc_key      text;
  v_no           int;
  v_invoice_no   text;
  v_id           uuid;
begin
  -- ---- 1. validate args ----
  if p_shop_id is null or p_quote_id is null then
    raise exception 'oem_invoice_issue: p_shop_id และ p_quote_id จำเป็น' using errcode = '22023', hint = 'args_required';
  end if;
  if p_kind is null or p_kind not in ('deposit', 'balance') then
    raise exception 'oem_invoice_issue: p_kind ต้องเป็น deposit หรือ balance' using errcode = '22023', hint = 'kind_invalid';
  end if;
  -- note: ว่างจริง/เว้นวรรคล้วน = ไม่มีหมายเหตุ · นอกนั้นต้องผ่าน whitelist (อักขระล่องหน/วรรคตอนล้วน = ปฏิเสธ ไม่ใช่เงียบ)
  if p_note is not null and btrim(p_note) <> '' then
    if not (analytics.oem_note_valid(p_note) and analytics.oem_note_present(p_note)) then
      raise exception 'oem_invoice_issue: หมายเหตุต้องมีตัวอักษร/ตัวเลขจริง ยาวไม่เกิน 500 ตัวอักษร และห้ามมีอักขระควบคุม/ล่องหน' using errcode = '22023', hint = 'note_invalid';
    end if;
    v_note := btrim(p_note);
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);
  v_actor := coalesce(auth.uid(), (select u.id from auth.users u where u.id = p_actor_id));
  if v_actor is null then
    raise exception 'oem_invoice_issue: ต้องระบุผู้ทำรายการ (p_actor_id จาก session ฝั่ง server)' using errcode = '22023', hint = 'actor_required';
  end if;
  -- 0180 L1: actor ต้องเป็นสมาชิกร้าน (owner/admin) จริง — service_role ผ่าน crm_require_owner_admin โดยไม่ตรวจสมาชิก
  perform analytics.oem_require_actor_member(p_shop_id, v_actor);

  -- วันทางธุรกิจ = เวลาไทย (DB เป็น UTC — 00:00-07:00 ไทยจะเหลื่อมวัน)
  v_today := (now() at time zone 'Asia/Bangkok')::date;
  if p_due_date is null then
    -- มติเจ้าของ 16 ต.ค. 69: มัดจำ = ชำระก่อนเริ่มงาน (วันที่ออก) · คงเหลือ = 7 วันหลังส่งมอบ (ออกตอนส่งมอบ)
    v_due := case p_kind when 'deposit' then v_today else v_today + 7 end;
  elsif not (p_due_date >= v_today and p_due_date <= v_today + 365) then
    raise exception 'oem_invoice_issue: วันกำหนดชำระ (%) ต้องไม่ย้อนหลัง (วันนี้ตามเวลาไทย %) และไม่เกิน 365 วันนับจากวันนี้', p_due_date, v_today
      using errcode = '22023', hint = 'due_invalid';
  else
    v_due := p_due_date;
  end if;

  -- ---- 2. ล็อกแถว quote (ตัวเดียวกับ oem_receipt_issue) ----
  select * into v_quote
    from analytics.oem_quote
   where id = p_quote_id and shop_id = p_shop_id
   for update;
  if not found then
    raise exception 'oem_invoice_issue: ไม่พบใบเสนอราคา % ในร้านนี้', p_quote_id using errcode = '22023', hint = 'quote_not_found';
  end if;
  v_root := coalesce(v_quote.root_quote_id, v_quote.id);

  -- ---- 3. gate สถานะ: quoted / expired / won เท่านั้น (ไม่พลิกสถานะ quote) ----
  if v_quote.status = 'superseded' then
    select a.quote_no into v_active_no
      from analytics.oem_quote a
     where a.shop_id = p_shop_id and coalesce(a.root_quote_id, a.id) = v_root and a.status <> 'superseded'
     order by a.created_at desc limit 1;
    raise exception 'oem_invoice_issue: ใบนี้ถูกต่อราคาไปแล้ว (superseded) — ออกใบแจ้งหนี้ที่ใบล่าสุดของดีล (%)', coalesce(v_active_no, 'ไม่พบ')
      using errcode = '22023', hint = 'quote_superseded';
  elsif v_quote.status not in ('quoted', 'expired', 'won') then
    raise exception 'oem_invoice_issue: ออกใบแจ้งหนี้ได้เฉพาะใบสถานะ quoted, expired หรือ won (ใบนี้สถานะ %)', v_quote.status
      using errcode = '22023', hint = 'quote_status_invalid';
  end if;
  if v_quote.grand_total is null
     or not (v_quote.grand_total > 0 and v_quote.grand_total <= 100000000)
     or round(v_quote.grand_total, 2) <> v_quote.grand_total then
    raise exception 'oem_invoice_issue: ยอดรวมใบเสนอราคาไม่ถูกต้อง (ต้องเป็นเงิน > 0 ทศนิยมไม่เกิน 2 ตำแหน่ง) — ติดต่อทีมพัฒนา'
      using errcode = '22023', hint = 'grand_total_invalid';
  end if;

  -- ---- 4. gate ผู้ขาย (ใบแจ้งหนี้ไม่ใช่เอกสารภาษี: ไม่บังคับเลขผู้เสียภาษี/VAT registered) ----
  select * into v_set from analytics.oem_setting where shop_id = p_shop_id;
  if not found then
    raise exception 'oem_invoice_issue: ยังไม่มีข้อมูลร้าน (ตั้งค่า > ข้อมูลร้าน)' using errcode = '22023', hint = 'seller_incomplete';
  end if;
  if not coalesce(analytics.oem_note_present(v_set.seller_legal_name), false) then
    raise exception 'oem_invoice_issue: ยังไม่ได้กรอกชื่อผู้ขาย (ตั้งค่า > ข้อมูลร้าน)' using errcode = '22023', hint = 'seller_incomplete';
  end if;
  -- CASE กันลำดับประเมิน: jsonb_array_elements_text พังถ้าไม่ใช่ array · ใส่ตัวแปรก่อน (then ใน CASE ชนกับ then ของ IF ใน plpgsql)
  v_addr_missing := case when jsonb_typeof(v_set.seller_address_lines) = 'array'
          then not exists (select 1 from jsonb_array_elements_text(v_set.seller_address_lines) e(t) where analytics.oem_note_present(e.t))
          else true end;
  if v_addr_missing then
    raise exception 'oem_invoice_issue: ยังไม่ได้กรอกที่อยู่ผู้ขาย (ตั้งค่า > ข้อมูลร้าน)' using errcode = '22023', hint = 'seller_incomplete';
  end if;
  if cardinality(v_set.seller_payment_lines) = 0 then
    raise exception 'oem_invoice_issue: ยังไม่ได้ตั้งช่องทางชำระเงิน (ตั้งค่า > ข้อมูลร้าน) — ออกใบแจ้งหนี้ไม่ได้จนกว่าเจ้าของจะกรอก' using errcode = '22023', hint = 'payment_lines_empty';
  end if;
  if cardinality(v_set.seller_payment_lines) > 6
     or exists (
       select 1 from unnest(v_set.seller_payment_lines) pl(t)
        where pl.t is null
           or not (analytics.oem_note_valid(pl.t) and analytics.oem_note_present(pl.t) and char_length(pl.t) <= 200
                   and position(chr(10) in pl.t) = 0 and position(chr(13) in pl.t) = 0)
     ) then
    raise exception 'oem_invoice_issue: ช่องทางชำระเงินของร้านมีบรรทัดที่ไม่ผ่านเงื่อนไข (มีตัวอักษรจริง <= 200 ตัว ไม่เกิน 6 บรรทัด) — แก้ที่ตั้งค่า > ข้อมูลร้าน' using errcode = '22023', hint = 'payment_lines_invalid';
  end if;

  -- ---- 5. gate ผู้ซื้อ (ต้องผูกแล้ว + มีชื่อ · tax_id/ที่อยู่/สาขาไม่บังคับ) ----
  if v_quote.customer_id is null then
    raise exception 'oem_invoice_issue: ใบนี้ยังไม่ได้ผูกข้อมูลผู้ซื้อ (ชื่อออกบิล) — ตั้งค่าก่อนออกใบแจ้งหนี้' using errcode = '22023', hint = 'buyer_incomplete';
  end if;
  select * into v_customer from analytics.oem_customer where id = v_quote.customer_id and shop_id = p_shop_id;
  if not found or not coalesce(analytics.oem_note_present(v_customer.legal_name), false) then
    raise exception 'oem_invoice_issue: ข้อมูลผู้ซื้อของใบนี้ยังไม่มีชื่อ — ตั้งค่าก่อนออกใบแจ้งหนี้' using errcode = '22023', hint = 'buyer_incomplete';
  end if;

  -- ---- 6. ยอด: อ่านจาก v_oem_quote ชั้นเดียว (สูตรอยู่ 0081/0084 — ไม่คำนวณซ้ำ) ----
  select v.deposit_mode, v.deposit_amount_thb, v.deposit_pct_effective, v.paid_thb, v.outstanding_thb,
         v.grand_total, v.vat_mode, v.vat_rate, v.quote_no, v.pieces_subtotal, v.nre_price, v.discount_thb
    into v_qv
    from analytics.v_oem_quote v
   where v.id = p_quote_id and v.shop_id = p_shop_id;
  if not found then
    raise exception 'oem_invoice_issue: อ่านยอดใบเสนอราคาไม่ได้ — ติดต่อทีมพัฒนา' using errcode = '22023', hint = 'quote_not_found';
  end if;

  v_paid_before := v_qv.paid_thb;
  if v_paid_before is null
     or not (v_paid_before >= 0 and v_paid_before <= 100000000)
     or round(v_paid_before, 2) <> v_paid_before then
    raise exception 'oem_invoice_issue: ยอดรับเงินสะสมของดีลไม่ถูกต้อง — ติดต่อทีมพัฒนา' using errcode = '22023', hint = 'paid_invalid';
  end if;

  if p_kind = 'deposit' then
    if v_qv.deposit_mode is null then
      raise exception 'oem_invoice_issue: ใบนี้ยังไม่ได้ตั้งเงื่อนไขมัดจำ — ตั้งมัดจำก่อน หรือออกใบแจ้งหนี้ยอดคงเหลือ (เต็มจำนวน) แทน' using errcode = '22023', hint = 'deposit_mode_missing';
    end if;
    if v_paid_before <> 0 then
      raise exception 'oem_invoice_issue: ดีลนี้รับเงินแล้ว % บาท — ออกใบแจ้งหนี้มัดจำไม่ได้ (ใช้ใบแจ้งหนี้ยอดคงเหลือ)', v_paid_before
        using errcode = '22023', hint = 'deposit_already_paid';
    end if;
    if v_qv.deposit_amount_thb is null
       or not (v_qv.deposit_amount_thb > 0 and v_qv.deposit_amount_thb <= v_qv.grand_total)
       or round(v_qv.deposit_amount_thb, 2) <> v_qv.deposit_amount_thb then
      raise exception 'oem_invoice_issue: ยอดมัดจำไม่ถูกต้อง (ต้อง > 0 ไม่เกินยอดรวม ทศนิยมไม่เกิน 2 ตำแหน่ง) — แก้เงื่อนไขมัดจำของใบก่อน' using errcode = '22023', hint = 'amount_invalid';
    end if;
    v_amount := v_qv.deposit_amount_thb;
  else
    -- 0084 §6: มัดจำแบบ thb แล้วราคาลดทีหลัง ทำให้คงเหลือติดลบได้ — DB ไม่ซ่อนปัญหา และไม่ออกใบแจ้งหนี้บนยอดที่บวกไม่ลง
    if v_qv.outstanding_thb < 0 then
      raise exception 'oem_invoice_issue: ยอดบวกไม่ลง (รับเงินเกินยอดรวมของใบ) — ตรวจมัดจำ/ยอดรับเงินก่อน' using errcode = '22023', hint = 'amount_negative';
    end if;
    if v_qv.outstanding_thb is null
       or not (v_qv.outstanding_thb > 0 and v_qv.outstanding_thb <= v_qv.grand_total)
       or round(v_qv.outstanding_thb, 2) <> v_qv.outstanding_thb then
      raise exception 'oem_invoice_issue: ไม่มียอดคงเหลือให้แจ้ง (ชำระครบแล้วหรือยอดไม่ถูกต้อง)' using errcode = '22023', hint = 'balance_none';
    end if;
    if v_qv.deposit_mode is not null and v_paid_before = 0 then
      raise exception 'oem_invoice_issue: ยังไม่ได้รับมัดจำ — ออกใบแจ้งหนี้มัดจำก่อน หรือตั้งมัดจำ 100%% / ล้างเงื่อนไขมัดจำของใบ' using errcode = '22023', hint = 'deposit_unpaid';
    end if;
    v_amount := v_qv.outstanding_thb;
  end if;

  v_balance_after := v_qv.grand_total - (v_paid_before + v_amount);
  if v_balance_after is null or v_balance_after < 0 then
    raise exception 'oem_invoice_issue: ยอดบวกไม่ลง (ยอดนี้ + รับแล้ว เกินยอดรวม)' using errcode = '22023', hint = 'amount_negative';
  end if;

  -- ---- 7. รายการ + ความสอดคล้องของยอดบนกระดาษ (รายการรวม = ค่าสินค้า · ค่าสินค้า + ค่าแบบ - ส่วนลด = ยอดรวม) ----
  select count(*),
         count(*) filter (where i.price_per_piece is null or i.item_total is null
                            or not (i.price_per_piece >= 0 and i.price_per_piece <= 100000000
                                    and i.item_total >= 0 and i.item_total <= 100000000)),
         coalesce(sum(i.item_total), 0)
    into v_items_n, v_items_bad, v_items_total
    from analytics.oem_quote_item i
   where i.quote_id = p_quote_id and i.shop_id = p_shop_id;
  if v_items_n = 0 or v_items_bad > 0 then
    raise exception 'oem_invoice_issue: ใบเสนอราคามีรายการไม่ครบหรือราคารายการไม่ถูกต้อง — ออกใบแจ้งหนี้ไม่ได้' using errcode = '22023', hint = 'totals_mismatch';
  end if;
  if v_qv.pieces_subtotal is null
     or v_items_total is distinct from v_qv.pieces_subtotal
     or coalesce(v_qv.nre_price, 0) < 0
     or v_qv.discount_thb is null or not (v_qv.discount_thb >= 0 and v_qv.discount_thb <= 100000000)
     or (v_qv.pieces_subtotal + coalesce(v_qv.nre_price, 0) - v_qv.discount_thb) is distinct from v_qv.grand_total then
    raise exception 'oem_invoice_issue: ยอดรายการ/ค่าแบบ/ส่วนลด บวกไม่ลงกับยอดรวมของใบเสนอราคา — ออกใบแจ้งหนี้ไม่ได้ (เอกสารที่บวกไม่ลงห้ามถึงลูกค้า)' using errcode = '22023', hint = 'totals_mismatch';
  end if;

  -- ---- 8. ด่าน "เปิดค้างได้ 1 ใบต่อดีล" (หลังล็อก quote) — อ่านนิยามเปิดค้างจาก v_oem_invoice ที่เดียวกับที่ UI เห็น ----
  select vi.invoice_no, vi.kind into v_open
    from analytics.v_oem_invoice vi
   where vi.shop_id = p_shop_id and vi.deal_root_id = v_root
     and vi.status = 'issued' and vi.payment_state = 'unpaid'
   limit 1;
  if found then
    raise exception 'oem_invoice_issue: ดีลนี้มีใบแจ้งหนี้ที่ยังเปิดค้างอยู่ (% ชนิด %) — ลูกค้าต้องไม่ถือสองยอดพร้อมกัน ยกเลิกใบเดิมก่อนออกใบใหม่', v_open.invoice_no, v_open.kind
      using errcode = '22023', hint = 'invoice_open';
  end if;

  -- ---- 9. replaces: ต้องชี้ใบที่ void แล้ว · ดีลเดียวกัน · ร้านเดียวกัน · ยังไม่เคยถูกแทนด้วยใบที่ออกอยู่ ----
  if p_replaces_invoice_id is not null then
    select i.status as st, coalesce(iq.root_quote_id, iq.id) as root_id into v_rep
      from analytics.oem_invoice i
      join analytics.oem_quote iq on iq.id = i.quote_id and iq.shop_id = i.shop_id
     where i.id = p_replaces_invoice_id and i.shop_id = p_shop_id;
    if not found
       or v_rep.st is distinct from 'void'
       or v_rep.root_id is distinct from v_root
       or exists (select 1 from analytics.oem_invoice r2 where r2.replaces_invoice_id = p_replaces_invoice_id and r2.status = 'issued') then
      raise exception 'oem_invoice_issue: p_replaces_invoice_id ต้องชี้ใบแจ้งหนี้ที่ถูกยกเลิกแล้ว ของดีลเดียวกัน ในร้านนี้ และยังไม่เคยถูกแทนที่ด้วยใบที่ออกอยู่'
        using errcode = '22023', hint = 'replaces_invalid';
    end if;
  end if;

  -- ---- 10. snapshot: รายการ (whitelist ทีละคีย์ — ห้าม to_jsonb(item)) ----
  select jsonb_agg(jsonb_build_object(
           'seq', i.seq,
           'name', left(coalesce(
                     nullif(btrim(i.product_name_snapshot), ''),
                     case when i.input ->> 'metal' = 'silver999'
                          then 'เงินแท่ง 99.99%' || case i.input ->> 'bar_size'
                                 when '0_5_baht' then ' ขนาด 0.5 บาท'
                                 when '1_baht'   then ' ขนาด 1 บาท'
                                 when '3_baht'   then ' ขนาด 3 บาท'
                                 when '5_baht'   then ' ขนาด 5 บาท'
                                 when '10_baht'  then ' ขนาด 10 บาท'
                                 when '1_kg'     then ' ขนาด 1 กิโลกรัม'
                                 else '' end
                     end,
                     nullif(btrim(i.input ->> 'item_kind'), ''),
                     'งาน OEM'), 200),
           'sku', left(nullif(btrim(i.sku_snapshot), ''), 100),
           'qty', i.qty,
           'unit_price_thb', i.price_per_piece,
           'line_total_thb', i.item_total) order by i.seq)
    into v_lines
    from analytics.oem_quote_item i
   where i.quote_id = p_quote_id and i.shop_id = p_shop_id;

  v_seller := jsonb_build_object(
    'legal_name', v_set.seller_legal_name,
    'display_name', v_set.seller_display_name,
    'branch_label', v_set.seller_branch_label,
    'address_lines', v_set.seller_address_lines,
    'tax_id', v_set.seller_tax_id,
    'phone', v_set.seller_phone,
    'vat_registered', v_set.seller_vat_registered
  );

  -- ---- 11. VAT: ตัดสินครั้งเดียว ณ ตอนออก (ร้านไม่จด VAT = none ทุกช่องเป็น null) ----
  v_vat_mode := coalesce(v_qv.vat_mode, 'included');
  if v_vat_mode not in ('included', 'breakdown') then
    raise exception 'oem_invoice_issue: โหมด VAT ของใบเสนอราคาไม่ถูกต้อง (%)', v_vat_mode using errcode = '22023', hint = 'vat_mode_invalid';
  end if;
  if coalesce(v_set.seller_vat_registered, false) then
    v_vat_display := v_vat_mode;
    v_vat_rate := v_qv.vat_rate;
    if v_vat_rate is null or not (v_vat_rate >= 0 and v_vat_rate < 1) then
      raise exception 'oem_invoice_issue: อัตรา VAT ของใบเสนอราคาไม่ถูกต้อง' using errcode = '22023', hint = 'vat_rate_invalid';
    end if;
    -- remainder: base คำนวณ แล้ว vat = ส่วนที่เหลือ (ไม่ปัดสองตัวอิสระ) — base + vat = amount เป๊ะทุกยอด
    v_vat_base := round(v_amount / (1 + v_vat_rate), 2);
    v_vat_amount := v_amount - v_vat_base;
  else
    v_vat_display := 'none';
  end if;

  -- description: RPC สร้างเอง (ไม่รับจาก client) · ไม่มีคำว่าภาษี/VAT เลย
  v_description := case p_kind
    when 'deposit' then
      case when v_qv.deposit_mode = 'pct' and v_qv.deposit_pct_effective > 0 and v_qv.deposit_pct_effective <= 1
           then 'เงินมัดจำ ' || rtrim(rtrim(round(v_qv.deposit_pct_effective * 100, 2)::text, '0'), '.') || '% ตามใบเสนอราคา ' || v_qv.quote_no
           else 'เงินมัดจำตามที่ตกลง ตามใบเสนอราคา ' || v_qv.quote_no end
    else
      -- balance ที่ยังไม่เคยรับเงิน = ใบยอดเต็ม (ไม่ตั้งมัดจำ) ไม่ใช่ "ยอดคงเหลือ"
      case when v_paid_before = 0 then 'ค่าสินค้า/บริการตามใบเสนอราคา ' || v_qv.quote_no
           else 'ยอดคงเหลือตามใบเสนอราคา ' || v_qv.quote_no end
  end;

  -- ---- 12. เลขที่เอกสาร: แถวตัวนับ IV-YYMM (แยกจาก RT-) +1 ทีละใบใน tx เดียวกับ insert ----
  -- ON CONFLICT DO UPDATE ยิงเป็น UPDATE ที่ new.last_no = old.last_no + 1 พอดี ผ่าน trg_oem_doc_counter_deny_mutation (0088) เสมอ
  v_doc_key := 'IV-' || to_char(v_today, 'YYMM');
  insert into analytics.oem_doc_counter as c (shop_id, doc_key, last_no)
  values (p_shop_id, v_doc_key, 1)
  on conflict (shop_id, doc_key) do update set last_no = c.last_no + 1
  returning last_no into v_no;
  v_invoice_no := v_doc_key || '-' || lpad(v_no::text, 3, '0');

  v_id := gen_random_uuid();
  insert into analytics.oem_invoice (
    id, shop_id, quote_id, invoice_no, kind, status, amount_thb,
    vat_display, vat_rate, vat_base_thb, vat_amount_thb,
    issue_date, due_date, pay_before_work, description, note,
    seller_snapshot, payment_lines,
    buyer_legal_name, buyer_tax_id, buyer_branch_label, buyer_address,
    quote_no_snapshot, lines_snapshot,
    pieces_subtotal_snapshot, nre_price_snapshot, discount_thb_snapshot, grand_total_snapshot,
    deposit_amount_snapshot, deposit_pct_snapshot,
    paid_before_thb, balance_after_thb, replaces_invoice_id, created_by
  ) values (
    v_id, p_shop_id, p_quote_id, v_invoice_no, p_kind, 'issued', v_amount,
    v_vat_display, v_vat_rate, v_vat_base, v_vat_amount,
    v_today, v_due, (p_kind = 'deposit'), v_description, v_note,
    v_seller, v_set.seller_payment_lines,
    v_customer.legal_name, v_customer.tax_id, v_customer.branch_label, v_customer.address,
    v_qv.quote_no, v_lines,
    v_qv.pieces_subtotal, coalesce(v_qv.nre_price, 0), v_qv.discount_thb, v_qv.grand_total,
    case when v_qv.deposit_mode is not null and v_qv.deposit_amount_thb > 0 and v_qv.deposit_amount_thb <= v_qv.grand_total
              and round(v_qv.deposit_amount_thb, 2) = v_qv.deposit_amount_thb
         then v_qv.deposit_amount_thb end,
    case when v_qv.deposit_mode is not null and v_qv.deposit_pct_effective >= 0 and v_qv.deposit_pct_effective <= 1
         then round(v_qv.deposit_pct_effective, 4) end,
    v_paid_before, v_balance_after, p_replaces_invoice_id, v_actor
  );

  insert into analytics.oem_quote_audit (shop_id, quote_id, actor, action, before, after)
  values (p_shop_id, p_quote_id, v_actor, 'invoice_issue', null,
          jsonb_build_object('invoice_id', v_id, 'invoice_no', v_invoice_no, 'kind', p_kind, 'amount_thb', v_amount));

  return jsonb_build_object('id', v_id, 'invoice_no', v_invoice_no);
end;
$f$;

revoke execute on function analytics.oem_invoice_issue(uuid, uuid, text, date, text, uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.oem_invoice_issue(uuid, uuid, text, date, text, uuid, uuid) to service_role;

CREATE OR REPLACE FUNCTION analytics.oem_invoice_void(p_shop_id uuid, p_invoice_id uuid, p_reason text, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $f$
declare
  v_actor  uuid;
  v_inv    analytics.oem_invoice%rowtype;
  v_state  text;
begin
  if p_shop_id is null or p_invoice_id is null then
    raise exception 'oem_invoice_void: p_shop_id และ p_invoice_id จำเป็น' using errcode = '22023', hint = 'args_required';
  end if;
  -- เหตุผลบังคับ: ต้องมีตัวอักษร/ตัวเลขจริง (whitelist) — null ตกที่ oem_note_present
  if not (analytics.oem_note_valid(p_reason) and analytics.oem_note_present(p_reason)) then
    raise exception 'oem_invoice_void: ต้องระบุเหตุผลที่ยกเลิก (มีตัวอักษร/ตัวเลขจริง ยาวไม่เกิน 500 ตัวอักษร ห้ามมีอักขระควบคุม/ล่องหน)' using errcode = '22023', hint = 'reason_invalid';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  v_actor := coalesce(auth.uid(), (select u.id from auth.users u where u.id = p_actor_id));
  if v_actor is null then
    raise exception 'oem_invoice_void: ต้องระบุผู้ทำรายการ (p_actor_id จาก session ฝั่ง server)' using errcode = '22023', hint = 'actor_required';
  end if;
  -- 0180 L1: actor ต้องเป็นสมาชิกร้าน (owner/admin) จริง — service_role ผ่าน crm_require_owner_admin โดยไม่ตรวจสมาชิก
  perform analytics.oem_require_actor_member(p_shop_id, v_actor);

  select * into v_inv from analytics.oem_invoice where id = p_invoice_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'oem_invoice_void: ไม่พบใบแจ้งหนี้ % ในร้านนี้', p_invoice_id using errcode = '22023', hint = 'invoice_not_found';
  end if;
  if v_inv.status <> 'issued' then
    raise exception 'oem_invoice_void: ยกเลิกได้เฉพาะใบสถานะ issued (ใบนี้สถานะ %)', v_inv.status using errcode = '22023', hint = 'invoice_not_issued';
  end if;

  select vi.payment_state into v_state from analytics.v_oem_invoice vi where vi.id = p_invoice_id;
  if v_state is distinct from 'unpaid' then
    raise exception 'oem_invoice_void: ใบนี้ถูกชำระแล้ว (หรืออ่านสถานะไม่ได้) — ยกเลิกใบเสร็จที่อ้างใบนี้ก่อน' using errcode = '22023', hint = 'invoice_paid';
  end if;

  update analytics.oem_invoice
     set status = 'void', void_reason = left(btrim(p_reason), 500), voided_at = now(), voided_by = v_actor
   where id = p_invoice_id and shop_id = p_shop_id;

  insert into analytics.oem_quote_audit (shop_id, quote_id, actor, action, before, after)
  values (p_shop_id, v_inv.quote_id, v_actor, 'invoice_void', null,
          jsonb_build_object('invoice_id', v_inv.id, 'invoice_no', v_inv.invoice_no, 'kind', v_inv.kind, 'amount_thb', v_inv.amount_thb));
end;
$f$;

revoke execute on function analytics.oem_invoice_void(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function analytics.oem_invoice_void(uuid, uuid, text, uuid) to service_role;

CREATE OR REPLACE FUNCTION analytics.oem_setting_set_payment_lines(p_shop_id uuid, p_lines text[], p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $f$
declare
  v_actor uuid;
  v_clean text[] := '{}';
  l       text;
begin
  if p_shop_id is null then
    raise exception 'oem_setting_set_payment_lines: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  -- null = ไม่ใช่ "ล้างค่า" — ส่ง array ว่างถ้าต้องการล้าง (กัน client ลืมส่งแล้วบัญชีหาย)
  if p_lines is null then
    raise exception 'oem_setting_set_payment_lines: p_lines ห้ามเป็น null (ต้องการล้างค่าให้ส่ง array ว่าง)' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  -- actor มาจาก session ฝั่ง server เท่านั้น (ห้ามรับจาก client) · ช่องทางชำระเปลี่ยน = เปลี่ยนที่ลูกค้าโอนเงิน จึงต้องรู้ว่าใครแก้
  v_actor := coalesce(auth.uid(), (select u.id from auth.users u where u.id = p_actor_id));
  if v_actor is null then
    raise exception 'oem_setting_set_payment_lines: ต้องระบุผู้ทำรายการ (p_actor_id ที่มีอยู่จริง)' using errcode = '22023', hint = 'actor_required';
  end if;
  -- 0180 L1: actor ต้องเป็นสมาชิกร้าน (owner/admin) จริง — service_role ผ่าน crm_require_owner_admin โดยไม่ตรวจสมาชิก
  perform analytics.oem_require_actor_member(p_shop_id, v_actor);

  foreach l in array p_lines loop
    -- แถวว่างจาก textarea (ว่างจริงหรือเว้นวรรคล้วน) ข้ามเงียบๆ · อักขระล่องหน/วรรคตอนล้วนไม่ถูกข้าม — ตกที่ด่านด้านล่าง
    if l is null or btrim(l) = '' then
      continue;
    end if;
    if position(chr(10) in l) > 0 or position(chr(13) in l) > 0 then
      raise exception 'oem_setting_set_payment_lines: 1 ช่องทางต่อ 1 บรรทัด — ห้ามมีการขึ้นบรรทัดใหม่ภายในบรรทัดเดียว' using errcode = '22023';
    end if;
    if not (analytics.oem_note_valid(l) and analytics.oem_note_present(l)) or char_length(btrim(l)) > 200 then
      raise exception 'oem_setting_set_payment_lines: แต่ละบรรทัดต้องมีตัวอักษร/ตัวเลขจริง ยาวไม่เกิน 200 ตัวอักษร และห้ามมีอักขระควบคุม/ล่องหน' using errcode = '22023';
    end if;
    v_clean := v_clean || btrim(l);
  end loop;

  if cardinality(v_clean) > 6 then
    raise exception 'oem_setting_set_payment_lines: ช่องทางชำระเงินมีได้ไม่เกิน 6 บรรทัด (ส่งมา %)', cardinality(v_clean) using errcode = '22023';
  end if;

  update analytics.oem_setting
     set seller_payment_lines = v_clean, updated_by = v_actor, updated_at = now()
   where shop_id = p_shop_id;
  if not found then
    raise exception 'oem_setting_set_payment_lines: ร้านนี้ยังไม่มีแถวตั้งค่า OEM — บันทึกข้อมูลร้านก่อน' using errcode = '22023';
  end if;
end;
$f$;

revoke execute on function analytics.oem_setting_set_payment_lines(uuid, text[], uuid) from public, anon, authenticated;
grant execute on function analytics.oem_setting_set_payment_lines(uuid, text[], uuid) to service_role;

-- ============================================================================
-- 7. M1 — audit การแก้ช่องทางชำระ (seller_payment_lines): trigger บน oem_setting จับทั้งทาง RPC และเขียนตรง
--    เหตุผล: ช่องทางชำระเปลี่ยน = เปลี่ยนบัญชีที่ลูกค้าโอนเงินเข้า (จุดโกงเงินลูกค้า) · 0179 มีแค่ updated_by/updated_at (ทับได้ ไม่มีค่าก่อนแก้)
--    actor = auth.uid() ถ้ามี · ไม่งั้น new.updated_by เฉพาะเมื่อคำสั่งนี้ตั้ง updated_by/updated_at เองจริง (RPC ตั้งทั้งคู่) —
--    เขียนตรงที่ไม่แตะสองคอลัมน์นี้ = actor null (ไม่ใช่ "ผู้แก้คนก่อน" ซึ่งจะโยนความผิดผิดคน — ต่างจาก SQL ตั้งต้นที่ Mace เสนอเล็กน้อย)
--    ค่า before/after เก็บบรรทัดช่องทางชำระเต็ม (นั่นคือหลักฐาน) — crm_audit_log เข้าถึงได้เฉพาะ service_role · append-only (trigger crm_audit_log_append_only)
-- ============================================================================
alter table analytics.crm_audit_log drop constraint if exists crm_audit_log_action_check;
alter table analytics.crm_audit_log
  add constraint crm_audit_log_action_check
  check (action in ('order_override_set', 'order_override_clear', 'customer_edit', 'pii_edit', 'note_add', 'note_edit', 'note_delete',
                    'customer_merge', 'merge_dismiss', 'province_set', 'province_revert', 'oem_payment_lines_set'));

create or replace function analytics.oem_setting_payment_lines_audit()
returns trigger
language plpgsql
security definer
set search_path = public, analytics, extensions, pg_temp
as $f$
declare
  v_actor  uuid;
  v_claim  uuid;
  v_before jsonb := null;
begin
  if tg_op = 'UPDATE' then
    if new.seller_payment_lines is not distinct from old.seller_payment_lines then
      return null;
    end if;
    v_before := jsonb_build_object('seller_payment_lines', to_jsonb(old.seller_payment_lines));
    v_claim := case when new.updated_by is distinct from old.updated_by or new.updated_at is distinct from old.updated_at
                    then new.updated_by end;
  else
    v_claim := new.updated_by;
  end if;
  -- actor ต้องมีอยู่จริงใน auth.users (FK) — ค่าที่อ้างไม่จริง = null แทนที่จะให้ audit ล้มแล้วบล็อกการเขียน
  v_actor := coalesce(auth.uid(), (select u.id from auth.users u where u.id = v_claim));
  insert into analytics.crm_audit_log (shop_id, actor, action, entity_type, entity_id, before, after)
  values (new.shop_id, v_actor, 'oem_payment_lines_set', 'oem_setting', new.shop_id, v_before,
          jsonb_build_object('seller_payment_lines', to_jsonb(new.seller_payment_lines)));
  return null;
end;
$f$;

revoke execute on function analytics.oem_setting_payment_lines_audit() from public, anon, authenticated;

drop trigger if exists trg_oem_setting_payment_lines_audit_upd on analytics.oem_setting;
create trigger trg_oem_setting_payment_lines_audit_upd
  after update of seller_payment_lines on analytics.oem_setting
  for each row when (old.seller_payment_lines is distinct from new.seller_payment_lines)
  execute function analytics.oem_setting_payment_lines_audit();

-- แถว oem_setting ที่ถูก insert ตรงพร้อมช่องทางชำระไม่ว่าง ก็ต้องมีร่องรอย (ทางปกติ default {} ไม่ยิง)
drop trigger if exists trg_oem_setting_payment_lines_audit_ins on analytics.oem_setting;
create trigger trg_oem_setting_payment_lines_audit_ins
  after insert on analytics.oem_setting
  for each row when (cardinality(new.seller_payment_lines) > 0)
  execute function analytics.oem_setting_payment_lines_audit();

-- ============================================================================
-- 8. M2 — oem_doc_counter: ตัวนับเลขเอกสารภาษีห้ามถูกแก้ตรงแม้ด้วย service_role key
--    grep แล้ว (16 ต.ค. 69): ไม่มีโค้ด TS/script เขียนตารางนี้ตรง · ฟังก์ชันที่แตะตัวนับมี 2 ตัว (oem_receipt_issue / oem_invoice_issue) ทั้งคู่ security definer owner postgres
--    ⇒ revoke จาก service_role ไม่กระทบการออกเลข · trigger BEFORE INSERT กันแถวใหม่ที่ตั้ง last_no ล่วงหน้า (INSERT ... ON CONFLICT DO UPDATE ยังผ่าน:
--    แถวที่เสนอ last_no=1 ผ่าน trigger นี้ แล้วทางชนคีย์ไปที่ trigger UPDATE ของ 0088 ที่บังคับ +1) · ไม่แตะฟังก์ชัน trigger เดิมของ 0088
-- ============================================================================
revoke insert, update, delete, truncate on analytics.oem_doc_counter from service_role;

create or replace function analytics.oem_doc_counter_deny_insert()
returns trigger
language plpgsql
set search_path = public, analytics, extensions, pg_temp
as $f$
begin
  if new.last_no is distinct from 1 then
    raise exception 'oem_doc_counter: แถวตัวนับใหม่ต้องเริ่มที่ last_no = 1 เท่านั้น (ได้ %) — กันตั้งเลขเอกสารข้ามไปล่วงหน้าตั้งแต่ตอนสร้างแถว · ออกเลขผ่าน RPC ออกเอกสาร (oem_receipt_issue / oem_invoice_issue) เท่านั้น', new.last_no
      using errcode = '22023';
  end if;
  return new;
end;
$f$;

revoke execute on function analytics.oem_doc_counter_deny_insert() from public, anon, authenticated;

drop trigger if exists trg_oem_doc_counter_deny_insert on analytics.oem_doc_counter;
create trigger trg_oem_doc_counter_deny_insert
  before insert on analytics.oem_doc_counter
  for each row execute function analytics.oem_doc_counter_deny_insert();

-- ============================================================================
-- 9. ปิดท้าย: assert (ผิด = raise = ถอยทั้งไฟล์ ไม่ apply ครึ่งๆ) แล้ว reload PostgREST
-- ============================================================================
do $chk0180$
declare
  v_bad text;
  v_pre record;
begin
  -- ไม่มี overload (traps ข้อ 1)
  select string_agg(proname || ' x' || n, ', ') into v_bad
    from (select p.proname, count(*) n
            from pg_proc p
           where p.pronamespace = 'analytics'::regnamespace
             and p.proname in ('oem_receipt_issue', 'oem_invoice_issue', 'oem_invoice_void', 'oem_setting_set_payment_lines',
                               'oem_require_actor_member', 'oem_receipt_check_invoice_link', 'oem_setting_payment_lines_audit',
                               'oem_doc_counter_deny_insert')
           group by p.proname having count(*) <> 1) t;
  if v_bad is not null then
    raise exception '0180: พบ overload/ขาด signature: %', v_bad;
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in (
        'oem_receipt_issue', 'oem_invoice_issue', 'oem_invoice_void', 'oem_setting_set_payment_lines',
        'oem_require_actor_member', 'oem_receipt_check_invoice_link', 'oem_setting_payment_lines_audit', 'oem_doc_counter_deny_insert')) <> 8 then
    raise exception '0180: จำนวนฟังก์ชันที่แตะไม่ใช่ 8';
  end if;
  if to_regprocedure('analytics.oem_receipt_issue(uuid,uuid,numeric,date,text,text,text,text,uuid)') is not null
     or to_regprocedure('analytics.oem_receipt_issue(uuid,uuid,numeric,date,text,text,text,text,uuid,uuid,uuid)') is null then
    raise exception '0180: oem_receipt_issue ต้องเหลือ 11 args ตัวเดียว (9 args เดิมต้องถูก drop)';
  end if;

  -- ไม่มีฟังก์ชันที่แตะตัวไหนที่ PUBLIC/anon/authenticated ถือ EXECUTE (traps ข้อ 18)
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p cross join lateral aclexplode(p.proacl) a
   where p.pronamespace = 'analytics'::regnamespace
     and p.proname in ('oem_receipt_issue', 'oem_invoice_issue', 'oem_invoice_void', 'oem_setting_set_payment_lines',
                       'oem_require_actor_member', 'oem_receipt_check_invoice_link', 'oem_setting_payment_lines_audit',
                       'oem_doc_counter_deny_insert')
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  if v_bad is not null then
    raise exception '0180: ฟังก์ชันที่ PUBLIC/anon/authenticated ถือ EXECUTE: %', v_bad;
  end if;

  -- v_oem_invoice: ชื่อ/ลำดับคอลัมน์เดิมเป๊ะ 53 ตัว (md5 ของรายชื่อ ลอกจาก DB ก่อน apply) · v_oem_receipt: 32 เดิม + 2 ท้าย
  if (select count(*) from information_schema.columns where table_schema = 'analytics' and table_name = 'v_oem_invoice') <> 53
     or (select md5(string_agg(column_name, ',' order by ordinal_position)) from information_schema.columns
          where table_schema = 'analytics' and table_name = 'v_oem_invoice') <> 'db0063947e08813e35a2250746a275d8' then
    raise exception '0180: v_oem_invoice ต้องมี 53 คอลัมน์ ชื่อ/ลำดับเดิมเป๊ะ (traps ข้อ 3)';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'analytics' and table_name = 'v_oem_receipt') <> 34
     or (select column_name from information_schema.columns where table_schema = 'analytics' and table_name = 'v_oem_receipt' and ordinal_position = 32) <> 'is_deal_active'
     or (select column_name from information_schema.columns where table_schema = 'analytics' and table_name = 'v_oem_receipt' and ordinal_position = 33) <> 'invoice_id'
     or (select column_name from information_schema.columns where table_schema = 'analytics' and table_name = 'v_oem_receipt' and ordinal_position = 34) <> 'invoice_no_snapshot' then
    raise exception '0180: v_oem_receipt ต้อง append invoice_id/invoice_no_snapshot ท้ายสุด (34 คอลัมน์)';
  end if;

  -- M2: service_role อ่านตัวนับได้อย่างเดียว
  if not has_table_privilege('service_role', 'analytics.oem_doc_counter', 'select')
     or has_table_privilege('service_role', 'analytics.oem_doc_counter', 'insert')
     or has_table_privilege('service_role', 'analytics.oem_doc_counter', 'update')
     or has_table_privilege('service_role', 'analytics.oem_doc_counter', 'delete')
     or has_table_privilege('service_role', 'analytics.oem_doc_counter', 'truncate')
     or has_table_privilege('anon', 'analytics.oem_doc_counter', 'select')
     or has_table_privilege('authenticated', 'analytics.oem_doc_counter', 'select') then
    raise exception '0180: สิทธิ์ตาราง oem_doc_counter ไม่ตรง (service_role ต้อง select อย่างเดียว · anon/authenticated ไม่มีเลย)';
  end if;

  -- ไฟล์นี้ไม่ขยับตัวนับ/ใบเสร็จ/ใบแจ้งหนี้ (ข้อ 19) — เทียบกับ baseline ที่เก็บตอนต้นไฟล์
  select * into v_pre from _pre0180;
  if v_pre.counters is distinct from (select coalesce(md5(string_agg(shop_id::text || doc_key || last_no::text, ',' order by shop_id, doc_key)), '') from analytics.oem_doc_counter)
     or v_pre.invoices is distinct from (select coalesce(md5(string_agg(to_jsonb(i)::text, ',' order by i.id)), '') from analytics.oem_invoice i)
     or v_pre.n_receipts is distinct from (select count(*) from analytics.oem_receipt)
     or v_pre.n_invoices is distinct from (select count(*) from analytics.oem_invoice) then
    raise exception '0180: ตัวนับเลขเอกสาร/ใบแจ้งหนี้/จำนวนใบเสร็จขยับระหว่าง migration — ห้ามเกิด';
  end if;
  -- ใบเสร็จเดิมทุกใบ: เพิ่มคอลัมน์ใหม่แล้ว (to_jsonb เปลี่ยนรูป) ต้องไม่มีใบไหนมี invoice_id/invoice_no_snapshot
  if exists (select 1 from analytics.oem_receipt where invoice_id is not null or invoice_no_snapshot is not null) then
    raise exception '0180: มีใบเสร็จเดิมที่มี invoice_id/invoice_no_snapshot — migration นี้ไม่ backfill ห้ามเกิด';
  end if;
end $chk0180$;

notify pgrst, 'reload schema';

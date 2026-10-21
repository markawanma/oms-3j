-- 0189_shop_photos_w2.sql — W2: ผู้จัดการแนบรูปสั่งงานจากมือถือ (QR ร้าน + PIN · ไม่ login) · ≤ 3 รูป/ใบ · เพิ่ม/ลบของตัวเองได้จนช่างเริ่มรับงาน
-- สถานะ: ยังไม่ apply · dry-run เท่านั้น · apply ด้วย node scripts/run-sql.mjs --commit --record เท่านั้น (🔴 ห้าม supabase db push) · ชุดทดสอบ scripts/verify/verify-0189.sql · ไฟล์ต้องเป็น LF (ข้อ 20)
-- 🔴 ลำดับ deploy: dry-run 0189 + verify-0189 (ต่อไฟล์เป็นไฟล์เดียว ไม่ใส่ --commit) → apply --commit --record → verify-0189 + verify-0182 + verify-0187 + verify-0188 + `node scripts/run-sql.mjs scripts/check-analytics-grants.sql` → แล้วค่อย merge โค้ด TS
--   (merge ก่อน apply = action ใหม่เรียก RPC ที่ยังไม่มี → แนบรูปล้ม ไม่กระทบหน้าอื่น — DB เดียว ไม่มี dev/prod แยก)
-- design: docs/3j-jewelry/oms/design-job-photos.md §10.2 (มติ 21 ต.ค.) · design-job-lots-shopfloor.md §7.4 (ต่อท้าย: W2) · ต่อจาก 0182 (ตาราง job_photo + bucket) และ 0187/0188 (QR ร้าน · job_worker_open · worker.can_open_job)
--
-- ทำไม (ภาษาคน): ผู้จัดการเปิดใบจากมือถือที่หน้างานแล้ว อยากถ่ายรูปสินค้าแนบใบทันที (ช่างจะได้เห็นว่าทำอะไร) — ทางเดียวที่ทำได้คือช่องสาธารณะ (QR ร้าน + PIN) ที่ "เขียน storage ครั้งแรก"
--   ⇒ ด่านทุกชั้นต้องอยู่ที่ DB (ร้านมาจาก token เท่านั้น · สิทธิ์ตรวจสดทุกครั้ง · ใบต้องเป็นใบที่ "ช่างคนนี้เปิดเอง" ด้วย idem key · ยังไม่มีขั้นใดถูกรับ) และ action ฝั่ง server ต้องผ่าน DB "ก่อน" แตะ bucket
--   มติเจ้าของ 21 ต.ค.: รูปจากหน้างาน ≤ 3 รูป/ใบ (เพดานระบบเดิม 5 reference/ใบยังอยู่ — หน้างานใช้ได้ 3 ในนั้น) · เพิ่ม/ลบรูปของตัวเองได้ "จนช่างเริ่มรับงาน" (มีขั้นใด received/sent = ล็อก) — ไม่ใช่จนออฟฟิศรับทราบ
--
-- สิ่งที่ไฟล์นี้ทำ
--  1. job_photo_guard (replace · signature เดิม · def ลอกจาก 0182 — ไม่มี migration ไหนแก้ต่อ · pre-check ยืนยันเครื่องหมายของ 0182): + ด่านบน INSERT ที่ source='shopfloor' ∧ kind='reference' ∧ มี worker_id
--     (a) ต้องมาจาก RPC ช่าง: GUC analytics.shop_photo_id = id ของแถวนั้นในทรานแซกชันเดียวกัน (b) นับรูปหน้างานที่ยังไม่ลบของใบ ≥ 3 = photo_cap_shopfloor (กำแพงที่ DB แม้ RPC ถูกแก้ผิด)
--     ออฟฟิศ (source office/product) · kind stage · แถวที่ผิด CHECK = พฤติกรรมเดิมเป๊ะ (ด่านใหม่อยู่ท้ายสุดของสาย INSERT และเปิดเฉพาะ reference+shopfloor+worker — verify-0182 ยิง shopfloor ตรงเฉพาะ kind stage / ไม่มี worker)
--  2. helper ภายใน (ไม่ grant ใคร): shop_intake_photo_auth · job_worker_photo_job · job_worker_photo_block
--  3. RPC ช่าง 6 ตัว (security definer · service_role เท่านั้น): job_worker_photo_begin · job_worker_photo_add · job_worker_photo_remove · job_worker_photo_list · job_worker_my_intake_list ("ใบที่ฉันเปิด" บน hub — มติ 21 ต.ค.)
--     · job_worker_token_reissue ("ออก QR ใหม่" ของใบที่ฉันเปิด — ใช้ job_token_issue_core · ไม่เพิกถอน QR เดิม · เพดาน 5 · ได้แม้ช่างรับงานแล้วตราบใดที่ใบยังไม่ปิด/ยกเลิก)
--     begin/add/list อ้างใบได้ 2 ทาง "อย่างใดอย่างหนึ่ง": p_idem_key (เพิ่งเปิดใบ) หรือ p_job_id (จากรายการใบของฉัน) — ผ่านเงื่อนไขเดียวกัน: ใบผลิต opened_via=shopfloor ∧ opened_by_worker_id = ช่างใน session ∧ ร้านจาก token ·
--     job_id ของคนอื่น/ใบออฟฟิศ/ร้านอื่น/ส่วนย่อย = order_not_found (ไม่ใช่แค่รู้ uuid แล้วเข้าได้) · ทั้งสองทางหรือไม่ส่งสักทาง = idem_invalid
--  4. โควตาหน้างาน (security M1 · 21 ต.ค.): ฟังก์ชันค่ากำหนด job_shopfloor_photo_quota() ที่เดียว — พื้นที่รวมรูป shopfloor ที่ยังไม่ลบต่อร้าน ≤ 80 MB · ต่อช่าง ≤ 60 รูป/24 ชม. (นับรวมที่ลบแล้ว กันวน add/remove) ·
--     บังคับที่ guard (ล็อกใบ seed 2 → ร้าน seed 3 → ช่าง seed 4 · L1) + เช็คก่อนแตะ bucket ที่ begin · hint photo_budget_shopfloor / photo_daily_cap · นับเพดาน 3 เฉพาะ kind='reference' ตรงกันทุกจุด (L2) · index idx_job_photo_shopfloor_worker
--  ไม่มี trigger ใหม่บน job_photo (verify-0182 นับ trigger = 3) · ไม่แตะ job_photo_enforce_cap / job_photo_add (ออฟฟิศ) / job_worker_resolve (แสดงรูป reference ทุก source อยู่แล้ว) / production_order_done
--
-- ตัดสินเอง (นอก design — เหตุผล)
--  (1) begin ไม่เก็บ photo_id ที่ออกให้ (ไม่มีตารางคูปอง): add ตรวจ "ทุกด่านซ้ำ" ด้วยตัวเอง (token/session/สิทธิ์/ใบของช่างคนนี้/ยังไม่มีขั้นถูกรับ/เพดาน/path ตรง id) และ PK ของ job_photo กัน photo_id ซ้ำ —
--      คูปองจึงไม่เพิ่มความปลอดภัย (RPC ถึงได้เฉพาะ server ที่ถือ service key) แต่เพิ่มตาราง/งานเก็บกวาด · begin = "ผ่านด่านก่อนแตะ bucket" + ออก uuid ให้ path เท่านั้น
--  (2) ใบที่ถูกต้อง = production_order ที่ (ร้านจาก token · intake_idem_key = key · opened_by_worker_id = ช่างใน session) แล้วเดินไปใบงานราก (ไม่มี parent) — idem key ของช่างอื่น/ไม่มีจริง/ใบออฟฟิศ (idem ว่างเสมอ — CHECK 0187)
--      ตอบ order_not_found เหมือนกันทุกกรณี (ไม่บอกว่า key นั้นมีจริงของคนอื่นไหม)
--  (3) "ล็อก" = มีขั้นใด received/sent หรือ job.status in_progress/done · "cancelled" (ใบหรือใบผลิต) แยก code ให้ข้อความตรงเหตุ · on_hold/สถานะอื่นที่ไม่ใช่ open = job_not_open (ตามบรีฟ "ใบ open")
--  (4) รูปแรกของใบ (ยังไม่มีรูปหลัก) เป็นรูปหลักอัตโนมัติ เหมือนฝั่งออฟฟิศ · p_is_primary=true ขอเป็นหลักได้เฉพาะเมื่อรูปหลักเดิมเป็นของหน้างานด้วย (ผู้จัดการสลับของตัวเอง) — ไม่ล้มรูปหลักที่ออฟฟิศ/แคตตาล็อกตั้งไว้ · ผลคืน is_primary จริง
--  (5) ลบ: deleted_by = id ช่าง (คอลัมน์ uuid ไม่มี FK · CHECK deleted_ck ต้องไม่ว่าง) · ลบรูปหลัก = เลื่อนรูป reference ถัดไปเป็นหลัก (เหมือน job_photo_remove) · ลบซ้ำ = already_deleted (UI ถือว่าสำเร็จ) · เหตุผลไม่เก็บ (null)
--  (6) rate limit: ถัง ip ใช้ ipw: (300/10 นาที — ถังเดียวกับเปิดใบ) ก่อนตรวจ token · ต่อช่าง wp:<worker> 30/10 นาที นับทั้ง begin/add/remove (หลังพบ session ที่เป็นผู้จัดการ — คนไม่มีสิทธิ์เผาถังคนจริงไม่ได้) · list ใช้ ipr: 240 + wpl: 120
--      ไม่ใช้ shop_intake_auth (ไม่ replace ฟังก์ชันด่านกลางของ W1 · ไม่นับถัง sio: ของเปิดใบ) — helper ใหม่ทำลำดับเดียวกัน: ip → รูปแบบ hash → token (ไม่พบ = ไม่เขียนถัง) → เพิกถอน → session (ร้านเดียวกัน · worker active) → can_open_job สด
--  (7) event photo_add/photo_remove: actor = null · worker_id = ช่าง · channel worker_qr (เหมือน intake_open) · payload มีเฉพาะ id/ชนิด/ที่มา/bytes/is_primary — ไม่มี path
--  (8) job_worker_photo_list คืน path (md/sm) ให้ server ใช้เซ็น URL แล้วทิ้ง (เหมือน job_worker_resolve) — ไม่ถึง client · TS ประกอบทีละ field
--
-- ไม่มีเงิน/ต้นทุนในไฟล์นี้ · ไม่ UPDATE แถวเดิมใดๆ (ไม่ยิง trigger ของตารางใด — ข้อ 19) · post-check ล็อก: ฟังก์ชันเดิมนอกรายการ md5 เท่าเดิม · แถวตาราง job/job_stage/job_event/job_photo/production_order/worker เท่าเดิม · trigger job_photo = 3 · ไม่มี overload · ไม่มีสิทธิ์ anon/authenticated/PUBLIC

-- baseline: ฟังก์ชันทุกตัวในสคีมา (md5) + ตัวชี้วัดแถว
create temp table _m189_fn_base on commit drop as
select p.oid::regprocedure::text as sig, p.proname, md5(pg_get_functiondef(p.oid)) as h
from pg_proc p
where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f';

create temp table _m189_row_base on commit drop as
select 'job'::text as t, count(*) as n, coalesce(md5(string_agg(j::text, '|' order by j.id)), '') as h from analytics.job j
union all select 'job_stage', count(*), coalesce(md5(string_agg(s::text, '|' order by s.id)), '') from analytics.job_stage s
union all select 'job_event', count(*), coalesce(md5(string_agg(e::text, '|' order by e.id)), '') from analytics.job_event e
union all select 'job_photo', count(*), coalesce(md5(string_agg((to_jsonb(ph) - 'client_key')::text, '|' order by ph.id)), '') from analytics.job_photo ph
union all select 'production_order', count(*), coalesce(md5(string_agg(po::text, '|' order by po.id)), '') from analytics.production_order po
union all select 'worker', count(*), coalesce(md5(string_agg(w::text, '|' order by w.id)), '') from analytics.worker w
union all select 'worker_session', count(*), coalesce(md5(string_agg(s::text, '|' order by s.id)), '') from analytics.worker_session s
union all select 'shop_intake_token', count(*), coalesce(md5(string_agg(t::text, '|' order by t.id)), '') from analytics.shop_intake_token t;

-- ============================================================================
-- 0. pre-check
-- ============================================================================
do $p$
declare
  v_n int;
  v_def text;
begin
  perform 1 from pg_temp._m189_fn_base limit 1;  -- รันแบบ autocommit ตารางหาย ⇒ ล้มก่อน DDL ใดๆ
  if to_regclass('analytics.job_photo') is null or to_regclass('analytics.shop_intake_token') is null or to_regclass('analytics.worker_session') is null then
    raise exception '0189: ไม่พบ job_photo (0182) / shop_intake_token (0187) / worker_session — apply 0182 และ 0187 ก่อน';
  end if;
  if to_regprocedure('analytics.job_worker_open(text,text,text,uuid,text,text,numeric,numeric,integer,integer,date,boolean,text,text,text)') is null
     or to_regprocedure('analytics.job_fail(text,text,jsonb)') is null
     or to_regprocedure('analytics.job_rate_limit_hit(text,integer)') is null
     or to_regprocedure('analytics.job_event_write(uuid,uuid,text,date,uuid,uuid,text,text,jsonb)') is null
     or to_regprocedure('analytics.job_device_hint(text,text)') is null
     or to_regprocedure('analytics.job_today()') is null
     or to_regprocedure('analytics.job_token_issue_core(analytics.job,boolean,uuid,uuid,text,uuid)') is null then
    raise exception '0189: ไม่พบฟังก์ชันที่ต้องใช้ (job_worker_open · job_fail · job_rate_limit_hit · job_event_write · job_device_hint · job_today) — ตรวจ 0172/0187';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'analytics' and table_name = 'worker' and column_name = 'can_open_job')
     or not exists (select 1 from information_schema.columns where table_schema = 'analytics' and table_name = 'production_order' and column_name = 'intake_idem_key')
     or not exists (select 1 from information_schema.columns where table_schema = 'analytics' and table_name = 'production_order' and column_name = 'opened_by_worker_id') then
    raise exception '0189: ไม่พบคอลัมน์ worker.can_open_job / production_order.intake_idem_key / opened_by_worker_id (0187)';
  end if;
  -- คอลัมน์ที่ job_worker_my_intake_list อ่าน (plpgsql ไม่ตรวจชื่อคอลัมน์ตอน create — ตรวจที่นี่ให้ล้มก่อน DDL)
  select count(*) into v_n from information_schema.columns
   where table_schema = 'analytics'
     and ((table_name = 'job' and column_name in ('design_label', 'metal', 'qty_order', 'job_no', 'status', 'created_at', 'production_order_item_id', 'parent_job_id'))
       or (table_name = 'production_order' and column_name in ('po_no', 'status', 'opened_via'))
       or (table_name = 'production_order_item' and column_name = 'production_order_id'));
  if v_n <> 12 then
    raise exception '0189: คอลัมน์ของ job / production_order / production_order_item ไม่ครบตามที่ my_intake_list ใช้ (พบ % จาก 12)', v_n;
  end if;
  select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'job_photo_guard';
  if v_n <> 1 then
    raise exception '0189: job_photo_guard มี % signature (ต้องมี 1) — หยุดตรวจ overload ก่อน', v_n;
  end if;
  select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_photo_guard';
  -- ฉบับที่ลอกมา = 0182 (มีข้อความเฉพาะของ 0182 ครบ และยังไม่มีเครื่องหมาย 0189) หรือฉบับ 0189 แล้ว (รันซ้ำ)
  if position('0189' in v_def) = 0 and not (
       position('lot_no_photo' in v_def) > 0
       and position('analytics.job_photo ห้ามลบแถว' in v_def) > 0
       and position('product_image_id เปลี่ยนเป็นค่าอื่นไม่ได้' in v_def) > 0
       and position('caption_invalid' in v_def) > 0
       and position('shop_photo_id' in v_def) = 0) then
    raise exception '0189: def ของ job_photo_guard บน DB ไม่ใช่ฉบับ 0182 ที่ลอกมา — มีคนแก้นอก migration · หยุด ห้าม replace ทับ';
  end if;
  -- job_photo_remove (ออฟฟิศ): ฉบับที่ลอกมา = 0182 (มีข้อความ/ลำดับเฉพาะของ 0182 ครบ · ยังไม่มี reason_required) หรือฉบับ 0189 แล้ว (รันซ้ำ)
  select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'job_photo_remove';
  if v_n <> 1 then
    raise exception '0189: job_photo_remove มี % signature (ต้องมี 1) — หยุดตรวจ overload ก่อน', v_n;
  end if;
  select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_photo_remove';
  if position('reason_required' in v_def) = 0 and not (
       position('ไม่พบรูปนี้ในร้านนี้' in v_def) > 0 and position('job_office_begin(''job_photo_remove''' in v_def) > 0
       and position('promoted_photo_id' in v_def) > 0 and position('v_next' in v_def) > 0 and position('ถูกลบไปแล้ว' in v_def) > 0) then
    raise exception '0189: def ของ job_photo_remove บน DB ไม่ใช่ฉบับ 0182 ที่ลอกมา — มีคนแก้นอก migration · หยุด ห้าม replace ทับ';
  end if;
  raise notice '0189: รูปใบงานเดิม % แถว · ใบผลิตจากหน้างาน % ใบ (ไม่มี UPDATE แถวเดิมในไฟล์นี้)',
    (select count(*) from analytics.job_photo), (select count(*) from analytics.production_order where opened_via = 'shopfloor');
end;
$p$;

-- ============================================================================
-- 0.5 โควตารูปจากหน้างาน (M1) — ค่ากำหนดตำแหน่งเดียว (ทีมตั้ง ไม่ใช่ค่าเจ้าของ · แจ้งเจ้าของแล้ว · ปรับทีหลังได้ด้วย migration ที่ replace ฟังก์ชันนี้)
--   shop_bytes_max = พื้นที่รวมรูป source=shopfloor ที่ยังไม่ลบ ต่อร้าน (md+sm) · worker_24h_max = จำนวนรูปที่ช่างคนหนึ่งแนบใน 24 ชม. (นับรวมที่ลบแล้ว)
--   🔴 ตัวเลขนี้ซ้ำใน lib/images/constants.ts (SHOPFLOOR_PHOTOS_BUDGET_BYTES · SHOPFLOOR_PHOTOS_PER_WORKER_24H) — ขยับพร้อมกัน
-- ============================================================================
create or replace function analytics.job_shopfloor_photo_quota()
 returns jsonb
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $f$ select jsonb_build_object('shop_bytes_max', 80 * 1024 * 1024, 'worker_24h_max', 60) $f$;

-- idempotency ของการอัปโหลดรูปหน้างาน: uuid ต่อรูปจาก client (clientPhotoKey) — key เดิมของช่างคนเดิม = คืนรูปเดิม ไม่สร้างซ้ำ ไม่อัปซ้ำ · unique ต่อ (ช่าง, key) · ไม่ใช่ id ของรูป (id ยังออกโดย DB เสมอ)
-- additive: add column (null) ไม่ยิง trigger ไม่ UPDATE แถวเดิม · guard ล็อกไม่ให้แก้ค่านี้ภายหลัง (อยู่ในชุด immutable)
alter table analytics.job_photo add column if not exists client_key uuid;
create unique index if not exists uq_job_photo_client_key on analytics.job_photo (worker_id, client_key) where client_key is not null;

-- ต่อช่าง/24 ชม. (นับรวมที่ลบแล้ว) — ให้การนับของ guard/begin ไม่ต้องกวาดทั้งตาราง
create index if not exists idx_job_photo_shopfloor_worker on analytics.job_photo (worker_id, created_at) where source = 'shopfloor';

-- ============================================================================
-- 1. job_photo_guard — เนื้อเดิมของ 0182 ทุกบรรทัด + ด่านท้ายสาย INSERT (เฉพาะ reference + shopfloor + มี worker)
-- ============================================================================
create or replace function analytics.job_photo_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_shop uuid;
  v_parent uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'analytics.job_photo ห้ามลบแถว (แถวคือหลักฐานว่าใครลบรูปเมื่อไร — ใช้ job_photo_remove)' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    select j.shop_id, j.parent_job_id into v_shop, v_parent from analytics.job j where j.id = new.job_id;
    if not found or v_shop is distinct from new.shop_id then
      raise exception 'ไม่พบใบงานในร้านนี้' using errcode = '22023', hint = 'job_not_found';
    end if;
    if v_parent is not null then
      raise exception 'ส่วนย่อยไม่มีรูปของตัวเอง — ใช้รูปของใบแม่' using errcode = '22023', hint = 'lot_no_photo';
    end if;
    if new.deleted_at is not null or new.deleted_by is not null or new.delete_reason is not null then
      raise exception 'สร้างรูปที่ลบแล้วไม่ได้' using errcode = '22023', hint = 'already_deleted';
    end if;
    -- 0189: รูป reference จากหน้างาน (มี worker) — ต้องมาจาก job_worker_photo_add เท่านั้น (GUC = id ของแถวนี้ ตั้งแบบ local ในทรานแซกชัน) + ไม่เกิน 3 รูป active ต่อใบ (กำแพงที่ DB)
    -- เปิดเฉพาะ reference+shopfloor+worker: ออฟฟิศ/แคตตาล็อก/kind stage/แถวที่ผิด CHECK ผ่านสายเดิมเป๊ะ (verify-0182 ยิง shopfloor ตรงเฉพาะ kind stage หรือไม่มี worker)
    if new.source = 'shopfloor' and new.kind = 'reference' and new.worker_id is not null then
      if current_setting('analytics.shop_photo_id', true) is distinct from new.id::text then
        raise exception 'รูปจากหน้างานเขียนได้เฉพาะทาง RPC ของช่าง' using errcode = '42501', hint = 'shopfloor_rpc_only';
      end if;
      -- L1: ล็อกต่อใบ (seed 2 — ตัวเดียวกับ job_photo_enforce_cap) ก่อนนับเพดาน · ลำดับล็อกคงที่ใบ(2) → ร้าน(3) → ช่าง(4) ตรงกับ trigger เพดานเดิม (ใบ → ร้าน) จึงไม่ deadlock
      perform pg_advisory_xact_lock(hashtextextended(new.job_id::text, 2));
      -- L2: นับเฉพาะ kind = 'reference' (ตรงกับ begin/add/list) — รูปผลงานต่อขั้น (kind stage · W2b) ไม่กินเพดาน 3 ของรูปสั่งงาน
      if (select count(*) from analytics.job_photo p where p.job_id = new.job_id and p.source = 'shopfloor' and p.kind = 'reference' and p.deleted_at is null) >= 3 then
        raise exception 'ใบงานนี้มีรูปจากหน้างานครบ 3 รูปแล้ว' using errcode = 'P0001', hint = 'photo_cap_shopfloor';
      end if;
      -- M1 (security 21 ต.ค.): โควตาหน้างาน — ค่ากำหนดอยู่ที่ analytics.job_shopfloor_photo_quota() ที่เดียว (ทีมตั้ง · แจ้งเจ้าของแล้ว · ปรับทีหลังได้)
      --   (ก) พื้นที่รวมรูป shopfloor ที่ยังไม่ลบต่อร้าน (md+sm) ≤ shop_bytes_max  (ข) ต่อช่าง ≤ worker_24h_max รูป/24 ชม. "นับรวมที่ลบแล้ว" (กันวน add/remove เผาพื้นที่/ถัง)
      perform pg_advisory_xact_lock(hashtextextended(new.shop_id::text, 3));
      if (select coalesce(sum(p.bytes), 0) from analytics.job_photo p where p.shop_id = new.shop_id and p.source = 'shopfloor' and p.deleted_at is null) + new.bytes
           > (analytics.job_shopfloor_photo_quota() ->> 'shop_bytes_max')::bigint then
        raise exception 'พื้นที่รูปจากหน้างานของร้านเต็มแล้ว' using errcode = 'P0003', hint = 'photo_budget_shopfloor';
      end if;
      perform pg_advisory_xact_lock(hashtextextended(new.worker_id::text, 4));
      if (select count(*) from analytics.job_photo p where p.worker_id = new.worker_id and p.source = 'shopfloor' and p.created_at > now() - interval '24 hours')
           >= (analytics.job_shopfloor_photo_quota() ->> 'worker_24h_max')::int then
        raise exception 'วันนี้แนบรูปจากหน้างานครบกำหนดแล้ว' using errcode = 'P0001', hint = 'photo_daily_cap';
      end if;
    end if;
  else
    -- UPDATE: แก้ได้เฉพาะ is_primary · sort_order · caption · deleted_at/by/reason · product_image_id เปลี่ยนได้ทางเดียวคือเป็น null (FK on delete set null ตอนแคตตาล็อกลบรูป)
    if (new.id, new.shop_id, new.job_id, new.kind, new.job_stage_id, new.source, new.storage_path, new.variant_sm_path, new.bytes, new.width, new.height, new.uploaded_by, new.worker_id, new.created_at, new.client_key)
       is distinct from
       (old.id, old.shop_id, old.job_id, old.kind, old.job_stage_id, old.source, old.storage_path, old.variant_sm_path, old.bytes, old.width, old.height, old.uploaded_by, old.worker_id, old.created_at, old.client_key) then
      raise exception 'analytics.job_photo: ฟิลด์ตัวตน/ไฟล์ของรูปแก้ไม่ได้ (อัปโหลดรูปใหม่แทน)' using errcode = '42501';
    end if;
    if new.product_image_id is distinct from old.product_image_id and new.product_image_id is not null then
      raise exception 'analytics.job_photo: product_image_id เปลี่ยนเป็นค่าอื่นไม่ได้' using errcode = '42501';
    end if;
    if old.deleted_at is not null then
      if (new.is_primary, new.sort_order, new.caption, new.deleted_at, new.deleted_by, new.delete_reason)
         is distinct from (old.is_primary, old.sort_order, old.caption, old.deleted_at, old.deleted_by, old.delete_reason) then
        raise exception 'รูปนี้ถูกลบไปแล้ว แก้ไม่ได้' using errcode = '22023', hint = 'already_deleted';
      end if;
      return new;
    end if;
  end if;

  -- caption/เหตุผลลบ: ต้องผ่าน job_text_clean แล้ว (ตัดช่องว่าง · ห้ามอักขระล่องหน/bidi/ขึ้นบรรทัด · ยาวไม่เกิน) — ค่าว่าง '' ไม่ผ่าน (ต้องเป็น null)
  if new.caption is not null and analytics.job_text_clean(new.caption, 'ป้ายรูป', 60, false) is distinct from new.caption then
    raise exception 'ป้ายรูปไม่ผ่านรูปแบบ (ต้องตัดช่องว่างหัวท้ายแล้ว)' using errcode = '22023', hint = 'caption_invalid';
  end if;
  if new.delete_reason is not null and analytics.job_text_clean(new.delete_reason, 'เหตุผลที่ลบรูป', 300, false) is distinct from new.delete_reason then
    raise exception 'เหตุผลที่ลบรูปไม่ผ่านรูปแบบ' using errcode = '22023', hint = 'reason_invalid';
  end if;
  return new;
end;
$f$;

-- ============================================================================
-- 2. helper ภายใน (ไม่ grant ใคร — เรียกจาก RPC definer ด้านล่างเท่านั้น)
-- ============================================================================

-- ด่านกลางของทางแนบรูป: ip → รูปแบบ hash → token ร้าน (ไม่พบ = ไม่เขียนถัง) → เพิกถอน → session ช่าง (ร้านเดียวกัน · active) → can_open_job สด → ถังต่อช่าง
-- p_bucket: write (begin/add/remove) | read (รูปของใบ) | list (รายการใบของฉัน — ไม่บังคับ can_open_job) · คืน {ok, shop_id, worker_id, can_open} หรือ job_fail
create or replace function analytics.shop_intake_photo_auth(p_token_hash text, p_session_hash text, p_ip_hash text, p_bucket text)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_tok analytics.shop_intake_token%rowtype;
  v_w   analytics.worker%rowtype;
begin
  if p_bucket is null or p_bucket not in ('write', 'read', 'list') then
    raise exception 'shop_intake_photo_auth: bucket ไม่ถูกต้อง' using errcode = '22023';
  end if;
  -- ต่อ IP ก่อน (เขียน = ถังเดียวกับเปิดใบ ipw: 300 · อ่าน = ipr: 240)
  if p_ip_hash is not null and p_ip_hash ~ '^[0-9a-f]{64}$' then
    if not analytics.job_rate_limit_hit(case p_bucket when 'write' then 'ipw:' else 'ipr:' end || left(p_ip_hash, 32), case p_bucket when 'write' then 300 else 240 end) then
      return analytics.job_fail('rate_limited', 'ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
    end if;
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return analytics.job_fail('invalid_token', 'QR ร้านนี้ใช้ไม่ได้แล้ว');
  end if;
  select * into v_tok from analytics.shop_intake_token t where t.token_hash = p_token_hash;
  -- ไม่พบ/ถูกเพิกถอน = ข้อความเดียวกัน และไม่เขียนถังใดๆ (กันตารางบวมจากการยิงสุ่ม)
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
  -- สิทธิ์ตรวจสดจาก DB ทุกครั้ง (ออฟฟิศถอนสิทธิ์หลังเปิดใบ = แนบ/ลบรูปไม่ได้ทันที)
  -- bucket 'list' (รายการใบของฉัน บน hub) ผ่านได้แม้ถูกถอนสิทธิ์ — ผู้เรียกคืนรายการว่างเอง (คืน can_open ให้) · bucket อื่นต้องมีสิทธิ์เสมอ
  if p_bucket <> 'list' and not v_w.can_open_job then
    return analytics.job_fail('not_allowed', 'บัญชีนี้ไม่มีสิทธิ์จัดการใบงานจากหน้างาน — แจ้งออฟฟิศ');
  end if;
  -- ถังต่อช่างนับ "หลัง" พบ session ที่มีสิทธิ์ — คนถือ QR ปลอม cookie เผาถังของผู้จัดการตัวจริงไม่ได้
  if not analytics.job_rate_limit_hit(case p_bucket when 'write' then 'wp:' else 'wpl:' end || v_w.id::text, case p_bucket when 'write' then 30 else 120 end) then
    return analytics.job_fail('rate_limited', 'ส่งถี่เกินไป — รอสักครู่แล้วลองใหม่');
  end if;
  return jsonb_build_object('ok', true, 'shop_id', v_tok.shop_id, 'worker_id', v_w.id, 'can_open', v_w.can_open_job);
end;
$f$;

-- ใบงานรากที่ "ช่างคนนี้เปิดเอง" (ร้านจาก token) อ้างได้ 2 ทาง "อย่างใดอย่างหนึ่งเท่านั้น": idem key ของการเปิดใบ (ตอนเพิ่งเปิดในเซสชันเดียวกัน) หรือ job_id (จากรายการ "ใบที่ฉันเปิด" บน hub)
-- ทั้งสองทางผ่านเงื่อนไขเดียวกัน: ใบผลิต opened_via='shopfloor' ∧ opened_by_worker_id = ช่างใน session ∧ ร้านเดียวกัน — job_id ของคนอื่น/ใบออฟฟิศ/ร้านอื่น/ส่วนย่อย ไม่ใช่เป้าหมายได้ (ไม่ใช่แค่ "รู้ uuid แล้วเข้าได้")
-- ไม่พบ/ของช่างอื่น/ใบออฟฟิศ/ส่งไม่ครบหรือเกินหนึ่งทาง = null (ผู้เรียกตอบ order_not_found เหมือนกันทุกกรณี)
create or replace function analytics.job_worker_photo_job(p_shop_id uuid, p_worker_id uuid, p_idem_key text, p_job_id uuid default null)
 returns uuid
 language sql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
  select j.id
    from analytics.production_order po
    join analytics.production_order_item i on i.production_order_id = po.id
    join analytics.job j on j.production_order_item_id = i.id
   where po.shop_id = p_shop_id
     and j.shop_id = p_shop_id
     and num_nonnulls(p_idem_key, p_job_id) = 1
     and (po.intake_idem_key = p_idem_key or j.id = p_job_id)
     and po.opened_by_worker_id = p_worker_id
     and po.opened_via = 'shopfloor'
     and j.parent_job_id is null
   order by (j.status = 'cancelled'), j.created_at desc, j.id
   limit 1
$f$;

-- ใบนี้ยังแนบ/ลบรูปได้ไหม: null = ได้ · ไม่ใช่ null = job_fail พร้อม code (job_cancelled · job_locked · job_not_open · order_not_found)
-- "ล็อก" = มีขั้นใด received/sent หรือสถานะ in_progress/done (ช่างเริ่มรับงานแล้ว) — เรียกหลังล็อกแถวใบ (for update) เพื่อให้ชนกับ "ช่างรับงาน" แล้วเห็นผลที่ commit แล้ว
create or replace function analytics.job_worker_photo_block(p_job_id uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job analytics.job%rowtype;
  v_po  text;
begin
  select * into v_job from analytics.job where id = p_job_id;
  if not found then
    return analytics.job_fail('order_not_found', 'ไม่พบใบงานที่เปิดด้วยรหัสนี้ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  select po.status into v_po
    from analytics.production_order_item i join analytics.production_order po on po.id = i.production_order_id
   where i.id = v_job.production_order_item_id;
  if v_job.status = 'cancelled' or v_po = 'cancelled' then
    return analytics.job_fail('job_cancelled', 'ใบนี้ถูกยกเลิกแล้ว — แนบหรือลบรูปไม่ได้');
  end if;
  if v_job.status in ('in_progress', 'done')
     or exists (select 1 from analytics.job_stage s where s.job_id = v_job.id and s.status in ('received', 'sent')) then
    return analytics.job_fail('job_locked', 'ช่างเริ่มรับงานแล้ว — เพิ่มหรือลบรูปไม่ได้ ถ้าต้องแก้ แจ้งออฟฟิศ');
  end if;
  if v_job.status <> 'open' then
    return analytics.job_fail('job_not_open', 'ใบนี้ไม่อยู่ในสถานะที่แนบรูปได้ — แจ้งออฟฟิศ');
  end if;
  return null;
end;
$f$;

-- ============================================================================
-- 3. RPC ช่าง (security definer · ไม่รับ p_shop_id — ร้านมาจาก token เท่านั้น)
-- ============================================================================

-- begin: ผ่านด่านทุกชั้น "ก่อนแตะ bucket" แล้วออก uuid ให้ server ใช้สร้าง path — ไม่เขียนข้อมูลใด (นอกจากนับถัง rate limit)
create or replace function analytics.job_worker_photo_begin(p_token_hash text, p_session_hash text, p_idem_key text, p_ip_hash text default null, p_job_id uuid default null, p_client_key uuid default null)
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
  v_block jsonb;
  v_sf    int;
  v_ref   int;
  v_bytes bigint;
  v_day   int;
  v_ex    analytics.job_photo%rowtype;
begin
  v_a := analytics.shop_intake_photo_auth(p_token_hash, p_session_hash, p_ip_hash, 'write');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_shop := (v_a ->> 'shop_id')::uuid;
  v_wid := (v_a ->> 'worker_id')::uuid;
  if num_nonnulls(p_idem_key, p_job_id) <> 1 or (p_idem_key is not null and p_idem_key !~ '^[A-Za-z0-9_-]{16,64}$') then
    return analytics.job_fail('idem_invalid', 'ข้อมูลไม่ครบ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  v_job := analytics.job_worker_photo_job(v_shop, v_wid, p_idem_key, p_job_id);
  if v_job is null then
    return analytics.job_fail('order_not_found', 'ไม่พบใบงานที่เปิดด้วยรหัสนี้ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  v_block := analytics.job_worker_photo_block(v_job);
  if v_block is not null then
    return v_block;
  end if;
  select count(*) filter (where p.source = 'shopfloor' and p.kind = 'reference'), count(*) filter (where p.kind = 'reference') into v_sf, v_ref
    from analytics.job_photo p where p.job_id = v_job and p.deleted_at is null;
  -- idempotency (clientPhotoKey): key เดิมของช่างคนเดิม = คืนรูปเดิม (already) — ก่อนเช็คเพดาน/โควตา (รูปเดิมถูกนับอยู่แล้ว ส่งซ้ำต้องสำเร็จ ไม่ใช่ติดเพดาน) · key ที่เคยใช้กับใบอื่น/รูปที่ลบแล้ว = photo_key_used
  if p_client_key is not null then
    select * into v_ex from analytics.job_photo p where p.worker_id = v_wid and p.client_key = p_client_key;
    if found then
      if v_ex.job_id <> v_job or v_ex.deleted_at is not null then
        return analytics.job_fail('photo_key_used', 'รูปนี้ถูกใช้ไปแล้ว — เลือกรูปใหม่');
      end if;
      return jsonb_build_object('ok', true, 'already', true, 'job_id', v_job, 'shop_id', v_shop, 'photo_id', v_ex.id, 'count', v_sf, 'max', 3);
    end if;
  end if;
  if v_sf >= 3 then
    return analytics.job_fail('photo_cap_shopfloor', 'แนบรูปจากหน้างานได้สูงสุด 3 รูปต่อใบ — ลบรูปเก่าก่อนเพิ่ม');
  end if;
  if v_ref >= 5 then
    return analytics.job_fail('photo_cap_ref', 'ใบนี้มีรูปอ้างอิงครบ 5 รูปแล้ว — แจ้งออฟฟิศ');
  end if;
  -- M1: โควตาหน้างาน เช็คก่อนแตะ bucket (ที่ begin ยังไม่รู้ขนาดไฟล์ → ปฏิเสธเมื่อเต็มแล้ว · ขอบละเอียดตัดที่ guard ตอน add) — ไม่ให้ object เกิดเมื่อโควตาเต็ม
  select coalesce(sum(p.bytes), 0) into v_bytes from analytics.job_photo p where p.shop_id = v_shop and p.source = 'shopfloor' and p.deleted_at is null;
  if v_bytes >= (analytics.job_shopfloor_photo_quota() ->> 'shop_bytes_max')::bigint then
    return analytics.job_fail('photo_budget_shopfloor', 'พื้นที่รูปจากหน้างานเต็มแล้ว — แจ้งออฟฟิศ');
  end if;
  select count(*) into v_day from analytics.job_photo p where p.worker_id = v_wid and p.source = 'shopfloor' and p.created_at > now() - interval '24 hours';
  if v_day >= (analytics.job_shopfloor_photo_quota() ->> 'worker_24h_max')::int then
    return analytics.job_fail('photo_daily_cap', 'วันนี้แนบรูปครบกำหนดแล้ว');
  end if;
  return jsonb_build_object('ok', true, 'job_id', v_job, 'shop_id', v_shop, 'photo_id', gen_random_uuid(), 'count', v_sf, 'max', 3);
end;
$f$;

-- add: ตรวจทุกด่านซ้ำ (สถานะอาจเปลี่ยนระหว่าง begin กับอัปโหลดไฟล์) ใต้ล็อกแถวใบ แล้วลงทะเบียนรูป (source = shopfloor · worker_id = ช่าง)
create or replace function analytics.job_worker_photo_add(
  p_token_hash text, p_session_hash text, p_idem_key text, p_photo_id uuid, p_storage_path text, p_variant_sm_path text,
  p_bytes integer, p_width integer default null, p_height integer default null, p_is_primary boolean default false,
  p_user_agent text default null, p_ip_hash text default null, p_job_id uuid default null, p_client_key uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a       jsonb;
  v_shop    uuid;
  v_wid     uuid;
  v_job_id  uuid;
  v_job     analytics.job%rowtype;
  v_ex      analytics.job_photo%rowtype;
  v_exn     int;
  v_block   jsonb;
  v_prefix  text;
  v_sf      int;
  v_ref     int;
  v_sort    int;
  v_prim_id uuid;
  v_prim_src text;
  v_primary boolean;
  v_con     text;
  v_hint    text;
begin
  v_a := analytics.shop_intake_photo_auth(p_token_hash, p_session_hash, p_ip_hash, 'write');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_shop := (v_a ->> 'shop_id')::uuid;
  v_wid := (v_a ->> 'worker_id')::uuid;
  -- รูปแบบค่า (ไม่แตะข้อมูล) · ตัวเลขใช้ not(between) กัน null/NaN (ข้อ 4)
  if num_nonnulls(p_idem_key, p_job_id) <> 1 or (p_idem_key is not null and p_idem_key !~ '^[A-Za-z0-9_-]{16,64}$') then
    return analytics.job_fail('idem_invalid', 'ข้อมูลไม่ครบ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  if p_photo_id is null or p_storage_path is null or p_variant_sm_path is null then
    return analytics.job_fail('photo_path_invalid', 'บันทึกรูปไม่สำเร็จ ลองใหม่อีกครั้ง');
  end if;
  if p_bytes is null or not (p_bytes between 1 and 2097152) then
    return analytics.job_fail('photo_bytes_invalid', 'ไฟล์รูปไม่ถูกต้อง (ใหญ่เกินกำหนดหรือว่างเปล่า)');
  end if;
  if (p_width is not null and not (p_width between 1 and 100000)) or (p_height is not null and not (p_height between 1 and 100000)) then
    return analytics.job_fail('photo_dims_invalid', 'ขนาดภาพไม่ถูกต้อง ลองถ่ายรูปใหม่');
  end if;
  v_job_id := analytics.job_worker_photo_job(v_shop, v_wid, p_idem_key, p_job_id);
  if v_job_id is null then
    return analytics.job_fail('order_not_found', 'ไม่พบใบงานที่เปิดด้วยรหัสนี้ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  -- ล็อกแถวใบ: ชนกับ "ช่างรับงาน" (job_worker_auth / job_office_begin ล็อกแถวเดียวกัน) แล้วอ่านสถานะที่ commit แล้ว · ลำดับล็อกเดียวกับฝั่งออฟฟิศ (ใบ → trigger เพดาน)
  select * into v_job from analytics.job where id = v_job_id and shop_id = v_shop for update;
  if not found then
    return analytics.job_fail('order_not_found', 'ไม่พบใบงานที่เปิดด้วยรหัสนี้ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  v_block := analytics.job_worker_photo_block(v_job_id);
  if v_block is not null then
    return v_block;
  end if;
  -- idempotency (clientPhotoKey): ใต้ล็อกแถวใบแล้ว (ส่งซ้ำพร้อมกัน 2 คำขอเรียงคิวที่นี่) — key เดิมของช่างคนเดิมในใบเดียวกัน = คืนรูปเดิม ไม่ INSERT ซ้ำ (server ลบ object ที่เพิ่งอัปซ้ำ) · key ที่เคยใช้กับใบอื่น/รูปที่ลบแล้ว = photo_key_used
  if p_client_key is not null then
    select * into v_ex from analytics.job_photo p where p.worker_id = v_wid and p.client_key = p_client_key;
    if found then
      if v_ex.job_id <> v_job_id or v_ex.deleted_at is not null then
        return analytics.job_fail('photo_key_used', 'รูปนี้ถูกใช้ไปแล้ว — เลือกรูปใหม่');
      end if;
      select count(*) into v_exn from analytics.job_photo p where p.job_id = v_job_id and p.source = 'shopfloor' and p.kind = 'reference' and p.deleted_at is null;
      return jsonb_build_object('ok', true, 'already', true, 'photo_id', v_ex.id, 'is_primary', v_ex.is_primary, 'count', v_exn, 'max', 3);
    end if;
  end if;
  -- path ต้องตรง <shop>/<job>/<photo_id>_md.jpg|_sm.jpg เป๊ะ (uuid พิมพ์เล็ก — shop/job จาก DB ไม่ใช่ client)
  v_prefix := v_shop::text || '/' || v_job_id::text || '/' || p_photo_id::text;
  if p_storage_path is distinct from v_prefix || '_md.jpg' or p_variant_sm_path is distinct from v_prefix || '_sm.jpg' then
    return analytics.job_fail('photo_path_invalid', 'บันทึกรูปไม่สำเร็จ ลองใหม่อีกครั้ง');
  end if;
  select count(*) filter (where p.source = 'shopfloor' and p.kind = 'reference'), count(*) filter (where p.kind = 'reference') into v_sf, v_ref
    from analytics.job_photo p where p.job_id = v_job_id and p.deleted_at is null;
  if v_sf >= 3 then
    return analytics.job_fail('photo_cap_shopfloor', 'แนบรูปจากหน้างานได้สูงสุด 3 รูปต่อใบ — ลบรูปเก่าก่อนเพิ่ม');
  end if;
  if v_ref >= 5 then
    return analytics.job_fail('photo_cap_ref', 'ใบนี้มีรูปอ้างอิงครบ 5 รูปแล้ว — แจ้งออฟฟิศ');
  end if;

  select p.id, p.source into v_prim_id, v_prim_src from analytics.job_photo p where p.job_id = v_job_id and p.is_primary and p.deleted_at is null;
  v_primary := v_prim_id is null;
  select coalesce(max(p.sort_order) + 1, 0) into v_sort from analytics.job_photo p where p.job_id = v_job_id and p.deleted_at is null;
  begin
    -- สลับรูปหลัก: ขอเป็นหลักได้เมื่อรูปหลักเดิมเป็นของหน้างานเอง (ไม่ล้มรูปหลักที่ออฟฟิศ/แคตตาล็อกตั้งไว้) · อยู่ใน sub-block เดียวกับ INSERT — insert ล้ม = ถอยสลับด้วย
    if not v_primary and coalesce(p_is_primary, false) and v_prim_src = 'shopfloor' then
      update analytics.job_photo set is_primary = false where id = v_prim_id;
      v_primary := true;
    end if;
    perform set_config('analytics.shop_photo_id', p_photo_id::text, true);
    insert into analytics.job_photo (id, shop_id, job_id, kind, source, storage_path, variant_sm_path, bytes, width, height, is_primary, sort_order, worker_id, client_key)
    values (p_photo_id, v_shop, v_job_id, 'reference', 'shopfloor', p_storage_path, p_variant_sm_path, p_bytes, p_width, p_height, v_primary, v_sort, v_wid, p_client_key);
  exception
    when unique_violation then
      get stacked diagnostics v_con = constraint_name;
      if v_con = 'job_photo_one_primary_uq' then
        return analytics.job_fail('photo_conflict', 'รูปหลักของใบเปลี่ยนไปพร้อมกัน — ลองอีกครั้ง');
      end if;
      if v_con = 'uq_job_photo_client_key' then
        return analytics.job_fail('photo_key_used', 'รูปนี้ถูกใช้ไปแล้ว — เลือกรูปใหม่');
      end if;
      return analytics.job_fail('photo_path_dup', 'รูปนี้ถูกบันทึกไปแล้ว — โหลดหน้าใหม่');
    when sqlstate 'P0001' or sqlstate 'P0002' or sqlstate 'P0003' then
      get stacked diagnostics v_hint = pg_exception_hint;
      if v_hint = 'photo_cap_shopfloor' then
        return analytics.job_fail('photo_cap_shopfloor', 'แนบรูปจากหน้างานได้สูงสุด 3 รูปต่อใบ — ลบรูปเก่าก่อนเพิ่ม');
      elsif v_hint = 'photo_cap_ref' then
        return analytics.job_fail('photo_cap_ref', 'ใบนี้มีรูปอ้างอิงครบ 5 รูปแล้ว — แจ้งออฟฟิศ');
      elsif v_hint = 'photo_cap_total' then
        return analytics.job_fail('photo_cap_total', 'ใบนี้มีรูปครบกำหนดแล้ว — แจ้งออฟฟิศ');
      elsif v_hint = 'photo_budget' then
        return analytics.job_fail('photo_budget', 'พื้นที่เก็บรูปของร้านเต็มแล้ว — แจ้งออฟฟิศ');
      elsif v_hint = 'photo_budget_shopfloor' then
        return analytics.job_fail('photo_budget_shopfloor', 'พื้นที่รูปจากหน้างานเต็มแล้ว — แจ้งออฟฟิศ');
      elsif v_hint = 'photo_daily_cap' then
        return analytics.job_fail('photo_daily_cap', 'วันนี้แนบรูปครบกำหนดแล้ว');
      end if;
      raise;
  end;
  perform set_config('analytics.shop_photo_id', '', true);
  perform analytics.job_event_write(v_job_id, null, 'photo_add', analytics.job_today(), null, v_wid, 'worker_qr', analytics.job_device_hint(p_user_agent, p_ip_hash),
    jsonb_build_object('photo_id', p_photo_id, 'kind', 'reference', 'source', 'shopfloor', 'bytes', p_bytes, 'is_primary', v_primary));
  return jsonb_build_object('ok', true, 'photo_id', p_photo_id, 'is_primary', v_primary, 'count', v_sf + 1, 'max', 3);
end;
$f$;

-- remove: ลบรูป "ของตัวเอง" (worker_id = ช่างใน session · source shopfloor · reference) จนกว่าช่างจะเริ่มรับงาน · soft delete + path คืนให้ server ลบ object (ไม่ถึง client)
create or replace function analytics.job_worker_photo_remove(p_token_hash text, p_session_hash text, p_photo_id uuid, p_user_agent text default null, p_ip_hash text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a      jsonb;
  v_shop   uuid;
  v_wid    uuid;
  v_job_id uuid;
  v_job    analytics.job%rowtype;
  v_block  jsonb;
  v_ph     analytics.job_photo%rowtype;
  v_next   uuid;
begin
  v_a := analytics.shop_intake_photo_auth(p_token_hash, p_session_hash, p_ip_hash, 'write');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_shop := (v_a ->> 'shop_id')::uuid;
  v_wid := (v_a ->> 'worker_id')::uuid;
  if p_photo_id is null then
    return analytics.job_fail('photo_not_found', 'ไม่พบรูปนี้ — โหลดหน้าใหม่');
  end if;
  -- ของคนอื่น/ของออฟฟิศ/รูปแคตตาล็อก/ร้านอื่น/ไม่มีจริง = ข้อความเดียวกัน (ไม่บอกว่ามีรูปนั้นอยู่)
  select ph.job_id into v_job_id from analytics.job_photo ph
   where ph.id = p_photo_id and ph.shop_id = v_shop and ph.worker_id = v_wid and ph.source = 'shopfloor' and ph.kind = 'reference';
  if v_job_id is null then
    return analytics.job_fail('photo_not_found', 'ไม่พบรูปนี้ — โหลดหน้าใหม่');
  end if;
  select * into v_job from analytics.job where id = v_job_id and shop_id = v_shop for update;
  if not found then
    return analytics.job_fail('photo_not_found', 'ไม่พบรูปนี้ — โหลดหน้าใหม่');
  end if;
  v_block := analytics.job_worker_photo_block(v_job_id);
  if v_block is not null then
    return v_block;
  end if;
  select * into v_ph from analytics.job_photo where id = p_photo_id for update;
  if v_ph.deleted_at is not null then
    return analytics.job_fail('already_deleted', 'รูปนี้ถูกลบไปแล้ว — โหลดหน้าใหม่');
  end if;
  update analytics.job_photo set deleted_at = now(), deleted_by = v_wid, is_primary = false where id = p_photo_id;
  -- ลบรูปหลัก ⇒ เลื่อนรูป reference active ถัดไปขึ้นเป็นหลัก (ใบที่ยังมีรูปต้องมีรูปหลักเสมอ — เหมือน job_photo_remove)
  if v_ph.is_primary then
    select p.id into v_next from analytics.job_photo p
     where p.job_id = v_job_id and p.deleted_at is null and p.kind = 'reference' order by p.sort_order, p.created_at, p.id limit 1;
    if v_next is not null then
      update analytics.job_photo set is_primary = true where id = v_next;
    end if;
  end if;
  perform analytics.job_event_write(v_job_id, null, 'photo_remove', analytics.job_today(), null, v_wid, 'worker_qr', analytics.job_device_hint(p_user_agent, p_ip_hash),
    jsonb_build_object('photo_id', p_photo_id, 'source', 'shopfloor'));
  return jsonb_build_object('ok', true, 'storage_path', v_ph.storage_path, 'variant_sm_path', v_ph.variant_sm_path, 'promoted_photo_id', v_next);
end;
$f$;

-- set_primary: ผู้จัดการตั้ง "รูปหลัก" หลังอัปโหลดแล้ว (มติ 21 ต.ค.) — ด่านเดียวกับ remove (รูปของตัวเอง · ใบของตัวเอง · ยังไม่มีขั้นถูกรับ) + อ้างใบด้วย idem key หรือ job_id (ต้องเป็นใบเดียวกับรูป)
-- สลับได้เฉพาะเมื่อ "รูปหลักปัจจุบันเป็นรูปหน้างาน หรือใบยังไม่มีรูปหลัก" — ไม่ล้มรูปหลักที่ออฟฟิศ/แคตตาล็อกตั้งไว้ (มติ A7 เดิม) → primary_locked · เป็นหลักอยู่แล้ว = ok (ไม่ใช่ error · ไม่มี event)
create or replace function analytics.job_worker_photo_set_primary(p_token_hash text, p_session_hash text, p_photo_id uuid, p_ip_hash text default null, p_idem_key text default null, p_job_id uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a        jsonb;
  v_shop     uuid;
  v_wid      uuid;
  v_job_id   uuid;
  v_job      analytics.job%rowtype;
  v_block    jsonb;
  v_ph       analytics.job_photo%rowtype;
  v_prim_id  uuid;
  v_prim_src text;
begin
  v_a := analytics.shop_intake_photo_auth(p_token_hash, p_session_hash, p_ip_hash, 'write');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_shop := (v_a ->> 'shop_id')::uuid;
  v_wid := (v_a ->> 'worker_id')::uuid;
  if num_nonnulls(p_idem_key, p_job_id) <> 1 or (p_idem_key is not null and p_idem_key !~ '^[A-Za-z0-9_-]{16,64}$') then
    return analytics.job_fail('idem_invalid', 'ข้อมูลไม่ครบ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  if p_photo_id is null then
    return analytics.job_fail('photo_not_found', 'ไม่พบรูปนี้ — โหลดหน้าใหม่');
  end if;
  v_job_id := analytics.job_worker_photo_job(v_shop, v_wid, p_idem_key, p_job_id);
  if v_job_id is null then
    return analytics.job_fail('order_not_found', 'ไม่พบใบงานที่เปิดด้วยรหัสนี้ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  -- ของคนอื่น/ของออฟฟิศ/รูปแคตตาล็อก/อยู่คนละใบ/ไม่มีจริง = ข้อความเดียวกัน
  if not exists (select 1 from analytics.job_photo ph
                  where ph.id = p_photo_id and ph.job_id = v_job_id and ph.shop_id = v_shop and ph.worker_id = v_wid and ph.source = 'shopfloor' and ph.kind = 'reference') then
    return analytics.job_fail('photo_not_found', 'ไม่พบรูปนี้ — โหลดหน้าใหม่');
  end if;
  select * into v_job from analytics.job where id = v_job_id and shop_id = v_shop for update;
  if not found then
    return analytics.job_fail('photo_not_found', 'ไม่พบรูปนี้ — โหลดหน้าใหม่');
  end if;
  v_block := analytics.job_worker_photo_block(v_job_id);
  if v_block is not null then
    return v_block;
  end if;
  select * into v_ph from analytics.job_photo where id = p_photo_id for update;
  if v_ph.deleted_at is not null then
    return analytics.job_fail('already_deleted', 'รูปนี้ถูกลบไปแล้ว — โหลดหน้าใหม่');
  end if;
  if v_ph.is_primary then
    return jsonb_build_object('ok', true, 'photo_id', p_photo_id, 'is_primary', true, 'changed', false);
  end if;
  select p.id, p.source into v_prim_id, v_prim_src from analytics.job_photo p where p.job_id = v_job_id and p.is_primary and p.deleted_at is null;
  if v_prim_id is not null and v_prim_src <> 'shopfloor' then
    return analytics.job_fail('primary_locked', 'รูปหลักตั้งโดยออฟฟิศแล้ว — เปลี่ยนไม่ได้ ถ้าต้องแก้ แจ้งออฟฟิศ');
  end if;
  -- ล้างตัวเก่าก่อนตั้งตัวใหม่ (partial unique index ตรวจทันทีทุกคำสั่ง)
  if v_prim_id is not null then
    update analytics.job_photo set is_primary = false where id = v_prim_id;
  end if;
  update analytics.job_photo set is_primary = true where id = p_photo_id;
  perform analytics.job_event_write(v_job_id, null, 'photo_primary', analytics.job_today(), null, v_wid, 'worker_qr', null,
    jsonb_build_object('photo_id', p_photo_id, 'previous_photo_id', v_prim_id));
  return jsonb_build_object('ok', true, 'photo_id', p_photo_id, 'is_primary', true, 'changed', true);
end;
$f$;

-- list: รูป active ของใบที่ช่างคนนี้เปิดเอง (ให้หน้าจอรู้ว่าแนบไปแล้วกี่รูป/รูปไหนลบได้) — path ให้ server เซ็น URL แล้วทิ้ง (ไม่ถึง client)
create or replace function analytics.job_worker_photo_list(p_token_hash text, p_session_hash text, p_idem_key text, p_ip_hash text default null, p_job_id uuid default null)
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
  v_block  jsonb;
  v_photos jsonb;
  v_sf     int;
begin
  v_a := analytics.shop_intake_photo_auth(p_token_hash, p_session_hash, p_ip_hash, 'read');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_shop := (v_a ->> 'shop_id')::uuid;
  v_wid := (v_a ->> 'worker_id')::uuid;
  if num_nonnulls(p_idem_key, p_job_id) <> 1 or (p_idem_key is not null and p_idem_key !~ '^[A-Za-z0-9_-]{16,64}$') then
    return analytics.job_fail('idem_invalid', 'ข้อมูลไม่ครบ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  v_job := analytics.job_worker_photo_job(v_shop, v_wid, p_idem_key, p_job_id);
  if v_job is null then
    return analytics.job_fail('order_not_found', 'ไม่พบใบงานที่เปิดด้วยรหัสนี้ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  v_block := analytics.job_worker_photo_block(v_job);
  select jsonb_agg(jsonb_build_object('id', p.id, 'sm_path', p.variant_sm_path, 'md_path', p.storage_path, 'is_primary', p.is_primary,
                                      'mine', p.source = 'shopfloor' and p.worker_id = v_wid)
                   order by p.is_primary desc, p.sort_order, p.created_at, p.id),
         count(*) filter (where p.source = 'shopfloor' and p.kind = 'reference')
    into v_photos, v_sf
    from analytics.job_photo p where p.job_id = v_job and p.deleted_at is null and p.kind = 'reference';
  return jsonb_build_object('ok', true, 'locked', v_block is not null, 'lock_code', v_block ->> 'code',
                            'count', coalesce(v_sf, 0), 'max', 3, 'photos', coalesce(v_photos, '[]'::jsonb));
end;
$f$;

-- my_intake_list: "ใบที่ฉันเปิด" บน hub QR ร้าน (มติ 21 ต.ค.) — เฉพาะใบที่ช่างคนนี้เปิดเอง (ใบผลิต opened_via=shopfloor ∧ opened_by_worker_id = ช่างใน session) ที่ยังไม่ปิด/ไม่ยกเลิก · ล่าสุดก่อน · ≤ 20 ใบ · ภายใน 14 วัน (ทีมตั้ง)
-- ไม่มีเงิน/ต้นทุน/น้ำหนักทอง (มีแค่เลขใบ ชื่อแบบ วัสดุ จำนวนสั่ง สถานะ จำนวนรูป) · ใบของคนอื่น/ใบออฟฟิศ/ร้านอื่นไม่เข้าเงื่อนไขเลย · ถูกถอน can_open_job = รายการว่าง (ไม่ใช่ error — hub ไม่ต้องแสดงข้อผิดพลาด)
-- editable = ผ่าน job_worker_photo_block (ยังไม่มีขั้น received/sent · สถานะ open) — ตัดสินที่เดียวกับ begin/add/remove
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
               'editable', analytics.job_worker_photo_block(j.id) is null) as o
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

-- token_reissue: "ออก QR ใหม่" ของใบที่ฉันเปิดเอง (มติ 21 ต.ค.) — ใช้ job_token_issue_core (0187) ด้วย p_worker_id (issued_by_worker_id) · ได้แม้ช่างรับงานแล้ว ตราบใดที่ใบยังไม่ปิด/ไม่ยกเลิก
-- ด่าน: token ร้าน + session + can_open_job สด + ใบที่ช่างคนนี้เปิดเอง (job_id อ้างผ่าน helper เดียวกับรูป — ของคนอื่น/ใบออฟฟิศ/ร้านอื่น/ส่วนย่อย = order_not_found) + ใบ/ใบผลิตไม่ done/cancelled + เพดาน 5 QR ที่ใช้อยู่ต่อใบ (core: token_cap)
-- rate limit: ถัง wp: (ร่วมกับรูป) + ถังเฉพาะออก QR wt:<ช่าง> 10/10 นาที (นับหลังพบ session ที่มีสิทธิ์ · ก่อนแตะข้อมูล)
-- ตัดสินเอง: ไม่เพิกถอน QR เดิม (p_revoke_previous = false) — QR เดิมที่ติดที่ชิ้นงานต้องยังใช้ได้ · เพดาน 5 ใบจึงมีความหมาย (เกิน = token_cap · ออฟฟิศเพิกถอนที่ /jobs/[id]) · ถ้าเจ้าของอยากให้ "ออกใหม่ = เก่าใช้ไม่ได้" เปลี่ยนเป็น true จุดเดียว
-- คืน raw token ครั้งเดียว (UI วาด QR · ห้าม log/เก็บ) — DB เก็บ sha256 เท่านั้น · event token_issue เขียนโดย core (actor null · worker_id = ช่าง · channel worker_qr)
create or replace function analytics.job_worker_token_reissue(p_token_hash text, p_session_hash text, p_job_id uuid, p_ip_hash text default null, p_idem_key text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a      jsonb;
  v_shop   uuid;
  v_wid    uuid;
  v_job_id uuid;
  v_job    analytics.job%rowtype;
  v_po     text;
  v_res    jsonb;
  v_hint   text;
  v_rk     text;
  v_win    timestamptz := to_timestamp(floor(extract(epoch from now()) / 600) * 600);
begin
  v_a := analytics.shop_intake_photo_auth(p_token_hash, p_session_hash, p_ip_hash, 'write');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_shop := (v_a ->> 'shop_id')::uuid;
  v_wid := (v_a ->> 'worker_id')::uuid;
  if not analytics.job_rate_limit_hit('wt:' || v_wid::text, 10) then
    return analytics.job_fail('rate_limited', 'ส่งถี่เกินไป — รอสักครู่แล้วลองใหม่');
  end if;
  if p_idem_key is not null and p_idem_key !~ '^[A-Za-z0-9_-]{16,64}$' then
    return analytics.job_fail('idem_invalid', 'ข้อมูลไม่ครบ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  v_job_id := analytics.job_worker_photo_job(v_shop, v_wid, null, p_job_id);
  if v_job_id is null then
    return analytics.job_fail('order_not_found', 'ไม่พบใบงานที่เปิดไว้ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  select * into v_job from analytics.job where id = v_job_id and shop_id = v_shop for update;
  if not found then
    return analytics.job_fail('order_not_found', 'ไม่พบใบงานที่เปิดไว้ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  end if;
  select po.status into v_po
    from analytics.production_order_item i join analytics.production_order po on po.id = i.production_order_id
   where i.id = v_job.production_order_item_id;
  if v_job.status = 'cancelled' or v_po = 'cancelled' then
    return analytics.job_fail('job_cancelled', 'ใบนี้ถูกยกเลิกแล้ว — ออก QR ใหม่ไม่ได้');
  end if;
  if v_job.status = 'done' or v_po is distinct from 'open' then
    return analytics.job_fail('job_closed', 'ใบนี้ปิดแล้ว — ออก QR ใหม่ไม่ได้');
  end if;
  -- idempotency (p_idem_key): key เดิมของช่างคนเดิมกับใบนี้ภายใน 10–20 นาที (หน้าต่างปัจจุบัน + ก่อนหน้า) = ไม่ออกใหม่ → already
  --   🔴 ไม่เก็บ raw token (DB เก็บ sha256 เท่านั้น) จึงส่ง token เดิมซ้ำไม่ได้ — ตอบ already:true ให้หน้าจอบอก "ออกไปแล้ว ถ้าไม่เห็น QR ให้กดออกใหม่อีกครั้ง (key ใหม่)"
  --   ร่องรอยการเคยออก = แถว ri: ใน worker_rate_limit (key = ช่าง + hash ของ (idem:job) 24 ตัว — ไม่มีค่าดิบ) · เขียนเฉพาะหลังออกสำเร็จ (ล้ม/ติดเพดาน = ไม่เผา key · ลองซ้ำด้วย key เดิมได้)
  if p_idem_key is not null then
    v_rk := 'ri:' || v_wid::text || ':' || left(analytics.job_sha256_hex(p_idem_key || ':' || v_job_id::text), 24);
    if exists (select 1 from analytics.worker_rate_limit r where r.key = v_rk and r.window_start >= v_win - interval '10 minutes') then
      return jsonb_build_object('ok', true, 'already', true, 'job_no', v_job.job_no, 'job_id', v_job.id);
    end if;
  end if;
  begin
    v_res := analytics.job_token_issue_core(v_job, false, null, v_wid, 'traveler', null);
  exception when sqlstate '22023' then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint = 'token_cap' then
      return analytics.job_fail('token_cap', 'ใบนี้มี QR ที่ใช้งานอยู่ครบ 5 ใบแล้ว — แจ้งออฟฟิศให้เพิกถอนก่อน');
    end if;
    return analytics.job_fail('token_not_issued', 'ออก QR ไม่ได้ตอนนี้ — แจ้งออฟฟิศ');
  end;
  if v_rk is not null then
    insert into analytics.worker_rate_limit (key, window_start, hits) values (v_rk, v_win, 1) on conflict (key, window_start) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'token', v_res ->> 'token', 'print_no', (v_res ->> 'print_no')::int, 'job_no', v_job.job_no, 'job_id', v_job.id);
end;
$f$;

-- ============================================================================
-- 3.5 job_photo_remove (ออฟฟิศ · replace · signature เดิม) — ลอกเนื้อจาก 0182 (ไม่มี migration ไหนแก้ต่อ · dry-run ยืนยัน md5 ของ def สดเท่ากับ 0182 ก่อนทับ) + เพิ่มเฉพาะ: ลบรูป source='shopfloor' ต้องมีเหตุผล (ผู้จัดการแนบมาเอง — ออฟฟิศลบต้องบอกเหตุผล · มติ 21 ต.ค.)
--   reason ว่าง/สั้นกว่า 2 ตัวอักษร/ไม่มีตัวอักษรหรือตัวเลขจริง → 22023 hint reason_required (ก่อน UPDATE — แถวไม่ขยับ) · รูปออฟฟิศ/แคตตาล็อก = พฤติกรรมเดิมเป๊ะ (เหตุผลไม่บังคับ)
-- ============================================================================
create or replace function analytics.job_photo_remove(p_shop_id uuid, p_photo_id uuid, p_reason text default null, p_actor uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor  uuid := coalesce(p_actor, auth.uid());
  v_job_id uuid;
  v_ph     analytics.job_photo%rowtype;
  v_reason text;
  v_next   uuid;
begin
  if p_shop_id is null or p_photo_id is null then
    raise exception 'job_photo_remove: p_shop_id และ p_photo_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  select ph.job_id into v_job_id from analytics.job_photo ph where ph.id = p_photo_id and ph.shop_id = p_shop_id;
  if v_job_id is null then
    raise exception 'ไม่พบรูปนี้ในร้านนี้' using errcode = '22023', hint = 'photo_not_found';
  end if;
  perform analytics.job_office_begin('job_photo_remove', p_shop_id, v_job_id, v_actor, true);
  select * into v_ph from analytics.job_photo where id = p_photo_id for update;
  if v_ph.deleted_at is not null then
    raise exception 'รูปนี้ถูกลบไปแล้ว' using errcode = '22023', hint = 'already_deleted';
  end if;
  v_reason := analytics.job_text_clean(p_reason, 'เหตุผลที่ลบรูป', 300, false);
  -- 0189: รูปที่ผู้จัดการแนบจากหน้างาน — ออฟฟิศลบต้องมีเหตุผลที่มีตัวอักษร/ตัวเลขจริง ≥ 2 ตัว (whitelist ตามข้อ 6.2 ของ oem-invariants: ห้าม blacklist)
  if v_ph.source = 'shopfloor' and (v_reason is null or length(v_reason) < 2 or not analytics.oem_note_present(v_reason)) then
    raise exception 'ลบรูปที่ผู้จัดการแนบจากหน้างานต้องระบุเหตุผล (อย่างน้อย 2 ตัวอักษร)' using errcode = '22023', hint = 'reason_required';
  end if;
  update analytics.job_photo set deleted_at = now(), deleted_by = v_actor, delete_reason = v_reason, is_primary = false where id = p_photo_id;
  -- ลบรูปหลัก ⇒ เลื่อนรูป active ถัดไปขึ้นเป็นหลัก (ใบที่ยังมีรูปต้องมีรูปหลักเสมอ)
  if v_ph.is_primary then
    select p.id into v_next from analytics.job_photo p
     where p.job_id = v_ph.job_id and p.deleted_at is null and p.kind = 'reference' order by p.sort_order, p.created_at, p.id limit 1;
    if v_next is not null then
      update analytics.job_photo set is_primary = true where id = v_next;
    end if;
  end if;
  perform analytics.job_event_write(v_ph.job_id, null, 'photo_remove', analytics.job_today(), v_actor, null, 'job_page', null,
    jsonb_build_object('photo_id', p_photo_id, 'reason', v_reason));
  -- path ส่งกลับให้ server ลบ object ใน bucket (ไปถึง client ไม่ได้ — server action ไม่ส่งต่อ)
  return jsonb_build_object('ok', true, 'storage_path', v_ph.storage_path, 'variant_sm_path', v_ph.variant_sm_path, 'promoted_photo_id', v_next);
end;
$f$;

-- ============================================================================
-- 4. สิทธิ์ (ข้อ 2 · 18.1): ถอนทั้ง 4 ชื่อ แล้ว grant เฉพาะ RPC ช่างให้ service_role — helper/trigger function ไม่ให้ใคร
-- ============================================================================
do $g$
declare
  r record;
  v_touched constant text[] := array[
    'job_photo_guard', 'job_shopfloor_photo_quota', 'shop_intake_photo_auth', 'job_worker_photo_job', 'job_worker_photo_block',
    'job_worker_photo_begin', 'job_worker_photo_add', 'job_worker_photo_remove', 'job_worker_photo_list', 'job_worker_my_intake_list', 'job_worker_token_reissue', 'job_worker_photo_set_primary', 'job_photo_remove'];
  v_rpc constant text[] := array['job_worker_photo_begin', 'job_worker_photo_add', 'job_worker_photo_remove', 'job_worker_photo_list', 'job_worker_my_intake_list', 'job_worker_token_reissue', 'job_worker_photo_set_primary', 'job_photo_remove'];
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
  -- ห้ามมี overload (migration-traps ข้อ 1): ต้องได้ "หนึ่งแถวต่อชื่อ" พอดีทุกชื่อที่ประกาศ (ตรวจแคบเฉพาะชื่อของไฟล์นี้ — ไม่กวาดทั้งตระกูลชื่อ กัน overload เก่าที่ไม่เกี่ยวมาบล็อก)
  select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = any (v_touched);
  if v_n <> cardinality(v_touched) then
    raise exception '0189: ฟังก์ชันที่ประกาศ % ตัว แต่พบใน pg_proc % ตัว', cardinality(v_touched), v_n;
  end if;
end;
$g$;

-- ============================================================================
-- 5. post-check: ไม่แตะของเดิมนอกรายการ · ข้อมูลเดิมไม่ขยับ · trigger/bucket/สิทธิ์เท่าเดิม
-- ============================================================================
do $c$
declare
  v_changed text;
  v_new text;
  v_touched constant text[] := array['job_photo_guard', 'job_photo_remove'];
  v_added constant text[] := array['job_worker_photo_set_primary', 'job_shopfloor_photo_quota', 'shop_intake_photo_auth', 'job_worker_photo_job', 'job_worker_photo_block', 'job_worker_photo_begin', 'job_worker_photo_add', 'job_worker_photo_remove', 'job_worker_photo_list', 'job_worker_my_intake_list', 'job_worker_token_reissue'];
begin
  -- (1) ฟังก์ชันเดิมนอกรายการ md5 ต้องเท่าเดิมเป๊ะ (ทุกตัวในสคีมา — รวม job_photo_enforce_cap · job_photo_add · job_worker_resolve · production_order_done)
  select string_agg(b.sig, ', ') into v_changed
    from _m189_fn_base b
    left join pg_proc p on p.oid = to_regprocedure(b.sig)
   where b.proname <> all (v_touched) and (p.oid is null or md5(pg_get_functiondef(p.oid)) <> b.h);
  if v_changed is not null then
    raise exception '0189 แตะฟังก์ชันเดิมนอกรายการ (md5 ไม่เท่า/หาย): %', v_changed;
  end if;
  -- (2) job_photo_guard เปลี่ยนจริง (มีเครื่องหมาย 0189) · ฟังก์ชันใหม่ = รายการที่ประกาศเท่านั้น
  if not exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_photo_guard'
                    and position('shop_photo_id' in pg_get_functiondef(p.oid)) > 0 and position('photo_cap_shopfloor' in pg_get_functiondef(p.oid)) > 0
                    and position('photo_budget_shopfloor' in pg_get_functiondef(p.oid)) > 0 and position('photo_daily_cap' in pg_get_functiondef(p.oid)) > 0) then
    raise exception '0189: job_photo_guard ยังไม่ใช่ฉบับ 0189';
  end if;
  if not exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_photo_remove' and position('reason_required' in pg_get_functiondef(p.oid)) > 0) then
    raise exception '0189: job_photo_remove ยังไม่ใช่ฉบับ 0189';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_new
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
     and not exists (select 1 from _m189_fn_base b where b.sig = p.oid::regprocedure::text)
     and not (p.proname = any (v_added) or p.proname = any (v_touched));
  if v_new is not null then
    raise exception '0189: มีฟังก์ชันใหม่นอกรายการที่ประกาศ: %', v_new;
  end if;
  -- (3) แถวเดิมไม่ขยับ (ไฟล์นี้ไม่มี UPDATE/INSERT ตารางใด)
  select string_agg(b.t, ', ') into v_changed
    from _m189_row_base b
    join (select 'job'::text as t, count(*) as n, coalesce(md5(string_agg(j::text, '|' order by j.id)), '') as h from analytics.job j
          union all select 'job_stage', count(*), coalesce(md5(string_agg(s::text, '|' order by s.id)), '') from analytics.job_stage s
          union all select 'job_event', count(*), coalesce(md5(string_agg(e::text, '|' order by e.id)), '') from analytics.job_event e
          union all select 'job_photo', count(*), coalesce(md5(string_agg((to_jsonb(ph) - 'client_key')::text, '|' order by ph.id)), '') from analytics.job_photo ph
          union all select 'production_order', count(*), coalesce(md5(string_agg(po::text, '|' order by po.id)), '') from analytics.production_order po
          union all select 'worker', count(*), coalesce(md5(string_agg(w::text, '|' order by w.id)), '') from analytics.worker w
          union all select 'worker_session', count(*), coalesce(md5(string_agg(s::text, '|' order by s.id)), '') from analytics.worker_session s
          union all select 'shop_intake_token', count(*), coalesce(md5(string_agg(t::text, '|' order by t.id)), '') from analytics.shop_intake_token t) a on a.t = b.t
   where a.n <> b.n or a.h <> b.h;
  if v_changed is not null then
    raise exception '0189: แถวเดิมขยับในตาราง: %', v_changed;
  end if;
  -- (4) job_photo: trigger เปิดอยู่ 3 ตัวเท่าเดิม (ไม่เพิ่ม ไม่ลด) · bucket private ไม่มี policy (ไม่แตะ)
  if (select count(*) from pg_trigger t where t.tgrelid = 'analytics.job_photo'::regclass and not t.tgisinternal and t.tgenabled in ('O', 'A')) <> 3 then
    raise exception '0189: job_photo ต้องมี trigger เปิดอยู่ 3 ตัว (guard + cap + deny truncate) เท่าเดิม';
  end if;
  if not exists (select 1 from storage.buckets b where b.id = 'job-photos' and b.public = false and b.file_size_limit = 1048576 and b.allowed_mime_types = array['image/jpeg'])
     or exists (select 1 from pg_policies p where p.schemaname = 'storage' and p.tablename in ('objects', 'buckets') and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%job-photos%') then
    raise exception '0189: bucket job-photos ต้อง private · 1 MB · image/jpeg และไม่มี storage policy (ไฟล์นี้ไม่แตะ bucket)';
  end if;
  -- (5) สิทธิ์: ไม่มี PUBLIC/anon/authenticated ถือ EXECUTE ฟังก์ชันใดในสคีมา · RPC ช่าง 4 ตัวเป็นของ service_role · helper 3 ตัวไม่เปิดให้ใคร
  select string_agg(p.oid::regprocedure::text, ', ') into v_new
    from pg_proc p cross join lateral aclexplode(p.proacl) a
   where p.pronamespace = 'analytics'::regnamespace and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  if v_new is not null then
    raise exception '0189: พบฟังก์ชันในสคีมา analytics ที่ PUBLIC/anon/authenticated ถือ EXECUTE: %', v_new;
  end if;
  select string_agg(p.proname, ', ') into v_new
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.proname = any (v_added)
     and (has_function_privilege('service_role', p.oid, 'execute')) <> (p.proname in ('job_worker_photo_begin', 'job_worker_photo_add', 'job_worker_photo_remove', 'job_worker_photo_list', 'job_worker_my_intake_list', 'job_worker_token_reissue', 'job_worker_photo_set_primary'));
  if v_new is not null then
    raise exception '0189: สิทธิ์ service_role ของฟังก์ชันใหม่ผิด (RPC ช่างต้อง execute ได้ · helper ต้องไม่ได้): %', v_new;
  end if;
  raise notice '0189: ฟังก์ชันเดิม % ตัว md5 เท่าเดิมทั้งหมด (ยกเว้น job_photo_guard) · ฟังก์ชันใหม่ % ตัว · แถวเดิมไม่ขยับ',
    (select count(*) from _m189_fn_base) - (select count(*) from _m189_fn_base where proname = any (v_touched)), cardinality(v_added);
end;
$c$;

comment on function analytics.job_worker_photo_begin(text, text, text, text, uuid, uuid) is
  '0189 W2: ผ่านด่านทุกชั้น (QR ร้าน + session ผู้จัดการ + ใบที่ช่างคนนี้เปิดเอง + ยังไม่มีขั้นถูกรับ + เพดาน 3/5) ก่อน server แตะ bucket · ออก uuid ให้ path · ไม่เขียนข้อมูล';
comment on function analytics.job_worker_photo_add(text, text, text, uuid, text, text, integer, integer, integer, boolean, text, text, uuid, uuid) is
  '0189 W2: ลงทะเบียนรูป source=shopfloor (ตรวจทุกด่านซ้ำใต้ล็อกแถวใบ · path ต้องตรง <shop>/<job>/<photo_id>) · guard บน job_photo บังคับว่า INSERT shopfloor มาจากฟังก์ชันนี้เท่านั้น (GUC)';
comment on function analytics.job_worker_photo_remove(text, text, uuid, text, text) is
  '0189 W2: ลบรูปของตัวเองจนช่างเริ่มรับงาน (soft delete · event photo_remove actor=ช่าง) · คืน path ให้ server ลบ object';

notify pgrst, 'reload schema';

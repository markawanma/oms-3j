-- 0187_shop_intake_w1.sql — W1: ผู้จัดการเปิดใบผลิต + ใบงานจากมือถือ ด้วย QR ร้าน + PIN (ไม่ login) · ออฟฟิศรับทราบ · ผูก SKU ทีหลัง
-- สถานะ: ยังไม่ apply · dry-run เท่านั้นจนกว่า security ผ่าน (ช่องสาธารณะที่ "สร้างข้อมูล" + trigger บนเส้นปิดใบ) · apply ด้วย node scripts/run-sql.mjs --commit --record เท่านั้น (🔴 ห้าม supabase db push)
-- ชุดทดสอบ: scripts/verify/verify-0187.sql (dry-run = ต่อไฟล์นี้ + ไฟล์นั้น แล้วรันไม่ใส่ --commit · ไฟล์ LF) · ตรวจหลังลงฝังอยู่ท้ายไฟล์นี้ (§11) — ล้ม = raise = ถอยทั้งไฟล์
-- design: docs/3j-jewelry/oms/design-job-lots-shopfloor.md §7 (เลข/ลำดับในเอกสารเก่าอย่ายึด — ตามมติ 20 ต.ค. ด้านล่าง) · UX: docs/3j-jewelry/oms/ux-production-metal-and-shop-intake.md ส่วน B + §C.2.1 + §C.3 (R1 R2 R6)
--   · design-production-item-metal.md §7.2 (PM-A: product_id nullable + pending_product_label + sku_required)
--
-- ทำไม (ภาษาคน): ผู้จัดการอยากเปิดงานผลิตเองจากมือถือที่หน้างาน (สแกน QR ที่ติดร้าน + PIN) โดยไม่ต้องรอออฟฟิศ — ทั้งสินค้าที่มี SKU และสินค้าใหม่ที่ยังไม่มีรหัส
--   ⇒ ต้องมีทางเข้าสาธารณะที่ "สร้างข้อมูลจริง" (ใบผลิต + ใบงาน + QR) จึงต้อง: ผูกร้านจาก token เท่านั้น · ตรวจสิทธิ์สดจาก DB · จำกัดอัตรา · ถอยทั้งก้อนเมื่อล้ม · กดซ้ำได้ใบเดียว
--   ⇒ ใบที่ช่างเปิดต้องผ่านตาออฟฟิศก่อนปิด (รับทราบ) และต้องมี SKU ก่อนเข้าสต็อก (ผูก SKU) — ใส่เป็น trigger บนเส้นปิดใบ โดยไม่แตะ production_order_done 💰 แม้บรรทัดเดียว
--
-- มติเจ้าของ 20 ต.ค. (ผูกตามนี้): ผู้จัดการ = worker ที่ can_open_job=true · ทำบางขั้นด้วย (stages_required คงเดิม) · PIN lock เดิม · ห้ามเห็นเงินใดๆ · ไม่ถามราคาทอง ·
--   เปิดได้ทั้งมี/ไม่มี SKU (ไม่มี SKU: ชื่อแบบ + โลหะ + เนื้อ [เงิน 92.50 ค่าเริ่ม · ทองว่างบังคับ ≥ 37.50 · ทองเหลือง 100] + น้ำหนัก/ชิ้นไม่บังคับ + เผื่อ (ค่าเริ่มปิด) + กำหนดเสร็จไม่บังคับ + แบบใหม่ + หมายเหตุ) ·
--   หน้าเลือกชื่อหลังสแกน QR ร้านแสดงเฉพาะคน can_open_job · น้ำหนักงานทองไม่โชว์ช่าง (N1) · SKU ทองยังไม่มี ⇒ prefill ส่ง metal_known · ออฟฟิศ ack ก่อนปิดใบ + ผูก SKU ก่อนปิด
--
-- สิ่งที่ไฟล์นี้ทำ
--  1. worker.can_open_job · shop_intake_token (hash เท่านั้น · active 1 ใบ/ร้าน) · production_order: opened_via/opened_by_worker_id/intake_idem_key/acknowledged_at/by (+CHECK) ·
--     job.created_by nullable + job.opened_by_worker_id · job_token.issued_by nullable + issued_by_worker_id (CHECK หนึ่งใน) · job_event ชนิดใหม่ intake_open/ack/edit
--  2. ฟังก์ชันที่ replace (ลอก definition สดจาก DB วันที่เขียน แล้วปรับเฉพาะที่ระบุ): job_guard · job_token_guard · production_order_deny_mutation · production_order_item_deny_mutation · job_create_insert (+p_worker_id ท้ายสุด default null)
--  3. core ร่วมสองทาง: job_token_issue_core · job_create_from_production_item_core · worker_pin_verify_core (wrapper ออฟฟิศ/QR ใบงานเดิมเรียก core ด้วยค่าเดิม — พฤติกรรมเดิม)
--  4. worker_upsert (+p_can_open_job/p_can_external · drop signature เดิม) · shop_intake_token_issue/revoke/status
--  5. ทางช่าง: shop_intake_auth (ด่านกลาง) · shop_intake_resolve · worker_pin_verify_intake · job_product_search · job_worker_open
--  6. production_order_acknowledge · trigger production_order_close_gate (ack_required · sku_required) · v_production_order ต่อท้ายคอลัมน์
--  7. production_order_item_bind_product · production_order_item_label_set
--
-- 🔴 ด่านที่ต้องจำ
--  • RPC ฝั่งช่างไม่รับ p_shop_id เลย — ร้านมาจาก token เท่านั้น (crm_require_owner_admin ปล่อย service_role ผ่าน จึงไม่ใช่ด่านของทางนี้ ด่านจริง = token ร้าน active + session ช่าง active ร้านเดียวกัน + can_open_job สดจาก DB)
--  • "<>" กับ null ให้ null ไม่ใช่ true: created_by/issued_by ว่างได้แล้ว — ทุกการเทียบ immutability ใน guard เปลี่ยนเป็น is distinct from (ไม่งั้นแก้ผู้เปิดใบเงียบๆ ได้)
--  • trigger ล็อกโลหะของรายการ (0186) เช็คเฉพาะตอน metal เปลี่ยน — bind SKU เปลี่ยน product_id ได้ ⇒ ประทับค่าที่มีผลก่อนผูก + ขยาย trigger ให้เทียบ effective ตอน product_id เปลี่ยน (security ชี้)
--  • ไม่แตะ production_order_done / production_order_preview / ราคา/ต้นทุน/สต็อกใดๆ (md5 ของ done ล็อกใน §11)
--
-- หมายเหตุ replay: ไฟล์นี้ต้องเป็น LF (ข้อ 20) — ฟังก์ชัน replace ทุกตัวลอกมาจาก pg_get_functiondef ของ DB สด

-- ============================================================================
-- 1. สคีมา — additive ทั้งหมด (add column ... default = ไม่ยิง trigger · ไม่ UPDATE แถวเดิมเลย · ข้อ 19)
-- ============================================================================

-- baseline: ใช้ยืนยันท้ายไฟล์ว่าข้อมูลเดิมไม่ขยับ (ไม่นับคอลัมน์ใหม่) + md5 ฟังก์ชัน 💰 ที่ห้ามแตะ
create temp table _m187_base on commit drop as
select
  (select coalesce(md5(string_agg((to_jsonb(po) - 'opened_via' - 'opened_by_worker_id' - 'intake_idem_key' - 'acknowledged_at' - 'acknowledged_by')::text, '|' order by po.id)), '') from analytics.production_order po) as po_md5,
  (select coalesce(md5(string_agg((to_jsonb(j) - 'opened_by_worker_id')::text, '|' order by j.id)), '') from analytics.job j) as job_md5,
  (select coalesce(md5(string_agg((to_jsonb(t) - 'issued_by_worker_id')::text, '|' order by t.id)), '') from analytics.job_token t) as tok_md5,
  (select coalesce(md5(string_agg((to_jsonb(w) - 'can_open_job')::text, '|' order by w.id)), '') from analytics.worker w) as worker_md5,
  (select coalesce(md5(string_agg(e::text, '|' order by e.id)), '') from analytics.job_event e) as event_md5,
  (select count(*) from analytics.job_counter) as jc_n,
  (select coalesce(sum(last_no), 0) from analytics.job_counter) as jc_sum,
  (select coalesce(sum(last_no), 0) from analytics.production_order_counter) as pc_sum,
  (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'production_order_done') as done_md5,
  (select coalesce(md5(string_agg(poi::text, '|' order by poi.id)), '') from analytics.production_order_item poi) as poi_md5,
  (select coalesce(md5(string_agg(p::text, '|' order by p.id)), '') from public.product p) as product_md5;

-- 1.1 ผู้จัดการ = ช่างที่ออฟฟิศติ๊ก "เปิดงานได้" (ค่าเริ่ม false — ไม่มีใครถือสิทธิ์ตอน apply) · column grant: ตาราง worker ซ่อน pin_hash จึง grant ทีละคอลัมน์
alter table analytics.worker add column if not exists can_open_job boolean not null default false;
grant select (can_open_job) on analytics.worker to service_role;

-- 1.2 QR ร้าน (hub) — เก็บ hash เท่านั้น · active ได้ 1 ใบ/ร้าน (partial unique) · ออกใหม่ = เพิกถอนตัวเก่าในฟังก์ชันเดียวกัน · แก้ได้เฉพาะการเพิกถอน (trigger)
create table if not exists analytics.shop_intake_token (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shop (id) on delete restrict,
  token_hash    text not null,
  issued_at     timestamptz not null default clock_timestamp(),
  issued_by     uuid not null,
  revoked_at    timestamptz,
  revoke_reason text,
  constraint shop_intake_token_hash_ck check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint shop_intake_token_hash_key unique (token_hash),
  constraint shop_intake_token_revoke_ck check ((revoked_at is null) = (revoke_reason is null) and (revoke_reason is null or length(revoke_reason) <= 60))
);
create unique index if not exists uq_shop_intake_token_active on analytics.shop_intake_token (shop_id) where revoked_at is null;
alter table analytics.shop_intake_token enable row level security;
-- ไม่มี policy: service_role (BYPASSRLS) อ่านคอลัมน์ที่ grant · anon/authenticated ไม่มีสิทธิ์ทั้งสคีมา (ข้อ 18) · token_hash ไม่ grant ให้ใคร (เหมือน job_token)

-- 1.3 ใบผลิตที่เปิดจากหน้างาน: ที่มา · ผู้เปิด · idem key (กดซ้ำ/เน็ตสะดุด = ใบเดียว) · ออฟฟิศรับทราบ (write-once)
alter table analytics.production_order
  add column if not exists opened_via          text not null default 'office',
  add column if not exists opened_by_worker_id uuid,
  add column if not exists intake_idem_key     text,
  add column if not exists acknowledged_at     timestamptz,
  add column if not exists acknowledged_by     uuid;
alter table analytics.production_order
  add constraint production_order_opened_via_ck check (opened_via in ('office', 'shopfloor')),
  -- shopfloor ⇔ มีผู้เปิดที่เป็นช่าง ⇔ มี idem key (ใบหน้างานทุกใบต้องกดซ้ำแล้วได้ใบเดียว) · idem key รูปแบบตายตัว
  add constraint production_order_origin_ck check (
    (opened_via = 'shopfloor') = (opened_by_worker_id is not null)
    and (opened_via = 'shopfloor') = (intake_idem_key is not null)
    and (intake_idem_key is null or intake_idem_key ~ '^[A-Za-z0-9_-]{16,64}$')),
  -- รับทราบ: คู่กัน (เวลา+ผู้รับทราบ) · รับทราบได้เฉพาะใบที่เปิดจากหน้างาน
  add constraint production_order_ack_ck check ((acknowledged_at is null) = (acknowledged_by is null) and (acknowledged_at is null or opened_via = 'shopfloor')),
  add constraint production_order_opened_by_worker_fk foreign key (opened_by_worker_id, shop_id) references analytics.worker (id, shop_id) on delete restrict;
create unique index if not exists uq_production_order_intake_idem on analytics.production_order (shop_id, intake_idem_key) where intake_idem_key is not null;

-- 1.4 ใบงาน/QR ที่ช่างเปิด: ไม่มี auth.users ⇒ created_by / issued_by ว่างได้ แต่ต้องมีผู้รับผิดชอบอย่างน้อยหนึ่งฝ่าย (CHECK)
alter table analytics.job alter column created_by drop not null;
alter table analytics.job add column if not exists opened_by_worker_id uuid;
alter table analytics.job
  add constraint job_opened_by_worker_fk foreign key (opened_by_worker_id, shop_id) references analytics.worker (id, shop_id) on delete restrict,
  add constraint job_who_opened_ck check (num_nonnulls(created_by, opened_by_worker_id) >= 1);

alter table analytics.job_token alter column issued_by drop not null;
alter table analytics.job_token add column if not exists issued_by_worker_id uuid;
alter table analytics.job_token
  add constraint job_token_issued_by_worker_fk foreign key (issued_by_worker_id, shop_id) references analytics.worker (id, shop_id) on delete restrict,
  add constraint job_token_issuer_ck check (num_nonnulls(issued_by, issued_by_worker_id) = 1);
grant select (issued_by_worker_id) on analytics.job_token to service_role;

-- 1.5 job_event: ชนิดใหม่ intake_open (ช่างเปิดใบ) · ack (ออฟฟิศรับทราบ) · edit (ผูก SKU/แก้ข้อมูลของใบ) — ลอกรายการจาก DB สดแล้วต่อท้าย
alter table analytics.job_event drop constraint job_event_event_type_ck;
alter table analytics.job_event add constraint job_event_event_type_ck check (event_type = any (array[
  'create', 'stage_receive', 'stage_send', 'stage_skip', 'stage_reopen', 'weigh', 'scrap', 'batch_join', 'batch_leave', 'due_set', 'hold', 'resume',
  'photo_add', 'note', 'done', 'cancel', 'token_issue', 'token_revoke', 'plan_change', 'surplus_set', 'profile_set', 'split', 'split_cancel',
  'discrepancy', 'discrepancy_resolve', 'photo_remove', 'photo_primary', 'photo_reorder', 'discrepancy_arrive',
  'intake_open', 'ack', 'edit']));

-- 1.6 QR ร้าน: แก้ไม่ได้นอกจากเพิกถอน · ลบไม่ได้ · TRUNCATE ไม่ได้ (แบบเดียวกับ job_token_guard)
create or replace function analytics.shop_intake_token_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'shop_intake_token: ห้ามลบ — เพิกถอนแทน' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    if new.revoked_at is not null then
      raise exception 'shop_intake_token: QR ร้านใหม่ต้องยังไม่ถูกเพิกถอน' using errcode = '22023';
    end if;
    return new;
  end if;
  if new.id <> old.id or new.shop_id <> old.shop_id or new.token_hash <> old.token_hash or new.issued_at <> old.issued_at or new.issued_by <> old.issued_by then
    raise exception 'shop_intake_token: แก้ได้เฉพาะการเพิกถอน' using errcode = '22023';
  end if;
  if old.revoked_at is not null then
    raise exception 'shop_intake_token: QR ที่เพิกถอนแล้วฟื้นหรือแก้ไม่ได้' using errcode = '22023';
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_shop_intake_token_guard on analytics.shop_intake_token;
create trigger trg_shop_intake_token_guard before insert or update or delete on analytics.shop_intake_token
  for each row execute function analytics.shop_intake_token_guard();
drop trigger if exists trg_shop_intake_token_deny_truncate on analytics.shop_intake_token;
create trigger trg_shop_intake_token_deny_truncate before truncate on analytics.shop_intake_token
  for each statement execute function analytics.job_deny_truncate();
revoke all on analytics.shop_intake_token from public, anon, authenticated, service_role;
grant select (id, shop_id, issued_at, issued_by, revoked_at, revoke_reason) on analytics.shop_intake_token to service_role;

-- ============================================================================
-- 2. ฟังก์ชันที่ replace — ลอก definition สดจาก DB (pg_get_functiondef) แล้วปรับเฉพาะจุดที่คอมเมนต์ 0187 ระบุ · re-grant ครบท้ายไฟล์ (ข้อ 2)
-- ============================================================================

-- เปลี่ยน arg list ของ job_create_insert (เพิ่ม p_worker_id ท้ายสุด default null) = drop signature เดิมก่อน (ข้อ 1) · ผู้เรียกเดิม (job_create_from_quote_item) เรียก 21 arg ตำแหน่งเดิมได้ต่อ
drop function if exists analytics.job_create_insert(uuid, text, uuid, uuid, integer, uuid, uuid, text, text, text, integer, date, text, text, text[], boolean, uuid, integer, numeric, jsonb, uuid);

CREATE OR REPLACE FUNCTION analytics.job_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
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
  v_bind_ok     boolean := false;
  v_nj          jsonb;
  v_oj          jsonb;
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
  -- 0187: ผูก SKU ทีหลัง (ใบงานที่ช่างเปิดจากหน้างานแบบไม่มี SKU) — ช่องแคบเดียวที่ product_id/sku_snapshot เปลี่ยนได้:
  --   เดิมว่างทั้งคู่ → มีค่าทั้งคู่ · RPC production_order_item_bind_product ตั้ง GUC ชี้รายการใบผลิตของใบงานนี้ ·
  --   รายการใบผลิตต้องผูก SKU เดียวกันนี้แล้ว (อัปเดตรายการก่อนใบงาน) · sku_snapshot ต้องเป็นรหัสของ SKU นั้นในร้านเดียวกัน — ขาดข้อใดข้อหนึ่ง = ห้ามเหมือนเดิม
  v_bind_ok := old.product_id is null and old.sku_snapshot is null and new.product_id is not null and new.sku_snapshot is not null
    and old.production_order_item_id is not null
    and current_setting('analytics.job_bind_item', true) is not distinct from old.production_order_item_id::text
    and exists (select 1 from analytics.production_order_item poi where poi.id = old.production_order_item_id and poi.product_id = new.product_id)
    and exists (select 1 from public.product p where p.id = new.product_id and p.shop_id = new.shop_id and p.sku = new.sku_snapshot);
  if new.shop_id <> old.shop_id or new.seq <> old.seq or new.source_kind <> old.source_kind
     or new.oem_quote_item_id is distinct from old.oem_quote_item_id
     or new.root_quote_id is distinct from old.root_quote_id
     or new.oem_item_seq is distinct from old.oem_item_seq
     or new.production_order_item_id is distinct from old.production_order_item_id
     or (new.product_id is distinct from old.product_id and not v_bind_ok)
     or (new.sku_snapshot is distinct from old.sku_snapshot and not v_bind_ok)
     or new.metal <> old.metal or new.qty_order <> old.qty_order
     or new.created_at <> old.created_at
     -- 0187: created_by ว่างได้แล้ว (ช่างเปิดใบ) — "<>" กับ null ให้ null ไม่ใช่ true ⇒ ต้อง is distinct from ไม่งั้นแก้ผู้เปิดใบเงียบๆ ได้
     or new.created_by is distinct from old.created_by or new.opened_by_worker_id is distinct from old.opened_by_worker_id then
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
  v_nj := to_jsonb(new) - 'surplus_disposition' - 'surplus_note' - 'updated_at' - 'job_no';
  v_oj := to_jsonb(old) - 'surplus_disposition' - 'surplus_note' - 'updated_at' - 'job_no';
  if v_bind_ok then
    -- 0187: ใบงานที่ปิดแล้วแต่ใบผลิตยังเปิดรอ SKU — ผูก SKU ได้ (เฉพาะสองคอลัมน์นี้) · ทุกคอลัมน์อื่นยังต้องเท่าเดิมเป๊ะ
    v_nj := v_nj - 'product_id' - 'sku_snapshot';
    v_oj := v_oj - 'product_id' - 'sku_snapshot';
  end if;
  if old.status = 'done' and v_nj is distinct from v_oj then
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
$function$;

CREATE OR REPLACE FUNCTION analytics.job_token_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
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
     or new.print_no <> old.print_no or new.issued_at <> old.issued_at
     -- 0187: issued_by ว่างได้ (QR ที่ช่างออก) — ต้อง is distinct from (ข้อ 19: "<>" กับ null ไม่เคยเป็น true)
     or new.issued_by is distinct from old.issued_by or new.issued_by_worker_id is distinct from old.issued_by_worker_id
     or new.purpose <> old.purpose or new.lot_job_id is distinct from old.lot_job_id then
    raise exception 'job_token: แก้ได้เฉพาะการเพิกถอน' using errcode = '22023';
  end if;
  if old.revoked_at is not null then
    raise exception 'job_token: token ที่เพิกถอนแล้วฟื้นหรือแก้ไม่ได้' using errcode = '22023';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION analytics.production_order_deny_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'production_order: ห้ามลบใบผลิต' using errcode = '22023';
  end if;
  if new.shop_id is distinct from old.shop_id
     or new.seq is distinct from old.seq
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'production_order: ห้ามเปลี่ยน shop_id/seq/created_at/created_by' using errcode = '22023';
  end if;
  -- 0187: ที่มาของใบ (ออฟฟิศ/หน้างาน) · ผู้เปิด · idem key เปลี่ยนไม่ได้ — ไม่งั้นแก้ shopfloor → office เพื่อหลบด่านรับทราบได้
  if new.opened_via is distinct from old.opened_via
     or new.opened_by_worker_id is distinct from old.opened_by_worker_id
     or new.intake_idem_key is distinct from old.intake_idem_key then
    raise exception 'production_order: ห้ามเปลี่ยนที่มา/ผู้เปิดของใบผลิต' using errcode = '22023', hint = 'origin_locked';
  end if;
  -- 0187: รับทราบ = write-once ผ่าน production_order_acknowledge เท่านั้น (GUC ชี้ใบนี้ · ตั้งได้ครั้งเดียว · ถอน/แก้ไม่ได้)
  if new.acknowledged_at is distinct from old.acknowledged_at or new.acknowledged_by is distinct from old.acknowledged_by then
    if old.acknowledged_at is not null or new.acknowledged_at is null
       or current_setting('analytics.po_ack', true) is distinct from new.id::text then
      raise exception 'production_order: การรับทราบตั้งได้ครั้งเดียวผ่านปุ่มรับทราบเท่านั้น (แก้/ถอนไม่ได้)' using errcode = '22023', hint = 'ack_locked';
    end if;
  end if;
  if old.status <> 'open' then
    raise exception 'production_order: ใบ % สถานะ % แล้ว แก้ไม่ได้', old.po_no, old.status using errcode = '22023';
  end if;
  if new.status = 'done' and new.done_at is null then
    raise exception 'production_order: เปลี่ยนเป็น done ต้องมี done_at' using errcode = '22023';
  end if;
  if new.status = 'cancelled' and new.cancelled_at is null then
    raise exception 'production_order: เปลี่ยนเป็น cancelled ต้องมี cancelled_at' using errcode = '22023';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION analytics.production_order_item_deny_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
declare
  v_status    text;
  v_old_sku   text;
  v_new_sku   text;
  v_old_eff   text;
  v_new_eff   text;
  v_job_no    text;
begin
  select status into v_status from analytics.production_order
    where id = coalesce(new.production_order_id, old.production_order_id);
  if v_status is distinct from 'open' then
    if tg_op = 'DELETE' then
      raise exception 'production_order_item: ใบผลิตนี้สถานะ % แล้ว ลบรายการไม่ได้', v_status using errcode = '22023';
    else
      raise exception 'production_order_item: ใบผลิตนี้สถานะ % แล้ว แก้รายการไม่ได้', v_status using errcode = '22023';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  -- 0187 (security): เช็คโลหะที่ "มีผล" (effective) ตอน product_id เปลี่ยนด้วย — เดิมเช็คเฉพาะตอนคอลัมน์ metal เปลี่ยน ⇒ UPDATE product_id บนแถวที่ metal ว่างเปลี่ยนโลหะที่มีผลโดยไม่ผ่านด่านนี้
  if tg_op = 'UPDATE' and (new.metal is distinct from old.metal or new.product_id is distinct from old.product_id) then
    select coalesce(p.make_spec ->> 'metal', case when p.cost_type in ('fixed', 'spot') then 'silver' end) into v_old_sku
      from public.product p where p.id = old.product_id;
    select coalesce(p.make_spec ->> 'metal', case when p.cost_type in ('fixed', 'spot') then 'silver' end) into v_new_sku
      from public.product p where p.id = new.product_id;
    v_old_eff := coalesce(old.metal, v_old_sku);
    v_new_eff := coalesce(new.metal, v_new_sku);
    if v_new_eff is distinct from v_old_eff then
      select j.job_no into v_job_no from analytics.job j
       where j.production_order_item_id = old.id and j.status <> 'cancelled' order by j.created_at limit 1;
      if v_job_no is not null then
        raise exception 'production_order_item: เปลี่ยนโลหะไม่ได้ — มีใบงาน % เดินอยู่ ยกเลิกใบงานก่อน แล้วแก้โลหะ', v_job_no
          using errcode = '22023', hint = 'metal_locked';
      end if;
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION analytics.job_create_insert(p_shop_id uuid, p_source_kind text, p_oem_item_id uuid, p_root_quote_id uuid, p_oem_item_seq integer, p_poi_id uuid, p_product_id uuid, p_design_label text, p_sku text, p_metal text, p_qty integer, p_due date, p_gate_note text, p_note text, p_codes text[], p_is_new_design boolean, p_actor uuid, p_qty_order integer, p_target_piece_g numeric, p_plan jsonb, p_profile_id uuid, p_worker_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
declare
  v_seq    int;
  v_job    analytics.job%rowtype;
  v_warn   text[];
  v_today  date := analytics.job_today();
  v_basis  jsonb;
  v_profile analytics.job_record_profile%rowtype;
  v_apply  jsonb;
begin
  -- 0187: ผู้เปิดใบเป็นออฟฟิศ (p_actor) หรือช่างหน้างาน (p_worker_id) — อย่างใดอย่างหนึ่งเท่านั้น (ตรงกับ CHECK job_who_opened_ck)
  if num_nonnulls(p_actor, p_worker_id) <> 1 then
    raise exception 'job_create_insert: ต้องระบุผู้เปิดใบเป็นออฟฟิศหรือช่างอย่างใดอย่างหนึ่ง' using errcode = '22023', hint = 'actor_required';
  end if;
  -- p_qty = qty_planned (จำนวนเริ่มผลิต) · p_qty_order = จำนวนที่สั่ง · p_plan = ผลของ job_plan_compute
  if p_qty_order is null or not (p_qty_order between 1 and 100000) or p_qty is null or not (p_qty between 1 and 100000) then
    raise exception 'จำนวนสั่ง/จำนวนเริ่มผลิตต้องอยู่ระหว่าง 1 ถึง 100,000' using errcode = '22023', hint = 'qty_planned_invalid';
  end if;
  -- 0176 → 0186: แบบการบันทึก — ไม่ส่งมา = ค่าเริ่มตามโลหะ (ทอง: is_default_gold ที่ active เท่านั้น ไม่มี = no_gold_profile ไม่ fallback ไปแบบทั่วไป) · ไม่มีค่าเริ่ม/แบบไม่ถูกต้อง (ไม่พบ/ร้านอื่น/ปิดใช้) = ปฏิเสธ ไม่เดา
  if p_profile_id is null then
    -- 0186: ทองต้องมีแบบทองเป็นค่าเริ่มเท่านั้น — ไม่ fallback ไปแบบ default ของเงินเงียบๆ
    if p_metal = 'gold' and not exists (
         select 1 from analytics.job_record_profile gp where gp.shop_id = p_shop_id and gp.is_active and gp.is_default_gold) then
      raise exception 'ร้านนี้ยังไม่มีแบบการบันทึกค่าเริ่มสำหรับงานทอง (ชั่งทุกขั้น + ชั่งสุทธิ) — ตั้งแบบทองเป็นค่าเริ่มที่หน้าแบบการบันทึกก่อนสร้างใบงานทอง' using errcode = '22023', hint = 'no_gold_profile';
    end if;
    select p.* into v_profile from analytics.job_record_profile p where p.id = analytics.job_profile_default_for(p_shop_id, p_metal);
    if not found then
      raise exception 'ร้านนี้ยังไม่มีแบบการบันทึกค่าเริ่ม — ตั้งค่าเริ่มที่หน้าแบบการบันทึกก่อนสร้างใบงาน' using errcode = '22023', hint = 'no_default_profile';
    end if;
  else
    select p.* into v_profile from analytics.job_record_profile p where p.id = p_profile_id and p.shop_id = p_shop_id;
    if not found or not v_profile.is_active then
      raise exception 'แบบการบันทึกไม่ถูกต้อง (ไม่พบ/ของร้านอื่น/ปิดใช้งานแล้ว)' using errcode = '22023', hint = 'profile_invalid';
    end if;
  end if;
  v_basis := case when jsonb_typeof(p_plan -> 'basis') = 'object' then p_plan -> 'basis' end;
  v_warn := analytics.job_validate_stage_codes(p_shop_id, p_codes, p_is_new_design);
  if p_due is not null and (p_due < v_today or p_due > v_today + 730) then
    raise exception 'กำหนดส่งต้องไม่ย้อนหลังและไม่เกิน 2 ปีข้างหน้า' using errcode = '22023', hint = 'due_invalid';
  end if;

  insert into analytics.job_counter as c (shop_id, last_no) values (p_shop_id, 1)
  on conflict (shop_id) do update set last_no = c.last_no + 1
  returning c.last_no into v_seq;

  insert into analytics.job (shop_id, seq, source_kind, oem_quote_item_id, root_quote_id, oem_item_seq, production_order_item_id,
                             product_id, design_label, sku_snapshot, metal, qty_order, qty_planned, weigh_required, due_date,
                             start_gate_note, created_by, opened_by_worker_id, note, target_piece_g, metal_plan_g, metal_plan_basis,
                             profile_id, profile_name, require_final_weight)
  values (p_shop_id, v_seq, p_source_kind, p_oem_item_id, p_root_quote_id, p_oem_item_seq, p_poi_id,
          p_product_id, p_design_label, p_sku, p_metal, p_qty_order, p_qty, false, p_due,
          p_gate_note, p_actor, p_worker_id, p_note, p_target_piece_g, (p_plan ->> 'metal_plan_g')::numeric, v_basis,
          v_profile.id, v_profile.name, v_profile.require_final_weight)
  returning * into v_job;

  -- 0176: ขั้นเริ่มปิดทั้ง 3 flag แล้ว job_profile_apply ตั้งตามแบบ (ที่เดียวที่ derive flag · ใช้ร่วมกับ job_profile_set) — ตรรกะ metal เดิม (ทอง/เงิน/ทองเหลือง) ถอดแล้ว
  insert into analytics.job_stage (job_id, shop_id, stage_code, seq, weigh_required, scrap_qty_ask, scrap_weight_ask)
  select v_job.id, p_shop_id, a.code, a.ord::int, false, false, false
    from unnest(p_codes) with ordinality as a(code, ord)
    join analytics.job_stage_def d on d.shop_id = p_shop_id and d.code = a.code
   order by a.ord;
  v_apply := analytics.job_profile_apply(v_job.id, v_profile.id);

  perform analytics.job_event_write(v_job.id, null, 'create', v_today, p_actor, p_worker_id, case when p_worker_id is null then 'job_page' else 'worker_qr' end, null,
    jsonb_build_object('source_kind', p_source_kind, 'stage_codes', to_jsonb(p_codes), 'qty_planned', p_qty, 'metal', p_metal,
                       'qty_order', p_qty_order, 'target_piece_g', p_target_piece_g, 'metal_plan_g', v_job.metal_plan_g,
                       'due_date', p_due, 'start_gate_note_present', p_gate_note is not null,
                       'profile_id', v_profile.id, 'profile_name', v_profile.name, 'has_weigh', v_apply -> 'has_weigh',
                       'gold_unguarded', v_apply -> 'gold_unguarded')
                       || case when p_worker_id is null then '{}'::jsonb else jsonb_build_object('via', 'shopfloor') end);

  return jsonb_build_object('job_id', v_job.id, 'job_no', v_job.job_no, 'status', v_job.status, 'metal', v_job.metal,
                            'qty_planned', v_job.qty_planned, 'stage_codes', to_jsonb(p_codes), 'warnings', to_jsonb(v_warn),
                            'start_gate_note_set', p_gate_note is not null,
                            'qty_order', v_job.qty_order, 'under_planned', v_job.qty_planned < v_job.qty_order,
                            'metal_plan_g', v_job.metal_plan_g, 'plan_missing', coalesce(v_basis -> 'missing', '[]'::jsonb),
                            'profile_id', v_profile.id, 'profile_name', v_profile.name, 'has_weigh', v_apply -> 'has_weigh',
                            'gold_unguarded', v_apply -> 'gold_unguarded');
end;
$function$;


-- ============================================================================
-- 3. core ที่ใช้ร่วมระหว่างทางออฟฟิศ (security definer + crm_require_owner_admin) กับทางช่างหน้างาน (token ร้าน + session ที่ DB ตรวจเอง)
--    wrapper ออฟฟิศ = ตรวจสิทธิ์เดิมทุกบรรทัดแล้วเรียก core ด้วย p_worker_id = null ⇒ พฤติกรรมเดิมเป๊ะ (verify ยิงทั้งสองฝั่ง)
--    core ไม่ใช่ RPC: ไม่ grant ใคร (ACL postgres เท่านั้น) · ผู้เรียกที่ไม่ใช่เจ้าของฟังก์ชันเรียกไม่ได้
-- ============================================================================

-- 3.1 ออก QR ใบงาน — core รับแถวใบงานที่ล็อกแล้ว (ออฟฟิศ: จาก job_office_begin for update · ช่าง: ใบที่เพิ่ง insert ในทรานแซกชันเดียวกัน)
create or replace function analytics.job_token_issue_core(p_job analytics.job, p_revoke_previous boolean, p_actor uuid, p_worker_id uuid, p_purpose text, p_lot_job_id uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_job     analytics.job := p_job;
  v_paid    numeric;
  v_revoked int := 0;
  v_active  int;
  v_print   int;
  v_raw     text;
  v_hash    text;
  v_today   date := analytics.job_today();
  v_rev     boolean;
  v_lot     analytics.job%rowtype;
  v_channel text := case when p_worker_id is null then 'job_page' else 'worker_qr' end;
begin
  -- 0187: ผู้ออก QR = ออฟฟิศ หรือ ช่างหน้างาน อย่างใดอย่างหนึ่ง (ตรงกับ CHECK job_token_issuer_ck)
  if num_nonnulls(p_actor, p_worker_id) <> 1 then
    raise exception 'job_token_issue: ต้องระบุผู้ออก QR เป็นออฟฟิศหรือช่างอย่างใดอย่างหนึ่ง' using errcode = '22023', hint = 'actor_required';
  end if;
  -- 0181: p_revoke_previous null = ค่าเริ่มตามชนิด: พิมพ์ใบงานหลัก (traveler) ของใบที่ไม่มีส่วนย่อย = เพิกถอนของเก่า (เหมือน J1) · ใบที่มีส่วนย่อย หรือใบย่อย/ใบส่งของ = ไม่เพิกถอน · ค่าที่ส่งมาชัดเจนชนะเสมอ
  if v_job.parent_job_id is not null then
    raise exception 'ออก QR ให้ส่วนย่อยไม่ได้ — ออกให้ใบแม่ (QR ใบแม่เปิดหน้าเดียวกันทุกส่วน)' using errcode = '22023', hint = 'lot_no_token';
  end if;
  if p_lot_job_id is not null then
    select * into v_lot from analytics.job l where l.id = p_lot_job_id and l.parent_job_id = v_job.id and l.shop_id = v_job.shop_id;
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
                    p_purpose = 'traveler' and not exists (select 1 from analytics.job l where l.parent_job_id = v_job.id and l.status <> 'cancelled'));
  if v_rev then
    with r as (
      update analytics.job_token set revoked_at = clock_timestamp(), revoke_reason = 'reprint'
       where job_id = v_job.id and revoked_at is null returning 1)
    select count(*) into v_revoked from r;
    if v_revoked > 0 then
      perform analytics.job_event_write(v_job.id, null, 'token_revoke', v_today, p_actor, p_worker_id, v_channel, null,
        jsonb_build_object('reason', 'reprint', 'count', v_revoked));
    end if;
  end if;
  select count(*) into v_active from analytics.job_token where job_id = v_job.id and revoked_at is null;
  if v_active >= 5 then
    raise exception 'ใบงานนี้มี QR ที่ใช้งานอยู่ครบ 5 ใบแล้ว — เพิกถอนก่อนพิมพ์เพิ่ม' using errcode = '22023', hint = 'token_cap';
  end if;

  select coalesce(max(print_no), 0) + 1 into v_print from analytics.job_token where job_id = v_job.id;
  -- 32 bytes สุ่มจาก pgcrypto -> base64url 43 ตัวอักษร (ไม่มี padding)
  v_raw := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  v_hash := analytics.job_sha256_hex(v_raw);
  insert into analytics.job_token (shop_id, job_id, token_hash, print_no, issued_by, issued_by_worker_id, purpose, lot_job_id)
  values (v_job.shop_id, v_job.id, v_hash, v_print, p_actor, p_worker_id, p_purpose, p_lot_job_id);

  perform analytics.job_event_write(v_job.id, null, 'token_issue', v_today, p_actor, p_worker_id, v_channel, null,
    jsonb_build_object('print_no', v_print, 'revoked_previous', v_revoked, 'purpose', p_purpose, 'lot_job_id', p_lot_job_id));

  return jsonb_build_object('token', v_raw, 'print_no', v_print, 'job_id', v_job.id, 'job_no', v_job.job_no,
                            'revoked_previous', v_revoked, 'purpose', p_purpose, 'lot_job_id', p_lot_job_id,
                            'lot_label', case when v_lot.id is null then null else v_job.job_no || ' · ส่วนที่ ' || v_lot.lot_seq end);
end;
$function$;

create or replace function analytics.job_token_issue(p_shop_id uuid, p_job_id uuid, p_revoke_previous boolean DEFAULT NULL::boolean, p_actor uuid DEFAULT NULL::uuid, p_purpose text DEFAULT 'traveler'::text, p_lot_job_id uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_actor   uuid := coalesce(p_actor, auth.uid());
  v_job     analytics.job%rowtype;
begin
  -- 0187: ตัดเนื้อไปอยู่ job_token_issue_core (ทางช่างหน้างานใช้ร่วม) — ลำดับด่านเดิม: ชนิด QR → สิทธิ์/ล็อกใบ → ที่เหลือใน core
  if p_purpose is null or p_purpose not in ('traveler', 'sublot', 'delivery_note') then
    raise exception 'ชนิด QR ต้องเป็น traveler / sublot / delivery_note' using errcode = '22023', hint = 'purpose_invalid';
  end if;
  v_job := analytics.job_office_begin('job_token_issue', p_shop_id, p_job_id, v_actor);
  return analytics.job_token_issue_core(v_job, p_revoke_previous, v_actor, null, p_purpose, p_lot_job_id);
end;
$function$;

-- 3.2 สร้างใบงานจากรายการใบผลิต — core = เนื้อเดิมทั้งหมดหลังด่านสิทธิ์ · ช่างหน้างานเรียกด้วย p_worker_id (p_actor = null)
create or replace function analytics.job_create_from_production_item_core(p_shop_id uuid, p_production_order_item_id uuid, p_stage_codes text[], p_due_date date, p_design_label text, p_note text, p_actor uuid, p_worker_id uuid, p_qty_planned integer, p_target_piece_g numeric, p_metal_plan_override_g numeric, p_metal_plan_reason text, p_profile_id uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_info  jsonb;
  v_label text;
  v_note  text;
  v_qty_order   int;
  v_qty_planned int;
  v_target      numeric;
  v_plan        jsonb;
begin
  perform 1 from analytics.production_order po join analytics.production_order_item poi on poi.production_order_id = po.id
   where poi.id = p_production_order_item_id and po.shop_id = p_shop_id for share of po;
  v_info := analytics.job_source_info(p_shop_id, 'production', p_production_order_item_id);
  if v_info -> 'existing_job' <> 'null'::jsonb then
    raise exception 'รายการนี้มีใบงาน % อยู่แล้ว — ถ้าต้องการสร้างใหม่ให้ยกเลิกใบเดิมก่อน', v_info -> 'existing_job' ->> 'job_no'
      using errcode = '22023', hint = 'job_exists';
  end if;
  v_label := coalesce(case when nullif(btrim(coalesce(p_design_label, '')), '') is null then null
                          else analytics.job_label_clean(p_design_label, 'ชื่อแบบ', 200) end, v_info ->> 'design_label');
  v_note := analytics.job_text_clean(p_note, 'หมายเหตุ', 500, false);
  -- M1: จำนวนเริ่มผลิต/น้ำหนักเป้าหมาย/แผนโลหะ — จำนวนสั่งมาจากต้นทางเสมอ ไม่รับจาก client
  v_qty_order := (v_info ->> 'qty')::int;
  v_qty_planned := coalesce(p_qty_planned, v_qty_order);
  if not (v_qty_planned between 1 and 100000) then
    raise exception 'จำนวนเริ่มผลิตต้องอยู่ระหว่าง 1 ถึง 100,000' using errcode = '22023', hint = 'qty_planned_invalid';
  end if;
  v_target := coalesce(p_target_piece_g, nullif(v_info ->> 'target_piece_g', '')::numeric);
  if v_target is not null and not (v_target > 0 and v_target <= 10000 and v_target = round(v_target, 3)) then
    raise exception 'น้ำหนักเป้าหมายต่อชิ้นต้องมากกว่า 0 ไม่เกิน 10,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)' using errcode = '22023', hint = 'target_invalid';
  end if;
  v_plan := analytics.job_plan_compute(p_shop_id, v_info ->> 'metal', v_qty_planned, v_target, p_metal_plan_override_g, p_metal_plan_reason,
    case when p_target_piece_g is not null then 'input' else v_info ->> 'target_piece_g_source' end);

  return analytics.job_create_insert(p_shop_id, 'production', null, null, null, p_production_order_item_id,
    nullif(v_info ->> 'product_id', '')::uuid, v_label, nullif(v_info ->> 'sku', ''), v_info ->> 'metal', v_qty_planned,
    p_due_date, null, v_note, p_stage_codes, (v_info ->> 'is_new_design')::boolean, p_actor,
    v_qty_order, v_target, v_plan, p_profile_id, p_worker_id);
end;
$function$;

create or replace function analytics.job_create_from_production_item(p_shop_id uuid, p_production_order_item_id uuid, p_stage_codes text[], p_due_date date DEFAULT NULL::date, p_design_label text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid, p_qty_planned integer DEFAULT NULL::integer, p_target_piece_g numeric DEFAULT NULL::numeric, p_metal_plan_override_g numeric DEFAULT NULL::numeric, p_metal_plan_reason text DEFAULT NULL::text, p_profile_id uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
begin
  if p_shop_id is null or p_production_order_item_id is null then
    raise exception 'job_create_from_production_item: p_shop_id และ p_production_order_item_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'job_create_from_production_item: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  return analytics.job_create_from_production_item_core(p_shop_id, p_production_order_item_id, p_stage_codes, p_due_date, p_design_label, p_note,
    v_actor, null, p_qty_planned, p_target_piece_g, p_metal_plan_override_g, p_metal_plan_reason, p_profile_id);
end;
$function$;

-- 3.3 ตรวจ PIN — core เดียวสองทางเข้า (QR ใบงาน = worker_pin_verify · QR ร้าน = worker_pin_verify_intake) ⇒ นโยบายล็อกเดียว (ผิด 5 = 15 นาที · ≥10 = 1 ชม. · 15 = ถาวร)
--     p_budget_key: ทางใบงานส่ง 'pf:<token>' ⇒ งบผิด 20/วัน/token เหมือนเดิม · ทางร้านส่ง null ⇒ ไม่มีงบนี้ (QR ร้านเป็นของร่วม — ใครสแกนก็ผิดจนล็อกทั้งร้านได้ · พึ่งล็อกต่อช่าง + เพดานต่อ IP)
--     p_require_open: ทางร้านรับเฉพาะช่างที่ can_open_job — ช่างอื่นตอบ bad_credentials เหมือนใส่ผิด และ "ไม่นับครั้งผิด" (กันคนยิง id มั่วมาล็อกช่างที่ไม่เกี่ยว)
create or replace function analytics.worker_pin_verify_core(p_shop_id uuid, p_worker_id uuid, p_pin text, p_user_agent text, p_ip_hash text, p_budget_key text, p_require_open boolean)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_w     analytics.worker%rowtype;
  v_att   int;
  v_raw   text;
  v_exp   timestamptz;
  v_lock  timestamptz;
  v_day   timestamptz := date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
  v_spent int;
  v_new   boolean;
begin
  select * into v_w from analytics.worker w where w.id = p_worker_id and w.shop_id = p_shop_id for update;
  if not found or not v_w.is_active then
    return analytics.job_fail('bad_credentials', 'ชื่อหรือ PIN ไม่ถูกต้อง');
  end if;
  if p_require_open and not v_w.can_open_job then
    return analytics.job_fail('bad_credentials', 'ชื่อหรือ PIN ไม่ถูกต้อง');
  end if;
  if v_w.locked_until is not null and v_w.locked_until > now() then
    -- ล็อกถาวร (infinity) แยกก่อนคำนวณ retry — extract(epoch from infinity) ทำ int overflow
    if v_w.locked_until = 'infinity'::timestamptz then
      return analytics.job_fail('locked_office', 'บัญชีช่างถูกล็อกเพราะใส่ PIN ผิดหลายครั้ง — ให้ออฟฟิศปลดล็อกหรือรีเซ็ต PIN');
    end if;
    return analytics.job_fail('locked', 'ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว — ลองใหม่ภายหลัง หรือให้ออฟฟิศรีเซ็ต PIN',
                              jsonb_build_object('locked_until', v_w.locked_until,
                                                 'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_w.locked_until - now())))::int)));
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return analytics.job_fail('bad_credentials', 'ชื่อหรือ PIN ไม่ถูกต้อง');
  end if;

  -- งบผิดต่อ token ต่อวัน (<= 20) แบบ atomic: จองช่องก่อนตรวจ PIN (insert .. on conflict .. where hits < max returning) — พร้อมกันกี่ตัวก็ไม่เกิน 20 ·
  -- เต็มแล้ว token นี้ verify ไม่ได้แม้ใส่ถูก · ใส่ถูกคืนช่อง (นับเฉพาะครั้งที่ผิด) · 0187: p_budget_key null = ไม่ใช้งบ (ทาง QR ร้าน)
  if p_budget_key is not null then
    v_spent := analytics.job_budget_take(p_budget_key, v_day, 20);
    if v_spent is null then
      return analytics.job_fail('token_budget_exhausted', 'ใส่ PIN ผิดครบกำหนดของใบงานนี้ในวันนี้แล้ว — ให้ออฟฟิศพิมพ์ใบงานใหม่');
    end if;
  end if;

  if extensions.crypt(p_pin, v_w.pin_hash) = v_w.pin_hash then
    if p_budget_key is not null then
      perform analytics.job_budget_give(p_budget_key, v_day);
    end if;
    -- N2: สำเร็จ = ปลดเฉพาะล็อกชั่วคราวที่หมดอายุแล้ว · ตัวนับ/หน้าต่าง 24 ชม. ไม่ล้าง (ผิด 4 สลับถูก ×5 ต้องยังล็อกที่ครั้งที่ 5) —
    -- ล้างได้แค่ครบ 24 ชม. / worker_unlock / worker_pin_set
    update analytics.worker set locked_until = null where id = v_w.id;
    delete from analytics.worker_session where expires_at < now() - interval '1 day';
    v_raw := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
    v_exp := clock_timestamp() + interval '12 hours';
    insert into analytics.worker_session (shop_id, worker_id, session_hash, expires_at, device_hint)
    values (v_w.shop_id, v_w.id, analytics.job_sha256_hex(v_raw), v_exp, analytics.job_device_hint(p_user_agent, p_ip_hash));
    return jsonb_build_object('ok', true, 'session_token', v_raw, 'expires_at', v_exp,
                              'worker', jsonb_build_object('id', v_w.id, 'display_name', v_w.display_name));
  end if;

  -- PIN ผิด: นับสะสมในหน้าต่าง 24 ชม. ที่ยึดครั้งแรก (เว้นระยะนานแค่ไหนก็ยังนับ) · ล็อก 15 นาทีที่ครั้งที่ 5 · >= 10 ล็อก 1 ชม. · 15 ล็อกถาวร
  v_new := v_w.failed_window_start is null or v_w.failed_window_start < now() - interval '24 hours';
  v_att := case when v_new then 1 else v_w.failed_attempts + 1 end;
  v_lock := case when v_att >= 15 then 'infinity'::timestamptz
                 when v_att >= 10 then now() + interval '1 hour'
                 when v_att = 5 then now() + interval '15 minutes'
                 else null end;
  update analytics.worker
     set failed_attempts = v_att, last_failed_at = now(), locked_until = v_lock,
         failed_window_start = case when v_new then now() else failed_window_start end
   where id = v_w.id;
  if v_lock = 'infinity'::timestamptz then
    return analytics.job_fail('locked_office', 'บัญชีช่างถูกล็อกเพราะใส่ PIN ผิดหลายครั้ง — ให้ออฟฟิศปลดล็อกหรือรีเซ็ต PIN');
  elsif v_lock is not null then
    return analytics.job_fail('locked', 'ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว — ลองใหม่ภายหลัง หรือให้ออฟฟิศรีเซ็ต PIN',
                              jsonb_build_object('locked_until', v_lock, 'retry_after_seconds', case when v_att >= 10 then 3600 else 900 end));
  end if;
  return analytics.job_fail('bad_credentials', 'ชื่อหรือ PIN ไม่ถูกต้อง',
    jsonb_build_object('attempts_left', case when v_att < 5 then 5 - v_att when v_att < 10 then 10 - v_att else 1 end,
                       'attempts_until_office', 15 - v_att)
    || case when v_spent is not null then jsonb_build_object('token_budget_left', greatest(0, 20 - v_spent)) else '{}'::jsonb end);
end;
$function$;

create or replace function analytics.worker_pin_verify(p_token_hash text, p_worker_id uuid, p_pin text, p_user_agent text DEFAULT NULL::text, p_ip_hash text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_a jsonb;
begin
  v_a := analytics.job_worker_auth(p_token_hash, null, p_ip_hash, false, false, 'pin');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  -- 0187: ตัดเนื้อไป worker_pin_verify_core (ใช้ร่วมกับ QR ร้าน) · งบผิดต่อ token ต่อวัน (<= 20) คงเดิม: คีย์ pf:<token>
  return analytics.worker_pin_verify_core((v_a ->> 'shop_id')::uuid, p_worker_id, p_pin, p_user_agent, p_ip_hash, 'pf:' || left(p_token_hash, 32), false);
end;
$function$;

-- ============================================================================
-- 4. ทะเบียนช่าง — worker_upsert รับ can_open_job / can_external (null = ไม่แตะ) · drop signature เดิม 6 arg (ข้อ 1) แล้ว re-grant
--    ไม่ส่ง flag = พฤติกรรมเดิม (เพิ่มช่างใหม่ → false · แก้ช่างเดิม → ไม่แตะ) · stages_required คงเดิม: ผู้จัดการต้องเลือกขั้นที่ทำอย่างน้อย 1 (มติ 20 ต.ค. ผู้จัดการทำบางขั้นด้วย)
-- ============================================================================
drop function if exists analytics.worker_upsert(uuid, uuid, text, text[], text, uuid);
create or replace function analytics.worker_upsert(p_shop_id uuid, p_id uuid DEFAULT NULL::uuid, p_display_name text DEFAULT NULL::text, p_stage_codes text[] DEFAULT '{}'::text[], p_pin text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid, p_can_open_job boolean DEFAULT NULL::boolean, p_can_external boolean DEFAULT NULL::boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_name  text;
  v_codes text[];
  v_pin   text;
  v_w     analytics.worker%rowtype;
  v_gen   boolean := false;
  v_flags jsonb := '{}'::jsonb;
begin
  if p_shop_id is null then
    raise exception 'worker_upsert: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'worker_upsert: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  -- ชื่อช่างผ่านด่านเดียวกับชื่อลูกค้า OEM (ห้าม control/bidi/ล่องหน) แล้วค่อยบังคับมีตัวอักษรจริง ≤ 60
  v_name := analytics.job_label_clean(analytics.oem_customer_text_clean(p_display_name, 'ชื่อช่าง'), 'ชื่อช่าง', 60);
  v_codes := analytics.worker_codes_clean(p_shop_id, p_stage_codes);
  if cardinality(v_codes) = 0 then
    raise exception 'ต้องเลือกขั้นตอนที่ช่างทำได้อย่างน้อย 1 ขั้น (ไม่รองรับ "ทุกขั้น" แบบเว้นว่างอีกต่อไป)' using errcode = '22023', hint = 'stages_required';
  end if;
  -- 0187: audit บันทึก flag เฉพาะเมื่อผู้เรียกส่งมา (ไม่ส่ง = รูปเดิมเป๊ะ)
  if p_can_open_job is not null then v_flags := v_flags || jsonb_build_object('can_open_job', p_can_open_job); end if;
  if p_can_external is not null then v_flags := v_flags || jsonb_build_object('can_external', p_can_external); end if;

  if p_id is null then
    v_pin := p_pin;
    if v_pin is null then
      v_pin := analytics.job_pin_generate();
      v_gen := true;
    elsif not analytics.job_pin_ok(v_pin) then
      raise exception 'PIN ต้องเป็นตัวเลข 4 หลัก และห้ามเป็นเลขซ้ำ/เรียงต่อเนื่อง/เดาง่าย' using errcode = '22023', hint = 'pin_invalid';
    end if;
    begin
      insert into analytics.worker (shop_id, display_name, stage_codes, pin_hash, created_by, can_open_job, can_external)
      values (p_shop_id, v_name, v_codes, extensions.crypt(v_pin, extensions.gen_salt('bf', 8)), v_actor, coalesce(p_can_open_job, false), coalesce(p_can_external, false))
      returning * into v_w;
    exception when unique_violation then
      raise exception 'มีช่างชื่อ "%" อยู่แล้ว', v_name using errcode = '22023', hint = 'worker_name_taken';
    end;
    insert into analytics.worker_audit (shop_id, worker_id, action, actor, detail)
    values (p_shop_id, v_w.id, 'create', v_actor, jsonb_build_object('display_name', v_name, 'stage_codes', to_jsonb(v_codes), 'pin_generated', v_gen) || v_flags);
    return jsonb_build_object('id', v_w.id, 'display_name', v_w.display_name, 'stage_codes', to_jsonb(v_w.stage_codes),
                              'pin', case when v_gen then v_pin else null end, 'pin_generated', v_gen,
                              'can_open_job', v_w.can_open_job, 'can_external', v_w.can_external);
  end if;

  if p_pin is not null then
    raise exception 'แก้ช่างเดิมไม่รับ PIN — ใช้ worker_pin_set เพื่อรีเซ็ต PIN' using errcode = '22023', hint = 'use_pin_set';
  end if;
  select * into v_w from analytics.worker where id = p_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'ไม่พบช่างในร้านนี้' using errcode = '22023', hint = 'worker_not_found';
  end if;
  begin
    update analytics.worker
       set display_name = v_name, stage_codes = v_codes,
           can_open_job = coalesce(p_can_open_job, can_open_job), can_external = coalesce(p_can_external, can_external)
     where id = p_id returning * into v_w;
  exception when unique_violation then
    raise exception 'มีช่างชื่อ "%" อยู่แล้ว', v_name using errcode = '22023', hint = 'worker_name_taken';
  end;
  insert into analytics.worker_audit (shop_id, worker_id, action, actor, detail)
  values (p_shop_id, p_id, 'update', v_actor, jsonb_build_object('display_name', v_name, 'stage_codes', to_jsonb(v_codes)) || v_flags);
  return jsonb_build_object('id', v_w.id, 'display_name', v_w.display_name, 'stage_codes', to_jsonb(v_w.stage_codes), 'pin', null, 'pin_generated', false,
                            'can_open_job', v_w.can_open_job, 'can_external', v_w.can_external);
end;
$function$;

-- ============================================================================
-- 5. QR ร้าน (ออฟฟิศ) — ออก/เพิกถอน/สถานะ · ค่าดิบคืนครั้งเดียวตอนออก (DB เก็บ sha256 เท่านั้น)
-- ============================================================================
create or replace function analytics.shop_intake_token_issue(p_shop_id uuid, p_actor uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_raw   text;
  v_prev  int;
  v_row   analytics.shop_intake_token%rowtype;
begin
  if p_shop_id is null then
    raise exception 'shop_intake_token_issue: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'shop_intake_token_issue: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  -- สองคนกดออกพร้อมกัน: คนหลังรอ แล้วเพิกถอนของคนแรกเอง (partial unique ยังกันซ้ำอีกชั้น)
  perform pg_advisory_xact_lock(hashtextextended('intake_token:' || p_shop_id::text, 0));
  with r as (
    update analytics.shop_intake_token set revoked_at = clock_timestamp(), revoke_reason = 'reissue'
     where shop_id = p_shop_id and revoked_at is null returning 1)
  select count(*) into v_prev from r;
  v_raw := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  insert into analytics.shop_intake_token (shop_id, token_hash, issued_by)
  values (p_shop_id, analytics.job_sha256_hex(v_raw), v_actor)
  returning * into v_row;
  return jsonb_build_object('token', v_raw, 'issued_at', v_row.issued_at, 'revoked_previous', v_prev);
end;
$function$;

create or replace function analytics.shop_intake_token_revoke(p_shop_id uuid, p_actor uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_n     int;
begin
  if p_shop_id is null then
    raise exception 'shop_intake_token_revoke: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'shop_intake_token_revoke: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('intake_token:' || p_shop_id::text, 0));
  with r as (
    update analytics.shop_intake_token set revoked_at = clock_timestamp(), revoke_reason = 'manual'
     where shop_id = p_shop_id and revoked_at is null returning 1)
  select count(*) into v_n from r;
  return jsonb_build_object('revoked', v_n);
end;
$function$;

create or replace function analytics.shop_intake_token_status(p_shop_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_row analytics.shop_intake_token%rowtype;
begin
  if p_shop_id is null then
    raise exception 'shop_intake_token_status: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  select * into v_row from analytics.shop_intake_token where shop_id = p_shop_id and revoked_at is null;
  if not found then
    return jsonb_build_object('active', false, 'issued_at', null);
  end if;
  return jsonb_build_object('active', true, 'issued_at', v_row.issued_at);
end;
$function$;

-- ============================================================================
-- 6. ทางเข้าช่างหน้างาน (สาธารณะ — พิสูจน์ตัวด้วย QR ร้าน + session ช่าง · ไม่มี p_shop_id: ร้านมาจาก token เท่านั้น)
--    session เดิม (worker_session · cookie w_session) ใช้ร่วมได้ทั้งสองทาง: ล็อกอินที่ hub แล้วสแกนใบงานได้ และกลับกัน (shop ต้องตรง)
--    ด่านจริงของทุก RPC ฝั่งช่าง = shop_intake_auth: token ร้าน active + (ถ้าบังคับ) session ช่าง active ร้านเดียวกัน — crm_require_owner_admin ปล่อย service_role ผ่านอยู่แล้ว จึงไม่ใช่ด่านของทางนี้
--    เพดาน (ทีมตั้ง ไม่ใช่ค่าเจ้าของ · หน้าต่าง 10 นาที): siv hub 120 · sis ค้นสินค้า 240 · sip PIN 60 (+ ipp ต่อ IP 100 ร่วมกับ QR ใบงาน) · sio เปิดใบ 20 (+ ipw ต่อ IP 300) · wo ต่อช่าง 10
--    ไม่มีงบ "ผิด 20/วัน/token" ที่ QR ร้าน — ใครก็ล็อกทั้งร้านได้ (พึ่งล็อกต่อช่าง + rate limit ต่อ IP)
-- ============================================================================
create or replace function analytics.shop_intake_auth(p_token_hash text, p_session_hash text, p_ip_hash text, p_require_session boolean, p_class text)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_tok analytics.shop_intake_token%rowtype;
  v_w   analytics.worker%rowtype;
  v_key text;
  v_max int;
begin
  if p_class is null or p_class not in ('hub', 'search', 'pin', 'open') then
    raise exception 'shop_intake_auth: class ไม่ถูกต้อง' using errcode = '22023';
  end if;
  -- ต่อ IP ก่อน (ช่องทางที่ "ตรวจ PIN"/"สร้างข้อมูล") — ใช้ถังเดียวกับ QR ใบงาน: ipp (100) / ipw (300)
  if p_class in ('pin', 'open') and p_ip_hash is not null and p_ip_hash ~ '^[0-9a-f]{64}$' then
    if not analytics.job_rate_limit_hit(case p_class when 'pin' then 'ipp:' else 'ipw:' end || left(p_ip_hash, 32), case p_class when 'pin' then 100 else 300 end) then
      return analytics.job_fail('rate_limited', 'ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
    end if;
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return analytics.job_fail('invalid_token', 'QR ร้านนี้ใช้ไม่ได้แล้ว');
  end if;
  select * into v_tok from analytics.shop_intake_token t where t.token_hash = p_token_hash;
  if not found then
    -- token สุ่ม: ไม่เขียนอะไรลงถัง (กันตารางบวมจากการยิงสุ่ม) — ข้อความเดียวกับ "ถูกเพิกถอน" (ไม่บอกผู้สแกนว่า token เคยมีจริงไหม)
    return analytics.job_fail('invalid_token', 'QR ร้านนี้ใช้ไม่ได้แล้ว');
  end if;
  v_key := case p_class when 'hub' then 'siv:' when 'search' then 'sis:' when 'pin' then 'sip:' else 'sio:' end || left(p_token_hash, 32);
  v_max := case p_class when 'hub' then 120 when 'search' then 240 when 'pin' then 60 else 20 end;
  if not analytics.job_rate_limit_hit(v_key, v_max) then
    return analytics.job_fail('rate_limited', 'ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
  end if;
  if v_tok.revoked_at is not null then
    return analytics.job_fail('invalid_token', 'QR ร้านนี้ใช้ไม่ได้แล้ว');
  end if;

  if p_session_hash is not null and p_session_hash ~ '^[0-9a-f]{64}$' then
    select w.* into v_w
      from analytics.worker_session s
      join analytics.worker w on w.id = s.worker_id and w.shop_id = s.shop_id
     where s.session_hash = p_session_hash and s.revoked_at is null and s.expires_at > now()
       and w.is_active and w.shop_id = v_tok.shop_id;
  end if;
  if p_require_session and v_w.id is null then
    return analytics.job_fail('session_required', 'กรุณาเลือกชื่อและใส่ PIN ก่อน');
  end if;
  return jsonb_build_object('ok', true, 'shop_id', v_tok.shop_id, 'worker_id', v_w.id, 'worker_name', v_w.display_name,
                            'can_open', coalesce(v_w.can_open_job, false),
                            'session_expired', p_session_hash is not null and p_session_hash ~ '^[0-9a-f]{64}$' and v_w.id is null);
end;
$function$;

-- 6.1 hub: ไม่มี session → รายชื่อช่างที่ can_open_job (มติ Q8: ไม่โชว์ทุกคน — QR ติดผนัง) · มี session → ช่างคนนั้น + open_allowed
--     profile_ready / gold_profile_ready (UX C.3 R1): ให้ hub รู้ก่อนผู้จัดการกรอกฟอร์มยาวว่าร้านพร้อมสร้างใบงานเงิน/ทองหรือยัง
create or replace function analytics.shop_intake_resolve(p_token_hash text, p_session_hash text DEFAULT NULL::text, p_ip_hash text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_a       jsonb;
  v_shop    uuid;
  v_workers jsonb;
  v_pr      boolean;
  v_gr      boolean;
begin
  v_a := analytics.shop_intake_auth(p_token_hash, p_session_hash, p_ip_hash, false, 'hub');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_shop := (v_a ->> 'shop_id')::uuid;
  v_pr := analytics.job_profile_default_for(v_shop, 'silver') is not null;
  v_gr := analytics.job_profile_default_for(v_shop, 'gold') is not null;
  if nullif(v_a ->> 'worker_id', '') is null then
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'display_name', x.display_name) order by x.display_name), '[]'::jsonb)
      into v_workers
      from (select w.id, w.display_name from analytics.worker w
             where w.shop_id = v_shop and w.is_active and w.can_open_job
             order by w.display_name limit 50) x;
    return jsonb_build_object('ok', true, 'state', 'identify', 'workers', v_workers,
                              'profile_ready', v_pr, 'gold_profile_ready', v_gr, 'session_expired', (v_a ->> 'session_expired')::boolean);
  end if;
  return jsonb_build_object('ok', true, 'state', 'ready',
                            'worker', jsonb_build_object('id', v_a ->> 'worker_id', 'display_name', v_a ->> 'worker_name'),
                            'open_allowed', (v_a ->> 'can_open')::boolean,
                            'profile_ready', v_pr, 'gold_profile_ready', v_gr);
end;
$function$;

-- 6.2 ตรวจ PIN ทาง QR ร้าน — core เดียวกับ QR ใบงาน (นโยบายล็อกเดียว) · รับเฉพาะช่างที่ can_open_job · ไม่มีงบผิด/วัน/token
create or replace function analytics.worker_pin_verify_intake(p_token_hash text, p_worker_id uuid, p_pin text, p_user_agent text DEFAULT NULL::text, p_ip_hash text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_a jsonb;
begin
  v_a := analytics.shop_intake_auth(p_token_hash, null, p_ip_hash, false, 'pin');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  return analytics.worker_pin_verify_core((v_a ->> 'shop_id')::uuid, p_worker_id, p_pin, p_user_agent, p_ip_hash, null, true);
end;
$function$;

-- 6.3 ค้นสินค้าให้ผู้จัดการเลือก — เฉพาะ can_open_job · คอลัมน์ระบุเอง (ไม่มีราคา/ต้นทุน/ชนิดต้นทุน/make_spec ดิบ) · active · ไม่ใช่ live* · ≤ 20 แถว
--     prefill {metal, purity, weight_g, metal_known}: จาก production_item_spec (helper เดียวกับใบผลิต) · น้ำหนักมีเฉพาะเงิน (น้ำหนักทอง/ทองเหลืองไม่ส่ง — N1)
create or replace function analytics.job_product_search(p_token_hash text, p_session_hash text, p_q text, p_ip_hash text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_a     jsonb;
  v_shop  uuid;
  v_q     text;
  v_like  text;
  v_pre   text;
  v_items jsonb;
begin
  v_a := analytics.shop_intake_auth(p_token_hash, p_session_hash, p_ip_hash, true, 'search');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  if not (v_a ->> 'can_open')::boolean then
    return analytics.job_fail('not_allowed', 'บัญชีนี้ไม่มีสิทธิ์เปิดงานใหม่ — แจ้งออฟฟิศ');
  end if;
  v_shop := (v_a ->> 'shop_id')::uuid;
  v_q := nullif(btrim(coalesce(p_q, ''), E' \t\r\n'), '');
  if v_q is null then
    return jsonb_build_object('ok', true, 'items', '[]'::jsonb);
  end if;
  if length(v_q) > 60 or v_q ~ '[[:cntrl:]<>]' or not analytics.oem_note_valid(v_q) then
    return analytics.job_fail('q_invalid', 'คำค้นไม่ถูกต้อง');
  end if;
  -- escape ตัวแทน LIKE (% _ \) — ผู้ใช้พิมพ์ "%" ต้องไม่กลายเป็นดึงทั้งแคตตาล็อก
  v_like := '%' || replace(replace(replace(v_q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  v_pre := replace(replace(replace(v_q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'sku', t.sku, 'name', t.name, 'image_path', t.image_path,
           'prefill', jsonb_build_object('metal', t.metal, 'purity', t.purity, 'weight_g', t.weight_g, 'metal_known', t.metal_known))
         order by t.ord), '[]'::jsonb)
    into v_items
    from (
      select row_number() over (order by (p.sku ilike v_pre escape E'\\') desc, p.sku) as ord,
             p.id, p.sku, p.name,
             (select coalesce(pi.variant_sm_path, pi.storage_path) from public.product_image pi
               where pi.shop_id = p.shop_id and pi.product_id = p.id order by pi.sort_order, pi.created_at, pi.id limit 1) as image_path,
             coalesce(s.metal, 'silver') as metal,
             case when s.metal is null then 0.925 else s.purity end as purity,
             case when s.metal = 'silver' then s.weight_g end as weight_g,
             coalesce((p.make_spec ->> 'metal') in ('silver', 'gold', 'brass') or p.cost_type = 'spot', false) as metal_known
        from public.product p
        cross join lateral analytics.production_item_spec(null::analytics.production_order_item, p, true) s
       where p.shop_id = v_shop and p.is_active and p.sku !~* '^live'
         and (p.sku ilike v_like escape E'\\' or p.name ilike v_like escape E'\\')
       order by (p.sku ilike v_pre escape E'\\') desc, p.sku
       limit 20) t;
  return jsonb_build_object('ok', true, 'items', v_items);
end;
$function$;

-- 6.4 เปิดใบผลิต + ใบงาน + QR ใบงาน ทรานแซกชันเดียว (มี SKU หรือไม่มี SKU) — ผลสำเร็จ/ล้มทั้งก้อน · ไม่มีเงินใดๆ ในผลลัพธ์
--     ลำดับ: auth (token+session+can_open_job สด) → rate limit (ก่อนแตะข้อมูล) → validate → advisory lock ต่อ idem key → idem (ซ้ำ = ใบเดิม ไม่ออก token ใหม่ · key ของช่างอื่น = ปฏิเสธ)
--            → [sub-block: SKU มีใบงานเปิดอยู่ = job_exists · ใบผลิต(opened_via=shopfloor) → item_set (0186) → ใบงาน (core) → QR (core) → event] · ล้มใน sub-block = ถอยทั้งก้อน (ไม่เหลือ PO เปล่า · ตัวนับไม่ขยับ)
--     rate limit ที่นับไปแล้วยังอยู่แม้ล้ม (ตั้งใจ — กันยิงซ้ำ) เพราะฟังก์ชันคืนผลปกติไม่ raise
create or replace function analytics.job_worker_open(p_token_hash text, p_session_hash text, p_idem_key text, p_product_id uuid DEFAULT NULL::uuid, p_pending_label text DEFAULT NULL::text, p_metal text DEFAULT NULL::text, p_purity numeric DEFAULT NULL::numeric, p_weight_g numeric DEFAULT NULL::numeric, p_qty_order integer DEFAULT NULL::integer, p_qty_planned integer DEFAULT NULL::integer, p_due_date date DEFAULT NULL::date, p_is_new_design boolean DEFAULT NULL::boolean, p_note text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_ip_hash text DEFAULT NULL::text)
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
begin
  v_a := analytics.shop_intake_auth(p_token_hash, p_session_hash, p_ip_hash, true, 'open');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_shop := (v_a ->> 'shop_id')::uuid;
  v_wid := (v_a ->> 'worker_id')::uuid;
  -- สิทธิ์ตรวจสดจาก DB ทุกครั้ง (ออฟฟิศถอนสิทธิ์ระหว่างกรอก = ปฏิเสธ) · ก่อน rate limit ของช่าง เพื่อไม่ให้คนไม่มีสิทธิ์กินถังช่างตัวจริง
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
      return analytics.job_fail('name_invalid', 'ชื่อแบบไม่ถูกต้อง — ห้ามเว้นว่าง ห้ามขึ้นบรรทัดใหม่/อักขระล่องหน/เครื่องหมาย < > และยาวไม่เกิน 200 ตัวอักษร');
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

  -- กดซ้ำ/เน็ตสะดุด: key เดียวกันจากช่างคนเดียวกัน = ใบเดิม (ไม่ออก QR ซ้ำ — QR แสดงซ้ำไม่ได้ เก็บ hash) · key เดียวกันจากช่างอื่น = ปฏิเสธ
  perform pg_advisory_xact_lock(hashtextextended('intake:' || v_shop::text || ':' || p_idem_key, 0));
  select * into v_po from analytics.production_order po where po.shop_id = v_shop and po.intake_idem_key = p_idem_key;
  if found then
    if v_po.opened_by_worker_id is distinct from v_wid then
      return analytics.job_fail('idem_conflict', 'คำขอนี้ซ้ำกับของคนอื่น — โหลดหน้าใหม่แล้วลองอีกครั้ง');
    end if;
    select j.* into v_jobrow
      from analytics.job j join analytics.production_order_item i on i.id = j.production_order_item_id
     where i.production_order_id = v_po.id and j.parent_job_id is null order by j.created_at limit 1;
    return jsonb_build_object('ok', true, 'already', true, 'po_no', v_po.po_no, 'job_no', v_jobrow.job_no,
                              'design_label', v_jobrow.design_label, 'metal', v_jobrow.metal, 'qty_order', v_jobrow.qty_order);
  end if;

  begin
    -- Q7: SKU นี้มีใบงานเปิดอยู่แล้ว = บล็อก (ใบเดียวต่อ SKU ในหน้างาน — ต้องการล็อตที่ 2 ให้แจ้งออฟฟิศ)
    if p_product_id is not null then
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
    v_job := analytics.job_create_from_production_item_core(v_shop, v_item_id, v_codes, p_due_date, null, v_note, null, v_wid, v_planned, null, null, null, null);
    select * into v_jobrow from analytics.job where id = (v_job ->> 'job_id')::uuid;
    v_tok := analytics.job_token_issue_core(v_jobrow, false, null, v_wid, 'traveler', null);
    perform analytics.job_event_write(v_jobrow.id, null, 'intake_open', v_today, null, v_wid, 'worker_qr', analytics.job_device_hint(p_user_agent, p_ip_hash),
      jsonb_build_object('po_no', v_po.po_no, 'sku_pending', p_product_id is null, 'metal', v_jobrow.metal,
                         'qty_order', p_qty_order, 'qty_planned', v_planned, 'is_new_design', v_new));
  exception when sqlstate '22023' then
    get stacked diagnostics v_hint = pg_exception_hint;
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

  return jsonb_build_object('ok', true, 'already', false, 'po_no', v_po.po_no, 'job_no', v_jobrow.job_no, 'token', v_tok ->> 'token',
                            'design_label', v_jobrow.design_label, 'sku', v_jobrow.sku_snapshot, 'sku_pending', v_jobrow.product_id is null,
                            'metal', v_jobrow.metal, 'qty_order', v_jobrow.qty_order, 'qty_planned', v_jobrow.qty_planned,
                            'is_new_design', v_new, 'due_date', v_jobrow.due_date);
end;
$function$;

-- ============================================================================
-- 7. ออฟฟิศรับทราบ + ด่านปิดใบ — ใบที่เปิดจากหน้างานปิด (done) ไม่ได้จนกว่าออฟฟิศรับทราบ · รายการไม่มี SKU ปิดไม่ได้เสมอ
--    ด่านอยู่ใน trigger (BEFORE UPDATE open→done) — ไม่แก้ production_order_done แม้บรรทัดเดียว (md5 ล็อกท้ายไฟล์ · ฟังก์ชัน 💰)
--    ใบที่ออฟฟิศเปิด (opened_via='office' เดิมทุกใบ) ไม่ติดด่านรับทราบ
-- ============================================================================
create or replace function analytics.production_order_acknowledge(p_shop_id uuid, p_id uuid, p_actor uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_po    analytics.production_order%rowtype;
  v_n     int := 0;
  r       record;
begin
  if p_shop_id is null or p_id is null then
    raise exception 'production_order_acknowledge: p_shop_id และ p_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'production_order_acknowledge: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  select * into v_po from analytics.production_order where id = p_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'ไม่พบใบผลิตในร้านนี้' using errcode = '22023', hint = 'order_not_found';
  end if;
  if v_po.opened_via <> 'shopfloor' then
    raise exception 'ใบผลิต % เปิดโดยออฟฟิศ ไม่ต้องรับทราบ', v_po.po_no using errcode = '22023', hint = 'not_shopfloor';
  end if;
  if v_po.acknowledged_at is not null then
    raise exception 'ใบผลิต % รับทราบไปแล้ว', v_po.po_no using errcode = '22023', hint = 'already_acknowledged';
  end if;
  if v_po.status <> 'open' then
    raise exception 'ใบผลิต % สถานะ % แล้ว รับทราบไม่ได้', v_po.po_no, v_po.status using errcode = '22023', hint = 'order_not_open';
  end if;
  perform set_config('analytics.po_ack', p_id::text, true);
  update analytics.production_order set acknowledged_at = now(), acknowledged_by = v_actor, updated_at = now() where id = p_id returning * into v_po;
  perform set_config('analytics.po_ack', '', true);
  -- บันทึกลงประวัติของใบงานแม่ที่ยังไม่ยกเลิก (ดูย้อนหลังได้บนใบงาน)
  for r in
    select j.id from analytics.job j join analytics.production_order_item i on i.id = j.production_order_item_id
     where i.production_order_id = p_id and j.parent_job_id is null and j.status <> 'cancelled'
  loop
    perform analytics.job_event_write(r.id, null, 'ack', analytics.job_today(), v_actor, null, 'job_page', null, jsonb_build_object('po_no', v_po.po_no));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'production_order_id', p_id, 'po_no', v_po.po_no, 'acknowledged_at', v_po.acknowledged_at, 'jobs_logged', v_n);
end;
$function$;

create or replace function analytics.production_order_close_gate()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
begin
  if old.status = 'open' and new.status = 'done' then
    if new.opened_via = 'shopfloor' and new.acknowledged_at is null then
      raise exception 'ใบผลิต % เปิดจากหน้างาน — ให้ออฟฟิศรับทราบก่อน แล้วค่อยกดผลิตเสร็จ', new.po_no using errcode = '22023', hint = 'ack_required';
    end if;
    -- ชั้นซ้ำกับ production_order_done (0186 sku_required): ทางอื่นที่เปลี่ยนสถานะเป็น done (เช่น ปิดแบบงวดในอนาคต) ก็ผ่านด่านนี้
    if exists (select 1 from analytics.production_order_item i where i.production_order_id = new.id and i.product_id is null) then
      raise exception 'ใบผลิต % ยังมีรายการที่ไม่มี SKU — ผูก SKU ก่อนปิดใบ', new.po_no using errcode = '22023', hint = 'sku_required';
    end if;
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_production_order_close_gate on analytics.production_order;
create trigger trg_production_order_close_gate before update on analytics.production_order
  for each row when (old.status = 'open' and new.status = 'done') execute function analytics.production_order_close_gate();

-- ============================================================================
-- 8. view ใบผลิต — ต่อท้ายคอลัมน์ (42P16: คอลัมน์เดิมต้องเป็น prefix ลำดับเดิม) · ลอก select list จาก DB สด (0186 ไม่ได้แก้ view นี้) · ต้องระบุ security_invoker ซ้ำ (replace รีเซ็ต reloptions)
-- ============================================================================
create or replace view analytics.v_production_order with (security_invoker = true) as
 select po.id,
    po.shop_id,
    po.po_no,
    po.status,
    po.note,
    po.spot_override_thb_per_gram,
    po.done_at,
    po.cancelled_at,
    po.cancel_reason,
    po.created_by,
    po.created_at,
    po.updated_at,
    coalesce(i.item_count, 0::bigint) as item_count,
    coalesce(i.qty_planned_total, 0::bigint) as qty_planned_total,
    coalesce(i.qty_done_total, 0::bigint) as qty_done_total,
    po.opened_via,
    po.opened_by_worker_id,
    w.display_name as opened_by_worker_name,
    po.acknowledged_at,
    po.acknowledged_by,
    coalesce(i.unbound_item_count, 0::bigint) as unbound_item_count
   from analytics.production_order po
     left join (select production_order_item.production_order_id,
            count(*) as item_count,
            sum(production_order_item.qty_planned) as qty_planned_total,
            sum(production_order_item.qty_done) as qty_done_total,
            count(*) filter (where production_order_item.product_id is null) as unbound_item_count
           from analytics.production_order_item
          group by production_order_item.production_order_id) i on i.production_order_id = po.id
     left join analytics.worker w on w.id = po.opened_by_worker_id and w.shop_id = po.shop_id;

-- ============================================================================
-- 9. ออฟฟิศ — ผูก SKU ทีหลัง + แก้ชื่อแบบก่อนผูก (R2) สำหรับรายการที่ช่างเปิดโดยไม่มี SKU
-- ============================================================================

-- 9.1 ผูก SKU: รายการยังไม่มี SKU · ใบ open · SKU active ไม่ใช่ live* · ไม่ชนรายการอื่นในใบ · ผูกแล้วแก้ไม่ได้ (already_bound)
--     🔴 security: trigger ล็อกโลหะของรายการเช็คเฉพาะตอน metal เปลี่ยน → ที่นี่ "ประทับ" ค่าที่มีผลลงแถวก่อน/พร้อมผูก (metal ไม่ว่างอยู่แล้วตาม CHECK · purity ว่างไม่ได้สำหรับทอง/ทองเหลือง ·
--     เงินน้ำหนักว่าง + SKU มีน้ำหนักเงิน → ประทับเป็น 'product' แบบเปิดเผยและคืน weight_filled) — ไม่ปล่อยให้ค่าที่ "มีผล" เปลี่ยนเงียบๆ จากการเปลี่ยน product_id · trigger ก็ขยายให้เทียบ effective ตอน product_id เปลี่ยนด้วย (ชั้นสอง)
--     ไม่ทับ metal/purity/weight ที่กรอกไว้ · เตือน (flag metal_mismatch) เมื่อโลหะที่ SKU ระบุชัด (metal_known) ≠ โลหะของรายการ — ไม่บล็อก (มติ Q4: เตือนเฉพาะ SKU ที่ระบุโลหะ)
--     ใบงาน (แม่+ทุกส่วนที่ไม่ยกเลิก): product_id/sku_snapshot เติมผ่านช่องแคบของ job_guard (GUC + เงื่อนไขเดิมว่าง→มีค่า) · design_label ไม่เปลี่ยน · event edit
create or replace function analytics.production_order_item_bind_product(p_shop_id uuid, p_item_id uuid, p_product_id uuid, p_actor uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_actor   uuid := coalesce(p_actor, auth.uid());
  v_po      analytics.production_order%rowtype;
  v_item    analytics.production_order_item%rowtype;
  v_product public.product%rowtype;
  v_before  record;
  v_skuspec record;
  v_known   boolean;
  v_purity  numeric;
  v_weight  numeric;
  v_wsrc    text;
  v_filled  boolean := false;
  v_n       int := 0;
  v_label   text;
  r         record;
begin
  if p_shop_id is null or p_item_id is null or p_product_id is null then
    raise exception 'production_order_item_bind_product: p_shop_id, p_item_id, p_product_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'production_order_item_bind_product: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  -- ล็อกใบก่อนแล้วค่อยรายการ (ลำดับเดียวกับ production_order_item_set)
  select po.* into v_po from analytics.production_order po join analytics.production_order_item i on i.production_order_id = po.id
   where i.id = p_item_id and po.shop_id = p_shop_id for update of po;
  if not found then
    raise exception 'ไม่พบรายการในใบผลิตของร้านนี้' using errcode = '22023', hint = 'item_not_found';
  end if;
  select * into v_item from analytics.production_order_item where id = p_item_id for update;
  if v_po.status <> 'open' then
    raise exception 'ใบผลิต % สถานะ % แล้ว ผูก SKU ไม่ได้', v_po.po_no, v_po.status using errcode = '22023', hint = 'order_not_open';
  end if;
  if v_item.product_id is not null then
    raise exception 'รายการนี้ผูก SKU แล้ว — ผูกซ้ำ/เปลี่ยนไม่ได้' using errcode = '22023', hint = 'already_bound';
  end if;
  select * into v_product from public.product where id = p_product_id and shop_id = p_shop_id;
  if not found then
    raise exception 'ไม่พบ SKU ในร้านนี้' using errcode = '22023', hint = 'sku_not_found';
  end if;
  if not v_product.is_active then
    raise exception 'SKU % ปิดใช้งานแล้ว ผูกไม่ได้', v_product.sku using errcode = '22023', hint = 'sku_inactive';
  end if;
  if v_product.sku ~* '^live' then
    raise exception 'SKU % เป็น SKU เฉพาะไลฟ์ (live*) ผูกกับใบผลิตไม่ได้', v_product.sku using errcode = '22023', hint = 'sku_live';
  end if;
  if exists (select 1 from analytics.production_order_item o where o.production_order_id = v_item.production_order_id and o.product_id = p_product_id) then
    raise exception 'SKU % อยู่ในใบผลิตนี้แล้ว (รายการอื่น)', v_product.sku using errcode = '22023', hint = 'sku_duplicate';
  end if;

  -- ค่าที่มีผลก่อนผูก (ไม่มี SKU ⇒ ใช้ค่าจากรายการล้วน) → ประทับลงแถว
  select s.metal, s.purity, s.weight_g, s.weight_source into v_before from analytics.production_item_spec(v_item, null::public.product, true) s;
  select s.metal, s.purity, s.weight_g, s.weight_source into v_skuspec from analytics.production_item_spec(null::analytics.production_order_item, v_product, true) s;
  v_known := coalesce((v_product.make_spec ->> 'metal') in ('silver', 'gold', 'brass') or v_product.cost_type = 'spot', false);
  v_purity := coalesce(v_item.purity, v_before.purity);
  v_weight := v_item.weight_g;
  v_wsrc := v_item.weight_source;
  if v_weight is null and v_before.metal = 'silver' and v_product.silver_weight_g > 0 then
    v_weight := round(v_product.silver_weight_g, 3);
    v_wsrc := 'product';
    v_filled := true;
  end if;
  v_label := v_item.pending_product_label;

  update analytics.production_order_item
     set product_id = p_product_id, pending_product_label = null, metal = coalesce(v_item.metal, v_before.metal), purity = v_purity,
         weight_g = v_weight, weight_source = v_wsrc, updated_at = now()
   where id = p_item_id;

  perform set_config('analytics.job_bind_item', p_item_id::text, true);
  for r in
    update analytics.job set product_id = p_product_id, sku_snapshot = v_product.sku
     where production_order_item_id = p_item_id and shop_id = p_shop_id and status <> 'cancelled' and product_id is null
     returning id, parent_job_id
  loop
    perform analytics.job_event_write(r.id, null, 'edit', analytics.job_today(), v_actor, null, 'job_page', null,
      jsonb_build_object('field', 'sku', 'before', null, 'after', v_product.sku, 'label_before', v_label, 'item_id', p_item_id));
    v_n := v_n + 1;
  end loop;
  perform set_config('analytics.job_bind_item', '', true);

  return jsonb_build_object('ok', true, 'item_id', p_item_id, 'product_id', p_product_id, 'sku', v_product.sku, 'name', v_product.name,
                            'pending_product_label_before', v_label, 'jobs_updated', v_n,
                            'item_metal', coalesce(v_item.metal, v_before.metal), 'sku_metal', v_skuspec.metal, 'sku_metal_known', v_known,
                            'metal_mismatch', v_known and v_skuspec.metal is distinct from coalesce(v_item.metal, v_before.metal),
                            'weight_filled', v_filled);
end;
$function$;

-- 9.2 แก้ชื่อแบบก่อนผูก (UX C.3 R2): เฉพาะรายการที่ยังไม่มี SKU · ใบ open · ชื่อผ่านด่านเดียวกับ production_order_item_set (+ ยุบช่องว่างซ้อน) · ไม่ชนชื่อรายการอื่นในใบ
--     ไม่แตะ job.design_label (ใบงานใช้ job_design_label_set เดิม) · เก็บเฉพาะค่าใหม่ — รายการเปลี่ยนแล้วย้อนไม่ได้นอกจากแก้อีกครั้ง
create or replace function analytics.production_order_item_label_set(p_shop_id uuid, p_item_id uuid, p_label text, p_actor uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_po    analytics.production_order%rowtype;
  v_item  analytics.production_order_item%rowtype;
  v_label text;
begin
  if p_shop_id is null or p_item_id is null then
    raise exception 'production_order_item_label_set: p_shop_id และ p_item_id จำเป็น' using errcode = '22023';
  end if;
  v_label := regexp_replace(analytics.job_label_clean(p_label, 'ชื่อแบบ', 200), '\s+', ' ', 'g');
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'production_order_item_label_set: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  select po.* into v_po from analytics.production_order po join analytics.production_order_item i on i.production_order_id = po.id
   where i.id = p_item_id and po.shop_id = p_shop_id for update of po;
  if not found then
    raise exception 'ไม่พบรายการในใบผลิตของร้านนี้' using errcode = '22023', hint = 'item_not_found';
  end if;
  select * into v_item from analytics.production_order_item where id = p_item_id for update;
  if v_po.status <> 'open' then
    raise exception 'ใบผลิต % สถานะ % แล้ว แก้ชื่อแบบไม่ได้', v_po.po_no, v_po.status using errcode = '22023', hint = 'order_not_open';
  end if;
  if v_item.product_id is not null then
    raise exception 'รายการนี้ผูก SKU แล้ว — ชื่อแบบใช้ชื่อสินค้าของ SKU' using errcode = '22023', hint = 'already_bound';
  end if;
  if exists (select 1 from analytics.production_order_item o
              where o.production_order_id = v_item.production_order_id and o.id <> p_item_id and o.product_id is null and lower(o.pending_product_label) = lower(v_label)) then
    raise exception 'มีรายการชื่อ "%" ในใบนี้อยู่แล้ว', v_label using errcode = '22023', hint = 'label_duplicate';
  end if;
  update analytics.production_order_item set pending_product_label = v_label, updated_at = now() where id = p_item_id;
  return jsonb_build_object('ok', true, 'item_id', p_item_id, 'pending_product_label', v_label);
end;
$function$;

-- ============================================================================
-- 10. สิทธิ์ — service_role เท่านั้น (ข้อ 2, 7, 18, 18.1) · ปิดทุกตัวที่ไฟล์นี้แตะก่อนแล้วเปิดเฉพาะ RPC ที่ตั้งใจ · core/helper/trigger = ไม่เปิดใคร (owner เท่านั้น)
-- ============================================================================
do $g$
declare
  r record;
  v_touched constant text[] := array[
    'worker_upsert', 'worker_pin_verify', 'worker_pin_verify_core', 'worker_pin_verify_intake',
    'job_create_insert', 'job_create_from_production_item', 'job_create_from_production_item_core', 'job_token_issue', 'job_token_issue_core',
    'job_guard', 'job_token_guard', 'production_order_deny_mutation', 'production_order_item_deny_mutation',
    'shop_intake_token_guard', 'shop_intake_token_issue', 'shop_intake_token_revoke', 'shop_intake_token_status', 'shop_intake_auth', 'shop_intake_resolve',
    'job_product_search', 'job_worker_open', 'production_order_acknowledge', 'production_order_close_gate',
    'production_order_item_bind_product', 'production_order_item_label_set'];
  v_rpc constant text[] := array[
    'worker_upsert', 'worker_pin_verify', 'worker_pin_verify_intake', 'job_create_from_production_item', 'job_token_issue',
    'shop_intake_token_issue', 'shop_intake_token_revoke', 'shop_intake_token_status', 'shop_intake_resolve',
    'job_product_search', 'job_worker_open', 'production_order_acknowledge',
    'production_order_item_bind_product', 'production_order_item_label_set'];
  v_dup text;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace and p.proname = any (v_touched)
  loop
    -- ชื่อทั้งสี่เสมอ: public/anon/authenticated มาจากคนละทาง (ข้อ 18.1)
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname = any (v_rpc) then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
  -- trigger function เดิมที่เคยมี service_role (production_order_*_deny_mutation) — คงสิทธิ์เดิมไว้ ไม่ให้ replace ทำให้ trigger ของ service_role พัง (ข้อ 18.5)
  execute 'grant execute on function analytics.production_order_deny_mutation() to service_role';
  execute 'grant execute on function analytics.production_order_item_deny_mutation() to service_role';
  -- view ที่ replace
  revoke all on analytics.v_production_order from public, anon, authenticated, service_role;
  grant select on analytics.v_production_order to service_role;
  -- ห้ามมี overload (ข้อ 1) ในชื่อที่ไฟล์นี้แตะ
  select string_agg(proname, ', ') into v_dup from (
    select proname from pg_proc where pronamespace = 'analytics'::regnamespace and proname = any (v_touched)
    group by proname having count(*) > 1) d;
  if v_dup is not null then
    raise exception '0187 post: เกิด overload ของ % — หยุด รายงาน อย่าลบเอง (ข้อ 1)', v_dup;
  end if;
end;
$g$;

-- ============================================================================
-- 11. ตรวจหลังลง (ล้ม = raise = ทั้งไฟล์ถอยหมด): ข้อมูลเดิมไม่ขยับ · ฟังก์ชัน 💰 ไม่ถูกแตะ · ไม่มี anon/authenticated execute
-- ============================================================================
do $post$
declare
  v_b      record;
  v_now    text;
  v_acl    text;
begin
  select * into v_b from _m187_base;
  -- 💰 production_order_done ต้อง "ไม่เปลี่ยนแม้ไบต์เดียว" (ด่านปิดใบอยู่ใน trigger)
  select md5(pg_get_functiondef(p.oid)) into v_now from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'production_order_done';
  if v_now <> v_b.done_md5 then raise exception '0187 post: production_order_done md5 เปลี่ยน — ห้ามแตะ (ฟังก์ชัน 💰)'; end if;
  -- ไม่ UPDATE แถวเดิมเลย (ข้อ 19): ตารางที่เพิ่มคอลัมน์/ปรับ nullability
  select coalesce(md5(string_agg((to_jsonb(po) - 'opened_via' - 'opened_by_worker_id' - 'intake_idem_key' - 'acknowledged_at' - 'acknowledged_by')::text, '|' order by po.id)), '') into v_now from analytics.production_order po;
  if v_now <> v_b.po_md5 then raise exception '0187 post: production_order เดิมขยับ'; end if;
  select coalesce(md5(string_agg((to_jsonb(j) - 'opened_by_worker_id')::text, '|' order by j.id)), '') into v_now from analytics.job j;
  if v_now <> v_b.job_md5 then raise exception '0187 post: job เดิมขยับ'; end if;
  select coalesce(md5(string_agg((to_jsonb(t) - 'issued_by_worker_id')::text, '|' order by t.id)), '') into v_now from analytics.job_token t;
  if v_now <> v_b.tok_md5 then raise exception '0187 post: job_token เดิมขยับ'; end if;
  select coalesce(md5(string_agg((to_jsonb(w) - 'can_open_job')::text, '|' order by w.id)), '') into v_now from analytics.worker w;
  if v_now <> v_b.worker_md5 then raise exception '0187 post: worker เดิมขยับ'; end if;
  select coalesce(md5(string_agg(e::text, '|' order by e.id)), '') into v_now from analytics.job_event e;
  if v_now <> v_b.event_md5 then raise exception '0187 post: job_event เดิมขยับ'; end if;
  select coalesce(md5(string_agg(poi::text, '|' order by poi.id)), '') into v_now from analytics.production_order_item poi;
  if v_now <> v_b.poi_md5 then raise exception '0187 post: production_order_item เดิมขยับ'; end if;
  select coalesce(md5(string_agg(p::text, '|' order by p.id)), '') into v_now from public.product p;
  if v_now <> v_b.product_md5 then raise exception '0187 post: public.product ขยับ'; end if;
  if (select coalesce(sum(last_no), 0) from analytics.job_counter) <> v_b.jc_sum or (select coalesce(sum(last_no), 0) from analytics.production_order_counter) <> v_b.pc_sum then
    raise exception '0187 post: ตัวนับเลขขยับ';
  end if;
  if exists (select 1 from analytics.worker where can_open_job) then raise exception '0187 post: ไม่ควรมีใครถือสิทธิ์ can_open_job ตอน apply'; end if;
  if exists (select 1 from analytics.production_order where opened_via <> 'office' or acknowledged_at is not null) then raise exception '0187 post: ใบผลิตเดิมต้องเป็น office ทั้งหมด'; end if;
  -- กำแพง: RPC/core/trigger ที่ไฟล์นี้สร้างต้อง anon/authenticated/public เรียกไม่ได้ (ตรวจจริงด้วย has_function_privilege)
  for v_acl in
    select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace
       and p.proname in ('worker_upsert', 'worker_pin_verify', 'worker_pin_verify_core', 'worker_pin_verify_intake', 'job_create_insert', 'job_create_from_production_item', 'job_create_from_production_item_core',
                         'job_token_issue', 'job_token_issue_core', 'shop_intake_token_issue', 'shop_intake_token_revoke', 'shop_intake_token_status', 'shop_intake_auth', 'shop_intake_resolve',
                         'job_product_search', 'job_worker_open', 'production_order_acknowledge', 'production_order_close_gate', 'production_order_item_bind_product', 'production_order_item_label_set')
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
  loop
    raise exception '0187 post: % เปิดให้ anon/authenticated (ข้อ 18)', v_acl;
  end loop;
end;
$post$;

-- ============================================================================
-- หนี้/ข้อจำกัด/ตัดสินใจเอง (นอกเหนือบรีฟ — รายงานแล้ว)
--  • ไม่มี soft-remove รายการไม่มี SKU ที่ใบงานยกเลิกหมด (R2 ข้อสุดท้าย): ต้องกรองรายการที่ถอนในเส้นต้นทุน (done/preview/view/นับยอด) = แตะ production_order_done 💰 → หยุดตามบรีฟ · ทางออกเดิม: ยกเลิกทั้งใบผลิตแล้วเปิดใหม่
--  • ไม่มี job_worker_open_cancel ("เปิดผิด? ยกเลิกใบนี้" ก4) — นอกรายการ RPC ของบรีฟ · เสนอ P3
--  • ไม่มี queue_allowed ใน shop_intake_resolve (คิวงาน = L4 ยังไม่มี) · ถังค้นสินค้าแยก sis: 240/10 นาที (บรีฟไม่ได้ระบุ — ค้นพิมพ์ถี่กว่า hub)
--  • idem replay คืนใบเดิมโดยไม่เทียบพารามิเตอร์ (key เดียวกัน พารามิเตอร์ต่าง = ได้ใบแรก) — UI สร้าง key ใหม่ทุกครั้งที่เปิดฟอร์ม
--  • bind ประทับน้ำหนักเงินจาก SKU ลงรายการเมื่อน้ำหนักว่าง (weight_source='product') และคืน weight_filled — ไม่ทิ้งให้ค่า "มีผล" เปลี่ยนเงียบๆ
--  • ใบงานที่ cancelled ไม่ถูกเติม SKU ตอน bind (job_guard ห้ามแก้ใบ cancelled) — เป็นประวัติ ไม่มีผลต่อต้นทุน
--  • ช่างเปิดใบแล้วออฟฟิศยังไม่ ack: ขั้น/ใบงานเดินได้ตามปกติ (ด่านอยู่ที่ "ผลิตเสร็จ" เท่านั้น — ตามดีไซน์)
--  • verify-0185 P7 ล็อก md5 ของ worker_pin_verify/worker_upsert เท่าก่อน 0185 — ถูกแทนที่โดยไฟล์นี้ (นโยบายล็อกเดียวกันแต่ย้ายเข้า worker_pin_verify_core) · ชุดของ 0187 ยิงบันไดล็อก 5/10/15 ซ้ำทั้งสองทาง
-- rollback (ถ้าจำเป็นหลัง apply): ต้อง migration ใหม่ที่ restore definition เดิมของ job_guard/job_token_guard/production_order_deny_mutation/production_order_item_deny_mutation/job_create_insert(21 arg)/
--   job_create_from_production_item/job_token_issue/worker_pin_verify/worker_upsert(6 arg)/v_production_order จาก 0181/0186/0185 + drop ของใหม่ — ห้ามแก้ประวัติ

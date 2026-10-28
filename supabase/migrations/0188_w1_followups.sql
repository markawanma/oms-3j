-- 0188_w1_followups.sql — W1 ตามหลัง 0187 (apply แล้ว): แก้ 4 เรื่องเล็กจาก QA
-- สถานะ: ยังไม่ apply · dry-run เท่านั้น · apply ด้วย node scripts/run-sql.mjs --commit --record เท่านั้น (🔴 ห้าม supabase db push) · ชุดทดสอบ scripts/verify/verify-0188.sql
-- ลำดับ deploy: dry-run 0188 + verify-0188 → apply --commit --record → verify-0188 + verify-0187 + check-analytics-grants → แล้วค่อย merge TS (getShopIntakeStatus map revokedAt — ไม่พึ่งคอลัมน์ใหม่: ไม่มี revoked_at = null)
--
--  1. production_order_close_gate: ข้อความ ack_required/sku_required ใช้ new.po_no — po_no เป็น generated column คำนวณหลัง BEFORE trigger จึงเป็น NULL ใน NEW (ขึ้น "ใบผลิต <NULL>") → ใช้ old.po_no (QA BUG-3)
--  2. shop_intake_token_status: ไม่มีใบ active → คืน issued_at/revoked_at ของใบล่าสุดที่เคยออก (หน้าจอแยก "ถูกเพิกถอน" ออกจาก "ไม่เคยออก") · active → revoked_at = null (QA BUG-2)
--  3. job_worker_open: advisory lock ต่อ (ร้าน, product_id) ก่อนเช็ค job_exists — ผู้จัดการ 2 คนเปิด SKU เดียวพร้อมกันต้องไม่ได้ใบซ้ำ · ลำดับล็อกคงที่ idem → SKU (QA race)
--  4. job_worker_open: ข้อความ name_invalid ไม่ระบุตัวเลขความยาว (UI จำกัดต่างจาก DB — พูดกลาง)
-- ลอก definition สดจาก DB (pg_get_functiondef หลัง 0187 apply) แล้วแก้เฉพาะจุดข้างบน · ไม่เปลี่ยน signature ทั้งสามตัว (create or replace) · re-grant ครบ (ข้อ 2) · ไฟล์ LF (ข้อ 20)
-- ไม่แตะ production_order_done / ตัวนับ / ข้อมูลใดๆ (ไม่มี UPDATE) — post-check ท้ายไฟล์ล็อก md5 ของ done + จำนวน overload + สิทธิ์

create temp table _m188_base on commit drop as
select (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'production_order_done') as done_md5,
       (select coalesce(md5(string_agg(x::text, '|' order by x.id)), '') from analytics.shop_intake_token x) as tok_md5,
       (select coalesce(md5(string_agg(x::text, '|' order by x.id)), '') from analytics.job x) as job_md5;

-- 1
CREATE OR REPLACE FUNCTION analytics.production_order_close_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
begin
  if old.status = 'open' and new.status = 'done' then
    if new.opened_via = 'shopfloor' and new.acknowledged_at is null then
      raise exception 'ใบผลิต % เปิดจากหน้างาน — ให้ออฟฟิศรับทราบก่อน แล้วค่อยกดผลิตเสร็จ', old.po_no using errcode = '22023', hint = 'ack_required';
    end if;
    -- ชั้นซ้ำกับ production_order_done (0186 sku_required): ทางอื่นที่เปลี่ยนสถานะเป็น done (เช่น ปิดแบบงวดในอนาคต) ก็ผ่านด่านนี้
    if exists (select 1 from analytics.production_order_item i where i.production_order_id = new.id and i.product_id is null) then
      raise exception 'ใบผลิต % ยังมีรายการที่ไม่มี SKU — ผูก SKU ก่อนปิดใบ', old.po_no using errcode = '22023', hint = 'sku_required';
    end if;
  end if;
  return new;
end;
$function$;

-- 2
CREATE OR REPLACE FUNCTION analytics.shop_intake_token_status(p_shop_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
declare
  v_row analytics.shop_intake_token%rowtype;
begin
  if p_shop_id is null then
    raise exception 'shop_intake_token_status: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  select * into v_row from analytics.shop_intake_token where shop_id = p_shop_id and revoked_at is null;
  if found then
    return jsonb_build_object('active', true, 'issued_at', v_row.issued_at, 'revoked_at', null);
  end if;
  -- ไม่มีใบที่ใช้อยู่: คืนของใบล่าสุดที่เคยออก (เวลาออก + เวลาเพิกถอน) ให้หน้าจอแยก "ถูกเพิกถอน" ออกจาก "ไม่เคยออก" (ไม่เคยออกเลย = ทั้งคู่ null) · ไม่มี hash/ค่าดิบ
  select * into v_row from analytics.shop_intake_token where shop_id = p_shop_id order by issued_at desc, id limit 1;
  if not found then
    return jsonb_build_object('active', false, 'issued_at', null, 'revoked_at', null);
  end if;
  return jsonb_build_object('active', false, 'issued_at', v_row.issued_at, 'revoked_at', v_row.revoked_at);
end;
$function$;

-- 3 + 4
CREATE OR REPLACE FUNCTION analytics.job_worker_open(p_token_hash text, p_session_hash text, p_idem_key text, p_product_id uuid DEFAULT NULL::uuid, p_pending_label text DEFAULT NULL::text, p_metal text DEFAULT NULL::text, p_purity numeric DEFAULT NULL::numeric, p_weight_g numeric DEFAULT NULL::numeric, p_qty_order integer DEFAULT NULL::integer, p_qty_planned integer DEFAULT NULL::integer, p_due_date date DEFAULT NULL::date, p_is_new_design boolean DEFAULT NULL::boolean, p_note text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_ip_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
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
    return jsonb_build_object('ok', true, 'already', true, 'order_no', v_po.po_no, 'job_no', v_jobrow.job_no,
                              'design_label', v_jobrow.design_label, 'metal', v_jobrow.metal, 'qty_order', v_jobrow.qty_order, 'qty_planned', v_jobrow.qty_planned,
                              'sku', v_jobrow.sku_snapshot, 'sku_pending', v_jobrow.product_id is null, 'due_date', v_jobrow.due_date,
                              'is_new_design', coalesce((select i.is_new_design from analytics.production_order_item i where i.id = v_jobrow.production_order_item_id), false),
                              'status', case when v_po.status = 'cancelled' then 'cancelled' else v_jobrow.status end);
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

  return jsonb_build_object('ok', true, 'already', false, 'order_no', v_po.po_no, 'job_no', v_jobrow.job_no, 'token', v_tok ->> 'token',
                            'design_label', v_jobrow.design_label, 'sku', v_jobrow.sku_snapshot, 'sku_pending', v_jobrow.product_id is null,
                            'metal', v_jobrow.metal, 'qty_order', v_jobrow.qty_order, 'qty_planned', v_jobrow.qty_planned,
                            'is_new_design', v_new, 'due_date', v_jobrow.due_date, 'status', v_jobrow.status);
end;
$function$;

-- สิทธิ์ (ข้อ 2/18): ปิดทุกชื่อแล้วเปิดเฉพาะที่ตั้งใจ — status/open = service_role · close_gate = trigger function (ไม่เปิดใคร · ผู้เรียกจริงคือ trigger ของ owner)
revoke all on function analytics.production_order_close_gate() from public, anon, authenticated, service_role;
revoke all on function analytics.shop_intake_token_status(uuid) from public, anon, authenticated, service_role;
grant execute on function analytics.shop_intake_token_status(uuid) to service_role;
revoke all on function analytics.job_worker_open(text, text, text, uuid, text, text, numeric, numeric, integer, integer, date, boolean, text, text, text) from public, anon, authenticated, service_role;
grant execute on function analytics.job_worker_open(text, text, text, uuid, text, text, numeric, numeric, integer, integer, date, boolean, text, text, text) to service_role;

do $post$
declare
  v_b record; v_now text; v_n int;
begin
  select * into v_b from _m188_base;
  select md5(pg_get_functiondef(p.oid)) into v_now from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'production_order_done';
  if v_now <> v_b.done_md5 then raise exception '0188 post: production_order_done md5 เปลี่ยน — ห้ามแตะ (ฟังก์ชัน 💰)'; end if;
  select coalesce(md5(string_agg(x::text, '|' order by x.id)), '') into v_now from analytics.shop_intake_token x;
  if v_now <> v_b.tok_md5 then raise exception '0188 post: shop_intake_token ขยับ'; end if;
  select coalesce(md5(string_agg(x::text, '|' order by x.id)), '') into v_now from analytics.job x;
  if v_now <> v_b.job_md5 then raise exception '0188 post: job ขยับ'; end if;
  select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname in ('production_order_close_gate', 'shop_intake_token_status', 'job_worker_open');
  if v_n <> 3 then raise exception '0188 post: overload/หาย (พบ % แถว ต้อง 3) — หยุด รายงาน (ข้อ 1)', v_n; end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('production_order_close_gate', 'shop_intake_token_status', 'job_worker_open')
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) then
    raise exception '0188 post: เปิดให้ anon/authenticated (ข้อ 18)';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'production_order_close_gate' and has_function_privilege('service_role', p.oid, 'execute')) then
    raise exception '0188 post: close_gate (trigger function) service_role เรียกตรงได้ — ต้องไม่ได้';
  end if;
end;
$post$;

-- 0132_production_order_security_fixes.sql
-- ⛔ ยังไม่ apply — Tech Lead จะ dry-run (begin;…rollback; ในทรานแซคชันเดียวกับ
-- scripts/verify-0132.sql) แล้วค่อย apply จริงผ่าน MCP apply_migration เอง
-- (คำสั่งชัดเจนจากบรีฟ: "ห้าม apply เอง")
--
-- ปิด 3 finding จาก security review 18 ก.ย. 69 บนโมดูลใบผลิตเข้าสต็อก (P1b) —
-- 💰 แตะต้นทุนที่ล็อกถาวร + สต็อก แต่ **ขอบเขตแคบ: แก้แค่ 2 RPC**
-- (analytics.production_order_done, analytics.production_order_save) ไม่แตะ
-- object อื่นในโมดูลนี้เลย (production_cost_calc / production_spot_resolve /
-- production_order_item_set / production_order_item_remove /
-- production_order_preview / production_order_cancel / triggers / views —
-- signature และ body เดิมทุกตัวคงอยู่ ไม่ต้อง drop/re-grant ซ้ำ)
--
-- อ้างอิง: supabase/migrations/0131_production_order.sql (apply ลง production
-- แล้ว 18 ก.ย. 69) — body ของทั้งสองฟังก์ชันด้านล่างลอกมาจากไฟล์นั้นคำต่อคำ
-- แล้วแก้เฉพาะจุดที่ทำเครื่องหมาย "0132 M#" ไว้ ไม่ได้เขียนใหม่จากศูนย์
--
-- M1 — ราคาเงินเลื่อนได้ระหว่าง preview กับ done (คนละ transaction,
--      analytics.oem_metal_price ของวันนี้ upsert ทับได้ระหว่างวันจาก
--      0125-0128 ดึงจากชีตหลายรอบ) ⇒ ต้นทุนที่ถูกล็อกถาวรอาจไม่ใช่ตัวเลขที่
--      เจ้าของเห็นตอนกด และแก้คืนไม่ได้ — เพิ่ม
--      p_expected_spot_thb_per_gram ให้ production_order_done, เทียบด้วย
--      not(abs(diff) <= 0.0001) (กัน NaN ตาม 3j-migration-traps ข้อ 4),
--      null = ไม่เทียบ, เทียบเฉพาะตอน v_needs_spot จริง (ใบ fixed ล้วนไม่ต้อง
--      แคร์ราคาเงินเลย)
-- M2 — production_order_save ใช้ coalesce(p_x, x) ⇒ ส่ง null = ไม่แตะ ⇒ ตั้ง
--      override/หมายเหตุผิดแล้วลบกลับเป็นค่าว่างไม่ได้ (จอขึ้นว่าบันทึกสำเร็จ
--      แต่ค่าเดิมยังอยู่) — เพิ่ม p_clear_note / p_clear_spot_override
--      (default false) ที่เซ็ต null ตรงๆ เมื่อ true เท่านั้น
-- M4 — ทุก RPC เรียกผ่าน service client ⇒ auth.uid() = null เสมอ ⇒
--      created_by/changed_by ว่างหมด — เพิ่ม p_actor uuid ให้ทั้งสองฟังก์ชัน
--      แล้วใช้ coalesce(p_actor, auth.uid()) ทุกจุดที่เคยใช้ auth.uid() ตรงๆ
--      🔴 ฝั่ง TS ต้องดึง p_actor จาก getSessionUser() (server session) เท่านั้น
--      ห้ามรับจาก client — เป็นวินัยฝั่ง lib/actions/production.ts ไม่ใช่สิ่งที่
--      DB บังคับได้ (RPC รับ uuid ตรงๆ เชื่อ caller เพราะเป็น service_role-only
--      อยู่แล้ว เหมือน pattern เดิมของไฟล์นี้ทั้งหมด)
--
-- 🔴 เปลี่ยน arg list ของทั้งสองฟังก์ชัน = overload ใหม่ถ้าไม่ drop ก่อน
-- (3j-migration-traps ข้อ 1) ⇒ drop signature เดิมทั้งคู่ก่อน create or
-- replace เสมอ แล้ว revoke+grant ใหม่ด้วย signature ใหม่ (ข้อ 2 — grant หาย
-- ทุกครั้งที่ replace ฟังก์ชัน)
--
-- ไม่แตะ: table/view/trigger structure เดิมทั้งหมด, search_path, security
-- definer, crm_require_owner_admin, ลำดับ load-bearing ใน done (snapshot
-- item → ensure central_stock → adjust_stock → stamp product → พลิก status
-- เป็นบรรทัดสุดท้าย) — เหมือนเดิมทุกจุดยกเว้นที่ทำเครื่องหมายไว้

-- ============================================================================
-- analytics.production_order_done — เพิ่ม p_expected_spot_thb_per_gram (M1) +
-- p_actor (M4)
-- ============================================================================

drop function if exists analytics.production_order_done(uuid, uuid, jsonb);

create or replace function analytics.production_order_done(
  p_shop_id             uuid,
  p_production_order_id uuid,
  -- p_items: [{"product_id": "...", "qty_done": N}, ...] override จำนวนที่
  -- ผลิตได้จริงต่อ SKU (ถ้าไม่ส่ง หรือ SKU ไม่อยู่ใน array นี้ ⇒ ใช้ qty_planned)
  p_items               jsonb default null,
  -- 0132 M1: ราคาเงินที่ client เห็นตอน preview (production_order_preview,
  -- 0131 §11) — ถ้าส่งมาและไม่ตรงกับราคาที่ resolve ได้จริง ณ ตอนนี้ (v_spot
  -- ด้านล่าง) ให้ raise แทนที่จะ stamp ต้นทุนที่เจ้าของไม่เคยเห็นแบบเงียบๆ
  -- (security review 18 ก.ย., M1). null = ไม่เทียบ (caller เก่า/ที่อื่นไม่พัง)
  p_expected_spot_thb_per_gram numeric default null,
  -- 0132 M4: coalesce(p_actor, auth.uid()) — auth.uid() เป็น null เสมอเพราะ
  -- เรียกผ่าน service client (security review 18 ก.ย., M4). null = พฤติกรรม
  -- เดิมทุกประการ (caller เก่าไม่พัง)
  p_actor               uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_order          analytics.production_order%rowtype;
  v_today          date := (now() at time zone 'Asia/Bangkok')::date;
  v_work           jsonb;
  v_elem           jsonb;
  v_qty_done       int;
  v_total_qty_done numeric := 0;
  v_needs_spot     boolean;
  v_spot           numeric;
  v_product        public.product%rowtype;
  v_calc           jsonb;
  v_unit_cost      numeric;
  v_before         jsonb;
  v_after          jsonb;
  v_result         jsonb;
begin
  if p_shop_id is null or p_production_order_id is null then
    raise exception 'production_order_done: p_shop_id and p_production_order_id are required';
  end if;
  if p_items is not null and jsonb_typeof(p_items) <> 'array' then
    raise exception 'production_order_done: p_items ต้องเป็น json array' using errcode = '22023';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_order from analytics.production_order
    where id = p_production_order_id and shop_id = p_shop_id
    for update;
  if not found then
    raise exception 'production_order_done: ไม่พบใบผลิต % ในร้านนี้', p_production_order_id using errcode = '22023';
  end if;

  -- idempotency: กด done ซ้ำ (สถานะ done อยู่แล้ว) → คืนผลเดิม ไม่ raise
  -- (design บรรทัด 60 — "กด done ซ้ำ → รอ row lock → เห็น done → คืนผลเดิม")
  -- ไม่เทียบราคาเงินในเคสนี้ (ยังไม่ถึงจุด resolve v_spot เลย) — ถูกต้อง เพราะ
  -- ไม่มีการ stamp ต้นทุนใหม่ในเคสนี้ ไม่มีอะไรให้เทียบ
  if v_order.status = 'done' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'product_id', poi.product_id, 'sku', p.sku, 'qty_done', poi.qty_done,
        'unit_cost', poi.unit_cost, 'prev_cost_type', poi.prev_cost_type, 'prev_unit_cost', poi.prev_unit_cost
      )), '[]'::jsonb)
      into v_result
    from analytics.production_order_item poi
    join public.product p on p.id = poi.product_id
    where poi.production_order_id = p_production_order_id;

    return jsonb_build_object('production_order_id', p_production_order_id, 'po_no', v_order.po_no,
      'status', v_order.status, 'already_done', true, 'items', v_result);
  end if;

  -- cancelled เป็นปลายทาง — done ทับไม่ได้ (ไม่ใช่ idempotent no-op เหมือนกรณี
  -- ข้างบน เพราะเป็นสถานะที่ขัดแย้งกัน ไม่ใช่การเรียกซ้ำของ action เดียวกัน —
  -- design บรรทัด 60 "cancel แล้ว done ใหม่ เป็นไปไม่ได้")
  if v_order.status = 'cancelled' then
    raise exception 'production_order_done: ใบ % ถูกยกเลิกไปแล้ว ทำ done ไม่ได้', v_order.po_no using errcode = '22023';
  end if;

  -- ประกอบ qty_done ต่อ item ครั้งเดียว (ใช้ p_items override ถ้ามี ไม่งั้นใช้
  -- qty_planned) เก็บลง v_work แล้ววนอ่านซ้ำ 2 รอบ (validate แล้วค่อย mutate)
  -- โดยไม่ต้องเขียนนิพจน์ resolve ซ้ำสองที่
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', poi.id, 'product_id', poi.product_id, 'qty_planned', poi.qty_planned,
      'qty_done_resolved', coalesce(
        (select (ov ->> 'qty_done')::int from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) ov
          where (ov ->> 'product_id')::uuid = poi.product_id),
        poi.qty_planned
      )
    )), '[]'::jsonb)
    into v_work
  from analytics.production_order_item poi
  where poi.production_order_id = p_production_order_id;

  if v_work = '[]'::jsonb then
    raise exception 'production_order_done: ใบ % ไม่มีรายการให้ผลิต (ใบว่าง)', v_order.po_no using errcode = '22023';
  end if;

  -- รอบที่ 1: validate ทุกบรรทัดก่อนแตะสต็อกบรรทัดแรก (design บรรทัด 56)
  for v_elem in select * from jsonb_array_elements(v_work) loop
    v_qty_done := (v_elem ->> 'qty_done_resolved')::int;
    if v_qty_done is null or not (v_qty_done >= 0 and v_qty_done <= 100000) then
      raise exception 'production_order_done: qty_done ของ SKU (product_id=%) ต้องอยู่ระหว่าง 0-100000', v_elem ->> 'product_id' using errcode = '22023';
    end if;
    v_total_qty_done := v_total_qty_done + v_qty_done;
  end loop;

  if v_total_qty_done = 0 then
    raise exception 'production_order_done: ทุกรายการในใบ % ผลิตได้ 0 ชิ้น — ถ้าไม่ได้ผลิตจริงให้ยกเลิกใบนี้แทน (analytics.production_order_cancel)', v_order.po_no using errcode = '22023';
  end if;

  -- resolve ราคาเงินครั้งเดียวต่อใบ เฉพาะเมื่อมีอย่างน้อย 1 รายการที่จะผลิตจริง
  -- (qty_done>0) เป็นโหมด spot — ห้าม fallback ราคาเมื่อวาน
  select exists (
    select 1 from jsonb_array_elements(v_work) e
    join public.product p on p.id = (e ->> 'product_id')::uuid
    where p.cost_type = 'spot' and (e ->> 'qty_done_resolved')::int > 0
  ) into v_needs_spot;

  if v_needs_spot then
    v_spot := analytics.production_spot_resolve(p_shop_id, v_order.spot_override_thb_per_gram);
  end if;

  -- 0132 M1: เทียบราคาเงินที่ client "คาดหวัง" (เห็นตอน preview) กับราคาที่
  -- resolve ได้จริง ณ ตอนนี้ — ก่อนแตะสต็อก/ต้นทุนบรรทัดแรกเสมอ (ยังอยู่ในโซน
  -- validate ทั้งหมดก่อน "รอบที่ 2: mutate จริง" ด้านล่าง). เทียบเฉพาะตอน
  -- v_needs_spot จริง (ใบที่ทุกบรรทัดเป็น fixed ไม่แคร์ราคาเงินเลย ห้ามเทียบ
  -- เพราะ v_spot จะเป็น null เสมอในเคสนั้น) และเฉพาะตอนมีคน "คาดหวัง" ราคาส่งมา
  -- (p_expected_spot_thb_per_gram ไม่ null) — null = ไม่เทียบ กัน caller เก่า/
  -- ที่อื่นที่ยังไม่รู้จัก arg นี้พัง
  -- not(<=) กัน NaN/Infinity หลุดผ่าน (3j-migration-traps ข้อ 4) — ถ้า
  -- p_expected เป็น NaN, abs(...) เป็น NaN, 'NaN' <= 0.0001 เป็น false เสมอ ⇒
  -- not() เป็น true ⇒ raise ถูกต้อง (ไม่ใช่ปล่อยผ่านแบบเงียบๆ)
  if v_needs_spot and p_expected_spot_thb_per_gram is not null then
    if not (abs(v_spot - p_expected_spot_thb_per_gram) <= 0.0001) then
      raise exception 'production_order_done: ราคาเงินเปลี่ยนไประหว่างที่เปิดหน้าต่างนี้ค้างไว้ (ตอนเปิดหน้าต่างเห็นราคา % บาท/กรัม แต่ตอนนี้ระบบคำนวณได้ % บาท/กรัม) — ปิดหน้าต่างยืนยันนี้แล้วเปิดใบผลิตใหม่อีกครั้งเพื่อดูราคาล่าสุดก่อนยืนยัน', p_expected_spot_thb_per_gram, v_spot using errcode = '22023';
    end if;
  end if;

  -- รอบที่ 2: mutate จริง
  --
  -- 🔴 ลำดับ load-bearing (design บรรทัด 56) — ห้ามสลับ (ไม่เปลี่ยนจาก 0131):
  --   1) เขียน snapshot ลง production_order_item (unit_cost/prev_*) ก่อน
  --   2) ensure central_stock แถวมีอยู่ + adjust_stock
  --   3) stamp cost_type/unit_cost/track_stock กลับไปที่ public.product
  --   4) พลิก production_order.status = 'done' เป็นบรรทัดสุดท้ายของฟังก์ชัน
  -- ต้องพลิกสถานะ "หลังสุด" เท่านั้น เพราะ trigger
  -- analytics.production_order_item_deny_mutation เช็คสถานะใบแม่สดทุกครั้งที่
  -- UPDATE item — ถ้าพลิกสถานะเป็น done ก่อนเขียนข้อ (1) ธุรกรรมนี้จะกัดตัวเอง
  -- (item update ของ done เองจะถูกปฏิเสธเพราะใบไม่ open แล้ว)
  for v_elem in select * from jsonb_array_elements(v_work) loop
    v_qty_done := (v_elem ->> 'qty_done_resolved')::int;

    if v_qty_done = 0 then
      -- ไม่ได้ผลิตจริงสำหรับรายการนี้ — บันทึกแค่ qty_done=0 ไม่แตะต้นทุน/สต็อก
      update analytics.production_order_item
         set qty_done = 0, updated_at = now()
       where id = (v_elem ->> 'id')::uuid;
      continue;
    end if;

    select * into v_product from public.product
      where id = (v_elem ->> 'product_id')::uuid and shop_id = p_shop_id;
    if not found then
      raise exception 'production_order_done: ไม่พบ SKU (product_id=%) ในร้านนี้', v_elem ->> 'product_id' using errcode = '22023';
    end if;
    if not v_product.is_active then
      raise exception 'production_order_done: SKU % ปิดใช้งานแล้ว ผลิตไม่ได้', v_product.sku using errcode = '22023';
    end if;
    -- เช็คซ้ำตอน done เผื่อ SKU ถูก rename เป็น live* หลังถูกใส่ในใบไปแล้ว
    -- (design บรรทัด 74 — เช็คทั้งตอนใส่ในใบและตอน done)
    if v_product.sku ~* '^live' then
      raise exception 'production_order_done: SKU % เป็น SKU เฉพาะไลฟ์ (live*) ผลิตไม่ได้', v_product.sku using errcode = '22023';
    end if;

    v_calc := analytics.production_cost_calc(
      p_shop_id, v_product.id,
      case when v_product.cost_type = 'spot' then v_spot else null end
    );
    v_unit_cost := (v_calc ->> 'unit_cost')::numeric;
    if v_unit_cost is null then
      raise exception 'production_order_done: คำนวณต้นทุน SKU % ไม่ได้ (unit_cost เป็น null)', v_product.sku using errcode = '22023';
    end if;

    v_before := jsonb_build_object('cost_type', v_product.cost_type, 'unit_cost', v_product.unit_cost,
      'track_stock', v_product.track_stock, 'track_stock_since', v_product.track_stock_since);

    -- (1) snapshot ลง item ก่อน — ใบยังเป็น open ตอนนี้ ผ่าน trigger กันแก้
    update analytics.production_order_item
       set qty_done = v_qty_done, unit_cost = v_unit_cost,
           prev_cost_type = v_product.cost_type, prev_unit_cost = v_product.unit_cost,
           updated_at = now()
     where id = (v_elem ->> 'id')::uuid;

    -- (2) ensure central_stock แถวมีอยู่ก่อนเสมอ — SKU จาก generator ไม่มีแถวนี้
    -- มาตั้งแต่ต้น (มีแค่ตอน /products/new) adjust_stock จะ raise ข้อความหลอก
    -- "would go negative" ถ้าไม่มีแถวให้ UPDATE เจอเลย (design บรรทัด 11)
    insert into public.central_stock (product_id) values (v_product.id)
      on conflict (product_id) do nothing;

    perform public.adjust_stock(p_shop_id, v_product.id, v_qty_done, 'po:' || (v_elem ->> 'id'));

    -- (3) stamp ต้นทุนกลับ + เปิด track_stock — ห้ามเลื่อน track_stock_since ถ้า
    -- เปิดอยู่แล้ว (coalesce ค่าเดิมไว้ก่อนเสมอ — มติเจ้าของ §Q1: ล็อก cost_type='fixed')
    update public.product
       set cost_type = 'fixed', unit_cost = v_unit_cost, track_stock = true,
           track_stock_since = coalesce(v_product.track_stock_since, v_today),
           updated_at = now()
     where id = v_product.id;

    v_after := jsonb_build_object('cost_type', 'fixed', 'unit_cost', v_unit_cost,
      'track_stock', true, 'track_stock_since', coalesce(v_product.track_stock_since, v_today));

    -- 0132 M4: coalesce(p_actor, auth.uid()) — auth.uid() เป็น null เสมอผ่าน
    -- service client (ดูหัวไฟล์). p_actor null (caller เก่า) = พฤติกรรมเดิมเป๊ะ
    insert into analytics.catalog_audit_log (shop_id, product_id, sku, action, before, after, changed_by)
    values (p_shop_id, v_product.id, v_product.sku, 'edit', v_before, v_after, coalesce(p_actor, auth.uid()));
  end loop;

  -- (4) พลิกสถานะเป็นบรรทัดสุดท้ายของฟังก์ชันเท่านั้น
  update analytics.production_order
     set status = 'done', done_at = now()
   where id = p_production_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', poi.product_id, 'sku', p.sku, 'qty_done', poi.qty_done,
      'unit_cost', poi.unit_cost, 'prev_cost_type', poi.prev_cost_type, 'prev_unit_cost', poi.prev_unit_cost
    )), '[]'::jsonb)
    into v_result
  from analytics.production_order_item poi
  join public.product p on p.id = poi.product_id
  where poi.production_order_id = p_production_order_id;

  return jsonb_build_object('production_order_id', p_production_order_id, 'po_no', v_order.po_no,
    'status', 'done', 'already_done', false, 'items', v_result);
end;
$$;

revoke execute on function analytics.production_order_done(uuid, uuid, jsonb, numeric, uuid) from public, anon, authenticated;
grant execute on function analytics.production_order_done(uuid, uuid, jsonb, numeric, uuid) to service_role;

-- ============================================================================
-- analytics.production_order_save — เพิ่ม p_clear_note / p_clear_spot_override
-- (M2) + p_actor (M4)
-- ============================================================================

drop function if exists analytics.production_order_save(uuid, uuid, text, numeric);

create or replace function analytics.production_order_save(
  p_shop_id                   uuid,
  p_id                        uuid default null,
  p_note                      text default null,
  p_spot_override_thb_per_gram numeric default null,
  -- 0132 M2: เดิม UPDATE ใช้ coalesce(p_x, x) ล้วน ⇒ "ส่ง null = ไม่แตะ" ⇒ ตั้ง
  -- override/หมายเหตุผิดแล้วอยากลบกลับเป็นค่าว่างทำไม่ได้ (จอขึ้นว่าบันทึก
  -- สำเร็จแต่ค่าเดิมยังอยู่ — security review 18 ก.ย., M2). true = เซ็ต null
  -- จริง ชนะ p_note/p_spot_override_thb_per_gram ที่ส่งมาพร้อมกันในคอลเดียวกัน
  -- (ไม่ควรเกิดพร้อมกันจากฝั่ง TS อยู่แล้ว — ดู lib/actions/production.ts).
  -- default false = พฤติกรรมเดิมทุกประการ (caller เก่าไม่พัง)
  p_clear_note                boolean default false,
  p_clear_spot_override       boolean default false,
  -- 0132 M4: เหมือน production_order_done ด้านบน — coalesce(p_actor, auth.uid())
  p_actor                     uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_row analytics.production_order%rowtype;
  v_seq int;
begin
  if p_shop_id is null then
    raise exception 'production_order_save: p_shop_id is required';
  end if;
  if p_spot_override_thb_per_gram is not null and not (p_spot_override_thb_per_gram >= 5 and p_spot_override_thb_per_gram <= 500) then
    raise exception 'production_order_save: override ต้องอยู่ระหว่าง 5-500 บาท/กรัม (ต่อกรัม ไม่ใช่ต่อบาท — 1 บาท = 15.244 กรัม)' using errcode = '22023';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_id is null then
    -- ensure-then-lock ในสเตตเมนต์เดียว (pattern เดียวกับ sku_counter 0089):
    -- สร้างแถวถ้ายังไม่มี แล้วล็อกแถวนั้นทันที ป้องกันสอง request ยิงพร้อมกัน
    -- แล้วได้เลขซ้ำ — เลขข้ามได้ (ไม่ใช่เอกสารทางกฎหมาย) จึงไม่ต้องมี
    -- deny-mutation trigger บนตัวนับแบบ oem_doc_counter
    -- (สร้างใบใหม่ = p_clear_* ไม่มีความหมาย ไม่ใช้เลย — ตรงกับที่ฝั่ง TS
    -- ไม่ส่ง clear flag ตอนสร้างใบใหม่)
    insert into analytics.production_order_counter as c (shop_id, last_no)
    values (p_shop_id, 0)
    on conflict (shop_id) do update set last_no = c.last_no
    returning c.last_no into v_seq;

    v_seq := v_seq + 1;
    update analytics.production_order_counter set last_no = v_seq where shop_id = p_shop_id;

    insert into analytics.production_order (shop_id, seq, note, spot_override_thb_per_gram, created_by)
    values (p_shop_id, v_seq, nullif(btrim(p_note), ''), p_spot_override_thb_per_gram, coalesce(p_actor, auth.uid()))
    returning * into v_row;
  else
    select * into v_row from analytics.production_order where id = p_id and shop_id = p_shop_id for update;
    if not found then
      raise exception 'production_order_save: ไม่พบใบผลิต % ในร้านนี้', p_id using errcode = '22023';
    end if;
    if v_row.status <> 'open' then
      raise exception 'production_order_save: ใบ % สถานะ % แล้ว แก้ไม่ได้', v_row.po_no, v_row.status using errcode = '22023';
    end if;

    -- 0132 M2: p_clear_* = true ชนะเสมอ (เซ็ต null ตรงๆ) — ไม่งั้นพฤติกรรมเดิม
    -- coalesce(p_x, x) (ส่ง null = ไม่แตะ, คงค่าเดิมไว้)
    update analytics.production_order set
      note                        = case when p_clear_note then null
                                          else coalesce(nullif(btrim(p_note), ''), note) end,
      spot_override_thb_per_gram  = case when p_clear_spot_override then null
                                          else coalesce(p_spot_override_thb_per_gram, spot_override_thb_per_gram) end,
      updated_at                  = now()
    where id = p_id
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id, 'po_no', v_row.po_no, 'status', v_row.status,
    'note', v_row.note, 'spot_override_thb_per_gram', v_row.spot_override_thb_per_gram,
    'seq', v_row.seq, 'created_at', v_row.created_at
  );
end;
$$;

revoke execute on function analytics.production_order_save(uuid, uuid, text, numeric, boolean, boolean, uuid) from public, anon, authenticated;
grant execute on function analytics.production_order_save(uuid, uuid, text, numeric, boolean, boolean, uuid) to service_role;

notify pgrst, 'reload schema';

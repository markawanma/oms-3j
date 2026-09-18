-- 0138_stock_lot_tables.sql
-- L1 ของ design docs/3j-jewelry/oms/design-inventory-lot-costing.md (FIFO lot
-- costing) — มติเจ้าของ D1 (19 ก.ย. 69): ย้ายที่ "ล็อก" ต้นทุนจากตัว SKU
-- (public.product.cost_type/unit_cost) ไปเป็น "รอบผลิต" (analytics.stock_lot)
-- เพราะต้นทุนที่ล็อกไว้ที่ SKU ถูกทับได้ทุกครั้งที่มีคนแก้แคตตาล็อก
-- (เกิดขึ้นจริง 18 ก.ย.: PO-0002 ล็อกต้นทุนตอน 15:23 แล้ว 0134 ทับหายในวันเดียวกัน)
--
-- ⚠️ เลขเลื่อนจาก design เดิม — design เขียนไว้ว่า L1=0137/L2=0138 แต่ 0137 ถูกใช้
-- ไปกับ H1 idem-key fix (track_stock_set_idem_fix) แทน ⇒ L1 (ตารางนี้) จึงเป็น
-- 0138 จริงในทางปฏิบัติ ส่วน L2 (D3 — เลิกใช้ ÷1.2 กับกำไรเงินแท่ง) เลื่อนไปเป็น
-- 0139 ขึ้นไป — ยืนยันด้วยการ query pg_proc/ไฟล์ migration จริงก่อนเขียน (ไม่เดา)
--
-- ขอบเขตรอบนี้ (ตั้งใจแคบ — SQL อย่างเดียว ไม่แตะ TypeScript):
--   1. ตาราง analytics.stock_lot (1 แถว = ของเข้า 1 ครั้ง)
--   2. ตาราง analytics.stock_lot_consumption (โครงเปล่า — 0139 จะมาเขียน/อ่าน)
--   3. analytics.production_order_done: เลิก stamp cost_type/unit_cost กลับไป
--      public.product → insert stock_lot แทน (ยังคง set track_stock/since
--      เหมือนเดิม — คนละเรื่องกับต้นทุน) + ปิด ABBA deadlock (security review
--      ของ 0135, MEDIUM-1) ด้วย `for update` ตอนอ่าน v_product
--   4. 2 view ใหม่ (v_stock_lot, v_stock_lot_mismatch) + ต่อท้าย v_dim_product
--      ด้วย lot_qty_on_hand/lot_cost_avg/lot_count (effective_unit_cost คง
--      ความหมายเดิมเป๊ะ — transform_pending_order_lines ยังอ่านตัวนั้นอยู่ การ
--      สลับไปใช้ lot cost เป็นงานของ cutover ใน 0139+ ไม่ใช่รอบนี้)
--
-- ❌ ไม่ทำในรอบนี้ (ตั้งใจ — จะทำใน 0139/0140 ตาม design):
--   - ไม่มี constraint trigger บังคับ sum(qty_remaining)=qty_on_hand (ยังไม่มี
--     ใครลด lot ตอนขาย — เปิดตอนนี้ระบบจะล็อกตายทันที)
--   - ไม่แตะ stock_sync_sales / product_track_stock_set
--   - ไม่มี FIFO consumption, ไม่มี stock_lot_recost, ไม่แตะ cogs/unit_cost_snapshot
--   - ไม่มี UI
--
-- 🔴 ABBA deadlock (security review 0135, MEDIUM-1): analytics.product_track_stock_set
-- (0137) ล็อก public.product ก่อน (select ... for update ที่บรรทัด ~71-73) แล้ว
-- ค่อยล็อก public.central_stock (บรรทัด ~106-107) ทีหลัง. production_order_done
-- เดิมล็อก central_stock ก่อน (ผ่าน adjust_stock ที่เรียกก่อน) แล้วค่อยล็อก
-- product ทีหลัง (ตอน UPDATE stamp) — ลำดับกลับกัน ⇒ สอง session บน SKU เดียวกัน
-- พร้อมกันมีโอกาสตาย 40P01 แบบสุ่ม. แก้โดยเติม `for update` ที่ SELECT v_product
-- (ก่อนแตะ central_stock ใดๆ) ⇒ ลำดับกลายเป็น product → central_stock เหมือนกัน
-- ทั้งสองฟังก์ชันแล้ว.
--
-- ไม่แตะ: production_cost_calc / production_order_preview / production_order_cancel /
-- production_order_save / production_order_item_set / production_order_item_remove /
-- triggers/views เดิมของโมดูลใบผลิต — signature และ body เดิมทุกตัวคงอยู่
--
-- อ้างอิง: docs/3j-jewelry/oms/design-inventory-lot-costing.md (§โครงสร้าง,
-- §มติ FIFO, §D1/D3 ที่เจ้าของอนุมัติ 19 ก.ย. 69), supabase/migrations/0132_production_order_security_fixes.sql
-- (นิยามล่าสุดของ production_order_done ก่อนไฟล์นี้), skill 3j-migration-traps

-- ============================================================================
-- 1. analytics.stock_lot — 1 แถว = ของเข้า 1 ครั้ง (production/opening/purchase)
--    RLS enable ไม่มี policy เลย (เหมือน production_order_counter/sku_counter/
--    oem_doc_counter) — ข้อมูลต้นทุนต้องไม่ถูกอ่านตรงผ่าน PostgREST โดย
--    authenticated เด็ดขาด (oem-quote-invariants #1) เข้าถึงได้เฉพาะผ่าน
--    service_role (production_order_done เป็น security definer ที่เขียนแถวนี้
--    ให้ตอน done, และ view v_stock_lot/v_stock_lot_mismatch/v_dim_product
--    สำหรับอ่านสรุป)
-- ============================================================================

create table if not exists analytics.stock_lot (
  id                        uuid primary key default gen_random_uuid(),
  -- derived by trigger (analytics.stock_lot_derive_shop) จาก product_id เสมอ —
  -- ไม่รับตรงจาก caller (defense-in-depth เหมือน central_stock.shop_id /
  -- production_order_item.shop_id เดิม) ปิดช่อง "insert ข้ามร้าน" ที่ระดับ DB
  shop_id                   uuid not null references public.shop (id) on delete cascade,
  product_id                uuid not null references public.product (id) on delete restrict,
  source                    text not null check (source in ('production', 'opening', 'purchase')),
  unit_cost                 numeric(12, 2) not null check (unit_cost >= 0),
  -- เพดาน 100,000 ให้สอดคล้องกับ qty_planned/qty_done ของ production_order_item (0131)
  qty_in                    int not null check (qty_in > 0 and qty_in <= 100000),
  qty_remaining             int not null check (qty_remaining between 0 and qty_in),
  received_on               date not null,
  -- 1 lot ต่อ 1 production_order_item เท่านั้น (partial unique index ด้านล่าง) —
  -- กด done ซ้ำ/re-run migration backfill ไม่สร้าง lot ซ้ำ (idempotent)
  production_order_item_id  uuid references analytics.production_order_item (id) on delete restrict,
  note                      text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create unique index if not exists uq_stock_lot_production_order_item
  on analytics.stock_lot (production_order_item_id)
  where production_order_item_id is not null;

-- FIFO เตรียมให้ 0139: กินจาก lot เก่าสุดก่อน (received_on, created_at) เฉพาะ
-- lot ที่ยังเหลือ (qty_remaining > 0) — index บางส่วน ไม่รวม lot ที่หมดแล้ว
create index if not exists idx_stock_lot_fifo
  on analytics.stock_lot (shop_id, product_id, received_on, created_at)
  where qty_remaining > 0;

comment on table analytics.stock_lot is
  '0138 (L1 ของ design-inventory-lot-costing.md): 1 แถว = ของเข้า 1 ครั้งต่อ SKU
   (production = จากใบผลิต, opening = backfill ยอดคงเหลือตอนเริ่มระบบ lot,
   purchase = ซื้อเข้า — ยังไม่มี caller วันนี้). unit_cost ล็อกที่ตอนรับเข้า
   ไม่เปลี่ยนตามราคาตลาดทีหลัง (มติเจ้าของ D1, 19 ก.ย. 69). qty_remaining ลดลง
   ตอนขาย (0139 FIFO consumption — ยังไม่ implement รอบนี้). RLS เปิดไม่มี policy
   — อ่าน/เขียนได้เฉพาะ service_role (ข้อมูลต้นทุนห้ามหลุดถึง authenticated ตรง).';

alter table analytics.stock_lot enable row level security;
-- ไม่มี create policy บรรทัดไหนเลยในตารางนี้โดยตั้งใจ (เหมือน sku_counter/oem_doc_counter)

revoke all on analytics.stock_lot from public, anon, authenticated;
grant all on analytics.stock_lot to service_role;

create or replace function analytics.stock_lot_derive_shop()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_product_shop_id uuid;
begin
  select shop_id into v_product_shop_id from public.product where id = new.product_id;
  if v_product_shop_id is null then
    raise exception 'stock_lot: ไม่พบ SKU (product_id=%)', new.product_id using errcode = '22023';
  end if;
  new.shop_id := v_product_shop_id;
  return new;
end;
$$;

revoke execute on function analytics.stock_lot_derive_shop() from public, anon, authenticated;

comment on function analytics.stock_lot_derive_shop() is
  '0138: derive stock_lot.shop_id จาก product_id เสมอ (ไม่รับตรงจาก caller) —
   ปิดช่อง "insert lot ข้ามร้าน" ที่ระดับ DB แม้ caller ส่ง shop_id ผิดมา
   (pattern เดียวกับ analytics.production_order_item_derive_shop, 0131).';

drop trigger if exists trg_stock_lot_derive_shop on analytics.stock_lot;
create trigger trg_stock_lot_derive_shop
  before insert or update of product_id on analytics.stock_lot
  for each row execute function analytics.stock_lot_derive_shop();

-- ============================================================================
-- 2. analytics.stock_lot_consumption — 1 แถว = (ออเดอร์ × SKU × lot) — โครงเปล่า
--    รอบนี้ ยังไม่มี caller เขียน/อ่านตารางนี้เลย (0139 FIFO consumption จะมาใช้
--    เพื่อคืนของเข้า lot เดิมได้เป๊ะตอนยกเลิก/ลด qty) — RLS/grant แบบเดียวกับ
--    stock_lot
-- ============================================================================

create table if not exists analytics.stock_lot_consumption (
  -- derived by trigger (analytics.stock_lot_consumption_derive_shop) จาก
  -- product_id เสมอ + cross-validate ว่า lot_id เป็นของ SKU/ร้านเดียวกัน
  shop_id         uuid not null references public.shop (id) on delete cascade,
  source_order_no text not null,
  product_id      uuid not null references public.product (id) on delete restrict,
  lot_id          uuid not null references analytics.stock_lot (id) on delete restrict,
  qty             int not null check (qty > 0),
  updated_at      timestamptz not null default now(),
  primary key (shop_id, source_order_no, product_id, lot_id)
);

comment on table analytics.stock_lot_consumption is
  '0138: โครงเปล่า — ยังไม่มีใครเขียนตารางนี้ในรอบนี้ (0139 FIFO consumption จะมา
   ใช้จดว่าออเดอร์ไหนกินของจาก lot ไหนกี่ชิ้น เพื่อคืนเข้า lot เดิมได้เป๊ะตอน
   ยกเลิก/ลดจำนวน). RLS เปิดไม่มี policy — อ่าน/เขียนได้เฉพาะ service_role.';

alter table analytics.stock_lot_consumption enable row level security;
-- ไม่มี create policy บรรทัดไหนเลยในตารางนี้โดยตั้งใจ (เหมือน stock_lot ด้านบน)

revoke all on analytics.stock_lot_consumption from public, anon, authenticated;
grant all on analytics.stock_lot_consumption to service_role;

create or replace function analytics.stock_lot_consumption_derive_shop()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_product_shop_id uuid;
  v_lot_shop_id     uuid;
  v_lot_product_id  uuid;
begin
  select shop_id into v_product_shop_id from public.product where id = new.product_id;
  if v_product_shop_id is null then
    raise exception 'stock_lot_consumption: ไม่พบ SKU (product_id=%)', new.product_id using errcode = '22023';
  end if;

  select shop_id, product_id into v_lot_shop_id, v_lot_product_id
    from analytics.stock_lot where id = new.lot_id;
  if v_lot_shop_id is null then
    raise exception 'stock_lot_consumption: ไม่พบ lot (lot_id=%)', new.lot_id using errcode = '22023';
  end if;
  if v_lot_shop_id <> v_product_shop_id or v_lot_product_id <> new.product_id then
    raise exception 'stock_lot_consumption: lot (lot_id=%) ไม่ตรงกับ SKU/ร้านของรายการนี้', new.lot_id using errcode = '22023';
  end if;

  new.shop_id := v_product_shop_id;
  return new;
end;
$$;

revoke execute on function analytics.stock_lot_consumption_derive_shop() from public, anon, authenticated;

comment on function analytics.stock_lot_consumption_derive_shop() is
  '0138: derive stock_lot_consumption.shop_id จาก product_id เสมอ + cross-validate
   ว่า lot_id เป็นของ SKU/ร้านเดียวกันจริง — ปิดช่อง "insert ข้ามร้าน" หรือ
   "ผูก consumption กับ lot ของ SKU อื่น" ที่ระดับ DB (0139 จะเป็น caller หลัก).';

drop trigger if exists trg_stock_lot_consumption_derive_shop on analytics.stock_lot_consumption;
create trigger trg_stock_lot_consumption_derive_shop
  before insert or update of product_id, lot_id on analytics.stock_lot_consumption
  for each row execute function analytics.stock_lot_consumption_derive_shop();

-- ============================================================================
-- 3. analytics.production_order_done — เลิก stamp cost_type/unit_cost กลับไป
--    public.product → insert analytics.stock_lot แทน (D1) + ปิด ABBA deadlock
--    (0132 M1/M4 ยังคงอยู่ทุกจุด ไม่แตะ — signature เดิมเป๊ะ ไม่ drop function)
-- ============================================================================

create or replace function analytics.production_order_done(
  p_shop_id             uuid,
  p_production_order_id uuid,
  -- p_items: [{"product_id": "...", "qty_done": N}, ...] override จำนวนที่
  -- ผลิตได้จริงต่อ SKU (ถ้าไม่ส่ง หรือ SKU ไม่อยู่ใน array นี้ ⇒ ใช้ qty_planned)
  p_items               jsonb default null,
  -- 0132 M1: ราคาเงินที่ client เห็นตอน preview (production_order_preview,
  -- 0131 §11) — ถ้าไม่ตรงกับราคาที่ resolve ได้จริง ณ ตอนนี้ (v_spot ด้านล่าง)
  -- ให้ raise แทนที่จะ stamp ต้นทุนที่เจ้าของไม่เคยเห็นแบบเงียบๆ
  -- fail-closed: ใบที่ใช้ราคาเงินจริง (v_needs_spot) ต้องส่ง arg นี้มาเสมอ —
  -- null = raise ไม่ใช่ "ข้ามการเทียบ" ใบที่ทุกบรรทัดเป็น fixed ไม่แตะเงื่อนไขนี้
  p_expected_spot_thb_per_gram numeric default null,
  -- 0132 M4: coalesce(p_actor, auth.uid()) — auth.uid() เป็น null เสมอเพราะ
  -- เรียกผ่าน service client. null = พฤติกรรมเดิมทุกประการ (caller เก่าไม่พัง)
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

  -- idempotency: กด done ซ้ำ (สถานะ done อยู่แล้ว) → คืนผลเดิม ไม่ raise (ไม่แตะ
  -- lot ซ้ำ — ผ่านทางไม่ถึงลูปด้านล่างเลย)
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

  -- cancelled เป็นปลายทาง — done ทับไม่ได้
  if v_order.status = 'cancelled' then
    raise exception 'production_order_done: ใบ % ถูกยกเลิกไปแล้ว ทำ done ไม่ได้', v_order.po_no using errcode = '22023';
  end if;

  -- ประกอบ qty_done ต่อ item ครั้งเดียว (ใช้ p_items override ถ้ามี ไม่งั้นใช้
  -- qty_planned) เก็บลง v_work แล้ววนอ่านซ้ำ 2 รอบ (validate แล้วค่อย mutate)
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

  -- รอบที่ 1: validate ทุกบรรทัดก่อนแตะสต็อกบรรทัดแรก
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

  -- 0132 M1 (fail-closed): เทียบราคาเงินที่ client "คาดหวัง" กับราคาที่ resolve
  -- ได้จริง ณ ตอนนี้ — ก่อนแตะสต็อก/ต้นทุนบรรทัดแรกเสมอ. เทียบเฉพาะตอน
  -- v_needs_spot จริง; ไม่ null-safe compare เพื่อกัน NaN/Infinity หลุดผ่าน
  -- (3j-migration-traps ข้อ 4 — not(<=) ไม่ใช่ <=)
  if v_needs_spot then
    if p_expected_spot_thb_per_gram is null then
      raise exception 'production_order_done: ใบนี้ใช้ราคาเงินคำนวณต้นทุน ต้องส่งราคาที่หน้าจอเห็น (p_expected_spot_thb_per_gram) มาด้วยเสมอ — กดยืนยันจากหน้าใบผลิตเท่านั้น'
        using errcode = '22023';
    end if;
    if not (abs(v_spot - p_expected_spot_thb_per_gram) <= 0.0001) then
      raise exception 'production_order_done: ราคาเงินเปลี่ยนไประหว่างที่เปิดหน้าต่างนี้ค้างไว้ (ตอนเปิดหน้าต่างเห็นราคา % บาท/กรัม แต่ตอนนี้ระบบคำนวณได้ % บาท/กรัม) — ปิดหน้าต่างยืนยันนี้แล้วเปิดใบผลิตใหม่อีกครั้งเพื่อดูราคาล่าสุดก่อนยืนยัน', p_expected_spot_thb_per_gram, v_spot using errcode = '22023';
    end if;
  end if;

  -- รอบที่ 2: mutate จริง
  --
  -- 🔴 ลำดับ load-bearing (0131/0132 — ห้ามสลับ):
  --   1) เขียน snapshot ลง production_order_item (unit_cost/prev_*) ก่อน
  --   2) ensure central_stock แถวมีอยู่ + adjust_stock
  --   3) [0138] insert analytics.stock_lot (แทนที่ "stamp cost_type/unit_cost
  --      กลับไป public.product" เดิม — D1) + ยังคง set track_stock/since เหมือนเดิม
  --   4) พลิก production_order.status = 'done' เป็นบรรทัดสุดท้ายของฟังก์ชัน
  -- ต้องพลิกสถานะ "หลังสุด" เท่านั้น เพราะ trigger
  -- analytics.production_order_item_deny_mutation เช็คสถานะใบแม่สดทุกครั้งที่
  -- UPDATE item — ถ้าพลิกสถานะเป็น done ก่อนเขียนข้อ (1) ธุรกรรมนี้จะกัดตัวเอง
  for v_elem in select * from jsonb_array_elements(v_work) loop
    v_qty_done := (v_elem ->> 'qty_done_resolved')::int;

    if v_qty_done = 0 then
      -- ไม่ได้ผลิตจริงสำหรับรายการนี้ — บันทึกแค่ qty_done=0 ไม่แตะต้นทุน/สต็อก/lot
      update analytics.production_order_item
         set qty_done = 0, updated_at = now()
       where id = (v_elem ->> 'id')::uuid;
      continue;
    end if;

    -- 🔴 0138: เติม `for update` ปิด ABBA deadlock กับ
    -- analytics.product_track_stock_set (0137) ซึ่งล็อก product ก่อน
    -- central_stock — ฟังก์ชันนี้ (ก่อนหน้านี้) ล็อก central_stock (ผ่าน
    -- adjust_stock ด้านล่าง) ก่อนล็อก product (ตอน UPDATE stamp) กลับลำดับกัน
    -- ⇒ ล็อกที่นี่ให้เกิดก่อนแตะ central_stock เสมอ ให้ลำดับตรงกันทั้งคู่
    -- (security review ของ 0135, MEDIUM-1)
    select * into v_product from public.product
      where id = (v_elem ->> 'product_id')::uuid and shop_id = p_shop_id
      for update;
    if not found then
      raise exception 'production_order_done: ไม่พบ SKU (product_id=%) ในร้านนี้', v_elem ->> 'product_id' using errcode = '22023';
    end if;
    if not v_product.is_active then
      raise exception 'production_order_done: SKU % ปิดใช้งานแล้ว ผลิตไม่ได้', v_product.sku using errcode = '22023';
    end if;
    -- เช็คซ้ำตอน done เผื่อ SKU ถูก rename เป็น live* หลังถูกใส่ในใบไปแล้ว
    if v_product.sku ~* '^live' then
      raise exception 'production_order_done: SKU % เป็น SKU เฉพาะไลฟ์ (live*) ผลิตไม่ได้', v_product.sku using errcode = '22023';
    end if;

    -- 0132 M-b: กันเคส product.cost_type ถูกพลิกเป็น spot คั่นกลาง (READ COMMITTED)
    -- แล้ว production_cost_calc ไปหยิบราคาสดเอง ⇒ ข้ามการเทียบ M1 — raise แทนการเดาต่อ
    if v_product.cost_type = 'spot' and v_spot is null then
      raise exception 'production_order_done: SKU % ถูกเปลี่ยนเป็นโหมดราคาเงินระหว่างที่กำลังบันทึกใบนี้ — เปิดใบผลิตใหม่อีกครั้งเพื่อคำนวณต้นทุนใหม่', v_product.sku using errcode = '22023';
    end if;
    v_calc := analytics.production_cost_calc(
      p_shop_id, v_product.id,
      case when v_product.cost_type = 'spot' then v_spot else null end
    );
    v_unit_cost := (v_calc ->> 'unit_cost')::numeric;
    if v_unit_cost is null then
      raise exception 'production_order_done: คำนวณต้นทุน SKU % ไม่ได้ (unit_cost เป็น null)', v_product.sku using errcode = '22023';
    end if;

    -- 0138: v_before/v_after ของ audit log ไม่รวม cost_type/unit_cost เป็น
    -- "เปลี่ยน" อีกต่อไป — ฟังก์ชันนี้เลิก stamp ต้นทุนกลับ product แล้ว (D1)
    -- ต้นทุนของรอบผลิตนี้ไปอยู่ที่ stock_lot แถวใหม่ด้านล่างแทน (ดู insert ถัดไป)
    v_before := jsonb_build_object('cost_type', v_product.cost_type, 'unit_cost', v_product.unit_cost,
      'track_stock', v_product.track_stock, 'track_stock_since', v_product.track_stock_since);

    -- (1) snapshot ลง item ก่อน — ใบยังเป็น open ตอนนี้ ผ่าน trigger กันแก้
    update analytics.production_order_item
       set qty_done = v_qty_done, unit_cost = v_unit_cost,
           prev_cost_type = v_product.cost_type, prev_unit_cost = v_product.unit_cost,
           updated_at = now()
     where id = (v_elem ->> 'id')::uuid;

    -- (2) ensure central_stock แถวมีอยู่ก่อนเสมอ — SKU จาก generator ไม่มีแถวนี้
    -- มาตั้งแต่ต้น adjust_stock จะ raise ข้อความหลอก "would go negative" ถ้าไม่มี
    -- แถวให้ UPDATE เจอเลย
    insert into public.central_stock (product_id) values (v_product.id)
      on conflict (product_id) do nothing;

    perform public.adjust_stock(p_shop_id, v_product.id, v_qty_done, 'po:' || (v_elem ->> 'id'));

    -- (3) [0138] เลิก stamp cost_type/unit_cost กลับ product (D1 — ต้นทุนย้ายไป
    -- อยู่ที่ lot แล้ว) — ยังคงเปิด track_stock เหมือนเดิม (ห้ามเลื่อน
    -- track_stock_since ถ้าเปิดอยู่แล้ว — coalesce ค่าเดิมไว้ก่อนเสมอ)
    update public.product
       set track_stock = true,
           track_stock_since = coalesce(v_product.track_stock_since, v_today),
           updated_at = now()
     where id = v_product.id;

    -- 0138: สร้าง lot ต้นทุนของรอบผลิตนี้ — on conflict ผูกกับ partial unique
    -- index (production_order_item_id) ⇒ กด done ซ้ำ/re-run ไม่สร้าง lot ซ้ำ
    -- (idempotent — แต่ในทางปฏิบัติไม่มีทางถึงบรรทัดนี้ซ้ำอยู่ดี เพราะเคส
    -- "done ซ้ำ" ถูก early-return ไปแล้วตอนต้นฟังก์ชัน — on conflict คือ
    -- defense-in-depth เผื่อ caller อื่นในอนาคตที่ไม่ใช่ path นี้)
    insert into analytics.stock_lot (
      shop_id, product_id, source, unit_cost, qty_in, qty_remaining, received_on,
      production_order_item_id, note
    ) values (
      p_shop_id, v_product.id, 'production', v_unit_cost, v_qty_done, v_qty_done, v_today,
      (v_elem ->> 'id')::uuid, 'po_no=' || v_order.po_no
    )
    on conflict (production_order_item_id) where production_order_item_id is not null do nothing;

    v_after := jsonb_build_object('cost_type', v_product.cost_type, 'unit_cost', v_product.unit_cost,
      'track_stock', true, 'track_stock_since', coalesce(v_product.track_stock_since, v_today));

    -- 0132 M4: coalesce(p_actor, auth.uid())
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

-- signature ไม่เปลี่ยน (uuid, uuid, jsonb, numeric, uuid) — ไม่ต้อง drop function
-- (3j-migration-traps ข้อ 1) แต่ยังต้อง re-state revoke/grant เสมอ (ข้อ 2 — grant
-- ไม่หายจริงถ้า signature เดิมเป๊ะ แต่ re-state ไว้เป็น defense-in-depth ตามบรีฟ)
revoke execute on function analytics.production_order_done(uuid, uuid, jsonb, numeric, uuid) from public, anon, authenticated;
grant execute on function analytics.production_order_done(uuid, uuid, jsonb, numeric, uuid) to service_role;

-- ============================================================================
-- 4. Views — v_stock_lot (รายการ lot ที่ยังเหลือ + ต้นทุนเฉลี่ยถ่วงน้ำหนักต่อ SKU),
--    v_stock_lot_mismatch (ตรวจมือ: SKU track_stock ที่ sum(qty_remaining) ไม่
--    ตรงกับ central_stock.qty_on_hand — เตรียมไว้ก่อนเปิดกำแพงบังคับใน 0139),
--    และต่อท้าย v_dim_product ด้วย 3 คอลัมน์สรุป lot
-- ============================================================================

-- v_stock_lot: 1 แถว = 1 lot ที่ qty_remaining > 0 พร้อมคอลัมน์ต้นทุนเฉลี่ย
-- ถ่วงน้ำหนักของ "ชั้นที่เหลือทั้งหมดของ SKU นั้น" (ไม่ใช่แค่ lot นี้) — ใช้โชว์
-- เป็น "ต้นทุนของในมือ" เลขเดียวต่อ SKU คู่กับรายการ lot แยกด้านล่าง (design
-- §มติ FIFO: "หน้าจอโชว์เลขเดียว + รายการ lot แยกด้านล่างสำหรับคนที่ไม่ใช่
-- นักบัญชี"). WHERE กรอง qty_remaining>0 ก่อนคำนวณ window ⇒ ไม่มี division-by-
-- zero (ทุก product_id ที่โผล่ในผลลัพธ์มี qty_remaining รวม > 0 เสมอ)
create or replace view analytics.v_stock_lot
  with (security_invoker = true) as
select
  sl.id as lot_id,
  sl.shop_id,
  sl.product_id,
  p.sku,
  p.name as product_name,
  sl.source,
  sl.unit_cost,
  sl.qty_in,
  sl.qty_remaining,
  sl.received_on,
  sl.production_order_item_id,
  sl.note,
  sl.created_at,
  sl.updated_at,
  round(
    sum(sl.unit_cost * sl.qty_remaining) over (partition by sl.product_id)
    / sum(sl.qty_remaining) over (partition by sl.product_id),
  2) as sku_cost_avg_remaining
from analytics.stock_lot sl
join public.product p on p.id = sl.product_id
where sl.qty_remaining > 0;

revoke all on analytics.v_stock_lot from public, anon, authenticated;
grant select on analytics.v_stock_lot to service_role;

-- v_stock_lot_mismatch: SKU ที่ track_stock=true แต่ยอดรวม lot ที่เหลือ ไม่ตรง
-- กับ central_stock.qty_on_hand — ใช้ตรวจมือก่อนเปิด constraint trigger บังคับ
-- ใน 0139 (รอบนี้ยังไม่มี caller ลด qty_remaining เลย ดังนั้นถ้าเห็นแถวในนี้
-- ตอนนี้ = มีคนแก้ central_stock ตรงๆ นอกช่องทาง lot)
create or replace view analytics.v_stock_lot_mismatch
  with (security_invoker = true) as
select
  p.id as product_id,
  p.shop_id,
  p.sku,
  p.name as product_name,
  coalesce(sum(sl.qty_remaining), 0) as lot_qty_remaining_total,
  coalesce(cs.qty_on_hand, 0) as central_stock_qty_on_hand,
  coalesce(sum(sl.qty_remaining), 0) - coalesce(cs.qty_on_hand, 0) as mismatch_qty
from public.product p
left join public.central_stock cs on cs.product_id = p.id
left join analytics.stock_lot sl on sl.product_id = p.id and sl.qty_remaining > 0
where p.track_stock
group by p.id, p.shop_id, p.sku, p.name, cs.qty_on_hand
having coalesce(sum(sl.qty_remaining), 0) <> coalesce(cs.qty_on_hand, 0);

revoke all on analytics.v_stock_lot_mismatch from public, anon, authenticated;
grant select on analytics.v_stock_lot_mismatch to service_role;

-- v_dim_product: ต่อท้ายคอลัมน์เท่านั้น (3j-migration-traps ข้อ 3 — 42P16 ถ้า
-- แทรกกลาง) — select list 17 คอลัมน์แรกลอกมาจาก supabase/migrations/0028_sku_cost_margin.sql
-- คำต่อคำ (ยืนยันแล้วว่าเป็นฉบับล่าสุดที่ define view นี้จริง — grep ทั้งรีโปไม่
-- เจอ create/create-or-replace ของ view นี้หลัง 0028 เลย) effective_unit_cost/
-- margin_pct ไม่แตะ — transform_pending_order_lines ยังอ่าน effective_unit_cost
-- อยู่ (การสลับไปใช้ lot cost เป็นงานของ cutover ใน 0139+ ไม่ใช่รอบนี้)
create or replace view analytics.v_dim_product
  with (security_invoker = true) as
select
  p.id as product_id,
  p.shop_id,
  p.sku,
  p.name,
  (case p.cost_type
    when 'spot' then round(coalesce(p.silver_weight_g, 0) * coalesce(s.silver_spot_thb_per_gram, 0)
                            * coalesce(p.silver_purity, 0.925) + coalesce(p.labor_cost, 0), 2)
    else p.unit_cost
  end)::numeric(12, 2) as unit_cost,
  p.is_active,
  p.category,
  p.created_at,
  p.updated_at,
  p.cost_type,
  p.silver_weight_g,
  coalesce(p.silver_purity, 0.925) as silver_purity,
  p.labor_cost,
  p.list_price,
  p.unit_cost as manual_unit_cost,
  (case p.cost_type
    when 'spot' then round(coalesce(p.silver_weight_g, 0) * coalesce(s.silver_spot_thb_per_gram, 0)
                            * coalesce(p.silver_purity, 0.925) + coalesce(p.labor_cost, 0), 2)
    else p.unit_cost
  end)::numeric(12, 2) as effective_unit_cost,
  case
    when p.list_price is not null and p.list_price > 0 then
      round((p.list_price - (case p.cost_type
        when 'spot' then round(coalesce(p.silver_weight_g, 0) * coalesce(s.silver_spot_thb_per_gram, 0)
                                * coalesce(p.silver_purity, 0.925) + coalesce(p.labor_cost, 0), 2)
        else p.unit_cost end)) / p.list_price, 4)
    else null
  end as margin_pct,
  -- 0138: ต่อท้าย — "ต้นทุนของในมือ" ตาม lot (มติ D1, 19 ก.ย. 69) เป็นคอลัมน์
  -- แยก ไม่ปนกับ unit_cost/effective_unit_cost เดิมด้านบนซึ่งยังคงความหมายเดิม
  -- (คำนวณจาก cost_type/unit_cost ของ product ตรงๆ) — 0 ชัดเจนเมื่อไม่มี lot
  -- เหลือเลย ส่วน lot_cost_avg เป็น null (ไม่ใช่ 0) เมื่อไม่มี lot ให้ถ่วงน้ำหนัก
  coalesce(lot.qty_remaining_total, 0) as lot_qty_on_hand,
  lot.cost_avg_remaining as lot_cost_avg,
  coalesce(lot.lot_count, 0) as lot_count
from public.product p
left join analytics.shop_setting s on s.shop_id = p.shop_id
left join (
  select
    product_id,
    sum(qty_remaining) as qty_remaining_total,
    round(sum(unit_cost * qty_remaining) / sum(qty_remaining), 2) as cost_avg_remaining,
    count(*) as lot_count
  from analytics.stock_lot
  where qty_remaining > 0
  group by product_id
) lot on lot.product_id = p.id;

-- CREATE OR REPLACE VIEW คงโครง OID เดิม ⇒ grant ที่มีอยู่แล้ว (จาก 0123/0124 —
-- anon/authenticated ถูก revoke ทั้ง schema analytics ไปแล้ว, service_role
-- เข้าถึงได้เพราะ BYPASSRLS) ไม่หายไปไหน ไม่ต้อง grant ใหม่

-- ============================================================================
-- 5. Backfill — SKU ที่ track_stock=true และ central_stock.qty_on_hand>0 ⇒
--    สร้าง lot source='opening' อิง**ยอด qty_on_hand ปัจจุบัน**เท่านั้น (ห้าม
--    อิงประวัติใบผลิต — PO-0002 เป็นใบทดสอบที่ถอย stock กลับไปแล้ว 19 ก.ย. 69
--    ยืนยันแล้ว: วันนี้ track_stock=true มี 1 SKU (S-1bath) แต่ qty_on_hand=0
--    ⇒ ไม่มีแถวไหนเข้าเงื่อนไขจริง — do-block นี้ no-op บน prod วันนี้ แต่ต้อง
--    เขียนให้ถูกไว้เผื่ออนาคต (พิสูจน์ด้วย SKU สังเคราะห์ใน scripts/verify-0138.sql)
--
--    idempotent: ข้าม SKU ที่มี lot source='opening' อยู่แล้ว (กันสร้างซ้ำถ้า
--    migration ถูก apply ซ้ำ)
--
--    ห้ามใส่ต้นทุน 0 เงียบๆ ถ้า effective_unit_cost เป็น null — raise ทั้ง
--    migration ทันที (ไม่ commit อะไรเลยถ้ามี SKU ไหนพลาดเงื่อนไขนี้)
-- ============================================================================

do $$
declare
  v_missing_cost_skus text;
begin
  select string_agg(p.sku, ', ')
    into v_missing_cost_skus
  from public.product p
  join public.central_stock cs on cs.product_id = p.id
  join analytics.v_dim_product v on v.product_id = p.id
  where p.track_stock
    and cs.qty_on_hand > 0
    and v.effective_unit_cost is null
    and not exists (
      select 1 from analytics.stock_lot sl
       where sl.product_id = p.id and sl.source = 'opening'
    );

  if v_missing_cost_skus is not null then
    raise exception 'stock_lot backfill: SKU ต่อไปนี้ track_stock=true และมี qty_on_hand>0 แต่ effective_unit_cost เป็น null — ห้ามสร้าง lot ต้นทุน 0 โดยเดา กรอกต้นทุนที่ /catalog ก่อนแล้วรัน migration นี้ใหม่: %', v_missing_cost_skus
      using errcode = '22023';
  end if;

  -- received_on = track_stock_since ตามบรีฟ — track_stock=true ต้องมี
  -- track_stock_since เสมอ (production_order_done/product_track_stock_set
  -- ตั้งคู่กันทุกครั้ง) coalesce วันนี้ (เวลาไทย) ไว้เป็น fallback เชิงป้องกัน
  -- เท่านั้น ไม่ใช่ค่าที่คาดว่าจะถูกใช้จริง
  insert into analytics.stock_lot (
    shop_id, product_id, source, unit_cost, qty_in, qty_remaining, received_on, note
  )
  select
    p.shop_id, p.id, 'opening', v.effective_unit_cost, cs.qty_on_hand, cs.qty_on_hand,
    coalesce(p.track_stock_since, (now() at time zone 'Asia/Bangkok')::date),
    'backfill 0138: ยอดคงเหลือตอน apply migration'
  from public.product p
  join public.central_stock cs on cs.product_id = p.id
  join analytics.v_dim_product v on v.product_id = p.id
  where p.track_stock
    and cs.qty_on_hand > 0
    and not exists (
      select 1 from analytics.stock_lot sl
       where sl.product_id = p.id and sl.source = 'opening'
    );
end;
$$;

notify pgrst, 'reload schema';

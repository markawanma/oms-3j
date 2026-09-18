-- 0133_stock_sync_sales.sql
-- P1.5 (design: docs/3j-jewelry/oms/system-flow-2026-09.md §1 "ข้อเสนอ P1.5" +
-- docs/3j-jewelry/oms/design-production-order.md) — สต็อก opt-in ต่อ SKU +
-- reconcile ยอดขายจาก analytics.fact_order(_item) เข้า central_stock
--
-- ⚠️ SQL อย่างเดียว — ไม่แตะ TypeScript/หน้าเว็บ (wiring เป็นรอบถัดไป)
-- ⚠️ 💰 แตะ stock ledger — security ต้องผ่านก่อน merge (กติกา QA 27 ส.ค. 69)
-- ⚠️ ห้าม apply เอง — Tech Lead dry-run (scripts/verify-0133.sql, do-block +
--    raise บังคับ rollback) แล้ว apply ผ่าน MCP เท่านั้น (skill supabase-migrate)
--
-- ============================================================================
-- ทำไม "ตัดต่อ fact_order_item.id" และ "ตัดต่อ (order, sku)" ผิดทั้งคู่
-- ============================================================================
-- Re-import ไฟล์เดือนเดิม = ลบ fact_order_item ของออเดอร์นั้นทั้งก้อนแล้ว insert
-- ใหม่ (0041:249, 0093:121, 0094:160) ⇒ id เปลี่ยนทุกครั้ง — idem key ต่อ id จะเห็น
-- "รายการใหม่" ทุกรอบแล้วตัดซ้ำ และแม้ใช้ key ต่อ (order, sku) เฉยๆ ก็ยังพัง เพราะ
-- ลูกค้าสั่งเพิ่มบนใบเดิมข้ามวันได้ (memory: orders-accumulate-across-days) ⇒
-- จำนวนเปลี่ยนแต่ key เดิม ⇒ adjust_stock raise 23505 (signed-delta guard 0007)
--
-- ทางที่ถูกต้องคือ "reconcile": เก็บว่าตัดไปแล้วเท่าไร (stock_sale_applied) แล้ว
-- เทียบกับยอดที่ควรจะเป็นจริงตอนนี้ (target, คำนวณสดจาก fact_order_item ทุกครั้ง)
-- delta = target − applied ⇒ ปรับสต็อกแค่ส่วนต่าง แล้วเลื่อน sync_seq ไปอีกขั้น
-- ⇒ idem key ของ adjust_stock (ซึ่งบังคับ "1 key ใช้ได้ครั้งเดียว" อยู่แล้ว) จึง
-- ได้ key ใหม่เสมอเมื่อมีการปรับจริง และ "ไม่ปรับ" (delta=0) ก็ไม่ต้องมี key เลย
-- ⇒ re-import จำนวนเท่าเดิมจึงไม่มี ledger row เพิ่ม (idempotent โดยธรรมชาติ)
--
-- ============================================================================
-- จุดที่ "ทำตามเป๊ะ" ตาม design/brief (อ้างอิงเลขข้อในบรีฟที่ได้รับ)
-- ============================================================================
--   1. advisory lock ใช้ key เดียวกับ 0114 (transform_pending_orders) /
--      0115 (import_delete_orders / import_restore_orders):
--      hashtext('analytics.fact_order:' || shop_id) — กันวิ่งซ้อนกับ
--      import/ลบ/กู้คืนของ shop เดียวกัน
--   2. full outer join ระหว่าง target กับ stock_sale_applied — ออเดอร์ที่หายไป
--      จาก fact_order (ลบ/ยกเลิกจริง — 0115 ลบแบบ physical delete) ⇒ ไม่มีแถวใน
--      target เลย ⇒ เห็นเป็น target 0 ⇒ คืนสต็อกอัตโนมัติ โดยไม่ต้องแตะ 0115 เลย
--   3. target กรอง order_date >= product.track_stock_since เสมอ — ไม่ตัดย้อนหลัง
--      ก่อนวันเปิดนับ (ยอดตั้งต้นที่กรอกตอนเปิดคือ "ของในมือวันนั้น" สะท้อนการขาย
--      ก่อนหน้าแล้ว)
--   4. ทุกคู่ (order, product) ห่อ begin/exception แยกกัน (pattern เดียวกับ 0041's
--      per-row try/catch) — ตัดไม่ได้ (สต็อกไม่พอ = errcode P0001 จาก 0007) ⇒
--      เก็บ last_error ไว้ที่แถวนั้น แล้ว "continue" ไปคู่ถัดไป ไม่ล้มทั้ง batch
--   5. product_track_stock_set ปฏิเสธ sku ~* '^live' — regex เดียวกับที่ 0121:258
--      และ 0131/0132 (production_order_done) ใช้อยู่แล้ว ไม่เขียนใหม่
--   6. ทุก RPC: security definer + set search_path (public, analytics,
--      extensions, pg_temp) + crm_require_owner_admin + revoke
--      public/anon/authenticated + grant service_role เท่านั้น + คืน jsonb
--      (ไม่ใช้ returns table — เลี่ยงกับดัก 42702 ข้อ 12 ของ skill
--      3j-migration-traps โดยสิ้นเชิง)
--   7. ปิดท้ายไฟล์ notify pgrst, 'reload schema'
--
-- ============================================================================
-- 3 จุดที่ผมตัดสินใจเอง นอกเหนือคำสั่งในบรีฟ — มีเหตุผลรองรับ ไม่ใช่เดา
-- ============================================================================
--   [A] track_stock_since ใช้ coalesce(เดิม, วันนี้) ไม่ใช่ "set = วันนี้เสมอ"
--       ตามที่ system-flow §1 เขียนไว้ (ประโยคที่ไม่มี coalesce) เหตุผล: คอมเมนต์
--       บนคอลัมน์นี้เองที่ 0131 เขียนไว้แล้ว (บังคับใช้จริงบน prod) ระบุชัดว่า
--       "ห้ามถูกเลื่อนถ้าเคยเปิดแล้ว" เป็นกติกาของ "คอลัมน์" ไม่ใช่เฉพาะของ
--       production_order_done ตัวเดียว — ถ้า RPC นี้ set ทับเป็นวันนี้เสมอตอน
--       ปิดแล้วเปิดใหม่ (ปิด → เปิดใหม่ทีหลัง) จะทำให้ยอดที่เคย reconcile ไปแล้ว
--       ระหว่าง since เดิมกับวันนี้ "หลุด scope" ของ target ทันที (target กรอง
--       order_date >= since) แล้ว full outer join ข้อ 2 จะเห็นเป็น "target หาย"
--       เหมือนออเดอร์ถูกลบ ⇒ คืนสต็อกผิดๆ ให้ยอดที่ขายไปแล้วจริง — บั๊กเงียบที่
--       แก้คืนยากกว่าการยึดกติกาคอลัมน์เดิมมาก
--       ผลข้างเคียงที่รู้ตัว: ถ้าปิดแล้วเปิดใหม่โดยตั้งใจใส่ "ยอดตั้งต้นใหม่" (นับ
--       ของใหม่) ตัว idem key ('init:'||product||':'||since) จะซ้ำกับตอนเปิดครั้ง
--       แรก (เพราะ since ไม่ขยับ) — ถ้าใส่จำนวนต่างจากเดิม adjust_stock จะ
--       raise 23505 (idem key ซ้ำแต่ delta ไม่ตรง) ปฏิเสธการเรียกตรงๆ (ไม่เงียบ)
--       แทนที่จะยอมให้ทับเงียบๆ — ยังไม่มี UI ให้กดสถานการณ์นี้ในรอบนี้ (wiring
--       รอบหน้า) ธงไว้ให้ Tech Lead ตัดสินว่าต้องมี flow แยกสำหรับ "reset ยอดตั้ง
--       ต้นใหม่" หรือไม่ ก่อนต่อปุ่มจริงบน /catalog
--   [B] ฝั่ง applied ของ full outer join ต้อง join กับ product แล้วกรอง
--       p.track_stock ด้วย (ไม่ใช่กรองแค่ shop_id/source_order_no ตามที่ข้อความ
--       design พูดสั้นๆ) เหตุผล: ถ้าไม่กรอง เมื่อ SKU ถูกปิด track_stock (แต่เคย
--       มีประวัติ applied จากตอนเปิดอยู่) target ฝั่งนั้นจะหายไปทันที (target join
--       กรอง p.track_stock อยู่แล้ว) แต่ applied ฝั่งนั้นยังโผล่อยู่ ⇒ full outer
--       join เห็นเป็น "target หาย" เหมือนออเดอร์ถูกลบ ⇒ คืนสต็อกทั้งหมดที่เคยตัด
--       ไปทันทีที่กดปิด — ขัดกับกติกาที่บรีฟเขียนไว้ชัดว่า "ปิด ⇒ ห้ามล้าง ledger"
--       การกรอง p.track_stock ทั้งสองฝั่งทำให้ปิดแล้ว = ledger ของ SKU นั้นแข็ง
--       (frozen) ไม่ถูกแตะเลยจนกว่าจะเปิดใหม่ ตรงตามเจตนาบรีฟ
--   [C] p_initial_qty = 0 ⇒ ข้าม adjust_stock ไปเลย ไม่เรียก เหตุผล: adjust_stock
--       (0007) ปฏิเสธ p_qty_delta = 0 ด้วย "must be a non-zero integer" — ถ้าเรียก
--       ตรงตามข้อความ design ("adjust_stock(+p_initial_qty, ...)") ทื่อๆ ทุกครั้ง
--       SKU ใหม่ที่ยังไม่มีของในมือเลย (initial_qty=0 — เคสที่สมเหตุสมผลมากสำหรับ
--       "ของใหม่ที่ปักตะกร้าขายแยก SKU" ตามมติเจ้าของ) จะเปิด track_stock ไม่ได้
--       เลย ⇒ ข้าม adjust_stock เมื่อ 0 แต่ยัง ensure central_stock row +
--       set track_stock=true ตามปกติ (ยอดเริ่มที่ 0 อยู่แล้วโดย default ของตาราง)
--
-- ============================================================================
-- Checklist ตาม skill 3j-migration-traps (11 ข้อ) ที่เกี่ยวกับไฟล์นี้
-- ============================================================================
--   #1 signature ใหม่ทั้งคู่ (ไม่เคยมี function เดิมชื่อนี้มาก่อน) — create or
--      replace ตรงๆ ปลอดภัย ไม่มี overload ค้าง
--   #2 grant ไม่ติดมาเอง — revoke/grant explicit ครบทั้ง 2 ฟังก์ชันด้านล่าง
--   #4/#5 numeric ไม่มีในไฟล์นี้เลย (ใช้ int/text/boolean/date ล้วน) —
--      qty รับเป็น int ดักตั้งแต่ cast (NaN เข้าไม่ได้อยู่แล้ว)
--   #6 (UTC) — track_stock_since ทุกจุดใช้ (now() at time zone
--      'Asia/Bangkok')::date
--   #7 ไม่มี grant เหวี่ยงแหทั้ง schema
--   #10 apply ต้องผ่าน apply_migration (ไม่ใช่ execute_sql) — หน้าที่ Tech Lead
--   #11 ทดสอบใน scripts/verify-0133.sql ต้องเป็น do-block เดียว + raise
--      บังคับ rollback (แตะ stock ledger จริง) — ชอปที่ใช้เป็น shop/SKU สังเคราะห์
--      เท่านั้น
--   #12 คืน jsonb ไม่ใช้ returns table — ไม่มีความเสี่ยง column ชนกับ OUT var เลย

-- ============================================================================
-- 1. public.product.reorder_point — เพิ่มเฉยๆ ยังไม่มี logic (P3a §2 จะใช้)
-- ============================================================================

alter table public.product
  add column if not exists reorder_point int;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_reorder_point_check') then
    alter table public.product add constraint product_reorder_point_check
      check (reorder_point is null or (reorder_point >= 0 and reorder_point <= 100000));
  end if;
end $$;

comment on column public.product.reorder_point is
  'P1.5 (0133): null = ใช้ค่า default ของร้าน (analytics.shop_setting.default_reorder_point, '
  'P3a ยังไม่สร้าง). ยังไม่มี view/RPC ใดอ่านคอลัมน์นี้ในรอบนี้ — เตรียมไว้ให้ P3a '
  '(analytics.v_stock_alert) ต่อ.';

-- ============================================================================
-- 2. analytics.stock_sale_applied — "ตัดสต็อกไปแล้วเท่าไรต่อ (ออเดอร์, สินค้า)"
--    baseline ของ reconcile ทั้งระบบ
-- ============================================================================

create table analytics.stock_sale_applied (
  shop_id          uuid not null references public.shop (id) on delete cascade,
  source_order_no  text not null,
  product_id       uuid not null references public.product (id) on delete cascade,
  qty_applied      int not null default 0,
  sync_seq         int not null default 0,
  last_error       text,
  updated_at       timestamptz not null default now(),
  constraint pk_stock_sale_applied primary key (shop_id, source_order_no, product_id),
  constraint chk_stock_sale_applied_qty_applied check (qty_applied >= 0),
  constraint chk_stock_sale_applied_sync_seq check (sync_seq >= 0)
);

comment on table analytics.stock_sale_applied is
  'P1.5 (0133): 1 แถวต่อ (ออเดอร์, สินค้าที่ track_stock=true) ที่เคย reconcile — '
  'qty_applied = ตัดไปแล้วเท่าไร ณ ตอนนี้ (เทียบกับ target ที่คำนวณสดทุกครั้งใน '
  'analytics.stock_sync_sales) sync_seq ใช้ประกอบ idem key ของ adjust_stock '
  '(sale:<order>:<product>:<sync_seq+1>) ให้ได้ key ใหม่ทุกครั้งที่มีการปรับจริง '
  'last_error = ข้อความล่าสุดถ้าตัด/คืนไม่ได้ (เช่น สต็อกไม่พอ) — ไม่บล็อก batch อื่น';

alter table analytics.stock_sale_applied enable row level security;
-- ไม่มี policy ตั้งใจ — เข้าได้ทาง service_role เท่านั้น (RPC 2 ตัวด้านล่าง หรือ
-- service client โดยตรงถ้าจำเป็น) จนกว่าจะมีหน้าจอที่ต้องอ่านตรง (ไม่มีในรอบนี้ —
-- ขอบเขต SQL อย่างเดียว, wiring รอบถัดไป) pattern เดียวกับ analytics.label_file /
-- analytics.stg_label_page (0097): enable RLS ไม่มี policy ⇒ block ทุก role ที่
-- ไม่ใช่ superuser/bypassrls โดยปริยาย
revoke all on analytics.stock_sale_applied from public, anon, authenticated;
grant all on analytics.stock_sale_applied to service_role;

-- ============================================================================
-- 3. analytics.product_track_stock_set — toggle มือ (เปิด/ปิด) + ยอดตั้งต้น
--    เมื่อเปิด (P1.5 §1 — "ไม่มีรอบนับของใหญ่ กรอกยอดในมือตอนเปิดทีละตัว")
-- ============================================================================

create or replace function analytics.product_track_stock_set(
  p_shop_id     uuid,
  p_product_id  uuid,
  p_enabled     boolean,
  p_initial_qty int default 0
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_product public.product%rowtype;
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
  v_since   date;
  v_qty     int;
begin
  if p_shop_id is null or p_product_id is null then
    raise exception 'product_track_stock_set: p_shop_id and p_product_id are required';
  end if;
  if p_enabled is null then
    raise exception 'product_track_stock_set: p_enabled is required';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_product from public.product
    where id = p_product_id and shop_id = p_shop_id
    for update;
  if not found then
    raise exception 'product_track_stock_set: ไม่พบ SKU % ในร้านนี้', p_product_id using errcode = '22023';
  end if;

  -- live-SKU ไม่นับสต็อกเด็ดขาด (มติเจ้าของ §8 ข้อ 1) — บล็อกทั้งเปิดและปิด กัน
  -- ใครก็ตามยุ่งกับ track_stock ของกลุ่มนี้ผ่าน RPC นี้เลยแม้แต่ครั้งเดียว (regex
  -- เดียวกับ 0121:258 / 0131/0132 production_order_done — ห้ามเขียนใหม่)
  if v_product.sku ~* '^live' then
    raise exception 'product_track_stock_set: SKU % เป็น SKU เฉพาะไลฟ์ (live*) ไม่นับสต็อก (มติเจ้าของ 17 ก.ย. 69)', v_product.sku using errcode = '22023';
  end if;

  if not p_enabled then
    -- ปิด: แค่ปิดธง ห้ามล้าง ledger/stock_sale_applied/track_stock_since —
    -- ประวัติทั้งหมดยังอยู่เผื่อเปิดใหม่ในอนาคต (idempotent ถ้าปิดซ้ำ — update
    -- เดิมซ้ำไม่มีผลข้างเคียง)
    update public.product
       set track_stock = false, updated_at = now()
     where id = p_product_id;

    return jsonb_build_object(
      'product_id', p_product_id, 'track_stock', false,
      'track_stock_since', v_product.track_stock_since, 'already_enabled', false
    );
  end if;

  -- เปิด แต่เปิดอยู่แล้ว ⇒ no-op idempotent — กันดับเบิลคลิก/เรียกซ้ำไปเลื่อน
  -- track_stock_since หรือ apply ยอดตั้งต้นซ้ำ (ตัดสินใจเอง — ดูหัวไฟล์ [A])
  if v_product.track_stock then
    return jsonb_build_object(
      'product_id', p_product_id, 'track_stock', true,
      'track_stock_since', v_product.track_stock_since, 'already_enabled', true
    );
  end if;

  v_qty := coalesce(p_initial_qty, 0);
  if not (v_qty >= 0 and v_qty <= 100000) then
    raise exception 'product_track_stock_set: p_initial_qty ต้องอยู่ระหว่าง 0-100000 (ได้ %)', p_initial_qty using errcode = '22023';
  end if;

  -- ห้ามเลื่อน track_stock_since ถ้าเคยเปิดมาก่อน — กติกาของคอลัมน์นี้เอง
  -- (คอมเมนต์ที่ 0131 เขียนไว้แล้ว) ไม่ใช่แค่ของ production_order_done ตัวเดียว
  -- (ตัดสินใจเอง — ดูหัวไฟล์ [A])
  v_since := coalesce(v_product.track_stock_since, v_today);

  -- ensure central_stock แถวมีอยู่ก่อนเสมอ (pattern เดียวกับ 0131/0132 —
  -- SKU จาก generator ไม่มีแถวนี้มาตั้งแต่ต้น มีแค่ตอน /products/new เท่านั้น
  -- ไม่ ensure ก่อน adjust_stock จะ raise ข้อความหลอก "would go negative")
  insert into public.central_stock (product_id) values (p_product_id)
    on conflict (product_id) do nothing;

  -- ยอดตั้งต้น = 0 ⇒ ข้าม adjust_stock ไปเลย (delta=0 โดน adjust_stock ปฏิเสธ
  -- ด้วย "p_qty_delta must be a non-zero integer" อยู่แล้ว — ไม่ใช่บั๊กของ
  -- RPC นี้ แต่เป็นเคสจริงที่ design ไม่ได้พูดถึงตรงๆ, ตัดสินใจเอง — ดูหัวไฟล์ [C])
  if v_qty > 0 then
    perform public.adjust_stock(p_shop_id, p_product_id, v_qty, 'init:' || p_product_id::text || ':' || v_since::text);
  end if;

  update public.product
     set track_stock = true, track_stock_since = v_since, updated_at = now()
   where id = p_product_id;

  return jsonb_build_object(
    'product_id', p_product_id, 'track_stock', true,
    'track_stock_since', v_since, 'initial_qty', v_qty, 'already_enabled', false
  );
end;
$$;

revoke execute on function analytics.product_track_stock_set(uuid, uuid, boolean, int) from public, anon, authenticated;
grant  execute on function analytics.product_track_stock_set(uuid, uuid, boolean, int) to service_role;

-- ============================================================================
-- 4. analytics.stock_sync_sales — reconcile ยอดขายจาก fact_order(_item) เข้า
--    central_stock เฉพาะ SKU ที่ track_stock=true (P1.5 §1)
-- ============================================================================

create or replace function analytics.stock_sync_sales(
  p_shop_id           uuid,
  p_source_order_nos  text[] default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_rec      record;
  v_delta    int;
  v_idem_key text;
  v_deducted int := 0;
  v_returned int := 0;
  v_failed   jsonb := '[]'::jsonb;
  v_err      text;
begin
  if p_shop_id is null then
    raise exception 'stock_sync_sales: p_shop_id is required';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  -- key เดียวกับ 0114 (transform_pending_orders) / 0115 (import_delete_orders,
  -- import_restore_orders) ⇒ ไม่มีทางวิ่งซ้อนกับ import/ลบ/กู้คืนของ shop เดียวกัน
  perform pg_advisory_xact_lock(hashtext('analytics.fact_order:' || p_shop_id::text));

  for v_rec in
    select
      coalesce(tgt.source_order_no, ap.source_order_no) as source_order_no,
      coalesce(tgt.product_id, ap.product_id)           as product_id,
      coalesce(tgt.target_qty, 0)                       as target_qty,
      coalesce(ap.qty_applied, 0)                       as qty_applied,
      coalesce(ap.sync_seq, 0)                          as sync_seq
    from (
      -- target = ยอดที่ "ควรตัดไปแล้ว" ตอนนี้ ต่อ (ออเดอร์, สินค้า) — คำนวณสด
      -- ทุกครั้ง ไม่เก็บ snapshot inner join กับ product ทำให้ product_id ที่เป็น
      -- null (SKU import ไม่ match) หลุดออกจาก target โดยอัตโนมัติ (ข้ามเงียบ
      -- ตามที่ design ต้องการ ไม่ต้องเขียนเงื่อนไขแยก)
      select fo.source_order_no, foi.product_id, sum(foi.qty)::int as target_qty
      from analytics.fact_order fo
      join analytics.fact_order_item foi on foi.fact_order_id = fo.id
      join public.product p on p.id = foi.product_id and p.shop_id = fo.shop_id
      where fo.shop_id = p_shop_id
        and p.track_stock
        and fo.order_date >= p.track_stock_since
        and (p_source_order_nos is null or fo.source_order_no = any (p_source_order_nos))
      group by fo.source_order_no, foi.product_id
    ) tgt
    full outer join (
      -- applied = ตัดไปแล้วเท่าไรจากรอบก่อนๆ — join กับ product แล้วกรอง
      -- p.track_stock ด้วย (ไม่ใช่กรองแค่ shop_id/source_order_no) เพื่อไม่ให้
      -- SKU ที่ถูกปิด track_stock ไปแล้วโผล่มาเป็น "target หาย" แล้วโดนคืนสต็อก
      -- ผิดๆ (ตัดสินใจเอง — ดูหัวไฟล์ [B])
      select sa.source_order_no, sa.product_id, sa.qty_applied, sa.sync_seq
      from analytics.stock_sale_applied sa
      join public.product p on p.id = sa.product_id and p.shop_id = sa.shop_id
      where sa.shop_id = p_shop_id
        and p.track_stock
        and (p_source_order_nos is null or sa.source_order_no = any (p_source_order_nos))
    ) ap
      on ap.source_order_no = tgt.source_order_no and ap.product_id = tgt.product_id
  loop
    v_delta := v_rec.target_qty - v_rec.qty_applied;
    if v_delta = 0 then
      -- idempotent: ไม่มีอะไรเปลี่ยน ไม่แตะ ledger เลย ไม่ต้องมี idem key ด้วยซ้ำ
      continue;
    end if;

    -- seq ใหม่ทุกครั้งที่มีการปรับจริง ⇒ idem key ของ adjust_stock ไม่ชนกันเอง
    -- ข้ามรอบ sync (0007's signed-delta guard คุมกันการเรียกซ้ำ key เดิมด้วย
    -- delta ต่างอยู่แล้วเป็นชั้นที่สอง)
    v_idem_key := 'sale:' || v_rec.source_order_no || ':' || v_rec.product_id::text || ':' || (v_rec.sync_seq + 1)::text;

    begin
      -- ensure central_stock แถวมีอยู่ก่อนเสมอ (defense-in-depth — SKU ที่
      -- track_stock=true ควรมีแถวนี้แล้วจาก product_track_stock_set/production_
      -- order_done แต่ insert...on conflict do nothing ไม่มีต้นทุนถ้าซ้ำ)
      insert into public.central_stock (product_id) values (v_rec.product_id)
        on conflict (product_id) do nothing;

      -- v_delta > 0: ขายเพิ่ม/ยังตัดไม่ครบ ⇒ ต้องหักสต็อกเพิ่ม -v_delta (ติดลบ)
      -- v_delta < 0: ออเดอร์หาย/จำนวนลดลง ⇒ ต้องคืนสต็อก -v_delta (เป็นบวก)
      perform public.adjust_stock(p_shop_id, v_rec.product_id, -v_delta, v_idem_key);

      insert into analytics.stock_sale_applied (shop_id, source_order_no, product_id, qty_applied, sync_seq, last_error, updated_at)
      values (p_shop_id, v_rec.source_order_no, v_rec.product_id, v_rec.target_qty, v_rec.sync_seq + 1, null, now())
      on conflict (shop_id, source_order_no, product_id)
      do update set qty_applied = excluded.qty_applied, sync_seq = excluded.sync_seq, last_error = null, updated_at = now();

      if v_delta > 0 then
        v_deducted := v_deducted + v_delta;
      else
        v_returned := v_returned + (-v_delta);
      end if;
    exception when others then
      -- ตัดไม่ได้ (สต็อกไม่พอ = errcode P0001 จาก adjust_stock 0007) หรือ error
      -- อื่นใดก็ตาม ⇒ เก็บ last_error ไว้ที่แถวนั้น (qty_applied/sync_seq *ไม่*
      -- ขยับ ⇒ รอบ sync ถัดไปจะได้ delta เดิม + idem key เดิม ⇒ retry ได้เอง)
      -- แล้วไปคู่ถัดไป ไม่ล้มทั้ง batch (pattern เดียวกับ 0041)
      get stacked diagnostics v_err = message_text;

      insert into analytics.stock_sale_applied (shop_id, source_order_no, product_id, qty_applied, sync_seq, last_error, updated_at)
      values (p_shop_id, v_rec.source_order_no, v_rec.product_id, v_rec.qty_applied, v_rec.sync_seq, v_err, now())
      on conflict (shop_id, source_order_no, product_id)
      do update set last_error = excluded.last_error, updated_at = now();

      v_failed := v_failed || jsonb_build_object(
        'source_order_no', v_rec.source_order_no, 'product_id', v_rec.product_id,
        'delta', v_delta, 'error', v_err
      );
    end;
  end loop;

  return jsonb_build_object('deducted', v_deducted, 'returned', v_returned, 'failed', v_failed);
end;
$$;

revoke execute on function analytics.stock_sync_sales(uuid, text[]) from public, anon, authenticated;
grant  execute on function analytics.stock_sync_sales(uuid, text[]) to service_role;

notify pgrst, 'reload schema';

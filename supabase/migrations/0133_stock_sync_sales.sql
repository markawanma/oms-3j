-- 0133_stock_sync_sales.sql
-- P1.5 — สต็อก opt-in ต่อ SKU + reconcile ยอดขายจาก analytics.fact_order(_item)
-- เข้า public.central_stock
--
-- เหตุผลเต็ม + ทางเลือกที่ตกไป: docs/3j-jewelry/oms/design-production-order.md §P1.5
-- ดีไซน์ต้นทาง: docs/3j-jewelry/oms/system-flow-2026-09.md §1
--
-- ทำไมต้อง reconcile ไม่ใช่ "ขายแล้วตัด":
--   re-import ไฟล์เดือนเดิม = ลบ fact_order_item ทั้งก้อนแล้ว insert ใหม่ ⇒ id เปลี่ยนทุกรอบ
--   ⇒ idem key ต่อ id จะตัดซ้ำทุกรอบ และ key ต่อ (order, sku) เฉยๆ ก็พัง เพราะ
--   ลูกค้าสั่งเพิ่มบนใบเดิมข้ามวันได้ (memory: orders-accumulate-across-days)
--   ✅ ทางที่ใช้: เก็บว่าตัดไปแล้วเท่าไร (stock_sale_applied) เทียบกับยอดที่
--   ควรเป็นจริงตอนนี้ (target คำนวณสดทุกครั้ง) แล้วปรับแค่ delta = target − applied
--   ⇒ re-import จำนวนเท่าเดิม = delta 0 = ไม่มี ledger row เพิ่ม (idempotent โดยธรรมชาติ)
--   ⇒ ใบถูกลบ = target หาย ⇒ คืนสต็อกเอง ไม่ต้องแก้ 0115 เลย (0115 ลบจริง ไม่ใช่ธง)
--
-- 3 จุดที่เบี่ยงจากถ้อยคำ design — มติ Tech Lead 18 ก.ย. 69 (เหตุผลเต็มใน design doc):
--   [A] track_stock_since = coalesce(เดิม, วันนี้) ไม่ใช่ set ทับเป็นวันนี้เสมอ
--       (set ทับ = ยอดที่ reconcile ไปแล้วหลุด scope ⇒ คืนสต็อกให้ของที่ขายไปแล้วจริง)
--       + เปิดซ้ำพร้อมยอดตั้งต้น > 0 ถูกปฏิเสธด้วย 22023 ที่บอกทางออก (flow นับใหม่รอ P2/P3)
--   [B] ฝั่ง applied ของ full outer join ต้องกรอง p.track_stock ด้วย
--       (ไม่งั้น "กดปิดนับสต็อก" = คืนสต็อกที่ตัดไปแล้วคืนทั้งหมด — ปิดต้อง freeze ไม่ใช่ล้าง)
--   [C] p_initial_qty = 0 ⇒ ข้าม adjust_stock (0007 ปฏิเสธ delta=0) แต่ยัง ensure แถว
--       central_stock + เปิดธง — ไม่งั้น SKU ใหม่ที่ยังไม่มีของเลยจะเปิดนับไม่ได้
--
-- ข้อจำกัดที่รู้ตัว (หนี้ที่บันทึกไว้ — ต้องแก้ก่อนต่องานรอบถัดไป):
--   1. เปิดนับวันไหน ออเดอร์วันเดียวกันที่ขายไปก่อนนับจะโดนหักซ้ำ (order_date เป็น date
--      ไม่มีเวลา) ⇒ UI ต้องเขียนว่า "ให้นับก่อนเริ่มขายของวันนั้น"
--   2. ปิดนับไว้นานแล้วเปิดใหม่ ⇒ ยอดขายช่วงที่ปิดจะถูกตัดรวดเดียวรอบเดียว
--      ถ้าของไม่พอจะตกที่ last_error (fail closed เห็นได้) — ไม่เงียบแต่ต้องมี flow นับใหม่
--   3. ผู้เรียกที่ส่ง p_source_order_nos แบบจำกัด ต้องใส่เลขใบที่ถูกลบเข้ามาด้วย
--      ไม่งั้นสต็อกจะไม่ถูกคืน (deleteMissingOrders ต้องส่งเลขใบที่ลบมาด้วย หรือส่ง null)
--
-- ขอบเขต: SQL อย่างเดียว — wiring ฝั่ง TypeScript/หน้าเว็บเป็นรอบถัดไป
-- ทดสอบ: scripts/verify-0133.sql (do-block + raise บังคับ rollback, 3j-migration-traps #11)

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

  -- เคยเปิดนับมาก่อนแล้ว (track_stock_since ไม่ว่าง) = การ "เปิดซ้ำ" ไม่ใช่การตั้งยอดใหม่
  -- ยอดคงเหลือเดิมยังอยู่ใน central_stock ครบ (ปิด = ไม่ล้าง ledger — ดู [B])
  -- ถ้าปล่อยให้ใส่ยอดตั้งต้นซ้ำ จะไปชน idem key 'init:<product>:<since>' เดิม
  -- ⇒ adjust_stock raise 23505 ข้อความอ่านไม่รู้เรื่อง หรือถ้าจำนวนเท่าเดิมก็เงียบ
  -- ไม่บวกให้ (idempotent return) ทำให้เข้าใจผิดว่าตั้งยอดใหม่สำเร็จ
  -- ⇒ ปฏิเสธตรงนี้ด้วยข้อความที่บอกทางออกจริง (Tech Lead 18 ก.ย. 69 — flow นับใหม่ รอ P2/P3)
  if v_product.track_stock_since is not null and v_qty > 0 then
    raise exception 'product_track_stock_set: SKU % เคยเปิดนับสต็อกมาก่อนแล้ว (ตั้งแต่ %) ยอดคงเหลือเดิมยังอยู่ครบ — เปิดใหม่ให้ใส่ยอดตั้งต้นเป็น 0 ถ้าต้องการแก้ยอดให้ตรงกับที่นับได้จริง ให้ใช้เมนูปรับยอดสต็อกแทน', v_product.sku, v_product.track_stock_since using errcode = '22023';
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
      coalesce(ap.sync_seq, 0)                          as sync_seq,
      ap.last_error                                     as last_error
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
      select sa.source_order_no, sa.product_id, sa.qty_applied, sa.sync_seq, sa.last_error
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
      -- แต่ถ้ารอบก่อนเคยพลาดไว้ (last_error ค้าง) แล้วรอบนี้ตรงกันแล้ว ต้องล้างข้อความทิ้ง
      -- ไม่งั้นหน้าจอจะโชว์ "สต็อกไม่พอ" ค้างทั้งที่ไม่เหลือปัญหาแล้ว (Tech Lead 18 ก.ย. 69)
      if v_rec.last_error is not null then
        update analytics.stock_sale_applied
           set last_error = null, updated_at = now()
         where shop_id = p_shop_id
           and source_order_no = v_rec.source_order_no
           and product_id = v_rec.product_id;
      end if;
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

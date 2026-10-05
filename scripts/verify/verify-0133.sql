-- scripts/verify-0133.sql
--
-- Self-contained verify script for supabase/migrations/0133_stock_sync_sales.sql
-- (P1.5: analytics.product_track_stock_set + analytics.stock_sync_sales +
-- analytics.stock_sale_applied + public.product.reorder_point)
--
-- Per skill 3j-migration-traps #11: ทุกอย่างรันใน do $$ ... $$ block เดียว จบด้วย
-- `raise exception` เสมอ ⇒ ทั้ง transaction rollback ไม่ว่าผลจะผ่าน/ไม่ผ่าน —
-- อ่านผลจาก error message นี้ ใช้เป็นทั้ง dry-run (ก่อน apply 0133 จริง) และ
-- post-apply verify (รันซ้ำหลัง apply ผ่าน MCP apply_migration)
--
-- ⚠️ แตะ stock ledger จริง (💰) — ทดสอบด้วย shop/product/order สังเคราะห์ที่สร้าง
-- ขึ้นในทรานแซคชันนี้เองทั้งหมด ไม่แตะ shop/SKU/order จริงเลย (3j-migration-traps
-- ข้อ 11) หลังรันแล้วต้องตรวจซ้ำว่า state ไม่ขยับจริง (ดู "หลังรัน" ท้ายไฟล์)
--
-- ครอบ 8 เคสจากบรีฟ (T1-T8 ด้านล่าง) + เคสห้ามพัง 3 อัน (T9-T11) + 3 เคสจาก
-- decision ที่ผมตัดสินใจเอง (T12-T15, ดูหัวไฟล์ 0133 หัวข้อ [A]/[B]/[C]) +
-- grant/RLS/constraint (T16-T18)

do $$
declare
  v_log text := E'\n=== verify 0133 (stock_sync_sales P1.5) ===\n';

  v_shop_id  uuid := gen_random_uuid();
  v_shop2_id uuid := gen_random_uuid();
  v_channel_id uuid;

  v_p_a    uuid; -- SKU ทดสอบ flow ปกติเต็ม (T1/T2/T3/T4 + T9 + T12/T13/T14)
  v_p_b    uuid; -- SKU ทดสอบ "ออเดอร์ก่อน track_stock_since" (T5)
  v_p_c    uuid; -- SKU track_stock=false (T6)
  v_p_d    uuid; -- SKU ทดสอบ "สต็อกไม่พอ" (T7)
  v_p_e    uuid; -- SKU ทดสอบ p_initial_qty=0 (T15/[C])
  v_p_live uuid; -- SKU ~* '^live' (T8)
  v_p_shop2 uuid; -- SKU ในร้านอื่นที่ไม่เปิด track_stock เลย (T11)

  v_o1_id uuid := gen_random_uuid(); -- order ของ p_a
  v_o2_id uuid; -- order ของ p_b (ก่อน since)
  v_o3_id uuid; -- order ของ p_c (track_stock=false)
  v_o4_id uuid; -- order ของ p_d (สต็อกไม่พอ)
  v_item1_id uuid;

  v_res jsonb;

  v_qty_on_hand int;
  v_qty_applied int;
  v_sync_seq    int;
  v_last_error  text;
  v_ledger_count_before int;
  v_ledger_count_after  int;
  v_ledger_init_count   int;
  v_track_stock boolean;
  v_track_stock_since date;
  v_row_count int;

  v_priv_anon boolean;
  v_priv_auth boolean;
  v_priv_svc  boolean;
  v_fn_count  int;

  v_caught boolean;
  v_errmsg text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -----------------------------------------------------------------------
  -- Part 0: setup — shop สังเคราะห์ + channel จริง (seed 0010, เสถียร) +
  -- SKU ทดสอบแยกตัวต่อเคส
  -----------------------------------------------------------------------
  insert into public.shop (id, name) values (v_shop_id, 'ZZ TEST verify-0133');
  insert into public.shop (id, name) values (v_shop2_id, 'ZZ TEST verify-0133 shop2');

  select id into v_channel_id from analytics.dim_channel where code = 'tiktok';
  if v_channel_id is null then
    raise exception 'verify-0133 setup: analytics.dim_channel ไม่มีแถว tiktok (seed จาก 0010 ควรมีอยู่แล้ว)';
  end if;

  v_p_a     := analytics.product_upsert(v_shop_id,  'ZZ133-A',    'ทดสอบ flow ปกติ',       null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_b     := analytics.product_upsert(v_shop_id,  'ZZ133-B',    'ทดสอบก่อน since',       null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_c     := analytics.product_upsert(v_shop_id,  'ZZ133-C',    'ทดสอบ track_stock=false', null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_d     := analytics.product_upsert(v_shop_id,  'ZZ133-D',    'ทดสอบสต็อกไม่พอ',        null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_e     := analytics.product_upsert(v_shop_id,  'ZZ133-E',    'ทดสอบ initial_qty=0',   null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_live  := analytics.product_upsert(v_shop_id,  'LiveS15',    'ทดสอบ live-SKU',        null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_shop2 := analytics.product_upsert(v_shop2_id, 'ZZ133-SHOP2','ทดสอบร้านที่ไม่เปิดสต็อกเลย', null, 'fixed', 100, null, null, null, null, null, null, null, true);

  v_log := v_log || '[Part 0] setup shop+products: OK' || E'\n';

  -----------------------------------------------------------------------
  -- T8: product_track_stock_set กับ live-SKU ⇒ raise (ทั้งเปิดและปิด)
  -----------------------------------------------------------------------
  v_caught := false;
  begin
    perform analytics.product_track_stock_set(v_shop_id, v_p_live, true, 5);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T8a] เปิด track_stock บน live-SKU raise: %s' || E'\n', case when v_caught then 'OK' else 'FAIL' end);

  v_caught := false;
  begin
    perform analytics.product_track_stock_set(v_shop_id, v_p_live, false);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T8b] ปิด track_stock บน live-SKU raise ด้วย (บล็อกทั้งสองทิศทาง): %s' || E'\n', case when v_caught then 'OK' else 'FAIL' end);

  select track_stock into v_track_stock from public.product where id = v_p_live;
  v_log := v_log || format('[T8c] track_stock ของ live-SKU ยังเป็น false เหมือนเดิม (ไม่มีอะไรถูกแตะ): %s' || E'\n', case when v_track_stock = false then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T9 (เคสห้ามพัง) + setup หลัก: เปิด track_stock พร้อมยอดตั้งต้น ⇒ ledger
  -- มีแถว init: จริง (product A, B, D — ยอดตั้งต้น 20 / 10 / 1 ตามลำดับ)
  -----------------------------------------------------------------------
  v_res := analytics.product_track_stock_set(v_shop_id, v_p_a, true, 20);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_a;
  select count(*) into v_ledger_init_count from public.stock_ledger where product_id = v_p_a and idempotency_key like 'init:%';
  v_log := v_log || format('[T9a] เปิด A ยอดตั้งต้น 20 ⇒ central_stock.qty_on_hand=%s (คาด 20), ledger init: แถว=%s (คาด 1): %s' || E'\n',
    v_qty_on_hand, v_ledger_init_count, case when v_qty_on_hand = 20 and v_ledger_init_count = 1 then 'OK' else 'FAIL' end);

  perform analytics.product_track_stock_set(v_shop_id, v_p_b, true, 10);
  perform analytics.product_track_stock_set(v_shop_id, v_p_d, true, 1);

  select track_stock, track_stock_since into v_track_stock, v_track_stock_since from public.product where id = v_p_a;
  v_log := v_log || format('[T9b] product A track_stock=%s track_stock_since=%s (คาดวันนี้เวลาไทย): %s' || E'\n',
    v_track_stock, v_track_stock_since, case when v_track_stock and v_track_stock_since = (now() at time zone 'Asia/Bangkok')::date then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T12 ([A]-related, ตัดสินใจเอง): เปิดซ้ำ (double-click) ⇒ idempotent
  -- no-op — ไม่เลื่อน since ไม่ apply ยอดตั้งต้นซ้ำ
  -----------------------------------------------------------------------
  select count(*) into v_ledger_count_before from public.stock_ledger where product_id = v_p_a;
  v_res := analytics.product_track_stock_set(v_shop_id, v_p_a, true, 999);
  select count(*) into v_ledger_count_after from public.stock_ledger where product_id = v_p_a;
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_a;
  v_log := v_log || format('[T12a] เปิดซ้ำ (already_enabled=%s คาด true), ledger ก่อน=%s หลัง=%s (คาดเท่ากัน), on_hand=%s (คาดยังคง 20): %s' || E'\n',
    v_res ->> 'already_enabled', v_ledger_count_before, v_ledger_count_after, v_qty_on_hand,
    case when (v_res ->> 'already_enabled')::boolean and v_ledger_count_before = v_ledger_count_after and v_qty_on_hand = 20 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T15 ([C], ตัดสินใจเอง): p_initial_qty=0 ⇒ ไม่ raise ไม่มี ledger init: แถว
  -- แต่ central_stock ถูก ensure ไว้แล้ว (qty_on_hand=0) และ track_stock=true
  -----------------------------------------------------------------------
  v_caught := false;
  begin
    v_res := analytics.product_track_stock_set(v_shop_id, v_p_e, true, 0);
  exception when others then v_caught := true;
  end;
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_e;
  select count(*) into v_row_count from public.stock_ledger where product_id = v_p_e;
  select track_stock into v_track_stock from public.product where id = v_p_e;
  v_log := v_log || format('[T15] เปิด E ด้วย initial_qty=0 ไม่ raise (%s), central_stock ถูกสร้าง on_hand=%s (คาด 0), ledger แถว=%s (คาด 0), track_stock=%s: %s' || E'\n',
    case when not v_caught then 'OK' else 'FAIL' end, v_qty_on_hand, v_row_count, v_track_stock,
    case when not v_caught and v_qty_on_hand = 0 and v_row_count = 0 and v_track_stock then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Orders: O1 (product A, qty=2, วันนี้) · O2 (product B, qty=4, ก่อน since
  -- มาก — 2026-01-01) · O3 (product C — track_stock=false, qty=5) ·
  -- O4 (product D, qty=5 — เกินสต็อกที่มี 1)
  -----------------------------------------------------------------------
  insert into analytics.fact_order (id, shop_id, source_order_no, channel_id, order_date, revenue)
  values (v_o1_id, v_shop_id, 'ZZ133-O1', v_channel_id, (now() at time zone 'Asia/Bangkok')::date, 200);
  insert into analytics.fact_order_item (shop_id, fact_order_id, product_id, sku_snapshot, qty, unit_price)
  values (v_shop_id, v_o1_id, v_p_a, 'ZZ133-A', 2, 100) returning id into v_item1_id;

  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values (v_shop_id, 'ZZ133-O2', v_channel_id, '2026-01-01', 400) returning id into v_o2_id;
  insert into analytics.fact_order_item (shop_id, fact_order_id, product_id, sku_snapshot, qty, unit_price)
  values (v_shop_id, v_o2_id, v_p_b, 'ZZ133-B', 4, 100);

  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values (v_shop_id, 'ZZ133-O3', v_channel_id, (now() at time zone 'Asia/Bangkok')::date, 500) returning id into v_o3_id;
  insert into analytics.fact_order_item (shop_id, fact_order_id, product_id, sku_snapshot, qty, unit_price)
  values (v_shop_id, v_o3_id, v_p_c, 'ZZ133-C', 5, 100);

  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values (v_shop_id, 'ZZ133-O4', v_channel_id, (now() at time zone 'Asia/Bangkok')::date, 500) returning id into v_o4_id;
  insert into analytics.fact_order_item (shop_id, fact_order_id, product_id, sku_snapshot, qty, unit_price)
  values (v_shop_id, v_o4_id, v_p_d, 'ZZ133-D', 5, 100);

  v_log := v_log || '[Part 0b] setup orders O1-O4: OK' || E'\n';

  -----------------------------------------------------------------------
  -- แรก sync O1 (product A): target=2, applied=0 ⇒ deduct 2
  -----------------------------------------------------------------------
  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ133-O1']);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_a;
  select qty_applied, sync_seq into v_qty_applied, v_sync_seq from analytics.stock_sale_applied where shop_id = v_shop_id and source_order_no = 'ZZ133-O1' and product_id = v_p_a;
  v_log := v_log || format('[setup] sync O1 แรก: deducted=%s (คาด 2), on_hand=%s (คาด 18), applied=%s seq=%s (คาด 2/1): %s' || E'\n',
    v_res ->> 'deducted', v_qty_on_hand, v_qty_applied, v_sync_seq,
    case when (v_res ->> 'deducted')::int = 2 and v_qty_on_hand = 18 and v_qty_applied = 2 and v_sync_seq = 1 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T1: re-sync O1 จำนวนเท่าเดิม (2) ⇒ delta 0 ⇒ ไม่มี ledger row เพิ่ม
  -----------------------------------------------------------------------
  select count(*) into v_ledger_count_before from public.stock_ledger where product_id = v_p_a;
  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ133-O1']);
  select count(*) into v_ledger_count_after from public.stock_ledger where product_id = v_p_a;
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_a;
  v_log := v_log || format('[T1] re-sync จำนวนเท่าเดิม: deducted=%s returned=%s (คาด 0/0), ledger ก่อน=%s หลัง=%s (คาดเท่ากัน), on_hand=%s (คาดยังคง 18): %s' || E'\n',
    v_res ->> 'deducted', v_res ->> 'returned', v_ledger_count_before, v_ledger_count_after, v_qty_on_hand,
    case when (v_res ->> 'deducted')::int = 0 and (v_res ->> 'returned')::int = 0 and v_ledger_count_before = v_ledger_count_after and v_qty_on_hand = 18 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T2: ลูกค้าสั่งเพิ่มบนใบเดิม 2→3 ⇒ ตัดเพิ่ม 1
  -----------------------------------------------------------------------
  update analytics.fact_order_item set qty = 3 where id = v_item1_id;
  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ133-O1']);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_a;
  select qty_applied, sync_seq into v_qty_applied, v_sync_seq from analytics.stock_sale_applied where shop_id = v_shop_id and source_order_no = 'ZZ133-O1' and product_id = v_p_a;
  v_log := v_log || format('[T2] สั่งเพิ่ม 2→3: deducted=%s (คาด 1), on_hand=%s (คาด 17), applied=%s seq=%s (คาด 3/2): %s' || E'\n',
    v_res ->> 'deducted', v_qty_on_hand, v_qty_applied, v_sync_seq,
    case when (v_res ->> 'deducted')::int = 1 and v_qty_on_hand = 17 and v_qty_applied = 3 and v_sync_seq = 2 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T3: ใบถูกลบ (physical delete เหมือน import_delete_orders 0115:253) ⇒
  -- target หายไปทั้งคู่ (fact_order + fact_order_item cascade) ⇒ target=0 ⇒
  -- คืนสต็อกอัตโนมัติ
  -----------------------------------------------------------------------
  delete from analytics.fact_order where id = v_o1_id and shop_id = v_shop_id;
  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ133-O1']);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_a;
  select qty_applied, sync_seq into v_qty_applied, v_sync_seq from analytics.stock_sale_applied where shop_id = v_shop_id and source_order_no = 'ZZ133-O1' and product_id = v_p_a;
  v_log := v_log || format('[T3] ใบถูกลบ: returned=%s (คาด 3), on_hand=%s (คาด 20 กลับที่เดิม), applied=%s seq=%s (คาด 0/3): %s' || E'\n',
    v_res ->> 'returned', v_qty_on_hand, v_qty_applied, v_sync_seq,
    case when (v_res ->> 'returned')::int = 3 and v_qty_on_hand = 20 and v_qty_applied = 0 and v_sync_seq = 3 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T4: กู้คืนใบ (insert กลับ id เดิม เหมือน import_restore_orders 0115:383
  -- ซึ่ง insert (v_fo).* จาก snapshot เดิม) ⇒ ตัดใหม่
  -----------------------------------------------------------------------
  insert into analytics.fact_order (id, shop_id, source_order_no, channel_id, order_date, revenue)
  values (v_o1_id, v_shop_id, 'ZZ133-O1', v_channel_id, (now() at time zone 'Asia/Bangkok')::date, 300);
  insert into analytics.fact_order_item (shop_id, fact_order_id, product_id, sku_snapshot, qty, unit_price)
  values (v_shop_id, v_o1_id, v_p_a, 'ZZ133-A', 3, 100);

  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ133-O1']);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_a;
  select qty_applied, sync_seq into v_qty_applied, v_sync_seq from analytics.stock_sale_applied where shop_id = v_shop_id and source_order_no = 'ZZ133-O1' and product_id = v_p_a;
  v_log := v_log || format('[T4] กู้คืนใบ: deducted=%s (คาด 3), on_hand=%s (คาด 17), applied=%s seq=%s (คาด 3/4): %s' || E'\n',
    v_res ->> 'deducted', v_qty_on_hand, v_qty_applied, v_sync_seq,
    case when (v_res ->> 'deducted')::int = 3 and v_qty_on_hand = 17 and v_qty_applied = 3 and v_sync_seq = 4 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T5: ออเดอร์ก่อน track_stock_since (O2, product B, 2026-01-01 << วันนี้)
  -- ⇒ ไม่เข้า target เลย ⇒ ไม่ตัด ไม่มีแถว stock_sale_applied ด้วยซ้ำ
  -----------------------------------------------------------------------
  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ133-O2']);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_b;
  select count(*) into v_row_count from analytics.stock_sale_applied where shop_id = v_shop_id and source_order_no = 'ZZ133-O2';
  v_log := v_log || format('[T5] ออเดอร์ก่อน since: deducted=%s returned=%s (คาด 0/0), on_hand=%s (คาดยังคง 10), stock_sale_applied แถว=%s (คาด 0): %s' || E'\n',
    v_res ->> 'deducted', v_res ->> 'returned', v_qty_on_hand, v_row_count,
    case when (v_res ->> 'deducted')::int = 0 and (v_res ->> 'returned')::int = 0 and v_qty_on_hand = 10 and v_row_count = 0 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T6: SKU track_stock=false (product C, ไม่เคยเปิดเลย) ⇒ ข้ามเงียบ ไม่มี
  -- central_stock ให้ด้วยซ้ำ (ไม่เคย ensure เพราะไม่เคยเข้า target)
  -----------------------------------------------------------------------
  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ133-O3']);
  select count(*) into v_row_count from public.central_stock where product_id = v_p_c;
  v_log := v_log || format('[T6] SKU track_stock=false: deducted=%s returned=%s failed=%s (คาดทั้งหมดว่าง/0), central_stock แถว=%s (คาด 0 — ไม่เคยถูกแตะ): %s' || E'\n',
    v_res ->> 'deducted', v_res ->> 'returned', jsonb_array_length(v_res -> 'failed'), v_row_count,
    case when (v_res ->> 'deducted')::int = 0 and (v_res ->> 'returned')::int = 0 and jsonb_array_length(v_res -> 'failed') = 0 and v_row_count = 0 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T7: สต็อกไม่พอ (product D มี 1, ออเดอร์ต้องการ 5) ⇒ เก็บ last_error +
  -- batch ไม่ล้ม (เรียกรวมกับ O1 ของ A ที่ควรสำเร็จตามปกติ) + qty_on_hand
  -- ไม่ติดลบ
  -----------------------------------------------------------------------
  update analytics.fact_order_item set qty = 3 where fact_order_id = v_o1_id and product_id = v_p_a; -- no-op เผื่อ state ไม่ตรง คงที่ target=3 เท่าเดิม
  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ133-O4', 'ZZ133-O1']);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_d;
  select qty_applied, last_error into v_qty_applied, v_last_error from analytics.stock_sale_applied where shop_id = v_shop_id and source_order_no = 'ZZ133-O4' and product_id = v_p_d;
  v_log := v_log || format('[T7a] สต็อกไม่พอ: on_hand D=%s (คาดยังคง 1 ไม่ติดลบ), applied D=%s (คาดยังคง 0), last_error=%s (คาดไม่ null): %s' || E'\n',
    v_qty_on_hand, v_qty_applied, coalesce(left(v_last_error, 40), '(null)'),
    case when v_qty_on_hand = 1 and v_qty_applied = 0 and v_last_error is not null then 'OK' else 'FAIL' end);
  v_log := v_log || format('[T7b] batch ไม่ล้ม (มี failed=1 แต่เรียกจบปกติ, failed array length=%s คาด 1): %s' || E'\n',
    jsonb_array_length(v_res -> 'failed'), case when jsonb_array_length(v_res -> 'failed') = 1 then 'OK' else 'FAIL' end);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_a;
  v_log := v_log || format('[T7c] คู่ที่สำเร็จในคำสั่งเดียวกัน (O1/A) ยังทำงานตามปกติ on_hand=%s (คาดยังคง 17 — target ไม่เปลี่ยนจาก T4 ก็ไม่มีอะไรให้ตัดเพิ่ม): %s' || E'\n',
    v_qty_on_hand, case when v_qty_on_hand = 17 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T10: stock_sync_sales(shop2, null) ทั้งร้านต้องไม่ล้มเมื่อไม่มี SKU ไหนเปิด
  -- เลย (shop2 มีแค่ product ที่ track_stock=false ค่า default)
  -----------------------------------------------------------------------
  v_caught := false;
  begin
    v_res := analytics.stock_sync_sales(v_shop2_id, null);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T10] shop ที่ไม่มี SKU เปิด track_stock เลย ไม่ raise (%s), deducted=%s returned=%s failed=%s (คาดทั้งหมด 0): %s' || E'\n',
    case when not v_caught then 'OK' else 'FAIL' end, v_res ->> 'deducted', v_res ->> 'returned', jsonb_array_length(v_res -> 'failed'),
    case when not v_caught and (v_res ->> 'deducted')::int = 0 and (v_res ->> 'returned')::int = 0 and jsonb_array_length(v_res -> 'failed') = 0 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T13 ([B], ตัดสินใจเอง): ปิด track_stock บน A (มีประวัติ applied=3 จาก T4)
  -- ⇒ ledger ไม่ถูกแตะ (ห้ามล้าง/ห้ามคืน) แม้เรียก stock_sync_sales(shop, null)
  -- ทั้งร้านซ้ำหลังปิดก็ตาม — ถ้าไม่กรอง track_stock ฝั่ง applied จะเห็นเป็น
  -- "target หาย" แล้วคืนสต็อก 3 หน่วยผิดๆ
  -----------------------------------------------------------------------
  v_res := analytics.product_track_stock_set(v_shop_id, v_p_a, false);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_a;
  v_log := v_log || format('[T13a] ปิด A: track_stock=%s (คาด false), on_hand ก่อนซิงค์=%s (คาด 17): %s' || E'\n',
    v_res ->> 'track_stock', v_qty_on_hand, case when (v_res ->> 'track_stock')::boolean = false and v_qty_on_hand = 17 then 'OK' else 'FAIL' end);

  select count(*) into v_ledger_count_before from public.stock_ledger where product_id = v_p_a;
  v_res := analytics.stock_sync_sales(v_shop_id, null); -- กวาดทั้งร้าน ไม่ระบุ order
  select count(*) into v_ledger_count_after from public.stock_ledger where product_id = v_p_a;
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_a;
  v_log := v_log || format('[T13b] sync ทั้งร้านหลังปิด A: ledger ก่อน=%s หลัง=%s (คาดเท่ากัน — ไม่ถูกแตะเลย), on_hand=%s (คาดยังคง 17 ไม่ถูกคืน): %s' || E'\n',
    v_ledger_count_before, v_ledger_count_after, v_qty_on_hand,
    case when v_ledger_count_before = v_ledger_count_after and v_qty_on_hand = 17 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T14 ([A], ตัดสินใจเอง): เปิดใหม่หลังปิด (since ไม่ขยับ — coalesce เดิม) +
  -- ใส่ยอดตั้งต้น > 0 ⇒ โดนด่านใหม่ของ Tech Lead (22023 ข้อความอ่านรู้เรื่อง)
  -- (เพราะ since เดิม) ⇒ adjust_stock ปฏิเสธด้วย 23505 (ไม่เงียบ ไม่ทับ) —
  -- นี่คือ "รอยต่อที่รู้ตัว" ที่ผมธงไว้ในหัวไฟล์ 0133 [A] ให้ Tech Lead ตัดสินใจ
  -- ก่อนต่อ UI จริง
  -----------------------------------------------------------------------
  v_caught := false; v_errmsg := null;
  begin
    perform analytics.product_track_stock_set(v_shop_id, v_p_a, true, 999);
  exception when others then
    v_caught := true;
    get stacked diagnostics v_errmsg = message_text;
  end;
  select track_stock into v_track_stock from public.product where id = v_p_a;
  v_log := v_log || format('[T14] เปิดใหม่หลังปิดด้วยยอดตั้งต้นต่างจากเดิม ⇒ raise (%s, msg=%s), track_stock ยังเป็น false (ไม่มี partial write หลุดออกมา, ได้ %s): %s' || E'\n',
    case when v_caught then 'OK' else 'FAIL' end, coalesce(left(v_errmsg, 60), '(none)'), v_track_stock,
    case when v_caught and v_track_stock = false then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T11 (เคสห้ามพัง): reserve_stock/commit_stock/adjust_stock เดิมต้อง
  -- ทำงานเหมือนเดิม — 0133 ไม่ replace ทั้ง 3 ตัวนี้เลย ยืนยันด้วย signature/
  -- grant ไม่เปลี่ยน + เรียก adjust_stock ตรงๆ อีกรอบ (นอกเหนือจากที่ใช้ทั่ว
  -- ทั้งสคริปต์นี้ผ่าน stock_sync_sales/product_track_stock_set อยู่แล้ว)
  -----------------------------------------------------------------------
  declare
    v_p_regress uuid;
    v_on_hand_1 int; v_on_hand_2 int;
  begin
    v_p_regress := analytics.product_upsert(v_shop_id, 'ZZ133-REGRESS', 'ทดสอบ adjust_stock เดิม', null, 'fixed', 50, null, null, null, null, null, null, null, true);
    insert into public.central_stock (product_id) values (v_p_regress);
    perform public.adjust_stock(v_shop_id, v_p_regress, 10, 'zz133-regress-1');
    select qty_on_hand into v_on_hand_1 from public.central_stock where product_id = v_p_regress;
    perform public.adjust_stock(v_shop_id, v_p_regress, -4, 'zz133-regress-2');
    select qty_on_hand into v_on_hand_2 from public.central_stock where product_id = v_p_regress;
    v_log := v_log || format('[T11a] adjust_stock +10 แล้ว -4 ยังทำงานปกติ: %s → %s (คาด 10 → 6): %s' || E'\n',
      v_on_hand_1, v_on_hand_2, case when v_on_hand_1 = 10 and v_on_hand_2 = 6 then 'OK' else 'FAIL' end);
  end;

  declare
    v_sigs text[] := array['reserve_stock(uuid,uuid,text,jsonb)', 'commit_stock(uuid,uuid,text,jsonb)', 'release_stock(uuid,uuid,text,jsonb)', 'adjust_stock(uuid,uuid,integer,text)'];
    v_sig text; v_all_ok boolean := true; v_bad text := '';
  begin
    foreach v_sig in array v_sigs loop
      select count(*) into v_fn_count from pg_proc where pronamespace = 'public'::regnamespace and proname = split_part(v_sig, '(', 1);
      if v_fn_count <> 1 then
        v_all_ok := false;
        v_bad := v_bad || format('%s overload_count=%s (คาด 1) ', v_sig, v_fn_count);
      end if;
    end loop;
    v_log := v_log || format('[T11b] reserve_stock/commit_stock/release_stock/adjust_stock ไม่มี overload ใหม่ (0133 ไม่ได้ touch เลย): %s' || E'\n',
      case when v_all_ok then 'OK' else 'FAIL: ' || v_bad end);
  end;

  -----------------------------------------------------------------------
  -- T16: grant metadata ของ 2 ฟังก์ชันใหม่ — anon=false, authenticated=false,
  -- service_role=true, ไม่มี overload ค้าง
  -----------------------------------------------------------------------
  declare
    v_fn_sigs text[] := array[
      'product_track_stock_set(uuid,uuid,boolean,integer)',
      'stock_sync_sales(uuid,text[])'
    ];
    v_sig text; v_all_ok boolean := true; v_bad text := '';
  begin
    foreach v_sig in array v_fn_sigs loop
      select has_function_privilege('anon', 'analytics.' || v_sig, 'execute') into v_priv_anon;
      select has_function_privilege('authenticated', 'analytics.' || v_sig, 'execute') into v_priv_auth;
      select has_function_privilege('service_role', 'analytics.' || v_sig, 'execute') into v_priv_svc;

      if v_priv_anon is distinct from false or v_priv_auth is distinct from false or v_priv_svc is distinct from true then
        v_all_ok := false;
        v_bad := v_bad || format('%s(anon=%s,auth=%s,svc=%s) ', v_sig, v_priv_anon, v_priv_auth, v_priv_svc);
      end if;

      select count(*) into v_fn_count from pg_proc
        where pronamespace = 'analytics'::regnamespace and proname = split_part(v_sig, '(', 1);
      if v_fn_count <> 1 then
        v_all_ok := false;
        v_bad := v_bad || format('%s overload_count=%s (คาด 1) ', v_sig, v_fn_count);
      end if;
    end loop;

    if v_all_ok then
      v_log := v_log || '[T16] product_track_stock_set/stock_sync_sales: anon=false, authenticated=false, service_role=true, ไม่มี overload ค้าง: OK' || E'\n';
    else
      v_log := v_log || format('[T16] FAIL: %s' || E'\n', v_bad);
    end if;
  end;

  -----------------------------------------------------------------------
  -- T17: RLS ของ analytics.stock_sale_applied — authenticated/anon เข้าไม่ได้
  -- เลย เข้าได้ทาง service_role เท่านั้น
  -----------------------------------------------------------------------
  declare
    v_sel_anon boolean; v_sel_auth boolean; v_sel_svc boolean;
  begin
    select has_table_privilege('anon', 'analytics.stock_sale_applied', 'select') into v_sel_anon;
    select has_table_privilege('authenticated', 'analytics.stock_sale_applied', 'select') into v_sel_auth;
    select has_table_privilege('service_role', 'analytics.stock_sale_applied', 'select') into v_sel_svc;
    v_log := v_log || format('[T17] stock_sale_applied privilege: anon select=%s (คาด false), authenticated select=%s (คาด false), service_role select=%s (คาด true): %s' || E'\n',
      v_sel_anon, v_sel_auth, v_sel_svc,
      case when coalesce(v_sel_anon, false) = false and coalesce(v_sel_auth, false) = false and v_sel_svc = true then 'OK' else 'FAIL' end);
  end;

  -----------------------------------------------------------------------
  -- T18: product.reorder_point check constraint (0-100000, null ได้)
  -----------------------------------------------------------------------
  v_caught := false;
  begin
    update public.product set reorder_point = -1 where id = v_p_a;
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T18a] reorder_point=-1 ถูกปฏิเสธ: %s' || E'\n', case when v_caught then 'OK' else 'FAIL' end);

  update public.product set reorder_point = 3 where id = v_p_a;
  select reorder_point into v_row_count from public.product where id = v_p_a;
  v_log := v_log || format('[T18b] reorder_point=3 บันทึกได้ปกติ (ได้ %s): %s' || E'\n', v_row_count, case when v_row_count = 3 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T19 (Tech Lead 18 ก.ย. 69): last_error ค้างต้องถูกล้างเมื่อ delta กลับเป็น 0
  -- (O4/D ค้าง error จาก T7 — ลบใบทิ้ง ⇒ target 0, applied 0 ⇒ delta 0)
  -- ถ้าไม่ล้าง หน้าจอจะโชว์ "สต็อกไม่พอ" ค้างถาวรทั้งที่ไม่เหลือปัญหาแล้ว
  -----------------------------------------------------------------------
  delete from analytics.fact_order where id = v_o4_id and shop_id = v_shop_id;
  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ133-O4']);
  select last_error into v_last_error from analytics.stock_sale_applied
    where shop_id = v_shop_id and source_order_no = 'ZZ133-O4' and product_id = v_p_d;
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_d;
  v_log := v_log || format('[T19] ลบใบที่เคยพลาด ⇒ delta=0: last_error=%s (คาด null), on_hand D=%s (คาดยังคง 1), returned=%s (คาด 0): %s' || E'
',
    coalesce(v_last_error, '(null)'), v_qty_on_hand, v_res ->> 'returned',
    case when v_last_error is null and v_qty_on_hand = 1 and (v_res ->> 'returned')::int = 0 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- สรุปเคสที่ครอบ (ตามบรีฟ + decision เพิ่มเอง — ดูหัวไฟล์ 0133 ด้วย):
  --   T1 (re-sync เท่าเดิม idempotent) T2 (สั่งเพิ่ม 2→3) T3 (ลบใบ→คืนสต็อก)
  --   T4 (กู้คืนใบ→ตัดใหม่) T5 (ก่อน since ไม่ตัด) T6 (track_stock=false ข้าม
  --   เงียบ) T7 (สต็อกไม่พอ→last_error+batch ไม่ล้ม+ไม่ติดลบ) T8 (live-SKU
  --   raise ทั้งเปิด/ปิด) T9 (เปิด+ยอดตั้งต้น→ledger init:) T10 (ร้านไม่มี SKU
  --   เปิดเลยไม่ล้ม) T11 (reserve/commit/release/adjust_stock เดิมไม่พัง)
  --   T12 (เปิดซ้ำ idempotent — decision [A] ส่วนหนึ่ง) T13 (ปิดแล้ว ledger
  --   แข็งไม่ถูกคืนสต็อกผิด — decision [B]) T14 (เปิดใหม่หลังปิดด้วยยอดต่าง
  --   ⇒ raise ไม่เงียบ — decision [A] อีกส่วน) T15 (initial_qty=0 ไม่ raise —
  --   decision [C]) T16 (grant) T17 (RLS) T18 (reorder_point check)
  --   ไม่ได้ครอบ: หน้า UI/action (ไม่มีในรอบนี้ — SQL อย่างเดียวตามขอบเขต)
  -----------------------------------------------------------------------

  v_log := v_log || E'\n=== ALL CHECKS LOGGED ABOVE — ตรวจทุกบรรทัดหา FAIL (transaction จะ rollback เสมอ) ===\n';
  raise exception '%', v_log;
end $$;

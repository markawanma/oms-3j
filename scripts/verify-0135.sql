-- scripts/verify-0135.sql
--
-- Self-contained verify script for supabase/migrations/0135_stock_sync_sales_
-- hardening.sql (H1 set-semantics · M1 live guard both directions · M2 narrow
-- exception filter · M3 friendly last_error/last_error_code + sku in failed[]
-- · M5 anti-join for deleted orders · F6 deterministic order by · advisory
-- lock added to transform_pending_order_lines).
--
-- Per skill 3j-migration-traps #11: ทุกอย่างรันใน do $$ ... $$ block เดียว จบด้วย
-- `raise exception` เสมอ ⇒ ทั้ง transaction rollback ไม่ว่าผลจะผ่าน/ไม่ผ่าน —
-- อ่านผลจาก error message นี้ ใช้เป็นทั้ง dry-run (ก่อน apply 0135 จริง) และ
-- post-apply verify (รันซ้ำหลัง apply ผ่าน MCP apply_migration)
--
-- ⚠️ แตะ stock ledger จริง (💰) — ทดสอบด้วย shop/product/order สังเคราะห์ที่สร้าง
-- ขึ้นในทรานแซคชันนี้เองทั้งหมด ไม่แตะ shop/SKU/order จริงเลย หลังรันแล้วต้องตรวจ
-- ซ้ำว่า state ไม่ขยับจริง (นับแถว/ค่าตัวนับ เทียบก่อน-หลัง)
--
-- ⚠️ ข้อจำกัดที่รู้ตัว (บอกตรงๆ ตามกติกาทีม): เคส "error ที่ไม่ใช่ P0001/23505/
-- 23514 ทำให้ทั้ง call ล้ม" (M2) หาวิธีจำลองแบบไดนามิกที่ปลอดภัย/deterministic
-- ภายใน do-block เดียวไม่ได้จริง — ลองแล้ว 3 ทาง: (1) revoke execute จาก role
-- ที่ตัวมันเองเป็น owner ไม่ได้ผล เพราะเจ้าของฟังก์ชันมีสิทธิ์ execute โดยปริยาย
-- เสมอไม่ว่า revoke ยังไง (2) ทำให้ integer overflow (P0001 เดิมของ adjust_stock
-- เกือบทุกจุดใน 0007 ก็ default เป็น P0001 อยู่แล้วจาก plpgsql เอง ไม่ใช่ตัวแทนที่ดี
-- สำหรับ sqlstate อื่น) ไปไม่ถึงเพราะ target_qty/qty_applied ถูก constraint ผลักให้
-- อยู่ในช่วงที่ไม่ overflow ได้จริงจากข้อมูลที่ query โครงสร้างนี้จะสร้างได้ (3)
-- statement_timeout สั้นๆ ไม่ deterministic (ขึ้นกับความเร็วเครื่อง) ⇒ แทนด้วย
-- static check ของนิยามฟังก์ชันจริงหลัง apply (M2-static ด้านล่าง) ว่ามี filter
-- list + bare re-raise อยู่จริง ไม่ใช่ dynamic proof เต็มรูป — ถ้า Tech Lead
-- อยากได้ runtime proof แน่นกว่านี้ ต้องทดสอบบน staging ที่จำลอง permission/
-- deadlock/timeout จริงจากอีก session ได้

do $$
declare
  v_log text := E'\n=== verify 0135 (stock_sync_sales hardening) ===\n';

  v_shop_id    uuid := gen_random_uuid();
  v_channel_id uuid;

  v_p_a       uuid; -- flow ปกติเต็ม T1-T4 + T13 (ปิดแล้ว freeze)
  v_p_b       uuid; -- T5: ออเดอร์ก่อน since
  v_p_c       uuid; -- T6: track_stock=false ตลอด
  v_p_d       uuid; -- T7/T19: สต็อกไม่พอ + ล้าง last_error ทีหลัง
  v_p_h1a     uuid; -- H1a: มีของอยู่แล้ว 15 เปิดนับ target=15 ต้องไม่บวกทับเป็น 30
  v_p_h1b     uuid; -- H1b: เปิด target 20 -> retarget 12 -> idempotent resend 12
  v_p_reopen  uuid; -- ปิด -> เปิดใหม่ด้วยยอดต่างจากเดิม -> ต้องไม่ raise
  v_p_live    uuid; -- live SKU: เปิดถูกบล็อก, ปิด (หลัง bypass) ต้องผ่านเสมอ
  v_p_live2   uuid; -- live SKU ที่ track_stock=true จาก bypass -> sync ต้องไม่แตะ
  v_p_m5      uuid; -- M5: ใบถูกลบต้องคืนสต็อกแม้ caller ไม่ได้ขอเลขใบนั้น
  v_p_pad     uuid; -- ออเดอร์ปะข้าง (unrelated) ให้ p_source_order_nos มีของจริง

  v_o1_id     uuid := gen_random_uuid();

  v_res         jsonb;
  v_qty_on_hand int;
  v_qty_applied int;
  v_sync_seq    int;
  v_last_error  text;
  v_last_error_code text;
  v_ledger_count_before int;
  v_ledger_count_after  int;
  v_ledger_count_h1b    int;
  v_track_stock boolean;
  v_track_stock_since  date;
  v_track_stock_since2 date;
  v_row_count int;

  v_priv_anon boolean;
  v_priv_auth boolean;
  v_priv_svc  boolean;
  v_fn_count  int;

  v_caught boolean;
  v_errmsg text;
  v_fndef  text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -----------------------------------------------------------------------
  -- Part 0: setup — shop สังเคราะห์ + channel จริง (seed 0010) + SKU ทดสอบ
  -----------------------------------------------------------------------
  insert into public.shop (id, name) values (v_shop_id, 'ZZ TEST verify-0135');

  select id into v_channel_id from analytics.dim_channel where code = 'tiktok';
  if v_channel_id is null then
    raise exception 'verify-0135 setup: analytics.dim_channel ไม่มีแถว tiktok (seed จาก 0010 ควรมีอยู่แล้ว)';
  end if;

  v_p_a      := analytics.product_upsert(v_shop_id, 'ZZ135-A',      'ทดสอบ flow ปกติ + ปิด freeze', null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_b      := analytics.product_upsert(v_shop_id, 'ZZ135-B',      'ทดสอบก่อน since',              null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_c      := analytics.product_upsert(v_shop_id, 'ZZ135-C',      'ทดสอบ track_stock=false',       null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_d      := analytics.product_upsert(v_shop_id, 'ZZ135-D',      'ทดสอบสต็อกไม่พอ',               null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_h1a    := analytics.product_upsert(v_shop_id, 'ZZ135-H1A',    'ทดสอบ H1 มีของอยู่แล้ว',         null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_h1b    := analytics.product_upsert(v_shop_id, 'ZZ135-H1B',    'ทดสอบ H1 retarget',             null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_reopen := analytics.product_upsert(v_shop_id, 'ZZ135-REOPEN', 'ทดสอบปิด-เปิดใหม่คนละยอด',       null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_live   := analytics.product_upsert(v_shop_id, 'LiveS20',      'ทดสอบ live SKU เปิด/ปิด',        null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_live2  := analytics.product_upsert(v_shop_id, 'LiveS21',      'ทดสอบ live SKU bypass',         null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_m5     := analytics.product_upsert(v_shop_id, 'ZZ135-M5',     'ทดสอบใบถูกลบคืนสต็อกเสมอ',       null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_pad    := analytics.product_upsert(v_shop_id, 'ZZ135-PAD',    'ออเดอร์ปะข้างให้ array มีของจริง', null, 'fixed', 100, null, null, null, null, null, null, null, true);

  v_log := v_log || '[Part 0] setup shop+products: OK' || E'\n';

  -----------------------------------------------------------------------
  -- H1a: มีของอยู่แล้ว 15 ชิ้น (จำลองของที่เข้ามาทางอื่น เช่น production_
  -- order_done) เปิดนับด้วย target=15 (ยอดที่นับได้จริงตอนนี้) ⇒ ต้องยังเป็น 15
  -- ไม่ใช่ 30 (H1 หัวใจของบั๊กเดิม) และไม่มี ledger row ใหม่เลย (delta=0 ⇒ ข้าม
  -- adjust_stock ไปเลย ไม่ใช่แค่ข้าม "init:" prefix แต่ข้ามทั้งการเรียก)
  -----------------------------------------------------------------------
  insert into public.central_stock (product_id, qty_on_hand) values (v_p_h1a, 15);
  v_res := analytics.product_track_stock_set(v_shop_id, v_p_h1a, true, 15);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_h1a;
  select count(*) into v_row_count from public.stock_ledger where product_id = v_p_h1a;
  v_log := v_log || format('[H1a] มีของ 15 เปิดนับ target=15: on_hand=%s (คาด 15 — ไม่บวกทับเป็น 30), ledger แถว=%s (คาด 0), delta_applied=%s (คาด 0): %s' || E'\n',
    v_qty_on_hand, v_row_count, v_res ->> 'delta_applied',
    case when v_qty_on_hand = 15 and v_row_count = 0 and (v_res ->> 'delta_applied')::int = 0 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- H1b: เปิดนับ SKU ใหม่ (on_hand เริ่ม 0) ด้วย target=20 ⇒ ต้องบวก +20 จริง
  -- (fresh open ยังต้องทำงานเหมือนเดิม ไม่ใช่ว่า set-semantics แล้วจะเปิดของใหม่
  -- ไม่ได้) แล้ว retarget เป็น 12 (นับใหม่ได้น้อยลง) ⇒ ต้องลดลงจริงผ่าน
  -- adjust_stock (ไม่ใช่แค่เขียนทับตัวเลขเงียบๆ — ledger ต้องมีหลักฐาน) แล้ว
  -- ส่งยอดเดิม (12) ซ้ำอีกครั้ง ⇒ ต้อง idempotent (delta=0, ไม่มี ledger เพิ่ม)
  -----------------------------------------------------------------------
  v_res := analytics.product_track_stock_set(v_shop_id, v_p_h1b, true, 20);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_h1b;
  select count(*) into v_ledger_count_before from public.stock_ledger where product_id = v_p_h1b;
  v_log := v_log || format('[H1b-open] เปิดใหม่ target=20: on_hand=%s (คาด 20), ledger แถว=%s (คาด 1), delta_applied=%s (คาด 20): %s' || E'\n',
    v_qty_on_hand, v_ledger_count_before, v_res ->> 'delta_applied',
    case when v_qty_on_hand = 20 and v_ledger_count_before = 1 and (v_res ->> 'delta_applied')::int = 20 then 'OK' else 'FAIL' end);

  v_res := analytics.product_track_stock_set(v_shop_id, v_p_h1b, true, 12);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_h1b;
  select count(*) into v_ledger_count_h1b from public.stock_ledger where product_id = v_p_h1b;
  v_log := v_log || format('[H1b-retarget] retarget เป็น 12: on_hand=%s (คาด 12 — ลดลงจริง ไม่ใช่บวกทับ), ledger แถว=%s (คาด 2 — มีหลักฐานการปรับ), delta_applied=%s (คาด -8): %s' || E'\n',
    v_qty_on_hand, v_ledger_count_h1b, v_res ->> 'delta_applied',
    case when v_qty_on_hand = 12 and v_ledger_count_h1b = 2 and (v_res ->> 'delta_applied')::int = -8 then 'OK' else 'FAIL' end);

  v_res := analytics.product_track_stock_set(v_shop_id, v_p_h1b, true, 12);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_h1b;
  select count(*) into v_row_count from public.stock_ledger where product_id = v_p_h1b;
  v_log := v_log || format('[H1b-idempotent] ส่งยอดเดิม (12) ซ้ำ: on_hand=%s (คาดยังคง 12), ledger แถว=%s (คาดยังคง %s — ไม่เพิ่ม), delta_applied=%s (คาด 0): %s' || E'\n',
    v_qty_on_hand, v_row_count, v_ledger_count_h1b, v_res ->> 'delta_applied',
    case when v_qty_on_hand = 12 and v_row_count = v_ledger_count_h1b and (v_res ->> 'delta_applied')::int = 0 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- 🔴 NULL≠0 (Tech Lead 18 ก.ย. 69): ไม่ส่ง p_initial_qty มา (null) ต้องแปลว่า
  -- "เปิดธงอย่างเดียว ไม่แตะยอดสต็อก" ไม่ใช่ "ตั้งเป็น 0"
  -- ถ้า default ยังเป็น 0 เหมือน 0133 พอ H1 เปลี่ยนเป็น set-semantics แล้ว
  -- ปุ่มสวิตช์เปิด/ปิดธรรมดา (ที่ UI รอบหน้าจะทำ) จะล้างสต็อกที่มีอยู่ทิ้งเงียบๆ
  -----------------------------------------------------------------------
  v_res := analytics.product_track_stock_set(v_shop_id, v_p_h1a, true);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_h1a;
  select count(*) into v_row_count from public.stock_ledger where product_id = v_p_h1a;
  v_log := v_log || format('[NULL-a] เปิดนับโดยไม่ส่งยอด: on_hand=%s (คาดยังคง 15 — ห้ามถูกล้างเป็น 0), ledger แถว=%s (คาด 0), delta_applied=%s (คาด 0), qty_target=%s (คาด null): %s' || E'
',
    v_qty_on_hand, v_row_count, v_res ->> 'delta_applied', coalesce(v_res ->> 'qty_target', 'null'),
    case when v_qty_on_hand = 15 and v_row_count = 0 and (v_res ->> 'delta_applied')::int = 0 and (v_res ->> 'qty_target') is null then 'OK' else 'FAIL' end);

  v_res := analytics.product_track_stock_set(v_shop_id, v_p_h1a, true, 0);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_h1a;
  select count(*) into v_row_count from public.stock_ledger where product_id = v_p_h1a;
  v_log := v_log || format('[NULL-b] ส่ง 0 มาตรงๆ (เจตนาชัดว่าของหมด): on_hand=%s (คาด 0), ledger แถว=%s (คาด 1 — มีหลักฐาน), delta_applied=%s (คาด -15): %s' || E'
',
    v_qty_on_hand, v_row_count, v_res ->> 'delta_applied',
    case when v_qty_on_hand = 0 and v_row_count = 1 and (v_res ->> 'delta_applied')::int = -15 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- H1-reserved: ตั้งเป้าต่ำกว่ายอดที่ถูกจองไว้ (reserve_stock) ⇒ adjust_stock
  -- raise P0001 ("would go negative or below reserved balance") ต้องถูกแปลง
  -- เป็น errcode 22023 + ข้อความอ่านรู้เรื่อง ไม่ใช่ raw Postgres message
  -- (0135 H1 — ระบุไว้ตรงในบรีฟ แม้ไม่ได้อยู่ในลิสต์เคสบังคับท้ายบรีฟ)
  -----------------------------------------------------------------------
  declare
    v_p_reserved uuid;
    v_errcode    text;
  begin
    v_p_reserved := analytics.product_upsert(v_shop_id, 'ZZ135-RESERVED', 'ทดสอบตั้งเป้าต่ำกว่ายอดจอง', null, 'fixed', 100, null, null, null, null, null, null, null, true);
    perform analytics.product_track_stock_set(v_shop_id, v_p_reserved, true, 10);
    -- แก้ 18 ก.ย. (Tech Lead, dry-run จับ): reserve_stock มี FK ไปที่ public.orders
    -- ⇒ เรียกด้วย order_id ลอยๆ จะตก 23503 ก่อนถึงด่านที่ตั้งใจทดสอบ
    -- ด่านที่จะทดสอบคือ adjust_stock ห้ามตั้ง on_hand ต่ำกว่า qty_reserved
    -- ⇒ ตั้ง qty_reserved ตรงๆ ได้ผลเท่ากัน โดยไม่ต้องมีใบสั่งซื้อจริง
    update public.central_stock set qty_reserved = 6 where product_id = v_p_reserved;

    v_caught := false; v_errmsg := null; v_errcode := null;
    begin
      perform analytics.product_track_stock_set(v_shop_id, v_p_reserved, true, 3);
    exception when others then
      v_caught := true;
      get stacked diagnostics v_errmsg = message_text, v_errcode = returned_sqlstate;
    end;
    v_log := v_log || format('[H1-reserved] ตั้งเป้า 3 ต่ำกว่ายอดจอง 6: raise=%s errcode=%s (คาด 22023), msg สำหรับคนอ่าน ไม่มีคำว่า adjust_stock (msg=%s): %s' || E'\n',
      v_caught, coalesce(v_errcode, '(none)'), coalesce(left(v_errmsg, 90), '(none)'),
      case when v_caught and v_errcode = '22023' and v_errmsg not like '%adjust_stock%' then 'OK' else 'FAIL' end);
  end;

  -----------------------------------------------------------------------
  -- REOPEN: เปิดใหม่ target=10 -> ปิด -> เปิดใหม่อีกครั้งด้วยยอดต่างจากเดิม (25)
  -- ⇒ ของเดิม (ด่าน 23505-กันเปิดซ้ำ) จะ raise ตรงนี้ — 0135 ต้องไม่ raise แล้ว
  -- ต้องตั้งเป็น 25 จริง (ไม่ใช่ 10+25=35) และ track_stock_since ต้องไม่เลื่อน
  -----------------------------------------------------------------------
  v_res := analytics.product_track_stock_set(v_shop_id, v_p_reopen, true, 10);
  select track_stock_since into v_track_stock_since from public.product where id = v_p_reopen;

  perform analytics.product_track_stock_set(v_shop_id, v_p_reopen, false);
  select track_stock into v_track_stock from public.product where id = v_p_reopen;
  v_log := v_log || format('[REOPEN-close] ปิดหลังเปิด target=10: track_stock=%s (คาด false), on_hand ยังอยู่ที่ 10 (ปิดไม่ล้าง ledger): %s' || E'\n',
    v_track_stock, case when v_track_stock = false then 'OK' else 'FAIL' end);

  v_caught := false;
  begin
    v_res := analytics.product_track_stock_set(v_shop_id, v_p_reopen, true, 25);
  exception when others then v_caught := true;
  end;
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_reopen;
  select track_stock, track_stock_since into v_track_stock, v_track_stock_since2 from public.product where id = v_p_reopen;
  v_log := v_log || format('[REOPEN-reopen] เปิดใหม่ target=25 (ยอดต่างจากเดิม): raise=%s (คาด false — ต้องไม่ raise แล้ว), on_hand=%s (คาด 25 — ไม่ใช่ 35), track_stock=%s, since ไม่เลื่อน (%s = %s): %s' || E'\n',
    v_caught, v_qty_on_hand, v_track_stock, v_track_stock_since, v_track_stock_since2,
    case when not v_caught and v_qty_on_hand = 25 and v_track_stock and v_track_stock_since = v_track_stock_since2 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- LIVE: เปิดยังต้องถูกบล็อกเหมือนเดิม (M1 ไม่ได้ปลดล็อกฝั่งเปิด)
  -----------------------------------------------------------------------
  v_caught := false;
  begin
    perform analytics.product_track_stock_set(v_shop_id, v_p_live, true, 5);
  exception when others then v_caught := true;
  end;
  select track_stock into v_track_stock from public.product where id = v_p_live;
  v_log := v_log || format('[LIVE-open-blocked] เปิด live SKU raise=%s (คาด true), track_stock ยังเป็น false: %s' || E'\n',
    v_caught, case when v_caught and v_track_stock = false then 'OK' else 'FAIL' end);

  -- จำลอง "เปิดพลาดมาจากทางอื่น" (SQL ตรง/บั๊กเก่า) — bypass RPC ทั้งหมด
  update public.product set track_stock = true, track_stock_since = (now() at time zone 'Asia/Bangkok')::date where id = v_p_live;
  insert into public.central_stock (product_id, qty_on_hand) values (v_p_live, 3);

  v_caught := false;
  begin
    v_res := analytics.product_track_stock_set(v_shop_id, v_p_live, false);
  exception when others then v_caught := true;
  end;
  select track_stock into v_track_stock from public.product where id = v_p_live;
  v_log := v_log || format('[LIVE-close-always] ปิด live SKU ที่หลุดมาแบบ track_stock=true ต้องปิดได้เสมอ (0135 M1ข): raise=%s (คาด false), track_stock=%s (คาด false): %s' || E'\n',
    v_caught, v_track_stock, case when not v_caught and v_track_stock = false then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- LIVE2: bypass ให้ track_stock=true ค้างอยู่ (จำลองว่ายังไม่มีใครปิด) พร้อม
  -- ประวัติ stock_sale_applied เดิม + ออเดอร์ใหม่ ⇒ stock_sync_sales ต้อง "ไม่
  -- แตะเลย" ทั้งสองทิศทาง (0135 M1ก, defense-in-depth ฝั่ง sync เอง)
  -----------------------------------------------------------------------
  update public.product set track_stock = true, track_stock_since = '2026-01-01'::date where id = v_p_live2;
  insert into public.central_stock (product_id, qty_on_hand) values (v_p_live2, 5);
  insert into analytics.stock_sale_applied (shop_id, source_order_no, product_id, qty_applied, sync_seq)
    values (v_shop_id, 'ZZ135-LIVE-OLD', v_p_live2, 3, 1);

  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
    values (v_shop_id, 'ZZ135-LIVE-O1', v_channel_id, (now() at time zone 'Asia/Bangkok')::date, 100);
  insert into analytics.fact_order_item (shop_id, fact_order_id, product_id, sku_snapshot, qty, unit_price)
    select v_shop_id, fo.id, v_p_live2, 'LiveS21', 2, 100 from analytics.fact_order fo where fo.shop_id = v_shop_id and fo.source_order_no = 'ZZ135-LIVE-O1';

  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ135-LIVE-OLD', 'ZZ135-LIVE-O1']);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_live2;
  select qty_applied, sync_seq into v_qty_applied, v_sync_seq from analytics.stock_sale_applied where shop_id = v_shop_id and source_order_no = 'ZZ135-LIVE-OLD' and product_id = v_p_live2;
  select count(*) into v_row_count from analytics.stock_sale_applied where shop_id = v_shop_id and source_order_no = 'ZZ135-LIVE-O1';
  v_log := v_log || format('[LIVE2-sync-ignored] sync บน live SKU ที่ track_stock=true จาก bypass: deducted=%s returned=%s (คาด 0/0), on_hand=%s (คาดยังคง 5 — ไม่แตะทั้งสองทาง), applied เดิม qty=%s seq=%s (คาดยังคง 3/1 ไม่ถูกคืน), applied ใหม่แถว=%s (คาด 0 — ไม่ถูกสร้าง): %s' || E'\n',
    v_res ->> 'deducted', v_res ->> 'returned', v_qty_on_hand, v_qty_applied, v_sync_seq, v_row_count,
    case when (v_res ->> 'deducted')::int = 0 and (v_res ->> 'returned')::int = 0 and v_qty_on_hand = 5
      and v_qty_applied = 3 and v_sync_seq = 1 and v_row_count = 0 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- FLOW (v_p_a): เปิด target 20 -> T1 (resync เท่าเดิม) -> T2 (สั่งเพิ่ม 2→3)
  -- -> T3 (ลบใบคืนสต็อก) -> T4 (กู้คืนใบตัดใหม่) -> T13 (ปิดแล้ว sync ไม่แตะ)
  -----------------------------------------------------------------------
  v_res := analytics.product_track_stock_set(v_shop_id, v_p_a, true, 20);

  insert into analytics.fact_order (id, shop_id, source_order_no, channel_id, order_date, revenue)
    values (v_o1_id, v_shop_id, 'ZZ135-O1', v_channel_id, (now() at time zone 'Asia/Bangkok')::date, 200);
  insert into analytics.fact_order_item (shop_id, fact_order_id, product_id, sku_snapshot, qty, unit_price)
    values (v_shop_id, v_o1_id, v_p_a, 'ZZ135-A', 2, 100);

  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ135-O1']);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_a;
  v_log := v_log || format('[FLOW-open] เปิด A target=20 แล้วขาย 2: deducted=%s (คาด 2), on_hand=%s (คาด 18): %s' || E'\n',
    v_res ->> 'deducted', v_qty_on_hand, case when (v_res ->> 'deducted')::int = 2 and v_qty_on_hand = 18 then 'OK' else 'FAIL' end);

  select count(*) into v_ledger_count_before from public.stock_ledger where product_id = v_p_a;
  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ135-O1']);
  select count(*) into v_ledger_count_after from public.stock_ledger where product_id = v_p_a;
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_a;
  v_log := v_log || format('[T1] re-sync จำนวนเท่าเดิม: deducted=%s returned=%s (คาด 0/0), ledger ก่อน=%s หลัง=%s (คาดเท่ากัน), on_hand=%s (คาดยังคง 18): %s' || E'\n',
    v_res ->> 'deducted', v_res ->> 'returned', v_ledger_count_before, v_ledger_count_after, v_qty_on_hand,
    case when (v_res ->> 'deducted')::int = 0 and (v_res ->> 'returned')::int = 0 and v_ledger_count_before = v_ledger_count_after and v_qty_on_hand = 18 then 'OK' else 'FAIL' end);

  update analytics.fact_order_item set qty = 3 where fact_order_id = v_o1_id and product_id = v_p_a;
  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ135-O1']);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_a;
  v_log := v_log || format('[T2] สั่งเพิ่ม 2→3: deducted=%s (คาด 1), on_hand=%s (คาด 17): %s' || E'\n',
    v_res ->> 'deducted', v_qty_on_hand, case when (v_res ->> 'deducted')::int = 1 and v_qty_on_hand = 17 then 'OK' else 'FAIL' end);

  delete from analytics.fact_order where id = v_o1_id and shop_id = v_shop_id;
  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ135-O1']);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_a;
  v_log := v_log || format('[T3] ใบถูกลบ: returned=%s (คาด 3), on_hand=%s (คาด 20 กลับที่เดิม): %s' || E'\n',
    v_res ->> 'returned', v_qty_on_hand, case when (v_res ->> 'returned')::int = 3 and v_qty_on_hand = 20 then 'OK' else 'FAIL' end);

  insert into analytics.fact_order (id, shop_id, source_order_no, channel_id, order_date, revenue)
    values (v_o1_id, v_shop_id, 'ZZ135-O1', v_channel_id, (now() at time zone 'Asia/Bangkok')::date, 300);
  insert into analytics.fact_order_item (shop_id, fact_order_id, product_id, sku_snapshot, qty, unit_price)
    values (v_shop_id, v_o1_id, v_p_a, 'ZZ135-A', 3, 100);

  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ135-O1']);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_a;
  v_log := v_log || format('[T4] กู้คืนใบ: deducted=%s (คาด 3), on_hand=%s (คาด 17): %s' || E'\n',
    v_res ->> 'deducted', v_qty_on_hand, case when (v_res ->> 'deducted')::int = 3 and v_qty_on_hand = 17 then 'OK' else 'FAIL' end);

  perform analytics.product_track_stock_set(v_shop_id, v_p_a, false);
  select count(*) into v_ledger_count_before from public.stock_ledger where product_id = v_p_a;
  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ135-O1']);
  select count(*) into v_ledger_count_after from public.stock_ledger where product_id = v_p_a;
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_a;
  v_log := v_log || format('[T13] ปิดนับแล้ว sync ไม่แตะ: ledger ก่อน=%s หลัง=%s (คาดเท่ากัน), on_hand=%s (คาดยังคง 17 ไม่ถูกคืน): %s' || E'\n',
    v_ledger_count_before, v_ledger_count_after, v_qty_on_hand,
    case when v_ledger_count_before = v_ledger_count_after and v_qty_on_hand = 17 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T5: ออเดอร์ก่อน track_stock_since (product B) ⇒ ไม่เข้า target เลย
  -----------------------------------------------------------------------
  v_res := analytics.product_track_stock_set(v_shop_id, v_p_b, true, 10);
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
    values (v_shop_id, 'ZZ135-O2', v_channel_id, '2026-01-01', 400);
  insert into analytics.fact_order_item (shop_id, fact_order_id, product_id, sku_snapshot, qty, unit_price)
    select v_shop_id, fo.id, v_p_b, 'ZZ135-B', 4, 100 from analytics.fact_order fo where fo.shop_id = v_shop_id and fo.source_order_no = 'ZZ135-O2';

  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ135-O2']);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_b;
  select count(*) into v_row_count from analytics.stock_sale_applied where shop_id = v_shop_id and source_order_no = 'ZZ135-O2';
  v_log := v_log || format('[T5] ออเดอร์ก่อน since: deducted=%s returned=%s (คาด 0/0), on_hand=%s (คาดยังคง 10), stock_sale_applied แถว=%s (คาด 0): %s' || E'\n',
    v_res ->> 'deducted', v_res ->> 'returned', v_qty_on_hand, v_row_count,
    case when (v_res ->> 'deducted')::int = 0 and (v_res ->> 'returned')::int = 0 and v_qty_on_hand = 10 and v_row_count = 0 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T6: SKU track_stock=false (product C, ไม่เคยเปิดเลย) ⇒ ข้ามเงียบ
  -----------------------------------------------------------------------
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
    values (v_shop_id, 'ZZ135-O3', v_channel_id, (now() at time zone 'Asia/Bangkok')::date, 500);
  insert into analytics.fact_order_item (shop_id, fact_order_id, product_id, sku_snapshot, qty, unit_price)
    select v_shop_id, fo.id, v_p_c, 'ZZ135-C', 5, 100 from analytics.fact_order fo where fo.shop_id = v_shop_id and fo.source_order_no = 'ZZ135-O3';

  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ135-O3']);
  select count(*) into v_row_count from public.central_stock where product_id = v_p_c;
  v_log := v_log || format('[T6] SKU track_stock=false: deducted=%s returned=%s failed=%s (คาดทั้งหมด 0), central_stock แถว=%s (คาด 0 — ไม่เคยถูกแตะ): %s' || E'\n',
    v_res ->> 'deducted', v_res ->> 'returned', jsonb_array_length(v_res -> 'failed'), v_row_count,
    case when (v_res ->> 'deducted')::int = 0 and (v_res ->> 'returned')::int = 0 and jsonb_array_length(v_res -> 'failed') = 0 and v_row_count = 0 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T7: สต็อกไม่พอ (product D มี 1, ออเดอร์ต้องการ 5) ห่อในแบตช์เดียวกับ
  -- ออเดอร์ของ product H1B ที่ต้องสำเร็จตามปกติ ⇒ พิสูจน์ batch ไม่ล้ม + คู่ที่
  -- สำเร็จยังทำงานได้จริง (ไม่ใช่แค่ no-op) + last_error/last_error_code/sku
  -----------------------------------------------------------------------
  v_res := analytics.product_track_stock_set(v_shop_id, v_p_d, true, 1);
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
    values (v_shop_id, 'ZZ135-O4', v_channel_id, (now() at time zone 'Asia/Bangkok')::date, 500);
  insert into analytics.fact_order_item (shop_id, fact_order_id, product_id, sku_snapshot, qty, unit_price)
    select v_shop_id, fo.id, v_p_d, 'ZZ135-D', 5, 100 from analytics.fact_order fo where fo.shop_id = v_shop_id and fo.source_order_no = 'ZZ135-O4';

  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
    values (v_shop_id, 'ZZ135-OPAIR', v_channel_id, (now() at time zone 'Asia/Bangkok')::date, 200);
  insert into analytics.fact_order_item (shop_id, fact_order_id, product_id, sku_snapshot, qty, unit_price)
    select v_shop_id, fo.id, v_p_h1b, 'ZZ135-H1B', 2, 100 from analytics.fact_order fo where fo.shop_id = v_shop_id and fo.source_order_no = 'ZZ135-OPAIR';

  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ135-O4', 'ZZ135-OPAIR']);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_d;
  select qty_applied, last_error, last_error_code into v_qty_applied, v_last_error, v_last_error_code
    from analytics.stock_sale_applied where shop_id = v_shop_id and source_order_no = 'ZZ135-O4' and product_id = v_p_d;
  v_log := v_log || format('[T7a] สต็อกไม่พอ: on_hand D=%s (คาดยังคง 1 ไม่ติดลบ), applied D=%s (คาดยังคง 0), last_error=%s, last_error_code=%s (คาด P0001): %s' || E'\n',
    v_qty_on_hand, v_qty_applied, coalesce(v_last_error, '(null)'), coalesce(v_last_error_code, '(null)'),
    case when v_qty_on_hand = 1 and v_qty_applied = 0 and v_last_error is not null and v_last_error_code = 'P0001'
      and v_last_error not like '%adjust_stock%' and v_last_error not like '%' || v_p_d::text || '%' then 'OK' else 'FAIL' end);

  v_log := v_log || format('[T7b] batch ไม่ล้ม (failed array length=%s คาด 1), sku ใน failed=%s (คาด ZZ135-D), deducted รวม=%s (คาด 2 — จาก H1B คู่ที่สำเร็จ): %s' || E'\n',
    jsonb_array_length(v_res -> 'failed'), (v_res -> 'failed' -> 0 ->> 'sku'), v_res ->> 'deducted',
    case when jsonb_array_length(v_res -> 'failed') = 1 and (v_res -> 'failed' -> 0 ->> 'sku') = 'ZZ135-D' and (v_res ->> 'deducted')::int = 2 then 'OK' else 'FAIL' end);

  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_h1b;
  v_log := v_log || format('[T7c] คู่ที่สำเร็จในคำสั่งเดียวกัน (H1B) ยังทำงานปกติ: on_hand=%s (คาด 10 — ลดจาก 12 ที่ H1b-idempotent ทิ้งไว้): %s' || E'\n',
    v_qty_on_hand, case when v_qty_on_hand = 10 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T19: ลบใบที่เคยพลาด ⇒ delta=0 ⇒ ต้องล้าง last_error + last_error_code
  -----------------------------------------------------------------------
  delete from analytics.fact_order where shop_id = v_shop_id and source_order_no = 'ZZ135-O4';
  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ135-O4']);
  select last_error, last_error_code into v_last_error, v_last_error_code
    from analytics.stock_sale_applied where shop_id = v_shop_id and source_order_no = 'ZZ135-O4' and product_id = v_p_d;
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_d;
  v_log := v_log || format('[T19] ลบใบที่เคยพลาด ⇒ delta=0: last_error=%s (คาด null), last_error_code=%s (คาด null), on_hand D=%s (คาดยังคง 1), returned=%s (คาด 0): %s' || E'\n',
    coalesce(v_last_error, '(null)'), coalesce(v_last_error_code, '(null)'), v_qty_on_hand, v_res ->> 'returned',
    case when v_last_error is null and v_last_error_code is null and v_qty_on_hand = 1 and (v_res ->> 'returned')::int = 0 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- M5: ใบถูกลบต้องคืนสต็อกเสมอ แม้ p_source_order_nos ที่ caller ส่งมาไม่มี
  -- เลขใบนั้นอยู่เลย (M5 anti-join fix) — ปะข้างด้วย v_p_pad ให้ array มีของจริง
  -- (ไม่ใช่ null ซึ่งครอบทั้งร้านอยู่แล้วโดยไม่ต้องมี fix นี้)
  -----------------------------------------------------------------------
  v_res := analytics.product_track_stock_set(v_shop_id, v_p_m5, true, 10);
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
    values (v_shop_id, 'ZZ135-O5', v_channel_id, (now() at time zone 'Asia/Bangkok')::date, 400);
  insert into analytics.fact_order_item (shop_id, fact_order_id, product_id, sku_snapshot, qty, unit_price)
    select v_shop_id, fo.id, v_p_m5, 'ZZ135-M5', 4, 100 from analytics.fact_order fo where fo.shop_id = v_shop_id and fo.source_order_no = 'ZZ135-O5';

  v_res := analytics.product_track_stock_set(v_shop_id, v_p_pad, true, 10);
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
    values (v_shop_id, 'ZZ135-O6', v_channel_id, (now() at time zone 'Asia/Bangkok')::date, 100);
  insert into analytics.fact_order_item (shop_id, fact_order_id, product_id, sku_snapshot, qty, unit_price)
    select v_shop_id, fo.id, v_p_pad, 'ZZ135-PAD', 1, 100 from analytics.fact_order fo where fo.shop_id = v_shop_id and fo.source_order_no = 'ZZ135-O6';

  perform analytics.stock_sync_sales(v_shop_id, array['ZZ135-O5']); -- deduct 4 -> on_hand m5 = 6
  perform analytics.stock_sync_sales(v_shop_id, array['ZZ135-O6']); -- deduct 1 -> on_hand pad = 9

  delete from analytics.fact_order where shop_id = v_shop_id and source_order_no = 'ZZ135-O5'; -- ลบใบ M5 ทิ้งจริง

  -- caller "ลืม" เลขใบ O5 ในรายการที่ขอ — ขอแค่ O6 (ปะข้าง) เท่านั้น
  v_res := analytics.stock_sync_sales(v_shop_id, array['ZZ135-O6']);
  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_m5;
  select qty_applied, sync_seq into v_qty_applied, v_sync_seq from analytics.stock_sale_applied where shop_id = v_shop_id and source_order_no = 'ZZ135-O5' and product_id = v_p_m5;
  v_log := v_log || format('[M5a] ใบ O5 ถูกลบแต่ caller ไม่ได้ขอเลขใบนั้น: on_hand M5=%s (คาด 10 — คืนกลับแม้ไม่ได้ขอ), applied=%s seq=%s (คาด 0/2), returned=%s (คาด 4): %s' || E'\n',
    v_qty_on_hand, v_qty_applied, v_sync_seq, v_res ->> 'returned',
    case when v_qty_on_hand = 10 and v_qty_applied = 0 and v_sync_seq = 2 and (v_res ->> 'returned')::int = 4 then 'OK' else 'FAIL' end);

  select qty_on_hand into v_qty_on_hand from public.central_stock where product_id = v_p_pad;
  v_log := v_log || format('[M5b] ออเดอร์ปะข้าง (PAD) ไม่ถูกกระทบ: on_hand=%s (คาดยังคง 9): %s' || E'\n',
    v_qty_on_hand, case when v_qty_on_hand = 9 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T11-equivalent: reserve_stock/commit_stock/release_stock/adjust_stock เดิม
  -- ยังทำงานปกติ ไม่มี overload ใหม่ (0135 ไม่แตะทั้ง 4 ตัวนี้เลย)
  -----------------------------------------------------------------------
  declare
    v_p_regress uuid;
    v_on_hand_1 int; v_on_hand_2 int;
  begin
    v_p_regress := analytics.product_upsert(v_shop_id, 'ZZ135-REGRESS', 'ทดสอบ adjust_stock เดิม', null, 'fixed', 50, null, null, null, null, null, null, null, true);
    insert into public.central_stock (product_id) values (v_p_regress);
    perform public.adjust_stock(v_shop_id, v_p_regress, 10, 'zz135-regress-1');
    select qty_on_hand into v_on_hand_1 from public.central_stock where product_id = v_p_regress;
    perform public.adjust_stock(v_shop_id, v_p_regress, -4, 'zz135-regress-2');
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
    v_log := v_log || format('[T11b] reserve_stock/commit_stock/release_stock/adjust_stock ไม่มี overload ใหม่: %s' || E'\n',
      case when v_all_ok then 'OK' else 'FAIL: ' || v_bad end);
  end;

  -----------------------------------------------------------------------
  -- T16: grant metadata ของ 3 ฟังก์ชันที่ 0135 แตะ (2 ใน analytics + 1)
  -----------------------------------------------------------------------
  declare
    v_fn_sigs text[] := array[
      'product_track_stock_set(uuid,uuid,boolean,integer)',
      'stock_sync_sales(uuid,text[])',
      'transform_pending_order_lines(uuid,uuid)'
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
      v_log := v_log || '[T16] product_track_stock_set/stock_sync_sales/transform_pending_order_lines: anon=false, authenticated=false, service_role=true, ไม่มี overload ค้าง: OK' || E'\n';
    else
      v_log := v_log || format('[T16] FAIL: %s' || E'\n', v_bad);
    end if;
  end;

  -----------------------------------------------------------------------
  -- T17: RLS ของ analytics.stock_sale_applied (คอลัมน์ last_error_code ใหม่
  -- อยู่ใต้ grant ระดับตารางเดิม — ต้องยังเป็น service_role เท่านั้น)
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
  -- static checks: อ่านนิยามฟังก์ชันจริงหลัง apply — ยืนยันว่า M2's filter
  -- list + bare re-raise, F6's order by, และ advisory lock ของ
  -- transform_pending_order_lines อยู่ในโค้ดที่รันจริง (ไม่ใช่ dynamic runtime
  -- proof เต็มรูปสำหรับ M2 — ดูข้อจำกัดที่บอกไว้ในหัวไฟล์นี้)
  -----------------------------------------------------------------------
  select pg_get_functiondef('analytics.stock_sync_sales(uuid,text[])'::regprocedure) into v_fndef;
  v_log := v_log || format('[M2-static] filter list (P0001/23505/23514) + bare re-raise (raise;) มีอยู่จริง: %s' || E'\n',
    case when v_fndef like '%P0001%' and v_fndef like '%23505%' and v_fndef like '%23514%' and v_fndef like '%raise;%' then 'OK' else 'FAIL' end);
  v_log := v_log || format('[F6-static] order by order_date/source_order_no/product_id มีอยู่จริง: %s' || E'\n',
    case when v_fndef like '%order by order_date%' then 'OK' else 'FAIL' end);
  v_log := v_log || format('[M5-static] anti-join "not exists" ฝั่ง applied มีอยู่จริง: %s' || E'\n',
    case when v_fndef like '%not exists%' then 'OK' else 'FAIL' end);
  v_log := v_log || format('[M1-static] live guard ฝั่ง sync (sku !~* ^live) มีอยู่จริง สองครั้ง (tgt+ap): %s' || E'\n',
    case when length(v_fndef) - length(replace(v_fndef, '!~* ''^live''', '')) >= length('!~* ''^live''') * 2 then 'OK' else 'FAIL' end);

  select pg_get_functiondef('analytics.transform_pending_order_lines(uuid,uuid)'::regprocedure) into v_fndef;
  v_log := v_log || format('[LOCK-static] transform_pending_order_lines ถือ advisory lock เดียวกับ stock_sync_sales: %s' || E'\n',
    case when v_fndef like '%pg_advisory_xact_lock%analytics.fact_order:%' then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- สรุปเคสที่ครอบ: H1a/H1b-open/H1b-retarget/H1b-idempotent/H1-reserved/REOPEN (H1 + [D])
  --   LIVE-open-blocked/LIVE-close-always/LIVE2-sync-ignored (M1) ·
  --   T1/T2/T3/T4/T13/T5/T6 (เคสห้ามพัง) · T7a/T7b/T7c + T19 (M2/M3) ·
  --   M5a/M5b (M5) · T11a/T11b (adjust_stock เดิมไม่พัง) · T16/T17
  --   (grant/RLS) · M2-static/F6-static/M5-static/M1-static/LOCK-static
  --   (static source checks — ดูข้อจำกัดของ M2 dynamic ในหัวไฟล์)
  -----------------------------------------------------------------------

  v_log := v_log || E'\n=== ALL CHECKS LOGGED ABOVE — ตรวจทุกบรรทัดหา FAIL (transaction จะ rollback เสมอ) ===\n';
  raise exception '%', v_log;
end $$;

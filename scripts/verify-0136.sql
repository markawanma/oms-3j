-- scripts/verify-0136.sql
--
-- ชุดทดสอบของ supabase/migrations/0136_transform_lock.sql
-- (เติม advisory lock ให้ analytics.transform_pending_order_lines)
--
-- ตาม skill 3j-migration-traps #11: ทุกอย่างรันใน do $$ ... $$ block เดียว จบด้วย
-- `raise exception` เสมอ ⇒ ทั้ง transaction rollback ไม่ว่าผลจะผ่าน/ไม่ผ่าน
-- อ่านผลจาก error message · ใช้เป็นทั้ง dry-run (ก่อน apply) และ post-apply verify
--
-- ⚠️ แตะ fact_order_item/fact_order จริง (💰) — ทดสอบด้วย shop/product/order/batch
-- สังเคราะห์ที่สร้างในทรานแซคชันนี้เองทั้งหมด ไม่แตะของจริงเลย
--
-- 🔴 กับดัก fixture ที่เคยทำ dry-run พังมาแล้ว 3 รอบ (18 ก.ย. 69) — query constraint
-- จริงก่อนเขียน fixture เสมอ อย่าเดา:
--   · analytics.stg_import_batch.source_type มี CHECK — ต้องเป็นหนึ่งใน
--     ('excel_order_report','tiktok_label_pdf','tiktok_slip_pdf','excel_line_item_report')
--   · analytics.stg_import_batch.file_hash NOT NULL
--   · analytics.stg_order_line_import.raw NOT NULL (jsonb)
--   · analytics.stg_order_line_import.batch_id มี FK ไป stg_import_batch
--   · public.reserve_stock มี FK ไป public.orders (ถ้าจะทดสอบยอดจอง ให้ update
--     central_stock.qty_reserved ตรงๆ แทน)
--
-- ผลรันจริง 18 ก.ย. 69 (ก่อน apply): ผ่าน 6/6

do $$
declare
  v_log text := E'\n=== verify 0136 (advisory lock ของ transform_pending_order_lines) ===\n';

  v_shop  uuid := gen_random_uuid();
  v_batch uuid := gen_random_uuid();
  v_ch    uuid;
  v_p     uuid;
  v_fo    uuid;

  v_r     record;
  v_items int;
  v_cogs  numeric;
  v_def   text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -----------------------------------------------------------------------
  -- setup: shop/product/batch/order/staging row สังเคราะห์
  -----------------------------------------------------------------------
  insert into public.shop (id, name) values (v_shop, 'ZZ TEST verify-0136');

  select id into v_ch from analytics.dim_channel where code = 'tiktok';
  if v_ch is null then
    raise exception 'verify-0136 setup: analytics.dim_channel ไม่มีแถว tiktok (seed จาก 0010 ควรมีอยู่แล้ว)';
  end if;

  v_p := analytics.product_upsert(v_shop, 'ZZ136-A', 'ทดสอบ transform', null, 'fixed', 40, null, null, null, null, null, null, null, true);

  insert into analytics.stg_import_batch (id, shop_id, source_type, file_hash)
    values (v_batch, v_shop, 'excel_line_item_report', 'zz136-test-hash');

  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
    values (v_shop, 'ZZ136-O1', v_ch, (now() at time zone 'Asia/Bangkok')::date, 300)
    returning id into v_fo;

  insert into analytics.stg_order_line_import (shop_id, batch_id, source_order_no, line_no, sku_raw, product_name_raw, qty, unit_price, import_status, raw)
    values (v_shop, v_batch, 'ZZ136-O1', 1, 'ZZ136-A', 'ทดสอบ transform', 3, 100, 'pending', '{}'::jsonb);

  -----------------------------------------------------------------------
  -- T1 (เคสห้ามพังที่สำคัญที่สุด): ฟังก์ชันยังแปลงรายการสินค้าได้ครบ end-to-end
  -- ไม่ใช่แค่ compile ผ่าน — 0136 คัดลอก body ทั้งดุ้น (~190 บรรทัด) มาเติม lock
  -- บรรทัดเดียว ถ้าลอกพลาดแม้จุดเดียว ระบบนำเข้าไฟล์ยอดขายของเจ้าของพังทันที
  -----------------------------------------------------------------------
  select * into v_r from analytics.transform_pending_order_lines(v_shop, v_batch);
  select count(*), max(fo.cogs) into v_items, v_cogs
    from analytics.fact_order_item foi
    join analytics.fact_order fo on fo.id = foi.fact_order_id
   where foi.fact_order_id = v_fo;
  v_log := v_log || format('[T1] แปลงรายการครบ end-to-end: transformed=%s (คาด 1), fact_order_item=%s แถว (คาด 1), cogs=%s (คาด 120 = 3 x 40): %s' || E'\n',
    v_r.transformed_count, v_items, v_cogs,
    case when v_r.transformed_count = 1 and v_items = 1 and v_cogs = 120 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T2: เรียกซ้ำบน batch เดิม (ทุกแถวเป็น transformed แล้ว) ต้องไม่ล้ม
  -----------------------------------------------------------------------
  select * into v_r from analytics.transform_pending_order_lines(v_shop, v_batch);
  v_log := v_log || format('[T2] เรียกซ้ำ batch เดิมไม่ล้ม: transformed=%s (คาด 0) errored=%s (คาด 0): %s' || E'\n',
    v_r.transformed_count, v_r.errored_count,
    case when v_r.transformed_count = 0 and v_r.errored_count = 0 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T3 (หัวใจของ 0136): เรียก stock_sync_sales ต่อทันทีใน session เดียวกัน
  -- ⇒ ถือ advisory key เดิมซ้ำ ต้องเป็น no-op ไม่ใช่ deadlock
  -- (pg_advisory_xact_lock: session เดียวกันขอ key ซ้ำได้ฟรี · คนละ session เข้าคิว)
  -- ถ้า key ที่ใส่ใน 0136 ไม่ตรงกับของ stock_sync_sales เทสต์นี้จะผ่านเหมือนกัน
  -- ⇒ ต้องมี T4 คู่กันเสมอ
  -----------------------------------------------------------------------
  perform analytics.stock_sync_sales(v_shop, null);
  v_log := v_log || '[T3] เรียก stock_sync_sales ต่อใน session เดียวกัน (ถือ lock key เดิมซ้ำ) ไม่ค้าง ไม่ deadlock: OK' || E'\n';

  -----------------------------------------------------------------------
  -- T4: lock อยู่ในโค้ดที่รันจริง และ key ตรงกับ 0114/0115/0133
  -- (ย้ายมาจาก verify-0135.sql — lock ถูกแยกออกจาก 0135 มาเป็น 0136)
  -----------------------------------------------------------------------
  select pg_get_functiondef('analytics.transform_pending_order_lines(uuid,uuid)'::regprocedure) into v_def;
  v_log := v_log || format('[T4] มี advisory lock key เดียวกับ stock_sync_sales/0114/0115: %s' || E'\n',
    case when v_def like '%pg_advisory_xact_lock%' and v_def like '%analytics.fact_order:%' then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T5: grant ไม่หลุดหลัง create or replace (กับดัก 3j-migration-traps #2)
  -----------------------------------------------------------------------
  v_log := v_log || format('[T5] grant: anon=%s auth=%s svc=%s (คาด f/f/t): %s' || E'\n',
    has_function_privilege('anon','analytics.transform_pending_order_lines(uuid,uuid)','execute'),
    has_function_privilege('authenticated','analytics.transform_pending_order_lines(uuid,uuid)','execute'),
    has_function_privilege('service_role','analytics.transform_pending_order_lines(uuid,uuid)','execute'),
    case when has_function_privilege('anon','analytics.transform_pending_order_lines(uuid,uuid)','execute') = false
          and has_function_privilege('authenticated','analytics.transform_pending_order_lines(uuid,uuid)','execute') = false
          and has_function_privilege('service_role','analytics.transform_pending_order_lines(uuid,uuid)','execute') = true
         then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T6: ไม่มี overload ค้าง (กับดัก #1 — signature ไม่เปลี่ยน จึงต้องเป็น 1 ตัว)
  -----------------------------------------------------------------------
  v_log := v_log || format('[T6] ไม่มี overload: %s ตัว (คาด 1): %s' || E'\n',
    (select count(*) from pg_proc where pronamespace='analytics'::regnamespace and proname='transform_pending_order_lines'),
    case when (select count(*) from pg_proc where pronamespace='analytics'::regnamespace and proname='transform_pending_order_lines') = 1 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- หมายเหตุการพิสูจน์เพิ่มเติม (ทำนอกไฟล์นี้ตอน apply — บันทึกไว้ให้ทำซ้ำได้):
  -- md5 ของ prosrc หลังตัดคอมเมนต์/ช่องว่าง และตัดบล็อก lock ที่เพิ่มออก
  -- ต้องเท่ากับ b9aaa5f7d81c5b4464e55adb4624e522 (= นิยามบน prod ก่อน 0136)
  -- ⇒ พิสูจน์ว่าการคัดลอก body ~190 บรรทัดไม่ได้เปลี่ยนอะไรเลยแม้แต่ช่องว่าง
  -- 🔴 แต่ md5 ของ prosrc พิสูจน์ "ค่า default ของพารามิเตอร์" ไม่ได้ (อยู่ที่
  --    pg_proc.proargdefaults คนละที่) — ถ้า migration ไหนแตะ default/signature
  --    ต้องเช็ค pg_get_function_arguments() แยกเสมอ (บทเรียน 0135)
  -----------------------------------------------------------------------

  v_log := v_log || E'\n=== ALL CHECKS LOGGED ABOVE — ตรวจทุกบรรทัดหา FAIL (transaction จะ rollback เสมอ) ===\n';
  raise exception '%', v_log;
end $$;

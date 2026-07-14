-- docs/dev-seed.sql
--
-- DEV-ONLY seed data for previewing the frontend without a real
-- auth/onboarding flow (there isn't one yet — see CLAUDE.md + design doc
-- limitation). Run this once against your Supabase project ("3J Online
-- Sale") via the SQL editor (or `psql`/`supabase db execute`), then copy the
-- printed `shop.id` into `.env.local` as `DEV_SHOP_ID`.
--
-- This does NOT create a Supabase Auth user or shop_member row — every page
-- in this app reads/writes via the service-role key + DEV_SHOP_ID instead of
-- an authenticated session (see lib/supabase/server.ts). If/when real auth
-- ships, seed a shop_member row here too and switch the app back to
-- anon-key + RLS reads.

do $$
declare
  v_shop_id uuid;
  v_shopee_channel_id uuid;
  v_tiktok_channel_id uuid;
  v_shopee_account_id uuid;
  v_tiktok_account_id uuid;
  v_product_shirt uuid;
  v_product_mug uuid;
  v_product_unmapped uuid;
  v_order_new uuid;
  v_order_confirmed uuid;
  v_order_to_ship uuid;
  v_order_oversold uuid;
begin
  insert into shop (name) values ('ร้านตัวอย่าง (dev)') returning id into v_shop_id;

  select id into v_shopee_channel_id from channel where code = 'shopee';
  select id into v_tiktok_channel_id from channel where code = 'tiktok';

  insert into channel_account (shop_id, channel_id, external_shop_id, is_sandbox, status)
    values (v_shop_id, v_shopee_channel_id, 'dev-shopee-shop', true, 'active')
    returning id into v_shopee_account_id;

  insert into channel_account (shop_id, channel_id, external_shop_id, is_sandbox, status)
    values (v_shop_id, v_tiktok_channel_id, 'dev-tiktok-shop', true, 'active')
    returning id into v_tiktok_account_id;

  insert into product (shop_id, sku, name) values (v_shop_id, 'TSHIRT-BLK-M', 'เสื้อยืดสีดำ ไซส์ M') returning id into v_product_shirt;
  insert into product (shop_id, sku, name) values (v_shop_id, 'MUG-001', 'แก้วมัค ลายการ์ตูน') returning id into v_product_mug;
  insert into product (shop_id, sku, name) values (v_shop_id, 'UNMAPPED-001', 'สินค้าตัวอย่าง (ยังไม่ map)') returning id into v_product_unmapped;

  insert into central_stock (product_id, qty_on_hand, qty_reserved) values (v_product_shirt, 20, 3);
  insert into central_stock (product_id, qty_on_hand, qty_reserved) values (v_product_mug, 4, 1); -- low-stock demo (amber)
  insert into central_stock (product_id, qty_on_hand, qty_reserved) values (v_product_unmapped, 0, 0); -- out-of-stock demo (red)

  -- Order 1: new
  insert into orders (channel_account_id, external_order_id, status, external_status, buyer_name, buyer_phone, shipping_address, total_amount, placed_at)
    values (v_shopee_account_id, 'SP-1001', 'new', 'UNPAID', 'สมชาย ใจดี', '081-234-5678', '{"line1":"123 ถ.สุขุมวิท","district":"คลองเตย","province":"กรุงเทพฯ"}'::jsonb, 590.00, now() - interval '2 hours')
    returning id into v_order_new;
  insert into order_item (order_id, product_id, external_item_id, external_sku, qty, unit_price)
    values (v_order_new, v_product_shirt, 'itm-1', 'TSHIRT-BLK-M', 2, 295.00);

  -- Order 2: confirmed
  insert into orders (channel_account_id, external_order_id, status, external_status, buyer_name, buyer_phone, shipping_address, total_amount, placed_at)
    values (v_tiktok_account_id, 'TT-2001', 'confirmed', 'AWAITING_SHIPMENT', 'สมหญิง มีสุข', '089-111-2222', '{"line1":"45/6 ถ.พระราม 4","district":"บางรัก","province":"กรุงเทพฯ"}'::jsonb, 150.00, now() - interval '5 hours')
    returning id into v_order_confirmed;
  insert into order_item (order_id, product_id, external_item_id, external_sku, qty, unit_price)
    values (v_order_confirmed, v_product_mug, 'itm-2', 'MUG-001', 1, 150.00);

  -- Order 3: to_ship
  insert into orders (channel_account_id, external_order_id, status, external_status, buyer_name, buyer_phone, shipping_address, total_amount, placed_at)
    values (v_shopee_account_id, 'SP-1002', 'to_ship', 'PROCESSED', 'วิชัย รักเรียน', '082-333-4444', '{"line1":"9 หมู่ 3","district":"เมือง","province":"เชียงใหม่"}'::jsonb, 295.00, now() - interval '1 day')
    returning id into v_order_to_ship;
  insert into order_item (order_id, product_id, external_item_id, external_sku, qty, unit_price)
    values (v_order_to_ship, v_product_shirt, 'itm-3', 'TSHIRT-BLK-M', 1, 295.00);

  -- Order 4: oversold_hold (unmapped/insufficient stock — demonstrates OversoldAlertCard)
  insert into orders (channel_account_id, external_order_id, status, external_status, buyer_name, buyer_phone, shipping_address, total_amount, placed_at)
    values (v_tiktok_account_id, 'TT-2002', 'oversold_hold', 'UNPAID', 'ปิยะ ทองคำ', '083-555-6666', '{"line1":"78 ถ.เพชรบุรี","district":"ราชเทวี","province":"กรุงเทพฯ"}'::jsonb, 100.00, now() - interval '30 minutes')
    returning id into v_order_oversold;
  insert into order_item (order_id, product_id, external_item_id, external_sku, qty, unit_price)
    values (v_order_oversold, null, 'itm-4', 'UNMAPPED-001', 1, 100.00);

  raise notice 'DEV_SHOP_ID=%', v_shop_id;
end $$;

-- 0137_track_stock_set_idem_fix.sql
-- ปิด HIGH-1 จาก security review ของ 0135 — รูที่พาไปถึง "ขายเกิน"
--
-- ปัญหา: idem key ของ product_track_stock_set = 'init:<product>:<since>:<target>'
-- ผูกกับ **ยอดเป้าหมาย** แต่ adjust_stock (0007) จำ **delta** ⇒
--   (ก) ตั้งยอดซ้ำที่ delta บังเอิญเท่าเดิม ⇒ adjust_stock คืนแบบ idempotent โดยไม่ apply
--       ⇒ no-op เงียบแต่ return ว่าสำเร็จ ⇒ ระบบเชื่อว่ามีของที่ไม่มีอยู่จริง = **ขายเกิน**
--       (ทำซ้ำได้: on_hand 5 → ตั้ง 0 → ของกลับเข้ามา 5 → ตั้ง 0 อีกครั้ง ⇒ ค้างที่ 5)
--   (ข) target เดิมซ้ำแต่ delta ต่าง ⇒ 23505 **ถาวร** — ซึ่งเป็น use case ที่ 0135
--       ตั้งใจเปิดทางให้พอดี (ปิดนับ → เปิดใหม่พร้อมยอดที่นับได้)
--   (ค) เคส (ข) ตกที่ `raise;` ⇒ ข้อความดิบของ adjust_stock หลุดถึงผู้ใช้
--       (ชื่อฟังก์ชันภายใน + UUID + รูปแบบ idem key) ผิดกติกา "เฉพาะ 22023 เท่านั้น"
--
-- แก้ 3 ชั้น:
--   1. คีย์ไม่ซ้ำ "ต่อครั้งที่ปรับ" — นับจาก stock_ledger (ไม่ใช่ clock) ⇒ deterministic
--      และปลอดภัยใต้ row lock ที่ถืออยู่แล้ว · set-semantics idempotent ในตัวเองอยู่แล้ว
--      (เรียกซ้ำ = อ่าน on_hand ใหม่ = delta 0 = ไม่ทำอะไร) ⇒ idem guard ของ adjust_stock
--      ไม่ต้องกันซ้ำอีกชั้น · pattern เดียวกับ lib/actions/stock.ts ที่ใช้ ui:adjust:<product>:<ts>
--   2. **post-check**: อ่าน qty_on_hand กลับมาเทียบกับเป้าหมาย ไม่ตรง = raise
--      fail-closed กัน "adjust_stock คืนแบบ idempotent โดยไม่ apply" ทุกรูปแบบในอนาคต
--      ไม่ใช่แค่เคสที่รู้จักวันนี้
--   3. ไม่มี bare re-raise — sqlstate ใดก็ตามที่ไม่ใช่ "ของไม่พอ" แปลงเป็นข้อความกลาง 22023
--      ข้อความดิบไป raise warning (Postgres log)
--
-- M4 พ่วง: P0001 คือ errcode default ของ raise exception ทุกตัวใน plpgsql ⇒ ตาข่ายกว้างเกิน
-- ⇒ เช็คข้อความประกอบ (`adjust_stock: cannot apply delta%`) ไม่ใช่ดู sqlstate อย่างเดียว
--
-- ไม่เปลี่ยน signature (ยังเป็น uuid,uuid,boolean,int + default null) ⇒ ไม่มี overload
-- M3 (23514 ไม่ควรถูกกลืนใน stock_sync_sales) + M2 (actor/audit) ยกไป 0138 พร้อมงาน lot
-- ที่จะแก้ stock_sync_sales อยู่แล้ว — จะได้ไม่ replace ฟังก์ชันเดียวกันสองรอบ
--
-- dry-run ผ่าน 13/13 ก่อน apply — รวมการทำซ้ำบั๊กจริงทั้ง (ก) และ (ข) แล้วพิสูจน์ว่าปิด
-- ทดสอบ: scripts/verify-0137.sql

create or replace function analytics.product_track_stock_set(
  p_shop_id     uuid,
  p_product_id  uuid,
  p_enabled     boolean,
  -- null = "ไม่ได้ส่งยอดมา ไม่ต้องแตะสต็อก" · 0 = "ตั้งเป็นศูนย์จริงๆ" (0135)
  p_initial_qty int default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_product     public.product%rowtype;
  v_today       date := (now() at time zone 'Asia/Bangkok')::date;
  v_since       date;
  v_qty         int;
  v_on_hand     int;
  v_reserved    int;
  v_delta       int;
  v_idem_key    text;
  v_init_seq    int;
  v_after       int;
  v_sqlstate    text;
  v_raw         text;
  v_was_enabled boolean;
begin
  if p_shop_id is null or p_product_id is null then
    raise exception 'product_track_stock_set: p_shop_id and p_product_id are required' using errcode = '22023';
  end if;
  if p_enabled is null then
    raise exception 'product_track_stock_set: p_enabled is required' using errcode = '22023';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_product from public.product
    where id = p_product_id and shop_id = p_shop_id
    for update;
  if not found then
    raise exception 'product_track_stock_set: ไม่พบ SKU % ในร้านนี้', p_product_id using errcode = '22023';
  end if;
  v_was_enabled := v_product.track_stock;

  -- M1(ข) ของ 0135: บล็อกเฉพาะตอน "เปิด" — ปิดต้องทำได้เสมอ
  if p_enabled and v_product.sku ~* '^live' then
    raise exception 'product_track_stock_set: SKU % เป็น SKU เฉพาะไลฟ์ (live*) ไม่นับสต็อก (มติเจ้าของ 17 ก.ย. 69)', v_product.sku using errcode = '22023';
  end if;

  if not p_enabled then
    update public.product
       set track_stock = false, updated_at = now()
     where id = p_product_id;

    return jsonb_build_object(
      'product_id', p_product_id, 'track_stock', false,
      'track_stock_since', v_product.track_stock_since, 'already_enabled', v_was_enabled
    );
  end if;

  if p_initial_qty is not null and not (p_initial_qty >= 0 and p_initial_qty <= 100000) then
    raise exception 'product_track_stock_set: p_initial_qty ต้องอยู่ระหว่าง 0-100000 (ได้ %)', p_initial_qty using errcode = '22023';
  end if;
  v_qty := p_initial_qty;

  -- ห้ามเลื่อน track_stock_since ถ้าเคยเปิดมาก่อน (0133 decision [A])
  v_since := coalesce(v_product.track_stock_since, v_today);

  insert into public.central_stock (product_id) values (p_product_id)
    on conflict (product_id) do nothing;

  select qty_on_hand, qty_reserved into v_on_hand, v_reserved
    from public.central_stock where product_id = p_product_id for update;

  v_delta := case when v_qty is null then 0 else v_qty - coalesce(v_on_hand, 0) end;

  if v_delta <> 0 then
    -- 0137 H1 ชั้นที่ 1: คีย์ไม่ซ้ำต่อ "ครั้งที่ปรับ" ไม่ใช่ต่อ "ยอดเป้าหมาย"
    select count(*) into v_init_seq
      from public.stock_ledger sl
     where sl.shop_id = p_shop_id
       and sl.product_id = p_product_id
       and sl.idempotency_key like 'init:' || p_product_id::text || ':%';

    v_idem_key := 'init:' || p_product_id::text || ':' || v_since::text
                  || ':' || v_qty::text || ':' || (v_init_seq + 1)::text;

    begin
      perform public.adjust_stock(p_shop_id, p_product_id, v_delta, v_idem_key);
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_raw = message_text;
      -- 0137 ชั้นที่ 3: ข้อความดิบไป Postgres log ไม่ใช่หน้าจอผู้ใช้
      raise warning 'product_track_stock_set: product=% target=% delta=% sqlstate=% %',
        p_product_id, v_qty, v_delta, v_sqlstate, v_raw;
      -- M4: เช็คข้อความประกอบ ไม่ดู sqlstate อย่างเดียว (P0001 เป็น default ของ plpgsql)
      if v_sqlstate = 'P0001' and v_raw like 'adjust_stock: cannot apply delta%' then
        raise exception 'product_track_stock_set: ตั้งยอดสต็อกของ SKU % เป็น % ไม่ได้ (ปัจจุบันมียอดถูกจองไว้ % ชิ้น ตั้งต่ำกว่ายอดจองไม่ได้)', v_product.sku, v_qty, coalesce(v_reserved, 0) using errcode = '22023';
      end if;
      raise exception 'product_track_stock_set: ตั้งยอดสต็อกของ SKU % ไม่สำเร็จ — ลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งทีมพัฒนา (รหัส %)',
        v_product.sku, v_sqlstate using errcode = '22023';
    end;

    -- 0137 H1 ชั้นที่ 2: post-check — fail-closed กันทุกรูปแบบของ "คืนแบบ idempotent
    -- โดยไม่ apply" ไม่ใช่แค่เคสที่รู้จักวันนี้
    select qty_on_hand into v_after from public.central_stock where product_id = p_product_id;
    if v_after is distinct from v_qty then
      raise exception 'product_track_stock_set: ตั้งยอดสต็อกของ SKU % เป็น % ไม่สำเร็จ (ยอดในระบบยังเป็น %) — แจ้งทีมพัฒนา',
        v_product.sku, v_qty, v_after using errcode = '22023';
    end if;
  end if;

  update public.product
     set track_stock = true, track_stock_since = v_since, updated_at = now()
   where id = p_product_id;

  return jsonb_build_object(
    'product_id', p_product_id, 'track_stock', true,
    'track_stock_since', v_since, 'qty_target', v_qty, 'delta_applied', v_delta,
    'already_enabled', v_was_enabled
  );
end;
$$;

revoke execute on function analytics.product_track_stock_set(uuid, uuid, boolean, int) from public, anon, authenticated;
grant  execute on function analytics.product_track_stock_set(uuid, uuid, boolean, int) to service_role;

notify pgrst, 'reload schema';

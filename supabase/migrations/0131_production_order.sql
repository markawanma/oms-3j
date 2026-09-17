-- 0131_production_order.sql
-- ⏳ NOT YET APPLIED — dry-run ผ่าน scripts/verify-0131.sql ก่อน apply จริง
-- (Tech Lead จะ apply ผ่าน MCP แล้วแก้บรรทัดนี้เป็น "✅ APPLIED" เอง — agent
-- ไม่มี Supabase MCP ในรอบนี้)
--
-- P1a — ใบผลิตเข้าสต็อก (backend only). Design:
--   docs/3j-jewelry/oms/design-production-order.md (แหล่งจริงของโครงสร้าง)
--   docs/3j-jewelry/oms/system-flow-2026-09.md §6.1/§8 (มติเจ้าของ)
--
-- ✅ มติเจ้าของ 17 ก.ย. 69 ที่ผูกมัดไฟล์นี้ (design §Q1): "ล็อก" — done ต้องเซ็ต
-- product.cost_type='fixed' + unit_cost = ต้นทุนที่คำนวณ ณ วันที่ผลิตเสร็จ
-- ราคาเงินขึ้นวันหลังห้ามกระทบกำไรของล็อตที่ผลิตไปแล้ว — ห้ามคง cost_type='spot'
-- หลัง done เด็ดขาด (ทางที่ถูกปฏิเสธแล้ว ห้ามเสนอซ้ำ).
--
-- ขอบเขตรอบนี้ (P1a): SQL อย่างเดียว — ไม่แตะ TypeScript/หน้าเว็บ/ไฟล์ OEM แม้แต่
-- บรรทัดเดียว (P1b ทำต่อคนละรอบ). ยืนยันแล้วว่า P1 ไม่แตะไฟล์ OEM เพราะ OEM ใช้
-- analytics.oem_* และไม่อ่านต้นทุนจาก public.product เลย (design บรรทัด 12).
--
-- 🔴 จุดที่พังง่ายที่สุด (design ระบุไว้ ทำตามเป๊ะ):
--   1. central_stock ไม่ได้ถูกสร้างให้ทุก SKU (มีแค่ตอน /products/new) ⇒
--      production_order_done ต้อง ensure แถวก่อนเรียก adjust_stock เสมอ ไม่งั้น
--      ได้ข้อความหลอก "would go negative" (0007) ทั้งที่จริงคือ "ไม่มีแถวเลย"
--   2. ลำดับใน done เป็น load-bearing: เขียน snapshot ลง item + product ก่อน
--      พลิก production_order.status เป็น done เป็นบรรทัดสุดท้าย — ดูคอมเมนต์ใน
--      analytics.production_order_done ด้านล่าง (หัวข้อ "ลำดับ load-bearing")
--   3. production_cost_calc ใช้นิพจน์ต้นทุน spot คำต่อคำจาก v_dim_product (0028):
--      round(coalesce(weight_g,0) * coalesce(spot,0) * coalesce(purity,0.925)
--        + coalesce(labor_cost,0), 2)
--   4. production_spot_resolve: override > ราคาวันไทยวันนี้ (analytics.oem_metal_price,
--      metal='silver') > raise — ห้าม fallback ราคาเมื่อวานเด็ดขาด
--   5. production_order_preview ใช้ production_cost_calc ตัวเดียวกับ done (ไม่มี
--      สูตรคำนวณต้นทุนซ้ำที่สอง) — ที่เห็นก่อนกด = ที่จะถูก stamp
--   6. live-SKU: regex `sku ~* '^live'` — ตัวเดียวกับที่ระบบใช้จริงอยู่แล้ว
--      (analytics.silver_price... เดิม ใน 0121_live_session_log.sql:258 ใช้กับ
--      fact_order_item.sku_snapshot; ที่นี่ใช้กับ public.product.sku ตรงๆ เป็น
--      regex เดียวกัน ไม่ใช่ regex ใหม่) — เช็คทั้งตอน item_set/insert (trigger
--      analytics.production_order_item_derive_shop) และตอน done (defense-in-depth
--      เผื่อ SKU ถูก rename เป็น live* หลังถูกใส่ในใบไปแล้ว)
--   7. ทุก RPC: security definer + set search_path + crm_require_owner_admin +
--      revoke public/anon/authenticated + grant service_role เท่านั้น (ไม่ grant
--      authenticated เลย — สอดคล้องกับ 0123/0124: ทั้ง schema analytics/public
--      ปิด REST สำหรับ anon/authenticated ไปแล้ว ทุกอย่างอ่าน/เขียนผ่าน
--      getServiceClient() เท่านั้น — ดูหมายเหตุ grants ท้ายไฟล์)
--   8. เลี่ยง `returns table` ทั้งไฟล์ — คืน jsonb/void/numeric/uuid เท่านั้น
--
-- ⚠️ ช่องว่างที่พบระหว่างเขียน (ไม่ได้อยู่ใน design เดิม แจ้ง Tech Lead แล้วใน
-- สรุปงาน ไม่ใช่การเดาแล้วเขียนต่อแบบเงียบๆ):
--   - design พูดถึง "2 view security_invoker" และ "8 RPC" แต่ไม่ได้ระบุชื่อ view
--     หรือ signature ของ RPC แต่ละตัว (มีแค่รายชื่อ 8 ตัว) — ตัดสินใจเองตามรอย
--     pattern ของ 0089 (sku_counter)/0028 (cost calc)/0086-0088 (deny-mutation
--     trigger) โปรดดูสรุปที่ส่งกลับ Tech Lead สำหรับรายละเอียดที่ตัดสินใจเอง
--   - production_order_item.shop_id + cross-shop validation ใช้ trigger เดียวกับ
--     "derive shop_id" (design บอกแค่ว่ามี trigger derive shop_id ไม่ได้บอกว่าต้อง
--     cross-validate shop ด้วย) — เพิ่มเองเพราะ FK ของ product_id เช็คแค่ "มีอยู่
--     จริง" ไม่เช็ค "อยู่ร้านเดียวกับใบ" ถ้าไม่เพิ่มจะมีช่องให้ direct insert ข้ามร้านได้

-- ============================================================================
-- 1. public.product — เพิ่ม track_stock / track_stock_since (design P1 ตาม
--    system-flow §1: ย้าย "คอลัมน์" มา P1 แต่ไม่ย้าย RPC toggle — เปิดได้ทางเดียว
--    ในเฟสนี้คือ production_order_done, P1.5 ค่อยเพิ่ม toggle มือที่ /catalog)
-- ============================================================================

alter table public.product
  add column if not exists track_stock       boolean not null default false,
  add column if not exists track_stock_since date;

comment on column public.product.track_stock is
  'P1 (0131): true = SKU นี้นับสต็อกจริงจาก central_stock. default false ⇒ SKU เก่า/'
  'live-SKU/SKU ที่ import auto-create ไม่ถูกนับโดยไม่ต้องทำอะไร (มติเจ้าของ 17 ก.ย. §8). '
  'เปิดได้ทางเดียวในเฟสนี้คือ analytics.production_order_done (P1.5 จะเพิ่ม toggle มือ).';
comment on column public.product.track_stock_since is
  'วันไทย (Asia/Bangkok) ที่เริ่มนับสต็อกของ SKU นี้ครั้งแรก — ห้ามถูกเลื่อนถ้าเคยเปิดแล้ว '
  '(production_order_done ใช้ coalesce(track_stock_since, วันนี้) กันการเลื่อน). '
  'ใช้เป็นจุดตัดสำหรับ P1.5 reconcile ในอนาคต (ไม่ตัดสต็อกย้อนหลังก่อนวันนี้).';

-- ============================================================================
-- 2. analytics.production_order_counter — ตัวนับเลขใบต่อ shop_id เดียว (ไม่มี
--    prefix ต่างจาก sku_counter เพราะใบผลิตมีแค่รูปแบบเดียว PO-0001) pattern
--    เดียวกับ analytics.sku_counter (0089): row-lock ผ่าน insert..on conflict..
--    returning ภายใน transaction เดียวกับ production_order_save, ไม่มี
--    deny-mutation trigger (เลขข้ามได้ — ไม่ใช่เอกสารทางกฎหมาย ดู design บรรทัด 48)
--    RLS เปิดแต่ไม่มี policy/grant ให้ role ไหนเลย — เข้าถึงได้เฉพาะผ่าน
--    production_order_save (security definer) เหมือน sku_counter
-- ============================================================================

create table if not exists analytics.production_order_counter (
  shop_id uuid not null primary key references public.shop (id) on delete cascade,
  last_no int  not null default 0
);

alter table analytics.production_order_counter enable row level security;
-- ไม่มี create policy บรรทัดไหนเลยในไฟล์นี้โดยตั้งใจ (เหมือน sku_counter/oem_doc_counter)

comment on table analytics.production_order_counter is
  '0131: ตัวนับเลขใบผลิตถัดไปต่อ shop_id — เลขข้ามได้ (ไม่มี deny-mutation trigger) '
  'เพราะใบผลิตไม่ใช่เอกสารทางกฎหมาย (ต่างจาก analytics.oem_doc_counter). '
  'RLS เปิดแต่ไม่มี policy/grant — เข้าถึงได้เฉพาะผ่าน analytics.production_order_save '
  '(security definer).';

-- ============================================================================
-- 3. analytics.production_order — หัวใบผลิต
--    เลขใบ PO-0001 เป็น generated column จาก seq (unique ต่อร้าน, ไม่ใช้
--    oem_doc_counter — design บรรทัด 48). สถานะ open→done / open→cancelled;
--    done/cancelled เป็นปลายทาง แก้/ลบไม่ได้ บังคับด้วย trigger ใน §5
--    (ไม่ใช่แค่ RLS — service_role มี BYPASSRLS จึงต้องกันที่ trigger เท่านั้น
--    ตามบทเรียน 0086/0088)
-- ============================================================================

create table analytics.production_order (
  id                          uuid primary key default gen_random_uuid(),
  shop_id                     uuid not null references public.shop (id) on delete cascade,
  seq                         int  not null,
  po_no                       text generated always as ('PO-' || lpad(seq::text, 4, '0')) stored,
  status                      text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  note                        text,
  -- ช่อง override ราคาเงินของใบนี้เอง (design บรรทัด 13) — แยกจาก /oem/rates
  -- โดยตั้งใจ กันไม่ให้กรอกราคาใบผลิตไปล็อกราคาใบเสนอราคา OEM ทั้งวันเป็นผลข้างเคียง
  spot_override_thb_per_gram numeric(12, 4)
    check (spot_override_thb_per_gram is null
      or (spot_override_thb_per_gram >= 5 and spot_override_thb_per_gram <= 500)),
  done_at                     timestamptz,
  cancelled_at                timestamptz,
  cancel_reason               text,
  created_by                  uuid references auth.users (id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint uq_production_order_shop_seq unique (shop_id, seq)
);

create index idx_production_order_shop_status on analytics.production_order (shop_id, status);

comment on table analytics.production_order is
  '0131: หัวใบผลิตเข้าสต็อก. status open→done (💰 stamp ต้นทุน+สต็อก) หรือ
   open→cancelled — ทั้งสองเป็นปลายทาง แก้/ลบไม่ได้ (trigger
   analytics.production_order_deny_mutation). po_no เป็น generated column จาก seq,
   เลขข้ามได้ (ไม่ใช่เอกสารทางกฎหมาย ต่างจาก oem_receipt).';

alter table analytics.production_order enable row level security;

drop policy if exists tenant_isolation_select on analytics.production_order;
create policy tenant_isolation_select on analytics.production_order
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

-- ============================================================================
-- 4. analytics.production_order_item — รายการ SKU ในใบผลิต
--    unique (production_order_id, product_id) กัน SKU เดิมสองบรรทัดในใบเดียว
--    ที่ระดับ schema (design บรรทัด 50) — item_set ใช้ upsert บน key นี้
--    prev_cost_type/prev_unit_cost เก็บค่าก่อน stamp ไว้ตรวจย้อนได้โดยไม่ต้อง
--    พึ่ง audit log (design บรรทัด 51 — audit log เขียนคู่ไว้ด้วยใน §7 done)
-- ============================================================================

create table analytics.production_order_item (
  id                  uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references analytics.production_order (id) on delete cascade,
  -- derived by trigger (analytics.production_order_item_derive_shop) จาก
  -- production_order_id เสมอ — ไม่รับตรงจาก caller (defense-in-depth เหมือน
  -- public.central_stock.shop_id / public.product_mapping.shop_id เดิม)
  shop_id             uuid not null references public.shop (id) on delete cascade,
  product_id          uuid not null references public.product (id) on delete restrict,
  -- เพดาน 100,000 ชิ้น/รายการ: กันเลขพิมพ์ผิดเพิ่มศูนย์เกิน ไม่มีรอบผลิตเครื่อง
  -- ประดับจริงเกินหลักหมื่นชิ้นต่อ SKU ต่อใบ (ไม่ใช่ข้อจำกัดทางธุรกิจจริง)
  qty_planned         int not null check (qty_planned > 0 and qty_planned <= 100000),
  qty_done            int check (qty_done is null or (qty_done >= 0 and qty_done <= 100000)),
  unit_cost           numeric(12, 2),
  prev_cost_type      text check (prev_cost_type is null or prev_cost_type in ('fixed', 'spot')),
  prev_unit_cost      numeric(12, 2),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint uq_production_order_item_order_product unique (production_order_id, product_id)
);

create index idx_production_order_item_order   on analytics.production_order_item (production_order_id);
create index idx_production_order_item_product on analytics.production_order_item (product_id);

comment on table analytics.production_order_item is
  '0131: รายการ SKU ในใบผลิต. product_id ชี้แถวที่ "ถือสต็อก" จริง (แถวลูกถ้าเป็น
   variant สี/ไซส์ — P2, ยังไม่มีในระบบวันนี้). unit_cost/prev_cost_type/
   prev_unit_cost ถูกเขียนโดย analytics.production_order_done เท่านั้น ตอน done —
   ก่อนหน้านั้นเป็น null เสมอ (ยังไม่ stamp).';

alter table analytics.production_order_item enable row level security;

drop policy if exists tenant_isolation_select on analytics.production_order_item;
create policy tenant_isolation_select on analytics.production_order_item
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

-- ============================================================================
-- 5. Triggers — กันแก้ใบ/รายการที่ปิดแล้ว (ทั้งระดับใบและระดับ item) + derive
--    shop_id ของ item + cross-shop/live-SKU/is_active validation ที่ระดับ DB
--    (defense-in-depth หลัง item_set's ตัวเองด้านบน — กันการ direct insert/
--    update ผ่าน service key ตรงๆ ข้าม RPC ทั้งหมด)
-- ============================================================================

-- 5a. production_order: DELETE ปฏิเสธเสมอ · identity columns (shop_id/seq/
--     created_at/created_by) ห้ามเปลี่ยนไม่ว่าสถานะไหน · แก้อะไรก็ตามตอน
--     old.status <> 'open' ปฏิเสธหมด (done/cancelled เป็นปลายทาง) · transition
--     เข้า done/cancelled ต้องมี done_at/cancelled_at คู่กันเสมอ (defense-in-depth
--     เผื่อ RPC มีบั๊กลืม stamp เวลา)
create or replace function analytics.production_order_deny_mutation()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'production_order: ห้ามลบใบผลิต — ยกเลิกด้วย analytics.production_order_cancel แทน (ต้องเก็บไว้เป็น audit trail ของต้นทุน/สต็อก)' using errcode = '22023';
  end if;

  if new.shop_id is distinct from old.shop_id
     or new.seq is distinct from old.seq
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'production_order: ห้ามเปลี่ยน shop_id/seq/created_at/created_by ของใบที่มีอยู่แล้ว' using errcode = '22023';
  end if;

  if old.status <> 'open' then
    raise exception 'production_order: ใบ % สถานะ % แล้ว แก้ไม่ได้ (open→done/cancelled เป็นปลายทาง)', old.po_no, old.status using errcode = '22023';
  end if;

  if new.status = 'done' and new.done_at is null then
    raise exception 'production_order: เปลี่ยนเป็น done ต้องมี done_at กำกับเสมอ' using errcode = '22023';
  end if;
  if new.status = 'cancelled' and new.cancelled_at is null then
    raise exception 'production_order: เปลี่ยนเป็น cancelled ต้องมี cancelled_at กำกับเสมอ' using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke execute on function analytics.production_order_deny_mutation() from public, anon, authenticated;

comment on function analytics.production_order_deny_mutation() is
  '0131: trigger function กัน UPDATE/DELETE ตรงบน analytics.production_order (แม้ผ่าน
   service_role ซึ่งมี BYPASSRLS) — DELETE ปฏิเสธเสมอ, identity columns ห้ามเปลี่ยน,
   old.status<>open ปฏิเสธการแก้ไขทุกชนิด. pattern เดียวกับ
   analytics.oem_receipt_deny_mutation (0086) / oem_doc_counter_deny_mutation (0088).';

drop trigger if exists trg_production_order_deny_mutation on analytics.production_order;
create trigger trg_production_order_deny_mutation
  before update or delete on analytics.production_order
  for each row execute function analytics.production_order_deny_mutation();

-- 5b. production_order_item: DELETE/UPDATE ปฏิเสธถ้าใบแม่ไม่ใช่ open (ครอบทั้ง
--     กรณี done และ cancelled) — อ่านสถานะใบแม่สดทุกครั้ง ไม่พึ่ง cache
create or replace function analytics.production_order_item_deny_mutation()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_status text;
begin
  select status into v_status from analytics.production_order
    where id = coalesce(new.production_order_id, old.production_order_id);

  if v_status is distinct from 'open' then
    if tg_op = 'DELETE' then
      raise exception 'production_order_item: ใบผลิตนี้สถานะ % แล้ว ลบรายการไม่ได้', v_status using errcode = '22023';
    else
      raise exception 'production_order_item: ใบผลิตนี้สถานะ % แล้ว แก้รายการไม่ได้', v_status using errcode = '22023';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function analytics.production_order_item_deny_mutation() from public, anon, authenticated;

comment on function analytics.production_order_item_deny_mutation() is
  '0131: กัน UPDATE/DELETE ตรงบน analytics.production_order_item เมื่อใบแม่ปิดแล้ว
   (done/cancelled) — คู่กับ analytics.production_order_item_derive_shop ซึ่งกัน
   INSERT เข้าใบที่ปิดแล้วแทน (คนละ trigger เพราะ derive_shop ผูกกับ INSERT/
   UPDATE OF production_order_id,product_id เท่านั้น ไม่ครอบ DELETE).';

drop trigger if exists trg_production_order_item_deny_mutation on analytics.production_order_item;
create trigger trg_production_order_item_deny_mutation
  before update or delete on analytics.production_order_item
  for each row execute function analytics.production_order_item_deny_mutation();

-- 5c. production_order_item: derive shop_id จาก production_order เสมอ (ไม่รับ
--     ตรงจาก caller) + cross-validate ว่า product_id เป็นของร้านเดียวกัน +
--     ปฏิเสธ SKU live*/ปิดใช้งาน + ปฏิเสธ INSERT เข้าใบที่ไม่ open — ทั้งหมดนี้
--     คือ defense-in-depth ระดับ DB เผื่อมี caller ที่ไม่ใช่ item_set (เช่น
--     direct insert ผ่าน service key ข้าม RPC) — item_set เองมี validation
--     เดียวกันนี้อยู่แล้วเพื่อให้ error message เป็นมิตรกว่า (เจอก่อนถึง trigger)
create or replace function analytics.production_order_item_derive_shop()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_order_shop_id   uuid;
  v_order_status    text;
  v_product_shop_id uuid;
  v_sku             text;
  v_is_active       boolean;
begin
  select shop_id, status into v_order_shop_id, v_order_status
    from analytics.production_order where id = new.production_order_id;
  if v_order_shop_id is null then
    raise exception 'production_order_item: ไม่พบใบผลิต %', new.production_order_id using errcode = '22023';
  end if;

  -- INSERT เข้าใบที่ไม่ open ต้องถูกกันตรงนี้ (deny_mutation ข้อ 5b ไม่ครอบ
  -- INSERT — ผูกกับ UPDATE/DELETE เท่านั้น) เผื่อ direct insert ข้าม item_set
  if v_order_status <> 'open' then
    raise exception 'production_order_item: ใบผลิตนี้สถานะ % แล้ว เพิ่ม/แก้รายการไม่ได้', v_order_status using errcode = '22023';
  end if;

  select shop_id, sku, is_active into v_product_shop_id, v_sku, v_is_active
    from public.product where id = new.product_id;
  if v_product_shop_id is null then
    raise exception 'production_order_item: ไม่พบ SKU (product_id=%)', new.product_id using errcode = '22023';
  end if;
  if v_product_shop_id <> v_order_shop_id then
    raise exception 'production_order_item: SKU (product_id=%) เป็นของร้านอื่น ใส่ในใบผลิตของร้านนี้ไม่ได้', new.product_id using errcode = '22023';
  end if;
  if v_sku ~* '^live' then
    raise exception 'production_order_item: SKU % เป็น SKU เฉพาะไลฟ์ (live*) ไม่นับสต็อก ใส่ในใบผลิตไม่ได้', v_sku using errcode = '22023';
  end if;
  if not v_is_active then
    raise exception 'production_order_item: SKU % ปิดใช้งานแล้ว ใส่ในใบผลิตไม่ได้', v_sku using errcode = '22023';
  end if;

  new.shop_id := v_order_shop_id;
  return new;
end;
$$;

revoke execute on function analytics.production_order_item_derive_shop() from public, anon, authenticated;

comment on function analytics.production_order_item_derive_shop() is
  '0131: derive production_order_item.shop_id จากใบแม่เสมอ (ไม่รับตรงจาก caller) +
   cross-validate product เป็นของร้านเดียวกัน + ปฏิเสธ SKU live*/ปิดใช้งาน/ใบไม่
   open ตอน INSERT — ผูกกับ INSERT OR UPDATE OF (production_order_id, product_id)
   เท่านั้น (qty_planned/qty_done-only update ไม่ต้อง re-validate ซ้ำ).';

drop trigger if exists trg_production_order_item_derive_shop on analytics.production_order_item;
create trigger trg_production_order_item_derive_shop
  before insert or update of production_order_id, product_id on analytics.production_order_item
  for each row execute function analytics.production_order_item_derive_shop();

-- ============================================================================
-- 6. analytics.production_spot_resolve — override > ราคาวันไทยวันนี้ > raise
--    (ห้าม fallback ราคาเมื่อวานเด็ดขาด — design บรรทัด 57/74)
-- ============================================================================

create or replace function analytics.production_spot_resolve(
  p_shop_id  uuid,
  p_override numeric default null
)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_price numeric;
begin
  if p_shop_id is null then
    raise exception 'production_spot_resolve: p_shop_id is required';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_override is not null then
    -- not(between) กัน NaN/Infinity หลุดผ่าน (3j-migration-traps ข้อ 4) —
    -- 'NaN' >= 5 เป็น true แต่ 'NaN' <= 500 เป็น false เสมอ ⇒ and เป็น false ⇒
    -- not() เป็น true ⇒ raise ถูกต้อง
    if not (p_override >= 5 and p_override <= 500) then
      raise exception 'production_spot_resolve: override ต้องอยู่ระหว่าง 5-500 บาท/กรัม (ต่อกรัม ไม่ใช่ต่อบาท — 1 บาท = 15.244 กรัม)' using errcode = '22023';
    end if;
    return p_override;
  end if;

  select price_thb_per_gram into v_price
    from analytics.oem_metal_price
   where shop_id = p_shop_id and metal = 'silver' and as_of_date = v_today;

  if v_price is null then
    raise exception 'production_spot_resolve: ยังไม่มีราคาเงินของวันนี้ (%) และไม่มี override — ออกใบผลิตไม่ได้ (ห้าม fallback ราคาเมื่อวาน)', v_today using errcode = '22023';
  end if;

  return v_price;
end;
$$;

revoke execute on function analytics.production_spot_resolve(uuid, numeric) from public, anon, authenticated;
grant execute on function analytics.production_spot_resolve(uuid, numeric) to service_role;

-- ============================================================================
-- 7. analytics.production_cost_calc — นิพจน์เดียวกับ v_dim_product (0028)
--    คำต่อคำ สำหรับ cost_type='spot'; cost_type='fixed' คืน unit_cost ตรงๆ.
--    เรียกได้ตรง (ดูต้นทุน SKU เดี่ยวๆ ก่อนเพิ่มเข้าใบ) และถูกเรียกซ้ำจาก
--    preview/done เพื่อไม่ให้สูตรคำนวณต้นทุนอยู่ 2 ที่ (design บรรทัด 55)
-- ============================================================================

create or replace function analytics.production_cost_calc(
  p_shop_id                   uuid,
  p_product_id                uuid,
  p_spot_price_thb_per_gram   numeric default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_product public.product%rowtype;
  v_spot    numeric;
  v_unit_cost numeric;
begin
  if p_shop_id is null or p_product_id is null then
    raise exception 'production_cost_calc: p_shop_id and p_product_id are required';
  end if;
  if p_spot_price_thb_per_gram is not null and not (p_spot_price_thb_per_gram >= 5 and p_spot_price_thb_per_gram <= 500) then
    raise exception 'production_cost_calc: p_spot_price_thb_per_gram ต้องอยู่ระหว่าง 5-500 บาท/กรัม' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_product from public.product where id = p_product_id and shop_id = p_shop_id;
  if not found then
    raise exception 'production_cost_calc: ไม่พบ SKU (product_id=%) ในร้านนี้', p_product_id using errcode = '22023';
  end if;

  if v_product.cost_type = 'spot' then
    if v_product.silver_weight_g is null or v_product.silver_weight_g <= 0 then
      raise exception 'production_cost_calc: SKU % เป็นโหมด spot แต่ยังไม่กรอกน้ำหนักเงิน (silver_weight_g) — กรอกที่ /catalog ก่อนสั่งผลิต', v_product.sku using errcode = '22023';
    end if;
    v_spot := coalesce(p_spot_price_thb_per_gram, analytics.production_spot_resolve(p_shop_id, null));
    -- 🔴 นิพจน์เดียวกับ analytics.v_dim_product (0028) คำต่อคำ — ห้ามแก้ที่นี่
    -- โดยไม่แก้ที่นั่นด้วย ไม่งั้นตัวเลขใน /catalog กับในใบผลิตจะไม่ตรงกัน
    v_unit_cost := round(coalesce(v_product.silver_weight_g, 0) * coalesce(v_spot, 0)
                          * coalesce(v_product.silver_purity, 0.925) + coalesce(v_product.labor_cost, 0), 2);
  else
    v_unit_cost := v_product.unit_cost;
    if v_unit_cost is null then
      raise exception 'production_cost_calc: SKU % ยังไม่มีต้นทุน (unit_cost) — กรอกที่ /catalog ก่อนสั่งผลิต', v_product.sku using errcode = '22023';
    end if;
  end if;

  return jsonb_build_object(
    'product_id', v_product.id,
    'sku', v_product.sku,
    'cost_type', v_product.cost_type,
    'silver_weight_g', v_product.silver_weight_g,
    'silver_purity', coalesce(v_product.silver_purity, 0.925),
    'labor_cost', v_product.labor_cost,
    'spot_price_thb_per_gram', case when v_product.cost_type = 'spot' then v_spot else null end,
    'prev_cost_type', v_product.cost_type,
    'prev_unit_cost', v_product.unit_cost,
    'unit_cost', v_unit_cost
  );
end;
$$;

revoke execute on function analytics.production_cost_calc(uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function analytics.production_cost_calc(uuid, uuid, numeric) to service_role;

-- ============================================================================
-- 8. analytics.production_order_save — สร้าง (p_id null) หรือแก้ (p_id ไม่
--    null) หัวใบผลิต. สร้าง: lock+increment production_order_counter (pattern
--    เดียวกับ sku_counter/catalog_sku_create 0089). แก้ได้เฉพาะสถานะ open.
-- ============================================================================

create or replace function analytics.production_order_save(
  p_shop_id                   uuid,
  p_id                        uuid default null,
  p_note                      text default null,
  p_spot_override_thb_per_gram numeric default null
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
    insert into analytics.production_order_counter as c (shop_id, last_no)
    values (p_shop_id, 0)
    on conflict (shop_id) do update set last_no = c.last_no
    returning c.last_no into v_seq;

    v_seq := v_seq + 1;
    update analytics.production_order_counter set last_no = v_seq where shop_id = p_shop_id;

    insert into analytics.production_order (shop_id, seq, note, spot_override_thb_per_gram, created_by)
    values (p_shop_id, v_seq, nullif(btrim(p_note), ''), p_spot_override_thb_per_gram, auth.uid())
    returning * into v_row;
  else
    select * into v_row from analytics.production_order where id = p_id and shop_id = p_shop_id for update;
    if not found then
      raise exception 'production_order_save: ไม่พบใบผลิต % ในร้านนี้', p_id using errcode = '22023';
    end if;
    if v_row.status <> 'open' then
      raise exception 'production_order_save: ใบ % สถานะ % แล้ว แก้ไม่ได้', v_row.po_no, v_row.status using errcode = '22023';
    end if;

    update analytics.production_order set
      note                        = coalesce(nullif(btrim(p_note), ''), note),
      spot_override_thb_per_gram  = coalesce(p_spot_override_thb_per_gram, spot_override_thb_per_gram),
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

revoke execute on function analytics.production_order_save(uuid, uuid, text, numeric) from public, anon, authenticated;
grant execute on function analytics.production_order_save(uuid, uuid, text, numeric) to service_role;

-- ============================================================================
-- 9. analytics.production_order_item_set — เพิ่ม/แก้จำนวนของ SKU ในใบ (upsert
--    บน unique(production_order_id, product_id)). ใบต้อง open. SKU ต้องเป็น
--    ของร้านนี้/ไม่ใช่ live*/is_active — เช็คซ้ำกับ trigger §5c เพื่อ error
--    message ที่เป็นมิตรกว่า (เจอก่อนถึง trigger)
-- ============================================================================

create or replace function analytics.production_order_item_set(
  p_shop_id             uuid,
  p_production_order_id uuid,
  p_product_id          uuid,
  p_qty_planned         int
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_order   analytics.production_order%rowtype;
  v_product public.product%rowtype;
  v_item    analytics.production_order_item%rowtype;
begin
  if p_shop_id is null or p_production_order_id is null or p_product_id is null then
    raise exception 'production_order_item_set: p_shop_id, p_production_order_id, p_product_id are required';
  end if;
  -- p_qty_planned เป็น int อยู่แล้ว (NaN/Infinity พังตั้งแต่ cast พารามิเตอร์ —
  -- 3j-migration-traps ข้อ 4 ตัวเลือก "int ปลอดภัยอยู่แล้ว")
  if p_qty_planned is null or not (p_qty_planned > 0 and p_qty_planned <= 100000) then
    raise exception 'production_order_item_set: p_qty_planned ต้องอยู่ระหว่าง 1-100000' using errcode = '22023';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_order from analytics.production_order where id = p_production_order_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'production_order_item_set: ไม่พบใบผลิต % ในร้านนี้', p_production_order_id using errcode = '22023';
  end if;
  if v_order.status <> 'open' then
    raise exception 'production_order_item_set: ใบ % สถานะ % แล้ว เพิ่ม/แก้รายการไม่ได้', v_order.po_no, v_order.status using errcode = '22023';
  end if;

  select * into v_product from public.product where id = p_product_id and shop_id = p_shop_id;
  if not found then
    raise exception 'production_order_item_set: ไม่พบ SKU % ในร้านนี้', p_product_id using errcode = '22023';
  end if;
  if not v_product.is_active then
    raise exception 'production_order_item_set: SKU % ปิดใช้งานแล้ว ใส่ในใบผลิตไม่ได้', v_product.sku using errcode = '22023';
  end if;
  if v_product.sku ~* '^live' then
    raise exception 'production_order_item_set: SKU % เป็น SKU เฉพาะไลฟ์ (live*) ไม่นับสต็อก ใส่ในใบผลิตไม่ได้', v_product.sku using errcode = '22023';
  end if;

  insert into analytics.production_order_item as poi (production_order_id, product_id, qty_planned)
  values (p_production_order_id, p_product_id, p_qty_planned)
  on conflict (production_order_id, product_id) do update
    set qty_planned = excluded.qty_planned, updated_at = now()
  returning * into v_item;

  return jsonb_build_object(
    'id', v_item.id, 'product_id', v_item.product_id, 'sku', v_product.sku,
    'name', v_product.name, 'qty_planned', v_item.qty_planned
  );
end;
$$;

revoke execute on function analytics.production_order_item_set(uuid, uuid, uuid, int) from public, anon, authenticated;
grant execute on function analytics.production_order_item_set(uuid, uuid, uuid, int) to service_role;

-- ============================================================================
-- 10. analytics.production_order_item_remove — ลบรายการ (idempotent: ลบซ้ำ
--     ไม่ raise). ใบต้อง open.
-- ============================================================================

create or replace function analytics.production_order_item_remove(
  p_shop_id             uuid,
  p_production_order_id uuid,
  p_product_id          uuid
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_order analytics.production_order%rowtype;
begin
  if p_shop_id is null or p_production_order_id is null or p_product_id is null then
    raise exception 'production_order_item_remove: p_shop_id, p_production_order_id, p_product_id are required';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_order from analytics.production_order where id = p_production_order_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'production_order_item_remove: ไม่พบใบผลิต % ในร้านนี้', p_production_order_id using errcode = '22023';
  end if;
  if v_order.status <> 'open' then
    raise exception 'production_order_item_remove: ใบ % สถานะ % แล้ว ลบรายการไม่ได้', v_order.po_no, v_order.status using errcode = '22023';
  end if;

  delete from analytics.production_order_item
   where production_order_id = p_production_order_id and product_id = p_product_id;
  -- idempotent โดยตั้งใจ: ลบรายการที่ไม่มีอยู่แล้วไม่ raise (ปุ่มลบกดซ้ำ/สองแท็บ
  -- ได้ผลลัพธ์เดิม ไม่ต่างจาก adjust_stock/item_set ที่ idempotent ในไฟล์นี้)
end;
$$;

revoke execute on function analytics.production_order_item_remove(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.production_order_item_remove(uuid, uuid, uuid) to service_role;

-- ============================================================================
-- 11. analytics.production_order_preview — read-only, ใช้ production_cost_calc
--     ตัวเดียวกับ done (ไม่มีสูตรคำนวณซ้ำที่สอง — design บรรทัด 55). ใบต้อง open
--     (ใบที่ปิดแล้วให้ดูค่าที่ stamp จริงจาก production_order_item ตรงๆ แทน
--     ไม่ recompute ราคาสดซึ่งจะไม่ตรงกับที่ stamp ไปแล้ว)
-- ============================================================================

create or replace function analytics.production_order_preview(
  p_shop_id             uuid,
  p_production_order_id uuid
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_order      analytics.production_order%rowtype;
  v_spot       numeric;
  v_needs_spot boolean;
  v_items      jsonb;
begin
  if p_shop_id is null or p_production_order_id is null then
    raise exception 'production_order_preview: p_shop_id and p_production_order_id are required';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_order from analytics.production_order where id = p_production_order_id and shop_id = p_shop_id;
  if not found then
    raise exception 'production_order_preview: ไม่พบใบผลิต % ในร้านนี้', p_production_order_id using errcode = '22023';
  end if;
  if v_order.status <> 'open' then
    raise exception 'production_order_preview: ใบ % สถานะ % แล้ว — ดูค่าที่ stamp ไปแล้วจากรายการใบผลิตได้เลย ไม่ต้อง preview ซ้ำ', v_order.po_no, v_order.status using errcode = '22023';
  end if;

  select exists (
    select 1 from analytics.production_order_item poi
    join public.product p on p.id = poi.product_id
    where poi.production_order_id = p_production_order_id and p.cost_type = 'spot'
  ) into v_needs_spot;

  if v_needs_spot then
    v_spot := analytics.production_spot_resolve(p_shop_id, v_order.spot_override_thb_per_gram);
  end if;

  select coalesce(jsonb_agg(
      calc.result || jsonb_build_object('item_id', poi.id, 'qty_planned', poi.qty_planned)
      order by poi.created_at
    ), '[]'::jsonb)
    into v_items
  from analytics.production_order_item poi
  join public.product p on p.id = poi.product_id
  cross join lateral (
    select analytics.production_cost_calc(
      p_shop_id, poi.product_id, case when p.cost_type = 'spot' then v_spot else null end
    ) as result
  ) calc
  where poi.production_order_id = p_production_order_id;

  return jsonb_build_object(
    'production_order_id', p_production_order_id,
    'po_no', v_order.po_no,
    'spot_price_thb_per_gram', v_spot,
    'items', v_items
  );
end;
$$;

revoke execute on function analytics.production_order_preview(uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.production_order_preview(uuid, uuid) to service_role;

-- ============================================================================
-- 12. analytics.production_order_done 💰 — RPC ที่แตะเงิน/สต็อกจริง
--     validate ทุกบรรทัดก่อนแตะสต็อกบรรทัดแรก → ensure central_stock →
--     adjust_stock → เขียนต้นทุนกลับ → พลิกสถานะเป็นบรรทัดสุดท้าย (design บรรทัด 56)
--     idempotent: กด done ซ้ำ (สถานะ done อยู่แล้ว) → คืนผลเดิม ไม่ raise ·
--     ใบ cancelled แล้ว → raise (ไม่ใช่ no-op เพราะเป็นสถานะที่ขัดแย้งกัน)
-- ============================================================================

create or replace function analytics.production_order_done(
  p_shop_id             uuid,
  p_production_order_id uuid,
  -- p_items: [{"product_id": "...", "qty_done": N}, ...] override จำนวนที่
  -- ผลิตได้จริงต่อ SKU (ถ้าไม่ส่ง หรือ SKU ไม่อยู่ใน array นี้ ⇒ ใช้ qty_planned)
  p_items               jsonb default null
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

  -- รอบที่ 2: mutate จริง
  --
  -- 🔴 ลำดับ load-bearing (design บรรทัด 56) — ห้ามสลับ:
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

    insert into analytics.catalog_audit_log (shop_id, product_id, sku, action, before, after, changed_by)
    values (p_shop_id, v_product.id, v_product.sku, 'edit', v_before, v_after, auth.uid());
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

revoke execute on function analytics.production_order_done(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function analytics.production_order_done(uuid, uuid, jsonb) to service_role;

-- ============================================================================
-- 13. analytics.production_order_cancel — open→cancelled. Idempotent ถ้า
--     cancelled อยู่แล้ว (คืนผลเดิม ไม่ raise) · raise ถ้า done แล้ว (ไม่มี
--     "ยกเลิกหลัง done" ในเฟสนี้ — หนี้ที่รู้ตัว ดู design บรรทัด 69)
-- ============================================================================

create or replace function analytics.production_order_cancel(
  p_shop_id             uuid,
  p_production_order_id uuid,
  p_reason              text default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_order analytics.production_order%rowtype;
begin
  if p_shop_id is null or p_production_order_id is null then
    raise exception 'production_order_cancel: p_shop_id and p_production_order_id are required';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_order from analytics.production_order
    where id = p_production_order_id and shop_id = p_shop_id
    for update;
  if not found then
    raise exception 'production_order_cancel: ไม่พบใบผลิต % ในร้านนี้', p_production_order_id using errcode = '22023';
  end if;

  if v_order.status = 'cancelled' then
    return jsonb_build_object('production_order_id', p_production_order_id, 'po_no', v_order.po_no,
      'status', v_order.status, 'already_cancelled', true);
  end if;

  if v_order.status = 'done' then
    raise exception 'production_order_cancel: ใบ % ผลิตเสร็จไปแล้ว (done) ยกเลิกไม่ได้ — สต็อกผิดแก้ที่ /stock, ต้นทุนผิดแก้ที่ /catalog แทน', v_order.po_no using errcode = '22023';
  end if;

  update analytics.production_order
     set status = 'cancelled', cancelled_at = now(), cancel_reason = nullif(btrim(p_reason), '')
   where id = p_production_order_id;

  return jsonb_build_object('production_order_id', p_production_order_id, 'po_no', v_order.po_no,
    'status', 'cancelled', 'already_cancelled', false);
end;
$$;

revoke execute on function analytics.production_order_cancel(uuid, uuid, text) from public, anon, authenticated;
grant execute on function analytics.production_order_cancel(uuid, uuid, text) to service_role;

-- ============================================================================
-- 14. Views (security_invoker) — read layer สำหรับ P1b (/production,
--     /production/[id]). ชื่อ/คอลัมน์ไม่ได้ระบุใน design (มีแค่ "2 view
--     security_invoker" ในโจทย์) — ตัดสินใจเองตามความต้องการของหน้าที่ระบุไว้
--     ("รายการ" + "แก้ได้ขณะ open") ใน design บรรทัด 63
-- ============================================================================

create or replace view analytics.v_production_order
  with (security_invoker = true) as
select
  po.id,
  po.shop_id,
  po.po_no,
  po.status,
  po.note,
  po.spot_override_thb_per_gram,
  po.done_at,
  po.cancelled_at,
  po.cancel_reason,
  po.created_by,
  po.created_at,
  po.updated_at,
  coalesce(i.item_count, 0)         as item_count,
  coalesce(i.qty_planned_total, 0)  as qty_planned_total,
  coalesce(i.qty_done_total, 0)     as qty_done_total
from analytics.production_order po
left join (
  select production_order_id, count(*) as item_count,
    sum(qty_planned) as qty_planned_total, sum(qty_done) as qty_done_total
  from analytics.production_order_item
  group by production_order_id
) i on i.production_order_id = po.id;

grant select on analytics.v_production_order to service_role;

create or replace view analytics.v_production_order_item
  with (security_invoker = true) as
select
  poi.id,
  poi.shop_id,
  poi.production_order_id,
  po.po_no,
  po.status        as order_status,
  poi.product_id,
  p.sku,
  p.name            as product_name,
  p.cost_type       as current_cost_type,
  p.unit_cost       as current_unit_cost,
  poi.qty_planned,
  poi.qty_done,
  poi.unit_cost     as stamped_unit_cost,
  poi.prev_cost_type,
  poi.prev_unit_cost,
  poi.created_at,
  poi.updated_at
from analytics.production_order_item poi
join analytics.production_order po on po.id = poi.production_order_id
join public.product p on p.id = poi.product_id;

grant select on analytics.v_production_order_item to service_role;

-- ============================================================================
-- 15. Grants — สรุป (ห้าม grant เหวี่ยงแหทั้ง schema — เจาะจงรายตาราง/ฟังก์ชัน)
--
--     ⚠️ ไม่ grant ให้ authenticated เลย ทั้งตาราง/view/RPC ในไฟล์นี้ — ต่างจาก
--     ธรรมเนียมเก่าของ analytics schema (0028/0031 ยุคก่อน grant authenticated
--     เป็นปกติ) เพราะ 0123_analytics_no_rest_for_users.sql +
--     0124_public_no_rest_for_users.sql (16 ก.ย. 69, A2-lite) ปิด USAGE ทั้ง
--     schema analytics/public สำหรับ anon/authenticated ไปแล้ว รวมถึง reverse
--     default privilege ที่เคย auto-grant authenticated ให้ตารางใหม่ — grant
--     authenticated ในไฟล์นี้จะเป็นของที่ตายตั้งแต่เกิด (schema ไม่มี USAGE ให้
--     เข้าอยู่แล้ว) และขัดกับนโยบายที่ตั้งไว้ 16 ก.ย. (เหมือนที่ 0130 ต้องมาแก้
--     v_audience ย้อนหลัง) ทุกอย่างในไฟล์นี้อ่าน/เขียนผ่าน getServiceClient()
--     (service_role) จาก server action เท่านั้น เป็นไปตาม P1b (ยังไม่เขียนในรอบนี้)
-- ============================================================================

grant select on analytics.production_order      to service_role;
grant select on analytics.production_order_item to service_role;
-- analytics.production_order_counter: ไม่ grant ให้ role ไหนเลย (เข้าถึงได้
-- เฉพาะผ่าน production_order_save ซึ่ง security definer — pattern เดียวกับ
-- sku_counter/oem_doc_counter)

notify pgrst, 'reload schema';

# Design: Public Catalog `/shop` (oms-3j.vercel.app)

> Architect design v1 - 2026-08-05 - **design only, ยังไม่ apply migration ใดๆ**

## 0. ข้อเท็จจริงจาก codebase ที่กระทบ design

1. **แอปนี้ยังไม่มี auth จริง** - ไม่มี `middleware.ts`, ไม่มี Supabase Auth session.
   ทุก query ใน `lib/actions/*.ts` ใช้ **service-role client** (`lib/supabase/server.ts`)
   + filter `shop_id = getDevShopId()` (dev-only shortcut ที่ documented ไว้ในไฟล์นั้น)
   ดังนั้น "แยก /shop ออกจาก auth" = เรื่อง route group + วินัยของ query layer ไม่ใช่ middleware matcher (ยังไม่มีอะไรให้ matcher ยกเว้น)
2. **ตาราง `product` (0001_core_schema.sql:160) ไม่มี `price` / `image_url` / `category`** -
   มีแค่ `id, shop_id, sku, name, barcode, unit_cost (=ต้นทุน ห้ามหลุด!), is_active, timestamps`
   ราคาขายมีเฉพาะระดับ order line (`unit_price`) - **ต้องเพิ่มคอลัมน์ก่อนถึงจะมี catalog ได้**
3. RLS ของ `product` (0002_rls.sql:78) = tenant_isolation ผ่าน `shop_member` - anon อ่านไม่ได้เลยตอนนี้ (ดี - default-deny)
4. Repo มี pattern **column-level REVOKE + SECURITY DEFINER RPC** อยู่แล้วใน `0004_rls_hardening.sql` (credential_ref) - reuse pattern เดิม
5. Prototype UI: `docs/3j-jewelry/web/product-catalog.html` (visual/layout reference)
6. หมวดสินค้า: derive จาก SKU prefix ได้ (`docs/3j-jewelry/analytics/ref-sku-prefix.md`, longest-prefix-first)

## 1. สถาปัตยกรรม route

```
app/
├── (dashboard)/          <- internal เดิม (orders/stock/products/live) - ไม่แตะ
│   └── layout.tsx        <- nav ภายใน (อนาคต: จุด enforce auth เมื่อทำ auth จริง)
├── (public)/             <- route group ใหม่ ไม่มี dashboard chrome / ไม่มี internal nav
│   └── shop/
│       └── page.tsx      <- Server Component อ่านผ่าน safe view เท่านั้น
├── layout.tsx            <- root เดิม
```

Data flow:

```
browser --GET /shop--> Next.js RSC (app/(public)/shop/page.tsx)
                          |  lib/actions/shop-catalog.ts (read-only)
                          v
                Supabase: SELECT * FROM public.shop_catalog  (view, allowlist columns)
                          v
                grid card -- ปุ่ม "สั่งซื้อผ่าน LINE" -> line.me/R/oaMessage/@3jsilver/?msg
```

- `/shop` เป็น **read-only 100%** - ไม่มี server action mutation, ไม่มี form
- Middleware: **ยังไม่ต้องสร้าง** (ไม่มี auth ให้ bypass) แต่บันทึกไว้: เมื่อทำ Supabase Auth จริง
  ให้ matcher ยกเว้น `/shop` เช่น `matcher: ['/((?!shop|_next|api/public).*)']`

## 2. Data access design (migration ใหม่ `0009_public_catalog.sql` - DDL sketch, ห้าม apply)

หลักการ: **RLS เป็น row-level - allowlist คอลัมน์ด้วย view + grant ให้ anon เฉพาะ view**
(ไม่ใช้ materialized view - mat view ไม่มี RLS, บทเรียนเดิมของ repo/Supabase)

```sql
-- (a) เพิ่มคอลัมน์ catalog บน product (nullable ทั้งหมด - ของเดิมไม่พัง)
alter table product
  add column selling_price numeric(12,2) check (selling_price is null or selling_price >= 0),
  add column image_url text,
  add column is_public boolean not null default false;  -- opt-in ต่อชิ้น ปลอดภัยกว่า default โชว์

-- (b) safe view - allowlist columns เท่านั้น (ไม่มี unit_cost/stock/barcode/shop_id)
--     security_invoker = false (default) -> view วิ่งด้วยสิทธิ์ owner (postgres) ข้าม RLS ของ product
--     ความปลอดภัยอยู่ที่ "view เลือกอะไรมาบ้าง" + WHERE ข้างล่าง
--     ห้ามเพิ่มคอลัมน์ใน view โดยไม่ผ่าน security review
create view public.shop_catalog as
  select p.id, p.sku, p.name, p.selling_price, p.image_url
  from product p
  where p.is_active
    and p.is_public
    and p.selling_price is not null and p.selling_price > 0
    and p.shop_id = 'REPLACE_3J_SHOP_ID'::uuid;  -- pin ร้านเดียว กัน multi-tenant หลุดข้ามร้าน

-- (c) grants - anon อ่านได้เฉพาะ view นี้ตัวเดียว
revoke all on public.shop_catalog from public, anon, authenticated;
grant select on public.shop_catalog to anon, authenticated;
-- ตาราง product เอง: อย่า grant อะไรเพิ่มให้ anon (RLS default-deny คุมอยู่แล้ว)
```

- **view ธรรมดา vs RPC SECURITY DEFINER**: เลือก view เพราะ query ง่าย (`.from('shop_catalog').select()`),
  ไม่ต้องดูแล function signature - RPC เหมาะเมื่อมี logic/พารามิเตอร์ ตอนนี้ไม่มี (YAGNI)
- **หมายเหตุ Supabase**: view ใน schema `public` โผล่ใน PostgREST อัตโนมัติ - เช็คว่า grant ตรงตามข้อ (c) เท่านั้น
- **ฝั่งแอปอ่านด้วย anon key** (client ใหม่ `lib/supabase/public.ts` ใช้ `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
  - จงใจ **ไม่ใช้ service client** เพื่อให้ DB grant เป็นเกราะจริง ไม่ใช่วินัยโค้ดอย่างเดียว

## 3. กรองสินค้า + หมวด

- Filter หลักอยู่ใน view: `is_active + is_public + selling_price > 0`
- non_product (box/deliver/laser) และ live_weight generic: กันด้วย **`is_public=false` (default)** - ไม่ต้องฝัง prefix logic ใน SQL
- **หมวด (phase 1)**: derive ฝั่ง TypeScript จาก SKU prefix - hardcode map เล็กๆ ใน `lib/shop/category.ts`
  (longest-prefix-first ตาม ref-sku-prefix.md เช่น `AT-` = จี้องค์เทพ, `NC` = สร้อยคอ, `R-` = แหวน)
  เหตุผล: สินค้า public เริ่มไม่กี่ตัว การ seed ref_sku_prefix + join ใน view = over-engineer ตอนนี้
  prefix ไม่ match -> หมวด "อื่นๆ" (ไม่เดา)
- **รูป**: `image_url` nullable -> card แสดง placeholder เมื่อ null - อนาคตอัป Supabase Storage
  public bucket `product-images` (read-only anon, เขียนผ่าน dashboard เท่านั้น) - phase หลัง

## 4. LINE buy

ปุ่มต่อ card (สร้าง URL ใน `lib/shop/category.ts`):

```
https://line.me/R/oaMessage/%403jsilver/?ENCODED_MSG
ENCODED_MSG = encodeURIComponent("สนใจสั่งซื้อ: " + name + " (" + sku + ")")
```

ใช้ `oaMessage` (prefill ข้อความ) - ลูกค้ากดส่งเอง ทีมขายเห็น sku ทันที
ไม่มี state ฝั่งเรา ไม่มี stock reservation (จงใจ - oversell จัดการในแชทเหมือน flow ปัจจุบัน)

## 5. ไฟล์ที่ต้องสร้าง/แก้

| ไฟล์ | ทำอะไร | ใคร |
|---|---|---|
| `supabase/migrations/0009_public_catalog.sql` | DDL ข้อ 2 (columns + view + grants) | backend |
| `lib/supabase/public.ts` | anon-key client (server-side, no session) | backend |
| `lib/actions/shop-catalog.ts` | `getCatalog()` อ่าน `shop_catalog` view (read-only, ห้ามใช้ service client) | backend |
| `lib/shop/category.ts` | SKU prefix -> หมวด (longest-prefix-first) + LINE deep link builder | backend |
| `app/(public)/layout.tsx` | layout สาธารณะ minimal (โลโก้ 3J, ไม่มี internal nav) | frontend |
| `app/(public)/shop/page.tsx` | Server Component: grid card ตาม `product-catalog.html` + ปุ่ม LINE + `revalidate = 300` (ISR) | frontend |
| `app/(dashboard)/products/new/page.tsx` + `lib/actions/products.ts` | เพิ่มฟิลด์ selling_price / is_public ตอน add สินค้า (แก้เล็ก) | backend+frontend |
| `.env.local.example` | เพิ่ม `NEXT_PUBLIC_SUPABASE_ANON_KEY` | devops |

## 6. Security checklist (สำหรับ security-auditor)

- [ ] `shop_catalog` view expose เฉพาะ `id, sku, name, selling_price, image_url` - **ห้ามมี**: `unit_cost`, `barcode`, `shop_id`, stock ใดๆ (`central_stock` ห้ามแตะ), margin, `product_mapping`, `channel_account`
- [ ] anon role select ได้เฉพาะ `shop_catalog` - verify ด้วย `information_schema.role_table_grants where grantee='anon'` หลัง migrate
- [ ] view pin `shop_id` ร้านเดียว (กัน tenant อื่นหลุดถ้ามีร้านเพิ่ม)
- [ ] `/shop` ไม่มี mutation path ใดๆ - ห้าม import `getServiceClient` ใน code path สาธารณะ
- [ ] `is_public` default `false` - สินค้าใหม่ไม่โผล่ public โดยอุบัติเหตุ
- [ ] ไม่ใช้ materialized view (mat view ไม่มี RLS)
- [ ] อย่า grant เพิ่มบน base table `product` ให้ anon/authenticated
- [ ] เช็ค PostgREST: object อื่นใน public schema ไม่ได้เผลอ grant anon ไปด้วย

## 7. Trade-offs

| เลือก | ตัดทิ้ง | เหตุผล |
|---|---|---|
| view + grant anon | RPC SECURITY DEFINER | ไม่มี param/logic - view ง่ายกว่า, pattern REVOKE/grant มีใน 0004 แล้ว |
| anon-key client สำหรับ /shop | service client เดิม + filter ในโค้ด | ให้ DB เป็นเกราะจริง; service client หลุดคอลัมน์ได้ถ้าโค้ดพลาด |
| `is_public` opt-in flag | filter ด้วย SKU prefix ใน SQL | ชัดเจน ควบคุมมือได้ ไม่พังเมื่อ prefix ใหม่โผล่ |
| หมวดจาก prefix ใน TS | seed ref_sku_prefix table + join | สินค้าน้อย - YAGNI; ย้ายลง DB เมื่อ SKU public > ~50 |
| ISR revalidate 300s | SSR ทุก request / static build | ราคาปรับไม่บ่อย + ลด load DB |

## 8. Open questions (ต้องตอบก่อน implement)

1. `shop_id` ของร้าน 3J ค่าไหน (จาก getDevShopId / env) - hardcode ใน view หรืออ่านจาก setting?
2. ราคา: ชิ้นเดียวต่อ SKU พอไหม หรือมีช่วงราคา (ไซซ์/ความยาวต่างราคา)? ถ้ามีต้องคิด variant ก่อน
3. `@3jsilver` คือ LINE OA ID จริงไหม (ต้อง verify ก่อน hardcode)
4. ต้องมีหน้า detail ต่อชิ้น (`/shop/[sku]`) เลยไหม หรือ grid เดียวพอ (แนะนำ: grid เดียวก่อน)

## 9. Deploy note (Vercel)

- เพิ่ม env บน Vercel: `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public ได้ - ถูก design เป็น public key ที่ RLS/grant คุม)
- ลำดับ: (1) apply 0009 บน Supabase -> (2) verify grants ใน SQL editor -> (3) merge -> Vercel auto-deploy
- ทดสอบบน preview URL แบบ incognito (ไม่ login) ก่อน merge main
- **Technical debt (บอกตรงๆ)**: ทั้งแอปยังไม่มี auth จริง - `/shop` ปลอดภัยเพราะ DB grant,
  แต่หน้า internal ยังเปิดโล่งบน production URL (issue แยก ต้องทำ Supabase Auth + middleware ก่อน/พร้อม launch /shop)

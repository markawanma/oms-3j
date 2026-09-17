# Production Hardening — Real Auth + PII Retention (Technical Design)

> architect (Yoda) · 2026-08-14 · **rev. Tech Lead 2026-08-15** (Obi-Wan review: renumber migrations 0046–0048, reconcile money-RPC client strategy หลัง security fix PR #3, เพิ่ม direct-bypass test + open questions E/F) · status: **REVIEWED — implement ได้หลังเจ้าของตอบ open questions §E**
> Debt 2 ตัวใหญ่ก่อนขึ้น production: (A) แทน DEV_ROLE/DEV_SHOP_ID stub ด้วย Supabase Auth จริง + RLS enforcement, (B) PII retention (PII ลูกค้า 2,653 คนอยู่ในระบบแล้ว)

---

## 0. ข้อค้นพบจากการอ่านโค้ดจริง (เปลี่ยน scope จากโจทย์)

| # | ข้อค้นพบ | ผลต่อ design |
|---|---------|--------------|
| F1 | **RLS recursion bug ซ่อนอยู่**: policy `tenant_isolation` บน `shop_member` (0002 บรรทัด 34-37) subselect ตัวเอง (`shop_id in (select shop_id from shop_member where user_id = auth.uid())`) — Postgres จะโยน `infinite recursion detected in policy for relation "shop_member"` ทันทีที่ **user จริง** query ตารางใดก็ตามที่ policy อ้าง shop_member (= เกือบทุกตาราง) — ไม่เคยโผล่เพราะทุก query วิ่ง service_role (BYPASSRLS) มาตลอด · **CONFIRMED LIVE 2026-08-15** (`pg_policy` ยังโชว์ self-subselect เดิม) | **ต้องแก้ใน 0046 ก่อน swap client** ไม่งั้นทุกหน้า 500 ทันทีตอน A2 |
| F2 | **PII retention มีแล้วครึ่งหนึ่ง**: `0024_crm_b2c_pii_retention.sql` มี `analytics.crm_apply_pii_retention(interval)` + pg_cron job `crm-pii-retention-180d` (daily 03:30) scrub `stg_order_import` แล้ว | ส่วน B ไม่ใช่สร้างใหม่ — เป็น **verify + อุด gap** |
| F3 | **Gap ใน 0024**: scrub เฉพาะ `import_status = 'transformed'` — แถว `pdf_label`/`pdf_slip` (transform proc ประมวลเฉพาะ `source_kind='excel'`) และแถว `error` ค้าง `pending`/`error` ตลอดชีพ — **ชื่อ/เบอร์/ที่อยู่ plaintext ไม่มีวันถูกลบ** | 0048 แก้เงื่อนไข scrub |
| F4 | pg_cron: 0024 เรียก `cron.schedule` — ถ้า 0024 apply ผ่านแปลว่า extension เปิดแล้ว แต่**ยังไม่เคย verify ว่า job รันจริง** (ตอนนี้ยังไม่มี data อายุเกิน 180 วัน — job รัน = 0 rows เสมอ แยกไม่ออกจาก job ไม่รัน) | B1 มีขั้น verify ด้วย `cron.job_run_details` |
| F5 | ยืนยัน: `fact_order`/`fact_order_item`/`dim_customer` **ไม่มี PII ดิบ** — เก็บเฉพาะ `primary_phone_hash` (sha256) / display_name; PII canonical อยู่ที่เดียวคือ `analytics.pii_customer` (owner/admin RLS, 0012 Tier 4) | ห้ามลบ fact/dim; pii_customer แยก policy ต่างหาก (B2) |
| F6 | Seam ตามที่ comment ใน lib/dev/context.ts สัญญาไว้ **แน่นจริง**: `getDevShopId`/`getDevRole` = 151 จุด / 34 ไฟล์ แต่ call site จริงอยู่ใน `lib/actions/*.ts` 14 ไฟล์ + `app/(dashboard)/**/page.tsx` ~13 หน้า (components 5 ไฟล์เป็นแค่ comment) · `getServiceClient` = 102 จุด / 21 ไฟล์ (15 action files + webhook route + tests) | A2 เป็นงาน mechanical ไล่ตาม compile error ได้ |
| F7 | ยังไม่มี `middleware.ts`, ยังไม่มี `@supabase/ssr` ใน package.json; grants schema `analytics` ให้ authenticated ครบแล้ว (0018 + re-run ท้ายเกือบทุก migration) | A1 เป็นงาน additive ล้วน |

---

## A. Real Auth

### A.1 Flow (target state)

```
Browser -- cookie (sb-*) --> middleware.ts (@supabase/ssr)
                              |  refresh token + redirect -> /login ถ้าไม่มี session
                              |  ยกเว้น: /shop, /api/webhooks, /login, /_next, static
                              v
              Server Action / RSC page
                              |
                              v
              lib/auth/context.ts :: getAuthContext()   <- seam เดียว (แทน lib/dev/context.ts)
                              |  1. createServerClient(cookies) -> supabase.auth.getUser()  [verify JWT]
                              |  2. select shop_id, role from shop_member where user_id = uid  [1 query, React cache() ต่อ request]
                              |  3. คืน { userId, shopId, role, supabase }
                              v
              Query ผ่าน user-scoped client -> Postgres RLS เห็น auth.uid() จริง
              -> tenant_isolation + owner/admin policies + security_invoker views ทำงานเป็นครั้งแรก
```

- **Login**: email + password (`signInWithPassword`) · ปิด public signup ใน Supabase Auth settings (invite-only)
- **Sign-out**: server action `auth.signOut()` + ปุ่มใน `app/(dashboard)/layout.tsx`
- auth.uid() ไหลเข้า RLS อัตโนมัติ: `@supabase/ssr` server client แนบ access token (JWT) จาก cookie ไปกับทุก PostgREST request — Postgres role = `authenticated`, `auth.uid()` = `sub` claim

### A.2 API contract — seam ใหม่

```ts
// lib/auth/context.ts  (server-only, แทน lib/dev/context.ts ทั้งไฟล์)
export type ShopRole = "owner" | "admin" | "staff";
export type AuthContext = {
  userId: string;
  shopId: string;           // จาก shop_member (แถวเดียว — single shop ในทางปฏิบัติ)
  role: ShopRole;
  supabase: SupabaseClient; // user-scoped, RLS enforced
};
export async function getAuthContext(): Promise<AuthContext>;   // redirect("/login") ถ้าไม่มี session / throw ถ้าไม่เป็น member
export async function requireOwnerAdmin(): Promise<AuthContext>; // throw ถ้า role = staff
```

- ทุก call site ปัจจุบันอยู่ใน async server action/RSC อยู่แล้ว — เปลี่ยน sync เป็น async แค่เติม `await` (mechanical)
- **ลบ `lib/dev/context.ts` ทิ้งใน A2** — compile error คือ checklist ไล่จุดตกค้าง (นี่คือเหตุผลที่ rename แทนการคง signature เดิม)
- ถ้า user เป็น member หลาย shop: เอาแถวแรก order by created_at (YAGNI — 3J มี shop เดียว; shop-switcher เป็น debt บันทึกไว้)

### A.3 ไฟล์ที่สร้าง/แก้

| ไฟล์ | งาน | Phase |
|------|-----|-------|
| `package.json` | เพิ่ม `@supabase/ssr` | A1 |
| `middleware.ts` (root, ใหม่) | session refresh + auth gate; matcher ยกเว้น `/shop`, `/api/webhooks/:path*`, `/login`, `/_next`, favicon/static | A1 |
| `app/(auth)/login/page.tsx` + `actions.ts` (ใหม่) | login form + signInWithPassword + error state | A1 |
| `lib/supabase/server.ts` | เพิ่ม `getUserClient()` (createServerClient + cookies() — **per-request, ห้าม module-level cache** ต่างจาก getServiceClient); คง `getServiceClient()` สำหรับ service path | A1 |
| `app/(dashboard)/layout.tsx` | ปุ่ม sign-out + แสดง email/role | A1 |
| `lib/auth/context.ts` (ใหม่) | ตาม A.2 | A2 |
| `lib/dev/context.ts` | **ลบ** | A2 |
| `lib/actions/*.ts` 14 ไฟล์ (crm, catalog, marketing, dashboard, orders, oversold, stock, hero-stock, products, live, quick-order, tiktok-sales, import-orders — ยกเว้น shop-catalog) | swap seam + client ตาม A.4 | A2 |
| `app/(dashboard)/**/page.tsx` ~13 หน้า | swap `getDevRole()` เป็น `(await getAuthContext()).role` | A2 |
| `scripts/provision-member.mjs` (ใหม่) | insert shop_member ด้วย service key (bootstrap + invite ชั่วคราว) | A0 |
| `supabase/migrations/0046, 0047, 0048` | ตาม A.6 / B (renumbered — 0041–0045 ถูกใช้แล้ว: lineitem/silverbar/crm-overview/dashboard/is-new-customer) | A0/A3/B1 |

### A.4 service_role -> user client mapping

| Path | Client หลัง swap | เหตุผล |
|------|-----------------|--------|
| `lib/actions/*` ทุก read/write ที่มาจาก user (catalog, marketing, orders, oversold, stock, hero-stock, products, live, quick-order, tiktok-sales) + crm **write** RPC (0021) | **user client** | RLS policies มีครบแล้ว (0002/0004/0012/0018+); crm **write** RPCs (0021) เช็ค owner/admin ใน body (`crm_require_owner_admin`) อยู่แล้ว — จะเริ่มถูก enforce จริงเป็นครั้งแรก |
| `lib/actions/import-orders.ts` — insert staging | **user client** | 0012 มี owner/admin INSERT policy บน staging อยู่แล้ว |
| `lib/actions/import-orders.ts` — call `transform_pending_orders` | **คง service** (gate ด้วย `requireOwnerAdmin()` ก่อนเรียก) | proc grant `service_role` เท่านั้น (0021 จงใจ); เปิดให้ authenticated = ขยาย attack surface โดยไม่จำเป็น |
| **money-gated aggregate RPC**: `dashboard_summary`/`dashboard_charts` (0039/0044), `crm_overview_summary` (0043) — feed /dashboard + /crm/overview | **คง service** (gate ด้วย `requireOwnerAdmin()` ก่อนเรียก) | ⚠️ **must-fix #2**: gate ของ RPC พวกนี้ = `p_include_money` **ที่ caller ส่งเอง** (default true) / บางตัวคืน profit เสมอ. ถ้าย้ายไป user client (role `authenticated`) staff ยิง PostgREST ตรง `POST /rpc/<fn>` body `{p_include_money:true}` = **bypass เห็นเงิน** (RLS row-level กันแค่ tenant ไม่ใช่ owner-only). `dashboard_*` = revoke authenticated → service_role only แล้ว (PR #3); **0046 ต้อง revoke `crm_overview_summary` ด้วย**. เรียกผ่าน service client หลัง `requireOwnerAdmin()` → gate อยู่ที่ server เชื่อถือได้ (option: derive `include_money` จาก `auth_has_role` ใน DB แทน param ถ้าอยากเปิด user client จริง — แต่ service+requireOwnerAdmin ง่ายกว่าและ consistent กับ transform) |
| **campaign write RPC** (0049): `campaign_set_artifact_status` / `campaign_pass_gate` — เรียกจาก `lib/actions/marketing.ts` (setCampaignArtifactStatus/passCampaignGate) | **ย้ายไป user client** | ⚠️ **must-do (security audit 2026-08-15)**: RPC พวกนี้ gate ด้วย `crm_require_owner_admin` ใน body (ดี) แต่ helper **short-circuit เมื่อ role=service_role** → ใต้ service client วันนี้ gate = no-op, ที่กันจริงคือ `getDevRole()` app-layer เท่านั้น. เพิ่งเกิดหลัง design เขียน จึง**ยังไม่อยู่ในลิสต์เดิม** — A2 ต้องย้ายไป user client (role authenticated จริง → crm_require_owner_admin enforce membership+owner/admin ตามจริง กัน cross-shop IDOR ตอน multi-shop). ทางเลือก 2: ถ้าคง service client ต้องเพิ่ม `artifact.shop_id === shopId` check ใน action ก่อนเรียก RPC |
| `app/api/webhooks/[channel]/route.ts` | **คง service** | marketplace เรียก ไม่มี user session; auth ของ path นี้ = webhook signature |
| `packages/*` worker + `scripts/*.mjs` | **คง service** | background jobs ไม่มี session; `sync_job` เป็น service-only by design (0002) |
| `lib/supabase/public.ts` (/shop) | **ไม่แตะ** | anon + shop_catalog view คือ security boundary ที่ถูกแล้ว |

**กติกาเหล็กตอน swap**: query ที่เคยได้ข้อมูลแล้วว่างเปล่าหลัง swap = RLS default-deny (grant/policy ขาด) — แก้ที่ policy, **ห้ามแก้โดยถอยกลับ service client**

### A.5 Provisioning (chicken/egg ของ 0002)

- **ไม่ทำ self-serve signup** — คงคำตอบเดิมของ 0002 comment: "provisioning = service-role-only flow" ตอนนี้ทำให้เป็นจริงด้วย script ไม่ใช่ UI
- Bootstrap ครั้งแรก (ต้องเสร็จ**ก่อน** deploy A1 มิฉะนั้นล็อกตัวเองออก):
  1. Supabase dashboard -> Authentication -> สร้าง user เจ้าของ (auto-confirm ได้เพราะสร้างเอง)
  2. รัน `node scripts/provision-member.mjs <email> <role>` — lookup auth user id แล้ว `insert into shop_member (shop_id = ค่า DEV_SHOP_ID เดิม, user_id, role)` ด้วย service key
  3. ทำซ้ำสำหรับ staff/admin ทุกคน (ทีม 3J เล็ก 2-5 คน)
- **ไม่ hardcode user id ใน migration** — auth.users ต่างกันระหว่าง project/environment
- เชิญ staff เพิ่มภายหลัง = รัน script (invite UI ใน /settings เป็น debt phase หลัง — YAGNI ตอนนี้)
- ไม่สร้าง `provision_shop()` RPC สำหรับ shop ใหม่ — 3J มี shop เดียว บันทึกเป็น debt ถ้าจะ multi-tenant จริง

### A.6 Migration 0046 — แก้ RLS recursion (F1) + revoke authenticated บน money RPC · **บังคับ apply ก่อน A2 deploy**

> **⚠️ SCOPE REVISED 2026-08-16 (implement A0+A1):** `0046_auth_helpers_and_revoke.sql` ที่ apply จริง = **helper `auth_shop_ids()`/`auth_has_role()` + revoke `crm_overview_summary` เท่านั้น** (`role::text = any(...)` เพราะ role เป็น enum). **การ rewrite 76 policy ด้วย ALTER POLICY → ยกไป migration ของ A2** — เพราะ policy ไม่ถูก exercise จน swap client (service_role BYPASSRLS) จึงควรเขียน+verify พร้อม A2 ใต้ session จริง ปลอดภัยกว่า ship 76 ALTER ที่ยังไม่ได้ test. helper ด้านล่างคือ prerequisite ที่ปลอดภัยให้ land ก่อน. (spec เดิมด้านล่างยังเป็น reference ตอนทำ A2)

ต้นเหตุ: policy อ้าง `shop_id in (select shop_id from shop_member where user_id = auth.uid())` — พอ query แตะ `shop_member` เอง policy เรียกตัวเอง → `infinite recursion`. แก้ด้วย **SECURITY DEFINER helper** (bypass RLS ตอน lookup membership → ตัดวงจร):

```sql
-- helper: bypass RLS อ่าน membership (security definer) — ตัด recursion
create or replace function public.auth_shop_ids()
  returns setof uuid language sql security definer stable
  set search_path = public, pg_temp
as $$ select shop_id from public.shop_member where user_id = auth.uid() $$;

create or replace function public.auth_has_role(p_shop_id uuid, variadic p_roles text[])
  returns boolean language sql security definer stable
  set search_path = public, pg_temp
as $$ select exists(select 1 from public.shop_member
        where shop_id = p_shop_id and user_id = auth.uid() and role = any(p_roles)) $$;

revoke execute on function public.auth_shop_ids(), public.auth_has_role(uuid, text[]) from public, anon;
grant  execute on function public.auth_shop_ids(), public.auth_has_role(uuid, text[]) to authenticated;
```

- rewrite ทุก policy ที่ใช้ subselect `shop_member` → `shop_id in (select public.auth_shop_ids())`; policy owner/admin → `public.auth_has_role(shop_id, 'owner','admin')`
- **`shop_member` เอง**: policy ต้องใช้ `id in (select public.auth_shop_ids())` (definer) — ห้าม subselect ตรง (recursion)
- ครอบ policy ใน 0002 (shop/shop_member/product/order/…) + 0012 (analytics tier) ที่มี pattern เดิม — ไล่ให้ครบใน 0046 ก้อนเดียว. **grep ต้องกวาด migration ทั้งหมด** — ⚠️ **มี 2 สำนวนปนกัน** (security audit 2026-08-15): `from shop_member` (ไม่ qualified, 0002/0004/0008 ~25 จุด) และ `from public.shop_member` (qualified, 0012/0021/0027/0028/0037/**0049 campaign** ~50 จุด). grep แบบ `'from shop_member ...'` ตรงๆ **จับ qualified ไม่ได้** → ตกหล่น analytics tier + campaign tables ทั้งหมด. ใช้ regex ครอบทั้งสอง:
  ```bash
  grep -rniE 'from[[:space:]]+(public\.)?shop_member[[:space:]]+where[[:space:]]+user_id[[:space:]]*=[[:space:]]*auth\.uid\(\)' supabase/migrations/
  ```
  แล้ว **ยืนยันว่า campaign 4 ตาราง (campaign/campaign_step/step_artifact/step_gate จาก 0049) อยู่ในผลลัพธ์** ก่อน sign-off A0 — rewrite ให้ครบทุกจุด (ทั้ง 2 variant)
- **revoke authenticated บน money RPC (must-fix #2)**: ใน 0046 เพิ่ม `revoke execute on function analytics.crm_overview_summary(uuid,date,date,text) from authenticated;` (คง service_role). `dashboard_summary`/`dashboard_charts` ถูก revoke ไปแล้ว (security fix PR #3) — 0046 ทำให้ครบทั้ง 3 · ดู A.4 สำหรับเหตุผล (gate = caller-supplied param → bypass ได้ถ้าเปิด authenticated)
- **0047 (reserve)**: ถ้าหลัง swap เจอ policy ขาด (query ว่างเปล่า) เพิ่ม policy ที่นี่ — ไม่ถอย service client (กติกา A.4)

---

## B. PII Retention

**ไม่ใช่สร้างใหม่ (F2)** — `0024_crm_b2c_pii_retention.sql` มี `analytics.crm_apply_pii_retention(interval)` + pg_cron `crm-pii-retention-180d` (daily 03:30) อยู่แล้ว. งาน = **verify + อุด gap**

### B1 — Verify job รันจริง (F4)
```sql
select jobname, schedule, active from cron.job where jobname = 'crm-pii-retention-180d';
select status, return_message, start_time from cron.job_run_details
  where jobid = (select jobid from cron.job where jobname='crm-pii-retention-180d')
  order by start_time desc limit 5;
```
- ถ้า `active=false`/ไม่มีแถว → extension/job ไม่ทำงาน แก้ที่นี่. (ตอนนี้ data ยังไม่เกิน 180 วัน → job รัน = 0 rows ปกติ แยกจาก "ไม่รัน" ด้วย job_run_details)

### B2 — Migration 0048: อุด gap scrub (F3)
0024 scrub เฉพาะ `import_status='transformed'` (excel) → แถว **pending/error + pdf** ค้าง PII plaintext ตลอดชีพ. แก้ `crm_apply_pii_retention`:
- scrub PII column (customer_name_raw/phone_raw/contact_display_name_raw + address ถ้ามี) ของ **ทุกแถว** ใน `stg_order_import` ที่ `created_at < now() - interval` **ไม่สนใจ import_status** (พ้น retention = PII ไปไม่ว่าจะ transform หรือไม่); เก็บ non-PII (revenue/channel/dedup_key/fact_order_id) ไว้เพื่อ audit/analytics
- `pii_customer` (canonical PII, F5): **policy decision** — เก็บไว้เพราะ CRM ต้องใช้ (owner/admin RLS กันอยู่แล้ว = risk ต่ำกว่า staging); retention ที่นี่ = debt (ถ้าจะทำ: scrub ลูกค้าที่ last_order เกิน N ปี) บันทึกไว้ ไม่ทำใน phase นี้
- **ห้ามแตะ fact_order/dim_customer** (F5 — ไม่มี PII ดิบ)

---

## C. Phase breakdown + ลำดับ (ห้ามสลับ)

| Phase | งาน | ความเสี่ยง |
|-------|-----|-----------|
| **A0** | apply 0046 (recursion fix + revoke authenticated บน money RPC) + bootstrap: สร้าง auth user เจ้าของใน Supabase + รัน provision-member script | **ต้องเสร็จก่อน A1 deploy** ไม่งั้นล็อกตัวเองออก |
| **A1** | `@supabase/ssr` + middleware + /login + getUserClient + sign-out — **additive ล้วน** (ยังใช้ service client/DEV context เดิม ทุกอย่างทำงานปกติ) | ต่ำ — ไม่เปลี่ยน behavior เดิม |
| **A2** | สร้าง lib/auth/context.ts + **ลบ lib/dev/context.ts** + swap seam/client ทุก action/page (compile error = checklist) | **สูง** — จุดพลิก; query ว่างเปล่า = RLS default-deny แก้ที่ policy |
| **A3** | verify RLS enforcement: owner เห็นข้อมูลครบ · staff เห็นจำกัด (money hidden) · cross-shop เข้าไม่ได้ · ทุกหน้า 200. **must-fix #3 — เทส bypass ตรงไม่ใช่แค่ UI:** ด้วย staff JWT จริง ยิง PostgREST ตรง `POST /rest/v1/rpc/dashboard_charts` (และ `dashboard_summary`, `crm_overview_summary`) body `{p_shop_id, p_include_money:true}` → **ต้องได้ execute denied / 401-403** (ไม่ใช่ payload เงิน); + staff อ่าน `analytics.pii_customer`, `stg_order_import` ตรง → ต้อง 0 rows (RLS). เก็บผลเป็น evidence | กลาง — ต้องเทสต์ทุก role + direct API |
| **B** | B1 verify cron + B2 apply 0048 scrub gap | ต่ำ |

**ลำดับบังคับ: A0 → A1 → A2 → A3 → B.** A1 deploy ได้แยก (ไม่กระทบ user) แต่ **A2 ต้องมี A0 (member + recursion fix) ก่อนเสมอ** ไม่งั้น deploy แล้วทุกคนเข้าไม่ได้

## D. ความเสี่ยง / debt (ตรงๆ)
- **Self-lockout** = ความเสี่ยงอันดับ 1 — provision member + apply 0046 ต้องเสร็จ **ก่อน** middleware บังคับ login
- **RLS default-deny หลัง swap** — policy/grant ที่ขาดจะทำให้ query ว่างเปล่าเงียบๆ (ไม่ error) → A3 ต้องเทสต์ทุกหน้า/ทุก role ไม่ใช่แค่ compile ผ่าน
- shop-switcher (multi-shop), invite UI, provision_shop RPC, pii_customer retention = **debt บันทึกไว้** (YAGNI — 3J shop เดียว ทีมเล็ก)
- **หมายเหตุ:** section 0–A.5 เขียนโดย architect (Yoda); A.6–D เขียนต่อโดย Tech Lead หลัง architect agent ล่ม (stalled) — formalize จาก findings F1–F7 ที่ architect วางไว้ ไม่ได้ redesign

## E. Open questions — **ตัดสินแล้ว 2026-08-15 (เจ้าของ)**
1. ✅ **`/stock/hero` = exempt** — เป็นจอ wall-display สาธารณะไม่ล็อกอิน → เพิ่มเข้า middleware matcher exception (คู่กับ `/shop`, `/api/webhooks`, `/login`, static). หน้านี้ไม่มีเงิน/PII อยู่แล้ว
2. **Rollback A2** — (ยังไม่ถึง A2 รอบนี้) เขียน rollback runbook ก่อน A2 deploy: revert deploy กลับ commit ก่อน A2 (service client เดิม); 0046/0047 (RLS) ไม่ต้องถอยเพราะไม่กระทบ service path
3. ✅ **PDPA erasure = เลื่อนไป phase หลัง** — auth ก่อน; `crm_forget_customer` RPC ไว้ทำหลัง auth เสร็จ (ต้องทำใน DB, บันทึกเป็น debt ที่ต้องปิดก่อน production จริง — PDPA ม.33)

### ขอบเขตรอบนี้ (เจ้าของเลือก): **A0 + A1 เท่านั้น** — additive/ปลอดภัย ยังไม่ swap client (A2 ยกยอด)
- **A0**: 0046 (RLS recursion fix — rewrite 76 policies ใน 13 migration + helper `auth_shop_ids`/`auth_has_role` + revoke authenticated บน `crm_overview_summary`) + `scripts/provision-member.mjs`
- **A1**: `@supabase/ssr` + `middleware.ts` (exempt /stock/hero,/shop,/api/webhooks,/login,static) + /login + `getUserClient()` + sign-out — ยังใช้ service client/DEV_ROLE เดิม ทุกอย่างทำงานปกติ
- **ยังไม่ทำ A2/A3**: ไม่ลบ lib/dev/context.ts, ไม่ swap seam/client — 0046 RLS rewrite เป็น prep (ไม่ถูก exercise จน A2 เพราะ service_role bypass), verify ด้วย simulated-auth test

## F. ข้อเสนอ verify เพิ่ม (review)
- **red-team (Vader) pressure-test RLS rewrite ก่อน A2 deploy** — จุดพังเงียบ (query ว่างไม่ error) อันตรายสุด; ให้ลอง cross-shop / staff escalation / direct-RPC bypass บน policy ใหม่

---

## G. Runbook — A2-lite (ด่าน login) — devops (Lando) · 2026-09-16

> ขอบเขตนี้ **ไม่ใช่ A2 เต็ม** ใน §A/§C ข้างบน (ยังไม่ swap seam เป็น `lib/auth/context.ts`, ยังไม่ลบ `lib/dev/context.ts`, ยังไม่ rewrite 76 policy, ทุกหน้ายังอ่าน service client + `DEV_ROLE`) — เป็นด่าน**login เฉพาะหน้า**ที่เจ้าของเคาะ 16 ก.ย. 69 เพื่อปิดช่อง `oms-3j.vercel.app` เปิดสาธารณะ (ดู memory `prod-exposure-accepted-risk`) ก่อน A2 เต็มจะเสร็จ — สลับปิด**พฤติกรรม middleware** ได้ด้วย env ตัวเดียว (ส่วน DB hardening 0122–0124 ด้านล่างไม่ผูกกับ flag นี้ และไม่ถอย)

### G.1 ภาพรวม (10 บรรทัด)

Backend/frontend กำลัง implement ใน worktree แยก: middleware อ่าน `AUTH_GATE` — `on` เท่านั้นที่เปิดด่าน ค่าอื่น/ไม่ตั้ง = ปิด (**fail-open โดยตั้งใจ** เพราะโปรดักชันวันนี้ไม่มี auth user เลย ปิดพลาดปลอดภัยกว่าเปิดพลาด) เมื่อเปิด: ไม่มี session → เด้ง `/login`; มี session แต่ไม่มีแถวใน `shop_member` → เด้ง `/pending` (โชว์รหัสยืนยัน **6 ตัวอักษร hex (0-9, A-F) จาก HMAC** ให้พนักงานบอกเจ้าของ — เห็นได้เฉพาะฝั่งพนักงานหน้า `/pending` เท่านั้น) พนักงานใหม่สมัครเองที่ `/register` เจ้าของอนุมัติที่ `/settings/members` โดยกรอกรหัส 6 ตัวอักษรที่พนักงานเห็นหน้า `/pending` เจ้าของ**เลือกปิด** "Confirm email" ของ Supabase Auth (ทีมแนะนำเปิด — มติเจ้าของ 16 ก.ย. 69 เพราะช่องโหว่ปิดด้วยรหัส 6 หลักแทนอยู่แล้ว: คนสุ่มสมัครเข้ามาได้ แต่ **เข้าระบบจริงไม่ได้จนกว่าเจ้าของกรอกรหัสอนุมัติ**) DB schema (`shop_member`) มีอยู่แล้วตั้งแต่ 0002 · เพิ่มเติมรอบนี้: migration 0122–0124 ปิดช่อง REST ตรง (ดู G.4 ก่อนขั้นเปิด flag) — rollback ของ flag เองยังปิด = ปิด middleware เท่านั้น ไม่แตะ DB สิ่งที่**ไม่เปลี่ยน**: ทุกหน้ายังอ่านผ่าน service client + `DEV_ROLE` เหมือนเดิม ⇒ ใครก็ตามที่เจ้าของอนุมัติเข้าระบบได้ (ผ่าน login gate) จะยังเห็นทุกอย่างรวมต้นทุน/PII เหมือนวันนี้ทุกประการ — ด่านนี้กันแค่ "คนแปลกหน้าที่ไม่มีบัญชี" ไม่กันสิทธิ์ระหว่างพนักงานด้วยกันเอง (นั่นคือ A2 เต็ม)

### G.2 ตาราง env

| ชื่อ | ที่ตั้ง | ค่า / ที่มา | ใครใส่ |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel (Production env) + `.env.local` | Supabase dashboard → Project Settings → API → Project URL (ค่าเดียวกับ `SUPABASE_URL` ที่มีอยู่แล้ว) | devops ใส่บน Vercel · แต่ละคนใส่เองใน `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel (Production env) + `.env.local` | Supabase dashboard → Project Settings → API → มี **legacy anon key** และ **publishable key** อยู่แล้วสองแบบ — ใช้ตัวที่ label ว่า `anon` `public` (ไม่ใช่ `service_role`) **ห้ามใส่ค่าจริงลงเอกสาร/commit** | devops ใส่บน Vercel · แต่ละคนใส่เองใน `.env.local` |
| `AUTH_GATE` | Vercel (Production env) เท่านั้น | `on` = เปิดด่าน · ไม่ตั้ง/ค่าอื่น = ปิด (fail-open) | devops — **ตั้งเป็นขั้นตอนสุดท้าย (bootstrap ข้อ 6) เท่านั้น ห้ามตั้งพร้อม deploy ข้อ 1** |
| `SIGNUP_CODE_SECRET` | Vercel (**ทุก environment**) — optional | ใช้เข้ารหัส HMAC สร้างรหัสยืนยัน 6 ตัวอักษร — ถ้าไม่ตั้ง fallback ใช้ service key แทน | devops — **ถ้าตั้งต้องตั้งค่าเดียวกันทุก environment (Production/Preview/Development) ไม่งั้นรหัสที่คำนวณแต่ละฝั่งไม่ตรงกัน พนักงานยืนยันไม่ผ่าน** |

ตัวที่มีอยู่แล้วไม่ต้องเพิ่ม: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (ใช้โดย `provision-member.mjs` และทุก server action วันนี้อยู่แล้ว)

### G.3 Checklist Supabase Auth settings (dashboard → Authentication)

- [ ] Site URL = `https://oms-3j.vercel.app`
- [ ] Redirect URLs มี `https://oms-3j.vercel.app/**` และ `http://localhost:3000/**`
- [ ] Email signup = **ON**
- [ ] Confirm email = **OFF** (มติเจ้าของ 16 ก.ย. 69 — บันทึกไว้ที่นี่ ไม่ใช่แค่ในแชท)
- [ ] Minimum password length = **8**
- [ ] Anonymous sign-ins = **OFF**
- [ ] Rate limit signup — ตรวจว่าเป็นค่า default ของ Supabase (ไม่ได้ถูกปรับสูง/ต่ำผิดปกติจากงานอื่น)

### G.4 Bootstrap — ลำดับห้ามสลับ (กันล็อกตัวเอง)

| # | งาน | ใครทำ | วิธีตรวจว่าผ่าน |
|---|---|---|---|
| 1 | Merge branch backend/frontend เข้า main + deploy ขึ้น Vercel **โดยยังไม่ตั้ง `AUTH_GATE`** | Tech Lead (merge) + devops (deploy) | เว็บ prod ใช้งานได้ปกติเหมือนก่อน merge ทุกหน้า — เพราะ flag ยังไม่ตั้ง = fail-open; เปิด `/login`, `/register`, `/pending` แบบ incognito ต้องเข้าได้ (ยังไม่ต้อง auth ทำงานจริง แค่หน้าต้องไม่ 404/500) |
| 2 | ใส่ `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `NEXT_PUBLIC_SUPABASE_URL` บน Vercel (Production) + redeploy | devops | `vercel env ls` เห็นทั้งสองตัวใน Production · หน้า `/login` ยิง `signInWithPassword` แล้วได้ error ที่มาจาก Supabase จริง (เช่น "Invalid login credentials") ไม่ใช่ error "supabaseUrl is required" |
| 3 | สร้าง auth user ของเจ้าของ — Supabase dashboard → Authentication → Users → Add user (auto-confirm) | เจ้าของ หรือ Tech Lead ผ่าน admin API | user โผล่ในลิสต์ Users พร้อม email ที่ถูกต้อง, `email_confirmed_at` ไม่ null |
| 4 | `node --env-file=.env.local scripts/provision-member.mjs <email เจ้าของ> owner` | Tech Lead (มี `.env.local` ชี้ project เดียวกับ prod — โปรเจกต์นี้ dev/prod ใช้ Supabase project เดียวกัน) | เห็น log `✓ provisioned <email> as owner on shop "..."` · ตรวจซ้ำด้วย query `select * from shop_member where user_id = '<uid จากข้อ 3>'` ต้องเจอ 1 แถว role=owner |
| 5 | เจ้าของทดสอบ `/login` (ล็อกอินด้วยบัญชีข้อ 3) และ `/settings/members` บน prod **ขณะ gate ยังปิด** | เจ้าของ (กด), devops คอยดู log Vercel | ล็อกอินสำเร็จ, เห็นหน้า `/settings/members` ไม่ error; **ถ้าพัง ให้หยุดที่นี่** — อย่าไปข้อ 6 |
| 5.5 | ยืนยัน migration `0122_shop_member_select_only` / `0123_analytics_no_rest_for_users` / `0124_public_no_rest_for_users` apply แล้ว | devops | ✅ **ทำแล้ว 16 ก.ย. 69** — `list_migrations` เห็นทั้ง 3 ฉบับ (version 20260916145243/…145306/…145354); user login ยิง REST ไป `fact_order` / `v_dim_product(unit_cost)` / `product(unit_cost)` / `shop_member` (นอกแถวตัวเอง) ต้องได้ 403 ทั้งหมด |
| 6 | ตั้ง `AUTH_GATE=on` บน Vercel (Production) + redeploy | devops | deploy สำเร็จ (build เขียว) |
| 7 | ทดสอบ incognito 3 เคส: (ก) ไม่ล็อกอิน เข้า `/dashboard` ต้องเด้ง `/login` (ข) ล็อกอินด้วยบัญชีเจ้าของ (ข้อ 3) ต้องเข้า `/dashboard` ได้ปกติ (ค) สมัครบัญชีใหม่ผ่าน `/register` ต้องเด้งไป `/pending` พร้อมเห็นรหัส 6 หลัก **ไม่ใช่** เด้งวนกลับ `/login` | devops + เจ้าของ | ครบ 3 เคสตามที่คาด — เคส (ค) สำคัญสุด เพราะถ้า `/register`/`/pending` ไม่อยู่ใน matcher exemption ของ middleware จะเกิด redirect loop (ดู G.7 ข้อ 1) |

**Rollback**: ลบ/แก้ `AUTH_GATE` บน Vercel ให้ไม่ใช่ `on` (เช่นลบ env ทิ้ง) + redeploy — กลับเป็น fail-open ทันที ใช้เวลา < 2 นาที (เวลา build+deploy ของ Vercel) rollback นี้คืนได้เฉพาะพฤติกรรม middleware — **ฝั่ง DB (0122–0124) ไม่ย้อนและไม่ควรย้อน** (เป็นการปิดช่องที่ควรปิดอยู่แล้วไม่ว่า gate จะเปิดหรือปิด) ถ้าจำเป็นจริงต้องเขียน migration ใหม่เท่านั้น ห้ามแก้ย้อนประวัติ เงื่อนไขที่ควร rollback: ข้อ 7 เคสไหนก็ตามไม่ผ่าน, หรือเจ้าของ/พนักงานล็อกอินไม่ได้หลังเปิดจริง

### G.5 Runbook รับ/ถอดพนักงาน (หลังเปิด gate)

**รับพนักงานใหม่**
1. พนักงานสมัครเองที่ `/register` (email + password ≥ 8 ตัว)
2. ระบบพาไป `/pending` — พนักงานเห็นรหัสยืนยัน **6 ตัวอักษร (hex, 0-9/A-F)** บอกรหัสนี้กับเจ้าของ (โทร/แชท — คนละช่องกับที่สมัคร กันคนแอบสมัครแทน)
3. เจ้าของเข้า `/settings/members` กรอกรหัส 6 ตัวอักษร → อนุมัติ (สร้างแถว `shop_member`)
4. พนักงาน refresh `/pending` หรือ login ใหม่ → เข้าใช้งานได้

**ถอดพนักงาน**
- `/settings/members` มีปุ่มถอดสมาชิกแล้ว (ship แล้ว) — กันลบตัวเอง/owner คนสุดท้ายในระบบ ใช้ปุ่มนี้เป็นทางหลัก
- ปิดบัญชีถาวร (ลาออก): กดปุ่มถอดข้างบน **แล้วเพิ่ม** ลบ/แบน auth user ที่ dashboard → Authentication → Users ด้วย ไม่งั้นบัญชียังสมัครกลับเข้า `/pending` ได้เรื่อยๆ (ไม่มีสิทธิ์ก็จริง แต่รกลิสต์รออนุมัติ)

**ลืมรหัสผ่าน**: ยังไม่มีหน้า self-service (debt) — ทำผ่าน Supabase dashboard → Authentication → Users → เลือก user → Reset password ชั่วคราว

### G.6 Debt list

- ไม่มีหน้า "ลืมรหัสผ่าน" — ทำผ่าน dashboard เท่านั้น
- middleware ยิง query `shop_member` ทุก request ไม่มี cache — เลือก fail-closed ชนะ latency ตั้งใจ แต่เป็น debt ด้าน performance ที่ควรกลับมาแก้
- `/stock/hero` ยังเปิดสต็อก/รายชื่อ SKU ให้คนไม่ login เห็นได้ (ดีไซน์ตั้งใจ เพื่อโชว์จอไลฟ์) — ควรใส่ token/สิทธิ์จำกัดในเฟสถัดไป
- `requireSessionIfGateOn` เช็คแค่ "มี session" ไม่เช็คว่าอนุมัติหรือ role อะไร — role ยังมาจาก env จนกว่า A2 เต็ม
- เลข migration ชนกับ `0120_crm_retention` (branch `feature/crm-retention` apply ไปแล้วแต่ยังไม่ merge) — ต้อง rename เลขตอน merge กันซ้ำ
- SMTP built-in ของ Supabase จำกัด **2 อีเมล/ชั่วโมง** — วันนี้ไม่กระทบเพราะ Confirm email ปิด (ไม่ส่งเมลตอนสมัคร) แต่ถ้าอนาคตเปิดฟีเจอร์ "ลืมรหัสผ่าน" แบบ self-service หรือเปิด Confirm email กลับ ต้องมี custom SMTP ก่อน ไม่งั้นพนักงาน >2 คน/ชม. จะรอเมลไม่ได้
- ทุกหน้ายังอ่านผ่าน service client + `DEV_ROLE` — ด่าน login รอบนี้ไม่ได้แบ่งสิทธิ์ staff/owner จริง (คนละเรื่องกับ A2 เต็มใน §A/§C) ห้ามสื่อสารกับผู้ใช้ว่า "role ป้องกันข้อมูลแล้ว"
- rollback ปิด gate ได้ แต่บัญชีที่สมัครผ่าน `/register` ระหว่างเปิด gate จะยังอยู่ใน `auth.users` (และอาจมี `shop_member` ถ้าอนุมัติไปแล้ว) — ไม่ auto-cleanup ตอน rollback ต้องเก็บกวาดเอง

### G.7 ห้ามเปิด `AUTH_GATE=on` ถ้า…

1. Bootstrap ข้อ 4 (provision เจ้าของเป็น `owner`) ยังไม่ผ่านการตรวจซ้ำด้วย query — เพราะถ้าเปิด gate แล้วเจ้าของไม่มีแถวใน `shop_member` เจ้าของจะตกไป `/pending` และ**ไม่มีใครอนุมัติได้** (ต้องมี owner อยู่ก่อนแล้วถึงจะอนุมัติคนต่อไปได้) — ล็อกตัวเองออกจากระบบทั้งระบบ กู้คืนได้ทางเดียวคือ rollback flag แล้วกลับไปทำข้อ 4 ใหม่
2. `NEXT_PUBLIC_SUPABASE_ANON_KEY` ยังไม่ยืนยันว่าตั้งถูกบน Vercel Production (ไม่ใช่แค่ local) — ไม่งั้น `/login` จะพังทันทีที่ gate บังคับทุกคนผ่านมันหรือ `/register`/`/pending` ที่ backend/frontend ยังไม่ยืนยันว่าอยู่ใน matcher exemption ของ middleware — ทดสอบ bootstrap ข้อ 7 เคส (ค) ให้ผ่านก่อนเสมอ ไม่ใช่แค่เคส (ก)/(ข) ไม่งั้นพนักงานสมัครใหม่จะเจอ redirect loop และเจ้าของจะเจอ report "เข้าเว็บไม่ได้" เป็นชุดหลังเปิด gate
3. Bootstrap ข้อ 5 (เจ้าของทดสอบ `/login`/`/settings/members` ขณะ gate ปิด) ยังไม่ผ่าน — ยิ่งพังตอนนี้ (gate ปิด, service client ยังทำงานปกติ) ยิ่งง่ายต่อการแก้กว่าไปเจอตอน gate เปิดแล้วทุกคนเข้าไม่ได้

**หมายเหตุจาก devops**: ข้อ G.7.2 ส่วน matcher exemption ของ `/register`/`/pending` เป็นสิ่งที่ผมตรวจโค้ดจริงไม่ได้ (อยู่ใน worktree ที่ backend/frontend กำลังทำ ไม่ได้ merge เข้ามาตอนเขียน runbook นี้) — เทียบกับ `middleware.ts` ที่มีอยู่วันนี้ (A1, ดู G.1) matcher exempt แค่ `/login`, `/shop`, `/api/webhooks`, `/stock/hero`, static/`_next` เท่านั้น **ยังไม่มี** `/register`/`/pending` — ถ้าโค้ดใหม่ไม่เพิ่มสองเส้นทางนี้เข้า matcher (หรือเทียบเท่า) การสมัครพนักงานใหม่จะวนลูปตั้งแต่ deploy แรก ขอให้ Tech Lead ให้ code-reviewer ตรวจจุดนี้ชัดๆ ก่อน merge ไม่ใช่ปล่อยให้ bootstrap ข้อ 7 เป็นด่านแรกที่เจอ

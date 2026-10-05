# Design: แบบทดสอบเลือกพลอย (Gem Quiz) — หน้าสาธารณะผ่าน QR บนการ์ดขอบคุณ

> ⚠️ **5 ต.ค. 69: เจ้าของส่งแพ็กเกจ UI/UX ภายนอกมา + เคาะใหม่เป็น 5 พลอย (ไม่ใช่ 12)**
> **ถูกแทนบางส่วนโดย [`design-gem-quiz-v2-reconcile.md`](./design-gem-quiz-v2-reconcile.md)**: §3.1 (seed 12 พลอย) · §4.2 (flow) · §4.3 (slot หน้าผล) · §4.4 (Q1 ไม่มีผลคะแนน) · §7 (section หน้าสถิติ)
> ส่วนที่**ยังมีผลเต็ม ไม่เปลี่ยน**: §1 (F1-F14) · §1.2 (ห้าม Server Action ในหน้า public) · §2 · §5 (anti-bot ทั้ง 4 ชั้น) · §6 (QR)
> อ่าน v2-reconcile ก่อนถ้างานตรงหน้าเกี่ยวกับ data model/UI/scoring ของ gem quiz
>
> ผู้ออกแบบ: architect (Yoda) · 4 ต.ค. 2569 · สถานะ: **design เท่านั้น ยังไม่ implement ยังไม่ apply migration**
> มีคำถามเปิดที่ต้องเคาะก่อนเริ่ม §11 (ข้อ **B1-B4 บล็อกการเริ่มเขียนโค้ด** · ข้อ **P1 บล็อกการสั่งพิมพ์การ์ด**) — **B1-B4 ถูกเคาะใหม่แล้วใน v2-reconcile (ดูด้านบน)**
>
> มติเจ้าของที่ยึด (ห้ามเปลี่ยน): (1) ไม่เก็บตัวตนลูกค้าเลย (2) ปุ่มชวนเพื่อนไม่มี incentive
> (3) คำถามแรก = "ชอบพลอยอะไร" แบบไม่ชี้นำ (4) สถิติดูภายในเท่านั้น
> กฎเนื้อหา: `3j-brand-and-market` §5 (ห้ามรับประกันผล/ห้ามมุมพลอยเสก) · ธุรกิจในเครืออื่นห้ามอยู่ในหน้านี้

---

## 0. TL;DR

- **หน้า `/gem-quiz`** อยู่ใน route group ใหม่ `app/(quiz)/` (ไม่ใช้ layout ของ `(public)` เพราะ footer ผูกกับ `/shop`)
  **ต้องแก้ `middleware.ts` matcher + `lib/auth/exempt-path.ts` คู่กัน** — โค้ดจริงตอนนี้ exempt แค่ `/shop`, `/stock/hero`, `/api/webhooks`
  route ใหม่ที่ไม่แก้ matcher **จะโดนเด้งไป `/login` ทันทีบน prod (AUTH_GATE=on)**
- **ทางเขียนข้อมูล = Route Handler `POST /api/gem-quiz/submit`** (ไม่ใช่ Server Action) → เรียก RPC `analytics.gem_quiz_submit` ด้วย service role
  เหตุผล: หน้า exempt ที่มี Server Action ในตัว = ช่อง POST ที่ไม่ผ่าน middleware (§1.2) · route handler คุม body size/origin ได้ชัด · ยิงทดสอบด้วย curl ได้
- **Data**: สคีมา `analytics` (ปิด REST ให้ anon/authenticated ทั้งสคีมาแล้วตั้งแต่ 0123 + มีสคริปต์กวาด grant ครอบอัตโนมัติ)
  ตาราง lookup `gem_quiz_stone` + ตารางคำตอบ `gem_quiz_response` (ไม่มีคอลัมน์ IP/UA/token/ข้อความอิสระเลย)
- **Anti-bot phase 1 = ไม่เก็บอะไรที่ระบุเครื่อง/คน**: signed form token (กันส่งเร็วผิดมนุษย์ + ต้องโหลดหน้าก่อน) + honeypot + circuit breaker รวมทั้งร้านใน RPC + ธง retake จาก localStorage
  **per-IP hash ออกแบบไว้แต่ไม่เปิดใน phase 1** — เพราะ IP hash ที่เราถือ pepper = ข้อมูลแฝงตัวตน (pseudonymous) ขัดเหตุผลของมติข้อ 1 (§5.4, คำถาม D1)
- **QR = static QR ลิงก์เดียวทุกออเดอร์** + `?src=card` (แยก "ผู้ซื้อแล้ว" ออกจาก "เพื่อนที่ถูกชวน" ในสถิติ) · **ห้ามใช้ dynamic-QR SaaS**
  🔴 **โดเมนที่จะพิมพ์ต้องเคาะก่อนพิมพ์** — ตอนนี้แอปอยู่ที่ `oms-3j.vercel.app` (§6, คำถาม P1)
- **หน้าสถิติ `/marketing/gem-quiz`** หลัง gate เดิม (pattern เดียวกับ `/marketing/content/history`) อ่านผ่าน RPC `gem_quiz_stats` คืน jsonb ก้อนเดียว

---

## 1. ข้อเท็จจริงจากโค้ดจริงที่ design นี้ยึด (ไม่ได้เดา)

| # | สิ่งที่เจอ | ที่ไหน | ผลต่อ design |
|---|---|---|---|
| F1 | `config.matcher` exempt แค่ `_next/*`, `favicon`, `api/webhooks`, `shop`, `stock/hero`, ไฟล์รูป — ทุกอย่างที่เหลือโดน gate (no session → 302 `/login`) | `middleware.ts:208-210` | route ใหม่ต้องเพิ่มใน matcher ไม่งั้นลูกค้าสแกนแล้วเจอหน้า login |
| F2 | regex ใน matcher ต้อง sync มือกับ `isExemptPath()` และมี test ดัก prefix look-alike (`/shopee-import`) | `lib/auth/exempt-path.ts` + `.test.ts` | ต้องแก้ 3 ไฟล์คู่กัน + เพิ่ม negative test |
| F3 | middleware คุม Server Action ด้วย **path ของหน้า** (คอมเมนต์หัวไฟล์ยืนยัน) · Next 15.5.25 ถ้า action ID ไม่อยู่ใน worker ของหน้านั้น จะ **forward ด้วย HTTP fetch กลับเข้า origin** (`selectWorkerForForwarding` / `createForwardedActionResponse` ใน `next/dist/server/app-render/action-handler.js`) ⇒ request ที่ forward ไปผ่าน middleware ของ path ปลายทางอีกรอบ | middleware.ts หัวไฟล์ + node_modules/next | action **ภายใน worker ของหน้า exempt** รันได้โดยไม่ผ่าน middleware ⇒ หน้า `/gem-quiz` ต้อง**ไม่มี "use server" module ใดๆ ใน module graph** (§1.2) |
| F4 | `getEffectiveRole()` ไม่มี session + AUTH_GATE=on → `"staff"` | `lib/auth/role.ts` | ชั้นที่สองกันไว้: ต่อให้ action ภายในหลุดมาถูกเรียก ก็ตก `requireOwnerAdmin` |
| F5 | สคีมา `analytics`: anon/authenticated ไม่มี USAGE · ตารางใหม่ grant `service_role` อย่างเดียว · `crm_require_owner_admin` short-circuit เมื่อ `auth.role()='service_role'` | 0122-0124, 0145, 0148, 0021, skill traps #18 | RPC ฝั่งสาธารณะ "ไม่มีด่าน owner" โดยออกแบบ — ด่านจริงคือ route handler + grant |
| F6 | `/shop` ใช้ anon key อ่าน view `shop_catalog` ใน `public` (read-only) | `lib/actions/shop-catalog.ts` | ทางอ่านสาธารณะมี precedent แต่**ทางเขียนสาธารณะยังไม่เคยมี** — นี่คือตัวแรก |
| F7 | ไม่มี rate-limit infra ใดๆ ในรีโป (ไม่มี Upstash/KV/ตาราง bucket) | grep ทั้ง `lib/`, migrations | ห้ามพึ่ง in-memory (serverless หลาย instance) |
| F8 | `serverActions.bodySizeLimit: "4mb"` ตั้ง global | `next.config.mjs` | อีกเหตุผลที่ไม่ใช้ Server Action สำหรับ endpoint สาธารณะ |
| F9 | root `metadata` = `"3J Insight"` / `"CRM · การตลาด · วิเคราะห์ยอดขาย — สมองกลางของ 3J Jewelry"` | `app/layout.tsx` | หน้า quiz **ต้อง override title/description/openGraph เอง** ไม่งั้น LINE preview ตอนแชร์โชว์คำอธิบายระบบภายใน |
| F10 | `(public)/layout.tsx` footer = ข้อความเรื่องยืนยันราคาก่อนสั่งซื้อ + header tagline "ไม่แพ้ผิว" | `app/(public)/layout.tsx` | ไม่เหมาะกับหน้า quiz (เรื่องราคาไม่เกี่ยว + "ไม่แพ้ผิว" เป็นเคลมเชิงสุขภาพบนหน้าที่ต้องระวังเคลมอยู่แล้ว) — *ข้อสังเกตนอกขอบเขต: tagline นี้บน `/shop` ควรให้สาย content ตรวจด้วย* |
| F11 | แอปเสิร์ฟที่ `oms-3j.vercel.app` | `docs/3j-jewelry/web/shop-route-design.md` | URL บน QR จะเผยชื่อ "oms" + ผูกกับชื่อ Vercel project (§6) |
| F12 | migration ล่าสุด `0153` · ค้นทุก branch แล้ว **ไม่มีใครจอง 0154+** · ไม่มีชื่อ `quiz`/`survey`/`gem_` ชนในรีโป | `git log --all` | ใช้ prefix `gem_quiz_` ได้ (ยืนยันเลขอีกครั้งตอน implement) |
| F13 | หน้าเว็บแคตตาล็อก `/shop` = แบบ OEM คนละชุดกับของที่ขายในไลฟ์ (memory `3j-website-seo-positioning`) | memory | CTA หน้าผลลัพธ์**ไม่ควรลิงก์ไป `/shop` แบบตรงๆ** (คำถาม C1) |
| F14 | PostgREST ของโปรเจกต์นี้ตัดที่ max-rows 1000 แบบเงียบ (เคยทำยอดหาย ฿9,423) | `lib/supabase/query-limits.ts` | สถิติต้องรวมใน DB ไม่ดึงแถวดิบมารวมใน TS |

### 1.2 ทำไม F3 สำคัญ — ช่องที่หน้า exempt เปิดโดยไม่ตั้งใจ

เมื่อ `/gem-quiz` ถูก exempt, middleware **ไม่รันเลย** สำหรับทุก request ที่ path นี้ รวมถึง POST ที่แนบ header `Next-Action`
- action ที่ **ไม่อยู่** ใน worker ของหน้า → Next forward ไป path เจ้าของ → ผ่าน middleware → เด้ง login ✅
- action ที่ **อยู่** ใน worker ของหน้า (เพราะหน้า import ไฟล์ `"use server"` ไฟล์ใดไฟล์หนึ่ง — **export ทุกตัวในไฟล์นั้นติดมาด้วย**) → **รันตรง ไม่ผ่าน middleware** เหลือแค่ด่าน `requireOwnerAdmin` ชั้นเดียว

⇒ **กฎโครงสร้าง (ไม่ใช่วินัย)**: ทุกไฟล์ใต้ `app/(quiz)/` และ `lib/gem-quiz/` ห้าม import ไฟล์ที่มี `"use server"` · ทางเขียนเดียวคือ `fetch('/api/gem-quiz/submit')`
ให้ code-reviewer เช็คด้วย grep หา `use server` / `lib/actions` ใต้ `app/(quiz)` และ `lib/gem-quiz` ต้องว่าง (และ security ยิงทดสอบ §5.5 ข้อ R-9)
*(หมายเหตุ: `/stock/hero` เป็นหน้า exempt ที่มี server action อยู่แล้ววันนี้ — รอดเพราะ `requireOwnerAdmin` ชั้นเดียว · ไม่อยู่ในขอบเขตงานนี้ แต่ security ควรรู้)*

---

## 2. Design overview + data flow

```
[การ์ดขอบคุณในพัสดุ] --QR--> https://<โดเมนที่เคาะ P1>/gem-quiz?src=card
                                        |
                       middleware: path exempt (ไม่รัน gate)
                                        |
   GET /gem-quiz  (server component, force-dynamic)
     - ออก form token = issuedAt + HMAC(GEM_QUIZ_TOKEN_SECRET)
     - render GemQuizClient (client component) + config (คำถาม/ตัวเลือก ไม่มีราคา)
                                        |
   [Q1 ชอบพลอยอะไร (ไม่ชี้นำ, สลับลำดับ)] -> [คำถามแนะนำ 1-2 ข้อ] -> คำนวณผลฝั่ง client (แสดงทันที)
                                        |
   POST /api/gem-quiz/submit   { v, src, token, hp, liked[], answers{}, retake }
     1. method/size/origin  2. honeypot / token age (เร็วเกิน = ทิ้งเงียบ 204)
     3. validate กับ config เวอร์ชันปัจจุบัน (whitelist)  4. คำนวณ recommended ใหม่ฝั่ง server (ไม่เชื่อ client)
     5. getServiceClient().schema("analytics").rpc("gem_quiz_submit", ...)  -- shop_id จาก getDevShopId()
                                        |
   analytics.gem_quiz_submit (security definer, grant service_role เท่านั้น)
     - validate ซ้ำแบบ shape + whitelist รหัสพลอยจาก gem_quiz_stone + circuit breaker -> insert 1 แถว
                                        |
   [หน้าผลลัพธ์แสดงอยู่แล้วตั้งแต่ขั้นก่อน — การบันทึกล้มเหลว ไม่บล็อกผลลัพธ์]

[เจ้าของ/CMO] -> /marketing/gem-quiz (gate เดิม + getEffectiveRole) -> lib/actions/gem-quiz-stats.ts
             -> analytics.gem_quiz_stats(shop, from, to, include_retake) -> jsonb
```

**หลักที่ถือตลอด**: ผลลัพธ์ที่ผู้ใช้เห็น **ไม่ขึ้นกับ DB** (submit พัง/โดน 429 ผู้ใช้ก็ยังได้ผล) · DB **ไม่มีทางเก็บข้อความอิสระ** (ทุกคำตอบเป็นรหัส slug)

---

## 3. Data model (sketch ระดับ design — คนเขียน migration จริงต้องทำตาม `3j-migration-traps` ครบ)

ไฟล์: `supabase/migrations/0154_gem_quiz.sql` (ไฟล์เดียว additive ล้วน · LF · idempotent)

### 3.1 `analytics.gem_quiz_stone` — lookup รายชื่อพลอย (pattern เดียวกับ `content_type` 0145)

| คอลัมน์ | ชนิด | หมายเหตุ |
|---|---|---|
| `code` | `text primary key` | slug เช่น `blue_topaz` — check `code ~ '^[a-z][a-z0-9_]{1,31}$'` |
| `label_th` | `text not null` | ชื่อที่โชว์ (เจ้าของยืนยันการสะกด — คำถาม B2) |
| `price_group` | `smallint not null check (price_group in (1,2))` | ใช้ cross-tab ภายในเท่านั้น **ไม่ส่งไปหน้าสาธารณะ** |
| `sort_order` | `int not null default 100` | |
| `is_active` | `boolean not null default true` | ปิดพลอยที่เลิกขายโดยไม่ทำให้ประวัติเสีย |

seed 12 แถว (รหัสเสนอ — label ตามที่เจ้าของให้มา):
กลุ่ม 1: `blue_topaz` บลูโทพาส · `amethyst` อเมทิส · `peridot` เพอริดอท · `citrine` ซิทริน · `garnet` โกเมน
กลุ่ม 2: `pearl` มุก · `nil` นิล · `ruby` ทับทิม · `sapphire` ไพลิน · `busarakham` บุษ(ราคัม) · `iolite` ไอโอไลท์ · `kyanite` ไคยาไนท์

### 3.2 `analytics.gem_quiz_response` — 1 แถว = 1 ครั้งที่ทำเสร็จ

| คอลัมน์ | ชนิด | constraint / เหตุผล |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | ไม่ส่งคืนให้ client (ไม่มีประโยชน์ + ไม่ให้เป็น handle) |
| `shop_id` | `uuid not null references public.shop(id) on delete cascade` | มาจาก `getDevShopId()` ฝั่ง server เท่านั้น |
| `created_at` | `timestamptz not null default now()` | สถิติรายวันต้องแปลง `at time zone 'Asia/Bangkok'` (trap #6) |
| `quiz_version` | `smallint not null check (quiz_version between 1 and 100)` | ชุดคำถาม/mapping เปลี่ยน → ข้อมูลเก่ายังตีความได้ |
| `src` | `text not null check (src in ('card','share','live','direct'))` | แหล่งที่มา — **ไม่ใช่ตัวตน** (ทุกการ์ดใช้ค่าเดียวกัน) |
| `liked_stone_codes` | `text[] not null check (cardinality(liked_stone_codes) <= 3)` | คำตอบ Q1 · `{}` = "ยังไม่มีในใจ" (ถ้าเจ้าของเปิดตัวเลือกนี้ — B1) |
| `answers` | `jsonb not null default '{}'` check `jsonb_typeof(answers)='object' and pg_column_size(answers) <= 512` | คำถามแนะนำ `{question_code: option_code}` |
| `recommended_stone_codes` | `text[] not null check (cardinality(...) between 1 and 2)` | ผลที่ระบบแนะนำ (1 หรือ 2 ตาม B4) |
| `is_retake` | `boolean not null default false` | ธงจาก localStorage ของเครื่องผู้ตอบ — สถิติ default ไม่นับ |

index: `(shop_id, created_at desc)` อย่างเดียว (scale หลักพันแถว/ปี ไม่ต้อง GIN)
RLS: `enable row level security` + policy `tenant_isolation_select` เผื่ออนาคต (pattern 0148) · `grant select ... to service_role` **อย่างเดียว** · ไม่ grant insert ให้ใคร (เขียนผ่าน RPC owner เท่านั้น)
⚠️ implementer: หลัง create ให้ query `information_schema.role_table_grants` ยืนยันว่า service_role ได้ **SELECT อย่างเดียว** (ถ้า default privilege แจก INSERT มาด้วย ให้ revoke — ทางเขียนต้องมีทางเดียว)

**สิ่งที่จงใจไม่มีในตาราง**: IP, IP hash, user agent, token, cookie id, ข้อความอิสระ, วันเกิดเต็ม (ถ้าจะถามเรื่องเกิด ให้ถามแค่ "เดือน" หรือ "วันในสัปดาห์" อย่างใดอย่างหนึ่ง)

### 3.3 RPC `analytics.gem_quiz_submit` — contract

```sql
analytics.gem_quiz_submit(
  p_shop_id uuid, p_quiz_version smallint, p_src text,
  p_liked_stone_codes text[], p_answers jsonb,
  p_recommended_stone_codes text[], p_is_retake boolean
) returns void
language plpgsql security definer
set search_path to 'public','analytics','extensions','pg_temp'
-- revoke execute ... from public, anon, authenticated;  grant execute ... to service_role;
```

**ไม่เรียก `crm_require_owner_admin`** — เป็น RPC สาธารณะโดยออกแบบ (และฟังก์ชันนั้น short-circuit service_role อยู่แล้ว เรียกไปก็ไม่ได้อะไร) ⇒ ต้องเขียนเหตุผลนี้ไว้ในหัวไฟล์ให้ security เห็นชัด

ด่านใน RPC (defense-in-depth — route handler ตรวจก่อนแล้ว แต่ DB ต้องไม่เชื่อ caller):
1. ทุกพารามิเตอร์ not null · `p_quiz_version` 1..100
2. `p_src` อยู่ใน whitelist 4 ค่า
3. `p_liked_stone_codes`: ไม่มี null element · ไม่ซ้ำ (`cardinality = count(distinct)`) · ≤ 3 · ทุกตัวมีใน `gem_quiz_stone where is_active`
4. `p_recommended_stone_codes`: 1..2 ตัว · ไม่ซ้ำ · มีจริงใน lookup
5. `p_answers`: `jsonb_typeof = 'object'` (trap #13 — ห้ามใช้ `is not null`) · ≤ 5 key · ทุก key `~ '^[a-z][a-z0-9_]{0,31}$'` · ทุก value `jsonb_typeof = 'string'` และ `~ '^[a-z0-9_]{1,32}$'`
   ⇒ **DB ปฏิเสธข้อความอิสระเกือบทุกรูปแบบ** (ภาษาไทย ช่องว่าง ขีด เครื่องหมาย ไม่ผ่าน regex) — ด่านกัน PII หลุดเข้าตารางที่ไม่พึ่งวินัยฝั่งแอป
   *(ข้อจำกัดที่ยอมรับ: เลขล้วนยาว ≤ 32 ตัวผ่าน regex ได้ แต่ route handler ตรวจ value กับ option whitelist ของ config ก่อนถึง DB อยู่แล้ว)*
6. **circuit breaker**: `count(*) where shop_id = p_shop_id and created_at > now() - interval '10 minutes'` ≥ `CAP` → `raise ... using errcode = 'P0001'` (route handler แปลงเป็น 429)
   ค่า CAP เสนอ 100 (ฐาน ~11 ออเดอร์/วัน ⇒ ปกติไม่ถึง 5 ครั้ง/10 นาที) — **ต้องปรับถ้าจะโปรโมตในไลฟ์** (คำถาม D2) · ไม่ใช้ lock: race ทำให้เกิน cap ได้ไม่กี่แถว ยอมรับได้เพราะไม่ใช่เงิน
7. insert แถวเดียว

errcode: validate ผิด = `22023` · breaker = `P0001` · ไม่มีอย่างอื่น

### 3.4 RPC `analytics.gem_quiz_stats` — สำหรับหน้าภายใน

```sql
analytics.gem_quiz_stats(p_shop_id uuid, p_from date, p_to date, p_include_retake boolean)
returns jsonb   -- ไม่ใช้ returns table (trap #12) + คืนหลาย section ได้ใน call เดียว
security definer · perform analytics.crm_require_owner_admin(p_shop_id) เป็นบรรทัดแรกหลังเช็ค null
grant service_role เท่านั้น
```
- `p_from`/`p_to` = วันไทยแบบ inclusive → `created_at >= (p_from::timestamp at time zone 'Asia/Bangkok') and created_at < ((p_to + 1)::timestamp at time zone 'Asia/Bangkok')`
- ด่าน: `p_from <= p_to` และช่วงไม่เกิน 366 วัน
- shape ที่คืน:
```json
{
  "respondents": 0, "by_src": {"card":0,"share":0,"live":0,"direct":0},
  "liked":        [{"code":"","label_th":"","price_group":1,"count":0}],
  "liked_none":   0,
  "recommended":  [{"code":"","label_th":"","price_group":1,"count":0}],
  "agreement":    {"recommended_in_liked":0, "eligible":0},
  "crosstab":     [{"question_code":"","option_code":"","stone_code":"","count":0}],
  "daily":        [{"date":"YYYY-MM-DD","count":0}],
  "by_src_liked": [{"src":"card","code":"","count":0}]
}
```
`crosstab` = พลอยที่ชอบ (Q1) × คำตอบคำถามแนะนำ · `by_src_liked` = แยก "ผู้ซื้อแล้ว (card)" กับ "เพื่อน (share)" — สำคัญต่อการตีความ (§10 R-5)

---

## 4. หน้าสาธารณะ `/gem-quiz`

### 4.1 Route + layout
- `app/(quiz)/layout.tsx` — route group ใหม่ header แบรนด์แบบเดียวกับ `(public)` (โลโก้/สี `#A2191D`) **ไม่มี** tagline "ไม่แพ้ผิว" และ footer เรื่องราคา · footer = LINE OA + บรรทัด "แบบทดสอบนี้ไม่เก็บข้อมูลส่วนตัว" (จริงตามตาราง §3.2) · คอมเมนต์หัวไฟล์เขียนกฎ §1.2
- `app/(quiz)/gem-quiz/page.tsx` — server component · `export const dynamic = "force-dynamic"` (token ต้องสดทุกครั้ง ห้าม ISR)
  `metadata`: title/description/openGraph/OG image **ของตัวเองครบ** (F9) · `robots: { index: false }` ใน phase 1 (คำถาม D3)
- `app/(quiz)/gem-quiz/GemQuizClient.tsx` — `"use client"` state machine ไม่มี import จาก `lib/actions/*` (§1.2)

### 4.2 Flow (3-4 จอ ไม่มีหน้า intro ยาว)

| ขั้น | เนื้อหา | กติกา design |
|---|---|---|
| 1. Q1 | "ชอบพลอยอะไร" — การ์ดตัวเลือก 12 พลอย (+ "ยังไม่มีในใจ" ถ้า B1 อนุมัติ) | **สลับลำดับแบบสุ่มทุกครั้ง** (ลด position bias) · **ไม่แสดงกลุ่มราคา/ราคา/ความหมาย** (ไม่ชี้นำ) · เลือกได้ตาม B1 · ไม่มีช่อง "อื่นๆ (ระบุ)" |
| 2-3. คำถามแนะนำ | 1-2 ข้อ (เนื้อหาจาก copywriter ตาม B3) ตัวเลือกคงที่ทั้งหมด | ไม่มี free text · ถ้าถามเรื่องเกิด ถามแค่เดือน *หรือ* วัน |
| 4. ผลลัพธ์ | ดูโครง §4.3 | แสดงทันทีจากการคำนวณฝั่ง client · ยิง submit แบบ fire-and-forget |

ย้อนกลับได้ระหว่างขั้น (state ใน memory) · refresh = เริ่มใหม่ (ยอมรับ ไม่ persist คำตอบ)

### 4.3 โครงหน้าผลลัพธ์ — slot ที่บังคับให้ copy ผ่านด่านได้โดยธรรมชาติ

ลำดับ slot คงที่ใน layout (copywriter เติมเนื้อหา **ไม่ได้ออกแบบหัวข้อเอง**):

1. **"พลอยที่คุณชอบ"** — echo คำตอบ Q1 (เคารพความชอบเดิม ไม่ทับด้วยผลระบบ)
2. **"พลอยที่เข้ากับเรื่องที่คุณมองหา"** — ชื่อพลอยที่แนะนำ (1 หรือ 2 ตาม B4) · *หัวข้อตายตัวนี้ไม่ใช่ "พลอยที่จะนำโชคให้คุณ"*
3. **"ลักษณะพลอย"** — ข้อเท็จจริงทางกายภาพ (สี ความแข็ง การดูแล) = ความรู้นำการขาย ตาม brand voice · ต้องมี URL อ้างอิงจาก docs-researcher (ด่านข้อเท็จจริง)
4. **"ตามความเชื่อที่คนไทยนิยม"** — หัวข้อตายตัว บังคับให้เนื้อหาเป็น "เล่าความเชื่อ" ไม่ใช่ "สัญญาผล"
5. **disclaimer คงที่ render ทุกผลลัพธ์เสมอ** (ไม่ใช่ field ต่อพลอยที่ลืมใส่ได้) — ข้อความให้ copywriter ร่าง แนว "ความเชื่อเป็นวัฒนธรรมที่เล่าต่อกันมา ไม่ใช่การรับรองผล"
6. **CTA** หนึ่งปุ่ม (ปลายทางรอ C1) + **"ชวนเพื่อนมาทำ"** (Web Share API → fallback ลิงก์แชร์ LINE / คัดลอกลิงก์) ลิงก์ที่แชร์ = `/gem-quiz?src=share` **ไม่แนบคำตอบใน URL** · ไม่มี incentive
7. ไม่มีราคา ไม่มีการเทียบราคาเงิน ไม่มีชื่อธุรกิจในเครือ

ที่เก็บเนื้อหา: `lib/gem-quiz/config.ts` (TS, versioned) — ใส่ตอน implement จาก copy ที่ผ่าน 3 ด่านแล้ว **ห้ามขึ้น prod ด้วยข้อความชั่วคราว** (หน้า publish ต้องรอ copy จริง)

### 4.4 ตรรกะแนะนำ
- `lib/gem-quiz/recommend.ts` (pure function ใช้ร่วม client/server): แต่ละ option ของคำถามแนะนำให้คะแนนพลอย → รวม → เลือก top (หรือ top ต่อ price_group ถ้า B4 = 2 พลอย) · เสมอกันตัดด้วย `sort_order` (deterministic)
- **ไม่ใช้คำตอบ Q1 ในการคำนวณ** — เพื่อให้ตัวชี้วัด "ระบบแนะนำตรงกับที่ชอบกี่ %" สะอาด และหน้าผลโชว์ทั้งสองอย่างคู่กันอยู่แล้ว
- ถ้า B4 = 2 พลอย: การแบ่งกลุ่มราคาต้องไม่อยู่ใน client bundle ⇒ client แสดงผลจาก response ของ submit แทนการคำนวณเอง (เสียคุณสมบัติ "ได้ผลแม้ DB ล่ม" บางส่วน) — *trade-off ที่ต้องรู้ก่อนเคาะ B4*
- unit test: ไล่ **ทุก combination** ของคำตอบ (2 ข้อ × ~5-12 ตัวเลือก = ไม่เกินร้อย) → ต้องได้ผลเสมอ + รหัสอยู่ในรายชื่อ · รายงานด้วยว่าพลอยตัวไหน "ไม่มีทางถูกแนะนำ" (เป็นคำถามธุรกิจ ไม่ใช่บั๊ก)

---

## 5. Anti-spam / anti-bot

### 5.1 Threat model ตามจริง
- **ไม่มีของแลก** (มติข้อ 2) ⇒ แรงจูงใจโกงต่ำมาก — นี่คือการป้องกันที่ดีที่สุดที่มีอยู่แล้ว
- ความเสี่ยงที่เจอจริงเรียงตามโอกาส: (1) **คนเดิมทำซ้ำ** ด้วยความอยากรู้ (2) crawler/bot สุ่มยิงฟอร์ม (3) สคริปต์ปั่นจงใจ (โอกาสต่ำ)
- ความเสียหายสูงสุด = สถิติเพี้ยน (ไม่ใช่เงิน/PII) ⇒ ลงทุนแค่พอดี

### 5.2 ชั้นที่ทำใน phase 1 (ไม่เก็บอะไรที่ชี้ตัวเครื่อง/คน)

| ชั้น | ทำยังไง | จับอะไร | ต้นทุน |
|---|---|---|---|
| L1 same-origin | route handler เช็ค `Origin` (หรือ `Sec-Fetch-Site`) = host ตัวเอง | ฟอร์ม cross-site, สคริปต์ขี้เกียจ | ไม่กี่บรรทัด |
| L2 signed form token | หน้าออก `{issuedAtMs}.{HMAC-SHA256(secret, issuedAtMs)}` · submit ต้องมี token ที่ลายเซ็นถูก (`timingSafeEqual`) อายุ **≥ 4 วินาที** และ **≤ 2 ชั่วโมง** | bot ที่ POST ตรงโดยไม่โหลดหน้า / กรอกเร็วผิดมนุษย์ | env ใหม่ 1 ตัว `GEM_QUIZ_TOKEN_SECRET` |
| L3 honeypot | input ซ่อน (off-screen + `tabIndex=-1` + `autocomplete=off` + `aria-hidden`) | bot กรอกทุกช่อง | 0 |
| L4 circuit breaker | ใน RPC (§3.3 ข้อ 6) | น้ำท่วม — จำกัดความเสียหายสูงสุดต่อ 10 นาที | 1 count query |
| L5 retake flag | localStorage `gemQuizDone:v{n}` หลัง submit สำเร็จ → ครั้งถัดไปส่ง `retake:true` | คนเดิมทำซ้ำ (สุจริต) | 0 — ไม่ใช่ identifier (เป็น boolean ไม่ออกจากเครื่อง) |
| L6 การมองเห็น | หน้าสถิติมี `daily` + กรองช่วงวันได้ | spike ผิดปกติ → เจ้าของเห็นและตัดช่วงวันออกได้ | 0 |

ผลตอบกลับ: honeypot โดน / token เร็วเกิน → **204 เงียบ ไม่บันทึก** (ไม่สอน bot ว่าโดนจับ) · token ปลอม/หมดอายุ → 400 · breaker → 429 · client **ไม่แสดง error ใดๆ** ให้ผู้ใช้ (ผลลัพธ์แสดงไปแล้ว)

### 5.3 สิ่งที่ปฏิเสธ + เหตุผล

| ทางเลือก | ทำไมไม่ทำ |
|---|---|
| in-memory rate limit | Vercel serverless หลาย instance ไม่แชร์ memory → ใช้ไม่ได้จริง |
| Cloudflare Turnstile / reCAPTCHA | script ภายนอก + ส่งข้อมูลผู้เข้าชมให้บุคคลที่สาม = ต้องเปิดเผยใน privacy policy ซึ่ง**ยังเป็นร่าง** (ขัดเหตุผลของมติข้อ 1) · เพิ่มแรงเสียดทานในหน้าที่อยากให้ทำง่าย · เก็บไว้เป็นทางยกระดับถ้าโดนจริง |
| unique code ต่อออเดอร์ | ไม่เก็บตัวตนอยู่แล้ว ได้แค่ dedupe แต่เสียต้นทุนพิมพ์ต่อใบ + code = ผูกกลับหาออเดอร์ได้ = กลายเป็นข้อมูลระบุตัว |
| nonce store กัน token replay | ต้องมีตาราง state เพิ่ม · replay ใน 2 ชม. ถูกจำกัดด้วย breaker อยู่แล้ว (YAGNI) |

### 5.4 per-IP rate limit — ออกแบบไว้ **ไม่เปิดใน phase 1** (คำถาม D1)
ถ้าต้องเปิด: `key = HMAC-SHA256(pepper, ip + วันไทย)` คำนวณใน route handler → เก็บในตาราง**แยก** `analytics.gem_quiz_rate_bucket(key text, window_start, hits)` ที่ **ไม่มีวัน join กับ response** + ลบแถวเก่ากว่า 48 ชม. · limit หลวมๆ (เช่น 20/ชม.) เพราะเน็ตมือถือไทยใช้ CGNAT คนจำนวนมากแชร์ IP เดียว
**ทำไมไม่เปิดเลย**: hash ที่เราถือ pepper เอง = ข้อมูลแฝงตัวตน (pseudonymous) ซึ่งตาม PDPA ยังนับเป็นข้อมูลส่วนบุคคลได้ — ขัดกับเหตุผลของมติข้อ 1 ที่ว่า "ไม่มี personal data จึงไม่ต้องรอ privacy policy" · และ IPv4 มีแค่ ~4 พันล้านค่า ถ้า pepper รั่ว brute-force ย้อนได้
**ทางเลือกที่ไม่ต้องเก็บอะไรเอง**: Vercel WAF rate-limit rule ระดับ platform (ต้องเช็คแผน Vercel ที่ใช้ — คำถาม D1)
หมายเหตุตรงๆ: **Vercel เก็บ IP ใน request log ของทุกหน้าอยู่แล้ว** (รวม `/shop`) — มติข้อ 1 ครอบ "DB ของเรา" ไม่ใช่ log ของ hosting

### 5.5 เคสที่ต้อง "ถูกปฏิเสธ" (สำหรับ brief ของ backend-dev / security)

| # | เคส | ต้องตกที่ด่าน | ผล |
|---|---|---|---|
| R-1 | GET/PUT ไปที่ `/api/gem-quiz/submit` | route (export แค่ POST) | 405 |
| R-2 | body > 2 KB (เช็ค `content-length` และความยาวจริงหลังอ่าน) | route | 413 |
| R-3 | `Origin` เป็นโดเมนอื่น / ไม่ใช่ JSON | L1 / route | 403 / 400 |
| R-4 | ไม่มี token / ลายเซ็นผิด / อายุ > 2 ชม. | L2 | 400 |
| R-5 | token อายุ < 4 วินาที · honeypot มีค่า | L2 / L3 | 204 ไม่บันทึก |
| R-6 | รหัสพลอยไม่มีจริง · ซ้ำ · เกิน 3 · มี null | route + RPC ข้อ 3 | 400 / 22023 |
| R-7 | `answers` มี key ที่ config เวอร์ชันนี้ไม่มี · value ไม่อยู่ใน option · **value เป็นข้อความไทย/เบอร์โทร** · เป็น array/number/null JSON | route + RPC ข้อ 5 | 400 / 22023 |
| R-8 | client ส่ง `shop_id` / `recommended` / `created_at` มาเอง | route (ไม่อยู่ใน contract → ทิ้ง) | ไม่มีผล ค่าจาก server ชนะ |
| R-9 | POST ไป `/gem-quiz` แนบ `Next-Action` ของ action ภายใน (เช่น `upsertContentPost`) ไม่มี session | forward → middleware | ต้องไม่รัน action (เด้ง login) |
| R-10 | `/gem-quizzes`, `/gem-quiz-admin`, `/api/gem-quiz-x` | matcher anchoring | ยังโดน gate |
| R-11 | เรียก `gem_quiz_submit` / `gem_quiz_stats` ด้วย role anon/authenticated (จำลอง grant usage กลับ ตาม trap 18.5) | grant | 42501 |
| R-12 | เกิน CAP ใน 10 นาที | RPC ข้อ 6 | P0001 → 429 |
| R-13 | `quiz_version` ไม่ตรงกับ config ปัจจุบัน (deploy ระหว่างทำ) | route | 409 ไม่บันทึก (ผู้ใช้ยังเห็นผล) |
| R-14 | staff หรือคนไม่ login เปิด `/marketing/gem-quiz` / เรียก action อ่านสถิติ | middleware + `getEffectiveRole` | login / หน้าจำกัดสิทธิ์ |

### 5.6 เคสที่ต้อง "ไม่พัง" (สำคัญเท่ากัน)

| # | เคส | ผลที่ต้องได้ |
|---|---|---|
| N-1 | สแกนด้วยกล้อง iPhone / Android / **สแกนในแอป LINE** (คนไทยใช้เยอะ) / เปิดใน in-app browser ของ TikTok | ทำจบ + บันทึกได้ |
| N-2 | in-app browser ที่บล็อก localStorage / private mode | ทำได้ปกติ retake=false |
| N-3 | `navigator.share` ไม่มี | fallback ลิงก์แชร์ LINE / คัดลอก |
| N-4 | submit ล้ม (เน็ตหลุด, 429, 500) | ผู้ใช้ยังเห็นผล ไม่มีกล่อง error |
| N-5 | เจ้าของที่ login อยู่เปิด `/gem-quiz` | ทำได้ ไม่ถูกเด้งไป `/dashboard` |
| N-6 | AUTH_GATE=off (dev/preview) | พฤติกรรมเหมือน prod |
| N-7 | คนใช้ IP เดียวกันหลายคน (CGNAT) ทำพร้อมกัน | ไม่โดนปฏิเสธ (phase 1 ไม่มี per-IP) |
| N-8 | `?src=` ถูกแก้เป็นค่าแปลก | coerce เป็น `direct` ไม่ reject |
| N-9 | `/shop`, `/stock/hero`, webhook | พฤติกรรมเดิมทุกอย่าง (matcher แก้แบบเพิ่มเท่านั้น) |

---

## 6. QR code

- **static QR ลิงก์เดียว** สำหรับทุกออเดอร์: `https://<โดเมน>/gem-quiz?src=card` (unique ต่อใบไม่มีประโยชน์และกลายเป็นตัวระบุออเดอร์ §5.3)
- 🔴 **โดเมนต้องเคาะก่อนสั่งพิมพ์ (P1)** — QR ที่พิมพ์แล้วแก้ไม่ได้ การ์ดหลายพันใบจะตายพร้อมโดเมน
  - `oms-3j.vercel.app` — ใช้ได้ทันที แต่เผยคำว่า "oms" ให้ลูกค้าเห็น + ผูกกับชื่อ Vercel project (เปลี่ยนชื่อ project = QR ตาย)
  - subdomain ของ `3jthailand.com` ชี้มา Vercel (เช่น `quiz.` / `go.`) — ทนที่สุด แต่ต้องแก้ DNS ที่ผู้ให้บริการโดเมน (เว็บอยู่บน Wix — **ต้องให้ docs-researcher ยืนยันว่าทำได้**)
  - path บนเว็บ Wix ที่ redirect 301 มาที่แอป — ต้องยืนยันว่า Wix redirect ไปโดเมนภายนอกได้ไหม
  - architect แนะนำ subdomain **ถ้าทำได้จริง** เพราะเราคุมปลายทางได้ตลอดชีพการ์ด
- **ห้ามใช้ dynamic-QR SaaS** (QR ชี้ไปโดเมนผู้ให้บริการแล้ว redirect) — หมดสัญญา/บริษัทปิด = การ์ดที่ส่งไปแล้วตายหมด + บุคคลที่สามได้ข้อมูลผู้สแกน
- วิธี generate (ทำครั้งเดียว ไม่ต้องเขียนโค้ดในแอป): แพ็กเกจ npm `qrcode` ผ่าน CLI เช่น `npx qrcode -t svg -e M -o gem-quiz-qr.svg "<URL>"` (เช็ค flag กับ `npx qrcode --help` ก่อนใช้) → ส่ง **SVG (vector)** ให้โรงพิมพ์ ไม่ใช่ PNG
- สเปคพิมพ์: error correction **M** (ไม่ใส่โลโก้ทับ — ถ้าจะใส่ต้อง Q/H) · quiet zone ≥ 4 module · **ขนาดพิมพ์ ≥ 2.5 × 2.5 ซม.** (กฎคร่าวๆ ระยะสแกน ÷ 10 · ถือการ์ด 15-25 ซม.) · หมึกเข้มบนพื้นอ่อน ห้ามกลับสี · กระดาษด้าน (เคลือบเงาสะท้อนแสงทำสแกนพลาด)
- URL ยิ่งสั้น QR ยิ่งหยาบ สแกนง่าย — เหตุผลที่เสนอ path `/gem-quiz` และพารามิเตอร์ `src` สั้นๆ
- ข้อความใต้ QR (copywriter) + **พิมพ์ URL ตัวอักษรไว้ใต้ QR ด้วย** (สำรองกรณีสแกนไม่ได้)
- ก่อนสั่งพิมพ์จริง: พิมพ์ proof 1 ใบ ทดสอบ N-1 ทั้ง 4 วิธีสแกน ระยะจริง แสงในบ้าน

---

## 7. หน้าสถิติภายใน `/marketing/gem-quiz`

- `app/(dashboard)/marketing/gem-quiz/page.tsx` + `loading.tsx` — shape เดียวกับ `/marketing/content/history`: `dynamic = "force-dynamic"` · `getEffectiveRole() === "staff"` → `EmptyState` + `Lock` · `getDevShopId()` ใน try → `ErrorState`
- ตัวกรองผ่าน `searchParams`: ช่วงวัน (default 30 วันล่าสุดตามเวลาไทย) · แหล่ง (ทั้งหมด/การ์ด/แชร์/ไลฟ์) · รวม retake ไหม (default ไม่รวม)
- เนื้อหา (ตาราง + แท่ง CSS ไม่ต้องเพิ่ม chart library):
  1. **จำนวนผู้ตอบ (n) ตัวใหญ่ที่สุดบนจอ** + badge "ข้อมูลยังน้อย" ถ้า n < 30 (pattern สถานะข้อมูลไม่พอของ `content-kpi-screen-design.md`)
  2. **พลอยที่ชอบ (Q1)** เรียงมากไปน้อย — % คิดจาก**จำนวนคน** (ถ้า multi-select ผลรวมเกิน 100% ต้องเขียนกำกับบนจอ)
  3. แยกตามกลุ่มราคา 1/2
  4. **ผู้ซื้อแล้ว (card) vs เพื่อน (share)** คู่กัน
  5. cross-tab พลอยที่ชอบ × คำตอบคำถามแนะนำ
  6. ระบบแนะนำตรงกับที่ชอบ x% · รายวัน (เห็น spike)
- ไฟล์: `lib/actions/gem-quiz-stats.ts` (`"use server"`, `requireOwnerAdmin` แบบเดียวกับ `content.ts`, `.schema("analytics").rpc("gem_quiz_stats")` + type guard parse jsonb) · `components/domain/marketing/GemQuizStats.tsx` · เพิ่มแท็บใน `MarketingSubNav.tsx` (ป้าย "แบบทดสอบพลอย")
- read-only ไม่มีปุ่มลบ/แก้ข้อมูลใน phase 1

---

## 8. ไฟล์ที่ต้องสร้าง/แก้

| ไฟล์ | สร้าง/แก้ | หน้าที่ |
|---|---|---|
| `supabase/migrations/0154_gem_quiz.sql` | สร้าง | lookup + response + 2 RPC + grants (§3) |
| `middleware.ts` | **แก้ (ของกลาง)** | เพิ่ม `gem-quiz(?:/\|$)` และ `api/gem-quiz(?:/\|$)` ใน negative lookahead · อัปเดตคอมเมนต์ exempt list |
| `lib/auth/exempt-path.ts` | **แก้ (ของกลาง)** | sync regex เดียวกันแบบมือ |
| `lib/auth/exempt-path.test.ts` | แก้ | เพิ่ม must-exempt (`/gem-quiz`, `/api/gem-quiz/submit`) + must-NOT (`/gem-quizzes`, `/gem-quiz-admin`, `/api/gem-quiz-x`) |
| `lib/gem-quiz/config.ts` | สร้าง | `QUIZ_VERSION`, รายชื่อพลอย (ต้องตรง seed), คำถาม/ตัวเลือก, ตารางคะแนน, copy หน้าผล — ไม่มี `server-only` (ใช้ทั้ง client/server) **ห้ามมีราคา/price_group** |
| `lib/gem-quiz/recommend.ts` + `.test.ts` | สร้าง | pure scoring + test ทุก combination |
| `lib/gem-quiz/validate.ts` + `.test.ts` | สร้าง | parse body → typed input หรือ error (whitelist ตาม config) · ครอบเคส R-6/R-7/R-8/R-13 |
| `lib/gem-quiz/form-token.ts` + `.test.ts` | สร้าง | `import "server-only"` · sign/verify HMAC + อายุ (R-4/R-5) |
| `app/(quiz)/layout.tsx` | สร้าง | layout สาธารณะของ quiz (§4.1) |
| `app/(quiz)/gem-quiz/page.tsx` | สร้าง | server component ออก token + metadata/OG ของตัวเอง + noindex |
| `app/(quiz)/gem-quiz/GemQuizClient.tsx` | สร้าง | state machine, สุ่มลำดับ Q1, honeypot, localStorage, fetch submit, share |
| `app/api/gem-quiz/submit/route.ts` | สร้าง | POST เท่านั้น · ลำดับด่าน §2 · log แบบไม่ทิ้ง error object ทั้งก้อน (memory supabase-error-logging-trap) |
| `public/gem-quiz/og.png` (+ รูปพลอยถ้ามี — C2) | สร้าง | OG image สำหรับ LINE preview |
| `lib/actions/gem-quiz-stats.ts` | สร้าง | อ่านสถิติ (owner/admin) |
| `app/(dashboard)/marketing/gem-quiz/page.tsx` + `loading.tsx` | สร้าง | หน้าสถิติ |
| `components/domain/marketing/GemQuizStats.tsx` | สร้าง | ตาราง/แท่ง |
| `components/domain/marketing/MarketingSubNav.tsx` | แก้ | เพิ่มแท็บ |
| `.env.local.example` | แก้ | `GEM_QUIZ_TOKEN_SECRET=` (+ ตั้งบน Vercel ก่อน deploy — ไม่มี = route ตอบ 503 fail closed ไม่ใช่ข้ามด่าน) |

---

## 9. Trade-offs (ทางที่ตัดทิ้ง + เหตุผล)

| เรื่อง | เลือก | ไม่เลือก | เหตุผล |
|---|---|---|---|
| ทางเขียน | Route Handler + RPC service_role | Server Action | §1.2 หน้า exempt + action ในตัว = ช่องเลี่ยง middleware · bodySizeLimit 4mb global · route handler ยิงทดสอบตรงได้ · แลกกับการเบี่ยงจาก pattern "ทุกการเขียนเป็น server action" (มี precedent `/api/webhooks`) |
| | | anon key insert ตรง (PostgREST + RLS policy anon) | anon key เป็น public ⇒ bot ยิง REST ตรงข้ามหน้าเว็บ ข้ามทุกด่าน anti-bot ได้ · ต้องเปิด USAGE สคีมาให้ anon = ถอยหลังจาก 0123 |
| สคีมา | `analytics` | สคีมาใหม่ / `public` | analytics ปิด REST ทั้งสคีมาแล้ว + `check-analytics-grants.sql` กวาดเฉพาะสคีมานี้ — สคีมาใหม่หลุดจากด่านกวาดอัตโนมัติ · `public` เปิด REST อยู่ |
| เก็บ Q1 | `text[]` ในแถวเดียว | ตารางลูก / คอลัมน์เดี่ยว | รองรับทั้ง single/multi (B1 ยังไม่เคาะ) · insert atomic แถวเดียว · แลกกับ FK ต่อ element ไม่ได้ → RPC ตรวจแทน (ทางเขียนมีทางเดียว) |
| คำถามแนะนำ | `answers jsonb` slug-only + version | คอลัมน์เฉพาะต่อคำถาม | เนื้อหาคำถามยังไม่นิ่ง (copywriter จะ iterate) เปลี่ยนคำถามไม่ต้อง migration · ความถูกต้องเชิงความหมายตรวจที่ route ด้วย config · DB คุม shape + กัน free text |
| ที่เก็บคำถาม/mapping/copy | TS config versioned | ตาราง DB + หน้า admin แก้เอง | YAGNI — แก้ไม่บ่อย และทุกครั้งต้องผ่าน 3 ด่าน content อยู่แล้ว (ไม่ควรแก้สดโดยไม่มีใครตรวจ) · แลกกับรายชื่อพลอยอยู่ 2 ที่ (TS + seed) → RPC ปฏิเสธรหัสแปลก + QA ตรวจ |
| คำนวณผล | client แสดง + server คำนวณใหม่เก็บ | เชื่อผลจาก client / server อย่างเดียว | ผู้ใช้ได้ผลแม้ DB ล่ม · ข้อมูลที่เก็บไม่เชื่อ client |
| Q1 ในการแนะนำ | ไม่ใช้ | ใช้เป็นตัวตัดสินเสมอ | ตัวชี้วัด "แนะนำตรงกับที่ชอบ" สะอาด · UX ยังโชว์ทั้งสองคู่กัน |
| anti-bot | token+honeypot+breaker+retake | per-IP hash (เลื่อน) · Turnstile · in-memory | §5.3-5.4 |
| layout | route group `(quiz)` ใหม่ | ใช้ `(public)` / refactor `(public)` | footer ราคา + tagline "ไม่แพ้ผิว" ไม่เหมาะ · refactor = แตะ `/shop` เพิ่มรัศมีกระแทกโดยไม่จำเป็น · แลกกับ header ซ้ำ ~20 บรรทัด |
| สถิติ | RPC คืน jsonb ก้อนเดียว | view + รวมใน TS · `returns table` | PostgREST ตัด 1000 แถวเงียบ (F14) → ต้องรวมใน DB · jsonb เลี่ยง trap #12 + หลาย section ใน call เดียว · แลกกับ type ไม่ strict → type guard ฝั่ง TS |
| QR | static + โดเมนที่เราคุม | dynamic-QR SaaS | §6 |

---

## 10. ความเสี่ยงตอน implement

| # | ความเสี่ยง | กันยังไง |
|---|---|---|
| R-1 | แก้ matcher ผิด = เปิด/ปิดหน้าอื่นโดยไม่ตั้งใจ (**ของกลาง — ระดับ L + security ก่อน merge**) | anchor `(?:/\|$)` · sync กับ `exempt-path.ts` · negative test R-10 · QA กด `/shop` `/stock/hero` `/dashboard` ซ้ำ |
| R-2 | มีคน import ไฟล์ `"use server"` เข้าหน้า quiz ภายหลัง (ผ่าน shared component) | กฎ §1.2 เขียนในคอมเมนต์หัว `app/(quiz)/layout.tsx` + code-review grep + security ยิง R-9 · *เสนอเพิ่ม test ที่ assert ว่าไฟล์ใต้ `app/(quiz)` ไม่ import `lib/actions`* |
| R-3 | route handler ถือ service role แต่เปิดสาธารณะ | contract แคบ (§5.5 R-8) · ไม่ echo DB error กลับ client · shop_id จาก env เท่านั้น |
| R-4 | LINE preview โชว์ "CRM · …สมองกลาง" ของ root metadata | override ครบใน page (F9) · QA แชร์ลิงก์ใน LINE จริงดู preview |
| R-5 | **ตีความสถิติผิด**: ผู้ตอบจากการ์ด = คนที่ซื้อไปแล้ว (เลือกพลอยไปแล้ว) ไม่ใช่ตลาดทั้งหมด + self-selection + n น้อย | แยก card/share บนจอ · โชว์ n ตัวใหญ่ + badge ข้อมูลน้อย · เขียนกำกับบนหน้าสถิติ |
| R-6 | เนื้อหาหลุดกฎ (สัญญาผล / สุขภาพ / ทำให้เข้าใจว่าพลอยแท้ธรรมชาติ) | slot หัวข้อตายตัว + disclaimer คงที่ (§4.3) · copy ผ่าน 3 ด่านของ `3j-content-orchestration` ก่อน publish · คำถาม B2/B3 |
| R-7 | token replay ภายใน 2 ชม. ยิงซ้ำได้ | ถูกจำกัดด้วย breaker · ยอมรับใน phase 1 |
| R-8 | breaker ถูกยิงจนเต็ม → คำตอบจริงถูกปฏิเสธช่วงนั้น | ผู้ใช้ยังเห็นผล (N-4) · เสียแค่ข้อมูลช่วงสั้น · เห็นใน `daily` |
| R-9 | `GEM_QUIZ_TOKEN_SECRET` ไม่ได้ตั้งบน Vercel | route ตอบ 503 (fail closed) · อยู่ใน deploy checklist |
| R-10 | รายชื่อพลอยใน TS กับ seed ไม่ตรงกัน | RPC ปฏิเสธรหัสแปลก (โผล่เป็น 400 ใน log) · QA ทำครบ 12 พลอย × submit จริงบน preview |
| R-11 | migration traps ที่เกี่ยว: #2/#18 (grant service_role เท่านั้น ห้าม `to authenticated`) · #6 (วันไทย) · #13 (`jsonb_typeof`) · #20 (LF) · #10 (บันทึกประวัติ) · หลัง apply รัน `scripts/check-analytics-grants.sql` | ใส่ใน brief backend-dev + ตารางแมปบรีฟ→เทสต์ |

---

## 11. คำถามเปิด — ต้องเคาะ (ห้าม implementer เดาเอง)

**บล็อกการเริ่มเขียนโค้ด (ตอบโดยเจ้าของ ผ่าน Tech Lead)**

- **B1** Q1 "ชอบพลอยอะไร" เลือก **ได้ตัวเดียว หรือหลายตัว (สูงสุดกี่ตัว)**? และมีตัวเลือก **"ยังไม่มีในใจ"** ไหม?
  → architect เสนอ: เลือกได้สูงสุด 3 + มี "ยังไม่มีในใจ" (บังคับเลือกทำให้ได้ความชอบปลอม ซึ่งทำลายจุดประสงค์ market research) · schema รองรับทุกแบบ
- **B2** 🔴 พลอยที่ขายจริงในไลฟ์ (โดยเฉพาะกลุ่ม 2: ทับทิม/ไพลิน/บุษ/มุก/นิล) เป็น **พลอยธรรมชาติ / ผ่านการปรับปรุง (เผา ฯลฯ) / สังเคราะห์ / CZ สี / มุกเลี้ยง**? — หน้าผลที่เขียนแค่ "ทับทิม" อาจทำให้ลูกค้าเข้าใจว่าเป็นพลอยแท้ธรรมชาติ ซึ่งขัดกฎ "บอกชัดทุกครั้ง" และเป็นความเสี่ยง สคบ. · พร้อมยืนยันชื่อที่สะกด ("บุษ" = บุษราคัม? "นิล" ใช้คำนี้ตรงๆ?)
- **B3** คำถามแนะนำคืออะไร กี่ข้อ (เรื่องที่อยากได้ / เดือนเกิด / วันเกิด / ซื้อให้ตัวเองหรือเป็นของขวัญ)? — หมวด "เรื่อง" **ต้องไม่มีสุขภาพ** (ห้ามเคลมการแพทย์) · หมวดการเงิน/โชคลาภ ใกล้มุมพลอยเสกที่สุด ต้องผ่านด่านความเสี่ยง (CLAUDE.md: ห้ามทีมตอบเอง)
- **B4** ผลแนะนำ **1 พลอย** หรือ **1 พลอยต่อกลุ่มราคา (รวม 2)**? — แบบหลังให้ทางเลือกราคาที่ถูกกว่าโดยไม่ต้องพูดเรื่องราคา แต่เป็นการตัดสินใจทางการขาย (และกระทบ §4.4: client ต้องรอผลจาก server)

**บล็อกการสั่งพิมพ์การ์ด (ไม่บล็อกการเขียนโค้ด)**

- **P1** โดเมนบน QR: `oms-3j.vercel.app` / subdomain ของ `3jthailand.com` / redirect จาก Wix? (§6) — ต้องให้ docs-researcher ยืนยันความสามารถของ Wix ก่อนตัดสิน

**ไม่บล็อก — Tech Lead ตัดสินได้ หรือ default ตามที่เสนอ**

- **C1** ปลายทาง CTA หน้าผล: ไลฟ์ TikTok (20:00) / LINE OA / `/shop`? — ⚠️ `/shop` เป็นแคตตาล็อกแบบ OEM คนละชุดกับของไลฟ์ (F13) ลิงก์ไปแล้วลูกค้าอาจหาพลอยที่แนะนำไม่เจอ · architect เสนอ LINE OA หรือไลฟ์
- **C2** มีรูปถ่ายพลอยของร้านเองไหม? (ห้ามใช้รูปจากเว็บคนอื่น — ลิขสิทธิ์) — phase 1 ใช้ชื่อ + จุดสีได้ถ้ายังไม่มี
- **D1** per-IP rate limit (§5.4) เปิดตั้งแต่ phase 1 ไหม? architect เสนอ **ไม่** — รอดูข้อมูลจริง 2-4 สัปดาห์ ถ้าเจอการปั่นค่อยเลือกระหว่าง Vercel WAF (ต้องรู้แผน Vercel ที่ใช้) กับตาราง HMAC bucket · ถ้าเจ้าของอยากเปิดตั้งแต่แรก ต้องรู้ว่าแตะมติข้อ 1
- **D2** จะโปรโมต quiz ในไลฟ์/โซเชียลไหม? ถ้าใช่ → เพิ่มลิงก์ `?src=live` + ปรับ CAP ของ breaker ขึ้น (ไลฟ์ทำให้คนเข้าพร้อมกันเป็นร้อยได้จริง)
- **D3** ให้ Google index หน้านี้ไหม? เสนอ `noindex` ใน phase 1 (แหล่งคนเข้าคือ QR · ลด bot traffic) — ถ้าสาย SEO อยากใช้เป็น content ค่อยเปิดพร้อมตรวจ copy อีกรอบ

---

## 12. ลำดับงาน + ระดับตรวจ

1. เคาะ B1-B4 → copywriter เขียนคำถาม/ตัวเลือก/copy หน้าผล → **3 ด่าน content** (ข้อเท็จจริงลักษณะพลอยต้องมี URL · กฎแบรนด์ · ความเสี่ยงความเชื่อ/สุขภาพ)
   *โค้ดส่วน infra (migration, middleware, route, token, stats) เริ่มคู่ขนานได้หลัง B1/B4 เพราะ schema ไม่ขึ้นกับเนื้อคำถาม*
2. backend-dev: `0154` (ซ้อม rollback ก่อน apply) + route handler + `lib/gem-quiz/*` + middleware/exempt-path + test · แนบตาราง "ข้อในบรีฟ → เทสต์ที่ครอบ" ตาม §5.5/5.6
3. frontend-dev: `(quiz)` + หน้าสถิติ (ถ้าทำคู่ขนาน → `isolation: "worktree"`)
4. **security-auditor + qa-tester คู่ขนาน** — ระดับ **L** (แตะ middleware = ของกลาง) · security ต้องดู §1.2, R-9, R-11 เป็นพิเศษ · QA ไล่ N-1 บนมือถือจริงใน preview
5. code-reviewer → devops: env `GEM_QUIZ_TOKEN_SECRET` บน Vercel · apply 0154 + บันทึก `schema_migrations` + merge ไฟล์เข้า main (trap #10/#21) · `check-analytics-grants.sql`
6. หลังขึ้น prod + โดเมนเคาะ (P1) → generate QR SVG → proof พิมพ์ 1 ใบ ทดสอบสแกน → สั่งพิมพ์

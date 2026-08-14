# Deploy Checklist — Phase B1 CRM (Read Layer)

> devops (Lando) · 2026-08-11 · Next.js 15 (App Router) + Supabase Postgres 17 + Vercel
> Scope: side nav ใหม่ + 4 route `/crm/*` + 6 analytics views + migration 0020
> อ้างอิง: `docs/3j-jewelry/analytics/phase-b-crm-design.md` §6 (DoD B1)

---

## 🔴 CRITICAL — Security Gate (ต้องอ่านก่อนบรรทัดอื่น)

**CRM ยังไม่มี auth จริง** — `/crm/*` ใช้ **service-role Supabase client** + env `DEV_SHOP_ID`/`DEV_ROLE` (pattern เดียวกับ TikTok module ใน `lib/dev/context.ts`, `lib/supabase/server.ts`)

- Service-role client **bypass RLS ทั้งหมด** — RLS ที่ออกแบบไว้ใน migration 0012/0018 (owner/admin เห็น PII, staff ไม่เห็น) **ไม่มีผลอะไรเลย** กับ path นี้ เพราะ query ไม่ผ่าน RLS ตั้งแต่แรก
- `/crm/customers` และ `/crm/customers/[id]` โชว์ PII ลูกค้า **310 คน** (ชื่อ/เบอร์/ที่อยู่ที่มี) ตรงๆ — ใครก็ตามที่เปิด URL ถึงหน้านี้ได้ = เห็นข้อมูลทั้งหมด ไม่มี login gate กรอง

**กติกา deploy รอบนี้ (ห้ามต่อรอง):**
- [ ] ✅ deploy ได้แค่ **Vercel Preview / Staging ที่ป้องกันการเข้าถึงจากสาธารณะ** เท่านั้น
  - ใช้ Vercel **Deployment Protection** (Standard Protection หรือ Password Protection) บน environment ที่ deploy — Project Settings → Deployment Protection → เปิกให้ preview ต้อง Vercel login หรือ password ก่อนเข้าถึงทุก URL
  - ถ้า plan ไม่มี Deployment Protection (Hobby บาง tier) → ต้องใช้ middleware gate แบบเดียวกับ `docs/3j-jewelry/ops-app/deploy-checklist-phase1.md` (basic-auth, fail-closed) ครอบ `/crm/*` เป็นอย่างน้อย ก่อน push ขึ้น preview
- [ ] 🚫 **ห้าม promote ขึ้น production domain ที่ public** จนกว่าจะมีอย่างใดอย่างหนึ่ง:
  1. Supabase Auth จริง + RLS ผูก `shop_member` แทน service-role client (งาน B2/แยกต่างหาก — ยังไม่อยู่ scope B1), หรือ
  2. Deployment Protection / middleware gate ยัง on อยู่ที่ production ด้วย (ไม่ใช่ preview อย่างเดียว)
- [ ] ผู้ตัดสิน go/no-go ของ production คือ Tech Lead — ไม่ deploy เองโดยไม่ถาม ถ้าไม่แน่ใจว่า protection เปิดอยู่จริง ให้ตรวจซ้ำก่อน push ทุกครั้ง (คนละ session ก็โดน bypass ได้ถ้าลืม)

> เทียบ TikTok module: บล็อกเดียวกัน แต่ B1 หนักกว่าเพราะมี **PII ระดับบุคคล** ไม่ใช่แค่ยอดขาย

---

## Pre-deploy

### 1. Migration sync (DB จริง vs repo)
- [x] DB จริง (project "3J Online Sale") apply ถึง **0020** แล้วผ่าน MCP
- [x] repo มีไฟล์ migration **0001-0020 ครบ** (backfill 0014-0019 เข้า repo แล้ว รอบก่อนหน้า)
- [ ] ก่อน push ตรวจ diff: `git status supabase/migrations/` ต้องว่าง (ไม่มีไฟล์ pending ที่ยังไม่ apply)
- [ ] ถ้ามี CI ที่รัน `supabase db push` — ตรวจว่า target project ref ตรงกับ "3J Online Sale" (`udqmamplbymxnknkjnkz`) ไม่ใช่ project อื่น — เลข migration ชนได้ถ้าคนละ DB history
- [ ] **ถ้า deploy ไป Supabase project/branch ใหม่ (เช่น เปิด preview branch แยก DB)** — 0020 มี `create or replace view` เท่านั้น รันซ้ำได้ปลอดภัย (idempotent) แต่ยังต้องทำ step 2 (schema exposure) เอง ไม่งั้น view เรียกไม่ได้เลย

### 2. ⚠️ PostgREST schema exposure (แยกจาก migration — ทำมือทุกครั้งที่เจอ DB ใหม่)
Migration ไม่ได้ expose schema `analytics` ให้ PostgREST อัตโนมัติ ต้องรัน (หรือกดใน Dashboard) เอง:
```sql
alter role authenticator set pgrst.db_schemas to 'public, graphql_public, analytics';
notify pgrst, 'reload config';
```
หรือ Supabase Dashboard → Settings → API → **Exposed schemas** → เพิ่ม `analytics`
- [ ] ตรวจว่า project "3J Online Sale" ที่ใช้อยู่ทำ step นี้ไปแล้วหรือยัง (Phase A เคยเจอ `PGRST106` — มี comment เตือนไว้ใน 0018) — ถ้ายังไม่ทำ views ทั้ง 6 ตัวเรียกจาก client ไม่ได้ทันที
- [ ] ถ้า deploy ไป project ใหม่ (staging DB แยก) → ทำ step นี้ **ก่อน** สม็อกเทสต์ ไม่งั้นจะเข้าใจผิดว่าโค้ดพัง ทั้งที่จริงคือ schema ไม่ expose

### 3. Env vars บน Vercel (project/environment ที่จะ deploy)
| Var | ค่า | หมายเหตุ |
|---|---|---|
| `SUPABASE_URL` | URL project "3J Online Sale" | server-only |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key | **secret — ห้ามขึ้นต้น `NEXT_PUBLIC_` เด็ดขาด**, ตั้งเป็น Vercel Encrypted env var, server-only |
| `DEV_SHOP_ID` | shop uuid ของ 3J | ชั่วคราว (ทั้ง CRM/TikTok module พึ่งตัวนี้) |
| `DEV_ROLE` | `owner` หรือ `admin` | กำหนดว่า mock role นี้เห็น PII ใน UI logic ฝั่ง client หรือไม่ — **ไม่ใช่ RLS จริง** (service-role bypass RLS อยู่ดี ตัวนี้แค่ if/else ใน component) |
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` | มีแล้วถ้า OMS deploy อยู่ | ใช้โดยส่วนอื่นของแอป ไม่ใช่ CRM path |
- [ ] `.env.local` ยัง gitignored (ตรวจแล้ว — `.gitignore` มี `.env`, `.env.local`, `.env.test`) — เช็คว่าไม่มี secret หลุดในไฟล์ที่ commit จริง: `git grep -n "SERVICE_ROLE" -- '*.ts' '*.tsx'` ต้องเจอแค่ `process.env.SUPABASE_SERVICE_ROLE_KEY` ไม่ใช่ค่า literal

### 4. Build/verify (ผู้ใช้รันเอง — environment agent ไม่มี Node ใน PATH, Node v24 อยู่ `C:\Program Files\nodejs`)
```bash
npm run typecheck && npm run build
```
- [x] `npm run typecheck` ผ่านแล้ว (ยืนยันจาก session ก่อนหน้า)
- [ ] `npm run build` — รันก่อน deploy ทุกครั้ง (ยังไม่ยืนยันในรอบนี้)
- [ ] **`npm run lint` รันไม่ได้** — `package.json` มี script `lint: eslint . --ext .ts,.tsx` และ `eslint-config-next` อยู่ใน devDependencies แต่ **ไม่มีไฟล์ config** (`.eslintrc*` / `eslint.config.*` หาไม่เจอในโปรเจกต์) → ถือเป็น **pre-deploy gap ที่รู้ตัว** ไม่ใช่ blocker ของ B1 (เพราะ deploy เป็น preview/staging เท่านั้น) แต่ต้องแก้ก่อนเปิด production จริง — ยกไป known debt ด้านล่าง
- [ ] `npm run test` ถ้ามี test ที่เกี่ยวกับ views/CRM actions — รันก่อน push (ตรวจ `supabase/tests` ด้วยถ้ามี test ผูก 0020)

### 5. Dependency ใหม่
- [x] ไม่มี dependency ใหม่ที่เพิ่มใน `package.json` สำหรับ B1 (ตรวจจาก git status — เห็น `package.json` แก้ แต่เป็นงานอื่นที่ modified อยู่แล้วก่อนหน้า B1 ไม่ใช่ CRM) — **ต้อง diff เช็คอีกรอบก่อน push จริง** ว่า `package.json` diff ปัจจุบันไม่ได้แอบพ่วง dependency ที่ B1 ไม่ต้องการ

---

## Deploy steps

1. **Commit แยกก้อน** — แยก migration/backend (`supabase/migrations/0020_crm_b1_views.sql`, `lib/actions/crm*.ts` ถ้ามี) ออกจาก UI (`app/(dashboard)/crm/*`, `components/domain/crm/*`, `app/(dashboard)/layout.tsx` nav) เพื่อ revert แยกได้ถ้าฝั่งใดพัง
2. **Apply migration ผ่าน MCP ก่อน push code** (ทำแล้วตาม fact ข้างบน — 0020 apply แล้วบน DB จริง) — ถ้า deploy ไป DB ใหม่ ให้ apply ที่นี่ก่อนเสมอ ไม่ใช่หลัง push
3. **ตั้ง Vercel Deployment Protection ก่อน push** (อย่าพึ่งพาการตั้งทีหลัง) — Project Settings → Deployment Protection → เปิดให้ preview ต้อง auth
4. `git push` feature branch → รอ Vercel preview build
5. **เทส gate ทำงานจริง** — เปิด preview URL จาก browser ที่ยัง login Vercel ไม่ตรง org / incognito → ต้องโดนกัน (401/redirect login) ก่อนเห็นหน้าใดๆ รวมถึง `/crm/*`
6. ตั้ง env vars (ตาราง section 3) บน environment ที่ตรง (Preview scope อย่างน้อย — **อย่าตั้งใน Production scope จนกว่าจะตัดสิน go**)
7. Smoke test บน preview (ดู section post-deploy ด้านล่าง)
8. **เงื่อนไข promote ไป production:** ผ่านทุกข้อใน security gate ด้านบน (protection ยังเปิดอยู่ที่ production ด้วย หรือมี auth จริงแล้ว) + smoke test ผ่านครบ + code-reviewer/security-auditor/qa sign-off ตาม DoD §6 ของ design doc — ถ้าข้อใดยังไม่ผ่าน **ค้างที่ preview ไปก่อน ไม่ merge main**
9. ⚠️ **อย่า deploy วันศุกร์เย็น** — B1 มี PII exposure risk สูง ถ้าพบว่า protection หลุดหลัง promote ต้องมีคน monitor/rollback ได้ทันที ไม่ใช่ค้างข้ามสุดสัปดาห์

---

## Post-deploy verify (ทำทุกครั้งหลัง deploy ไม่ว่า preview หรือ production)

### Smoke test เทียบเลขจริง
- [ ] `/crm/overview` โหลดได้ ไม่ error — เทียบตัวเลขกับ query มืออย่างน้อย 3 ตัว (ตาม DoD §6):
  ```sql
  select count(*) from analytics.fact_order where shop_id = '<DEV_SHOP_ID>'; -- คาด 334
  select count(*) from analytics.dim_customer where shop_id = '<DEV_SHOP_ID>' and merged_into_id is null; -- คาด 310
  select segment, count(*) from analytics.v_rfm_segment where shop_id = '<DEV_SHOP_ID>' group by segment; -- เทียบกับที่ UI แสดง
  ```
- [ ] `/crm/customers` list ครบ 310 คน + search ใช้งานได้
- [ ] `/crm/customers/[id]` เปิดได้ ประวัติออเดอร์ตรงกับ `fact_order` ของ customer นั้น
- [ ] `/crm/import-errors` group ตาม `error_code` แสดงถูก (ไม่ใช่ free-text parse)
- [ ] ทุกจอที่มี profit แสดง label **"ประมาณการ 20%"** ชัดเจน (ไม่ใช่ 10% ของ placeholder เก่า — 0020 เปลี่ยนแล้ว)

### RLS / PII (สำคัญเท่า schema)
- [ ] **แม้จะรู้ว่า service-role bypass RLS** ก็ยังต้องตรวจ RLS ของ underlying table ไม่พัง (สำหรับ path อื่นที่ยังใช้ user session จริง เช่นถ้ามี admin ล็อกอินปกติ) — รัน query จำลอง staff role เทียบ `pii_customer` ต้องว่างสำหรับ role ที่ไม่ใช่ owner/admin
- [ ] ยืนยันด้วยตาว่า **ไม่มี column จาก `pii_customer` หลุดเข้า view ทั้ง 6 ตัว** — grep migration แล้วในโค้ด runtime เปิดหน้า `/crm/customers` ต้องไม่เห็นเบอร์/ที่อยู่จาก view โดยตรง (customer 360 ต้อง query PII แยกตาม design §2.7)
- [ ] เปิด preview URL โดยไม่ login Vercel (หรือไม่มี basic-auth header) → ต้องโดนกันจริง ไม่ใช่แค่ redirect UI แล้ว data ยังหลุดผ่าน API route

### ตรวจ Supabase advisor
- [ ] เปิด Supabase Dashboard → Database → Advisors (หรือผ่าน MCP) หลัง apply 0020 — เช็คว่าไม่มี security advisor ใหม่ (เช่น view ที่ไม่ได้ตั้ง `security_invoker`, RLS ปิดไม่ครบ) ทุก view ใน 0020 ตั้ง `with (security_invoker = true)` แล้วแต่ตรวจซ้ำจาก advisor เพื่อความชัวร์

---

## Rollback plan

**Migration 0020 มี 3 ส่วน — rollback แยกตามผลกระทบ ไม่เท่ากัน:**

1. **6 views (`create or replace view`)** — rollback ปลอดภัยสุด ลบทิ้งได้ตรงๆ ไม่กระทบข้อมูล:
   ```sql
   drop view if exists analytics.v_import_error_summary;
   drop view if exists analytics.v_channel_perf_monthly;
   drop view if exists analytics.v_customer_ltv;
   drop view if exists analytics.v_rfm_segment;
   drop view if exists analytics.v_customer_master;
   drop view if exists analytics.v_fact_order;
   ```
   (ลำดับ drop จากตัวที่ dependency มากสุดไปน้อยสุด เพราะ view หลังๆ join view ก่อนหน้า)

2. **`stg_order_import.error_code` (add column)** — additive, ไม่ลบข้อมูลเดิม safe ที่จะปล่อยคาไว้แม้ rollback ฝั่ง code เพราะไม่กระทบ query อื่น ถ้าต้อง rollback เต็ม:
   ```sql
   alter table analytics.stg_order_import drop column if exists error_code;
   ```
   ⚠️ ถ้า `/crm/import-errors` ยัง deploy อยู่ (ไม่ได้ revert พร้อมกัน) จะพังทันทีเพราะ query column นี้ตรง — **ต้อง revert code ก่อนแล้วค่อย drop column**

3. **Profit margin 10% → 20% (function replace + one-time UPDATE)** — **rollback ยากสุด เพราะมี side-effect ต่อข้อมูลที่ apply ไปแล้ว**:
   - `create or replace function transform_pending_orders` — revert ฟังก์ชันกลับเป็นเวอร์ชัน 0019 ได้ตรงๆ (มีไฟล์เดิมใน repo อ้างอิง) แต่เปลี่ยนแค่ literal `0.20` → `0.10` ใน INSERT
   - **334 แถวที่ recompute ไปแล้ว (`update ... set profit = round(revenue*0.20,2) where profit_status='estimated'`) ไม่มี "before" เก็บไว้ที่ไหน** — ถ้าต้อง revert เป็น 10% จริง ต้องรันคำสั่งเดียวกันแบบย้อน:
     ```sql
     update analytics.fact_order
       set profit = round(revenue * 0.10, 2), updated_at = now()
       where profit_status = 'estimated';
     ```
   - **เงื่อนไขว่าเมื่อไหร่ควร revert ตัวเลขนี้:** แทบไม่มีเหตุผลทางเทคนิคต้อง revert (ทั้งคู่เป็น estimate ไม่ใช่ fact) — revert เฉพาะกรณีเจ้าของสั่งกลับ decision Q3 เอง (เช่นอยากโชว์ 10% ต่อ) ไม่ใช่กรณี bug เพราะ label "ประมาณการ" กำกับอยู่แล้วทุกจอ ความเสี่ยงคือ UI confusion ไม่ใช่ data corruption
   - ไม่มี trigger ปัญหาอื่นเพราะ `profit_status` ยัง `'estimated'` เสมอ — แถวที่เป็น `'actual'`/`'missing'` (ยังไม่มีจริงตอนนี้) ไม่ถูกแตะโดย UPDATE ทั้งสองทิศทาง

**Rollback code (Vercel):**
- UI/route พัง → `git revert <crm-ui-sha>` (แยก commit ตาม deploy step 1 แล้วจะ revert ได้เฉพาะจุด ไม่กระทบ OMS/TikTok core)
- Deployment Protection หลุดหรือ misconfigured จนหน้าอื่นโดนบล็อกด้วย → Vercel Dashboard → Promote previous deployment (<1 นาที) — เร็วกว่า git revert เมื่อพังฉับพลัน
- **เงื่อนไขถอยทันที ไม่ debug บน preview/prod:** (1) พบว่า `/crm/*` เข้าถึงได้จากภายนอกโดยไม่ผ่าน gate เลย (2) PII (เบอร์/ที่อยู่) แสดงผลให้ role ที่ไม่ควรเห็น (3) ตัวเลข `/crm/overview` เพี้ยนจาก query มือเกิน rounding error ปกติ

---

## Monitoring (30 นาทีแรกหลัง deploy)

- Vercel function logs — error rate ของ route `/crm/*` และ server actions ที่เรียก views
- `/crm/customers` load time — 310 แถว join aggregate ควร < 2-3 วิ (สเกลเดียวกับ TikTok `/tiktok/sales` ที่เคยเทียบ ~700 order/เดือน)
- ดู log/alert ว่ามีการเรียก `/crm/*` จาก IP/UA ที่ไม่ใช่ทีมภายในไหม (ยืนยันว่า Deployment Protection ทำงานจริง ไม่ใช่แค่ตั้งค่าไว้เฉยๆ)
- Supabase Dashboard → Logs → ตรวจว่าไม่มี query error จาก `PGRST106` (แปลว่า schema exposure หลุด) หรือ permission denied จาก view ใหม่

---

## ความเสี่ยงสูงสุด (เรียงตามความสำคัญ)

1. **🔴 PII หลุดสาธารณะ** — service-role client + ไม่มี auth จริง คือความเสี่ยงเดียวที่ทำให้ B1 deploy พลาดแล้วเสียหายจริง (ข้อมูลลูกค้า 310 คน) ไม่ใช่แค่ bug UI — เป็นเหตุผลเดียวที่ล็อก production ไว้ก่อน
2. **schema exposure ลืมทำ** ถ้า deploy ไป DB ใหม่ — ทุก view error ทันที (PGRST106) เข้าใจผิดว่าโค้ดพัง เสียเวลา debug ผิดจุด
3. **`error_code` column กับ code ที่ query มันไม่ sync กัน** ถ้า revert แยกส่วนผิดลำดับ (ต้อง revert code ก่อน drop column เสมอ)
4. **ESLint ไม่มี config** — ไม่ blocker ของ preview แต่เป็นช่องให้ code สไตล์/บั๊กเล็กๆ หลุดผ่านไปสะสม ก่อนเปิด production ควรมี config จริง

---

## Known debt / ยกยอดไป B2 (บันทึกตรงๆ ไม่ปิดบัง)

- **Auth จริงยังไม่มี** — CRM (และ TikTok module) วิ่งบน `DEV_SHOP_ID`/`DEV_ROLE` + service-role client ทั้งคู่ ต้องเปลี่ยนเป็น Supabase Auth + authed client (RLS บังคับจริง) ก่อนเปิด production แบบ public — งานนี้ไม่อยู่ scope B1/B2 design แต่เป็น **blocker เดียวที่สำคัญที่สุด** ของทั้งสองโมดูล
- **Authed client แทน service-role** — ผูกกับข้อข้างบน เมื่อมี auth จริงแล้ว query ทั้งหมดควรวิ่งผ่าน RLS แทนที่จะ bypass
- **ESLint config หาย** — `eslint-config-next` อยู่ใน deps แต่ไม่มี `.eslintrc`/`eslint.config.*` — เพิ่ม config ให้ `npm run lint` ใช้งานได้จริง (ปัจจุบัน lint gate เป็นโมฆะ)
- **PDPA retention job 180 วันของ staging** — ค้างจาก Phase A ยังไม่มี pg_cron job จริง (design ยกเข้า scope B2 แล้ว)
- **`is_new_customer` recompute** — freeze by design ตั้งแต่ 0013, ไม่ recompute ย้อนหลังตอน merge ลูกค้า (B2) → เลขลูกค้าใหม่ย้อนหลังคลาดเคลื่อนเล็กน้อย เป็น optional job ใน B2
- **profit ยังเป็นประมาณการ 20% ทั้งกระดาน** — ไม่มี actual COGS ต่อ SKU (blocker เดิมจาก Phase A ยังไม่ถูกตอบ) ทุกจอต้องคง label "ประมาณการ" ไว้ ห้ามลบออกจนกว่าจะมีต้นทุนจริง
- **cohort/retention view** — เลื่อนไป B3 เพราะ data มีแค่ 1 เดือน ยังไม่มีอะไรให้ดู

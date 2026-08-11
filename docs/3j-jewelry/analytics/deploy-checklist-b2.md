# Deploy Checklist — Phase B2 CRM (Write Layer: Edit / Note / Merge / Retention)

> devops (Lando) · 2026-08-12 · Next.js 15 (App Router) + Supabase Postgres 17 + Vercel
> Scope: migrations **0021-0024** (write RPC + audit + merge + PDPA retention pg_cron) — DB layer only ต่อยอด B1
> ต่อยอดจาก `docs/3j-jewelry/analytics/deploy-checklist-b1.md` — **อ่าน B1 ก่อนไฟล์นี้เสมอ**, ทุกข้อ CRITICAL ของ B1 (service-role client + PII public) ยังบังคับใช้เต็มร้อยในไฟล์นี้ ไม่ถูกยกเลิก
> อ้างอิง: `docs/3j-jewelry/analytics/phase-b-crm-design.md` §2.1-2.7, §3 (Merge Flow)

---

## 🔴 CRITICAL — Security Gate (สืบทอดจาก B1 + เพิ่มของ B2)

**ข้อ CRITICAL ของ B1 ยังคงอยู่ 100% — ไม่มีอะไรใน B2 ทำให้ auth จริงขึ้นมา:**
- ยังไม่มี Supabase Auth จริง — `/crm/*` ยังวิ่งบน service-role client + `DEV_SHOP_ID`/`DEV_ROLE`
- ยังห้าม deploy ขึ้น production domain ที่ public จนกว่าจะมี Deployment Protection/middleware gate หรือ real auth (ดู B1 §CRITICAL ข้อ 1-3 — copy กติกามาใช้ตรงๆ ไม่ต้องเขียนซ้ำที่นี่)

**🔴 สิ่งที่ B2 เปลี่ยน: write surface กว้างขึ้นมาก — ความเสี่ยงถ้า gate หลุดสูงกว่า B1 ทวีคูณ**
B1 คือ "ใครเปิด URL ถึงก็เห็น PID" (read เฉยๆ) B2 เพิ่ม RPC ที่**แก้/ลบ/รวมข้อมูลลูกค้าได้จริง**:
- `crm_set_order_override` / `crm_clear_order_override` — แก้ revenue/discount/channel/province/order_date/bank/tags ของออเดอร์
- `crm_edit_customer` / `crm_edit_pii` — แก้ชื่อ/เบอร์/ที่อยู่ลูกค้าตรงๆ
- `crm_add_note` / `crm_edit_note` / `crm_delete_note`
- `crm_merge_customer` — **ลบแถวลูกค้าจริง** (victim ถูก soft-delete + PII แถว victim ถูกลบทิ้งจริงหลัง merge เข้า pii_customer) + repoint fact_order/identity/address/note/touchpoint ทั้งหมด
- `crm_dismiss_merge_candidate`
- `crm_apply_pii_retention` — **null PII จริงใน `stg_order_import`** (irreversible)

ถ้า gate หลุด (ไม่มี auth/protection) ไม่ใช่แค่ "คนนอกเห็นข้อมูล" แต่ **คนนอกแก้/ลบ/รวมลูกค้าได้เลย** ผ่าน RPC ตรงๆ (RPC ไม่เช็ค caller เป็นใครจริง เพราะยังไม่มี real auth — ดู H1/M1 ด้านล่าง)

**🔴 H1/M1 — real-auth blocker จาก security-auditor (B2a) ที่ยังไม่ resolve:**
- `crm_require_owner_admin` มี short-circuit: `if auth.role() = 'service_role' then return;` — แปลว่า RPC authz ทั้งชุด (`crm_*`) **พึ่ง app-layer `getDevRole` 100%** ไม่มีชั้น DB บังคับจริงตอนนี้ ถ้า app-layer gate หลุด (bug/misconfiguration) RPC เปิดกว้างทันทีไม่มีชั้นสอง
- `crm_audit_log.actor` = `auth.uid()` ซึ่งเป็น `null` เมื่อวิ่งผ่าน service_role — audit ทุกแถวตอนนี้ไม่รู้ว่า "ใคร" กดจริง (รู้แค่ว่ามีคนกด)
- **ต้องแก้ก่อนเปิด real auth (ไม่ใช่ก่อน deploy preview):** ส่ง `p_actor uuid` / `p_actor_role text` explicit เข้าทุก RPC แทนพึ่ง `auth.uid()`/`auth.role()` แล้วยกเลิก service_role short-circuit ใน `crm_require_owner_admin` — เป็น blocker เดียวกับ "ห้าม public production" ของ B1 ไม่ใช่ debt แยก
- [ ] ผู้ตัดสิน go/no-go ของ production ยังเป็น Tech Lead เหมือน B1 — H1/M1 ต้องแก้เสร็จ **ก่อน** เปิด real users ไม่ใช่ก่อน merge preview

---

## Pre-deploy

### 1. Migration sync (DB จริง vs repo)
- [x] DB จริง (project "3J Online Sale", `udqmamplbymxnknkjnkz`) apply ถึง **0024** แล้วผ่าน MCP (0021 write tables+RPC+view swap, 0022 audit append-only trigger + edit_pii profile_source fix, 0023 merge, 0024 retention+pg_cron)
- [x] repo มีไฟล์ **0021-0024 ครบ** (`supabase/migrations/0021_crm_b2a_write.sql` ... `0024_crm_b2c_pii_retention.sql`)
- [ ] ก่อน push ตรวจ `git status supabase/migrations/` ต้องว่าง — ไฟล์ 0021/0023 มี comment "⚠️ DO NOT APPLY — file only" ค้างจากตอน author เขียน (apply ไปแล้วจริงผ่าน MCP รอบก่อน) **ไม่ต้องลบ comment นี้ก่อน push** (เป็น historical note ไม่กระทบ SQL) แต่ถ้าใครอ่านแล้วสับสนว่า "ยัง apply หรือยัง" ให้ยืนยันจาก step 1 (fact ด้านบน) ไม่ใช่จาก comment ในไฟล์
- [ ] **ถ้า deploy ไป Supabase project/DB ใหม่** (preview branch แยก DB): apply 0021→0024 **เรียงลำดับ** (0023 แก้ constraint ที่ 0021 สร้าง, 0024 อ้าง `stg_order_import` จาก schema เดิม) — ห้ามข้าม/สลับลำดับ
- [ ] 0023 มี assumption เสี่ยงที่ author เตือนเอง: `drop constraint if exists crm_audit_log_action_check` เดา default constraint name จาก Postgres — **ยืนยันแล้วว่าถูกบน DB จริง** (apply ผ่านแล้วไม่ error แปลว่าชื่อตรง) แต่ถ้า deploy ไป DB ใหม่ที่ schema ต่างจากนี้เล็กน้อย ให้เช็ค `\d analytics.crm_audit_log` ก่อน apply 0023 ว่า constraint name ยังเป็น `crm_audit_log_action_check` จริง

### 2. 🔴 pg_cron job ใหม่: `crm-pii-retention-180d`
- migration 0024 สร้าง job รัน `analytics.crm_apply_pii_retention()` ทุกวัน **03:30** (server tz) ผ่าน `cron.schedule`
- [x] ตั้งบน DB จริง ("3J Online Sale") แล้วผ่าน MCP พร้อมกับ apply 0024
- [ ] **verify ว่า job อยู่จริงและ active:**
  ```sql
  select jobid, jobname, schedule, active, command from cron.job where jobname = 'crm-pii-retention-180d';
  ```
  คาดผลลัพธ์: 1 แถว, `schedule = '30 3 * * *'`, `active = true`
- [ ] **ถ้า deploy ไป Supabase project/DB ใหม่:** pg_cron extension **ต้อง enable ก่อน** apply 0024 ไม่งั้น `cron.schedule(...)` fail ทันที (function `cron.schedule` ไม่มีจนกว่า extension enable) — Supabase Dashboard → Database → Extensions → ค้นหา `pg_cron` → Enable (หรือ `create extension if not exists pg_cron;` ถ้ามีสิทธิ์ผ่าน SQL editor — บาง plan ต้องเปิดผ่าน Dashboard เท่านั้น)
- [ ] หลัง enable + apply แล้วรัน query verify ด้านบนซ้ำอีกครั้งใน DB ใหม่ เพื่อยืนยันว่า schedule ไม่ได้ silently ล้มเหลว

### 3. Env vars บน Vercel
- [ ] **ไม่มี env var ใหม่สำหรับ B2** — ใช้ชุดเดิมจาก B1 (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DEV_SHOP_ID`, `DEV_ROLE`) ทั้งหมด, ตรวจตามตาราง B1 §3 ว่ายังตั้งครบและถูกต้องบน environment ที่จะ deploy — B2 ไม่เพิ่ม/ลด/เปลี่ยนตัวแปรใดๆ ทั้งสิ้น
- [ ] ยืนยันซ้ำ: `.env.local` gitignored, ไม่มี secret literal ใน `*.ts`/`*.tsx` ที่ commit (`git grep -n "SERVICE_ROLE" -- '*.ts' '*.tsx'` ต้องเจอแค่ `process.env.SUPABASE_SERVICE_ROLE_KEY`)

### 4. Build/verify (ผู้ใช้รันเอง — environment agent ไม่มี Node ใน PATH)
```bash
npm run typecheck && npm run build
```
- [x] `npm run typecheck` ผ่านแล้ว (ยืนยันจาก session ก่อนหน้า ตามที่ Tech Lead แจ้ง)
- [ ] `npm run build` — รันก่อน deploy ทุกครั้ง (ยังไม่ยืนยันในรอบนี้)
- [ ] `npm run lint` ยังรันไม่ได้ — **debt เดิมจาก B1 ไม่ใช่ของใหม่** (`.eslintrc*`/`eslint.config.*` ยังไม่มี) — ไม่ block preview, ต้องแก้ก่อน production จริง (ยกไป known debt)
- [ ] ถ้ามี test ที่ผูก RPC ใหม่ (`supabase/tests` หรือ vitest ฝั่ง `lib/actions/crm*.ts`) รันก่อน push — โดยเฉพาะ `crm_merge_customer` เพราะมี side-effect หลายตารางในทรานแซกชันเดียว ถ้ามี test อัตโนมัติควรรันซ้ำก่อนทุก deploy

### 5. Dependency ใหม่
- [ ] ตรวจ `package.json` diff อีกรอบก่อน push จริงว่าไม่มี dependency ใหม่แอบพ่วงมาจากงานอื่นที่ modified อยู่ก่อนหน้า (เหมือน B1 — B2 เป็น DB-layer ล้วน ไม่ควรมี dependency npm ใหม่เลย)

---

## Deploy steps

1. **Commit แยกก้อน** — แยก migration (`0021`-`0024`) ออกจาก server actions/UI ที่เรียก RPC เหล่านี้ (ถ้ามีของ B2 ใน `lib/actions/crm.ts` / `app/(dashboard)/crm/*`) เพื่อ revert แยกได้
2. **Apply migration ผ่าน MCP ก่อน push code เสมอ** (ทำแล้วบน "3J Online Sale" — ถ้า deploy ไป DB ใหม่ apply ที่นี่ก่อน ตามลำดับ 0021→0024, enable pg_cron ก่อน 0024 ตาม pre-deploy #2)
3. **ยืนยัน Vercel Deployment Protection ยัง on อยู่** (ไม่ใช่แค่ B1 ตอน setup — เช็คซ้ำทุกครั้งก่อน push เพราะ setting หลุดได้ถ้าคนอื่นแก้ project settings)
4. `git push` feature branch → รอ Vercel preview build
5. **เทส gate ทำงานจริง** — เปิด preview URL จาก browser/incognito ที่ไม่ login Vercel org → ต้องโดนกันก่อนเห็นหน้าใดๆ (เหมือน B1 step 5)
6. ตั้ง env vars — **ไม่มีตัวใหม่** (ดู pre-deploy #3) — ยืนยันของเดิมยังอยู่ที่ Preview scope
7. Smoke test บน preview (ดู post-deploy ด้านล่าง) — **โฟกัส write path เพราะเป็นของใหม่ทั้งหมดใน B2**
8. **เงื่อนไข promote ไป production:** เหมือน B1 (protection/auth + smoke test + sign-off) **บวกเพิ่ม: H1/M1 ต้อง resolve แล้วเท่านั้น** ถ้ายังไม่แก้ ห้าม promote แม้ smoke test ผ่านหมด เพราะ write surface (แก้/ลบ/merge) อันตรายกว่า read surface ของ B1 ถ้า gate ชั้นแอปหลุด
9. ⚠️ **อย่า deploy วันศุกร์เย็น** — B2 เพิ่ม destructive operation (retention scrub + merge) ที่ rollback ไม่ได้ ถ้าเกิดปัญหาต้องมีคน monitor/ตัดสินใจได้ทันที ไม่ใช่ค้างข้ามสุดสัปดาห์แล้วค่อยรู้ว่า retention รันไปแล้วกี่รอบ

---

## Post-deploy verify

### Smoke test write path (ของใหม่ทั้งหมดใน B2)
- [ ] **Order override:** `crm_set_order_override` แก้ revenue/province/tags 1 order ทดสอบ → `v_fact_order` (ที่ marts ทุกตัวอ่าน) สะท้อนค่าใหม่ทันที + `is_edited = true` + profit recompute ตามสูตร 20% ของ revenue ใหม่ → `crm_clear_order_override` แล้วค่ากลับเป็น raw เดิม
- [ ] **Customer edit:** `crm_edit_customer` แก้ display_name 1 คน → `profile_source` เปลี่ยนเป็น `manual` → import batch ใหม่ (หรือ retry) ต้อง**ไม่ทับชื่อที่แก้แล้ว** (จุดสำคัญที่สุดของ feature นี้)
- [ ] **PII edit:** `crm_edit_pii` แก้เบอร์/ที่อยู่ 1 คน (owner/admin role เท่านั้น) → `pii_customer` อัปเดต + `profile_source` เป็น `manual` ด้วย (fix จาก M3 ใน 0022)
- [ ] **Note:** add/edit/delete note 1 รอบครบ → เห็นใน customer 360
- [ ] **Merge:** เลือกคู่จาก `v_merge_candidate` (มี candidate จริงไหม? ถ้า query ว่างให้สร้าง test pair มือด้วย SQL ก่อน) → `crm_merge_customer` → ตรวจ: victim `merged_into_id` ชี้ survivor, `fact_order`/`dim_customer_identity`/`dim_address`/`crm_customer_note` ของ victim repoint หมด, `pii_customer` ของ victim ถูกลบ, `crm_merge_decision` มี verdict `merged`
- [ ] **Dismiss:** `crm_dismiss_merge_candidate` 1 คู่ → คู่นั้นหายจาก `v_merge_candidate` รอบถัดไป (verdict `not_same` ไม่เด้งซ้ำ)
- [ ] **Audit เขียนจริงทุก action:**
  ```sql
  select action, entity_type, actor, created_at from analytics.crm_audit_log order by created_at desc limit 20;
  ```
  ตรวจว่าทุก action จาก smoke test ข้างบนมีแถว audit ตรงกัน (`order_override_set/clear`, `customer_edit`, `pii_edit`, `note_add/edit/delete`, `customer_merge`, `merge_dismiss`) — **`actor` จะเป็น `null` เพราะ service-role bypass (รู้ตัวแล้ว = H1/M1, ไม่ใช่บั๊กใหม่)**
- [ ] **Audit append-only จริง:** ลองรัน `update analytics.crm_audit_log set after = '{}' where id = <แถวล่าสุด>;` ด้วยมือ (ผ่าน service-role หรือ SQL editor) → ต้อง raise exception `analytics.crm_audit_log is append-only` (ยืนยัน trigger 0022 ทำงานแม้กับ service_role)

### pg_cron / retention
- [ ] `select * from cron.job where jobname = 'crm-pii-retention-180d';` — active = true (ซ้ำจาก pre-deploy แต่ verify อีกครั้งหลัง deploy code เผื่อมีคน touch DB ระหว่างนั้น)
- [ ] **ไม่ต้องรอ 180 วันเพื่อทดสอบ** — เรียก function ตรงด้วย interval สั้นบน 1 แถวทดสอบเพื่อยืนยัน logic (อย่ารันบนข้อมูลจริงทั้งตาราง):
  ```sql
  select analytics.crm_apply_pii_retention(interval '0 days');
  ```
  ⚠️ **คำสั่งนี้ destructive จริงถ้ามีแถว `transformed` ที่เก่ากว่า `created_at` = now() ทั้งหมด** — รันบน DB จริงเท่ากับ scrub PII ของทุกแถว transformed ที่มีอยู่วันนี้ทันที **ห้ามรันบน "3J Online Sale" โดยไม่คุย Tech Lead ก่อน** ถ้าต้อง smoke test logic ให้ทำบน DB แยก/copy หรือรอ cron รอบจริงแล้วตรวจผลแทน

### RLS / PII (สืบทอด B1)
- [ ] เหมือน B1 — service-role bypass RLS แต่ตรวจ RLS ของตารางใหม่ (`crm_order_override`, `crm_customer_note`, `crm_merge_decision`) ยัง tenant-isolated สำหรับ path ที่ใช้ authed client จริง (ถ้ามี)
- [ ] `crm_audit_log` SELECT policy ยังจำกัด owner/admin เท่านั้น — เทส role staff เห็น audit ว่าง

---

## Rollback plan

**Migration รายตัว — เรียงจากปลอดภัยสุดไปเสี่ยงสุด (ย้อนจาก 0024→0021 ตามลำดับ dependency):**

### 0024 — pg_cron + retention function
```sql
select cron.unschedule('crm-pii-retention-180d');
drop function if exists analytics.crm_apply_pii_retention(interval);
```
✅ ปลอดภัย — หยุด job ในอนาคต แต่ **⚠️ แถวที่ retention scrub ไปแล้วก่อนหน้านี้ (ถ้าเคยรันจริง) กู้คืนไม่ได้** — `raw` ถูกทับด้วย `{"_pdpa_redacted_at": ...}` และคอลัมน์ PII อื่นเป็น `null` ไม่มี "before" เก็บไว้ที่ไหน (ตั้งใจตามดีไซน์ PDPA — ห้ามเก็บ before ของข้อมูลที่ต้องลบ) ถ้าต้อง revert ต้อง**ไม่มีทางทำได้จาก DB** มีแต่กู้จาก backup ของ Supabase ถ้ามี point-in-time recovery

### 0023 — merge
```sql
drop function if exists analytics.crm_dismiss_merge_candidate(uuid, uuid, uuid);
drop function if exists analytics.crm_merge_customer(uuid, uuid, uuid);
drop view if exists analytics.v_merge_candidate;
drop function if exists analytics.crm_normalize_customer_name(text);
alter table analytics.crm_audit_log drop constraint if exists crm_audit_log_action_check;
alter table analytics.crm_audit_log add constraint crm_audit_log_action_check check (
  action in ('order_override_set','order_override_clear','customer_edit','pii_edit','note_add','note_edit','note_delete')
); -- กลับไปเป็นชุด action ของ 0021 (ก่อน customer_merge/merge_dismiss)
drop table if exists analytics.crm_merge_decision;
```
✅ object ตัวมันเอง drop ได้ปลอดภัย **⚠️ แต่ merge ที่รันไปแล้วจริง (`crm_merge_customer` ถูกเรียกและ commit แล้ว) rollback ไม่ได้ทาง SQL** — victim ถูก soft-delete + `pii_customer` ของ victim ถูก **ลบจริง** (ไม่ใช่ soft-delete) + `fact_order`/identity/address/note ถูก repoint ไปแล้ว การ unmerge ต้องทำมือจาก `crm_audit_log.before` (มี snapshot เต็มของทั้ง 2 แถวก่อน merge ตามดีไซน์ §3) — เขียน script กู้เฉพาะกรณี ไม่มี "1 คำสั่ง rollback" สำเร็จรูป

### 0022 — audit hardening
```sql
drop trigger if exists trg_crm_audit_log_append_only on analytics.crm_audit_log;
drop function if exists analytics.crm_audit_log_append_only();
-- crm_edit_pii กลับเป็นเวอร์ชัน 0021 (ไม่ flip profile_source) — ต้อง re-run CREATE OR REPLACE ของ 0021 §"crm_edit_pii" ทับ
```
✅ drop trigger ปลอดภัย ไม่กระทบข้อมูล — แต่ถอยแล้วจะเสีย M2 (audit ไม่ append-only อีก, service_role UPDATE/DELETE audit ได้) และ M3 (ชื่อที่แก้ผ่าน PII edit จะโดน import ทับอีกครั้ง) — ควรถอยเฉพาะกรณี trigger เองมีบั๊ก ไม่ใช่ถอยเพราะกลัว feature

### 0021 — write foundation (ใหญ่สุด rollback ซับซ้อนสุด)
```sql
-- RPCs
drop function if exists analytics.crm_delete_note(uuid);
drop function if exists analytics.crm_edit_note(uuid, text);
drop function if exists analytics.crm_add_note(uuid, text);
drop function if exists analytics.crm_edit_pii(uuid, text, text, jsonb);
drop function if exists analytics.crm_edit_customer(uuid, text);
drop function if exists analytics.crm_clear_order_override(uuid);
drop function if exists analytics.crm_set_order_override(uuid, jsonb, text);
drop function if exists analytics.crm_require_owner_admin(uuid);
-- view: กลับ v_fact_order เป็น passthrough ของ 0020 (ไม่มี override join, ไม่มี is_edited)
create or replace view analytics.v_fact_order with (security_invoker = true) as
  select id, shop_id, oms_order_id, source_order_no, customer_id, channel_id,
    campaign_id_first, campaign_id_last, order_date, paid_at, printed_at, ship_date,
    estimated_delivery_date, province_code, carrier_code, tracking_no, item_count,
    revenue, discount, shipping_fee_customer, shipping_cost_shop, cogs, profit,
    profit_status, payment_method, bank, is_new_customer, tags, created_at, updated_at
  from analytics.fact_order;
-- tables
drop table if exists analytics.crm_customer_note;
drop table if exists analytics.crm_order_override;
drop table if exists analytics.crm_audit_log;
alter table analytics.dim_customer drop column if exists profile_source;
-- transform proc: revert ไปเวอร์ชัน 0020 (ไม่เช็ค profile_source) — มีไฟล์ 0020 อ้างอิงในโค้ด
```
⚠️ **ก่อน drop `v_fact_order` แบบข้างบน ต้อง drop 0023/0022 ก่อนเสมอ** (0023's `v_merge_candidate` join `v_fact_order`, `crm_audit_log` ผูก trigger ของ 0022) — ลำดับ rollback คือ **0024→0023→0022→0021 เท่านั้น ห้ามสลับ**
- **⚠️ ถ้า `crm_order_override` มี override ที่ owner ตั้งไว้จริง (แก้ revenue/province ของออเดอร์จริง) แล้ว drop table ทิ้ง — override หายถาวร** ก่อน drop ต้อง export ข้อมูล override ทั้งหมดออกมาเก็บก่อน (`select * from analytics.crm_order_override;`) ถ้ามีแถวจริง
- Note/PII edit ที่ทำผ่าน `crm_edit_customer`/`crm_edit_pii` แล้ว: **ตัวข้อมูลเอง (display_name/pii_customer ที่แก้แล้ว) ไม่หายเมื่อ drop RPC** เพราะเขียนลง `dim_customer`/`pii_customer` โดยตรง — drop RPC แค่ปิดทางแก้ต่อ ไม่ใช่ revert ค่าที่แก้ไปแล้ว (ถ้าต้อง revert ค่าจริงต้องดึงจาก `crm_audit_log.before` เอง)

**Rollback code (Vercel):**
- UI/server actions ที่เรียก RPC ใหม่พัง → `git revert <b2-ui-sha>` (แยก commit ตาม deploy step 1)
- Deployment Protection หลุด → Vercel Dashboard → Promote previous deployment (<1 นาที)
- **เงื่อนไขถอยทันที ไม่ debug บน preview/prod:** (1) พบว่า RPC ใดๆ เรียกได้โดยไม่ผ่าน gate ของแอป (ทดสอบ direct call ผ่าน anon/authenticated key ควรโดนกันหมดเพราะ revoke แล้ว แต่ verify จริง) (2) merge/retention รันผิดคู่/ผิดช่วงเวลาจนกระทบข้อมูลลูกค้าจริง — หยุด cron/ปิด UI merge ทันที ก่อนสืบสวนสาเหตุ (3) audit หยุดเขียน (พบ write ที่ไม่มี audit row คู่กัน) — เป็นสัญญาณว่า transaction บางจุดหลุด ต้องหยุดฟีเจอร์ทั้งชุดจนกว่าจะรู้สาเหตุ

---

## Monitoring (30 นาทีแรกหลัง deploy)

- Vercel function logs — error rate ของ server actions ที่เรียก `crm_*` RPC (โดยเฉพาะ `crm_merge_customer` ที่แตะหลายตารางในทรานแซกชันเดียว — ถ้า error กลางทางต้องรู้ทันทีว่า rollback อัตโนมัติเพราะอยู่ใน transaction เดียว ไม่ทิ้ง partial state)
- Supabase Dashboard → Logs → Postgres logs — ดู error จาก constraint violation (`chk_crm_merge_decision_ordered`, `uq_crm_merge_decision_pair`) หรือ trigger exception (`crm_audit_log is append-only`) ผิดจังหวะ (ควร fire เฉพาะตอนมีคนพยายาม UPDATE/DELETE audit ตรงๆ ไม่ใช่ตอน insert ปกติ)
- `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname='crm-pii-retention-180d') order by start_time desc limit 5;` — เช็ครอบแรกที่ cron ยิงจริง (ถ้า deploy ตรงกับช่วง 03:30) ว่า `status = 'succeeded'`
- `select count(*) from analytics.crm_audit_log where created_at > now() - interval '30 minutes';` — เทียบกับจำนวน action ที่ทำใน smoke test ต้องตรงกัน ไม่ขาดไม่เกิน
- ถ้าเปิด merge UI ให้คนใช้งานจริงแล้ว (ไม่ใช่แค่ smoke test) — เฝ้า `v_merge_candidate` row count ก่อน/หลัง แต่ละ merge ว่าลดลงตามที่ควร (คู่ที่ merge/dismiss ต้องหายจาก view)

---

## ความเสี่ยงสูงสุด (เรียงตามความสำคัญ)

1. **🔴 write surface ใหม่ + auth ยังไม่จริง (H1/M1)** — ทุกความเสี่ยงของ B1 (PII หลุดสาธารณะ) ยังอยู่ **บวก** ตอนนี้ใครก็ตามที่ผ่าน gate ชั้นแอปได้ (หรือ gate หลุด) แก้/ลบ/รวมข้อมูลลูกค้าได้จริงผ่าน service-role bypass — นี่คือความเสี่ยงเดียวที่สำคัญที่สุดของทั้ง B1+B2 รวมกัน ไม่ใช่แค่ debt
2. **retention destructive + ไม่มี dry-run ที่ปลอดภัย** — `crm_apply_pii_retention` ทดสอบยากเพราะเรียกตรงกระทบข้อมูลจริงทันที (ไม่มี flag "preview only") ต้องระวังเป็นพิเศษเวลา smoke test (ดูคำเตือนใน post-deploy)
3. **merge ผิดคู่ (survivor/victim สลับกัน หรือ merge คนละคนจริง)** — unmerge ไม่มีปุ่ม ต้องทำมือจาก audit log เท่านั้น ถ้า UI ส่ง p_survivor_id/p_victim_id สลับกันจะ soft-delete คนผิด แม้ audit กู้คืนได้แต่เสียเวลา operation จริง
4. **pg_cron ไม่ enable บน DB ใหม่** (ถ้าขยายไป project อื่น) — 0024 apply fail ทันที เข้าใจผิดว่า migration พัง ทั้งที่จริงคือ extension ไม่ enable
5. **ESLint ไม่มี config** — debt สะสมจาก B1 ยังไม่แก้ ยิ่งเสี่ยงขึ้นเมื่อ write path ซับซ้อนขึ้น (bug เชิงโลจิกใน RPC caller ฝั่ง TS หลุดผ่านง่ายขึ้น)

---

## Known debt / ยกยอดไป B3 (บันทึกตรงๆ ไม่ปิดบัง)

- **H1/M1 real-auth blocker (สำคัญที่สุด, สืบทอด+ขยายจาก B1)** — RPC authz พึ่ง app-layer `getDevRole` ทั้งหมด เพราะ `crm_require_owner_admin` short-circuit ให้ `service_role`; audit `actor` เป็น `null` เสมอใต้ service role — ต้องส่ง `p_actor`/`p_actor_role` explicit เข้า RPC + ยกเลิก short-circuit ก่อนเปิด real users
- **ESLint config หาย** — ยกมาจาก B1 ยังไม่แก้
- **Unmerge เป็น manual เท่านั้น** — ไม่มี UI/RPC unmerge ตามดีไซน์ (§3) ต้องทำมือจาก `crm_audit_log.before` ทุกครั้ง
- **Order override เป็น full-replace ไม่ merge patch** — `crm_set_order_override` เขียนทับ `overrides` jsonb ทั้งก้อนทุกครั้ง (ไม่ merge key เดิม+ใหม่) — UI ต้องส่ง whitelist keys ครบทุกครั้งที่เรียก ไม่งั้น override เก่าที่ไม่ได้ส่งมาหายไปเงียบๆ (ไม่ error แต่ผลลัพธ์ผิดถ้า caller เข้าใจผิดว่าเป็น partial update)
- **retention/merge ไม่มี dry-run mode** — ต้องระวังเป็นพิเศษเวลาทดสอบบน DB จริง ("3J Online Sale") เพราะไม่มีทาง preview ผลก่อน commit จริง
- **`is_new_customer` ไม่ recompute หลัง merge** — freeze by design ตั้งแต่ 0013 (ยกมาจาก design doc §3) — เลขลูกค้าใหม่ย้อนหลังคลาดเคลื่อนเล็กน้อยหลัง merge เป็น optional job ค้างไป B3
- **profit ยังเป็นประมาณการ 20%** — ยกมาจาก B1 (blocker เดิม: ยังไม่มี actual COGS ต่อ SKU)

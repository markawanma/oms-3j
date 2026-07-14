# OMS — Phase 1 Technical Design

> Order Management System รวมออเดอร์ Shopee / Lazada / TikTok Shop (FB = ไว้ทีหลัง)
> Stack: Next.js (App Router) + Supabase (Postgres + Auth + Storage + Realtime) + Vercel
> ไทย · THB · Asia/Bangkok (เก็บ `timestamptz` UTC แปลงตอนแสดงผล)
> สถานะ: **DESIGN ONLY** — ยังไม่มี production code · credentials marketplace ยังไม่ครบ (ใช้ mock/sandbox)

---

## 1. Data Model

### ER (แกน)
```
shop 1─* shop_member                       (RLS: user เห็นเฉพาะ shop ตัวเอง)
shop 1─* channel_account *─1 channel        (channel = reference table เพิ่ม channel ใหม่ = INSERT)
shop 1─* product 1─1 central_stock
product 1─* product_mapping *─1 channel_account   (map master SKU ↔ item ของแต่ละช่องทาง)
channel_account 1─* orders 1─* order_item
orders 1─* shipment *─1 carrier             (carrier = reference table, รองรับ label 2 แหล่ง)
product 1─* stock_ledger  (append-only audit)
shop 1─* sync_job         (pg-backed queue)
```

### Decisions ที่ฝังใน schema
- **`channel` / `carrier` เป็น reference table ไม่ใช่ enum** → เพิ่ม Shopee/FB/ขนส่งใหม่ = `INSERT` ไม่ต้อง migrate
- **Secret ไม่อยู่ใน table** → `channel_account.credential_ref` ชี้ไป **Supabase Vault** เท่านั้น (security-auditor รับช่วง rotation/encryption)
- **`shipment` แยกจาก `orders`** → 1 order มีได้หลาย package + field `label_source` (`marketplace` / `direct_api` / `manual`) รองรับ label ผสมทั้งสองทาง
- **Multi-tenant ตั้งแต่แรก** → ทุก table มี `shop_id` + RLS `shop_id IN (SELECT shop_id FROM shop_member WHERE user_id = auth.uid())`
- **`central_stock` เก็บ `qty_on_hand` + `qty_reserved`** → `available = on_hand - reserved` คำนวณตอน query (ไม่เก็บซ้ำ)

> DDL เต็ม (ตาราง + index + constraint + RPC) อยู่ในภาคผนวก A ท้ายเอกสาร

---

## 2. Central Stock — กัน Race Condition / Overselling (หัวใจ)

### กลไกที่เลือก: **Atomic Conditional UPDATE** (ห่อใน Postgres function เรียกผ่าน RPC)
```sql
UPDATE central_stock
SET qty_reserved = qty_reserved + :n
WHERE product_id = :pid
  AND qty_on_hand - qty_reserved >= :n   -- เงื่อนไขกัน oversell
RETURNING *;                              -- 0 rows = ของไม่พอ → ปฏิเสธ
```
**ทำไมเลือกแบบนี้** (เทียบกับ `SELECT FOR UPDATE` / advisory lock): statement เดียว atomic โดยธรรมชาติ, race window = 0, row lock สั้นที่สุด, ตรวจ fail ง่าย (0 rows) — Postgres serialize UPDATE บน row เดียวกันให้เอง

### กำแพงกัน oversell 3 ชั้น
1. เงื่อนไข `qty_on_hand - qty_reserved >= n` ใน UPDATE
2. DB `CHECK (qty_reserved <= qty_on_hand)` — โค้ด bug แค่ไหนก็ทะลุ DB ไม่ได้
3. `stock_ledger UNIQUE(shop_id, idempotency_key)` — webhook ส่งซ้ำ/worker retry ตัดสต็อกได้ครั้งเดียว (ledger insert อยู่ **ใน transaction เดียวกับ** UPDATE stock)

### Reservation แบบ 2-phase (ไม่ hard-decrement)
```
available ──reserve(order new)──▶ reserved ──commit(shipped)──▶ committed (on_hand -n)
    ▲                                │
    └────────── release(cancel) ─────┘
```
**เหตุผล:** marketplace มีสถานะ `unpaid`/COD ที่ยกเลิกบ่อย (ยืนยันจาก docs — Shopee `UNPAID`, Lazada `unpaid`, TikTok `unpaid/on_hold`) → hard-decrement แล้ว restock ทำให้ ledger สับสน + เปิดหน้าต่าง overshoot ตอน sync กลับ

### Cross-platform race — ความจริงที่ต้องยอมรับ
marketplace ตัดสต็อกฝั่งเขาเองไปแล้วตอนลูกค้ากดสั่ง OMS ทำได้แค่ให้ "คนแรกที่เข้าระบบ" ได้ของ คนที่สอง reserve ไม่ผ่าน → `oversold_hold` → แจ้งเตือน + push stock=จริง กลับทุก channel ให้เร็วที่สุดเพื่อย่อหน้าต่าง race **(ยิ่ง sync ถี่ยิ่ง oversell น้อย — ดูรอบ polling ข้อ 4)**

---

## 3. Order State Machine
```
new ─▶ confirmed ─▶ to_ship ─▶ shipped ─▶ completed
 └─(reserve fail / SKU ไม่ map)─▶ oversold_hold ─▶ cancelled
 (any ก่อน shipped) ─▶ cancelled
```
| Transition | Trigger | Stock effect |
|---|---|---|
| → new | order ingest สำเร็จ | `reserve` |
| new → oversold_hold | reserve fail / SKU ไม่ map | — |
| new → confirmed | marketplace ยืนยัน/ชำระ | — |
| confirmed → to_ship | เรียก label สำเร็จ | — |
| to_ship → shipped | confirm shipment | `commit` |
| any(ก่อน shipped) → cancelled | buyer/system cancel | `release` |

Transition validate ใน DB trigger (กัน webhook มาสลับลำดับเขียนสถานะถอยหลัง) เก็บ `external_status` ดิบไว้เทียบเสมอ

### Status mapping (implement ใน adapter — verified กับ docs)
| Canonical | Shopee | Lazada | TikTok Shop |
|---|---|---|---|
| new | UNPAID | unpaid/pending | UNPAID / ON_HOLD |
| confirmed | READY_TO_SHIP | packed | AWAITING_SHIPMENT |
| to_ship | PROCESSED | ready_to_ship | AWAITING_COLLECTION |
| shipped | SHIPPED | shipped | IN_TRANSIT |
| completed | COMPLETED | delivered | DELIVERED / COMPLETED |
| cancelled | CANCELLED / IN_CANCEL | canceled | CANCELLED |

---

## 4. Connector + Queue Architecture

### Adapter interface (mock ได้เมื่อ `channel_account.is_sandbox`)
```typescript
interface MarketplaceConnector {
  channelCode: 'shopee' | 'lazada' | 'tiktok';
  pullOrders(since: Date): Promise<CanonicalOrder[]>;      // fallback poll
  parseWebhook(raw: unknown): CanonicalOrderEvent | null;  // verify signature ก่อน
  pushStock(items): Promise<PushResult[]>;
  confirmShipment(externalOrderId, pkg): Promise<void>;
  getShippingLabel(externalOrderId): Promise<{ pdf: Buffer }>;
  mapStatus(externalStatus: string): OrderStatus;
}
```

### Queue บน Vercel (ไม่มี long-running worker)
- **pg-backed queue (`sync_job`) + pg_cron ทุก 1 นาที → Supabase Edge Function "worker"** claim งานด้วย `FOR UPDATE SKIP LOCKED`, retry แบบ exponential backoff (`run_at`), เกิน `max_attempts` → `dead`
- Webhook = Next.js Route Handler → verify signature → `INSERT sync_job` → ตอบ 200 ทันที (ห้ามทำงานหนักใน request; marketplace timeout สั้น)
- Idempotency 3 ชั้น: `sync_job UNIQUE(job_type, idem_key)` → `orders UNIQUE(channel_account_id, external_order_id)` → `stock_ledger UNIQUE(shop_id, idem_key)`
- **Trade-off ที่ตัดทิ้ง:** external queue (QStash/SQS) latency ต่ำกว่าแต่เพิ่ม vendor + sync state ข้ามระบบ; pg queue enqueue+upsert order atomic ในทรานแซกชันเดียว ที่ volume Phase 1 พอ — interface ไม่เปลี่ยนถ้าจะย้ายทีหลัง

---

## 5. Marketplace API Spec (verified — docs-researcher)

| เกณฑ์ | Shopee | Lazada | TikTok Shop |
|---|---|---|---|
| Auth | OAuth2 + **HMAC-SHA256 sign ทุก request** | OAuth2 + **HMAC-SHA256** (Alibaba TOP) | OAuth2 Bearer (`x-tts-access-token`) — ง่ายสุด |
| Access token | 4 ชม. (refresh ~30 วัน) | ⚠️ ไม่ระบุ | ⚠️ ไม่ระบุ |
| Pull orders | `POST /order/get_order_list` + `get_order_detail` | `GET /order/get` | `GET /order/202309/orders` (limit 100) |
| Ship / tracking | `POST /logistics/ship_order` (+batch) | `POST /order/rts` | Logistics API (⚠️ ชื่อ endpoint ต้อง confirm) |
| Shipping label | ⚠️ **endpoint ไม่ยืนยัน** | `GET /order/document/awb/html/get` (PrintAWB) | `GET /package/{id}/shipping_document/202309` |
| Webhook | ✓ ORDER_STATUS_UPDATE | ✓ order_status_changed | ✓ order.created / status_updated |
| Rate limit | **~1.67 req/s** (100/นาที) — ต่ำสุด | 10 QPS/seller | 50 req/s |
| Sandbox | ✓ (ต้อง audit) | ✓ (เตรียม test account) | ✓ (ง่ายสุด, test token) |

**ลำดับ implement ที่แนะนำ:** TikTok → Lazada → Shopee (ตาม auth complexity + rate limit + ความชัดของ doc)

**Docs links หลัก:** Lazada `open.lazada.com/apps/doc/api` · TikTok `partner.tiktokshop.com/docv2` · Shopee `open.shopee.com/documents`

---

## 6. Technical Debt / Risk ที่บันทึกไว้ตรงๆ

| # | เรื่อง | ผลกระทบ | แผน |
|---|---|---|---|
| R1 | **Shopee shipping label endpoint ไม่ยืนยันจาก doc** | requirement "พิมพ์ label ทุกขนส่ง" อาจติดที่ Shopee | ยืนยันตอนได้ credentials / Shopee dev support ก่อน Phase 4 |
| R2 | Token expiry ของ Lazada/TikTok ไม่ระบุ | refresh logic ออกแบบ blind | ทดสอบใน sandbox ตอนได้ key |
| R3 | Rate limit Shopee 1.67 req/s ต่ำ | pull ออเดอร์เยอะช้า | worker throttle **ต่อ channel_account** + พึ่ง webhook เป็นหลัก poll เป็น backup |
| R4 | TikTok confirm-shipment flow แยก (AWAITING_COLLECTION) | ลำดับ ≠ Shopee | adapter แยก logic ต่อ channel |
| R5 | webhook signature scheme ต่างกันทุกเจ้า | เสี่ยง forged webhook | verify signature **ก่อน** insert job เสมอ |
| R6 | Vercel ไม่มี worker → pg_cron polling 1 นาที | latency + หน้าต่าง cross-platform race | รับได้ที่ volume Phase 1; โตแล้วย้าย external queue |

---

## 7. Scope Phase 1 + สมมติฐาน
- คลังเดียวต่อ shop (`central_stock` PK = product_id) — multi-warehouse = YAGNI
- ไม่มี bundle/combo SKU (1 order_item = 1 master SKU)
- FB channel = ไว้ทีหลัง (schema รองรับเพิ่ม channel ได้แล้ว)
- เงิน `numeric(12,2)` THB · timestamp `timestamptz` UTC

## 8. Decisions (เคลียร์แล้ว — ล็อคสำหรับ Phase 2)
| # | Decision | ผลต่อ implement |
|---|---|---|
| D1 | **Unpaid = reserve ทันที + TTL auto-release** | ต้องมี job `release_expired` (pg_cron) ปล่อย reserve ที่เกิน TTL · **default TTL = 48 ชม. ตั้งค่าต่อ channel ได้** (marketplace เองก็ auto-cancel unpaid อยู่แล้ว — ตั้ง TTL ให้ ≥ ของ platform กัน release ก่อนเวลา) |
| D2 | **oversold_hold = manual review** | ไม่ auto-cancel · แจ้งเตือนแอดมิน + หน้า UI ให้กด cancel/หาของทดแทน (ปลอดภัยต่อ shop rating) |
| D3 | **Return/refund = Phase หลัง** | Phase 2 เผื่อ enum `stock_move_type` ให้เติม `return_in` ได้ แต่ยังไม่ทำ logic |
| D4 | **Volume หลักร้อย–พัน/วัน** | pg-backed queue + pg_cron 1 นาที ตาม design — ยังไม่ต้อง external queue (interface ไม่เปลี่ยนถ้าโตแล้วย้าย) |

---

## 9. Webhook Security — Go-Live Gates (CEO decision, red-team #1)

red-team (Vader) เจอ Critical: webhook เป็น binary trap (prod=501 ใช้ไม่ได้ / sandbox=เปลือย forgeable) → cross-tenant sabotage + inventory-lock DoS. CEO ตัดสิน **"A เข้มขึ้น"**:

**ทำแล้วใน batch นี้ (P0):** webhook fail-closed by default ทั้งสอง mode — prod ปฏิเสธทุก request, sandbox ต้องมี `WEBHOOK_SANDBOX_SECRET` (constant-time); + #2 tx-wrap upsertCanonicalOrder + #5 mapStatus ห้าม default `"new"` + #4 normalize response กัน enumeration

**Blocking go-live gates ของ batch connector (บังคับในโค้ด ไม่ใช่ note — code-reviewer ตีตกได้):**
- **G-1** connector ที่ไม่มี signature verifier ต้อง register/ประมวลผล webhook **ไม่ได้เชิงโครงสร้าง** (fail-closed by default)
- **G-2** per-marketplace HMAC signature verify (Shopee/TikTok/Lazada) ต่อ channel_account + secret จาก Vault — ยกระดับ **R5** จาก risk note เป็น enforced gate
- **G-3** per-account sandbox isolation (ไม่ใช่ global env)
- **G-4** rate limit + idem_key derive จาก **signed delivery id** ไม่ใช่ `occurredAt` ที่ client คุม (#3)
- **Go/no-go:** ห้ามต่อ webhook marketplace จริงจนกว่า signature verify ผ่าน sandbox credentials จริง + security-auditor เซ็น — ต่อให้เร่งไลฟ์แค่ไหน

## ภาคผนวก A — DDL เต็ม
> (schema จาก architect — สร้างตามลำดับ: enums → shop/member → channel/carrier → channel_account → product → central_stock → stock_ledger → orders → order_item → shipment → sync_job → RLS → RPC `reserve_stock`)

ไฟล์ migration ที่จะเกิดตอน Phase 2:
`supabase/migrations/0001_core_schema.sql` · `0002_rls.sql` · `0003_stock_functions.sql`
`packages/connectors/{types,registry,shopee,lazada,tiktok,mock}.ts`
`app/api/webhooks/[channel]/route.ts` · `supabase/functions/sync-worker/index.ts`

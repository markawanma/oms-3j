# Webhook Signature Verification — Research (P2, เตรียมล่วงหน้าสำหรับ batch connector)

> รวบรวมโดย docs-researcher ตามคำสั่ง CEO (ตัด lead time ของ critical path ตอน credentials มา)
> ใช้กับ go-live gates G-2 (per-marketplace HMAC verify) + G-4 (idem_key จาก signed payload) ใน [phase1-design.md §9](phase1-design.md)
> ⚠️ ทั้งหมดยังต้อง **ยืนยันซ้ำกับ Partner Center จริง** ตอนได้ credentials — บาง doc เข้าไม่ได้/ไม่ระบุชัด

## ตารางเทียบ 3 marketplace

| ด้าน | Shopee | TikTok Shop | Lazada |
|------|--------|-------------|--------|
| Header | `x-shopee-signature` | `TikTok-Signature` | `x-lazada-signature` |
| Format | hex เดี่ยว | `t=<ts>,s=<hex>` | hex เดี่ยว |
| Algorithm | HMAC-SHA256 | HMAC-SHA256 | HMAC-SHA256 |
| Secret | `partner_key` | `client_secret` | `app_secret` |
| String to sign | **raw body (exact bytes)** | `{timestamp}.{raw body}` | **raw body (exact bytes)** |
| Replay protection | ⚠️ ไม่ระบุใน doc | ✅ timestamp ใน signed payload (reject > 5 นาที) | ⚠️ ไม่ระบุ (doc 404) |
| Idempotency | ⚠️ ใช้ `order_sn` จาก payload | ✅ at-least-once → dedup ด้วย `event_id` | ⚠️ ใช้ `event_id` จาก payload |

## Implementation gotchas (สำคัญตอนเขียน verify)
1. **Raw bytes เท่านั้น** — Shopee/Lazada sign จาก raw body ห้าม parse JSON แล้ว re-stringify (byte เปลี่ยน sig พัง). ใน Next.js Route Handler ต้องอ่าน `await req.text()`/raw ก่อน `JSON.parse`
2. **Timing-safe compare** — ใช้ `crypto.timingSafeEqual` ไม่ใช่ `===`
3. **TikTok replay** — reject ถ้า `abs(now - t) > 5min`; ต่อ idempotency ด้วย `event_id`
4. **idem_key ต้องมาจาก signed payload เท่านั้น** (ปิด red-team #3) — ห้าม derive จาก field ที่ client คุม (เช่น `occurredAt` ปัจจุบัน)

## ช่องที่ต้องยืนยันตอนได้ credentials (blocking ก่อน G-2)
- **Lazada**: official doc (open.lazada.com) เข้าไม่ได้ (404/ต้อง login) → ยืนยัน scheme + replay ผ่าน Partner Center ตรง
- **Shopee/Lazada replay**: หา timestamp field ใน payload structure (ยังไม่ยืนยัน)
- **Test vectors**: ไม่มี public ทั้ง 3 เจ้า → generate เองจาก sandbox / Partner Center testing tool
- **TikTok `event_id`**: ยืนยันชื่อ field ใน payload จริง

## Official sources
- TikTok: `developers.tiktok.com/doc/webhooks-verification` (ยืนยันได้)
- Shopee: `open.shopee.com/documents` (ต้อง login) + SDK อ้างอิง `minchao/shopee-php`
- Lazada: `open.lazada.com/apps/doc` (404 ตอนค้น — ต้อง login)

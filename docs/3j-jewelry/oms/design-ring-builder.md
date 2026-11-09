# Design: Ring Builder ("ออกแบบแหวนแถวเอง") — `/ring-builder`

> สำหรับบันทึกเป็น `docs/3j-jewelry/oms/design-ring-builder.md` · architect (Yoda) · 9 พ.ย. 69 · สถานะ: **รอเจ้าของตอบคำถาม §10 ก่อน implement**
> ตัวเลขเงินทุกตัวในเอกสารนี้เป็น**ตัวอย่างของเจ้าของ** (ตัวเรือน 480 · พลอย 80/120 THB) ไม่ใช่ราคาจริง · ค่าที่ยังไม่มีเขียนเป็น `[ต้องยืนยัน: …]`

---

## 0.1 มติ Tech Lead ตอนรวม design + workflow (9 พ.ย. 69 · รอเจ้าของยืนยันข้อที่ติด ❓)

workflow ฝั่งพฤติกรรมผู้ใช้ = `docs/3j-jewelry/oms/workflow-ring-builder.md` (Padmé) · ฝั่งระบบ = เอกสารนี้ §15 · ขัดกันให้ถือตามตารางนี้

| เรื่อง | workflow เสนอ | design เสนอ | ตัดสิน | เหตุผล |
|---|---|---|---|---|
| 3D | Q1: เปิดรอบแรก 2D รอไฟล์ 3D | procedural จากรูป+ตัวเลข (ต่อยอด preview ของ Sabé) | **design** — P1 เป็น 2D เป็นฐาน · P2a spike 3D คู่ขนาน | workflow เขียนก่อนรู้ว่ามี preview WebGL ในรีโป · ไม่ต้องจ้างขึ้นโมเดล |
| QR ในรูปสรุป | รหัสล้วน | URL `/ring-builder?c=` | **รหัสล้วน** ❓ (Q7 design) | รูปลูกค้าอาจถูกโพสต์ซ้ำบน TikTok/Shopee → QR ที่เป็นลิงก์ = พาออกนอกแพลตฟอร์ม · เลือกแล้วแก้ไม่ได้ (รูปค้างในแชท) จึงเริ่มแบบปลอดภัย · `?c=` ฝั่งหน้าเว็บยังทำได้ภายหลังโดยไม่กระทบรหัส |
| ชื่อหน้าหลังบ้าน | `/ring-design` | `/catalog/ring-builder` | **`/catalog/ring-builder`** | อยู่หมวดแคตตาล็อกเดิม · ไม่อยู่ใต้ path สาธารณะ |
| ทิศ "ตำแหน่ง 1" | ซ้าย→ขวา มองตรงหน้าแหวน (มุมคนอื่นมอง) | Q2 รอเจ้าของ | **ใช้ของ workflow ชั่วคราว** ❓ ต้องยืนยันกับช่าง | กระทบการฝังจริง · พิมพ์ทิศบนรูปและหน้าตรวจทุกที่ |
| กลับจาก `/ring-size` | ลิงก์กลับ + อ่านผลวัดล่าสุด | ไม่แตะ /ring-size | **P1 ไม่แตะ /ring-size** — ดราฟต์ใน localStorage + ปุ่ม Back · ลิงก์กลับเป็นงานแยกทีหลัง | หน้า /ring-size อยู่บน prod + มีสถิติ แก้ = QA L เพิ่ม |
| ชนิดพลอยสี (แท้/CZ สี) | Q4 ด่านก่อนเปิดสาธารณะ | — | **ด่านก่อนเปิด** ❓ | กฎแบรนด์: บอกชัดทุกครั้งว่า CZ หรือพลอยแท้ |

---

## 0. สรุปสั้น

| เรื่อง | ตัดสิน | เหตุผลหลัก |
|---|---|---|
| รหัสสั่งทำ | **(a) token ลงลายเซ็น HMAC แบบ stateless** โดยให้ **server คิดราคาแล้วเป็นคนเซ็น** | ไม่มีช่องให้คนนอกเขียน DB เลย ⇒ ตัดปัญหาโดนยิงถล่ม, ตัวตัดวงจร (breaker) โดนยิงจนเต็ม และเรื่อง PDPA ของ IP hash ได้ทั้งชุด |
| 3D | **WebGL ดิบที่ต่อยอดจาก preview ของ Sabé** (สร้างโมเดลตามพารามิเตอร์ของแต่ละแบบ) · **ไม่ใส่ three.js** | ของเดิมพิสูจน์แล้วว่าใช้ได้ · bundle ราว 5–10 KB gz เทียบกับ three.js ราว 130–170 KB gz · เปลี่ยนสีพลอยรายเม็ดทำได้ง่ายมาก |
| ลำดับ | **P1 = 2D + ราคา + รหัส + เซฟรูป + ส่ง LINE** → P2 = 3D → P3 = GLB ต่อแบบ / ผูก BOM | หน้าแบบ 2D ต้องทำอยู่แล้วเป็น fallback ตอนไม่มี WebGL · ส่วนที่เสี่ยงที่สุดคือราคาและรหัส จึงควรได้ทดสอบก่อน |
| ราคาต้นทุนพลอย (0190) | **ไม่ผูกใน P1-P2** · ตารางราคาขายแยกต่างหาก · ฟังก์ชันอ่านสาธารณะเป็น `SECURITY INVOKER` ที่รันในฐานะ `service_role` ซึ่ง**ไม่มีสิทธิ์**อ่าน `gem_item_price` | พิสูจน์ด้วยสิทธิ์ของ role ไม่ต้องพึ่งวินัยคนเขียน — ถ้าวันหน้ามีคน join ตารางต้นทุนเข้ามา จะได้ 42501 แทนที่ข้อมูลจะหลุด |

---

## 1. Design overview + data flow

```
[แอดมิน /catalog/ring-builder]  (gated + isOwnerOrAdmin ทุก action + RPC ตรวจ actor อีกชั้น)
   ตั้งค่า แบบ / รูป / ราคาตัวเรือน / ชนิดพลอย / ราคาต่อขนาด มม.  ──▶  analytics.rb_*  (ราคาเก็บแบบ insert-only)
   ตรวจรหัส  ──▶  verify HMAC ใน TS  ──▶  rb_code_check() = ราคา ณ ตอนสร้าง (จากประวัติ) + ราคาปัจจุบัน + ส่วนต่าง

[ลูกค้า /ring-builder]  (exempt แบบ exact path · noindex · ไม่มี "use server")
   page.tsx (server) ──service role──▶ rb_public_catalog()  ──▶ PublicCatalog (ประกอบทีละ field, allowlist)
   Client: เลือกแบบ → ไซซ์ → เลือกพลอยทีละตำแหน่ง/ลากสลับ → ราคาแสดงสด (บวกเลขที่ server ส่งมา ไม่มีสูตรเอง)
   กด "บันทึก/ส่งสั่งทำ" ──POST──▶ /api/ring-builder/quote (read-only)
        ด่าน: same-origin → body ≤ 512B → schema → rb_quote() (DB คิดราคาสด ณ วินาทีที่เป็นจำนวนเต็ม) 
        → ราคาไม่ตรง expectedTotal → 409 พร้อมราคาใหม่ (ลูกค้ายืนยันก่อน)
        → ตรง → เซ็น HMAC → { code, total, lines, pricedAt }
   Client: วาดรูปบน 2D canvas (ภาพ 3D/2D + สรุปเป็นตัวหนังสือ + QR + รหัส) → Web Share files / กดค้างเพื่อบันทึก
           + คัดลอกข้อความสรุปพร้อมรหัส → เปิด LINE (copyThenOpen แบบเดียวกับ /ring-size)
```

หลักที่ยึดไว้
- **ราคาที่อยู่ในรูป = ราคาในรหัส = ราคาที่ DB คิด ณ วินาทีที่ออกรหัส** — ทำให้จริงได้ด้วย 409 handshake
- client ไม่มีสิทธิ์ตัดสินราคา ทำได้แค่แสดงผลรวมของเลขที่ server ส่งมา (หลักเดียวกับ `aggregateQuotePreview`)

---

## 2. รหัสสั่งทำ — (a) stateless HMAC vs (b) แถวใน DB

| | (a) HMAC stateless ✅ | (b) บันทึกแถวผ่าน route สาธารณะ |
|---|---|---|
| ช่องเขียนสาธารณะ | **ไม่มี** (endpoint อ่านอย่างเดียว) | มี ต้องใช้ form token + honeypot + breaker ต่อร้าน |
| โดนยิงถล่ม | แค่ภาระฝั่งอ่าน (RPC เล็ก 1 ครั้งต่อคำขอ) | breaker เต็ม = ลูกค้าจริงออกรหัสไม่ได้ (DoS) · ถ้าจะกันต่อ IP ต้องเก็บ IP hash ซึ่งเจออุปสรรค PDPA (design-gem-quiz §5.4) |
| ความยาวรหัส | 37–41 ตัว (Crockford base32) | 8–10 ตัว |
| ปลอม/แก้ | แก้บิตไหน HMAC ก็ล้ม | เดาไม่ได้ แต่ต้องกันการไล่ enumerate |
| ข้อเสีย | ยาว · หมุน secret = รหัสเก่าตรวจไม่ได้ · ต้องเก็บราคาแบบมีประวัติ | ตารางขยะ · ต้องมีงานลบข้อมูลตามรอบ · ภาระ security มากกว่า |

**เลือก (a)** — รหัสยาวไม่ใช่ปัญหาจริง เพราะทางหลักที่รหัสเดินทางคือ (1) ข้อความที่ copyThenOpen แปะลงแชท (แอดมินคัดลอกไปวาง) และ (2) QR ในรูป · มีแค่กรณีลูกค้าส่งรูปมาอย่างเดียวที่ต้องสแกน QR · หน้าตรวจรับวางได้ทั้งข้อความ LINE ทั้งก้อน ทั้ง URL ทั้งรหัส (ดึงด้วย regex `3J-[0-9A-Z-]+`)

### 2.1 Format (บิต → Crockford base32 ตัวพิมพ์ใหญ่ ใส่ขีดทุก 5 ตัว นำหน้าด้วย `3J-`)

| field | bits | หมายเหตุ |
|---|---|---|
| ver | 4 | `1` · ใช้ผูกกับรุ่นของ secret ตอนหมุนคีย์ |
| design_no | 12 | เลขถาวรของแบบ (≤ 4095) **ห้ามนำเลขกลับมาใช้ซ้ำ** |
| size_idx | 5 | ไซซ์ − 45 (0..23) · ค่าเกิน 23 = ปฏิเสธ |
| n | 3 | จำนวนเม็ด 3..7 · ต้องตรงกับ `stone_count` ของแบบ |
| positions | 10×n | `stone_no` (0 = CZ ขาว ค่าเริ่มต้น) |
| total_thb | 18 | ≤ 262,143 · `[ต้องยืนยัน: ราคาเป็นจำนวนเต็มบาทเสมอ]` |
| priced_at | 31 | วินาทีนับจาก 2026-01-01T00:00Z (ใช้ได้ราว 68 ปี) — **ค่ามาจาก DB ไม่ใช่นาฬิกาของ server** |
| tag | 60 | `HMAC-SHA256(RING_BUILDER_CODE_SECRET, "rb"‖ver‖payload)` ตัดเหลือ 60 บิต |

ความยาว: 5 เม็ด = 183 บิต → 37 ตัว · 7 เม็ด = 203 บิต → 41 ตัว · บิตเติมท้ายต้องเป็น 0 (รูปแบบ canonical) · decoder แปลง I/L→1, O→0, ตัวเล็ก→ใหญ่ และตัดช่องว่าง/ขีด · ตัวอักษรนอกชุด (รวม U) = ปฏิเสธ

**วินาทีที่เป็นจำนวนเต็ม** (กันการเตือนผิดเมื่อราคาเปลี่ยนในวินาทีเดียวกับที่ออกรหัส): แถวราคาใหม่มี `effective_from = date_trunc('second', now()) + 1s` · `rb_quote` คิดราคา ณ `date_trunc('second', now())` · ตอนตรวจคิดย้อนด้วยวินาทีเดียวกัน ⇒ ได้ผลตรงกันเป๊ะ

**QR ในรูป** = `${APP_ORIGIN}/ring-builder?c=<code>` (ค่าเริ่ม — รอคำถาม Q7) · หน้าสาธารณะอ่าน `?c=` แบบไม่ตรวจลายเซ็น (เพราะไม่มี secret ฝั่ง client) เพื่อโหลดแบบเดิมให้ดูต่อ **ด้วยราคาปัจจุบัน** · error correction M · byte mode ราว 80 ตัวอักษร ≈ version 5

**secret**: env `RING_BUILDER_CODE_SECRET` (≥ 32 ตัว ไม่มีหรือสั้นเกิน = 503 fail closed) **แยกจาก** `GEM_QUIZ_TOKEN_SECRET` · ไฟล์ `code-sign.ts` ขึ้นต้นด้วย `import "server-only"`

---

## 3. Data model (สคีมา `analytics` · service_role เท่านั้น · RLS เปิดโดยไม่มี policy · ปฏิบัติตาม `3j-migration-traps` ครบ)

เลข migration = เลขว่างถัดไปตอน implement (ตอนนี้ origin/main ถึง 0195) · ชุดทดสอบไฟล์ `scripts/verify/verify-NNNN.sql` แบบ do-block แล้ว raise เพื่อ rollback

| ตาราง | คอลัมน์หลัก | กติกา |
|---|---|---|
| `rb_design` | id, shop_id, **design_no** smallint unique/shop, name, **stone_count** (3..7), **stone_size_mm** numeric(4,2) (CHECK `not(between)` กัน NaN), size_min/size_max (ค่าเริ่ม 45/68 ต้องอยู่ในช่วงร้าน — รอ Q1), model jsonb `{generator, params}`, is_active, published_at, sort | **trigger: หลัง published ห้ามแก้ design_no · stone_count · stone_size_mm และห้ามลบ** (ถ้าจะเปลี่ยน = สร้างแบบใหม่) ⇒ รหัสเก่ายังมีความหมายตลอด |
| `rb_design_photo` | design_id, storage_path, angle, sort (≤ 6 รูป) | Storage bucket สาธารณะ `ring-builder` เขียนได้ผ่าน admin action (service role) เท่านั้น |
| `rb_design_price` | design_id, effective_from timestamptz, body_price_thb integer (> 0 และ ≤ 1,000,000) | **insert-only** (trigger บล็อก UPDATE/DELETE) · PK (design_id, effective_from) |
| `rb_stone` | id, shop_id, **stone_no** smallint 1..1023 unique/shop, name_th, group (`soft`/`hard`), color_hex (`^#[0-9A-F]{6}$`), cut (`round` อย่างเดียวตอนนี้), is_active, sort | stone_no แก้ไม่ได้และห้ามใช้ซ้ำ · ลบได้แค่แบบ soft · **CZ ขาว = stone_no 0 เป็นค่าคงที่ในโค้ด ไม่มีแถว** |
| `rb_stone_offer` | id, stone_id, size_mm numeric(4,2), is_active | unique (stone_id, size_mm) · size_mm แก้ไม่ได้ |
| `rb_offer_price` | offer_id, effective_from, price_thb integer (> 0) | insert-only · **ไม่มีราคา = ไม่มีแถว (ไม่ใช่ 0)** |

**การมองเห็นฝั่งสาธารณะ (fail-closed)**
- แบบจะโผล่เมื่อ active ∧ published ∧ มีรูป ≥ 1 ∧ มีราคาตัวเรือนปัจจุบัน
- ชนิดพลอยจะโผล่ในแบบนั้นเมื่อ stone active ∧ มี offer active ที่ `size_mm = design.stone_size_mm` (เทียบ numeric ตรงๆ) ∧ มีราคาปัจจุบัน
- **ไม่มี query ไหนดูขนาดอื่นแทน**

**ไม่ผูก `gem_item` ใน P1-P2** — ถ้าผูกตอนนี้ งานจะโดนดึงเข้าใกล้ตารางต้นทุนตั้งแต่วันแรก (= 💰) ทั้งที่ยังไม่มี BOM ให้ใช้ · P3 จะเพิ่ม `rb_stone_offer.gem_item_id` (FK `(gem_item_id, shop_id)`) **และห้ามโผล่ใน output สาธารณะ**

### 3.1 RPC

| RPC | ชนิด | หน้าที่ |
|---|---|---|
| `rb_public_catalog(p_shop_id) → jsonb` | **SECURITY INVOKER** · STABLE · ใช้โดย service_role | คืนเฉพาะ key ที่อยู่ใน allowlist (§4) |
| `rb_quote(p_shop_id, p_design_no int, p_size int, p_positions int[], p_at timestamptz default null) → jsonb` | SECURITY INVOKER | ส่ง `p_at` เป็น null = ราคาสด ณ วินาทีปัจจุบัน + บังคับเงื่อนไขการมองเห็นทุกข้อ · ส่ง `p_at` = คิดราคาย้อนหลังสำหรับการตรวจ · คืน `{ok, total, body, lines[{pos,stone_no,name,price}], priced_at}` หรือ `{ok:false, code}` โดย code อยู่ในชุด `design_unavailable / stone_unavailable / size_out_of_range / count_mismatch / total_too_large / invalid` |
| admin: `rb_design_upsert` · `rb_design_publish` · `rb_design_price_set` · `rb_photo_add/remove/reorder` · `rb_stone_upsert` · `rb_offer_upsert` · `rb_offer_price_set` · `rb_set_active` · `rb_admin_catalog` · `rb_code_check(p_shop, p_actor, design_no, size, positions, priced_at, signed_total)` | SECURITY DEFINER · pin `search_path` · ตรวจ actor owner/admin (ใช้ helper ตัวเดียวกับ /oem/gems) | `rb_code_check` คืนค่า: ราคา ณ ตอนสร้างแยกรายตำแหน่ง · ธง `signed_total = reconstructed` · ราคาปัจจุบันแยกรายตำแหน่ง · ส่วนต่าง · สถานะปัจจุบัน (แบบหรือพลอยถูกปิดไปแล้ว) · อายุรหัส |

การตรวจไซซ์มี 2 จุดและต้องเท่ากัน: `lib/shop/ring-sizes.ts` (ไฟล์ใหม่ ให้ `lib/ring-size/config.ts` re-export ค่าเดิม 45–68) กับ helper ฝั่ง DB · มี parity test ยืนยันว่าตรงกัน

---

## 4. API contract

**`PublicCatalog`** (ส่งเป็น props จาก server component — ไม่มี GET endpoint สาธารณะ จึงไม่ต้องเพิ่ม exempt path อีกตัว)
```ts
type PublicCatalog = {
  sizes: { min: number; max: number };
  stones: { no: number; name: string; group: "soft" | "hard"; colorHex: string }[];
  designs: {
    no: number; name: string; stoneCount: 3|4|5|6|7; stoneSizeMm: number;
    sizeMin: number; sizeMax: number; bodyPriceThb: number;
    photos: { url: string; angle: string }[];
    model: { kind: "none" } | { kind: "procedural"; generator: string; params: RowRingParams };
    offers: { stoneNo: number; priceThb: number }[];   // เฉพาะขนาดเม็ดของแบบนี้
  }[];
};
```
ประกอบ type นี้ทีละ field ใน `catalog-server.ts` **ห้ามใช้ spread** · `params` ต้องผ่าน parser ที่เป็น allowlist ก่อน

**`POST /api/ring-builder/quote`** (export เฉพาะ POST · ทุกคำตอบใส่ `Cache-Control: no-store`)
- body: `{ v:1, design:int, size:int, positions:int[], expectedTotal:int }` · ไม่เกิน 512 B
- ผลตอบกลับ:
  - 200 `{ ok:true, code, total, body, lines, pricedAt }`
  - 409 `{ ok:false, reason:"price_changed", total, lines }` (ไม่มีรหัส)
  - 400 `{ ok:false, reason:<enum> }`
  - 403 origin ไม่ผ่าน · 413 body ใหญ่เกิน · 503 ไม่มี secret · 500 log เฉพาะ code ห้าม log error ทั้งก้อน
- **ไม่รับ** `shop_id`, ราคารายตำแหน่ง หรือ `pricedAt` จาก client

---

## 5. 3D — เทียบทางเลือก (หลักฐานคือ `docs/3j-jewelry/cad/satin-flow-preview.html` และ `wave-embrace-preview.html`)

**สิ่งที่ของเดิมพิสูจน์แล้ว** (อ่าน script จริง):
- เป็น WebGL1 ดิบ · ส่วน script ราว 9–11 KB ไม่บีบอัด (ประเมินว่าราว 3–4 KB gz)
- สร้างตัวเรือนด้วยการกวาด profile มุมมนไปตาม centerline (`buildRail`/`buildBand`)
- พลอยเป็น round brilliant แบบ flat facet 20 ด้าน (`buildGem`)
- shader เป็น Blinn-Phong 2 แสง + fresnel · สีส่งเป็น uniform ต่อการวาดแต่ละครั้ง ⇒ **เปลี่ยนสีรายเม็ดแค่วาดแต่ละเม็ดด้วย `uColor` ของเม็ดนั้น**
- ลากหมุนด้วย pointer · เคารพ `prefers-reduced-motion` · ไม่มี WebGL ก็แสดงข้อความได้

**สิ่งที่ยังขาด** (ต้องเพิ่มตอนห่อเป็น component):
- หลายเม็ดวางตามโค้งหน้าแหวน และหนามเตย/ราง/หลังเบี้ย
- รับมือ `webglcontextlost` แล้วถอยไป 2D · คืนทรัพยากรเมื่อ unmount
- หยุดวาดเมื่อพ้นจอ (IntersectionObserver) เพื่อประหยัดแบต
- API สำหรับ snapshot · index แบบ Uint16 รับได้ ≤ 65k vertex ต่อ mesh (พอ)
- โลหะยังดูเหมือนพลาสติกเพราะไม่มี env map — แก้ด้วย gradient reflection ปลอมใน shader

| | (a) procedural (ต่อยอดของ Sabé) ✅ | (a') procedural บน three.js | (b) ภาพหมุน 2D จากรูป + ทับสี | (c) Rhino → GLB ต่อแบบ |
|---|---|---|---|---|
| bundle เพิ่ม | ~5–10 KB gz (ต้องวัดจริง) | ~130–170 KB gz + โค้ดของเรา | ~0 + ชุดรูป | three + GLTFLoader ~150 KB+ และ GLB 0.2–1 MB ต่อแบบ (หรือเขียน loader GLB อย่างง่ายเองราว 3 KB — ตัดสินตอน P3) |
| ความเหมือนแบบจริง | ใกล้เคียง (สัดส่วน มม. ถูก แต่รายละเอียดเฉพาะของแบบหาย) | วัสดุสมจริงกว่า (PBR/env) รูปทรงเท่ากัน | เหมือนรูปจริง 100% แต่**ไม่ใช่ 3D** · มีรูปแค่ 2–3 มุม = สลับภาพ | เหมือนจริงที่สุด |
| เปลี่ยนสีรายเม็ด | ง่ายมาก | ง่าย | ต้องวาดจุดพลอยทุกเฟรม × ทุกเม็ด และ tint บน CZ ดูไม่จริง | ง่าย ถ้าตั้งชื่อ mesh `gem_0..n` |
| ต้นทุนต่อแบบ | Sabé เขียนพารามิเตอร์หรือ generator (ชั่วโมง) | เท่ากัน | ถ่าย turntable 24–36 เฟรม + annotate | ขึ้นโมเดลจากรูป (หลายชั่วโมงถึง 1 วันต่อแบบ `[ต้องยืนยัน: ใครทำ/ค่าจ้าง]`) |
| LINE webview มือถือรุ่นล่าง | เบา | หนักขึ้น (PBR) | เบาสุด | หนัก |

**ตัดสิน: (a)** และ**ไม่เพิ่ม three.js** — เงื่อนไขข้อ 6 ของ brief ตั้งสมมติฐานว่าต้องใช้ three แต่หลักฐานในรีโปชี้ว่าไม่จำเป็นสำหรับแหวนแถว · ถ้าวันหน้าต้องการ PBR หรือ GLB ค่อยกลับมาตัดสินที่ P3
- **trade-off ที่ยอมรับ**: ทีมดูแล renderer เอง (ราว 400–600 บรรทัด) · วัสดุไม่สมจริงเท่า PBR ⇒ ต้องมีป้าย "ภาพจำลอง สีและสัดส่วนโดยประมาณ" และแสดง**รูปจริงของแบบ**คู่กันเสมอ (กันลูกค้าเข้าใจผิดเรื่องสินค้า)

**แบ่งงาน**
- **Sabé (jewelry-designer)**: generator `row_v1` เป็น TS ล้วน หน่วย มม. รับพารามิเตอร์ (หน้าตัดตัวเรือน กว้างบน/ล่าง หนา ความเรียว ชนิดการฝัง `prong4 | prong_shared | channel | bezel` ช่องห่างเม็ด ความสูงหัว เม็ดตามโค้งหรือตรง) + ชุดพารามิเตอร์ต่อแบบจากรูปของเจ้าของ · แบบที่มีเอกลักษณ์เกินพารามิเตอร์ = generator ของตัวเอง (ต้อง deploy)
- **frontend (Luke)**: ห่อเป็น `RingViewer` (lazy import หลังตรวจพบ WebGL) · API `setGemColors(hex[])` · `highlight(pos)` · `snapshot(w,h)` · lifecycle ทั้งหมดที่ขาดตามรายการข้างบน
- **สัญญากลาง**: `generate(params) → { metal: Mesh[]; gems: { center, normal, radiusMm, mesh }[] }` โดย `gems.length === stoneCount` และเส้นผ่านศูนย์กลาง = `stoneSizeMm` (มี unit test)
- satin-flow ตีความ DNA ผิด (twist) ⇒ **ใช้เป็นแนวเทคนิคเท่านั้น ห้ามใช้เป็นแบบขาย**

**ตรวจ WebGL**: `getContext("webgl", { failIfMajorPerformanceCaveat: true })` ไม่ได้ = 2D · context หลุดกลางทาง = ถอยไป 2D โดยไม่เสียตัวเลือกที่ลูกค้าทำไว้

**สิ่งที่เจ้าของส่งต่อแบบ**:
- รูป ≥ 3 มุม (หน้าแหวน · ด้านข้าง · 3/4) พื้นเรียบ แสงเดียวกัน
- ขนาดเม็ด มม. · ความกว้างหน้าแหวนบน/ล่าง และความหนา มม. · ชนิดการฝัง · ช่องห่างเม็ด
- ช่วงไซซ์ที่ทำได้ · ชื่อแบบ · ราคาตัวเรือน
- ถ้ามีชิ้นจริง วัดด้วยเวอร์เนียร์ให้ Sabé


### 5.1 แบบอ้างอิงจากเจ้าของ (รูป 9 พ.ย. 69) และผลต่อ geometry

**สิ่งที่เห็นในรูป** (`.claude/uploads/2b4dbf60-…/3989e2b0-image.jpg`)
- รูปถ่ายถือด้วยนิ้ว โฟกัสไม่คม จึงใช้ดูทรงได้ แต่ใช้วัดขนาดไม่ได้
- ตัวเรือนหน้าตัดเกือบสี่เหลี่ยมแบน ขอบมนเล็กน้อย ขัดเงา
- พลอยกลมเม็ดเล็กเรียงแถวเดียวตามโค้งหน้าแหวน แทบเสมอผิวตัวเรือน ไม่มีหัวยกสูง
- ฝังด้วยหนามเตยร่วมเป็นเม็ดกลมเล็กระหว่างพลอยทั้งสองขอบ และน่าจะมีที่หัวท้ายแถวด้วย
- แถวพลอยอยู่แค่ส่วนหน้า ปลายสองข้างเป็นตัวเรือนเรียบ
- นับได้ราว 6–7 เม็ด แต่ไม่แน่นอน
- ความกว้างของพลอยเกือบเต็มหน้าแหวน

**ผลต่อดีไซน์:** แบบนี้ง่ายกว่าที่ generator `row_v1` เผื่อไว้ ใช้ฟังก์ชันจาก preview เดิมได้เกือบตรงๆ
- ตัวเรือนใช้ `profilePts` (สี่เหลี่ยมมุมมน) กวาดไปตามวงกลม
- พลอยใช้ `buildGem` วางตามมุมบนโค้ง
- หนามเตยเป็นทรงกลมเล็ก 2 เม็ดต่อช่อง ได้รวม `2×(n+1)` เม็ด ถ้ามีที่หัวท้าย

ตัด `prong4`, `bezel` และหัวยกออกจาก P2 (YAGNI) แล้วค่อยเพิ่มเมื่อมีแบบจริงที่ต้องใช้

**พารามิเตอร์ต่อแบบ (`row_v1`)**

| param | หน่วย | ที่มา |
|---|---|---|
| `stoneCount` | เม็ด | DB (`rb_design.stone_count`) |
| `stoneMm` | มม. | DB (`stone_size_mm`) |
| `gapMm` | มม. | ระยะขอบพลอยถึงขอบพลอย (ช่องที่หนามเตยอยู่) |
| `bandWidthMm`, `bandThickMm` | มม. | วัดที่หน้าแหวน |
| `bandWidthBackMm`, `bandThickBackMm` | มม. | ค่าเริ่มเท่าหน้าแหวน ใส่เฉพาะแบบที่เรียวลง |
| `cornerMm` | มม. | ความมนของขอบหน้าตัด |
| `prong` | `shared_bead` · `none` | `none` เตรียมไว้สำหรับฝังราง |
| `prongMm` | มม. | เส้นผ่านศูนย์กลางเม็ดหนามเตย |
| `prongAtEnds` | bool | มีหนามเตยที่หัวท้ายแถวไหม |
| `stoneRiseMm` | มม. | ความสูงของ table เหนือผิวตัวเรือน (0 = เสมอ) |
| `metal` | `silver` · … | สีโลหะในโมเดล รอคำตอบ Q4 |

ข้อตกลงเพิ่มเติม:
- **ไซซ์ในโมเดลคงที่**ที่ไซซ์อ้างอิง `[ต้องยืนยัน: ไซซ์ตัวอย่างของร้าน]` ไม่เปลี่ยนตามไซซ์ที่ลูกค้าเลือก เพราะตาแยกไม่ออก ถ้าทำให้เปลี่ยนตามได้ จะต้อง map ไซซ์เป็นรัศมีด้วยตารางของร้าน (`lib/ring-size/size.ts`) ซึ่งยังไม่จำเป็น
- **validator ฝั่ง admin:** ความยาวแถว `n×stoneMm + (n−1)×gapMm` ต้องไม่เกินเพดานของเส้นรอบวงที่ไซซ์เล็กสุดของแบบ (ค่าเริ่ม ≤ 50%) ถ้าเกินให้ปฏิเสธพร้อมบอกเหตุ ข้อนี้คือด่านเดียวกับคำถามเจ้าของ Q1 (ช่วงไซซ์ต่อแบบ)

**ให้สีพลอยเม็ด 1.5–2.5 มม. อ่านออกบนมือถือ** (ข้อนี้เป็น requirement ของ viewer ไม่ใช่แค่เรื่องความสวย)
1. **มุมเริ่มต้นหันหน้าแถวพลอยเข้ากล้อง** และซูมจนแถวกว้างราว 80% ของ canvas ที่ 2 มม. × 7 เม็ด เม็ดละราว 30–40 px บนจอ 360 px ส่วนการดูทั้งวงทำได้โดยลากหมุน
2. จำกัดมุมหมุนและระยะซูมไม่ให้แถวหลุดเฟรมจนหาไม่เจอ มีปุ่ม "กลับมุมหน้า" ส่งผ่าน prop `view` (ดูส่วน C)
3. shader ของพลอยสี: ลดไฮไลต์ขาว (`uMetal`/specular) ไม่ให้ทับสีจนเม็ดเล็กดูขาวเหมือน CZ ทั้งหมด ให้ base color อิ่มกว่าค่าจริงเล็กน้อย และ CZ ขาวต้องต่างจากพลอยสีอ่อน (เช่นบลูโทพาส) ได้ชัด ข้อนี้ต้อง**ทดสอบด้วยตาบนเครื่องจริง** เทสต์อัตโนมัติจับไม่ได้
4. **ชื่อพลอยเป็นตัวหนังสือรายตำแหน่งอยู่นอกโมเดลเสมอ** โมเดลใช้แค่ "ดูเพลินๆ" ห้ามให้สีในโมเดลเป็นแหล่งข้อมูลเดียว (คนตาบอดสีและจอสีเพี้ยน)
5. ตำแหน่งที่เลือกอยู่ต้องไฮไลต์ในโมเดลด้วย prop `selectedPos` โดยไม่เปลี่ยนสีพลอย (ใช้เส้นขอบหรือกะพริบเบาๆ)
6. snapshot ใช้มุมหน้าและการซูมเดียวกับข้อ 1 เสมอ ไม่ขึ้นกับมุมที่ลูกค้าหมุนค้างไว้ เพื่อให้รูปที่ส่ง LINE อ่านตำแหน่งออก

**สิ่งที่ต้องขอเจ้าของเพิ่มต่อแบบ** (รูปที่ส่งมาใช้วัดไม่ได้)
- **รูปคม 3 มุม** บนพื้นเรียบสีอ่อน แสงสม่ำเสมอ ห้ามถือด้วยนิ้ว (ใช้ดินน้ำมันตั้ง)
  - (1) มองตรงหน้าแถวพลอย วางไม้บรรทัดหรือเวอร์เนียร์ในภาพ
  - (2) ด้านข้าง เห็นความหนาและหน้าตัด
  - (3) มุม 3/4
- **ตัวเลขจากชิ้นจริง** (วัดด้วยเวอร์เนียร์):
  - จำนวนเม็ด (ยืนยันว่า 7 จริงไหม)
  - ขนาดเม็ด มม.
  - ความกว้างและความหนาหน้าแหวน
  - ความกว้างและความหนาด้านหลัง ถ้าเรียว
  - ระยะห่างระหว่างเม็ด หรือความยาวแถวทั้งหมด
  - มีหนามเตยที่หัวท้ายแถวไหม
  - พลอยเสมอผิวหรือนูนเท่าไร
- ช่วงไซซ์ที่ทำได้ ชื่อแบบ และราคาตัวเรือน (ตามที่ขอไว้ใน §5 เดิม)
- **ถ้าแบบเดียวกันทำได้หลายจำนวนเม็ด** (3/4/5/6/7) ให้นับเป็น**คนละแบบ** (คนละ `design_no`) ตามดีไซน์ ส่วนพารามิเตอร์ตัวเรือนใช้ชุดเดียวกันได้ ต่างกันแค่ `stoneCount`/`stoneMm`

**ผลต่อ phase:** ด้วยแบบนี้ spike P2a ของ Sabé เล็กลงมาก แค่ต่อยอด `buildRail` + `buildGem` + ทรงกลมหนามเตย อาจรวมเข้า P1 ได้ถ้า spike ผ่านตาเจ้าของเร็ว แต่**ยังคงให้ 2D เป็นฐานที่ขึ้นก่อน** เพราะเป็นทางเดียวที่ใช้ได้ทุกเครื่อง

**ข้อความ:** เจ้าของเรียกพลอยในรูปว่า "เพชร" แต่ยืนยันแล้วว่าเป็น CZ ขาว ทุกจอ รูป และข้อความ LINE ต้องเขียนว่า "CZ ขาว" ห้ามใช้คำว่าเพชร (กฎแบรนด์ข้อ 4) QA ให้ grep คำว่า "เพชร" ใน diff


---

## 6. รูปที่เซฟ + ส่ง LINE

- **วิธีจับภาพ**: วาดบน 2D canvas ที่ 1080 กว้าง (สูงตามเนื้อหา — ux เคาะ · ตัวหนังสือเล็กสุด ≥ 34 px แบบ /ring-size · QR ≥ 260 px พร้อม quiet zone)
  - ภาพแหวน: เรียก `viewer.snapshot()` ⇒ render 1 เฟรมที่ขนาดที่ต้องการ แล้ว `drawImage(glCanvas)` **ใน task เดียวกัน** ⇒ ไม่ต้องเปิด `preserveDrawingBuffer` (ซึ่งเปลืองบนมือถือ)
  - ไม่มี WebGL: ใช้รูปแบบ + แถบ 2D ที่ลงสีแทน
- **เนื้อหาในรูป**: ชื่อแบบ · ชื่อพลอย**เป็นตัวหนังสือรายตำแหน่ง** ("1 โกเมน · 2 CZ ขาว · …") พร้อมกำกับทิศการนับ · ไซซ์ · ราคารวม + ราคาตัวเรือน + ราคาพลอยแต่ละเม็ด · รหัส (ตัวหนังสือ) + QR · "สั่งทำ ผลิตไม่เกิน 21 วัน" · "พลอยสีขาวเป็น CZ (cubic zirconia) ไม่ใช่เพชร" · ป้ายภาพจำลอง · `LINE_OA_HANDLE` จาก `lib/shop/line.ts`
  - **ห้าม**: ราคาเงิน/น้ำหนักโลหะ (กฎแบรนด์ข้อ 1) · คำเคลมสรรพคุณพลอย
- **ข้อจำกัด**:
  - canvas taint — รูปจาก Supabase Storage ต้องโหลดด้วย `crossOrigin="anonymous"` และ bucket ต้องตอบ CORS (**ต้องตรวจจริงตอน implement**)
  - ฟอนต์ไทยต้องโหลดเสร็จก่อนวาด (`document.fonts.load`) · ใช้ทางถอยเดียวกับ `share-card.ts`
  - หน่วยความจำ canvas บน iOS รุ่นเก่า
- **ส่ง**: `navigator.canShare({files})` ได้ ⇒ แชร์ไฟล์ · ไม่ได้ (webview ส่วนใหญ่) ⇒ แสดง `<img>` พร้อม "กดค้างเพื่อบันทึก" · ปุ่มหลักใช้ copyThenOpen (คัดลอกข้อความสรุป + รหัส แล้ว `location.href = LINE_OA_URL`) · ห้ามใช้ `window.open` และห้ามพึ่ง `download` attribute
  - ใช้รูปแบบเดิมของ `ShareCardSheet` / `LineCta` / `useCopy` แต่**เขียนโมดูลของตัวเองใน `lib/ring-builder/`** — ไม่ refactor หน้า /ring-size ที่อยู่บน prod (หนี้: แยก util ร่วมทีหลัง)
- **QR library**: `qrcode-generator` (~10 KB) หรือ `qrcode` · lazy load ตอนกดบันทึกเท่านั้น

---

## 7. ไฟล์ที่ต้องสร้าง/แก้

| path | หน้าที่ | phase |
|---|---|---|
| `supabase/migrations/NNNN_ring_builder.sql` + `scripts/verify/verify-NNNN.sql` | ตาราง · trigger insert-only/immutable · RPC · grant · bucket | P1 |
| `lib/shop/ring-sizes.ts` (+ แก้ `lib/ring-size/config.ts` ให้ re-export) | ช่วงไซซ์ร้านจุดเดียว | P1 |
| `lib/ring-builder/config.ts` | ข้อความ · flag · CZ ขาว (ไม่มีราคา) | P1 |
| `lib/ring-builder/types.ts` | `PublicCatalog` และ type ที่เป็น allowlist | P1 |
| `lib/ring-builder/code.ts` (pure) | pack/unpack · Crockford · canonical | P1 |
| `lib/ring-builder/code-sign.ts` (`server-only`) | HMAC sign/verify (`timingSafeEqual`) | P1 |
| `lib/ring-builder/catalog-server.ts` (`server-only`) | เรียก `rb_public_catalog` แล้วประกอบทีละ field | P1 |
| `lib/ring-builder/price-preview.ts` · `line-message.ts` · `share-image.ts` · `qr.ts` · `webgl.ts` | แสดงผลรวม · ข้อความ · วาดรูป · ตรวจ WebGL | P1 |
| `app/(quiz)/ring-builder/page.tsx` (`revalidate = 60` · noindex · metadata ของตัวเอง) + `RingBuilderClient.tsx` + `_components/` + `_tests/` | หน้าสาธารณะ | P1 |
| `app/api/ring-builder/quote/route.ts` | เซ็นรหัส (อ่านอย่างเดียว) | P1 |
| `middleware.ts` + `lib/auth/exempt-path.ts` + `exempt-path.test.ts` | เพิ่ม `ring-builder/?$` · `api/ring-builder/quote/?$` (exact) | P1 |
| `next.config` headers | `/ring-builder`: Permissions-Policy camera/mic/geo=() · `X-Frame-Options: DENY` · `frame-ancestors 'none'` | P1 |
| `app/(dashboard)/catalog/ring-builder/**` + `lib/actions/ring-builder.ts` ("use server" · `isOwnerOrAdmin` ทุก action · `revalidatePath('/ring-builder')` หลังแก้ราคา) + `lib/ring-builder/admin-server.ts` + `components/domain/ring-builder/**` | หลังบ้าน: แบบ · พลอย · ราคา · ตรวจรหัส | P1 |
| `lib/ring-builder/boundary.test.ts` | กราฟ runtime ของ page/client/route ต้องไม่มี `lib/actions/**`, ไฟล์ "use server", `lib/jobs/gems*.ts`, `admin-server.ts` · key ของ `PublicCatalog` และ response ของ route = allowlist เป๊ะ | P1 |
| `lib/ring-builder/gl/` (renderer · shader · `row_v1` generator) + `RingViewer.tsx` | 3D | P2 |
| `.env.local.example` + Vercel env `RING_BUILDER_CODE_SECRET` (push commit เปล่าหลังเพิ่ม) | secret | P1 |
| `docs/3j-jewelry/READING-LISTS.md` + `INDEX.md` | เพิ่มไฟล์ใหม่ | P1 |

---

## 8. เคสที่ห้ามผ่าน → ตกที่ด่านไหน

| # | เคส | ด่าน (เรียงชั้น) | เทสต์ |
|---|---|---|---|
| X1 | ต้นทุนพลอย/ตัวเรือน/margin หลุดถึง bundle หรือ payload | (1) ตาราง `rb_*` ไม่มีคอลัมน์ต้นทุน (2) RPC สาธารณะเป็น INVOKER + `service_role` ไม่มีสิทธิ์ใน `gem_item_price` ⇒ join = 42501 (3) mapper ประกอบทีละ field (4) boundary test | verify: `has_table_privilege('service_role','analytics.gem_item_price','select') = false` · `pg_get_functiondef` ต้องไม่มี `security definer`/`gem_item_price` · vitest เทียบชุด key · QA ค้นเลขต้นทุนจริงจาก DB ใน HTML/RSC payload |
| X2 | รหัสปลอมหรือถูกแก้ แล้วหลังบ้านบอกว่าถูก | HMAC verify ใน admin action **ก่อน**เรียก `rb_code_check` · ล้ม = แสดง "รหัสไม่ถูกต้อง" และไม่แสดงเนื้อหาที่ decode ได้ว่าใช้ได้ · ไม่มี secret = "ตรวจไม่ได้" ไม่ใช่ "ถูก" | พลิกทีละบิตทุกบิตของ payload/tag · ver ผิด · ตัดสั้น/ต่อท้าย · บิตเติมท้ายไม่เป็น 0 · ตัวอักษรนอกชุด |
| X3 | พลอยปิด/ไม่มีราคาขนาดนั้น ถูกเลือก หรือคิด 0 เงียบๆ | catalog ไม่ส่งชนิดนั้นออก · `rb_quote` ตรวจสดตอนออกรหัส → 400 `stone_unavailable` · CHECK ราคา > 0 · CZ เป็นตัวเดียวที่เป็น 0 และไม่มีแถว | มี offer เฉพาะขนาดอื่น → ไม่โผล่ + quote ปฏิเสธ · ปิดพลอยหลังโหลดหน้า → quote ปฏิเสธ · offer ไม่มีแถวราคา |
| X4 | จำนวนเม็ดไม่ตรงกับแบบ | decoder (`n` เทียบกับความยาวบิต) · route schema · `rb_quote` (`n = stone_count`) · trigger ห้ามแก้ stone_count หลัง publish | n = 2/8/≠ แบบ · positions ยาวไม่ตรง n |
| X5 | ไซซ์นอก 45–68 หรือนอกช่วงของแบบ | encoder (idx ≤ 23) · schema · `rb_quote` | 44/69/45.5/NaN/string |
| X6 | ราคาเปลี่ยนหลังเซฟแล้วแอดมินไม่รู้ว่าราคาไหนคือที่ลูกค้าเห็น | ราคารวมที่เซ็นในรหัส + `priced_at` · ประวัติราคา insert-only · `rb_code_check` แสดงราคา ณ ตอนสร้างคู่กับปัจจุบัน · 409 handshake ทำให้รูปตรงกับรหัส | แก้ราคาหลังออกรหัส → ตรวจได้ทั้ง 2 ราคา · UPDATE/DELETE ตารางราคา = ล้ม |
| X7 | ช่องเขียนสาธารณะโดนยิงถล่ม | **ไม่มีช่องเขียน** · quote อ่านอย่างเดียว: same-origin → body ≤ 512B → schema ก่อนแตะ DB → RPC เดียว · ทางยกระดับ = Vercel WAF | route test 403/413/400 ไม่เรียก RPC |
| X8 | Server Action หลุดผ่าน exempt path | ห้าม "use server" ในกราฟ (quiz) · matcher แบบ exact | `no-server-action-graph.test.ts` ครอบ ring-builder · `/ring-builders`, `/ring-builder/x`, `/api/ring-builder/x` ยังโดน gate |

## 9. เคสที่ต้องไม่พัง

ไม่มี WebGL / เครื่องช้า / context หลุด ⇒ 2D ครบทุกฟังก์ชัน · LINE iOS/Android และ TikTok webview ⇒ กดค้างบันทึกรูป + copyThenOpen (คัดลอกไม่ได้ = เลือกข้อความเอง) · แอดมินแก้ราคาตอนลูกค้าเปิดหน้าค้าง ⇒ 409 พร้อมยืนยันราคาใหม่ และรหัสเก่าตรวจย้อนได้ · แบบไม่มีรูป/ปิด/ไม่มีราคาตัวเรือนไม่โผล่ · แบบไม่มีพลอยสีเลย (CZ ล้วน) ยังสั่งได้ · `?c=` ที่เสียหรือแบบปิดไปแล้ว ⇒ เปิดหน้าปกติพร้อมแจ้ง · /ring-size, /gem-quiz, /shop ทำงานเหมือนเดิม (matcher แก้แบบเพิ่มเท่านั้น)

---

## 10. Phase

| phase | ขอบเขต | ทำไมลำดับนี้ | QA |
|---|---|---|---|
| **P0** (เจ้าของ) | ข้อมูลแบบที่ 1 (5 เม็ด) ตาม §5 + พลอย 3–5 ชนิดพร้อมราคาที่ขนาดเม็ดของแบบ + ตอบ §11 | ไม่มีข้อมูลก็ทดสอบอะไรไม่ได้ | — |
| **P1** | migration + หลังบ้าน (แบบ/พลอย/ราคา/ตรวจรหัส) + หน้า 2D (รูปจริง + แถบตำแหน่ง ลากหรือแตะเพื่อสลับ) + quote/รหัส + เซฟรูป + LINE | ได้วงจรขายครบเร็วที่สุด · 2D คือ fallback ที่ต้องมีอยู่แล้ว · ส่วนที่เสี่ยงที่สุด (ราคา/รหัส/exempt path) ได้ตรวจก่อน | **L + security ก่อน merge** (exempt path ใหม่ + HMAC + ราคาลูกค้า) |
| **P2a** (ทำคู่ขนาน P1 ใน worktree ได้) | Sabé ทำ spike `row_v1` + พารามิเตอร์แบบที่ 1 บน preview branch เพื่อให้เจ้าของเทียบกับรูปจริง | ความเหมือนเป็นคำถามที่ตอบได้ด้วยตาเจ้าของเท่านั้น — ต้องรู้เร็ว | ไม่ขึ้น prod |
| **P2** | `RingViewer` + snapshot เข้ารูป + งบ bundle (หน้า ring-builder First Load ไม่เกิน +15 KB gz ต่อ viewer) | เป็นส่วนเสริมบน P1 ที่เสถียรแล้ว | M + เครื่องจริง (iPhone SE · Android รุ่นล่าง · LINE/TikTok webview) · ถ้าแตะ `share-image.ts` ต้องตรวจราคาในรูปซ้ำ |
| **P3** | GLB สำหรับแบบที่ต้องเหมือนจริง · ผูก `gem_item_id` เพื่อ BOM/สร้างใบงานจากรหัส | ต้องรอให้มียอดสั่งจริงพิสูจน์ก่อน (YAGNI) | **💰** (ใกล้ตารางต้นทุน) |

ประมาณการคร่าวๆ (ยังไม่ได้แตกงาน): P1 backend 2–3 วัน · frontend หน้าสาธารณะ 3–4 วัน · หลังบ้าน 2 วัน · P2 3–5 วันรวม Sabé

---

## 11. Trade-off ที่ตัดทิ้ง (เพิ่มจาก §2 และ §5)

- **ใช้ `@react-three/fiber`** — bundle + reconciler เพิ่ม และยังต้องมี three อยู่ดี
- **มี GET catalog API สาธารณะ** — ต้องเพิ่ม exempt path อีกตัวโดยไม่จำเป็น ใช้ SSR props แทน
- **cache catalog ใน quote route** — ราคาเก่าในหน้าต่าง cache จะทำให้ราคาในรหัสไม่ตรงกับประวัติ ⇒ quote อ่านสดทุกครั้ง (หน้าใช้ `revalidate 60` + `revalidatePath` ได้ เพราะมี 409 กันไว้)
- **เก็บราคาด้วย audit log แล้วคิดย้อน** — ใช้ effective-dated insert-only ตรงไปตรงมากว่า
- **ให้ CZ ขาวเป็นแถวในตาราง** — เปิดช่องให้ตั้งราคาหรือปิดใช้งานผิดได้ เป็นค่าคงที่ปลอดภัยกว่า
- **refactor share/LINE ของ /ring-size ให้ใช้ร่วมกัน** — เสี่ยงทำหน้า prod พัง ทำทีหลัง

## 12. ความเสี่ยงตอน implement

1. **ทิศของ "ตำแหน่ง 1"** — ถ้าไม่ตายตัว ช่างฝังกลับด้านได้ (ขึ้นกับ Q2) · ต้องพิมพ์ทิศบนรูปและในหน้าตรวจ
2. CORS ของ Storage / canvas taint · ฟอนต์ไทยบน canvas · หน่วยความจำ iOS
3. เทียบ `stone_size_mm` ใน TS ห้ามใช้ float ⇒ ส่งเป็นสตริงหรือ ×100 เป็น int
4. หมุน secret = รหัสเก่าตรวจไม่ได้ ⇒ ใช้ ver nibble + คง secret เก่าไว้เพื่อตรวจอย่างเดียว (ทำเมื่อต้องหมุนจริง)
5. ลากบนมือถือชนกับการเลื่อนหน้า (`touch-action:none` บน canvas 3D) ⇒ การสลับตำแหน่งอยู่ที่แถบ 2D และต้องมีแบบแตะสลับเป็นทางเลือก (a11y)
6. สีพลอยจำลองอาจทำให้เข้าใจผิด ⇒ มีป้ายจำลองและรูปจริงทุกจอ · CZ ต้องบอกชัด (กฎแบรนด์)
7. **TikTok policy** — ห้ามโปรโมตลิงก์หรือ QR หน้านี้บน TikTok/Shopee · ถ้าร้านจะเอารูปลูกค้าไปโพสต์ซ้ำบน TikTok ต้องตัด QR/LINE ออก
8. matcher กับ `exempt-path.ts` คลาดกัน · migration traps: grant เฉพาะ service_role (ข้อ 18) · NaN (ข้อ 4) · CRLF (ข้อ 20) · trigger ตอน UPDATE (ข้อ 19)
9. เกิน 18 บิตของราคารวม (> 262,143 THB) ⇒ quote ปฏิเสธพร้อมให้ทักแอดมิน

---

## 13. คำถามเจ้าของ (เฉพาะข้อที่เปลี่ยนดีไซน์)

1. **ทุกแบบทำได้ทุกไซซ์ 45–68 ไหม?** 7 เม็ดที่เม็ดใหญ่ในไซซ์เล็กอาจล้นหน้าแหวน ⇒ ดีไซน์นี้เผื่อช่วงไซซ์ต่อแบบไว้แล้ว ต้องการแค่ค่าจริง
2. **"ตำแหน่ง 1" นับจากไหน?** มุมคนใส่มองลงที่มือตัวเอง หรือมุมคนอื่นมอง — ต้องตายตัวเพื่อให้ช่างฝังถูกด้าน
3. **ราคาเป็นจำนวนเต็มบาทเสมอใช่ไหม?** กระทบรูปแบบของรหัส
4. **ตัวเรือนมีตัวเลือกอื่นไหม** (สีชุบ / โลหะ)? ถ้ามี ต้องเพิ่มใน data model + รหัส + ราคา ก่อนเริ่ม P1
5. **3D แบบ "ภาพจำลองใกล้เคียง" รับได้ไหม?** หรือมีแบบไหนที่ต้องเหมือนจริงจนต้องจ้างขึ้นโมเดล (P3 · ใคร/งบ `[ต้องยืนยัน]`)
6. **ราคาในรหัสยืนกี่วัน?** หลังบ้านจะขึ้นป้าย "เกินกำหนด"
7. **QR ในรูปให้เปิดหน้าออกแบบให้คนอื่นดูต่อได้ (URL) หรือเป็นแค่รหัส?** เลือกแล้วแก้ไม่ได้ เพราะรูปเก่ายังอยู่ในแชท
8. **พลอยเนื้ออ่อนใส่ได้ทุกแบบ/ทุกชนิดการฝังไหม?** ถ้าไม่ได้ ต้องมีกฎแบบ×กลุ่มพลอย

## 14. สิ่งที่ขอ ux-ui → workflow (`docs/3j-jewelry/oms/workflow-ring-builder.md`)

ux-ui ไม่ต้องออกแบบหน้าตา แต่ workflow ต้องกำหนดเรื่องเหล่านี้ให้ครบ:
- **ลำดับขั้นและ state ครบทุกจอ** ทุกขั้นที่ข้อมูลใน §15.1 ทำให้เกิดได้ ได้แก่ กำลังโหลด, ว่าง (ไม่มีแบบ), แบบไม่มีพลอยสี, `?c=` ใช้ไม่ได้หรือแบบปิดแล้ว, 409 ราคาเปลี่ยน, 400 แยกตาม reason, เน็ตหลุด, ไม่มี WebGL, webview ที่แชร์ไฟล์ไม่ได้
- **ทิศการนับ "ตำแหน่ง 1"** ตามคำตอบ Q2 และวิธีแสดงบนจอและบนรูป
- **วิธีเลือกและสลับตำแหน่ง** แบบแตะต้องทำได้ครบ ส่วนการลากเป็นทางเลือก
- **flow บันทึกและส่ง** ได้แก่ แชร์ไฟล์ → กดค้างเพื่อบันทึก → คัดลอกข้อความแล้วเปิด LINE → คัดลอกไม่ได้ให้เลือกข้อความเอง
- **รายการข้อความที่ต้องมี** (ร่าง ให้เจ้าของเคาะคำ) ได้แก่ CZ ขาวรวมในราคาตัวเรือน, ภาพจำลอง, pre-order ไม่เกิน 21 วัน, ราคาเปลี่ยน และข้อความของแต่ละ reason
- **flow หลังบ้าน** ได้แก่ สร้างแบบ → ใส่พารามิเตอร์ → ดูตัวอย่าง 3D/2D → publish (ล็อกจำนวนเม็ดและขนาดเม็ด) → ตั้งราคา, ราคาพลอยต่อขนาด, และตรวจรหัส (ราคา ณ ตอนสร้าง เทียบราคาปัจจุบัน)
- **จุดที่ต้องเคารพ §15.4** ให้อ้างหัวข้อในนั้นตรงๆ


---

## 15. สัญญาที่ UI ภายนอกต้องเคารพ

> ใช้ตรวจดีไซน์ที่เจ้าของส่งกลับมา: ถ้าหน้าจอต้องการข้อมูลหรือพฤติกรรมที่ไม่อยู่ในสัญญานี้ แปลว่า**ขัดกับระบบ** ต้องคุยก่อน ห้ามให้ frontend แก้เองที่ปลายทาง
> ค่าตัวเลขในตัวอย่าง JSON เป็นตัวอย่างทั้งหมด (480/80/120 ของเจ้าของ) ส่วนชื่อแบบเป็น `[ต้องยืนยัน]`

### 15.1 ข้อมูลที่หน้าจอได้รับ (props จาก server, ไม่มี fetch ตอนเปิดหน้า)

```json
{
  "sizes": { "min": 45, "max": 68 },
  "stones": [
    { "no": 3, "name": "โกเมน", "group": "soft", "colorHex": "#7A1F2B" },
    { "no": 5, "name": "ซิทริน", "group": "soft", "colorHex": "#E3A82B" }
  ],
  "designs": [{
    "no": 1, "name": "[ต้องยืนยัน: ชื่อแบบ]", "stoneCount": 7, "stoneSizeMm": "2.00",
    "sizeMin": 45, "sizeMax": 68, "bodyPriceThb": 480,
    "photos": [{ "url": "https://<supabase>/storage/v1/object/public/ring-builder/…", "angle": "front" }],
    "model": { "kind": "procedural", "generator": "row_v1", "params": { "…": "ตาม §5.1" } },
    "offers": [{ "stoneNo": 3, "priceThb": 80 }, { "stoneNo": 5, "priceThb": 80 }]
  }],
  "initial": { "designNo": 1, "size": null, "positions": [0,0,0,0,0,0,0], "fromCode": false, "codeIssue": null }
}
```

กติกาของข้อมูลชุดนี้:
- `stoneSizeMm` เป็นสตริง เพื่อกันปัญหา float
- **ไม่มี** id ภายใน, `gem_item_id`, ต้นทุน, margin หรือ flag ของหลังบ้าน
- เพิ่ม key ได้ก็ต่อเมื่อแก้สัญญานี้และ allowlist test พร้อมกันเท่านั้น
- position ค่า `0` = **CZ ขาว** ใช้เป็นค่าเริ่มทุกเม็ด (ชื่อและสีเป็นค่าคงที่ใน `config.ts`)
- พลอยที่เลือกได้ในแบบหนึ่ง = `designs[i].offers` เท่านั้น **ห้าม UI สร้างตัวเลือกจาก `stones` ทั้งหมด**
- `codeIssue` มีค่าเป็น `null` หรือ `"invalid" | "design_unavailable" | "stone_unavailable"` (กรณีเปิดจาก `?c=`)

### 15.2 ขอราคาและรหัส — `POST /api/ring-builder/quote`

```jsonc
// request (≤ 512 B)
{ "v": 1, "design": 1, "size": 54, "positions": [3,0,0,5,0,0,3], "expectedTotal": 720 }
// 200 สำเร็จ
{ "ok": true, "code": "3J-XXXXX-XXXXX-…", "total": 720, "body": 480,
  "lines": [ { "pos": 1, "stoneNo": 3, "name": "โกเมน", "priceThb": 80 }, { "pos": 2, "stoneNo": 0, "name": "CZ ขาว", "priceThb": 0 } ],
  "pricedAt": "2026-11-09T13:05:12Z", "qrText": "https://app.3jthailand.com/ring-builder?c=3J-…", "lineText": "…ข้อความสรุปพร้อมรหัส…" }
// 409 ราคาเปลี่ยน (ไม่มีรหัส: UI ต้องให้ลูกค้ายืนยันราคาใหม่ แล้วส่งใหม่ด้วย expectedTotal ใหม่)
{ "ok": false, "reason": "price_changed", "total": 800, "body": 480, "lines": [ … ] }
// 400
{ "ok": false, "reason": "design_unavailable | stone_unavailable | size_out_of_range | count_mismatch | total_too_large | invalid" }
// 403 / 413 / 503 / 500 → UI แสดงข้อความกลาง "ระบบไม่พร้อม ลองใหม่ หรือทักแอดมิน" + ปุ่มเปิด LINE
```

- `lineText` และ `qrText` **ประกอบที่ server** เพื่อให้ข้อความที่ส่ง LINE ตรงกับรหัสเสมอ ห้าม UI ประกอบข้อความเองจาก state
- **ห้าม UI สร้างหรือแก้รหัส** แสดงได้อย่างเดียว

### 15.3 3D viewer เป็นกล่องดำ (`RingViewer`), 2D (`RingSchematic`) ใช้สัญญาเดียวกัน

```ts
type RingViewProps = {
  design: { no: number; stoneCount: number; stoneSizeMm: string; model: PublicDesign["model"] };
  colors: string[];              // ยาว = stoneCount พอดี · hex จาก stones[].colorHex หรือสี CZ · ผิดความยาว = ไม่วาด + onError
  selectedPos?: number | null;   // 1-based · ไฮไลต์อย่างเดียว ไม่เปลี่ยนสี
  view?: "front" | "free";       // "front" = กลับมุมหน้า (มุมเริ่มต้น)
  autoRotate?: boolean;          // ถูกปิดเองเมื่อ prefers-reduced-motion
  className?: string;            // UI กำหนดขนาดกล่องได้ · viewer เติมเต็มกล่อง ไม่บังคับ layout
};
type RingViewEvents = {
  onReady?: () => void;
  onUnsupported?: (reason: "no_webgl" | "context_lost" | "low_perf") => void;  // UI ต้องสลับไป RingSchematic
  onPositionTap?: (pos: number) => void;      // P2: ถ้า picking ยังไม่พร้อม จะไม่ยิง · UI ห้ามพึ่งเป็นทางเดียว
  onInteract?: (state: "start" | "end") => void;
};
type RingViewHandle = { snapshot(opts: { width: number; height: number }): Promise<HTMLCanvasElement | null> }; // มุมหน้าเสมอ · null = ใช้ภาพ 2D แทน
```

viewer **ไม่** fetch, ไม่รู้ราคา, ไม่รู้ชื่อพลอย, ไม่เก็บ state ของการเลือก, ไม่โหลดอะไรจากโดเมนภายนอก และถูก lazy-load หลังตรวจ WebGL ผ่านแล้ว

### 15.4 ด่านที่อยู่ฝั่ง server เสมอ (ดีไซน์หน้าจอแบบไหนก็ต้องไม่ต้องการให้ย้าย)

| ด่าน | อยู่ที่ |
|---|---|
| ราคาที่ผูกพัน คิดสดจาก DB ณ ตอนออกรหัส | `rb_quote` |
| พลอยหรือแบบที่ปิดไปแล้ว ขนาดเม็ดไม่มีราคา จำนวนเม็ดไม่ตรง ไซซ์นอกช่วง | `rb_quote` + route schema |
| เซ็นรหัส และประกอบ `lineText`/`qrText` | route (`server-only`) |
| ตรวจรหัสและเทียบราคา ณ ตอนสร้างกับปัจจุบัน | admin action + `rb_code_check` |
| allowlist ของข้อมูลสาธารณะ (ไม่มีต้นทุน) | `rb_public_catalog` (INVOKER) + mapper + test |
| สิทธิ์หลังบ้าน | middleware + `isOwnerOrAdmin` + actor check ใน RPC |

### 15.5 ข้อห้ามและข้อบังคับของดีไซน์หน้าจอ (เช็คลิสต์ตรวจงานเจ้าของ)

| ถ้าดีไซน์มี | ขัดกับ | ทางออก |
|---|---|---|
| ราคาคิดจากสูตรบนจอ ส่วนลด หรือโปรฯ | ด่านราคาฝั่ง server · มติ "ลดราคาไม่ได้" | ต้องเพิ่มใน DB และรหัสก่อน |
| ปุ่มชำระเงินหรือตะกร้า | ขอบเขตรอบนี้ (ส่ง LINE เท่านั้น) | phase ใหม่ |
| ฟอร์มชื่อ เบอร์ หรือที่อยู่ | ไม่เก็บข้อมูลส่วนตัว (หน้า exempt ไม่มี privacy policy รองรับ) | ไม่ทำ ให้คุยใน LINE |
| หน้าย่อยใต้ `/ring-builder/…` | กติกา exempt แบบ exact path | ใช้ state ในหน้าเดียว หรือ query/hash |
| รูป ฟอนต์ หรือสคริปต์จากโดเมนภายนอก (CDN หรือ Google Fonts ตรง) | canvas taint · privacy · CSP | self-host หรือใช้ Storage ของเรา |
| เปิดแท็บใหม่ (`window.open`/`target=_blank`) หรือปุ่มดาวน์โหลดเป็นทางเดียว | webview LINE/TikTok บล็อก | ใช้กดค้างเพื่อบันทึก + copyThenOpen |
| เลือกพลอยด้วยการลากอย่างเดียว หรือแตะในโมเดล 3D อย่างเดียว | a11y · เครื่องที่ไม่มี WebGL | ต้องมีทางแตะใน 2D ด้วย |
| สีเป็นสิ่งเดียวที่บอกว่าพลอยอะไร | ตาบอดสี · เม็ดเล็ก | ชื่อเป็นตัวหนังสือรายตำแหน่ง |
| คำว่า "เพชร" หรือไม่บอกว่าเป็น CZ | กฎแบรนด์ข้อ 4 | "CZ ขาว (รวมในราคาตัวเรือน)" |
| ราคาเงินหรือน้ำหนักโลหะคู่กับราคาแหวน | กฎแบรนด์ข้อ 1 | ตัดออก |
| คำเคลมสรรพคุณพลอย | กฎแบรนด์ข้อ 5 | ตัด หรือใช้ถ้อยคำ "ความเชื่อ" ที่ผ่านด่าน content |
| ไม่มีป้ายภาพจำลองหรือข้อความ pre-order | ความถูกต้องของข้อมูลสินค้า | บังคับใส่ |
| ไม่มีจอสำหรับ 409 หรือ reason ต่างๆ | §15.2 | ต้องมี state ครบ |
| layout ที่ใช้ไม่ได้ที่ความกว้าง 360 px หรือ viewer ที่บังคับขนาดตายตัว | เครื่องมือถือรุ่นเล็ก | กล่องยืดหยุ่น |
| ลิงก์ไป TikTok/Shopee หรือ QR ในรูปที่จะโพสต์บน TikTok | memory `tiktok-offplatform-policy` | ไม่ทำ |

---

### จุดที่ brief อาจสั่งผิดหรือยังมีช่อง
1. **เงื่อนไขข้อ 6 ตั้งต้นที่ three.js** — หลักฐานในรีโป (preview ของ Sabé) ชี้ว่าไม่จำเป็น จึงเสนอ WebGL ดิบ (เถียงไว้ใน §5)
2. **ไม่มีอะไรใน brief ครอบเรื่องไซซ์ต่อแบบ** ทั้งที่ข้อจำกัดทางกายภาพมีจริง → Q1
3. **การเลือก (a) ยังต้องมี exempt endpoint ใหม่ 1 ตัว** (quote แบบอ่านอย่างเดียว) เพราะ secret ต้องอยู่ฝั่ง server ⇒ ต้องผ่าน security ก่อน merge แม้จะไม่มีการเขียน DB
4. **brief ไม่ได้พูดถึงทิศของ "ตำแหน่ง 1"** ซึ่งกระทบงานผลิตจริง → Q2
5. **เจ้าของอยากเห็น 3D แต่ P1 เป็น 2D** — ควรบอกเจ้าของตรงๆ และให้ P2a spike คู่ขนาน เพื่อไม่ให้รอนาน

ไฟล์ที่อ่าน (absolute):
- `C:\Users\Markawan's NoteBook\Downloads\AI Learning\ai-dev-team-files\dev-team\docs\3j-jewelry\cad\satin-flow-preview.html`
- `C:\Users\Markawan's NoteBook\Downloads\AI Learning\ai-dev-team-files\dev-team\docs\3j-jewelry\cad\wave-embrace-preview.html`
- `C:\Users\Markawan's NoteBook\Downloads\AI Learning\ai-dev-team-files\dev-team\supabase\migrations\0190_gems_g1a.sql`
- `C:\Users\Markawan's NoteBook\Downloads\AI Learning\ai-dev-team-files\dev-team\middleware.ts`
- `C:\Users\Markawan's NoteBook\Downloads\AI Learning\ai-dev-team-files\dev-team\lib\auth\exempt-path.ts`
- `C:\Users\Markawan's NoteBook\Downloads\AI Learning\ai-dev-team-files\dev-team\app\api\gem-quiz\submit\route.ts`
- origin/main: `app/api/ring-size/event/route.ts`, `lib/jobs/gems-boundary.test.ts`, `lib/ring-size/share-card.ts`, `lib/shop/line.ts`, `lib/auth/owner-admin.ts`

หมายเหตุ: branch ที่เช็คเอาต์อยู่ (`chore/weekly-brief-2026-10-19`) ตามหลัง origin/main (`lib/ring-size/config.ts` ยังเป็น `TRACK_ENABLED=false` และ matcher ยังไม่มี `api/ring-size/event`) — โค้ดใน brief ผมจึงอ้างจาก origin/main · implementer ควรแตก branch จาก origin/main
# Technical Design — Silver Bar Pillar บน Wix (3jthailand.com)

> Design โดย architect (Yoda) · 2026-08-06 · ตอบโจทย์ที่ audit เจอ
> สมมติฐาน: Wix Editor (ไม่ใช่ Studio), Premium + custom domain, Velo enabled, Stores Catalog V1, Sheet→Wix sync มีอยู่แล้วแต่ยังไม่เห็นโค้ดจริง

## สรุปลำดับงาน

| # | งาน | Priority | Effort | ประเภท |
|---|---|---|---|---|
| 7 | แก้ LINE link ทั้งเว็บ | P0 | S | ✅ ทำได้เลย (Editor) |
| 1 | แยกบทบาท 2 หน้า + title/meta/canonical | P0 | S+M | ✅ config / content ส่ง copywriter |
| 2 | Price fallback (snapshot cache) | P0 | M | 🔧 Velo dev — **ต้องเปิดดู sync ก่อน** |
| 4 | JSON-LD ทุกหน้า | P1 | S-M | ✅ static / dynamic ต้อง Velo |
| 5 | Articles CMS + dynamic `/silver-bar/{slug}` | P1 | M | 🔧 Velo/CMS dev |
| 3 | NFC → `/verify/{serial}` | P1 | L | 🔧 Velo/CMS dev + ops |
| 6 | Currency: THB site + OEM quote-based | P2 | S | ✅ dashboard config |

**ไม่ต้องซื้อ app เพิ่มแม้แต่ตัวเดียว** — ทุกอย่างอยู่ใน Wix Editor + CMS + Velo ที่มีแล้ว

---

## 1. Duplicate `/silver-bar` vs `/silver-price` — P0 · S+M

> ✅ **เจ้าของยืนยัน 2026-08-06:** ไม่ได้ตั้งใจให้ duplicate. `/silver-price` = ตัวแสดงราคา **เก็บเดิมไม่แตะ**, `/silver-bar` = pillar ตาม design นี้. → ดีต่อความกังวล "ราคาไม่หาย" เพราะระบบราคาบน /silver-price ไม่ถูกแตะเลย

**IA: แยกบทบาท ไม่ redirect ไม่ cross-canonical**
- `/silver-bar` = **pillar** (trust + NFC + buy-back + ลิงก์ spoke) → kw "เงินแท่ง 999 / ซื้อเงินแท่งที่ไหนดี"
- `/silver-price` = **tool page** → kw "ราคาเงินวันนี้" — ตารางราคา + คำอธิบายสั้น + CTA กลับ pillar
- ทั้งคู่ **self-canonical** + แก้ title/H1/meta ให้ต่างจริง (ตอนนี้ title เดียวกัน = ต้นเหตุ cannibalization)
- Pillar ตัดตารางเต็มออก เหลือ "ราคาวันนี้แบบย่อ" + ลิงก์ "ดูราคาทุกขนาด → /silver-price"

**ไม่ 301 redirect:** "ราคาเงินวันนี้" คนละ intent + เป็น traffic driver ระยะยาว redirect = เสีย ranking. **ไม่ canonical ข้ามหน้า:** ขัดเป้าที่อยากให้ 2 หน้า rank คนละคำ
**ทำผ่าน:** Editor → Page settings → SEO (ตั้ง per page ได้เลย ไม่ต้อง Velo)
**ระวัง:** ดึง Search Console ของ 2 URL ก่อนแก้ ยืนยันว่าหน้าไหน rank คำไหน — กัน ranking หาย

## 2. ราคาโชว์ 0 บาทนอกเวลา — P0 · M (Velo)

**Root cause (น่าจะสุด):** Sheet คืน 0/ค่าว่างจริงตอนนอกเวลา (formula ยังไม่มีค่า) → Wix แสดงตาม. อาการ "0 ทุกช่องพร้อมกัน" ตรงกับข้อนี้ (ถ้า cache stale จะเห็นราคาเก่าไม่ใช่ 0)

**⚠️ ขั้นแรกบังคับ: เปิดดู implementation sync ปัจจุบัน** (Velo? app? iframe embed Sheet?) — design นี้ถูกเฉพาะกรณี sync เป็น Velo/fetch. ถ้าเป็น iframe embed ตรงๆ ต้อง rebuild เป็น Velo fetch ก่อน (effort → L). เช็ค: เปิด Editor ดู element ราคาเป็น text ที่ Velo set หรือ HTML iframe

**Design (ไม่แตะ Sheet):** ชั้น snapshot cache ใน Wix Data Collection
```
Sheet (source of truth) → fetch (Velo backend) → validate ราคาทุกช่อง > 0 ?
  ├─ ใช่ → แสดงสด + เขียนทับ collection PriceSnapshots
  └─ ไม่ (0/null/fail) → อ่าน snapshot ล่าสุด → แสดงราคาเดิม + badge "ราคาล่าสุด ณ [เวลา]"
```
- Collection `PriceSnapshots`: `payload` (JSON), `fetchedAt` (datetime) — เก็บ record เดียวเขียนทับ
- Logic ใน backend web module ตัวเดียว ให้ทั้ง 2 หน้าเรียก — กัน logic แตก
- **UX rule: ห้ามแสดง 0 ทุกกรณี** — ถ้า snapshot ก็ไม่มี แสดง "กำลังอัปเดตราคา ติดต่อ LINE"
- Optional เฟสหลัง: scheduled job fetch ทุก 15 นาทีช่วงเวลาทำการ

**Trade-off:** ราคานอกเวลา = "ของเมื่อวาน" ยอมรับได้เพราะติด label เวลา + สอดคล้อง disclaimer

## 3. ระบบ NFC → per-bar page — P1 · L (ระบบใหม่ทั้งชุด)

**Capability: Wix ทำได้เต็ม ไม่ต้องซื้อ app** — CMS Collection + Dynamic Page (ฟีเจอร์มาตรฐาน)

**Collection `SilverBars`:** `serial` (Text, unique, = URL slug, **non-sequential** เช่น `3J-8K2F7Q`), `photoFront/photoBack` (Image), `sizeBaht` (Number), `weightGram`, `purity` ("999"), `mintedDate` (Date), `status` (`active`/`bought_back`/`void`), `note`

**URL:** dynamic page `/verify/{serial}` — prefix สั้น เขียนลง NFC tag ประหยัด byte + แยก namespace จาก content pages (ไม่ใช้ `/silver-bar/{serial}` เพราะชนกับ spoke articles ข้อ 5)

**⚠️ serial non-sequential** เพราะเลขรัน (0001) เดา URL ได้ → ก๊อป tag ชี้แท่งอื่น. **สำคัญ: NFC ธรรมดา clone ได้เสมอ — ระบบนี้คือ provenance/trust signal ไม่ใช่ cryptographic anti-counterfeit** อยากแน่นกว่าค่อยอัป NTAG424 (YAGNI ตอนนี้)

**Flow:**
1. เจ้าของถ่ายรูปแท่ง → กรอกเข้า Collection ผ่าน Wix CMS admin UI (dashboard มี form ให้อยู่แล้ว)
2. เขียน URL ลง NFC tag ด้วยแอปมือถือ (NFC Tools) — งาน ops
3. ลูกค้าแตะ → เปิด URL → ดึง record → แสดงรูปจริง + spec + badge "ตรวจสอบแล้ว: เงินแท้ 999" + CTA
4. serial ไม่พบ → หน้า "ไม่พบข้อมูลแท่งนี้ ติดต่อร้าน" (ห้าม 404 เปล่า)

**ทำไม Wix CMS ไม่ใช่ Supabase:** ผูกกับ rendering Wix โดยตรง, dynamic page+CMS ฟรีในตัว, เจ้าของกรอกเองผ่าน dashboard. ไป Supabase ต้องเขียน API+admin UI เอง = L→XL. Trade-off: data lock-in Wix (ยอมได้ volume ต่ำ + export CSV ได้)
**Permission:** read = Anyone, write = Admin only

## 4. Structured data / JSON-LD — P1 · S-M

**Wix ทำได้ทุกตัว** ผ่าน 2 กลไก:
1. **Static** (pillar/price/FAQ): Editor → Page SEO → Advanced SEO → Structured data → วาง JSON-LD ตรงๆ (Organization/FAQPage/BreadcrumbList/HowTo/Product manual)
2. **Dynamic** (`/verify/{serial}`, spoke): Velo `wixSeo.setStructuredData()` ใน onReady

**ระวัง:**
- Wix Stores สร้าง `Product` schema อัตโนมัติบนหน้า product — **ห้ามใส่ซ้ำ** ใส่ manual เฉพาะ pillar ที่ไม่ใช่ Stores product page
- `Product.offers.price` เปลี่ยนทุกวัน → **แนะนำละ price ใส่แค่ `priceCurrency: THB` + `availability`** (ราคาผันผวนไม่ควร snapshot ลง schema)
- ตรวจด้วย Google Rich Results Test หลัง publish

## 5. URL scheme spoke `/silver-bar/[slug]` — P1 · M

**ทำได้ แต่ไม่ใช่ด้วย Wix Blog** (Blog URL ตายตัว `/post/{slug}` เปลี่ยน prefix ไม่ได้)
**แนะนำ: CMS Collection `Articles` + Dynamic Page prefix `/silver-bar/{slug}`** — รองรับ multi-segment ได้ nested URL ตามต้องการ
Collection `Articles`: `slug`, `title`, `metaTitle`, `metaDescription`, `heroImage`, `body` (Rich Content), `publishedDate`, `faqJson`

**Trade-off:** สละฟีเจอร์ Blog ทั้งหมด (RSS/comments/categories/auto-schema/related) ต้อง build layout เอง + copywriter กรอกผ่าน CMS. คุ้มเพราะ nested URL ส่งผล topical authority + เราไม่ใช้ RSS/comments อยู่แล้ว
**Fallback:** Blog `/post/{slug}` + internal linking หนา (ได้ ~80%)

## 6. Currency ต่อ pillar (THB retail / USD OEM) — P2 · S

**ข้อเท็จจริง:** Wix multi-currency ผูก Wix Payments ซึ่ง**ไม่รองรับไทย** → checkout หลายสกุล**ทำไม่ได้**. Currency Converter app ทำให้ราคาไทยแกว่งตาม FX = ไม่เอา

**แนะนำ (a):** Site currency = **THB**, OEM = **quote-based** (ไม่โชว์ราคาใน Stores, หน้า OEM แสดงกรอบราคา USD เป็น text/ตาราง + RFQ form) — ตรง reality B2B (OEM ไม่กด add-to-cart ต้องคุย MOQ/spec)
- ตัด (b) Currency Converter (ราคาไทยแกว่ง) + (c) แยก site OEM (split domain authority)

**Action ตามมา:** เว็บตอนนี้ currency = USD ทั้งเว็บ (US$0.00 เกลื่อน) → สลับเป็น THB ก่อน แล้วตั้งราคา retail ใหม่ (dashboard config + data entry ไม่ใช่ dev). เช็คว่าเปลี่ยน currency บน Catalog V1 ไม่พังหน้าไหน (เสี่ยงต่ำ ราคาส่วนใหญ่ยังไม่ตั้ง)

## 7. แก้ LINE link — P0 · S (5 นาที)

Canonical = `lin.ee/OOpBqt1`. งาน content edit:
1. Editor → หน้า `/silver-bar` → element LINE → เปลี่ยน `xI9iXTJ` → `OOpBqt1` → Publish
2. **กวาดทั้งเว็บ:** header/footer master, หน้าแรก, /silver-price, contact. เช็ค: view-source ทุกหน้า search `xI9iXTJ`
3. ถ้าฝังใน Velo/lightbox ให้ dev เช็ค code panel

---

## ⚠️ ความเสี่ยง / ต้องยืนยันก่อน implement
1. **ยังไม่เห็นโค้ด sync Sheet→Wix** — design ข้อ 2 พังถ้าเป็น iframe embed (rebuild, effort → L)
2. Dynamic page multi-segment prefix — มั่นใจสูงแต่ให้ dev สร้าง collection ทดสอบยืนยัน (10 นาที)
3. ก่อนแตะข้อ 1 ดู Search Console 2 URL — กัน ranking หาย
4. **NFC = provenance ไม่ใช่ crypto** — copywriter อย่าเขียน "ปลอมไม่ได้" ให้เขียน "ตรวจสอบแท่งจริงของคุณได้"
5. ข้อ 3 dependency ops หนัก: เจ้าของต้องถ่ายรูป+กรอก+เขียน tag **ทุกแท่ง** — confirm workflow ก่อนลงมือ ไม่งั้นได้ระบบไม่มี data

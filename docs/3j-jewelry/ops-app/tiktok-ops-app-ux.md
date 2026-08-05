# TikTok Ops App — UX/UI Design (Design-only)

> **สถานะ: Design-only — ยังไม่ implement.** ออกแบบโดย ux-ui (Padmé) ต่อยอด OMS เดิม (Next.js App Router + Supabase)
> **อ้างอิง data model:** `docs/3j-jewelry/analytics/marketing-analytics-db-design.md` (dim_address, fact_order, profit_status, parse_confidence, sku_alias, mv_channel_roas ฯลฯ)
> **ผู้ใช้:** เจ้าของ/แอดมิน 1–2 คน ~700 order/เดือน มือถือ+เดสก์ท็อป — งานหน้างานเร็ว ไม่ใช่ dashboard สำหรับทีมใหญ่

---

## 0. สำรวจของเดิมก่อนออกแบบ (reuse-first)

โปรเจกต์มี OMS UI อยู่แล้วที่ `app/(dashboard)/*`, `components/ui/*`, `components/domain/*` — 3 หน้าใหม่นี้เป็น **module ต่อยอดใน app เดียวกัน** ไม่ใช่แอปแยก จึงต้อง reuse ของเดิมทั้งหมดที่ทำได้:

| ของเดิมที่ reuse ได้ตรงๆ | ใช้ตรงไหนในโมดูลใหม่ |
|---|---|
| `components/ui/Button.tsx` (variant: primary/secondary/danger/ghost, loading prop) | ปุ่ม upload, อนุมัติ/ปัดทิ้ง, apply |
| `components/ui/Badge.tsx` (tone: blue/cyan/amber/indigo/green/red/slate/black/orange) | address_type, parse_confidence, profit_status, channel |
| `components/ui/EmptyState.tsx` / `ErrorState.tsx` / `ErrorBanner` | ครบทั้ง 3 หน้า (ดู state spec ด้านล่าง) |
| `components/ui/Skeleton.tsx` (pattern `Xxx...Skeleton`) | เพิ่ม `UploadQueueSkeleton`, `DashboardKpiSkeleton`, `CopilotCardSkeleton` ตาม pattern เดิม |
| `components/domain/FilterBar.tsx` | ต่อยอดเป็น dashboard filter (เพิ่ม address_type/date-range) |
| `components/ui/Toast.tsx` (ToastProvider จาก layout) | แจ้งผลอัปโหลด/apply สำเร็จ |
| `app/(dashboard)/layout.tsx` (sticky header, bottom-safe max-w-3xl, NAV_ITEMS) | เพิ่ม nav item ใหม่ 3 อัน ในโครงเดิม ไม่สร้าง layout ใหม่ |
| Font `Noto Sans Thai` (`--font-noto-sans-thai`), spacing/radius token, `min-h-11` touch target | ใช้เหมือนเดิมทั้งหมด |

**สรุป:** ไม่มีของใหม่ด้าน foundation ต้องสร้าง เพิ่มแค่ component เฉพาะโดเมน (upload dropzone, review table, KPI card, copilot card) ตาม pattern ของ `components/domain/*` เดิม

---

## 1. Decision สำคัญที่ต้อง call out ก่อนเริ่ม: สี brand 3J ชนกับ semantic สีเดิม

Requirement ขอ "ยึด brand 3J (ขาว/แดง #A2191D/เทา)" แต่ design system เดิมของ OMS (ดู `tailwind.config.ts`) ตั้งใจเลือก **primary = indigo-600 เพื่อไม่ชนกับสี semantic อื่น** — และที่สำคัญกว่านั้น **`red` ถูกจองไว้เป็น "danger/destructive"** แล้วทั้งระบบ (`Button variant="danger"`, `Badge tone="red"`, `ErrorState` แดง)

ถ้าเอา `#A2191D` (แดงเข้ม) มาเป็น primary color ของปุ่ม action หลักในโมดูลนี้ตรงๆ จะเกิดปัญหาจริง:
- ปุ่ม "Apply" ของ Ad Copilot ที่เป็น brand-red จะมองคล้าย "ปุ่มอันตราย/ลบ" — ขัด mental model ที่ผู้ใช้เพิ่งใช้ OMS เดิมมา (error/danger = แดงเสมอ)
- Badge สีแดงของ `address_type` หรือ `parse_confidence=low` จะถูกอ่านผิดเป็น "error" ทั้งที่แค่ต้อง review

**ทางแก้ที่เลือก (ต้อง validate กับเจ้าของ):** ใช้ `#A2191D` เป็น **brand accent เฉพาะจุด** ไม่ใช่ primary action color —
- Header/nav ของโมดูลนี้ (แถบ TikTok Ops) ใช้แดง 3J เป็นตัวบ่งชี้ section (เหมือน accent bar) — สร้างการจดจำ brand โดยไม่แตะ semantic
- ปุ่ม primary action (upload, confirm, apply) **ยังคง indigo-600 เดิม** เพื่อไม่ชนความหมาย "danger"
- Badge ยังใช้ tone เดิมของระบบ (`amber`=ต้อง review, `red`=ผิดพลาดจริง, `green`=complete, `slate`=unknown) ไม่ยืมสี brand มาทับความหมาย
- ขาว/เทา (พื้นหลัง, border, text) ใช้ตรงกับ `slate` scale เดิมอยู่แล้ว — ไม่ต้องเพิ่ม token ใหม่

*Trade-off ที่ยอมรับ:* โมดูลนี้จะดู "brand 3J" น้อยกว่าที่ requirement จินตนาการไว้ (ไม่ใช่หน้าตาแดงทั้งหน้าแบบ marketing site) แต่แลกกับ **ความสอดคล้องเชิงความหมายของสีทั้งระบบ** ซึ่งสำคัญกว่าสำหรับแอปที่ใช้งานทำงานจริงทุกวัน (operational app ≠ brand site) — **ต้อง confirm กับเจ้าของว่ายอมรับแนวทางนี้ได้ไหม หรือต้องการแยก visual identity ของโมดูลนี้ให้ชัดกว่านี้**

---

## 2. Information Architecture / Navigation

เพิ่ม 3 item ใน `NAV_ITEMS` เดิมของ `app/(dashboard)/layout.tsx` (ให้เจ้าของ/แอดมินสลับไปมาได้จากที่เดียว ไม่ใช่แอปแยก):

```
ออเดอร์ | สต็อก | เพิ่มสินค้า | ไลฟ์ | อัปโหลดใบปะหน้า | แดชบอร์ด | Ad Copilot
```

*หมายเหตุ:* nav bar เดิมโชว์ label เต็มเฉพาะ `sm:` ขึ้นไป, มือถือเห็นแค่ icon — 7 item เริ่มแน่นบนมือถือ ควร validate ว่าต้องยุบเป็น "เพิ่มเติม" (overflow menu) หรือไม่ (**ระบุเป็น open question ด้านล่าง ไม่เดาเอง**)

Route ที่เสนอ: `/tiktok/upload`, `/tiktok/dashboard`, `/tiktok/copilot` (แยก namespace ชัดจาก OMS core เผื่ออนาคตมีช่องทางอื่นมาเก็บใบปะหน้าเหมือนกัน)

---

## 3. หน้า 1 — Upload ใบปะหน้า TikTok

### User flow

```
เริ่ม: แอดมินมีไฟล์ใบปะหน้า (PDF/รูป) จาก TikTok Seller Center — อาจ 1 ไฟล์ multi-page หรือหลายไฟล์/วัน
  │
  ▼
[1] เปิดหน้า /tiktok/upload
  │
  ▼
[2] Drag-drop หรือกดปุ่มเลือกไฟล์ (batch ได้หลายไฟล์พร้อมกัน)
  │
  ├─ ไฟล์ผิดชนิด (.docx, .zip) → reject ทันทีต่อไฟล์ พร้อมเหตุผล ไม่บล็อกไฟล์อื่นที่ถูกต้องในชุดเดียวกัน
  ├─ ไฟล์เกิน limit ขนาด/จำนวนหน้า → reject พร้อมเหตุผล ("ไฟล์ใหญ่เกิน 20MB")
  │
  ▼
[3] แสดง progress ต่อไฟล์ (queued → parsing → done/failed) — ทำงาน async ไม่บล็อก UI
  │
  ├─ parse ล้มเหลวทั้งไฟล์ (อ่านไม่ออก/ภาพเบลอ) → เข้า "ต้องอัปโหลดใหม่" ไม่ปนกับ review queue (คนละปัญหา: นี่คือไฟล์พัง ไม่ใช่ข้อมูลไม่ชัวร์)
  │
  ▼
[4] สรุปหลังอัปโหลด (batch summary): สำเร็จ N ใบ / ต้อง review N ใบ / ซ้ำ N ใบ (duplicate order id) / parse ไม่สำเร็จ N ไฟล์
  │
  ▼
[5] Review/confirm queue — เฉพาะแถวที่ parse_confidence=low, address_type=unknown, sku_alias ไม่รู้จัก
  │  แอดมินแก้ทีละแถว (แก้ address_type, map sku_alias ใหม่, แก้ field ที่ parse ผิด) → กด "ยืนยัน"
  │  หรือกด "ยืนยันทั้งหมดที่เหลือ" ถ้าเช็คแล้วว่าถูกต้อง (ต้องมี confirm dialog กันกดพลาด)
  │
  ├─ แถวซ้ำ (duplicate order id ที่เคย import แล้ว) → เตือนแยก ให้เลือก "ข้าม" หรือ "แทนที่ของเดิม" ต่อแถว ไม่ auto-skip เงียบๆ
  │
  ▼
จบ: ข้อมูล commit เข้า fact_order / dim_address / fact_order_item (ผ่าน stg_order_import ตาม data model) — แถว auto-pass (confidence สูง) commit ทันทีไม่ต้องรอคน
```

**Edge case ที่ตั้งใจออกแบบรองรับ:**
- อัปโหลดไฟล์เดิมซ้ำ (คนละวัน เผลอลากซ้ำ) → detect ด้วย order id ซ้ำ ไม่ commit ทับเงียบๆ
- ไฟล์ 1 ใบมีหลาย order (PDF รวมใบปะหน้าหลายใบ) → parser ต้องแตกเป็นหลาย record, UI แสดงนับเป็น "จำนวน order ที่ parse ได้" ไม่ใช่ "จำนวนไฟล์" (สำคัญมาก ไม่งั้นสรุปตัวเลขมั่ว)
- Network หลุดระหว่างอัป → retry ต่อไฟล์ได้ ไม่ต้องอัปทั้งชุดใหม่
- ปิด browser ระหว่าง parsing → งาน parse รันฝั่ง server ต่อได้ (queue), กลับมาเปิดหน้าใหม่เห็นสถานะล่าสุด ไม่ใช่หายไปเฉยๆ

### Layout spec (mobile-first)

```
┌─────────────────────────────────────┐
│ Header (reuse layout เดิม)            │
├─────────────────────────────────────┤
│ [Dropzone] "ลากไฟล์ใบปะหน้ามาวางที่นี่" │  ← primary action เดียวของหน้านี้
│  หรือ [ปุ่ม: เลือกไฟล์]                │     (PDF/JPG/PNG, สูงสุด 20MB/ไฟล์)
├─────────────────────────────────────┤
│ UploadQueueList (แสดงเมื่อมีไฟล์อยู่ระหว่างดำเนินการ) │
│  ┌───────────────────────────────┐   │
│  │ 📄 ใบปะหน้า_030826.pdf         │   │
│  │ [progress bar] parsing...     │   │
│  └───────────────────────────────┘   │
│  ┌───────────────────────────────┐   │
│  │ 📄 scan_004.jpg  ❌ อ่านไม่ออก  │   │
│  │ [ปุ่ม: อัปโหลดใหม่]              │   │
│  └───────────────────────────────┘   │
├─────────────────────────────────────┤
│ BatchSummaryCard (แสดงหลังจบ batch)   │
│  สำเร็จ 42 · ต้อง review 6 · ซ้ำ 2 · ล้มเหลว 1 │
├─────────────────────────────────────┤
│ ReviewQueueTable (แสดงเมื่อมีแถวรอ review)│
│  แถวละ: order_id · badge เหตุผล(low-confidence/unknown/alias) │
│         · field ที่ต้องแก้ (inline edit) · [ยืนยัน]│
│  ปุ่มลอย (sticky bottom บนมือถือ): [ยืนยันทั้งหมดที่เหลือ] │
└─────────────────────────────────────┘
```

### State ครบ 4

| State | เงื่อนไข | UI |
|---|---|---|
| **Loading** | ไฟล์กำลัง parse (async, ต่อไฟล์) | `UploadQueueSkeleton` ต่อรายการไฟล์ + progress bar indeterminate ระหว่าง upload, determinate (%) ระหว่าง parse ถ้า backend ส่ง progress ได้ |
| **Empty** | ยังไม่เคยอัปโหลดวันนี้ / เพิ่งเข้าหน้าครั้งแรก | `EmptyState` icon=UploadCloud, title="ยังไม่มีไฟล์วันนี้", description="ลากไฟล์ใบปะหน้ามาวาง หรือกดเลือกไฟล์" + ปุ่ม CTA ในตัว emptystate เอง (component เดิมรองรับ `action` prop) |
| **Error** | (ก) ไฟล์ผิดชนิด/เกิน limit — reject ก่อน upload; (ข) parse ทั้งไฟล์ล้มเหลว; (ค) network fail กลางทาง | (ก)(ข) ใช้ inline error ต่อแถวไฟล์ (ไม่ block ไฟล์อื่น) + ปุ่ม "อัปโหลดใหม่" ต่อไฟล์ · (ค) ใช้ `ErrorBanner` เหนือ list พร้อม retry ต่อไฟล์ที่ค้าง — **ไม่ใช้ `ErrorState` เต็มจอ** เพราะไฟล์อื่นที่ผ่านแล้วต้องยังเห็นอยู่ (ข้อมูลไม่หาย) |
| **Success** | parse ครบ, batch summary ออก, review queue ว่างหรือ confirm หมดแล้ว | `BatchSummaryCard` + toast "บันทึกออเดอร์ X รายการเรียบร้อย" (reuse `ToastProvider`) · ถ้า review queue ว่างพอดี (ทุกแถว confidence สูง) ให้ **ข้าม queue section ไปเลย** ไม่โชว์ตารางเปล่าเปล่า (เป็น empty-of-a-subsection ไม่ใช่ empty state เต็มหน้า) |

### Component breakdown (ส่งต่อ frontend-dev)

- `UploadDropzone` — ใหม่, client component, รับ multi-file, validate type/size ฝั่ง client ก่อนส่ง (reject เร็ว ไม่รอ round-trip), accessible: keyboard-focusable, `<input type="file">` ซ่อนไว้ label ครอบ, drag state มี `aria-live` ประกาศ "วางไฟล์เพื่ออัปโหลด"
- `UploadQueueList` + `UploadQueueItem` — ใหม่, ตาม pattern `OrderListItem` เดิม (list of card), แต่ละ item มี progress state
- `UploadQueueSkeleton` — ใหม่ ตาม pattern `Skeleton.tsx` เดิม
- `BatchSummaryCard` — ใหม่, การ์ดสรุปตัวเลข 4 ก้อน (สำเร็จ/review/ซ้ำ/ล้มเหลว) คล้าย `PrioritySummaryBar` เดิมโครงสร้าง (reuse pattern ไม่ reuse component ตรงๆ เพราะข้อมูลคนละ domain)
- `ReviewQueueTable` + `ReviewQueueRow` — ใหม่, แต่ละ row: `Badge` (reuse) บอกเหตุผล review (`amber`="ต้องตรวจสอบ", ไม่ใช่ `red` เพราะไม่ใช่ error), inline field editor (dropdown สำหรับ `address_type`/`sku_alias`, text input สำหรับ field parse ผิด)
- `DuplicateOrderDialog` — ใหม่, ใช้ `Modal` เดิม (`components/ui/Modal.tsx`) ครอบ ถามข้าม/แทนที่
- ปุ่มทั้งหมด → reuse `Button` เดิม (primary=ยืนยัน, secondary=อัปโหลดใหม่, ghost=ข้าม)
- Toast แจ้งผล → reuse `ToastProvider`

---

## 4. หน้า 2 — Dashboard รายวัน

### User flow

```
เริ่ม: เจ้าของเปิดแอปตอนเช้า/ระหว่างวันเพื่อดูภาพรวม
  │
  ▼
[1] เปิดหน้า /tiktok/dashboard — default range = วันนี้ (เทียบเมื่อวาน)
  │
  ▼
[2] เห็น KPI card แถวบน + data-quality indicator ก่อนอ่านตัวเลขอื่น (บังคับ eye-path ให้เห็น caveat ก่อนเชื่อตัวเลข)
  │
  ▼
[3] ปรับ filter (ช่วงเวลา / ช่องทาง / address_type) → ตัวเลขทั้งหน้าอัปเดตตาม
  │
  ├─ วันที่ไม่มี order เลย (วันหยุด/พังไม่ได้ import) → empty state เฉพาะจุด ไม่ทำให้ทั้งหน้าว่าง (KPI ยังโชว์ 0 ได้ปกติ ไม่ error)
  ├─ query ช้า/API ล้มเหลว → error banner, ตัวเลขเก่า (cache) ยังค้างให้ดูได้ถ้ามี
  │
  ▼
[4] Breakdown ด้านล่าง: ช่องทาง / จังหวัด / address_type / สินค้าขายดี — ดูรายละเอียดเพื่อตัดสินใจ (ไม่ใช่ action โดยตรงในหน้านี้ ส่งต่อ Ad Copilot)
  │
  ▼
จบ: เจ้าของได้ภาพวันนี้ + รู้ว่าตัวเลขไหนเชื่อได้เต็มที่ ไหนต้อง discount (data-quality %)
```

### Layout spec

```
┌─────────────────────────────────────┐
│ Header + FilterBar (ช่วงเวลา/ช่องทาง)   │  ← reuse FilterBar เดิม ต่อเติม date-range + address_type
├─────────────────────────────────────┤
│ DataQualityBanner (เด่น, อยู่บนสุดของ content เสมอ) │
│  "กำไรกรอกครบ 62% · จังหวัด unknown 4%"│  ← ต้องเห็นก่อนตัวเลข ไม่ใช่ทีหลัง
├─────────────────────────────────────┤
│ KPI Grid (4 การ์ด, 2 คอลัมน์บนมือถือ)   │
│  [ยอดขายวันนี้ ↑12% vs เมื่อวาน]         │
│  [จำนวนออเดอร์ ↓3%]                   │
│  [กำไร (coverage 62%) ↑5%]            │  ← ต่อท้ายชื่อ metric ด้วย coverage % เสมอถ้าไม่ครบ 100
│  [AOV →0%]                            │
├─────────────────────────────────────┤
│ Tabs/Segmented: ช่องทาง | จังหวัด | ประเภทที่อยู่ | สินค้าขายดี │
│  → breakdown table/bar ต่อ tab ที่เลือก│
└─────────────────────────────────────┘
```

**เหตุผลใช้ Tabs ไม่ใช่ 4 การ์ดเรียงยาว:** ข้อมูล breakdown 4 มิติพร้อมกันบนมือถือจะยาวเกินไป, cognitive load สูง — ให้เลือกดูทีละมิติตาม task จริง ("วันนี้ช่องทางไหนแรง" คนละคำถามกับ "จังหวัดไหนแรง") *Trade-off: เสียการเห็นภาพรวมทุกมิติพร้อมกันในสายตาเดียว บนจอกว้าง (desktop) อาจแสดงเป็น grid 2x2 แทน tabs ได้ — ต้อง responsive breakpoint แยก mobile(tabs)/desktop(grid)*

### State ครบ 4

| State | เงื่อนไข | UI |
|---|---|---|
| **Loading** | โหลดครั้งแรก/เปลี่ยน filter | `DashboardKpiSkeleton` (ใหม่ ตาม pattern เดิม) — skeleton card 4 ใบ + skeleton breakdown |
| **Empty** | ช่วงที่เลือกไม่มี order เลย (เช่นเลือกวันที่ยังไม่ได้ import) | ไม่ทำทั้งหน้าเป็น EmptyState — KPI card โชว์ "0" ปกติพร้อม label ชัดว่า "ไม่มีข้อมูลช่วงนี้" ส่วน breakdown table ใช้ `EmptyState` เฉพาะ section นั้น title="ไม่มีออเดอร์ในช่วงนี้" |
| **Error** | ดึงข้อมูลไม่สำเร็จ | ถ้ามี cache เก่า → `ErrorBanner` เหนือตัวเลขเก่า (บอกชัดว่าเป็นข้อมูลเก่า ไม่ใช่ของช่วงที่เลือกจริง) · ถ้าไม่มี cache เลย (ครั้งแรก) → `ErrorState` เต็ม section พร้อม retry |
| **Success** | มีข้อมูลปกติ | KPI grid + DataQualityBanner + breakdown ตาม tab ที่เลือก |

**Data-quality indicator เป็นของบังคับ ไม่ใช่ nice-to-have:** เพราะกำไรกรอกไม่ครบ (`profit_status`), จังหวัด unknown (`TH-XX`) เป็นความจริงของข้อมูลตาม data model — ถ้าไม่โชว์คู่กับตัวเลข เจ้าของจะอ่านกำไร/geo ผิดโดยไม่รู้ตัว design ตัดสินใจ**บังคับแสดงคู่กันเสมอ ปิดไม่ได้** (ต่างจาก filter อื่นที่ optional)

### Component breakdown

- `DashboardKpiCard` — ใหม่, รับ value/delta/comparisonLabel/coveragePct(optional) — ถ้ามี coveragePct < 100 ต้องโชว์ subtext เตือนเสมอ (ผูก logic ไว้ใน component ไม่ใช่ทิ้งให้ผู้เรียกลืม)
- `DataQualityBanner` — ใหม่, persistent, ไม่มีปุ่มปิด (ตั้งใจ — กันเจ้าของปิดแล้วลืม)
- `BreakdownTabs` — ใหม่ (mobile) / `BreakdownGrid` (desktop, responsive variant เดียวกัน)
- `FilterBar` (extend) — เพิ่ม date-range picker + address_type filter ใหม่ ในโครง component เดิม
- `DashboardKpiSkeleton`, และ empty/error ใช้ `EmptyState`/`ErrorState`/`ErrorBanner` เดิมตรงๆ

---

## 5. หน้า 3 — Ad Copilot / แนะนำการยิงแอด

### User flow

```
เริ่ม: เจ้าของ/แอดมินเข้ามาเช็คว่าวันนี้/สัปดาห์นี้ควรปรับแอดยังไง
  │
  ▼
[1] เปิดหน้า /tiktok/copilot — เห็น "การ์ดคำแนะนำ" เรียงตาม priority (confidence สูง + impact สูงอยู่บน)
  │
  ▼
[2] แต่ละการ์ด: หัวข้อคำแนะนำ + เหตุผล(อ้างตัวเลขจริงจาก mv_channel_roas/mv_rfm_segment/mv_geo_performance) + confidence badge
  │
  ▼
[3] ผู้ใช้ตัดสินใจต่อการ์ด: [อนุมัติ] / [ปัดทิ้ง] — human-in-loop เสมอ ไม่มี auto-apply เงียบๆ
  │
  ├─ อนุมัติ → การ์ดย้ายไป "อนุมัติแล้ว" section, สถานะเปลี่ยนชัดเจน (ไม่ใช่แอปแล้ว action จริง — เฟสนี้ apply ยังไม่ผูก automation จริง ผู้ใช้ยังต้องไปทำเองใน Ads Manager)
  ├─ ปัดทิ้ง → ถามเหตุผลสั้นๆ (optional dropdown: "ไม่เกี่ยวข้อง/ลองแล้วไม่ได้ผล/ข้อมูลไม่พอ") — เก็บไว้ปรับ AI ภายหลัง ไม่ใช่บังคับกรอก
  │
  ▼
[4] (เฟสอนาคต) ปุ่ม "Apply" มี guard — ต้อง confirm dialog สองชั้น + แสดง scope ที่จะเปลี่ยนจริงก่อนยืนยัน (ยังไม่ implement ตอนนี้ ปุ่มควรอยู่ใน layout ไว้ล่วงหน้าแต่ disabled + tooltip "เร็วๆ นี้" เพื่อไม่ต้อง redesign รอบสอง)
  │
  ▼
จบ: เจ้าของรู้ว่าควรทำอะไรต่อ (งบ/audience/geo/ครีเอทีฟ) พร้อมเหตุผลตรวจสอบได้ ไม่ใช่ black box
```

**ทำไม human-in-loop เป็น non-negotiable:** ข้อมูลมี known gap จริง (กำไร 0 ในของเก่า, TikTok identity เป็นแค่ probable, cost ยังไม่ครบ) — auto-apply บนข้อมูลไม่ครบ = เสี่ยงยิงงบผิดจริง ในสเกล 700 order/เดือนที่เจ้าของดูเองได้ การให้คนกดยืนยันทุกครั้งคือ safety net ที่ถูกที่สุด ไม่ใช่ over-engineering

### Layout spec

```
┌─────────────────────────────────────┐
│ Header                                │
├─────────────────────────────────────┤
│ Section: "รอพิจารณา" (default view)    │
│  ┌───────────────────────────────┐   │
│  │ [icon] เพิ่มงบ TikTok +15%      │   │
│  │ confidence: สูง                 │  ← badge, ไม่ใช่ % เดายาก ใช้ high/medium/low ให้อ่านไว
│  │ เหตุผล: ROAS TikTok 4.2x        │
│  │  vs Meta 2.1x (ก.ค.)            │  ← อ้างตัวเลขจริงเสมอ ไม่ใช่ "AI คิดว่า"
│  │ [ปัดทิ้ง]      [อนุมัติ]         │  ← primary action เดียวชัด = อนุมัติ
│  └───────────────────────────────┘   │
│  ... การ์ดถัดไป (เรียง priority)       │
├─────────────────────────────────────┤
│ Section: "อนุมัติแล้ว" (collapsed by default, กดขยายดูได้) │
│ Section: "ปัดทิ้งแล้ว" (collapsed, audit trail)│
└─────────────────────────────────────┘
```

**เหตุผลแยก 3 section แทนโชว์รวมแล้วขีดฆ่า/เปลี่ยนสี:** การ์ดที่ตัดสินใจแล้วปนกับที่รอพิจารณาทำให้ scan ยาก (ต้องดูทุกใบว่าอันไหนทำแล้ว) — แยก section ให้ "รอพิจารณา" เป็น default ที่เห็นทันที ส่วนอีก 2 section ใช้เป็น audit trail พับเก็บได้

### State ครบ 4

| State | เงื่อนไข | UI |
|---|---|---|
| **Loading** | กำลังคำนวณ/ดึงคำแนะนำ | `CopilotCardSkeleton` (ใหม่) ทำ card outline ค้าง 3 ใบ |
| **Empty** | ไม่มีคำแนะนำใหม่ (ข้อมูลไม่พอ/ทุกอย่าง optimal แล้ว/ยังไม่ implement AI engine จริง) | `EmptyState` icon=Sparkles, title="ยังไม่มีคำแนะนำตอนนี้", description="ระบบจะวิเคราะห์ใหม่พรุ่งนี้ หรือเมื่อมีข้อมูลมากพอ" — **สำคัญ: ต้องบอกตรงว่าทำไมว่าง ไม่ใช่แค่ปล่อยว่างเฉยๆ** เพราะผู้ใช้ต้องแยกให้ออกว่า "ไม่มีเพราะระบบทำงานปกติ" vs "พังหรือเปล่า" |
| **Error** | engine คำนวณล้มเหลว/API ล่ม | `ErrorState` พร้อม retry — การ์ดที่เคยอนุมัติ/ปัดทิ้งไว้ก่อนหน้ายังต้องเห็นได้ (แยก state ต่อ section ไม่ error รวมทั้งหน้า) |
| **Success** | มีการ์ดคำแนะนำ | รายการการ์ดตาม layout ข้างบน |

### Component breakdown

- `CopilotCard` — ใหม่, รับ `title/reasonText/reasonMetrics/confidence('high'|'medium'|'low')/status('pending'|'approved'|'dismissed')` — confidence ใช้ `Badge` reuse (`green`=high, `amber`=medium, `slate`=low แทนการเดา % ตรงๆ ให้ผู้ใช้ที่ไม่ใช่ data scientist อ่านไว)
- `CopilotCardSkeleton` — ใหม่ตาม pattern เดิม
- `DismissReasonSheet` — ใหม่, reuse `Modal`/bottom-sheet pattern จาก `AdjustStockSheet.tsx` เดิม (โปรเจกต์มี sheet pattern อยู่แล้วสำหรับ mobile — ใช้ต่อ ไม่คิดใหม่)
- ปุ่มอนุมัติ/ปัดทิ้ง → reuse `Button` (primary=อนุมัติ, secondary/ghost=ปัดทิ้ง)
- ปุ่ม Apply (future, disabled placeholder) → `Button` variant secondary + `disabled` + native `title` tooltip "เร็วๆ นี้" — เตรียม layout ไว้ไม่ต้อง redesign รอบสอง แต่ **ไม่ implement logic จริงตอนนี้** ตามที่ requirement ระบุ "เผื่ออนาคต"

---

## 6. Accessibility & Responsive (คร่อมทั้ง 3 หน้า)

- ทุกปุ่ม/target แตะ ≥ 44px (`min-h-11` เดิมของระบบ) — โดยเฉพาะปุ่มอนุมัติ/ปัดทิ้งใน Copilot และปุ่มยืนยันใน review queue ที่กดถี่
- Contrast: badge tone เดิมผ่าน WCAG AA อยู่แล้ว (ระบบเดิมออกแบบไว้) — brand red accent ใหม่ (`#A2191D` บน header) ต้องเช็ค contrast กับ white text จริง (#A2191D บนขาวได้ AA แต่ white-on-#A2191D ต้อง verify ด้วย contrast checker ก่อนใช้จริง เพราะเป็น token ใหม่ที่ไม่เคยผ่านการ verify ในระบบเดิม)
- Semantic structure: ใช้ `<table>` จริงสำหรับ ReviewQueueTable/Breakdown table (ไม่ใช่ div ซ้อน) เพื่อ screen reader อ่าน column header ถูก, upload progress ใช้ `role="status"` + `aria-live="polite"` (ตาม pattern `Skeleton.tsx` เดิมที่ใช้ `role="status"` อยู่แล้ว)
- Keyboard: dropzone ต้อง focusable + Enter/Space เปิด file picker ได้ (ไม่ใช่ drag-only), review queue inline-edit ต้อง tab order เป็นเส้นตรงตามแถว
- Responsive: mobile-first ตามโครง `max-w-3xl` เดิม — breakdown ในหน้า dashboard สลับ tabs(mobile)/grid(desktop) ตามที่ระบุใน §4

---

## 7. Design decisions สรุป + จุดที่ต้อง validate กับผู้ใช้จริง

| ประเด็น | สิ่งที่ตัดสินใจ | เหตุผล | ต้อง validate |
|---|---|---|---|
| สี brand แดง 3J | ใช้เป็น accent เฉพาะจุด ไม่ใช่ primary action | กันชนกับ semantic "danger" เดิมทั้งระบบ | **ใช่ — ต้องถามเจ้าของว่ายอมรับได้ไหม หรืออยากให้โมดูลนี้ดู "3J" ชัดกว่านี้** |
| Review queue vs parse-fail แยกกัน | คนละ UI section | เป็นปัญหาคนละแบบ (ข้อมูลไม่ชัวร์ vs ไฟล์อ่านไม่ได้) ต้องแก้คนละวิธี | ไม่ต้อง validate — logic ตรงไปตรงมา |
| Nav เพิ่ม 3 item บนมือถือ | เสี่ยงแน่นเกินไป | 7 item บน header เดิมที่ออกแบบไว้ 4 | **ใช่ — ต้องทดสอบบนมือถือจริงว่าอ่าน label ไหวไหม/ต้องทำ overflow menu** |
| Data-quality banner ปิดไม่ได้ | ตั้งใจบังคับ | กันอ่านตัวเลขผิดโดยไม่รู้ตัว | ควร validate ว่ารำคาญเจ้าของไหมหลังใช้จริง 1-2 สัปดาห์ (ถ้าใช่ ค่อยทำ collapse ได้แต่ default ต้องเปิด) |
| Ad Copilot ไม่มี auto-apply | human-in-loop บังคับทุกคำแนะนำ | ข้อมูลมี known gap จริง (profit/identity ไม่ครบ) | ไม่ต้อง validate ตอนนี้ — เป็น requirement ที่ระบุมาแล้ว (human-in-loop) |
| Tabs vs grid สำหรับ breakdown 4 มิติ | tabs บนมือถือ, grid บน desktop | ลด cognitive load บนจอเล็ก | ควร validate ว่าเจ้าของอยากเห็นภาพรวมทุกมิติพร้อมกันบนมือถือไหม (อาจต้องการมากกว่าที่คาด เพราะเช็คทุกเช้าเร็วๆ) |
| Route แยก `/tiktok/*` | namespace เฉพาะ ไม่ปนกับ order OMS core | เผื่ออนาคตมีช่องทางอื่นเก็บใบปะหน้าแบบเดียวกัน | ไม่ต้อง validate — เป็น technical decision ล้วน |

## 8. คำถามที่ยังตัดสินไม่ได้ (ต้องถามก่อน handoff ไป architect/frontend-dev)

1. **Parser เบื้องหลัง** — ใช้ OCR/LLM vision (เช่น Claude) parse ใบปะหน้า หรือมี template คงที่ที่ parse ด้วย regex ได้? กระทบ latency ที่ต้องออกแบบ progress UI (ถ้าเรียก LLM ต่อไฟล์จะช้ากว่า regex มาก, อาจต้องมี queue + notification แทน progress bar แบบ real-time)
2. **จำนวนไฟล์ต่อ batch จริง** — วันที่ไลฟ์หนักสุดมีกี่สิบ/ร้อยใบ? กระทบว่า UploadQueueList ต้อง virtualize list หรือพอแค่ scroll ธรรมดา
3. **Ad Copilot engine** — Phase นี้ยังเป็นแค่ UI shell (ตาม requirement "อนาคตต่อ Claude") ยืนยันว่า Phase 1 ของโมดูลนี้ = mock/static คำแนะนำ หรือต้องต่อ LLM จริงจาก mv_channel_roas ทันที? กระทบ scope ที่ frontend-dev ต้อง implement รอบแรก
4. **Nav overflow บนมือถือ** — ตามที่ระบุใน §7 ต้องทดสอบจริงก่อนสรุป
5. **สิทธิ์การเข้าถึง** — ทั้ง 3 หน้าเปิดให้ owner+admin เท่ากันไหม หรือ Ad Copilot (มีผลด้านการเงิน/งบโฆษณา) ควรจำกัดเฉพาะ owner? กระทบ RLS/route guard

---

**สรุป:** เอกสารนี้เป็น design-only ครอบคลุม user flow + layout + 4 states + component breakdown + trade-off ของทั้ง 3 หน้า พร้อม flag ประเด็นสี brand ที่ชนกับ semantic เดิมเป็นจุดต้องตัดสินใจก่อนส่งต่อ `frontend-dev` implement

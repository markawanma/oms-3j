# 3J OMS — UI Refresh Plan: Home/Dashboard + Brand Expression

> เจ้าของอยากให้ UI สวยขึ้น + user-friendly · โฟกัส: **Home/Dashboard** + **บุคลิกแบรนด์เครื่องเงินพรีเมียม**
> เขียนโดย Tech Lead (ux-ui agent ล่มจาก infra 2 รอบ) · grounded กับ `3j-theme-spec.md` + views จริง
> Owner: ส่งให้ frontend-dev implement หลังเจ้าของเคาะ §4

## 0. ความจริงก่อนเริ่ม (สำคัญ — กัน rework)

**Brand theme v1 ทำเสร็จ+ลงโค้ดแล้ว** (`docs/3j-jewelry/ops-app/3j-theme-spec.md`):
- `primary = #a2191d` = **แดงแบรนด์ 3J** (ใกล้มารูนในโลโก้ #6E1B1B–#7A1F1F — โลโก้เข้มกว่านิด = primary-700/800) ใช้กับ ปุ่ม/nav-active/link/focus แล้ว
- neutrals = zinc (โทนเงิน) · font = Noto Sans Thai self-hosted · radius/touch-target token ครบ
- กฎ brand-vs-danger ชัด (primary แดงเข้ม 600–900, danger = stock red, ห้าม primary-400/500 เป็น solid fill)

→ **ไม่ต้อง re-palette / ไม่ต้อง rebrand component.** ที่ "รู้สึกเทา" เพราะ spec ตั้งใจใช้แบรนด์แบบ minimal. งาน refresh นี้ = **เพิ่มหน้า Dashboard** + **แสดงแบรนด์ให้เด่นขึ้นแบบมีรสนิยม** (ในกรอบ spec เดิม ไม่ over-brand)

---

## 1. Home / Dashboard (งานหลัก — ของใหม่)

**เป้า:** เปิดแอปมาต้องเห็น "วันนี้/ตอนนี้เป็นไง" ใน 3 วินาที + กดไปทำงานต่อได้เร็ว (ตอนนี้เปิดมาเจอหน้าออเดอร์ดิบๆ ไม่มีจุดสรุป)

**Route:** เพิ่ม `/dashboard` เป็นเมนูแรกกลุ่ม "หน้าร้าน" (ไม่แตะ `/` ที่เป็นหน้าออเดอร์เดิม — ลดความเสี่ยง). owner/admin เห็นเต็ม; staff เห็นเวอร์ชันจำกัด (ซ่อน KPI เงิน/กำไร)

### 1.1 Layout (เรียงตามความสำคัญ — mobile-first)

```
┌───────────────────────────────────────────────┐
│ [logo] สวัสดี · ร้าน 3J          [ปุ่มช่วงเวลา] │  ← header + greeting
│ ศุกร์ 14 ส.ค. 2026                              │
├───────────────────────────────────────────────┤
│ ⚠️ ต้องจัดการ  (แสดงเฉพาะเมื่อมี — เด่นสุด)     │
│  [ออเดอร์ค้างของไม่พอ N]  [SKU ใกล้หมด M]      │  ← action-needed (คลิกไปหน้านั้น)
├───────────────────────────────────────────────┤
│ ยอดวันนี้     ออเดอร์    กำไร(ปมณ)   AOV        │  ← KPI StatCards (4)
│  ฿12,340       18        ฿2,468     ฿685        │     hero number = primary-700
├───────────────────────────────────────────────┤
│ 💡 แนะนำ (Ad Copilot)                           │
│  • 9.9 อีก 26 วัน — เตรียม hero SKU  →          │  ← top reco 1-2 ใบ
├───────────────────────────────────────────────┤
│ ลูกค้า           ช่องทางเด่น                    │  ← snapshot 2 คอลัมน์
│ champion 6 loyal 55 new 177   LINE ROAS ×..     │
├───────────────────────────────────────────────┤
│ ทางลัด: [กรอกค่าแอด][เพิ่ม SKU][จอ hero][วัดผลโค้ด] │  ← quick actions
└───────────────────────────────────────────────┘
```
มือถือ: KPI 2 คอลัมน์, section stack เรียงบนลงล่างตามภาพ · desktop: KPI 4 คอลัมน์

### 1.2 แต่ละ section + data source จริง (frontend-dev ต่อ action ตามนี้)

| Section | ข้อมูล | มาจาก |
|---|---|---|
| **ต้องจัดการ** (บนสุด ถ้ามี) | จำนวนออเดอร์ oversold_hold + กี่เคสเกิน SLA · จำนวน hero SKU is_low/is_out | `v_oversold_hold_queue`, `v_hero_stock` |
| **KPI วันนี้/เดือนนี้** | ยอดขาย, จำนวนออเดอร์, กำไรประมาณการ, AOV (+ toggle วันนี้/7วัน/เดือน) | `v_fact_order` (filter order_date) |
| **แนะนำเด่น** | reco 1-2 ใบ priority สูงสุด (รวมการ์ด 9.9) | `v_marketing_reco` |
| **ลูกค้า** | champion/loyal/new counts | `v_rfm_segment` |
| **ช่องทางเด่น** | ช่องที่ ROAS/ยอดดีสุดเดือนนี้ | `v_channel_perf_roas` |
| **ยอดจากโค้ด** (ถ้ามี) | ยอด attribute จากโค้ดล่าสุด | `v_promo_attribution_summary` |

> **ทำ action เดียว `getDashboard()`** รวม query พวกนี้ (Promise.all) คืน object ก้อนเดียว — ลด round-trip · ทุกอย่างมี view อยู่แล้ว ไม่ต้องสร้าง DB ใหม่

### 1.3 Component ที่ต้องเพิ่ม
- **`StatCard`** (ใหม่, `components/ui/StatCard.tsx`): label + ตัวเลขใหญ่ (hero = `text-primary-700`) + เทียบ/หน่วยเล็ก + icon optional + สถานะสี (ปกติ/เตือน). ใช้ทั้ง KPI + action-needed
- **`ActionNeededCard`**: variant เตือน (amber/red border) คลิกได้ → route
- ที่เหลือใช้ของเดิม (Badge/Button/Card inline/EmptyState/Skeleton)

### 1.4 Empty/loading
- loading: skeleton ของ KPI row + sections (`loading.tsx`)
- empty (ข้อมูลน้อย): KPI แสดง 0/— ปกติ · "ต้องจัดการ" ซ่อนถ้าไม่มี · reco แสดง "ยังไม่มีคำแนะนำ"

---

## 2. Brand expression (เล็ก แต่ impact สูง — ในกรอบ theme เดิม)

### 2.1 โลโก้ใน header (⭐ touch แบรนด์ที่คุ้มสุด)
ตอนนี้ header/drawer แสดงคำว่า **"OMS" ตัวอักษร** (`text-primary-700`) — จืด · แทนด้วย **โลโก้ 3J จริง** (วง enso + ประกายดาว + wordmark)
- ต้องการ **ไฟล์โลโก้ SVG** (พื้นโปร่ง) — เจ้าของส่งมา หรือ vectorize จาก PNG
- desktop sidebar/ mobile header: โลโก้ mark + "3J OMS" · drawer: mark + wordmark
- ขนาด ~28–32px สูง, ระยะ padding เท่าเดิม (ไม่ขยับ layout grid ตาม spec §4)

### 2.2 Dashboard header treatment (พรีเมียมแบบเบา)
- แถบ header ของ dashboard: greeting + วันที่ + โลโก้เล็ก · อาจมี **เส้น accent บาง primary-600** ด้านบน หรือลาย enso จางๆ เป็น decorative (โปร่ง ไม่รก)
- KPI hero value ใช้ `text-primary-700` (ตรงกับ spec §2 "KPI hero value")

### 2.3 อยู่ในกรอบ (ไม่ over-brand)
- **ไม่**ทำปุ่ม/badge แดงเพิ่มเกินกฎ spec · **ไม่**ใส่สีแบรนด์ทุก card (table header คง neutral ตาม spec §3.7) · แบรนด์เด่นที่ = โลโก้ + KPI hero + nav-active ที่มีอยู่แล้ว

---

## 3. จัดลำดับ (impact / effort / risk)

| # | งาน | impact | effort | risk |
|---|---|---|---|---|
| P0 | **หน้า Dashboard** (route ใหม่ + getDashboard + StatCard) | สูงมาก | กลาง | ต่ำ (ไม่แตะหน้าเดิม) |
| P0 | **โลโก้ใน header** | สูง (brand presence) | ต่ำ | ต่ำ (แค่ต้องได้ไฟล์ SVG) |
| P1 | Dashboard header treatment (accent/enso touch) | กลาง | ต่ำ | ต่ำ |
| P2 | แก้ nav highlight bug (/stock ซ้อน) + จัด nav (20 เมนูเริ่มยาว) | กลาง | ต่ำ-กลาง | ต่ำ |

---

## 4. เจ้าของต้องเคาะ

1. **ไฟล์โลโก้** — มี SVG/PNG ความละเอียดสูง พื้นโปร่งไหม? (ต้องใช้ฝัง header + dashboard) · ถ้าไม่มี ผมให้ vectorize จาก PNG ที่ส่งมาได้ (อาจไม่คมเท่า original)
2. **Landing** — เพิ่ม `/dashboard` เป็นเมนูแยก (แนะนำ ปลอดภัย) หรืออยากให้เปิดแอปมาเจอ dashboard เลย (redirect `/` → dashboard)?
3. **staff เห็น dashboard ไหม** — ซ่อน KPI เงิน/กำไรจาก staff (เห็นแค่ ต้องจัดการ/สต็อก) หรือ owner/admin เท่านั้น?

## 5. ไม่ทำ (กัน scope creep)
- ไม่ re-palette / ไม่แก้ theme token (v1 เสร็จแล้ว) · ไม่ยกเครื่อง component เดิม · ไม่เพิ่ม dark mode · ไม่แตะ layout grid ของ shell

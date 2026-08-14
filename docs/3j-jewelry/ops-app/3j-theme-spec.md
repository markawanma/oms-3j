# 3J OMS — Theme Pass Spec (v1)

> Scope: **theme pass เท่านั้น** — เปลี่ยน token/สี/treatment ผ่าน shared config ไม่แตะ layout/component structure
> Owner: ux-ui (Padmé) · ส่งให้ frontend-dev implement · อ้างอิง `docs/3j-jewelry/design-system/01_3J_Brand_DNA.md`

---

## 0. สรุปการตัดสินใจหลัก (อ่านก่อน)

**โจทย์: #A2191D เป็นทั้งสีแบรนด์และมีธรรมชาติเป็น "แดง" ที่ชนกับความหมาย destructive สากล**

ทางที่เลือก: **แยกด้วย 2 กลไกพร้อมกัน ไม่ใช่แค่เฉดสี**

1. **คนละ token คนละ scale** — brand ใช้ token `primary` (custom scale ที่ desaturate/มืดกว่า) ส่วน danger ใช้ Tailwind stock `red-*` (สดกว่า/ส้มกว่าเล็กน้อย) เดิมแอปนี้ตั้ง `primary=indigo` อยู่แล้วเป็น token หลักทุกที่ (ปุ่ม primary, nav active, focus, link) — **เราแค่เปลี่ยนค่า hex ของ `primary` จาก indigo → brand red scale โดยไม่แตะชื่อ token** ผลคือ nav/ปุ่ม/focus ทั้งแอปเปลี่ยนสีอัตโนมัติจาก config เดียว ไม่ต้องไล่แก้ทีละไฟล์
2. **คนละช่วงความสว่างที่อนุญาตให้ใช้** — กฎ hard rule: brand (`primary-*`) ใช้ได้เฉพาะโทนเข้ม (600–900) กับโทนอ่อนมาก (50/100 สำหรับพื้นหลัง) เท่านั้น **ห้ามใช้ primary-400/500 เป็นพื้นปุ่ม/badge เด็ดขาด** เพราะโทนกลางของสเกลนี้ (ที่ hue ใกล้แดงบริสุทธิ์) จะเริ่มไปคล้าย danger red-600 ทางสายตา — locking การใช้งานไว้ที่ปลายสเกล (เข้มมาก/อ่อนมาก) ทำให้ 2 สีไม่มาเจอกันกลางทางเลย
3. **Danger ไม่พึ่งสีอย่างเดียว** — destructive action ทุกจุดต้องมี icon (Lucide `Trash2`/`AlertTriangle`) + คำกริยาไทยชัด ("ลบ", "ยกเลิก", "ล้าง") เสมอ ไม่ใช้สีแดงลอยๆ

**Primary button = brand red** (`primary-600` = #A2191D) — ไม่ใช้ indigo ต่อ ไม่ใช้ neutral-dark เพราะ requirement ชัดคือ "อยากเข้าแบรนด์" และแอปมี CTA เดียวต่อหน้าอยู่แล้ว (1 primary action ต่อ screen) ความเสี่ยงเรื่อง "ปุ่มแดง" ถูกกันด้วยกฎข้อ 2–3 ข้างบน

---

## 1. Palette Mapping

### 1.1 `primary` (brand accent) — เปลี่ยนจาก indigo เป็น brand red scale

แทนที่ block `primary` เดิมใน `tailwind.config.ts` ทั้งก้อน (ค่า derive จาก #A2191D, hue ~358°, ลด saturation ในโทนอ่อนเพื่อไม่ให้เป็นแค่ tint ของแดงสด):

```ts
primary: {
  DEFAULT: "#a2191d", // = 600, ล็อกตาม brand DNA เป๊ะ
  50:  "#faf5f5",
  100: "#f4e6e6",
  200: "#ebcbcc",
  300: "#e0a3a5",
  400: "#d67174", // ใช้ได้เฉพาะ decorative (chart bar) ห้ามใช้เป็นพื้นปุ่ม/badge
  500: "#cf3036", // เช่นเดียวกับ 400 — โซนเฝ้าระวัง ใกล้ danger ทางสายตา
  600: "#a2191d", // ← ค่าหลัก: ปุ่ม primary, nav active, focus ring, link
  700: "#801418", // hover/active state ของ 600
  800: "#610f12",
  900: "#470b0d",
},
```

หมายเหตุ: 400/500 ใส่ไว้ให้ scale สมบูรณ์ (เผื่อ chart/gradient) แต่ **ห้ามใช้เป็นพื้นผิว interactive element** (ดูกฎข้อ 0.2)

### 1.2 `brand` token (legacy, ใช้ 2 จุดใน TikTok module)

ไม่ต้องแก้ค่า — #a2191d เท่ากับ `primary.600` อยู่แล้วพอดี (ของเดิมถูก scope ไว้แค่ TikTok accent) ปล่อยไว้เป็น alias ได้ ไม่บังคับ migrate ตอนนี้ (ดู §5 optional cleanup)

### 1.3 Neutrals — เลื่อนจาก `slate` → `zinc`

**ไม่ต้องเพิ่ม token ใหม่ใน config** — `zinc` มีอยู่แล้วใน Tailwind stock palette ให้ทำ **find & replace literal class name** `slate-` → `zinc-` ทั้ง repo (component + app/globals.css) เหตุผลที่เลือก zinc ไม่ใช่ stone: zinc มี undertone เป็นกลาง-เย็นเล็กน้อย ให้ความรู้สึกโลหะ/เงินมากกว่า stone (undertone น้ำตาล/อุ่นเกินไป ขัดกับธีมเงิน 925)

ตัวอย่าง mapping ที่ใช้บ่อยในโค้ดปัจจุบัน (เทียบ shade เดิม 1:1):
| เดิม | ใหม่ |
|---|---|
| `bg-slate-50` (body bg) | `bg-zinc-50` |
| `text-slate-900` (body text) | `text-zinc-900` |
| `border-slate-200` (card/table border) | `border-zinc-200` |
| `text-slate-500/600/700` (secondary text) | `text-zinc-500/600/700` |
| `bg-slate-100` (ghost hover) | `bg-zinc-100` |
| `bg-slate-300` (disabled bg) | `bg-zinc-300` |

### 1.4 Danger / Success / Warning / Info — คงของเดิม (stock Tailwind, ไม่แตะ)

| Semantic | Token/class | เหตุผลที่ไม่เปลี่ยน |
|---|---|---|
| danger | `red-50/100/600/700` (Tailwind stock) | ต้องคนละ hue-feel จาก brand — ของเดิมแยกจาก primary เดิม (indigo) อยู่แล้วโดยธรรมชาติ ตอนนี้ primary ย้ายมาเป็นแดงเอง ก็ยังแยกได้ด้วยกฎ §0.2 (โซนความเข้มคนละช่วง) ไม่จำเป็นต้องเปลี่ยนเฉด red เดิม |
| success | `green-100/800` (Badge), `green-600` (progress) | ใช้งานน้อย ชัดเจนอยู่แล้ว ไม่ชนกับอะไร |
| warning | `amber-100/700/800` | เหมือนกัน |
| info | `blue-100/800`, `cyan-100/800` | เหมือนกัน |

### 1.5 Dark mode

**ไม่มีในสโคป** — ตรวจแล้วแอปไม่มี `dark:` class หรือ `darkMode` config ใดๆ ตอนนี้ ไม่ต้องออกแบบเผื่อรอบนี้ (อย่า over-design)

---

## 2. กฎ Brand vs Danger (สรุปใช้งานจริง)

| สถานการณ์ | ใช้ token ไหน |
|---|---|
| ปุ่ม primary action (บันทึก/ยืนยัน/ค้นหา) | `primary-600` bg, `primary-700` hover |
| Nav active state (side nav, sub-nav tabs) | `primary-100` bg + `primary-700` text |
| Focus ring (ทุก interactive element) | `primary-600` outline |
| Link / underline emphasis | `primary-600` text, `primary-700` hover |
| Heading accent / KPI hero value | `primary-700` text |
| ปุ่ม/action ทำลายข้อมูล (ลบ, ยกเลิกออเดอร์, ล้าง) | `red-600` bg/border + **ต้องมี icon** (Trash2/AlertTriangle/XCircle) + คำกริยาไทยชัด |
| Badge สถานะ "ยกเลิก/มีปัญหา" | `red-100`/`red-800` (Badge tone `red` เดิม ไม่เปลี่ยน) |
| ห้ามทำ | ใช้ `red-*` แทน `primary-*` เพื่อความสวย (เช่น จะได้ "แดงจัดขึ้น") — ต้องผ่าน token `primary` เสมอ เพื่อให้ rebrand ในอนาคตแก้จุดเดียว |
| ห้ามทำ | ใช้ `primary-400/500` เป็นพื้นปุ่ม/badge/solid fill |

---

## 3. Component Treatment

### 3.1 `components/ui/Button.tsx`
- `primary`: `bg-primary-600 text-white hover:bg-primary-700 disabled:bg-zinc-300` (เปลี่ยนแค่ `slate-300`→`zinc-300`, primary-* เปลี่ยนสีอัตโนมัติจาก config §1.1)
- `secondary`: `bg-white text-zinc-700 border border-zinc-300 hover:bg-zinc-50 disabled:text-zinc-400`
- `danger`: **ไม่แตะ** (`bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300`) — คงเดิมตามเจตนา §2
- `ghost`: `bg-transparent text-zinc-600 hover:bg-zinc-100 disabled:text-zinc-300`

### 3.2 `components/ui/Badge.tsx`
- tone `slate` → เปลี่ยน class เป็น `bg-zinc-100 text-zinc-700` (ชื่อ prop คงเดิมว่า `"slate"` ไม่ต้อง rename type เพื่อลด diff เว้นแต่ frontend อยากเก็บให้ตรงชื่อ — ไม่บังคับ)
- tone อื่น (`blue/cyan/amber/indigo/green/red/black/orange`) — คงเดิมทั้งหมด ไม่แตะ
- ไม่ต้องเพิ่ม tone `brand` ใหม่ (ยังไม่มี use case ชัดในหน้าจอปัจจุบัน — ถ้าจะใช้ค่อยเพิ่มตอนมี requirement จริง)

### 3.3 Card (inline pattern ไม่มี Card.tsx แยก)
- Base: `rounded-lg border border-zinc-200 bg-white p-4 shadow-sm` (เปลี่ยนแค่ `slate-200`→`zinc-200`)
- Hover (list item ที่ clickable เช่น OrderListItem, LiveSessionListItem, CustomersPageClient): คงรูปแบบเดิม `hover:border-primary-300` — สีเปลี่ยนอัตโนมัติจาก config, ไม่ต้องแก้ class

### 3.4 Side nav (`DashboardShell.tsx` → `NavList`)
- Active state: `bg-primary-100 text-primary-700` — **ไม่ต้องแก้โค้ด** เปลี่ยนสีอัตโนมัติจาก §1.1
- Inactive: `text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900` (เปลี่ยนแค่ slate→zinc)
- Group label (`หน้าร้าน`/`TikTok Ops`/`CRM`): `text-zinc-400` (เปลี่ยนแค่ slate→zinc)
- Logo "OMS" ในทั้ง header และ drawer: `text-primary-700` — ไม่ต้องแก้โค้ด (auto)

### 3.5 Focus ring (`app/globals.css`)
```css
:focus-visible {
  outline: 2px solid #a2191d; /* was #4f46e5 */
  outline-offset: 2px;
}
```
เหตุผลที่ปลอดภัยใช้ primary แทนได้แม้เป็นสีแดง: focus ring คือ "keyboard navigation indicator" ความหมายสากลไม่ทับกับ destructive (ต่างจากปุ่ม/badge ที่ผู้ใช้ตีความจาก action context) และช่วยตอกย้ำแบรนด์ในทุกจุดที่ interactive

`body` base: `bg-zinc-50 text-zinc-900` (เปลี่ยนแค่ slate→zinc)

### 3.6 Link / text emphasis
ที่ไหนใช้ `text-primary-600/700` สำหรับ link หรือ interactive text อยู่แล้ว (เช่น FilterBar channel chip active, ProductSearchCombobox highlight) — ไม่ต้องแก้ ได้สีใหม่อัตโนมัติ

### 3.7 Table header (เช่น `ChannelPerfTable.tsx`, `CustomerOrderHistory.tsx`)
- คงเป็น neutral ไม่ใส่สี brand (ตาม "มินิมอล" — table header ไม่ต้องเด่น): `text-zinc-500 border-zinc-200` (เปลี่ยนแค่ slate→zinc) **ไม่เพิ่ม accent สีให้ header** เพื่อไม่ over-design

---

## 4. สิ่งที่ห้ามแตะ (กัน scope creep)

- Layout grid / breakpoint ของ `DashboardShell` (sidebar 56 width, header height 16, drawer 72) — คงเดิมทั้งหมด
- Spacing scale (Tailwind default 4px) — ไม่เพิ่ม/ลด
- Radius scale (`sm:6px / md:8px / lg:12px`) — คงเดิม
- Touch target `min-h-11` (44px) — คงเดิม
- โครงหน้า/component structure ทุกหน้า — ไม่ยกเครื่อง ไม่เพิ่ม/ลบ section
- ไม่เพิ่ม dark mode (§1.5)
- ไม่เพิ่ม Card.tsx component ใหม่ (ของเดิมเป็น inline pattern พอสำหรับ scope นี้)

---

## 5. ไฟล์ที่ frontend-dev ต้องแตะ

| ไฟล์ | สิ่งที่แก้ |
|---|---|
| `tailwind.config.ts` | แทนที่ block `primary` ทั้งก้อนตาม §1.1 (เก็บ `brand` เดิมไว้ได้ ไม่ต้องแก้) |
| `app/globals.css` | focus ring hex (§3.5), body bg/text slate→zinc |
| `components/ui/Button.tsx` | slate→zinc ใน `secondary`/`ghost`/primary disabled (§3.1) — primary/danger เปลี่ยนสีอัตโนมัติ ไม่ต้องแก้ hex |
| `components/ui/Badge.tsx` | tone `slate` → zinc class (§3.2) |
| `components/layout/DashboardShell.tsx` | slate→zinc ใน inactive nav/group label/border (§3.4) — active state auto |
| ทุกไฟล์ที่มี `slate-*` (ดูรายการ grep ด้านล่าง) | **global find & replace `slate-` → `zinc-`** — mechanical, ไม่เปลี่ยน logic |

ไฟล์ที่มี `slate-*` (grep ณ วันที่เขียน spec, 60 ไฟล์ 324 จุด — ให้ frontend-dev รัน find/replace ทั้ง repo ใน `components/**` และ `app/**` แทนไล่ทีละไฟล์):
`components/ui/*`, `components/layout/DashboardShell.tsx`, `components/domain/**/*.tsx` (ทั้ง order/stock/live/crm/tiktok module)

ไฟล์ที่ **ไม่ต้องแก้เลย** เพราะใช้ token `primary`/`brand` อยู่แล้ว สีเปลี่ยนอัตโนมัติจาก config เดียว: ทุกจุดที่ grep เจอ `primary-\d`, `text-brand`, `bg-primary`, `border-primary` (ดูรายการใน §3.6) — **นี่คือ payoff ของการทำ theme ผ่าน token ตั้งแต่แรก**

---

## 6. Optional cleanup (ไม่บังคับตอนนี้)

- รวม `brand` token เข้ากับ `primary` (ลบ `brand.DEFAULT`/`brand.ink` เปลี่ยน 2 จุดใน `CopilotCard.tsx`/`SalesKpiRow.tsx` เป็น `text-primary-700`) — ทำได้ทีหลังตอน touch TikTok module รอบหน้า ไม่ block theme pass นี้
- เพิ่ม Badge tone `brand` ถ้ามี use case ใหม่ที่ต้องการ chip สีแบรนด์ (เช่น "Best seller")

---

## 7. จุดที่ต้อง validate กับผู้ใช้จริง / เจ้าของ

- **Primary button แดง** — ยังไม่เคยเทสกับผู้ใช้จริงว่าจะรู้สึกว่า "เป็นปุ่มยืนยัน" ปกติ หรือลังเลเพราะจำสีแดง=อันตรายจากแอปอื่น แนะนำเช็คกับทีม ops ที่ใช้ OMS จริง 2-3 คนหลัง deploy (สังเกตว่ามีใคร hesitate ก่อนกดปุ่ม primary ไหม)
- **primary-400/500 ban rule** — เป็นกฎที่ตั้งจาก color theory ล้วนๆ ยังไม่ได้ contrast-check เทียบ danger จริงบนจอ ถ้า frontend-dev เจอจุดที่ "อยากใช้" 400/500 ให้ถามกลับก่อน อย่าเดาเอง
- **zinc vs stone** — เลือก zinc เพราะ undertone เย็นกว่าเข้ากับธีมเงิน แต่เป็นการตัดสินใจเชิงทฤษฎี ยังไม่เห็นภาพจริงเทียบข้าง #A2191D — แนะนำให้ frontend-dev deploy preview แล้วให้เจ้าของดูจริงก่อน merge เข้า main

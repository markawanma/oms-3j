# Technical design: /ring-builder D1.2 — 7 แบบแหวน · Yoda 18 พ.ย. 69

> ต่อจาก `design-ring-showcase-demo.md` (D1 §1–§8 · D1.1 §9 · มติ §10) และคู่กับ UX `ux-ring-showcase-multi.md` (Padmé 18 พ.ย.) — **ไฟล์นี้ทับข้อที่ขัดกัน** (§0)
> คำสั่งเจ้าของ 18 พ.ย. 69: 6 แบบที่ปั้น 3D แล้ว + ไขว้เดิม = 7 แบบ · 890 บาททุกแบบ · เม็ดกลาง = พลอยหลัก ที่เหลือ = พลอยเสริม (4/6 เม็ด = 2 เม็ดกลาง) · ไซซ์แบบใหม่ 50–60 · ไขว้ 55–58 · config ในโค้ด (D2 แยก)
> **ฐาน = origin/main `c03bdbd`** (ราคา 890 merge แล้ว) — branch นี้ยังอยู่ที่ `16df8c3` ต้อง fast-forward ก่อนเริ่ม (ancestor แล้ว ไม่มี conflict)
> ตัวเลข vertex/checksum ใน §2 **รันจริง** จากต้นฉบับด้วย node (18 พ.ย.) · ขนาดพิกเซลพลอยใน §6 = **ประมาณจากสูตรกล้อง ยังไม่ได้วัดบนจอ**

## 0. มติเดิมที่ไฟล์นี้ทับ (แก้คอมเมนต์ในโค้ดตามด้วย)
| เดิม | ใหม่ |
|---|---|
| D1 §5 **X4** "แบบเดียว · builder แบบแถวไม่อยู่ใน bundle" (+ หัว `config.ts`) | 7 แบบ · builder แบบแถวอยู่ใน **chunk lazy ของ RingViewer เท่านั้น** ไม่อยู่ใน first-load (Z9) |
| หัว `gl-renderer.ts` "D1.1 แก้ได้เฉพาะ fragment shader" | เพิ่มได้ **1 เมธอด `setRing()`** + generalize type ring · กล้อง/`matrix.ts`/shader/`bypass-ring.ts` ห้ามแตะเหมือนเดิม |
| D1.1 ชุดพลอยเรียก "แบบ 1/2/3" · LINE `แบบ: X · แบบ n` · ป้าย "พลอยบน (เม็ดหลัก)" | **"ชุด 1/2/3"** · "แบบ" = แบบแหวนอย่างเดียว · ป้าย `พลอยหลัก (ตำแหน่ง)` / `พลอยเสริม (ตำแหน่ง)` · โครง LINE ตาม UX §7 (§4 ด้านล่าง) — **ข้อความ/test ที่ shipped เปลี่ยนโดยตั้งใจ** (รอเจ้าของยืนยัน UX §12 ข้อ 3 — ถ้าไม่เห็นด้วย ถอยเป็นคำเดิมได้ที่ config ที่เดียว) |
| D1 X3 / D1.1: ไซซ์เป็นค่าเดียวของหน้า | ไซซ์ต่อแบบ + `effectiveSize` (§5) |

## 1. Design overview
```
URL ?t&i&q&g&c&d&r ─▶ page.tsx readShowcaseParams (r ผิด/ไม่มี = bypass2)
        │
RingShowcaseClient state: designId · intention · recIndex · own · active · size(ดิบ)
        │ derived: design = getShowcaseDesign(designId) · effectiveSize = isShowcaseSize(size, designId) ? size : null
        ├─▶ DesignPicker(DESIGNS)                      [lib/ring-builder/showcase/designs.ts = ข้อมูลฝั่งลูกค้า]
        ├─▶ RingStage(designId, main, secondary, photo?) ──lazy──▶ RingViewer ─▶ getShowcaseRing(id)  [viewer/showcase-rings.ts · cache]
        │                                                         ├ bypass2 → buildBypassRing(BYPASS2)   (ไม่แตะ)
        │                                                         └ อื่น   → buildRowRing(ROW_PRESETS[id]) (พอร์ตใหม่)
        │                                               renderer.setRing(ring) + setTints(designTints(id, main, secondary))
        ├─▶ PlacementNote / GemSetPicker / OwnGemPicker (ป้ายจาก design.positions)
        ├─▶ SizePicker(design.sizes, size, effectiveSize)
        ├─▶ PhotoGallery(SHOWCASE_PHOTOS[id])           ว่าง = การ์ด "ยังไม่มีรูปถ่ายจริง" (UX §5)
        └─▶ OrderSummary/LINE: buildShowcaseLineMessage({designId, choice, size: effectiveSize})
```
- **แยก 2 ชั้นตั้งใจ**: `showcase/designs.ts` = สิ่งที่ลูกค้าเห็น (pure ไม่มีเรขาคณิต) · `viewer/row-presets.ts` = พารามิเตอร์ 3D (ค่าประมาณจากรูป ห้ามถึงข้อความลูกค้า — X6/Z7) · เชื่อมด้วย `ShowcaseDesignId` ตัวเดียว + test ไขว้ว่าจำนวนเม็ด/เม็ดหลักตรงกัน
- พลอยที่เลือก **ไม่ผูกกับแบบ**: `top` = พลอยหลัก · `bottom` = พลอยเสริม (ความหมายเดิมของ `c`/ชุดแนะนำ) → เปลี่ยนแบบแล้ว intention/rec/own คงเดิม

## 2. พอร์ต `buildRowRing` (ข้อ 1)
**ใหม่ `lib/ring-builder/viewer/row-ring.ts`** — พอร์ต `ROW_DEFAULTS` + `buildRowRing` (บรรทัด ~388–1015 ของ `trinity-ring-preview.html`) แบบเดียวกับ `bypass-ring.ts`: **ตรงตัว ห้าม refactor คณิตศาสตร์** · คงทุก branch แม้ preset ไม่ใช้ (`shared_bead`) — เทียบต้นฉบับด้วยตาได้ง่ายกว่าตัดทีละ branch (แลกโค้ดตาย ~30 บรรทัด)
- ตัด: `notes[]` · `info` (น้ำหนัก/ความหนา/หมายเหตุช่าง — X6) · คืน `{metal, gems, frame, vertexCount}` โดย `frame = computeCameraFrame(gems, {innerDiaMm, stoneMm, girdleRadiusMm: Rg})` (import จาก `bypass-ring.ts` — สูตรเดียวกับ `rebuild()` ของต้นฉบับ ตรวจแล้ว)
- **🔴 setting ที่ preset ใช้จริง ≠ ที่ brief เขียน**: TRINITY=`prong4` · **ก้นหอย 6 = `shared_prong`** (+ `gallery:"scroll"` `shoulder:"scroll_relief"` `support:"block"` + panel) · ฝังล็อค 4/6=`channel` · เตย 7=`bar_prong`+`wedge` · แถวเล็ก 7=`window_head`+`taper` · `shared_bead` ไม่มี preset ใช้
- **ใหม่ `viewer/row-presets.ts`**: `ROW_PRESETS: Record<RowDesignId, RowParams>` ลอก 6 ก้อน (TRINITY SCROLL6 CHANNEL4 CHANNEL6 BAR7 SMALL7) ค่าตรงตัว · ตัดคอมเมนต์น้ำหนักทิ้ง
- **ใหม่ `viewer/ring-types.ts`**: `ViewerRing {metal, gems: RingGem[], frame, vertexCount}` — `BypassRing` เข้ากันได้เชิงโครงสร้าง (ไม่ต้องแก้ `bypass-ring.ts`)
- **ใหม่ `viewer/showcase-rings.ts`**: `getShowcaseRing(id)` + `mainIndexes(n)` + cache `Map` ราย id (7 วง ≈ 2–3 MB) — ไฟล์เดียวที่ import `row-ring`
- **🔴 ต้นฉบับไม่อยู่บน main** — อยู่ใน worktree `agent-a1a2aae2f447f9562` (ไม่ได้ merge) · TL commit `docs/3j-jewelry/cad/trinity-ring-preview.html` + spec 6 ไฟล์ (`trinity- scroll6- channel4- channel6- bar7- small7-ring-spec.md`) เข้า branch นี้ก่อน P1 (docs ไม่ถูกเสิร์ฟ · `bypass-ring.ts` ก็อ้างไฟล์นี้อยู่แล้วแต่ไฟล์ไม่มีใน repo)

**Golden (รันจากต้นฉบับ 18 พ.ย. — ใส่ตรงใน `row-ring.test.ts`)** · `posChk = Σ metal.pos[i]·((i%97)+1)` ทศนิยม 3 · `idxSum = Σ metal.idx`

| id | setting | เม็ด | metal V | metal idx | total V | posChk | idxSum | x เม็ดกลาง (มม.) |
|---|---|---|---|---|---|---|---|---|
| trinity | prong4 | 3 | 7,488 | 44,256 | 8,352 | 414746.250 | 163474320 | 0 |
| scroll6 | shared_prong | 6 | 14,028 | 79,752 | 15,756 | 3100249.738 | 540473604 | ±1.65 |
| channel4 | channel | 4 | 8,792 | 52,284 | 9,944 | 177311.061 | 230583280 | ±1.30 |
| channel6 | channel | 6 | 8,792 | 52,284 | 10,520 | 169289.754 | 230583280 | ±1.07 |
| bar7 | bar_prong | 7 | 8,476 | 47,280 | 10,492 | 713050.048 | 188699952 | 0 |
| small7 | window_head | 7 | 9,786 | 51,696 | 11,802 | 1466293.708 | 230753244 | 0 |

- **Vertex budget**: สูงสุด 15,756 (ก้นหอย) ≪ 60k · test บังคับ `total < 60000` **และ** `metal V < 65536` (idx เป็น `Uint16Array` + `UNSIGNED_SHORT` — เกินแล้ว wrap เงียบ ภาพพังไม่มี error) · build 11–32 ms บนเครื่อง dev
- gems เรียงซ้าย→ขวา (x เพิ่ม) · `mainIndexes(n)`: คี่ = `[(n−1)/2]` · คู่ = `[n/2−1, n/2]` · test ยืนยันว่าคือเม็ดที่ |x| น้อยสุดจริง (ก้นหอย 6 x สมมาตร ±1.65 → เรขาคณิตรองรับ 2 เม็ดกลาง แต่**รอเจ้าของยืนยัน** UX §12 ข้อ 1)
- **Bundle — chunk lazy เดียว (RingViewer + bypass + row) ไม่ lazy รายแบบ**: ทุก preset ใช้ฟังก์ชันเดียวกัน แยกได้แค่ไขว้ vs แถว ประหยัดน้อย (row-ring ~600 บรรทัด ประมาณ 6–10 KB gz — Luke วัดจาก `next build` แล้วจดกลับไฟล์นี้) แต่ต้องมี async loading + chunk ล้มกลางทางทุกครั้งที่สลับ · ผลต่อ UX §6: สลับแบบ = build sync ใน tick เดียว → **state "กำลังโหลดแบบ {ชื่อ}…" + คงเฟรมเก่าจาง ไม่จำเป็น** (ไม่มีช่วงรอให้เห็น) · `stageDesignLoadFailed` + "ลองอีกครั้ง" ยังใช้ — กรณี build/upload throw → fallback §6

## 3. Renderer + viewer
- `gl-renderer.ts`: `createRingRenderer(canvas, ring: ViewerRing, …)` · `ring` เป็น `let` · **`setRing(next)`**: free buffer เดิมทั้งหมด → upload ใหม่ → `tints` ปรับยาวตาม `gems.length` (เติม CZ) → `resetView()` → markDirty · context restored ใช้ ring ปัจจุบัน · throw ภายใน = เรียก `onUnsupported("no_webgl")` เหมือนตอนสร้าง
- ตัดทิ้ง: remount RingViewer ด้วย `key=design` — สร้าง WebGL context ใหม่ทุกครั้งที่สลับ (มือถือจำกัดจำนวน context · กระพริบ · ต้องรอ onReady ใหม่) · `setRing` แลกด้วยการแตะ renderer 1 เมธอด ทดสอบด้วย mock GL ได้ (นับ `deleteBuffer` = 3×(1+เม็ดเดิม))
- `gem-colors.ts`: เพิ่ม `designTints(id, main, secondary)` ยาว = จำนวนเม็ด · bypass2 = `[main, secondary, CZ, CZ]` (**เท่า `ringTints` เดิมเป๊ะ** — test) · แถว = main ที่ `mainIndexes` ที่เหลือ secondary · null = CZ ขาว
- `RingViewer` props เพิ่ม `designId` · effect `[designId]` → `setRing(getShowcaseRing(id))` + setTints · `RingStage` รับ `photo?: ShowcasePhoto` (optional) + `designId`

## 4. URL contract + LINE (ข้อ 2)
| key | whitelist | ไม่มี/ผิด |
|---|---|---|
| **`r`** (ใหม่ · ไม่ใช้ `d` ซ้ำ — `d` = ชุดพลอย) | เป็น string · ยาว ≤ 64 · `SHOWCASE_DESIGN_IDS.includes(raw)` — `bypass2 trinity scroll6 channel4 channel6 bar7 small7` (id คงที่ ไม่ผูกชื่อที่จะเปลี่ยน) | `bypass2` |
- `?r=a&r=b` → Next ให้ array → null → ไขว้ · `constructor`/`__proto__`/HTML/ตัวพิมพ์ใหญ่ → ไขว้ · ไม่ throw
- `buildShowcaseUrl` เขียน `r` **เฉพาะเมื่อไม่ใช่ bypass2** และวาง **ท้ายสุด** → URL ของไขว้ทุกสถานะ = byte เดิม (test URL/href เดิมเขียวโดยไม่แก้) · CTA quiz ไม่เปลี่ยน (ลงไขว้)
- `g t i q c d` ความหมายเดิมทุกตัว · `c` = หลัก.เสริม · `page.tsx` อ่าน 7 key · `?price= ?size= ?design=` ไม่มีผล
- **LINE (โครงตาม UX §7)** — `buildShowcaseLineMessage({designId, choice, size})`:
  ```
  <greeting เดิม>
  แบบแหวน: <design.name>
  พลอย: ชุด n | เลือกพลอยเอง | CZ ขาว (ยังไม่ได้เลือกพลอยสี)
  พลอยหลัก (<pos.main>): X · พลอยเสริม (<pos.sub>): Y [· CZ เล็ก n เม็ด — เฉพาะ design.extraCz > 0]
  ไซซ์: เบอร์ n | ไซซ์: รอแอดมินช่วยเช็ก
  ราคา 890 บาท (พรีออเดอร์ ทำภายใน 21 วัน)
  <closing เดิม>
  ```
  - `designId` นอก whitelist = **null** (ฝั่ง LINE ไม่ fallback — ต่างจาก parser โดยตั้งใจ: ข้อความผิดแบบแย่กว่าไม่มีข้อความ) · ไซซ์ไม่ใช่ null และไม่อยู่ใน `design.sizes` = null
  - ชื่อ/ตำแหน่ง/จำนวน CZ มาจาก `designs.ts` เท่านั้น · Y7 ขยาย: "ชุด n" ห้ามโผล่ตอนเลือกเอง และกลับกัน

## 5. ไซซ์ต่อแบบ (ข้อ 4) — รับ UX §4 effectiveSize
- `designs.ts`: `sizes` ต่อแบบ (ไขว้ 55..58 · ใหม่ 50..60) · `sizeRange(id)` คำนวณจาก list · **ลบ global `SHOWCASE_SIZES` `SHOWCASE_SIZE_RANGE` `SHOWCASE_DESIGN_NAME` `SHOWCASE_OVAL_MM`** ให้ typecheck ไล่ทุกจุดใช้ (ตัดทิ้ง: เก็บเป็น alias ของไขว้ — เสี่ยงมีจุดลืมใช้ช่วงไขว้กับแบบใหม่เงียบๆ)
- `isShowcaseSize(size, id)` = integer อยู่ใน `sizes` ของแบบนั้น
- state เก็บ `size` ดิบ · **`effectiveSize` คำนวณใน render ที่เดียว** แล้วส่งให้ SizePicker (ปุ่ม checked) · OrderSummary · LINE — **ห้ามส่ง size ดิบเข้า OrderSummary/line-message** (Z2 ชั้น 1) · line-message ตรวจซ้ำตามแบบ (ชั้น 2)
- กลับไปแบบที่ไซซ์ใช้ได้ → effectiveSize กลับมาเอง · กดไซซ์ใหม่ = ทับ · size ดิบไม่ถูกเขียนลง URL (เหมือนเดิม)
- ผลวัดล่าสุด: `fitsDesignRange(last, sizeRange(designId))` ราย render · นอกช่วง = ข้อความเดิม "ทักแอดมินได้" (pre-order ทาง LINE ตามที่เจ้าของบอก — ไม่มี flow ใหม่)

## 6. รูปจริง + พลอยเม็ดเล็ก (ข้อ 5–6)
- `_assets/index.ts`: `SHOWCASE_PHOTOS: Record<ShowcaseDesignId, readonly ShowcasePhoto[]>` · ไขว้ = 5 รูปเดิม · อีก 6 = ว่าง + คอมเมนต์ `TODO_OWNER_PHOTOS` · static import เท่านั้น ห้าม `public/`
- RingStage: photo = รูปแรกของแบบนั้น (อาจไม่มี) · ไม่มีรูป → ทุก state ไม่มี img: loading = พื้นไล่สี + pictogram จาง · unsupported/lost = pictogram + ป้าย "ภาพประกอบตำแหน่งเม็ด ไม่ใช่ภาพจริง" + `stageNo3dNoPhoto` (UX §5) · **ห้ามรูปแบบอื่นแทน** (Z6)
- **pictogram ไม่ต้องมี `points` เขียนมือ**: สร้างจาก `design.layout` — แถว = n จุดเรียงโค้ง เม็ดที่ `mainIndexes` ทึบ ที่เหลือกลวง · ไขว้ = 2 จุดเยื้อง (บนทึบ ล่างกลวง) + จุดเล็กตาม `extraCz` · ไม่ import `row-presets` · ยังต้องให้เจ้าของ/Sabé ดูก่อนขึ้น (UX §13)
- ขนาดพลอย มม. **ไม่แสดงลูกค้าทุกแบบใหม่** (ค่าประมาณจากรูป — เจ้าของให้แค่แถวเล็ก ~1.5 มม.)
- แถวเล็ก 7 (1.5 มม.): span เฟรม ≈ 22 มม. → stage มือถือ ~267–320 px พลอย ≈ **15–20 CSS px** (ประมาณ) — เห็นเป็นจุดสี แต่ประกาย/เหลี่ยมแยกไม่ออก · **ไม่แก้กล้องใน D1.2** (เจ้าของสั่งเฟรมทั้งวง 11 พ.ย. · `matrix.ts` ห้ามแตะ) · สียืนยันจาก swatch + การ์ดสรุป · QA วัด: จับภาพ 375×667 มุมหน้า เม็ดเล็กสุด hue ±15° จาก `colors.base` (เกณฑ์ §9.4ง เดิม) · ไม่ผ่าน → ทางเลือกให้ TL/เจ้าของตัด: `initialZoom` ต่อแบบใน renderer options (ไม่แตะ matrix.ts)

## 7. Type ShowcaseDesign (`lib/ring-builder/showcase/designs.ts` — ตอบ UX §9)
| field | type | ค่า / หมายเหตุ |
|---|---|---|
| `id` | `ShowcaseDesignId` = union จาก `SHOWCASE_DESIGN_IDS` (as const · ลำดับ = ลำดับ chip — UX §12 ข้อ 2) | bypass2 trinity scroll6 channel4 channel6 bar7 small7 |
| `name` | string | `TODO_OWNER_DESIGN_NAME` — ชื่อชั่วคราวตามเจ้าของ |
| `layout` | bypass หรือ row + stoneCount 3/4/6/7 | test ไขว้กับ `ROW_PRESETS[id].stoneCount` |
| `mainCount` | 1 หรือ 2 | test: เท่ากับจำนวน `mainIndexes(stoneCount)` (bypass = 1) |
| `positions` | main + sub (string) | เม็ดบน/เม็ดล่าง · เม็ดกลาง/เม็ดข้าง · เม็ดกลาง 2 เม็ด/เม็ดข้าง |
| `extraCz` | number | ไขว้ 2 · แบบใหม่ 0 จนกว่าเจ้าของบอก (UX §12 ข้อ 4) |
| `sizes` | readonly number[] | ต่อเนื่อง · ในช่วงร้าน 45–68 (test) |

**ไม่มีช่องราคา / lead days / มม. — ตั้งใจ** (Z3 · Z7) · lead days ต่อแบบเพิ่มเมื่อเจ้าของตอบว่าต่างกันเท่านั้น · `photos` อยู่ฝั่ง app (`_assets`) ไม่อยู่ใน lib (lib pure ไม่ import รูป)

## 8. Contract ที่ UX/Luke ต้องเคารพ (ข้อ 3)
1. state จริง = `designId` + ของเดิม · เปลี่ยนแบบไม่ล้าง พลอย/โหมด/เรื่อง/size ดิบ
2. ข้อความที่ขึ้นกับแบบ (ชื่อ · ตำแหน่ง · CZ · aria canvas · alt · placementNote · czNote · ownBothSame "ทุกเม็ด") มาจาก `designs.ts` + SHOWCASE_COPY เท่านั้น — ห้ามพิมพ์ "บน/ล่าง" "ทั้ง 2 เม็ด" "CZ เล็ก 2 เม็ด" ตายตัวในคอมโพเนนต์
3. ราคาผ่าน `formatPriceThb()` ตัวเดียว · ไม่มีราคาต่อแบบ/ต่อเม็ด · pageDescription/metadata ไม่มีเลขราคา · ไม่มี "เพชร" · ลิงก์ออกได้แค่ `lineOaMessageUrl` + `/ring-size` + `/gem-quiz`
4. ตัวเลือกแบบห้ามใช้รูปถ่ายเป็น thumbnail (มีรูปแค่ไขว้) · pictogram/ชิปข้อความเท่านั้น
5. stage sticky ≤ 40dvh เดิม · DesignPicker อยู่นอก stage
6. ทุกจุดที่แสดง/ส่งไซซ์ใช้ effectiveSize
7. ชื่อแบบเป็น `TODO_OWNER_DESIGN_NAME` — UI ต้องรับชื่อจริงที่ยาวขึ้นได้

## 9. ไฟล์
**ใหม่**: `lib/ring-builder/showcase/designs.ts` (+test) · `lib/ring-builder/viewer/row-ring.ts` (+test golden) · `viewer/row-presets.ts` · `viewer/ring-types.ts` · `viewer/showcase-rings.ts` (+test) · `_components/DesignPicker.tsx` · `DesignPictogram.tsx` · `PlacementNote.tsx`
**แก้**: `showcase/config.ts` (ย้ายชื่อ/ไซซ์/oval ออก · copy ใหม่ UX §7 · คอมเมนต์ X4) · `quiz-link.ts` (r) · `line-message.ts` · `viewer/gl-renderer.ts` (setRing + type) · `viewer/gem-colors.ts` · `page.tsx` · `RingShowcaseClient.tsx` · RingStage RingViewer GemSetPicker OwnGemPicker SizePicker OrderSummary PhotoGallery · `_assets/index.ts` · tests คู่ (รวม d11/qa11 ที่มีสตริง "แบบ n") · `READING-LISTS.md`
**ไม่แตะ**: `bypass-ring.ts` · `matrix.ts` · `shaders.ts` · `lib/gem-quiz/*` · `ResultScreen.tsx` · middleware/`exempt-path.ts` · `public/`

## 10. Phase (Luke ทีละก้อน · P1/P2 pure ขนานได้ถ้าแยก worktree)
| # | ก้อน | เสร็จเมื่อ |
|---|---|---|
| P0 | TL: fast-forward ไป c03bdbd · commit ต้นฉบับ CAD (§2) · ส่งคำถามเจ้าของ §14 | — |
| P1 | row-ring + row-presets + ring-types + showcase-rings | golden §2 ตรงทุกค่า · budget · mesh ไม่มี NaN/idx หลุด · mainIndexes |
| P2 | designs.ts + r + line-message ใหม่ + isShowcaseSize(size,id) + designTints | ห้ามผ่าน §11 ฝั่ง pure ครบ · URL ไขว้ byte เดิม |
| P3 | setRing + RingViewer/RingStage รับ design + photo optional | mock-GL test · เปิดจริงสลับ 7 แบบไม่ค้าง |
| P4 | UI ตาม UX (DesignPicker · PlacementNote · ชุด n · SizePicker · Photo empty · copy) | RTL ทุกแบบ |
| P5 | next build จด chunk size · QA | §12 |

## 11. ห้ามผ่าน / ต้องไม่พัง
| # | ห้ามผ่าน | ตกที่ |
|---|---|---|
| Z1 | `r` นอก whitelist / ยาว > 64 / array (key ซ้ำ) / `__proto__` / HTML / ตัวพิมพ์ใหญ่ | `parseDesignIdParam` → null → bypass2 · ไม่ throw (unit) |
| Z2 | ไซซ์นอกช่วงของแบบไปถึง LINE (เลือก 50 บน trinity แล้วสลับเป็นไขว้ · 49/61/57.5/NaN) | ชั้น 1 effectiveSize (RTL: สลับแบบแล้วข้อความ LINE ต้องเป็น "รอแอดมินช่วยเช็ก") · ชั้น 2 line-message คืน null (unit วน 7 แบบ × 45–68 + ค่าแปลก) |
| Z3 | ราคาอื่นนอก 890 / ราคาต่อเม็ด ที่ใดก็ตาม | designs.ts ไม่มีช่องราคา (type) · test วน 7 แบบ × ทุก choice × ทุกไซซ์: ข้อความ LINE + DOM สรุป จับ regex ตัวเลขตามด้วย "บาท" ได้ค่าเดียว `890 บาท` |
| Z4 | "เพชร" / สรรพคุณแต่งใหม่ / ลิงก์ออกนอก LINE @3jjewelry | copy-guard เดิมขยายครอบ designs.ts + DOM ทุกแบบ · href ใน DOM ได้แค่ lineOaMessageUrl, /ring-size, /gem-quiz |
| Z5 | designId นอก whitelist ใน line-message | คืน null (ไม่ fallback) |
| Z6 | รูปแบบไขว้โผล่ใต้แบบอื่น (stage ทุก state + gallery) | RTL วน 6 แบบ × (checking/unsupported/lost) ตรวจว่าไม่มี src ของ bypass2 |
| Z7 | ค่าประมาณจากรูป (มม./น้ำหนัก/spec) ถึงลูกค้า | row-presets ถูก import ได้จาก showcase-rings เท่านั้น (test import graph) · ไม่พอร์ต info/notes/buildSpec |
| Z8 | metal V ≥ 65536 หรือ total ≥ 60k | row-ring.test.ts |
| Z9 | row-ring เข้า first-load bundle / "use server" เข้า graph | test import graph (static import ของ row-ring/showcase-rings มีได้แค่ RingViewer.tsx) + no-server-action-graph.test.ts เดิม |
| Z10 | "บน/ล่าง" กับแบบแถว · "ทั้ง 2 เม็ด" กับแบบ ≠ ไขว้ · "ชุด n" ตอนเลือกเอง | RTL + unit line-message วนทุกแบบ |

**ต้องไม่พัง**: ลิงก์ D1 `?g=` และ D1.1 `?t&i&q&c&d` ทุกแบบ → เปิดแบบไขว้ + ชุดพลอย/โหมด/เรื่องเดิม (ข้อความเปลี่ยนเฉพาะคำ "แบบ n"→"ชุด n" และโครง LINE ตาม §0 — นอกนั้นเท่าเดิม) · buildShowcaseUrl ของไขว้ byte เดิม · `ringTints` = `designTints("bypass2")` · golden เดิมของ bypass-ring.test.ts ไม่ขยับ · X1–X3 X5–X8 · Y1–Y6 · header exact path (exempt-path.ring-builder.test.ts diff 0) · ไม่มี "use server" ใน (quiz) · รูป static import · WebGL ไม่มี/lost/shader V2 ล้ม ทุกแบบ · localStorage บล็อก · reduced-motion · reload/แชร์/กลับจาก /ring-size ได้แบบเดิม (ไซซ์รีเซ็ตเหมือนเดิม)

## 12. QA scope: **M** (+ security ดูเร็ว)
หน้าสาธารณะ ไม่เขียน DB ราคาคงที่ · flow ที่ผูก = /ring-builder + CTA quiz (ไม่แก้) · QA: 7 แบบ × (rec/own/direct) × ไซซ์ขอบ 50/55/58/60 + สลับแบบให้ไซซ์หลุดช่วงแล้วกลับ · ลิงก์เก่า 5 รูปแบบ · มือถือจริง: ลากหมุนทุกแบบ ≥ 50 fps `[ต้องยืนยัน: รุ่นเครื่อง]` · กดปุ่ม LINE จริง ไขว้ + แบบใหม่ 1 แบบ · วัดสีเม็ดเล็ก §6 · security: parser r + import graph (Z7/Z9)

## 13. ความเสี่ยง
- พอร์ต 600 บรรทัดผิดจุดเดียว = รูปทรงเพี้ยนเงียบ → golden §2 คือด่านหลัก (**ห้ามแก้ golden ให้ตรงโค้ด** — ต่าง = กลับไปเทียบต้นฉบับ)
- ต้นฉบับอยู่ใน worktree ที่ยังไม่ merge — หายแล้วตรวจย้อนไม่ได้ (P0)
- เปลี่ยน "แบบ n"→"ชุด n" แตะ test ที่ shipped หลายไฟล์ — ต้องแก้ทีละสตริง ห้ามลบ test ทิ้ง · ถ้าเจ้าของไม่เห็นด้วยต้องถอยทั้งชุด
- 3D 6 แบบยังไม่เคยรันใน stack นี้ (ต้นฉบับรันในหน้า html เดี่ยว) · ก้นหอย metal idx 79,752 ใหญ่สุด — มือถือรุ่นล่างอาจหน่วงตอนสลับครั้งแรก (dev ~30 ms → อาจ 100+ ms)
- ชื่อ/รูป/ความพร้อมพลอยเม็ดเล็ก/ก้นหอยเม็ดกลาง = ค่าเจ้าของ ยังไม่ยืนยัน (§14)

## 14. คำถามเจ้าของ (รวมของ UX §12 ไม่ซ้ำ · ห้ามเดา — ใส่ TODO_OWNER_* / [ต้องยืนยัน] จนกว่าจะตอบ)
1. ชื่อจริง 6 แบบ — ขึ้น production ด้วยชื่อชั่วคราวได้ไหม (`TODO_OWNER_DESIGN_NAME`)
2. รูปถ่ายจริง 6 แบบ — ระหว่างรอ ให้แบบที่ไม่มีรูปขึ้นไปก่อน (เห็นแค่ภาพจำลอง 3D) ได้ไหม (`TODO_OWNER_PHOTOS`)
3. ก้นหอย 6 เม็ด: ใช้กฎ 2 เม็ดกลางเหมือนฝังล็อคไหม (UX §12-1)
4. พลอยเสริมเม็ดเล็ก ~1.5–3 มม. มีครบ 5 ชนิดทุกแบบไหม (โดยเฉพาะแถวเล็ก 7 ที่ 1.5 มม.) · 890 บาทรวมพลอยสีทุกเม็ดจริง · พลอยสีเป็นวัสดุอะไร (UX §12-5)
5. แบบใหม่มี CZ เล็กติดมาไหม (UX §12-4) · 21 วันและไซซ์ 50–60 ใช้กับทุกแบบใหม่เหมือนกันไหม (UX §12-7)
6. เรียกชุดพลอยว่า "ชุด 1/2/3" ได้ไหม (UX §12-3) · ลำดับ 7 แบบ · h1 ใหม่ (UX §12-2, 8)
7. (ไม่บล็อก) จบ quiz ยังลงแบบไขว้เป็นค่าเริ่มต้น — เสนอ: คงไว้

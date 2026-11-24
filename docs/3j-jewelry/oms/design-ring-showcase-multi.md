# Technical design: /ring-builder D1.2 — 7 แบบแหวน · Yoda 18 พ.ย. 69

> **D1.3 (24 พ.ย. 69) — แบบที่ 8 เม็ดเดี่ยว 790 บาท + ราคาต่อแบบ: ดู §15 ท้ายไฟล์ · §15 ทับ §7 (ไม่มีช่องราคา) · §8-3 · Z3 ใน §11**
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


---

## 15. D1.3 แบบเม็ดเดี่ยว + ราคาต่อแบบ (24 พ.ย. 69 · Yoda)

> คำสั่งเจ้าของ 24 พ.ย. 69 (คำต่อคำ): "ผ่าน ราคา 790 วงนี้จะถูกกว่า เอาขึ้นได้เลย ตัดคำว่า 890 ทุกวงออก"
> = แหวนเม็ดเดี่ยว 6 เตย (v4 · `cad/solitaire-ring-spec.md`) เป็น **แบบที่ 8 ราคา 790 บาท** · 7 แบบเดิม **890 บาท** · ข้อความ "890 บาท ทุกแบบ" หายจากทุกที่
> ฐาน: branch `feature/showcase-solitaire` (main + spec เม็ดเดี่ยว `c6d0453`)

### 15.0 มติที่ §15 ทับ
| เดิม | ใหม่ |
|---|---|
| §7 / หัว `designs.ts` "ไม่มีช่องราคา · ราคาอยู่ config ค่าเดียว" · §8-3 "ไม่มีราคาต่อแบบ" | ราคา **ต่อแบบ** · ยังอยู่ `config.ts` ที่เดียว (§15.1) · `designs.ts` ยังไม่มีช่องราคา |
| Z3 "ราคาอื่นนอก 890" | Z3-ใหม่ (§15.6): แต่ละแบบเห็นราคาของตัวเองค่าเดียว |
| หัวหน้า `priceAllDesigns` "890 บาท ทุกแบบ" | ราคาของแบบที่เลือกอยู่ (§15.2) |
| `layout.kind: "row"` มี stoneCount 3/4/6/7 | เพิ่ม `stoneCount: 1` (เม็ดเดี่ยว) + predicate `isSingleStone(d)` (§15.3) |

### 15.1 ราคาต่อแบบ — แหล่งเดียว
- `lib/ring-builder/showcase/config.ts`: **ลบ `SHOWCASE_PRICE_THB`** (import เดิมทุกตัว compile ไม่ผ่าน = ไม่มีจุดไหนหลุดไปใช้ 890 เงียบๆ) แทนด้วย
  ```ts
  export const SHOWCASE_PRICE_THB_BY_DESIGN: Readonly<Record<ShowcaseDesignId, number>> = {
    bypass2: 890, trinity: 890, scroll6: 890, channel4: 890, channel6: 890, bar7: 890, small7: 890,
    solitaire: 790, // เจ้าของ 24 พ.ย. 69
  };
  export function showcasePriceThb(id: ShowcaseDesignId): number   // id นอก whitelist = throw (ผู้เรียกส่ง id ที่ผ่านด่านแล้วเสมอ)
  export function formatPriceThb(id: ShowcaseDesignId): string     // "790 บาท" — arg บังคับ ไม่มี default
  ```
- **ทำไม map ใน config ไม่ใช่ `priceThb` ใน DESIGNS**: (1) `Record<ShowcaseDesignId, number>` บังคับครบทุก id ตอน compile — เพิ่มแบบที่ 9 แล้วลืมราคา = build ไม่ผ่าน (2) คงการแบ่งชั้นเดิม: config = ค่าเงิน/เวลาที่เจ้าของสั่ง · designs = รูปร่างแบบ (3) แก้ราคาแบบเดียว = diff 1 บรรทัด ไฟล์เดียว · **ตัดทิ้ง**: `priceThb` ใน DESIGNS (ต้องแก้ `rowDesign()` + ทำลายการแบ่งชั้น) · `formatPriceThb(id?)` มี default (ลืมส่ง id ได้ 890 เงียบๆ = บั๊กที่กำลังกัน)
- ลบ `SHOWCASE_COPY.priceAllDesigns` ทิ้ง (ไม่ใช่แค่เลิกใช้)
- `designAnnounce` ต่อราคาท้าย: "เลือกแบบ {name} แล้ว · {price}" (screen reader รู้ว่าราคาเปลี่ยน)

### 15.2 ราคาโผล่ที่ไหน (ครบจาก grep `formatPriceThb|priceAllDesigns|890` 24 พ.ย.)
| จุด | ไฟล์ | ใหม่ |
|---|---|---|
| หัวหน้า | `RingShowcaseClient.tsx:248` | `formatPriceThb(designId)` + " · พรีออเดอร์…" เปลี่ยนตามแบบที่เลือก |
| การ์ดเลือกแบบ | `_components/DesignPicker.tsx` | **แสดงราคาใต้ชื่อสั้นทุกใบ** (ราคาไม่เท่ากันแล้ว ลูกค้าต้องเห็นก่อนกด) · chip สูง 72→~88px · aria-label = ชื่อ + ราคา |
| สรุป | `_components/OrderSummary.tsx:75` | `formatPriceThb(design.id)` |
| LINE | `line-message.ts:99` | `formatPriceThb(design.id)` — design ที่ผ่าน `findShowcaseDesign` แล้วเท่านั้น |
| hub | `lib/tools-hub/config.ts:45` | **ไม่แสดงราคาใดๆ** (มติ TL 24 พ.ย. ทับค่าตั้งต้นเดิม "เริ่มต้น 790") — เหลือ `leadTimeLabel()` อย่างเดียว · ไม่มี `minShowcasePriceThb` · จำนวนแบบนับอัตโนมัติจาก `DESIGNS.length` (8) · หมายเหตุ: ก่อน D1.3 hub มี "890 บาท · พรีออเดอร์…" อยู่ในโค้ดจริง (meta ของการ์ดดูแหวน) — ถูกถอดราคาออกตามมติ |
| คอมเมนต์ "890 ทุกแบบ" | หัว `config.ts` · `OwnGemPicker.tsx:3` · `ToolsHub.tsx:9` | แก้ให้ตรง (ไม่ใช่ logic แต่คนอ่านต่อจะเชื่อ) |
- `pageDescription`/metadata ยังไม่มีตัวเลขราคา (เดิม) · ไม่พบ OG ที่มีเลขราคา (grep 24 พ.ย.)
- test เดิม 16 ไฟล์มี `890` (41 จุด): เปลี่ยนเป็น `formatPriceThb(id)` · **test เดียวที่ล็อกตัวเลขดิบ** (`config.test.ts`: 7 แบบ = 890 · solitaire = 790) — ค่าเจ้าของถูกล็อกที่เดียว

### 15.3 แบบ 8 เม็ดเดี่ยว — ข้อมูลฝั่งลูกค้า (`designs.ts`)
- id **`solitaire`** (a–z ล้วน ≤ 64 · ผ่าน `parseDesignIdParam` เดิมโดยไม่แก้ parser) · ต่อท้าย `SHOWCASE_DESIGN_IDS` (chip ใบที่ 8 · ลำดับรอเจ้าของ)
- `rowDesign("solitaire", "แหวนเม็ดเดี่ยว 6 เตย", "เม็ดเดี่ยว 6 เตย", 1)` // TODO_OWNER_DESIGN_NAME → `mainCount 1` · `extraCz 0` · `sizes 50–60` · lead days 21 (ค่ากลางเดิม)
- `ShowcaseLayout` row: `stoneCount: 1 | 3 | 4 | 6 | 7` · เพิ่ม `export function isSingleStone(d): boolean` (= row && stoneCount 1)
- **ทำไม row/1 ไม่ใช่ kind ใหม่ `"solitaire"`**: ของที่ทำงานถูกเองทันทีกับ n=1 — `mainIndexes(1)=[0]` · `seedFromPair` · `fitOwnToCount` (7→1 = เม็ดกลาง · 4→1 = เม็ดกลางตัวแรก · 1→7 = ทุกเม็ด · 1↔ไขว้ = [x,x] / [บน]) · `slotTints`/`designTints` · `ownByCount[1]` · `buildShowcaseUrl` · pictogram (มีกิ่ง n===1 อยู่แล้ว) · **kind ใหม่อันตรายกว่า**: ทุกจุดที่เขียน `kind === "row" ? … : <กิ่งไขว้>` จะตกไปกิ่งไขว้เงียบๆ (`gemSlotCount` → 4 เม็ด · `c` รหัสเต็มบน/ล่าง) · ราคาที่จ่าย: ต้อง branch `isSingleStone` ตามรายการข้างล่าง + test คำต้องห้าม (Z13) ครอบจุดที่ลืม
- จุดที่ต้อง branch `isSingleStone` (ครบจาก grep `layout.kind|roleSubLabel|formatOwnSlots`):
  1. `designs.ts` `placementNote()` → คืน `null` → `PlacementNote` ไม่ render
  2. `line-message.ts` `stonesLine()` → "{singleStoneLabel}: {mainLabel}" (ไม่มีพลอยเสริม) · `resolveChoice` ownSlots → `gemsLine = summaryOwn` ("เลือกพลอยเอง" ไม่ใช่ "รายเม็ด · ซ้ายไปขวา")
  3. `own-slots.ts` `formatOwnSlots()` ยาว 1 → `[{ label: singleStoneLabel, value: slotLabel(code) }]` (ไม่มี "เม็ด 1" / "(ทุกเม็ด)" / "CZ ขาวทุกเม็ด") — ใช้ร่วม LINE/สรุป/aria จุดเดียว · แถว ≥3 ไม่เปลี่ยน · ไขว้ไม่ใช้ฟังก์ชันนี้
  4. `OrderSummary.tsx` gemRows · `RingShowcaseClient.tsx` stageAria → 1 แถว/1 วลี `singleStoneLabel`
  5. `OwnGemPicker.tsx` PerGemPicker เมื่อ single: ซ่อน OwnSlotBar · "ใส่ X ทุกเม็ด" · "กลับเป็น CZ ขาวทั้งหมด" · เลิกทำ · `ownPerGemNote` · `ownPerGemOrderHint` → เหลือ radiogroup เดียว 6 ตัวเลือก (5 พลอย + CZ ขาว ที่มีอยู่แล้ว) · `pickSlotGem` ประกาศ `singleStoneAnnounce(name)` แทน `ownFillAllDone`
  6. `GemSetPicker.tsx` เมื่อ single: การ์ดชุด n = พลอยอันดับ n **ไอคอนเดียว ชื่อเดียว** (ไม่ใช่ "top + bottom") · ไม่แสดง `sameAs` · คำอธิบาย = `labelTh` + `keywords` ของพลอยนั้นจาก `GEM_QUIZ_STONE_BY_CODE` (ข้อความเดิมของ quiz คำต่อคำ) — **ไม่ใช้ข้อความคู่พลอย `pair.title/th/fit`** เพราะแหวนมีพลอยเม็ดเดียว อ้างสรรพคุณคู่ = ไม่จริง · ไม่แต่งข้อความใหม่
- copy ใหม่ใน `SHOWCASE_COPY` (ค่าตั้งต้น — Padmé/เจ้าของปรับได้ที่เดียว): `singleStoneLabel: "พลอยเม็ดเดี่ยว"` · `singleStoneAnnounce(name)` = "เปลี่ยนพลอยเป็น{thaiGap(name)}แล้ว"
- **โหมดแนะนำ**: `choice = { kind: "rec", index, top, bottom }` เดิม — `bottom` ถูกละ (3D ใช้ main เพราะ `mainIndexes(1)=[0]` · LINE/สรุปไม่พิมพ์) · ชุด 1/2/3 = พลอยอันดับ 1/2/3 (= `top` ของ `buildShowcaseSets` เดิม) · ไม่มี quiz = `direct` = CZ ขาว (เดิม)
- **โหมดเลือกเอง `c`** = **ตัวอักษรเดียว `[gacpbz]`** (`c=g` · `c=z`) — รูปแบบเดียวกับแบบแถว (N ตัวอักษรคั่น `.` โดย N=1) ไม่ใช่รูปแบบไขว้ (`garnet.cz`) · เหตุผล: ใช้ parser/encoder แถวเดิมทั้งเส้น (`parseOwnSlotsParam` กิ่ง `parts.length === n` · `buildShowcaseUrl` slotsOk) ไม่มี format ที่สาม · สลับแบบแล้วสีส่งต่อด้วย `fitOwnToCount` ได้ทันที
  - 🔴 **ต้องแก้ 1 จุด**: ข้อยกเว้น "ยาว 2 = ลิงก์ preview D1.2 → ขยาย" ใน `parseOwnSlotsParam` ให้ใช้เฉพาะ `n >= 3` — ไม่งั้น `c=g.a&r=solitaire` ถูกรับเป็น `[g]` (ลิงก์แบบนั้นไม่เคยมีจริง = ช่องที่ไม่ได้ตั้งใจเปิด)

### 15.4 3D — `lib/ring-builder/viewer/solitaire-ring.ts` (ใหม่)
- พอร์ต **ตรงตัว** `SOLITAIRE` + `buildSolitaireRing` จาก `docs/3j-jewelry/cad/trinity-ring-preview.html` (บรรทัด ~1056–1230 ณ `c6d0453`) แบบเดียวกับ `row-ring.ts`: `// @ts-nocheck` ภายในเป็น var-style ห้าม refactor · export มี type ชัด (`SolitaireParams` · `SOLITAIRE` · `buildSolitaireRing(p): ViewerRing`) · ค่าคงที่อยู่ไฟล์เดียวกับ builder ตามแบบ `bypass-ring.ts` (BYPASS2)
- ต่างจากต้นฉบับเฉพาะ: ตัด `notes[]`/`info`/`params` ออกจากผลลัพธ์ (ค่าประมาณ/หมายเหตุช่าง ห้ามถึงลูกค้า — Z7) · คืน `{ metal, gems, frame: computeCameraFrame(gems, { innerDiaMm, stoneMm, girdleRadiusMm: Rg }), vertexCount }` = สูตรเดียวกับ `rebuild()` ของต้นฉบับ (`info.girdleRadiusMm` = `Rg`) · gems ยาว 1 รูป `RingGem` เดิม
- `showcase-rings.ts`: `ShowcaseRingId = "bypass2" | RowDesignId | "solitaire"` · `SHOWCASE_RING_IDS` ต่อท้าย `"solitaire"` (test ไขว้ลำดับ = `SHOWCASE_DESIGN_IDS`) · กิ่ง `id === "solitaire" → buildSolitaireRing(SOLITAIRE)` · **ไม่แตะ** `row-ring.ts` `row-presets.ts` `bypass-ring.ts` `matrix.ts` `shaders.ts`
- `gl-renderer.ts` **ไม่ต้องแก้**: `setRing` เติม/ตัด tints ตาม `gems.length` อยู่แล้ว · `designTints("solitaire")` ยาว 1 (row n=1)
- **golden** `solitaire-ring.test.ts`: ตัวเลขสร้างจาก **ต้นฉบับ HTML** ด้วย node (ดึงข้อความฟังก์ชันมารัน) ไม่ใช่จากพอร์ต → gems 1 · metalV · metalIdx · totalV · posChk (สูตร `checksums()` เดิมใน `row-ring.test.ts`) · idxSum · frame span/cy · budget (metal < 65536 · รวม < 60k · spec ประมาณ ~2.7k) · ไม่มี NaN/idx หลุด · deterministic · ไม่ mutate `SOLITAIRE` · 🔴 ห้ามแก้ golden ให้ตรงโค้ด · ระบุ commit/บรรทัดต้นฉบับในหัว test
- import graph: test Z9 เดิม (`row-ring.test.ts` "ไม่เข้า first-load") **เพิ่ม `solitaire-ring` เข้ารายการต้องห้ามของ static graph ของ `page.tsx`** + เคส "solitaire-ring ถูก import จาก showcase-rings.ts ตัวเดียว" — เพิ่มเคส ห้ามผ่อนเคสเดิม

### 15.5 รูปจริง 4 รูป
- ต้นทาง (🔴 อยู่ใน Temp scratchpad — reboot/cleanup แล้วหาย · **คัดลอกเป็นขั้นแรก**): `C:\Users\MARKAW~1\AppData\Local\Temp\claude\ae49ce3ca2ab8796\2b4dbf60-2e9a-494e-9841-64bebed577f3\scratchpad\ring-photos\solitaire\1.jpg..4.jpg` → `app/(quiz)/ring-builder/_assets/solitaire-1..4.jpg` · 900×1200 · ลบ EXIF ด้วยวิธีเดียวกับ 24 ไฟล์ของ `bcc52b3` · **หมุนตาม EXIF Orientation ก่อนลบ** (ไม่งั้นรูปตะแคง) · ไฟล์อื่นในโฟลเดอร์นั้น (sketch / fb-*) **ห้ามเข้า repo**
- `_assets/index.ts`: static import 4 ตัว + `solitaire: [...].map(toPhoto)` (Record บังคับครบ id อยู่แล้ว) · `RingShowcase.photos.test.tsx`: solitaire = 4 รูป · Z6 วน 8 แบบ · เพิ่ม test อ่านไบต์ทุก jpg ใน `_assets` ว่าไม่มี marker `Exif` ใน APP1 (ครอบ 33 ไฟล์ — เดิมไม่มีด่านนี้)

### 15.6 ห้ามผ่าน (ต่อจาก §11 · Z3 ถูกแทนด้วย Z3-ใหม่)
| # | ห้ามผ่าน | ตกที่ |
|---|---|---|
| Z3-ใหม่ | LINE/DOM สรุป/หัวหน้า/chip ของแบบใดมีตัวเลข "…บาท" อื่นนอกราคาแบบนั้น (solitaire เห็น 890 · 7 แบบเห็น 790 · ราคาต่อเม็ด) | unit วน 8 แบบ × (rec 1–3 / own / direct / unpicked) × ไซซ์ null+50–60: regex `/\d[\d,]*\s*บาท/g` ได้ค่าเดียว = `formatPriceThb(id)` · RTL: สลับแบบแล้วหัวหน้า+สรุป+href LINE เปลี่ยนตาม |
| Z11 | `formatPriceThb()` ไม่ส่ง id / `SHOWCASE_PRICE_THB` ยังถูก import | ลบ export → `npm run typecheck` ไม่ผ่าน · `config.test.ts` วน `SHOWCASE_DESIGN_IDS` ทุกตัวมีราคา integer > 0 |
| Z12 | `?price=` / `?p=` / `?r=solitaire&price=1` เปลี่ยนราคา | `readShowcaseParams` อ่าน 7 key เดิม (test X2 เดิม + เคส solitaire) |
| Z13 | solitaire มีคำ "พลอยเสริม" · "เม็ดข้าง" · "ทุกเม็ด" · "เม็ด 1" · "ซ้ายไปขวา" · ชื่อคู่ "X + Y" · `pair.title` ใน DOM/LINE | RTL + unit line-message ทุกโหมดของ solitaire |
| Z14 | `c` ผิดของ solitaire: `g.a` · `garnet` · `cz` · `G` · `gg` · `g.` · `.g` · ยาว > 64 · array | `parseOwnSlotsParam(raw, "solitaire")` → null (ถือว่ายังไม่เลือก · ไม่ throw) |
| Z15 | ข้อความ "ทุกแบบ" ที่ผูกกับราคาหลงเหลือ | test: `SHOWCASE_COPY` ไม่มี key `priceAllDesigns` · DOM ทุกแบบไม่มี `/บาท\s*ทุกแบบ/` |
| Z16 | `solitaire-ring` เข้า first-load / ถูก import จากที่อื่นนอก showcase-rings | test import graph (§15.4) |
| Z17 | หมายเหตุช่าง/ค่าประมาณจาก `SOLITAIRE` ถึงลูกค้า | ไม่พอร์ต `info`/`notes` · import graph |
| Z18 | ไซซ์นอก 50–60 ของ solitaire ถึง LINE (49/61/57.5/NaN) | `isShowcaseSize` เดิม (Z2) — ขยาย loop เป็น 8 แบบ |

**ต้องไม่พัง**: ลิงก์เดิมทุกรูปแบบของ 7 แบบ (`g` · `t&i&q&c&d` ไขว้ · `c` แถว N ตัวอักษร + preview ยาว 2 ของแถว · `r` ทั้ง 6) → ผลเดิม และ `buildShowcaseUrl` byte เดิม · ไขว้ 55–58 · CZ รายเม็ด (แถว) + CZ บน/ล่าง (ไขว้) · สลับแบบ 7→1→7 สีเดิมกลับ (`ownByCount`) · golden เดิม row-ring 6 แบบ + bypass ไม่ขยับ · ลิงก์ hub `/ring-builder` · test เดิมทั้งหมด (แก้เฉพาะสตริง 890 → `formatPriceThb(id)` ห้ามลบเคส) · X1–X8 · Y1–Y6 · Z1–Z10 เดิม

### 15.7 Phase (Luke · ทำรวดเดียวได้ เรียงตามนี้)
| # | ก้อน | เสร็จเมื่อ |
|---|---|---|
| S0 | คัดลอกรูป 4 ไฟล์ออกจาก Temp ทันที | ไฟล์อยู่ใน `_assets` |
| S1 | ราคาต่อแบบ (map + ลบค่าเดิม + ทุกจุด §15.2 + test 890 เดิม) — ยังไม่มีแบบ 8 | typecheck + test เดิมผ่าน · 7 แบบเห็น 890 เหมือนเดิม |
| S2 | `solitaire-ring.ts` + golden + showcase-rings + import graph | §15.4 |
| S3 | `designs.ts` แบบ 8 + `isSingleStone` + branch 6 จุด §15.3 + parser `n >= 3` | Z13 Z14 · ลิงก์เดิมไม่พัง |
| S4 | รูป + `_assets` + EXIF test | §15.5 |
| S5 | `npx next build` (จด first-load size ก่อน/หลัง) · `npm test` · `npm run typecheck` | ผ่านทุกตัว |

### 15.8 QA scope: **L + security quick review ก่อน merge**
- ไม่ใช่ 💰 ตามนิยาม (ไม่เขียน DB · ไม่มีเอกสารภาษี · ข้อความ LINE ไม่ผูกมัดราคา แอดมินยืนยันเอง) แต่ **L** เพราะแตะของกลางของหน้า: `config.ts` (ราคาใช้ทั้ง /ring-builder 8 แบบ + /tools hub) · `formatOwnSlots`/`parseOwnSlotsParam` (ใช้ทุกแบบแถว) · `showcase-rings` (lazy chunk ทุกแบบ)
- QA: 8 แบบ × (rec 1–3 / own / direct) × ไซซ์ขอบ 50/55/58/60 · สลับ solitaire↔ไขว้↔แถว 7 ในโหมดเลือกเอง · ลิงก์เก่า 5 รูปแบบ + ลิงก์ solitaire (`?r=solitaire` · `?c=g&d=own&r=solitaire`) · /tools hub · ราคาทุกจุด §15.2 · มือถือจริง: ลากหมุน solitaire · กดปุ่ม LINE จริง solitaire (790) + แบบเดิม 1 แบบ (890)
- **security quick review ก่อน merge**: ราคาที่ลูกค้าเห็นเปลี่ยน + parser `c` แก้ — ดู Z3-ใหม่ / Z11 / Z12 / Z14 / Z16 + ค่าภายนอกใน diff (ไม่มี URL/LINE ID ใหม่ · 790/890 ชี้ที่มาได้ = คำสั่งเจ้าของ 24 พ.ย. / 18 พ.ย.)

### 15.9 ความเสี่ยง
- **branch `isSingleStone` ไม่ครบ** = ลูกค้าเห็น "พลอยเสริม (…)" หรือ "เม็ด 1 (ทุกเม็ด)" — Z13 ต้องวนทุกโหมดจริง ไม่ใช่แค่ rec
- **พอร์ตผิดจุดเดียว = ทรงเพี้ยนเงียบ** → golden จากต้นฉบับคือด่านหลัก · เปิดดูจริงหลัง S2 (builder นี้ยังไม่เคยรันใน stack Next)
- chip สูงขึ้นเพื่อใส่ราคา → ส่วนล่างดันลงบนมือถือ (stage sticky ≤ 40dvh เดิม ไม่กระทบ) — เจ้าของดูตอน UAT
- พลอยเม็ดเดียวบนเฟรมทั้งวงจะดูเล็กบนจอ (ไม่แก้กล้อง เหมือน §6)
- รูปต้นทางอยู่ใน Temp — หายได้ก่อน S0
- `TODO_OWNER_DESIGN_NAME` ของแบบ 8 ยังค้าง (เหมือน 7 แบบเดิม) — QA จะรายงานตามกฎค่าภายนอก

### 15.10 คำถามเจ้าของ (ไม่บล็อกการเริ่มงาน — ใช้ค่าตั้งต้นในวงเล็บไปก่อน)
1. ~~ชื่อแบบ 8 สำหรับลูกค้า~~ → **เจ้าของตั้งแล้ว 24 พ.ย.: "เม็ดเดี่ยว (1 เม็ด)" — ดู §15.12**
2. ~~หน้า hub เขียน "เริ่มต้น 790 บาท"~~ → **TL ตัดสินแล้ว: hub ไม่ใส่ราคา** (เจ้าของยังไม่ได้สั่งเพิ่ม)
3. ลำดับ chip: เม็ดเดี่ยวไว้ใบสุดท้ายหรือใบแรก (ค่าตั้งต้นเดิม = ใบที่ 8) → **เจ้าของตอบแล้ว 24 พ.ย.: เรียงตามจำนวนเม็ด เม็ดเดี่ยวเป็นใบแรก — ดู §15.12**
4. 790 รวมพลอยสีเหมือน 7 แบบไหม · พลอยกลมขนาดนี้มีครบ 5 ชนิด + CZ ขาวไหม (ค่าตั้งต้น: เลือกได้ 6 ตัวเลือกราคาเดียว)
5. การ์ดเลือกแบบแสดงราคาทุกใบ — โอเคไหม (ค่าตั้งต้น: แสดง)

### 15.11 บันทึกการ implement (Luke · 24 พ.ย. 69)
- ทำตาม S0–S5 · commit แยกตาม S บน `feature/showcase-solitaire`
- เบี่ยงจาก §15: (1) hub ไม่มีราคา + ไม่มี `minShowcasePriceThb` (มติ TL) (2) `SHOWCASE_PRICE_THB_BY_DESIGN` ใส่ solitaire ตอน S3 (S1 ยังไม่มีแบบ 8 ตามแผน) (3) `showcasePriceThb` ตรวจ id ด้วย `hasOwnProperty` (กัน `__proto__`/`constructor`) (4) copy ใหม่ที่ไม่อยู่ใน §15: `singleStoneEmptyHint` "แตะพลอยที่ชอบเพื่อดูบนแหวน" (ข้อความช่วยตอนยังไม่เลือก — เม็ดเดี่ยวใช้ `ownEmptyHintPerGem` ไม่ได้เพราะมี "ทุกเม็ด") (5) PlacementNote ของเม็ดเดี่ยวไม่ render ทั้งโหมดแนะนำและเลือกเอง
- test เดิมที่แก้เกิน "890 → formatPriceThb": ลำดับ/จำนวนแบบ 7→8 · loop ที่ยืนยัน "พลอยหลัก/เสริม" ของแบบแถวหลายเม็ด กรอง `!isSingleStone` (เม็ดเดี่ยวมี test คำต้องห้ามของตัวเองใน `solitaire.test.ts` + `RingShowcase.solitaire.test.tsx`) · DOM ที่เคยเช็คราคา "ทั้งหน้า" ตัดการ์ดเลือกแบบออกก่อน (การ์ดแสดงราคาทุกแบบโดยตั้งใจ)

### 15.12 มติเจ้าของหลัง UAT (24 พ.ย. 69 · คำต่อคำ: "เอาเม็ดเดียวขึ้นก่อนเป็นอันแรก เรียงตามจำนวนเม็ด ... ใช้ชื่อว่า เม็ดเดี่ยว (1 เม็ด)" · "ตรงรูปแหวน ... animation white dot เล็กๆ ขยับไปขยับมา ... ให้เลื่อนแหวนหมุนดูได้")
ทับ §15.10 ข้อ 1 และ 3 · ทับ "ใบที่ 8" ใน §15 ทุกจุด
1. **ลำดับการ์ด**: `DESIGNS` (designs.ts · แหล่งเดียว) เรียงตามจำนวนเม็ดที่ลูกค้าเห็นในชื่อ (`ownSlotCount`: ไขว้ = 2) น้อย→มาก เสถียร → `solitaire · bypass2 · trinity · channel4 · scroll6 · channel6 · bar7 · small7`
   - 🔴 **แบบเริ่มต้นเมื่อไม่มี `r` ยังเป็นไขว้** (`DEFAULT_DESIGN_ID` ไม่ผูกกับ `DESIGNS[0]`) — ลิงก์ที่แจกแล้ว + ลิงก์จาก quiz ไม่เปลี่ยนผล · id `solitaire` ใน URL ไม่เปลี่ยน · มีแค่ลำดับการ์ดที่เปลี่ยน
2. **ชื่อ**: `name` = `shortName` = "เม็ดเดี่ยว (1 เม็ด)" (ลบ `TODO_OWNER_DESIGN_NAME` ของแบบนี้ · อีก 7 แบบยังเป็นชื่อชั่วคราว) — ขึ้นการ์ด · สรุป · aria · LINE (ทุกจุดอ่านจาก `designs.ts`)
3. **drag hint** (`RingStage.tsx` + keyframes `gq-hint-swipe`/`gq-hint-life` ใน `tailwind.config.ts`): จุดขาว 15px + เงาบาง · กลาง stage ค่อนล่าง (top 78%) · เลื่อน ±40px ease-in-out × 3 รอบ (1.9s/รอบ) แล้ว fade ใน 5.8s · CSS ล้วน ไม่เพิ่ม dependency · `pointer-events-none` + `aria-hidden`
   - แสดงเมื่อ `mode === "ready"` และไม่ `designFailed` เท่านั้น (ไม่แสดงตอน loading/ไม่รองรับ 3D/context lost/fallback รูป)
   - หายเมื่อ pointerdown/touchstart บน stage ครั้งแรก หรือ timer 6 วิ · state `hintDone` อยู่ที่ RingStage (ไม่ remount ตอนเปลี่ยนแบบ → แสดงครั้งเดียวต่อการโหลดหน้า) · ไม่ใช้ storage
   - `prefers-reduced-motion: reduce` = **ไม่แสดงเลย** (จุดนิ่งไม่สื่อว่าลากได้ และดูเหมือนฝุ่นบนภาพ · ป้าย "ลากเพื่อหมุน" เดิมยังอยู่) — เช็คด้วย `matchMedia` ใน JS เพื่อให้ test ได้
   - ไม่แตะ gl-renderer / row-ring / solitaire-ring
4. test: `designs.test.ts` (ลำดับ · ชื่อ · default=ไขว้) · `RingShowcase.designs/solitaire*.test.tsx` (ลำดับการ์ด · checked เริ่มต้น = ใบที่ 2) · `line-message.test.ts` (ชื่อใหม่) · `RingShowcase.draghint.test.tsx` (hint ใหม่ทั้งชุด)

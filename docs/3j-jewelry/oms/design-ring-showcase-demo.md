# Technical design: หน้าแบบแหวน 3J หลังจบ gem quiz (D1 demo / D2 หลังบ้าน)

> Yoda (architect) · 12 พ.ย. 69 · branch `feature/ring-showcase-demo` (ฐาน `feature/ring-builder-admin`)
> รอบนี้ = DEMO บน Vercel preview ยังไม่ขึ้น production · มติ Tech Lead อยู่ §7 (ทับหัวข้อด้านบนเมื่อขัดกัน)
> ทั้งหมดนี้มาจากการอ่านโค้ด ยังไม่ได้รันอะไร
> เอกสารแม่: `docs/3j-jewelry/oms/design-ring-builder.md` (§15.3 สัญญา RingViewer · §16.0 มติเจ้าของ · §18 แบบไล่ขนาด)

D1 ทำได้โดยไม่แตะ middleware, ไม่เขียน DB และไม่ต้องตั้ง secret

## 0. คำสั่งเจ้าของ (12 พ.ย. 69 — ถอดความ)

1. จบ gem quiz แล้ววิ่งมา "หน้าแบบของ 3J Jewelry" — หน้าแนะนำแหวน แล้วเอาพลอยที่ลูกค้าได้จาก quiz ใส่ให้เลยเป็นค่าเริ่มต้น
2. ตอนนี้แสดงเฉพาะแหวน "ไขว้ 2 เม็ด (ไข่)" แบบเดียว แบบอื่นยังไม่เปิดให้เห็น
3. ด้านล่างมี "พลอยที่ลูกค้าเลือกได้" ของแต่ละแบบ (แบบ 1, 2, 3 = พลอยอันดับ 1–3 จาก quiz) + ข้อความ "พลอยอะไรเสริมอะไร" เหมือนหน้าสรุปสุดท้ายของ quiz · กดแบบ 1/2/3 → แหวนเปลี่ยนเป็นพลอยชุดนั้น
4. ราคา 800 บาท ตายตัว ไม่ว่าจะเลือกพลอยอะไร ยังไม่คิดค่าพลอยเพิ่ม
5. เลือกไซซ์เหมือนจอ ring builder เดิม วงนี้ให้เลือก 55–58
6. หลังบ้านยังต้องมีระบบตั้งค่าเหมือนเดิม + เลือกได้ว่าแบบไหนจะขึ้นหน้าแบบของ 3J
7. มีรูปจริงของแหวนแสดงข้างล่าง (ใช้รูปที่เจ้าของส่งมา)

## 1. Route และการส่งผล quiz

- **Route:** `/ring-builder` วางที่ `app/(quiz)/ring-builder/page.tsx` บน `feature/ring-builder-admin` path นี้ exempt แบบ exact อยู่แล้วและมี test ล็อก (`lib/auth/exempt-path.ring-builder.test.ts`) แต่ยังไม่มี page · ถือว่าหน้านี้คือ ring builder ตัวจริงที่ตอนนี้เปิดแบบเดียว ไม่ใช่หน้าใหม่แยก
- **Param:** `/ring-builder?g=citrine.garnet.peridot` คือรหัสพลอยอันดับ 1–3 ตามลำดับ ไม่มีคำตอบ quiz หรือ PII
- **Validate:** server component อ่าน `searchParams` แล้วส่งเข้า pure parser ผ่านเมื่อเป็น string เดียว ยาวไม่เกิน 64 ตัว แยกด้วย `.` ได้ 3 ตัวไม่ซ้ำ และทุกตัวอยู่ใน `GEM_QUIZ_STONE_CODES` (เช็คด้วย `hasOwnProperty`) ผิดข้อใดข้อหนึ่งให้ทิ้งทั้งก้อน
- **พลอยเสริมไม่อยู่ใน URL:** หน้าแหวนคำนวณเองจาก `findPair()` ตัวเดียวกับ quiz จึงปลอมคู่ที่ quiz ไม่เคยให้ไม่ได้
- **การวางพลอย:** เม็ดบน = พลอยหลักของแบบนั้น · เม็ดล่าง = พลอยเสริม (pair) · CZ เล็ก 2 เม็ดขาวตายตัว
- **เข้าตรงหรือ param เสีย:** แหวน CZ ขาวทั้งสองเม็ด ส่วน "แบบ 1/2/3" ถูกแทนด้วยการ์ดชวนทำ quiz (ลิงก์ `/gem-quiz`)
- **ฝั่ง quiz:** `buildResultView` คืน `top3` เพิ่ม และปุ่มหลักของ `ResultScreen` เปลี่ยนจาก LINE เป็นลิงก์ไปหน้าแหวน หน้าผล quiz ยังอยู่ครบ

ทางที่ตัดทิ้ง:
- **sessionStorage:** พังใน in-app browser ของ LINE และแชร์ลิงก์ไม่ได้
- **ส่งคำตอบ quiz ไปคำนวณใหม่:** พาวันเกิดติด URL โดยไม่จำเป็น
- **route ใหม่:** ต้องแก้ matcher และ `exempt-path.ts` ซึ่งเป็นงานสิทธิ์ ต้องผ่าน security

## 2. Phase

| | D1 demo (ข้อ 1–5, 7) | D2 (ข้อ 6 + ต่อ `rb_*`) |
|---|---|---|
| ข้อมูล | config ในโค้ด: แบบเดียว, 800 THB, ไซซ์ 55–58, รูป 5 รูป | migration เลขใหม่ (ไม่แก้ 0196) |
| QA | **M** + security ดูเร็วเฉพาะ param และ graph ไม่มี "use server" | **💰** |
| ข้อแลก | แก้ราคา/ไซซ์/รูปต้อง deploy ใหม่ และยังไม่มีรหัสยืนยัน | ช้ากว่า แต่ราคามาจาก DB และรหัส HMAC ใช้ได้ |

สิ่งที่ D2 ต้องเปลี่ยนใน schema:
- **จำนวนเม็ด:** `rb_design_count_ck` บังคับ 3–7 แต่แบบไขว้มี 2 เม็ดเลือกได้ + CZ ตายตัว 2 เม็ด และมีพลอยสองขนาด ควรทำ `rb_design_slot` ตาม §18 ของ design-ring-builder.md ครั้งเดียว (design × pos → ทรง/ขนาด/`selectable`) พร้อม `layout_kind` (row หรือ bypass2) จะรองรับแบบไล่ขนาดไปด้วย
- **ราคาเหมา 800:** `rb_*` บังคับราคาพลอยต่อเม็ด ≥ 1 บาท ต้องมี flag "ราคาเหมารวม" ต่อแบบ หรือยอมให้ offer เป็น 0
- **ข้อ 6 "เลือกแบบไหนขึ้นหน้า":** ใช้ `is_active` + `published_at` ที่มีอยู่ ไม่เพิ่มคอลัมน์ เว้นแต่เจ้าของอยากแยกรายการ
- **ผูกพลอย quiz:** เพิ่ม `rb_stone.quiz_code` เพราะชื่อยังไม่ตรงกัน (quiz ใช้ "เพอริดอท" แต่มติ Q1 ใช้ "เพริดอต")
- **รหัสสั่งทำ:** ยังไม่ได้เปิด `lib/ring-builder/code.ts` ต้องตรวจว่า bit layout รับ 2 เม็ดได้ไหม

## 3. ฐาน branch และไฟล์ของ D1

แตก `feature/ring-showcase-demo` จาก `feature/ring-builder-admin` ใน worktree · branch ฐานนำ main 20 commit ตามหลัง 0 และมี exempt, `last-size.ts`, `lineOaMessageUrl` ครบ · ข้อแลกคือ D1 ขึ้น production ก่อน P1 backend merge ไม่ได้ ซึ่งรับได้เพราะเป็น demo

ไฟล์ใหม่:
- `app/(quiz)/ring-builder/page.tsx` — parse param, ใส่ `robots: noindex`
- `app/(quiz)/ring-builder/RingShowcaseClient.tsx` — state: แบบที่เลือก, ไซซ์
- `app/(quiz)/ring-builder/_components/` — `RingViewer.tsx` (ตามสัญญา §15.3 ของ design-ring-builder.md, lazy-load, `onUnsupported`), `GemSetPicker.tsx`, `SizePicker.tsx`, `PhotoGallery.tsx`, `OrderSummary.tsx`
- `app/(quiz)/ring-builder/_assets/bypass2-1..5.jpg` — static import จึงเสิร์ฟจาก `/_next/static` ที่ exempt อยู่แล้ว · ห้ามวางใน `public/ring-builder/` เพราะ test เดิมบังคับให้ `/ring-builder/x.png` ถูก gate
- `lib/ring-builder/showcase/` — `config.ts`, `quiz-link.ts` (สร้าง href + parser), `sets.ts` (top3 → 3 ชุด), `line-message.ts`
- `lib/ring-builder/viewer/` — `bypass-ring.ts` (พอร์ต `buildBypassRing` + `BYPASS2` แบบ pure), `gl-renderer.ts` (raw WebGL ไม่ใช้ three.js), `gem-colors.ts`
- test คู่ทุกไฟล์ใน `lib/`

ไฟล์ที่แก้:
- `lib/gem-quiz/result.ts` — export ตัวหา pair และเพิ่ม `top3` ใน view
- `app/(quiz)/gem-quiz/_screens/ResultScreen.tsx` — เปลี่ยน CTA
- `app/(quiz)/gem-quiz/GemQuizClient.tsx` — `keepalive: true` ที่ fetch submit (มติ §7 e)
- `lib/gem-quiz/no-server-action-graph.test.ts` — เพิ่ม entry หน้าใหม่
- `docs/3j-jewelry/READING-LISTS.md`

ไม่แตะ `middleware.ts`, `lib/auth/exempt-path.ts`, `/ring-size`, `app/api/**`

ที่มาของ 3D: `docs/3j-jewelry/cad/trinity-ring-preview.html` บน branch `docs/trinity-spike` (บรรทัด 1022–1300 = `BYPASS2` + `buildBypassRing` · renderer 1444–1580) · สเปก `docs/3j-jewelry/cad/bypass2-ring-spec.md` · ไม่พอร์ต `buildRowRing`

## 4. จุดจบ flow ของ D1

- การ์ดสรุป: แบบ, พลอยบน/ล่าง, ไซซ์ (หรือ "ให้แอดมินช่วยเช็ก"), 800 บาท
- ปุ่ม "ส่งให้แอดมินทาง LINE" ใช้ `lineOaMessageUrl(text)` ลูกค้ากดส่งเอง และมีปุ่มคัดลอกข้อความสำรอง
- ไม่มีรหัส ไม่มี QR ไม่เขียน DB · ข้อความต้องไม่มีอะไรที่ดูเหมือนรหัสยืนยัน
- แอดมินยืนยันราคาเอง เพราะข้อความ LINE แก้ได้ · รหัส HMAC มาใน D2

## 5. เคสที่ห้ามผ่าน และเคสที่ต้องไม่พัง

ห้ามผ่าน:

| # | เคส | ตกที่ |
|---|---|---|
| X1 | `g` มีรหัสนอก 5 พลอย, `constructor`/`__proto__`, ซ้ำ, ไม่ครบ 3, ยาวเกิน 64, เป็น array, มี HTML | parser คืน null → โหมดเข้าตรง ไม่ throw (unit test) |
| X2 | `?price=`, `?size=`, `?design=` | page อ่าน key เดียวคือ `g` (test) |
| X3 | ไซซ์นอก 55–58 ไปถึงข้อความ LINE | `line-message.ts` ตรวจ integer ในช่วงของแบบ ไม่ผ่านคือไม่สร้างข้อความ |
| X4 | แบบอื่นโผล่ | `config.ts` มีแบบเดียว และ builder แบบแถวไม่อยู่ใน bundle |
| X5 | "use server" หรือ `lib/actions` เข้า graph | `no-server-action-graph.test.ts` |
| X6 | ต้นทุน, น้ำหนัก 3.2 g, spec หรือโหมด `#dev` ถึงลูกค้า | ไม่พอร์ต `buildSpec` และ `info` + grep ใน QA |
| X7 | คำว่า "เพชร" หรือสรรพคุณที่แต่งใหม่ | ใช้ข้อความ `GEM_QUIZ_PAIRS` + disclaimer เดิมคำต่อคำ มี copy-guard test |
| X8 | path ใต้ `/ring-builder/*` หลุด gate | test เดิมต้องเขียวโดย diff ของ matcher เป็นศูนย์ |

ต้องไม่พัง:
- เข้า `/ring-builder` ตรง
- quiz ทุก flow รวม liked ว่าง, ดูพลอยทางเลือก, เริ่มใหม่ และ submit ยังยิงครั้งเดียว
- `/ring-size` ไม่มี diff
- WebGL ไม่รองรับหรือ context lost → แสดงรูปจริงแทน ตัวเลือกยังใช้ได้
- localStorage ถูกบล็อกใน in-app browser
- `prefers-reduced-motion`
- มือถือ: แหวน sticky ด้านบน ตัวเลือกเลื่อนด้านล่าง

## 6. คำถามถึงเจ้าของ + ช่องที่รู้ตัว

คำถาม:
1. ~~จบ quiz = ปุ่มบนหน้าผล หรือเด้งอัตโนมัติ~~ → ตอบแล้ว §7 (a) · ยังค้าง: คนที่ตอบว่าอยากใส่สร้อย/ต่างหู ยังพามาหน้าแหวนไหม
2. พลอยไข่ 7×5 มีจริงครบทั้ง 5 ชนิดในราคา 800 ไหม และชื่อแบบคืออะไร — ตอนนี้ใส่ **[ต้องยืนยัน: ชื่อแบบ]**
3. ~~รูปจริง 5 รูปลง repo public ได้ไหม~~ → ตอบแล้ว §7 (c)

ช่องที่รู้ตัว:
- **แบบ 1 กับแบบ 2 มักเป็นพลอยคู่เดิมสลับบน/ล่าง:** เช่น top3 = garnet, citrine, peridot จะได้แบบ 1 = garnet+citrine และแบบ 2 = citrine+garnet เพราะ `findPair` หยิบคู่แรกที่เจอ · ต้องให้เจ้าของเห็นใน demo ว่ารับได้ไหม
- **state หายเมื่อไป `/ring-size`:** กลับมาแล้วพลอยยังอยู่ (มาจาก URL) แต่แบบและไซซ์ที่เลือกรีเซ็ต
- **3D ยังไม่มีหลักฐานว่ารันจริง:** spec ของ Sabé เขียนว่าโค้ดยังไม่เคยรันในเบราว์เซอร์ ต้องเปิดดูหลังพอร์ต และ `failIfMajorPerformanceCaveat` จะทำให้มือถือรุ่นเก่าตกไปใช้รูปแทน
- **ข้อความ LINE ไม่ใช่หลักฐานราคา:** ลูกค้าแก้ข้อความได้ จนกว่า D2 จะมีรหัส HMAC

## 7. มติ Tech Lead (12 พ.ย. 69) — ทับหัวข้อด้านบนเมื่อขัดกัน

| # | เรื่อง | มติ | ผลต่อ D1 |
|---|---|---|---|
| a | จบ quiz → หน้าแหวน | **CTA = ปุ่มบนหน้าผล quiz ไม่ auto-redirect** | แก้เฉพาะปุ่มหลักใน `ResultScreen.tsx` · หน้าผล quiz อยู่ครบ |
| b | เปลี่ยนสีพลอยรายเม็ดเอง | **ตัดออกจาก D1** | ลูกค้าเลือกได้แค่แบบ 1/2/3 (หรือ CZ ขาวเมื่อเข้าตรง) · ไม่มี picker รายเม็ด |
| c | รูปจริง 5 รูป | **เจ้าของสั่งให้ใช้แล้ว** · ลบ EXIF + ย่อก่อนลง repo | ไฟล์ใน `_assets/` ต้องไม่มี EXIF (QA ตรวจ) |
| d | สถานะ 0196 | **apply บน prod แล้วจริง** (10 พ.ย. · post-verify PASS 130) | §17 ของ `design-ring-builder.md` ที่เขียนว่า "ยังไม่เคย apply" ล้าสมัย · D2 ต้องออกเลข migration ใหม่ ห้ามแก้ 0196 |
| e | submit ของ quiz ถูกตัดตอนกดลิงก์เร็ว | **เพิ่ม `keepalive: true` ได้** | แก้ `GemQuizClient.tsx` หนึ่งบรรทัด · QA ครอบ: submit ยังยิงครั้งเดียวต่อรอบ + retake flag เดิม |

## §8 หนี้ที่รู้ตัว (code review C-3PO 12 พ.ย. — merge ได้ ไม่บล็อก)
- D2-1 `gl-renderer.ts` rAF วนทุกเฟรมแม้ไม่มีอะไรเปลี่ยน (อ่าน clientWidth/Height 60 ครั้ง/วินาที) → เปลี่ยนเป็น kick-on-dirty + ResizeObserver
- D2-2 `gl-renderer.ts` ไม่มี unit test (jsdom ไม่มี GL) — ready/lost/restored/dispose ยืนยันจากการเปิดหน้าจริงเท่านั้น
- D2-3 `copyText` มี 2 สำเนา (ring-size / ring-builder showcase) เพราะ boundary test — ย้ายไป lib/shared + ใส่ removeChild ใน finally
- D2-4 config ราคา/ไซซ์/รูปอยู่ในโค้ด (รู้แล้วตาม §2) — ตอนย้ายไป rb_* เก็บด่าน isShowcaseSize ไว้
- D2-5 ข้อความ LINE ลูกค้าแก้ได้ → แอดมินยืนยัน 800 เองทุกครั้งจนกว่ามีรหัส HMAC
- D2-6 canvas ไม่มีคำแนะนำคีย์บอร์ดสำหรับ screen reader · ปุ่ม "กลับมุมหน้า" ยังลอยตอน context lost
- แก้แล้วก่อน merge: ไซซ์ 55–58 เหลือแหล่งเดียว (SHOWCASE_SIZE_RANGE คำนวณจาก SHOWCASE_SIZES)

## §9 D1.1 — เลือกพลอยเอง · เปลี่ยนเรื่องที่อยากเสริม · เงินขัดเงา (Yoda 17 พ.ย. 69)

> คำสั่งเจ้าของ 17 พ.ย. · ทับ §7b (picker รายเม็ดกลับมา) และคำสั่ง "ห้ามแก้ shader" หัวไฟล์ `gl-renderer.ts` (ยกเฉพาะ fragment shader — กล้อง/`matrix.ts`/`bypass-ring.ts` ห้ามแตะเหมือนเดิม) · ตัวเลข % มาจากการจำลอง 21,672 ชุดคำตอบ ยังไม่ได้รันโค้ดจริง · จอใหม่ต้องผ่าน Padmé ก่อน Luke

### 9.1 URL contract
ทุก key ตรวจแยกกัน ผิดรูป = ถือว่าไม่มี key นั้น ไม่ throw · หน้าอ่านแค่ 5 key นี้

| key | รูปแบบ (whitelist) | ความหมาย |
|---|---|---|
| `t` | `^[gacpb]{3}(\.[gacpb]{3}){5}$` + ตัวอักษรในกลุ่มไม่ซ้ำ (g=garnet a=amethyst c=citrine p=peridot b=blue_topaz) | top3 ของ intention ทั้ง 6 เรียงตามลำดับตัวเลือกใน `GEM_QUIZ_QUESTIONS` · ใช้ได้เมื่อ `i` ผ่านด้วย ไม่งั้นทิ้ง |
| `i` | 1 ใน 6 รหัส intention | เรื่องที่เลือกอยู่ |
| `g` | เดิม (D1) | ลิงก์เก่า · ใช้เมื่อไม่มี `t` และไม่มี `i` |
| `c` | `<บน>.<ล่าง>` รหัสเต็ม 2 ตัวจาก 5 ชนิด ซ้ำกันได้ (25 แบบ) | พลอยที่เลือกเอง — อยู่ใน URL เสมอแม้กำลังดูแบบแนะนำ |
| `d` | `1`/`2`/`3`/`own` | ตัวที่เลือกอยู่ · ไม่มี = 1 เมื่อมีแบบแนะนำ · `own` ที่ไม่มี `c` = ค่าเริ่มต้น |

ที่มาแบบแนะนำ (เรียงลำดับ): `t`+`i` → `t[i]` · `i` อย่างเดียว → ตาราง intention ล้วน · `g` → เหมือน D1 · ไม่มีเลย → เข้าตรง (CZ ขาว)
CTA ของ quiz ส่ง `?t=…&i=<intention ที่ตอบ>` (เลิกส่ง `g`) · หน้าเขียน state กลับ URL ด้วย `history.replaceState` ผ่าน `buildShowcaseUrl(state)` ตัวเดียว → แชร์/กลับจาก `/ring-size` ได้หน้าเดิม (ปิดช่อง §6 ยกเว้นไซซ์)

### 9.2 Re-rank — เลือก "ตารางคำนวณล่วงหน้า"
ตอนสร้าง CTA เรียก `rankGems` 6 รอบ (คำตอบจริง เปลี่ยนแค่ intention) เก็บ top3 ลง `t` · หน้าแหวนแค่หยิบ `t[i]` ไม่คำนวณคะแนน
- intention เดิม = top3 เดิมเป๊ะ และ intention อื่น = ผลที่ quiz จะให้ถ้าตอบข้อนั้นต่าง (ล็อกด้วย test ครบ 21,672 ชุด)
- ข้อแลก: วันเกิดไม่อยู่ใน URL แต่ **อนุมานย้อนได้** — 38% ของชุดคำตอบ ตารางชี้วันเกิด (วันในสัปดาห์) ได้วันเดียว · security ต้องรับข้อนี้

ตัดทิ้ง: ส่ง answers (วันเกิด+ความรู้สึก+พลอยที่ชอบติด URL ครบ 100%) · intention ล้วน (ตรงกับ quiz 15.5% อันดับ 1 ตรง 36%) · intention + ตัดเสมอด้วยลำดับ `g` (ตรง 22.9%)
ลิงก์ `g` เก่า/เข้าตรง กดเรื่อง → ตาราง intention ล้วน (`rankGems` คำตอบอื่นว่าง) · ป้ายห้ามเขียน "จากแบบทดสอบ" · ลิงก์ `g` กดเรื่องแล้ว `g` ถูกถอดจาก URL (กลับชุดเดิมไม่ได้นอกจากเปิดลิงก์เดิม — รับได้ ลิงก์เก่ามีแค่บน preview)

### 9.3 State (client)
`intention` · `recIndex` 1–3 · `own {top,bottom}|null` · `active: rec|own` · `size`
- สลับ `active` ไม่ล้างอีกฝั่ง · เปลี่ยน intention → `recIndex=1`, `active=rec`, `own` คงเดิม
- `own` มีครบ 2 เม็ดหรือไม่มีเลย ห้ามมีครึ่งเดียว: เปิดครั้งแรก seed จากแบบที่ดูอยู่ · เข้าตรง แตะเม็ดแรก = ตั้งทั้งสองเม็ดเป็นพลอยนั้น
- เลือกเอง: `findExactPair(a,b)` ตัวใหม่ (คู่ตรง `GEM_QUIZ_PAIRS` ไม่สนลำดับ · ไม่เจอ/พลอยซ้ำ = null) → มี = ข้อความคู่เดิม · null = แสดง `labelTh` + `keywords` รายเม็ดจาก config เท่านั้น · **ห้ามใช้ `findPair`** (fallback คืนคู่ที่ไม่มีเม็ดล่าง = สรรพคุณผิดคู่) · 25 แบบมีข้อความคู่ 10
- LINE: บรรทัดแบบ = `… · แบบ n` หรือ `… · เลือกพลอยเอง` · `line-message.ts` รับรหัสพลอยแทน label แล้วตรวจ whitelist เอง · ไม่ใส่ intention · ราคาจาก `formatPriceThb()` ที่เดียว

### 9.4 เงินขัดเงา (WebGL1 เดิม · แก้เฉพาะ `FS_METAL`/`FS_GEM`)
เทาเข้มเพราะ: env ครึ่งล่าง 0.16 + แถบขอบฟ้ากด 55% + ไม่มี gamma · รูปจริง (`bypass2-1.jpg`) = ขาวสว่าง ไล่เทาอ่อน เส้นมืดบางที่ขอบ
1. คิดสีแบบ linear → tone map (ACES ย่อ 1 บรรทัด) → `pow(c,1/2.2)` ทั้งโลหะและพลอย
2. โลหะ: F0 เงิน ≈ (0.97,0.96,0.92) + Schlick `F0+(1-F0)*(1-ndv)^5` แทน `uColor*(0.10+0.90*env)`
3. env แบบเต็นท์ถ่ายรูป (สูตรล้วน ไม่มี texture): พื้นล่าง 0.55–0.65 · บน 1.0 · softbox กว้าง 2 ดวงความสว่าง 1.6–2.5 · **เก็บเส้นมืดแคบ** (แถบขอบฟ้าแคบลง ลึก ~0.35 + การ์ดมืด 1 แถบ) — ไม่มีเส้นมืด = พลาสติกขาว
4. พลอย: `refract(-V,N,1/1.6)` → env × tint + สะท้อน fresnel (F0 ~0.08 · CZ ~0.13) + ประกาย 3 lobe เดิม · CZ แยก IOR ราย RGB (env 3 ครั้ง) · คง `uCap` กันสีพลอยซีดขาว · ทึบเหมือนเดิม ไม่ blend
5. เงาใต้แหวน = CSS radial-gradient ใต้ canvas
6. compile shader ใหม่ไม่ผ่าน → ใช้ shader D1 (เก็บเป็น `_V1`) → ค่อยตกรูปจริง

งบ: draw call 5 เท่าเดิม · ไม่มี texture/FBO/extension/loop · `env()` ต่อ fragment โลหะ 1 พลอย ≤4 · DPR cap 2 และ `failIfMajorPerformanceCaveat` ไม่แตะ · ลากหมุน ≥50 fps บนมือถือที่ QA ใช้ทดสอบ `[ต้องยืนยัน: รุ่นเครื่อง]`
วัด "เหมือนจริง": จับภาพมุมหน้าเทียบ `bypass2-1.jpg` — (ก) ความสว่างกลางของตัวเรือน ±15% ของค่าที่วัดจากรูปจริง (ข) เป็นกลาง |R−B| ≤ 0.04 (ค) ยังมีมืด: p5 ≤ ครึ่งของ p95 (ง) hue พลอย 5 ชนิด ±15° จาก `colors.base` (จ) เจ้าของดู v1/v2 คู่รูปจริงแล้วเคาะ

### 9.5 ไฟล์
แก้: `lib/ring-builder/showcase/quiz-link.ts` (parser 5 key + `buildShowcaseUrl` + href จากคำตอบ) · `sets.ts` (intention table · `findExactPair`) · `line-message.ts` · `config.ts` (copy) · `lib/ring-builder/viewer/gl-renderer.ts` · `app/(quiz)/ring-builder/page.tsx` · `RingShowcaseClient.tsx` · `_components/GemSetPicker.tsx` `OrderSummary.tsx` · `gem-quiz/_screens/ResultScreen.tsx` (ส่งคำตอบให้ href) · tests คู่ · `ux-ring-showcase-demo.md` · READING-LISTS
ใหม่: `_components/IntentionPicker.tsx` · `OwnGemPicker.tsx`
ไม่แตะ: `recommend.ts` · `config.ts` ของ quiz · middleware/exempt-path · `bypass-ring.ts` · `matrix.ts`

### 9.6 ห้ามผ่าน / ต้องไม่พัง
| # | ห้ามผ่าน | ตกที่ |
|---|---|---|
| Y1 | `t`/`i`/`c`/`d` ผิดรูป: ตัวอักษรนอก gacpb · กลุ่มไม่ครบ 6 · ซ้ำในกลุ่ม · `constructor`/`__proto__` · array · ยาวเกิน · HTML | parser คืน null ราย key ไม่ throw |
| Y2 | พลอยนอก 5 ชนิด หรือ CZ ใน `c` · `c` เม็ดเดียว/3 เม็ด | parser + `line-message.ts` คืน null |
| Y3 | ราคาไม่ใช่ 800 ในทุก 25 คู่ × ทุก `d` · `?price=` มีผล | ราคาไม่รับ input (test วนครบ) |
| Y4 | ข้อความคู่โผล่กับคู่นอก `GEM_QUIZ_PAIRS` หรือพลอยซ้ำ · ข้อความพลอยที่ไม่ได้มาจาก config | `findExactPair` + copy-guard test (X7 เดิม) |
| Y5 | `t[i]` ไม่เท่า top3 ของ quiz | test 21,672 ชุด |
| Y6 | ป้าย "จากแบบทดสอบ" เมื่อที่มาคือ intention ล้วน | test ตามที่มา |
| Y7 | LINE เขียน "แบบ n" ตอนเลือกเอง หรือกลับกัน | test `line-message` |

ต้องไม่พัง: ลิงก์ `?g=` เดิมได้ 3 ชุดเดิม · X1–X8 ของ D1 · quiz ทุก flow + submit ยิงครั้งเดียว · เข้าตรง · WebGL ไม่มี/context lost/shader ใหม่ compile ไม่ผ่าน · สลับ rec↔own แล้วค่าอยู่ครบ · reload/แชร์ได้หน้าเดิม · localStorage ถูกบล็อก · reduced-motion

QA: **M** (หน้าสาธารณะ ไม่เขียน DB ราคาคงที่) + security ดูเร็ว: parser 5 key · ข้อ 9.2 เรื่องอนุมานวันเกิด · graph ไม่มี "use server"

### 9.7 คำถามเจ้าของ
1. เลือกเองให้พลอยบน=ล่างชนิดเดียวกันได้ (เสนอ: ได้) และพลอยไข่ 7×5 ครบ 5 ชนิดทุกคู่ในราคา 800 จริงไหม (ต่อจาก §6 ข้อ 2 ที่ยังค้าง)

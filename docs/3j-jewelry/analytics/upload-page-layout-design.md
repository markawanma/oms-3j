# Design: จัดวางใหม่ `/tiktok/upload` — Accordion 3 ส่วน

> ผู้ออกแบบ: ux-ui (Padmé) · 4 ต.ค. 2569 · สถานะ: **เจ้าของยืนยันแล้ว 4 ต.ค. 69 — ทั้ง 3 ข้อใน §9.1/9.2/การจัดกลุ่ม ProvinceFixPanel ตามที่เสนอทุกข้อ (พับ default / auto-expand ไม่ scroll / รวม section เดียวกับคิวตรวจ) พร้อม implement แล้ว**
> โจทย์จากเจ้าของ (4 ต.ค. 69): หน้า `/tiktok/upload` ยาวเกินไป ต้องเลื่อนไกลกว่าจะเห็น "ประวัติไฟล์" —
> เสนอ 2 ทาง (พับ/กาง หรือแยกหน้าเล็ก) ให้ผู้ออกแบบตัดสินใจเอง
>
> **งานนี้คือการจัดวางหน้าจอใหม่เท่านั้น — ไม่แตะ business logic การ parse/match/apply จังหวัด
> และไม่แตะ `order_not_found` filtering (มีงานแก้คู่ขนานอยู่แล้ว)**

---

## 0. TL;DR

- **เลือก Accordion (แบบเปิดได้หลายส่วนพร้อมกัน, ไม่ unmount ส่วนที่พับ) ไม่ใช่ sub-route** — เหตุผลหลัก: โครงปัจจุบันเป็น client component เดียวที่แต่ละลูก fetch ข้อมูลเองตอน mount และมี form state (dropdown จังหวัด/เหตุผล/หมายเหตุ) อยู่ในแต่ละแถว ถ้าใช้ sub-route (Next.js จะ unmount/remount ตอนเปลี่ยน route) ฟอร์มที่กำลังกรอกจะหายทันที — ขัดกับที่เจ้าของสั่งตรงๆว่า "จะไม่มี bug กับ UI ภายหลัง"
- จัดเป็น **3 section ตามที่เจ้าของพูดจริง** (ไม่ใช่ 4): **อัปโหลด** / **ตรวจ/แก้ไข** (รวมคิวอัตโนมัติ + ค้นหาด้วยเลขพัสดุไว้ด้วยกัน) / **ประวัติไฟล์**
- Badge ตัวเลขค้าง (114) ติดอยู่ที่ **header ของ section เสมอ ไม่ว่าจะพับหรือกาง** — คำนวณจาก component ลูกที่ยัง mount อยู่ตลอด (hidden ไม่ unmount) ไม่ต้อง fetch ซ้ำ
- parse ไฟล์เสร็จ → section "ตรวจ/แก้ไข" **auto-expand แต่ไม่ auto-scroll** (ไม่ขัดจังหวะถ้ากำลังลากไฟล์ถัดไปอยู่) ส่วนลิงก์ "จัดการในคิวรวมด้านล่าง" เดิม (ปัจจุบันเป็น `<a href="#...">`) เปลี่ยนเป็นปุ่มที่ทั้ง expand และ scroll ให้ (เพราะมี intent ชัดจากการกด)
- Deep-link ผ่าน query param `?open=review` (ทางเดียว: URL → initial state เท่านั้น ไม่ sync กลับ)

---

## 1. อ่านโค้ดจริงแล้วเจออะไร (สรุปก่อนตัดสินใจ)

ไฟล์ที่เกี่ยวข้องทั้งหมดอยู่ใต้ `components/domain/tiktok/`:

| ไฟล์ | บทบาทจริงในหน้า | fetch ข้อมูลเองไหม | มี local form state ไหม |
|---|---|---|---|
| `UploadPageClient.tsx` | ตัวคุม orchestration ทั้งหมด (queue ไฟล์, ส่ง props ลง) | ไม่ (เรียก server actions ตรงตาม flow) | มี (queue/rejected/fileMapRef) |
| `UploadDropzone.tsx` | พื้นที่ลากไฟล์วาง | ไม่ | ไม่ (แค่ dragging/announce) |
| `UploadQueueList.tsx` | แสดงสถานะไฟล์กำลังอัป/parse ของรอบนี้ | ไม่ (รับ props) | ไม่ |
| `BatchSummaryCard.tsx` | การ์ดสรุป 7 ตัวเลขต่อไฟล์ที่ parse เสร็จในรอบนี้ | ไม่ (รับ props) | ไม่ |
| `PendingReviewQueue.tsx` | **คิวรอตรวจถาวร ทุกไฟล์** อ่านจาก `analytics.stg_label_page` ตรง (`getPendingLabelReviews()`) — **คนละ data source** จาก `BatchSummaryCard` โดยตั้งใจ (QA-1 fix 13 ก.ย. 69 — เคยมี 2 ที่กดได้พร้อมกันจนชน RPC "already resolved") | **ใช่ — useEffect mount + ทุกครั้งที่ `refreshSignal` เปลี่ยน** | ไม่ (ส่งต่อให้ `LabelReviewQueueRow`) |
| `LabelReviewQueueRow.tsx` | 1 แถวในคิวตรวจ — เลือกจังหวัด/เหตุผล/หมายเหตุ/snippet สอน + ปุ่มยืนยัน/ข้าม | ไม่ (รับ props, ยิง action เมื่อกด) | **มี — 7 useState ต่อแถว** |
| `ProvinceFixPanel.tsx` | ค้นออเดอร์ด้วยเลขพัสดุ/เลขที่ออเดอร์ แก้/ย้อนจังหวัดตรง — **ไม่ผูกกับ `stg_label_page`** | เมื่อกดค้นหาเท่านั้น | มี (query/results) + ลูก `ProvinceFixRow` มี form state ของตัวเอง |
| `LabelFileHistory.tsx` | ประวัติไฟล์ที่เคยอัป + ปุ่ม "อ่านใหม่" | **ใช่ — useEffect mount** | มี (reparsingIds) |

**สิ่งที่ยืนยันจากคอมเมนต์ในโค้ดเอง** (`UploadPageClient.tsx` บรรทัด 253-269): เคยมีบั๊กจริงจากการให้ "แถวรอตรวจ" โชว์ได้ 2 ที่พร้อมกันจาก data source คนละก้อน (`LabelParseSummary.reviewRows` ของรอบอัปโหลดนี้ vs `PendingReviewQueue` ที่อ่าน DB ตรง) — แก้แล้วด้วยการเหลือ renderer เดียว (`PendingReviewQueue`) ส่วนที่เหลือเป็นแค่ตัวเลข+ลิงก์ไปที่เดียว **นี่คือบทเรียนตรงประเด็นกับโจทย์ "ห้ามมี bug กับ UI ภายหลัง" ของเจ้าของเป๊ะ — การออกแบบใหม่ต้องไม่สร้าง data source ที่สองซ้ำแบบนี้อีก**

ProvinceFixPanel ไม่ได้อยู่ใน 3 ส่วนที่เจ้าของพูดถึงตรงๆ แต่คอมเมนต์ในโค้ด (บรรทัด 216-219) อ้างมติเจ้าของ 11 ก.ย. 69 ว่า "แผงแก้จังหวัดที่ `/tiktok/upload` (ค้นเลขพัสดุ) พอไหม → ตอบรับ" — เป็นเครื่องมือแก้จังหวัดแบบ manual ที่อยู่คู่กับคิวตรวจเสมอ ดู §3 ว่าทำไมจัดให้อยู่ section เดียวกับคิวตรวจ

---

## 2. ตัดสินใจหลัก: Accordion vs Sub-route

### ทางเลือกที่เจ้าของเสนอ และทำไมไม่เลือก sub-route

**Sub-route** (เช่น `/tiktok/upload`, `/tiktok/upload/review`, `/tiktok/upload/history` หรือ query-param tab ที่ conditional-render ทีละ section) มีจุดแข็งคือหน้าแต่ละอันสั้น ชัดเจน ตรงกับที่เจ้าของจำได้ง่าย (เหมือน `TikTokSubNav` ที่มีอยู่แล้วระดับบนสุดของโมดูล: แดชบอร์ด/จดไลฟ์/อัปโหลด)

แต่มี 2 ปัญหาที่โจทย์เจ้าของเตือนไว้เองว่าห้ามเกิด ("จะไม่มี bug กับ UI ภายหลัง"):

1. **Unmount = ข้อมูลที่กรอกค้างหาย** — `LabelReviewQueueRow` และ `ProvinceFixRow` เก็บฟอร์ม (จังหวัดที่เลือก/เหตุผล/หมายเหตุ/snippet) เป็น `useState` ในตัวเอง ถ้าสลับ sub-route แล้วกลับมา component เหล่านี้จะ mount ใหม่ → state reset เป็นค่าเริ่มต้นเงียบๆ ตรงกับสิ่งที่โจทย์ข้อ 4 เป็นกังวลพอดี ("แก้ใบนึงอยู่ใน 'ตรวจ/แก้ไข' แล้วสลับไป 'ประวัติไฟล์' กลางคัน ข้อมูลที่แก้ค้างอยู่ต้องไม่หายเงียบๆ")
2. **ต้อง refetch ทุกครั้งที่กลับมา** — `PendingReviewQueue`/`LabelFileHistory` fetch ตอน mount; sub-route ที่ unmount จะยิง `getPendingLabelReviews()`/`getLabelFiles()` ใหม่ทุกครั้งที่สลับกลับมา (ไม่ผิด แต่ไม่จำเป็น และทำให้ "เลื่อนลงไปดูคิวตรวจ" ต้องรอ loading spinner ซ้ำๆ)
3. เจ้าของบอกเองในโจทย์ข้อ 3 ว่า parse เสร็จ**ไม่บังคับสลับหน้าให้ก็ได้ เพราะอาจกำลังลากไฟล์อื่นอยู่** — นี่คือการยืนยันว่าต้องการ **เปิดดู "อัปโหลด" พร้อมกับรู้ความคืบหน้าของ "ตรวจ/แก้ไข" ได้ในเวลาเดียวกัน** ซึ่ง sub-route แบบ exclusive (เห็นได้ทีละหน้า) ทำไม่ได้โดยธรรมชาติ ต้องสลับไปมา

### ทำไมเลือก Accordion

**Accordion แบบ non-exclusive (เปิดได้มากกว่า 1 section พร้อมกัน) + ใช้ `hidden` attribute ซ่อน ไม่ unmount:**

- Section ที่พับยัง **mount อยู่ใน React tree เสมอ** (ใช้ `<div hidden={!open}>` ไม่ใช่ `{open && <div>}`) → `useState` ของทุกฟอร์มไม่เคยถูกทำลาย ไม่ว่าพับ/กางกี่ครั้ง ตอบโจทย์ข้อ 4 ตรงๆ โดยไม่ต้องยกฟอร์มทั้งหมดไปเก็บที่ parent/URL/store ใหม่ (ของเดิมไม่มี state management กลาง เช่น Zustand — เป็น local `useState` กระจายตามคอมโพเนนต์ ซึ่ง `hidden` เข้ากับของเดิมได้ตรงที่สุดโดยไม่ต้อง refactor data flow)
- `PendingReviewQueue`/`LabelFileHistory` ยัง fetch ตอน mount ครั้งเดียวเหมือนเดิมทุกตัว (เพราะ mount ตลอด) — **ไม่เพิ่ม network request ใดๆ เทียบกับของเดิม** (ของเดิม render ทุกอย่างพร้อมกันอยู่แล้ว ไม่มี regression ด้าน performance)
- เปิดได้มากกว่า 1 section พร้อมกันจริง ตรงกับที่เจ้าของต้องการ (ลากไฟล์ต่อ พร้อมเห็นคิวตรวจโตขึ้น)
- ไม่ต้องเพิ่มชั้น routing/layout ใหม่ซ้อนกับ `TikTokSubNav` ที่มีอยู่แล้ว — คง mental model เดิม: "แดชบอร์ด/จดไลฟ์/อัปโหลด" คือโมดูลคนละเรื่องกันจริง (คนละ query คนละวัตถุประสงค์) ส่วนภายใน "อัปโหลด" ทั้ง 3 ส่วนเป็น**ไปป์ไลน์เดียวกัน** (ไฟล์ → parse → ตรวจ → ประวัติ) ไม่ใช่โมดูลที่เป็นอิสระจากกัน — ไม่สมควรมีชั้น route ซ้อนอีกชั้น

### Trade-off ที่ยอมรับ (พูดตรงๆ)

- Accordion ไม่ได้ทำให้หน้า "สั้น" ในความหมาย DOM/bundle — มันยังโหลดทุก component เหมือนเดิมทั้งหมด แค่ซ่อนด้วย CSS เท่านั้น (ถ้าในอนาคตคิวตรวจโตเป็นหลักพันแถวจริงจัง ต้องคุย virtualization/pagination แยก — ไม่ใช่ scope นี้)
- URL ไม่ได้ sync สถานะเปิด/ปิดกลับไปเสมอ (ดู §6) — refresh หน้าแล้วกลับไป default เสมอ ยกเว้นมี query param ติดมา ถ้าเจ้าของต้องการให้จำสถานะล่าสุดข้าม reload ต้องเพิ่ม localStorage ทีหลัง (คำถามเปิด §9.2)

---

## 3. โครง 3 section (ชื่อ + เนื้อใน)

เจ้าของพูดไว้ 3 กลุ่ม: *อัปโหลด* / *ประวัติไฟล์* / *ตรวจและแก้ไข* (พูดสองคำนี้คู่กันเป็นกลุ่มเดียว — "ถ้าผมเลือกหน้าแก้ไขจังหวัด **หรือ** ตรวจ ให้เอาหน้าตรวจและแก้ไขขึ้นมา") ดังนั้น **`ProvinceFixPanel` (ค้นเลขพัสดุ/แก้จังหวัดมือ) ถูกจัดให้อยู่ใน section เดียวกับ `PendingReviewQueue`** เป็น 2 บล็อกย่อยเรียงต่อกันภายใน panel เดียว ไม่แยก accordion ซ้อน (เหตุผล: ทั้งคู่คือ "งานแก้ไขจังหวัด" ต่างกันแค่ทางเข้า — จากคิวอัตโนมัติ vs ค้นหาด้วยมือ และถ้าแยกเป็น section ที่ 4 จะกลายเป็น 4 ไม่ตรงกับที่เจ้าของพูด)

| # | id | ชื่อ section | เนื้อใน (component เดิม) | Badge | Default state |
|---|---|---|---|---|---|
| 1 | `upload` | **อัปโหลด** | `UploadDropzone` + rejected banner + `UploadQueueList` + `BatchSummaryCard` ของไฟล์ที่ done ในรอบนี้ | จำนวนไฟล์ที่กำลังประมวลผล (preparing/uploading/parsing) ถ้า >0 | **เปิด** เสมอ |
| 2 | `review` | **ตรวจ/แก้ไข** | บล็อกย่อย (a) "คิวรอตรวจสอบ (ทุกไฟล์)" = `PendingReviewQueue` → `LabelReviewQueueRow[]`; บล็อกย่อย (b) "แก้ไขจังหวัด (ค้นด้วยเลขพัสดุ/เลขที่ออเดอร์)" = `ProvinceFixPanel` | จำนวนแถวค้างจาก `PendingReviewQueue` (ตอนนี้ = 114) | **พับ** (ดูคำถามเปิด §9.1) |
| 3 | `history` | **ประวัติไฟล์** | `LabelFileHistory` | ไม่มี (ไม่ใช่ "งานค้าง" — ดูคำถามเปิด §9.3) | **พับ** |

---

## 4. User flow (รวม edge case)

### 4.1 Flow หลัก — อัปโหลดไฟล์ใหม่จนตรวจเสร็จ

1. เปิด `/tiktok/upload` → เห็น header 3 section ทันที (ไม่ต้อง scroll) — section "อัปโหลด" กางอยู่, เห็น badge "114" ที่ header ของ "ตรวจ/แก้ไข" แม้ section นั้นพับอยู่
2. ลากไฟล์ PDF วางใน dropzone (section อัปโหลดที่เปิดอยู่) → คิวไฟล์โชว์สถานะ กำลังเตรียม/อัป/อ่าน ทีละไฟล์ (เหมือนเดิมทุกจุด ไม่เปลี่ยน logic)
3. ไฟล์แรก parse เสร็จ → `BatchSummaryCard` โผล่ใน section อัปโหลด (เหมือนเดิม) + badge "ตรวจ/แก้ไข" เปลี่ยนเลข (เช่น 114→116) พร้อม pulse สั้นๆ ดึงสายตา + section "ตรวจ/แก้ไข" **auto-expand แบบไม่ scroll** (เผื่อเจ้าของกำลังลากไฟล์ถัดไปอยู่ ไม่อยากให้จอกระโดด)
4. เจ้าของลากไฟล์ที่สองต่อได้ทันที (section อัปโหลดไม่ถูกแทรกแซง) — ถ้าเลื่อนลงมาเอง section "ตรวจ/แก้ไข" ก็กางรอไว้แล้ว ไม่ต้องกดเปิดซ้ำ
5. เมื่อพร้อม เลื่อนลงมา section "ตรวจ/แก้ไข" → เลือกจังหวัด/เหตุผลให้บางแถว (ฟอร์มใน `LabelReviewQueueRow`)
6. **กลางทางสลับไปเปิด section "ประวัติไฟล์" เพื่อเช็คไฟล์เก่า** (ไม่ปิด section ตรวจ ก็ได้ หรือพับมันไปก็ได้) → กลับมาที่ section ตรวจ ค่าที่เลือกไว้ (จังหวัด/เหตุผล/หมายเหตุ) **ต้องยังอยู่เหมือนเดิม** เพราะ component ไม่เคย unmount
7. กดยืนยันจังหวัดแถวนั้น → แถวหายจากคิว (เหมือนเดิม, `onResolved`) + badge ลดลงหนึ่ง

### 4.2 Deep-link — แชร์ลิงก์ตรงไปคิวตรวจ

- เปิด `/tiktok/upload?open=review` → section "ตรวจ/แก้ไข" เปิดอยู่ตั้งแต่โหลดหน้า **และ** เลื่อนจอไปที่ section นั้นทันที (ต่างจาก auto-expand ตอน parse เสร็จ ที่ไม่ scroll — เพราะการกดลิงก์มี intent ชัดเจนว่าอยากไปดูจุดนั้นแล้ว)
- ปุ่ม "จัดการในคิวรวมด้านล่าง" ที่โผล่ใต้ `BatchSummaryCard` (ของเดิมเป็น `<a href="#pending-review-queue">`) เปลี่ยนพฤติกรรมเป็นปุ่มที่ expand + scroll ให้ในคลิกเดียว (เพราะถ้า section พับอยู่ การ scroll ไปที่ id เฉยๆจะไม่เห็นอะไร)

### 4.3 Error path

- `PendingReviewQueue` โหลดพัง (network/RPC error) → badge ของ section "ตรวจ/แก้ไข" แสดงสัญลักษณ์ "ไม่รู้จำนวน" (ดู §7) ไม่ใช่ "0" — กาง section ออกมาเห็น `ErrorBanner` + ปุ่มลองใหม่ (ของเดิมมีอยู่แล้ว ไม่เปลี่ยน)
- `LabelFileHistory` โหลดพัง → ไม่กระทบ section อื่นเลย (independent error state เดิม) — section "ประวัติไฟล์" presentation เหมือนเดิมทุกจุด แค่อยู่ในกรอบ accordion

---

## 5. Wireframe (ข้อความ)

โทน mobile-first เดียวกับ `/marketing/content/entry` (stacked single-column, `space-y`, ไม่มี sidebar/multi-column) — accordion ไม่เปลี่ยนพฤติกรรมระหว่าง mobile/desktop เพราะหน้านี้เป็น single column อยู่แล้วทั้งคู่

### Desktop/Mobile (เหมือนกัน — ต่างแค่ padding ที่มีอยู่แล้วจาก layout เดิม)

```
┌─────────────────────────────────────────────┐
│ [บรรยัดบรรด accent แดง 3px — ของเดิม]         │
│ TikTok Ops                                   │
│ [แดชบอร์ด] [จดไลฟ์] [อัปโหลด ◀active]         │  ← TikTokSubNav เดิม ไม่แตะ
├─────────────────────────────────────────────┤
│ ┌───────────────────────────────────────┐   │
│ │ ▾ 📤 อัปโหลด                            │   │ ← header: chevron + title, กดได้ทั้งแถบ (min-h-11)
│ ├───────────────────────────────────────┤   │
│ │ [ลากไฟล์ใบปะหน้ามาวางที่นี่...]           │   │ ← เปิดอยู่ (default) — UploadDropzone
│ │ [คิวอัปโหลด: ไฟล์ A — กำลังอ่าน...]       │   │ ← UploadQueueList
│ │ [สรุป — ไฟล์ A: เติมสำเร็จ 12 ...]        │   │ ← BatchSummaryCard (ไฟล์ done รอบนี้)
│ │  รอตรวจสอบ 3 หน้า — จัดการในคิวรวมด้านล่าง│   │ ← ปุ่ม expand+scroll ไป review
│ └───────────────────────────────────────┘   │
│ ┌───────────────────────────────────────┐   │
│ │ ▸ ✅ ตรวจ/แก้ไข           [114]         │   │ ← พับ (default) — badge เห็นเสมอ
│ └───────────────────────────────────────┘   │    (เนื้อใน hidden แต่ mount อยู่)
│ ┌───────────────────────────────────────┐   │
│ │ ▸ 🕘 ประวัติไฟล์                        │   │ ← พับ (default)
│ └───────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### เมื่อกาง "ตรวจ/แก้ไข"

```
│ ┌───────────────────────────────────────┐   │
│ │ ▾ ✅ ตรวจ/แก้ไข           [114]         │   │
│ ├───────────────────────────────────────┤   │
│ │  คิวรอตรวจสอบ (ทุกไฟล์) — 114           │   │ ← sub-heading เดิมของ PendingReviewQueue
│ │  [แถว 1: หน้า 3 · TH123... — Badge]     │   │ ← LabelReviewQueueRow (เหมือนเดิมทุกจุด)
│ │  [แถว 2: ...]                          │   │
│ │  ...                                   │   │
│ │  ──────────────────────────           │   │ ← เส้นแบ่ง sub-block
│ │  แก้ไขจังหวัด (ค้นด้วยเลขพัสดุ/เลขที่ออเดอร์)│   │ ← sub-heading เดิมของ ProvinceFixPanel
│ │  [ช่องค้นหา] [ค้นหา]                     │   │
│ └───────────────────────────────────────┘   │
```

**หมายเหตุสำคัญสำหรับ frontend-dev**: sub-heading ของ `PendingReviewQueue`/`ProvinceFixPanel` (`<p className="... uppercase">คิวรอตรวจสอบ...</p>` และ `<p ...>แก้ไขจังหวัด...</p>`) **ของเดิมมีอยู่แล้วในตัวมันเอง** ไม่ต้องสร้างใหม่ — แค่เอาทั้งสอง component มาวางต่อกันใน content area ของ `CollapsibleSection` เดียวกัน

---

## 6. State management + Component breakdown

### 6.1 สร้างใหม่: `components/ui/CollapsibleSection.tsx`

UI primitive ทั่วไป ไม่ผูก domain tiktok (ใช้ซ้ำกับหน้าอื่นที่ยาวเกินในอนาคตได้) — reuse pattern spacing/typography จาก `Badge.tsx`/ปุ่มใน repo (`min-h-11`, `rounded-lg border border-zinc-200 bg-white shadow-sm` ตรงกับ card pattern ที่ใช้อยู่ทุกที่ใน `UploadQueueList`/`LabelFileHistory` อยู่แล้ว)

Props ที่ต้องมี:
```ts
{
  id: string;                    // ใช้ทำ html id + aria-controls ไม่ชนกับของเดิม
  title: string;
  badge?: { count: number | null; tone?: BadgeTone; pulse?: boolean };
  // count=null → แสดงสถานะ "ไม่รู้จำนวน" (error/loading) ไม่ใช่ 0
  open: boolean;                 // controlled จาก parent (UploadPageClient)
  onToggle: () => void;
  children: ReactNode;
}
```

**กฎที่ขาดไม่ได้**: content area ต้องซ่อนด้วย `hidden={!open}` (native HTML attribute) **ห้าม** conditional-render (`{open && children}`) — เพราะต้องไม่ unmount ลูก (เหตุผลเต็มดู §2)

### 6.2 แก้ `components/domain/tiktok/UploadPageClient.tsx`

- เพิ่ม state: `const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({ upload: true, review: false, history: false })`
- อ่าน `useSearchParams().get("open")` **ครั้งเดียวตอน mount** (ผ่าน `useEffect` หรือ lazy initializer) → ถ้ามีค่าตรงกับ section id ใดๆ ให้ merge เป็น `true` เพิ่มจาก default (ไม่ไปปิดตัวอื่น) + ตั้ง flag ให้ scroll ไปหา section นั้นหลัง mount (เทียบ pattern `window.setTimeout(...scrollIntoView...,150)` ที่ `ContentEntryQueue.tsx` ใช้อยู่แล้ว)
- **ไม่ sync กลับ URL ตอนผู้ใช้คลิกเปิด/ปิดเอง** (ตั้งใจ ง่ายกว่า ไม่ต้องกังวล browser history สแปม — ดู §2 trade-off)
- ฟังก์ชันใหม่ `openSection(id, { scroll }?)` — ใช้ทั้งตอน auto-expand หลัง parse เสร็จ (`scroll` ไม่ส่ง = false) และตอนกดปุ่ม "จัดการในคิวรวมด้านล่าง" (`scroll: true`)
- ย้าย logic เดิม: `setReviewRefreshSignal((n) => n + 1)` ตอน parse เสร็จ (บรรทัด 141 ของเดิม) → เพิ่มเรียก `openSection("review")` ต่อจากมันทันที (ไม่ scroll)
- ลบ `<div id={PENDING_REVIEW_QUEUE_ANCHOR_ID}>` wrapper เดิม + ลิงก์ `<a href="#...">` เดิม (บรรทัด 270-277) → แทนด้วยปุ่มเรียก `openSection("review", { scroll: true })`
- ครอบ 3 ก้อนเดิมด้วย `<CollapsibleSection>` 3 ตัวตามตาราง §3 — เนื้อในแต่ละก้อน**คัดลอกของเดิมมาวางเฉยๆ ไม่แก้ JSX ภายใน**

### 6.3 แก้ `components/domain/tiktok/PendingReviewQueue.tsx`

เพิ่ม prop เดียว ไม่แก้ logic เดิมเลย:
```ts
onCountChange?: (count: number | null) => void;
// null = error state, เรียกหลัง load() เสร็จทุกครั้ง (ทั้ง success/error)
```
เรียก `onCountChange(rows.length)` ในสาขา success, `onCountChange(null)` ในสาขา error — ให้ `UploadPageClient` เก็บค่านี้ไว้ผ่านขึ้น badge ของ `CollapsibleSection` (เพราะ badge อยู่ที่ header ซึ่งอยู่ **นอก** content area ที่อาจถูก `hidden` — ต้องยกตัวเลขขึ้นมาไว้ parent)

### 6.4 ไม่แตะ (คงเดิม 100%)

`UploadDropzone.tsx` · `UploadQueueList.tsx` · `BatchSummaryCard.tsx` · `LabelFileHistory.tsx` · `LabelReviewQueueRow.tsx` · `LabelReasonSelect.tsx` · `ProvinceFixPanel.tsx` · `ProvinceSelect.tsx` — ทุกไฟล์นี้**ไม่มีเหตุผลต้องแก้แม้แต่บรรทัดเดียว** เพราะ accordion ทำงานแค่ที่ชั้น parent (ซ่อน/แสดง container) ไม่ยุ่งกับ props/behavior ของลูก

### 6.5 สรุปไฟล์ที่กระทบ

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `components/ui/CollapsibleSection.tsx` | **สร้างใหม่** |
| `components/domain/tiktok/UploadPageClient.tsx` | แก้ — เพิ่ม accordion state + query param + ครอบ 3 section |
| `components/domain/tiktok/PendingReviewQueue.tsx` | แก้เล็ก — เพิ่ม prop `onCountChange` |
| ไฟล์อื่นทั้งหมดใน `components/domain/tiktok/` ที่เกี่ยวกับหน้านี้ | **ไม่แตะ** |

---

## 7. 4 states ต่อ section (loading / error / empty / success)

ของเดิมแต่ละ component มี 4 state ของตัวเองอยู่แล้วครบ (loading=Skeleton, error=ErrorBanner+retry, empty=EmptyState, success=list) — **ไม่ต้องออกแบบใหม่** สิ่งที่ต้องเพิ่มคือ **state ของ badge ที่ header** ซึ่งเป็นของใหม่ล้วนๆ:

| Badge state | เมื่อไหร่ | แสดงยังไง |
|---|---|---|
| **Loading** | หน้าโหลดครั้งแรก ก่อน `getPendingLabelReviews()` ตอบกลับ | ไม่แสดงตัวเลข — แสดง dot/skeleton เล็กจางๆ แทน (ห้ามแสดง "0" เพราะยังไม่รู้จำนวนจริง จะหลอกเจ้าของว่าไม่มีงานค้าง) |
| **Error** | fetch ล้มเหลว | ไอคอนเตือนเล็กๆ สีเหลือง/เทา ไม่ใช่ตัวเลข (ไม่รู้จำนวนจริง ≠ 0) — กาง section ดู error message เต็มได้ |
| **Empty** (count=0) | โหลดสำเร็จ ไม่มีแถวค้าง | **ไม่แสดง badge เลย** (ตรงกับ pattern เดิมของ `PendingReviewQueue` ที่ต่อท้าย title เฉพาะเมื่อ `rows.length > 0`) |
| **Success** (count>0) | โหลดสำเร็จ มีแถวค้าง | ตัวเลขจริง tone `amber` (ตรงกับโทนที่ `REVIEW_STATUS_TONE` ใช้เป็นส่วนใหญ่อยู่แล้ว) + `pulse` ชั่วคราว 2-3 วิ เมื่อตัวเลขเพิ่งเปลี่ยน (parse เสร็จใหม่) |

Section "อัปโหลด" เอง badge ไม่ต้องมี loading/error state แยก (นับจาก `queue` state ใน React ที่มีอยู่แล้ว ไม่ต้อง fetch)
Section "ประวัติไฟล์" ไม่มี badge ในเวอร์ชันนี้ (ดูคำถามเปิด §9.3)

---

## 8. Accessibility checklist

- Header accordion เป็น native `<button type="button">` เต็มความกว้าง, ความสูง ≥ 44px (`min-h-11` ตาม pattern ที่ใช้ทั่วระบบ)
- `aria-expanded={open}` + `aria-controls={contentId}` ที่ปุ่ม, content area มี `role="region"` + `aria-labelledby` ชี้กลับไปปุ่ม
- Chevron icon เป็น `aria-hidden="true"` (ข้อความ title คือตัวที่ screen reader อ่าน ไม่ใช่ icon)
- Badge ตัวเลขต้องอ่านได้ด้วย screen reader ว่า "ค้าง 114 รายการ" ไม่ใช่แค่ "114" ลอยๆ — ใส่ `aria-label` ที่ตัว badge หรือ `sr-only` text เสริม
- Contrast ของ badge tone `amber` บนพื้นขาว ต้องผ่าน WCAG AA (ของเดิม `bg-amber-100 text-amber-800` ผ่านอยู่แล้วตามที่ใช้ทั่วระบบ — ใช้ class เดิมซ้ำ ไม่คิดสีใหม่)
- Keyboard: Tab ไปที่ปุ่ม header ได้ตามลำดับ DOM ปกติ, Enter/Space toggle ได้ (native `<button>` ได้ฟรีอยู่แล้ว ไม่ต้องเขียน key handler เพิ่ม)
- Focus ไม่หลุดหายตอน toggle (ของเดิม `hidden` ไม่ลบ DOM ออก — focus ยังอยู่ที่ปุ่มที่กดตามปกติ)

---

## 9. คำถามเปิด — ต้องเคาะก่อน implement

1. **Default ของ section "ตรวจ/แก้ไข" ควรพับหรือกาง ตอนเปิดหน้าครั้งแรกที่ไม่มี query param?** เอกสารนี้เสนอ **พับ** (เพื่อให้หน้าสั้นสุด ตรงกับปัญหาหลักที่เจ้าของบ่น) โดยชดเชยด้วย badge ตัวเลขที่เห็นได้ทันทีไม่ต้องกด — แต่ถ้าเจ้าของมองว่า "มีงานค้างทุกวัน กางไว้เลยจะได้ไม่ต้องกดทุกครั้ง" ให้บอกกลับ จะสลับ default เป็นกางได้ทันที (ไม่กระทบโครงอื่น)
2. **Auto-expand ตอน parse เสร็จ (ไม่ scroll) — เจ้าของอยากให้ section ขยายเองไหม หรืออยากแค่ badge เด้งเฉยๆ ไม่ขยายอัตโนมัติเลย?** เสนอแบบ auto-expand เพราะเจ้าของพูดเองว่า parse เสร็จต้อง "พาไปเห็นผล" แต่ไม่อยากบังคับสลับหน้า — ถ้ามองว่า section ขยายเองโดยไม่ได้สั่งยัง "เกินไป" ให้บอก จะปรับเป็น badge เด้งอย่างเดียวได้
3. **ต้องการ badge ที่ "ประวัติไฟล์" ไหม** (เช่น จำนวนไฟล์ที่ `parse_failed` ที่ควรสนใจ) — brief เดิมไม่ได้ขอ ไม่ได้ออกแบบให้ (กัน over-design) แต่ถ้าต้องการ เพิ่มได้โดยไม่กระทบโครงที่เหลือ
4. **Accordion state ต้องจำข้ามการ refresh หน้า/ปิดเปิดเบราว์เซอร์ไหม** (เช่น เปิด section ตรวจไว้ค้างคืน แล้วมาเปิดพรุ่งนี้ต้องยังกางอยู่) — เอกสารนี้ออกแบบว่า **ไม่จำ** (reset เป็น default ทุกครั้งที่โหลดหน้าใหม่ ยกเว้นมี query param) ถ้าต้องการจำข้าม session ต้องเพิ่ม localStorage (งานเพิ่มเล็กน้อย ไม่ใช่ migration)

**เจ้าของตอบแล้ว 4 ต.ค. 69**: ข้อ 1 = พับ (ตามเสนอ) · ข้อ 2 = auto-expand ไม่ scroll (ตามเสนอ) · การจัดกลุ่ม ProvinceFixPanel เข้า section เดียวกับคิวตรวจ (§3) = ยืนยันถูกต้อง ไม่ต้องแยก section ที่ 4 — ข้อ 3-4 (badge ประวัติไฟล์ / จำ state ข้าม reload) ยังไม่ถาม ปล่อยตามที่เอกสารเสนอ (ไม่มี badge / ไม่จำ state) ได้ ไม่บล็อกงาน

---

## 10. Regression checklist (QA ไล่กดหลัง implement)

ระดับ **M** ตาม `3j-qa-regression-map` (เฉพาะจุด — ไม่แตะ logic parse/match/apply, ไม่แตะ DB) — กดเฉพาะ flow ที่แก้ + ข้างเคียงที่ import มาวาง ไม่ต้องกดทั้งระบบ TikTok Ops

1. โหลด `/tiktok/upload` ครั้งแรก ไม่มี query param → section "อัปโหลด" กาง, "ตรวจ/แก้ไข" และ "ประวัติไฟล์" พับตามดีฟอลต์ที่เคาะกันไว้ (§9.1) — badge ตัวเลขค้างตรงกับจำนวนจริงใน DB (เทียบกับเปิดคิวตรวจแบบเก่าก่อน merge)
2. ลากไฟล์ PDF ใหม่ → คิวอัปโหลดแสดงสถานะถูกต้องทุก step (เตรียม/อัป/อ่าน) เหมือนก่อนแก้ทุกจุด — parse เสร็จ → badge ตรวจ/แก้ไข ขยับเลขทันที + (ตามมติ §9.2) section ขยายแบบไม่กระโดดจอ
3. ลากไฟล์ที่สองต่อทันทีหลังไฟล์แรก parse เสร็จ โดยไม่แตะ accordion เลย → ไฟล์ที่สองเข้าคิว/ประมวลผลได้ปกติ ไม่ติดขัดจาก section อื่นที่เพิ่ง auto-expand
4. กดลิงก์ "จัดการในคิวรวมด้านล่าง" จาก `BatchSummaryCard` → section "ตรวจ/แก้ไข" เปิด + เลื่อนจอไปจุดนั้นจริง
5. **(สำคัญสุด)** เปิด section "ตรวจ/แก้ไข" → กรอกจังหวัด/เหตุผล/หมายเหตุในแถวใดแถวหนึ่งโดยไม่กดบันทึก → พับ section นั้น → กางกลับมาใหม่ → ค่าที่กรอกไว้ต้อง**ยังอยู่เหมือนเดิมทุกตัว** (ไม่ reset)
6. ทำซ้ำข้อ 5 แต่สลับไปเปิด/ปิด section "ประวัติไฟล์" คั่นกลาง (ไม่แตะ section ตรวจเลย) → กลับมาที่ฟอร์มเดิม ค่ายังอยู่
7. กดยืนยันจังหวัดในแถวที่กรอกไว้ → แถวหายจากคิวตามปกติ (`onResolved`) + badge ลดลงถูกต้อง — behavior การยืนยัน/ข้าม/ย้อนกลับเหมือนเดิมทุกจุด (ไม่แก้ `LabelReviewQueueRow`)
8. เข้า `/tiktok/upload?open=review` ตรงๆ → section ตรวจเปิดอยู่ตั้งแต่โหลด + จอเลื่อนไปจุดนั้นอัตโนมัติ
9. กด "อ่านใหม่" ในประวัติไฟล์ (ไม่ว่า section ประวัติไฟล์เปิดหรือพับ) → toast ขึ้นถูกต้อง, badge ตรวจ/แก้ไข อัปเดตตามจำนวนจริงหลัง re-parse (ตรวจว่า `reviewRefreshSignal` ยังทำงานเหมือนเดิม)
10. ปิด `canEdit=false` (jัง login เป็น staff) → accordion เปิด/ปิดได้ปกติไม่ผูกสิทธิ์ แต่ปุ่มบันทึก/ยืนยัน/ย้อนกลับภายในยัง disabled เหมือนเดิมทุกจุด
11. ตรวจ DOM ด้วย devtools → ไม่มี `id` ซ้ำกันในหน้า (เช็ค id ใหม่ของ `CollapsibleSection` ไม่ชนกับของเดิมที่เหลืออยู่)
12. เปิดจอมือถือ (~375px) → ปุ่ม header ทุก section กดง่าย ไม่ล้น, ตัวเลข badge ไม่ถูกตัดขอบ
13. Keyboard-only: Tab ไล่ถึงปุ่ม header ทั้ง 3 ได้ตามลำดับ, Enter/Space toggle ได้, `aria-expanded` ถูกต้องตามสถานะจริง (เช็คด้วย devtools accessibility tree)
14. เปิด Network tab → ยืนยันว่า toggle accordion เปิด/ปิด **ไม่ยิง request ใหม่** (ข้อมูลที่โหลดไว้แล้วไม่หายไปไหน ไม่ fetch ซ้ำ) — ถ้าเห็น request ซ้ำแปลว่ามีจุดไหน conditional-unmount หลุดมา ต้องตีกลับ
15. สลับไปแท็บอื่นของ `TikTokSubNav` (แดชบอร์ด/จดไลฟ์) แล้วกลับมา "อัปโหลด" → accordion reset เป็น default ตามปกติ (คาดหวังแบบนี้ ไม่ใช่บั๊ก — เพราะเป็นการเปลี่ยน route จริงของ Next.js)

---

## 11. สรุปสำหรับ frontend-dev (ลำดับทำ)

1. สร้าง `components/ui/CollapsibleSection.tsx` ตามสเปค §6.1 — ทดสอบแยกตัวก่อนด้วย section เปล่าๆ 1-2 อัน (เช็ค `hidden` ไม่ unmount จริง โดยใส่ `useState` ทดสอบในลูก)
2. เพิ่ม `onCountChange` ให้ `PendingReviewQueue.tsx` (§6.3) — การเปลี่ยนแปลงเดียวที่แตะไฟล์โดเมนเดิม
3. ปรับ `UploadPageClient.tsx` ตาม §6.2 — ย้าย 3 ก้อนเดิมเข้า `CollapsibleSection` โดย **cut-paste JSX เดิมตรงๆ ไม่แก้ไข logic ภายใน**
4. เปลี่ยนปุ่ม "จัดการในคิวรวมด้านล่าง" จาก `<a href>` เป็นปุ่มเรียก `openSection("review", {scroll:true})`
5. เพิ่ม query param read-once + scroll-on-mount
6. รัน regression checklist §10 ทั้งหมดก่อนขอ QA ไล่กดจริง

**ถ้าพบว่า requirement ในเอกสารนี้สั่งผิดหรือมีช่องที่ตัดสินใจเองเกินขอบเขต (เช่น การรวม `ProvinceFixPanel` เข้า section "ตรวจ/แก้ไข" ใน §3) ให้บอกกลับทันทีก่อนลงมือ — ยังไม่เคาะกับเจ้าของจริงในจุดนั้น เป็นการตีความจากคำพูดเจ้าของเท่านั้น**

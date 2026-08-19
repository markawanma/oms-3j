# UX Design — Ad Copilot → ปฏิทินการตลาด → รายละเอียด content/คลิป

> ux-ui (Padmé) · 2026-08-19 · เฟสวางแผน (ยังไม่ implement)
> อิงของเดิม: `app/(dashboard)/marketing/copilot`, `app/(dashboard)/marketing/calendar` (0034),
> `analytics.campaign / campaign_step / step_artifact / step_gate` (0049, 0053),
> `docs/3j-jewelry/marketing/campaign-playbook-taxonomy.md` (CMO)
> ส่งต่อ: architect (data model), frontend-dev (implement)

---

## 0. สิ่งที่เจอในระบบ + ผลต่อ design (อ่านก่อนทุกอย่าง)

1. **`/marketing/calendar` วันนี้ ≠ สิ่งที่เจ้าของขอ.** หน้าเดิม (0034) ผูกกับ `analytics.campaign_calendar` — ตาราง reference เทศกาล/มหกรรมทั้งปี (global, ไม่มี shop_id), **read-only**, ไม่มีคลิก ไม่มี action ไม่มี content แนบ มันคือ "reminder ล่วงหน้า" ไม่ใช่ "task calendar"
   เจ้าของขอ **day grid ที่คลิกได้ + ทำ content ได้ + ผูกกับงานที่อนุมัติจาก Ad Copilot** — นี่คือ data source คนละตัว: `analytics.campaign_step` (0049, มี `resolved_start/resolved_end` คำนวณจาก `anchor_date + offset` อยู่แล้ว) ตัวนี้ต่างหากที่ต้องเอามาขึ้นปฏิทิน
   → **ข้อสรุป**: ไม่ทิ้ง 0034 (ยังมีประโยชน์เป็น long-range look-ahead) แต่ไม่ยัดสองอย่างนี้ปนกันในมุมมองเดียว — ดู §6

2. **"อนุมัติ" ใน RecoList ตอนนี้ไม่ได้สร้างงานอะไรเลย** — กด approve = แค่ `UPDATE mkt_reco_decision.status='approved'` (log การตัดสินใจ) reco แถวหนึ่งมาจาก `v_marketing_reco` (view คำนวณสด, ไม่ persist) ไม่ใช่ทุก reco มี "วันที่ทำงาน" ในตัว:
   - มีวันในตัวเอง: `seasonal_calendar` (มี `event_date`)
   - ไม่มีวันในตัวเอง: `winback_at_risk`, `geo_focus`, `cac_vs_aov`, `live_targeting_brief`, `spend_missing`
   → "อนุมัติแล้วขึ้นปฏิทิน" ใช้ได้จริงเฉพาะ reco ที่แปลงเป็น **content/campaign** ได้ ไม่ใช่ reco ทุกใบ (ดูรายละเอียด §1, §8 คำถามที่ต้อง confirm)

3. **schema เดิมรองรับ "อนุมัติ → เป็นแผนในปฏิทิน" อยู่แล้วเกินครึ่ง** — `campaign_step.status` ('todo'→'scheduled') + `v_campaign_board` (resolved_start/end + effective_status) คือของที่ต้องใช้ ไม่ต้องสร้างตารางใหม่สำหรับ "งานที่มาจาก playbook" แต่ **ยังไม่มี UI สร้าง campaign/step ใหม่เลย** — 0049 comment บอกตรงๆว่า "read + tick-done only" การเขียน step ใหม่ (จาก reco หรือ manual) เป็นของที่ต้องเพิ่ม (write RPC ใหม่, ไม่ใช่แค่ UI)

4. **clip brief (hook/body/close + shot list) ยังไม่มีที่เก็บ.** `step_artifact.content_body` (0053) เป็น text ก้อนเดียว ใช้กับ broadcast script ได้ดี (อ่าน-คัดลอก-วาง) แต่ "สรุปคลิปที่ต้องถ่าย" ต้องการโครง (hook/body/close แยกช่อง + shot list ติ๊กได้ทีละช็อต) → text ก้อนเดียวพอสำหรับอ่าน แต่ไม่พอสำหรับ "ติ๊กเสร็จทีละช็อต" ตามที่เจ้าของขอ ต้องมี field โครงสร้างเพิ่ม (ดู §5)

5. **"1 Idea → 3 Hooks → 2 Executions"** — ผมหาเอกสารต้นทางในนี้ไม่เจอ (`content-master.md` ที่ taxonomy อ้างถึงไม่อยู่ใน repo ที่เข้าถึงได้) ตีความจากชื่อ framework ใน §5 แต่ **ต้อง validate กับเจ้าของว่าตีความถูกไหม** ก่อน finalize field

---

## 1. User flow

### 1A. อนุมัติ reco → ขึ้นปฏิทิน (auto)

```
[Ad Copilot] การ์ด reco (เช่น "อีก 25 วันถึง 9.9 Mega Sale")
   │
   ├─ reco แปลงเป็น content ได้ (มี campaign_type ที่ map ได้ — seasonal_calendar, winback_at_risk)
   │     กด "อนุมัติ"
   │       │
   │       ├─ reco มีวันที่ในตัว (seasonal_calendar มี event_date)
   │       │     → confirm sheet เล็ก: "สร้างแผน 9.9 Mega Sale ในปฏิทิน (9 ก.ย.) พร้อม 5 ขั้นตอนตามแบบ?"
   │       │       [ยืนยัน] → สร้าง campaign+step ทั้งชุดจาก template (taxonomy ชั้น2)
   │       │                  status ทุก step = 'scheduled', toast "สร้างแผนแล้ว" + ลิงก์ "ดูในปฏิทิน"
   │       │       [ยกเลิก] → กลับสถานะเดิม (ยังไม่อนุมัติ)
   │       │
   │       └─ reco ไม่มีวันที่ในตัว (winback_at_risk)
   │             → modal ถามวันก่อนเสมอ: "จะเริ่มแคมเปญ winback วันไหน" (date picker, default = วันนี้)
   │               [ยืนยัน] → สร้าง campaign (anchor_date = วันที่เลือก) + step ตาม template
   │               [ยกเลิก] → reco ยังเป็น pending (ไม่ approve เปล่าๆ — ป้องกัน "อนุมัติแล้วแต่หาไม่เจอในปฏิทิน")
   │
   └─ reco เป็น ad-tuning/note ล้วน (geo_focus, cac_vs_aov, live_targeting_brief, spend_missing)
         กด "อนุมัติ" → พฤติกรรมเดิมทุกอย่าง (แค่ log decision, ไม่ขึ้นปฏิทิน)
         ปุ่มเปลี่ยน label เป็น "รับทราบ" ไม่ใช่ "อนุมัติ" — กันเข้าใจผิดว่าจะมีงานโผล่ในปฏิทินแต่ไม่มี
```

### 1B. เพิ่มแผนเอง (manual)

```
[ปฏิทิน] ปุ่ม "+ เพิ่มแผน" (มุมขวาบน, sticky บนมือถือ)
   → ฟอร์มเดียว inline (ไม่ multi-step wizard — เจ้าของกรอกเอง ต้องเร็ว):
     - ชื่องาน (text, required)
     - วันที่ (date, required, default = วันที่กำลังดูอยู่)
     - ประเภท content (dropdown: broadcast / คลิปสั้น / live / โพสต์ — ใช้ artifact_type เดิม)
     - ผูกกับแคมเปญ (dropdown "ไม่ผูก" default, หรือเลือกแคมเปญที่มีอยู่ — optional)
   [บันทึก] → ขึ้นปฏิทินทันที เป็น step เดี่ยว status='todo', trigger_kind='manual'
   [ยกเลิก] → ปิดฟอร์ม ไม่บันทึก
```

### 1C. คลิกงานในปฏิทิน → ทำ content

```
[ปฏิทิน วันนั้น] คลิกงาน → หน้ารายละเอียด (full-page, deep-linkable)
   → อ่านรายละเอียด (แคมเปญแม่/สถานะ/กลุ่มเป้าหมาย)
   → ถ้ามี artifact ประเภทคลิป → เห็น clip brief (idea/hooks/sections/shot list)
   → แก้/เติมเนื้อหา (เจ้าของพิมพ์ทับ field ว่าง)
   → ติ๊กช็อตที่ถ่ายแล้วทีละอัน / ติ๊ก artifact เสร็จทั้งชิ้น (ของเดิม, reuse)
   → ปุ่ม "กลับปฏิทิน" (breadcrumb ชัด ไม่ dead-end)
```

Error/edge path: กด "อนุมัติ" แล้ว network fail → toast error, reco กลับสถานะ pending (ไม่ค้างสถานะกำกวม) · เพิ่มแผนเองแล้ววันที่ซ้ำกับงานอื่นในวันนั้น → ไม่ block (วันเดียวมีหลายงานได้ตามปกติ) · ลบ/แก้วันที่ของงานที่มาจาก reco → out of scope เฟสนี้ (ดู §8 คำถาม 3)

---

## 2. หน้าปฏิทิน — layout

### สรุปการตัดสินใจ: **Day Agenda เป็น default, ไม่ใช่ month grid**

เหตุผล: เจ้าของพูดเองว่า "เปิดมาเห็นเลยว่าวันนี้มีงานอะไรบ้าง" — นี่คือ requirement สำหรับ "วันนี้" ไม่ใช่ "ภาพรวมเดือน" month-grid ตัวเต็ม (7 คอลัมน์ x 5 แถว) บนจอมือถือ 375px กว้าง จะเหลือพื้นที่ต่อวันแค่ ~45px — พอใส่ dot ได้ แต่พอคลิกแล้วต้อง "เห็นรายละเอียด" อีกที (2 ขั้นกว่าจะถึงเนื้อหา) Day Agenda ให้เนื้อหาในขั้นเดียว ตรงกับที่ขอ

**โครง (mobile, default view):**
```
┌─────────────────────────────────┐
│ ปฏิทินการตลาด          [+ เพิ่มแผน]│  ← h1 + primary action เดียว
├─────────────────────────────────┤
│ ◀  พ 19   พฤ 20   ศ 21  ▶       │  ← date strip เลื่อนได้ 7 วัน, วันนี้ไฮไลต์
│    ●2      ●1       (ว่าง)      │     (dot = จำนวนงาน, ไม่มี dot = ว่าง)
│  [วันนี้]                        │  ← quick jump กลับวันนี้ (โผล่เมื่อเลื่อนออกจากวันนี้)
├─────────────────────────────────┤
│ พฤหัสบดี 20 สิงหาคม              │  ← หัวข้อวันที่กำลังดู
│ ┌───────────────────────────┐   │
│ │ Teaser 9.9         [scheduled]│  ← task card (จาก CampaignBoard StepCard pattern)
│ │ 9.9 Silver Event · all_followers│
│ │ content 1/3                │   │
│ └───────────────────────────┘   │
│ ┌───────────────────────────┐   │
│ │ ไลฟ์ประจำวันพฤหัส   [active]│   │
│ │ live_promo · TikTok        │   │
│ └───────────────────────────┘   │
│                                   │
│ [ดูเป็นเดือน]                    │  ← secondary, เปิด month grid overlay
└─────────────────────────────────┘
```

**Desktop (≥1024px):** master-detail 2 คอลัมน์ — ซ้าย mini-month calendar ถาวร (dot ต่อวัน, คลิกเปลี่ยนวันที่ดู) + ขวา agenda ของวันที่เลือก (list เดียวกับ mobile แต่กว้างขึ้น เห็น task card 2 คอลัมน์ได้ถ้าจำนวนงานเยอะ) ไม่ทำ full month-grid-with-inline-cards แบบ Google Calendar desktop เต็มรูปแบบ — เกิน scope ที่ขอ (เจ้าของขอ "day grid" ไม่ใช่ "month grid ที่แก้ inline ได้") เก็บไว้เป็น phase ถัดไปถ้าจำนวนงาน/เดือนเพิ่มจนต้องดูภาพกว้างจริง

**Month overlay (ทั้ง mobile/desktop, กดปุ่ม "ดูเป็นเดือน"):** grid มาตรฐาน 7×N, ต่อวันแสดง count chip เท่านั้น (ไม่ต้องใส่ชื่องาน — ที่แคบเกิน) คลิกวัน → ปิด overlay + jump agenda ไปวันนั้น เป็น navigator ไม่ใช่ editor

**วันนี้ไฮไลต์**: พื้นหลัง primary-50 + ตัวเลขวันสีแดงตัวหนา (#a2191d) ในทั้ง date strip และ month overlay — ใช้ token เดียวกับที่ dashboard ใช้อยู่แล้ว (ไม่คิดสีใหม่)

**วันที่มีงาน**: dot สีเทาเข้ม (มีงาน todo/scheduled) → เปลี่ยนเป็น dot สีแดงเมื่อมีงาน `blocked`/`waiting_data` ที่วันนั้น (ให้รู้ทันทีว่าต้องแก้อะไรก่อนถึงวัน) — reuse โทนจาก `STATUS_TONE` ใน CampaignBoard

---

## 3. หน้า/panel รายละเอียดงาน

Route: full-page `/marketing/calendar/[stepId]` (ไม่ทำ modal — เนื้อหายาว มี script+shot list+form แก้ ยัดใน modal จะ scroll ซ้อน scroll บนมือถือ และตัด deep-link ไม่ได้ ซึ่งมีประโยชน์จริง: แชร์ลิงก์ให้ copywriter อ่าน script ตรงงานได้เลย)

**โครงสร้างข้อมูลที่โชว์ (บนลงล่าง ตามลำดับความสำคัญที่เจ้าของถามจริง):**

1. **หัวเรื่อง** — ชื่องาน (step_kind label) + breadcrumb กลับปฏิทิน
2. **บริบท** — แคมเปญแม่ (ชื่อ + ลิงก์ไป CampaignBoard ถ้าอยากดูภาพรวม step อื่น), วันที่/countdown, ประเภท (broadcast/คลิป/live/โพสต์ — มาจาก artifact_type ของ artifact แรก หรือ step_kind ถ้าไม่มี artifact), สถานะ (Badge เดิม, STATUS_TONE), กลุ่มเป้าหมาย (audience_segment + live count — reuse จาก StepCard)
3. **เนื้อหาที่ต้องทำ** (ต่อ artifact, เหมือน CampaignBoard checklist แต่ขยายเต็มหน้าไม่ต้อง expand):
   - artifact ที่เป็น script (broadcast/dm) → โชว์ content_body เต็ม + ปุ่มคัดลอก (ของเดิม)
   - artifact ที่เป็นคลิป (short_form_clip/live_highlight_clip) → **clip brief panel** (ดู §5)
   - artifact อื่น (teaser_image/cta_button_flex/parcel_card ฯลฯ) → checklist ธรรมดา (ของเดิม)
4. **Gate ที่ต้องผ่าน** (ถ้ามี) — ของเดิม (ปุ่ม "ผ่าน: ...")
5. **Action bar ล่างสุด (sticky บนมือถือ)** — ปุ่มเดียวเด่น: "ทำเครื่องหมายเสร็จ" (ต่อ artifact ที่กำลังโฟกัส) ปุ่มรอง: "แก้ไข" (เปิด field ให้พิมพ์ทับ)

---

## 4. Empty / Loading / Error states

| Screen | Loading | Empty | Error | Success |
|---|---|---|---|---|
| ปฏิทิน (agenda วันที่เลือก) | Skeleton date strip + 2-3 skeleton card (`h-20`, pattern เดียวกับ `calendar/loading.tsx` เดิม) | "วันนี้ยังไม่มีงานการตลาด" + ปุ่ม "+ เพิ่มแผน" เป็น primary action ใน empty state เอง (ไม่ใช่แค่ mascot เฉยๆ — เจ้าของกดต่อได้ทันที) | `ErrorState` เดิม + ปุ่ม "ลองใหม่" | agenda list, วันนี้ไฮไลต์ |
| Month overlay | Skeleton grid (7×N ช่องเทา) | ไม่มี empty กรณีนี้ (grid โชว์เดือนเสมอ แค่ไม่มี dot) | ใช้ error เดียวกับ agenda (ถ้า fetch เดือนพัง ปิด overlay กลับ agenda + toast) | grid + dot/count |
| รายละเอียดงาน | Skeleton header + skeleton content block | ไม่ใช้ (งานที่ไม่มีอยู่จริง = 404 → "ไม่พบงานนี้ อาจถูกลบไปแล้ว" + ปุ่มกลับปฏิทิน ไม่ใช่ EmptyState มาตรฐาน) | `ErrorState` เดิม | เนื้อหาเต็มตาม §3 |
| เพิ่มแผนเอง (ฟอร์ม) | ปุ่ม "บันทึก" → `loading` prop ของ `Button` เดิม (ของมีอยู่แล้ว) | n/a (ฟอร์มว่างคือ initial state ปกติ ไม่ใช่ empty state) | inline field error (ชื่องานว่าง/วันที่ไม่ถูกต้อง) + toast ถ้า RPC fail | ปิดฟอร์ม + toast "เพิ่มแผนแล้ว" + งานใหม่โผล่ใน agenda ทันที (optimistic หรือ refetch) |
| อนุมัติ reco → สร้างปฏิทิน | ปุ่ม "อนุมัติ" → loading (ของเดิมมี `busy` state อยู่แล้ว) | n/a | toast error + reco กลับ pending (ตาม §1A) | toast "สร้างแผนแล้ว" + ลิงก์ "ดูในปฏิทิน" (ไป agenda วันนั้นเลย ไม่ใช่แค่ toast เฉยๆ) |

**จุดที่ mobile ต้องระวังเป็นพิเศษ:**
- Date strip ต้องเป็น horizontal scroll + swipe ได้ (ไม่ใช่ปุ่ม ◀▶ อย่างเดียว) — เจ้าของนิ้วโป้งกดปุ่มเล็กๆ ซ้ำๆ 7 ครั้งเพื่อดูสัปดาห์หน้าไม่โอเค
- Clip brief บนมือถือยาวมาก (idea+3 hooks+sections+shot list) → **ต้อง collapse ต่อ section เป็น default** (accordion เหมือน `prep_note_th` ใน CampaignCalendar เดิมที่ใช้ `<details>`) ไม่ยัดเปิดหมดทีเดียว
- ปุ่ม "+ เพิ่มแผน" ต้อง sticky/fixed ไม่จมหายตอน scroll agenda ยาว (touch target ≥44px ตาม mandate)
- ฟอร์ม "เพิ่มแผนเอง" บนมือถือ: date picker ต้องเป็น native `<input type="date">` ไม่ custom picker (custom calendar picker บนคีย์บอร์ดมือถือมักพังเรื่อง viewport)
- คัดลอกสคริปต์/shot list บนมือถือ: ปุ่ม "คัดลอก" ต่อ section ย่อยได้ (ไม่ใช่แค่คัดลอกทั้งก้อน) — ถ่ายคลิปจริงมักอ่านทีละ hook/body/close ไม่ใช่แปะรวด

---

## 5. โครง "Clip Brief" — template

ตีความ "1 Idea → 3 Hooks → 2 Executions" จากชื่อ (**ต้อง validate กับเจ้าของ** — ดู §8): 1 ไอเดียคอนเทนต์ตั้งต้น แตกเป็น 3 hook ทางเลือก (มุมเปิดต่างกัน) แล้วแต่ละ hook เลือกไปถ่ายจริงได้ 2 แบบการตัด (execution: เช่น เน้นสินค้า vs เน้นคนพูด)

**Field ต่อ 1 clip brief (ผูกกับ 1 `step_artifact` ที่ artifact_type ∈ {short_form_clip, live_highlight_clip}):**

| กลุ่ม | field | ชนิด | หมายเหตุ |
|---|---|---|---|
| **Idea** | `idea` | text (สั้น 1-2 บรรทัด) | แก่นคอนเทนต์ตั้งต้น เช่น "เงินแท้ 925 ไม่แพ้ผิว vs เครื่องประดับชุบ" |
| **Hooks** | `hooks[]` (3 ช่อง) | text ต่อช่อง | 3 มุมเปิดให้เลือก แต่ละอันคือประโยคแรก 3-5 วินาที |
| | `chosen_hook_index` | 0/1/2/null | hook ที่ตัดสินใจถ่ายจริง — null จนกว่าจะเลือก (อย่า default=0 เงียบๆ เพราะดูเหมือนเลือกแล้วทั้งที่ยังไม่ได้ตัดสินใจ) |
| **Script ต่อช่วง** | `sections[]` = {part: hook\|body\|close, script, shot, duration_sec} | array 3 แถวคงที่ | `script` = พูดอะไร, `shot` = มุมกล้อง/ท่า/ของประกอบฉาก แยกจากคำพูด (เจ้าของขอ "สคริปต์แต่ละช่วง" ชัดเจน — ต้องแยก 3 แถว ไม่ใช่ text ก้อนเดียว) `close.script` ต้องรวม CTA เสมอ (ไม่แยก field CTA ต่างหาก — CTA คือส่วนหนึ่งของ close ตาม funnel เดิมที่ระบบใช้อยู่แล้ว เช่น "[ปุ่ม CTA: กดรับสิทธิ์ 9.9]" ใน broadcast script) |
| **Executions** | `executions[]` (2 ช่อง) | text ต่อช่อง | แนวทางตัด 2 แบบ เช่น "ตัดเน้นสินค้าโคลสอัพ" / "ตัดเน้นหน้าคนพูดเล่าเรื่อง" — เลือกอันที่ถ่ายจริงด้วย field เดียวกับ pattern `chosen_hook_index` |
| **Shot list** | `shot_list[]` = {label, done} | array, เพิ่ม/ลบได้ | รายการช็อตที่ต้องถ่ายจริง ติ๊กเสร็จทีละอัน (นี่คือของที่เจ้าของขอ "สรุปคลิปที่ต้องถ่าย" ตรงตัว — ต้องติ๊กได้ ไม่ใช่แค่อ่าน) |

**Data implication ที่ต้องส่ง architect ตัดสิน (ไม่ใช่ของ ux-ui ฟันธงเอง):** เก็บเป็น `jsonb` column ใหม่บน `step_artifact` (เช่น `clip_brief jsonb`) แยกจาก `content_body` (text) ที่ใช้กับ broadcast/dm scripts อยู่แล้ว — เหตุผล: `content_body` เป็น "อ่าน+คัดลอก" (ของเดิมพอ) ส่วน clip brief ต้องการ "ติ๊กทีละช็อต" ซึ่งต้อง query/update sub-field ได้ (jsonb) เขียน text ก้อนเดียวจะทำ "ติ๊กช็อตที่ 2 จาก 5" ไม่ได้โดยไม่ parse string เอง — เป็น anti-pattern

---

## 6. ต่อยอด 0034 หรือสร้างใหม่?

**ตัดสินใจ: ต่อยอด route `/marketing/calendar` เดิม แต่ยกเครื่อง page เป็น 2 แท็บ ไม่สร้างหน้าใหม่แยก**

```
/marketing/calendar
  แท็บ 1 "แผนงาน" (ใหม่, default) — Day Agenda ตาม §2/§3 ผูก analytics.v_campaign_board
  แท็บ 2 "เทศกาลทั้งปี" (ของเดิม 0034, แทบไม่แตะ) — CampaignCalendar component เดิม 100%
```

**เหตุผล:**
- URL เดิมคงที่ — ไม่ต้องแก้ nav (`MarketingSubNav`), ไม่มี route ใหม่ให้คนงงว่า "ปฏิทิน" อยู่ตรงไหนของ 2 เมนู
- Component `CampaignCalendar` (0034) เขียนดีอยู่แล้ว ไม่มีเหตุผลทิ้ง — มันตอบคำถามคนละแบบกับที่เจ้าของขอใหม่ (long-range "อีกกี่วันถึงเทศกาล" vs short-range "วันนี้ต้องทำอะไร") ทั้งสองมีประโยชน์คนละจังหวะการใช้งาน ไม่ควร merge เป็น view เดียวเพราะ data shape ต่างกันจริง (reference table ไม่มี action vs actionable task)
- Trade-off: เพิ่ม 1 คลิก (สลับแท็บ) เพื่อดูเทศกาล แลกกับความชัดว่า "แท็บแผนงาน" คือของที่เจ้าของเปิดมาเจอทันที (default) — ยอมรับได้เพราะเทศกาลเป็นข้อมูล "ดูเป็นครั้งคราว" ไม่ใช่ของที่เปิดทุกวัน (reco จาก seasonal event ไปโผล่ที่ Ad Copilot อยู่แล้วตอนใกล้ถึงวัน — จุดนี้มี cross-link เดิมอยู่แล้ว "N รายการกำลังเตือนอยู่ที่ Ad Copilot")

---

## 7. Component breakdown (ส่งต่อ frontend-dev)

| Component | ใหม่/reuse | หน้าที่ |
|---|---|---|
| `CalendarPageTabs` | ใหม่ (บาง) | สลับแท็บ "แผนงาน" / "เทศกาลทั้งปี" — wrapper เท่านั้น ไม่มี logic |
| `SeasonalCalendarTab` | reuse 100% | คือ `CampaignCalendar` component เดิม ย้ายเข้าแท็บ 2 ไม่แก้โค้ดข้างใน |
| `DayAgenda` | ใหม่ | date strip + list ของ task card วันที่เลือก — โครงสร้าง state คล้าย `RecoList`/`CampaignBoard` (rows ในมือ + optimistic update) |
| `DateStrip` | ใหม่ | horizontal scroll 7 วัน + dot/count ต่อวัน + วันนี้ไฮไลต์ — แยก component ย่อยเพื่อ reuse ใน month overlay header ได้ |
| `MonthOverlay` | ใหม่ | grid navigator, คลิกวัน → callback ปิด overlay + set selected date |
| `AgendaTaskCard` | ใหม่ (ดัดแปลงจาก `StepCard` ใน `CampaignBoard.tsx`) | การ์ดสรุปงานใน agenda — ใช้ Badge/STATUS_TONE เดิม, ตัดส่วน checklist เต็มออก (แค่ preview "content 1/3") เพราะรายละเอียดเต็มอยู่หน้าแยก |
| `TaskDetailPage` (`/marketing/calendar/[stepId]`) | ใหม่ | ประกอบ header + artifact list (reuse ตรรกะ checklist จาก `StepCard`) + `ClipBriefPanel` + gate section (reuse จาก `CampaignBoard`) |
| `ClipBriefPanel` | ใหม่ | render/edit idea, hooks (radio เลือก chosen), sections (accordion hook/body/close), executions (radio เลือก), shot list (checklist เพิ่ม/ลบ/ติ๊ก) |
| `AddPlanForm` | ใหม่ | ฟอร์ม manual add (ชื่อ/วันที่/ประเภท/แคมเปญแม่ optional) — inline card ไม่ใช่ modal เต็มจอ (สั้นพอ) |
| `ApproveRecoConfirmSheet` | ใหม่ | bottom sheet (mobile) / dialog (desktop) — โชว์ preview "จะสร้าง N ขั้นตอนในปฏิทิน" + date picker เมื่อ reco ไม่มีวันในตัว |
| `Badge`, `EmptyState`, `ErrorState`, `Button`, `Toast`, `Skeleton`, `CopilotSection` | reuse ตรงตัว | ของเดิมทั้งหมด ไม่แก้ |

---

## 8. คำถามที่ต้อง confirm ก่อนส่งต่อ architect (ห้ามเดาต่อ)

1. **Reco ทุกใบ "อนุมัติ" ต้องขึ้นปฏิทินไหม หรือเฉพาะที่แปลงเป็น content ได้ (seasonal_calendar, winback_at_risk)?** ผมออกแบบสมมติฐานว่าเฉพาะ 2 กลุ่มนี้ (ดู §0.2) — ถ้าเจ้าของอยากให้ reco อื่น (geo_focus/cac_vs_aov/live_targeting_brief) ก็ขึ้นปฏิทินด้วย (เป็น one-off task ไม่มี step ชุด) ต้องออกแบบ flow เพิ่ม
2. **"อนุมัติ" seasonal/winback reco → auto-สร้าง step ครบชุดตาม taxonomy template เลยทันที หรือสร้างแค่ campaign เปล่าแล้วให้เจ้าของ "เพิ่ม step เอง" ทีละอัน?** งานเขียน (insert step ใหม่) ยังไม่มี RPC เลยตอนนี้ (0049 ออกแบบไว้แค่ read+tick) — auto-generate ทั้งชุดใช้งานง่ายกว่ามาก แต่เสี่ยง "สร้างงานที่เจ้าของไม่ได้อยากทำทุก step" (เช่น step 3 main_day ต้องมี CFO/COO gate ผ่านก่อน ถ้า auto สร้างมาทั้งชุดจะดู blocked เต็มไปหมด)
3. **แก้ไข/ลบงานที่ระบบสร้างจาก reco ได้ไหม** (เช่น เลื่อนวัน, ลบ step ที่ไม่ต้องการ)? เฟสนี้ผมออกแบบไว้แค่ "แก้เนื้อหา artifact" (script/clip brief) ไม่รวมแก้วันที่/ลบ step — ถ้าต้องการ เป็น scope เพิ่มที่ต้องมี RPC ใหม่
4. **Manual content plan ผูกกับแคมเปญเดิมได้ไหม (dropdown เลือก) หรือ standalone เสมอ?** ผมออกแบบเป็น optional (§1B) — ถ้า requirement จริงคือ "แยกขาดจาก playbook เสมอ" จะง่ายกว่า (ไม่ต้องมี dropdown, ไม่ต้อง join กับ campaign)
5. **ใครกรอก clip brief** — เจ้าของเองในหน้านี้, หรือ copywriter subagent ผลิตแล้วแปะเข้ามา (เหมือน broadcast script ที่ backfill จาก doc)? มีผลต่อว่าต้อง design "empty draft form ให้กรอกเอง" เต็มรูปแบบ หรือแค่ "read + ติ๊ก" เหมือน CampaignBoard ปัจจุบัน
6. **"1 Idea → 3 Hooks → 2 Executions"** — ขอเอกสาร/ตัวอย่างจริงของ framework นี้จากเจ้าของ (หรือ CMO) เพื่อ validate ว่า field ใน §5 ตรงกับที่ใช้จริงไหม ผมตีความจากชื่อเท่านั้น ยังไม่เห็นตัวอย่างจริง

---

## 9. สิ่งที่ตั้งใจไม่ออกแบบตอนนี้ (เผื่อไว้ ไม่ over-design)

- AI agent ต่อ CapCut — ไม่ design ตอนนี้ตามที่ระบุ แต่ field `shot_list[]` ใน clip brief (label + done) วางไว้ให้เป็น "input ที่ต่อยอดได้" ในอนาคต (ส่ง shot list เป็น payload ให้ agent) โดยไม่ต้องปรับ schema ใหม่ตอนนั้น — เป็น trade-off ที่ตั้งใจ (โครงสร้างเผื่อไว้เล็กน้อย ไม่ over-engineer เต็มรูป)
- Drag-drop เลื่อนวันงานในปฏิทิน — ไม่มี requirement ขอ ไม่ออกแบบ
- Multi-user assignment (มอบหมายงานให้คนอื่นทำ) — ระบบยังเป็น single-owner (ไม่มี auth จริงตาม note ปัจจุบัน) ไม่ออกแบบ

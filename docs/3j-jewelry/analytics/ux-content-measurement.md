# UX — ชั้นวัดผล content (3J Insight)

> ออกแบบ 25 ก.ย. 69 (Padmé) — ยังไม่มี implementation ห้ามถือเป็นของที่ทำแล้ว
> อ้างอิง: `docs/3j-jewelry/analytics/content-kpi-definition.md` (เอกสารชี้ขาด KPI) ·
> migrations 0145/0148/0149 (apply แล้วบน prod — เป็นสัญญาจริง ไม่ใช่แผน) ·
> component เดิม `components/domain/marketing/*`

---

## 0. อ่านก่อน — 3 เรื่องที่เปลี่ยนหน้าตาทั้งหมด ก่อนลงรายละเอียดหน้าจอ

### 0.1 สี `drive_live` (`#a2191d`) = สีแบรนด์ primary-600 เป๊ะ

ตรวจโค้ดจริงแล้ว: `bg-primary-600` (ปุ่ม primary, selected day ใน `MonthCalendar`, focus ring ทั้งระบบ) คือ
`#a2191d` — ตัวเดียวกับสี `drive_live` ที่ seed มาใน 0145 เป๊ะ ไม่ใช่ความบังเอิญที่มองข้ามได้

⇒ **ถ้าเอาสี content type ไปเป็นพื้นหลังเต็ม (solid fill) ที่ไหนก็ตาม** คนจะอ่าน `drive_live` เป็น
"ปุ่มที่กดได้/ถูกเลือกอยู่" แทนที่จะอ่านเป็น "ประเภทเนื้อหา" — ในเอกสารนี้แก้ด้วยกฎเดียว (§3):
**content type แสดงเป็น outline + dot เท่านั้น ห้าม solid fill แม้แต่ตัวเดียวในทั้ง 5 สี**

### 0.2 ตารางที่จะใช้ยังว่างสนิท (`content_post` = 0 แถว)

หน้าจอทุกหน้าที่ออกแบบในเอกสารนี้ **ต้องเปิดแล้วเจอ empty state จริง ไม่ใช่ mock** ทั้งวันแรกที่ deploy
และต่อเนื่องไปอีกหลายวันจนกว่าเจ้าของจะเริ่มวางลิงก์ครั้งแรก — ทุก wireframe ด้านล่างจึงออกแบบ empty state
ให้เท่ากับ "หน้าจอที่คนจะเห็นบ่อยที่สุดในช่วงแรก" ไม่ใช่สถานะรอง

### 0.3 `content_type_code` ของ `campaign_step` **ยังเขียนไม่ได้** — DB ไม่มี RPC

grep migrations แล้ว: 0145 เพิ่มคอลัมน์ `campaign_step.content_type_code` (nullable, backfill อัตโนมัติจาก
`step_kind` ไม่ได้เพราะ 0145 ไม่ได้ backfill คอลัมน์นี้เลย — มี backfill เฉพาะ `goal_kpi_code`) แต่ **ไม่มี RPC
ไหนเขียนคอลัมน์นี้ได้** (มีแค่ `content_post_upsert` ที่เขียน `content_post.content_type_code` ซึ่งเป็นคนละ
ตารางกัน)

⇒ โจทย์ถามว่า "เจ้าของตั้งประเภทให้งานในปฏิทินตรงไหน" — **คำตอบตรงไปตรงมาคือ: ยังตั้งไม่ได้ในรอบนี้**
เอกสารนี้จึงออกแบบเฉพาะจุดที่ตั้งได้จริง (ตอนวางลิงก์โพสต์ → `content_post.content_type_code` มี RPC รองรับ
แล้ว) และแสดง `campaign_step.content_type_code` แบบ **read-only เสมอ** (ว่างเปล่าทุกแถวจนกว่าจะมี migration
ใหม่เพิ่ม RPC) — ดู §7 คำถามที่ต้องตอบก่อน build

---

## 1. คิวกรอกตัวเลขรายวัน — ชิ้นที่สำคัญที่สุด

### 1.1 Route: `/marketing/content/entry` (หน้าใหม่ ไม่ nest ใต้ `/calendar`)

**เหตุผล**: `/marketing/calendar` คือ mental model "วางแผน" — เปิดดูเป็นระยะ ไม่รีบ
งานนี้คือ mental model "บันทึกประจำวันตอนดึก" — เปิด ทำ ปิด ภายใน 1 นาที คนละจังหวะความคิดกัน
ถ้าฝังเป็น tab ที่ 3 ของ `/marketing/calendar?tab=entry` จะเจือกับ `MonthCalendar`/`MonthTimeline` ที่โหลด
มาด้วยเสมอ (query เกินจำเป็นตอนดึกที่เน็ตอาจไม่ดี) และกดลึกขึ้น 1 ชั้น

เพิ่มเป็น tab ที่ 6 ใน `MarketingSubNav` (ไอคอน `ClipboardList`, label สั้น **"อ่านยอด"**) — แต่ระบุไว้ตรงนี้
ว่า **sub-nav ไม่ใช่ทางเข้าหลักที่ควรพึ่ง** ตอนดึกเจ้าของไม่ควรต้องกด hamburger → marketing → เลื่อนหา tab
ที่ 6 — หน้าแรกที่เข้าควร **bookmark ตรงได้** (ดู §1.5 empty state ข้อความแนะนำ "เพิ่มไปยังหน้าจอหลัก")
คำถามเปิดว่าเจ้าของเข้าทางไหนจริงอยู่ใน §7

### 1.2 โครงหน้า — 2 ส่วนเสมอ ไม่ใช่แค่ "คิว"

เหตุผลที่รวม 2 workflow ไว้หน้าเดียว: เจ้าของทำทั้งคู่ในช่วงเวลาเดียวกันตอนดึกหลังไลฟ์ —
(ก) โพสต์คลิปใหม่คืนนี้ → ต้องวางลิงก์ (โจทย์ข้อ 2 "โพสต์นอกแผน") และ
(ข) คลิปเก่าถึงรอบอ่านค่า → คิว T+1/T+3/T+7
แยกเป็นคนละหน้าจะบังคับสลับหน้า 2 ครั้งทุกคืน ขัดกับงบเวลา 1 นาที

```
┌──────────────────────────────────────┐
│ อ่านยอด content              [≡ เมนู] │
│ วันนี้ พฤหัสบดี 25 ก.ย. 69              │
├──────────────────────────────────────┤
│ [+ เพิ่มโพสต์ใหม่วันนี้]              │  ← (ก) เสมอ อยู่บนสุด ไม่ว่าคิวจะว่างไหม
├──────────────────────────────────────┤
│ ต้องอ่านวันนี้ · 2/5                   │  ← progress ของ (ข)
│ ┌────────────────────────────────┐   │
│ │ [T+1] ●ความรู้                  │   │  ← การ์ดที่ 1 (ดู §1.3)
│ │ ...                              │   │
│ └────────────────────────────────┘   │
│ ┌────────────────────────────────┐   │
│ │ ✓ บันทึกแล้ว — วิว 134 · บันทึก 1│  │  ← การ์ดที่ทำเสร็จ (collapsed)
│ └────────────────────────────────┘   │
│ ...                                    │
└──────────────────────────────────────┘
```

### 1.3 การ์ดกรอกตัวเลข 1 ใบ — 2 โหมด (กรอก → ทวน → ยืนยัน)

**โหมดกรอก** (default):

```
┌──────────────────────────────────────┐
│ 🕐 T+1 (อายุ 1-2 วัน)      ⚪ ความรู้   │  ← badge รอบ + ContentTypeChip (outline)
│ "สร้อยเงินทอยังไงครับ คุมพารา..."      │  ← caption_snapshot ตัดบรรทัดเดียว
│ 🔗 เปิดดูใน TikTok →                  │  ← <a target="_blank">, เปิดแอป TikTok/Studio
│                                        │
│ 👁 ยอดวิว        [___________] คน     │  inputmode="numeric"
│ ❤️ ถูกใจ         [___________] คน     │  enterkeyhint="next" → เลื่อนช่องถัดไป
│ 💬 คอมเมนต์      [___________] คน     │
│ 🔖 บันทึก        [___________] คน     │  ← สำคัญสุดตาม KPI doc แต่ "ไม่" ใช้สีเด่น
│                                        │     ในฟอร์มนี้ (เหตุผล §5.4) — ใช้แค่ 📌
│                                        │     ข้อความกำกับใต้ label "ตัวชี้วัดหลัก"
│ ↗️ แชร์          [___________] คน     │
│                                        │
│ ช่องไหนไม่รู้ เว้นว่างได้ — ไม่ต้องใส่ 0 │  ← เตือนถาวร ป้องกันบทเรียนแพงสุด
│                                        │
│         [    บันทึกโพสต์นี้    ]       │  disabled จนกว่าจะมี ≥1 ช่อง
└──────────────────────────────────────┘
```

**โหมดทวน** (หลังกด "บันทึกโพสต์นี้" — inline transform ในการ์ดเดิม ไม่เปิด modal ใหม่/ไม่เปลี่ยนหน้า):

```
┌──────────────────────────────────────┐
│ ทวนก่อนบันทึก — แก้ทีหลังไม่ได้         │
│ 👁 ยอดวิว        134                  │
│ ❤️ ถูกใจ         8                    │
│ 💬 คอมเมนต์      2                    │
│ 🔖 บันทึก        1                    │
│ ↗️ แชร์          — (ไม่ได้กรอก)        │
│                                        │
│   [ แก้ไข ]         [ ยืนยันบันทึก ]   │  secondary / primary
└──────────────────────────────────────┘
```

กด "ยืนยันบันทึก" → เรียก RPC จริง → สำเร็จ → การ์ด **collapse** เป็นแถบสรุป 1 บรรทัด (ตัวอย่างใน §1.2)
→ auto-scroll ไปการ์ดถัดไปที่ยังไม่เสร็จ → progress bar หัวหน้าขยับ (`2/5` → `3/5`)

ล้มเหลว (เน็ตหลุด/RPC error) → toast error สีแดง + **กลับไปโหมดทวน (ไม่ใช่โหมดกรอก)** ค่าที่พิมพ์ไม่หาย
กดยืนยันซ้ำได้ทันที ไม่ต้องพิมพ์ใหม่

### 1.4 กันข้อมูลหายตอนสลับแอป — localStorage draft ไม่ใช่ save-as-you-type ไป DB

**ทำไมไม่ยิง RPC ทุกตัวอักษร**: `content_post_metric_upsert` คำนวณ `is_regression` จากค่าที่ "ผสมแล้ว" ของ
วันนี้ (0148 §H1) — ยิงกลางคันด้วยเลขไม่ครบจะสร้างแถวชั่วคราวที่ไม่ตรงความตั้งใจ และกินโควตาเครือข่ายตอนเน็ต
มือถือตอนดึกที่อาจไม่เสถียร

**แทนด้วย**: local draft ผูกกับเครื่อง — key `content-entry-draft:{shopId}:{postId}:{todayTH}` เก็บ
`{view, like, comment, save, share}` ที่พิมพ์อยู่ (debounce onChange ~300ms) → โหลดหน้าใหม่ (สลับแอปกลับมา,
browser คืน memory, refresh) **restore ค่าก่อน render ฟอร์มเปล่า** ไม่ flash ค่าว่างแล้วเด้งมา → ล้าง draft
ทันทีที่ "ยืนยันบันทึก" สำเร็จ → cleanup draft ของวันเก่า (`todayTH` ไม่ตรงวันนี้) ตอน mount แบบ passive กัน
localStorage บวมสะสม

ไม่ใช้ URL query string เก็บ draft เพราะ 5 โพสต์ × 5 ช่อง ยาวเกิน practical และ "สลับแอปกลับมา" หมายถึง
เครื่องเดียวกันเสมอ (ไม่ใช่ cross-device) — localStorage ตรงโจทย์กว่า

### 1.5 State ครบ 4

| State | อะไรเกิด |
|---|---|
| **Loading** | Skeleton การ์ด 2-3 ใบ (grey block แทน input) ใต้ปุ่ม "+ เพิ่มโพสต์ใหม่" ที่ยังกดได้ทันที (ไม่ต้องรอคิวโหลดเสร็จก่อนวางลิงก์ได้) |
| **Empty (คิวว่าง — สถานะปกติที่จะเจอบ่อยสุด)** | `EmptyState` icon ✅ (`CheckCircle2`, ไม่ใช่ icon "ว่างเปล่า" ทั่วไปที่ดู error-like) — "วันนี้ไม่มีโพสต์ต้องอ่านค่า" / "ครบแล้ว กลับมาใหม่พรุ่งนี้" ปุ่ม "+ เพิ่มโพสต์ใหม่" ยังอยู่ด้านบนเสมอ (empty state ของ (ข) ไม่ทำให้ (ก) หายตาม) |
| **Error** | `ErrorState` มาตรฐาน + onRetry — ต้องมี fallback ให้วางลิงก์โพสต์ใหม่ได้แม้คิวอ่านค่าพัง (คนละ query กัน อย่าให้ query หนึ่งพังแล้วบล็อกอีกอันที่ไม่เกี่ยวข้อง) |
| **Success** | ตามที่ร่างไว้ §1.2/§1.3 — progress `X/5` + การ์ด collapse ทีละใบ |

---

## 2. ช่องวางลิงก์โพสต์

### 2.1 สองจุดตามโจทย์ — ทั้งคู่ผ่าน component เดียวกัน (`ContentPostLinkForm`)

**(a) ในแผน** — `/marketing/calendar/[stepId]`, ต่อท้าย `ArtifactEditor` ของทุก artifact ที่ "โพสต์ขึ้น
แพลตฟอร์มจริงได้" (`short_form_clip` / `live_highlight_clip` / `fb_post` — ไม่ใช่ `broadcast_script_line` /
`dm_script_1to1` / `parcel_card` ที่ไม่มีลิงก์สาธารณะ) เหมือน pattern ที่ `ClipBriefPanel` conditional
render ต่อจาก `ArtifactEditor` อยู่แล้ว:

```tsx
<ArtifactEditor artifact={a} />
{isClipArtifactType(a.artifactType) && <ClipBriefPanel ... />}
{isPostableArtifactType(a.artifactType) && (
  <ContentPostLinkForm artifactId={a.id} contentTypeDefault={step.contentTypeCode} existingPost={a.linkedPost} />
)}
```

`contentTypeDefault` = pre-fill จาก `campaign_step.content_type_code` ถ้ามี (แก้ได้ในฟอร์มนี้ — เขียนลง
`content_post.content_type_code` ไม่ใช่ `campaign_step`, ดู §0.3)

**(b) นอกแผน** — ส่วน "+ เพิ่มโพสต์ใหม่วันนี้" บนสุดของ `/marketing/content/entry` (§1.2) — ฟอร์มเดียวกัน
ไม่มี `artifactId` (`p_artifact_id = null` ตรงกับที่ DB ออกแบบให้ nullable ไว้ตั้งใจ, 0148 comment ยืนยัน
ชัดเจน: "ถ้าบังคับให้สร้างงานในปฏิทินก่อนถึงจะวางลิงก์ได้ ระบบจะถูกเลิกใช้ในสัปดาห์แรก")

### 2.2 ฟอร์ม

```
แพลตฟอร์ม   [ TikTok ▾ ]        ← default TikTok (83% ของออเดอร์)
ลิงก์โพสต์  [ https://...      ]  type="url" inputmode="url"
ประเภท      [ ⚪ ความรู้      ▾ ]  ← ไม่บังคับ, ContentTypeChip เป็น option label
วันที่โพสต์ [ วันนี้ 21:45   ▾ ]  ← default = ตอนนี้ (เพิ่งโพสต์จริง) ปรับย้อนหลังได้
              [ ยกเลิก ] [ บันทึก ]
```

**วางแล้วเห็นอะไรยืนยันว่าถูกตัวจริง**: **ไม่ fetch preview/metadata จากลิงก์เด็ดขาด** (แม้จะเป็นแค่
thumbnail/title ก็ไม่เสนอ — เข้าข่าย "ดึงข้อมูลอัตโนมัติจากลิงก์" ที่โจทย์ห้าม และเพิ่มความเสี่ยง ToS โดยไม่
จำเป็น) แทนด้วยวิธีที่ปลอดภัยกว่า: หลังบันทึกสำเร็จ แสดง URL ที่เพิ่งบันทึกเป็น **ลิงก์กดเปิดได้เอง**
(`target="_blank"`) + platform badge + เวลาที่บันทึก — เจ้าของกดเปิดเช็คเองได้ทันทีถ้าไม่มั่นใจ ไม่ต้องเชื่อ
ระบบเฉยๆ

### 2.3 🔴 ไม่รองรับ "แก้ไขลิงก์" ในรอบนี้ — เหตุผลเป็นเรื่อง data integrity ไม่ใช่ UX เฉยๆ

`content_post` unique บน `(shop_id, platform, external_id)` — ถ้า UI ตัดสินใจให้ `external_id` มาจาก URL
(ดู §7 คำถามเปิดเรื่อง normalize) แล้วเจ้าของแก้ URL หลังบันทึกไปแล้ว (พิมพ์ผิด/วางลิงก์ผิดคลิป) จะกลายเป็น
**สร้างโพสต์ใหม่แยก ไม่ใช่แก้ของเดิม** — metric เก่าที่ผูกกับ `post_id` เดิมค้างอยู่กับ "โพสต์ผี" ไม่ตามมา
ด้วย

⇒ รอบนี้ฟอร์ม "แก้ไข" ของโพสต์ที่บันทึกแล้วแก้ได้เฉพาะ **ประเภทเนื้อหา** (`content_type_code`, null-preserving
ปลอดภัยตาม 0148) — **ช่อง URL เป็น read-only หลังบันทึกครั้งแรก** ถ้าพิมพ์ผิดจริงๆ ให้เรียก
`content_post_set_status(..., 'deleted')` ปิดของเก่าแล้ววางใหม่ (เป็น edge case ที่ไม่ควรเกิดบ่อย ไม่คุ้ม
ความซับซ้อนของ UI ที่รองรับ "แก้ URL แบบไม่ทำลาย metric")

### 2.4 State ครบ 4 (แชร์ layout เดียวกันทั้ง (a)/(b))

| State | อะไรเกิด |
|---|---|
| Loading | ปุ่ม "+ เพิ่มโพสต์" กดได้ทันที ไม่ต้องรอ — ฟอร์มเป็น client-side ทั้งหมด ไม่ fetch อะไรก่อนเปิด |
| Empty (ยังไม่เคยวางลิงก์ให้ artifact นี้) | กล่อง dashed "+ วางลิงก์โพสต์" (pattern เดียวกับ `ClipBriefPanel`'s "ยังไม่มีโครงคลิป") |
| Error | toast error ใต้ฟอร์ม, ฟอร์มไม่ปิด ค่าที่กรอกไม่หาย (client state คงอยู่จนกว่าจะสำเร็จ) |
| Success | read-only card: URL คลิกได้ + platform badge + `ContentTypeChip` + "แก้ประเภท" ปุ่มเล็ก (ดู §2.3) |

---

## 3. สีประเภทบนปฏิทิน/บอร์ด

### 3.1 กฎเดียวที่คุมทุกจุด: **outline + dot เท่านั้น ห้าม solid fill**

```tsx
// ContentTypeChip.tsx — ตัวอย่างแนวทาง ไม่ใช่โค้ดสมบูรณ์
<span
  style={{ borderColor: hex }}
  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-zinc-700"
>
  <span style={{ backgroundColor: hex }} className="h-2 w-2 rounded-full" aria-hidden="true" />
  {labelTh}
</span>
```

Primary action / selected state ในระบบนี้ใช้ `bg-primary-600` solid fill เสมอ (ปุ่ม, selected day) —
content type ไม่ใช้ fill เลยแม้สักสี ⇒ ตาแยกสองระบบออกจากกันได้จาก **รูปทรง** (pill กลวง vs ปุ่มทึบ) ก่อน
จะต้องแยกจากสี ทำงานได้แม้กับ `drive_live` ที่สีชนกับ primary เป๊ะ

`Badge` component เดิม (tone-based, solid fill) **ไม่ใช้กับ content type** — คนละ vocabulary ตั้งใจ
(`Badge` = สถานะ, `ContentTypeChip` = ประเภท) วางคู่กันได้แต่ต้องแยกรูปทรงชัด

### 3.2 ตำแหน่งที่แสดง — ไม่ใช่ทุกที่

| จุด | แสดงไหม | เหตุผล |
|---|---|---|
| `MonthCalendar` grid (dot ต่อวัน) | **ไม่** | cell กว้าง 44px มี dot สถานะ (มีงาน/ติดเงื่อนไข) อยู่แล้ว ซึ่งตอบคำถาม "ต้องดูวันนี้ไหม" — สำคัญกว่าตอน scan ภาพรวมทั้งเดือน ใส่สีที่ 3 เข้าไปจะแน่นจนอ่านไม่ออกบนมือถือ |
| `AgendaTaskCard` / `StepCard` (`CampaignBoard`) | ✅ | มีพื้นที่พอ, เป็นจุดที่เจ้าของอ่านรายละเอียดทีละงานจริง |
| `[stepId]` header | ✅ + ป้าย "เดาจากชนิดงาน" ถ้า `goal_kpi_code_source`/แหล่งเทียบเท่าเป็น `auto_step_kind` | จุดเดียวที่มีพื้นที่อธิบายที่มา ป้องกันเข้าใจผิดว่าเจ้าของเป็นคนเลือกเอง |
| การ์ด content entry (§1.3) | ✅ (มาจาก `content_post.content_type_code`) | ช่วยจำว่ากำลังอ่านค่าคลิปประเภทไหน |

### 3.3 คำอธิบายสี (legend)

`<details>` แบบเดียวกับที่ใช้ทั่วระบบ (`CampaignCalendar`'s `prep_note_th`) — "ประเภทเนื้อหาคืออะไร"
วางไว้ที่หัว `CampaignBoard` section เปิดครั้งเดียวเห็นครบ 5 แถว dot+label ไม่ต้องอธิบายซ้ำทุกการ์ด

### 3.4 ตั้งประเภทให้งานในปฏิทิน — ยังทำไม่ได้ (ซ้ำ §0.3)

แสดง `ContentTypeChip` แบบ read-only เท่านั้นที่จุดใน §3.2 ว่างเปล่าทุกแถวจนกว่าจะมี RPC ใหม่ ไม่ออกแบบ
selector ให้แก้ค่านี้ในรอบนี้ (ข้อห้าม "ห้ามออกแบบฟีเจอร์ที่ DB ยังไม่รองรับ") — สิ่งที่ตั้งได้จริงตอนนี้คือ
ประเภทของ **โพสต์** (`content_post.content_type_code`, §2.2) ซึ่งตอบโจทย์ "แท็กสีให้คอนเทนต์" ได้เกือบครบ
อยู่แล้วเพราะโพสต์คือหน่วยที่ผูกกับ metric จริง

---

## 4. หน้าสรุปผล — แนะนำ**เลื่อนออกจากรอบนี้**

### 4.1 เหตุผล

ตรวจแล้ว: `content_post` = 0 แถวสนิท และ `live_session_log` (ที่มาของตัวเลข #1 "ยอด THB/ชม.ไลฟ์") ยังไม่
เริ่มจดจนกว่าจะถึง 1 ต.ค. 69 — ตาม `content-kpi-definition.md` เอง (§0, §2.1, §2.2) การตัดสินใจใดๆ ต้องรอ
**median rolling 7 คืน** และ **format ใหม่ลงครบ 4 ชิ้น** ก่อนถึงจะเชื่อได้

⇒ สร้างหน้าสรุปผลตอนนี้ = สร้างหน้าที่ผู้ใช้เปิดมาแล้วเจอ empty state ล้วนอย่างน้อย 1-2 สัปดาห์ ตรงกับคำเตือน
ของโจทย์เองว่า "หน้าจอที่สวยตอนมีข้อมูลแต่ว่างเปล่าตอนเปิดใช้วันแรก = ทำให้คนเลิกใช้ตั้งแต่วันแรก" — ยิ่งเป็น
หน้าที่เจ้าของไม่จำเป็นต้องเปิดทุกวัน (ต่างจากคิวกรอกที่ต้องเปิดทุกคืน) ความเสี่ยง "เปิดมาเจอว่างแล้วเลิกเช็ค
ถาวร" สูงกว่าอีก

**เสนอแทน**: แถบสรุปเล็กๆ (ไม่ใช่หน้าแยก) บนหัว `/marketing/content/entry` — ตัวนับธรรมดา "โพสต์ที่มี T+7
ครบแล้ว: 3/10" — บอกความคืบหน้าไปสู่จุดที่ข้อมูลเริ่มพอเชื่อได้ โดยไม่ต้อง build dashboard เต็ม

### 4.2 เกณฑ์เริ่มสร้างจริง (มาจากเอกสาร KPI เอง ไม่ใช่ผมเดา)

1. `content_post` ที่มี T+7 ครบ (`v_content_post_t7.t7_view_count is not null`) **≥ 10 ชิ้น**
   (ตรงกับ "เทียบกับ median ของ 10 คลิปล่าสุด" ใน KPI doc §1)
2. `live_session_log` มีข้อมูล **≥ 7 คืนติดกัน** (ตรงกับ rolling median 7 คืนใน KPI doc §0/§2.2)

เมื่อครบทั้งสอง ค่อย spec หน้าสรุปผลเป็นงานถัดไป — ตอนนั้นจะรู้ด้วยว่า 2 ใน 4 ตัวเลขที่ยังไม่มีข้อมูล
(peak viewers, ดัชนีออเดอร์/พีค) เริ่มมีจริงหรือยัง เพราะทั้งคู่ผูกกับ `live_session_log` ตัวเดียวกัน

---

## 5. Component breakdown — ส่งต่อ frontend-dev

### 5.1 สร้างใหม่

| ไฟล์ | ทำอะไร | reuse อะไร |
|---|---|---|
| `app/(dashboard)/marketing/content/entry/page.tsx` | server component หลัก — fetch คิว (`v_content_entry_queue`) join `content_type` | pattern เดียวกับ `calendar/page.tsx` (role gate owner/admin, `dynamic = "force-dynamic"`) |
| `app/(dashboard)/marketing/content/entry/loading.tsx` | skeleton | pattern เดียวกับ `calendar/loading.tsx` |
| `components/domain/marketing/ContentEntryQueue.tsx` | client — list การ์ด, progress bar, จัดการ collapse/scroll ไปการ์ดถัดไป | โครง state คล้าย `CampaignBoard`'s `busyIds`/`openArtifactIds` pattern |
| `components/domain/marketing/ContentMetricCard.tsx` | การ์ด 1 โพสต์ — 2 โหมด กรอก/ทวน (§1.3) | input styling (`min-h-11`, `focus:border-primary-500`) จาก `ClipBriefPanel`/`AddPlanForm` |
| `components/domain/marketing/ContentPostLinkForm.tsx` | ฟอร์มวางลิงก์ ใช้ได้ทั้ง (a)/(b) (§2.1) — รับ `artifactId?: string` | bottom-sheet modal pattern จาก `AddPlanForm` (ถ้าเปิดแบบ overlay) หรือ inline card เหมือน `ClipBriefPanel`'s create button |
| `components/domain/marketing/ContentTypeChip.tsx` | dot+label outline (§3.1), export คู่ `ContentTypeLegend` (`<details>` §3.3) | โครง `<details>` จาก `CampaignCalendar` |
| `lib/marketing/content-entry-draft.ts` | hook `useContentEntryDraft(postId)` — localStorage debounce/restore/cleanup (§1.4) | ไม่มีของเดิมให้ reuse ตรงๆ — เป็นชิ้นใหม่ |
| `lib/marketing/content-types.ts` | type `ContentTypeRow`, `ContentPostRow`, `ContentEntryQueueRow`, label maps (`PLATFORM_LABEL` ฯลฯ) | pattern เดียวกับ `campaign-types.ts`/`types.ts` (Thai label maps, fail-safe fallback) |
| `lib/actions/content.ts` | server actions: `getContentEntryQueue`, `upsertContentPost`, `upsertContentMetric`, `setContentPostStatus` — ทั้งหมดคืน `{ok, data}`/`{ok:false, error}` pattern | pattern `lib/actions/marketing.ts`/`calendar.ts` |

### 5.2 แก้ของเดิม

| ไฟล์ | แก้อะไร |
|---|---|
| `components/domain/marketing/MarketingSubNav.tsx` | เพิ่ม tab ที่ 6 "อ่านยอด" (`ClipboardList`) — ตัวเลข badge คิวค้างเป็น implementation detail ให้ frontend-dev ตัดสินใจ (fetch แยกหรือ cache) ไม่ใช่ UX decision ที่ตายตัว |
| `components/domain/marketing/AgendaTaskCard.tsx` | เพิ่ม `ContentTypeChip` (§3.2) — วางแยกบรรทัดจาก `Badge` สถานะเดิม |
| `components/domain/marketing/CampaignBoard.tsx` (`StepCard`) | เพิ่ม `ContentTypeChip` เดียวกัน |
| `app/(dashboard)/marketing/calendar/[stepId]/page.tsx` | เพิ่ม `ContentTypeChip` ที่ header + render `ContentPostLinkForm` ต่อท้าย artifact ที่โพสต์ได้ (§2.1) — ต้องขยาย `getCalendarTask` ให้ join `content_post` มาด้วย (backend) |
| `lib/marketing/campaign-types.ts` | เพิ่ม `contentTypeCode: string \| null` ใน `CampaignBoardStep` (คอลัมน์มีใน view แล้วจาก 0145 แต่ TS type ยังไม่ mirror) + เพิ่ม `linkedPost: ContentPostSummary \| null` ใน `CampaignArtifact` (ต้อง backend join เพิ่ม — ยังไม่มี query รองรับวันนี้) |

---

## 6. Design decisions + trade-off

1. **Route แยก ไม่ nest ใต้ calendar** — mental model ต่างกัน (วางแผน vs บันทึกประจำวัน) trade-off: เพิ่ม
   sub-nav เป็น 6 tabs (ยอมรับได้ — scrollable overflow-x-auto อยู่แล้ว)
2. **Per-card confirm-before-write ไม่ batch ทั้งหน้า** — จบเป็น unit ต่อโพสต์, ปลอดภัยกว่า auto-save
   trade-off: เพิ่ม 1 tap ต่อโพสต์ (กด "บันทึก" แล้วกด "ยืนยัน") ยอมเสียเวลา ~3-5 วิ/โพสต์ แลกกับกันพิมพ์ผิด
   ที่ DB แก้ย้อนหลังให้ไม่ได้เลย (บทเรียนที่ระบุในโจทย์เอง)
3. **localStorage draft ไม่ใช่ save-as-you-type ไป DB** — กันข้อมูลหายตอนสลับแอปโดยไม่กระทบ
   `is_regression` logic ที่อ่อนไหวต่อค่าที่ยังกรอกไม่ครบ trade-off: ล้าง cache/เปลี่ยนเครื่องกลางคัน draft
   หาย (ยอมรับได้ — เป็นแค่ draft ยังไม่ commit จริง)
4. **Field order ตาม DB param order** (วิว→ถูกใจ→คอมเมนต์→บันทึก→แชร์) ไม่ใช่ตาม business priority —
   เลือกลด mismatch ระหว่างสิ่งที่ตาเห็นบน TikTok Studio กับฟอร์ม มากกว่าเน้น "บันทึก" ให้เด่นด้วยตำแหน่ง
   (เน้นด้วยข้อความกำกับแทน §1.3) **ต้อง validate ลำดับจริงกับเจ้าของ — ดู §7 ข้อ 1**
5. **Content type = outline+dot เท่านั้น ห้าม solid fill** — กันชนกับ `bg-primary-600` solid ที่สื่อ
   action/selected ทั่วระบบ โดยเฉพาะ `drive_live` ที่สีชนกันเป๊ะ
6. **ไม่เพิ่มสีประเภทใน `MonthCalendar` grid** — cell เล็กเกิน (44px) จะรกกวนกับ status dot ที่ตอบคำถามสำคัญ
   กว่าในบริบท scan ภาพรวมเดือน
7. **ไม่รองรับแก้ไข URL หลังบันทึก** — แก้ = สร้างโพสต์ใหม่แยก (external_id เปลี่ยน) metric เก่าจะค้างกับ
   โพสต์ผี เลือกตัดความสามารถนี้ทิ้งดีกว่าเสี่ยงข้อมูลกำพร้าเงียบๆ — ใช้ `content_post_set_status(deleted)`
   แทนถ้าพิมพ์ผิดจริง
8. **หน้าสรุปผลเลื่อนออกจากรอบนี้** — ไม่มีข้อมูลจะโชว์เลยสักแถว เสี่ยง "เปิดมาว่างแล้วเลิกเช็คถาวร" เสนอ
   เกณฑ์เริ่มสร้างที่จับต้องได้แทน (§4.2)

---

## 7. คำถามที่ต้อง validate กับเจ้าของ / ยังตัดสินใจเองไม่ได้

1. **🔴 ลำดับ field ในฟอร์มกรอก** (วิว/ถูกใจ/คอมเมนต์/บันทึก/แชร์) ตรงกับลำดับที่ TikTok Studio แสดงจริง
   บนมือถือไหม — สำคัญที่สุด กระทบความเร็ว+ความแม่นยำการกรอกโดยตรง ผมไม่มีภาพหน้าจอ TikTok Studio จริงใน
   มือ **ห้ามเดา** ต้องขอเจ้าของแคปหน้าจอมาดูก่อน build หรือถามตรงๆ ว่าลำดับเป็นยังไง
2. เจ้าของเข้าเว็บนี้ผ่านช่องทางไหนอยู่แล้วตอนนี้ (bookmark หน้าจอหลักมือถือ / เปิด dashboard ทุกครั้งแล้วกด
   เข้า) — กำหนดว่าจะเน้น "แนะนำ add-to-homescreen" ตอน empty state ครั้งแรกไหม หรือเน้นการ์ดเด่นบน
   dashboard หลักแทน
3. **`content_type_code` ของ `campaign_step` ยังไม่มี RPC เขียน** (§0.3) — ถ้าต้องการให้เจ้าของตั้งประเภทงาน
   ในปฏิทินได้จริง ต้องมี migration ใหม่เพิ่ม RPC ก่อน (เช่น `campaign_step_set_content_type`) — เอกสารนี้
   ไม่ได้ design ส่วนนั้นเพราะ DB ยังไม่รองรับ ขอ confirm ว่าจะเพิ่มไหมหรือพอแค่ตั้งที่ระดับโพสต์
4. **`external_id` ควรเป็นอะไร** — URL ดิบ, URL ที่ normalize (ตัด query string ทิ้ง), หรือ parse video id
   เฉพาะแพลตฟอร์ม — กระทบ data integrity ตรงๆ (URL ดิบเสี่ยงสร้างโพสต์ซ้ำถ้า share link มี tracking param
   ต่างกันทุกครั้งที่ copy) เสนอ normalize (ตัด query string) เป็นทางสายกลาง แต่**ต้องตัดสินใจร่วมกับ
   backend-dev** ไม่ใช่ UX ตัดสินเองฝ่ายเดียว
5. ยืนยัน §2.3 (ไม่รองรับแก้ไข URL ในรอบนี้) — เห็นด้วยไหม หรือมี use case จริงที่พิมพ์ผิดบ่อยจนต้องรองรับ

## สิ่งที่ตัดออก + เหตุผล (สรุปรวม)

- **หน้าสรุปผลเต็มรูปแบบ** — เลื่อนออก, เหตุผลเต็มใน §4.1, เกณฑ์กลับมาทำใน §4.2
- **Selector ตั้ง `content_type_code` ของ `campaign_step`** — DB ยังไม่มี RPC (§0.3, §3.4)
- **Preview/metadata อัตโนมัติจากลิงก์ที่วาง** — เข้าข่ายข้อห้าม ToS แม้จะเป็นแค่ thumbnail (§2.2)
- **แก้ไข URL ของโพสต์ที่บันทึกแล้ว** — เสี่ยงสร้างข้อมูลกำพร้า (§2.3, §6.7)
- **สีประเภทใน `MonthCalendar` grid** — cell เล็กเกิน ชนกับ status dot ที่สำคัญกว่าในบริบทนั้น (§3.2, §6.6)

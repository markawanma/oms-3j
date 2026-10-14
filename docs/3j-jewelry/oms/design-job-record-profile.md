# Design — แบบการบันทึก (record profile) ของใบงาน · 15 ต.ค. 69

> architect (Yoda) · สถานะ: **spec พร้อม implement — migration `0176` = profile (แทนช่อง 0176 ledger เบิกโลหะเดิมที่ ⏸ พักตามมติ 15 ต.ค.)**
> ต่อจาก `design-job-tracking.md` (J1 บน prod `0172`–`0174`) และ `design-job-plan-metal-gems.md` §8 (`0175` — Han กำลัง verify บน `feature/job-m1-metal` ยังไม่ apply) — **ไม่ทวนสิ่งที่ J1/0175 ทำแล้ว** อ่านคู่กัน
> def ล่าสุดของทุก object ที่ replace ระบุไฟล์:บรรทัดใน §4 — **ลอกจากไฟล์นั้น** (skill `3j-migration-traps` ข้อ 3/21) · ถ้า 0175 ยังขยับ ให้ยึดไฟล์ 0175 ฉบับที่ apply จริง
> 🔴 ไม่มีราคา/ต้นทุนในทุก object ของงานนี้ (ยืนยัน §7) · 🔴 ทอง: ด่านกันหายทำงานเฉพาะคู่ขั้นที่ชั่งทั้งคู่ — แบบที่ไม่ชั่ง = ไม่มีด่าน (§2 ข้อ 6)

## 0. โจทย์เจ้าของ (15 ต.ค. 69) → มติ

คำพูด (สรุป): "แยกตัวแจ้งน้ำหนักเป็นกรัมออกมาต่างหาก ตอนนี้อาจไม่ต้องใส่ ปิดไปก่อน หรือทำเป็น option เปิด/ปิดได้ · save ไว้ว่าจะใส่ในขั้นตอนไหนบ้าง · สร้างแบบ 1,2,3 เก็บไว้ · ของเสียก็เลือกได้ เช่น บันทึกหลังหล่ออย่างเดียว · เก็บเป็น default 1 · ปรับวันหลังเป็น default 2 ใช้กับบางสินค้า"

| # | มติ (ตอบแล้ว 15 ต.ค.) | ผลต่อ design |
|---|---|---|
| 1 | **ทองก็เลือกแบบได้** ไม่บังคับชั่งทุกขั้นอีก | ถอดกติกาที่ผูก `metal='gold'` 6 จุด (§1) · ด่าน ±0.05 g เหลือเฉพาะคู่ขั้นที่ชั่งทั้งคู่ · ต้องมีป้ายเตือนบนจอเลือกแบบ + หน้าใบงาน (§8) |
| 2 | ของเสียแยก 2 อย่างต่อขั้น: (ก) จำนวนชิ้นเสีย (ข) น้ำหนักเศษโลหะ | flag ต่อขั้น 3 ตัว: `weigh` · `scrap_qty` · `scrap_weight` |
| 3 | เลือกแบบตอนสร้างใบงาน · ค่าเริ่ม = "แบบ 1" · ใบงานจำแบบไว้ · แก้ได้ก่อนช่างเริ่มรับงาน | snapshot ลง `job_stage` (มีอยู่แล้วสำหรับชั่ง) + `job_profile_set` กติกาเดียวกับ `qty_planned` ของ 0175 |
| 4 | **พัก ledger เบิกโลหะ + สูตรอัลลอย** (0176 เดิม) | ช่องเลข 0176 = profile · design ledger ยังอยู่ใน `design-job-plan-metal-gems.md` §8 ติดป้าย ⏸ |
| 5 | seed: แบบ 1 = ชั่งเฉพาะหล่อ · ชิ้นเสียเฉพาะหล่อ · แบบ 2 = ชั่งหล่อ+ตัดต้น ของเสีย "ตามที่ตั้ง" · มีโหมด "ไม่ชั่งเลย" | **seed แค่ แบบ 1 (default) + "ไม่ชั่ง"** — แบบ 2 เจ้าของสร้างเองในจอ (เหตุผล §2 ข้อ 5) |

## 1. ของเดิมตัดสิน "ต้องกรอกอะไร" จากอะไร (สำรวจจริง 15 ต.ค.) → หลังมี profile

หลัก: **ด่านชั่งทุกด่านอ่านจาก `job_stage.weigh_required` อยู่แล้ว** (snapshot ต่อขั้น · แช่แข็งโดย `job_stage_guard`) — profile แค่เปลี่ยน *ที่มา* ของ flag ตอนสร้าง · สิ่งที่ต้องรื้อจริงคือจุดที่ผูก `metal = 'gold'` ตรงๆ

| จุด | def ล่าสุด | กติกาเดิม | หลัง profile |
|---|---|---|---|
| derive flag ตอนสร้าง | `job_create_insert` 0175:722–727 | ทอง→`def.metal_present` · เงิน→`def.weigh_default` · ทองเหลือง→false | อ่านจาก profile ที่เลือก (ทุกโลหะ) — ขั้นที่ profile ไม่ระบุ = ปิดทั้ง 3 |
| `job.weigh_required` | 0175:717 `p_metal in ('gold','silver')` · ใช้แค่ใน CHECK/freeze ไม่มี RPC ตัดสินจากมัน | | = `exists(job_stage.weigh_required)` ของใบนั้น · ใบเดิมไม่แตะ |
| CHECK `job_gold_weigh_ck` | 0172:199 `metal <> 'gold' or weigh_required` | ทองต้องชั่ง | **drop** |
| CHECK `job_done_ck` | 0172:200–206 `… and (metal <> 'gold' or weight_final_g is not null)` | ทองต้องมีน้ำหนักสุทธิตอนปิด | drop/add: `(metal <> 'gold' or not weigh_required or weight_final_g is not null)` — ใบทองเดิม `weigh_required=true` ⇒ พฤติกรรมเดิม |
| `job_done` | 0175:1279 `metal='gold' and p_weight_final_g is null` | เหมือนบน | `metal='gold' and v_job.weigh_required and …` |
| `job_core_receive` prev ยังถือ | 0175:276–282 ทอง⇒`prev_not_sent` · เงิน⇒เฉพาะ `v_p.weigh_required` | ทองห้ามปิดอัตโนมัติทุกขั้น | เหลือกติกาเดียว: `v_p.weigh_required` ⇒ `prev_not_sent` (ทองที่ขั้นก่อนชั่ง = ผลเดิม · ทองขั้นไม่ชั่ง = ปิดอัตโนมัติได้เหมือนเงิน) |
| `job_core_receive` handoff ±0.05 | 0175:306–316 `gold ∧ v_t.weigh_required ∧ v_p.weigh_required` (N4) | | **ไม่แก้** — รองรับ profile อยู่แล้ว · ป้าย N1 (ซ่อน gap/prev ของทอง บ.339) คงตาม metal |
| `job_stage_guard` auto_close | 0173:547 `new.auto_closed and metal='gold'` ⇒ raise | | `new.auto_closed and new.weigh_required` ⇒ raise (ทั่วไปขึ้น: ขั้นที่ชั่งห้ามปิดอัตโนมัติทุกโลหะ — core_receive ปฏิเสธอยู่แล้วบ.280 ⇒ ไม่เปลี่ยนผล flow เดิม แค่ trigger ตามให้ทัน) |
| `job_stage_guard` freeze | 0173:500–503 ห้ามเปลี่ยน `weigh_required` หลังสร้าง | | ยอมเฉพาะ `old.status='pending'` ∧ ไม่มีขั้นใดของใบ `received/sent` (ทางเดียว = `job_profile_set`) |
| `job_guard` freeze | 0175:1010 `weigh_required` แช่แข็ง | | เงื่อนไขเดียวกับบน + `profile_id/profile_name` เปลี่ยนได้ภายใต้เงื่อนไขเดียวกัน |
| `job_worker_resolve` | 0174:478 `gold or v_hold.weigh_required` ⇒ `prev_not_sent` · บ.493 `prev_w` null ของทอง · บ.527 `action_stage.weight_required` | | `v_hold.weigh_required` อย่างเดียว · `prev_w` null ของทองคงเดิม · `action_stage` เพิ่ม `scrap_qty_ask`/`scrap_weight_ask` |
| `job_core_send` | 0172:1131 `v_s.weigh_required and p_weight_out is null` | ของเสีย/เศษ optional ทุกขั้น | **ไม่แก้** (ดู §2 ข้อ 3 ว่าทำไม flag ของเสียไม่เป็นด่าน DB) |
| `v_job_stage_loss` | 0174:755–770 `handoff_gap_g` เมื่อ `me.weigh_required and pv.weigh_required` | | ไม่แก้ |
| หน้าช่าง | `lib/jobs/worker-view.ts:36` `actionStage.weightRequired` · `components/domain/jobs/worker/WorkerPanels.tsx:199,287` · ช่างส่ง `qty_scrap`+เหตุผลทุกขั้น **ไม่ส่ง `scrap_weight_g`** (`lib/actions/job-worker.ts:72`) | | เพิ่ม flag ของเสีย 2 ตัวจาก resolve · ช่องเศษโลหะเปิดบนจอช่างเป็นครั้งแรกเฉพาะขั้นที่ profile เปิด |

## 2. ตัดสินใจหลัก + trade-off

| # | ตัดสินใจ | ทางที่ตัดทิ้ง · เหตุผล |
|---|---|---|
| 1 | **เอกสารแยกไฟล์** (ไฟล์นี้) ไม่ต่อ §9 ใน `design-job-plan-metal-gems.md` | ไฟล์นั้น 513 บรรทัดแล้ว (วินัยอ่าน ≤150/ครั้ง) · profile ตั้งฉากกับแผนโลหะ/BOM พลอย · คนทำ 0176 อ่านไฟล์เดียวจบ · ไฟล์เดิมแก้แค่ติดป้าย ⏸ + ชี้มาที่นี่ |
| 2 | **profile = 2 ตาราง** `job_record_profile` (หัว) + `job_record_profile_stage` (แถวต่อขั้น · FK ไป `job_stage_def`) — ไม่ใช่ jsonb | jsonb: ไม่มี FK กันรหัสขั้นเน่า/ขั้นที่ปิดใช้ · ตรวจรูปร่างต้องเขียน validator เอง · grid "ขั้น × 3 flag" บนจอคือแถวอยู่แล้ว · ปริมาณ 13 ขั้น × ไม่กี่แบบ = จิ๋ว · pattern เดียวกับ `job_stage_def` |
| 3 | **flag ของเสีย (`scrap_qty`/`scrap_weight`) = "ถาม/แสดง" ไม่ใช่ด่าน DB** · flag ชั่ง (`weigh`) = ด่านเดิม (`weigh_required` บังคับชั่งเข้า-ออก) | ทำของเสียเป็นด่าน: "0 ชิ้นเสีย"/"ไม่มีเศษ" เป็นค่าที่ถูกต้อง — DB แยก "ไม่ได้ถาม" กับ "ถามแล้วได้ 0" ไม่ได้ (`qty_scrap default 0` · `scrap_weight_g` CHECK `> 0`) · จะบังคับจริงต้องเพิ่ม `scrap_confirmed` = ขยาย state machine เพื่อเคสที่เจ้าของยังไม่ขอ (YAGNI) · ปิด = **ซ่อนบนจอช่าง** ออฟฟิศกรอกแทนได้เหมือนเดิม (semantics เดียวกับ `weigh_required=false` ที่ยังรับน้ำหนัก optional อยู่แล้ว) |
| 4 | **snapshot อยู่ที่ `job_stage` (3 boolean) + `job.profile_id/profile_name`** · ใบไม่ join profile ตอนเดิน | join สด: แก้/ปิดแบบทีหลังกระทบใบที่เดินอยู่ (โจทย์ "ปรับวันหลัง") · snapshot ต่อขั้นมีอยู่แล้ว 1 ใน 3 ตัว เพิ่มอีก 2 ตัวถูกที่สุด · `profile_name` snapshot ไว้พิมพ์บนใบ/บอร์ดโดยไม่ join (แบบ `sku_snapshot`) |
| 5 | **seed แค่ แบบ 1 (default) + "ไม่ชั่ง (รับ/ส่งอย่างเดียว)"** · ไม่ seed แบบ 2 | เจ้าของระบุแบบ 2 แค่ครึ่งเดียว (ของเสีย "ตามที่ตั้ง") — seed ค่าเดาที่ดูจริง = memory `no-realistic-placeholders` · จอจัดการแบบส่งรอบเดียวกัน (§8 ข้อ 1) มีปุ่ม "สร้างจากแบบนี้" เจ้าของทำเองได้ใน 1 นาที · ไม่มี `[ต้องยืนยัน]` ค้างในข้อมูล prod |
| 6 | **ทองใช้แบบเดียวกับเงิน · ค่าเริ่มเดียวต่อร้าน** (ไม่มี default แยกโลหะ) | default แยกโลหะ: เจ้าของพูดชัด "default 1" และ "ทองก็เลือกได้เหมือนเงิน" · เพิ่มมิติ = เพิ่มจอ · ชดเชยด้วย **ป้ายเตือนทอง** 3 ที่ (จอเลือกแบบ · หน้าใบงาน · บอร์ด `gold_unguarded`) + Q1 §12 — อยากแยกค่อยเพิ่มคอลัมน์ `default_for_metal` ทีหลังโดยไม่รื้อ |
| 7 | **ใบเดิมบน prod: `profile_id = null` = "กติกาเดิม J1"** ไม่ backfill แถว profile ย้อนหลัง · flag ต่อขั้นคงค่าเดิม | สร้าง profile "J1 legacy" แล้วผูก: ค่าต่อขั้นของใบเดิมต่างตามโลหะ (ทองทุกขั้น/เงิน 3 ขั้น) ต้อง 2 แบบ + UPDATE `job` ทุกแถวผ่าน trigger disable (ข้อ 19) — ได้แค่ป้ายชื่อ ไม่ได้พฤติกรรม · null + ป้าย "กติกาเดิม" พอ |
| 8 | ขยาย `job_stage_suggest` ให้คืน `profiles[]` + `default_profile_id` แทน RPC list สำหรับฟอร์ม · `job_record_profile_list` แยกเฉพาะจอจัดการ | ฟอร์มสร้างใบงานเรียก suggest อยู่แล้ว (`lib/actions/job-office.ts`) — 1 round-trip · ต้องมี matrix เพื่อเตือน "ขั้นที่เลือกไม่มีขั้นไหนชั่ง" แบบสด |
| 9 | ไม่มีตารางประวัติแก้ profile (มี `updated_by/updated_at` + event `profile_set` บนใบ) | ใบงานไม่กระทบเพราะ snapshot · ใครเปลี่ยน default = `updated_by` พอ · หนี้ §11 |

## 3. Data model (0176 · สคีมา `analytics` · RLS เปิดไม่มี policy · grant `service_role` เท่านั้น · ข้อ 18)

### 3.1 `job_record_profile` — แบบการบันทึกต่อร้าน

| คอลัมน์ | ชนิด / CHECK |
|---|---|
| `id uuid pk` · `shop_id uuid not null → public.shop` · `unique (id, shop_id)` | |
| `name text not null` | `length(btrim(name)) between 1 and 60` · ผ่าน `job_label_clean` ใน RPC (กัน `<`/`>` — บทเรียน D2) · unique `(shop_id, lower(name))` |
| `note text` | null หรือ `oem_note_valid` ≤ 200 — คำอธิบายบนจอเลือกแบบ (เช่น "ใช้กับงานชุบ") |
| `is_default boolean not null default false` | partial unique index `(shop_id) where is_default` ⇒ **ค่าเริ่มมีได้ 1 แบบต่อร้าน** · CHECK `(not is_default or is_active)` ⇒ ปิดแบบที่เป็นค่าเริ่มไม่ได้ |
| `is_active boolean not null default true` | ปิดโดยไม่ลบ · trigger ห้าม DELETE/TRUNCATE (มีใบอ้างอยู่ · แบบ `job_stage_def`) |
| `seq int not null default 100` | ลำดับบนจอ |
| `created_by uuid` · `created_at` · `updated_by uuid` · `updated_at` | |

### 3.2 `job_record_profile_stage` — flag ต่อขั้น (ไม่มีแถว = ปิดทั้ง 3)

| คอลัมน์ | ชนิด / CHECK |
|---|---|
| `profile_id uuid → job_record_profile (on delete restrict)` · `shop_id uuid` (trigger derive จาก profile) · `stage_code text` · FK `(shop_id, stage_code) → job_stage_def (shop_id, code)` · PK `(profile_id, stage_code)` | |
| `weigh boolean not null default false` | ⇒ `job_stage.weigh_required` (ด่านชั่งเข้า-ออกเดิม) · **ได้เฉพาะขั้น `def.metal_present`** (ชั่งตอน CAD/เทียน = ไร้ความหมาย) |
| `scrap_qty boolean not null default false` | ⇒ `job_stage.scrap_qty_ask` (จอช่างถามจำนวนชิ้นเสีย+เหตุผล) · ได้ทุกขั้น (เทียนเสีย/ปูนเสียมีจริง) |
| `scrap_weight boolean not null default false` | ⇒ `job_stage.scrap_weight_ask` (จอช่างถามน้ำหนักเศษโลหะ) · **ได้เฉพาะ `def.metal_present`** |
| CHECK `weigh or scrap_qty or scrap_weight` | แถวที่ปิดทั้ง 3 ไม่เก็บ (RPC ลบทิ้ง) — "ไม่มีแถว" กับ "ปิดทั้ง 3" ต้องมีความหมายเดียว ไม่ให้มี 2 สภาพ |

### 3.3 snapshot บนใบงาน (alter table — `add column … default` ไม่ยิง trigger · ไม่ต้อง disable `trg_job_guard`)

| ตาราง.คอลัมน์ | ชนิด | backfill ใบเดิม (ไม่ UPDATE — ค่า default ของ ADD COLUMN) |
|---|---|---|
| `job.profile_id uuid null` · FK `(profile_id, shop_id) → job_record_profile (id, shop_id)` | null = "กติกาเดิม J1 (ก่อน 0176)" | null |
| `job.profile_name text null` ≤ 60 | snapshot ชื่อตอนสร้าง/เปลี่ยน (ใบพิมพ์/บอร์ดไม่ join) · CHECK `(profile_id is null) = (profile_name is null)` | null |
| `job.weigh_required` (มีแล้ว) | ความหมายใหม่สำหรับใบที่มี profile: `exists(job_stage.weigh_required)` · drop `job_gold_weigh_ck` · `job_done_ck` ตาม §1 | ไม่แตะ (ทอง/เงินเดิม = true) |
| `job_stage.scrap_qty_ask boolean not null default true` | จอช่างถามชิ้นเสีย | **true ทุกขั้น** = จอช่าง J1 ถามทุกขั้นอยู่แล้ว |
| `job_stage.scrap_weight_ask boolean not null default false` | จอช่างถามเศษโลหะ | **false** = จอช่าง J1 ไม่เคยมีช่องนี้ (ออฟฟิศกรอกได้ต่อไป) |
| `job_event.event_type` | เพิ่ม `'profile_set'` — drop/add `job_event_event_type_ck` (ชื่อจาก 0175:124) | |

seed ผ่าน `job_record_profile_ensure(p_shop_id)` (`on conflict do nothing` · รันให้ทุก shop ใน migration · เรียกซ้ำใน `job_stage_suggest`/`job_record_profile_list` แบบ `job_stage_def_ensure`) — **สร้างเฉพาะเมื่อร้านยังไม่มี profile เลย** (ร้านที่มีแล้วไม่ยัดเพิ่ม):

| ชื่อ (seed) | default | ขั้น → flag |
|---|---|---|
| `แบบ 1 — ชั่งเฉพาะหล่อ` | ✅ | `cast`: weigh ✓ · scrap_qty ✓ · scrap_weight ✗ · ขั้นอื่นไม่มีแถว |
| `ไม่ชั่ง (รับ/ส่งอย่างเดียว)` | | ไม่มีแถวเลย |

แบบ 2 (ชั่งหล่อ+ตัดต้น · ของเสีย `[ต้องยืนยันกับเจ้าของ]` — Q2 §12) เจ้าของสร้างในจอ §8 ข้อ 1

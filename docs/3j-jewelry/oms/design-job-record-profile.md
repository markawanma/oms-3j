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

## 4. RPC / trigger / CHECK — ใหม่ · replace (signature เต็ม · ✱ = security definer + `crm_require_owner_admin` + grant `service_role` · helper ภายใน = revoke ทุก role แบบ 0174 ส่วน 1)

**ใหม่**

| ฟังก์ชัน | สาระ |
|---|---|
| `job_record_profile_ensure(p_shop_id uuid) returns void` (ภายใน) | seed §3.3 เฉพาะร้านที่ `not exists (profile where shop_id)` · รันให้ทุก `public.shop` ใน migration |
| `job_record_profile_list(p_shop_id uuid) returns jsonb` ✱ stable | ensure · คืน `{profiles:[{id, name, note, is_default, is_active, seq, updated_at, stages:[{stage_code, weigh, scrap_qty, scrap_weight}], jobs_open:int (ใบ status ไม่ปลายทางที่ใช้แบบนี้)}], stage_defs:[{code, name_th, seq_default, metal_present, is_active}]}` — รวม inactive (จอจัดการต้องเห็น) |
| `job_record_profile_upsert(p_shop_id uuid, p_id uuid default null, p_name text default null, p_note text default null, p_stages jsonb default '[]', p_is_active boolean default true, p_seq int default null, p_actor uuid default null) returns jsonb` ✱ | `v_actor := coalesce(p_actor, auth.uid())` บังคับ · ชื่อผ่าน `job_label_clean(…, 'ชื่อแบบ', 60)` · ซ้ำ (lower) ⇒ 22023 `name_dup` · `p_stages` ต้องเป็น array ≤ 100 รายการ รูปร่าง `{stage_code, weigh?, scrap_qty?, scrap_weight?}` (boolean จริงเท่านั้น — `"true"`/1 ⇒ `stage_invalid`) · `stage_code` ต้องมีใน `job_stage_def` ร้านนี้ (ปิดใช้ก็ยอม) · ซ้ำ ⇒ `stage_dup` · `weigh`/`scrap_weight` บนขั้น `metal_present=false` ⇒ `flag_not_applicable` · `p_is_active=false` บนแบบ default ⇒ `default_cannot_close` · แก้ = ลบแถว stage ทั้งชุดแล้ว insert ใหม่ในทรานแซกชันเดียว (แถวปิดทั้ง 3 ไม่ insert) · **ไม่แตะใบงานที่ใช้แบบนี้อยู่** (snapshot) · คืน `{id, name, stages, jobs_open}` |
| `job_record_profile_set_default(p_shop_id uuid, p_id uuid, p_actor uuid default null) returns jsonb` ✱ | แบบต้อง `is_active` (ไม่ ⇒ `inactive`) · **UPDATE คำสั่งเดียว** `set is_default = (id = p_id) where shop_id = … and (is_default or id = p_id)` (unique index ตรวจท้าย statement ⇒ ไม่ชนระหว่างสลับ) · ไม่กระทบใบที่มีอยู่ |
| `job_profile_apply(p_job_id uuid, p_profile_id uuid) returns jsonb` (ภายใน) | profile ต้อง `is_active` และ `shop_id = job.shop_id` (ไม่ ⇒ `profile_invalid`) · UPDATE `job_stage` ทุกแถวของใบ: `weigh_required/scrap_qty_ask/scrap_weight_ask` = flag ของ profile (ไม่มีแถว ⇒ false ทั้ง 3) · UPDATE `job`: `profile_id`, `profile_name`, `weigh_required = exists(stage weigh_required)` · คืน `{profile_name, stages:[…], has_weigh, gold_unguarded}` — ใช้ร่วมโดย `job_create_insert` และ `job_profile_set` ⇒ กติกา derive อยู่ที่เดียว |
| `job_profile_set(p_shop_id uuid, p_job_id uuid, p_profile_id uuid, p_actor uuid default null) returns jsonb` ✱ | `job_office_begin` · มีขั้น `received/sent` ⇒ 22023 `started` ("เปลี่ยนแบบได้เฉพาะก่อนช่างรับงานขั้นแรก") · `job_profile_apply` · event `profile_set` payload `{before:{profile_id, profile_name, stages}, after:{…}}` (`channel='job_page'`) · คืนผล apply |

**replace** (🔴 ทุกตัว `revoke … from public, anon, authenticated` + grant `service_role` ตาม ✱ · signature เปลี่ยน = `drop function` เดิมก่อน · หลัง apply: `check-analytics-grants.sql` + `pg_get_function_identity_arguments` = 1 แถวต่อชื่อ)

| ฟังก์ชัน | def ต้นทาง | เปลี่ยนอะไร |
|---|---|---|
| `job_stage_suggest(uuid, text, uuid)` ✱ | **0172:1385** (ตัวเดียว ไม่เคยถูกแตะ — ยืนยัน md5 ก่อน) | `job_record_profile_ensure` · response เพิ่ม `profiles` (เฉพาะ `is_active` · เรียง `seq, name` · แต่ละตัวมี `stages[]`) + `default_profile_id` (null ถ้าร้านไม่มี default — UI ต้องบล็อก ไม่เดา) |
| `job_create_insert(…)` | **drop** sig 0175:682 (20 arg) → ต่อท้าย `p_profile_id uuid` | `v_profile := coalesce(p_profile_id, (select id … where shop_id and is_default and is_active))` · null ⇒ 22023 `no_default_profile` · INSERT `job` ใส่ `profile_id/profile_name` ตั้งแต่แรก (guard INSERT เช็ค) + `weigh_required=false` ชั่วคราว · INSERT `job_stage` flag false ทั้งหมด (ตรรกะ 0175:722–727 **ลบทิ้ง**) → `job_profile_apply` · event `create` payload เพิ่ม `profile_id, profile_name, has_weigh, gold_unguarded` · response เพิ่ม 3 ตัวเดียวกัน |
| `job_create_from_quote_item` ✱ | **drop** sig 0175:743 (12 arg) → ต่อท้าย `p_profile_id uuid default null` | ส่งต่อ `job_create_insert` · ตรรกะเดิมทุกบรรทัด |
| `job_create_from_production_item` ✱ | **drop** sig 0175:823 (11 arg) → ต่อท้าย `p_profile_id uuid default null` | เหมือนบน |
| `job_core_receive(uuid,int,date,numeric,uuid,text,text,uuid,text,boolean)` | **0175:181** | ลบ block 276–278 (ทอง ⇒ `prev_not_sent`) · เหลือ 280–282 (`v_p.weigh_required`) ข้อความปรับเป็นกลาง · บรรทัดอื่นเท่าเดิมทุกตัว (handoff 306–316 · N1 บ.339 คงตาม metal) |
| `job_stage_guard()` | **0173:453** | (1) บ.500–503: `weigh_required`/`scrap_qty_ask`/`scrap_weight_ask` เปลี่ยนได้เมื่อ `old.status = 'pending'` ∧ `not exists (job_stage where job_id = new.job_id and status in ('received','sent'))` · นอกนั้น raise เดิม (2) บ.547: `new.auto_closed and new.weigh_required` ⇒ raise "ขั้นที่ต้องชั่งปิดอัตโนมัติไม่ได้ — ต้องกดส่งต่อพร้อมน้ำหนักออก" |
| `job_guard()` | **0175:893** | INSERT: `new.profile_id is null` ⇒ raise `profile_required` · profile ต้อง `is_active` ร้านเดียวกัน · UPDATE: `weigh_required`/`profile_id`/`profile_name` ถอดจากรายการแช่แข็งบ.1010 แล้วตรวจแยกแบบ `qty_planned`: เปลี่ยนได้เฉพาะ `not exists (job_stage received/sent)` · อื่นเท่าเดิม |
| `job_worker_resolve(text, text, text)` ✱ | **0174:415** | D6 (ย้ายจาก 0176 ledger เดิม): `job_deposit_blocked`/`job_worker_can_do` แทนบ.465–467, 476, 483–489 · บ.478 ⇒ `v_hold.weigh_required` อย่างเดียว · `action_stage` เพิ่ม `scrap_qty_ask`, `scrap_weight_ask` (จาก stage ที่ action ชี้) · `job` block (เฉพาะช่างที่ระบุตัวแล้ว) เพิ่ม `profile_name` · `prev_weight_out_g` null ของทองคงเดิม · **ไม่มี key ใหม่ที่เป็นตัวเลขน้ำหนัก** |
| `job_done(uuid, uuid, int, int, numeric, text, uuid, text, text)` ✱ | **0175:1229** (signature เท่าเดิม — replace ตรง) | บ.1279 ⇒ `v_job.metal = 'gold' and v_job.weigh_required and p_weight_final_g is null` |
| `v_job_board` | **0175** (หลัง apply) — ต่อท้าย | `profile_name` · `has_weigh` (exists stage weigh_required) · `gold_unguarded` (metal='gold' ∧ exists stage ที่ def.metal_present ∧ not weigh_required ∧ status ไม่ปลายทาง) |
| CHECK บน `job` | 0172:199, 200–206 | `drop constraint job_gold_weigh_ck` · `job_done_ck` drop/add ตาม §1 (แถวเดิมผ่านแน่: ใบทองเดิม `weigh_required=true`) |

**ไม่แตะ**: `job_core_send` (0172:1036) · `job_office_send/receive` · `job_worker_send/receive` · `job_stage_skip/reopen` · `v_job_stage_loss` · `job_plan_*`/`job_surplus_*`/`job_qty_planned_set` ของ 0175 — verify ล็อก md5 baseline (แบบ verify-0175)

## 5. ใบงานที่มีอยู่บน prod (JB-0018 ฯลฯ) เดินต่อด้วยกติกาเดิม — พิสูจน์ทีละจุด

| ของเดิม | หลัง 0176 | ทำไมเหมือนเดิม |
|---|---|---|
| `job_stage.weigh_required` ทอง=metal_present · เงิน=3 ขั้น | ค่าเดิม (migration ไม่มี UPDATE) | ด่าน `js_weigh_*_ck`/`core_receive`/`core_send` อ่าน flag นี้ |
| `scrap_qty_ask/scrap_weight_ask` | true/false (default ของ ADD COLUMN — ไม่ยิง trigger) | = จอช่าง J1 (ถามชิ้นเสียทุกขั้น · ไม่มีช่องเศษ) |
| `job.weigh_required` ทอง/เงิน = true | ค่าเดิม | `job_done` ทองยังบังคับน้ำหนักสุทธิ |
| `job.profile_id/profile_name` | null — จอ/ใบพิมพ์แสดง "กติกาเดิม J1" · `job_profile_set` บนใบเดิมที่ยังไม่เริ่ม **ทำได้** · ใบที่เริ่มแล้ว = `started` | guard INSERT เช็ค `profile_required` เฉพาะแถวใหม่ |
| ทอง `prev_not_sent` | ทุกขั้นทองเดิม `weigh_required=true` ⇒ `v_p.weigh_required` จับเหมือนเดิม | กติกาใหม่ครอบกติกาเก่าเมื่อขั้นชั่งครบ |
| ทอง handoff ±0.05 · N1 ซ่อน prev/gap | ไม่แก้ | |
| ทอง auto_close | trigger ใหม่จับด้วย `weigh_required` ⇒ ทองเดิมยังถูกปฏิเสธ | |
| `updated_at` ของ `job`/`job_stage` | md5 + `count(distinct)` ก่อน/หลัง apply เท่าเดิม | ข้อ 19 — ไม่มี UPDATE ใน migration |
| caller TS เดิม (ไม่ส่ง `p_profile_id`) | ได้แบบ default | named args — แต่ **drop signature เดิม** กัน PGRST เจอ 2 ตัว |

## 6. เคสห้ามผ่าน + ต้องไม่พัง → `scripts/verify/verify-0176.sql` (do-block + `raise` rollback · `set_config('request.jwt.claims','{"role":"service_role"}',true)` · ข้อมูลทดสอบผ่าน RPC เท่านั้น · ปิดท้ายตารางแมป "ข้อในบรีฟ → เทสต์" · ข้อไหนไม่มีเทสต์เขียนว่าไม่มี + เหตุผล)

**ห้ามผ่าน**

| T | เคส | ด่าน |
|---|---|---|
| P1 | upsert: ชื่อว่าง/ล่องหน/`<script>`/ซ้ำ (ต่าง case) · `p_stages` ไม่ใช่ array / JSON null / > 100 · `stage_code` ไม่มีในร้าน / ของร้านอื่น / ซ้ำ · flag เป็น string `"true"` · `weigh=true` บน `cad`/`wax_inject` · `scrap_weight=true` บน `mold` | `job_label_clean` · `name_dup` · `stage_invalid`/`stage_dup`/`flag_not_applicable` |
| P2 | ปิด (`is_active=false`) แบบที่เป็น default · `set_default` ไปยังแบบ inactive / ของร้านอื่น · INSERT แถว profile ตรงให้มี default 2 ตัว · DELETE/TRUNCATE profile ที่มีใบอ้าง | `default_cannot_close` · `inactive` · partial unique · trigger deny |
| P3 | สร้างใบงานเมื่อร้านไม่มี default (ปิดชั่วคราวใน do-block ด้วย UPDATE ตรง) · `p_profile_id` ของร้านอื่น / inactive / ไม่มีจริง · INSERT `job` ตรง `profile_id null` | `no_default_profile` · `profile_invalid` · `job_guard` INSERT |
| P4 | `job_profile_set` หลังขั้นแรก `received` · หลัง `sent` · บนใบ done/cancelled · ใบร้านอื่น | `started` · `job_office_begin` |
| P5 | UPDATE ตรง `job_stage.weigh_required`/`scrap_*_ask` บนขั้น `received`/`sent` · บนขั้น `pending` ของใบที่มีขั้นอื่น `received` · UPDATE `job.profile_id` หลังเริ่ม · `job.weigh_required` ให้ไม่ตรง stage (mutant ทีละคอลัมน์ × ทุก status ที่มีจริง) | `job_stage_guard` · `job_guard` |
| P6 | ขั้นที่ profile เปิดชั่ง: รับไม่ใส่น้ำหนัก / ส่งไม่ใส่น้ำหนัก (ทุกโลหะ รวม **ทองเหลือง** ที่ J1 ไม่เคยชั่ง) · ขั้นก่อนที่ชั่งยังถือค้าง ⇒ รับขั้นถัดไป = `prev_not_sent` (ทุกโลหะ) · UPDATE ตรง `auto_closed=true` บนขั้นชั่ง | `weight_required` · `prev_not_sent` · trigger (2) |
| P7 | **ทอง + แบบที่ชั่ง**: handoff ต่าง > 0.05 ⇒ `handoff_mismatch` + event `weigh` + response ไม่มี `gap_g`/`prev_weight_out_g` · resolve `prev_weight_out_g` null (ลอกเคส N1 verify-0174 ทั้งชุด) · `job_done` ทอง `weigh_required=true` ไม่ส่งน้ำหนักสุทธิ | ผลเดิมเป๊ะ |
| P8 | ช่าง: resolve/receive/send ไม่มีทางเลือกแบบ (ไม่มี arg) · `job_profile_set`/`job_record_profile_*` ไม่มี grant ให้ worker path · anon/authenticated execute RPC ใหม่ทุกตัว + select ตารางใหม่ (18.5) | 42501 |
| P9 | overload: `job_create_insert`/`job_create_from_*`/`job_stage_suggest`/`job_worker_resolve`/`job_core_receive`/`job_done` = 1 แถวใน `pg_proc` · `job_gold_weigh_ck` ไม่มีแล้ว · `job_done_ck` นิยามใหม่ | assert หลัง apply |
| P10 | response `job_worker_resolve` ใบทอง: `jsonb_path_exists` หา key `prev_weight_out_g` ≠ null · `in_g`/`metal_plan_g`/`weight_start_g` ต้องไม่มี | B8 ของ 0176 เดิมย้ายมา |

**ต้องไม่พัง** (ยิงของใหม่ใส่ของเก่าจริง — ข้อ 17)
- ใบ J1 ทุก status ที่มีจริงบน prod (**JB-0018** อ่านด้วย `job_no` ไม่ hardcode id): หลัง apply `profile_id` null · flag ต่อขั้นเท่าเดิม (snapshot md5 ของ `job_stage` ทั้งตารางก่อน/หลัง) · `v_job_board` แถวครบ + `profile_name` null · `has_weigh` = ค่าเดิมของ `job.weigh_required` ใบเงิน/ทอง · `gold_unguarded=false` ทุกใบทองเดิม · `job_worker_resolve` token ใบจริงคืน `ok` · `action_stage` มี `scrap_qty_ask=true`, `scrap_weight_ask=false`
- `job_create_from_*` แบบไม่ส่ง `p_profile_id` ⇒ ได้แบบ 1: `cast` weigh+scrap_qty · ขั้นอื่นปิดทั้ง 3 · `job.weigh_required=true` · ใบที่ stage list ไม่มี `cast` ⇒ สร้างได้ `weigh_required=false`, `has_weigh=false` (ไม่ raise)
- **แบบ "ไม่ชั่ง"** ใบเงิน/ทอง/ทองเหลือง: รับ → ส่ง ทุกขั้นโดยไม่ใส่น้ำหนักเลย ⇒ จบ `job_done` ได้ (ทอง: ไม่ต้องส่ง `p_weight_final_g`) · ใส่น้ำหนักเองก็รับ (optional) · ขั้นก่อนถือค้าง ⇒ auto_close ได้ (รวมทอง) · ไม่มี event `weigh` · `v_job_stage_loss` ทุกแถว `handoff_gap_g` null
- **ทอง แบบ 1** (ชั่งแค่ cast): cast รับ/ส่งต้องชั่ง · cut_sprue รับไม่ต้อง · handoff cast→cut_sprue ไม่เทียบ (ขั้นรับไม่ชั่ง) · `gold_unguarded=true` บนบอร์ด · `job_done` ต้องมีน้ำหนักสุทธิ (`weigh_required=true`)
- ของเสีย: ขั้นที่ `scrap_qty_ask=false` ส่ง `p_qty_scrap > 0` + เหตุผล (ออฟฟิศ) ⇒ ยังรับ (flag ไม่ใช่ด่าน — §2 ข้อ 3) · `scrap_weight_ask=false` ส่ง `p_scrap_weight_g` ⇒ รับ
- `job_profile_set` ใบใหม่ก่อนเริ่ม: แบบ 1 → ไม่ชั่ง → แบบ 1 ⇒ flag ทุกขั้นกลับเท่าเดิม + event `profile_set` 2 แถว before/after ถูก · ใบ J1 เดิม (`profile_id` null) ที่ยังไม่เริ่ม ⇒ set ได้
- upsert แก้แบบที่ใบเปิดอยู่ใช้ · ปิดแบบนั้น (ไม่ใช่ default) · สลับ default ⇒ **ใบนั้นไม่ขยับสักคอลัมน์** (md5 `job`+`job_stage` ของใบก่อน/หลัง) · สร้างใบใหม่หลังสลับได้แบบใหม่
- `set_default` สลับ A→B→A ในทรานแซกชันเดียว ⇒ มี default 1 ตัวตลอด
- `job_stage_suggest` ของ quote/production item จริง คืน key เดิมครบ + `profiles`/`default_profile_id`
- md5 เท่าเดิม: `job_core_send` · `job_office_*` · `job_worker_send/receive` · `job_stage_skip/reopen` · `job_plan_*` · `job_surplus_set` · `oem_*` · `production_*` (baseline แบบ 0172 ส่วน 0)
- ช่วง 00:00–07:00 ไทย: `occurred_on` ของ event `profile_set` = วันไทย (`job_today()`)
- คาดไว้ก่อนว่าไม่มีเทสต์: race "ช่างรับขั้นแรก" พร้อม `job_profile_set` (2 connection) — กันด้วย `for update` ใน `job_office_begin` + `uq_job_stage_one_received` · ระบุในตารางแมป

## 7. สิทธิ์ · ความลับทอง · ไม่มีราคา

| ช่องทาง | ทำอะไรได้ | ยืนยัน |
|---|---|---|
| ช่าง (`/w/` token+session) | เห็น `action_stage.{weight_required, scrap_qty_ask, scrap_weight_ask}` + `job.profile_name` · **เลือก/เปลี่ยนแบบไม่ได้** (ไม่มี arg ใน RPC ช่าง) · ทอง: `prev_weight_out_g` null เหมือนเดิม (N1) | P8 · P10 |
| ออฟฟิศ owner/admin | `job_record_profile_list/upsert/set_default` · `job_profile_set` · `job_stage_suggest` (profiles) · เลือกแบบตอนสร้าง | `crm_require_owner_admin` + `p_actor` |
| staff | หน้า `/jobs/*` เดิมไม่มีราคาอยู่แล้ว — จอจัดการแบบ = owner/admin เท่านั้น (`getEffectiveRole()`) · แต่ **ไม่ใช่เรื่องราคา** จึงไม่ต้อง gate แบบ `/oem/rates` — ตัดสิน: ให้เฉพาะ owner/admin เพราะเปลี่ยน default กระทบทุกใบใหม่ (นโยบายโรงงาน ไม่ใช่งานประจำวัน) | memory `role-single-level`: กฎบังคับที่ DB (RPC ✱) ไม่ใช่ปุ่ม |
| anon/authenticated | ไม่มี (สคีมา `analytics` ปิด REST ตั้งแต่ 0123) | `check-analytics-grants.sql` + เคส 18.5 |
| ราคา/ต้นทุน | profile/flag เป็น boolean ล้วน · ไม่ join `oem_metal_price`/`silver_price_daily`/`oem_cost_rate` ที่ไหน · ใบพิมพ์ `PrintableJob` ประกอบทีละ field: เพิ่ม `profileName` + ต่อขั้น `scrapQtyAsk/scrapWeightAsk` (มี `weighRequired` แล้ว `lib/jobs/print.ts:12`) | grep `price\|cost\|thb` ใน 0176 เจอแค่คอมเมนต์ |

**ทอง — ผลกระทบที่เจ้าของต้องเห็นทุกครั้งที่เลือก** (มติ 1): ด่าน ±0.05 g (N1/N4) ทำงานเฉพาะ **คู่ขั้นที่ชั่งทั้งคู่** · ขั้นที่ไม่ชั่ง = ไม่มีด่านกันทองหายระหว่างขั้นนั้น และ `v_job_stage_loss` ไม่มีตัวเลขให้ดูย้อนหลัง · แบบ "ไม่ชั่ง" บนใบทอง = ไม่มีด่านเลยทั้งใบ + ไม่บังคับน้ำหนักสุทธิตอนปิด — ระบบ**ไม่บล็อก** (เจ้าของตัดสินแล้ว) แต่ต้องมี (ก) ป้ายแดงบนจอเลือกแบบเมื่อ metal=gold และแบบนั้นมีขั้น `metal_present` ที่ไม่ชั่ง (ข) ป้าย `gold_unguarded` บนบอร์ด + หน้าใบงาน (ค) บรรทัดบนใบพิมพ์ "ขั้นที่ชั่ง: หล่อ" ให้คนถือกระดาษรู้

## 8. หน้าจอ (ส่ง ux-ui — ระดับรายการ · สิทธิ์: `/jobs/*` owner/admin · `/w/*` ช่าง)

1. **`/jobs/profiles` จัดการแบบการบันทึก** (แท็บข้าง "ทะเบียนช่าง") — รายการแบบ (ชื่อ · ป้าย "ค่าเริ่ม" · ใช้กับ n ใบที่เปิดอยู่ · ปิดใช้) · กดเข้า = ตาราง **ขั้น (13 แถวตาม `seq_default`) × [ชั่งน้ำหนัก / ชิ้นเสีย / น้ำหนักเศษ]** checkbox · ช่องชั่ง/เศษของขั้นที่ `metal_present=false` disabled พร้อมเหตุผล · ปุ่ม: บันทึก · ตั้งเป็นค่าเริ่ม (confirm: "ใบงานใหม่ทุกใบจะใช้แบบนี้ ใบที่มีอยู่ไม่เปลี่ยน") · ปิดใช้ (disabled ถ้าเป็นค่าเริ่ม + บอกว่าทำไม) · **สร้างจากแบบนี้** (clone แล้วแก้ — ทางที่เจ้าของจะสร้างแบบ 2) · ข้อความคงที่ใต้ตาราง: "ชั่งน้ำหนัก = บังคับชั่งเข้า-ออก · ชิ้นเสีย/น้ำหนักเศษ = ช่องที่ช่างเห็นบนมือถือ (ออฟฟิศกรอกแทนได้เสมอ)" · ทุกข้อความ error มาจาก server (hint code → `lib/jobs/messages.ts`)
2. **ฟอร์มสร้างใบงาน** — แถว "แบบการบันทึก" select ค่าเริ่ม = `default_profile_id` (ไม่มี ⇒ บล็อกส่ง + ลิงก์ไป `/jobs/profiles`) · ใต้ select: สรุปสดจาก matrix × ขั้นที่ติ๊กไว้: "ชั่ง: หล่อ · ชิ้นเสีย: หล่อ · เศษ: —" · เตือนเหลือง "ขั้นที่เลือกไม่มีขั้นไหนชั่งเลย" · **metal=gold + มีขั้นโลหะที่ไม่ชั่ง ⇒ กล่องแดง** "งานทอง: ขั้น X, Y ไม่ชั่ง — ไม่มีด่านกันทองหายระหว่างขั้นเหล่านี้" (ไม่บล็อก) · ไม่คำนวณอะไรใน client นอกจาก lookup boolean
3. **`/jobs/[id]` หน้าใบงาน** — การ์ด "แบบการบันทึก": ชื่อแบบ (หรือ "กติกาเดิม J1") + บรรทัดสรุปขั้นที่ชั่ง/ชิ้นเสีย/เศษ · ปุ่ม "เปลี่ยนแบบ" เฉพาะเมื่อยังไม่มีขั้น received/sent (ไม่งั้น disabled + "เปลี่ยนได้ก่อนช่างรับงานขั้นแรก") · ป้ายแดง `gold_unguarded` · timeline ขั้นแสดงไอคอน ⚖/✂ ตาม flag · event log มี `profile_set` (before→after)
4. **ใบพิมพ์ A5** (`PrintableJob`) — ใต้หัว: "แบบ: แบบ 1 — ชั่งเฉพาะหล่อ" · ตารางขั้น: ช่อง "นน.เข้า/ออก" พิมพ์เฉพาะแถวที่ `weighRequired` · ช่อง "เสีย (ชิ้น)" เฉพาะ `scrapQtyAsk` · ช่อง "เศษ (g)" เฉพาะ `scrapWeightAsk` · แถวที่ปิดทั้ง 3 = ช่องเซ็นรับ/ส่งอย่างเดียว · ใบ `profile_id` null พิมพ์แบบเดิม
5. **`/w/[token]` ช่าง** — รับ: ช่องน้ำหนักเข้าเฉพาะ `weight_required` (เดิม) · ส่งต่อ: น้ำหนักออกเฉพาะ `weight_required` · บล็อกชิ้นเสีย+เหตุผลเฉพาะ `scrap_qty_ask` (ปิด = ไม่แสดง ส่ง 0) · **ช่องใหม่ "เศษโลหะ (g)" เฉพาะ `scrap_weight_ask`** (optional · `lib/actions/job-worker.ts` ต้องส่ง `scrapWeightG` ซึ่ง `worker-server.ts:116` รองรับอยู่แล้ว) · ขั้นที่ปิดทั้ง 3 = ปุ่มเดียว "ส่งต่อ" · ไม่โชว์ชื่อแบบ/ป้ายทองให้ช่าง (ไม่ใช่เรื่องของช่าง)
6. **บอร์ด** — ป้าย `gold_unguarded` (แดง) · filter/คอลัมน์ `profile_name` (ไม่บังคับ)

## 9. ผลต่อ `design-job-plan-metal-gems.md` §8 (0175 / 0176 เดิม)

| ส่วนใน §8 | สถานะหลังมติ 15 ต.ค. |
|---|---|
| 0175: `qty_order`/เผื่อ/`job_plan_suggest`/`job_qty_planned_set`/surplus/D2 | **ใช้ได้ทั้งหมด** — แผนโลหะ (`metal_plan_g`) เป็นตัวเลขวางแผน ไม่ต้องชั่ง · `job_plan_set` "แก้ได้จน cast รับ" ไม่เกี่ยวกับ flag ชั่ง |
| 0175: D6 ส่วน `job_worker_resolve` (§8.0 ข้อ 1 บอกว่าไปปิดใน 0176) | **ย้ายมา 0176 profile** (§4 แถว `job_worker_resolve`) |
| 0176 เดิม: `job_metal_material` · `job_metal_issue(+line)` · `job_metal_*` RPC · `job_worker_metal_issue` · `v_job_metal_balance/recycle_pool/drift` · `job_core_send` branch ledger · `job_stage_reopen` void · `v_job_board.metal_in_g/metal_not_issued/alloy_warn/return_not_recorded` · B1–B11 · จอ §8.9 ข้อ 3–5 · R11–R16 | ⏸ **พักทั้งก้อน** — ติดป้ายในไฟล์เดิม ห้ามลบ · ถ้าปลุกทีหลัง: ต้องเขียนทับบนฐานที่มี profile (ledger `issue` บังคับ `weight_in_g` ⇒ ใช้ได้เฉพาะใบที่ `cast.weigh_required=true` — เพิ่มเป็นด่าน `profile_no_weigh` ตอนนั้น) |
| `scrap_weight_g` ⇒ ledger `return` อัตโนมัติ (§8.3 `job_core_send`) | พัก — `scrap_weight_g` กลับเป็นช่องบันทึกธรรมดาตาม J1 §4.4 (ต้นทาง `metal_scrap_ledger` J6 ทีหลัง) |
| §8.8 ไฟล์โค้ด คอลัมน์ 0176 · §8.10 ลำดับงาน "0176 ledger → security → การ์ดโลหะ" | แทนด้วย §10–§11 ของไฟล์นี้ |
| §8.13 Q11 (อัลลอยทอง) · Q12 | เลื่อนไปพร้อม ledger |

## 10. รายการส่ง Han (0175 — ไม่มีข้อบังคับให้แก้)

| # | เรื่อง | ต้องทำไหม |
|---|---|---|
| 1 | signature `job_create_insert`/`job_create_from_*` ของ 0175 จะถูก **drop อีกรอบใน 0176** (ต่อท้าย `p_profile_id`) | ไม่ต้องแก้ 0175 — caller TS ใช้ named args · 0176 drop sig ของ 0175 ตามปกติ · **ขอให้ 0175 นิ่ง (apply) ก่อน 0176 เริ่มเขียน** ไม่งั้น def ต้นทาง §4 เลื่อน |
| 2 | คอมเมนต์หัวไฟล์ 0175 / `job_worker_resolve` ที่เขียนว่า "D6 ส่วน resolve ไปปิดใน 0176 (ledger)" | ถ้ามี ให้แก้ข้อความเป็น "0176 (record profile)" — ไม่กระทบโค้ด |
| 3 | `job_event_event_type_ck` ตั้งชื่อแล้ว (0175:124) | ดีแล้ว — 0176 drop/add ด้วยชื่อนี้เพิ่ม `profile_set` |
| 4 | verify-0175 baseline md5 ที่ล็อก `job_stage_guard`/`job_worker_resolve`/`job_stage_suggest` ว่า "เท่าเดิม" | ถูกต้องสำหรับ 0175 · verify-0176 จะ re-baseline เอง — ไม่ต้องแก้ |
| 5 | `v_job_board` ของ 0175 | 0176 ต่อท้าย 3 คอลัมน์ — ห้ามแทรกกลาง (42P16) · ไม่ต้องเผื่อ |

## 11. ลำดับงาน · ความเสี่ยง · หนี้

**ลำดับ**: 0175 apply + merge (Han) → `0176` profile (backend-dev · worktree · def ต้นทางตาม §4) → verify-0176 → **security บังคับ** (แตะ RPC ช่าง + ถอดด่านทอง = มูลค่าโลหะ) + QA **L** (ทุก flow `/w/` + สร้าง/ปิดใบงาน + ใบพิมพ์) → merge DB → UI (frontend-dev): `/jobs/profiles` + ฟอร์มสร้าง + หน้าใบงาน + ใบพิมพ์ + จอช่าง (เทสต์ `WorkerApp*.test.tsx` เคสทองต้องแยก "ทองที่ชั่ง" / "ทองไม่ชั่ง") → QA M → UAT: เจ้าของสร้างแบบ 2 เองในจอ แล้วช่าง 1 คนลองใบเงินแบบ 1 จริง 1 ใบ

| # | ความเสี่ยง | กัน |
|---|---|---|
| R1 | คลาย freeze `weigh_required` บน guard = service key เขียน flag ตรงได้ช่วงก่อนเริ่มงาน | ยอมรับ (ชั้นเดียวกับ `qty_planned` 0175) · เงื่อนไข `not exists received/sent` ตรวจใน trigger ไม่ใช่ RPC · P5 |
| R2 | trigger (2) ทั่วไปขึ้น (ขั้นชั่งห้าม auto_close ทุกโลหะ) — path ไหนเคย auto_close ขั้นเงินที่ชั่ง? | ตรวจแล้ว: ทางเดียวคือ `job_core_receive` ซึ่งปฏิเสธอยู่แล้ว (0175:280) ⇒ ไม่เปลี่ยนผล · verify ยิงเคส QA 6 ของ verify-0173 ซ้ำ |
| R3 | drop/add `job_done_ck` บนตารางที่มีแถว done จริง | แถวทองเดิม `weigh_required=true` ⇒ นิยามใหม่ผ่านแน่ · dry-run ก่อน apply (ข้อ 12) |
| R4 | UI เลือกแบบ default ไม่มี (ร้านใหม่/คนปิดผ่าน SQL) แล้วสร้างใบเงียบๆ ไม่มี flag | DB raise `no_default_profile` (ไม่ fallback) · `ensure` seed เฉพาะร้านที่ไม่มีแบบเลย · CHECK `(not is_default or is_active)` |
| R5 | เจ้าของเลือก "ไม่ชั่ง" กับทองโดยไม่ตั้งใจ | ไม่บล็อก (มติ) · ป้าย 3 ที่ (§7) · Q1 §12 ถ้าอยาก default แยกโลหะ |
| R6 | หน้าช่างเปิดช่อง "เศษโลหะ" เป็นครั้งแรก — ช่างกรอกน้ำหนักชิ้นงานใส่ช่องเศษ | label ชัด "เศษ/ก้านต้นที่เก็บได้ (ไม่ใช่น้ำหนักงาน)" · ด่านเดิม `js_weight_ck` ไม่เกี่ยวกับเศษ ⇒ ค่าผิดไม่ถูกจับ — รับรู้เป็นหนี้ |
| R7 | เทสต์ TS เดิมผูกพฤติกรรม "ทอง ⇒ prev_not_sent" กับ metal | เคสเดิมยังถูกเมื่อ `weightRequired=true` · เพิ่มเคส gold+`weightRequired=false` |
| R8 | 0175 แก้หลัง 0176 เริ่มเขียน ⇒ ลอก def ผิดฉบับ (ข้อ 21) | §10 ข้อ 1 · verify-0176 เทียบ md5 ของ `job_core_receive`/`job_guard`/`job_done` **ก่อน replace** กับค่าที่ 0175 apply จริง |

**หนี้ที่รู้ตั้งแต่ spec**: flag ของเสียไม่เป็นด่าน DB (§2 ข้อ 3 — ถ้าเจ้าของอยาก "ต้องยืนยันว่าไม่มีเสีย" ค่อยเพิ่ม `scrap_confirmed`) · ไม่มีประวัติแก้ profile (§2 ข้อ 9) · ใบ J1 เดิม `profile_id` null ตลอดชีวิตใบ · ไม่มี default แยกโลหะ · R6 · ledger ⏸ ทั้งก้อน (รวม D6 ที่ `v_job_board.deposit_missing` ยังเป็นนิพจน์แยก)

## 12. คำถามถึงเจ้าของ (ถามได้ระหว่างทำ · ไม่บล็อก 0176)

| # | คำถาม | ค่าเริ่มถ้าไม่ตอบ |
|---|---|---|
| Q1 | **ทอง**: ใช้ "แบบ 1" เป็นค่าเริ่มเหมือนเงินตามที่พูด หรืออยากให้ทอง default เป็น "ชั่งทุกขั้น" แยกต่างหาก (ลดโอกาสเลือกพลาด) | แบบ 1 ทุกโลหะ + ป้ายเตือน (มติ 1) |
| Q2 | **แบบ 2** (ชั่งหล่อ+ตัดต้น): ชิ้นเสียถามที่ขั้นไหน · น้ำหนักเศษถามที่ขั้นไหน (ตัดต้น?) | ไม่ seed — เจ้าของสร้างเองใน `/jobs/profiles` |
| Q3 | ใบทองที่ใช้แบบ "ไม่ชั่ง": ตอนปิดงานยังอยากให้**บังคับ**ใส่น้ำหนักสุทธิไหม (ชั่งครั้งเดียวตอนจบ) | ไม่บังคับ (ตามนิยาม `weigh_required=false`) — เปลี่ยนเป็นบังคับได้ด้วยแก้ `job_done_ck` บรรทัดเดียว |

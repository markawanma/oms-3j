# Design — ใบงานต่อยอด J1: จำนวนเผื่อเสีย · เบิกโลหะ · วางแผนโลหะ · BOM พลอย · แคตตาล็อกพลอย (13 ต.ค. 69)

> architect (Yoda) · สถานะ: **design รอเจ้าของตอบ §6 ก่อนเขียน migration** · ยังไม่มีโค้ด/migration ของส่วนนี้
> ต่อจาก `design-job-tracking.md` (J1 ลง DB แล้ว: `0172`–`0174` apply 12 ต.ค. 69 · โค้ดบน branch `feature/job-tracking-j1`) — **เอกสารนี้ไม่ทวนสิ่งที่ J1 ทำแล้ว** อ่านคู่กัน
> อ่านคู่: `design-own-production-costing.md` (make_spec · oem_cost_calc) · `design-production-order.md` · skill `oem-quote-invariants` · skill `3j-migration-traps` · memory `spec-cost-mode` · `production-order-and-spot-cost`
> 🔴 เอกสารนี้ไม่มีตัวเลขต้นทุน/ราคาจริงโดยตั้งใจ — ตัวเลขอยู่ใน DB เท่านั้น (ค่า % ใน §6 เป็นคำถาม ไม่ใช่ค่าที่ตั้ง)
> ⚠️ `design-job-tracking.md` อยู่บน branch อื่น (commit `c2d4d42`/`3fdddd9` ใน dir หลัก) ยังไม่อยู่ใน worktree นี้ — ตอน merge ให้เพิ่มลิงก์มาที่ไฟล์นี้ท้าย §7 ของมัน

## 0. โจทย์เจ้าของ (13 ต.ค. 69 — สรุปคำพูด) → อะไรมีแล้วใน J1 / อะไรต้องเพิ่ม

| ข้อ | เจ้าของต้องการ | J1 มีแล้ว (0172–0174) | ต้องเพิ่ม |
|---|---|---|---|
| **ก** จำนวนเผื่อเสีย | สั่ง 30 เริ่ม 35 · เสียระหว่างขั้นบันทึกได้ · จบ 33 ส่ง 30 เหลือ 3 | `job.qty_planned` (= เริ่มผลิต) · `job_stage.qty_in/qty_out/qty_scrap+scrap_reason` ต่อขั้น โซ่ `qty_in(N) = qty_out(N−1)` (trigger) · `job_done` บังคับ `qty_good + qty_scrap = qty_planned` | `job.qty_order` (ลูกค้า/ใบผลิตสั่ง) แยกจาก `qty_planned` · คำแนะนำจำนวนเผื่อจาก reject rate ที่มี · ของเหลือ (`qty_good − qty_order`) ต้องมีที่ไป (§6 Q1) |
| **ข** เบิกโลหะที่ขั้นหล่อ | เบิกโลหะอะไร เท่าไร · หล่อเสร็จชั่งรวม → เฉลี่ยต่อชิ้น · ส่วนต่าง = ก้านต้น (หลอมคืน) + หายจริง | `job_stage.weight_in_g/weight_out_g/metal_added_g/scrap_weight_g` ของขั้น `cast` · `v_job_stage_loss` · ทองบังคับชั่งทุกขั้น | **ชนิดโลหะ/ความบริสุทธิ์/ผู้เบิก/หลายครั้ง** ไม่มีที่เก็บ (J1 มีแค่ตัวเลขกรัมช่องเดียว) → ตาราง `job_metal_issue` (ledger) + view ดุลโลหะต่อใบ + เฉลี่ยต่อชิ้น |
| **ค** วางแผนโลหะตอนสั่งผลิต | น้ำหนักต่อชิ้น × จำนวน (+ เผื่อก้านต้น) → โลหะรวมที่ต้องเตรียม | rate `sprue_loss_pct[metal]` มีใน `oem_cost_rate` (0061) · `weight_g` อยู่ใน `oem_quote_item.input` · `product.silver_weight_g` | `job.target_piece_g` + `job.metal_plan_g` (DB คำนวณ · snapshot ที่มา) · RPC `job_plan_suggest` ให้ฟอร์มสร้างใบงาน |
| **ง** BOM พลอยต่อชิ้น | รูปทรง (เพิ่มได้) · รายการพลอยต่อชิ้น (ชนิด · รูปทรง · **ขนาดจริง มม.** · จำนวน) → สรุปรวมทั้งใบเพื่อสั่งซื้อ · **มติเพิ่ม 13 ต.ค.: ไม่ใช้ ใหญ่/กลาง/เล็ก — ใส่ขนาดจริง เช่น "โกเมน ทรงไข่ 4×6"** (เจ้าของพิมพ์ "ซม" แต่พลอยในเครื่องประดับขนาดนี้คือ มม. — Tech Lead ยืนยันหน่วยกับเจ้าของ) | ไม่มี — `make_spec.gem_tier/gem_count` คือ "tier เดียว × จำนวน" ใช้คิดต้นทุนเท่านั้น | `gem_shape` · `product_gem_bom` (แม่แบบที่ SKU) · `job_gem_bom` (สำเนาต่อใบ) · view สรุปสั่งซื้อจัดกลุ่ม ชนิด+รูปทรง+ขนาด |
| **จ** แคตตาล็อกพลอย + ราคา | ชนิด × รูปทรง × ขนาด → ราคา/หน่วย มีวันที่ · เพิ่มได้เรื่อยๆ ในหน้า "จัดการต้นทุน" | rate `gem_price_thb_per_seed[เล็ก/กลาง/ใหญ่]` (3 แถว · ไม่มีชนิด/รูปทรง) | `gem_type` · `gem_item` · `gem_item_price` (ประวัติแบบ `oem_cost_rate.effective_from`) · แท็บใหม่ใน `/oem/rates` · สะพานไป tier เดิมผ่าน `gem_item.oem_tier` (§1.4) |

**ของที่ตั้งใจไม่แตะ**: `oem_quote_*` · `oem_cost_calc`/`oem_price_calc` (golden replay 0140) · `production_order_done` (💰 เดียวที่แตะสต็อก/ต้นทุน SKU) · `make_spec` shape เดิม (0141) · ใบเสนอราคา/ใบเสร็จที่ออกแล้ว — ทุกอย่างในเอกสารนี้อยู่ **ข้างใบงาน** ไม่ใช่ข้างเอกสารลูกค้า

## 1. ความสัมพันธ์กับของเดิม — "แม่แบบอยู่ที่ SKU · สำเนาอยู่ที่ใบงาน · เอกสารลูกค้าไม่รู้จัก"

```
public.product (SKU)                         analytics.oem_quote_item (ใบเสนอราคา — ห้ามแตะ)
  silver_weight_g / make_spec (0141)           input.weight_g · gem_tier · gem_count · qty
  + product_gem_bom[]  (ใหม่ — แม่แบบ BOM)             │ job_create_from_quote_item (J1)
        │ job_create_from_production_item (J1)        │   ← อ่านอย่างเดียว · ไม่ copy ราคา/calc
        ▼                                              ▼
  ┌──────────────────────── analytics.job (J1) + คอลัมน์ใหม่ ───────────────────────────┐
  │ qty_order · qty_planned(เดิม) · target_piece_g · metal_plan_g · metal_plan_basis      │
  │ job_gem_bom[]        (สำเนา BOM ต่อใบ · แก้ได้จนกว่าขั้น gem_set จะถูก "รับ")          │
  │ job_metal_issue[]    (ledger เบิก/เติม/คืนเศษ · โลหะ · ความบริสุทธิ์ · กรัม · คน · ขั้น)│
  │ job_stage (J1)       cast: weight_in_g ← Σ issue (trigger ทางเดียว ledger → stage)   │
  └──────────────┬─────────────────────────────────────┬───────────────────────────────────┘
                 │ v_job_metal_balance (เฉลี่ย/ชิ้น · หาย g %)│ v_job_gem_requirement → v_gem_purchase_summary
                 ▼                                     ▼
      job_done (J1) + cost_snapshot (เฟส G2)      หน้า "พลอยที่ต้องสั่งซื้อ" (owner/admin)
                 │
                 ▼
      production_order_done (เดิม — ไม่แตะ · prefill qty_done = qty_good เหมือน J1 §4.2)
```

### 1.1 BOM พลอยและน้ำหนักต่อชิ้นอยู่ที่ไหน
| ชั้น | เก็บอะไร | เหตุผล |
|---|---|---|
| **SKU (`product`)** | `product_gem_bom` (ช่อง × พลอย × จำนวน/ชิ้น) · น้ำหนักต่อชิ้นใช้ `silver_weight_g` เดิม (fact หนึ่งอยู่ชั้นเดียว — ไม่เพิ่ม `target_weight_g` ซ้ำที่ SKU) | มติ C4 (19 ก.ย.): *"สเปคผูกกับ SKU กรอกครั้งเดียว"* · สี/ไซส์ = คนละ SKU อยู่แล้ว ⇒ BOM เป็นคุณสมบัติของ SKU |
| **ใบงาน (`job`)** | `job_gem_bom` = **สำเนา** ตอนสร้าง (จาก SKU ถ้ามี · ไม่มี SKU = ว่างให้ออฟฟิศกรอก) · `target_piece_g` = สำเนาน้ำหนักเป้าหมาย | ใบงานต้องตอบ "ตอนนั้นสั่งอะไร" ได้แม้ SKU ถูกแก้ทีหลัง (หลักเดียวกับ `cost_calc` snapshot 0141 และ `sku_snapshot` ของ J1) · แก้ต่อใบได้โดยไม่เขียนกลับ SKU (memory `sku-autofill-decisions`) |
| **ใบเสนอราคา OEM** | ไม่รู้จัก BOM · ไม่รู้จัก `job_metal_issue` | invariant: ใบที่ออกแล้วห้ามขยับ · ต้นทุนใบเสนอราคายังมาจาก `oem_cost_calc` (tier) เท่านั้น จนกว่า G3 (§1.4) |
| **ใบผลิต (`production_order_item`)** | ไม่เพิ่มคอลัมน์ · `qty_planned` ของมัน = **จำนวนที่อยากได้เข้าสต็อก** = `job.qty_order` | ใบผลิตเป็น "คำสั่ง" ใบงานเป็น "การผลิต" — จำนวนเผื่อเป็นเรื่องของการผลิต |

### 1.2 `qty_order` vs `qty_planned` vs `qty_good` vs ส่งจริง
| คอลัมน์ | ความหมาย | ที่มา / กติกา |
|---|---|---|
| `job.qty_order` (ใหม่ · not null) | จำนวนที่ลูกค้า/ใบผลิตสั่ง | OEM = `oem_quote_item.qty` · production = `production_order_item.qty_planned` — RPC copy ตอนสร้าง · **ไม่แก้** (เปลี่ยน = ยกเลิกแล้วสร้างใหม่ เหมือน R1 ของ J1) · backfill ใบ J1 ที่มีอยู่: `qty_order := qty_planned` |
| `job.qty_planned` (เดิม) | จำนวนที่เริ่มผลิตจริง (= `qty_in` ขั้นแรก) | ออฟฟิศกรอกตอนสร้าง · ฟอร์มเสนอค่าจาก `job_plan_suggest` (§2.5) · **แก้ได้จนกว่าขั้นแรกจะถูก "รับ"** ผ่าน `job_qty_planned_set` + event (`job_guard` 0172 บ.645 ห้ามแก้อยู่ — ผ่อนเฉพาะเงื่อนไขนี้ + ต้องคำนวณ `metal_plan_g` ใหม่พร้อมกัน) |
| `job.qty_good` / `qty_scrap` (เดิม) | ผลสุดท้ายตอน `job_done` | J1 เดิม |
| ส่งจริง | `oem_delivery.qty` (J4 ยังไม่ทำ) · สต็อก = `production_order_done.qty_done` (prefill จาก `qty_good`) | ไม่เพิ่มคอลัมน์ · `v_job_board.qty_surplus = qty_good − qty_order` เมื่อ done |
| ของเหลือ (`qty_good > qty_order`) | OEM: 3 ชิ้นไปไหน — **ตัดสินเองไม่ได้ → §6 Q1** · production: เข้าสต็อกทั้งหมด (ตอน implement ต้องยืนยันว่า `production_order_done` ไม่มีด่าน `qty_done ≤ qty_planned` — ถ้ามีให้เตือนบนจอ ไม่แก้ RPC 💰 ตัวนั้น) | ค่าเริ่มที่เสนอ: `job.surplus_disposition text check in ('stock','spare','deliver','hold')` + `surplus_note` — กรอกตอน `job_done` เฉพาะเมื่อ surplus > 0 |

`qty_planned < qty_order` **ยอมให้ได้** (โลหะไม่พอ/ผลิตบางส่วน) แต่บอร์ดขึ้นป้าย `under_planned` — ตัดทิ้ง: CHECK บังคับ `≥` เพราะจะบังคับให้โกหกตัวเลขเมื่อของจริงไม่พอ

### 1.3 ของเสียต่อขั้นที่ J1 มี — พอสำหรับข้อ ก
`qty_scrap` + เหตุผล (code/ข้อความ) ต่อขั้น · โซ่ `qty_in = qty_out` ก่อนหน้า บังคับด้วย trigger · `job_done` บังคับผลรวม · ช่างบันทึกผ่าน `/w/` ตอน "ส่งต่อ" (J1 §6.2 ข้อ 4) ⇒ **ไม่เพิ่มคอลัมน์ของเสีย**
ที่ขาดและเพิ่ม: (1) ของเสียที่ **ยังเป็นโลหะ** (หล่อเสีย = เนื้อกลับเบ้า) — J1 มี `scrap_weight_g` แต่ไม่รู้ว่าส่งหลอมคืนหรือทิ้ง → `job_metal_issue.kind='return'` (§2.2) · (2) ของเสียที่ **ฝังพลอยไปแล้ว** → พลอยเสียตาม/แกะคืน — `job_gem_usage` เฟส G2 (§7) ไม่ทำรอบแรก

### 1.4 แคตตาล็อกพลอยใหม่ ↔ `oem_cost_calc` (tier เดิม) — ต่อทีหลัง ไม่ต่อรอบนี้
- `gem_item.oem_tier` (`'เล็ก'|'กลาง'|'ใหญ่'|null`) = สะพานเดียว: BOM ของ SKU → นับเม็ดต่อ tier → **เสนอ** `make_spec.gem_tier/gem_count` ให้คนกดยืนยัน (ไม่เขียนอัตโนมัติ — `oem_cost_calc` รับ tier เดียว · BOM ผสม 3 tier ต้องให้คนเลือก หรือรอ G3)
- **G3 (เฟสหลัง · 💰 · golden replay บังคับ)**: `oem_cost_calc` รับ `p_input.gems[] = [{gem_item_id, count}]` คิด `Σ count × ราคา ณ วัน` แทน `gem_price_thb_per_seed` เมื่อมี — input ที่ไม่มี `gems[]` ต้องเดินทางเดิมเป๊ะ (ใบที่ออกแล้วเท่าเดิมทุกแถว) · จนกว่า G3 จะมา **ราคาในแคตตาล็อกพลอยมีผลกับ "รายงานต้นทุนจริงต่อใบงาน" เท่านั้น** ไม่มีผลกับใบเสนอราคา/ต้นทุน SKU
- ห้ามทำ: ให้ `gem_price_thb_per_seed[tier]` อ่านค่าเฉลี่ยจาก `gem_item_price` อัตโนมัติ — rate เดิมเป็นค่าที่เจ้าของตั้ง ค่าเลื่อนเองตามแคตตาล็อกทำให้ต้นทุนใบเสนอราคาขยับโดยไม่มีใครกด

## 2. Data model (สคีมา `analytics` · grant `service_role` เท่านั้น · RLS เปิดไม่มี policy · เขียนผ่าน RPC `security definer` + trigger guard เหมือน J1)

ตัวเลขทุกช่องที่รับจาก client: `not (x > 0 and x <= เพดาน)` กัน NaN/Infinity (migration-traps ข้อ 4) · น้ำหนัก `numeric(10,3)` เพดาน 100,000 g เหมือน J1 · ราคา `numeric(12,4)` เพดาน 1,000,000 THB/หน่วย · วันที่ = `analytics.job_today()` (ไทย) ห้าม `current_date`

### 2.1 คอลัมน์ใหม่บน `job` (alter table — J1 apply แล้ว แก้ไฟล์เดิมไม่ได้)
| คอลัมน์ | ชนิด / ด่าน | ความหมาย |
|---|---|---|
| `qty_order` | `int not null check (between 1 and 100000)` · backfill `= qty_planned` ในทรานแซกชันเดียวกับ `add column` (เช็ค `pg_trigger` ก่อน UPDATE — ข้อ 19: `job` มี `set_updated_at`? ถ้ามี → `disable trigger` ระหว่าง backfill) | จำนวนที่สั่ง (§1.2) |
| `target_piece_g` | `numeric(10,3) null check (null or (> 0 and <= 10000))` | น้ำหนักเป้าหมายต่อชิ้น (สำเนาจาก `input.weight_g` / `product.silver_weight_g` / กรอกเอง) · null = ไม่วางแผนโลหะ (งานทองเหลือง/ไม่ชั่ง) |
| `metal_plan_g` | `numeric(10,3) null` · CHECK `(target_piece_g is null) = (metal_plan_g is null)` | โลหะรวมที่ต้องเตรียม — **DB คำนวณใน RPC เท่านั้น** ไม่รับจาก client |
| `metal_plan_basis` | `jsonb null` `{target_piece_g, qty_planned, sprue_loss_pct, sprue_rate_as_of, formula:'qty*piece*(1+sprue/100)', override_g, override_reason}` | snapshot ว่าคำนวณจากอะไร (rate เปลี่ยนทีหลังใบเก่าไม่ขยับ) · ออฟฟิศทับตัวเลขได้ (`override_g` + เหตุผลผ่าน `oem_note_present`) ก่อนขั้น `cast` ถูกรับ |
| `surplus_disposition` · `surplus_note` | `text check in ('stock','spare','deliver','hold')` · `text` · CHECK: done ∧ `qty_good > qty_order` ⇒ disposition not null | ของเหลือไปไหน (§6 Q1 — ค่าเริ่ม `hold`) |
| `cost_snapshot` | `jsonb null` — **เฟส G2** (§2.7) | ต้นทุนจริง ณ ปิดงาน |

`job_guard` (trigger 0172) ต้องแก้: ยอม UPDATE `qty_planned`/`target_piece_g`/`metal_plan_*` เฉพาะเมื่อยังไม่มี `job_stage.status in ('received','sent')` และ status ไม่ปลายทาง · `surplus_*` เขียนได้เฉพาะในทรานแซกชัน `job_done` (ตรวจด้วย `status` เปลี่ยน open→done ในแถวเดียวกัน)

### 2.2 `job_metal_issue` — ledger โลหะต่อใบงาน (append-only · ยกเลิกด้วยแถวกลับ ไม่ UPDATE/DELETE)
| คอลัมน์ | ชนิด / ด่าน |
|---|---|
| `id` · `shop_id` · `job_id` (FK composite `(job_id, shop_id)` → job แบบ J1) · `job_stage_id` (FK `(id, job_id)` → job_stage · stage ต้อง `metal_present=true` ใน def — trigger) | |
| `kind` | `text check in ('issue','top_up','return','void')` — `issue` เบิกครั้งแรก/ครั้งถัดไป · `top_up` เติมระหว่างขั้น (= `metal_added_g` ของ J1) · `return` เศษ/ก้านต้น/ชิ้นเสียที่คืนเข้าคลังหลอม · `void` แถวกลับของ `void_of_id` (จำนวนเท่ากันเครื่องหมายตรงข้าม + เหตุผล) |
| `metal` | `text check in ('silver','gold','brass')` · trigger: ต้อง `= job.metal` (ห้ามเบิกเงินให้งานทอง) |
| `fineness` | `numeric(6,4) check (> 0 and <= 1)` เช่น 0.925 · 0.999 · 0.750 (18K) · 0.585 (14K) · 0.375 (9K) · **ทอง: not null** · เงิน: default 0.925 (ค่าเริ่ม — เงินเม็ด 999 เลือกได้) · ทองเหลือง: null ได้ |
| `fineness_label` | `text` ป้ายที่คนอ่าน ('925','18K') — snapshot จาก `job_metal_fineness_option` (ตารางตัวเลือกต่อร้าน seed: เงิน 925/999 · ทอง 24K/18K/14K/9K · ทองเหลือง -) เจ้าของเพิ่มได้ที่ `/jobs/stages` เฟสหลัง |
| `weight_g` | `numeric(10,3) not null check (> 0 and <= 100000)` — ค่าบวกเสมอ ทิศทางอยู่ที่ `kind` (บทเรียน skill oversell: signed delta ทำให้ idempotency พลาด — ที่นี่ใช้ kind + void_of แทน) |
| `occurred_on` · `recorded_at` (`clock_timestamp()`) · `actor` · `worker_id` · `channel` · `device_hint` | ชุดเดียวกับ `job_event` (ข้อ 2.4 ของ J1) · CHECK `actor is not null or worker_id is not null` |
| `note` | `text` ผ่าน `oem_note_valid` ≤ 200 · **บังคับ** เมื่อ `kind in ('top_up','void')` และเมื่อ `kind='return'` ที่ `weight_g > Σ issue` (คืนมากกว่าเบิก = ต้องอธิบาย) |
| `void_of_id` | `uuid null` FK self · unique (แถวหนึ่งถูก void ได้ครั้งเดียว) · CHECK `(kind='void') = (void_of_id is not null)` |
| `event_id` | FK → `job_event` (ทุกแถวมี event คู่ `event_type='metal_issue'` — เพิ่มค่าใน CHECK ของ `job_event.event_type`) |

**ทางเดียว ledger → `job_stage`** (trigger AFTER INSERT): stage ที่มีแถว ledger ⇒ `weight_in_g = Σ issue − Σ void(issue)` · `metal_added_g = Σ top_up` · `scrap_weight_g = Σ return (ที่ผูก stage นั้น)` · `weight_note = 'ledger'` ⇒ `js_weight_ck`/`js_weigh_in_ck` ของ J1 ทำงานต่อโดยไม่ต้องแก้ · `job_stage_guard` ปฏิเสธ UPDATE คอลัมน์ 3 ตัวนี้ตรงๆ บน stage ที่มี ledger (ตรวจ `exists(select 1 from job_metal_issue where job_stage_id = new.id)`) — stage ที่ไม่มี ledger ยังกรอกน้ำหนักแบบ J1 ได้ (งานเงินที่ไม่อยากบันทึกเบิก)

### 2.3 `v_job_metal_balance` — ดุลโลหะต่อใบ (DB คำนวณ · จอแค่แสดง)
ต่อ job: `issued_g = Σ issue` · `top_up_g` · `returned_g = Σ return` · `cast_out_g = job_stage(cast).weight_out_g` · `cast_qty_out = job_stage(cast).qty_out` · **`avg_piece_g = round(cast_out_g / cast_qty_out, 3)`** (null ถ้ายังไม่ชั่ง/qty_out = 0 — ไม่ใช่ 0 · ข้อ 13) · `loss_g = issued + top_up − cast_out − returned` · `loss_pct = loss_g / (issued + top_up) × 100` · `plan_vs_issued_g = issued − metal_plan_g` · `piece_vs_target_g = avg_piece_g − target_piece_g` · `fineness_mix` (jsonb: กรัมต่อ fineness — งานที่เบิก 925 กับ 999 ผสมต้องเห็น) · `not_weighed` ถ้า cast ยังไม่ชั่งออก (R3 ของ J1: แสดง ไม่ซ่อน)
ส่วนต่าง "หายจริง" ที่เจ้าของถาม = `loss_g` **หลังหัก return แล้ว** — ถ้าช่างยังไม่บันทึก return จะดูเหมือนหายเยอะ ⇒ จอต้องโชว์ `returned_g` ข้างกัน และป้าย "ยังไม่บันทึกเศษคืน" เมื่อ `returned_g = 0` และขั้น `cut_sprue` ส่งต่อแล้ว

### 2.4 แคตตาล็อกพลอย (3 ตาราง + ราคา) — ใต้ "จัดการต้นทุน"
| ตาราง | คอลัมน์ | หมายเหตุ |
|---|---|---|
| `gem_shape` | `shop_id` · `code text` (`^[a-z][a-z0-9_]{1,30}$`) · `name_th` · **`has_length boolean not null`** (true = ต้องใส่ 2 ด้าน กว้าง×ยาว · false = ค่าเดียว) · `seq` · `is_active` · PK `(shop_id, code)` | seed ต่อร้านแบบ `job_stage_def_ensure`: `round`(กลม,false) `square`(สี่เหลี่ยมจัตุรัส/princess,false) `hexagon`(6 เหลี่ยม,false) `trillion`(สามเหลี่ยม,false) `heart`(หัวใจ,false) `oval`(ไข่,true) `emerald`(เอมเมอรัลด์,true) `cushion`(true) `pear`(หยดน้ำ,true) `marquise`(มาร์คีส์,true) `baguette`(true) `rectangle`(สี่เหลี่ยมผืนผ้า,true) — ค่า has_length ของ heart/cushion ให้เจ้าของยืนยัน (§6) · เจ้าของเพิ่ม/ปิดได้ (ไม่ลบ — FK restrict) |
| `gem_type` | `shop_id` · `code` · `name_th` · `name_en null` · `is_natural boolean null` · `is_active` · PK `(shop_id, code)` | seed: `cz` · `garnet`(โกเมน) · `blue_topaz` · `amethyst` · `peridot` · `citrine` · `white_topaz` · `onyx` · `pearl` — รายการจริงให้เจ้าของเติม · **ไม่ seed ราคา** (ห้าม default หลอกตา — หลัก 0061) |
| `gem_item` | `id uuid` · `shop_id` · `gem_type_code` · `shape_code` (FK composite ทั้งคู่) · **`size_mm_a numeric(5,2) not null check (> 0 and <= 100)`** (กว้าง · ทรงกลม/จัตุรัสใช้ค่าเดียว) · **`size_mm_b numeric(5,2) null check (null or (> 0 and <= 100))`** (ยาว — ทรงไข่/เอมเมอรัลด์/หยดน้ำ) · `size_label text generated always as` (`'4×6'` หรือ `'1.5'` — DB ประกอบ ไม่ให้คนพิมพ์คนละแบบ) · `unit text check in ('piece','carat') default 'piece'` · `oem_tier text null check in ('เล็ก','กลาง','ใหญ่')` (สะพาน §1.4 — ซ่อนจากฟอร์มปกติ ไม่ใช่การจัดขนาด) · `sku_code text null` (รหัสผู้ขาย) · `is_active` · `note` · `created_by/at` · `updated_at` · unique `(shop_id, gem_type_code, shape_code, size_mm_a, coalesce(size_mm_b, 0), unit)` | 1 แถว = 1 ของที่สั่งซื้อได้ · **สร้างได้ทันทีจากฟอร์ม BOM** ผ่าน `gem_item_upsert` (owner/admin) โดยยังไม่มีราคา · ปิดได้ไม่ลบ (BOM เก่าอ้างอยู่) · ทศนิยม 2 ตำแหน่ง (1.5 · 2.25 มม.) |
| `gem_item_price` | `gem_item_id` · `shop_id` · `effective_from date` · `price_thb_per_unit numeric(12,4) check (> 0 and <= 1000000)` · `supplier text null` · `note` · `updated_by` · `updated_at` · PK `(gem_item_id, effective_from)` | ประวัติแบบ `oem_cost_rate` (ข้อ 2 ของ 0061: ไม่มี NULL ใน PK) · `gem_price_value(gem_item_id, as_of)` = แถวล่าสุดที่ `effective_from <= as_of` (ลอก `oem_rate_value`) · ไม่มีราคา = null ⇒ รายงานต้นทุนขึ้น `missing[]` ไม่ใช่ 0 |

**ทำไม 3 ตารางไม่ใช่ `gem_item` ตารางเดียวใส่ text**: รูปทรง/ชนิดเป็นแกนกรองของหน้าสรุปสั่งซื้อ ("โกเมน ไข่ ทุกขนาดรวมกี่เม็ด") และเจ้าของสั่งว่า "รูปทรงเพิ่มได้" = ต้องเป็นข้อมูลไม่ใช่ enum · ตัดทิ้ง: ยัดเข้า `oem_rate_def`/`oem_cost_rate` (scope เป็น text ตัวเดียว ใส่ ชนิด×รูปทรง×ขนาด ไม่ได้ · และ `oem_rate_def` เป็น global ไม่มี shop_id)
**ทำไมไม่เก็บราคาใน `gem_item` ตรงๆ**: เจ้าของสั่ง "มีวันที่ราคา" + รายงานต้นทุนจริงต้องอ่านราคา ณ วันใช้ ไม่ใช่วันนี้ (ใบปิดไปแล้วราคาขึ้น ต้นทุนใบเก่าต้องไม่ขยับ)

### 2.5 BOM พลอย — แม่แบบที่ SKU · สำเนาที่ใบงาน · สรุปสั่งซื้อ
| ตาราง | คอลัมน์ | กติกา |
|---|---|---|
| `product_gem_bom` (แม่แบบ) | `id` · `shop_id` · `product_id` (FK `public.product`) · `line_seq int` · `gem_item_id` · `qty_per_piece int check (between 1 and 1000)` · `position_note text null` ('บ่าซ้าย/ขวา' — ไม่บังคับ) · unique `(product_id, gem_item_id)` | **BOM = รายการแถว ชนิด·รูปทรง·ขนาด·จำนวน/ชิ้น ไม่มี slot ใหญ่/กลาง/เล็กตายตัว** (มติ 13 ต.ค.) · เขียนผ่าน `product_gem_bom_set(p_product_id, p_lines jsonb[])` แทนทั้งชุด (all-or-nothing) + `catalog_audit_log` แบบ 0141 · `gem_item` ต้อง `is_active` ตอนเขียน · ขนาดที่ยังไม่มีในแคตตาล็อก: ฟอร์มเรียก `gem_item_upsert` ก่อนแล้วค่อย set (2 RPC ในทรานแซกชันเดียวฝั่ง server action) |
| `job_gem_bom` (สำเนา) | `id` · `shop_id` · `job_id` · `line_seq` · `gem_item_id` · `qty_per_piece` · `position_note` · **snapshot ข้อความ** `gem_label text` ('โกเมน · ไข่ · 4×6 มม.') · `breakage_allow_pct numeric(5,2) default 0 check (between 0 and 100)` · `source text check in ('product','manual')` · unique `(job_id, gem_item_id)` | copy ตอน `job_create_*`: production → จาก `product_gem_bom` · OEM → ถ้า item มี `product_id` ใช้ของ SKU · ไม่มี = ว่าง + ป้าย "ยังไม่ระบุพลอย" เมื่อ stage list มี `gem_set` · ออฟฟิศแก้ผ่าน `job_gem_bom_set` ได้จนกว่า `gem_set` ถูก "รับ" · หลังจากนั้นต้องมีเหตุผล (event `bom_change` payload before/after) · ห้ามแก้เมื่อ job done/cancelled |
| `job_gem_bom.gem_label` | snapshot | ใบพิมพ์/หน้าช่างอ่านจากนี่ ไม่ join แคตตาล็อก (ชื่อพลอยถูกแก้ทีหลังใบงานเก่าไม่เปลี่ยน · และ view ฝั่งช่างไม่แตะตารางที่มีราคาอยู่ข้างๆ) |

**ทำไม `breakage_allow_pct` อยู่ที่ job ไม่ใช่ shop setting**: เผื่อแตกต่างกันตามพลอย (CZ แทบไม่แตก · พลอยแท้บางชนิดแตกตอนฝัง) — ค่าเริ่มมาจาก `gem_type.breakage_default_pct null` (เพิ่มคอลัมน์ · null = 0 · ตัวเลขรอเจ้าของ §6 Q2) copy ลงใบตอนสร้าง · แก้ต่อใบได้

**Views (owner/admin · ฝั่ง server เท่านั้น)**
- `v_job_gem_requirement` — ต่อ job × แถว BOM: `qty_needed = qty_planned × qty_per_piece` · `qty_with_allow = ceil(qty_needed × (1 + breakage_allow_pct/100))` · สถานะขั้น `gem_set` ของใบ (`pending/received/sent/skipped/none`) · `gem_set_due`
- `v_gem_purchase_summary` — รวมข้าม job ที่ `status in ('open','in_progress','on_hold')` **และ** ขั้น `gem_set` ยัง `pending`: group by `gem_item` → `gem_type/shape/size/unit` · `qty_needed_total` · `qty_with_allow_total` · `job_count` · `job_nos text[]` · `earliest_due` · **ไม่มีคอลัมน์ราคา** (ตารางหน้าสั่งซื้อเอาไปวางให้ซัพพลายเออร์ได้) — ราคาอยู่ใน view แยก `v_gem_purchase_summary_cost` (owner เท่านั้น) join `gem_price_value(id, today)` + `missing_price boolean`
- `v_product_gem_bom` — แม่แบบต่อ SKU พร้อม label สำหรับหน้า `/catalog`

### 2.6 RPC `job_plan_suggest` — ฟอร์มสร้างใบงานถาม DB ไม่คิดเอง
`job_plan_suggest(p_shop_id, p_source_kind, p_item_id, p_qty_planned int default null, p_target_piece_g numeric default null)` → jsonb:
```
{ qty_order, qty_planned_suggest, reject_basis: {reject_rate_cast_pct, reject_rate_polish_pct, reject_rate_plate_pct|null, has_plating},
  target_piece_g (จาก input.weight_g / silver_weight_g / null), metal, metal_plan_g, metal_plan_basis,
  gem_bom: [{gem_item_id, gem_label, qty_per_piece, qty_needed, qty_with_allow, missing_price}], missing: ['sprue_loss_pct[silver]', ...] }
```
- `qty_planned_suggest = ceil(qty_order / ((1 − rc)(1 − rp)(1 − rplate)))` ใช้ rate ที่มีใน `oem_cost_rate` (`reject_rate_*_pct` — 0140 บ.202–208) · rate ว่าง → ไม่เสนอ + `missing[]` (ไม่เดา 0)
- `metal_plan_g = qty_planned × target_piece_g × (1 + sprue_loss_pct[metal]/100)` ปัด 3 ตำแหน่ง · **ไม่ใช้ `recovery_rate_pct`** (นั่นคือสมมติฐานต้นทุน ไม่ใช่โลหะที่ต้องวางบนโต๊ะวันแรก) · **ไม่ใช้ `polish_loss_pct`** (หายตอนขัด ไม่ต้องเบิกเพิ่ม)
- ฟังก์ชันเป็น `stable` อ่านอย่างเดียว · ค่าที่คืน = ค่าเริ่มของฟอร์ม · ค่าที่บันทึกจริงคือสิ่งที่ `job_create_*` คำนวณซ้ำฝั่ง DB จาก `p_qty_planned`/`p_target_piece_g` ที่ส่งมา (client ส่งได้แค่ input ไม่ส่งผลลัพธ์ — หลัก invariant ข้อ 2)
- `job_create_from_quote_item` / `job_create_from_production_item` (J1) เพิ่ม arg `p_target_piece_g`, `p_qty_order` **ไม่รับ** (อ่านเองจาก item), `p_gem_bom jsonb default null` (null = copy จาก SKU) — **เปลี่ยน arg list = drop signature เดิมก่อน** (ข้อ 1) + re-grant (ข้อ 2) · caller เดิมใน `lib/jobs/*` ต้องอัปเดตพร้อมกัน

### 2.7 ต้นทุนจริงต่อใบ (เฟส G2 — owner เท่านั้น)
`job_cost_snapshot(job)` คำนวณตอน `job_done` แล้วเก็บ `job.cost_snapshot`:
`{ metal: {fineness_mix, net_used_g = issued + top_up − returned, price_thb_per_gram (จาก oem_metal_price ณ วันเบิกครั้งแรก · ทองใช้ fineness คูณ), thb},
   gems: [{gem_item_id, gem_label, qty = qty_with_allow หรือ job_gem_usage ถ้ามี, price_as_of = วันที่ gem_set received, thb, missing_price}],
   labor: null (ยังไม่คิด — ค่าแรงอยู่ใน oem_cost_calc ตาม tier ไม่ใช่ตามชั่วโมงจริง · เฟสหลัง), total_known_thb, missing[] }`
- ไม่เขียนกลับ `product.unit_cost`/`stock_lot` — ช่องทางเดียวที่ทำนั่นยังเป็น `production_order_done` (💰) · รายงานเทียบ "ต้นทุนจริง vs `cost_calc` ที่ใบผลิตประมาณ" เป็นหน้าอ่าน
- `job_gem_usage` (G2): ต่อ job × gem_item: `qty_used` · `qty_broken` · `qty_returned` · บันทึกที่ขั้น `gem_set` ตอน "ส่งต่อ" (ช่างกรอกตัวเลข ไม่เห็นราคา)

## 3. กติกาที่ DB ต้องบังคับ — เคสห้ามผ่าน + ด่านที่จับ (ต่อจาก J1 §3 ข้อ 1–20 · เลขต่อ)

ทุก RPC ใหม่: `security definer` · pin `search_path` · revoke `public, anon, authenticated` (ข้อ 18.1) · office = `crm_require_owner_admin` + `p_actor` · ช่าง = ผ่าน `job_worker_auth` เดิม (token + session) ไม่มี auth.uid() · `for update` แถว `job` ก่อนแตะ ledger/BOM

| # | เคสที่ต้องถูกปฏิเสธ | ด่าน |
|---|---|---|
| 21 | `job_metal_issue.weight_g` ≤ 0 · NaN · Infinity · > 100,000 · ทศนิยม > 3 | CHECK `not (weight_g > 0 and weight_g <= 100000)` ⇒ raise + `job_weight_ok` เดิมใน RPC |
| 22 | เบิกโลหะที่ `metal ≠ job.metal` · `fineness` ว่างในงานทอง · fineness นอก (0,1] · `fineness_label` ไม่อยู่ในตัวเลือกของร้าน | trigger BEFORE INSERT + CHECK |
| 23 | เบิกบน stage ที่ `metal_present=false` (เช่น `wax_inject`) · stage ของ job อื่น · stage ที่ `skipped` · job `done/cancelled` | trigger (join def) + `job_office_begin`/`job_worker_auth` |
| 24 | `cast.weight_out_g > Σ issue + Σ top_up` (หล่อออกมามากกว่าที่เบิก) · `return` รวม > `Σ issue + top_up` โดยไม่มี note | `js_weight_ck` เดิม (เพราะ ledger sync `weight_in_g/metal_added_g`) + RPC `job_metal_return` ตรวจยอดสะสม + note |
| 25 | UPDATE/DELETE/TRUNCATE `job_metal_issue` ทุกกรณี · `void` ซ้ำแถวเดิม · `void` แถวที่เป็น void เอง · `void` โดยไม่มีเหตุผล | trigger append-only (แบบ `job_event`) + unique `void_of_id` + CHECK |
| 26 | UPDATE `job_stage.weight_in_g/metal_added_g/scrap_weight_g` ตรงๆ บน stage ที่มี ledger (ตีกันกับ ledger) | `job_stage_guard` ขยาย: มี ledger ⇒ 3 คอลัมน์นี้เขียนได้จาก trigger sync เท่านั้น (ตรวจผ่าน `pg_trigger_depth()` / session flag `set_config('analytics.ledger_sync', ...)`) |
| 27 | ช่างผ่าน QR เบิกโลหะในขั้นที่ไม่ใช่ขั้นปัจจุบันของตัวเอง · ช่าง `void` · ช่างเบิกให้ job ที่ token ไม่ตรง | RPC ช่างรับแค่ `job_worker_metal_issue(token, session, kind in ('issue','top_up','return'), fineness_label, weight_g)` — RPC หาขั้นเอง ไม่รับ `stage_id` · void = office เท่านั้น |
| 28 | `metal_plan_g` ส่งมาจาก client · `target_piece_g` ≤ 0/NaN/> 10,000 · `override_g` ไม่มีเหตุผล · แก้แผนหลัง `cast` ถูกรับ | RPC คำนวณเอง (client ส่ง input) + `job_guard` |
| 29 | `qty_planned` แก้หลังขั้นแรก `received` · แก้แล้ว `metal_plan_g` ไม่ถูกคำนวณใหม่ (drift) | `job_qty_planned_set` ทำสองอย่างในคำสั่งเดียว + CHECK `metal_plan_basis->>'qty_planned' = qty_planned::text` เมื่อ basis ไม่มี override |
| 30 | `job_done` มี `qty_good > qty_order` แต่ `surplus_disposition` ว่าง · `surplus_disposition` ตั้งทั้งที่ไม่มี surplus · เขียน `surplus_*` นอก `job_done` | CHECK บน job + `job_guard` |
| 31 | ราคาพลอย ≤ 0 · NaN · > 1,000,000 · `effective_from` > วันนี้ (ไทย) + 1 ปี หรือ < 2020 · ราคาซ้ำวันเดิม (ใช้ upsert `on conflict (gem_item_id, effective_from) do update` — แก้ราคาวันเดียวกันได้ ไม่สร้าง 2 แถว) | CHECK `not (p > 0 and p <= 1000000)` + RPC `gem_price_set` |
| 32 | `gem_item` ซ้ำ (ชนิด+รูปทรง+ขนาด มม.+หน่วย เท่ากัน) · `size_mm_a` ≤ 0/NaN/> 100 · `size_mm_b` ใส่กับทรงที่ `gem_shape.has_length=false` (กลม/จัตุรัส) หรือไม่ใส่กับทรงที่ต้องมี 2 ด้าน · อ้าง `gem_type/gem_shape` ที่ `is_active=false` ตอนสร้าง · ลบ `gem_item/gem_shape/gem_type` ที่ถูก BOM อ้าง | unique index + CHECK + trigger join `gem_shape.has_length` + RPC + FK restrict (ปิดได้ ลบไม่ได้) |
| 33 | BOM อ้าง `gem_item` ที่ `is_active=false` หรือของร้านอื่น · `qty_per_piece` ≤ 0 · `gem_item` ซ้ำในใบเดียว (รวมจำนวนแทน) · `breakage_allow_pct` นอก [0,100]/NaN | RPC `product_gem_bom_set`/`job_gem_bom_set` + CHECK + FK composite `(gem_item_id, shop_id)` |
| 34 | แก้ `job_gem_bom` หลัง `gem_set` ถูก "รับ" โดยไม่มีเหตุผล · แก้เมื่อ job `done/cancelled` · ช่างแก้ BOM ผ่าน QR (ไม่มี RPC ฝั่งช่าง — จงใจ) | RPC office ตรวจสถานะ stage + `oem_note_present` · event `bom_change` |
| 35 | 🔴 **ราคา/ต้นทุนหลุดหน้าช่างและใบพิมพ์**: `job_worker_resolve` คืน `price`, `thb`, `cost`, `gem_item_price`, `oem_tier`, `supplier`, `metal_plan_basis` · ใบงาน A5 มีราคาพลอย/ราคาโลหะ/ต้นทุนรวม · `v_gem_purchase_summary` (ตัวไม่มีราคา) ถูก join ราคาในหน้าที่ staff เปิดได้ | type `WorkerJobView.gems[]` = `{gem_label, position_note, qty_per_piece, qty_total}` ประกอบทีละ field · `PrintableJob` (ใหม่ — แบบ `PrintableQuote`) ไม่มี field ราคา · เทสต์ยิง `/w/<token>` และ `/jobs/[id]/print` จริงแล้ว grep ตัวเลขราคาจาก `gem_item_price` + `oem_metal_price` ใน HTML/RSC payload · หน้า `/jobs/gems-to-buy` และแท็บราคาใน `/oem/rates` = `getEffectiveRole() !== 'staff'` เหมือน `/oem/rates` เดิม |
| 36 | anon/authenticated อ่าน `gem_item_price`/`job_metal_issue`/view ใหม่ผ่าน REST | grant `service_role` เท่านั้น + `scripts/check-analytics-grants.sql` หลัง apply (ข้อ 18.3) |
| 37 | `job_plan_suggest` คืน `qty_planned_suggest`/`metal_plan_g` เป็น 0 เมื่อ rate ว่าง | ต้องเป็น null + `missing[]` — เทสต์ยิงกับร้านที่ลบ rate ชั่วคราวในทรานแซกชัน (ข้อ 13: ค่าว่างต้องเป็น null จริง ไม่ใช่ 0) |
| 38 | backfill `qty_order := qty_planned` ยิง `updated_at` ทุกแถว `job` | เช็ค `pg_trigger` ของ `job` ก่อน · ล็อก `md5(string_agg(updated_at))` ก่อน/หลัง (ข้อ 19) |

**เคสที่ต้องไม่พัง** (ทดสอบเท่าเคสปฏิเสธ — ข้อ 17 ยิงของใหม่ใส่ของเก่าจริง): ใบงาน J1 ที่มีอยู่บน prod (ทุก status ที่มีจริง) เปิดหน้า/บอร์ด/`/w/` ได้หลัง alter · งานเงินที่ **ไม่บันทึกเบิก** กรอกน้ำหนักแบบ J1 ต่อได้ · งานทองเบิก 2 ครั้ง (issue + top_up) แล้ว `weight_in_g` ของ cast = ผลรวม · เบิก 925 กับ 999 ในใบเดียว → `fineness_mix` 2 แถว · void แถวเบิกแล้วดุลกลับมาเท่าก่อนเบิก · ใบที่ไม่มีขั้น `gem_set` มี BOM ว่างและไม่ขึ้นในสรุปสั่งซื้อ · ใบที่ BOM ว่างแต่มี `gem_set` ขึ้นป้ายเตือน (ไม่บล็อกสร้าง) · SKU ที่ไม่มี `silver_weight_g` สร้างใบงานได้ (`target_piece_g` null · ไม่มีแผนโลหะ) · rate `sprue_loss_pct` ว่าง → สร้างใบงานได้ `metal_plan_g` null + เตือน · `job_create_from_*` signature ใหม่ไม่ทิ้ง overload เก่า (ข้อ 1 ตรวจ `pg_proc`) · `oem_*`/`production_*` md5 เท่าเดิม (baseline แบบ 0172 ส่วน 0) · `production_order_done` ของใบที่มี job + surplus ทำงานเหมือนเดิม · ราคาพลอยตั้ง 3 วันแล้ว `gem_price_value(as_of=วันกลาง)` ได้ราคาที่ถูก · ช่วง 00:00–07:00 ไทย `effective_from = วันนี้` ยังถูกวัน (ข้อ 6)

## 4. หน้าจอ (ระดับรายการ — ux-ui ทำ wireframe ต่อ · สิทธิ์: `/jobs/*` owner/admin เดิม · `/w/*` ช่าง · หน้าที่มีราคา = `getEffectiveRole() !== 'staff'` แบบ `/oem/rates`)

| หน้า | ต้องเห็น / ทำได้ | ราคา? |
|---|---|---|
| **ฟอร์มสร้างใบงาน** (`JobCreateDialog`/`JobCreatePanel` เดิม — ขยาย) | แถว 1: **จำนวนที่สั่ง** (อ่านอย่างเดียวจาก item) → **จำนวนเริ่มผลิต** (ค่าเริ่ม = `qty_planned_suggest` + ป้าย "เผื่อ x ชิ้น จาก reject rate หล่อ/ขัด/ชุบ" · rate ว่าง = ช่องว่าง + ลิงก์ไปกรอกที่ `/oem/rates`) · แถว 2: **น้ำหนักต่อชิ้นเป้าหมาย (g)** (ค่าเริ่มจาก SKU/quote · แก้ได้) → **โลหะที่ต้องเตรียม** (อ่านอย่างเดียว · "= 35 × 4.000 g × (1 + ก้านต้น %)" · ปุ่ม "กำหนดเอง" + เหตุผล) · แถว 3: **พลอยต่อชิ้น** ตาราง ชนิด · รูปทรง · ขนาด มม. · จำนวน/ชิ้น (ค่าเริ่มจาก SKU · เพิ่มแถว: เลือกจากแคตตาล็อก หรือ "+ ขนาดใหม่" เปิดฟอร์มย่อย ชนิด/รูปทรง/กว้าง×ยาว → `gem_item_upsert`) → **สรุปพลอยทั้งใบ** (ต่อแถว: จำนวน/ชิ้น × จำนวนเริ่มผลิต = รวม · + เผื่อแตก % = ต้องสั่ง) · ทุกตัวเลขสรุปมาจาก `job_plan_suggest` re-fetch เมื่อ input เปลี่ยน (debounce) ไม่คูณใน client | ไม่แสดง (ฟอร์มนี้ staff ใช้ได้ตาม J1) |
| **`/jobs/[id]` การ์ดใหม่ "โลหะ"** | แผน vs เบิกจริง (g) · ตาราง ledger (วัน · ชนิด/ความบริสุทธิ์ · เบิก/เติม/คืน · ใคร · ช่องทาง) · ปุ่ม office: เบิก / เติม / คืนเศษ / ยกเลิกรายการ(void+เหตุผล) · ดุล: หล่อออก · คืน · **หายจริง g (%)** · **เฉลี่ยต่อชิ้น** vs เป้าหมาย · ป้าย "ยังไม่บันทึกเศษคืน" | ไม่แสดงราคาโลหะ (การ์ดนี้ staff เห็นได้) |
| **`/jobs/[id]` การ์ดใหม่ "พลอย"** | ตาราง BOM (ชนิด · รูปทรง · ขนาด · /ชิ้น · รวม · +เผื่อ) · ปุ่มแก้ (หลัง `gem_set` รับแล้ว = บังคับเหตุผล) · สถานะ "สั่งซื้อแล้ว?" **ไม่ทำรอบนี้** (ไม่มีระบบ PO พลอย — ดู §7) | ไม่แสดง |
| **`/w/[token]` ขั้น `cast` (ช่าง · มือถือ)** | ปุ่ม "รับงาน" ของขั้นหล่อเปลี่ยนเป็น **"เบิกโลหะ"**: เลือกความบริสุทธิ์ (ปุ่มใหญ่จาก `job_metal_fineness_option` ของโลหะนั้น · เงินค่าเริ่ม 925) + น้ำหนัก (g, `inputmode=decimal`) → ยืนยัน = `job_worker_metal_issue(kind='issue')` ซึ่ง RPC ทำ "รับงาน" ให้ด้วยถ้ายัง pending (1 สแกน 1 ปุ่ม — หลัก J1 §5.1) · ระหว่างถือ: ปุ่ม "เติมโลหะ" (น้ำหนัก + เหตุผลเป็นชิป) · "ส่งต่อ" = ชั่งรวมหลังหล่อ (น้ำหนักออก เดิม) + **"เศษ/ก้านต้นคืน (g)"** ไม่บังคับ · จอโชว์ "เฉลี่ยต่อชิ้น x.xxx g" หลังส่ง (ไม่โชว์แผน/ราคา) · งานทอง: ไม่โชว์น้ำหนักเบิกสะสมก่อนชั่งออก (N1 ของ 0174 ยังใช้) | ไม่มี |
| **`/w/[token]` ทุกขั้น** | ตารางพลอยของใบ (ชนิด · รูปทรง · ขนาด · /ชิ้น · รวม) — ช่างฝังเห็นว่าต้องใช้อะไร | ไม่มี (`WorkerJobView.gems[]` §3 ข้อ 35) |
| **ใบงาน A5 `/jobs/[id]/print`** | เพิ่ม: จำนวนสั่ง / เริ่มผลิต · น้ำหนักเป้าหมาย/ชิ้น · โลหะที่ต้องเตรียม (g) · ช่องเขียน "เบิกจริง ___ g / ความบริสุทธิ์ ___" · ตารางพลอย (ชนิด · รูปทรง · ขนาด · /ชิ้น · รวม) | ไม่มี — `PrintableJob` ประกอบทีละ field |
| **`/jobs/gems-to-buy` "พลอยที่ต้องสั่งซื้อ"** (ใหม่) | ตารางจาก `v_gem_purchase_summary`: ชนิด · รูปทรง · ขนาด · หน่วย · ต้องใช้ · +เผื่อ · จากกี่ใบ (เลขงาน) · กำหนดเร็วสุด · กรอง: ช่วงวันสร้างใบ/กำหนดส่ง · เฉพาะใบที่ `gem_set` ยังไม่เริ่ม (ค่าเริ่ม) / รวมที่เริ่มแล้ว · โลหะ · แหล่ง OEM/ผลิตเอง · ปุ่ม **พิมพ์** (A4) + **คัดลอกเป็นข้อความ** (บรรทัดละรายการ วางใน LINE ส่งซัพพลายเออร์) · สลับ "แสดงราคาประมาณ" (owner/admin · โหลด `_cost` view แยก · ราคาว่าง = "ยังไม่มีราคา" ไม่ใช่ 0 · ข้อความคัดลอก/พิมพ์ **ไม่รวมราคาเสมอ**) | แยก toggle · ค่าเริ่มปิด |
| **`/oem/rates` แท็บ "แคตตาล็อกพลอย"** (ใหม่ · ภายในหน้า "จัดการต้นทุน"/"เครื่องคิดต้นทุนโรงงาน" เดิม) | 3 ส่วน: รูปทรง (เพิ่ม/เปลี่ยนชื่อ/ปิด · has_length) · ชนิดพลอย (เพิ่ม/ปิด · เผื่อแตก % ค่าเริ่ม) · **รายการพลอย** ตาราง ชนิด · รูปทรง · กว้าง×ยาว · หน่วย · ราคาปัจจุบัน/หน่วย · ตั้งแต่วัน · ผู้ขาย · ปุ่ม "ตั้งราคาใหม่" (วันที่มีผล ค่าเริ่ม = วันนี้ไทย · ราคา) · ดูประวัติราคา · ปิดรายการ · กรอง/ค้นหา · แถวที่ **ยังไม่มีราคา** ขึ้นป้ายเด่น (เหมือน readiness ของ rate เดิม) | ✅ owner/admin เท่านั้น |
| **`/catalog/[sku]` ส่วน "พลอยต่อชิ้น"** | ตาราง BOM แม่แบบ (แก้ผ่าน `product_gem_bom_set`) · ปุ่ม "เสนอ gem_tier/gem_count ให้ make_spec" (§1.4 — แสดงค่าที่คำนวณ ให้คนกดยืนยัน) | ไม่แสดงราคา (หน้า catalog มี unit_cost อยู่แล้วตามสิทธิ์เดิม) |
| **`/jobs/[id]/cost` รายงานต้นทุนจริงต่อใบ** (เฟส G2 · owner เท่านั้น — `role === 'owner'` ไม่ใช่ admin? → §6 Q8) | โลหะ: เบิก − คืน = ใช้จริง g × ราคา/g ณ วันเบิก (แยก fineness) · พลอย: แถว × จำนวนที่ใช้ × ราคา ณ วันฝัง · รวมที่รู้ · **รายการที่ไม่มีราคา** (missing[]) · เทียบกับ `cost_calc` ของใบผลิต (ถ้ามี) หรือ `calc.cost_piece` ของ quote item (อ่านอย่างเดียว) · ไม่มีปุ่มเขียนกลับ SKU/สต็อก | ✅ |
| **`/jobs` บอร์ด** | ป้ายเพิ่ม: `under_planned` · "ยังไม่ระบุพลอย" · "ยังไม่เบิกโลหะ" (ขั้น cast รับแล้วแต่ไม่มี ledger ในงานทอง) · `qty_surplus` บนใบ done | ไม่มี |

## 5. แผน phase (ต่อจาก J1 — เล็กสุดที่ใช้จริงได้ก่อน · ระดับ QA ตาม `3j-qa-regression-map` · security ก่อน merge ทุกเฟสที่มีราคา)

| เฟส | ส่งมอบ | ขนาด | QA / security | ทำไมลำดับนี้ |
|---|---|---|---|---|
| **M0** | เจ้าของตอบ §6 · Tech Lead ยืนยันหน่วย มม. · ux-ui ร่างฟอร์มสร้างใบงาน + จอเบิกโลหะบนมือถือ (ให้ช่างหล่อดู 1 คน) | S | — | ค่า % และของเหลือไปไหน ตัดสินแทนไม่ได้ |
| **M1 โลหะ + จำนวน** (ข้อ ก ข ค) | migration `0175`: `job.qty_order/target_piece_g/metal_plan_g/metal_plan_basis/surplus_*` + backfill · `job_metal_fineness_option` (seed) · `job_metal_issue` + trigger sync/append-only/guard · `job_event.event_type` + `metal_issue`,`bom_change`,`plan_change` · RPC `job_plan_suggest` · `job_metal_issue_add`/`_void` (office) · `job_worker_metal_issue` (ช่าง) · `job_qty_planned_set` · `job_plan_set` · แก้ `job_create_from_*` (signature ใหม่ drop เดิม) · `job_done` รับ `p_surplus_disposition/_note` · `v_job_metal_balance` · ต่อท้าย `v_job_board` (`qty_order`,`qty_surplus`,`under_planned`,`metal_not_issued`) · verify `scripts/verify/verify-0175.sql` + ตารางแมปบรีฟ→เทสต์ · **UI**: ฟอร์มสร้างใบงาน (จำนวน/น้ำหนัก/โลหะรวม) · การ์ดโลหะใน `/jobs/[id]` · `/w/` ขั้น cast · ใบ A5 เพิ่มช่องโลหะ | M–L | QA **L** (แตะ `job_create`, `/w/`, print, board — ทุก flow J1) · **security บังคับ** (RPC เขียนใหม่ฝั่งช่าง + น้ำหนักทอง = มูลค่า) · ไม่ 💰 (ไม่มีราคา/สต็อก/เอกสารภาษี) | เล็กสุดที่ตอบโจทย์ ก–ค ครบ · ไม่ต้องรอแคตตาล็อกพลอย · ทองที่เดินอยู่จะได้ ledger ตั้งแต่ใบแรก (append-only ย้อนเติมไม่ได้ — เหตุผลเดียวกับ J1 §7) |
| **G1 แคตตาล็อกพลอย + BOM + สรุปสั่งซื้อ** (ข้อ ง จ) | migration `0176`: `gem_shape`/`gem_type`/`gem_item`/`gem_item_price` (+seed รูปทรง/ชนิด ไม่ seed ราคา) · `product_gem_bom` · `job_gem_bom` · RPC `gem_shape_upsert`/`gem_type_upsert`/`gem_item_upsert`/`gem_item_set_active`/`gem_price_set` · `product_gem_bom_set` · `job_gem_bom_set` · `gem_price_value` · views `v_product_gem_bom`/`v_job_gem_requirement`/`v_gem_purchase_summary`/`_cost` · `job_create_*` รับ `p_gem_bom` · `job_plan_suggest` คืน `gem_bom[]` · `job_worker_resolve` คืน `gems[]` · verify `verify-0176.sql` · **UI**: แท็บแคตตาล็อกพลอยใน `/oem/rates` · BOM ใน `/catalog/[sku]` · BOM ในฟอร์มสร้างใบงาน + การ์ดพลอยใน `/jobs/[id]` · ตารางพลอยใน `/w/` และ A5 · หน้า `/jobs/gems-to-buy` | L | QA **L** · **security 💰** (ราคาพลอย = ต้นทุน · ด่าน §3 ข้อ 35/36 ต้องยิงหน้าจริง) | เป็นก้อนเดียวเพราะ BOM ไม่มีความหมายถ้าไม่มีแคตตาล็อก และสรุปสั่งซื้อคือเหตุผลที่เจ้าของอยากได้ BOM · แยก G1a (DB + catalog tab) → security → G1b (UI ใบงาน/ช่าง/สรุป) ได้ถ้าใหญ่เกินรอบ |
| **G2 ใช้จริง + ต้นทุนจริงต่อใบ** | `0177`: `job_gem_usage` (ฝังจริง/แตก/คืน จาก `/w/` ขั้น gem_set) · `job.cost_snapshot` เขียนตอน `job_done` · `v_job_actual_cost` · หน้า `/jobs/[id]/cost` (owner) · รายงานรวม `/jobs/reports` แถว "ต้นทุนจริง vs ประมาณ" | M | QA M · **security 💰** (หน้าต้นทุน + ราคาโลหะ) | ต้องมี ledger (M1) + ราคา (G1) ก่อน · snapshot ตอนปิดใบเพื่อให้เลขไม่ขยับทีหลัง |
| **G3 สะพานเข้าเครื่องคิดต้นทุน** | `oem_cost_calc` รับ `gems[]` (golden replay 0140 + ใบจริงทุกใบต้องเท่าเดิม) · `make_spec` เสนอจาก BOM · `production_cost_calc` โหมด spec ใช้ BOM เมื่อมี | L | **security 💰 + golden replay บังคับ** | แตะต้นทุนใบเสนอราคา/SKU — ทำหลังสุดเมื่อแคตตาล็อกมีราคาครบพอ |
| **G4 (ถ้าเจ้าของต้องการ)** | ใบสั่งซื้อพลอย (`gem_purchase_order` · สถานะสั่ง/รับ · ตัดจาก summary) · สต็อกพลอย | L | 💰 | วันนี้ "คัดลอกส่ง LINE ซัพพลายเออร์" พอ — อย่าสร้างระบบ PO ก่อนเห็นว่าสั่งบ่อยแค่ไหน (YAGNI) |

🔴 ลำดับ deploy ทุกเฟส: apply DB → merge โค้ด (named args `PGRST202` — memory `production-order-and-spot-cost`) · `job_create_*` เปลี่ยน signature ⇒ โค้ด J1 บน branch เดิมต้องแก้ caller ในคอมมิตเดียวกับ migration

## 6. คำถามถึงเจ้าของ (เฉพาะที่ตัดสินเองไม่ได้ — ที่เหลือตัดสินแล้วใน §1–§5)

| # | คำถาม | ค่าเริ่มถ้าไม่ตอบ |
|---|---|---|
| Q1 | **ของเหลือ OEM** (สั่ง 30 ดี 33): เก็บเข้าสต็อกร้านขายเอง (ต้องมี SKU — งาน OEM ส่วนใหญ่ไม่มี) · เก็บเป็นอะไหล่/ตัวอย่างของดีลนั้น · ส่งแถมลูกค้า · หรือถือไว้รอตัดสิน — และ**คิดเงินลูกค้าไหม** (กระทบ J4 ส่งของ ไม่กระทบใบเสร็จ) | `hold` + note · บอร์ดโชว์ "เหลือ n ชิ้นยังไม่ตัดสิน" · ไม่เข้าสต็อกอัตโนมัติ |
| Q2 | **เผื่อพลอยแตกตอนฝัง %** ต่อชนิดพลอย (CZ · พลอยแท้ · มุก) — ไม่รู้ตัวเลข ห้ามเดา | 0% ทุกชนิด (สรุปสั่งซื้อ = จำนวนพอดี) จนกว่าจะกรอกที่แท็บแคตตาล็อก |
| Q3 | **หน่วยขนาดพลอย = มิลลิเมตร** ใช่ไหม (เจ้าของพิมพ์ "ซม" — 4×6 ซม. คือพลอยใหญ่กว่าแหวนทั้งวง) · ทศนิยม 2 ตำแหน่งพอไหม (1.25 มม.) · ทรงหัวใจ/คุชชั่นใส่ด้านเดียวหรือสองด้าน | มม. · 2 ตำแหน่ง · หัวใจ 1 ด้าน · คุชชั่น 2 ด้าน |
| Q4 | **ราคาพลอยต่อเม็ดหรือต่อกะรัต** — ค่าเริ่มเสนอ "ต่อเม็ด" ทุกรายการ (CZ/พลอยเม็ดเล็กซื้อเป็นเม็ด) · กะรัตใช้เฉพาะรายการที่เลือก `unit='carat'` ซึ่งต้องกรอก "กะรัตต่อเม็ด" เพิ่มใน BOM | ต่อเม็ด · โหมดกะรัตเปิดได้แต่ต้องมีค่ากะรัต/เม็ดในแถว BOM |
| Q5 | **เศษ/ก้านต้นหลอมคืน** บันทึกต่อใบ (ช่างตัดต้นชั่งเศษของใบนั้น) หรือ**รวมเป็นถาดต่อวัน/ต่อแฟลสก์** (ตัดต้นหลายใบพร้อมกันแยกไม่ออก) — ถ้าเป็นอย่างหลัง `return` ต่อใบจะเป็นค่าเฉลี่ยตามสัดส่วนน้ำหนัก ไม่ใช่ค่าจริง | ต่อใบ (ช่างกรอกได้) · แฟลสก์หลายใบ = เฟส J3 batch แล้วค่อยปันส่วน |
| Q6 | **ใครเบิกโลหะ**: ช่างหล่อสแกน QR กรอกเอง (เร็ว · คนถือโลหะคือคนบันทึก) หรือออฟฟิศบันทึกจากสมุดเบิก (ควบคุมกว่า) — ทำทั้งสองทาง แต่ค่าเริ่มของจอช่างเปิดหรือปิด | เปิดทั้งสองทาง · ทอง: ออฟฟิศต้อง "ยืนยัน" ledger ของช่างไหม → ไม่ (audit มี worker_id · void ได้) |
| Q7 | **ความบริสุทธิ์ที่ใช้จริง**: เงิน 925 เม็ดสำเร็จ หรือเงิน 999 + ทองแดงผสมเอง (ถ้าผสมเอง ต้องบันทึก 2 แถว: เงิน 999 x g + ทองแดง y g) · ทองใช้ K ไหนบ้าง | ตัวเลือก: เงิน 925 / 999 · ทอง 24K 18K 14K 9K · ทองเหลืองไม่ระบุ · ทองแดงผสม = `metal='silver', fineness_label='alloy'` ไม่ทำรอบแรก |
| Q8 | **หน้าต้นทุนจริงต่อใบ** ให้ admin เห็นด้วยไหม หรือ owner คนเดียว (วันนี้ role ชั้นเดียว owner/admin เห็น `/oem/rates` เท่ากัน — memory `role-single-level`) | owner/admin เท่ากัน (ไม่เพิ่ม level) |
| Q9 | `qty_planned` **น้อยกว่า**ที่สั่งได้ไหม (โลหะไม่พอ ผลิตบางส่วนก่อน) | ได้ + ป้ายเตือน (§1.2) |
| Q10 | รายการชนิดพลอยที่ใช้จริงวันนี้ (ให้ seed ตรงของจริง — ไม่งั้น seed แค่ CZ/โกเมน/Blue Topaz ที่เจ้าของเอ่ยถึง) | seed 3 ชนิดที่เอ่ยถึง + เจ้าของเติมเอง |

### 6.1 มติเจ้าของ 13 ต.ค. 69 (เขียนทับค่าเริ่มด้านบน)

| # | มติ | ผลต่อ design |
|---|---|---|
| Q1 | **ถือไว้ก่อน ตัดสินทีหลัง** | ตามค่าเริ่ม: `hold` + note · บอร์ดโชว์ "เหลือ n ชิ้นยังไม่ตัดสิน" · ไม่เข้าสต็อกอัตโนมัติ |
| Q5 | **ชั่งเศษแยกทีละใบงาน** (14 ต.ค.) — ชั่งหลังตัดต้นเสร็จ | ตามค่าเริ่ม: `return` ต่อใบ ผูกขั้น `cut_sprue` · ช่างหรือออฟฟิศกรอก · ไม่มีการปันส่วนถาด |
| Q6 | **ได้ทั้งช่าง (สแกน QR) และออฟฟิศ** | ตามค่าเริ่ม |
| Q7 | **บันทึกแค่เงินกับทอง** · ส่วนผสมอื่น (ทองแดง ฯลฯ) ราคาไม่สูง = **ช่องเผื่อเติมได้ ไม่บังคับ** · กรอกเป็นสูตรผสมต่อครั้งเบิก เช่น เงิน x g + ทองแดง y g + อื่นๆ → **ได้เนื้อ 925** และให้เห็น % · **ก้านต้นที่ตัดออกนำกลับไปหล่อต่อได้ทันที** | 🔁 เปลี่ยนจาก §2.2: (1) การเบิกหนึ่งครั้ง = หลายบรรทัดส่วนผสม (โลหะมีค่า **บังคับ** · ทองแดง/อื่นๆ ไม่บังคับ) DB คำนวณ % และเนื้อที่ได้ · (2) เศษ/ก้านต้นที่คืน = วัตถุดิบเบิกซ้ำได้ (บรรทัดส่วนผสมชนิด "เนื้อหลอมกลับ 925") ไม่ใช่ของหาย · ⚠️ ตัวเลขตัวอย่างที่เจ้าของพิมพ์ ("เงิน 100 - 50 กรัม ทองแดง 7 กรัม") ยังอ่านไม่ออก — ใช้แค่โครง ห้ามใช้เป็นสูตร seed |
| Q7 (ต่อ · 14 ต.ค.) | ผสมด้วย **อัลลอยสำเร็จรูป ประมาณ 6.5–7%** (ไม่ได้ผสมทองแดงเอง) | บรรทัดส่วนผสมค่าเริ่ม = "เงิน" + "อัลลอยสำเร็จรูป" · DB แสดง % อัลลอย และเตือน (ไม่บล็อก) เมื่อนอกช่วงที่ตั้งไว้ต่อร้าน (ค่าเริ่ม 6.5–7%) · สัดส่วนจริงต่อครั้งกรอกเอง ห้าม seed สูตรตายตัว |
| Q3 | **มิลลิเมตร** ยืนยันแล้ว (14 ต.ค.) — "โกเมนทรงไข่ 4×6" = 4×6 มม. | ตามค่าเริ่ม: มม. · ทศนิยม 2 ตำแหน่ง |
| Q2 · Q4 · Q8–Q10 | ยังไม่ได้ถาม — ใช้ค่าเริ่มในตาราง | — |

## 7. ความเสี่ยง · trade-off · หนี้

**Trade-off ที่เลือก (และทางที่ตัดทิ้ง)**
- **ledger `job_metal_issue` แยกจาก `job_stage` แล้ว sync ทางเดียว** — ตัดทิ้ง: เพิ่มคอลัมน์ `metal/fineness/issued_by` ลง `job_stage` (เบิกได้ครั้งเดียว · void ไม่ได้ · ผสม 925/999 ไม่ได้) และตัดทิ้ง: ให้ ledger เป็นแหล่งเดียวแล้วถอด `weight_in_g` ออก (ต้องแก้ CHECK/trigger/RPC ของ J1 ทั้งชุด + งานเงินที่ไม่อยากบันทึกเบิกจะใช้ไม่ได้) · ราคาที่จ่าย: 2 ที่เก็บน้ำหนักเข้า ⇒ ต้องมี guard ข้อ 26 + view ตรวจ drift (`v_job_metal_drift`: stage ที่มี ledger แต่ `weight_in_g ≠ Σ issue`)
- **แคตตาล็อกพลอยเป็นตารางใหม่ ไม่ขยาย `oem_rate_def`** — เหตุผล §2.4 · ราคาที่จ่าย: 2 ระบบราคาพลอย (tier เดิม + แคตตาล็อก) อยู่ร่วมกันจน G3 · ต้องเขียนบนจอให้ชัดว่า "ราคาต่อเม็ด (tier) ใช้คิดใบเสนอราคา · แคตตาล็อกใช้สั่งซื้อ/ต้นทุนจริง"
- **BOM เป็นแถว (ชนิด·รูปทรง·ขนาด·จำนวน) ไม่ใช่ slot ตายตัว** — ตามมติ 13 ต.ค. · ตัดทิ้ง: jsonb ใน `make_spec` (ด่าน FK/active ตรวจไม่ได้ · ข้อ 13 ค่าว่างตาบอด)
- **snapshot `gem_label` ในใบงาน** — ตัดทิ้ง: join สดจากแคตตาล็อก (ชื่อเปลี่ยนใบเก่าเปลี่ยนตาม · view ฝั่งช่างต้อง join ตารางที่มีราคาข้างๆ)
- **แผนโลหะใช้ `sprue_loss_pct` ตัวเดียว** — ตัดทิ้ง: สูตรเต็มของ `oem_cost_calc` (recovery/polish loss) เพราะนั่นคือสมมติฐานต้นทุน ไม่ใช่โลหะที่ต้องวางวันแรก · เจ้าของแก้ตัวเลขทับได้พร้อมเหตุผล
- **ไม่ทำระบบ PO พลอย/สต็อกพลอย** รอบนี้ (G4) — คัดลอกข้อความส่ง LINE พอ
- **คำแนะนำจำนวนเผื่อมาจาก `reject_rate_*_pct` ที่มีอยู่** — ตัดทิ้ง: rate ใหม่ "เผื่อผลิต %" (ซ้ำซ้อน · reject rate คือตัวเดียวกันในความหมายของเจ้าของ) · ถ้าเจ้าของรู้สึกว่าเผื่อน้อย/มากไป = แก้ reject rate ซึ่งกระทบใบเสนอราคาด้วย — **ต้องบอกเจ้าของ** (ผลข้างเคียงเดียวกับมติ C5)

**ความเสี่ยงตอน implement**
- R1 **`job_guard`/`job_stage_guard` ของ 0172 ต้องถูก replace** — ตรรกะยาว (บ.563–784) · การผ่อน `qty_planned`/น้ำหนัก 3 คอลัมน์ ต้องไม่เปิดช่องแก้คอลัมน์อื่น ⇒ verify ต้องมี mutant: UPDATE ทุกคอลัมน์ของ job/job_stage ทีละตัวบนใบทุกสถานะที่มีจริง แล้วนับว่าตกถูกตัว (แบบ verify-0174 mutant 11 จุด)
- R2 **เปลี่ยน signature `job_create_from_*`** — overload หลุด (ข้อ 1) + caller ใน `lib/jobs/*` และเทสต์ `JobsOffice.test.tsx`/`input.test.ts` ต้องแก้พร้อมกัน · ทางเลือกลดเสี่ยง: เพิ่ม RPC ใหม่ `job_create_v2` แล้วให้ตัวเก่า wrap (ไม่ drop) — เลือก **drop+replace** เพราะ J1 ยังไม่ merge main ไม่มี caller เก่าบน prod (grep ก่อนตัดสิน — บทเรียน 0132)
- R3 **ทอง: น้ำหนักเบิกสะสมเป็นข้อมูลที่ N1 (0174) จงใจซ่อนจากผู้รับ** — จอเบิกโลหะต้องไม่โชว์ `Σ issue` ก่อนช่างชั่งออก และ `job_worker_resolve` งานทองต้องไม่คืน `issued_g` ⇒ เพิ่มเคสในเทสต์ N1
- R4 **หน่วย มม. vs ซม.** — ถ้าเจ้าของยืนยันว่าพิมพ์ "ซม" จริง (พลอยใหญ่มาก) เพดาน `size_mm <= 100` ยังรองรับ 10 ซม. · แต่ป้ายบนจอต้องเป็น "มม." ชัดทุกจุด และฟอร์มเตือนเมื่อ > 30 มม. ("ใหญ่ผิดปกติ — ยืนยัน?")
- R5 **`gem_item` ซ้ำเพราะปัดทศนิยม** (4×6 กับ 4.0×6.0 = แถวเดียว ✅ numeric เท่ากัน · 4×6 กับ 6×4 = คนละแถว ❌) ⇒ RPC normalize ให้ `size_mm_a <= size_mm_b` เสมอ (กว้าง ≤ ยาว) ก่อนตรวจ unique
- R6 **ราคาว่าง ≠ 0 ทุกชั้น** (ข้อ 13) — `gem_price_value` คืน null · view `_cost` ต้อง `missing_price` boolean ไม่ coalesce · รายงานรวมต้องบอก "รวมเฉพาะที่รู้ราคา n/m รายการ" — ทดสอบด้วย `jsonb_typeof` และ `is null` จริง
- R7 **backfill `qty_order`** ยิง trigger `updated_at` (ข้อ 19) — ใบ J1 บน prod ยังน้อย แต่กฎเดียวกัน
- R8 **สรุปสั่งซื้อข้ามใบนับซ้ำ** เมื่อใบถูกยกเลิกแล้วสร้างใหม่ (ใบเก่า cancelled ไม่นับ ✅) หรือ `gem_set` ถูก skip (ไม่นับ — ต้องเขียน where ให้ครบ) · เทสต์ทั้ง 2 เคส
- R9 **ช่างกรอกน้ำหนักเบิกผิดหลัก** (1500 แทน 150.0) — `inputmode=decimal` + ด่าน RPC: `issue > metal_plan_g × 3` หรือ `> 5,000 g` ⇒ คืน `{ok:false, code:'weight_suspicious'}` ให้ยืนยันซ้ำ (ไม่ raise — pattern 0172 ข้อ 3) · ออฟฟิศ void ได้

**หนี้ที่รู้ตั้งแต่ design**
- ค่าแรงจริงต่อใบยังไม่คิด (G2 เก็บแค่โลหะ+พลอย) · `oem_tier` บน `gem_item` เป็นสะพานชั่วคราวจน G3 · เศษหลอมคืนยังไม่เข้า `metal_scrap_ledger` (J6 ของ J1) — `kind='return'` คือต้นทาง · ไม่มีสต็อกพลอย (G4) · `breakage_allow_pct` ต่อชนิดไม่ใช่ต่อรายการ · แฟลสก์หลายใบปันส่วนเศษไม่ได้จน J3 batch

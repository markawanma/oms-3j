# Design — ใบงานต่อยอด J1: จำนวนเผื่อเสีย · เบิกโลหะ · วางแผนโลหะ · BOM พลอย · แคตตาล็อกพลอย (13 ต.ค. 69)

> architect (Yoda) · สถานะ: **M1 spec พร้อม implement (§8 · 14 ต.ค. 69) — เจ้าของสั่ง "เริ่ม M1 ได้เลย"** · migration `0175`/`0176` ยังไม่เขียน · G1–G4 รอ
> ต่อจาก `design-job-tracking.md` (J1 ลง DB แล้ว: `0172`–`0174` apply 12 ต.ค. 69 · โค้ดบน branch `feature/job-tracking-j1`) — **เอกสารนี้ไม่ทวนสิ่งที่ J1 ทำแล้ว** อ่านคู่กัน
> อ่านคู่: `design-own-production-costing.md` (make_spec · oem_cost_calc) · `design-production-order.md` · skill `oem-quote-invariants` · skill `3j-migration-traps` · memory `spec-cost-mode` · `production-order-and-spot-cost`
> 🔴 เอกสารนี้ไม่มีตัวเลขต้นทุน/ราคาจริงโดยตั้งใจ — ตัวเลขอยู่ใน DB เท่านั้น (ค่า % ใน §6 เป็นคำถาม ไม่ใช่ค่าที่ตั้ง)
> 🔁 §2.2 / §2.3 / §3 ข้อ 21–30 / §4 แถวโลหะ ถูก **§8** ทับด้วยมติ Q7 (14 ต.ค.) — อ่าน §8 เป็นหลักสำหรับ M1 · ส่วนพลอย (§2.4–2.5 · G1) ยังเป็นปัจจุบัน
> 🔁 **22 ต.ค. 69 — G1a พลอย = migration 0190 (ไม่ใช่ 0176) · มติ 21 ต.ค. (พิมพ์ชื่อใหม่เข้าแคตตาล็อกเอง · รวมชื่อ · ไม่ seed ชนิด) ทับ §2.4–2.5 และแถว G1 — อ่าน §9 ท้ายไฟล์เป็นหลัก**
> ⏸ **15 ต.ค. 69 — เจ้าของสั่งพัก "ระบบเบิกโลหะ" (ledger + สูตรอัลลอย = 0176 ใน §8) ไว้ก่อน** · 0175 (จำนวน/เผื่อ/แผนโลหะ/ของเหลือ) เดินต่อ · ช่องเลข 0176 กลายเป็น **แบบการบันทึก (record profile)** → `design-job-record-profile.md` · ส่วน ledger ใน §8 ติดป้าย ⏸ ห้ามลบ

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

### 2.2 `job_metal_issue` — ledger โลหะต่อใบงาน (append-only · ยกเลิกด้วยแถวกลับ ไม่ UPDATE/DELETE) — 🔁 **ทับด้วย §8.1 (header + lines ตาม Q7)**
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

### 2.3 `v_job_metal_balance` — ดุลโลหะต่อใบ (DB คำนวณ · จอแค่แสดง) — 🔁 **ทับด้วย §8.2**
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

## 8. M1 — spec พร้อม implement (14 ต.ค. 69 · เจ้าของสั่ง "เริ่ม M1 ได้เลย")

> **ทับ §2.2 / §2.3 / §3 ข้อ 21–30 / §4 แถวโลหะ** ด้วยมติ Q7 (เบิก 1 ครั้ง = หลายบรรทัดส่วนผสม · อัลลอยสำเร็จรูป · เศษหลอมกลับเบิกซ้ำได้) — ส่วนพลอย (§2.4–2.5, G1) ไม่เปลี่ยน
> def ล่าสุดของทุกฟังก์ชันที่ต้อง replace ระบุไฟล์:บรรทัดไว้ใน §8.3 — **ลอกจากไฟล์นั้น ไม่ใช่จาก 0172** (migration-traps ข้อ 3/21)
> ไม่มีราคา/ต้นทุนในทุก object ของ M1 (ยืนยัน §8.6)

### 8.0 ตัดสินใจหลัก + แบ่ง migration

| # | ตัดสินใจ | ทางที่ตัดทิ้ง · เหตุผล |
|---|---|---|
| 1 | **แยก 2 migration**: `0175` = จำนวนสั่ง/เผื่อ + แผนโลหะ + ปิดหนี้ J1 (D2/D6) · `0176` = ledger เบิกโลหะ | รวมไฟล์เดียว ~2,500 บรรทัดแบบ 0172 รีวิว/verify ยาก · 0175 apply ได้ก่อนให้ frontend ทำฟอร์มสร้างใบงาน ระหว่างที่ backend เขียน ledger · ฟังก์ชันที่ทั้งสองไฟล์จะแตะซ้ำมีตัวเดียวคือ `job_worker_resolve` — 0175 ไม่แตะมัน (D6 ส่วนของ resolve ไปปิดใน 0176) |
| 2 | **ledger = header + lines** (`job_metal_issue` + `job_metal_issue_line`) | ตารางเดียวแถวละส่วนผสม: "การเบิกครั้งหนึ่ง" ไม่มีตัวตน → void ต้องไล่หลายแถว · % อัลลอยต้อง group เอง · event 1:1 ไม่ได้ |
| 3 | **ไม่มี trigger sync ledger → `job_stage`** — RPC เขียนทั้งสองที่ในทรานแซกชันเดียว ณ transition ที่ `job_stage_guard` ยอมอยู่แล้ว (รับ: `weight_in_g` · ส่ง: `metal_added_g`/`scrap_weight_g`) + view ตรวจ drift | trigger sync ต้องเจาะ `job_stage_guard` ด้วย session flag (§3 ข้อ 26 เดิม) = เปิดช่องให้ service key เขียนตรง · ราคาที่จ่าย: void หลังขั้น `sent` ทำไม่ได้ ต้องย้อนขั้นก่อน (เท่ากับกติกา J1 "ส่งแล้วแข็ง") |
| 4 | `job_stage_guard` **ไม่ต้อง replace** (ผลจากข้อ 3) · `job_guard` replace ใน 0175 เท่านั้น | R1 ของ §7 เหลือครึ่งเดียว |
| 5 | **วัสดุเป็นทะเบียนต่อร้าน `job_metal_material`** (seed · ปุ่มใหญ่บนจอช่าง · snapshot label/fineness ลงบรรทัด) · ช่วงเตือน % อัลลอยอยู่ที่แถววัสดุ `component='alloy'` (`pct_warn_min/max`) | ตาราง setting แยก / `oem_cost_rate`: ช่วงเตือนเป็นคุณสมบัติของ "อัลลอยตัวนั้น" ไม่ใช่ของร้าน (อัลลอยทองคนละช่วง) · ไม่แตะ `oem_rate_def` (global ไม่มี shop_id) · ห้าม seed สูตรผสม — seed แค่รายการวัสดุ + ช่วงเตือนที่เจ้าของให้ (6.5–7) |
| 6 | **เศษหลอมกลับ = วัตถุดิบ**: `return` ของใบ A ลด `net_used` ของ A · บรรทัด `recycled` ในการเบิกของใบ B นับเต็มเป็นของเข้าของ B · ดุลต่อใบปิดในตัวเอง ไม่อ้างข้ามใบ · กองเศษระดับร้าน = Σ return − Σ recycled-in (view แยก · ติดลบ = เตือน ไม่บล็อก) | ผูก recycled line กับ return แถวต้นทางด้วย FK: ของจริงหลอมรวมถาดแล้วแยกไม่ออก (Q5 ชั่งแยกต่อใบตอนคืน แต่ตอนเบิกซ้ำคือก้อนรวม) · loss ของ B ไม่ติดลบเพราะ recycled คือ input จริงของ B |
| 7 | `issue` ทำได้ทางเดียว = **ขั้น `cast` ยัง pending** (RPC "รับงาน" ให้ด้วย — 1 สแกน 1 ปุ่ม) · cast ที่ถูกรับแบบ J1 (ชั่งอย่างเดียว) ไปแล้ว = ใบนั้นเดิน J1 ต่อ ไม่แปลงกลางทาง (ย้อนขั้นแล้วเบิกใหม่ได้) | ยอม `issue` ซ้อนบน stage ที่รับแล้ว: ต้อง UPDATE `weight_in_g` ของ stage `received` ซึ่ง guard ห้าม · "เบิกเพิ่มระหว่างถือ" มี `top_up` อยู่แล้ว |
| 8 | ของเหลือ OEM: `job_done` ตั้ง `hold` อัตโนมัติเมื่อ `qty_good > qty_order` และไม่ส่งค่า · เปลี่ยนทีหลังบนใบ done ผ่าน `job_surplus_set` (ข้อยกเว้นเดียวของ "done แล้วแก้ไม่ได้" — guard ยอมเฉพาะ 2 คอลัมน์นี้) · production: `stock` เสมอ (ของเข้าสต็อกผ่าน `production_order_done` อยู่แล้ว) | บังคับกรอกตอนปิดงาน: ขัด Q1 "ถือไว้ตัดสินทีหลัง" |
| 9 | ค่าแนะนำจำนวนเผื่อใช้ `reject_rate_cast/polish/plate_pct` **ตัวเดียวกับ `oem_cost_calc`** (0140 บ.202–208) · แผนโลหะใช้ `sprue_loss_pct[metal]` (0140 บ.246) | rate ใหม่ = ซ้ำซ้อน · **ผลข้างเคียงต้องบอกเจ้าของ**: แก้ reject rate เพื่อให้เผื่อมาก/น้อยลง = ต้นทุนใบเสนอราคาใหม่ขยับตาม (ใบที่ออกแล้วไม่ขยับ — snapshot) |

### 8.1 Schema

**0175 — `alter table analytics.job add column`** (ลำดับ: add nullable → `alter table analytics.job disable trigger trg_job_guard` → backfill → `enable trigger` → `set not null` · ทั้งหมดในทรานแซกชันเดียว)

| คอลัมน์ | ชนิด / CHECK | หมายเหตุ |
|---|---|---|
| `qty_order int not null` | `check (qty_order between 1 and 100000)` | backfill `= qty_planned` · 🔴 `job_guard` (0173:651) **raise บนแถว `done/cancelled`** และ set `updated_at := now()` เอง (บ.664) ⇒ **ต้อง disable `trg_job_guard` ระหว่าง backfill** · ล็อก `md5(string_agg(updated_at::text, '|' order by id))` + `count(distinct updated_at)` ก่อน/หลัง (ข้อ 19) · trigger บน `job` ที่มีจริง: `trg_job_guard`, `trg_job_deny_truncate` (backend query `pg_trigger` ยืนยันอีกครั้ง) |
| `target_piece_g numeric(10,3)` | `null or (> 0 and <= 10000)` | น้ำหนักเป้าหมาย/ชิ้น |
| `metal_plan_g numeric(10,3)` | `null or (> 0 and <= 100000)` | DB คำนวณ (`job_plan_compute`) |
| `metal_plan_basis jsonb` | `null or jsonb_typeof = 'object'` | `{target_piece_g, qty_planned, sprue_loss_pct, sprue_rate_as_of, formula, computed_g, override_g, override_reason, missing[]}` |
| `surplus_disposition text` · `surplus_note text` | `in ('hold','spare','deliver','stock')` · note ≤ 200 `oem_note_valid` | |
| CHECK `job_plan_ck` | `(target_piece_g is null) = (metal_plan_g is null) and (metal_plan_g is null) = (metal_plan_basis is null)` | |
| CHECK `job_surplus_ck` | `(surplus_disposition is null or (status = 'done' and qty_good > qty_order)) and (status <> 'done' or qty_good <= qty_order or surplus_disposition is not null)` | ข้อ 14: `job_done` ต้องใส่ `surplus_disposition` ใน UPDATE เดียวกับ `status='done'` |
| `job_event.event_type` | เพิ่ม `'plan_change'`, `'surplus_set'` (0175) · `'metal_issue'`, `'metal_void'` (0176) | drop/add constraint — ลอกชื่อ constraint จริงจาก `pg_constraint` (0172 ไม่ได้ตั้งชื่อ) |

> ⏸ **พักไว้ตามมติเจ้าของ 15 ต.ค. 69** — ตาราง ledger ด้านล่าง (`job_metal_material` · `job_metal_issue` · `job_metal_issue_line`) ยังไม่สร้าง · เหตุผล/ผลกระทบ: `design-job-record-profile.md` §0 มติ 4 + §9
**0176 — ตารางใหม่** (RLS เปิด ไม่มี policy · grant `service_role` เท่านั้น · append-only trigger แบบ `job_event`)

`job_metal_material` — ทะเบียนวัสดุต่อร้าน (seed ผ่าน `job_metal_material_ensure(shop_id)` on conflict do nothing · เรียกใน `job_worker_resolve`/`job_metal_issue_add` แบบ `job_stage_def_ensure`)

| คอลัมน์ | ชนิด / CHECK |
|---|---|
| `shop_id` · `code text` PK `(shop_id, code)` (`^[a-z][a-z0-9_]{1,30}$`) · `metal text check in ('silver','gold')` · `component text check in ('precious','alloy','recycled','other')` · `fineness numeric(6,4)` (`precious/recycled`: not null `> 0 and <= 1` · `alloy/other`: null — CHECK คู่) · `label text` ≤ 60 · `pct_warn_min/pct_warn_max numeric(5,2)` (เฉพาะ `alloy` · null = ไม่เตือน · `min <= max` · 0–100) · `seq int` · `is_active boolean` · `updated_at` | ทองเหลือง **ไม่มี** (Q7 บันทึกแค่เงิน/ทอง — ใบทองเหลืองเดิน J1 ต่อ) · guard: UPDATE ได้เฉพาะ `label/is_active/pct_warn_*/seq` (fineness/component/metal แช่แข็ง) · ห้าม DELETE |

seed (fineness = นิยามมาตรฐานของเกรด ไม่ใช่ตัวเลขร้าน · ช่วงเตือน 6.5–7 = เจ้าของให้ 14 ต.ค.):
เงิน `ag999` precious 0.999 "เงินเม็ด 999" · `ag925` precious 0.925 "เงินเม็ด 925 สำเร็จ" · `alloy_ag` alloy "อัลลอยสำเร็จรูป (เงิน)" warn **6.50–7.00** · `recycle_ag925` recycled 0.925 "เศษ/ก้านต้นหลอมกลับ 925" · `other_ag` other "อื่นๆ (เงิน)" ·
ทอง `au9999` precious 0.9999 "ทองคำ 99.99" · `au750` precious 0.750 "ทอง 18K สำเร็จ" · `au585` precious 0.585 "ทอง 14K สำเร็จ" · `alloy_au` alloy "อัลลอยทอง" (**ไม่มีช่วงเตือน — ไม่รู้ ห้ามเดา** §8.13 Q11) · `recycle_au750` recycled 0.750 · `recycle_au585` recycled 0.585 · `other_au` other
UI แก้ทะเบียนนี้ = เฟสหลัง (`/jobs/stages`) · M1 ไม่มี RPC upsert (YAGNI — หนี้ §8.12)

`job_metal_issue` — header การเบิก/เติม/คืน/ยกเลิก

| คอลัมน์ | ชนิด / CHECK |
|---|---|
| `id` · `shop_id` · `job_id` · `job_stage_id uuid not null` · FK `(job_id, shop_id)→job` · `(job_stage_id, job_id)→job_stage` · `(worker_id, shop_id)→worker` | |
| `kind text check in ('issue','top_up','return','void')` · `void_of_id uuid null` FK self **unique** · CHECK `(kind = 'void') = (void_of_id is not null)` | void = แถวกลับ 1:1 |
| `occurred_on date` · `recorded_at timestamptz default clock_timestamp()` · `actor uuid` · `worker_id uuid` · `channel check in ('worker_qr','job_page','daily_sheet')` · `device_hint` ≤ 120 · CHECK `actor is not null or worker_id is not null` · CHECK `channel <> 'worker_qr' or worker_id is not null` | ชุดเดียวกับ `job_event` |
| `note text` (`oem_note_valid` ≤ 200) | บังคับเมื่อ `kind in ('top_up','void')` และ `return` ที่ทำให้ Σ return > Σ in — บังคับใน RPC (ต้องดูยอดสะสม) · `void`: CHECK `kind <> 'void' or oem_note_present(note)` |
| `event_id uuid not null → job_event` | 1 header = 1 event (`metal_issue`/`metal_void`) |
| `total_g numeric(10,3) not null check (> 0 and <= 100000)` · `fine_g numeric(10,4) not null check (>= 0)` · `alloy_pct numeric(6,3) null check (null or between 0 and 100)` · `warnings jsonb not null default '[]' check (jsonb_typeof = 'array')` | RPC คำนวณจากบรรทัด (§8.2) · void คัดลอก `total_g/fine_g` ของต้นทาง |
| constraint trigger **initially deferred** `job_metal_issue_total_ck` (AFTER INSERT บน header และ line) | `kind <> 'void'` ⇒ Σ `line.weight_g = total_g` ณ commit (กัน header/lines ขัดกัน) |
| trigger `job_metal_issue_guard` BEFORE INSERT | stage เป็นของ job เดียวกัน · `job_stage_def.metal_present` · `job.metal in ('silver','gold')` · `void_of_id` ชี้ header ของ job เดียวกันที่ `kind <> 'void'` · UPDATE/DELETE/TRUNCATE ปฏิเสธทุกกรณี (รวม owner/service_role แบบ `job_event`) |

`job_metal_issue_line` — บรรทัดส่วนผสม

| คอลัมน์ | ชนิด / CHECK |
|---|---|
| `id` · `issue_id → job_metal_issue` · `shop_id` · `seq int` unique `(issue_id, seq)` · `material_code text` FK `(shop_id, material_code) → job_metal_material` | |
| `component text` (snapshot จากวัสดุ) · `label text` (snapshot) · `fineness numeric(6,4) null` (snapshot — บรรทัด `return` ใช้ fineness เฉลี่ยของใบ ไม่ใช่ของวัสดุ) · `weight_g numeric(10,3) check (> 0 and <= 100000)` | ค่าบวกเสมอ ทิศทางอยู่ที่ `kind` ของ header |
| CHECK `(component in ('precious','recycled')) = (fineness is not null)` · trigger BEFORE INSERT: header ต้อง `kind <> 'void'` และ `shop_id` ตรง | append-only |

### 8.2 สิ่งที่ DB คำนวณ (ไม่รับจาก client — client ส่งแค่ `[{material_code, weight_g}]`)

**ต่อ header** (`job_metal_lines_parse` → เก็บลง header + คืนใน response):
- `precious_g · recycled_g · alloy_g · other_g` = Σ ตาม component · `total_g` = ผลรวม
- `fine_g` = Σ `weight_g × fineness` ของ precious + recycled (เนื้อโลหะมีค่าบริสุทธิ์ที่ออกไป · 4 ตำแหน่ง) · `eff_fineness = fine_g / total_g`
- `alloy_pct` = `alloy_g / (precious_g + alloy_g) × 100` **เฉพาะส่วนผสมสด** (recycled 925 มีอัลลอยในตัวแล้ว ไม่เอาเข้าตัวหาร) · `precious_g = 0` ⇒ **null** (หลอมกลับล้วน ไม่มีอะไรให้เตือน · ข้อ 13: null ไม่ใช่ 0)
- `warnings[]` (เตือน ไม่บล็อก): ต่อบรรทัด alloy ที่วัสดุมีช่วง → `pct_line = line.weight_g / (precious_g + alloy_g) × 100` นอก `[min,max]` ⇒ `{code:'alloy_pct_out_of_range', material_code, pct, min, max}` · `precious_g > 0 and alloy_g = 0` และร้านมีวัสดุ alloy (active) ของโลหะนั้นที่มีช่วงเตือน ⇒ `{code:'no_alloy'}`
- `weight_suspicious` (R9): `total_g > 5000` หรือ (`kind='issue'` ∧ `metal_plan_g` ไม่ null ∧ `total_g > 3 × metal_plan_g`) ⇒ RPC คืน/raise `weight_suspicious` จนกว่า `p_confirm = true`

**กติกาบรรทัดต่อ kind**: `issue`/`top_up` 1–10 บรรทัด · ต้องมี ≥ 1 บรรทัด component in (`precious`,`recycled`) = "โลหะมีค่าบังคับ" · `material.metal = job.metal` · ห้าม `material_code` ซ้ำในครั้งเดียว (UI รวมก่อน) · วัสดุต้อง `is_active` · `return` = RPC สร้าง 1 บรรทัด `recycled` ให้เอง (`fineness = in_fineness_eff` สะสมของใบ · `material_code` = recycled ของโลหะนั้นที่ fineness ใกล้สุด) · `void` ไม่มีบรรทัด

**ต่อใบ — `v_job_metal_balance`** ("non-void" = `kind <> 'void'` และไม่มี void ชี้มา · 1 แถวต่อ job ทุกใบ · ใบไม่มี ledger = null ทั้งแถวยกเว้น `has_ledger=false`):

| คอลัมน์ | นิยาม |
|---|---|
| `has_ledger` | มี issue non-void ≥ 1 |
| `issued_g` · `top_up_g` · `in_g = issued + top_up` · `in_fine_g` · `in_fineness_eff = round(in_fine_g / in_g, 4)` | ของเข้า |
| `fresh_g` (precious+alloy+other ใน issue/top_up) · `recycled_in_g` | ใช้ของใหม่เท่าไร หลอมกลับเท่าไร |
| `returned_g` · `returned_fine_g` | Σ return non-void |
| `net_used_g = in_g − returned_g` | โลหะที่ใบนี้กินจริง (ฐานของ G2 ต้นทุนจริง) |
| `cast_out_g` · `cast_qty_out` · `avg_piece_g = round(cast_out_g / cast_qty_out, 3)` | null ถ้ายังไม่ชั่ง/qty 0 (ข้อ 13 — ไม่ใช่ 0) |
| `melt_loss_g = in_g − cast_out_g` | หายตอนหล่อ (null ถ้า cast ยังไม่ชั่งออก) |
| `last_out_g` | `weight_out_g` ของขั้น `sent` ล่าสุดที่ `weigh_required` และชั่งแล้ว |
| `loss_g = in_g − returned_g − last_out_g` · `loss_pct = round(loss_g / in_g × 100, 2)` | "หายจริง" ที่เจ้าของถาม — หลังหักเศษคืน · null เมื่อ `last_out_g` null |
| `plan_vs_in_g = in_g − metal_plan_g` · `piece_vs_target_g = avg_piece_g − target_piece_g` | |
| `fineness_mix jsonb` | `[{material_code, label, component, fineness, weight_g}]` group บรรทัด issue/top_up non-void |
| `alloy_pct_latest` · `warnings jsonb` | จาก header issue/top_up non-void ล่าสุด / รวมทุก header |
| `cast_not_weighed` · `return_not_recorded` (`cut_sprue` sent แล้ว ∧ `returned_g = 0`) · `void_count` | ป้ายบนจอ (R3 ของ J1: แสดง ไม่ซ่อน) |

**ระดับร้าน — `v_job_metal_recycle_pool`**: ต่อ `shop_id × metal`: `returned_total_g` · `reissued_total_g` (Σ บรรทัด recycled ใน issue/top_up non-void) · `pool_g = returned − reissued` · `pool_negative` (เบิกหลอมกลับมากกว่าที่เคยคืน — เตือนให้ไปดู ไม่บล็อก เพราะเศษจาก J1-style `scrap_weight_g` และก่อน M1 ไม่อยู่ใน ledger)
**drift — `v_job_metal_drift`**: stage ที่มี ledger แต่ `weight_in_g ≠ issue.total_g` หรือ (`sent` ∧ (`metal_added_g ≠ Σ top_up` หรือ `coalesce(scrap_weight_g,0) ≠ Σ return ของ stage`)) — ต้องว่างเสมอ (verify + weekly check)

### 8.3 RPC — ใหม่ / replace / drop (signature เต็ม · ✱ = security definer · grant `service_role` เท่านั้น · helper ภายใน = revoke ทุก role ไม่ grant ใคร แบบ 0174 ส่วน 1)

**0175**

| ฟังก์ชัน | สถานะ | สาระ |
|---|---|---|
| `job_deposit_blocked(p_job analytics.job) returns boolean` stable | ใหม่ (D6) | `p_job.source_kind='oem' and p_job.start_gate_note is null and not exists(stage received/sent) and coalesce(paid_thb,0) <= 0` (join `oem_quote_item → v_oem_quote` เหมือน 0174:334–337) |
| `job_worker_can_do(p_codes text[], p_stage_code text) returns boolean` immutable | ใหม่ (D6) | `coalesce(cardinality(p_codes),0) = 0 or p_stage_code = any(p_codes)` |
| `job_counter_bump(text, timestamptz)` | **drop** (D6) | ก่อน drop assert: `select count(*) from pg_proc where pronamespace='analytics'::regnamespace and prosrc like '%job_counter_bump%'` = 0 (0174 เปลี่ยน `worker_pin_verify` ไปใช้ `job_budget_take` แล้ว — 0174:52,58) |
| `job_core_receive(uuid,int,date,numeric,uuid,text,text,uuid,text,boolean)` | replace (def **0174:245**) | ใช้ helper แทนบล็อก scope (บ.316–322) และบล็อกมัดจำ (บ.331–341) · ตรรกะอื่นเท่าเดิมทุกบรรทัด |
| `job_office_receive(uuid,uuid,int,date,numeric,uuid,text,text,uuid)` ✱ | replace (def **0172:1629**) | D2: `v_assignee := case when nullif(btrim(coalesce(p_assignee_name,'')),'') is null then null else analytics.job_label_clean(p_assignee_name,'ชื่อผู้รับงาน',60) end` |
| `job_plan_compute(p_shop_id uuid, p_metal text, p_qty_planned int, p_target_piece_g numeric, p_override_g numeric, p_override_reason text) returns jsonb` | ใหม่ (ภายใน · stable) | `sprue := oem_rate_value(p_shop_id,'sprue_loss_pct',p_metal, job_today())` · `computed_g = round(qty × piece × (1 + sprue/100), 3)` · override: `job_weight_ok` + `oem_note_present(reason)` บังคับ (ไม่มี ⇒ raise `plan_reason_required`) · คืน `{metal_plan_g, basis}` · `target_piece_g` null ⇒ `{null,null}` · rate ว่างและไม่ override ⇒ `metal_plan_g` **null** + `basis.missing=['sprue_loss_pct[<metal>]']` (ไม่ใช่ 0) |
| `job_source_info(uuid,text,uuid)` | replace (def **0172:1281**) | เพิ่ม key `target_piece_g`: oem = `nullif(input->>'weight_g','')::numeric` เมื่อ `> 0 and <= 10000` · production = `product.silver_weight_g` เมื่อ `> 0 and <= 10000` · ไม่เข้าเงื่อนไข = null · เพิ่ม `target_piece_g_source: 'quote' | 'product' | null` |
| `job_plan_suggest(p_shop_id uuid, p_source_kind text, p_item_id uuid, p_qty_planned int default null, p_target_piece_g numeric default null) returns jsonb` ✱ stable | ใหม่ | `crm_require_owner_admin` · อ่าน `job_source_info` · `reject = {cast, polish, plate}` จาก `oem_rate_value(..., '-', job_today())` (plate เฉพาะเมื่อ `suggested_stage_codes` มี `plating`) · `qty_planned_suggest = ceil(qty_order / ((1−rc/100)(1−rp/100)(1−rpl/100)))` · rate ที่ต้องใช้ว่างตัวใดตัวหนึ่ง ⇒ suggest **null** + `missing[]` · `qty_planned_eff = coalesce(p_qty_planned, suggest, qty_order)` · `target_piece_g = coalesce(p_target_piece_g, จาก source)` · `metal_plan_g/basis` จาก `job_plan_compute` · คืน `{qty_order, qty_planned_suggest, qty_planned_eff, under_planned, reject_basis:{cast_pct,polish_pct,plate_pct,has_plating}, target_piece_g, target_piece_g_source, metal, metal_plan_g, metal_plan_basis, missing[]}` · กัน NaN ทุก input ด้วย `not (x > 0 and x <= เพดาน)` |
| `job_create_insert(...)` | **drop เดิม** `(uuid,text,uuid,uuid,int,uuid,uuid,text,text,text,int,date,text,text,text[],boolean,uuid)` (def 0172:1230) → ใหม่เพิ่มท้าย `p_qty_order int, p_target_piece_g numeric, p_plan jsonb` (`p_qty` = qty_planned เดิม) | insert `qty_order, qty_planned, target_piece_g, metal_plan_g, metal_plan_basis` · event `create` payload เพิ่ม `qty_order, target_piece_g, metal_plan_g` · response เพิ่ม `qty_order, under_planned, metal_plan_g, plan_missing[]` |
| `job_create_from_quote_item` ✱ | **drop** `(uuid,uuid,text[],date,text,text,text,uuid)` (def **0174:631**) → ใหม่ **ต่อท้าย** `p_qty_planned int default null, p_target_piece_g numeric default null, p_metal_plan_override_g numeric default null, p_metal_plan_reason text default null` | `qty_order := v_info.qty` (ไม่รับจาก client) · `qty_planned := coalesce(p_qty_planned, qty_order)` ตรวจ `between 1 and 100000` · `target_piece_g := coalesce(p_target_piece_g, v_info.target_piece_g)` ตรวจ `not (> 0 and <= 10000)` · plan ผ่าน `job_plan_compute` · ตรรกะเดิมทุกบรรทัดคงไว้ |
| `job_create_from_production_item` ✱ | **drop** `(uuid,uuid,text[],date,text,text,uuid)` (def **0174:690**) → ต่อท้าย 4 arg เดียวกัน | เหมือนบน |
| `job_qty_planned_set(p_shop_id uuid, p_job_id uuid, p_qty_planned int, p_reason text default null, p_actor uuid default null) returns jsonb` ✱ | ใหม่ | `job_office_begin` · ปฏิเสธถ้ามี stage `received/sent` (hint `started`) · คำนวณ plan ใหม่ (เก็บ override เดิมถ้ามี · `basis.qty_planned` อัปเดต) · UPDATE `qty_planned, metal_plan_g, metal_plan_basis` คำสั่งเดียว · event `plan_change` before/after · คืน `under_planned` |
| `job_plan_set(p_shop_id uuid, p_job_id uuid, p_target_piece_g numeric, p_override_g numeric default null, p_override_reason text default null, p_actor uuid default null) returns jsonb` ✱ | ใหม่ | แก้ได้จนกว่า stage `cast` จะ `received/sent` (hint `cast_started`) · `p_target_piece_g` null = ล้างแผน (3 คอลัมน์ null พร้อมกัน) · event `plan_change` |
| `job_done` ✱ | **drop** `(uuid,uuid,int,int,numeric,text,uuid)` (def **0172:1824**) → ต่อท้าย `p_surplus_disposition text default null, p_surplus_note text default null` | `surplus = p_qty_good − v_job.qty_order` · surplus > 0: production ⇒ `'stock'` บังคับ (ส่งค่าอื่น = 22023 `surplus_production_stock_only`) · OEM ⇒ `coalesce(p, 'hold')` และ `'stock'` ห้าม (Q1 — `surplus_oem_no_stock`) · surplus ≤ 0 ∧ ส่ง disposition/note ⇒ `surplus_unexpected` · note `job_text_clean(…,200,false)` · **ใส่ `surplus_*` ใน UPDATE เดียวกับ `status='done'`** (ข้อ 14) · event `done` payload เพิ่ม `qty_order, surplus, surplus_disposition` · ด่านเดิมทุกข้อคงอยู่ |
| `job_surplus_set(p_shop_id uuid, p_job_id uuid, p_disposition text, p_note text default null, p_actor uuid default null) returns jsonb` ✱ | ใหม่ | `job_office_begin(..., p_allow_terminal := true)` · job ต้อง `done` ∧ `qty_good > qty_order` (ไม่ใช่ ⇒ `no_surplus`) · `cancelled` ⇒ `job_closed` · OEM เท่านั้น (production ⇒ `surplus_fixed`) · ค่า in (`hold`,`spare`,`deliver`) · event `surplus_set` before/after (`channel='job_page'`) |
| `job_guard()` trigger | replace (def **0173:566**) | §8.4 |
| `v_job_board` | replace (def **0174:769**) — ต่อท้าย | `qty_order` · `qty_surplus` (done: `qty_good − qty_order` else null) · `under_planned` (status ไม่ปลายทาง ∧ `qty_planned < qty_order`) · `surplus_pending` (done ∧ surplus > 0 ∧ `hold`) · `surplus_disposition` · `target_piece_g` · `metal_plan_g` · **แก้นิพจน์คอลัมน์เดิม** `quote_qty_mismatch` ให้เทียบ `aqi.qty is distinct from j.qty_order` (เดิมเทียบ `qty_planned` ซึ่งหลัง M1 ต่างกันโดยตั้งใจ · ชื่อ/ชนิด/ลำดับเดิม ไม่ชน 42P16 · ใบ J1 เดิมค่าไม่เปลี่ยนเพราะ backfill เท่ากัน) |

> ⏸ **พักไว้ตามมติเจ้าของ 15 ต.ค. 69** — RPC/view ของ ledger ด้านล่างยังไม่ทำ · ช่องเลข `0176` ถูกใช้โดย **record profile** (`design-job-record-profile.md` §4) · D6 ส่วน `job_worker_resolve` ย้ายไปทำใน 0176 profile · ห้ามลบ spec นี้ — ถ้าปลุกต้องเขียนทับบนฐานที่มี profile (ดู record-profile §9)
**0176**

| ฟังก์ชัน | สถานะ | สาระ |
|---|---|---|
| `job_metal_material_ensure(p_shop_id uuid) returns void` | ใหม่ (ภายใน) | seed §8.1 · `on conflict do nothing` · รันให้ทุก shop ใน migration |
| `job_metal_lines_parse(p_shop_id uuid, p_metal text, p_kind text, p_lines jsonb) returns jsonb` | ใหม่ (ภายใน) | ตรวจ+คำนวณ §8.2 · raise 22023 hint: `lines_required` · `line_invalid` · `material_unknown` · `material_inactive` · `metal_mismatch` · `precious_required` · `line_dup` · `too_many_lines` · `weight_invalid` (ผ่าน `job_weight_ok`) |
| `job_metal_core_issue(p_job_id uuid, p_kind text, p_lines jsonb, p_occurred_on date, p_note text, p_worker_id uuid, p_assignee text, p_channel text, p_actor uuid, p_device_hint text, p_enforce_scope boolean, p_confirm boolean, p_stage_code text) returns jsonb` | ใหม่ (ภายใน · pattern `job_fail` ไม่ raise) | ล็อก job `for update` · `metal not in ('silver','gold')` ⇒ `metal_unsupported` · **issue**: stage = `stage_code='cast'` (ไม่มี ⇒ `no_cast_stage`) · pending ⇒ เรียก `job_core_receive(p_weight_in := total_g, …)` ก่อน (fail ส่งต่อตรงๆ รวม `awaiting_deposit`/`stage_not_allowed`/`prev_not_sent`) · received+มี ledger ⇒ `use_top_up` · received ไม่มี ledger ⇒ `stage_already_received` (hint ย้อนขั้น) · **top_up**: stage = ขั้นที่ `received` อยู่ ∧ `metal_present` · ต้องมี issue non-void ≥ 1 (`issue_first`) · ช่าง: ต้องเป็นผู้ถือ (`not_holder`) · note บังคับ (`note_required`) · **return**: stage = `p_stage_code` (office: `received` หรือ `sent` ∧ `metal_present`) หรือขั้นที่ถืออยู่ (ช่าง) · ต้องมี issue (`issue_first`) · `total_g > in_g − returned_g` ⇒ note บังคับ · ทุก kind: วันที่กติกาเดียวกับ receive (ช่าง = วันนี้ · ออฟฟิศ ≤ 14 วัน ไม่อนาคต) · `weight_suspicious` ก่อน insert เมื่อ `not p_confirm` · ลำดับ insert: event `metal_issue` → header → lines · response `{ok, kind, issue_id, stage_code, total_g, alloy_pct, warnings, received: bool}` — **ทอง: ไม่คืน `in_g`/ยอดสะสมใดๆ** · เงิน: คืน `in_g` ได้ |
| `job_metal_issue_add(p_shop_id uuid, p_job_id uuid, p_kind text, p_lines jsonb, p_occurred_on date default null, p_note text default null, p_worker_id uuid default null, p_assignee_name text default null, p_stage_code text default null, p_confirm boolean default false, p_channel text default 'job_page', p_actor uuid default null) returns jsonb` ✱ | ใหม่ (office) | `job_office_begin` · `job_metal_material_ensure` · `p_kind in ('issue','top_up','return')` · assignee ผ่าน `job_label_clean` · worker ต้อง active ในร้าน · `p_channel in ('job_page','daily_sheet')` · fail ⇒ raise 22023 hint = code (รวม `weight_suspicious` — UI ถามแล้วเรียกซ้ำ `p_confirm := true`) |
| `job_metal_issue_void(p_shop_id uuid, p_job_id uuid, p_issue_id uuid, p_reason text, p_actor uuid default null) returns jsonb` ✱ | ใหม่ (office เท่านั้น — ช่างไม่มี) | เป้าหมายต้องของ job นี้ · non-void · ไม่เคยถูก void · `kind='issue'` ⇒ reject เสมอ (`use_reopen` — ย้อนขั้นจัดการให้) · `top_up/return` ⇒ stage ต้อง `received` (`sent` ⇒ `stage_sent` hint ย้อนขั้น) · reason ผ่าน `job_text_clean(…,200,true)` · insert event `metal_void` + header `void` (คัดลอก `total_g/fine_g`) |
| `job_worker_metal_issue(p_token_hash text, p_session_hash text, p_expected_seq int, p_kind text, p_lines jsonb, p_note text default null, p_confirm boolean default false, p_user_agent text default null, p_ip_hash text default null) returns jsonb` ✱ | ใหม่ (ช่าง) | `job_worker_auth(…, true, true, 'write')` · kind in (issue, top_up, return) · core หา stage เอง แล้วต้อง `= p_expected_seq` (ไม่ตรง ⇒ `stage_changed`) · channel `worker_qr` · `p_enforce_scope := true` · ไม่มี `p_stage_code` · `already_received` ของ issue ⇒ ถ้า stage ถูกรับโดยช่างคนเดียวกันและมี ledger ⇒ คืน `{ok:true, already:true}` (กดซ้ำเพราะ network — pattern `job_worker_send`) |
| `job_core_send(…)` 14 args | replace (def **0172:1036** — ตัวเดียวที่ยังเป็นของ 0172 · ยืนยัน md5 ก่อน) | หลัง validate เดิม: stage นี้มี ledger non-void ⇒ `v_added := Σ top_up` · `p_metal_added > 0` ⇒ `use_ledger` · `v_note := coalesce(cleaned p_weight_note, 'ledger')` เมื่อ `v_added > 0` · มี return ของ stage ⇒ `scrap_weight := Σ return` และ `p_scrap_weight` ต้อง null หรือเท่ากัน (ไม่งั้น `use_ledger`) · ไม่มี return แต่ส่ง `p_scrap_weight` ∧ job `has_ledger` ⇒ สร้าง return ผ่าน `job_metal_core_issue(kind='return')` **ก่อน** update stage (fail ⇒ ทั้ง send ตก) · ไม่มี ledger เลย ⇒ ตรรกะ J1 เป๊ะ · `weight_over` ใช้ `v_added` จาก ledger |
| `job_stage_reopen(uuid,uuid,text,uuid)` ✱ | replace (def **0172:1739**) | ก่อน UPDATE stage: `sent→received` ⇒ void return ของ stage นั้น · `received→pending` ⇒ void ทุก header non-void ของ stage (issue+top_up+return) · เหตุผล = `p_reason` · event `stage_reopen` payload เพิ่ม `voided_issue_ids[]` · ทางเดียวที่ void `issue` ได้ |
| `job_worker_resolve(text,text,text)` ✱ | replace (def **0174:415**) | D6: ใช้ `job_deposit_blocked`/`job_worker_can_do` (บ.465–467, 476, 483–489) · `job_metal_material_ensure` · เพิ่ม `metal` block: `{ledger_enabled: metal in (silver,gold), materials: [{code,label,component,fineness}] (เฉพาะ is_active ของโลหะนั้น · **ไม่ส่ง pct_warn**), can_top_up, can_return, has_ledger, in_g (เงินเท่านั้น), avg_piece_g}` · `next_action = 'metal_issue'` แทน `'receive'` เมื่อ pend = `cast` ∧ ledger_enabled (เงื่อนไขอื่นเท่า receive รวม awaiting_deposit/prev_not_sent) · **ทอง: ไม่มี `in_g`/`issued_g`/`metal_plan_g` ใน response** |
| `v_job_metal_balance` · `v_job_metal_recycle_pool` · `v_job_metal_drift` | ใหม่ (`security_invoker`) | §8.2 |
| `v_job_board` | replace (def = **0175**) — ต่อท้าย | `metal_in_g` · `metal_not_issued` (`cast` received/sent ∧ `weigh_required` ∧ ไม่มี issue non-void ∧ metal in silver/gold) · `alloy_warn` (มี header non-void ที่ `warnings <> '[]'`) · `return_not_recorded` |

🔴 ทุก `create or replace` ข้างบน: `revoke … from public, anon, authenticated` + grant `service_role` (✱) · หลัง apply ทั้ง 2 ไฟล์: `node scripts/run-sql.mjs scripts/check-analytics-grants.sql` + ตรวจ overload `job_create_from_*`/`job_done`/`job_create_insert` ด้วย `pg_get_function_identity_arguments` = 1 แถวต่อชื่อ

### 8.4 `job_guard` (0175 — ลอก def 0173:566 แล้วแก้เฉพาะจุด)

INSERT เพิ่ม: `new.qty_order` ต้อง = `i.qty` (oem) / `poi.qty_planned` (production) — ใช้ select เดิมที่มีอยู่แล้ว (เพิ่ม `i.qty`/`poi.qty_planned` เข้า into) · `surplus_*` ต้อง null · `job_plan_ck` คุมคู่ plan อยู่แล้ว
UPDATE แก้ 4 จุด:
1. รายการแช่แข็ง (บ.640–650): **เพิ่ม `qty_order`** · **ถอด `qty_planned` ออก** แล้วตรวจแยก: `new.qty_planned <> old.qty_planned` ⇒ ต้อง `not exists (job_stage received/sent)` ไม่งั้น raise `job: แก้จำนวนเริ่มผลิตได้เฉพาะก่อนขั้นแรกถูกรับ`
2. plan: `target_piece_g/metal_plan_g/metal_plan_basis` เปลี่ยน ⇒ ต้อง `not exists (job_stage where stage_code='cast' and status in ('received','sent'))` · และเมื่อ `metal_plan_basis` ไม่ null และ `basis->>'override_g'` เป็น null ⇒ `(basis->>'qty_planned')::int = new.qty_planned` และ `(basis->>'target_piece_g')::numeric = new.target_piece_g` ไม่งั้น raise `plan_drift`
3. terminal (บ.651–653): `old.status = 'done'` ⇒ **ยอมเฉพาะ** `to_jsonb(new) - 'surplus_disposition' - 'surplus_note' - 'updated_at' = to_jsonb(old) - (3 key เดิม)` (ทุกคอลัมน์อื่นเท่าเดิมเป๊ะ) ไม่งั้น raise เดิม · `cancelled` ⇒ raise เดิมทุกกรณี
4. `new.status <> 'done'` ⇒ `surplus_*` ต้อง null (CHECK ครอบแล้ว — ใส่ข้อความอ่านง่ายใน guard ด้วย)
verify: **mutant UPDATE ทีละคอลัมน์** บน job ทุก status ที่มีจริงบน prod (open/in_progress/on_hold/done/cancelled — status ไหนไม่มีให้สร้างผ่าน RPC ใน do-block) นับว่าตกถูกตัว (แบบ verify-0174)

### 8.5 `production_order_done` (ข้อ 6 ของ brief)

def ล่าสุด 0141 บ.446–700: `qty_done` ตรวจแค่ `0 ≤ x ≤ 100000` (บ.551) **ไม่มีด่าน `qty_done ≤ qty_planned`** ⇒ ของเหลือเข้าสต็อกได้ทั้งหมด · ไม่แตะ RPC นี้ · UI หน้าปิดใบผลิต: prefill `qty_done = job.qty_good` (J1 §4.2 เดิม) + แถบข้อมูล "ผลิตได้ X ชิ้น มากกว่าที่สั่ง Y — เข้าสต็อกทั้งหมด" (ไม่บล็อก) · `v_production_order_job_mismatch` (qty_done ≠ qty_good) ทำงานเหมือนเดิม · backend-dev ยืนยันซ้ำด้วย `pg_get_functiondef` สดก่อนเชื่อ (ข้อ 13/21)

### 8.6 สิทธิ์ (ข้อ 8)

| ช่องทาง | ทำอะไรได้ | ยืนยัน |
|---|---|---|
| ช่าง (`/w/` token + session · ไม่มี `auth.uid()`) | `job_worker_metal_issue` kind issue/top_up/return บนขั้นที่ตัวเองถือ/ขั้น cast ถัดไป · เห็น `materials[]` (code/label/fineness) · เงิน: เห็น `in_g`/`avg_piece_g` · **ทอง: ไม่เห็นยอดเบิกสะสม/แผน/ส่วนต่าง** (N1 ของ 0174 ขยายมาถึง ledger) · ห้าม void · ห้ามเลือก stage · ห้ามย้อนวัน | เทสต์ B8: ยิง `job_worker_resolve` + `job_worker_metal_issue` + `job_worker_send` ใบทอง แล้ว `jsonb_path_exists` หา key `in_g`,`issued_g`,`metal_plan_g`,`plan_vs_in_g`,`prev_weight_out_g` ต้องไม่มี |
| ออฟฟิศ (owner/admin · `crm_require_owner_admin` + `p_actor`) | ทุก RPC ✱ ใน §8.3 · void · เลือก stage ตอน return · ย้อนวัน ≤ 14 | — |
| anon/authenticated | ไม่มีอะไร (สคีมา `analytics` ปิด REST ตั้งแต่ 0123) | `check-analytics-grants.sql` + เคส 18.5 (grant usage ชั่วคราว → `set local role authenticated` → ยิง `job_metal_issue_add(null…)` ต้อง 42501) |
| ราคา/ต้นทุน | **M1 ไม่มีคอลัมน์ราคา/ต้นทุนในทุก object** (ยืนยัน: `job_metal_material` ไม่มีราคา · `fineness` ไม่ใช่ราคา · `oem_metal_price`/`silver_price_daily` ไม่ถูก join ที่ไหน) · ใบพิมพ์ `PrintableJob` ประกอบทีละ field: `qty_order/qty_planned/target_piece_g/metal_plan_g` + ช่องเขียน "เบิกจริง ___ g" — **ไม่มี ledger/ดุล** บนกระดาษ (ทอง = มูลค่า) | grep `price\|cost\|thb` ใน 0175/0176 ต้องเจอแค่ในคอมเมนต์ · verify ยิงหน้า `/jobs/[id]/print` ใบทองแล้ว grep ตัวเลข `in_g` ใน HTML |

### 8.7 รายการเคสห้ามผ่าน + ต้องไม่พัง → `scripts/verify/verify-0175.sql` และ `verify-0176.sql` (do-block + raise rollback · `set_config('request.jwt.claims','{"role":"service_role"}',true)` · ข้อมูลทดสอบสร้างผ่าน RPC เท่านั้น · ปิดท้ายด้วยตารางแมป "ข้อในบรีฟ → เทสต์")

**verify-0175 — ห้ามผ่าน**

| T | เคส | ด่านที่จับ |
|---|---|---|
| A1 | backfill: `updated_at` md5/`count(distinct)` ของ `job` เปลี่ยน · `trg_job_guard.tgenabled <> 'O'` หลัง apply | assert ก่อน/หลัง (ข้อ 19) — ใบ done/cancelled บน prod ต้องผ่าน backfill ได้ |
| A2 | `job_create_from_*` ส่ง `p_qty_planned` 0 / 100001 · `p_target_piece_g` ≤ 0 / NaN / 10001 · `p_metal_plan_override_g` ไม่มี reason / reason มีแต่อักขระล่องหน | RPC 22023 (`not(between)` · `oem_note_present`) |
| A3 | INSERT `job` ตรง `qty_order ≠ item.qty` · `surplus_disposition` ตั้งตอน insert · `metal_plan_g` ไม่ null แต่ `target_piece_g` null | `job_guard` INSERT · `job_plan_ck` |
| A4 | UPDATE `qty_order` · UPDATE `qty_planned` หลัง stage แรก received · UPDATE `target_piece_g` หลัง cast received · UPDATE `metal_plan_g` ตรงให้ไม่ตรง basis (plan_drift) | `job_guard` UPDATE (mutant ทีละคอลัมน์ × ทุก status) |
| A5 | job `done`: UPDATE คอลัมน์ใดๆ นอกจาก `surplus_*` (mutant ทุกคอลัมน์) · job `cancelled`: UPDATE `surplus_*` | `job_guard` ข้อ 3 |
| A6 | `job_done` OEM `p_surplus_disposition='stock'` · production ส่ง `'hold'` · ไม่มี surplus แต่ส่ง disposition · note > 200 / ล่องหน | RPC |
| A7 | `job_surplus_set` บนใบ open · บนใบ done ที่ไม่มี surplus · บนใบ production · บนใบ cancelled · ค่า `'stock'`/ค่ามั่ว | RPC |
| A8 | `job_qty_planned_set` หลัง received · ค่า < 1 · `job_plan_set` หลัง cast received · override ไม่มี reason | RPC + guard |
| A9 | `job_plan_suggest` เมื่อ rate reject/sprue ว่าง (ลบ rate ใน do-block) คืน `qty_planned_suggest`/`metal_plan_g` = **null จริง** (`jsonb_typeof = 'null'`) ไม่ใช่ 0 + `missing[]` · input NaN/Infinity | ข้อ 13/37 |
| A10 | `job_office_receive` `p_assignee_name` มี `<`/`>` (D2) | `job_label_clean` |
| A11 | overload: `pg_proc` ของ `job_create_from_quote_item`/`_production_item`/`job_done`/`job_create_insert` > 1 แถว · `job_counter_bump` ยังอยู่ | assert หลัง apply |
| A12 | anon/authenticated execute RPC ใหม่ (18.5) | 42501 |

**verify-0175 — ต้องไม่พัง**: ใบ J1 ทุก status ที่มีจริงบน prod (รวม **JB-0018** ใบจริงของเจ้าของ — อ่านด้วย query `job_no = 'JB-0018'` ไม่ hardcode id) หลัง alter: `qty_order = qty_planned` · `v_job_board` คืนแถวครบเท่าเดิม (นับก่อน/หลัง) + คอลัมน์ใหม่ `under_planned=false`, `qty_surplus` null/0, `quote_qty_mismatch` ค่าเดิม · `job_worker_resolve` token ใบจริงคืน `ok` (ถ้ามี token active) · `job_create_from_*` แบบไม่ส่ง arg ใหม่ (caller เดิม) ⇒ `qty_planned = qty_order`, plan จาก source · `p_qty_planned < qty_order` ⇒ สร้างได้ + `under_planned=true` (Q9) · SKU ไม่มี `silver_weight_g` ⇒ สร้างได้ `target_piece_g` null · rate `sprue_loss_pct` ว่าง ⇒ สร้างได้ `metal_plan_g` null + `plan_missing[]` · `job_done` แบบเดิม (ไม่ส่ง surplus) บนใบ `qty_good ≤ qty_order` ⇒ ผ่าน `surplus_disposition` null · `job_done` OEM `qty_good > qty_order` ไม่ส่ง ⇒ `hold` · production ⇒ `stock` · `job_surplus_set` hold→spare บนใบ done ⇒ ผ่าน + event · `job_office_receive` ชื่อปกติ/ว่าง/null ยังรับได้ (D2 ไม่ทำ optional พัง) · `job_core_receive` หลังใช้ helper: เคส `awaiting_deposit`/`stage_not_allowed` ของ verify-0174 ให้ผลเดิม (ลอกเคสมา) · md5 ของ `oem_*`/`production_*`/`job_stage_guard`/`job_core_send`/`job_worker_resolve` เท่าเดิม (baseline แบบ 0172 ส่วน 0)

**verify-0176 — ห้ามผ่าน**

| T | เคส | ด่านที่จับ |
|---|---|---|
| B1 | บรรทัด: `weight_g` ≤ 0 / NaN / Infinity / > 100000 / ทศนิยม 4 · `material_code` ไม่มี/ปิด/คนละโลหะกับ job/คนละร้าน · ซ้ำในครั้งเดียว · > 10 บรรทัด · issue/top_up ไม่มี precious/recycled (อัลลอยล้วน) · `p_lines` ไม่ใช่ array / ว่าง / JSON null | `job_metal_lines_parse` + CHECK |
| B2 | เบิกให้ใบทองเหลือง · ใบ done/cancelled · ใบ on_hold · ใบที่ไม่มีขั้น cast · issue ซ้ำบน cast ที่รับแล้ว (มี ledger ⇒ `use_top_up` · ไม่มี ⇒ `stage_already_received`) · top_up/return ก่อนมี issue (`issue_first`) · top_up ไม่มี note · return > in−returned ไม่มี note · ออฟฟิศ return บน stage pending / `metal_present=false` (`wax_inject`) · วันที่อนาคต / > 14 วัน | core |
| B3 | ช่าง: เบิกขั้นที่ไม่ใช่ `p_expected_seq` · ช่างนอก scope ขั้น cast · ไม่ใช่ผู้ถือทำ top_up/return · void (ไม่มี RPC) · session หมด · token เพิกถอน · ใบทอง OEM `awaiting_deposit` ⇒ issue ตก (ผ่าน core_receive) · วันที่ ≠ วันนี้ (arg ไม่มี — ตรวจว่า core ใช้ `job_today()`) | `job_worker_auth` + core + helper D6 |
| B4 | void: แถว `issue` · แถวที่ถูก void แล้ว · แถว void เอง · stage `sent` แล้ว · ไม่มีเหตุผล · issue_id ของใบอื่น/ร้านอื่น | `job_metal_issue_void` + unique `void_of_id` |
| B5 | UPDATE/DELETE/TRUNCATE `job_metal_issue`/`_line` (ทุก role รวม postgres) · `job_metal_material` UPDATE `fineness`/`component`/`metal` · DELETE · insert header ที่ `total_g ≠ Σ lines` แล้ว commit (ใน savepoint) · insert line ใต้ header `void` | append-only trigger · deferred constraint trigger |
| B6 | `job_core_send` บน stage ที่มี ledger: ส่ง `p_metal_added > 0` · ส่ง `p_scrap_weight ≠ Σ return` ที่มีอยู่ · `weight_out > weight_in + Σ top_up` · `p_scrap_weight` ที่ทำให้ return เกินเบิกโดยไม่มี note ⇒ **ทั้ง send ต้องไม่เกิด** (stage ยัง received · ไม่มี header return) | `use_ledger` · `weight_over` · R12 |
| B7 | `weight_suspicious`: issue `total_g > 3 × metal_plan_g` หรือ > 5000 โดย `p_confirm=false` ⇒ ไม่เขียนแถว (นับ header + stage status ก่อน/หลัง) · `p_confirm=true` ⇒ เขียน | core |
| B8 | 🔴 ทอง: response ของ `job_worker_resolve`/`job_worker_metal_issue`/`job_worker_send` มี key `in_g`/`issued_g`/`metal_plan_g`/`plan_vs_in_g`/`prev_weight_out_g` | `jsonb_path_exists` = false |
| B9 | ตารางใหม่/view ใหม่: anon/authenticated select (18.5) · RPC ใหม่ execute | 42501 |
| B10 | เตือนอัลลอย: เงิน `ag999` 100 g + `alloy_ag` 5 g ⇒ `warnings` มี `alloy_pct_out_of_range` (5/105 = 4.76 < 6.5) **แต่ insert สำเร็จ** (ไม่บล็อก) · `ag999` 100 g ไม่มี alloy ⇒ `no_alloy` · `recycle_ag925` ล้วน ⇒ `alloy_pct` null (`jsonb_typeof='null'`) ไม่มี warning · ทอง `alloy_au` ⇒ ไม่มี warning (ไม่มีช่วง) | parse |
| B11 | หลังทุกเคส `v_job_metal_drift` ว่าง · overload ของ `job_core_send`/`job_stage_reopen`/`job_worker_resolve` = 1 แถว | view · pg_proc |

**verify-0176 — ต้องไม่พัง** (ยิงของใหม่ใส่ของเก่าจริง — ข้อ 17): ใบ J1 บน prod ทุก status: `v_job_metal_balance.has_ledger=false` ทุกใบ · `v_job_board` คอลัมน์ใหม่ null/false · `job_worker_send`/`job_office_send` บนใบ J1 ที่ไม่มี ledger ด้วย `p_metal_added`/`p_scrap_weight` แบบเดิม ⇒ ผ่านเหมือน verify-0172 (ลอกเคส send ทั้งชุดมา) · `job_stage_reopen` ใบไม่มี ledger ⇒ ผลเดิม · **ใบเงินใหม่ flow เต็ม**: ช่างสแกน cast pending → `next_action='metal_issue'` → เบิก [`ag999` 92.5, `alloy_ag` 7] ⇒ stage `received`, `weight_in_g = 99.5`, `job.weight_start_g = 99.5`, `alloy_pct ≈ 7.035` ไม่มี warning · top_up [`recycle_ag925` 10] + note ⇒ ส่งต่อ `weight_out` 105 ⇒ `metal_added_g = 10`, `weight_note='ledger'` · cut_sprue รับ 105 → ส่งต่อ `weight_out` 80 + `p_scrap_weight` 20 ⇒ สร้าง return 20 g fineness = `in_fineness_eff` ((92.5×0.999 + 10×0.925)/109.5 → 4 ตำแหน่ง) ⇒ `scrap_weight_g = 20` · balance: `in_g 109.5`, `returned_g 20`, `net_used_g 89.5`, `melt_loss_g 4.5`, `loss_g = 109.5−20−80 = 9.5`, `recycled_in_g 10`, `fineness_mix` 3 แถว · ใบ B เบิก [`recycle_ag925` 20] ล้วน ⇒ `alloy_pct` null · `v_job_metal_recycle_pool.pool_g` ของร้าน = 20 − 30 = −10 ⇒ `pool_negative=true` (เตือน ไม่บล็อก) · void top_up ขณะ received ⇒ balance กลับเท่าก่อน (`void_count=1`) · reopen cast (received→pending) ⇒ ทุก header ของ stage ถูก void, `weight_in_g` null, เบิกใหม่ได้ · ออฟฟิศ issue แทนช่าง (`p_worker_id` หรือ `p_assignee_name`) ⇒ ผ่าน · ใบทอง: issue [`au9999` 10, `alloy_au` 3.33] ⇒ `warnings=[]` (ไม่มีช่วง) + response ไม่มี `in_g` · ใบเดียวเบิก `ag925` + `ag999` ⇒ `fineness_mix` 2 แถว · ช่วง 00:00–07:00 ไทย `occurred_on` = วันไทย (ข้อ 6 — ทดสอบด้วย `job_today()` เทียบ `current_date`)
ตารางแมปบรีฟ→เทสต์: ข้อไหนไม่มีเทสต์ เขียนว่าไม่มี + เหตุผล — คาดไว้ก่อน: **race 2 ช่างเบิก cast พร้อมกัน** = ไม่มีเทสต์ใน do-block เดียว (ต้อง 2 connection) · กันด้วย `for update` บน job + `uq_job_stage_one_received`

### 8.8 ไฟล์โค้ดที่ต้องแก้ (คอมมิตเดียวกับ migration ที่เกี่ยว · ลำดับ deploy: apply DB → merge โค้ด · named args ⇒ arg ใหม่ไม่ส่ง = default แต่ **ต้อง drop signature เดิม** ไม่งั้น PGRST เจอ 2 ตัว)

| ไฟล์ | 0175 | 0176 |
|---|---|---|
| `lib/actions/job-office.ts` (บ.196 `job_stage_suggest` · บ.248–249 create) | เพิ่ม action `getJobPlanSuggest` → `job_plan_suggest` · create ส่ง `p_qty_planned/p_target_piece_g/p_metal_plan_override_g/p_metal_plan_reason` · อ่าน `v_job_board` คอลัมน์ใหม่ · หน้า `[id]` อ่าน `job.qty_order/target/plan/surplus_*` | อ่าน `v_job_metal_balance` + ledger (header+lines) สำหรับการ์ดโลหะ |
| `lib/actions/job-office-write.ts` (บ.232 `job_done`) | `job_done` ส่ง `p_surplus_*` · เพิ่ม `job_surplus_set` · `job_qty_planned_set` · `job_plan_set` | เพิ่ม `job_metal_issue_add` · `job_metal_issue_void` |
| `lib/actions/job-worker.ts` | — | เพิ่ม `workerMetalIssue` → `job_worker_metal_issue` · validate รูปร่าง `lines` ฝั่ง TS (pre-check เท่านั้น — DB ตัดสิน) |
| `lib/jobs/worker-view.ts` (`WorkerJobView`) | — | เพิ่ม `metal?: {ledgerEnabled, materials[], canTopUp, canReturn, hasLedger, inG?, avgPieceG?}` **ประกอบทีละ field** · ทอง: `inG` undefined |
| `lib/jobs/print.ts` (`PrintableJob`) | เพิ่ม `qtyOrder, qtyPlanned, targetPieceG, metalPlanG` | ไม่เพิ่ม ledger |
| `components/domain/jobs/*` (ฟอร์มสร้าง · `JobsOffice.test.tsx`) + `app/(dashboard)/jobs/[id]/page.tsx` · `app/(dashboard)/jobs/page.tsx` · `app/(dashboard)/jobs/[id]/print/page.tsx` · `components/domain/jobs/JobPrintClient.tsx` | ฟอร์ม 2 แถวใหม่ · การ์ด "จำนวน/แผน" · ป้ายบอร์ด `under_planned`/`surplus_pending` · ปิดงาน: ส่วน "ของเหลือ" เมื่อ `qty_good > qty_order` · ปุ่ม "ตัดสินของเหลือ" บนใบ done | การ์ด "โลหะ" (ledger + ดุล + ปุ่ม office) · ป้าย `metal_not_issued`/`alloy_warn`/`return_not_recorded` |
| `app/(worker)/w/[token]/page.tsx` + component ช่าง | — | จอเบิก (ปุ่มวัสดุใหญ่ + ช่องกรัม + เพิ่มบรรทัด) · ปุ่มเติม · ส่งต่อมีช่อง "เศษคืน g" (cut_sprue) · ยืนยัน `weight_suspicious` · ทองไม่โชว์ยอดสะสม |
| เทสต์ `lib/actions/job-office.test.ts` · `job-worker.test.ts` · `lib/jobs/print.test.ts` · `lib/jobs/messages.test.ts` | อัปเดตตาม | อัปเดตตาม + เคส "ทองไม่มี inG" |

### 8.9 หน้าจอ M1 (ส่ง ux-ui — ระดับรายการ · สิทธิ์เดิม: `/jobs/*` owner/admin · `/w/*` ช่าง)

1. **ฟอร์มสร้างใบงาน** — แถว "จำนวนที่สั่ง N (อ่านอย่างเดียว) → จำนวนเริ่มผลิต [ ]" ค่าเริ่ม `qty_planned_suggest` + ป้าย "เผื่อ x ชิ้น จาก reject rate หล่อ a% / ขัด b% / ชุบ c%" · rate ว่าง = ช่องว่าง + ลิงก์ `/oem/rates` · น้อยกว่าที่สั่ง = ป้ายเหลือง "ผลิตบางส่วน" (ไม่บล็อก) · แถว "น้ำหนัก/ชิ้น [ ] g (ค่าเริ่มจาก SKU/ใบเสนอราคา · บอกที่มา) → โลหะที่ต้องเตรียม = 35 × 4.000 × (1 + ก้านต้น 12%) = xxx g" (อ่านอย่างเดียว · ปุ่ม "กำหนดเอง" เปิดช่อง g + เหตุผล) · ทุกตัวเลขมาจาก `job_plan_suggest` re-fetch (debounce) ไม่คูณใน client
2. **`/jobs/[id]` การ์ด "จำนวน/แผน"** — สั่ง / เริ่มผลิต (แก้ได้จนกว่าขั้นแรกรับ) / เป้าหมาย/ชิ้น / โลหะที่ต้องเตรียม (+ที่มา) / ปุ่มแก้แผน (จนกว่า cast รับ)
3. **`/jobs/[id]` การ์ด "โลหะ"** (0176) — บน: แผน vs เบิกจริง · ดุล: เข้า · คืน · ใช้จริง · หล่อออก · เฉลี่ย/ชิ้น vs เป้า · หายตอนหล่อ · หายจริง g (%) · % อัลลอยครั้งล่าสุด + เตือน · ล่าง: ตาราง ledger (วัน · ชนิด · บรรทัดส่วนผสม · รวม g · ใคร · ช่องทาง · void?) · ปุ่ม office: เบิก / เติม / คืนเศษ (เลือกขั้น) / ยกเลิกรายการ (+เหตุผล · ซ่อนเมื่อขั้น sent แล้ว + ข้อความ "ย้อนขั้นก่อน") · ป้าย "ยังไม่บันทึกเศษคืน" · "ยังไม่เบิกโลหะ" · staff เห็นการ์ดนี้ได้ (ไม่มีราคา)
4. **`/w/[token]` ขั้น cast (ช่าง)** — `next_action='metal_issue'`: หัว "เบิกโลหะเพื่อหล่อ" · ปุ่มวัสดุใหญ่จาก `materials[]` (เงินค่าเริ่มเลือก "เงินเม็ด 999" + "อัลลอยสำเร็จรูป" เป็น 2 บรรทัดว่าง) · ช่องกรัม `inputmode=decimal` ต่อบรรทัด · "+ เพิ่มส่วนผสม" (รวม "เศษหลอมกลับ") · ปุ่มยืนยัน = รับงาน · ผลลัพธ์: "เบิกแล้ว 99.5 g · อัลลอย 7.0%" + เตือนเหลืองถ้านอกช่วง · ถือขั้นอยู่: ปุ่ม "เติมโลหะ" (บรรทัด + เหตุผลชิป) · "ส่งต่อ" = ชั่งรวมหลังหล่อ (เดิม) · หลังส่ง: "เฉลี่ยต่อชิ้น x.xxx g" · ปุ่มยืนยัน disable ระหว่างรอ (R14) · **ทอง**: ไม่โชว์ยอดเบิกสะสม/แผน/ส่วนต่างทุกจุด (ชั่งแบบไม่รู้คำตอบ)
5. **`/w/[token]` ขั้น cut_sprue** — "ส่งต่อ": น้ำหนักออก (เดิม) + **"เศษ/ก้านต้นคืน (g)"** ไม่บังคับ → ledger return อัตโนมัติ · ป้าย "เศษนี้นำกลับไปหล่อต่อได้"
6. **ปิดงาน** — เมื่อ `qty_good > qty_order`: ส่วน "ของเหลือ n ชิ้น" OEM: ถือไว้ก่อน (ค่าเริ่ม) / อะไหล่-ตัวอย่าง / ส่งแถมลูกค้า + หมายเหตุ · production: ข้อความ "เข้าสต็อกทั้งหมดตอนปิดใบผลิต" · ใบ done ที่ `hold`: ปุ่ม "ตัดสินของเหลือ"
7. **บอร์ด** — ป้าย `under_planned` · `surplus_pending` ("เหลือ n ชิ้นยังไม่ตัดสิน") · `metal_not_issued` · `alloy_warn` · `return_not_recorded`
8. **ใบ A5** — เพิ่ม สั่ง/เริ่มผลิต · เป้าหมาย/ชิ้น · โลหะที่ต้องเตรียม g · ช่องเขียนมือ "เบิกจริง ___ g" — ไม่มี ledger

### 8.10 ลำดับงาน
> ⏸ **มติ 15 ต.ค. 69**: ลำดับ 0176 ledger ด้านล่างพักไว้ — ลำดับงานจริงดู `design-job-record-profile.md` §11

`0175` (backend-dev · worktree) → verify-0175 → security + QA (M: create/done/board/print) → merge → ฟอร์มสร้างใบงาน + ปิดงาน (frontend-dev ขนานกับ) → `0176` (backend-dev) → verify-0176 → **security บังคับ** (RPC เขียนฝั่งช่าง + น้ำหนักทอง = มูลค่า) + QA L (ทุก flow `/w/`) → การ์ดโลหะ + จอช่าง → UAT ให้ช่างหล่อ 1 คนลองใบเงินจริง 1 ใบก่อนเปิดทอง

### 8.11 ความเสี่ยงเฉพาะ M1 (เพิ่มจาก §7)

- R10 **backfill ผ่าน trigger disabled** — ลืม `enable trigger` ในทรานแซกชันเดียวกัน = guard หาย · verify assert `tgenabled = 'O'` ของ `trg_job_guard` หลัง apply
- R11 **`job_core_send` เป็นฟังก์ชันเดียวที่ 0173/0174 ไม่เคยแตะ** — def = 0172:1036 จริง (ยืนยัน md5 ก่อน replace) · branch ledger ต้องไม่เปลี่ยนผล path ไม่มี ledger (ลอกเคส verify-0172 ส่วน send มาทั้งชุด)
- R12 **return อัตโนมัติจาก `p_scrap_weight` ใน core_send** — core_issue fail (เช่น note_required) ⇒ ทั้ง send ต้องไม่เกิด (ไม่ใช่ส่งต่อสำเร็จแต่ return หาย) · เทสต์ B6
- R13 **void ทำไม่ได้หลังขั้น sent** — ออฟฟิศต้องย้อนขั้น (void ทั้งขั้น) แล้วกรอกใหม่ · บอกในจอ ไม่ให้งงว่าปุ่มหาย
- R14 **ช่างกดซ้ำเพราะ network** — issue ซ้ำบน cast received ⇒ `already` (ไม่สร้างซ้ำ) · top_up/return ซ้ำ = 2 แถวจริง (ไม่มี idempotency key) ⇒ ปุ่ม disable ระหว่างรอ + ออฟฟิศ void ได้ · เกิดจริงค่อยเพิ่ม `p_client_key` (YAGNI)
- R15 **`quote_qty_mismatch` เปลี่ยนความหมาย** (เทียบ `qty_order`) — ใบ J1 เดิม `qty_order = qty_planned` ⇒ ค่าเท่าเดิม · หน้าบอร์ดไม่ต้องแก้
- R16 **ใบทองที่กำลังเดินอยู่บน prod ตอน apply 0176** — ถ้า cast รับไปแล้วแบบ J1 จะไม่มี ledger ตลอดใบ (ตั้งใจ · ข้อ 7) · บอร์ดขึ้น `metal_not_issued` ให้รู้ ไม่ใช่บั๊ก

### 8.12 หนี้ที่ M1 รู้ตัวตั้งแต่ spec

ไม่มี UI แก้ทะเบียนวัสดุ (`job_metal_material`) — เพิ่ม/ปิด/แก้ช่วงเตือนต้องผ่าน SQL จน `/jobs/stages` · เศษจาก J1-style `scrap_weight_g` (ใบที่ไม่มี ledger) ไม่เข้ากองเศษ · ไม่มี idempotency key ฝั่งช่าง (R14) · void หลัง sent ต้องย้อนขั้น (R13) · ทองยังไม่มีช่วงเตือนอัลลอย (รอเจ้าของ) · `metal_scrap_ledger` (J6) ยังไม่มี — `kind='return'` + `v_job_metal_recycle_pool` คือต้นทาง · D6 ส่วน `v_job_board.deposit_missing` ยังเป็นนิพจน์แยก (ความหมายต่างจาก `job_deposit_blocked` — ตั้งใจ)

### 8.13 คำถามถึงเจ้าของ (ถามได้ระหว่างทำ ไม่บล็อก 0175)

| # | คำถาม | ค่าเริ่มถ้าไม่ตอบ |
|---|---|---|
| Q11 | **ทอง**: ผสมจาก 99.99 + อัลลอยทองเอง หรือซื้อ 18K/14K สำเร็จ — และช่วง % อัลลอยทองที่อยากให้เตือน | seed ทั้งสองทาง · ไม่เตือน (null) |
| Q12 | ช่าง **ยกเลิกรายการที่กรอกผิดเองไม่ได้** ต้องแจ้งออฟฟิศ (มีจอยืนยันก่อนบันทึก + เตือนน้ำหนักผิดปกติ) — รับได้ไหม | รับได้ (audit ชัดกว่า) |

## 9. G1a พลอย — สิ่งที่ทำจริงใน migration 0190 (22 ต.ค. 69 · 🔁 ทับ §2.4–2.5 และแถว G1 ในตาราง phase ตามมติเจ้าของ 21 ต.ค.)

> เลข migration = **0190** (ไม่ใช่ 0176 ใน §5) · UX: `ux-gems.md` · ไฟล์: `supabase/migrations/0190_gems_g1a.sql` + `scripts/verify/verify-0190.sql` (259 เคส · mutant 29/29) + `scripts/verify/verify-0190-qa.sql` (QA · 79 เช็ค + 1 หนี้ P9) · TS: `lib/jobs/{shop-gems,gems,gems-server}.ts` · `lib/actions/gems.ts` · เทสต์ parity `lib/jobs/shop-gems.qa.test.ts` (กวาดทุกจุดรหัสเทียบ DB จริง)
> สถานะ: dry-run ผ่าน · **ยังไม่ apply** · รอ security 💰 + QA L ก่อน merge · UI (หน้า /oem/gems · W-4 · การ์ดใบงาน · A5) ทำแยก

### 9.1 มติ 21 ต.ค. ที่ทับ design เดิม
| เรื่อง | เดิม (§2.4–2.5) | ตอนนี้ (0190) |
|---|---|---|
| ชนิด/รูปทรงใหม่ | ออฟฟิศยืนยันก่อน (`gem_item_upsert` owner/admin) | **พิมพ์ได้เลยตอนบันทึกใบ/BOM → เข้าแคตตาล็อกเอง** (get-or-create ด้วย `name_norm` ในทรานแซกชันเดียวกับใบ · 2 คนพิมพ์ชื่อเดียวกันพร้อมกัน = ได้ตัวเดียว) · ไม่มีสถานะรอยืนยัน |
| ตัวตนของชื่อ | `code` ตายตัว (`cz` · `oval`) | ไม่มี code — id + `name_norm` (unique ต่อร้าน รวมแถวที่ถูกรวมแล้ว) · seed เฉพาะ **รูปทรง 12 แบบ** (heart = 1 ค่า · cushion = 2 ค่า — เจ้าของยืนยันแล้ว 22 ต.ค. · "บาแก็ตต์") · **ไม่ seed ชนิด/ราคา** |
| ชื่อซ้ำ | ไม่มี | norm เท่ากัน = ใช้ตัวเดิมเงียบๆ (แม้ force) · **คล้าย** (`gem_name_similar`: ระยะแก้ไข 1/2/3 ตามความยาว · ชื่อ ≤ 3 ตัวอักษรเทียบเท่ากันอย่างเดียว) = คืน `gem_similar` + `similar[]` ถ้าไม่ส่ง `p_force` · สร้าง/เปลี่ยนชื่อตรงๆ ที่ norm ซ้ำ = `name_exists` เสมอ |
| รวมชื่อ | ไม่มี | `gem_merge_preview/gem_merge` A→B ย้อนกลับไม่ได้: รายการของ A ย้ายใต้ B (ขนาดชนกัน = รวมเป็นของ B) · **ราคาของ A ไม่ย้าย** · แม่แบบ SKU ตามไป (แถวชนกัน = บวกจำนวน ≤ 1,000) · **ไม่แตะ `job_gem_bom`** (snapshot) |
| ขนาด | `size_mm_a/b` + หน่วย piece/carat | ขนาดละ 1 แถว · `size_a ≤ size_b` (สลับให้) · ทศนิยม ≤ 2 · 0 < x ≤ 100 · **ไม่มี unit** (เม็ดทั้งหมด) · `has_length` แก้ไม่ได้เมื่อมีรายการใช้ |
| ราคา | `gem_item_price` ใน `/oem/rates` | ตารางเดียวกันแต่ **ไม่ให้ role ฝั่งแอป (anon/authenticated/service_role) อ่านตรง** (ถอน service_role ด้วย · role ระดับแพลตฟอร์มอ่านได้เสมอ: postgres · supabase_admin · supabase_etl_admin · supabase_read_only_user [pg_read_all_data] — คุมที่องค์กร) + `gem_item_price_audit` (append-only) — อ่าน/เขียนผ่าน `gem_catalog_list/gem_price_set/gem_price_history` เท่านั้น · actor ต้องเป็นสมาชิก owner/admin จริง (`gem_require_office`) · ทศนิยม ≤ 4 · วันที่มีผล 2020 ถึง +1 ปี (วันไทย) |
| BOM ต่อใบ | `job_gem_bom` มี `breakage_allow_pct` + `qty_total` | ไม่มีเผื่อแตก (G1b) · `qty_total` ไม่เก็บ = ต่อชิ้น × `job.qty_planned` ตอนอ่าน (ไม่ drift) · `gem_label` snapshot · อยู่ที่ใบแม่เท่านั้น · ≤ 30 แถว · `source` product/manual/shopfloor |
| หน้าต่างแก้ | "จน gem_set ถูกรับ" | `job_gem_edit_window`: free_before_start (ยังไม่มีขั้นใดรับ — ผู้จัดการ W3 ใช้) · office_free · **reason_required** (ขั้นฝังรับแล้ว — เหตุผล whitelist `oem_note_present`) · closed (done/cancelled) |
| ขั้นฝัง | ใบ OEM เพิ่มเมื่อ `gem_count > 0` | + SKU ที่มีแม่แบบ = ระบบ **เสนอ** ขั้น `gem_set` (`job_source_info`) · ใบที่ไม่มีขั้นฝัง = ไม่คัดลอกแม่แบบ · ระบบไม่เพิ่ม/ลบขั้นให้เอง · `p_gem_lines`: null = คัดลอกแม่แบบ (ถ้ามีขั้นฝัง) · `[]` = ไม่มีพลอย |

รหัสขั้นฝังพลอยบน DB = `gem_set` (design ถูก · ที่ UX A9 ว่า `setting` ตรวจแล้วไม่พบใน DB) · `bom_change` เพิ่มเป็น event_type (ป้ายใน `EVENT_TYPE_LABEL`).

### 9.2 สิ่งที่ DB ให้ (RPC ทั้งหมด security definer · service_role เท่านั้น)
ออฟฟิศ catalog: `gem_options_list` (ไม่มีราคา) · `gem_catalog_list` · `gem_catalog_create` · `gem_item_create` · `gem_catalog_rename` · `gem_shape_set_has_length` · `gem_merge_preview` · `gem_merge` · `gem_catalog_set_active` · `gem_catalog_remove` (เฉพาะไม่ถูกใช้เลย) · `gem_price_set` · `gem_price_history`
BOM: `product_gem_bom_get/set` · `product_gem_bom_from_job` · `job_gem_bom_get/set` · core `job_gem_bom_replace_core(p_job_id, p_lines, p_force, p_actor, p_worker_id, p_reason, p_source, p_phase, p_allow_item_ids default '{}')` + helper `job_gem_state(p_shop_id, p_root_job_id)` (นิยามเดียวของ "ยังไม่ระบุพลอย" — RPC ให้ getJobDetail อ่าน) + `gem_similar_hits(p_shop_id, p_kind, p_name, p_exclude)` (ตัวเดียวของตัวดักชื่อคล้าย) — **W3 (ผู้จัดการแก้จากมือถือ) เรียก core นี้ด้วย `p_worker_id` หลังตรวจเงื่อนไขของตัวเอง (ผู้เปิด ∧ window = free_before_start)** ไม่ต้อง replace ซ้ำ
replace: `job_source_info` · `job_plan_suggest` (+`gem_bom[]` ไม่มีราคา) · `job_create_insert/_from_quote_item/_from_production_item/_core` (+`p_gem_lines`/`p_gem_force` · drop signature เดิม) · `job_worker_resolve` (+`job.gems[]`/`gems_state` เฉพาะช่างระบุตัวแล้ว)
error ของแถวพลอย = 22023 + hint + detail json `{row, field, code}` · ตัวดักคล้าย = hint `gem_similar` + detail `{similar:[…]}` (ไม่เขียนอะไรเลย)

### 9.3 ที่ยังไม่ทำ / ตัดสินเอง (อ่านก่อน merge)
- **gate "ช่างฝังรับงานไม่ได้เมื่อไม่มีพลอย" (UX A8): เจ้าของตัดสิน 22 ต.ค. = ไม่บล็อก แค่เตือน** — `job_worker_resolve` ส่ง `gems_state='unspecified'` ให้จอเตือน (กล่อง amber) · ไม่มี gate ที่ DB (ใบที่เดินอยู่มีขั้นฝังแต่ไม่มี BOM ทุกใบ — บล็อกจะล็อกงานจริง)
- **type_id/shape_id ที่ถูกรวมแล้ว = resolve ไปปลายทาง ไม่ปฏิเสธ** (UX A3/A6) · ปฏิเสธเฉพาะร้านอื่น/ไม่พบ/ปิดใช้งาน
- W1 `job_worker_open` ไม่แตะ แต่ SKU ที่มีแม่แบบจะได้ขั้นฝัง + BOM คัดลอกมาเอง (ผ่านค่า default ของ `_core`) — W3 ค่อยให้ผู้จัดการแก้ได้
- ไม่มี `unit`/`oem_tier`/`breakage_allow_pct`/สรุปสั่งซื้อ (`v_gem_purchase_summary` = G1b) · ไม่มีรูปพลอย · G3 (เข้าเครื่องคิดต้นทุน) ไม่แตะ
- **รอบแก้ตาม security/QA 22 ต.ค. (ยังไม่ apply — แก้ในไฟล์ 0190 เดิม):** audit ราคา `gem_item_price_audit` (old/new · append-only · แก้ทับวันเดิม/ย้อนหลัง = บังคับ note — `note_required`) · รวมชื่อตรวจ "ปิดใช้งาน" เฉพาะฝั่งที่เปลี่ยน (`gem_merge_blocked` บอกรายการ+สาเหตุถ้ายังติด) · `job_gem_bom_replace_core` จับคู่แถวเดิมด้วย canonical เฉพาะแถวที่ส่งมาด้วย gem_item_id (ฉลาก snapshot ไม่ถูกเขียนทับ) · แถวที่พิมพ์ชื่อใหม่ = ฉลากตามชื่อปัจจุบัน (QA M3) · วิวไม่เรียกฟังก์ชันของ schema (อ่านด้วย service_role ได้) · เลขล้วนทุกระบบเลขตก (`gem_name_ok` + TS) · seed ยืนยันแล้ว (12 แบบ · หัวใจ 1 ค่า · คุชชั่น 2 ค่า · "บาแก็ตต์") · idempotent (รันซ้ำได้) · `set local statement_timeout = '0'` ตอน apply
- **รอบแก้ตาม review 22 ต.ค. (Blocker 1 + S1-S6 · ยังไม่ apply):** B1 `replace_core` ตัด NULL ออกจาก `v_map` (ส่ง [แถวใหม่นำหน้า, แถวเดิม] แล้วแถวเดิมไม่ถูกลบ-แทรก) · S1 TS norm ตัดเฉพาะ `\p{P}` ตรง DB (สัญลักษณ์ `$ + < = > ^ \` | ~` อยู่ใน norm ทั้งสองฝั่ง · พิสูจน์ด้วยกวาดทุกจุดรหัส U+0001-1FFFF เทียบ DB จริง) · S2 รวมตำแหน่งทีละคำ (ไม่ใช่ substring) ทั้งบันทึกใบและรวมชื่อ (แม่แบบ) · S3 `job_gem_state` ที่เดียว (เปลี่ยนนิยาม: ขั้นฝังส่งต่อแล้ว (sent) ไม่ถือเป็น "ยังไม่ระบุ" แล้ว — ตรงกับหน้าช่าง) · S4 `gem_similar_hits` ตัวเดียว · S6 `wireFailResult` ตัวเดียว · gem_name_ok = ต้องมีตัวอักษรจริง ([[:alpha:]]) ≥ 1 ตัว (ตรวจบน DB: พยัญชนะไทย/ละติน/จีนผ่าน · เลขทุกระบบ/"+1"/"$$"/สระลอยตก) · CHECK ของ audit: insert ย้อนหลังต้องมี note · ถอด `p_require_qty`/`v_i` · `mapGemMergePlan` ส่ง overflow/products · หน้าช่างไม่แปลง specified→unspecified เมื่อแถวผิดรูป
- **หนี้ที่รู้ (ไม่แก้รอบนี้):** ตัวดักคล้ายช้าเมื่อแคตตาล็อก > 2,000 ชนิด (plpgsql O(ชื่อใหม่ × ชนิด)) · false positive เล็กน้อยของ similar · TS↔DB ต่างเฉพาะวรรคตอนใหม่ของ Unicode 16 ~14 ตัว (TS ตัดแต่ DB รุ่นนี้ยังไม่รู้ — ไม่ใช่อักขระที่ใช้ตั้งชื่อ) · กติกา G1b ต้องคิดต้นทุนจาก gem_item_id ใน snapshot (ไม่ใช่ชื่อ) · W3 ต้องบังคับ "ผู้เปิด + ขั้นแรกยังไม่รับ" ก่อนเรียก core (→ ทำแล้วใน 0191: §9.5) · homoglyph (ไทย/ละติน หน้าตาเหมือน) จับไม่ได้ · role ระดับแพลตฟอร์ม (postgres/supabase_admin) อ่านตารางราคา/audit ได้ — คุมที่องค์กร
- ไม่มีเทสต์ 2 connection พร้อมกัน (race ของ get-or-create/merge) — พิสูจน์ได้เฉพาะโครงสร้าง (unique + ON CONFLICT + lock) · ต้อง UAT 2 มือถือ

### 9.4 UI G1a — สิ่งที่ทำจริง (22 ต.ค. 69 · branch feature/g1a-gems-ui · frontend-dev)
- **ทำแล้ว**: `/oem/gems` (รายการ+ราคามีวันที่+audit · ชนิด · รูปทรง · รวมชื่อ A→B มี preview · ลบเฉพาะไม่ถูกใช้ · เปลี่ยนชื่อ · ข้อเสนอรวมชื่อ) + เมนูข้าง + การ์ดลิงก์จาก /oem/rates · พลอยในฟอร์มสร้างใบงาน (แม่แบบ SKU จาก `job_plan_suggest.gem_bom` · ไม่แตะ = DB คัดลอกเอง) · การ์ดพลอย+แก้พลอยตามหน้าต่าง §5.3+ตั้งเป็นแม่แบบบน `/jobs/[id]` · `SkuGemBomDialog` จากแถว `/catalog` · การ์ดพลอยหน้าช่าง · ตารางพลอย A5 + บันไดล้นหน้า
- **ยังไม่ทำ (W3 รอบหน้า)**: W-4 พลอยบนมือถือผู้จัดการ · แถวพลอยใน W-6/7 · W-9 บรรทัดพลอย · W-10 แก้ใบ (`GemPicker` มี `presentation="sheet"` รอไว้แล้ว · `gem-draft.ts` เป็น pure ใช้ร่วมได้)
- **ตัดสินเอง/ต่างจาก UX**: (1) เมนูข้างอย่างเดียว — ไม่เพิ่มแท็บใน OemSubNav (เทสต์เดิมล็อกรายชื่อแท็บ) · (2) ไม่มีช่องราคาเริ่มต้นตอน "เพิ่มรายการ" (ตั้งราคาที่แถวหลังเพิ่ม) · (3) ข้อความ "ยังไม่ระบุพลอย" ใช้ตามมติ 22 ต.ค. (ไม่บล็อก) แทนข้อความ UX เดิม · (4) การ์ดพลอยอยู่คอลัมน์ซ้ายใต้ PlanCard · (5) `Modal` เพิ่ม prop `wide` (ไม่ส่ง = เหมือนเดิม) สำหรับตารางพลอย
- **แก้ของ backend ที่เจอตอนทำ UI**: `lib/jobs/messages.ts` import `GEM_ERROR_TH` จาก `lib/jobs/gems.ts` → ตัวแปลงราคา/แคตตาล็อกขึ้น bundle หน้าช่าง+ใบพิมพ์ · แยก `GEM_ERROR_TH/GEM_HINTS` ไป `lib/jobs/gem-errors.ts` (gems.ts re-export) + เทสต์ `lib/jobs/gems-boundary.test.ts` ล็อก · `getJobPlanSuggest` คืน `gemBom` เพิ่ม · `createJob` คืน `gemSummary` เมื่อมีพลอย
- **ต้องดูด้วยตา/พิมพ์จริง**: ตัวเลขความสูง A5 (194 มม.) เป็นค่าประมาณ — บันไดวัดด้วย `measureSheetContentMm` บนจอ ≠ กระดาษจริงเสมอไป (Chrome อาจย่อ) → พิมพ์ 6 เคส (UX §8.3) · sheet/popover บน iOS Safari/Android รุ่นล่าง · หน้าช่าง 360px

### 9.5 W3 — ผู้จัดการกรอก/แก้พลอยจากมือถือ — สิ่งที่ทำจริงใน migration 0191 (23 ต.ค. 69 · backend-dev · DB + server action เท่านั้น — UI W-4/W-6/7/W-9/W-10 ทำแยกหลังนี้)
> สถานะ: **dry-run ผ่าน · ยังไม่ apply** · 🔴 ช่องสาธารณะที่เขียนข้อมูล (QR ร้าน + PIN ไม่ login) → **security ก่อน merge** · ไฟล์: `supabase/migrations/0191_gems_w3.sql` · `scripts/verify/verify-0191.sql` (ตารางแมปเคส→เทสต์ + "ไม่มีเทสต์ครอบ" อยู่หัวไฟล์) · TS: `lib/jobs/gem-wire.ts` (ใหม่) · `lib/jobs/worker-server.ts` · `lib/jobs/shop-photo-server.ts` · `lib/actions/job-worker.ts` · ลำดับ deploy: dry-run → apply `--commit --record` → verify-0191 + verify-0187/0188/0189/0190 + `check-analytics-grants.sql` → merge TS (merge TS ก่อน apply = `job_worker_open` ที่ส่ง `p_gem_*` ไม่มีบน DB)
> มติที่ยึด (memory `gems-photos-mobile-decisions`): พิมพ์ชนิด/รูปทรงใหม่เข้าแคตตาล็อกตอนบันทึก (ไม่รอออฟฟิศ) · ตัวดักชื่อคล้าย = ถาม ไม่บล็อก · ไม่ seed ชนิด · ผู้จัดการแก้/ลบพลอย **ของใบที่ตัวเองเปิด** จนช่างเริ่มรับงาน (window `free_before_start`) · 🔴 ราคาพลอยห้ามถึงผู้จัดการ/ช่างทุกช่องทาง · ไม่เพิ่มขั้นฝังเองตอนแก้ภายหลัง

**RPC (ทั้งหมด security definer · service_role เท่านั้น · ไม่รับ `p_shop_id` — ร้านมาจาก token ร้าน · pin search_path)**
| RPC | ทำอะไร | ด่าน |
|---|---|---|
| `job_worker_open(…เดิม 15 args, p_gem_lines jsonb default null, p_gem_answer text default null, p_gem_force jsonb default null)` | เปิดใบพร้อมพลอย (drop signature เดิม + re-grant) — พลอยผ่านทั้งหมดหรือไม่เปิดเลย (probe ตรวจก่อนสร้างอะไร + sub-block ถอยทั้งก้อน) | เดิมของ W1 (`shop_intake_auth`) + ด่านพลอยด้านล่าง |
| `job_worker_gem_set(p_token_hash, p_session_hash, p_job_id, p_lines jsonb, p_expected_rev text, p_force jsonb default null, p_ip_hash text default null)` | แก้พลอยทั้งชุด (replace-all) ผ่าน `job_gem_bom_replace_core(p_worker_id, 'shopfloor', phase 'free_before_start')` | token ร้าน active · session · `can_open_job` สด · ถังต่อ IP+ช่าง · ใบของช่างคนนี้ (ผู้เปิด · ใบแม่ · ไม่ใช่ใบออฟฟิศ/ร้านอื่น) · ล็อกแถวใบ · `job_worker_gem_block` (ยกเลิก/ปิด/ช่างรับแล้ว/ไม่ open/ไม่มีขั้นฝัง) · CAS rev · ตัวดักชื่อคล้าย · เพดานชื่อใหม่ |
| `job_worker_gem_get(p_token_hash, p_session_hash, p_job_id, p_ip_hash default null)` | พลอยของใบตัวเอง + `editable`/`lock_code` + `has_gem_stage` + `rev` + `state` | เหมือนข้างบนแต่ไม่ล็อกแถว/ไม่เช็ค window (อ่านได้แม้ถูกล็อก) |
| `job_worker_gem_catalog(p_token_hash, p_session_hash, p_ip_hash default null, p_product_id uuid default null)` | ชนิด/รูปทรง live + ขนาดที่เคยใช้ (≤ 6 ต่อคู่) + แม่แบบ SKU ถ้าส่ง `p_product_id` (SKU ไม่ผ่านเงื่อนไข = `has_template:false` เหมือนไม่มีแม่แบบ) | token + session + `can_open_job` |
| `job_worker_my_intake_list(…เดิม)` | + `gem_state · gem_count · gem_pieces · gem_editable` ต่อใบ | เดิมของ W2 |

**`job_worker_open` — ค่า `p_gem_answer`:** `null` = W1 เดิมเป๊ะ (SKU มีแม่แบบ → ขั้นฝัง+คัดลอกแม่แบบ · ที่เหลือไม่มีขั้นฝัง · ห้ามส่ง lines/force) · `'template'` = ตามแม่แบบ SKU **และ SKU ต้องมีแม่แบบ** (ไม่มี = `gem_answer_required` — ux P8 ต้องตอบก่อน) · `'none'` = ไม่มีพลอย (ถอด `gem_set` ออกจากขั้นที่ระบบเสนอ · ไม่คัดลอกแม่แบบ) · `'has'` = ต้องมี `p_gem_lines` 1–30 แถว → ใบมีขั้นฝัง (เพิ่ม `gem_set` ถ้ายังไม่มี · ไม่ได้ขั้นจริง = ถอยทั้งก้อน `not_ready`) · หน้า W-4 **ส่ง `'template'` แทน `null` เสมอ**เมื่อ SKU มีแม่แบบ และต้องส่ง `'none'|'has'` เมื่อไม่มี

**`p_gem_force`:** `[{kind:'type'|'shape', name}]` = ชื่อที่ผู้ใช้ยืนยัน "ใช้ชื่อใหม่แม้คล้ายของเดิม" · DB probe (`gem_lines_prepare` แบบไม่ force ใน subtransaction ที่ถอยกลับ) หาชื่อที่ "ถูกถามจริงในคำขอนี้" แล้วเทียบ kind + normalize — ชื่อที่ไม่ถูกถามไม่ปลดคำถามของชื่ออื่น · boolean/รูปแปลก = `gem_force_invalid` · ชื่อซ้ำเป๊ะหลัง normalize = ใช้ตัวเดิมเงียบๆ (ไม่ถาม · ไม่สร้างซ้ำ แม้ force)

**รหัสผลล้ม (`{ok:false, code, message, …}` — TS แปลงเป็นข้อความไทยตายตัว ไม่ส่งข้อความดิบของ DB):** `gem_line_invalid` (+`gem_code`/`gem_row`/`gem_field` — รหัสเหตุผลตาราง `GEM_ERROR_TH`) · `gem_similar` (+`similar[]`) · `gem_lines_required` · `gem_answer_required` · `gem_answer_invalid` · `gem_args_invalid` · `gem_force_invalid` · `gem_conflict` · `gem_rev_invalid` · `gem_name_cap` · `no_gem_stage` · `job_locked` · `job_cancelled` · `job_closed` · `job_not_open` · `order_not_found` (ใบคนอื่น/ออฟฟิศ/ส่วนย่อย/ร้านอื่น/ไม่พบ — ข้อความเดียวกัน) · + ของ W1 (`not_allowed` · `session_required` · `invalid_token` · `rate_limited` · `idem_conflict` · `job_exists` ฯลฯ)

**server action (`lib/actions/job-worker.ts` — ไฟล์เดียวที่หน้าช่าง import):**
- `intakeOpen(token, { …เดิม, gems?: { answer:'none' } | { answer:'template' } | { answer:'has', lines: GemLineInput[], force?: {kind,name}[] } })` → `{ok:true, result: IntakeOpenResult & { gem?: { count, total, state, createdTypes, createdShapes, reused[], mergedRows[] } }}` | `IntakeActionFail { error, code?, field?:'gems'|…, gem?:{code,row?,field?}, similar?: GemSimilar[] }`
- `intakeGemCatalog(token, productId?)` → `{ok:true, types[{id,name}], shapes[{id,name,hasLength}], sizes[{typeId,shapeId,sizeA,sizeB}], hasTemplate, template: IntakeGemLine[], maxLines}`
- `intakeJobGems(token, jobId)` → `{ok:true, job, state, editable, lockCode, hasGemStage, rev, lines: (IntakeGemLine & {qtyTotal})[], maxLines}`
- `intakeSetJobGems(token, { jobId, lines: GemLineInput[], expectedRev, force? })` → `{ok:true, changed, count, lines, summary, state, rev}` | fail (ชน = `gem_conflict` → โหลด `intakeJobGems` ใหม่)
- `intakeMyJobs(token)` → `MyIntakeJob` เพิ่ม `gemState('specified'|'unspecified'|'not_needed'|null) · gemCount · gemPieces · gemEditable`
- แถวพลอยผ่าน allowlist เดียวกับออฟฟิศ (`toWireGemLines` ย้ายไป `lib/jobs/gem-wire.ts` · `gems.ts` re-export) — key แปลก (price/cost/supplier) = ปฏิเสธ ไม่ทิ้งเงียบ · `lib/jobs/gems-boundary.test.ts` ล็อกว่าชั้นสาธารณะไม่ import `gems.ts` (ตัวแปลงราคา)

**ตัดสินเอง (นอก design/brief):** (1) ค่า `'template'` ของ `p_gem_answer` — บรีฟสั่งทั้ง "null = ตามเดิม" และ "SKU ไม่มีแม่แบบไม่ตอบ = ห้ามผ่าน" แต่ verify-0187–0190 เปิดใบโดยไม่ส่งพลอยและต้องผ่านเท่าเดิม → null คงพฤติกรรมเดิม ด่าน "ต้องตอบ" บังคับกับ client ที่ส่ง `'template'` (หน้า W3) — client ที่ส่ง null ยังได้ใบไม่มีขั้นฝังแบบวันนี้ · (2) `p_gem_force` เป็นรายการชื่อ ไม่ใช่ boolean (ปิดช่อง blanket) · ข้อจำกัด: DB ไม่มี state "เคยถามแล้ว" — client ที่รู้ชื่อล่วงหน้าส่ง force มาตั้งแต่แรกก็ผ่าน (ตัวดักคล้ายคือคุณภาพข้อมูล ไม่ใช่ด่านความปลอดภัย) · (3) `p_expected_rev` บังคับ (CAS กัน 2 เครื่อง) · (4) แก้เหลือ 0 แถวได้ (ใบมีขั้นฝัง → `state = unspecified` เตือน ไม่บล็อก) · ระบบไม่เพิ่ม/ลบขั้นฝังตอนแก้ — ใบไม่มีขั้นฝัง = `no_gem_stage` "แจ้งออฟฟิศเพิ่มขั้น" · (5) `job_worker_gem_catalog` รับ `p_product_id` เพิ่มจากบรีฟ (ให้รู้ว่า SKU มีแม่แบบไหม) · (6) ถังจำกัดอัตราแยกจากรูป: เขียน `wg:<ช่าง>` 20/10 นาที · อ่าน `wgr:<ช่าง>` 120/10 นาที (นับหลังพบ session valid + `can_open_job`) · ต่อ IP `ipw:` 300 / `ipr:` 240 · (7) ไม่รับ `p_user_agent` ใน `job_worker_gem_set` (core เขียน event โดยไม่มี device hint และบรีฟสั่งไม่ replace core) · (8) race "ช่างรับระหว่างแก้": ล็อกแถวใบ (`for update`) แล้วตรวจหน้าต่าง — ไม่ล็อก `job_stage` (ลำดับล็อกกลับกับ `job_core_receive` → เสี่ยง deadlock) · (9) **เพดานชื่อใหม่ 40 ชื่อ (ชนิด+รูปทรง) ต่อผู้จัดการต่อ 24 ชม.** (`gem_name_cap` · นับเฉพาะชื่อที่เกิดใหม่จริง) — บรีฟไม่ได้สั่ง แต่ช่องสาธารณะนี้สร้างชื่อเข้าแคตตาล็อกเองได้ · ปรับที่ `job_worker_gem_name_cap()` ที่เดียว · (9b) **เพดานรายการพลอยใหม่ 120 รายการ (ขนาดใหม่ของชนิด+รูปทรงเดิม) ต่อผู้จัดการต่อ 24 ชม.** (security M1 · hint `gem_name_cap` เดียวกัน · นับ `gem_item.created_by_worker_id` · ปรับที่ `job_worker_gem_item_cap()`) — ไม่มีเพดานนี้ ผู้ถือ PIN ยังท่วม `gem_item` ด้วยขนาดขยะได้ (ชื่อเดิมไม่ติดเพดานชื่อ) · (9c) ตัวตรวจล่วงหน้าเปลี่ยนชื่อ `job_worker_gem_force` → **`job_worker_gem_precheck`** (ทำทั้งจับคู่ force + นับเพดาน — ชื่อเดิมหลอกว่าทำแค่ force) และรับ `p_allow_item_ids` = รายการที่ใบถืออยู่แล้ว (security M2: ใบที่คัดลอกแม่แบบแล้วออฟฟิศปิดใช้รายการ ผู้จัดการต้องบันทึกแถวเดิมต่อได้เหมือน core · id ปิดใช้ที่ "ไม่อยู่ในใบ" ยังตก `gem_inactive`) · (10) `merged` = resolve ไปปลายทาง (มติ G1a §9.3) ไม่ปฏิเสธ — บรีฟเขียนไว้ในรายการแถวผิดว่า "ชนิดร้านอื่น/merged" ถ้าต้องการให้ปฏิเสธต้องแก้ `gem_lines_prepare` (นอกขอบเขตรอบนี้) · ปลายทางที่ปิดใช้ = `gem_inactive` (มีเทสต์)

**ไม่ได้ทำ/ข้อจำกัด (บอกตรงๆ):** UI ทุกจอของ W3 · การเพิ่มขั้นฝังให้ใบที่เปิดแล้ว (ux Q8 (ก) = ออฟฟิศทำเอง) · แก้ภายหลังหลังช่างรับ = ออฟฟิศเท่านั้น (§5.3) · ไม่มีเทสต์ 2 connection (ผู้จัดการแก้ vs ช่างรับขั้นแรก · 2 เครื่องแก้พร้อมกัน · 2 คนพิมพ์ชื่อเดียวกัน — พิสูจน์ได้แค่ล็อกแถวใบในนิยาม + CAS ตามลำดับ + unique/on conflict ของ 0190) · on_hold ไม่มีเทสต์ (ไม่มี RPC ตั้งสถานะ) · ส่วนย่อยที่มี BOM (trigger ของ 0190) · ผู้เปิดใบหลายคนใช้ PIN เดียวกัน/PIN เดาง่าย = ความเสี่ยงที่เจ้าของรับแล้ว (§7.4) — เพดานชื่อใหม่ช่วยจำกัดความเสียหายของชื่อขยะเท่านั้น · verify-0187/0188/0189 แก้ซิกเนเจอร์ `job_worker_open` (15 → 18 args) ใน mutant/privilege check และ H2 ของ 0189 ไม่นับ key `gem_*` (collateral ของ drop signature)

**หนี้ที่รู้ตัวหลัง security/review/QA รอบแรก (23 ต.ค. 69 · ไม่แก้ในรอบนี้ — บันทึกตรงๆ):**
| รหัส | เรื่อง | ทำไมยังไม่แก้ / ทางปิด |
|---|---|---|
| S3 | `intakeOpen` ยังรับ `gems` เป็น optional → client ที่ไม่ส่งเลยได้ใบแบบ W1 เดิม (null path) | ✅ **ปิดแล้วใน PR หน้า W-4 (§9.6):** `gems` เป็น required ทั้ง TS type (`IntakeOpenActionInput`/`IntakeOpenInput`) และที่ action (ไม่ส่ง/undefined/null = ปฏิเสธ field `gems` ไม่ถึง DB) · `openIntakeJob` ส่ง `p_gem_answer` เสมอ |
| S4 | `shop_intake_gem_auth` + `job_worker_gem_block` คัดลอกด่านจาก W2 (รูป) ไม่ใช้ร่วม · นิยามล็อก "รูป" กับ "พลอย" ต่างกันโดยตั้งใจ (พลอยล็อกเมื่อช่างรับขั้นแรก — `job_gem_edit_window`) | แก้ด่านฝั่งหนึ่ง ต้องแก้อีกฝั่งด้วยมือ — รวมเป็น helper เดียวเมื่อมีด่านที่ 3 |
| L1 | ตัวดักชื่อคล้ายไม่จับ homoglyph (อักษรคล้ายต่างชุด) และชื่อสั้น ≤ 3 ตัวอักษร | ตัวดักคล้ายคือคุณภาพข้อมูล ไม่ใช่ด่านความปลอดภัย (เพดานชื่อ 40 + รายการ 120 ต่อผู้จัดการจำกัดความเสียหาย) · ออฟฟิศรวมชื่อ (`gem_merge`) แก้ย้อนหลังได้ |
| L2 | dropdown ของ `job_worker_gem_catalog` ตัดที่ 300 รายการ (ชนิด/รูปทรง) / 1,000 (ขนาดที่เคยใช้) — แคตตาล็อกที่ใหญ่กว่านี้ผู้จัดการไม่เห็นบางชื่อ | ข้อเสนอ: เพดานชื่อ/รายการ **ต่อร้าน** ด้วย (ตอนนี้เพดานนับต่อผู้จัดการ — ผู้จัดการหลายคนรวมกันยังท่วมได้) · รอเจ้าของเลือกตัวเลข |
| L3 | ถังจำกัดอัตรา (`wg:`/`ipw:`…) ถอยกลับไปกับทรานแซกชันถ้าคำขอ timeout/ล้มกลางทาง → คำขอที่ล้มไม่เผาถัง | ยอมรับ: ช่องนี้ถูกจำกัดด้วยถังที่นับตอนสำเร็จ + เพดานชื่อ/รายการ · ไม่มี DoS ที่หนักกว่าช่องเดิมของ W1/W2 |
| L4 | `verify-0191.sql` / `verify-0191-qa.sql` ใช้ `alter table … disable trigger user` บน `analytics.worker` และ `analytics.worker_session` (จำลอง session หมดอายุ/ช่างปิดใช้) → ขอล็อก SHARE ROW EXCLUSIVE ค้างตลอดการรัน | รันนอกเวลาทำงาน ห้ามรันพร้อม session/agent อื่น (เขียนเตือนที่หัว verify-0191.sql แล้ว) — ช่างล็อกอิน PIN/เปิดใบมือถือระหว่างนั้นจะค้างรอ |
| QA | (ก) แก้จาก "มีพลอย" กลับเป็น "ไม่มีพลอย" ผ่านมือถือไม่ได้ (เหลือ 0 แถว = `state unspecified` เตือน ไม่ใช่ `not_needed` · ขั้นฝังยังอยู่ — ลบขั้นต้องออฟฟิศ) · (ข) แม่แบบ SKU ที่อ้างชนิดซึ่งถูกปิดใช้งานยังคัดลอกเข้าใบได้ (เหมือน core — ตามมติ G1a) · (ค) race "probe → create" (คนอื่นสร้างชื่อเดียวกันระหว่าง probe กับสร้างจริง) พิสูจน์ด้วย connection เดียวไม่ได้ — พึ่ง unique/on conflict ของ 0190 | QA ไม่นับเป็นบั๊ก · เก็บไว้ให้ UI W-4 เขียนข้อความให้ตรง และเพิ่มเทสต์ 2 connection ถ้ามี harness |

**แก้แล้วรอบ review/security (23 ต.ค. 69 · ก่อน apply):** B1 หัว `verify-0191.sql` แมปทุก id กับเทสต์จริง (เดินทีละ id) · M1 เพดานรายการ 120/24 ชม. (`job_worker_gem_item_cap`) + เทสต์ O16a-d G10a-d + mutant MU30 · M2 `p_allow_item_ids` (รายการที่ใบถืออยู่แล้วที่ออฟฟิศปิดใช้ทีหลังต้องบันทึกต่อได้ · รายการปิดใช้ที่ไม่อยู่ในใบยังตก `gem_inactive`) + เทสต์ G11a-d + mutant MU31 · S1 แยก O14f (ชนิด) / O14g (รูปทรง) เป็นบล็อกของตัวเองที่ assert จริง + mutant MU27 / MU27b ล้มที่ id ของตัวเอง · S2 `loadIntakeJobGems` ล้มปลอดภัยถ้าจำนวนแถวที่แปลงได้ ≠ จำนวนที่ DB ส่ง · nit: N1 `mapGemNames` · N2 รวม `gemWireFail` (regex rev/field ที่เหลืออยู่คนละโมดูลเพราะ test mock โมดูลนั้น — ยังไม่รวม) · N3 เปลี่ยนชื่อ `job_worker_gem_precheck` · N4 ลำดับข้อในหัว 0191 + ตรวจคอลัมน์ `gem_type`/`gem_shape` ที่เพดานอ่านจริง · N6 คอมเมนต์ · N8 หัว verify-0187/0188/0189 ระบุว่ารันได้หลัง 0191

**ผล dry-run บน DB จริง (23 ต.ค. 69 · ROLLBACK ไม่ commit · ตัวเลขรอบแรกก่อน review — รอบหลัง review ดูบรรทัด "รอบ 2" ท้ายหัวข้อนี้):** 0191 + verify-0191 = **OK 176 · FAIL 0** · mutant **33/33** ถูกจับ (ถอดด่านทีละตัว: ล็อก/ผู้เปิด/CAS/ไม่มีขั้นฝัง/force/probe/answer/auth/ถังอัตรา/เพดานชื่อ ฯลฯ) · ต่อไฟล์ 0191 สองรอบ (idempotent) ผ่าน · `check-analytics-grants.sql` ผ่านหลัง 0191 · ของเดิมหลัง 0191: verify-0187 311/2 (E5b/E5c = เหมือน baseline ก่อน 0191 เป๊ะ — มีใบจริงจาก W1 บน DB แล้ว ไม่ใช่ผลของ 0191) · verify-0188 36/0 · verify-0189 190/0 · verify-0190 259/0 · verify-0187-qa 82/0 · verify-0190-qa 79/0 + BUG-OPEN 1 (หนี้ P9 เดิม) · vitest ทั้ง suite 6,007 ผ่าน / 1 ล้ม (`ProductionOfficeAck.test.tsx` — เทสต์ผูกเวลา: createdAt ตายตัว 21 ต.ค. แล้วป้าย "ยังไม่รับทราบ" กลายเป็น "ค้าง n วัน" เมื่อเกินกำหนด · ไม่เกี่ยวกับงานนี้) · `tsc --noEmit` สะอาด · ESLint ไม่มี config (lint ไม่รันได้)
**รอบ 2 (24 ต.ค. 69 · หลังแก้ตาม review/security · ROLLBACK ไม่ commit · รันทีละชุด):** 0191 + verify-0191 = **OK 192 · FAIL 0** · mutant **36/36** ถูกจับ (เพิ่ม MU27b รูปทรง · MU30 เพดานรายการ · MU31 allow ids · MU27 ย้ายมาล้มที่ `O14f` จริง) — ชุด mutant เต็มรันบน 0191 ก่อนแก้คอมเมนต์ลำดับข้อ/ตรวจคอลัมน์ `gem_type`/`gem_shape` ในหัวไฟล์ · หลังแก้สองจุดนั้นรันซ้ำแบบไม่มี mutant = OK 155 · FAIL 0 · 0191 + verify-0191-qa **36/0** · +verify-0190 **259/0** · +verify-0189 **190/0** · ต่อ 0191 สองรอบ (idempotent) + `check-analytics-grants.sql` ผ่าน · `tsc --noEmit` สะอาด · vitest ทั้ง suite 6,064 ผ่าน / 1 ล้ม (`ProductionOfficeAck.test.tsx` เทสต์ผูกเวลาเดิม ไม่เกี่ยวกับงานนี้) · ไม่ได้รันซ้ำ verify-0187/0188 ในรอบนี้ (แก้แค่คอมเมนต์หัวไฟล์)


### 9.6 W3 UI — ผู้จัดการกรอก/แก้พลอยจากมือถือ — สิ่งที่ทำจริง (24 ต.ค. 69 · branch `feature/w3-gems-mobile-ui` · frontend-dev)
> สเปก: `ux-gems.md` §1–§4 (W-4 · แถวพลอยใน W-6/7 · W-8 · W-9 · W-10) · backend = 0191 (§9.5) apply + merge แล้ว · 🔴 ไม่มีราคา/ตัวเลขเงินใดๆ ในจอ/type/DOM (เทสต์ล็อก) · ไม่มี migration ในรอบนี้
- **ทำแล้ว**: ขั้น **W-4 "พลอย"** ในวิซาร์ดเปิดใบ (SKU 5 ขั้น · สินค้าใหม่ 6 ขั้น: หลังจำนวน ก่อนรูป) — ถาม "ฝังพลอยไหม" (ไม่มีค่าเริ่มเมื่อ SKU ไม่มีแม่แบบ) · SKU มีแม่แบบ = เริ่ม "มีพลอย" + แถวป้าย "จากแม่แบบ" · แถว accordion ทีละแถว (ปุ่ม ≥ 56px · ตัวอักษร ≥ 18px) + `GemPicker` แบบ sheet เต็มจอ + ชิป "เคยใช้" + ตัวดักชื่อคล้าย/รูปทรงใหม่ถาม 1/2 ค่า + แถวซ้ำต้องกด "รวมเข้าแถว n" เอง · แถว "พลอย" ในหน้าทวน · สรุปพลอย + แจ้ง "ใช้ตัวเดิมให้"/รวมแถวซ้ำ/ชื่อใหม่เข้ารายการ ใน W-8 · บรรทัดพลอยในการ์ด W-9 · **W-10 เปลี่ยนหัวเป็น "แก้ JB-xxxx"**: ส่วนพลอย (บน) + แผ่นเต็มจอ "แก้พลอย" บันทึกทั้งชุด (CAS ด้วย rev) · ส่วนรูปของ W2 ไม่เปลี่ยน
- **ปิดหนี้ S3**: `gems` required (TS + action) · ฟอร์มส่ง `none`/`template`/`has` เสมอ (ยังไม่ตอบ = ไปไม่ได้ที่จอ และ `buildIntakeInput` ส่งรูปที่ action ปฏิเสธ ไม่เดาเป็น "ไม่มีพลอย")
- **ไฟล์**: `lib/jobs/shop-gem-flow.ts` (pure: คำตอบ/แถว/payload/ตรวจก่อนส่ง/แปลง error → แถว+ช่อง/ข้อความล็อก/บรรทัด W-9) · `lib/text/invisible.ts` (leaf — แยกจาก `lib/oem/display` เพราะ `shop-gems.ts` ต้องอยู่ในกราฟ `/w/s/` ที่ห้ามลาก `lib/oem`; display re-export ตัวเดิม) · `components/domain/jobs/worker/shop/`: `ShopGemStep` · `ShopGemEditor` · `ShopGemEditSheet` · `ShopJobGemsSection` · `ShopReviewGemsRow` · `useShopGemCatalog` · แก้ `ShopOpenFlow` `ShopReview` `ShopOpenSuccess` `ShopMyJobsList` `ShopJobPhotosScreen` · `GemPicker` (+`GEM_FIELD_WORKER` ในแบบ sheet · `onForceSimilar` ส่ง {kind,name})
- **ตัดสินเอง/ต่างจาก UX (ตรวจก่อน merge)**: (1) ไม่ reuse `GemRowsEditor` ของออฟฟิศ (ไม่ใช่ accordion · ช่อง 44px · ลาก `useGemOptions` → action ออฟฟิศ) — เขียน `ShopGemEditor` ใหม่ ใช้ `GemPicker` + `gem-draft` + `shop-gems` ซ้ำ · (2) `GemPicker` ถามชื่อคล้ายฝั่งจอก่อน (เร็ว) แล้วส่ง `force` เฉพาะชื่อที่ผู้ใช้ยืนยันนั้นไปกับคำขอเลย (DB จับคู่ force กับชื่อที่ "ถูกถามจริง" อยู่แล้ว · กันถามซ้ำสองรอบ) · force ถูกตัดทิ้งเมื่อชื่อนั้นไม่เหลือในแถว (`pruneForce`) · ถ้า DB ถามชื่อที่จอไม่เห็น (catalog โหลดไม่ได้/คนอื่นเพิ่งเพิ่ม) = กล่องถามบนหน้าทวน → ส่งซ้ำ key เดิม · (3) `gem_name_cap` ใช้ข้อความกลาง "เพิ่มพลอยใหม่ถี่เกินไปวันนี้ — เลือกจากรายการที่มี หรือแจ้งออฟฟิศ" (แก้ที่ `GEM_CODE_TH` ของ `worker-server.ts` ที่เดียว) · (4) W-9 แสดง "พลอย n รายการ · รวม m เม็ด" (UX ระบุแค่ "พลอย n รายการ" — `gemPieces` จาก DB ไม่คำนวณใน UI) · (5) ป้ายสถานะการ์ด W-9 บอกว่าแก้อะไรได้ — "แก้รูปได้" / "แก้รูป·พลอยได้" / "แก้พลอยได้" / 🔒 "แก้ไม่ได้ตอนนี้" (อิง `editable` ของรูป + `gemEditable` จาก DB · ใบ "ไม่มีพลอย" ไม่ทำให้เข้าใจว่าแก้พลอยได้) · ส่วนพลอยของ W-10 ทุกกรณีที่แก้ไม่ได้มีเหตุผลบนจอ + แถบ ✎ "แก้พลอยได้จนช่างเริ่มรับงาน" ตอนแก้ได้ · (6) หัวข้อ "รูปจากหน้างาน" ไม่เพิ่ม (region เดิมของ W2 มีชื่ออยู่แล้ว)
- **รอบแก้ review/QA 24 ต.ค.**: conflict ใน sheet ค้างกล่อง+ปุ่ม "โหลดพลอยใหม่" ไม่ผูกกับ error (BUG-1) · บันทึกสำเร็จตั้ง rev/แถวจากผลบันทึกทันที ไม่พึ่งโหลดซ้ำ (BUG-2 · `applySavedGems`) · แม่แบบมาช้าเติมให้เมื่อมีแต่แถวเปล่า และส่ง "template" ถ้าแถวเท่าแม่แบบ (BUG-3) · ข้อความ "ใช้ตัวเดิมให้" ไม่ซ้ำ + key มี index (BUG-4) · `ShopConfirmBox` ตัวเดียว · `useShopGemCatalog` คืน `{state, options, optionsState, reload}` · ข้อความ error พลอยผ่าน `isCleanMessage` · `openIntakeJob` กัน `gems.answer` ไม่ถูกก่อนเรียก RPC (security L1) · boundary test จับ dynamic `import()` (L3) · focus ไปช่องที่ขาดจริง · แผ่นแก้ที่ถูกซ่อนตอนแผ่น PIN ขึ้นไม่รับ Esc
- **หนี้ที่รู้ตัว (บันทึกตรงๆ)**: security L2 — `force` ผูกกับ "ชื่อ" ที่ผู้ใช้ยืนยัน ไม่ผูกกับ "ชนิด/รูปทรงคู่ที่ผู้ใช้เห็นตอนถาม" (DB จับคู่ kind+ชื่อที่ normalize เท่านั้น — ผู้ถือ PIN ส่ง force ล่วงหน้าได้ ซึ่งตัวดักคล้ายเป็นคุณภาพข้อมูลไม่ใช่ด่านความปลอดภัย) · focus trap ของแผ่นแก้พลอยไม่เต็ม · ไม่มี draft ลง storage (รีเฟรช = ฟอร์มพลอยหาย)
- **ไม่ได้ทำ (บอกตรงๆ)**: ไม่มี draft ลง storage (รีเฟรช/ปิดหน้า = ฟอร์มพลอยหายทั้งก้อน — UX §3.7 ให้เป็นตัวชี้วัดการ validate) · แผ่นแก้พลอย W-10 ไม่มี focus trap เต็ม (มี `aria-modal` + โฟกัสหัว + Esc) และไม่ล็อกการเลื่อนของหน้าหลังแผ่น · ไม่มีเทสต์ 2 เครื่อง/เครื่องจริง (ดูหัวข้อด้านล่าง)
- **ต้องดูด้วยตา/มือถือจริง (เทสต์จับไม่ได้)**: แป้นพิมพ์บัง sheet เลือกชนิด/ปุ่ม "＋ เพิ่มเป็นชนิดใหม่" บน iOS Safari + Android รุ่นล่าง (`fixed inset-0` ไม่ใช้ `dvh`) · 360px ไม่มี overflow แนวนอน (ช่องขนาด 2 ค่า + "×" + "มม.") · ปุ่ม/ชิป ≥ 56/48px จริง · คอนทราสต์ป้าย (sky/amber) · ลำดับ focus หลังเพิ่ม/ลบแถว · ขนาดบันเดิล `/w/s/[shopToken]` (build: 50.9 kB / First Load 191 kB) · พิมพ์พลอยจริง 3 แถวรวม fancy cut ตาม UX §13 ข้อ 1–5 · UAT 2 มือถือ (race get-or-create ชื่อเดียวกัน · ผู้จัดการแก้ vs ช่างรับขั้นแรก)
- เทสต์: `ShopGems.flow.test.tsx` (35) · `ShopJobGems.flow.test.tsx` (28) · `shop-gem-flow.test.ts` (pure) · `invisible.test.ts` · boundary 3 ไฟล์ (กราฟ `/w/s/` ไม่ลาก `lib/jobs/gems.ts` · `lib/actions/gems.ts` · `gems-server.ts` · จอราคา · `lib/oem` — ตรวจ mutation แล้วล้มจริง) · ปรับของเดิมตามขั้นใหม่/S3 (`ShopFlow` `ShopPhotos.flow` `ShopMyJobs.flow` `shop-open` `job-worker*` `worker-server.gems` `gems-w3.db-contract.qa` `intake-real-shapes.qa`)

### 9.7 G1b — พลอยที่ต้องสั่งซื้อ — สิ่งที่ทำจริงใน migration 0192 (24 ต.ค. 69 · backend-dev · DB + server action เท่านั้น — UI `/jobs/gems-to-buy` ทำแยกตาม ux-gems-to-buy.md)
> สถานะ: **ยังไม่ apply · dry-run ผ่าน (24 ต.ค. 69 · ROLLBACK):** 0192 + verify-0192 = **OK 81 · FAIL 0 · SKIP 0** · mutant **15/15** ถูกจับ · ต่อ 0192 สองรอบ (idempotent) ผ่าน · 0192 + verify-0190 = 259/0 (เท่าเดิม) · verify-0191 ยังไม่ได้รันหลัง 0192 (ใช้เวลานาน ถือล็อกตารางช่าง — รันนอกเวลางาน) · รอบแก้ตาม security (Mace · ไม่มี Critical/High): M1 M2 L1 L2 ทำแล้ว (ดูล่าง) · 🔴 มีราคา (ต้นทุนประมาณ) → **security 💰 ก่อน merge** · ไฟล์: `supabase/migrations/0192_gems_to_buy_g1b.sql` · `scripts/verify/verify-0192.sql` (ตารางแมปเคส→เทสต์ + "ไม่มีเทสต์ครอบ" อยู่หัวไฟล์) · TS: `lib/jobs/gem-purchase.ts` · `lib/actions/gems.ts` · ลำดับ deploy: dry-run (ต่อ 0192 + verify-0192) → apply `--commit --record` → verify-0192 + verify-0190 + verify-0191 + `check-analytics-grants.sql` → merge TS
> มติเจ้าของ 24 ต.ค.: ไม่นับสต็อกพลอย (ยอด = "ที่ใบงานต้องใช้" gross) · ติ๊ก "สั่งแล้ว" ได้ กันสั่งซ้ำ · ไม่เผื่อแตก (0%) · ตัดใบพิมพ์ (คัดลอกส่ง LINE อย่างเดียว) · ไม่มีสถานะ "ได้รับของ" (รายการหายเมื่อขั้นฝังรับ) · ไม่ทำ lead time

**นิยาม "ใบที่ต้องใช้" (ที่เดียว = `v_gem_purchase_job`)**: ใบแม่ (ส่วนย่อยไม่มี BOM → ไม่นับซ้ำ) · status open/in_progress/on_hold (done/cancelled ไม่นับ → R8: ใบยกเลิกแล้วสร้างใหม่ไม่นับซ้ำ) · ขั้น `gem_set` ในต้นไม้ **มี pending ≥ 1 และไม่มี received/sent** = `gem_stage = 'pending'` ของ `job_gem_bom_get` (skipped ล้วน = ไม่นับ) · รหัสขั้นฝังบน DB = `gem_set` (ยืนยันแล้ว — ไม่ใช่ `setting`) · ⚠️ `job_gem_state` ใช้แทนไม่ได้ (นับ received เป็น "ยังเปิด") → ลอกเงื่อนไข pending ของ `job_gem_bom_get` และ verify-0192 พิสูจน์ parity ทุกสถานะขั้นฝัง

**DB ให้ (RPC ทั้งหมด security definer · service_role เท่านั้น · actor ต้องเป็นสมาชิก owner/admin จริง = `gem_require_office`)**
| RPC | ทำอะไร |
|---|---|
| `gem_purchase_summary(p_shop_id, p_actor)` | groups[] ต่อ canonical gem_item (ชนิด·รูปทรง·ขนาดปัจจุบัน): `qty_needed_now · qty_ordered · qty_remaining · qty_excess · job_count · earliest_due · earliest_due_remaining · line_ids[] · jobs[]` (ต่อใบ: job_id · job_no · design_label · due_date · qty_* · is_ordered · changed_after_order · ordered_at · ordered_by · line_ids) + `unspecified_jobs[]` (ใบที่ขั้นฝัง pending แต่ไม่มีแถวพลอย) + `removed_after_order[]` (security M2: แถวที่ติ๊กไว้แล้วถูกลบตอนแก้พลอย ใบยังเปิด — เตือนสั่งซ้ำ · หายเมื่อใบมีแถวรายการเดียวกันที่ติ๊กแล้ว) + `totals` + `server_now`/`today_bkk` (เวลาไทยจาก DB) — **ไม่มีราคา/ต้นทุน แม้เป็น null** |
| `gem_purchase_mark(p_shop_id, p_line_ids uuid[], p_ordered boolean, p_actor)` | ติ๊ก/ยกเลิกติ๊ก all-or-nothing (1-200 แถว) · idempotent (ซ้ำ = changed 0 ไม่เขียน log) · คืน `lines[]` สถานะสดของทุกแถวที่ส่งมา · ล้ม: `job_closed` · `gem_stage_started` · `purchase_line_not_found` (ร้านอื่น/ไม่มี ข้อความเดียวกัน) · `purchase_lines_invalid` · `ordered_invalid` |
| `gem_purchase_summary_cost(p_shop_id, p_actor)` | 🔴 RPC เดียวที่มีราคา · groups[] ต่อ canonical_item_id: `cost_remaining_thb · cost_ordered_thb` (ปัด 2 ตำแหน่งที่ DB · null = ยังไม่มีราคา) + `missing_price_*` · totals = ผลรวมของค่าที่ปัดแล้ว + `complete` · ราคา = ล่าสุด ณ วันนี้ไทยของ **gem_item_id ใน snapshot ของแถว** (ไม่ใช่ canonical) |

**โครงสร้าง**: `job_gem_bom` + `ordered_at/ordered_by/ordered_qty` (ordered_qty = จำนวนเม็ดรวม ณ ตอนติ๊ก = qty_at_order · CHECK ทั้งสามไป/มาพร้อมกัน) · `gem_purchase_mark_log` (append-only · ordered/unordered/line_removed · ไม่มีสิทธิ์ให้ role ฝั่งแอป) · trigger `job_gem_bom_ordered_log` (แถวที่ติ๊กไว้ถูกลบ = log) · views `v_gem_purchase_job/_line/_summary` (ไม่มีคอลัมน์ราคา · role ฝั่งแอปอ่านตรงไม่ได้) · **ไม่ replace ฟังก์ชันเดิมตัวใด** (post-check md5)

**ตัดสินเอง (นอก design/brief — ดูหัว 0192 ละเอียด)**: (1) ติ๊กไม่ถูกล้างเมื่อจำนวนเปลี่ยน (ทับข้อเสนอเดิม "จำนวนเปลี่ยน → ล้างติ๊ก" ตาม UX H1) — ที่เหลือ = max(ใช้ตอนนี้ − สั่งไว้, 0) · สั่งไว้ 70 ใบเพิ่มเป็น 90 → เหลือ 20 (ล้างติ๊กแล้วจะสั่งซ้ำ 70) · ลดเป็น 50 → qty_excess 20 · ติ๊กซ้ำ = ปรับ ordered_qty **ขึ้น**เป็นยอดปัจจุบันเท่านั้น (security M1: `greatest` — ใบลด 90 → 70 แล้วกด "ติ๊กทั้งรายการ" ยังเป็น 90 · qty_excess 20 ไม่หายเงียบ · log เก็บ prev_qty) · (1b) security L1: ordered_* เขียนได้ทางเดียวคือ gem_purchase_mark (trigger `job_gem_bom_ordered_only` + GUC local — UPDATE/INSERT ตรง แม้ในนาม postgres = 42501) · L2: view ทั้ง 3 security_invoker · (2) audit = ตารางเฉพาะ ไม่ใช่ job_event (การติ๊กข้ามหลายใบ · ไม่แตะ constraint 33 ชนิด) · (3) รับ line_ids ตามบรีฟ แทน (job_id, gem_item_id)[] ตาม UX H2 (gem_item_id ใน snapshot ≠ canonical ที่จอเห็นหลังรวมชื่อ) + all-or-nothing แทน "คืนรายการที่ถูกข้าม" (ขัดกันเอง) · (4) `ordered_by` = uuid ผู้ติ๊ก ไม่ใช่ชื่อแสดง (ไม่มีตารางชื่อ · ไม่อ่าน auth.users) · (5) ต้นทุน: ส่วนที่จำนวน 0 ไม่ต้องมีราคา · ส่วนที่มีแถวไม่มีราคา = null ทั้งส่วน · ราคาอนาคตอย่างเดียว = ไม่มีราคา

**หนี้/ข้อจำกัด (บอกตรงๆ)**: [security L3] race "ติ๊กชนช่างรับขั้นฝัง" = แถวหายจากรายการเอง ไม่เสียหาย · [L4] log `line_removed` ไม่มี actor (ระบบทำเอง) — ต้องจับคู่ `job_event` `bom_change` ตาม job_id + เวลาเพื่อรู้ว่าใครลบ · ติ๊กของใบที่ยกเลิก/สร้างใหม่ไม่ย้ายไปใบใหม่ (ใบใหม่ต้องติ๊กเอง — ระบบไม่รู้ว่าของที่สั่งไปเป็นของใบเก่า) · ยอดนี้ gross (ไม่หักสต็อก) · ขั้นฝังรับบางส่วนของล็อต = ทั้งใบหายจากรายการ (ตรงกับ job_gem_bom_get 'started') · ใบ on_hold รวมใน view แต่ไม่มีเทสต์ (ไม่มี RPC ตั้งสถานะ) · ไม่มีเทสต์ส่วนย่อย (ไม่มี fixture แบ่งล็อต) · ไม่มีเทสต์ 2 connection (ติ๊กชนช่างรับขั้นฝัง/ออฟฟิศแก้พลอย — พิสูจน์ได้เฉพาะลำดับล็อก job share → แถวพลอย for update) · ไม่มี RPC อ่านประวัติการติ๊ก (log มีแต่ UI ยังอ่านไม่ได้) · role ระดับแพลตฟอร์ม (postgres/supabase_admin) อ่านราคา/log ได้ — คุมที่องค์กร

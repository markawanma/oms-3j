# Design — ผลิตเข้าสต็อกรอบถัดไป: แบ่งส่วน (partial lots) · ขั้นนอกร้าน · เข้าสต็อกเป็นงวด 💰 · เปิดใบจากหน้างาน (18 ต.ค. 69)

> architect (Yoda) · สถานะ: **design ระบบ (data model + RPC + ด่าน) — ยังไม่มี migration/โค้ด** · โฟกัส **ผลิตเข้าสต็อก** ตามคำสั่งเจ้าของ · OEM ส่งลูกค้า/ใบส่งของ/รับเงิน = พักไว้ (เอกสารนี้แค่ไม่ปิดประตู §12)
> ที่มา: `workflow-partial-lots.md` §9.1 (มติ 17 ต.ค. — **ข1 QR เดียวต่อใบ · ค1 ไม่ชั่งตอนแบ่ง** ชนะ §2–§8) · `workflow-shopfloor-order-gems-photos.md` §9.1 · `ux-handoff-job-lots/HANDOFF-ux-ui-job-lots.md` (22 จอ) · **มติ 18 ต.ค.**: เผื่อของเสียไม่บังคับ ค่าเริ่มปิด + คำตอบ Q1–Q7 ต่อ ux-ui (สรุป §11.1) · ux-ui review `ux-review-job-lots.md` §2.0/§6.2 (X1–X7 · T1–T10 — ตอบ §11.2)
> ฐานที่ต่อยอด: J1 `0172`–`0174` (main) · M1 `0175`–`0178` (**apply บน prod แล้ว** แต่ไฟล์อยู่ branch `feature/job-m1-metal`/`feature/job-m1-ui` — def ต้นทางของทุก object ที่ replace ต้องลอกจากฉบับที่ apply จริง) · ใบผลิต `0131`/`0138`/`0139` (💰 ไม่แก้ตรรกะต้นทุน)
> 🔴 ไม่มีตัวเลขต้นทุน/ราคาในไฟล์นี้ · ชื่อผู้รับจ้าง/จำนวนวัน/รายชื่อคน = **[ต้องยืนยัน]** · ชื่อตาราง/ฟังก์ชันเป็นข้อเสนอ ชื่อจริงตามไฟล์ migration ที่ apply

## 0. ของจริงที่ตรวจก่อนออกแบบ (18 ต.ค. 69 · อ่านอย่างเดียว) → ผลต่อ design

| พบ | ผลต่อ design |
|---|---|
| `schema_migrations` ล่าสุด: 0180 · 0179 · **0178 · 0177 · 0176 · 0175** (apply แล้ว) · main มีไฟล์ถึง 0174 + 0179/0180 | migration ถัดไป = **0181** · ทุก `create or replace` ต้องลอกจาก 0175–0178 บน branch M1 ไม่ใช่ main → **M1 ต้อง merge main ก่อนเริ่ม L1** (§9 P0) |
| `job` มีคอลัมน์ M1 ครบ: `qty_order` · `target_piece_g` · `metal_plan_*` · `surplus_*` · `profile_id/profile_name` · `require_final_weight` · `job_stage` มี `scrap_qty_ask/scrap_weight_ask` | ส่วนย่อยสืบทอดค่าเหล่านี้จากใบแม่ (snapshot ต่อขั้นลอกจากแถวแม่ ไม่ re-apply profile) |
| `job_stage_guard`: `qty_in` ขั้น N ต้องเท่า `qty_out` ขั้นก่อนที่ไม่ skip (ไม่มี = `qty_planned`) · `js_sent_ck`: `qty_out + qty_scrap = qty_in` · `js_not_sent_ck`: ยังไม่ส่ง ห้ามมี `qty_scrap` · `uq_job_stage_one_received` 1 ขั้น received ต่อใบ · `job_done_ck`: `qty_good + qty_scrap = qty_planned` | กติกาที่ security ผ่าน 3 รอบ — "ส่วน" ต้องเดินผ่านด่านชุดนี้**ตามเดิมทุกข้อ** · แก้ CHECK เฉพาะที่ต้องนับ "แยกออก" และ "ส่วนต่างรอชี้แจง" (มติ Q5) แบบ additive (§2.2) |
| `uq_job_production_item` / `uq_job_oem_item` / `uq_job_oem_deal_seq`: 1 item = 1 job ที่ไม่ cancelled | ส่วนย่อยคัดลอก source จากแม่จะชน → เพิ่ม `and parent_job_id is null` (ใบแม่เท่านั้นที่ unique) |
| `job_guard` INSERT: `profile_id` ว่าง ⇒ `profile_required` · ใบเดิมบน prod `profile_id` null = "กติกาเดิม J1" | ส่วนย่อยของใบเดิมต้องสร้างได้ → guard ยกเว้นเฉพาะแถวที่มี `parent_job_id` |
| `job_token`: เก็บ **hash** เท่านั้น · `job_token_issue(p_revoke_previous default true)` คืน token ดิบครั้งเดียว · เพดาน 5 active ต่อใบ (`token_cap`) · `job_done` เพิกถอนทั้งใบ · `worker_session` ผูก `worker_id` (ไม่ผูก job) ≤ 13 ชม. | "ใบย่อย = QR ตัวเดิม" **ทำซ้ำตัวเดิมไม่ได้** → ตีความ ข1 เป็น **"QR ไม่ระบุส่วน · ทุก QR ของใบเปิดหน้าเดียวกัน · ระบบแยกส่วนจากตัวช่าง"** ⇒ ใบย่อย/ใบส่งของ = **token ใหม่ของใบแม่เดิม ไม่เพิกถอนตัวเก่า** (§1.2) · session ช่างใช้ร่วมทุกทางเข้าใต้ `/w` (hub §7.1) |
| `production_order.status` CHECK = `open/done/cancelled` · trigger `deny_mutation` header/item หลังปลายทาง · `production_order_done` = ครั้งเดียว · ทุกรายการ 0 ชิ้น = raise | **ไม่เพิ่มสถานะใหม่** (ทุก call site เช็ค `'open'`) · ระหว่างเข้างวดใบยัง `open` · ปิด full ผ่าน RPC ใหม่ ไม่ใช่ `production_order_done` (จะสร้าง lot เต็มใบซ้ำ) · กำแพงกันเรียก `production_order_done` ใส่ใบที่มีงวด = trigger (§5.4) |
| `stock_lot`: `uq_stock_lot_production_order_item` partial unique และ `production_order_done` ใช้ `on conflict (production_order_item_id) where …` **อ้าง index นี้** · trigger: UPDATE ได้เฉพาะ `qty_remaining` · ห้ามลบ · 0 แถว | **ห้าม drop index นี้** (ON CONFLICT inference ของฟังก์ชัน 💰 พังตอน runtime) → lot ของงวดใช้ `production_receipt_id` และปล่อย `production_order_item_id = null` (§5.2) |
| `production_cost_calc(p_shop_id, p_product_id, p_spot, p_qty, p_is_new_design)` — `ProductionDoneDialog` ส่งจำนวนที่ผลิตเป็นตัวหารค่าแบบ/ก้อนยาง/แฟลสก์ (โหมดสเปค 0140–0143) · **ยังไม่ได้ตรวจว่า `cost_calc` แยก component ให้อ่านได้** | มติ Q7 ต้องแยก 2 พวก → §5.3 · ถ้า breakdown ไม่แยก component ต้องเพิ่ม key แบบ additive (golden replay key เดิมเท่าเดิม) ก่อนเริ่ม L3 |
| `production_order_item.product_id` not null · unique `(production_order_id, product_id)` | ไม่มี SKU (W1 ค1) → nullable + `pending_product_label` · unique บน null ไม่ชน |
| `job_worker_*` RPC รับ `p_expected_seq` อย่างเดียว · route มีแค่ `app/(worker)/w/[token]` · layout ห้ามลิงก์ออก (เทสต์ `worker-boundary`) | RPC ช่างต้องระบุส่วน (`p_lot_job_id`) = เปลี่ยน signature → drop เดิม · hub ระดับร้าน = route ใหม่ใต้ `/w/` ใช้ session เดิม (มติ Q6 · §7.1) |
| ใบงานบน prod: production open 2 · in_progress 1 · done 1 · OEM cancelled 10 · `production_order` open 3 · done 1 (PO-0002 ทดสอบ) · `stock_lot` 0 | ไม่มี backfill · ใบเดิมทุกใบ = "ใบแม่ส่วนเดียว" อัตโนมัติ (`parent_job_id` null · `lot_seq` 0) ไม่ UPDATE แถวเดิม (ข้อ 19) |
| `job_profile_default_for(shop, metal)` — default **ต่อโลหะ** มีแล้ว (ต่างจาก design 0176) | ลอก def จาก DB/0176–0178 จริง ไม่ใช่เอกสาร |
| `job_plan_suggest(... p_qty_planned, p_target_piece_g, p_stage_codes)` · `job_create_from_production_item`: `v_qty_planned := coalesce(p_qty_planned, v_qty_order)` | มติ 18 ต.ค. เผื่อไม่บังคับ **DB รองรับแล้ว ไม่แก้ 0175** — UI อย่างเดียว (§8) |

## 1. โมเดล — ตัดสินใหม่ภายใต้ "QR เดียว + ไม่ชั่งตอนแบ่ง"

workflow §2 ตัด (ข) ด้วยเหตุผล "กระดาษ/QR ต่อก้อน" และ "ชั่งสัดส่วน" ซึ่งมติ ข1/ค1 ลบทิ้ง → เทียบใหม่ตามเกณฑ์ Tech Lead: รื้อ J1 น้อยสุด · "ใครถืออะไร" เสมอ · Σ ทุกขั้น = เริ่มผลิต · resolve จาก **ช่างที่ PIN**

| | **(ก) ส่วนย่อย = แถว `job` ที่มี `parent_job_id`** | (ข) ยอดถือต่อขั้นต่อช่าง (holding ledger ใต้ `job_stage`) | (ค) ผสม: `job` เดียว + `job_lot` และ `job_stage` key ด้วย lot |
|---|---|---|---|
| ของที่ J1 บังคับแล้ว (ผู้ถือ 1 คน/ขั้น · โซ่จำนวน · `uq_one_received` · auto-close · ชั่ง · วันที่ · guard) | **ใช้ซ้ำทั้งหมดต่อส่วน** — ส่วน = ใบงาน J1 ที่เดินด้วย RPC/trigger เดิม · แก้ CHECK แบบ additive (§2.2) | ต้องรื้อ: `job_stage` 1 แถว/ขั้น เก็บ "ฝัง: ช่าง ค ถือ 10 · ส่งแล้ว 40" ไม่ได้ → `js_sent_ck`/`uq_one_received`/chain/`core_*`/guard/`resolve` เขียนใหม่หมด | unique `(job_id, seq)` → `(job_id, lot_id, seq)` · RPC ≈ 15 ตัว + guard + view แก้หมด |
| "ใครถืออะไรในใบนี้" | = `job_stage.status='received'` ของแต่ละส่วน (เดิม) · view รวมต่อแม่ | นิยามใหม่จาก ledger | เขียนใหม่ |
| Σ ทุกขั้น = เริ่มผลิต | ด่านใหม่ 1 ตัวระดับต้นไม้ (§2.5) + ของเดิมต่อส่วน | ด่านใหม่ทั้งชุด | ด่านใหม่ทั้งชุด |
| resolve จากช่าง | token → ใบแม่ → ไล่ส่วน: ถือ (ส่ง) · ขั้นถัดไป pending ที่ฉันทำได้ (รับ) | เหมือนกัน แต่อ่าน ledger | เหมือนกัน |
| สิ่งที่แลก | `job` มีแถวลูก: `job_no` ของส่วนไม่ใช้บนจอ (แสดง "JB-0020 · ส่วนที่ 2") · บอร์ด/view/`job_done` ต้องรู้จัก root vs ส่วน · event กระจายหลาย `job_id` (view รวมตาม root) | ไม่มีแถวลูก แต่ของที่ security ผ่าน 3 รอบหายเกือบหมด | blast radius ใหญ่สุด |

**เลือก (ก)** + ชั้น resolve ที่มองจากช่าง (สิ่งที่ (ข) ให้ แต่ทำที่ view/RPC ไม่ใช่ตาราง) · ตัด (ข)/(ค) เพราะเกณฑ์ "รื้อน้อยสุด" ชี้ชัด และข้อดีเดียวของ (ข) ซื้อด้วย view `v_job_tree` ได้ถูกกว่ามาก

### 1.1 กติกาของ "ส่วน" (lot)

| เรื่อง | กติกา | ที่มา |
|---|---|---|
| ชั้นเดียว | ทุกส่วนชี้ `parent_job_id` = **ใบแม่ตัวเดียว** (trigger: แม่ต้อง `parent_job_id` null) · แยกซ้อนได้แต่ชี้แม่เดิม · `lot_seq` รัน 1,2,3… ไม่ใช้ซ้ำแม้ยกเลิก · แม่ = `lot_seq 0` "ส่วนหลัก" | ก2 · ฌ1 |
| เกิดเมื่อไร | ส่งต่อ **น้อยกว่าที่ถือ** (ช่าง/ออฟฟิศ) · **รับกลับไม่ครบ**จากนอกร้าน (§4) · **รับได้ไม่ครบ**ในร้าน (มติ Q5 — ส่วนต่างเป็น "รอชี้แจง" §1.3 ไม่ใช่ส่วนใหม่) · ส่งทั้งหมด = ไม่เกิดส่วน (เดินเหมือน J1 เป๊ะ) | ก1 ข4 ง Q5 |
| ส่วนไหนได้เลขใหม่ | ของที่ **ออกไป** = ส่วนใหม่ · ของที่ค้างกับผู้ถือเดิม = ส่วนเดิม (Handoff: "40 ชิ้นที่ส่งจะแยกเป็น ส่วนที่ 2 · ค้างกับคุณ 10") | ตรง UX |
| ประวัติขั้นของส่วนใหม่ | ขั้น **ก่อน** ขั้นที่แยก = `skipped` เหตุผล `split_inherit` · **ขั้นที่แยก** = `sent` โดยผู้แยก (`qty_in = qty_out = n` · `received_on` = วันที่ผู้แยกรับขั้นนี้ · `sent_on` = วันแยก · `weigh_required=false` · `split_from_stage_id` ชี้ขั้นแม่) · ถัดไป `pending` | (1) โซ่ `qty_in = prev.qty_out` ใช้ได้ทันที (2) แยกที่ QC ได้ ไม่ชน "ข้ามขั้น QC/แพ็กไม่ได้" (3) น้ำหนัก/ของเสียขั้นก่อน **ไม่คัดลอก** |
| จำนวนที่แม่เสียไป | ขั้นแม่: `qty_split_out += n` · คง `received` · ส่งครั้งสุดท้าย: `qty_out = qty_in − qty_scrap − qty_split_out` | ค1 |
| ของเสียตอนแยก | บันทึกบนขั้นแม่ได้ทั้งที่ยังถือ (ผ่อน `js_not_sent_ck` เฉพาะแถว `qty_split_out > 0`) · เหตุผลชุดเดิม · **ช่องของเสียบนจอช่างเปิดเสมอเมื่อส่ง "น้อยกว่าที่ถือ"** แม้ `scrap_qty_ask` ปิด (T1: ชิ้นที่หายต้องมีที่ลง) · ส่งทั้งหมด = ตาม flag เดิม | Handoff · T1 |
| ชั่ง | **ไม่ถามน้ำหนักตอนแยก/ส่งออก/รับกลับ** · ขั้นแยกของส่วนใหม่ `weigh_required=false` · ขั้นแม่ยังชั่งตอนส่งครั้งสุดท้ายถ้า flag สั่ง · ใบย่อย/ใบส่งของ: น้ำหนัก = `qty × target_piece_g` ป้าย "ประมาณ" (null = ไม่พิมพ์ · T10: SKU ส่วนใหญ่ไม่มีน้ำหนัก ห้ามเดา) · `v_job_stage_loss` ขั้นที่ `qty_split_out > 0` → `loss_g` null + `not_comparable` | ค1 · R3 |
| สืบทอด | `profile_id/name` · flag 3 ตัวต่อขั้น · `metal` · `design_label/sku_snapshot/product_id` · source · `due_date` ลอกจาก **แถวแม่** · `qty_order/target_piece_g/metal_plan_*/surplus_*` **อยู่ที่แม่** (ส่วน: `qty_order = qty_planned` ตัวเอง เพื่อผ่าน not null) | 0175/0176 ไม่ต้องรู้จักต้นไม้ |
| ยกเลิกส่วน | **ช่าง**: ส่วนที่ตัวเองแยก **ในร้าน** และยังไม่มีใครกดรับ → ชิ้นกลับขั้นแม่ (`qty_split_out −= n`) · **ส่วนที่ส่งออกนอกร้าน**: คนที่มีสิทธิ์ "ดูแลงานนอกร้าน" (`worker.can_external` — มติ Q3) ยกเลิกได้ + เหตุผล ถ้ายังไม่มีการรับกลับ · **ออฟฟิศ**: ทุกเมื่อ + เหตุผล + ที่ไปของชิ้น `return_to_parent` (ขั้นแม่ยัง received) หรือ `scrap` — ไม่มี "หายเฉยๆ" · ส่วน → `cancelled` (guard เดิมแช่แข็ง) | ข3 · Q3 · ฉ5 |
| รวมส่วน | ไม่ทำ (ก4) | |

### 1.2 QR / token ภายใต้ "QR เดียวต่อใบ" — เมื่อระบบไม่เก็บ token ดิบ

| ทาง | ทำได้ไหม | security |
|---|---|---|
| (1) พิมพ์ซ้ำ QR ตัวเดิม | **ไม่ได้** — เก็บแค่ sha256 | — |
| (2) เก็บ token เข้ารหัสสองทางเพื่อพิมพ์ซ้ำ | ได้ แต่ **ปฏิเสธ** | กุญแจอยู่ DB เดียวกับข้อมูล = เท่ากับเก็บ token ดิบ · ทิ้งด่านที่ 0172 ตั้งใจวาง (ฐานหลุด → QR ทุกใบใช้ได้) |
| **(3) ใบย่อย/ใบส่งของ = `job_token_issue(p_revoke_previous := false)` ของใบแม่** — QR คนละตัว เปิดหน้าเดียวกัน ระบบแยกส่วนจาก **ช่างที่ PIN** | ✅ เลือก | token ระดับใบ ไม่มีเงิน · เพิกถอนรายใบได้ · ปิด full เพิกถอนทั้งชุด · ที่ยอม: กระดาษหายใบหนึ่ง**ไม่**ถูกเพิกถอนอัตโนมัติ (คนเก็บได้อัปเดตใบนั้นในชื่อช่างที่มี PIN — ขอบเขตเดียวกับ R5 ของ J1) |

ที่เปลี่ยนจาก J1: (ก) ค่าเริ่ม `p_revoke_previous` = **false** เมื่อใบมีส่วน > 1 หรือพิมพ์ใบย่อย/ใบส่งของ (พิมพ์ A5 หลักซ้ำบนใบส่วนเดียว = true ตาม Q11 เดิม) · (ข) `token_cap` 5 → **[ต้องยืนยัน ค่า]** (เสนอ 12) · (ค) หน้าใบงาน: รายการ QR active (print_no · วัน · "ใบย่อย ส่วนที่ n"/"ใบส่งของ") + ปุ่ม "เพิกถอน QR ที่หาย" รายตัว · (ง) `job_token` เพิ่ม `purpose` + `lot_job_id` (ป้าย — **ไม่ใช่ตัวจำกัดสิทธิ์**: token ใดก็เปิดทั้งใบ) · (จ) W-8 โชว์ QR ครั้งเดียว + "ปิดหน้านี้แล้ว QR ไม่แสดงอีก — ช่างขั้นแรกรับจากคิวงาน" (X2) · (ฉ) มติ Q4: ส่งออกกลางคืนได้ ใบส่งของพิมพ์เช้าถัดไป (token ออกตอนพิมพ์) ผู้รับจ้างเซ็นย้อนหลัง

### 1.3 รับได้ไม่ครบ → "ส่วนต่างรอชี้แจง" (มติ Q5 — ทับข้อเสนอ ux-ui ข้อ 8)

ผู้รับกดรับได้และใส่จำนวนที่ได้จริง `m < n` → ระบบสร้าง **ส่วนต่าง** `n − m` เป็นแถว `job_discrepancy` (ไม่ใช่ส่วนใหม่ — ไม่มีตัวตนให้ใครถือ) สถานะ `open` ผูกกับ **ขั้นผู้ส่ง** (`from_stage_id`) และขั้นผู้รับ · ผู้ส่ง (ช่างที่ `worker_id` ตรงขั้นส่ง) หรือ `can_external`/ออฟฟิศ ชี้แจงเป็น `scrap` (เสียหาย) หรือ `lost` (หาย) + เหตุผล (ชุดเดียวกับ scrap_reason) → `resolved` · **ไม่แก้แถว `job_stage` ที่ส่งแล้ว** (append-only ของจริง) · โซ่: `job_stage_guard` ยอม `qty_in = prev.qty_out − Σ discrepancy(from=prev, to=this)` · Σ ต้นไม้นับส่วนต่างเป็นก้อนแยก (`qty_pending_explanation` / `qty_discrepancy_resolved`) → ยอดรวมยัง = เริ่มผลิต · ปิด full **ห้าม** ขณะมี `open` · บอร์ด/คิวผู้ส่ง: ป้าย "รอชี้แจง n" · `m = 0` ไม่ได้ (รับ 0 ชิ้น = ไม่กดรับ) · `m > n` ไม่ได้ · ชี้แจงแล้วแก้ไม่ได้ (ออฟฟิศ void ด้วยแถวใหม่เท่านั้น) · ใช้กับ **รับกลับจากนอกร้าน** ด้วย (ไม่ครบ = "ยังอยู่ที่ผู้รับจ้าง" (ส่วนค้าง) หรือ เสีย/หาย — คนรับกลับเลือกเองตาม ReturnIn ไม่ต้องรอชี้แจง เพราะผู้ส่งคือผู้รับจ้าง)
สิ่งที่แลก: โซ่ `qty_in = prev.qty_out` ที่ security ผ่าน ถูกผ่อนเป็น "= prev.qty_out − ส่วนต่างที่บันทึก" — ส่วนต่างทุกชิ้นมีแถวและมีคนรับผิดชอบ จึงยังพิสูจน์ได้ · เพิ่ม security scope ของ L1 · เคส "ส่วนต่างถูกเจอทีหลัง" (ของไม่ได้หายจริง) = ออฟฟิศ void แล้วให้ขั้นผู้รับส่งต่อตามปกติ ไม่มีทาง "เพิ่มของเข้าโซ่" โดยไม่ผ่านออฟฟิศ

## 2. Data model (สคีมา `analytics` · grant `service_role` เท่านั้น · RLS เปิดไม่มี policy · ข้อ 18)

### 2.1 คอลัมน์ใหม่บน `job` (alter table · `add column … default` ไม่ยิง trigger · ไม่ UPDATE แถวเดิม)

| คอลัมน์ | ชนิด / CHECK | ความหมาย |
|---|---|---|
| `parent_job_id uuid null` | FK `(parent_job_id, shop_id) → job (id, shop_id)` restrict · CHECK `parent_job_id is distinct from id` · trigger: แม่ต้อง `parent_job_id is null` (ชั้นเดียว) และ `source_kind/metal/production_order_item_id/oem_quote_item_id/root_quote_id` ตรงแม่ | null = ใบแม่ (ใบเดิมทุกใบ) |
| `lot_seq int not null default 0` | CHECK `(parent_job_id is null) = (lot_seq = 0)` · unique `(parent_job_id, lot_seq) where parent_job_id is not null` | "ส่วนที่ n" |
| `qty_split_out int not null default 0` | `between 0 and 100000` · เขียนโดย trigger `job_stage_sync` (Σ `job_stage.qty_split_out`) เท่านั้น — guard ปฏิเสธ UPDATE ตรง | ใช้ใน `job_done_ck` |
| `cancel_scrap_qty int null` · `cancel_scrap_reason text null` | เฉพาะส่วนย่อยที่ยกเลิกแบบ `scrap` · CHECK มีค่าได้เฉพาะ `status='cancelled' and parent_job_id is not null` | ชิ้นที่หายไปกับส่วนที่ยกเลิก — นับเป็น scrap ของต้นไม้ |
| `shortfall_reason text null` | `oem_note_valid` ≤ 200 · RPC ปิด full บังคับเมื่อ `qty_stocked_total < qty_order` (มติ Q2: ระบบเติมเองได้เมื่อขาด = ของเสียที่บันทึก §6) | ฉ3/ฉ4 |
| `tree_closed_by text null check in ('auto','office')` | เขียนตอนปิด full ของใบแม่ | |

`job_done_ck` (drop/add — แถวเดิม `qty_split_out = 0` ⇒ นิยามเดิมเป๊ะ): `qty_good + qty_scrap + qty_split_out = qty_planned`
`job_guard` INSERT: `profile_id is null and parent_job_id is null ⇒ profile_required` · partial unique 3 ตัว (`uq_job_production_item` · `uq_job_oem_item` · `uq_job_oem_deal_seq`): drop/create เพิ่ม `and parent_job_id is null` · `job_token_guard` INSERT: `job.parent_job_id is not null ⇒ raise` (token ออกให้ใบแม่เท่านั้น)

### 2.2 คอลัมน์ใหม่บน `job_stage` + CHECK ที่แก้ (additive — แถวเดิมค่า default ⇒ นิยามเดิม)

| คอลัมน์ | ชนิด / CHECK |
|---|---|
| `qty_split_out int not null default 0` | `between 0 and 100000` · เพิ่มได้เฉพาะ `status='received'` (guard) · ลดได้เฉพาะจาก RPC ยกเลิกส่วน |
| `split_from_stage_id uuid null` | FK → `job_stage(id)` · not null เฉพาะขั้น "แยก" ของส่วนย่อย · drift: Σ `qty_planned` ของส่วนที่ชี้ขั้น X (ไม่ cancelled) = `X.qty_split_out` |
| `contractor_id uuid null` | FK → `job_contractor` (L2) · not null = ขั้นนี้อยู่นอกร้าน · `worker_id` ต้อง null เมื่อมี contractor · `assignee_name` = ชื่อผู้รับจ้าง (snapshot) |

- `js_sent_ck`: `… qty_out + qty_scrap + qty_split_out = qty_in`
- `js_not_sent_ck`: `… (qty_scrap = 0 and scrap_reason is null) or qty_split_out > 0 …` (ของเสียก่อนส่งครั้งสุดท้าย เฉพาะขั้นที่เคยแยก) · คอลัมน์ฝั่งออกอื่นยังห้าม
- `js_idle_ck`: เพิ่ม `qty_split_out = 0` ในสภาพ pending/skipped
- โซ่จำนวน (`job_stage_guard`): `qty_in` ขั้นนี้ = `prev.qty_out − Σ job_discrepancy.qty where from_stage_id = prev.id` (§1.3) — ใบที่ไม่มี discrepancy ⇒ นิยามเดิม
- `job_stage_sync` (AFTER): เพิ่ม Σ `qty_split_out` → `job.qty_split_out`
- `job_stage_guard`: **ไม่เพิ่ม transition ใหม่** — RPC แยกเดินขั้นของส่วนใหม่ด้วย pending→received→sent (2 UPDATE) ผ่านด่านเดิมทุกข้อ · เพิ่ม: (1) `qty_split_out` เพิ่มได้เมื่อ `old.status='received'` และ `new.qty_split_out + new.qty_scrap < qty_in` (2) `auto_closed=true` บนขั้นที่ `qty_split_out > 0` **ห้าม** (auto-close ตั้ง `qty_out = qty_in` ผิดโซ่) → ช่างถัดไปที่รับ "ส่วนเดิม" ขณะผู้ถือยังค้างของ = `prev_not_sent`

### 2.3 ตารางใหม่ / คอลัมน์ใหม่นอก `job*`

| ตาราง | คอลัมน์หลัก | phase |
|---|---|---|
| `job_discrepancy` (มติ Q5) | `id` · `shop_id` · `root_job_id` · `job_id` (ส่วน) · `from_stage_id` · `to_stage_id` · `qty int check (1..100000)` · `status check in ('open','resolved','void')` · `resolved_kind check in ('scrap','lost')` · `resolved_reason` (ชุด scrap_reason) · `resolved_by_worker/actor` · `resolved_at` · `void_of_id` (void = แถวใหม่ชี้แถวเดิม) · `created_by_worker/actor` · `created_at` · trigger: แก้ได้เฉพาะ open→resolved ครั้งเดียว · ห้าม DELETE | L1 |
| `job_contractor` | `id` · `shop_id` · `name` (`job_label_clean` ≤ 60 · unique lower) · `work_kind check in ('plating','other')` · `sla_days int null` (**[ต้องยืนยัน]** · null = ไม่เตือน) · `contact text null` (**[ต้องยืนยัน]** ห้ามแต่ง) · `is_active` · audit cols · ห้าม DELETE | L2 |
| `production_receipt` 💰 | `id` · `shop_id` · `production_order_id` · `production_order_item_id` · `root_job_id` (ใบแม่) · `cast_round_job_id` (ส่วนที่หล่อรอบนั้น · มติ Q7) · `receipt_seq int` (unique `(production_order_item_id, receipt_seq)`) · `qty` · `unit_cost numeric(12,2)` · `spot_thb_per_gram null` · `cost_calc jsonb` (snapshot + ตัวหาร: `nre_divisor = root.qty_planned` · `batch_divisor = qty_cast(round)`) · `received_on` (ไทย) · `channel check in ('job_page','worker_qr')` · `actor/worker_id` (อย่างน้อยหนึ่ง) · `idem_key text not null` · unique `(idem_key, cast_round_job_id)` · `stock_lot_id` FK unique · append-only trigger | L3 |
| `production_receipt_alloc` 💰 | `receipt_id` · `job_id` (ส่วน) · `qty` · PK `(receipt_id, job_id)` · RPC assert Σ = `receipt.qty` | L3 |
| `shop_intake_token` | `id` · `shop_id` · `token_hash unique` · `label` · `issued_at/by` · `revoked_at/reason` · 1 active ต่อร้าน (ก3) | W1 (hub §7.1) |
| `stock_lot.production_receipt_id uuid null` | FK → `production_receipt` · unique partial · CHECK `num_nonnulls(production_order_item_id, production_receipt_id) <= 1` · trigger "แก้ได้เฉพาะ qty_remaining" ครอบอัตโนมัติ | L3 |
| `production_order` | `opened_via text not null default 'office' check in ('office','shopfloor')` · `opened_by_worker_id` · `acknowledged_at/by` · `intake_idem_key text null unique` · `closed_via text null check in ('done','receipts')` | W1 · L3 |
| `production_order_item` | `product_id` → **nullable** + `pending_product_label text null` · CHECK `num_nonnulls(product_id, pending_product_label) = 1` | W1 |
| `worker` | `can_open_job boolean not null default false` (ก2) · `can_external boolean not null default false` (มติ Q3 "ดูแลงานนอกร้าน": ส่งออก/รับกลับ/ยกเลิกส่งออก) — **ไม่มี flag เข้าสต็อก**: มติ Q1 = ช่างที่ `stage_codes` มี `qc` หรือ `pack` (หรือทุกขั้น) กดได้ ด่านอยู่ที่จำนวน | W1 · L2 · L3 |
| `job_token` | `purpose text not null default 'traveler' check in ('traveler','sublot','delivery_note')` · `lot_job_id uuid null` (ป้าย) | L1 |
| `job_event.event_type` | เพิ่ม `'split'` · `'split_cancel'` · `'discrepancy'` · `'discrepancy_resolve'` · `'external_out'` · `'external_in'` · `'external_cancel'` · `'stock_in'` · `'tree_close'` · `'intake_open'` · `'ack'` · `'edit'` — drop/add `job_event_event_type_ck` | ตาม phase |
| `scrap_reason` code | เพิ่ม `'contractor_damaged'` · `'contractor_lost'` (ง4 — ต้องมี note) ใน `v_codes` ของ `job_core_send` + `js_scrap_reason_ck` | L2 |

### 2.4 Views (อ่านฝั่ง server เท่านั้น)

- `v_job_tree` — 1 แถวต่อส่วน (รวมแม่): `root_job_id` · `lot_seq` · `label` · `qty_live` = `qty_planned − Σ qty_scrap(sent) − Σ qty_split_out − qty_stocked − Σ discrepancy(open+resolved ที่ from_stage อยู่ในส่วนนี้)` · `stage_code/stage_status/holder_name/contractor_name/days_in_stage/is_external/external_overdue` · `qty_qc_passed` (= `qc.qty_out` เมื่อ qc sent) · `qty_stocked` (Σ alloc) · `cast_round_job_id` · **ไม่มีต้นทุน**
- `v_job_tree_summary` — 1 แถวต่อใบแม่: `qty_planned` · `qty_order` · `qty_by_stage jsonb` · `qty_external` · `qty_scrap_total` (sent + cancel_scrap + discrepancy resolved) · `qty_pending_explanation` · `qty_qc_passed_total` · `qty_stocked_total` · `qty_ready_to_stock = qc_passed − stocked` · `parts_count/parts_open` · `sum_check` (Σ live + scrap + pending + stocked = `qty_planned`) · `dominant_stage_code` (ขั้นที่ live มากสุด — ตำแหน่งการ์ดบอร์ดคอลัมน์ · X3) · `close_state` ('running' · 'ready_auto' · 'needs_reason_short' · 'needs_reason_over' · 'blocked_external' · 'blocked_discrepancy' · 'closed')
- `v_job_board` — **ต่อท้าย**: `parent_job_id` · `lot_seq` · `parts_open` · `qty_external` · `qty_pending_explanation` · `qty_ready_to_stock` · `qty_stocked_total` · `dominant_stage_code` · `close_state` · TS กรอง `parent_job_id is null` (จ1) · **บอร์ดคอลัมน์ตามขั้นของจริง**: การ์ดใบแม่อยู่คอลัมน์ `dominant_stage_code` (ใบไม่แยก = `current_stage_code` เดิม) + chip "n ส่วน · ขั้นอื่นด้วย" · ห้ามแทรกคอลัมน์กลาง (42P16)
- `v_ready_to_stock` (L3) — ใบแม่ production ที่ `qty_ready_to_stock > 0` หรือ `close_state` ไม่ใช่ 'running' · `blocked_reason` ('no_sku' · 'unacknowledged' · 'spec_components_missing' · 'price_missing' — RPC เช็คซ้ำอีกชั้น) · ไม่มีต้นทุน
- `v_job_tree_drift` — Σ `qty_planned` ส่วนที่ชี้ขั้น X ไม่เท่ากับ `X.qty_split_out` · `sum_check=false` · `job.qty_split_out` ไม่เท่ากับ Σ stage · Σ alloc ไม่เท่ากับ receipt.qty → verify ยิงหลังทุกเทสต์

### 2.5 ด่านระดับต้นไม้ `job_tree_assert(p_root_job_id)` (ภายใน · เรียกท้ายทุก RPC ที่แตะส่วน/งวด/ส่วนต่าง)
ล็อกแถวแม่ `for update` ตั้งแต่ต้น RPC (= ล็อกทั้งต้นไม้ · กัน 2 มือถือแยก/รับ/เข้าสต็อกพร้อมกัน) → ท้าย RPC: `Σ qty_live + qty_scrap_total + qty_pending_explanation + qty_stocked_total = root.qty_planned` ไม่ตรง = `raise` ทั้งทรานแซกชันถอย · ข้อความไม่มี UUID

## 3. RPC — L1 ส่วนย่อยในร้าน (✱ = security definer + grant `service_role` เท่านั้น · office = `crm_require_owner_admin` + `p_actor` · ช่าง = `job_worker_auth` เดิม · เปลี่ยน arg = drop signature เดิม + re-grant · ลอก def จาก 0175–0178 ที่ apply จริง)

| ฟังก์ชัน | สาระ |
|---|---|
| `job_lot_split_core(p_root, p_from_stage_id, p_qty, p_qty_scrap, p_scrap_reason, p_worker_id, p_channel, p_actor, p_device_hint, p_enforce_holder, p_target_contractor_id default null)` (ภายใน · revoke ทุก role) | ล็อกแม่ `for update` · ขั้นต้นทางต้อง `received` · `1 <= p_qty <= qty_in − qty_scrap − qty_split_out − 1` (**เหลืออย่างน้อย 1 ชิ้นกับผู้ถือ** — ส่งทั้งหมดใช้ `job_core_send` เดิม) · holder เช็คแบบ `job_core_send` · ของเสีย: ชุด code เดิม แล้ว `qty_scrap += p_qty_scrap` บนขั้นต้นทาง · INSERT `job` ส่วนใหม่ (ลอกแม่ · `qty_planned = qty_order = p_qty` · `lot_seq = max+1` · `created_by` = actor หรือของแม่เมื่อช่าง — ผู้ทำจริงอยู่ใน event) · INSERT `job_stage` ทุกขั้นของแม่ (ลอก flag 3 ตัว) → ขั้น < แยก `skipped/split_inherit` · ขั้นแยก received→sent (`qty_in=qty_out=p_qty` · `weigh_required=false` · `split_from_stage_id` · worker/assignee = ผู้แยก · `received_on` ของขั้นแม่ · `sent_on` วันนี้) · ขั้นต้นทาง `qty_split_out += p_qty` · event `split` (แม่) + `create` (ส่วน) · `job_tree_assert` · คืน `{lot_job_id, lot_seq, label, qty, parent_remaining, next_stage}` |
| `job_worker_send(p_token_hash, p_session_hash, p_lot_job_id, p_expected_seq, p_qty_send default null, p_weight_out_g, p_qty_scrap, p_scrap_reason, p_metal_added_g, p_weight_note, p_scrap_weight_g, p_user_agent, p_ip_hash)` ✱ **replace (drop sig เดิม 11 arg)** | `p_lot_job_id` ต้องอยู่ในต้นไม้ของ token (ไม่ cancelled) · `p_qty_send` null หรือ = ที่ถือ ⇒ `job_core_send` เดิมทุกบรรทัด · น้อยกว่า ⇒ `job_lot_split_core` (ส่ง `p_weight_out_g`/`p_metal_added_g`/`p_scrap_weight_g` มาด้วย = `weight_unexpected` — ค1) · ช่อง `worker_qr` · `p_enforce_holder=true` |
| `job_worker_receive(p_token_hash, p_session_hash, p_lot_job_id, p_expected_seq, p_weight_in_g, p_qty_received default null, p_user_agent, p_ip_hash)` ✱ **replace (drop sig เดิม 6 arg)** | เลือกส่วน · `p_qty_received` null = รับตามที่ส่ง (เดิม) · `< prev.qty_out` ⇒ `job_core_receive` ตั้ง `qty_in = p_qty_received` + INSERT `job_discrepancy` (open · from = ขั้นก่อน) + event `discrepancy` บนขั้นผู้ส่ง (มติ Q5) · `0` หรือ `>` = `qty_invalid` · ส่วนที่ขั้นปัจจุบันมี `contractor_id` → ใช้ `job_worker_return_in` (L2) |
| `job_worker_discrepancy_resolve(p_token_hash, p_session_hash, p_discrepancy_id, p_kind, p_reason, p_user_agent, p_ip_hash)` ✱ ใหม่ | ผู้ชี้แจง = `worker_id` ของ `from_stage` หรือ `can_external` · `p_kind in ('scrap','lost')` + เหตุผล (ชุดเดิม) · open→resolved ครั้งเดียว · event `discrepancy_resolve` · ออฟฟิศ: `job_discrepancy_resolve(p_shop_id, p_id, p_kind, p_reason, p_actor)` + `job_discrepancy_void(... p_reason)` (แถวใหม่ชี้เดิม · ชิ้นกลับเข้าโซ่ไม่ได้ — ให้ขั้นผู้รับส่งต่อตามปกติ) |
| `job_worker_lot_cancel(p_token_hash, p_session_hash, p_lot_job_id, p_reason default null, …)` ✱ ใหม่ | ข3/Q3: ส่วนที่แยกโดย worker เดียวกัน (event `split.worker_id`) · ทุกขั้นหลังขั้นแยก `pending` · ไม่มี alloc งวด · ไม่มี discrepancy · ถ้า `contractor_id` (ส่งออกนอกร้านแล้ว) ต้อง `can_external` + เหตุผลบังคับ (L2) · ขั้นแม่ยัง `received` ผู้ถือเดิม → `qty_split_out −= qty` · ส่วน → `cancelled` · event `split_cancel`/`external_cancel` ทั้งสองฝั่ง · `job_tree_assert` |
| `job_lot_split(p_shop_id, p_root_job_id, p_from_stage_id, p_qty, p_qty_scrap, p_scrap_reason, p_actor, p_contractor_id default null)` ✱ ออฟฟิศ | `job_office_begin` บนแม่ · `p_enforce_holder=false` · ช่อง `job_page` |
| `job_lot_cancel(p_shop_id, p_lot_job_id, p_reason, p_disposition, p_scrap_reason default null, p_actor)` ✱ ออฟฟิศ | `p_disposition in ('return_to_parent','scrap')` · ส่วนต้องไม่มี alloc งวด (เข้าสต็อกแล้ว = แก้ที่ `/stock`) · `return_to_parent` เฉพาะขั้นแม่ยัง `received` · `scrap`: ชิ้น live → `cancel_scrap_qty/reason` บนแถวส่วน · ส่วน → `cancelled` · `job_tree_assert` |
| `job_worker_resolve(text, text, text)` ✱ replace (sig เดิม) | `job` block เดิม**คงทุก key** + `parts[]` (`label, qty_live, stage_name, holder_name, contractor_name, days, is_external, is_mine, status`) · `my_actions[]` = `[{lot_job_id, label, action: 'send'|'receive'|'explain', stage_seq, stage_code, stage_name, weight_required, scrap_qty_ask, scrap_weight_ask, qty_hold, qty_expected, can_cancel_split, discrepancy_id}]` (ส่ง = ส่วนที่ฉันถือ · รับ = ส่วนที่ขั้นถัดไปอยู่ใน `stage_codes` ของฉัน และไม่ติด `prev_not_sent`/มัดจำ/on_hold · explain = discrepancy open ที่ `from_stage.worker_id` = ฉัน) · `next_action/action_stage` **เดิม**: ต้นไม้ส่วนเดียวและไม่มี discrepancy ⇒ ค่าเดิมเป๊ะ (เทสต์ J1 ผ่าน) · หลายส่วน ⇒ `next_action='multi'` · `identify`: รายชื่อช่างกรองจากขั้นที่ถือ/รอรับของทุกส่วน (T4) · N1 ทองเดิม · **ไม่มีราคา/ต้นทุน/ชื่อลูกค้า** · TS `sanitizeWorkerView` allowlist ขยายทีละ key |
| `job_done(... 9 arg เดิม)` ✱ replace | `qty_good + qty_scrap + v_job.qty_split_out = qty_planned` · ใบแม่ที่มีส่วน open หรือ discrepancy open ⇒ raise `parts_open` ("ปิดผ่านปิด full") · ส่วนย่อย: ไม่แตะ token · `surplus_*` คิดเฉพาะใบแม่ |
| `job_token_issue(p_shop_id, p_job_id, p_revoke_previous default null, p_actor, p_purpose default 'traveler', p_lot_job_id default null)` ✱ **replace (drop sig 4 arg)** | `p_revoke_previous` null ⇒ ค่าเริ่มตาม §1.2 · เพดานใหม่ · ใบแม่เท่านั้น |
| `job_office_send/receive` ✱ | เพิ่ม `p_lot_job_id` (+ `p_qty_received` ที่ receive) — drop sig เดิม · partial ของออฟฟิศ = `job_lot_split` |
| `job_cancel` (แม่) · `job_stage_reopen/skip` | แม่มีส่วน open ⇒ raise · ขั้นที่ `qty_split_out > 0` หรือมี discrepancy ⇒ raise `has_split` |

**ใบย่อย** (`/jobs/[id]/print?lot=n`): `PrintableJob` เพิ่ม `lotLabel` · `qtyLot` · `inheritedLine` ("มาจาก JB-0020 · ผ่าน หล่อ·ขัด แล้ว") · `estWeightG` + ป้าย "ประมาณ" (null = ไม่พิมพ์) · QR = token ใหม่ (`purpose='sublot'`) · ไม่มีราคา (ประกอบทีละ field)

## 4. ขั้นนอกร้าน + ผู้รับจ้าง (L2 · ง1–ง7 · มติ Q3/Q4)

- **ขั้นนอกร้าน = ขั้นปกติของส่วนที่มี `contractor_id`** · ผู้ถือ = ผู้รับจ้าง (`assignee_name` snapshot ชื่อ · `worker_id` null) · ไม่มี PIN ให้คนนอก (ง1) · ไม่ชั่ง (ง5 — profile default ไม่ชั่งขั้น plating อยู่แล้ว · ถ้า profile ใดสั่งชั่งขั้นนอกร้าน ⇒ ส่งออกไม่ได้ hint `external_no_weigh` ให้ออฟฟิศเปลี่ยนแบบก่อนเริ่ม)
- **ส่งออก** `job_worker_external_out(p_token_hash, p_session_hash, p_lot_job_id, p_expected_seq, p_qty_send default null, p_qty_scrap, p_scrap_reason, p_contractor_id, …)` ✱ — ผู้กด = ผู้ถือขั้นก่อน หรือ `can_external` (กดแทนได้ทุกส่วน) · ส่งทั้งหมด = `job_core_send` + `job_core_receive` ขั้นถัดไปด้วย `p_assignee = contractor.name` + `contractor_id` ในทรานแซกชันเดียว · บางส่วน = `job_lot_split_core(p_target_contractor_id)` แล้วรับขั้นถัดไปของส่วนใหม่ให้ผู้รับจ้าง · กดได้ตลอด (มติ Q4) · event `external_out` · ออฟฟิศ: `job_lot_external_out(p_shop_id, …, p_actor)`
- **รับกลับ** `job_worker_return_in(p_token_hash, p_session_hash, p_lot_job_id, p_qty_back, p_rest_disposition, p_reason, …)` ✱ — ผู้กด = `can_external` หรือช่างที่ทำขั้นถัดไปได้ (QC) · `p_rest_disposition in ('still_out','scrap','lost')` · `p_qty_back = qty_live` ⇒ `job_core_send` ขั้นนอกร้าน + รับขั้นถัดไปโดยผู้กด · น้อยกว่า ⇒ `still_out`: `job_lot_split_core` (ส่วนใหม่ = ที่กลับ) แล้วรับขั้นถัดไป · ส่วนเดิมค้างที่ผู้รับจ้าง · `scrap/lost`: `qty_scrap` บนขั้นนอกร้านเหตุผล `contractor_damaged/lost` + note (ง4) · event `external_in` · ไม่ใช้ `job_discrepancy` (ผู้ส่งคือผู้รับจ้าง ไม่มีใครชี้แจง — ตรงจอ ReturnIn)
- **ยกเลิกส่งออก** (มติ Q3): `can_external` หรือออฟฟิศ + เหตุผลบังคับ · ได้เฉพาะยังไม่มีการรับกลับใดๆ ของส่วนนั้น · ชิ้นกลับขั้นแม่ (`return_to_parent`) ถ้าขั้นแม่ยัง received ไม่งั้นต้องเลือก scrap · event `external_cancel`
- **ค้างนาน**: `v_job_tree.external_overdue = days_in_stage > contractor.sla_days` (null = ไม่เตือน) · บอร์ด/LINE
- **ใบส่งของผู้รับจ้าง** `/jobs/[id]/print?delivery=...` 2 ฉบับ: เลขใบ · ส่วนที่ n · ชื่อแบบ · จำนวน · น้ำหนักประมาณ (ป้าย) · **รูปหลัก** (ง7 🔀 — สวิตช์ `job.hide_photo_external boolean default false` สำหรับ OEM ที่ลูกค้าห้ามเผย · ค่าเริ่ม **[ต้องยืนยัน]**) · ช่องเซ็น 2 ฝ่าย · QR = token `purpose='delivery_note'` (§1.2) · **ไม่มีราคา/ชื่อลูกค้า** (`PrintableDeliveryNote` ประกอบทีละ field) · พิมพ์เช้าถัดไปได้ ผู้รับจ้างเซ็นย้อนหลัง (Q4)
- ทะเบียนผู้รับจ้าง `/jobs/contractors` (แท็บใน `JobsSubNav`) · `job_contractor_upsert/set_active` ✱ ออฟฟิศ · ชื่อ/ติดต่อ/วัน = **[ต้องยืนยัน]** กรอกเองก่อนขึ้นจริง ห้าม seed ชื่อสมมติ

## 5. เข้าสต็อกเป็นงวด 💰 (L3 · ช1–ช4 · ฉ1/ฉ2 · มติ Q1/Q7) — RPC ใหม่ **ข้างหน้า** `production_order_done` · ไม่แก้ตรรกะต้นทุนเดิมแม้บรรทัดเดียว

### 5.1 นิยาม
- **เสร็จ** = ส่วนที่ขั้น `qc` เป็น `sent` → `qc.qty_out` (ฉ2) · **พร้อมเข้าสต็อก** = Σ qc_passed − Σ stocked (ต่อใบแม่) · ของรอเข้า**ไม่นับในสต็อก** (ช4) — ไม่มีคอลัมน์ "รอเข้า" บน `/stock`
- **1 การกด = 1 งวด** (`idem_key` จาก client สร้างครั้งเดียวต่อฟอร์ม) → `production_receipt` 1 แถวต่อ **รอบหล่อ** ที่ชิ้นมาจาก (ปกติ 1) · 1 receipt = 1 `stock_lot` (`source='production'` · `production_receipt_id` · `production_order_item_id` **null**) · ราคาเงิน = วันที่กด (ช2 · `production_spot_resolve` เดิม · override ของใบถ้ามี · ราคาไม่มี = raise ไม่ fallback)
- จัดสรรชิ้นให้ส่วน (`production_receipt_alloc`): FIFO ตาม `qc.sent_on, lot_seq` ของส่วนที่ `qc` sent และยังเหลือ · ส่วนที่ถูกหยิบครบ ⇒ ขั้น `pack` ปิดอัตโนมัติ (received→sent โดยผู้กด/assignee "เข้าสต็อก" · qty_in=qty_out) แล้ว `job_done` ส่วนนั้น (`qty_good = stocked, qty_scrap = Σ scrap`) · profile ที่สั่งชั่งขั้น `pack` ⇒ งวดถูกปฏิเสธ `pack_weigh_required` (ช่างต้องส่งต่อขั้นแพ็กเองก่อน แล้ว "เสร็จ" ของใบนั้น = `pack.qty_out`)

### 5.2 RPC
| ฟังก์ชัน | สาระ |
|---|---|
| `production_receipt_core(p_root_job_id, p_qty, p_idem_key, p_expected_spot numeric null, p_channel, p_actor, p_worker_id, p_device_hint)` (ภายใน) | `pg_advisory_xact_lock('analytics.production_order_done:' + shop)` (กุญแจเดียวกับ done — กันชนกัน) · ล็อกแม่ `for update` · ด่านตามลำดับ: ใบแม่ production ไม่ปลายทาง · `production_order.status='open'` · `opened_via='shopfloor'` ⇒ `acknowledged_at not null` (W1) · `poi.product_id not null` (ไม่มี SKU = ปิดไม่ได้) · SKU active · ไม่ใช่ `^live` · `1 ≤ p_qty ≤ qty_ready_to_stock` (มติ Q1: ด่านคือจำนวน) · idempotency: `idem_key` เดิม + qty เดิม ⇒ คืนผลเดิม · qty ต่าง ⇒ raise `idem_conflict` · จัดสรร alloc FIFO → group by `cast_round_job_id` → ต่อรอบ: ต้นทุน §5.3 · ensure `central_stock` · `adjust_stock(+qty, 'por:' + receipt_id)` · `track_stock` set (coalesce since เดิม) · INSERT `stock_lot` (`get diagnostics` ต้องได้ 1 แถว) · INSERT receipt + alloc · event `stock_in` บนแม่ · `catalog_audit_log` แบบ done · ปิด pack/`job_done` ส่วนที่ครบ · ตรวจปิด full อัตโนมัติ (§6) · `job_tree_assert` |
| `production_receipt_preview(p_shop_id, p_root_job_id, p_qty, p_actor)` ✱ ออฟฟิศ | เส้นเดียวกับ core ลบส่วนเขียน (หลัก "ที่เห็น = ที่ stamp" ของ 0131) · คืน `spot`, `unit_cost` ต่อรอบ, `lots[]` |
| `production_receipt_create(p_shop_id, p_root_job_id, p_qty, p_idem_key, p_expected_spot_thb_per_gram, p_actor)` ✱ ออฟฟิศ | `p_expected_spot` **บังคับ** เมื่อ `v_needs_spot` (fail-closed เดิม M1/0132) · ช่อง `job_page` |
| `job_worker_stock_in(p_token_hash, p_session_hash, p_qty, p_idem_key, p_user_agent, p_ip_hash)` ✱ ช่าง | ช่างต้อง `job_worker_can_do(stage_codes,'qc') or job_worker_can_do(stage_codes,'pack')` (มติ Q1) · **ไม่มี `p_expected_spot`** — ช่างไม่เห็นราคา ⇒ DB resolve เอง fail-closed (ราคาวันนี้ไม่มี = `price_missing` "แจ้งออฟฟิศ") · response `{ok, qty, lot_count, remaining_ready, closed_full}` **ไม่มี unit_cost/spot** · rate limit เดิม · ช่อง `worker_qr` |

### 5.3 ต้นทุนต่องวดเมื่อ SKU โหมดสเปค (มติ Q7 — แยก 2 พวก · ผลรวมทุกงวดไม่นับซ้ำ)
| component | ตัวหาร | หมายเหตุ |
|---|---|---|
| ต่อชิ้น (เนื้อโลหะ × ราคาเงินวันกด · ค่าแรงต่อชิ้น · พลอย) | ไม่หาร | `production_cost_calc` ส่วน per_piece ด้วย spot วันกด |
| **ครั้งเดียวต่อใบ** (ค่าแบบ/CAD/ปริ้น 3D/ก้อนยาง — เฉพาะ `is_new_design`) | `root.qty_planned` (เริ่มผลิตทั้งใบ) | ทุกงวดเท่ากัน · ของเสียทำให้ส่วนหนึ่ง**ไม่เข้าสต็อก** (ต่างจาก `production_order_done` เดิมที่หารด้วยจำนวนดี — เจ้าของเลือกแล้ว แจ้งใน UAT) |
| **ต่อรอบหล่อ** (แฟลสก์/ปูน/เผา) | `qty_cast(round)` = `cast.qty_in` ของส่วนที่หล่อรอบนั้น | รอบหล่อ = ส่วนที่ขั้น `cast` ไม่ใช่ `split_inherit` · ส่วนที่แยกหลังหล่อสืบทอดรอบจากต้นทาง (ไล่ `split_from_stage_id`) · ส่วนที่แยก**ก่อน**หล่อ = รอบของตัวเอง |

`unit_cost(งวด, รอบ) = per_piece + nre_total ÷ qty_planned_root + batch_total(รอบ) ÷ qty_cast(รอบ)` ปัด 2 ตำแหน่งที่ผลรวมต่อชิ้น · `cost_calc` snapshot เก็บ 3 component + ตัวหาร · **ข้อกำหนดก่อนเริ่ม L3**: `production_cost_calc` ต้องคืน component 3 ก้อนแยก (ตรวจ 0140/0143 จริง — ถ้าไม่มี เพิ่ม key แบบ additive ใน output โดย golden replay ยืนยัน key เดิมเท่าเดิม → security) · SKU `fixed`/`spot` ไม่มี NRE/batch ⇒ สูตรยุบเป็นของเดิม · **จนกว่า component จะพร้อม งวดของ SKU โหมดสเปคถูกปิด** (`blocked_reason='spec_components_missing'` · RPC raise) — SKU fixed/spot ใช้ได้ก่อน

### 5.4 กำแพงกัน `production_order_done` ชนกับงวด (ไม่แก้ฟังก์ชัน 💰 · md5 เท่าเดิม)
trigger BEFORE UPDATE บน `production_order`: `old.status='open' and new.status='done'` ∧ มี `production_receipt` ของใบนี้ ∧ `current_setting('analytics.po_close_via_receipts', true)` ไม่เท่ากับ `new.id::text` ⇒ raise "ใบนี้เข้าสต็อกเป็นงวดแล้ว — ปิดผ่าน 'ปิด full' ของใบงาน" · RPC ปิด full ตั้ง `set_config(..., id, true)` ก่อน UPDATE และเขียน `closed_via='receipts'` · ผลข้างเคียง: `production_order_done` บนใบที่มีงวดจะทำงานถึงบรรทัดสุดท้ายแล้วถอยทั้งทรานแซกชัน (ไม่มีผลค้าง) · UI ซ่อนปุ่ม "ปิดใบ" เดิมเมื่อ `receipt_count > 0` (ด่านจริงคือ trigger) · ใบที่ไม่เคยเข้างวด = `production_order_done` เดิมทุกประการ

## 6. ปิด full (ฉ3 🔀 · ฉ4 · ฉ5 · มติ Q2)

| สภาพของใบแม่ (จาก `v_job_tree_summary`) | `close_state` | ใครปิด |
|---|---|---|
| ทุกส่วน: ไม่มีขั้น pending/received (ยกเว้น `pack` ที่งวดจะปิดให้) · `qty_external = 0` · `qty_pending_explanation = 0` · **`qty_stocked_total = qty_order`** | `ready_auto` | **ระบบปิดเองในทรานแซกชันของงวดสุดท้าย** (`tree_closed_by='auto'`) |
| เหมือนบน แต่ `qty_stocked_total < qty_order` และ `qty_stocked_total + qty_scrap_total = qty_planned` (ของขาด = ของเสียที่บันทึกไว้ครบ) | `needs_reason_short` | ออฟฟิศกด · **ระบบเติม `shortfall_reason` ให้** = "ของเสียระหว่างผลิต n ชิ้น (หล่อ a · ฝัง b · …)" แก้ได้ (มติ Q2) |
| `qty_stocked_total < qty_order` และ `stocked + scrap < qty_planned` (มีชิ้นหายที่ไม่มีใครบันทึก) | `needs_reason_short` | ออฟฟิศ **พิมพ์เหตุผลเอง** (ระบบไม่เดา) — เกิดได้เฉพาะหลัง void discrepancy เพราะชิ้น live/pending ต้องเคลียร์ก่อน |
| `qty_stocked_total > qty_order` (เผื่อแล้วดีเกิน) | `needs_reason_over` | ออฟฟิศกด + `surplus_disposition='stock'` (0175 บังคับสำหรับ production) + `surplus_note` บังคับ (เดิม optional) |
| มีส่วนที่ `contractor_id` ยัง received | `blocked_external` | ปิดไม่ได้จนรับกลับ/ยกเลิกส่วน (ฉ5) |
| มี `job_discrepancy` open | `blocked_discrepancy` | ปิดไม่ได้จนชี้แจง (Q5) |

`job_tree_close(p_shop_id, p_root_job_id, p_reason text default null, p_surplus_note text default null, p_actor)` ✱ ออฟฟิศ (core เดียวกันถูก receipt เรียกเมื่อ `ready_auto`): ล็อกแม่ · ตรวจ `close_state` · ทุกส่วนที่ยังไม่ `done`: ปิด `pack` ที่ค้าง (เฉพาะส่วนที่ stocked ครบ) + `job_done` ส่วน · `job_done` แม่ (`qty_good = stocked ของแม่เอง, qty_scrap, qty_split_out`) · `shortfall_reason/surplus_*` · **ใบผลิต**: `set_config('analytics.po_close_via_receipts', id, true)` → `poi.qty_done = qty_stocked_total` · `poi.unit_cost = ค่าเฉลี่ยถ่วงน้ำหนักของ lot ทุกงวด` (ข้อมูลประกอบ — ต้นทุนจริงอยู่ที่ `stock_lot`/`production_receipt`) · `production_order.status='done'` + `closed_via='receipts'` · เพิกถอน token ทุกใบ · event `tree_close` · **ไม่เรียก `production_order_done`** · ใบที่ไม่เคยเข้างวด (stocked = 0) ⇒ raise "ใช้ปิดใบผลิตแบบเดิม" (เส้นเดิมไม่เปลี่ยน) · OEM: ปิดต้นไม้ได้เมื่อทุกส่วน done (ไม่มี receipt) — ของขาด/เหลือใช้ 0175 เดิม ประตูไว้ให้ J4

## 7. เปิดใบจากหน้างาน (W1 — รายละเอียดเท่าที่ phase แรกต้องใช้ · มติ Q6 · ก1–ก4 ข1–ข4 ค1–ค7)

### 7.1 ทางเข้าระดับร้าน (hub — X1/T3 · มติ Q6)
- route ใหม่ `app/(worker)/w/s/[shopToken]/…` · `shop_intake_token` เก็บ hash · QR ร้าน 1 จุด (ก3) พิมพ์/เปลี่ยนจาก `/jobs/workers` · เพิกถอน = ออกใหม่
- `shop_intake_resolve(p_token_hash, p_session_hash, p_ip_hash)` ✱: token ร้านถูก + session ช่างใช้ร่วม (`worker_session` ผูก worker ไม่ผูกใบ — cookie `path=/w` เดิมใช้ได้) · ไม่มี session ⇒ `identify` รายชื่อช่าง active **ทุกคน** + PIN (`worker_pin_verify` ต้องรับ token ร้านเป็นอีกทาง — เพิ่ม `p_intake_token_hash` หรือ wrapper ใหม่) · มี session ⇒ `{queue_allowed: true, open_allowed: worker.can_open_job}`
- hub 2 ปุ่ม: "คิวงานของฉัน" (L4) · "เปิดงานใหม่" (เฉพาะ `can_open_job` — ไม่มีสิทธิ์ = ข้อความ + จบ)
- ผ่อนกฎ "ไม่มีลิงก์" ของ `app/(worker)/layout.tsx` เฉพาะลิงก์ภายใน `/w/s/…` (ห้ามลิงก์ออกนอกแอปช่าง) + ปรับ allowlist `worker-boundary.test` · action ใหม่อยู่ใน `lib/actions/job-worker.ts` (module graph) · rate limit ช่องทางที่ **สร้าง** ข้อมูล (`job_rate_limit_hit` key ip/token · เพดานต่ำกว่า resolve)

### 7.2 เปิดใบ
- `job_worker_open(p_intake_token_hash, p_session_hash, p_idem_key, p_product_id uuid null, p_pending_label text null, p_metal text null, p_qty_order int, p_qty_planned int null, p_due_date date null, p_target_piece_g numeric null, p_is_new_design boolean, p_note text, p_user_agent, p_ip_hash)` ✱: `can_open_job` · **ทรานแซกชันเดียว**: INSERT `production_order` (`opened_via='shopfloor'` · `opened_by_worker_id` · `intake_idem_key = p_idem_key` unique ⇒ กดซ้ำ/เน็ตสะดุดได้ใบเดียว · `created_by` null — FK `auth.users` nullable อยู่แล้ว) → `production_order_item_set` เดิม (ถ้ามี SKU) หรือ INSERT item `product_id null + pending_product_label` (ค1 🔀) → `job_create_from_production_item` เดิม (`p_qty_planned` null = เท่าสั่ง · profile default ของร้าน · stage list จาก `job_stage_suggest` — ไม่มี SKU ⇒ ต้องรับ `p_metal` + list มาตรฐานตามแบบใหม่/ไม่ใหม่) → `job_token_issue` 1 ใบ (W-8 โชว์ครั้งเดียว) · event `intake_open` · response ไม่มีเงิน
- ค้นสินค้า: `job_product_search(p_intake_token_hash, p_session_hash, p_q)` ✱ คืน `sku, name, primary_image_path` เท่านั้น (ไม่มี cost/price) · ตัด `^live` · active
- **รับทราบ** `production_order_acknowledge(p_shop_id, p_id, p_actor)` ✱ · ป้าย/ตัวกรอง "ยังไม่รับทราบ" ใน `/production` + tile บอร์ด · เตือนเมื่อค้าง **3 วัน** (ข3) · ด่านปิดใบ (ทั้ง `production_order_done` และงวด): `opened_via='shopfloor' and acknowledged_at is null` ⇒ raise — ใน **trigger** เดียวกับ §5.4 (ไม่แก้ฟังก์ชัน 💰) + receipt_core เช็คเองให้ข้อความดี
- **ผูก SKU ทีหลัง** `production_order_item_bind_product(p_shop_id, p_item_id, p_product_id, p_actor)` ✱: item ยัง `product_id null` · ใบ open · SKU active ไม่ `^live` · unique `(order, product)` · อัปเดต `job.product_id/sku_snapshot` ของแม่+ทุกส่วน (guard ยกเว้นเฉพาะคู่คอลัมน์นี้เมื่อเดิม null) · event `edit` · ด่านปิดใบ: `exists item where product_id is null` ⇒ raise (trigger §5.4)
- **แก้หลังเริ่ม** (ข4 🔀): ที่ยอม = `due_date` (เดิม) · `design_label` (เดิม) · `is_new_design` (ใหม่ `production_order_item_set_new_design` — กระทบ NRE ⇒ ห้ามแก้หลังมีงวดแรก) · `qty_order` (ใหม่ `job_qty_order_set` + reason · เปลี่ยน `poi.qty_planned` พร้อมกัน · ห้ามต่ำกว่า stocked) · profile (เดิม — ก่อนเริ่ม) · `target_piece_g` (0175 `job_plan_set` — ก่อน cast รับ) · **`qty_planned` หลังเริ่ม = ไม่แก้ตัวเลขย้อนหลัง** → "ส่วนเพิ่ม" `job_tree_add_qty(p_root, p_qty, p_reason)` = ส่วนใหม่เริ่มขั้นแรก (`root.qty_planned += n` ภายใต้ guard ยกเว้นเฉพาะ RPC นี้) — phase W1b · ทุกการแก้ = event `edit` payload before/after (ประวัติบน OfficeAck/JobParent อ่านจาก `job_event`)
- ผู้เปิดแก้/ยกเลิกเอง (ก4): ได้จนออฟฟิศรับทราบหรือขั้นแรกถูกรับ → `job_worker_open_cancel(p_intake…, p_order_id)` (ยกเลิกใบผลิต+ใบงานพร้อมกัน เหตุผล 'intake_undo')

### 7.3 โครงที่ยังไม่ลงรายละเอียด (phase หลัง)
- **W2 รูป**: `job_photo` + bucket `job-photos` ตาม J1 §2.9 · `kind in ('reference','stage')` · เพดาน 5 reference / 20 รวม บังคับที่ trigger · ลบ GPS = re-encode ผ่าน canvas ใน `lib/catalog/image-client.ts` (EXIF หายโดยธรรมชาติ — เทสต์ด้วยไฟล์ที่มี GPS จริง) · รูปก่อนมีใบ: path `intake/<idem_key>/` แล้วผูกตอน `job_worker_open` (T7) · รูปหลักจาก SKU อัตโนมัติ (ซ4)
- **W3 พลอย = G1 ทั้งก้อน** (`design-job-plan-metal-gems.md` §2.4–2.5 + `gem_type.status pending|confirmed` + `merged_into`) · "รวมทั้งใบ" คำนวณใน DB (T6) · ไม่เปิดหน้างานก่อน G1
- **L4 มองเห็น**: `job_worker_queue(p_session_hash)` ✱ คืนงานที่ถือ + กำลังมา 1 ขั้น (จ3) ข้ามทุกใบ · action จากคิวต้องผ่าน token ใบ (สแกน) หรือ RPC ที่รับ `p_job_id` + ตรวจ scope ช่าง (กัน IDOR — T4) · ตัวนับ "วันนี้" 4 ตัว (จ2) · LINE เช้า **[ต้องยืนยัน ช่องทาง]**

## 8. มติ 18 ต.ค. "เผื่อของเสียไม่บังคับ ค่าเริ่มปิด" → แก้อะไร
- **DB (0175): ไม่แก้** — `job_create_from_production_item/quote_item` ใช้ `coalesce(p_qty_planned, qty_order)` อยู่แล้ว · `job_plan_suggest.qty_planned_suggest` ยังคืนคำแนะนำ (rate ว่าง = null ไม่เดา) · `under_planned` ป้ายเดิม
- **UI ฟอร์มออฟฟิศ M1** (`JobCreateDialog/Panel`): สวิตช์ "เผื่อของเสีย" ค่าเริ่ม **ปิด** ⇒ ส่ง `p_qty_planned = null` · เปิด ⇒ ช่อง "เผื่อเพิ่มกี่ชิ้น" ค่าเริ่ม = `suggest − qty_order` (ถ้ามี) + ป้าย "จาก reject rate หล่อ/ขัด/ชุบ · แค่คำแนะนำ" · ข้อความสรุป `qtyOrderPlannedText` ตัวเดียว (X6) · สเปกจอ: `ux-review-job-lots.md` §3
- **หน้างาน W-3**: ชุดเดียวกัน (`p_qty_planned` null เมื่อปิด) · **ออฟฟิศเพิ่มเผื่อหลังเริ่ม** = "ส่วนเพิ่ม" (§7.2) ไม่ใช่แก้ `qty_planned`

## 9. ลำดับ phase (ผลิตเข้าสต็อก · เสนอใหม่แทน W0–W4/L0–L5)

| phase | ขอบเขต | migration | ขนาด | QA | security | พึ่ง | UAT เจ้าของ |
|---|---|---|---|---|---|---|---|
| **P0 ปิดหนี้ก่อนเริ่ม** | merge `feature/job-m1-metal` + `feature/job-m1-ui` เข้า main (ไฟล์ 0175–0178 ที่ apply แล้ว + UI M1) · UI "เผื่อไม่บังคับ" (§8) · ตรวจ `production_cost_calc` ว่าแยก component (§5.3) · ยืนยัน `token_cap`/ชื่อผู้รับจ้าง/SLA/ช่อง LINE กับเจ้าของ | — (UI + เอกสาร) | S–M | M (ฟอร์มสร้างใบงาน + ใบ M1 เดิม) | ไม่ | — | ✅ ฟอร์มเผื่อ |
| **L1 ส่วนย่อยในร้าน + ส่วนต่างรอชี้แจง** | §1–§3: คอลัมน์/CHECK/index · `job_discrepancy` · RPC split/cancel/resolve · `job_worker_send/receive` ใหม่ · `job_worker_resolve` ต้นไม้ · `job_done`/`job_token_issue` ใหม่ · views · `/w/` จอ L-2/L-3/L-4 (+ชี้แจง) · หน้าใบแม่ (JobParent) · บอร์ด dominant stage + chip · ใบย่อย · รายการ QR + เพิกถอนรายตัว | **0181** + `verify-0181.sql` | **L** (DB ใหญ่ · UI 5 จอ → แตก L1a DB → security → L1b UI) | **L** (ทุก flow `/w/` · บอร์ด · print · `job_done` · ใบ J1 เดิมบน prod) | **บังคับ** (ช่างสร้างแถว `job` ครั้งแรก · ผ่อนโซ่จำนวนด้วย discrepancy · token หลายใบ) · ไม่ 💰 | P0 | ✅ แยกส่วน 1 ใบจริง + รับไม่ครบ 1 ครั้ง |
| **L3 เข้าสต็อกเป็นงวด 💰** | §5–§6: `production_receipt(+alloc)` · `stock_lot.production_receipt_id` · trigger กำแพง · `production_receipt_preview/create` · `job_worker_stock_in` · `job_tree_close` + auto · `v_ready_to_stock` · หน้า "เสร็จแล้ว รอส่ง" (แท็บ `JobsSubNav`) · จอ L-6 · ป้าย `close_state` | **0182** + verify | **L** | **💰** (= L + security ก่อน merge · เคส "ใบไม่เคยเข้างวด → `production_order_done` md5/ผลเท่าเดิมทุกใบ" · 3 lot ราคาต่างกัน · idempotency · ช่างไม่เห็นเงิน grep RSC) | **บังคับ** | L1 · §5.3 component (SKU spec ปิดไว้ถ้ายังไม่พร้อม) | ✅ เข้าสต็อก 2 งวดจริง 1 ใบ (SKU fixed/spot) |
| **L2 นอกร้าน** | §4: `job_contractor` · `contractor_id` · `can_external` · external_out/return_in/cancel · scrap code ใหม่ · ใบส่งของ + token `delivery_note` · `/jobs/contractors` · `external_overdue` | **0183** | M | M (flow ส่งออก/รับกลับ + ของเดิมที่ชุบในร้าน) | ใช่ (กดแทนคนนอก · สิทธิ์ `can_external`) | L1 | ✅ หลังกรอกทะเบียน [ต้องยืนยัน] |
| **W1 เปิดใบจากหน้างาน** | §7.1–7.2: hub + `shop_intake_token` · `can_open_job` · `job_worker_open` (+ไม่มี SKU) · ack · bind SKU · แก้หลังเริ่ม + event `edit` · W-1..W-3, W-6..W-8 · OfficeAck | **0184** | **L** | **L** (ใบผลิต + ใบงาน + middleware exempt `/w/s/`) | **บังคับ + 💰 ด่านปิดใบ** (ช่องสาธารณะ**สร้าง**ข้อมูล · trigger ack/SKU ติดเส้นปิดใบ) | L1 (ใบงานต้นไม้) · L3 ถ้าจะปิดเป็นงวด | ✅ |
| **L4 มองเห็น** | คิวงาน L-1 · ตัวนับวันนี้ · LINE เช้า [ต้องยืนยัน] | 0185 | M | M | ใช่ (list endpoint ช่าง · IDOR) | W1 (hub) | ✅ |
| **W2 รูป · W3 พลอย (G1) · W1b ส่วนเพิ่ม** | §7.3 | ถัดไป | M / L / S | M / L 💰 (ราคาพลอย) | ตาม phase | W1 | — |

**ทำไมลำดับนี้**: L1 คือแกน (ไม่มีส่วน = ไม่มีอะไรต่อ) · **L3 ก่อน L2** เพราะคำพูดเจ้าของ "ส่งงานเมื่อจบวัน" คือ L3 และ L2 มีค่า [ต้องยืนยัน] (ชื่อผู้รับจ้าง/SLA) ที่รอได้ — ระหว่างยังไม่มี L2 ขั้นชุบเดินแบบ J1 (ออฟฟิศรับแทนด้วย `assignee_name`) · W1 หลัง L1/L3 เพราะใบที่หน้างานเปิดต้องปิดด้วยเส้นทางงวด/ack ที่มีแล้ว · ทุก phase ส่ง UAT ได้เพราะใบเดิมไม่เปลี่ยนพฤติกรรม

## 10. เคสห้ามผ่าน / ต้องไม่พัง (L1 ครบ · L3/W1 หัวข้อหลัก) — verify ใช้ do-block + `raise` rollback · ข้อมูลทดสอบผ่าน RPC เท่านั้น · ปิดท้ายตารางแมป "ข้อในบรีฟ → เทสต์"

### 10.1 L1 — ห้ามผ่าน
| # | เคส | ด่าน |
|---|---|---|
| 1 | แยก `p_qty` ≤ 0 · ≥ ที่ถือ (ต้องเหลือ ≥ 1) · NaN · > 100000 · แยกจากขั้น pending/sent/skipped · แยกใบ done/cancelled/on_hold | `job_lot_split_core` + guard `qty_split_out + qty_scrap < qty_in` |
| 2 | ช่างที่ไม่ใช่ผู้ถือแยก/ส่ง · token ใบอื่น · `p_lot_job_id` นอกต้นไม้ของ token · ส่วน cancelled · session หมด/ช่างปิด | `not_holder` · `job_worker_auth` · ตรวจ `parent_job_id` |
| 3 | ส่ง `p_weight_out_g`/`metal_added`/`scrap_weight` มากับการแยก (ค1) | `weight_unexpected` |
| 4 | ของเสียตอนแยกไม่มีเหตุผล · เหตุผลล่องหน · เหตุผลโดยไม่มีของเสีย | ชุดเดิม `reason_required/unexpected` |
| 5 | 2 มือถือแยกส่วนเดียวพร้อมกัน · แยก + ส่งทั้งหมดพร้อมกัน | `for update` แม่ · ตัวหลังเห็น state ใหม่ → `stage_changed` (**ไม่มีเทสต์ใน do-block** — 2 connection · ระบุในตารางแมป) |
| 6 | UPDATE ตรง: `job.parent_job_id/lot_seq/qty_split_out` · `job_stage.qty_split_out` บนขั้นไม่ received · ลด `qty_split_out` นอก RPC ยกเลิก · `split_from_stage_id` บนขั้นที่ไม่ใช่ขั้นแยก · ส่วนชี้แม่ที่มีแม่ (2 ชั้น) · ส่วน source/metal ไม่ตรงแม่ · token ให้ส่วนย่อย · INSERT ส่วนที่ชน `lot_seq` | guard/CHECK/unique |
| 7 | auto-close ขั้นที่ `qty_split_out > 0` (ช่างถัดไปรับส่วนเดิมขณะผู้ถือยังค้าง) | `prev_not_sent` (resolve บอกก่อน + core_receive + trigger) |
| 8 | รับ `p_qty_received` = 0 · > ที่ส่ง · NaN · ขั้นแรกของใบส่ง `p_qty_received` | `qty_invalid` |
| 9 | ชี้แจง discrepancy โดยคนที่ไม่ใช่ผู้ส่ง/ไม่มี `can_external`/ไม่ใช่ออฟฟิศ · ชี้แจงซ้ำ · kind นอก scrap/lost · ไม่มีเหตุผล · UPDATE/DELETE แถว discrepancy ตรง | RPC + trigger |
| 10 | ช่างยกเลิกส่วนที่คนอื่นแยก · ส่วนที่ขั้นถัดไป received แล้ว · ส่วนที่มี discrepancy/alloc · ส่วนนอกร้านโดยไม่มี `can_external` (L2) · ออฟฟิศ `return_to_parent` เมื่อขั้นแม่ sent แล้ว · `scrap` ไม่มีเหตุผล | RPC |
| 11 | `job_done` แม่ขณะมีส่วน open/discrepancy open · `job_done` ส่วน `qty_good + qty_scrap` ไม่รวม `qty_split_out` · `job_cancel` แม่ที่มีส่วน · reopen/skip ขั้นที่แยกไปแล้ว | `parts_open` · `job_done_ck` · `has_split` |
| 12 | Σ ต้นไม้ไม่เท่า `qty_planned` แม่ หลังทุก RPC (mutant: ลด `qty_split_out` ตรงใน tx เดียว) | `job_tree_assert` + `v_job_tree_drift` ว่าง |
| 13 | `job_token_issue` purpose นอกชุด · `lot_job_id` นอกต้นไม้ · เกินเพดานใหม่ · revoke ค่าเริ่มผิด (ใบหลายส่วน + sublot ⇒ ต้องไม่เพิกถอน · ใบส่วนเดียว traveler ⇒ เพิกถอน) | RPC + assert จำนวน active |
| 14 | response `job_worker_resolve`/`send`/`receive`: มี key `cost*`/`price*`/`thb`/`unit_cost`/`customer*`/`quote_no` · ทอง `prev_weight_out_g` ไม่ null | `jsonb_path_exists` + ยิงหน้า `/w/<token>` จริง grep |
| 15 | anon/authenticated execute RPC ใหม่/อ่านตารางใหม่ (18.5) · overload: ทุกฟังก์ชันที่ drop/replace = 1 แถวใน `pg_proc` | `check-analytics-grants.sql` + assert |

### 10.2 L1 — ต้องไม่พัง (ยิงของใหม่ใส่ของเก่าจริง — ข้อ 17)
- ใบ J1/M1 ทุก status บน prod (อ่านด้วย `job_no`): หลัง apply `parent_job_id` null · `lot_seq 0` · `qty_split_out 0` · `v_job_board` แถวครบ + คอลัมน์ใหม่ค่าว่าง/0 · `job_worker_resolve` คืน `next_action/action_stage` **เท่าเดิมทุก key** (snapshot ก่อน/หลัง) · เทสต์ TS `worker-view`/`WorkerApp*` เดิมผ่าน
- ใบใหม่ที่ **ไม่แยกเลย**: รับ → ส่งทั้งหมดทุกขั้น → `job_done` → ผลเท่า J1 · `production_order_done` ของใบนั้นเท่าเดิม
- แยก 1 ครั้ง → ส่วนใหม่เดิน 3 ขั้น → แม่ส่งที่เหลือ → ทั้งคู่ถึง QC → `job_done` ส่วนแล้วแม่ (ไม่มีงวด — OEM path) ⇒ Σ ครบ · แยกซ้อน (ส่วนของส่วน ชี้แม่เดิม) · แยกที่ขั้น QC · แยกจากใบเดิม `profile_id null` · ช่างยกเลิกแยกแล้วส่งใหม่ · รับไม่ครบ → ชี้แจง scrap → Σ ครบ · ออฟฟิศ void แล้วผู้รับส่งต่อตามปกติ
- ใบย่อยพิมพ์ 3 ใบ ทุก QR เปิดใบเดียวกัน · เพิกถอน 1 ใบ ใบอื่นยังใช้ได้ · ปิด full เพิกถอนหมด
- 00:00–07:00 ไทย: `sent_on/received_on` ของขั้นแยก = วันไทย

### 10.3 L3 (💰) — หัวข้อที่ verify ต้องมี
ห้ามผ่าน: qty > ready · qty ≤ 0/NaN · ใบไม่ open · ยังไม่ ack (W1) · item ไม่มี SKU · SKU live/inactive · ราคาวันนี้ไม่มี (ไม่มี fallback) · `p_expected_spot` ว่าง/ไม่ตรงฝั่งออฟฟิศ · ช่างไม่มี qc/pack ใน `stage_codes` · idem_key เดิม qty ต่าง · SKU spec โดย component ยังไม่พร้อม · `production_order_done` บนใบที่มีงวด (trigger) · `job_tree_close` ใบที่ stocked = 0 · UPDATE/DELETE receipt · ลบ lot · response ช่างมีตัวเลขเงิน · anon/authenticated
ต้องไม่พัง: ใบไม่เคยเข้างวด → `production_order_done` **md5 เท่าเดิม + ผลเท่าเดิมทุกใบบน prod** (golden แบบ 0172 ส่วน 0) · 3 งวดราคาเงินต่างกัน = 3 lot · ครบพอดี ⇒ ปิดเองใน tx เดียวกัน · `v_stock_lot`/`v_dim_product` รวม lot ของงวด · idem replay คืนผลเดิมไม่สร้าง lot ซ้ำ · `adjust_stock` ledger key `por:` ไม่ชน `po:`

### 10.4 W1 — หัวข้อที่ verify ต้องมี
ห้ามผ่าน: token ร้านเพิกถอน/ปลอม · ช่างไม่มี `can_open_job` · idem_key ซ้ำ = ใบเดียว · ไม่มีทั้ง SKU และชื่อ · SKU live · ปิดใบ (done/งวด) ก่อน ack หรือก่อนผูก SKU · bind SKU ที่ซ้ำ/inactive/ใบปิด · แก้ `is_new_design` หลังมีงวด · `qty_order` ต่ำกว่า stocked · ช่างเรียก RPC ออฟฟิศ · path traversal `/w/s/`
ต้องไม่พัง: ใบที่ออฟฟิศเปิดเอง `opened_via='office'` ไม่ติดด่าน ack · `production_order_done` ใบออฟฟิศเดิมเท่าเดิม · เปิดใบไม่มี SKU → ผูก SKU → งวด → ปิด full ครบวงจร

## 11. มติเจ้าของ 18 ต.ค. · ตอบ ux-ui review · คำถามที่ยังต้องถาม

### 11.1 มติเจ้าของ 18 ต.ค. (Q1–Q7 ต่อคำถาม ux-ui) → อยู่ตรงไหนใน design
| Q | มติ | ที่ลง |
|---|---|---|
| Q1 | ช่าง QC **และ** แพ็ก กดเข้าสต็อกได้ · ด่าน = จำนวน ≤ ผ่าน QC − เข้าแล้ว | §5.2 `job_worker_stock_in` (สิทธิ์จาก `stage_codes` มี qc/pack · ไม่มี flag แยก) |
| Q2 | ดี + เสียที่บันทึก = เริ่มผลิต ⇒ ระบบเติมเหตุผล "ของเสียระหว่างผลิต n" · หายเกินนั้นพิมพ์เอง · ครบพอดีปิดเอง | §6 ตาราง `close_state` |
| Q3 | คนดูแลงานนอกร้านยกเลิกส่งออกได้ + เหตุผล (ติ๊กต่อคน) · ออฟฟิศเสมอ · ในร้านช่างยกเลิกได้จนคนรับกด | `worker.can_external` §2.3 · §4 · §1.1 |
| Q4 | ส่งออกกลางคืนได้ · ใบส่งของพิมพ์เช้าถัดไป · เซ็นย้อนหลัง | §4 · §1.2 (ฉ) token ออกตอนพิมพ์ |
| Q5 | รับไม่ครบ: รับได้ใส่จำนวนจริง · ขั้นก่อนต้องชี้แจง เสีย/หาย · ปิด full ไม่ได้ถ้ารอชี้แจง · บอร์ด/คิว | §1.3 `job_discrepancy` · §2.2 โซ่ · §3 receive/resolve · §6 `blocked_discrepancy` |
| Q6 | QR ร้านใบเดียว → PIN → คิวงาน / เปิดงาน (เฉพาะสิทธิ์) | §7.1 hub |
| Q7 | สเปค: ครั้งเดียว ÷ เริ่มผลิตทั้งใบ · แฟลสก์ ÷ จำนวนที่หล่อรอบนั้น · ไม่นับซ้ำ · ไม่แก้ `production_order_done` | §5.3 `cast_round_job_id` · receipt ต่อรอบ |

### 11.2 ตอบประเด็น ux-ui (X1–X7 · T1–T10 · ข้อ 1–8 จาก Tech Lead)
| ประเด็น | คำตอบ |
|---|---|
| 1 QR hash/โชว์ครั้งเดียว/พิมพ์ใหม่เพิกถอน | §1.2 — เลือก token ใหม่ของใบแม่ไม่เพิกถอน · ปฏิเสธเก็บ token เข้ารหัส · เพดาน [ต้องยืนยัน] |
| 2 ไม่มีทางเข้าระดับร้าน (X1/T3) | §7.1 hub `/w/s/<shopToken>` · session เดิม · ผ่อนกฎลิงก์เฉพาะใน hub |
| 3 บอร์ดคอลัมน์ vs การ์ดต่อใบ (X3) | §2.4 `dominant_stage_code` + chip · ไม่ทำ toggle ต่อส่วน |
| 4 ต้นทุนสเปคต่องวด | §5.3 ตามมติ Q7 · ปิดงวด SKU spec จน component พร้อม |
| 5 ใครกดเข้าสต็อก (T9) | มติ Q1 · ด่านที่ DB = จำนวน + `stage_codes` |
| 6 ปิด full เหตุผลอัตโนมัติ | มติ Q2 · §6 |
| 7 ยกเลิกส่วนนอกร้าน | มติ Q3 · `can_external` |
| 8 L-4 "ได้ไม่ครบ?" | มติ Q5 ทับข้อเสนอตัด → §1.3 (ปุ่มอยู่ · ไหลเข้า discrepancy) |
| X4 flag ของเสีย/ชั่งตาม profile | §1.1: ส่งน้อยกว่าที่ถือเปิดช่องของเสียเสมอ · ส่งทั้งหมดตาม flag · ไม่มีช่องชั่งตอนแยก |
| X5/X6/X7 เมนู/คำเรียก/StatusChip | เป็นเรื่อง UI — ตาม review · design นี้ไม่มี route/เมนูใหม่นอก `JobsSubNav` แท็บ "เสร็จแล้ว รอส่ง" · "ผู้รับจ้าง" |
| T5 ช่างไม่มี expectedSpot | §5.2 DB resolve เอง fail-closed · response ไม่มีเงิน |
| T7 รูป · T8 ไม่มี SKU · T10 น้ำหนัก | §7.3 · §7.2 · §1.1 (null = ไม่พิมพ์) |

### 11.3 คำถามเจ้าของที่ยังเหลือ (ถามได้ระหว่าง P0 · ไม่บล็อก L1)
| # | คำถาม | ตัวเลือก | แนะนำ |
|---|---|---|---|
| Q8 | เพดานจำนวน QR ที่ใช้งานพร้อมกันต่อใบ (เดิม 5) | ① 12 ② ไม่จำกัด ③ ค่าอื่น | ① — ใบที่แบ่ง 5–6 ส่วน + ใบส่งของ ยังพอ · ไม่จำกัดเสียกลไกกันพิมพ์สะเปะสะปะ |
| Q9 | ของเสียทำให้ค่าแบบ/ก้อนยางส่วนหนึ่ง "ไม่เข้าสต็อก" (หารด้วยเริ่มผลิต — Q7) ต่างจากปิดใบเดิมที่หารด้วยจำนวนดี — ยอมรับผลนี้ไหม | ① ยอมรับ (ต้นทุนของเสียเป็นค่าใช้จ่าย ไม่ไปบวกชิ้นดี) ② หารด้วย "ดีที่คาด" = `qty_order` | ① ตรงคำพูด Q7 · ② ทำให้ต้นทุนชิ้นดีสูงขึ้นเมื่อเผื่อมาก |
| Q10 | แฟลสก์หารด้วย "จำนวนที่หล่อรอบนั้น" = ชิ้นที่เข้าหล่อ (`cast.qty_in`) หรือชิ้นที่หล่อออกมาดี (`cast.qty_out`) | ① เข้า ② ออก | ① — แฟลสก์จ่ายต่อสิ่งที่ใส่เข้าไป |
| Q11 | ใบส่งของผู้รับจ้างมีรูป (ง7): สวิตช์ "ซ่อนรูป" ค่าเริ่มเปิดรูปสำหรับทุกใบ หรือปิดสำหรับ OEM | ① เปิดทุกใบ ② ปิดเฉพาะ OEM | ② — แบบลูกค้าออกนอกร้านควรเป็นการตัดสินใจรายใบ |
| Q12 | ช่วงที่ราคาเงินวันนี้ยังไม่มี (ก่อนรอบดึงราคาเช้า) ช่างกดเข้าสต็อกไม่ได้ — ยอมให้ของรอถึงเช้า หรืออยากให้ออฟฟิศกรอก override ได้จากมือถือ | ① รอ ② override | ① — override คือการตั้งราคาต้นทุน ต้องเป็นออฟฟิศบนหน้าใบผลิตเท่านั้น (กติกาเดิม 0131) |

### 11.4 มติเจ้าของ 18 ต.ค. (ตอบ ข1-ตีความ + Q8–Q12) — ทับข้อแนะนำใน 11.3
| # | มติ | ผลต่อ design |
|---|---|---|
| ข1 | ✅ ยอมรับการตีความ: ใบย่อย/ใบส่งของ = QR อีกใบของใบงานเดียวกัน (`job_token_issue(p_revoke_previous=false)`) สแกนแล้วเหมือนกันทุกอย่าง · พิมพ์ใหม่ไม่เพิกถอนของเก่า · ใบหายปิดเฉพาะใบนั้น | ตาม §1–§3 |
| Q8 🔀 | **คงเพดาน 5 QR ต่อใบ** (ไม่ใช่ 12) | ครบ 5 แล้วจะพิมพ์ใบใหม่ต้องเพิกถอนใบเก่าก่อน — UI ต้องบอกชัดว่าใบไหนยังใช้อยู่ + ให้เลือกเพิกถอน · ห้ามเพิกถอนอัตโนมัติเงียบ |
| Q9 💰 | ยอมรับ: ส่วนค่าแบบ/ก้อนยางที่ตกกับชิ้นเสียไม่เข้าสต็อก (หารด้วยเริ่มผลิต) · ใบที่ไม่แบ่งงวดคิดแบบเดิม | ตาม §5 |
| Q10 💰 | แฟลสก์หารด้วยชิ้นที่ **เข้า**หล่อรอบนั้น (`cast.qty_in`) | ตาม §5 |
| Q11 🔀 | **ไม่มีสวิตช์ซ่อนรูป** — ใบส่งของผู้รับจ้างโชว์รูปทุกใบ (รวม OEM) | ตัดสวิตช์ออกจาก L2 · ยังไม่มีชื่อลูกค้า/ราคาบนใบ |
| H2 🔀 (มติ 19 ต.ค.) | **ทองชั่งตอนแบ่ง** (security H2 — แยกแล้วทองออกจากขั้นชั่งโดยไม่มีน้ำหนัก = ช่องรั่ว): เฉพาะ `metal='gold'` และขั้นที่แยกตั้ง `weigh_required` (ตามแบบการบันทึก) → การแยก (ช่าง + ออฟฟิศ) **ต้องส่ง `p_weight_move_g`** (น้ำหนักส่วนที่แยกออก > 0 · ≤ 3 ทศนิยม · ต้องเหลือให้ผู้ถือ) · **ค1 ยกเว้นทองที่ขั้นชั่ง** (เงิน/ขั้นไม่ชั่ง = นับจำนวนอย่างเดียวเหมือนเดิม) | 0181: `job_stage.weight_split_out_g` (= Σ weight_out ของขั้นแยกของส่วนที่ชี้ขั้นนั้น — guard + `v_job_tree_drift.weight_link`) · ขั้นแยกของส่วนใหม่ `weigh_required` + weight_in = weight_out = น้ำหนักที่แยก ⇒ **ผู้รับขั้นถัดไปชั่งเทียบ ±0.05 g เหมือนส่งต่อปกติ** · ส่งต่อส่วนที่เหลือ: น้ำหนักออก ≤ เข้า + เติม − ที่แยกไป · `v_job_stage_loss` ขั้นที่แยกหักน้ำหนักที่แยกไป (ทอง = ไม่ null) · ยกเลิกส่วน (คืนชิ้น) คืนน้ำหนักให้ขั้นแม่ · RPC: `job_lot_split(..., p_weight_move_g)` · `job_worker_send(..., p_weight_move_g)` · TS `weightMoveG` |
| H1 (security) | รับไม่ครบไม่ปิดด่านทองเงียบ: เทียบน้ำหนักทุกครั้งที่ทั้งสองขั้นชั่ง · ทองรับครบ \|gap\| > 0.05 = ปฏิเสธ (เดิม) · **รับไม่ครบที่หนักกว่าที่ส่ง (gap > +0.05) = ปฏิเสธ** · gap บันทึกใน `job_discrepancy.weight_gap_g` · ผู้ส่งชี้แจงส่วนต่างทองที่มี gap เองไม่ได้ → `office_required` · `v_job_stage_loss.handoff_gap_partial_g` + `v_job_board.handoff_gap_partial_g` · ช่างไม่เห็น gap (N1) · M1: รับไม่ครบขณะขั้นก่อนยังไม่ส่ง = `prev_not_sent` · M3: `v_production_order_job_mismatch` รวมยอดดีทั้งต้นไม้ · L4: ออฟฟิศแยกต้องส่ง `p_qty_hold` | verify-0181 เคส T11–T15 · T21–T28 · T31 · T41 |
| Q12 🔀💰 | **ช่างกดเข้าสต็อกได้แม้ราคาเงินวันนี้ยังไม่เข้า · ระบบประทับราคาทีหลัง** | งวดเกิด lot ได้ทันทีด้วยจำนวน · ต้นทุนสถานะ "รอราคา" → ประทับด้วยราคาของ **วันที่งวดเข้า (เวลาไทย)** เมื่อราคาวันนั้นเข้า · **ห้าม fallback ราคาเมื่อวาน** (กติกาเดิม) · ถ้าราคาวันนั้นไม่เข้าเลย → ค้างให้ออฟฟิศจัดการ (ใส่ราคาเอง + เหตุผล) · รายงาน/margin ต้องไม่นับ lot รอราคาเป็นต้นทุน 0 · ต้องดูว่าการตัดสต็อก FIFO (ยังหลับ) จะเจอ lot รอราคาได้ไหม → เพิ่มใน security scope L3 |

## 12. ความเสี่ยง · หนี้ · ประตูที่เปิดไว้ · ไฟล์

**ความเสี่ยงตอน implement**
- R1 **def ต้นทาง**: 0175–0178 อยู่คนละ branch กับ main — เขียน 0181 บน main ก่อน merge = ลอก def ผิดฉบับ (ข้อ 21) → P0 บังคับ · verify เทียบ md5 ก่อน replace
- R2 **ผ่อนโซ่จำนวน** (discrepancy) + **ผ่อน `js_not_sent_ck`** (ของเสียก่อนส่ง) = 2 จุดที่ security เคยยืนยัน — ต้องมี mutant test ทุก CHECK (ข้อ 17)
- R3 **ช่างสร้างแถว `job`/`job_discrepancy`/`production_receipt`** เป็นครั้งแรก — ขอบเขตแคบด้วย token ต้นไม้ + holder + จำนวน ≤ ที่ถือ/ที่ผ่าน QC · rate limit เดิม
- R4 **`production_cost_calc` component** — ถ้าต้องเพิ่ม key = แตะฟังก์ชันที่ golden replay คุม → แยก migration + security ก่อน L3
- R5 **ON CONFLICT ของ `production_order_done` อ้าง `uq_stock_lot_production_order_item`** — ห้ามใครมา "รวม index" (จดไว้ในคอมเมนต์ migration)
- R6 **`production_order_done` บนใบที่มีงวด** ถอยด้วย trigger ตอนบรรทัดสุดท้าย — ทำงานถึง `adjust_stock` ก่อนถอย (ไม่มีผลค้าง แต่ advisory lock ถือระหว่างนั้น) · UI ซ่อนปุ่มลดโอกาส
- R7 **`job_worker_send/receive/token_issue` signature เปลี่ยน** — drop เดิม + caller TS อัปเดตพร้อมกัน (`lib/actions/job-worker.ts` · `lib/jobs/worker-server.ts`) · ตรวจ `pg_proc` 1 แถว
- R8 **auto-close ของ pack โดยงวด** — profile ที่สั่งชั่ง pack ⇒ งวดถูกปฏิเสธ · ต้องมีข้อความบอกทางออก
- R9 **บอร์ดเดิม (`JobBoard`) อ่าน `current_stage_code`** — ใบแม่ที่แยกต้องใช้ `dominant_stage_code` ไม่งั้นการ์ดอยู่ผิดคอลัมน์ (`current_stage_code` ของแม่ = ขั้นของส่วนหลักเท่านั้น)
- R10 **sales reconcile/FIFO consumption**: lot ของงวดเข้าสู่ `stock_lot` ด้วย contract เดียวกับ done — ไม่แตะ consumption · สถานะ "lot หลับ" (memory `stock-and-lot-costing-status`) ไม่เปลี่ยนเพราะงานนี้ · ⚠️ ต้องยืนยันก่อน UAT L3 ว่า `stock_sync_sales` ถูก wiring แล้วหรือยัง — ถ้ายัง ยอดสต็อกจากงวด "บวกอย่างเดียว" เหมือนใบ done วันนี้ (บอกเจ้าของตรงๆ)

**หนี้ที่รู้ตั้งแต่ design**: ไม่รวมส่วน (ก4) · `v_job_stage_loss` ขั้นที่แยก = ไม่เทียบ · `poi.unit_cost` หลังปิดด้วยงวด = ค่าเฉลี่ย (ต้นทุนจริงอยู่ที่ lot) · ส่วนเพิ่ม (W1b) ยังไม่มี = เพิ่มเผื่อหลังเริ่มไม่ได้ · ใบ OEM ใช้ส่วนได้แต่ไม่มีงวด/ส่งลูกค้า (J4) · `job_no` ของส่วนย่อยกิน seq (เลข JB ข้าม — ไม่ใช่เอกสารกฎหมาย) · ไม่มีเทสต์ 2 connection

**ประตูที่เปิดไว้ให้ OEM (ไม่ทำรอบนี้)**: ส่วนย่อยทำงานกับ `source_kind='oem'` ตั้งแต่ L1 (ไม่มีอะไรผูก production ยกเว้น receipt) · `oem_delivery` (J1 §2.8) เพิ่ม `lot_job_id` ได้ตรงๆ · `job_tree_close` ของ OEM = ทุกส่วน done (ไม่มี receipt) · `oem_invoice.kind='installment'` ยังเป็นประตูของ 0179 · **ห้าม**ให้ receipt ทำงานกับ OEM (ของลูกค้าไม่เข้าสต็อก — `job_done` 0175 บังคับอยู่แล้ว)

**ไฟล์ที่แตะ (คาด)**: `supabase/migrations/0181_job_lots.sql` · `0182_production_receipt.sql` · `0183_job_contractor.sql` · `0184_shopfloor_intake.sql` + `scripts/verify/verify-018x.sql` · `lib/jobs/worker-view.ts` · `worker-server.ts` · `lib/actions/job-worker.ts` · `job-office.ts` · `lib/jobs/print.ts` · `board.ts` · `components/domain/jobs/worker/*` · `components/domain/jobs/JobCard/JobBoard` · `app/(worker)/w/s/[shopToken]/*` · `app/(dashboard)/jobs/ready/` · `jobs/contractors/` · `lib/auth/exempt-path.ts` (prefix `/w/s/`) · `lib/production/types.ts` (map sqlstate)

# Design 0194 — เรียงขั้นใหม่ "แต่ง → ฝังพลอย → ขัด" (Yoda · 27 ต.ค. 69)

## มติเจ้าของ 27 ต.ค. 69
- ลำดับใหม่: ตัดต้น → แต่ง → **ฝังพลอย → ขัด** → ชุบ → QC → แพ็ก (ทับ "แต่ง→ขัด→ฝัง" ของ 0184)
- (ก) ใบค้างที่ยังไม่เริ่มทั้งขั้นขัดและขั้นฝัง → สลับตามลำดับใหม่ · ใบที่เริ่มขั้นใดแล้วเดินเดิมจนจบ
- (ข) ทุกแบบสินค้า ลำดับเดียวทั้งร้าน (ไม่ทำเลือกลำดับรายใบ)
- (ค) ขั้นขัดไม่ต้องชั่ง — สำหรับทองรอเจ้าของเลือก ค-1/ค-2 (ข้อ 3) · 0194 ทำ ค-1 (ไม่แตะ profile ทอง) · ถ้าเจ้าของเลือก ค-2 แยกเป็น 0195

## 0. ข้อเท็จจริงจาก DB สด 27 ต.ค.
- JB-0040 (in_progress · wax_tree sent · finish#4 buff#5 gem_set#6 pending ทั้งสาม) = ใบเดียวที่เข้าเงื่อนไขสลับ
- JB-0041 (finish/buff/gem_set sent หมดแล้ว ค้างที่ plating) = ไม่มีอะไรให้สลับ แต่**เป็นใบที่พังถ้าไม่แก้ guard** (ข้อ 2)
- unique (shop_id, seq_default) ว่างที่ 105 · ต้องย้าย buff 92 → 105 (ไม่ใช่ gem_set) · UPDATE จังหวะเดียว
- `weigh_default` ไม่มีใครอ่านแล้วนอกจาก `job_stage_def_ensure` (ตั้งแต่ 0176 ใบรับ flag จาก `job_record_profile_stage`) ⇒ buff weigh_default=false = แค่ seed ร้านใหม่
- ไม่มีใบทองที่มี gem_set บน prod (0 ใบ) · ใบเปิด JB-0034/0036 ยังเป็น `polish` (90 < gem_set 100) ไม่กระทบ
- `job_stage_seq_check` = seq 1..100 ⇒ ค่า temp ตอนสลับต้องอยู่ในช่วงนี้ (ใช้ 100)

## 1. ทะเบียน + ฟังก์ชัน
- `update analytics.job_stage_def set seq_default = 105, weigh_default = false where code='buff' and seq_default = 92` (guard ค่าเดิม ⇒ idempotent) — ไม่มี trigger บน job_stage_def
- `job_stage_def_ensure` ชุดใหม่: ลอก 0184 แก้บรรทัด `('buff','ขัด',105,'per_piece',null,false,true)` เรียง gem_set 100 ก่อน buff 105 · revoke 3 ชื่อ ไม่ grant ใคร (proacl เดิม `{postgres=X/postgres}` — เทียบก่อน/หลัง)
- **`job_source_info` ไม่ต้องแก้** — v_codes ผ่าน `job_sort_stage_codes` (order by seq_default) · `job_worker_open` (W1/W3) sort เหมือนกัน
- `job_validate_stage_codes` อ่าน seq_default สด ⇒ ใบใหม่ `[.., buff, gem_set, ..]` ถูกปฏิเสธ `stages_order` (ตั้งใจ)
- ไม่แตะ worker.stage_codes / rate OEM

## 2. ใบที่เปิดอยู่ — เส้นทางที่พัง และวิธีปิด
ด่านที่อ่าน seq_default มีจุดเดียว: `job_stage_guard` INSERT · เส้น UPDATE (รับ/ส่ง/ย้อน/skip/เปลี่ยนแบบ) ใช้ `job_stage.seq` ⇒ ใบเก่าเดินตามเดิมได้

| เส้นทาง | ใบเก่า buff ก่อน gem_set | ผล |
|---|---|---|
| รับ/ส่ง/ย้อน/ข้ามขั้น · `job_profile_apply` | UPDATE | ไม่พัง |
| แยกส่วนย่อย `job_lot_split_core` | loop INSERT ตาม `r.seq` ของใบแม่ → guard raise | 🔴 พัง |
| ได้รับเพิ่มแล้ว `job_discrepancy_arrive_core` | loop INSERT เดียวกัน | 🔴 พัง |
| เพิ่มขั้นให้ใบเดิม | ไม่มี RPC | — |

**แก้ใน `job_stage_guard`** (replace · ลอก def สดจาก `pg_get_functiondef` — ฉบับหลัง 0183 ~13,277 chars ไม่ใช่ 0176) เฉพาะบล็อก "ลำดับใน job ต้องไม่ขัดกับ seq_default":
```sql
if v_job.parent_job_id is null then
  -- ด่านทะเบียนเดิมเป๊ะ (ใบแม่)
elsif not exists (select 1 from analytics.job_stage ps
                   where ps.job_id = v_job.parent_job_id and ps.stage_code = new.stage_code and ps.seq = new.seq) then
  raise exception 'job_stage: ขั้นของส่วนย่อยต้องเป็นสำเนา (รหัส, ลำดับ) ของใบแม่' using errcode='22023', hint='split_link';
end if;
```
เหตุผล: ส่วนย่อย = สำเนาใบแม่ (split/arrive copy `r.seq` ตรงๆ) · ด่านใหม่แน่นกว่าเดิม · ไม่มี GUC bypass
ตัดทิ้ง: ข้ามด่านลำดับเมื่อเป็นส่วนย่อย (หลวม) · สลับ seq ของ JB-0041 (ขั้น sent แล้ว ประวัติเถียงกัน)

**สลับ seq ใบที่ยังไม่เริ่มทั้งสองขั้น** (เงื่อนไขทั่วไป ไม่ hardcode job_no):
- เงื่อนไข: ใบแม่ status in (open,in_progress,on_hold) · มี buff และ gem_set · ทั้งคู่ pending · `buff.seq + 1 = gem_set.seq` (ไม่ติดกัน = raise) · ใบไม่มีส่วนย่อย (มี = raise)
- guard ปฏิเสธ `new.seq <> old.seq` ⇒ ใน transaction เดียว: `alter table analytics.job_stage disable trigger trg_job_stage_guard` → 3 จังหวะกัน unique (job_id, seq): buff→100 · gem_set→(seq เดิมของ buff) · buff→(seq เดิมของ gem_set) · `updated_at = now()` เฉพาะ 2 แถว → `enable trigger` → post-check `tgenabled='O'`
- ไม่ปิด `trg_job_stage_sync` · ไม่เขียน job_event (CHECK บังคับ actor — เหตุผลเดียวกับ 0184 ข้อ 6)
- ปิดท้าย: md5 ของ job_stage ทุกแถว ยกเว้น 2 แถวที่ตั้งใจ (to_jsonb − seq − updated_at) + job/job_event เท่าเดิม ไม่งั้น raise
- 🔴 `disable trigger` = ACCESS EXCLUSIVE บน job_stage ตลอด transaction ⇒ ส่วนนี้รันนอกเวลางานเท่านั้น (เหมือน verify-0191)

## 3. น้ำหนัก
- เงิน: profile ที่ใบเงินใช้ (`แบบส่งงาน 3J` · `แบบ 1 ชั่งเฉพาะหล่อ`) ไม่ชั่ง buff อยู่แล้ว ⇒ (ค) สำหรับเงิน = แค่ seed · `handoff_gap` เทียบเฉพาะขั้นก่อนหน้าที่ไม่ skip และทั้งคู่ weigh_required ⇒ gem_set ไม่ชั่งคั่น = ไม่เตือนผิด
- ทอง (profile `ทอง — ชั่งทุกขั้นที่มีโลหะ` buff:W · gold_unguarded = ป้ายเตือน ไม่บล็อก):

| ทาง | ทำอะไร | ทองที่หายตอนขัดไปโผล่ไหน | trade-off |
|---|---|---|---|
| ค-1 (แนะนำ) | registry weigh_default=false · ไม่แตะ profile ทอง | buff.in − buff.out (พลอยหักกันเอง) · handoff gem_set.out ↔ buff.in เทียบ ±0.05 | กฎทอง J1 ไม่ถูกแตะ |
| ค-2 | `job_record_profile_stage.weigh=false` ที่ buff ทุกแบบ + นิยาม gold_unguarded ใหม่ 3 ที่ (`job_profile_state` · `job_create_insert` · `v_job_board`) + TS `goldUnguardedStages()` | หายเงียบระดับขั้น เห็นแค่ยอดรวมใบตอน job_done | กลับมติ J1 ⇒ เจ้าของต้องยืนยัน · แยก 0195 |

**หนี้ (ไม่ใช่ของ 0194):** ใบทอง + gem_set ชั่ง ⇒ weight_out (รวมพลอย) > weight_in ชน `js_weight_ck`/`weight_over` ใน `job_core_send` — ยังไม่เกิด (0 ใบ) แต่ใบทองมีพลอยใบแรกจะติด

## 4. ผลกับ 0192/0193 · ลำดับ apply
- 0192 ตัดสินจาก status ของ gem_set ไม่ใช่ seq ⇒ ไม่กระทบ · ไม่ replace ฟังก์ชันเดียวกัน · 0193 ไม่แตะ jobs
- แต่ `verify-0192.std()` = `{..,finish,buff,qc,pack}` (+gem_set ต่อท้าย) → FAIL ถ้า 0194 ลงก่อน ⇒ **ลำดับ 0192 → 0193 → 0194**
- หนี้: verify-0172..0191 ที่ใช้ buff ก่อน gem_set รันซ้ำไม่ได้หลัง 0194

## 5. เคส verify-0194
ห้ามผ่าน:
1. สร้างใบใหม่ `[..,finish,buff,gem_set,..]` → `stages_order` · INSERT ใบแม่ buff(n) แล้ว gem_set(n+1) → trigger raise
2. ส่วนย่อยที่ (stage_code, seq) ไม่ตรงใบแม่ → `split_link`
3. ใบที่ขั้นใดไม่ pending → ไม่ถูกสลับ (md5 เท่าเดิม)
4. buff/gem_set ไม่ติดกัน หรือมีส่วนย่อย → block สลับ raise (mutant)
5. ensure ซ้ำ → แถวไม่เพิ่ม · รัน 2 รอบ รอบสองไม่เปลี่ยนอะไร
6. ทอง (ค-1): รับ buff โดยไม่ชั่ง → `weight_required` · buff.in ต่าง gem_set.out > 0.05 → `handoff_mismatch`

ต้องไม่พัง:
7. ใบ polish เดินถึง done · แยกส่วนย่อยจากใบ polish
8. ใบเก่า buff→gem_set ผ่านแล้ว (แบบ JB-0041): รับ plating · reopen · แยกส่วนที่ plating · arrive ส่วนต่าง
9. ใบที่สลับแล้ว (แบบ JB-0040): เดิน cast → finish → gem_set → buff → plating ครบ · แยกส่วนที่ gem_set · drift=false · `job_tree_dominant_stage` ไม่ error
10. ใบไม่มีขั้นฝัง: suggested `..finish,buff,qc,pack` · `v_gem_purchase_job` ไม่เห็น
11. suggested ใหม่ (OEM gem_count>0 · production มี BOM · W1 `p_gem_answer='has'`) = `finish, gem_set, buff, ...` · job_profile_apply บนใบใหม่ได้ flag ตามแบบ
12. ACL/overload: signature อย่างละ 1 · proacl เท่าเดิม · `check-analytics-grants.sql` ผ่าน · md5 ฟังก์ชันอื่นเท่าเดิม
13. `trg_job_stage_guard` กลับมา enabled

ไม่มีเทสต์ครอบ: "ไม่แตะแถวอื่น" ของการสลับ (ครอบด้วยด่านท้ายไฟล์) · race 2 connection

## 6. TS + QA
- ไม่มี TS hardcode ลำดับ (เรียงจาก seq_default/job_stage.seq)
- `lib/oem/display.ts:81` `DEPT_ORDER` สลับ "ขัด","ฝังพลอย" ให้ตรงหน้างาน (cosmetic)
- QA = L (แตะ `job_stage_guard` ด่านกลางทุก flow) · security แนะนำดู diff guard + disable trigger


---

# ภาค 0195 — "ทองไม่บังคับชั่งขั้นขัด" (ต่อจาก 0194 · design ต้นฉบับ Yoda 27 ต.ค. 69)

> มติเจ้าของ 27 ต.ค. 69: ใบทองก็ไม่ชั่งขั้นขัด (เลือก ค-2 ทาง A) · Tech Lead ตัดสินข้อเปิด: rename แบบทองเอา · def ที่ 0194 replace ลอกจากไฟล์ 0194 · ตัวอื่นลอกสดจาก DB + md5 pre-check
> ส่วนที่ทำต่างจาก design (Han): (1) UPDATE แบบบันทึกจำกัดเฉพาะแบบทองปริยาย (is_default_gold) ไม่ใช่ทุกแบบที่ buff ชั่ง (2) TS ใช้ field เป็น optional + key มีเฉพาะเมื่อ true (ไม่ต้องแก้ fixture 20+ ไฟล์) · mapStageRow รับ record หรือ boolean (3) เพิ่มป้ายสรุปแบบ "ทุกขั้นที่มีโลหะ (ยกเว้นขัด)" ใน ProfileSummary

# Design 0195 — "ทองไม่บังคับชั่งขั้นขัด" (ต่อจาก 0194 ใน branch เดียวกัน)

## ข้อเท็จจริงที่ตัดสินใจบนนั้น (DB สด 27 ต.ค.)

- **ใบทองที่เปิดอยู่ = 0 ใบ** (ทอง 2 ใบ cancelled) ⇒ คำถาม "ใบทองค้างควรได้ค่าใหม่ไหม" ไม่มีของให้ตัดสิน — เขียนกติกาไว้เฉยๆ ไม่ backfill
- แถว `job_record_profile_stage` ของ buff มี 3 แถว: `ทอง — ชั่งทุกขั้นที่มีโลหะ + ชั่งสุทธิตอนปิด` (active · is_default_gold · **weigh=true** ← แถวเดียวที่ต้องแก้) · `QA-M1C-เศษ` (inactive · weigh=false) · `แบบส่งงาน 3J` (weigh=false)
- `gold_unguarded` คำนวณ 2 ที่ (`job_profile_state` · `v_job_board` — นิพจน์ซ้ำกัน) · `job_create_insert` แค่ส่งต่อค่าจาก `job_profile_apply` ⇒ **ไม่ต้องแก้** (brief บอก 3 ที่ — ของจริง 2 ที่ DB + 1 ที่ TS)
- ป้ายทองเป็น **เตือนอย่างเดียว** (บอร์ด `goldUnguarded` rank 9 · การ์ดแบบ · ProfileEditor) ไม่มี RPC ไหนบล็อกจากมัน ⇒ 0195 ไม่เปลี่ยนด่านรับ/ส่ง/ปิดงาน
- `job_record_profile_ensure` seed แบบทองร้านใหม่ด้วย `weigh = d.metal_present` ⇒ ร้านใหม่จะได้ buff:W อีก ถ้าไม่แก้

## 1. กลไก — เลือก **คอลัมน์ใหม่ `job_stage_def.gold_weigh_exempt boolean not null default false`**

นิยามใหม่ (ทั้ง DB และ TS ต้องตรงกันคำต่อคำ):
> gold_unguarded = ใบทองยังไม่ปิด ∧ มีขั้นที่ `metal_present ∧ not gold_weigh_exempt ∧ not weigh_required ∧ status <> 'skipped'`

| ทาง | ทำไม / trade-off |
|---|---|
| **A. คอลัมน์ใหม่ `gold_weigh_exempt` (default false)** — แนะนำ | ความหมายตรงมติ ("ขั้นที่ทองไม่บังคับชั่ง") · default false = ทุกขั้นเดิม (gem_set/plating/qc/pack) **เข้มเท่าเดิมโดยไม่ต้องทำอะไร** · ขั้นใหม่ในอนาคตเข้มโดยค่าเริ่ม · เปิด/ปิดได้ต่อร้านโดยไม่ต้อง migrate ซ้ำ (ยังไม่มี UI ตั้ง — ตั้งใจ ดูหนี้) · ราคา: 1 คอลัมน์ + ส่ง key เพิ่มใน 2 RPC ที่คืน stage_defs |
| B. hardcode `stage_code <> 'buff'` 3 ที่ | ถูกวันนี้ แต่กติกาธุรกิจซ่อนในโค้ด 3 สำเนา · ถ้าเจ้าของเปลี่ยนใจหรือเพิ่มขั้น "ขัดละเอียด" ต้องไล่แก้ทุกที่ · TS ต้อง hardcode ซ้ำ — ตัดทิ้ง |
| C. รีไซเคิล `weigh_default` (= "ขั้นที่ทองต้องชั่ง") | ทำให้ gem_set/plating/qc/pack (weigh_default=false) หลุดกฎทองทันที — ตรงที่ brief ห้าม · ตัดทิ้ง |
| D. ย้ายกฎไปที่ profile (ทองไม่มีกฎกลาง ป้ายดูจาก is_default_gold) | ป้ายไร้ความหมายเพราะแบบทองคือคนตั้งเอง · เสียด่านเตือน "ลืมติ๊กชั่ง" — ตัดทิ้ง |

**ไม่ใส่ CHECK** `gold_weigh_exempt → metal_present` — ขั้นที่ไม่มีโลหะไม่เข้านิพจน์อยู่แล้ว ใส่ CHECK เพิ่มความเสี่ยงข้อ 14 (`on conflict` ของ ensure) โดยไม่ได้อะไร

## 2. จุดที่ต้องแก้ (ลอก def สดจาก DB **หลัง 0194 apply** — 0194 replace `job_stage_def_ensure`/`job_stage_guard` ก่อน · pre-check md5 ทุกตัวที่ replace)

**DB (ไฟล์ `supabase/migrations/0195_gold_weigh_exempt_buff.sql` · LF · ไม่มี grant ให้ anon/authenticated)**

| # | object | แก้อะไร |
|---|---|---|
| 1 | `alter table analytics.job_stage_def add column if not exists gold_weigh_exempt boolean not null default false` | ไม่มี trigger บนตาราง (ตรวจแล้ว) · `update ... set gold_weigh_exempt = true where code = 'buff' and not gold_weigh_exempt` (แคบ · idempotent) |
| 2 | `job_stage_def_ensure(uuid)` | ลอกฉบับ 0194 · เพิ่มคอลัมน์ใน insert list + values: buff = true ที่เหลือ false · `on conflict do nothing` ⇒ ร้านเดิมไม่ขยับ · revoke 3 ชื่อ ไม่ grant |
| 3 | `job_profile_state(uuid)` (SQL stable) | นิพจน์ `gold_unguarded`: `d.metal_present and not d.gold_weigh_exempt and not s.weigh_required and s.status <> 'skipped'` · re-grant ตาม proacl เดิม |
| 4 | `v_job_board` | `create or replace view` — เปลี่ยนเฉพาะนิพจน์ใน subquery `pw.unguarded` (`bool_or(d2.metal_present and not d2.gold_weigh_exempt and ...)`) · **คอลัมน์ 56 ตัวลำดับเดิมเป๊ะ** (ตรวจ `information_schema.columns` ก่อน/หลัง = เท่ากัน — ข้อ 3) · ลอก viewdef สดทั้งก้อน แก้บรรทัดเดียว |
| 5 | `job_stage_suggest` · `job_record_profile_list` | เพิ่ม key `'gold_weigh_exempt', d.gold_weigh_exempt` ใน `stage_defs`/`stages` (additive · PostgREST ไม่สน) · security definer เดิม · re-grant service_role |
| 6 | `job_record_profile_ensure` | seed แบบทอง: `d.metal_present and not d.gold_weigh_exempt` (ร้านใหม่สอดคล้องกฎ) |
| 7 | `update analytics.job_record_profile_stage set weigh = false where stage_code = 'buff' and weigh` | ข้อ 3 ด้านล่าง |

ไม่แตะ: `job_create_insert` (forward) · `job_record_profile_upsert`/`_stage_guard` (ตรวจ metal_present เท่านั้น — ติ๊กชั่ง buff ให้ทองยัง**ทำได้**ถ้าอยาก = ถูกต้อง exempt ≠ ห้าม) · `job_core_*`/`job_done` (ไม่อ่าน gold_unguarded) · `job_profile_json`

**TS**

| ไฟล์ | แก้ |
|---|---|
| `lib/jobs/profile-summary.ts` | `GuardStage` + `goldWeighExempt: boolean` · `goldUnguardedStages`: `s.metalPresent && !s.goldWeighExempt && !s.weigh && !s.skipped` · `PickerStage` + `goldWeighExempt` · `analyzePicker` ส่งต่อ |
| `lib/jobs/profile.ts:78` (`StageDef` map จาก `job_record_profile_list.stage_defs`) | + `goldWeighExempt: bool(r.gold_weigh_exempt)` (ไม่มี key = false — เข้มไว้ก่อน) |
| `lib/actions/job-office.ts:217` (`job_stage_suggest.stages`) | + `goldWeighExempt: o.gold_weigh_exempt === true` |
| `lib/actions/job-office.ts:101-114` + `lib/jobs/types.ts:230-245` (`mapStageRow` ของหน้า /jobs/[id]) | select เพิ่ม `gold_weigh_exempt` · ส่ง map ที่สอง หรือเปลี่ยน `metalPresent` map เป็น record `{metalPresent, goldWeighExempt}` — เลือกแบบหลัง (ชนิดเดียว ไม่เพิ่มพารามิเตอร์ตำแหน่ง) |
| ผู้เรียก: `ProfileEditor.tsx:97` · `JobProfileCard.tsx:24` · `ChangeProfileDialog.tsx:57` · `JobCreateDialog.tsx:102` | ส่ง `goldWeighExempt` เข้า picker/guard |
| `lib/jobs/board.ts` | ไม่แก้ — อ่าน `gold_unguarded` จาก view |
| tests: `lib/jobs/profile.test.ts` · `profile-summary` (ถ้ามี) · `JobProfileCard.test.tsx` · `ProfilesPage.test.tsx` · `JobCreateProfile.test.tsx` · `board.*.test.ts` fixtures (+field) | เพิ่มเคส: buff exempt ไม่ติดป้าย · gem_set ไม่ exempt ติดป้าย · key หาย = false |

ลำดับ deploy: apply 0195 → merge TS (TS เก่าอ่าน key ใหม่ไม่ได้ = ไม่พัง แค่ป้ายฝั่ง client ยังเข้มกว่า DB ชั่วคราว — ยอมรับได้)

## 3. UPDATE แถวแบบ + ใบที่สร้างแล้ว

- `update job_record_profile_stage set weigh=false where stage_code='buff' and weigh` → โดน **1 แถว** (แบบทอง active) · QA-M1C/แบบส่งงาน 3J เป็น false อยู่แล้วไม่ถูกแตะ (WHERE แคบตามข้อ 19) · trigger บนตารางนี้ = `_stage_guard` (ผ่าน) + deny_truncate · **ไม่ UPDATE `job_record_profile`** ⇒ `updated_at` ของแบบไม่ขยับ
- ชื่อแบบ `ทอง — ชั่งทุกขั้นที่มีโลหะ + ชั่งสุทธิตอนปิด` จะโกหกหลัง 0195 — เสนอ rename เป็น `ทอง — ชั่งทุกขั้นที่มีโลหะ (ยกเว้นขัด) + ชั่งสุทธิตอนปิด` + แก้ note · `job_record_profile_guard` ตั้ง `updated_at=now()` (ถูกต้อง: แก้จริง) · `job.profile_name` ของ 2 ใบ cancelled เป็น snapshot ไม่เปลี่ยน (ตั้งใจ) · ถ้า Tech Lead ไม่อยากแตะ header ให้ตัดข้อนี้ — แต่ต้องบอกเจ้าของว่าชื่อไม่ตรงพฤติกรรม
- ใบที่สร้างแล้ว: **ไม่ backfill** `job_stage.weigh_required` — flag เป็น snapshot ตอนสร้าง (0176 หนี้ (9) ตั้งใจ) และ guard ห้ามเปลี่ยนหลังขั้นแรกถูกรับ · ตอนนี้ไม่มีใบทองเปิด ⇒ ไม่มีผล · กติกาถ้ามีในอนาคต: ใบที่ยังไม่เริ่ม → ออฟฟิศกด "เปลี่ยนแบบ" (`job_profile_set`) เอง · ใบที่เริ่มแล้ว → เดินตาม flag เดิม (ชั่ง buff ต่อ — ไม่เสียหาย)
- post-check ในไฟล์: `job_stage`/`job`/`job_event` md5 เท่าเดิม · `job_record_profile_stage` เปลี่ยนเฉพาะแถว (profile ทอง, buff) · ไม่มีแถว `gold_weigh_exempt=true` นอกจาก buff · ทุกร้านมี buff exempt · overload = 1 ต่อฟังก์ชัน · proacl เท่าเดิม · คอลัมน์ `v_job_board` 56 ลำดับเดิม

## 4. verify-0195 · QA · security

**ห้ามผ่าน**
1. ใบทอง (แบบทองหลัง 0195) ขั้น **gem_set/plating/qc/pack** ไม่ติ๊กชั่ง → `gold_unguarded=true` ทั้ง `job_profile_state` และ `v_job_board` (mutant: ตั้ง exempt=true ที่ gem_set → เทสต์ต้องจับ)
2. แบบทองใหม่ผ่าน `job_record_profile_upsert` ที่ไม่ติ๊ก cast → ติดป้าย (กฎเดิมไม่หลวม)
3. `gold_weigh_exempt=true` แต่ `metal_present=false` → ไม่กระทบนิพจน์ (ไม่ติดป้ายเพราะไม่มีโลหะอยู่แล้ว) — assert ว่า exempt ไม่ทำให้ `job_record_profile_stage_guard` ยอมรับ weigh บนขั้นไม่มีโลหะ (`flag_not_applicable` ยังเกิด)
4. `job_stage_def_ensure` ร้านใหม่: buff exempt · อื่น false · เรียกซ้ำไม่เพิ่ม/ไม่ขยับ · `job_record_profile_ensure` ร้านใหม่: แบบทอง buff weigh=false ที่เหลือ metal_present
5. รัน migration 2 รอบ → รอบสองไม่แตะอะไร (md5 ตารางทั้งหมดเท่าเดิม)

**ต้องไม่พัง**
6. ใบทองใหม่จากแบบทอง: `job_stage.buff.weigh_required=false` · `gold_unguarded=false` · `has_weigh=true` · `job_done` ยังบังคับ `weight_final_g` (ทอง+มีขั้นชั่ง) · เดิน finish(W) → gem_set(W) → buff(-) → plating(W): รับ plating **ไม่เทียบ** น้ำหนักกับ buff (prev ไม่ชั่ง) · `v_job_stage_loss.buff.not_weighed=true`
7. ใบทองที่สร้าง**ก่อน** 0195 ใน transaction (buff weigh=true) หลัง apply: ชั่ง buff ได้ต่อ · `gold_unguarded=false` · เปลี่ยนแบบก่อนเริ่ม → buff กลายเป็นไม่ชั่ง
8. ใบเงิน (แบบส่งงาน 3J / แบบ 1) ทุก status ที่มีจริง: `gold_unguarded=false` เหมือนเดิม · บอร์ดเปิดได้ · `job_stage_suggest`/`job_record_profile_list` คืน key ใหม่ครบทุกขั้น
9. ใบทองเก่า profile_id null (ถ้ามี — ตอนนี้ไม่มี) ไม่ error

ไม่มีเทสต์ครอบ: ฝั่ง TS ป้ายบน ProfileEditor/JobCreateDialog = vitest ไม่ใช่ verify · race

**QA = M** (flow: ฟอร์มสร้างใบ (picker ทอง) · หน้าแบบการบันทึก · การ์ดแบบใน /jobs/[id] · บอร์ดป้ายทอง + ข้างเคียง: สร้าง/รับ/ส่งใบทอง 1 ใบผ่าน buff) — ไม่ L เพราะไม่แตะ guard/receive/send · **security: ไม่บังคับ** (ไม่มีเงิน/ภาษี/สิทธิ์ · ป้ายเตือนอย่างเดียว · RPC ที่ replace เป็น security definer เดิมแค่เพิ่ม key — ให้ code-reviewer ดู grant ก็พอ) · **แต่เป็นงานที่ผ่อนด่านน้ำหนักทอง = มูลค่า** ⇒ ถ้า Tech Lead อยากให้ security ตรวจ 15 นาทีเฉพาะ "exempt หลุดไปขั้นอื่นได้ไหม" ก็คุ้ม

## ความเสี่ยง / สิ่งที่คิดว่าควรบอก

1. **ทองที่หายตอนขัดจะเห็นที่เดียว**: `weight_start_g − weight_final_g` ตอน `job_done` (ยอดรวมใบ ไม่รู้ว่าหายขั้นไหน) + แถว buff `not_weighed` ใน v_job_stage_loss — ตรงที่เจ้าของรับแล้ว · ป้าย `gold_unguarded` จะ**ไม่**เตือนเรื่องนี้อีก (ตั้งใจ)
2. หนี้: ไม่มี UI ตั้ง `gold_weigh_exempt` — เปลี่ยนต้องผ่าน migration (ยอมรับ: มติระดับร้าน ไม่ใช่ของตั้งรายวัน) · จดใน design-job-tracking.md §2.1 คอลัมน์ใหม่
3. ถ้า 0194 ของ Han ยังไม่ fix ชื่อ/seed ตามที่ออกแบบ (buff 105 · weigh_default=false) ให้ 0195 ลอกจาก DB หลัง 0194 apply จริง ไม่ลอกจากไฟล์ 0194 ใน branch
4. ข้อเสนอ rename แบบทอง (ข้อ 3) อยู่นอก brief — ถ้าไม่เอาบอกตรงๆ ไม่ต้องเดา

ไฟล์ที่เกี่ยว: `supabase/migrations/0176_job_record_profile.sql` (ที่มา gold_unguarded · ห้ามลอก def จากนี่) · `lib/jobs/profile-summary.ts` · `lib/jobs/profile.ts` · `lib/actions/job-office.ts` · `lib/jobs/types.ts` · `components/domain/jobs/{ProfileEditor,JobProfileCard,ChangeProfileDialog,JobCreateDialog}.tsx`

---

# รอบแก้หลัง security (Mace) + QA (R2) — 27 ต.ค. 69

- **M1** `getJobDetail` อ่านทะเบียนขั้นแบบ `select *` (ไม่ระบุ `gold_weigh_exempt`) — merge TS ก่อน/หลัง apply 0195 ไม่พัง (แถวไม่มี key = ไม่ exempt)
- **M2 (Tech Lead ตัดสิน)** ของเสียทองที่ออกจากระบบต้องมีน้ำหนักเสมอ: `job_lot_cancel_core` (ใน 0195) บังคับชั่งเมื่อ "ส่วนถือโลหะแล้ว" (มีขั้น received/sent ที่ metal_present) แทนการผูกกับ weigh_required ของขั้น · เพดานน้ำหนักของส่วนที่ไม่เคยชั่งใช้น้ำหนักสูงสุดของใบแม่ · ส่วนที่แยกก่อนถึงขั้นมีโลหะยังยกเลิกเป็นของเสียโดยไม่ชั่งได้ (ไม่มีทองให้ชั่ง) · TS: `LotPart.holdsMetal` + ช่องน้ำหนักในกล่องยกเลิกส่วน · split weight_move / arrive ไม่เปลี่ยน (ไม่ใช่ของเสีย) · **ช่องเดิมที่ไม่ใช่ของงานนี้:** ของเสียตอนแยกส่วน (นับชิ้นเสีย) ไม่รับน้ำหนักทุกขั้น (มติ ค1 ของ 0181)
- **L1** PART B ของ 0194: ใบที่มี job_discrepancy (ไม่ void) ชี้ขั้น buff/gem_set -> raise ไม่สลับ
- **L2** pre-check 0195: มีแบบอื่นใช้ชื่อใหม่ของแบบทองปริยาย (ไม่สนตัวพิมพ์) -> raise ก่อนแตะอะไร
- **CRLF** เทียบ md5 ของนิยามฟังก์ชัน/วิวใน 0194/0195/verify แบบตัด \r ทุกจุด · mutant ตัด \r ก่อนแทนข้อความ · หัวไฟล์สั่ง apply จากสำเนา LF (ข้อ 20 ของ 3j-migration-traps)


---

# รอบแก้ 3 (C-3PO + security D-M1) — 27 ต.ค. 69

- **เพดานน้ำหนักของเสีย (Tech Lead ตัดสิน)**: ส่วนที่ไม่เคยชั่งใช้ "สัดส่วนชิ้น" = max(น้ำหนักเข้า+เติม หรือน้ำหนักออก ÷ qty_in) ของขั้นในใบแม่ (qty_in > 0) × จำนวนชิ้นของส่วน · ไม่บล็อกเคสถูก (เฉลี่ยต่อชิ้นรวมก้านต้น ≥ ชิ้นจริง) · ตัดเคสพิมพ์ผิดหลัก (30 แทน 3) · ไม่ใช้แบบ "ขั้นชั่งล่าสุด" ของ security เพราะค่าเฉลี่ยต่อชิ้นอาจต่ำกว่าชิ้นที่หนักกว่าค่าเฉลี่ยแล้วบล็อกของจริง · ใบแม่ไม่มีน้ำหนักเลย = ไม่มีเพดาน (ไม่มียอดรวมให้เทียบ)

## หนี้ที่รู้ตัว (ไม่แก้ในรอบนี้)
1. view drift `cancel_weight` (0183:842-848) ยังใช้นิยามเก่า (ขั้นชั่งที่ชั่งแล้ว) — ไม่เตือนส่วนทองที่ยกเลิกเป็นของเสียโดยไม่มีน้ำหนักจากเส้นทางเก่า · RPC ใหม่กันที่ต้นทางแล้ว
2. `getJobDetail` อ่านทะเบียนขั้นด้วย `select("*")` (M1) — กลับเป็นรายชื่อคอลัมน์ (รวม gold_weigh_exempt) หลัง 0195 ลง prod แล้ว
3. ตัวแปลง stage -> { code, nameTh, metalPresent, goldWeighExempt } ซ้ำ 4 component (ProfileEditor · JobProfileCard · ChangeProfileDialog · JobCreateDialog) — ควรรวมเป็นฟังก์ชันเดียว
4. ลำดับ merge/apply: 0192 -> 0193 -> 0194 -> 0195 · branch นี้ห้าม merge ก่อน g1b / ring-size
5. ของเสียตอนแยกส่วน (นับชิ้นเสีย p_qty_scrap) ไม่รับน้ำหนักทุกขั้น (0181 มติ ค1) — ช่องเดิมไม่ใช่ของงานนี้

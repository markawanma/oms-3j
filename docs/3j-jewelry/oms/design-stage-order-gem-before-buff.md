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

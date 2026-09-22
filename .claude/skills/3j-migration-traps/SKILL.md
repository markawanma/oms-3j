---
name: 3j-migration-traps
description: >-
  กับดัก Postgres/Supabase ที่ทีม 3J เจอมาแล้วจริงและเสียเวลาซ้ำ — overload
  จาก create or replace, grant หายหลัง replace, 42P16 ตอนแก้ view, NaN หลุด
  validation, อัตราส่วนพลิกเครื่องหมาย, เขตเวลาไทยกับ UTC, ประวัติ migration
  ไม่ถูกบันทึก. ใช้ทุกครั้งที่จะเขียนหรือรีวิว migration ในโปรเจกต์นี้ ไม่ว่า
  จะเป็นการเพิ่มคอลัมน์ แก้ฟังก์ชัน แก้ view หรือเพิ่ม RPC — และใช้ตอนตรวจ
  ว่า migration ของคนอื่นพลาดข้อไหนไหม
---

# กับดัก migration ของทีม 3J

ทุกข้อในนี้**เกิดขึ้นจริงในโปรเจกต์นี้** ไม่ใช่ทฤษฎี เรียงตามจำนวนครั้งที่เจอซ้ำ

---

## 1. `create or replace function` ที่เปลี่ยน arg list = สร้างตัวใหม่ ไม่ใช่แทนที่

**เจอมาแล้ว 3 รอบ** (0060, 0064, และเกือบพลาดอีกใน 0081)

Postgres แยกฟังก์ชันด้วย **ชื่อ + รายการพารามิเตอร์** ถ้าเพิ่ม/ลด/สลับพารามิเตอร์แม้แต่ตัวเดียว
`create or replace` จะสร้าง **overload ตัวใหม่** ทิ้งตัวเก่าไว้ → PostgREST เจอสองตัวแล้วเลือกไม่ถูก
หรือเลือกตัวเก่าที่ยังไม่มี logic ใหม่ → บั๊กที่หาไม่เจอเพราะ "โค้ดก็แก้แล้วนี่"

```sql
-- ต้อง drop signature เดิมเต็มๆ ก่อนเสมอ
drop function if exists analytics.oem_setting_upsert(uuid, numeric, numeric, numeric, numeric, numeric, numeric, int, int, int);
create or replace function analytics.oem_setting_upsert(... args ใหม่ ...) ...
```

**วิธีตรวจหลัง apply — ทำทุกครั้ง:**
```sql
select proname, pg_get_function_identity_arguments(oid)
from pg_proc where pronamespace='analytics'::regnamespace and proname='ชื่อฟังก์ชัน';
```
ได้มากกว่า 1 แถว = เกิด overload แล้ว **หยุดแล้วรายงาน อย่าลบเองมั่วๆ**

---

## 2. Grant ไม่ติดมาเองหลัง `create or replace`

สิทธิ์ execute ที่เคยให้ไว้**หายทุกครั้ง** ที่ replace ฟังก์ชัน ต่อให้ signature เดิมเป๊ะก็ตาม
อาการ: โค้ดถูกทุกอย่าง แต่ฝั่งแอปเรียกไม่ได้ ขึ้น permission denied

```sql
revoke execute on function analytics.ชื่อ(args) from public, anon, authenticated;
grant  execute on function analytics.ชื่อ(args) to service_role;
```

ต้องทำ **ทุกฟังก์ชัน ทุกครั้ง** ที่แตะ — ไม่มีข้อยกเว้น

🔴 **ตัวอย่างนี้เคยเขียนว่า `to authenticated, service_role` ซึ่งผิดตั้งแต่ 0123 — แก้แล้ว 22 ก.ย. 69**
สคีมา `analytics` ปิด REST ให้ `anon`/`authenticated` ไปทั้งสคีมาแล้ว **ดูข้อ 18**
และ `revoke ... from public` อย่างเดียวไม่พอบน Supabase เพราะ `anon`/`authenticated` ได้สิทธิ์
**แยกจาก PUBLIC** ต้องระบุทั้งสามตัวเสมอ

---

## 3. `create or replace view` เพิ่มคอลัมน์ได้อย่างเดียว แทรกกลาง = `42P16`

คอลัมน์เดิมต้องเป็น **prefix ลำดับเดิมเป๊ะทุกตัว** ของใหม่ต่อท้ายเท่านั้น

**กับดักซ้อน:** ต้องลอก select list จาก migration **ฉบับล่าสุดที่แก้ view นั้น** ไม่ใช่ฉบับที่สร้างมันครั้งแรก
`v_oem_quote` ถูกแก้มาแล้วหลายรอบ (0075 → 0077 → 0078 → 0081 → 0082 → 0084) ลอกผิดฉบับ = คอลัมน์ของรอบกลางๆ หายเงียบ

**ตรวจก่อน apply เสมอ:**
```sql
select ordinal_position, column_name from information_schema.columns
where table_schema='analytics' and table_name='ชื่อ view' order by ordinal_position;
```
เทียบกับ select list ในไฟล์ ไม่ตรง = **หยุด อย่า apply**

---

## 4. `NaN` หลุด validation เพราะ Postgres ถือว่ามันมากกว่าทุกค่า

`'NaN'::numeric <= 0` เป็น **false** → เงื่อนไข `if x <= 0 then raise` ไม่จับ
`NaN` ไหลเข้าไปแล้วราคาทั้งใบกลายเป็น NaN และ **gate ทุกตัวหลังจากนั้นตายหมด** เพราะ `NaN < floor` ก็ false เหมือนกัน

```sql
-- ผิด — NaN/Infinity ไหลผ่าน
if v_x is null or v_x <= 0 then raise exception '...'; end if;

-- ถูก — not(between) ฆ่า NaN และ Infinity ให้ฟรี
if v_x is null or not (v_x > 0 and v_x <= 100000) then raise exception '...'; end if;
```

`int` ปลอดภัยอยู่แล้ว (`'NaN'::int` พังตั้งแต่ cast) แต่ `numeric` ต้องระวังทุกช่องที่รับจาก client

---

## 5. อัตราส่วนที่ตัวหารติดลบได้ จะพลิกเครื่องหมายแล้ววิ่งผ่าน gate

เจอที่สูตร margin หลังหักส่วนลด: `(ราคา − ส่วนลด − ต้นทุน) / (ราคา − ส่วนลด)`
พอส่วนลดมากกว่าราคา ทั้งเศษและส่วนติดลบ → อัตราส่วนกลับเป็น **บวกใหญ่** → ผ่านทุกด่านที่เขียนว่า `< floor`
**ยิ่งลดเยอะยิ่งดูดี**

กันสองชั้น:
1. ปฏิเสธตั้งแต่ต้นถ้าตัวหารจะ `<= 0`
2. เงื่อนไข gate เขียนเป็น `is null or < floor` — **คำนวณไม่ได้ = ตก ไม่ใช่ผ่าน**

หลักทั่วไป: **gate ที่ดีควรวัดจากจำนวนเงินที่ลบกันไม่ได้พลิก มากกว่าอัตราส่วน**

---

## 6. DB เป็น UTC — วันทางธุรกิจของไทยต้องแปลงเอง

`current_date` ใน Postgres = วันที่ UTC ช่วง **00:00–07:00 เวลาไทย จะเหลื่อมไปหนึ่งวัน**
กระทบทุกอย่างที่ผูกกับ "วันนี้": วันหมดอายุ, ด่านความสดของราคา, เลขที่เอกสารรายเดือน

```sql
(now() at time zone 'Asia/Bangkok')::date
```

ต้องใช้ **ทุกจุด** ที่หมายถึงวันทางธุรกิจ ไม่ใช่แค่จุดที่นึกออก — ไล่ให้ครบทั้งฟังก์ชันและ view

---

## 7. ห้าม grant เหวี่ยงแหทั้ง schema

```sql
grant select on all tables in schema analytics to ...   -- ❌ ตีตกทันที
```
ครอบตารางที่มีต้นทุน/PII ที่ไม่ควรเปิด ให้ grant เฉพาะ object ที่ migration นั้นแตะจริง

---

## 8. `found` หลัง `for ... loop` เชื่อไม่ได้

`found` สะท้อนผลของ**คำสั่งสุดท้าย**ที่รันในลูป ไม่ใช่ว่าลูปวนกี่รอบ
ถ้าอยากรู้ว่ามีแถวไหม ให้ตั้งตัวแปร boolean เองในลูป

---

## 9. ฟังก์ชันช่วยที่ join ตาราง lookup อาจคืน null แล้วล้าง array ทั้งก้อน

`v_arr || null` ใน jsonb ทำให้ **ทั้ง array กลายเป็น null เงียบๆ**
เจอตอนเรียก helper ที่ join กับตารางเรตซึ่งไม่มี key ของสินค้าประเภทใหม่ → รายการแจ้งเตือน "ข้อมูลยังไม่ครบ" หายทั้งชุด ผู้ใช้เลยไม่รู้ว่าขาดอะไร

เช็คค่าที่ helper คืนก่อนต่อเข้า array เสมอ

---

## 10. apply ผ่าน `execute_sql` ไม่ถูกบันทึกในประวัติ migration

Supabase เก็บประวัติที่ `supabase_migrations.schema_migrations` — การรัน SQL ตรงไม่เขียนแถวให้
ถ้าปล่อยไว้ วันไหนมีคนสั่ง deploy ตามปกติ ระบบจะคิดว่ายังไม่เคยลงแล้ว**รันซ้ำทั้งชุด**

```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('YYYYMMDDHHMMSS', 'ชื่อไฟล์ไม่ต้องมี .sql') on conflict (version) do nothing;
```

---

## 11. ทดสอบบน DB จริงตรงๆ = เผา state ที่กู้คืนไม่ได้

**เจ็บมาแล้วจริง:** ทดสอบการออกใบเสร็จบน DB production → ตัวนับเลขที่เอกสารเดินหน้า 4 เลข
ถอยกลับไม่ได้ (เลขที่เอกสารภาษีห้ามข้าม/ห้ามใช้ซ้ำตามกฎหมาย) ใบจริงใบแรกของร้านเลยต้องเริ่มที่เลข 16

**pattern บังคับ** สำหรับทดสอบทุกอย่างที่แตะตัวนับ, เอกสารทางกฎหมาย, หรือข้อมูลที่แก้ย้อนไม่ได้:
รันทุกเคสใน `do $$` block เดียว เก็บผลใส่ตัวแปร text แล้ว**ปิดท้ายด้วย `raise exception '%', v_log`**
— exception ทำให้ทั้ง transaction rollback อัตโนมัติ ผลทดสอบออกมาทาง error message ส่วน DB ไม่ขยับเลย

```sql
do $$
declare v_log text := E'\n=== ผลทดสอบ ===\n';
begin
  -- แต่ละเคสห่อด้วย begin/exception ของตัวเอง เก็บผลลง v_log
  begin perform ...; v_log := v_log || 'T1: FAIL ผ่านทั้งที่ควรปฏิเสธ\n';
  exception when others then v_log := v_log || 'T1: OK ปฏิเสธ\n'; end;
  raise exception '%', v_log;   -- บังคับ rollback ทั้งก้อน + รายงานผล
end; $$;
```

หลังรันแล้ว **ตรวจซ้ำว่า state ไม่ขยับจริง** (นับแถว/ค่าตัวนับ เทียบก่อน-หลัง) อย่าเชื่อว่า rollback เอง

หมายเหตุ: ถ้าฟังก์ชันที่ทดสอบเช็ค role ให้ใช้
`perform set_config('request.jwt.claims', '{"role":"service_role"}', true);` ใน block (`true` = หมดอายุพร้อม transaction)

---

## 12. `plpgsql` ที่ `returns table` — ชื่อคอลัมน์ชนกับ OUT variable = 42702 **ตอนเรียก** ไม่ใช่ตอน create

`returns table (col1 ..., col2 ...)` ทำให้ `col1`/`col2` กลายเป็นตัวแปรที่มองเห็นได้ทั้งฟังก์ชัน
ถ้า CTE/subquery ข้างในอ้างคอลัมน์ชื่อเดียวกันแบบไม่ qualify alias ตาราง → ambiguous
SQL ยังถูกไวยากรณ์ทุกอย่าง ผ่าน static review ได้สบาย เพราะ error โผล่แค่ตอน Postgres วางแผน query จริง
(**12 ก.ย. 69**: security + QA + code-review ผ่านทั้ง 3 รอบ แต่ dry-run จับได้ 2 บั๊กใน 2 นาที)
→ **dry-run ใน transaction ที่ rollback ก่อน apply เสมอ** อย่าเชื่อว่า review ตาเปล่าครบแล้ว

---

## เช็คลิสต์ก่อนบอกว่า migration เสร็จ

- [ ] เปลี่ยน arg list ไหม → drop signature เดิมแล้วหรือยัง
- [ ] แตะฟังก์ชันไหน → re-grant ครบทุกตัวหรือยัง
- [ ] แตะ view ไหม → ลอก select list จากฉบับล่าสุด ต่อท้ายอย่างเดียว
- [ ] ตัวเลขที่รับจาก client → กัน NaN/Infinity ด้วย `not(between)` ครบทุกช่อง
- [ ] มี gate ที่เป็นอัตราส่วนไหม → ตัวหารติดลบได้ไหม · null = ตกหรือผ่าน
- [ ] มีคำว่า "วันนี้" ไหม → ใช้เวลาไทยครบทุกจุด
- [ ] `security definer` → pin `search_path` + `crm_require_owner_admin` + `for update` เมื่อแก้แถวเดิม
- [ ] idempotent — รันซ้ำได้ไหม
- [ ] คอมเมนต์หัวไฟล์บอก **ทำไม** ไม่ใช่แค่ทำอะไร
- [ ] apply แล้วบันทึกประวัติ migration หรือยัง
- [ ] ทดสอบแตะตัวนับ/เอกสารทางกฎหมายไหม → ใช้ do-block + raise บังคับ rollback แล้วตรวจ state ซ้ำ
- [ ] `returns table` ไหม → ชื่อคอลัมน์ใน CTE/subquery qualify alias ครบทุกจุดหรือยัง (ข้อ 12) · dry-run ใน transaction rollback ก่อน apply จริงเสมอ อย่าพึ่ง static review อย่างเดียว
- [ ] มีด่านที่เช็ค `is null` / `is not null` ไหม → **รันดูค่าจริงก่อน** ว่าเป็น null จริงหรือแค่ `0.00`/JSON null (ข้อ 13)
- [ ] เพิ่ม CHECK บนตารางที่มี `on conflict` ไหม → คอลัมน์ในเงื่อนไขอยู่ในรายการ insert หรือยัง (ข้อ 14)
- [ ] มีลำดับ `$`+`$` ในคอมเมนต์ข้างใน do-block ไหม (ข้อ 15)
- [ ] ชุดทดสอบใช้ตัวแปรซ้ำข้ามชนิดไหม — int รับ numeric = ปัดเศษเงียบ (ข้อ 16)
- [ ] **มีเคส "ยิงฟังก์ชันใหม่ใส่ข้อมูลเก่าทุกโหมดที่มีจริง" หรือยัง** ไม่ใช่แค่ fixture ใหม่ (ข้อ 17)
- [ ] มี `grant ... to authenticated` หรือ `anon` ในไฟล์ไหม → **ตีตกทันทีถ้าเป็นสคีมา `analytics`** (ข้อ 18) · ตัวอย่างเก่าในสกิลนี้เขียนไว้ผิด อย่าลอก

---

## 13. 🔴 ด่านที่ถามว่า "ว่างไหม" ตาบอด เมื่อค่าที่ได้แค่ *หน้าตาเหมือนว่าง*

**เกิดจริง 3 ครั้งในวันเดียว (19 ก.ย. 69) คนละคนเขียน คนละไฟล์ static review ไม่เจอสักครั้ง**

| ที่ | ด่านเขียนว่า | ค่าที่ได้จริง | ผล |
|---|---|---|---|
| 0138 backfill | `effective_unit_cost is null` | `0.00` (view `coalesce` ทุกตัว) | ผ่านด่าน ⇒ สร้าง lot **ต้นทุน 0 ล็อกถาวร** |
| 0143 lateral | `cost_calc is not null` | **JSON null** (`jsonb_typeof='null'`) ไม่ใช่ SQL NULL | ผ่านด่าน ⇒ หยิบรอบผลิตโหมดเก่ามาเป็นต้นทุน |
| — | `x is not null` บน jsonb | `'null'::jsonb` | `is not null` = **จริงเสมอ** |

**กฎ**: ก่อนเขียนด่านที่เช็คความว่าง **ต้องพิสูจน์ก่อนว่าค่าที่จะได้จริงเป็นค่าว่างชนิดไหน** —
รัน `select <นิพจน์>, jsonb_typeof(...), (... is null)` จริงก่อน อย่าอนุมานจากการอ่านโค้ด

```sql
-- ❌ ตาบอด
where v.effective_unit_cost is null
where poi.cost_calc is not null

-- ✅ ถามสิ่งที่ตั้งใจถามจริงๆ
where not (v.effective_unit_cost > 0 and v.effective_unit_cost <= 1000000)  -- กัน null/0/NaN พร้อมกัน
where jsonb_typeof(poi.cost_calc) = 'object'                                 -- SQL NULL ก็ตกด้วย
```

---

## 14. CHECK constraint กับ `insert ... on conflict do update` — ตรวจกับ "แถวที่เสนอ" ไม่ใช่แถวผลลัพธ์

Postgres ประกอบแถวที่จะแทรกแล้ว **ตรวจ CHECK ก่อน** จะไปรู้ว่าชน unique index แล้วไหลไป `do update`
⇒ คอลัมน์ที่ไม่ได้อยู่ในรายการ `insert` จะเป็น **default/NULL** ในแถวที่ถูกตรวจ แม้ของเดิมจะมีค่าอยู่

เกิดจริง 0142: `check (cost_type <> 'spec' or make_spec is not null)` ตีตก `product_upsert` **ทุกครั้ง**
ที่ upsert SKU โหมด spec (23514) ทั้งที่ของเดิมมี `make_spec` อยู่

**แก้**: พาคอลัมน์นั้นไปกับแถวที่เสนอด้วย (`select` ค่าเดิมมาก่อนแล้วใส่ใน `values`)
หรือย้ายไปเป็น trigger ที่เห็นแถวสุดท้าย

---

## 15. `$$` ในคอมเมนต์ ปิด dollar-quote block เสียเอง

ภายใน `do $$ ... $$` **ทุกอย่างเป็นข้อความดิบ `--` ไม่ใช่คอมเมนต์** — lexer มองหาแค่ tag ปิด
⇒ คอมเมนต์ที่ *เตือนเรื่อง* `$$` ดันไปปิดบล็อกเอง แล้วได้ `42601 syntax error` ที่คำถัดไป (มักเป็นภาษาไทย หาไม่เจอ)

**แก้**: ใช้ tag เฉพาะ (`do $v143$ ... $v143$`) หรือห้ามมีลำดับ `$`+`$` ในคอมเมนต์เลย
**เครื่องมือ**: `scripts/run-sql.mjs` แปลง offset ของ Postgres เป็นบรรทัด/คอลัมน์ + โชว์ข้อความรอบๆ ให้แล้ว

---

## 16. ตัวแปร scratch ที่ใช้ซ้ำข้ามชนิด = FAIL ปลอมที่เสียเวลาไล่

`v_stock_after int` ถูกใช้รับ `central_stock.qty_on_hand` (int) ที่หนึ่ง แล้วถูกเอามารับ
`stock_lot.unit_cost` (`numeric(12,2)`) อีกที่ ⇒ **325.07 ถูกปัดเหลือ 325 เงียบๆ ตอนอ่านค่า**
เทียบไม่ผ่านทั้งที่ค่าในฐานข้อมูลถูกต้อง — ไล่หาสาเหตุนานเพราะตัวเลขที่พิมพ์ออกมาดูเหมือนตรงกัน

**กฎ**: ชุดทดสอบยาวๆ ให้ตั้งตัวแปรแยกตามชนิดและความหมาย อย่าประหยัดชื่อ

---

## 17. เคสห้ามผ่านต้องมี "ของใหม่เจอของเก่า" เสมอ

บรีฟที่สั่งแค่ *"ของเดิมต้องไม่พัง"* แล้วเทียบ snapshot ก่อน/หลัง apply — **ผ่านแน่นอนโดยไม่มีความหมาย**
เพราะ migration ที่ไม่ได้ `UPDATE` อะไรย่อมไม่ทำให้ค่าขยับอยู่แล้ว

เกิดจริง 0141: ผ่าน 31 เคส แล้ว security เจอ HIGH 3 ข้อ ทั้งหมดอยู่ที่ **"ยิง RPC ใหม่ใส่ SKU ที่มีอยู่จริง"**
ซึ่งไม่มีเคสไหนทดสอบเลย (เช่น เรียก `product_make_spec_clear` ใส่ SKU โหมด `spot` ⇒ พลิกโหมด ต้นทุน +47%)

**กฎ**: RPC/ฟังก์ชันใหม่ทุกตัว ต้องมีเคส **ยิงใส่ข้อมูลทุกโหมด/ทุกสถานะที่มีอยู่จริงบน prod**
ไม่ใช่แค่ fixture ที่สร้างมาเพื่อทดสอบฟีเจอร์ใหม่

---

## 18. 🔴 `grant ... to authenticated` บนสคีมา `analytics` = เปิดรูที่ 0123 ปิดไปแล้ว

`0122`→`0123`→`0124` (16 ก.ย. 69) **ปิด REST ของสคีมา `analytics` ทั้งสคีมา**
ให้ `anon` และ `authenticated` รวมถึง revoke default privilege ไม่ให้ตารางใหม่ auto-grant
พิสูจน์สดได้:

```sql
select has_schema_privilege('authenticated','analytics','usage');  -- false
select has_schema_privilege('anon','analytics','usage');           -- false
select has_schema_privilege('service_role','analytics','usage');   -- true
```

⇒ ตารางใหม่ในสคีมานี้ **grant ให้ `service_role` อย่างเดียว**
migration ทุกตัวหลัง 0123 (0131/0138/0140/0141/0143/0144/0145/0146) ทำแบบนี้หมด

🔴 **กับดักคือตัวอย่างเก่าในสกิลนี้เองและใน migration ก่อน 0123** ยังเขียน
`grant ... to authenticated, service_role` อยู่ — **ลอกมาใช้ = เป็น grant ตัวเดียวในระบบที่เปิดรูกลับ**

**หน้าเว็บอ่านข้อมูลยังไงถ้า `authenticated` เข้าไม่ได้**: อ่านฝั่ง server ด้วย service role
ผ่าน server action / RPC `security definer` + `crm_require_owner_admin` — **ไม่ได้อ่านตรงผ่าน PostgREST**
⇒ ถ้ารู้สึกว่า "ต้อง grant ให้ authenticated ไม่งั้น UI พัง" แปลว่ากำลังจะต่อผิดชั้น

**เกิดจริง 22 ก.ย. 69**: Tech Lead เขียนบรีฟสั่งให้ grant ให้ `authenticated`
(ลอกจากตัวอย่างในสกิลนี้) — backend-dev ไปเช็คของจริงแล้วไม่ทำตาม แล้วรายงานกลับ **ถูกต้อง**
⇒ ยืนยันกฎประจำทีม: **ของจริงบน DB ชนะบรีฟเสมอ ไม่ว่าบรีฟจะมาจากใคร**

### 18.1 revoke สามชื่อไม่เท่ากัน ต้องทำครบทั้งสาม

สิทธิ์ execute มาถึง anon/authenticated ได้ **2 ทางที่ revoke คนละคำสั่งกัน**:

| ทาง | มาจากไหน | ถอนด้วย | **ไม่**ถูกถอนด้วย |
|---|---|---|---|
| PUBLIC | `CREATE FUNCTION` grant ให้ PUBLIC อัตโนมัติทุกครั้ง | `revoke ... from public` | `revoke ... from anon, authenticated` |
| grant ตรง | มีคนเขียน `grant ... to authenticated` | `revoke ... from anon, authenticated` | `revoke ... from public` |

⇒ `revoke ... from public, anon, authenticated;` **ทั้งสามชื่อเสมอ** ไม่มีข้อยกเว้น

⚠️ `has_function_privilege` คืน true **ทั้งสองทาง** ⇒ ใช้ตรวจว่า "ปิดแล้ว" ได้ แต่บอกไม่ได้ว่า
สิทธิ์มาจากทางไหน — ถ้าต้องรู้ให้ดู `proacl` ตรงๆ (`=X/postgres` คือ PUBLIC)

### 18.2 `revoke ... on all functions` ของ 0123 ถูกกัดเซาะเงียบๆ จาก migration ที่มาทีหลัง

0123 ได้ผลจริง แต่ `revoke ... on all functions` มีผลกับฟังก์ชัน **ณ วินาทีที่รัน** เท่านั้น
⇒ ทุก `create or replace` หลังจากนั้นที่ re-grant ตาม boilerplate เก่า (ข้อ 2) เปิดกลับทีละตัว
ตรวจ 22 ก.ย. 69 เจอ **9 ครั้งใน 3 วัน** — ทั้งหมดเกิด *หลัง* 0123:

```
0125:260 · 0126:215 · 0127:286 · 0128:319  ->  shop_setting_upsert
0127:353 · 0128:420                        ->  oem_metal_price_set
0141:985 · 0142:314                        ->  product_upsert
0140:833                                   ->  oem_price_calc
```

บวกอีก 3 ตัวที่เป็นสิทธิ์ PUBLIC ติดมาจาก `CREATE FUNCTION` ซึ่ง 0123 ไม่เคยแตะ
(`crm_audit_log_append_only`, `crm_feature_flag_touch`, `crm_overview_summary`)
⇒ รวม 7 ตัว ถอนทั้งหมดใน **0147**

🔴 **กับดักซ้อน — ของพวกนี้ไม่โผล่ใน `get_advisors` เลย**: พอสคีมาไม่อยู่ใน exposed API
schema ของ PostgREST แล้ว linter จะข้ามไป (advisor เห็นแต่ฟังก์ชันใน `public`)
⇒ **advisor สะอาดไม่ได้แปลว่าไม่มี grant ค้าง** อย่าใช้เป็นด่านเดียว

### 18.3 ด่านที่ต้องรัน

```
node scripts/run-sql.mjs scripts/check-analytics-grants.sql
```
กวาดทั้งสคีมาด้วย `aclexplode` (**ไม่ผูกรายชื่อฟังก์ชัน** ⇒ ฟังก์ชันใหม่ถูกคุ้มครองเอง)
รัน **หลัง apply migration ที่แตะฟังก์ชันใน analytics** และ 🔴 **หลัง rebuild/restore/branch DB
ใหม่ทุกครั้ง** — replay migration ทั้งชุดคือจุดที่ grant เก่าฟื้นกลับมาได้

### 18.4 ❌ event trigger ถอน grant อัตโนมัติ — ปฏิเสธแล้ว อย่าเสนอซ้ำ

เสนอเมื่อ 22 ก.ย. 69 — **ปฏิเสธ** เพราะ: (1) Supabase ต้องเป็น `supabase_admin` ถึงจะ
`create event trigger` ได้ `postgres` ทำไม่ได้เสถียร (2) ด่านที่ถอน grant เงียบๆ สร้างอาการ
"โค้ดถูกแต่เรียกไม่ได้" = กับดักข้อ 2 กลับหัว หาสาเหตุยากกว่าเดิม (3) ไม่ปรากฏในประวัติ
migration (ขัดข้อ 10)

### 18.5 verify ของงาน grant — ห้ามจบที่ `has_function_privilege`

การอ่าน ACL พิสูจน์แค่ว่า "ตัวเลขถูก" ไม่ได้พิสูจน์พฤติกรรม ต้องมีเคสที่ **จำลองวันที่กำแพง
ชั้นนอกหลุด**: `grant usage on schema analytics to authenticated` กลับเข้าไปในทรานแซกชัน
ทดสอบ → `set local role authenticated` → ยิงฟังก์ชันจริง → ต้องตกที่ `42501 permission
denied for function` → `reset role` → `revoke usage` (ดู `scripts/verify-0147.sql` Part 4c)

ส่ง `null` ทุกพารามิเตอร์ได้ปลอดภัยแม้กับ SECURITY DEFINER ที่เขียนข้อมูล เพราะ Postgres
เช็ค EXECUTE **ก่อน** body รัน ⇒ ไม่มีทางเข้าไปถึงเนื้อฟังก์ชัน

ทำนองเดียวกัน การพิสูจน์ว่า **trigger ไม่พังหลัง revoke** ต้องยิงจาก role ที่ไม่มี execute grant
จริงๆ (revoke จาก `service_role` ชั่วคราวแล้ว `set local role service_role`) — รันเป็น `postgres`
เฉยๆ พิสูจน์อะไรไม่ได้เพราะ owner มีสิทธิ์อยู่แล้ว

---

## 19. 🔴 `UPDATE` ใน migration ยิง trigger ของตารางนั้นด้วย — แม้ค่าจะไม่เปลี่ยน

`set_updated_at()` แบบมาตรฐานเขียนว่า `new.updated_at = now()` **ไม่มีเงื่อนไข**
⇒ แถวที่ `set x = null` ทับ `null` (ไม่เปลี่ยนอะไรเลย) **ก็ยังโดน** เพราะ BEFORE UPDATE ยิงตาม
จำนวนแถวที่ `where` จับได้ ไม่ใช่ตามจำนวนแถวที่ค่าเปลี่ยนจริง

**เกิดจริง 22 ก.ย. 69 — จับได้ที่ด่าน security ไม่ใช่ที่ชุดทดสอบ 24 เคส**
`0145` backfill `campaign_step.goal_kpi_code` ด้วย
`where goal_kpi_code is null and goal_kpi_code_source is null` — คอลัมน์เพิ่งถูก `add` ⇒
**ตรงกับทุกแถว** ⇒ ยิง 55 แถว รวม 17 แถวที่ map ไม่ได้และตั้งใจให้เป็น null อยู่แล้ว
ผล: `count(distinct updated_at)` ยุบจาก **7 → 1** ประวัติที่กระจายตั้งแต่ 15 ส.ค. ถึง 21 ก.ย. หายถาวร

🔴 **สิ่งที่ทำให้มันอันตรายเป็นพิเศษ: ไม่มีใครเห็นตอนเกิด** — แอปไม่ได้อ่าน `updated_at` ตัวนี้
ไม่มี error ไม่มีเทสต์ตก และไม่มีคอลัมน์สำรองให้กู้ ⇒ รู้ตัวอีกทีตอนที่อยากรู้ว่า "แถวนี้แก้เมื่อไหร่"

### กฎ

1. **ก่อนเขียน `UPDATE` ในmigration ให้ query `pg_trigger` ของตารางนั้นก่อนเสมอ**
   ```sql
   select tgname, pg_get_triggerdef(oid) from pg_trigger
   where tgrelid = 'analytics.ชื่อตาราง'::regclass and not tgisinternal;
   ```
2. **แคบ `where` ให้เหลือเฉพาะแถวที่ค่าเปลี่ยนจริง** — อย่าพึ่ง `where col is null` ตอนที่
   คอลัมน์เพิ่ง `add` เพราะมันคือ "ทุกแถว" เสมอ · ระบุเงื่อนไขฝั่งข้อมูลต้นทางด้วย
   (เช่น `and step_kind in (...)` เฉพาะ kind ที่ map ได้)
3. **backfill ของระบบไม่ใช่การแก้โดยคน** ⇒ ถ้ามีคอลัมน์บันทึกที่มาอยู่แล้ว
   (เช่น `..._source = 'auto_step_kind'`) ให้ปิด trigger ระหว่าง backfill
   `alter table X disable trigger ชื่อ;` … `enable trigger ชื่อ;` **ในทรานแซกชันเดียวกัน**
   (ต้องเป็นเจ้าของตาราง — `postgres` เป็นเจ้าของอยู่แล้ว ล็อก ACCESS EXCLUSIVE ชั่วขณะ)
4. **เทสต์ต้องล็อกไว้**: เก็บ `md5(string_agg(updated_at, '|' order by id))` ก่อน แล้ว assert เท่าเดิมหลัง
   \+ assert `count(distinct updated_at)` เท่าเดิม

**ญาติสนิทของข้อ 13** (ด่านตาบอด) แต่คนละหน้า: ข้อ 13 คือ *อ่าน* ค่าว่างผิดชนิด ·
ข้อนี้คือ *เขียน* ทับของที่ไม่ได้ตั้งใจแตะ — ทั้งคู่เงียบเท่ากัน

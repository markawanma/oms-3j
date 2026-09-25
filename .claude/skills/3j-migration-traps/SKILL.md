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
- [ ] เทสต์มี assert ที่อิงเวลาไหม → `now()` คงที่ทั้งทรานแซกชัน อย่าคาดว่าจะไล่เพิ่ม (ข้อ 22)
- [ ] มี `grant ... to authenticated` หรือ `anon` ในไฟล์ไหม → **ตีตกทันทีถ้าเป็นสคีมา `analytics`** (ข้อ 18) · ตัวอย่างเก่าในสกิลนี้เขียนไว้ผิด อย่าลอก
- [ ] มี `UPDATE` ในไฟล์ไหม → query `pg_trigger` ของตารางนั้นแล้วหรือยัง · `where` แคบพอที่จะไม่โดนแถวที่ค่าไม่เปลี่ยนไหม (ข้อ 19)
- [ ] ไฟล์เป็น **LF** หรือยัง · จะ replay/rebuild บน Windows ไหม → นับ `\r` ด้วย `tr -dc '\r' | wc -c` ก่อนรัน (ข้อ 20)
- [ ] apply แล้ว → ไฟล์ขึ้นรีโปจริงหรือยัง (`git log --oneline -- supabase/migrations/<ไฟล์>`) · เทียบ md5 ไม่ตรง ให้เช็ค `\r` + ลำดับ replay ก่อนสรุปว่าไฟล์ผิด (ข้อ 21)

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

---

## 20. 🔴 CRLF ทำให้ replay ได้ฟังก์ชัน "เหมือนแต่ไม่เท่า" ของบน prod

**เกิดจริง 23 ก.ย. 69 ตอนกู้ไฟล์ 0129 — เกือบสรุปผิดว่า "ไฟล์ที่กู้มาไม่ตรงกับ prod"**

Git for Windows ตั้ง `core.autocrlf=true` มาจาก system config (`C:/Program Files/Git/etc/gitconfig`)
และรีโปนี้**ไม่มี `.gitattributes`** ⇒ **blob เก็บ LF แต่เช็คเอาต์ออกมาเป็น CRLF**

ไฟล์ `.sql` ที่มี body ฟังก์ชันอยู่ระหว่าง `$$...$$` จะได้ `\r` ติดเข้าไป **ในตัว source ของฟังก์ชัน**
ไม่ใช่แค่ whitespace ของไฟล์ — Postgres เก็บ body เป็นสตริงดิบ `\r` จึงกลายเป็นส่วนหนึ่งของฟังก์ชันถาวร
⇒ ฟังก์ชันรันได้เหมือนเดิมทุกบรรทัด แต่ `pg_get_functiondef` ไม่ตรง ⇒ **เทียบ md5 แล้วไม่ตรงทั้งที่ตรรกะไม่ได้ต่างกันเลย**

พิสูจน์จริงกับ `0134_silver_bar_cost_from_kilo_price.sql`:

```bash
# blob ใน git = LF ล้วน · working tree = CRLF
git show HEAD:supabase/migrations/0134_silver_bar_cost_from_kilo_price.sql | tr -dc '\r' | wc -c   # 0
tr -dc '\r' < supabase/migrations/0134_silver_bar_cost_from_kilo_price.sql | wc -c                 # 184
```

replay ด้วยไฟล์จาก working tree (มี `\r` 184 ตัว) → `md5(pg_get_functiondef)` **ไม่ตรง**
`sed 's/\r$//'` ก่อนแล้ว replay → **ตรงทันที** (`a14175ef8776133aaf6353eba2e1bf37`)

🔴 **`scripts/run-sql.mjs` ไม่ normalize ให้** — มันอ่านไฟล์ดิบ (`readFileSync(path,'utf8')`) แล้วส่งเข้า DB ตรงๆ
⇒ กับดักนี้โดนทุกครั้งที่รันไฟล์จาก working tree บนเครื่อง Windows

⚠️ **`grep -c $'\r'` ตรวจเรื่องนี้ไม่ได้** — msys grep กิน CR ท้ายบรรทัดไปเอง คืน `0` ทั้งที่มี `\r` จริง
ใช้ `tr -dc '\r' | wc -c` เท่านั้น

### กฎ

1. **migration ที่เขียนใหม่ ให้เป็น LF เสมอ**
2. **rebuild / replay ทั้งชุดบน Windows ต้องแปลงเป็น LF ก่อนทุกไฟล์** —
   `sed 's/\r$//' <file> > <tmp>` แล้วรัน `<tmp>` · หรือดึงจาก blob ตรงๆ ด้วย
   `git show <ref>:<path>` ซึ่งเป็น LF อยู่แล้วเพราะไม่ผ่าน working tree
3. **md5 ไม่ตรง อย่าเพิ่งสรุปว่าไฟล์ผิด** — นับ `\r` ก่อนเสมอ (อีกสาเหตุหนึ่งอยู่ที่ข้อ 21: ลำดับ replay)

**เสนอให้พิจารณา — ยังไม่ได้ทำ ต้องให้เจ้าของ/Tech Lead ตัดสินเพราะกระทบ working tree ของทุกคนและทุก worktree**:
เพิ่ม `.gitattributes` บรรทัด `*.sql text eol=lf` ⇒ ปิดกับดักที่ต้นทาง แทนที่จะต้องจำแปลงเองทุกครั้ง

---

## 21. กู้ไฟล์ migration ที่หายจากรีโปได้จาก DB เอง + วิธีพิสูจน์ว่าไฟล์ตรงกับ prod จริง

**เกิดจริง: `0129_oem_metal_price_set_manual_guard` apply ลง prod ตั้งแต่ 17 ก.ย. 69
(version `20260917082918`) แต่ไฟล์ไม่เคยเข้ารีโปเลย — รู้ตัวอีกที 23 ก.ย.**
(บทเรียนเดียวกับ 0107-0109 ที่ค้างนอก main แต่หนักกว่า เพราะรอบนั้นไฟล์แค่ค้าง รอบนี้หายสนิท)

`supabase_migrations.schema_migrations.statements` เก็บ **SQL เต็มที่ถูกส่งเข้า DB ตอน apply จริง**
⇒ ไฟล์หายก็กู้คืนได้ และเป็นแหล่งที่ **ตรงกับ prod ที่สุด — ดีกว่า draft ที่ยังเหลือในรีโป**

```sql
select version, name, array_to_string(statements, E';\n') as sql
from supabase_migrations.schema_migrations
where version = '20260917082918';
```

ของ 0129: draft ที่คนเขียนไว้ (commit `c07d07a` บรานช์ที่ไม่เคย push) ยาว **31,490 ตัวอักษร**
แต่ตอน apply จริงย่อคอมเมนต์ลงเหลือ **7,737** — body ที่อยู่บน prod ตรงกับ**ฉบับย่อ** ไม่ใช่ draft
⇒ หยิบ draft มาใช้แทน = ได้ฟังก์ชัน "เหมือนแต่ไม่เท่า" อีกทาง (ญาติของข้อ 20 คนละต้นเหตุ)

### วิธีพิสูจน์ว่าไฟล์ที่กู้มา replay แล้วได้ของเท่าเดิม

ในทรานแซกชันเดียวกัน: เก็บ `md5(pg_get_functiondef(oid))` ก่อน → รันไฟล์ → เก็บอีกรอบ → เทียบ → **rollback**
\+ **นับจำนวน signature ก่อน/หลังด้วย** เพื่อจับ overload หลุด (ข้อ 1)

```sql
begin;

create temp table _fn_before as
select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h
from pg_proc p
where p.pronamespace = 'analytics'::regnamespace
  and p.proname in ('oem_metal_price_set', 'silver_spot_sync_from_history');

-- ...รันเนื้อไฟล์ migration ตรงนี้...

select b.sig,
       b.h = md5(pg_get_functiondef(p.oid)) as ตรงกัน
from _fn_before b
left join pg_proc p on p.oid::regprocedure::text = b.sig;

select count(*) from _fn_before;   -- เทียบกับ count เดิม: เกิน = overload หลุด · ขาด = signature เปลี่ยน

rollback;
```

ใช้ `node scripts/run-sql.mjs <file.sql>` **ไม่ใส่ `--commit`** ก็ได้ผลเดียวกัน (โหมดซ้อม ROLLBACK เสมอ)
— แต่ต้องระวังเรื่อง `\r` ตามข้อ 20 ก่อน

### ⚠️ ไม่ตรงด้วยไฟล์เดียว ไม่ได้แปลว่าไฟล์ผิด

ถ้าฟังก์ชันถูก `replace` ทับอีกรอบใน migration ที่ลงทีหลัง **ต้อง replay ตามลำดับจริงถึงจะตรง**

| ฟังก์ชัน | replay `0129` เดี่ยว | replay `0129` → `0134` |
|---|---|---|
| `oem_metal_price_set(uuid,text,numeric,date,text)` | ✅ ตรง (`860364d9…`) | ✅ ตรง |
| `silver_spot_sync_from_history()` | ❗ **ไม่ตรง** | ✅ ตรงเป๊ะ (`a14175ef…`) |

เพราะ `0134` (18 ก.ย.) replace `silver_spot_sync_from_history` ทับหลัง `0129`
⇒ ของที่อยู่บน prod ตอนนี้เป็นของ `0134` ไม่ใช่ของ `0129`
**ก่อนจะสรุปว่าไฟล์ที่กู้มาผิด ให้ไล่หาก่อนว่ามี migration ตัวไหนแตะฟังก์ชันนั้นทีหลังบ้าง**

### กฎ

1. **apply เสร็จ ตรวจทันทีว่าไฟล์ขึ้นรีโปแล้วจริง** — `git log --oneline -- supabase/migrations/<ไฟล์>`
   (ต่อจากข้อ 10 ที่พูดถึงประวัติฝั่ง DB · ข้อนี้คือฝั่งรีโป)
2. **ไฟล์ที่กู้ย้อนหลัง ต้องบอกไว้ในหัวไฟล์ว่า "APPLIED แล้ว ห้าม apply ซ้ำ" + version ที่ลง**
   ไม่งั้นรอบหน้ามีคนหยิบไปรันจริง
3. **จงใจเขียนไฟล์ที่กู้ให้ต่างจากของที่ apply ไป ต้องเขียนเหตุผลไว้ตรงนั้น** — 0129 แก้บรรทัด
   `grant ... to authenticated, service_role` เหลือ `to service_role` (ข้อ 18) เพื่อให้ปลายทางของ
   replay ถูกโดยไม่ต้องรอ 0147 ⇒ ต้องระบุไว้ ไม่งั้นรอบหน้าคนเทียบ md5 แล้วงงว่าทำไมไม่ตรง

---

## 22. `now()` คงที่ทั้งทรานแซกชัน — เทสต์ที่คาดว่า timestamp จะไล่เพิ่มจะ FAIL ปลอม

`now()` (และ `current_timestamp` · `transaction_timestamp()`) คืน **เวลาเริ่มทรานแซกชัน**
ไม่ใช่เวลาปัจจุบันขณะรันคำสั่ง ⇒ เรียก RPC 3 ครั้งในทรานแซกชันทดสอบเดียวกัน
`updated_at` จะ **เท่ากันเป๊ะทั้งสามครั้ง** ไม่ใช่ไล่เพิ่มขึ้น

**เกิดจริง 25 ก.ย. 69 (0150)**: เขียนเทสต์ว่า *"เรียกซ้ำแล้ว `updated_at` ต้องใหม่กว่าเดิม"* → FAIL
ทั้งที่ฟังก์ชันถูกต้องทุกอย่าง เสียเวลาไล่หาบั๊กที่ไม่มีอยู่จริง

```sql
-- ❌ FAIL ปลอม — ในทรานแซกชันเดียว now() ไม่ขยับ
v_t1 := (select updated_at from t where id = x);
perform rpc(...);
v_t2 := (select updated_at from t where id = x);
if v_t2 > v_t1 then ... -- ไม่มีวันจริง

-- ✅ เทียบกับ now() ของทรานแซกชันนี้ + เทียบว่าต่างจากค่าประวัติศาสตร์จริง
if v_t2 = now() and v_t2 <> v_t_before_test then ... -- trigger ทำงานจริง
```

**ถ้าต้องการเวลาที่ขยับจริงภายในทรานแซกชัน** ใช้ `clock_timestamp()` — แต่ 🔴 **มันเป็น VOLATILE**
ห้ามใช้ใน `generated always as` · index · CHECK constraint (ดูข้อ 6 ที่ `at time zone` ก็ติดปัญหาคล้ายกันแต่คนละเหตุ)

**หลักที่ใช้ได้ทั่วไป**: ก่อนเขียน assert ที่อิงเวลา ให้ถามก่อนว่า *ค่านี้ผูกกับทรานแซกชัน หรือผูกกับ statement*
เดาผิด = ไล่บั๊กที่ไม่มีอยู่จริง (ญาติกับข้อ 16: ค่าที่ดูเหมือนควรเปลี่ยนแต่ไม่เปลี่ยน)

---

## 🔴 กติกาส่งงาน migration — ตารางแมป "ข้อในบรีฟ → เทสต์ที่ครอบ"

**บังคับตั้งแต่ 25 ก.ย. 69** · ทุก migration ที่ส่งกลับ Tech Lead ต้องแนบตารางนี้มาด้วย

| ข้อในบรีฟ | เทสต์ที่ครอบ | หมายเหตุ |
|---|---|---|
| บรีฟข้อ 1 … | `T2` | |
| บรีฟข้อ 5 … | **ไม่มีเทสต์ครอบ** | เหตุผลที่ครอบไม่ได้ |

🔴 **ข้อไหนไม่มีเทสต์ครอบ ให้เขียนว่า "ไม่มี" พร้อมเหตุผล — ห้ามเว้นว่าง ห้ามข้าม**

### ทำไมต้องมี — เกิดซ้ำ 3 ครั้ง

| รอบ | รายงานว่า | ความจริง |
|---|---|---|
| `0141` | ผ่าน 31 เคส | security เจอ HIGH **3 ข้อ** — ทั้งหมดอยู่ที่ "ยิง RPC ใหม่ใส่ SKU ที่มีอยู่จริง" ซึ่งไม่มีเคสไหนทดสอบ |
| `0145` | ผ่าน 24 เคส | ไม่จับว่า backfill ทำ `count(distinct updated_at)` ยุบ **7 → 1 ถาวร** |
| `0150` | ผ่าน 10 เคส | บรีฟสั่งให้ยืนยัน "แถวอื่นไม่โดนแตะ" — **ไม่มี assertion นั้นเลย** |

**รูปแบบซ้ำ: "จำนวนเคสที่ผ่าน" ไม่เคยแปลว่า "ข้อที่สั่งถูกตรวจ"**
ตัวเลข `10 PASS / 0 FAIL` ทำหน้าที่ปิดตาไม่ให้ใครเห็นว่าข้อที่สั่งหายไป — ยิ่งเลขสวยยิ่งไม่มีใครไปนับว่าครบไหม

### ผลที่ได้จริงรอบแรกที่ใช้ (0150)

ผู้เขียนส่งตารางมาแล้ว **เขียนตรงๆ ว่า L2 (ช่อง timing probe) ไม่มีเทสต์ครอบ**
พร้อมเหตุผลว่าต้องใช้ 2 connection พร้อมกัน ซึ่ง `do`-block ทรานแซกชันเดียวจำลองไม่ได้
⇒ **ได้ความจริงแทนตัวเลขสวย ตั้งแต่รอบแรกที่บังคับ**

🔴 **หน้าที่ของ Tech Lead**: อ่านตารางนี้แล้วมองหา**ช่องว่าง** ไม่ใช่มองหาเลขเต็ม
ถ้าทุกข้อมีเทสต์ครอบหมดโดยไม่มีข้อไหนเขียนว่า "ไม่มี" เลย — **ให้สงสัยไว้ก่อน** ว่าตารางถูกเติมให้ครบ ไม่ใช่ถูกตรวจจนครบ

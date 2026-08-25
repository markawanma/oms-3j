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
revoke execute on function analytics.ชื่อ(args) from public, anon;
grant  execute on function analytics.ชื่อ(args) to authenticated, service_role;
```

ต้องทำ **ทุกฟังก์ชัน ทุกครั้ง** ที่แตะ — ไม่มีข้อยกเว้น

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

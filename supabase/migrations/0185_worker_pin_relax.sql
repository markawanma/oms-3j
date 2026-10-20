-- 0185_worker_pin_relax.sql — ผ่อนกฎ PIN ช่าง: ขอแค่ตัวเลข 4 หลัก (เจ้าของ 20 ต.ค. 69: "บางคนอยากใช้เลขเบิ้ลจริงๆ ไม่ต้องเข้มกับรหัส PIN")
-- สถานะ: ยังไม่ apply · apply ด้วย node scripts/run-sql.mjs --commit --record เท่านั้น (ห้าม supabase db push) · ชุดทดสอบ scripts/verify/verify-0185.sql · apply หลัง 0184
--
-- ทำไม: job_pin_ok เดิมปฏิเสธเลขซ้ำ (1111) · คู่ซ้ำ (1212) · เรียง (1234/4321 ...) · 0000 · 2580 — ช่างบางคนจำได้แต่เลขแบบนี้ ความปลอดภัยของ PIN ไม่ได้อยู่ที่ความยาก
--       แต่อยู่ที่ด่านล็อกของ worker_pin_verify (ผิด 5 ครั้ง = ล็อก 15 นาที · 6-9 ไม่ล็อก · 10-14 ล็อก 1 ชม. ต่อครั้ง · 15 = ล็อกถาวรจนออฟฟิศปลด · ตัวนับรีเซ็ตทุก 24 ชม.) — ไม่แตะในไฟล์นี้ · + ต้องมี QR ของใบงานก่อนถึงหน้า PIN
--
-- สิ่งที่เปลี่ยน (2 ฟังก์ชัน · signature เดิม · ไม่มี overload):
--  1. job_pin_ok(text) -> เหลือ p_pin ~ '^[0-9]{4}$' (IMMUTABLE · search_path เดิม)
--     - ยอม 1111 · 1212 · 1234 · 0000 · 2580 · 1122 ทั้งหมด · null -> null (ไม่ใช่ true) · '123' '12345' 'abcd' '12a4' ' 1234' '1234 ' '' เลขไทย full-width ขึ้นบรรทัดใหม่ท้ายสตริง = false
--       ([0-9] ช่วงรหัสอักขระ ASCII เท่านั้น · $ ของ regex Postgres ตรงท้ายสตริงเท่านั้น ไม่ข้ามบรรทัดแบบ Perl)
--     - ผู้เรียก worker_upsert / worker_pin_set แยก "ไม่ส่ง PIN (null) = สุ่ม" ออกจาก job_pin_ok อยู่แล้วก่อนเรียก (`if v_pin is null then generate elsif not job_pin_ok`) ⇒ null ไม่มีทางผ่าน job_pin_ok เป็นทางลัด
--  2. job_pin_generate() -> ย้ายกฎ "ไม่ซ้ำ/คู่ซ้ำ/เรียง/0000/2580" มาไว้ในตัวสุ่มเอง (🔴 เบี่ยงจากบรีฟ "ไม่ต้องเปลี่ยน"):
--     ตัวสุ่มเดิมวนจน job_pin_ok ผ่าน = ใช้ job_pin_ok เป็นตัวกรอง "PIN สุ่มห้ามเดาง่าย" ด้วย — พอ job_pin_ok ผ่อน ตัวสุ่มจะเริ่มแจก 1111/1212/1234 ให้ช่างที่กด "รีเซ็ต PIN (สุ่ม)" ราว 1.2% ต่อครั้ง
--     ผ่อนกฎ "ที่คนตั้งเอง" ≠ ผ่อนกฎ "ที่ระบบแจก" ⇒ คงเกณฑ์เดิมเป๊ะในตัวสุ่ม (เนื้อ loop/ความสุ่ม gen_random_bytes เท่าเดิม)
--
-- ไม่แตะ: worker_pin_verify (ด่านล็อกตามนโยบายด้านบน · ตัวนับ) · worker_pin_set (null=สุ่ม · รีเซ็ต = ปลดล็อก + ล้างตัวนับ + session เดิมหมดอายุทันที) · worker_upsert (เพิ่มช่างรับ PIN · แก้ช่างเดิมไม่รับ PIN)
--   ⇒ verify-0185 ล็อก md5 definition ของฟังก์ชันเหล่านี้ไว้ (ต้องไม่ขยับ)
-- หนี้บอกตรงๆ: ข้อความ error ภายใน DB ของ worker_pin_set/worker_upsert ยังเขียนว่า "ห้ามเป็นเลขซ้ำ/เรียงต่อเนื่อง/เดาง่าย" (ไม่ได้ replace 2 ฟังก์ชัน security definer เพื่อแก้ข้อความ) —
--   หน้าจอไม่เห็นข้อความนี้ (ฝั่งแอปแปลงจาก hint pin_invalid -> lib/jobs/messages.ts) · ถ้าจะแก้ให้ตรง ต้อง replace + re-grant 2 ตัวแยกงาน
-- สิทธิ์: ฟังก์ชันทั้งสองเป็นตัวช่วยภายใน (proacl = {postgres=X/postgres} ตั้งแต่ก่อนไฟล์นี้) — revoke 3 ชื่อซ้ำ ไม่ grant ให้ใคร = เท่าเดิมเป๊ะ (ข้อ 2/18 ของ 3j-migration-traps)

create temp table _j185_base on commit drop as
  select p.oid::regprocedure::text as sig, coalesce(p.proacl::text, 'NULL') as acl, p.provolatile::text as vol, coalesce(p.proconfig::text, '-') as cfg
    from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('job_pin_ok', 'job_pin_generate');

-- ============================================================================
-- 1. job_pin_ok — ตัวเลข 4 หลักเท่านั้น (ลอกหัวฟังก์ชันจากฉบับสดบน DB · แก้เฉพาะเนื้อ)
-- ============================================================================
create or replace function analytics.job_pin_ok(p_pin text)
 returns boolean
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select p_pin ~ '^[0-9]{4}$'
$function$;
revoke execute on function analytics.job_pin_ok(text) from public, anon, authenticated;

-- ============================================================================
-- 2. job_pin_generate — PIN ที่ระบบแจกยังห้ามเดาง่าย (เกณฑ์เดิมย้ายมาไว้ที่นี่)
-- ============================================================================
create or replace function analytics.job_pin_generate()
 returns text
 language plpgsql
 set search_path to 'pg_catalog', 'extensions', 'pg_temp'
as $function$
declare
  b bytea;
  v text;
begin
  loop
    b := extensions.gen_random_bytes(4);
    v := lpad((((get_byte(b, 0)::bigint * 16777216 + get_byte(b, 1) * 65536 + get_byte(b, 2) * 256 + get_byte(b, 3)) % 10000))::text, 4, '0');
    -- 0185: เกณฑ์ "เดาง่าย" ของ PIN ที่ระบบสุ่มให้ (เลขซ้ำ/คู่ซ้ำ/เรียง/0000/2580) อยู่ที่นี่ — job_pin_ok ตรวจแค่รูปแบบ
    exit when analytics.job_pin_ok(v)
          and v !~ '^(.)\1{3}$'
          and v !~ '^(..)\1$'
          and v <> all (array['0123', '1234', '2345', '3456', '4567', '5678', '6789', '3210', '4321', '5432', '6543', '7654', '8765', '9876', '0000', '2580']);
  end loop;
  return v;
end;
$function$;
revoke execute on function analytics.job_pin_generate() from public, anon, authenticated;

-- ============================================================================
-- 3. ด่านหลังทำ
-- ============================================================================
do $chk$
declare
  v_bad text;
begin
  if (select count(*) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('job_pin_ok', 'job_pin_generate')) <> 2 then
    raise exception '0185: job_pin_ok/job_pin_generate ต้องมีอย่างละ 1 signature (overload หลุด?)';
  end if;
  select string_agg(b.sig, ', ') into v_bad
    from _j185_base b join pg_proc p on p.oid::regprocedure::text = b.sig
   where (coalesce(p.proacl::text, 'NULL'), p.provolatile::text, coalesce(p.proconfig::text, '-')) is distinct from (b.acl, b.vol, b.cfg);
  if v_bad is not null then
    raise exception '0185: ACL/volatility/search_path เปลี่ยนจากเดิม: %', v_bad;
  end if;
  if not (analytics.job_pin_ok('1111') and analytics.job_pin_ok('1212') and analytics.job_pin_ok('1234') and analytics.job_pin_ok('0000') and analytics.job_pin_ok('2580') and analytics.job_pin_ok('1122')) then
    raise exception '0185: PIN เลขซ้ำ/เรียง/0000 ต้องผ่าน job_pin_ok';
  end if;
  if analytics.job_pin_ok('123') or analytics.job_pin_ok('12345') or analytics.job_pin_ok('abcd') or analytics.job_pin_ok('12a4') or analytics.job_pin_ok(' 1234')
     or analytics.job_pin_ok('') or analytics.job_pin_ok(E'1234\n') or analytics.job_pin_ok('๑๒๓๔') or analytics.job_pin_ok('１２３４') or analytics.job_pin_ok(null) is true then
    raise exception '0185: PIN ผิดรูปแบบต้องไม่ผ่าน job_pin_ok';
  end if;
  raise notice '0185: job_pin_ok ผ่อนแล้ว · ตัวสุ่มคงเกณฑ์เดิม · ACL/search_path เท่าเดิม';
end;
$chk$;

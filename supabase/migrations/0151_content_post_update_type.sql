-- 0151_content_post_update_type.sql
-- security รอบ 2 ตีกลับ H1 (26 ก.ย. 69): updateContentPostType() (lib/actions/
-- content.ts) เคยแก้ content_type_code ของโพสต์เดิมด้วยการเรียก
-- content_post_upsert (0148) ซ้ำ — RPC นั้น upsert บน (shop_id, platform,
-- external_id) ไม่ใช่บน primary key ⇒ ถ้า external_id ที่เก็บไว้จริงกับ
-- external_id ที่ derive จาก post_url ตอนนี้ไม่ตรงกัน (เกิดจริง: เก็บ
-- "https://www.tiktok.com/..." แต่ผู้ใช้แชร์ลิงก์แบบไม่มี www กลับมา) จะได้
-- แถวใหม่แทนการ update แถวเดิม — เงียบ ไม่มี error, ไม่ยิงเน็ตด้วยซ้ำ (ทาง
-- local-canonicalization ของ tiktok-link.ts ไม่ต้องใช้เน็ต).
--
-- security เสนอ assert เทียบ external_id ก่อนเรียกซ้ำ (`expectedExternalId`)
-- ไว้เป็นทางออกชั่วคราว แต่ระบุเองว่า "เป็นปลาสเตอร์ ไม่ใช่การรักษา" — ของ
-- จริงคือ RPC ที่ update ด้วย primary key ตรงๆ ไม่ยุ่งกับ URL เลย ซึ่งเป็น
-- สิ่งที่ comment เดิมของ updateContentPostType() (0148 ตอนเขียน) เสนอไว้เอง
-- อยู่แล้ว ("Real fix ... a content_post_update_type(p_post_id,
-- p_content_type_code) RPC that updates by primary key") — ไฟล์นี้คือของนั้น.
--
-- Additive only: create function ใหม่ล้วน ไม่แก้ตาราง/ฟังก์ชัน/view เดิมแม้แต่
-- บรรทัดเดียว (analytics.content_post เดิมมีคอลัมน์ content_type_code +
-- trigger updated_at อยู่แล้วตั้งแต่ 0148).
--
-- ============================================================================
-- 🔴 ตัดสินใจนอกบรีฟ (26 ก.ย. 69):
--
-- 1. p_content_type_code ไม่มี default และห้าม null เด็ดขาด (raise ถ้า null) —
--    ต่างจากทั้ง 2 แพตเทิร์นที่มีอยู่แล้วในโปรเจกต์: content_post_upsert (0148)
--    null = ไม่แตะค่าเดิม (null-preserving) · campaign_step_set_content_type
--    (0150) null = ล้างค่าจริง ฟังก์ชันนี้เป็นความหมายที่ 3 คือ "ห้ามส่ง null
--    มาเลย" เพราะ ContentPostLinkForm (ทางเดียวที่เรียกฟังก์ชันนี้) บังคับเลือก
--    ประเภทก่อนกดบันทึกอยู่แล้ว (disabled={!editTypeValue}, H3 fix เดิม) —
--    null ที่มาถึงชั้นนี้จึงแปลว่ามีบั๊กฝั่งเรียก ไม่ใช่ผู้ใช้ตั้งใจล้างค่า
--    ฟังก์ชันนี้ไม่มีทางล้าง content_type_code เป็น null ได้เลย — ถ้าต้องการ
--    ทางนั้นในอนาคต ให้ทำฟังก์ชัน/พารามิเตอร์ใหม่ที่ตั้งใจแยกจากกัน ไม่ใช่เพิ่ม
--    ความหมายที่ 4 ของ null ให้จำยากขึ้นอีก.
--
-- 2. content_type_code ที่ is_active=false — เลือก "ยังแท็กได้" (เหมือน 0148's
--    content_post_upsert) ไม่ใช่ "ปฏิเสธ" (เหมือน 0150's
--    campaign_step_set_content_type, L1 decision ของ Tech Lead วันนั้น) —
--    เหตุผล: ฟังก์ชันนี้เป็นทางแก้ content_post.content_type_code โดยตรง
--    (คอลัมน์เดียวกับที่ content_post_upsert เขียน) ควรมีพฤติกรรมสอดคล้องกับ
--    ทางเขียนอีกทางของ "ตารางเดียวกัน คอลัมน์เดียวกัน" มากกว่าทางเขียนของ
--    ตารางอื่น (campaign_step) แม้ชื่อพารามิเตอร์จะซ้ำกัน — ถ้า Tech Lead
--    อยากให้สองตารางนี้เข้ากฎเดียวกัน (ปฏิเสธ is_active=false ทั้งคู่) แจ้งกลับ
--    มาแก้เป็น migration ต่อได้ ไม่ยาก (เงื่อนไข exists เดียว).
--
-- 3. ลำดับด่าน (เหมือน 0148/0150 ทุกไฟล์): null check -> crm_require_owner_admin
--    (กัน probe ก่อน validate อื่น) -> validate content_type_code -> ownership
--    (select...for update ที่มี shop_id ใน WHERE, กับดักจาก 0150 L2) -> เช็ค
--    status='active' -> update. content_type_code validate มาก่อน ownership
--    ในไฟล์นี้ (ต่างจาก 0150 ที่ ownership มาก่อน) เพราะ content_type เป็น
--    global reference data ไม่ผูก shop — เช็คก่อนไม่เปิดช่อง probe อะไร (ไม่มี
--    per-shop data ให้รั่ว) ในขณะที่ ownership check ของ content_post (ผูก
--    shop) ต้องมาก่อนการเช็คอื่นที่อาจ leak ว่าโพสต์นั้นมีอยู่จริงไหม/สถานะไหน
--    (status='active' check) — สอดคล้องกับเหตุผลเดิมของ 0150 ข้อ 5.
--
-- 4. updated_at ของ content_post — ปล่อยให้ trigger ยิงตามปกติ (ไม่ปิด) ด้วย
--    เหตุผลเดียวกับ 0150 ข้อ 4: การเรียกครั้งนี้คือมนุษย์ตั้งใจแก้โพสต์เดียวที่
--    ระบุ id ตรงๆ ผ่านหน้าจอ ไม่ใช่ WHERE กว้างที่กวาดหลายแถว (3j-migration-
--    traps #19 คุ้มครองกรณี backfill กวาดแถว ไม่ใช่กรณีนี้).
-- ============================================================================

drop function if exists analytics.content_post_update_type(uuid, uuid, text);

create function analytics.content_post_update_type(
  p_shop_id uuid,
  p_post_id uuid,
  p_content_type_code text
) returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if p_shop_id is null or p_post_id is null then
    raise exception 'content_post_update_type: p_shop_id, p_post_id เป็นค่าจำเป็น';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);  -- ด่านสิทธิ์ก่อน validate อื่น (กัน probe)

  -- 🔴 ห้าม null เด็ดขาด (ต่างจากทั้ง null-preserving ของ 0148 และ
  -- null=ล้างค่าของ 0150 — ดูคอมเมนต์หัวไฟล์ข้อ 1) — UI บังคับเลือกประเภทก่อน
  -- กดบันทึกอยู่แล้ว (ContentPostLinkForm's disabled={!editTypeValue}) ⇒ null
  -- ที่มาถึงชั้นนี้แปลว่ามีบั๊กฝั่งเรียก ไม่ใช่ผู้ใช้ตั้งใจล้างค่า
  if p_content_type_code is null then
    raise exception 'content_post_update_type: p_content_type_code ห้ามเป็นค่าว่าง — ฟังก์ชันนี้ไม่มีทางล้างประเภทเป็นค่าว่างได้' using errcode = '22023';
  end if;

  -- content_type เป็น global reference data ไม่ผูก shop ⇒ เช็คก่อน ownership
  -- ได้เลย ไม่เปิดช่อง probe อะไร (ตัดสินใจข้อ 3 ด้านบน)
  if not exists (
    select 1 from analytics.content_type where code = p_content_type_code
  ) then
    raise exception 'content_post_update_type: content_type_code ไม่ถูกต้อง: %', p_content_type_code using errcode = '22023';
  end if;

  -- ล็อกเฉพาะแถวที่ shop_id ตรงตั้งแต่ WHERE ของ for update (กับดักจาก 0150 L2)
  -- — ถ้า select ก่อนไม่กรอง shop_id แล้วค่อยเทียบทีหลัง จะล็อกแถวของร้านอื่น
  -- ทิ้งไว้จนจบ transaction ก่อนปฏิเสธ เปิดช่อง timing probe เหมือนกัน
  select cp.status into v_status
  from analytics.content_post as cp
  where cp.id = p_post_id and cp.shop_id = p_shop_id
  for update;

  if not found then
    raise exception 'content_post_update_type: ไม่พบโพสต์ % ในร้านนี้', p_post_id using errcode = '22023';
  end if;

  -- โพสต์ที่ deleted/private แล้ว (0148's L1) ห้ามแก้ประเภทอีก — ต้องเปิดกลับ
  -- เป็น active ผ่าน content_post_set_status ก่อนเอง (ไม่ auto-reactivate,
  -- เหตุผลเดียวกับ content_post_upsert's L1: deleted อาจแปลว่าโพสต์ถูกลบจริง
  -- บน TikTok ไม่ใช่แค่ตั้งค่าในระบบเราผิด)
  if v_status <> 'active' then
    raise exception 'content_post_update_type: โพสต์นี้ (id=%) มีสถานะ ''%'' อยู่ — แก้ประเภทได้เฉพาะโพสต์ที่ยัง active เท่านั้น (เปิดกลับผ่าน content_post_set_status ก่อน แล้วค่อยเรียกซ้ำ)',
      p_post_id, v_status using errcode = '22023';
  end if;

  update analytics.content_post as cp
  set content_type_code = p_content_type_code,
      updated_at = now()
  where cp.id = p_post_id and cp.shop_id = p_shop_id;
end;
$$;

comment on function analytics.content_post_update_type(uuid, uuid, text) is
  'แก้ analytics.content_post.content_type_code โดยตรงด้วย primary key (p_post_id) — '
  'ไม่แตะ post_url/external_id เลย ต่างจากการเรียก content_post_upsert ซ้ำ (ของเดิมก่อน '
  '0151, upsert บน shop_id/platform/external_id ⇒ external_id ไม่ round-trip กับ post_url '
  'ที่เก็บจริง = สร้างแถวใหม่แทนการแก้แถวเดิมแบบเงียบๆ, security H1 26 ก.ย. 69). '
  'p_content_type_code ห้ามเป็น null เด็ดขาด (raise) — ไม่ใช่ null-preserving แบบ 0148 '
  'และไม่ใช่ null=ล้างค่าแบบ 0150 (ดูคอมเมนต์หัวไฟล์). ปฏิเสธถ้าโพสต์สถานะไม่ใช่ active.';

revoke execute on function analytics.content_post_update_type(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function analytics.content_post_update_type(uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';

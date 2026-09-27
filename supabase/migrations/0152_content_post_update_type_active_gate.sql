-- 0152_content_post_update_type_active_gate.sql
-- security รอบ 3 (27 ก.ย. 69) M-d: analytics.content_post_update_type (0151)
-- เช็คแค่ว่า content_type.code นั้นมีอยู่จริง ไม่เช็คว่ายัง is_active — ต่างจาก
-- analytics.campaign_step_set_content_type (0150) ที่ปฏิเสธ code ที่ปลดระวางแล้ว
-- (0150's L1 decision) ทั้งที่ทั้งสองฟังก์ชันเป็นทางเขียน content_type_code ของ
-- ตารางคนละใบแต่คอลัมน์เดียวกันในทางความหมาย.
--
-- ผลจริงถ้าไม่ปิด: getContentTypes() (lib/actions/content.ts) กรอง is_active=true
-- อยู่แล้ว ⇒ UI ปกติไม่มีทางเสนอ code ที่ปิดแล้วให้เลือก แต่ RPC ตัวนี้ไม่มีอะไร
-- บล็อกคนที่ยิง code ที่ปิดแล้วตรงๆ (เช่น ผ่าน tool เรียก RPC ตรง ไม่ผ่านหน้าจอ)
-- — ถ้าเกิดขึ้นจริง ContentPostLinkForm.tsx's matchedType (หา code ในลิสต์ที่
-- ยัง active) จะหาไม่เจอ แล้วจอขึ้น "ยังไม่ระบุประเภท" ทั้งที่ DB มีค่าอยู่จริง —
-- จอกับ DB เถียงกันเงียบๆ. ปฏิเสธที่ชั้น RPC ปิดช่องนี้ตรงจุด ไม่ต้องพึ่งแค่ชั้น UI.
--
-- Additive-only ในทางโครงสร้าง: signature เดิมทุกตัว (p_shop_id uuid, p_post_id
-- uuid, p_content_type_code text) ไม่เปลี่ยน ⇒ create or replace ปลอดภัย ไม่ต้อง
-- drop ก่อน (3j-migration-traps #1 ใช้ไม่เข้ากรณีนี้เพราะ arg list เท่าเดิมเป๊ะ) —
-- แต่ยัง revoke/grant ใหม่ครบเสมอเพราะ create or replace ทำให้ grant หายทุกครั้ง
-- (3j-migration-traps #2).
--
-- เปลี่ยนแค่จุดเดียวจาก 0151: เงื่อนไข exists เพิ่ม `and is_active` + ข้อความ
-- raise ให้ตรงกับความจริงมากขึ้น ("ไม่ถูกต้องหรือถูกปลดระวางแล้ว" เหมือน 0150) —
-- ทุกอย่างอื่น (ลำดับด่าน, ownership check, status='active' gate, updated_at) เหมือน
-- 0151 เป๊ะ ไม่แตะ.
--
-- ⚠️ ห้าม apply เอง — Tech Lead apply ให้ (บรีฟ 27 ก.ย. 69).

create or replace function analytics.content_post_update_type(
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
  -- null=ล้างค่าของ 0150 — ดูคอมเมนต์หัวไฟล์ 0151 ข้อ 1) — UI บังคับเลือกประเภทก่อน
  -- กดบันทึกอยู่แล้ว (ContentPostLinkForm's disabled={!editTypeValue}) ⇒ null
  -- ที่มาถึงชั้นนี้แปลว่ามีบั๊กฝั่งเรียก ไม่ใช่ผู้ใช้ตั้งใจล้างค่า
  if p_content_type_code is null then
    raise exception 'content_post_update_type: p_content_type_code ห้ามเป็นค่าว่าง — ฟังก์ชันนี้ไม่มีทางล้างประเภทเป็นค่าว่างได้' using errcode = '22023';
  end if;

  -- 🔴 M-d fix (security รอบ 3, 27 ก.ย. 69): เพิ่ม `and is_active` — เดิม
  -- (0151) เช็คแค่ว่า code มีอยู่จริง ไม่เช็คว่ายัง active ⇒ ให้แท็ก code ที่
  -- ปลดระวางแล้วได้ ต่างจากพี่น้องของมัน campaign_step_set_content_type (0150,
  -- L1) ที่ปฏิเสธไปแล้ว. content_type เป็น global reference data ไม่ผูก shop
  -- ⇒ เช็คก่อน ownership ได้เลย ไม่เปิดช่อง probe อะไร (ตัดสินใจข้อ 3 ของ 0151).
  if not exists (
    select 1 from analytics.content_type where code = p_content_type_code and is_active
  ) then
    raise exception 'content_post_update_type: content_type_code ไม่ถูกต้องหรือถูกปลดระวางแล้ว: %', p_content_type_code using errcode = '22023';
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
  'และไม่ใช่ null=ล้างค่าแบบ 0150 (ดูคอมเมนต์หัวไฟล์ 0151). ปฏิเสธถ้าโพสต์สถานะไม่ใช่ active. '
  'ปฏิเสธ content_type_code ที่ is_active=false ด้วย (0152, M-d — เข้ากฎเดียวกับ '
  'campaign_step_set_content_type''s L1 แล้ว).';

-- create or replace ทำให้ grant หายทุกครั้ง (3j-migration-traps #2) — re-grant
-- ครบทั้งสามชื่อเสมอ (public/anon/authenticated), analytics ปิด REST ให้
-- authenticated/anon ทั้งสคีมาแล้วตั้งแต่ 0123 (3j-migration-traps #18).
revoke execute on function analytics.content_post_update_type(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function analytics.content_post_update_type(uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';

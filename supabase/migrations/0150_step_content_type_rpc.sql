-- 0150_step_content_type_rpc.sql
-- ปิดช่องที่ Tech Lead พลาดเองใน 0145: เพิ่มคอลัมน์
-- analytics.campaign_step.content_type_code (FK -> analytics.content_type) แต่
-- ไม่เคยทำ RPC ให้เขียนค่านั้นเลย — ตรวจแล้ว RPC ทั้ง 5 ตัวที่แตะ campaign_step
-- (campaign_create_from_template / campaign_create_task / campaign_pass_gate /
-- campaign_reschedule_step / campaign_set_artifact_status) ไม่มีตัวไหนเขียน
-- content_type_code เลย ⇒ ปฏิทินแบ่งสีตามประเภทคอนเทนต์ไม่ได้ทั้งที่คอลัมน์กับสี
-- พร้อมมาตั้งแต่ 0145 (บทเรียนเดียวกับ clip_brief.meta.linked_sku_ids ที่กรอกจริง
-- 0/65 แถวเพราะไม่มีทางเขียน — ห้ามเกิดซ้ำ).
--
-- Additive only: create function ใหม่ล้วน ไม่แก้ตาราง/ฟังก์ชัน/view เดิมแม้แต่
-- บรรทัดเดียว (v_campaign_board มีคอลัมน์ content_type_code อยู่แล้วตั้งแต่ 0145).
--
-- ============================================================================
-- 🔴 ตัดสินใจนอกบรีฟ / ยืนยันของจริงบน DB ก่อน apply (25 ก.ย. 69):
--
-- 1. เลข migration: 0147_revoke_legacy_grants มีอีก session ทำอยู่ ยังไม่ apply
--    ⇒ ใช้ 0150 ตามที่ Tech Lead สั่ง ข้าม 0147 ไปเลย ไม่ไปชนไฟล์เดียวกัน.
--
-- 2. content_type_code ที่ไม่ถูกต้อง — เลือก "raise พร้อมข้อความอ่านรู้เรื่อง"
--    ไม่ปล่อยให้ FK ตีตกเฉยๆ (แม้ FK ยังอยู่เป็น defense-in-depth ชั้นสอง) —
--    ตามแพตเทิร์นเดียวกับ content_post_upsert (0148) ที่เช็คซ้ำกับ FK/CHECK
--    ของตารางเพื่อให้ error message ที่ฝั่งเรียกอ่านแล้วรู้ว่าต้องแก้อะไร
--    แทนที่จะได้ "insert or update on table violates foreign key constraint"
--    ดิบๆ ที่ไม่บอกว่าเป็นพารามิเตอร์ไหนที่ผิด. ชุดทดสอบ T3 ด้านล่างตรงกับ
--    ทางเลือกนี้ (ตรวจ SQLSTATE 22023 ไม่ใช่ foreign_key_violation).
--
-- 3. p_content_type_code ไม่มี default — บรีฟระบุ signature 3 พารามิเตอร์ไม่มี
--    default ไว้ชัดแล้ว และการให้ default null ในเคสนี้อันตรายกว่าปกติ:
--    ต่างจาก content_post_upsert ที่ null=ไม่แตะ (ลืมส่ง = ไม่มีผล) ฟังก์ชันนี้
--    null=ล้างค่า (ลืมส่ง = ล้างป้ายที่ตั้งใจแท็กไว้ทิ้งเงียบๆ) จึงบังคับให้ผู้
--    เรียกส่งค่าที่ตั้งใจทุกครั้ง ไม่มีทางเรียกพลาดโดยไม่รู้ตัว.
--
-- 4. updated_at ของ campaign_step — trg_campaign_step_updated_at (BEFORE UPDATE
--    -> public.set_updated_at(), ไม่มีเงื่อนไข, ยืนยันด้วย pg_get_triggerdef
--    สดวันนี้) ปล่อยให้ยิงตามปกติ ไม่ปิด trigger ต่างจาก 0145 ที่เป็น backfill
--    อัตโนมัติของระบบข้าม step_kind หลายสิบแถวพร้อมกัน (3j-migration-traps #19)
--    ที่นี่เป็นคนละสถานการณ์: ทุกครั้งที่ฟังก์ชันนี้ถูกเรียก คือมนุษย์ (owner/admin)
--    ตั้งใจแก้ step เดียวที่ระบุ id ตรงๆ ผ่านหน้าจอ ไม่ใช่ WHERE กว้างที่กวาดแถว
--    ที่ไม่ได้ตั้งใจแตะมาด้วย — ตรงกับสิ่งที่ trigger นี้ถูกออกแบบมาให้บันทึก
--    (แพตเทิร์นเดียวกับ content_post_set_status/campaign_set_artifact_status ที่
--    set updated_at=now() ทุกครั้งที่ถูกเรียก ไม่เช็คว่าค่าจริงเปลี่ยนไหมก่อน)
--    T5 ด้านล่างพิสูจน์ว่ามันขยับจริงตามที่ตั้งใจ (ไม่ใช่แค่เชื่อคำอธิบาย).
--
-- 5. ลำดับด่าน: permission (crm_require_owner_admin) -> ownership ของ step ->
--    validate content_type_code -> update. ownership check มาก่อน validate
--    เจตนา (กันช่อง probe: อยากรู้ว่า step ของร้านอื่นมีอยู่จริงไหม ไม่ควรตอบ
--    ต่างกันระหว่าง "content_type ผิด" กับ "step ไม่ใช่ของร้านนี้"). "step ไม่พบ"
--    กับ "step เป็นของร้านอื่น" รวมเป็นข้อความเดียวกัน (ตามแพตเทิร์น
--    content_post_set_status) ด้วยเหตุผลเดียวกัน — ไม่บอกฝั่งเรียกว่า step id
--    นั้นมีอยู่จริงแต่อยู่ร้านอื่น.
--
-- 🔴 แก้รอบ security review (25 ก.ย. 69):
--
-- L1 (Tech Lead ชี้ขาด, รับ): content_type_code ที่ is_active=false ยังแท็กได้
--    เดิม — 0145 ใส่ is_active มาเพื่อ "ปลดระวางประเภท" โดยเฉพาะ ⇒ ตอนนี้เช็ค
--    `and is_active`. trade-off ที่รับแล้ว: step ที่แท็กด้วย code ที่ถูกปลด
--    ระวางภายหลัง จะ "เซฟทับด้วย code เดิมซ้ำ" ไม่ได้อีก (แต่ค่าเดิมในแถวยังอยู่
--    ไม่หาย เปลี่ยนไปแท็กประเภทอื่นที่ยัง active แทนได้).
--
-- L2 (security เสนอ): select ... for update เดิมไม่มี shop_id ในเงื่อนไข ⇒ ล็อก
--    แถวของร้านอื่นทิ้งไว้จนจบ transaction ก่อนจะค่อยปฏิเสธ เปิดช่อง timing
--    probe (ยิง step ของร้านอื่นที่กำลังถูกล็อกจากคำขออื่นพร้อมกัน = ค้างรอ
--    ต่างจากยิง id ที่ไม่มีจริงเลย = ตอบทันที) ⇒ ย้าย shop_id เข้าเงื่อนไข WHERE
--    ของ select ... for update ตรงๆ ใช้ `perform 1 ... if not found` แทนการ
--    เก็บ shop_id มาเทียบทีหลัง — ตัด v_actual_shop_id ออกทั้งตัว.
-- ============================================================================

drop function if exists analytics.campaign_step_set_content_type(uuid, uuid, text);

create function analytics.campaign_step_set_content_type(
  p_shop_id uuid,
  p_step_id uuid,
  p_content_type_code text
) returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if p_shop_id is null or p_step_id is null then
    raise exception 'campaign_step_set_content_type: p_shop_id, p_step_id เป็นค่าจำเป็น';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);  -- ด่านสิทธิ์ก่อน validate อื่น (กัน probe)

  -- ล็อกเฉพาะแถวที่ shop_id ตรงตั้งแต่ WHERE (L2, security 25 ก.ย. 69) — ถ้า
  -- select ก่อนไม่กรอง shop_id แล้วค่อยเทียบทีหลัง จะล็อกแถวของร้านอื่นทิ้งไว้
  -- จนจบ transaction ก่อนปฏิเสธ เปิดช่อง timing probe (step ร้านอื่นที่กำลังถูก
  -- ล็อกจากคำขอพร้อมกัน = ค้างรอ ต่างจาก step ที่ไม่มีจริงเลย = ตอบทันที)
  perform 1 from analytics.campaign_step cs
  where cs.id = p_step_id and cs.shop_id = p_shop_id
  for update;

  if not found then
    raise exception 'campaign_step_set_content_type: ไม่พบ step % ในร้านนี้', p_step_id using errcode = '22023';
  end if;

  -- L1 (Tech Lead ชี้ขาด, 25 ก.ย. 69): code ที่ is_active=false ปลดระวางแล้ว
  -- ห้ามแท็กเพิ่ม (แถวที่แท็กไว้อยู่แล้วด้วย code นั้นก่อนปลดระวางยังอยู่ ไม่หาย)
  if p_content_type_code is not null and not exists (
    select 1 from analytics.content_type where code = p_content_type_code and is_active
  ) then
    raise exception 'campaign_step_set_content_type: content_type_code ไม่ถูกต้องหรือถูกปลดระวางแล้ว: %', p_content_type_code using errcode = '22023';
  end if;

  -- 🔴 null ที่นี่แปลว่า "ล้างค่า" จริง — ต่างจากแพตเทิร์น null-preserving ของ
  -- content_post_upsert (0148) ที่ null=ไม่แตะค่าเดิม เพราะฟังก์ชันนี้เป็นทาง
  -- เดียวที่ผู้ใช้ถอนป้ายประเภทออกได้ (เช่น แท็กผิดแล้วอยากเคลียร์กลับเป็นว่าง)
  -- ถ้าทำ null-preserving แบบเดิม จะไม่มีทาง set กลับเป็น null ได้อีกเลย.
  update analytics.campaign_step as cs
  set content_type_code = p_content_type_code,
      updated_at = now()
  where cs.id = p_step_id and cs.shop_id = p_shop_id;
end;
$$;

comment on function analytics.campaign_step_set_content_type(uuid, uuid, text) is
  'เส้นทางเดียวที่เขียน analytics.campaign_step.content_type_code (คอลัมน์นี้เพิ่มมาตั้งแต่ '
  '0145 แต่ไม่เคยมี RPC เขียน — 0150 ปิดช่องนี้). p_content_type_code = null คือ ''ล้างค่า'' จริง '
  '(ต่างจาก null-preserving ของ content_post_upsert โดยตั้งใจ — ผู้ใช้ต้องถอนป้ายออกได้). '
  'ไม่มี default พารามิเตอร์ตัวไหนเลย — บังคับผู้เรียกส่งค่าที่ตั้งใจทุกครั้ง กันเผลอ. '
  'code ที่ content_type.is_active=false ถูกปฏิเสธ (L1) — ปลดระวางแล้วแท็กเพิ่มไม่ได้, ค่าเดิมที่แท็ก '
  'ไว้ก่อนปลดระวางไม่ถูกลบ. updated_at ของ campaign_step ขยับตามปกติทุกครั้งที่เรียก (ไม่ปิด trigger — '
  'เป็นการแก้โดยคนทีละ step ไม่ใช่ backfill กวาดหลายแถว, ต่างจาก 0145).';

revoke execute on function analytics.campaign_step_set_content_type(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function analytics.campaign_step_set_content_type(uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';

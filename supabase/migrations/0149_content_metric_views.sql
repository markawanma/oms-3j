-- 0149_content_metric_views.sql
-- P2 ของชั้นวัดผล content (ต่อจาก 0148) — 2 view อ่าน:
--   v_content_post_t7      = snapshot อายุใกล้ 7 วันที่สุดต่อโพสต์ + save/share rate
--   v_content_entry_queue  = คิวบอกว่าวันนี้ต้องอ่านตัวเลขของโพสต์ไหน (หน้าต่างอายุ)
--
-- Additive only: create view ใหม่ล้วน ไม่แตะ view/ตารางเดิมที่มีอยู่แล้ว.
--
-- ============================================================================
-- 🔴 รอบ 2 (23 ก.ย. 69) — แก้ตามรายงาน security-auditor (ดูหัวไฟล์ 0148 สำหรับ
-- บริบทเต็ม H1/H2/H3/M1/L1/L2/L3/L4/L7/M5):
--
-- H3 (ชั้นอ่านคู่กับ 0148) — 0148 ปิดช่องแถวว่างที่ชั้นเขียนแล้ว (ต้องมีตัวเลข
--    จริง >=1 ค่า) แต่แถวเก่า/backfill ที่ไม่ผ่าน RPC (เช่น seed ตรงผ่าน
--    service_role) ยังอาจว่างทั้ง 5 ช่องได้ ⇒ v_content_entry_queue ต้องเช็ค
--    "มีตัวเลขจริงไหม" (num_nonnulls > 0) ไม่ใช่แค่ "มีแถวไหม" กันสองชั้น.
-- M3 — โพสต์อายุ 5-9 วันที่ยังไม่มี snapshot ได้ข้อความ 'ไม่มีข้อมูลช่วง T+7'
--    เหมือนกับโพสต์อายุเลย 9 วันไปแล้ว ทั้งที่ยังเก็บทัน (หน้าต่าง [5,9] ยังไม่ปิด)
--    ⇒ แยกสถานะกลาง 'อยู่ในช่วง T+7 ยังเก็บทัน แต่ยังไม่ได้กรอก' สำหรับอายุ 5-9
--    ที่ยังไม่มี snapshot — 'ไม่มีข้อมูลช่วง T+7' เหลือไว้เฉพาะอายุ >9 จริงๆ เท่านั้น
--    (ต่อท้าย case, ไม่สลับลำดับคอลัมน์เดิม).
-- M4 — เดิมใช้ "วันเป๊ะ" (age=1/3/7) ขัดกับชั้นอ่าน T+7 ที่ใช้หน้าต่าง [5,9] เอง
--    ⇒ พลาดวันเดียว (เช่น age=7 วันนั้นลืมกรอก) = หลุดจากคิวถาวรไม่มีวันกลับมา
--    ⇒ เปลี่ยนเป็นหน้าต่างอายุ 3 ช่วง (1-2, 3-4, 5-9) ให้สอดคล้องกับ T+7 —
--    ยังไม่มีตัวเลขในหน้าต่างไหน ⇒ อยู่ในคิวของหน้าต่างนั้นจนกว่าจะปิด (ไม่ใช่แค่
--    วันเดียว) และยังปิดตัวเองเมื่อหน้าต่างปิดจริง (ไม่ค้างถาวรข้ามหน้าต่าง).
-- ============================================================================

-- ============================================================================
-- 1. analytics.v_content_post_t7 — snapshot ที่อายุใกล้ 7 ที่สุดในช่วง [5,9] ต่อโพสต์
--
-- 🔴 โพสต์ที่ไม่มี snapshot ในช่วงนี้ต้องได้ null พร้อมเหตุผลที่คนอ่านรู้เรื่อง — ห้ามเอา
-- ค่าล่าสุดมาแทนเงียบๆ (คำนวณไม่ได้ = ตก ไม่ใช่ผ่าน). 3 เหตุผลแยกกัน (M3 เพิ่มตัวกลาง):
--   'ยังไม่ถึง 7 วัน'                          = วันนี้ (เวลาไทย) − posted_date_th < 5
--   'อยู่ในช่วง T+7 ยังเก็บทัน แต่ยังไม่ได้กรอก'  = อายุอยู่ใน [5,9] แต่ไม่มี snapshot ในช่วงนี้
--                                                    (หน้าต่างยังไม่ปิด ยังเก็บทัน)
--   'ไม่มีข้อมูลช่วง T+7'                        = อายุเลย 9 วันไปแล้ว หน้าต่างปิดแล้วจริง
--                                                    และไม่มีแถว metric ตกอยู่ใน [5,9] เลย
-- ============================================================================

create or replace view analytics.v_content_post_t7
  with (security_invoker = true) as
select
  p.id as post_id,
  p.shop_id,
  p.platform,
  p.external_id,
  p.post_url,
  p.posted_at,
  p.posted_date_th,
  p.content_type_code,
  p.status,
  t7.captured_on as t7_captured_on,
  t7.age_days as t7_age_days,
  t7.view_count as t7_view_count,
  t7.like_count as t7_like_count,
  t7.comment_count as t7_comment_count,
  t7.save_count as t7_save_count,
  t7.share_count as t7_share_count,
  t7.is_regression as t7_is_regression,
  -- null-safe: nullif(...,0) กันหารศูนย์, view_count null ⇒ ผลลัพธ์ null (ไม่ error, ไม่ใช่ 0)
  case when t7.save_count is null or t7.view_count is null then null
       else round(t7.save_count::numeric / nullif(t7.view_count, 0), 4)
  end as save_rate,
  case when t7.share_count is null or t7.view_count is null then null
       else round(t7.share_count::numeric / nullif(t7.view_count, 0), 4)
  end as share_rate,
  -- 🔴 M3 (security round 2): เพิ่มสถานะกลางสำหรับอายุ 5-9 ที่หน้าต่างยังไม่ปิด —
  -- ต่อท้าย case เดิม ไม่สลับลำดับเงื่อนไขที่มีอยู่แล้ว
  case
    when t7.post_id is not null then null
    when ((now() at time zone 'Asia/Bangkok')::date - p.posted_date_th) < 5 then 'ยังไม่ถึง 7 วัน'
    when ((now() at time zone 'Asia/Bangkok')::date - p.posted_date_th) <= 9 then 'อยู่ในช่วง T+7 ยังเก็บทัน แต่ยังไม่ได้กรอก'
    else 'ไม่มีข้อมูลช่วง T+7'
  end as t7_unavailable_reason
from analytics.content_post p
left join lateral (
  select m.* from analytics.content_post_metric m
  where m.post_id = p.id and m.age_days between 5 and 9
  -- ใกล้ 7 ที่สุดก่อน · ห่างเท่ากัน (เช่น มีแค่ age=5 กับ age=9) เลือก age มากกว่า
  -- (ข้อมูลนิ่งกว่า/ผ่านมานานกว่า) — ตัดสินใจเอง ไม่ได้ระบุในบรีฟ ตรงกับ tie-break
  -- เดียวกับ v_live_night_locked (0146) เพื่อความสม่ำเสมอทั้งโปรเจกต์
  order by abs(m.age_days - 7), m.age_days desc, m.captured_on desc
  limit 1
) t7 on true;

comment on view analytics.v_content_post_t7 is
  'Snapshot engagement ที่อายุใกล้ 7 วันที่สุด (ช่วง [5,9]) ต่อโพสต์ + save_rate/share_rate '
  'null-safe. โพสต์ที่ไม่มี snapshot ในช่วงนี้ได้ค่า metric เป็น null ทั้งหมด พร้อม '
  't7_unavailable_reason อธิบายว่าทำไม 3 สถานะ (ยังไม่ถึง 7 วัน / อยู่ในช่วงยังเก็บทันแต่ยังไม่ได้ '
  'กรอก / ไม่มีข้อมูลช่วง T+7 เพราะหน้าต่างปิดแล้วจริง, M3) — ห้ามใช้ค่าล่าสุดแทนเงียบๆ.';

grant select on analytics.v_content_post_t7 to service_role;

-- ============================================================================
-- 2. analytics.v_content_entry_queue — คิวบอกว่าวันนี้ต้องอ่านโพสต์ไหน
--
-- 🔴 M4 (security round 2): เปลี่ยนจาก "วันเป๊ะ" (age=1/3/7) เป็นหน้าต่างอายุ
-- 3 ช่วง (1-2, 3-4, 5-9) ให้สอดคล้องกับ v_content_post_t7 ที่ใช้หน้าต่าง [5,9]
-- อยู่แล้ว — พลาดวันเดียวไม่ทำให้หลุดจากคิวถาวรอีกต่อไป (ยังอยู่ในคิวจนกว่า
-- หน้าต่างนั้นจะปิดจริง). 3 หน้าต่างไม่ทับกัน ⇒ 1 โพสต์ตรงได้อย่างมากแค่หน้าต่าง
-- เดียวต่อครั้ง (ไม่มีแถวซ้ำ).
--
-- 🔴 H3 (ชั้นอ่าน): "มีแล้ว" ต้องแปลว่า "มีตัวเลขจริง" ไม่ใช่ "มีแถว" — เพิ่ม
-- num_nonnulls(...) > 0 กันแถวว่าง (เช่น จาก backfill/seed ที่ไม่ผ่าน RPC ของ
-- 0148 ซึ่งปิดช่องนี้แล้วที่ชั้นเขียน) เตะโพสต์ออกจากคิวถาวรทั้งที่ไม่มีตัวเลขจริงเลย.
-- ============================================================================

create or replace view analytics.v_content_entry_queue
  with (security_invoker = true) as
select
  p.id as post_id,
  p.shop_id,
  p.platform,
  p.external_id,
  p.post_url,
  p.posted_at,
  p.posted_date_th,
  p.content_type_code,
  ((now() at time zone 'Asia/Bangkok')::date - p.posted_date_th) as age_days_today,
  r.read_round
from analytics.content_post p
cross join lateral (
  values (1, 1, 2), (2, 3, 4), (3, 5, 9)
) as r(read_round, lo, hi)
where p.status = 'active'
  and ((now() at time zone 'Asia/Bangkok')::date - p.posted_date_th) between r.lo and r.hi
  and not exists (
    select 1 from analytics.content_post_metric m
    where m.post_id = p.id
      and m.age_days between r.lo and r.hi
      -- H3: แถวที่ไม่มีตัวเลขจริงเลย (ทุกคอลัมน์นับเป็น null) ไม่นับว่า "อ่านแล้ว"
      and num_nonnulls(m.view_count, m.like_count, m.comment_count, m.save_count, m.share_count) > 0
  )
order by p.posted_at desc;

comment on view analytics.v_content_entry_queue is
  'คิวโพสต์ที่ต้องอ่านตัวเลขวันนี้ — age_days วันนี้ตกอยู่ในหน้าต่าง 1-2/3-4/5-9 (M4, '
  'สอดคล้องกับ v_content_post_t7), status=active, ยังไม่มี metric ที่มีตัวเลขจริง '
  '(num_nonnulls>0, H3) ตกอยู่ในหน้าต่างเดียวกัน. read_round = หน้าต่างที่เท่าไร '
  '(1=อายุ1-2, 2=อายุ3-4, 3=อายุ5-9). พลาดวันเดียวไม่หลุดจากคิวถาวร — ยังอยู่จนกว่าหน้าต่าง '
  'จะปิด (อายุเกิน 9) หรือมีตัวเลขจริงถูกกรอกในหน้าต่างนั้นแล้ว · deleted/private ไม่เข้าคิว '
  '(status=active กรองแล้ว).';

grant select on analytics.v_content_entry_queue to service_role;

notify pgrst, 'reload schema';

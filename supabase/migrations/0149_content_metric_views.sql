-- 0149_content_metric_views.sql
-- P2 ของชั้นวัดผล content (ต่อจาก 0148) — 2 view อ่าน:
--   v_content_post_t7      = snapshot อายุใกล้ 7 วันที่สุดต่อโพสต์ + save/share rate
--   v_content_entry_queue  = คิวบอกว่าวันนี้ต้องอ่านตัวเลขของโพสต์ไหน (age 1/3/7)
--
-- Additive only: create view ใหม่ล้วน ไม่แตะ view/ตารางเดิมที่มีอยู่แล้ว.
--
-- ============================================================================
-- 🔴 ของจริงชนะบรีฟ:
-- 1. Grant model เหมือน 0148/0145/0146 — service_role อย่างเดียว (3j-migration-traps #18).
-- 2. ไม่เพิ่ม view ที่ 3 สำหรับ "running max" — บรีฟให้สูตร window function ไว้ในหัวข้อ
--    "กันตัวเลขถอยหลัง 3 ชั้น" ของไฟล์ 0148 (ก่อนหัวข้อ RPC) เพื่ออธิบาย pattern การอ่าน
--    ไม่ใช่รายการ view ที่ต้องสร้างใน 0149 (หัวข้อนี้ระบุแค่ 2 view ชัดเจน) — ตัดสินใจเอง
--    ไม่ทำเกินขอบเขต (เทียบบทเรียน 0146 "ห้ามสร้างที่เก็บของที่ยังผลิตข้อมูลไม่ได้") สูตร
--    running max ถูกเขียนไว้เป็นคอมเมนต์บนคอลัมน์ content_post_metric.is_regression (0148)
--    และมีชุดทดสอบ T_RUNNING_MAX ยืนยันว่าใช้ได้จริงใน scripts/verify-0148.sql แทน.
-- ============================================================================

-- ============================================================================
-- 1. analytics.v_content_post_t7 — snapshot ที่อายุใกล้ 7 ที่สุดในช่วง [5,9] ต่อโพสต์
--
-- 🔴 โพสต์ที่ไม่มี snapshot ในช่วงนี้ต้องได้ null พร้อมเหตุผลที่คนอ่านรู้เรื่อง — ห้ามเอา
-- ค่าล่าสุดมาแทนเงียบๆ (คำนวณไม่ได้ = ตก ไม่ใช่ผ่าน). 2 เหตุผลแยกกัน:
--   'ยังไม่ถึง 7 วัน'        = วันนี้ (เวลาไทย) − posted_date_th < 5 (ยังไปไม่ถึงขอบล่างของช่วง)
--   'ไม่มีข้อมูลช่วง T+7'    = อายุเลย 5 วันไปแล้วแต่ไม่มีแถว metric ตกอยู่ใน [5,9] เลย (เว้นวรรคจดไม่ทัน)
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
  case
    when t7.post_id is not null then null
    when ((now() at time zone 'Asia/Bangkok')::date - p.posted_date_th) < 5 then 'ยังไม่ถึง 7 วัน'
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
  't7_unavailable_reason อธิบายว่าทำไม (ยังไม่ถึง 7 วัน vs ถึงแล้วแต่ไม่มีข้อมูล) — '
  'ห้ามใช้ค่าล่าสุดแทนเงียบๆ.';

grant select on analytics.v_content_post_t7 to service_role;

-- ============================================================================
-- 2. analytics.v_content_entry_queue — คิวบอกว่าวันนี้ต้องอ่านโพสต์ไหน
--
-- เงื่อนไข: status='active' และ age_days วันนี้อยู่ใน (1,3,7) และยังไม่มีแถว metric
-- ของ captured_on วันนี้ (เวลาไทย). โพสต์ที่อ่านไปแล้ววันนี้หายจากคิวทันที (ไม่ต้องรอ
-- รอบถัดไป) — deleted/private ไม่อยู่ในคิวเพราะกรองด้วย status='active' ตรงๆ.
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
  case ((now() at time zone 'Asia/Bangkok')::date - p.posted_date_th)
    when 1 then 1
    when 3 then 2
    when 7 then 3
  end as read_round
from analytics.content_post p
where p.status = 'active'
  and ((now() at time zone 'Asia/Bangkok')::date - p.posted_date_th) in (1, 3, 7)
  and not exists (
    select 1 from analytics.content_post_metric m
    where m.post_id = p.id
      and m.captured_on = (now() at time zone 'Asia/Bangkok')::date
  )
order by p.posted_at desc;

comment on view analytics.v_content_entry_queue is
  'คิวโพสต์ที่ต้องอ่านตัวเลขวันนี้ (เวลาไทย) — age_days วันนี้ตรง 1/3/7 พอดี, status=active, '
  'ยังไม่มี metric ของวันนี้. read_round = รอบที่เท่าไร (1=T+1, 2=T+3, 3=T+7). โพสต์ที่อ่านแล้ว '
  'วันนี้หายจากคิวทันที (ไม่มี metric ของวันนี้ = เงื่อนไขหลัก) · deleted/private ไม่เข้าคิว '
  '(status=active กรองแล้ว).';

grant select on analytics.v_content_entry_queue to service_role;

notify pgrst, 'reload schema';

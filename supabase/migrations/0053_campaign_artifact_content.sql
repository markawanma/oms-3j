-- 0053_campaign_artifact_content.sql
-- Surfaces the ACTUAL copy the copywriter/CMO wrote inside the Ad Copilot board.
-- Until now analytics.step_artifact only carried the artifact TYPE + a short
-- `note` + a free-text `source_doc` pointer (e.g. "broadcast-scripts-99 Hook A/B"),
-- so the /marketing/copilot board could show the checklist but there was no way
-- to read the real LINE broadcast script in-app — the copy lived only in the repo
-- (docs/3j-jewelry/marketing/broadcast-scripts-99.md). Owner asked to read it in
-- the board.
--
-- Change:
--   1. add step_artifact.content_body (text, nullable) — the artifact's full copy
--   2. backfill the 5 written broadcast/DM scripts from broadcast-scripts-99.md,
--      matched by (campaign, step seq, artifact_type)
--   3. re-create analytics.v_campaign_board to expose content_body inside each
--      artifact json object (only the jsonb_build_object gains one key; every
--      output column keeps the same name/type/order, so CREATE OR REPLACE VIEW is
--      legal and preserves the 0049 grants)
--
-- Not backfilled (genuinely unwritten yet, left null → board shows "ยังไม่มีสคริปต์"):
-- seq 5 post_sale broadcast (มุมลงทุน/buy-back/NFC) and the non-script artifacts
-- (cta_button_flex, teaser_image, live_rundown, fb_post, bundle_offer_spec).

alter table analytics.step_artifact add column if not exists content_body text;

-- ---- backfill (idempotent: matched by campaign name + step seq + artifact_type) ----

-- seq 1 · teaser · broadcast_script_line  <- doc §1 (Hook A + Hook B)
update analytics.step_artifact sa
set content_body = $body$[Hook A — โฟกัสงานฝีมือ]
9.9 นี้ 3J เตรียมอะไรไว้ให้คุณเป็นพิเศษ ✨

30 กว่าปีที่เราขึ้นรูปเงินแท้ 925 ด้วยมือช่างทุกชิ้น ปีนี้ขอส่งต่อความตั้งใจนั้นผ่าน 9.9 — ของพิเศษจำนวนจำกัด ไม่ได้เปิดให้ทุกคน

กดปุ่มด้านล่างเพื่อรับสิทธิ์ก่อนใครนะคะ 👇
(การกดปุ่ม = ยินยอมให้ 3J ส่งสิทธิ์พิเศษเฉพาะคุณผ่าน LINE นี้ค่ะ)

[ปุ่ม CTA: กดรับสิทธิ์ 9.9]

――――――――――

[Hook B — โฟกัส exclusivity / limited]
บอกก่อนใคร: 9.9 ปีนี้ 3J มีของจำกัดจริงๆ ไม่ได้พูดเล่นค่ะ 🤍

ใครกดรับสิทธิ์ในแชทนี้ก่อน จะได้เห็นก่อน เลือกก่อน ก่อนที่ของจะหมุนเวียนไปให้คนอื่น

กดปุ่มด้านล่าง รับสิทธิ์ 9.9 ไว้เลยค่ะ
(กดปุ่มนี้ถือเป็นการยินยอมรับข่าวสารสิทธิพิเศษจาก 3J ทาง LINE นี้)

[ปุ่ม CTA: กดรับสิทธิ์ 9.9]

――――――――――
หมายเหตุ: ใช้แบบใดแบบหนึ่ง หรือ A/B test (ครึ่งลิสต์ส่ง A / ครึ่งลิสต์ส่ง B) — เก็บ % คลิกเทียบ เป้า teaser click ≥ 15–20%$body$
from analytics.campaign_step cs
join analytics.campaign cp on cp.id = cs.campaign_id
where sa.step_id = cs.id and cp.name = '9.9 Silver Event 2026'
  and cs.seq = 1 and sa.artifact_type = 'broadcast_script_line';

-- seq 2 · vip_private_access · broadcast_script_line  <- doc §3 (Loyal 55)
update analytics.step_artifact sa
set content_body = $body$คุณคือหนึ่งในลูกค้าคนพิเศษของ 3J ✨

ปีนี้เราขอเปิด "9.9 Early Access" ให้คุณก่อนใคร — ก่อนที่ไลฟ์ TikTok จะเริ่มด้วยซ้ำ

[ชื่อ hero SKU / คอลเลกชัน] งานฝีมือเงินแท้ 925 ที่ช่างเราตั้งใจขึ้นรูปมากว่า 30 ปี จำนวนจำกัดจริงค่ะ

เปิดจองพิเศษคืนนี้ 18.00–19.00 น. ในแชทนี้เท่านั้นนะคะ
[ปุ่ม CTA: จองสิทธิ์ VIP]

――――――――――
หมายเหตุ: ถ้า LINE OA แยก narrowcast ตาม tag ไม่ได้ ให้ส่ง broadcast ปกติแต่เปลี่ยนคำ "คุณคือหนึ่งในลูกค้าคนพิเศษ" (ระบบ CRM ระบุกลุ่ม loyal ไว้แล้ว)$body$
from analytics.campaign_step cs
join analytics.campaign cp on cp.id = cs.campaign_id
where sa.step_id = cs.id and cp.name = '9.9 Silver Event 2026'
  and cs.seq = 2 and sa.artifact_type = 'broadcast_script_line';

-- seq 2 · vip_private_access · dm_script_1to1  <- doc §2 (VIP Champion 1:1)
update analytics.step_artifact sa
set content_body = $body$สวัสดีค่ะคุณ [ชื่อลูกค้า] 🙏

ก่อนใครทั้งหมด พี่อยากให้คุณเป็นคนแรกที่ได้เห็นค่ะ

9.9 ปีนี้ 3J เตรียม [ชื่อ hero SKU / คอลเลกชัน] ไว้จำนวนจำกัดมาก และเปิดให้จองเฉพาะลูกค้าที่พี่อยากดูแลเป็นพิเศษก่อนใคร 3–4 วัน ก่อนจะเปิดขายจริงในไลฟ์

ถ้าสนใจ ทักบอกพี่ในแชทนี้ได้เลยนะคะ พี่จะกันชิ้นไว้ให้เป็นพิเศษ พร้อม [perk: สลักชื่อฟรี / กล่องพิเศษ — ต้นทุน ≤ ฿50 ไม่ใช่ลดราคา]

――――――――――
หมายเหตุ: ✅ CFO เคาะแล้ว LINE ไม่ใส่ % ส่วนลด — VIP ใช้ exclusivity + perk ต้นทุน ≤ ฿50 แทน · ต้องเติม [ชื่อลูกค้า] ทีละคน (6 คน) · ถ้ารู้ชิ้นที่แต่ละคนเคยดู/ถาม ใส่แทน [ชื่อ hero SKU] ให้ตรงคน จะแม่นกว่ามาก$body$
from analytics.campaign_step cs
join analytics.campaign cp on cp.id = cs.campaign_id
where sa.step_id = cs.id and cp.name = '9.9 Silver Event 2026'
  and cs.seq = 2 and sa.artifact_type = 'dm_script_1to1';

-- seq 3 · main_day · broadcast_script_line  <- doc §5 (วันจริง 9 ก.ย. เช้า)
update analytics.step_artifact sa
set content_body = $body$เช้านี้ 9.9 มาถึงแล้วค่ะ ✨

วันนี้ 3J เปิด LINE-exclusive ให้คุณก่อนใครในแชทนี้: [ชื่อชิ้น + ราคา]

พิมพ์คำว่า "รับสิทธิ์99" ในแชทนี้ เพื่อให้แอดมินดูแลออเดอร์คุณเป็นพิเศษค่ะ

บ่ายนี้ 14.00–16.00 น. เจอกันในไลฟ์ TikTok ค่ะ — มีของพิเศษอีกชุดเปิดที่นั่นโดยเฉพาะ 🔴
[ลิงก์ / แฮนเดิล TikTok live]

――――――――――
หมายเหตุ: "พิมพ์รับสิทธิ์99" คือกลไก attribute ยอด (ยังไม่มี tracking link) — ต้องสั่งแอดมินให้ tag แชทที่พิมพ์คำนี้ไว้จริง ไม่งั้นนับยอดไม่ได้$body$
from analytics.campaign_step cs
join analytics.campaign cp on cp.id = cs.campaign_id
where sa.step_id = cs.id and cp.name = '9.9 Silver Event 2026'
  and cs.seq = 3 and sa.artifact_type = 'broadcast_script_line';

-- seq 4 · last_call · broadcast_script_line  <- doc §6 (Last call)
update analytics.step_artifact sa
set content_body = $body$เหลือเวลาอีกไม่นานแล้วค่ะ ⏳

9.9 จะปิดคืนนี้เที่ยงคืนนะคะ ตอนนี้ [ชื่อชิ้น] เหลือจริงแค่ [จำนวนที่เหลือจริง] ชิ้น

ถ้ายังไม่ได้รับสิทธิ์ พิมพ์ "รับสิทธิ์99" ในแชทนี้ได้เลยค่ะ ทีมงานจะรีบดูแลให้ก่อนหมดเวลา
[ปุ่ม CTA: สั่งซื้อตอนนี้]

――――――――――
หมายเหตุ: จำนวนที่เหลือต้องเป็นตัวเลขจริงจากสต็อก ห้ามใส่เลขลอยเพื่อเร่ง (ให้ COO เช็คสต็อกก่อนส่ง)$body$
from analytics.campaign_step cs
join analytics.campaign cp on cp.id = cs.campaign_id
where sa.step_id = cs.id and cp.name = '9.9 Silver Event 2026'
  and cs.seq = 4 and sa.artifact_type = 'broadcast_script_line';

-- ---- re-create the board view with content_body exposed per artifact ----

create or replace view analytics.v_campaign_board
  with (security_invoker = true) as
select
  cs.id as step_id,
  cs.campaign_id,
  cs.shop_id,
  cp.name as campaign_name,
  cp.campaign_type,
  cp.trigger_kind,
  cp.status as campaign_status,
  cp.anchor_date,
  cp.primary_channels,
  cp.blocked_reason as campaign_blocked_reason,
  cp.note as campaign_note,
  cs.seq,
  cs.step_kind,
  cs.offset_start_days,
  cs.offset_end_days,
  case when cp.anchor_date is null then null
    else cp.anchor_date + cs.offset_start_days end as resolved_start,
  case when cp.anchor_date is null or cs.offset_end_days is null then null
    else cp.anchor_date + cs.offset_end_days end as resolved_end,
  case when cp.anchor_date is null then null
    else (cp.anchor_date + cs.offset_start_days) - current_date end as days_until,
  cs.audience_segment,
  case when cs.audience_segment in ('champion', 'loyal', 'new', 'at_risk')
    then coalesce(rfm.live_count, 0) else null end as audience_live_count,
  cs.channel,
  cs.goal_kpi,
  cs.status as step_status,
  cs.blocked_reason as step_blocked_reason,
  coalesce(art.artifacts, '[]'::jsonb) as artifacts,
  coalesce(art.art_total, 0) as art_total,
  coalesce(art.art_done, 0) as art_done,
  coalesce(gt.gates, '[]'::jsonb) as gates,
  case
    when coalesce(art.art_blocked, 0) > 0 or coalesce(gt.gate_blocked, 0) > 0 then 'blocked'
    when cs.audience_segment is not null
      and cp.trigger_kind = 'data_driven'
      and coalesce(rfm.live_count, 0) = 0 then 'waiting_data'
    when cs.audience_segment in ('silver_bar', 'tiktok_buyer', 'line_follower')
      and coalesce(rfm.live_count, 0) = 0 then 'waiting_data'
    else cs.status
  end as effective_status
from analytics.campaign_step cs
join analytics.campaign cp on cp.id = cs.campaign_id
left join lateral (
  select count(*)::int as live_count
  from analytics.v_rfm_segment r
  where cs.audience_segment is not null
    and r.shop_id = cs.shop_id
    and r.segment = cs.audience_segment
) rfm on true
left join lateral (
  select
    jsonb_agg(
      jsonb_build_object(
        'id', sa.id,
        'artifact_type', sa.artifact_type,
        'owner_role', sa.owner_role,
        'source_doc', sa.source_doc,
        'status', sa.status,
        'is_dynamic', sa.is_dynamic,
        'dynamic_source', sa.dynamic_source,
        'dynamic_ref', sa.dynamic_ref,
        'discount_pct', sa.discount_pct,
        'note', sa.note,
        'content_body', sa.content_body
      ) order by sa.created_at
    ) as artifacts,
    count(*) as art_total,
    count(*) filter (where sa.status = 'done') as art_done,
    count(*) filter (where sa.status = 'blocked') as art_blocked
  from analytics.step_artifact sa
  where sa.step_id = cs.id
) art on true
left join lateral (
  select
    jsonb_agg(
      jsonb_build_object(
        'gate_kind', sg.gate_kind,
        'status', sg.status,
        'passed_by', sg.passed_by,
        'passed_at', sg.passed_at,
        'note', sg.note
      ) order by sg.gate_kind
    ) as gates,
    count(*) filter (where sg.status = 'blocked') as gate_blocked
  from analytics.step_gate sg
  where sg.step_id = cs.id
) gt on true;

notify pgrst, 'reload schema';

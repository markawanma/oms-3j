-- 0050_seed_campaign_99.sql
-- Seed "9.9 Silver Event 2026" campaign per:
--   docs/3j-jewelry/marketing/campaign-playbook-taxonomy.md §ตัวอย่างเต็ม
--   (5 steps: teaser / vip_private_access / main_day / last_call / post_sale)
--
-- shop_id: `select id from public.shop order by created_at limit 1` — Tech Lead
-- confirmed (design doc §เปิดคำถามก่อน implement), not pinned to an env var,
-- matches every other seed/verify script in this repo.
--
-- Idempotent: the whole seed is a single DO block that looks up the campaign
-- by (shop_id, name) first and returns immediately if it already exists — safe
-- to re-run this migration file any number of times.
--
-- Judgment calls made mapping the taxonomy's free-text example onto the
-- formal check-constraint enums (flagged for Tech Lead review at apply time):
--   - "done(draft)" artifact statuses (broadcast_script_line at every step,
--     dm_script_1to1) are seeded as 'draft', NOT 'done' — every one of them
--     still has an explicit "รอ..." (waiting on X) note in the taxonomy, so
--     marking them 'done' would overstate readiness on the board.
--   - attribution_code's "active" is seeded as 'done' (closest fit — the code
--     is live/in-use today) with is_dynamic=true, dynamic_source=
--     'attribution_log' per taxonomy §"จุดที่ต้องผูกข้อมูลสด" (resolution
--     itself is phase-2 work, not done in 0049).
--   - step 2 (vip_private_access) targets BOTH champion (1:1) and loyal
--     (narrowcast) per taxonomy, but campaign_step.audience_segment is a
--     single value (architect's schema, 0049). Seeded as 'champion' (the
--     step's headline: 6-person 1:1 script) — loyal is only represented via
--     its own step_artifact row, audience_live_count will only ever show the
--     champion count (6), never loyal (55). Flagged as a known MVP gap, not
--     silently hidden.
--   - step 4 (last_call) audience is "คลิกแล้วยังไม่ซื้อ" — a behavioral
--     cohort with no matching audience_segment enum value. Seeded as NULL
--     rather than force-mapped to a segment that doesn't mean the same thing.
--   - step 5 (post_sale) is seeded with step.status='scheduled', NOT
--     'waiting_data' — v_campaign_board (0049) derives effective_status=
--     'waiting_data' automatically at read time (silver_bar + live_count=0,
--     design D4/rule 3), so hardcoding it here would be redundant AND would
--     go stale the moment silver_bar segment data exists.
--
-- ⚠️ DO NOT APPLY — file only, per task instructions. Tech Lead applies via MCP.

do $$
declare
  v_shop_id uuid;
  v_campaign_id uuid;
  v_step1_id uuid;
  v_step2_id uuid;
  v_step3_id uuid;
  v_step4_id uuid;
  v_step5_id uuid;
begin
  select id into v_shop_id from public.shop order by created_at limit 1;
  if v_shop_id is null then
    raise notice 'seed_campaign_99: no shop row found in public.shop — skipping seed entirely';
    return;
  end if;

  select id into v_campaign_id
    from analytics.campaign
    where shop_id = v_shop_id and name = '9.9 Silver Event 2026';

  if v_campaign_id is not null then
    raise notice 'seed_campaign_99: campaign already seeded (id=%) for shop % — skipping (idempotent no-op)', v_campaign_id, v_shop_id;
    return;
  end if;

  -- ==========================================================================
  -- campaign
  -- ==========================================================================
  insert into analytics.campaign (
    shop_id, name, campaign_type, trigger_kind, status, anchor_date, primary_channels, note
  ) values (
    v_shop_id, '9.9 Silver Event 2026', 'promo_event', 'calendar', 'active', date '2026-09-09',
    array['line_oa', 'tiktok_live'],
    'seed จาก docs/3j-jewelry/marketing/campaign-playbook-taxonomy.md §ตัวอย่างเต็ม'
  ) returning id into v_campaign_id;

  -- ==========================================================================
  -- steps (offsets relative to anchor_date=2026-09-09; resolved at read time
  -- by v_campaign_board, not stored as absolute dates)
  -- ==========================================================================

  insert into analytics.campaign_step (
    campaign_id, shop_id, seq, step_kind, offset_start_days, offset_end_days,
    audience_segment, channel, goal_kpi, status
  ) values (
    v_campaign_id, v_shop_id, 1, 'teaser', -8, -7,
    'all_followers', 'line_oa', 'teaser click >= 15-20% = ขนาด audience วันจริง', 'scheduled'
  ) returning id into v_step1_id;

  insert into analytics.campaign_step (
    campaign_id, shop_id, seq, step_kind, offset_start_days, offset_end_days,
    audience_segment, channel, goal_kpi, status
  ) values (
    v_campaign_id, v_shop_id, 2, 'vip_private_access', -4, -3,
    'champion', 'line_oa', 'champion 6 คน -> 4-5 order, AOV >= 1600 บาท', 'scheduled'
  ) returning id into v_step2_id;

  insert into analytics.campaign_step (
    campaign_id, shop_id, seq, step_kind, offset_start_days, offset_end_days,
    audience_segment, channel, goal_kpi, status
  ) values (
    v_campaign_id, v_shop_id, 3, 'main_day', 0, 0,
    'all_followers', 'tiktok_live', 'GMV/ชม.live, attribution "รับสิทธิ์99"', 'scheduled'
  ) returning id into v_step3_id;

  insert into analytics.campaign_step (
    campaign_id, shop_id, seq, step_kind, offset_start_days, offset_end_days,
    audience_segment, channel, goal_kpi, status
  ) values (
    v_campaign_id, v_shop_id, 4, 'last_call', 0, 0,
    null, 'line_oa', 'ปิดคนค้าง; block/unsub < 2%', 'scheduled'
  ) returning id into v_step4_id;

  insert into analytics.campaign_step (
    campaign_id, shop_id, seq, step_kind, offset_start_days, offset_end_days,
    audience_segment, channel, goal_kpi, status
  ) values (
    v_campaign_id, v_shop_id, 5, 'post_sale', 2, 3,
    'silver_bar', 'line_oa', 'second angle (มุมลงทุน/buy-back/NFC)', 'scheduled'
  ) returning id into v_step5_id;

  -- ==========================================================================
  -- step 1 · teaser
  -- ==========================================================================
  insert into analytics.step_artifact (step_id, shop_id, artifact_type, owner_role, source_doc, status, note)
  values
    (v_step1_id, v_shop_id, 'broadcast_script_line', 'copywriter', 'broadcast-scripts-99 (Hook A/B)', 'draft', 'draft เสร็จ รอ fill placeholder'),
    (v_step1_id, v_shop_id, 'cta_button_flex', 'owner', null, 'todo', 'รอยืนยัน Flex ("กดรับสิทธิ์ 9.9")'),
    (v_step1_id, v_shop_id, 'teaser_image', 'content_repurposer', null, 'todo', null);

  insert into analytics.step_gate (step_id, shop_id, gate_kind, status)
  values (v_step1_id, v_shop_id, 'pdpa_consent', 'pending');

  -- ==========================================================================
  -- step 2 · vip_private_access
  -- ==========================================================================
  insert into analytics.step_artifact (step_id, shop_id, artifact_type, owner_role, source_doc, status, note)
  values
    (v_step2_id, v_shop_id, 'dm_script_1to1', 'copywriter', 'broadcast-scripts-99 ข้อ 2', 'draft', 'champion 6 คน — รอชื่อ+SKU รายคน'),
    (v_step2_id, v_shop_id, 'broadcast_script_line', 'copywriter', null, 'draft', 'loyal narrowcast — draft เสร็จ');

  insert into analytics.step_gate (step_id, shop_id, gate_kind, status)
  values (v_step2_id, v_shop_id, 'coo_stock_check', 'pending');

  -- ==========================================================================
  -- step 3 · main_day
  -- ==========================================================================
  insert into analytics.step_artifact (
    step_id, shop_id, artifact_type, owner_role, source_doc, status, is_dynamic, dynamic_source, note
  )
  values
    (v_step3_id, v_shop_id, 'broadcast_script_line', 'copywriter', null, 'draft', false, null, 'วันจริง + ชี้ live — รอ hero SKU + ลิงก์ live'),
    (v_step3_id, v_shop_id, 'live_rundown', 'host', 'month1-calendar ข้อ 2 (15/กลาง/15)', 'todo', false, null, null),
    (v_step3_id, v_shop_id, 'attribution_code', 'tech_lead', null, 'done', true, 'attribution_log', 'โค้ด "รับสิทธิ์99" — active (พิมพ์ในแชท, ยังไม่มี tracking link)'),
    (v_step3_id, v_shop_id, 'bundle_offer_spec', 'cfo', 'discount-policy-99 ข้อ 4', 'blocked', false, null, 'แท่ง+จี้ — BLOCKED รอต้นทุนจี้ (rule 7, ส่วนลดเป็นบาทไม่ใช่ %)');

  insert into analytics.step_gate (step_id, shop_id, gate_kind, status)
  values
    (v_step3_id, v_shop_id, 'cfo_discount_approval', 'pending'),
    (v_step3_id, v_shop_id, 'coo_stock_check', 'pending'),
    (v_step3_id, v_shop_id, 'price_realtime_fill', 'pending');

  -- ==========================================================================
  -- step 4 · last_call
  -- ==========================================================================
  insert into analytics.step_artifact (step_id, shop_id, artifact_type, owner_role, source_doc, status, note)
  values (v_step4_id, v_shop_id, 'broadcast_script_line', 'copywriter', null, 'draft', 'draft เสร็จ — fill จำนวนจริงหน้างาน');

  insert into analytics.step_gate (step_id, shop_id, gate_kind, status)
  values (v_step4_id, v_shop_id, 'coo_stock_check', 'pending');

  -- ==========================================================================
  -- step 5 · post_sale (silver_bar) — effective_status resolves to
  -- 'waiting_data' automatically via v_campaign_board (silver_bar segment,
  -- live_count=0), not hardcoded on the row here.
  -- ==========================================================================
  insert into analytics.step_artifact (step_id, shop_id, artifact_type, owner_role, source_doc, status, note)
  values
    (v_step5_id, v_shop_id, 'broadcast_script_line', 'copywriter', null, 'todo', 'มุมลงทุน/buy-back/NFC'),
    (v_step5_id, v_shop_id, 'fb_post', 'copywriter', null, 'todo', null);

  raise notice 'seed_campaign_99: seeded campaign % (5 steps, 12 artifacts, 6 gates) for shop %', v_campaign_id, v_shop_id;
end;
$$;

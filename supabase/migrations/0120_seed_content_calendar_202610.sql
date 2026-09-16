-- 0120_seed_content_calendar_202610.sql
-- Seeds ร่าง 1 ของปฏิทินโพสต์ ต.ค. 69 ลง campaign board ตาม:
--   docs/3j-jewelry/marketing/content-calendar/2026-10.md  (§5 ทุกแถว + 3 แคมเปญท้ายไฟล์)
--   docs/3j-jewelry/marketing/content-calendar/TEMPLATE.md (§กติกา — ทุกโพสต์แคมเปญผูก campaign_step.id)
--   docs/3j-jewelry/marketing/phase-content-calendar-design.md §1 D1 (standalone = campaign ห่อบาง)
--   migrations 0049/0050/0053/0057/0058/0060 (แพตเทิร์น + enum ที่ใช้จริง — ไม่มีค่าที่เดา)
--
-- เจ้าของสั่ง 16 ก.ย. 69: "ทำปฏิทินโพสต์ ต.ค. คู่กับปฏิทินแคมเปญเลย" — ไฟล์นี้ทำให้ md กับ
-- /marketing/calendar เป็นชุดเดียวกัน เจ้าของยังไม่ได้เคาะ Q1–Q6 ของไฟล์ md จึงลง campaign
-- และ campaign_step ทุกแถวยังไม่เริ่ม (campaign.status='scheduled' — เจ้าของเคาะ Lean 16 ก.ย. 69 · ยกเว้น c3 การ์ดในกล่อง = 'blocked' รอ Q5) — เดิมร่าง 1 ใช้ blocked ทั้ง 4 ตัว
-- "draft" ระดับแคมเปญ, blocked สื่อว่า "ยังเริ่มไม่ได้จนกว่าเจ้าของเคาะ" ได้ตรงที่สุด — ดู
-- blocked_reason ทุกแถว) — ไม่มีเลขต้นทุน/margin ในไฟล์นี้เลย (ไม่มีในต้นฉบับ md อยู่แล้ว)
--
-- shop_id คงที่ตามที่ Tech Lead สั่ง: a7c850ee-6776-4c3e-ba72-ba9e8caba2b7
--
-- Idempotent: เช็คว่า 4 ชื่อแคมเปญด้านล่างมีอยู่แล้วหรือยัง (shop_id เดียวกัน) ถ้ามีครบ
-- ข้ามทั้งบล็อก — ปลอดภัยรันซ้ำ และไม่แตะแถว campaign เดิม 7 ตัวของ ก.ย. (คนละชื่อ คนละเงื่อนไข)
--
-- ⚠️ DO NOT APPLY — file only. Tech Lead dry-run บน MCP ก่อน apply จริง.

do $$
declare
  v_shop_id uuid := 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7'::uuid;
  v_c1_id uuid; -- คลิปดันไลฟ์ (สลับสัปดาห์)
  v_c2_id uuid; -- เงินเดือน ต.ค. (15–18)
  v_c3_id uuid; -- การ์ดในกล่อง → LINE OA
  v_c4_id uuid; -- ปฏิทินโพสต์ ต.ค. 69 — evergreen (wrapper บาง ตาม D1)
  v_existing int;
begin
  if not exists (select 1 from public.shop where id = v_shop_id) then
    raise notice '0120_seed_content_calendar_202610: shop % not found — skipping seed entirely', v_shop_id;
    return;
  end if;

  select count(*) into v_existing
  from analytics.campaign
  where shop_id = v_shop_id
    and name in (
      'คลิปดันไลฟ์ (สลับสัปดาห์)',
      'เงินเดือน ต.ค. (15–18)',
      'การ์ดในกล่อง → LINE OA',
      'ปฏิทินโพสต์ ต.ค. 69 — evergreen'
    );
  if v_existing > 0 then
    raise notice '0120_seed_content_calendar_202610: % / 4 แคมเปญมีอยู่แล้วสำหรับ shop % — ข้ามทั้งบล็อก (idempotent no-op)', v_existing, v_shop_id;
    return;
  end if;

  -- ==========================================================================
  -- 1. Campaigns — c1/c2/c4 status='scheduled' (เจ้าของเคาะ 16 ก.ย. 69) · c3 'blocked' (รอ Q5 การ์ดในกล่อง)
  --    campaign_type ที่ md เขียนเป็น "type=experiment"/"type=retention" ไม่มีใน
  --    enum จริง (0049/0057) ⇒ แทนด้วยค่าที่ใกล้ที่สุด บันทึกไว้ใน note ทุกแถว
  -- ==========================================================================

  insert into analytics.campaign
    (shop_id, name, campaign_type, trigger_kind, status, anchor_date, primary_channels,
     blocked_reason, note)
  values (
    v_shop_id, 'คลิปดันไลฟ์ (สลับสัปดาห์)', 'live_promo', 'calendar', 'scheduled',
    date '2026-10-01', array['tiktok_live'],
    null,
    'เจ้าของเคาะ 16 ก.ย. 69 (Lean · ทำ ต.ค. เลย กลับมติ 31 ส.ค. ข้อ 11): สัปดาห์ที่มีคลิปก่อนไลฟ์ (W1 W3 W5) มีออเดอร์/ชม.ไลฟ์ และลูกค้าใหม่/คืน สูงกว่าสัปดาห์ที่คลิปโพสต์เช้า (W2 W4) · md เขียนเป็น type=experiment ไม่มี enum ตรง ใช้ campaign_type=live_promo แทน (ใกล้สุด) · n เล็ก (~2 คืน/ฝั่ง/สัปดาห์) ต.ค. ได้แค่ "จับตา" ไม่สรุปผล'
  ) returning id into v_c1_id;

  insert into analytics.campaign
    (shop_id, name, campaign_type, trigger_kind, status, anchor_date, primary_channels,
     blocked_reason, note)
  values (
    v_shop_id, 'เงินเดือน ต.ค. (15–18)', 'promo_event', 'calendar', 'scheduled',
    date '2026-10-15', array['tiktok_live', 'line_oa'],
    null,
    'ร่าง 2 — เจ้าของเคาะ Lean 16 ก.ย. 69: คลิปทุกคืน + LINE 1 ครั้ง ในหน้าต่าง 15–18 ต.ค. ทำให้ออเดอร์/ชม.ไลฟ์ สูงกว่า 8–11 ต.ค. (สัปดาห์ก่อนหน้าเดียวกัน)'
  ) returning id into v_c2_id;

  insert into analytics.campaign
    (shop_id, name, campaign_type, trigger_kind, status, anchor_date, primary_channels,
     blocked_reason, note)
  values (
    v_shop_id, 'การ์ดในกล่อง → LINE OA', 'second_purchase_nurture', 'always_on', 'blocked',
    date '2026-10-01', array['parcel_insert', 'line_oa'],
    'รอเจ้าของเคาะ Q5 (ใครสอดการ์ด/มีการ์ดพิมพ์อยู่แล้วหรือต้องสั่ง — ไป COO) ก่อนเริ่ม',
    'ร่าง 2 — เจ้าของเคาะ Lean 16 ก.ย. 69: การ์ดเชิญเข้า LINE ในทุกพัสดุ ทำให้ลูกค้าใหม่ TikTok เข้า LINE มากกว่า 8% ปัจจุบัน · md เขียนเป็น type=retention ไม่มี enum ตรง ใช้ campaign_type=second_purchase_nurture แทน (ใกล้สุด)'
  ) returning id into v_c3_id;

  insert into analytics.campaign
    (shop_id, name, campaign_type, trigger_kind, status, anchor_date, note)
  values (
    v_shop_id, 'ปฏิทินโพสต์ ต.ค. 69 — evergreen', 'content_task', 'manual', 'scheduled',
    date '2026-10-01',
    'เจ้าของเคาะ Lean 16 ก.ย. 69 — ห่อบาง (design §1 D1) สำหรับทุกแถวโพสต์ใน §5 ที่คอลัมน์ "ผูกแคมเปญ" = "—" (evergreen/ไม่ผูกแคมเปญ) — ไม่ใช่แคมเปญจริง อย่านับรวมกับ 3 แคมเปญด้านบนตอนอ่านบอร์ด'
  ) returning id into v_c4_id;

  -- ==========================================================================
  -- 2. campaign_step — 1 แถวต่อ 1 แถวโพสต์ใน §5 (26 แถว) · origin='manual' ทุก
  --    แถว (owner แก้/ลบเองได้ผ่าน R8 — ไม่ใช่มาจาก campaign_template) · start_
  --    time=null ทุกแถว (ไฟล์ไม่ได้ระบุเวลานาฬิกาที่แน่นอนที่จุดไหนเลย รวมทั้งแถว
  --    "โพสต์เช้า" — มีแต่คำว่า "เช้า" ไม่มี HH:MM) · status='todo' (ร่าง ยังไม่เริ่ม)
  --    ตัดออก 2 แถว: จุดตัดสินใจ 15 ต.ค. และ 31 ต.ค. — เป็นการประชุม ไม่ใช่โพสต์
  --    (ดูข้อจำกัด C ในสรุปที่ส่งกลับ)
  -- ==========================================================================

  insert into analytics.campaign_step
    (campaign_id, shop_id, seq, step_kind, title, offset_start_days, offset_end_days,
     audience_segment, channel, goal_kpi, status, origin, created_by, updated_by)
  select
    case t.ck when 'c1' then v_c1_id when 'c2' then v_c2_id when 'c3' then v_c3_id else v_c4_id end,
    v_shop_id, t.seq, t.step_kind, t.title, t.off_s, t.off_e,
    t.seg, t.channel, t.kpi, 'todo', 'manual', auth.uid(), auth.uid()
  from (values
    -- ---- c1 · คลิปดันไลฟ์ (สลับสัปดาห์) · anchor 2026-10-01 ----
    ('c1', 1, 'pre_live_hook', '#8 เลข 925 มาจากไหน — โชว์ตราประทับจริง ปิดท้าย "คืนนี้ไลฟ์"', 0, null::int, null::text, 'tiktok_live', 'สัปดาห์มีคลิปดันไลฟ์ (W1) — เทียบ ER% กับ W2/W4'),
    ('c1', 2, 'pre_live_hook', 'ของขึ้นไลฟ์คืนนี้ 3 ชิ้นบนโต๊ะ 20 วิ ไม่มีสคริปต์', 2, null, null, 'tiktok_live', 'สัปดาห์มีคลิปดันไลฟ์ (W1)'),
    ('c1', 3, 'pre_live_hook', '#11 เงินดำเพราะอากาศ ไม่ใช่เพราะไม่แท้ — โพสต์เช้า (คืน "ไม่มีคลิปดัน")', 5, null, null, 'tiktok_live', 'สัปดาห์ไม่มีคลิปดันไลฟ์ (W2) — เทียบ ER% กับ W1/W3/W5'),
    ('c1', 4, 'pre_live_hook', '#20 3 อย่างทำแล้วเงินไม่ดำเร็ว — โพสต์เช้า', 7, null, null, 'tiktok_live', 'สัปดาห์ไม่มีคลิปดันไลฟ์ (W2)'),
    ('c1', 5, 'pre_live_hook', '#1 โกเมน แดงแต่ไม่ใช่ทับทิม', 12, null, null, 'tiktok_live', 'สัปดาห์มีคลิปดันไลฟ์ (W3) — หยุด อ.13'),
    ('c1', 6, 'pre_live_hook', '#4 CZ คืออะไร ไม่ใช่เพชร ร้านขายเป็น CZ — โพสต์เช้า', 19, null, null, 'tiktok_live', 'สัปดาห์ไม่มีคลิปดันไลฟ์ (W4)'),
    ('c1', 7, 'pre_live_hook', '#15 ขัดเงา before→after (Q4=ได้ ✅) · สำรอง #10 925 vs sterling vs ชุบ', 21, null, null, 'tiktok_live', 'สัปดาห์ไม่มีคลิปดันไลฟ์ (W4)'),
    ('c1', 8, 'pre_live_hook', '#16 งานเกลี้ยง vs งานฝัง ยากต่างกันตรงไหน — ปิด "คืนนี้ไลฟ์"', 26, null, null, 'tiktok_live', 'สัปดาห์มีคลิปดันไลฟ์ (W5)'),
    ('c1', 9, 'pre_live_hook', '#18 แหวนเกลี้ยงใส่แมตช์ได้จริงไหม 3 ลุค', 28, null, null, 'tiktok_live', 'สัปดาห์มีคลิปดันไลฟ์ (W5)'),
    -- ---- c2 · เงินเดือน ต.ค. (15–18) · anchor 2026-10-15 ----
    ('c2', 1, 'pre_live_hook', '#2 โรสควอตซ์ + งานฉลุ — ปิด "คืนนี้ไลฟ์"', 0, null, null, 'tiktok_live', 'หน้าต่างเงินเดือน 15–18 ต.ค. — จุดตัดสินใจกลางเดือน 15 ต.ค. (CMO+Tech Lead) ก่อนหน้านี้ ไม่ลงเป็นแถวโพสต์'),
    ('c2', 2, 'pre_live_hook', 'ของขึ้นไลฟ์คืนนี้ — ชุดพลอยแดง/ชมพูจากคลิป 13/15', 1, null, null, 'tiktok_live', 'หน้าต่างเงินเดือน'),
    ('c2', 3, 'segment_offer', 'LINE 1/4 — เชิญ champion+loyal "คืนนี้ไลฟ์ ของใหม่จากคลิปที่คุณเห็น"', 1, null, 'champion', 'line_oa', 'โควตา LINE ≤4/28วัน — ครั้งที่ 1/4 · ไม่มีราคา ไม่มีโปร · ของแถม(ถ้ามี)ต้องผ่าน CFO · หมายเหตุ: เชิญ loyal ด้วยแต่ audience_segment เก็บได้ค่าเดียว (ช่องว่างเดียวกับ 0050 step2)'),
    ('c2', 4, 'pre_live_hook', 'ของขึ้นไลฟ์คืนนี้', 2, null, null, 'tiktok_live', 'หน้าต่างเงินเดือน'),
    ('c2', 5, 'pre_live_hook', 'ของขึ้นไลฟ์คืนนี้ + "คืนสุดท้ายของชุดนี้" (จริงเท่านั้น)', 3, null, null, 'tiktok_live', 'หน้าต่างเงินเดือน — วันสุดท้าย'),
    -- ---- c3 · การ์ดในกล่อง → LINE OA · anchor 2026-10-01, ต่อเนื่องทั้งเดือน ----
    ('c3', 1, 'insert_card', 'การ์ดเชิญเข้า LINE OA ทุกพัสดุ TikTok (ไม่มีส่วนลด — ต้อง re-brief content-winback-set1.md §5)', 0, 30, 'tiktok_buyer', 'parcel_insert', 'เพื่อนใหม่ LINE/สัปดาห์ ÷ พัสดุที่ส่ง · ติด Q5 (ใครสอดการ์ด — ไป COO)'),
    -- ---- c4 · ปฏิทินโพสต์ ต.ค. 69 — evergreen · anchor 2026-10-01 ----
    ('c4', 1, 'content_task', 'เฟรมนิ่งจาก #8 + แคปชัน 2 บรรทัด (IG+FB cross)', 3, null, null, 'facebook', 'evergreen — สินทรัพย์แบรนด์ ไม่วัด ROI'),
    ('c4', 2, 'content_task', 'เผื่อ 10.10 เท่านั้น — ถ้าแพลตฟอร์มประกาศ ใช้แถวนี้ประกาศเวลาไลฟ์ · ไม่ประกาศ = ข้าม (บันทึกเหตุผล)', 9, null, null, 'tiktok_live', 'เงื่อนไข: ต้องมีประกาศ 10.10 จริงก่อน — ไม่งั้นเปลี่ยนสถานะเป็นข้าม'),
    ('c4', 3, 'content_task', 'กินเจ: สตอรี่ทักทาย 1 ชิ้น ไม่ผูกสินค้า (ช่วง 10–18 ต.ค.)', 9, 17, null, null, 'แอดมิน 1–2 นาที ไม่ผ่านด่านถ้าไม่มีราคา/เคลม'),
    ('c4', 4, 'content_task', 'อัลบั้ม 4:5 "ดูแลเงิน 3 ข้อ" หน้าสุดท้าย = ทางติดต่อ (IG+FB cross)', 10, null, null, 'facebook', 'evergreen'),
    ('c4', 5, 'content_task', 'ขอบคุณสัปดาห์เงินเดือน — ภาพแพ็กของส่ง (BTS แพ็ก ไม่มี PII บนกล่อง, IG+FB cross)', 17, null, null, 'facebook', 'evergreen — R+B'),
    ('c4', 6, 'content_task', 'วันปิยมหาราช — ภาพนิ่งทักทาย ไม่ผูกสินค้า (IG+FB cross, หยุด ศ.23)', 22, null, null, 'facebook', 'เทศกาล'),
    ('c4', 7, 'pre_live_hook', 'ของขึ้นไลฟ์คืนนี้', 23, null, null, 'tiktok_live', 'evergreen'),
    ('c4', 8, 'content_task', 'ออกพรรษา ทักทาย 1 ชิ้น (สตอรี่)', 25, null, null, null, 'สตอรี่ — แอดมิน'),
    ('c4', 9, 'pre_live_hook', 'ของขึ้นไลฟ์คืนนี้ — สิ้นเดือน', 29, null, null, 'tiktok_live', 'evergreen'),
    ('c4', 10, 'segment_offer', 'LINE 2/4 (สำรอง) — รอตัดสิน 15 ต.ค.: (ก) win-back รอบ 2 ถ้าผล 13 ต.ค. validated (ข) เชิญไลฟ์สิ้นเดือน (ค) ไม่ส่ง เก็บโควตาให้ลอยกระทง', 29, null, null, 'line_oa', 'โควตา LINE ≤4/28วัน — ครั้งที่ 2/4 (สำรอง) · Maz เขียนหลัง 15 ต.ค. · ยังไม่ผูกแคมเปญ 1/2 จนกว่าจะตัดสิน'),
    ('c4', 11, 'content_task', 'สรุปเดือน: 3 ความรู้ที่คนถามมากสุด (จากคอมเมนต์จริง, IG+FB cross)', 30, null, null, 'facebook', 'evergreen — R+B')
  ) as t(ck, seq, step_kind, title, off_s, off_e, seg, channel, kpi);

  -- ==========================================================================
  -- 3. step_artifact — เฉพาะแถวที่มีคลิป/แคปชัน (ทุกแถวใน §5 มี ยกเว้นจุดตัดสินใจ
  --    ที่ตัดไปแล้วในขั้นตอนที่ 2) · clip_brief เฉพาะ artifact_type=short_form_clip
  --    (segments=[] — ไฟล์ไม่มีข้อมูลระดับ segment, shots=[วัตถุดิบจากคอลัมน์
  --    "วัตถุดิบ"] ถ้ามี) · meta.category/meta.hex = ประเภท+สี HEX จาก §2
  -- ==========================================================================

  insert into analytics.step_artifact
    (step_id, shop_id, artifact_type, owner_role, source_doc, status, generated_by,
     clip_brief, note)
  select
    (select cs.id from analytics.campaign_step cs
      where cs.campaign_id = (case a.ck when 'c1' then v_c1_id when 'c2' then v_c2_id when 'c3' then v_c3_id else v_c4_id end)
        and cs.seq = a.seq),
    v_shop_id, a.artifact_type, a.owner_role, 'docs/3j-jewelry/marketing/content-calendar/2026-10.md §5', 'todo', 'human',
    case when a.artifact_type = 'short_form_clip' then
      jsonb_build_object(
        'v', 1,
        'segments', '[]'::jsonb,
        'shots', case when a.shot_desc is null then '[]'::jsonb
                       else jsonb_build_array(jsonb_build_object('id', 's1', 'desc', a.shot_desc, 'done', false)) end,
        'meta', jsonb_build_object('category', a.cat, 'hex', a.hex, 'source', 'content-calendar 2026-10.md §5')
      )
    else null end,
    'ประเภท: ' || a.cat || ' ' || a.hex || coalesce(' · ' || a.note_extra, '')
  from (values
    -- c1 (ทุกแถวเป็น short_form_clip)
    ('c1', 1, 'short_form_clip', 'copywriter', 'ตราประทับ 925 macro (ถ่ายรอบ 1)', 'ความรู้', '#1f3a5f', null::text),
    ('c1', 2, 'short_form_clip', 'content_repurposer', 'หน้างาน (แอดมินถ่าย)', 'พาเข้าไลฟ์ (ของขึ้นไลฟ์คืนนี้)', '#a2191d', null),
    ('c1', 3, 'short_form_clip', 'copywriter', 'แหวนโกเมน · ชิ้นดำ vs ขาว before/after (ถ่ายรอบ 1)', 'ความรู้', '#1f3a5f', null),
    ('c1', 4, 'short_form_clip', 'copywriter', 'tips ดูแล 3 ท่า (ถุงซิป/เช็ด/ถอด) (ถ่ายรอบ 1)', 'ความรู้', '#1f3a5f', null),
    ('c1', 5, 'short_form_clip', 'copywriter', 'แหวนโกเมน macro (ถ่ายรอบ 1)', 'ความรู้', '#1f3a5f', null),
    ('c1', 6, 'short_form_clip', 'copywriter', 'CZ solitaire macro (ถ่ายรอบ 1)', 'ความรู้', '#1f3a5f', null),
    ('c1', 7, 'short_form_clip', 'copywriter', 'ขัดเงา before→after · มือช่าง (ถ่ายรอบ 2 — Q4=ได้ ✅) · สำรอง #10 ต้องเขียนสคริปต์ (Maz)', 'ช่าง/โรงงาน', '#6b4a2e', null),
    ('c1', 8, 'short_form_clip', 'copywriter', 'งานเกลี้ยง vs งานฝัง — ต้องเขียนสคริปต์ + ถ่ายคู่', 'ความรู้', '#1f3a5f', null),
    ('c1', 9, 'short_form_clip', 'copywriter', 'แหวนเกลี้ยง 3 ลุค + แหวนเกลี้ยงคู่แหวนฝัง — ต้องเขียนสคริปต์ + ถ่ายคนใส่ (แอดมิน/เจ้าของ)', 'ความรู้', '#1f3a5f', null),
    -- c2
    ('c2', 1, 'short_form_clip', 'copywriter', 'โรสควอตซ์ + งานฉลุ (ถ่ายรอบ 1)', 'ความรู้', '#1f3a5f', null),
    ('c2', 2, 'short_form_clip', 'content_repurposer', 'ชุดพลอยแดง/ชมพูจากคลิป 13/15 — หน้างาน', 'พาเข้าไลฟ์ (ของขึ้นไลฟ์คืนนี้)', '#a2191d', null),
    ('c2', 3, 'broadcast_script_line', 'copywriter', null, 'ลูกค้า/ความสัมพันธ์', '#4f7f6a', 'ข้อความใหม่ (Maz) · ไม่มีราคา ไม่มีโปร'),
    ('c2', 4, 'short_form_clip', 'content_repurposer', 'หน้างาน', 'พาเข้าไลฟ์ (ของขึ้นไลฟ์คืนนี้)', '#a2191d', null),
    ('c2', 5, 'short_form_clip', 'content_repurposer', 'หน้างาน + "คืนสุดท้ายของชุดนี้" (จริงเท่านั้น)', 'พาเข้าไลฟ์ (ของขึ้นไลฟ์คืนนี้)', '#a2191d', null),
    -- c3
    ('c3', 1, 'parcel_card', 'coo', null, 'ลูกค้า/ความสัมพันธ์', '#4f7f6a', 'ข้อความ §5 ใน content-winback-set1.md — ต้อง re-brief: เชิญเข้า LINE OA ไม่มีส่วนลด'),
    -- c4
    ('c4', 1, 'fb_post', 'content_repurposer', null, 'ความรู้', '#1f3a5f', 'เฟรมจากคลิป 1 ต.ค.'),
    ('c4', 2, 'short_form_clip', 'copywriter', null, 'เทศกาล/ประกาศ', '#8a8f94', null),
    ('c4', 3, 'teaser_image', 'content_repurposer', null, 'เทศกาล/ประกาศ', '#8a8f94', 'แอดมิน'),
    ('c4', 4, 'fb_post', 'content_repurposer', null, 'ความรู้', '#1f3a5f', 'เฟรมจาก #20'),
    ('c4', 5, 'fb_post', 'content_repurposer', null, 'ลูกค้า/ความสัมพันธ์', '#4f7f6a', 'ต้องถ่ายตอนแพ็ก'),
    ('c4', 6, 'teaser_image', 'content_repurposer', null, 'เทศกาล/ประกาศ', '#8a8f94', 'ภาพสินค้า/โรงงาน 1 ภาพ'),
    ('c4', 7, 'short_form_clip', 'content_repurposer', 'หน้างาน', 'พาเข้าไลฟ์ (ของขึ้นไลฟ์คืนนี้)', '#a2191d', null),
    ('c4', 8, 'teaser_image', 'content_repurposer', null, 'เทศกาล/ประกาศ', '#8a8f94', 'แอดมิน'),
    ('c4', 9, 'short_form_clip', 'content_repurposer', 'หน้างาน', 'พาเข้าไลฟ์ (ของขึ้นไลฟ์คืนนี้)', '#a2191d', null),
    ('c4', 10, 'broadcast_script_line', 'copywriter', null, 'ลูกค้า/ความสัมพันธ์', '#4f7f6a', 'Maz เขียนหลัง 15 ต.ค.'),
    ('c4', 11, 'fb_post', 'content_repurposer', null, 'ลูกค้า/ความสัมพันธ์', '#4f7f6a', 'จากคลิปเดือนนี้')
  ) as a(ck, seq, artifact_type, owner_role, shot_desc, cat, hex, note_extra);

  -- ==========================================================================
  -- 4. step_gate — quota_check บน 2 แถว LINE (ตัวนับ ≤4 ครั้ง/28 วัน)
  -- ==========================================================================

  insert into analytics.step_gate (step_id, shop_id, gate_kind, status, note)
  select
    (select cs.id from analytics.campaign_step cs where cs.campaign_id = v_c2_id and cs.seq = 3),
    v_shop_id, 'quota_check', 'pending', 'LINE broadcast ครั้งที่ 1/4 ในหน้าต่าง 28 วัน — เช็คโควตา ก.ย. เหลือก่อนส่ง (R4 ใน md, ค้างคำตอบ Q6ข)';

  insert into analytics.step_gate (step_id, shop_id, gate_kind, status, note)
  select
    (select cs.id from analytics.campaign_step cs where cs.campaign_id = v_c4_id and cs.seq = 10),
    v_shop_id, 'quota_check', 'pending', 'LINE broadcast ครั้งที่ 2/4 (สำรอง) ในหน้าต่าง 28 วัน — ยังไม่ตัดสินว่าจะส่งหรือไม่ (รอ 15 ต.ค.)';

  raise notice '0120_seed_content_calendar_202610: seeded 4 campaigns (c1=%, c2=%, c3=%, c4=%), 26 steps, 26 artifacts, 2 gates for shop %',
    v_c1_id, v_c2_id, v_c3_id, v_c4_id, v_shop_id;
end;
$$;

-- ============================================================================
-- Verify (run after apply — not part of the seed):
--   select cp.name, count(cs.id) as step_count
--   from analytics.campaign cp join analytics.campaign_step cs on cs.campaign_id = cp.id
--   where cp.shop_id = 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7'
--     and cp.name in ('คลิปดันไลฟ์ (สลับสัปดาห์)','เงินเดือน ต.ค. (15–18)',
--                     'การ์ดในกล่อง → LINE OA','ปฏิทินโพสต์ ต.ค. 69 — evergreen')
--   group by cp.name;
--   -- expect: 9 / 5 / 1 / 11 (26 รวม) · septest step_artifact count = 26 · step_gate count = 2
-- ============================================================================

-- ============================================================================
-- DRY-RUN BLOCK (skill 3j-migration-traps #11) — copy this alone, run, read the
-- notice/exception output, then rollback happens automatically. Does NOT touch
-- the DO block above; run this AFTER a real apply to prove counts, or run it
-- standalone against a branch/preview DB before applying for real.
-- ============================================================================
-- do $$
-- declare
--   v_log text := E'\n=== dry-run: 0120 seed check ===\n';
--   v_shop_id uuid := 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7'::uuid;
--   v_campaigns int; v_steps int; v_artifacts int; v_gates int;
-- begin
--   select count(*) into v_campaigns from analytics.campaign
--     where shop_id = v_shop_id and name in (
--       'คลิปดันไลฟ์ (สลับสัปดาห์)','เงินเดือน ต.ค. (15–18)',
--       'การ์ดในกล่อง → LINE OA','ปฏิทินโพสต์ ต.ค. 69 — evergreen');
--   select count(*) into v_steps from analytics.campaign_step cs
--     join analytics.campaign cp on cp.id = cs.campaign_id
--     where cp.shop_id = v_shop_id and cp.name in (
--       'คลิปดันไลฟ์ (สลับสัปดาห์)','เงินเดือน ต.ค. (15–18)',
--       'การ์ดในกล่อง → LINE OA','ปฏิทินโพสต์ ต.ค. 69 — evergreen');
--   select count(*) into v_artifacts from analytics.step_artifact sa
--     join analytics.campaign_step cs on cs.id = sa.step_id
--     join analytics.campaign cp on cp.id = cs.campaign_id
--     where cp.shop_id = v_shop_id and cp.name in (
--       'คลิปดันไลฟ์ (สลับสัปดาห์)','เงินเดือน ต.ค. (15–18)',
--       'การ์ดในกล่อง → LINE OA','ปฏิทินโพสต์ ต.ค. 69 — evergreen');
--   select count(*) into v_gates from analytics.step_gate sg
--     join analytics.campaign_step cs on cs.id = sg.step_id
--     join analytics.campaign cp on cp.id = cs.campaign_id
--     where cp.shop_id = v_shop_id and cp.name in (
--       'คลิปดันไลฟ์ (สลับสัปดาห์)','เงินเดือน ต.ค. (15–18)',
--       'การ์ดในกล่อง → LINE OA','ปฏิทินโพสต์ ต.ค. 69 — evergreen');
--   v_log := v_log || format('campaigns=%s (expect 4) · steps=%s (expect 26) · artifacts=%s (expect 26) · gates=%s (expect 2)',
--                             v_campaigns, v_steps, v_artifacts, v_gates);
--   raise exception '%', v_log;  -- forces rollback, prints the counts as the error message
-- end; $$;

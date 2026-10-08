-- 0162_content_feedback_verdict_inbox.sql  (C3 ส่วนที่สอง — คำตัดสินแคมเปญ + กล่องข้อเสนอ/คำถาม + Weekly Brief ฉบับเต็ม + metric ออเดอร์ระดับแคมเปญ)
--
-- สถานะ: DRAFT ยังไม่ apply — พึ่ง 0161 (ยังไม่ apply เช่นกัน ⇒ dry-run ต้องต่อ 0161 ก่อนเสมอ) · ต้องผ่าน security (AI ตัดสินแทนเจ้าของ = ความเสี่ยงหลัก) + QA scope L ก่อน merge
-- Design: docs/3j-jewelry/analytics/design-content-workflow-schema-gap.md §13.0 · §13.4-§13.6 · §13.7 (Y13-Y22 · Y23) · §13.8 (N8 · N10-N13 · N16-N18) · §13.x มติ Q10 + Q12 + metric ออเดอร์
--
-- ทำอะไร:
--   1. ตาราง content_weekly_summary (Weekly Brief ฉบับเต็ม — มติ Q10) + RPC content_weekly_summary_upsert
--   2. campaign: metric + baseline + เกณฑ์ + ขอบเขตนับออเดอร์ + คำตัดสินที่ AI เสนอ / เจ้าของยืนยัน + trigger ด่านตาราง
--      RPC campaign_plan_set · campaign_verdict_propose · campaign_verdict_confirm (owner เท่านั้น · compare-and-set)
--   3. recommendation_log: kind / respond_by / default_action / related_step_id / summary_id / created_by_role / acted_by_role + trigger ด่านตาราง
--      RPC recommendation_create (กันซ้ำ) · recommendation_respond (owner เท่านั้น)
--   4. view ใหม่: v_campaign_summary (หน้า E) · v_recommendation_inbox (inbox: ข้อเสนอ + ด่านความเสี่ยง + แคมเปญรอยืนยัน)
--
-- 🔴 มติเจ้าของ 7 ต.ค. 69 ที่ทับสเปกเดิม (§13.x):
--   Q10 เก็บ Weekly Brief ฉบับเต็ม (markdown) ในแอป ⇒ content_weekly_summary.body_md
--   Q12 ปิดแคมเปญได้ทุกเมื่อ แม้มีชิ้นค้าง ⇒ campaign_verdict_confirm ไม่ปฏิเสธ · บันทึกจำนวนชิ้นค้างตอนปิด (campaign.result_open_pieces + payload open_pieces / open_by_status)
--       และชิ้นค้างไม่นับในผล (v_campaign_summary + ด่าน 4 ชิ้น นับเฉพาะชิ้นที่ posted หรือแคมเปญเก่าที่ไม่มี piece_status) — ตัดด่าน C3-5 ของสเปกเดิมทิ้ง
--   metric ออเดอร์ระดับแคมเปญ: metric_code = 'orders' + ขอบเขต (ช่องทาง · กลุ่มสินค้า · ช่วงวัน) · view นับจาก v_content_order_daily (0161)
--       ⚠️ ไม่ตั้ง metric ให้แคมเปญ 10.10 (75a252d4-…) ใน migration นี้ — Tech Lead ตั้งภายหลังผ่าน campaign_plan_set
--
-- 🔴 ตัดสินใจเองนอกสเปก (เหตุผลอยู่ที่จุดนั้น + สรุปส่งมอบ):
--   A  ขอบเขตนับออเดอร์เป็นคอลัมน์ของ campaign (metric_channel_code · metric_affinity · metric_date_from/to) — ช่วงวันขายของแคมเปญ ≠ ช่วงวันของ step
--      (10.10: ขาย 7-10 ต.ค. แต่ step เดียวอยู่ 7 ต.ค.) ⇒ ไม่ตั้ง = ใช้ช่วง step · ไม่มี step = anchor_date วันเดียว · ตั้งได้เฉพาะเมื่อ metric_code = 'orders' (CHECK + RPC)
--   B  ด่านคำตัดสิน (campaign_verdict_gate_ — helper ตัวเดียวที่ propose + confirm ใช้ร่วม): validated/invalidated บน save_rate/share_rate ต้องมี ≥ 4 ชิ้น (distinct step) ที่มี T+7 ·
--      บน orders ต้องตั้ง pass_threshold + pass_op ก่อน · รู้ช่วงวัน · 🔴 และข้อมูลออเดอร์ของร้านต้องครบช่วง (orders_data_covers_window = true — SEC-H1 · รอบ 2 เข้มขึ้น ดูข้อ Y)
--      (รอบแรกเคยไม่บล็อกด้วยเหตุผล "ออเดอร์ 0 ในวันท้ายคือผลจริง" — security ตีกลับ: ไฟล์ import รายเดือนยังไม่เข้า ยอด 0 ที่เห็นคือ "ยังไม่มีข้อมูล" ไม่ใช่ "ไม่มีใครซื้อ" ⇒ ฟันธงไม่ได้)
--      data_through = วันล่าสุดที่ร้านมีออเดอร์ "ทุกช่องทาง" (ไม่กรองช่องทางที่แคมเปญนับ — ไฟล์ import เข้าทีเดียวทุกช่องทาง ช่องที่เงียบไม่ใช่เหตุให้ถือว่าข้อมูลไม่ถึง) ·
--      ร้านที่ไม่มีออเดอร์เลย (null) = ไม่ครอบ · inconclusive/not_measured ยังเสนอ/ยืนยันได้เสมอ · แคมเปญที่ทุกชิ้นถูกยกเลิก (pieces_total > 0 และ posted+open = 0) ฟัน validated/invalidated ไม่ได้ (SEC-Low)
--   C  campaign_verdict_confirm บังคับ p_expected_proposed ไม่เป็น null (22023) — รับ 'none' หรือ '' = "คาดว่าไม่มีข้อเสนอ" (สเปกใช้ '' · 0161 ใช้ 'none' ⇒ รับทั้งคู่ กัน form ส่งค่าว่าง)
--      + (SEC-M1) p_expected_token บังคับไม่เป็น null — ดูข้อ Q
--   D  p_lesson ของ confirm ≤ 300 ตัวอักษร (สเปก 500) — content_signal.summary จำกัด 1-300 · คอลัมน์ campaign.lesson ยัง CHECK ≤ 500 ตามสเปก (แบบเดียวกับ 0161 ข้อ D)
--   E  ไม่ใช่ owner ทับของ owner ไม่ได้: propose โดย ai/system ทับข้อเสนอของ owner = 42501 · weekly_summary_upsert โดย ai/system ทับฉบับที่ owner เป็นคนเขียนล่าสุด = 42501 (ห้ามทับเงียบ)
--   F  content_weekly_summary_upsert คืน jsonb {id, created, changed, revision} แทน uuid (สเปกเขียน uuid) — ให้ผู้เรียกเห็นว่า "สร้างใหม่ / ทับ / ไม่มีอะไรเปลี่ยน" · เพิ่มคอลัมน์ revision + updated_by_role ·
--      ส่งเนื้อหาเดิมซ้ำ = ไม่เขียน (changed=false)
--   G  recommendation_log: partial unique index (shop_id, lower(btrim(title))) where owner_action = 'pending' — กันซ้ำที่ระดับตารางจริง (race ของ create 2 คำสั่ง + MCP insert ตรง) ·
--      ตรวจแล้ว 7 ต.ค.: pending จริงไม่มีชื่อซ้ำ ⇒ สร้าง index ได้ · RPC ตรวจก่อนเพื่อข้อความที่มี id (23505)
--   H  detail/body ไม่ผ่าน content_text_clean (มันยุบ newline ทั้งหมด) — ใช้ btrim + ปฏิเสธอักขระ bidi/ล่องหน (content_bidi_present_) แทน · ZWJ/ZWNJ (U+200C-D) ยอมให้ผ่าน (emoji ต่อกัน) ·
--      ข้อความสั้น (title/hypothesis/lines/note/reason) ผ่าน content_text_clean ตามเดิม
--   I  hypothesis / baseline_note ห้ามมี [ต้องยืนยัน (สเปกกำหนดเฉพาะบทเรียน/คำตอบ) — สมมติฐานที่ยังมีข้อเท็จจริงรอยืนยันไม่ควรบันทึกเป็นแผน
--   J  ฝั่งเขียนตรงของ service_role ถอนสิทธิ์ที่ระดับ GRANT (บทเรียน 0161 H1/M3): recommendation_log (insert/update/delete/truncate) · content_weekly_summary (ทั้งหมดยกเว้น select) ·
--      trigger ด่านตารางเป็นชั้นที่สอง (พิสูจน์ใน verify โดย grant กลับชั่วคราว) · FK ที่วิ่งเข้าประวัติ: ทุกตัว ON DELETE SET NULL (reco → step/summary/campaign) หรือ CASCADE จาก public.shop เท่านั้น
--      (ลบร้านถูกถอดจาก service_role แล้วใน 0161) ⇒ ไม่มีทางลบแถวประวัติ reco/summary ด้วยการลบตารางแม่ · ผลข้างเคียง: แก้คำผิด title/detail ของข้อเสนอ pending ผ่าน service_role ตรงไม่ได้แล้ว
--      (สเปกให้แก้ได้) — ใช้ MCP (postgres) เหมือนเดิม
--   K  campaign.result_open_pieces = จำนวนชิ้นค้างตอนยืนยัน (Q12) — คอลัมน์ ผูก all-or-nothing กับ result_verdict_confirmed_at (CHECK)
--   L  แถว recommendation_log ที่เจ้าของตอบแล้ว: แก้ title/detail/source/kind/shop ไม่ได้ทุก role รวม postgres (สเปก Y20 — เขียนประวัติ "เจ้าของตอบอะไร" ย้อนหลังไม่ได้) ·
--      postgres ยังปิดข้อเสนอเก่าตรง (owner_action/acted_at) และแก้ outcome_note ได้ · RI SET NULL (related_*/summary_id) ผ่าน
--   M  ชื่อ helper bidi = content_bidi_present_ (ไม่ใช่ content_text_*) — verify-0158 A3c นับฟังก์ชันด้วย prefix content_text_ ต้องได้ 9 พอดี
--   N  ด่าน 4 ชิ้นนับ count(distinct step) ที่มี T+7 (KPI def = "ชิ้น" · สเปกเขียน "โพสต์") · ช่วงวัน step ใน v_campaign_summary = min(resolved_start) .. max(coalesce(resolved_end, resolved_start))
--      (สเปกเขียน min/max resolved_start) · ผลต่อโพสต์ในแคมเปญนับเฉพาะชิ้น posted หรือแคมเปญเก่าที่ไม่มี piece_status
--   O  ข้อเสนอ recommendation_respond หมดเวลา = ตอบได้ (สเปก 13.5: คำตอบจริงชนะค่าเริ่มต้น) — "ใช้ค่าเริ่มต้น" = view แสดง expired + default_action ไม่ใช่ RPC ปฏิเสธ/เขียนแทน ·
--      ข้อยกเว้นเดียวที่ระบบเขียน expired: recommendation_create ปิด pending ชื่อซ้ำที่หมดเวลา (ข้อ AG) ด้วย acted_by_role = system — เจ้าของยังตอบแถวนั้นได้ (R3-M1 · ข้อ AI)
--
-- 🔴 รอบแก้ตาม security (CONDITIONAL GO — High 3) + QA (PASS with notes) 7 ต.ค. 69 — ตัดสินใจเองเพิ่ม:
--   P  (SEC-H1) ดูข้อ B · v_campaign_summary.orders_data_through ไม่กรองช่องทางแล้ว
--   Q  (SEC-M1) compare-and-set แบบ "token ของเนื้อหาที่เจ้าของเห็น" (md5 ของ jsonb array) แทน updated_at: (1) updated_at ไปพร้อมการแก้ที่ไม่เกี่ยว (บอร์ด/สถานะ) ⇒ ชนปลอม
--      (2) timestamptz ที่ผ่าน JSON/JS Date เสียไมโครวินาที ⇒ ส่งกลับไม่ตรงเอง · token คำนวณฝั่ง DB อย่างเดียว (campaign_verdict_token_ / recommendation_token_) แสดงใน view
--      (v_campaign_summary.verdict_token · v_recommendation_inbox.content_token) แล้วหน้าจอส่งกลับมา — เนื้อหาเปลี่ยนระหว่างอ่าน = 55000 "ข้อมูลเปลี่ยนแล้ว รีเฟรชก่อน"
--      campaign_verdict_confirm: คง p_expected_proposed ไว้ (ข้อความอ่านง่าย) + เพิ่ม p_expected_token · recommendation_respond เพิ่ม p_expected_token · ทั้งคู่ null = 22023
--      signature เปลี่ยน ⇒ drop signature เดิมก่อน create (trap #1) · re-grant ครบด้วยลูป §10
--   R  (SEC-H2) recommendation_log.owner_response แยกจาก outcome_note: คำตอบของเจ้าของเขียนครั้งเดียวผ่าน recommendation_respond · outcome_note = ผลที่ทีมจดทีหลัง (แก้ได้)
--      guard: ถ้า old.acted_by_role = 'owner' ห้ามแก้ owner_action/owner_response/acted_at/acted_by/acted_by_role ทุก role รวม postgres (แถวเก่าที่ acted_by_role ว่าง = ยังปิดตรงได้ เหมือน N16b)
--      ⚠️ ข้อจำกัดที่รู้: postgres (MCP ของ Tech Lead) ตั้ง acted_by_role = 'owner' เองบนแถว pending ได้ — ปลอมว่าเจ้าของตอบได้ (D18: ไม่มี GUC แยก RPC กับ postgres)
--   S  (SEC-M2) ai/system แก้ campaign_plan_set ไม่ได้เมื่อ วันนี้(ไทย) >= coalesce(metric_date_from, anchor_date) (ทั้งค่าเดิมและค่าใหม่ที่จะตั้ง — กันดึงเริ่มช่วงถอยหลังไปคลุมยอดที่เห็นแล้ว)
--      หรือเมื่อมีข้อเสนอคำตัดสินแล้ว (result_verdict_proposed) · owner แก้ได้เหมือนเดิม · ทั้งสามเงื่อนไข = 42501
--   T  (SEC-M3) content_bidi_present_ ขยายชุดอักขระ: Unicode Tag U+E0000-E007F · U+00AD · U+180E · U+2028/2029 · U+FFF9-FFFB · U+3164 · U+115F · control 01-08/0B/0C/0E-1F/7F (ZWJ/ZWNJ ยังผ่าน) ·
--      ไม่ replace content_text_clean ของ 0158 (ด่านท้ายไฟล์ pin md5 ฟังก์ชันเดิมทุกตัว) ⇒ ข้อความสั้นของ RPC ในไฟล์นี้ผ่าน content_text_clean ตามเดิม "แล้วตรวจซ้ำด้วย content_bidi_present_" (ปฏิเสธ 22023
--      ถ้าเหลืออักขระชุดใหม่) · ช่องของ 0158-0161 (content_signal/hook ฯลฯ) ยังใช้ content_text_clean เดิม = ยังไม่ครอบชุดใหม่ — รอเจ้าของ/Tech Lead ตัดสินว่าจะขยาย 0158 ไหม
--   U  (QA-1) บรรทัดสรุป Weekly Brief เพดาน 1,000 ตัวอักษร (เดิม 300 — Brief #4 จริงยาว 613) · เนื้อหาเต็มเพดานเดิม 80,000
--   V  (QA-4) campaign_verdict_confirm: p_lesson null = "ไม่ส่ง" คงบทเรียนเดิม · '' / ช่องว่างล้วน = ตั้งใจล้าง · ข้อความ = ตั้งใหม่ (ยืนยันซ้ำโดยไม่ส่งบทเรียนไม่ทับเป็นว่างอีก)
--   W  (QA-5) recommendation_create คืน jsonb {id, created, conflict} แทน uuid: ชื่อซ้ำที่ยัง pending = คืน id เดิม created=false (ไม่ error 23505) · เนื้อหาต่างจากเดิม (detail/kind/เส้นตาย/ค่าเริ่มต้น/เวลา/ลิงก์)
--      = conflict=true ไม่ทับเงียบ · แข่งกัน 2 คำสั่ง: insert ... on conflict do nothing ชน partial unique index แล้วอ่านแถวเดิมกลับ
--   X  (SEC-Low) campaign.status ไม่มีค่า 'cancelled' (CHECK 0049: active/scheduled/blocked/waiting_data/done) ⇒ ตีความ "แคมเปญที่ยกเลิก" = ทุกชิ้นใน workflow ถูกยกเลิก (ดูข้อ B) และฟันได้แค่ inconclusive/not_measured
--      (มติ Q12 ปิดได้ทุกเมื่อ ไม่ถูกทับ) · service_role/authenticated/anon ตั้ง campaign.status = 'done' ตรงไม่ได้ (guard — done ผ่าน campaign_verdict_confirm เท่านั้น)
--
-- 🔴 รอบ 2 ตาม security (NO-GO มีเงื่อนไข) + QA รอบ 2 — 7 ต.ค. 69 · ตัดสินใจเองเพิ่ม (รายละเอียด ณ จุดที่แก้):
--   Y  (R-H1 High) orders_data_covers_window เข้มขึ้น: ข้อมูลร้านต้องไปถึง "วันหลังวันสุดท้าย" (through > วันท้าย) — วันท้ายที่ไฟล์เข้ามาบางส่วนไม่นับว่าครบ (พิสูจน์บนข้อมูลจริง: 6 ต.ค. มี LINE แต่ TikTok 0) ·
--      ถ้าแคมเปญระบุช่องทาง ช่องนั้นต้องมีออเดอร์ถึงวันท้ายด้วย (view คอลัมน์ใหม่ orders_channel_data_through · lateral max(order_date) ต่อช่อง affinity all) ·
--      trade-off: ช่องที่เงียบจริงในวันท้ายฟันธงไม่ได้ (แยก "เงียบจริง" กับ "ไฟล์ยังไม่เข้า" ไม่ได้) — เสนอ/ยืนยัน inconclusive ได้เสมอ
--   Z  (R-M2a) ด่าน "AI แก้แผนหลังช่วงนับเริ่ม" ใช้วันเริ่มเดียวกับวิว: least(metric_date_from, anchor_date, min(anchor_date + step.offset_start_days)) — มี offset ติดลบจริงในแม่แบบ ·
--      ค่า metric_date_from ใหม่ที่ AI จะตั้งก็วัดด้วย least เดียวกัน
--   AA (R-M2b) campaign.plan_set_by_role (owner/ai/system · null ได้): campaign_plan_set เขียนทุกครั้ง · AI/system ทับแผนที่ owner ตั้ง = 42501 (ก่อนเริ่มก็ทับไม่ได้) ·
--      อยู่ใน tuple campaign_result_guard + token · null = ไม่เดาว่าเป็นของเจ้าของ (แถวเก่า 7 แถวที่มีสมมติฐานเริ่มไปแล้ว ด่านวันเริ่มกันอยู่)
--   AB (R-M1) verdict_token ครอบ anchor_date + สรุป step (min offset_start · max coalesce(offset_end, offset_start) · count) + plan_set_by_role
--   AC (R-M4) recommendation_create: ผู้เรียกที่ไม่ใช่ owner ตั้ง respond_by < วันนี้+2 ไม่ได้ (22023) · default_action ตรวจ [ต้องยืนยัน เหมือน title (QA)
--   AD (R2-1 QA) recommendation_log_guard ล็อก DELETE แถวที่เจ้าของตอบแล้ว (acted_by_role = owner) ทุก role รวม postgres → 55000 · ผลข้างเคียงที่รู้: CASCADE จาก public.shop ก็ติดด้วย (ตั้งใจ)
--   AE (Low) content_bidi_present_ เพิ่มชุดอักขระ (C1 · 034F · 17B4/5 · 1160 · 206A-206F · FFA0 · 1BCA0-3 · E0100-E01EF — ไม่รวม FE00-FE0F)
--   AF (Low · B7) แคมเปญที่เจ้าของยืนยันคำตัดสินแล้ว service_role/authenticated/anon เปลี่ยน status ไม่ได้ (55000)
--   AG (Low) dedupe ข้อเสนอ: pending ที่หมดเวลาแล้วถูกปิดเป็น expired ก่อนสร้าง (ไม่ใช่ข้ามตอนตรวจ — partial unique index ยังบังอยู่ · 0101 อนุญาต expired ตรงๆ · KPI ไม่ขยับ) · payload เพิ่ม expired_previous
--   AH (Low) recommendation_log.acted_session_user = session_user ตอน recommendation_respond (ตรวจ spoof ย้อนหลังจนกว่า A2) · อยู่ในรายการล็อกของ guard
--
-- 🔴 รอบ 3 (security รอบ 3 · code review C-3PO APPROVE) — 7 ต.ค. 69:
--   AI (R3-M1) แถว pending ที่ recommendation_create ปิดเป็น expired ตั้ง acted_by_role = system (CHECK owner/system) · recommendation_respond รับ pending หรือ expired+system ·
--      is_late ใน view นับเฉพาะ acted_by_role = owner · หลังเจ้าของตอบ guard ล็อกเหมือนเดิม (acted_by_role → owner) · payload เพิ่ม reopened_from_system_expiry
--   AJ (R3-H1 High) ระบุช่องทาง → ช่องนั้นต้องมีออเดอร์ "หลัง" วันท้าย (och.d > วันท้าย) · ไม่ระบุ → ร้านมีข้อมูลหลังวันท้าย และทุกช่องหลัก (≥10% ของออเดอร์ร้านใน 28 วันก่อนวันท้าย) มีข้อมูลหลังวันท้ายด้วย ·
--      view คอลัมน์ใหม่ orders_major_channels_covered · อ่านวันล่าสุดจาก fact_order ตรง (perf — แทน v_content_order_daily) · ข้อความ gate เป็นภาษาไทยเจ้าของ ไม่มีรหัสภายใน
--   AK (code review 7) trigger กัน TRUNCATE (statement-level · ฟังก์ชัน content_history_truncate_guard) บน recommendation_log + content_weekly_summary — ครอบ TRUNCATE ... CASCADE จากตารางแม่
--
-- ไม่มีเทสต์ครอบ (บอกตรงๆ — ดูท้าย verify-0162):ถอด `for update` ของ RPC (ต้องใช้ 2 connection) · TRUNCATE เมื่อมีคน grant กลับ (กันที่ชั้น GRANT เท่านั้น) · เวลาคร่อม 00:00-07:00 ไทยจริง
--
-- Grant model (3j-migration-traps #18): ทุก object ใหม่ grant ให้ service_role อย่างเดียว · revoke ครบสามชื่อ (public/anon/authenticated)
-- ⚠️ ห้ามมี `to authenticated` ในไฟล์นี้ (สคีมา analytics ปิด REST ของ anon/authenticated ทั้งสคีมา — 0123)
-- 🔴 view ใหม่ "ไม่กรองร้านให้" — security_invoker + service_role ข้าม RLS ⇒ frontend ต้อง .eq('shop_id', shopId) ทุก query
-- 🔴 map error จาก errcode: 22023 = อินพุตผิด · 42501 = ไม่ใช่เจ้าของ/สิทธิ์ · 23505 = ซ้ำ · 55000 = สถานะไม่เอื้อ/ด่านตาราง (ห้าม match ข้อความ)
-- ไฟล์ไม่มี UPDATE/backfill (trap #19) · add column ทุกตัว nullable/มี default คงที่ = ไม่ rewrite · idempotent (รันซ้ำในทรานแซกชันเดียวผ่าน) · LF
-- 🔴 ห้ามรันนอก `node scripts/run-sql.mjs` — ด่านท้ายไฟล์เทียบกับ snapshot ใน GUC ระดับทรานแซกชัน (c5.snap_* — 0160 ใช้ c3.* · 0161 ใช้ c4.*)

-- ============================================================================
-- 0. ด่านต้นไฟล์ (พึ่ง 0161) + snapshot ก่อนแตะอะไร
-- ============================================================================

do $c5pre$
begin
  if to_regclass('analytics.v_content_post_result') is null
     or to_regclass('analytics.v_content_order_daily') is null
     or to_regclass('analytics.v_content_piece') is null
     or to_regprocedure('analytics.content_post_verdict_confirm(uuid,uuid,text,text,text,text)') is null
     or to_regprocedure('analytics.content_piece_try_numeric_(text)') is null
     or to_regprocedure('analytics.content_actor_assert(text,text[],text)') is null
     or to_regprocedure('analytics.crm_require_owner_admin(uuid)') is null
     or to_regprocedure('analytics.content_text_clean(text)') is null
     or to_regprocedure('analytics.content_marker_present(text)') is null
     or to_regprocedure('public.set_updated_at()') is null
     or not exists (select 1 from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'content_signal_capture')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'analytics' and table_name = 'content_post' and column_name = 'result_label_override')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'analytics' and table_name = 'campaign_step' and column_name = 'piece_status') then
    raise exception '0162: ต้อง apply 0161 ก่อน — ไม่พบ v_content_post_result / v_content_order_daily / content_post.result_label_override / content_post_verdict_confirm (dry-run ให้ต่อ 0161 ก่อน 0162 ในไฟล์เดียว)';
  end if;
end
$c5pre$;

do $c5snap$
begin
  perform set_config('c5.snap_metric', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, view_count, like_count, comment_count, save_count, share_count,
             is_regression, source, array_to_string(sources, ','), captured_at, captured_on, age_days), E'\n' order by id), ''))
    from analytics.content_post_metric), true);
  perform set_config('c5.snap_post', (
    select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
           md5(coalesce(string_agg(concat_ws('|', id, status, step_id, hook_id, post_url, posted_at, updated_at), E'\n' order by id), ''))
    from analytics.content_post), true);
  perform set_config('c5.snap_step', (
    select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
           md5(coalesce(string_agg(concat_ws('|', id, status, piece_status, metric_code, hold_reason, updated_at), E'\n' order by id), ''))
    from analytics.campaign_step), true);
  perform set_config('c5.snap_campaign', (
    select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
           md5(coalesce(string_agg(concat_ws('|', id, status, result_verdict, result_note, hypothesis, anchor_date, updated_at),
             E'\n' order by id), ''))
    from analytics.campaign), true);
  perform set_config('c5.snap_reco', (
    select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
           md5(coalesce(string_agg(concat_ws('|', id, owner_action, acted_at, outcome_note, title, detail, updated_at),
             E'\n' order by id), ''))
    from analytics.recommendation_log), true);
  perform set_config('c5.snap_gate', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', step_id, gate_kind, status, note, updated_at), E'\n' order by step_id, gate_kind), ''))
    from analytics.step_gate), true);
  perform set_config('c5.snap_views', (
    select count(*)::text || ':' || md5(coalesce(string_agg(c.relname || '=' || pg_get_viewdef(c.oid), E'\n' order by c.relname), ''))
    from pg_class c
    where c.relnamespace = 'analytics'::regnamespace and c.relkind = 'v'
      and c.relname not in ('v_campaign_summary', 'v_recommendation_inbox')), true);
  perform set_config('c5.snap_funcs', (
    select count(*)::text || ':' || md5(coalesce(string_agg(p.oid::regprocedure::text || '=' || pg_get_functiondef(p.oid), E'\n'
             order by p.oid::regprocedure::text), ''))
    from pg_proc p
    where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
      and p.proname !~ '^(content_bidi_present_|campaign_open_pieces_|campaign_verdict_gate_|campaign_verdict_token_|recommendation_token_|content_weekly_summary_guard|content_history_truncate_guard|campaign_result_guard|recommendation_log_guard|campaign_plan_set|campaign_verdict_propose|campaign_verdict_confirm|recommendation_create|recommendation_respond|content_weekly_summary_upsert)$'), true);
end
$c5snap$;

-- ============================================================================
-- 1. ตาราง content_weekly_summary (มติ Q10 — ฉบับเต็ม) — สร้างก่อน recommendation_log เพราะมี FK ชี้มา
--    เขียนผ่าน RPC definer เท่านั้น (guard trigger + ถอนสิทธิ์เขียนจาก service_role) · ไม่มี FK ไป reco (ทิศเดียว reco → summary)
-- ============================================================================

create table if not exists analytics.content_weekly_summary (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references public.shop (id) on delete cascade,
  week_start      date not null,
  brief_date      date not null,
  brief_no        int,
  summary_lines   text[] not null,
  body_md         text not null,
  source_path     text,
  revision        int not null default 1,
  created_by_role text not null,
  created_by      uuid,
  updated_by_role text not null,
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint content_weekly_summary_shop_week_key unique (shop_id, week_start),
  constraint content_weekly_summary_week_check
    check (extract(isodow from week_start) = 1 and week_start >= date '2025-01-01' and week_start < date '2100-01-01'),
  constraint content_weekly_summary_brief_date_check
    check (brief_date >= week_start and brief_date <= week_start + 14),
  constraint content_weekly_summary_brief_no_check
    check (brief_no is null or brief_no between 1 and 9999),
  -- ความยาว/ความว่างของแต่ละบรรทัดตรวจใน RPC (CHECK ใส่ subquery/unnest ไม่ได้) · ที่นี่กัน array หลายมิติ + element null ซึ่ง cardinality ไม่จับ
  constraint content_weekly_summary_lines_check
    check (cardinality(summary_lines) between 1 and 5 and array_ndims(summary_lines) = 1 and array_position(summary_lines, null::text) is null),
  constraint content_weekly_summary_body_check
    check (length(body_md) between 1 and 80000 and length(btrim(body_md)) >= 1),
  constraint content_weekly_summary_source_path_check
    check (source_path is null or source_path ~ '^docs/3j-jewelry/marketing/weekly-brief/[0-9]{4}-[0-9]{2}-[0-9]{2}\.md$'),
  constraint content_weekly_summary_created_role_check check (created_by_role in ('owner', 'ai', 'system')),
  constraint content_weekly_summary_updated_role_check check (updated_by_role in ('owner', 'ai', 'system')),
  constraint content_weekly_summary_revision_check check (revision >= 1)
);

comment on table analytics.content_weekly_summary is
  'Weekly Brief ฉบับเต็ม (markdown) + สรุป 1-5 บรรทัด — สำเนาที่เผยแพร่ในแอป (มติ Q10) · เอกสารต้นทางยังเป็น md ใน git (source_path) · '
  'เขียนผ่าน content_weekly_summary_upsert เท่านั้น (service_role ไม่มีสิทธิ์เขียนตรง) · revision เพิ่มทุกครั้งที่เนื้อหาเปลี่ยน';

alter table analytics.content_weekly_summary enable row level security;
drop policy if exists tenant_isolation_select on analytics.content_weekly_summary;
create policy tenant_isolation_select on analytics.content_weekly_summary
  for select using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

drop trigger if exists trg_content_weekly_summary_updated_at on analytics.content_weekly_summary;
create trigger trg_content_weekly_summary_updated_at
  before update on analytics.content_weekly_summary
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 2. campaign — คอลัมน์ใหม่ (nullable ล้วน · add column ไม่ยิง trigger) + CHECK ชื่อ campaign_<col>_check (drop-if-exists ก่อน add)
--    result_verdict (0101 · not null default not_measured) / result_note คงเดิมเป็น "ค่าที่เจ้าของยืนยัน" — 12 แถวเก่าอ่านว่ายังไม่ได้วัด ถูกต้องอยู่แล้ว
-- ============================================================================

alter table analytics.campaign
  add column if not exists metric_code                       text,
  add column if not exists baseline_value                    numeric,
  add column if not exists baseline_spread                   numeric,
  add column if not exists baseline_as_of                    date,
  add column if not exists baseline_note                     text,
  add column if not exists pass_threshold                    numeric,
  add column if not exists pass_op                           text,
  add column if not exists metric_channel_code               text,
  add column if not exists metric_affinity                   text,
  add column if not exists metric_date_from                  date,
  add column if not exists metric_date_to                    date,
  add column if not exists result_verdict_proposed           text,
  add column if not exists result_proposed_note              text,
  add column if not exists result_proposed_at                timestamptz,
  add column if not exists result_proposed_by_role           text,
  add column if not exists result_verdict_confirmed_at       timestamptz,
  add column if not exists result_verdict_confirmed_by_role  text,
  add column if not exists lesson                            text,
  add column if not exists result_open_pieces                int,
  add column if not exists plan_set_by_role                  text;   -- R-M2b: ใครตั้งแผนล่าสุดผ่าน campaign_plan_set (null = ยังไม่เคยตั้งผ่าน RPC นี้ · แถวเก่าก่อน 0162)

alter table analytics.campaign drop constraint if exists campaign_plan_set_by_role_check;
alter table analytics.campaign add constraint campaign_plan_set_by_role_check
  check (plan_set_by_role is null or plan_set_by_role in ('owner', 'ai', 'system'));

-- ชุด metric_code เดียวกับ campaign_step (0161) — ใช้ 'orders' ได้ทั้งสองระดับ
alter table analytics.campaign drop constraint if exists campaign_metric_code_check;
alter table analytics.campaign add constraint campaign_metric_code_check
  check (metric_code is null or metric_code in ('save_rate', 'share_rate', 'peak_viewers', 'line_reply_count', 'orders', 'none'));

-- ตัวเลข: (x >= a and x <= b) — NaN ตกทั้งสองข้าง (Postgres ถือ NaN มากกว่าทุกค่า) · trap #4
alter table analytics.campaign drop constraint if exists campaign_baseline_value_check;
alter table analytics.campaign add constraint campaign_baseline_value_check
  check (baseline_value is null or (baseline_value >= -1000000000000 and baseline_value <= 1000000000000));
alter table analytics.campaign drop constraint if exists campaign_pass_threshold_check;
alter table analytics.campaign add constraint campaign_pass_threshold_check
  check (pass_threshold is null or (pass_threshold >= -1000000000000 and pass_threshold <= 1000000000000));
alter table analytics.campaign drop constraint if exists campaign_baseline_spread_check;
alter table analytics.campaign add constraint campaign_baseline_spread_check
  check (baseline_spread is null or (baseline_spread >= 0 and baseline_spread <= 1000000000000));
alter table analytics.campaign drop constraint if exists campaign_baseline_as_of_check;
alter table analytics.campaign add constraint campaign_baseline_as_of_check
  check (baseline_as_of is null or (baseline_as_of >= date '2020-01-01' and baseline_as_of < date '2100-01-01'));
alter table analytics.campaign drop constraint if exists campaign_baseline_note_check;
alter table analytics.campaign add constraint campaign_baseline_note_check
  check (baseline_note is null or length(baseline_note) <= 500);
alter table analytics.campaign drop constraint if exists campaign_pass_op_check;
alter table analytics.campaign add constraint campaign_pass_op_check
  check (pass_op is null or pass_op in ('>=', '<='));
-- เกณฑ์ต้องมาเป็นคู่ (ค่า + ทิศทาง) — ไม่งั้น "ผ่านหรือไม่" อ่านไม่ได้
alter table analytics.campaign drop constraint if exists campaign_pass_pair_check;
alter table analytics.campaign add constraint campaign_pass_pair_check
  check ((pass_threshold is null) = (pass_op is null));

-- ขอบเขตนับออเดอร์ (ตัดสินใจ A)
alter table analytics.campaign drop constraint if exists campaign_metric_channel_code_check;
alter table analytics.campaign add constraint campaign_metric_channel_code_check
  check (metric_channel_code is null or length(metric_channel_code) between 1 and 40);
alter table analytics.campaign drop constraint if exists campaign_metric_affinity_check;
alter table analytics.campaign add constraint campaign_metric_affinity_check
  check (metric_affinity is null or metric_affinity in ('all', 'bar', 'jewelry'));
-- ช่วงวันเป็นคู่ · to >= from · ไม่เกิน 366 วัน · ตัด infinity ด้วยขอบบน/ล่าง
alter table analytics.campaign drop constraint if exists campaign_metric_dates_check;
alter table analytics.campaign add constraint campaign_metric_dates_check
  check ((metric_date_from is null) = (metric_date_to is null)
         and (metric_date_from is null
              or (metric_date_from >= date '2020-01-01' and metric_date_to <= date '2100-01-01'
                  and metric_date_to >= metric_date_from and metric_date_to - metric_date_from <= 366)));
-- ขอบเขตตั้งได้เฉพาะ metric 'orders' — coalesce กัน metric_code null ทำให้ (null or false) = null แล้ว CHECK ผ่านเงียบ (trap #13)
alter table analytics.campaign drop constraint if exists campaign_metric_scope_needs_orders_check;
alter table analytics.campaign add constraint campaign_metric_scope_needs_orders_check
  check (coalesce(metric_code = 'orders', false)
         or (metric_channel_code is null and metric_affinity is null and metric_date_from is null and metric_date_to is null));

-- คำตัดสิน: ที่ AI/ผู้ช่วยเสนอ (proposed — ยังไม่ใช่คำตัดสิน) แยกจากที่เจ้าของยืนยัน (confirmed)
alter table analytics.campaign drop constraint if exists campaign_result_proposed_check;
alter table analytics.campaign add constraint campaign_result_proposed_check
  check (result_verdict_proposed is null or result_verdict_proposed in ('validated', 'invalidated', 'inconclusive', 'not_measured'));
alter table analytics.campaign drop constraint if exists campaign_result_proposed_note_check;
alter table analytics.campaign add constraint campaign_result_proposed_note_check
  check (result_proposed_note is null or length(result_proposed_note) between 3 and 1000);
alter table analytics.campaign drop constraint if exists campaign_result_proposed_role_check;
alter table analytics.campaign add constraint campaign_result_proposed_role_check
  check (result_proposed_by_role is null or result_proposed_by_role in ('owner', 'ai', 'system'));
alter table analytics.campaign drop constraint if exists campaign_result_proposed_consistency_check;
alter table analytics.campaign add constraint campaign_result_proposed_consistency_check
  check ((result_verdict_proposed is null) = (result_proposed_at is null)
         and (result_proposed_at is null) = (result_proposed_by_role is null)
         and (result_verdict_proposed is null) = (result_proposed_note is null));
alter table analytics.campaign drop constraint if exists campaign_result_confirmed_role_check;
alter table analytics.campaign add constraint campaign_result_confirmed_role_check
  check (result_verdict_confirmed_by_role is null or result_verdict_confirmed_by_role = 'owner');
-- ยืนยัน = เวลา + role + จำนวนชิ้นค้างตอนปิด (Q12) ครบชุดหรือไม่มีเลย
alter table analytics.campaign drop constraint if exists campaign_result_confirmed_consistency_check;
alter table analytics.campaign add constraint campaign_result_confirmed_consistency_check
  check ((result_verdict_confirmed_at is null) = (result_verdict_confirmed_by_role is null)
         and (result_verdict_confirmed_at is null) = (result_open_pieces is null));
alter table analytics.campaign drop constraint if exists campaign_result_open_pieces_check;
alter table analytics.campaign add constraint campaign_result_open_pieces_check
  check (result_open_pieces is null or result_open_pieces between 0 and 10000);
alter table analytics.campaign drop constraint if exists campaign_lesson_check;
alter table analytics.campaign add constraint campaign_lesson_check
  check (lesson is null or length(lesson) <= 500);

comment on column analytics.campaign.metric_code is 'ตัวชี้วัดหลักของแคมเปญ (ชุดเดียวกับ campaign_step.metric_code รวม orders) — ตั้งผ่าน campaign_plan_set';
comment on column analytics.campaign.metric_channel_code is 'เฉพาะ metric orders: dim_channel.code ที่นับ (null = ทุกช่องทาง) — ตรวจกับ dim_channel ใน campaign_plan_set';
comment on column analytics.campaign.metric_affinity is 'เฉพาะ metric orders: all/bar/jewelry ตาม v_content_order_daily.affinity (null = all)';
comment on column analytics.campaign.metric_date_from is 'เฉพาะ metric orders: ช่วงวันขายของแคมเปญ (ตามคู่ metric_date_to) · null = ใช้ช่วงวันของ step · ไม่มี step = anchor_date วันเดียว';
comment on column analytics.campaign.result_verdict_proposed is 'คำตัดสินที่ AI/ผู้ช่วยเสนอ — ยังไม่ใช่คำตัดสิน · ยืนยันโดยเจ้าของผ่าน campaign_verdict_confirm เท่านั้น (result_verdict คือค่าที่ยืนยัน)';
comment on column analytics.campaign.result_open_pieces is 'จำนวนชิ้นงานที่ค้าง (ไม่ใช่ posted/cancelled) ตอนเจ้าของยืนยันคำตัดสิน (มติ Q12 ปิดได้ทุกเมื่อ) — ชิ้นค้างไม่นับในผล';

-- ============================================================================
-- 3. recommendation_log — คอลัมน์ใหม่ (ไม่แตะ v_recommendation_acceptance · ไม่แตะ CHECK source เดิม 3 ค่า)
--    12 แถวเก่า = kind 'proposal' (ถูก: ทั้งหมดเป็นข้อเสนอ R1-R12) · created_by_role / acted_by_role เก่า = null (ไม่รู้ ไม่เดา)
--    คอลัมน์เดิมที่ใช้ต่อ: acted_by = auth.uid() (null จนกว่า A2) · คำตอบของเจ้าของ = owner_response (คอลัมน์ใหม่ SEC-H2) — outcome_note คงไว้เป็นผลที่ทีมจดทีหลัง (ไม่ใช่คำตอบ)
-- ============================================================================

alter table analytics.recommendation_log
  add column if not exists kind            text not null default 'proposal',
  add column if not exists respond_by      date,
  add column if not exists default_action  text,
  add column if not exists related_step_id uuid,
  add column if not exists summary_id      uuid,
  add column if not exists created_by_role text,
  add column if not exists acted_by_role   text,
  add column if not exists owner_response  text,   -- ข้อความตอบของเจ้าของ (SEC-H2) · แยกจาก outcome_note ที่ทีมจดผลทีหลัง
  add column if not exists acted_session_user text; -- R2 Low: session_user ตอน recommendation_respond (ตรวจ spoof ย้อนหลังจนกว่า A2 — acted_by = auth.uid() ยัง null)

alter table analytics.recommendation_log drop constraint if exists recommendation_log_acted_session_user_check;
alter table analytics.recommendation_log add constraint recommendation_log_acted_session_user_check
  check (acted_session_user is null or length(acted_session_user) between 1 and 128);
alter table analytics.recommendation_log drop constraint if exists recommendation_log_owner_response_check;
alter table analytics.recommendation_log add constraint recommendation_log_owner_response_check
  check (owner_response is null or length(owner_response) between 1 and 1000);
alter table analytics.recommendation_log drop constraint if exists recommendation_log_kind_check;
alter table analytics.recommendation_log add constraint recommendation_log_kind_check
  check (kind in ('proposal', 'question'));   -- ไม่มี risk_gate: ด่านความเสี่ยงอ่านจาก step_gate ตรงใน v_recommendation_inbox (C3-2)
alter table analytics.recommendation_log drop constraint if exists recommendation_log_respond_by_check;
alter table analytics.recommendation_log add constraint recommendation_log_respond_by_check
  check (respond_by is null or (respond_by >= date '2020-01-01' and respond_by < date '2100-01-01'));
alter table analytics.recommendation_log drop constraint if exists recommendation_log_default_action_check;
alter table analytics.recommendation_log add constraint recommendation_log_default_action_check
  check (default_action is null or length(btrim(default_action)) between 1 and 500);
-- มีเส้นตายต้องประกาศค่าเริ่มต้น (หมดเวลาแล้วถือว่าทำอะไร) — brief §3.4
alter table analytics.recommendation_log drop constraint if exists recommendation_log_deadline_needs_default_check;
alter table analytics.recommendation_log add constraint recommendation_log_deadline_needs_default_check
  check (respond_by is null or default_action is not null);
alter table analytics.recommendation_log drop constraint if exists recommendation_log_created_role_check;
alter table analytics.recommendation_log add constraint recommendation_log_created_role_check
  check (created_by_role is null or created_by_role in ('owner', 'ai', 'system'));
alter table analytics.recommendation_log drop constraint if exists recommendation_log_acted_role_check;
-- R3-M1: 'system' = ระบบปิดเป็น expired ตอน recommendation_create (ข้อเสนอ pending ชื่อซ้ำที่หมดเวลา) — ไม่ใช่เจ้าของตัดสิน ⇒ เจ้าของยังตอบช้าได้ (recommendation_respond รับ pending หรือ expired+system)
-- 'owner' = เจ้าของตอบผ่าน recommendation_respond (ล็อกแก้ย้อนหลังไม่ได้ทุก role) · null = แถวเก่าที่ปิดตรงก่อน 0162
alter table analytics.recommendation_log add constraint recommendation_log_acted_role_check
  check (acted_by_role is null or acted_by_role in ('owner', 'system'));

-- FK ที่ชี้เข้าประวัติ: SET NULL ทั้งคู่ (ลบ step/summary ไม่พาข้อเสนอที่เจ้าของเคยตอบหาย) · ไม่มี CASCADE ใดนอกจาก public.shop (ถอนสิทธิ์ลบร้านจาก service_role แล้วใน 0161)
alter table analytics.recommendation_log drop constraint if exists recommendation_log_related_step_id_fkey;
alter table analytics.recommendation_log add constraint recommendation_log_related_step_id_fkey
  foreign key (related_step_id) references analytics.campaign_step (id) on delete set null;
alter table analytics.recommendation_log drop constraint if exists recommendation_log_summary_id_fkey;
alter table analytics.recommendation_log add constraint recommendation_log_summary_id_fkey
  foreign key (summary_id) references analytics.content_weekly_summary (id) on delete set null;

create index if not exists idx_recommendation_log_step on analytics.recommendation_log (related_step_id) where related_step_id is not null;
create index if not exists idx_recommendation_log_summary on analytics.recommendation_log (summary_id) where summary_id is not null;
-- ตัดสินใจ G: กันข้อเสนอซ้ำที่ยังรอตอบ ระดับตาราง (เทียบชื่อแบบไม่สนตัวพิมพ์/ช่องว่างหัวท้าย)
create unique index if not exists uq_recommendation_log_pending_title
  on analytics.recommendation_log (shop_id, lower(btrim(title))) where owner_action = 'pending';

comment on column analytics.recommendation_log.kind is
  'proposal = ข้อเสนอให้ทำ · question = คำถามให้เจ้าของตัดสิน (ด่านความเสี่ยง/คำตัดสินแคมเปญอ่านจาก step_gate/campaign ใน v_recommendation_inbox ไม่ใช่แถวนี้)';
comment on column analytics.recommendation_log.owner_response is
  'ข้อความที่เจ้าของตอบ (เขียนครั้งเดียวโดย recommendation_respond พร้อม owner_action/acted_at/acted_by/acted_by_role) · เมื่อ acted_by_role = owner แก้ไม่ได้ทุก role รวม postgres · '
  'ผลที่ทีมจดทีหลังอยู่ outcome_note (แก้ได้)';
comment on column analytics.recommendation_log.respond_by is
  'เส้นตายตอบ (วันไทย) · null = ใช้กติกา 14 วันของ 0101 · หมดเวลา = effective_action expired ใน v_recommendation_inbox (แถวยัง pending — ยกเว้น recommendation_create ปิดแถว pending ชื่อซ้ำที่หมดเวลาเป็น expired · acted_by_role system) · เจ้าของตอบช้าได้ทั้งสองกรณี (is_late นับเฉพาะ acted_by_role = owner)';
comment on column analytics.recommendation_log.default_action is
  'สิ่งที่ถือเป็นค่าเริ่มต้นเมื่อหมดเวลาโดยเจ้าของไม่ตอบ — บังคับเมื่อมี respond_by · ระบบไม่ทำอะไรเองจากค่านี้ แค่แสดงให้เจ้าของเห็น';

-- ============================================================================
-- 4. helper + trigger ด่านตาราง
--    ด่านระดับตารางของ C3 ใช้ current_user อย่างเดียว ไม่มี GUC (D18): ฟังก์ชัน definer ใดๆ ผ่าน · service_role/authenticated/anon เขียนตรงไม่ผ่าน
--    ชั้นแรกคือ GRANT (§10 ถอนสิทธิ์เขียนจาก service_role) — trigger คือชั้นที่สองเมื่อมีคน grant กลับ
-- ============================================================================

-- อักขระควบคุมทิศทาง/ล่องหน/ควบคุม ที่ใช้ปลอมข้อความ (trojan-source · ASCII smuggling ด้วย Unicode Tag) — ปฏิเสธ ไม่แก้เงียบ · ไม่รวม U+200C/200D (ZWNJ/ZWJ ใช้ต่อ emoji) — ตัดสินใจ H/T
--   ชุดเดิม:  200B 200E 200F 061C 202A-202E 2060-2064 2066-2069 FEFF
--   ชุดเพิ่ม (SEC-M3): Unicode Tag U+E0000-E007F · 00AD (soft hyphen) · 180E (Mongolian vowel separator) · 2028/2029 (line/paragraph separator) · FFF9-FFFB (interlinear annotation) ·
--                     3164 + 115F (Hangul filler — แสดงเป็นช่องว่างกว้าง) · control 0001-0008 000B 000C 000E-001F 007F (เว้น tab 09 / LF 0A / CR 0D ที่ข้อความหลายบรรทัดต้องใช้)
--   ชุดเพิ่มรอบ 2 (R2 Low): C1 control U+0080-009F · U+034F (combining grapheme joiner) · U+17B4/17B5 (Khmer inherent vowel) · U+1160 (Hangul Jungseong filler) · U+206A-206F (deprecated format controls) ·
--                          U+FFA0 (halfwidth Hangul filler) · U+1BCA0-1BCA3 (shorthand format controls) · Variation Selector Supplement U+E0100-E01EF
--                          🔴 ห้ามใส่ U+FE00-FE0F (variation selector ของ emoji — ❤️ ใช้ FE0F) · ZWJ/ZWNJ (200C/200D) ยังผ่านเพราะ emoji ต่อกัน
--   เขียนเป็น escape 4 หลักตายตัว (u + เลขฐานสิบหก 4 หลัก) ไม่ใช้รูป x + เลขฐานสิบหก — รูป x ใน regex ของ Postgres กินเลขฐานสิบหกกี่หลักก็ได้ ต่อกับอักขระถัดไปแล้วเพี้ยน · นอก BMP ใช้ U + 8 หลัก
create or replace function analytics.content_bidi_present_(p_text text)
 returns boolean
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $f$
  select coalesce(p_text, '') ~ '[\u200B\u200E\u200F\u061C\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\U000E0000-\U000E007F\u00AD\u180E\u2028\u2029\uFFF9-\uFFFB\u3164\u115F\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F\u034F\u17B4\u17B5\u1160\u206A-\u206F\uFFA0\U0001BCA0-\U0001BCA3\U000E0100-\U000E01EF]'
$f$;

-- trigger: content_weekly_summary — เขียนผ่าน content_weekly_summary_upsert เท่านั้น
create or replace function analytics.content_weekly_summary_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
begin
  if current_user in ('service_role', 'authenticated', 'anon') then
    raise exception 'สรุปสัปดาห์เขียนผ่าน content_weekly_summary_upsert เท่านั้น' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$f$;

drop trigger if exists trg_content_weekly_summary_guard on analytics.content_weekly_summary;
create trigger trg_content_weekly_summary_guard
  before insert or update or delete on analytics.content_weekly_summary
  for each row execute function analytics.content_weekly_summary_guard();

-- trigger: campaign — สมมติฐาน/metric/เกณฑ์/คำตัดสิน เขียนผ่าน campaign_plan_set / campaign_verdict_propose / campaign_verdict_confirm เท่านั้น
-- ปล่อย status / anchor / blocked_reason / note ฯลฯ (บอร์ดเดิม) · INSERT ตรง: ตั้งคอลัมน์เหล่านี้ไม่ได้ (กันปลอม "เจ้าของยืนยันแล้ว" ด้วย INSERT — แบบ 0161 ข้อ C)
-- ตรวจแล้ว 7 ต.ค.: โค้ดแอป (lib/ app/ components/ scripts/ packages/) ไม่มีที่ไหนเขียน hypothesis/result_* ของ campaign — RPC เดิมที่เขียน (0057/0060/0159) เป็น definer
create or replace function analytics.campaign_result_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
begin
  if current_user in ('service_role', 'authenticated', 'anon') then
    -- SEC-Low (ข้อ X): ปิดแคมเปญ (status → done) ผ่าน campaign_verdict_confirm เท่านั้น — เดิม service_role ตั้ง done ตรงได้โดยไม่มีคำตัดสิน/บทเรียน/จำนวนชิ้นค้าง
    if new.status = 'done' and (tg_op = 'INSERT' or new.status is distinct from old.status) then
      raise exception 'ปิดแคมเปญ (status done) ผ่าน campaign_verdict_confirm เท่านั้น' using errcode = '55000';
    end if;
    if tg_op = 'INSERT' then
      if new.result_verdict is distinct from 'not_measured'
         or num_nonnulls(new.result_note, new.hypothesis, new.metric_code, new.baseline_value, new.baseline_spread, new.baseline_as_of,
                         new.baseline_note, new.pass_threshold, new.pass_op, new.metric_channel_code, new.metric_affinity,
                         new.metric_date_from, new.metric_date_to, new.result_verdict_proposed, new.result_proposed_note,
                         new.result_proposed_at, new.result_proposed_by_role, new.result_verdict_confirmed_at,
                         new.result_verdict_confirmed_by_role, new.lesson, new.result_open_pieces, new.plan_set_by_role) > 0 then
        raise exception 'ตั้งสมมติฐาน/เกณฑ์/คำตัดสินแคมเปญผ่าน campaign_plan_set / campaign_verdict_propose / campaign_verdict_confirm เท่านั้น' using errcode = '55000';
      end if;
    elsif (new.result_verdict, new.result_note, new.hypothesis, new.metric_code, new.baseline_value, new.baseline_spread, new.baseline_as_of,
           new.baseline_note, new.pass_threshold, new.pass_op, new.metric_channel_code, new.metric_affinity, new.metric_date_from,
           new.metric_date_to, new.result_verdict_proposed, new.result_proposed_note, new.result_proposed_at, new.result_proposed_by_role,
           new.result_verdict_confirmed_at, new.result_verdict_confirmed_by_role, new.lesson, new.result_open_pieces, new.plan_set_by_role)
          is distinct from
          (old.result_verdict, old.result_note, old.hypothesis, old.metric_code, old.baseline_value, old.baseline_spread, old.baseline_as_of,
           old.baseline_note, old.pass_threshold, old.pass_op, old.metric_channel_code, old.metric_affinity, old.metric_date_from,
           old.metric_date_to, old.result_verdict_proposed, old.result_proposed_note, old.result_proposed_at, old.result_proposed_by_role,
           old.result_verdict_confirmed_at, old.result_verdict_confirmed_by_role, old.lesson, old.result_open_pieces, old.plan_set_by_role) then
      raise exception 'แก้สมมติฐาน/เกณฑ์/คำตัดสินแคมเปญผ่าน campaign_plan_set / campaign_verdict_propose / campaign_verdict_confirm เท่านั้น' using errcode = '55000';
    end if;
    -- R2 Low (B7): แคมเปญที่เจ้าของยืนยันคำตัดสินแล้ว เปลี่ยน status ไม่ได้ — เดิม service_role ดึง done กลับ active ได้ (คำตัดสินยังอยู่แต่ stage/แผงบอร์ดอ่านว่ายังวิ่ง)
    -- ใส่ใน role block: ฟังก์ชัน definer (บอร์ด/RPC เดิม · รันเป็นเจ้าของตาราง) ไม่ติด · เขียนซ้ำค่าเดิม (status done → done) ผ่าน
    if tg_op = 'UPDATE' and old.result_verdict_confirmed_at is not null and new.status is distinct from old.status then
      raise exception 'แคมเปญที่เจ้าของยืนยันคำตัดสินแล้ว (%) เปลี่ยน status ไม่ได้', old.result_verdict using errcode = '55000';
    end if;
  end if;
  return new;
end;
$f$;

drop trigger if exists trg_campaign_result_guard on analytics.campaign;
create trigger trg_campaign_result_guard
  before insert or update on analytics.campaign
  for each row execute function analytics.campaign_result_guard();

-- trigger: recommendation_log — INSERT/DELETE ตรงจาก 3 role = ห้าม (0101: แถว rejected/expired ห้ามหายก่อนวัน 90) · UPDATE ที่เปลี่ยนอะไรก็ตาม (นอกจาก updated_at) = ห้าม
-- ตอบผ่าน recommendation_respond · สร้างผ่าน recommendation_create · postgres (MCP ของ Tech Lead) + ฟังก์ชัน definer + RI (SET NULL ตอนลบ step/summary/campaign) ผ่านทุกข้อ — D18
create or replace function analytics.recommendation_log_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
begin
  if current_user in ('service_role', 'authenticated', 'anon') then
    if tg_op = 'INSERT' then
      raise exception 'สร้างข้อเสนอผ่าน recommendation_create เท่านั้น' using errcode = '55000';
    elsif tg_op = 'DELETE' then
      raise exception 'ลบข้อเสนอไม่ได้ (ประวัติการตัดสินของเจ้าของ — 0101: เก็บอย่างน้อย 90 วัน)' using errcode = '55000';
    elsif (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      raise exception 'ตอบข้อเสนอผ่าน recommendation_respond เท่านั้น (แก้เนื้อหาข้อเสนอทำผ่านเจ้าของตาราง)' using errcode = '55000';
    end if;
  end if;
  -- ทุก role (รวม postgres): ข้อเสนอที่เจ้าของตอบแล้ว แก้เนื้อหาไม่ได้ — เขียนประวัติ "เจ้าของตอบอะไร" ใหม่ย้อนหลังไม่ได้ (สเปก Y20) · RI SET NULL แตะแค่คอลัมน์ related_*/summary_id จึงไม่ติด
  if tg_op = 'UPDATE' and old.owner_action <> 'pending'
     and (new.title, new.detail, new.source, new.kind, new.shop_id) is distinct from (old.title, old.detail, old.source, old.kind, old.shop_id) then
    raise exception 'ข้อเสนอที่ตอบแล้วแก้เนื้อหาไม่ได้ (ประวัติการตัดสินของเจ้าของ)' using errcode = '55000';
  end if;
  -- SEC-H2: "คำตอบของเจ้าของ" เองก็ต้องแก้ย้อนหลังไม่ได้ — ล็อกเมื่อ recommendation_respond เป็นคนเขียน (acted_by_role = owner) · ทุก role รวม postgres
  -- แถวเก่าที่ปิดตรงก่อน 0162 (acted_by_role ว่าง) ไม่ติด — ยังปิด/แก้ได้แบบ N16b · outcome_note (ผลที่ทีมจดทีหลัง) ไม่อยู่ในรายการล็อก
  if tg_op = 'UPDATE' and old.acted_by_role = 'owner'
     and (new.owner_action, new.owner_response, new.acted_at, new.acted_by, new.acted_by_role, new.acted_session_user)
         is distinct from (old.owner_action, old.owner_response, old.acted_at, old.acted_by, old.acted_by_role, old.acted_session_user) then
    raise exception 'คำตอบของเจ้าของแก้ย้อนหลังไม่ได้ (owner_action / owner_response / acted_at / acted_by / acted_by_role / acted_session_user) — จดผลทีหลังที่ outcome_note' using errcode = '55000';
  end if;
  -- R2-1 (QA): ลบแถวที่เจ้าของตอบแล้วไม่ได้ทุก role รวม postgres — เดิมล็อกแค่ UPDATE ⇒ DELETE ตรงลบประวัติ "เจ้าของตอบอะไร" ทิ้งได้ทั้งแถว
  -- ไม่ชน FK: ที่ชี้เข้า reco ทุกเส้นเป็น SET NULL (UPDATE ไม่ใช่ DELETE) · เส้นเดียวที่ลบแถวคือ CASCADE จาก public.shop — ลบร้านที่มีประวัติเจ้าของตอบแล้วจึงถูกบล็อกโดยตั้งใจ
  -- (ลบร้านถูกถอดจาก service_role แล้วใน 0161 · ต้องปิด trigger นี้อย่างรู้ตัวก่อน) · แถวเก่าที่ acted_by_role ว่าง (ปิดตรงก่อน 0162) ยังลบได้แบบ N16b
  if tg_op = 'DELETE' and old.acted_by_role = 'owner' then
    raise exception 'ลบข้อเสนอที่เจ้าของตอบแล้วไม่ได้ (ประวัติการตัดสินของเจ้าของ)' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$f$;

drop trigger if exists trg_recommendation_log_guard on analytics.recommendation_log;
create trigger trg_recommendation_log_guard
  before insert or update or delete on analytics.recommendation_log
  for each row execute function analytics.recommendation_log_guard();

-- R3 (code review ข้อ 7): TRUNCATE ไม่ผ่าน row trigger และ GRANT ไม่ครอบเจ้าของตาราง (postgres/MCP) ⇒ statement-level trigger ปฏิเสธทุก role (แบบ 0161 content_post_metric_amend_log_deny_truncate)
-- ครอบ TRUNCATE ... CASCADE จากตารางแม่ด้วย (BEFORE TRUNCATE ยิงกับทุกตารางที่ถูกล้าง) · ใช้กับ recommendation_log (ประวัติการตัดสินของเจ้าของ) และ content_weekly_summary (สรุปสัปดาห์)
create or replace function analytics.content_history_truncate_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
begin
  raise exception 'ล้างตาราง % ทั้งตารางไม่ได้ — เป็นประวัติของเจ้าของ (ลบทีละแถวผ่านเจ้าของตารางเท่านั้น)', tg_table_name using errcode = '55000';
end;
$f$;

drop trigger if exists trg_recommendation_log_deny_truncate on analytics.recommendation_log;
create trigger trg_recommendation_log_deny_truncate
  before truncate on analytics.recommendation_log
  for each statement execute function analytics.content_history_truncate_guard();
drop trigger if exists trg_content_weekly_summary_deny_truncate on analytics.content_weekly_summary;
create trigger trg_content_weekly_summary_deny_truncate
  before truncate on analytics.content_weekly_summary
  for each statement execute function analytics.content_history_truncate_guard();

-- ============================================================================
-- 5. helper ภายใน (ไม่ใช่ API ของหน้าจอ) — ด่านคำตัดสิน + นับชิ้นค้าง
--    ฟังก์ชันใหม่ทั้งหมด (ไม่ replace ของ 0148/0158/0159/0160/0161) — ด่านท้ายไฟล์เทียบ md5 ของฟังก์ชันเดิมทุกตัว
-- ============================================================================

-- ชิ้นที่ค้าง = มี piece_status และยังไม่ posted/cancelled · แคมเปญเก่า (piece_status null) ไม่นับ · `not in` บนค่าที่ไม่ null จึงปลอดภัย
create or replace function analytics.campaign_open_pieces_(p_campaign_id uuid)
 returns jsonb
 language sql
 stable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
  select jsonb_build_object('open', coalesce(sum(x.n), 0)::int, 'by_status', coalesce(jsonb_object_agg(x.piece_status, x.n), '{}'::jsonb))
    from (select s.piece_status, count(*)::int as n
            from analytics.campaign_step s
           where s.campaign_id = p_campaign_id and s.piece_status is not null and s.piece_status not in ('posted', 'cancelled')
           group by s.piece_status) x
$f$;

-- ด่านเนื้อหาของคำตัดสิน (ตัดสินใจ B · orders: R-H1 รอบ 2 = ข้อมูลร้านต้องถึงวันหลังวันสุดท้าย + ช่องทางที่นับต้องมีข้อมูลถึงวันสุดท้าย) — null = ผ่าน · ข้อความ = เหตุผลที่ตก (ผู้เรียก raise 55000) · ใช้ร่วมกันทั้ง propose และ confirm (owner ก็ฟันธงจากข้อมูลน้อยไม่ได้)
--   ด่านใช้เฉพาะ validated/invalidated — inconclusive/not_measured เสนอ/ยืนยันได้เสมอ (ยอมรับว่ายังตัดสินไม่ได้)
--   save_rate/share_rate: ≥ 4 ชิ้น (distinct step) ที่มี T+7 · นับเฉพาะชิ้น posted หรือแคมเปญเก่าที่ไม่มี piece_status (Q12: ชิ้นค้าง/ยกเลิกไม่นับในผล)
--   orders: ต้องตั้ง pass_threshold + pass_op · รู้ช่วงวัน (v_campaign_summary.orders_window_*) · 🔴 ข้อมูลออเดอร์ของร้านต้องถึงวันสุดท้ายของช่วง (orders_data_covers_window — SEC-H1:
--           ยอดวันท้ายที่ยังไม่เข้าไฟล์ import อ่านเป็น 0 แล้วถูกตีเป็น "แคมเปญล้มเหลว") · ร้านไม่มีออเดอร์เลย = ไม่ครอบ · metric อื่น/null (peak_viewers · line_reply_count · none · แคมเปญเก่า) = วัดนอกตารางนี้ ไม่เดา ไม่ติดด่าน
--   ทุก metric: แคมเปญที่ทุกชิ้นใน workflow ถูกยกเลิก (มีชิ้น และไม่เหลือชิ้นที่ไม่ cancelled) ฟัน validated/invalidated ไม่ได้ (SEC-Low · ข้อ X) — inconclusive/not_measured ยังปิดได้ (Q12)
create or replace function analytics.campaign_verdict_gate_(p_campaign_id uuid, p_verdict text)
 returns text
 language plpgsql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  c_min_pieces constant int := 4;
  v_c   analytics.campaign%rowtype;
  v_n   int;
  v_live int;
  v_win record;
begin
  if p_campaign_id is null or p_verdict is null or p_verdict not in ('validated', 'invalidated') then
    return null;
  end if;
  select * into v_c from analytics.campaign where id = p_campaign_id;
  if not found then
    return null;   -- ผู้เรียกล็อก/ตรวจแถวเองก่อนแล้ว
  end if;

  select count(*) filter (where s.piece_status is not null)::int,
         count(*) filter (where s.piece_status is not null and s.piece_status <> 'cancelled')::int
    into v_n, v_live
    from analytics.campaign_step s where s.campaign_id = p_campaign_id;
  if v_n > 0 and v_live = 0 then
    return format('แคมเปญนี้ถูกยกเลิกทุกชิ้น (%s ชิ้น) — ฟันธง "ได้ผล" หรือ "ไม่ได้ผล" ไม่ได้ เลือกได้แค่ "ยังสรุปไม่ได้" หรือ "ไม่ได้วัด"', v_n);
  end if;

  if v_c.metric_code in ('save_rate', 'share_rate') then
    select count(distinct r.step_id) into v_n
      from analytics.v_content_post_result r
      join analytics.campaign_step s on s.id = r.step_id
     where s.campaign_id = p_campaign_id and r.t7_captured_on is not null
       and (s.piece_status is null or s.piece_status = 'posted');
    if v_n < c_min_pieces then
      return format('ยังมีผล T+7 ไม่ครบ %s ชิ้น (มี %s ชิ้น) — ฟันธง "ได้ผล" หรือ "ไม่ได้ผล" ยังไม่ได้ เลือกได้แค่ "ยังสรุปไม่ได้" หรือ "ไม่ได้วัด"', c_min_pieces, v_n);
    end if;
  elsif v_c.metric_code = 'orders' then
    if v_c.pass_threshold is null or v_c.pass_op is null then
      return 'ยังไม่ได้ตั้งเกณฑ์ผ่านของยอดออเดอร์ — ตั้งเกณฑ์ (ตัวเลข และ "ไม่น้อยกว่า" หรือ "ไม่เกิน") ในแผนของแคมเปญก่อน จึงจะฟันธง "ได้ผล" หรือ "ไม่ได้ผล" ได้';
    end if;
    select s.orders_window_from, s.orders_window_to, s.orders_data_through, s.orders_data_covers_window, s.orders_channel, s.orders_channel_data_through,
           s.orders_major_channels_covered
      into v_win from analytics.v_campaign_summary s where s.campaign_id = p_campaign_id;
    if v_win.orders_window_from is null or v_win.orders_window_to is null then
      return 'ยังไม่รู้ช่วงวันที่ขายของแคมเปญนี้ (ยังไม่ได้ตั้งช่วงวัน ไม่มีชิ้นงาน และไม่มีวันเริ่ม) — ตั้งช่วงวันในแผนของแคมเปญก่อน';
    end if;
    -- SEC-H1: null (ร้านไม่มีออเดอร์เลย) ก็ไม่ครอบ — coalesce เป็น false ชัดๆ ไม่พึ่งว่า "not null = false" ผ่านด่านเงียบ (trap #13)
    -- R3-H1: ระบุช่องทาง = ช่องนั้นต้องมีข้อมูลหลังวันท้าย · ไม่ระบุ = ทุกช่องหลักต้องมี (นิยามอยู่ที่ v_campaign_summary) · ข้อความเป็นภาษาเจ้าของ ไม่มีรหัสภายใน (code review ข้อ 8)
    -- R-H1 (รอบ 2): ต้องมีข้อมูลร้านของ "วันหลังวันสุดท้าย" (วันท้ายอาจเข้าไฟล์แค่บางส่วน) + ถ้าระบุช่องทาง ช่องนั้นต้องมีข้อมูลถึงวันสุดท้าย
    if coalesce(v_win.orders_data_covers_window, false) is not true then
      return format('ข้อมูลออเดอร์ยังไม่ครบช่วง (ช่วงสิ้นสุด %s · ข้อมูลร้านล่าสุด %s%s) — ฟันธง "ได้ผล" หรือ "ไม่ได้ผล" ยังไม่ได้ เพราะ%s · นำเข้าไฟล์ออเดอร์เพิ่มก่อน หรือเลือกได้แค่ "ยังสรุปไม่ได้" หรือ "ไม่ได้วัด"',
                    v_win.orders_window_to, coalesce(v_win.orders_data_through::text, 'ไม่มีข้อมูลเลย'),
                    case when v_win.orders_channel is not null
                         then format(' · ช่อง %s ล่าสุด %s', v_win.orders_channel, coalesce(v_win.orders_channel_data_through::text, 'ไม่มีเลย'))
                         else '' end,
                    case when v_win.orders_channel is not null
                         then format('ช่อง %s ต้องมีออเดอร์ของวันหลังวันสุดท้ายของช่วงแล้ว (ไฟล์ของวันท้ายอาจเข้าไม่ครบ ยอดจึงอ่านได้ต่ำกว่าจริง)', v_win.orders_channel)
                         when v_win.orders_major_channels_covered is false
                         then 'ช่องทางหลักบางช่องยังไม่มีออเดอร์ของวันหลังวันสุดท้ายของช่วง (ไฟล์ของช่องนั้นอาจยังเข้าไม่ครบ ยอดจึงอ่านได้ต่ำกว่าจริง)'
                         else 'ร้านต้องมีออเดอร์ของวันหลังวันสุดท้ายของช่วงแล้ว (ไฟล์ของวันท้ายอาจเข้าไม่ครบ ยอดจึงอ่านได้ต่ำกว่าจริง)' end);
    end if;
  end if;
  return null;
end;
$f$;

-- token ของ "เนื้อหาที่เจ้าของเห็น" (SEC-M1 · ข้อ Q) — md5 ของ jsonb array · คำนวณฝั่ง DB เท่านั้น แสดงใน view แล้วหน้าจอส่งกลับมาเทียบ
--   campaign: ข้อเสนอ (verdict/note/เวลา/ใคร) + คำตัดสินที่ยืนยันแล้ว + แผน (สมมติฐาน/metric/ฐาน/เกณฑ์/ขอบเขต + ใครตั้งแผน) — ไม่รวม status/updated_at (ขยับตามงานบอร์ดที่ไม่เกี่ยวกับสิ่งที่เจ้าของตัดสิน)
--   R-M1 (รอบ 2): + anchor_date + สรุป step (min offset_start · max coalesce(offset_end, offset_start) · จำนวน step) — ทั้งสามตัวกำหนด "ช่วงนับออเดอร์" (orders_window_*) ของวิว ·
--   ขยับ anchor/เพิ่ม-ลบ-ย้าย step หลังเจ้าของเปิดหน้า ⇒ ช่วงที่เจ้าของเห็นไม่ใช่ช่วงที่ยืนยันจริง ⇒ token เก่าแพ้ (55000)
--   เวลาแปลงเป็น epoch (numeric ไมโครวินาที) ไม่ใช้ ::text ของ timestamptz — ขึ้นกับ TimeZone ของ session ทำให้ view กับ RPC คำนวณต่างกันได้
--   ไม่พบแถว = null (ผู้เรียกล็อกแถวก่อนแล้ว · view ใช้กับแถวที่มีอยู่)
create or replace function analytics.campaign_verdict_token_(p_campaign_id uuid)
 returns text
 language sql
 stable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
  select md5(jsonb_build_array(
           c.result_verdict_proposed, c.result_proposed_note, extract(epoch from c.result_proposed_at), c.result_proposed_by_role,
           c.result_verdict, c.result_note, extract(epoch from c.result_verdict_confirmed_at),
           c.hypothesis, c.metric_code, c.baseline_value, c.baseline_spread, c.baseline_as_of, c.baseline_note, c.pass_threshold, c.pass_op,
           c.metric_channel_code, c.metric_affinity, c.metric_date_from, c.metric_date_to,
           c.plan_set_by_role, c.anchor_date,
           (select jsonb_build_array(min(s.offset_start_days), max(coalesce(s.offset_end_days, s.offset_start_days)), count(*))
              from analytics.campaign_step s where s.campaign_id = c.id))::text)
    from analytics.campaign c where c.id = p_campaign_id
$f$;

-- token ของข้อเสนอ: เนื้อหาที่เจ้าของอ่านก่อนตอบ + สถานะตอบ — ไม่รวม outcome_note/updated_at (ทีมจดผลทีหลังได้โดยไม่ทำให้คำตอบที่กำลังกรอกชน)
create or replace function analytics.recommendation_token_(p_id uuid)
 returns text
 language sql
 stable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
  select md5(jsonb_build_array(
           r.title, r.detail, r.kind, r.source, r.respond_by, r.default_action, r.effort_minutes_est,
           r.related_campaign_id, r.related_step_id, r.summary_id, r.owner_action, extract(epoch from r.acted_at))::text)
    from analytics.recommendation_log r where r.id = p_id
$f$;

-- ============================================================================
-- 6. campaign RPC — สมมติฐาน/เกณฑ์ (หน้า E) · เสนอคำตัดสิน (AI ได้) · ยืนยันคำตัดสิน (เจ้าของเท่านั้น)
-- ============================================================================

-- campaign_plan_set — สมมติฐาน + metric + ฐาน + เกณฑ์ + ขอบเขตนับออเดอร์ · json null = ล้าง (trap #13 ใช้ jsonb_typeof) · ค่าที่ไม่ส่ง key = คงเดิม
-- owner: ทุกสถานะที่ยังไม่ปิด · ai/system: เฉพาะแคมเปญที่ "ยังไม่เริ่ม" — ไม่มีชิ้น posted · ไม่มีโพสต์ active · วันนี้(ไทย) < coalesce(metric_date_from, anchor_date) · ยังไม่มีข้อเสนอคำตัดสิน
--   (AI เสนอสมมติฐานก่อนเริ่ม — ไม่ย้ายเสาเกณฑ์หลังเห็นยอด · SEC-M2 ข้อ S) · ตรวจทั้งค่าเดิมและค่า metric_date_from ใหม่ที่จะตั้ง (กันดึงเริ่มช่วงถอยหลังไปคลุมยอดที่เห็นแล้ว)
-- ปิดแล้ว (เจ้าของยืนยันคำตัดสิน) = แก้ไม่ได้ทุก actor · ไม่มีประวัติ diff ระดับแคมเปญ (หนี้ D20 — updated_at พอรอบแรก)
create or replace function analytics.campaign_plan_set(
  p_shop_id     uuid,
  p_campaign_id uuid,
  p_set         jsonb,
  p_actor_role  text
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  c_keys    constant text[]  := array['hypothesis', 'metric_code', 'baseline_value', 'baseline_as_of', 'baseline_note', 'pass_threshold', 'pass_op',
                                      'baseline_spread', 'metric_channel_code', 'metric_affinity', 'metric_date_from', 'metric_date_to'];
  c_max_val constant numeric := 1000000000000;
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
  v_c       analytics.campaign%rowtype;
  v_step_start date;
  v_start   date;
  v_start_new date;
  v_k       text;
  v_v       jsonb;
  v_t       text;
  v_txt     text;
  v_bad     text;
  v_d       date;
  v_num     numeric;
  v_lo      numeric;
  v_maxlen  int;
  v_hyp     text;
  v_mcode   text;
  v_bval    numeric;
  v_bas     date;
  v_bnote   text;
  v_thr     numeric;
  v_op      text;
  v_spread  numeric;
  v_chan    text;
  v_aff     text;
  v_df      date;
  v_dt      date;
  v_changed jsonb := '{}'::jsonb;
begin
  if p_shop_id is null or p_campaign_id is null or p_set is null then
    raise exception 'campaign_plan_set: ต้องระบุร้าน แคมเปญ และค่าที่แก้' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner', 'ai', 'system'], 'campaign_plan_set');

  if jsonb_typeof(p_set) is distinct from 'object' or p_set = '{}'::jsonb then
    raise exception 'campaign_plan_set: ต้องส่ง object ที่มี key อย่างน้อย 1 (รับ: %)', array_to_string(c_keys, ', ') using errcode = '22023';
  end if;
  select string_agg(k.key, ', ' order by k.key) into v_bad from jsonb_object_keys(p_set) as k(key) where not (k.key = any (c_keys));
  if v_bad is not null then
    raise exception 'campaign_plan_set: key ไม่รู้จัก: % (รับเฉพาะ %)', v_bad, array_to_string(c_keys, ', ') using errcode = '22023';
  end if;

  select * into v_c from analytics.campaign where id = p_campaign_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'campaign_plan_set: ไม่พบแคมเปญในร้านนี้' using errcode = '22023';
  end if;
  if v_c.result_verdict_confirmed_at is not null then
    raise exception 'campaign_plan_set: แคมเปญนี้ปิดแล้ว (เจ้าของยืนยันคำตัดสิน %) — แก้แผนไม่ได้', v_c.result_verdict using errcode = '55000';
  end if;
  if p_actor_role <> 'owner' and (
       exists (select 1 from analytics.campaign_step s where s.campaign_id = p_campaign_id and s.piece_status = 'posted')
       or exists (select 1 from analytics.content_post p join analytics.campaign_step s on s.id = p.step_id
                   where s.campaign_id = p_campaign_id and p.status = 'active')) then
    raise exception 'campaign_plan_set: แคมเปญนี้มีชิ้นที่โพสต์แล้ว — AI/ระบบย้ายเสาสมมติฐาน/เกณฑ์หลังผลออกไม่ได้ (เจ้าของเท่านั้น)' using errcode = '42501';
  end if;
  -- วันเริ่มของแคมเปญ (R-M2a) = ที่เร็วที่สุดของ metric_date_from · anchor_date · วันของ step แรก (anchor + offset_start_days · มี offset ติดลบจริงในแม่แบบ ⇒ step เริ่มก่อน anchor ได้)
  -- วิวนับออเดอร์ตั้งแต่ coalesce(metric_date_from, วัน step แรก, anchor) — ถ้าด่านดูแค่ anchor แล้ว step ก่อน anchor เริ่มไปแล้ว AI ยังแก้เกณฑ์ได้ทั้งที่ยอดช่วงนั้นถูกเห็นแล้ว · least() ข้าม null เอง
  select min(v_c.anchor_date + s.offset_start_days) into v_step_start from analytics.campaign_step s where s.campaign_id = p_campaign_id;
  v_start := least(v_c.metric_date_from, v_c.anchor_date, v_step_start);
  -- SEC-M2: เริ่มแล้ว (วันไทย >= วันเริ่มจริง) หรือมีข้อเสนอคำตัดสินแล้ว = ยอดอาจถูกเห็นแล้ว · coalesce(.., false): ไม่รู้วันเริ่ม = ยังไม่เริ่ม (ผ่าน)
  if p_actor_role <> 'owner' then
    if coalesce(v_today >= v_start, false) then
      raise exception 'campaign_plan_set: แคมเปญเริ่มแล้ว (วันนี้ % ≥ วันเริ่ม %) — AI/ระบบแก้แผน/เกณฑ์หลังเริ่มไม่ได้ (เจ้าของเท่านั้น)', v_today, v_start using errcode = '42501';
    end if;
    -- R-M2b: แผนที่เจ้าของตั้ง AI/ระบบทับไม่ได้ (ก่อนเริ่มก็ไม่ได้) · null/ai/system = ทับได้ (แถวเก่าก่อน 0162 ไม่รู้ที่มา — ไม่เดาว่าเป็นของเจ้าของ · 7 แถวที่มีสมมติฐานอยู่ล้วนเริ่มไปแล้ว ด่านด้านบนกันอยู่)
    if v_c.plan_set_by_role = 'owner' then
      raise exception 'campaign_plan_set: แผนปัจจุบันเจ้าของเป็นคนตั้ง — AI/ระบบทับไม่ได้ (เจ้าของเท่านั้น)' using errcode = '42501';
    end if;
    if v_c.result_verdict_proposed is not null then
      raise exception 'campaign_plan_set: มีข้อเสนอคำตัดสินแล้ว (%) — AI/ระบบย้ายเกณฑ์หลังเห็นยอดไม่ได้ (เจ้าของเท่านั้น)', v_c.result_verdict_proposed using errcode = '42501';
    end if;
  end if;

  v_hyp := v_c.hypothesis; v_mcode := v_c.metric_code; v_bval := v_c.baseline_value; v_bas := v_c.baseline_as_of; v_bnote := v_c.baseline_note;
  v_thr := v_c.pass_threshold; v_op := v_c.pass_op; v_spread := v_c.baseline_spread; v_chan := v_c.metric_channel_code;
  v_aff := v_c.metric_affinity; v_df := v_c.metric_date_from; v_dt := v_c.metric_date_to;

  -- 🔴 ห้าม `p_set->>'x' is null` แยก SQL NULL กับ JSON null ไม่ได้ (trap #13) ⇒ jsonb_typeof · 'null' = ตั้งใจล้าง
  for v_k, v_v in select e.key, e.value from jsonb_each(p_set) as e loop
    v_t := jsonb_typeof(v_v);
    v_txt := v_v #>> '{}';
    if v_k in ('hypothesis', 'baseline_note') then
      if v_t = 'null' then
        v_txt := null;
      elsif v_t = 'string' then
        v_txt := analytics.content_text_clean(v_txt);
        -- ห้ามเขียน CASE ใน IF โดยตรง: plpgsql ตัดนิพจน์ที่ THEN ตัวแรก ⇒ THEN ของ CASE ทำให้ syntax error (42601)
        v_maxlen := 500;
        if v_k = 'hypothesis' then
          v_maxlen := 1000;
        end if;
        if v_txt = '' or length(v_txt) > v_maxlen then
          raise exception 'campaign_plan_set: % ต้องยาว 1-% ตัวอักษร', v_k, v_maxlen using errcode = '22023';
        end if;
        if analytics.content_marker_present(v_txt) then
          raise exception 'campaign_plan_set: % มี [ต้องยืนยัน — ตอบให้ครบก่อนบันทึกเป็นแผน', v_k using errcode = '22023';
        end if;
        if analytics.content_bidi_present_(v_txt) then
          raise exception 'campaign_plan_set: % มีอักขระล่องหน/ควบคุมที่ content_text_clean ไม่ลบ (Unicode Tag · soft hyphen · control ฯลฯ) — ลบออกก่อน', v_k using errcode = '22023';
        end if;
      else
        raise exception 'campaign_plan_set: % ต้องเป็นข้อความ (หรือ null เพื่อล้าง)', v_k using errcode = '22023';
      end if;
      if v_k = 'hypothesis' then v_hyp := v_txt; else v_bnote := v_txt; end if;

    elsif v_k in ('baseline_value', 'pass_threshold', 'baseline_spread') then
      if v_t = 'null' then
        v_num := null;
      elsif v_t = 'number' then
        v_num := v_txt::numeric;
        v_lo := -c_max_val;
        if v_k = 'baseline_spread' then
          v_lo := 0;
        end if;
        -- not(between): NaN/Infinity ตกให้เอง (trap #4) — jsonb number ไม่มี NaN อยู่แล้ว แต่คงด่านไว้
        if not (v_num >= v_lo and v_num <= c_max_val) then
          raise exception 'campaign_plan_set: % ต้องอยู่ในช่วง % ถึง % (ได้รับ %)', v_k, v_lo, c_max_val, v_txt using errcode = '22023';
        end if;
      else
        raise exception 'campaign_plan_set: % ต้องส่งเป็น number (หรือ null เพื่อล้าง) ไม่ใช่ข้อความ/ค่าจริงเท็จ', v_k using errcode = '22023';
      end if;
      if v_k = 'baseline_value' then v_bval := v_num; elsif v_k = 'pass_threshold' then v_thr := v_num; else v_spread := v_num; end if;

    elsif v_k in ('baseline_as_of', 'metric_date_from', 'metric_date_to') then
      if v_t = 'null' then
        v_d := null;
      else
        if v_t <> 'string' or v_txt !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          raise exception 'campaign_plan_set: % ต้องเป็นวันที่รูปแบบ YYYY-MM-DD (หรือ null เพื่อล้าง)', v_k using errcode = '22023';
        end if;
        begin
          v_d := v_txt::date;
        exception when others then
          v_d := null;
        end;
        if v_d is null then
          raise exception 'campaign_plan_set: % ไม่ใช่วันที่ที่มีจริง (%)', v_k, v_txt using errcode = '22023';
        end if;
        if v_k = 'baseline_as_of' and (v_d > v_today or v_d < date '2020-01-01') then
          raise exception 'campaign_plan_set: baseline_as_of ต้องไม่เป็นวันในอนาคต (ไทย) และไม่ก่อน 2020-01-01 (ได้รับ %)', v_txt using errcode = '22023';
        end if;
        if v_k <> 'baseline_as_of' and (v_d < date '2020-01-01' or v_d > v_today + 366) then
          raise exception 'campaign_plan_set: % ต้องอยู่ระหว่าง 2020-01-01 ถึงวันไทย+366 (ได้รับ %)', v_k, v_txt using errcode = '22023';
        end if;
      end if;
      if v_k = 'baseline_as_of' then v_bas := v_d; elsif v_k = 'metric_date_from' then v_df := v_d; else v_dt := v_d; end if;

    elsif v_k = 'metric_code' then
      if v_t = 'null' then
        v_mcode := null;
      elsif v_t = 'string' and v_txt in ('save_rate', 'share_rate', 'peak_viewers', 'line_reply_count', 'orders', 'none') then
        v_mcode := v_txt;
      else
        raise exception 'campaign_plan_set: metric_code ต้องเป็น save_rate / share_rate / peak_viewers / line_reply_count / orders / none (หรือ null เพื่อล้าง)' using errcode = '22023';
      end if;

    elsif v_k = 'pass_op' then
      if v_t = 'null' then
        v_op := null;
      elsif v_t = 'string' and v_txt in ('>=', '<=') then
        v_op := v_txt;
      else
        raise exception 'campaign_plan_set: pass_op ต้องเป็น >= หรือ <= (หรือ null เพื่อล้าง)' using errcode = '22023';
      end if;

    elsif v_k = 'metric_affinity' then
      if v_t = 'null' then
        v_aff := null;
      elsif v_t = 'string' and v_txt in ('all', 'bar', 'jewelry') then
        v_aff := v_txt;
      else
        raise exception 'campaign_plan_set: metric_affinity ต้องเป็น all / bar / jewelry (หรือ null เพื่อล้าง)' using errcode = '22023';
      end if;

    elsif v_k = 'metric_channel_code' then
      if v_t = 'null' then
        v_chan := null;
      elsif v_t = 'string' and exists (select 1 from analytics.dim_channel dc where dc.code = v_txt) then
        v_chan := v_txt;
      else
        select string_agg(dc.code, ' / ' order by dc.code) into v_bad from analytics.dim_channel dc;
        raise exception 'campaign_plan_set: metric_channel_code ต้องเป็นรหัสช่องทางที่มีจริง (% — หรือ null = ทุกช่องทาง)', coalesce(v_bad, '-') using errcode = '22023';
      end if;
    end if;
  end loop;

  -- ด่านสถานะสุดท้าย (หลังรวมค่าเดิมกับค่าใหม่) — ตกที่นี่เป็น 22023 พร้อมข้อความ ไม่ปล่อยให้ไปตก CHECK (23514)
  if (v_thr is null) <> (v_op is null) then
    raise exception 'campaign_plan_set: เกณฑ์ต้องมาเป็นคู่ — pass_threshold กับ pass_op ต้องมีทั้งคู่หรือล้างทั้งคู่' using errcode = '22023';
  end if;
  if v_mcode is distinct from 'orders' and num_nonnulls(v_chan, v_aff, v_df, v_dt) > 0 then
    raise exception 'campaign_plan_set: ช่องทาง/กลุ่มสินค้า/ช่วงวันที่นับ ใช้ได้เฉพาะ metric_code = orders (ถ้าเปลี่ยน metric ให้ล้างค่าเหล่านั้นในคำสั่งเดียวกัน)' using errcode = '22023';
  end if;
  if (v_df is null) <> (v_dt is null) then
    raise exception 'campaign_plan_set: metric_date_from กับ metric_date_to ต้องมาเป็นคู่' using errcode = '22023';
  end if;
  if v_df is not null and (v_dt < v_df or v_dt - v_df > 366) then
    raise exception 'campaign_plan_set: ช่วงวัน metric ต้อง to >= from และไม่เกิน 366 วัน (ได้รับ % ถึง %)', v_df, v_dt using errcode = '22023';
  end if;
  -- SEC-M2 (ค่าใหม่): AI/ระบบดึงวันเริ่มช่วงนับให้ถอยมาที่วันนี้หรือก่อนหน้า = เลือกช่วงหลังเห็นยอด
  -- R-M2a: ค่าใหม่ใช้วันเริ่มเดียวกับด่านด้านบน (least ของ metric_date_from ใหม่ · anchor · วัน step แรก) ไม่ใช่ coalesce(v_df, anchor)
  v_start_new := least(v_df, v_c.anchor_date, v_step_start);
  if p_actor_role <> 'owner' and coalesce(v_today >= v_start_new, false) then
    raise exception 'campaign_plan_set: AI/ระบบตั้งช่วงนับที่เริ่มวันนี้หรือก่อนหน้า (เริ่ม %) ไม่ได้ — ต้องเป็นวันในอนาคต (เจ้าของเท่านั้น)', v_start_new using errcode = '42501';
  end if;

  if v_hyp is distinct from v_c.hypothesis then
    v_changed := v_changed || jsonb_build_object('hypothesis', jsonb_build_object('from', v_c.hypothesis, 'to', v_hyp));
  end if;
  if v_mcode is distinct from v_c.metric_code then
    v_changed := v_changed || jsonb_build_object('metric_code', jsonb_build_object('from', v_c.metric_code, 'to', v_mcode));
  end if;
  if v_bval is distinct from v_c.baseline_value then
    v_changed := v_changed || jsonb_build_object('baseline_value', jsonb_build_object('from', v_c.baseline_value, 'to', v_bval));
  end if;
  if v_bas is distinct from v_c.baseline_as_of then
    v_changed := v_changed || jsonb_build_object('baseline_as_of', jsonb_build_object('from', v_c.baseline_as_of, 'to', v_bas));
  end if;
  if v_bnote is distinct from v_c.baseline_note then
    v_changed := v_changed || jsonb_build_object('baseline_note', jsonb_build_object('from', v_c.baseline_note, 'to', v_bnote));
  end if;
  if v_thr is distinct from v_c.pass_threshold then
    v_changed := v_changed || jsonb_build_object('pass_threshold', jsonb_build_object('from', v_c.pass_threshold, 'to', v_thr));
  end if;
  if v_op is distinct from v_c.pass_op then
    v_changed := v_changed || jsonb_build_object('pass_op', jsonb_build_object('from', v_c.pass_op, 'to', v_op));
  end if;
  if v_spread is distinct from v_c.baseline_spread then
    v_changed := v_changed || jsonb_build_object('baseline_spread', jsonb_build_object('from', v_c.baseline_spread, 'to', v_spread));
  end if;
  if v_chan is distinct from v_c.metric_channel_code then
    v_changed := v_changed || jsonb_build_object('metric_channel_code', jsonb_build_object('from', v_c.metric_channel_code, 'to', v_chan));
  end if;
  if v_aff is distinct from v_c.metric_affinity then
    v_changed := v_changed || jsonb_build_object('metric_affinity', jsonb_build_object('from', v_c.metric_affinity, 'to', v_aff));
  end if;
  if v_df is distinct from v_c.metric_date_from then
    v_changed := v_changed || jsonb_build_object('metric_date_from', jsonb_build_object('from', v_c.metric_date_from, 'to', v_df));
  end if;
  if v_dt is distinct from v_c.metric_date_to then
    v_changed := v_changed || jsonb_build_object('metric_date_to', jsonb_build_object('from', v_c.metric_date_to, 'to', v_dt));
  end if;
  if v_changed = '{}'::jsonb then
    raise exception 'campaign_plan_set: ไม่มีค่าเปลี่ยน — ไม่เขียน' using errcode = '22023';
  end if;

  update analytics.campaign
     set hypothesis = v_hyp, metric_code = v_mcode, baseline_value = v_bval, baseline_as_of = v_bas, baseline_note = v_bnote,
         pass_threshold = v_thr, pass_op = v_op, baseline_spread = v_spread, metric_channel_code = v_chan, metric_affinity = v_aff,
         metric_date_from = v_df, metric_date_to = v_dt, plan_set_by_role = p_actor_role, updated_by = coalesce(auth.uid(), updated_by)
   where id = p_campaign_id;

  return jsonb_build_object('campaign_id', p_campaign_id, 'changed', v_changed);
end;
$f$;

-- campaign_verdict_propose — เสนอคำตัดสิน (AI เป็นผู้เสนอหลัก) · ยังไม่ใช่คำตัดสิน: ไม่แตะ result_verdict/status · เสนอซ้ำได้ (previous_proposed คืนค่าเก่า — ไม่ทับเงียบ)
-- ไม่สร้างแถว recommendation_log — v_recommendation_inbox ดึงแคมเปญที่เสนอแล้วแต่ยังไม่ยืนยันให้เอง (C3-2)
create or replace function analytics.campaign_verdict_propose(
  p_shop_id     uuid,
  p_campaign_id uuid,
  p_verdict     text,
  p_note        text,
  p_actor_role  text
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_note text;
  v_c    analytics.campaign%rowtype;
  v_gate text;
begin
  if p_shop_id is null or p_campaign_id is null or p_verdict is null or p_note is null then
    raise exception 'campaign_verdict_propose: ต้องระบุร้าน แคมเปญ คำตัดสิน และหลักฐาน/เหตุผล' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner', 'ai', 'system'], 'campaign_verdict_propose');

  if p_verdict not in ('validated', 'invalidated', 'inconclusive', 'not_measured') then
    raise exception 'campaign_verdict_propose: คำตัดสินต้องเป็น validated / invalidated / inconclusive / not_measured' using errcode = '22023';
  end if;
  -- ข้อเสนอเปล่าไม่รับ: ต้องมีหลักฐาน/เหตุผล 3-1000 ตัวอักษร (หลัง clean) และไม่มี [ต้องยืนยัน
  v_note := analytics.content_text_clean(p_note);
  if length(v_note) < 3 or length(v_note) > 1000 then
    raise exception 'campaign_verdict_propose: ต้องระบุหลักฐาน/เหตุผล 3-1000 ตัวอักษร (ได้รับ % หลัง clean)', length(v_note) using errcode = '22023';
  end if;
  if analytics.content_marker_present(v_note) then
    raise exception 'campaign_verdict_propose: หลักฐานมี [ต้องยืนยัน — ตอบให้ครบก่อนเสนอคำตัดสิน' using errcode = '22023';
  end if;
  if analytics.content_bidi_present_(v_note) then
    raise exception 'campaign_verdict_propose: หลักฐานมีอักขระล่องหน/ควบคุมที่ content_text_clean ไม่ลบ (Unicode Tag · soft hyphen · control ฯลฯ) — ลบออกก่อน' using errcode = '22023';
  end if;

  select * into v_c from analytics.campaign where id = p_campaign_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'campaign_verdict_propose: ไม่พบแคมเปญในร้านนี้' using errcode = '22023';
  end if;
  if v_c.result_verdict_confirmed_at is not null then
    raise exception 'campaign_verdict_propose: เจ้าของยืนยันแล้ว (%) — แก้ผ่าน campaign_verdict_confirm เท่านั้น', v_c.result_verdict using errcode = '55000';
  end if;
  -- ตัดสินใจ E: ข้อเสนอที่เจ้าของเป็นคนเสนอเอง AI/ระบบทับเงียบๆ ไม่ได้
  if p_actor_role <> 'owner' and v_c.result_proposed_by_role = 'owner' then
    raise exception 'campaign_verdict_propose: ข้อเสนอปัจจุบันเป็นของเจ้าของ — AI/ระบบทับไม่ได้' using errcode = '42501';
  end if;
  v_gate := analytics.campaign_verdict_gate_(p_campaign_id, p_verdict);
  if v_gate is not null then
    raise exception 'campaign_verdict_propose: %', v_gate using errcode = '55000';
  end if;

  update analytics.campaign
     set result_verdict_proposed = p_verdict, result_proposed_note = v_note, result_proposed_at = now(), result_proposed_by_role = p_actor_role,
         updated_by = coalesce(auth.uid(), updated_by)
   where id = p_campaign_id;

  return jsonb_build_object('campaign_id', p_campaign_id, 'proposed', p_verdict, 'previous_proposed', v_c.result_verdict_proposed,
                            'previous_proposed_by_role', v_c.result_proposed_by_role, 'awaiting_owner', true,
                            'open_pieces', (analytics.campaign_open_pieces_(p_campaign_id) ->> 'open')::int);
end;
$f$;

-- campaign_verdict_confirm — เจ้าของยืนยันคำตัดสิน (owner เท่านั้น · AI ห้ามยืนยันแทน) · compare-and-set กับข้อเสนอที่เจ้าของเห็น (บังคับ ห้าม null)
-- Q12: ปิดได้ทุกเมื่อ แม้มีชิ้นค้าง — ไม่ปฏิเสธ · บันทึกจำนวนชิ้นค้างลง campaign.result_open_pieces + คืนใน payload · ชิ้นค้างไม่นับในผล (ด่านเนื้อหานับเฉพาะ posted)
-- ยืนยันซ้ำ/เปลี่ยนใจได้ (ทับ — previous_* คืนค่าเก่า) · proposed_* ไม่ล้าง (ประวัติว่า AI เสนออะไร) · status → done เฉพาะเมื่อยังไม่ done
-- 🔴 SEC-M1 (ข้อ Q): compare-and-set 2 ชั้น ห้าม null ทั้งคู่ — p_expected_proposed (คำตัดสินที่เสนอ) + p_expected_token (= v_campaign_summary.verdict_token ที่เจ้าของเห็น ครอบทั้งข้อเสนอ/หลักฐาน/แผน/เกณฑ์)
--   ไม่ตรง = 55000 "ข้อมูลเปลี่ยนแล้ว รีเฟรชก่อน" · ลำดับ: ตรวจ expected_proposed ก่อน (ข้อความบอกค่าปัจจุบัน) แล้วค่อย token
-- 🔴 QA-4 (ข้อ V): p_lesson null = "ไม่ส่ง" คงบทเรียนเดิม · '' / ช่องว่าง/อักขระล่องหนล้วน = ตั้งใจล้าง · ข้อความ = ตั้งใหม่ (ไม่ทับบทเรียนเป็นว่างเพราะลืมส่ง)
-- signature เปลี่ยน (เพิ่ม p_expected_token) ⇒ drop เดิมก่อน (trap #1) — ไฟล์นี้ยังไม่เคย apply แต่กันกรณีมีคนรันฉบับก่อนแก้ลง DB ใดๆ
drop function if exists analytics.campaign_verdict_confirm(uuid, uuid, text, text, text, text, text);
create or replace function analytics.campaign_verdict_confirm(
  p_shop_id           uuid,
  p_campaign_id       uuid,
  p_verdict           text,
  p_lesson            text,
  p_actor_role        text,
  p_note              text default null,
  p_expected_proposed text default null,
  p_expected_token    text default null
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  c_lesson_max constant int := 300;   -- ตัดสินใจ D: = เพดาน content_signal.summary (สเปก 500 · ส่งต่อสัญญาณไม่ได้ถ้ายาวกว่านี้)
  v_today      date := (now() at time zone 'Asia/Bangkok')::date;
  v_lesson_sent boolean;
  v_lesson_new text;
  v_note       text;
  v_c          analytics.campaign%rowtype;
  v_gate       text;
  v_open       jsonb;
  v_open_n     int;
  v_signal     uuid;
  v_created    boolean := false;
  v_orders     jsonb;
  v_expected   text;
begin
  if p_shop_id is null or p_campaign_id is null or p_verdict is null then
    raise exception 'campaign_verdict_confirm: ต้องระบุร้าน แคมเปญ และคำตัดสิน' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner'], 'campaign_verdict_confirm');

  if p_verdict not in ('validated', 'invalidated', 'inconclusive', 'not_measured') then
    raise exception 'campaign_verdict_confirm: คำตัดสินต้องเป็น validated / invalidated / inconclusive / not_measured' using errcode = '22023';
  end if;
  -- compare-and-set ห้ามข้ามด้วย null (ตัดสินใจ C) · 'none' หรือ '' = เจ้าของเห็นว่าไม่มีข้อเสนอ
  -- (parameter มี default null เพื่อให้ผู้เรียกที่ละพารามิเตอร์นี้ได้ 22023 พร้อมข้อความบอกเหตุ แทน 42883 "ไม่พบฟังก์ชัน" — ไม่ได้มีไว้ให้ส่ง null ผ่านด่าน)
  if p_expected_proposed is null or p_expected_proposed not in ('validated', 'invalidated', 'inconclusive', 'not_measured', 'none', '') then
    raise exception 'campaign_verdict_confirm: p_expected_proposed ต้องเป็นคำตัดสินที่เจ้าของเห็นบนจอ (validated/invalidated/inconclusive/not_measured) หรือ none (ไม่มีข้อเสนอ) — ห้าม null' using errcode = '22023';
  end if;

  -- SEC-M1: token ต้องเป็น md5 32 ตัวฐานสิบหก (รูปแบบเดียวกับที่ view ให้) — null/ค่าอื่นปฏิเสธชัดๆ ให้ error บอกเหตุถูก
  if p_expected_token is null or p_expected_token !~ '^[0-9a-f]{32}$' then
    raise exception 'campaign_verdict_confirm: p_expected_token ต้องเป็น verdict_token ที่หน้าจออ่านจาก v_campaign_summary (md5 32 ตัว) — ห้าม null/ค่าอื่น' using errcode = '22023';
  end if;

  -- บทเรียน: null = ไม่ส่ง (คงเดิม) · ส่งมาแล้วว่างหลัง clean = ล้าง · ข้อความผ่าน content_text_clean (บทเรียน C1) · marker/ล่องหน = 22023
  v_lesson_sent := p_lesson is not null;
  v_lesson_new := nullif(analytics.content_text_clean(p_lesson), '');
  if v_lesson_new is not null then
    if length(v_lesson_new) > c_lesson_max then
      raise exception 'campaign_verdict_confirm: บทเรียนยาวเกิน % ตัวอักษร (ได้รับ %)', c_lesson_max, length(v_lesson_new) using errcode = '22023';
    end if;
    if analytics.content_marker_present(v_lesson_new) then
      raise exception 'campaign_verdict_confirm: บทเรียนมี [ต้องยืนยัน — ตอบให้ครบก่อนบันทึก' using errcode = '22023';
    end if;
    if analytics.content_bidi_present_(v_lesson_new) then
      raise exception 'campaign_verdict_confirm: บทเรียนมีอักขระล่องหน/ควบคุมที่ content_text_clean ไม่ลบ (Unicode Tag · soft hyphen · control ฯลฯ) — ลบออกก่อน' using errcode = '22023';
    end if;
  end if;
  v_note := nullif(analytics.content_text_clean(p_note), '');
  if v_note is not null then
    if length(v_note) > 1000 then
      raise exception 'campaign_verdict_confirm: หมายเหตุยาวเกิน 1000 ตัวอักษร (ได้รับ %)', length(v_note) using errcode = '22023';
    end if;
    if analytics.content_marker_present(v_note) then
      raise exception 'campaign_verdict_confirm: หมายเหตุมี [ต้องยืนยัน — ตอบให้ครบก่อนบันทึก' using errcode = '22023';
    end if;
    if analytics.content_bidi_present_(v_note) then
      raise exception 'campaign_verdict_confirm: หมายเหตุมีอักขระล่องหน/ควบคุมที่ content_text_clean ไม่ลบ (Unicode Tag · soft hyphen · control ฯลฯ) — ลบออกก่อน' using errcode = '22023';
    end if;
  end if;

  select * into v_c from analytics.campaign where id = p_campaign_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'campaign_verdict_confirm: ไม่พบแคมเปญในร้านนี้' using errcode = '22023';
  end if;
  -- (ไม่เขียน CASE ใน IF โดยตรง — THEN ของ CASE ทำให้ plpgsql ตัดนิพจน์ผิดที่)
  v_expected := coalesce(nullif(p_expected_proposed, ''), 'none');
  if coalesce(v_c.result_verdict_proposed, 'none') <> v_expected then
    raise exception 'campaign_verdict_confirm: ข้อเสนอเปลี่ยนไปแล้ว (ตอนนี้ %) — รีเฟรชก่อนยืนยัน', coalesce(v_c.result_verdict_proposed, 'ไม่มีข้อเสนอ') using errcode = '55000';
  end if;
  -- แถวถูกล็อก (for update) แล้ว ⇒ token ที่คำนวณตรงนี้คือสถานะที่ UPDATE ด้านล่างจะทับจริง · is distinct from: token ฝั่ง DB null (ไม่ควรเกิด) = ไม่ตรง ไม่ใช่ผ่านเงียบ
  if analytics.campaign_verdict_token_(p_campaign_id) is distinct from p_expected_token then
    raise exception 'campaign_verdict_confirm: ข้อมูลแคมเปญเปลี่ยนแล้วระหว่างที่เปิดหน้า (ข้อเสนอ/หลักฐาน/แผน/เกณฑ์) — รีเฟรชก่อนยืนยัน' using errcode = '55000';
  end if;
  v_gate := analytics.campaign_verdict_gate_(p_campaign_id, p_verdict);
  if v_gate is not null then
    raise exception 'campaign_verdict_confirm: %', v_gate using errcode = '55000';
  end if;

  -- Q12: ไม่ปฏิเสธเมื่อมีชิ้นค้าง — นับแล้วบันทึกไว้
  v_open := analytics.campaign_open_pieces_(p_campaign_id);
  v_open_n := (v_open ->> 'open')::int;

  update analytics.campaign
     set result_verdict = p_verdict,
         result_note = coalesce(v_note, result_note),
         result_verdict_confirmed_at = now(),
         result_verdict_confirmed_by_role = 'owner',
         lesson = case when v_lesson_sent then v_lesson_new else lesson end,
         result_open_pieces = v_open_n,
         status = 'done',
         updated_by = coalesce(auth.uid(), updated_by)
   where id = p_campaign_id;

  -- บทเรียน → สัญญาณ insight (ไม่สร้างซ้ำถ้ามีข้อความเดียวกันของแคมเปญนี้แล้ว)
  -- ส่งบทเรียนมาเท่านั้นถึงจะสร้างสัญญาณ (ไม่ส่ง = คงบทเรียนเดิม — สัญญาณของบทเรียนเดิมสร้างไปแล้วตอนที่ตั้ง)
  if v_lesson_new is not null then
    select s.id into v_signal
      from analytics.content_signal s
     where s.shop_id = p_shop_id and s.kind = 'insight' and s.origin_campaign_id = p_campaign_id and s.summary = v_lesson_new
     limit 1;
    if v_signal is null then
      v_signal := analytics.content_signal_capture(
        p_shop_id => p_shop_id, p_kind => 'insight', p_summary => v_lesson_new, p_source => 'owner', p_seen_on => v_today,
        p_origin_campaign_id => p_campaign_id, p_confidence => 'observation', p_actor_role => 'owner');
      v_created := true;
    end if;
  end if;

  if v_c.metric_code = 'orders' then
    select jsonb_build_object('actual', s.orders_actual, 'window_from', s.orders_window_from, 'window_to', s.orders_window_to,
                              'data_through', s.orders_data_through, 'data_covers_window', s.orders_data_covers_window,
                              'threshold_met', s.orders_threshold_met)
      into v_orders from analytics.v_campaign_summary s where s.campaign_id = p_campaign_id;
  end if;

  return jsonb_build_object('campaign_id', p_campaign_id, 'verdict', p_verdict, 'proposed_was', v_c.result_verdict_proposed,
                            'previous_verdict', case when v_c.result_verdict_confirmed_at is not null then v_c.result_verdict end,
                            'previous_lesson', v_c.lesson, 'lesson_kept', not v_lesson_sent, 'status', 'done', 'signal_id', v_signal, 'signal_created', v_created,
                            'open_pieces', v_open_n, 'open_by_status', v_open -> 'by_status', 'excluded_from_result', v_open_n,
                            'orders', v_orders);
end;
$f$;

-- ============================================================================
-- 7. recommendation RPC — สร้างข้อเสนอ/คำถาม (กันซ้ำ) · เจ้าของตอบ (compare-and-set ในตัว)
--    หมดเวลา = view แสดง expired + default_action (แถวยัง pending · หลัก 0101) — ข้อยกเว้นเดียว: recommendation_create ปิด pending ชื่อซ้ำที่หมดเวลาเป็น expired (acted_by_role = system · ข้อ AG) ·
--    เจ้าของตอบช้าได้ทั้งสองกรณี — recommendation_respond รับ pending หรือ expired+system · คำตอบจริงชนะค่าเริ่มต้น (is_late นับเฉพาะ acted_by_role = owner)
-- ============================================================================

-- 🔴 QA-5 (ข้อ W): คืน jsonb {id, created, conflict} (เดิม uuid) — ชื่อซ้ำที่ยัง pending ไม่ error 23505 อีก: คืน id เดิม created=false ·
--   เนื้อหาต่างจากเดิม = conflict=true (ไม่ทับเงียบ ผู้เรียกตัดสินเองว่าจะตอบ/ปิดอันเดิมแล้วสร้างใหม่) · Brief รันซ้ำจึงไม่ล้มทั้งชุด
-- return type เปลี่ยน ⇒ create or replace ทำไม่ได้ (42P13) ต้อง drop เดิมก่อน (trap #1) — ไฟล์นี้ยังไม่เคย apply แต่กันกรณีมีคนรันฉบับก่อนแก้ลง DB ใดๆ
drop function if exists analytics.recommendation_create(uuid, text, text, text, text, text, integer, date, text, uuid, uuid, uuid);
create or replace function analytics.recommendation_create(
  p_shop_id             uuid,
  p_title               text,
  p_detail              text,
  p_actor_role          text,
  p_kind                text default 'proposal',
  p_source              text default 'agent',
  p_effort_minutes_est  int  default null,
  p_respond_by          date default null,
  p_default_action      text default null,
  p_related_campaign_id uuid default null,
  p_related_step_id     uuid default null,
  p_summary_id          uuid default null
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_today  date := (now() at time zone 'Asia/Bangkok')::date;
  v_title  text;
  v_detail text;
  v_def    text;
  v_dup    analytics.recommendation_log%rowtype;
  v_step   analytics.campaign_step%rowtype;
  v_id     uuid;
  v_expired int := 0;
begin
  if p_shop_id is null or p_title is null or p_detail is null then
    raise exception 'recommendation_create: ต้องระบุร้าน หัวข้อ และรายละเอียด' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner', 'ai', 'system'], 'recommendation_create');

  -- `p_x not in (...)` กับ null ได้ null แล้วข้ามด่านเงียบ ⇒ ตรวจ is null แยกเสมอ
  if p_kind is null or p_kind not in ('proposal', 'question') then
    raise exception 'recommendation_create: kind ต้องเป็น proposal หรือ question (ด่านความเสี่ยง/คำตัดสินแคมเปญเป็นของ step_gate/campaign — ไม่สร้างเป็นแถวที่นี่)' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('weekly_brief', 'agent', 'adhoc') then
    raise exception 'recommendation_create: source ต้องเป็น weekly_brief / agent / adhoc' using errcode = '22023';
  end if;
  v_title := analytics.content_text_clean(p_title);
  if length(v_title) < 1 or length(v_title) > 200 then
    raise exception 'recommendation_create: หัวข้อต้องยาว 1-200 ตัวอักษร (หลัง clean ได้ %)', length(v_title) using errcode = '22023';
  end if;
  if analytics.content_marker_present(v_title) then
    raise exception 'recommendation_create: หัวข้อมี [ต้องยืนยัน' using errcode = '22023';
  end if;
  if analytics.content_bidi_present_(v_title) then
    raise exception 'recommendation_create: หัวข้อมีอักขระล่องหน/ควบคุมที่ content_text_clean ไม่ลบ (Unicode Tag · soft hyphen · control ฯลฯ) — ลบออกก่อน' using errcode = '22023';
  end if;
  -- รายละเอียดอาจหลายบรรทัด (content_text_clean ยุบ newline ทั้งหมด) ⇒ ไม่แก้ข้อความ ปฏิเสธอักขระ bidi/ล่องหนแทน (ตัดสินใจ H) · marker อนุญาต —
  -- คำถามถึงเจ้าของอาจอ้าง [ต้องยืนยัน] ของชิ้นงาน
  if analytics.content_bidi_present_(p_detail) then
    raise exception 'recommendation_create: รายละเอียดมีอักขระควบคุมทิศทาง/ล่องหน (bidi · ZWSP · BOM) — ลบออกก่อน' using errcode = '22023';
  end if;
  v_detail := btrim(replace(p_detail, E'\r', ''));
  if length(v_detail) < 1 or length(v_detail) > 4000 then
    raise exception 'recommendation_create: รายละเอียดต้องยาว 1-4000 ตัวอักษร (ได้ %)', length(v_detail) using errcode = '22023';
  end if;
  if p_effort_minutes_est is not null and (p_effort_minutes_est < 1 or p_effort_minutes_est > 480) then
    raise exception 'recommendation_create: effort_minutes_est ต้องเป็น 1-480 หรือ null' using errcode = '22023';
  end if;

  if p_respond_by is not null then
    if not isfinite(p_respond_by) or p_respond_by < v_today or p_respond_by > v_today + 90 then
      raise exception 'recommendation_create: respond_by ต้องเป็นวันไทยตั้งแต่วันนี้ถึง +90 วัน (ได้รับ %)', p_respond_by using errcode = '22023';
    end if;
    -- R-M4: เส้นตายที่ไม่ใช่เจ้าของตั้งต้องเหลือเวลาอย่างน้อย 2 วัน (วันนี้/พรุ่งนี้ไม่ได้) — กัน AI บีบเวลาให้เจ้าของไม่ทันตอบแล้ว "ค่าเริ่มต้น" ที่ AI เขียนเองกลายเป็นคำตอบ
    if p_actor_role <> 'owner' and p_respond_by < v_today + 2 then
      raise exception 'recommendation_create: AI/ระบบตั้งเส้นตายได้ตั้งแต่วันนี้+2 ขึ้นไป (ได้รับ % · วันนี้ %) — เส้นตายที่เร็วกว่านี้เป็นของเจ้าของ', p_respond_by, v_today using errcode = '22023';
    end if;
    v_def := analytics.content_text_clean(p_default_action);
    if length(v_def) < 1 or length(v_def) > 500 then
      raise exception 'recommendation_create: มีเส้นตายต้องบอกค่าเริ่มต้น (default_action 1-500 ตัวอักษร) — หมดเวลาแล้วถือว่าทำอะไร' using errcode = '22023';
    end if;
    -- QA (รอบ 2): default_action ตรวจ [ต้องยืนยัน เหมือน title — ค่าเริ่มต้นที่ยังมีข้อเท็จจริงรอยืนยันห้ามกลายเป็น "สิ่งที่ถือว่าทำ"
    if analytics.content_marker_present(v_def) then
      raise exception 'recommendation_create: default_action มี [ต้องยืนยัน — ตอบให้ครบก่อนสร้างข้อเสนอ' using errcode = '22023';
    end if;
    if analytics.content_bidi_present_(v_def) then
      raise exception 'recommendation_create: default_action มีอักขระล่องหน/ควบคุมที่ content_text_clean ไม่ลบ — ลบออกก่อน' using errcode = '22023';
    end if;
  elsif p_default_action is not null then
    raise exception 'recommendation_create: ส่ง default_action โดยไม่มี respond_by ไม่ได้ (ค่าเริ่มต้นไม่มีความหมายถ้าไม่มีเส้นตาย)' using errcode = '22023';
  end if;

  if p_related_campaign_id is not null
     and not exists (select 1 from analytics.campaign c where c.id = p_related_campaign_id and c.shop_id = p_shop_id) then
    raise exception 'recommendation_create: ไม่พบแคมเปญที่อ้างถึงในร้านนี้' using errcode = '22023';
  end if;
  if p_related_step_id is not null then
    select * into v_step from analytics.campaign_step s where s.id = p_related_step_id and s.shop_id = p_shop_id;
    if not found then
      raise exception 'recommendation_create: ไม่พบชิ้นงานที่อ้างถึงในร้านนี้' using errcode = '22023';
    end if;
    if v_step.piece_status is null then
      raise exception 'recommendation_create: ข้อเสนอผูกได้เฉพาะชิ้นงานใน workflow ใหม่ (piece_status ว่าง = ขั้นของแคมเปญเก่า)' using errcode = '22023';
    end if;
    if p_related_campaign_id is not null and v_step.campaign_id <> p_related_campaign_id then
      raise exception 'recommendation_create: ชิ้นงานที่อ้างถึงไม่อยู่ในแคมเปญที่อ้างถึง' using errcode = '22023';
    end if;
  end if;
  if p_summary_id is not null
     and not exists (select 1 from analytics.content_weekly_summary w where w.id = p_summary_id and w.shop_id = p_shop_id) then
    raise exception 'recommendation_create: ไม่พบสรุปสัปดาห์ที่อ้างถึงในร้านนี้' using errcode = '22023';
  end if;

  -- R2 Low: ข้อเสนอ pending ที่หมดเวลาแล้ว (เงื่อนไขเดียวกับ view/respond: เลย respond_by หรือไม่มีเส้นตายและเกิน 14 วัน) ต้องไม่บังข้อเสนอใหม่ชื่อเดียวกัน —
  -- เดิมนับเป็นซ้ำ ⇒ ข้อเสนอใหม่ "หายเงียบ" (created=false ชี้ไปแถวที่เจ้าของไม่มีวันเห็นว่าทันแล้ว)
  -- เลือก "ปิดแถวเก่าเป็น expired ก่อนสร้าง" ไม่ใช่ "ข้ามแถวหมดเวลาตอนตรวจซ้ำ": partial unique index (owner_action = pending) ยังบังอยู่ ข้ามตอนตรวจแล้ว insert ก็ชน ·
  -- 0101 อนุญาตให้เขียน expired ตรงๆ (ค่าเดียวกับที่ v_recommendation_acceptance คำนวณให้อยู่แล้ว ⇒ KPI ไม่ขยับ) · acted_by_role = 'system' (R3-M1: ระบบปิด ไม่ใช่เจ้าของ ⇒ guard ไม่ล็อกแถวนี้ ·
  -- เจ้าของยังตอบช้าได้ผ่าน recommendation_respond ซึ่งรับ pending หรือ expired+system — ไม่ขัดหลัก "เจ้าของตอบช้าได้ คำตอบจริงชนะ" · is_late ใน view นับเฉพาะ acted_by_role = owner) ·
  -- ทั้งหมดอยู่ในทรานแซกชันเดียวกับ insert — ตกด่านด้านล่างตรงไหน ย้อนกลับพร้อมกัน
  update analytics.recommendation_log r
     set owner_action = 'expired', acted_at = now(), acted_by_role = 'system'
   where r.shop_id = p_shop_id and lower(btrim(r.title)) = lower(v_title) and r.owner_action = 'pending'
     and ((r.respond_by is not null and r.respond_by < v_today)
          or (r.respond_by is null and now() - r.created_at > interval '14 days'));
  get diagnostics v_expired = row_count;

  -- กันซ้ำ: Brief รันซ้ำ / Tech Lead เรียกสองรอบ ไม่ได้แถวคู่ — ซ้ำ = คืนแถวเดิม (created=false) ไม่ error · เนื้อหาต่าง = conflict=true ไม่ทับเงียบ
  -- เทียบเฉพาะสิ่งที่ผู้เรียกส่งมา (detail/kind/effort/เส้นตาย/ค่าเริ่มต้น/ลิงก์) — ไม่เทียบ source/role/เวลา (Brief คนละรอบเขียนต่างกันได้โดยเนื้อหาเดียวกัน)
  select r.* into v_dup from analytics.recommendation_log r
   where r.shop_id = p_shop_id and lower(btrim(r.title)) = lower(v_title) and r.owner_action = 'pending'
   limit 1;
  if not found then
    -- แข่งกัน 2 คำสั่งที่ผ่านการตรวจด้านบนพร้อมกัน: partial unique index ทำให้ตัวที่สองได้ 0 แถว (do nothing) แล้วอ่านแถวของตัวแรกกลับ — ไม่ต้องจับ 23505
    insert into analytics.recommendation_log
      (shop_id, source, title, detail, effort_minutes_est, related_campaign_id, kind, respond_by, default_action,
       related_step_id, summary_id, created_by_role, created_by)
    values
      (p_shop_id, p_source, v_title, v_detail, p_effort_minutes_est, p_related_campaign_id, p_kind, p_respond_by, v_def,
       p_related_step_id, p_summary_id, p_actor_role, auth.uid())
    on conflict (shop_id, lower(btrim(title))) where owner_action = 'pending' do nothing
    returning id into v_id;
    if v_id is not null then
      return jsonb_build_object('id', v_id, 'created', true, 'conflict', false, 'expired_previous', v_expired);
    end if;
    select r.* into v_dup from analytics.recommendation_log r
     where r.shop_id = p_shop_id and lower(btrim(r.title)) = lower(v_title) and r.owner_action = 'pending'
     limit 1;
    if not found then
      raise exception 'recommendation_create: ชื่อซ้ำกับข้อเสนอที่ถูกตอบไปพร้อมกัน — ลองใหม่อีกครั้ง' using errcode = '40001';
    end if;
  end if;
  return jsonb_build_object('id', v_dup.id, 'created', false, 'expired_previous', v_expired,
    'conflict', (v_dup.detail, v_dup.kind, v_dup.effort_minutes_est, v_dup.respond_by, v_dup.default_action,
                 v_dup.related_campaign_id, v_dup.related_step_id, v_dup.summary_id)
                is distinct from
                (v_detail, p_kind, p_effort_minutes_est, p_respond_by, v_def, p_related_campaign_id, p_related_step_id, p_summary_id));
end;
$f$;

-- recommendation_respond — เจ้าของตอบ (owner เท่านั้น · AI ตอบแทนไม่ได้) · done / rejected เท่านั้น (expired = view คำนวณ ไม่เขียน)
-- compare-and-set 2 ชั้น: แถวที่ไม่ใช่ pending ตอบซ้ำไม่ได้ (55000) + SEC-M1 p_expected_token (= v_recommendation_inbox.content_token ที่เจ้าของอ่านก่อนตอบ) บังคับไม่ null —
--   เนื้อหา/เส้นตาย/ค่าเริ่มต้น/ลิงก์ เปลี่ยนระหว่างอ่าน = 55000 "ข้อมูลเปลี่ยนแล้ว รีเฟรชก่อน" (กันตอบข้อเสนอที่ไม่ใช่ฉบับที่เห็น)
-- SEC-H2: เขียน owner_action + acted_at + acted_by + acted_by_role + owner_response ในคำสั่งเดียว (outcome_note ไม่แตะ — ของทีมที่จดผลทีหลัง) แล้ว guard ล็อกทั้งชุดนี้ไม่ให้ใครแก้ย้อนหลัง
-- signature เปลี่ยน (เพิ่ม p_expected_token) ⇒ drop เดิมก่อน (trap #1)
drop function if exists analytics.recommendation_respond(uuid, uuid, text, text, text);
create or replace function analytics.recommendation_respond(
  p_shop_id        uuid,
  p_id             uuid,
  p_action         text,
  p_response       text,
  p_actor_role     text,
  p_expected_token text default null
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
  v_resp    text;
  v_r       analytics.recommendation_log%rowtype;
  v_late    boolean;
  v_expired boolean;
  v_reopen  boolean;
  v_at      timestamptz := now();
begin
  if p_shop_id is null or p_id is null or p_action is null then
    raise exception 'recommendation_respond: ต้องระบุร้าน ข้อเสนอ และคำตอบ (done/rejected)' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner'], 'recommendation_respond');

  if p_action not in ('done', 'rejected') then
    raise exception 'recommendation_respond: คำตอบต้องเป็น done หรือ rejected (expired = ระบบคำนวณใน view ไม่ใช่คำตอบ · pending ไม่ใช่คำตอบ)' using errcode = '22023';
  end if;
  if p_expected_token is null or p_expected_token !~ '^[0-9a-f]{32}$' then
    raise exception 'recommendation_respond: p_expected_token ต้องเป็น content_token ที่หน้าจออ่านจาก v_recommendation_inbox (md5 32 ตัว) — ห้าม null/ค่าอื่น' using errcode = '22023';
  end if;
  v_resp := nullif(analytics.content_text_clean(p_response), '');
  if v_resp is not null then
    if length(v_resp) > 1000 then
      raise exception 'recommendation_respond: คำตอบยาวเกิน 1000 ตัวอักษร (ได้ %)', length(v_resp) using errcode = '22023';
    end if;
    if analytics.content_marker_present(v_resp) then
      raise exception 'recommendation_respond: คำตอบมี [ต้องยืนยัน — ตอบให้ครบก่อนบันทึก' using errcode = '22023';
    end if;
    if analytics.content_bidi_present_(v_resp) then
      raise exception 'recommendation_respond: คำตอบมีอักขระล่องหน/ควบคุมที่ content_text_clean ไม่ลบ (Unicode Tag · soft hyphen · control ฯลฯ) — ลบออกก่อน' using errcode = '22023';
    end if;
  end if;
  if p_action = 'rejected' and (v_resp is null or length(v_resp) < 3) then
    raise exception 'recommendation_respond: ปฏิเสธต้องระบุเหตุผล 3-1000 ตัวอักษร' using errcode = '22023';
  end if;

  select * into v_r from analytics.recommendation_log where id = p_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'recommendation_respond: ไม่พบข้อเสนอในร้านนี้' using errcode = '22023';
  end if;
  -- R3-M1: แถวที่ "ระบบ" ปิดเป็น expired (acted_by_role = system · จาก recommendation_create) ยังตอบได้ — เจ้าของตอบช้าได้เสมอ · แถวที่เจ้าของตอบแล้ว/ปิดตรงโดยคน ตอบซ้ำไม่ได้
  v_reopen := coalesce(v_r.owner_action = 'expired' and v_r.acted_by_role = 'system', false);   -- coalesce: acted_by_role ว่าง (แถวเก่า) ทำให้ AND เป็น null แล้ว not null ข้ามด่านเงียบ (trap #13)
  if v_r.owner_action <> 'pending' and not v_reopen then
    raise exception 'recommendation_respond: ตอบแล้ว (% เมื่อ %)', v_r.owner_action, v_r.acted_at using errcode = '55000';
  end if;
  -- แถวถูกล็อก (for update) แล้ว — token ที่คำนวณตรงนี้คือสถานะที่ UPDATE ด้านล่างจะทับจริง
  if analytics.recommendation_token_(p_id) is distinct from p_expected_token then
    raise exception 'recommendation_respond: ข้อมูลข้อเสนอเปลี่ยนแล้วระหว่างที่เปิดหน้า (เนื้อหา/เส้นตาย/ค่าเริ่มต้น) — รีเฟรชก่อนตอบ' using errcode = '55000';
  end if;

  v_late := v_r.respond_by is not null and v_today > v_r.respond_by;
  v_expired := v_reopen or v_late or (v_r.respond_by is null and v_at - v_r.created_at > interval '14 days');

  update analytics.recommendation_log
     set owner_action = p_action, acted_at = v_at, acted_by = auth.uid(), acted_by_role = 'owner', owner_response = v_resp,
         acted_session_user = session_user::text   -- ไว้ตรวจย้อนหลังว่าใครเรียก (service key = authenticator/postgres) จนกว่า A2 · ไม่ใช่หลักฐานยืนยันตัวตน
   where id = p_id;

  return jsonb_build_object('id', p_id, 'owner_action', p_action, 'acted_at', v_at, 'late', v_late, 'was_expired', v_expired,
                            'default_action_was', v_r.default_action, 'reopened_from_system_expiry', v_reopen);
end;
$f$;

-- ============================================================================
-- 8. content_weekly_summary_upsert — Weekly Brief ฉบับเต็ม (มติ Q10) · ทับได้เมื่อ Brief แก้แล้วส่งใหม่ (ประวัติอยู่ใน git ของ md) แต่ "ไม่ทับเงียบ":
--    คืน created/changed/revision · ส่งเนื้อหาเดิมซ้ำ = ไม่เขียน · ai/system ทับฉบับที่ owner เขียนล่าสุดไม่ได้ (ตัดสินใจ E/F)
-- ============================================================================

create or replace function analytics.content_weekly_summary_upsert(
  p_shop_id       uuid,
  p_week_start    date,
  p_brief_date    date,
  p_summary_lines text[],
  p_body_md       text,
  p_actor_role    text,
  p_brief_no      int  default null,
  p_source_path   text default null
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_lines text[] := '{}';
  v_line  text;
  v_body  text;
  v_old   analytics.content_weekly_summary%rowtype;
  v_id    uuid;
begin
  if p_shop_id is null or p_week_start is null or p_brief_date is null or p_summary_lines is null or p_body_md is null then
    raise exception 'content_weekly_summary_upsert: ต้องระบุร้าน สัปดาห์ วันที่ Brief สรุป และเนื้อหา' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner', 'ai', 'system'], 'content_weekly_summary_upsert');

  if not isfinite(p_week_start) or not isfinite(p_brief_date) then
    raise exception 'content_weekly_summary_upsert: วันที่ต้องเป็นวันจริง (ไม่รับ infinity)' using errcode = '22023';
  end if;
  if extract(isodow from p_week_start) <> 1 or p_week_start < date '2025-01-01' or p_week_start > v_today then
    raise exception 'content_weekly_summary_upsert: week_start ต้องเป็นวันจันทร์ ตั้งแต่ 2025-01-01 ถึงวันนี้ (ไทย) (ได้รับ %)', p_week_start using errcode = '22023';
  end if;
  if p_brief_date < p_week_start or p_brief_date > p_week_start + 14 or p_brief_date > v_today then
    raise exception 'content_weekly_summary_upsert: brief_date ต้องอยู่ใน week_start..week_start+14 และไม่เป็นวันในอนาคต (ได้รับ %)', p_brief_date using errcode = '22023';
  end if;
  if p_brief_no is not null and (p_brief_no < 1 or p_brief_no > 9999) then
    raise exception 'content_weekly_summary_upsert: brief_no ต้องเป็น 1-9999 หรือ null' using errcode = '22023';
  end if;
  if p_source_path is not null and p_source_path !~ '^docs/3j-jewelry/marketing/weekly-brief/[0-9]{4}-[0-9]{2}-[0-9]{2}\.md$' then
    raise exception 'content_weekly_summary_upsert: source_path ต้องเป็น docs/3j-jewelry/marketing/weekly-brief/YYYY-MM-DD.md หรือ null' using errcode = '22023';
  end if;

  -- array_ndims ของ '{}' เป็น null ⇒ is distinct from 1 จับทั้งว่างและหลายมิติ
  if array_ndims(p_summary_lines) is distinct from 1 or cardinality(p_summary_lines) not between 1 and 5 then
    raise exception 'content_weekly_summary_upsert: สรุปต้องเป็น array มิติเดียว 1-5 บรรทัด' using errcode = '22023';
  end if;
  foreach v_line in array p_summary_lines loop
    v_line := analytics.content_text_clean(v_line);   -- element null → '' → ตกด่านความยาวด้านล่าง (ไม่ปล่อยบรรทัดว่าง)
    -- QA-1 (ข้อ U): เพดาน 1,000 (เดิม 300 — Brief #4 จริงยาว 613 ตัวอักษร) · เนื้อหาเต็มยังเพดาน 80,000
    if length(v_line) < 1 or length(v_line) > 1000 then
      raise exception 'content_weekly_summary_upsert: แต่ละบรรทัดสรุปต้องยาว 1-1000 ตัวอักษรหลัง clean (ไม่ว่าง/ZWSP ล้วน)' using errcode = '22023';
    end if;
    if analytics.content_bidi_present_(v_line) then
      raise exception 'content_weekly_summary_upsert: บรรทัดสรุปมีอักขระล่องหน/ควบคุมที่ content_text_clean ไม่ลบ (Unicode Tag · soft hyphen · control ฯลฯ) — ลบออกก่อน' using errcode = '22023';
    end if;
    v_lines := v_lines || v_line;
  end loop;

  -- markdown ต้องคง whitespace/newline ⇒ ไม่ clean · ปฏิเสธ bidi/ล่องหนแทน (ไม่แก้เงียบ) · CRLF → LF (ไฟล์ md บน Windows)
  if analytics.content_bidi_present_(p_body_md) then
    raise exception 'content_weekly_summary_upsert: เนื้อหามีอักขระควบคุมทิศทาง/ล่องหน (bidi · ZWSP · BOM) — ลบออกก่อน' using errcode = '22023';
  end if;
  v_body := replace(replace(p_body_md, E'\r\n', E'\n'), E'\r', E'\n');
  if length(btrim(v_body)) < 1 or length(v_body) > 80000 then
    raise exception 'content_weekly_summary_upsert: เนื้อหาต้องยาว 1-80000 ตัวอักษร ไม่ว่างเปล่า (ได้ %)', length(v_body) using errcode = '22023';
  end if;

  select * into v_old from analytics.content_weekly_summary w where w.shop_id = p_shop_id and w.week_start = p_week_start for update;
  if found then
    if p_actor_role <> 'owner' and v_old.updated_by_role = 'owner' then
      raise exception 'content_weekly_summary_upsert: ฉบับนี้เจ้าของเป็นคนเขียนล่าสุด — AI/ระบบทับไม่ได้' using errcode = '42501';
    end if;
    if v_old.brief_date = p_brief_date and v_old.brief_no is not distinct from p_brief_no and v_old.summary_lines = v_lines
       and v_old.body_md = v_body and v_old.source_path is not distinct from p_source_path then
      return jsonb_build_object('id', v_old.id, 'created', false, 'changed', false, 'revision', v_old.revision);
    end if;
    update analytics.content_weekly_summary
       set brief_date = p_brief_date, brief_no = p_brief_no, summary_lines = v_lines, body_md = v_body, source_path = p_source_path,
           revision = revision + 1, updated_by_role = p_actor_role, updated_by = coalesce(auth.uid(), updated_by)
     where id = v_old.id
     returning id into v_id;
    return jsonb_build_object('id', v_id, 'created', false, 'changed', true, 'revision', v_old.revision + 1, 'previous_revision', v_old.revision);
  end if;

  insert into analytics.content_weekly_summary
    (shop_id, week_start, brief_date, brief_no, summary_lines, body_md, source_path, created_by_role, created_by, updated_by_role, updated_by)
  values
    (p_shop_id, p_week_start, p_brief_date, p_brief_no, v_lines, v_body, p_source_path, p_actor_role, auth.uid(), p_actor_role, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'created', true, 'changed', true, 'revision', 1);
end;
$f$;

-- ============================================================================
-- 9. view — ใหม่ทั้งหมด · security_invoker · ไม่ replace view เดิม (0149/0159/0160/0161 คงเดิม · trap #3) · ไม่กรองร้าน (frontend .eq('shop_id'))
--    วัน "วันนี้" = (now() at time zone 'Asia/Bangkok')::date · ไม่ซ้อนบน v_content_piece (D15) · perf: D19 (ซ้อนบน v_content_post_result — วันนี้ 10 โพสต์)
-- ============================================================================

-- หน้า E รายการ+รายละเอียดแคมเปญ — 1 แถว/campaign ทุกแถว (รวมแคมเปญเก่า 12 แถวที่ pieces_total = 0)
-- ชิ้นค้าง/ยกเลิกไม่นับในผล (Q12): ผลโพสต์นับเฉพาะชิ้น posted หรือแคมเปญเก่าที่ piece_status ว่าง
-- orders_*: เฉพาะ metric_code = orders · ช่วงวัน = metric_date_from/to > ช่วงวันของ step (min start .. max end) > anchor_date วันเดียว · ไม่มีข้อมูลพอ = null (ไม่เดา)
--   orders_data_through = วันล่าสุดที่ "ร้าน" มีออเดอร์ (ทุกช่องทาง — ออเดอร์เข้าจากไฟล์ import รายเดือนทีเดียวทุกช่องทาง ยอดวันท้ายอาจยังไม่เข้า)
--   orders_channel_data_through = วันล่าสุดที่ "ช่องทางที่แคมเปญนับ" มีออเดอร์ (null ถ้าแคมเปญไม่ระบุช่องทาง หรือช่องนั้นไม่มีออเดอร์เลย)
--   orders_major_channels_covered = (ไม่ระบุช่องทาง) ทุกช่องทางหลักมีออเดอร์หลังวันสุดท้ายของช่วงหรือยัง · ช่องหลัก = ≥10% ของออเดอร์ร้านใน 28 วันก่อนวันท้าย (R3-H1) · null = ระบุช่องทาง/ไม่ใช่ orders
--   🔴 R3-H1 (รอบ 3 แทนที่ข้อความ R-H1 ด้านล่างในส่วนช่องทาง): ระบุช่องทาง ⇒ ช่องนั้นต้องมีออเดอร์ "หลัง" วันสุดท้าย (och.d > วันท้าย เข้ม) · ไม่ระบุ ⇒ ร้านมีข้อมูลหลังวันท้าย และทุกช่องหลักมีข้อมูลหลังวันท้ายด้วย
--   🔴 R-H1 (รอบ 2) orders_data_covers_window = ข้อมูลร้านต้องไปถึง "วันหลังวันสุดท้ายของช่วง" (through > วันสุดท้าย แบบเข้ม — วันท้ายที่มีออเดอร์แค่บางส่วนของไฟล์ที่ยังเข้าไม่ครบ ไม่นับว่าครบ ·
--     พิสูจน์บนข้อมูลจริง 6 ต.ค.: LINE มีออเดอร์ แต่ TikTok 0 เพราะไฟล์ยังไม่เข้า) และถ้าระบุช่องทาง ช่องทางนั้นต้องมีออเดอร์ถึงวันสุดท้ายของช่วงด้วย (channel_through >= วันสุดท้าย — ช่องอื่นมีข้อมูลแต่ช่องนี้ไม่มี = ไม่ครอบ) · null = ไม่ครอบ
--     ผลข้างเคียงที่รู้: ช่องทางที่เงียบจริงในวันท้ายของช่วง (ไม่มีออเดอร์วันนั้นเลย) ฟัน validated/invalidated ไม่ได้ ทั้งที่ข้อมูลอาจครบ — ตั้งใจ (แยก "เงียบจริง" กับ "ไฟล์ยังไม่เข้า" จากตารางนี้ไม่ได้) ปิดได้แค่ inconclusive/not_measured
--     🔴 ด่านคำตัดสิน (campaign_verdict_gate_) ใช้ covers_window จริง: validated/invalidated บน orders ต้อง true (SEC-H1)
--   verdict_token = md5 ของเนื้อหาที่เจ้าของเห็น (ข้อเสนอ/หลักฐาน/แผน/เกณฑ์) — หน้าจอส่งกลับเป็น p_expected_token ของ campaign_verdict_confirm (SEC-M1)
--   orders_threshold_met = ผลเทียบเกณฑ์ (>= / <=) เป็นคำใบ้ให้หน้าจอ ไม่ใช่คำตัดสิน
create or replace view analytics.v_campaign_summary
  with (security_invoker = true) as
select
  c.id as campaign_id, c.shop_id, c.name, c.campaign_type, c.trigger_kind, c.status, c.anchor_date, c.primary_channels,
  c.hypothesis, c.metric_code, c.baseline_value, c.baseline_as_of, c.baseline_note, c.pass_threshold, c.pass_op, c.baseline_spread,
  c.metric_channel_code, c.metric_affinity, c.metric_date_from, c.metric_date_to,
  c.result_verdict, c.result_note, c.result_verdict_proposed, c.result_proposed_note, c.result_proposed_at, c.result_proposed_by_role,
  c.result_verdict_confirmed_at, c.lesson, c.result_open_pieces, c.created_at, c.updated_at,
  analytics.campaign_verdict_token_(c.id) as verdict_token,
  (c.baseline_spread is not null and c.pass_threshold is not null and c.baseline_value is not null
     and abs(c.pass_threshold - c.baseline_value) < c.baseline_spread) as threshold_too_narrow,
  ps.pieces_total, ps.pieces_posted, ps.pieces_cancelled, ps.pieces_open, ps.pieces_in_progress,
  po.pieces_measured,
  ps.date_from, ps.date_to,
  po.posts_active_n, po.posts_measured_n, po.posts_above_n, po.posts_normal_n, po.posts_below_n, po.latest_t7_on,
  case when c.metric_code = 'orders' and w.ok then w.wf end as orders_window_from,
  case when c.metric_code = 'orders' and w.ok then w.wt end as orders_window_to,
  case when c.metric_code = 'orders' then c.metric_channel_code end as orders_channel,
  case when c.metric_code = 'orders' then coalesce(c.metric_affinity, 'all') end as orders_affinity,
  case when c.metric_code = 'orders' and w.ok then oa.n end as orders_actual,
  case when c.metric_code = 'orders' then od.d end as orders_data_through,
  case when c.metric_code = 'orders' and c.metric_channel_code is not null then och.d end as orders_channel_data_through,
  case when c.metric_code = 'orders' and c.metric_channel_code is null and w.ok then coalesce(chk.all_major_after, true) end as orders_major_channels_covered,
  case when c.metric_code = 'orders' and w.ok
       then coalesce(case when c.metric_channel_code is not null then och.d > w.wt
                          else od.d > w.wt and coalesce(chk.all_major_after, true) end, false) end as orders_data_covers_window,
  case when c.metric_code = 'orders' and w.ok and c.pass_threshold is not null and c.pass_op is not null
       then case c.pass_op when '>=' then oa.n >= c.pass_threshold else oa.n <= c.pass_threshold end end as orders_threshold_met,
  case when c.result_verdict_confirmed_at is not null then c.result_verdict
       when c.result_verdict_proposed is not null then 'proposed:' || c.result_verdict_proposed
       else null end as verdict_display,
  case when c.result_verdict_confirmed_at is not null or c.status = 'done' then 'closed'
       when ps.pieces_total > 0 and ps.pieces_open = 0 and ps.pieces_posted > 0 then 'awaiting_read'
       when ps.pieces_posted > 0 or ps.pieces_in_progress > 0 or c.status in ('active', 'blocked', 'waiting_data') then 'running'
       else 'draft' end as stage,
  (c.result_verdict_proposed is not null and c.result_verdict_confirmed_at is null) as awaiting_confirm
from analytics.campaign c
left join lateral (
  select
    (count(*) filter (where s.piece_status is not null))::int as pieces_total,
    (count(*) filter (where s.piece_status = 'posted'))::int as pieces_posted,
    (count(*) filter (where s.piece_status = 'cancelled'))::int as pieces_cancelled,
    (count(*) filter (where s.piece_status is not null and s.piece_status not in ('posted', 'cancelled')))::int as pieces_open,
    (count(*) filter (where s.piece_status in ('drafting', 'in_review', 'approved', 'produced')))::int as pieces_in_progress,
    min(c.anchor_date + s.offset_start_days) as date_from,
    max(c.anchor_date + coalesce(s.offset_end_days, s.offset_start_days)) as date_to
  from analytics.campaign_step s
  where s.campaign_id = c.id
) ps on true
left join lateral (
  select
    (count(*))::int as posts_active_n,
    (count(*) filter (where r.t7_captured_on is not null))::int as posts_measured_n,
    (count(distinct r.step_id) filter (where r.t7_captured_on is not null))::int as pieces_measured,
    (count(*) filter (where r.effective_label = 'above'))::int as posts_above_n,
    (count(*) filter (where r.effective_label = 'normal'))::int as posts_normal_n,
    (count(*) filter (where r.effective_label = 'below'))::int as posts_below_n,
    max(r.t7_captured_on) as latest_t7_on
  from analytics.v_content_post_result r
  join analytics.campaign_step s on s.id = r.step_id
  where s.campaign_id = c.id and (s.piece_status is null or s.piece_status = 'posted')
) po on true
cross join lateral (
  select q.wf, q.wt, (q.wf is not null and q.wt is not null and q.wt >= q.wf) as ok
  from (select coalesce(c.metric_date_from, ps.date_from, c.anchor_date) as wf,
               coalesce(c.metric_date_to, ps.date_to, c.anchor_date) as wt) q
) w
left join lateral (
  select (coalesce(sum(o.orders_n), 0))::int as n
  from analytics.v_content_order_daily o
  where c.metric_code = 'orders' and w.ok
    and o.shop_id = c.shop_id and o.order_date between w.wf and w.wt
    and (c.metric_channel_code is null or o.channel_code = c.metric_channel_code)
    and o.affinity = coalesce(c.metric_affinity, 'all')
) oa on true
left join lateral (
  -- วันล่าสุดที่ "ร้าน" มีออเดอร์ (ทุกช่องทาง) · ร้านไม่มีออเดอร์เลย = null = ไม่ครอบ
  -- R3 (code review · perf): อ่าน fact_order ตรง (index shop_id + order_date · 0010) ไม่ผ่าน v_content_order_daily (ซึ่ง group ทั้งตารางต่อออเดอร์) — ความหมายเท่าเดิม:
  -- v_content_order_daily affinity all = ทุกแถว fact_order ที่ join dim_channel ได้ (channel_id not null) · ออเดอร์ที่ยกเลิกถูกลบจริงตอน import (0112)
  select max(fo.order_date) as d
  from analytics.fact_order fo
  where c.metric_code = 'orders' and fo.shop_id = c.shop_id
) od on true
left join lateral (
  -- วันล่าสุดที่ "ช่องทางที่แคมเปญนับ" มีออเดอร์ — เฉพาะเมื่อแคมเปญระบุช่องทาง (R-H1 รอบ 3: ช่องนี้ต้องมีออเดอร์ "หลัง" วันสุดท้ายของช่วง ใช้ > ไม่ใช่ >=)
  select max(fo.order_date) as d
  from analytics.fact_order fo
  join analytics.dim_channel dc on dc.id = fo.channel_id
  where c.metric_code = 'orders' and c.metric_channel_code is not null
    and fo.shop_id = c.shop_id and dc.code = c.metric_channel_code
) och on true
left join lateral (
  -- R3-H1 (High · security รอบ 3): ไม่ระบุช่องทาง ⇒ "ทุกช่องทางหลัก" ต้องมีออเดอร์หลังวันสุดท้ายของช่วง — เดิมดูแค่ว่าร้านมีข้อมูลวันหลังจากช่องไหนก็ได้
  -- (ข้อมูลจริง: TikTok ล่าสุด 5 ต.ค. · LINE/FB 6 ต.ค. ⇒ ช่วงจบ 5 ต.ค. ผ่านด่านทั้งที่ไฟล์ TikTok ของวันที่ 5 อาจยังเข้าไม่ครบ)
  -- ช่องหลัก = ช่องที่มีออเดอร์ ≥ 10% ของออเดอร์ร้านใน 28 วันก่อนวันสุดท้าย (วันท้าย−28 .. วันท้าย−1) · ไม่มีช่องหลักเลย (ร้านไม่มีออเดอร์ในช่วงนั้น) = null ⇒ ผู้ใช้ coalesce true
  -- และยังต้องผ่าน od.d > วันท้าย เสมอ (ร้านเงียบทั้งหมดไม่ถือว่าครอบ) · count(*) * 10 >= รวม = ไม่ใช้ทศนิยม
  select bool_and(exists (select 1 from analytics.fact_order x
                           where x.shop_id = c.shop_id and x.channel_id = m.channel_id and x.order_date > w.wt)) as all_major_after
  from (
    select fo.channel_id
      from analytics.fact_order fo
     where c.metric_code = 'orders' and c.metric_channel_code is null and w.ok
       and fo.shop_id = c.shop_id and fo.order_date >= w.wt - 28 and fo.order_date < w.wt
     group by fo.channel_id
    having count(*) * 10 >= (select count(*) from analytics.fact_order t
                              where t.shop_id = c.shop_id and t.order_date >= w.wt - 28 and t.order_date < w.wt)
  ) m
) chk on true;

-- inbox กอง 4 + หน้า K "ข้อเสนอในสรุปตอบได้" — union 3 แหล่ง ชนิดคอลัมน์ตรงกันทุกแขน · เรียง created_at desc
--   ตัวนับกอง 4 ของ UI = count(*) where effective_action = 'pending' จากview นี้ (ไม่ใช่ owner_questions ของ 0160 ที่นับแค่ด่าน)
--   reco: ทุกแถวของ recommendation_log (ประวัติด้วย — UI กรอง pending) · pending + เลยเส้นตาย = expired · pending ไม่มีเส้นตาย + เกิน 14 วัน = expired (กติกา 0101 คงไว้)
--   risk_gate: ด่าน risk_owner ที่รอ/ติดของชิ้นที่ยังร่าง/รอรีวิว (เงื่อนไขเดียวกับ v_content_inbox_counts.owner_questions) · ตอบผ่าน content_gate_record — ไม่มีค่าเริ่มต้น (AI ตัดสินแทนไม่ได้)
--   campaign_verdict: แคมเปญที่ AI เสนอคำตัดสินแล้วแต่เจ้าของยังไม่ยืนยัน · ตอบผ่าน campaign_verdict_confirm
--   view ไม่ mutate แถว (หลัก 0101) · ไม่มี cron expire · แถวที่ระบบปิดเป็น expired ตอน recommendation_create (acted_by_role = system) เจ้าของยังตอบได้ — is_late นับเฉพาะ acted_by_role = owner (R3-M1)
create or replace view analytics.v_recommendation_inbox
  with (security_invoker = true) as
select u.*
from (
  select
    'reco'::text as item_kind,
    rl.id as item_id,
    rl.shop_id,
    rl.kind,
    rl.title,
    rl.detail,
    rl.effort_minutes_est,
    rl.respond_by,
    rl.default_action,
    rl.related_campaign_id,
    rl.related_step_id,
    rl.summary_id,
    rl.source,
    rl.created_at,
    rl.owner_action,
    case when rl.owner_action <> 'pending' then rl.owner_action
         when rl.respond_by is not null and rl.respond_by < (now() at time zone 'Asia/Bangkok')::date then 'expired'
         when rl.respond_by is null and now() - rl.created_at > interval '14 days' then 'expired'
         else 'pending' end as effective_action,
    case when rl.respond_by is null then null::integer
         else rl.respond_by - (now() at time zone 'Asia/Bangkok')::date end as days_left,
    -- R3-M1: นับเฉพาะ "เจ้าของ" ตอบช้า — แถวที่ระบบปิดเป็น expired (acted_by_role = system) ไม่ใช่คำตอบของเจ้าของ
    coalesce(rl.acted_by_role = 'owner' and rl.acted_at is not null and rl.respond_by is not null
             and (rl.acted_at at time zone 'Asia/Bangkok')::date > rl.respond_by, false) as is_late,
    rl.outcome_note,
    rl.acted_at,
    'recommendation_respond'::text as respond_via,
    rl.owner_response,
    analytics.recommendation_token_(rl.id) as content_token
  from analytics.recommendation_log rl

  union all

  select
    'risk_gate'::text,
    s.id,
    g.shop_id,
    'question'::text,
    'ด่านความเสี่ยง: ' || coalesce(s.title, '(ไม่มีชื่อ)'),
    coalesce(nullif(btrim(g.detail ->> 'question'), ''), nullif(btrim(g.note), ''), '(ไม่มีคำถาม)'),
    null::integer,
    null::date,
    null::text,
    s.campaign_id,
    s.id,
    null::uuid,
    'agent'::text,
    g.created_at,
    'pending'::text,
    'pending'::text,
    null::integer,
    false,
    null::text,
    null::timestamptz,
    'content_gate_record'::text,
    null::text,
    null::text
  from analytics.step_gate g
  join analytics.campaign_step s on s.id = g.step_id
  where g.gate_kind = 'risk_owner' and g.status in ('pending', 'blocked') and s.piece_status in ('drafting', 'in_review')

  union all

  select
    'campaign_verdict'::text,
    c.id,
    c.shop_id,
    'question'::text,
    'ยืนยันคำตัดสินแคมเปญ: ' || c.name,
    c.result_verdict_proposed || ' — ' || c.result_proposed_note,
    null::integer,
    null::date,
    null::text,
    c.id,
    null::uuid,
    null::uuid,
    case c.result_proposed_by_role when 'ai' then 'agent' else 'adhoc' end,
    c.result_proposed_at,
    'pending'::text,
    'pending'::text,
    null::integer,
    false,
    null::text,
    null::timestamptz,
    'campaign_verdict_confirm'::text,
    null::text,
    analytics.campaign_verdict_token_(c.id)
  from analytics.campaign c
  where c.result_verdict_proposed is not null and c.result_verdict_confirmed_at is null
) u
order by u.created_at desc;

-- ============================================================================
-- 10. grant — revoke ครบสามชื่อ แล้ว grant service_role อย่างเดียว (trap #2/#18)
--     ฟังก์ชันวนจาก pg_proc ตามรายชื่อเดียวกับ snapshot/ด่านท้ายไฟล์ ⇒ ฟังก์ชันที่เพิ่ม/ลืม ไม่หลุด grant
-- ============================================================================

do $c5grant$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
       and p.proname ~ '^(content_bidi_present_|campaign_open_pieces_|campaign_verdict_gate_|campaign_verdict_token_|recommendation_token_|content_weekly_summary_guard|content_history_truncate_guard|campaign_result_guard|recommendation_log_guard|campaign_plan_set|campaign_verdict_propose|campaign_verdict_confirm|recommendation_create|recommendation_respond|content_weekly_summary_upsert)$'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end
$c5grant$;

revoke all on analytics.v_campaign_summary, analytics.v_recommendation_inbox from public, anon, authenticated;
grant select on analytics.v_campaign_summary, analytics.v_recommendation_inbox to service_role;

-- J: ตารางใหม่ที่เป็นประวัติ — service_role อ่านได้อย่างเดียว เขียนผ่าน RPC definer เท่านั้น (บทเรียน 0161 H1/M3) · trigger guard เป็นชั้นที่สอง
revoke all on analytics.content_weekly_summary from public, anon, authenticated, service_role;
grant select on analytics.content_weekly_summary to service_role;

-- recommendation_log = ประวัติการตัดสินของเจ้าของ (0101: ห้ามหายก่อนวัน 90) — เดิม service_role เขียน/ลบตรงได้ทั้งหมด ⇒ ถอน insert/update/delete/truncate
-- ผู้เขียนที่เหลือ: RPC definer (recommendation_create / recommendation_respond) · postgres (MCP ของ Tech Lead) · RI SET NULL ตอนลบ step/summary/campaign (รันด้วยสิทธิ์เจ้าของตาราง)
-- ตรวจแล้ว 7 ต.ค.: โค้ดแอป (lib/ app/ components/ scripts/ packages/) ไม่มีที่ไหนอ้าง recommendation_log
-- SEC-Low: revoke all (ไม่ใช่แค่ insert/update/delete/truncate — REFERENCES/TRIGGER ก็ไม่ควรเหลือ) แล้วให้ select อย่างเดียว เหมือน content_weekly_summary
revoke all on analytics.recommendation_log from public, anon, authenticated, service_role;
grant select on analytics.recommendation_log to service_role;

comment on view analytics.v_campaign_summary is
  'หน้า E — 1 แถว/แคมเปญ: แผน (hypothesis/metric/baseline/เกณฑ์) · ชิ้นงาน (total/posted/cancelled/open) · ผลโพสต์ (นับเฉพาะชิ้น posted หรือแคมเปญเก่า — ชิ้นค้างไม่นับ Q12) · '
  'orders_* (metric orders: ยอดนับจาก v_content_order_daily ตามช่วงวัน/ช่องทาง/กลุ่มสินค้า · orders_data_covers_window เตือนข้อมูลยังไม่ครบ — อ่านวันล่าสุดจาก fact_order ตรง) · verdict_display/stage/awaiting_confirm · ไม่กรองร้าน (frontend .eq(shop_id))';
comment on view analytics.v_recommendation_inbox is
  'inbox กอง 4 — ข้อเสนอ/คำถาม (recommendation_log) + ด่านความเสี่ยง risk_owner (step_gate) + แคมเปญรอยืนยันคำตัดสิน · ตัวนับ = count(*) where effective_action = pending · '
  'หมดเวลา = expired (view ไม่ mutate แถว · แถวที่ระบบปิดตอน create เจ้าของยังตอบได้) พร้อม default_action · respond_via บอกว่าตอบผ่าน RPC ไหน · ไม่กรองร้าน (frontend .eq(shop_id))';
comment on function analytics.campaign_plan_set(uuid, uuid, jsonb, text) is
  'ตั้งสมมติฐาน/metric/ฐาน/เกณฑ์/ขอบเขตนับออเดอร์ของแคมเปญ (json null = ล้าง · key ไม่ส่ง = คงเดิม) · owner: ทุกสถานะที่ยังไม่ปิด · ai/system: เฉพาะแคมเปญที่ยังไม่เริ่ม (วันนี้ไทย < least(metric_date_from, anchor_date, วัน step แรก) ทั้งค่าเดิมและค่า metric_date_from ใหม่) · ไม่มีชิ้น posted/โพสต์ active · ยังไม่มีข้อเสนอคำตัดสิน · และแผนล่าสุดต้องไม่ใช่ของ owner (plan_set_by_role) · ปิดแล้วแก้ไม่ได้ทุก actor · เขียน plan_set_by_role ทุกครั้ง · errcode 22023/42501/55000';
comment on function analytics.campaign_verdict_propose(uuid, uuid, text, text, text) is
  'เสนอคำตัดสินแคมเปญ (ยังไม่ใช่คำตัดสิน) — ต้องมีหลักฐาน 3-1000 ตัวอักษร · validated/invalidated ติดด่านเนื้อหา (save/share: ≥4 ชิ้นมี T+7 · orders: ต้องตั้งเกณฑ์ + รู้ช่วงวัน + orders_data_covers_window = true คือข้อมูลต้องไปถึงวันหลังวันสุดท้ายของช่วง · ระบุช่องทาง = ช่องนั้นต้องมีข้อมูลหลังวันท้าย · ไม่ระบุ = ทุกช่องหลัก ≥10% ใน 28 วัน) · ทุกชิ้นถูกยกเลิก = ฟันธงไม่ได้ · ข้อความที่ตกเป็นภาษาไทยของเจ้าของ (55000) · เสนอซ้ำทับได้ (previous_proposed คืนค่าเก่า) · AI ทับข้อเสนอของ owner ไม่ได้';
comment on function analytics.campaign_verdict_confirm(uuid, uuid, text, text, text, text, text, text) is
  'เจ้าของยืนยันคำตัดสิน (owner เท่านั้น) · compare-and-set บังคับ 2 ชั้น: p_expected_proposed (none/ว่าง = ไม่มีข้อเสนอ) + p_expected_token (= v_campaign_summary.verdict_token) — null = 22023 · ไม่ตรง = 55000 รีเฟรชก่อน · '
  'ปิดได้ทุกเมื่อแม้มีชิ้นค้าง (Q12): บันทึก open_pieces + ชิ้นค้างไม่นับในผล · status → done · บทเรียน ≤300 → content_signal insight (ไม่สร้างซ้ำ) · p_lesson null = คงบทเรียนเดิม / ว่าง = ล้าง · ยืนยันซ้ำทับได้ (previous_* คืนค่าเก่า)';
comment on function analytics.recommendation_create(uuid, text, text, text, text, text, integer, date, text, uuid, uuid, uuid) is
  'สร้างข้อเสนอ/คำถามถึงเจ้าของ — คืน jsonb {id, created, conflict}: ชื่อซ้ำที่ยังรอตอบ = id เดิม created=false (conflict=true ถ้าเนื้อหาต่าง · ไม่ทับเงียบ) · เส้นตายต้องมี default_action · อ้างแคมเปญ/ชิ้น/สรุปสัปดาห์ต้องอยู่ร้านเดียวกัน · ชิ้นต้องอยู่ใน workflow ใหม่';
comment on function analytics.recommendation_respond(uuid, uuid, text, text, text, text) is
  'เจ้าของตอบ done/rejected (owner เท่านั้น · rejected ต้องมีเหตุผล) · เขียน owner_response (ล็อกแก้ย้อนหลังไม่ได้) · ตอบซ้ำไม่ได้ (55000 · ยกเว้นแถวที่ระบบปิดเป็น expired (acted_by_role system) ตอบได้ — R3-M1) · p_expected_token (= v_recommendation_inbox.content_token) บังคับ — ไม่ตรง = 55000 รีเฟรชก่อน · '
  'ตอบช้ากว่า respond_by ได้ (late/was_expired ใน payload — คำตอบจริงชนะค่าเริ่มต้น)';
comment on function analytics.content_weekly_summary_upsert(uuid, date, date, text[], text, text, integer, text) is
  'เก็บ Weekly Brief ฉบับเต็ม (มติ Q10) — สรุป 1-5 บรรทัด (บรรทัดละ ≤1000) + markdown ≤80000 · ทับสัปดาห์เดิมได้ (revision+1) แต่ไม่ทับเงียบ: คืน created/changed/revision · เนื้อหาเดิมซ้ำ = ไม่เขียน · ai/system ทับฉบับที่ owner เขียนล่าสุดไม่ได้';
comment on function analytics.campaign_verdict_token_(uuid) is
  'token (md5) ของเนื้อหาที่เจ้าของเห็นบนแคมเปญ: ข้อเสนอ/หลักฐาน/คำตัดสินที่ยืนยัน/แผน/เกณฑ์ — ใช้เป็น p_expected_token ของ campaign_verdict_confirm (SEC-M1) · ไม่รวม status/updated_at';
comment on function analytics.recommendation_token_(uuid) is
  'token (md5) ของเนื้อหาข้อเสนอที่เจ้าของอ่านก่อนตอบ — ใช้เป็น p_expected_token ของ recommendation_respond (SEC-M1) · ไม่รวม outcome_note/updated_at';
comment on function analytics.campaign_verdict_gate_(uuid, text) is
  'ด่านเนื้อหาของคำตัดสิน (ภายใน — propose/confirm ใช้ร่วม): null = ผ่าน · ข้อความ = เหตุผลที่ตก (ผู้เรียก raise 55000) · เฉพาะ validated/invalidated';

-- ============================================================================
-- 11. ด่านท้ายไฟล์ — ของเดิมต้องไม่ขยับ + ผลลัพธ์ต้องถูก (raise = ถอยทั้งก้อน · แบบ 0161 §8)
--     ไม่ assert "ไม่มีแถว kind=question / ไม่มี content_weekly_summary" ที่นี่ — ไฟล์ idempotent รันซ้ำหลังมีการใช้งานแล้วต้องผ่าน (ส่วนนั้นอยู่ verify-0162)
-- ============================================================================

do $c5final$
declare
  v_now text;
  v_bad text;
  v_k   text;
  v_n   bigint;
  c_fn  constant text := '^(content_bidi_present_|campaign_open_pieces_|campaign_verdict_gate_|campaign_verdict_token_|recommendation_token_|content_weekly_summary_guard|content_history_truncate_guard|campaign_result_guard|recommendation_log_guard|campaign_plan_set|campaign_verdict_propose|campaign_verdict_confirm|recommendation_create|recommendation_respond|content_weekly_summary_upsert)$';
  c_rel constant text[] := array['v_campaign_summary', 'v_recommendation_inbox'];
begin
  foreach v_k in array array['c5.snap_metric', 'c5.snap_post', 'c5.snap_step', 'c5.snap_campaign', 'c5.snap_reco', 'c5.snap_gate', 'c5.snap_views', 'c5.snap_funcs'] loop
    if coalesce(current_setting(v_k, true), '') = '' then
      raise exception '0162 ด่านท้าย: ไม่พบ snapshot % — ไฟล์นี้ต้องรันทั้งไฟล์ในทรานแซกชันเดียวผ่าน scripts/run-sql.mjs เท่านั้น', v_k;
    end if;
  end loop;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, view_count, like_count, comment_count, save_count, share_count,
           is_regression, source, array_to_string(sources, ','), captured_at, captured_on, age_days), E'\n' order by id), ''))
    into v_now from analytics.content_post_metric;
  if v_now is distinct from current_setting('c5.snap_metric', true) then
    raise exception '0162 ด่านท้าย: content_post_metric เดิมเปลี่ยน (ไฟล์นี้ไม่แตะตารางนี้)';
  end if;

  select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
         md5(coalesce(string_agg(concat_ws('|', id, status, step_id, hook_id, post_url, posted_at, updated_at), E'\n' order by id), ''))
    into v_now from analytics.content_post;
  if v_now is distinct from current_setting('c5.snap_post', true) then
    raise exception '0162 ด่านท้าย: content_post เปลี่ยน (ไฟล์นี้ไม่แตะตารางนี้)';
  end if;

  select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
         md5(coalesce(string_agg(concat_ws('|', id, status, piece_status, metric_code, hold_reason, updated_at), E'\n' order by id), ''))
    into v_now from analytics.campaign_step;
  if v_now is distinct from current_setting('c5.snap_step', true) then
    raise exception '0162 ด่านท้าย: campaign_step เปลี่ยน (FK ใหม่ชี้เข้ามาจาก recommendation_log ต้องไม่แตะแถว)';
  end if;

  -- trap #19: add column/constraint บน campaign ต้องไม่ยิง trg_campaign_updated_at — count(distinct updated_at) ต้องเท่าเดิม
  select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
         md5(coalesce(string_agg(concat_ws('|', id, status, result_verdict, result_note, hypothesis, anchor_date, updated_at),
           E'\n' order by id), ''))
    into v_now from analytics.campaign;
  if v_now is distinct from current_setting('c5.snap_campaign', true) then
    raise exception '0162 ด่านท้าย: campaign เปลี่ยน (trap #19 — add column/constraint ต้องไม่ยิง updated_at · ไฟล์นี้ไม่มี UPDATE)';
  end if;

  select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
         md5(coalesce(string_agg(concat_ws('|', id, owner_action, acted_at, outcome_note, title, detail, updated_at),
           E'\n' order by id), ''))
    into v_now from analytics.recommendation_log;
  if v_now is distinct from current_setting('c5.snap_reco', true) then
    raise exception '0162 ด่านท้าย: recommendation_log เปลี่ยน (add column kind default ต้องไม่ยิง updated_at · ไฟล์นี้ไม่มี UPDATE)';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', step_id, gate_kind, status, note, updated_at), E'\n' order by step_id, gate_kind), ''))
    into v_now from analytics.step_gate;
  if v_now is distinct from current_setting('c5.snap_gate', true) then
    raise exception '0162 ด่านท้าย: step_gate เปลี่ยน';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(c.relname || '=' || pg_get_viewdef(c.oid), E'\n' order by c.relname), ''))
    into v_now
    from pg_class c
   where c.relnamespace = 'analytics'::regnamespace and c.relkind = 'v' and c.relname <> all (c_rel);
  if v_now is distinct from current_setting('c5.snap_views', true) then
    raise exception '0162 ด่านท้าย: definition ของ view เดิมเปลี่ยน (รวม v_campaign_board / v_content_piece / v_recommendation_acceptance / v_content_post_result / v_content_order_daily — trap #3 ห้ามแตะ view เดิม)';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(p.oid::regprocedure::text || '=' || pg_get_functiondef(p.oid), E'\n'
           order by p.oid::regprocedure::text), ''))
    into v_now
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f' and p.proname !~ c_fn;
  if v_now is distinct from current_setting('c5.snap_funcs', true) then
    raise exception '0162 ด่านท้าย: มีฟังก์ชันเดิมที่ไม่ใช่ของไฟล์นี้ถูกเปลี่ยน/เพิ่ม/หาย (รวม 0148 upsert · 0158 · 0159 · 0160 · 0161) — ไฟล์นี้ไม่ replace ฟังก์ชันเดิมใดเลย';
  end if;

  -- trap #1: ฟังก์ชันของไฟล์นี้ต้องมี signature เดียวต่อชื่อ · ครบ 15 ตัว (helper 5 + trigger 4 + RPC 6)
  select string_agg(x.proname || '=' || x.n, ', ') into v_bad
    from (select p.proname, count(*) as n from pg_proc p
           where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f' and p.proname ~ c_fn
           group by p.proname having count(*) > 1) x;
  if v_bad is not null then
    raise exception '0162 ด่านท้าย: ฟังก์ชันมี overload ค้าง — หยุดแล้วรายงาน: %', v_bad;
  end if;
  select count(*) into v_n from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname ~ c_fn;
  if v_n <> 15 then
    raise exception '0162 ด่านท้าย: คาดฟังก์ชันของไฟล์นี้ 15 ตัว (helper 5 + trigger 4 + RPC 6) พบ %', v_n;
  end if;

  -- trigger ด่านตารางต้องมี เปิดอยู่ (tgenabled = 'O') ชี้ฟังก์ชันถูกตัว และชนิดครบ (ROW=1 BEFORE=2 INSERT=4 DELETE=8 UPDATE=16 TRUNCATE=32)
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'analytics.campaign'::regclass and t.tgname = 'trg_campaign_result_guard' and not t.tgisinternal
                    and t.tgenabled = 'O' and t.tgfoid = 'analytics.campaign_result_guard()'::regprocedure and (t.tgtype & 23) = 23) then
    raise exception '0162 ด่านท้าย: trigger trg_campaign_result_guard ไม่ครบ (ต้อง BEFORE INSERT OR UPDATE FOR EACH ROW เปิดอยู่)';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'analytics.recommendation_log'::regclass and t.tgname = 'trg_recommendation_log_guard' and not t.tgisinternal
                    and t.tgenabled = 'O' and t.tgfoid = 'analytics.recommendation_log_guard()'::regprocedure and (t.tgtype & 31) = 31) then
    raise exception '0162 ด่านท้าย: trigger trg_recommendation_log_guard ไม่ครบ (ต้อง BEFORE INSERT OR UPDATE OR DELETE FOR EACH ROW เปิดอยู่)';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'analytics.content_weekly_summary'::regclass and t.tgname = 'trg_content_weekly_summary_guard' and not t.tgisinternal
                    and t.tgenabled = 'O' and t.tgfoid = 'analytics.content_weekly_summary_guard()'::regprocedure and (t.tgtype & 31) = 31) then
    raise exception '0162 ด่านท้าย: trigger trg_content_weekly_summary_guard ไม่ครบ (ต้อง BEFORE INSERT OR UPDATE OR DELETE FOR EACH ROW เปิดอยู่)';
  end if;
  -- trigger TRUNCATE (statement-level · BEFORE=2 TRUNCATE=32 · ไม่ใช่ ROW) ของ recommendation_log + content_weekly_summary ต้องมี เปิดอยู่ ชี้ฟังก์ชันถูกตัว
  if (select count(*) from pg_trigger t
       where t.tgname in ('trg_recommendation_log_deny_truncate', 'trg_content_weekly_summary_deny_truncate') and not t.tgisinternal
         and t.tgenabled = 'O' and t.tgfoid = 'analytics.content_history_truncate_guard()'::regprocedure and (t.tgtype & 35) = 34
         and t.tgrelid in ('analytics.recommendation_log'::regclass, 'analytics.content_weekly_summary'::regclass)) <> 2 then
    raise exception '0162 ด่านท้าย: trigger กัน TRUNCATE ของ recommendation_log / content_weekly_summary ไม่ครบ (ต้อง BEFORE TRUNCATE FOR EACH STATEMENT เปิดอยู่)';
  end if;
  -- trigger เดิมยังอยู่ครบ (updated_at ของสามตาราง) — ไม่ถูก drop/แทนโดยไฟล์นี้ · recommendation_log / content_weekly_summary = 3 (guard + updated_at + deny_truncate)
  if (select count(*) from pg_trigger t where t.tgrelid = 'analytics.campaign'::regclass and not t.tgisinternal) <> 2
     or (select count(*) from pg_trigger t where t.tgrelid = 'analytics.recommendation_log'::regclass and not t.tgisinternal) <> 3
     or (select count(*) from pg_trigger t where t.tgrelid = 'analytics.content_weekly_summary'::regclass and not t.tgisinternal) <> 3 then
    raise exception '0162 ด่านท้าย: trigger บน campaign ต้องเหลือ 2 (guard + updated_at) · recommendation_log / content_weekly_summary ต้องเหลือตารางละ 3 (guard + updated_at + กัน TRUNCATE)';
  end if;

  -- FK ที่ชี้เข้าประวัติ reco ต้องเป็น SET NULL (confdeltype n) ทั้งสามเส้น — ไม่มี CASCADE ที่ลบแถวประวัติ (บทเรียน 0161 H1)
  select string_agg(c.conname || ':' || c.confdeltype::text, ', ') into v_bad
    from pg_constraint c
   where c.conrelid = 'analytics.recommendation_log'::regclass and c.contype = 'f'
     and c.confrelid in ('analytics.campaign_step'::regclass, 'analytics.content_weekly_summary'::regclass, 'analytics.campaign'::regclass)
     and c.confdeltype <> 'n';
  if v_bad is not null then
    raise exception '0162 ด่านท้าย: FK จาก recommendation_log ต้อง ON DELETE SET NULL: %', v_bad;
  end if;
  if (select count(*) from pg_constraint c where c.conrelid = 'analytics.recommendation_log'::regclass and c.contype = 'f'
         and c.confrelid in ('analytics.campaign_step'::regclass, 'analytics.content_weekly_summary'::regclass, 'analytics.campaign'::regclass)) <> 3 then
    raise exception '0162 ด่านท้าย: FK จาก recommendation_log → campaign / campaign_step / content_weekly_summary ต้องมีครบ 3 เส้น';
  end if;

  -- CHECK ข้ามคอลัมน์ที่เป็นด่านจริงต้องมี · unique index กันซ้ำต้องเป็น partial unique
  select string_agg(x.n, ', ') into v_bad
    from (values ('analytics.campaign'::regclass, 'campaign_metric_scope_needs_orders_check'),
                 ('analytics.campaign'::regclass, 'campaign_result_proposed_consistency_check'),
                 ('analytics.campaign'::regclass, 'campaign_result_confirmed_consistency_check'),
                 ('analytics.campaign'::regclass, 'campaign_pass_pair_check'),
                 ('analytics.campaign'::regclass, 'campaign_metric_dates_check'),
                 ('analytics.recommendation_log'::regclass, 'recommendation_log_deadline_needs_default_check'),
                 ('analytics.content_weekly_summary'::regclass, 'content_weekly_summary_lines_check')) as x (rel, n)
   where not exists (select 1 from pg_constraint c where c.conrelid = x.rel and c.conname = x.n and c.convalidated);
  if v_bad is not null then
    raise exception '0162 ด่านท้าย: CHECK ที่ต้องมีหายหรือยังไม่ validated: %', v_bad;
  end if;
  if not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                  where i.indrelid = 'analytics.recommendation_log'::regclass and c.relname = 'uq_recommendation_log_pending_title'
                    and i.indisunique and i.indpred is not null and i.indisvalid) then
    raise exception '0162 ด่านท้าย: uq_recommendation_log_pending_title ต้องเป็น partial unique index ที่ valid';
  end if;

  -- trap #18: ไม่มี PUBLIC/anon/authenticated ถือ EXECUTE (coalesce proacl — default = PUBLIC execute)
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.pronamespace = 'analytics'::regnamespace and p.proname ~ c_fn and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  if v_bad is not null then
    raise exception '0162 ด่านท้าย: grant รั่ว (PUBLIC/anon/authenticated) บนฟังก์ชัน %', v_bad;
  end if;
  select string_agg(c.relname || ':' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ', ') into v_bad
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.relnamespace = 'analytics'::regnamespace and (c.relname = any (c_rel) or c.relname = 'content_weekly_summary')
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  if v_bad is not null then
    raise exception '0162 ด่านท้าย: grant รั่วบน view/ตาราง: %', v_bad;
  end if;
  -- J: content_weekly_summary — service_role อ่านอย่างเดียว · recommendation_log — ต้องถอน insert/update/delete/truncate แต่ยังอ่านได้
  select string_agg(a.privilege_type, ', ') into v_bad
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.oid = 'analytics.content_weekly_summary'::regclass and a.grantee = 'service_role'::regrole and a.privilege_type <> 'SELECT';
  if v_bad is not null then
    raise exception '0162 ด่านท้าย: service_role เขียนตรงลง content_weekly_summary ได้ (%) — ต้องมีแค่ SELECT', v_bad;
  end if;
  -- ทุกสิทธิ์นอกจาก SELECT (รวม REFERENCES/TRIGGER) ต้องไม่มี — ตรวจจาก ACL ตรง ไม่ผูกรายชื่อสิทธิ์ที่นึกออก
  select string_agg(a.privilege_type, ', ') into v_bad
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.oid = 'analytics.recommendation_log'::regclass and a.grantee = 'service_role'::regrole and a.privilege_type <> 'SELECT';
  if v_bad is not null then
    raise exception '0162 ด่านท้าย: service_role ยังมีสิทธิ์นอกจาก SELECT บน recommendation_log (%) — ต้องถอด (J)', v_bad;
  end if;
  if not has_table_privilege('service_role', 'analytics.recommendation_log'::regclass, 'SELECT')
     or not has_table_privilege('service_role', 'analytics.content_weekly_summary'::regclass, 'SELECT')
     or not has_table_privilege('service_role', 'analytics.v_campaign_summary'::regclass, 'SELECT')
     or not has_table_privilege('service_role', 'analytics.v_recommendation_inbox'::regclass, 'SELECT') then
    raise exception '0162 ด่านท้าย: service_role ต้องยังอ่าน recommendation_log / content_weekly_summary / view ใหม่ได้ (SELECT)';
  end if;
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c
   where c.relnamespace = 'analytics'::regnamespace and c.relname = any (c_rel)
     and not coalesce(c.reloptions @> array['security_invoker=true'], false);
  if v_bad is not null then
    raise exception '0162 ด่านท้าย: view ไม่ได้เป็น security_invoker: %', v_bad;
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'analytics.content_weekly_summary'::regclass) then
    raise exception '0162 ด่านท้าย: content_weekly_summary ไม่ได้เปิด RLS';
  end if;

  -- view ต้อง "รันได้จริง" (ambiguous ref / ชนิดไม่ตรงในแขน union โผล่ตอนวางแผน ไม่ใช่ตอน create) · จำนวนแถวต้องสมเหตุผล
  select count(*) into v_n from analytics.v_campaign_summary;
  if v_n <> (select count(*) from analytics.campaign) then
    raise exception '0162 ด่านท้าย: v_campaign_summary ต้องมี 1 แถวต่อแคมเปญทุกแถว (view % · campaign %)', v_n, (select count(*) from analytics.campaign);
  end if;
  select count(*) into v_n from analytics.v_recommendation_inbox where item_kind = 'reco';
  if v_n <> (select count(*) from analytics.recommendation_log) then
    raise exception '0162 ด่านท้าย: v_recommendation_inbox แขน reco ต้องมีทุกแถวของ recommendation_log (view % · log %)', v_n, (select count(*) from analytics.recommendation_log);
  end if;

  -- N18: วันไทย — ไม่มี current_date ใน view/ฟังก์ชันใหม่ · ที่คิดวันต้องมี Asia/Bangkok
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c where c.relnamespace = 'analytics'::regnamespace and c.relname = any (c_rel) and pg_get_viewdef(c.oid) ~* 'current_date';
  if v_bad is not null then
    raise exception '0162 ด่านท้าย: view มี current_date (วันไทยเท่านั้น): %', v_bad;
  end if;
  if pg_get_viewdef('analytics.v_recommendation_inbox'::regclass) !~ 'Asia/Bangkok' then
    raise exception '0162 ด่านท้าย: v_recommendation_inbox ต้องใช้ Asia/Bangkok';
  end if;
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname ~ c_fn and pg_get_functiondef(p.oid) ~* 'current_date';
  if v_bad is not null then
    raise exception '0162 ด่านท้าย: ฟังก์ชันมี current_date: %', v_bad;
  end if;
  if pg_get_functiondef('analytics.campaign_plan_set(uuid,uuid,jsonb,text)'::regprocedure) !~ 'Asia/Bangkok'
     or pg_get_functiondef('analytics.campaign_verdict_confirm(uuid,uuid,text,text,text,text,text,text)'::regprocedure) !~ 'Asia/Bangkok'
     or pg_get_functiondef('analytics.recommendation_create(uuid,text,text,text,text,text,integer,date,text,uuid,uuid,uuid)'::regprocedure) !~ 'Asia/Bangkok'
     or pg_get_functiondef('analytics.recommendation_respond(uuid,uuid,text,text,text,text)'::regprocedure) !~ 'Asia/Bangkok'
     or pg_get_functiondef('analytics.content_weekly_summary_upsert(uuid,date,date,text[],text,text,integer,text)'::regprocedure) !~ 'Asia/Bangkok' then
    raise exception '0162 ด่านท้าย: RPC ที่คิดวันต้องใช้ Asia/Bangkok';
  end if;

  raise notice '0162 ด่านท้าย: ผ่าน — ของเดิมไม่ขยับ (metric/post/step/campaign/reco/gate/view/ฟังก์ชัน รวม 0148-0161) · ไม่มี overload · trigger ครบ · FK SET NULL · '
               'grant สะอาด · service_role เขียน reco/summary ตรงไม่ได้ · view รันได้จริง · วันไทย';
end
$c5final$;

-- ให้ PostgREST รู้จักฟังก์ชัน/view ใหม่ทันที — ใน dry-run ที่ ROLLBACK ไม่ถูกส่งออกไป
notify pgrst, 'reload schema';

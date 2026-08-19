-- 0067_oem_sprue_question_pre_polish.sql
-- Code review caught the one way 0066 could create a NEW bug in the opposite
-- direction of the one it fixed.
--
-- 0066 split metal loss into two questions that must not overlap:
--   sprue_loss_pct  — metal in the gate/sprue, measured BEFORE polishing
--   polish_loss_pct — metal lost AS polishing dust
-- Its own header states "sprue is measured pre-polish". But the question the
-- owner actually reads was written in 0061, before polish_loss_pct existed:
--
--     "ต้นเทียน 1 ต้นหนักเท่าไหร่ ชิ้นงานรวมกันหนักเท่าไหร่"
--
-- "ชิ้นงาน" there is ambiguous: pre-polish or post-polish? The weight an owner
-- has actually got written down — and will answer with — is the finished one,
-- because that is what gets weighed and sold. Answer it that way and the
-- polish loss lands inside sprue_loss_pct AND again in polish_loss_pct, so the
-- formula charges it twice and prices drift UP with nothing on screen to show
-- why. Same failure class as the bug 0066 fixed: a number whose meaning is
-- only defined in a comment nobody reads at fill-in time.
--
-- Fix is to the question text, not the schema. The wording now names the
-- measuring point and explicitly sends the polish gap to the other field.

update analytics.oem_rate_def set
  label_th = 'น้ำหนักก้านต้น/sprue (% ของน้ำหนักชิ้น — วัดก่อนขัด)',
  question_th = 'ต้นเทียน 1 ต้นหนักเท่าไหร่ · ชิ้นงานรวมกัน "หลังตัดต้น แต่ยังไม่ขัด" หนักเท่าไหร่ (ห้ามใช้น้ำหนักหลังขัด — ส่วนที่หายตอนขัดไปกรอกช่อง "โลหะที่หายตอนแต่ง/ขัด")'
where rate_key = 'sprue_loss_pct';

notify pgrst, 'reload schema';

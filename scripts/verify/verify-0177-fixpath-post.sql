-- scripts/verify/verify-0177-fixpath-post.sql — ส่วน "หลัง migration" ของชุดทดสอบทางแก้ใบเดิม (0177 §5) · ดู verify-0177-fixpath-pre.sql
-- ผลออกทาง error message (self-rolling-back) · [FAIL] >= 1 = ไม่ผ่าน
--
-- ตารางแมป "สิ่งที่ต้องตรวจ -> เทสต์":
--   ใบ a (เปิด ไม่ override): basis.sprue_loss_pct x100 · computed_g/metal_plan_g คำนวณใหม่ · job_plan_basis_assert ผ่าน · updated_at/status ไม่ขยับ -> FX1
--   ใบ b (override): override_g/reason/metal_plan_g ไม่แตะ · computed_g คำนวณใหม่ -> FX2
--   ใบ c (cancelled): ปล่อยไว้ทุกอย่าง (sprue เดิม · plan เดิม · updated_at เดิม) -> FX3
--   ใบ d (ไม่มี rate ก้านต้น): ไม่ถูกแตะ (sprue null · plan null · missing ยังอยู่) -> FX4
--   trigger เปิดกลับ · ไม่มี trigger ผิดสถานะ -> FX5
--   ต้องไม่พัง: ใบ a แก้จำนวน/แผนต่อได้ (ไม่ชน plan_drift) ผลถูกหน่วย · override ใบ b ล้างแล้วคำนวณถูกหน่วย -> FX6 FX7
--   ❌ ไม่มีเทสต์ครอบ: ใบ done / ขั้นหล่อรับแล้ว (สร้างต้องเดินครบทุกขั้น — โค้ดแก้ไม่แยกสถานะ) · ใบที่แผนเกิน 100,000 g หลังแก้ (raise ใน migration — ยิงไม่ได้โดยไม่ตั้ง rate ผิดปกติ) · การรันซ้ำไม่คูณ 100 ซ้ำ (ทดสอบแยกด้วยการรัน migration 2 รอบ)

do $post$
declare
  v_shop uuid := (select id from public.shop order by created_at limit 1);
  v_sp numeric := (select sprue0 from _fx where k = 'a');  -- สัดส่วนเดิมที่ผิดหน่วย (0.05)
  v_log text := (select l from _fx_log limit 1);
  j analytics.job; x record; r jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  -- ใบ a
  select * into x from _fx where k = 'a'; select * into j from analytics.job where id = x.job_id;
  v_log := v_log || pg_temp.chk('FX1', format('ใบ a: sprue_loss_pct = %s (x100) · computed_g = metal_plan_g = %s · assert ผ่าน · updated_at/status ไม่ขยับ', v_sp * 100, round(30 * 4.000 * (1 + v_sp), 3)),
    (j.metal_plan_basis ->> 'sprue_loss_pct')::numeric = v_sp * 100 and j.metal_plan_g = round(30 * 4.000 * (1 + v_sp), 3)
    and (j.metal_plan_basis ->> 'computed_g')::numeric = j.metal_plan_g and pg_temp.assert_ok(j.id)
    and j.updated_at = x.upd0 and j.status = x.status0 and j.qty_planned = 30 and j.target_piece_g = 4.000
    and jsonb_typeof(j.metal_plan_basis -> 'override_g') = 'null' and (j.metal_plan_basis ->> 'target_source') = 'input');
  -- ใบ b
  select * into x from _fx where k = 'b'; select * into j from analytics.job where id = x.job_id;
  v_log := v_log || pg_temp.chk('FX2', 'ใบ b (override): metal_plan_g = 200 และ override_g/reason เดิม · computed_g คำนวณใหม่ตามหน่วยถูก · sprue x100 · assert ผ่าน · updated_at ไม่ขยับ',
    j.metal_plan_g = 200 and (j.metal_plan_basis ->> 'override_g')::numeric = 200 and (j.metal_plan_basis ->> 'override_reason') = 'verify กำหนดเองโลหะ'
    and (j.metal_plan_basis ->> 'sprue_loss_pct')::numeric = v_sp * 100 and (j.metal_plan_basis ->> 'computed_g')::numeric = round(30 * 4.000 * (1 + v_sp), 3)
    and pg_temp.assert_ok(j.id) and j.updated_at = x.upd0);
  -- ใบ c
  select * into x from _fx where k = 'c'; select * into j from analytics.job where id = x.job_id;
  v_log := v_log || pg_temp.chk('FX3', 'ใบ c (cancelled): ปล่อยไว้ — sprue เดิม (ผิดหน่วย) · plan เดิม · updated_at เดิม',
    j.status = 'cancelled' and (j.metal_plan_basis ->> 'sprue_loss_pct')::numeric = x.sprue0 and j.metal_plan_g = x.plan0 and j.updated_at = x.upd0);
  -- ใบ d
  select * into x from _fx where k = 'd'; select * into j from analytics.job where id = x.job_id;
  v_log := v_log || pg_temp.chk('FX4', 'ใบ d (ไม่มี rate ก้านต้น): ไม่ถูกแตะ — sprue null · plan null · missing ยังอยู่ · updated_at เดิม',
    jsonb_typeof(j.metal_plan_basis -> 'sprue_loss_pct') = 'null' and j.metal_plan_g is null and jsonb_array_length(j.metal_plan_basis -> 'missing') = 1 and j.updated_at = x.upd0);
  v_log := v_log || pg_temp.chk('FX5', 'trigger บน job/job_stage/job_event เปิดครบ (trg_job_guard กลับมาเปิดหลังแก้)',
    exists (select 1 from pg_trigger where tgrelid = 'analytics.job'::regclass and tgname = 'trg_job_guard' and tgenabled = 'O')
    and not exists (select 1 from pg_trigger t where t.tgrelid in ('analytics.job'::regclass, 'analytics.job_stage'::regclass, 'analytics.job_event'::regclass) and not t.tgisinternal and t.tgenabled <> 'O'));
  -- ต้องไม่พัง
  select * into x from _fx where k = 'a';
  r := pg_temp.q(format('select analytics.job_qty_planned_set(p_shop_id=>%L, p_job_id=>%L, p_qty_planned=>40, p_actor=>%L)', v_shop, x.job_id, '00000000-0000-0000-0000-0000000000a1'::uuid));
  select * into j from analytics.job where id = x.job_id;
  v_log := v_log || pg_temp.chk('FX6', 'ใบ a หลังแก้: job_qty_planned_set 40 ผ่าน (ไม่ชน plan_drift) -> แผน = round(40 x 4 x (1+sprue), 3)',
    not (r ? '_err') and j.qty_planned = 40 and j.metal_plan_g = round(40 * 4.000 * (1 + v_sp), 3) and pg_temp.assert_ok(j.id));
  select * into x from _fx where k = 'b';
  r := pg_temp.q(format('select analytics.job_plan_set(p_shop_id=>%L, p_job_id=>%L, p_target_piece_g=>4.000, p_actor=>%L)', v_shop, x.job_id, '00000000-0000-0000-0000-0000000000a1'::uuid));
  select * into j from analytics.job where id = x.job_id;
  v_log := v_log || pg_temp.chk('FX7', 'ใบ b หลังแก้: job_plan_set ล้าง override -> แผน = 30 x 4 x (1+sprue) ตามหน่วยถูก · target_source เดิม input',
    not (r ? '_err') and j.metal_plan_g = round(30 * 4.000 * (1 + v_sp), 3) and (j.metal_plan_basis ->> 'sprue_loss_pct')::numeric = v_sp * 100 and pg_temp.assert_ok(j.id));

  v_log := v_log || format(E'\n=== สรุป fixpath: [FAIL] = %s %s ===\n', (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6,
    case when position('[FAIL]' in v_log) = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception E'%', v_log;
end;
$post$;

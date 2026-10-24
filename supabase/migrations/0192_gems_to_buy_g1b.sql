-- 0192_gems_to_buy_g1b.sql — G1b "พลอยที่ต้องสั่งซื้อ": สรุปยอดพลอยที่ใบงานต้องใช้ข้ามใบที่ยังไม่ได้ฝัง + ติ๊ก "สั่งแล้ว" (เก็บจำนวน ณ ตอนติ๊ก) กันสั่งซ้ำ + ต้นทุนประมาณ (owner/admin เท่านั้น · RPC แยก)
-- สถานะ: ยังไม่ apply · dry-run เท่านั้น · apply ด้วย node scripts/run-sql.mjs --commit --record เท่านั้น (🔴 ห้าม supabase db push) · ชุดทดสอบ scripts/verify/verify-0192.sql · ไฟล์ต้องเป็น LF (ข้อ 20)
-- 🔴 ราคาพลอย = ต้นทุน (ต้นทุนประมาณคิดจากราคา) → security 💰 ก่อน merge · ลำดับ deploy: dry-run 0192 + verify-0192 (ต่อเป็นไฟล์เดียว ไม่ใส่ --commit) → apply --commit --record → verify-0192 + verify-0190 + verify-0191 + `node scripts/run-sql.mjs scripts/check-analytics-grants.sql` → แล้วค่อย merge โค้ด TS (merge TS ก่อน apply = action ใหม่เรียก RPC ที่ยังไม่มี → หน้าสรุปล้ม ไม่กระทบหน้าอื่น)
-- design: docs/3j-jewelry/oms/design-job-plan-metal-gems.md §2.5 (v_gem_purchase_summary เดิม) + §9.7 (มติเจ้าของ 24 ต.ค. ทับ) · UX: docs/3j-jewelry/oms/ux-gems-to-buy.md §9 (H1-H8) · ต่อจาก 0190 (job_gem_bom snapshot · gem_item_price · gem_require_office) และ 0191
--
-- ทำไม (ภาษาคน): เจ้าของอยากรู้ว่า "ตอนนี้ใบงานต้องใช้พลอยอะไร กี่เม็ด" โดยรวมจากใบที่ช่างยังไม่ได้ฝัง — ไม่นับสต็อกพลอย (ยอดนี้คือ gross: คนสั่งต้องเทียบกับของที่มีเองก่อน) · ติ๊ก "สั่งแล้ว" ได้เพื่อกันสั่งซ้ำ ·
--   ไม่เผื่อแตก (0%) · ราคาไม่อยู่ในยอด (ส่งต่อให้ร้านพลอยได้) — ต้นทุนประมาณแยก RPC ที่ owner/admin เท่านั้น
--
-- สิ่งที่ไฟล์นี้ทำ
--  1. job_gem_bom + ordered_at · ordered_by · ordered_qty (ติ๊ก "สั่งแล้ว" ระดับแถว job × รายการ · ordered_qty = จำนวนเม็ดรวม ณ ตอนติ๊ก = qty_at_order ของ UX H1) + CHECK ทั้งสามค่าไป/มาพร้อมกัน · ไม่มี UPDATE แถวเดิม (ADD COLUMN ไม่ยิง trigger)
--  2. gem_purchase_mark_log (append-only · ไม่มีสิทธิ์ให้ role ฝั่งแอป) — ทุกการติ๊ก/ยกเลิกติ๊ก + แถวที่ติ๊กไว้ถูกลบ (trigger job_gem_bom_ordered_log)
--  3. view v_gem_purchase_job (ใบที่ "ขั้นฝังยังไม่รับ" — นิยามที่เดียว) · v_gem_purchase_line (แถวพลอยของใบนั้น + จำนวนที่ใช้/สั่งแล้ว/ที่เหลือ) · v_gem_purchase_summary (รวมต่อ canonical gem_item) — ไม่มีคอลัมน์ราคา · ไม่เรียกฟังก์ชันของ schema · ไม่ให้ role ฝั่งแอปอ่านตรง
--  4. RPC (security definer · service_role เท่านั้น · actor ต้องเป็นสมาชิก owner/admin ของร้านจริง ผ่าน gem_require_office): gem_purchase_summary (ไม่มีราคา) · gem_purchase_mark · gem_purchase_summary_cost (ราคา — RPC เดียว)
--  5. ไม่ replace ฟังก์ชันเดิมตัวใดเลย (post-check: md5 ของฟังก์ชันเดิมทุกตัวเท่าเดิม) → job_gem_bom_get / replace_core / หน้าช่าง / A5 / W3 ไม่ขยับ
--
-- นิยาม "ใบที่ขั้นฝังยังไม่รับ" (ที่เดียว = v_gem_purchase_job · รหัสขั้นฝังบน DB คือ gem_set — ยืนยันจาก seed job_stage_def ของ 0172 และ job_gem_state ของ 0190 · UX H7)
--   ใบแม่ (parent_job_id is null — ส่วนย่อยไม่มี BOM ของตัวเอง จึงไม่นับซ้ำแม่+ส่วนย่อย) · status open/in_progress/on_hold (done/cancelled ไม่นับ — กัน R8: ใบยกเลิกแล้วสร้างใหม่ไม่นับซ้ำ)
--   และขั้นฝัง gem_set ในต้นไม้ (ใบแม่+ส่วนย่อย) "ยังไม่รับ" = มีขั้น gem_set pending อย่างน้อย 1 ขั้น และไม่มีขั้น gem_set ใดเป็น received/sent
--   = ตรงกับ gem_stage = 'pending' ของ job_gem_bom_get (ขั้น skipped ล้วน = ไม่ต้องใช้พลอย → ไม่นับ) · ตรงกับ job_gem_edit_window (reason_required = ขั้นฝังถูกรับแล้ว)
--   ⚠️ job_gem_state ตอบแค่ specified/unspecified/not_needed (นับ received เป็น "ยังเปิด") ใช้แทน "ยังไม่รับ" ไม่ได้ — นิยาม pending อยู่ inline ใน job_gem_bom_get จึงลอกเงื่อนไขเดียวกัน (ไม่ใช่เขียนกติกาใหม่) · verify-0192 พิสูจน์ว่าตรงกันทุกสถานะขั้นฝัง
--   unspecified_jobs (UX H5) = ใบในนิยามนี้ที่ไม่มีแถวพลอยเลย (ใช้ view เดียวกัน)
--
-- ตัดสินเอง (นอก design/brief — เหตุผล)
--  (1) ติ๊กเก็บ ordered_qty (จำนวนเม็ดรวม ณ ตอนติ๊ก) และ "ไม่ล้มติ๊กเมื่อจำนวนเปลี่ยน" (ทับข้อเสนอเดิม "จำนวนเปลี่ยน → ล้างติ๊ก" ตาม UX H1) — ใบแก้จำนวนเริ่มผลิต/จำนวนต่อชิ้นได้จนขั้นแรกรับ: สั่งไว้ 70 ใบเพิ่มเป็น 90 → ที่เหลือ = 20 (ไม่ใช่ 90: ล้างติ๊กแล้วจะสั่งซ้ำ 70) ·
--      ต่อแถว: qty_needed_now = qty_per_piece × qty_planned · qty_ordered = ordered_qty (0 ถ้าไม่ติ๊ก) · qty_remaining = max(needed − ordered, 0) · qty_excess = max(ordered − needed, 0) · changed_after_order = ติ๊กอยู่และ ordered_qty ≠ needed ·
--      ไม่เผื่อแตก (qty_planned มีเผื่อชิ้นอยู่แล้ว — มติเจ้าของ) · ติ๊กซ้ำบนแถวที่ changed = ปรับ ordered_qty เป็นยอดปัจจุบัน (สั่งส่วนต่างแล้ว) · ยกเลิกติ๊ก = ล้างทั้งแถว (ที่เหลือกลับเป็นยอดเต็ม)
--  (2) audit = ตารางเฉพาะ gem_purchase_mark_log ไม่ใช่ job_event — การติ๊กข้ามหลายใบ ไม่ใช่เหตุการณ์ของใบเดียว · ไม่แตะ job_event_event_type_ck · ไม่มีสิทธิ์ให้ role ฝั่งแอปอ่านตรง (ยังไม่มี UI ดูประวัติ — เพิ่ม RPC อ่านเมื่อต้องใช้) ·
--      แถวที่ติ๊กไว้ถูกลบ (replace_core เอารายการออกจากใบ) = log action line_removed (ของที่สั่งไปแล้วของรายการนั้นหายจากยอดเงียบๆ ไม่ได้ — ต้องมีร่องรอย)
--  (3) ติ๊ก/ยกเลิกติ๊กรับ line_ids (uuid[] จาก summary — 1 line = 1 ใบ × 1 gem_item_id ใน snapshot) ตามบรีฟ Tech Lead · UX H2 ขอ (job_id, gem_item_id)[] — gem_item_id ใน snapshot อาจต่างจาก canonical ที่จอเห็นหลังรวมชื่อ จึงใช้ id ของแถวที่ view ส่งให้ตรงๆ (ไม่กำกวม)
--      ติ๊ก/ยกเลิกได้เฉพาะแถวที่อยู่ใน v_gem_purchase_line — ขั้นฝังรับแล้ว = gem_stage_started · ใบ done/cancelled = job_closed · ไม่พบ/ร้านอื่น = purchase_line_not_found (ข้อความเดียวกัน ไม่บอกว่ามีจริงไหม) ·
--      all-or-nothing: แถวไหนผิด = ไม่ติ๊กอะไรเลย (UX H2 ขอ "คืนรายการที่ถูกข้าม" ด้วย — ขัดกับ all-or-nothing ที่บรีฟสั่ง จึงเลือก all-or-nothing + ผลคืนสถานะสดของทุกแถวที่ส่งมา · ใบปิดระหว่างที่จอเปิดอยู่ = ล้มทั้งชุด จอโหลดใหม่) ·
--      ส่งซ้ำ (ติ๊กแถวที่ติ๊กแล้วและตรงยอด/ยกเลิกแถวที่ไม่ได้ติ๊ก) = ไม่ error ไม่เขียน log (changed = 0)
--  (4) ต้นทุนประมาณ: ราคา "ล่าสุด ณ วันนี้ไทย" (effective_from <= วันนี้) ของ gem_item_id ใน snapshot ของแถว (ไม่ใช่ canonical — รวมชื่อ A→B แล้วราคาของ A ไม่ย้ายตามไป · แถวของ A ใช้ราคา A) · ไม่มีราคา (รวมราคาที่มีผลในอนาคตอย่างเดียว) =
--      null + missing_price (ไม่เดา · ไม่ใช้ 0) · ส่วน (ที่เหลือ/สั่งแล้ว) ที่มีแถวไม่มีราคาแม้แถวเดียว = cost ของส่วนนั้นเป็น null ทั้งก้อน · แถวที่จำนวนส่วนนั้น = 0 ไม่ต้องมีราคา ·
--      cost_*_thb ปัด 2 ตำแหน่งต่อกลุ่มที่ DB · totals = ผลรวมของค่าที่ปัดแล้ว (ผลบวกแถว = ยอดรวมเป๊ะ) เฉพาะกลุ่มที่ราคาครบ + complete=false ถ้ามีกลุ่มไม่มีราคา
--  (5) นิยาม "จำนวนใบ" = นับใบแม่ไม่ซ้ำ (ใบที่ติ๊กครบแล้วนับด้วย) · earliest_due = ครบกำหนดเร็วสุดของใบทั้งหมดในกลุ่ม · earliest_due_remaining = เฉพาะใบที่ยังมียอดเหลือ (ใช้ตัดสินว่าสั่งอะไรก่อน)
--  (6) กลุ่มที่ติ๊กครบทุกใบ (remaining = 0) ยังอยู่ในผล — จอต้องหาเจอเพื่อยกเลิกติ๊กได้ (มติ "ที่ติ๊กแล้วหายจากยอดต้องสั่ง" = หายจาก qty_remaining ไม่ใช่หายจากรายการ)
--  (7) ordered_by = id ผู้ใช้ (uuid) ไม่ใช่ชื่อแสดง — shop_member ไม่มีชื่อ และไม่อ่าน auth.users (อีเมล = PII) ใน RPC · จอแสดง "โดยคุณ/คนอื่น" เทียบกับ session หรือขอ map ชื่อแยก
--  (8) ใบที่ถูกยกเลิก/สร้างใหม่ (R8): ติ๊กของใบเก่าไม่ย้ายไปใบใหม่ — ใบใหม่ต้องติ๊กเอง (ระบบไม่รู้ว่าพลอยที่สั่งไปแล้วเป็นของใบเก่า) · หนี้ที่รู้ ระบุในรายงาน
--
--  (9) [security M1] ติ๊กซ้ำทับยอดลงไม่ได้: ordered_qty = max(ที่ติ๊กไว้, ที่ต้องใช้ตอนนี้) · อัปเดตเฉพาะ (ยังไม่ติ๊ก หรือ ที่ต้องใช้ > ที่ติ๊กไว้) · log เก็บ prev_qty · ใบลดจาก 90 เป็น 70 แล้วกด "ติ๊กทั้งรายการ" = ยังสั่งไว้ 90 (qty_excess 20 ไม่หายเงียบ)
--  (10) [security M2] ติ๊กไว้แล้วแถวถูกลบ (replace_core/W3) แล้วเพิ่มกลับ = แถวใหม่ไม่มีติ๊ก → gem_purchase_summary คืน removed_after_order[] (จาก log line_removed ของใบที่ยังอยู่ · ไม่แสดงถ้ามีแถวรายการเดียวกันที่ติ๊กแล้ว) ให้จอเตือน — ข้อ (8) ใบยกเลิกแล้วสร้างใหม่ยังเป็นหนี้
--  (11) [security L1] ordered_* เขียนได้ทางเดียวคือ gem_purchase_mark: trigger job_gem_bom_ordered_only (GUC analytics.gem_purchase_mark = on แบบ local) — UPDATE/INSERT ตรง แม้ในนาม postgres = 42501
--  (12) [security L2] view ทั้ง 3 security_invoker=true
--
-- 🔴 ไม่มีราคา/ต้นทุน (แม้เป็น null) ใน object ใดนอกจาก gem_purchase_summary_cost · post-check บังคับว่า view/ตารางไหนมีคอลัมน์ราคา = ล้ม

-- baseline: ฟังก์ชันทุกตัวในสคีมา (md5) + ตัวชี้วัดแถวของตารางที่เกี่ยวข้อง (เฉพาะคอลัมน์เดิม — ADD COLUMN ไม่แตะค่าเดิม)
create temp table _m192_fn_base on commit drop as
select p.oid::regprocedure::text as sig, p.proname, md5(pg_get_functiondef(p.oid)) as h
from pg_proc p
where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f';

create temp table _m192_row_base on commit drop as
select 'job_gem_bom'::text as t, count(*) as n, count(distinct g.updated_at) as d,
       coalesce(md5(string_agg(g.id::text || '|' || g.shop_id::text || '|' || g.job_id::text || '|' || g.line_seq::text || '|' || g.gem_item_id::text || '|' || g.gem_label || '|' || g.qty_per_piece::text
                               || '|' || coalesce(g.position_note, '') || '|' || g.source || '|' || g.created_at::text || '|' || g.updated_at::text, ',' order by g.id)), '') as h
  from analytics.job_gem_bom g
union all
select 'job', count(*), count(distinct j.updated_at), coalesce(md5(string_agg(j::text, '|' order by j.id)), '') from analytics.job j
union all
select 'job_stage', count(*), count(distinct s.updated_at), coalesce(md5(string_agg(s::text, '|' order by s.id)), '') from analytics.job_stage s
union all
select 'gem_item_price', count(*), 0, coalesce(md5(string_agg(p::text, '|' order by p.gem_item_id, p.effective_from)), '') from analytics.gem_item_price p;

-- ============================================================================
-- 0. pre-check
-- ============================================================================
do $p$
declare
  v_n int;
  r record;
begin
  perform 1 from pg_temp._m192_fn_base limit 1;  -- รันแบบ autocommit ตารางหาย ⇒ ล้มก่อน DDL ใดๆ
  if to_regclass('analytics.job') is null or to_regclass('analytics.job_stage') is null or to_regclass('analytics.job_gem_bom') is null
     or to_regclass('analytics.gem_item') is null or to_regclass('analytics.gem_item_price') is null or to_regclass('public.shop') is null then
    raise exception '0192: ไม่พบตารางที่ต้องใช้ (job · job_stage · job_gem_bom · gem_item · gem_item_price · shop) — apply 0190/0191 ก่อน';
  end if;
  if to_regprocedure('analytics.gem_require_office(uuid,uuid)') is null
     or to_regprocedure('analytics.job_today()') is null
     or to_regprocedure('analytics.job_append_only()') is null
     or to_regprocedure('analytics.job_deny_truncate()') is null
     or to_regprocedure('analytics.job_gem_bom_guard()') is null then
    raise exception '0192: ไม่พบฟังก์ชันที่ต้องใช้ (gem_require_office · job_today · job_append_only · job_deny_truncate · job_gem_bom_guard) — apply 0190 ก่อน';
  end if;
  -- คอลัมน์ที่ view/RPC อ่าน (plpgsql ไม่ตรวจชื่อคอลัมน์ตอน create — ตรวจที่นี่ให้ล้มก่อน DDL)
  select count(*) into v_n from information_schema.columns
   where table_schema = 'analytics' and table_name = 'job'
     and column_name in ('id', 'shop_id', 'status', 'parent_job_id', 'qty_planned', 'job_no', 'due_date', 'design_label', 'updated_at');
  if v_n <> 9 then raise exception '0192: คอลัมน์ของ analytics.job ไม่ครบตามที่ใช้ (พบ % จาก 9)', v_n; end if;
  select count(*) into v_n from information_schema.columns
   where table_schema = 'analytics' and table_name = 'job_gem_bom'
     and column_name in ('id', 'shop_id', 'job_id', 'line_seq', 'gem_item_id', 'gem_label', 'qty_per_piece', 'position_note', 'source', 'created_at', 'updated_at');
  if v_n <> 11 then raise exception '0192: คอลัมน์ของ analytics.job_gem_bom ไม่ใช่โครงของ 0190 (พบ % จาก 11)', v_n; end if;
  select count(*) into v_n from information_schema.columns
   where table_schema = 'analytics' and table_name = 'job_stage' and column_name in ('job_id', 'shop_id', 'stage_code', 'status', 'updated_at');
  if v_n <> 5 then raise exception '0192: คอลัมน์ของ analytics.job_stage ไม่ครบ (พบ % จาก 5)', v_n; end if;
  select count(*) into v_n from information_schema.columns
   where table_schema = 'analytics' and table_name = 'gem_item_price' and column_name in ('gem_item_id', 'shop_id', 'effective_from', 'price_thb_per_unit');
  if v_n <> 4 then raise exception '0192: คอลัมน์ของ analytics.gem_item_price ไม่ครบ (พบ % จาก 4)', v_n; end if;
  select count(*) into v_n from information_schema.columns
   where table_schema = 'analytics' and table_name = 'gem_item' and column_name in ('id', 'shop_id', 'gem_type_id', 'gem_shape_id', 'size_a', 'size_b', 'size_label', 'merged_into');
  if v_n <> 8 then raise exception '0192: คอลัมน์ของ analytics.gem_item ไม่ครบ (พบ % จาก 8)', v_n; end if;
  -- รหัสขั้นฝังบน DB ต้องเป็น gem_set จริง (UX H7 — ยืนยันจาก job_stage_def ของร้านที่มีอยู่ ถ้ามีร้านที่ seed แล้ว)
  if exists (select 1 from analytics.job_stage_def) and not exists (select 1 from analytics.job_stage_def d where d.code = 'gem_set') then
    raise exception '0192: ไม่พบรหัสขั้น gem_set ใน job_stage_def — รหัสขั้นฝังพลอยบน DB ไม่ตรงกับที่ view ผูกไว้ · หยุด';
  end if;
  -- ชื่อ object ใหม่ต้องยังไม่ถูกใช้ผิดประเภท · ห้ามมี overload ค้างของ RPC ใหม่
  for r in select * from (values ('gem_purchase_summary'), ('gem_purchase_mark'), ('gem_purchase_summary_cost'), ('job_gem_bom_ordered_log'), ('job_gem_bom_ordered_only')) as t(fname) loop
    select count(*) into v_n from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = r.fname;
    if v_n > 1 then
      raise exception '0192: % มี % signature (ต้องไม่เกิน 1) — หยุดตรวจ overload ก่อน', r.fname, v_n;
    end if;
  end loop;
  if to_regclass('analytics.gem_purchase_mark_log') is not null
     and not exists (select 1 from information_schema.columns where table_schema = 'analytics' and table_name = 'gem_purchase_mark_log' and column_name = 'line_id') then
    raise exception '0192: analytics.gem_purchase_mark_log มีอยู่แล้วแต่ไม่ใช่โครงของ 0192 — หยุด';
  end if;
  raise notice '0192: แถวพลอยในใบเดิม % แถว · ไม่มี UPDATE แถวเดิมในไฟล์นี้', (select count(*) from analytics.job_gem_bom);
end;
$p$;

-- ============================================================================
-- 1. คอลัมน์ติ๊ก "สั่งแล้ว" ที่ job_gem_bom (ระดับแถว job × รายการ)
--    ordered_qty = จำนวนเม็ดรวมของแถว ณ ตอนติ๊ก (qty_per_piece × qty_planned) — จำนวนที่สั่งไปจริง ไว้หาส่วนต่างเมื่อใบเปลี่ยนทีหลัง (ตัดสินเอง 1)
--    ADD COLUMN ไม่ยิง trigger ไม่ขยับ updated_at ของแถวเดิม (ข้อ 19) · ทั้งสามค่าไป/มาพร้อมกัน (CHECK ที่ตาราง ไม่พึ่ง RPC)
-- ============================================================================
alter table analytics.job_gem_bom add column if not exists ordered_at timestamptz;
alter table analytics.job_gem_bom add column if not exists ordered_by uuid;
alter table analytics.job_gem_bom add column if not exists ordered_qty bigint;

do $k$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'analytics.job_gem_bom'::regclass and conname = 'job_gem_bom_ordered_ck') then
    alter table analytics.job_gem_bom add constraint job_gem_bom_ordered_ck
      check (num_nonnulls(ordered_at, ordered_by, ordered_qty) in (0, 3) and (ordered_qty is null or ordered_qty > 0));
  end if;
end;
$k$;

-- ============================================================================
-- 2. gem_purchase_mark_log — ประวัติการติ๊ก (append-only · ไม่มี FK ไปรายการ/แถว: รายการที่ลบแล้ว log ยังอยู่ · ไม่มีราคา)
--    actor ว่างได้เฉพาะ line_removed (ระบบทำเอง) — ordered/unordered ต้องมีผู้ทำ
-- ============================================================================
create table if not exists analytics.gem_purchase_mark_log (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shop (id) on delete restrict,
  job_id      uuid not null,
  line_id     uuid not null,
  gem_item_id uuid not null,
  qty         bigint not null check (qty > 0),
  prev_qty    bigint check (prev_qty is null or prev_qty > 0),   -- เฉพาะ ordered: ยอดที่ติ๊กไว้ก่อนหน้า (null = ติ๊กครั้งแรก) — security M1
  action     text not null check (action in ('ordered', 'unordered', 'line_removed')),
  actor       uuid,
  recorded_at timestamptz not null default now(),
  constraint gem_purchase_mark_log_job_fk foreign key (job_id, shop_id) references analytics.job (id, shop_id) on delete restrict,
  constraint gem_purchase_mark_log_actor_ck check (action = 'line_removed' or actor is not null)
);
create index if not exists idx_gem_purchase_mark_log_job on analytics.gem_purchase_mark_log (shop_id, job_id, recorded_at);
alter table analytics.gem_purchase_mark_log enable row level security;
-- ไม่มี policy: anon/authenticated ไม่มีสิทธิ์ทั้งตารางและสคีมา (ข้อ 18) · สิทธิ์ตั้งท้ายไฟล์ (ข้อ 7)

drop trigger if exists trg_gem_purchase_mark_log_append_only on analytics.gem_purchase_mark_log;
create trigger trg_gem_purchase_mark_log_append_only before update or delete on analytics.gem_purchase_mark_log for each row execute function analytics.job_append_only();
drop trigger if exists trg_gem_purchase_mark_log_deny_truncate on analytics.gem_purchase_mark_log;
create trigger trg_gem_purchase_mark_log_deny_truncate before truncate on analytics.gem_purchase_mark_log for each statement execute function analytics.job_deny_truncate();

-- ============================================================================
-- 3. trigger: แถวที่ติ๊กไว้ถูกลบ = log (ของที่สั่งไปแล้วหายจากยอดเงียบๆ ไม่ได้)
--    ชื่อ trigger ไม่ลงท้าย _guard (verify-0190 นับ trigger *_guard ของตารางพลอย = 5) · ทำงานหลัง trg_job_gem_bom_guard (ลำดับตามชื่อ) — ใบ done/cancelled ถูกปฏิเสธก่อนถึงที่นี่
--    ไม่แตะแถวที่แก้จำนวน (ไม่ล้างติ๊ก — ยอดที่เหลือคิดจาก ordered_qty ที่ view)
-- ============================================================================
create or replace function analytics.job_gem_bom_ordered_log()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
begin
  if old.ordered_at is not null then
    insert into analytics.gem_purchase_mark_log (shop_id, job_id, line_id, gem_item_id, qty, action, actor)
    values (old.shop_id, old.job_id, old.id, old.gem_item_id, old.ordered_qty, 'line_removed', null);
  end if;
  return old;
end;
$f$;
drop trigger if exists trg_job_gem_bom_ordered_log on analytics.job_gem_bom;
create trigger trg_job_gem_bom_ordered_log before delete on analytics.job_gem_bom for each row execute function analytics.job_gem_bom_ordered_log();

-- 🔴 (security L1) คอลัมน์ติ๊ก ordered_at/ordered_by/ordered_qty เขียนได้ทางเดียวคือ gem_purchase_mark (ตั้ง GUC analytics.gem_purchase_mark = on แบบ local ก่อน update แล้ว off หลังเสร็จ)
--   ทางอื่น (UPDATE ตรง แม้ในนาม postgres/migration/RPC อื่นที่ถูกแก้ผิด) = 42501 · INSERT ที่มีค่าติ๊กก็ไม่ได้ · replace_core/W3 แก้จำนวน/ตำแหน่ง (ไม่แตะ ordered_*) ผ่านปกติ
--   ชื่อไม่ลงท้าย _guard (verify-0190 นับ trigger *_guard = 5) · ทำงานหลัง trg_job_gem_bom_guard (ลำดับตามชื่อ) — ใบ done/cancelled ได้ job_closed ก่อน
create or replace function analytics.job_gem_bom_ordered_only()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
begin
  if coalesce(current_setting('analytics.gem_purchase_mark', true), '') = 'on' then
    return new;
  end if;
  if (tg_op = 'INSERT' and (new.ordered_at is not null or new.ordered_by is not null or new.ordered_qty is not null))
     or (tg_op = 'UPDATE' and (new.ordered_at is distinct from old.ordered_at or new.ordered_by is distinct from old.ordered_by or new.ordered_qty is distinct from old.ordered_qty)) then
    raise exception 'ติ๊ก "สั่งแล้ว" แก้ได้ทางเดียวคือ gem_purchase_mark' using errcode = '42501', hint = 'gem_purchase_direct';
  end if;
  return new;
end;
$f$;
drop trigger if exists trg_job_gem_bom_ordered_only on analytics.job_gem_bom;
create trigger trg_job_gem_bom_ordered_only before insert or update on analytics.job_gem_bom for each row execute function analytics.job_gem_bom_ordered_only();

-- ============================================================================
-- 4. views (ไม่มีคอลัมน์ราคา · ไม่เรียกฟังก์ชันของ schema — canonical = coalesce(merged_into, id) เพราะห่วงโซ่การรวมชื่อถูกยุบเหลือชั้นเดียวเสมอ)
--    v_gem_purchase_job  = ใบที่ขั้นฝัง "ยังไม่รับ" (นิยามที่ส่วนหัวไฟล์ — ที่เดียว) · has_bom บอกว่ามีแถวพลอยไหม (ไม่มี = unspecified_jobs)
--    v_gem_purchase_line = แถวพลอยของใบเหล่านั้น + จำนวนที่ใช้/สั่งแล้ว/ที่เหลือ · snapshot_item_id = gem_item_id เดิมของแถว (ไว้คิดต้นทุนจากราคาของ id นั้น — ไม่ใช่ canonical)
--    v_gem_purchase_summary = รวมต่อ canonical gem_item (ชนิด·รูปทรง·ขนาด ปัจจุบัน ไม่ใช่ฉลาก snapshot)
--    ไม่ให้ role ฝั่งแอปอ่านตรง (อ่านผ่าน RPC ที่ตรวจ actor)
-- ============================================================================
create or replace view analytics.v_gem_purchase_job with (security_invoker = true) as
select j.shop_id, j.id as job_id, j.job_no, j.design_label, j.status as job_status, j.due_date, j.qty_planned,
       exists (select 1 from analytics.job_gem_bom b where b.job_id = j.id and b.shop_id = j.shop_id) as has_bom
  from analytics.job j
 where j.parent_job_id is null
   and j.status in ('open', 'in_progress', 'on_hold')
   and exists (select 1 from analytics.job_stage gs join analytics.job gj on gj.id = gs.job_id
                where gj.shop_id = j.shop_id and (gj.id = j.id or gj.parent_job_id = j.id) and gs.stage_code = 'gem_set' and gs.status = 'pending')
   and not exists (select 1 from analytics.job_stage gs join analytics.job gj on gj.id = gs.job_id
                    where gj.shop_id = j.shop_id and (gj.id = j.id or gj.parent_job_id = j.id) and gs.stage_code = 'gem_set' and gs.status in ('received', 'sent'));

create or replace view analytics.v_gem_purchase_line with (security_invoker = true) as
select g.shop_id, g.id as line_id, g.job_id, pj.job_no, pj.design_label, pj.job_status, pj.due_date, pj.qty_planned, g.line_seq,
       g.gem_item_id as snapshot_item_id, ci.id as canonical_item_id,
       t.id as type_id, t.name as type_name, s.id as shape_id, s.name as shape_name, ci.size_a, ci.size_b, ci.size_label,
       g.qty_per_piece,
       g.qty_per_piece::bigint * pj.qty_planned as qty_total,
       coalesce(g.ordered_qty, 0)::bigint as qty_ordered,
       greatest(g.qty_per_piece::bigint * pj.qty_planned - coalesce(g.ordered_qty, 0), 0)::bigint as qty_remaining,
       greatest(coalesce(g.ordered_qty, 0) - g.qty_per_piece::bigint * pj.qty_planned, 0)::bigint as qty_excess,
       (g.ordered_at is not null) as is_ordered,
       (g.ordered_at is not null and g.ordered_qty is distinct from g.qty_per_piece::bigint * pj.qty_planned) as changed_after_order,
       g.ordered_at, g.ordered_by
  from analytics.job_gem_bom g
  join analytics.v_gem_purchase_job pj on pj.job_id = g.job_id and pj.shop_id = g.shop_id
  join analytics.gem_item gi on gi.id = g.gem_item_id and gi.shop_id = g.shop_id
  join analytics.gem_item ci on ci.id = coalesce(gi.merged_into, gi.id) and ci.shop_id = g.shop_id
  join analytics.gem_type t on t.id = ci.gem_type_id and t.shop_id = ci.shop_id
  join analytics.gem_shape s on s.id = ci.gem_shape_id and s.shop_id = ci.shop_id;

create or replace view analytics.v_gem_purchase_summary with (security_invoker = true) as
with pj as (
  select l.shop_id, l.canonical_item_id, l.type_id, l.type_name, l.shape_id, l.shape_name, l.size_a, l.size_b, l.size_label,
         l.job_id, l.job_no, l.design_label, l.due_date,
         sum(l.qty_total)::bigint as qty_needed,
         sum(l.qty_ordered)::bigint as qty_ordered,
         sum(l.qty_remaining)::bigint as qty_remaining,
         sum(l.qty_excess)::bigint as qty_excess,
         array_agg(l.line_id order by l.line_seq) as line_ids,
         bool_and(l.is_ordered) as is_ordered,
         bool_or(l.changed_after_order) as changed_after_order,
         max(l.ordered_at) as ordered_at,
         (array_agg(l.ordered_by order by l.ordered_at desc) filter (where l.ordered_by is not null))[1] as ordered_by
    from analytics.v_gem_purchase_line l
   group by l.shop_id, l.canonical_item_id, l.type_id, l.type_name, l.shape_id, l.shape_name, l.size_a, l.size_b, l.size_label, l.job_id, l.job_no, l.design_label, l.due_date)
select p.shop_id, p.canonical_item_id, p.type_id, p.type_name, p.shape_id, p.shape_name, p.size_a, p.size_b, p.size_label,
       (p.type_name || ' · ' || p.shape_name || ' · ' || p.size_label || ' มม.') as label,
       sum(p.qty_needed)::bigint as qty_needed_total,
       sum(p.qty_ordered)::bigint as qty_ordered_total,
       sum(p.qty_remaining)::bigint as qty_remaining_total,
       sum(p.qty_excess)::bigint as qty_excess_total,
       count(*)::int as job_count,
       min(p.due_date) as earliest_due,
       min(p.due_date) filter (where p.qty_remaining > 0) as earliest_due_remaining,
       array_agg(p.job_no order by p.due_date nulls last, p.job_no) as job_nos,
       (select array_agg(l2.line_id order by l2.due_date nulls last, l2.job_no, l2.line_seq)
          from analytics.v_gem_purchase_line l2 where l2.shop_id = p.shop_id and l2.canonical_item_id = p.canonical_item_id) as line_ids,
       jsonb_agg(jsonb_build_object('job_id', p.job_id, 'job_no', p.job_no, 'design_label', p.design_label, 'due_date', p.due_date,
                                    'qty_needed_now', p.qty_needed, 'qty_ordered', p.qty_ordered, 'qty_remaining', p.qty_remaining, 'qty_excess', p.qty_excess,
                                    'is_ordered', p.is_ordered, 'changed_after_order', p.changed_after_order,
                                    'ordered_at', case when p.qty_ordered > 0 then p.ordered_at end, 'ordered_by', case when p.qty_ordered > 0 then p.ordered_by end,
                                    'line_ids', to_jsonb(p.line_ids))
                 order by p.due_date nulls last, p.job_no) as jobs
  from pj p
 group by p.shop_id, p.canonical_item_id, p.type_id, p.type_name, p.shape_id, p.shape_name, p.size_a, p.size_b, p.size_label;

-- ============================================================================
-- 5. RPC (security definer · service_role เท่านั้น · actor owner/admin จริงที่ DB — service_role ผ่าน crm_require_owner_admin เสมอ จึงตรวจ actor ซ้ำ)
-- ============================================================================

-- สรุปยอดพลอยที่ใบงานต้องใช้ (ไม่มีราคา แม้เป็น null) — กลุ่มต่อรายการ + รายชื่อใบ + line_ids สำหรับติ๊ก + ใบที่ยังไม่ระบุพลอย
create or replace function analytics.gem_purchase_summary(p_shop_id uuid, p_actor uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
begin
  if p_shop_id is null then
    raise exception 'gem_purchase_summary: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.gem_require_office(p_shop_id, p_actor);
  return jsonb_build_object(
    'server_now', to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM-DD"T"HH24:MI:SS"+07:00"'),
    'today_bkk', analytics.job_today(),
    'groups', (select coalesce(jsonb_agg(jsonb_build_object(
                  'canonical_item_id', s.canonical_item_id, 'type_id', s.type_id, 'type_name', s.type_name, 'shape_id', s.shape_id, 'shape_name', s.shape_name,
                  'size_a', trim_scale(s.size_a), 'size_b', trim_scale(s.size_b), 'size_label', s.size_label, 'label', s.label,
                  'qty_needed_now', s.qty_needed_total, 'qty_ordered', s.qty_ordered_total, 'qty_remaining', s.qty_remaining_total, 'qty_excess', s.qty_excess_total,
                  'job_count', s.job_count, 'earliest_due', s.earliest_due, 'earliest_due_remaining', s.earliest_due_remaining,
                  'line_ids', to_jsonb(s.line_ids), 'jobs', s.jobs)
                  order by s.earliest_due nulls last, s.type_name, s.shape_name, s.size_a, s.size_b nulls first), '[]'::jsonb)
                 from analytics.v_gem_purchase_summary s where s.shop_id = p_shop_id),
    'unspecified_jobs', (select coalesce(jsonb_agg(jsonb_build_object('job_id', u.job_id, 'job_no', u.job_no, 'design_label', u.design_label, 'due_date', u.due_date)
                                                   order by u.due_date nulls last, u.job_no), '[]'::jsonb)
                           from analytics.v_gem_purchase_job u where u.shop_id = p_shop_id and not u.has_bom),
    -- 🔴 (security M2) แถวที่ติ๊กไว้แล้วถูกลบตอนแก้พลอย (replace_core/W3) — ถ้าเพิ่มรายการกลับ แถวใหม่ไม่มีติ๊ก เสี่ยงสั่งซ้ำ → แสดงให้จอเตือน (จาก log line_removed ของใบที่ยังอยู่ในรายการเท่านั้น)
    --   ไม่แสดงถ้าใบนั้นมีแถวรายการเดียวกัน (canonical) ที่ติ๊กอยู่แล้ว · ไม่มีราคา · ใบปิด/ร้านอื่นไม่โผล่ (join v_gem_purchase_job ของร้านนี้)
    'removed_after_order', (select coalesce(jsonb_agg(jsonb_build_object('job_id', x.job_id, 'job_no', x.job_no, 'canonical_item_id', x.canon, 'label', x.label, 'qty', x.qty, 'removed_at', x.recorded_at)
                                                       order by x.recorded_at desc, x.job_no), '[]'::jsonb)
                              from (select ml.job_id, pj.job_no, coalesce(gi.merged_into, gi.id, ml.gem_item_id) as canon,
                                           case when ci.id is not null then (t.name || ' · ' || s.name || ' · ' || ci.size_label || ' มม.') end as label,
                                           ml.qty, ml.recorded_at
                                      from analytics.gem_purchase_mark_log ml
                                      join analytics.v_gem_purchase_job pj on pj.job_id = ml.job_id and pj.shop_id = ml.shop_id
                                      left join analytics.gem_item gi on gi.id = ml.gem_item_id and gi.shop_id = ml.shop_id
                                      left join analytics.gem_item ci on ci.id = coalesce(gi.merged_into, gi.id) and ci.shop_id = ml.shop_id
                                      left join analytics.gem_type t on t.id = ci.gem_type_id and t.shop_id = ci.shop_id
                                      left join analytics.gem_shape s on s.id = ci.gem_shape_id and s.shop_id = ci.shop_id
                                     where ml.shop_id = p_shop_id and ml.action = 'line_removed'
                                       and not exists (select 1 from analytics.v_gem_purchase_line l
                                                        where l.job_id = ml.job_id and l.canonical_item_id = coalesce(gi.merged_into, gi.id, ml.gem_item_id) and l.is_ordered)
                                     order by ml.recorded_at desc limit 200) x),
    'totals', jsonb_build_object(
      'groups', (select count(*) from analytics.v_gem_purchase_summary s where s.shop_id = p_shop_id),
      'jobs', (select count(distinct l.job_id) from analytics.v_gem_purchase_line l where l.shop_id = p_shop_id),
      'qty_needed_now', (select coalesce(sum(l.qty_total), 0) from analytics.v_gem_purchase_line l where l.shop_id = p_shop_id),
      'qty_ordered', (select coalesce(sum(l.qty_ordered), 0) from analytics.v_gem_purchase_line l where l.shop_id = p_shop_id),
      'qty_remaining', (select coalesce(sum(l.qty_remaining), 0) from analytics.v_gem_purchase_line l where l.shop_id = p_shop_id),
      'qty_excess', (select coalesce(sum(l.qty_excess), 0) from analytics.v_gem_purchase_line l where l.shop_id = p_shop_id),
      'unspecified_jobs', (select count(*) from analytics.v_gem_purchase_job u where u.shop_id = p_shop_id and not u.has_bom)));
end;
$f$;

-- ติ๊ก/ยกเลิกติ๊ก "สั่งแล้ว" ของแถว (job × รายการ) — ติ๊กทั้งแถวสรุป = ส่ง line_ids ของทุกใบในรายการนั้น · all-or-nothing · ส่งซ้ำไม่ error ไม่เขียน log · คืนสถานะสดของทุกแถวที่ส่งมา
create or replace function analytics.gem_purchase_mark(p_shop_id uuid, p_line_ids uuid[], p_ordered boolean, p_actor uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_ids     uuid[];
  v_n       int;
  v_found   int;
  v_bad     text;
  v_changed int := 0;
begin
  if p_shop_id is null then
    raise exception 'gem_purchase_mark: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.gem_require_office(p_shop_id, p_actor);
  if p_ordered is null then
    raise exception 'ต้องระบุว่าจะติ๊กหรือยกเลิกติ๊ก "สั่งแล้ว"' using errcode = '22023', hint = 'ordered_invalid';
  end if;
  if p_line_ids is null or array_ndims(p_line_ids) is distinct from 1 or cardinality(p_line_ids) not between 1 and 200 or array_position(p_line_ids, null) is not null then
    raise exception 'รายการที่จะติ๊กต้องมี 1-200 แถว และไม่มีค่าว่าง' using errcode = '22023', hint = 'purchase_lines_invalid';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_line_ids) as x;
  v_n := cardinality(v_ids);

  -- ล็อกตามลำดับเดียวกับ job_gem_bom_replace_core (ใบก่อน แล้วแถวพลอย) กัน deadlock · ใบล็อก share: สถานะใบนิ่งตลอดทรานแซกชันนี้
  perform 1 from analytics.job j
   where j.shop_id = p_shop_id and j.id in (select g.job_id from analytics.job_gem_bom g where g.shop_id = p_shop_id and g.id = any (v_ids))
   order by j.id for share;
  select count(*) into v_found from (
    select g.id from analytics.job_gem_bom g where g.shop_id = p_shop_id and g.id = any (v_ids) order by g.id for update) x;
  if v_found <> v_n then
    raise exception 'ไม่พบรายการพลอยที่จะติ๊กในร้านนี้' using errcode = '22023', hint = 'purchase_line_not_found';
  end if;

  select string_agg(distinct j.job_no, ', ' order by j.job_no) into v_bad
    from analytics.job_gem_bom g join analytics.job j on j.id = g.job_id
   where g.id = any (v_ids) and j.status in ('done', 'cancelled');
  if v_bad is not null then
    raise exception 'ใบงาน % ปิดหรือยกเลิกแล้ว — ติ๊กสั่งแล้วไม่ได้', v_bad using errcode = '22023', hint = 'job_closed';
  end if;
  select string_agg(distinct j.job_no, ', ' order by j.job_no) into v_bad
    from analytics.job_gem_bom g join analytics.job j on j.id = g.job_id
   where g.id = any (v_ids) and not exists (select 1 from analytics.v_gem_purchase_line l where l.line_id = g.id);
  if v_bad is not null then
    raise exception 'ขั้นฝังพลอยของใบ % รับงานแล้ว หรือไม่อยู่ในรายการ — ติ๊กไม่ได้', v_bad using errcode = '22023', hint = 'gem_stage_started';
  end if;

  -- เปิดสวิตช์ให้ trigger job_gem_bom_ordered_only ผ่าน (local ต่อทรานแซกชัน) แล้วปิดทันทีหลังเขียนเสร็จ
  perform set_config('analytics.gem_purchase_mark', 'on', true);
  if p_ordered then
    -- 🔴 (security M1) ติ๊กซ้ำ "ทับยอดลงไม่ได้": ordered_qty = max(ที่ติ๊กไว้, ที่ต้องใช้ตอนนี้) · อัปเดตเฉพาะแถวที่ยังไม่ติ๊ก หรือที่ต้องใช้ตอนนี้ > ที่ติ๊กไว้
    --   สั่งไว้ 90 ใบลดเหลือ 70 แล้วกด "ติ๊กทั้งรายการ" → ยังเป็น 90 (qty_excess 20 ไม่หายเงียบ) · ยกเลิกติ๊ก (p_ordered=false) เท่านั้นที่ล้างยอด
    with upd as (
      update analytics.job_gem_bom g
         set ordered_at = now(), ordered_by = p_actor, ordered_qty = greatest(coalesce(o.ordered_qty, 0), g.qty_per_piece::bigint * j.qty_planned)
        from analytics.job j, analytics.job_gem_bom o
       where o.id = g.id and g.id = any (v_ids) and g.shop_id = p_shop_id and j.id = g.job_id
         and (g.ordered_at is null or g.ordered_qty < g.qty_per_piece::bigint * j.qty_planned)
      returning g.id as line_id, g.job_id, g.gem_item_id, g.ordered_qty as new_qty, o.ordered_qty as old_qty)
    insert into analytics.gem_purchase_mark_log (shop_id, job_id, line_id, gem_item_id, qty, prev_qty, action, actor)
    select p_shop_id, u.job_id, u.line_id, u.gem_item_id, u.new_qty, u.old_qty, 'ordered', p_actor from upd u;
    get diagnostics v_changed = row_count;
  else
    with upd as (
      update analytics.job_gem_bom g
         set ordered_at = null, ordered_by = null, ordered_qty = null
        from analytics.job_gem_bom o
       where o.id = g.id and g.id = any (v_ids) and g.shop_id = p_shop_id and g.ordered_at is not null
      returning g.id as line_id, g.job_id, g.gem_item_id, o.ordered_qty as old_qty)
    insert into analytics.gem_purchase_mark_log (shop_id, job_id, line_id, gem_item_id, qty, action, actor)
    select p_shop_id, u.job_id, u.line_id, u.gem_item_id, u.old_qty, 'unordered', p_actor from upd u;
    get diagnostics v_changed = row_count;
  end if;
  perform set_config('analytics.gem_purchase_mark', 'off', true);
  return jsonb_build_object(
    'requested', v_n, 'changed', v_changed, 'unchanged', v_n - v_changed, 'ordered', p_ordered,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                'line_id', l.line_id, 'job_id', l.job_id, 'job_no', l.job_no, 'canonical_item_id', l.canonical_item_id, 'is_ordered', l.is_ordered,
                'qty_needed_now', l.qty_total, 'qty_ordered', l.qty_ordered, 'qty_remaining', l.qty_remaining, 'qty_excess', l.qty_excess,
                'changed_after_order', l.changed_after_order) order by l.job_no, l.line_seq), '[]'::jsonb)
               from analytics.v_gem_purchase_line l where l.shop_id = p_shop_id and l.line_id = any (v_ids)));
end;
$f$;

-- ต้นทุนประมาณ (🔴 ราคา = ต้นทุน — owner/admin เท่านั้น · RPC เดียวที่ผสมราคาเข้ายอด · จอเรียกเมื่อเปิดสวิตช์ต้นทุนเท่านั้น)
--   ราคา = ล่าสุด ณ วันนี้ไทย (effective_from <= วันนี้) ของ gem_item_id ใน snapshot ของแถว (snapshot_item_id — ไม่ใช่ canonical)
--   ส่วน "ที่เหลือ" = qty_remaining × ราคา · ส่วน "สั่งแล้ว" = qty_ordered × ราคา · ไม่มีราคา = null + missing_price (ไม่เดา ไม่ใช่ 0) · ส่วนที่จำนวน = 0 ไม่ต้องมีราคา
--   cost_*_thb ปัด 2 ตำแหน่งต่อกลุ่ม · totals = ผลรวมของค่าที่ปัดแล้ว (เฉพาะกลุ่มที่ราคาครบ) → ผลบวกแถว = ยอดรวมเป๊ะ · complete=false ถ้ามีกลุ่มที่ไม่มีราคา
create or replace function analytics.gem_purchase_summary_cost(p_shop_id uuid, p_actor uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_today date := analytics.job_today();
  v_res   jsonb;
begin
  if p_shop_id is null then
    raise exception 'gem_purchase_summary_cost: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.gem_require_office(p_shop_id, p_actor);
  with lp as (
    select l.canonical_item_id, l.qty_remaining, l.qty_ordered, pr.price_thb_per_unit as price
      from analytics.v_gem_purchase_line l
      left join lateral (select p.price_thb_per_unit from analytics.gem_item_price p
                          where p.gem_item_id = l.snapshot_item_id and p.shop_id = l.shop_id and p.effective_from <= v_today
                          order by p.effective_from desc limit 1) pr on true
     where l.shop_id = p_shop_id),
  g as (
    select lp.canonical_item_id,
           sum(lp.qty_remaining)::bigint as qty_remaining,
           sum(lp.qty_ordered)::bigint as qty_ordered,
           coalesce(bool_or(lp.price is null) filter (where lp.qty_remaining > 0), false) as missing_price_remaining,
           coalesce(bool_or(lp.price is null) filter (where lp.qty_ordered > 0), false) as missing_price_ordered,
           sum(lp.qty_remaining * lp.price) filter (where lp.qty_remaining > 0) as raw_remaining,
           sum(lp.qty_ordered * lp.price) filter (where lp.qty_ordered > 0) as raw_ordered
      from lp
     group by lp.canonical_item_id),
  r as (
    select g.canonical_item_id, g.qty_remaining, g.qty_ordered, g.missing_price_remaining, g.missing_price_ordered,
           case when g.missing_price_remaining then null else round(coalesce(g.raw_remaining, 0), 2) end as cost_remaining_thb,
           case when g.missing_price_ordered then null else round(coalesce(g.raw_ordered, 0), 2) end as cost_ordered_thb
      from g)
  select jsonb_build_object(
    'today_bkk', v_today,
    'groups', coalesce(jsonb_agg(jsonb_build_object(
                'canonical_item_id', r.canonical_item_id, 'qty_remaining', r.qty_remaining, 'qty_ordered', r.qty_ordered,
                'cost_remaining_thb', r.cost_remaining_thb, 'cost_ordered_thb', r.cost_ordered_thb,
                'missing_price_remaining', r.missing_price_remaining, 'missing_price_ordered', r.missing_price_ordered,
                'missing_price', r.missing_price_remaining or r.missing_price_ordered) order by r.canonical_item_id), '[]'::jsonb),
    'totals', jsonb_build_object(
      'groups', count(*),
      'groups_missing_price', count(*) filter (where r.missing_price_remaining or r.missing_price_ordered),
      'cost_remaining_thb', coalesce(sum(r.cost_remaining_thb), 0),
      'cost_ordered_thb', coalesce(sum(r.cost_ordered_thb), 0),
      'complete', not coalesce(bool_or(r.missing_price_remaining or r.missing_price_ordered), false)))
    into v_res
    from r;
  return v_res;
end;
$f$;

-- ============================================================================
-- 6. สิทธิ์ — service_role เท่านั้น (migration-traps ข้อ 2, 7, 18) · ปิดทุกอย่างก่อนแล้วเปิดเฉพาะที่ตั้งใจ
--    ตาราง log + 3 view: ไม่ให้ role ฝั่งแอปอ่านตรง (อ่านผ่าน RPC ที่ตรวจ actor owner/admin) · job_gem_bom: สิทธิ์เดิมของ 0190 (service_role select อย่างเดียว) ไม่แตะ
-- ============================================================================
revoke all on analytics.gem_purchase_mark_log, analytics.v_gem_purchase_job, analytics.v_gem_purchase_line, analytics.v_gem_purchase_summary from public, anon, authenticated, service_role;

do $g$
declare
  r record;
  v_rpc constant text[] := array['gem_purchase_summary', 'gem_purchase_mark', 'gem_purchase_summary_cost'];
  v_internal constant text[] := array['job_gem_bom_ordered_log', 'job_gem_bom_ordered_only'];
  v_dup text;
  v_n int;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace and (p.proname = any (v_rpc) or p.proname = any (v_internal))
  loop
    -- 4 ชื่อเสมอ: public/anon/authenticated มาจากคนละทาง (ข้อ 18.1) · default privilege ของสคีมาให้ service_role ทุกฟังก์ชันใหม่ → ถอนก่อนแล้วให้เฉพาะ RPC
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname = any (v_rpc) then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
  select string_agg(proname, ', ') into v_dup from (
    select proname from pg_proc where pronamespace = 'analytics'::regnamespace and (proname = any (v_rpc) or proname = any (v_internal))
    group by proname having count(*) > 1) d;
  if v_dup is not null then
    raise exception '0192: พบ overload ของฟังก์ชัน: %', v_dup;
  end if;
  select count(distinct proname) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and (proname = any (v_rpc) or proname = any (v_internal));
  if v_n <> cardinality(v_rpc) + cardinality(v_internal) then
    raise exception '0192: ฟังก์ชันที่ประกาศ % ตัว แต่พบใน pg_proc % ชื่อ', cardinality(v_rpc) + cardinality(v_internal), v_n;
  end if;
end;
$g$;

comment on table analytics.gem_purchase_mark_log is
  '0192: ประวัติติ๊ก "สั่งแล้ว" ของพลอย (ordered/unordered โดยคน · line_removed โดยระบบ) — append-only · ไม่มีราคา · ไม่ให้ role ฝั่งแอปอ่านตรง';
comment on column analytics.job_gem_bom.ordered_qty is
  '0192: จำนวนเม็ดรวมของแถว ณ ตอนติ๊ก "สั่งแล้ว" (qty_per_piece × qty_planned) = จำนวนที่สั่งไปจริง — ใบเปลี่ยนทีหลัง ที่เหลือ = max(ใช้ตอนนี้ − ordered_qty, 0)';
comment on view analytics.v_gem_purchase_job is
  '0192: ใบแม่ open/in_progress/on_hold ที่ขั้นฝัง gem_set ยังไม่รับ (นิยามที่เดียว) — ไม่มีราคา · อ่านผ่าน gem_purchase_summary เท่านั้น';
comment on view analytics.v_gem_purchase_line is
  '0192: แถวพลอยของใบที่ขั้นฝังยังไม่รับ + จำนวนที่ใช้/สั่งแล้ว/ที่เหลือ — ไม่มีราคา · อ่านผ่าน gem_purchase_summary/_cost เท่านั้น';
comment on view analytics.v_gem_purchase_summary is
  '0192: รวมยอดพลอยที่ใบงานต้องใช้ต่อ canonical gem_item — ไม่มีราคา · อ่านผ่าน gem_purchase_summary เท่านั้น';

-- ============================================================================
-- 7. post-check: ไม่แตะของเดิม · ข้อมูลเดิมไม่ขยับ · สิทธิ์ปิด · ไม่มีราคาใน view/ตาราง · trigger เปิด
-- ============================================================================
do $c$
declare
  v_changed text;
  v_new text;
  v_bad text;
  v_added constant text[] := array['job_gem_bom_ordered_log', 'job_gem_bom_ordered_only','gem_purchase_summary', 'gem_purchase_mark', 'gem_purchase_summary_cost'];
begin
  -- (1) ฟังก์ชันเดิมทุกตัว md5 เท่าเดิมเป๊ะ (ไฟล์นี้ไม่ replace ฟังก์ชันเดิม — job_gem_bom_get / replace_core / resolve / job_gem_state ไม่ขยับ)
  select string_agg(b.sig, ', ') into v_changed
    from _m192_fn_base b
    left join pg_proc p on p.oid = to_regprocedure(b.sig)
   where p.oid is null or md5(pg_get_functiondef(p.oid)) <> b.h;
  if v_changed is not null then
    raise exception '0192 แตะฟังก์ชันเดิม (md5 ไม่เท่า/หาย): %', v_changed;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_new
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
     and not exists (select 1 from _m192_fn_base b where b.sig = p.oid::regprocedure::text)
     and not (p.proname = any (v_added));
  if v_new is not null then
    raise exception '0192: มีฟังก์ชันใหม่นอกรายการที่ประกาศ: %', v_new;
  end if;
  -- (2) แถวเดิมไม่ขยับ (ไฟล์นี้ไม่มี UPDATE — ตรวจ updated_at ทั้งก้อนด้วย: ข้อ 19)
  select string_agg(b.t, ', ') into v_changed
    from _m192_row_base b
    join (select 'job_gem_bom'::text as t, count(*) as n, count(distinct g.updated_at) as d,
                 coalesce(md5(string_agg(g.id::text || '|' || g.shop_id::text || '|' || g.job_id::text || '|' || g.line_seq::text || '|' || g.gem_item_id::text || '|' || g.gem_label || '|' || g.qty_per_piece::text
                                         || '|' || coalesce(g.position_note, '') || '|' || g.source || '|' || g.created_at::text || '|' || g.updated_at::text, ',' order by g.id)), '') as h
            from analytics.job_gem_bom g
          union all
          select 'job', count(*), count(distinct j.updated_at), coalesce(md5(string_agg(j::text, '|' order by j.id)), '') from analytics.job j
          union all
          select 'job_stage', count(*), count(distinct s.updated_at), coalesce(md5(string_agg(s::text, '|' order by s.id)), '') from analytics.job_stage s
          union all
          select 'gem_item_price', count(*), 0, coalesce(md5(string_agg(p::text, '|' order by p.gem_item_id, p.effective_from)), '') from analytics.gem_item_price p) a on a.t = b.t
   where a.n <> b.n or a.d <> b.d or a.h <> b.h;
  if v_changed is not null then
    raise exception '0192: แถวเดิมขยับในตาราง: %', v_changed;
  end if;
  if exists (select 1 from analytics.job_gem_bom g where g.ordered_at is not null or g.ordered_by is not null or g.ordered_qty is not null)
     and not exists (select 1 from analytics.gem_purchase_mark_log) then
    raise exception '0192: มีแถวที่ติ๊กอยู่แล้วแต่ไม่มี log เลย — ติ๊กต้องผ่าน gem_purchase_mark เท่านั้น';
  end if;
  -- (3) ตาราง/วิวใหม่: RLS · ไม่มี policy · role ฝั่งแอป (anon/authenticated/service_role) ไม่มีสิทธิ์ใดๆ
  if not (select c.relrowsecurity from pg_class c where c.oid = 'analytics.gem_purchase_mark_log'::regclass)
     or exists (select 1 from pg_policy where polrelid = 'analytics.gem_purchase_mark_log'::regclass) then
    raise exception '0192: gem_purchase_mark_log ต้องเปิด RLS และไม่มี policy';
  end if;
  select string_agg(o || ':' || r, ', ') into v_bad
    from unnest(array['analytics.gem_purchase_mark_log', 'analytics.v_gem_purchase_job', 'analytics.v_gem_purchase_line', 'analytics.v_gem_purchase_summary']) o
    cross join unnest(array['anon', 'authenticated', 'service_role']) r
   where has_table_privilege(r, o, 'select') or has_table_privilege(r, o, 'insert') or has_table_privilege(r, o, 'update')
      or has_table_privilege(r, o, 'delete') or has_table_privilege(r, o, 'truncate') or has_table_privilege(r, o, 'references') or has_table_privilege(r, o, 'trigger');
  if v_bad is not null then
    raise exception '0192: ตาราง/วิวใหม่ต้องไม่มีสิทธิ์ของ role ฝั่งแอป: %', v_bad;
  end if;
  -- job_gem_bom: สิทธิ์เดิมของ 0190 (service_role select อย่างเดียว) ยังเหมือนเดิม
  if has_table_privilege('anon', 'analytics.job_gem_bom', 'select') or has_table_privilege('authenticated', 'analytics.job_gem_bom', 'select')
     or has_table_privilege('service_role', 'analytics.job_gem_bom', 'insert') or has_table_privilege('service_role', 'analytics.job_gem_bom', 'update')
     or has_table_privilege('service_role', 'analytics.job_gem_bom', 'delete') or not has_table_privilege('service_role', 'analytics.job_gem_bom', 'select') then
    raise exception '0192: สิทธิ์ของ job_gem_bom ผิดไปจาก 0190 (ต้อง service_role select อย่างเดียว)';
  end if;
  -- (4) 🔴 ไม่มีคอลัมน์ที่ดูเป็นราคา/ต้นทุน/ผู้ขาย ใน view ยอด และตาราง log
  if exists (select 1 from information_schema.columns where table_schema = 'analytics'
              and table_name in ('v_gem_purchase_job', 'v_gem_purchase_line', 'v_gem_purchase_summary', 'gem_purchase_mark_log') and column_name ~* '(price|cost|thb|supplier)') then
    raise exception '0192: view/ตารางยอดสั่งมีคอลัมน์ที่ดูเป็นราคา/ต้นทุน';
  end if;
  -- (5) EXECUTE: RPC = service_role เท่านั้น · helper ไม่มี role ไหน · ทั้งสคีมาไม่มี PUBLIC/anon/authenticated
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.proname = any (v_added)
     and (has_function_privilege('service_role', p.oid, 'execute') is distinct from (p.proname <> all (array['job_gem_bom_ordered_log', 'job_gem_bom_ordered_only']))
          or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_bad is not null then
    raise exception '0192: สิทธิ์ execute ของฟังก์ชันใหม่ผิด: %', v_bad;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_new
    from pg_proc p cross join lateral aclexplode(p.proacl) a
   where p.pronamespace = 'analytics'::regnamespace and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  if v_new is not null then
    raise exception '0192: พบฟังก์ชันในสคีมา analytics ที่ PUBLIC/anon/authenticated ถือ EXECUTE: %', v_new;
  end if;
  -- (6) RPC definer pin search_path · trigger ใหม่เปิดอยู่ · trigger guard เดิมของ 0190 ยังครบ 5 (ไม่นับตัวใหม่)
  select string_agg(p.proname, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.proname in ('gem_purchase_summary', 'gem_purchase_mark', 'gem_purchase_summary_cost')
     and (not p.prosecdef or not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'));
  if v_bad is not null then
    raise exception '0192: RPC ต้อง security definer + pin search_path: %', v_bad;
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'analytics.job_gem_bom'::regclass and t.tgname = 'trg_job_gem_bom_ordered_log' and not t.tgisinternal and t.tgenabled in ('O', 'A')) then
    raise exception '0192: trigger trg_job_gem_bom_ordered_log ต้องเปิดอยู่';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'analytics.job_gem_bom'::regclass and t.tgname = 'trg_job_gem_bom_ordered_only' and not t.tgisinternal and t.tgenabled in ('O', 'A')) then
    raise exception '0192: trigger trg_job_gem_bom_ordered_only ต้องเปิดอยู่';
  end if;
  -- (7) 🔴 view ทั้ง 3 เป็น security_invoker (อ่านด้วยสิทธิ์ผู้เรียก ไม่ใช่เจ้าของวิว — role ฝั่งแอปไม่มีสิทธิ์ตารางอยู่แล้ว · RPC definer เป็นเจ้าของ จึงยังอ่านได้)
  select string_agg(c.relname, ', ') into v_bad from pg_class c
   where c.relnamespace = 'analytics'::regnamespace and c.relname in ('v_gem_purchase_job', 'v_gem_purchase_line', 'v_gem_purchase_summary')
     and not coalesce('security_invoker=true' = any (c.reloptions), false);
  if v_bad is not null then
    raise exception '0192: view ต้องเป็น security_invoker: %', v_bad;
  end if;
  if (select count(*) from pg_trigger t where t.tgrelid in ('analytics.gem_shape'::regclass, 'analytics.gem_type'::regclass, 'analytics.gem_item'::regclass,
        'analytics.product_gem_bom'::regclass, 'analytics.job_gem_bom'::regclass) and not t.tgisinternal and t.tgenabled in ('O', 'A') and t.tgname like '%\_guard') <> 5 then
    raise exception '0192: trigger guard ของตารางพลอย (0190) ต้องครบ 5 ตัวและเปิดอยู่';
  end if;
  raise notice '0192: ฟังก์ชันเดิม % ตัว md5 เท่าเดิมทั้งหมด · ฟังก์ชันใหม่ % ตัว · แถว job_gem_bom เดิม % แถวไม่ขยับ',
    (select count(*) from _m192_fn_base), cardinality(v_added), (select n from _m192_row_base where t = 'job_gem_bom');
end;
$c$;

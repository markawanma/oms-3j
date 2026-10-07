-- 0160_content_piece_post_views.sql  (ก้อน C2 ส่วนสอง — ฝั่งโพสต์ของ piece workflow + view ที่เหลือ)
--
-- สถานะ: DRAFT ยังไม่ apply — พึ่ง 0159 (ต้อง apply 0159 ก่อน · ด่านต้นไฟล์ตรวจให้) · ต้องผ่าน security (threat "ผูกโพสต์กับชิ้นงาน" แยกจาก "อนุมัติ")
-- + QA ก่อน merge · ไม่มี backfill · ไม่แก้ตาราง/view/ฟังก์ชันเดิมของ 0158/0159 แม้แต่ตัวเดียว (ด่านท้ายไฟล์ตรวจ md5)
--
-- Why: ชิ้นที่ approved แล้วต้องมีทาง "วางลิงก์โพสต์ → posted" ในคำสั่งเดียว (วางลิงก์ + เลือก hook ที่ใช้จริง + ขยับสถานะ) โดยไม่ให้ลิงก์ผูกผิดชิ้น/ผิดร้าน/
-- ผูกซ้ำ 2 ชิ้น · โพสต์นอกแผนผูกทีหลังได้ · เลื่อนวันมีเหตุผลบันทึก · และหน้าจอต้องมี view อ่านเลขสรุป (inbox · ปฏิทิน · โควตา LINE · คลัง hook)
-- Design: docs/3j-jewelry/analytics/design-content-workflow-schema-gap.md §11.2 · §12.7 · §12.8 · §12.9 X31-X33 · §12.10 K13 K14 K18 · §12.13
--
-- ทำอะไร:
--   1. helper: content_post_platform_ok_ (kind↔platform) · content_post_hook_check_ (hook ต้องเป็น ours ของ step นั้น — อ่านอย่างเดียว)
--   2. RPC: content_piece_post · content_post_link_step · content_post_unlink_step · content_piece_defer (security definer · owner เท่านั้น)
--   2b. trigger ด่านระดับตาราง content_post_guard_link (BEFORE INSERT/UPDATE บน content_post) — ผูก/ปลด step_id · hook_id ได้เฉพาะผ่าน RPC 3 ตัวข้างบน
--   3. view (ใหม่ทั้งหมด · security_invoker · grant select service_role): v_content_piece_calendar · v_content_inbox_counts · v_line_quota_28d ·
--      v_content_hook_library  — ไม่ replace view เดิม (trap #3) · ไม่มีชื่อจริงโฮสต์ในทุก view (expected_host_label = public_label เท่านั้น มาจาก v_content_piece)
--
-- 🔴 ถึงทีมหน้าจอ (frontend) — 2 ข้อที่ต้องทำตาม:
--   1. view ทั้ง 4 ตัวของไฟล์นี้ (และ v_content_piece ของ 0159) "ไม่กรองร้านให้" — security_invoker + service_role ข้าม RLS ⇒ ทุก query ต้อง `.eq('shop_id', shopId)`
--      เสมอ ไม่งั้นได้แถวของทุกร้านปนกัน (ตอนนี้มีร้านเดียว ผลเลยดูถูกต้อง — จะพังวันที่มีร้านที่สอง) · v_content_inbox_counts / v_line_quota_28d คืน 1 แถว/ร้าน
--   2. map error จาก "รหัส (errcode)" ไม่ใช่ "ชื่อฟังก์ชัน/ข้อความ": 22023 = อินพุตผิด (บอกผู้ใช้ให้แก้ค่า) · 42501 = ไม่ใช่เจ้าของ ·
--      55000 = สถานะ/การผูกไม่เอื้อ (ชิ้นยังไม่ approved · ผูกซ้ำ · โพสต์ผูกกับชิ้นอื่น/เอกสารของชิ้นอื่น · มี platform นั้นอยู่แล้ว · ชนกับคำสั่งอื่นพร้อมกัน — ลองใหม่) ·
--      ข้อความภาษาไทยในแต่ละ raise เปลี่ยนได้ ห้าม match ข้อความ · ทุก RPC ในไฟล์นี้ rollback ทั้งก้อนเมื่อ raise (ไม่มี partial write)
--
-- 🔴 ตัดสินใจเองนอก design (เหตุผลอยู่ที่จุดนั้น + สรุปส่งมอบ):
--   A  content_piece_post ห่อ content_post_upsert เดิม (ไม่แตะ — คิววางลิงก์ /marketing/content/entry ยังเรียกตรง) · ตรวจโพสต์เดิมที่ผูกชิ้นอื่น/ชิ้นนี้
--      "ก่อน" upsert (ไม่ปล่อยให้ upsert ทับ post_url/posted_at ของโพสต์ที่ไม่ใช่ของชิ้นนี้ก่อนค่อยมาล้ม) · ล็อกลำดับ step → post เสมอ (ทุก RPC) กัน deadlock
--   B  1 platform ต่อชิ้นมีโพสต์ active ได้ 1 ใบ (ig_fb_post = facebook 1 + instagram 1 สูงสุด 2) — สเปกบอกแค่ "ใบที่ 2 ของ ig_fb_post" ไม่ได้บอกเพดาน ·
--      กันกดซ้ำ/วางลิงก์ซ้ำคนละ external_id ของ platform เดียวกัน
--   C  content_post_link_step ยอม step ที่ posted แล้วเมื่อเป็น ig_fb_post (โพสต์ที่ 2 นอกแผนมาทีหลัง) — สเปกเขียน approved/produced · ใช้กฎเดียวกับ
--      content_piece_post (posted + ig_fb_post = เพิ่มใบที่ 2) ไม่งั้นต้อง unlink ชิ้นทั้งชิ้นเพื่อผูกโพสต์ใบที่ 2
--   D  hook "อื่นๆ" (p_hook_other_text/type) สร้างผ่าน content_hook_upsert เดิม (label null) ภายใต้ GUC c2.piece_rpc='1' เฉพาะรอบ call นั้น
--      (security เตือน: guard hook ของ 0159 ปฏิเสธเพิ่ม hook บนชิ้น approved+ — ต้องข้ามเฉพาะที่นี่) · ข้อความ hook ที่มี [ต้องยืนยัน ถูกปฏิเสธ (22023)
--      เพราะ approve_blockers/extract/view นับ marker ใน hook ours ทุกตัว — ไม่ปล่อยให้ชิ้นที่โพสต์แล้วมี marker ค้างเงียบ ๆ ·
--      ส่งข้อความโดยไม่ส่งประเภท (หรือกลับกัน) = 22023 (content_hook_upsert บังคับประเภท · ไม่เดาประเภทให้)
--   E  content_post_unlink_step เขียน event 'unpost' ทุกครั้ง (แม้ชิ้นไม่ถอย posted→produced เพราะยังเหลือโพสต์ active ใบอื่น) — ประวัติผูก/ปลดต้องตามรอยได้
--   F  content_piece_defer: ชิ้น idea = 55000 "ใช้ set_plan.date" (ก่อนเรียก campaign_reschedule_step · ไม่ปล่อย P0001 ดิบจากฟังก์ชันเดิม) ·
--      วัน/เวลาเท่าเดิม = 55000 (ไม่ no-op เงียบ แบบเดียวกับ advance "อยู่สถานะนี้แล้ว") · ช่วงวัน = ช่วงเดียวกับ create/set_plan
--   G  view ชื่อ v_line_quota_28d ตามสเปก §12.7 (brief ส่งงานเขียน v_content_line_quota_28d — ใช้ตามสเปกที่เป็น contract กับ frontend)
--      นิยามหน้าต่าง: used_28d = โพสต์วันไทยใน [วันนี้−27, วันนี้] · planned_28d = planned..produced ที่ resolved_start ใน [วันนี้, วันนี้+27] ·
--      overdue_planned (เกินวันแล้วยังไม่โพสต์) แยกคอลัมน์ ไม่หายเงียบ · quota = 4 คงที่ที่เดียวใน view นี้ (ย้ายเข้า shop_setting เมื่อมีร้านที่สอง)
--   H  v_content_hook_library: สถิติต่อ hook_type นับเฉพาะ hook ours ที่ผูกโพสต์ active + มีผล T+7 (v_content_post_t7.t7_captured_on) · n = จำนวน "ชิ้น"
--      (distinct step) ไม่ใช่จำนวนโพสต์ · n < 4 = 'ยังสรุปไม่ได้' (กฎ 4 ชิ้น — ค่าคงที่ที่เดียวใน view นี้) · แถว reference โชว์สถิติของ "ประเภทเดียวกันของเรา"
--      เพื่อเทียบ แต่ไม่นับ reference เข้าสถิติ · ไม่มีคอลัมน์ account/ชื่อคน (สเปก §11.2 ข้อ 7)
--
-- 🔴 รอบแก้ตาม security (CONDITIONAL GO) + QA (PASS with notes) — 7 ต.ค. 69:
--   S-M1 ผูกโพสต์แบบ "compare-and-set": update ... where step_id is null + found เช็ค ⇒ กดโพสต์ 2 ชิ้นพร้อมกันด้วยลิงก์เดียวกัน ตัวที่แพ้ = 55000 rollback ทั้งก้อน
--        (รวมสถานะ posted) · ก่อนหน้านี้ UPDATE ไม่มี where step_id is null ⇒ ตัวที่มาทีหลังเขียนทับ step_id ของตัวแรกเงียบ ๆ
--   S-M2 กติกา post กับ link_step ตรงกัน: โพสต์ที่มีอยู่แล้วและ artifact_id ไม่ใช่ null แต่ไม่ใช่เอกสารของชิ้นนี้ = 55000 ทั้งสองทาง ·
--        🔴 ตัดสินใจกลับสเปกเดิม: content_post_unlink_step ล้าง artifact_id ด้วย (เดิมคงไว้) — ไม่งั้นโพสต์ที่เคยผูกผิดชิ้นจะผูกเข้าชิ้นที่ถูกไม่ได้อีกเลย
--        (artifact_id ของชิ้นเดิมค้างอยู่ ⇒ ด่าน S-M2 ปฏิเสธทุกชิ้นอื่น) · ผูกใหม่ภายหลังเติม artifact_id ของชิ้นใหม่ให้เอง (link_step coalesce)
--   S-M3 ด่านระดับตาราง (trigger content_post_guard_link · แพทเทิร์นเดียวกับ content_piece_guard_step ของ 0159): ข้ามเฉพาะเมื่อ GUC c2.piece_rpc='1'
--        และ current_user ไม่ใช่ service_role/authenticated/anon (RPC definer รันเป็นเจ้าของฟังก์ชัน) ⇒ service_role เขียนตรงไม่ผ่าน:
--        INSERT ที่มี step_id/hook_id · UPDATE ที่เปลี่ยน step_id/hook_id · UPDATE ที่เปลี่ยน artifact_id ของโพสต์ที่ผูก step แล้ว → 55000 ·
--        RPC 3 ตัว (post/link/unlink) เปิด GUC ครอบ "เฉพาะคำสั่ง update content_post" แล้วปิดคืนทันที ·
--        ต้องไม่พัง: content_post_upsert จากคิวเดิม (โพสต์นอกแผน · โพสต์ที่ผูก artifact เดิม · วางซ้ำค่าเดิม) ทำงานเหมือนเดิม (ไม่แตะ step_id/hook_id · artifact_id เปลี่ยนเฉพาะแถวที่ยังไม่ผูก step)
--        🔴 ตัดสินใจเอง: ปล่อย UPDATE ที่เป็นการ "เคลียร์เป็น null โดย FK action" (on delete set null ของ step_id/hook_id/artifact_id — ลบ hook/เอกสาร
--        ที่โพสต์ deleted ยังอ้างอยู่) ผ่านด้วย pg_trigger_depth() > 1 + เปลี่ยนได้เฉพาะเป็น null ไม่งั้น trigger ขวางการลบ hook/เอกสารเอง (55000 งงๆ) ·
--        UPDATE ตรงจาก service_role อยู่ที่ depth 1 ⇒ ยังโดนด่านเต็ม
--   S-L1 posted_at ก่อนเวลาอนุมัติ (event advance→approved ล่าสุด) ไม่บล็อก — ใส่ posted_before_approval: true ใน payload ของ event post (ทางผูกใบแรกผ่าน
--        content_piece_transition_ ของ 0159 ซึ่งแก้ในไฟล์ 0159 เพื่อข้อนี้ · ใบที่ 2 ที่เขียน event ในไฟล์นี้ใช้สูตรเดียวกัน)
--   S-L2 เปิดโพสต์ deleted/private กลับ active (content_post_set_status) ที่ยังผูกชิ้น: ถ้าชิ้นนั้นมีโพสต์ active platform เดียวกันอยู่แล้ว = 55000 (ใน trigger — เส้นทางไหนก็ผ่านด่านนี้)
--   S-L3 caption เพดาน 2,200 ตัวอักษร (หลัง btrim) ใน content_piece_post เท่านั้น — ไม่ใส่ CHECK ที่ตาราง: content_post_upsert เดิมรับ caption ไม่จำกัด (QA D1 เคส 18 = 100,000) และ
--        เปลี่ยนพฤติกรรมของคิวเดิมไม่ได้ ⇒ ผู้เรียกที่ถือ service key ตรง ๆ ยังยัดยาวได้ผ่านคิวเดิม (Low · รับไว้)
--   QA-I6 posted_at ต้องอยู่ใน [2025-01-01 00:00 ไทย, now()+1 วัน] และจำกัด (ไม่ infinity/-infinity) — content_piece_post + content_post_link_step (ตรวจ posted_at ของโพสต์ที่จะผูก) ·
--        เดิมค่า -infinity ทำให้ posted_date_th = -infinity แล้ว view ทั้งร้านอ่านไม่ได้ (22008) · ⚠️ content_post_upsert เดิม (คิววางลิงก์) ยังรับ -infinity ได้ (ไม่แตะ — QA D1 เคส 20 ล็อกพฤติกรรมเดิมไว้) ·
--        link_step จึงเป็นด่านกันโพสต์ที่หลุดเข้ามาแบบนั้นไม่ให้ถูกผูกกับชิ้นงาน
--
-- Grant model (3j-migration-traps #18): ทุก object ใหม่ grant ให้ service_role อย่างเดียว · revoke ครบสามชื่อ (public/anon/authenticated)
-- ⚠️ ห้ามมี `to authenticated` ในไฟล์นี้ (สคีมา analytics ปิด REST ของ anon/authenticated ทั้งสคีมา — 0123)
-- 🔴 actor_role มาจากแอป ไม่ใช่ auth (R14/D2) — เหมือน 0159 · ผู้ถือ service key ที่ตั้งใจ = ข้อ P ของ 0159 (ความเสี่ยงที่รับไว้)
-- ไฟล์ idempotent (รันซ้ำ 2 รอบในทรานแซกชันเดียวผ่าน) · LF
-- 🔴 ห้ามรันนอก `node scripts/run-sql.mjs` — ด่านท้ายไฟล์เทียบกับ snapshot ใน GUC ระดับทรานแซกชัน (c3.snap_*)

-- ============================================================================
-- 0. ด่านต้นไฟล์ (พึ่ง 0159) + snapshot ก่อนแตะอะไร (GUC ระดับทรานแซกชัน — แบบเดียวกับ 0159 §0)
-- ============================================================================

do $c3pre$
begin
  if to_regprocedure('analytics.content_piece_transition_(uuid,uuid,text,text,text,integer,uuid)') is null
     or to_regclass('analytics.v_content_piece') is null
     or to_regprocedure('analytics.content_post_upsert(uuid,text,text,text,timestamp with time zone,text,uuid,text)') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'analytics' and table_name = 'content_post' and column_name = 'hook_id')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'analytics' and table_name = 'campaign_step' and column_name = 'piece_status') then
    raise exception '0160: ต้อง apply 0159 (content_piece_workflow) ก่อน — ไม่พบ transition_/v_content_piece/content_post.hook_id/campaign_step.piece_status';
  end if;
end
$c3pre$;

do $c3snap$
begin
  perform set_config('c3.snap_post', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, status, post_url, posted_at, artifact_id, step_id, hook_id,
             updated_at), E'\n' order by id), ''))
    from analytics.content_post), true);
  perform set_config('c3.snap_step', (
    select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
           md5(coalesce(string_agg(concat_ws('|', id, status, piece_status, hold_reason, updated_at), E'\n' order by id), ''))
    from analytics.campaign_step), true);
  perform set_config('c3.snap_artifact', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, step_id, status, content_body,
             clip_brief::text, updated_at), E'\n' order by id), ''))
    from analytics.step_artifact), true);
  perform set_config('c3.snap_gate', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', step_id, gate_kind, status, detail::text, passed_at,
             updated_at), E'\n' order by step_id, gate_kind), ''))
    from analytics.step_gate), true);
  perform set_config('c3.snap_hook', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, shop_id, text, hook_type, origin, source_signal_id, step_id,
             label, generated_by, derived_from_hook_id, updated_at), E'\n' order by id), ''))
    from analytics.content_hook), true);
  perform set_config('c3.snap_event', (
    select count(*)::text || ':' || md5(coalesce(string_agg(id::text, ',' order by seq), ''))
    from analytics.content_piece_event), true);
  perform set_config('c3.snap_views', (
    select count(*)::text || ':' || md5(coalesce(string_agg(c.relname || '=' || pg_get_viewdef(c.oid), E'\n' order by c.relname), ''))
    from pg_class c
    where c.relnamespace = 'analytics'::regnamespace and c.relkind = 'v'
      and c.relname not in ('v_content_piece_calendar', 'v_content_inbox_counts', 'v_line_quota_28d', 'v_content_hook_library')), true);
  perform set_config('c3.snap_funcs', (
    select count(*)::text || ':' || md5(coalesce(string_agg(p.oid::regprocedure::text || '=' || pg_get_functiondef(p.oid), E'\n'
             order by p.oid::regprocedure::text), ''))
    from pg_proc p
    where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
      and p.proname !~ '^(content_piece_post$|content_piece_defer$|content_post_link_step$|content_post_unlink_step$|content_post_platform_ok_$|content_post_hook_check_$|content_post_guard_link$)'), true);
end
$c3snap$;

-- ============================================================================
-- 1. helper
-- ============================================================================

-- ตาราง kind ↔ platform ของชิ้นที่มีลิงก์โพสต์ (ตรวจกับ piece_kind ไม่ใช่ channel — channel null ของ legacy ไม่บล็อก · design §12.8)
-- line_message/story ไม่มีลิงก์ = false เสมอ (ไปทาง advance posted)
create or replace function analytics.content_post_platform_ok_(p_kind text, p_platform text)
 returns boolean
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $f$
  select coalesce(case
    when p_kind in ('short_clip', 'live_cut') then p_platform = 'tiktok'
    when p_kind = 'ig_fb_post' then p_platform in ('facebook', 'instagram')
    else false
  end, false)
$f$;

-- hook ที่ผูกโพสต์ได้ = ours ของ step นั้นเท่านั้น (design §11.2 ข้อ 6 — ห้ามใช้ hook ของเขา/ของ step อื่น) · อ่านอย่างเดียว ไม่เขียนอะไร
create or replace function analytics.content_post_hook_check_(p_shop_id uuid, p_step_id uuid, p_hook_id uuid)
 returns void
 language plpgsql
 stable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_origin text;
  v_step   uuid;
begin
  select h.origin, h.step_id into v_origin, v_step
    from analytics.content_hook h where h.id = p_hook_id and h.shop_id = p_shop_id;
  if not found then
    raise exception 'ไม่พบ hook ในร้านนี้' using errcode = '22023';
  end if;
  if v_origin <> 'ours' then
    raise exception 'hook ของเขาใช้ผูกโพสต์ไม่ได้ — ให้ถอดโครงเป็น hook ของเราก่อน' using errcode = '22023';
  end if;
  if v_step is distinct from p_step_id then
    raise exception 'hook นี้ไม่ใช่ของชิ้นงานนี้' using errcode = '22023';
  end if;
end;
$f$;

-- ============================================================================
-- 2. content_piece_post — วางลิงก์ + เลือก hook + ขยับสถานะ posted ในคำสั่งเดียว (owner เท่านั้น)
--    errcode: 22023 อินพุตผิด · 42501 ไม่ใช่เจ้าของ · 55000 ติดสถานะ/ผูกซ้ำ
--    ลำดับล็อก: step → post (ทุก RPC ในไฟล์นี้) · ตรวจทุกอย่างก่อนเขียน — ถึงจะ raise ทีหลัง ทรานแซกชันของ RPC ถอยหมดอยู่แล้ว
-- ============================================================================

create or replace function analytics.content_piece_post(
  p_shop_id uuid,
  p_step_id uuid,
  p_platform text,
  p_external_id text,
  p_post_url text,
  p_posted_at timestamptz,
  p_actor_role text,
  p_hook_id uuid default null,
  p_hook_other_text text default null,
  p_hook_other_type text default null,
  p_caption text default null
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_ext        text := btrim(coalesce(p_external_id, ''));
  v_url        text := btrim(coalesce(p_post_url, ''));
  v_other      text := nullif(analytics.content_text_clean(p_hook_other_text), '');
  v_s          analytics.campaign_step%rowtype;
  v_art        uuid;
  v_hook       uuid := p_hook_id;
  v_post       uuid;
  v_ex_step    uuid;
  v_ex_art     uuid;
  v_was_posted boolean;
  v_linked     boolean;
  v_appr       timestamptz;
begin
  if p_shop_id is null or p_step_id is null or p_platform is null or p_posted_at is null or v_ext = '' or v_url = '' then
    raise exception 'content_piece_post: ต้องระบุร้าน ชิ้นงาน platform external_id ลิงก์ และเวลาโพสต์' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner'], 'content_piece_post');
  if p_platform not in ('tiktok', 'facebook', 'instagram') then
    raise exception 'content_piece_post: platform ต้องเป็น tiktok, facebook หรือ instagram (LINE ไม่มีลิงก์โพสต์ — ใช้ content_piece_advance posted)'
      using errcode = '22023';
  end if;
  if not analytics.content_url_ok(v_url) then
    raise exception 'content_piece_post: ลิงก์โพสต์ไม่ถูกต้อง (ต้องเป็น http/https ยาวไม่เกิน 500 ไม่มี user@ ช่องว่าง \ < > ")' using errcode = '22023';
  end if;
  -- QA-I6: ขอบวันโพสต์ — ปฏิเสธ ±infinity (posted_date_th = infinity ทำให้ view ทั้งร้านอ่านไม่ได้) · ก่อน 2025-01-01 (เวลาไทย) · อนาคตเกิน 1 วัน
  -- (content_post_upsert เดิมปฏิเสธ > now() อยู่แล้ว — ขอบ +1 วันที่นี่คือด่านของตัวเองที่ไม่พึ่งฟังก์ชันเดิม)
  if p_posted_at in ('infinity'::timestamptz, '-infinity'::timestamptz)
     or p_posted_at < timestamptz '2025-01-01 00:00:00+07' or p_posted_at > now() + interval '1 day' then
    raise exception 'content_piece_post: เวลาโพสต์อยู่นอกช่วงที่ยอมรับ (ต้องไม่ก่อน 2025-01-01 และไม่อยู่ในอนาคต)' using errcode = '22023';
  end if;
  -- S-L3: caption เพดาน 2,200 ตัวอักษร (เทียบหลัง btrim เหมือนที่ content_post_upsert เก็บ)
  if p_caption is not null and length(btrim(p_caption)) > 2200 then
    raise exception 'content_piece_post: caption ยาวเกิน 2,200 ตัวอักษร' using errcode = '22023';
  end if;
  -- hook: เลือกของเดิม หรือเขียน "อื่นๆ" อย่างใดอย่างหนึ่ง · ไม่เลือกเลย = ได้ (Q6: ไม่บังคับที่ DB)
  if p_hook_id is not null and (p_hook_other_text is not null or p_hook_other_type is not null) then
    raise exception 'content_piece_post: เลือก hook เดิม (p_hook_id) หรือเขียน hook อื่น (ข้อความ+ประเภท) อย่างใดอย่างหนึ่ง ไม่ใช่ทั้งคู่' using errcode = '22023';
  end if;
  if (p_hook_other_text is null) <> (p_hook_other_type is null) then
    raise exception 'content_piece_post: hook อื่นต้องส่งทั้งข้อความและประเภท (ไม่เดาประเภทให้)' using errcode = '22023';
  end if;
  if p_hook_other_text is not null then
    if v_other is null or length(v_other) > 500 then
      raise exception 'content_piece_post: ข้อความ hook อื่นต้องยาว 1-500 ตัวอักษร' using errcode = '22023';
    end if;
    if analytics.content_marker_present(v_other) then
      raise exception 'content_piece_post: ข้อความ hook อื่นมี [ต้องยืนยัน อยู่ — ตอบคำถามก่อนแล้วค่อยบันทึก' using errcode = '22023';
    end if;
  end if;

  select * into v_s from analytics.campaign_step s where s.id = p_step_id and s.shop_id = p_shop_id for update;
  if not found then
    raise exception 'content_piece_post: ไม่พบชิ้นงานในร้านนี้' using errcode = '22023';
  end if;
  if v_s.piece_status is null then
    raise exception 'content_piece_post: ชิ้นงานนี้อยู่นอก workflow ใหม่' using errcode = '22023';
  end if;
  if v_s.piece_status not in ('approved', 'produced', 'posted') then
    raise exception 'content_piece_post: โพสต์ได้เฉพาะชิ้นที่อนุมัติแล้ว (approved/produced) — ชิ้นนี้อยู่สถานะ %', v_s.piece_status using errcode = '55000';
  end if;
  if v_s.hold_reason is not null then
    raise exception 'content_piece_post: ชิ้นงานรอเงื่อนไขอยู่ (%) — กด resume ก่อน', v_s.hold_reason using errcode = '55000';
  end if;
  if v_s.piece_kind is null then
    raise exception 'content_piece_post: ยังไม่ได้ระบุชนิดชิ้นงาน (piece_kind) — โพสต์ไม่ได้' using errcode = '55000';
  end if;
  if v_s.piece_kind in ('line_message', 'story') then
    raise exception 'content_piece_post: ชิ้นชนิด % ไม่มีลิงก์โพสต์ — ใช้ content_piece_advance (posted)', v_s.piece_kind using errcode = '55000';
  end if;
  if not analytics.content_post_platform_ok_(v_s.piece_kind, p_platform) then
    raise exception 'content_piece_post: ชิ้นชนิด % โพสต์บน % ไม่ได้', v_s.piece_kind, p_platform using errcode = '22023';
  end if;
  v_was_posted := v_s.piece_status = 'posted';
  if v_was_posted and v_s.piece_kind <> 'ig_fb_post' then
    raise exception 'content_piece_post: ชิ้นนี้โพสต์แล้ว (เพิ่มโพสต์ใบที่ 2 ได้เฉพาะชิ้น ig_fb_post)' using errcode = '55000';
  end if;
  if exists (select 1 from analytics.content_post cp
              where cp.step_id = p_step_id and cp.shop_id = p_shop_id and cp.platform = p_platform and cp.status = 'active') then
    raise exception 'content_piece_post: ชิ้นนี้มีโพสต์ % ที่ใช้งานอยู่แล้ว (1 platform ต่อชิ้น 1 โพสต์) — ปลดผูกใบเดิมก่อนถ้าจะเปลี่ยน', p_platform
      using errcode = '55000';
  end if;

  select a.id into v_art from analytics.step_artifact a
   where a.step_id = p_step_id and a.shop_id = p_shop_id order by a.created_at, a.id limit 1;

  -- โพสต์เดิม (shop+platform+external_id) ที่ผูกชิ้นอื่น/ชิ้นนี้อยู่ ต้องตกก่อน upsert — upsert จะทับ post_url/posted_at ของมัน
  select cp.step_id, cp.artifact_id into v_ex_step, v_ex_art from analytics.content_post cp
   where cp.shop_id = p_shop_id and cp.platform = p_platform and cp.external_id = v_ext for update;
  if found then
    if v_ex_step is not null then
      if v_ex_step = p_step_id then
        raise exception 'content_piece_post: โพสต์นี้ผูกกับชิ้นนี้อยู่แล้ว' using errcode = '55000';
      end if;
      raise exception 'content_piece_post: โพสต์นี้ผูกกับชิ้นงานอื่นอยู่ — ปลดผูก (content_post_unlink_step) ก่อน' using errcode = '55000';
    end if;
    -- S-M2: กติกาเดียวกับ content_post_link_step — โพสต์เดิมที่ผูกเอกสารของชิ้นอื่นอยู่ (artifact_id ไม่ว่างและไม่ใช่ของชิ้นนี้) ผูกกับชิ้นนี้ไม่ได้
    -- (ไม่ปล่อยให้ upsert ย้าย artifact_id ไปชิ้นนี้เงียบ ๆ)
    if v_ex_art is not null and v_ex_art is distinct from v_art then
      raise exception 'content_piece_post: โพสต์นี้ผูกกับเอกสารของชิ้นงานอื่นอยู่' using errcode = '55000';
    end if;
  end if;

  if p_hook_id is not null then
    perform analytics.content_post_hook_check_(p_shop_id, p_step_id, p_hook_id);
  elsif v_other is not null then
    -- D: hook อื่น = แถว ours label null ของ step นี้ · guard ของ 0159 ปฏิเสธเพิ่ม hook บนชิ้น approved+ ⇒ ข้ามเฉพาะรอบ call นี้ (reset ทั้งทาง ok/raise)
    begin
      perform set_config('c2.piece_rpc', '1', true);
      v_hook := analytics.content_hook_upsert(p_shop_id, p_step_id, null, v_other, p_hook_other_type, null, 'owner', null);
      perform set_config('c2.piece_rpc', '', true);
    exception when others then
      perform set_config('c2.piece_rpc', '', true);
      raise;
    end;
  end if;

  -- ห่อฟังก์ชันเดิม (ไม่แตะ): validate ลิงก์/วันอนาคต/สถานะ deleted ตกที่นั่น · ทรานแซกชันเดียวกัน
  v_post := analytics.content_post_upsert(p_shop_id, p_platform, v_ext, v_url, p_posted_at, v_s.content_type_code, v_art, p_caption);

  -- S-M1: compare-and-set — ผูกได้เฉพาะแถวที่ step_id ยังว่าง ณ ตอนเขียน · ถ้ามีอีกคำสั่งผูกโพสต์นี้ไปก่อน (กดโพสต์ 2 ชิ้นพร้อมกันด้วยลิงก์เดียวกัน
  -- ทั้งที่ทั้งคู่ผ่านด่านด้านบนมาแล้ว) แถวนี้จะไม่ถูกเขียนทับ ⇒ raise ถอยทั้งก้อนรวมสถานะ posted · GUC เปิดเฉพาะคำสั่ง update นี้ (ผ่านด่านตาราง S-M3)
  perform set_config('c2.piece_rpc', '1', true);
  update analytics.content_post set step_id = p_step_id, hook_id = v_hook where id = v_post and step_id is null;
  v_linked := found;
  perform set_config('c2.piece_rpc', '', true);
  if not v_linked then
    raise exception 'content_piece_post: โพสต์นี้เพิ่งถูกผูกกับชิ้นงานอื่นโดยคำสั่งอื่น — ลองใหม่' using errcode = '55000';
  end if;

  if not v_was_posted then
    perform analytics.content_piece_transition_(p_shop_id, p_step_id, 'posted', 'owner', null, null, v_post);
  else
    -- S-L1: เวลาโพสต์ก่อนเวลาอนุมัติล่าสุด = ไม่บล็อก แต่ทำธงใน payload (ทางผูกใบแรกทำใน content_piece_transition_)
    select e.created_at into v_appr from analytics.content_piece_event e
     where e.step_id = p_step_id and e.event_kind = 'advance' and e.to_status = 'approved' order by e.seq desc limit 1;
    insert into analytics.content_piece_event (shop_id, step_id, event_kind, from_status, to_status, actor_role, actor_uid, payload)
    values (p_shop_id, p_step_id, 'post', 'posted', 'posted', 'owner', auth.uid(),
            jsonb_build_object('post_id', v_post, 'additional', true, 'platform', p_platform)
            || case when p_posted_at < v_appr then jsonb_build_object('posted_before_approval', true) else '{}'::jsonb end);
  end if;

  return jsonb_build_object('post_id', v_post, 'step_id', p_step_id, 'piece_status', 'posted', 'hook_id', to_jsonb(v_hook),
                            'additional', v_was_posted);
end;
$f$;

-- ============================================================================
-- 3. content_post_link_step — ผูกโพสต์นอกแผน (ที่ลงใน content_post แล้ว) กับชิ้นงานทีหลัง
--    กันผูกข้ามร้าน (หา step/post ด้วย shop_id ตั้งแต่ where) · กันผูกโพสต์เดียวกับ 2 ชิ้น (step_id ต้องว่าง)
-- ============================================================================

create or replace function analytics.content_post_link_step(
  p_shop_id uuid,
  p_post_id uuid,
  p_step_id uuid,
  p_actor_role text,
  p_hook_id uuid default null
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_s          analytics.campaign_step%rowtype;
  v_p          analytics.content_post%rowtype;
  v_art        uuid;
  v_was_posted boolean;
  v_linked     boolean;
  v_appr       timestamptz;
begin
  if p_shop_id is null or p_post_id is null or p_step_id is null then
    raise exception 'content_post_link_step: ต้องระบุร้าน โพสต์ และชิ้นงาน' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner'], 'content_post_link_step');

  select * into v_s from analytics.campaign_step s where s.id = p_step_id and s.shop_id = p_shop_id for update;
  if not found then
    raise exception 'content_post_link_step: ไม่พบชิ้นงานในร้านนี้' using errcode = '22023';
  end if;
  select * into v_p from analytics.content_post cp where cp.id = p_post_id and cp.shop_id = p_shop_id for update;
  if not found then
    raise exception 'content_post_link_step: ไม่พบโพสต์ในร้านนี้' using errcode = '22023';
  end if;

  if v_s.piece_status is null then
    raise exception 'content_post_link_step: ชิ้นงานนี้อยู่นอก workflow ใหม่' using errcode = '22023';
  end if;
  if v_p.status <> 'active' then
    raise exception 'content_post_link_step: โพสต์สถานะ % ผูกกับชิ้นงานไม่ได้ (ต้อง active)', v_p.status using errcode = '55000';
  end if;
  if v_p.step_id is not null then
    raise exception 'content_post_link_step: โพสต์นี้ผูกกับชิ้นงาน% อยู่แล้ว — ปลดผูก (content_post_unlink_step) ก่อน',
      case when v_p.step_id = p_step_id then 'นี้' else 'อื่น' end using errcode = '55000';
  end if;
  -- QA-I6: โพสต์ที่ posted_at หลุดช่วง (±infinity · ก่อน 2025 · อนาคตเกิน 1 วัน — เข้ามาทางคิวเดิม) ผูกกับชิ้นงานไม่ได้ ไม่งั้น view ที่ join ชิ้นงานพังทั้งร้าน
  if v_p.posted_at in ('infinity'::timestamptz, '-infinity'::timestamptz)
     or v_p.posted_at < timestamptz '2025-01-01 00:00:00+07' or v_p.posted_at > now() + interval '1 day' then
    raise exception 'content_post_link_step: เวลาโพสต์ของโพสต์นี้อยู่นอกช่วงที่ยอมรับ — แก้เวลาโพสต์ผ่านคิววางลิงก์ก่อนผูก' using errcode = '22023';
  end if;
  v_was_posted := v_s.piece_status = 'posted';
  -- C: posted + ig_fb_post = โพสต์ใบที่ 2 นอกแผน (กติกาเดียวกับ content_piece_post)
  if v_s.piece_status not in ('approved', 'produced') and not (v_was_posted and v_s.piece_kind = 'ig_fb_post') then
    raise exception 'content_post_link_step: ผูกได้เฉพาะชิ้นที่ approved/produced (หรือ ig_fb_post ที่โพสต์แล้ว) — ชิ้นนี้อยู่สถานะ %', v_s.piece_status
      using errcode = '55000';
  end if;
  if v_s.hold_reason is not null then
    raise exception 'content_post_link_step: ชิ้นงานรอเงื่อนไขอยู่ (%) — กด resume ก่อน', v_s.hold_reason using errcode = '55000';
  end if;
  if v_s.piece_kind is null or v_s.piece_kind in ('line_message', 'story') then
    raise exception 'content_post_link_step: ชิ้นชนิด % ไม่มีลิงก์โพสต์ผูกไม่ได้', coalesce(v_s.piece_kind, 'ยังไม่ระบุ') using errcode = '55000';
  end if;
  if not analytics.content_post_platform_ok_(v_s.piece_kind, v_p.platform) then
    raise exception 'content_post_link_step: ชิ้นชนิด % ผูกกับโพสต์ % ไม่ได้', v_s.piece_kind, v_p.platform using errcode = '22023';
  end if;
  if exists (select 1 from analytics.content_post cp
              where cp.step_id = p_step_id and cp.shop_id = p_shop_id and cp.platform = v_p.platform and cp.status = 'active') then
    raise exception 'content_post_link_step: ชิ้นนี้มีโพสต์ % ที่ใช้งานอยู่แล้ว (1 platform ต่อชิ้น 1 โพสต์)', v_p.platform using errcode = '55000';
  end if;
  if p_hook_id is not null then
    perform analytics.content_post_hook_check_(p_shop_id, p_step_id, p_hook_id);
  end if;

  select a.id into v_art from analytics.step_artifact a
   where a.step_id = p_step_id and a.shop_id = p_shop_id order by a.created_at, a.id limit 1;
  if v_p.artifact_id is not null and v_p.artifact_id is distinct from v_art then
    raise exception 'content_post_link_step: โพสต์นี้ผูกกับเอกสารของชิ้นงานอื่นอยู่' using errcode = '55000';
  end if;

  -- แถวโพสต์ถูกล็อก (for update) ตั้งแต่ด้านบนและอ่าน step_id ซ้ำหลังล็อกแล้ว — "and step_id is null + found" เป็นเข็มขัดสองชั้นแบบเดียวกับ content_piece_post (S-M1)
  perform set_config('c2.piece_rpc', '1', true);
  update analytics.content_post set step_id = p_step_id, hook_id = p_hook_id, artifact_id = coalesce(artifact_id, v_art)
   where id = p_post_id and step_id is null;
  v_linked := found;
  perform set_config('c2.piece_rpc', '', true);
  if not v_linked then
    raise exception 'content_post_link_step: โพสต์นี้เพิ่งถูกผูกกับชิ้นงานอื่นโดยคำสั่งอื่น — ลองใหม่' using errcode = '55000';
  end if;

  if not v_was_posted then
    perform analytics.content_piece_transition_(p_shop_id, p_step_id, 'posted', 'owner', null, null, p_post_id);
  else
    -- S-L1: ธง posted_before_approval (ทางผูกใบแรกทำใน content_piece_transition_)
    select e.created_at into v_appr from analytics.content_piece_event e
     where e.step_id = p_step_id and e.event_kind = 'advance' and e.to_status = 'approved' order by e.seq desc limit 1;
    insert into analytics.content_piece_event (shop_id, step_id, event_kind, from_status, to_status, actor_role, actor_uid, payload)
    values (p_shop_id, p_step_id, 'post', 'posted', 'posted', 'owner', auth.uid(),
            jsonb_build_object('post_id', p_post_id, 'additional', true, 'platform', v_p.platform, 'linked', true)
            || case when v_p.posted_at < v_appr then jsonb_build_object('posted_before_approval', true) else '{}'::jsonb end);
  end if;

  return jsonb_build_object('post_id', p_post_id, 'step_id', p_step_id, 'piece_status', 'posted', 'hook_id', to_jsonb(p_hook_id),
                            'additional', v_was_posted);
end;
$f$;

-- ============================================================================
-- 4. content_post_unlink_step — ถอดโพสต์ออกจากชิ้นงาน (owner + เหตุผล) · โพสต์ไม่ถูกลบ (ยังอยู่คิวยอดในฐานะนอกแผน) · ล้าง step_id/hook_id/artifact_id
--    ชิ้นที่ posted แล้วไม่เหลือโพสต์ active ⇒ ถอย posted→produced ด้วยเหตุผลเดียวกัน (event unpost)
-- ============================================================================

create or replace function analytics.content_post_unlink_step(
  p_shop_id uuid,
  p_post_id uuid,
  p_reason text,
  p_actor_role text
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_reason    text := nullif(analytics.content_text_clean(p_reason), '');
  v_step      uuid;
  v_s         analytics.campaign_step%rowtype;
  v_cur       uuid;
  v_remaining int;
begin
  if p_shop_id is null or p_post_id is null then
    raise exception 'content_post_unlink_step: ต้องระบุร้านและโพสต์' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner'], 'content_post_unlink_step');
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'content_post_unlink_step: ต้องระบุเหตุผล 3-500 ตัวอักษร' using errcode = '22023';
  end if;

  -- อ่าน step_id ก่อน (ไม่ล็อก) เพื่อล็อกตามลำดับ step → post เหมือน RPC อื่น แล้วค่อยตรวจซ้ำหลังล็อก
  select cp.step_id into v_step from analytics.content_post cp where cp.id = p_post_id and cp.shop_id = p_shop_id;
  if not found then
    raise exception 'content_post_unlink_step: ไม่พบโพสต์ในร้านนี้' using errcode = '22023';
  end if;
  if v_step is null then
    raise exception 'content_post_unlink_step: โพสต์นี้ไม่ได้ผูกกับชิ้นงานใด' using errcode = '55000';
  end if;
  select * into v_s from analytics.campaign_step s where s.id = v_step and s.shop_id = p_shop_id for update;
  if not found then
    raise exception 'content_post_unlink_step: ไม่พบชิ้นงานของโพสต์นี้ในร้านนี้' using errcode = '22023';
  end if;
  select cp.step_id into v_cur from analytics.content_post cp where cp.id = p_post_id and cp.shop_id = p_shop_id for update;
  if v_cur is distinct from v_step then
    raise exception 'content_post_unlink_step: โพสต์นี้เพิ่งถูกผูก/ปลดโดยคำสั่งอื่น — ลองใหม่' using errcode = '55000';
  end if;

  -- ล้าง artifact_id ด้วย (S-M2 · ตัดสินใจกลับสเปก): artifact_id ที่ค้างของชิ้นเดิมทำให้ด่าน "โพสต์ผูกเอกสารของชิ้นอื่น" ปฏิเสธการผูกเข้าชิ้นที่ถูกตลอดไป
  -- ผูกใหม่ภายหลังเติม artifact_id ของชิ้นใหม่ให้เอง (link_step) · GUC เปิดเฉพาะคำสั่งนี้ (ผ่านด่านตาราง S-M3)
  perform set_config('c2.piece_rpc', '1', true);
  update analytics.content_post set step_id = null, hook_id = null, artifact_id = null where id = p_post_id;
  perform set_config('c2.piece_rpc', '', true);

  select count(*)::int into v_remaining from analytics.content_post cp
   where cp.step_id = v_step and cp.shop_id = p_shop_id and cp.status = 'active';

  if v_s.piece_status = 'posted' and coalesce(v_s.piece_kind in ('short_clip', 'live_cut', 'ig_fb_post'), false) and v_remaining = 0 then
    perform analytics.content_piece_transition_(p_shop_id, v_step, 'produced', 'owner', v_reason, null, null);
  else
    -- E: ยังเหลือโพสต์ active ใบอื่น (หรือชิ้นไม่ได้อยู่ posted) — สถานะไม่ถอย แต่ประวัติผูก/ปลดต้องมี
    insert into analytics.content_piece_event (shop_id, step_id, event_kind, from_status, to_status, reason, actor_role, actor_uid, payload)
    values (p_shop_id, v_step, 'unpost', v_s.piece_status, v_s.piece_status, v_reason, 'owner', auth.uid(),
            jsonb_build_object('post_id', p_post_id, 'remaining_active_posts', v_remaining));
  end if;

  return jsonb_build_object('post_id', p_post_id, 'step_id', v_step,
                            'piece_status', (select s.piece_status from analytics.campaign_step s where s.id = v_step),
                            'remaining_active_posts', v_remaining);
end;
$f$;

-- ============================================================================
-- 4b. ด่านระดับตาราง content_post (S-M3 · S-L2) — service_role ข้าม RLS/RPC ได้เสมอ (rolbypassrls) ⇒ กฎ "ผูกโพสต์กับชิ้นงาน" ต้องมีที่ตารางด้วย
--     แพทเทิร์นเดียวกับ content_piece_guard_step (0159): ข้ามได้เมื่อ GUC c2.piece_rpc='1' และ current_user ไม่ใช่ service_role/authenticated/anon
--     (RPC security definer รันเป็นเจ้าของฟังก์ชัน ⇒ ผ่าน · service_role ที่ตั้ง GUC เองยังรัน current_user = service_role ⇒ ไม่ผ่าน)
--     ห้าม (55000): INSERT ที่มี step_id/hook_id · UPDATE ที่เปลี่ยน step_id/hook_id · UPDATE ที่เปลี่ยน artifact_id ของโพสต์ที่ผูก step แล้ว
--     ปล่อย: คิวเดิม (content_post_upsert) ที่ไม่แตะ step_id/hook_id · เปลี่ยน artifact_id ของโพสต์ที่ "ยังไม่ผูก step" (โพสต์นอกแผนผูกเอกสารทีหลัง) ·
--            FK on delete set null ของ step_id/hook_id/artifact_id (pg_trigger_depth() > 1 และเปลี่ยนเป็น null อย่างเดียว — ไม่งั้นลบ hook/เอกสารไม่ได้)
--     I2 (รอบ 3): INSERT/เปลี่ยน posted_at ของโพสต์ที่ผูกชิ้นแล้ว ต้อง finite และอยู่ใน [2025-01-01 ไทย, now()+1 วัน] → 22023 (ก่อนทางลัดทุกทาง) · ทางลัด FK set null ต้องพิสูจน์ว่า parent ถูกลบจริง
--     S-L2: เปิดโพสต์ที่ไม่ active กลับเป็น active ขณะที่ยังผูกชิ้นอยู่ ถ้าชิ้นนั้นมีโพสต์ active platform เดียวกันอยู่แล้ว = 55000 (เช็คก่อน GUC —
--           เป็น invariant ของข้อมูล ไม่ใช่สิทธิ์: ไม่ว่าเส้นทางไหนก็ต้องไม่ให้ชิ้นมี 2 โพสต์ active บน platform เดียว)
-- ============================================================================

create or replace function analytics.content_post_guard_link()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
begin
  -- QA/security รอบ 3 · I2: โพสต์ที่ผูกชิ้นงานแล้ว posted_at ต้องอยู่ในช่วงเดียวกับที่ content_piece_post ตรวจ — บล็อกนี้อยู่บนสุด (ก่อนทางลัด depth>1 และ GUC)
  --   เพราะคิวเดิม content_post_upsert ไม่ตรวจ ±infinity/ก่อน 2025 และเส้นทางไหนก็วางทับ posted_at ของโพสต์ที่ผูกแล้วได้ ⇒ view ที่ join ชิ้นงาน (age_days / posted_before_approval) ตก 22008 ทั้งร้าน
  --   เช็คเฉพาะตอน INSERT หรือ posted_at เปลี่ยน (UPDATE อื่น เช่น FK set null / เปลี่ยน status ไม่โดน) · ช่วงเดียวกับ content_piece_post: [2025-01-01 00:00 ไทย, now()+1 วัน] และต้อง finite
  if new.step_id is not null
     and (tg_op = 'INSERT' or new.posted_at is distinct from old.posted_at)
     and (not isfinite(new.posted_at)
          or new.posted_at < timestamptz '2025-01-01 00:00:00+07'
          or new.posted_at > now() + interval '1 day') then
    raise exception 'โพสต์ที่ผูกชิ้นงานแล้ว เวลาโพสต์ต้องอยู่ในช่วง 2025-01-01 ถึงวันนี้' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' and new.status = 'active' and old.status is distinct from 'active' and new.step_id is not null
     and exists (select 1 from analytics.content_post cp
                  where cp.step_id = new.step_id and cp.shop_id = new.shop_id and cp.platform = new.platform
                    and cp.status = 'active' and cp.id <> new.id) then
    raise exception 'เปิดโพสต์กลับไม่ได้ — ชิ้นงานนี้มีโพสต์ % ที่ใช้งานอยู่แล้ว (1 platform ต่อชิ้น 1 โพสต์) · ปลดผูกใบนี้ก่อน (content_post_unlink_step)', new.platform
      using errcode = '55000';
  end if;

  -- FK action (on delete set null): UPDATE ที่ซ้อนใน trigger ของ RI · เคลียร์เป็น null ได้เฉพาะเมื่อ "พิสูจน์ได้ว่า parent ถูกลบจริงแล้ว"
  --   (ไม่พึ่งว่า depth>1 มาจาก RI เท่านั้น — trigger อื่นในอนาคตที่ซ้อนกันก็เคลียร์ step_id/hook_id/artifact_id ของโพสต์ไม่ได้ถ้า parent ยังอยู่)
  --   RI ของ on delete set null รันหลัง DELETE จบ ⇒ แถว parent ที่ถูกลบมองไม่เห็นแล้วใน snapshot ของ statement ถัดไป
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and new.status is not distinct from old.status
     and (new.step_id is not distinct from old.step_id
          or (new.step_id is null and not exists (select 1 from analytics.campaign_step st where st.id = old.step_id)))
     and (new.hook_id is not distinct from old.hook_id
          or (new.hook_id is null and not exists (select 1 from analytics.content_hook hk where hk.id = old.hook_id)))
     and (new.artifact_id is not distinct from old.artifact_id
          or (new.artifact_id is null and not exists (select 1 from analytics.step_artifact sa where sa.id = old.artifact_id))) then
    return new;
  end if;

  if coalesce(current_setting('c2.piece_rpc', true), '') = '1'
     and current_user not in ('service_role', 'authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.step_id is not null or new.hook_id is not null then
      raise exception 'ผูกโพสต์กับชิ้นงาน/hook ต้องผ่าน content_piece_post หรือ content_post_link_step เท่านั้น (ห้ามเขียน step_id/hook_id ตรง)' using errcode = '55000';
    end if;
    return new;
  end if;

  if new.step_id is distinct from old.step_id or new.hook_id is distinct from old.hook_id then
    raise exception 'ผูก/ปลด step_id หรือ hook_id ของโพสต์ต้องผ่าน content_piece_post · content_post_link_step · content_post_unlink_step เท่านั้น (ห้ามแก้ตรง)' using errcode = '55000';
  end if;
  if old.step_id is not null and new.artifact_id is distinct from old.artifact_id then
    raise exception 'โพสต์ที่ผูกชิ้นงานแล้วเปลี่ยนเอกสาร (artifact_id) ไม่ได้ — ปลดผูก (content_post_unlink_step) ก่อน' using errcode = '55000';
  end if;
  return new;
end;
$f$;

drop trigger if exists trg_content_post_link_guard on analytics.content_post;
create trigger trg_content_post_link_guard
  before insert or update on analytics.content_post
  for each row execute function analytics.content_post_guard_link();

-- ============================================================================
-- 5. content_piece_defer — เลื่อนวันชิ้นที่วางแผนแล้ว (owner + เหตุผล) · piece_status ไม่เปลี่ยน (↷ ไม่ใช่สถานะ)
--    ใช้ campaign_reschedule_step เดิม (ไม่แตะ) — ทางปฏิทินเดิมยังเลื่อนได้โดยไม่มี event (หนี้ D11)
-- ============================================================================

create or replace function analytics.content_piece_defer(
  p_shop_id uuid,
  p_step_id uuid,
  p_new_date date,
  p_reason text,
  p_actor_role text,
  p_new_time time default null
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_reason  text := nullif(analytics.content_text_clean(p_reason), '');
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
  v_s       analytics.campaign_step%rowtype;
  v_old     date;
begin
  if p_shop_id is null or p_step_id is null or p_new_date is null then
    raise exception 'content_piece_defer: ต้องระบุร้าน ชิ้นงาน และวันใหม่' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner'], 'content_piece_defer');
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'content_piece_defer: ต้องระบุเหตุผล 3-500 ตัวอักษร' using errcode = '22023';
  end if;
  if p_new_date < date '2025-01-01' or p_new_date > v_today + 1100 then
    raise exception 'content_piece_defer: วันที่อยู่นอกช่วงที่ยอมรับ' using errcode = '22023';
  end if;

  select * into v_s from analytics.campaign_step s where s.id = p_step_id and s.shop_id = p_shop_id for update;
  if not found then
    raise exception 'content_piece_defer: ไม่พบชิ้นงานในร้านนี้' using errcode = '22023';
  end if;
  if v_s.piece_status is null then
    raise exception 'content_piece_defer: ชิ้นงานนี้อยู่นอก workflow ใหม่' using errcode = '22023';
  end if;
  if v_s.piece_status = 'idea' then
    raise exception 'content_piece_defer: ไอเดียยังไม่ได้วางแผน — ตั้งวันด้วย content_piece_set_plan (date)' using errcode = '55000';
  end if;
  if v_s.piece_status in ('posted', 'cancelled') then
    raise exception 'content_piece_defer: ชิ้นงานสถานะ % เลื่อนวันไม่ได้', v_s.piece_status using errcode = '55000';
  end if;

  select case when c.anchor_date is null then null else c.anchor_date + v_s.offset_start_days end into v_old
    from analytics.campaign c where c.id = v_s.campaign_id;
  if v_old is null then
    raise exception 'content_piece_defer: ชิ้นงานนี้ยังไม่มีวัน (anchor) — ตั้งวันด้วย content_piece_set_plan (date)' using errcode = '55000';
  end if;
  if p_new_date = v_old and (p_new_time is null or p_new_time is not distinct from v_s.start_time) then
    raise exception 'content_piece_defer: วัน/เวลาเท่าเดิมอยู่แล้ว (%)', v_old using errcode = '55000';
  end if;

  perform analytics.campaign_reschedule_step(p_step_id, p_new_date, p_new_time, false);

  insert into analytics.content_piece_event (shop_id, step_id, event_kind, from_status, to_status, reason, actor_role, actor_uid, payload)
  values (p_shop_id, p_step_id, 'defer', v_s.piece_status, v_s.piece_status, v_reason, 'owner', auth.uid(),
          jsonb_build_object('from_date', v_old, 'to_date', p_new_date, 'new_time', to_jsonb(p_new_time)));

  return jsonb_build_object('step_id', p_step_id, 'piece_status', v_s.piece_status, 'from_date', v_old, 'to_date', p_new_date);
end;
$f$;

-- ============================================================================
-- 6. view — ใหม่ทั้งหมด · security_invoker · ไม่ replace view เดิม · วันไทยทุกจุด (trap #6 — ไม่มี current_date) · ไม่มีชื่อจริงโฮสต์
-- ============================================================================

-- ปฏิทิน: ชิ้นที่มีวัน (idea ไม่โผล่ — R18) และไม่ถูกยกเลิก + ธงการ์ด D
-- flag_no_link_overdue = produced + ชนิดมีลิงก์ + เกินวัน + ไม่มีโพสต์ active (สูตรเดียวกับ post_overdue_no_link ใน inbox)
create or replace view analytics.v_content_piece_calendar
  with (security_invoker = true) as
select
  p.*,
  coalesce(p.footage_status = 'needs_shoot', false) as flag_needs_shoot,
  (p.hold_reason is not null) as flag_on_hold,
  (p.confirm_pending > 0) as flag_confirm_pending,
  ap.n as active_post_n,
  (p.piece_status = 'produced'
     and coalesce(p.piece_kind in ('short_clip', 'live_cut', 'ig_fb_post'), false)
     and p.resolved_start < (now() at time zone 'Asia/Bangkok')::date
     and ap.n = 0) as flag_no_link_overdue
from analytics.v_content_piece p
cross join lateral (
  select count(*)::integer as n from jsonb_array_elements(p.posts) as e where e ->> 'status' = 'active'
) ap
where p.resolved_start is not null and p.piece_status <> 'cancelled';

comment on view analytics.v_content_piece_calendar is
  'v_content_piece เฉพาะชิ้นที่มีวัน (resolved_start) และไม่ cancelled + ธงการ์ด (needs_shoot · on_hold · confirm_pending · no_link_overdue) · idea ไม่โผล่ (R18)';

-- inbox 4 กอง: 1 แถว/ร้าน (public.shop) — ร้านที่ไม่มีชิ้นงานได้แถวเลข 0 ไม่ใช่ไม่มีแถว
-- สัปดาห์ไทย = จันทร์–อาทิตย์ (date_trunc('week') ของ PG เริ่มจันทร์) · review_over_limit = review_queue > 10 (แสดงเฉยๆ ไม่บังคับ — เลข 10 อยู่ที่นี่ที่เดียว)
create or replace view analytics.v_content_inbox_counts
  with (security_invoker = true) as
select
  sh.id as shop_id,
  c.post_today, c.post_overdue_no_link, c.review_queue,
  (c.review_queue > 10) as review_over_limit,
  c.ideas,
  (select count(*)::integer
     from analytics.step_gate g join analytics.campaign_step s on s.id = g.step_id
    where g.shop_id = sh.id and g.gate_kind = 'risk_owner' and g.status in ('pending', 'blocked')
      and s.piece_status in ('drafting', 'in_review')) as owner_questions,
  c.shoot_this_week,
  c.on_hold
from public.shop sh
cross join lateral (select (now() at time zone 'Asia/Bangkok')::date as d) t
cross join lateral (
  select
    (count(*) filter (where p.piece_status in ('approved', 'produced') and p.resolved_start <= t.d))::integer as post_today,
    (count(*) filter (where p.piece_status = 'produced'
                        and coalesce(p.piece_kind in ('short_clip', 'live_cut', 'ig_fb_post'), false)
                        and p.resolved_start < t.d
                        and not exists (select 1 from jsonb_array_elements(p.posts) as e where e ->> 'status' = 'active')))::integer as post_overdue_no_link,
    (count(*) filter (where p.piece_status = 'in_review'))::integer as review_queue,
    (count(*) filter (where p.piece_status = 'idea'))::integer as ideas,
    (count(*) filter (where p.piece_status = 'approved' and p.footage_status = 'needs_shoot'
                        and p.resolved_start >= date_trunc('week', t.d::timestamp)::date
                        and p.resolved_start <= date_trunc('week', t.d::timestamp)::date + 6))::integer as shoot_this_week,
    (count(*) filter (where p.hold_reason is not null and p.piece_status not in ('posted', 'cancelled')))::integer as on_hold
  from analytics.v_content_piece p
  where p.shop_id = sh.id
) c;

comment on view analytics.v_content_inbox_counts is
  '1 แถว/ร้าน: post_today (approved/produced ถึงวัน) · post_overdue_no_link (produced ชนิดมีลิงก์ เกินวัน ไม่มีโพสต์ active) · review_queue (in_review) · '
  'review_over_limit (>10 แสดงเฉยๆ) · ideas · owner_questions (risk_owner pending/blocked ของชิ้น drafting/in_review) · shoot_this_week (approved needs_shoot จ-อา ไทย) · on_hold';

-- ตัวนับ LINE broadcast (มติ: ความถี่ ≤ 4 ครั้ง/28 วัน) — ไม่อ่าน content_post (ชิ้น LINE ไม่สร้างแถวนั้น) · วันโพสต์มาจาก event post (posted_on ของ v_content_piece)
create or replace view analytics.v_line_quota_28d
  with (security_invoker = true) as
select
  sh.id as shop_id,
  c.used_28d,
  c.planned_28d,
  c.overdue_planned,
  q.quota,
  greatest(q.quota - c.used_28d, 0) as remaining_28d,
  (c.used_28d + c.planned_28d > q.quota) as over_quota_planned
from public.shop sh
cross join (select 4::integer as quota) q
cross join lateral (select (now() at time zone 'Asia/Bangkok')::date as d) t
cross join lateral (
  select
    (count(*) filter (where p.piece_status = 'posted' and p.posted_on > t.d - 28 and p.posted_on <= t.d))::integer as used_28d,
    (count(*) filter (where p.piece_status in ('planned', 'drafting', 'in_review', 'approved', 'produced')
                        and p.resolved_start >= t.d and p.resolved_start <= t.d + 27))::integer as planned_28d,
    (count(*) filter (where p.piece_status in ('planned', 'drafting', 'in_review', 'approved', 'produced')
                        and p.resolved_start < t.d))::integer as overdue_planned
  from analytics.v_content_piece p
  where p.shop_id = sh.id and p.piece_kind = 'line_message'
) c;

comment on view analytics.v_line_quota_28d is
  'LINE broadcast ต่อร้าน: used_28d (posted ใน [วันนี้−27, วันนี้] ไทย) · planned_28d (planned..produced ใน [วันนี้, วันนี้+27]) · overdue_planned (เกินวันยังไม่โพสต์) · '
  'quota = 4 คงที่ที่เดียวใน view นี้ · over_quota_planned = used+planned > quota';

-- คลัง hook: ของเขา (reference) + ของเรา (ours) ตารางเดียว · ไม่มี account/ชื่อคน/ชื่อโฮสต์
-- สถิติต่อ hook_type นับเฉพาะ hook ours ที่ผูกโพสต์ active และมีผล T+7 · n = จำนวนชิ้น (distinct step) · n < 4 = 'ยังสรุปไม่ได้' (กฎ 4 ชิ้น — เลข 4 อยู่ที่นี่ที่เดียว)
-- แถว reference โชว์สถิติของประเภทเดียวกันของเรา (เทียบ) แต่ reference ไม่ถูกนับเข้าสถิติ
create or replace view analytics.v_content_hook_library
  with (security_invoker = true) as
with hook_post as (
  select p.hook_id, p.step_id, p.id as post_id, t7.t7_captured_on, t7.save_rate, t7.share_rate
    from analytics.content_post p
    join analytics.v_content_post_t7 t7 on t7.post_id = p.id
   where p.hook_id is not null and p.status = 'active'
),
per_hook as (
  select hp.hook_id,
         count(*)::integer as posts_n,
         (count(*) filter (where hp.t7_captured_on is not null))::integer as measured_n,
         round(avg(hp.save_rate) filter (where hp.t7_captured_on is not null), 4) as avg_save_rate,
         round(avg(hp.share_rate) filter (where hp.t7_captured_on is not null), 4) as avg_share_rate
    from hook_post hp
   group by hp.hook_id
),
per_type as (
  select h.shop_id, h.hook_type,
         (count(distinct hp.step_id) filter (where hp.t7_captured_on is not null))::integer as n_pieces,
         round(avg(hp.save_rate) filter (where hp.t7_captured_on is not null), 4) as avg_save_rate,
         round(avg(hp.share_rate) filter (where hp.t7_captured_on is not null), 4) as avg_share_rate
    from analytics.content_hook h
    join hook_post hp on hp.hook_id = h.id
   where h.origin = 'ours' and h.hook_type is not null
   group by h.shop_id, h.hook_type
)
select
  h.id as hook_id,
  h.shop_id,
  h.origin as side,
  h.text,
  h.hook_type,
  h.hook_type_raw,
  h.generated_by,
  h.derived_from_hook_id,
  h.source_signal_id,
  h.created_at,
  case when h.origin = 'ours' then h.step_id end as step_id,
  case when h.origin = 'ours' then cs.title end as step_title,
  case when h.origin = 'ours' then cs.piece_status end as piece_status,
  case when h.origin = 'ours' then cs.piece_kind end as piece_kind,
  case when h.origin = 'ours' then h.label end as label,
  case when h.origin = 'reference' then sg.platform end as ref_platform,
  case when h.origin = 'reference' then sg.views end as ref_views,
  case when h.origin = 'reference' then sg.account_followers end as ref_account_followers,
  case when h.origin = 'reference' then sg.url end as ref_url,
  case when h.origin = 'reference' then sg.seen_on end as ref_seen_on,
  case when h.origin = 'ours' then coalesce(ph.posts_n, 0) end as posts_n,
  case when h.origin = 'ours' then coalesce(ph.measured_n, 0) end as measured_n,
  case when h.origin = 'ours' then ph.avg_save_rate end as avg_save_rate,
  case when h.origin = 'ours' then ph.avg_share_rate end as avg_share_rate,
  coalesce(pt.n_pieces, 0) as type_n_pieces,
  pt.avg_save_rate as type_avg_save_rate,
  pt.avg_share_rate as type_avg_share_rate,
  case when h.hook_type is null then 'ยังไม่ติดประเภท'
       when coalesce(pt.n_pieces, 0) < 4 then 'ยังสรุปไม่ได้'
       else 'สรุปได้' end as type_verdict
from analytics.content_hook h
left join analytics.campaign_step cs on cs.id = h.step_id and h.origin = 'ours'
left join analytics.content_signal sg on sg.id = h.source_signal_id and h.origin = 'reference'
left join per_hook ph on ph.hook_id = h.id and h.origin = 'ours'
left join per_type pt on pt.shop_id = h.shop_id and pt.hook_type = h.hook_type;

comment on view analytics.v_content_hook_library is
  'คลัง hook ของเขา+ของเรา ตารางเดียว (side = origin) · ours: step/label/posts/ผล T+7 ต่อ hook · reference: ref_* จากคลิปต้นทาง (ไม่มี account) · '
  'type_*: สถิติสะสมต่อ hook_type นับเฉพาะ ours ที่ผูกโพสต์ active + มีผล T+7 · n = จำนวนชิ้น · n<4 = ยังสรุปไม่ได้ (กฎ 4 ชิ้น) · ไม่มีชื่อโฮสต์';

-- ============================================================================
-- 7. grant — revoke ครบสามชื่อ แล้ว grant service_role อย่างเดียว (trap #2/#18)
--    ฟังก์ชันวนจาก pg_proc ตามรายชื่อเดียวกับ snapshot/ด่านท้ายไฟล์ ⇒ ฟังก์ชันที่เพิ่ม/ลืม ไม่หลุด grant
-- ============================================================================

do $c3grant$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
       and p.proname ~ '^(content_piece_post$|content_piece_defer$|content_post_link_step$|content_post_unlink_step$|content_post_platform_ok_$|content_post_hook_check_$|content_post_guard_link$)'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end
$c3grant$;

revoke all on analytics.v_content_piece_calendar, analytics.v_content_inbox_counts, analytics.v_line_quota_28d,
  analytics.v_content_hook_library from public, anon, authenticated;
grant select on analytics.v_content_piece_calendar, analytics.v_content_inbox_counts, analytics.v_line_quota_28d,
  analytics.v_content_hook_library to service_role;

comment on function analytics.content_piece_post(uuid, uuid, text, text, text, timestamp with time zone, text, uuid, text, text, text) is
  'วางลิงก์โพสต์ + เลือก hook ที่ใช้จริง + ขยับชิ้นเป็น posted ในคำสั่งเดียว (owner เท่านั้น) · ห่อ content_post_upsert เดิม · hook ต้องเป็น ours ของชิ้นนั้น · '
  'ชิ้น LINE/story ไม่มีลิงก์ → content_piece_advance(posted) · ig_fb_post โพสต์ใบที่ 2 ได้ (1 platform 1 ใบ) · errcode 22023 อินพุต · 42501 ไม่ใช่เจ้าของ · 55000 ติดสถานะ/ผูกซ้ำ';

-- ============================================================================
-- 8. ด่านท้ายไฟล์ — ของเดิมต้องไม่ขยับ + ผลลัพธ์ต้องถูก (raise = ถอยทั้งก้อน · แบบ 0159 §22)
-- ============================================================================

do $c3final$
declare
  v_now text;
  v_bad text;
  v_k   text;
  c_fn  constant text := '^(content_piece_post$|content_piece_defer$|content_post_link_step$|content_post_unlink_step$|content_post_platform_ok_$|content_post_hook_check_$|content_post_guard_link$)';
begin
  foreach v_k in array array['c3.snap_post', 'c3.snap_step', 'c3.snap_artifact', 'c3.snap_gate', 'c3.snap_hook', 'c3.snap_event',
                             'c3.snap_views', 'c3.snap_funcs'] loop
    if coalesce(current_setting(v_k, true), '') = '' then
      raise exception '0160 ด่านท้าย: ไม่พบ snapshot % — ไฟล์นี้ต้องรันทั้งไฟล์ในทรานแซกชันเดียวผ่าน scripts/run-sql.mjs เท่านั้น (อย่าวางทีละก้อน)', v_k;
    end if;
  end loop;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, status, post_url, posted_at, artifact_id, step_id, hook_id,
           updated_at), E'\n' order by id), ''))
    into v_now from analytics.content_post;
  if v_now is distinct from current_setting('c3.snap_post', true) then
    raise exception '0160 ด่านท้าย: content_post เดิมเปลี่ยน (ไฟล์นี้ไม่มี backfill — แถวเดิมต้องไม่ขยับ)';
  end if;

  select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
         md5(coalesce(string_agg(concat_ws('|', id, status, piece_status, hold_reason, updated_at), E'\n' order by id), ''))
    into v_now from analytics.campaign_step;
  if v_now is distinct from current_setting('c3.snap_step', true) then
    raise exception '0160 ด่านท้าย: campaign_step เปลี่ยน (status/piece_status/hold/updated_at ต้องไม่ขยับ)';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, step_id, status, content_body,
           clip_brief::text, updated_at), E'\n' order by id), ''))
    into v_now from analytics.step_artifact;
  if v_now is distinct from current_setting('c3.snap_artifact', true) then
    raise exception '0160 ด่านท้าย: step_artifact เปลี่ยน';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', step_id, gate_kind, status, detail::text, passed_at,
           updated_at), E'\n' order by step_id, gate_kind), ''))
    into v_now from analytics.step_gate;
  if v_now is distinct from current_setting('c3.snap_gate', true) then
    raise exception '0160 ด่านท้าย: step_gate เปลี่ยน';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, shop_id, text, hook_type, origin, source_signal_id, step_id,
           label, generated_by, derived_from_hook_id, updated_at), E'\n' order by id), ''))
    into v_now from analytics.content_hook;
  if v_now is distinct from current_setting('c3.snap_hook', true) then
    raise exception '0160 ด่านท้าย: content_hook เปลี่ยน';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(id::text, ',' order by seq), ''))
    into v_now from analytics.content_piece_event;
  if v_now is distinct from current_setting('c3.snap_event', true) then
    raise exception '0160 ด่านท้าย: content_piece_event เปลี่ยน (ไฟล์นี้ไม่มี backfill — ต้องไม่มี event ใหม่ตอน apply)';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(c.relname || '=' || pg_get_viewdef(c.oid), E'\n' order by c.relname), ''))
    into v_now
    from pg_class c
   where c.relnamespace = 'analytics'::regnamespace and c.relkind = 'v'
     and c.relname not in ('v_content_piece_calendar', 'v_content_inbox_counts', 'v_line_quota_28d', 'v_content_hook_library');
  if v_now is distinct from current_setting('c3.snap_views', true) then
    raise exception '0160 ด่านท้าย: definition ของ view เดิมเปลี่ยน (รวม v_content_piece ของ 0159 — trap #3 ห้ามแตะ view เดิม)';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(p.oid::regprocedure::text || '=' || pg_get_functiondef(p.oid), E'\n'
           order by p.oid::regprocedure::text), ''))
    into v_now
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f' and p.proname !~ c_fn;
  if v_now is distinct from current_setting('c3.snap_funcs', true) then
    raise exception '0160 ด่านท้าย: มีฟังก์ชันเดิมที่ไม่ใช่ของไฟล์นี้ถูกเปลี่ยน/เพิ่ม/หาย (รวม 0158/0159 และ content_post_upsert)';
  end if;

  -- trap #1: ฟังก์ชันของไฟล์นี้ต้องมี signature เดียวต่อชื่อ
  select string_agg(x.proname || '=' || x.n, ', ') into v_bad
    from (select p.proname, count(*) as n from pg_proc p
           where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f' and p.proname ~ c_fn
           group by p.proname having count(*) > 1) x;
  if v_bad is not null then
    raise exception '0160 ด่านท้าย: ฟังก์ชันมี overload ค้าง — หยุดแล้วรายงาน: %', v_bad;
  end if;
  select count(*) into v_now from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname ~ c_fn;
  if v_now::int <> 7 then
    raise exception '0160 ด่านท้าย: คาดฟังก์ชันของไฟล์นี้ 7 ตัว (helper 2 + RPC 4 + trigger 1) พบ %', v_now;
  end if;

  -- S-M3: trigger ด่านตารางต้องมีและเปิดอยู่ (tgenabled = 'O') · ชี้ฟังก์ชันที่ถูกตัว · BEFORE ROW ครอบทั้ง INSERT และ UPDATE
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'analytics.content_post'::regclass and t.tgname = 'trg_content_post_link_guard' and not t.tgisinternal
                    and t.tgenabled = 'O' and t.tgfoid = 'analytics.content_post_guard_link()'::regprocedure
                    and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 16) then
    raise exception '0160 ด่านท้าย: trigger trg_content_post_link_guard ไม่ครบ (ต้อง BEFORE INSERT OR UPDATE FOR EACH ROW เปิดอยู่)';
  end if;

  -- trap #18: ไม่มี PUBLIC/anon/authenticated ถือ EXECUTE (coalesce proacl — default = PUBLIC execute)
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.pronamespace = 'analytics'::regnamespace and p.proname ~ c_fn and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  if v_bad is not null then
    raise exception '0160 ด่านท้าย: grant รั่ว (PUBLIC/anon/authenticated) บนฟังก์ชัน %', v_bad;
  end if;
  select string_agg(c.relname || ':' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ', ') into v_bad
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.relnamespace = 'analytics'::regnamespace
     and c.relname in ('v_content_piece_calendar', 'v_content_inbox_counts', 'v_line_quota_28d', 'v_content_hook_library')
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  if v_bad is not null then
    raise exception '0160 ด่านท้าย: grant รั่วบน view: %', v_bad;
  end if;
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c
   where c.relnamespace = 'analytics'::regnamespace
     and c.relname in ('v_content_piece_calendar', 'v_content_inbox_counts', 'v_line_quota_28d', 'v_content_hook_library')
     and not coalesce(c.reloptions @> array['security_invoker=true'], false);
  if v_bad is not null then
    raise exception '0160 ด่านท้าย: view ไม่ได้เป็น security_invoker: %', v_bad;
  end if;

  -- K21: วันไทย — ไม่มี current_date ใน view/ฟังก์ชันใหม่ · view ที่คิดวันต้องมี Asia/Bangkok · ไม่มีชื่อจริงโฮสต์/ชื่อบัญชี
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c
   where c.relnamespace = 'analytics'::regnamespace
     and c.relname in ('v_content_piece_calendar', 'v_content_inbox_counts', 'v_line_quota_28d', 'v_content_hook_library')
     and (pg_get_viewdef(c.oid) ~* 'current_date' or pg_get_viewdef(c.oid) ~* 'display_name');
  if v_bad is not null then
    raise exception '0160 ด่านท้าย: view มี current_date หรือ display_name (วันไทยเท่านั้น · ไม่มีชื่อจริงโฮสต์): %', v_bad;
  end if;
  if pg_get_viewdef('analytics.v_content_inbox_counts'::regclass) !~ 'Asia/Bangkok'
     or pg_get_viewdef('analytics.v_line_quota_28d'::regclass) !~ 'Asia/Bangkok'
     or pg_get_viewdef('analytics.v_content_piece_calendar'::regclass) !~ 'Asia/Bangkok' then
    raise exception '0160 ด่านท้าย: view ที่คิดวันต้องใช้ Asia/Bangkok';
  end if;
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname ~ c_fn and pg_get_functiondef(p.oid) ~* 'current_date';
  if v_bad is not null then
    raise exception '0160 ด่านท้าย: ฟังก์ชันมี current_date: %', v_bad;
  end if;

  raise notice '0160 ด่านท้าย: ผ่าน — ของเดิมไม่ขยับ (post/step/artifact/gate/hook/event/view/ฟังก์ชัน รวม 0158/0159) · '
               'ไม่มี overload · grant สะอาด · view security_invoker · วันไทย';
end
$c3final$;

-- ให้ PostgREST รู้จักฟังก์ชัน/view ใหม่ทันที — ใน dry-run ที่ ROLLBACK ไม่ถูกส่งออกไป
notify pgrst, 'reload schema';

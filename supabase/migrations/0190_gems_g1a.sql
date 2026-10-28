-- 0190_gems_g1a.sql — G1a พลอย: แคตตาล็อก (ชนิด · รูปทรง · รายการขนาด) + ราคา (แยกตาราง · ออฟฟิศเท่านั้น) + BOM พลอยต่อใบงาน + แม่แบบพลอยของ SKU + ข้อมูลพลอยให้หน้าช่าง/A5
-- สถานะ: ยังไม่ apply · dry-run เท่านั้น · apply ด้วย node scripts/run-sql.mjs --commit --record เท่านั้น (🔴 ห้าม supabase db push) · ชุดทดสอบ scripts/verify/verify-0190.sql · ไฟล์ต้องเป็น LF (ข้อ 20)
-- 🔴 ราคาพลอย = ต้นทุน → security 💰 ก่อน merge · ลำดับ deploy: dry-run 0190 + verify-0190 (ต่อไฟล์เป็นไฟล์เดียว ไม่ใส่ --commit) → apply --commit --record → verify-0190 + verify-0187/0188/0189 + `node scripts/run-sql.mjs scripts/check-analytics-grants.sql` → แล้วค่อย merge โค้ด TS
--   (merge โค้ดก่อน apply = action ใหม่เรียก RPC ที่ยังไม่มี → ฟังก์ชันพลอยล้ม ไม่กระทบหน้าอื่น — แต่ job_create_* signature ใหม่ต้อง apply ก่อนโค้ดที่ส่ง p_gem_lines)
-- design: docs/3j-jewelry/oms/design-job-plan-metal-gems.md §2.4–2.5 (เดิม) + §9 (มติ 21 ต.ค. ทับ) · UX: docs/3j-jewelry/oms/ux-gems.md
--
-- ทำไม (ภาษาคน): ช่างฝังต้องรู้ว่า "ใบนี้ใช้พลอยอะไร เท่าไร ตรงไหน" ก่อนลงมือ · เจ้าของให้ผู้จัดการพิมพ์ชนิด/รูปทรงใหม่ได้เลยหน้างาน (ไม่ต้องรอออฟฟิศยืนยัน) แล้วชื่อนั้นเข้าแคตตาล็อกเอง — ราคาไม่ถึงมือผู้จัดการ/ช่าง
--   ⇒ DB ต้องกันชื่อขยะ (ชื่อสั้น/ตัวเลขล้วน/ล่องหน) + กันชื่อซ้ำ/เกือบซ้ำ (ตัวดัก "คล้าย" ที่ server ตัดสิน) + ให้ออฟฟิศรวมชื่อซ้ำทีหลังได้โดยใบเก่าไม่เปลี่ยน (snapshot) + ราคาอยู่คนละตารางที่ไม่ให้ role ฝั่งแอป (anon/authenticated/service_role) อ่านตรง
--
-- สิ่งที่ไฟล์นี้ทำ
--  1. ฟังก์ชันบริสุทธิ์: gem_name_norm (ตัด ช่องว่าง/วรรคตอน/อักขระล่องหน · NFKC · ตัวเล็ก) · gem_name_similar (ระยะแก้ไขตามความยาวชื่อ · ชื่อ ≤ 3 ตัวอักษรเทียบเท่ากันเท่านั้น) · gem_size_label · gem_label_compose ("โกเมน · ไข่ · 4×6 มม.") · gem_name_clean
--  2. ตาราง analytics: gem_shape · gem_type · gem_item (ชนิด+รูปทรง+ขนาด a/b) · gem_item_price (ไม่ให้ role ฝั่งแอป (anon/authenticated/service_role) อ่านตรง) · gem_catalog_event (append-only) · product_gem_bom (แม่แบบ SKU) · job_gem_bom (สำเนาต่อใบ + gem_label snapshot) — RLS เปิดไม่มี policy · service_role select ได้เฉพาะตารางที่ไม่มีราคา
--  3. job_event: + bom_change (ลอกรายการจาก DB สด) · seed รูปทรงมาตรฐาน 12 แบบ (ไม่ seed ชนิด · ไม่ seed ราคา)
--  4. catalog RPC (ออฟฟิศ owner/admin): gem_catalog_list (มีราคา) · gem_options_list (ไม่มีราคา) · gem_catalog_create · gem_item_create · gem_catalog_rename · gem_shape_set_has_length · gem_merge_preview · gem_merge · gem_catalog_set_active · gem_catalog_remove · gem_price_set · gem_price_history
--  5. BOM RPC: product_gem_bom_get/set · product_gem_bom_from_job · job_gem_bom_get/set + core (job_gem_bom_replace_core — W3 ผู้จัดการแก้จากมือถือต่อได้โดยไม่ replace ซ้ำ) + job_gem_edit_window
--  6. replace (ลอก def สดจาก DB 22 ต.ค. 69 แล้วแก้เฉพาะจุด · md5 ตรวจใน pre-check): job_source_info (+ขั้นฝังเมื่อ SKU มีแม่แบบ) · job_create_insert/_from_quote_item/_from_production_item/_core (+p_gem_lines/p_gem_force · drop signature เดิม) · job_plan_suggest (+gem_bom[]) · job_worker_resolve (+job.gems[]/gems_state)
--     ไม่แตะ job_stage_suggest (ได้ขั้นฝังผ่าน job_source_info) · ไม่แตะ job_worker_open (W1 เรียก core ด้วย 13 args เดิม → ได้ค่า default ของ arg ใหม่ · SKU มีแม่แบบ = ได้ขั้นฝัง+BOM คัดลอกมา) · ไม่แตะ production_order_done (💰)
--  7. views v_product_gem_bom · v_job_gem_requirement (ไม่มีคอลัมน์ราคา · ไม่เรียกฟังก์ชันของ schema — อ่านด้วย service_role ได้)
--  8. gem_item_price_audit (append-only · สิทธิ์ชุดเดียวกับตารางราคา): gem_price_set บันทึก old/new ก่อน upsert ทุกครั้ง · แก้ทับวันเดิม หรือ effective_from ย้อนหลัง (< วันนี้ไทย) = บังคับ note ที่มีตัวอักษรจริง (note_required) · gem_price_history คืนแถว audit
--  9. idempotent: รันซ้ำได้ (post-check เทียบ golden โดยตัด key gem_template_count · เช็ค "ไม่มีข้อมูลหลัง apply" เฉพาะรอบแรก) — verify ด้วยการต่อไฟล์ซ้ำสองรอบใน dry-run
-- 10. รอบแก้ตาม review 22 ต.ค. (Blocker 1 + S1-S6): replace_core จับคู่แถวเดิมโดยตัด NULL ออกจาก v_map (แถวใหม่นำหน้าแล้วแถวเดิมไม่ถูกลบ-แทรก) · gem_similar_hits ตัวเดียว (prepare · create · rename) ·
--     job_gem_state ตัวเดียว = นิยาม "ยังไม่ระบุพลอย" (job_gem_bom_get · job_worker_resolve · getJobDetail/ใบพิมพ์อ่านผ่าน RPC) · รวมตำแหน่งทีละคำ (ไม่ใช่ substring) ทั้งบันทึกใบและรวมชื่อ ·
--     gem_name_ok = ต้องมี [[:alpha:]] ≥ 1 ตัว (แทนรายการระบบเลข) · CHECK ของ audit: insert ย้อนหลังต้องมี note · ถอด p_require_qty/v_i ที่ไม่ได้ใช้ · ต้องตรงกับ TS: lib/jobs/shop-gems.ts (norm = ตัดเฉพาะ \p{P})
--  ⚠️ role ระดับแพลตฟอร์มอ่านตารางราคา/audit ได้เสมอ (ไม่ต้องมี grant): postgres (เจ้าของ) · supabase_admin (superuser) · และสมาชิก pg_read_all_data: supabase_etl_admin · supabase_read_only_user (ตรวจบน DB จริง 22 ต.ค. 69 — ทั้งหมด bypassrls)
--     — คุมที่สิทธิ์องค์กร/dashboard/การเก็บ key ไม่ใช่ที่ DB · service_role/anon/authenticated อ่านตรงไม่ได้ (บันทึกหนี้ security L1)
--
-- ตัดสินเอง (นอก design/brief — เหตุผล)
--  (1) type_id/shape_id ที่ถูกรวมแล้ว (merged_into) → resolve ไปตัวปลายทางแล้วไปต่อ ไม่ปฏิเสธ (UX A3/A6: ใบที่ค้างระหว่างรวมชื่อต้องไม่ล้ม) · ปฏิเสธเฉพาะ: ร้านอื่น/ไม่พบ/ตัวปลายทางปิดใช้งาน · merge ลงตัวเอง/ลงตัวที่ถูกรวมแล้ว/จากตัวที่ถูกรวมแล้ว
--  (2) merge ไม่แตะ job_gem_bom เลย (snapshot ต้องไม่ขยับแม้ gem_item_id) — ตัวรวมกลุ่ม (สรุปสั่งซื้อ G1b) ใช้ gem_item_canonical(...) ตามห่วงโซ่ merged_into · แม่แบบ SKU (product_gem_bom) ถูกย้ายไปตัวปลายทางตอน merge (แถวชนกัน = บวกจำนวน ≤ 1,000 ไม่งั้นปฏิเสธการรวม)
--  (3) ชื่อใหม่ที่ norm เท่ากับของที่มี → ใช้ตัวเดิมเงียบๆ (ไม่ใช่ error · ตอบ reused[]) แม้ p_force=true — force ใช้ข้ามเฉพาะ "คล้าย" · การสร้างชื่อตรงๆ (gem_catalog_create/rename) norm ซ้ำ = ปฏิเสธเสมอ (name_exists)
--  (4) error ของแถวพลอย = 22023 + hint เป็นรหัส + detail เป็น json {row, field, code} (แถวที่ผิด) · ตัวดักคล้าย = hint gem_similar + detail {similar:[...]} — ไม่เขียนอะไรเลย (ทรานแซกชันเดียว)
--  (5) พลอยในใบ: ไม่มีแถว ↔ ไม่มีขั้นฝัง ผูกกันแบบ "ไม่บังคับ": คัดลอกแม่แบบ SKU เฉพาะเมื่อใบมีขั้น gem_set · p_gem_lines = '[]' = ระบุว่าไม่มีพลอย · ไม่ส่ง (null) = คัดลอกแม่แบบถ้ามีขั้นฝัง · ระบบไม่เพิ่ม/ลบขั้นให้เอง
--  (6) gate "ช่างฝังรับงานไม่ได้เมื่อไม่มีพลอย" (UX A8): เจ้าของตัดสิน 22 ต.ค. = **ไม่บล็อก แค่เตือน** — resolve ส่ง gems_state='unspecified' ให้จอเตือน (ไม่มี gate ที่ DB)
--  (7) actor ของ RPC ราคา/แคตตาล็อก ต้องเป็นสมาชิก owner/admin ของร้านจริง (แม้ผู้เรียกเป็น service_role) — เพราะ role ฝั่ง server ตรวจที่ชั้นแอป (staff ผ่าน crm_require_owner_admin ไม่ได้อยู่แล้วถ้า session จริง แต่ service_role ผ่านเสมอ) · RPC ใบงาน/แม่แบบ (ไม่มีราคา) ใช้ job_office_begin เดิม
--  (8) ไม่มี unit (กะรัต) · ไม่มี oem_tier · ไม่มี breakage_allow_pct (เผื่อแตกอยู่ G1b ฝั่งสั่งซื้อ) · ไม่มี gem_type.code/gem_shape.code (ชื่อพิมพ์เองได้ → ตัวตนคือ id + name_norm)
--
-- seed รูปทรง (12 — design §2.4): เจ้าของยืนยันแล้ว 22 ต.ค.: "หัวใจ" = 1 ค่า · "คุชชั่น" = 2 ค่า · ชื่อ "บาแก็ตต์" ตามเอกสารเจ้าของ (workflow) — แก้ชื่อได้ด้วย gem_catalog_rename · แก้ has_length ได้ด้วย gem_shape_set_has_length ตราบที่ยังไม่มีรายการใช้
--
-- post-check ล็อก: ฟังก์ชันเดิมนอกรายการ md5 เท่าเดิม (รวม production_order_done) · แถวเดิมไม่ขยับ (job/job_stage/job_event/job_token/production_order*/product/worker) · golden job_source_info ทุก item จริงเท่าเดิมเมื่อไม่มีแม่แบบ · ไม่มี overload · ไม่มีสิทธิ์ anon/authenticated/PUBLIC

-- 🔴 ตอน apply: ไฟล์นี้ + verify ยาวกว่า statement_timeout ปกติ (security เจอ 57014 ตอนซ้อมรวม verify) — ตั้งไม่จำกัดในทรานแซกชันนี้เท่านั้น (local)
set local statement_timeout = '0';

-- รอบแรก (ยังไม่มีตาราง gem_item) หรือรันซ้ำ — post-check "ไม่มีชนิด/รายการ/ราคา/BOM หลัง apply" ตรวจเฉพาะรอบแรก
create temp table _m190_first on commit drop as select to_regclass('analytics.gem_item') is null as first;

-- baseline: ฟังก์ชันทุกตัวในสคีมา (md5) + ตัวชี้วัดแถว
create temp table _m190_fn_base on commit drop as
select p.oid::regprocedure::text as sig, p.proname, md5(pg_get_functiondef(p.oid)) as h
from pg_proc p
where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f';

create temp table _m190_row_base on commit drop as
select 'job'::text as t, count(*) as n, coalesce(md5(string_agg(j::text, '|' order by j.id)), '') as h from analytics.job j
union all select 'job_stage', count(*), coalesce(md5(string_agg(s::text, '|' order by s.id)), '') from analytics.job_stage s
union all select 'job_event', count(*), coalesce(md5(string_agg(e::text, '|' order by e.id)), '') from analytics.job_event e
union all select 'job_token', count(*), coalesce(md5(string_agg(k.id::text || coalesce(k.revoked_at::text, ''), '|' order by k.id)), '') from analytics.job_token k
union all select 'job_counter', count(*), coalesce(md5(string_agg(c::text, '|' order by c::text)), '') from analytics.job_counter c
union all select 'production_order', count(*), coalesce(md5(string_agg(po::text, '|' order by po.id)), '') from analytics.production_order po
union all select 'production_order_item', count(*), coalesce(md5(string_agg(pi::text, '|' order by pi.id)), '') from analytics.production_order_item pi
union all select 'worker', count(*), coalesce(md5(string_agg(w::text, '|' order by w.id)), '') from analytics.worker w
union all select 'product', count(*), coalesce(md5(string_agg(pr::text, '|' order by pr.id)), '') from public.product pr
union all select 'oem_quote_item', count(*), coalesce(md5(string_agg(q::text, '|' order by q.id)), '') from analytics.oem_quote_item q;

-- golden: job_source_info ของทุกรายการจริง (ใบเสนอราคา OEM + ใบผลิต) ก่อนแก้ — error ก็นับเป็นผล (เก็บ sqlstate + ข้อความ)
create temp table _m190_src on commit drop as
select 'oem'::text as kind, i.id as item_id, i.shop_id, null::text as res from analytics.oem_quote_item i
union all select 'production', poi.id, poi.shop_id, null from analytics.production_order_item poi;

do $b$
declare r record; v text;
begin
  for r in select kind, item_id, shop_id from _m190_src loop
    begin
      v := analytics.job_source_info(r.shop_id, r.kind, r.item_id)::text;
    exception when others then
      v := 'ERR:' || sqlstate || ':' || sqlerrm;
    end;
    update _m190_src set res = v where kind = r.kind and item_id = r.item_id;
  end loop;
end;
$b$;

-- ============================================================================
-- 0. pre-check
-- ============================================================================
do $p$
declare
  v_n int;
  v_def text;
  r record;
begin
  perform 1 from pg_temp._m190_fn_base limit 1;  -- รันแบบ autocommit ตารางหาย ⇒ ล้มก่อน DDL ใดๆ
  if to_regclass('analytics.job') is null or to_regclass('analytics.job_stage') is null or to_regclass('analytics.job_event') is null
     or to_regclass('analytics.worker') is null or to_regclass('public.product') is null or to_regclass('public.shop') is null
     or to_regclass('public.shop_member') is null or to_regclass('analytics.catalog_audit_log') is null then
    raise exception '0190: ไม่พบตารางที่ต้องใช้ (job · job_stage · job_event · worker · product · shop · shop_member · catalog_audit_log) — apply 0172-0189 ก่อน';
  end if;
  if to_regprocedure('analytics.job_text_clean(text,text,integer,boolean)') is null
     or to_regprocedure('analytics.job_label_clean(text,text,integer)') is null
     or to_regprocedure('analytics.oem_note_present(text)') is null
     or to_regprocedure('analytics.oem_note_valid(text)') is null
     or to_regprocedure('analytics.oem_text_strip_invisible(text)') is null
     or to_regprocedure('analytics.job_office_begin(text,uuid,uuid,uuid,boolean)') is null
     or to_regprocedure('analytics.job_event_write(uuid,uuid,text,date,uuid,uuid,text,text,jsonb)') is null
     or to_regprocedure('analytics.job_today()') is null
     or to_regprocedure('analytics.job_append_only()') is null
     or to_regprocedure('analytics.job_deny_truncate()') is null
     or to_regprocedure('analytics.crm_require_owner_admin(uuid)') is null
     or to_regprocedure('analytics.job_sort_stage_codes(uuid,text[])') is null
     or to_regprocedure('analytics.job_stage_def_ensure(uuid)') is null then
    raise exception '0190: ไม่พบฟังก์ชันที่ต้องใช้ (job_text_clean · job_label_clean · oem_note_* · job_office_begin · job_event_write · job_today · job_append_only · job_deny_truncate · crm_require_owner_admin) — ตรวจ 0169/0172';
  end if;
  -- คอลัมน์ที่ฟังก์ชันใหม่อ่าน (plpgsql ไม่ตรวจชื่อคอลัมน์ตอน create — ตรวจที่นี่ให้ล้มก่อน DDL)
  select count(*) into v_n from information_schema.columns
   where table_schema = 'analytics' and table_name = 'job'
     and column_name in ('id', 'shop_id', 'status', 'parent_job_id', 'qty_planned', 'product_id', 'job_no', 'opened_by_worker_id', 'created_by');
  if v_n <> 9 then raise exception '0190: คอลัมน์ของ analytics.job ไม่ครบตามที่ใช้ (พบ % จาก 9)', v_n; end if;
  select count(*) into v_n from information_schema.columns
   where table_schema = 'analytics' and table_name = 'job_stage' and column_name in ('job_id', 'stage_code', 'status', 'seq');
  if v_n <> 4 then raise exception '0190: คอลัมน์ของ analytics.job_stage ไม่ครบ (พบ % จาก 4)', v_n; end if;

  -- job_event_event_type_ck: ต้องเป็นรายการ 32 ตัวของ 0187 (หรือ 33 ตัวถ้ารันซ้ำหลังมี bom_change) — มีคนเพิ่มชนิดนอก migration = หยุด (ไม่ลบชนิดของคนอื่นทิ้ง)
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conrelid = 'analytics.job_event'::regclass and c.conname = 'job_event_event_type_ck';
  select count(*) into v_n from regexp_matches(v_def, '''[a-z_]+''', 'g');
  if v_def is null
     or not (v_n = 32 or (v_n = 33 and position('''bom_change''' in v_def) > 0))
     or exists (select 1 from unnest(array['create', 'stage_receive', 'stage_send', 'stage_skip', 'stage_reopen', 'weigh', 'scrap', 'batch_join', 'batch_leave', 'due_set', 'hold', 'resume',
          'photo_add', 'note', 'done', 'cancel', 'token_issue', 'token_revoke', 'plan_change', 'surplus_set', 'profile_set', 'split', 'split_cancel',
          'discrepancy', 'discrepancy_resolve', 'photo_remove', 'photo_primary', 'photo_reorder', 'discrepancy_arrive', 'intake_open', 'ack', 'edit']) t
        where position('''' || t || '''' in v_def) = 0) then
    raise exception '0190: job_event_event_type_ck บน DB ไม่ใช่รายการของ 0187 — มีคนแก้นอก migration · หยุด ห้าม replace ทับ';
  end if;

  -- ฟังก์ชันที่ลอก def มา replace: ต้องมี signature เดียว และ def บน DB = ฉบับที่ลอก (md5) หรือเป็นฉบับ 0190 แล้ว (รันซ้ำ)
  for r in select * from (values
      ('job_source_info', '0faa610b0f3c01fe1382ba5fab338199'),
      ('job_plan_suggest', 'd5d81deb7635629b71971e3235319413'),
      ('job_create_insert', 'b49b5a3d000b1fd02a24423314ad7314'),
      ('job_create_from_quote_item', '8bf8f169ec7fc25466e5baf1ff4c047d'),
      ('job_create_from_production_item', '31343cf9211b3e389562444c4fc989d6'),
      ('job_create_from_production_item_core', '5ea576916d63bacd903eabad066c2556'),
      ('job_worker_resolve', 'd79d01d139e268fe384a5a87753ddb01')) as t(fname, md5_expected) loop
    select count(*) into v_n from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = r.fname;
    if v_n <> 1 then
      raise exception '0190: % มี % signature (ต้องมี 1) — หยุดตรวจ overload ก่อน', r.fname, v_n;
    end if;
    select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = r.fname;
    if md5(v_def) <> r.md5_expected and position('0190' in v_def) = 0 then
      raise exception '0190: def ของ % บน DB ไม่ใช่ฉบับที่ลอก (md5 ไม่ตรง) — มีคนแก้นอก migration · หยุด ห้าม replace ทับ', r.fname;
    end if;
  end loop;

  -- ชื่อ object ใหม่ต้องยังไม่ถูกใช้ผิดประเภท (รันซ้ำได้ — ตารางมีอยู่แล้วต้องเป็นของไฟล์นี้)
  if to_regclass('analytics.gem_item') is not null and not exists (select 1 from information_schema.columns where table_schema = 'analytics' and table_name = 'gem_item' and column_name = 'size_a') then
    raise exception '0190: analytics.gem_item มีอยู่แล้วแต่ไม่ใช่โครงของ 0190 — หยุด';
  end if;
  raise notice '0190: ใบงานเดิม % ใบ · รายการอ้างอิง golden % รายการ · ไม่มี UPDATE แถวเดิมในไฟล์นี้', (select count(*) from analytics.job), (select count(*) from _m190_src);
end;
$p$;

-- ============================================================================
-- 1. ฟังก์ชันบริสุทธิ์ (immutable · ไม่แตะตาราง · ไม่ grant ใคร — เรียกจาก RPC definer และ CHECK/generated column)
--    ชุดเคส "เตือน/ไม่เตือน" ของ UX §3.4 อยู่ใน verify-0190 (N1-N17) · TS ใช้กติกาเดียวกัน (lib/jobs/shop-gems.ts — พิสูจน์ parity กับ DB ใน lib/jobs/shop-gems.qa.test.ts) — ขยับพร้อมกัน
-- ============================================================================

-- norm = กุญแจเทียบชื่อซ้ำ: ลบอักขระล่องหน → NFKC (ตัวเต็มความกว้าง/ลิเกเจอร์ → ปกติ) → ตัวเล็ก → ลบช่องว่าง/วรรคตอน
--   🔴 [[:punct:]] ของ DB นี้ = \p{P} เท่านั้น — "สัญลักษณ์" (\p{S}: $ + < = > ^ ` | ~ ¢ £ © ...) อยู่ใน norm ต่อไป · TS (normalizeGemName) ต้องตรงเป๊ะ (กวาดทุกจุดรหัสเทียบแล้ว — ดู shop-gems.qa.test.ts)
--   "CZ" = "cz" = "C Z" · "ไพลิน " = "ไพลิน" · สระ/วรรณยุกต์ไทยอยู่ในผล (ไม่ถูกตัดเป็นวรรคตอน — พิสูจน์แล้วบน DB: '[[:punct:]]' ไม่จับ U+0E34/U+0E4C)
create or replace function analytics.gem_name_norm(p_val text)
 returns text
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $f$
  select lower(regexp_replace(normalize(analytics.oem_text_strip_invisible(coalesce(p_val, '')), NFKC), '[[:space:][:punct:]]', '', 'g'))
$f$;

-- ระยะแก้ไข (Levenshtein) ต่ออักขระ (code point) — ชื่อ ≤ 40 ตัวอักษร จึงเบา · ไม่ใช้ fuzzystrmatch (ไม่ได้ติดตั้งบน DB นี้)
create or replace function analytics.gem_name_lev(p_a text, p_b text)
 returns int
 language plpgsql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $f$
declare
  a  text[] := string_to_array(coalesce(p_a, ''), null);
  b  text[] := string_to_array(coalesce(p_b, ''), null);
  la int := coalesce(cardinality(a), 0);
  lb int := coalesce(cardinality(b), 0);
  prev int[];
  cur  int[];
  i int; j int; v_cost int;
begin
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  prev := array(select generate_series(0, lb));
  for i in 1..la loop
    cur := array[i];
    for j in 1..lb loop
      v_cost := case when a[i] = b[j] then 0 else 1 end;
      cur := cur || least(prev[j + 1] + 1, cur[j] + 1, prev[j] + v_cost);
    end loop;
    prev := cur;
  end loop;
  return prev[lb + 1];
end;
$f$;

-- "คล้าย" = norm เท่ากัน หรือ (ชื่อสั้นที่สุด > 3 ตัวอักษร และ ระยะแก้ไข ≤ เกณฑ์ตามความยาวที่ยาวกว่า: ≤ 5 → 1 · ≤ 7 → 2 · มากกว่านั้น → 3)
--   ชื่อสั้น ≤ 3 ตัวอักษร (CZ · กลม · ไข่): เทียบเฉพาะ "เท่ากันหลัง normalize" — กัน CZ↔AZ เตือนมั่ว
--   จับไม่ได้ (รู้และยอมรับ): ไทย↔อังกฤษ (Blue Topaz ↔ บลูโทแพซ) · คำพ้อง (CZ ↔ เพชรรัสเซีย) — ตาข่ายหลักคือ "รวมชื่อ" ของออฟฟิศ
create or replace function analytics.gem_name_similar(p_a text, p_b text)
 returns boolean
 language plpgsql
 immutable
 set search_path to 'pg_catalog', 'analytics', 'pg_temp'
as $f$
declare
  na text := analytics.gem_name_norm(p_a);
  nb text := analytics.gem_name_norm(p_b);
  la int; lb int; v_min int; v_max int; v_d int;
begin
  if na = '' or nb = '' then return false; end if;
  if na = nb then return true; end if;
  la := char_length(na); lb := char_length(nb);
  v_min := least(la, lb); v_max := greatest(la, lb);
  if v_min <= 3 then return false; end if;
  if v_max - v_min > 3 then return false; end if;
  v_d := analytics.gem_name_lev(na, nb);
  return v_d <= case when v_max <= 5 then 1 when v_max <= 7 then 2 else 3 end;
end;
$f$;

-- ชื่อที่เก็บได้: ตัดหัวท้ายแล้ว · ช่องว่างมีแต่ U+0020 ตัวเดียวคั่น · 2-40 ตัวอักษร · ไม่มี < > · ไม่มีอักขระควบคุม/ล่องหน (oem_note_valid) · มีตัวอักษร/ตัวเลขจริง (oem_note_present — whitelist)
--   · norm ยาว ≥ 2 และ "มีตัวอักษรจริงอย่างน้อย 1 ตัว" ([[:alpha:]] — พิสูจน์บน DB นี้: พยัญชนะไทย/ละติน/จีน ผ่าน · เลขทุกระบบ (ASCII/ไทย/อารบิก/เต็มความกว้าง/ยกกำลัง) ไม่ผ่าน · สระ-วรรณยุกต์ลอยๆ ไม่ผ่าน · "+1" "$$" ไม่ผ่าน) —
--     แทนการไล่รายการระบบเลข (ระบบเลขใหม่ของ Unicode ไม่หลุด) · ใช้ใน CHECK ของ gem_type/gem_shape (กำแพงที่ตาราง แม้ RPC ถูกแก้ผิด)
create or replace function analytics.gem_name_ok(p_name text)
 returns boolean
 language sql
 immutable
 set search_path to 'pg_catalog', 'analytics', 'pg_temp'
as $f$
  select p_name is not null
     and char_length(p_name) between 2 and 40
     and p_name !~ '^ | $|  '
     and replace(p_name, ' ', '') !~ '[[:space:]]'
     and p_name !~ '[<>]'
     and analytics.oem_note_valid(p_name)
     and analytics.oem_note_present(p_name)
     and char_length(analytics.gem_name_norm(p_name)) >= 2
     and analytics.gem_name_norm(p_name) ~ '[[:alpha:]]'
$f$;

-- ฉลากขนาด: "1.5" · "4×6" (ตัดศูนย์ท้าย) — DB ประกอบเอง ไม่ให้คนพิมพ์คนละแบบ (4.0×6.0)
create or replace function analytics.gem_size_label(p_a numeric, p_b numeric)
 returns text
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $f$
  select case when p_a is null then null
              when p_b is null then trim_scale(p_a)::text
              else trim_scale(p_a)::text || '×' || trim_scale(p_b)::text end
$f$;

-- ฉลากประกอบ: "โกเมน · ไข่ · 4×6 มม." (A10 — จอใช้ฟังก์ชัน TS ตัวเดียวกันแสดง "ตัวอย่าง" ระหว่างกรอก · ค่า DB ชนะหลังบันทึก)
create or replace function analytics.gem_label_compose(p_type_name text, p_shape_name text, p_size_label text)
 returns text
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $f$ select p_type_name || ' · ' || p_shape_name || ' · ' || p_size_label || ' มม.' $f$;

-- โยนข้อผิดพลาดของแถวพลอย: 22023 + hint = รหัส + detail = json {row, field, code} (ให้ TS พากลับแถว/ช่องที่ผิด)
create or replace function analytics.gem_line_fail(p_row int, p_field text, p_code text, p_msg text)
 returns void
 language plpgsql
 set search_path to 'pg_catalog', 'pg_temp'
as $f$
begin
  raise exception '%', p_msg using errcode = '22023', hint = p_code,
    detail = jsonb_build_object('row', p_row, 'field', p_field, 'code', p_code)::text;
end;
$f$;

-- ทำความสะอาดชื่อที่ผู้ใช้พิมพ์: trim (รวม NBSP/ช่องว่างเต็มความกว้าง) · ยุบช่องว่างซ้ำ · ผ่านกฎ gem_name_ok · ล้ม = 22023 hint gem_name_invalid
create or replace function analytics.gem_name_clean(p_val text, p_label text)
 returns text
 language plpgsql
 set search_path to 'pg_catalog', 'analytics', 'pg_temp'
as $f$
declare
  v text := analytics.job_text_clean(p_val, p_label, 200, true);
begin
  v := regexp_replace(v, '[[:space:]]+', ' ', 'g');
  if not analytics.gem_name_ok(v) then
    raise exception '%ต้องมี 2-40 ตัวอักษร (ต้องมีตัวอักษรจริง ไม่ใช่ตัวเลขล้วน) และห้ามมีเครื่องหมาย < >', p_label using errcode = '22023', hint = 'gem_name_invalid';
  end if;
  return v;
end;
$f$;

-- ============================================================================
-- 2. job_event: + bom_change (ลอกรายการจาก DB สดของ 0187 แล้วต่อท้าย — pre-check ยืนยันแล้วว่าไม่มีชนิดอื่น)
-- ============================================================================
alter table analytics.job_event drop constraint if exists job_event_event_type_ck;
alter table analytics.job_event add constraint job_event_event_type_ck check (event_type = any (array[
  'create', 'stage_receive', 'stage_send', 'stage_skip', 'stage_reopen', 'weigh', 'scrap', 'batch_join', 'batch_leave', 'due_set', 'hold', 'resume',
  'photo_add', 'note', 'done', 'cancel', 'token_issue', 'token_revoke', 'plan_change', 'surplus_set', 'profile_set', 'split', 'split_cancel',
  'discrepancy', 'discrepancy_resolve', 'photo_remove', 'photo_primary', 'photo_reorder', 'discrepancy_arrive',
  'intake_open', 'ack', 'edit', 'bom_change']));

-- ============================================================================
-- 3. ตาราง (สคีมา analytics · RLS เปิดไม่มี policy · เขียนผ่าน RPC definer เท่านั้น)
--    ตัวตนของชื่อ = (shop_id, name_norm) unique ทุกแถวรวมที่ถูกรวมแล้ว — พิมพ์ชื่อเก่าซ้ำแล้ว resolve ไป canonical ผ่าน merged_into (ไม่สร้างแถวใหม่)
-- ============================================================================
create table if not exists analytics.gem_shape (
  id                   uuid primary key default gen_random_uuid(),
  shop_id              uuid not null references public.shop (id) on delete restrict,
  name                 text not null,
  name_norm            text generated always as (analytics.gem_name_norm(name)) stored,
  has_length           boolean not null,                -- true = ใส่ 2 ด้าน กว้าง×ยาว (ไข่ · หยดน้ำ) · false = ค่าเดียว (กลม) · แก้ไม่ได้เมื่อมีรายการใช้ (trigger)
  is_active            boolean not null default true,
  is_seed              boolean not null default false,
  merged_into          uuid,
  created_by           uuid,
  created_by_worker_id uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint gem_shape_id_shop_uq unique (id, shop_id),
  constraint gem_shape_merged_fk foreign key (merged_into, shop_id) references analytics.gem_shape (id, shop_id) on delete restrict,
  constraint gem_shape_worker_fk foreign key (created_by_worker_id, shop_id) references analytics.worker (id, shop_id) on delete restrict,
  constraint gem_shape_name_ck check (analytics.gem_name_ok(name)),
  constraint gem_shape_merged_ck check (merged_into is null or (merged_into <> id and not is_active)),
  constraint gem_shape_who_ck check (num_nonnulls(created_by, created_by_worker_id) <= 1)
);
create unique index if not exists uq_gem_shape_norm on analytics.gem_shape (shop_id, name_norm);
create index if not exists idx_gem_shape_merged on analytics.gem_shape (merged_into) where merged_into is not null;

create table if not exists analytics.gem_type (
  id                   uuid primary key default gen_random_uuid(),
  shop_id              uuid not null references public.shop (id) on delete restrict,
  name                 text not null,
  name_norm            text generated always as (analytics.gem_name_norm(name)) stored,
  is_active            boolean not null default true,
  merged_into          uuid,
  created_by           uuid,
  created_by_worker_id uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint gem_type_id_shop_uq unique (id, shop_id),
  constraint gem_type_merged_fk foreign key (merged_into, shop_id) references analytics.gem_type (id, shop_id) on delete restrict,
  constraint gem_type_worker_fk foreign key (created_by_worker_id, shop_id) references analytics.worker (id, shop_id) on delete restrict,
  constraint gem_type_name_ck check (analytics.gem_name_ok(name)),
  constraint gem_type_merged_ck check (merged_into is null or (merged_into <> id and not is_active)),
  constraint gem_type_who_ck check (num_nonnulls(created_by, created_by_worker_id) <= 1)
);
create unique index if not exists uq_gem_type_norm on analytics.gem_type (shop_id, name_norm);
create index if not exists idx_gem_type_merged on analytics.gem_type (merged_into) where merged_into is not null;

-- 1 แถว = 1 ของที่สั่งซื้อได้ (ชนิด · รูปทรง · ขนาด มม.) — สร้างได้จาก "พิมพ์ในใบงาน" โดยยังไม่มีราคา · หน่วย = เม็ด ทั้งหมด (ไม่มีกะรัต)
-- ขนาด: numeric(5,2) · ทศนิยม ≤ 2 ตำแหน่งตรวจที่ RPC (cast เข้าคอลัมน์ปัดเงียบ) · size_b ≥ size_a เสมอ (RPC สลับให้ — unique ต้อง normalize) · NaN/Infinity ตกที่ CHECK not(between)
create table if not exists analytics.gem_item (
  id                   uuid primary key default gen_random_uuid(),
  shop_id              uuid not null,
  gem_type_id          uuid not null,
  gem_shape_id         uuid not null,
  size_a               numeric(5,2) not null check (size_a > 0 and size_a <= 100),
  size_b               numeric(5,2) check (size_b is null or (size_b > 0 and size_b <= 100 and size_b >= size_a)),
  size_label           text generated always as (analytics.gem_size_label(size_a, size_b)) stored,
  is_active            boolean not null default true,
  merged_into          uuid,                            -- รวมชื่อแล้วขนาดชนกัน: ชี้ไปรายการปลายทาง (รายการนี้ปิดใช้งาน · ใบเก่ายังอ้าง id นี้ได้ — snapshot)
  created_by           uuid,
  created_by_worker_id uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint gem_item_id_shop_uq unique (id, shop_id),
  constraint gem_item_type_fk foreign key (gem_type_id, shop_id) references analytics.gem_type (id, shop_id) on delete restrict,
  constraint gem_item_shape_fk foreign key (gem_shape_id, shop_id) references analytics.gem_shape (id, shop_id) on delete restrict,
  constraint gem_item_merged_fk foreign key (merged_into, shop_id) references analytics.gem_item (id, shop_id) on delete restrict,
  constraint gem_item_worker_fk foreign key (created_by_worker_id, shop_id) references analytics.worker (id, shop_id) on delete restrict,
  constraint gem_item_merged_ck check (merged_into is null or (merged_into <> id and not is_active)),
  constraint gem_item_who_ck check (num_nonnulls(created_by, created_by_worker_id) <= 1)
);
create unique index if not exists uq_gem_item_spec on analytics.gem_item (shop_id, gem_type_id, gem_shape_id, size_a, coalesce(size_b, 0));
create index if not exists idx_gem_item_type on analytics.gem_item (gem_type_id);
create index if not exists idx_gem_item_shape on analytics.gem_item (gem_shape_id);
create index if not exists idx_gem_item_merged on analytics.gem_item (merged_into) where merged_into is not null;

-- 🔴 ราคา = ต้นทุน: ตารางนี้ "ไม่ให้ role ฝั่งแอป (anon/authenticated/service_role) อ่านตรง" (revoke all จากทุก role รวม service_role) — อ่าน/เขียนได้ทาง RPC ออฟฟิศ 3 ตัวเท่านั้น (gem_catalog_list · gem_price_set · gem_price_history)
--   RPC ช่าง/ผู้จัดการ/resolve/print ไม่ join ตารางนี้ · ประวัติแบบ oem_cost_rate (effective_from อยู่ใน PK) · ไม่มีราคา = ไม่มีแถว (ไม่ใช่ 0)
create table if not exists analytics.gem_item_price (
  gem_item_id        uuid not null,
  shop_id            uuid not null,
  effective_from     date not null check (effective_from >= date '2020-01-01'),   -- เพดานบน (วันนี้ไทย + 1 ปี) ตรวจที่ gem_price_set (CHECK ใช้ now() ไม่ได้)
  price_thb_per_unit numeric(12,4) not null check (price_thb_per_unit > 0 and price_thb_per_unit <= 1000000),
  supplier           text check (supplier is null or (char_length(supplier) between 1 and 120 and analytics.oem_note_valid(supplier) and analytics.oem_note_present(supplier) and supplier !~ '[<>]')),
  note               text check (note is null or (char_length(note) between 1 and 300 and analytics.oem_note_valid(note) and analytics.oem_note_present(note) and note !~ '[<>]')),
  updated_by         uuid,
  updated_at         timestamptz not null default now(),
  primary key (gem_item_id, effective_from),
  constraint gem_item_price_item_fk foreign key (gem_item_id, shop_id) references analytics.gem_item (id, shop_id) on delete cascade
);

-- 🔴 audit การแก้ราคา (security M1): ทุก gem_price_set บันทึก old/new ก่อน upsert · append-only · สิทธิ์ชุดเดียวกับตารางราคา (ไม่มีสิทธิ์ให้ role ฝั่งแอป) · แก้ทับวันเดิม/ย้อนหลัง = ต้องมี note (CHECK ที่ตาราง ไม่พึ่ง RPC อย่างเดียว) · ไม่มี FK ไปรายการ (รายการที่ลบแล้ว audit ยังอยู่)
create table if not exists analytics.gem_item_price_audit (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references public.shop (id) on delete restrict,
  gem_item_id    uuid not null,
  effective_from date not null,
  action         text not null check (action in ('insert', 'update')),
  old_price      numeric(12,4) check (old_price is null or (old_price > 0 and old_price <= 1000000)),
  new_price      numeric(12,4) not null check (new_price > 0 and new_price <= 1000000),
  old_supplier   text,
  new_supplier   text,
  note           text check (note is null or (char_length(note) between 1 and 300 and analytics.oem_note_valid(note) and analytics.oem_note_present(note) and note !~ '[<>]')),
  actor          uuid not null,
  recorded_at    timestamptz not null default now(),
  -- กำแพงที่ตาราง (แม้ RPC ถูกแก้ผิด): update = ต้องมี old_price + note · insert = ไม่มี old_price และถ้าวันที่มีผลย้อนหลัง (ก่อนวันนี้ไทย ณ เวลาบันทึก) ต้องมี note
  constraint gem_item_price_audit_ck check (
    (action = 'insert' and old_price is null and (note is not null or effective_from >= (recorded_at at time zone 'Asia/Bangkok')::date))
    or (action = 'update' and old_price is not null and note is not null))
);
create index if not exists idx_gem_item_price_audit_item on analytics.gem_item_price_audit (shop_id, gem_item_id, recorded_at);

-- ประวัติงานดูแลแคตตาล็อก (รวมชื่อ/เปลี่ยนชื่อ/ปิด-เปิด/ลบ/แก้ has_length) — append-only · payload ไม่มีราคา
create table if not exists analytics.gem_catalog_event (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shop (id) on delete restrict,
  event_type   text not null check (event_type in ('merge', 'rename', 'active_set', 'remove', 'has_length_set')),
  subject_kind text not null check (subject_kind in ('type', 'shape', 'item')),
  subject_id   uuid not null,
  actor        uuid,
  worker_id    uuid,
  payload      jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at  timestamptz not null default now(),
  constraint gem_catalog_event_who_ck check (actor is not null or worker_id is not null)
);
create index if not exists idx_gem_catalog_event_subject on analytics.gem_catalog_event (shop_id, subject_kind, subject_id, occurred_at);

-- แม่แบบพลอยของ SKU (ค่าเริ่มของใบที่เปิดใหม่ — ใบที่เปิดแล้วไม่เปลี่ยน) · ≤ 30 แถว/SKU (line_seq 1-30) · ขนาดละ 1 แถว (unique ต่อรายการ — แถวซ้ำรวมจำนวน)
create table if not exists analytics.product_gem_bom (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shop (id) on delete restrict,
  product_id    uuid not null references public.product (id) on delete restrict,
  line_seq      int  not null check (line_seq between 1 and 30),
  gem_item_id   uuid not null,
  qty_per_piece int  not null check (qty_per_piece between 1 and 1000),
  position_note text check (position_note is null or (char_length(position_note) between 1 and 40 and position_note !~ '[<>]' and analytics.oem_note_valid(position_note) and analytics.oem_note_present(position_note))),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint product_gem_bom_item_fk foreign key (gem_item_id, shop_id) references analytics.gem_item (id, shop_id) on delete restrict,
  constraint product_gem_bom_item_uq unique (product_id, gem_item_id),
  constraint product_gem_bom_seq_uq unique (product_id, line_seq) deferrable initially deferred
);
create index if not exists idx_product_gem_bom_item on analytics.product_gem_bom (gem_item_id);

-- พลอยต่อใบงาน: สำเนา ณ ตอนสั่ง + gem_label snapshot (หน้าช่าง/ใบพิมพ์อ่านจากนี่ ไม่ join แคตตาล็อก · ชื่อถูกรวม/เปลี่ยนทีหลังใบเก่าไม่เปลี่ยน)
--   อยู่ที่ใบแม่เท่านั้น (ส่วนย่อยไม่มี BOM ของตัวเอง) · qty_total ไม่เก็บ = qty_per_piece × job.qty_planned คำนวณตอนอ่าน (qty_planned แก้ได้จนขั้นแรกรับ — ไม่ให้ drift)
create table if not exists analytics.job_gem_bom (
  id                   uuid primary key default gen_random_uuid(),
  shop_id              uuid not null,
  job_id               uuid not null,
  line_seq             int  not null check (line_seq between 1 and 30),
  gem_item_id          uuid not null,
  gem_label            text not null check (char_length(gem_label) between 5 and 200),
  qty_per_piece        int  not null check (qty_per_piece between 1 and 1000),
  position_note        text check (position_note is null or (char_length(position_note) between 1 and 40 and position_note !~ '[<>]' and analytics.oem_note_valid(position_note) and analytics.oem_note_present(position_note))),
  source               text not null check (source in ('product', 'manual', 'shopfloor')),
  created_by           uuid,
  created_by_worker_id uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint job_gem_bom_job_fk foreign key (job_id, shop_id) references analytics.job (id, shop_id) on delete restrict,
  constraint job_gem_bom_item_fk foreign key (gem_item_id, shop_id) references analytics.gem_item (id, shop_id) on delete restrict,
  constraint job_gem_bom_worker_fk foreign key (created_by_worker_id, shop_id) references analytics.worker (id, shop_id) on delete restrict,
  constraint job_gem_bom_item_uq unique (job_id, gem_item_id),
  constraint job_gem_bom_seq_uq unique (job_id, line_seq) deferrable initially deferred,
  constraint job_gem_bom_who_ck check (num_nonnulls(created_by, created_by_worker_id) <= 1)
);
create index if not exists idx_job_gem_bom_item on analytics.job_gem_bom (gem_item_id);

alter table analytics.gem_shape enable row level security;
alter table analytics.gem_type enable row level security;
alter table analytics.gem_item enable row level security;
alter table analytics.gem_item_price enable row level security;
alter table analytics.gem_item_price_audit enable row level security;
alter table analytics.gem_catalog_event enable row level security;
alter table analytics.product_gem_bom enable row level security;
alter table analytics.job_gem_bom enable row level security;
-- ไม่มี policy: anon/authenticated ไม่มีสิทธิ์ทั้งตารางและสคีมา (ข้อ 18) · สิทธิ์ตารางตั้งท้ายไฟล์ (ข้อ 7: ไม่ grant เหวี่ยงแห — default privilege ของสคีมาให้ service_role ทุกอย่างกับตารางใหม่ ต้อง revoke เอง)

-- append-only / กัน TRUNCATE (ใช้ฟังก์ชันกลางของ J1 — ข้อความอ้าง tg_table_name)
drop trigger if exists trg_gem_catalog_event_append_only on analytics.gem_catalog_event;
create trigger trg_gem_catalog_event_append_only before update or delete on analytics.gem_catalog_event for each row execute function analytics.job_append_only();
drop trigger if exists trg_gem_catalog_event_deny_truncate on analytics.gem_catalog_event;
create trigger trg_gem_catalog_event_deny_truncate before truncate on analytics.gem_catalog_event for each statement execute function analytics.job_deny_truncate();
drop trigger if exists trg_gem_shape_deny_truncate on analytics.gem_shape;
create trigger trg_gem_shape_deny_truncate before truncate on analytics.gem_shape for each statement execute function analytics.job_deny_truncate();
drop trigger if exists trg_gem_type_deny_truncate on analytics.gem_type;
create trigger trg_gem_type_deny_truncate before truncate on analytics.gem_type for each statement execute function analytics.job_deny_truncate();
drop trigger if exists trg_gem_item_deny_truncate on analytics.gem_item;
create trigger trg_gem_item_deny_truncate before truncate on analytics.gem_item for each statement execute function analytics.job_deny_truncate();
drop trigger if exists trg_gem_item_price_audit_append_only on analytics.gem_item_price_audit;
create trigger trg_gem_item_price_audit_append_only before update or delete on analytics.gem_item_price_audit for each row execute function analytics.job_append_only();
drop trigger if exists trg_gem_item_price_audit_deny_truncate on analytics.gem_item_price_audit;
create trigger trg_gem_item_price_audit_deny_truncate before truncate on analytics.gem_item_price_audit for each statement execute function analytics.job_deny_truncate();
drop trigger if exists trg_gem_item_price_deny_truncate on analytics.gem_item_price;
create trigger trg_gem_item_price_deny_truncate before truncate on analytics.gem_item_price for each statement execute function analytics.job_deny_truncate();
drop trigger if exists trg_product_gem_bom_deny_truncate on analytics.product_gem_bom;
create trigger trg_product_gem_bom_deny_truncate before truncate on analytics.product_gem_bom for each statement execute function analytics.job_deny_truncate();
drop trigger if exists trg_job_gem_bom_deny_truncate on analytics.job_gem_bom;
create trigger trg_job_gem_bom_deny_truncate before truncate on analytics.job_gem_bom for each statement execute function analytics.job_deny_truncate();

-- ============================================================================
-- 3.1 guard (กำแพงที่ตาราง — แม้ RPC ถูกแก้ผิดก็ผ่านไม่ได้) · GUC analytics.gem_merge = 'on' ตั้งแบบ local โดย gem_merge เท่านั้น (ย้ายอ้างอิงตอนรวมชื่อ)
-- ============================================================================
create or replace function analytics.gem_type_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_merge boolean := coalesce(current_setting('analytics.gem_merge', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.merged_into is not null then
      raise exception 'ชนิดพลอยใหม่ต้องไม่ถูกสร้างในสถานะที่ถูกรวมแล้ว' using errcode = '22023', hint = 'gem_merge_invalid';
    end if;
    return new;
  end if;
  if (new.id, new.shop_id, new.created_by, new.created_by_worker_id, new.created_at) is distinct from (old.id, old.shop_id, old.created_by, old.created_by_worker_id, old.created_at) then
    raise exception 'analytics.gem_type: ฟิลด์ตัวตนแก้ไม่ได้' using errcode = '42501';
  end if;
  if old.merged_into is not null and (new.name is distinct from old.name or new.is_active is distinct from old.is_active) then
    raise exception 'ชนิดพลอยนี้ถูกรวมแล้ว แก้/เปิดใช้ซ้ำไม่ได้ (ย้อนกลับไม่ได้)' using errcode = '22023', hint = 'gem_merged_locked';
  end if;
  -- ยุบห่วงโซ่การรวม (merged_into ของแถวที่ถูกรวมแล้วเปลี่ยนไปชี้ปลายทางใหม่) ทำได้เฉพาะใน gem_merge · ย้อนเป็น null ไม่ได้
  if old.merged_into is not null and new.merged_into is distinct from old.merged_into and (not v_merge or new.merged_into is null) then
    raise exception 'ชนิดพลอยนี้ถูกรวมแล้ว แก้/เปิดใช้ซ้ำไม่ได้ (ย้อนกลับไม่ได้)' using errcode = '22023', hint = 'gem_merged_locked';
  end if;
  if new.merged_into is not null and new.merged_into is distinct from old.merged_into then
    -- ปลายทางต้องเป็นตัวจริง (ไม่ถูกรวม · ใช้งานอยู่) ของร้านเดียวกัน · ล็อกแถวปลายทางกันรวมซ้อนกัน
    perform 1 from analytics.gem_type t where t.id = new.merged_into and t.shop_id = new.shop_id and t.merged_into is null and t.is_active for share;
    if not found then
      raise exception 'ปลายทางของการรวมต้องเป็นชนิดพลอยที่ใช้งานอยู่และยังไม่ถูกรวม' using errcode = '22023', hint = 'gem_merge_invalid';
    end if;
  end if;
  return new;
end;
$f$;
drop trigger if exists trg_gem_type_guard on analytics.gem_type;
create trigger trg_gem_type_guard before insert or update on analytics.gem_type for each row execute function analytics.gem_type_guard();

create or replace function analytics.gem_shape_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_merge boolean := coalesce(current_setting('analytics.gem_merge', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.merged_into is not null then
      raise exception 'รูปทรงใหม่ต้องไม่ถูกสร้างในสถานะที่ถูกรวมแล้ว' using errcode = '22023', hint = 'gem_merge_invalid';
    end if;
    return new;
  end if;
  if (new.id, new.shop_id, new.created_by, new.created_by_worker_id, new.created_at, new.is_seed) is distinct from (old.id, old.shop_id, old.created_by, old.created_by_worker_id, old.created_at, old.is_seed) then
    raise exception 'analytics.gem_shape: ฟิลด์ตัวตนแก้ไม่ได้' using errcode = '42501';
  end if;
  -- has_length ใช้ตีความช่องขนาดของรายการทุกแถว — แก้ไม่ได้เมื่อมีรายการใช้รูปทรงนี้ (รวมรายการที่ถูกรวมแล้ว/ปิดใช้งาน)
  if new.has_length is distinct from old.has_length and exists (select 1 from analytics.gem_item i where i.gem_shape_id = old.id) then
    raise exception 'แก้จำนวนค่าขนาดของรูปทรงนี้ไม่ได้ — มีรายการพลอยใช้อยู่แล้ว' using errcode = '22023', hint = 'has_length_locked';
  end if;
  if old.merged_into is not null and (new.name is distinct from old.name or new.is_active is distinct from old.is_active or new.has_length is distinct from old.has_length) then
    raise exception 'รูปทรงนี้ถูกรวมแล้ว แก้/เปิดใช้ซ้ำไม่ได้ (ย้อนกลับไม่ได้)' using errcode = '22023', hint = 'gem_merged_locked';
  end if;
  if old.merged_into is not null and new.merged_into is distinct from old.merged_into and (not v_merge or new.merged_into is null) then
    raise exception 'รูปทรงนี้ถูกรวมแล้ว แก้/เปิดใช้ซ้ำไม่ได้ (ย้อนกลับไม่ได้)' using errcode = '22023', hint = 'gem_merged_locked';
  end if;
  if new.merged_into is not null and new.merged_into is distinct from old.merged_into then
    perform 1 from analytics.gem_shape s where s.id = new.merged_into and s.shop_id = new.shop_id and s.merged_into is null and s.is_active and s.has_length = new.has_length for share;
    if not found then
      raise exception 'ปลายทางของการรวมต้องเป็นรูปทรงที่ใช้งานอยู่ ยังไม่ถูกรวม และมีจำนวนค่าขนาดเท่ากัน' using errcode = '22023', hint = 'gem_merge_invalid';
    end if;
  end if;
  return new;
end;
$f$;
drop trigger if exists trg_gem_shape_guard on analytics.gem_shape;
create trigger trg_gem_shape_guard before insert or update on analytics.gem_shape for each row execute function analytics.gem_shape_guard();

create or replace function analytics.gem_item_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_t analytics.gem_type%rowtype;
  v_s analytics.gem_shape%rowtype;
  v_merge boolean := coalesce(current_setting('analytics.gem_merge', true), '') = 'on';
  v_chk_t boolean := true;     -- ตรวจ "ใช้งานอยู่/ไม่ถูกรวม" ของชนิด: INSERT เสมอ · UPDATE (ย้ายตอนรวมชื่อ) เฉพาะเมื่อชนิดเปลี่ยน
  v_chk_s boolean := true;
begin
  if tg_op = 'INSERT' then
    if new.merged_into is not null then
      raise exception 'รายการพลอยใหม่ต้องไม่ถูกสร้างในสถานะที่ถูกรวมแล้ว' using errcode = '22023', hint = 'gem_merge_invalid';
    end if;
  else
    v_chk_t := new.gem_type_id is distinct from old.gem_type_id;
    v_chk_s := new.gem_shape_id is distinct from old.gem_shape_id;
    if (new.id, new.shop_id, new.size_a, new.size_b, new.created_by, new.created_by_worker_id, new.created_at)
       is distinct from (old.id, old.shop_id, old.size_a, old.size_b, old.created_by, old.created_by_worker_id, old.created_at) then
      raise exception 'analytics.gem_item: ตัวตน/ขนาดของรายการแก้ไม่ได้ (สร้างรายการใหม่แทน)' using errcode = '42501';
    end if;
    if (new.gem_type_id, new.gem_shape_id) is not distinct from (old.gem_type_id, old.gem_shape_id) and new.merged_into is not distinct from old.merged_into then
      return new;                                  -- แก้เฉพาะ is_active/updated_at
    end if;
    if not v_merge then
      raise exception 'ย้ายชนิด/รูปทรง/รวมรายการได้ทางเดียวคือ gem_merge' using errcode = '42501';
    end if;
    if old.merged_into is not null and new.merged_into is null then
      raise exception 'รายการที่ถูกรวมแล้วย้อนกลับไม่ได้' using errcode = '22023', hint = 'gem_merged_locked';
    end if;
    if new.merged_into is not null then
      perform 1 from analytics.gem_item t where t.id = new.merged_into and t.shop_id = new.shop_id and t.merged_into is null and t.id <> new.id for share;
      if not found then
        raise exception 'ปลายทางของการรวมรายการต้องเป็นรายการจริงที่ยังไม่ถูกรวม' using errcode = '22023', hint = 'gem_merge_invalid';
      end if;
      return new;
    end if;
  end if;
  -- ชนิด/รูปทรงต้องเป็นตัวจริง ใช้งานอยู่ (ล็อก share กันรวมชื่อแทรกกลาง — gem_merge ล็อก for update ก่อนย้าย) และจำนวนค่าขนาดตรงกับรูปทรง
  -- ฝั่งที่ไม่เปลี่ยน (เช่น รวมชนิดแต่รูปทรงของรายการถูกปิดใช้ไปแล้ว) ยอมให้ปิดใช้อยู่ — ปิด = ซ่อนจาก dropdown ไม่ใช่ล็อกการดูแลแคตตาล็อก (QA N1/N2)
  select * into v_t from analytics.gem_type t where t.id = new.gem_type_id and t.shop_id = new.shop_id for share;
  if not found or (v_chk_t and (v_t.merged_into is not null or not v_t.is_active)) then
    raise exception 'ชนิดพลอยของรายการต้องเป็นชนิดที่ใช้งานอยู่และไม่ถูกรวม' using errcode = '22023', hint = 'gem_ref_inactive';
  end if;
  select * into v_s from analytics.gem_shape s where s.id = new.gem_shape_id and s.shop_id = new.shop_id for share;
  if not found or (v_chk_s and (v_s.merged_into is not null or not v_s.is_active)) then
    raise exception 'รูปทรงของรายการต้องเป็นรูปทรงที่ใช้งานอยู่และไม่ถูกรวม' using errcode = '22023', hint = 'gem_ref_inactive';
  end if;
  if v_s.has_length is distinct from (new.size_b is not null) then
    raise exception 'จำนวนค่าขนาดไม่ตรงกับรูปทรง (รูปทรงนี้ต้องใส่ % ค่า)', case when v_s.has_length then 2 else 1 end using errcode = '22023', hint = 'size_b_mismatch';
  end if;
  return new;
end;
$f$;
drop trigger if exists trg_gem_item_guard on analytics.gem_item;
create trigger trg_gem_item_guard before insert or update on analytics.gem_item for each row execute function analytics.gem_item_guard();

-- รายการ "ใช้งานได้": ตัวจริง ใช้งานอยู่ และชนิด/รูปทรงใช้งานอยู่ไม่ถูกรวม
create or replace function analytics.gem_item_live(p_item uuid)
 returns boolean
 language sql
 stable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
  select coalesce((select i.is_active and i.merged_into is null and t.is_active and t.merged_into is null and s.is_active and s.merged_into is null
                     from analytics.gem_item i
                     join analytics.gem_type t on t.id = i.gem_type_id and t.shop_id = i.shop_id
                     join analytics.gem_shape s on s.id = i.gem_shape_id and s.shop_id = i.shop_id
                    where i.id = p_item), false)
$f$;

create or replace function analytics.product_gem_bom_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_merge boolean := coalesce(current_setting('analytics.gem_merge', true), '') = 'on';
  v_shop uuid;
begin
  if tg_op = 'INSERT' then
    select p.shop_id into v_shop from public.product p where p.id = new.product_id for share;
    if not found or v_shop is distinct from new.shop_id then
      raise exception 'ไม่พบ SKU ในร้านนี้' using errcode = '22023', hint = 'gem_product_invalid';
    end if;
    perform 1 from analytics.gem_item i where i.id = new.gem_item_id and i.shop_id = new.shop_id for share;
    if not found or not analytics.gem_item_live(new.gem_item_id) then
      raise exception 'แม่แบบพลอยอ้างรายการที่ปิดใช้งาน/ถูกรวม/ไม่พบไม่ได้' using errcode = '22023', hint = 'gem_ref_inactive';
    end if;
  else
    if (new.id, new.shop_id, new.product_id, new.created_at) is distinct from (old.id, old.shop_id, old.product_id, old.created_at) then
      raise exception 'analytics.product_gem_bom: ฟิลด์ตัวตนแก้ไม่ได้' using errcode = '42501';
    end if;
    if new.gem_item_id is distinct from old.gem_item_id then
      if not v_merge then
        raise exception 'เปลี่ยนรายการพลอยของแม่แบบได้ทางเดียวคือ gem_merge (หรือลบแล้วเพิ่มใหม่)' using errcode = '42501';
      end if;
      perform 1 from analytics.gem_item i where i.id = new.gem_item_id and i.shop_id = new.shop_id and i.merged_into is null for share;
      if not found then
        raise exception 'ปลายทางของแม่แบบต้องเป็นรายการจริงที่ยังไม่ถูกรวม' using errcode = '22023', hint = 'gem_merge_invalid';
      end if;
    end if;
  end if;
  return new;
end;
$f$;
drop trigger if exists trg_product_gem_bom_guard on analytics.product_gem_bom;
create trigger trg_product_gem_bom_guard before insert or update on analytics.product_gem_bom for each row execute function analytics.product_gem_bom_guard();

create or replace function analytics.job_gem_bom_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_job analytics.job%rowtype;
  v_job_id uuid := case when tg_op = 'DELETE' then old.job_id else new.job_id end;
begin
  select * into v_job from analytics.job j where j.id = v_job_id;
  if tg_op = 'INSERT' then
    if not found or v_job.shop_id is distinct from new.shop_id then
      raise exception 'ไม่พบใบงานในร้านนี้' using errcode = '22023', hint = 'job_not_found';
    end if;
    if v_job.parent_job_id is not null then
      raise exception 'ส่วนย่อยไม่มีพลอยของตัวเอง — พลอยอยู่ที่ใบแม่' using errcode = '22023', hint = 'lot_no_gems';
    end if;
  end if;
  if v_job.status in ('done', 'cancelled') then
    raise exception 'ใบงาน % ปิดหรือยกเลิกแล้ว — แก้พลอยไม่ได้', v_job.job_no using errcode = '22023', hint = 'job_closed';
  end if;
  if tg_op = 'INSERT' then
    -- รายการต้องเป็นตัวจริง (ไม่ถูกรวม) · ใช้งานอยู่ — ยกเว้นแถวที่คัดลอกจากแม่แบบ (แม่แบบเก่ายังอ้างรายการที่ปิดใช้งานได้ · ปิด = ซ่อนจาก dropdown เท่านั้น)
    perform 1 from analytics.gem_item i where i.id = new.gem_item_id and i.shop_id = new.shop_id and i.merged_into is null for share;
    if not found or not (new.source = 'product' or analytics.gem_item_live(new.gem_item_id)) then
      raise exception 'รายการพลอยปิดใช้งาน/ถูกรวม/ไม่พบ — เลือกรายการอื่น' using errcode = '22023', hint = 'gem_ref_inactive';
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.id, new.shop_id, new.job_id, new.gem_item_id, new.gem_label, new.source, new.created_by, new.created_by_worker_id, new.created_at)
       is distinct from (old.id, old.shop_id, old.job_id, old.gem_item_id, old.gem_label, old.source, old.created_by, old.created_by_worker_id, old.created_at) then
      raise exception 'analytics.job_gem_bom: ตัวตน/ฉลาก snapshot ของแถวแก้ไม่ได้ (แก้ได้เฉพาะจำนวน/ตำแหน่ง/ลำดับ)' using errcode = '42501';
    end if;
    return new;
  end if;
  return old;
end;
$f$;
drop trigger if exists trg_job_gem_bom_guard on analytics.job_gem_bom;
create trigger trg_job_gem_bom_guard before insert or update or delete on analytics.job_gem_bom for each row execute function analytics.job_gem_bom_guard();

-- ============================================================================
-- 4. helper ภายใน (ไม่ grant ใคร — เรียกจาก RPC definer เท่านั้น)
-- ============================================================================

-- seed รูปทรงมาตรฐาน 12 แบบ — เฉพาะร้านที่ยังไม่มีรูปทรงเลย (เจ้าของลบ/เปลี่ยนชื่อแล้วไม่ฟื้นกลับ) · ไม่ seed ชนิด/ราคา (มติ 21 ต.ค.)
-- เจ้าของยืนยันแล้ว 22 ต.ค.: 12 แบบ · หัวใจ = 1 ค่า · คุชชั่น = 2 ค่า · "บาแก็ตต์" ตามเอกสารเจ้าของ
create or replace function analytics.gem_shape_ensure(p_shop_id uuid)
 returns void
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
begin
  if p_shop_id is null then
    raise exception 'gem_shape_ensure: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('gem_shape_ensure:' || p_shop_id::text, 0));
  if exists (select 1 from analytics.gem_shape where shop_id = p_shop_id) then
    return;
  end if;
  insert into analytics.gem_shape (shop_id, name, has_length, is_seed)
  select p_shop_id, v.name, v.has_length, true
    from (values
      ('กลม', false), ('สี่เหลี่ยมจัตุรัส', false), ('6 เหลี่ยม', false), ('สามเหลี่ยม', false), ('หัวใจ', false),
      ('ไข่', true), ('เอมเมอรัลด์', true), ('คุชชั่น', true), ('หยดน้ำ', true), ('มาร์คีส์', true), ('บาแก็ตต์', true), ('สี่เหลี่ยมผืนผ้า', true)
    ) as v(name, has_length);
end;
$f$;

-- ตามห่วงโซ่ merged_into ไปตัวปลายทาง (ห่วงโซ่ถูกยุบเหลือชั้นเดียวตอน gem_merge · วนไม่เกิน 8 กันข้อมูลวน)
create or replace function analytics.gem_type_canonical(p_id uuid)
 returns uuid
 language plpgsql
 stable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
declare v uuid := p_id; n uuid; i int := 0;
begin
  loop
    select t.merged_into into n from analytics.gem_type t where t.id = v;
    exit when n is null or i >= 8;
    v := n; i := i + 1;
  end loop;
  return v;
end;
$f$;

create or replace function analytics.gem_shape_canonical(p_id uuid)
 returns uuid
 language plpgsql
 stable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
declare v uuid := p_id; n uuid; i int := 0;
begin
  loop
    select s.merged_into into n from analytics.gem_shape s where s.id = v;
    exit when n is null or i >= 8;
    v := n; i := i + 1;
  end loop;
  return v;
end;
$f$;

create or replace function analytics.gem_item_canonical(p_id uuid)
 returns uuid
 language plpgsql
 stable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
declare v uuid := p_id; n uuid; i int := 0;
begin
  loop
    select g.merged_into into n from analytics.gem_item g where g.id = v;
    exit when n is null or i >= 8;
    v := n; i := i + 1;
  end loop;
  return v;
end;
$f$;

-- รายการพลอยเป็น json — 🔴 ไม่มีราคา (ใช้ในผลของฟอร์มใบงาน/แม่แบบ/dropdown ที่ staff เห็นได้)
create or replace function analytics.gem_item_json(p_item uuid)
 returns jsonb
 language sql
 stable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
  select jsonb_build_object('gem_item_id', i.id, 'type_id', t.id, 'type_name', t.name, 'shape_id', s.id, 'shape_name', s.name, 'has_length', s.has_length,
                            'size_a', trim_scale(i.size_a), 'size_b', trim_scale(i.size_b), 'size_label', i.size_label,
                            'label', analytics.gem_label_compose(t.name, s.name, i.size_label), 'is_active', i.is_active)
    from analytics.gem_item i
    join analytics.gem_type t on t.id = i.gem_type_id and t.shop_id = i.shop_id
    join analytics.gem_shape s on s.id = i.gem_shape_id and s.shop_id = i.shop_id
   where i.id = p_item
$f$;

-- ตัวเลขจาก json: รับ number หรือสตริงตัวเลขล้วน (ไม่รับ NaN/Infinity/เลขฐานสอง ฯลฯ) — ไม่ผ่าน = null
create or replace function analytics.gem_num_parse(p jsonb)
 returns numeric
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $f$
  select case jsonb_typeof(p)
           when 'number' then (p #>> '{}')::numeric
           when 'string' then case when (p #>> '{}') ~ '^[0-9]{1,6}(\.[0-9]{1,12})?$' then (p #>> '{}')::numeric end
         end
$f$;

create or replace function analytics.gem_int_parse(p jsonb)
 returns int
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $f$
  select case when analytics.gem_num_parse(p) is not null
               and analytics.gem_num_parse(p) = trunc(analytics.gem_num_parse(p))
               and analytics.gem_num_parse(p) between -2147483648 and 2147483647
              then analytics.gem_num_parse(p)::int end
$f$;

-- ผู้ทำรายการแคตตาล็อก/ราคาต้องเป็นสมาชิก owner/admin ของร้านจริง — แม้ผู้เรียกเป็น service_role (ซึ่งผ่าน crm_require_owner_admin เสมอ)
-- ราคาพลอย = ต้นทุน: role ฝั่งหน้าจอ (staff) ตรวจที่ชั้นแอป · ที่นี่คือกำแพงที่ DB (role-single-level: กฎที่ต้องบังคับจริงอยู่ที่ DB ไม่ใช่ปุ่ม)
create or replace function analytics.gem_require_office(p_shop_id uuid, p_actor uuid)
 returns void
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
begin
  perform analytics.crm_require_owner_admin(p_shop_id);
  if p_actor is null then
    raise exception 'ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  if not exists (select 1 from public.shop_member m where m.shop_id = p_shop_id and m.user_id = p_actor and m.role in ('owner', 'admin')) then
    raise exception 'แคตตาล็อกพลอยและราคา (ต้นทุน) ใช้ได้เฉพาะ owner/admin ของร้าน' using errcode = '42501', hint = 'gem_actor_forbidden';
  end if;
end;
$f$;

-- ชื่อที่ "คล้าย" ในแคตตาล็อกที่ใช้งานอยู่ (ไม่ถูกรวม · ไม่ปิด) — ≤ 5 รายการ เรียงชื่อ · [] ถ้าไม่มี · p_exclude = ตัวที่กำลังเปลี่ยนชื่อ (ไม่เทียบกับตัวเอง)
--   ใช้ที่เดียวกันทุกทาง: gem_lines_prepare (ชนิด/รูปทรงใหม่) · gem_catalog_create · gem_catalog_rename — กติกา "ใครคล้ายใคร" มีที่เดียว
create or replace function analytics.gem_similar_hits(p_shop_id uuid, p_kind text, p_name text, p_exclude uuid default null)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'pg_catalog', 'analytics', 'pg_temp'
as $f$
declare
  v jsonb;
begin
  if p_kind = 'type' then
    select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.name), '[]'::jsonb) into v
      from (select t.id, t.name from analytics.gem_type t
             where t.shop_id = p_shop_id and t.merged_into is null and t.is_active and (p_exclude is null or t.id <> p_exclude) and analytics.gem_name_similar(p_name, t.name)
             order by t.name limit 5) m;
  elsif p_kind = 'shape' then
    select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.name), '[]'::jsonb) into v
      from (select s.id, s.name from analytics.gem_shape s
             where s.shop_id = p_shop_id and s.merged_into is null and s.is_active and (p_exclude is null or s.id <> p_exclude) and analytics.gem_name_similar(p_name, s.name)
             order by s.name limit 5) m;
  else
    raise exception 'gem_similar_hits: kind ต้องเป็น type หรือ shape' using errcode = '22023';
  end if;
  return v;
end;
$f$;

-- ============================================================================
-- 4.1 gem_lines_prepare — แปลง/ตรวจแถวพลอยจาก client → รายการที่ resolve แล้ว (+สร้างชื่อใหม่เข้าแคตตาล็อกในทรานแซกชันของผู้เรียก)
--   รูปแถว (ต้องมีเฉพาะ key เหล่านี้ — key อื่น เช่น price = ปฏิเสธ):
--     { type_id | new_type_name, shape_id | new_shape:{name, has_length}, size_a, size_b?, qty_per_piece, position? }  หรือ  { gem_item_id, qty_per_piece, position? }
--   ลำดับ: (A) ตรวจทุกแถวไม่เขียน → (B) รวมแถวซ้ำ (ชนิด+รูปทรง+ขนาดเดียวกัน บวกจำนวน) → (C) ตัวดักชื่อคล้าย (ไม่ส่ง p_force = คืน gem_similar ทั้งก้อน ยังไม่เขียนอะไร) → (D) สร้างชื่อใหม่/รายการ (get-or-create — แข่งกันพร้อมกัน = ได้ตัวเดียว)
--   ข้อผิดพลาดทั้งหมด = 22023 + hint รหัส + detail json {row, field, code} · ผลเขียนเฉพาะที่ (D) — ล้มก่อนหน้านั้นไม่มีอะไรเกิด · ผู้เรียกต้องเรียกในทรานแซกชันที่ล็อกแถวใบ/สินค้าแล้ว
--   p_allow_item_ids: รายการที่ปิดใช้งานแล้วแต่ "มีอยู่แล้วในแถวเดิม" ส่งซ้ำได้ (ปิด = ซ่อนจาก dropdown ไม่ใช่ลบทิ้งของเก่า)
-- ============================================================================
create or replace function analytics.gem_lines_prepare(
  p_shop_id uuid, p_lines jsonb, p_force boolean, p_actor uuid, p_worker_id uuid,
  p_allow_item_ids uuid[] default '{}'::uuid[])
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  c_keys constant text[] := array['type_id', 'new_type_name', 'shape_id', 'new_shape', 'gem_item_id', 'size_a', 'size_b', 'qty_per_piece', 'position'];
  v_force   boolean := coalesce(p_force, false);
  v_by      uuid := case when p_worker_id is null then p_actor end;
  v_el      jsonb;
  v_row     int;
  v_bad     text;
  v_err     text;
  v_k       text;
  v_parsed  jsonb := '[]'::jsonb;
  v_reused  jsonb := '[]'::jsonb;
  v_dups    jsonb := '[]'::jsonb;
  v_ctypes  jsonb := '[]'::jsonb;
  v_cshapes jsonb := '[]'::jsonb;
  v_citems  jsonb := '[]'::jsonb;
  v_merged  jsonb := '[]'::jsonb;
  v_idx     jsonb := '{}'::jsonb;
  v_tmap    jsonb := '{}'::jsonb;
  v_smap    jsonb := '{}'::jsonb;
  v_out     jsonb := '[]'::jsonb;
  v_newt    jsonb;
  v_news    jsonb;
  v_hits    jsonb := '[]'::jsonb;
  v_m       jsonb;
  v_e       jsonb;
  v_pr      jsonb;
  v_i_pos   int;
  v_o       int;
  v_typeid  uuid; v_shapeid uuid; v_itemid uuid; v_orig_item uuid;
  v_tname text; v_tnorm text; v_tnew boolean; v_ttyped text;
  v_sname text; v_snorm text; v_snew boolean; v_styped text; v_hl boolean;
  v_a numeric; v_b numeric; v_tmp numeric; v_qty int; v_pos text; v_pos2 text;
  v_t analytics.gem_type%rowtype;
  v_s analytics.gem_shape%rowtype;
  v_i analytics.gem_item%rowtype;
  v_first_row int;
  v_allow uuid[] := coalesce(p_allow_item_ids, '{}'::uuid[]);
begin
  if p_shop_id is null then
    raise exception 'gem_lines_prepare: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    perform analytics.gem_line_fail(0, 'lines', 'lines_invalid', 'รายการพลอยต้องเป็นรายการ (array)');
  end if;
  if jsonb_array_length(p_lines) > 30 then
    perform analytics.gem_line_fail(31, 'lines', 'too_many_lines', 'พลอยต่อใบมีได้ไม่เกิน 30 รายการ');
  end if;
  perform analytics.gem_shape_ensure(p_shop_id);

  -- (A) ตรวจทุกแถว (ไม่เขียน)
  for v_el, v_row in select e.value, e.ordinality::int from jsonb_array_elements(p_lines) with ordinality as e(value, ordinality) loop
    if jsonb_typeof(v_el) <> 'object' then
      perform analytics.gem_line_fail(v_row, 'line', 'line_invalid', 'แถวพลอยไม่ถูกต้อง');
    end if;
    select k into v_bad from jsonb_object_keys(v_el) k where k <> all (c_keys) limit 1;
    if v_bad is not null then
      perform analytics.gem_line_fail(v_row, v_bad, 'line_invalid', 'แถวพลอยมีข้อมูลที่ไม่รองรับ');
    end if;
    -- จำนวนต่อชิ้น: เลขเต็ม 1-1,000
    v_qty := analytics.gem_int_parse(v_el -> 'qty_per_piece');
    if v_qty is null or not (v_qty between 1 and 1000) then
      perform analytics.gem_line_fail(v_row, 'qty_per_piece', 'qty_invalid', 'จำนวนต่อชิ้นต้องเป็นเลขเต็ม 1–1,000');
    end if;
    -- ตำแหน่ง (ไม่บังคับ · ≤ 40 ตัวอักษร · ห้าม < > ล่องหน)
    v_pos := null;
    if v_el ? 'position' and jsonb_typeof(v_el -> 'position') <> 'null' then
      if jsonb_typeof(v_el -> 'position') <> 'string' then
        perform analytics.gem_line_fail(v_row, 'position', 'position_invalid', 'ตำแหน่งไม่ถูกต้อง');
      end if;
      v_err := null;
      begin
        v_pos := analytics.job_label_clean(v_el ->> 'position', 'ตำแหน่ง', 40);
      exception when sqlstate '22023' then
        v_err := sqlerrm;
      end;
      if v_err is not null then
        perform analytics.gem_line_fail(v_row, 'position', 'position_invalid', v_err);
      end if;
    end if;

    v_ttyped := null; v_styped := null; v_typeid := null; v_shapeid := null; v_itemid := null;
    if v_el ? 'gem_item_id' and jsonb_typeof(v_el -> 'gem_item_id') <> 'null' then
      -- โหมดรายการ: ห้ามมีฟิลด์ชนิด/รูปทรง/ขนาดปน
      foreach v_k in array array['type_id', 'new_type_name', 'shape_id', 'new_shape', 'size_a', 'size_b'] loop
        if v_el ? v_k and jsonb_typeof(v_el -> v_k) <> 'null' then
          perform analytics.gem_line_fail(v_row, v_k, 'line_invalid', 'แถวที่ระบุรายการพลอยโดยตรงต้องไม่มีชนิด/รูปทรง/ขนาดซ้อน');
        end if;
      end loop;
      v_err := null;
      begin
        v_orig_item := (v_el ->> 'gem_item_id')::uuid;
      exception when others then
        v_err := 'x';
      end;
      if v_err is not null or jsonb_typeof(v_el -> 'gem_item_id') <> 'string' then
        perform analytics.gem_line_fail(v_row, 'gem_item_id', 'gem_item_invalid', 'ไม่พบรายการพลอย');
      end if;
      select * into v_i from analytics.gem_item g where g.id = v_orig_item and g.shop_id = p_shop_id;
      if not found then
        perform analytics.gem_line_fail(v_row, 'gem_item_id', 'gem_item_invalid', 'ไม่พบรายการพลอย');
      end if;
      v_itemid := analytics.gem_item_canonical(v_orig_item);
      select * into v_i from analytics.gem_item g where g.id = v_itemid;
      if not (analytics.gem_item_live(v_itemid) or v_itemid = any (v_allow) or v_orig_item = any (v_allow)) then
        perform analytics.gem_line_fail(v_row, 'gem_item_id', 'gem_inactive', 'รายการพลอยนี้ปิดใช้งานแล้ว — เลือกรายการอื่น');
      end if;
      select * into v_t from analytics.gem_type t where t.id = v_i.gem_type_id;
      select * into v_s from analytics.gem_shape s where s.id = v_i.gem_shape_id;
      v_typeid := v_t.id; v_tname := v_t.name; v_tnorm := v_t.name_norm; v_tnew := false;
      v_shapeid := v_s.id; v_sname := v_s.name; v_snorm := v_s.name_norm; v_snew := false; v_hl := v_s.has_length;
      v_a := v_i.size_a; v_b := v_i.size_b;
    else
      -- ชนิด: id (resolve ตามการรวมชื่อ) หรือชื่อใหม่ — อย่างใดอย่างหนึ่ง
      if (v_el ? 'type_id' and jsonb_typeof(v_el -> 'type_id') <> 'null') = (v_el ? 'new_type_name' and jsonb_typeof(v_el -> 'new_type_name') <> 'null') then
        perform analytics.gem_line_fail(v_row, 'type', 'type_required', 'เลือกหรือพิมพ์ชนิดพลอย (อย่างใดอย่างหนึ่ง)');
      end if;
      if v_el ? 'type_id' and jsonb_typeof(v_el -> 'type_id') <> 'null' then
        v_err := null;
        begin
          v_typeid := (v_el ->> 'type_id')::uuid;
        exception when others then
          v_err := 'x';
        end;
        if v_err is not null or jsonb_typeof(v_el -> 'type_id') <> 'string' then
          perform analytics.gem_line_fail(v_row, 'type', 'gem_type_invalid', 'ไม่พบชนิดพลอย');
        end if;
        select * into v_t from analytics.gem_type t where t.id = v_typeid and t.shop_id = p_shop_id;
        if not found then
          perform analytics.gem_line_fail(v_row, 'type', 'gem_type_invalid', 'ไม่พบชนิดพลอย');
        end if;
        v_typeid := analytics.gem_type_canonical(v_typeid);
        select * into v_t from analytics.gem_type t where t.id = v_typeid;
        if not v_t.is_active then
          perform analytics.gem_line_fail(v_row, 'type', 'gem_inactive', 'ชนิดพลอยนี้ปิดใช้งานแล้ว — เลือกชนิดอื่น');
        end if;
        v_tname := v_t.name; v_tnorm := v_t.name_norm; v_tnew := false;
      else
        if jsonb_typeof(v_el -> 'new_type_name') <> 'string' then
          perform analytics.gem_line_fail(v_row, 'type', 'name_invalid', 'ชื่อชนิดพลอยไม่ถูกต้อง');
        end if;
        v_err := null;
        begin
          v_ttyped := analytics.gem_name_clean(v_el ->> 'new_type_name', 'ชื่อชนิดพลอย');
        exception when sqlstate '22023' then
          v_err := sqlerrm;
        end;
        if v_err is not null then
          perform analytics.gem_line_fail(v_row, 'type', 'name_invalid', v_err);
        end if;
        v_tnorm := analytics.gem_name_norm(v_ttyped);
        select * into v_t from analytics.gem_type t where t.shop_id = p_shop_id and t.name_norm = v_tnorm;
        if found then
          -- ชื่อเท่ากับที่มี (หลัง normalize) = ใช้ตัวเดิมให้ ไม่ใช่ error · ตัวที่ถูกรวมแล้ว = ไปตัวปลายทาง · force ไม่เกี่ยว (ไม่สร้างแถวซ้ำเด็ดขาด)
          v_typeid := analytics.gem_type_canonical(v_t.id);
          select * into v_t from analytics.gem_type t where t.id = v_typeid;
          if not v_t.is_active then
            perform analytics.gem_line_fail(v_row, 'type', 'gem_inactive', 'ชนิดพลอยนี้ปิดใช้งานแล้ว — เลือกชนิดอื่น หรือแจ้งออฟฟิศ');
          end if;
          v_tname := v_t.name; v_tnorm := v_t.name_norm; v_tnew := false;
          v_reused := v_reused || jsonb_build_object('row', v_row, 'kind', 'type', 'typed', v_ttyped, 'id', v_t.id, 'name', v_t.name);
        else
          v_typeid := null; v_tname := v_ttyped; v_tnew := true;
        end if;
      end if;

      -- รูปทรง: id หรือ {name, has_length} ใหม่
      if (v_el ? 'shape_id' and jsonb_typeof(v_el -> 'shape_id') <> 'null') = (v_el ? 'new_shape' and jsonb_typeof(v_el -> 'new_shape') <> 'null') then
        perform analytics.gem_line_fail(v_row, 'shape', 'shape_required', 'เลือกหรือพิมพ์รูปทรง (อย่างใดอย่างหนึ่ง)');
      end if;
      if v_el ? 'shape_id' and jsonb_typeof(v_el -> 'shape_id') <> 'null' then
        v_err := null;
        begin
          v_shapeid := (v_el ->> 'shape_id')::uuid;
        exception when others then
          v_err := 'x';
        end;
        if v_err is not null or jsonb_typeof(v_el -> 'shape_id') <> 'string' then
          perform analytics.gem_line_fail(v_row, 'shape', 'gem_shape_invalid', 'ไม่พบรูปทรง');
        end if;
        select * into v_s from analytics.gem_shape s where s.id = v_shapeid and s.shop_id = p_shop_id;
        if not found then
          perform analytics.gem_line_fail(v_row, 'shape', 'gem_shape_invalid', 'ไม่พบรูปทรง');
        end if;
        v_shapeid := analytics.gem_shape_canonical(v_shapeid);
        select * into v_s from analytics.gem_shape s where s.id = v_shapeid;
        if not v_s.is_active then
          perform analytics.gem_line_fail(v_row, 'shape', 'gem_inactive', 'รูปทรงนี้ปิดใช้งานแล้ว — เลือกรูปทรงอื่น');
        end if;
        v_sname := v_s.name; v_snorm := v_s.name_norm; v_snew := false; v_hl := v_s.has_length;
      else
        if jsonb_typeof(v_el -> 'new_shape') <> 'object' then
          perform analytics.gem_line_fail(v_row, 'shape', 'shape_new_invalid', 'รูปทรงใหม่ต้องระบุชื่อและจำนวนค่าขนาด');
        end if;
        select k into v_bad from jsonb_object_keys(v_el -> 'new_shape') k where k <> all (array['name', 'has_length']) limit 1;
        if v_bad is not null or coalesce(jsonb_typeof(v_el -> 'new_shape' -> 'name'), '') <> 'string' or coalesce(jsonb_typeof(v_el -> 'new_shape' -> 'has_length'), '') <> 'boolean' then
          perform analytics.gem_line_fail(v_row, 'shape', 'shape_new_invalid', 'รูปทรงใหม่ต้องระบุชื่อและจำนวนค่าขนาด (1 หรือ 2 ค่า)');
        end if;
        v_err := null;
        begin
          v_styped := analytics.gem_name_clean(v_el -> 'new_shape' ->> 'name', 'ชื่อรูปทรง');
        exception when sqlstate '22023' then
          v_err := sqlerrm;
        end;
        if v_err is not null then
          perform analytics.gem_line_fail(v_row, 'shape', 'name_invalid', v_err);
        end if;
        v_snorm := analytics.gem_name_norm(v_styped);
        select * into v_s from analytics.gem_shape s where s.shop_id = p_shop_id and s.name_norm = v_snorm;
        if found then
          v_shapeid := analytics.gem_shape_canonical(v_s.id);
          select * into v_s from analytics.gem_shape s where s.id = v_shapeid;
          if not v_s.is_active then
            perform analytics.gem_line_fail(v_row, 'shape', 'gem_inactive', 'รูปทรงนี้ปิดใช้งานแล้ว — เลือกรูปทรงอื่น หรือแจ้งออฟฟิศ');
          end if;
          v_sname := v_s.name; v_snorm := v_s.name_norm; v_snew := false; v_hl := v_s.has_length;
          v_reused := v_reused || jsonb_build_object('row', v_row, 'kind', 'shape', 'typed', v_styped, 'id', v_s.id, 'name', v_s.name);
        else
          v_shapeid := null; v_sname := v_styped; v_snew := true; v_hl := (v_el -> 'new_shape' ->> 'has_length')::boolean;
        end if;
      end if;

      -- ขนาด: ค่าเดียว (has_length=false) หรือกว้าง×ยาว (true) · 0 < x ≤ 100 · ทศนิยม ≤ 2 (ไม่ปัดเงียบ) · กว้าง ≤ ยาว (สลับให้)
      v_a := analytics.gem_num_parse(v_el -> 'size_a');
      if v_a is null then
        perform analytics.gem_line_fail(v_row, 'size_a',
          case when v_el ? 'size_a' and jsonb_typeof(v_el -> 'size_a') <> 'null' then 'size_invalid' else 'size_required' end, 'ใส่ขนาด (มม.) เป็นตัวเลขมากกว่า 0 ไม่เกิน 100');
      end if;
      if not (v_a > 0 and v_a <= 100) or v_a <> round(v_a, 2) then
        perform analytics.gem_line_fail(v_row, 'size_a', 'size_invalid', 'ขนาดต้องเป็นตัวเลขมากกว่า 0 ไม่เกิน 100 มม. (ทศนิยมไม่เกิน 2 ตำแหน่ง)');
      end if;
      if v_hl then
        if not (v_el ? 'size_b') or jsonb_typeof(v_el -> 'size_b') = 'null' then
          perform analytics.gem_line_fail(v_row, 'size_b', 'size_b_required', 'ใส่ทั้งกว้างและยาว (มม.)');
        end if;
        v_b := analytics.gem_num_parse(v_el -> 'size_b');
        if v_b is null or not (v_b > 0 and v_b <= 100) or v_b <> round(v_b, 2) then
          perform analytics.gem_line_fail(v_row, 'size_b', 'size_invalid', 'ขนาดต้องเป็นตัวเลขมากกว่า 0 ไม่เกิน 100 มม. (ทศนิยมไม่เกิน 2 ตำแหน่ง)');
        end if;
        if v_a > v_b then
          v_tmp := v_a; v_a := v_b; v_b := v_tmp;
        end if;
      else
        if v_el ? 'size_b' and jsonb_typeof(v_el -> 'size_b') <> 'null' then
          perform analytics.gem_line_fail(v_row, 'size_b', 'size_b_unexpected', 'รูปทรงนี้ใส่ขนาดค่าเดียว — ไม่ต้องใส่ด้านที่สอง');
        end if;
        v_b := null;
      end if;
    end if;

    v_k := v_tnorm || '|' || v_snorm || '|' || trim_scale(v_a)::text || '|' || coalesce(trim_scale(v_b)::text, '0');
    v_parsed := v_parsed || jsonb_build_object(
      'row', v_row, 'key', v_k, 'type_id', v_typeid, 'type_name', v_tname, 'type_norm', v_tnorm, 'type_new', v_tnew,
      'shape_id', v_shapeid, 'shape_name', v_sname, 'shape_norm', v_snorm, 'shape_new', v_snew, 'has_length', v_hl,
      'size_a', v_a, 'size_b', v_b, 'qty', v_qty, 'position', v_pos, 'item_id', v_itemid);
  end loop;

  -- (B) แถวซ้ำ (ชนิด+รูปทรง+ขนาดเดียวกัน หลัง resolve/normalize) = รวมให้ บวกจำนวน (รวมแล้วเกิน 1,000 = ปฏิเสธ) · ตำแหน่งต่อกันด้วย ", " ตัดซ้ำ
  for v_pr in select e.value from jsonb_array_elements(v_parsed) with ordinality as e(value, ordinality) order by e.ordinality loop
    v_k := v_pr ->> 'key';
    if v_idx ? v_k then
      v_i_pos := (v_idx ->> v_k)::int;
      v_e := v_merged -> v_i_pos;
      v_qty := (v_e ->> 'qty')::int + (v_pr ->> 'qty')::int;
      if v_qty > 1000 then
        perform analytics.gem_line_fail((v_pr ->> 'row')::int, 'qty_per_piece', 'qty_invalid', 'รวมแถวที่ซ้ำกันแล้วจำนวนต่อชิ้นเกิน 1,000');
      end if;
      v_pos := v_e ->> 'position'; v_pos2 := v_pr ->> 'position';
      if v_pos2 is not null and v_pos is null then
        v_pos := v_pos2;
      elsif v_pos2 is not null and not (v_pos2 = any (string_to_array(v_pos, ', '))) then
        v_pos := v_pos || ', ' || v_pos2;
        if char_length(v_pos) > 40 then
          perform analytics.gem_line_fail((v_pr ->> 'row')::int, 'position', 'position_invalid', 'ตำแหน่งของแถวที่รวมกันยาวเกิน 40 ตัวอักษร — ตัดให้สั้นลง');
        end if;
      end if;
      v_e := v_e || jsonb_build_object('qty', v_qty, 'position', v_pos, 'rows', (v_e -> 'rows') || jsonb_build_array(v_pr -> 'row'));
      v_merged := jsonb_set(v_merged, array[v_i_pos::text], v_e);
    else
      v_idx := v_idx || jsonb_build_object(v_k, jsonb_array_length(v_merged));
      v_merged := v_merged || (v_pr || jsonb_build_object('rows', jsonb_build_array(v_pr -> 'row')));
    end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('rows', e.value -> 'rows') order by e.ordinality), '[]'::jsonb) into v_dups
    from jsonb_array_elements(v_merged) with ordinality as e(value, ordinality) where jsonb_array_length(e.value -> 'rows') > 1;

  -- (C) ตัวดักชื่อคล้าย (เฉพาะชื่อที่จะ "สร้างใหม่") — เทียบกับแคตตาล็อกที่ใช้งานอยู่ + ชื่อใหม่อื่นในคำขอเดียวกัน · norm เท่ากันไม่มาถึงตรงนี้ (resolve ไปตัวเดิมแล้ว)
  select coalesce(jsonb_agg(x order by o), '[]'::jsonb) into v_newt from (
    select distinct on (e.value ->> 'type_norm') jsonb_build_object('norm', e.value ->> 'type_norm', 'name', e.value ->> 'type_name', 'rows', e.value -> 'rows') as x, e.ordinality as o
      from jsonb_array_elements(v_merged) with ordinality as e(value, ordinality) where (e.value ->> 'type_new')::boolean
     order by e.value ->> 'type_norm', e.ordinality) d;
  select coalesce(jsonb_agg(x order by o), '[]'::jsonb) into v_news from (
    select distinct on (e.value ->> 'shape_norm') jsonb_build_object('norm', e.value ->> 'shape_norm', 'name', e.value ->> 'shape_name', 'rows', e.value -> 'rows', 'has_length', e.value -> 'has_length') as x, e.ordinality as o
      from jsonb_array_elements(v_merged) with ordinality as e(value, ordinality) where (e.value ->> 'shape_new')::boolean
     order by e.value ->> 'shape_norm', e.ordinality) d;
  for v_e in select value from jsonb_array_elements(v_newt) loop
    v_m := analytics.gem_similar_hits(p_shop_id, 'type', v_e ->> 'name') || coalesce((select jsonb_agg(jsonb_build_object('id', null, 'name', o2.value ->> 'name'))
                              from jsonb_array_elements(v_newt) o2
                             where o2.value ->> 'norm' <> v_e ->> 'norm' and analytics.gem_name_similar(v_e ->> 'name', o2.value ->> 'name')), '[]'::jsonb);
    if jsonb_array_length(v_m) > 0 then
      v_hits := v_hits || jsonb_build_object('kind', 'type', 'name', v_e ->> 'name', 'rows', v_e -> 'rows', 'matches', v_m);
    end if;
  end loop;
  for v_e in select value from jsonb_array_elements(v_news) loop
    v_m := analytics.gem_similar_hits(p_shop_id, 'shape', v_e ->> 'name') || coalesce((select jsonb_agg(jsonb_build_object('id', null, 'name', o2.value ->> 'name'))
                              from jsonb_array_elements(v_news) o2
                             where o2.value ->> 'norm' <> v_e ->> 'norm' and analytics.gem_name_similar(v_e ->> 'name', o2.value ->> 'name')), '[]'::jsonb);
    if jsonb_array_length(v_m) > 0 then
      v_hits := v_hits || jsonb_build_object('kind', 'shape', 'name', v_e ->> 'name', 'rows', v_e -> 'rows', 'matches', v_m);
    end if;
  end loop;
  if jsonb_array_length(v_hits) > 0 and not v_force then
    raise exception 'พบชื่อพลอยที่คล้ายกับที่มีอยู่แล้ว — ใช้ตัวที่มี หรือยืนยันเพิ่มเป็นชื่อใหม่' using errcode = '22023', hint = 'gem_similar',
      detail = jsonb_build_object('similar', v_hits)::text;
  end if;

  -- (D) เขียน: ชนิด/รูปทรงใหม่ (get-or-create ด้วย norm — 2 คนพิมพ์ชื่อเดียวกันพร้อมกัน = ได้ตัวเดียว ไม่ชน)
  for v_e in select value from jsonb_array_elements(v_newt) loop
    v_tnorm := v_e ->> 'norm';
    v_typeid := null;
    insert into analytics.gem_type (shop_id, name, created_by, created_by_worker_id)
    values (p_shop_id, v_e ->> 'name', v_by, p_worker_id)
    on conflict (shop_id, name_norm) do nothing
    returning id into v_typeid;
    if v_typeid is null then
      select t.id into v_typeid from analytics.gem_type t where t.shop_id = p_shop_id and t.name_norm = v_tnorm;
      v_typeid := analytics.gem_type_canonical(v_typeid);
      select * into v_t from analytics.gem_type t where t.id = v_typeid;
      if not v_t.is_active then
        perform analytics.gem_line_fail((v_e -> 'rows' ->> 0)::int, 'type', 'gem_inactive', 'ชนิดพลอยนี้ปิดใช้งานแล้ว — เลือกชนิดอื่น หรือแจ้งออฟฟิศ');
      end if;
      v_reused := v_reused || jsonb_build_object('row', (v_e -> 'rows' ->> 0)::int, 'kind', 'type', 'typed', v_e ->> 'name', 'id', v_t.id, 'name', v_t.name);
    else
      v_ctypes := v_ctypes || jsonb_build_object('id', v_typeid, 'name', v_e ->> 'name');
    end if;
    v_tmap := v_tmap || jsonb_build_object(v_tnorm, v_typeid);
  end loop;
  for v_e in select value from jsonb_array_elements(v_news) loop
    v_snorm := v_e ->> 'norm';
    v_shapeid := null;
    insert into analytics.gem_shape (shop_id, name, has_length, created_by, created_by_worker_id)
    values (p_shop_id, v_e ->> 'name', (v_e ->> 'has_length')::boolean, v_by, p_worker_id)
    on conflict (shop_id, name_norm) do nothing
    returning id into v_shapeid;
    if v_shapeid is null then
      select s.id into v_shapeid from analytics.gem_shape s where s.shop_id = p_shop_id and s.name_norm = v_snorm;
      v_shapeid := analytics.gem_shape_canonical(v_shapeid);
      select * into v_s from analytics.gem_shape s where s.id = v_shapeid;
      if not v_s.is_active then
        perform analytics.gem_line_fail((v_e -> 'rows' ->> 0)::int, 'shape', 'gem_inactive', 'รูปทรงนี้ปิดใช้งานแล้ว — เลือกรูปทรงอื่น หรือแจ้งออฟฟิศ');
      end if;
      v_reused := v_reused || jsonb_build_object('row', (v_e -> 'rows' ->> 0)::int, 'kind', 'shape', 'typed', v_e ->> 'name', 'id', v_s.id, 'name', v_s.name);
    else
      v_cshapes := v_cshapes || jsonb_build_object('id', v_shapeid, 'name', v_e ->> 'name');
    end if;
    v_smap := v_smap || jsonb_build_object(v_snorm, v_shapeid);
  end loop;

  -- รายการ (ชนิด+รูปทรง+ขนาด): หาตัวที่มี ไม่มี = สร้าง (ยังไม่มีราคา)
  for v_pr, v_o in select e.value, e.ordinality::int from jsonb_array_elements(v_merged) with ordinality as e(value, ordinality) order by e.ordinality loop
    v_first_row := (v_pr -> 'rows' ->> 0)::int;
    v_itemid := nullif(v_pr ->> 'item_id', '')::uuid;
    if v_itemid is null then
      v_typeid := coalesce(nullif(v_pr ->> 'type_id', '')::uuid, (v_tmap ->> (v_pr ->> 'type_norm'))::uuid);
      v_shapeid := coalesce(nullif(v_pr ->> 'shape_id', '')::uuid, (v_smap ->> (v_pr ->> 'shape_norm'))::uuid);
      v_a := (v_pr ->> 'size_a')::numeric; v_b := nullif(v_pr ->> 'size_b', '')::numeric;
      select * into v_s from analytics.gem_shape s where s.id = v_shapeid;
      if v_s.has_length is distinct from (v_b is not null) then
        perform analytics.gem_line_fail(v_first_row, 'size_b', case when v_s.has_length then 'size_b_required' else 'size_b_unexpected' end,
          case when v_s.has_length then 'รูปทรงนี้ต้องใส่ทั้งกว้างและยาว (มม.)' else 'รูปทรงนี้ใส่ขนาดค่าเดียว' end);
      end if;
      select * into v_i from analytics.gem_item g
       where g.shop_id = p_shop_id and g.gem_type_id = v_typeid and g.gem_shape_id = v_shapeid and g.size_a = v_a and coalesce(g.size_b, 0) = coalesce(v_b, 0);
      if found then
        v_itemid := v_i.id;
        if not v_i.is_active and not (v_itemid = any (v_allow)) then
          perform analytics.gem_line_fail(v_first_row, 'gem_item_id', 'gem_inactive', 'รายการพลอยนี้ปิดใช้งานแล้ว — แจ้งออฟฟิศให้เปิดใช้ หรือเลือกขนาดอื่น');
        end if;
      else
        v_itemid := null;
        insert into analytics.gem_item (shop_id, gem_type_id, gem_shape_id, size_a, size_b, created_by, created_by_worker_id)
        values (p_shop_id, v_typeid, v_shapeid, v_a, v_b, v_by, p_worker_id)
        on conflict do nothing
        returning id into v_itemid;
        if v_itemid is null then
          select g.id into v_itemid from analytics.gem_item g
           where g.shop_id = p_shop_id and g.gem_type_id = v_typeid and g.gem_shape_id = v_shapeid and g.size_a = v_a and coalesce(g.size_b, 0) = coalesce(v_b, 0);
        else
          v_citems := v_citems || jsonb_build_object('id', v_itemid, 'row', v_first_row);
        end if;
      end if;
    end if;
    v_out := v_out || jsonb_build_object('gem_item_id', v_itemid, 'label', (analytics.gem_item_json(v_itemid) ->> 'label'),
                                        'qty_per_piece', (v_pr ->> 'qty')::int, 'position', v_pr ->> 'position', 'rows', v_pr -> 'rows');
  end loop;

  return jsonb_build_object('lines', v_out,
    'summary', jsonb_build_object('created_types', v_ctypes, 'created_shapes', v_cshapes, 'created_items', v_citems, 'reused', v_reused, 'merged_rows', v_dups));
end;
$f$;

-- สถานะ "ระบุพลอยแล้วไหม" ของใบแม่ — นิยามเดียวของทั้งระบบ (job_gem_bom_get · job_worker_resolve · getJobDetail/ใบพิมพ์ใน TS อ่านจากที่นี่ ไม่คิดซ้ำ)
--   specified = มีแถวพลอย · unspecified = ไม่มีแถว แต่ในใบแม่+ส่วนย่อยมีขั้นฝัง (gem_set) ที่ยังไม่ปิด (pending/received) · not_needed = นอกนั้น (ไม่มีขั้นฝัง · ขั้นฝังส่งต่อ/ข้ามแล้ว)
--   ไม่ใช่ gate — หน้าจอแค่เตือน (มติเจ้าของ 22 ต.ค.) · กรองด้วย shop เสมอ (RPC ให้ service_role เรียก — ใบร้านอื่น = not_needed)
create or replace function analytics.job_gem_state(p_shop_id uuid, p_root_job_id uuid)
 returns text
 language sql
 stable
 security definer
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
  select case
    when exists (select 1 from analytics.job_gem_bom g where g.shop_id = p_shop_id and g.job_id = p_root_job_id) then 'specified'
    when exists (select 1 from analytics.job_stage gs join analytics.job gj on gj.id = gs.job_id
                  where gj.shop_id = p_shop_id and (gj.id = p_root_job_id or gj.parent_job_id = p_root_job_id)
                    and gs.stage_code = 'gem_set' and gs.status in ('pending', 'received')) then 'unspecified'
    else 'not_needed' end
$f$;

-- ============================================================================
-- 4.2 หน้าต่างแก้พลอยของใบ (ตาราง UX §5.3) — ผู้จัดการ (W3) ใช้เฉพาะ 'free_before_start' · ออฟฟิศ: closed = แก้ไม่ได้ · reason_required = ต้องมีเหตุผล
--   closed (ใบ done/cancelled) · reason_required (ขั้นฝัง gem_set ในต้นไม้ใบถูกรับแล้ว) · office_free (มีขั้นใดถูกรับแล้วแต่ยังไม่ถึงขั้นฝัง) · free_before_start (ยังไม่มีขั้นใดถูกรับ)
-- ============================================================================
create or replace function analytics.job_gem_edit_window(p_job_id uuid)
 returns text
 language plpgsql
 stable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_job  analytics.job%rowtype;
  v_root uuid;
  v_rs   text;
begin
  select * into v_job from analytics.job j where j.id = p_job_id;
  if not found then
    return null;
  end if;
  v_root := coalesce(v_job.parent_job_id, v_job.id);
  select j.status into v_rs from analytics.job j where j.id = v_root;
  if v_rs in ('done', 'cancelled') then
    return 'closed';
  end if;
  if exists (select 1 from analytics.job_stage s join analytics.job j on j.id = s.job_id
              where (j.id = v_root or j.parent_job_id = v_root) and s.stage_code = 'gem_set' and s.status in ('received', 'sent')) then
    return 'reason_required';
  end if;
  if exists (select 1 from analytics.job_stage s join analytics.job j on j.id = s.job_id
              where (j.id = v_root or j.parent_job_id = v_root) and s.status in ('received', 'sent')) then
    return 'office_free';
  end if;
  return 'free_before_start';
end;
$f$;

-- ============================================================================
-- 4.3 job_gem_bom_replace_core — แทนที่พลอยทั้งชุดของใบ (ผู้เรียกล็อก/ตรวจสิทธิ์/หน้าต่างแล้ว) · ใช้ร่วม: ตอนสร้างใบ · ออฟฟิศแก้ · (W3) ผู้จัดการแก้จากมือถือ — เรียกด้วย p_worker_id ไม่ต้อง replace ฟังก์ชันนี้ซ้ำ
--   diff: แถวที่มี item เดิม = แก้จำนวน/ตำแหน่ง/ลำดับ (ฉลาก snapshot เดิมอยู่) · item ใหม่ = เพิ่ม (ฉลาก ณ ตอนนี้) · item ที่หาย = ลบ · ไม่มีอะไรเปลี่ยน = ไม่เขียน event
--   event bom_change: payload มี phase · source · reason? · before/after (ฉลาก+จำนวน+ตำแหน่ง — ไม่มีราคา) · created (ชื่อใหม่ที่เข้าแคตตาล็อก)
-- ============================================================================
create or replace function analytics.job_gem_bom_replace_core(
  p_job_id uuid, p_lines jsonb, p_force boolean, p_actor uuid, p_worker_id uuid,
  p_reason text, p_source text, p_phase text, p_allow_item_ids uuid[] default '{}'::uuid[])
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job     analytics.job%rowtype;
  v_prep    jsonb;
  v_lines   jsonb;
  v_before  jsonb;
  v_after   jsonb;
  v_sig_b   text;
  v_sig_a   text;
  v_exist   uuid[];
  v_ln      jsonb;
  v_seq     int := 0;
  v_old     analytics.job_gem_bom%rowtype;
  v_changed boolean;
  v_summary jsonb;
  v_map     uuid[] := '{}'::uuid[];   -- แถวเดิมที่จับคู่กับแต่ละแถวใหม่ (ตำแหน่งเดียวกับ v_lines · null = แถวใหม่)
  v_mid     uuid;
  v_byid    uuid[];                   -- canonical ของแถวที่ผู้เรียกส่งมา "ด้วย gem_item_id" (ไม่ใช่พิมพ์ชื่อ) — ใช้จับคู่ข้ามการรวมชื่อ
begin
  if p_source is null or p_source not in ('product', 'manual', 'shopfloor') then
    raise exception 'job_gem_bom_replace_core: source ไม่ถูกต้อง' using errcode = '22023';
  end if;
  if p_actor is null and p_worker_id is null then
    raise exception 'job_gem_bom_replace_core: ต้องระบุผู้ทำรายการ' using errcode = '22023', hint = 'actor_required';
  end if;
  select * into v_job from analytics.job j where j.id = p_job_id for update;
  if not found then
    raise exception 'ไม่พบใบงาน' using errcode = '22023', hint = 'job_not_found';
  end if;
  if v_job.parent_job_id is not null then
    raise exception 'ส่วนย่อยไม่มีพลอยของตัวเอง — พลอยอยู่ที่ใบแม่' using errcode = '22023', hint = 'lot_no_gems';
  end if;
  if v_job.status in ('done', 'cancelled') then
    raise exception 'ใบงาน % ปิดหรือยกเลิกแล้ว — แก้พลอยไม่ได้', v_job.job_no using errcode = '22023', hint = 'job_closed';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('label', g.gem_label, 'qty_per_piece', g.qty_per_piece, 'position', g.position_note) order by g.line_seq), '[]'::jsonb),
         string_agg(g.gem_item_id::text || ':' || g.qty_per_piece || ':' || coalesce(g.position_note, '') || ':' || g.line_seq, '|' order by g.line_seq),
         array_agg(g.gem_item_id)
    into v_before, v_sig_b, v_exist
    from analytics.job_gem_bom g where g.job_id = p_job_id;

  v_prep := analytics.gem_lines_prepare(v_job.shop_id, p_lines, p_force, p_actor, p_worker_id, coalesce(p_allow_item_ids, '{}'::uuid[]) || coalesce(v_exist, '{}'::uuid[]));
  v_lines := v_prep -> 'lines';
  v_summary := v_prep -> 'summary';

  -- จับคู่แถวใหม่กับแถวเดิม: id ตรงกัน หรือ (เฉพาะแถวที่ผู้เรียกส่งมาด้วย gem_item_id) แถวเดิมชี้รายการที่ถูกรวมแล้วซึ่ง canonical = รายการของแถวใหม่
  -- (จอส่งกลับ id เดิมของ snapshot) → แถวเดิมอยู่ต่อ (ฉลาก snapshot เดิม) ไม่ลบ-แทรกใหม่ · แถวที่ "พิมพ์ชื่อ" = เจตนาใหม่ → ฉลากใหม่ตามชื่อปัจจุบัน (QA M3)
  select coalesce(array_agg(analytics.gem_item_canonical((e.value ->> 'gem_item_id')::uuid)), '{}'::uuid[]) into v_byid
    from jsonb_array_elements(p_lines) e where jsonb_typeof(e.value -> 'gem_item_id') = 'string';
  for v_ln in select value from jsonb_array_elements(v_lines) loop
    v_mid := null;
    select g.id into v_mid from analytics.job_gem_bom g
     where g.job_id = p_job_id and g.id <> all (array_remove(v_map, null))   -- 🔴 array_remove: v_map มี NULL (แถวใหม่ไม่มีคู่) — `not (id = any(v_map))` เจอ NULL = ไม่เลือกอะไรเลย → แถวเดิมที่ตามมาถูกลบ-แทรกใหม่ ฉลาก snapshot ถูกทับ (review B1)
       and (g.gem_item_id = (v_ln ->> 'gem_item_id')::uuid or analytics.gem_item_canonical(g.gem_item_id) = (v_ln ->> 'gem_item_id')::uuid)
       and (g.gem_item_id = (v_ln ->> 'gem_item_id')::uuid or (v_ln ->> 'gem_item_id')::uuid = any (v_byid))
     order by (g.gem_item_id = (v_ln ->> 'gem_item_id')::uuid) desc, g.line_seq
     limit 1;
    v_map := array_append(v_map, v_mid);
  end loop;
  delete from analytics.job_gem_bom g where g.job_id = p_job_id and g.id <> all (array_remove(v_map, null));
  for v_ln in select value from jsonb_array_elements(v_lines) loop
    v_seq := v_seq + 1;
    v_old := null;
    if v_map[v_seq] is not null then
      select * into v_old from analytics.job_gem_bom g where g.id = v_map[v_seq];
    end if;
    if v_old.id is not null then
      if (v_old.line_seq, v_old.qty_per_piece, v_old.position_note) is distinct from (v_seq, (v_ln ->> 'qty_per_piece')::int, v_ln ->> 'position') then
        update analytics.job_gem_bom
           set line_seq = v_seq, qty_per_piece = (v_ln ->> 'qty_per_piece')::int, position_note = v_ln ->> 'position', updated_at = now()
         where id = v_old.id;
      end if;
    else
      insert into analytics.job_gem_bom (shop_id, job_id, line_seq, gem_item_id, gem_label, qty_per_piece, position_note, source, created_by, created_by_worker_id)
      values (v_job.shop_id, p_job_id, v_seq, (v_ln ->> 'gem_item_id')::uuid, v_ln ->> 'label', (v_ln ->> 'qty_per_piece')::int, v_ln ->> 'position', p_source,
              case when p_worker_id is null then p_actor end, p_worker_id);
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('gem_item_id', g.gem_item_id, 'label', g.gem_label, 'qty_per_piece', g.qty_per_piece,
                                               'qty_total', g.qty_per_piece::bigint * v_job.qty_planned, 'position', g.position_note, 'source', g.source) order by g.line_seq), '[]'::jsonb),
         string_agg(g.gem_item_id::text || ':' || g.qty_per_piece || ':' || coalesce(g.position_note, '') || ':' || g.line_seq, '|' order by g.line_seq)
    into v_after, v_sig_a
    from analytics.job_gem_bom g where g.job_id = p_job_id;
  v_changed := coalesce(v_sig_b, '') is distinct from coalesce(v_sig_a, '');

  if v_changed then
    perform analytics.job_event_write(p_job_id, null, 'bom_change', analytics.job_today(), p_actor, p_worker_id,
      case when p_worker_id is null then 'job_page' else 'worker_qr' end, null,
      jsonb_build_object('phase', p_phase, 'source', p_source, 'before', v_before,
                         'after', (select coalesce(jsonb_agg(jsonb_build_object('label', a.value ->> 'label', 'qty_per_piece', a.value -> 'qty_per_piece', 'position', a.value -> 'position')), '[]'::jsonb) from jsonb_array_elements(v_after) a),
                         'created_types', (select coalesce(jsonb_agg(c.value ->> 'name'), '[]'::jsonb) from jsonb_array_elements(v_summary -> 'created_types') c),
                         'created_shapes', (select coalesce(jsonb_agg(c.value ->> 'name'), '[]'::jsonb) from jsonb_array_elements(v_summary -> 'created_shapes') c),
                         'created_items', jsonb_array_length(v_summary -> 'created_items'))
                         || case when p_reason is null then '{}'::jsonb else jsonb_build_object('reason', p_reason) end);
  end if;

  return jsonb_build_object('changed', v_changed, 'count', jsonb_array_length(v_after), 'lines', v_after, 'summary', v_summary);
end;
$f$;

-- ============================================================================
-- 5. RPC แคตตาล็อก (ออฟฟิศ owner/admin · security definer · service_role เท่านั้น)
--    🔴 ราคาพลอยอ่านได้ที่นี่เท่านั้น: gem_catalog_list · gem_price_set · gem_price_history — gem_options_list/BOM/resolve/print ไม่แตะตาราง gem_item_price
-- ============================================================================

-- รายการให้ฟอร์ม (dropdown) — ไม่มีราคา/ผู้ขาย/ผู้สร้าง · เฉพาะที่ใช้งานอยู่และไม่ถูกรวม · ใบที่ค้างอ้าง id ที่ถูกรวมแล้ว resolve ไปปลายทางตอนบันทึก (gem_lines_prepare)
create or replace function analytics.gem_options_list(p_shop_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
begin
  if p_shop_id is null then
    raise exception 'gem_options_list: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.gem_shape_ensure(p_shop_id);
  return jsonb_build_object(
    'types', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name), '[]'::jsonb)
                from analytics.gem_type t where t.shop_id = p_shop_id and t.is_active and t.merged_into is null),
    'shapes', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'has_length', s.has_length) order by s.name), '[]'::jsonb)
                 from analytics.gem_shape s where s.shop_id = p_shop_id and s.is_active and s.merged_into is null),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('gem_item_id', x.id, 'type_id', x.gem_type_id, 'shape_id', x.gem_shape_id,
                                                          'size_a', trim_scale(x.size_a), 'size_b', trim_scale(x.size_b), 'size_label', x.size_label) order by x.size_a, x.size_b nulls first), '[]'::jsonb)
                from (select i.* from analytics.gem_item i where i.shop_id = p_shop_id and analytics.gem_item_live(i.id) order by i.created_at desc limit 2000) x));
end;
$f$;

-- หน้า /oem/gems: ชนิด · รูปทรง · รายการ + ราคาปัจจุบัน (ณ วันนี้ไทย) + จำนวนที่ใช้ — owner/admin เท่านั้น (ตรวจ actor ที่ DB)
create or replace function analytics.gem_catalog_list(p_shop_id uuid, p_actor uuid, p_include_inactive boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_today date := analytics.job_today();
  v_all   boolean := coalesce(p_include_inactive, false);
begin
  if p_shop_id is null then
    raise exception 'gem_catalog_list: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.gem_require_office(p_shop_id, p_actor);
  perform analytics.gem_shape_ensure(p_shop_id);
  return jsonb_build_object(
    'types', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'is_active', t.is_active, 'merged_into', t.merged_into,
                'merged_into_name', (select m.name from analytics.gem_type m where m.id = t.merged_into),
                'via', case when t.created_by_worker_id is not null then 'shopfloor' else 'office' end, 'created_at', t.created_at,
                'item_count', (select count(*) from analytics.gem_item i where i.gem_type_id = t.id and i.merged_into is null),
                'used_jobs_open', (select count(distinct g.job_id) from analytics.job_gem_bom g join analytics.job j on j.id = g.job_id join analytics.gem_item i on i.id = g.gem_item_id
                                    where i.gem_type_id = t.id and j.status not in ('done', 'cancelled')),
                'used_templates', (select count(distinct b.product_id) from analytics.product_gem_bom b join analytics.gem_item i on i.id = b.gem_item_id where i.gem_type_id = t.id))
                order by t.name), '[]'::jsonb)
                from analytics.gem_type t where t.shop_id = p_shop_id and (v_all or (t.is_active and t.merged_into is null))),
    'shapes', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'has_length', s.has_length, 'is_active', s.is_active, 'is_seed', s.is_seed, 'merged_into', s.merged_into,
                'merged_into_name', (select m.name from analytics.gem_shape m where m.id = s.merged_into),
                'via', case when s.created_by_worker_id is not null then 'shopfloor' when s.is_seed then 'seed' else 'office' end, 'created_at', s.created_at,
                'item_count', (select count(*) from analytics.gem_item i where i.gem_shape_id = s.id and i.merged_into is null),
                'used_jobs_open', (select count(distinct g.job_id) from analytics.job_gem_bom g join analytics.job j on j.id = g.job_id join analytics.gem_item i on i.id = g.gem_item_id
                                    where i.gem_shape_id = s.id and j.status not in ('done', 'cancelled')),
                'used_templates', (select count(distinct b.product_id) from analytics.product_gem_bom b join analytics.gem_item i on i.id = b.gem_item_id where i.gem_shape_id = s.id))
                order by s.name), '[]'::jsonb)
                from analytics.gem_shape s where s.shop_id = p_shop_id and (v_all or (s.is_active and s.merged_into is null))),
    'items', (select coalesce(jsonb_agg(x.j order by x.tn, x.sn, x.size_a, x.size_b nulls first), '[]'::jsonb) from (
                select t.name as tn, s.name as sn, i.size_a, i.size_b,
                       analytics.gem_item_json(i.id) || jsonb_build_object(
                         'merged_into', i.merged_into, 'type_merged', t.merged_into is not null,
                         'via', case when i.created_by_worker_id is not null then 'shopfloor' else 'office' end, 'created_at', i.created_at,
                         'price', pr.price_thb_per_unit, 'price_effective_from', pr.effective_from, 'price_supplier', pr.supplier, 'has_price', pr.price_thb_per_unit is not null,
                         'price_rows', (select count(*) from analytics.gem_item_price p2 where p2.gem_item_id = i.id),
                         'used_jobs_open', (select count(distinct g.job_id) from analytics.job_gem_bom g join analytics.job j on j.id = g.job_id where g.gem_item_id = i.id and j.status not in ('done', 'cancelled')),
                         'used_jobs_total', (select count(distinct g.job_id) from analytics.job_gem_bom g where g.gem_item_id = i.id),
                         'used_templates', (select count(distinct b.product_id) from analytics.product_gem_bom b where b.gem_item_id = i.id)) as j
                  from analytics.gem_item i
                  join analytics.gem_type t on t.id = i.gem_type_id and t.shop_id = i.shop_id
                  join analytics.gem_shape s on s.id = i.gem_shape_id and s.shop_id = i.shop_id
                  left join lateral (select p.price_thb_per_unit, p.effective_from, p.supplier from analytics.gem_item_price p
                                      where p.gem_item_id = i.id and p.effective_from <= v_today order by p.effective_from desc limit 1) pr on true
                 where i.shop_id = p_shop_id and (v_all or (i.is_active and i.merged_into is null))
                 order by t.name, s.name, i.size_a, i.size_b nulls first limit 3000) x));
end;
$f$;

-- สร้างชนิด/รูปทรงตรงๆ (หน้าแคตตาล็อก) — norm ซ้ำ = ปฏิเสธเสมอ (name_exists · force ไม่ช่วย) · คล้าย = gem_similar (ข้ามได้ด้วย p_force)
create or replace function analytics.gem_catalog_create(p_shop_id uuid, p_actor uuid, p_kind text, p_name text, p_has_length boolean default null, p_force boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_name  text;
  v_norm  text;
  v_dup   record;
  v_hits  jsonb;
  v_id    uuid;
begin
  if p_shop_id is null then
    raise exception 'gem_catalog_create: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.gem_require_office(p_shop_id, p_actor);
  if p_kind is null or p_kind not in ('type', 'shape') then
    raise exception 'ชนิดข้อมูลต้องเป็น type หรือ shape' using errcode = '22023', hint = 'kind_invalid';
  end if;
  if p_kind = 'shape' and p_has_length is null then
    raise exception 'รูปทรงต้องระบุจำนวนค่าขนาด (1 หรือ 2 ค่า)' using errcode = '22023', hint = 'shape_new_invalid';
  end if;
  perform analytics.gem_shape_ensure(p_shop_id);
  v_name := analytics.gem_name_clean(p_name, case p_kind when 'type' then 'ชื่อชนิดพลอย' else 'ชื่อรูปทรง' end);
  v_norm := analytics.gem_name_norm(v_name);
  if p_kind = 'type' then
    select t.id, t.name into v_dup from analytics.gem_type t where t.shop_id = p_shop_id and t.name_norm = v_norm;
  else
    select s.id, s.name into v_dup from analytics.gem_shape s where s.shop_id = p_shop_id and s.name_norm = v_norm;
  end if;
  if v_dup.id is not null then
    raise exception 'มีชื่อ "%" อยู่แล้ว — ใช้ตัวที่มี', v_dup.name using errcode = '22023', hint = 'name_exists',
      detail = jsonb_build_object('id', v_dup.id, 'name', v_dup.name)::text;
  end if;
  v_hits := analytics.gem_similar_hits(p_shop_id, p_kind, v_name);
  if jsonb_array_length(v_hits) > 0 and not coalesce(p_force, false) then
    raise exception 'พบชื่อที่คล้ายกับที่มีอยู่แล้ว — ใช้ตัวที่มี หรือยืนยันเพิ่มเป็นชื่อใหม่' using errcode = '22023', hint = 'gem_similar',
      detail = jsonb_build_object('similar', jsonb_build_array(jsonb_build_object('kind', p_kind, 'name', v_name, 'rows', '[]'::jsonb, 'matches', v_hits)))::text;
  end if;
  if p_kind = 'type' then
    insert into analytics.gem_type (shop_id, name, created_by) values (p_shop_id, v_name, p_actor) returning id into v_id;
  else
    insert into analytics.gem_shape (shop_id, name, has_length, created_by) values (p_shop_id, v_name, p_has_length, p_actor) returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id, 'name', v_name, 'kind', p_kind, 'created', true);
end;
$f$;

-- สร้างรายการ (ชนิด+รูปทรง+ขนาด) โดยยังไม่ผูกใบ/ราคา — แถวรูปแบบเดียวกับ BOM (ไม่ต้องมี qty_per_piece) · มีอยู่แล้ว = คืนตัวเดิม created=false
create or replace function analytics.gem_item_create(p_shop_id uuid, p_actor uuid, p_line jsonb, p_force boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_prep jsonb;
  v_item uuid;
begin
  if p_shop_id is null then
    raise exception 'gem_item_create: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.gem_require_office(p_shop_id, p_actor);
  if p_line is null or jsonb_typeof(p_line) <> 'object' then
    raise exception 'แถวรายการพลอยไม่ถูกต้อง' using errcode = '22023', hint = 'line_invalid';
  end if;
  v_prep := analytics.gem_lines_prepare(p_shop_id, jsonb_build_array(p_line || jsonb_build_object('qty_per_piece', 1)), p_force, p_actor, null);
  v_item := (v_prep -> 'lines' -> 0 ->> 'gem_item_id')::uuid;
  return jsonb_build_object('item', analytics.gem_item_json(v_item), 'created', jsonb_array_length(v_prep -> 'summary' -> 'created_items') > 0, 'summary', v_prep -> 'summary');
end;
$f$;

-- เปลี่ยนชื่อชนิด/รูปทรง — norm ชนกับแถวอื่น = ปฏิเสธเสมอ (ให้ใช้ "รวมชื่อ") · คล้ายแถวอื่น = gem_similar (ข้ามด้วย p_force) · ใบที่เปิดแล้วไม่เปลี่ยน (gem_label snapshot)
create or replace function analytics.gem_catalog_rename(p_shop_id uuid, p_actor uuid, p_kind text, p_id uuid, p_new_name text, p_force boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_name text;
  v_norm text;
  v_old  text;
  v_merged uuid;
  v_dup  record;
  v_hits jsonb;
begin
  if p_shop_id is null or p_id is null then
    raise exception 'gem_catalog_rename: p_shop_id และ p_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.gem_require_office(p_shop_id, p_actor);
  if p_kind is null or p_kind not in ('type', 'shape') then
    raise exception 'ชนิดข้อมูลต้องเป็น type หรือ shape' using errcode = '22023', hint = 'kind_invalid';
  end if;
  if p_kind = 'type' then
    select t.name, t.merged_into into v_old, v_merged from analytics.gem_type t where t.id = p_id and t.shop_id = p_shop_id for update;
  else
    select s.name, s.merged_into into v_old, v_merged from analytics.gem_shape s where s.id = p_id and s.shop_id = p_shop_id for update;
  end if;
  if v_old is null then
    raise exception 'ไม่พบรายการนี้ในร้านนี้' using errcode = '22023', hint = 'gem_not_found';
  end if;
  if v_merged is not null then
    raise exception 'รายการนี้ถูกรวมแล้ว เปลี่ยนชื่อไม่ได้' using errcode = '22023', hint = 'gem_merged_locked';
  end if;
  v_name := analytics.gem_name_clean(p_new_name, case p_kind when 'type' then 'ชื่อชนิดพลอย' else 'ชื่อรูปทรง' end);
  v_norm := analytics.gem_name_norm(v_name);
  if p_kind = 'type' then
    select t.id, t.name into v_dup from analytics.gem_type t where t.shop_id = p_shop_id and t.name_norm = v_norm and t.id <> p_id;
  else
    select s.id, s.name into v_dup from analytics.gem_shape s where s.shop_id = p_shop_id and s.name_norm = v_norm and s.id <> p_id;
  end if;
  if v_dup.id is not null then
    raise exception 'มีชื่อ "%" อยู่แล้ว — ใช้ "รวมชื่อ" แทนการเปลี่ยนชื่อให้ซ้ำ', v_dup.name using errcode = '22023', hint = 'name_exists',
      detail = jsonb_build_object('id', v_dup.id, 'name', v_dup.name)::text;
  end if;
  v_hits := analytics.gem_similar_hits(p_shop_id, p_kind, v_name, p_id);
  if jsonb_array_length(v_hits) > 0 and not coalesce(p_force, false) then
    raise exception 'พบชื่อที่คล้ายกับที่มีอยู่แล้ว — ตรวจก่อน หรือยืนยันเปลี่ยนชื่อ' using errcode = '22023', hint = 'gem_similar',
      detail = jsonb_build_object('similar', jsonb_build_array(jsonb_build_object('kind', p_kind, 'name', v_name, 'rows', '[]'::jsonb, 'matches', v_hits)))::text;
  end if;
  if p_kind = 'type' then
    update analytics.gem_type set name = v_name, updated_at = now() where id = p_id;
  else
    update analytics.gem_shape set name = v_name, updated_at = now() where id = p_id;
  end if;
  insert into analytics.gem_catalog_event (shop_id, event_type, subject_kind, subject_id, actor, payload)
  values (p_shop_id, 'rename', p_kind, p_id, p_actor, jsonb_build_object('from', v_old, 'to', v_name));
  return jsonb_build_object('id', p_id, 'kind', p_kind, 'name', v_name, 'was', v_old);
end;
$f$;

-- แก้จำนวนค่าขนาดของรูปทรง — ได้เฉพาะรูปทรงที่ยังไม่มีรายการใช้ (trigger gem_shape_guard เป็นกำแพงสุดท้าย)
create or replace function analytics.gem_shape_set_has_length(p_shop_id uuid, p_actor uuid, p_id uuid, p_has_length boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_s analytics.gem_shape%rowtype;
begin
  if p_shop_id is null or p_id is null or p_has_length is null then
    raise exception 'gem_shape_set_has_length: p_shop_id · p_id · p_has_length จำเป็น' using errcode = '22023';
  end if;
  perform analytics.gem_require_office(p_shop_id, p_actor);
  select * into v_s from analytics.gem_shape s where s.id = p_id and s.shop_id = p_shop_id for update;
  if not found then
    raise exception 'ไม่พบรูปทรงนี้ในร้านนี้' using errcode = '22023', hint = 'gem_not_found';
  end if;
  if v_s.has_length is distinct from p_has_length then
    update analytics.gem_shape set has_length = p_has_length, updated_at = now() where id = p_id;   -- มีรายการใช้ = trigger ปฏิเสธ has_length_locked
    insert into analytics.gem_catalog_event (shop_id, event_type, subject_kind, subject_id, actor, payload)
    values (p_shop_id, 'has_length_set', 'shape', p_id, p_actor, jsonb_build_object('from', v_s.has_length, 'to', p_has_length));
  end if;
  return jsonb_build_object('id', p_id, 'has_length', p_has_length);
end;
$f$;

-- ตรวจเงื่อนไขการรวมชื่อ A→B (ใช้ร่วม preview/merge) · p_lock = ล็อกแถวทั้งสอง for update (เรียงตาม id กัน deadlock)
create or replace function analytics.gem_merge_check(p_shop_id uuid, p_kind text, p_from uuid, p_into uuid, p_lock boolean)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_f record;
  v_t record;
begin
  if p_kind is null or p_kind not in ('type', 'shape') then
    raise exception 'ชนิดข้อมูลต้องเป็น type หรือ shape' using errcode = '22023', hint = 'kind_invalid';
  end if;
  if p_from is null or p_into is null then
    raise exception 'ต้องระบุทั้งชื่อที่จะเลิกใช้ (A) และชื่อปลายทาง (B)' using errcode = '22023', hint = 'gem_merge_invalid';
  end if;
  if p_from = p_into then
    raise exception 'รวมชื่อเข้ากับตัวเองไม่ได้' using errcode = '22023', hint = 'gem_merge_self';
  end if;
  if p_lock then
    if p_kind = 'type' then
      perform 1 from analytics.gem_type t where t.id in (p_from, p_into) and t.shop_id = p_shop_id order by t.id for update;
    else
      perform 1 from analytics.gem_shape s where s.id in (p_from, p_into) and s.shop_id = p_shop_id order by s.id for update;
    end if;
  end if;
  if p_kind = 'type' then
    select t.id, t.name, t.merged_into, t.is_active, null::boolean as has_length into v_f from analytics.gem_type t where t.id = p_from and t.shop_id = p_shop_id;
    select t.id, t.name, t.merged_into, t.is_active, null::boolean as has_length into v_t from analytics.gem_type t where t.id = p_into and t.shop_id = p_shop_id;
  else
    select s.id, s.name, s.merged_into, s.is_active, s.has_length into v_f from analytics.gem_shape s where s.id = p_from and s.shop_id = p_shop_id;
    select s.id, s.name, s.merged_into, s.is_active, s.has_length into v_t from analytics.gem_shape s where s.id = p_into and s.shop_id = p_shop_id;
  end if;
  if v_f.id is null or v_t.id is null then
    raise exception 'ไม่พบรายการที่จะรวมในร้านนี้' using errcode = '22023', hint = 'gem_not_found';
  end if;
  if v_f.merged_into is not null then
    raise exception 'ชื่อ "%" ถูกรวมไปแล้ว — รวมซ้ำไม่ได้', v_f.name using errcode = '22023', hint = 'gem_merge_from_merged';
  end if;
  if v_t.merged_into is not null then
    raise exception 'ชื่อปลายทาง "%" ถูกรวมไปที่อื่นแล้ว — เลือกตัวจริง', v_t.name using errcode = '22023', hint = 'gem_merge_into_merged';
  end if;
  if not v_t.is_active then
    raise exception 'ชื่อปลายทาง "%" ปิดใช้งานอยู่ — เปิดใช้ก่อนรวม', v_t.name using errcode = '22023', hint = 'gem_merge_into_inactive';
  end if;
  if p_kind = 'shape' and v_f.has_length is distinct from v_t.has_length then
    raise exception 'รวมรูปทรงที่ใส่ขนาดจำนวนค่าต่างกันไม่ได้ (1 ค่า กับ 2 ค่า)' using errcode = '22023', hint = 'has_length_mismatch';
  end if;
  return jsonb_build_object('from', jsonb_build_object('id', v_f.id, 'name', v_f.name), 'into', jsonb_build_object('id', v_t.id, 'name', v_t.name));
end;
$f$;

-- ผลกระทบของการรวม A→B (อ่านอย่างเดียว) — ตัวเลขที่จอแสดงในกล่อง "ผลที่จะเกิด" · ราคาของรายการ A ที่ขนาดชนกับ B "ไม่ถูกย้าย" (นับให้ดู)
create or replace function analytics.gem_merge_plan(p_shop_id uuid, p_kind text, p_from uuid, p_into uuid)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_pairs jsonb;
  v_moved int; v_collapsed int; v_prices int; v_gap int;
  v_tpl_move int; v_tpl_sum int; v_tpl_over int; v_tpl_products jsonb;
  v_jobs_open int; v_jobs_total int; v_items_all uuid[];
begin
  if p_kind = 'type' then
    select coalesce(jsonb_agg(jsonb_build_object('a', a.id, 'b', b.id)), '[]'::jsonb) into v_pairs
      from analytics.gem_item a
      left join analytics.gem_item b on b.merged_into is null and b.shop_id = a.shop_id and b.gem_type_id = p_into and b.gem_shape_id = a.gem_shape_id and b.size_a = a.size_a and coalesce(b.size_b, 0) = coalesce(a.size_b, 0)
     where a.shop_id = p_shop_id and a.gem_type_id = p_from and a.merged_into is null;
    select array_agg(i.id) into v_items_all from analytics.gem_item i where i.shop_id = p_shop_id and i.gem_type_id = p_from;
  else
    select coalesce(jsonb_agg(jsonb_build_object('a', a.id, 'b', b.id)), '[]'::jsonb) into v_pairs
      from analytics.gem_item a
      left join analytics.gem_item b on b.merged_into is null and b.shop_id = a.shop_id and b.gem_shape_id = p_into and b.gem_type_id = a.gem_type_id and b.size_a = a.size_a and coalesce(b.size_b, 0) = coalesce(a.size_b, 0)
     where a.shop_id = p_shop_id and a.gem_shape_id = p_from and a.merged_into is null;
    select array_agg(i.id) into v_items_all from analytics.gem_item i where i.shop_id = p_shop_id and i.gem_shape_id = p_from;
  end if;
  select count(*) filter (where (e.value ->> 'b') is null), count(*) filter (where (e.value ->> 'b') is not null)
    into v_moved, v_collapsed from jsonb_array_elements(v_pairs) e;
  select count(*) into v_prices from analytics.gem_item_price pr
   where pr.gem_item_id in (select (e.value ->> 'a')::uuid from jsonb_array_elements(v_pairs) e where (e.value ->> 'b') is not null);
  select count(*) into v_gap from jsonb_array_elements(v_pairs) e
   where (e.value ->> 'b') is not null
     and exists (select 1 from analytics.gem_item_price pa where pa.gem_item_id = (e.value ->> 'a')::uuid)
     and not exists (select 1 from analytics.gem_item_price pb where pb.gem_item_id = (e.value ->> 'b')::uuid);
  select count(*) filter (where lb.id is null), count(*) filter (where lb.id is not null), count(*) filter (where lb.id is not null and l.qty_per_piece + lb.qty_per_piece > 1000),
         coalesce(jsonb_agg(distinct l.product_id) filter (where l.product_id is not null), '[]'::jsonb)
    into v_tpl_move, v_tpl_sum, v_tpl_over, v_tpl_products
    from jsonb_array_elements(v_pairs) e
    join analytics.product_gem_bom l on l.gem_item_id = (e.value ->> 'a')::uuid
    left join analytics.product_gem_bom lb on lb.product_id = l.product_id and lb.gem_item_id = (e.value ->> 'b')::uuid
   where (e.value ->> 'b') is not null;
  select count(distinct g.job_id) filter (where j.status not in ('done', 'cancelled')), count(distinct g.job_id)
    into v_jobs_open, v_jobs_total
    from analytics.job_gem_bom g join analytics.job j on j.id = g.job_id where g.gem_item_id = any (coalesce(v_items_all, '{}'::uuid[]));
  return jsonb_build_object('items_moved', v_moved, 'items_collapsed', v_collapsed, 'prices_not_moved', v_prices, 'collapsed_missing_price_on_target', v_gap,
    'template_lines_repointed', v_tpl_move, 'template_lines_summed', v_tpl_sum, 'template_qty_overflow', v_tpl_over, 'template_products', v_tpl_products,
    'jobs_open_using', coalesce(v_jobs_open, 0), 'jobs_using_total', coalesce(v_jobs_total, 0), 'snapshots_unchanged', true);
end;
$f$;

create or replace function analytics.gem_merge_preview(p_shop_id uuid, p_actor uuid, p_kind text, p_from uuid, p_into uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_chk jsonb;
begin
  if p_shop_id is null then
    raise exception 'gem_merge_preview: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.gem_require_office(p_shop_id, p_actor);
  v_chk := analytics.gem_merge_check(p_shop_id, p_kind, p_from, p_into, false);
  return v_chk || analytics.gem_merge_plan(p_shop_id, p_kind, p_from, p_into);
end;
$f$;

-- รวมชื่อ A→B (ย้อนกลับไม่ได้): รายการของ A ย้ายไปอยู่ใต้ B (ขนาดชนกัน = รวมเป็นรายการของ B · ราคา A ไม่ย้าย) · แม่แบบ SKU ตามไปที่รายการปลายทาง · A ถูกปิดและชี้ merged_into=B ·
--   🔴 ไม่แตะ job_gem_bom (snapshot ใบ done/ค้างอยู่ต้องไม่ขยับ) · บันทึกใครรวมเมื่อไร (gem_catalog_event)
create or replace function analytics.gem_merge(p_shop_id uuid, p_actor uuid, p_kind text, p_from uuid, p_into uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_chk   jsonb;
  v_plan  jsonb;
  r       record;
  l       record;
  v_lb    analytics.product_gem_bom%rowtype;
  v_h     text;
begin
  if p_shop_id is null then
    raise exception 'gem_merge: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.gem_require_office(p_shop_id, p_actor);
  perform pg_advisory_xact_lock(hashtextextended('gem_merge:' || p_shop_id::text, 0));
  v_chk := analytics.gem_merge_check(p_shop_id, p_kind, p_from, p_into, true);
  v_plan := analytics.gem_merge_plan(p_shop_id, p_kind, p_from, p_into);
  if (v_plan ->> 'template_qty_overflow')::int > 0 then
    raise exception 'รวมแล้วแม่แบบ SKU บางตัวมีจำนวนต่อชิ้นเกิน 1,000 — แก้แม่แบบเหล่านั้นก่อนรวม' using errcode = '22023', hint = 'merge_qty_overflow',
      detail = jsonb_build_object('template_products', v_plan -> 'template_products')::text;
  end if;
  perform set_config('analytics.gem_merge', 'on', true);

  for r in
    select a.id as a_id, a.is_active as a_active, b.id as b_id, b.is_active as b_active
      from analytics.gem_item a
      left join analytics.gem_item b on b.merged_into is null and b.shop_id = a.shop_id and b.size_a = a.size_a and coalesce(b.size_b, 0) = coalesce(a.size_b, 0)
        and ((p_kind = 'type' and b.gem_type_id = p_into and b.gem_shape_id = a.gem_shape_id) or (p_kind = 'shape' and b.gem_shape_id = p_into and b.gem_type_id = a.gem_type_id))
     where a.shop_id = p_shop_id and a.merged_into is null
       and ((p_kind = 'type' and a.gem_type_id = p_from) or (p_kind = 'shape' and a.gem_shape_id = p_from))
     order by a.id
  loop
    if r.b_id is null then
      -- ไม่ชน: รายการย้ายไปอยู่ใต้ปลายทาง (ราคาตามรายการไป)
      -- trigger ตรวจเฉพาะฝั่งที่เปลี่ยน (ฝั่งที่ปิดใช้อยู่แล้วยอม) — ถ้ายังติดเงื่อนไขอื่น บอกรายการ+สาเหตุ ไม่ใช่ gem_ref_inactive ลอยๆ (security L5)
      begin
        if p_kind = 'type' then
          update analytics.gem_item set gem_type_id = p_into, updated_at = now() where id = r.a_id;
        else
          update analytics.gem_item set gem_shape_id = p_into, updated_at = now() where id = r.a_id;
        end if;
      exception when sqlstate '22023' then
        get stacked diagnostics v_h = pg_exception_hint;
        raise exception 'รวมชื่อไม่ได้ — รายการ "%" ติดเงื่อนไข (%): ตรวจรายการนี้ก่อนรวม',
          (select i.size_label from analytics.gem_item i where i.id = r.a_id), coalesce(v_h, 'ไม่ทราบสาเหตุ') using errcode = '22023', hint = 'gem_merge_blocked',
          detail = jsonb_build_object('item', r.a_id, 'cause', coalesce(v_h, ''))::text;
      end;
    else
      -- ชนกัน: แม่แบบ SKU ที่ใช้รายการ A ย้ายไป B (SKU ที่มีทั้งสองแถว = บวกจำนวน) แล้ว A ชี้ merged_into=B (ราคาของ A อยู่กับ A ไม่ย้าย)
      for l in select * from analytics.product_gem_bom p where p.gem_item_id = r.a_id order by p.id loop
        select * into v_lb from analytics.product_gem_bom p where p.product_id = l.product_id and p.gem_item_id = r.b_id;
        if found then
          update analytics.product_gem_bom
             set qty_per_piece = v_lb.qty_per_piece + l.qty_per_piece,
                 position_note = case when l.position_note is null or l.position_note = any (string_to_array(coalesce(v_lb.position_note, ''), ', ')) then v_lb.position_note
                                      when v_lb.position_note is null then l.position_note
                                      when char_length(v_lb.position_note || ', ' || l.position_note) <= 40 then v_lb.position_note || ', ' || l.position_note
                                      else v_lb.position_note end,
                 updated_at = now()
           where id = v_lb.id;
          delete from analytics.product_gem_bom where id = l.id;
        else
          update analytics.product_gem_bom set gem_item_id = r.b_id, updated_at = now() where id = l.id;
        end if;
      end loop;
      update analytics.gem_item set merged_into = r.b_id, is_active = false, updated_at = now() where id = r.a_id;
      update analytics.gem_item set merged_into = r.b_id, updated_at = now() where merged_into = r.a_id;          -- ยุบห่วงโซ่ให้เหลือชั้นเดียว
      if r.a_active and not r.b_active then
        update analytics.gem_item set is_active = true, updated_at = now() where id = r.b_id;                    -- ปลายทางต้องใช้งานได้ ไม่งั้นแม่แบบ/ใบใหม่ล้ม
      end if;
    end if;
  end loop;

  if p_kind = 'type' then
    update analytics.gem_type set merged_into = p_into, is_active = false, updated_at = now() where id = p_from;
    update analytics.gem_type set merged_into = p_into, updated_at = now() where merged_into = p_from;
  else
    update analytics.gem_shape set merged_into = p_into, is_active = false, updated_at = now() where id = p_from;
    update analytics.gem_shape set merged_into = p_into, updated_at = now() where merged_into = p_from;
  end if;
  perform set_config('analytics.gem_merge', 'off', true);

  insert into analytics.gem_catalog_event (shop_id, event_type, subject_kind, subject_id, actor, payload)
  values (p_shop_id, 'merge', p_kind, p_from, p_actor, jsonb_build_object('into', p_into, 'from_name', v_chk -> 'from' ->> 'name', 'into_name', v_chk -> 'into' ->> 'name') || (v_plan - 'template_products'));
  return v_chk || v_plan;
end;
$f$;

-- ปิด/เปิดใช้งาน (ปิด = ซ่อนจาก dropdown หน้างาน · ใบ/แม่แบบเก่ายังอ่านได้) — ตัวที่ถูกรวมแล้วเปิดไม่ได้
create or replace function analytics.gem_catalog_set_active(p_shop_id uuid, p_actor uuid, p_kind text, p_id uuid, p_active boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_merged uuid;
  v_cur    boolean;
  v_found  boolean := false;
begin
  if p_shop_id is null or p_id is null or p_active is null then
    raise exception 'gem_catalog_set_active: p_shop_id · p_id · p_active จำเป็น' using errcode = '22023';
  end if;
  perform analytics.gem_require_office(p_shop_id, p_actor);
  if p_kind is null or p_kind not in ('type', 'shape', 'item') then
    raise exception 'ชนิดข้อมูลต้องเป็น type · shape · item' using errcode = '22023', hint = 'kind_invalid';
  end if;
  if p_kind = 'type' then
    select t.merged_into, t.is_active into v_merged, v_cur from analytics.gem_type t where t.id = p_id and t.shop_id = p_shop_id for update;
  elsif p_kind = 'shape' then
    select s.merged_into, s.is_active into v_merged, v_cur from analytics.gem_shape s where s.id = p_id and s.shop_id = p_shop_id for update;
  else
    select i.merged_into, i.is_active into v_merged, v_cur from analytics.gem_item i where i.id = p_id and i.shop_id = p_shop_id for update;
  end if;
  v_found := found;   -- ไม่ใช้ "select ..., true into" (ไม่พบแถว = ค่าเป็น NULL ไม่ใช่ false — ด่านจะตาบอด: ข้อ 13)
  if not v_found then
    raise exception 'ไม่พบรายการนี้ในร้านนี้' using errcode = '22023', hint = 'gem_not_found';
  end if;
  if v_merged is not null then
    raise exception 'รายการนี้ถูกรวมแล้ว เปิด/ปิดใช้งานไม่ได้' using errcode = '22023', hint = 'gem_merged_locked';
  end if;
  if v_cur is distinct from p_active then
    if p_kind = 'type' then
      update analytics.gem_type set is_active = p_active, updated_at = now() where id = p_id;
    elsif p_kind = 'shape' then
      update analytics.gem_shape set is_active = p_active, updated_at = now() where id = p_id;
    else
      update analytics.gem_item set is_active = p_active, updated_at = now() where id = p_id;
    end if;
    insert into analytics.gem_catalog_event (shop_id, event_type, subject_kind, subject_id, actor, payload)
    values (p_shop_id, 'active_set', p_kind, p_id, p_actor, jsonb_build_object('from', v_cur, 'to', p_active));
  end if;
  return jsonb_build_object('id', p_id, 'kind', p_kind, 'is_active', p_active);
end;
$f$;

-- ลบได้เฉพาะที่ไม่ถูกใช้เลย (ใบงาน/แม่แบบ/รายการลูก/ตัวที่ถูกรวมมาชี้) — ถูกใช้ = gem_in_use (ให้ปิดใช้งานแทน) · ราคาของรายการที่ลบถูกลบตามไป (ไม่เคยถูกใช้)
create or replace function analytics.gem_catalog_remove(p_shop_id uuid, p_actor uuid, p_kind text, p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_found  boolean := false;
  v_name   text;
  v_items  int := 0;
  v_tpl    int := 0;
  v_jobs   int := 0;
  v_merged int := 0;
  v_prices int := 0;
begin
  if p_shop_id is null or p_id is null then
    raise exception 'gem_catalog_remove: p_shop_id และ p_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.gem_require_office(p_shop_id, p_actor);
  if p_kind is null or p_kind not in ('type', 'shape', 'item') then
    raise exception 'ชนิดข้อมูลต้องเป็น type · shape · item' using errcode = '22023', hint = 'kind_invalid';
  end if;
  if p_kind = 'type' then
    select t.name into v_name from analytics.gem_type t where t.id = p_id and t.shop_id = p_shop_id for update;
    v_found := found;
    select count(*) into v_items from analytics.gem_item i where i.gem_type_id = p_id;
    select count(*) into v_merged from analytics.gem_type t where t.merged_into = p_id;
  elsif p_kind = 'shape' then
    select s.name into v_name from analytics.gem_shape s where s.id = p_id and s.shop_id = p_shop_id for update;
    v_found := found;
    select count(*) into v_items from analytics.gem_item i where i.gem_shape_id = p_id;
    select count(*) into v_merged from analytics.gem_shape s where s.merged_into = p_id;
  else
    select i.size_label into v_name from analytics.gem_item i where i.id = p_id and i.shop_id = p_shop_id for update;
    v_found := found;
    select count(*) into v_tpl from analytics.product_gem_bom b where b.gem_item_id = p_id;
    select count(distinct g.job_id) into v_jobs from analytics.job_gem_bom g where g.gem_item_id = p_id;
    select count(*) into v_merged from analytics.gem_item i where i.merged_into = p_id;
    select count(*) into v_prices from analytics.gem_item_price pr where pr.gem_item_id = p_id;
  end if;
  if not v_found then
    raise exception 'ไม่พบรายการนี้ในร้านนี้' using errcode = '22023', hint = 'gem_not_found';
  end if;
  if v_items + v_tpl + v_jobs + v_merged > 0 then
    raise exception 'ลบไม่ได้ — ถูกใช้อยู่ (ปิดใช้งานแทนได้)' using errcode = '22023', hint = 'gem_in_use',
      detail = jsonb_build_object('items', v_items, 'templates', v_tpl, 'jobs', v_jobs, 'merged_refs', v_merged)::text;
  end if;
  if p_kind = 'type' then
    delete from analytics.gem_type where id = p_id;
  elsif p_kind = 'shape' then
    delete from analytics.gem_shape where id = p_id;
  else
    delete from analytics.gem_item where id = p_id;
  end if;
  insert into analytics.gem_catalog_event (shop_id, event_type, subject_kind, subject_id, actor, payload)
  values (p_shop_id, 'remove', p_kind, p_id, p_actor, jsonb_build_object('name', v_name, 'prices_deleted', v_prices));
  return jsonb_build_object('id', p_id, 'kind', p_kind, 'removed', true);
end;
$f$;

-- ตั้งราคาพลอย (ต่อเม็ด · THB · ทศนิยม ≤ 4 · มีวันที่มีผล) — วันเดียวกันตั้งซ้ำ = แก้ราคาเดิม · ย้อนหลัง/ล่วงหน้าได้ในช่วง 2020 ถึง 1 ปีข้างหน้า (วันไทย — ข้อ 6) · ตั้งได้เฉพาะรายการจริง (ไม่ใช่ตัวที่ถูกรวมแล้ว)
create or replace function analytics.gem_price_set(p_shop_id uuid, p_actor uuid, p_item_id uuid, p_price numeric, p_effective_from date default null, p_supplier text default null, p_note text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_today date := analytics.job_today();
  v_eff   date;
  v_item  analytics.gem_item%rowtype;
  v_sup   text;
  v_note  text;
  v_had   boolean;
  v_old   analytics.gem_item_price%rowtype;
begin
  if p_shop_id is null or p_item_id is null then
    raise exception 'gem_price_set: p_shop_id และ p_item_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.gem_require_office(p_shop_id, p_actor);
  -- not(between) กัน NaN/Infinity (ข้อ 4) · ทศนิยมเกินคอลัมน์ = ปฏิเสธ ไม่ปัดเงียบ
  if p_price is null or not (p_price > 0 and p_price <= 1000000) or p_price <> round(p_price, 4) then
    raise exception 'ราคาต้องเป็นตัวเลขมากกว่า 0 และไม่เกิน 1,000,000 บาท (ทศนิยมไม่เกิน 4 ตำแหน่ง)' using errcode = '22023', hint = 'price_invalid';
  end if;
  v_eff := coalesce(p_effective_from, v_today);
  if v_eff < date '2020-01-01' or v_eff > v_today + 365 then
    raise exception 'วันที่มีผลต้องอยู่ระหว่างปี 2020 ถึงไม่เกิน 1 ปีข้างหน้า' using errcode = '22023', hint = 'date_invalid';
  end if;
  v_sup := analytics.job_text_clean(p_supplier, 'ผู้ขาย', 120, false);
  v_note := analytics.job_text_clean(p_note, 'หมายเหตุ', 300, false);
  if (v_sup is not null and (v_sup ~ '[<>]' or not analytics.oem_note_present(v_sup))) or (v_note is not null and (v_note ~ '[<>]' or not analytics.oem_note_present(v_note))) then
    raise exception 'ผู้ขาย/หมายเหตุต้องมีตัวอักษรหรือตัวเลขจริง และห้ามมีเครื่องหมาย < >' using errcode = '22023', hint = 'text_invalid';
  end if;
  select * into v_item from analytics.gem_item i where i.id = p_item_id and i.shop_id = p_shop_id for update;
  if not found then
    raise exception 'ไม่พบรายการพลอยในร้านนี้' using errcode = '22023', hint = 'gem_item_invalid';
  end if;
  if v_item.merged_into is not null then
    raise exception 'รายการนี้ถูกรวมแล้ว — ตั้งราคาที่รายการปลายทาง' using errcode = '22023', hint = 'gem_merged_locked';
  end if;
  select * into v_old from analytics.gem_item_price p where p.gem_item_id = p_item_id and p.effective_from = v_eff for update;
  v_had := v_old.gem_item_id is not null;
  -- 🔴 audit (security M1): แก้ทับวันเดิม หรือวันที่มีผลย้อนหลัง (< วันนี้ไทย) = ต้องมี note ที่มีตัวอักษรจริง (whitelist) — ราคาต้นทุนย้อนหลังแก้เงียบๆ ไม่ได้
  if (v_had or v_eff < v_today) and (v_note is null or not analytics.oem_note_present(v_note)) then
    raise exception 'แก้ราคาทับวันเดิม หรือตั้งราคาย้อนหลัง ต้องระบุหมายเหตุ (เหตุผลที่แก้)' using errcode = '22023', hint = 'note_required';
  end if;
  insert into analytics.gem_item_price_audit (shop_id, gem_item_id, effective_from, action, old_price, new_price, old_supplier, new_supplier, note, actor)
  values (p_shop_id, p_item_id, v_eff, case when v_had then 'update' else 'insert' end, v_old.price_thb_per_unit, p_price, v_old.supplier, v_sup, v_note, p_actor);
  insert into analytics.gem_item_price as p (gem_item_id, shop_id, effective_from, price_thb_per_unit, supplier, note, updated_by)
  values (p_item_id, p_shop_id, v_eff, p_price, v_sup, v_note, p_actor)
  on conflict (gem_item_id, effective_from) do update
    set price_thb_per_unit = excluded.price_thb_per_unit, supplier = excluded.supplier, note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('gem_item_id', p_item_id, 'effective_from', v_eff, 'price', p_price, 'replaced', v_had);
end;
$f$;

create or replace function analytics.gem_price_history(p_shop_id uuid, p_actor uuid, p_item_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
begin
  if p_shop_id is null or p_item_id is null then
    raise exception 'gem_price_history: p_shop_id และ p_item_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.gem_require_office(p_shop_id, p_actor);
  perform 1 from analytics.gem_item i where i.id = p_item_id and i.shop_id = p_shop_id;
  if not found then
    raise exception 'ไม่พบรายการพลอยในร้านนี้' using errcode = '22023', hint = 'gem_item_invalid';
  end if;
  return jsonb_build_object('gem_item_id', p_item_id,
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('effective_from', p.effective_from, 'price', p.price_thb_per_unit, 'supplier', p.supplier, 'note', p.note,
                                                          'updated_by', p.updated_by, 'updated_at', p.updated_at) order by p.effective_from desc), '[]'::jsonb)
               from analytics.gem_item_price p where p.gem_item_id = p_item_id),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('action', a.action, 'effective_from', a.effective_from, 'old_price', a.old_price, 'new_price', a.new_price,
                                                          'note', a.note, 'actor', a.actor, 'recorded_at', a.recorded_at) order by a.recorded_at desc, a.id), '[]'::jsonb)
               from analytics.gem_item_price_audit a where a.shop_id = p_shop_id and a.gem_item_id = p_item_id));
end;
$f$;

-- ============================================================================
-- 6. RPC BOM — แม่แบบ SKU + พลอยต่อใบ (ออฟฟิศ · ไม่มีราคา) · ทั้งชุดแทนที่ในครั้งเดียว (all-or-nothing)
-- ============================================================================

create or replace function analytics.product_gem_bom_get(p_shop_id uuid, p_product_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
begin
  if p_shop_id is null or p_product_id is null then
    raise exception 'product_gem_bom_get: p_shop_id และ p_product_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform 1 from public.product p where p.id = p_product_id and p.shop_id = p_shop_id;
  if not found then
    raise exception 'ไม่พบ SKU ในร้านนี้' using errcode = '22023', hint = 'gem_product_invalid';
  end if;
  return jsonb_build_object('product_id', p_product_id,
    'lines', (select coalesce(jsonb_agg(analytics.gem_item_json(b.gem_item_id) || jsonb_build_object('qty_per_piece', b.qty_per_piece, 'position', b.position_note, 'line_seq', b.line_seq) order by b.line_seq), '[]'::jsonb)
                from analytics.product_gem_bom b where b.product_id = p_product_id));
end;
$f$;

-- แทนที่แม่แบบพลอยของ SKU ทั้งชุด (ค่าเริ่มของใบที่เปิดใหม่ — ใบที่เปิดแล้วไม่เปลี่ยน) · [] = ล้างแม่แบบ · บันทึก catalog_audit_log (action edit · before/after = {gem_bom:[...]})
create or replace function analytics.product_gem_bom_set(p_shop_id uuid, p_product_id uuid, p_gem_lines jsonb, p_actor uuid, p_force boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_prod   public.product%rowtype;
  v_prep   jsonb;
  v_lines  jsonb;
  v_exist  uuid[];
  v_before jsonb;
  v_after  jsonb;
  v_sig_b  text;
  v_sig_a  text;
  v_ln     jsonb;
  v_seq    int := 0;
  v_old    analytics.product_gem_bom%rowtype;
  v_changed boolean;
begin
  if p_shop_id is null or p_product_id is null then
    raise exception 'product_gem_bom_set: p_shop_id และ p_product_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if p_actor is null then
    raise exception 'product_gem_bom_set: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  select * into v_prod from public.product p where p.id = p_product_id and p.shop_id = p_shop_id for update;
  if not found then
    raise exception 'ไม่พบ SKU ในร้านนี้' using errcode = '22023', hint = 'gem_product_invalid';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('gem_item_id', b.gem_item_id, 'label', analytics.gem_item_json(b.gem_item_id) ->> 'label', 'qty_per_piece', b.qty_per_piece, 'position', b.position_note) order by b.line_seq), '[]'::jsonb),
         string_agg(b.gem_item_id::text || ':' || b.qty_per_piece || ':' || coalesce(b.position_note, '') || ':' || b.line_seq, '|' order by b.line_seq),
         array_agg(b.gem_item_id)
    into v_before, v_sig_b, v_exist
    from analytics.product_gem_bom b where b.product_id = p_product_id;

  v_prep := analytics.gem_lines_prepare(p_shop_id, p_gem_lines, p_force, p_actor, null, coalesce(v_exist, '{}'::uuid[]));
  v_lines := v_prep -> 'lines';

  delete from analytics.product_gem_bom b
   where b.product_id = p_product_id
     and not exists (select 1 from jsonb_array_elements(v_lines) l where (l ->> 'gem_item_id')::uuid = b.gem_item_id);
  for v_ln in select value from jsonb_array_elements(v_lines) loop
    v_seq := v_seq + 1;
    select * into v_old from analytics.product_gem_bom b where b.product_id = p_product_id and b.gem_item_id = (v_ln ->> 'gem_item_id')::uuid;
    if found then
      if (v_old.line_seq, v_old.qty_per_piece, v_old.position_note) is distinct from (v_seq, (v_ln ->> 'qty_per_piece')::int, v_ln ->> 'position') then
        update analytics.product_gem_bom
           set line_seq = v_seq, qty_per_piece = (v_ln ->> 'qty_per_piece')::int, position_note = v_ln ->> 'position', updated_at = now()
         where id = v_old.id;
      end if;
    else
      insert into analytics.product_gem_bom (shop_id, product_id, line_seq, gem_item_id, qty_per_piece, position_note)
      values (p_shop_id, p_product_id, v_seq, (v_ln ->> 'gem_item_id')::uuid, (v_ln ->> 'qty_per_piece')::int, v_ln ->> 'position');
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('gem_item_id', b.gem_item_id, 'label', analytics.gem_item_json(b.gem_item_id) ->> 'label', 'qty_per_piece', b.qty_per_piece, 'position', b.position_note) order by b.line_seq), '[]'::jsonb),
         string_agg(b.gem_item_id::text || ':' || b.qty_per_piece || ':' || coalesce(b.position_note, '') || ':' || b.line_seq, '|' order by b.line_seq)
    into v_after, v_sig_a
    from analytics.product_gem_bom b where b.product_id = p_product_id;
  v_changed := coalesce(v_sig_b, '') is distinct from coalesce(v_sig_a, '');
  if v_changed then
    insert into analytics.catalog_audit_log (shop_id, product_id, sku, action, before, after, changed_by)
    values (p_shop_id, p_product_id, v_prod.sku, 'edit', jsonb_build_object('gem_bom', v_before), jsonb_build_object('gem_bom', v_after), p_actor);
  end if;
  return jsonb_build_object('changed', v_changed, 'count', jsonb_array_length(v_after),
    'lines', (select coalesce(jsonb_agg(analytics.gem_item_json(b.gem_item_id) || jsonb_build_object('qty_per_piece', b.qty_per_piece, 'position', b.position_note, 'line_seq', b.line_seq) order by b.line_seq), '[]'::jsonb)
                from analytics.product_gem_bom b where b.product_id = p_product_id),
    'summary', v_prep -> 'summary');
end;
$f$;

-- "ตั้งเป็นแม่แบบ SKU" จากพลอยของใบนี้ (ทางหลักที่แม่แบบถูกเติม — ทะยอยจากใบจริง) · ใบต้องมี SKU
create or replace function analytics.product_gem_bom_from_job(p_shop_id uuid, p_job_id uuid, p_actor uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job   analytics.job%rowtype;
  v_lines jsonb;
begin
  if p_shop_id is null or p_job_id is null then
    raise exception 'product_gem_bom_from_job: p_shop_id และ p_job_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  select * into v_job from analytics.job j where j.id = p_job_id and j.shop_id = p_shop_id;
  if not found then
    raise exception 'ไม่พบใบงานในร้านนี้' using errcode = '22023', hint = 'job_not_found';
  end if;
  if v_job.parent_job_id is not null then
    raise exception 'ส่วนย่อยไม่มีพลอยของตัวเอง — พลอยอยู่ที่ใบแม่' using errcode = '22023', hint = 'lot_no_gems';
  end if;
  if v_job.product_id is null then
    raise exception 'ใบนี้ไม่มี SKU — ตั้งเป็นแม่แบบไม่ได้' using errcode = '22023', hint = 'no_product';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('gem_item_id', g.gem_item_id, 'qty_per_piece', g.qty_per_piece, 'position', g.position_note) order by g.line_seq), '[]'::jsonb)
    into v_lines from analytics.job_gem_bom g where g.job_id = p_job_id;
  return analytics.product_gem_bom_set(p_shop_id, v_job.product_id, v_lines, p_actor, true);
end;
$f$;

-- พลอยของใบ + หน้าต่างแก้ + เทียบแม่แบบ + ประวัติ (ออฟฟิศ · ไม่มีราคา)
create or replace function analytics.job_gem_bom_get(p_shop_id uuid, p_job_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job     analytics.job%rowtype;
  v_root    analytics.job%rowtype;
  v_lines   jsonb;
  v_tpl     jsonb;
  v_gstage  text;
begin
  if p_shop_id is null or p_job_id is null then
    raise exception 'job_gem_bom_get: p_shop_id และ p_job_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  select * into v_job from analytics.job j where j.id = p_job_id and j.shop_id = p_shop_id;
  if not found then
    raise exception 'ไม่พบใบงานในร้านนี้' using errcode = '22023', hint = 'job_not_found';
  end if;
  select * into v_root from analytics.job j where j.id = coalesce(v_job.parent_job_id, v_job.id);
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'gem_item_id', g.gem_item_id, 'canonical_item_id', analytics.gem_item_canonical(g.gem_item_id),
            'label', g.gem_label, 'qty_per_piece', g.qty_per_piece, 'qty_total', g.qty_per_piece::bigint * v_root.qty_planned, 'position', g.position_note,
            'source', g.source, 'via', case when g.created_by_worker_id is not null then 'shopfloor' else 'office' end, 'created_at', g.created_at,
            'renamed', coalesce((analytics.gem_item_json(g.gem_item_id) ->> 'label'), g.gem_label) is distinct from g.gem_label) order by g.line_seq), '[]'::jsonb)
    into v_lines from analytics.job_gem_bom g where g.job_id = v_root.id;
  if v_root.product_id is not null then
    select coalesce(jsonb_agg(analytics.gem_item_json(b.gem_item_id) || jsonb_build_object('qty_per_piece', b.qty_per_piece, 'position', b.position_note) order by b.line_seq), '[]'::jsonb)
      into v_tpl from analytics.product_gem_bom b where b.product_id = v_root.product_id;
  end if;
  select case when not exists (select 1 from analytics.job_stage s join analytics.job j on j.id = s.job_id where (j.id = v_root.id or j.parent_job_id = v_root.id) and s.stage_code = 'gem_set') then 'none'
              when exists (select 1 from analytics.job_stage s join analytics.job j on j.id = s.job_id where (j.id = v_root.id or j.parent_job_id = v_root.id) and s.stage_code = 'gem_set' and s.status in ('received', 'sent')) then 'started'
              when not exists (select 1 from analytics.job_stage s join analytics.job j on j.id = s.job_id where (j.id = v_root.id or j.parent_job_id = v_root.id) and s.stage_code = 'gem_set' and s.status <> 'skipped') then 'skipped'
              else 'pending' end into v_gstage;
  return jsonb_build_object(
    'job', jsonb_build_object('id', v_root.id, 'job_no', v_root.job_no, 'status', v_root.status, 'qty_planned', v_root.qty_planned, 'product_id', v_root.product_id),
    'window', analytics.job_gem_edit_window(v_root.id), 'gem_stage', v_gstage, 'lines', v_lines,
    'state', analytics.job_gem_state(p_shop_id, v_root.id),
    'template', v_tpl,
    'differs_from_template', case when v_tpl is null then null
      else (select coalesce(jsonb_agg(jsonb_build_array(x ->> 'canonical_item_id', x ->> 'qty_per_piece', coalesce(x ->> 'position', '')) order by x ->> 'canonical_item_id'), '[]'::jsonb) from jsonb_array_elements(v_lines) x)
           is distinct from (select coalesce(jsonb_agg(jsonb_build_array(y ->> 'gem_item_id', y ->> 'qty_per_piece', coalesce(y ->> 'position', '')) order by y ->> 'gem_item_id'), '[]'::jsonb) from jsonb_array_elements(v_tpl) y) end,
    'history', (select coalesce(jsonb_agg(jsonb_build_object('at', e.recorded_at, 'actor', e.actor, 'worker_id', e.worker_id, 'phase', e.payload ->> 'phase', 'source', e.payload ->> 'source',
                                                            'reason', e.payload ->> 'reason', 'before', e.payload -> 'before', 'after', e.payload -> 'after') order by e.recorded_at desc, e.id), '[]'::jsonb)
                  from (select * from analytics.job_event ev where ev.job_id = v_root.id and ev.event_type = 'bom_change' order by ev.recorded_at desc, ev.id limit 20) e));
end;
$f$;

-- แก้พลอยของใบ (ออฟฟิศ) — ทั้งชุดครั้งเดียว · หน้าต่างตาม job_gem_edit_window: ก่อนขั้นฝังรับ = ไม่ต้องเหตุผล · หลังขั้นฝังรับ = เหตุผลบังคับ (whitelist oem_note_present) · ใบ done/cancelled = ปฏิเสธ (job_closed)
--   ชื่อใหม่เข้าแคตตาล็อกในทรานแซกชันเดียวกัน · ตัวดักคล้าย: ไม่ส่ง p_force = gem_similar (ไม่เขียนอะไร)
create or replace function analytics.job_gem_bom_set(p_shop_id uuid, p_job_id uuid, p_gem_lines jsonb, p_actor uuid, p_reason text default null, p_force boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job    analytics.job%rowtype;
  v_window text;
  v_reason text;
  v_res    jsonb;
  v_bad_reason boolean := false;
begin
  v_job := analytics.job_office_begin('job_gem_bom_set', p_shop_id, p_job_id, p_actor);
  if v_job.parent_job_id is not null then
    raise exception 'ส่วนย่อยไม่มีพลอยของตัวเอง — พลอยอยู่ที่ใบแม่' using errcode = '22023', hint = 'lot_no_gems';
  end if;
  if p_gem_lines is null or jsonb_typeof(p_gem_lines) <> 'array' then
    raise exception 'รายการพลอยต้องเป็นรายการ (array) — ส่ง [] ถ้าไม่มีพลอย' using errcode = '22023', hint = 'lines_invalid';
  end if;
  v_window := analytics.job_gem_edit_window(v_job.id);
  -- เหตุผล: whitelist (oem_note_present = ต้องมีตัวอักษร/ตัวเลขจริง) · อักขระล่องหน/ควบคุม/ขึ้นบรรทัดใหม่/< > = ไม่นับเป็นเหตุผล (hint เดียวกับ "ไม่ใส่") · ยาวเกิน 300 = reason_invalid
  if char_length(coalesce(p_reason, '')) > 300 then
    raise exception 'เหตุผลยาวเกิน 300 ตัวอักษร' using errcode = '22023', hint = 'reason_invalid';
  end if;
  begin
    v_reason := analytics.job_text_clean(p_reason, 'เหตุผล', 300, false);
  exception when sqlstate '22023' then
    v_reason := null;
    v_bad_reason := true;
  end;
  if v_reason is not null and (v_reason ~ '[<>]' or not analytics.oem_note_present(v_reason)) then
    v_reason := null;
    v_bad_reason := true;
  end if;
  if v_bad_reason then
    raise exception 'เหตุผลต้องมีตัวอักษรหรือตัวเลขจริง (ห้ามอักขระล่องหน/ขึ้นบรรทัดใหม่/เครื่องหมาย < >)' using errcode = '22023', hint = 'reason_required';
  end if;
  if v_window = 'reason_required' and v_reason is null then
    raise exception 'ช่างฝังรับงานแล้ว — แก้พลอยต้องระบุเหตุผล' using errcode = '22023', hint = 'reason_required';
  end if;
  v_res := analytics.job_gem_bom_replace_core(v_job.id, p_gem_lines, p_force, p_actor, null, v_reason, 'manual', v_window);
  return v_res || jsonb_build_object('window', v_window);
end;
$f$;

-- ============================================================================
-- 7. replace ฟังก์ชันเดิม (ลอก def สดจาก DB 22 ต.ค. 69 ทุกบรรทัด แล้วแก้เฉพาะจุดที่มีคอมเมนต์ 0190 — pre-check ยืนยัน md5 แล้ว)
--    job_source_info (+ขั้นฝังเมื่อ SKU มีแม่แบบ · +gem_template_count) · job_plan_suggest (+gem_bom[]) · job_create_insert/_from_quote_item/_from_production_item/_core (+p_gem_lines/p_gem_force — drop signature เดิมก่อน: ข้อ 1)
--    job_worker_resolve (+job.gems/gems_state เฉพาะช่างระบุตัวแล้ว) · สิทธิ์ตั้งใหม่ทั้งหมดท้ายไฟล์ (ข้อ 2)
-- ============================================================================

CREATE OR REPLACE FUNCTION analytics.job_source_info(p_shop_id uuid, p_source_kind text, p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $f$
declare
  v_metal     text;
  v_new       boolean;
  v_gem       int;
  v_plating   text;
  v_i         record;
  v_poi       analytics.production_order_item%rowtype;
  v_prod      public.product%rowtype;
  v_eff       record;
  v_po_status text;
  v_paid      numeric;
  v_existing  record;
  v_label     text;
  v_codes     text[];
  v_tw        numeric;
  v_tw_src    text;
  v_tpl       int := 0;   -- 0190: จำนวนแถวแม่แบบพลอยของ SKU (มีแม่แบบ = เสนอขั้นฝังพลอย · ไม่มี = ผลเดิมเป๊ะ)
begin
  -- 0181: existing_job นับเฉพาะใบแม่ (parent_job_id is null) — ส่วนย่อยไม่ใช่ "ใบงานซ้ำ"
  if p_source_kind = 'oem' then
    select i.id, i.shop_id, i.seq, i.qty, i.input, i.product_id, i.sku_snapshot, i.product_name_snapshot,
           q.id as quote_id, q.status as quote_status, coalesce(q.root_quote_id, q.id) as root_id
      into v_i
      from analytics.oem_quote_item i
      join analytics.oem_quote q on q.id = i.quote_id
     where i.id = p_item_id and i.shop_id = p_shop_id;
    if not found then
      raise exception 'ไม่พบรายการในใบเสนอราคา' using errcode = '22023', hint = 'item_not_found';
    end if;
    if v_i.quote_status <> 'won' then
      raise exception 'สร้างใบงานได้เฉพาะใบเสนอราคาที่ได้งานแล้ว (won) — ใบนี้สถานะ %', v_i.quote_status
        using errcode = '22023', hint = 'quote_not_won';
    end if;
    v_metal := v_i.input ->> 'metal';
    if v_metal = 'product' then
      raise exception 'รายการสินค้า/บริการไม่ใช่งานผลิต สร้างใบงานไม่ได้' using errcode = '22023', hint = 'metal_unsupported';
    elsif v_metal = 'silver999' then
      raise exception 'เงินแท่งไม่มีขั้นตอนผลิตในโรงงาน สร้างใบงานไม่ได้' using errcode = '22023', hint = 'metal_unsupported';
    elsif v_metal is null or v_metal not in ('silver', 'gold', 'brass') then
      raise exception 'รายการนี้ไม่ระบุโลหะที่ใบงานรองรับ (เงิน/ทอง/ทองเหลือง)' using errcode = '22023', hint = 'metal_unsupported';
    end if;
    v_new := coalesce((v_i.input ->> 'is_new_design') = 'true', false);
    v_gem := case when (v_i.input ->> 'gem_count') ~ '^[0-9]+$' then (v_i.input ->> 'gem_count')::int else 0 end;
    v_plating := nullif(btrim(coalesce(v_i.input ->> 'plating_type', '')), '');
    select coalesce(v.paid_thb, 0) into v_paid from analytics.v_oem_quote v where v.id = v_i.quote_id;
    select j.id, j.job_no into v_existing from analytics.job j
     where j.status <> 'cancelled' and (j.oem_quote_item_id = v_i.id or (j.root_quote_id = v_i.root_id and j.oem_item_seq = v_i.seq)) and j.parent_job_id is null limit 1;
    v_label := coalesce(nullif(btrim(v_i.product_name_snapshot), ''), nullif(btrim(v_i.sku_snapshot), ''),
                        coalesce(nullif(v_i.input ->> 'item_kind', ''), 'งาน OEM') || ' #' || v_i.seq);
    v_tw := case when (v_i.input ->> 'weight_g') ~ '^[0-9]{1,6}(\.[0-9]+)?$' then round((v_i.input ->> 'weight_g')::numeric, 3) end;
    if v_tw is not null and not (v_tw > 0 and v_tw <= 10000) then v_tw := null; end if;
    v_tw_src := case when v_tw is null then null else 'quote' end;
    if v_i.product_id is not null then
      select count(*)::int into v_tpl from analytics.product_gem_bom b where b.shop_id = p_shop_id and b.product_id = v_i.product_id;
    end if;
    v_codes := array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'finish', 'buff', 'qc', 'pack'];
    if v_new then v_codes := array['cad', 'print3d', 'mold'] || v_codes; end if;
    if v_gem > 0 or v_tpl > 0 then v_codes := v_codes || 'gem_set'::text; end if;
    if v_plating is not null and v_plating not in ('none', 'null') then v_codes := v_codes || 'plating'::text; end if;
    return jsonb_build_object('source_kind', 'oem', 'item_id', v_i.id, 'quote_id', v_i.quote_id, 'root_quote_id', v_i.root_id,
      'item_seq', v_i.seq, 'metal', v_metal, 'qty', v_i.qty, 'is_new_design', v_new, 'design_label', left(v_label, 200),
      'sku', left(v_i.sku_snapshot, 100), 'product_id', v_i.product_id, 'deposit_missing', coalesce(v_paid, 0) <= 0,
      'existing_job', case when v_existing.id is null then null else jsonb_build_object('id', v_existing.id, 'job_no', v_existing.job_no) end,
      'suggested_stage_codes', to_jsonb(analytics.job_sort_stage_codes(p_shop_id, v_codes)),
      'target_piece_g', v_tw, 'target_piece_g_source', v_tw_src, 'gem_template_count', v_tpl);
  elsif p_source_kind = 'production' then
    select * into v_poi from analytics.production_order_item poi where poi.id = p_item_id and poi.shop_id = p_shop_id;
    if not found then
      raise exception 'ไม่พบรายการในใบผลิต' using errcode = '22023', hint = 'item_not_found';
    end if;
    select po.status into v_po_status from analytics.production_order po where po.id = v_poi.production_order_id;
    if v_po_status <> 'open' then
      raise exception 'สร้างใบงานได้เฉพาะใบผลิตที่ยังเปิดอยู่ (open) — ใบนี้สถานะ %', v_po_status using errcode = '22023', hint = 'po_not_open';
    end if;
    -- 0186: SKU ว่างได้ (รายการไม่มี SKU — ใช้ค่าจากรายการล้วน) · โลหะ/น้ำหนักจาก helper ตัวเดียวกับ preview/done (ทุกโลหะ — เดิมเฉพาะเงิน)
    if v_poi.product_id is not null then
      select * into v_prod from public.product p where p.id = v_poi.product_id;
    end if;
    select s.metal, s.purity, s.weight_g, s.weight_source into v_eff from analytics.production_item_spec(v_poi, v_prod) s;
    v_metal := v_eff.metal;
    select j.id, j.job_no into v_existing from analytics.job j where j.status <> 'cancelled' and j.production_order_item_id = v_poi.id and j.parent_job_id is null limit 1;
    v_tw := case when v_eff.weight_g > 0 and v_eff.weight_g <= 10000 then round(v_eff.weight_g, 3) end;
    v_tw_src := case when v_tw is null then null else v_eff.weight_source end;
    v_codes := array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'finish', 'buff', 'qc', 'pack'];
    if coalesce(v_poi.is_new_design, false) then v_codes := array['cad', 'print3d', 'mold'] || v_codes; end if;
    -- 0190: SKU ที่มีแม่แบบพลอย → เสนอขั้นฝังพลอย (ระบบไม่เพิ่ม/ลบขั้นให้เองนอกจากนี้ · ไม่มีแม่แบบ = ผลเดิม)
    if v_poi.product_id is not null then
      select count(*)::int into v_tpl from analytics.product_gem_bom b where b.shop_id = p_shop_id and b.product_id = v_poi.product_id;
      if v_tpl > 0 then v_codes := v_codes || 'gem_set'::text; end if;
    end if;
    return jsonb_build_object('source_kind', 'production', 'item_id', v_poi.id, 'metal', v_metal, 'qty', v_poi.qty_planned,
      'is_new_design', coalesce(v_poi.is_new_design, false),
      'design_label', left(coalesce(nullif(btrim(v_prod.name), ''), v_prod.sku, v_poi.pending_product_label), 200),
      'sku', left(v_prod.sku, 100), 'product_id', v_poi.product_id, 'deposit_missing', false,
      'existing_job', case when v_existing.id is null then null else jsonb_build_object('id', v_existing.id, 'job_no', v_existing.job_no) end,
      'suggested_stage_codes', to_jsonb(analytics.job_sort_stage_codes(p_shop_id, v_codes)),
      'target_piece_g', v_tw, 'target_piece_g_source', v_tw_src,
      'purity', v_eff.purity, 'sku_pending', v_poi.product_id is null, 'gem_template_count', v_tpl);
  end if;
  raise exception 'source_kind ต้องเป็น oem หรือ production' using errcode = '22023', hint = 'source_invalid';
end;
$f$;

CREATE OR REPLACE FUNCTION analytics.job_plan_suggest(p_shop_id uuid, p_source_kind text, p_item_id uuid, p_qty_planned integer DEFAULT NULL::integer, p_target_piece_g numeric DEFAULT NULL::numeric, p_stage_codes text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $f$
declare
  v_today   date := analytics.job_today();
  v_info    jsonb;
  v_qty_ord int;
  v_has_pl  boolean;
  v_rc      numeric;
  v_rp      numeric;
  v_rpl     numeric;
  v_missing jsonb := '[]'::jsonb;
  v_suggest int := null;
  v_den     numeric;
  v_sug_n   numeric;
  v_eff     int;
  v_target  numeric;
  v_tsrc    text;
  v_metal   text;
  v_plan    jsonb;
  v_gem     jsonb := '[]'::jsonb;   -- 0190: แม่แบบพลอยของ SKU (🔴 ไม่มีราคา — ฟอร์มนี้ staff ใช้ได้)
begin
  if p_shop_id is null or p_item_id is null then
    raise exception 'job_plan_suggest: p_shop_id และ p_item_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if p_qty_planned is not null and not (p_qty_planned between 1 and 100000) then
    raise exception 'จำนวนเริ่มผลิตต้องอยู่ระหว่าง 1 ถึง 100,000' using errcode = '22023', hint = 'qty_planned_invalid';
  end if;
  if p_target_piece_g is not null
     and not (p_target_piece_g > 0 and p_target_piece_g <= 10000 and p_target_piece_g = round(p_target_piece_g, 3)) then
    raise exception 'น้ำหนักเป้าหมายต่อชิ้นต้องมากกว่า 0 ไม่เกิน 10,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)' using errcode = '22023', hint = 'target_invalid';
  end if;

  if p_stage_codes is not null and cardinality(p_stage_codes) > 50 then
    raise exception 'รายการขั้นตอนมากเกินไป' using errcode = '22023', hint = 'stage_codes_invalid';
  end if;

  v_info := analytics.job_source_info(p_shop_id, p_source_kind, p_item_id);
  v_qty_ord := (v_info ->> 'qty')::int;
  v_metal := v_info ->> 'metal';
  -- ชุบหรือไม่: ตามขั้นที่ออฟฟิศติ๊กจริง (p_stage_codes) · ไม่ส่ง = ตามขั้นที่ระบบเสนอ
  v_has_pl := case when p_stage_codes is not null then 'plating' = any (p_stage_codes)
                   else (v_info -> 'suggested_stage_codes') ? 'plating' end;

  -- 0177: rate reject เป็น % จริง (3 = 3%) — job_rate_pct คูณ 100 จากสัดส่วนในตาราง OEM
  v_rc := analytics.job_rate_pct(p_shop_id, 'reject_rate_cast_pct', '-', v_today);
  v_rp := analytics.job_rate_pct(p_shop_id, 'reject_rate_polish_pct', '-', v_today);
  v_rpl := case when v_has_pl then analytics.job_rate_pct(p_shop_id, 'reject_rate_plate_pct', '-', v_today) else 0 end;
  -- ค่าที่ไม่สมเหตุผล (null/ติดลบ/NaN/>= 100) = ถือว่าไม่มี rate — กันตัวหารศูนย์/ติดลบ (migration-traps ข้อ 4-5)
  if v_rc is null or not (v_rc >= 0 and v_rc < 100) then
    v_rc := null; v_missing := v_missing || to_jsonb('reject_rate_cast_pct[-]'::text);
  end if;
  if v_rp is null or not (v_rp >= 0 and v_rp < 100) then
    v_rp := null; v_missing := v_missing || to_jsonb('reject_rate_polish_pct[-]'::text);
  end if;
  if v_has_pl and (v_rpl is null or not (v_rpl >= 0 and v_rpl < 100)) then
    v_rpl := null; v_missing := v_missing || to_jsonb('reject_rate_plate_pct[-]'::text);
  end if;

  if v_rc is not null and v_rp is not null and (v_rpl is not null or not v_has_pl) then
    v_den := (1 - v_rc / 100) * (1 - v_rp / 100) * (1 - coalesce(v_rpl, 0) / 100);
    v_sug_n := ceil(v_qty_ord / v_den);
    if v_sug_n between 1 and 100000 then
      v_suggest := v_sug_n::int;
    else
      v_missing := v_missing || to_jsonb('qty_planned_suggest_over_limit'::text);
    end if;
  end if;

  v_eff := coalesce(p_qty_planned, v_suggest, v_qty_ord);
  v_target := coalesce(p_target_piece_g, nullif(v_info ->> 'target_piece_g', '')::numeric);
  v_tsrc := case when p_target_piece_g is not null then 'input' else v_info ->> 'target_piece_g_source' end;
  v_plan := analytics.job_plan_compute(p_shop_id, v_metal, v_eff, v_target, null, null, v_tsrc);
  if jsonb_typeof(v_plan -> 'basis') = 'object' then
    v_missing := v_missing || (v_plan -> 'basis' -> 'missing');
  end if;

  if nullif(v_info ->> 'product_id', '') is not null then
    select coalesce(jsonb_agg(analytics.gem_item_json(b.gem_item_id) || jsonb_build_object('qty_per_piece', b.qty_per_piece, 'qty_total', b.qty_per_piece::bigint * v_eff, 'position', b.position_note, 'source', 'product') order by b.line_seq), '[]'::jsonb)
      into v_gem from analytics.product_gem_bom b where b.shop_id = p_shop_id and b.product_id = (v_info ->> 'product_id')::uuid;
  end if;

  return jsonb_build_object(
    'qty_order', v_qty_ord, 'qty_planned_suggest', v_suggest, 'buffer_qty', v_suggest - v_qty_ord, 'qty_planned_eff', v_eff, 'under_planned', v_eff < v_qty_ord,
    'reject_basis', jsonb_build_object('cast_pct', v_rc, 'polish_pct', v_rp, 'plate_pct', case when v_has_pl then v_rpl else null end, 'has_plating', v_has_pl),
    'target_piece_g', v_target, 'target_piece_g_source', v_tsrc, 'metal', v_metal,
    'metal_plan_g', v_plan -> 'metal_plan_g', 'metal_plan_basis', v_plan -> 'basis', 'missing', v_missing,
    'gem_bom', v_gem, 'gem_template_count', jsonb_array_length(v_gem));
end;
$f$;

drop function if exists analytics.job_create_insert(uuid, text, uuid, uuid, integer, uuid, uuid, text, text, text, integer, date, text, text, text[], boolean, uuid, integer, numeric, jsonb, uuid, uuid);
CREATE OR REPLACE FUNCTION analytics.job_create_insert(p_shop_id uuid, p_source_kind text, p_oem_item_id uuid, p_root_quote_id uuid, p_oem_item_seq integer, p_poi_id uuid, p_product_id uuid, p_design_label text, p_sku text, p_metal text, p_qty integer, p_due date, p_gate_note text, p_note text, p_codes text[], p_is_new_design boolean, p_actor uuid, p_qty_order integer, p_target_piece_g numeric, p_plan jsonb, p_profile_id uuid, p_worker_id uuid DEFAULT NULL::uuid, p_gem_lines jsonb DEFAULT NULL::jsonb, p_gem_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $f$
declare
  v_seq    int;
  v_job    analytics.job%rowtype;
  v_warn   text[];
  v_today  date := analytics.job_today();
  v_basis  jsonb;
  v_profile analytics.job_record_profile%rowtype;
  v_apply  jsonb;
  v_gem    jsonb := null;      -- 0190: ผลของ job_gem_bom_replace_core
  v_gem_src text := 'none';
begin
  -- 0187: ผู้เปิดใบเป็นออฟฟิศ (p_actor) หรือช่างหน้างาน (p_worker_id) — อย่างใดอย่างหนึ่งเท่านั้น (ตรงกับ CHECK job_who_opened_ck)
  if num_nonnulls(p_actor, p_worker_id) <> 1 then
    raise exception 'job_create_insert: ต้องระบุผู้เปิดใบเป็นออฟฟิศหรือช่างอย่างใดอย่างหนึ่ง' using errcode = '22023', hint = 'actor_required';
  end if;
  -- p_qty = qty_planned (จำนวนเริ่มผลิต) · p_qty_order = จำนวนที่สั่ง · p_plan = ผลของ job_plan_compute
  if p_qty_order is null or not (p_qty_order between 1 and 100000) or p_qty is null or not (p_qty between 1 and 100000) then
    raise exception 'จำนวนสั่ง/จำนวนเริ่มผลิตต้องอยู่ระหว่าง 1 ถึง 100,000' using errcode = '22023', hint = 'qty_planned_invalid';
  end if;
  -- 0176 → 0186: แบบการบันทึก — ไม่ส่งมา = ค่าเริ่มตามโลหะ (ทอง: is_default_gold ที่ active เท่านั้น ไม่มี = no_gold_profile ไม่ fallback ไปแบบทั่วไป) · ไม่มีค่าเริ่ม/แบบไม่ถูกต้อง (ไม่พบ/ร้านอื่น/ปิดใช้) = ปฏิเสธ ไม่เดา
  if p_profile_id is null then
    -- 0186: ทองต้องมีแบบทองเป็นค่าเริ่มเท่านั้น — ไม่ fallback ไปแบบ default ของเงินเงียบๆ
    if p_metal = 'gold' and not exists (
         select 1 from analytics.job_record_profile gp where gp.shop_id = p_shop_id and gp.is_active and gp.is_default_gold) then
      raise exception 'ร้านนี้ยังไม่มีแบบการบันทึกค่าเริ่มสำหรับงานทอง (ชั่งทุกขั้น + ชั่งสุทธิ) — ตั้งแบบทองเป็นค่าเริ่มที่หน้าแบบการบันทึกก่อนสร้างใบงานทอง' using errcode = '22023', hint = 'no_gold_profile';
    end if;
    select p.* into v_profile from analytics.job_record_profile p where p.id = analytics.job_profile_default_for(p_shop_id, p_metal);
    if not found then
      raise exception 'ร้านนี้ยังไม่มีแบบการบันทึกค่าเริ่ม — ตั้งค่าเริ่มที่หน้าแบบการบันทึกก่อนสร้างใบงาน' using errcode = '22023', hint = 'no_default_profile';
    end if;
  else
    select p.* into v_profile from analytics.job_record_profile p where p.id = p_profile_id and p.shop_id = p_shop_id;
    if not found or not v_profile.is_active then
      raise exception 'แบบการบันทึกไม่ถูกต้อง (ไม่พบ/ของร้านอื่น/ปิดใช้งานแล้ว)' using errcode = '22023', hint = 'profile_invalid';
    end if;
  end if;
  v_basis := case when jsonb_typeof(p_plan -> 'basis') = 'object' then p_plan -> 'basis' end;
  v_warn := analytics.job_validate_stage_codes(p_shop_id, p_codes, p_is_new_design);
  if p_due is not null and (p_due < v_today or p_due > v_today + 730) then
    raise exception 'กำหนดส่งต้องไม่ย้อนหลังและไม่เกิน 2 ปีข้างหน้า' using errcode = '22023', hint = 'due_invalid';
  end if;

  insert into analytics.job_counter as c (shop_id, last_no) values (p_shop_id, 1)
  on conflict (shop_id) do update set last_no = c.last_no + 1
  returning c.last_no into v_seq;

  insert into analytics.job (shop_id, seq, source_kind, oem_quote_item_id, root_quote_id, oem_item_seq, production_order_item_id,
                             product_id, design_label, sku_snapshot, metal, qty_order, qty_planned, weigh_required, due_date,
                             start_gate_note, created_by, opened_by_worker_id, note, target_piece_g, metal_plan_g, metal_plan_basis,
                             profile_id, profile_name, require_final_weight)
  values (p_shop_id, v_seq, p_source_kind, p_oem_item_id, p_root_quote_id, p_oem_item_seq, p_poi_id,
          p_product_id, p_design_label, p_sku, p_metal, p_qty_order, p_qty, false, p_due,
          p_gate_note, p_actor, p_worker_id, p_note, p_target_piece_g, (p_plan ->> 'metal_plan_g')::numeric, v_basis,
          v_profile.id, v_profile.name, v_profile.require_final_weight)
  returning * into v_job;

  -- 0176: ขั้นเริ่มปิดทั้ง 3 flag แล้ว job_profile_apply ตั้งตามแบบ (ที่เดียวที่ derive flag · ใช้ร่วมกับ job_profile_set) — ตรรกะ metal เดิม (ทอง/เงิน/ทองเหลือง) ถอดแล้ว
  insert into analytics.job_stage (job_id, shop_id, stage_code, seq, weigh_required, scrap_qty_ask, scrap_weight_ask)
  select v_job.id, p_shop_id, a.code, a.ord::int, false, false, false
    from unnest(p_codes) with ordinality as a(code, ord)
    join analytics.job_stage_def d on d.shop_id = p_shop_id and d.code = a.code
   order by a.ord;
  v_apply := analytics.job_profile_apply(v_job.id, v_profile.id);

  perform analytics.job_event_write(v_job.id, null, 'create', v_today, p_actor, p_worker_id, case when p_worker_id is null then 'job_page' else 'worker_qr' end, null,
    jsonb_build_object('source_kind', p_source_kind, 'stage_codes', to_jsonb(p_codes), 'qty_planned', p_qty, 'metal', p_metal,
                       'qty_order', p_qty_order, 'target_piece_g', p_target_piece_g, 'metal_plan_g', v_job.metal_plan_g,
                       'due_date', p_due, 'start_gate_note_present', p_gate_note is not null,
                       'profile_id', v_profile.id, 'profile_name', v_profile.name, 'has_weigh', v_apply -> 'has_weigh',
                       'gold_unguarded', v_apply -> 'gold_unguarded')
                       || case when p_worker_id is null then '{}'::jsonb else jsonb_build_object('via', 'shopfloor') end);

  -- 0190: พลอยของใบ — p_gem_lines: null = คัดลอกแม่แบบ SKU (เฉพาะเมื่อใบมีขั้น gem_set) · '[]' = ระบุว่าไม่มีพลอย · อื่นๆ = แถวที่ส่งมา (gem_lines_prepare: ชื่อใหม่เข้าแคตตาล็อกในทรานแซกชันนี้ · ตัวดักคล้ายถ้าไม่ p_gem_force)
  -- ระบบไม่เพิ่ม/ลบขั้นฝังพลอยให้เอง · อยู่หลัง event 'create' เพื่อให้ประวัติเรียง create → bom_change
  if p_gem_lines is not null then
    if jsonb_typeof(p_gem_lines) <> 'array' then
      raise exception 'รายการพลอยต้องเป็นรายการ (array) — ส่ง [] ถ้าไม่มีพลอย' using errcode = '22023', hint = 'lines_invalid';
    end if;
    if jsonb_array_length(p_gem_lines) > 0 then
      v_gem := analytics.job_gem_bom_replace_core(v_job.id, p_gem_lines, p_gem_force, p_actor, p_worker_id, null,
                 case when p_worker_id is null then 'manual' else 'shopfloor' end, 'create');
      v_gem_src := 'input';
    else
      v_gem_src := 'none_explicit';
    end if;
  elsif p_product_id is not null and 'gem_set' = any (p_codes)
        and exists (select 1 from analytics.product_gem_bom b where b.shop_id = p_shop_id and b.product_id = p_product_id) then
    v_gem := analytics.job_gem_bom_replace_core(v_job.id,
      (select jsonb_agg(jsonb_build_object('gem_item_id', b.gem_item_id, 'qty_per_piece', b.qty_per_piece, 'position', b.position_note) order by b.line_seq)
         from analytics.product_gem_bom b where b.shop_id = p_shop_id and b.product_id = p_product_id),
      false, p_actor, p_worker_id, null, 'product', 'create',
      (select array_agg(b.gem_item_id) from analytics.product_gem_bom b where b.shop_id = p_shop_id and b.product_id = p_product_id));
    v_gem_src := 'template';
  end if;

  return jsonb_build_object('job_id', v_job.id, 'job_no', v_job.job_no, 'status', v_job.status, 'metal', v_job.metal,
                            'qty_planned', v_job.qty_planned, 'stage_codes', to_jsonb(p_codes), 'warnings', to_jsonb(v_warn),
                            'start_gate_note_set', p_gate_note is not null,
                            'qty_order', v_job.qty_order, 'under_planned', v_job.qty_planned < v_job.qty_order,
                            'metal_plan_g', v_job.metal_plan_g, 'plan_missing', coalesce(v_basis -> 'missing', '[]'::jsonb),
                            'profile_id', v_profile.id, 'profile_name', v_profile.name, 'has_weigh', v_apply -> 'has_weigh',
                            'gold_unguarded', v_apply -> 'gold_unguarded',
                            'gem_lines', coalesce((v_gem ->> 'count')::int, 0), 'gem_source', v_gem_src, 'gem_summary', v_gem -> 'summary');
end;
$f$;

drop function if exists analytics.job_create_from_quote_item(uuid, uuid, text[], date, text, text, text, uuid, integer, numeric, numeric, text, uuid);
CREATE OR REPLACE FUNCTION analytics.job_create_from_quote_item(p_shop_id uuid, p_quote_item_id uuid, p_stage_codes text[], p_due_date date DEFAULT NULL::date, p_start_gate_note text DEFAULT NULL::text, p_design_label text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid, p_qty_planned integer DEFAULT NULL::integer, p_target_piece_g numeric DEFAULT NULL::numeric, p_metal_plan_override_g numeric DEFAULT NULL::numeric, p_metal_plan_reason text DEFAULT NULL::text, p_profile_id uuid DEFAULT NULL::uuid, p_gem_lines jsonb DEFAULT NULL::jsonb, p_gem_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_info  jsonb;
  v_gate  text;
  v_label text;
  v_note  text;
  v_dup   record;
  v_qty_order   int;
  v_qty_planned int;
  v_target      numeric;
  v_plan        jsonb;
begin
  if p_shop_id is null or p_quote_item_id is null then
    raise exception 'job_create_from_quote_item: p_shop_id และ p_quote_item_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'job_create_from_quote_item: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  -- กันสร้างซ้ำพร้อมกัน: ล็อกแถวใบเสนอราคาของ item นี้ก่อนตรวจ/นับเลข
  perform 1 from analytics.oem_quote q join analytics.oem_quote_item i on i.quote_id = q.id
   where i.id = p_quote_item_id and q.shop_id = p_shop_id for share of q;
  v_info := analytics.job_source_info(p_shop_id, 'oem', p_quote_item_id);
  if v_info -> 'existing_job' <> 'null'::jsonb then
    raise exception 'รายการนี้มีใบงาน % อยู่แล้ว — ถ้าต้องการสร้างใหม่ให้ยกเลิกใบเดิมก่อน', v_info -> 'existing_job' ->> 'job_no'
      using errcode = '22023', hint = 'job_exists';
  end if;
  v_gate := analytics.job_text_clean(p_start_gate_note, 'เหตุผลที่เริ่มผลิตก่อนมัดจำ', 500, false);
  if (v_info ->> 'deposit_missing')::boolean and v_gate is null then
    raise exception 'ดีลนี้ยังไม่มีเงินมัดจำเข้า — ต้องระบุเหตุผลที่ยอมเริ่มผลิตก่อน (start_gate_note)' using errcode = '22023', hint = 'start_gate_required';
  end if;
  if v_gate is not null and not analytics.oem_note_present(v_gate) then
    raise exception 'เหตุผลที่เริ่มผลิตก่อนมัดจำต้องมีตัวอักษรหรือตัวเลขจริง' using errcode = '22023', hint = 'start_gate_required';
  end if;
  -- มติเจ้าของ 12 ต.ค.: ใบงาน OEM ต้องให้ออฟฟิศตั้ง/ยืนยันชื่อเรียกภายในเสมอ (ค่าเริ่มต้นจาก job_stage_suggest.design_label ให้ UI เติมให้แก้ได้)
  -- ช่าง/ใบพิมพ์แสดงเฉพาะชื่อนี้ ไม่ดึง snapshot ของใบเสนอราคาเอง
  if nullif(btrim(coalesce(p_design_label, '')), '') is null then
    raise exception 'ใบงาน OEM ต้องตั้งชื่อเรียกภายใน (design_label) โดยออฟฟิศก่อนสร้าง' using errcode = '22023', hint = 'design_label_required';
  end if;
  v_label := analytics.job_label_clean(p_design_label, 'ชื่อเรียกใบงาน', 200);
  v_note := analytics.job_text_clean(p_note, 'หมายเหตุ', 500, false);
  -- M1: จำนวนเริ่มผลิต/น้ำหนักเป้าหมาย/แผนโลหะ — จำนวนสั่งมาจากต้นทางเสมอ ไม่รับจาก client
  v_qty_order := (v_info ->> 'qty')::int;
  v_qty_planned := coalesce(p_qty_planned, v_qty_order);
  if not (v_qty_planned between 1 and 100000) then
    raise exception 'จำนวนเริ่มผลิตต้องอยู่ระหว่าง 1 ถึง 100,000' using errcode = '22023', hint = 'qty_planned_invalid';
  end if;
  v_target := coalesce(p_target_piece_g, nullif(v_info ->> 'target_piece_g', '')::numeric);
  if v_target is not null and not (v_target > 0 and v_target <= 10000 and v_target = round(v_target, 3)) then
    raise exception 'น้ำหนักเป้าหมายต่อชิ้นต้องมากกว่า 0 ไม่เกิน 10,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)' using errcode = '22023', hint = 'target_invalid';
  end if;
  v_plan := analytics.job_plan_compute(p_shop_id, v_info ->> 'metal', v_qty_planned, v_target, p_metal_plan_override_g, p_metal_plan_reason,
    case when p_target_piece_g is not null then 'input' else v_info ->> 'target_piece_g_source' end);

  -- 0190: ส่ง p_gem_lines/p_gem_force ต่อ (null = คัดลอกแม่แบบ SKU เมื่อใบมีขั้นฝัง · [] = ไม่มีพลอย)
  return analytics.job_create_insert(p_shop_id, 'oem', p_quote_item_id, (v_info ->> 'root_quote_id')::uuid, (v_info ->> 'item_seq')::int,
    null, nullif(v_info ->> 'product_id', '')::uuid, v_label, nullif(v_info ->> 'sku', ''), v_info ->> 'metal', v_qty_planned,
    p_due_date, v_gate, v_note, p_stage_codes, (v_info ->> 'is_new_design')::boolean, v_actor,
    v_qty_order, v_target, v_plan, p_profile_id, null::uuid, p_gem_lines, p_gem_force);
end;
$f$;

drop function if exists analytics.job_create_from_production_item_core(uuid, uuid, text[], date, text, text, uuid, uuid, integer, numeric, numeric, text, uuid);
CREATE OR REPLACE FUNCTION analytics.job_create_from_production_item_core(p_shop_id uuid, p_production_order_item_id uuid, p_stage_codes text[], p_due_date date, p_design_label text, p_note text, p_actor uuid, p_worker_id uuid, p_qty_planned integer, p_target_piece_g numeric, p_metal_plan_override_g numeric, p_metal_plan_reason text, p_profile_id uuid, p_gem_lines jsonb DEFAULT NULL::jsonb, p_gem_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $f$
declare
  v_info  jsonb;
  v_label text;
  v_note  text;
  v_qty_order   int;
  v_qty_planned int;
  v_target      numeric;
  v_plan        jsonb;
begin
  perform 1 from analytics.production_order po join analytics.production_order_item poi on poi.production_order_id = po.id
   where poi.id = p_production_order_item_id and po.shop_id = p_shop_id for share of po;
  v_info := analytics.job_source_info(p_shop_id, 'production', p_production_order_item_id);
  if v_info -> 'existing_job' <> 'null'::jsonb then
    raise exception 'รายการนี้มีใบงาน % อยู่แล้ว — ถ้าต้องการสร้างใหม่ให้ยกเลิกใบเดิมก่อน', v_info -> 'existing_job' ->> 'job_no'
      using errcode = '22023', hint = 'job_exists';
  end if;
  v_label := coalesce(case when nullif(btrim(coalesce(p_design_label, '')), '') is null then null
                          else analytics.job_label_clean(p_design_label, 'ชื่อแบบ', 200) end, v_info ->> 'design_label');
  v_note := analytics.job_text_clean(p_note, 'หมายเหตุ', 500, false);
  -- M1: จำนวนเริ่มผลิต/น้ำหนักเป้าหมาย/แผนโลหะ — จำนวนสั่งมาจากต้นทางเสมอ ไม่รับจาก client
  v_qty_order := (v_info ->> 'qty')::int;
  v_qty_planned := coalesce(p_qty_planned, v_qty_order);
  if not (v_qty_planned between 1 and 100000) then
    raise exception 'จำนวนเริ่มผลิตต้องอยู่ระหว่าง 1 ถึง 100,000' using errcode = '22023', hint = 'qty_planned_invalid';
  end if;
  v_target := coalesce(p_target_piece_g, nullif(v_info ->> 'target_piece_g', '')::numeric);
  if v_target is not null and not (v_target > 0 and v_target <= 10000 and v_target = round(v_target, 3)) then
    raise exception 'น้ำหนักเป้าหมายต่อชิ้นต้องมากกว่า 0 ไม่เกิน 10,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)' using errcode = '22023', hint = 'target_invalid';
  end if;
  v_plan := analytics.job_plan_compute(p_shop_id, v_info ->> 'metal', v_qty_planned, v_target, p_metal_plan_override_g, p_metal_plan_reason,
    case when p_target_piece_g is not null then 'input' else v_info ->> 'target_piece_g_source' end);

  -- 0190: ส่ง p_gem_lines/p_gem_force ต่อ (null = คัดลอกแม่แบบ SKU เมื่อใบมีขั้นฝัง · [] = ไม่มีพลอย)
  return analytics.job_create_insert(p_shop_id, 'production', null, null, null, p_production_order_item_id,
    nullif(v_info ->> 'product_id', '')::uuid, v_label, nullif(v_info ->> 'sku', ''), v_info ->> 'metal', v_qty_planned,
    p_due_date, null, v_note, p_stage_codes, (v_info ->> 'is_new_design')::boolean, p_actor,
    v_qty_order, v_target, v_plan, p_profile_id, p_worker_id, p_gem_lines, p_gem_force);
end;
$f$;

drop function if exists analytics.job_create_from_production_item(uuid, uuid, text[], date, text, text, uuid, integer, numeric, numeric, text, uuid);
CREATE OR REPLACE FUNCTION analytics.job_create_from_production_item(p_shop_id uuid, p_production_order_item_id uuid, p_stage_codes text[], p_due_date date DEFAULT NULL::date, p_design_label text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid, p_qty_planned integer DEFAULT NULL::integer, p_target_piece_g numeric DEFAULT NULL::numeric, p_metal_plan_override_g numeric DEFAULT NULL::numeric, p_metal_plan_reason text DEFAULT NULL::text, p_profile_id uuid DEFAULT NULL::uuid, p_gem_lines jsonb DEFAULT NULL::jsonb, p_gem_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
begin
  if p_shop_id is null or p_production_order_item_id is null then
    raise exception 'job_create_from_production_item: p_shop_id และ p_production_order_item_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'job_create_from_production_item: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  -- 0190: ส่ง p_gem_lines/p_gem_force ต่อ (null = คัดลอกแม่แบบ SKU เมื่อใบมีขั้นฝัง · [] = ไม่มีพลอย)
  return analytics.job_create_from_production_item_core(p_shop_id, p_production_order_item_id, p_stage_codes, p_due_date, p_design_label, p_note,
    v_actor, null, p_qty_planned, p_target_piece_g, p_metal_plan_override_g, p_metal_plan_reason, p_profile_id, p_gem_lines, p_gem_force);
end;
$f$;

CREATE OR REPLACE FUNCTION analytics.job_worker_resolve(p_token_hash text, p_session_hash text DEFAULT NULL::text, p_ip_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $f$
declare
  v_a        jsonb;
  v_job      analytics.job%rowtype;
  v_worker   uuid;
  v_wcodes   text[];
  v_hold     analytics.job_stage%rowtype;
  v_pend     analytics.job_stage%rowtype;
  v_prev     analytics.job_stage%rowtype;
  v_action   text := 'none';
  v_seq      int;
  v_code     text;
  v_name     text;
  v_need_w   boolean := false;
  v_prev_w   numeric := null;
  v_holder   text := null;
  v_paid     numeric;
  v_stages   jsonb;
  v_workers  jsonb := '[]'::jsonb;
  v_started  boolean;
  v_sq       boolean;
  v_sw       boolean;
  v_multi    boolean;
  v_open_disc boolean;
  v_any_active boolean;
  v_can_ext  boolean := false;
  v_parts    jsonb := '[]'::jsonb;
  v_acts     jsonb := '[]'::jsonb;
  v_has_send boolean := false;
  p          analytics.job%rowtype;
  ph         analytics.job_stage%rowtype;
  pp         analytics.job_stage%rowtype;
  pv         analytics.job_stage%rowtype;
  v_lbl      text;
  v_fname    text;
  v_days     int;
  v_cancel   boolean;
  dr         record;
  v_photos   jsonb := null;
  v_gems     jsonb := null;              -- 0190: พลอยของใบ (ใบแม่ · snapshot ฉลาก · 🔴 ไม่มีราคา)
  v_gems_state text := 'not_needed';
begin
  -- 0181 + 0182 (รูปอ้างอิงของใบ — เฉพาะช่างที่ระบุตัวแล้ว) + 0183 (my_actions: arrive = ได้รับเพิ่มแล้ว ให้ผู้รับของขั้นที่รับขาด)
  v_a := analytics.job_worker_auth(p_token_hash, p_session_hash, p_ip_hash, false, false, 'none');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  select * into v_job from analytics.job where id = (v_a ->> 'job_id')::uuid;
  v_worker := nullif(v_a ->> 'worker_id', '')::uuid;

  -- 0182: รูปอ้างอิงของใบแม่ (token ออกให้ใบแม่เท่านั้น — coalesce กันกรณี token ผูกส่วนย่อย) · เฉพาะหลังระบุตัว (ก่อน PIN ไม่มี key) · ไม่ลบแล้วเท่านั้น
  -- ไม่มีรูป ⇒ jsonb_agg = null ⇒ ไม่มี key photos ⇒ ผลเดิมเป๊ะ · path ถูก server ของช่าง sign แล้วทิ้ง (ไม่ถึงเบราว์เซอร์)
  if v_worker is not null then
    select jsonb_agg(jsonb_build_object('id', phx.id, 'sm_path', phx.variant_sm_path, 'md_path', phx.storage_path, 'is_primary', phx.is_primary, 'caption', phx.caption)
                     order by phx.is_primary desc, phx.sort_order, phx.created_at, phx.id)
      into v_photos
      from analytics.job_photo phx
     where phx.job_id = coalesce(v_job.parent_job_id, v_job.id) and phx.deleted_at is null and phx.kind = 'reference';
  end if;

  -- 0190: พลอยของใบ — เฉพาะช่างที่ระบุตัวแล้ว (เหมือนรูป) · 🔴 อ่าน snapshot gem_label จาก job_gem_bom เท่านั้น ไม่ join แคตตาล็อก/ราคา · state: specified (มีรายการ) | unspecified (มีขั้นฝังที่ยังไม่เสร็จแต่ไม่มีรายการ) | not_needed (ไม่มี key เลย = ผลเดิมเป๊ะ)
  if v_worker is not null then
    select jsonb_agg(jsonb_build_object('label', g.gem_label, 'qty_per_piece', g.qty_per_piece, 'qty_total', g.qty_per_piece::bigint * rj.qty_planned, 'position', g.position_note) order by g.line_seq)
      into v_gems
      from analytics.job_gem_bom g join analytics.job rj on rj.id = g.job_id
     where g.job_id = coalesce(v_job.parent_job_id, v_job.id);
    v_gems_state := analytics.job_gem_state(v_job.shop_id, coalesce(v_job.parent_job_id, v_job.id));   -- นิยามเดียวกับ job_gem_bom_get / getJobDetail
  end if;

  select * into v_hold from analytics.job_stage where job_id = v_job.id and status = 'received' limit 1;
  select * into v_pend from analytics.job_stage where job_id = v_job.id and status = 'pending' order by seq limit 1;
  select exists (select 1 from analytics.job_stage where job_id = v_job.id and status in ('received', 'sent')) into v_started;
  if v_hold.id is not null then
    select coalesce(w.display_name, v_hold.assignee_name) into v_holder from (select 1) x left join analytics.worker w on w.id = v_hold.worker_id;
  end if;

  -- ต้นไม้: มีส่วนย่อย (ไม่ยกเลิก) หรือมีส่วนต่างรอชี้แจง = หลายส่วน · ใบเดี่ยวทั่วไปทั้งหมดเป็น false ⇒ ทางเดิมทุกบรรทัด
  select exists (select 1 from analytics.job_discrepancy d2 where d2.root_job_id = v_job.id and d2.status = 'open'
                    and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d2.id)) into v_open_disc;
  select (v_open_disc or exists (select 1 from analytics.job c where c.parent_job_id = v_job.id and c.status <> 'cancelled')) into v_multi;
  select exists (select 1 from analytics.job j join analytics.job_stage s on s.job_id = j.id
                  where (j.id = v_job.id or j.parent_job_id = v_job.id) and j.status not in ('done', 'cancelled') and s.status in ('received', 'pending')) into v_any_active;

  if not (v_any_active or v_open_disc) then
    -- QA 5: ทุกขั้นส่งต่อ/ข้ามครบแล้วแต่ออฟฟิศยังไม่ปิดงาน — ไม่ใช่ "ให้ระบุตัว"
    v_action := 'all_done';
  elsif v_worker is null then
    v_action := 'identify';
    -- รายชื่อช่างที่ทำงานของต้นไม้นี้ได้ (ขั้นที่ถือค้าง/ขั้นที่รอรับของทุกส่วน + ผู้ส่งที่มีส่วนต่างรอชี้แจง) — เฉพาะ id + ชื่อ
    select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'display_name', w.display_name) order by w.display_name), '[]'::jsonb)
      into v_workers
      from analytics.worker w
     where w.shop_id = v_job.shop_id and w.is_active
       and (cardinality(w.stage_codes) = 0
            or exists (select 1 from analytics.job j join analytics.job_stage s on s.job_id = j.id
                        where (j.id = v_job.id or j.parent_job_id = v_job.id) and j.status not in ('done', 'cancelled')
                          and s.stage_code = any (w.stage_codes)
                          and (s.status = 'received'
                               or (s.status = 'pending' and s.seq = (select min(s2.seq) from analytics.job_stage s2 where s2.job_id = j.id and s2.status = 'pending'))))
            or exists (select 1 from analytics.job_discrepancy d3 join analytics.job_stage fs on fs.id = d3.from_stage_id
                        where d3.root_job_id = v_job.id and d3.status = 'open'
                          and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d3.id)
                          and (fs.worker_id = w.id or w.can_external)));
  else
    select w.stage_codes, w.can_external into v_wcodes, v_can_ext from analytics.worker w where w.id = v_worker;
    if v_hold.id is not null and v_hold.worker_id = v_worker then
      v_action := 'send'; v_seq := v_hold.seq; v_code := v_hold.stage_code; v_need_w := v_hold.weigh_required;
    elsif v_pend.id is not null then
      v_seq := v_pend.seq; v_code := v_pend.stage_code; v_need_w := v_pend.weigh_required;
      if v_job.status = 'on_hold' then
        v_action := 'on_hold';
      elsif not analytics.job_worker_can_do(v_wcodes, v_pend.stage_code) then
        v_action := 'not_your_stage';
      elsif v_hold.id is not null and ((v_job.metal = 'gold' and v_job.profile_id is null) or v_hold.weigh_required or v_hold.qty_split_out > 0) then
        -- QA N1: ขั้นก่อนบังคับชั่ง (หรือใบทองเดิม) ยังไม่ส่งต่อ -> บอกตั้งแต่ resolve ไม่ใช่ให้กดแล้วไป fail · 0181: ขั้นก่อนที่แยกส่วนออกไปแล้วปิดอัตโนมัติไม่ได้ = ผู้ถือต้องส่งส่วนที่เหลือก่อน
        v_action := 'prev_not_sent';
      else
        v_action := 'receive';
        -- 0176 (D6): ด่านมัดจำใช้ helper เดียวกับ job_core_receive
        if analytics.job_deposit_blocked(v_job) then
          v_action := 'awaiting_deposit';
        end if;
        select * into v_prev from analytics.job_stage
         where job_id = v_job.id and seq < v_pend.seq and status <> 'skipped' order by seq desc limit 1;
        -- N1: งานทองไม่ส่งน้ำหนักขั้นก่อนให้ผู้รับ (ชั่งแบบไม่รู้คำตอบ) · เงิน/ทองเหลืองส่งตามเดิม
        v_prev_w := case when v_job.metal = 'gold' then null else v_prev.weight_out_g end;
      end if;
    elsif v_hold.id is not null then
      v_action := 'held_by_other'; v_seq := v_hold.seq; v_code := v_hold.stage_code;
    end if;

    -- 0181: parts[] + my_actions[] ทั้งต้นไม้ (เฉพาะช่างที่ระบุตัวแล้ว)
    for p in select j.* from analytics.job j where (j.id = v_job.id or j.parent_job_id = v_job.id) and j.status <> 'cancelled' order by j.lot_seq loop
      v_lbl := v_job.job_no || case when p.parent_job_id is null then '' else ' · ส่วนที่ ' || p.lot_seq end;
      select * into ph from analytics.job_stage where job_id = p.id and status = 'received' limit 1;
      select * into pp from analytics.job_stage where job_id = p.id and status = 'pending' order by seq limit 1;
      select d4.name_th into v_fname from analytics.job_stage_def d4 where d4.shop_id = p.shop_id and d4.code = coalesce(ph.stage_code, pp.stage_code);
      v_days := analytics.job_today() - coalesce(ph.received_on, (select max(s3.sent_on) from analytics.job_stage s3 where s3.job_id = p.id), analytics.job_bkk_date(p.created_at));
      v_cancel := p.parent_job_id is not null and analytics.job_lot_return_blocker(p.id) is null
                  and exists (select 1 from analytics.job_stage s4 join analytics.job_stage ms on ms.id = s4.split_from_stage_id
                               join analytics.job_event e on e.job_id = ms.job_id and e.event_type = 'split' and e.payload ->> 'lot_job_id' = p.id::text
                              where s4.job_id = p.id and e.worker_id = v_worker and ms.worker_id = v_worker);
      v_parts := v_parts || jsonb_build_object(
        'lot_job_id', p.id, 'label', v_lbl, 'lot_seq', p.lot_seq, 'status', p.status, 'qty_planned', p.qty_planned,
        'qty_live', analytics.job_live_qty(p.id), 'stage_code', coalesce(ph.stage_code, pp.stage_code), 'stage_name', v_fname,
        'holder_name', case when ph.id is null then null else (select coalesce(w2.display_name, ph.assignee_name) from (select 1) x2 left join analytics.worker w2 on w2.id = ph.worker_id) end,
        'days', v_days, 'is_mine', ph.id is not null and ph.worker_id = v_worker, 'can_cancel_split', v_cancel);
      if p.status = 'done' then
        continue;
      end if;
      if ph.id is not null and ph.worker_id = v_worker then
        v_has_send := true;
        v_acts := v_acts || jsonb_build_object('lot_job_id', p.id, 'label', v_lbl, 'action', 'send', 'stage_seq', ph.seq, 'stage_code', ph.stage_code,
          'stage_name', (select d5.name_th from analytics.job_stage_def d5 where d5.shop_id = p.shop_id and d5.code = ph.stage_code),
          'weight_required', ph.weigh_required, 'scrap_qty_ask', ph.scrap_qty_ask, 'scrap_weight_ask', ph.scrap_weight_ask,
          'qty_hold', ph.qty_in - ph.qty_scrap - ph.qty_split_out, 'qty_expected', null, 'discrepancy_id', null, 'qty', null);
      end if;
      if pp.id is not null and p.status <> 'on_hold'
         and analytics.job_worker_can_do(v_wcodes, pp.stage_code)
         and not (ph.id is not null and (ph.worker_id = v_worker or (p.metal = 'gold' and p.profile_id is null) or ph.weigh_required or ph.qty_split_out > 0))
         and not analytics.job_deposit_blocked(p) then
        select * into pv from analytics.job_stage where job_id = p.id and seq < pp.seq and status <> 'skipped' order by seq desc limit 1;
        v_acts := v_acts || jsonb_build_object('lot_job_id', p.id, 'label', v_lbl, 'action', 'receive', 'stage_seq', pp.seq, 'stage_code', pp.stage_code,
          'stage_name', (select d6.name_th from analytics.job_stage_def d6 where d6.shop_id = p.shop_id and d6.code = pp.stage_code),
          'weight_required', pp.weigh_required, 'scrap_qty_ask', pp.scrap_qty_ask, 'scrap_weight_ask', pp.scrap_weight_ask,
          'qty_hold', null,
          'qty_expected', case when pv.id is null then p.qty_planned
                               else (case when pv.status = 'received' then pv.qty_in else pv.qty_out end) - analytics.job_disc_active_qty(pv.id, pp.id) end,
          'discrepancy_id', null, 'qty', null);
      end if;
      for dr in select dd.id, dd.qty, (dd.weight_gap_g is not null and p.metal = 'gold') as office_only, fs.seq as f_seq, fs.stage_code as f_code
                 from analytics.job_discrepancy dd join analytics.job_stage fs on fs.id = dd.from_stage_id
                where dd.job_id = p.id and dd.status = 'open' and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = dd.id)
                  and (fs.worker_id = v_worker or v_can_ext)
                order by dd.created_at loop
        v_acts := v_acts || jsonb_build_object('lot_job_id', p.id, 'label', v_lbl, 'action', 'explain', 'stage_seq', dr.f_seq, 'stage_code', dr.f_code,
          'stage_name', (select d7.name_th from analytics.job_stage_def d7 where d7.shop_id = p.shop_id and d7.code = dr.f_code),
          'weight_required', false, 'scrap_qty_ask', false, 'scrap_weight_ask', false,
          'qty_hold', null, 'qty_expected', null, 'discrepancy_id', dr.id, 'qty', dr.qty, 'office_only', dr.office_only);
      end loop;
      -- 0183: ส่วนต่างที่ยัง open ซึ่ง "ฉันเป็นผู้รับของขั้นที่รับขาด" → ปุ่ม "ได้รับเพิ่มแล้ว" (qty = ยอดที่ยังค้าง · weight_required = ทอง + ขั้นนั้นตั้งชั่ง — ไม่ส่งน้ำหนัก/ส่วนต่างให้ช่าง N1)
      for dr in select dd.id, dd.qty, ts.seq as t_seq, ts.stage_code as t_code, (p.metal = 'gold' and ts.weigh_required) as w_req,
                      (p.metal = 'gold' and ts.weigh_required and dd.weight_gap_g is null and not (fs3.weight_out_g is not null and ts.weight_in_g is not null)) as ref_missing
                  from analytics.job_discrepancy dd join analytics.job_stage ts on ts.id = dd.to_stage_id join analytics.job_stage fs3 on fs3.id = dd.from_stage_id
                 where dd.job_id = p.id and dd.status = 'open' and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = dd.id)
                   and ts.worker_id = v_worker and ts.status in ('received', 'sent')
                 order by dd.created_at loop
        v_acts := v_acts || jsonb_build_object('lot_job_id', p.id, 'label', v_lbl, 'action', 'arrive', 'stage_seq', dr.t_seq, 'stage_code', dr.t_code,
          'stage_name', (select d8.name_th from analytics.job_stage_def d8 where d8.shop_id = p.shop_id and d8.code = dr.t_code),
          'weight_required', dr.w_req, 'scrap_qty_ask', false, 'scrap_weight_ask', false,
          'qty_hold', null, 'qty_expected', null, 'discrepancy_id', dr.id, 'qty', dr.qty, 'office_only', dr.ref_missing);
      end loop;
    end loop;
  end if;

  -- 0176: flag ถามของเสียของขั้นที่ action ชี้ (flag = ถาม ไม่ใช่ด่าน DB)
  if v_seq is not null then
    select s.scrap_qty_ask, s.scrap_weight_ask into v_sq, v_sw from analytics.job_stage s where s.job_id = v_job.id and s.seq = v_seq;
  end if;

  select d.name_th into v_name from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_code;

  select coalesce(jsonb_agg(
           jsonb_build_object('seq', s.seq, 'code', s.stage_code, 'name', d.name_th, 'status', s.status)
           || case when v_worker is not null then
                jsonb_build_object('received_on', s.received_on, 'sent_on', s.sent_on,
                                   'worker_name', coalesce(w.display_name, s.assignee_name), 'auto_closed', s.auto_closed)
              else '{}'::jsonb end
           order by s.seq), '[]'::jsonb)
    into v_stages
    from analytics.job_stage s
    join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
    left join analytics.worker w on w.id = s.worker_id
   where s.job_id = v_job.id;

  return jsonb_build_object(
    'ok', true,
    'job', case when v_worker is null
             then jsonb_build_object('job_no', v_job.job_no, 'status', v_job.status, 'stages', v_stages, 'has_profile', v_job.profile_id is not null)
             else jsonb_build_object('job_no', v_job.job_no, 'status', v_job.status, 'design_label', v_job.design_label,
                                     'sku', v_job.sku_snapshot, 'metal', v_job.metal, 'qty_planned', v_job.qty_planned,
                                     'due_date', v_job.due_date, 'stages', v_stages,
                                     'profile_name', v_job.profile_name, 'has_profile', v_job.profile_id is not null)
                                     || case when v_photos is null then '{}'::jsonb else jsonb_build_object('photos', v_photos) end
                                     || case when v_gems_state = 'not_needed' then '{}'::jsonb else jsonb_build_object('gems', coalesce(v_gems, '[]'::jsonb), 'gems_state', v_gems_state) end end,
    'viewer', case when v_worker is null then null
              else jsonb_build_object('worker_id', v_worker, 'display_name', v_a ->> 'worker_name') end,
    'session_expired', (v_a ->> 'session_expired')::boolean,
    'next_action', case when v_multi and v_worker is not null then 'multi' else v_action end,
    'action_stage', case when v_seq is null or (v_multi and v_worker is not null) then null
                      else jsonb_build_object('seq', v_seq, 'code', v_code, 'name', v_name, 'weight_required', v_need_w,
                                           'scrap_qty_ask', coalesce(v_sq, true), 'scrap_weight_ask', coalesce(v_sw, false)) end,
    'prev_weight_out_g', case when v_multi and v_worker is not null then null else v_prev_w end,
    -- L1: ชื่อผู้ถือเห็นได้เฉพาะช่างที่ระบุตัวแล้ว
    'held_by', case when v_worker is null then null else v_holder end,
    'workers', v_workers,
    'scrap_reasons', case when (v_action = 'send' and not v_multi) or (v_multi and v_has_send)
                          then to_jsonb(array['porosity', 'broken', 'wrong_design', 'missing', 'other']) else '[]'::jsonb end,
    'parts', case when v_worker is null then null else v_parts end,
    'my_actions', case when v_worker is null then null else v_acts end
  );
end;
$f$;

-- ============================================================================
-- 8. views (ไม่มีคอลัมน์ราคา — ให้หน้าสรุป/สั่งซื้อ G1b ต่อ · ตัวรวมกลุ่มใช้ canonical_item_id ตามห่วงโซ่การรวมชื่อ ไม่ใช่ gem_item_id ของ snapshot)
-- ============================================================================
create or replace view analytics.v_product_gem_bom as
select b.shop_id, b.product_id, p.sku, p.name as product_name, b.line_seq, b.gem_item_id,
       t.name as type_name, s.name as shape_name, s.has_length, i.size_a, i.size_b, i.size_label,
       (t.name || ' · ' || s.name || ' · ' || i.size_label || ' มม.') as gem_label,   -- ไม่เรียกฟังก์ชันของ schema: service_role อ่านวิวได้ (security M2)
       b.qty_per_piece, b.position_note, i.is_active as item_active
  from analytics.product_gem_bom b
  join public.product p on p.id = b.product_id
  join analytics.gem_item i on i.id = b.gem_item_id and i.shop_id = b.shop_id
  join analytics.gem_type t on t.id = i.gem_type_id and t.shop_id = i.shop_id
  join analytics.gem_shape s on s.id = i.gem_shape_id and s.shop_id = i.shop_id;

create or replace view analytics.v_job_gem_requirement as
select g.shop_id, g.job_id, j.job_no, j.status as job_status, j.qty_planned, g.line_seq, g.gem_item_id,
       ci.id as canonical_item_id, t.name as type_name, s.name as shape_name, ci.size_label,
       g.gem_label, g.qty_per_piece, g.qty_per_piece::bigint * j.qty_planned as qty_total, g.position_note,
       (select s2.status from analytics.job_stage s2 where s2.job_id = j.id and s2.stage_code = 'gem_set' limit 1) as gem_set_status
  from analytics.job_gem_bom g
  join analytics.job j on j.id = g.job_id and j.shop_id = g.shop_id
  join analytics.gem_item gi on gi.id = g.gem_item_id and gi.shop_id = g.shop_id
  join analytics.gem_item ci on ci.id = coalesce(gi.merged_into, gi.id) and ci.shop_id = g.shop_id   -- ห่วงโซ่ merged_into ถูกยุบเหลือชั้นเดียวเสมอ (security M2: ไม่เรียก gem_item_canonical ในวิว)
  join analytics.gem_type t on t.id = ci.gem_type_id and t.shop_id = ci.shop_id
  join analytics.gem_shape s on s.id = ci.gem_shape_id and s.shop_id = ci.shop_id;

-- ============================================================================
-- 9. seed รูปทรงมาตรฐานของทุกร้านที่มีอยู่ (ไม่ seed ชนิด · ไม่ seed ราคา — มติ 21 ต.ค.) — ร้านใหม่ได้ผ่าน gem_shape_ensure ตอนแรกที่แตะแคตตาล็อก
-- ============================================================================
do $s$
declare r record;
begin
  for r in select id from public.shop loop
    perform analytics.gem_shape_ensure(r.id);
  end loop;
end;
$s$;

-- ============================================================================
-- 10. สิทธิ์ — service_role เท่านั้น (migration-traps ข้อ 2, 7, 18) · ปิดทุกอย่างก่อนแล้วเปิดเฉพาะที่ตั้งใจ
--     🔴 gem_item_price: ไม่ให้ role ฝั่งแอป (anon/authenticated/service_role) อ่านตรง (ราคา = ต้นทุน) — อ่านผ่าน RPC ออฟฟิศ 3 ตัวที่ตรวจ actor owner/admin เท่านั้น
-- ============================================================================
revoke all on analytics.gem_shape, analytics.gem_type, analytics.gem_item, analytics.gem_item_price, analytics.gem_item_price_audit, analytics.gem_catalog_event,
              analytics.product_gem_bom, analytics.job_gem_bom, analytics.v_product_gem_bom, analytics.v_job_gem_requirement
  from public, anon, authenticated, service_role;
grant select on analytics.gem_shape, analytics.gem_type, analytics.gem_item, analytics.gem_catalog_event,
                analytics.product_gem_bom, analytics.job_gem_bom, analytics.v_product_gem_bom, analytics.v_job_gem_requirement
  to service_role;

do $g$
declare
  r record;
  v_rpc constant text[] := array[
    'gem_options_list', 'gem_catalog_list', 'gem_catalog_create', 'gem_item_create', 'gem_catalog_rename', 'gem_shape_set_has_length',
    'gem_merge_preview', 'gem_merge', 'gem_catalog_set_active', 'gem_catalog_remove', 'gem_price_set', 'gem_price_history',
    'product_gem_bom_get', 'product_gem_bom_set', 'product_gem_bom_from_job', 'job_gem_bom_get', 'job_gem_bom_set',
    'job_create_from_quote_item', 'job_create_from_production_item', 'job_plan_suggest', 'job_worker_resolve', 'job_gem_state'];
  v_internal constant text[] := array[
    'gem_name_norm', 'gem_name_lev', 'gem_name_similar', 'gem_name_ok', 'gem_size_label', 'gem_label_compose', 'gem_line_fail', 'gem_name_clean',
    'gem_type_guard', 'gem_shape_guard', 'gem_item_guard', 'gem_item_live', 'product_gem_bom_guard', 'job_gem_bom_guard',
    'gem_shape_ensure', 'gem_type_canonical', 'gem_shape_canonical', 'gem_item_canonical', 'gem_item_json', 'gem_num_parse', 'gem_int_parse',
    'gem_require_office', 'gem_lines_prepare', 'job_gem_edit_window', 'job_gem_bom_replace_core', 'gem_merge_check', 'gem_merge_plan', 'gem_similar_hits',
    'job_source_info', 'job_create_insert', 'job_create_from_production_item_core'];
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
  -- ห้ามมี overload (ข้อ 1)
  select string_agg(proname, ', ') into v_dup from (
    select proname from pg_proc where pronamespace = 'analytics'::regnamespace and (proname = any (v_rpc) or proname = any (v_internal))
    group by proname having count(*) > 1) d;
  if v_dup is not null then
    raise exception '0190: พบ overload ของฟังก์ชัน: %', v_dup;
  end if;
  select count(distinct proname) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and (proname = any (v_rpc) or proname = any (v_internal));
  if v_n <> cardinality(v_rpc) + cardinality(v_internal) then
    raise exception '0190: ฟังก์ชันที่ประกาศ % ตัว แต่พบใน pg_proc % ชื่อ', cardinality(v_rpc) + cardinality(v_internal), v_n;
  end if;
end;
$g$;

comment on table analytics.gem_item_price is
  '0190: ราคาพลอยต่อเม็ด (THB · ทศนิยม ≤ 4) = ต้นทุน — ไม่ให้ role ฝั่งแอป (anon/authenticated/service_role) อ่านตรง · อ่าน/เขียนผ่าน gem_catalog_list / gem_price_set / gem_price_history เท่านั้น (ตรวจ actor owner/admin) · ห้าม join จาก RPC ช่าง/ผู้จัดการ/resolve/print';
comment on table analytics.gem_item_price_audit is
  '0190: audit การแก้ราคาพลอย (old/new/note/actor) — append-only · เขียนโดย gem_price_set เท่านั้น · อ่านผ่าน gem_price_history · สิทธิ์ชุดเดียวกับ gem_item_price';
comment on table analytics.job_gem_bom is
  '0190: พลอยต่อใบงาน (ใบแม่) — gem_label = snapshot ณ ตอนสั่ง (merge/rename ไม่แตะ) · qty_total คำนวณตอนอ่าน = qty_per_piece × job.qty_planned · แก้ผ่าน job_gem_bom_replace_core เท่านั้น (ใบ done/cancelled แก้ไม่ได้)';
comment on table analytics.product_gem_bom is
  '0190: แม่แบบพลอยของ SKU — ค่าเริ่มของใบที่เปิดใหม่ (ใบเดิมไม่เปลี่ยน) · แก้ผ่าน product_gem_bom_set · gem_merge ย้ายอ้างอิงตามให้';
comment on table analytics.gem_type is
  '0190: ชนิดพลอย — พิมพ์ใหม่ได้ตอนบันทึกใบ/BOM (get-or-create ด้วย name_norm) · รวมชื่อ (merged_into) ย้อนกลับไม่ได้ · ไม่ seed';
comment on table analytics.gem_shape is
  '0190: รูปทรงพลอย — seed 12 มาตรฐาน (is_seed) + เพิ่มเองได้ · has_length (ขนาด 1/2 ค่า) แก้ไม่ได้เมื่อมีรายการใช้';
comment on table analytics.gem_item is
  '0190: 1 แถว = ชนิด+รูปทรง+ขนาด มม. ที่สั่งซื้อได้ (size_a ≤ size_b) · ราคาอยู่ gem_item_price · merged_into = ถูกรวมเข้ารายการอื่น (ใบเก่ายังอ้าง id นี้)';

-- ============================================================================
-- 11. post-check: ไม่แตะของเดิมนอกรายการ · ข้อมูลเดิมไม่ขยับ · golden job_source_info เท่าเดิม · สิทธิ์ปิด · seed ครบ
-- ============================================================================
do $c$
declare
  v_changed text;
  v_new text;
  v_bad int;
  v_touched constant text[] := array['job_source_info', 'job_plan_suggest', 'job_create_insert', 'job_create_from_quote_item', 'job_create_from_production_item',
                                     'job_create_from_production_item_core', 'job_worker_resolve'];
  v_added constant text[] := array[
    'gem_name_norm', 'gem_name_lev', 'gem_name_similar', 'gem_name_ok', 'gem_size_label', 'gem_label_compose', 'gem_line_fail', 'gem_name_clean',
    'gem_type_guard', 'gem_shape_guard', 'gem_item_guard', 'gem_item_live', 'product_gem_bom_guard', 'job_gem_bom_guard',
    'gem_shape_ensure', 'gem_type_canonical', 'gem_shape_canonical', 'gem_item_canonical', 'gem_item_json', 'gem_num_parse', 'gem_int_parse',
    'gem_require_office', 'gem_lines_prepare', 'job_gem_edit_window', 'job_gem_bom_replace_core', 'gem_merge_check', 'gem_merge_plan', 'gem_similar_hits', 'job_gem_state',
    'gem_options_list', 'gem_catalog_list', 'gem_catalog_create', 'gem_item_create', 'gem_catalog_rename', 'gem_shape_set_has_length',
    'gem_merge_preview', 'gem_merge', 'gem_catalog_set_active', 'gem_catalog_remove', 'gem_price_set', 'gem_price_history',
    'product_gem_bom_get', 'product_gem_bom_set', 'product_gem_bom_from_job', 'job_gem_bom_get', 'job_gem_bom_set'];
  v_tbl text;
  r record;
  v_cur text;
  v_tpl_nonzero int := 0;
begin
  -- (1) ฟังก์ชันเดิมนอกรายการ md5 ต้องเท่าเดิมเป๊ะ (รวม production_order_done · job_stage_suggest · job_worker_open)
  select string_agg(b.sig, ', ') into v_changed
    from _m190_fn_base b
    left join pg_proc p on p.oid = to_regprocedure(b.sig)
   where b.proname <> all (v_touched) and (p.oid is null or md5(pg_get_functiondef(p.oid)) <> b.h);
  if v_changed is not null then
    raise exception '0190 แตะฟังก์ชันเดิมนอกรายการ (md5 ไม่เท่า/หาย): %', v_changed;
  end if;
  -- (2) ที่ replace มีเครื่องหมาย 0190 จริง · ฟังก์ชันใหม่ = รายการที่ประกาศเท่านั้น
  select string_agg(t, ', ') into v_changed from unnest(v_touched) t
   where not exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = t and position('0190' in pg_get_functiondef(p.oid)) > 0);
  if v_changed is not null then
    raise exception '0190: ยังไม่ใช่ฉบับ 0190: %', v_changed;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_new
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
     and not exists (select 1 from _m190_fn_base b where b.sig = p.oid::regprocedure::text)
     and not (p.proname = any (v_added) or p.proname = any (v_touched));
  if v_new is not null then
    raise exception '0190: มีฟังก์ชันใหม่นอกรายการที่ประกาศ: %', v_new;
  end if;
  -- (3) แถวเดิมไม่ขยับ — ไฟล์นี้ไม่มี UPDATE/INSERT ตารางเหล่านี้
  select string_agg(b.t, ', ') into v_changed
    from _m190_row_base b
    join (select 'job'::text as t, count(*) as n, coalesce(md5(string_agg(j::text, '|' order by j.id)), '') as h from analytics.job j
          union all select 'job_stage', count(*), coalesce(md5(string_agg(s::text, '|' order by s.id)), '') from analytics.job_stage s
          union all select 'job_event', count(*), coalesce(md5(string_agg(e::text, '|' order by e.id)), '') from analytics.job_event e
          union all select 'job_token', count(*), coalesce(md5(string_agg(k.id::text || coalesce(k.revoked_at::text, ''), '|' order by k.id)), '') from analytics.job_token k
          union all select 'job_counter', count(*), coalesce(md5(string_agg(c::text, '|' order by c::text)), '') from analytics.job_counter c
          union all select 'production_order', count(*), coalesce(md5(string_agg(po::text, '|' order by po.id)), '') from analytics.production_order po
          union all select 'production_order_item', count(*), coalesce(md5(string_agg(pi::text, '|' order by pi.id)), '') from analytics.production_order_item pi
          union all select 'worker', count(*), coalesce(md5(string_agg(w::text, '|' order by w.id)), '') from analytics.worker w
          union all select 'product', count(*), coalesce(md5(string_agg(pr::text, '|' order by pr.id)), '') from public.product pr
          union all select 'oem_quote_item', count(*), coalesce(md5(string_agg(q::text, '|' order by q.id)), '') from analytics.oem_quote_item q) a on a.t = b.t
   where a.n <> b.n or a.h <> b.h;
  if v_changed is not null then
    raise exception '0190: แถวเดิมขยับในตาราง: %', v_changed;
  end if;
  -- (4) golden: job_source_info ของทุกรายการจริง (OEM + ใบผลิต) เท่าเดิมเมื่อไม่มีแม่แบบพลอย (ตัด key ใหม่ gem_template_count ที่ต้องเป็น 0) — error ก็ต้องเหมือนเดิม
  -- รันซ้ำ (ฟังก์ชันเป็นฉบับ 0190 อยู่แล้ว) → baseline มี key gem_template_count แล้ว: ตัดออกจากทั้งสองฝั่งก่อนเทียบ · เช็ค "แม่แบบ = 0" เฉพาะรอบแรก (รอบหลังมีแม่แบบจริงได้ ขั้นฝังที่เสนอก็เปลี่ยนตามอย่างตั้งใจ — baseline รอบหลังจึงเท่ากับผลปัจจุบันเสมอ)
  for r in select kind, item_id, shop_id, case when res like 'ERR:%' then res else ((res::jsonb) - 'gem_template_count')::text end as res from _m190_src loop
    begin
      if (analytics.job_source_info(r.shop_id, r.kind, r.item_id) ->> 'gem_template_count') is distinct from '0' then
        v_tpl_nonzero := v_tpl_nonzero + 1;
      end if;
      v_cur := ((analytics.job_source_info(r.shop_id, r.kind, r.item_id)) - 'gem_template_count')::text;
    exception when others then
      v_cur := 'ERR:' || sqlstate || ':' || sqlerrm;
    end;
    if v_cur is distinct from r.res then
      raise exception '0190: golden job_source_info เปลี่ยน (% %): ก่อน % · หลัง %', r.kind, r.item_id, left(r.res, 300), left(v_cur, 300);
    end if;
  end loop;
  if v_tpl_nonzero > 0 and (select first from _m190_first) then
    raise exception '0190: gem_template_count ต้องเป็น 0 ทุกรายการ (ยังไม่มีแม่แบบพลอย) แต่พบ % รายการ', v_tpl_nonzero;
  end if;
  -- (5) ตารางใหม่: RLS เปิด ไม่มี policy · ไม่มีสิทธิ์ anon/authenticated · ราคาไม่ให้ role ฝั่งแอป (anon/authenticated/service_role) อ่านตรง · trigger ครบ
  foreach v_tbl in array array['gem_shape', 'gem_type', 'gem_item', 'gem_item_price', 'gem_item_price_audit', 'gem_catalog_event', 'product_gem_bom', 'job_gem_bom'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('analytics.' || v_tbl)::regclass)
       or exists (select 1 from pg_policy where polrelid = ('analytics.' || v_tbl)::regclass) then
      raise exception '0190: % ต้องเปิด RLS และไม่มี policy', v_tbl;
    end if;
    if has_table_privilege('anon', 'analytics.' || v_tbl, 'select') or has_table_privilege('authenticated', 'analytics.' || v_tbl, 'select')
       or has_table_privilege('service_role', 'analytics.' || v_tbl, 'insert') or has_table_privilege('service_role', 'analytics.' || v_tbl, 'update')
       or has_table_privilege('service_role', 'analytics.' || v_tbl, 'delete') or has_table_privilege('service_role', 'analytics.' || v_tbl, 'truncate') then
      raise exception '0190: สิทธิ์ % ผิด (ต้อง service_role select อย่างเดียว)', v_tbl;
    end if;
  end loop;
  if has_table_privilege('service_role', 'analytics.gem_item_price_audit', 'select') or has_table_privilege('authenticated', 'analytics.gem_item_price_audit', 'select') or has_table_privilege('anon', 'analytics.gem_item_price_audit', 'select') then
    raise exception '0190: gem_item_price_audit ต้องไม่มีสิทธิ์อ่านตรงของ role ฝั่งแอป';
  end if;
  if has_table_privilege('service_role', 'analytics.gem_item_price', 'select') or has_table_privilege('service_role', 'analytics.gem_item_price', 'references') then
    raise exception '0190: gem_item_price ต้องไม่ให้ role ฝั่งแอป (anon/authenticated/service_role) อ่านตรง (รวม service_role)';
  end if;
  if has_table_privilege('anon', 'analytics.v_job_gem_requirement', 'select') or has_table_privilege('authenticated', 'analytics.v_job_gem_requirement', 'select')
     or has_table_privilege('anon', 'analytics.v_product_gem_bom', 'select') or has_table_privilege('authenticated', 'analytics.v_product_gem_bom', 'select') then
    raise exception '0190: view พลอยเปิดให้ anon/authenticated';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'analytics' and table_name in ('v_job_gem_requirement', 'v_product_gem_bom') and column_name ~* '(price|cost|thb|supplier)') then
    raise exception '0190: view พลอยมีคอลัมน์ที่ดูเป็นราคา/ต้นทุน';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_new
    from pg_proc p cross join lateral aclexplode(p.proacl) a
   where p.pronamespace = 'analytics'::regnamespace and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  if v_new is not null then
    raise exception '0190: พบฟังก์ชันในสคีมา analytics ที่ PUBLIC/anon/authenticated ถือ EXECUTE: %', v_new;
  end if;
  -- (6) seed: ทุกร้านมีรูปทรง seed 12 แบบ · ไม่มีชนิด/ราคา/BOM
  select count(*) into v_bad from public.shop s where (select count(*) from analytics.gem_shape g where g.shop_id = s.id and g.is_seed) <> 12;
  if v_bad > 0 then
    raise exception '0190: มีร้าน % ร้านที่รูปทรง seed ไม่ครบ 12', v_bad;
  end if;
  if (select first from _m190_first) and (exists (select 1 from analytics.gem_type) or exists (select 1 from analytics.gem_item) or exists (select 1 from analytics.gem_item_price) or exists (select 1 from analytics.job_gem_bom) or exists (select 1 from analytics.product_gem_bom) or exists (select 1 from analytics.gem_item_price_audit)) then
    raise exception '0190: ต้องไม่มีชนิด/รายการ/ราคา/BOM หลัง apply (ไม่ seed)';
  end if;
  -- (7) trigger guard ครบ
  if (select count(*) from pg_trigger t where t.tgrelid in ('analytics.gem_shape'::regclass, 'analytics.gem_type'::regclass, 'analytics.gem_item'::regclass,
        'analytics.product_gem_bom'::regclass, 'analytics.job_gem_bom'::regclass) and not t.tgisinternal and t.tgenabled in ('O', 'A') and t.tgname like '%\_guard') <> 5 then
    raise exception '0190: trigger guard ของตารางพลอยต้องครบ 5 ตัวและเปิดอยู่';
  end if;
  raise notice '0190: ฟังก์ชันเดิม % ตัว md5 เท่าเดิมทั้งหมด (ยกเว้น % ตัวที่ replace) · ฟังก์ชันใหม่ % ตัว · golden job_source_info % รายการเท่าเดิม · รูปทรง seed 12/ร้าน',
    (select count(*) from _m190_fn_base) - (select count(*) from _m190_fn_base where proname = any (v_touched)), cardinality(v_touched), cardinality(v_added), (select count(*) from _m190_src);
end;
$c$;

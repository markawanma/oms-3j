-- 0186_production_item_metal.sql — PM-A: รายการในใบผลิตเข้าสต็อกเลือก โลหะ · เนื้อ % · น้ำหนัก/ชิ้น ได้ (เหมือนหน้าผลิต OEM) + รายการที่ยังไม่มี SKU + ราคาทอง/ทองเหลืองต่อโลหะ  💰
-- สถานะ: ยังไม่ apply · dry-run เท่านั้นจนกว่า security ผ่าน · apply ด้วย node scripts/run-sql.mjs --commit --record เท่านั้น (🔴 ห้าม supabase db push)
-- ชุดทดสอบ: scripts/verify/verify-0186.sql (รันหลัง apply) · golden replay ฝังอยู่ในไฟล์นี้ (ท้ายไฟล์ §13) — ล้ม = raise = ทั้งไฟล์ถอยหมด
-- design: docs/3j-jewelry/oms/design-production-item-metal.md (§2 §6 §7.1) · UX: docs/3j-jewelry/oms/ux-production-metal-and-shop-intake.md (ส่วน A · §C.2.1 · §C.3 R3/R4/R5)
--
-- ทำไม (ภาษาคน): เจ้าของ 19 ต.ค. — "ใบผลิตในบ้านไม่มีให้เลือกประเภทโลหะเลย ทำไมไม่ทำให้เหมือนหน้า OEM" · ก่อนไฟล์นี้ โลหะของใบงานจากใบผลิตอ่านจาก SKU (fixed/spot = เงินเสมอ)
--   ⇒ ผลิตทอง/ทองเหลืองเข้าสต็อกไม่ได้ · ต้นทุน spot/spec คิดจากน้ำหนักเงินใน SKU เท่านั้น · ไม่มีทางเปิดรายการที่ยังไม่มีรหัสสินค้า (งานจากหน้างาน W1)
--
-- สิ่งที่ไฟล์นี้ทำ
--  1. oem_metal_price: ช่วงราคา sanity ที่เจ้าของเคาะ 20 ต.ค. (ทอง 100% 2,000–8,000 บาท/กรัม · ทองเหลือง 100–1,000 บาท/กก. = 0.10–1.00 บาท/กรัม) ทั้งใน RPC และ CHECK ของตาราง
--     + คอลัมน์ input_value/input_unit (R4) + RPC oem_metal_price_set_input (ผู้ใช้กรอก "ราคาสมาคม ทองคำแท่ง 96.5% ขายออก บาทละ" ÷15.244 ÷0.965 หรือ ทองเหลือง บาท/กก. ÷1,000 — DB เป็นผู้ตัดสิน)
--  2. production_order_item: product_id nullable + pending_product_label + metal/purity/weight_g/weight_source (+ CHECK ครบ + unique ชื่อซ้ำในใบเดียว)
--  3. helper production_item_spec(poi, p) — ค่า effective (โลหะ/เนื้อ/น้ำหนัก) จุดเดียวที่ preview/done/job/view ใช้
--  4. production_metal_price_resolve (ราคาโลหะของ "วันนี้ไทย" ต่อโลหะ · ไม่ fallback) · production_spot_resolve เป็น wrapper เงินเดิม
--  5. production_cost_calc รับ metal/purity/weight จากผู้เรียก · production_order_preview คืน metal_prices + missing_prices (R3) ·
--     production_order_done รับ p_expected_metal_prices (fail-closed ต่อโลหะ) + sku_required + stamp ค่า effective ลง item
--  6. production_order_item_set รับ SKU หรือชื่อแบบ + metal/purity/weight (+ ล็อกโลหะเมื่อมีใบงาน) · production_order_item_remove_by_id · production_item_prefill (metal_known)
--  7. job_source_info (branch production) อ่านโลหะ/น้ำหนักจาก helper + รองรับรายการไม่มี SKU · ปิดช่อง fallback เงียบของแบบทอง 2 ชั้น: job_profile_default_for ทองไม่มีแบบทอง = null (§13b — ต้นทางของหน้าสร้างใบงาน) + job_create_insert ⇒ no_gold_profile
--  8. v_production_order_item: left join product + ต่อท้ายคอลัมน์ (42P16: เฉพาะต่อท้าย)
--
-- โมเดล/การตัดสินใจ (เหตุผล)
--  • DB เป็นผู้ตัดสินตัวเลขเงิน (oem-quote-invariants ข้อ 2): การแปลง ราคาสมาคม→ต่อกรัม 100% อยู่ใน DB (oem_metal_price_convert) · TS มีสำเนา pure สำหรับ preview เท่านั้น (lib/oem/metal-price.ts)
--    และมีเทสต์ที่อ่านไฟล์นี้เทียบค่าคงที่ 15.244 / 0.965 / ช่วงราคา กัน 2 ที่เพี้ยนจากกัน
--  • ด่านช่วงตรวจที่ค่า "ต่อกรัม" ที่แปลงแล้วก่อนปัด (ทอง) / ที่ค่าก่อนหาร 1,000 (ทองเหลือง: 99.99 และ 1,000.01 บาท/กก. ปัด 4 ตำแหน่งแล้วหลุดเข้าช่วง จึงต้องเช็คก่อนปัด)
--  • R4 เก็บ input_value/input_unit: ประวัติ/ตรวจย้อนหลังเห็น "กรอก 41,250 บาทละ" ไม่ใช่แค่ต่อกรัม · RPC ต่อกรัมตรง (oem_metal_price_set) ล้างคู่นี้เป็น null เสมอ (ไม่ให้คู่ค้างอยู่ข้างค่าใหม่)
--  • R3: preview ของทอง/ทองเหลืองที่ "ไม่มีราคาวันนี้" ไม่ raise — คืน missing_prices ให้ UI ขึ้นเช็คลิสต์ (done ยัง fail-closed) · ของเงินยัง raise เหมือนเดิมทุกประการ (UI เดิมพึ่งข้อความนั้น)
--  • preview resolve ราคาตามโลหะที่ "ใช้จริง" (spot/spec และ qty_used > 0) เหมือน done — ของเดิม preview resolve เมื่อมี spot/spec แม้ qty=0 ทุกบรรทัด (ต่างเฉพาะกรณีขอบ qty=0 ทั้งใบ)
--  • helper ใช้ค่าเดิมของ SKU เมื่อรายการไม่มีค่า (ใบเดิม/แถวเดิม metal null) ⇒ เงินเดิมได้เลขเดิมเป๊ะ · แถวใหม่ item_set เติมค่า effective ลงแถวเสมอ · done stamp ค่า effective ลงแถว (snapshot ครบ)
--  • ทองเหลืองเนื้อล็อก 100% (CHECK + RPC) · ทองไม่มี default เนื้อ (บังคับกรอก)
--  • รายการไม่มี SKU ต้องระบุโลหะ (ไม่เดา) · เปลี่ยนโลหะไม่ได้เมื่อมีใบงานไม่ยกเลิกผูก (RPC บอกเลขใบงาน + trigger กันทางอื่น)
--  • ไม่เขียนกลับ product (ชื่อแบบ/เนื้อ/น้ำหนักอยู่ที่รายการ) · v_dim_product ไม่แตะ · oem_cost_calc ไม่แตะ
--
-- 🔴 ลอก definition สดจาก DB (pg_get_functiondef 20 ต.ค. 69) ทุกฟังก์ชันที่ replace — job_source_info เป็นฉบับหลัง 0181 + 0184 (finish/buff) · pre-check §0 เช็ค token ของฉบับที่ลอกมา
-- 🔴 สิทธิ์: analytics = service_role เท่านั้น (ข้อ 18) · drop signature เดิม + re-grant ทุกตัว · §15 นับ pg_proc = 1 แถว/ชื่อ + ตรวจ has_function_privilege
-- 🔴 ไฟล์ไม่ idempotent โดยตั้งใจ: golden replay ต้องรันฟังก์ชันเดิม (rename เป็น *_legacy186 ชั่วคราว) — รันซ้ำหลัง apply จะถูก §0 ปฏิเสธ
-- 🔴 deploy: signature ของ production_order_done เปลี่ยน (p_expected_spot_thb_per_gram → p_expected_metal_prices) — apply + merge โค้ดรอบเดียวกัน (โค้ดเดิม PGRST202 ถ้าสลับ · บทเรียน 0132)

-- ============================================================================
-- §0 pre-check + snapshot ก่อนแตะอะไร
-- ============================================================================
do $pre$
declare
  v_def text;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'analytics' and table_name = 'production_order_item' and column_name = 'metal') then
    raise exception '0186: production_order_item.metal มีอยู่แล้ว — apply ไปแล้วหรือไม่? (ไฟล์นี้ไม่ idempotent: golden replay ต้องใช้ฟังก์ชันเดิม)';
  end if;

  select pg_get_functiondef(to_regprocedure('analytics.production_cost_calc(uuid,uuid,numeric,integer,boolean)')) into v_def;
  if v_def is null or position('p_spot_price_thb_per_gram' in v_def) = 0 then
    raise exception '0186 pre-check: production_cost_calc ไม่ใช่ฉบับ 5-arg ที่ลอกมา (0141/0142) — หยุด ตรวจ DB ก่อน';
  end if;
  select pg_get_functiondef(to_regprocedure('analytics.production_order_done(uuid,uuid,jsonb,numeric,uuid)')) into v_def;
  if v_def is null or position('p_expected_spot_thb_per_gram' in v_def) = 0 then
    raise exception '0186 pre-check: production_order_done ไม่ใช่ฉบับ 0141 ที่ลอกมา — หยุด ตรวจ DB ก่อน';
  end if;
  select pg_get_functiondef(to_regprocedure('analytics.production_order_preview(uuid,uuid,jsonb)')) into v_def;
  if v_def is null or position('v_needs_spot' in v_def) = 0 then
    raise exception '0186 pre-check: production_order_preview ไม่ใช่ฉบับ 0141 ที่ลอกมา — หยุด ตรวจ DB ก่อน';
  end if;
  if to_regprocedure('analytics.production_order_item_set(uuid,uuid,uuid,integer,boolean)') is null then
    raise exception '0186 pre-check: ไม่พบ production_order_item_set 5-arg (0144) — หยุด ตรวจ DB ก่อน';
  end if;
  if to_regprocedure('analytics.production_spot_resolve(uuid,numeric)') is null then
    raise exception '0186 pre-check: ไม่พบ production_spot_resolve (0131) — หยุด';
  end if;
  select pg_get_functiondef(to_regprocedure('analytics.job_source_info(uuid,text,uuid)')) into v_def;
  if v_def is null
     or position((quote_literal('finish') || ', ' || quote_literal('buff')) in v_def) = 0
     or position('parent_job_id is null' in v_def) = 0
     or position(quote_literal('polish') in v_def) > 0 then
    raise exception '0186 pre-check: job_source_info ไม่ใช่ฉบับหลัง 0181+0184 (finish/buff + parent_job_id) — ลอกผิดฉบับ = ใบใหม่ไม่มีขั้นแต่ง/ขัด — หยุด';
  end if;
  select pg_get_functiondef(to_regprocedure('analytics.job_create_insert(uuid,text,uuid,uuid,integer,uuid,uuid,text,text,text,integer,date,text,text,text[],boolean,uuid,integer,numeric,jsonb,uuid)')) into v_def;
  if v_def is null or position('job_profile_default_for' in v_def) = 0 or position('no_gold_profile' in v_def) > 0 then
    raise exception '0186 pre-check: job_create_insert ไม่ใช่ฉบับที่ลอกมา (0176+) — หยุด';
  end if;
  select pg_get_functiondef(to_regprocedure('analytics.job_profile_default_for(uuid,text)')) into v_def;
  if v_def is null or position('p_metal = ''gold'' and p.is_default_gold' in v_def) = 0 or position('case when' in v_def) > 0 then
    raise exception '0186 pre-check: job_profile_default_for ไม่ใช่ฉบับ 0176 (fallback ทองไปแบบทั่วไป) ที่ลอกมา — หยุด';
  end if;
  select pg_get_functiondef(to_regprocedure('analytics.oem_metal_price_set(uuid,text,numeric,date,text)')) into v_def;
  if v_def is null or position('p_price > 0' in v_def) = 0 then
    raise exception '0186 pre-check: oem_metal_price_set ไม่ใช่ฉบับ 0129 ที่ลอกมา — หยุด';
  end if;
  if to_regprocedure('analytics.production_order_item_derive_shop()') is null or to_regprocedure('analytics.production_order_item_deny_mutation()') is null then
    raise exception '0186 pre-check: ไม่พบ trigger function ของ production_order_item — หยุด';
  end if;
end;
$pre$;

-- snapshot ก่อนแตะ (เทียบท้ายไฟล์ §13: product / v_dim_product / สต็อก / สถานะใบ ต้องไม่ขยับแม้ golden จะจำลอง done ในทรานแซกชันย่อย)
create temp table _m186_base on commit drop as
  select
    (select coalesce(md5(string_agg(p::text, '|' order by p.id)), '') from public.product p) as product_md5,
    (select coalesce(md5(string_agg(v.product_id::text || ':' || coalesce(v.effective_unit_cost::text, 'NULL'), ',' order by v.product_id)), '') from analytics.v_dim_product v) as dim_md5,
    (select count(*) from analytics.stock_lot) as lot_n,
    (select coalesce(md5(string_agg(cs::text, '|' order by cs.product_id)), '') from public.central_stock cs) as stock_md5,
    (select count(*) from public.stock_ledger) as ledger_n,
    (select coalesce(md5(string_agg(po.id::text || ':' || po.status, ',' order by po.id)), '') from analytics.production_order po) as po_status_md5,
    -- jsonb (ไม่ใช่ row text): ท้ายไฟล์เทียบหลังเพิ่มคอลัมน์ใหม่ 5 ตัว — ตัดคีย์ใหม่ออกแล้วต้องเท่าเดิมเป๊ะทุกแถว (ไม่ UPDATE แถวเดิม)
    (select coalesce(md5(string_agg(to_jsonb(poi)::text, '|' order by poi.id)), '') from analytics.production_order_item poi) as poi_md5,
    (select coalesce(md5(string_agg(j::text, '|' order by j.id)), '') from analytics.job j) as job_md5;

-- ============================================================================
-- §1 ช่วงราคาโลหะ + ตัวแปลงราคา (หน่วยทุกค่า = บาทต่อกรัม ของโลหะ "บริสุทธิ์ 100%" — ตรงสูตร weight × purity × price ของ oem_cost_calc)
-- ============================================================================
-- ช่วงที่เจ้าของเคาะ 20 ต.ค. 69 ("ใช้ที่เสนอ"): ทอง 100% 2,000–8,000 บาท/กรัม · ทองเหลือง 100–1,000 บาท/กก. ⇒ DB เก็บต่อกรัม = 0.10–1.00 · เงิน 5–500 (เดิม)
-- ห้ามอนุมานหน่วยใหม่จากตัวเลข: ทองเหลือง "บาท/กก." กับ "บาท/กรัม" ต่างกัน 1,000 เท่า — ชื่อหน่วยอยู่ใน input_unit ของตาราง
create or replace function analytics.oem_metal_price_range_ok(p_metal text, p_price numeric)
 returns boolean
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $fn$
  -- not-between style: null/NaN/Infinity ตกเป็น false (3j-migration-traps ข้อ 4)
  select p_price is not null and case p_metal
    when 'silver' then (p_price >= 5 and p_price <= 500)
    when 'gold'   then (p_price >= 2000 and p_price <= 8000)
    when 'brass'  then (p_price >= 0.10 and p_price <= 1.00)
    else false end
$fn$;
revoke execute on function analytics.oem_metal_price_range_ok(text, numeric) from public, anon, authenticated;
grant execute on function analytics.oem_metal_price_range_ok(text, numeric) to service_role;

-- แปลงค่าที่ผู้ใช้กรอก → บาท/กรัม โลหะ 100% (ยังไม่ปัด · ผู้เรียกปัด 4 ตำแหน่งตาม numeric(14,4) หลังตรวจช่วง)
--   gold  + 'assoc965_sell_per_baht' : ราคาสมาคม ทองคำแท่ง 96.5% ฝั่ง "ขายออก" บาทละ (เจ้าของ 20 ต.ค.) ÷ (15.244 กรัม/บาท × 0.965)
--   brass + 'thb_per_kg'              : บาท/กก. ÷ 1,000
create or replace function analytics.oem_metal_price_convert(p_metal text, p_input_value numeric, p_input_unit text)
 returns numeric
 language plpgsql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $fn$
declare
  c_gram_per_baht constant numeric := 15.244;  -- 1 บาททองคำ = 15.244 กรัม
  c_assoc_purity  constant numeric := 0.965;   -- ทองคำแท่งสมาคม 96.5%
begin
  if p_input_value is null or not (p_input_value > 0 and p_input_value < 100000000) then
    raise exception 'ราคาที่กรอกต้องเป็นตัวเลขมากกว่า 0' using errcode = '22023', hint = 'metal_price_input_invalid';
  end if;
  if p_input_value <> round(p_input_value, 2) then
    raise exception 'ราคาที่กรอกทศนิยมไม่เกิน 2 ตำแหน่ง' using errcode = '22023', hint = 'metal_price_input_invalid';
  end if;
  if p_metal = 'gold' and p_input_unit = 'assoc965_sell_per_baht' then
    return p_input_value / (c_gram_per_baht * c_assoc_purity);
  elsif p_metal = 'brass' and p_input_unit = 'thb_per_kg' then
    return p_input_value / 1000;
  end if;
  raise exception 'หน่วยราคาไม่ตรงกับโลหะ (ทอง = ราคาสมาคมบาทละ · ทองเหลือง = บาท/กก.)' using errcode = '22023', hint = 'metal_price_unit_invalid';
end;
$fn$;
revoke execute on function analytics.oem_metal_price_convert(text, numeric, text) from public, anon, authenticated, service_role;

-- ============================================================================
-- §2 oem_metal_price: คอลัมน์ input_* (R4) + CHECK ช่วงราคาทอง/ทองเหลือง
--    ตรวจแล้ว: แถวทอง/ทองเหลือง 25 ส.ค. เดิมอยู่ในช่วงใหม่ (ทอง 4,736.0000 · ทองเหลือง 1.0000 = ขอบบนพอดี) ⇒ CHECK ผ่านโดยไม่ต้องแตะข้อมูล
-- ============================================================================
alter table analytics.oem_metal_price
  add column input_value numeric(14,2),
  add column input_unit text;

alter table analytics.oem_metal_price
  -- คู่ค่า/หน่วยต้องมาด้วยกันและตรงโลหะ — เขียนให้ทุกกิ่งเป็น true/false จริง (CHECK ที่ได้ null = ผ่าน ข้อ 13: unit null ทำให้ `metal = 'gold' and unit = ...` เป็น null แล้วหลุด)
  add constraint oem_metal_price_input_ck check (
    (input_value is null and input_unit is null)
    or (input_value is not null and input_unit is not null
        and input_value > 0 and input_value < 100000000
        and ((metal = 'gold' and input_unit = 'assoc965_sell_per_baht') or (metal = 'brass' and input_unit = 'thb_per_kg')))
  ),
  -- เงินยกเว้นโดยตั้งใจ: แถวเงินมาจากชีต/trigger (silver_spot_sync_from_history) หลายทาง และเคยมีค่าหลุดหน่วย (บั๊ก 1,097 ของ 17 ก.ย.) —
  -- CHECK บนตารางที่มีแถวเงินเดิมอาจตีตกการ sync ของระบบเอง/ทำให้ apply ล้มด้วยข้อมูลเก่า · เงินยังมีด่าน 5-500 ที่ RPC (oem_metal_price_set) และ resolve เหมือนเดิม
  add constraint oem_metal_price_range_ck check (
    metal = 'silver' or analytics.oem_metal_price_range_ok(metal, price_thb_per_gram)
  );

-- ============================================================================
-- §3 oem_metal_price_set (ลอกสด 0129) — เพิ่มด่านช่วงของทอง/ทองเหลือง · แถวที่เขียนตรงต่อกรัมล้าง input_* เป็น null
-- ============================================================================
create or replace function analytics.oem_metal_price_set(p_shop_id uuid, p_metal text, p_price numeric, p_as_of date default null::date, p_source text default 'manual'::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $fn$
declare
  v_today date;
  v_as_of date;
begin
  if p_shop_id is null or p_metal is null or p_price is null then
    raise exception 'oem_metal_price_set: p_shop_id, p_metal, p_price are required';
  end if;
  if p_metal not in ('silver', 'gold', 'brass') then
    raise exception 'oem_metal_price_set: p_metal must be silver/gold/brass';
  end if;

  if p_metal = 'silver' then
    if not (p_price >= 5 and p_price <= 500) then
      raise exception 'oem_metal_price_set: p_price must be between 5 and 500 (ต่อกรัม ไม่ใช่ต่อบาท — 1 บาท = 15.244 กรัม)';
    end if;
  else
    if not (p_price > 0) then
      raise exception 'oem_metal_price_set: p_price must be > 0';
    end if;
    -- 0186: ช่วงที่เจ้าของเคาะ 20 ต.ค. — หน่วย บาท/กรัม ของโลหะ 100% (ทองเหลือง 0.10-1.00 บาท/กรัม = 100-1,000 บาท/กก.)
    if not analytics.oem_metal_price_range_ok(p_metal, p_price) then
      raise exception 'oem_metal_price_set: ราคา% ต้องอยู่ระหว่าง % บาท/กรัม (โลหะ 100%%) — ค่าที่ส่งมา % อยู่นอกช่วง (ราคาสมาคมบาทละ/บาทต่อกก. ใช้ oem_metal_price_set_input)',
        case p_metal when 'gold' then 'ทอง' else 'ทองเหลือง' end,
        case p_metal when 'gold' then '2,000-8,000' else '0.10-1.00 (= 100-1,000 บาท/กก.)' end,
        p_price
        using errcode = '22023', hint = 'metal_price_range';
    end if;
  end if;

  if p_source not in ('manual', 'feed', 'sheet') then
    raise exception 'oem_metal_price_set: p_source must be manual/feed/sheet';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  v_today := (now() at time zone 'Asia/Bangkok')::date;
  v_as_of := coalesce(p_as_of, v_today);
  -- 0186 L1: ราคาทอง/ทองเหลืองลงวันอนาคตไม่ได้ (ไม่ใช่ราคาของวันนั้นจริง + ไปบังแถวของวันนั้นเมื่อถึงวัน) — ย้อนหลังยังทำได้ตามเดิม · เงินไม่แตะ (พฤติกรรมเดิม)
  if p_metal <> 'silver' and v_as_of > v_today then
    raise exception 'oem_metal_price_set: ราคา% ลงวันอนาคตไม่ได้ (วันที่ % เกินวันนี้ % — ใช้ได้เฉพาะวันนี้หรือย้อนหลัง)',
      case p_metal when 'gold' then 'ทอง' else 'ทองเหลือง' end, v_as_of, v_today
      using errcode = '22023', hint = 'as_of_future';
  end if;

  if p_metal = 'silver' then
    perform pg_advisory_xact_lock(hashtextextended('silver_spot:' || p_shop_id::text, 0));

    -- S2: source ที่ไม่ใช่ manual ห้ามทับ manual ของวันเดียวกัน (manual ชนะทั้งวัน)
    if p_source <> 'manual' and exists (
      select 1 from analytics.oem_metal_price
      where shop_id = p_shop_id and metal = 'silver' and as_of_date = v_as_of and source = 'manual'
    ) then
      raise exception 'oem_metal_price_set: shop_id=% มี manual entry ของวัน % อยู่แล้ว — manual ชนะทั้งวัน ไม่ให้ source=% ทับ',
        p_shop_id, v_as_of, p_source;
    end if;
  end if;

  -- 0186: ค่าต่อกรัมตรง = ไม่มีคู่ "ค่าที่ผู้ใช้กรอก" — ล้างทิ้ง (ไม่ให้ input_* ของค่าเก่าค้างข้างราคาใหม่)
  insert into analytics.oem_metal_price (shop_id, metal, as_of_date, price_thb_per_gram, source, updated_by, updated_at, input_value, input_unit)
  values (p_shop_id, p_metal, v_as_of, p_price, p_source, auth.uid(), now(), null, null)
  on conflict (shop_id, metal, as_of_date) do update set
    price_thb_per_gram = excluded.price_thb_per_gram, source = excluded.source,
    updated_by = auth.uid(), updated_at = now(), input_value = null, input_unit = null;

  if p_metal = 'silver' and v_as_of = v_today then
    -- Nit 2: ใช้ column default ของ blended_margin_pct/target_ad_gp_share
    insert into analytics.shop_setting as ss (
      shop_id, silver_spot_thb_per_gram, silver_spot_updated_at, updated_by, updated_at
    ) values (
      p_shop_id, p_price, now(), null, now()
    )
    on conflict (shop_id) do update set
      silver_spot_thb_per_gram = p_price,
      silver_spot_updated_at   = now(),
      updated_at               = now(),
      updated_by               = null;
  end if;
end;
$fn$;
revoke execute on function analytics.oem_metal_price_set(uuid, text, numeric, date, text) from public, anon, authenticated;
grant execute on function analytics.oem_metal_price_set(uuid, text, numeric, date, text) to service_role;

-- กรอกราคาทอง/ทองเหลืองด้วยหน่วยหน้างานจริง — DB แปลง ตรวจช่วง ปัด 4 ตำแหน่ง แล้วเก็บเป็นราคา "ของวันนี้ (เวลาไทย)" เท่านั้น (ไม่มีย้อนวัน)
-- คืนค่าที่เก็บจริง — หน้าจอต้องโชว์ค่านี้หลังบันทึก (ไม่ใช่ค่า preview ฝั่ง client)
create or replace function analytics.oem_metal_price_set_input(p_shop_id uuid, p_metal text, p_input_value numeric, p_input_unit text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $fn$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_exact numeric;
  v_price numeric;
begin
  if p_shop_id is null or p_metal is null or p_input_value is null or p_input_unit is null then
    raise exception 'oem_metal_price_set_input: p_shop_id, p_metal, p_input_value, p_input_unit are required';
  end if;
  if p_metal not in ('gold', 'brass') then
    raise exception 'กรอกด้วยราคาสมาคม/บาทต่อกก. ได้เฉพาะทองและทองเหลือง (เงินใช้ราคาต่อกรัมตามเดิม)' using errcode = '22023', hint = 'metal_price_unit_invalid';
  end if;
  -- แปลง (raise เองเมื่อค่า/หน่วยผิด) → ตรวจช่วงที่ค่า "ต่อกรัม ก่อนปัด" → ปัด 4 ตำแหน่งตามคอลัมน์ → ตรวจซ้ำที่ค่าที่จะเก็บ
  v_exact := analytics.oem_metal_price_convert(p_metal, p_input_value, p_input_unit);
  if not analytics.oem_metal_price_range_ok(p_metal, v_exact) then
    raise exception 'แปลงแล้วได้ % บาท/กรัม (โลหะ 100%%) อยู่นอกช่วงที่รับ % บาท/กรัม%',
      round(v_exact, 4),
      case p_metal when 'gold' then '2,000-8,000' else '0.10-1.00' end,
      case p_metal when 'gold' then ' — ตรวจว่ากรอก "ราคาบาทละ" ของทองคำแท่ง 96.5% ไม่ใช่ราคาต่อกรัม' else ' (= 100-1,000 บาท/กก. — กรอกเป็นบาทต่อกิโลกรัม ไม่ใช่ต่อกรัม)' end
      using errcode = '22023', hint = 'metal_price_range';
  end if;
  v_price := round(v_exact, 4);
  if not analytics.oem_metal_price_range_ok(p_metal, v_price) then
    raise exception 'ราคาที่จะเก็บ (% บาท/กรัม) อยู่นอกช่วงที่รับ', v_price using errcode = '22023', hint = 'metal_price_range';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  insert into analytics.oem_metal_price (shop_id, metal, as_of_date, price_thb_per_gram, source, updated_by, updated_at, input_value, input_unit)
  values (p_shop_id, p_metal, v_today, v_price, 'manual', auth.uid(), now(), p_input_value, p_input_unit)
  on conflict (shop_id, metal, as_of_date) do update set
    price_thb_per_gram = excluded.price_thb_per_gram, source = excluded.source,
    updated_by = auth.uid(), updated_at = now(),
    input_value = excluded.input_value, input_unit = excluded.input_unit;

  return jsonb_build_object('metal', p_metal, 'as_of_date', v_today, 'price_thb_per_gram', v_price,
    'input_value', p_input_value, 'input_unit', p_input_unit);
end;
$fn$;
revoke execute on function analytics.oem_metal_price_set_input(uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function analytics.oem_metal_price_set_input(uuid, text, numeric, text) to service_role;

-- ============================================================================
-- §4 production_order_item: product_id nullable + ชื่อแบบ + โลหะ/เนื้อ/น้ำหนัก (add column ล้วน ไม่ UPDATE แถวเดิม — ข้อ 19)
-- ============================================================================
alter table analytics.production_order_item alter column product_id drop not null;
alter table analytics.production_order_item
  add column pending_product_label text,
  add column metal text,
  add column purity numeric(6,4),
  add column weight_g numeric(10,3),
  add column weight_source text;

alter table analytics.production_order_item
  add constraint production_order_item_sku_or_label_ck check (num_nonnulls(product_id, pending_product_label) = 1),
  add constraint production_order_item_label_ck check (
    pending_product_label is null or (
      pending_product_label = btrim(pending_product_label)
      and char_length(pending_product_label) between 1 and 200
      and pending_product_label !~ '[<>]'
      and pending_product_label !~ '[[:cntrl:]]'
      and pending_product_label !~ '\s\s'
      and analytics.oem_note_valid(pending_product_label)
      and analytics.oem_note_present(pending_product_label))),
  add constraint production_order_item_pending_metal_ck check (product_id is not null or metal is not null),
  add constraint production_order_item_metal_ck check (metal is null or metal in ('silver', 'gold', 'brass')),
  -- สัดส่วน 0..1 (ขั้นต่ำ 37.50% — ปิดหนี้ที่ lib/units/purity.ts จดไว้ เฉพาะตารางนี้ ไม่แตะ product)
  add constraint production_order_item_purity_ck check (purity is null or (purity >= 0.3750 and purity <= 1)),
  add constraint production_order_item_gold_purity_ck check (metal is distinct from 'gold' or purity is not null),
  -- ทองเหลืองเนื้อล็อก 100% (มติ 20 ต.ค. Q9): ต้องมีค่าและเท่ากับ 1 (null ผ่าน CHECK แบบเงียบๆ ไม่ได้ จึงเขียนให้บังคับ)
  add constraint production_order_item_brass_purity_ck check (metal is distinct from 'brass' or (purity is not null and purity = 1)),
  add constraint production_order_item_weight_ck check (weight_g is null or (weight_g > 0 and weight_g <= 10000)),
  add constraint production_order_item_weight_source_ck check (
    (weight_g is null) = (weight_source is null) and (weight_source is null or weight_source in ('product', 'input')));

-- กันชื่อแบบซ้ำในใบเดียว (รายการไม่มี SKU) — on conflict (order, product) ใช้กับ null ไม่ได้ จึงเป็น index เฉพาะ
create unique index uq_production_order_item_order_label
  on analytics.production_order_item (production_order_id, lower(pending_product_label))
  where product_id is null;

-- trigger: ตรวจ SKU เฉพาะเมื่อมี product_id (รายการไม่มี SKU ผ่านได้ — ด่านอยู่ที่ done: sku_required)
create or replace function analytics.production_order_item_derive_shop()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $fn$
declare
  v_order_shop_id   uuid;
  v_order_status    text;
  v_product_shop_id uuid;
  v_sku             text;
  v_is_active       boolean;
begin
  select shop_id, status into v_order_shop_id, v_order_status
    from analytics.production_order where id = new.production_order_id;
  if v_order_shop_id is null then
    raise exception 'production_order_item: ไม่พบใบผลิต %', new.production_order_id using errcode = '22023';
  end if;
  if v_order_status <> 'open' then
    raise exception 'production_order_item: ใบผลิตนี้สถานะ % แล้ว เพิ่ม/แก้รายการไม่ได้', v_order_status using errcode = '22023';
  end if;
  if new.product_id is not null then
    select shop_id, sku, is_active into v_product_shop_id, v_sku, v_is_active
      from public.product where id = new.product_id;
    if v_product_shop_id is null then
      raise exception 'production_order_item: ไม่พบ SKU (product_id=%)', new.product_id using errcode = '22023';
    end if;
    if v_product_shop_id <> v_order_shop_id then
      raise exception 'production_order_item: SKU (product_id=%) เป็นของร้านอื่น', new.product_id using errcode = '22023';
    end if;
    if v_sku ~* '^live' then
      raise exception 'production_order_item: SKU % เป็น SKU เฉพาะไลฟ์ (live*) ใส่ในใบผลิตไม่ได้', v_sku using errcode = '22023';
    end if;
    if not v_is_active then
      raise exception 'production_order_item: SKU % ปิดใช้งานแล้ว', v_sku using errcode = '22023';
    end if;
  end if;
  new.shop_id := v_order_shop_id;
  return new;
end;
$fn$;
revoke execute on function analytics.production_order_item_derive_shop() from public, anon, authenticated;
grant execute on function analytics.production_order_item_derive_shop() to service_role;

-- trigger กันแก้/ลบเมื่อใบไม่ใช่ open (เดิม) + 0186: เปลี่ยนโลหะ "ที่มีผล" ไม่ได้ขณะมีใบงานไม่ยกเลิกผูกรายการนี้ (ใบงานล็อกโลหะ/แบบการบันทึกไปแล้ว)
-- เทียบ "โลหะ effective" (แถวเดิม metal null = โลหะที่ SKU ให้) — null→silver ของแถวเดิมที่ stamp ตอน done ไม่นับเป็นการเปลี่ยน
create or replace function analytics.production_order_item_deny_mutation()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $fn$
declare
  v_status    text;
  v_old_sku   text;
  v_new_sku   text;
  v_old_eff   text;
  v_new_eff   text;
  v_job_no    text;
begin
  select status into v_status from analytics.production_order
    where id = coalesce(new.production_order_id, old.production_order_id);
  if v_status is distinct from 'open' then
    if tg_op = 'DELETE' then
      raise exception 'production_order_item: ใบผลิตนี้สถานะ % แล้ว ลบรายการไม่ได้', v_status using errcode = '22023';
    else
      raise exception 'production_order_item: ใบผลิตนี้สถานะ % แล้ว แก้รายการไม่ได้', v_status using errcode = '22023';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and new.metal is distinct from old.metal then
    select coalesce(p.make_spec ->> 'metal', case when p.cost_type in ('fixed', 'spot') then 'silver' end) into v_old_sku
      from public.product p where p.id = old.product_id;
    select coalesce(p.make_spec ->> 'metal', case when p.cost_type in ('fixed', 'spot') then 'silver' end) into v_new_sku
      from public.product p where p.id = new.product_id;
    v_old_eff := coalesce(old.metal, v_old_sku);
    v_new_eff := coalesce(new.metal, v_new_sku);
    if v_new_eff is distinct from v_old_eff then
      select j.job_no into v_job_no from analytics.job j
       where j.production_order_item_id = old.id and j.status <> 'cancelled' order by j.created_at limit 1;
      if v_job_no is not null then
        raise exception 'production_order_item: เปลี่ยนโลหะไม่ได้ — มีใบงาน % เดินอยู่ ยกเลิกใบงานก่อน แล้วแก้โลหะ', v_job_no
          using errcode = '22023', hint = 'metal_locked';
      end if;
    end if;
  end if;
  return new;
end;
$fn$;
revoke execute on function analytics.production_order_item_deny_mutation() from public, anon, authenticated;
grant execute on function analytics.production_order_item_deny_mutation() to service_role;

-- ============================================================================
-- §5 helper production_item_spec(poi, p, lenient) → (metal, purity, weight_g, weight_source)
--    ค่า effective ที่ preview/done/job/view ใช้จุดเดียว · แถวเดิม (ทุกคอลัมน์ null) ได้พฤติกรรมเดิมเป๊ะ · p ว่างได้ (รายการไม่มี SKU: ใช้ค่าจากรายการล้วน ไม่มี = raise)
--    lenient = true (ใช้กับ view/prefill เท่านั้น): คืน null แทน raise
--    ⚠ returns table ⇒ ชื่อ metal/purity/weight_g/weight_source เป็นตัวแปรในฟังก์ชัน — ทุกการอ้างคอลัมน์ในนี้ qualify ด้วยชื่อพารามิเตอร์ (ข้อ 12)
--    grant service_role: view v_production_order_item เป็น security_invoker ⇒ ผู้เรียก (service_role) ต้องมี execute — ฟังก์ชันรับเฉพาะ "ค่าของแถว" ไม่อ่านตารางใดเลย (ไม่มีทางรั่วข้ามร้าน)
-- ============================================================================
create or replace function analytics.production_item_spec(p_poi analytics.production_order_item, p_p public.product, p_lenient boolean default false)
 returns table (metal text, purity numeric, weight_g numeric, weight_source text)
 language plpgsql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $fn$
declare
  v_metal  text;
  v_purity numeric;
  v_weight numeric;
  v_wsrc   text;
begin
  v_metal := coalesce(p_poi.metal, p_p.make_spec ->> 'metal', case when p_p.cost_type in ('fixed', 'spot') then 'silver' end);
  if v_metal is null or v_metal not in ('silver', 'gold', 'brass') then
    if not coalesce(p_lenient, false) then
      raise exception 'ระบุโลหะของรายการนี้ไม่ได้ (รองรับเงิน/ทอง/ทองเหลือง) — ตรวจสเปกการผลิตของสินค้า หรือเลือกโลหะในรายการ' using errcode = '22023', hint = 'metal_unsupported';
    end if;
    v_metal := null;
  end if;
  -- เนื้อ: ทองไม่มี default (บังคับกรอก) · เงินใช้เนื้อของ SKU หรือ 0.925 · ทองเหลือง 1.0
  v_purity := coalesce(p_poi.purity, case v_metal when 'silver' then coalesce(p_p.silver_purity, 0.925) when 'brass' then 1.0 end);
  if v_metal = 'gold' and v_purity is null and not coalesce(p_lenient, false) then
    raise exception 'ทองต้องระบุเนื้อทอง (%%) ของรายการนี้ — ขั้นต่ำ 37.50%%' using errcode = '22023', hint = 'gold_purity_required';
  end if;
  -- น้ำหนัก: silver_weight_g ของ SKU ใช้เฉพาะเงินเท่านั้น (ห้ามเอาไปเป็นน้ำหนักทอง/ทองเหลือง)
  v_weight := coalesce(p_poi.weight_g, case when v_metal = 'silver' and p_p.silver_weight_g > 0 then p_p.silver_weight_g end);
  v_wsrc := coalesce(p_poi.weight_source, case when v_weight is not null then 'product' end);
  return query select v_metal, v_purity, v_weight, v_wsrc;
end;
$fn$;
revoke execute on function analytics.production_item_spec(analytics.production_order_item, public.product, boolean) from public, anon, authenticated;
grant execute on function analytics.production_item_spec(analytics.production_order_item, public.product, boolean) to service_role;

-- ============================================================================
-- §6 ราคาโลหะของ "วันนี้ไทย" ต่อโลหะ — ไม่มี = raise (ห้าม fallback ราคาเมื่อวาน/แถวล่าสุด — invariant ข้อ 5 · ต่างจาก oem_cost_calc ที่ lookup <=)
-- ============================================================================
create or replace function analytics.production_metal_price_today(p_shop_id uuid, p_metal text)
 returns numeric
 language sql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $fn$
  select price_thb_per_gram from analytics.oem_metal_price
   where shop_id = p_shop_id and metal = p_metal and as_of_date = (now() at time zone 'Asia/Bangkok')::date
$fn$;
revoke execute on function analytics.production_metal_price_today(uuid, text) from public, anon, authenticated, service_role;

create or replace function analytics.production_metal_price_resolve(p_shop_id uuid, p_metal text, p_override numeric default null::numeric)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $fn$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_price numeric;
begin
  if p_shop_id is null or p_metal is null then
    raise exception 'production_metal_price_resolve: p_shop_id and p_metal are required';
  end if;
  if p_metal not in ('silver', 'gold', 'brass') then
    raise exception 'production_metal_price_resolve: p_metal ต้องเป็น silver/gold/brass' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if p_metal = 'silver' then
    -- ของเดิมเป๊ะ (production_spot_resolve 0131): override ของใบ 5-500 บาท/กรัม
    if p_override is not null then
      if not (p_override >= 5 and p_override <= 500) then
        raise exception 'production_spot_resolve: override ต้องอยู่ระหว่าง 5-500 บาท/กรัม' using errcode = '22023';
      end if;
      return p_override;
    end if;
  elsif p_override is not null then
    -- มติ Q3/Q6: ทอง/ทองเหลืองไม่มีราคาเฉพาะใบ — ต้องกรอกราคาของวันนั้นที่ /oem/rates ก่อน
    raise exception 'production_metal_price_resolve: ทอง/ทองเหลืองไม่มีราคาเฉพาะใบ — กรอกราคาของวันนี้ที่ /oem/rates' using errcode = '22023', hint = 'override_not_supported';
  end if;
  v_price := analytics.production_metal_price_today(p_shop_id, p_metal);
  if v_price is null then
    if p_metal = 'silver' then
      raise exception 'production_spot_resolve: ยังไม่มีราคาเงินของวันนี้ (%) และไม่มี override', v_today using errcode = '22023', hint = 'metal_price_missing';
    end if;
    raise exception 'production_metal_price_resolve: ยังไม่มีราคา%ของวันนี้ (%) — กรอกที่ /oem/rates (ทอง/ทองเหลืองไม่มี feed จึงไม่ล็อกชีต)',
      case p_metal when 'gold' then 'ทอง' else 'ทองเหลือง' end, v_today
      using errcode = '22023', hint = 'metal_price_missing';
  end if;
  -- ป้องกันซ้ำ: ราคาที่เก็บไว้ต้องอยู่ในช่วงที่รับ (แถวที่ถูกเขียนนอกทาง RPC ก็ไม่ไหลเข้าต้นทุน)
  if p_metal <> 'silver' and not analytics.oem_metal_price_range_ok(p_metal, v_price) then
    raise exception 'production_metal_price_resolve: ราคา%ที่บันทึกไว้ของวันนี้ (%) อยู่นอกช่วงที่รับ — กรอกใหม่ที่ /oem/rates',
      case p_metal when 'gold' then 'ทอง' else 'ทองเหลือง' end, v_price
      using errcode = '22023', hint = 'metal_price_range';
  end if;
  return v_price;
end;
$fn$;
revoke execute on function analytics.production_metal_price_resolve(uuid, text, numeric) from public, anon, authenticated;
grant execute on function analytics.production_metal_price_resolve(uuid, text, numeric) to service_role;

-- production_spot_resolve: คง signature (L3 อ้างชื่อนี้) · ผลเท่าเดิม = ราคาเงิน (override ของใบ 5-500 หรือแถววันนี้)
create or replace function analytics.production_spot_resolve(p_shop_id uuid, p_override numeric default null::numeric)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $fn$
begin
  if p_shop_id is null then
    raise exception 'production_spot_resolve: p_shop_id is required';
  end if;
  return analytics.production_metal_price_resolve(p_shop_id, 'silver', p_override);
end;
$fn$;
revoke execute on function analytics.production_spot_resolve(uuid, numeric) from public, anon, authenticated;
grant execute on function analytics.production_spot_resolve(uuid, numeric) to service_role;

-- ============================================================================
-- §7 เก็บฟังก์ชันเดิมไว้ทำ golden replay (rename ชั่วคราว · drop ใน §14 หลัง golden ผ่าน)
-- ============================================================================
alter function analytics.production_order_preview(uuid, uuid, jsonb) rename to production_order_preview_legacy186;
alter function analytics.production_order_done(uuid, uuid, jsonb, numeric, uuid) rename to production_order_done_legacy186;
alter function analytics.job_source_info(uuid, text, uuid) rename to job_source_info_legacy186;
-- production_cost_calc (5-arg) คงชื่อเดิมไว้ — signature ใหม่ 8-arg ไม่มี default จึงไม่ซ้อน/ไม่ ambiguous กับการเรียก 5 arg ของฉบับเดิม

-- ============================================================================
-- §8 production_cost_calc — รับ metal/purity/weight จากผู้เรียก (ลอกสด 0141/0142 · สูตรเดิมไม่แตะ)
--    ไม่มี default ทุกพารามิเตอร์: ผู้เรียกต้องส่งครบ (ไม่ส่ง p_metal = ใช้ค่า effective ของ SKU เอง = พฤติกรรมเดิมก่อน 0186)
--    คงคีย์เดิมทุกตัว (silver_weight_g/silver_purity = ค่าของ product ตามเดิม) + ต่อท้าย metal/purity/weight_g
-- ============================================================================
create or replace function analytics.production_cost_calc(
  p_shop_id uuid, p_product_id uuid, p_metal_price_thb_per_gram numeric, p_qty integer, p_is_new_design boolean,
  p_metal text, p_purity numeric, p_weight_g numeric)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $fn$
declare
  v_product         public.product%rowtype;
  v_metal           text;
  v_purity          numeric;
  v_weight          numeric;
  v_price           numeric;
  v_unit_cost       numeric;
  -- 0141: เฉพาะ branch 'spec'
  v_spec_input      jsonb;
  v_cost_result     jsonb;
  v_is_complete     boolean;
  v_metal_per_piece numeric;
  v_labor_per_piece numeric;
  v_batch_per_piece numeric;
  v_cost_piece      numeric;
  v_nre_cost        numeric;
  v_nre_per_piece   numeric;
  v_cost_calc       jsonb;
  -- 0142 MEDIUM-2: ปัด metal/labor ก่อน แล้วให้ batch เป็นเศษที่เหลือ (ผลรวม 4 ก้อน = unit_cost เป๊ะ)
  v_metal_per_piece_r numeric;
  v_labor_per_piece_r numeric;
  v_batch_per_piece_r numeric;
  -- 0142 MEDIUM-1: วันที่ไทยที่ใช้จริง — ทับ as_of_date ที่อาจฉีดมาจาก make_spec เสมอ
  v_as_of_used      date;
begin
  if p_shop_id is null or p_product_id is null then
    raise exception 'production_cost_calc: p_shop_id and p_product_id are required';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_product from public.product where id = p_product_id and shop_id = p_shop_id;
  if not found then
    raise exception 'production_cost_calc: ไม่พบ SKU (product_id=%) ในร้านนี้', p_product_id using errcode = '22023';
  end if;

  if p_metal is null then
    -- ไม่ส่งสามค่า = ค่า effective ของ SKU เอง (เหมือนก่อน 0186: spot/spec ใช้ silver_weight_g/silver_purity ของ SKU)
    select s.metal, s.purity, s.weight_g into v_metal, v_purity, v_weight
      from analytics.production_item_spec(null::analytics.production_order_item, v_product) s;
  else
    v_metal := p_metal; v_purity := p_purity; v_weight := p_weight_g;
  end if;
  if v_metal is null or v_metal not in ('silver', 'gold', 'brass') then
    raise exception 'production_cost_calc: SKU % ระบุโลหะไม่ได้ (รองรับเงิน/ทอง/ทองเหลือง)', v_product.sku using errcode = '22023', hint = 'metal_unsupported';
  end if;

  if v_product.cost_type in ('spot', 'spec') then
    -- ด่านค่า effective — not(between) กัน null/NaN/Infinity พร้อมกัน (ข้อ 4/13)
    if v_purity is null or not (v_purity >= 0.375 and v_purity <= 1) then
      raise exception 'production_cost_calc: SKU % เนื้อโลหะของรายการไม่ถูกต้อง (ต้อง 37.50%%-100%% · ทองต้องระบุเอง)', v_product.sku using errcode = '22023', hint = 'purity_invalid';
    end if;
    if v_weight is null or not (v_weight > 0 and v_weight <= 10000) then
      raise exception 'production_cost_calc: SKU % ยังไม่ระบุน้ำหนัก/ชิ้นของรายการนี้ — กรอกน้ำหนักในใบผลิตก่อน (โหมดนี้คิดต้นทุนจากน้ำหนัก)', v_product.sku using errcode = '22023', hint = 'weight_required';
    end if;
    v_price := coalesce(p_metal_price_thb_per_gram, analytics.production_metal_price_resolve(p_shop_id, v_metal, null));
    if not analytics.oem_metal_price_range_ok(v_metal, v_price) then
      raise exception 'production_cost_calc: ราคา% ต่อกรัมอยู่นอกช่วงที่รับ (หน่วย บาท/กรัม โลหะ 100%%)',
        case v_metal when 'gold' then 'ทอง' when 'brass' then 'ทองเหลือง' else 'เงิน' end using errcode = '22023', hint = 'metal_price_range';
    end if;
  end if;

  if v_product.cost_type = 'spot' then
    -- 🔴 นิพจน์เดียวกับ analytics.v_dim_product (0028) — เปลี่ยนแค่ที่มาของ 3 ตัวแปร (น้ำหนัก/ราคา/เนื้อ) จาก product → รายการ
    v_unit_cost := round(v_weight * v_price * v_purity + coalesce(v_product.labor_cost, 0), 2);

  elsif v_product.cost_type = 'spec' then
    if v_product.make_spec is null then
      raise exception 'production_cost_calc: SKU % เป็นโหมด spec แต่ยังไม่ได้ตั้งสเปค (make_spec) — ตั้งที่ /catalog ก่อนสั่งผลิต (analytics.product_make_spec_set)', v_product.sku using errcode = '22023';
    end if;
    if p_qty is null or p_qty <= 0 then
      raise exception 'production_cost_calc: SKU % เป็นโหมด spec ต้องระบุจำนวนที่จะผลิต (p_qty > 0) — ต้นทุนต่อชิ้นของโหมดนี้ขึ้นกับจำนวนที่ผลิตจริง', v_product.sku using errcode = '22023';
    end if;

    v_as_of_used := (now() at time zone 'Asia/Bangkok')::date;

    -- 🔴 ห้าม oem_cost_calc lookup ราคาเอง (0131 §M1) — ส่งราคาที่ resolve แล้วผ่าน metal_price_thb_per_gram เสมอ · as_of_date ทับด้วยวันที่ไทยเสมอ (0142 MEDIUM-1)
    -- โลหะ/เนื้อ/น้ำหนักของ "รายการ" ทับของ make_spec (jsonb_build_object อยู่ขวาของ || ชนะคีย์ซ้ำ)
    v_spec_input := v_product.make_spec || jsonb_build_object(
      'metal', v_metal,
      'qty', p_qty,
      'weight_g', v_weight,
      'purity', v_purity,
      'is_new_design', coalesce(p_is_new_design, false),
      'metal_price_thb_per_gram', v_price,
      'as_of_date', v_as_of_used
    );

    v_cost_result := analytics.oem_cost_calc(p_shop_id, v_spec_input);
    v_is_complete := (v_cost_result ->> 'is_complete')::boolean;
    -- is not true ปฏิบัติกับ null เหมือน false (0142 🟢) — ทองที่ rate ของ scope gold ว่างจะตกที่นี่พร้อม missing[]
    if v_is_complete is not true then
      raise exception 'production_cost_calc: SKU % คำนวณต้นทุนไม่ครบ — ยังไม่ได้กรอกอัตราต้นทุนที่ /oem/rates (%)', v_product.sku,
        (select string_agg(e ->> 'question_th', ' / ') from jsonb_array_elements(v_cost_result -> 'missing') e)
        using errcode = '22023';
    end if;

    v_metal_per_piece := (v_cost_result -> '_raw' ->> 'metal_per_piece')::numeric;
    v_labor_per_piece := (v_cost_result -> '_raw' ->> 'labor_per_piece')::numeric;
    v_batch_per_piece := (v_cost_result -> '_raw' ->> 'batch_per_piece')::numeric;
    v_cost_piece      := (v_cost_result -> '_raw' ->> 'cost_piece')::numeric;
    v_nre_cost      := coalesce((v_cost_result -> '_raw' ->> 'nre_cost')::numeric, 0);
    v_nre_per_piece := round(v_nre_cost / p_qty, 2);
    v_unit_cost     := round(v_cost_piece + v_nre_cost / p_qty, 2);

    v_metal_per_piece_r := round(v_metal_per_piece, 2);
    v_labor_per_piece_r := round(v_labor_per_piece, 2);
    v_batch_per_piece_r := v_unit_cost - v_metal_per_piece_r - v_labor_per_piece_r - v_nre_per_piece;

    -- ประกอบทีละ field ไม่ spread _raw ดิบ (oem-quote-invariants ข้อ 1) · 0186: ต่อท้าย metal/purity/weight_g (additive)
    v_cost_calc := jsonb_build_object(
      'is_complete', v_is_complete,
      'missing', v_cost_result -> 'missing',
      'price_source', v_cost_result ->> 'price_source',
      'as_of_date', v_cost_result -> '_raw' ->> 'as_of_date',
      'labor_steps', v_cost_result -> 'labor_steps',
      'batch_lines', v_cost_result -> 'batch_lines',
      'metal_per_piece', v_metal_per_piece_r,
      'labor_per_piece', v_labor_per_piece_r,
      'batch_per_piece', v_batch_per_piece_r,
      'cost_piece', v_metal_per_piece_r + v_labor_per_piece_r + v_batch_per_piece_r,
      'nre_cost', round(v_nre_cost, 2),
      'nre_per_piece', v_nre_per_piece,
      'qty', p_qty,
      'is_new_design', coalesce(p_is_new_design, false),
      'metal_price_thb_per_gram', v_price,
      'unit_cost', v_unit_cost,
      'metal', v_metal,
      'purity', v_purity,
      'weight_g', v_weight
    );

  else -- fixed
    v_unit_cost := v_product.unit_cost;
    if v_unit_cost is null then
      raise exception 'production_cost_calc: SKU % ยังไม่มีต้นทุน (unit_cost) — กรอกที่ /catalog ก่อนสั่งผลิต', v_product.sku using errcode = '22023';
    end if;
  end if;

  return jsonb_build_object(
    'product_id', v_product.id,
    'sku', v_product.sku,
    'cost_type', v_product.cost_type,
    'silver_weight_g', v_product.silver_weight_g,
    'silver_purity', coalesce(v_product.silver_purity, 0.925),
    'labor_cost', v_product.labor_cost,
    'spot_price_thb_per_gram', case when v_product.cost_type in ('spot', 'spec') then v_price else null end,
    'prev_cost_type', v_product.cost_type,
    'prev_unit_cost', v_product.unit_cost,
    'unit_cost', v_unit_cost,
    'cost_calc', v_cost_calc,
    'metal', v_metal,
    'purity', v_purity,
    'weight_g', v_weight
  );
end;
$fn$;
revoke execute on function analytics.production_cost_calc(uuid, uuid, numeric, integer, boolean, text, numeric, numeric) from public, anon, authenticated;
grant execute on function analytics.production_cost_calc(uuid, uuid, numeric, integer, boolean, text, numeric, numeric) to service_role;

-- ============================================================================
-- §9 production_order_item_set — SKU หรือชื่อแบบ + โลหะ/เนื้อ/น้ำหนัก (null = ไม่แตะค่าเดิม · แพทเทิร์น 0144)
--    drop 5-arg เดิม · ผู้เรียกเดิม (5 named args) ยังเรียก signature ใหม่ได้เพราะพารามิเตอร์ใหม่มี default ทั้งหมด
-- ============================================================================
drop function analytics.production_order_item_set(uuid, uuid, uuid, integer, boolean);

create or replace function analytics.production_order_item_set(
  p_shop_id             uuid,
  p_production_order_id uuid,
  p_product_id          uuid,
  p_qty_planned         integer,
  p_is_new_design       boolean default null,
  p_pending_product_label text default null,
  p_metal               text default null,
  p_purity              numeric default null,
  p_weight_g            numeric default null,
  p_weight_source       text default null,
  p_clear_weight        boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $fn$
declare
  v_order     analytics.production_order%rowtype;
  v_product   public.product%rowtype;
  v_old       analytics.production_order_item%rowtype;
  v_item      analytics.production_order_item%rowtype;
  v_tmp       analytics.production_order_item%rowtype;
  v_found     boolean;
  v_label     text;
  v_eff       record;
  v_old_eff   record;
  v_metal     text;
  v_purity    numeric;
  v_weight    numeric;
  v_wsrc      text;
  v_changed   boolean;
  v_job_no    text;
begin
  if p_shop_id is null or p_production_order_id is null then
    raise exception 'production_order_item_set: p_shop_id, p_production_order_id are required';
  end if;
  if num_nonnulls(p_product_id, p_pending_product_label) <> 1 then
    raise exception 'production_order_item_set: ต้องระบุ SKU หรือชื่อแบบ อย่างใดอย่างหนึ่ง (ไม่ใช่ทั้งสองอย่าง/ไม่ใช่ว่าง)' using errcode = '22023', hint = 'sku_or_label';
  end if;
  -- p_qty_planned เป็น int อยู่แล้ว (NaN/Infinity พังตั้งแต่ cast พารามิเตอร์ — ข้อ 4)
  if p_qty_planned is null or not (p_qty_planned > 0 and p_qty_planned <= 100000) then
    raise exception 'production_order_item_set: p_qty_planned ต้องอยู่ระหว่าง 1-100000' using errcode = '22023';
  end if;
  -- ตัวเลขจาก client ทุกช่อง: not(between) กัน NaN/Infinity (ข้อ 4) · ทศนิยมเกินคอลัมน์ = ปฏิเสธ ไม่ปัดเงียบ
  if p_metal is not null and p_metal not in ('silver', 'gold', 'brass') then
    raise exception 'production_order_item_set: โลหะต้องเป็นเงิน/ทอง/ทองเหลือง' using errcode = '22023', hint = 'metal_invalid';
  end if;
  if p_purity is not null and not (p_purity >= 0.375 and p_purity <= 1 and p_purity = round(p_purity, 4)) then
    raise exception 'production_order_item_set: เนื้อโลหะต้องอยู่ระหว่าง 37.50%%-100%% (ส่งเป็นสัดส่วน 0.375-1 · ทศนิยมไม่เกิน 4 ตำแหน่ง)' using errcode = '22023', hint = 'purity_invalid';
  end if;
  if p_weight_g is not null and not (p_weight_g > 0 and p_weight_g <= 10000 and p_weight_g = round(p_weight_g, 3)) then
    raise exception 'production_order_item_set: น้ำหนักต่อชิ้นต้องมากกว่า 0 ไม่เกิน 10,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)' using errcode = '22023', hint = 'weight_invalid';
  end if;
  if p_weight_source is not null and p_weight_source not in ('product', 'input') then
    raise exception 'production_order_item_set: ที่มาของน้ำหนักต้องเป็น product หรือ input' using errcode = '22023', hint = 'weight_source_invalid';
  end if;
  if (p_weight_g is null) <> (p_weight_source is null) then
    raise exception 'production_order_item_set: น้ำหนักกับที่มาของน้ำหนักต้องส่งมาคู่กัน' using errcode = '22023', hint = 'weight_source_invalid';
  end if;
  if coalesce(p_clear_weight, false) and p_weight_g is not null then
    raise exception 'production_order_item_set: สั่งล้างน้ำหนักพร้อมส่งน้ำหนักใหม่ไม่ได้' using errcode = '22023', hint = 'weight_invalid';
  end if;
  if p_pending_product_label is not null then
    -- 0186 L3: ยุบช่องว่างซ้อนกลางข้อความเป็นช่องเดียวหลังล้างแล้ว — "แหวน  A" กับ "แหวน A" ต้องเป็นชื่อเดียวกัน (ไม่งั้นหลบ unique ชื่อซ้ำในใบเดียวได้)
    v_label := regexp_replace(analytics.job_label_clean(p_pending_product_label, 'ชื่อแบบ', 200), '\s+', ' ', 'g');
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_order from analytics.production_order where id = p_production_order_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'production_order_item_set: ไม่พบใบผลิต % ในร้านนี้', p_production_order_id using errcode = '22023';
  end if;
  if v_order.status <> 'open' then
    raise exception 'production_order_item_set: ใบ % สถานะ % แล้ว เพิ่ม/แก้รายการไม่ได้', v_order.po_no, v_order.status using errcode = '22023';
  end if;

  if p_product_id is not null then
    select * into v_product from public.product where id = p_product_id and shop_id = p_shop_id;
    if not found then
      raise exception 'production_order_item_set: ไม่พบ SKU % ในร้านนี้', p_product_id using errcode = '22023';
    end if;
    if not v_product.is_active then
      raise exception 'production_order_item_set: SKU % ปิดใช้งานแล้ว ใส่ในใบผลิตไม่ได้', v_product.sku using errcode = '22023';
    end if;
    if v_product.sku ~* '^live' then
      raise exception 'production_order_item_set: SKU % เป็น SKU เฉพาะไลฟ์ (live*) ไม่นับสต็อก ใส่ในใบผลิตไม่ได้', v_product.sku using errcode = '22023';
    end if;
    select * into v_old from analytics.production_order_item
     where production_order_id = p_production_order_id and product_id = p_product_id for update;
  else
    select * into v_old from analytics.production_order_item
     where production_order_id = p_production_order_id and product_id is null and lower(pending_product_label) = lower(v_label) for update;
  end if;
  v_found := found;

  if not v_found then
    -- แถวใหม่: ค่าที่ไม่ส่ง → ค่า effective จาก helper (server ตัดสิน — client แค่ prefill ให้เห็น)
    if p_product_id is null and p_metal is null then
      raise exception 'production_order_item_set: รายการที่ยังไม่มี SKU ต้องระบุโลหะ (ไม่เดา)' using errcode = '22023', hint = 'metal_required';
    end if;
    v_tmp.metal := p_metal; v_tmp.purity := p_purity; v_tmp.weight_g := p_weight_g; v_tmp.weight_source := p_weight_source;
    select s.metal, s.purity, s.weight_g, s.weight_source into v_eff from analytics.production_item_spec(v_tmp, v_product) s;
    v_metal := v_eff.metal; v_purity := v_eff.purity; v_weight := v_eff.weight_g; v_wsrc := v_eff.weight_source;
    if v_metal = 'brass' and p_purity is not null and p_purity <> 1 then
      raise exception 'production_order_item_set: ทองเหลืองเนื้อล็อก 100%%' using errcode = '22023', hint = 'brass_purity_locked';
    end if;
    -- weight_source = product ต้องเป็นน้ำหนักของ SKU จริง (เงินเท่านั้น) — ไม่ให้ป้ายเท็จ
    if p_weight_source = 'product' and not coalesce(v_metal = 'silver' and p_product_id is not null and p_weight_g = round(v_product.silver_weight_g, 3), false) then
      raise exception 'production_order_item_set: ที่มาน้ำหนัก product ต้องตรงกับน้ำหนักใน SKU (เฉพาะเงิน)' using errcode = '22023', hint = 'weight_source_invalid';
    end if;
    insert into analytics.production_order_item (production_order_id, product_id, pending_product_label, qty_planned, is_new_design,
                                                 metal, purity, weight_g, weight_source)
    values (p_production_order_id, p_product_id, v_label, p_qty_planned, coalesce(p_is_new_design, false),
            v_metal, v_purity, v_weight, v_wsrc)
    returning * into v_item;
  else
    select s.metal, s.purity, s.weight_g, s.weight_source into v_old_eff from analytics.production_item_spec(v_old, v_product) s;
    v_changed := p_metal is not null and p_metal is distinct from v_old_eff.metal;
    if v_changed then
      select j.job_no into v_job_no from analytics.job j
       where j.production_order_item_id = v_old.id and j.status <> 'cancelled' order by j.created_at limit 1;
      if v_job_no is not null then
        raise exception 'production_order_item_set: เปลี่ยนโลหะไม่ได้ — มีใบงาน % เดินอยู่ ยกเลิกใบงานก่อน แล้วแก้โลหะ', v_job_no using errcode = '22023', hint = 'metal_locked';
      end if;
    end if;
    v_metal := coalesce(p_metal, v_old.metal);                 -- null = ไม่แตะ (แถวเดิม null ก็คง null)
    -- เนื้อ: ส่งมา = ใช้ · เปลี่ยนโลหะแต่ไม่ส่ง = รีเซ็ตเป็นค่าเริ่มของโลหะใหม่ (เงิน: เนื้อ SKU/0.925 · ทองเหลือง 1.0 · ทอง = ต้องส่งเอง) · ไม่เปลี่ยน = คงเดิม
    if p_purity is not null then
      v_purity := p_purity;
    elsif v_changed then
      v_purity := case p_metal when 'silver' then coalesce(v_product.silver_purity, 0.925) when 'brass' then 1.0 else null end;
    else
      v_purity := v_old.purity;
    end if;
    if p_metal = 'brass' or (p_metal is null and v_old_eff.metal = 'brass') then
      if p_purity is not null and p_purity <> 1 then
        raise exception 'production_order_item_set: ทองเหลืองเนื้อล็อก 100%%' using errcode = '22023', hint = 'brass_purity_locked';
      end if;
      v_purity := 1.0;
    end if;
    if coalesce(v_metal, v_old_eff.metal) = 'gold' and v_purity is null then
      raise exception 'production_order_item_set: ทองต้องระบุเนื้อทอง (%%) ของรายการนี้ — ขั้นต่ำ 37.50%%' using errcode = '22023', hint = 'gold_purity_required';
    end if;
    -- น้ำหนัก: ส่งมา = ใช้ · สั่งล้าง = null · เปลี่ยนโลหะและค่าเดิมมาจาก SKU (silver_weight_g ใช้เฉพาะเงิน) = ล้าง · อื่นๆ คงเดิม
    if p_weight_g is not null then
      v_weight := p_weight_g; v_wsrc := p_weight_source;
      if p_weight_source = 'product' and not coalesce(coalesce(v_metal, v_old_eff.metal) = 'silver' and p_product_id is not null and p_weight_g = round(v_product.silver_weight_g, 3), false) then
        raise exception 'production_order_item_set: ที่มาน้ำหนัก product ต้องตรงกับน้ำหนักใน SKU (เฉพาะเงิน)' using errcode = '22023', hint = 'weight_source_invalid';
      end if;
    elsif coalesce(p_clear_weight, false) or (v_changed and v_old.weight_source = 'product') then
      v_weight := null; v_wsrc := null;
    else
      v_weight := v_old.weight_g; v_wsrc := v_old.weight_source;
    end if;
    update analytics.production_order_item as poi
       set qty_planned   = p_qty_planned,
           -- null = ไม่แตะ ⇒ คงค่าเดิมของแถว (อ้างผ่าน alias ของตารางเป้าหมาย — ไม่ใช่ excluded · trap #14)
           is_new_design = case when p_is_new_design is null then poi.is_new_design else p_is_new_design end,
           metal         = v_metal,
           purity        = v_purity,
           weight_g      = v_weight,
           weight_source = v_wsrc,
           updated_at    = now()
     where poi.id = v_old.id
     returning * into v_item;
  end if;

  -- ยืนยันว่าแถวที่เก็บแล้วหา spec ได้ครบ (ทองไม่มีเนื้อ/โลหะไม่รู้ = raise ที่นี่ ไม่ปล่อยให้ไปแตกตอน done)
  perform 1 from analytics.production_item_spec(v_item, v_product);

  return jsonb_build_object(
    'id', v_item.id, 'product_id', v_item.product_id, 'pending_product_label', v_item.pending_product_label,
    'sku', v_product.sku, 'name', coalesce(v_product.name, v_item.pending_product_label),
    'qty_planned', v_item.qty_planned, 'is_new_design', v_item.is_new_design,
    'metal', v_item.metal, 'purity', v_item.purity, 'weight_g', v_item.weight_g, 'weight_source', v_item.weight_source
  );
end;
$fn$;
revoke execute on function analytics.production_order_item_set(uuid, uuid, uuid, integer, boolean, text, text, numeric, numeric, text, boolean) from public, anon, authenticated;
grant execute on function analytics.production_order_item_set(uuid, uuid, uuid, integer, boolean, text, text, numeric, numeric, text, boolean) to service_role;

-- ลบรายการด้วย id (รายการไม่มี SKU ลบด้วย product_id ไม่ได้) — production_order_item_remove เดิมไม่แตะ · มีใบงานผูกอยู่ = บอกเลขใบงาน ไม่ปล่อยให้ FK แตก
create or replace function analytics.production_order_item_remove_by_id(p_shop_id uuid, p_production_order_id uuid, p_item_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $fn$
declare
  v_order  analytics.production_order%rowtype;
  v_job_no text;
  v_job_status text;
begin
  if p_shop_id is null or p_production_order_id is null or p_item_id is null then
    raise exception 'production_order_item_remove_by_id: required args missing';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  select * into v_order from analytics.production_order where id = p_production_order_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'production_order_item_remove_by_id: ไม่พบใบผลิต % ในร้านนี้', p_production_order_id using errcode = '22023';
  end if;
  if v_order.status <> 'open' then
    raise exception 'production_order_item_remove_by_id: ใบ % สถานะ % แล้ว ลบรายการไม่ได้', v_order.po_no, v_order.status using errcode = '22023';
  end if;
  -- 0186 L2: เช็คก่อนว่ารายการอยู่ในใบนี้จริง (ล็อกแถวไว้) แล้วค่อยหาใบงาน — id ของใบอื่นต้องไม่รั่วเลขใบงานของใบอื่นมาในข้อความ
  perform 1 from analytics.production_order_item i where i.id = p_item_id and i.production_order_id = p_production_order_id for update;
  if not found then
    raise exception 'production_order_item_remove_by_id: ไม่พบรายการนี้ในใบ' using errcode = '22023', hint = 'item_not_found';
  end if;
  -- ใบงานที่ยังเดิน = ลบไม่ได้ (job_exists) · ใบงานทุกใบยกเลิกแล้วก็ยังลบแถวไม่ได้ เพราะ job.production_order_item_id → FK on delete restrict (ใบงานที่ยกเลิกเก็บเป็นหลักฐาน
  -- และ job_source_ck บังคับให้ใบงานผลิตต้องชี้รายการ) — ข้อความแยกให้ต่างกัน (hint job_history) · ทางออก soft-remove ต้องกรองรายการที่ถูกถอนในทุกเส้นต้นทุน (done/preview/view/นับยอด) = รอ W1
  select j.job_no, j.status into v_job_no, v_job_status from analytics.job j where j.production_order_item_id = p_item_id
   order by (j.status <> 'cancelled') desc, j.created_at limit 1;
  if v_job_no is not null then
    if v_job_status <> 'cancelled' then
      raise exception 'production_order_item_remove_by_id: ลบรายการไม่ได้ — มีใบงาน % ผูกอยู่ (ใบงานเก็บไว้เป็นหลักฐาน)', v_job_no using errcode = '22023', hint = 'job_exists';
    end if;
    raise exception 'production_order_item_remove_by_id: ลบรายการไม่ได้ — เคยมีใบงาน % (ยกเลิกแล้ว แต่เก็บไว้เป็นหลักฐาน ลบรายการที่ผูกอยู่ไม่ได้) — ถ้ารายการนี้ไม่ใช้แล้วให้ยกเลิกทั้งใบผลิตแล้วเปิดใบใหม่', v_job_no using errcode = '22023', hint = 'job_history';
  end if;
  delete from analytics.production_order_item where id = p_item_id and production_order_id = p_production_order_id;
end;
$fn$;
revoke execute on function analytics.production_order_item_remove_by_id(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.production_order_item_remove_by_id(uuid, uuid, uuid) to service_role;

-- ค่าเริ่มของ SKU สำหรับหน้าเพิ่มรายการ — metal_known = true เฉพาะ SKU ที่ "ระบุโลหะจริง" (make_spec.metal หรือโหมด spot = ราคาเงินแท่ง) ·
-- ไม่รู้โลหะ = เงิน 925 ตามมติ Q5 และ metal_known = false (UI ขึ้นข้อความกลาง ไม่ใช่คำเตือน — กัน warning fatigue ตาม UX P1)
create or replace function analytics.production_item_prefill(p_shop_id uuid, p_product_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $fn$
declare
  v_product public.product%rowtype;
  v_eff     record;
  v_metal   text;
  v_purity  numeric;
  v_known   boolean;
begin
  if p_shop_id is null or p_product_id is null then
    raise exception 'production_item_prefill: p_shop_id and p_product_id are required';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  select * into v_product from public.product where id = p_product_id and shop_id = p_shop_id;
  if not found then
    raise exception 'production_item_prefill: ไม่พบ SKU ในร้านนี้' using errcode = '22023';
  end if;
  select s.metal, s.purity, s.weight_g, s.weight_source into v_eff
    from analytics.production_item_spec(null::analytics.production_order_item, v_product, true) s;
  v_metal := coalesce(v_eff.metal, 'silver');
  v_purity := case when v_eff.metal is null then 0.925 else v_eff.purity end;
  v_known := (v_product.make_spec ->> 'metal') in ('silver', 'gold', 'brass') or v_product.cost_type = 'spot';
  return jsonb_build_object('product_id', v_product.id, 'sku', v_product.sku, 'name', v_product.name, 'cost_type', v_product.cost_type,
    'metal', v_metal, 'purity', v_purity, 'weight_g', v_eff.weight_g, 'weight_source', v_eff.weight_source,
    'metal_known', coalesce(v_known, false));
end;
$fn$;
revoke execute on function analytics.production_item_prefill(uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.production_item_prefill(uuid, uuid) to service_role;

-- ============================================================================
-- §10 production_order_preview (ลอกสด 0141) — ราคาต่อโลหะ · missing_prices (R3) · sku_required
-- ============================================================================
create or replace function analytics.production_order_preview(p_shop_id uuid, p_production_order_id uuid, p_items jsonb default null::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $fn$
declare
  v_order      analytics.production_order%rowtype;
  v_spot       numeric;
  v_metals     text[];
  v_metal      text;
  v_price      numeric;
  v_prices     jsonb := '{}'::jsonb;
  v_missing    text[] := '{}';
  v_items      jsonb;
begin
  if p_shop_id is null or p_production_order_id is null then
    raise exception 'production_order_preview: p_shop_id and p_production_order_id are required';
  end if;
  if p_items is not null and jsonb_typeof(p_items) <> 'array' then
    raise exception 'production_order_preview: p_items ต้องเป็น json array' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_order from analytics.production_order where id = p_production_order_id and shop_id = p_shop_id;
  if not found then
    raise exception 'production_order_preview: ไม่พบใบผลิต % ในร้านนี้', p_production_order_id using errcode = '22023';
  end if;
  if v_order.status <> 'open' then
    raise exception 'production_order_preview: ใบ % สถานะ % แล้ว — ดูค่าที่ stamp ไปแล้วจากรายการใบผลิตได้เลย ไม่ต้อง preview ซ้ำ', v_order.po_no, v_order.status using errcode = '22023';
  end if;
  -- 0186: รายการที่ยังไม่มี SKU คิดต้นทุน/เข้าสต็อกไม่ได้ — ปฏิเสธก่อนเข้าเส้นต้นทุน (เหมือน done)
  if exists (select 1 from analytics.production_order_item i where i.production_order_id = p_production_order_id and i.product_id is null) then
    raise exception 'production_order_preview: ใบ % มีรายการที่ยังไม่ผูก SKU — ผูก SKU ให้ครบก่อน ระบบถึงคิดต้นทุนและเข้าสต็อกได้', v_order.po_no using errcode = '22023', hint = 'sku_required';
  end if;

  -- โลหะที่ใบ "ใช้ราคาจริง" = รายการ spot/spec ที่ qty_used > 0 (กติกาเดียวกับ done)
  select coalesce(array_agg(distinct eff.metal order by eff.metal), '{}') into v_metals
  from analytics.production_order_item poi
  join public.product p on p.id = poi.product_id
  cross join lateral (
    select coalesce(
      (select (ov ->> 'qty_done')::int from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) ov
        where (ov ->> 'product_id')::uuid = poi.product_id),
      poi.qty_planned
    ) as qty_used
  ) q
  cross join lateral analytics.production_item_spec(poi, p) eff
  where poi.production_order_id = p_production_order_id and p.cost_type in ('spot', 'spec') and q.qty_used > 0;

  foreach v_metal in array v_metals loop
    if v_metal = 'silver' then
      -- เงิน: ของเดิมเป๊ะ — ไม่มีราคา/override = raise (UI เดิมพึ่งข้อความนี้)
      v_price := analytics.production_metal_price_resolve(p_shop_id, 'silver', v_order.spot_override_thb_per_gram);
    else
      -- ทอง/ทองเหลือง (R3): ไม่มีราคาของวันนี้ = ไม่ raise — คืน missing_prices ให้ UI ขึ้นเช็คลิสต์ (done ยัง fail-closed)
      v_price := analytics.production_metal_price_today(p_shop_id, v_metal);
      if v_price is not null and not analytics.oem_metal_price_range_ok(v_metal, v_price) then
        raise exception 'production_order_preview: ราคา%ที่บันทึกไว้ของวันนี้ (%) อยู่นอกช่วงที่รับ — กรอกใหม่ที่ /oem/rates',
          case v_metal when 'gold' then 'ทอง' else 'ทองเหลือง' end, v_price using errcode = '22023', hint = 'metal_price_range';
      end if;
    end if;
    if v_price is null then
      v_missing := v_missing || v_metal;
    else
      v_prices := v_prices || jsonb_build_object(v_metal, v_price);
    end if;
  end loop;
  v_spot := (v_prices ->> 'silver')::numeric;

  select coalesce(jsonb_agg(
      calc.result || jsonb_build_object(
        'item_id', poi.id, 'qty_planned', poi.qty_planned, 'qty_used', q.qty_used,
        'is_new_design', coalesce(poi.is_new_design, false),
        'metal', eff.metal, 'purity', eff.purity, 'weight_g', eff.weight_g, 'weight_source', eff.weight_source
      )
      order by poi.created_at
    ), '[]'::jsonb)
    into v_items
  from analytics.production_order_item poi
  join public.product p on p.id = poi.product_id
  cross join lateral (
    select coalesce(
      (select (ov ->> 'qty_done')::int from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) ov
        where (ov ->> 'product_id')::uuid = poi.product_id),
      poi.qty_planned
    ) as qty_used
  ) q
  cross join lateral analytics.production_item_spec(poi, p) eff
  -- qty_used=0 ต้อง "ไม่พัง" ทั้ง preview (done ข้ามบรรทัดนี้) · ราคาโลหะของรายการนี้ยังไม่มี (R3) = ไม่คิด ไม่เดา
  cross join lateral (
    select case
      when q.qty_used = 0 then jsonb_build_object(
        'product_id', poi.product_id, 'sku', p.sku, 'cost_type', p.cost_type,
        'unit_cost', null, 'skipped', true
      )
      when p.cost_type in ('spot', 'spec') and not jsonb_exists(v_prices, eff.metal) then jsonb_build_object(
        'product_id', poi.product_id, 'sku', p.sku, 'cost_type', p.cost_type,
        'unit_cost', null, 'price_missing', true
      )
      else analytics.production_cost_calc(
        p_shop_id, poi.product_id,
        case when p.cost_type in ('spot', 'spec') then (v_prices ->> eff.metal)::numeric else null end,
        q.qty_used,
        coalesce(poi.is_new_design, false),
        eff.metal, eff.purity, eff.weight_g
      )
    end as result
  ) calc
  where poi.production_order_id = p_production_order_id;

  return jsonb_build_object(
    'production_order_id', p_production_order_id,
    'po_no', v_order.po_no,
    'spot_price_thb_per_gram', v_spot,
    'metal_prices', v_prices,
    'missing_prices', to_jsonb(v_missing),
    'items', v_items
  );
end;
$fn$;
revoke execute on function analytics.production_order_preview(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function analytics.production_order_preview(uuid, uuid, jsonb) to service_role;

-- ============================================================================
-- §11 production_order_done (ลอกสด 0141 · ลำดับ load-bearing เดิมทุกบรรทัด) —
--     p_expected_metal_prices (fail-closed ต่อโลหะ) · sku_required · stamp ค่า effective ลงรายการ
-- ============================================================================
create or replace function analytics.production_order_done(
  p_shop_id uuid, p_production_order_id uuid, p_items jsonb default null::jsonb,
  p_expected_metal_prices jsonb default null::jsonb, p_actor uuid default null::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $fn$
declare
  v_order          analytics.production_order%rowtype;
  v_today          date := (now() at time zone 'Asia/Bangkok')::date;
  v_work           jsonb;
  v_elem           jsonb;
  v_qty_done       int;
  v_total_qty_done numeric := 0;
  v_metals         text[];
  v_metal          text;
  v_prices         jsonb := '{}'::jsonb;
  v_poi            analytics.production_order_item%rowtype;
  v_eff            record;
  v_product        public.product%rowtype;
  v_calc           jsonb;
  v_unit_cost      numeric;
  v_before         jsonb;
  v_after          jsonb;
  v_result         jsonb;
  v_lot_inserted   int;
begin
  if p_shop_id is null or p_production_order_id is null then
    raise exception 'production_order_done: p_shop_id and p_production_order_id are required';
  end if;
  if p_items is not null and jsonb_typeof(p_items) <> 'array' then
    raise exception 'production_order_done: p_items ต้องเป็น json array' using errcode = '22023';
  end if;
  if p_expected_metal_prices is not null and jsonb_typeof(p_expected_metal_prices) <> 'object' then
    raise exception 'production_order_done: p_expected_metal_prices ต้องเป็น json object (โลหะ → ราคาต่อกรัม)' using errcode = '22023', hint = 'expected_prices_invalid';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  -- 0139 fix #3 (deadlock คู่ done×done): lock ต่อ (shop, ฟังก์ชันนี้) ก่อนแตะแถวใดๆ เลย
  perform pg_advisory_xact_lock(hashtext('analytics.production_order_done:' || p_shop_id::text));

  select * into v_order from analytics.production_order
    where id = p_production_order_id and shop_id = p_shop_id
    for update;
  if not found then
    raise exception 'production_order_done: ไม่พบใบผลิต % ในร้านนี้', p_production_order_id using errcode = '22023';
  end if;

  -- idempotency: กด done ซ้ำ (สถานะ done อยู่แล้ว) → คืนผลเดิม ไม่ raise
  if v_order.status = 'done' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'product_id', poi.product_id, 'sku', p.sku, 'qty_done', poi.qty_done,
        'unit_cost', poi.unit_cost, 'prev_cost_type', poi.prev_cost_type, 'prev_unit_cost', poi.prev_unit_cost,
        'cost_calc', poi.cost_calc, 'metal', poi.metal, 'purity', poi.purity, 'weight_g', poi.weight_g
      )), '[]'::jsonb)
      into v_result
    from analytics.production_order_item poi
    join public.product p on p.id = poi.product_id
    where poi.production_order_id = p_production_order_id;

    return jsonb_build_object('production_order_id', p_production_order_id, 'po_no', v_order.po_no,
      'status', v_order.status, 'already_done', true, 'items', v_result);
  end if;

  -- cancelled เป็นปลายทาง — done ทับไม่ได้
  if v_order.status = 'cancelled' then
    raise exception 'production_order_done: ใบ % ถูกยกเลิกไปแล้ว ทำ done ไม่ได้', v_order.po_no using errcode = '22023';
  end if;

  -- 0186: รายการที่ยังไม่มี SKU เข้าสต็อก/คิดต้นทุนไม่ได้ — ปฏิเสธก่อนเข้าเส้นต้นทุนทุกบรรทัด
  if exists (select 1 from analytics.production_order_item i where i.production_order_id = p_production_order_id and i.product_id is null) then
    raise exception 'production_order_done: ใบ % มีรายการที่ยังไม่ผูก SKU — ผูก SKU ให้ครบก่อนผลิตเสร็จ', v_order.po_no using errcode = '22023', hint = 'sku_required';
  end if;

  -- ประกอบ qty_done ต่อ item ครั้งเดียว · order by product_id (0139 fix #3 — ปิด ABBA deadlock)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', poi.id, 'product_id', poi.product_id, 'qty_planned', poi.qty_planned,
      'is_new_design', coalesce(poi.is_new_design, false),
      'qty_done_resolved', coalesce(
        (select (ov ->> 'qty_done')::int from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) ov
          where (ov ->> 'product_id')::uuid = poi.product_id),
        poi.qty_planned
      )
    ) order by poi.product_id), '[]'::jsonb)
    into v_work
  from analytics.production_order_item poi
  where poi.production_order_id = p_production_order_id;

  if v_work = '[]'::jsonb then
    raise exception 'production_order_done: ใบ % ไม่มีรายการให้ผลิต (ใบว่าง)', v_order.po_no using errcode = '22023';
  end if;

  -- รอบที่ 1: validate ทุกบรรทัดก่อนแตะสต็อกบรรทัดแรก
  for v_elem in select * from jsonb_array_elements(v_work) loop
    v_qty_done := (v_elem ->> 'qty_done_resolved')::int;
    if v_qty_done is null or not (v_qty_done >= 0 and v_qty_done <= 100000) then
      raise exception 'production_order_done: qty_done ของ SKU (product_id=%) ต้องอยู่ระหว่าง 0-100000', v_elem ->> 'product_id' using errcode = '22023';
    end if;
    v_total_qty_done := v_total_qty_done + v_qty_done;
  end loop;

  if v_total_qty_done = 0 then
    raise exception 'production_order_done: ทุกรายการในใบ % ผลิตได้ 0 ชิ้น — ถ้าไม่ได้ผลิตจริงให้ยกเลิกใบนี้แทน (analytics.production_order_cancel)', v_order.po_no using errcode = '22023';
  end if;

  -- โลหะที่ต้องใช้ราคา = รายการ spot/spec ที่จะผลิตจริง (qty_done>0) — ห้าม fallback ราคาเมื่อวาน/แถวล่าสุด
  select coalesce(array_agg(distinct eff.metal order by eff.metal), '{}') into v_metals
  from jsonb_array_elements(v_work) e
  join analytics.production_order_item poi on poi.id = (e ->> 'id')::uuid
  join public.product p on p.id = poi.product_id
  cross join lateral analytics.production_item_spec(poi, p) eff
  where p.cost_type in ('spot', 'spec') and (e ->> 'qty_done_resolved')::int > 0;

  foreach v_metal in array v_metals loop
    -- override ของใบใช้กับเงินเท่านั้น (ทอง/ทองเหลืองไม่มีราคาเฉพาะใบ — resolve ปฏิเสธเอง) · ไม่มีราคาของวันนี้ = raise
    v_prices := v_prices || jsonb_build_object(v_metal,
      analytics.production_metal_price_resolve(p_shop_id, v_metal, case when v_metal = 'silver' then v_order.spot_override_thb_per_gram end));
  end loop;

  -- 0132 M1 (fail-closed) ต่อโลหะ: เทียบราคาที่ client "คาดหวัง" กับราคาที่ resolve ได้จริง ณ ตอนนี้
  if array_length(v_metals, 1) is not null then
    if p_expected_metal_prices is null then
      raise exception 'production_order_done: ใบนี้ใช้ราคาโลหะคำนวณต้นทุน ต้องส่งราคาที่หน้าจอเห็น (p_expected_metal_prices) มาด้วยเสมอ — กดยืนยันจากหน้าใบผลิตเท่านั้น'
        using errcode = '22023', hint = 'expected_prices_required';
    end if;
    foreach v_metal in array v_metals loop
      if jsonb_typeof(p_expected_metal_prices -> v_metal) is distinct from 'number' then
        raise exception 'production_order_done: ไม่มีราคา%ที่หน้าจอเห็นมาด้วย (p_expected_metal_prices) — ปิดหน้าต่างแล้วเปิดใบผลิตใหม่อีกครั้ง',
          case v_metal when 'gold' then 'ทอง' when 'brass' then 'ทองเหลือง' else 'เงิน' end using errcode = '22023', hint = 'expected_prices_required';
      end if;
      if not (abs((v_prices ->> v_metal)::numeric - (p_expected_metal_prices ->> v_metal)::numeric) <= 0.0001) then
        -- ชื่อโลหะเป็นไทย (ไม่ใช่รหัส gold/silver) · ใบเงินได้ข้อความเดิม "ราคาเงินเปลี่ยนไประหว่างที่เปิดหน้าต่างนี้ค้างไว้…" ตาม 0132 M1 ที่ UI/เทสต์เดิมพึ่งอยู่
        raise exception 'production_order_done: ราคา%เปลี่ยนไประหว่างที่เปิดหน้าต่างนี้ค้างไว้ (ตอนเปิดหน้าต่างเห็นราคา % บาท/กรัม แต่ตอนนี้ระบบคำนวณได้ % บาท/กรัม) — ปิดหน้าต่างยืนยันนี้แล้วเปิดใบผลิตใหม่อีกครั้งเพื่อดูราคาล่าสุดก่อนยืนยัน',
          case v_metal when 'gold' then 'ทอง' when 'brass' then 'ทองเหลือง' else 'เงิน' end,
          p_expected_metal_prices ->> v_metal, v_prices ->> v_metal using errcode = '22023', hint = 'metal_price_changed';
      end if;
    end loop;
  end if;
  -- key เกินที่ใบนี้ไม่ได้ใช้ = payload เพี้ยน → ปฏิเสธ (ใบ fixed ล้วนส่ง null/{} เท่านั้นถึงผ่าน)
  if p_expected_metal_prices is not null and exists (
       select 1 from jsonb_object_keys(p_expected_metal_prices) k where k <> all (v_metals)) then
    raise exception 'production_order_done: p_expected_metal_prices มีราคาโลหะที่ใบนี้ไม่ได้ใช้ — ปิดหน้าต่างแล้วเปิดใหม่อีกครั้ง' using errcode = '22023', hint = 'expected_prices_extra';
  end if;

  -- รอบที่ 2: mutate จริง — ลำดับ load-bearing เดิม (0131/0132/0138/0139 — ห้ามสลับ):
  -- snapshot item -> ensure central_stock+adjust_stock -> insert stock_lot -> พลิกสถานะเป็นบรรทัดสุดท้าย
  for v_elem in select * from jsonb_array_elements(v_work) loop
    v_qty_done := (v_elem ->> 'qty_done_resolved')::int;

    if v_qty_done = 0 then
      update analytics.production_order_item
         set qty_done = 0, updated_at = now()
       where id = (v_elem ->> 'id')::uuid;
      continue;
    end if;

    select * into v_poi from analytics.production_order_item where id = (v_elem ->> 'id')::uuid;
    select * into v_product from public.product
      where id = (v_elem ->> 'product_id')::uuid and shop_id = p_shop_id
      for update;
    if not found then
      raise exception 'production_order_done: ไม่พบ SKU (product_id=%) ในร้านนี้', v_elem ->> 'product_id' using errcode = '22023';
    end if;
    if not v_product.is_active then
      raise exception 'production_order_done: SKU % ปิดใช้งานแล้ว ผลิตไม่ได้', v_product.sku using errcode = '22023';
    end if;
    if v_product.sku ~* '^live' then
      raise exception 'production_order_done: SKU % เป็น SKU เฉพาะไลฟ์ (live*) ผลิตไม่ได้', v_product.sku using errcode = '22023';
    end if;

    select s.metal, s.purity, s.weight_g, s.weight_source into v_eff from analytics.production_item_spec(v_poi, v_product) s;

    -- 0132 M-b, ขยายต่อโลหะ: product.cost_type ถูกพลิกเป็นโหมดที่ต้องใช้ราคาโลหะคั่นกลาง (READ COMMITTED)
    -- แล้วโลหะของรายการนี้ไม่อยู่ใน map ⇒ ข้ามการเทียบ M1 — raise แทนการเดาต่อ
    if v_product.cost_type in ('spot', 'spec') and not jsonb_exists(v_prices, v_eff.metal) then
      raise exception 'production_order_done: SKU % ถูกเปลี่ยนเป็นโหมดที่ต้องใช้ราคาโลหะระหว่างที่กำลังบันทึกใบนี้ — เปิดใบผลิตใหม่อีกครั้งเพื่อคำนวณต้นทุนใหม่', v_product.sku using errcode = '22023';
    end if;
    v_calc := analytics.production_cost_calc(
      p_shop_id, v_product.id,
      case when v_product.cost_type in ('spot', 'spec') then (v_prices ->> v_eff.metal)::numeric else null end,
      v_qty_done,
      coalesce((v_elem ->> 'is_new_design')::boolean, false),
      v_eff.metal, v_eff.purity, v_eff.weight_g
    );
    v_unit_cost := (v_calc ->> 'unit_cost')::numeric;
    if v_unit_cost is null then
      raise exception 'production_order_done: คำนวณต้นทุน SKU % ไม่ได้ (unit_cost เป็น null)', v_product.sku using errcode = '22023';
    end if;

    v_before := jsonb_build_object('cost_type', v_product.cost_type, 'unit_cost', v_product.unit_cost,
      'track_stock', v_product.track_stock, 'track_stock_since', v_product.track_stock_since);

    -- (1) snapshot ลง item ก่อน — ใบยังเป็น open ตอนนี้ ผ่าน trigger กันแก้ · 0186: stamp ค่า effective (โลหะ/เนื้อ/น้ำหนัก/ที่มา) ลงแถวด้วย
    -- ⇒ ใบที่ done แล้วเก็บ snapshot ครบ (แถวเดิม metal null ก็ได้ค่าที่ใช้จริง) · ค่านอก CHECK (เช่น น้ำหนัก SKU เดิมเกิน 10,000) = ไม่ stamp ค่านั้น ไม่ทำให้ done ล้ม
    update analytics.production_order_item
       set qty_done = v_qty_done, unit_cost = v_unit_cost,
           prev_cost_type = v_product.cost_type, prev_unit_cost = v_product.unit_cost,
           cost_calc = v_calc -> 'cost_calc',
           metal = v_eff.metal,
           purity = case when v_eff.purity is not null and v_eff.purity >= 0.375 and v_eff.purity <= 1 then round(v_eff.purity, 4) end,
           weight_g = case when v_eff.weight_g is not null and v_eff.weight_g > 0 and v_eff.weight_g <= 10000 then round(v_eff.weight_g, 3) end,
           weight_source = case when v_eff.weight_g is not null and v_eff.weight_g > 0 and v_eff.weight_g <= 10000 then v_eff.weight_source end,
           updated_at = now()
     where id = (v_elem ->> 'id')::uuid;

    -- (2) ensure central_stock แถวมีอยู่ก่อนเสมอ
    insert into public.central_stock (product_id) values (v_product.id)
      on conflict (product_id) do nothing;

    perform public.adjust_stock(p_shop_id, v_product.id, v_qty_done, 'po:' || (v_elem ->> 'id'));

    -- (3) เปิด track_stock เหมือนเดิม (ห้ามเลื่อน track_stock_since ถ้าเปิดอยู่แล้ว) — ไม่ stamp cost_type/unit_cost กลับ product (D1, 0138)
    update public.product
       set track_stock = true,
           track_stock_since = coalesce(v_product.track_stock_since, v_today),
           updated_at = now()
     where id = v_product.id;

    -- สร้าง lot ต้นทุนของรอบผลิตนี้ (ครอบทั้ง fixed/spot/spec โดยอัตโนมัติ)
    insert into analytics.stock_lot (
      shop_id, product_id, source, unit_cost, qty_in, qty_remaining, received_on,
      production_order_item_id, note
    ) values (
      p_shop_id, v_product.id, 'production', v_unit_cost, v_qty_done, v_qty_done, v_today,
      (v_elem ->> 'id')::uuid, 'po_no=' || v_order.po_no
    )
    on conflict (production_order_item_id) where production_order_item_id is not null do nothing;

    get diagnostics v_lot_inserted = row_count;
    if v_lot_inserted = 0 then
      raise exception 'production_order_done: พบ lot ต้นทุนของ SKU % ผูกกับรายการนี้อยู่ก่อนแล้ว (ใบ %) — ข้อมูลไม่สอดคล้องกัน ห้ามลองกดใหม่เอง แจ้งทีมพัฒนาก่อน', v_product.sku, v_order.po_no using errcode = '22023';
    end if;

    -- 0186: audit เพิ่ม metal (โลหะของรอบนี้) ใน after — before คือสถานะ product จึงไม่ใส่
    v_after := jsonb_build_object('cost_type', v_product.cost_type, 'unit_cost', v_product.unit_cost,
      'track_stock', true, 'track_stock_since', coalesce(v_product.track_stock_since, v_today), 'metal', v_eff.metal);

    insert into analytics.catalog_audit_log (shop_id, product_id, sku, action, before, after, changed_by)
    values (p_shop_id, v_product.id, v_product.sku, 'edit', v_before, v_after, coalesce(p_actor, auth.uid()));
  end loop;

  -- (4) พลิกสถานะเป็นบรรทัดสุดท้ายของฟังก์ชันเท่านั้น
  update analytics.production_order
     set status = 'done', done_at = now()
   where id = p_production_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', poi.product_id, 'sku', p.sku, 'qty_done', poi.qty_done,
      'unit_cost', poi.unit_cost, 'prev_cost_type', poi.prev_cost_type, 'prev_unit_cost', poi.prev_unit_cost,
      'cost_calc', poi.cost_calc, 'metal', poi.metal, 'purity', poi.purity, 'weight_g', poi.weight_g
    )), '[]'::jsonb)
    into v_result
  from analytics.production_order_item poi
  join public.product p on p.id = poi.product_id
  where poi.production_order_id = p_production_order_id;

  return jsonb_build_object('production_order_id', p_production_order_id, 'po_no', v_order.po_no,
    'status', 'done', 'already_done', false, 'metal_prices', v_prices, 'items', v_result);
end;
$fn$;
revoke execute on function analytics.production_order_done(uuid, uuid, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function analytics.production_order_done(uuid, uuid, jsonb, jsonb, uuid) to service_role;

-- ============================================================================
-- §12 job_source_info (ลอกสดหลัง 0181+0184 — branch oem ไม่แตะ) · branch production: โลหะ/น้ำหนักจาก helper · รองรับรายการไม่มี SKU
--     ใบงานจากรายการทอง ⇒ job.metal = 'gold' ⇒ ด่านทองทุกตัวของ 0175/0176 ทำงานเอง (ไม่แก้ฟังก์ชันเหล่านั้น)
--     สิทธิ์: ฟังก์ชันภายใน (proacl = postgres เท่านั้นตั้งแต่ก่อนไฟล์นี้) — คงเดิม
-- ============================================================================
create or replace function analytics.job_source_info(p_shop_id uuid, p_source_kind text, p_item_id uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $fn$
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
    v_codes := array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'finish', 'buff', 'qc', 'pack'];
    if v_new then v_codes := array['cad', 'print3d', 'mold'] || v_codes; end if;
    if v_gem > 0 then v_codes := v_codes || 'gem_set'::text; end if;
    if v_plating is not null and v_plating not in ('none', 'null') then v_codes := v_codes || 'plating'::text; end if;
    return jsonb_build_object('source_kind', 'oem', 'item_id', v_i.id, 'quote_id', v_i.quote_id, 'root_quote_id', v_i.root_id,
      'item_seq', v_i.seq, 'metal', v_metal, 'qty', v_i.qty, 'is_new_design', v_new, 'design_label', left(v_label, 200),
      'sku', left(v_i.sku_snapshot, 100), 'product_id', v_i.product_id, 'deposit_missing', coalesce(v_paid, 0) <= 0,
      'existing_job', case when v_existing.id is null then null else jsonb_build_object('id', v_existing.id, 'job_no', v_existing.job_no) end,
      'suggested_stage_codes', to_jsonb(analytics.job_sort_stage_codes(p_shop_id, v_codes)),
      'target_piece_g', v_tw, 'target_piece_g_source', v_tw_src);
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
    return jsonb_build_object('source_kind', 'production', 'item_id', v_poi.id, 'metal', v_metal, 'qty', v_poi.qty_planned,
      'is_new_design', coalesce(v_poi.is_new_design, false),
      'design_label', left(coalesce(nullif(btrim(v_prod.name), ''), v_prod.sku, v_poi.pending_product_label), 200),
      'sku', left(v_prod.sku, 100), 'product_id', v_poi.product_id, 'deposit_missing', false,
      'existing_job', case when v_existing.id is null then null else jsonb_build_object('id', v_existing.id, 'job_no', v_existing.job_no) end,
      'suggested_stage_codes', to_jsonb(analytics.job_sort_stage_codes(p_shop_id, v_codes)),
      'target_piece_g', v_tw, 'target_piece_g_source', v_tw_src,
      'purity', v_eff.purity, 'sku_pending', v_poi.product_id is null);
  end if;
  raise exception 'source_kind ต้องเป็น oem หรือ production' using errcode = '22023', hint = 'source_invalid';
end;
$fn$;
revoke execute on function analytics.job_source_info(uuid, text, uuid) from public, anon, authenticated, service_role;

-- ============================================================================
-- §13 job_create_insert (ลอกสด) — ทองไม่ส่งแบบมา + ไม่มีแบบทอง (is_default_gold active) ⇒ raise no_gold_profile (ชั้นที่ 2 — ชั้นแรกคือ §13b)
--     ⚠ ด่านนี้อย่างเดียว "ไม่พอ" บนทางออฟฟิศจริง (security M1 20 ต.ค.): หน้าสร้างใบงานเรียก job_stage_suggest → job_profile_default_for แล้ว UI ส่ง profileId ที่ได้กลับมา
--     ⇒ ไม่เคยเข้ากิ่ง p_profile_id is null · เดิม job_profile_default_for คืนแบบ default ของเงินแทนเมื่อไม่มีแบบทอง ⇒ ใบทองได้กติกาชั่งของเงินเงียบๆ
--     ⇒ ปิดที่ต้นทาง (§13b: ทองไม่มีแบบทอง = คืน null) แล้วด่านในนี้คือเข็มขัดสำหรับ caller ที่ไม่ผ่าน suggest (หน้างานอนาคต W1) — ใส่แบบมาชัดเจนผ่านตามเดิม
-- ============================================================================
create or replace function analytics.job_create_insert(p_shop_id uuid, p_source_kind text, p_oem_item_id uuid, p_root_quote_id uuid, p_oem_item_seq integer, p_poi_id uuid, p_product_id uuid, p_design_label text, p_sku text, p_metal text, p_qty integer, p_due date, p_gate_note text, p_note text, p_codes text[], p_is_new_design boolean, p_actor uuid, p_qty_order integer, p_target_piece_g numeric, p_plan jsonb, p_profile_id uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $fn$
declare
  v_seq    int;
  v_job    analytics.job%rowtype;
  v_warn   text[];
  v_today  date := analytics.job_today();
  v_basis  jsonb;
  v_profile analytics.job_record_profile%rowtype;
  v_apply  jsonb;
begin
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
                             start_gate_note, created_by, note, target_piece_g, metal_plan_g, metal_plan_basis,
                             profile_id, profile_name, require_final_weight)
  values (p_shop_id, v_seq, p_source_kind, p_oem_item_id, p_root_quote_id, p_oem_item_seq, p_poi_id,
          p_product_id, p_design_label, p_sku, p_metal, p_qty_order, p_qty, false, p_due,
          p_gate_note, p_actor, p_note, p_target_piece_g, (p_plan ->> 'metal_plan_g')::numeric, v_basis,
          v_profile.id, v_profile.name, v_profile.require_final_weight)
  returning * into v_job;

  -- 0176: ขั้นเริ่มปิดทั้ง 3 flag แล้ว job_profile_apply ตั้งตามแบบ (ที่เดียวที่ derive flag · ใช้ร่วมกับ job_profile_set) — ตรรกะ metal เดิม (ทอง/เงิน/ทองเหลือง) ถอดแล้ว
  insert into analytics.job_stage (job_id, shop_id, stage_code, seq, weigh_required, scrap_qty_ask, scrap_weight_ask)
  select v_job.id, p_shop_id, a.code, a.ord::int, false, false, false
    from unnest(p_codes) with ordinality as a(code, ord)
    join analytics.job_stage_def d on d.shop_id = p_shop_id and d.code = a.code
   order by a.ord;
  v_apply := analytics.job_profile_apply(v_job.id, v_profile.id);

  perform analytics.job_event_write(v_job.id, null, 'create', v_today, p_actor, null, 'job_page', null,
    jsonb_build_object('source_kind', p_source_kind, 'stage_codes', to_jsonb(p_codes), 'qty_planned', p_qty, 'metal', p_metal,
                       'qty_order', p_qty_order, 'target_piece_g', p_target_piece_g, 'metal_plan_g', v_job.metal_plan_g,
                       'due_date', p_due, 'start_gate_note_present', p_gate_note is not null,
                       'profile_id', v_profile.id, 'profile_name', v_profile.name, 'has_weigh', v_apply -> 'has_weigh',
                       'gold_unguarded', v_apply -> 'gold_unguarded'));

  return jsonb_build_object('job_id', v_job.id, 'job_no', v_job.job_no, 'status', v_job.status, 'metal', v_job.metal,
                            'qty_planned', v_job.qty_planned, 'stage_codes', to_jsonb(p_codes), 'warnings', to_jsonb(v_warn),
                            'start_gate_note_set', p_gate_note is not null,
                            'qty_order', v_job.qty_order, 'under_planned', v_job.qty_planned < v_job.qty_order,
                            'metal_plan_g', v_job.metal_plan_g, 'plan_missing', coalesce(v_basis -> 'missing', '[]'::jsonb),
                            'profile_id', v_profile.id, 'profile_name', v_profile.name, 'has_weigh', v_apply -> 'has_weigh',
                            'gold_unguarded', v_apply -> 'gold_unguarded');
end;
$fn$;
revoke execute on function analytics.job_create_insert(uuid, text, uuid, uuid, integer, uuid, uuid, text, text, text, integer, date, text, text, text[], boolean, uuid, integer, numeric, jsonb, uuid) from public, anon, authenticated, service_role;

-- ============================================================================
-- §13b job_profile_default_for (ลอกสดจาก DB 20 ต.ค. — ผู้เรียกทั้งหมดตรวจแล้ว: job_create_insert · job_stage_suggest · job_record_profile_list · job_record_profile_set_default) — M1
--     ทอง: คืน "แบบทองค่าเริ่ม (is_default_gold) ที่ active" เท่านั้น — ไม่มี = null (ไม่ fallback ไปแบบค่าเริ่มทั่วไปอีก) · โลหะอื่น/null: is_default เดิมเป๊ะ
--     ผลต่อผู้เรียก:
--       • job_stage_suggest → default_profile_id = null สำหรับใบทองที่ร้านไม่มีแบบทอง ⇒ UI (JobCreateDialog) ไม่เลือกแบบให้ บังคับเลือกเอง + บอกเหตุผล (ปุ่มสร้างปิดจนเลือก)
--       • job_create_insert → ไม่ส่งแบบมา = no_gold_profile (§13) · ส่ง profile_id มาชัดเจน = ผ่านตามเดิม (ผู้ใช้เลือกเอง + ack กล่องแดงของทองที่ UI)
--       • job_record_profile_list / set_default → default_gold_profile_id = null เมื่อไม่ได้ตั้ง (เดิมคืนแบบทั่วไปแทน ทำให้หน้าแบบการบันทึกโชว์ผิดว่า "งานทองใช้แบบทั่วไป")
--     สิทธิ์: ฟังก์ชันภายใน (proacl = postgres เท่านั้น ตั้งแต่ก่อนไฟล์นี้) — คงเดิม · signature เดิม (ไม่เกิด overload)
-- ============================================================================
create or replace function analytics.job_profile_default_for(p_shop_id uuid, p_metal text)
 returns uuid
 language sql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $fn$
  select p.id
    from analytics.job_record_profile p
   where p.shop_id = p_shop_id and p.is_active
     and case when p_metal = 'gold' then p.is_default_gold else p.is_default end
   limit 1
$fn$;
revoke execute on function analytics.job_profile_default_for(uuid, text) from public, anon, authenticated, service_role;

-- ============================================================================
-- §14 v_production_order_item — left join product (รายการไม่มี SKU) + ต่อท้ายคอลัมน์ (42P16: 17 คอลัมน์เดิมคงลำดับ/ชนิดเดิมเป๊ะ)
--     security_invoker ต้องระบุซ้ำ (create or replace ไม่การันตีคงตัวเลือกเดิม) · effective_* = ค่าที่ preview/done จะใช้จริง (helper lenient) ·
--     sku_* = ค่าเริ่มของ SKU (ไว้ติดป้าย "จาก SKU / แก้ในใบนี้" — แสดงผลอย่างเดียว)
-- ============================================================================
create or replace view analytics.v_production_order_item
  with (security_invoker = true)
  as
 select poi.id,
    poi.shop_id,
    poi.production_order_id,
    po.po_no,
    po.status as order_status,
    poi.product_id,
    p.sku,
    p.name as product_name,
    p.cost_type as current_cost_type,
    p.unit_cost as current_unit_cost,
    poi.qty_planned,
    poi.qty_done,
    poi.unit_cost as stamped_unit_cost,
    poi.prev_cost_type,
    poi.prev_unit_cost,
    poi.created_at,
    poi.updated_at,
    poi.pending_product_label,
    poi.metal,
    poi.purity,
    poi.weight_g,
    poi.weight_source,
    eff.metal as effective_metal,
    eff.purity as effective_purity,
    eff.weight_g as effective_weight_g,
    eff.weight_source as effective_weight_source,
    skud.metal as sku_metal,
    skud.purity as sku_purity,
    skud.weight_g as sku_weight_g,
    -- coalesce: make_spec ว่างทำให้ `in (...)` เป็น null แล้วทั้งนิพจน์เป็น null (ไม่ใช่ false) — UI ต้องได้ boolean จริงเสมอ
    coalesce(p.id is not null and ((p.make_spec ->> 'metal') in ('silver', 'gold', 'brass') or p.cost_type = 'spot'), false) as sku_metal_known
   from analytics.production_order_item poi
     join analytics.production_order po on po.id = poi.production_order_id
     left join public.product p on p.id = poi.product_id
     cross join lateral analytics.production_item_spec(poi, p, true) eff
     cross join lateral analytics.production_item_spec(null::analytics.production_order_item, p, true) skud;
grant select on analytics.v_production_order_item to service_role;

-- ============================================================================
-- §15 ตรวจสิทธิ์/overload ก่อน golden (ล้ม = raise = ถอยทั้งไฟล์)
-- ============================================================================
do $chk1$
declare
  r record;
  v_n int;
begin
  -- ชื่อที่ต้องเหลือ 1 signature เท่านั้น (ข้อ 1) — ยกเว้น 3 ตัว legacy ที่ rename ไว้ + production_cost_calc ที่มี 5-arg เดิมรอ drop หลัง golden
  for r in select * from (values
      ('production_order_item_set'), ('production_order_preview'), ('production_order_done'), ('job_source_info'),
      ('job_create_insert'), ('job_profile_default_for'), ('oem_metal_price_set'), ('production_spot_resolve'), ('production_metal_price_resolve'),
      ('production_item_spec'), ('production_item_prefill'), ('production_order_item_remove_by_id'), ('oem_metal_price_set_input'),
      ('oem_metal_price_range_ok'), ('oem_metal_price_convert'), ('production_metal_price_today')) as t(n)
  loop
    select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = r.n;
    if v_n <> 1 then
      raise exception '0186 chk1: % มี % signature (คาด 1) — overload หลุด หยุดแล้วรายงาน', r.n, v_n;
    end if;
  end loop;
  select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'production_cost_calc';
  if v_n <> 2 then
    raise exception '0186 chk1: production_cost_calc ต้องมี 2 signature ณ จุดนี้ (5-arg เดิมรอ drop หลัง golden + 8-arg ใหม่) แต่มี %', v_n;
  end if;
  -- anon/authenticated ห้าม execute ทุกตัวที่แตะ (ข้อ 18)
  for r in select p.oid, p.oid::regprocedure::text as sig from pg_proc p
            where p.pronamespace = 'analytics'::regnamespace
              and p.proname in ('production_order_item_set', 'production_order_preview', 'production_order_done', 'job_source_info', 'job_create_insert', 'job_profile_default_for',
                                'oem_metal_price_set', 'production_spot_resolve', 'production_metal_price_resolve', 'production_item_spec', 'production_item_prefill',
                                'production_order_item_remove_by_id', 'oem_metal_price_set_input', 'oem_metal_price_range_ok', 'oem_metal_price_convert',
                                'production_metal_price_today', 'production_cost_calc', 'production_order_item_derive_shop', 'production_order_item_deny_mutation')
  loop
    if has_function_privilege('anon', r.oid, 'execute') or has_function_privilege('authenticated', r.oid, 'execute') then
      raise exception '0186 chk1: % ยังเปิดให้ anon/authenticated execute — ห้าม (ข้อ 18)', r.sig;
    end if;
  end loop;
  -- view ต้องยังเป็น security_invoker (create or replace ไม่การันตี) + 17 คอลัมน์แรกเดิมไม่ขยับ
  if not exists (select 1 from pg_class c where c.oid = 'analytics.v_production_order_item'::regclass and 'security_invoker=true' = any (c.reloptions)) then
    raise exception '0186 chk1: v_production_order_item ไม่ใช่ security_invoker หลัง replace';
  end if;
  if (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
       where table_schema = 'analytics' and table_name = 'v_production_order_item' and ordinal_position <= 17)
     <> 'id,shop_id,production_order_id,po_no,order_status,product_id,sku,product_name,current_cost_type,current_unit_cost,qty_planned,qty_done,stamped_unit_cost,prev_cost_type,prev_unit_cost,created_at,updated_at' then
    raise exception '0186 chk1: 17 คอลัมน์แรกของ v_production_order_item ไม่ตรงของเดิม';
  end if;
end;
$chk1$;

-- ============================================================================
-- §16 GOLDEN REPLAY (ด่านหลักของไฟล์นี้ — ข้อ 11/17) — ฉบับใหม่ต้องได้ "เลขเดิมทุกสตางค์" เทียบฉบับเดิมที่ rename ไว้
--     ⚠ ใบผลิต open จริง 5 ใบบน prod ทุกใบมี SKU fixed ที่ยังไม่มีต้นทุน (unit_cost null) ⇒ ฉบับเดิมเองก็ raise ทุกใบ — เทียบ "ล้มเหมือนกัน" อย่างเดียวพิสูจน์ตัวเลขไม่ได้
--     จึงเทียบ 3 ชั้น (ทุกชั้นอยู่ในทรานแซกชันย่อยที่ rollback เสมอ — ฉีดต้นทุนชั่วคราว/สร้างใบสังเคราะห์ผ่าน RPC แล้วทิ้ง):
--       (A) ใบผลิต open จริงทุกใบ: ฉีด unit_cost ชั่วคราวให้ fixed ที่ยังว่าง (ค่าไม่กลม กันซ่อนบั๊กปัดเศษ) → preview + จำลอง done เดิม vs ใหม่
--       (A2) ใบสังเคราะห์ผ่าน production_order_save/item_set ใหม่ จาก SKU จริง (spot ทั้งหมด + fixed ที่ฉีดต้นทุน) ทั้งมี/ไม่มี override เงิน · p_items qty=0 / qty เปลี่ยน
--            ⇒ ยิงฟังก์ชันใหม่ใส่ข้อมูลทุกโหมดที่มีจริงบน prod (ข้อ 17) · ฉบับเดิมคิดจากแถวที่ item_set ใหม่สร้าง (มีคอลัมน์โลหะ) ต้องได้เลขเดิม
--       (B) cost_calc ทุก SKU active (fixed/spot) · (C) job_source_info ทุกรายการใบผลิต + ใบเสนอราคา OEM
--     ล้มสักข้อ = raise = ถอยทั้งไฟล์ (ไม่ commit) · ท้ายไฟล์ §18 เทียบ snapshot §0 ว่าไม่มีอะไรรั่วออกจากทรานแซกชันย่อย
-- ============================================================================
create function pg_temp.m186_strip_preview(p_new jsonb) returns jsonb language sql immutable as $st$
  -- ตัดคีย์ใหม่ (additive) ก่อนเทียบ: ระดับใบ metal_prices/missing_prices · ระดับรายการ metal/purity/weight_g/weight_source/price_missing · ใน cost_calc metal/purity/weight_g
  select (p_new - 'metal_prices' - 'missing_prices') || jsonb_build_object('items', (
    select coalesce(jsonb_agg(
      (case when jsonb_typeof(i -> 'cost_calc') = 'object'
            then jsonb_set(i, '{cost_calc}', (i -> 'cost_calc') - 'metal' - 'purity' - 'weight_g') else i end)
      - 'metal' - 'purity' - 'weight_g' - 'weight_source' - 'price_missing'), '[]'::jsonb)
    from jsonb_array_elements(p_new -> 'items') i))
$st$;

create function pg_temp.m186_strip_done(p_res jsonb, p_new boolean) returns jsonb language sql immutable as $st$
  select jsonb_build_object('status', p_res ->> 'status', 'already_done', p_res -> 'already_done',
    'items', (select coalesce(jsonb_agg(
        (case when p_new and jsonb_typeof(i -> 'cost_calc') = 'object'
              then jsonb_set(i, '{cost_calc}', (i -> 'cost_calc') - 'metal' - 'purity' - 'weight_g') else i end)
        - case when p_new then 'metal' else 'x' end - case when p_new then 'purity' else 'x' end - case when p_new then 'weight_g' else 'x' end
        order by i ->> 'product_id'), '[]'::jsonb) from jsonb_array_elements(p_res -> 'items') i))
$st$;

-- เทียบเดิม/ใหม่ของ 1 ใบ (preview + done จำลอง) — คืน {fail, prev_ok, done_ok, both_err} · ต้องเรียกใน sub-block ที่ผู้เรียก rollback เอง
create function pg_temp.m186_cmp(p_shop uuid, p_order uuid, p_label text, p_items jsonb) returns jsonb language plpgsql as $cmp$
declare
  v_leg jsonb; v_new jsonb; v_leg_e text; v_new_e text; v_leg_s jsonb; v_new_s jsonb;
  v_exp_leg numeric; v_exp_new jsonb; v_leg_lot jsonb; v_new_lot jsonb; v_leg_stk jsonb; v_new_stk jsonb;
  v_fail text := ''; v_prev int := 0; v_done int := 0; v_both int := 0;
  v_leg_prev jsonb; v_new_prev jsonb;
begin
  -- preview เดิม vs ใหม่
  begin v_leg_prev := analytics.production_order_preview_legacy186(p_shop, p_order, p_items);
  exception when others then v_leg_e := sqlstate; end;
  begin v_new_prev := analytics.production_order_preview(p_shop, p_order, p_items);
  exception when others then v_new_e := sqlstate; end;
  if v_leg_e is not null or v_new_e is not null then
    if v_leg_e is distinct from v_new_e then
      v_fail := v_fail || format('[%s] preview ล้มไม่เหมือนกัน (เดิม=%s ใหม่=%s)', p_label, coalesce(v_leg_e, 'ok'), coalesce(v_new_e, 'ok')) || E'\n';
    else v_both := v_both + 1; end if;
    return jsonb_build_object('fail', v_fail, 'prev_ok', 0, 'done_ok', 0, 'both_err', v_both);
  end if;
  v_prev := 1;
  if pg_temp.m186_strip_preview(v_new_prev) is distinct from v_leg_prev then
    v_fail := v_fail || format('[%s] preview ไม่เท่าเดิม', p_label) || E'\n   เดิม: ' || left(v_leg_prev::text, 700) || E'\n   ใหม่: ' || left(pg_temp.m186_strip_preview(v_new_prev)::text, 700) || E'\n';
  end if;
  if jsonb_array_length(v_new_prev -> 'missing_prices') <> 0 then
    v_fail := v_fail || format('[%s] missing_prices ต้องว่างเมื่อราคาครบ', p_label) || E'\n';
  end if;

  -- done เดิม vs ใหม่ (ทรานแซกชันย่อยที่ rollback ทุกครั้ง) — ราคาอ้างอิงเอาจาก preview ของแต่ละฉบับเอง (เหมือนที่หน้าจอส่งกลับ)
  v_exp_leg := (v_leg_prev ->> 'spot_price_thb_per_gram')::numeric;
  v_exp_new := v_new_prev -> 'metal_prices';
  v_leg_e := null; v_new_e := null;
  begin
    v_leg := analytics.production_order_done_legacy186(p_shop, p_order, p_items, v_exp_leg, null);
    select jsonb_agg(jsonb_build_object('p', l.product_id, 'u', l.unit_cost, 'qi', l.qty_in, 'qr', l.qty_remaining) order by l.product_id) into v_leg_lot
      from analytics.stock_lot l where l.production_order_item_id in (select i.id from analytics.production_order_item i where i.production_order_id = p_order);
    select jsonb_agg(jsonb_build_object('p', cs.product_id, 'q', cs.qty_on_hand) order by cs.product_id) into v_leg_stk
      from public.central_stock cs where cs.product_id in (select i.product_id from analytics.production_order_item i where i.production_order_id = p_order);
    raise exception 'golden_rollback_186';
  exception when others then
    if sqlerrm <> 'golden_rollback_186' then v_leg_e := sqlstate || ':' || left(sqlerrm, 200); end if;
  end;
  begin
    v_new := analytics.production_order_done(p_shop, p_order, p_items, v_exp_new, null);
    select jsonb_agg(jsonb_build_object('p', l.product_id, 'u', l.unit_cost, 'qi', l.qty_in, 'qr', l.qty_remaining) order by l.product_id) into v_new_lot
      from analytics.stock_lot l where l.production_order_item_id in (select i.id from analytics.production_order_item i where i.production_order_id = p_order);
    select jsonb_agg(jsonb_build_object('p', cs.product_id, 'q', cs.qty_on_hand) order by cs.product_id) into v_new_stk
      from public.central_stock cs where cs.product_id in (select i.product_id from analytics.production_order_item i where i.production_order_id = p_order);
    raise exception 'golden_rollback_186';
  exception when others then
    if sqlerrm <> 'golden_rollback_186' then v_new_e := sqlstate || ':' || left(sqlerrm, 200); end if;
  end;
  if v_leg_e is not null or v_new_e is not null then
    if left(coalesce(v_leg_e, 'ok'), 5) is distinct from left(coalesce(v_new_e, 'ok'), 5) then
      v_fail := v_fail || format('[%s] done ล้มไม่เหมือนกัน (เดิม=%s ใหม่=%s)', p_label, coalesce(v_leg_e, 'ok'), coalesce(v_new_e, 'ok')) || E'\n';
    else v_both := v_both + 1; end if;
  else
    v_done := 1;
    v_leg_s := pg_temp.m186_strip_done(v_leg, false);
    v_new_s := pg_temp.m186_strip_done(v_new, true);
    if v_new_s is distinct from v_leg_s then
      v_fail := v_fail || format('[%s] ผล done ไม่เท่าเดิม', p_label) || E'\n   เดิม: ' || left(v_leg_s::text, 700) || E'\n   ใหม่: ' || left(v_new_s::text, 700) || E'\n';
    end if;
    if v_new_lot is distinct from v_leg_lot then
      v_fail := v_fail || format('[%s] stock_lot.unit_cost/จำนวน ไม่เท่าเดิม', p_label) || E'\n   เดิม: ' || coalesce(v_leg_lot::text, 'null') || E'\n   ใหม่: ' || coalesce(v_new_lot::text, 'null') || E'\n';
    end if;
    if v_new_stk is distinct from v_leg_stk then
      v_fail := v_fail || format('[%s] central_stock ไม่เท่าเดิม', p_label) || E'\n';
    end if;
  end if;
  return jsonb_build_object('fail', v_fail, 'prev_ok', v_prev, 'done_ok', v_done, 'both_err', v_both);
end;
$cmp$;

do $gold$
declare
  v_o        record;
  v_p        record;
  v_r        jsonb;
  v_leg      jsonb;
  v_new      jsonb;
  v_leg_e    text;
  v_new_e    text;
  v_fail     text := '';
  v_n_prev   int := 0;
  v_n_done   int := 0;
  v_n_cost   int := 0;
  v_n_job    int := 0;
  v_n_both_err int := 0;
  v_n_cases  int := 0;
  v_price    numeric;
  v_hint     text;
  v_shop     uuid;
  v_ord      uuid;
  v_ord2     uuid;
  v_spot1    uuid;
  v_fixed1   uuid;
  v_latest   numeric;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- (A) ใบผลิต open จริงทุกใบ — ฉีด unit_cost ชั่วคราว (ทรานแซกชันย่อย rollback ทุกครั้ง) ให้ fixed ที่ยังว่าง แล้วเทียบเดิม/ใหม่
  for v_o in select po.id, po.shop_id, po.po_no from analytics.production_order po where po.status = 'open' order by po.seq loop
    begin
      update public.product p set unit_cost = round(100 + (abs(hashtext(p.id::text)) % 9973) * 0.0137, 2)
       where p.unit_cost is null and p.cost_type = 'fixed'
         and p.id in (select i.product_id from analytics.production_order_item i where i.production_order_id = v_o.id);
      -- ไม่มีราคาเงินวันนี้ = ใช้ราคาล่าสุดที่มีจริงเป็นของวันนี้ (เฉพาะในทรานแซกชันย่อยนี้) — ไม่คิดเลขใหม่เอง
      insert into analytics.oem_metal_price (shop_id, metal, as_of_date, price_thb_per_gram, source)
        select v_o.shop_id, 'silver', (now() at time zone 'Asia/Bangkok')::date, m.price_thb_per_gram, 'manual'
          from analytics.oem_metal_price m where m.shop_id = v_o.shop_id and m.metal = 'silver' order by m.as_of_date desc limit 1
        on conflict (shop_id, metal, as_of_date) do nothing;
      v_r := pg_temp.m186_cmp(v_o.shop_id, v_o.id, 'A ' || v_o.po_no, null);
      v_fail := v_fail || (v_r ->> 'fail');
      v_n_prev := v_n_prev + (v_r ->> 'prev_ok')::int; v_n_done := v_n_done + (v_r ->> 'done_ok')::int; v_n_both_err := v_n_both_err + (v_r ->> 'both_err')::int;
      v_n_cases := v_n_cases + 1;
      raise exception 'golden_rollback_186';
    exception when others then
      if sqlerrm <> 'golden_rollback_186' then v_fail := v_fail || format('[A %s] error ที่ไม่คาด: %s %s', v_o.po_no, sqlstate, left(sqlerrm, 300)) || E'\n'; end if;
    end;
  end loop;

  -- (A2) ใบสังเคราะห์จาก SKU จริง ผ่านฟังก์ชันใหม่ (ทั้งมี/ไม่มี override เงินของใบ · qty override ใน p_items)
  select po.shop_id into v_shop from analytics.production_order po order by po.created_at limit 1;
  if v_shop is not null then
    begin
      update public.product p set unit_cost = round(100 + (abs(hashtext(p.id::text)) % 9973) * 0.0137, 2)
       where p.id in (select f.id from public.product f where f.shop_id = v_shop and f.is_active and f.cost_type = 'fixed' and f.unit_cost is null and f.sku !~* '^live' order by f.sku limit 4);
      insert into analytics.oem_metal_price (shop_id, metal, as_of_date, price_thb_per_gram, source)
        select v_shop, 'silver', (now() at time zone 'Asia/Bangkok')::date, m.price_thb_per_gram, 'manual'
          from analytics.oem_metal_price m where m.shop_id = v_shop and m.metal = 'silver' order by m.as_of_date desc limit 1
        on conflict (shop_id, metal, as_of_date) do nothing;
      v_ord := (analytics.production_order_save(v_shop, null, 'golden186 a', null) ->> 'id')::uuid;
      v_ord2 := (analytics.production_order_save(v_shop, null, 'golden186 b', 66.5) ->> 'id')::uuid;
      v_spot1 := null; v_fixed1 := null;
      for v_p in select p.id, p.cost_type, row_number() over (partition by p.cost_type order by p.sku) as rn
                   from public.product p
                  where p.shop_id = v_shop and p.is_active and p.sku !~* '^live'
                    and ((p.cost_type = 'spot') or (p.cost_type = 'fixed' and p.unit_cost is not null))
                  order by p.cost_type, p.sku loop
        if v_p.rn <= 5 then
          perform analytics.production_order_item_set(v_shop, v_ord, v_p.id, (v_p.rn::int * 3) + 1);
          perform analytics.production_order_item_set(v_shop, v_ord2, v_p.id, (v_p.rn::int * 2) + 2, case when v_p.cost_type = 'spot' then false end);
          if v_p.cost_type = 'spot' and v_spot1 is null then v_spot1 := v_p.id; end if;
          if v_p.cost_type = 'fixed' and v_fixed1 is null then v_fixed1 := v_p.id; end if;
        end if;
      end loop;
      -- a: ราคาเงินวันนี้ · b: override 66.5 — แต่ละใบเทียบ 3 แบบ: ตามแผน / รายการแรก qty=0 (skip) / qty ทุกรายการแรกเปลี่ยน
      for v_o in select v_ord as id, 'syn-a' as lbl union all select v_ord2, 'syn-b' loop
        v_r := pg_temp.m186_cmp(v_shop, v_o.id, v_o.lbl || ' plan', null);
        v_fail := v_fail || (v_r ->> 'fail'); v_n_prev := v_n_prev + (v_r ->> 'prev_ok')::int; v_n_done := v_n_done + (v_r ->> 'done_ok')::int; v_n_both_err := v_n_both_err + (v_r ->> 'both_err')::int; v_n_cases := v_n_cases + 1;
        if v_spot1 is not null then
          v_r := pg_temp.m186_cmp(v_shop, v_o.id, v_o.lbl || ' spot-qty0', jsonb_build_array(jsonb_build_object('product_id', v_spot1, 'qty_done', 0)));
          v_fail := v_fail || (v_r ->> 'fail'); v_n_prev := v_n_prev + (v_r ->> 'prev_ok')::int; v_n_done := v_n_done + (v_r ->> 'done_ok')::int; v_n_both_err := v_n_both_err + (v_r ->> 'both_err')::int; v_n_cases := v_n_cases + 1;
        end if;
        if v_spot1 is not null and v_fixed1 is not null then
          v_r := pg_temp.m186_cmp(v_shop, v_o.id, v_o.lbl || ' qty-override', jsonb_build_array(
            jsonb_build_object('product_id', v_spot1, 'qty_done', 2), jsonb_build_object('product_id', v_fixed1, 'qty_done', 9)));
          v_fail := v_fail || (v_r ->> 'fail'); v_n_prev := v_n_prev + (v_r ->> 'prev_ok')::int; v_n_done := v_n_done + (v_r ->> 'done_ok')::int; v_n_both_err := v_n_both_err + (v_r ->> 'both_err')::int; v_n_cases := v_n_cases + 1;
        end if;
      end loop;
      raise exception 'golden_rollback_186';
    exception when others then
      if sqlerrm <> 'golden_rollback_186' then v_fail := v_fail || format('[A2] error ที่ไม่คาด: %s %s', sqlstate, left(sqlerrm, 300)) || E'\n'; end if;
    end;
  end if;

  -- (B) cost_calc ทุก SKU active โหมด fixed/spot — เดิม 5-arg vs ใหม่ 8-arg (ไม่ส่ง p_metal = ค่า effective ของ SKU) · spot ใช้ราคาเงินวันนี้ (ไม่มี = ข้าม spot)
  for v_p in select p.id, p.shop_id, p.sku, p.cost_type from public.product p where p.is_active and p.cost_type in ('fixed', 'spot') order by p.sku loop
    v_price := analytics.production_metal_price_today(v_p.shop_id, 'silver');
    if v_p.cost_type = 'spot' and v_price is null then continue; end if;
    v_leg := null; v_new := null; v_leg_e := null; v_new_e := null;
    begin v_leg := analytics.production_cost_calc(v_p.shop_id, v_p.id, case when v_p.cost_type = 'spot' then v_price end, 3, false);
    exception when others then v_leg_e := sqlstate; end;
    begin v_new := analytics.production_cost_calc(v_p.shop_id, v_p.id, case when v_p.cost_type = 'spot' then v_price end, 3, false, null, null, null);
    exception when others then v_new_e := sqlstate; end;
    if v_leg_e is not null or v_new_e is not null then
      if v_leg_e is distinct from v_new_e then
        v_fail := v_fail || format('[B %s] cost_calc ล้มไม่เหมือนกัน (เดิม=%s ใหม่=%s)', v_p.sku, coalesce(v_leg_e, 'ok'), coalesce(v_new_e, 'ok')) || E'\n';
      else v_n_both_err := v_n_both_err + 1; end if;
    else
      v_n_cost := v_n_cost + 1;
      if (v_new - 'metal' - 'purity' - 'weight_g') is distinct from v_leg then
        v_fail := v_fail || format('[B %s] cost_calc ไม่เท่าเดิม', v_p.sku) || E'\n   เดิม: ' || left(v_leg::text, 400) || E'\n   ใหม่: ' || left((v_new - 'metal' - 'purity' - 'weight_g')::text, 400) || E'\n';
      end if;
    end if;
  end loop;

  -- (C) job_source_info: ทุกรายการใบผลิต (ทุกสถานะใบ — ใบไม่ open ต้อง raise เหมือนกัน) + ทุกรายการใบเสนอราคา OEM (ทุกสถานะ)
  for v_o in select i.id as item_id, i.shop_id, 'production'::text as kind from analytics.production_order_item i
             union all select q.id, q.shop_id, 'oem'::text from analytics.oem_quote_item q loop
    v_leg := null; v_new := null; v_leg_e := null; v_new_e := null;
    -- ล้มแล้วเทียบ sqlstate + hint (hint คือรหัสเหตุผลของด่าน เช่น po_not_open/quote_not_won/item_not_found)
    begin v_leg := analytics.job_source_info_legacy186(v_o.shop_id, v_o.kind, v_o.item_id);
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      v_leg_e := sqlstate || '|' || coalesce(v_hint, '');
    end;
    begin v_new := analytics.job_source_info(v_o.shop_id, v_o.kind, v_o.item_id);
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      v_new_e := sqlstate || '|' || coalesce(v_hint, '');
    end;
    if v_leg_e is not null or v_new_e is not null then
      if v_leg_e is distinct from v_new_e then
        v_fail := v_fail || format('[C %s %s] job_source_info ล้มไม่เหมือนกัน (เดิม=%s ใหม่=%s)', v_o.kind, v_o.item_id, coalesce(v_leg_e, 'ok'), coalesce(v_new_e, 'ok')) || E'\n';
      else v_n_both_err := v_n_both_err + 1; end if;
    else
      v_n_job := v_n_job + 1;
      if (v_new - 'purity' - 'sku_pending') is distinct from v_leg then
        v_fail := v_fail || format('[C %s %s] job_source_info ไม่เท่าเดิม', v_o.kind, v_o.item_id) || E'\n   เดิม: ' || left(v_leg::text, 500) || E'\n   ใหม่: ' || left((v_new - 'purity' - 'sku_pending')::text, 500) || E'\n';
      end if;
    end if;
  end loop;

  if v_fail <> '' then
    raise exception E'0186 GOLDEN REPLAY ล้ม — ฉบับใหม่ไม่เท่าฉบับเดิม (ไม่ commit):\n%', v_fail;
  end if;
  -- ต้องได้ตัวเลขจริงเทียบอย่างน้อยหนึ่งชุดในแต่ละชั้น ไม่ใช่ "ล้มเหมือนกัน" ล้วน (ข้อ 17 — ผ่านโดยไม่มีความหมาย)
  if v_n_prev = 0 or v_n_done = 0 or v_n_cost = 0 or v_n_job = 0 then
    raise exception '0186 golden: ไม่มีเคสที่เทียบตัวเลขสำเร็จจริง (preview=% done=% cost_calc=% job_source_info=%) — golden ว่างเปล่า ไม่นับว่าผ่าน', v_n_prev, v_n_done, v_n_cost, v_n_job;
  end if;
  raise notice '0186 golden replay ผ่าน: % ใบ/ชุด · preview เทียบตัวเลขสำเร็จ % · done(จำลอง) เทียบตัวเลขสำเร็จ % · cost_calc % SKU · job_source_info % รายการ · ล้มเหมือนกันทั้งคู่ % (นับผ่านเฉพาะ sqlstate/hint ตรงกัน)',
    v_n_cases, v_n_prev, v_n_done, v_n_cost, v_n_job, v_n_both_err;
end;
$gold$;
drop function pg_temp.m186_cmp(uuid, uuid, text, jsonb);
drop function pg_temp.m186_strip_done(jsonb, boolean);
drop function pg_temp.m186_strip_preview(jsonb);

-- ============================================================================
-- §17 golden ผ่านแล้ว → drop ฟังก์ชันเดิม (legacy + production_cost_calc 5-arg)
-- ============================================================================
drop function analytics.production_order_preview_legacy186(uuid, uuid, jsonb);
drop function analytics.production_order_done_legacy186(uuid, uuid, jsonb, numeric, uuid);
drop function analytics.job_source_info_legacy186(uuid, text, uuid);
drop function analytics.production_cost_calc(uuid, uuid, numeric, integer, boolean);

-- ============================================================================
-- §18 ตรวจท้ายไฟล์ (ล้ม = raise = ถอยทั้งไฟล์): overload = 1 แถว · legacy หมด · snapshot ไม่ขยับ · ข้อมูลเดิมครบ
-- ============================================================================
do $post$
declare
  r record;
  v_n int;
  v_base record;
  v_now_md5 text;
begin
  for r in select * from (values
      ('production_order_item_set'), ('production_order_preview'), ('production_order_done'), ('job_source_info'),
      ('job_create_insert'), ('job_profile_default_for'), ('oem_metal_price_set'), ('production_spot_resolve'), ('production_metal_price_resolve'),
      ('production_item_spec'), ('production_item_prefill'), ('production_order_item_remove_by_id'), ('oem_metal_price_set_input'),
      ('oem_metal_price_range_ok'), ('oem_metal_price_convert'), ('production_metal_price_today'), ('production_cost_calc')) as t(n)
  loop
    select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = r.n;
    if v_n <> 1 then
      raise exception '0186 post: % มี % signature (คาด 1) — overload หลุด หยุดแล้วรายงาน อย่าลบเอง', r.n, v_n;
    end if;
  end loop;
  select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname like '%legacy186';
  if v_n <> 0 then
    raise exception '0186 post: ยังมีฟังก์ชัน *_legacy186 ค้าง % ตัว', v_n;
  end if;
  -- service_role ต้อง execute ได้ทุกตัวที่ app เรียก / ตัวช่วยที่ view-CHECK ใช้
  for r in select p.oid, p.oid::regprocedure::text as sig from pg_proc p
            where p.pronamespace = 'analytics'::regnamespace
              and p.proname in ('production_order_item_set', 'production_order_preview', 'production_order_done', 'oem_metal_price_set', 'production_spot_resolve',
                                'production_metal_price_resolve', 'production_item_spec', 'production_item_prefill', 'production_order_item_remove_by_id',
                                'oem_metal_price_set_input', 'oem_metal_price_range_ok', 'production_cost_calc')
  loop
    if not has_function_privilege('service_role', r.oid, 'execute') then
      raise exception '0186 post: % ไม่มี execute ให้ service_role — app เรียกไม่ได้', r.sig;
    end if;
    if has_function_privilege('anon', r.oid, 'execute') or has_function_privilege('authenticated', r.oid, 'execute') then
      raise exception '0186 post: % เปิดให้ anon/authenticated — ห้าม (ข้อ 18)', r.sig;
    end if;
  end loop;
  -- ตัวช่วยภายในต้องไม่เปิดให้ใครเรียกจากนอก (job_source_info/job_create_insert/convert/today = postgres เท่านั้น)
  for r in select p.oid, p.oid::regprocedure::text as sig from pg_proc p
            where p.pronamespace = 'analytics'::regnamespace and p.proname in ('job_source_info', 'job_create_insert', 'job_profile_default_for', 'oem_metal_price_convert', 'production_metal_price_today')
  loop
    if has_function_privilege('service_role', r.oid, 'execute') or has_function_privilege('anon', r.oid, 'execute') or has_function_privilege('authenticated', r.oid, 'execute') then
      raise exception '0186 post: % ต้องเป็นฟังก์ชันภายใน (postgres เท่านั้น) แต่ยังเปิดให้ role อื่น', r.sig;
    end if;
  end loop;
  -- proacl ของ job_profile_default_for ต้องเหมือนก่อนไฟล์นี้เป๊ะ ({postgres=X/postgres}) — ไม่ได้เปิดสิทธิ์เพิ่มตอน replace
  if (select p.proacl::text from pg_proc p where p.oid = 'analytics.job_profile_default_for(uuid,text)'::regprocedure) is distinct from '{postgres=X/postgres}' then
    raise exception '0186 post: proacl ของ job_profile_default_for เปลี่ยนจากเดิม {postgres=X/postgres}';
  end if;

  -- snapshot §0: product / v_dim_product / สต็อก / lot / ledger / สถานะใบ / รายการใบผลิต (ไม่นับคอลัมน์ใหม่) / ใบงาน ต้องเท่าเดิมเป๊ะ
  -- (golden จำลอง done ในทรานแซกชันย่อยที่ rollback — ถ้าตัวใดรั่ว ตรงนี้จะจับได้และถอยทั้งไฟล์)
  select * into v_base from _m186_base;
  select coalesce(md5(string_agg(p::text, '|' order by p.id)), '') into v_now_md5 from public.product p;
  if v_now_md5 <> v_base.product_md5 then raise exception '0186 post: public.product ขยับ (md5 ไม่เท่าเดิม) — ห้าม: migration นี้ไม่แตะ catalog'; end if;
  select coalesce(md5(string_agg(v.product_id::text || ':' || coalesce(v.effective_unit_cost::text, 'NULL'), ',' order by v.product_id)), '') into v_now_md5 from analytics.v_dim_product v;
  if v_now_md5 <> v_base.dim_md5 then raise exception '0186 post: v_dim_product.effective_unit_cost ขยับ — ห้าม'; end if;
  if (select count(*) from analytics.stock_lot) <> v_base.lot_n then raise exception '0186 post: จำนวน stock_lot ขยับ'; end if;
  select coalesce(md5(string_agg(cs::text, '|' order by cs.product_id)), '') into v_now_md5 from public.central_stock cs;
  if v_now_md5 <> v_base.stock_md5 then raise exception '0186 post: central_stock ขยับ'; end if;
  if (select count(*) from public.stock_ledger) <> v_base.ledger_n then raise exception '0186 post: stock_ledger ขยับ'; end if;
  select coalesce(md5(string_agg(po.id::text || ':' || po.status, ',' order by po.id)), '') into v_now_md5 from analytics.production_order po;
  if v_now_md5 <> v_base.po_status_md5 then raise exception '0186 post: สถานะใบผลิตขยับ — golden รั่ว?'; end if;
  select coalesce(md5(string_agg((to_jsonb(poi) - 'pending_product_label' - 'metal' - 'purity' - 'weight_g' - 'weight_source')::text, '|' order by poi.id)), '') into v_now_md5 from analytics.production_order_item poi;
  if v_now_md5 <> v_base.poi_md5 then raise exception '0186 post: รายการใบผลิตเดิมขยับ (ไม่ UPDATE แถวเดิม — ข้อ 19)'; end if;
  if exists (select 1 from analytics.production_order_item poi where poi.metal is not null or poi.purity is not null or poi.weight_g is not null or poi.weight_source is not null or poi.pending_product_label is not null) then
    raise exception '0186 post: แถวเดิมต้องมีคอลัมน์ใหม่เป็น null ทั้งหมด (ไม่ backfill)';
  end if;
  select coalesce(md5(string_agg(j::text, '|' order by j.id)), '') into v_now_md5 from analytics.job j;
  if v_now_md5 <> v_base.job_md5 then raise exception '0186 post: ใบงานขยับ'; end if;
  -- ราคาโลหะเดิม: CHECK ใหม่ต้องรับแถวเก่าได้ทั้งหมด (ตาราง validated ตอน add constraint แล้ว — ตรวจซ้ำให้เห็นชัด)
  if exists (select 1 from analytics.oem_metal_price m where m.metal <> 'silver' and not analytics.oem_metal_price_range_ok(m.metal, m.price_thb_per_gram)) then
    raise exception '0186 post: มีแถวราคาทอง/ทองเหลืองเดิมนอกช่วง (ไม่ควรถึงจุดนี้ — CHECK ผ่านแล้ว)';
  end if;
end;
$post$;

-- ============================================================================
-- หนี้/ข้อจำกัด/ตัดสินใจเอง (นอกเหนือบรีฟ — รายงานแล้ว)
--  • ไม่มี RPC "ผูก SKU" (production_order_item_bind_product — UX C.3 R2) และ "แก้ชื่อแบบก่อนผูก" — เป็นของ W1 (OfficeAck/ผูก SKU ต้องแตะใบงานที่ผูกอยู่ด้วย) · ตอนนี้รายการไม่มี SKU ลบได้ (remove_by_id) แต่ยังผูกไม่ได้
--  • done เขียนค่า effective ลง production_order_item (metal/purity/weight_g/weight_source) รวมแถวเดิม — snapshot ครบ · ค่านอก CHECK (เช่น น้ำหนัก SKU เดิมเกิน 10,000) ไม่ stamp ค่านั้น (ไม่ทำให้ done ล้ม)
--  • production_order_done: audit catalog_audit_log เพิ่ม metal ใน after เท่านั้น (before = สถานะ product ไม่มีเรื่องโลหะ)
--  • job_profile_default_for แก้แล้ว (§13b · security M1): ทองไม่มีแบบทองค่าเริ่ม = null ไม่ fallback — ด่าน no_gold_profile ใน job_create_insert จึงเป็นชั้นที่ 2 (กัน caller ที่ไม่ผ่าน suggest)
--    ผลข้างเคียงที่ตั้งใจ: job_record_profile_list/set_default คืน default_gold_profile_id = null เมื่อไม่ได้ตั้ง (เดิมคืนแบบทั่วไป) · verify-0176 P2d/MU-11 คาดผลเดิม (ทองใช้ค่าเริ่มทั่วไป) = ถูกแทนที่
--  • oem_metal_price_set: ทอง/ทองเหลืองลง p_as_of อนาคตไม่ได้ (as_of_future · L1) · oem_metal_price_set_input ไม่มี p_as_of (วันนี้เท่านั้น) จึงไม่มีช่องนี้
--  • production_order_item_remove_by_id: ใบงานที่ยกเลิกหมดแล้วก็ยังลบรายการไม่ได้ (FK job.production_order_item_id restrict — ใบงานที่ยกเลิกเก็บเป็นหลักฐาน) = hint job_history · รายการไม่มี SKU ที่ติดสถานะนี้ต้องยกเลิกทั้งใบผลิตแล้วเปิดใหม่ (soft-remove ต้องกรองทุกเส้นต้นทุน — รอ W1)
--  • ราคาทองเหลือง 25 ส.ค. เดิม = 1.0000 บาท/กรัม = ขอบบนของช่วงใหม่พอดี (1,000 บาท/กก.) — ผ่านด่าน แต่ควรให้เจ้าของยืนยันว่าเป็นค่าจริง ไม่ใช่ค่าตั้งต้น
--  • v_production_order_job_mismatch ยัง join product แบบ inner — รายการไม่มี SKU ไม่มีวัน done (sku_required) จึงไม่ตกหล่นจริง
--  • สเปคใน SKU (make_spec) ยังเงินอย่างเดียว (product_make_spec_set whitelist) — โลหะของรายการทับตอนคิด spec cost เท่านั้น
-- rollback (ถ้าจำเป็นหลัง apply): ต้อง migration ใหม่ที่ restore definition เดิมของ 0141/0142/0144/0175(+0181/0184)/0129 + drop คอลัมน์ใหม่ — ห้ามแก้ประวัติ

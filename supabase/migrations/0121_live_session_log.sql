-- 0121_live_session_log.sql
--
-- Why: เจ้าของอยากรู้ผลไลฟ์รายคืน (ยอด/ออเดอร์/ชม.พีค) แต่ 3J ไม่มีระบบจับเวลาไลฟ์
-- อัตโนมัติ (public.live_session ใน 0008 คือคนละเรื่อง — จดออเดอร์เร็วตอนไลฟ์ผ่าน
-- channel_account, real-time, ผูกกับ orders.live_session_id โดยตรง; ตารางนี้คือ
-- "log สรุปรายคืน" กรอกย้อนหลัง/มือผ่านแชทกับเจ้าของ ไม่ผูกกับออเดอร์เป็นแถวๆ
-- แต่ผูกกับ fact_order.order_date เป็นวัน — คนละ grain, คนละวัตถุประสงค์ ดู
-- summary ท้ายงานสำหรับความเสี่ยงชื่อซ้ำที่ต้องระวัง) จึงเพิ่มตาราง log แบบเบา
-- (1 แถว/คืน) กรอกผ่าน RPC เดียว แล้วคำนวณยอดจริงจาก fact_order/fact_order_item
-- ของวันนั้นด้วย view แยก ไม่เก็บตัวเลขยอดซ้ำในตาราง log (ยอดต้องอ่านสดเสมอ).
--
-- Design: architect 16 ก.ย. 69, revised ตาม security-auditor review รอบ 1
-- (GO แบบมีเงื่อนไข — ดู summary ที่ส่งแยกให้ Tech Lead สำหรับรายการที่แก้ +
-- ตัวเลขยืนยัน H1/H2 จาก query จริง).
--
-- Additive only: create table/function/view ใหม่ล้วน ไม่แก้ไฟล์/ตาราง/ฟังก์ชันเดิม
-- ที่มีอยู่แล้วแม้แต่บรรทัดเดียว.
--
-- ✅ APPLIED 16 ก.ย. 69 ผ่าน MCP apply_migration (Tech Lead) version 20260916125009 (schema_migrations มีแถวแล้ว) · code-review PASS w/ fixes → view recreate (rename started_time_th/ended_time_th) + guard ย้ายขึ้น apply เพิ่มผ่าน execute_sql · dry-run หลัง apply: T1 ข้ามเที่ยงคืน=4ชม ✓ · T2 upsert ซ้ำไม่เพิ่มแถว ✓
-- · T3 peak null ✓ · T4 คืนว่าง=0 ไม่ null ✓ (25 ธ.ค. 68) · T4b คืนจริง 15 ก.ย. 52 ใบ ฿24,336 live-SKU 44 ✓ · T5 overload=1 ✓ · T6 >12ชม. ข้อความไทย ✓ · T7 non-owner: **ยังทดสอบไม่ได้** (shop_member มีแค่ owner) — guard เดียวกับ write-RPC อื่น (0021) · advisors: ไม่มี finding ใหม่

-- ============================================================================
-- 1. analytics.live_session_log — 1 แถว/คืน, กรอกผ่าน RPC เท่านั้น
-- ============================================================================

create table if not exists analytics.live_session_log (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  live_date date not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  peak_viewers int,
  note text,
  source text not null default 'owner_chat',
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint live_session_log_shop_date_uq unique (shop_id, live_date),
  constraint live_session_log_end_after_start check (ended_at > started_at),
  constraint live_session_log_max_len check (ended_at - started_at <= interval '12 hours'),
  constraint live_session_log_peak_check check (peak_viewers is null or peak_viewers >= 0),
  constraint live_session_log_source_check check (source in ('owner_chat', 'admin_ui', 'backfill')),
  constraint live_session_log_note_len check (note is null or length(note) <= 500)
);

comment on table analytics.live_session_log is
  'บันทึกไลฟ์รายคืน (1 แถว/คืน) กรอกผ่าน analytics.live_session_upsert เท่านั้น '
  '-- ไม่ใช่ระบบจดออเดอร์เร็วตอนไลฟ์ (ดู public.live_session ใน 0008, คนละตาราง คนละ grain)';
comment on column analytics.live_session_log.live_date is
  'วันทางธุรกิจ (ไทย) ที่เริ่มไลฟ์ = คีย์ที่ v_live_night ใช้ผูกกับ analytics.fact_order.order_date';
comment on column analytics.live_session_log.ended_at is
  'เวลาจบไลฟ์จริง (timestamptz) — ถ้าไลฟ์ข้ามเที่ยงคืน วันปฏิทินจริงของ ended_at '
  'จะเป็น live_date+1 (คำนวณให้อัตโนมัติใน live_session_upsert จาก p_end <= p_start)';
comment on column analytics.live_session_log.source is
  'ที่มา: owner_chat = เจ้าของแจ้งผ่านแชท (ดีฟอลต์) · admin_ui = กรอกผ่านหน้าเว็บ · backfill = ย้อนเติมของเก่า';
comment on column analytics.live_session_log.note is
  'security review (0121): ห้ามใส่ชื่อ/เบอร์/ที่อยู่ลูกค้าหรือ PII ใดๆ — ทุก shop_member '
  '(ทุก role รวม staff) อ่านแถวนี้ได้ผ่าน SELECT policy ด้านล่าง จำกัดความยาว 500 ตัวอักษร';

-- trigger updated_at: ตามธรรมเนียมทุกตารางที่มีคอลัมน์นี้ในสคีมา analytics
-- (ดู 0010) แม้ RPC ข้างล่างจะ set updated_at=now() เองอยู่แล้วก็ตาม — เผื่อ
-- service_role เขียนตรงในอนาคต (เขียนผ่าน RLS bypass ได้ ไม่ผ่าน RPC เสมอไป).
-- drop ก่อน create: กันชนกันถ้า migration นี้ถูกรันซ้ำ/ปรับหลัง apply บางส่วน
-- (idempotent เหมือน `drop function if exists` ด้านล่าง — คนละคำสั่งแต่หลักการเดียวกัน).
drop trigger if exists trg_live_session_log_updated_at on analytics.live_session_log;

create trigger trg_live_session_log_updated_at
  before update on analytics.live_session_log
  for each row execute function public.set_updated_at();

-- RLS: Tier 2 pattern เดียวกับ dim_customer/fact_order ใน 0012 (ไม่มี helper
-- ฟังก์ชันชื่อ crm_is_shop_member ในโปรเจกต์นี้ — ทุกตารางใน analytics เขียน
-- policy แบบ inline shop_member subquery ตรงๆ). SELECT-only: เขียนผ่าน RPC
-- (security definer) เท่านั้น ไม่มี insert/update/delete policy ให้ authenticated.
-- `to authenticated, service_role` ใส่ตรงๆ ตาม security review (ปกติ policy
-- ไม่ระบุ `to` ก็ไม่เปิดกว้างกว่าเดิมเพราะ GRANT ด้านล่างจำกัดอยู่แล้ว แต่ใส่ไว้
-- explicit กันอนาคตมีคน grant select ให้ role อื่นแล้วลืมเช็ค policy).
alter table analytics.live_session_log enable row level security;

drop policy if exists tenant_isolation_select on analytics.live_session_log;
create policy tenant_isolation_select on analytics.live_session_log
  for select
  to authenticated, service_role
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

grant select on analytics.live_session_log to authenticated, service_role;

-- ============================================================================
-- 2. analytics.live_session_upsert — เขียนทางเดียวที่อนุญาต (owner/admin เท่านั้น)
-- ============================================================================

-- กัน overload (3j-migration-traps #1) แม้เป็นฟังก์ชันใหม่ — idempotent เผื่อ
-- migration นี้ถูกรันซ้ำ/แก้ signature ในอนาคต.
drop function if exists analytics.live_session_upsert(uuid, date, time, time, int, text, text);

create or replace function analytics.live_session_upsert(
  p_shop uuid,
  p_live_date date,
  p_start time,
  p_end time,
  p_peak int default null,
  p_note text default null,
  p_source text default 'owner_chat'
) returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_id uuid;
begin
  if p_shop is null or p_live_date is null or p_start is null or p_end is null then
    raise exception 'live_session_upsert: ต้องระบุ shop, วันที่ไลฟ์, เวลาเริ่ม และเวลาเลิก';
  end if;
  perform analytics.crm_require_owner_admin(p_shop);  -- ด่านสิทธิ์ก่อน validate อื่น (code-review: กัน probe)
  if p_peak is not null and p_peak < 0 then
    raise exception 'live_session_upsert: viewer สูงสุดต้องไม่ติดลบ';
  end if;
  if p_note is not null and length(btrim(p_note)) > 500 then
    raise exception 'live_session_upsert: p_note ยาวเกิน 500 ตัวอักษร';
  end if;
  -- เช็คซ้ำกับ CHECK ของตาราง (live_session_log_source_check) โดยตั้งใจ —
  -- ได้ error message ที่อ่านรู้เรื่องกว่า constraint violation ดิบๆ
  if p_source not in ('owner_chat', 'admin_ui', 'backfill') then
    raise exception 'live_session_upsert: invalid source %', p_source;
  end if;
  -- security review M4: เวลาเริ่ม=เวลาเลิกเป๊ะ ไม่มีความหมาย (ไลฟ์ 0 นาที หรือ
  -- ตั้งใจพิมพ์ผิด) — ปฏิเสธตรงนี้แทนที่จะปล่อยให้กลายเป็นไลฟ์ 24 ชม. แล้วไปตาย
  -- ที่ CHECK ยาว 12 ชม. ด้วยข้อความ constraint ที่อ่านไม่รู้เรื่อง.
  if p_start = p_end then
    raise exception 'live_session_upsert: เวลาเริ่มกับเวลาเลิกไลฟ์ห้ามเท่ากัน';
  end if;


  -- เขตเวลาไทย (3j-migration-traps #6): date+time ต่อกันได้ naive timestamp
  -- ก่อน แล้วค่อย "at time zone 'Asia/Bangkok'" แปลงเป็น timestamptz (UTC
  -- จริงที่เก็บใน DB) — ไม่ใช้ current_date/now() ตรงๆ เพราะรับ p_live_date/
  -- p_start/p_end จาก caller อยู่แล้ว. ข้ามเที่ยงคืน: p_end <= p_start แปลว่า
  -- จบวันถัดไป จึง +1 วันให้ p_live_date ก่อนต่อกับ p_end.
  v_start := (p_live_date + p_start) at time zone 'Asia/Bangkok';
  v_end := (p_live_date + (case when p_end <= p_start then 1 else 0 end) + p_end) at time zone 'Asia/Bangkok';

  -- security review M4: ข้อความไทยเองก่อน insert เมื่อไลฟ์ยาวเกิน 12 ชม. —
  -- CHECK ของตาราง (live_session_log_max_len) จะจับเคสนี้อยู่แล้วถ้าข้ามจุดนี้
  -- มาได้ แต่ error message ดิบของ constraint violation อ่านไม่รู้เรื่องสำหรับ
  -- คนกรอกผ่านแชท/หน้าเว็บ — เคสจริงที่พบบ่อยสุดคือพิมพ์เวลาเริ่ม/เลิกสลับกัน.
  if v_end - v_start > interval '12 hours' then
    raise exception 'live_session_upsert: เวลาเริ่ม-เลิกน่าจะสลับกัน (ได้ไลฟ์ยาวเกิน 12 ชั่วโมง)';
  end if;

  insert into analytics.live_session_log
    (shop_id, live_date, started_at, ended_at, peak_viewers, note, source, created_by, updated_by, updated_at)
  values
    (p_shop, p_live_date, v_start, v_end, p_peak, nullif(btrim(coalesce(p_note, '')), ''), p_source,
     auth.uid(), auth.uid(), now())
  on conflict (shop_id, live_date) do update set
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    peak_viewers = excluded.peak_viewers,
    note = excluded.note,
    source = excluded.source,
    updated_by = auth.uid(),  -- created_by ตั้งใจไม่แตะตอน update — เก็บคนสร้างแถวแรกไว้
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- Grant หายทุกครั้งหลัง create or replace (3j-migration-traps #2) — Supabase
-- ให้ anon/authenticated execute แยกจาก public โดย default (supabase-migrate
-- gotcha #1) ต้อง revoke ทั้งสามตัวเสมอ ไม่ใช่แค่ public.
revoke execute on function analytics.live_session_upsert(uuid, date, time, time, int, text, text)
  from public, anon, authenticated;
grant execute on function analytics.live_session_upsert(uuid, date, time, time, int, text, text)
  to authenticated, service_role;

-- ============================================================================
-- 3. analytics.v_live_night — 1 แถว/คืนที่มี log, ยอดจริงคำนวณสดจาก fact_order*
--
-- คอลัมน์ day_* = ยอด/ออเดอร์ "ทั้งวัน" (order_date = live_date) ทุกช่องทาง
-- ทุกเวลา ไม่ใช่แค่ออเดอร์ที่เกิดในหน้าต่างไลฟ์จริง — memory ของทีมยืนยันว่า
-- paid_at อยู่ในหน้าต่างไลฟ์แค่ ~75% เท่านั้น (มี LINE/Shopee/คำสั่งซื้อดึกที่
-- ไม่เกี่ยวกับไลฟ์ปนอยู่) ตั้งชื่อ day_* ตรงๆ กันคนอ่าน dashboard เข้าใจผิดว่า
-- เป็นยอดที่มาจากไลฟ์ล้วนๆ (security review H3).
-- ============================================================================

drop view if exists analytics.v_live_night;  -- rename คอลัมน์ต้อง drop (create or replace เปลี่ยนชื่อคอลัมน์ไม่ได้)
create view analytics.v_live_night
  with (security_invoker = true) as
with ls_calc as (
  select
    ls.shop_id,
    ls.live_date,
    ls.started_at,
    ls.ended_at,
    ls.peak_viewers,
    ls.note,
    round(extract(epoch from (ls.ended_at - ls.started_at)) / 3600.0, 2)::numeric(6, 2) as live_hours  -- (6,2) เผื่อถ้าวันหนึ่งขยาย max_len เกิน 12 ชม.
  from analytics.live_session_log ls
)
select
  lc.shop_id,
  lc.live_date,
  to_char(lc.started_at at time zone 'Asia/Bangkok', 'HH24:MI') as started_time_th,
  to_char(lc.ended_at at time zone 'Asia/Bangkok', 'HH24:MI') as ended_time_th,
  lc.live_hours,
  lc.peak_viewers,
  lc.note,
  (c.names is not null) as has_campaign,
  c.names as campaign_names,
  coalesce(o.orders, 0) as day_orders,
  coalesce(o.revenue, 0) as day_revenue,
  -- security review H4: กัน order-level revenue กับ line-item sum ไม่ reconcile
  -- เป๊ะ (coverage gap ที่รู้อยู่แล้ว — orders_without_items จาก 0119) แล้วลบ
  -- ออกมาติดลบ — greatest(...,0) ห้ามให้ค่าติดลบหลุดออกจาก view นี้เด็ดขาด.
  greatest(coalesce(o.revenue, 0) - coalesce(i.auction_amt, 0), 0) as day_revenue_ex_auction,
  greatest(coalesce(o.revenue, 0) - coalesce(i.bar_amt, 0), 0) as day_revenue_ex_bar,
  coalesce(i.live_sku_orders, 0) as live_sku_orders,
  coalesce(i.live_sku_revenue, 0) as live_sku_revenue,
  case when lc.live_hours > 0 then round(coalesce(o.orders, 0) / lc.live_hours, 2) else 0 end
    as day_orders_per_live_hour,
  case when lc.live_hours > 0 then round(coalesce(o.revenue, 0) / lc.live_hours, 2) else 0 end
    as day_revenue_per_live_hour
from ls_calc lc
-- (o): นับ/รวมยอดจาก analytics.v_fact_order (ไม่ใช่ fact_order ดิบ) เพื่อให้
-- ตรงกับ order_date/revenue ที่แก้ไขผ่าน crm_order_override แล้ว — เหตุผล
-- เดียวกับที่ 0119's dashboard_charts อ่านผ่าน v_fact_order (ดู "แก้จาก
-- design" ใน summary).
left join lateral (
  select count(*) as orders, coalesce(sum(v.revenue), 0) as revenue
  from analytics.v_fact_order v
  where v.shop_id = lc.shop_id and v.order_date = lc.live_date
) o on true
-- (i): line items ของออเดอร์คืนนั้น join ผ่าน v_fact_order.id (= fact_order.id
-- เดิม, override ไม่เปลี่ยน id) เพื่อให้ scope วันเดียวกับ (o) เป๊ะ. เพิ่ม
-- fi.shop_id = lc.shop_id ตรงๆ (security review Low) เป็น defense-in-depth
-- ชั้นที่สองแยกจาก join เงื่อนไข v.shop_id — fact_order_item มีคอลัมน์นี้จริง.
--
-- bar_amt (security review H1): sku_snapshot like 'S-%' อย่างเดียวพลาดสินค้า
-- เงินแท่งที่ product_id ผูกกับ catalog แล้วแต่ SKU ไม่ขึ้นต้นด้วย S- (query
-- จริงยืนยัน 10 แถวแบบนี้ในข้อมูลปัจจุบัน) จึง OR กับ
-- analytics.v_product_affinity.affinity_group='bar' (จุดเดียวที่ผูก
-- category->ฝั่งสินค้า ของทั้งโปรเจกต์ ตาม 0099 — ห้ามก็อป CASE WHEN ใหม่) —
-- คง prefix ไว้ด้วยเพราะ query จริงยืนยันอีก 111 แถวที่ sku ขึ้นต้น S- แต่ยังไม่
-- มี product_id ที่ match ใน catalog (SKU ใหม่/ยังไม่กรอก) ตัวเลขยืนยันเต็ม
-- อยู่ใน summary ที่ส่งแยก.
left join lateral (
  select
    coalesce(sum(fi.qty * fi.unit_price)
      filter (where fi.product_name_snapshot ilike '%[ประมูล]%'), 0) as auction_amt,
    coalesce(sum(fi.qty * fi.unit_price)
      filter (where pa.affinity_group = 'bar' or fi.sku_snapshot like 'S-%'), 0) as bar_amt,
    count(distinct fi.fact_order_id)
      filter (where fi.sku_snapshot ~* '^live') as live_sku_orders,
    coalesce(sum(fi.qty * fi.unit_price)
      filter (where fi.sku_snapshot ~* '^live'), 0) as live_sku_revenue
  from analytics.fact_order_item fi
  join analytics.v_fact_order v on v.id = fi.fact_order_id
  left join analytics.v_product_affinity pa on pa.product_id = fi.product_id
  where v.shop_id = lc.shop_id and v.order_date = lc.live_date
    and fi.shop_id = lc.shop_id
) i on true
-- (c): แคมเปญที่ anchor วันนั้น ไม่นับ 'blocked' และไม่นับ 'content_task'
-- (แก้จาก design ตามที่ brief ระบุไว้แล้ว — content_task คือ wrapper งาน
-- ถ่ายคลิป/โพสต์ ไม่ใช่แคมเปญขาย นับรวมจะทำให้ has_campaign true ผิดๆ ทุกคืน
-- ที่บังเอิญมีงานถ่ายคลิปอยู่ในปฏิทิน).
left join lateral (
  select string_agg(cp.name, ', ' order by cp.name) as names
  from analytics.campaign cp
  where cp.shop_id = lc.shop_id
    and cp.anchor_date = lc.live_date
    and cp.status <> 'blocked'
    and cp.campaign_type <> 'content_task'
) c on true;

comment on view analytics.v_live_night is
  'สรุปผลไลฟ์รายคืน 1 แถว/คืนที่มี log ใน live_session_log — คอลัมน์ day_* คือยอด/ออเดอร์ '
  'ของ "ทั้งวัน" (order_date = live_date) ทุกช่องทาง ไม่ใช่แค่ที่เกิดในหน้าต่างไลฟ์จริง '
  '(paid_at อยู่ในหน้าต่างไลฟ์แค่ ~75% ตามข้อมูลที่ทีมยืนยันไว้) ห้ามตีความ day_* เป็น '
  '"ยอดจากไลฟ์" เป๊ะๆ — ใช้เป็นตัวเทียบยอดวันที่มีไลฟ์ vs ไม่มีไลฟ์เท่านั้น · ไลฟ์ข้ามเที่ยงคืน: ออเดอร์หลัง 00:00 '
  'มี order_date = live_date+1 จึงไม่ถูกนับใน day_* ของคืนนั้น (ไลฟ์ปกติ 20–23 น. ไม่กระทบ)';

grant select on analytics.v_live_night to authenticated, service_role;

notify pgrst, 'reload schema';

-- ============================================================================
-- DRY-RUN VERIFICATION BLOCK (3j-migration-traps #11) — Tech Lead: copy each
-- `do $$ ... $$;` statement below and run it as its OWN statement AFTER
-- `apply_migration` succeeds. Block 1 seeds rows under shop_id = (first row of
-- public.shop) + live_date 2026-01-05 / 2026-01-06 / 2026-01-07, asserts, then
-- deliberately `raise exception` at the end so the whole thing rolls back —
-- state is NOT supposed to move. Re-check row counts before/after if in doubt.
-- Block 2 (permission test, ช) is SEPARATE on purpose — see its own header.
-- DO NOT execute either block as part of the migration itself.
-- ============================================================================

/*
-- ---------------------------------------------------------------------------
-- BLOCK 1 — (ก)(ข)(ค)(ง)(จ)(ฉ), runs as service_role, self-rolls-back.
-- ---------------------------------------------------------------------------
do $$
declare
  v_shop_id uuid;
  v_id1 uuid;
  v_id2 uuid;
  v_row analytics.live_session_log%rowtype;
  v_night analytics.v_live_night%rowtype;
  v_overloads int;
  v_raised boolean;
  v_msg text;
  v_log text := E'\n=== 0121 live_session_log / v_live_night dry-run (block 1) ===\n';
begin
  -- service_role claim: crm_require_owner_admin short-circuits for it (0021),
  -- same as every other RPC test in this repo's verify scripts.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  v_shop_id := 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7'::uuid;  -- shop 3J (code-review: ห้าม limit 1 ไม่มี order by)
  if v_shop_id is null then
    raise exception '0121 dry-run: ไม่มี public.shop ให้ทดสอบ — ตรวจ seed ก่อน';
  end if;

  -- (ก) ไลฟ์ข้ามเที่ยงคืน 20:30 -> 00:30 ต้องได้ live_hours = 4.00
  begin
    v_id1 := analytics.live_session_upsert(
      v_shop_id, '2026-01-05'::date, '20:30'::time, '00:30'::time, 120, 'dry-run A', 'backfill');
    select * into v_row from analytics.live_session_log where id = v_id1;
    if v_row.ended_at - v_row.started_at = interval '4 hours' then
      v_log := v_log || 'T1 (ข้ามเที่ยงคืน = 4 ชม.): OK' || E'\n';
    else
      v_log := v_log || format('T1: FAIL ได้ %s ไม่ใช่ 4 ชม.', v_row.ended_at - v_row.started_at) || E'\n';
    end if;
  exception when others then
    v_log := v_log || format('T1: FAIL ขึ้น error ไม่ควรพัง — %s', sqlerrm) || E'\n';
  end;

  -- (ข) upsert ซ้ำวันเดิม (live_date เดิม) ต้อง "อัปเดต" ไม่ใช่เพิ่มแถวใหม่
  begin
    v_id2 := analytics.live_session_upsert(
      v_shop_id, '2026-01-05'::date, '20:45'::time, '00:15'::time, 150, 'dry-run A แก้ไข', 'backfill');
    if v_id2 = v_id1
       and (select count(*) from analytics.live_session_log
            where shop_id = v_shop_id and live_date = '2026-01-05') = 1 then
      v_log := v_log || 'T2 (upsert ซ้ำวันเดิม ไม่เพิ่มแถว): OK' || E'\n';
    else
      v_log := v_log || 'T2: FAIL id เปลี่ยนหรือมีแถวซ้ำ' || E'\n';
    end if;
  exception when others then
    v_log := v_log || format('T2: FAIL ขึ้น error ไม่ควรพัง — %s', sqlerrm) || E'\n';
  end;

  -- (ค) peak_viewers เป็น null ได้ (ไม่ควรพัง)
  begin
    perform analytics.live_session_upsert(
      v_shop_id, '2026-01-06'::date, '20:00'::time, '23:00'::time, null, null, 'backfill');
    v_log := v_log || 'T3 (peak null ผ่านได้): OK' || E'\n';
  exception when others then
    v_log := v_log || format('T3: FAIL ควรผ่านแต่ error — %s', sqlerrm) || E'\n';
  end;

  -- (ง) คืนที่ log ไว้แต่ไม่มีออเดอร์จริง (2026-01-06 อยู่อนาคต ไม่มี fact_order
  -- แน่นอน) ต้องได้ 0 ตัวเลขทุกคอลัมน์ day_* และ live_sku_* ไม่ใช่ null
  begin
    select * into v_night from analytics.v_live_night
    where shop_id = v_shop_id and live_date = '2026-01-06';
    if v_night.day_orders = 0 and v_night.day_revenue = 0 and v_night.day_revenue_ex_auction = 0
       and v_night.day_revenue_ex_bar = 0 and v_night.live_sku_orders = 0
       and v_night.live_sku_revenue = 0 and v_night.day_orders_per_live_hour = 0
       and v_night.day_revenue_per_live_hour = 0 and v_night.day_orders is not null then
      v_log := v_log || 'T4 (คืนไม่มีออเดอร์ = 0 ไม่ใช่ null): OK' || E'\n';
    else
      v_log := v_log || format('T4: FAIL day_orders=%s day_revenue=%s', v_night.day_orders, v_night.day_revenue) || E'\n';
    end if;
  exception when others then
    v_log := v_log || format('T4: FAIL ขึ้น error — %s', sqlerrm) || E'\n';
  end;

  -- (จ) overload check — ต้องมี identity arguments แบบเดียวเท่านั้น
  select count(*) into v_overloads
  from pg_proc
  where pronamespace = 'analytics'::regnamespace and proname = 'live_session_upsert';
  if v_overloads = 1 then
    v_log := v_log || 'T5 (overload check = 1 ตัว): OK' || E'\n';
  else
    v_log := v_log || format(
      'T5: FAIL เจอ %s overload — รัน: select pg_get_function_identity_arguments(oid) '
      'from pg_proc where pronamespace=''analytics''::regnamespace and proname=''live_session_upsert''',
      v_overloads) || E'\n';
  end if;

  -- (ฉ) ข้ามเที่ยงคืนแต่ยาวเกิน 12 ชม. (08:00 -> 07:00 = 23 ชม.) ต้อง raise
  -- ข้อความไทย "สลับกัน" ก่อนถึง insert/CHECK ของตาราง
  v_raised := false;
  v_msg := null;
  begin
    perform analytics.live_session_upsert(
      v_shop_id, '2026-01-07'::date, '08:00'::time, '07:00'::time, null, null, 'backfill');
  exception when others then
    v_raised := true;
    v_msg := sqlerrm;
  end;
  if v_raised and v_msg ilike '%สลับกัน%' then
    v_log := v_log || 'T6 (>12 ชม. ข้อความไทย "สลับกัน"): OK' || E'\n';
  elsif v_raised then
    v_log := v_log || format('T6: FAIL raise จริงแต่ข้อความไม่ตรง — %s', v_msg) || E'\n';
  else
    v_log := v_log || 'T6: FAIL ไม่ raise ทั้งที่ควรปฏิเสธ (23 ชม.)' || E'\n';
  end if;

  raise exception '%', v_log; -- บังคับ rollback ทั้งก้อน — DB ไม่ขยับจริง
end $$;

-- ---------------------------------------------------------------------------
-- BLOCK 2 — (ช) permission test: non-owner/admin member ต้องได้ 42501
--
-- แยกจาก block 1 เพราะต้องสลับ role จริง (set local role authenticated) ไม่ใช่
-- แค่ปลอม JWT claim แบบ service_role. ต้องมี real auth.users row ที่จับคู่กับ
-- shop_member.role NOT IN ('owner','admin') อยู่ก่อน — ตรวจแล้วตอนเขียน
-- migration นี้ (query จริง) **ไม่มี**แถวแบบนี้ในข้อมูลปัจจุบัน (shop_member ทุก
-- แถวเป็น owner/admin) จึงตั้งใจไม่ insert fake auth.users เอง (การยัดแถวเข้า
-- auth.users ตรงๆ แตะ schema ของ Supabase Auth เอง เสี่ยงเกินขอบเขต migration
-- นี้) — บล็อกนี้จะ "หา" แถวจริงก่อน ถ้าไม่เจอจะ raise อธิบายว่าต้อง provision
-- staff member ก่อน (ดู scripts/provision-member.mjs) แล้วรันบล็อกนี้ใหม่.
-- ---------------------------------------------------------------------------
do $$
declare
  v_member record;
  v_shop_id uuid;
  v_raised boolean := false;
  v_code text;
  v_log text := E'\n=== 0121 dry-run (block 2 — permission, ช) ===\n';
begin
  select sm.user_id, sm.shop_id into v_member
  from public.shop_member sm
  where sm.role not in ('owner', 'admin')
  limit 1;

  if v_member.user_id is null then
    raise exception '0121 dry-run block 2: ข้าม T7 — ไม่มี shop_member ที่ role ไม่ใช่ owner/admin '
      'ในข้อมูลจริงตอนนี้ ต้อง provision staff member ก่อน (scripts/provision-member.mjs) '
      'แล้วรันบล็อกนี้ใหม่เพื่อยืนยัน 42501 จริง';
  end if;

  v_shop_id := v_member.shop_id;

  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', v_member.user_id), true);
  set local role authenticated;

  begin
    perform analytics.live_session_upsert(
      v_shop_id, '2026-01-08'::date, '20:00'::time, '23:00'::time, null, 'T7', 'backfill');
  exception when others then
    v_raised := true;
    get stacked diagnostics v_code = returned_sqlstate;
  end;

  reset role;

  if v_raised and v_code = '42501' then
    v_log := v_log || 'T7 (non-owner/admin ถูกปฏิเสธ 42501): OK' || E'\n';
  elsif v_raised then
    v_log := v_log || format('T7: FAIL raise จริงแต่ sqlstate=%s ไม่ใช่ 42501', v_code) || E'\n';
  else
    v_log := v_log || 'T7: FAIL ไม่ raise ทั้งที่ควรถูกปฏิเสธ (สิทธิ์หลุด!)' || E'\n';
  end if;

  raise exception '%', v_log; -- บังคับ rollback ทั้งก้อน — DB ไม่ขยับจริง
end $$;
*/

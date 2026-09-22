-- 0146_live_night_snapshot.sql
-- P1 ของชั้นวัดผล content (ต่อจาก 0145) — เจ้าของเริ่มจดไลฟ์ 1 ต.ค. 69, ต้องมี
-- ระบบ "ล็อกยอดรายคืนที่ T+3" ก่อนคืนแรกจริง เพราะร้านนี้ลูกค้าสั่งเพิ่มบนใบเดิม
-- 2–3 วัน ⇒ ยอดสดเทียบกันข้ามคืนจะลวง (คืนเก่าชนะคืนใหม่เสมอ). ย้อนหลังไม่ได้
-- ทุกวันที่ยังไม่มีตารางนี้ = คืนที่หายจากเส้นเปรียบเทียบถาวร.
--
-- Additive only — ไม่แตะ analytics.v_live_night/live_session_log ที่มีอยู่แล้ว.
--
-- ============================================================================
-- 🔴 ของจริงชนะบรีฟ — 2 จุดที่ต่างจากที่บรีฟสมมติ (ยืนยันด้วย query จริงวันนี้):
--
-- 1. Grant model: เหมือน 0145 — schema analytics ปิด REST ให้ anon/authenticated
--    ทั้งหมดตั้งแต่ 0123 (16 ก.ย. 69) และ default privilege ก็ถูก revoke ไว้แล้ว
--    ไฟล์นี้จึง grant select/execute ให้ service_role เท่านั้น ตาม convention
--    ของทุก migration หลัง 0123 (ตรวจแล้ว: 0131/0138/0140/0141/0143/0144 ไม่มี
--    `to authenticated` เหลืออยู่เลย) — บรีฟ/สกิลอ้างแพตเทิร์นเก่าของ 0121
--    (ก่อน 0123) ซึ่งจะเปิดรูที่ 0123 เพิ่งปิดกลับมาใหม่ถ้าทำตามตรงๆ.
--
-- 2. live_hours "เป็น null ได้" ตามบรีฟ — ตรวจ analytics.live_session_log (0121)
--    แล้วพบว่า started_at/ended_at เป็น `not null` ทั้งคู่ ⇒ ทุกแถวที่มีอยู่จริง
--    ใน live_session_log คำนวณ live_hours ได้เสมอ (ไม่มีทาง null ในทางปฏิบัติ
--    วันนี้ — จะ null ได้ก็ต่อเมื่อไม่มีแถว log เลย ซึ่งกรณีนั้น v_live_night ก็
--    ไม่มีแถวให้ snapshot ตั้งแต่ต้น ไม่ใช่ "มีแถวแต่ live_hours เป็น null").
--    peak_viewers ต่างหากที่ null ได้จริงในข้อมูลจริง (คอลัมน์ nullable, RPC
--    live_session_upsert รับ p_peak=null ได้ตรงๆ) — คงคอลัมน์/view ให้ null-safe
--    ทั้งคู่ตามบรีฟ (defense-in-depth เผื่อ constraint เปลี่ยนในอนาคต) แต่
--    ทดสอบ peak_viewers เป็นหลักเพราะเป็นเคสที่เกิดได้จริงวันนี้ — รายงานเคส
--    live_hours null ไว้ในสรุปว่าทดสอบผ่าน "expression-level" เท่านั้น ไม่มี
--    เคสจริงในข้อมูลปัจจุบันให้พิสูจน์ end-to-end.
-- ============================================================================

-- ============================================================================
-- 1. analytics.live_night_snapshot — เก็บ "อายุ" (age_days) หลายค่าต่อคืนโดย
--    ตั้งใจ (ไม่ใช่แค่ age=3) เพราะถ้า cron พลาดวันเดียว ช่อง (คืนนั้น, age=3)
--    จะหายถาวรแก้ไม่ได้ — เก็บทั้งช่วง 0-7 ทุกรอบที่รัน แล้วให้ชั้นอ่าน
--    (v_live_night_locked ด้านล่าง) เลือกเอง.
--
--    day_orders/day_revenue/day_revenue_ex_bar/live_sku_orders/live_sku_revenue
--    not null: มาจาก v_live_night ที่ coalesce(...,0) ไว้แล้วเสมอ (0 จริง ไม่ใช่
--    "ยังไม่รู้") — not null ที่นี่ดักไว้เผื่ออนาคต v_live_night เปลี่ยนพฤติกรรม
--    เงียบๆ แล้วเริ่มปล่อย null หลุดมา (จะ error ตอน insert แทนที่จะเนียนผ่าน).
--    live_hours/peak_viewers ปล่อย nullable ตามบรีฟ — ห้าม coalesce เป็น 0
--    ที่ไหนทั้งสิ้น (ยังไม่จด ≠ ศูนย์คน).
-- ============================================================================

create table if not exists analytics.live_night_snapshot (
  shop_id            uuid not null references public.shop (id) on delete cascade,
  live_date          date not null,
  age_days           int not null check (age_days >= 0),
  day_orders         int not null check (day_orders >= 0),
  day_revenue        numeric(14, 2) not null check (day_revenue >= 0),
  day_revenue_ex_bar numeric(14, 2) not null check (day_revenue_ex_bar >= 0),
  live_sku_orders    int not null check (live_sku_orders >= 0),
  live_sku_revenue   numeric(14, 2) not null check (live_sku_revenue >= 0),
  live_hours         numeric(6, 2) check (live_hours is null or live_hours >= 0),
  peak_viewers       int check (peak_viewers is null or peak_viewers >= 0),
  captured_at        timestamptz not null default now(),
  primary key (shop_id, live_date, age_days)
);

comment on table analytics.live_night_snapshot is
  'Snapshot ยอดรายคืนที่ age_days ต่างๆ (0-7, เก็บทุกค่าทุกรอบ cron) — เขียนผ่าน '
  'analytics.live_night_snapshot_capture() เท่านั้น. peak_viewers/live_hours เป็น null ได้จริง '
  '(ยังไม่จด) ห้าม coalesce เป็น 0 ที่ชั้นไหนทั้งสิ้น. ใช้ analytics.v_live_night_locked '
  'อ่านค่า "ล็อกแล้ว" ต่อคืน ไม่อ่านตารางนี้ตรงๆ.';

comment on column analytics.live_night_snapshot.age_days is
  'จำนวนวันหลัง live_date ณ ตอนที่แคปเจอร์ (เขตเวลาไทย) — 1 คืนมีได้หลายแถว, หนึ่งแถวต่อ '
  '(shop, live_date, age_days). ค่าที่ "ล็อกใช้จริง" คือแถวที่ age ใกล้ 3 ที่สุดในช่วง [2,5] '
  '(ดู v_live_night_locked) ไม่ใช่ age ล่าสุดหรือ age=3 เป๊ะเสมอไป.';

alter table analytics.live_night_snapshot enable row level security;

drop policy if exists tenant_isolation_select on analytics.live_night_snapshot;
create policy tenant_isolation_select on analytics.live_night_snapshot
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

grant select on analytics.live_night_snapshot to service_role;

-- ============================================================================
-- 2. analytics.live_night_snapshot_capture — เขียนทางเดียวที่อนุญาต, เรียกจาก
--    cron เท่านั้น (service_role) ไม่มี owner/admin check เพราะไม่มี caller
--    ที่เป็น end-user เลย (ต่างจาก live_session_upsert ซึ่งรับ input จากคน).
--
--    idempotent: ON CONFLICT (shop_id, live_date, age_days) DO UPDATE —
--    รันซ้ำวันเดียวกัน (แหล่งข้อมูล v_live_night ไม่เปลี่ยน) ได้ผลเหมือนเดิม
--    ทุกคอลัมน์ยกเว้น captured_at (ตั้งใจให้ขยับ — เป็น timestamp ของการรัน
--    ไม่ใช่ตัวชี้วัดที่ทดสอบ idempotency).
-- ============================================================================

drop function if exists analytics.live_night_snapshot_capture(uuid);

create function analytics.live_night_snapshot_capture(p_shop_id uuid default null)
  returns integer
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_today date;
  v_count integer;
begin
  -- เขตเวลาไทย (3j-migration-traps #6) — "วันนี้"/"อายุกี่วัน" ต้องอิงวันทาง
  -- ธุรกิจของไทย ไม่ใช่ current_date (UTC) ซึ่งเหลื่อม 00:00-07:00 น. ไทย
  v_today := (now() at time zone 'Asia/Bangkok')::date;

  with upserted as (
    insert into analytics.live_night_snapshot (
      shop_id, live_date, age_days, day_orders, day_revenue, day_revenue_ex_bar,
      live_sku_orders, live_sku_revenue, live_hours, peak_viewers, captured_at
    )
    select
      ln.shop_id, ln.live_date, (v_today - ln.live_date) as age_days,
      ln.day_orders, ln.day_revenue, ln.day_revenue_ex_bar,
      ln.live_sku_orders, ln.live_sku_revenue, ln.live_hours, ln.peak_viewers, now()
    from analytics.v_live_night ln
    where (p_shop_id is null or ln.shop_id = p_shop_id)
      -- เก็บ age 0-7 ทุกรอบ (ตั้งใจ, ดูคอมเมนต์หัวตาราง) — ไม่ใช่แค่ age=3
      and ln.live_date between (v_today - 7) and v_today
    on conflict (shop_id, live_date, age_days) do update set
      day_orders         = excluded.day_orders,
      day_revenue        = excluded.day_revenue,
      day_revenue_ex_bar = excluded.day_revenue_ex_bar,
      live_sku_orders    = excluded.live_sku_orders,
      live_sku_revenue   = excluded.live_sku_revenue,
      live_hours         = excluded.live_hours,
      peak_viewers       = excluded.peak_viewers,
      captured_at        = now()
    returning 1
  )
  select count(*) into v_count from upserted;

  return v_count;
end;
$$;

comment on function analytics.live_night_snapshot_capture(uuid) is
  'เรียกจาก pg_cron (service_role) เท่านั้น — capture v_live_night ของทุกคืนใน '
  '[today-7, today] (เขตเวลาไทย) เป็นแถว snapshot ที่ age_days ปัจจุบัน. p_shop_id=null = ทุกร้าน. '
  'Idempotent ต่อ (shop_id, live_date, age_days) เดียวกัน.';

-- Grant หายทุกครั้งหลัง create/replace (3j-migration-traps #2) — revoke ทั้ง
-- 3 ตัวเสมอ ไม่ใช่แค่ public (supabase-migrate gotcha #1).
revoke execute on function analytics.live_night_snapshot_capture(uuid) from public, anon, authenticated;
grant execute on function analytics.live_night_snapshot_capture(uuid) to service_role;

-- ============================================================================
-- 3. analytics.v_live_night_locked — เลือก snapshot ที่ age ใกล้ 3 ที่สุดใน
--    ช่วง [2,5] ต่อคืน. คืนที่ไม่มี snapshot ในช่วงนี้ "ไม่ปรากฏในผลลัพธ์เลย"
--    (ห้ามตกกลับไปอ่านยอดสดจาก v_live_night — view นี้ตั้งใจไม่ join กลับไปหา
--    v_live_night ที่ไหนเลยเพื่อให้เป็นไปไม่ได้โดยโครงสร้าง ไม่ใช่แค่ตั้งใจ).
--
--    Tie-break เมื่อระยะเท่ากัน (เช่นมีแค่ age=2 กับ age=4, ไม่มี age=3):
--    เลือก age ที่มากกว่า (ข้อมูลนิ่งกว่า/ผ่านการแก้ไขใบมาแล้วมากกว่า) —
--    ไม่ได้ระบุในบรีฟ ตัดสินใจเอง เขียนไว้ชัดเผื่อพฤติกรรมนี้ถูกพึ่งพาในอนาคต.
--
--    day_revenue_per_live_hour_locked: ไม่อยู่ในสเปกตารางที่บรีฟให้มา แต่เพิ่ม
--    ที่ชั้น view นี้ (ไม่แตะ schema ตาราง) เพราะเทสต์เคส #7 ในบรีฟต้องการ "view
--    ที่คำนวณดัชนี" ที่ null-safe จริง — ไม่มีคอลัมน์ไหนในตารางที่ทำหน้าที่นี้
--    ถ้าไม่เพิ่มตรงนี้ เทสต์เคสนั้นจะไม่มีอะไรให้พิสูจน์จริง.
-- ============================================================================

create or replace view analytics.v_live_night_locked
  with (security_invoker = true) as
select distinct on (s.shop_id, s.live_date)
  s.shop_id,
  s.live_date,
  s.age_days,
  s.day_orders,
  s.day_revenue,
  s.day_revenue_ex_bar,
  s.live_sku_orders,
  s.live_sku_revenue,
  s.live_hours,
  s.peak_viewers,
  s.captured_at,
  -- not(> 0) กัน null และ 0 พร้อมกัน (3j-migration-traps #4/#13) — คำนวณไม่ได้
  -- ต้องได้ null ไม่ใช่ 0 และห้าม division by zero
  case
    when s.live_hours is null or not (s.live_hours > 0) then null
    else round(s.day_revenue / s.live_hours, 2)
  end as day_revenue_per_live_hour_locked
from analytics.live_night_snapshot s
where s.age_days between 2 and 5
order by s.shop_id, s.live_date, abs(s.age_days - 3), s.age_days desc;

comment on view analytics.v_live_night_locked is
  'ยอดรายคืน "ล็อกแล้ว" — เลือก snapshot อายุใกล้ 3 วันที่สุดในช่วง [2,5] ต่อคืน '
  '(ดูคอมเมนต์ในไฟล์ 0146 สำหรับ tie-break). คืนที่ยังไม่มี snapshot ในช่วงนี้จะไม่ปรากฏแถวเลย '
  '(ตั้งใจ — ห้ามใช้ยอดสดแทน).';

grant select on analytics.v_live_night_locked to service_role;

-- ============================================================================
-- 4. analytics.channel_follower_log — เก็บ "ระดับ" ผู้ติดตามต่อช่องทาง (เก็บ
--    ระดับ ไม่เก็บส่วนต่าง เพราะ level reconcile กับตัวเลขจริงบนแพลตฟอร์มได้
--    delta เดายาก/สะสม error). ไม่มี RPC เขียนในรอบนี้ — บรีฟระบุแค่ schema
--    ตาราง ไม่ได้สั่งให้สร้าง RPC upsert (ต่างจาก live_session_log ที่บรีฟ
--    เดิมสั่งไว้ชัด) — เขียนได้ตอนนี้ผ่าน service_role/migration เท่านั้น
--    (ไม่มี owner_admin write policy ให้ authenticated) บันทึกเป็นข้อจำกัดใน
--    สรุปส่งมอบ ไม่ได้ทำเกินขอบเขตที่สั่ง.
-- ============================================================================

create table if not exists analytics.channel_follower_log (
  shop_id        uuid not null references public.shop (id) on delete cascade,
  channel        text not null check (channel in ('line_oa', 'tiktok', 'facebook', 'instagram')),
  as_of_date     date not null,
  follower_count int not null check (follower_count >= 0),
  source         text not null default 'manual' check (source in ('manual', 'api')),
  created_by     uuid references auth.users (id) on delete set null,
  updated_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (shop_id, channel, as_of_date)
);

comment on table analytics.channel_follower_log is
  'ระดับผู้ติดตามต่อช่องทางต่อวัน (เก็บ "ระดับ" ไม่เก็บ delta) — ไม่มี RPC เขียนในรอบนี้ (0146), '
  'เขียนผ่าน service_role/migration เท่านั้น จนกว่าจะมี write RPC (ไม่อยู่ในสโคป P1).';

create index if not exists idx_channel_follower_log_lookup
  on analytics.channel_follower_log (shop_id, channel, as_of_date desc);

drop trigger if exists trg_channel_follower_log_updated_at on analytics.channel_follower_log;
create trigger trg_channel_follower_log_updated_at
  before update on analytics.channel_follower_log
  for each row execute function public.set_updated_at();

alter table analytics.channel_follower_log enable row level security;

drop policy if exists tenant_isolation_select on analytics.channel_follower_log;
create policy tenant_isolation_select on analytics.channel_follower_log
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

grant select on analytics.channel_follower_log to service_role;

notify pgrst, 'reload schema';

-- ============================================================================
-- 5. pg_cron — 02:00 UTC = 09:00 ไทย ทุกวัน (รูปแบบเดียวกับ 0024
--    crm-pii-retention-180d: unschedule-then-schedule กันซ้อน job ถ้าไฟล์นี้
--    ถูกรันซ้ำ). ทำได้จริงผ่าน migration ตรงๆ (0024 พิสูจน์แล้วว่าใช้งานได้จริง
--    ในโปรเจกต์นี้) — ไม่ต้องแยกเป็นขั้นตอน operational.
-- ============================================================================

do $cron146$
begin
  perform cron.unschedule('live-night-snapshot-capture-daily');
exception when others then
  null; -- job ยังไม่เคยถูกสร้างมาก่อน
end;
$cron146$;

select cron.schedule(
  'live-night-snapshot-capture-daily',
  '0 2 * * *',
  $cronjob$select analytics.live_night_snapshot_capture();$cronjob$
);

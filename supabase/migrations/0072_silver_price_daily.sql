-- 0072_silver_price_daily.sql
-- เก็บราคาเงินรายวัน จาก Google Sheet ที่ร้านใช้ป้อนราคาเข้าเว็บอยู่แล้ว
--
-- ทำไมต้องมี: ยอดขายเงินแท่งร่วง 96% จาก ม.ค. ถึง ส.ค. 2026 และเวลาเจ้าของ
-- ถามว่า "ราคาขึ้นแล้วควรดันกลับไหม" ระบบตอบไม่ได้เลย เพราะมียอดขาย 8 เดือน
-- เต็มแต่ไม่มีราคาสักวันให้เทียบ — ต้องรอเจ้าของส่งภาพกราฟจากแอปอื่นมาให้ดู
--
-- มีตาราง oem_metal_price อยู่แล้วแต่ใช้แทนกันไม่ได้: ตัวนั้นเก็บ "ราคาโลหะ
-- ต่อกรัม 1 ค่าต่อวัน" สำหรับคิดต้นทุน OEM ส่วนราคาเงินแท่งขายปลีกมี
-- โครงสร้างคนละแบบ — มีทั้งขาขายออก/ซื้อคืน (spread) ราคาต่อขนาดแท่ง
-- (แท่งเล็กมี premium สูงกว่าแท่งใหญ่) และราคากิโลที่แยก VAT
--
-- สิ่งที่ปลดล็อกเมื่อมีตารางนี้:
--   1. ตอบได้ว่าราคาต้องขึ้นถึงเท่าไหร่ลูกค้าถึงเริ่มกลับมาซื้อ (join กับ fact_order)
--   2. trigger แคมเปญอัตโนมัติเมื่อราคาย่อ >3% ใน 7 วัน (ตามที่ CMO วางไว้ในปฏิทิน)
--   3. ตีราคารับซื้อคืนตามวันที่ลูกค้าเอามาขายจริง (คู่กับโต๊ะรับซื้อคืน)
--   4. บอกลูกค้ารายคนได้ว่าแท่งที่ซื้อไปวันนั้น วันนี้มูลค่าเท่าไหร่
--
-- หน่วย: ทุกคอลัมน์เป็นบาทไทย · "ต่อบาท" = ต่อน้ำหนัก 1 บาท (baht-weight)
-- ไม่ใช่ต่อกรัม — จงใจเก็บตามหน่วยที่ชีตต้นทางใช้ ไม่แปลงหน่วยตอนเก็บ
-- เพราะการแปลงหน่วยตอน import คือจุดที่ข้อมูลเพี้ยนแบบเงียบที่สุด
-- (ถ้าอยากได้ต่อกรัม ให้แปลงตอน query โดยรู้ตัวว่ากำลังแปลง)

create table if not exists analytics.silver_price_daily (
  shop_id        uuid not null references public.shop(id) on delete cascade,
  as_of_date     date not null,

  -- เวลาที่ชีตบันทึกราคา (เก็บเป็น text ตามที่ชีตให้มา เช่น "23:43")
  -- ไม่ทำเป็น time เพราะถ้าชีตเปลี่ยนรูปแบบวันหลัง จะได้ไม่ล้มทั้ง import
  sheet_time     text,

  -- ราคาเนื้อเงินต่อน้ำหนัก 1 บาท
  sell_per_baht  numeric check (sell_per_baht is null or sell_per_baht > 0),
  buy_per_baht   numeric check (buy_per_baht  is null or buy_per_baht  > 0),

  -- ราคาขายแท่งแต่ละขนาด (รวม premium ของแต่ละขนาดแล้ว)
  bar_0_5_baht   numeric check (bar_0_5_baht is null or bar_0_5_baht > 0),
  bar_1_baht     numeric check (bar_1_baht   is null or bar_1_baht   > 0),
  bar_3_baht     numeric check (bar_3_baht   is null or bar_3_baht   > 0),
  bar_5_baht     numeric check (bar_5_baht   is null or bar_5_baht   > 0),
  bar_10_baht    numeric check (bar_10_baht  is null or bar_10_baht  > 0),

  -- แท่ง 1 กิโลกรัม แยกราคาก่อน/หลัง VAT และราคารับซื้อคืน
  kilo_sell      numeric check (kilo_sell     is null or kilo_sell     > 0),
  kilo_sell_vat  numeric check (kilo_sell_vat is null or kilo_sell_vat > 0),
  kilo_buy       numeric check (kilo_buy      is null or kilo_buy      > 0),

  source         text not null default 'sheet'
                   check (source in ('sheet', 'manual', 'feed')),
  -- เก็บก้อนดิบที่ดึงมาไว้เสมอ — ถ้าวันหลังชีตย้ายคอลัมน์แล้วเราแกะผิด
  -- ยังกู้ย้อนหลังได้โดยไม่ต้องไปไล่หาชีตเก่า
  raw            jsonb,
  captured_at    timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  primary key (shop_id, as_of_date),

  -- ขายออกต้องไม่ถูกกว่าซื้อเข้า ไม่งั้นร้านขาดทุนทุกรายการ — ถ้าชนกฎนี้
  -- แปลว่าแกะคอลัมน์สลับกัน ซึ่งเป็นบั๊กที่ต้องดังตั้งแต่ตอนเขียน
  constraint silver_price_spread_sane
    check (sell_per_baht is null or buy_per_baht is null or sell_per_baht >= buy_per_baht)
);

comment on table analytics.silver_price_daily is
  'ราคาเงินรายวันจาก Google Sheet ของร้าน · หน่วยเป็นบาทไทยต่อน้ำหนัก 1 บาท (ไม่ใช่ต่อกรัม)';

alter table analytics.silver_price_daily enable row level security;

-- อ่านได้เฉพาะ member ของร้าน (ราคาขายเป็นข้อมูลที่เปิดกับลูกค้าอยู่แล้ว
-- แต่ราคาซื้อเข้าเป็นต้นทุน จึงไม่เปิดกว้างกว่านี้)
drop policy if exists silver_price_tenant_select on analytics.silver_price_daily;
create policy silver_price_tenant_select on analytics.silver_price_daily
  for select using (
    shop_id in (select shop_id from public.shop_member where user_id = auth.uid())
  );

-- ============================================================
-- RPC บันทึกราคา — upsert ตามวัน รันซ้ำได้
-- ============================================================
create or replace function analytics.silver_price_set(
  p_shop_id       uuid,
  p_as_of_date    date,
  p_sell_per_baht numeric default null,
  p_buy_per_baht  numeric default null,
  p_bar_0_5       numeric default null,
  p_bar_1         numeric default null,
  p_bar_3         numeric default null,
  p_bar_5         numeric default null,
  p_bar_10        numeric default null,
  p_kilo_sell     numeric default null,
  p_kilo_sell_vat numeric default null,
  p_kilo_buy      numeric default null,
  p_sheet_time    text    default null,
  p_source        text    default 'sheet',
  p_raw           jsonb   default null
)
returns analytics.silver_price_daily
language plpgsql
security invoker
set search_path = 'analytics', 'public', 'pg_temp'
as $$
declare
  v_row analytics.silver_price_daily;
begin
  insert into analytics.silver_price_daily as s (
    shop_id, as_of_date, sheet_time,
    sell_per_baht, buy_per_baht,
    bar_0_5_baht, bar_1_baht, bar_3_baht, bar_5_baht, bar_10_baht,
    kilo_sell, kilo_sell_vat, kilo_buy,
    source, raw
  ) values (
    p_shop_id, p_as_of_date, p_sheet_time,
    p_sell_per_baht, p_buy_per_baht,
    p_bar_0_5, p_bar_1, p_bar_3, p_bar_5, p_bar_10,
    p_kilo_sell, p_kilo_sell_vat, p_kilo_buy,
    p_source, p_raw
  )
  on conflict (shop_id, as_of_date) do update set
    -- coalesce ฝั่งค่าใหม่ก่อน: ยิงซ้ำด้วยข้อมูลบางส่วนจะไม่ลบของเดิมทิ้ง
    sheet_time    = coalesce(excluded.sheet_time,    s.sheet_time),
    sell_per_baht = coalesce(excluded.sell_per_baht, s.sell_per_baht),
    buy_per_baht  = coalesce(excluded.buy_per_baht,  s.buy_per_baht),
    bar_0_5_baht  = coalesce(excluded.bar_0_5_baht,  s.bar_0_5_baht),
    bar_1_baht    = coalesce(excluded.bar_1_baht,    s.bar_1_baht),
    bar_3_baht    = coalesce(excluded.bar_3_baht,    s.bar_3_baht),
    bar_5_baht    = coalesce(excluded.bar_5_baht,    s.bar_5_baht),
    bar_10_baht   = coalesce(excluded.bar_10_baht,   s.bar_10_baht),
    kilo_sell     = coalesce(excluded.kilo_sell,     s.kilo_sell),
    kilo_sell_vat = coalesce(excluded.kilo_sell_vat, s.kilo_sell_vat),
    kilo_buy      = coalesce(excluded.kilo_buy,      s.kilo_buy),
    source        = excluded.source,
    raw           = coalesce(excluded.raw, s.raw),
    updated_at    = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function analytics.silver_price_set(uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function analytics.silver_price_set(uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, jsonb)
  to service_role;

-- ============================================================
-- View: ราคาล่าสุด + การเปลี่ยนแปลง
-- ============================================================
create or replace view analytics.v_silver_price_trend
with (security_invoker = true) as
select
  s.shop_id,
  s.as_of_date,
  s.sell_per_baht,
  s.buy_per_baht,
  s.sell_per_baht - s.buy_per_baht                         as spread_per_baht,
  s.bar_1_baht,
  s.bar_10_baht,
  s.kilo_sell,
  s.kilo_buy,
  -- เทียบกับวันที่มีข้อมูลก่อนหน้า (ไม่ใช่ "เมื่อวาน" ตามปฏิทิน เพราะถ้าวันไหน
  -- ไม่ได้บันทึกราคา การเทียบกับ null จะทำให้ % หายไปเฉยๆ)
  lag(s.sell_per_baht) over w                              as prev_sell,
  round(
    100.0 * (s.sell_per_baht - lag(s.sell_per_baht) over w)
    / nullif(lag(s.sell_per_baht) over w, 0), 2
  )                                                        as pct_change_vs_prev,
  round(
    100.0 * (s.sell_per_baht - first_value(s.sell_per_baht) over w7)
    / nullif(first_value(s.sell_per_baht) over w7, 0), 2
  )                                                        as pct_change_7d
from analytics.silver_price_daily s
window
  w  as (partition by s.shop_id order by s.as_of_date),
  w7 as (partition by s.shop_id order by s.as_of_date
         rows between 7 preceding and current row);

comment on view analytics.v_silver_price_trend is
  'ราคาเงินรายวัน + %เปลี่ยนแปลงเทียบวันก่อนหน้าที่มีข้อมูล และเทียบ 7 วัน — ใช้เป็นตัว trigger แคมเปญเมื่อราคาย่อ';

notify pgrst, 'reload schema';

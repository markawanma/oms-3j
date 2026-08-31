-- 0102_silver_price_history.sql
-- Append-only capture log of the Google Sheet that feeds the Wix silver-price
-- page — every "capture" (script run) is its own row, never overwritten.
--
-- WHY a new table instead of reusing analytics.silver_price_daily (0072/0074):
-- that table is intentionally ONE row per (shop_id, as_of_date) — upsert
-- semantics, history is thrown away every time a newer capture lands on the
-- same day. Owner asked explicitly: "เก็บไว้เองได้มากกว่านั้น แต่แสดงให้
-- ลูกค้าแค่ 14 วัน" — i.e. capture as often as we want (multiple times a
-- day) and keep every one, only the PUBLIC-facing surface is capped to 14
-- days. silver_price_daily can't do that without changing its primary key
-- and breaking every existing reader (oem_bar_quote cost calc, v_silver_price_trend
-- — see oem-quote-invariants skill §4). So this table is additive: it does
-- NOT replace silver_price_daily, and scripts/capture-silver-price-sheet.mjs
-- writes to BOTH (see that file's header for why).
--
-- 🔴 SECURITY-CRITICAL COLUMN SPLIT — read before adding/exposing any column:
-- The source Google Sheet URL that feeds this table exposes internal
-- cost/margin data (block fee, margin %, and — critically — a silver
-- "content value" that, compared against the buy-back price, reveals the
-- exact spread the shop is NOT allowed to disclose; see
-- docs/3j-jewelry/pricing-disclosure-policy.md and skill 3j-brand-and-market).
-- Columns are split into two groups purely by "is this already shown on the
-- live 3jthailand.com site today":
--   🟢 PUBLIC  — sell_*/buy_*/kilo_* — the exact numbers a visitor sees on
--      the site right now. Safe to surface via v_silver_price_public_14d.
--   🔴 INTERNAL — silver_value_per_baht, usd_*, thb_per_kg, block_fee_*,
--      margin_component_* (the sheet's "11%" column), shopee_* — cost/margin
--      inputs the website never announces. NEVER add these to
--      v_silver_price_public_14d or any future public-facing view/RPC.
--      silver_value_per_baht in particular: buy_1 = silver_value_per_baht - 30
--      (verified against live data 2026-08-31) — publishing both together is
--      equivalent to publishing the buy-back spread.
--
-- shop_id kept (not hardcoded single-tenant) for consistency with every
-- other analytics.* table, even though this app is single-shop today.
create table analytics.silver_price_history (
  id               uuid primary key default gen_random_uuid(),
  shop_id          uuid not null references public.shop (id) on delete cascade,

  -- our own clock (when the script captured it) — NOT the sheet's own
  -- "31-Aug-2026 21:51" timestamp. This table logs capture events, not
  -- business-days (that's what silver_price_daily.as_of_date already is).
  captured_at      timestamptz not null default now(),

  -- sha256 of the extracted numeric fields (sorted, canonical JSON) —
  -- computed by the capture script. Lets us skip inserting a new row when
  -- the sheet hasn't changed since the last capture (owner: "เก็บ log" not
  -- "เก็บทุกครั้งที่รันแม้ราคาเดิม"), without needing a read-before-write
  -- race-prone round trip — the unique constraint below does the work.
  sheet_row_hash   text not null,

  -- ============================================================
  -- 🟢 PUBLIC — mirrors exactly what 3jthailand.com/silver-price shows today
  -- ============================================================
  sell_0_5         numeric check (sell_0_5 is null or (sell_0_5 > 0 and sell_0_5 <= 10000000)),
  buy_0_5          numeric check (buy_0_5  is null or (buy_0_5  > 0 and buy_0_5  <= 10000000)),
  sell_1           numeric check (sell_1   is null or (sell_1   > 0 and sell_1   <= 10000000)),
  buy_1            numeric check (buy_1    is null or (buy_1    > 0 and buy_1    <= 10000000)),
  sell_3           numeric check (sell_3   is null or (sell_3   > 0 and sell_3   <= 10000000)),
  buy_3            numeric check (buy_3    is null or (buy_3    > 0 and buy_3    <= 10000000)),
  sell_5           numeric check (sell_5   is null or (sell_5   > 0 and sell_5   <= 10000000)),
  buy_5            numeric check (buy_5    is null or (buy_5    > 0 and buy_5    <= 10000000)),
  sell_10          numeric check (sell_10  is null or (sell_10  > 0 and sell_10  <= 10000000)),
  buy_10           numeric check (buy_10   is null or (buy_10   > 0 and buy_10   <= 10000000)),
  kilo_sell        numeric check (kilo_sell     is null or (kilo_sell     > 0 and kilo_sell     <= 10000000)),
  kilo_sell_vat    numeric check (kilo_sell_vat is null or (kilo_sell_vat > 0 and kilo_sell_vat <= 10000000)),
  kilo_buy         numeric check (kilo_buy      is null or (kilo_buy      > 0 and kilo_buy      <= 10000000)),

  -- ============================================================
  -- 🔴 INTERNAL — never expose publicly, see header comment
  -- ============================================================
  silver_value_per_baht numeric check (silver_value_per_baht is null or (silver_value_per_baht > 0 and silver_value_per_baht <= 10000000)),
  usd_per_kg            numeric check (usd_per_kg is null or (usd_per_kg > 0 and usd_per_kg <= 1000000)),
  usd_thb               numeric check (usd_thb    is null or (usd_thb    > 0 and usd_thb    <= 1000)),
  thb_per_kg            numeric check (thb_per_kg is null or (thb_per_kg > 0 and thb_per_kg <= 10000000)),

  block_fee_0_5    numeric check (block_fee_0_5 is null or (block_fee_0_5 > 0 and block_fee_0_5 <= 1000000)),
  block_fee_1      numeric check (block_fee_1   is null or (block_fee_1   > 0 and block_fee_1   <= 1000000)),
  block_fee_3      numeric check (block_fee_3   is null or (block_fee_3   > 0 and block_fee_3   <= 1000000)),
  block_fee_5      numeric check (block_fee_5   is null or (block_fee_5   > 0 and block_fee_5   <= 1000000)),
  block_fee_10     numeric check (block_fee_10  is null or (block_fee_10  > 0 and block_fee_10  <= 1000000)),
  block_fee_kg     numeric check (block_fee_kg  is null or (block_fee_kg  > 0 and block_fee_kg  <= 1000000)),

  -- the sheet's "11%" column — a computed line-item (11% of silver value),
  -- not a fixed percentage stored anywhere; kept as the baht amount the
  -- sheet shows, same unit as everything else in this table.
  margin_component_0_5 numeric check (margin_component_0_5 is null or (margin_component_0_5 > 0 and margin_component_0_5 <= 1000000)),
  margin_component_1   numeric check (margin_component_1   is null or (margin_component_1   > 0 and margin_component_1   <= 1000000)),
  margin_component_3   numeric check (margin_component_3   is null or (margin_component_3   > 0 and margin_component_3   <= 1000000)),
  margin_component_5   numeric check (margin_component_5   is null or (margin_component_5   > 0 and margin_component_5   <= 1000000)),
  margin_component_10  numeric check (margin_component_10  is null or (margin_component_10  > 0 and margin_component_10  <= 1000000)),

  shopee_0_5       numeric check (shopee_0_5 is null or (shopee_0_5 > 0 and shopee_0_5 <= 10000000)),
  shopee_1         numeric check (shopee_1   is null or (shopee_1   > 0 and shopee_1   <= 10000000)),
  shopee_3         numeric check (shopee_3   is null or (shopee_3   > 0 and shopee_3   <= 10000000)),
  shopee_5         numeric check (shopee_5   is null or (shopee_5   > 0 and shopee_5   <= 10000000)),
  shopee_10        numeric check (shopee_10  is null or (shopee_10  > 0 and shopee_10  <= 10000000)),

  -- full parsed row set, in case the sheet grows/renames columns later and
  -- we need to recover a field that wasn't promoted to its own column yet.
  raw              jsonb,

  -- ขายออกต้องไม่ถูกกว่าซื้อเข้า ทุกขนาด — เช็คเดียวกับ silver_price_daily
  -- (0072) กันคอลัมน์สลับกันตั้งแต่ตอนเขียน
  constraint silver_price_history_spread_sane check (
    (sell_0_5 is null or buy_0_5 is null or sell_0_5 >= buy_0_5) and
    (sell_1   is null or buy_1   is null or sell_1   >= buy_1) and
    (sell_3   is null or buy_3   is null or sell_3   >= buy_3) and
    (sell_5   is null or buy_5   is null or sell_5   >= buy_5) and
    (sell_10  is null or buy_10  is null or sell_10  >= buy_10) and
    (kilo_sell is null or kilo_buy is null or kilo_sell >= kilo_buy)
  ),

  -- กันบันทึกซ้ำเมื่อ Sheet ไม่เปลี่ยน (ดูคอมเมนต์ sheet_row_hash ด้านบน)
  constraint silver_price_history_shop_hash_unique unique (shop_id, sheet_row_hash)
);

comment on table analytics.silver_price_history is
  'Append-only capture log of the Google Sheet feeding 3jthailand.com''s silver price page — 1 row per capture, never updated/overwritten. '
  'Public columns (sell_*/buy_*/kilo_*) mirror what the live site already shows. '
  'Internal columns (silver_value_per_baht/usd_*/thb_per_kg/block_fee_*/margin_component_*/shopee_*) are cost/margin inputs the site never '
  'announces — NEVER expose them via a public view/RPC (see docs/3j-jewelry/pricing-disclosure-policy.md). '
  'v_silver_price_public_14d is the only view meant to face the public web in future and it excludes every internal column by construction.';

create index idx_silver_price_history_shop_captured
  on analytics.silver_price_history (shop_id, captured_at desc);

alter table analytics.silver_price_history enable row level security;

-- Read: same tenant-select shape as every other analytics.* table. Write:
-- deliberately NO insert/update/delete policy — this table is written only
-- by the capture script's service-role client, which bypasses RLS entirely
-- (see lib/supabase/server.ts header). 0018's default privileges only grant
-- authenticated SELECT on new tables (not INSERT/UPDATE/DELETE), so leaving
-- those ungranted here is enough — no explicit revoke needed, matching the
-- brief's "insert ผ่าน service_role เท่านั้นก็พอ".
create policy silver_price_history_tenant_select on analytics.silver_price_history
  for select using (
    shop_id in (select shop_id from public.shop_member where user_id = auth.uid())
  );

-- ============================================================
-- View: last 14 days, public columns only, latest capture per Bangkok-day.
-- security_invoker=true (same posture as every other view in this schema) —
-- wiring this up to actually be readable by an unauthenticated Wix visitor
-- (anon key + a narrower policy, or a dedicated RPC) is deliberately OUT of
-- scope for this migration; creating the view does not by itself expose
-- anything beyond what tenant-select already allows.
-- ============================================================
create or replace view analytics.v_silver_price_public_14d
  with (security_invoker = true) as
select distinct on (shop_id, (captured_at at time zone 'Asia/Bangkok')::date)
  shop_id,
  captured_at,
  sell_0_5, buy_0_5,
  sell_1, buy_1,
  sell_3, buy_3,
  sell_5, buy_5,
  sell_10, buy_10,
  kilo_sell, kilo_sell_vat, kilo_buy
from analytics.silver_price_history
where captured_at > now() - interval '14 days'
order by shop_id, (captured_at at time zone 'Asia/Bangkok')::date, captured_at desc;

comment on view analytics.v_silver_price_public_14d is
  'Public-safe silver price history, last 14 days, 1 row per Bangkok-day (latest capture that day) — intended source for a future public Wix page. '
  'Public columns ONLY — see analytics.silver_price_history comment before adding any column here.';

grant select on all tables in schema analytics to authenticated, service_role;

notify pgrst, 'reload schema';

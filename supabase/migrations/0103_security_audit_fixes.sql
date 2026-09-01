-- 0103_security_audit_fixes.sql
-- Security audit (0901) — 2 of 3 findings that touch the DB (the 3rd,
-- postgrest-js .in() escaping, is an application-layer fix in
-- lib/import/source-types.ts + its call sites, no schema change needed).
--
-- ⚠️ PREPARED, NOT APPLIED — this file is written to be reviewed and applied
-- by the owner via the Supabase MCP (supabase-migrate skill: pre-check →
-- apply_migration → self-verify → get_advisors). Do not run this against a
-- live project as part of writing it.

-- ============================================================================
-- 1. analytics.v_silver_price_trend — drop spread_per_baht
--
-- Confirmed against live data (2026-09-01): for source='sheet' rows,
-- sell_per_baht AND buy_per_baht are BOTH populated (0074 only nulled
-- sell_per_baht for source='feed', the website-scrape path — it left the
-- manually-entered sheet path untouched). spread_per_baht was defined as
-- `sell_per_baht - buy_per_baht`, which for those rows evaluates to exactly
-- 30 — the buy-back spread the shop has decided must never be disclosed
-- (docs/3j-jewelry/pricing-disclosure-policy.md; also flagged 0102's header
-- comment on silver_price_history as 🔴 INTERNAL for the same reason). 0074
-- intentionally nulled sell_per_baht to keep this from being computable; the
-- 0102 capture-script rework silently reopened it for the sheet source.
--
-- Column removed from the MIDDLE of the select list, so `create or replace
-- view` would fail with 42P16 (3j-migration-traps skill #3) — drop + create
-- instead. Every other column is carried over UNCHANGED and in the same
-- order from 0074 (the last migration that touched this view), same
-- window/frame definitions, same security_invoker.
-- ============================================================================

drop view if exists analytics.v_silver_price_trend;

create view analytics.v_silver_price_trend
with (security_invoker = true) as
select
  s.shop_id,
  s.as_of_date,
  -- sell_per_baht deliberately NOT selected. Dropping only the derived
  -- spread_per_baht column would have been theatre: any reader holding both
  -- sell_per_baht and buy_per_baht can subtract them and get the same 30.
  -- Removing the input, not just the output, is what actually closes it.
  -- Nothing reads it — grepped components/ lib/ app/: zero hits (only
  -- migrations and the capture script, which WRITES to the base table).
  s.buy_per_baht,
  s.bar_1_baht,
  s.bar_10_baht,
  s.kilo_sell,
  s.kilo_buy,
  lag(s.buy_per_baht) over w                                as prev_buy,
  round(
    100.0 * (s.buy_per_baht - lag(s.buy_per_baht) over w)
    / nullif(lag(s.buy_per_baht) over w, 0), 2
  )                                                         as pct_change_vs_prev,
  round(
    100.0 * (s.buy_per_baht - first_value(s.buy_per_baht) over w7)
    / nullif(first_value(s.buy_per_baht) over w7, 0), 2
  )                                                         as pct_change_7d
from analytics.silver_price_daily s
window
  w  as (partition by s.shop_id order by s.as_of_date),
  w7 as (partition by s.shop_id order by s.as_of_date
         rows between 7 preceding and current row);

comment on view analytics.v_silver_price_trend is
  'แนวโน้มราคาเงินรายวัน — คิด % จาก buy_per_baht (ราคาเนื้อเงินล้วน) เพราะเป็นชุดเดียวที่นิยามตรงกันทุกแหล่งข้อมูล. '
  'ถอดออก 0103 ทั้ง spread_per_baht และ sell_per_baht: ผลลบของสองค่านั้นในแถว source=sheet เท่ากับ 30 เป๊ะ ซึ่งคือส่วนต่างรับซื้อคืนภายในที่ห้ามเปิดเผยเด็ดขาด. '
  'ลบเฉพาะคอลัมน์ผลลัพธ์ไม่พอ ต้องถอดตัวตั้งออกด้วย ไม่งั้นคนอ่าน view ก็ลบเลขเองได้ — ดู 🔴 INTERNAL comment บน silver_price_daily.sell_per_baht.';

-- View grants don't survive drop+create (unlike a bare create-or-replace,
-- this literally is a new relation as far as pg_class is concerned) —
-- re-grant explicitly, same roles 0102 granted schema-wide.
grant select on analytics.v_silver_price_trend to authenticated, service_role;

-- ============================================================================
-- 2. analytics.oem_doc_counter — restore the revoke that blanket grants undid
--
-- Confirmed against live data (2026-09-01): `authenticated` currently HAS
-- select on this table. 0085 explicitly revoked it (§4 of that file: RLS has
-- no policy on this table, so authenticated select returns 0 rows and no
-- data actually leaked, but the table was unintentionally exposed as a
-- PostgREST endpoint — /rest/v1/oem_doc_counter — which 0085 closed on
-- purpose). Every migration since that ships a table (0099, 0100, 0101,
-- 0102) ends with `grant select on all tables in schema analytics to
-- authenticated, service_role` (3j-migration-traps skill #7: exactly the
-- "grant เหวี่ยงแห" pattern that's banned) — each one silently re-granted
-- select on oem_doc_counter too, because ALL TABLES IN SCHEMA re-applies to
-- every existing table, not just the one the migration is actually about.
--
-- This migration does NOT add another blanket grant (that would just repeat
-- the bug on the next migration) — it only restores the one revoke that got
-- clobbered. The doc-integrity trigger (0087/0088) that guards
-- INSERT/UPDATE/DELETE on this table is unaffected either way; this is
-- select-only.
-- ============================================================================

revoke select on analytics.oem_doc_counter from authenticated, anon;

-- ============================================================================
-- 3. Comment to stop this from silently regressing a third time
-- ============================================================================

comment on column analytics.silver_price_daily.sell_per_baht is
  '🔴 INTERNAL — ราคาเนื้อเงินขาขายออกต่อน้ำหนัก 1 บาท. NULL เสมอเมื่อ source=feed (0074, ตั้งใจ — เว็บร้านไม่ประกาศค่านี้) แต่มีค่าจริงเมื่อ source=sheet. '
  'ห้ามนำไปโชว์คู่กับ buy_per_baht ใน view/RPC ใดๆ ที่ authenticated/anon อ่านได้ — ผลลบกันได้ 30 เป๊ะ ซึ่งคือส่วนต่างรับซื้อคืนที่ร้านห้ามเปิดเผย (0103 ถอด spread_per_baht ออกจาก v_silver_price_trend ด้วยเหตุผลเดียวกัน).';

notify pgrst, 'reload schema';

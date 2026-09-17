-- 0128_silver_spot_atomicity_and_business_day.sql
-- ✅ APPLIED 17 ก.ย. 69 via MCP (version 20260917081220) — dry-run ผ่านครบ
-- D1a/D1b / D2 / E1 / E1b (70.00004 ไม่นับเปลี่ยน) / D3 / D4a-c / E3+E4
-- (as_of=วันไทย, shop_setting mirror=68) / E2 (ค่าเท่าเดิมผ่าน /oem/rates
-- ยังได้ manual) / E5 (2 วันก่อน → oem ของวันนั้น 65.5996/sheet, วันนี้ไม่ขยับ)
-- / D5 — รวม function-count check (3 signature เดิม ไม่มี overload หลุด) —
-- rollback สะอาด ไม่มี state ค้าง.
--
-- code-reviewer ROUND 2 on 0127 (B1/S1/S3 confirmed closed — still Request
-- Changes). 0127 is already applied to prod; its DDL is frozen (only a
-- header comment there was corrected, no functional change) — every fix
-- below is a fresh `create or replace` on the SAME signatures (3j-migration-
-- traps ข้อ 1: none of these are new overloads).
--
--   Blocker  analytics.oem_metal_price_set's `p_as_of date default
--     current_date` resolves in the DATABASE's session timezone, which is
--     UTC — NOT a Thai business day (3j-migration-traps ข้อ 6). Between
--     00:00–07:00 ไทย (right after the nightly live ends — the exact window
--     the owner is actually in this screen, per memory "live-selling-
--     rhythm") current_date is still "yesterday" UTC. A manual entry typed
--     then would silently land on YESTERDAY's oem_metal_price row — and the
--     sync trigger's manual-guard, which only ever checks TODAY's
--     as_of_date, would never see it, so the next morning's sheet capture
--     would overwrite the price the owner just fixed. Fixed: default
--     changed to `null`, resolved inside the function body to
--     `(now() at time zone 'Asia/Bangkok')::date` when the caller doesn't
--     pass one explicitly.
--   Atomicity  0127's header claimed the manual pre-check + the two table
--     writes were "a single decision point" — true for STATEMENT ORDER but
--     not for CONCURRENCY: nothing stopped a sheet-capture trigger (its own
--     transaction, fired by the capture script's INSERT) and a manual RPC
--     call (its own transaction, fired by a page save) from interleaving
--     between the SELECT and the INSERTs — each could read a stale "no
--     manual yet" / "no newer capture yet" answer and both proceed to write,
--     landing in an inconsistent final state depending on commit order.
--     Fixed: all three writers of this shared state (the trigger,
--     shop_setting_upsert, and oem_metal_price_set for metal='silver') now
--     take the SAME per-shop advisory transaction lock —
--     `pg_advisory_xact_lock(hashtextextended('silver_spot:' || shop_id::text, 0))`
--     — before reading any of it, so only one of them can be mid-decision
--     for a given shop at a time. Auto-released at transaction end (commit
--     OR rollback) — never held across a network round-trip, never a
--     deadlock risk between these three (none of them call each other).
--   Split-brain (found while fixing the above)  a manual entry made via
--     /oem/rates (oem_metal_price_set, metal='silver', as_of=today) wrote
--     oem_metal_price ONLY — analytics.shop_setting.silver_spot_thb_per_gram
--     (what SKU costing, dashboards, and /settings itself actually read —
--     see 0028/0062) kept the OLD value until the next sheet sync or an
--     explicit /settings save. Two different "the current silver price" for
--     the same shop at the same time, one per table. Fixed: oem_metal_price_set
--     now mirrors the write into shop_setting too, but ONLY when
--     metal='silver' AND the resolved as_of date is TODAY (Thai) — a
--     backdated/historical entry (e.g. someone correcting last week's row)
--     must never overwrite today's live price in shop_setting.
--   N2  shop_setting_upsert's v_spot_changed (0127) compared the raw
--     p_silver_spot_thb_per_gram parameter against v_prev_spot — but the
--     column is numeric(12,4) (0028:67). A client sending extra float
--     precision that would round to the SAME stored value (e.g. re-parsing
--     "67.6988" as a JS number and back) could still compare as "different"
--     and trigger an unnecessary manual entry. Fixed: compare
--     `round(p_silver_spot_thb_per_gram, 4)` against v_prev_spot (which is
--     already stored at that precision).
--   N3  the staleness guard (S2/0127) compared captured_at against
--     shop_setting.silver_spot_updated_at UNCONDITIONALLY, for every capture
--     row regardless of which day it was for. But that column is a single
--     "current price, as of today" pointer — it has no business deciding
--     whether a BACKDATED capture (a backfill/retry inserting, say, last
--     Tuesday's price) gets to write ITS OWN day's oem_metal_price row. Under
--     0127, a backfill could get silently dropped from BOTH tables just
--     because today's price happens to be "newer" than the historical row —
--     even though the backfill was never trying to touch today's price at
--     all. Fixed: staleness AND the manual-guard now only ever gate
--     shop_setting (today's single-row pointer, branch below). A capture row
--     for any OTHER day always writes its own day's oem_metal_price row
--     (still never clobbering a 'manual' row for that specific day via the
--     same belt-and-braces WHERE clause) and never touches shop_setting.
--
-- Not fixed here — flagged by code review as lower-severity, Tech Lead
-- accepted as debt for a later round (see "หนี้ที่รู้ตัว" at file end):
--   N5 a single shared bounds-checking helper instead of the same 5/500
--      literal copied into 4 places — pure DRY, not a correctness bug (the
--      4 places are exercised by this file's dry-run + lib/catalog/
--      types.test.ts every time any of them changes).
--   N6 showing analytics.oem_metal_price.source ('sheet' vs 'manual') on
--      screen so the owner can tell which one is currently authoritative
--      without querying the DB directly.
--
-- Constants (SILVER_SPOT_FLOOR=5, SILVER_SPOT_CEILING=500 บาท/กรัม,
-- GRAMS_PER_BAHT_WEIGHT=15.244) are unchanged by this file and still match
-- across the same FOUR layers 0127 documented.
--
-- ============================================================================
-- 1. Trigger — advisory lock added right after the cheap null-return
--    bailout; staleness + manual-guard moved inside an `if v_as_of_date =
--    v_today` branch (N3) so they only ever gate shop_setting (today's
--    pointer) — a backdated capture falls into the `else` branch, which
--    writes only its own day's oem_metal_price row.
-- ============================================================================

create or replace function analytics.silver_spot_sync_from_history()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_per_gram numeric;
  v_as_of_date date;
  v_today date;
  v_last_updated timestamptz;
  v_manual_exists boolean;
begin
  if new.silver_value_per_baht is null then
    return new;
  end if;

  -- Atomicity (0128): every writer of shop_setting/oem_metal_price's silver
  -- state takes this SAME per-shop advisory lock before reading any of it —
  -- see shop_setting_upsert and oem_metal_price_set below for the other two.
  -- Scoped to this transaction only (pg_advisory_XACT_lock, not the session
  -- variant) — released automatically at commit or rollback, so it can never
  -- leak past a single INSERT into silver_price_history.
  perform pg_advisory_xact_lock(hashtextextended('silver_spot:' || new.shop_id::text, 0));

  v_per_gram := round(new.silver_value_per_baht / 15.244, 4);

  -- H1 (0126): bound check stays UNCONDITIONAL — applies to every capture
  -- row regardless of which day it's for, so a garbled sheet row always logs
  -- a WARNING no matter what state today/that-day is in.
  if not (v_per_gram >= 5 and v_per_gram <= 500) then
    raise warning 'silver_spot_sync_from_history: silver_value_per_baht=% -> %/ก. นอกช่วง 5–500 ไม่ sync (shop_id=%, captured_at=%)',
      new.silver_value_per_baht, v_per_gram, new.shop_id, new.captured_at;
    return new;
  end if;

  v_as_of_date := (new.captured_at at time zone 'Asia/Bangkok')::date;
  v_today := (now() at time zone 'Asia/Bangkok')::date;

  if v_as_of_date = v_today then
    -- S2/M1 (0126/0127) — staleness then manual-guard, gating shop_setting
    -- (today's single-row "current price" pointer) as well as today's
    -- oem_metal_price row, exactly as before.
    select ss.silver_spot_updated_at into v_last_updated
    from analytics.shop_setting ss where ss.shop_id = new.shop_id;

    if v_last_updated is not null and new.captured_at < v_last_updated then
      raise notice 'silver_spot_sync_from_history: captured_at=% เก่ากว่า silver_spot_updated_at=% ที่มีอยู่ (shop_id=%) — ข้าม sync ทั้ง 2 ตาราง (retry/backfill มาไม่เรียงลำดับ)',
        new.captured_at, v_last_updated, new.shop_id;
      return new;
    end if;

    select exists (
      select 1 from analytics.oem_metal_price
      where shop_id = new.shop_id and metal = 'silver' and as_of_date = v_as_of_date and source = 'manual'
    ) into v_manual_exists;

    if v_manual_exists then
      raise notice 'silver_spot_sync_from_history: shop_id=% มี manual entry ของวัน % อยู่แล้ว — ข้าม sync ทั้ง shop_setting และ oem_metal_price (manual ชนะทั้งวัน)',
        new.shop_id, v_as_of_date;
      return new;
    end if;

    insert into analytics.shop_setting as ss (
      shop_id, silver_spot_thb_per_gram, silver_spot_updated_at, updated_at, updated_by
    )
    values (new.shop_id, v_per_gram, new.captured_at, now(), null)
    on conflict (shop_id) do update
      set silver_spot_thb_per_gram = v_per_gram,
          silver_spot_updated_at   = new.captured_at,
          updated_at               = now(),
          updated_by               = null -- sheet sync isn't "an admin edited this row"
      -- belt-and-braces: the up-front staleness decision above already
      -- covers this; this WHERE only guards a same-transaction race (two
      -- capture rows for the same shop committing concurrently) — largely
      -- moot now that the advisory lock above serializes writers, kept as
      -- defense-in-depth since it costs nothing.
      where ss.silver_spot_updated_at is null or new.captured_at >= ss.silver_spot_updated_at;

    insert into analytics.oem_metal_price as omp (
      shop_id, metal, as_of_date, price_thb_per_gram, source, updated_by, updated_at
    )
    values (
      new.shop_id, 'silver', v_as_of_date,
      v_per_gram, 'sheet', null, now()
    )
    on conflict (shop_id, metal, as_of_date) do update
      set price_thb_per_gram = v_per_gram,
          source             = 'sheet',
          updated_by         = null,
          updated_at         = now()
      where omp.source <> 'manual';
  else
    -- N3 (0128): a capture row for a day OTHER than today (backfill/retry
    -- for a past business day) never touches shop_setting — that column
    -- only ever means "today's price" — and never runs the up-front
    -- v_manual_exists check either (nothing to short-circuit: there's no
    -- shop_setting write to skip in this branch). It still refuses to
    -- clobber a manual entry for THAT SPECIFIC day via the same `source <>
    -- 'manual'` WHERE guard used above — simpler than duplicating the
    -- SELECT EXISTS pre-check for a case that only ever writes one row.
    insert into analytics.oem_metal_price as omp (
      shop_id, metal, as_of_date, price_thb_per_gram, source, updated_by, updated_at
    )
    values (
      new.shop_id, 'silver', v_as_of_date,
      v_per_gram, 'sheet', null, now()
    )
    on conflict (shop_id, metal, as_of_date) do update
      set price_thb_per_gram = v_per_gram,
          source             = 'sheet',
          updated_by         = null,
          updated_at         = now()
      where omp.source <> 'manual';
  end if;

  return new;
end;
$$;

revoke execute on function analytics.silver_spot_sync_from_history() from public, anon, authenticated;
-- (unchanged: fired by trigger only, never called as an RPC — Postgres
-- doesn't check EXECUTE privilege when a trigger fires.)

-- ============================================================================
-- 2. shop_setting_upsert — N2 fix (round both sides to the column's actual
--    precision before comparing) + the same advisory lock, taken AFTER
--    crm_require_owner_admin so an unauthorized caller fails fast without
--    contending for a lock it was never going to use (trade-off: the lock
--    technically isn't the FIRST executable statement after the raise-
--    exception validation block, it's the first statement after
--    authorization — chosen deliberately, see rationale on the `perform
--    pg_advisory_xact_lock` line below). Signature unchanged (uuid, numeric,
--    numeric, numeric) — grant re-issued (3j-migration-traps ข้อ 1/2).
-- ============================================================================

create or replace function analytics.shop_setting_upsert(
  p_shop_id uuid,
  p_silver_spot_thb_per_gram numeric default null,
  p_blended_margin_pct numeric default null,
  p_target_ad_gp_share numeric default null
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_prev_spot numeric;
  v_spot_changed boolean;
begin
  if p_shop_id is null then
    raise exception 'shop_setting_upsert: p_shop_id is required';
  end if;
  if p_blended_margin_pct is not null and (p_blended_margin_pct <= 0 or p_blended_margin_pct >= 1) then
    raise exception 'shop_setting_upsert: p_blended_margin_pct must be in (0,1)';
  end if;
  if p_target_ad_gp_share is not null and (p_target_ad_gp_share <= 0 or p_target_ad_gp_share > 1) then
    raise exception 'shop_setting_upsert: p_target_ad_gp_share must be in (0,1]';
  end if;
  if p_silver_spot_thb_per_gram is not null and not (p_silver_spot_thb_per_gram >= 5 and p_silver_spot_thb_per_gram <= 500) then
    raise exception 'shop_setting_upsert: p_silver_spot_thb_per_gram must be between 5 and 500 (ต่อกรัม ไม่ใช่ต่อบาท — 1 บาท = 15.244 กรัม)';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  -- Atomicity (0128): same per-shop lock as the trigger/oem_metal_price_set
  -- — placed AFTER the authorization check above (not literally the first
  -- line after the raise-exception block) so a caller who fails
  -- crm_require_owner_admin never has to wait in the lock queue for a write
  -- it was always going to be rejected before making; every code path that
  -- DOES reach a read/write of shared state below has already taken the lock.
  perform pg_advisory_xact_lock(hashtextextended('silver_spot:' || p_shop_id::text, 0));

  select ss.silver_spot_thb_per_gram into v_prev_spot
  from analytics.shop_setting ss where ss.shop_id = p_shop_id;

  -- N2 (0128): round to the column's actual precision (numeric(12,4),
  -- 0028:67) before comparing — v_prev_spot is already stored at that
  -- precision; without rounding p_silver_spot_thb_per_gram too, a caller
  -- sending extra float noise that would round to the SAME stored value
  -- could still be flagged "changed" and write an unnecessary manual entry.
  v_spot_changed := p_silver_spot_thb_per_gram is not null
    and (v_prev_spot is null or v_prev_spot <> round(p_silver_spot_thb_per_gram, 4));

  insert into analytics.shop_setting as ss (
    shop_id, silver_spot_thb_per_gram, silver_spot_updated_at,
    blended_margin_pct, target_ad_gp_share, updated_by, updated_at
  ) values (
    p_shop_id, p_silver_spot_thb_per_gram,
    case when v_spot_changed then now() else null end,
    coalesce(p_blended_margin_pct, 0.20), coalesce(p_target_ad_gp_share, 0.50), auth.uid(), now()
  )
  on conflict (shop_id) do update set
    silver_spot_thb_per_gram = coalesce(p_silver_spot_thb_per_gram, ss.silver_spot_thb_per_gram),
    silver_spot_updated_at   = case when v_spot_changed then now() else ss.silver_spot_updated_at end,
    blended_margin_pct       = coalesce(p_blended_margin_pct, ss.blended_margin_pct),
    target_ad_gp_share       = coalesce(p_target_ad_gp_share, ss.target_ad_gp_share),
    updated_by               = auth.uid(),
    updated_at               = now();

  if v_spot_changed then
    insert into analytics.oem_metal_price as omp (
      shop_id, metal, as_of_date, price_thb_per_gram, source, updated_by, updated_at
    ) values (
      p_shop_id, 'silver', (now() at time zone 'Asia/Bangkok')::date,
      p_silver_spot_thb_per_gram, 'manual', auth.uid(), now()
    )
    on conflict (shop_id, metal, as_of_date) do update
      set price_thb_per_gram = excluded.price_thb_per_gram,
          source             = 'manual',
          updated_by         = excluded.updated_by,
          updated_at         = now();
  end if;
end;
$$;

revoke execute on function analytics.shop_setting_upsert(uuid, numeric, numeric, numeric)
  from public, anon, authenticated;
grant execute on function analytics.shop_setting_upsert(uuid, numeric, numeric, numeric)
  to authenticated, service_role;

-- ============================================================================
-- 3. oem_metal_price_set — Blocker fix (p_as_of default null, resolved to
--    Thai "today" in-body) + the split-brain fix (mirrors a today silver
--    write into shop_setting) + the same advisory lock (silver only — gold/
--    brass never touch shop_setting, so they never need to contend for it).
--    Signature CHANGES its default value only (uuid, text, numeric, date,
--    text — same types/order/count, still not a new overload per Postgres'
--    signature-matching rules, which key on types not defaults).
-- ============================================================================

create or replace function analytics.oem_metal_price_set(
  p_shop_id uuid,
  p_metal text,
  p_price numeric,
  p_as_of date default null,
  p_source text default 'manual'
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
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
  end if;

  if p_source not in ('manual', 'feed', 'sheet') then
    raise exception 'oem_metal_price_set: p_source must be manual/feed/sheet';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  -- Blocker (0128): was `default current_date` — a UTC date, wrong "today"
  -- for a Thai shop between 00:00–07:00 ไทย (3j-migration-traps ข้อ 6).
  -- `null` now means "resolve to today, Thai time" inside the function.
  v_today := (now() at time zone 'Asia/Bangkok')::date;
  v_as_of := coalesce(p_as_of, v_today);

  if p_metal = 'silver' then
    -- Atomicity (0128): same per-shop lock as the trigger/shop_setting_upsert
    -- — only silver shares state with shop_setting (the mirror-write below),
    -- so gold/brass skip it entirely (they have nothing to serialize against).
    perform pg_advisory_xact_lock(hashtextextended('silver_spot:' || p_shop_id::text, 0));
  end if;

  -- Append-only across days (§2.4 relies on real history); same-day re-entry
  -- collapses to a correction rather than stacking duplicate rows for one
  -- day. Unlike shop_setting_upsert, this RPC has NO "did the value actually
  -- change" guard — every call here is an explicit "set the price to X"
  -- action from /oem/rates (not a form that prefills-and-resubmits, see
  -- MetalPriceSection.tsx's own `Math.abs(...) < 1e-9` early-return before
  -- ever calling this action), so an unconditional upsert is correct here.
  insert into analytics.oem_metal_price (shop_id, metal, as_of_date, price_thb_per_gram, source, updated_by, updated_at)
  values (p_shop_id, p_metal, v_as_of, p_price, p_source, auth.uid(), now())
  on conflict (shop_id, metal, as_of_date) do update set
    price_thb_per_gram = excluded.price_thb_per_gram, source = excluded.source,
    updated_by = auth.uid(), updated_at = now();

  -- Split-brain fix (0128): mirror a TODAY silver write into shop_setting —
  -- the column SKU costing/dashboards/`/settings` itself actually reads
  -- (0028/0062) — so /oem/rates and /settings can never disagree about
  -- "today's" price. A backdated/historical entry (v_as_of <> v_today) must
  -- NEVER touch shop_setting (that column only ever means "today"), so this
  -- is unconditionally skipped for anything other than today.
  if p_metal = 'silver' and v_as_of = v_today then
    insert into analytics.shop_setting as ss (
      shop_id, silver_spot_thb_per_gram, silver_spot_updated_at,
      blended_margin_pct, target_ad_gp_share, updated_by, updated_at
    ) values (
      p_shop_id, p_price, now(),
      0.20, 0.50, null, now() -- same defaults as shop_setting_upsert's first-ever insert
    )
    on conflict (shop_id) do update set
      silver_spot_thb_per_gram = p_price,
      silver_spot_updated_at   = now(),
      updated_at               = now(),
      updated_by               = null; -- this call didn't come through the /settings form
  end if;
end;
$$;

revoke execute on function analytics.oem_metal_price_set(uuid, text, numeric, date, text) from public, anon, authenticated;
grant execute on function analytics.oem_metal_price_set(uuid, text, numeric, date, text) to authenticated, service_role;

-- Nit (0128, folding in a leftover from round-2 review): 0127 issued
-- `notify pgrst, 'reload schema'` after EACH of its two replaced functions —
-- one at the end of a migration that touches PostgREST-exposed RPC
-- signatures is enough; PostgREST reloads its whole schema cache on the
-- notification, not just the one function.
notify pgrst, 'reload schema';

-- ============================================================================
-- หนี้ที่รู้ตัว (ไม่ทำในรอบนี้):
--   H2(ข) (0126) freshness gate ใน oem_price_calc (0062) ยังไม่ทำ — ใบเสนอ
--   ราคาวันนี้ยังอ่านราคาของวันก่อนหน้าได้ถ้าวันนี้ยังไม่มี capture/manual
--   entry เข้ามาเลย (oem-quote-invariants §5).
--   N5 bounds-checking logic (5/500 for silver, >0 for gold/brass) is still
--   copy-pasted across 3 PL/pgSQL functions + 1 TS module instead of one
--   shared helper — accepted as DRY debt, not correctness.
--   N6 analytics.oem_metal_price.source isn't surfaced on any screen — the
--   owner can't currently see "sheet" vs "manual" without querying the DB.
--   (0127's p_as_of/UTC debt entry is RESOLVED by this file — removed here.)
-- ============================================================================

-- ============================================================================
-- Dry-run (Tech Lead รันแยกผ่าน MCP ก่อน apply จริง ไม่ใช่ส่วนหนึ่งของไฟล์นี้ —
-- 3j-migration-traps ข้อ 11/12: do-block + raise บังคับ rollback, ตรวจ state
-- ก่อน-หลังไม่ขยับ). อ่านค่า spot ปัจจุบันของร้านจริงมาใช้แทนการ hardcode
-- ตัวเลข. เก็บ D1–D5 จาก 0127 ไว้ทั้งหมด (regression — ต้องยังผ่านเหมือนเดิม
-- หลังแก้รอบนี้) แล้วต่อด้วย E1–E5 (ก–จ ตามที่ Tech Lead สั่ง) สำหรับ
-- Blocker/Atomicity/split-brain/N2/N3.
--
-- E1/E2 ใช้ ctid (physical tuple location) แทนการเทียบ updated_at ตรงๆ —
-- ทั้ง do-block นี้รันในทรานแซกชันเดียว ดังนั้น now() คงที่ตลอดทั้งบล็อก
-- (Postgres: now() = เวลาที่ทรานแซกชันเริ่ม ไม่ใช่ clock_timestamp()) การ
-- เทียบ timestamp ก่อน-หลังจึงบอกไม่ได้ว่า "มี UPDATE เกิดขึ้นจริงไหม" —
-- ctid เปลี่ยนทุกครั้งที่มีการเขียนทับแถวจริง (แม้ค่าที่เขียนจะเหมือนเดิมก็
-- ตาม) จึงเป็นสัญญาณที่เชื่อถือได้ว่า statement ถูกรันจริงหรือถูกข้ามไปทั้ง
-- ก้อนโดย guard (`if v_spot_changed then ... end if;`).
--
-- do $$
-- declare
--   v_log text := E'\n=== ผลทดสอบ 0128 ===\n';
--   v_shop_id uuid := '<SHOP_ID>';
--   v_today date := (now() at time zone 'Asia/Bangkok')::date;
--   v_start_spot numeric;
--   v_ss numeric;
--   v_oem numeric;
--   v_oem_source text;
--   v_ss_before numeric;
--   v_oem_before numeric;
--   v_ctid_before tid;
--   v_ctid_after tid;
--   v_ss_ctid_before tid;
--   v_ss_ctid_after tid;
--   v_check_price numeric;
--   v_backdate_price numeric;
--   v_backdate_source text;
-- begin
--   perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
--
--   -- ===== D1 (จาก 0127, regression): resubmit ค่าเดิมผ่าน RPC แล้ว sheet
--   -- capture เข้า ต้อง sync ได้ตามปกติ (resubmit ไม่ล็อก) =====
--   select silver_spot_thb_per_gram into v_start_spot from analytics.shop_setting where shop_id = v_shop_id;
--   if v_start_spot is null then
--     v_log := v_log || 'D1: SKIP (ร้านนี้ยังไม่เคยมี silver_spot_thb_per_gram)\n';
--   else
--     perform analytics.shop_setting_upsert(v_shop_id, v_start_spot, null, null);
--     insert into analytics.silver_price_history (shop_id, sheet_row_hash, silver_value_per_baht, captured_at)
--     values (v_shop_id, 'dry-run-0128-d1-' || gen_random_uuid()::text, 1000, now());
--     select silver_spot_thb_per_gram into v_ss from analytics.shop_setting where shop_id = v_shop_id;
--     select price_thb_per_gram, source into v_oem, v_oem_source from analytics.oem_metal_price
--       where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--     if v_ss = 65.5996 and v_oem = 65.5996 and v_oem_source = 'sheet' then
--       v_log := v_log || format('D1 resubmit ค่าเดิมไม่ล็อก sync: OK (shop_setting=%s, oem_metal_price=%s/%s)\n', v_ss, v_oem, v_oem_source);
--     else
--       v_log := v_log || format('D1 resubmit ค่าเดิมไม่ล็อก sync: FAIL (shop_setting=%s, oem_metal_price=%s/%s)\n', v_ss, v_oem, v_oem_source);
--     end if;
--   end if;
--
--   -- ===== D2 (จาก 0127, regression): ตั้งค่าใหม่จริง (70) แล้ว sheet
--   -- capture เข้า ต้องยังล็อกได้ตามปกติ =====
--   perform analytics.shop_setting_upsert(v_shop_id, 70, null, null);
--   select price_thb_per_gram, source into v_oem, v_oem_source from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   if v_oem = 70 and v_oem_source = 'manual' then
--     v_log := v_log || 'D2a เปลี่ยนค่าจริงเขียน manual: OK\n';
--   else
--     v_log := v_log || format('D2a เปลี่ยนค่าจริงเขียน manual: FAIL (oem_metal_price=%s/%s)\n', v_oem, v_oem_source);
--   end if;
--   insert into analytics.silver_price_history (shop_id, sheet_row_hash, silver_value_per_baht, captured_at)
--   values (v_shop_id, 'dry-run-0128-d2-' || gen_random_uuid()::text, 1000, now());
--   select silver_spot_thb_per_gram into v_ss from analytics.shop_setting where shop_id = v_shop_id;
--   select price_thb_per_gram into v_oem from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   if v_ss = 70 and v_oem = 70 then
--     v_log := v_log || 'D2b manual ชนะทั้ง 2 ตาราง: OK\n';
--   else
--     v_log := v_log || format('D2b manual ชนะทั้ง 2 ตาราง: FAIL (shop_setting=%s, oem_metal_price=%s)\n', v_ss, v_oem);
--   end if;
--
--   -- ===== D3 (จาก 0127, regression): capture เก่ากว่า =====
--   select silver_spot_thb_per_gram into v_ss_before from analytics.shop_setting where shop_id = v_shop_id;
--   select price_thb_per_gram into v_oem_before from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   insert into analytics.silver_price_history (shop_id, sheet_row_hash, silver_value_per_baht, captured_at)
--   values (v_shop_id, 'dry-run-0128-d3-' || gen_random_uuid()::text, 900, now() - interval '10 minutes');
--   select silver_spot_thb_per_gram into v_ss from analytics.shop_setting where shop_id = v_shop_id;
--   select price_thb_per_gram into v_oem from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   if v_ss is not distinct from v_ss_before and v_oem is not distinct from v_oem_before then
--     v_log := v_log || 'D3 capture เก่ากว่า ไม่แตะทั้ง 2 ตาราง: OK\n';
--   else
--     v_log := v_log || format('D3 capture เก่ากว่า: FAIL (shop_setting %s->%s, oem_metal_price %s->%s)\n', v_ss_before, v_ss, v_oem_before, v_oem);
--   end if;
--
--   -- ===== D4 (จาก 0127, regression): oem_metal_price_set bounds =====
--   begin
--     perform analytics.oem_metal_price_set(v_shop_id, 'silver', 1097, null, 'manual');
--     v_log := v_log || 'D4a silver=1097: FAIL ผ่านทั้งที่ควรปฏิเสธ\n';
--   exception when others then
--     v_log := v_log || 'D4a silver=1097: OK ปฏิเสธ\n';
--   end;
--   begin
--     perform analytics.oem_metal_price_set(v_shop_id, 'silver', 'NaN'::numeric, null, 'manual');
--     v_log := v_log || 'D4b silver=NaN: FAIL ผ่านทั้งที่ควรปฏิเสธ\n';
--   exception when others then
--     v_log := v_log || 'D4b silver=NaN: OK ปฏิเสธ\n';
--   end;
--   begin
--     perform analytics.oem_metal_price_set(v_shop_id, 'gold', 3200, null, 'manual');
--     v_log := v_log || 'D4c gold=3200: OK ผ่าน\n';
--   exception when others then
--     v_log := v_log || 'D4c gold=3200: FAIL ถูกปฏิเสธทั้งที่ควรผ่าน\n';
--   end;
--
--   -- ===== D5 (จาก 0127, regression): นอกช่วง 5-500 ในวันที่มี manual =====
--   select silver_spot_thb_per_gram into v_ss_before from analytics.shop_setting where shop_id = v_shop_id;
--   select price_thb_per_gram into v_oem_before from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   insert into analytics.silver_price_history (shop_id, sheet_row_hash, silver_value_per_baht, captured_at)
--   values (v_shop_id, 'dry-run-0128-d5-' || gen_random_uuid()::text, 152440, now());
--   select silver_spot_thb_per_gram into v_ss from analytics.shop_setting where shop_id = v_shop_id;
--   select price_thb_per_gram into v_oem from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   if v_ss is not distinct from v_ss_before and v_oem is not distinct from v_oem_before then
--     v_log := v_log || 'D5 นอกช่วง 5-500 (มี manual อยู่แล้ว): OK — ดู server log ยืนยันเจอ WARNING\n';
--   else
--     v_log := v_log || format('D5 นอกช่วง 5-500: FAIL (shop_setting %s->%s, oem_metal_price %s->%s)\n', v_ss_before, v_ss, v_oem_before, v_oem);
--   end if;
--
--   -- state ตอนนี้ (หลัง D1-D5): shop_setting=70, oem_metal_price(silver,วันนี้)=70/manual.
--
--   -- ===== E1 (ก): resubmit ค่าเดิม (70) ผ่าน shop_setting_upsert อีกครั้ง
--   -- — ต้อง "ไม่แตะ" oem_metal_price เลย (ไม่ใช่แค่ค่าตัวเลขเท่าเดิม แต่
--   -- statement ต้องไม่รันเลย) — ใช้ ctid ตรวจ (ดูหมายเหตุด้านบน) =====
--   select omp.ctid into v_ctid_before from analytics.oem_metal_price omp
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   perform analytics.shop_setting_upsert(v_shop_id, 70, null, null);
--   select omp.ctid, omp.source into v_ctid_after, v_oem_source from analytics.oem_metal_price omp
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   if v_ctid_after = v_ctid_before and v_oem_source = 'manual' then
--     v_log := v_log || 'E1(ก) resubmit 70 ผ่าน shop_setting_upsert: OK (ctid ไม่เปลี่ยน = ไม่มี UPDATE เกิดขึ้นจริง, source ยัง manual)\n';
--   else
--     v_log := v_log || format('E1(ก) resubmit 70: FAIL (ctid %s->%s, source=%s)\n', v_ctid_before, v_ctid_after, v_oem_source);
--   end if;
--
--   -- ===== E2 (ข): oem_metal_price_set(silver, ค่าเท่ากับปัจจุบัน=70) — RPC
--   -- นี้ไม่มี guard "เปลี่ยนจริงไหม" (ต่างจาก shop_setting_upsert โดยตั้งใจ
--   -- — ดูคอมเมนต์ที่ตัวฟังก์ชัน) จึงต้องเขียนทับจริง (ctid เปลี่ยน) ทั้ง
--   -- oem_metal_price และ mirror เข้า shop_setting =====
--   select omp.ctid into v_ctid_before from analytics.oem_metal_price omp
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   select ss.ctid into v_ss_ctid_before from analytics.shop_setting ss where ss.shop_id = v_shop_id;
--   perform analytics.oem_metal_price_set(v_shop_id, 'silver', 70, null, 'manual');
--   select omp.ctid into v_ctid_after from analytics.oem_metal_price omp
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   select ss.ctid into v_ss_ctid_after from analytics.shop_setting ss where ss.shop_id = v_shop_id;
--   if v_ctid_after <> v_ctid_before and v_ss_ctid_after <> v_ss_ctid_before then
--     v_log := v_log || 'E2(ข) oem_metal_price_set(silver,70) เขียนซ้ำค่าเท่าเดิม: OK (ctid ของทั้ง 2 ตารางเปลี่ยน = UPDATE เกิดจริงทั้งคู่ — shop_setting.silver_spot_updated_at ขยับ)\n';
--   else
--     v_log := v_log || format('E2(ข) FAIL (oem ctid %s->%s, shop_setting ctid %s->%s)\n', v_ctid_before, v_ctid_after, v_ss_ctid_before, v_ss_ctid_after);
--   end if;
--
--   -- ===== E3 (ค): oem_metal_price_set(silver, 68, p_as_of=null) — as_of
--   -- ต้อง resolve เป็นวันไทยวันนี้ (ตรวจทางอ้อม: ถ้า resolve ผิดวัน แถวของ
--   -- "วันนี้" จะไม่ขยับเป็น 68) =====
--   perform analytics.oem_metal_price_set(v_shop_id, 'silver', 68, null, 'manual');
--   select price_thb_per_gram into v_check_price from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   if v_check_price = 68 then
--     v_log := v_log || 'E3(ค) p_as_of=null resolve เป็นวันไทยวันนี้: OK (แถวของวันนี้ = 68)\n';
--   else
--     v_log := v_log || format('E3(ค) FAIL (แถวของวันนี้ = %s, คาดว่า 68)\n', v_check_price);
--   end if;
--
--   -- ===== E4 (ง): oem_metal_price_set(silver, 69, p_as_of=วันนี้ตรงๆ) —
--   -- shop_setting ต้องได้ 69 ด้วย (split-brain fix) =====
--   perform analytics.oem_metal_price_set(v_shop_id, 'silver', 69, v_today, 'manual');
--   select silver_spot_thb_per_gram into v_ss from analytics.shop_setting where shop_id = v_shop_id;
--   if v_ss = 69 then
--     v_log := v_log || 'E4(ง) mirror เข้า shop_setting: OK (shop_setting=69)\n';
--   else
--     v_log := v_log || format('E4(ง) FAIL (shop_setting=%s, คาดว่า 69)\n', v_ss);
--   end if;
--
--   -- ===== E5 (จ): แถวประวัติย้อนหลัง 2 วัน — ต้องไม่แตะ shop_setting/
--   -- oem_metal_price ของวันนี้เลย, ได้แค่แถวใหม่ของ "2 วันก่อน" =====
--   select silver_spot_thb_per_gram into v_ss_before from analytics.shop_setting where shop_id = v_shop_id;
--   select price_thb_per_gram into v_oem_before from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   insert into analytics.silver_price_history (shop_id, sheet_row_hash, silver_value_per_baht, captured_at)
--   values (v_shop_id, 'dry-run-0128-e5-' || gen_random_uuid()::text, 1000, now() - interval '2 days');
--   select silver_spot_thb_per_gram into v_ss from analytics.shop_setting where shop_id = v_shop_id;
--   select price_thb_per_gram into v_oem from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   select price_thb_per_gram, source into v_backdate_price, v_backdate_source from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver'
--       and as_of_date = ((now() - interval '2 days') at time zone 'Asia/Bangkok')::date;
--   if v_ss is not distinct from v_ss_before and v_oem is not distinct from v_oem_before
--     and v_backdate_price = 65.5996 and v_backdate_source = 'sheet' then
--     v_log := v_log || 'E5(จ) backfill 2 วันก่อนไม่แตะวันนี้: OK (วันนี้ shop_setting/oem_metal_price ไม่ขยับ, แถว 2 วันก่อน = 65.5996/sheet)\n';
--   else
--     v_log := v_log || format('E5(จ) FAIL (shop_setting %s->%s, oem วันนี้ %s->%s, แถวย้อนหลัง=%s/%s)\n',
--       v_ss_before, v_ss, v_oem_before, v_oem, v_backdate_price, v_backdate_source);
--   end if;
--
--   raise exception '%', v_log; -- บังคับ rollback ทั้งก้อน — DB ไม่ขยับจริง
-- end $$;
-- ============================================================================

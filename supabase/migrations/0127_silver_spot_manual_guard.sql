-- 0127_silver_spot_manual_guard.sql
-- ✅ APPLIED 17 ก.ย. 69 via MCP (version 20260917075555) — dry-run ผ่านครบ
-- D1a/D1b (resubmit + margin-only ไม่ล็อก sync, ชีต 1000 -> 65.5996 ทั้ง 2
-- ตาราง) / D2a/D2b (เปลี่ยนค่าจริงยังคงเขียน manual + ล็อกได้ปกติ) / D3
-- (capture เก่ากว่าไม่แตะทั้ง 2 ตาราง) / D4a-d (silver=1097 ปฏิเสธ, silver=NaN
-- ปฏิเสธ, gold=3200 ผ่าน, silver=68 ผ่าน) / D5 (นอกช่วง 5-500 ไม่ขยับ แม้มี
-- manual entry อยู่แล้ว) — rollback สะอาด ไม่มี state ค้าง.
--
-- code-reviewer findings on 0125+0126 (silver spot sync), fixed here:
--
--   B1 (blocker) components/domain/catalog/SettingsForm.tsx:32,60-69 prefills
--      the spot field with whatever the sheet last synced, then resubmits it
--      on EVERY save — so saving just the margin re-sends the unchanged spot
--      value, and shop_setting_upsert (0126) treated "a value is present" as
--      "the owner typed this", writing a manual oem_metal_price row and
--      silently locking BOTH tables out of the day's sheet sync. Client-side
--      change detection (part 2 below, spotChanged()) cuts how often this
--      fires, but the real gate has to live in the DB — the RPC can't trust
--      the caller to have diffed correctly (memory "role-single-level": a
--      rule that must actually hold goes in the DB, not the button). Fixed
--      below in shop_setting_upsert: read the row's CURRENT value first and
--      only treat the call as a manual entry when it actually differs.
--   S1 analytics.oem_metal_price_set (0061:592-594, called from
--      lib/actions/oem.ts saveMetalPrice → /oem/rates →
--      MetalPriceSection.tsx) only rejected `p_price <= 0` — no ceiling, and
--      `<=` lets NaN through ('NaN'::numeric <= 0 is FALSE in Postgres —
--      3j-migration-traps ข้อ 4). Typing 1097 (the exact per-baht-not-
--      per-gram mistake 0125 fixed) here wrote source='manual' straight into
--      oem_metal_price and locked the whole day out of sheet sync the same
--      way B1 did — a 4th door nobody had bounded yet.
--   S2 the "don't let a stale/out-of-order write clobber something newer"
--      guard only existed on shop_setting's WHERE clause (0126:102) —
--      nothing stopped a backfill/retry insert into oem_metal_price from
--      landing a stale row there even when shop_setting itself stayed
--      correct. This file promotes that check to one up-front decision (see
--      part 1 below), but the manual pre-check (v_manual_exists) still runs
--      as a separate statement from the two inserts with nothing actually
--      preventing two transactions from interleaving between them — 🔴
--      code-reviewer round 2 caught that "single decision point" reads as
--      atomic but isn't; see 0128, which adds a real per-shop
--      pg_advisory_xact_lock shared by all three writers to close this for
--      real (also fixes N3: this file's staleness check unconditionally
--      compared against shop_setting's single "today" pointer even for a
--      BACKDATED capture, which could wrongly drop a legitimate backfill).
--   S3 SettingsForm.tsx:93 labelled the field "อัปเดตอัตโนมัติจากชีต" but
--      silver_spot_updated_at got stamped now() on every manual save too
--      (even a B1 no-op resubmit) — the label lied right after a manual
--      entry. Fixed together with B1 below: only stamp when the value
--      actually changed.
--   Nit bound-check (H1/0126) now runs before the manual-check so a garbled
--      sheet row always logs a WARNING even on a day that already has a
--      manual entry · shop_setting's trigger-driven DO UPDATE now sets
--      updated_by = null (sheet sync isn't "an admin edited this row") · the
--      auth.uid() comments below are corrected to say what actually happens
--      in this app today (see note at the RPC).
--
-- Constants (SILVER_SPOT_FLOOR=5, SILVER_SPOT_CEILING=500 บาท/กรัม เนื้อเงิน
-- 999, GRAMS_PER_BAHT_WEIGHT=15.244) now have to match across FOUR layers,
-- not the three 0126 claimed: lib/catalog/types.ts (client — also reused by
-- MetalPriceSection.tsx and lib/actions/oem.ts as of this commit),
-- analytics.shop_setting_upsert, analytics.silver_spot_sync_from_history
-- (trigger) — those three unchanged from 0126 — AND (new here, S1)
-- analytics.oem_metal_price_set. 0126's header comment claiming "3 ที่" is
-- stale as of this file; see the note added there pointing here.
--
-- ============================================================================
-- 1. Trigger — reorder checks: null → compute v_per_gram → bound 5–500 (H1,
--    raise warning + return, now runs FIRST) → staleness (S2, single
--    up-front decision before touching either table — belt-and-braces WHERE
--    clauses kept on both inserts same as 0126) → manual-check (M1) → write
--    both tables. + updated_by = null on the shop_setting DO UPDATE.
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
  v_last_updated timestamptz;
  v_manual_exists boolean;
begin
  -- silver_value_per_baht เป็น null ได้ตามปกติ (0125) — ไม่ทำอะไรเลยถ้าแถวนี้
  -- ไม่มีราคาต่อบาทให้ใช้ (ไม่ sync ราคาว่างทับของเดิม).
  if new.silver_value_per_baht is null then
    return new;
  end if;

  v_per_gram := round(new.silver_value_per_baht / 15.244, 4);

  -- H1 (0126), reordered (Nit): bound check runs FIRST, before the manual
  -- and staleness checks below, so a garbled sheet row (e.g. columns swapped
  -- / an extra digit -> 152,440/บาท -> ~10,000/ก.) ALWAYS logs a WARNING —
  -- previously the manual-guard (M1) could short-circuit before this ran,
  -- hiding the fact that today's sheet capture was also nonsense on a day
  -- that happened to have a manual entry already. not(between) ฆ่า
  -- NaN/Infinity ให้ฟรี (3j-migration-traps ข้อ 4).
  if not (v_per_gram >= 5 and v_per_gram <= 500) then
    raise warning 'silver_spot_sync_from_history: silver_value_per_baht=% -> %/ก. นอกช่วง 5–500 ไม่ sync (shop_id=%, captured_at=%)',
      new.silver_value_per_baht, v_per_gram, new.shop_id, new.captured_at;
    return new;
  end if;

  v_as_of_date := (new.captured_at at time zone 'Asia/Bangkok')::date;

  -- S2: staleness (retry/backfill arriving out of order) promoted to ONE
  -- up-front decision, made before touching EITHER table — previously this
  -- guard only existed as a WHERE clause on shop_setting's DO UPDATE, so a
  -- stale row could still land in oem_metal_price even though shop_setting
  -- correctly stayed put. Compares against shop_setting's own
  -- silver_spot_updated_at (the same column the old WHERE used) since that's
  -- the shop's single "as of when" pointer — oem_metal_price is keyed by day
  -- so it has no equivalent column of its own to compare against.
  select ss.silver_spot_updated_at into v_last_updated
  from analytics.shop_setting ss where ss.shop_id = new.shop_id;

  if v_last_updated is not null and new.captured_at < v_last_updated then
    raise notice 'silver_spot_sync_from_history: captured_at=% เก่ากว่า silver_spot_updated_at=% ที่มีอยู่ (shop_id=%) — ข้าม sync ทั้ง 2 ตาราง (retry/backfill มาไม่เรียงลำดับ)',
      new.captured_at, v_last_updated, new.shop_id;
    return new;
  end if;

  -- M1 (0126): "manual ชนะทั้งวัน ทั้ง 2 ตาราง" — ถ้าเจ้าของกรอกมือให้วันนี้
  -- แล้ว (ผ่าน shop_setting_upsert หรือ oem_metal_price_set, ทั้งคู่เขียน
  -- oem_metal_price source='manual') ห้าม capture จากชีตรอบถัดไปในวันเดียวกัน
  -- แตะทั้ง shop_setting และ oem_metal_price เลย — ตั้งใจไม่มีทางออกอัตโนมัติ
  -- ให้ชีต "กลับมาชนะ" ในวันเดียวกัน ข้ามวันแล้ว as_of_date เปลี่ยน เงื่อนไขนี้
  -- เป็น false เองโดยธรรมชาติ.
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
        updated_by               = null -- Nit: sheet sync isn't "an admin edited this row"
    -- belt-and-braces (unchanged from 0126): the up-front staleness decision
    -- above already covers this, this WHERE only guards a same-transaction
    -- race (two capture rows for the same shop committing concurrently).
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
    -- belt-and-braces (unchanged reasoning from 0126): the manual-guard above
    -- already decided; this WHERE only guards a same-transaction race (two
    -- capture/manual writes committing concurrently between the v_manual_exists
    -- select above and this statement).
    where omp.source <> 'manual';

  return new;
end;
$$;

revoke execute on function analytics.silver_spot_sync_from_history() from public, anon, authenticated;
-- (unchanged from 0125/0126: fired by trigger only, never called as an RPC —
-- Postgres doesn't check EXECUTE privilege when a trigger fires.)

-- ============================================================================
-- 2. shop_setting_upsert — B1/S3 fix: only count this call as a "manual spot
--    entry" (and thus write oem_metal_price(source='manual') + stamp
--    silver_spot_updated_at) when p_silver_spot_thb_per_gram actually differs
--    from the row's current value. Signature unchanged (uuid, numeric,
--    numeric, numeric) — not a new overload (3j-migration-traps ข้อ 1) — but
--    grant still disappears on every replace (ข้อ 2), re-granted below.
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
  -- M2 (0126): SILVER_SPOT_FLOOR/CEILING = 5/500 — ต้องตรงกับ trigger ข้างบน
  -- และ oem_metal_price_set ข้างล่าง. not(between) กัน NaN/Infinity
  -- (3j-migration-traps ข้อ 4); 0 ถูกปฏิเสธแล้วเพราะ floor=5.
  if p_silver_spot_thb_per_gram is not null and not (p_silver_spot_thb_per_gram >= 5 and p_silver_spot_thb_per_gram <= 500) then
    raise exception 'shop_setting_upsert: p_silver_spot_thb_per_gram must be between 5 and 500 (ต่อกรัม ไม่ใช่ต่อบาท — 1 บาท = 15.244 กรัม)';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  -- B1/S3: อ่านค่าที่มีอยู่ก่อนตัดสินว่านี่คือ "แก้จริง" หรือแค่ resubmit ค่า
  -- เดิม — SettingsForm.tsx prefills the spot field with the row's current
  -- value and resends it on every save (even a margin-only edit). ไม่นับเป็น
  -- manual entry เมื่อค่าที่ส่งมาเท่ากับค่าปัจจุบันเป๊ะ — ยกเว้นยังไม่เคยมีค่า
  -- เลย (v_prev_spot is null) ซึ่งถือว่า "เปลี่ยน" เสมอ (ค่าแรกที่มี). ต้อง
  -- ทำในฝั่ง DB เพราะ RPC เดาไม่ได้ว่าใครเรียกจากไหน (client-side mirror อยู่
  -- ที่ lib/catalog/types.ts spotChanged() + SettingsForm.tsx — ลดจำนวนครั้ง
  -- ที่มาถึงนี่เฉยๆ ไม่ใช่ด่านจริง).
  select ss.silver_spot_thb_per_gram into v_prev_spot
  from analytics.shop_setting ss where ss.shop_id = p_shop_id;

  v_spot_changed := p_silver_spot_thb_per_gram is not null
    and (v_prev_spot is null or v_prev_spot <> p_silver_spot_thb_per_gram);

  insert into analytics.shop_setting as ss (
    shop_id, silver_spot_thb_per_gram, silver_spot_updated_at,
    blended_margin_pct, target_ad_gp_share, updated_by, updated_at
  ) values (
    p_shop_id, p_silver_spot_thb_per_gram,
    case when v_spot_changed then now() else null end,
    -- NOTE (auth.uid() comment corrected — was previously implied to
    -- attribute the owner accurately): today, every call into this RPC comes
    -- from lib/actions/catalog.ts's upsertShopSetting via getServiceClient()
    -- (service-role key, not a per-user PostgREST call with the caller's
    -- JWT) — so auth.uid() evaluates to NULL here in practice right now.
    -- updated_by is populated for forward-compatibility with real per-user
    -- auth, not actively attributing anyone today (see memory
    -- "auth-hardening": role comes from session as of 17 ก.ย., but this RPC
    -- path itself still runs through the service client).
    coalesce(p_blended_margin_pct, 0.20), coalesce(p_target_ad_gp_share, 0.50), auth.uid(), now()
  )
  on conflict (shop_id) do update set
    silver_spot_thb_per_gram = coalesce(p_silver_spot_thb_per_gram, ss.silver_spot_thb_per_gram),
    silver_spot_updated_at   = case when v_spot_changed then now() else ss.silver_spot_updated_at end,
    blended_margin_pct       = coalesce(p_blended_margin_pct, ss.blended_margin_pct),
    target_ad_gp_share       = coalesce(p_target_ad_gp_share, ss.target_ad_gp_share),
    updated_by               = auth.uid(),
    updated_at               = now();

  -- H2(ก) (0126) + B1/S3 fix: เขียน oem_metal_price(source='manual') คู่กัน
  -- เฉพาะตอนค่าจริงเปลี่ยน (v_spot_changed) — resubmit ค่าเดิม (จาก prefill,
  -- B1) ไม่สร้าง manual entry ไม่ล็อก sync จากชีตของวันนั้น และไม่ทำให้ป้าย
  -- "อัปเดตอัตโนมัติจากชีต" บนฟอร์มโกหก (S3).
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

notify pgrst, 'reload schema';

-- ============================================================================
-- 3. oem_metal_price_set — S1 fix: silver gets the same 5–500 บาท/กรัม bound
--    as shop_setting_upsert/the trigger (metal-specific — gold/brass prices
--    per gram are routinely well above 500 บาท, so the silver bound must NOT
--    apply to them); other metals keep the original `> 0` check, made
--    NaN-safe with not(). Signature unchanged (uuid, text, numeric, date,
--    text) — not a new overload — grant re-issued below (3j-migration-traps
--    ข้อ 1/2).
-- ============================================================================

create or replace function analytics.oem_metal_price_set(
  p_shop_id uuid,
  p_metal text,
  p_price numeric,
  p_as_of date default current_date,
  p_source text default 'manual'
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
begin
  if p_shop_id is null or p_metal is null or p_price is null then
    raise exception 'oem_metal_price_set: p_shop_id, p_metal, p_price are required';
  end if;
  if p_metal not in ('silver', 'gold', 'brass') then
    raise exception 'oem_metal_price_set: p_metal must be silver/gold/brass';
  end if;

  -- S1: silver ต่อกรัม (เนื้อเงิน 999) ใช้ bound เดียวกับ shop_setting_upsert
  -- + trigger (5–500) — ราคาทอง/ทองเหลืองต่อกรัมจริงสูง/ต่ำกว่าช่วงนั้นตามปกติ
  -- (ทองต่อกรัมหลักพันบาทขึ้นไป) ดังนั้น bound 5–500 ใช้กับ silver เท่านั้น
  -- ห้ามเหมาโลหะอื่น — metal อื่นคง `> 0` เดิม แค่เขียนแบบ not() ให้กัน
  -- NaN/Infinity ด้วย (3j-migration-traps ข้อ 4: 'NaN' > 0 เป็น false ก็จริง
  -- แต่เขียน not() ไว้สม่ำเสมอกับจุดอื่นในไฟล์นี้).
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

  -- Append-only across days (§2.4 relies on real history); same-day re-entry
  -- collapses to a correction rather than stacking duplicate rows for one day.
  insert into analytics.oem_metal_price (shop_id, metal, as_of_date, price_thb_per_gram, source, updated_by, updated_at)
  values (p_shop_id, p_metal, coalesce(p_as_of, current_date), p_price, p_source, auth.uid(), now())
  on conflict (shop_id, metal, as_of_date) do update set
    price_thb_per_gram = excluded.price_thb_per_gram, source = excluded.source,
    updated_by = auth.uid(), updated_at = now();
end;
$$;

revoke execute on function analytics.oem_metal_price_set(uuid, text, numeric, date, text) from public, anon, authenticated;
grant execute on function analytics.oem_metal_price_set(uuid, text, numeric, date, text) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ============================================================================
-- หนี้ที่รู้ตัว (ไม่ทำในรอบนี้ — นอกขอบเขตที่ Tech Lead สั่ง):
--   H2(ข) (0126) freshness gate ใน oem_price_calc (0062) ยังไม่ทำ — ใบเสนอ
--   ราคาวันนี้ยังอ่านราคาของวันก่อนหน้าได้ถ้าวันนี้ยังไม่มี capture/manual
--   entry เข้ามาเลย (เทียบ oem-quote-invariants §5 "ราคาไม่สด = ออกใบไม่ได้"
--   ยังไม่ครบสำหรับ silver metal price โดยเฉพาะ).
--   oem_metal_price_set's p_as_of default ยังใช้ current_date (UTC) ไม่ใช่
--   วันทางธุรกิจไทย (3j-migration-traps ข้อ 6) — ไม่กระทบเคสที่ทดสอบในรอบนี้
--   (ทุก path ที่เรียกจริงส่ง p_as_of ชัดเจนหรือปล่อยเป็น "วันนี้" ในช่วงเวลา
--   ที่ UTC/ไทยตรงกัน 07:00–24:00 ไทย) แต่เป็นบั๊กแฝงเดียวกับข้อ 6 ที่ควรแก้
--   พร้อมกับ H2(ข) ในรอบถัดไป ไม่ใช่แก้แยกตอนนี้เพราะไม่มีใครสั่ง.
-- ============================================================================

-- ============================================================================
-- Dry-run (Tech Lead รันแยกผ่าน MCP ก่อน apply จริง ไม่ใช่ส่วนหนึ่งของไฟล์นี้ —
-- 3j-migration-traps ข้อ 11: do-block + raise บังคับ rollback, ตรวจ state
-- ก่อน-หลังไม่ขยับ. หมายเหตุ: insert silver_price_history ต้องใส่
-- sheet_row_hash ที่ unique ต่อ shop). อ่านค่า spot ปัจจุบันของร้านจริงมาใช้
-- แทนการ hardcode ตัวเลข เพื่อให้ D1 ทดสอบ "resubmit ค่าเดิม" ได้ถูกต้องไม่ว่า
-- ค่าจริงตอนรันจะเป็นเท่าไหร่ (คาดว่าตอนนี้คือ 67.6988 ตามบันทึกความจำ
-- silver-price-capture แต่ห้ามพึ่งค่านั้นตรงๆ).
--
-- ลำดับเคสตั้งใจ D1 -> D2 -> D3 -> D4 -> D5 (แต่ละเคสอาจพึ่ง state ที่เคสก่อน
-- หน้าสร้างไว้ — D2 ต้องรันหลัง D1 เพราะทดสอบว่า "เปลี่ยนค่าจริง" ยังคงเขียน
-- manual ได้ตามปกติ (ไม่ใช่ทุกการเขียนถูกกันหมด), D3 ต้องรันหลัง D2 เพราะพึ่ง
-- silver_spot_updated_at ที่ D2 เพิ่งตั้งไว้เป็น "เวลาล่าสุด" ที่จะทดสอบว่า
-- capture เก่ากว่านั้นโดนกันจริง, D5 ต้องรันตอนที่มี manual entry ของวันนี้
-- อยู่แล้ว (จาก D2) เพื่อพิสูจน์ว่า bound-check (H1) ทำงานก่อน manual-check
-- ไม่ใช่ให้ manual-check บังเอิญกันแทน).
--
-- do $$
-- declare
--   v_log text := E'\n=== ผลทดสอบ 0127 ===\n';
--   v_shop_id uuid := '<SHOP_ID>';
--   v_today date := (now() at time zone 'Asia/Bangkok')::date;
--   v_start_spot numeric;
--   v_ss numeric;
--   v_oem numeric;
--   v_oem_source text;
--   v_ss_before numeric;
--   v_oem_before numeric;
-- begin
--   perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
--
--   -- ===== D1: resubmit ค่าเดิมผ่าน RPC แล้ว sheet capture เข้า =====
--   -- ต้อง sync ได้ตามปกติ (resubmit ไม่ล็อก) — เดิมคือ B1's exact bug.
--   select silver_spot_thb_per_gram into v_start_spot from analytics.shop_setting where shop_id = v_shop_id;
--   if v_start_spot is null then
--     v_log := v_log || 'D1: SKIP (ร้านนี้ยังไม่เคยมี silver_spot_thb_per_gram — รัน 0125/0126 backfill หรือ capture จริงก่อน)\n';
--   else
--     perform analytics.shop_setting_upsert(v_shop_id, v_start_spot, null, null); -- resubmit, unchanged
--     insert into analytics.silver_price_history (shop_id, sheet_row_hash, silver_value_per_baht, captured_at)
--     values (v_shop_id, 'dry-run-0127-d1-' || gen_random_uuid()::text, 1000, now()); -- -> 65.5996/ก. ควร sync ได้
--     select silver_spot_thb_per_gram into v_ss from analytics.shop_setting where shop_id = v_shop_id;
--     select price_thb_per_gram, source into v_oem, v_oem_source from analytics.oem_metal_price
--       where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--     if v_ss = 65.5996 and v_oem = 65.5996 and v_oem_source = 'sheet' then
--       v_log := v_log || format('D1 resubmit ค่าเดิมไม่ล็อก sync: OK (shop_setting=%s, oem_metal_price=%s/%s)\n', v_ss, v_oem, v_oem_source);
--     else
--       v_log := v_log || format('D1 resubmit ค่าเดิมไม่ล็อก sync: FAIL (shop_setting=%s, oem_metal_price=%s/%s — คาดว่า 65.5996/65.5996/sheet)\n', v_ss, v_oem, v_oem_source);
--     end if;
--   end if;
--
--   -- ===== D2: ตั้งค่าใหม่จริง (70) ผ่าน RPC แล้ว sheet capture เข้า =====
--   -- ต้องยังคงล็อกได้ตามปกติ (เปลี่ยนค่าจริง ≠ resubmit ต้องเขียน manual).
--   perform analytics.shop_setting_upsert(v_shop_id, 70, null, null);
--   select price_thb_per_gram, source into v_oem, v_oem_source from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   if v_oem = 70 and v_oem_source = 'manual' then
--     v_log := v_log || 'D2a เปลี่ยนค่าจริงเขียน manual: OK (oem_metal_price=70/manual)\n';
--   else
--     v_log := v_log || format('D2a เปลี่ยนค่าจริงเขียน manual: FAIL (oem_metal_price=%s/%s)\n', v_oem, v_oem_source);
--   end if;
--   insert into analytics.silver_price_history (shop_id, sheet_row_hash, silver_value_per_baht, captured_at)
--   values (v_shop_id, 'dry-run-0127-d2-' || gen_random_uuid()::text, 1000, now()); -- ไม่ควร sync (manual ชนะ)
--   select silver_spot_thb_per_gram into v_ss from analytics.shop_setting where shop_id = v_shop_id;
--   select price_thb_per_gram into v_oem from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   if v_ss = 70 and v_oem = 70 then
--     v_log := v_log || 'D2b manual ชนะทั้ง 2 ตาราง: OK (shop_setting=70, oem_metal_price=70)\n';
--   else
--     v_log := v_log || format('D2b manual ชนะทั้ง 2 ตาราง: FAIL (shop_setting=%s, oem_metal_price=%s)\n', v_ss, v_oem);
--   end if;
--
--   -- ===== D3: capture เก่ากว่า silver_spot_updated_at ปัจจุบัน (จาก D2)
--   -- แต่ยังเป็นวันนี้ตามเวลาไทย =====  ต้องไม่แตะทั้ง 2 ตาราง.
--   select silver_spot_thb_per_gram into v_ss_before from analytics.shop_setting where shop_id = v_shop_id;
--   select price_thb_per_gram into v_oem_before from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   insert into analytics.silver_price_history (shop_id, sheet_row_hash, silver_value_per_baht, captured_at)
--   values (v_shop_id, 'dry-run-0127-d3-' || gen_random_uuid()::text, 900, now() - interval '10 minutes');
--   select silver_spot_thb_per_gram into v_ss from analytics.shop_setting where shop_id = v_shop_id;
--   select price_thb_per_gram into v_oem from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   if v_ss is not distinct from v_ss_before and v_oem is not distinct from v_oem_before then
--     v_log := v_log || 'D3 capture เก่ากว่า ไม่แตะทั้ง 2 ตาราง: OK\n';
--   else
--     v_log := v_log || format('D3 capture เก่ากว่า ไม่แตะทั้ง 2 ตาราง: FAIL (shop_setting %s->%s, oem_metal_price %s->%s)\n', v_ss_before, v_ss, v_oem_before, v_oem);
--   end if;
--
--   -- ===== D4: oem_metal_price_set bounds =====
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
--     v_log := v_log || 'D4c gold=3200: OK ผ่าน (ราคาทองจริงเกิน 500/ก. ตามปกติ)\n';
--   exception when others then
--     v_log := v_log || 'D4c gold=3200: FAIL ถูกปฏิเสธทั้งที่ควรผ่าน\n';
--   end;
--
--   -- ===== D5: 152,440/บาท (~10,000/ก., นอกช่วง 5-500) ในวันที่มี manual
--   -- entry อยู่แล้ว (จาก D2) — bound-check (H1) ต้องทำงานก่อน manual-check,
--   -- ดังนั้นต้องเห็น WARNING ใน server log แม้ manual-guard เองก็จะกันไว้อยู่
--   -- แล้วเหมือนกัน (state ไม่ขยับทั้งคู่ แยกไม่ออกจาก log อย่างเดียว — ต้อง
--   -- อ่าน server log คู่กับผลนี้เพื่อยืนยันว่า WARNING ออกจริง ไม่ใช่แค่ NOTICE
--   -- ของ manual-guard) =====
--   select silver_spot_thb_per_gram into v_ss_before from analytics.shop_setting where shop_id = v_shop_id;
--   select price_thb_per_gram into v_oem_before from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   insert into analytics.silver_price_history (shop_id, sheet_row_hash, silver_value_per_baht, captured_at)
--   values (v_shop_id, 'dry-run-0127-d5-' || gen_random_uuid()::text, 152440, now());
--   select silver_spot_thb_per_gram into v_ss from analytics.shop_setting where shop_id = v_shop_id;
--   select price_thb_per_gram into v_oem from analytics.oem_metal_price
--     where shop_id = v_shop_id and metal = 'silver' and as_of_date = v_today;
--   if v_ss is not distinct from v_ss_before and v_oem is not distinct from v_oem_before then
--     v_log := v_log || 'D5 นอกช่วง 5-500 (มี manual อยู่แล้ว): OK ไม่ขยับ — ดู server log ยืนยันเจอ WARNING (ไม่ใช่แค่ NOTICE ของ manual-guard)\n';
--   else
--     v_log := v_log || format('D5 นอกช่วง 5-500: FAIL (shop_setting %s->%s, oem_metal_price %s->%s)\n', v_ss_before, v_ss, v_oem_before, v_oem);
--   end if;
--
--   raise exception '%', v_log; -- บังคับ rollback ทั้งก้อน — DB ไม่ขยับจริง
-- end $$;
-- ============================================================================

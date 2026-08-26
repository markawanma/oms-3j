-- 0075_oem_quote_v2.sql
--
-- APPLIED NOTE: this file was applied to the live project as four migration
-- entries (0075a_oem_quote_v2_tables, 0075b_oem_quote_save_v2,
-- 0075c_oem_renegotiate_billing_status, 0075d_oem_quote_v2_views) rather than
-- one, purely so each chunk could be verified against real data before the
-- next went in — every section here is independently idempotent
-- (create-if-not-exists / create-or-replace / guarded backfill), so running
-- this file whole on a fresh database produces the same end state.
--
-- Two changes were made to this file during that review, both in
-- oem_quote_renegotiate: (1) v_valid_days now takes least() across items
-- instead of keeping whichever item happened to be last — a silver+gold
-- quote ordered silver-last would otherwise hold a gold price for 30 days
-- instead of 7; (2) the closing blanket
-- `grant select on all tables in schema analytics` was narrowed to just the
-- objects this migration creates.
--
-- OEM quote v2 — multi-item quotes, discount with a real margin gate,
-- renegotiation (re-quote without losing the original), and a first-class
-- B2B customer/billing record. Design approved by architect; this migration
-- is the DB layer only (T2 of the v2 feature).
--
-- Why multi-item: every real OEM job so far has actually been "แหวน 50 ชิ้น
-- + ต่างหู 30 ชิ้น" quoted as two separate oem_quote rows because the schema
-- only had one `input`/`calc` per quote. That undercounts job_value (each
-- line was gated against min_job_value_thb alone, not the combined job) and
-- makes win/loss tracking per real deal impossible. oem_quote_item makes the
-- quote a header + N priced lines, each still run through the ONE formula
-- (analytics.oem_price_calc, unchanged) — no second pricing implementation.
--
-- Why discount is gated: a discount that isn't checked against margin is just
-- a hole in the floor mechanism 0062/0063 built. margin_after_discount_pct
-- (§ below) is the number that actually protects the hard floor once a
-- discount is on the table.
--
-- Why renegotiate is a NEW row, not an edit: 0065 (C1) closed the "edit a
-- quoted row and skip the gates" hole for a reason — a quote a customer has
-- already seen must stay reprintable exactly as quoted (audit trail, §8 of
-- the original design). Renegotiating writes a new row (parent_quote_id ->
-- old, root_quote_id -> the original ancestor) and marks the old one
-- 'superseded'. Never mutates a row that was ever 'quoted'.
--
-- Backfill note: the two real quotes already in prod (oem_quote.input is
-- not null) get a single oem_quote_item row each (seq=1) so v_oem_quote_item
-- and item_count work uniformly for old and new quotes. Going forward, this
-- RPC always writes header.input/calc = null (the per-item calc lives on
-- oem_quote_item; rate_snapshot keeps a full audit array instead) — that is
-- exactly the signal the backfill's `where input is not null` guard uses to
-- never re-touch a v2-created row.

-- ============================================================================
-- 1. analytics.oem_quote_item — one priced line per quote. RLS copied from
--    0062's oem_quote pattern exactly (tenant select + owner/admin write) —
--    same shop, same sensitivity as the quote header it belongs to.
-- ============================================================================

create table if not exists analytics.oem_quote_item (
  id                    uuid primary key default gen_random_uuid(),
  shop_id               uuid not null references public.shop (id) on delete cascade,
  quote_id              uuid not null references analytics.oem_quote (id) on delete cascade,
  seq                   int not null,
  product_id            uuid references public.product (id) on delete set null,
  sku_snapshot          text,
  product_name_snapshot text,
  input                 jsonb not null,
  calc                  jsonb not null,
  qty                   int not null check (qty > 0),
  cost_piece            numeric(14, 4),
  price_per_piece       numeric(14, 4),
  item_total            numeric(14, 2),
  q_run                 int,
  flask_count           int,
  plating_batch_count   int,
  margin_charged_pct    numeric(6, 4),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (quote_id, seq)
);

comment on column analytics.oem_quote_item.input is
  'The exact oem_price_calc p_input payload for this line (same contract as oem_quote.input pre-v2). Kept per-item so a saved quote reprints at the rates that were live when quoted, same reasoning as the old single-item calc/rate_snapshot.';
comment on column analytics.oem_quote_item.item_total is
  'pieces_subtotal for this line only (qty * price_per_piece), same meaning as the old oem_quote.pieces_subtotal but per item, NOT including NRE. NRE totals roll up onto the oem_quote header (nre_cost/nre_price), summed across items.';

create index if not exists idx_oem_quote_item_shop_id on analytics.oem_quote_item (shop_id);

alter table analytics.oem_quote_item enable row level security;

drop policy if exists tenant_isolation_select on analytics.oem_quote_item;
create policy tenant_isolation_select on analytics.oem_quote_item
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

drop policy if exists owner_admin_write on analytics.oem_quote_item;
create policy owner_admin_write on analytics.oem_quote_item
  for all
  using (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')))
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

-- ============================================================================
-- 2. analytics.oem_customer — B2B billing record (legal name, tax id,
--    address). RLS is stricter than oem_quote_item on purpose: SELECT is
--    also owner/admin-only (not "any tenant member"), same shape as
--    pii_customer's 3-policy tier (0012 §Tier 4) — a regular shop_member can
--    see a quote but not the counterparty's tax id / address.
--
--    No auto-delete / retention job (unlike pii_customer's stg_order_import
--    180-day scrub, 0024): a tax invoice's billing record is a legally
--    required document (ประมวลรัษฎากร bookkeeping retention — 5+ years,
--    different PDPA legal basis than "customer relationship still active"
--    that pii_customer's retention note is about). Deleting it early would
--    break the ability to reprint/re-audit a past tax invoice, not protect
--    the customer. If a real retention rule is ever needed for this table it
--    has to come from an accounting requirement, not copied from 0024.
-- ============================================================================

create table if not exists analytics.oem_customer (
  id               uuid primary key default gen_random_uuid(),
  shop_id          uuid not null references public.shop (id) on delete cascade,
  legal_name       text not null,
  tax_id           text,
  address          jsonb,
  phone            text,
  contact_channel  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_oem_customer_shop_id on analytics.oem_customer (shop_id);

alter table analytics.oem_customer enable row level security;

drop policy if exists owner_admin_select on analytics.oem_customer;
create policy owner_admin_select on analytics.oem_customer
  for select
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

drop policy if exists owner_admin_insert on analytics.oem_customer;
create policy owner_admin_insert on analytics.oem_customer
  for insert
  with check (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

drop policy if exists owner_admin_update on analytics.oem_customer;
create policy owner_admin_update on analytics.oem_customer
  for update
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  )
  with check (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- No delete policy in this tier, same as pii_customer (0012) — a billing
-- record is retained for audit, not deleted by end users.

-- ============================================================================
-- 3. ALTER analytics.oem_quote — additive. input/calc become optional
--    because a v2 (multi-item) quote no longer has ONE input/calc; the RPC
--    below always writes them null for v2 saves and keeps rate_snapshot
--    (still NOT NULL) as a jsonb array of every item's oem_price_calc
--    result instead, so the "audit trail of what was quoted" guarantee
--    0062's rate_snapshot comment describes still holds.
-- ============================================================================

alter table analytics.oem_quote
  alter column input drop not null,
  alter column calc drop not null,
  add column if not exists discount_thb numeric(14, 2) not null default 0 check (discount_thb >= 0),
  add column if not exists discount_reason text,
  add column if not exists grand_total numeric(14, 2),
  add column if not exists margin_after_discount_pct numeric(6, 4),
  add column if not exists parent_quote_id uuid references analytics.oem_quote (id),
  add column if not exists root_quote_id uuid,
  add column if not exists customer_id uuid references analytics.oem_customer (id) on delete set null,
  add column if not exists vat_mode text check (vat_mode in ('add_7', 'included', 'none')) default 'included';

comment on column analytics.oem_quote.discount_thb is
  'Flat THB discount off quote_total. Gated at save time by margin_after_discount_pct — see oem_quote_save.';
comment on column analytics.oem_quote.grand_total is
  'quote_total - discount_thb. What the customer actually owes; quote_total stays "before discount" for margin-drift reporting.';
comment on column analytics.oem_quote.margin_after_discount_pct is
  'Aggregate margin across all items AFTER discount_thb, with gold metal pass-through excluded from both price and cost (consistent with 0063 floors.margin.value never being diluted by pass-through metal). This, not margin_actual_pct/margin_charged_pct, is what the discount hard-floor gate judges.';
comment on column analytics.oem_quote.parent_quote_id is
  'Set only by oem_quote_renegotiate — the quote this one was re-quoted from. Null for an original quote.';
comment on column analytics.oem_quote.root_quote_id is
  'The first quote in this renegotiation chain (root_quote_id = id for an original quote). Not a foreign key on purpose: a renegotiation chain is a reporting concept (win-rate/margin-drift per deal), not a referential-integrity one, and this avoids ordering constraints on insert.';
comment on column analytics.oem_quote.vat_mode is
  'Display-only for now (no VAT arithmetic added in this migration — not part of the v2 design brief). Stored so the quote PDF/UI can label the total correctly; defaults to included (current behaviour, unchanged).';

create index if not exists idx_oem_quote_parent_quote_id on analytics.oem_quote (parent_quote_id);
create index if not exists idx_oem_quote_root_quote_id on analytics.oem_quote (root_quote_id);
create index if not exists idx_oem_quote_customer_id on analytics.oem_quote (customer_id);

-- Status check constraint: found by definition (not by a guessed name) since
-- an unnamed column CHECK's autogenerated name isn't something to bet a
-- migration on. Recreated with a stable, explicit name so the NEXT migration
-- that needs to touch it doesn't have to do this dance again.
do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'analytics.oem_quote'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%'
    and pg_get_constraintdef(oid) ilike '%draft%';

  if v_conname is not null then
    execute format('alter table analytics.oem_quote drop constraint %I', v_conname);
  end if;

  alter table analytics.oem_quote
    add constraint oem_quote_status_check
    check (status in ('draft', 'quoted', 'won', 'lost', 'expired', 'rejected', 'superseded'));
end;
$$;

-- ============================================================================
-- 4. Backfill. Must run before anything downstream assumes every 'quoted'/
--    'won' row has at least one oem_quote_item — the two real rows in prod
--    predate this table entirely.
-- ============================================================================

insert into analytics.oem_quote_item (
  shop_id, quote_id, seq, input, calc, qty,
  cost_piece, price_per_piece, item_total,
  q_run, flask_count, plating_batch_count, margin_charged_pct
)
select
  q.shop_id, q.id, 1, q.input, q.calc,
  -- oem_price_calc raises if p_input.qty is missing/<=0, so any row that
  -- ever successfully saved has a valid qty in its input; the coalesce is a
  -- defensive floor only (satisfies the qty > 0 check), not an expected path.
  coalesce(nullif(q.input->>'qty', '')::int, 1),
  q.cost_piece, q.price_per_piece, q.pieces_subtotal,
  q.q_run, q.flask_count, q.plating_batch_count, q.margin_charged_pct
from analytics.oem_quote q
where q.input is not null
  and not exists (
    select 1 from analytics.oem_quote_item i where i.quote_id = q.id and i.seq = 1
  );

update analytics.oem_quote set root_quote_id = id where root_quote_id is null;

update analytics.oem_quote set grand_total = quote_total where grand_total is null;

-- ============================================================================
-- 5. oem_quote_save — v2, 9 args. The old 7-arg signature is dropped first
--    (same trap as 0060/0064: CREATE OR REPLACE with a different arg list
--    creates a second overload, not a replacement, and every call becomes
--    ambiguous — this has broken this exact RPC twice already).
--
--    Flow: resolve the header row first (new placeholder row with a real
--    quote_no, or lock the existing draft) so oem_quote_item's FK has
--    something to point at; loop items (recompute via oem_price_calc,
--    per-item ONLY — no cross-item batching) writing each line + collecting
--    aggregates; gate; write the final header aggregates. Any raise anywhere
--    after the header/item inserts rolls the whole call back (single
--    function invocation = single transaction), so writing items before the
--    aggregate gates run is safe, not a partial-write risk.
-- ============================================================================

drop function if exists analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text);

create or replace function analytics.oem_quote_save(
  p_shop_id uuid,
  p_items jsonb,
  p_quote_id uuid default null,
  p_status text default 'draft',
  p_approval_note text default null,
  p_customer_name text default null,
  p_customer_contact text default null,
  p_discount_thb numeric default 0,
  p_discount_reason text default null
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_set analytics.oem_setting%rowtype;
  v_quote_id uuid := p_quote_id;
  v_is_new boolean := (p_quote_id is null);
  v_current_status text;
  v_quote_no text;
  v_i int;

  v_item jsonb;
  v_seq int;
  v_item_input jsonb;
  v_item_calc jsonb;
  v_item_product_id uuid;
  v_item_sku text;
  v_item_name text;
  v_item_metal text;
  v_item_qty int;
  v_item_cost_piece numeric;
  v_item_price_piece numeric;
  v_item_total numeric;
  v_item_nre_cost numeric;
  v_item_nre_price numeric;
  v_item_q_run int;
  v_item_flask_count int;
  v_item_plate_count int;
  v_item_margin_charged numeric;
  v_item_metal_per_piece numeric;
  v_item_is_complete boolean;
  v_item_qty_pass boolean;
  v_item_metalweight_pass boolean;
  v_item_valid_days int;

  v_calc_agg jsonb := '[]'::jsonb;
  v_is_complete_all boolean := true;
  v_qty_pass_all boolean := true;
  v_metalweight_pass_all boolean := true;
  v_nre_cost_sum numeric := 0;
  v_nre_price_sum numeric := 0;
  v_pieces_subtotal_sum numeric := 0;
  v_flask_count_sum int := 0;
  v_plate_count_sum int := 0;
  v_qrun_sum int := 0;
  v_price_ex_gold_sum numeric := 0;
  v_cost_ex_gold_sum numeric := 0;
  v_price_total_all numeric := 0;
  v_cost_total_all numeric := 0;
  v_min_margin_charged numeric;
  v_min_margin_seq int;
  v_valid_days int;

  v_quote_total_sum numeric;
  v_grand_total numeric;
  v_margin_after_discount numeric;
  v_margin_actual_blended numeric;
  v_jobvalue_min numeric;
  v_approved_by uuid;
begin
  if p_shop_id is null then
    raise exception 'oem_quote_save: p_shop_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'oem_quote_save: p_items must be a non-empty json array';
  end if;
  if p_status not in ('draft', 'quoted') then
    raise exception 'oem_quote_save: p_status must be draft or quoted (use oem_quote_set_status/oem_quote_renegotiate to change status afterwards)';
  end if;
  if p_discount_thb is null or p_discount_thb < 0 then
    raise exception 'oem_quote_save: p_discount_thb must be >= 0';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_set from analytics.oem_setting where shop_id = p_shop_id;
  if v_set.shop_id is null then
    v_set.margin_target_pct := 0.30; v_set.margin_discount_cap_pct := 0.25;
    v_set.margin_floor_pct := 0.20; v_set.margin_hard_floor_pct := 0.15;
    v_set.nre_max_share_pct := 0.25; v_set.min_job_value_thb := 8000;
    v_set.quote_valid_days_silver := 30; v_set.quote_valid_days_gold := 7; v_set.quote_valid_days_brass := 45;
  end if;

  -- ---- resolve the header row: existing draft (locked + validated) or a
  -- fresh placeholder with a real quote_no, so oem_quote_item's FK has
  -- something to reference before the item loop below. ----
  if not v_is_new then
    select status into v_current_status
      from analytics.oem_quote where id = v_quote_id and shop_id = p_shop_id for update;
    if not found then
      raise exception 'oem_quote_save: quote % not found for this shop', v_quote_id;
    end if;
    if v_current_status <> 'draft' then
      raise exception 'oem_quote_save: แก้ใบเสนอราคาได้เฉพาะสถานะ draft เท่านั้น (ใบนี้สถานะ %) — ใบที่ออกแล้วให้ใช้ oem_quote_renegotiate', v_current_status
        using errcode = '22023';
    end if;
    delete from analytics.oem_quote_item where quote_id = v_quote_id;
  else
    for v_i in 1..5 loop
      v_quote_no := analytics.oem_quote_next_no(p_shop_id);
      v_quote_id := gen_random_uuid();
      begin
        insert into analytics.oem_quote (
          id, shop_id, quote_no, root_quote_id, customer_name, customer_contact,
          rate_snapshot, status, created_by, updated_by
        ) values (
          v_quote_id, p_shop_id, v_quote_no, v_quote_id, p_customer_name, p_customer_contact,
          '[]'::jsonb, 'draft', auth.uid(), auth.uid()
        );
        exit;
      exception when unique_violation then
        if v_i = 5 then
          raise exception 'oem_quote_save: ออกเลขที่ใบเสนอราคาไม่สำเร็จ (เลขชนกันซ้ำหลายครั้ง) ลองใหม่อีกครั้ง';
        end if;
      end;
    end loop;
  end if;

  -- ---- per-item: recompute via oem_price_calc, write the line, accumulate ----
  for v_item, v_seq in
    select elem, ord::int from jsonb_array_elements(p_items) with ordinality as t(elem, ord)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'oem_quote_save: p_items[%] must be a json object', v_seq;
    end if;
    v_item_input := v_item->'input';
    if v_item_input is null or jsonb_typeof(v_item_input) <> 'object' then
      raise exception 'oem_quote_save: p_items[%].input is required and must be a json object', v_seq;
    end if;

    v_item_product_id := nullif(v_item->>'product_id', '')::uuid;
    if v_item_product_id is not null and not exists (
      select 1 from public.product where id = v_item_product_id and shop_id = p_shop_id
    ) then
      raise exception 'oem_quote_save: p_items[%].product_id ไม่ใช่สินค้าของร้านนี้', v_seq;
    end if;
    v_item_sku := nullif(btrim(v_item->>'sku_snapshot'), '');
    v_item_name := nullif(btrim(v_item->>'product_name_snapshot'), '');

    v_item_calc := analytics.oem_price_calc(p_shop_id, v_item_input);
    v_calc_agg := v_calc_agg || jsonb_build_array(jsonb_build_object('seq', v_seq, 'calc', v_item_calc));

    v_item_metal := v_item_input->>'metal';
    v_item_qty := nullif(v_item_input->>'qty', '')::int;
    if v_item_qty is null or v_item_qty <= 0 then
      raise exception 'oem_quote_save: p_items[%].input.qty must be > 0', v_seq;
    end if;

    v_item_cost_piece := nullif(v_item_calc->'breakdown'->>'cost_piece', '')::numeric;
    v_item_price_piece := nullif(v_item_calc->'breakdown'->>'price_per_piece', '')::numeric;
    v_item_nre_cost := nullif(v_item_calc->'breakdown'->'nre'->>'cost', '')::numeric;
    v_item_nre_price := nullif(v_item_calc->'breakdown'->'nre'->>'price', '')::numeric;
    v_item_metal_per_piece := nullif(v_item_calc->'breakdown'->'metal'->>'per_piece', '')::numeric;
    v_item_margin_charged := nullif(v_item_calc->'floors'->'margin'->>'value', '')::numeric;
    v_item_q_run := nullif(v_item_calc->'breakdown'->>'q_run', '')::int;
    v_item_is_complete := (v_item_calc->>'is_complete')::boolean;
    v_item_qty_pass := (v_item_calc->'floors'->'qty'->>'pass')::boolean;
    v_item_metalweight_pass := coalesce((v_item_calc->'floors'->'metal_weight'->>'pass')::boolean, true);

    select (l->>'count')::int into v_item_flask_count
      from jsonb_array_elements(coalesce(v_item_calc->'breakdown'->'batch'->'lines', '[]'::jsonb)) l
      where l->>'key' = 'flask';
    select (l->>'count')::int into v_item_plate_count
      from jsonb_array_elements(coalesce(v_item_calc->'breakdown'->'batch'->'lines', '[]'::jsonb)) l
      where l->>'key' = 'plating';

    -- item_total = pieces_subtotal for THIS line only (excludes NRE, which
    -- rolls up onto the header separately) — quote_total is null when this
    -- item isn't complete, matching oem_price_calc's own null-when-incomplete
    -- contract.
    v_item_total := case
      when v_item_calc->'breakdown'->>'quote_total' is not null
      then (v_item_calc->'breakdown'->>'quote_total')::numeric - coalesce(v_item_nre_price, 0)
    end;

    insert into analytics.oem_quote_item (
      shop_id, quote_id, seq, product_id, sku_snapshot, product_name_snapshot,
      input, calc, qty, cost_piece, price_per_piece, item_total,
      q_run, flask_count, plating_batch_count, margin_charged_pct
    ) values (
      p_shop_id, v_quote_id, v_seq, v_item_product_id, v_item_sku, v_item_name,
      v_item_input, v_item_calc, v_item_qty, v_item_cost_piece, v_item_price_piece, v_item_total,
      v_item_q_run, v_item_flask_count, v_item_plate_count, v_item_margin_charged
    );

    v_is_complete_all := v_is_complete_all and coalesce(v_item_is_complete, false);
    v_qty_pass_all := v_qty_pass_all and coalesce(v_item_qty_pass, false);
    v_metalweight_pass_all := v_metalweight_pass_all and v_item_metalweight_pass;
    v_nre_cost_sum := v_nre_cost_sum + coalesce(v_item_nre_cost, 0);
    v_nre_price_sum := v_nre_price_sum + coalesce(v_item_nre_price, 0);
    v_pieces_subtotal_sum := v_pieces_subtotal_sum + coalesce(v_item_total, 0);
    v_flask_count_sum := v_flask_count_sum + coalesce(v_item_flask_count, 0);
    v_plate_count_sum := v_plate_count_sum + coalesce(v_item_plate_count, 0);
    v_qrun_sum := v_qrun_sum + coalesce(v_item_q_run, 0);

    v_price_total_all := v_price_total_all + coalesce(v_item_price_piece, 0) * v_item_qty;
    v_cost_total_all := v_cost_total_all + coalesce(v_item_cost_piece, 0) * v_item_qty;

    -- gold pass-through: exclude the metal leg from both price and cost
    -- before this feeds margin_after_discount_pct, same principle as 0063's
    -- floors.margin.value never being diluted by pass-through metal.
    if v_item_metal = 'gold' then
      v_price_ex_gold_sum := v_price_ex_gold_sum + coalesce(v_item_total, 0)
                              - coalesce(v_item_metal_per_piece, 0) * v_item_qty;
      v_cost_ex_gold_sum := v_cost_ex_gold_sum + coalesce(v_item_cost_piece, 0) * v_item_qty
                             - coalesce(v_item_metal_per_piece, 0) * v_item_qty;
    else
      v_price_ex_gold_sum := v_price_ex_gold_sum + coalesce(v_item_total, 0);
      v_cost_ex_gold_sum := v_cost_ex_gold_sum + coalesce(v_item_cost_piece, 0) * v_item_qty;
    end if;

    if v_item_margin_charged is not null
       and (v_min_margin_charged is null or v_item_margin_charged < v_min_margin_charged) then
      v_min_margin_charged := v_item_margin_charged;
      v_min_margin_seq := v_seq;
    end if;

    v_item_valid_days := case v_item_metal
      when 'gold' then coalesce(v_set.quote_valid_days_gold, 7)
      when 'brass' then coalesce(v_set.quote_valid_days_brass, 45)
      else coalesce(v_set.quote_valid_days_silver, 30)
    end;
    v_valid_days := case when v_valid_days is null then v_item_valid_days else least(v_valid_days, v_item_valid_days) end;
  end loop;

  v_quote_total_sum := v_pieces_subtotal_sum + v_nre_price_sum;
  v_grand_total := v_quote_total_sum - p_discount_thb;
  v_margin_actual_blended := case when v_price_total_all <> 0
    then round((v_price_total_all - v_cost_total_all) / v_price_total_all, 4) end;
  v_margin_after_discount := case when (v_price_ex_gold_sum - p_discount_thb) <> 0
    then round(((v_price_ex_gold_sum - p_discount_thb) - v_cost_ex_gold_sum) / (v_price_ex_gold_sum - p_discount_thb), 4) end;

  -- ---- gates (quoted only — draft is a scratchpad, same rule as pre-v2) ----
  if p_status = 'quoted' then
    if not v_is_complete_all then
      raise exception 'oem_quote_save: มีบางรายการยังกรอกข้อมูลไม่ครบ ออกใบเสนอราคา (quoted) ไม่ได้ — บันทึกเป็น draft ก่อนได้' using errcode = '22023';
    end if;
    if not v_qty_pass_all or not v_metalweight_pass_all then
      raise exception 'oem_quote_save: มีบางรายการไม่ผ่านเกณฑ์ floor (จำนวนชิ้น/น้ำหนักโลหะ ตาม §3) ออกใบเสนอราคาไม่ได้' using errcode = '22023';
    end if;

    v_jobvalue_min := greatest(
      coalesce(v_set.min_job_value_thb, 8000),
      case when v_nre_cost_sum > 0 then v_nre_cost_sum / v_set.nre_max_share_pct else 0 end
    );
    if v_grand_total < v_jobvalue_min then
      raise exception 'oem_quote_save: มูลค่างานรวม (grand_total = %) ต่ำกว่าเกณฑ์ขั้นต่ำ % บาท ออกใบเสนอราคาไม่ได้',
        v_grand_total, v_jobvalue_min
        using errcode = '22023';
    end if;

    -- margin — no shortcut past the hard floor, whether the breach comes
    -- from a single item's charged margin or from the discount eating into
    -- the whole job's margin.
    if v_min_margin_charged is not null and v_min_margin_charged < v_set.margin_hard_floor_pct then
      raise exception 'oem_quote_save: item % — margin ที่คิด % ต่ำกว่า hard floor % — ไม่มีทางลัด ต้องปรับราคาหรือปฏิเสธงาน',
        v_min_margin_seq, round(v_min_margin_charged * 100, 1)::text || '%', round(v_set.margin_hard_floor_pct * 100, 1)::text || '%'
        using errcode = '22023';
    end if;
    if v_margin_after_discount is not null and v_margin_after_discount < v_set.margin_hard_floor_pct then
      raise exception 'oem_quote_save: ส่วนลด %บาท ทำให้ margin รวมหลังหักส่วนลด % ต่ำกว่า hard floor % — ไม่มีทางลัด ต้องลดส่วนลดหรือปฏิเสธงาน',
        p_discount_thb, round(v_margin_after_discount * 100, 1)::text || '%', round(v_set.margin_hard_floor_pct * 100, 1)::text || '%'
        using errcode = '22023';
    end if;
    if ((v_min_margin_charged is not null and v_min_margin_charged < v_set.margin_floor_pct)
        or (v_margin_after_discount is not null and v_margin_after_discount < v_set.margin_floor_pct))
       and (p_approval_note is null or btrim(p_approval_note) = '') then
      raise exception 'oem_quote_save: margin ต่ำกว่า floor (จาก item หรือส่วนลด) — ต้องใส่เหตุผล (p_approval_note) ก่อนออกใบเสนอราคา' using errcode = '22023';
    end if;
  end if;

  v_approved_by := case when p_approval_note is not null and btrim(p_approval_note) <> '' then auth.uid() else null end;

  update analytics.oem_quote set
    input = null,
    calc = null,
    rate_snapshot = jsonb_build_object('formula_version', 2, 'items', v_calc_agg),
    customer_name = coalesce(p_customer_name, customer_name),
    customer_contact = coalesce(p_customer_contact, customer_contact),
    cost_piece = null,
    price_per_piece = null,
    nre_cost = v_nre_cost_sum,
    nre_price = v_nre_price_sum,
    pieces_subtotal = v_pieces_subtotal_sum,
    quote_total = v_quote_total_sum,
    margin_actual_pct = v_margin_actual_blended,
    margin_charged_pct = v_min_margin_charged,
    q_run = v_qrun_sum,
    flask_count = v_flask_count_sum,
    plating_batch_count = v_plate_count_sum,
    status = p_status,
    discount_thb = p_discount_thb,
    discount_reason = p_discount_reason,
    grand_total = v_grand_total,
    margin_after_discount_pct = v_margin_after_discount,
    approval_note = coalesce(p_approval_note, approval_note),
    approved_by = coalesce(v_approved_by, approved_by),
    quote_valid_until = case when p_status = 'quoted' then current_date + v_valid_days else quote_valid_until end,
    updated_by = auth.uid(), updated_at = now()
  where id = v_quote_id and shop_id = p_shop_id;

  return v_quote_id;
end;
$$;

revoke execute on function analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text, numeric, text) to authenticated, service_role;

-- ============================================================================
-- 6. oem_quote_renegotiate — copies an issued quote's items VERBATIM (no
--    recompute: the customer was quoted at the rates live on the original
--    quote date, and a renegotiation is about the discount, not new pricing)
--    into a brand-new quote row, applies the new discount, gates it with the
--    exact same margin rules as oem_quote_save, and marks the original
--    'superseded'. quote_no comes from oem_quote_next_no unchanged — no
--    -R1/-R2 suffix, because oem_quote_next_no's own numbering
--    (0065 L1 fix) parses the running number with split_part on '-' and a
--    suffix would break that.
-- ============================================================================

create or replace function analytics.oem_quote_renegotiate(
  p_shop_id uuid,
  p_quote_id uuid,
  p_new_discount_thb numeric,
  p_reason text
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_old analytics.oem_quote%rowtype;
  v_set analytics.oem_setting%rowtype;
  v_new_id uuid;
  v_new_no text;
  v_i int;
  v_price_ex_gold_sum numeric := 0;
  v_cost_ex_gold_sum numeric := 0;
  v_margin_after numeric;
  v_valid_days int;
  v_row record;
begin
  if p_shop_id is null or p_quote_id is null then
    raise exception 'oem_quote_renegotiate: p_shop_id and p_quote_id are required';
  end if;
  if p_new_discount_thb is null or p_new_discount_thb < 0 then
    raise exception 'oem_quote_renegotiate: p_new_discount_thb must be >= 0';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_old from analytics.oem_quote where id = p_quote_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'oem_quote_renegotiate: quote % not found for this shop', p_quote_id;
  end if;
  if v_old.status <> 'quoted' then
    raise exception 'oem_quote_renegotiate: ต่อรองราคาได้เฉพาะใบสถานะ quoted เท่านั้น (ใบนี้สถานะ %)', v_old.status
      using errcode = '22023';
  end if;
  if v_old.quote_valid_until is null or v_old.quote_valid_until < current_date then
    raise exception 'oem_quote_renegotiate: ใบเสนอราคาหมดอายุแล้ว ต่อรองราคาไม่ได้ — ออกใบใหม่แทน (oem_quote_save)' using errcode = '22023';
  end if;

  select * into v_set from analytics.oem_setting where shop_id = p_shop_id;
  if v_set.shop_id is null then
    v_set.margin_floor_pct := 0.20; v_set.margin_hard_floor_pct := 0.15;
    v_set.quote_valid_days_silver := 30; v_set.quote_valid_days_gold := 7; v_set.quote_valid_days_brass := 45;
  end if;

  -- Aggregate ex-gold price/cost from the EXISTING items (no recompute) —
  -- same formula oem_quote_save uses for margin_after_discount_pct.
  for v_row in select * from analytics.oem_quote_item where quote_id = v_old.id order by seq loop
    if (v_row.input->>'metal') = 'gold' then
      v_price_ex_gold_sum := v_price_ex_gold_sum + coalesce(v_row.item_total, 0)
                              - coalesce((v_row.calc->'breakdown'->'metal'->>'per_piece')::numeric, 0) * v_row.qty;
      v_cost_ex_gold_sum := v_cost_ex_gold_sum + coalesce(v_row.cost_piece, 0) * v_row.qty
                             - coalesce((v_row.calc->'breakdown'->'metal'->>'per_piece')::numeric, 0) * v_row.qty;
    else
      v_price_ex_gold_sum := v_price_ex_gold_sum + coalesce(v_row.item_total, 0);
      v_cost_ex_gold_sum := v_cost_ex_gold_sum + coalesce(v_row.cost_piece, 0) * v_row.qty;
    end if;

    -- shortest validity wins across a mixed-metal quote, same rule
    -- oem_quote_save uses. Assigning without least() would leave whichever
    -- item happened to be LAST — a silver+gold quote ordered silver-last
    -- would quote gold for 30 days instead of 7, i.e. we'd hold a gold price
    -- three weeks past the point the metal price makes it safe.
    v_valid_days := least(
      coalesce(v_valid_days, 9999),
      case (v_row.input->>'metal')
        when 'gold' then coalesce(v_set.quote_valid_days_gold, 7)
        when 'brass' then coalesce(v_set.quote_valid_days_brass, 45)
        else coalesce(v_set.quote_valid_days_silver, 30)
      end
    );
  end loop;
  if not found then
    raise exception 'oem_quote_renegotiate: quote % has no items — cannot renegotiate', p_quote_id;
  end if;

  v_margin_after := case when (v_price_ex_gold_sum - p_new_discount_thb) <> 0
    then round(((v_price_ex_gold_sum - p_new_discount_thb) - v_cost_ex_gold_sum) / (v_price_ex_gold_sum - p_new_discount_thb), 4) end;

  if v_margin_after is not null and v_margin_after < v_set.margin_hard_floor_pct then
    raise exception 'oem_quote_renegotiate: ส่วนลดใหม่ %บาท ทำให้ margin % ต่ำกว่า hard floor % — ไม่มีทางลัด',
      p_new_discount_thb, round(v_margin_after * 100, 1)::text || '%', round(v_set.margin_hard_floor_pct * 100, 1)::text || '%'
      using errcode = '22023';
  end if;
  if v_margin_after is not null and v_margin_after < v_set.margin_floor_pct and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'oem_quote_renegotiate: ส่วนลดใหม่ทำให้ margin ต่ำกว่า floor — ต้องระบุเหตุผล (p_reason)' using errcode = '22023';
  end if;

  for v_i in 1..5 loop
    v_new_no := analytics.oem_quote_next_no(p_shop_id);
    v_new_id := gen_random_uuid();
    begin
      insert into analytics.oem_quote (
        id, shop_id, quote_no, customer_name, customer_contact, input, calc, rate_snapshot,
        cost_piece, price_per_piece, nre_cost, nre_price, pieces_subtotal, quote_total,
        margin_actual_pct, margin_charged_pct, q_run, flask_count, plating_batch_count,
        status, discount_thb, discount_reason, grand_total, margin_after_discount_pct,
        parent_quote_id, root_quote_id, customer_id, vat_mode,
        quote_valid_until, created_by, updated_by
      ) values (
        v_new_id, v_old.shop_id, v_new_no, v_old.customer_name, v_old.customer_contact, null, null, v_old.rate_snapshot,
        v_old.cost_piece, v_old.price_per_piece, v_old.nre_cost, v_old.nre_price, v_old.pieces_subtotal, v_old.quote_total,
        v_old.margin_actual_pct, v_old.margin_charged_pct, v_old.q_run, v_old.flask_count, v_old.plating_batch_count,
        'quoted', p_new_discount_thb, p_reason, coalesce(v_old.quote_total, 0) - p_new_discount_thb, v_margin_after,
        v_old.id, coalesce(v_old.root_quote_id, v_old.id), v_old.customer_id, v_old.vat_mode,
        current_date + coalesce(v_valid_days, v_set.quote_valid_days_silver, 30), auth.uid(), auth.uid()
      );
      exit;
    exception when unique_violation then
      if v_i = 5 then
        raise exception 'oem_quote_renegotiate: ออกเลขที่ใบใหม่ไม่สำเร็จ (เลขชนกันซ้ำหลายครั้ง) ลองใหม่อีกครั้ง';
      end if;
    end;
  end loop;

  insert into analytics.oem_quote_item (
    shop_id, quote_id, seq, product_id, sku_snapshot, product_name_snapshot,
    input, calc, qty, cost_piece, price_per_piece, item_total,
    q_run, flask_count, plating_batch_count, margin_charged_pct
  )
  select
    shop_id, v_new_id, seq, product_id, sku_snapshot, product_name_snapshot,
    input, calc, qty, cost_piece, price_per_piece, item_total,
    q_run, flask_count, plating_batch_count, margin_charged_pct
  from analytics.oem_quote_item
  where quote_id = v_old.id
  order by seq;

  update analytics.oem_quote set status = 'superseded', updated_by = auth.uid(), updated_at = now()
  where id = v_old.id;

  return v_new_id;
end;
$$;

revoke execute on function analytics.oem_quote_renegotiate(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function analytics.oem_quote_renegotiate(uuid, uuid, numeric, text) to authenticated, service_role;

-- ============================================================================
-- 7. oem_quote_set_billing — upsert the ONE oem_customer row this quote is
--    billed to. "Upsert" here means: if this quote already has a customer_id,
--    edit that row; otherwise create a new one and link it. Does not dedupe
--    by tax_id across quotes — two quotes for the same company are allowed to
--    point at two different oem_customer rows (e.g. different ship-to address
--    per job); a cross-quote merge/dedupe UI is a separate feature, not
--    something this RPC should guess at.
-- ============================================================================

create or replace function analytics.oem_quote_set_billing(
  p_shop_id uuid,
  p_quote_id uuid,
  p_customer jsonb
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_status text;
  v_existing_customer_id uuid;
  v_customer_id uuid;
  v_legal_name text;
  v_tax_id text;
  v_address jsonb;
  v_phone text;
  v_contact_channel text;
begin
  if p_shop_id is null or p_quote_id is null or p_customer is null then
    raise exception 'oem_quote_set_billing: p_shop_id, p_quote_id and p_customer are required';
  end if;
  if jsonb_typeof(p_customer) <> 'object' then
    raise exception 'oem_quote_set_billing: p_customer must be a json object';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  select status, customer_id into v_status, v_existing_customer_id
    from analytics.oem_quote where id = p_quote_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'oem_quote_set_billing: quote % not found for this shop', p_quote_id;
  end if;
  if v_status not in ('quoted', 'won') then
    raise exception 'oem_quote_set_billing: ผูกข้อมูลออกบิลได้เฉพาะใบที่สถานะ quoted หรือ won (ใบนี้สถานะ %)', v_status
      using errcode = '22023';
  end if;

  v_legal_name := nullif(btrim(p_customer->>'legal_name'), '');
  if v_legal_name is null then
    raise exception 'oem_quote_set_billing: p_customer.legal_name is required' using errcode = '22023';
  end if;
  v_tax_id := nullif(btrim(p_customer->>'tax_id'), '');
  v_address := p_customer->'address';
  v_phone := nullif(btrim(p_customer->>'phone'), '');
  v_contact_channel := nullif(btrim(p_customer->>'contact_channel'), '');

  if v_existing_customer_id is not null then
    update analytics.oem_customer set
      legal_name = v_legal_name,
      tax_id = v_tax_id,
      address = v_address,
      phone = v_phone,
      contact_channel = v_contact_channel,
      updated_at = now()
    where id = v_existing_customer_id and shop_id = p_shop_id;
    v_customer_id := v_existing_customer_id;
  else
    insert into analytics.oem_customer (shop_id, legal_name, tax_id, address, phone, contact_channel)
    values (p_shop_id, v_legal_name, v_tax_id, v_address, v_phone, v_contact_channel)
    returning id into v_customer_id;
  end if;

  update analytics.oem_quote set customer_id = v_customer_id, updated_by = auth.uid(), updated_at = now()
  where id = p_quote_id and shop_id = p_shop_id;

  return v_customer_id;
end;
$$;

revoke execute on function analytics.oem_quote_set_billing(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function analytics.oem_quote_set_billing(uuid, uuid, jsonb) to authenticated, service_role;

-- ============================================================================
-- 8. oem_quote_set_status — same signature/transitions as 0065; only the
--    comment + error message change, to say explicitly that 'superseded' is
--    blocked here for the same reason 'quoted'/'draft' already are: it must
--    only ever be produced by the one code path that has already validated
--    the substitution (oem_quote_renegotiate), never set directly.
-- ============================================================================

create or replace function analytics.oem_quote_set_status(
  p_shop_id uuid,
  p_quote_id uuid,
  p_status text,
  p_lost_reason text default null,
  p_lost_to text default null
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_current text;
begin
  if p_shop_id is null or p_quote_id is null or p_status is null then
    raise exception 'oem_quote_set_status: p_shop_id, p_quote_id and p_status are required';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  -- 'quoted' and 'draft' are produced by oem_quote_save (recomputes + gates);
  -- 'superseded' is produced ONLY by oem_quote_renegotiate (validates the new
  -- discount before marking the old row superseded). Setting any of the three
  -- directly here would skip whichever gate actually protects it.
  if p_status not in ('won', 'lost', 'rejected', 'expired') then
    raise exception 'oem_quote_set_status: สถานะ % เปลี่ยนตรงๆ ไม่ได้ — quoted/draft ออกผ่าน oem_quote_save, superseded เกิดจาก oem_quote_renegotiate เท่านั้น', p_status
      using errcode = '22023';
  end if;

  -- Scope by shop in the WHERE clause. Deriving shop_id from the row and
  -- checking it afterwards is not a check at all when the caller is
  -- service_role (crm_require_owner_admin short-circuits for it).
  select status into v_current
    from analytics.oem_quote
   where id = p_quote_id and shop_id = p_shop_id;
  if v_current is null then
    raise exception 'oem_quote_set_status: quote % not found for this shop', p_quote_id;
  end if;

  -- A draft was never gated, so it was never really offered to anyone —
  -- closing it as won/lost would put ungated numbers into the win-rate data
  -- the whole feature exists to produce.
  if p_status in ('won', 'lost') and v_current not in ('quoted', 'expired') then
    raise exception 'oem_quote_set_status: ใบนี้ยังไม่เคยออกเป็นใบเสนอราคา (สถานะ %) ปิดงานไม่ได้', v_current
      using errcode = '22023';
  end if;

  if p_status = 'lost' and (p_lost_reason is null or btrim(p_lost_reason) = '') then
    raise exception 'oem_quote_set_status: ปฏิเสธ/แพ้งานต้องระบุเหตุผล (p_lost_reason)' using errcode = '22023';
  end if;

  update analytics.oem_quote set
    status = p_status,
    lost_reason = case when p_status = 'lost' then p_lost_reason else lost_reason end,
    lost_to = case when p_status = 'lost' then p_lost_to else lost_to end,
    updated_by = auth.uid(), updated_at = now()
  where id = p_quote_id and shop_id = p_shop_id;
end;
$$;

revoke execute on function analytics.oem_quote_set_status(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function analytics.oem_quote_set_status(uuid, uuid, text, text, text) to authenticated, service_role;

-- ============================================================================
-- 9. Views.
--
-- v_oem_quote: CREATE OR REPLACE VIEW can only APPEND new output columns at
-- the end — it cannot reorder or remove ones that already exist in the
-- deployed view, or Postgres raises 42P16. The view currently live (from
-- 0062, never touched since) exposes exactly: the 28 oem_quote table columns
-- AS THEY WERE AT 0062 (i.e. WITHOUT margin_charged_pct, which 0063 added to
-- the table but never back-filled into this view — same class of bug as
-- dd3c8cc, just never shipped on this branch) + is_expired + days_left. So
-- every column below is spelled out explicitly, in that exact original
-- order, and every new column (including the missed margin_charged_pct) is
-- appended after days_left, never inserted earlier.
-- ============================================================================

create or replace view analytics.v_oem_quote
  with (security_invoker = true) as
select
  q.id,
  q.shop_id,
  q.quote_no,
  q.customer_name,
  q.customer_contact,
  q.input,
  q.calc,
  q.rate_snapshot,
  q.cost_piece,
  q.price_per_piece,
  q.nre_cost,
  q.nre_price,
  q.pieces_subtotal,
  q.quote_total,
  q.margin_actual_pct,
  q.q_run,
  q.flask_count,
  q.plating_batch_count,
  q.status,
  q.approval_note,
  q.approved_by,
  q.quote_valid_until,
  q.lost_reason,
  q.lost_to,
  q.created_by,
  q.updated_by,
  q.created_at,
  q.updated_at,
  (q.status = 'quoted' and q.quote_valid_until is not null and q.quote_valid_until < current_date) as is_expired,
  case when q.quote_valid_until is not null then q.quote_valid_until - current_date else null end as days_left,
  -- ---- appended 0075+ only; do not insert new columns above this line ----
  q.margin_charged_pct,
  q.discount_thb,
  q.discount_reason,
  q.grand_total,
  q.margin_after_discount_pct,
  q.parent_quote_id,
  q.root_quote_id,
  q.customer_id,
  q.vat_mode,
  pq.quote_no as parent_quote_no,
  (select count(*) from analytics.oem_quote_item i where i.quote_id = q.id) as item_count
from analytics.oem_quote q
left join analytics.oem_quote pq on pq.id = q.parent_quote_id;

create or replace view analytics.v_oem_quote_item
  with (security_invoker = true) as
select
  i.*,
  q.quote_no
from analytics.oem_quote_item i
join analytics.oem_quote q on q.id = i.quote_id;

-- Grant only what this migration created. A blanket
-- `grant select on all tables in schema analytics` would sweep in every
-- unrelated table (pii_customer, the archive tables, staging) in one
-- statement whose intent nobody can read later — and 0018 already sets
-- default privileges for new tables anyway, so the blanket form buys
-- nothing while making the next security review harder.
grant select on analytics.oem_quote_item to authenticated, service_role;
grant select on analytics.oem_customer  to authenticated, service_role;
grant select on analytics.v_oem_quote      to authenticated, service_role;
grant select on analytics.v_oem_quote_item to authenticated, service_role;

notify pgrst, 'reload schema';

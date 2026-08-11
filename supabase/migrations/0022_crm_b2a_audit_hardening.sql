-- 0022_crm_b2a_audit_hardening.sql
-- Follow-ups from the B2a security audit (Mace Windu):
--   M3 — crm_edit_pii must flip dim_customer.profile_source to 'manual' too,
--        otherwise a human-corrected name is silently overwritten by the next
--        import (transform_pending_orders only guards names when
--        profile_source = 'import'). Editing a customer's PII is a human taking
--        ownership of that profile, so the same guard must apply.
--   M2 — crm_audit_log is meant to be append-only, but "no RLS write policy"
--        only stops the `authenticated` role; the service_role client the app
--        uses bypasses RLS and could UPDATE/DELETE audit rows. A trigger fires
--        regardless of role, so enforce append-only there.
--
-- NOT addressed here (tracked as real-auth blockers in phase-b-crm-design.md):
--   H1/M1 — the RPCs' owner/admin check short-circuits for service_role, so DB
--           authz + audit `actor` (auth.uid() = null under service role) only
--           become real once the app moves off the service client to real
--           Supabase Auth. The app-layer getDevRole gate is the authz until then.

-- ---------------------------------------------------------------------------
-- M2: append-only enforcement on crm_audit_log (fires even for service_role)
-- ---------------------------------------------------------------------------
create or replace function analytics.crm_audit_log_append_only()
 returns trigger
 language plpgsql
 set search_path to 'pg_temp'
as $$
begin
  raise exception 'analytics.crm_audit_log is append-only (% blocked)', tg_op
    using errcode = '42501';
end;
$$;

create trigger trg_crm_audit_log_append_only
  before update or delete on analytics.crm_audit_log
  for each row execute function analytics.crm_audit_log_append_only();

-- ---------------------------------------------------------------------------
-- M3: crm_edit_pii flips profile_source = 'manual' (same guard as
-- crm_edit_customer). Recreated identically to 0021 except for that one UPDATE.
-- ---------------------------------------------------------------------------
create or replace function analytics.crm_edit_pii(
  p_customer_id uuid,
  p_phone_e164 text,
  p_full_name text,
  p_address jsonb
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_shop_id uuid;
  v_before jsonb;
begin
  if p_customer_id is null then
    raise exception 'crm_edit_pii: p_customer_id is required';
  end if;

  select shop_id into v_shop_id
    from analytics.dim_customer where id = p_customer_id and merged_into_id is null;
  if v_shop_id is null then
    raise exception 'crm_edit_pii: customer % not found (or already merged)', p_customer_id;
  end if;

  perform analytics.crm_require_owner_admin(v_shop_id);

  select to_jsonb(pc) - 'customer_id' - 'shop_id' into v_before
    from analytics.pii_customer pc where pc.customer_id = p_customer_id;

  insert into analytics.pii_customer (customer_id, shop_id, phone_e164, full_name, address, updated_at)
  values (p_customer_id, v_shop_id, p_phone_e164, p_full_name, p_address, now())
  on conflict (customer_id) do update set
    phone_e164 = excluded.phone_e164,
    full_name = excluded.full_name,
    address = excluded.address,
    updated_at = now();

  -- M3: a human just took ownership of this customer's PII — stop the next
  -- import from overwriting the name (mirrors crm_edit_customer).
  update analytics.dim_customer
    set profile_source = 'manual', updated_at = now()
    where id = p_customer_id and profile_source <> 'manual';

  insert into analytics.crm_audit_log (shop_id, actor, action, entity_type, entity_id, before, after)
  values (
    v_shop_id, auth.uid(), 'pii_edit', 'pii_customer', p_customer_id,
    v_before,
    jsonb_build_object('phone_e164', p_phone_e164, 'full_name', p_full_name, 'address', p_address)
  );
end;
$$;

revoke execute on function analytics.crm_edit_pii(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function analytics.crm_edit_pii(uuid, text, text, jsonb) to authenticated, service_role;

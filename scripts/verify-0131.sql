-- scripts/verify-0131.sql
--
-- Self-contained verify script for supabase/migrations/0131_production_order.sql
-- (ใบผลิตเข้าสต็อก, P1a). Per skill 3j-migration-traps #11: ทุกอย่างรันใน
-- do $$ ... $$ block เดียว จบด้วย `raise exception` เสมอ ⇒ ทั้ง transaction
-- rollback ไม่ว่าผลจะผ่าน/ไม่ผ่าน — อ่านผลจาก error message นี้ ก่อนตัดสินใจ
-- apply 0131 จริงผ่าน MCP `apply_migration`.
--
-- ⚠️ งานนี้แตะ stock ledger + ต้นทุนที่เจ้าของใช้ตัดสินใจผลิต (💰) — ทดสอบด้วย
-- shop/product สังเคราะห์ที่สร้างขึ้นในทรานแซคชันนี้เอง (gen_random_uuid() ณ
-- runtime) ไม่แตะ shop/SKU จริงเลย กัน "เผา state ที่กู้คืนไม่ได้" (ข้อ 11)
--
-- โครงสร้าง:
--   Part 0 — apply 0131's DDL ทั้งไฟล์ verbatim (ผ่าน EXECUTE บน dollar-quoted
--            strings, per section ตามไฟล์ migration)
--   Part 1 — setup: 2 shop สังเคราะห์ + SKU ทดสอบหลายแบบ
--   Part 2..19 — เคสทดสอบ (ดูรายชื่อในคอมเมนต์ท้ายไฟล์ก่อน raise)
--
-- Shop/SKU ทั้งหมดในไฟล์นี้เป็นของสังเคราะห์ ถูก rollback ทิ้งเสมอ ไม่ผูกกับ
-- shop_id คงที่ที่ script อื่นในโฟลเดอร์นี้ใช้ (a7c850ee...) เพราะต้องควบคุมได้
-- เต็มที่ว่า "มี/ไม่มีราคาเงินวันนี้" (คนละเคสต้องการคนละสภาวะ)

do $$
declare
  v_log text := E'\n=== verify 0131 (production_order P1a) ===\n';

  v_shop_id       uuid := gen_random_uuid();
  v_shop_id_other uuid := gen_random_uuid();

  v_p_fixed        uuid; -- cost_type=fixed, unit_cost=100, ไม่มี central_stock แถวเลย
  v_p_spot         uuid; -- cost_type=spot, weight=10, purity=0.925, labor=20
  v_p_spot_noprice uuid; -- cost_type=spot เหมือนกัน แต่ใช้กับเคส "ไม่มีราคาวันนี้"
  v_p_disabled     uuid; -- is_active=false
  v_p_live         uuid; -- sku ขึ้นด้วย live (case-insensitive)
  v_p_other_shop   uuid; -- อยู่ shop อื่น
  v_p_pretracked   uuid; -- track_stock=true, track_stock_since = วันก่อน (raw update)
  v_p_rename       uuid; -- SKU ปกติตอนใส่ในใบ แล้วถูก rename เป็น live* ก่อน done

  v_order_id     uuid;
  v_order_id2    uuid;
  v_order_id3    uuid;
  v_order_id4    uuid;
  v_item_id      uuid;
  v_res          jsonb;

  v_before_ledger_count int;
  v_after_ledger_count  int;
  v_before_qty_on_hand  int;
  v_after_qty_on_hand   int;
  v_before_counter      int;
  v_after_counter       int;

  v_track_since_before date;
  v_track_since_after  date;

  v_priv_anon boolean;
  v_priv_auth boolean;
  v_priv_svc  boolean;
  v_fn_count  int;
  v_caught    boolean;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -----------------------------------------------------------------------
  -- Part 0: apply 0131's DDL verbatim, in this same (rolled-back) txn
  -----------------------------------------------------------------------

  -- §1 public.product columns
  execute $ddl1$
    alter table public.product
      add column if not exists track_stock       boolean not null default false,
      add column if not exists track_stock_since date;

    comment on column public.product.track_stock is
      'P1 (0131): true = SKU นี้นับสต็อกจริงจาก central_stock. default false ⇒ SKU เก่า/'
      'live-SKU/SKU ที่ import auto-create ไม่ถูกนับโดยไม่ต้องทำอะไร (มติเจ้าของ 17 ก.ย. §8). '
      'เปิดได้ทางเดียวในเฟสนี้คือ analytics.production_order_done (P1.5 จะเพิ่ม toggle มือ).';
    comment on column public.product.track_stock_since is
      'วันไทย (Asia/Bangkok) ที่เริ่มนับสต็อกของ SKU นี้ครั้งแรก — ห้ามถูกเลื่อนถ้าเคยเปิดแล้ว '
      '(production_order_done ใช้ coalesce(track_stock_since, วันนี้) กันการเลื่อน). '
      'ใช้เป็นจุดตัดสำหรับ P1.5 reconcile ในอนาคต (ไม่ตัดสต็อกย้อนหลังก่อนวันนี้).';
  $ddl1$;

  -- §2 production_order_counter
  execute $ddl2$
    create table if not exists analytics.production_order_counter (
      shop_id uuid not null primary key references public.shop (id) on delete cascade,
      last_no int  not null default 0
    );
    alter table analytics.production_order_counter enable row level security;
    comment on table analytics.production_order_counter is
      '0131: ตัวนับเลขใบผลิตถัดไปต่อ shop_id — เลขข้ามได้ (ไม่มี deny-mutation trigger) '
      'เพราะใบผลิตไม่ใช่เอกสารทางกฎหมาย (ต่างจาก analytics.oem_doc_counter). '
      'RLS เปิดแต่ไม่มี policy/grant — เข้าถึงได้เฉพาะผ่าน analytics.production_order_save '
      '(security definer).';
  $ddl2$;

  -- §3 production_order table
  execute $ddl3$
    create table if not exists analytics.production_order (
      id                          uuid primary key default gen_random_uuid(),
      shop_id                     uuid not null references public.shop (id) on delete cascade,
      seq                         int  not null,
      po_no                       text generated always as ('PO-' || lpad(seq::text, 4, '0')) stored,
      status                      text not null default 'open' check (status in ('open', 'done', 'cancelled')),
      note                        text,
      spot_override_thb_per_gram numeric(12, 4)
        check (spot_override_thb_per_gram is null
          or (spot_override_thb_per_gram >= 5 and spot_override_thb_per_gram <= 500)),
      done_at                     timestamptz,
      cancelled_at                timestamptz,
      cancel_reason               text,
      created_by                  uuid references auth.users (id) on delete set null,
      created_at                  timestamptz not null default now(),
      updated_at                  timestamptz not null default now(),
      constraint uq_production_order_shop_seq unique (shop_id, seq)
    );
    create index if not exists idx_production_order_shop_status on analytics.production_order (shop_id, status);
    alter table analytics.production_order enable row level security;
    drop policy if exists tenant_isolation_select on analytics.production_order;
    create policy tenant_isolation_select on analytics.production_order
      for select
      using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));
  $ddl3$;

  -- §4 production_order_item table
  execute $ddl4$
    create table if not exists analytics.production_order_item (
      id                  uuid primary key default gen_random_uuid(),
      production_order_id uuid not null references analytics.production_order (id) on delete cascade,
      shop_id             uuid not null references public.shop (id) on delete cascade,
      product_id          uuid not null references public.product (id) on delete restrict,
      qty_planned         int not null check (qty_planned > 0 and qty_planned <= 100000),
      qty_done            int check (qty_done is null or (qty_done >= 0 and qty_done <= 100000)),
      unit_cost           numeric(12, 2),
      prev_cost_type      text check (prev_cost_type is null or prev_cost_type in ('fixed', 'spot')),
      prev_unit_cost      numeric(12, 2),
      created_at          timestamptz not null default now(),
      updated_at          timestamptz not null default now(),
      constraint uq_production_order_item_order_product unique (production_order_id, product_id)
    );
    create index if not exists idx_production_order_item_order   on analytics.production_order_item (production_order_id);
    create index if not exists idx_production_order_item_product on analytics.production_order_item (product_id);
    alter table analytics.production_order_item enable row level security;
    drop policy if exists tenant_isolation_select on analytics.production_order_item;
    create policy tenant_isolation_select on analytics.production_order_item
      for select
      using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));
  $ddl4$;

  -- §5a production_order_deny_mutation
  execute $ddl5$
    create or replace function analytics.production_order_deny_mutation()
     returns trigger
     language plpgsql
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body5$
    begin
      if tg_op = 'DELETE' then
        raise exception 'production_order: ห้ามลบใบผลิต — ยกเลิกด้วย analytics.production_order_cancel แทน (ต้องเก็บไว้เป็น audit trail ของต้นทุน/สต็อก)' using errcode = '22023';
      end if;

      if new.shop_id is distinct from old.shop_id
         or new.seq is distinct from old.seq
         or new.created_at is distinct from old.created_at
         or new.created_by is distinct from old.created_by then
        raise exception 'production_order: ห้ามเปลี่ยน shop_id/seq/created_at/created_by ของใบที่มีอยู่แล้ว' using errcode = '22023';
      end if;

      if old.status <> 'open' then
        raise exception 'production_order: ใบ % สถานะ % แล้ว แก้ไม่ได้ (open→done/cancelled เป็นปลายทาง)', old.po_no, old.status using errcode = '22023';
      end if;

      if new.status = 'done' and new.done_at is null then
        raise exception 'production_order: เปลี่ยนเป็น done ต้องมี done_at กำกับเสมอ' using errcode = '22023';
      end if;
      if new.status = 'cancelled' and new.cancelled_at is null then
        raise exception 'production_order: เปลี่ยนเป็น cancelled ต้องมี cancelled_at กำกับเสมอ' using errcode = '22023';
      end if;

      return new;
    end;
    $body5$;

    revoke execute on function analytics.production_order_deny_mutation() from public, anon, authenticated;

    drop trigger if exists trg_production_order_deny_mutation on analytics.production_order;
    create trigger trg_production_order_deny_mutation
      before update or delete on analytics.production_order
      for each row execute function analytics.production_order_deny_mutation();
  $ddl5$;

  -- §5b production_order_item_deny_mutation
  execute $ddl6$
    create or replace function analytics.production_order_item_deny_mutation()
     returns trigger
     language plpgsql
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body6$
    declare
      v_status text;
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
      return new;
    end;
    $body6$;

    revoke execute on function analytics.production_order_item_deny_mutation() from public, anon, authenticated;

    drop trigger if exists trg_production_order_item_deny_mutation on analytics.production_order_item;
    create trigger trg_production_order_item_deny_mutation
      before update or delete on analytics.production_order_item
      for each row execute function analytics.production_order_item_deny_mutation();
  $ddl6$;

  -- §5c production_order_item_derive_shop
  execute $ddl7$
    create or replace function analytics.production_order_item_derive_shop()
     returns trigger
     language plpgsql
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body7$
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

      select shop_id, sku, is_active into v_product_shop_id, v_sku, v_is_active
        from public.product where id = new.product_id;
      if v_product_shop_id is null then
        raise exception 'production_order_item: ไม่พบ SKU (product_id=%)', new.product_id using errcode = '22023';
      end if;
      if v_product_shop_id <> v_order_shop_id then
        raise exception 'production_order_item: SKU (product_id=%) เป็นของร้านอื่น ใส่ในใบผลิตของร้านนี้ไม่ได้', new.product_id using errcode = '22023';
      end if;
      if v_sku ~* '^live' then
        raise exception 'production_order_item: SKU % เป็น SKU เฉพาะไลฟ์ (live*) ไม่นับสต็อก ใส่ในใบผลิตไม่ได้', v_sku using errcode = '22023';
      end if;
      if not v_is_active then
        raise exception 'production_order_item: SKU % ปิดใช้งานแล้ว ใส่ในใบผลิตไม่ได้', v_sku using errcode = '22023';
      end if;

      new.shop_id := v_order_shop_id;
      return new;
    end;
    $body7$;

    revoke execute on function analytics.production_order_item_derive_shop() from public, anon, authenticated;

    drop trigger if exists trg_production_order_item_derive_shop on analytics.production_order_item;
    create trigger trg_production_order_item_derive_shop
      before insert or update of production_order_id, product_id on analytics.production_order_item
      for each row execute function analytics.production_order_item_derive_shop();
  $ddl7$;

  -- §6 production_spot_resolve
  execute $ddl8$
    create or replace function analytics.production_spot_resolve(
      p_shop_id  uuid,
      p_override numeric default null
    )
     returns numeric
     language plpgsql
     security definer
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body8$
    declare
      v_today date := (now() at time zone 'Asia/Bangkok')::date;
      v_price numeric;
    begin
      if p_shop_id is null then
        raise exception 'production_spot_resolve: p_shop_id is required';
      end if;
      perform analytics.crm_require_owner_admin(p_shop_id);

      if p_override is not null then
        if not (p_override >= 5 and p_override <= 500) then
          raise exception 'production_spot_resolve: override ต้องอยู่ระหว่าง 5-500 บาท/กรัม (ต่อกรัม ไม่ใช่ต่อบาท — 1 บาท = 15.244 กรัม)' using errcode = '22023';
        end if;
        return p_override;
      end if;

      select price_thb_per_gram into v_price
        from analytics.oem_metal_price
       where shop_id = p_shop_id and metal = 'silver' and as_of_date = v_today;

      if v_price is null then
        raise exception 'production_spot_resolve: ยังไม่มีราคาเงินของวันนี้ (%) และไม่มี override — ออกใบผลิตไม่ได้ (ห้าม fallback ราคาเมื่อวาน)', v_today using errcode = '22023';
      end if;

      return v_price;
    end;
    $body8$;

    revoke execute on function analytics.production_spot_resolve(uuid, numeric) from public, anon, authenticated;
    grant execute on function analytics.production_spot_resolve(uuid, numeric) to service_role;
  $ddl8$;

  -- §7 production_cost_calc
  execute $ddl9$
    create or replace function analytics.production_cost_calc(
      p_shop_id                   uuid,
      p_product_id                uuid,
      p_spot_price_thb_per_gram   numeric default null
    )
     returns jsonb
     language plpgsql
     security definer
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body9$
    declare
      v_product public.product%rowtype;
      v_spot    numeric;
      v_unit_cost numeric;
    begin
      if p_shop_id is null or p_product_id is null then
        raise exception 'production_cost_calc: p_shop_id and p_product_id are required';
      end if;
      if p_spot_price_thb_per_gram is not null and not (p_spot_price_thb_per_gram >= 5 and p_spot_price_thb_per_gram <= 500) then
        raise exception 'production_cost_calc: p_spot_price_thb_per_gram ต้องอยู่ระหว่าง 5-500 บาท/กรัม' using errcode = '22023';
      end if;
      perform analytics.crm_require_owner_admin(p_shop_id);

      select * into v_product from public.product where id = p_product_id and shop_id = p_shop_id;
      if not found then
        raise exception 'production_cost_calc: ไม่พบ SKU (product_id=%) ในร้านนี้', p_product_id using errcode = '22023';
      end if;

      if v_product.cost_type = 'spot' then
        if v_product.silver_weight_g is null or v_product.silver_weight_g <= 0 then
          raise exception 'production_cost_calc: SKU % เป็นโหมด spot แต่ยังไม่กรอกน้ำหนักเงิน (silver_weight_g) — กรอกที่ /catalog ก่อนสั่งผลิต', v_product.sku using errcode = '22023';
        end if;
        v_spot := coalesce(p_spot_price_thb_per_gram, analytics.production_spot_resolve(p_shop_id, null));
        v_unit_cost := round(coalesce(v_product.silver_weight_g, 0) * coalesce(v_spot, 0)
                              * coalesce(v_product.silver_purity, 0.925) + coalesce(v_product.labor_cost, 0), 2);
      else
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
        'spot_price_thb_per_gram', case when v_product.cost_type = 'spot' then v_spot else null end,
        'prev_cost_type', v_product.cost_type,
        'prev_unit_cost', v_product.unit_cost,
        'unit_cost', v_unit_cost
      );
    end;
    $body9$;

    revoke execute on function analytics.production_cost_calc(uuid, uuid, numeric) from public, anon, authenticated;
    grant execute on function analytics.production_cost_calc(uuid, uuid, numeric) to service_role;
  $ddl9$;

  -- §8 production_order_save
  execute $ddl10$
    create or replace function analytics.production_order_save(
      p_shop_id                   uuid,
      p_id                        uuid default null,
      p_note                      text default null,
      p_spot_override_thb_per_gram numeric default null
    )
     returns jsonb
     language plpgsql
     security definer
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body10$
    declare
      v_row analytics.production_order%rowtype;
      v_seq int;
    begin
      if p_shop_id is null then
        raise exception 'production_order_save: p_shop_id is required';
      end if;
      if p_spot_override_thb_per_gram is not null and not (p_spot_override_thb_per_gram >= 5 and p_spot_override_thb_per_gram <= 500) then
        raise exception 'production_order_save: override ต้องอยู่ระหว่าง 5-500 บาท/กรัม (ต่อกรัม ไม่ใช่ต่อบาท — 1 บาท = 15.244 กรัม)' using errcode = '22023';
      end if;

      perform analytics.crm_require_owner_admin(p_shop_id);

      if p_id is null then
        insert into analytics.production_order_counter as c (shop_id, last_no)
        values (p_shop_id, 0)
        on conflict (shop_id) do update set last_no = c.last_no
        returning c.last_no into v_seq;

        v_seq := v_seq + 1;
        update analytics.production_order_counter set last_no = v_seq where shop_id = p_shop_id;

        insert into analytics.production_order (shop_id, seq, note, spot_override_thb_per_gram, created_by)
        values (p_shop_id, v_seq, nullif(btrim(p_note), ''), p_spot_override_thb_per_gram, auth.uid())
        returning * into v_row;
      else
        select * into v_row from analytics.production_order where id = p_id and shop_id = p_shop_id for update;
        if not found then
          raise exception 'production_order_save: ไม่พบใบผลิต % ในร้านนี้', p_id using errcode = '22023';
        end if;
        if v_row.status <> 'open' then
          raise exception 'production_order_save: ใบ % สถานะ % แล้ว แก้ไม่ได้', v_row.po_no, v_row.status using errcode = '22023';
        end if;

        update analytics.production_order set
          note                        = coalesce(nullif(btrim(p_note), ''), note),
          spot_override_thb_per_gram  = coalesce(p_spot_override_thb_per_gram, spot_override_thb_per_gram),
          updated_at                  = now()
        where id = p_id
        returning * into v_row;
      end if;

      return jsonb_build_object(
        'id', v_row.id, 'po_no', v_row.po_no, 'status', v_row.status,
        'note', v_row.note, 'spot_override_thb_per_gram', v_row.spot_override_thb_per_gram,
        'seq', v_row.seq, 'created_at', v_row.created_at
      );
    end;
    $body10$;

    revoke execute on function analytics.production_order_save(uuid, uuid, text, numeric) from public, anon, authenticated;
    grant execute on function analytics.production_order_save(uuid, uuid, text, numeric) to service_role;
  $ddl10$;

  -- §9 production_order_item_set
  execute $ddl11$
    create or replace function analytics.production_order_item_set(
      p_shop_id             uuid,
      p_production_order_id uuid,
      p_product_id          uuid,
      p_qty_planned         int
    )
     returns jsonb
     language plpgsql
     security definer
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body11$
    declare
      v_order   analytics.production_order%rowtype;
      v_product public.product%rowtype;
      v_item    analytics.production_order_item%rowtype;
    begin
      if p_shop_id is null or p_production_order_id is null or p_product_id is null then
        raise exception 'production_order_item_set: p_shop_id, p_production_order_id, p_product_id are required';
      end if;
      if p_qty_planned is null or not (p_qty_planned > 0 and p_qty_planned <= 100000) then
        raise exception 'production_order_item_set: p_qty_planned ต้องอยู่ระหว่าง 1-100000' using errcode = '22023';
      end if;

      perform analytics.crm_require_owner_admin(p_shop_id);

      select * into v_order from analytics.production_order where id = p_production_order_id and shop_id = p_shop_id for update;
      if not found then
        raise exception 'production_order_item_set: ไม่พบใบผลิต % ในร้านนี้', p_production_order_id using errcode = '22023';
      end if;
      if v_order.status <> 'open' then
        raise exception 'production_order_item_set: ใบ % สถานะ % แล้ว เพิ่ม/แก้รายการไม่ได้', v_order.po_no, v_order.status using errcode = '22023';
      end if;

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

      insert into analytics.production_order_item as poi (production_order_id, product_id, qty_planned)
      values (p_production_order_id, p_product_id, p_qty_planned)
      on conflict (production_order_id, product_id) do update
        set qty_planned = excluded.qty_planned, updated_at = now()
      returning * into v_item;

      return jsonb_build_object(
        'id', v_item.id, 'product_id', v_item.product_id, 'sku', v_product.sku,
        'name', v_product.name, 'qty_planned', v_item.qty_planned
      );
    end;
    $body11$;

    revoke execute on function analytics.production_order_item_set(uuid, uuid, uuid, int) from public, anon, authenticated;
    grant execute on function analytics.production_order_item_set(uuid, uuid, uuid, int) to service_role;
  $ddl11$;

  -- §10 production_order_item_remove
  execute $ddl12$
    create or replace function analytics.production_order_item_remove(
      p_shop_id             uuid,
      p_production_order_id uuid,
      p_product_id          uuid
    )
     returns void
     language plpgsql
     security definer
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body12$
    declare
      v_order analytics.production_order%rowtype;
    begin
      if p_shop_id is null or p_production_order_id is null or p_product_id is null then
        raise exception 'production_order_item_remove: p_shop_id, p_production_order_id, p_product_id are required';
      end if;

      perform analytics.crm_require_owner_admin(p_shop_id);

      select * into v_order from analytics.production_order where id = p_production_order_id and shop_id = p_shop_id for update;
      if not found then
        raise exception 'production_order_item_remove: ไม่พบใบผลิต % ในร้านนี้', p_production_order_id using errcode = '22023';
      end if;
      if v_order.status <> 'open' then
        raise exception 'production_order_item_remove: ใบ % สถานะ % แล้ว ลบรายการไม่ได้', v_order.po_no, v_order.status using errcode = '22023';
      end if;

      delete from analytics.production_order_item
       where production_order_id = p_production_order_id and product_id = p_product_id;
    end;
    $body12$;

    revoke execute on function analytics.production_order_item_remove(uuid, uuid, uuid) from public, anon, authenticated;
    grant execute on function analytics.production_order_item_remove(uuid, uuid, uuid) to service_role;
  $ddl12$;

  -- §11 production_order_preview
  execute $ddl13$
    create or replace function analytics.production_order_preview(
      p_shop_id             uuid,
      p_production_order_id uuid
    )
     returns jsonb
     language plpgsql
     security definer
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body13$
    declare
      v_order      analytics.production_order%rowtype;
      v_spot       numeric;
      v_needs_spot boolean;
      v_items      jsonb;
    begin
      if p_shop_id is null or p_production_order_id is null then
        raise exception 'production_order_preview: p_shop_id and p_production_order_id are required';
      end if;
      perform analytics.crm_require_owner_admin(p_shop_id);

      select * into v_order from analytics.production_order where id = p_production_order_id and shop_id = p_shop_id;
      if not found then
        raise exception 'production_order_preview: ไม่พบใบผลิต % ในร้านนี้', p_production_order_id using errcode = '22023';
      end if;
      if v_order.status <> 'open' then
        raise exception 'production_order_preview: ใบ % สถานะ % แล้ว — ดูค่าที่ stamp ไปแล้วจากรายการใบผลิตได้เลย ไม่ต้อง preview ซ้ำ', v_order.po_no, v_order.status using errcode = '22023';
      end if;

      select exists (
        select 1 from analytics.production_order_item poi
        join public.product p on p.id = poi.product_id
        where poi.production_order_id = p_production_order_id and p.cost_type = 'spot'
      ) into v_needs_spot;

      if v_needs_spot then
        v_spot := analytics.production_spot_resolve(p_shop_id, v_order.spot_override_thb_per_gram);
      end if;

      select coalesce(jsonb_agg(
          calc.result || jsonb_build_object('item_id', poi.id, 'qty_planned', poi.qty_planned)
          order by poi.created_at
        ), '[]'::jsonb)
        into v_items
      from analytics.production_order_item poi
      join public.product p on p.id = poi.product_id
      cross join lateral (
        select analytics.production_cost_calc(
          p_shop_id, poi.product_id, case when p.cost_type = 'spot' then v_spot else null end
        ) as result
      ) calc
      where poi.production_order_id = p_production_order_id;

      return jsonb_build_object(
        'production_order_id', p_production_order_id,
        'po_no', v_order.po_no,
        'spot_price_thb_per_gram', v_spot,
        'items', v_items
      );
    end;
    $body13$;

    revoke execute on function analytics.production_order_preview(uuid, uuid) from public, anon, authenticated;
    grant execute on function analytics.production_order_preview(uuid, uuid) to service_role;
  $ddl13$;

  -- §12 production_order_done
  execute $ddl14$
    create or replace function analytics.production_order_done(
      p_shop_id             uuid,
      p_production_order_id uuid,
      p_items               jsonb default null
    )
     returns jsonb
     language plpgsql
     security definer
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body14$
    declare
      v_order          analytics.production_order%rowtype;
      v_today          date := (now() at time zone 'Asia/Bangkok')::date;
      v_work           jsonb;
      v_elem           jsonb;
      v_qty_done       int;
      v_total_qty_done numeric := 0;
      v_needs_spot     boolean;
      v_spot           numeric;
      v_product        public.product%rowtype;
      v_calc           jsonb;
      v_unit_cost      numeric;
      v_before         jsonb;
      v_after          jsonb;
      v_result         jsonb;
    begin
      if p_shop_id is null or p_production_order_id is null then
        raise exception 'production_order_done: p_shop_id and p_production_order_id are required';
      end if;
      if p_items is not null and jsonb_typeof(p_items) <> 'array' then
        raise exception 'production_order_done: p_items ต้องเป็น json array' using errcode = '22023';
      end if;

      perform analytics.crm_require_owner_admin(p_shop_id);

      select * into v_order from analytics.production_order
        where id = p_production_order_id and shop_id = p_shop_id
        for update;
      if not found then
        raise exception 'production_order_done: ไม่พบใบผลิต % ในร้านนี้', p_production_order_id using errcode = '22023';
      end if;

      if v_order.status = 'done' then
        select coalesce(jsonb_agg(jsonb_build_object(
            'product_id', poi.product_id, 'sku', p.sku, 'qty_done', poi.qty_done,
            'unit_cost', poi.unit_cost, 'prev_cost_type', poi.prev_cost_type, 'prev_unit_cost', poi.prev_unit_cost
          )), '[]'::jsonb)
          into v_result
        from analytics.production_order_item poi
        join public.product p on p.id = poi.product_id
        where poi.production_order_id = p_production_order_id;

        return jsonb_build_object('production_order_id', p_production_order_id, 'po_no', v_order.po_no,
          'status', v_order.status, 'already_done', true, 'items', v_result);
      end if;

      if v_order.status = 'cancelled' then
        raise exception 'production_order_done: ใบ % ถูกยกเลิกไปแล้ว ทำ done ไม่ได้', v_order.po_no using errcode = '22023';
      end if;

      select coalesce(jsonb_agg(jsonb_build_object(
          'id', poi.id, 'product_id', poi.product_id, 'qty_planned', poi.qty_planned,
          'qty_done_resolved', coalesce(
            (select (ov ->> 'qty_done')::int from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) ov
              where (ov ->> 'product_id')::uuid = poi.product_id),
            poi.qty_planned
          )
        )), '[]'::jsonb)
        into v_work
      from analytics.production_order_item poi
      where poi.production_order_id = p_production_order_id;

      if v_work = '[]'::jsonb then
        raise exception 'production_order_done: ใบ % ไม่มีรายการให้ผลิต (ใบว่าง)', v_order.po_no using errcode = '22023';
      end if;

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

      select exists (
        select 1 from jsonb_array_elements(v_work) e
        join public.product p on p.id = (e ->> 'product_id')::uuid
        where p.cost_type = 'spot' and (e ->> 'qty_done_resolved')::int > 0
      ) into v_needs_spot;

      if v_needs_spot then
        v_spot := analytics.production_spot_resolve(p_shop_id, v_order.spot_override_thb_per_gram);
      end if;

      for v_elem in select * from jsonb_array_elements(v_work) loop
        v_qty_done := (v_elem ->> 'qty_done_resolved')::int;

        if v_qty_done = 0 then
          update analytics.production_order_item
             set qty_done = 0, updated_at = now()
           where id = (v_elem ->> 'id')::uuid;
          continue;
        end if;

        select * into v_product from public.product
          where id = (v_elem ->> 'product_id')::uuid and shop_id = p_shop_id;
        if not found then
          raise exception 'production_order_done: ไม่พบ SKU (product_id=%) ในร้านนี้', v_elem ->> 'product_id' using errcode = '22023';
        end if;
        if not v_product.is_active then
          raise exception 'production_order_done: SKU % ปิดใช้งานแล้ว ผลิตไม่ได้', v_product.sku using errcode = '22023';
        end if;
        if v_product.sku ~* '^live' then
          raise exception 'production_order_done: SKU % เป็น SKU เฉพาะไลฟ์ (live*) ผลิตไม่ได้', v_product.sku using errcode = '22023';
        end if;

        v_calc := analytics.production_cost_calc(
          p_shop_id, v_product.id,
          case when v_product.cost_type = 'spot' then v_spot else null end
        );
        v_unit_cost := (v_calc ->> 'unit_cost')::numeric;
        if v_unit_cost is null then
          raise exception 'production_order_done: คำนวณต้นทุน SKU % ไม่ได้ (unit_cost เป็น null)', v_product.sku using errcode = '22023';
        end if;

        v_before := jsonb_build_object('cost_type', v_product.cost_type, 'unit_cost', v_product.unit_cost,
          'track_stock', v_product.track_stock, 'track_stock_since', v_product.track_stock_since);

        update analytics.production_order_item
           set qty_done = v_qty_done, unit_cost = v_unit_cost,
               prev_cost_type = v_product.cost_type, prev_unit_cost = v_product.unit_cost,
               updated_at = now()
         where id = (v_elem ->> 'id')::uuid;

        insert into public.central_stock (product_id) values (v_product.id)
          on conflict (product_id) do nothing;

        perform public.adjust_stock(p_shop_id, v_product.id, v_qty_done, 'po:' || (v_elem ->> 'id'));

        update public.product
           set cost_type = 'fixed', unit_cost = v_unit_cost, track_stock = true,
               track_stock_since = coalesce(v_product.track_stock_since, v_today),
               updated_at = now()
         where id = v_product.id;

        v_after := jsonb_build_object('cost_type', 'fixed', 'unit_cost', v_unit_cost,
          'track_stock', true, 'track_stock_since', coalesce(v_product.track_stock_since, v_today));

        insert into analytics.catalog_audit_log (shop_id, product_id, sku, action, before, after, changed_by)
        values (p_shop_id, v_product.id, v_product.sku, 'edit', v_before, v_after, auth.uid());
      end loop;

      update analytics.production_order
         set status = 'done', done_at = now()
       where id = p_production_order_id;

      select coalesce(jsonb_agg(jsonb_build_object(
          'product_id', poi.product_id, 'sku', p.sku, 'qty_done', poi.qty_done,
          'unit_cost', poi.unit_cost, 'prev_cost_type', poi.prev_cost_type, 'prev_unit_cost', poi.prev_unit_cost
        )), '[]'::jsonb)
        into v_result
      from analytics.production_order_item poi
      join public.product p on p.id = poi.product_id
      where poi.production_order_id = p_production_order_id;

      return jsonb_build_object('production_order_id', p_production_order_id, 'po_no', v_order.po_no,
        'status', 'done', 'already_done', false, 'items', v_result);
    end;
    $body14$;

    revoke execute on function analytics.production_order_done(uuid, uuid, jsonb) from public, anon, authenticated;
    grant execute on function analytics.production_order_done(uuid, uuid, jsonb) to service_role;
  $ddl14$;

  -- §13 production_order_cancel
  execute $ddl15$
    create or replace function analytics.production_order_cancel(
      p_shop_id             uuid,
      p_production_order_id uuid,
      p_reason              text default null
    )
     returns jsonb
     language plpgsql
     security definer
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body15$
    declare
      v_order analytics.production_order%rowtype;
    begin
      if p_shop_id is null or p_production_order_id is null then
        raise exception 'production_order_cancel: p_shop_id and p_production_order_id are required';
      end if;
      perform analytics.crm_require_owner_admin(p_shop_id);

      select * into v_order from analytics.production_order
        where id = p_production_order_id and shop_id = p_shop_id
        for update;
      if not found then
        raise exception 'production_order_cancel: ไม่พบใบผลิต % ในร้านนี้', p_production_order_id using errcode = '22023';
      end if;

      if v_order.status = 'cancelled' then
        return jsonb_build_object('production_order_id', p_production_order_id, 'po_no', v_order.po_no,
          'status', v_order.status, 'already_cancelled', true);
      end if;

      if v_order.status = 'done' then
        raise exception 'production_order_cancel: ใบ % ผลิตเสร็จไปแล้ว (done) ยกเลิกไม่ได้ — สต็อกผิดแก้ที่ /stock, ต้นทุนผิดแก้ที่ /catalog แทน', v_order.po_no using errcode = '22023';
      end if;

      update analytics.production_order
         set status = 'cancelled', cancelled_at = now(), cancel_reason = nullif(btrim(p_reason), '')
       where id = p_production_order_id;

      return jsonb_build_object('production_order_id', p_production_order_id, 'po_no', v_order.po_no,
        'status', 'cancelled', 'already_cancelled', false);
    end;
    $body15$;

    revoke execute on function analytics.production_order_cancel(uuid, uuid, text) from public, anon, authenticated;
    grant execute on function analytics.production_order_cancel(uuid, uuid, text) to service_role;
  $ddl15$;

  -- §14 views + §15 grants
  execute $ddl16$
    create or replace view analytics.v_production_order
      with (security_invoker = true) as
    select
      po.id, po.shop_id, po.po_no, po.status, po.note, po.spot_override_thb_per_gram,
      po.done_at, po.cancelled_at, po.cancel_reason, po.created_by, po.created_at, po.updated_at,
      coalesce(i.item_count, 0)         as item_count,
      coalesce(i.qty_planned_total, 0)  as qty_planned_total,
      coalesce(i.qty_done_total, 0)     as qty_done_total
    from analytics.production_order po
    left join (
      select production_order_id, count(*) as item_count,
        sum(qty_planned) as qty_planned_total, sum(qty_done) as qty_done_total
      from analytics.production_order_item
      group by production_order_id
    ) i on i.production_order_id = po.id;

    grant select on analytics.v_production_order to service_role;

    create or replace view analytics.v_production_order_item
      with (security_invoker = true) as
    select
      poi.id, poi.shop_id, poi.production_order_id, po.po_no, po.status as order_status,
      poi.product_id, p.sku, p.name as product_name, p.cost_type as current_cost_type,
      p.unit_cost as current_unit_cost, poi.qty_planned, poi.qty_done,
      poi.unit_cost as stamped_unit_cost, poi.prev_cost_type, poi.prev_unit_cost,
      poi.created_at, poi.updated_at
    from analytics.production_order_item poi
    join analytics.production_order po on po.id = poi.production_order_id
    join public.product p on p.id = poi.product_id;

    grant select on analytics.v_production_order_item to service_role;

    grant select on analytics.production_order      to service_role;
    grant select on analytics.production_order_item to service_role;
  $ddl16$;

  v_log := v_log || '[Part 0] apply 0131 DDL verbatim: OK (no error)' || E'\n';

  -----------------------------------------------------------------------
  -- Part 1: setup — 2 shop สังเคราะห์ + SKU ทดสอบ
  -----------------------------------------------------------------------
  insert into public.shop (id, name) values (v_shop_id, 'ZZ TEST verify-0131 A');
  insert into public.shop (id, name) values (v_shop_id_other, 'ZZ TEST verify-0131 B');

  v_p_fixed        := analytics.product_upsert(v_shop_id, 'ZZPO-FIX-1', 'ทดสอบ fixed', null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_spot         := analytics.product_upsert(v_shop_id, 'ZZPO-SPOT-1', 'ทดสอบ spot', null, 'spot', null, 10, 0.925, 20, null, null, null, null, true);
  v_p_spot_noprice := analytics.product_upsert(v_shop_id, 'ZZPO-SPOT-NOPRICE', 'ทดสอบ spot ไม่มีราคา', null, 'spot', null, 5, 0.925, 10, null, null, null, null, true);
  v_p_disabled     := analytics.product_upsert(v_shop_id, 'ZZPO-DISABLED', 'ทดสอบปิดใช้งาน', null, 'fixed', 50, null, null, null, null, null, null, null, false);
  v_p_live         := analytics.product_upsert(v_shop_id, 'LIVE-TEST-1', 'ทดสอบ live sku', null, 'fixed', 50, null, null, null, null, null, null, null, true);
  v_p_other_shop   := analytics.product_upsert(v_shop_id_other, 'ZZPO-OTHERSHOP', 'ทดสอบร้านอื่น', null, 'fixed', 50, null, null, null, null, null, null, null, true);
  v_p_pretracked   := analytics.product_upsert(v_shop_id, 'ZZPO-PRETRACKED', 'ทดสอบ tracked มาก่อน', null, 'fixed', 80, null, null, null, null, null, null, null, true);
  v_p_rename       := analytics.product_upsert(v_shop_id, 'ZZPO-RENAME-1', 'ทดสอบ rename เป็น live หลังใส่ในใบ', null, 'fixed', 60, null, null, null, null, null, null, null, true);

  -- จำลอง SKU ที่ track_stock=true มาก่อนแล้ว (เคยเปิดผ่านทางอื่นในอดีต) —
  -- P1a ยังไม่มี toggle มือ (P1.5) จึง raw-update ตรงเพื่อสร้างสภาวะทดสอบ
  update public.product set track_stock = true, track_stock_since = '2026-08-01'::date
    where id = v_p_pretracked;

  -- ให้มีราคาเงินของวันนี้สำหรับ v_shop_id (ไม่ทำให้ v_shop_id_other เพราะไม่ใช้)
  perform analytics.oem_metal_price_set(v_shop_id, 'silver', 70, (now() at time zone 'Asia/Bangkok')::date, 'manual');

  v_log := v_log || '[Part 1] setup shops+products: OK' || E'\n';

  -----------------------------------------------------------------------
  -- T1: จำนวนติดลบ/NaN/เกินเพดาน ที่ item_set (สร้างใบเปล่าก่อน)
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop_id, null, 'ใบทดสอบ T1', null);
  v_order_id := (v_res ->> 'id')::uuid;

  v_caught := false;
  begin
    perform analytics.production_order_item_set(v_shop_id, v_order_id, v_p_fixed, -5);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T1a] qty_planned=-5 raise: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  v_caught := false;
  begin
    perform analytics.production_order_item_set(v_shop_id, v_order_id, v_p_fixed, 'NaN'::int);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T1b] qty_planned=NaN raise (พังตั้งแต่ cast int): %s\n', case when v_caught then 'OK' else 'FAIL' end);

  v_caught := false;
  begin
    perform analytics.production_order_item_set(v_shop_id, v_order_id, v_p_fixed, 999999);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T1c] qty_planned=999999 (เกินเพดาน 100000) raise: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T2: SKU คนละร้าน
  -----------------------------------------------------------------------
  v_caught := false;
  begin
    perform analytics.production_order_item_set(v_shop_id, v_order_id, v_p_other_shop, 5);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T2] item_set ข้าม shop raise: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T3: SKU live* ที่ item_set
  -----------------------------------------------------------------------
  v_caught := false;
  begin
    perform analytics.production_order_item_set(v_shop_id, v_order_id, v_p_live, 5);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T3] item_set SKU live* raise: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T4: SKU ปิดใช้งาน
  -----------------------------------------------------------------------
  v_caught := false;
  begin
    perform analytics.production_order_item_set(v_shop_id, v_order_id, v_p_disabled, 5);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T4] item_set SKU ปิดใช้งาน raise: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T5: SKU ซ้ำในใบ — direct insert บายพาส item_set ต้องชน unique constraint
  -----------------------------------------------------------------------
  perform analytics.production_order_item_set(v_shop_id, v_order_id, v_p_fixed, 5);

  v_caught := false;
  begin
    insert into analytics.production_order_item (production_order_id, product_id, qty_planned)
    values (v_order_id, v_p_fixed, 3);
  exception when unique_violation then v_caught := true;
  end;
  v_log := v_log || format('[T5] direct insert SKU ซ้ำในใบ (bypass item_set) ชน unique_violation: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  -- sanity: item_set เรียกซ้ำ = upsert (ไม่ใช่แถวใหม่)
  perform analytics.production_order_item_set(v_shop_id, v_order_id, v_p_fixed, 8);
  if (select count(*) from analytics.production_order_item where production_order_id = v_order_id and product_id = v_p_fixed) = 1
     and (select qty_planned from analytics.production_order_item where production_order_id = v_order_id and product_id = v_p_fixed) = 8 then
    v_log := v_log || '[T5b] item_set upsert (qty อัปเดต ไม่สร้างแถวใหม่): OK' || E'\n';
  else
    v_log := v_log || '[T5b] item_set upsert: FAIL' || E'\n';
  end if;

  -----------------------------------------------------------------------
  -- T6: spot แต่ไม่มีน้ำหนัก (จำลองด้วย raw update ให้ silver_weight_g เป็น null
  -- — product_upsert เองปฏิเสธสร้างแบบนี้ตรงๆ อยู่แล้ว ต้อง bypass เพื่อทดสอบ
  -- แถวที่หลุดมาจากทางอื่น)
  -----------------------------------------------------------------------
  update public.product set silver_weight_g = null where id = v_p_spot_noprice;

  v_caught := false;
  begin
    perform analytics.production_cost_calc(v_shop_id, v_p_spot_noprice, 70);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T6] production_cost_calc SKU spot ไม่มีน้ำหนัก raise: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T7: ราคาเงินวันนี้ไม่มีและไม่มี override (shop อื่นไม่มี oem_metal_price เลย)
  -----------------------------------------------------------------------
  v_caught := false;
  begin
    perform analytics.production_spot_resolve(v_shop_id_other, null);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T7] production_spot_resolve ไม่มีราคาวันนี้+ไม่มี override raise: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  -- override ชนะแม้ไม่มีราคาวันนี้เลย
  if analytics.production_spot_resolve(v_shop_id_other, 90) = 90 then
    v_log := v_log || '[T7b] override ใช้ได้แม้ shop ไม่มีราคาวันนี้เลย: OK' || E'\n';
  else
    v_log := v_log || '[T7b] override: FAIL' || E'\n';
  end if;

  -----------------------------------------------------------------------
  -- T8: override นอกช่วง 5-500
  -----------------------------------------------------------------------
  v_caught := false;
  begin
    perform analytics.production_order_save(v_shop_id, null, 'T8 override สูงเกิน', 501);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T8a] production_order_save override=501 raise: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  v_caught := false;
  begin
    perform analytics.production_order_save(v_shop_id, null, 'T8 override ต่ำเกิน', 4);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T8b] production_order_save override=4 raise: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  v_res := analytics.production_order_save(v_shop_id, null, 'T8 override ปกติ', 100);
  if (v_res ->> 'spot_override_thb_per_gram')::numeric = 100 then
    v_log := v_log || '[T8c] production_order_save override=100 ผ่าน: OK' || E'\n';
  else
    v_log := v_log || '[T8c] production_order_save override=100: FAIL' || E'\n';
  end if;

  -----------------------------------------------------------------------
  -- T9: ใบว่าง (ไม่มีรายการเลย) → done raise
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop_id, null, 'T9 ใบว่าง', null);
  v_order_id2 := (v_res ->> 'id')::uuid;

  v_caught := false;
  begin
    perform analytics.production_order_done(v_shop_id, v_order_id2, null);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T9] done บนใบว่าง (ไม่มีรายการ) raise: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  -- เติมรายการแล้วสั่ง qty_done=0 ทุกบรรทัด → "ทุกบรรทัดเป็น 0"
  perform analytics.production_order_item_set(v_shop_id, v_order_id2, v_p_fixed, 5);
  v_caught := false;
  begin
    perform analytics.production_order_done(v_shop_id, v_order_id2,
      jsonb_build_array(jsonb_build_object('product_id', v_p_fixed, 'qty_done', 0)));
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T9b] done ทุกบรรทัดผลิตได้ 0 ชิ้น raise: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T10 (ต้อง "ไม่พัง"): done บน SKU ที่ยังไม่มีแถว central_stock เลย
  -----------------------------------------------------------------------
  if not exists (select 1 from public.central_stock where product_id = v_p_fixed) then
    v_log := v_log || '[T10 pre] v_p_fixed ยังไม่มีแถว central_stock (ตามคาด): OK' || E'\n';
  else
    v_log := v_log || '[T10 pre] v_p_fixed มีแถว central_stock อยู่แล้ว (ไม่ตรงสมมติฐานทดสอบ): FAIL' || E'\n';
  end if;

  select count(*) into v_before_ledger_count from public.stock_ledger where product_id = v_p_fixed;

  v_res := analytics.production_order_done(v_shop_id, v_order_id, null); -- ใบ T1-T5 มี v_p_fixed qty_planned=8

  select count(*) into v_after_ledger_count from public.stock_ledger where product_id = v_p_fixed;
  select qty_on_hand into v_after_qty_on_hand from public.central_stock where product_id = v_p_fixed;

  if v_after_ledger_count = v_before_ledger_count + 1 and v_after_qty_on_hand = 8 then
    v_log := v_log || format('[T10] done สร้าง central_stock เอง + ledger 1 แถว + qty_on_hand=8: OK (ledger %s→%s, qty_on_hand=%s)\n', v_before_ledger_count, v_after_ledger_count, v_after_qty_on_hand);
  else
    v_log := v_log || format('[T10] done ensure central_stock: FAIL (ledger %s→%s, qty_on_hand=%s ควรเป็น 8)\n', v_before_ledger_count, v_after_ledger_count, v_after_qty_on_hand);
  end if;

  if (select cost_type from public.product where id = v_p_fixed) = 'fixed'
     and (select unit_cost from public.product where id = v_p_fixed) = 100
     and (select track_stock from public.product where id = v_p_fixed) = true
     and (select track_stock_since from public.product where id = v_p_fixed) = (now() at time zone 'Asia/Bangkok')::date then
    v_log := v_log || '[T10b] stamp cost_type=fixed/unit_cost=100/track_stock=true/track_stock_since=วันนี้: OK' || E'\n';
  else
    v_log := v_log || '[T10b] stamp ต้นทุน/สต็อก: FAIL' || E'\n';
  end if;

  -----------------------------------------------------------------------
  -- T11 (ต้อง "ไม่พัง"): done บน SKU ที่ track_stock=true อยู่แล้ว →
  -- track_stock_since ต้องไม่ถูกเลื่อน
  -----------------------------------------------------------------------
  select track_stock_since into v_track_since_before from public.product where id = v_p_pretracked;

  v_res := analytics.production_order_save(v_shop_id, null, 'T11 pretracked', null);
  v_order_id3 := (v_res ->> 'id')::uuid;
  perform analytics.production_order_item_set(v_shop_id, v_order_id3, v_p_pretracked, 3);
  perform analytics.production_order_done(v_shop_id, v_order_id3, null);

  select track_stock_since into v_track_since_after from public.product where id = v_p_pretracked;

  if v_track_since_after = v_track_since_before and v_track_since_before = '2026-08-01'::date then
    v_log := v_log || format('[T11] track_stock_since ไม่ถูกเลื่อน (%s ไม่เปลี่ยน): OK\n', v_track_since_before);
  else
    v_log := v_log || format('[T11] track_stock_since: FAIL (%s → %s)\n', v_track_since_before, v_track_since_after);
  end if;

  -----------------------------------------------------------------------
  -- T12: cost formula ถูกต้อง (spot) + override ชนะราคาวันนี้
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop_id, null, 'T12 spot cost', null);
  perform analytics.production_order_item_set(v_shop_id, (v_res ->> 'id')::uuid, v_p_spot, 2);
  v_res := analytics.production_order_done(v_shop_id, (v_res ->> 'id')::uuid, null);
  -- คาด: 10 * 70 * 0.925 + 20 = 647.5 + 20 = 667.5 (ราคาวันนี้ = 70 จาก Part 1)
  if (select unit_cost from public.product where id = v_p_spot) = 667.5 then
    v_log := v_log || '[T12] spot cost formula (10*70*0.925+20=667.5) ตรงกับ 0028: OK' || E'\n';
  else
    v_log := v_log || format('[T12] spot cost formula: FAIL (ได้ %s คาด 667.5)\n', (select unit_cost from public.product where id = v_p_spot));
  end if;

  -----------------------------------------------------------------------
  -- T13: done ซ้ำ (idempotent, ไม่ raise, ไม่เพิ่ม ledger ซ้ำ)
  -----------------------------------------------------------------------
  select count(*) into v_before_ledger_count from public.stock_ledger where product_id = v_p_fixed;
  select qty_on_hand into v_before_qty_on_hand from public.central_stock where product_id = v_p_fixed;

  v_caught := false;
  begin
    v_res := analytics.production_order_done(v_shop_id, v_order_id, null);
  exception when others then v_caught := true;
  end;

  select count(*) into v_after_ledger_count from public.stock_ledger where product_id = v_p_fixed;
  select qty_on_hand into v_after_qty_on_hand from public.central_stock where product_id = v_p_fixed;

  if not v_caught and (v_res ->> 'already_done')::boolean = true
     and v_after_ledger_count = v_before_ledger_count and v_after_qty_on_hand = v_before_qty_on_hand then
    v_log := v_log || '[T13] done ซ้ำ: idempotent (ไม่ raise, already_done=true, ledger/qty ไม่ขยับ): OK' || E'\n';
  else
    v_log := v_log || format('[T13] done ซ้ำ: FAIL (raised=%s, ledger %s→%s, qty %s→%s)\n', v_caught, v_before_ledger_count, v_after_ledger_count, v_before_qty_on_hand, v_after_qty_on_hand);
  end if;

  -----------------------------------------------------------------------
  -- T14: done+cancel ชนกัน (ทั้งสองทาง) + cancel ซ้ำ idempotent
  -----------------------------------------------------------------------
  v_caught := false;
  begin
    perform analytics.production_order_cancel(v_shop_id, v_order_id, null); -- v_order_id เป็น done แล้ว
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T14a] cancel ใบที่ done แล้ว raise: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  v_res := analytics.production_order_save(v_shop_id, null, 'T14 cancel then done', null);
  perform analytics.production_order_item_set(v_shop_id, (v_res ->> 'id')::uuid, v_p_fixed, 1);
  perform analytics.production_order_cancel(v_shop_id, (v_res ->> 'id')::uuid, 'ทดสอบยกเลิก');

  v_caught := false;
  begin
    perform analytics.production_order_done(v_shop_id, (v_res ->> 'id')::uuid, null);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T14b] done ใบที่ cancelled แล้ว raise: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  v_caught := false;
  begin
    v_res := analytics.production_order_cancel(v_shop_id, (v_res ->> 'id')::uuid, null);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T14c] cancel ซ้ำ (cancelled อยู่แล้ว) idempotent ไม่ raise: %s\n', case when not v_caught then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T15: แก้ใบที่ปิดแล้วผ่าน service key ตรงๆ (bypass RPC ทั้งหมด)
  -----------------------------------------------------------------------
  v_caught := false;
  begin
    update analytics.production_order set note = 'hacked' where id = v_order_id; -- v_order_id = done แล้ว
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T15a] direct UPDATE ใบที่ done แล้ว raise: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  v_caught := false;
  begin
    delete from analytics.production_order where id = v_order_id;
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T15b] direct DELETE ใบที่ done แล้ว raise: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  select id into v_item_id from analytics.production_order_item where production_order_id = v_order_id and product_id = v_p_fixed;
  v_caught := false;
  begin
    update analytics.production_order_item set qty_done = 999 where id = v_item_id;
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T15c] direct UPDATE item ของใบที่ done แล้ว raise: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  v_caught := false;
  begin
    delete from analytics.production_order_item where id = v_item_id;
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T15d] direct DELETE item ของใบที่ done แล้ว raise: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T16: SKU live* ตอน done (เผื่อ rename หลังใส่ในใบไปแล้ว) — ใส่ SKU ปกติ
  -- เข้าใบตอนยังไม่ใช่ live* แล้ว raw-rename เป็น live* ก่อนกด done
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop_id, null, 'T16 live rename', null);
  v_order_id4 := (v_res ->> 'id')::uuid;
  perform analytics.production_order_item_set(v_shop_id, v_order_id4, v_p_rename, 4);

  update public.product set sku = 'LIVE-RENAMED-1' where id = v_p_rename;

  v_caught := false;
  begin
    perform analytics.production_order_done(v_shop_id, v_order_id4, null);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T16] done บน SKU ที่ถูก rename เป็น live* หลังใส่ในใบไปแล้ว raise: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  -- เปลี่ยนกลับเป็น SKU ปกติ แล้วยกเลิกใบทิ้ง (ปิด loop ของ T16 ให้สะอาด แม้
  -- ทั้งไฟล์จะ rollback อยู่แล้วก็ตาม — กันสับสนถ้ามีคนอ่าน log กลางทาง)
  update public.product set sku = 'ZZPO-RENAME-1' where id = v_p_rename;
  perform analytics.production_order_cancel(v_shop_id, v_order_id4, 'ปิดเคสทดสอบ T16');

  -----------------------------------------------------------------------
  -- T17: staff (ไม่ใช่ owner/admin) เรียก RPC ตรง — ทดสอบ "ตัว logic" ของ
  -- crm_require_owner_admin เมื่อ auth.role()/auth.uid() รายงานเป็นผู้ใช้
  -- authenticated ที่ไม่ใช่ owner/admin ของร้าน (override เฉพาะ JWT claims,
  -- **ไม่** SET ROLE จริง — ถ้า SET ROLE authenticated จริง จะไปชน
  -- "permission denied for schema analytics" ก่อน (0123 ปิด USAGE ทั้ง schema
  -- ไปแล้ว) ซึ่งพิสูจน์แค่ grant ไม่ได้พิสูจน์ตัว membership-check logic)
  -- ⚠️ ไม่ครอบคลุม "staff เรียก 8 RPC ใหม่ในไฟล์นี้ตรงๆ" อย่างสมบูรณ์ เพราะ
  -- authenticated ไม่มี EXECUTE บน RPC เหล่านั้นเลย (revoke ไปแล้ว) การเรียกจริง
  -- จะไปชน permission-denied ระดับ grant ก่อนถึง logic ข้างในเสมอ ⇒ เคสนี้ต้อง
  -- บังคับจริงที่ชั้น server action (P1b) ที่เช็ค session role ก่อนเรียก
  -- service client — ดูสรุปที่ส่ง Tech Lead
  -----------------------------------------------------------------------
  v_caught := false;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', gen_random_uuid()::text)::text, true);
    perform analytics.crm_require_owner_admin(v_shop_id); -- ไม่มี shop_member แถวไหนผูก uid นี้เลย
  exception when others then
    v_caught := true;
  end;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_log := v_log || format('[T17] crm_require_owner_admin ปฏิเสธ authenticated ที่ไม่ใช่ owner/admin ของร้าน: %s\n', case when v_caught then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T18: anon/authenticated เรียก 8 RPC ผ่าน REST ไม่ได้ (grant metadata) +
  -- service_role เรียกได้ + ไม่มี overload (pg_proc นับได้ 1 แถวต่อชื่อ)
  -----------------------------------------------------------------------
  declare
    v_fn_sigs text[] := array[
      'production_order_save(uuid,uuid,text,numeric)',
      'production_order_item_set(uuid,uuid,uuid,int)',
      'production_order_item_remove(uuid,uuid,uuid)',
      'production_cost_calc(uuid,uuid,numeric)',
      'production_spot_resolve(uuid,numeric)',
      'production_order_preview(uuid,uuid)',
      'production_order_done(uuid,uuid,jsonb)',
      'production_order_cancel(uuid,uuid,text)'
    ];
    v_sig text;
    v_all_ok boolean := true;
    v_bad text := '';
  begin
    foreach v_sig in array v_fn_sigs loop
      select has_function_privilege('anon', 'analytics.' || v_sig, 'execute') into v_priv_anon;
      select has_function_privilege('authenticated', 'analytics.' || v_sig, 'execute') into v_priv_auth;
      select has_function_privilege('service_role', 'analytics.' || v_sig, 'execute') into v_priv_svc;

      if v_priv_anon is distinct from false or v_priv_auth is distinct from false or v_priv_svc is distinct from true then
        v_all_ok := false;
        v_bad := v_bad || format('%s(anon=%s,auth=%s,svc=%s) ', v_sig, v_priv_anon, v_priv_auth, v_priv_svc);
      end if;

      select count(*) into v_fn_count from pg_proc
        where pronamespace = 'analytics'::regnamespace
          and proname = split_part(v_sig, '(', 1);
      if v_fn_count <> 1 then
        v_all_ok := false;
        v_bad := v_bad || format('%s overload_count=%s ', v_sig, v_fn_count);
      end if;
    end loop;

    if v_all_ok then
      v_log := v_log || '[T18] ทั้ง 8 RPC: anon=false, authenticated=false, service_role=true, ไม่มี overload: OK' || E'\n';
    else
      v_log := v_log || format('[T18] FAIL: %s\n', v_bad);
    end if;
  end;

  -- ตารางหลัก/view: authenticated ต้องไม่มีสิทธิ์เลย (สอดคล้อง 0123/0124),
  -- service_role มีสิทธิ์ select
  select has_table_privilege('authenticated', 'analytics.production_order', 'select') into v_priv_auth;
  select has_table_privilege('service_role', 'analytics.production_order', 'select') into v_priv_svc;
  if v_priv_auth is distinct from false or v_priv_svc is distinct from true then
    v_log := v_log || format('[T18b] FAIL: production_order authenticated=%s service_role=%s (คาด false/true)\n', v_priv_auth, v_priv_svc);
  else
    v_log := v_log || '[T18b] production_order: authenticated=false, service_role=true: OK' || E'\n';
  end if;

  -----------------------------------------------------------------------
  -- T19: ตัวนับ production_order_counter ขึ้นตามจริง ไม่ข้าม/ไม่ซ้ำ ระหว่าง
  -- ใบทั้งหมดที่สร้างใน v_shop_id ตลอด script นี้ (นับจำนวนใบที่สร้างจริง)
  -----------------------------------------------------------------------
  select last_no into v_after_counter from analytics.production_order_counter where shop_id = v_shop_id;
  select count(*) into v_fn_count from analytics.production_order where shop_id = v_shop_id;
  if v_after_counter = v_fn_count then
    v_log := v_log || format('[T19] production_order_counter.last_no (%s) = จำนวนใบที่สร้างจริง (%s) ในร้านนี้: OK\n', v_after_counter, v_fn_count);
  else
    v_log := v_log || format('[T19] production_order_counter: FAIL (last_no=%s, จำนวนใบจริง=%s)\n', v_after_counter, v_fn_count);
  end if;

  -----------------------------------------------------------------------
  -- สรุปเคสที่ครอบ/ไม่ครอบ (20 เคสจาก design) — ดูรายละเอียดในสรุปงานที่ส่ง
  -- Tech Lead ด้วย ไม่ใช่แค่ในไฟล์นี้:
  --   ครอบแล้ว: T1(qty ลบ/NaN/เกินเพดาน) T2(คนละร้าน) T3(live ตอนใส่)
  --   T4(ปิดใช้งาน) T5(SKU ซ้ำในใบ) T6(spot ไม่มีน้ำหนัก) T7(ไม่มีราคาวันนี้+
  --   ไม่มี override) T8(override นอกช่วง) T9(ใบว่าง/ทุกบรรทัดเป็น 0)
  --   T10(ไม่พัง: ensure central_stock) T11(ไม่พัง: track_stock_since ไม่เลื่อน)
  --   T12(สูตรต้นทุนตรง 0028) T13(done ซ้ำ idempotent) T14(done/cancel ชนกัน)
  --   T15(แก้ใบปิดผ่าน service key ตรงๆ) T16(live ตอน done) T18(anon/
  --   authenticated เรียก RPC ผ่าน REST ไม่ได้ + ไม่มี overload) T19(ตัวนับไม่ข้าม/ซ้ำ)
  --   ครอบแบบมีข้อจำกัด: T17 (พิสูจน์ตัว logic ของ crm_require_owner_admin
  --   ปฏิเสธ staff ได้จริง แต่ "staff เรียก 8 RPC ใหม่ตรงๆ" ที่แท้ต้องบังคับที่
  --   server action ของ P1b เพราะ RPC ล็อก service_role-only ทั้งหมด — ไม่มี
  --   ทาง DB-level ให้ authenticated เรียกถึง logic นั้นได้ตั้งแต่แรก)
  --   ไม่ได้ครอบ: "หน้า OEM ทั้งหมดทำงานเหมือนเดิม" (โครงสร้าง ไม่ใช่ DB test —
  --   ยืนยันด้วย grep ว่า 0131 ไม่แตะไฟล์ OEM เลยแทน)
  -----------------------------------------------------------------------

  v_log := v_log || E'\n=== ALL CHECKS LOGGED ABOVE — ตรวจทุกบรรทัดหา FAIL (transaction จะ rollback เสมอ) ===\n';
  raise exception '%', v_log;
end $$;

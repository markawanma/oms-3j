-- scripts/verify-0132.sql
--
-- Self-contained verify script for supabase/migrations/0132_production_order_security_fixes.sql
-- (ปิด 3 finding security review 18 ก.ย. 69: M1 ราคาเงินเลื่อนได้ระหว่าง
-- preview/done · M2 ลบ override/หมายเหตุทิ้งไม่ได้ · M4 ไม่รู้ว่าใครกด).
-- Per skill 3j-migration-traps #11: ทุกอย่างรันใน do $$ ... $$ block เดียว
-- จบด้วย `raise exception` เสมอ ⇒ ทั้ง transaction rollback ไม่ว่าผลจะผ่าน/
-- ไม่ผ่าน — อ่านผลจาก error message นี้.
--
-- ใช้เป็นทั้ง dry-run (รันก่อน apply 0132 จริง — Part 0 ติดตั้ง 2 ฟังก์ชันใหม่
-- ชั่วคราวในทรานแซคชันนี้เท่านั้น) และ post-apply verify (รันซ้ำหลัง apply
-- จริงผ่าน MCP apply_migration — Part 0 แค่ redefine ซ้ำ ผลเหมือนเดิม)
--
-- ⚠️ แตะต้นทุนที่ล็อกถาวร + สต็อก + ledger (💰) — ทดสอบด้วย shop/product
-- สังเคราะห์ที่สร้างขึ้นในทรานแซคชันนี้เอง ไม่แตะ shop/SKU จริงเลย
-- (3j-migration-traps ข้อ 11). ข้อยกเว้นเดียว: T8/T9 (p_actor) ต้องการ uuid ที่
-- มีแถวจริงใน auth.users (FK ของ production_order.created_by) — ตัดสินใจ
-- **อ่านอย่างเดียว** (`select id from auth.users limit 1`) แทนการ insert แถว
-- สังเคราะห์เข้า auth.users (ตารางที่ GoTrue/Supabase Auth จัดการเอง — แตะตรงๆ
-- แม้ในทรานแซคชันที่ rollback ก็มีความเสี่ยงชน trigger/logic ภายในที่ไม่รู้จัก
-- ที่ไม่คุ้มความเสี่ยงเทียบกับที่ต้องการแค่ uuid ใดๆ ที่ FK ผ่าน) ทั้งคู่ skip
-- ตัวเองอย่างปลอดภัยถ้าไม่พบแถวเลย (ไม่ fail ทั้ง script)
--
-- ห้าม reuse SKU เดียวกันข้ามเคส "done สำเร็จ" หลายเคส — production_order_done
-- ที่สำเร็จ flip product.cost_type 'spot'→'fixed' ถาวร (มติเจ้าของ §Q1, 0131)
-- ⇒ ถ้าใช้ SKU spot ตัวเดียวกันซ้ำ เคสถัดไปจะไม่ได้ทดสอบเส้นทาง spot จริง
-- (v_needs_spot จะกลายเป็น false เงียบๆ) — ไฟล์นี้จึงสร้าง SKU spot แยกตัวต่อ
-- เคสที่คาดว่า done จะ "สำเร็จ" (T1, T3) ส่วน T2 (คาด raise ก่อนถึงจุด mutate
-- เลย) ใช้ SKU แยกเองเช่นกันเพื่อความชัดเจน แม้จะไม่ถูก flip จริงก็ตาม
--
-- ห้ามใช้ created_at เรียงหา "แถวล่าสุด" ของ analytics.catalog_audit_log —
-- now() คงที่ตลอดทั้งทรานแซคชัน (transaction_timestamp semantics) ⇒ ทุกแถวที่
-- insert ในสคริปต์นี้มี created_at เท่ากันหมด เรียง desc แล้วสุ่มได้ตัวไหนก็ได้
-- ⇒ T9 ใช้ SKU ที่ไม่เคยผ่าน done มาก่อนเลยในสคริปต์นี้ (เกิด audit log แถวเดียว
-- ทั้งหมด กรองด้วย product_id ตัวเดียวก็ได้แถวที่ถูกต้องเป๊ะ ไม่ต้องพึ่งลำดับเวลา)

do $$
declare
  v_log text := E'\n=== verify 0132 (production_order security fixes: M1/M2/M4) ===\n';

  v_shop_id uuid := gen_random_uuid();

  v_p_fixed        uuid; -- cost_type=fixed, unit_cost=100 — ใช้ซ้ำได้ในหลายเคส (ค่าไม่ดริฟต์)
  v_p_spot_t1      uuid; -- cost_type=spot — ใช้เฉพาะ T1 (คาด done สำเร็จ)
  v_p_spot_t2      uuid; -- cost_type=spot — ใช้เฉพาะ T2 (คาด raise ก่อน mutate)
  v_p_spot_t3      uuid; -- cost_type=spot — ใช้เฉพาะ T3 (คาด done สำเร็จ)
  v_p_actor_audit  uuid; -- cost_type=fixed — ใช้เฉพาะ T9 (ต้องมี audit log แถวเดียวชัวร์)

  v_spot_price numeric := 70; -- ราคาเงินสังเคราะห์ของวันนี้ (setup ด้วย oem_metal_price_set)

  v_order_id uuid;
  v_res      jsonb;

  v_actor_id        uuid;
  v_row_created_by  uuid;
  v_row_changed_by  uuid;
  v_row_note        text;
  v_row_spot_override numeric;
  v_row_status      text;

  v_ledger_before int;
  v_ledger_after  int;

  v_priv_anon boolean;
  v_priv_auth boolean;
  v_priv_svc  boolean;
  v_fn_count  int;
  v_caught    boolean;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -----------------------------------------------------------------------
  -- Part 0: apply 0132's DDL verbatim (2 ฟังก์ชันเท่านั้น) ในทรานแซคชันนี้
  -----------------------------------------------------------------------

  -- analytics.production_order_done — เพิ่ม p_expected_spot_thb_per_gram (M1)
  -- + p_actor (M4)
  execute $ddl_done$
    drop function if exists analytics.production_order_done(uuid, uuid, jsonb);

    create or replace function analytics.production_order_done(
      p_shop_id             uuid,
      p_production_order_id uuid,
      p_items               jsonb default null,
      p_expected_spot_thb_per_gram numeric default null,
      p_actor               uuid default null
    )
     returns jsonb
     language plpgsql
     security definer
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body_done$
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

      if v_needs_spot and p_expected_spot_thb_per_gram is not null then
        if not (abs(v_spot - p_expected_spot_thb_per_gram) <= 0.0001) then
          raise exception 'production_order_done: ราคาเงินเปลี่ยนไประหว่างที่เปิดหน้าต่างนี้ค้างไว้ (ตอนเปิดหน้าต่างเห็นราคา % บาท/กรัม แต่ตอนนี้ระบบคำนวณได้ % บาท/กรัม) — ปิดหน้าต่างยืนยันนี้แล้วเปิดใบผลิตใหม่อีกครั้งเพื่อดูราคาล่าสุดก่อนยืนยัน', p_expected_spot_thb_per_gram, v_spot using errcode = '22023';
        end if;
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
        values (p_shop_id, v_product.id, v_product.sku, 'edit', v_before, v_after, coalesce(p_actor, auth.uid()));
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
    $body_done$;

    revoke execute on function analytics.production_order_done(uuid, uuid, jsonb, numeric, uuid) from public, anon, authenticated;
    grant execute on function analytics.production_order_done(uuid, uuid, jsonb, numeric, uuid) to service_role;
  $ddl_done$;

  -- analytics.production_order_save — เพิ่ม p_clear_note / p_clear_spot_override
  -- (M2) + p_actor (M4)
  execute $ddl_save$
    drop function if exists analytics.production_order_save(uuid, uuid, text, numeric);

    create or replace function analytics.production_order_save(
      p_shop_id                   uuid,
      p_id                        uuid default null,
      p_note                      text default null,
      p_spot_override_thb_per_gram numeric default null,
      p_clear_note                boolean default false,
      p_clear_spot_override       boolean default false,
      p_actor                     uuid default null
    )
     returns jsonb
     language plpgsql
     security definer
     set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
    as $body_save$
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
        values (p_shop_id, v_seq, nullif(btrim(p_note), ''), p_spot_override_thb_per_gram, coalesce(p_actor, auth.uid()))
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
          note                        = case when p_clear_note then null
                                              else coalesce(nullif(btrim(p_note), ''), note) end,
          spot_override_thb_per_gram  = case when p_clear_spot_override then null
                                              else coalesce(p_spot_override_thb_per_gram, spot_override_thb_per_gram) end,
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
    $body_save$;

    revoke execute on function analytics.production_order_save(uuid, uuid, text, numeric, boolean, boolean, uuid) from public, anon, authenticated;
    grant execute on function analytics.production_order_save(uuid, uuid, text, numeric, boolean, boolean, uuid) to service_role;
  $ddl_save$;

  v_log := v_log || '[Part 0] apply 0132 DDL verbatim (2 ฟังก์ชัน): OK (no error)' || E'\n';

  -----------------------------------------------------------------------
  -- Part 1: setup — shop สังเคราะห์ + SKU ทดสอบแยกตัวต่อเคส "done สำเร็จ"
  -----------------------------------------------------------------------
  insert into public.shop (id, name) values (v_shop_id, 'ZZ TEST verify-0132');

  v_p_fixed       := analytics.product_upsert(v_shop_id, 'ZZPO132-FIX',     'ทดสอบ fixed',            null, 'fixed', 100, null, null, null, null, null, null, null, true);
  v_p_spot_t1     := analytics.product_upsert(v_shop_id, 'ZZPO132-SPOT-T1', 'ทดสอบ spot T1',          null, 'spot', null, 10, 0.925, 20, null, null, null, null, true);
  v_p_spot_t2     := analytics.product_upsert(v_shop_id, 'ZZPO132-SPOT-T2', 'ทดสอบ spot T2',          null, 'spot', null, 10, 0.925, 20, null, null, null, null, true);
  v_p_spot_t3     := analytics.product_upsert(v_shop_id, 'ZZPO132-SPOT-T3', 'ทดสอบ spot T3',          null, 'spot', null, 10, 0.925, 20, null, null, null, null, true);
  v_p_actor_audit := analytics.product_upsert(v_shop_id, 'ZZPO132-ACTOR',   'ทดสอบ actor audit log', null, 'fixed', 50, null, null, null, null, null, null, null, true);

  perform analytics.oem_metal_price_set(v_shop_id, 'silver', v_spot_price, (now() at time zone 'Asia/Bangkok')::date, 'manual');

  -- อ่านอย่างเดียว — ดูหมายเหตุหัวไฟล์ (ไม่ insert เข้า auth.users เอง)
  select id into v_actor_id from auth.users limit 1;

  v_log := v_log || format('[Part 1] setup shop+products: OK (v_actor_id=%s, %s)\n',
    v_actor_id, case when v_actor_id is null then 'ไม่พบแถวใน auth.users — T8/T9 จะถูกข้าม' else 'พบแถวจริง ใช้ทดสอบ p_actor ได้' end);

  -----------------------------------------------------------------------
  -- T1: p_expected_spot_thb_per_gram ตรงกับราคาที่ resolve ได้จริง ⇒ ไม่ raise
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop_id, null, 'T1 expected match', null);
  v_order_id := (v_res ->> 'id')::uuid;
  perform analytics.production_order_item_set(v_shop_id, v_order_id, v_p_spot_t1, 5);

  v_caught := false;
  begin
    perform analytics.production_order_done(v_shop_id, v_order_id, null, v_spot_price, null);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T1a] p_expected_spot ตรง (%s) ไม่ raise: %s\n', v_spot_price, case when not v_caught then 'OK' else 'FAIL' end);

  select status into v_row_status from analytics.production_order where id = v_order_id;
  v_log := v_log || format('[T1b] ใบเปลี่ยนเป็น done จริง (status=%s): %s\n', v_row_status, case when v_row_status = 'done' then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T2: p_expected_spot_thb_per_gram ไม่ตรง ⇒ raise ก่อนแตะสต็อก/ต้นทุนเลย
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop_id, null, 'T2 expected mismatch', null);
  v_order_id := (v_res ->> 'id')::uuid;
  perform analytics.production_order_item_set(v_shop_id, v_order_id, v_p_spot_t2, 5);

  v_caught := false;
  begin
    perform analytics.production_order_done(v_shop_id, v_order_id, null, v_spot_price + 1, null);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T2a] p_expected_spot ไม่ตรง (%s แทนที่จะเป็น %s) raise: %s\n', v_spot_price + 1, v_spot_price, case when v_caught then 'OK' else 'FAIL' end);

  select status into v_row_status from analytics.production_order where id = v_order_id;
  v_log := v_log || format('[T2b] ใบยังเป็น open หลัง raise (ไม่มีอะไรถูก stamp): %s\n', case when v_row_status = 'open' then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T3: p_expected_spot_thb_per_gram = null ⇒ ไม่เทียบ ⇒ ไม่ raise
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop_id, null, 'T3 expected null', null);
  v_order_id := (v_res ->> 'id')::uuid;
  perform analytics.production_order_item_set(v_shop_id, v_order_id, v_p_spot_t3, 5);

  v_caught := false;
  begin
    perform analytics.production_order_done(v_shop_id, v_order_id, null, null, null);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T3] p_expected_spot=null ไม่เทียบ ไม่ raise: %s\n', case when not v_caught then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T4: ใบทุกบรรทัดเป็น fixed + p_expected_spot มั่ว ⇒ ต้องไม่ raise
  -- (v_needs_spot=false ⇒ ข้ามการเทียบ M1 ไปเลย)
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop_id, null, 'T4 all fixed + garbage expected', null);
  v_order_id := (v_res ->> 'id')::uuid;
  perform analytics.production_order_item_set(v_shop_id, v_order_id, v_p_fixed, 5);

  v_caught := false;
  begin
    perform analytics.production_order_done(v_shop_id, v_order_id, null, 999999, null);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T4] ใบทุกบรรทัด fixed + expected มั่ว (999999) ไม่ raise: %s\n', case when not v_caught then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T5: p_clear_spot_override = true ⇒ คอลัมน์เป็น null จริง
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop_id, null, 'T5 clear override', 65);
  v_order_id := (v_res ->> 'id')::uuid;

  perform analytics.production_order_save(v_shop_id, v_order_id, null, null, false, true, null);

  select spot_override_thb_per_gram into v_row_spot_override from analytics.production_order where id = v_order_id;
  v_log := v_log || format('[T5] p_clear_spot_override=true ⇒ column เป็น null จริง (ได้ %s): %s\n', v_row_spot_override, case when v_row_spot_override is null then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T6: p_clear_spot_override=false + p_spot_override_thb_per_gram=null ⇒
  -- ค่าเดิมคงอยู่ (regression ของพฤติกรรม coalesce เดิม)
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop_id, null, 'T6 retain override', 65);
  v_order_id := (v_res ->> 'id')::uuid;

  perform analytics.production_order_save(v_shop_id, v_order_id, null, null, false, false, null);

  select spot_override_thb_per_gram into v_row_spot_override from analytics.production_order where id = v_order_id;
  v_log := v_log || format('[T6] p_clear_spot_override=false + override=null ⇒ ค่าเดิม 65 คงอยู่ (ได้ %s): %s\n', v_row_spot_override, case when v_row_spot_override = 65 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T7 (bonus, symmetric กับ T5/T6 — M2 ครอบทั้ง note และ override):
  -- p_clear_note = true ⇒ note เป็น null จริง
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop_id, null, 'T7 หมายเหตุเดิม', null);
  v_order_id := (v_res ->> 'id')::uuid;

  perform analytics.production_order_save(v_shop_id, v_order_id, null, null, true, false, null);

  select note into v_row_note from analytics.production_order where id = v_order_id;
  v_log := v_log || format('[T7] p_clear_note=true ⇒ note เป็น null จริง (ได้ %s): %s\n', coalesce(v_row_note, '(null)'), case when v_row_note is null then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T8: p_actor ⇒ production_order.created_by ได้ค่านั้นจริง
  -----------------------------------------------------------------------
  if v_actor_id is null then
    v_log := v_log || '[T8] SKIPPED: ไม่พบแถวใน auth.users เลยในโปรเจกต์นี้\n';
  else
    v_res := analytics.production_order_save(v_shop_id, null, 'T8 actor', null, false, false, v_actor_id);
    v_order_id := (v_res ->> 'id')::uuid;
    select created_by into v_row_created_by from analytics.production_order where id = v_order_id;
    v_log := v_log || format('[T8] p_actor ⇒ created_by = p_actor จริง: %s\n', case when v_row_created_by = v_actor_id then 'OK' else 'FAIL' end);
  end if;

  -----------------------------------------------------------------------
  -- T9: p_actor ⇒ catalog_audit_log.changed_by ได้ค่านั้นจริง
  -----------------------------------------------------------------------
  if v_actor_id is null then
    v_log := v_log || '[T9] SKIPPED (เหตุผลเดียวกับ T8)\n';
  else
    v_res := analytics.production_order_save(v_shop_id, null, 'T9 actor done', null);
    v_order_id := (v_res ->> 'id')::uuid;
    perform analytics.production_order_item_set(v_shop_id, v_order_id, v_p_actor_audit, 3);
    perform analytics.production_order_done(v_shop_id, v_order_id, null, null, v_actor_id);

    select changed_by into v_row_changed_by from analytics.catalog_audit_log
      where shop_id = v_shop_id and product_id = v_p_actor_audit;
    v_log := v_log || format('[T9] p_actor ⇒ catalog_audit_log.changed_by = p_actor จริง: %s\n', case when v_row_changed_by = v_actor_id then 'OK' else 'FAIL' end);
  end if;

  -----------------------------------------------------------------------
  -- T10 (เคสห้ามพัง): done เรียกแบบไม่ส่ง arg ใหม่เลย (ใช้ default ทั้งหมด)
  -- ⇒ ต้องทำงานเหมือน 0131 เป๊ะ
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop_id, null, 'T10 regression defaults', null);
  v_order_id := (v_res ->> 'id')::uuid;
  perform analytics.production_order_item_set(v_shop_id, v_order_id, v_p_fixed, 7);

  v_caught := false;
  begin
    v_res := analytics.production_order_done(v_shop_id, v_order_id);
  exception when others then v_caught := true;
  end;
  v_log := v_log || format('[T10a] done(shop_id, order_id) — 2 args เดิม (ใช้ default ที่เหลือ) ไม่ raise: %s\n', case when not v_caught then 'OK' else 'FAIL' end);

  select status into v_row_status from analytics.production_order where id = v_order_id;
  v_log := v_log || format('[T10b] สถานะเป็น done จริง: %s\n', case when v_row_status = 'done' then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T11: done ซ้ำ (ใบ done จาก T10 อยู่แล้ว) ⇒ already_done=true, ไม่เพิ่ม ledger
  -----------------------------------------------------------------------
  select count(*) into v_ledger_before from public.stock_ledger where product_id = v_p_fixed;

  v_res := analytics.production_order_done(v_shop_id, v_order_id);

  select count(*) into v_ledger_after from public.stock_ledger where product_id = v_p_fixed;

  v_log := v_log || format('[T11a] done ซ้ำ already_done=%s (คาด true): %s\n', v_res ->> 'already_done', case when (v_res ->> 'already_done')::boolean then 'OK' else 'FAIL' end);
  v_log := v_log || format('[T11b] stock_ledger ไม่เพิ่มแถวใหม่ (ก่อน=%s หลัง=%s): %s\n', v_ledger_before, v_ledger_after, case when v_ledger_before = v_ledger_after then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T12 (เคสห้ามพัง): save เรียกแบบ 4 args เดิม (ไม่ส่ง clear/actor เลย) ⇒
  -- ยังทำงานเหมือน 0131 เป๊ะ (coalesce เดิมยังทำงานเมื่อไม่ส่ง clear flag)
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop_id, null, 'T12 initial', 65);
  v_order_id := (v_res ->> 'id')::uuid;
  v_res := analytics.production_order_save(v_shop_id, v_order_id, 'T12 updated note', null);

  select note, spot_override_thb_per_gram into v_row_note, v_row_spot_override
    from analytics.production_order where id = v_order_id;
  v_log := v_log || format('[T12] save(shop,id,note,override) — 4 args เดิม: note=%s (คาด "T12 updated note"), override=%s (คาดคงเดิม 65): %s\n',
    v_row_note, v_row_spot_override,
    case when v_row_note = 'T12 updated note' and v_row_spot_override = 65 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- T13: grant metadata + ไม่มี overload ค้าง สำหรับ signature ใหม่ทั้งคู่
  -----------------------------------------------------------------------
  declare
    v_fn_sigs text[] := array[
      'production_order_done(uuid,uuid,jsonb,numeric,uuid)',
      'production_order_save(uuid,uuid,text,numeric,boolean,boolean,uuid)'
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
        v_bad := v_bad || format('%s overload_count=%s (คาด 1 — เช็คว่า drop function ทำงานจริงก่อน create or replace) ', v_sig, v_fn_count);
      end if;
    end loop;

    if v_all_ok then
      v_log := v_log || '[T13] production_order_done/save (signature ใหม่): anon=false, authenticated=false, service_role=true, ไม่มี overload ค้าง: OK' || E'\n';
    else
      v_log := v_log || format('[T13] FAIL: %s\n', v_bad);
    end if;
  end;

  -----------------------------------------------------------------------
  -- สรุปเคสที่ครอบ (ดูรายละเอียดเพิ่มเติมในสรุปงานที่ส่ง Tech Lead ด้วย):
  --   T1 (expected ตรง ไม่ raise) T2 (expected ไม่ตรง raise + ใบไม่ขยับ)
  --   T3 (expected=null ไม่เทียบ) T4 (ใบ fixed ล้วน + expected มั่ว ไม่ raise)
  --   T5/T6 (clear_spot_override true/false) T7 (clear_note, bonus)
  --   T8/T9 (p_actor → created_by / catalog_audit_log.changed_by)
  --   T10/T12 (เคสห้ามพัง: เรียกด้วย arg เดิมล้วนๆ ทั้ง done และ save)
  --   T11 (done ซ้ำ idempotent ไม่เพิ่ม ledger) T13 (grant + ไม่มี overload)
  --   ไม่ได้ครอบ: object อื่นในโมดูล (item_set/item_remove/preview/cancel/
  --   views/triggers) เพราะ 0132 ไม่แตะเลย — ยืนยันด้วยการอ่านโค้ด/ diff แทน
  -----------------------------------------------------------------------

  v_log := v_log || E'\n=== ALL CHECKS LOGGED ABOVE — ตรวจทุกบรรทัดหา FAIL (transaction จะ rollback เสมอ) ===\n';
  raise exception '%', v_log;
end $$;

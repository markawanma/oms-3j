-- scripts/verify-0137.sql
--
-- ชุดทดสอบของ supabase/migrations/0137_track_stock_set_idem_fix.sql
-- (ปิด HIGH-1 ของ security review 0135 — idem key ผูกกับยอดเป้าหมาย ⇒ ขายเกิน)
--
-- ตาม skill 3j-migration-traps #11: do $$ ... $$ block เดียว จบด้วย `raise exception`
-- ⇒ rollback เสมอ · ใช้เป็นทั้ง dry-run และ post-apply verify
--
-- ⚠️ แตะ stock ledger จริง (💰) — shop/SKU สังเคราะห์ทั้งหมด ไม่แตะของจริง
--
-- 🔴 หัวใจของไฟล์นี้คือ [H1ก-2] และ [H1ข] — **ทำซ้ำบั๊กจริง** แล้วพิสูจน์ว่าปิด
-- ถ้าเอา 0137 ออกแล้วรันไฟล์นี้ สองบรรทัดนั้นต้อง FAIL ไม่ใช่ผ่าน
--
-- ผลรันจริง 19 ก.ย. 69 (ก่อน apply): ผ่าน 13/13

do $$
declare
  v_log text := E'\n=== verify 0137 (ปิดรูขายเกิน H1 + M4) ===\n';
  v_shop uuid := gen_random_uuid();
  v_pa uuid; v_pb uuid; v_pc uuid;
  v_res jsonb; v_on int; v_rows int; v_caught boolean; v_code text; v_msg text;
  v_def text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into public.shop (id, name) values (v_shop, 'ZZ TEST verify-0137');
  v_pa := analytics.product_upsert(v_shop, 'ZZ137-A', 'ทดสอบ H1(ก)',     null, 'fixed', 10, null, null, null, null, null, null, null, true);
  v_pb := analytics.product_upsert(v_shop, 'ZZ137-B', 'ทดสอบ H1(ข)',     null, 'fixed', 10, null, null, null, null, null, null, null, true);
  v_pc := analytics.product_upsert(v_shop, 'ZZ137-C', 'ทดสอบ regression', null, 'fixed', 10, null, null, null, null, null, null, null, true);

  -----------------------------------------------------------------------
  -- 🔴 H1(ก) เคสขายเกิน — ทำซ้ำบั๊กจริง
  -- มีของ 5 → ตั้ง 0 → ของกลับเข้ามา 5 (ผลิต/รับคืน) → นับได้ 0 อีกครั้ง
  -- ของเดิม: รอบสอง delta = -5 เท่ารอบแรก + คีย์เดิม (เพราะคีย์ผูกกับ target)
  --          ⇒ adjust_stock เห็นว่าเคยใช้คีย์นี้ด้วย delta เดียวกันแล้ว ⇒ คืนเฉยๆ ไม่ apply
  --          ⇒ on_hand ค้างที่ 5 แต่ฟังก์ชัน return ว่าสำเร็จ
  --          ⇒ ระบบเชื่อว่ามีของ 5 ชิ้นที่ไม่มีอยู่จริง = ขายทะลุ 5 ชิ้น
  -----------------------------------------------------------------------
  insert into public.central_stock (product_id, qty_on_hand) values (v_pa, 5);
  v_res := analytics.product_track_stock_set(v_shop, v_pa, true, 0);
  select qty_on_hand into v_on from public.central_stock where product_id = v_pa;
  v_log := v_log || format('[H1ก-1] มีของ 5 ตั้งเป็น 0: on_hand=%s (คาด 0): %s' || E'\n',
    v_on, case when v_on = 0 then 'OK' else 'FAIL' end);

  perform public.adjust_stock(v_shop, v_pa, 5, 'zz137-restock-1');
  v_res := analytics.product_track_stock_set(v_shop, v_pa, true, 0);
  select qty_on_hand into v_on from public.central_stock where product_id = v_pa;
  v_log := v_log || format('[H1ก-2] 🔴 ตั้งเป็น 0 ซ้ำ (delta -5 เท่าเดิม): on_hand=%s (คาด 0 — ของเดิมค้างที่ 5 = ขายเกิน): %s' || E'\n',
    v_on, case when v_on = 0 then 'OK' else 'FAIL — รูขายเกินยังเปิดอยู่' end);

  -----------------------------------------------------------------------
  -- 🔴 H1(ข) เคส 23505 ถาวร — ทำซ้ำบั๊กจริง
  -- 0 → ตั้ง 100 (delta +100 คีย์ :100) → ขายไป 30 เหลือ 70 → นับได้ 100 → ตั้ง 100 อีกครั้ง
  -- ของเดิม: delta +30 ชนคีย์ :100 ที่จำ +100 ไว้ ⇒ 23505 **ทุกครั้งตลอดไป**
  -- ซึ่งเป็น use case ที่ 0135 ตั้งใจเปิดทางให้พอดี (ปิดนับ → เปิดใหม่พร้อมยอดที่นับได้)
  -----------------------------------------------------------------------
  v_res := analytics.product_track_stock_set(v_shop, v_pb, true, 100);
  perform public.adjust_stock(v_shop, v_pb, -30, 'zz137-sold-30');
  v_caught := false;
  begin
    v_res := analytics.product_track_stock_set(v_shop, v_pb, true, 100);
  exception when others then v_caught := true;
  end;
  select qty_on_hand into v_on from public.central_stock where product_id = v_pb;
  v_log := v_log || format('[H1ข] ตั้ง 100 ซ้ำหลังขายไป 30: raise=%s (คาด false — ของเดิมได้ 23505 ถาวร), on_hand=%s (คาด 100): %s' || E'\n',
    v_caught, v_on, case when not v_caught and v_on = 100 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- H1(ค): ข้อความดิบห้ามหลุดถึงผู้ใช้ (ชื่อฟังก์ชันภายใน / รูปแบบ idem key)
  -- บังคับให้ชนยอดจอง — ใช้ update qty_reserved ตรงๆ เพราะ reserve_stock มี FK ไป public.orders
  -----------------------------------------------------------------------
  update public.central_stock set qty_reserved = 80 where product_id = v_pb;
  v_caught := false; v_code := null; v_msg := null;
  begin
    perform analytics.product_track_stock_set(v_shop, v_pb, true, 10);
  exception when others then
    v_caught := true; get stacked diagnostics v_msg = message_text, v_code = returned_sqlstate;
  end;
  v_log := v_log || format('[H1ค] ตั้งต่ำกว่ายอดจอง: code=%s (คาด 22023) ไม่มีคำว่า adjust_stock/idem_key: %s' || E'\n',
    coalesce(v_code,'(none)'),
    case when v_caught and v_code = '22023' and v_msg not like '%adjust_stock%' and v_msg not like '%idem_key%' then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- เคสห้ามพัง (สืบทอดจาก 0135 — semantics ต้องไม่เปลี่ยน)
  -----------------------------------------------------------------------
  insert into public.central_stock (product_id, qty_on_hand) values (v_pc, 15);
  v_res := analytics.product_track_stock_set(v_shop, v_pc, true, 15);
  select qty_on_hand into v_on from public.central_stock where product_id = v_pc;
  select count(*) into v_rows from public.stock_ledger where product_id = v_pc;
  v_log := v_log || format('[R1] มีของ 15 เปิดนับ 15 ไม่บวกทับเป็น 30: on_hand=%s (คาด 15) ledger=%s (คาด 0): %s' || E'\n',
    v_on, v_rows, case when v_on = 15 and v_rows = 0 then 'OK' else 'FAIL' end);

  v_res := analytics.product_track_stock_set(v_shop, v_pc, true);
  select qty_on_hand into v_on from public.central_stock where product_id = v_pc;
  v_log := v_log || format('[R2] เปิดโดยไม่ส่งยอด (null ≠ 0) ห้ามล้างเป็น 0: on_hand=%s (คาด 15) qty_target=%s (คาด null): %s' || E'\n',
    v_on, coalesce(v_res ->> 'qty_target','null'),
    case when v_on = 15 and (v_res ->> 'qty_target') is null then 'OK' else 'FAIL' end);

  v_res := analytics.product_track_stock_set(v_shop, v_pc, true, 12);
  select qty_on_hand into v_on from public.central_stock where product_id = v_pc;
  v_log := v_log || format('[R3] ลดยอดลง 15→12 ผ่าน ledger จริง: on_hand=%s (คาด 12) delta=%s (คาด -3): %s' || E'\n',
    v_on, v_res ->> 'delta_applied',
    case when v_on = 12 and (v_res ->> 'delta_applied')::int = -3 then 'OK' else 'FAIL' end);

  v_res := analytics.product_track_stock_set(v_shop, v_pc, false);
  v_log := v_log || format('[R4] ปิดนับได้ปกติ: track_stock=%s (คาด false): %s' || E'\n',
    v_res ->> 'track_stock', case when (v_res ->> 'track_stock')::boolean = false then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- static: กำแพงทั้ง 3 ชั้นอยู่ในโค้ดที่รันจริง + grant/overload
  -----------------------------------------------------------------------
  select pg_get_functiondef('analytics.product_track_stock_set(uuid,uuid,boolean,integer)'::regprocedure) into v_def;
  v_log := v_log || format('[S1] ชั้น 2 — post-check อ่านยอดกลับมาเทียบ (v_after): %s' || E'\n',
    case when v_def like '%v_after is distinct from v_qty%' then 'OK' else 'FAIL' end);
  v_log := v_log || format('[S2] ชั้น 3 — ไม่มี bare re-raise ที่ปล่อยข้อความดิบ: %s' || E'\n',
    case when v_def not like '%      raise;%' then 'OK' else 'FAIL' end);
  v_log := v_log || format('[S3] ชั้น 1 — idem key มีลำดับครั้งที่ปรับ (v_init_seq): %s' || E'\n',
    case when v_def like '%v_init_seq + 1%' then 'OK' else 'FAIL' end);
  v_log := v_log || format('[S4] grant: anon=%s auth=%s svc=%s (คาด f/f/t): %s' || E'\n',
    has_function_privilege('anon','analytics.product_track_stock_set(uuid,uuid,boolean,integer)','execute'),
    has_function_privilege('authenticated','analytics.product_track_stock_set(uuid,uuid,boolean,integer)','execute'),
    has_function_privilege('service_role','analytics.product_track_stock_set(uuid,uuid,boolean,integer)','execute'),
    case when has_function_privilege('anon','analytics.product_track_stock_set(uuid,uuid,boolean,integer)','execute') = false
          and has_function_privilege('authenticated','analytics.product_track_stock_set(uuid,uuid,boolean,integer)','execute') = false
          and has_function_privilege('service_role','analytics.product_track_stock_set(uuid,uuid,boolean,integer)','execute') = true
         then 'OK' else 'FAIL' end);
  v_log := v_log || format('[S5] ไม่มี overload: %s ตัว (คาด 1): %s' || E'\n',
    (select count(*) from pg_proc where pronamespace='analytics'::regnamespace and proname='product_track_stock_set'),
    case when (select count(*) from pg_proc where pronamespace='analytics'::regnamespace and proname='product_track_stock_set') = 1 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- 🔴 เช็คที่ md5 ของ body พิสูจน์ไม่ได้ (บทเรียน 0135) — ต้องเช็คแยกเสมอ
  -- ค่า default ของพารามิเตอร์อยู่ที่ pg_proc.proargdefaults ไม่ใช่ prosrc
  -----------------------------------------------------------------------
  v_log := v_log || format('[S6] p_initial_qty ยังเป็น DEFAULT NULL (ไม่ใช่ 0 — ถ้าเป็น 0 ปุ่มสวิตช์จะล้างสต็อก): %s' || E'\n',
    case when (select pg_get_function_arguments(oid) from pg_proc
                where oid='analytics.product_track_stock_set(uuid,uuid,boolean,integer)'::regprocedure)
              like '%p_initial_qty integer DEFAULT NULL%' then 'OK' else 'FAIL' end);

  v_log := v_log || E'\n=== ALL CHECKS LOGGED ABOVE — ตรวจทุกบรรทัดหา FAIL (transaction จะ rollback เสมอ) ===\n';
  raise exception '%', v_log;
end $$;

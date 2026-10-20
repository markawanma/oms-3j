-- scripts/verify/verify-0186-qa-oem.sql — QA (R2-D2): ใบเสนอราคา OEM เงิน/ทอง/ทองเหลือง ต้องได้ผล "เหมือนเดิมทุกตัว" ก่อน/หลัง 0186
-- 0186 ไม่แตะ oem_cost_calc / oem_price_calc / oem_quote_save (md5 นิยามฟังก์ชันเท่าเดิม) แต่เพิ่ม CHECK บน oem_metal_price — ไฟล์นี้พิสูจน์ว่าผลคิดราคา+บันทึกใบ (quoted) ไม่ขยับ
-- วิธีใช้: รัน 2 ครั้งแล้วเทียบผล — (1) ก่อน apply: node scripts/run-sql.mjs scripts/verify/verify-0186-qa-oem.sql   (2) dry-run: ต่อ 0186 + ไฟล์นี้ (หรือหลัง apply)
--   เก็บเฉพาะบรรทัด "[NOTICE] CALC/SAVE ..." เทียบด้วย diff — ต้องเหมือนกันทุกบรรทัด (md5 ของ jsonb ผลคิดราคาทั้งก้อน + ยอดรวมใบที่บันทึก)
-- อ่านอย่างเดียวบน catalog/ราคา · เขียนใบเสนอราคา+ตัวนับเลขใบเสนอราคา (ร้านจริง) ในทรานแซกชันที่ run-sql ถอยเสมอ (ไม่ใส่ --commit)
-- ⚠️ ราคาทอง/ทองเหลืองของใบเสนอราคาวันนี้ยังอิงแถว 25 ส.ค. (oem_cost_calc lookup <= วัน) — หนี้ H2(ข) เดิม ไม่ใช่ผลของ 0186
-- QA ad-hoc: OEM quote ทอง/ทองเหลือง/เงิน — ผลต้องเหมือนกันก่อน/หลัง 0186 (เทียบ md5 ของ jsonb ทั้งก้อน)
do $q$
declare
  v_shop uuid; v_in jsonb; v_c jsonb; m text; q int; v_id uuid; v_st text; v_tot numeric; v_pv jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select id into v_shop from public.shop;
  select input into v_in from analytics.oem_quote_item where input->>'metal' = 'silver' order by created_at limit 1;
  v_in := v_in - 'as_of_date';
  foreach m in array array['silver','gold','brass'] loop
    foreach q in array array[1, 50, 100, 1000] loop
      begin
        v_c := analytics.oem_price_calc(v_shop, v_in || jsonb_build_object('metal', m, 'qty', q) || case when m='gold' then jsonb_build_object('purity', 0.75) else '{}'::jsonb end);
        raise notice 'CALC % q=% complete=% md5=% price_piece=%', m, q, v_c->>'is_complete', md5(v_c::text), coalesce(v_c #>> '{breakdown,price_per_piece}', v_c #>> '{breakdown,pricePerPiece}', '?');
      exception when others then raise notice 'CALC % q=% ERR % %', m, q, sqlstate, left(sqlerrm, 120); end;
    end loop;
    -- save quoted (ใน subtx ที่ rollback ทั้งก้อนตอนจบ do-block ผ่าน run-sql)
    begin
      v_id := analytics.oem_quote_save(p_shop_id => v_shop,
        p_items => jsonb_build_array(jsonb_build_object('input', v_in || jsonb_build_object('metal', m, 'qty', 100) || case when m='gold' then jsonb_build_object('purity', 0.75) else '{}'::jsonb end)),
        p_quote_id => null, p_status => 'quoted', p_approval_note => 'qa adhoc 0186 เทียบก่อนหลัง', p_customer_name => 'qa0186', p_customer_contact => null,
        p_discount_thb => 0, p_discount_reason => null, p_bar_valid_until => null);
      select status into v_st from analytics.oem_quote where id = v_id;
      select (to_jsonb(v) ->> 'grand_total') into v_tot from analytics.v_oem_quote v where v.id = v_id;
      raise notice 'SAVE % status=% grand_total=%', m, v_st, v_tot;
    exception when others then raise notice 'SAVE % ERR % %', m, sqlstate, left(sqlerrm, 160); end;
  end loop;
end $q$;

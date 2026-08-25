-- 0085_oem_renegotiate_won.sql
-- แก้ข้อขัดแย้งระหว่างคำสั่งเจ้าของ 2 ข้อ:
--   ข้อ 2 (0084) — รับมัดจำ -> oem_receipt_issue พลิกใบเป็น won อัตโนมัติ
--   ข้อ 3 (0084 §3 เดิม) — ต่อราคาลงต่ำกว่าเงินที่รับแล้วต้อง "ทำได้"
-- แต่ oem_quote_renegotiate เช็ค v_old.status <> 'quoted' มาตั้งแต่ 0075 และ
-- won เป็นสถานะปลายทาง (oem_quote_set_status ปิดประตูเปลี่ยนซ้ำจาก won ใน
-- 0076) ผลคือพอรับมัดจำแล้ว ต่อราคาไม่ได้อีกเลยตลอดไป — ข้อ 3 ใช้งานจริงไม่ได้
-- เจ้าของเคาะแล้ว (ยืนยันผ่าน Tech Lead): เปิดให้ต่อราคาใบที่ won ได้ (ผ่อนด่าน
-- สถานะอย่างเดียว ไม่ใช่ยกเลิกการพลิกสถานะของ 0084)
--
-- ============ อ่านคู่กับ ============
-- 0075 (ด่าน status <> 'quoted' เดิม), 0076 (transition table ของ
-- oem_quote_set_status — won เป็น terminal สำหรับฟังก์ชันนั้น แต่ไม่ใช่
-- terminal สำหรับ renegotiate อีกต่อไปหลังไฟล์นี้), 0083 (ฉบับล่าสุดของ
-- oem_quote_renegotiate ก่อนไฟล์นี้ — ต้องลอก body จากตรงนี้เท่านั้น มี hard
-- floor margin ติดลบ (§1a) และ vat_mode clamp (§3) ที่ต้องอยู่ครบ), 0084
-- (oem_receipt_issue ที่พลิกสถานะเป็น won อัตโนมัติตอนรับมัดจำ + คำอธิบายว่า
-- ทำไมไฟล์นั้นไม่แตะฟังก์ชันนี้เลย — "ต่อราคาลงต่ำกว่ายอดที่รับไปแล้วได้เสมอ"
-- เป็นการตัดสินใจที่บันทึกไว้แล้วใน 0084 หัวไฟล์ §3 ไฟล์นี้แค่เปิดให้ทำได้จริง
-- กับใบ won โดยไม่เพิ่มด่านใหม่ใดๆ ทับการตัดสินใจนั้น)
--
-- ============ การเปลี่ยนแปลงทั้งหมด (arg list เดิม 4 ตัวเป๊ะ = plain replace) ==
-- 1) ด่านสถานะ: รับเฉพาะ quoted -> รับ quoted และ won (lost/rejected/
--    superseded/draft ยังปฏิเสธเหมือนเดิมเป๊ะ — superseded ถูกแทนที่แล้วให้ไป
--    ต่อที่ใบใหม่ในสาย, draft ยังไม่เคยผ่าน gate ไหนเลยให้แก้ตรงๆ ผ่าน
--    oem_quote_save แทน) ข้อความ error อัปเดตให้ตรงความจริงใหม่
--
-- 2) ด่านวันหมดอายุ — ⚠️ จุดที่ต้องคิด ไม่ใช่ลอกด่านเดิมมาเฉยๆ: ด่านนี้เช็ค
--    quote_valid_until >= วันนี้(ไทย) มีไว้ "ผูกมัดร้านกับลูกค้าก่อนตกลง" —
--    ป้องกันร้านเสนอราคาค้างไว้นานเกินจะยืนราคาได้จริง (ราคาโลหะ/วัตถุดิบ
--    ขยับ) พอลูกค้าตกลงและจ่ายเงินแล้ว (won) หน้าที่นี้จบแล้ว สิ่งที่เหลือคือ
--    การแก้ขอบเขตงานของดีลที่ "รับเงินแล้ว" ไม่ใช่การเสนอราคาใหม่ที่ยังไม่มี
--    พันธะ — ถ้าคงด่านนี้ไว้กับใบ won ด้วย ใบ won ส่วนใหญ่จะต่อราคาไม่ได้อยู่ดี
--    (ยืนราคา 30 วัน แต่งานผลิตจริงใช้เวลานานกว่านั้นเป็นปกติ) = แก้ปัญหาไม่ตรง
--    จุดเหมือนเดิม จึง**ข้ามด่านนี้เมื่อสถานะเป็น won** ส่วนใบ quoted ยังเช็ค
--    เหมือนเดิมทุกประการ ไม่ผ่อน (พันธะยังไม่เกิด ยังต้องมีเพดานเวลา)
--
-- 3) สถานะของใบลูก — เดิม insert เป็น 'quoted' ตรงๆ เสมอ ตัดสินใจแล้ว: ใบลูก
--    "สืบทอดสถานะจากใบแม่ตรงๆ" (v_old.status ซึ่งการันตีแล้วว่าเป็น quoted
--    หรือ won อย่างใดอย่างหนึ่งจากด่าน §1 ด้านบน) แทนที่จะเช็ค "มีใบเสร็จใน
--    สายนี้ไหม" (join oem_receipt) เหตุผลที่เลือกทางนี้:
--      - won ในระบบนี้ไม่ได้แปลว่า "ต้องมีใบเสร็จ" เสมอไป — oem_quote_set_status
--        (0076) ยังเปิดทางให้ set won ตรงๆ จาก quoted/expired ได้โดยไม่ต้องมี
--        receipt เลย (เช่น ตกลงวาจา/เซ็นสัญญาแล้วแต่ยังไม่ได้โอนเงิน) ถ้าตัดสิน
--        จาก "มี receipt ไหม" ใบลูกของดีลแบบนี้จะเด้งกลับเป็น quoted ทั้งที่
--        ธุรกิจถือว่าปิดงานแล้ว — ขัดกับสถานะจริงของดีล
--      - v_old.status มีอยู่ในมือแล้วจาก select ต้นฟังก์ชัน ไม่ต้อง join ตาราง
--        เพิ่ม — 0084 หัวไฟล์เขียนไว้ชัดว่าตั้งใจให้ renegotiate "ไม่ต้องรู้เรื่อง
--        ใบเสร็จเลย" (การรวม paid ทำที่ oem_receipt_issue/view ด้วย aggregation
--        ผ่าน root_quote_id ไม่ใช่ mutation) การเพิ่ม join ที่นี่จะข้ามเส้นแบ่งนั้น
--        และผูก renegotiate เข้ากับโครงสร้างของอีกตารางโดยไม่จำเป็น
--      - ทนต่อการเปลี่ยนแปลงในอนาคตกว่า: ถ้าวันหน้ามีสถานะ/เงื่อนไข "ปิดงาน"
--        แบบใหม่เพิ่มเข้ามา (นอกเหนือจาก won) การสืบทอดสถานะตรงๆ ยังถูกต้องเอง
--        โดยไม่ต้องแก้ query ที่นี่ ต่างจาก "เช็คมี receipt ไหม" ที่ต้องตามแก้
--        นิยาม "นับเป็นจ่ายแล้ว" ทุกครั้งที่ธุรกิจเปลี่ยน
--    (root_quote_id ของใบลูกยังคง coalesce(v_old.root_quote_id, v_old.id)
--    เหมือนเดิมทุกประการ — ไม่แตะ นี่คือกลไกที่ทำให้ receipt เดิมยัง "ตามมา" ที่
--    ใบลูกถูกต้องอยู่แล้วโดยไม่ต้องแก้อะไรเพิ่ม ดูหมายเหตุท้ายไฟล์)
--
-- ============ ยืนยัน: guard ของ 0083 ยังอยู่ครบ ============
-- (a) hard floor margin รวมติดลบ — "if v_old.margin_actual_pct is not null and
--     v_old.margin_actual_pct < 0 then raise exception ... margin รวมติดลบ..."
--     คัดลอกมาจาก 0083 บรรทัด 1237-1241 คำต่อคำ ไม่แตะ
-- (b) vat_mode clamp — บล็อก "v_new_vat_mode := v_old.vat_mode; if
--     v_new_vat_mode = 'breakdown' and not coalesce(v_set.seller_vat_registered,
--     false) then v_new_vat_mode := 'included'; end if;" คัดลอกมาจาก 0083
--     บรรทัด 1369-1379 คำต่อคำ ไม่แตะ
-- ทุก gate อื่นของ 0083 (hard floor ต่อส่วนลด, floor รวมทั้งใบ + note-tier,
-- ด่านมูลค่างานขั้นต่ำ, มัดจำ clamp) คงเดิมเป๊ะ ไม่แตะสักบรรทัด
--
-- ============ ช่องที่การผ่อนด่านนี้เปิดเพิ่ม (ตั้งใจปล่อยผ่าน ไม่ใช่มองไม่เห็น) ==
-- 1) ต่อราคาใบที่ "จ่ายครบแล้ว" (is_fully_paid) ได้เหมือนใบที่จ่ายบางส่วน — ไม่
--    กันเพิ่ม เพราะ 0084 หัวไฟล์ §3 บันทึกไว้แล้วว่าเจ้าของสั่ง "ต่อได้ แต่ขึ้น
--    คำเตือนตัวใหญ่ (ไม่ block)" และ Tech Lead ยืนยันให้ยกเลิก gate ตายที่ Yoda
--    วางแผนไว้ใน design เดิม — ไฟล์นี้ทำตามการตัดสินใจนั้นต่อ ไม่เพิ่มด่านใหม่
--    ทับ (คำเตือนเป็นหน้าที่ฝั่ง UI ไม่ใช่ DB)
-- 2) ต่อราคาซ้ำหลายรอบบนดีลที่รับเงินแล้ว — ไม่มีการจำกัดจำนวนรอบ (เหมือนใบ
--    quoted เดิมที่ต่อราคากี่รอบก็ได้อยู่แล้ว) แต่ละรอบ discount_thb เป็นค่า
--    "ใหม่ทั้งก้อน" เทียบกับ v_price_ex_gold_sum ของ item set เดิมเสมอ (ไม่ใช่
--    ส่วนลดสะสม) จึงไม่มี drift ข้ามรอบ — ความเสี่ยงจริงคือด้าน "เอกสาร" ไม่ใช่
--    ตัวเลข: ใบเสร็จที่ออกไปแล้วเป็นเอกสารตายตัว (0084) VAT ที่ยื่นไปแล้วไม่ถูก
--    ย้อนแก้ ต่อให้ renegotiate ภายหลังจะเปลี่ยน grand_total ของดีลไปมาก — ถ้า
--    ต่อราคาซ้ำหลายรอบจนราคาต่างจากตอนออกใบเสร็จเดิมมาก อาจต้องมีขั้นตอนบัญชี
--    เพิ่ม (ใบลดหนี้) ที่ระบบนี้ยังไม่มี RPC รองรับ — technical debt ที่รู้ตัว
--    ตรงกับที่ 0084 บันทึกไว้แล้ว ไม่ใช่เรื่องใหม่จากไฟล์นี้
-- 3) ใบเสร็จที่ผูกกับใบแม่ยังตามมาที่ใบลูกถูกต้อง — ยืนยันแล้ว: oem_receipt
--    ไม่ re-point FK ตอนต่อราคา (0084 §5) การรวม paid ทำที่ oem_receipt_issue
--    และ view ผ่าน "root_quote_id เดียวกัน" ไม่ใช่ "quote_id เดียวกัน" ใบลูกที่
--    ไฟล์นี้สร้างยังตั้ง root_quote_id = coalesce(v_old.root_quote_id, v_old.id)
--    เหมือน 0083 ทุกประการ (ไม่แตะบรรทัดนั้น) — receipt เดิมทั้งหมดในสายจึงยัง
--    ถูกนับกับใบลูกถูกต้อง ไม่ต้องแก้อะไรเพิ่มในไฟล์นี้
-- ============================================================================

create or replace function analytics.oem_quote_renegotiate(p_shop_id uuid, p_quote_id uuid, p_new_discount_thb numeric, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
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
  v_new_grand_total numeric;
  v_jobvalue_min numeric;
  v_has_items boolean := false;
  -- ---- silver999 (bar) ----
  v_bkk_today date;
  v_has_bar_item boolean := false;
  v_production_total_sum numeric := 0;
  -- 0079-fix: เหมือน v_has_ungated_item ใน oem_quote_save — true เมื่อ item
  -- ใดก็ตามใน loop มี margin_charged_pct เป็น null (ตรวจ margin รายชิ้นไม่ได้)
  v_has_ungated_item boolean := false;
  -- ---- 0081: มัดจำที่ใบใหม่จะสืบทอด (ก่อน clamp/เคลียร์) ----
  v_new_deposit_mode text;
  v_new_deposit_input numeric;
  -- ---- 0083: vat_mode ที่ใบใหม่จะสืบทอด (ก่อน clamp กันร้านที่เลิกจด VAT) ----
  v_new_vat_mode text;
begin
  if p_shop_id is null or p_quote_id is null then
    raise exception 'oem_quote_renegotiate: p_shop_id and p_quote_id are required';
  end if;
  if p_new_discount_thb is null or p_new_discount_thb < 0 then
    raise exception 'oem_quote_renegotiate: p_new_discount_thb must be >= 0';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  -- timezone ไทย เสมอ — ใช้เช็คหมดอายุและตั้ง valid_until ของใบใหม่
  v_bkk_today := (now() at time zone 'Asia/Bangkok')::date;

  select * into v_old from analytics.oem_quote where id = p_quote_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'oem_quote_renegotiate: quote % not found for this shop', p_quote_id;
  end if;

  -- 0085 §1: ผ่อนด่านสถานะ — เดิมรับเฉพาะ quoted เพิ่ม won เข้ามา (เจ้าของสั่ง
  -- ให้ต่อราคาใบที่รับมัดจำแล้วได้ ดูหัวไฟล์) lost/rejected/superseded/draft
  -- ยังปฏิเสธเหมือนเดิมทุกประการ
  if v_old.status not in ('quoted', 'won') then
    raise exception 'oem_quote_renegotiate: ต่อรองราคาได้เฉพาะใบสถานะ quoted หรือ won เท่านั้น (ใบนี้สถานะ %)', v_old.status
      using errcode = '22023';
  end if;
  -- 0085 §2: ด่านวันหมดอายุ — ผูกมัดร้านกับลูกค้า "ก่อน" ตกลง เมื่อ won แล้ว
  -- (รับเงิน/ปิดดีลแล้ว) หน้าที่นี้จบ ข้ามด่านนี้เฉพาะ won เท่านั้น — quoted ยัง
  -- เช็คเหมือนเดิมทุกประการ ไม่ผ่อน (ดูเหตุผลเต็มที่หัวไฟล์)
  if v_old.status = 'quoted'
     and (v_old.quote_valid_until is null or v_old.quote_valid_until < v_bkk_today) then
    raise exception 'oem_quote_renegotiate: ใบเสนอราคาหมดอายุแล้ว ต่อรองราคาไม่ได้ — ออกใบใหม่แทน' using errcode = '22023';
  end if;

  select * into v_set from analytics.oem_setting where shop_id = p_shop_id;
  if v_set.shop_id is null then
    -- LOW: fallback ต้อง seed ให้ครบทุกค่าที่ฟังก์ชันนี้อ่าน ไม่งั้น gate หายเงียบ
    v_set.margin_floor_pct := 0.20; v_set.margin_hard_floor_pct := 0.15;
    v_set.nre_max_share_pct := 0.25; v_set.min_job_value_thb := 8000;
    v_set.quote_valid_days_silver := 30; v_set.quote_valid_days_gold := 7; v_set.quote_valid_days_brass := 45;
    v_set.bar_margin_pct := 0.19;
  end if;

  -- 0083: hard floor เด็ดขาด (§1a) — margin รวมทั้งใบ "ก่อน" หักส่วนลด ติดลบ =
  -- ปฏิเสธเสมอ (เหมือน oem_quote_save §0083 แต่ renegotiate ไม่รีคำนวณ
  -- price_piece/cost_piece ต่อชิ้นใหม่เลย มีแต่เปลี่ยนส่วนลด item set เดิมทั้ง
  -- ชุดถูกคัดลอกมาตรงๆ ทีหลัง (ดู insert oem_quote_item ท้ายฟังก์ชัน) —
  -- v_old.margin_actual_pct ที่บันทึกไว้ตอน save/renegotiate ครั้งก่อนจึงเป็น
  -- ค่าเทียบเท่า v_margin_actual_blended ของ oem_quote_save เป๊ะ ไม่ต้องคำนวณ
  -- ซ้ำจาก items) ไม่ผูกกับ p_new_discount_thb ไม่ปลดล็อกด้วย p_reason —
  -- ยืนยันแล้วว่าไม่กระทบใบแท่ง 1 กก. (margin จริง 8.4%) และไม่กระทบงานผลิต
  -- ปกติ — เช็คได้ทันทีตรงนี้เลย ไม่ต้องรอ loop items ด้านล่าง
  if v_old.margin_actual_pct is not null and v_old.margin_actual_pct < 0 then
    raise exception 'oem_quote_renegotiate: ใบนี้ margin รวมติดลบ (%) — ราคาขายต่ำกว่าต้นทุน/ราคารับซื้อคืนของร้านเอง ไม่มีทางลัด ตรวจราคาฟีดตอนออกใบเดิมก่อน',
      round(v_old.margin_actual_pct * 100, 1)::text || '%'
      using errcode = '22023';
  end if;

  for v_row in select * from analytics.oem_quote_item where quote_id = v_old.id order by seq loop
    v_has_items := true;
    if (v_row.input->>'metal') = 'silver999' then
      v_has_bar_item := true;
    end if;
    if (v_row.input->>'metal') = 'gold' then
      v_price_ex_gold_sum := v_price_ex_gold_sum + coalesce(v_row.item_total, 0)
                              - coalesce((v_row.calc->'breakdown'->'metal'->>'per_piece')::numeric, 0) * v_row.qty;
      v_cost_ex_gold_sum := v_cost_ex_gold_sum + coalesce(v_row.cost_piece, 0) * v_row.qty
                             - coalesce((v_row.calc->'breakdown'->'metal'->>'per_piece')::numeric, 0) * v_row.qty;
    else
      v_price_ex_gold_sum := v_price_ex_gold_sum + coalesce(v_row.item_total, 0);
      v_cost_ex_gold_sum := v_cost_ex_gold_sum + coalesce(v_row.cost_piece, 0) * v_row.qty;
    end if;

    -- ด่านมูลค่างานขั้นต่ำ (production-only): คิดจาก items จริงในลูปนี้ ห้ามใช้
    -- v_old.quote_total (รวมมูลค่าแท่งด้วย)
    if (v_row.input->>'metal') <> 'silver999' then
      v_production_total_sum := v_production_total_sum + coalesce(v_row.item_total, 0);
    end if;

    -- 0079-fix: item นี้ระบบตรวจ margin รายชิ้นไม่ได้ (บันทึกไว้ตอน save เป็น
    -- margin_charged_pct = null) — เช็คจากค่า ไม่เช็คจาก metal ตรงๆ
    if v_row.margin_charged_pct is null then
      v_has_ungated_item := true;
    end if;

    v_valid_days := least(
      coalesce(v_valid_days, 9999),
      case (v_row.input->>'metal')
        when 'gold' then coalesce(v_set.quote_valid_days_gold, 7)
        when 'brass' then coalesce(v_set.quote_valid_days_brass, 45)
        when 'silver999' then 0
        else coalesce(v_set.quote_valid_days_silver, 30)
      end
    );
  end loop;
  -- LOW: ใช้ตัวแปรของตัวเอง ไม่พึ่ง found หลัง loop (found = ผลของคำสั่งสุดท้าย)
  if not v_has_items then
    raise exception 'oem_quote_renegotiate: ใบ % ไม่มีรายการ ต่อราคาไม่ได้', p_quote_id using errcode = '22023';
  end if;
  v_production_total_sum := v_production_total_sum + coalesce(v_old.nre_price, 0);

  -- C1: guard เดียวกับ save
  if p_new_discount_thb > 0 and p_new_discount_thb >= v_price_ex_gold_sum then
    raise exception 'oem_quote_renegotiate: ส่วนลดใหม่ % บาท มากกว่าหรือเท่ากับมูลค่างานส่วนที่คิดกำไรได้ (% บาท) — ไม่มีทางลัด',
      p_new_discount_thb, round(v_price_ex_gold_sum, 2)
      using errcode = '22023';
  end if;

  -- H1: ด่านมูลค่างานขั้นต่ำ — มี item เงินแท่ง -> ดูเฉพาะมูลค่างานผลิต (ก่อนหัก
  -- ส่วนลด) ข้ามถ้า = 0 (ใบแท่งล้วน) · ไม่มี item เงินแท่ง -> พฤติกรรมเดิมเป๊ะ
  v_new_grand_total := coalesce(v_old.quote_total, 0) - p_new_discount_thb;
  v_jobvalue_min := greatest(
    coalesce(v_set.min_job_value_thb, 8000),
    case when coalesce(v_old.nre_cost, 0) > 0
         then v_old.nre_cost / coalesce(v_set.nre_max_share_pct, 0.25) else 0 end
  );
  if v_has_bar_item then
    if v_production_total_sum > 0 and v_production_total_sum < v_jobvalue_min then
      raise exception 'oem_quote_renegotiate: มูลค่างานส่วนที่เป็นงานผลิต (% บาท) ต่ำกว่าเกณฑ์ขั้นต่ำ % บาท — ต่อราคาไม่ได้ (ใบเงินแท่งล้วนไม่ติดด่านนี้)',
        v_production_total_sum, v_jobvalue_min using errcode = '22023';
    end if;
  else
    if v_new_grand_total < v_jobvalue_min then
      raise exception 'oem_quote_renegotiate: ส่วนลดใหม่ทำให้มูลค่างานรวม (%) ต่ำกว่าเกณฑ์ขั้นต่ำ % บาท — ต่อราคาไม่ได้',
        v_new_grand_total, v_jobvalue_min
        using errcode = '22023';
    end if;
  end if;

  v_margin_after := case when (v_price_ex_gold_sum - p_new_discount_thb) > 0
    then round(((v_price_ex_gold_sum - p_new_discount_thb) - v_cost_ex_gold_sum) / (v_price_ex_gold_sum - p_new_discount_thb), 4) end;

  -- 0079: เติม p_new_discount_thb > 0 เหตุผลเดียวกับ save — ด่านนี้กันส่วนลด
  -- กัดกำไร ไม่ใช่กันราคาที่ร้านประกาศเอง (ใบแท่ง 1 กก. margin จริง 8.4% ต่ำ
  -- กว่า hard floor 15% ได้แม้ p_new_discount_thb = 0 ถ้าไม่กันจะปฏิเสธการ
  -- ต่อราคาที่ไม่มีส่วนลดเลย)
  if p_new_discount_thb > 0
     and (v_margin_after is null or v_margin_after < v_set.margin_hard_floor_pct) then
    raise exception 'oem_quote_renegotiate: ส่วนลดใหม่ % บาท ทำให้ margin % ต่ำกว่า hard floor % — ไม่มีทางลัด',
      p_new_discount_thb,
      coalesce(round(v_margin_after * 100, 1)::text || '%', 'คำนวณไม่ได้'),
      round(v_set.margin_hard_floor_pct * 100, 1)::text || '%'
      using errcode = '22023';
  end if;

  -- 0079-fix (แก้จากรอบแรก): note-tier — เดิมใช้ "v_old.margin_charged_pct is
  -- null" (= "ใบเดิมไม่มี item งานผลิตเลย") เป็นตัวแทนที่ผิดเหมือน §3: เติม
  -- item งานผลิตชิ้นเล็ก margin สูงเข้าไปตอน save ก็ทำให้ v_old.margin_charged_pct
  -- ไม่ null แล้วปลดล็อกด่านทั้งใบตอน renegotiate ได้ทันที ทั้งที่มูลค่าส่วน
  -- ใหญ่ยังเป็นแท่ง margin บางเท่าเดิม — แก้เป็น v_has_ungated_item (ตั้งจริง
  -- ระหว่าง loop items ด้านบน จาก v_row.margin_charged_pct รายตัว ไม่ใช่ค่า
  -- MIN รวมทั้งใบ) ด่านรวมทั้งใบเป็นด่านเดียวที่เหลือสำหรับ item แบบนี้ ต้อง
  -- ทำงานเสมอไม่ว่าใบจะมี item งานผลิต margin สูงมาช่วยดันค่าเฉลี่ยหรือไม่ก็ตาม
  -- · LOW-6: ข้อความต้องไม่โทษ "ส่วนลด" เมื่อ clause ไฟจากเหตุผลอื่น
  if (p_new_discount_thb > 0 or v_has_ungated_item)
     and v_margin_after < v_set.margin_floor_pct
     and (p_reason is null or btrim(p_reason) = '') then
    if p_new_discount_thb > 0 then
      raise exception 'oem_quote_renegotiate: ส่วนลดใหม่ % บาท ทำให้ margin รวม % ต่ำกว่า floor % — ต้องระบุเหตุผล',
        p_new_discount_thb, coalesce(round(v_margin_after * 100, 1)::text || '%', 'คำนวณไม่ได้'),
        round(v_set.margin_floor_pct * 100, 1)::text || '%'
        using errcode = '22023';
    else
      raise exception 'oem_quote_renegotiate: ใบนี้มีรายการที่ระบบตรวจ margin รายชิ้นไม่ได้อยู่ด้วย (เช่น เงินแท่ง) ทำให้ margin รวม % ต่ำกว่า floor % — ต้องระบุเหตุผล แม้ไม่ได้ลดราคาก็ตาม',
        coalesce(round(v_margin_after * 100, 1)::text || '%', 'คำนวณไม่ได้'), round(v_set.margin_floor_pct * 100, 1)::text || '%'
        using errcode = '22023';
    end if;
  end if;

  -- 0081: ใบใหม่สืบทอดเงื่อนไขมัดจำจากใบแม่ (v_old) เสมอ — เงื่อนไขที่ตกลงกัน
  -- ไว้ไม่ควรหายตอนต่อราคา ยกเว้นโหมด thb ที่ยอดมัดจำเดิม "มากกว่า" grand_total
  -- ใหม่ ต้อง clamp ลงมาเท่ากับ grand_total ใหม่ (ดูคอมเมนต์หัวฟังก์ชันสำหรับ
  -- ผลข้างเคียงที่ตั้งใจปล่อยให้เห็น + เคสขอบ grand_total ใหม่ <= 0)
  v_new_deposit_mode := v_old.deposit_mode;
  v_new_deposit_input := v_old.deposit_input;
  if v_new_deposit_mode = 'thb' and v_new_deposit_input is not null then
    if v_new_grand_total <= 0 then
      v_new_deposit_mode := null;
      v_new_deposit_input := null;
    elsif v_new_deposit_input > v_new_grand_total then
      v_new_deposit_input := v_new_grand_total;
    end if;
  end if;

  -- 0083 (§3): ใบใหม่สืบทอด vat_mode จากใบแม่เหมือนเดิม (0075) แต่ต้อง clamp
  -- ก่อน insert — ถ้าร้านไม่ได้จด VAT ตอนนี้ (v_set.seller_vat_registered
  -- false หรือไม่มีแถว oem_setting เลย → coalesce เป็น false) ห้ามให้ใบใหม่
  -- เกิดเป็น 'breakdown' ไม่ว่าใบแม่จะเป็นอะไรก็ตาม — เคสจริง: ร้านเคยจด VAT
  -- ตอนออกใบแม่เป็น breakdown แล้วยกเลิกสถานะจด VAT ก่อนมีคนมาต่อราคาใบนั้น
  -- ด่าน seller_vat_registered เดิม (0082 §4) อยู่ใน oem_quote_set_vat_mode
  -- เท่านั้น ไม่ครอบคลุม insert ตรงๆ ของฟังก์ชันนี้ ต้อง clamp เองตรงนี้
  v_new_vat_mode := v_old.vat_mode;
  if v_new_vat_mode = 'breakdown' and not coalesce(v_set.seller_vat_registered, false) then
    v_new_vat_mode := 'included';
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
        parent_quote_id, root_quote_id, customer_id, vat_mode, vat_rate,
        deposit_mode, deposit_input,
        quote_valid_until, created_by, updated_by
      ) values (
        v_new_id, v_old.shop_id, v_new_no, v_old.customer_name, v_old.customer_contact, null, null, v_old.rate_snapshot,
        v_old.cost_piece, v_old.price_per_piece, v_old.nre_cost, v_old.nre_price, v_old.pieces_subtotal, v_old.quote_total,
        v_old.margin_actual_pct, v_old.margin_charged_pct, v_old.q_run, v_old.flask_count, v_old.plating_batch_count,
        -- 0085 §3: ใบลูกสืบทอดสถานะจากใบแม่ตรงๆ (v_old.status การันตีแล้วว่า
        -- เป็น 'quoted' หรือ 'won' อย่างใดอย่างหนึ่งจากด่านต้นฟังก์ชัน) —
        -- ไม่ใช่ literal 'quoted' เหมือนเดิม ดูเหตุผลเต็มที่หัวไฟล์
        v_old.status, p_new_discount_thb, p_reason, v_new_grand_total, v_margin_after,
        v_old.id, coalesce(v_old.root_quote_id, v_old.id), v_old.customer_id, v_new_vat_mode, v_old.vat_rate,
        v_new_deposit_mode, v_new_deposit_input,
        v_bkk_today + coalesce(v_valid_days, v_set.quote_valid_days_silver, 30), auth.uid(), auth.uid()
      );
      exit;
    exception when unique_violation then
      if v_i = 5 then
        raise exception 'oem_quote_renegotiate: ออกเลขที่ใบใหม่ไม่สำเร็จ ลองใหม่อีกครั้ง';
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
$function$;

revoke execute on function analytics.oem_quote_renegotiate(uuid, uuid, numeric, text) from public, anon;
grant execute on function analytics.oem_quote_renegotiate(uuid, uuid, numeric, text) to authenticated, service_role;

-- ============================================================================
-- 4. analytics.oem_doc_counter — ปิดช่องที่ทดสอบเจอเพิ่ม: ALTER DEFAULT
--    PRIVILEGES ของ schema analytics (0018/0041) ให้ select แก่ authenticated
--    กับทุกตารางใหม่ในสคีมาโดยอัตโนมัติ ขัดกับคอมเมนต์ใน 0084 ที่เขียนไว้ว่า
--    "ไม่ grant ให้ authenticated/anon เลย" — RLS ยังปิดสนิทอยู่ (ไม่มี policy
--    เลย) จึง select ได้ 0 แถวเสมอ ไม่มีข้อมูลรั่ว แต่ตารางถูก expose เป็น
--    PostgREST endpoint (/rest/v1/oem_doc_counter) โดยไม่ตั้งใจ — เพิกถอนให้
--    ตรงกับ intent เดิม
-- ============================================================================
revoke select on analytics.oem_doc_counter from authenticated, anon;

notify pgrst, 'reload schema';

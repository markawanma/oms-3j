-- scripts/verify/verify-0181.sql
-- ตรวจ supabase/migrations/0181_job_lots_l1.sql (L1: ส่วนย่อย "ส่งต่อ n จาก N" · ส่วนต่างรอชี้แจง · QR หลายใบไม่เพิกถอน) ตาม design-job-lots-shopfloor.md §10.1 + §10.2
-- self-rolling-back (3j-migration-traps ข้อ 11) · ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · ข้อมูลทดสอบสร้างผ่าน RPC ใน do-block ที่ถอยกลับทุก section
--   (ข้อยกเว้นที่บอกตรงๆ: ใบเสนอราคา OEM = โคลนจากรายการจริงด้วย INSERT ในทรานแซกชันที่ถอย (แบบเดียวกับ verify-0172..0178) · เคสห้ามผ่านของ trigger ใช้ UPDATE/INSERT ตรงตามที่ design §10.1 ข้อ 6 สั่ง · ติ๊ก worker.can_external/is_active ด้วย UPDATE ตรง)
-- รอบแรก = ของจริง · รอบถัดไป = mutant 59 จุด (ทุกตัวต้องล้ม ไม่งั้น MX FAIL) · ปิดท้ายตรวจ state ไม่ขยับ (นับ+md5 ทุกตาราง รวมตัวนับเลขใบงาน)
-- 🔴 ไฟล์นี้ต้องรันหลัง Tech Lead ส่งข้อความ "รันได้" เท่านั้น (ล็อกตาราง job นานช่วง mutant — QA อาจกำลังกดบน DB จริง)
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0181.sql
-- dry-run ก่อน apply: cat supabase/migrations/0181_job_lots_l1.sql scripts/verify/verify-0181.sql > <tmp>.sql แล้วรันไม่ใส่ --commit  (ใช้เวลาหลายนาที — รันแบบ background)
--
-- ============ ตารางแมป "ข้อในบรีฟ/design §10 -> เทสต์ที่ครอบ" ============
--  10.1-1  แยก qty ≤ 0 · ≥ ที่ถือ · NaN · > 100000 · จากขั้น pending/sent/skipped · ใบ done/cancelled/on_hold      -> B1a B1b B1c B1d B2a B2b B2c B3a B3b B3c · mutant MU-8
--  10.1-2  ช่างไม่ใช่ผู้ถือ · token/ส่วนของใบอื่น · ส่วน cancelled · session หมด/ช่างปิด · token เพิกถอน             -> C1 C2 C3 C4a C4b C4c · MU-10
--  10.1-3  น้ำหนัก/เติมโลหะ/เศษมากับการแยก (ค1) weight_unexpected                                              -> D1 D2 · MU-6
--  10.1-4  ของเสียตอนแยก ไม่มีเหตุผล/ล่องหน/เหตุผลโดยไม่มีของเสีย                                              -> E1 E2 E3 E4 E5
--  10.1-5  2 มือถือแยกส่วนเดียวพร้อมกัน / แยก+ส่งพร้อมกัน                                                       -> B4a B4b B4c B4d (กลไก CAS p_qty_hold → stage_changed · MU-7 MU-9) ·
--          ❌ ไม่มีเทสต์ 2 connection จริง (do-block ทรานแซกชันเดียวจำลองไม่ได้) — ล็อกแถวแม่ for update (job_worker_auth p_lock / job_office_begin ล็อกแม่ก่อน) ตรวจด้วยการอ่านโค้ดเท่านั้น
--  10.1-6  UPDATE/INSERT ตรง: parent/lot_seq/split_out · split_out บนขั้นไม่ received · ลด/เพิ่ม split_out นอก RPC ·
--          split_from ผิดขั้น · ส่วนซ้อน 2 ชั้น · source/metal ไม่ตรงแม่ · token ให้ส่วน · lot_seq ชน · unique ใบแม่ซ้ำ        -> G1 G2 G3 G4 G5 G6 G7 G8 G9 · MU-11 MU-12 MU-17
--  10.1-7  auto-close ขั้นที่ split_out > 0 (ช่างถัดไปรับส่วนเดิมขณะผู้ถือยังค้าง)                              -> H1 H2 · ต้องไม่พัง H3 · A8 (resolve ไม่เสนอ receive) · MU-3 MU-22
--  10.1-8  รับ qty = 0 · > ที่ส่ง · NaN · ขั้นแรกของใบส่ง p_qty_received                                         -> I1 I2 I3 I4 · MU-4
--  10.1-9  ชี้แจงโดยคนไม่ใช่ผู้ส่ง/ไม่มี can_external/ซ้ำ/kind นอกชุด/ไม่มีเหตุผล · UPDATE/DELETE แถวตรง            -> J3 J4 J5 J6 J7 J8 J9b J9c J9d J9e · MU-18 MU-19 MU-33
--  10.1-10 ช่างยกเลิกส่วนที่คนอื่นแยก · ส่วนที่ขั้นถัดไปรับแล้ว · ส่วนมี discrepancy · ออฟฟิศ return เมื่อขั้นแม่ sent · scrap ไม่มีเหตุผล -> K1a K2a K3 K4 K5 K6 K7 · MU-20 MU-21
--          ❌ "ส่วนนอกร้านโดยไม่มี can_external" + "ส่วนที่มี alloc งวด" = ไม่มีเทสต์ (L2/L3 — ตารางนอกร้าน/งวดยังไม่มี)
--  10.1-11 job_done แม่ขณะมีส่วน open/discrepancy open · job_done ไม่รวม split_out · job_cancel แม่ที่มีส่วน · reopen ขั้นที่แยก -> A11b J9 L1 L2 L3 L4 L5 L6 L7 L8 · MU-13 MU-24 MU-25 MU-26 MU-27
--  10.1-12 Σ ต้นไม้ไม่เท่า qty_planned หลังทุก RPC (mutant ลด split_out ตรง) + v_job_tree_drift ว่าง                    -> A7 A9 A10 A11a J2 K1b K2b M0 M1 M2 M3 Q1c (drift ตรวจทุก section) · MU-23 MU-32
--  10.1-13 job_token_issue: purpose/lot นอกชุด · เกินเพดาน · ค่าเริ่ม revoke (ใบหลายส่วน+sublot ไม่เพิกถอน · ใบส่วนเดียว traveler เพิกถอน) -> N1 N2 N3 N4 N5 N6a N6b N7a N7b · MU-15 MU-16 MU-34
--  10.1-14 response resolve/send/receive: ไม่มี key cost/price/thb/customer/quote_no · ทอง prev_weight_out_g null         -> A12 (keys ทุก response) · A8 · Q2b (ทอง = เท่าฉบับเดิม null)
--          ❌ "ยิงหน้า /w/<token> จริง grep RSC" = ไม่มี (ฝั่ง TS/Next — lib/jobs/worker-view.test.ts + worker-boundary.test.ts ครอบ allowlist)
--  10.1-15 anon/authenticated execute RPC ใหม่/ตารางใหม่ (18.5) · overload ทุกตัวที่ drop/replace = 1 แถว pg_proc            -> P1 P2 P3 P4 P5 P6 P7 · MU-28 MU-29 · (รัน scripts/check-analytics-grants.sql หลัง apply ด้วย)
--  10.2    ใบ J1/M1 เดิมทุก status บน prod: parent null/lot_seq 0/split 0 · v_job_board แถวครบ+คอลัมน์ใหม่ค่าว่าง/0           -> Q1a Q1b
--          job_worker_resolve เท่าเดิมทุก key (ใบจริง + ใบใหม่ 5 แบบ × ผู้ดู 3 × 2 สถานะ)                                -> Q2a Q2b
--          job_core_receive/send เท่าฉบับเดิมทุกคำสั่ง (เงินชั่ง/เงินไม่ชั่ง/ทอง · ปฏิเสธ+สำเร็จ ~28 คำสั่ง)                -> Q31 Q32 Q33 (เทียบ pg_temp.core_*_legacy = def จาก DB สด)
--          ด่านทอง ±0.05 g · แบบการบันทึก 0176 · ด่านน้ำหนัก/เศษ 0178 ไม่เปลี่ยน                                         -> Q33 (handoff_mismatch ทอง) · Q31 (scrap_over/not_asked ผ่าน golden) · A2e A2f A2g (ขั้นชั่ง + loss ไม่เทียบ)
--          ใบไม่แบ่ง รับ→ส่งทั้งหมด→job_done ผลเท่า J1                                                                    -> Q4 · B1e · H3 · L7 L8
--          แยก 1 ครั้ง→ส่วนเดิน→แม่ส่งที่เหลือ→job_done ส่วนแล้วแม่ · แยกซ้อน · แยกที่ QC · แยกจากใบเดิม profile null         -> A1..A11d · A2a A2b A2c A2d
--          ช่างยกเลิกแยกแล้วส่งใหม่ · รับไม่ครบ→ชี้แจง scrap/lost→Σ ครบ · ออฟฟิศ void แล้วผู้รับส่งต่อตามปกติ              -> K1b K1c · J1 J5 J10 · J9b J9c J9d
--          ใบย่อยพิมพ์ 3 ใบ ทุก QR เปิดใบเดียวกัน · เพิกถอน 1 ใบ ใบอื่นยังใช้ · ปิด full เพิกถอนหมด                          -> N3 N4 N6a · A11c (done เพิกถอนทุกใบ)
--          ใบผลิต (production): ส่วนไม่ชน unique · existing_job = แม่ · production_order_done ไม่ถูกแตะ                  -> A2h · MY (md5 ทุกฟังก์ชัน oem_*/production_*/stock_* เท่าเดิม)
--          00:00–07:00 ไทย: sent_on/received_on ของขั้นแยก = วันไทย                                                       -> P8 (static: ใช้ job_today() ไม่มี current_date) · A5 (= job_today()) ·
--          ❌ ไม่ได้จำลองนาฬิกาช่วง 00:00–07:00 จริง (now() คงที่ทั้งทรานแซกชัน) — ครอบแบบ static เท่านั้น
--  security H1  รับไม่ครบ: เทียบ+บันทึก gap ทุกครั้งที่ทั้งสองขั้นชั่ง (ทองรับครบ |gap|>0.05 = ปฏิเสธเดิม · รับไม่ครบ gap>+0.05 = ปฏิเสธ) · weight_gap_g ในส่วนต่าง · ผู้ส่งชี้แจงทอง = office_required · loss view/บอร์ด handoff_gap_partial_g · response ช่างไม่เห็น gap
--                                                                        -> T11 T12a T12b T13 T14 T15 · Q33 (รับครบทอง = เดิมเป๊ะ) · MU-35 MU-37 MU-39
--  security H2  ทองชั่งตอนแบ่ง (มติ 19 ต.ค.): ขั้นชั่ง+ทอง ต้องส่ง p_weight_move_g (ช่าง+ออฟฟิศ) · ผู้รับส่วนใหม่เทียบ ±0.05 g · กระทบยอดน้ำหนัก (weight_split_out_g · loss ไม่ null) · เงิน/ขั้นไม่ชั่งไม่เปลี่ยน
--                                                                        -> T21 T22 T23 T24 T24b T25 T26 T27a T27b T28a T28b T28c · A2e A2f A2g (เงินเดิม) · MU-38 MU-40 MU-41 MU-42 MU-43 MU-44
--  security M1  รับไม่ครบขณะขั้นก่อนยังไม่ส่ง = prev_not_sent (ต้องไม่พัง: รับครบ auto-close เดิม)                  -> T31 · H3 · MU-36
--  security M3  v_production_order_job_mismatch รวมยอดดีทั้งต้นไม้                                                -> T41a T41b (หรือ T41s static ถ้าตั้ง qty_done ไม่ได้)
--          ❌ M3 ไม่มี mutant (เป็น view — ตัวรัน mutant เปลี่ยนเฉพาะฟังก์ชัน/grant) · ❌ weight_link ใน guard ไม่มี mutant เฉพาะ (ด่านแรกของ guard บล็อกก่อน — ครอบด้วย T24b ผ่าน drift view)
--  security L4  ออฟฟิศแยกต้องส่ง p_qty_hold (บังคับทุกช่องทาง)                                                    -> B4d · MU-9
--  security L6/L7  ฝั่ง TS (job-lots.test.ts) / หัวไฟล์ migration — ไม่มีเทสต์ DB (บอกตรงๆ)
--  กติกาเหล็ก: state ไม่ขยับ (ตัวนับเลขใบงาน/ทุกตาราง) · ฟังก์ชันอื่นไม่ถูกแตะ · trigger เปิดครบ                           -> K0 K0c MY (+ post-check ใน migration §9)
--  mutant 59 จุด: MU-1..MU-59 (รายการและ expect อยู่ท้ายไฟล์ · MX ต้องจับครบ)
--
--  ❌ ไม่มีเทสต์ครอบ (บอกตรงๆ):
--    - race หลาย connection (2 มือถือพร้อมกัน) — ดู 10.1-5 · ครอบด้วยกลไก CAS + การอ่านโค้ด
--    - PostgREST จริง (named args) / server action / หน้า /w/ จริง = ไม่มี (vitest ฝั่ง lib/ ครอบ allowlist + signature ที่ส่ง)
--    - เคสส่วนนอกร้าน (can_external ยกเลิกส่งออก) · งวด/alloc = L2/L3
--    - ข้อมูลเดิมที่ผิดนิยามต้นไม้ (ถ้ามีบน prod ในอนาคต) — job_tree_assert ข้ามต้นไม้ที่ไม่มีส่วน/ส่วนต่าง โดยตั้งใจ (ไม่ให้ใบเดิมพังจากด่านใหม่); Q1c ยืนยันว่า ณ ตอนนี้ drift ว่างทั้ง DB
--    - ตัวอักษรล่องหนนอกชุด oem_text_strip_invisible (ทดสอบแค่ ZWSP "." tab) — พึ่งชุดเดียวกับ note ทุกช่อง
--    - surplus ระดับต้นไม้ (design §3: surplus_* คิดเฉพาะใบแม่)

--
--  security re-review (19 ต.ค.): M-A board/loss ทั้งต้นไม้ · M-B excess + note · M-C น้ำหนักของเสียตอนยกเลิกส่วน · L-1 ผลรวม gap · L-2 ล็อก 3 ครั้ง · L-3 สะสม/scrap_over
--    M-A (tree_* ที่บอร์ด + v_job_tree_stage_loss)  -> U1a U1b · M-B (snapshot/excess/note_required)  -> U2a U2b U2c U2d · MU-49 MU-50 MU-51
--    M-C (scrap_weight_required/เก็บ/drift/ต้องไม่พัง) -> U3a U3b U3c U3d U3e · MU-52 MU-53 MU-54 MU-55 MU-56 · L-1 (tree_lot_first_gap_sum_g) -> U1b U1c
--    L-2 (ล็อกขั้นหลังรับไม่ครบชั่งไม่ตรง 3 ครั้ง · ออฟฟิศปลดล็อก · แคบ) -> U4a U4b U4c · MU-45 MU-46 MU-47 MU-48
--    L-3 (แยกรอบสองเกินสะสม · scrap_over หักน้ำหนักที่แยก) + weight_move_over -> U5a U5b U5c T22 · MU-57 MU-58 MU-59
--    ❌ ไม่มี mutant: view v_job_board.tree_* / v_job_tree_stage_loss / v_job_discrepancy / drift cancel_weight (view — ตัวรัน mutant เปลี่ยนเฉพาะฟังก์ชัน/grant) · ครอบด้วย U1a-c U2a U3b U3c แบบตรวจค่า
--
-- ชุดนี้ยาวเกินเพดาน statement_timeout ปริยายของ pooler (เคยถูกตัดที่ 57014 ตอนมี mutant 59 จุด) — ตั้งเฉพาะทรานแซกชันนี้ (set local · ถอยพร้อม rollback)
set local statement_timeout = '45min';
-- ===== helper จาก verify-0176 (ลอกตรง) =====
create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text
 language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n'
$c$;

-- รัน SQL ที่คืน jsonb · error -> {_err,_state,_hint} (ไม่ปล่อยให้ทั้งชุดตายกลางทาง)
create function pg_temp.q(p_sql text) returns jsonb
 language plpgsql as $c$
declare
  v jsonb; v_msg text; v_state text; v_hint text;
begin
  execute p_sql into v;
  return coalesce(v, '{}'::jsonb);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
  return jsonb_build_object('_err', v_msg, '_state', v_state, '_hint', v_hint);
end;
$c$;

-- รัน statement ที่ไม่คืนค่า · คืน 'OK' หรือ 'ERR:<sqlstate>:<msg>'
create function pg_temp.x(p_sql text) returns text
 language plpgsql as $c$
declare v_msg text; v_state text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  return 'ERR:' || v_state || ':' || v_msg;
end;
$c$;

create function pg_temp.std() returns text[] language sql as $c$
  select array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'polish', 'qc', 'pack'] $c$;
create function pg_temp.code(r jsonb) returns text language sql as $c$ select coalesce(r ->> 'code', r ->> '_hint', r ->> '_state') $c$;

create function pg_temp.o_recv(p_shop uuid, p_job uuid, p_seq int, p_on date, p_w numeric default null,
                               p_worker uuid default null, p_name text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_office_receive(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L,
      p_weight_in_g=>%L, p_worker_id=>%L, p_assignee_name=>%L, p_actor=>%L)',
      p_shop, p_job, p_seq, p_on, p_w, p_worker, p_name, '00000000-0000-0000-0000-0000000000a1'::uuid)) $c$;
create function pg_temp.o_send(p_shop uuid, p_job uuid, p_seq int, p_on date, p_w numeric default null, p_scrap int default 0,
                               p_reason text default null, p_added numeric default 0, p_note text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_office_send(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L,
      p_weight_out_g=>%L, p_qty_scrap=>%L, p_scrap_reason=>%L, p_metal_added_g=>%L, p_weight_note=>%L, p_actor=>%L)',
      p_shop, p_job, p_seq, p_on, p_w, p_scrap, p_reason, p_added, p_note, '00000000-0000-0000-0000-0000000000a1'::uuid)) $c$;

create function pg_temp.w_res(p_tokh text, p_sesh text default null, p_ip text default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.job_worker_resolve(%L, %L, %L)', p_tokh, p_sesh, p_ip)) $c$;
create function pg_temp.w_recv(p_tokh text, p_sesh text, p_seq int, p_w numeric default null, p_ip text default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.job_worker_receive(%L, %L, %L, %L, %L, %L)', p_tokh, p_sesh, p_seq, p_w, 'verify-ua/1.0', p_ip)) $c$;

create function pg_temp.login(p_tokh text, p_worker uuid, p_pin text) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  r := pg_temp.q(format('select analytics.worker_pin_verify(%L, %L, %L, %L, %L)', p_tokh, p_worker, p_pin, 'verify-ua/1.0', null));
  if (r ->> 'ok') = 'true' then
    r := r || jsonb_build_object('session_hash', analytics.job_sha256_hex(r ->> 'session_token'));
  end if;
  return r;
end;
$c$;

-- ออก token ให้ใบงาน -> {token, hash, print_no}
create function pg_temp.tok(p_shop uuid, p_job uuid, p_revoke boolean default true) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  r := pg_temp.q(format('select analytics.job_token_issue(%L, %L, %L, %L)', p_shop, p_job, p_revoke, '00000000-0000-0000-0000-0000000000a1'::uuid));
  if r ? 'token' then
    r := r || jsonb_build_object('hash', analytics.job_sha256_hex(r ->> 'token'));
  end if;
  return r;
end;
$c$;

create function pg_temp.clone_deal(p_tpl_item uuid, p_metal text, p_qty int, p_root uuid default null, p_status text default 'won',
                                   p_cust text default null, p_new_design boolean default null, p_seq int default 1) returns jsonb
 language plpgsql as $c$
declare
  v_q   uuid := gen_random_uuid();
  v_i   uuid := gen_random_uuid();
  v_item  analytics.oem_quote_item;
  v_quote analytics.oem_quote;
  v_input jsonb;
begin
  select * into v_item from analytics.oem_quote_item where id = p_tpl_item;
  select * into v_quote from analytics.oem_quote where id = v_item.quote_id;
  v_input := v_item.input || jsonb_build_object('metal', p_metal)
             || case when p_new_design is null then '{}'::jsonb else jsonb_build_object('is_new_design', p_new_design) end;
  insert into analytics.oem_quote
    select (jsonb_populate_record(null::analytics.oem_quote,
      to_jsonb(v_quote) || jsonb_build_object('id', v_q, 'quote_no', 'V172-' || substr(v_q::text, 1, 8), 'status', p_status,
        'root_quote_id', coalesce(p_root, v_q), 'parent_quote_id', null,
        'customer_name', coalesce(p_cust, v_quote.customer_name)))).*;
  insert into analytics.oem_quote_item
    select (jsonb_populate_record(null::analytics.oem_quote_item,
      to_jsonb(v_item) || jsonb_build_object('id', v_i, 'quote_id', v_q, 'seq', p_seq, 'input', v_input, 'qty', p_qty))).*;
  return jsonb_build_object('quote_id', v_q, 'item_id', v_i, 'quote_no', 'V172-' || substr(v_q::text, 1, 8));
end;
$c$;

create function pg_temp.jid(r jsonb) returns uuid language sql as $c$ select (r ->> 'job_id')::uuid $c$;
create function pg_temp.sv(p_job uuid, p_seq int, p_col text) returns text language plpgsql as $c$
declare v text;
begin
  execute format('select %I::text from analytics.job_stage where job_id = %L and seq = %s', p_col, p_job, p_seq) into v;
  return v;
end;
$c$;
create function pg_temp.as_role(p_role text, p_sql text) returns text
 language plpgsql as $c$
declare v_msg text; v_state text;
begin
  execute format('set local role %I', p_role);
  execute p_sql;
  reset role;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  reset role;
  return 'ERR:' || v_state || ':' || v_msg;
end;
$c$;

create function pg_temp.wu(p_shop uuid, p_name text, p_codes text, p_pin text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_display_name=>%L, p_stage_codes=>%L::text[], p_pin=>%L, p_actor=>%L)',
    p_shop, p_name, '{' || coalesce(nullif(p_codes, ''), 'cad,print3d,mold,wax_inject,wax_tree,invest_burnout,cast,cut_sprue,polish,gem_set,plating,qc,pack') || '}', p_pin, '00000000-0000-0000-0000-0000000000a1'::uuid)) $c$;

create function pg_temp.newtok(p_shop uuid, p_job uuid) returns text language sql as $c$ select pg_temp.tok(p_shop, p_job) ->> 'hash' $c$;
create function pg_temp.wid(p_shop uuid, p_name text, p_pin text) returns uuid language sql as $c$ select (pg_temp.wu(p_shop, p_name, '', p_pin) ->> 'id')::uuid $c$;

create function pg_temp.snap() returns text
 language plpgsql as $c$
declare v text := ''; r record; n text;
begin
  for r in select unnest(array['job', 'job_stage', 'job_event', 'job_token', 'worker', 'worker_audit', 'worker_session', 'worker_rate_limit', 'job_counter', 'job_stage_def', 'job_record_profile', 'job_record_profile_stage',
                               'oem_quote', 'oem_quote_item', 'oem_receipt', 'oem_doc_counter', 'oem_quote_audit', 'production_order', 'production_order_item', 'production_order_counter',
                               'stock_lot', 'stock_lot_ledger']) as t loop
    if to_regclass('analytics.' || r.t) is not null then
      execute format('select count(*)::text || ''/'' || coalesce(md5(string_agg(x::text, ''|'' order by x::text)), '''') from analytics.%I x', r.t) into n;
      v := v || r.t || '=' || n || ';';
    end if;
  end loop;
  for r in select unnest(array['shop', 'product', 'central_stock', 'catalog_audit_log']) as t loop
    if to_regclass('public.' || r.t) is not null then
      execute format('select count(*)::text || ''/'' || coalesce(md5(string_agg(x::text, ''|'' order by x::text)), '''') from public.%I x', r.t) into n;
      v := v || 'public.' || r.t || '=' || n || ';';
    end if;
  end loop;
  return md5(v);
end;
$c$;

create function pg_temp.mutate(p_name text, p_from text, p_to text) returns void
 language plpgsql as $c$
declare v_oid oid; v_def text; v_new text;
begin
  select p.oid into strict v_oid from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  v_new := replace(v_def, p_from, p_to);
  if v_new = v_def then
    raise exception 'MUTANT_NOT_APPLIED: % ไม่พบข้อความ [%]', p_name, p_from;
  end if;
  execute v_new;
end;
$c$;

create function pg_temp.rej(r jsonb, p_hint text) returns boolean language sql as $c$
  select coalesce(r ? '_err' and r ->> '_state' = '22023' and (p_hint is null or r ->> '_hint' = p_hint), false) $c$;

create function pg_temp.pid(p_shop uuid, p_kind text) returns uuid language sql as $c$
  select id from analytics.job_record_profile where shop_id = p_shop
     and case p_kind when 'def' then is_default when 'gold' then is_default_gold when 'none' then name like 'ไม่ชั่ง%' end limit 1 $c$;
create function pg_temp.pu(p_shop uuid, p_id uuid, p_name text, p_note text, p_stages text, p_active boolean default null,
                           p_seq int default null, p_fw boolean default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_record_profile_upsert(p_shop_id=>%L, p_id=>%L, p_name=>%L, p_note=>%L, p_stages=>%L::jsonb, p_is_active=>%L, p_seq=>%L, p_require_final_weight=>%L, p_actor=>%L)',
    p_shop, p_id, p_name, p_note, p_stages, p_active, p_seq, p_fw, '00000000-0000-0000-0000-0000000000a1'::uuid)) $c$;

create function pg_temp.jcp(p_shop uuid, p_item uuid, p_codes text[], p_profile uuid) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_create_from_quote_item(p_shop_id=>%L, p_quote_item_id=>%L, p_stage_codes=>%L::text[], p_start_gate_note=>%L, p_design_label=>%L, p_actor=>%L, p_profile_id=>%L)',
    p_shop, p_item, coalesce(p_codes, pg_temp.std()), 'verify: เริ่มผลิตก่อนมัดจำ', 'v176-ชื่อเรียกภายใน', '00000000-0000-0000-0000-0000000000a1'::uuid, p_profile)) $c$;
-- โคลนดีล + สร้างใบงาน (p_profile null = ค่าเริ่มตามโลหะ)
create function pg_temp.mkp(p_shop uuid, p_tpl uuid, p_metal text, p_profile uuid default null, p_codes text[] default null, p_qty int default 10) returns jsonb
 language plpgsql as $c$
declare d jsonb;
begin
  d := pg_temp.clone_deal(p_tpl, p_metal, p_qty, null, 'won', null, false);
  return d || pg_temp.jcp(p_shop, (d ->> 'item_id')::uuid, p_codes, p_profile);
end;
$c$;

create function pg_temp.leg(p_job uuid) returns void language plpgsql as $c$
declare v_metal text;
begin
  select metal into v_metal from analytics.job where id = p_job;
  execute 'alter table analytics.job disable trigger trg_job_guard';
  update analytics.job set profile_id = null, profile_name = null, require_final_weight = false, weigh_required = v_metal in ('gold', 'silver') where id = p_job;
  execute 'alter table analytics.job enable trigger trg_job_guard';
  update analytics.job_stage s
     set weigh_required = case v_metal when 'gold' then d.metal_present when 'silver' then d.weigh_default else false end,
         scrap_qty_ask = true, scrap_weight_ask = false
    from analytics.job_stage_def d where s.job_id = p_job and d.shop_id = s.shop_id and d.code = s.stage_code;
end;
$c$;

create function pg_temp.rw(p_shop uuid, p_job uuid, p_w numeric, p_to int default 8) returns jsonb language plpgsql as $c$
declare s int; r jsonb; v_st text; v_today date := analytics.job_today();
begin
  for s in 1 .. p_to loop
    select status into v_st from analytics.job_stage where job_id = p_job and seq = s;
    if v_st = 'pending' then
      r := pg_temp.o_recv(p_shop, p_job, s, v_today, p_w, null, 'verify');
      if r ? '_err' then return r || jsonb_build_object('_at', s, '_op', 'recv'); end if;
      v_st := 'received';
    end if;
    if v_st = 'received' then
      r := pg_temp.o_send(p_shop, p_job, s, v_today, p_w);
      if r ? '_err' then return r || jsonb_build_object('_at', s, '_op', 'send'); end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true);
end;
$c$;

create function pg_temp.snap_d() returns text
 language plpgsql as $c$
declare v text := ''; r record; n text;
begin
  for r in select unnest(array['job', 'job_stage', 'job_event', 'job_token', 'worker', 'worker_audit', 'worker_session', 'worker_rate_limit', 'job_counter', 'job_stage_def', 'job_record_profile', 'job_record_profile_stage',
                               'oem_quote', 'oem_quote_item', 'oem_receipt', 'oem_doc_counter', 'oem_quote_audit', 'production_order', 'production_order_item', 'production_order_counter', 'stock_lot', 'stock_lot_ledger']) as t loop
    if to_regclass('analytics.' || r.t) is not null then
      execute format('select count(*)::text || ''/'' || coalesce(md5(string_agg(x::text, ''|'' order by x::text)), '''') from analytics.%I x', r.t) into n;
      v := v || r.t || '=' || n || E'
';
    end if;
  end loop;
  return v;
end;
$c$;

create function pg_temp.xr(p_sql text) returns text
 language plpgsql as $c$
declare v_msg text; v_state text;
begin
  execute p_sql;
  raise exception 'XR_PASSED';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  if v_msg = 'XR_PASSED' then return 'OK'; end if;
  return 'ERR:' || v_state || ':' || v_msg;
end;
$c$;
create function pg_temp.sess(p_tokh text, p_worker uuid, p_pin text) returns text
 language sql as $c$ select pg_temp.login(p_tokh, p_worker, p_pin) ->> 'session_hash' $c$;

-- loss_g ของขั้น (v_job_stage_loss = in + added - out - scrap) -> numeric หรือ null
create function pg_temp.loss(p_job uuid, p_seq int) returns numeric
 language sql as $c$
  select l.loss_g from analytics.v_job_stage_loss l join analytics.job_stage s on s.id = l.job_stage_id where s.job_id = p_job and s.seq = p_seq $c$;

create function pg_temp.nev(p_job uuid) returns int language sql as $c$ select count(*)::int from analytics.job_event where job_id = p_job $c$;

-- ข้อความที่ช่างเห็น/ออฟฟิศเห็นจากด่านใหม่ต้องไม่มีตัวเลข (N1 ทอง)
create function pg_temp.nodigit(r jsonb) returns boolean
 language sql as $c$ select coalesce(coalesce(r ->> 'message', r ->> '_err') !~ '[0-9]', false) $c$;

-- แบบ "ชั่งหล่อ+ตัดต้น": cast = ชั่ง+ถามชิ้นเสีย (ไม่ถามเศษ) · cut_sprue = ชั่ง+ถามเศษ · wax_inject = ถามชิ้นเสียอย่างเดียว (ไม่ชั่ง)
create function pg_temp.mkprof(p_shop uuid, p_name text default 'v178-ชั่งหล่อ+ตัดต้น') returns uuid
 language sql as $c$
  select (pg_temp.pu(p_shop, null, p_name, null,
    '[{"stage_code":"cast","weigh":true,"scrap_qty":true},{"stage_code":"cut_sprue","weigh":true,"scrap_weight":true},{"stage_code":"wax_inject","scrap_qty":true}]') ->> 'id')::uuid $c$;
CREATE OR REPLACE FUNCTION pg_temp.core_send_legacy(p_job_id uuid, p_expected_seq integer, p_occurred_on date, p_weight_out numeric, p_qty_scrap integer, p_scrap_reason text, p_metal_added numeric, p_weight_note text, p_scrap_weight numeric, p_worker_id uuid, p_channel text, p_actor uuid, p_device_hint text, p_enforce_holder boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $leg1$
declare
  v_job    analytics.job%rowtype;
  v_s      analytics.job_stage%rowtype;
  v_s2     analytics.job_stage%rowtype;
  v_today  date := analytics.job_today();
  v_scrap  int := coalesce(p_qty_scrap, 0);
  v_added  numeric := coalesce(p_metal_added, 0);
  v_reason text := null;
  v_note   text := null;
  v_name   text;
  v_def    text;
  v_room   numeric;
  v_next   record;
  v_codes  constant text[] := array['porosity', 'broken', 'wrong_design', 'missing', 'other'];
begin
  select * into v_job from analytics.job where id = p_job_id;
  if not found then
    return analytics.job_fail('job_not_found', 'ไม่พบใบงาน');
  end if;
  if v_job.status in ('done', 'cancelled') then
    return analytics.job_fail('job_closed', 'ใบงานนี้ปิดแล้ว ส่งต่อไม่ได้');
  end if;
  if p_expected_seq is null then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  select * into v_s from analytics.job_stage where job_id = p_job_id and seq = p_expected_seq;
  if not found or v_s.status = 'skipped' then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  if v_s.status = 'sent' then
    return analytics.job_fail('already_sent', 'ขั้นนี้ส่งต่อไปแล้ว');
  end if;
  if v_s.status = 'pending' then
    return analytics.job_fail('not_received', 'ขั้นนี้ยังไม่ได้รับงาน ส่งต่อไม่ได้');
  end if;

  -- ช่างส่งต่อได้เฉพาะขั้นที่ตัวเองรับ (design §3 ข้อ 18) · ออฟฟิศไม่ถูกจำกัด
  if p_enforce_holder and v_s.worker_id is distinct from p_worker_id then
    select coalesce(w.display_name, v_s.assignee_name, 'ผู้ถืออื่น') into v_name
      from (select 1) x left join analytics.worker w on w.id = v_s.worker_id;
    return analytics.job_fail('not_holder', format('งานนี้อยู่กับ %s ไม่ใช่คุณ', v_name), jsonb_build_object('by', v_name));
  end if;

  if p_occurred_on is null
     or p_occurred_on > v_today
     or (p_channel = 'worker_qr' and p_occurred_on <> v_today)
     or p_occurred_on < v_today - 14 then
    return analytics.job_fail('date_invalid', 'วันที่ส่งต่อต้องไม่ใช่อนาคตและย้อนหลังได้ไม่เกิน 14 วัน (ช่างสแกนผ่าน QR ใช้วันนี้เท่านั้น)');
  end if;
  if p_occurred_on < v_s.received_on then
    return analytics.job_fail('date_invalid', 'วันที่ส่งต่อต้องไม่ก่อนวันที่รับงานของขั้นนี้');
  end if;

  -- จำนวน: เข้า = ออก + เสีย · ของหายต้องเป็นเสียเหตุผล missing (ไม่มีช่อง "หายเฉยๆ")
  if v_scrap < 0 or v_scrap > v_s.qty_in then
    return analytics.job_fail('qty_invalid', format('จำนวนของเสียต้องอยู่ระหว่าง 0 ถึง %s ชิ้น', v_s.qty_in));
  end if;
  if v_scrap > 0 then
    v_reason := nullif(btrim(p_scrap_reason), '');
    if v_reason is null or not (
         v_reason = any (v_codes)
         or (analytics.oem_note_present(v_reason) and analytics.oem_note_valid(v_reason) and length(v_reason) <= 200 and v_reason !~ '[\r\n\t]')
       ) then
      return analytics.job_fail('reason_required', 'ของเสียต้องระบุเหตุผล (รูพรุน/หัก/ผิดแบบ/หาย/อื่นๆ)');
    end if;
  elsif nullif(btrim(p_scrap_reason), '') is not null then
    return analytics.job_fail('reason_unexpected', 'ไม่มีของเสีย จึงไม่ต้องระบุเหตุผลของเสีย');
  end if;

  -- 0178 M1: ช่างส่งน้ำหนักเศษได้เฉพาะขั้นที่แบบการบันทึกถามเศษ (scrap_weight_ask) · ใบเดิมทุกขั้น ask=false = ส่งเศษไม่ได้ · ออฟฟิศไม่ถูกจำกัด · ข้อความไม่มีตัวเลขน้ำหนัก (N1)
  if p_channel = 'worker_qr' and p_scrap_weight is not null and not v_s.scrap_weight_ask then
    return analytics.job_fail('scrap_weight_not_asked', 'ขั้นนี้ไม่ได้บันทึกเศษโลหะ — โหลดหน้าใหม่');
  end if;

  -- น้ำหนัก
  if not analytics.job_weight_ok(p_weight_out) then
    return analytics.job_fail('weight_invalid', 'น้ำหนักออกต้องมากกว่า 0 และไม่เกิน 100,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)');
  end if;
  if not analytics.job_weight_ok(v_added, true) or not analytics.job_weight_ok(p_scrap_weight) then
    return analytics.job_fail('weight_invalid', 'น้ำหนักเติมโลหะ/เศษที่เก็บได้ไม่ถูกต้อง (ทศนิยมไม่เกิน 3 ตำแหน่ง ไม่เกิน 100,000 กรัม)');
  end if;
  if v_s.weigh_required and p_weight_out is null then
    return analytics.job_fail('weight_required', 'ขั้นนี้ต้องชั่งน้ำหนักออกก่อนส่งต่อ');
  end if;
  if v_added > 0 then
    begin
      v_note := analytics.job_text_clean(p_weight_note, 'หมายเหตุเติมโลหะ', 200, true);
    exception when others then
      return analytics.job_fail('note_required', 'เติมโลหะต้องระบุหมายเหตุ');
    end;
  elsif nullif(btrim(p_weight_note), '') is not null then
    begin
      v_note := analytics.job_text_clean(p_weight_note, 'หมายเหตุน้ำหนัก', 200, false);
    exception when others then
      return analytics.job_fail('note_invalid', 'หมายเหตุน้ำหนักมีอักขระที่ไม่อนุญาตหรือยาวเกิน 200 ตัวอักษร');
    end;
  end if;
  if p_weight_out is not null and v_s.weight_in_g is not null and p_weight_out > v_s.weight_in_g + v_added then
    return analytics.job_fail('weight_over',
      format('น้ำหนักออกมากกว่าน้ำหนักเข้า %s g — ถ้าเติมโลหะให้ระบุเติมโลหะพร้อมหมายเหตุ',
             trim_scale(p_weight_out - v_s.weight_in_g - v_added)::text));
  end if;
  -- 0178 M1: เศษต้องไม่เกินส่วนที่หายไป (loss = in + added - out - scrap ต้อง >= 0) · คำนวณเฉพาะเมื่อมีทั้งน้ำหนักเข้า/ออก (ตรงกับ v_job_stage_loss) · ค่าใดเป็น null = ข้าม (ไม่ใช่ผ่านหรือตก — ไม่มี loss ให้บิดเบือน)
  v_room := case when p_weight_out is not null and v_s.weight_in_g is not null then v_s.weight_in_g + v_added - p_weight_out end;
  if p_scrap_weight is not null and v_room is not null and p_scrap_weight > v_room then
    return analytics.job_fail('scrap_over', 'น้ำหนักเศษมากกว่าส่วนที่หายไป — ชั่งใหม่');
  end if;

  update analytics.job_stage
     set status = 'sent', sent_on = p_occurred_on, qty_out = qty_in - v_scrap, qty_scrap = v_scrap, scrap_reason = v_reason,
         weight_out_g = p_weight_out, metal_added_g = v_added, weight_note = v_note, scrap_weight_g = p_scrap_weight
   where id = v_s.id
   returning * into v_s2;

  perform analytics.job_event_write(p_job_id, v_s.id, 'stage_send', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
    jsonb_build_object('stage_code', v_s.stage_code, 'auto_closed', false,
                       'before', analytics.job_stage_state(v_s), 'after', analytics.job_stage_state(v_s2)));

  select s.seq, s.stage_code, d.name_th into v_next
    from analytics.job_stage s
    join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
   where s.job_id = p_job_id and s.status = 'pending' order by s.seq limit 1;
  select d.name_th into v_def from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_s.stage_code;

  return jsonb_build_object('ok', true, 'action', 'send', 'job_no', v_job.job_no, 'stage_seq', v_s.seq, 'stage_code', v_s.stage_code,
                            'stage_name', v_def, 'sent_on', p_occurred_on, 'qty_out', v_s2.qty_out, 'qty_scrap', v_s2.qty_scrap,
                            'weight_out_g', v_s2.weight_out_g,
                            'next_stage', case when v_next.stage_code is null then null
                                          else jsonb_build_object('seq', v_next.seq, 'code', v_next.stage_code, 'name', v_next.name_th) end);
end;
$leg1$
;
CREATE OR REPLACE FUNCTION pg_temp.core_recv_legacy(p_job_id uuid, p_expected_seq integer, p_occurred_on date, p_weight_in numeric, p_worker_id uuid, p_assignee text, p_channel text, p_actor uuid, p_device_hint text, p_enforce_scope boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $leg2$
declare
  v_job     analytics.job%rowtype;
  v_t       analytics.job_stage%rowtype;
  v_t2      analytics.job_stage%rowtype;
  v_p       analytics.job_stage%rowtype;
  v_p2      analytics.job_stage%rowtype;
  v_today   date := analytics.job_today();
  v_codes   text[];
  v_name    text;
  v_def     text;
  v_auto    text := null;
  v_gap     numeric := null;
begin
  select * into v_job from analytics.job where id = p_job_id;
  if not found then
    return analytics.job_fail('job_not_found', 'ไม่พบใบงาน');
  end if;
  if v_job.status in ('done', 'cancelled') then
    return analytics.job_fail('job_closed', 'ใบงานนี้ปิดแล้ว รับงานไม่ได้');
  end if;
  if v_job.status = 'on_hold' then
    return analytics.job_fail('job_on_hold', 'ใบงานนี้ถูกพักไว้ รับงานไม่ได้ — แจ้งออฟฟิศ');
  end if;
  if p_expected_seq is null then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;

  select * into v_t from analytics.job_stage where job_id = p_job_id and seq = p_expected_seq;
  if not found then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  if v_t.status = 'received' then
    select coalesce(w.display_name, v_t.assignee_name, 'ผู้รับก่อนหน้า') into v_name
      from (select 1) x left join analytics.worker w on w.id = v_t.worker_id;
    return analytics.job_fail('already_received', format('ขั้นนี้ถูกรับไปแล้วโดย %s', v_name), jsonb_build_object('by', v_name));
  end if;
  if v_t.status <> 'pending' then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  if exists (select 1 from analytics.job_stage s where s.job_id = p_job_id and s.seq < v_t.seq and s.status = 'pending') then
    return analytics.job_fail('out_of_order', 'รับงานข้ามลำดับไม่ได้ — ขั้นก่อนหน้ายังไม่มีใครรับหรือข้าม');
  end if;

  -- วันที่: ช่างผ่าน QR = วันนี้เสมอ · ออฟฟิศย้อนได้ <= 14 วัน ไม่อนาคต (design §3 ข้อ 9 · มติ Q3)
  if p_occurred_on is null
     or p_occurred_on > v_today
     or (p_channel = 'worker_qr' and p_occurred_on <> v_today)
     or p_occurred_on < v_today - 14 then
    return analytics.job_fail('date_invalid', 'วันที่รับงานต้องไม่ใช่อนาคตและย้อนหลังได้ไม่เกิน 14 วัน (ช่างสแกนผ่าน QR ใช้วันนี้เท่านั้น)');
  end if;

  if p_worker_id is null and p_assignee is null then
    return analytics.job_fail('who_required', 'ต้องระบุผู้รับงาน');
  end if;
  if p_enforce_scope and p_worker_id is not null then
    select w.stage_codes into v_codes from analytics.worker w where w.id = p_worker_id;
    if not analytics.job_worker_can_do(v_codes, v_t.stage_code) then
      select d.name_th into v_def from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_t.stage_code;
      return analytics.job_fail('stage_not_allowed', format('งานนี้อยู่ขั้น "%s" ซึ่งคุณไม่ได้รับผิดชอบ', coalesce(v_def, v_t.stage_code)));
    end if;
  end if;

  if not analytics.job_weight_ok(p_weight_in) then
    return analytics.job_fail('weight_invalid', 'น้ำหนักเข้าต้องมากกว่า 0 และไม่เกิน 100,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)');
  end if;
  if v_t.weigh_required and p_weight_in is null then
    return analytics.job_fail('weight_required', 'ขั้นนี้ต้องชั่งน้ำหนักก่อนรับงาน');
  end if;

  -- ด่านมัดจำ (design §3 ข้อ 13 · มติ Q4): รับขั้นแรกของงาน OEM ที่ดีลยังไม่มีเงินเข้าเลย ต้องมีเหตุผลที่ออฟฟิศบันทึกไว้
  if analytics.job_deposit_blocked(v_job) then
    return analytics.job_fail('awaiting_deposit', 'รอมัดจำ — ดีลนี้ยังไม่มีเงินเข้า แจ้งออฟฟิศให้บันทึกเหตุผลก่อนเริ่มงาน');
  end if;

  -- ขั้นก่อนหน้า (ข้ามขั้นที่ skipped): ถ้ายังถือค้าง = ปิดอัตโนมัติ (ยกเว้นทอง) — ยืนยันฝ่ายเดียว (design §5.1 ข้อ 4)
  select * into v_p from analytics.job_stage s
   where s.job_id = p_job_id and s.seq < v_t.seq and s.status <> 'skipped' order by s.seq desc limit 1;
  if found then
    if v_p.status = 'received' then
      -- 0176: ใบทองเดิม (ก่อน profile) คงกติกา J1 · ใบที่มีแบบตัดสินจาก weigh_required ของขั้นก่อน (บล็อกถัดไป)
      if v_job.metal = 'gold' and v_job.profile_id is null then
        return analytics.job_fail('prev_not_sent', 'งานทอง: ขั้นก่อนหน้ายังไม่ได้กดส่งต่อ — ผู้ถือต้องกดส่งต่อพร้อมน้ำหนักออกก่อน');
      end if;
      -- QA 6: ขั้นก่อนหน้าบังคับชั่ง (เงิน: หล่อ/ตัดต้น/ขัด) และยังไม่มีน้ำหนักออก = ห้ามปิดอัตโนมัติ (ไม่งั้นรายงานน้ำหนักหายมีรูเงียบๆ)
      if v_p.weigh_required then
        return analytics.job_fail('prev_not_sent', 'ขั้นก่อนหน้าต้องชั่งน้ำหนักออกก่อน — ให้ผู้ถือกดส่งต่อพร้อมน้ำหนัก หรือแจ้งออฟฟิศกรอกแทน');
      end if;
      if p_occurred_on < v_p.received_on then
        return analytics.job_fail('date_invalid', 'วันรับต้องไม่ก่อนวันที่ขั้นก่อนหน้ารับงาน');
      end if;
      update analytics.job_stage
         set status = 'sent', sent_on = p_occurred_on, qty_out = qty_in, auto_closed = true
       where id = v_p.id
       returning * into v_p2;
      perform analytics.job_event_write(p_job_id, v_p.id, 'stage_send', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
        jsonb_build_object('stage_code', v_p.stage_code, 'auto_closed', true, 'closed_by_receive_of', v_t.stage_code,
                           'before', analytics.job_stage_state(v_p), 'after', analytics.job_stage_state(v_p2)));
      v_auto := v_p.stage_code;
      v_p := v_p2;
    elsif v_p.status <> 'sent' then
      return analytics.job_fail('out_of_order', 'รับงานข้ามลำดับไม่ได้ — ขั้นก่อนหน้ายังไม่เสร็จ');
    end if;
    if p_occurred_on < v_p.sent_on then
      return analytics.job_fail('date_invalid', 'วันรับต้องไม่ก่อนวันที่ขั้นก่อนหน้าส่งต่อ');
    end if;
  end if;

  -- M1: น้ำหนักที่รับ vs น้ำหนักที่ขั้นก่อนหน้าส่งออก · ทอง ต่างเกิน 0.05 g = ปฏิเสธ (ต้องชั่งใหม่/ให้ออฟฟิศย้อนขั้นก่อนแก้) ·
  -- เงิน/ทองเหลือง ไม่บล็อก แต่เก็บส่วนต่างไว้ใน event + v_job_stage_loss.handoff_gap_g
  -- N4: เทียบเฉพาะเมื่อทั้งขั้นก่อนและขั้นนี้บังคับชั่ง (เทียน/ปูนไม่ถูกเทียบกับหล่อ)
  if v_p.id is not null and v_p.status = 'sent' and v_p.weight_out_g is not null and p_weight_in is not null
     and v_t.weigh_required and v_p.weigh_required then
    v_gap := p_weight_in - v_p.weight_out_g;
    if v_job.metal = 'gold' and abs(v_gap) > 0.05 then
      -- N1: ผู้รับต้องชั่งแบบไม่รู้คำตอบ — ข้อความ/ผลลัพธ์ไม่บอกขนาดส่วนต่างหรือน้ำหนักขั้นก่อน · แต่บันทึก event ทุกครั้งที่ไม่ตรงให้ออฟฟิศเห็น
      -- (event_type 'weigh' ที่ 0172 ประกาศไว้แต่ยังไม่ใช้ · payload.kind = handoff_mismatch · คนเรียกฝั่งออฟฟิศ raise ทำให้ event นี้ถอยกลับ ซึ่งยอมรับได้: ออฟฟิศเห็น error ตรงๆ)
      perform analytics.job_event_write(p_job_id, v_t.id, 'weigh', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
        jsonb_build_object('kind', 'handoff_mismatch', 'stage_code', v_t.stage_code, 'weight_in_g', p_weight_in,
                           'prev_weight_out_g', v_p.weight_out_g, 'gap_g', v_gap));
      return analytics.job_fail('handoff_mismatch', 'น้ำหนักที่รับไม่ตรงกับที่ขั้นก่อนส่งมา — ชั่งใหม่ ถ้ายังไม่ตรงให้แจ้งออฟฟิศ');
    end if;
  end if;

  update analytics.job_stage
     set status = 'received', received_on = p_occurred_on, worker_id = p_worker_id, assignee_name = p_assignee,
         qty_in = case when v_p.id is not null then v_p.qty_out else v_job.qty_planned end,
         weight_in_g = p_weight_in
   where id = v_t.id
   returning * into v_t2;

  if v_job.weight_start_g is null and p_weight_in is not null and v_t.weigh_required then
    update analytics.job set weight_start_g = p_weight_in where id = p_job_id;
  end if;

  perform analytics.job_event_write(p_job_id, v_t.id, 'stage_receive', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
    jsonb_build_object('stage_code', v_t.stage_code,
                       'auto_closed_prev', v_auto, 'handoff_gap_g', v_gap,
                       'before', analytics.job_stage_state(v_t), 'after', analytics.job_stage_state(v_t2)));

  select d.name_th into v_def from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_t.stage_code;
  return jsonb_build_object('ok', true, 'action', 'receive', 'job_no', v_job.job_no, 'stage_seq', v_t.seq, 'stage_code', v_t.stage_code,
                            'stage_name', v_def, 'received_on', p_occurred_on, 'qty_in', v_t2.qty_in, 'weight_in_g', v_t2.weight_in_g,
                            'prev_auto_closed', v_auto is not null,
                            'handoff_gap_g', case when v_job.metal = 'gold' then null else v_gap end);
end;
$leg2$
;
CREATE OR REPLACE FUNCTION pg_temp.resolve_legacy(p_token_hash text, p_session_hash text DEFAULT NULL::text, p_ip_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $leg3$
declare
  v_a        jsonb;
  v_job      analytics.job%rowtype;
  v_worker   uuid;
  v_wcodes   text[];
  v_hold     analytics.job_stage%rowtype;
  v_pend     analytics.job_stage%rowtype;
  v_prev     analytics.job_stage%rowtype;
  v_action   text := 'none';
  v_seq      int;
  v_code     text;
  v_name     text;
  v_need_w   boolean := false;
  v_prev_w   numeric := null;
  v_holder   text := null;
  v_paid     numeric;
  v_stages   jsonb;
  v_workers  jsonb := '[]'::jsonb;
  v_started  boolean;
  v_sq       boolean;
  v_sw       boolean;
begin
  v_a := analytics.job_worker_auth(p_token_hash, p_session_hash, p_ip_hash, false, false, 'none');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  select * into v_job from analytics.job where id = (v_a ->> 'job_id')::uuid;
  v_worker := nullif(v_a ->> 'worker_id', '')::uuid;

  select * into v_hold from analytics.job_stage where job_id = v_job.id and status = 'received' limit 1;
  select * into v_pend from analytics.job_stage where job_id = v_job.id and status = 'pending' order by seq limit 1;
  select exists (select 1 from analytics.job_stage where job_id = v_job.id and status in ('received', 'sent')) into v_started;
  if v_hold.id is not null then
    select coalesce(w.display_name, v_hold.assignee_name) into v_holder from (select 1) x left join analytics.worker w on w.id = v_hold.worker_id;
  end if;

  if v_hold.id is null and v_pend.id is null then
    -- QA 5: ทุกขั้นส่งต่อ/ข้ามครบแล้วแต่ออฟฟิศยังไม่ปิดงาน — ไม่ใช่ "ให้ระบุตัว"
    v_action := 'all_done';
  elsif v_worker is null then
    v_action := 'identify';
    -- รายชื่อช่างที่ทำขั้นถัดไปของงานนี้ได้ (ขั้นที่ถือค้างหรือขั้นที่รอรับ) — เฉพาะ id + ชื่อ
    select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'display_name', w.display_name) order by w.display_name), '[]'::jsonb)
      into v_workers
      from analytics.worker w
     where w.shop_id = v_job.shop_id and w.is_active
       and (cardinality(w.stage_codes) = 0
            or (v_hold.id is not null and v_hold.stage_code = any (w.stage_codes))
            or (v_pend.id is not null and v_pend.stage_code = any (w.stage_codes)));
  else
    select w.stage_codes into v_wcodes from analytics.worker w where w.id = v_worker;
    if v_hold.id is not null and v_hold.worker_id = v_worker then
      v_action := 'send'; v_seq := v_hold.seq; v_code := v_hold.stage_code; v_need_w := v_hold.weigh_required;
    elsif v_pend.id is not null then
      v_seq := v_pend.seq; v_code := v_pend.stage_code; v_need_w := v_pend.weigh_required;
      if v_job.status = 'on_hold' then
        v_action := 'on_hold';
      elsif not analytics.job_worker_can_do(v_wcodes, v_pend.stage_code) then
        v_action := 'not_your_stage';
      elsif v_hold.id is not null and ((v_job.metal = 'gold' and v_job.profile_id is null) or v_hold.weigh_required) then
        -- QA N1: ขั้นก่อนบังคับชั่ง (หรือใบทองเดิม) ยังไม่ส่งต่อ -> บอกตั้งแต่ resolve ไม่ใช่ให้กดแล้วไป fail
        v_action := 'prev_not_sent';
      else
        v_action := 'receive';
        -- 0176 (D6): ด่านมัดจำใช้ helper เดียวกับ job_core_receive
        if analytics.job_deposit_blocked(v_job) then
          v_action := 'awaiting_deposit';
        end if;
        select * into v_prev from analytics.job_stage
         where job_id = v_job.id and seq < v_pend.seq and status <> 'skipped' order by seq desc limit 1;
        -- N1: งานทองไม่ส่งน้ำหนักขั้นก่อนให้ผู้รับ (ชั่งแบบไม่รู้คำตอบ) · เงิน/ทองเหลืองส่งตามเดิม
        v_prev_w := case when v_job.metal = 'gold' then null else v_prev.weight_out_g end;
      end if;
    elsif v_hold.id is not null then
      v_action := 'held_by_other'; v_seq := v_hold.seq; v_code := v_hold.stage_code;
    end if;
  end if;

  -- 0176: flag ถามของเสียของขั้นที่ action ชี้ (flag = ถาม ไม่ใช่ด่าน DB)
  if v_seq is not null then
    select s.scrap_qty_ask, s.scrap_weight_ask into v_sq, v_sw from analytics.job_stage s where s.job_id = v_job.id and s.seq = v_seq;
  end if;

  select d.name_th into v_name from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_code;

  select coalesce(jsonb_agg(
           jsonb_build_object('seq', s.seq, 'code', s.stage_code, 'name', d.name_th, 'status', s.status)
           || case when v_worker is not null then
                jsonb_build_object('received_on', s.received_on, 'sent_on', s.sent_on,
                                   'worker_name', coalesce(w.display_name, s.assignee_name), 'auto_closed', s.auto_closed)
              else '{}'::jsonb end
           order by s.seq), '[]'::jsonb)
    into v_stages
    from analytics.job_stage s
    join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
    left join analytics.worker w on w.id = s.worker_id
   where s.job_id = v_job.id;

  return jsonb_build_object(
    'ok', true,
    'job', case when v_worker is null
             then jsonb_build_object('job_no', v_job.job_no, 'status', v_job.status, 'stages', v_stages, 'has_profile', v_job.profile_id is not null)
             else jsonb_build_object('job_no', v_job.job_no, 'status', v_job.status, 'design_label', v_job.design_label,
                                     'sku', v_job.sku_snapshot, 'metal', v_job.metal, 'qty_planned', v_job.qty_planned,
                                     'due_date', v_job.due_date, 'stages', v_stages,
                                     'profile_name', v_job.profile_name, 'has_profile', v_job.profile_id is not null) end,
    'viewer', case when v_worker is null then null
              else jsonb_build_object('worker_id', v_worker, 'display_name', v_a ->> 'worker_name') end,
    'session_expired', (v_a ->> 'session_expired')::boolean,
    'next_action', v_action,
    'action_stage', case when v_seq is null then null
                      else jsonb_build_object('seq', v_seq, 'code', v_code, 'name', v_name, 'weight_required', v_need_w,
                                           'scrap_qty_ask', coalesce(v_sq, true), 'scrap_weight_ask', coalesce(v_sw, false)) end,
    'prev_weight_out_g', v_prev_w,
    -- L1: ชื่อผู้ถือเห็นได้เฉพาะช่างที่ระบุตัวแล้ว
    'held_by', case when v_worker is null then null else v_holder end,
    'workers', v_workers,
    'scrap_reasons', case when v_action = 'send' then to_jsonb(array['porosity', 'broken', 'wrong_design', 'missing', 'other']) else '[]'::jsonb end
  );
end;
$leg3$
;

-- ============================================================================
-- helper เฉพาะ 0181 (ผู้เรียก RPC ใหม่ · ตัวอ่านสถานะต้นไม้) — ทุกตัวคืน jsonb {ok:true,...} หรือ {_err,_state,_hint} เหมือน helper เดิม
-- ============================================================================
create function pg_temp.act() returns uuid language sql as $c$ select '00000000-0000-0000-0000-0000000000a1'::uuid $c$;

-- ออฟฟิศแยกส่วน
-- ส่งตรงตามที่ให้ (รวม p_hold = null) · o_split = เติม p_hold จากจำนวนที่ถืออยู่จริงถ้าไม่ระบุ (DB บังคับ p_qty_hold ทุกช่องทาง — L4)
create function pg_temp.o_split_raw(p_shop uuid, p_job uuid, p_seq int, p_qty int, p_scrap int, p_reason text, p_hold int, p_wmove numeric) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_lot_split(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_qty=>%L, p_qty_scrap=>%L, p_scrap_reason=>%L, p_qty_hold=>%L, p_actor=>%L, p_weight_move_g=>%L)',
    p_shop, p_job, p_seq, p_qty, p_scrap, p_reason, p_hold, pg_temp.act(), p_wmove)) $c$;
create function pg_temp.o_split(p_shop uuid, p_job uuid, p_seq int, p_qty int, p_scrap int default 0, p_reason text default null, p_hold int default null, p_wmove numeric default null) returns jsonb
 language sql as $c$
  select pg_temp.o_split_raw(p_shop, p_job, p_seq, p_qty, p_scrap, p_reason,
    coalesce(p_hold, (select s.qty_in - s.qty_scrap - s.qty_split_out from analytics.job_stage s where s.job_id = p_job and s.seq = p_seq)), p_wmove) $c$;
-- ออฟฟิศรับ (กรอกแทน) พร้อมจำนวนที่ได้จริง
create function pg_temp.o_recv2(p_shop uuid, p_job uuid, p_seq int, p_qty int default null, p_worker uuid default null, p_name text default 'verify') returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_office_receive(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L, p_worker_id=>%L, p_assignee_name=>%L, p_qty_received=>%L, p_actor=>%L)',
    p_shop, p_job, p_seq, analytics.job_today(), p_worker, p_name, p_qty, pg_temp.act())) $c$;
-- ออฟฟิศรับพร้อมจำนวน + น้ำหนักที่ชั่งได้จริง
create function pg_temp.o_recv3(p_shop uuid, p_job uuid, p_seq int, p_qty int, p_w numeric, p_worker uuid default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_office_receive(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L, p_worker_id=>%L, p_assignee_name=>%L, p_qty_received=>%L, p_weight_in_g=>%L, p_actor=>%L)',
    p_shop, p_job, p_seq, analytics.job_today(), p_worker, 'verify', p_qty, p_w, pg_temp.act())) $c$;
create function pg_temp.o_lcancel(p_shop uuid, p_lot uuid, p_reason text, p_disp text, p_sreason text default null, p_sw numeric default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_lot_cancel(p_shop_id=>%L, p_lot_job_id=>%L, p_reason=>%L, p_disposition=>%L, p_scrap_reason=>%L, p_actor=>%L, p_scrap_weight_g=>%L)',
    p_shop, p_lot, p_reason, p_disp, p_sreason, pg_temp.act(), p_sw)) $c$;
create function pg_temp.o_dres(p_shop uuid, p_disc uuid, p_kind text, p_reason text) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_discrepancy_resolve(p_shop_id=>%L, p_discrepancy_id=>%L, p_kind=>%L, p_reason=>%L, p_actor=>%L)', p_shop, p_disc, p_kind, p_reason, pg_temp.act())) $c$;
create function pg_temp.o_dvoid(p_shop uuid, p_disc uuid, p_reason text) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_discrepancy_void(p_shop_id=>%L, p_discrepancy_id=>%L, p_reason=>%L, p_actor=>%L)', p_shop, p_disc, p_reason, pg_temp.act())) $c$;
create function pg_temp.o_done(p_shop uuid, p_job uuid, p_good int, p_scrap int, p_w numeric default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_done(p_shop_id=>%L, p_job_id=>%L, p_qty_good=>%L, p_qty_scrap=>%L, p_weight_final_g=>%L, p_actor=>%L)', p_shop, p_job, p_good, p_scrap, p_w, pg_temp.act())) $c$;
create function pg_temp.o_cancel(p_shop uuid, p_job uuid, p_reason text default 'verify') returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_cancel(p_shop_id=>%L, p_job_id=>%L, p_reason=>%L, p_actor=>%L)', p_shop, p_job, p_reason, pg_temp.act())) $c$;
create function pg_temp.o_reopen(p_shop uuid, p_job uuid, p_reason text default 'verify') returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_stage_reopen(p_shop_id=>%L, p_job_id=>%L, p_reason=>%L, p_actor=>%L)', p_shop, p_job, p_reason, pg_temp.act())) $c$;
create function pg_temp.o_tissue(p_shop uuid, p_job uuid, p_revoke boolean default null, p_purpose text default 'traveler', p_lot uuid default null) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  r := pg_temp.q(format('select analytics.job_token_issue(p_shop_id=>%L, p_job_id=>%L, p_revoke_previous=>%L, p_actor=>%L, p_purpose=>%L, p_lot_job_id=>%L)',
    p_shop, p_job, p_revoke, pg_temp.act(), p_purpose, p_lot));
  if r ? 'token' then r := r || jsonb_build_object('hash', analytics.job_sha256_hex(r ->> 'token')); end if;
  return r;
end $c$;
create function pg_temp.o_trevoke(p_shop uuid, p_job uuid, p_no int default null, p_reason text default 'verify') returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_token_revoke(p_shop_id=>%L, p_job_id=>%L, p_reason=>%L, p_actor=>%L, p_print_no=>%L)', p_shop, p_job, p_reason, pg_temp.act(), p_no)) $c$;
create function pg_temp.o_tlist(p_shop uuid, p_job uuid) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_token_list(p_shop_id=>%L, p_job_id=>%L, p_actor=>%L)', p_shop, p_job, pg_temp.act())) $c$;

-- ช่างส่ง/แยกส่วน (p_qty_send null = ส่งทั้งหมด) · รับ (p_qty null = ตามที่ส่ง) · ชี้แจงส่วนต่าง · ยกเลิกส่วน
create function pg_temp.ws(p_tokh text, p_sesh text, p_seq int, p_lot uuid default null, p_qty_send int default null, p_hold int default null,
                           p_scrap int default 0, p_reason text default null, p_wout numeric default null, p_added numeric default null,
                           p_scrap_w numeric default null, p_note text default null, p_wmove numeric default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_worker_send(p_token_hash=>%L, p_session_hash=>%L, p_expected_seq=>%L, p_lot_job_id=>%L, p_qty_send=>%L, p_qty_hold=>%L,
      p_qty_scrap=>%L, p_scrap_reason=>%L, p_weight_out_g=>%L, p_metal_added_g=>%L, p_scrap_weight_g=>%L, p_weight_note=>%L, p_weight_move_g=>%L, p_user_agent=>%L)',
    p_tokh, p_sesh, p_seq, p_lot, p_qty_send, p_hold, p_scrap, p_reason, p_wout, p_added, p_scrap_w, p_note, p_wmove, 'verify-ua/1.0')) $c$;
create function pg_temp.wr(p_tokh text, p_sesh text, p_seq int, p_lot uuid default null, p_qty int default null, p_w numeric default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_worker_receive(p_token_hash=>%L, p_session_hash=>%L, p_expected_seq=>%L, p_lot_job_id=>%L, p_qty_received=>%L, p_weight_in_g=>%L, p_user_agent=>%L)',
    p_tokh, p_sesh, p_seq, p_lot, p_qty, p_w, 'verify-ua/1.0')) $c$;
create function pg_temp.wd(p_tokh text, p_sesh text, p_disc uuid, p_kind text, p_reason text) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_worker_discrepancy_resolve(p_token_hash=>%L, p_session_hash=>%L, p_discrepancy_id=>%L, p_kind=>%L, p_reason=>%L, p_user_agent=>%L)',
    p_tokh, p_sesh, p_disc, p_kind, p_reason, 'verify-ua/1.0')) $c$;
create function pg_temp.wc(p_tokh text, p_sesh text, p_lot uuid, p_reason text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_worker_lot_cancel(p_token_hash=>%L, p_session_hash=>%L, p_lot_job_id=>%L, p_reason=>%L, p_user_agent=>%L)',
    p_tokh, p_sesh, p_lot, p_reason, 'verify-ua/1.0')) $c$;

-- ตัวอ่านสถานะ
create function pg_temp.jv(p_job uuid, p_col text) returns text language plpgsql as $c$
declare v text;
begin
  execute format('select %I::text from analytics.job where id = %L', p_col, p_job) into v;
  return v;
end $c$;
create function pg_temp.lot(r jsonb) returns uuid language sql as $c$ select (r ->> 'lot_job_id')::uuid $c$;
create function pg_temp.dcount(p_root uuid) returns int language sql as $c$ select count(*)::int from analytics.v_job_tree_drift where root_job_id = p_root $c$;
create function pg_temp.sumok(p_root uuid) returns boolean language sql as $c$ select coalesce((select sum_check from analytics.v_job_tree_summary where root_job_id = p_root), false) $c$;
create function pg_temp.sid(p_job uuid, p_seq int) returns uuid language sql as $c$ select id from analytics.job_stage where job_id = p_job and seq = p_seq $c$;
create function pg_temp.disc_of(p_job uuid) returns uuid language sql as $c$
  select id from analytics.job_discrepancy where job_id = p_job and status = 'open' order by created_at limit 1 $c$;
-- นับ drift ของ v_job_stage_from_events (ทุกขั้นของต้นไม้)
create function pg_temp.sdrift(p_root uuid) returns int language sql as $c$
  select count(*)::int from analytics.v_job_stage_from_events e join analytics.job j on j.id = e.job_id
   where (j.id = p_root or j.parent_job_id = p_root) and e.drift $c$;
-- key ทุกตัวใน jsonb (ลึกทุกชั้น) — ตรวจว่าไม่มี key ต้องห้ามหลุดไปหน้าช่าง
create function pg_temp.keys_of(p_j jsonb) returns text[] language plpgsql as $c$
declare r record; v text[] := '{}'; e jsonb;
begin
  if jsonb_typeof(p_j) = 'object' then
    for r in select key, value from jsonb_each(p_j) loop
      v := v || r.key || pg_temp.keys_of(r.value);
    end loop;
  elsif jsonb_typeof(p_j) = 'array' then
    for e in select value from jsonb_array_elements(p_j) loop v := v || pg_temp.keys_of(e); end loop;
  end if;
  return v;
end $c$;
create function pg_temp.clean_keys(p_j jsonb) returns boolean language sql as $c$
  select not exists (select 1 from unnest(pg_temp.keys_of(p_j)) k where k ~* '(cost|price|thb|margin|customer|quote_no|baht|amount|token|hash)') $c$;
-- ผู้ถืออยู่ขั้นไหน (stage_code ของขั้น received ของใบ)
create function pg_temp.held_code(p_job uuid) returns text language sql as $c$ select stage_code from analytics.job_stage where job_id = p_job and status = 'received' limit 1 $c$;
create function pg_temp.nlots(p_root uuid) returns int language sql as $c$ select count(*)::int from analytics.job where parent_job_id = p_root $c$;
create function pg_temp.d_status(p_disc uuid) returns text language sql as $c$ select status from analytics.job_discrepancy where id = p_disc $c$;

-- ใบ OEM เงิน + แบบ + ขั้นมาตรฐาน 8 ขั้น เดินให้ถึงก่อนขั้น p_to+1 ด้วยมือออฟฟิศ (ทุกขั้นนับ weight p_w) → {job_id, tokh}
create function pg_temp.fx(p_shop uuid, p_tpl uuid, p_prof uuid, p_qty int default 100, p_to int default 3, p_metal text default 'silver', p_w numeric default null) returns jsonb
 language plpgsql as $c$
declare d jsonb; j uuid; rr jsonb;
begin
  d := pg_temp.mkp(p_shop, p_tpl, p_metal, p_prof, null, p_qty);
  j := pg_temp.jid(d);
  if j is null then
    raise exception 'fx: สร้างใบไม่ได้ %', d::text;
  end if;
  rr := pg_temp.rw(p_shop, j, p_w, p_to);
  if rr ? '_err' then
    raise exception 'fx: เดินขั้นไม่ได้ %', rr::text;
  end if;
  return d || jsonb_build_object('tokh', pg_temp.newtok(p_shop, j));
end $c$;

-- ============================================================================
-- Section A — แยกส่วน (ส่งต่อ n จาก N) เส้นทางปกติ: ส่วนใหม่ · ซ้อน · แม่ส่งส่วนที่เหลือ · ทั้งต้นไม้ปิด (design §10.2) + ใบเดิม profile null + แยกที่ขั้น QC/pack + ผลิต (production)
-- ============================================================================
create function pg_temp.sa(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; wA uuid; wB uuid;
  d jsonb; j uuid; th text; sa text; sb text;
  r jsonb; r2 jsonb; r3 jsonb;
  l1 uuid; l2 uuid; ms uuid;
  v_no text; v_today date := analytics.job_today();
  v_keys boolean;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  wB := pg_temp.wid(p_shop, 'vfy-ช่าง B', '7351');

  d := pg_temp.fx(p_shop, p_tpl, pn, 100, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh';
  sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  select job_no into v_no from analytics.job where id = j;
  r := pg_temp.wr(th, sa, 4);
  v_log := v_log || pg_temp.chk('A0', 'fixture: ช่าง A รับขั้น cast (seq 4) ถือ 100 ชิ้น · ใบเงิน 100 ชิ้น แบบ "ไม่ชั่ง" · ไม่มีส่วน', (r ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'qty_in') = '100'
    and pg_temp.nlots(j) = 0 and pg_temp.jv(j, 'qty_split_out') = '0');
  ms := pg_temp.sid(j, 4);

  -- แยก 40 จาก 100 (ส่งต่อ 40 จาก 100)
  r := pg_temp.ws(th, sa, 4, null, 40, 100);
  l1 := pg_temp.lot(r);
  v_log := v_log || pg_temp.chk('A1', 'ช่างแยก 40 จาก 100 → ok · action split · lot_seq 1 · qty 40 · parent_remaining 60 · label = "<job_no> · ส่วนที่ 1" · ขั้นถัดไปของส่วน = cut_sprue',
    (r ->> 'ok') = 'true' and r ->> 'action' = 'split' and (r ->> 'lot_seq') = '1' and (r ->> 'qty') = '40' and (r ->> 'parent_remaining') = '60'
    and r ->> 'label' = v_no || ' · ส่วนที่ 1' and r #>> '{next_stage,code}' = 'cut_sprue');
  v_log := v_log || pg_temp.chk('A2', 'ส่วนใหม่: parent = ใบแม่ · lot_seq 1 · qty_planned = qty_order = 40 · สถานะ in_progress · profile/source/โลหะ/สินค้า ตรงแม่ · ไม่มีแผนโลหะ/ของเหลือ · ไม่มี token',
    (select l.parent_job_id = j and l.lot_seq = 1 and l.qty_planned = 40 and l.qty_order = 40 and l.status = 'in_progress'
            and l.profile_id is not distinct from m.profile_id and l.profile_name is not distinct from m.profile_name and l.metal = m.metal
            and l.oem_quote_item_id is not distinct from m.oem_quote_item_id and l.root_quote_id is not distinct from m.root_quote_id
            and l.target_piece_g is null and l.metal_plan_g is null and l.surplus_disposition is null and l.start_gate_note is null
            and l.design_label = m.design_label and l.due_date is not distinct from m.due_date
       from analytics.job l, analytics.job m where l.id = l1 and m.id = j)
    and not exists (select 1 from analytics.job_token where job_id = l1));
  v_log := v_log || pg_temp.chk('A3', 'ขั้นของส่วน: seq 1-3 skipped (split_inherit) · seq 4 sent qty_in = qty_out = 40 ไม่ชั่ง split_from = ขั้นแม่ · seq 5-8 pending · ผู้ส่ง = ผู้ถือเดิม (ช่าง A)',
    (select string_agg(seq || ':' || status, ',' order by seq) from analytics.job_stage where job_id = l1) = '1:skipped,2:skipped,3:skipped,4:sent,5:pending,6:pending,7:pending,8:pending'
    and (select count(*) from analytics.job_stage where job_id = l1 and status = 'skipped' and skip_reason = 'split_inherit') = 3
    and pg_temp.sv(l1, 4, 'qty_in') = '40' and pg_temp.sv(l1, 4, 'qty_out') = '40' and pg_temp.sv(l1, 4, 'weigh_required') = 'false'
    and pg_temp.sv(l1, 4, 'weight_in_g') is null and pg_temp.sv(l1, 4, 'worker_id') = wA::text and pg_temp.sv(l1, 4, 'split_from_stage_id') = ms::text);
  v_log := v_log || pg_temp.chk('A4', 'ขั้นแม่: ยัง received · qty_split_out 40 · ของเสีย 0 · job.qty_split_out = 40 (trigger sync) · current_stage_code ของแม่ = cast',
    pg_temp.sv(j, 4, 'status') = 'received' and pg_temp.sv(j, 4, 'qty_split_out') = '40' and pg_temp.sv(j, 4, 'qty_scrap') = '0'
    and pg_temp.jv(j, 'qty_split_out') = '40' and pg_temp.jv(j, 'current_stage_code') = 'cast');
  v_log := v_log || pg_temp.chk('A5', 'วันที่ขั้นแยกของส่วน: received_on = วันที่ผู้แยกรับขั้นนี้ · sent_on = วันนี้เวลาไทย (job_today) · ขั้นที่ข้ามไม่มีวัน',
    pg_temp.sv(l1, 4, 'received_on') = pg_temp.sv(j, 4, 'received_on') and pg_temp.sv(l1, 4, 'sent_on') = v_today::text and pg_temp.sv(l1, 1, 'received_on') is null);
  v_log := v_log || pg_temp.chk('A6', 'event: แม่มี split (worker_id = ช่าง A · ช่อง worker_qr · payload ชี้ส่วน) · ส่วนมี create + stage_skip×3 + stage_receive + stage_send · v_job_stage_from_events ไม่ drift ทั้งต้นไม้',
    (select count(*) from analytics.job_event where job_id = j and event_type = 'split' and worker_id = wA and channel = 'worker_qr' and payload ->> 'lot_job_id' = l1::text) = 1
    and (select count(*) from analytics.job_event where job_id = l1 and event_type = 'create') = 1
    and (select count(*) from analytics.job_event where job_id = l1 and event_type = 'stage_skip') = 3
    and (select count(*) from analytics.job_event where job_id = l1 and event_type in ('stage_receive', 'stage_send')) = 2
    and pg_temp.sdrift(j) = 0);
  v_log := v_log || pg_temp.chk('A7', 'ต้นไม้ถูกต้อง: v_job_tree_drift ว่าง · sum_check จริง · parts_count 2 · lots_open 1 · live รวม 100 · ส่วนใหม่ live 40 แม่ live 60',
    pg_temp.dcount(j) = 0 and pg_temp.sumok(j)
    and (select parts_count = 2 and lots_open = 1 and qty_live_total = 100 and qty_pending_explanation = 0 from analytics.v_job_tree_summary where root_job_id = j)
    and analytics.job_live_qty(l1) = 40 and analytics.job_live_qty(j) = 60);
  r := pg_temp.w_res(th, sa);
  r2 := pg_temp.w_res(th, sb);
  v_log := v_log || pg_temp.chk('A8', 'resolve หลายส่วน: ช่าง A = multi · my_actions มี send ของแม่ qty_hold 60 · parts 2 ส่วน · ช่าง B = multi · มี receive ของส่วนที่ขั้น 5 (expected 40) และ "ไม่มี" receive ของแม่ (ผู้ถือยังค้างส่วนที่เหลือ)',
    r ->> 'next_action' = 'multi' and jsonb_array_length(r -> 'parts') = 2
    and exists (select 1 from jsonb_array_elements(r -> 'my_actions') a where a ->> 'action' = 'send' and (a ->> 'lot_job_id')::uuid = j and (a ->> 'qty_hold') = '60' and (a ->> 'stage_seq') = '4')
    and r2 ->> 'next_action' = 'multi'
    and exists (select 1 from jsonb_array_elements(r2 -> 'my_actions') a where a ->> 'action' = 'receive' and (a ->> 'lot_job_id')::uuid = l1 and (a ->> 'qty_expected') = '40' and (a ->> 'stage_seq') = '5')
    and not exists (select 1 from jsonb_array_elements(r2 -> 'my_actions') a where a ->> 'action' = 'receive' and (a ->> 'lot_job_id')::uuid = j)
    and (r -> 'action_stage') = 'null'::jsonb and (r ->> 'prev_weight_out_g') is null);

  -- ช่าง B รับส่วนที่ขั้น 5 แล้วแยกซ้อน 15 จาก 40 (ส่วนของส่วน — ชี้ใบแม่เดิม)
  r := pg_temp.wr(th, sb, 5, l1);
  v_log := v_log || pg_temp.chk('A9a', 'ช่าง B รับส่วนที่ 1 ขั้น cut_sprue ได้ (qty_in 40)', (r ->> 'ok') = 'true' and pg_temp.sv(l1, 5, 'qty_in') = '40' and pg_temp.sv(l1, 5, 'worker_id') = wB::text);
  r := pg_temp.ws(th, sb, 5, l1, 15, 40);
  l2 := pg_temp.lot(r);
  v_log := v_log || pg_temp.chk('A9', 'แยกซ้อน: ส่วนใหม่ชี้ "ใบแม่เดิม" (ไม่ใช่ส่วนที่แยกมา) lot_seq 2 · ส่วนที่ 1 ขั้น 5 split_out 15 · ส่วนใหม่ข้าม 1-4 · ขั้น 5 sent 15 · ต้นไม้ไม่ drift',
    (r ->> 'ok') = 'true' and (r ->> 'lot_seq') = '2' and (select parent_job_id = j and lot_seq = 2 and qty_planned = 15 from analytics.job where id = l2)
    and pg_temp.sv(l1, 5, 'qty_split_out') = '15' and pg_temp.jv(l1, 'qty_split_out') = '15'
    and (select string_agg(seq || ':' || status, ',' order by seq) from analytics.job_stage where job_id = l2) = '1:skipped,2:skipped,3:skipped,4:skipped,5:sent,6:pending,7:pending,8:pending'
    and pg_temp.dcount(j) = 0 and pg_temp.sumok(j) and pg_temp.sdrift(j) = 0
    and (select count(*) from analytics.job where parent_job_id = j) = 2);

  -- แม่ส่งส่วนที่เหลือ: ส่งทั้งหมดที่ถือ = 100 − 40 = 60 (qty_out = เข้า − เสีย − แยกออก)
  r := pg_temp.ws(th, sa, 4, null, null, 60);
  v_log := v_log || pg_temp.chk('A10', 'แม่ส่งส่วนที่เหลือ (p_qty_send ว่าง · p_qty_hold 60) → ok · qty_out 60 · qty_scrap 0 · qty_split_out 40 คงเดิม · ขั้นถัดไป = cut_sprue (pending) · ไม่ drift',
    (r ->> 'ok') = 'true' and (r ->> 'qty_out') = '60' and (r ->> 'qty_split_out') = '40' and pg_temp.sv(j, 4, 'status') = 'sent' and pg_temp.sv(j, 4, 'qty_out') = '60'
    and pg_temp.sv(j, 4, 'qty_split_out') = '40' and pg_temp.dcount(j) = 0 and pg_temp.sdrift(j) = 0);
  -- ทั้ง 3 ส่วนเดินไปถึงขั้นสุดท้าย (ออฟฟิศกรอกแทน) แล้วปิด: ส่วนแล้วแม่
  r := pg_temp.rw(p_shop, j, null, 8);
  r2 := pg_temp.rw(p_shop, l1, null, 8);
  r3 := pg_temp.rw(p_shop, l2, null, 8);
  v_log := v_log || pg_temp.chk('A11a', 'เดินครบ 8 ขั้นทั้ง 3 ส่วน: แม่ส่งสุดท้าย 60 · ส่วนที่ 1 ส่งสุดท้าย 25 (40 − 15) · ส่วนที่ 2 ส่งสุดท้าย 15 · ต้นไม้ไม่ drift',
    not (r ? '_err') and not (r2 ? '_err') and not (r3 ? '_err')
    and pg_temp.sv(j, 8, 'qty_out') = '60' and pg_temp.sv(l1, 8, 'qty_out') = '25' and pg_temp.sv(l2, 8, 'qty_out') = '15' and pg_temp.dcount(j) = 0);
  r := pg_temp.o_done(p_shop, j, 60, 0);
  v_log := v_log || pg_temp.chk('A11b', 'ปิดแม่ก่อนส่วน (ส่วนยังเปิด) = ปฏิเสธ parts_open · ข้อความขึ้นต้น "ปิดงานไม่ได้ — ยังมีส่วนย่อย" · แม่ยังไม่ done', pg_temp.rej(r, 'parts_open') and (r ->> '_err') like 'ปิดงานไม่ได้ — ยังมีส่วนย่อย%' and pg_temp.jv(j, 'status') <> 'done');
  r := pg_temp.o_done(p_shop, l2, 15, 0);
  r2 := pg_temp.o_done(p_shop, l1, 25, 0);
  r3 := pg_temp.o_done(p_shop, j, 60, 0);
  v_log := v_log || pg_temp.chk('A11c', 'ปิดส่วนที่ 2 (ดี 15) · ส่วนที่ 1 (ดี 25 + แยกออก 15 = 40) · แม่ (ดี 60 + แยกออก 40 = 100) → ok ทั้งหมด · ผลรวมดี 100 · ต้นไม้ไม่ drift · sum_check จริง · token แม่ถูกเพิกถอนหมด',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true' and (r3 ->> 'ok') = 'true' and pg_temp.jv(j, 'status') = 'done'
    and (select qty_done_good = 100 and qty_pending_explanation = 0 from analytics.v_job_tree_summary where root_job_id = j)
    and pg_temp.dcount(j) = 0 and pg_temp.sumok(j) and not exists (select 1 from analytics.job_token where job_id = j and revoked_at is null));
  r := pg_temp.o_done(p_shop, j, 61, 0);
  v_log := v_log || pg_temp.chk('A11d', 'ใบแม่ done แล้วปิดซ้ำ = ปฏิเสธ job_closed', pg_temp.rej(r, 'job_closed'));

  -- ใบ response ของช่างต้องไม่มี key เงิน/ลูกค้า/token (ข้อ 14)
  d := pg_temp.fx(p_shop, p_tpl, pn, 20, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  r := pg_temp.wr(th, sa, 4);
  r2 := pg_temp.ws(th, sa, 4, null, 5, 20);
  r3 := pg_temp.w_res(th, sa);
  v_keys := pg_temp.clean_keys(r) and pg_temp.clean_keys(r2) and pg_temp.clean_keys(r3) and pg_temp.clean_keys(pg_temp.w_res(th, null));
  v_log := v_log || pg_temp.chk('A12', 'response ช่าง (resolve หลายส่วน/ก่อน PIN · receive · send แยกส่วน) ไม่มี key cost/price/thb/customer/quote_no/token/hash · resolve ก่อน PIN ไม่มี parts/my_actions',
    v_keys and (pg_temp.w_res(th, null) -> 'parts') = 'null'::jsonb and (pg_temp.w_res(th, null) -> 'my_actions') = 'null'::jsonb);
  return v_log;
end;
$s$;

-- ============================================================================
-- Section A2 — เส้นทางเฉพาะ: แยกที่ขั้น QC / pack (ข้าม QC รับช่วง) · ใบเดิม profile null · ใบชั่ง (loss ไม่เทียบ) · ใบผลิต (production) · แยกจากส่วน
-- ============================================================================
create function pg_temp.sa2(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; pw uuid; wA uuid; wB uuid;
  d jsonb; j uuid; th text; sa text; sb text;
  r jsonb; r2 jsonb;
  l1 uuid;
  v_poi uuid; v_existing text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  wB := pg_temp.wid(p_shop, 'vfy-ช่าง B', '7351');

  -- แยกที่ขั้น QC (seq 7): ส่วนข้าม 1-6 · QC ส่งโดยผู้แยก · pack pending
  d := pg_temp.fx(p_shop, p_tpl, pn, 30, 6);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  r := pg_temp.wr(th, sa, 7);
  r2 := pg_temp.ws(th, sa, 7, null, 10, 30);
  l1 := pg_temp.lot(r2);
  v_log := v_log || pg_temp.chk('A2a', 'แยกที่ขั้น QC (seq 7): ok · ส่วนข้าม 1-6 (split_inherit) · QC sent 10 · pack pending · ไม่ชน "ข้าม QC/แพ็กไม่ได้" ของส่วนอื่น',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true' and (select string_agg(seq || ':' || status, ',' order by seq) from analytics.job_stage where job_id = l1) = '1:skipped,2:skipped,3:skipped,4:skipped,5:skipped,6:skipped,7:sent,8:pending'
    and pg_temp.dcount(j) = 0);
  -- แยกที่ขั้น pack (seq 8): ส่วนต้องข้าม QC (รับช่วง) ได้ — ยกเว้นเดียวของ "ข้าม QC ไม่ได้"
  d := pg_temp.fx(p_shop, p_tpl, pn, 30, 7);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  r := pg_temp.wr(th, sa, 8);
  r2 := pg_temp.ws(th, sa, 8, null, 10, 30);
  l1 := pg_temp.lot(r2);
  v_log := v_log || pg_temp.chk('A2b', 'แยกที่ขั้นแพ็ก (seq 8): ok · ส่วนข้ามขั้น QC แบบรับช่วง (ใบแม่ผ่าน QC แล้ว) · แพ็ก sent 10 · ไม่มีขั้น pending เหลือ',
    (r2 ->> 'ok') = 'true' and pg_temp.sv(l1, 7, 'status') = 'skipped' and pg_temp.sv(l1, 7, 'skip_reason') = 'split_inherit' and pg_temp.sv(l1, 8, 'status') = 'sent'
    and pg_temp.dcount(j) = 0);
  -- ข้าม QC ตรงๆ บนใบปกติ / ใบแม่ยังห้าม (ข้อยกเว้นแคบ)
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 0);
  j := pg_temp.jid(d);
  v_log := v_log || pg_temp.chk('A2c', 'ข้อยกเว้นข้าม QC แคบ: ใบแม่ข้าม qc ตรงๆ (UPDATE ตรง · skip_reason split_inherit) ยังถูกปฏิเสธ · RPC job_stage_skip qc ยังถูกปฏิเสธ',
    pg_temp.x(format('update analytics.job_stage set status = ''skipped'', skip_reason = ''split_inherit'' where job_id = %L and seq = 7', j)) like 'ERR:22023:%QC%'
    and pg_temp.q(format('select analytics.job_stage_skip(%L, %L, %L, %L, %L)', p_shop, j, 'qc', 'verify', pg_temp.act())) ->> '_hint' = 'stage_required');

  -- แยกจากใบเดิม profile_id null (leg) — ส่วนรับ snapshot เดียวกัน (ไม่มีแบบ) ไม่ติด profile_required
  d := pg_temp.mkp(p_shop, p_tpl, 'silver', pn, null, 30);
  j := pg_temp.jid(d);
  perform pg_temp.leg(j);
  perform pg_temp.rw(p_shop, j, 9.9, 3);
  th := pg_temp.newtok(p_shop, j); sa := pg_temp.sess(th, wA, '4829');
  r := pg_temp.wr(th, sa, 4, null, null, 9.9);
  r2 := pg_temp.ws(th, sa, 4, null, 10, 30);
  l1 := pg_temp.lot(r2);
  v_log := v_log || pg_temp.chk('A2d', 'แยกจากใบเดิม (profile_id null · กติกา J1): ok · ส่วน profile_id null เช่นกัน · ไม่ drift',
    (r2 ->> 'ok') = 'true' and (select profile_id is null and profile_name is null from analytics.job where id = l1) and pg_temp.dcount(j) = 0);

  -- ใบแบบชั่ง (cast ชั่ง+ถามเสีย · cut_sprue ชั่ง): แยกที่ขั้นชั่ง = ขั้นแม่ชั่งตอนส่งครั้งสุดท้ายตามเดิม · loss ของขั้นที่แยก = ไม่เทียบ
  pw := pg_temp.mkprof(p_shop, 'v181-ชั่งหล่อ+ตัดต้น');
  d := pg_temp.fx(p_shop, p_tpl, pw, 30, 3, 'silver', 9.9);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  r := pg_temp.wr(th, sa, 4, null, null, 9.9);
  r2 := pg_temp.ws(th, sa, 4, null, 10, 30);
  l1 := pg_temp.lot(r2);
  v_log := v_log || pg_temp.chk('A2e', 'ขั้นชั่ง (cast): แยก 10 จาก 30 ไม่ต้องชั่ง → ok · ส่วนไม่มีน้ำหนัก (weight_in null) · weigh_required ของขั้นแยกของส่วน = false · ขั้นแม่ยัง received',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true' and pg_temp.sv(l1, 4, 'weight_in_g') is null and pg_temp.sv(l1, 4, 'weigh_required') = 'false' and pg_temp.sv(j, 4, 'status') = 'received');
  r := pg_temp.ws(th, sa, 4, null, null, 20);
  v_log := v_log || pg_temp.chk('A2f', 'ส่งส่วนที่เหลือของขั้นที่ต้องชั่งโดยไม่ใส่น้ำหนัก = weight_required (ด่านเดิมของขั้นแม่คงอยู่) · ใส่ 9.0 = ok qty_out 20',
    (r ->> 'code') = 'weight_required' and pg_temp.sv(j, 4, 'status') = 'received'
    and (pg_temp.ws(th, sa, 4, null, null, 20, 0, null, 9.0) ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'qty_out') = '20');
  v_log := v_log || pg_temp.chk('A2g', 'v_job_stage_loss: ขั้นแม่ที่แยก = loss_g/loss_pct null + not_comparable จริง (ไม่เกิดธง loss ปลอม) · ขั้นปกติอื่นไม่ not_comparable · ขั้น cut_sprue ของส่วนยังคำนวณได้',
    (select loss_g is null and loss_pct is null and not_comparable and not warn from analytics.v_job_stage_loss where job_id = j and stage_code = 'cast')
    and not exists (select 1 from analytics.v_job_stage_loss where job_id = j and stage_code <> 'cast' and not_comparable));

  -- ใบผลิต (production): ส่วนคัดลอก production_order_item_id จากแม่ — ไม่ชน uq_job_production_item · existing_job = แม่
  select poi.id into v_poi from analytics.production_order_item poi join analytics.production_order po on po.id = poi.production_order_id
   where po.status = 'open' and poi.shop_id = p_shop and poi.qty_planned >= 3 and not exists (select 1 from analytics.job x where x.production_order_item_id = poi.id and x.status <> 'cancelled')
   order by po.created_at limit 1;
  if v_poi is null then
    v_log := v_log || E'[SKIP] A2h  ไม่มีรายการใบผลิตที่ open (qty >= 3) และยังไม่มีใบงานให้ใช้ทดสอบ source=production (ไม่ใช่ความล้มเหลว — บอก Tech Lead)\n';
  else
    r := pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L)', p_shop, v_poi, pg_temp.std(), pg_temp.act()));
    j := pg_temp.jid(r);
    if j is null then
      v_log := v_log || format(E'[FAIL] A2h0  สร้างใบงานจากรายการใบผลิตไม่ได้: %s\n', r::text);
    else
      th := pg_temp.newtok(p_shop, j); sa := pg_temp.sess(th, wA, '4829');
      perform pg_temp.rw(p_shop, j, 9.9, 3);
      r := pg_temp.wr(th, sa, 4, null, null, case when pg_temp.sv(j, 4, 'weigh_required') = 'true' then 9.9 end);
      r2 := pg_temp.ws(th, sa, 4, null, 1, (pg_temp.sv(j, 4, 'qty_in'))::int);
      l1 := pg_temp.lot(r2);
      v_existing := analytics.job_source_info(p_shop, 'production', v_poi) -> 'existing_job' ->> 'id';
      v_log := v_log || pg_temp.chk('A2h', 'ใบผลิต: แยก 1 ชิ้นได้ · ส่วนมี production_order_item_id เดียวกับแม่ แต่ไม่ชน unique · job_source_info.existing_job = ใบแม่ (ไม่ใช่ส่วน) · สร้างใบซ้ำจากรายการเดิม = job_exists',
        (r2 ->> 'ok') = 'true' and (select production_order_item_id = v_poi and parent_job_id = j from analytics.job where id = l1)
        and v_existing = j::text
        and pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L)', p_shop, v_poi, pg_temp.std(), pg_temp.act())) ->> '_hint' = 'job_exists');
    end if;
  end if;
  return v_log;
end;
$s$;

-- ============================================================================
-- Section B — เคสห้ามผ่านของการแยก (design §10.1 ข้อ 1–5): จำนวน · สถานะขั้น/ใบ · CAS จำนวนที่ถือ (กดซ้ำ/2 มือถือ)
-- ============================================================================
create function pg_temp.sb(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; wA uuid; wB uuid;
  d jsonb; j uuid; th text; sa text; sb text;
  r jsonb; r2 jsonb; r3 jsonb;
  l1 uuid; n_ev int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  wB := pg_temp.wid(p_shop, 'vfy-ช่าง B', '7351');

  -- ----- B1 จำนวน: ≤ 0 · ≥ ที่ถือ (ต้องเหลือ ≥ 1) · NaN · > 100000 -----
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  select count(*) into n_ev from analytics.job_event where job_id = j;
  r := pg_temp.ws(th, sa, 4, null, 0, 10);
  r2 := pg_temp.ws(th, sa, 4, null, -3, 10);
  r3 := pg_temp.ws(th, sa, 4, null, 11, 10);
  v_log := v_log || pg_temp.chk('B1a', 'ช่างแยก 0 / −3 / 11 (มากกว่าที่ถือ 10) = qty_invalid ทั้งหมด · ไม่สร้างส่วน · ขั้นไม่ขยับ · ไม่มี event เพิ่ม',
    (r ->> 'code') = 'qty_invalid' and (r2 ->> 'code') = 'qty_invalid' and (r3 ->> 'code') = 'qty_invalid'
    and pg_temp.nlots(j) = 0 and pg_temp.sv(j, 4, 'qty_split_out') = '0' and (select count(*) from analytics.job_event where job_id = j) = n_ev);
  r := pg_temp.ws(th, sa, 4, null, 9, 10, 1, 'porosity');
  r2 := pg_temp.ws(th, sa, 4, null, 100001, 10);
  v_log := v_log || pg_temp.chk('B1b', 'แยก 9 + เสีย 1 (เหลือผู้ถือ 0) = qty_invalid · แยก 100001 = qty_invalid · ไม่สร้างส่วน · ขั้นไม่ขยับ (ของเสียไม่ถูกบันทึกครึ่งทาง)',
    (r ->> 'code') = 'qty_invalid' and (r2 ->> 'code') = 'qty_invalid' and pg_temp.nlots(j) = 0 and pg_temp.sv(j, 4, 'qty_scrap') = '0' and pg_temp.sv(j, 4, 'qty_split_out') = '0');
  r := pg_temp.o_split(p_shop, j, 4, 10);
  r2 := pg_temp.o_split(p_shop, j, 4, 0);
  r3 := pg_temp.o_split(p_shop, j, 4, -1);
  v_log := v_log || pg_temp.chk('B1c', 'ออฟฟิศแยก 10 จาก 10 (ไม่เหลือผู้ถือ) / 0 / −1 = ปฏิเสธ 22023 hint qty_invalid · ไม่สร้างส่วน',
    pg_temp.rej(r, 'qty_invalid') and pg_temp.rej(r2, 'qty_invalid') and pg_temp.rej(r3, 'qty_invalid') and pg_temp.nlots(j) = 0);
  v_log := v_log || pg_temp.chk('B1d', 'NaN: ส่ง NaN::numeric เป็นจำนวนแยก = error ตั้งแต่ cast (ไม่ผ่านเข้า body) · ไม่สร้างส่วน',
    pg_temp.x(format('select analytics.job_lot_split(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>4, p_qty=>%L::numeric::int, p_actor=>%L)', p_shop, j, 'NaN', pg_temp.act())) like 'ERR:%'
    and pg_temp.nlots(j) = 0);
  -- ส่งทั้งหมดที่ถือโดยระบุ p_qty_send = ที่ถือ = ส่งปกติ ไม่เกิดส่วน (เดินเหมือน J1)
  r := pg_temp.ws(th, sa, 4, null, 10, 10);
  v_log := v_log || pg_temp.chk('B1e', 'ต้องไม่พัง: p_qty_send = จำนวนที่ถือ (10) = ส่งทั้งหมดแบบ J1 (action send · ไม่เกิดส่วน · qty_out 10 · split_out 0)',
    (r ->> 'ok') = 'true' and r ->> 'action' = 'send' and (r ->> 'qty_out') = '10' and pg_temp.nlots(j) = 0 and pg_temp.sv(j, 4, 'qty_split_out') = '0' and pg_temp.dcount(j) = 0);

  -- ----- B2 สถานะขั้น: pending / sent / skipped -----
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  r := pg_temp.ws(th, sa, 4, null, 3, 10);
  r2 := pg_temp.o_split(p_shop, j, 4, 3);
  v_log := v_log || pg_temp.chk('B2a', 'แยกจากขั้น pending (ยังไม่รับ): ช่าง = not_received · ออฟฟิศ = ปฏิเสธ not_received · ไม่สร้างส่วน',
    (r ->> 'code') = 'not_received' and pg_temp.rej(r2, 'not_received') and pg_temp.nlots(j) = 0);
  perform pg_temp.wr(th, sa, 4);
  r := pg_temp.ws(th, sa, 4, null, null, 10);
  r2 := pg_temp.ws(th, sa, 4, null, 3, 10);
  r3 := pg_temp.o_split(p_shop, j, 4, 3);
  v_log := v_log || pg_temp.chk('B2b', 'แยกจากขั้น sent (ส่งไปแล้ว): ช่างกดซ้ำ = ok already (ไม่สร้างส่วน) · ออฟฟิศ = ปฏิเสธ already_sent · ไม่มีส่วน',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true' and (r2 ->> 'already') = 'true' and pg_temp.rej(r3, 'already_sent') and pg_temp.nlots(j) = 0);
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  r := pg_temp.ws(th, sa, 4, null, 4, 10);
  l1 := pg_temp.lot(r);
  r2 := pg_temp.ws(th, sa, 1, l1, 2, 4);
  r3 := pg_temp.o_split(p_shop, l1, 2, 2);
  v_log := v_log || pg_temp.chk('B2c', 'แยกจากขั้น skipped ของส่วน (รับช่วง) = stage_changed · ออฟฟิศ = ปฏิเสธ stage_changed · ไม่มีส่วนที่ 2',
    (r2 ->> 'code') = 'stage_changed' and pg_temp.rej(r3, 'stage_changed') and pg_temp.nlots(j) = 1);

  -- ----- B3 สถานะใบ: done / cancelled / on_hold -----
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  update analytics.job set status = 'on_hold' where id = j;
  r := pg_temp.ws(th, sa, 4, null, 3, 10);
  r2 := pg_temp.o_split(p_shop, j, 4, 3);
  v_log := v_log || pg_temp.chk('B3a', 'ใบถูกพัก (on_hold): ช่างแยก = job_on_hold · ออฟฟิศ = ปฏิเสธ job_on_hold · ไม่มีส่วน', (r ->> 'code') = 'job_on_hold' and pg_temp.rej(r2, 'job_on_hold') and pg_temp.nlots(j) = 0);
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  r := pg_temp.o_cancel(p_shop, j);
  r2 := pg_temp.ws(th, sa, 4, null, 3, 10);
  r3 := pg_temp.o_split(p_shop, j, 4, 3);
  v_log := v_log || pg_temp.chk('B3b', 'ใบยกเลิกแล้ว (token ถูกเพิกถอนด้วย): ช่างแยก = ไม่ผ่านด่าน token (ok false) · ออฟฟิศ = ปฏิเสธ job_closed · ไม่มีส่วน',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'false' and pg_temp.rej(r3, 'job_closed') and pg_temp.nlots(j) = 0);
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 8);
  j := pg_temp.jid(d);
  r := pg_temp.o_done(p_shop, j, 10, 0);
  r2 := pg_temp.o_split(p_shop, j, 8, 3);
  v_log := v_log || pg_temp.chk('B3c', 'ใบ done แล้ว: ออฟฟิศแยก = ปฏิเสธ job_closed · ไม่มีส่วน', (r ->> 'ok') = 'true' and pg_temp.rej(r2, 'job_closed') and pg_temp.nlots(j) = 0);

  -- ----- B4 กดซ้ำ/2 มือถือ: p_qty_hold (CAS) -----
  d := pg_temp.fx(p_shop, p_tpl, pn, 20, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  r := pg_temp.ws(th, sa, 4, null, 5, null);
  v_log := v_log || pg_temp.chk('B4a', 'ช่างแยกโดยไม่ส่ง p_qty_hold = qty_hold_required · ไม่สร้างส่วน', (r ->> 'code') = 'qty_hold_required' and pg_temp.nlots(j) = 0);
  r := pg_temp.ws(th, sa, 4, null, 5, 19);
  v_log := v_log || pg_temp.chk('B4b', 'p_qty_hold ไม่ตรงที่ถือจริง (19 ≠ 20) = stage_changed · ไม่สร้างส่วน', (r ->> 'code') = 'stage_changed' and pg_temp.nlots(j) = 0);
  r := pg_temp.ws(th, sa, 4, null, 5, 20);
  r2 := pg_temp.ws(th, sa, 4, null, 5, 20);
  v_log := v_log || pg_temp.chk('B4c', 'กดซ้ำคำขอเดิม (hold 20 ทั้งที่ตอนนี้ถือ 15) = stage_changed · เหลือส่วนเดียว (ไม่ซ้ำ) · ขั้นแม่ split_out 5',
    (r ->> 'ok') = 'true' and (r2 ->> 'code') = 'stage_changed' and pg_temp.nlots(j) = 1 and pg_temp.sv(j, 4, 'qty_split_out') = '5' and pg_temp.dcount(j) = 0);
  r := pg_temp.o_split(p_shop, j, 4, 3, 0, null, 99);
  v_log := v_log || pg_temp.chk('B4d', 'ออฟฟิศส่ง p_qty_hold ผิด = ปฏิเสธ stage_changed · ไม่ส่ง p_qty_hold เลย = ปฏิเสธ qty_hold_required (L4 บังคับทุกช่องทาง) · ส่งถูก = แยก 3 ได้ lot_seq 2',
    pg_temp.rej(r, 'stage_changed') and pg_temp.rej(pg_temp.o_split_raw(p_shop, j, 4, 3, 0, null, null, null), 'qty_hold_required') and (pg_temp.o_split(p_shop, j, 4, 3) ->> 'lot_seq') = '2');
  return v_log;
end;
$s$;

-- ============================================================================
-- Section C — ตัวตนช่าง/ขอบเขตต้นไม้ (ข้อ 2) · D — น้ำหนักห้ามมากับการแยก (ข้อ 3) · E — ของเสีย/เหตุผลตอนแยก (ข้อ 4)
-- ============================================================================
create function pg_temp.sc(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; wA uuid; wB uuid;
  d jsonb; j uuid; th text; sa text; sb text;
  d2 jsonb; j2 uuid; th2 text; sa2 text;
  r jsonb; r2 jsonb; r3 jsonb;
  l1 uuid; lo uuid;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  wB := pg_temp.wid(p_shop, 'vfy-ช่าง B', '7351');

  d := pg_temp.fx(p_shop, p_tpl, pn, 20, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4);
  r := pg_temp.ws(th, sb, 4, null, 5, 20);
  r2 := pg_temp.ws(th, sb, 4, null, null, 20);
  v_log := v_log || pg_temp.chk('C1', 'ช่าง B (ไม่ใช่ผู้ถือ) แยก/ส่งขั้นที่ A ถือ = not_holder (ข้อความไม่มีตัวเลข) · ไม่สร้างส่วน · ขั้นยัง received ของ A',
    (r ->> 'code') = 'not_holder' and (r2 ->> 'code') = 'not_holder' and pg_temp.nodigit(r) and pg_temp.nlots(j) = 0 and pg_temp.sv(j, 4, 'worker_id') = wA::text and pg_temp.sv(j, 4, 'status') = 'received');
  -- ส่วนของใบอื่น / ส่วนที่ยกเลิก / session หมด / ช่างปิด / token ถูกเพิกถอน
  d2 := pg_temp.fx(p_shop, p_tpl, pn, 20, 3);
  j2 := pg_temp.jid(d2); th2 := d2 ->> 'tokh'; sa2 := pg_temp.sess(th2, wA, '4829');
  perform pg_temp.wr(th2, sa2, 4);
  lo := pg_temp.lot(pg_temp.ws(th2, sa2, 4, null, 5, 20));
  r := pg_temp.ws(th, sa, 4, lo, 3, 20);
  r2 := pg_temp.wr(th, sb, 5, lo);
  r3 := pg_temp.wc(th, sa, lo);
  v_log := v_log || pg_temp.chk('C2', 'p_lot_job_id ของใบอื่น (นอกต้นไม้ของ token): ส่ง/รับ/ยกเลิก = invalid_part · ส่วนของใบอื่นไม่ขยับ',
    (r ->> 'code') = 'invalid_part' and (r2 ->> 'code') = 'invalid_part' and (r3 ->> 'code') = 'invalid_part'
    and pg_temp.jv(lo, 'status') = 'in_progress' and pg_temp.sv(lo, 5, 'status') = 'pending');
  l1 := pg_temp.lot(pg_temp.ws(th, sa, 4, null, 5, 20));
  perform pg_temp.o_lcancel(p_shop, l1, 'verify', 'return_to_parent');
  r := pg_temp.wr(th, sb, 5, l1);
  v_log := v_log || pg_temp.chk('C3', 'ส่วนที่ยกเลิกแล้ว: ช่างรับ = job_closed · ขั้นของส่วนไม่ขยับ', (r ->> 'code') = 'job_closed' and pg_temp.sv(l1, 5, 'status') = 'pending');
  r := pg_temp.ws(th, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 4, null, 5, 15);
  v_log := v_log || pg_temp.chk('C4a', 'session ปลอม/หมดอายุ = session_required · ไม่สร้างส่วน', (r ->> 'code') = 'session_required' and pg_temp.nlots(j) = 1 and pg_temp.sv(j, 4, 'qty_split_out') = '0');
  update analytics.worker set is_active = false where id = wA;
  r := pg_temp.ws(th, sa, 4, null, 5, 15);
  v_log := v_log || pg_temp.chk('C4b', 'ช่างถูกปิดใช้งาน (session เดิมยังไม่หมดอายุ) = session_required · ไม่สร้างส่วน', (r ->> 'code') = 'session_required' and pg_temp.sv(j, 4, 'qty_split_out') = '0');
  update analytics.worker set is_active = true where id = wA;
  perform pg_temp.o_trevoke(p_shop, j);
  r := pg_temp.ws(th, sa, 4, null, 5, 15);
  v_log := v_log || pg_temp.chk('C4c', 'QR ถูกเพิกถอนทั้งหมด = invalid_token (ไม่ใช่ error อื่น) · ไม่สร้างส่วน', (r ->> 'code') = 'invalid_token' and pg_temp.nlots(j) = 1 and pg_temp.sv(j, 4, 'qty_split_out') = '0');
  return v_log;
end;
$s$;

create function pg_temp.sd(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; wA uuid;
  d jsonb; j uuid; th text; sa text;
  r jsonb; r2 jsonb; r3 jsonb; r4 jsonb; r5 jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  r := pg_temp.ws(th, sa, 4, null, 3, 10, 0, null, 9.9);
  r2 := pg_temp.ws(th, sa, 4, null, 3, 10, 0, null, null, 0.5);
  r3 := pg_temp.ws(th, sa, 4, null, 3, 10, 0, null, null, null, 0.1);
  r4 := pg_temp.ws(th, sa, 4, null, 3, 10, 0, null, null, null, null, 'x');
  r5 := pg_temp.ws(th, sa, 4, null, 3, 10, 0, null, 0, null, null, null);
  v_log := v_log || pg_temp.chk('D1', 'ส่งน้ำหนักออก / เติมโลหะ / เศษ / หมายเหตุน้ำหนัก / น้ำหนัก 0 มากับการแยก = weight_unexpected ทุกแบบ · ข้อความไม่มีตัวเลข (N1) · ไม่สร้างส่วน · ขั้นไม่ขยับ',
    (r ->> 'code') = 'weight_unexpected' and (r2 ->> 'code') = 'weight_unexpected' and (r3 ->> 'code') = 'weight_unexpected' and (r4 ->> 'code') = 'weight_unexpected'
    and (r5 ->> 'code') = 'weight_unexpected' and pg_temp.nodigit(r) and pg_temp.nodigit(r3)
    and pg_temp.nlots(j) = 0 and pg_temp.sv(j, 4, 'qty_split_out') = '0' and pg_temp.sv(j, 4, 'weight_out_g') is null);
  r := pg_temp.ws(th, sa, 4, null, 3, 10);
  v_log := v_log || pg_temp.chk('D2', 'ต้องไม่พัง: แยกโดยไม่ส่งน้ำหนักใดๆ = ok (ค1: นับจำนวนอย่างเดียว) · ส่วนไม่มีน้ำหนัก', (r ->> 'ok') = 'true' and pg_temp.sv(pg_temp.lot(r), 4, 'weight_in_g') is null);
  return v_log;
end;
$s$;

create function pg_temp.se(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; wA uuid;
  d jsonb; j uuid; th text; sa text;
  r jsonb; r2 jsonb; r3 jsonb; r4 jsonb; r5 jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  r := pg_temp.ws(th, sa, 4, null, 3, 10, 2, null);
  r2 := pg_temp.ws(th, sa, 4, null, 3, 10, 2, chr(8203));
  r3 := pg_temp.ws(th, sa, 4, null, 3, 10, 2, '.');
  r4 := pg_temp.ws(th, sa, 4, null, 3, 10, 2, E'ตก\tพื้น');
  r5 := pg_temp.ws(th, sa, 4, null, 3, 10, 0, 'porosity');
  v_log := v_log || pg_temp.chk('E1', 'ของเสียตอนแยก: ไม่มีเหตุผล / เหตุผลล่องหน (ZWSP) / เหตุผล "." / มี tab = reason_required · เหตุผลโดยไม่มีของเสีย = reason_unexpected · ไม่สร้างส่วน · ขั้นไม่ขยับ',
    (r ->> 'code') = 'reason_required' and (r2 ->> 'code') = 'reason_required' and (r3 ->> 'code') = 'reason_required' and (r4 ->> 'code') = 'reason_required'
    and (r5 ->> 'code') = 'reason_unexpected' and pg_temp.nlots(j) = 0 and pg_temp.sv(j, 4, 'qty_scrap') = '0' and pg_temp.sv(j, 4, 'qty_split_out') = '0');
  r := pg_temp.ws(th, sa, 4, null, 3, 10, 2, 'porosity');
  v_log := v_log || pg_temp.chk('E2', 'แยก 3 + เสีย 2 (เหตุผล porosity) = ok แม้แบบ "ไม่ชั่ง" ไม่ถามของเสีย (flag = ถาม ไม่ใช่ด่าน) · ขั้นแม่ scrap 2 เหตุผล porosity split_out 3 · ผู้ถือเหลือ 5 · event scrap + split',
    (r ->> 'ok') = 'true' and (r ->> 'parent_remaining') = '5' and pg_temp.sv(j, 4, 'qty_scrap') = '2' and pg_temp.sv(j, 4, 'scrap_reason') = 'porosity'
    and pg_temp.sv(j, 4, 'qty_split_out') = '3' and pg_temp.sv(j, 4, 'scrap_qty_ask') = 'false'
    and exists (select 1 from analytics.job_event where job_id = j and event_type = 'scrap' and (payload ->> 'qty') = '2' and payload ->> 'reason' = 'porosity' and payload ->> 'kind' = 'split')
    and pg_temp.dcount(j) = 0 and pg_temp.sdrift(j) = 0);
  r := pg_temp.ws(th, sa, 4, null, null, 5, 1, 'broken');
  v_log := v_log || pg_temp.chk('E3', 'ส่งส่วนที่เหลือพร้อมเสียเพิ่ม 1 (broken) ต่างเหตุผลจากที่บันทึกตอนแยก (porosity) = ok · ขั้นเสียรวม 3 เหตุผล other · qty_out = 10 − 3 − 3 = 4 · ไม่ drift',
    (r ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'qty_scrap') = '3' and pg_temp.sv(j, 4, 'scrap_reason') = 'other' and pg_temp.sv(j, 4, 'qty_out') = '4'
    and pg_temp.sv(j, 4, 'qty_split_out') = '3' and pg_temp.dcount(j) = 0 and pg_temp.sdrift(j) = 0);
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  perform pg_temp.ws(th, sa, 4, null, 3, 10, 2, 'ตกพื้น');
  r := pg_temp.ws(th, sa, 4, null, null, 5, 1, 'ตกพื้น');
  v_log := v_log || pg_temp.chk('E4', 'เสียเพิ่มตอนส่งด้วยเหตุผลเดียวกับที่บันทึกตอนแยก (ข้อความอิสระ) = คงเหตุผลเดิม · เสียรวม 3 · qty_out 4',
    (r ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'scrap_reason') = 'ตกพื้น' and pg_temp.sv(j, 4, 'qty_scrap') = '3' and pg_temp.sv(j, 4, 'qty_out') = '4' and pg_temp.dcount(j) = 0);
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  perform pg_temp.ws(th, sa, 4, null, 3, 10, 2, 'porosity');
  r := pg_temp.ws(th, sa, 4, null, null, 5, 6, 'broken');
  r2 := pg_temp.ws(th, sa, 4, null, null, 5, 5, 'broken');
  v_log := v_log || pg_temp.chk('E5', 'เสียตอนส่งส่วนที่เหลือเกินที่ถือ (6 > 5) = qty_invalid (ไม่นับของที่แยกไป/เสียไปแล้ว) · เสียเท่าที่ถือ (5) = ok qty_out 0',
    (r ->> 'code') = 'qty_invalid' and (r2 ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'qty_out') = '0' and pg_temp.sv(j, 4, 'qty_scrap') = '7' and pg_temp.dcount(j) = 0);
  return v_log;
end;
$s$;

-- ============================================================================
-- Section G — UPDATE/INSERT ตรง (ข้อ 6) · H — auto-close ขั้นที่แยก (ข้อ 7) · I — รับด้วยจำนวนไม่ถูกต้อง (ข้อ 8)
-- ============================================================================
create function pg_temp.sg(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; wA uuid;
  d jsonb; j uuid; th text; sa text;
  r jsonb; l1 uuid; ms uuid; d2 jsonb; j2 uuid;
  v_ins text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  d := pg_temp.fx(p_shop, p_tpl, pn, 100, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  l1 := pg_temp.lot(pg_temp.ws(th, sa, 4, null, 40, 100));
  ms := pg_temp.sid(j, 4);
  d2 := pg_temp.fx(p_shop, p_tpl, pn, 10, 0);
  j2 := pg_temp.jid(d2);

  v_log := v_log || pg_temp.chk('G1', 'UPDATE ตรง job.parent_job_id ของใบแม่ / lot_seq ของส่วน = ปฏิเสธ (ห้ามเปลี่ยนใบแม่/ลำดับส่วน)',
    pg_temp.x(format('update analytics.job set parent_job_id = %L where id = %L', j2, j)) like 'ERR:22023:%' and pg_temp.x(format('update analytics.job set lot_seq = 7 where id = %L', l1)) like 'ERR:%');
  v_log := v_log || pg_temp.chk('G2', 'UPDATE ตรง job.qty_split_out (ไม่ตรง Σ ของขั้น) ทั้งแม่และส่วน = ปฏิเสธ split_sum',
    pg_temp.x(format('update analytics.job set qty_split_out = 5 where id = %L', j)) like 'ERR:22023:%qty_split_out%'
    and pg_temp.x(format('update analytics.job set qty_split_out = 1 where id = %L', l1)) like 'ERR:22023:%qty_split_out%');
  v_log := v_log || pg_temp.chk('G3', 'UPDATE ตรง job_stage.qty_split_out บนขั้น pending / sent = ปฏิเสธ (เปลี่ยนได้เฉพาะขั้นที่ถืออยู่)',
    pg_temp.x(format('update analytics.job_stage set qty_split_out = 3 where job_id = %L and seq = 5', j)) like 'ERR:%'
    and pg_temp.x(format('update analytics.job_stage set qty_split_out = 1 where job_id = %L and seq = 4', l1)) like 'ERR:%');
  v_log := v_log || pg_temp.chk('G4', 'ลด/เพิ่ม qty_split_out ของขั้นแม่ตรงๆ (40→0 · 40→45) โดยไม่มีส่วนรองรับ = ปฏิเสธ split_link · ค่าคงเดิม',
    pg_temp.x(format('update analytics.job_stage set qty_split_out = 0 where id = %L', ms)) like 'ERR:22023:%qty_split_out%'
    and pg_temp.x(format('update analytics.job_stage set qty_split_out = 45 where id = %L', ms)) like 'ERR:22023:%qty_split_out%'
    and pg_temp.sv(j, 4, 'qty_split_out') = '40' and pg_temp.dcount(j) = 0);
  v_log := v_log || pg_temp.chk('G5', 'split_from_stage_id: แก้ตรงบนขั้นที่ไม่ใช่ขั้นแยก = ปฏิเสธ · INSERT ขั้นใหม่บนใบแม่ที่มี split_from = ปฏิเสธ (มีเฉพาะขั้นแยกของส่วน)',
    pg_temp.x(format('update analytics.job_stage set split_from_stage_id = %L where job_id = %L and seq = 5', ms, l1)) like 'ERR:22023:%'
    and pg_temp.x(format('insert into analytics.job_stage (job_id, shop_id, stage_code, seq, split_from_stage_id) select %L, shop_id, ''gem_set'', 9, %L from analytics.job where id = %L', j2, ms, j2)) like 'ERR:22023:%split_from%');

  -- INSERT ส่วนตรงๆ: ซ้อน 2 ชั้น · ต้นทาง/โลหะไม่ตรงแม่ · lot_seq ซ้ำ · มีแผนโลหะ
  v_ins := 'insert into analytics.job (shop_id, seq, source_kind, oem_quote_item_id, root_quote_id, oem_item_seq, production_order_item_id, product_id, design_label, sku_snapshot, metal, qty_planned, qty_order, weigh_required, created_by, profile_id, profile_name, require_final_weight, parent_job_id, lot_seq) '
        || 'select shop_id, %s, source_kind, oem_quote_item_id, root_quote_id, oem_item_seq, production_order_item_id, product_id, design_label, sku_snapshot, %s, 5, 5, false, created_by, profile_id, profile_name, require_final_weight, %L, %s from analytics.job where id = %L';
  v_log := v_log || pg_temp.chk('G6', 'INSERT ส่วนที่ชี้ "ส่วน" (ซ้อน 2 ชั้น) = ปฏิเสธ lot_nested · โลหะไม่ตรงแม่ = ปฏิเสธ lot_mismatch · lot_seq ซ้ำ = unique violation 23505 · ส่วนที่ถูกต้อง (lot_seq 9) = ผ่าน',
    pg_temp.x(format(v_ins, 990001, '''silver''', l1, 9, j)) like 'ERR:22023:%ซ้อนกันไม่ได้%'
    and pg_temp.x(format(v_ins, 990002, '''gold''', j, 9, j)) like 'ERR:22023:%ต้นทาง%'
    and pg_temp.x(format(v_ins, 990003, '''silver''', j, 1, j)) like 'ERR:23505:%'
    and pg_temp.x(format(v_ins, 990004, '''silver''', j, 9, j)) = 'OK');
  v_log := v_log || pg_temp.chk('G7', 'ส่วนมีแผนโลหะ (target_piece_g + basis) ภายหลัง = ปฏิเสธ lot_mismatch (แผนอยู่ที่ใบแม่)',
    pg_temp.x(format('update analytics.job set target_piece_g = 5, metal_plan_basis = ''{"x":1}''::jsonb where id = %L', l1)) like 'ERR:22023:%แผนโลหะ%');
  v_log := v_log || pg_temp.chk('G8', 'token: ออก QR ให้ส่วนผ่าน RPC = lot_no_token · INSERT job_token ตรงให้ส่วน = ปฏิเสธ · lot_job_id นอกต้นไม้ = ปฏิเสธ',
    pg_temp.rej(pg_temp.o_tissue(p_shop, l1), 'lot_no_token')
    and pg_temp.x(format('insert into analytics.job_token (shop_id, job_id, token_hash, print_no, issued_by) values (%L, %L, repeat(''a'', 64), 1, %L)', p_shop, l1, pg_temp.act())) like 'ERR:22023:%ส่วนย่อย%'
    and pg_temp.x(format('insert into analytics.job_token (shop_id, job_id, token_hash, print_no, issued_by, lot_job_id) values (%L, %L, repeat(''b'', 64), 9, %L, %L)', p_shop, j2, pg_temp.act(), l1)) like 'ERR:%');
  v_log := v_log || pg_temp.chk('G9', 'ใบแม่ซ้ำ: INSERT ใบแม่ใหม่ (parent null) ที่ source เดียวกับแม่ที่ยังไม่ยกเลิก = unique violation (ของเดิมคงอยู่) · ส่วน (parent ไม่ null) ไม่ชน',
    pg_temp.x(format(replace(replace(v_ins, '%L, %s from', 'null::uuid, 0 from'), ', 5, 5, false,', ', qty_order, qty_order, false,'), 990005, '''silver''', j)) like 'ERR:23505:%');
  return v_log;
end;
$s$;

create function pg_temp.sh(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; wA uuid; wB uuid;
  d jsonb; j uuid; th text; sa text; sb text;
  r jsonb; r2 jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  wB := pg_temp.wid(p_shop, 'vfy-ช่าง B', '7351');
  d := pg_temp.fx(p_shop, p_tpl, pn, 20, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4);
  perform pg_temp.ws(th, sa, 4, null, 5, 20);
  r := pg_temp.wr(th, sb, 5);
  r2 := pg_temp.o_recv2(p_shop, j, 5, null, wB);
  v_log := v_log || pg_temp.chk('H1', 'ช่างถัดไปรับขั้น 5 ของแม่ขณะผู้ถือยังค้างส่วนที่เหลือ (แยกแล้ว 5) = prev_not_sent (ไม่ auto-close) · ออฟฟิศ = ปฏิเสธ prev_not_sent · ขั้น 4 ยัง received · ขั้น 5 ยัง pending',
    (r ->> 'code') = 'prev_not_sent' and pg_temp.rej(r2, 'prev_not_sent') and pg_temp.sv(j, 4, 'status') = 'received' and pg_temp.sv(j, 4, 'auto_closed') = 'false' and pg_temp.sv(j, 5, 'status') = 'pending');
  v_log := v_log || pg_temp.chk('H2', 'UPDATE ตรง ปิดขั้นที่แยกแล้วแบบ auto_closed (qty_out = qty_in) = ปฏิเสธ (CHECK/guard) · ขั้นไม่ขยับ',
    pg_temp.x(format('update analytics.job_stage set status = ''sent'', sent_on = %L, qty_out = qty_in, auto_closed = true where job_id = %L and seq = 4', analytics.job_today(), j)) like 'ERR:%'
    and pg_temp.sv(j, 4, 'status') = 'received');
  -- ต้องไม่พัง: ใบที่ไม่แยก auto-close ได้ตามเดิม (แบบไม่ชั่ง)
  d := pg_temp.fx(p_shop, p_tpl, pn, 20, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4);
  r := pg_temp.wr(th, sb, 5);
  v_log := v_log || pg_temp.chk('H3', 'ต้องไม่พัง: ใบที่ไม่แยก + ขั้นไม่ชั่ง: ช่างถัดไปรับแล้วปิดขั้นก่อนอัตโนมัติได้ตามเดิม (prev_auto_closed true · qty_out = qty_in)',
    (r ->> 'ok') = 'true' and (r ->> 'prev_auto_closed') = 'true' and pg_temp.sv(j, 4, 'auto_closed') = 'true' and pg_temp.sv(j, 4, 'qty_out') = '20');
  return v_log;
end;
$s$;

create function pg_temp.si(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; wA uuid; wB uuid;
  d jsonb; j uuid; th text; sa text; sb text;
  r jsonb; r2 jsonb; r3 jsonb; r4 jsonb; l1 uuid;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  wB := pg_temp.wid(p_shop, 'vfy-ช่าง B', '7351');
  d := pg_temp.fx(p_shop, p_tpl, pn, 100, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4);
  l1 := pg_temp.lot(pg_temp.ws(th, sa, 4, null, 40, 100));
  r := pg_temp.wr(th, sb, 5, l1, 0);
  r2 := pg_temp.wr(th, sb, 5, l1, 41);
  r3 := pg_temp.wr(th, sb, 5, l1, -1);
  r4 := pg_temp.o_recv2(p_shop, l1, 5, 41, wB);
  v_log := v_log || pg_temp.chk('I1', 'รับด้วยจำนวน 0 / 41 (> ที่ส่ง 40) / −1 = qty_invalid · ออฟฟิศ 41 = ปฏิเสธ qty_invalid · ขั้นยัง pending · ไม่มีส่วนต่าง',
    (r ->> 'code') = 'qty_invalid' and (r2 ->> 'code') = 'qty_invalid' and (r3 ->> 'code') = 'qty_invalid' and pg_temp.rej(r4, 'qty_invalid')
    and pg_temp.sv(l1, 5, 'status') = 'pending' and not exists (select 1 from analytics.job_discrepancy where root_job_id = j));
  v_log := v_log || pg_temp.chk('I2', 'NaN เป็นจำนวนที่รับ = error ตั้งแต่ cast · ขั้นยัง pending',
    pg_temp.x(format('select analytics.job_office_receive(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>5, p_occurred_on=>%L, p_assignee_name=>''x'', p_qty_received=>%L::numeric::int, p_actor=>%L)', p_shop, l1, analytics.job_today(), 'NaN', pg_temp.act())) like 'ERR:%'
    and pg_temp.sv(l1, 5, 'status') = 'pending');
  -- ขั้นแรกของใบ: ส่งจำนวนที่รับมาไม่เท่าจำนวนเริ่มผลิตไม่ได้
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 0);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sb := pg_temp.sess(th, wB, '7351');
  r := pg_temp.wr(th, sb, 1, null, 5);
  r2 := pg_temp.o_recv2(p_shop, j, 1, 9, wB);
  v_log := v_log || pg_temp.chk('I3', 'ขั้นแรกของใบ: รับ 5 / 9 (≠ เริ่มผลิต 10) = qty_invalid ทั้งช่างและออฟฟิศ · ขั้นยัง pending',
    (r ->> 'code') = 'qty_invalid' and pg_temp.rej(r2, 'qty_invalid') and pg_temp.sv(j, 1, 'status') = 'pending');
  r := pg_temp.wr(th, sb, 1, null, 10);
  v_log := v_log || pg_temp.chk('I4', 'ต้องไม่พัง: ขั้นแรกรับ 10 (= เริ่มผลิต) = ok · ไม่มีส่วนต่าง', (r ->> 'ok') = 'true' and pg_temp.sv(j, 1, 'qty_in') = '10' and not exists (select 1 from analytics.job_discrepancy where root_job_id = j));
  return v_log;
end;
$s$;

-- ============================================================================
-- Section J — ส่วนต่างรอชี้แจง (ข้อ 9 · มติ Q5): รับไม่ครบ → แถว job_discrepancy → ชี้แจง scrap/lost → void · ผลรวมต้นไม้ยังตรง
-- ============================================================================
create function pg_temp.sj(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; wA uuid; wB uuid; wC uuid;
  d jsonb; j uuid; th text; sa text; sb text; sc text;
  r jsonb; r2 jsonb; r3 jsonb; r4 jsonb;
  l1 uuid; dd uuid; l2 uuid; dd2 uuid;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  wB := pg_temp.wid(p_shop, 'vfy-ช่าง B', '7351');
  wC := (pg_temp.wu(p_shop, 'vfy-ช่าง C', 'qc,pack', '2468') ->> 'id')::uuid;
  d := pg_temp.fx(p_shop, p_tpl, pn, 100, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh';
  sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351'); sc := pg_temp.sess(th, wC, '2468');
  perform pg_temp.wr(th, sa, 4);
  l1 := pg_temp.lot(pg_temp.ws(th, sa, 4, null, 40, 100));
  r := pg_temp.wr(th, sb, 5, l1, 35);
  dd := pg_temp.disc_of(l1);
  v_log := v_log || pg_temp.chk('J1', 'ช่าง B รับส่วนที่ 1 ได้ 35 จาก 40 → ok · qty_in 35 · แถวส่วนต่าง open qty 5 ผูกขั้นผู้ส่ง (seq 4) → ขั้นผู้รับ (seq 5) · event discrepancy ที่ขั้นผู้ส่ง · response discrepancy_qty 5',
    (r ->> 'ok') = 'true' and (r ->> 'discrepancy_qty') = '5' and pg_temp.sv(l1, 5, 'qty_in') = '35' and dd is not null
    and (select qty = 5 and status = 'open' and from_stage_id = pg_temp.sid(l1, 4) and to_stage_id = pg_temp.sid(l1, 5) and root_job_id = j and created_by_worker = wB from analytics.job_discrepancy where id = dd)
    and exists (select 1 from analytics.job_event where job_id = l1 and event_type = 'discrepancy' and job_stage_id = pg_temp.sid(l1, 4)));
  v_log := v_log || pg_temp.chk('J2', 'ต้นไม้ยังตรง: drift ว่าง · sum_check จริง · ส่วนรอชี้แจง 5 · ส่วนที่ 1 live 35 · v_job_board แถวใบแม่ qty_pending_explanation 5 · ไม่ drift ของ event',
    pg_temp.dcount(j) = 0 and pg_temp.sumok(j) and (select qty_pending_explanation = 5 from analytics.v_job_tree_summary where root_job_id = j)
    and analytics.job_live_qty(l1) = 35 and (select qty_pending_explanation from analytics.v_job_board where id = j) = 5 and pg_temp.sdrift(j) = 0);
  r := pg_temp.w_res(th, sa); r2 := pg_temp.w_res(th, sb); r3 := pg_temp.w_res(th, sc); r4 := pg_temp.w_res(th, null);
  v_log := v_log || pg_temp.chk('J3', 'resolve: ผู้ส่ง (A) มี action explain พร้อม discrepancy_id/qty 5 · ผู้รับ (B) และช่างอื่น (C) ไม่มี · ก่อน PIN: รายชื่อช่างมี A',
    exists (select 1 from jsonb_array_elements(r -> 'my_actions') a where a ->> 'action' = 'explain' and (a ->> 'discrepancy_id')::uuid = dd and (a ->> 'qty') = '5')
    and not exists (select 1 from jsonb_array_elements(r2 -> 'my_actions') a where a ->> 'action' = 'explain')
    and not exists (select 1 from jsonb_array_elements(r3 -> 'my_actions') a where a ->> 'action' = 'explain')
    and exists (select 1 from jsonb_array_elements(r4 -> 'workers') w where (w ->> 'id')::uuid = wA));
  r := pg_temp.wd(th, sb, dd, 'scrap', 'porosity');
  r2 := pg_temp.wd(th, sa, dd, 'broken', 'porosity');
  r3 := pg_temp.wd(th, sa, dd, 'scrap', null);
  r4 := pg_temp.wd(th, sa, dd, 'lost', chr(8203));
  v_log := v_log || pg_temp.chk('J4', 'ชี้แจงโดยผู้รับ (ไม่ใช่ผู้ส่ง) = not_sender · kind ผิด = kind_invalid · ไม่มีเหตุผล/เหตุผลล่องหน = reason_required · แถวยัง open',
    (r ->> 'code') = 'not_sender' and (r2 ->> 'code') = 'kind_invalid' and (r3 ->> 'code') = 'reason_required' and (r4 ->> 'code') = 'reason_required' and pg_temp.d_status(dd) = 'open');
  -- J9: ส่วนต่างที่ยัง open บล็อกการปิดส่วน (ข้อ 11) — เดินส่วนที่ 1 ให้ครบทุกขั้นก่อน แล้วลองปิด
  r := pg_temp.rw(p_shop, l1, null, 8);
  r2 := pg_temp.o_done(p_shop, l1, 35, 5);
  v_log := v_log || pg_temp.chk('J9', 'ส่วนที่ 1 เดินครบทุกขั้น (ส่งสุดท้าย 35) แต่มีส่วนต่าง open = ปิดส่วนไม่ได้ parts_open · ส่วนยังไม่ done · ไม่ drift',
    not (r ? '_err') and pg_temp.sv(l1, 8, 'qty_out') = '35' and pg_temp.rej(r2, 'parts_open') and pg_temp.jv(l1, 'status') <> 'done' and pg_temp.dcount(j) = 0);
  r := pg_temp.wd(th, sa, dd, 'lost', 'missing');
  r2 := pg_temp.wd(th, sa, dd, 'scrap', 'porosity');
  v_log := v_log || pg_temp.chk('J5', 'ผู้ส่งชี้แจง lost (missing) → ok · resolved โดย worker A · event discrepancy_resolve · ชี้แจงซ้ำ = already_resolved · drift ว่าง · ส่วนรอชี้แจง 0 ชี้แจงแล้ว 5 · sum_check จริง',
    (r ->> 'ok') = 'true' and (r2 ->> 'code') = 'already_resolved' and (select status = 'resolved' and resolved_kind = 'lost' and resolved_by_worker = wA from analytics.job_discrepancy where id = dd)
    and exists (select 1 from analytics.job_event where job_id = l1 and event_type = 'discrepancy_resolve')
    and pg_temp.dcount(j) = 0 and pg_temp.sumok(j)
    and (select qty_pending_explanation = 0 and qty_discrepancy_resolved = 5 from analytics.v_job_tree_summary where root_job_id = j));
  v_log := v_log || pg_temp.chk('J6', 'UPDATE/DELETE แถวส่วนต่างตรงๆ (แก้ qty · ย้อน status · ลบ) = ปฏิเสธ (append-only)',
    pg_temp.x(format('update analytics.job_discrepancy set qty = 1 where id = %L', dd)) like 'ERR:22023:%'
    and pg_temp.x(format('update analytics.job_discrepancy set status = ''open'' where id = %L', dd)) like 'ERR:%'
    and pg_temp.x(format('delete from analytics.job_discrepancy where id = %L', dd)) like 'ERR:22023:%'
    and pg_temp.x(format('update analytics.job_discrepancy set resolved_reason = ''broken'' where id = %L', dd)) like 'ERR:22023:%');
  r := pg_temp.o_done(p_shop, l1, 35, 5);
  v_log := v_log || pg_temp.chk('J10', 'หลังชี้แจงแล้ว ปิดส่วนที่ 1 ได้: ดี 35 + เสีย 5 (ส่วนต่างที่หาย) + แยกออก 0 = 40 · ต้นไม้ไม่ drift · sum_check จริง',
    (r ->> 'ok') = 'true' and pg_temp.jv(l1, 'status') = 'done' and pg_temp.dcount(j) = 0 and pg_temp.sumok(j));
  return v_log;
end;
$s$;

-- ============================================================================
-- Section J2 — ผู้มีสิทธิ์นอกร้าน (can_external) · ออฟฟิศชี้แจง · void (ต้องย้อนขั้นผู้รับก่อน) · รับใหม่เต็มจำนวน
-- ============================================================================
create function pg_temp.sj2(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; wA uuid; wB uuid; wC uuid;
  d jsonb; j uuid; th text; sa text; sb text; sc text;
  r jsonb; r2 jsonb; r3 jsonb;
  l1 uuid; l2 uuid; dd uuid; dd2 uuid;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  wB := pg_temp.wid(p_shop, 'vfy-ช่าง B', '7351');
  wC := (pg_temp.wu(p_shop, 'vfy-ช่าง C', 'qc,pack', '2468') ->> 'id')::uuid;
  d := pg_temp.fx(p_shop, p_tpl, pn, 100, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh';
  sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351'); sc := pg_temp.sess(th, wC, '2468');
  perform pg_temp.wr(th, sa, 4);
  l1 := pg_temp.lot(pg_temp.ws(th, sa, 4, null, 40, 100));
  perform pg_temp.wr(th, sb, 5, l1, 35);
  dd := pg_temp.disc_of(l1);
  r := pg_temp.wd(th, sc, dd, 'scrap', 'porosity');
  update analytics.worker set can_external = true where id = wC;
  r2 := pg_temp.wd(th, sc, dd, 'scrap', 'porosity');
  v_log := v_log || pg_temp.chk('J7', 'ช่างที่ไม่ใช่ผู้ส่งและไม่มี can_external (C) ชี้แจง = not_sender · ติ๊ก can_external แล้วชี้แจงแทนผู้ส่งได้ (resolved_by_worker = C kind scrap)',
    (r ->> 'code') = 'not_sender' and (r2 ->> 'ok') = 'true'
    and (select status = 'resolved' and resolved_kind = 'scrap' and resolved_by_worker = wC from analytics.job_discrepancy where id = dd));
  -- ส่วนที่ 2: B รับได้ 8 จาก 10 → ออฟฟิศ: kind ผิด / void ก่อนย้อนขั้น = ปฏิเสธ → ย้อนขั้นผู้รับ → void → ผู้รับรับใหม่เต็ม 10
  l2 := pg_temp.lot(pg_temp.ws(th, sa, 4, null, 10, 60));
  perform pg_temp.wr(th, sb, 5, l2, 8);
  dd2 := pg_temp.disc_of(l2);
  r := pg_temp.o_dres(p_shop, dd2, 'broken', 'porosity');
  r2 := pg_temp.o_dvoid(p_shop, dd2, 'ของเจอแล้ว');
  v_log := v_log || pg_temp.chk('J8', 'ออฟฟิศ: ชี้แจง kind ผิด = ปฏิเสธ kind_invalid · void ขณะผู้รับยัง received = ปฏิเสธ stage_not_pending · ไม่มีเหตุผล void = ปฏิเสธ · แถวยัง open',
    pg_temp.rej(r, 'kind_invalid') and pg_temp.rej(r2, 'stage_not_pending') and pg_temp.q(format('select analytics.job_discrepancy_void(%L, %L, null, %L)', p_shop, dd2, pg_temp.act())) ? '_err'
    and pg_temp.d_status(dd2) = 'open');
  r := pg_temp.o_reopen(p_shop, l2);
  v_log := v_log || pg_temp.chk('J9b', 'ย้อนขั้นผู้รับ (received→pending) ที่มีส่วนต่างอ้างถึงได้ (ขั้นผู้รับไม่ใช่ต้นทางของส่วนต่าง) · ต้นไม้ยังตรง (ชิ้น 8 รอรับ + ส่วนต่าง 2)',
    (r ->> 'ok') = 'true' and pg_temp.sv(l2, 5, 'status') = 'pending' and analytics.job_live_qty(l2) = 8 and pg_temp.dcount(j) = 0);
  r := pg_temp.o_dvoid(p_shop, dd2, 'ของเจอแล้ว');
  r2 := pg_temp.o_dvoid(p_shop, dd2, 'ซ้ำ');
  v_log := v_log || pg_temp.chk('J9c', 'void หลังย้อนขั้น = ok (แถวใหม่ status void ชี้แถวเดิม · แถวเดิมไม่ถูกแก้) · void ซ้ำ = ปฏิเสธ voided · ส่วนที่ 2 live กลับเป็น 10 · ชี้แจงแถวที่ถูก void ไม่ได้',
    (r ->> 'ok') = 'true' and pg_temp.rej(r2, 'voided')
    and (select count(*) from analytics.job_discrepancy where void_of_id = dd2 and status = 'void') = 1 and pg_temp.d_status(dd2) = 'open'
    and analytics.job_live_qty(l2) = 10 and pg_temp.dcount(j) = 0
    and pg_temp.rej(pg_temp.o_dres(p_shop, dd2, 'scrap', 'porosity'), 'already_resolved'));
  r := pg_temp.wr(th, sb, 5, l2);
  v_log := v_log || pg_temp.chk('J9d', 'ผู้รับรับใหม่ (ไม่ระบุจำนวน) = เต็ม 10 (ส่วนต่างที่ void ไม่นับ) · ไม่มีส่วนต่างที่ยังนับ · drift ว่าง · sum_check จริง',
    (r ->> 'ok') = 'true' and pg_temp.sv(l2, 5, 'qty_in') = '10' and r ->> 'discrepancy_qty' is null and pg_temp.dcount(j) = 0 and pg_temp.sumok(j)
    and analytics.job_disc_active_qty(pg_temp.sid(l2, 4), null) = 0);
  -- ย้อนขั้นต้นทางของส่วนต่างที่ยังนับอยู่ไม่ได้ (has_split)
  r := pg_temp.o_reopen(p_shop, l1);
  v_log := v_log || pg_temp.chk('J9e', 'ส่วนที่ 1 มีส่วนต่างที่ชี้แจงแล้วอ้างถึง: ย้อนขั้นล่าสุด (ขั้นผู้รับ ยังย้อนได้) แล้วย้อนอีกครั้ง (ขั้นต้นทางของส่วนต่าง = ขั้นแยก) = ปฏิเสธ has_split',
    (r ->> 'ok') = 'true' and pg_temp.rej(pg_temp.o_reopen(p_shop, l1), 'has_split'));
  return v_log;
end;
$s$;

-- ============================================================================
-- Section K — ยกเลิกส่วน (ข้อ 10 · มติ Q3/ข3) · L — ปิด/ยกเลิก/ย้อนขั้น (ข้อ 11) · M — ด่านต้นไม้ (ข้อ 12)
-- ============================================================================
create function pg_temp.sk(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; wA uuid; wB uuid;
  d jsonb; j uuid; th text; sa text; sb text;
  r jsonb; r2 jsonb; r3 jsonb; r4 jsonb;
  l1 uuid; l2 uuid; l3 uuid;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  wB := pg_temp.wid(p_shop, 'vfy-ช่าง B', '7351');
  -- K1 ช่างยกเลิกส่วนที่ตัวเองแยกก่อนมีคนรับ → ชิ้นกลับขั้นแม่ → แยกใหม่ได้ (เลขส่วนไม่ใช้ซ้ำ)
  d := pg_temp.fx(p_shop, p_tpl, pn, 100, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4);
  l1 := pg_temp.lot(pg_temp.ws(th, sa, 4, null, 40, 100));
  r := pg_temp.wc(th, sb, l1, 'ไม่ใช่ของฉัน');
  v_log := v_log || pg_temp.chk('K1a', 'ช่าง B ยกเลิกส่วนที่ช่าง A แยก = not_splitter · ส่วนยังเปิด · ขั้นแม่ split_out 40', (r ->> 'code') = 'not_splitter' and pg_temp.jv(l1, 'status') = 'in_progress' and pg_temp.sv(j, 4, 'qty_split_out') = '40');
  r := pg_temp.wc(th, sa, l1, 'แยกผิด');
  v_log := v_log || pg_temp.chk('K1b', 'ช่าง A (ผู้แยก ผู้ถือขั้นแม่) ยกเลิกก่อนมีคนรับ → ok return_to_parent · ส่วน cancelled (เหตุผลเก็บ) · ขั้นแม่ split_out 0 · job.qty_split_out 0 · ผู้ถือกลับมา 100 · event split_cancel ทั้งสองฝั่ง · drift ว่าง · sum_check จริง · parts_count 1',
    (r ->> 'ok') = 'true' and r ->> 'disposition' = 'return_to_parent' and pg_temp.jv(l1, 'status') = 'cancelled' and pg_temp.jv(l1, 'cancel_reason') = 'แยกผิด' and pg_temp.jv(l1, 'cancel_scrap_qty') is null
    and pg_temp.sv(j, 4, 'qty_split_out') = '0' and pg_temp.jv(j, 'qty_split_out') = '0' and analytics.job_live_qty(j) = 100
    and (select count(*) from analytics.job_event where event_type = 'split_cancel' and (job_id = l1 or job_id = j)) = 2
    and pg_temp.dcount(j) = 0 and pg_temp.sumok(j) and (select parts_count = 1 from analytics.v_job_tree_summary where root_job_id = j) and pg_temp.sdrift(j) = 0);
  r := pg_temp.ws(th, sa, 4, null, 25, 100);
  v_log := v_log || pg_temp.chk('K1c', 'แยกใหม่หลังยกเลิก = lot_seq 2 (ไม่ใช้เลข 1 ซ้ำ) · drift ว่าง', (r ->> 'ok') = 'true' and (r ->> 'lot_seq') = '2' and pg_temp.dcount(j) = 0);
  -- K2 มีคนรับแล้ว: ช่างยกเลิกไม่ได้ · ออฟฟิศคืนชิ้นไม่ได้ · ออฟฟิศยกเลิกเป็นของเสียต้องมีเหตุผล
  l2 := pg_temp.lot(r);
  perform pg_temp.wr(th, sb, 5, l2);
  r := pg_temp.wc(th, sa, l2);
  r2 := pg_temp.o_lcancel(p_shop, l2, 'verify', 'return_to_parent');
  r3 := pg_temp.o_lcancel(p_shop, l2, 'verify', 'scrap');
  v_log := v_log || pg_temp.chk('K2a', 'ส่วนที่ขั้นถัดไปถูกรับแล้ว: ช่างยกเลิก = already_received · ออฟฟิศ return = ปฏิเสธ already_received · ออฟฟิศ scrap ไม่ใส่เหตุผล = ปฏิเสธ reason_required · ส่วนยังเปิด',
    (r ->> 'code') = 'already_received' and pg_temp.rej(r2, 'already_received') and pg_temp.rej(r3, 'reason_required') and pg_temp.jv(l2, 'status') = 'in_progress');
  r := pg_temp.o_lcancel(p_shop, l2, 'ของเสียทั้งก้อน', 'scrap', 'broken');
  v_log := v_log || pg_temp.chk('K2b', 'ออฟฟิศยกเลิกเป็นของเสีย (เหตุผล broken) → ok · cancel_scrap_qty = ชิ้น live ตอนนั้น (25) · ขั้นแม่ยัง split_out 25 · drift ว่าง · sum_check จริง · qty_scrap_total รวม 25',
    (r ->> 'ok') = 'true' and pg_temp.jv(l2, 'status') = 'cancelled' and pg_temp.jv(l2, 'cancel_scrap_qty') = '25' and pg_temp.jv(l2, 'cancel_scrap_reason') = 'broken'
    and pg_temp.sv(j, 4, 'qty_split_out') = '25' and pg_temp.dcount(j) = 0 and pg_temp.sumok(j)
    and (select qty_scrap_total = 25 from analytics.v_job_tree_summary where root_job_id = j));
  -- แม่ส่งส่วนที่เหลือ (75) แล้วปิดแม่ได้ (ส่วนที่ยกเลิกไม่บล็อก): ดี + เสีย + แยกออก = 100
  r := pg_temp.ws(th, sa, 4, null, null, 75);
  perform pg_temp.rw(p_shop, j, null, 8);
  r2 := pg_temp.o_done(p_shop, j, 75, 0);
  v_log := v_log || pg_temp.chk('K2c', 'ส่วนที่ยกเลิกไม่บล็อกการปิดแม่: แม่ส่ง 75 แล้วปิด (ดี 75 + เสีย 0 + แยกออก 25 = 100) → ok · drift ว่าง · sum_check จริง',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true' and pg_temp.dcount(j) = 0 and pg_temp.sumok(j));

  -- K3 ผู้ถือเดิมส่งส่วนที่เหลือไปแล้ว → คืนชิ้นไม่ได้ (cannot_return) ทั้งช่างและออฟฟิศ
  d := pg_temp.fx(p_shop, p_tpl, pn, 30, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  l1 := pg_temp.lot(pg_temp.ws(th, sa, 4, null, 10, 30));
  perform pg_temp.ws(th, sa, 4, null, null, 20);
  r := pg_temp.wc(th, sa, l1);
  r2 := pg_temp.o_lcancel(p_shop, l1, 'verify', 'return_to_parent');
  v_log := v_log || pg_temp.chk('K3', 'ผู้ถือส่งส่วนที่เหลือไปแล้ว: ช่างยกเลิก = cannot_return · ออฟฟิศ return_to_parent = ปฏิเสธ cannot_return · ส่วนยังเปิด · split_out คงเดิม',
    (r ->> 'code') = 'cannot_return' and pg_temp.rej(r2, 'cannot_return') and pg_temp.jv(l1, 'status') = 'in_progress' and pg_temp.sv(j, 4, 'qty_split_out') = '10' and pg_temp.dcount(j) = 0);
  -- K4 ส่วนมีส่วนต่าง open → ยกเลิกไม่ได้
  d := pg_temp.fx(p_shop, p_tpl, pn, 30, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4);
  l1 := pg_temp.lot(pg_temp.ws(th, sa, 4, null, 10, 30));
  perform pg_temp.wr(th, sb, 5, l1, 8);
  r := pg_temp.wc(th, sa, l1);
  r2 := pg_temp.o_lcancel(p_shop, l1, 'verify', 'scrap', 'broken');
  v_log := v_log || pg_temp.chk('K4', 'ส่วนที่มีส่วนต่างรอชี้แจง: ช่างยกเลิก = discrepancy_open · ออฟฟิศ scrap = ปฏิเสธ discrepancy_open · ส่วนยังเปิด',
    (r ->> 'code') = 'discrepancy_open' and pg_temp.rej(r2, 'discrepancy_open') and pg_temp.jv(l1, 'status') = 'in_progress');
  -- K5 ส่วนที่แยกต่อ (มีลูก): ยกเลิกไม่ได้ (has_split)
  d := pg_temp.fx(p_shop, p_tpl, pn, 30, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4);
  l1 := pg_temp.lot(pg_temp.ws(th, sa, 4, null, 15, 30));
  perform pg_temp.wr(th, sb, 5, l1);
  l3 := pg_temp.lot(pg_temp.ws(th, sb, 5, l1, 5, 15));
  r := pg_temp.o_lcancel(p_shop, l1, 'verify', 'scrap', 'broken');
  r2 := pg_temp.o_lcancel(p_shop, l3, 'verify', 'return_to_parent');
  v_log := v_log || pg_temp.chk('K5', 'ส่วนที่มีส่วนแยกต่อ (split_out > 0 จากขั้นของมัน): ยกเลิก = ปฏิเสธ has_split · ส่วนลูก (ยังไม่มีคนรับ) คืนชิ้นให้ขั้นของส่วนที่แยกมา — ขั้นนั้นยัง received โดย B → ok · ต้นไม้ไม่ drift',
    pg_temp.rej(r, 'has_split') and (r2 ->> 'ok') = 'true' and pg_temp.sv(l1, 5, 'qty_split_out') = '0' and pg_temp.dcount(j) = 0 and pg_temp.sumok(j));
  -- K6 ของเสียที่บันทึกตอนแยก → คืนชิ้นไม่ได้ (scrap_recorded) · ออฟฟิศเลือก scrap
  d := pg_temp.fx(p_shop, p_tpl, pn, 30, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  l1 := pg_temp.lot(pg_temp.ws(th, sa, 4, null, 10, 30, 2, 'porosity'));
  r := pg_temp.wc(th, sa, l1);
  r2 := pg_temp.o_lcancel(p_shop, l1, 'verify', 'return_to_parent');
  r3 := pg_temp.o_lcancel(p_shop, l1, 'verify', 'scrap', 'porosity');
  v_log := v_log || pg_temp.chk('K6', 'แยกพร้อมของเสียที่บันทึก (2): คืนชิ้นจะเหลือขั้นแม่ split_out 0 + เสีย 2 (ผิด CHECK) → ช่าง/ออฟฟิศคืนไม่ได้ scrap_recorded · ออฟฟิศยกเลิกเป็นของเสียได้ (cancel_scrap_qty 10) · drift ว่าง',
    (r ->> 'code') = 'scrap_recorded' and pg_temp.rej(r2, 'scrap_recorded') and (r3 ->> 'ok') = 'true' and pg_temp.jv(l1, 'cancel_scrap_qty') = '10' and pg_temp.dcount(j) = 0 and pg_temp.sumok(j));
  -- K7 ออฟฟิศคืนชิ้นของส่วนที่ช่างแยก (ไม่จำกัดผู้แยก) · disposition ผิด · ใบแม่/ส่วนอื่น
  d := pg_temp.fx(p_shop, p_tpl, pn, 30, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  l1 := pg_temp.lot(pg_temp.ws(th, sa, 4, null, 10, 30));
  r := pg_temp.o_lcancel(p_shop, l1, 'verify', 'xx');
  r2 := pg_temp.o_lcancel(p_shop, j, 'verify', 'return_to_parent');
  r3 := pg_temp.o_lcancel(p_shop, l1, 'verify', 'return_to_parent');
  v_log := v_log || pg_temp.chk('K7', 'ที่ไปของชิ้นนอกชุด = ปฏิเสธ disposition_invalid · ยกเลิก "ใบแม่" ด้วย job_lot_cancel = ปฏิเสธ not_lot · ออฟฟิศคืนชิ้นของส่วนที่ช่างแยกได้ (ok) · ขั้นแม่ split_out 0',
    pg_temp.rej(r, 'disposition_invalid') and pg_temp.rej(r2, 'not_lot') and (r3 ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'qty_split_out') = '0' and pg_temp.dcount(j) = 0);
  return v_log;
end;
$s$;

create function pg_temp.sl(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; wA uuid; wB uuid;
  d jsonb; j uuid; th text; sa text; sb text;
  r jsonb; r2 jsonb; r3 jsonb;
  l1 uuid; l2 uuid;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  wB := pg_temp.wid(p_shop, 'vfy-ช่าง B', '7351');
  d := pg_temp.fx(p_shop, p_tpl, pn, 40, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4);
  l1 := pg_temp.lot(pg_temp.ws(th, sa, 4, null, 15, 40));
  r := pg_temp.o_cancel(p_shop, j);
  r2 := pg_temp.o_cancel(p_shop, l1);
  v_log := v_log || pg_temp.chk('L1', 'ยกเลิกใบแม่ที่มีส่วน = ปฏิเสธ has_parts · ยกเลิกส่วนด้วย job_cancel = ปฏิเสธ use_lot_cancel · UPDATE ตรง status cancelled ของแม่ = ปฏิเสธ (guard)',
    pg_temp.rej(r, 'has_parts') and pg_temp.rej(r2, 'use_lot_cancel')
    and pg_temp.x(format('update analytics.job set status = ''cancelled'', cancelled_at = now(), cancel_reason = ''x'' where id = %L', j)) like 'ERR:22023:%ส่วนย่อย%');
  -- เดินแม่/ส่วนจนครบ แล้วทดสอบปิด
  perform pg_temp.ws(th, sa, 4, null, null, 25);
  perform pg_temp.rw(p_shop, j, null, 8);
  perform pg_temp.rw(p_shop, l1, null, 8);
  v_log := v_log || pg_temp.chk('L2', 'UPDATE ตรง status=done ของแม่ที่ขั้นครบ แต่ส่วนยังเปิด = ปฏิเสธ parts_open (guard · ชั้นที่สองต่อจาก RPC)',
    pg_temp.x(format('update analytics.job set status = ''done'', done_at = now(), qty_good = 25, qty_scrap = 0 where id = %L', j)) like 'ERR:22023:%ส่วนย่อย%');
  r := pg_temp.o_done(p_shop, l1, 15, 0);
  r2 := pg_temp.o_done(p_shop, l1, 14, 1);
  v_log := v_log || pg_temp.chk('L3', 'ปิดส่วน: ดี 15 + เสีย 0 = 15 (ส่วนไม่มี split_out) ok · (ปิดซ้ำ = job_closed)', (r ->> 'ok') = 'true' and pg_temp.rej(r2, 'job_closed'));
  -- แม่: ดี + เสีย ไม่รวมส่วนที่แยกออก = qty_mismatch · UPDATE ตรง done ที่ ดี+เสีย = planned แต่ split_out > 0 = ปฏิเสธ CHECK
  r := pg_temp.o_done(p_shop, j, 25, 15);
  r2 := pg_temp.o_done(p_shop, j, 40, 0);
  v_log := v_log || pg_temp.chk('L4', 'ปิดแม่ที่แยกออก 15: ดี 25 + เสีย 15 (นับส่วนที่แยกเป็นเสีย) = qty_mismatch · ดี 40 (= planned โดยไม่นับแยก) = qty_mismatch · UPDATE ตรง ดี 25 + เสีย 0 + (แยก 15) ≠ 40 / ดี 40 + เสีย 0 + แยก 15 = ปฏิเสธ job_done_ck',
    pg_temp.rej(r, 'qty_mismatch') and pg_temp.rej(r2, 'qty_mismatch')
    and pg_temp.x(format('update analytics.job set status = ''done'', done_at = now(), qty_good = 40, qty_scrap = 0 where id = %L', j)) like 'ERR:23514:%job_done_ck%');
  r := pg_temp.o_done(p_shop, j, 25, 0);
  v_log := v_log || pg_temp.chk('L5', 'ปิดแม่ ดี 25 + เสีย 0 + แยกออก 15 = 40 → ok (ส่วนปิดแล้ว) · drift ว่าง · sum_check จริง', (r ->> 'ok') = 'true' and pg_temp.dcount(j) = 0 and pg_temp.sumok(j));

  -- ย้อนขั้น (reopen)
  d := pg_temp.fx(p_shop, p_tpl, pn, 40, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4);
  l1 := pg_temp.lot(pg_temp.ws(th, sa, 4, null, 15, 40));
  r := pg_temp.o_reopen(p_shop, j);
  r2 := pg_temp.o_reopen(p_shop, l1);
  v_log := v_log || pg_temp.chk('L6', 'ย้อนขั้นล่าสุดของแม่ (received ที่แยก 15) = ปฏิเสธ has_split · ย้อนขั้นล่าสุดของส่วน (ขั้นแยก) = ปฏิเสธ has_split · UPDATE ตรง (received→pending ของขั้นที่แยก · sent→received ของขั้นแยกของส่วน) = ปฏิเสธ',
    pg_temp.rej(r, 'has_split') and pg_temp.rej(r2, 'has_split') and (r ->> '_err') like 'ย้อนขั้นไม่ได้ — ขั้นนี้มีการแยกส่วน%' and (r2 ->> '_err') like 'ย้อนขั้นไม่ได้ — ขั้นนี้มีการแยกส่วน%'
    and pg_temp.x(format('update analytics.job_stage set status = ''pending'', received_on = null, worker_id = null, assignee_name = null, qty_in = null where job_id = %L and seq = 4', j)) like 'ERR:%'
    and pg_temp.x(format('update analytics.job_stage set status = ''received'', sent_on = null, qty_out = null where job_id = %L and seq = 4', l1)) like 'ERR:%'
    and pg_temp.sv(j, 4, 'status') = 'received' and pg_temp.sv(l1, 4, 'status') = 'sent');
  perform pg_temp.wr(th, sb, 5, l1);
  r := pg_temp.o_reopen(p_shop, l1);
  r2 := pg_temp.wr(th, sb, 5, l1);
  v_log := v_log || pg_temp.chk('L7', 'ต้องไม่พัง: ย้อนขั้นที่ส่วนเดินต่อไปแล้ว (ขั้น 5 received→pending) ย้อนได้ตามเดิม แล้วรับใหม่ได้ · drift ว่าง',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true' and pg_temp.dcount(j) = 0);
  -- ข้ามขั้นที่ยังไม่ถึงของส่วน ได้ตามเดิม (ไม่พัง) · ข้าม QC ของส่วนไม่ได้
  r := pg_temp.q(format('select analytics.job_stage_skip(%L, %L, %L, %L, %L)', p_shop, l1, 'polish', 'verify', pg_temp.act()));
  r2 := pg_temp.q(format('select analytics.job_stage_skip(%L, %L, %L, %L, %L)', p_shop, l1, 'qc', 'verify', pg_temp.act()));
  v_log := v_log || pg_temp.chk('L8', 'ต้องไม่พัง: ข้ามขั้น polish ที่ส่วนยังไม่ถึง = ok · ข้าม QC ของส่วน = ปฏิเสธ stage_required (ข้อยกเว้น split_inherit ใช้ผ่าน RPC แยกส่วนเท่านั้น)',
    (r ->> 'ok') = 'true' and pg_temp.rej(r2, 'stage_required') and pg_temp.dcount(j) = 0);
  return v_log;
end;
$s$;

create function pg_temp.sm(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; wA uuid;
  d jsonb; j uuid; th text; sa text;
  r jsonb; l1 uuid; ms uuid; v_codes text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  d := pg_temp.fx(p_shop, p_tpl, pn, 100, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  l1 := pg_temp.lot(pg_temp.ws(th, sa, 4, null, 40, 100));
  ms := pg_temp.sid(j, 4);
  v_log := v_log || pg_temp.chk('M0', 'ก่อนบิด: ต้นไม้ตรง (drift ว่าง) · job_tree_assert ผ่านเงียบ', pg_temp.dcount(j) = 0 and pg_temp.x(format('select analytics.job_tree_assert(%L)', j)) = 'OK');
  -- ปิด guard ของขั้น (จำลองทางอื่นที่แก้จำนวนตรงๆ) แล้วลด split_out ของแม่ 40→35
  execute 'alter table analytics.job_stage disable trigger trg_job_stage_guard';
  update analytics.job_stage set qty_split_out = 35 where id = ms;
  execute 'alter table analytics.job_stage enable trigger trg_job_stage_guard';
  select string_agg(distinct check_code, ',' order by check_code) into v_codes from analytics.v_job_tree_drift where root_job_id = j;
  v_log := v_log || pg_temp.chk('M1', 'บิดจำนวน (ลด qty_split_out 40→35 โดยเลี่ยง guard) → v_job_tree_drift มีแถว (split_link + tree_sum) · job_tree_assert = raise tree_sum_mismatch ข้อความไม่มี UUID ' || coalesce(v_codes, ''),
    v_codes like '%split_link%' and v_codes like '%tree_sum%'
    and pg_temp.q(format('select analytics.job_tree_assert(%L)', j)) ->> '_hint' = 'tree_sum_mismatch'
    and pg_temp.q(format('select analytics.job_tree_assert(%L)', j)) ->> '_err' !~ '[0-9a-f]{8}-[0-9a-f]{4}');
  r := pg_temp.ws(th, sa, 4, null, null, 65);
  v_log := v_log || pg_temp.chk('M2', 'หลังบิด RPC ที่แตะต้นไม้ (ส่งส่วนที่เหลือ) ถอยทั้งก้อนด้วย tree_sum_mismatch · ขั้นแม่ยัง received',
    r ->> '_hint' = 'tree_sum_mismatch' and pg_temp.sv(j, 4, 'status') = 'received');
  update analytics.job_stage set qty_split_out = 40 where id = ms;
  v_log := v_log || pg_temp.chk('M3', 'คืนค่า 40 แล้วต้นไม้กลับตรง (drift ว่าง) · ส่งส่วนที่เหลือผ่านได้',
    pg_temp.dcount(j) = 0 and (pg_temp.ws(th, sa, 4, null, null, 60) ->> 'ok') = 'true');
  return v_log;
end;
$s$;

-- ============================================================================
-- Section N — QR หลายใบ ไม่เพิกถอนของเก่า (ข้อ 13 · ข1 · Q8 เพดาน 5) · เพิกถอนรายใบ · รายการ QR
-- ============================================================================
create function pg_temp.sn(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; wA uuid;
  d jsonb; j uuid; th text; sa text; d2 jsonb; j2 uuid; lo uuid;
  r jsonb; r2 jsonb; r3 jsonb; r4 jsonb; l1 uuid; v_no text;
  h1 text; h2 text; h3 text; h4 text; n_act int; i int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  d := pg_temp.fx(p_shop, p_tpl, pn, 20, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  select job_no into v_no from analytics.job where id = j;
  d2 := pg_temp.fx(p_shop, p_tpl, pn, 20, 3);
  j2 := pg_temp.jid(d2);
  perform pg_temp.wr(d2 ->> 'tokh', pg_temp.sess(d2 ->> 'tokh', wA, '4829'), 4);
  lo := pg_temp.lot(pg_temp.ws(d2 ->> 'tokh', pg_temp.sess(d2 ->> 'tokh', wA, '4829'), 4, null, 5, 20));
  -- N1 ชนิด/ส่วนไม่ถูกต้อง
  r := pg_temp.o_tissue(p_shop, j, null, 'foo');
  r2 := pg_temp.o_tissue(p_shop, j, null, 'sublot', null);
  r3 := pg_temp.o_tissue(p_shop, j, null, 'traveler', lo);
  r4 := pg_temp.o_tissue(p_shop, j, null, 'sublot', lo);
  v_log := v_log || pg_temp.chk('N1', 'purpose นอกชุด = purpose_invalid · sublot ไม่ระบุส่วน / traveler ระบุส่วน = lot_invalid · ส่วนของใบอื่น = lot_invalid · ไม่ออก token เพิ่ม',
    pg_temp.rej(r, 'purpose_invalid') and pg_temp.rej(r2, 'lot_invalid') and pg_temp.rej(r3, 'lot_invalid') and pg_temp.rej(r4, 'lot_invalid')
    and (select count(*) from analytics.job_token where job_id = j and revoked_at is null) = 1);
  -- N2 ใบส่วนเดียว traveler ค่าเริ่ม (null) = เพิกถอนของเก่า (เหมือน J1) · ค่า false = ไม่เพิกถอน
  r := pg_temp.o_tissue(p_shop, j);
  v_log := v_log || pg_temp.chk('N2', 'ใบที่ยังไม่แบ่ง: พิมพ์ traveler ค่าเริ่ม (null) = เพิกถอนใบเก่า 1 ใบ · ใช้งานอยู่ 1 · token เก่าใช้ไม่ได้ (invalid_token)',
    (r ->> 'revoked_previous') = '1' and (select count(*) from analytics.job_token where job_id = j and revoked_at is null) = 1 and (pg_temp.w_res(th, null) ->> 'code') = 'invalid_token');
  h1 := r ->> 'hash';
  -- N3 แบ่งส่วนแล้ว: sublot/traveler ค่าเริ่ม = ไม่เพิกถอน · ค่า true ชัดเจนชนะ
  perform pg_temp.wr(h1, pg_temp.sess(h1, wA, '4829'), 4);
  l1 := pg_temp.lot(pg_temp.ws(h1, pg_temp.sess(h1, wA, '4829'), 4, null, 5, 20));
  r := pg_temp.o_tissue(p_shop, j, null, 'sublot', l1);
  r2 := pg_temp.o_tissue(p_shop, j, null, 'sublot', l1);
  r3 := pg_temp.o_tissue(p_shop, j);
  h2 := r ->> 'hash'; h3 := r2 ->> 'hash'; h4 := r3 ->> 'hash';
  select count(*) into n_act from analytics.job_token where job_id = j and revoked_at is null;
  v_log := v_log || pg_temp.chk('N3', 'ใบที่แบ่งแล้ว: ใบย่อย (sublot) 2 ใบ + traveler ค่าเริ่ม = ไม่เพิกถอนของเก่าเลย (revoked_previous 0 ทั้งหมด) · ใช้งานอยู่ 4 ใบ · label ใบย่อย = "<job_no> · ส่วนที่ 1"',
    (r ->> 'revoked_previous') = '0' and (r2 ->> 'revoked_previous') = '0' and (r3 ->> 'revoked_previous') = '0' and n_act = 4 and r ->> 'lot_label' = v_no || ' · ส่วนที่ 1' and r ->> 'purpose' = 'sublot');
  v_log := v_log || pg_temp.chk('N4', 'ทุก QR (traveler + sublot) เปิดใบงานเดียวกัน: resolve ด้วย 4 token ได้ job_no เดียวกันทั้งหมด',
    (pg_temp.w_res(h1, null) -> 'job' ->> 'job_no') = v_no and (pg_temp.w_res(h2, null) -> 'job' ->> 'job_no') = v_no
    and (pg_temp.w_res(h3, null) -> 'job' ->> 'job_no') = v_no and (pg_temp.w_res(h4, null) -> 'job' ->> 'job_no') = v_no);
  -- N5 รายการ QR: ไม่มี token/hash · มี purpose/label/active
  r := pg_temp.o_tlist(p_shop, j);
  v_log := v_log || pg_temp.chk('N5', 'job_token_list: 5 รายการ (รวมที่เพิกถอนแล้ว) · มี print_no/purpose/label/active · ไม่มี key token/hash · ใบย่อยมี lot_job_id',
    jsonb_array_length(r) = 5 and pg_temp.clean_keys(r) and not exists (select 1 from jsonb_array_elements(r) e where not (e ? 'print_no' and e ? 'purpose' and e ? 'label' and e ? 'active'))
    and (select count(*) from jsonb_array_elements(r) e where e ->> 'purpose' = 'sublot' and (e ->> 'lot_job_id')::uuid = l1) = 2);
  -- N6 เพิกถอนรายใบ: ใบอื่นยังใช้ได้ · print_no ไม่มี = token_not_found
  r := pg_temp.q(format('select analytics.job_token_revoke(%L, %L, %L, %L, %L)', p_shop, j, 'ใบหาย', pg_temp.act(), 4));
  v_log := v_log || pg_temp.chk('N6a', 'เพิกถอนเฉพาะ print_no 4 → revoked 1 · ใบ 2/3/5 ยังใช้ได้ · ใบที่ถูกเพิกถอนเปิดไม่ได้ (invalid_token)',
    (r ->> 'revoked') = '1' and (pg_temp.w_res(h2, null) ->> 'ok') = 'true' and (pg_temp.w_res(h4, null) ->> 'ok') = 'true'
    and (pg_temp.w_res(h3, null) ->> 'code') = 'invalid_token' and (select count(*) from analytics.job_token where job_id = j and revoked_at is null) = 3);
  r := pg_temp.q(format('select analytics.job_token_revoke(%L, %L, %L, %L, %L)', p_shop, j, 'ใบหาย', pg_temp.act(), 4));
  r2 := pg_temp.q(format('select analytics.job_token_revoke(%L, %L, %L, %L, %L)', p_shop, j, 'ใบหาย', pg_temp.act(), 99));
  v_log := v_log || pg_temp.chk('N6b', 'เพิกถอน print_no ที่เพิกถอนแล้ว / ไม่มี = ปฏิเสธ token_not_found · ใช้งานอยู่ยัง 3', pg_temp.rej(r, 'token_not_found') and pg_temp.rej(r2, 'token_not_found')
    and (select count(*) from analytics.job_token where job_id = j and revoked_at is null) = 3);
  -- N7 เพดาน 5: ครบ 5 ใบที่ใช้งานอยู่ แล้วพิมพ์เพิ่ม = token_cap (ไม่เพิกถอนเงียบ) · explicit true เพิกถอนทั้งหมดแล้วออกใหม่
  perform pg_temp.o_tissue(p_shop, j, false, 'sublot', l1);
  perform pg_temp.o_tissue(p_shop, j, false, 'sublot', l1);
  r := pg_temp.o_tissue(p_shop, j, false, 'sublot', l1);
  v_log := v_log || pg_temp.chk('N7a', 'ครบ 5 ใบที่ใช้งานอยู่แล้วพิมพ์เพิ่ม = ปฏิเสธ token_cap · ใช้งานอยู่ยัง 5 (ไม่เพิกถอนเงียบ · ไม่ออกใบที่ 6)', pg_temp.rej(r, 'token_cap')
    and (select count(*) from analytics.job_token where job_id = j and revoked_at is null) = 5);
  r := pg_temp.o_tissue(p_shop, j, true);
  v_log := v_log || pg_temp.chk('N7b', 'ส่ง revoke=true ชัดเจนบนใบที่แบ่งแล้ว = เพิกถอน 5 ใบเดิมแล้วออกใบใหม่ (ใช้งานอยู่ 1) — ค่าชัดเจนชนะค่าเริ่ม',
    (r ->> 'revoked_previous') = '5' and (select count(*) from analytics.job_token where job_id = j and revoked_at is null) = 1);
  return v_log;
end;
$s$;

-- ============================================================================
-- Section P — สิทธิ์/overload/โครงสร้าง (ข้อ 15 · ข้อ 18.5): พฤติกรรมจริง ไม่ใช่แค่อ่าน ACL
-- ============================================================================
create function pg_temp.sp(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  v_touched constant text[] := array[
    'job_scrap_reason_valid', 'job_disc_excess_g', 'job_disc_active_qty', 'job_live_qty', 'job_identity_gap', 'job_tree_dominant_stage', 'job_lot_return_blocker',
    'job_discrepancy_guard', 'job_tree_assert', 'job_tree_check', 'job_lot_split_core', 'job_lot_cancel_core',
    'job_lot_split', 'job_lot_cancel', 'job_discrepancy_resolve', 'job_discrepancy_void', 'job_token_list',
    'job_worker_discrepancy_resolve', 'job_worker_lot_cancel',
    'job_cancel', 'job_core_receive', 'job_core_send', 'job_done', 'job_guard', 'job_office_begin', 'job_office_receive', 'job_source_info',
    'job_stage_guard', 'job_stage_reopen', 'job_stage_state', 'job_stage_sync', 'job_token_guard', 'job_token_issue', 'job_token_revoke',
    'job_worker_receive', 'job_worker_resolve', 'job_worker_send'];
  v_rpc constant text[] := array[
    'job_lot_split', 'job_lot_cancel', 'job_discrepancy_resolve', 'job_discrepancy_void', 'job_token_list',
    'job_worker_discrepancy_resolve', 'job_worker_lot_cancel',
    'job_cancel', 'job_done', 'job_office_receive', 'job_stage_reopen', 'job_token_issue', 'job_token_revoke',
    'job_worker_receive', 'job_worker_resolve', 'job_worker_send',
    'job_stage_state', 'job_disc_excess_g', 'job_disc_active_qty', 'job_live_qty', 'job_identity_gap', 'job_tree_dominant_stage'];
  v_x text; v_bad text; k text; v_n int; r record;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select string_agg(proname || '=' || n, ', ') into v_x from (
    select proname, count(*) n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = any (v_touched) group by proname having count(*) <> 1) z;
  select count(distinct proname) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = any (v_touched);
  v_log := v_log || pg_temp.chk('P1', 'ทุกฟังก์ชันที่ drop/replace/สร้างใหม่ (37 ชื่อ) มี signature เดียวใน pg_proc (ไม่เกิด overload) ' || coalesce(v_x, ''), v_x is null and v_n = 37);
  v_bad := '';
  for r in select p.oid, p.oid::regprocedure::text as sig, p.proname from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = any (v_touched) loop
    if has_function_privilege('anon', r.oid, 'execute') or has_function_privilege('authenticated', r.oid, 'execute')
       or has_function_privilege('service_role', r.oid, 'execute') <> (r.proname = any (v_rpc)) then
      v_bad := v_bad || ' ' || r.proname;
    end if;
  end loop;
  v_log := v_log || pg_temp.chk('P2', 'ACL: anon/authenticated ไม่มี execute บนทุกตัว · service_role มีเฉพาะ RPC 22 ตัวที่ประกาศ (ภายใน/trigger/core ไม่มี) ' || v_bad, v_bad = '');
  execute 'grant usage on schema analytics to authenticated';  -- จำลองวันที่กำแพงชั้นนอกหลุด (ถอยกลับพร้อม section)
  v_bad := '';
  foreach k in array array[
    'select analytics.job_lot_split(null::uuid, null::uuid, null::int, null::int)',
    'select analytics.job_lot_cancel(null::uuid, null::uuid, null::text, null::text)',
    'select analytics.job_discrepancy_resolve(null::uuid, null::uuid, null::text, null::text)',
    'select analytics.job_discrepancy_void(null::uuid, null::uuid, null::text)',
    'select analytics.job_token_list(null::uuid, null::uuid)',
    'select analytics.job_token_issue(null::uuid, null::uuid)',
    'select analytics.job_worker_send(null::text, null::text, null::int)',
    'select analytics.job_worker_receive(null::text, null::text, null::int)',
    'select analytics.job_worker_discrepancy_resolve(null::text, null::text, null::uuid, null::text, null::text)',
    'select analytics.job_worker_lot_cancel(null::text, null::text, null::uuid)',
    'select analytics.job_worker_resolve(null::text)',
    'select analytics.job_live_qty(null::uuid)',
    'select analytics.job_disc_excess_g(null::numeric, null::numeric, null::int, null::int)'] loop
    v_x := pg_temp.as_role('authenticated', k);
    if v_x not like 'ERR:42501:%' then v_bad := v_bad || ' ' || left(k, 45) || '=' || left(v_x, 30); end if;
  end loop;
  v_log := v_log || pg_temp.chk('P3', 'พฤติกรรมจริง: authenticated (หลังได้ usage ของสคีมา) เรียก RPC ใหม่/ที่ replace ทุกตัว = 42501 permission denied ก่อนเข้า body ' || v_bad, v_bad = '');
  v_x := pg_temp.as_role('authenticated', 'select 1 from analytics.job_discrepancy limit 1');
  v_log := v_log || pg_temp.chk('P4', 'authenticated อ่านตาราง/view ใหม่ตรงๆ = 42501 (job_discrepancy · v_job_tree · v_job_tree_summary · v_job_tree_drift · v_job_tree_stage_loss · v_job_discrepancy) · service_role อ่านได้ แต่เขียนตรง (INSERT/UPDATE/DELETE) = 42501',
    v_x like 'ERR:42501:%'
    and pg_temp.as_role('authenticated', 'select 1 from analytics.v_job_tree limit 1') like 'ERR:42501:%'
    and pg_temp.as_role('authenticated', 'select 1 from analytics.v_job_tree_summary limit 1') like 'ERR:42501:%'
    and pg_temp.as_role('authenticated', 'select 1 from analytics.v_job_tree_drift limit 1') like 'ERR:42501:%'
    and pg_temp.as_role('authenticated', 'select 1 from analytics.v_job_tree_stage_loss limit 1') like 'ERR:42501:%'
    and pg_temp.as_role('authenticated', 'select 1 from analytics.v_job_discrepancy limit 1') like 'ERR:42501:%'
    and pg_temp.as_role('service_role', 'select 1 from analytics.v_job_tree_stage_loss limit 1') = 'OK'
    and pg_temp.as_role('service_role', 'select 1 from analytics.v_job_discrepancy limit 1') = 'OK'
    and pg_temp.as_role('service_role', 'select 1 from analytics.job_discrepancy limit 1') = 'OK'
    and pg_temp.as_role('service_role', 'select 1 from analytics.v_job_tree_drift limit 1') = 'OK'
    and pg_temp.as_role('service_role', 'update analytics.job_discrepancy set qty = qty') like 'ERR:42501:%'
    and pg_temp.as_role('service_role', 'delete from analytics.job_discrepancy') like 'ERR:42501:%'
    and pg_temp.as_role('service_role', 'update analytics.job set qty_split_out = 1') like 'ERR:42501:%');
  v_log := v_log || pg_temp.chk('P5', 'job_token: service_role อ่านคอลัมน์ purpose/lot_job_id ได้ แต่ token_hash ยังอ่านไม่ได้ (42501) · worker.can_external อ่านได้ pin_hash ยังอ่านไม่ได้',
    pg_temp.as_role('service_role', 'select purpose, lot_job_id from analytics.job_token limit 1') = 'OK'
    and pg_temp.as_role('service_role', 'select token_hash from analytics.job_token limit 1') like 'ERR:42501:%'
    and pg_temp.as_role('service_role', 'select can_external from analytics.worker limit 1') = 'OK'
    and pg_temp.as_role('service_role', 'select pin_hash from analytics.worker limit 1') like 'ERR:42501:%');
  v_log := v_log || pg_temp.chk('P6', 'RLS: job_discrepancy เปิด ไม่มี policy · RPC ช่าง/ออฟฟิศใหม่เป็น security definer ที่ pin search_path · trigger ตารางใบงาน/ช่าง/ส่วนต่างเปิดครบ',
    (select relrowsecurity from pg_class where oid = 'analytics.job_discrepancy'::regclass) and not exists (select 1 from pg_policy where polrelid = 'analytics.job_discrepancy'::regclass)
    and not exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = any (v_rpc) and p.proname not in ('job_stage_state', 'job_disc_excess_g', 'job_disc_active_qty', 'job_live_qty', 'job_identity_gap', 'job_tree_dominant_stage')
                      and (not p.prosecdef or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')))
    and exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_disc_excess_g' and p.provolatile = 'i' and not p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
    and not exists (select 1 from pg_trigger t where t.tgrelid in ('analytics.job'::regclass, 'analytics.job_stage'::regclass, 'analytics.job_event'::regclass, 'analytics.job_token'::regclass,
                                                                  'analytics.worker'::regclass, 'analytics.job_discrepancy'::regclass) and not t.tgisinternal and t.tgenabled not in ('O', 'A')));
  v_log := v_log || pg_temp.chk('P7', 'โครงสร้าง: CHECK ใหม่/แก้ครบ (job_done_ck นับ qty_split_out · js_sent_ck · js_not_sent_ck ยอมเสียก่อนส่งเฉพาะ split_out>0 · js_idle_ck · event ใหม่ 4 ชนิด) · unique 3 ตัวมี parent_job_id is null · มี uq_job_lot_seq',
    (select pg_get_constraintdef(oid) like '%qty_split_out%' from pg_constraint where conname = 'job_done_ck' and conrelid = 'analytics.job'::regclass)
    and (select pg_get_constraintdef(oid) like '%qty_split_out%' from pg_constraint where conname = 'js_sent_ck')
    and (select pg_get_constraintdef(oid) like '%qty_split_out > 0%' from pg_constraint where conname = 'js_not_sent_ck')
    and (select pg_get_constraintdef(oid) like '%qty_split_out = 0%' from pg_constraint where conname = 'js_idle_ck')
    and (select pg_get_constraintdef(oid) like '%split_cancel%' and pg_get_constraintdef(oid) like '%discrepancy_resolve%' from pg_constraint where conname = 'job_event_event_type_ck')
    and (select count(*) from pg_indexes where schemaname = 'analytics' and indexname in ('uq_job_production_item', 'uq_job_oem_item', 'uq_job_oem_deal_seq') and indexdef like '%parent_job_id IS NULL%') = 3
    and exists (select 1 from pg_indexes where schemaname = 'analytics' and indexname = 'uq_job_lot_seq'));
  v_log := v_log || pg_temp.chk('P8', 'เพดาน QR ยัง 5 (ไม่ใช่ 12) ในนิยาม job_token_issue · ใบส่วนย่อย/ส่วนต่างของช่างใช้ job_today() (เวลาไทย) ไม่ใช้ current_date/now()::date ในแยกส่วน/ยกเลิกส่วน (ข้อ 6)',
    pg_get_functiondef('analytics.job_token_issue(uuid,uuid,boolean,uuid,text,uuid)'::regprocedure) like '%v_active >= 5%'
    and pg_get_functiondef('analytics.job_lot_split_core(uuid,int,int,int,int,text,numeric,numeric,numeric,text,numeric,uuid,text,uuid,text,boolean)'::regprocedure) like '%job_today()%'
    and pg_get_functiondef('analytics.job_lot_split_core(uuid,int,int,int,int,text,numeric,numeric,numeric,text,numeric,uuid,text,uuid,text,boolean)'::regprocedure) !~* 'current_date|now\(\)::date'
    and pg_get_functiondef('analytics.job_lot_cancel_core(uuid,text,text,text,numeric,uuid,text,uuid,text,boolean)'::regprocedure) !~* 'current_date|now\(\)::date'
    and pg_get_functiondef('analytics.job_worker_discrepancy_resolve(text,text,uuid,text,text,text,text)'::regprocedure) !~* 'current_date|now\(\)::date');
  return v_log;
end;
$s$;

-- ============================================================================
-- Section Q — ต้องไม่พัง (design §10.2 · ข้อ 17 "ยิงของใหม่ใส่ของเก่า"): golden เทียบฉบับเดิมบน DB สด (core รับ/ส่ง + resolve) · ใบเดิมบน prod · ใบที่ไม่แบ่งเดินครบวงจร
-- ============================================================================
create function pg_temp.g_recv(p_leg boolean, p_job uuid, p_seq int, p_w numeric, p_worker uuid, p_name text, p_chan text, p_scope boolean) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  begin
    if p_leg then
      r := pg_temp.core_recv_legacy(p_job, p_seq, analytics.job_today(), p_w, p_worker, p_name, p_chan, pg_temp.act(), null, p_scope);
    else
      r := analytics.job_core_receive(p_job, p_seq, analytics.job_today(), p_w, p_worker, p_name, p_chan, pg_temp.act(), null, p_scope);
    end if;
  exception when others then
    r := jsonb_build_object('_err', sqlerrm, '_state', sqlstate);
  end;
  return r - 'job_no';
end $c$;
create function pg_temp.g_send(p_leg boolean, p_job uuid, p_seq int, p_w numeric, p_scrap int, p_reason text, p_added numeric, p_note text, p_sw numeric, p_worker uuid, p_chan text, p_enforce boolean) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  begin
    if p_leg then
      r := pg_temp.core_send_legacy(p_job, p_seq, analytics.job_today(), p_w, p_scrap, p_reason, p_added, p_note, p_sw, p_worker, p_chan, pg_temp.act(), null, p_enforce);
    else
      r := analytics.job_core_send(p_job, p_seq, analytics.job_today(), p_w, p_scrap, p_reason, p_added, p_note, p_sw, p_worker, p_chan, pg_temp.act(), null, p_enforce);
    end if;
  exception when others then
    r := jsonb_build_object('_err', sqlerrm, '_state', sqlstate);
  end;
  return r - 'job_no';
end $c$;

-- ลำดับคำสั่งชุดเดียวกัน รันด้วยฉบับเดิม (p_leg) หรือฉบับใหม่ — ผลของทุกคำสั่ง (ทั้งสำเร็จ/ปฏิเสธ) ต้องเท่ากันเป๊ะ
create function pg_temp.g_run(p_job uuid, p_leg boolean, p_worker uuid, p_gold boolean) returns jsonb
 language plpgsql as $c$
declare
  v jsonb := '[]'::jsonb;
  s int; w numeric := 9.9;
begin
  v := v || jsonb_build_array(pg_temp.g_recv(p_leg, p_job, 1, null, null, 'verify', 'job_page', false));
  v := v || jsonb_build_array(pg_temp.g_recv(p_leg, p_job, 1, null, null, 'verify', 'job_page', false));
  v := v || jsonb_build_array(pg_temp.g_recv(p_leg, p_job, 3, null, null, 'verify', 'job_page', false));
  v := v || jsonb_build_array(pg_temp.g_send(p_leg, p_job, 1, null, 2, null, 0, null, null, null, 'job_page', false));
  v := v || jsonb_build_array(pg_temp.g_send(p_leg, p_job, 1, null, 99, 'porosity', 0, null, null, null, 'job_page', false));
  v := v || jsonb_build_array(pg_temp.g_send(p_leg, p_job, 1, null, 2, 'porosity', 0, null, null, null, 'job_page', false));
  v := v || jsonb_build_array(pg_temp.g_send(p_leg, p_job, 1, null, 0, null, 0, null, null, null, 'job_page', false));
  for s in 2 .. 3 loop
    v := v || jsonb_build_array(pg_temp.g_recv(p_leg, p_job, s, null, null, 'verify', 'job_page', false));
    v := v || jsonb_build_array(pg_temp.g_send(p_leg, p_job, s, null, 0, null, 0, null, null, null, 'job_page', false));
  end loop;
  -- ขั้น 4 cast (ชั่ง): ไม่ใส่น้ำหนัก · น้ำหนักผิด · ผ่าน · ออกเกินเข้า · ออกปกติ + เสีย + เศษ (ออฟฟิศ) · ช่างอื่นส่ง
  v := v || jsonb_build_array(pg_temp.g_recv(p_leg, p_job, 4, null, null, 'verify', 'job_page', false));
  v := v || jsonb_build_array(pg_temp.g_recv(p_leg, p_job, 4, 0, null, 'verify', 'job_page', false));
  v := v || jsonb_build_array(pg_temp.g_recv(p_leg, p_job, 4, w, p_worker, null, 'worker_qr', true));
  v := v || jsonb_build_array(pg_temp.g_send(p_leg, p_job, 4, 10.5, 0, null, 0, null, null, p_worker, 'worker_qr', true));
  v := v || jsonb_build_array(pg_temp.g_send(p_leg, p_job, 4, null, 0, null, 0, null, null, p_worker, 'worker_qr', true));
  v := v || jsonb_build_array(pg_temp.g_send(p_leg, p_job, 4, 9.0, 1, 'missing', 0, null, 0.5, p_worker, 'worker_qr', true));
  v := v || jsonb_build_array(pg_temp.g_send(p_leg, p_job, 4, 9.0, 1, 'missing', 0, null, 0.5, null, 'job_page', false));
  -- ขั้น 5: ส่วนต่างน้ำหนักรับ-ส่ง (ทอง: 0.2 = ปฏิเสธ · 0.04 = ผ่าน · เงิน: ผ่านและเก็บ gap) · เติมโลหะต้องมีหมายเหตุ
  v := v || jsonb_build_array(pg_temp.g_recv(p_leg, p_job, 5, case when p_gold then 9.2 else 8.8 end, p_worker, null, 'worker_qr', true));
  v := v || jsonb_build_array(pg_temp.g_recv(p_leg, p_job, 5, 9.04, p_worker, null, 'worker_qr', true));
  v := v || jsonb_build_array(pg_temp.g_send(p_leg, p_job, 5, 9.04, 0, null, 0.5, null, null, p_worker, 'worker_qr', true));
  v := v || jsonb_build_array(pg_temp.g_send(p_leg, p_job, 5, 9.3, 0, null, 0.5, 'เติมทดสอบ', null, p_worker, 'worker_qr', true));
  for s in 6 .. 8 loop
    v := v || jsonb_build_array(pg_temp.g_recv(p_leg, p_job, s, case when p_gold then 9.3 else null end, p_worker, null, 'worker_qr', true));
    v := v || jsonb_build_array(pg_temp.g_send(p_leg, p_job, s, case when p_gold then 9.3 else null end, 0, null, 0, null, null, p_worker, 'worker_qr', true));
  end loop;
  return v;
end $c$;

create function pg_temp.g_state(p_job uuid) returns jsonb language sql as $c$
  select jsonb_build_object(
    'stages', (select jsonb_agg(analytics.job_stage_state(s) order by s.seq) from analytics.job_stage s where s.job_id = p_job),
    'events', (select jsonb_object_agg(event_type, n) from (select event_type, count(*) n from analytics.job_event where job_id = p_job group by event_type) e),
    'job', (select jsonb_build_object('status', status, 'current', current_stage_code, 'weight_start_g', weight_start_g) from analytics.job where id = p_job)) $c$;

create function pg_temp.sq(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; pw uuid; pg_ uuid; wA uuid; wB uuid;
  d jsonb; j uuid; ja uuid; jb uuid; th text; sa text; sb text;
  r jsonb; r2 jsonb; r3 jsonb;
  ra jsonb; rb jsonb; sta jsonb; stb jsonb;
  v_n int; v_bad int; v_job record; v_tok text; v_ses text; v_leg jsonb; v_new jsonb;
  v_mm int := 0; v_cnt int := 0; i int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  pw := pg_temp.mkprof(p_shop, 'vfy-ชั่งหล่อ+ตัดต้น');
  pg_ := pg_temp.pid(p_shop, 'gold');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  wB := pg_temp.wid(p_shop, 'vfy-ช่าง B', '7351');

  -- Q1 ใบเดิมทั้งหมดบน DB: ไม่มีส่วน/แยก · ใบแม่ส่วนเดียว · บอร์ดครบทุกแถว + คอลัมน์ใหม่ค่าว่าง/0 · ไม่ drift
  select count(*) into v_n from analytics.job;
  select count(*) into v_bad from analytics.job where parent_job_id is not null or lot_seq <> 0 or qty_split_out <> 0 or cancel_scrap_qty is not null;
  v_log := v_log || pg_temp.chk('Q1a', format('ใบงานเดิมบน DB (%s ใบ): ไม่มีใบไหนมี parent/lot_seq/split_out/cancel_scrap · ขั้นเดิมไม่มี split_out/split_from', v_n),
    v_bad = 0 and not exists (select 1 from analytics.job_stage where qty_split_out <> 0 or split_from_stage_id is not null) and not exists (select 1 from analytics.job_discrepancy));
  select count(*) into v_bad from analytics.v_job_board b
   where b.parent_job_id is not null or b.lot_seq <> 0 or b.qty_pending_explanation <> 0
      or b.parts_count <> case when b.status = 'cancelled' then 0 else 1 end
      or b.dominant_stage_code is distinct from b.current_stage_code;
  v_log := v_log || pg_temp.chk('Q1b', 'v_job_board: แถวครบเท่าจำนวนใบ · ใบเดิมทุกแถว parent null · lot_seq 0 · ส่วนรอชี้แจง 0 · parts_count 1 (cancelled 0) · dominant_stage_code = current_stage_code',
    (select count(*) from analytics.v_job_board) = v_n and v_bad = 0);
  v_log := v_log || pg_temp.chk('Q1c', 'v_job_tree_drift ว่างบนข้อมูลเดิมทั้งหมด (สมการจำนวนของใบเดิมทุกใบตรงนิยามใหม่) · v_job_stage_from_events ไม่ drift ของขั้นที่เคยไม่ drift ก่อน 0181 (qty_split_out ไม่เปลี่ยน state ของขั้นเดิม)',
    (select count(*) from analytics.v_job_tree_drift) = 0);

  -- Q2 golden resolve: ผลของ job_worker_resolve ฉบับใหม่ (ตัด parts/my_actions) = ฉบับเดิมเป๊ะ ทุกสถานะ/ทุกผู้ดู บนใบจริงที่ยังเปิด + ใบสร้างใหม่หลายแบบ
  for v_job in select id from analytics.job where status in ('open', 'in_progress') order by created_at loop
    v_tok := (pg_temp.o_tissue(p_shop, v_job.id, false) ->> 'hash');
    if v_tok is null then continue; end if;
    v_ses := pg_temp.sess(v_tok, wA, '4829');
    v_leg := pg_temp.q(format('select pg_temp.resolve_legacy(%L, %L, %L)', v_tok, null, null));
    v_new := pg_temp.w_res(v_tok, null) - 'parts' - 'my_actions';
    v_cnt := v_cnt + 1; if v_leg is distinct from v_new then v_mm := v_mm + 1; end if;
    v_leg := pg_temp.q(format('select pg_temp.resolve_legacy(%L, %L, %L)', v_tok, v_ses, null));
    v_new := pg_temp.w_res(v_tok, v_ses) - 'parts' - 'my_actions';
    v_cnt := v_cnt + 1; if v_leg is distinct from v_new then v_mm := v_mm + 1; end if;
  end loop;
  v_log := v_log || pg_temp.chk('Q2a', format('golden resolve บนใบจริงที่ยังเปิด: %s คู่ (ก่อน PIN + หลัง PIN ของช่างที่ทำได้ทุกขั้น) ฉบับใหม่ (ตัด parts/my_actions) = ฉบับเดิม ไม่ต่างแม้ key เดียว', v_cnt), v_mm = 0);
  v_mm := 0; v_cnt := 0;
  foreach d in array array[
      pg_temp.fx(p_shop, p_tpl, pn, 10, 0), pg_temp.fx(p_shop, p_tpl, pn, 10, 3), pg_temp.fx(p_shop, p_tpl, pw, 10, 3, 'silver', 9.9),
      pg_temp.fx(p_shop, p_tpl, pg_, 10, 3, 'gold', 9.9), pg_temp.fx(p_shop, p_tpl, pn, 10, 8)] loop
    j := pg_temp.jid(d); th := d ->> 'tokh';
    sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
    for i in 1 .. 2 loop
      if i = 2 and (select status from analytics.job_stage where job_id = j and seq = 4) = 'pending' then
        perform pg_temp.wr(th, sa, 4, null, null, case when (select weigh_required from analytics.job_stage where job_id = j and seq = 4) then 9.9 end);
      end if;
      foreach v_ses in array array[null, sa, sb] loop
        v_leg := pg_temp.q(format('select pg_temp.resolve_legacy(%L, %L, %L)', th, v_ses, null));
        v_new := pg_temp.w_res(th, v_ses) - 'parts' - 'my_actions';
        v_cnt := v_cnt + 1; if v_leg is distinct from v_new then v_mm := v_mm + 1; end if;
      end loop;
    end loop;
  end loop;
  v_log := v_log || pg_temp.chk('Q2b', format('golden resolve บนใบใหม่ 5 แบบ (ยังไม่เริ่ม · กลางทาง · ชั่งเงิน · ทอง · ครบรอปิด) × ผู้ดู 3 × 2 สถานะ = %s คู่ เท่าฉบับเดิมเป๊ะ (รวม prev_weight_out_g ทอง = null)', v_cnt), v_mm = 0 and v_cnt = 30);

  -- Q3 golden core: คำสั่งชุดเดียวกัน (ปฏิเสธ + สำเร็จ ~30 คำสั่ง) บนใบแฝด 2 ใบ ใบหนึ่งผ่านฉบับเดิมของ job_core_receive/send อีกใบผ่านฉบับใหม่ · ผล + สถานะขั้น + จำนวน event เท่ากันทุกใบ
  for i in 1 .. 3 loop
    ja := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, case when i = 3 then 'gold' else 'silver' end, case i when 1 then pw when 2 then pn else pg_ end, null, 10));
    jb := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, case when i = 3 then 'gold' else 'silver' end, case i when 1 then pw when 2 then pn else pg_ end, null, 10));
    ra := pg_temp.g_run(ja, true, wA, i = 3);
    rb := pg_temp.g_run(jb, false, wA, i = 3);
    sta := pg_temp.g_state(ja); stb := pg_temp.g_state(jb);
    v_log := v_log || pg_temp.chk('Q3' || i, format('golden core %s: %s คำสั่ง · ผลของทุกคำสั่งเท่าฉบับเดิม · สถานะ 8 ขั้นเท่ากัน · จำนวน event แต่ละชนิดเท่ากัน · มีทั้งสำเร็จและปฏิเสธ',
        case i when 1 then 'เงินแบบชั่งหล่อ+ตัดต้น' when 2 then 'เงินแบบไม่ชั่ง' else 'ทองแบบ "ทอง"' end, jsonb_array_length(ra)),
      ra = rb and sta = stb and jsonb_array_length(ra) >= 25
      and exists (select 1 from jsonb_array_elements(ra) e where e ->> 'ok' = 'true') and exists (select 1 from jsonb_array_elements(ra) e where e ->> 'ok' = 'false'));
  end loop;

  -- Q4 ใบที่ไม่แบ่งเดินครบวงจรเหมือน J1: รับ → ส่งทั้งหมดทุกขั้น → job_done · ไม่มีส่วน · token ถูกเพิกถอน · production_order_done ไม่เกี่ยว (ฟังก์ชันไม่ถูกแตะ — ดู MY)
  d := pg_temp.fx(p_shop, p_tpl, pn, 12, 8);
  j := pg_temp.jid(d);
  r := pg_temp.o_done(p_shop, j, 11, 1);
  v_log := v_log || pg_temp.chk('Q4', 'ใบไม่แบ่ง: เดินครบ 8 ขั้นแล้วปิด ดี 11 + เสีย 1 = 12 → ok (นิยามเดิม split_out 0) · ไม่มีส่วน · token ถูกเพิกถอน · v_job_tree_summary 1 ส่วน sum_check จริง drift ว่าง',
    (r ->> 'ok') = 'true' and pg_temp.jv(j, 'status') = 'done' and pg_temp.nlots(j) = 0 and not exists (select 1 from analytics.job_token where job_id = j and revoked_at is null)
    and (select parts_count = 1 and sum_check from analytics.v_job_tree_summary where root_job_id = j) and pg_temp.dcount(j) = 0);
  return v_log;
end;
$s$;

-- ============================================================================
-- Section T — แก้ตาม security: H2 ทองชั่งตอนแบ่ง (มติ 19 ต.ค.) · H1 รับไม่ครบเทียบ/บันทึกน้ำหนัก · M1 รับไม่ครบขณะขั้นก่อนยังไม่ส่ง · M3 mismatch ทั้งต้นไม้
-- ============================================================================
create function pg_temp.ss(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; pw uuid; pg_ uuid; wA uuid; wB uuid;
  d jsonb; j uuid; th text; sa text; sb text;
  r jsonb; r2 jsonb; r3 jsonb; r4 jsonb; r5 jsonb; r6 jsonb;
  l1 uuid; ms uuid; dd uuid;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  pw := pg_temp.mkprof(p_shop, 'vfy-ชั่งหล่อ+ตัดต้น');
  pg_ := pg_temp.pid(p_shop, 'gold');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  wB := pg_temp.wid(p_shop, 'vfy-ช่าง B', '7351');

  -- ===== H2: ทอง + ขั้นชั่ง = ต้องส่งน้ำหนักส่วนที่แยกออก =====
  d := pg_temp.fx(p_shop, p_tpl, pg_, 50, 3, 'gold', 9.9);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4, null, null, 100);
  ms := pg_temp.sid(j, 4);
  r := pg_temp.ws(th, sa, 4, null, 10, 50);
  r2 := pg_temp.o_split(p_shop, j, 4, 10);
  v_log := v_log || pg_temp.chk('T21', 'ทองที่ขั้นชั่ง (cast): แยกโดยไม่ส่งน้ำหนักส่วนที่แยก = weight_move_required ทั้งช่างและออฟฟิศ · ข้อความไม่มีตัวเลข · ไม่สร้างส่วน · ขั้นไม่ขยับ',
    (r ->> 'code') = 'weight_move_required' and pg_temp.rej(r2, 'weight_move_required') and pg_temp.nodigit(r) and pg_temp.nlots(j) = 0
    and pg_temp.sv(j, 4, 'qty_split_out') = '0' and pg_temp.sv(j, 4, 'weight_split_out_g') = '0.000');
  r := pg_temp.ws(th, sa, 4, null, 10, 50, 0, null, null, null, null, null, 0);
  r2 := pg_temp.ws(th, sa, 4, null, 10, 50, 0, null, null, null, null, null, -1);
  r3 := pg_temp.ws(th, sa, 4, null, 10, 50, 0, null, null, null, null, null, 1.2345);
  r4 := pg_temp.ws(th, sa, 4, null, 10, 50, 0, null, null, null, null, null, 'NaN'::numeric);
  r5 := pg_temp.ws(th, sa, 4, null, 10, 50, 0, null, null, null, null, null, 100);
  r6 := pg_temp.o_split(p_shop, j, 4, 10, 0, null, null, 'Infinity'::numeric);
  v_log := v_log || pg_temp.chk('T22', 'น้ำหนักส่วนที่แยก 0 / −1 / 4 ทศนิยม / NaN / เท่าน้ำหนักที่ถือทั้งหมด (100 ไม่เหลือให้ผู้ถือ) / Infinity = ปฏิเสธ (weight_invalid · weight_move_over) · ไม่สร้างส่วน',
    (r ->> 'code') = 'weight_invalid' and (r2 ->> 'code') = 'weight_invalid' and (r3 ->> 'code') = 'weight_invalid' and (r4 ->> 'code') = 'weight_invalid'
    and (r5 ->> 'code') = 'weight_move_over' and pg_temp.rej(r6, 'weight_invalid') and pg_temp.nlots(j) = 0 and pg_temp.sv(j, 4, 'weight_split_out_g') = '0.000');
  r := pg_temp.ws(th, sa, 4, null, 10, 50, 0, null, null, null, null, null, 20);
  l1 := pg_temp.lot(r);
  v_log := v_log || pg_temp.chk('T23', 'ทองแยก 10 ชิ้น หนัก 20.000 g → ok · ขั้นแยกของส่วน weigh_required + weight_in = weight_out = 20 · ใบส่วน weigh_required · ขั้นแม่ weight_split_out_g 20 · event split มี weight_move_g · ต้นไม้ไม่ drift',
    (r ->> 'ok') = 'true' and pg_temp.sv(l1, 4, 'weigh_required') = 'true' and pg_temp.sv(l1, 4, 'weight_in_g') = '20.000' and pg_temp.sv(l1, 4, 'weight_out_g') = '20.000'
    and pg_temp.jv(l1, 'weigh_required') = 'true' and pg_temp.sv(j, 4, 'weight_split_out_g') = '20.000' and pg_temp.sv(j, 4, 'qty_split_out') = '10'
    and exists (select 1 from analytics.job_event where job_id = j and event_type = 'split' and (payload ->> 'weight_move_g')::numeric = 20)
    and pg_temp.dcount(j) = 0 and pg_temp.sdrift(j) = 0);
  v_log := v_log || pg_temp.chk('T24', 'UPDATE ตรง weight_split_out_g ของขั้นแม่ (20→5 · 20→0) โดยไม่มีส่วนรองรับ = ปฏิเสธ split_link · ค่าคงเดิม · ต้นไม้ไม่ drift',
    pg_temp.x(format('update analytics.job_stage set weight_split_out_g = 5 where id = %L', ms)) like 'ERR:22023:%'
    and pg_temp.x(format('update analytics.job_stage set weight_split_out_g = 0 where id = %L', ms)) like 'ERR:22023:%'
    and pg_temp.sv(j, 4, 'weight_split_out_g') = '20.000' and pg_temp.dcount(j) = 0);
  -- เลี่ยง guard (จำลองทางอื่นที่แก้ตรง) → ต้องถูกจับที่ v_job_tree_drift ('weight_link') และ job_tree_assert
  execute 'alter table analytics.job_stage disable trigger trg_job_stage_guard';
  update analytics.job_stage set weight_split_out_g = 5 where id = ms;
  execute 'alter table analytics.job_stage enable trigger trg_job_stage_guard';
  v_log := v_log || pg_temp.chk('T24b', 'แก้น้ำหนักที่แยกตรงโดยเลี่ยง guard (20→5) → v_job_tree_drift มี weight_link · job_tree_assert = tree_sum_mismatch (กระทบยอดน้ำหนักไม่ได้ = ถอยทั้งก้อน)',
    exists (select 1 from analytics.v_job_tree_drift where root_job_id = j and check_code = 'weight_link')
    and pg_temp.q(format('select analytics.job_tree_assert(%L)', j)) ->> '_hint' = 'tree_sum_mismatch');
  execute 'alter table analytics.job_stage disable trigger trg_job_stage_guard';
  update analytics.job_stage set weight_split_out_g = 20 where id = ms;
  execute 'alter table analytics.job_stage enable trigger trg_job_stage_guard';
  -- คนรับส่วนใหม่ชั่งเทียบ ±0.05 g เหมือนส่งต่อปกติ (ทอง): หนักกว่า 0.2 / เบากว่า 0.1 = handoff_mismatch · 20.04 = ผ่าน
  r := pg_temp.wr(th, sb, 5, l1, null, 20.2);
  r2 := pg_temp.wr(th, sb, 5, l1, null, 19.9);
  r3 := pg_temp.wr(th, sb, 5, l1, null, 20.04);
  v_log := v_log || pg_temp.chk('T25', 'ผู้รับส่วนที่แยก (ทอง): ชั่ง 20.2 (หนักกว่า 0.2) / 19.9 (เบากว่า 0.1) = handoff_mismatch ข้อความไม่มีตัวเลข · ชั่ง 20.04 (ต่าง 0.04) = ผ่าน',
    (r ->> 'code') = 'handoff_mismatch' and (r2 ->> 'code') = 'handoff_mismatch' and pg_temp.nodigit(r) and (r3 ->> 'ok') = 'true' and pg_temp.sv(l1, 5, 'status') = 'received');
  -- ผู้ถือส่งต่อส่วนที่เหลือ: น้ำหนักออกต้องไม่เกิน เข้า − ที่แยกไป (80) · loss ของขั้นที่แยกไม่ null
  r := pg_temp.ws(th, sa, 4, null, null, 40, 0, null, 90);
  r2 := pg_temp.ws(th, sa, 4, null, null, 40, 0, null, 79.9);
  v_log := v_log || pg_temp.chk('T26', 'ส่งส่วนที่เหลือ น้ำหนักออก 90 (เกิน 100 − 20) = weight_over · 79.9 = ok · loss ของขั้นแม่ = 100 − 79.9 − 20 = 0.1 (ไม่ null · ไม่ not_comparable) · ต้นไม้ไม่ drift',
    (r ->> 'code') = 'weight_over' and (r2 ->> 'ok') = 'true'
    and (select loss_g = 0.1 and not not_comparable from analytics.v_job_stage_loss where job_stage_id = ms)
    and pg_temp.dcount(j) = 0 and pg_temp.sdrift(j) = 0);
  -- ออฟฟิศแยกทอง (ต้องส่งน้ำหนัก) + ช่างยกเลิกส่วนคืนน้ำหนักให้ขั้นแม่
  d := pg_temp.fx(p_shop, p_tpl, pg_, 50, 3, 'gold', 9.9);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4, null, null, 100);
  r := pg_temp.o_split(p_shop, j, 4, 10, 0, null, null, 25);
  l1 := pg_temp.lot(r);
  v_log := v_log || pg_temp.chk('T27a', 'ออฟฟิศแยกทอง พร้อมน้ำหนัก 25 → ok · ขั้นแม่ weight_split_out_g 25 · ขั้นแยกของส่วน weight_out 25',
    (r ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'weight_split_out_g') = '25.000' and pg_temp.sv(l1, 4, 'weight_out_g') = '25.000' and pg_temp.dcount(j) = 0);
  r := pg_temp.o_lcancel(p_shop, l1, 'แยกผิด', 'return_to_parent');
  v_log := v_log || pg_temp.chk('T27b', 'ยกเลิกส่วนทอง (คืนชิ้น) → ขั้นแม่ split_out 0 และ weight_split_out_g กลับเป็น 0 · ไม่ drift · แยกใหม่ได้',
    (r ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'qty_split_out') = '0' and pg_temp.sv(j, 4, 'weight_split_out_g') = '0.000' and pg_temp.dcount(j) = 0
    and (pg_temp.o_split(p_shop, j, 4, 10, 0, null, null, 30) ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'weight_split_out_g') = '30.000');
  -- เงินไม่เปลี่ยน (นับจำนวนอย่างเดียว) · ทองที่ขั้นไม่ชั่งไม่ต้องชั่ง · ส่งน้ำหนักมาโดยไม่ควร = weight_unexpected
  d := pg_temp.fx(p_shop, p_tpl, pw, 30, 3, 'silver', 9.9);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4, null, null, 9.9);
  r := pg_temp.ws(th, sa, 4, null, 10, 30, 0, null, null, null, null, null, 5);
  r2 := pg_temp.ws(th, sa, 4, null, 10, 30);
  r3 := pg_temp.o_split(p_shop, j, 4, 5, 0, null, 20, 3);
  v_log := v_log || pg_temp.chk('T28a', 'เงิน (ขั้นชั่ง): แยกโดยส่งน้ำหนักมา = weight_unexpected (ทั้งช่างและออฟฟิศ) · แยกโดยไม่ชั่ง = ok (มติ ค1 คงเดิม) · weight_split_out_g = 0',
    (r ->> 'code') = 'weight_unexpected' and pg_temp.rej(r3, 'weight_unexpected') and (r2 ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'weight_split_out_g') = '0.000');
  d := pg_temp.fx(p_shop, p_tpl, pn, 30, 3, 'gold', null);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  r := pg_temp.ws(th, sa, 4, null, 10, 30, 0, null, null, null, null, null, 5);
  r2 := pg_temp.ws(th, sa, 4, null, 10, 30);
  v_log := v_log || pg_temp.chk('T28b', 'ทอง + แบบ "ไม่ชั่ง" (ขั้นไม่ต้องชั่ง): แยกโดยไม่ส่งน้ำหนัก = ok · ส่งน้ำหนักมา = weight_unexpected (ตามแบบการบันทึก)',
    (r ->> 'code') = 'weight_unexpected' and (r2 ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'weight_split_out_g') = '0.000');
  r := pg_temp.ws(th, sa, 4, null, null, 20, 0, null, null, null, null, null, 5);
  v_log := v_log || pg_temp.chk('T28c', 'ส่งต่อทั้งหมด (ไม่แยก) พร้อม p_weight_move_g = weight_unexpected (ไม่ปล่อยทิ้งเงียบ)', (r ->> 'code') = 'weight_unexpected' and pg_temp.sv(j, 4, 'status') = 'received');

  -- ===== H1: รับไม่ครบ — เทียบ + บันทึกน้ำหนักทุกครั้ง =====
  d := pg_temp.fx(p_shop, p_tpl, pg_, 10, 3, 'gold', 9.9);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4, null, null, 10);
  perform pg_temp.ws(th, sa, 4, null, null, 10, 0, null, 10);
  r := pg_temp.wr(th, sb, 5, null, 9, 9);
  dd := pg_temp.disc_of(j);
  v_log := v_log || pg_temp.chk('T11', 'ทองส่ง 10 ชิ้น 10.000 g → B รับ 9 ชิ้น 9.000 g = ok (เบากว่าตามจำนวน) · ส่วนต่างบันทึก weight_gap_g = −1.000 · loss view: handoff_gap_g null + handoff_gap_partial_g = −1 · บอร์ด handoff_gap_partial_g = 1',
    (r ->> 'ok') = 'true' and dd is not null and (select weight_gap_g = -1.000 from analytics.job_discrepancy where id = dd)
    and (select handoff_gap_g is null and handoff_gap_partial_g = -1 from analytics.v_job_stage_loss where job_stage_id = pg_temp.sid(j, 5))
    and (select handoff_gap_partial_g = 1 from analytics.v_job_board where id = j));
  v_log := v_log || pg_temp.chk('T15', 'N1: response ของช่างที่รับไม่ครบ (ทอง) ไม่มี key เกี่ยวกับ gap/น้ำหนักส่วนต่าง · resolve ของผู้ส่ง/ผู้รับไม่มี gap ในทุกระดับ',
    (r ->> 'handoff_gap_g') is null and not (r ? 'weight_gap_g') and not (r ? 'discrepancy_gap_g')
    and not exists (select 1 from unnest(pg_temp.keys_of(pg_temp.w_res(th, sa))) k where k ~* 'gap')
    and not exists (select 1 from unnest(pg_temp.keys_of(pg_temp.w_res(th, sb))) k where k ~* 'gap'));
  -- ผู้ส่งชี้แจงส่วนต่างทองที่มี weight_gap_g เองไม่ได้
  r := pg_temp.w_res(th, sa);
  r2 := pg_temp.wd(th, sa, dd, 'lost', 'missing');
  v_log := v_log || pg_temp.chk('T13', 'ผู้ส่ง (A) ชี้แจงส่วนต่างทองที่มีน้ำหนักเทียบ = office_required (ข้อความไม่มีตัวเลข) · แถวยัง open · resolve บอก explain office_only = true · ออฟฟิศชี้แจงได้ (ok)',
    (r2 ->> 'code') = 'office_required' and pg_temp.nodigit(r2) and pg_temp.d_status(dd) = 'open'
    and exists (select 1 from jsonb_array_elements(r -> 'my_actions') a where a ->> 'action' = 'explain' and (a ->> 'office_only') = 'true')
    and (pg_temp.o_dres(p_shop, dd, 'lost', 'missing') ->> 'ok') = 'true' and pg_temp.d_status(dd) = 'resolved');
  -- รับไม่ครบที่ "หนักกว่า" ที่ส่ง (ทอง) = ปฏิเสธ · ในเกณฑ์ ±0.05 = ผ่าน · รับครบหนักกว่า = ปฏิเสธเดิม
  d := pg_temp.fx(p_shop, p_tpl, pg_, 10, 3, 'gold', 9.9);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4, null, null, 10);
  perform pg_temp.ws(th, sa, 4, null, null, 10, 0, null, 10);
  r := pg_temp.wr(th, sb, 5, null, 9, 10.2);
  r2 := pg_temp.wr(th, sb, 5, null, 9, 11);
  r3 := pg_temp.wr(th, sb, 5, null, null, 10.2);
  v_log := v_log || pg_temp.chk('T12a', 'ทองรับ 9 จาก 10 แต่ชั่ง 10.2 / 11 (หนักกว่าที่ส่ง 10.0) = handoff_mismatch ข้อความไม่มีตัวเลข · ไม่มีส่วนต่าง · ขั้นยัง pending · รับครบแต่ชั่ง 10.2 = handoff_mismatch (ด่านเดิม)',
    (r ->> 'code') = 'handoff_mismatch' and (r2 ->> 'code') = 'handoff_mismatch' and (r3 ->> 'code') = 'handoff_mismatch' and pg_temp.nodigit(r)
    and not exists (select 1 from analytics.job_discrepancy where root_job_id = j) and pg_temp.sv(j, 5, 'status') = 'pending');
  r := pg_temp.wr(th, sb, 5, null, 9, 10.04);
  v_log := v_log || pg_temp.chk('T12b', 'ทองรับ 9 จาก 10 ชั่ง 10.04 (หนักกว่า 0.04 ในเกณฑ์) = ok · บันทึก weight_gap_g 0.040',
    (r ->> 'ok') = 'true' and (select weight_gap_g = 0.04 from analytics.job_discrepancy where root_job_id = j));
  -- เงิน (ขั้นชั่ง): รับไม่ครบไม่พัง ไม่บล็อกแม้หนักกว่า · บันทึก gap · ผู้ส่งชี้แจงเองได้
  d := pg_temp.fx(p_shop, p_tpl, pw, 10, 3, 'silver', 9.9);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4, null, null, 10);
  perform pg_temp.ws(th, sa, 4, null, null, 10, 0, null, 10);
  r := pg_temp.wr(th, sb, 5, null, 9, 10.5);
  dd := pg_temp.disc_of(j);
  r2 := pg_temp.w_res(th, sa);
  v_log := v_log || pg_temp.chk('T14', 'เงิน: รับ 9 จาก 10 ชั่ง 10.5 (หนักกว่า) = ok ไม่บล็อก · weight_gap_g = 0.500 บันทึก · ผู้ส่งชี้แจงเองได้ (office_only = false · scrap ok) · ต้นไม้ไม่ drift',
    (r ->> 'ok') = 'true' and (select weight_gap_g = 0.5 from analytics.job_discrepancy where id = dd)
    and exists (select 1 from jsonb_array_elements(r2 -> 'my_actions') a where a ->> 'action' = 'explain' and (a ->> 'office_only') = 'false')
    and (pg_temp.wd(th, sa, dd, 'scrap', 'porosity') ->> 'ok') = 'true' and pg_temp.dcount(j) = 0);

  -- ===== M1: รับไม่ครบขณะขั้นก่อนยังไม่ส่ง =====
  d := pg_temp.fx(p_shop, p_tpl, pn, 20, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4);
  r := pg_temp.wr(th, sb, 5, null, 15);
  r2 := pg_temp.o_recv2(p_shop, j, 5, 15, wB);
  v_log := v_log || pg_temp.chk('T31', 'รับไม่ครบ (15 จาก 20) ขณะผู้ถือขั้นก่อนยังไม่ส่ง = prev_not_sent (ไม่ปิดขั้นก่อนอัตโนมัติ · ไม่มีส่วนต่าง) ทั้งช่างและออฟฟิศ · ขั้นก่อนยัง received · ต้องไม่พัง: รับครบ (ไม่ระบุจำนวน) ปิดขั้นก่อนอัตโนมัติได้ตามเดิม',
    (r ->> 'code') = 'prev_not_sent' and pg_temp.rej(r2, 'prev_not_sent') and pg_temp.sv(j, 4, 'status') = 'received' and pg_temp.sv(j, 5, 'status') = 'pending'
    and not exists (select 1 from analytics.job_discrepancy where root_job_id = j)
    and (pg_temp.wr(th, sb, 5) ->> 'prev_auto_closed') = 'true');
  return v_log;
end;
$s$;

-- ============================================================================
-- Section T2 — M3: v_production_order_job_mismatch เทียบยอดดีทั้งต้นไม้ (ใบผลิตที่แบ่งส่วน)
-- ============================================================================
create function pg_temp.ss2(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  wA uuid; r jsonb; d jsonb; j uuid; th text; sa text; l1 uuid; v_poi uuid; v_hold int; v_good_tree int; v_x text; v_w numeric;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  select poi.id into v_poi from analytics.production_order_item poi join analytics.production_order po on po.id = poi.production_order_id
   where po.status = 'open' and poi.shop_id = p_shop and poi.qty_planned >= 3 and not exists (select 1 from analytics.job x where x.production_order_item_id = poi.id and x.status <> 'cancelled')
   order by po.created_at limit 1;
  if v_poi is null then
    v_log := v_log || E'[SKIP] T41  ไม่มีรายการใบผลิตที่ open (qty >= 3) และยังไม่มีใบงานให้ใช้ทดสอบ M3\n';
    return v_log;
  end if;
  r := pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L)', p_shop, v_poi, pg_temp.std(), pg_temp.act()));
  j := pg_temp.jid(r);
  th := pg_temp.newtok(p_shop, j); sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.rw(p_shop, j, 9.9, 3);
  v_w := case when pg_temp.sv(j, 4, 'weigh_required') = 'true' then 9.9 end;
  perform pg_temp.wr(th, sa, 4, null, null, v_w);
  v_hold := pg_temp.sv(j, 4, 'qty_in')::int;
  l1 := pg_temp.lot(pg_temp.ws(th, sa, 4, null, 1, v_hold));
  perform pg_temp.ws(th, sa, 4, null, null, v_hold - 1, 0, null, v_w);
  perform pg_temp.rw(p_shop, j, 9.9, 8);
  perform pg_temp.rw(p_shop, l1, 9.9, 8);
  perform pg_temp.o_done(p_shop, l1, 1, 0, 9.9);
  r := pg_temp.o_done(p_shop, j, v_hold - 1, 0, 9.9);
  v_good_tree := v_hold;
  v_x := pg_temp.x(format('update analytics.production_order_item set qty_done = %s where id = %L', v_good_tree, v_poi));
  if v_x <> 'OK' then
    v_log := v_log || format(E'[SKIP] T41  ตั้ง production_order_item.qty_done ตรงๆ ไม่ได้ในทรานแซกชันทดสอบ (%s) — M3 ครอบแบบ static เท่านั้น\n', left(v_x, 80));
    return v_log || pg_temp.chk('T41s', 'M3 (static): view v_production_order_job_mismatch รวมยอดดีของต้นไม้ (นิยามมี parent_job_id และ sum(t.qty_good))',
      pg_get_viewdef('analytics.v_production_order_job_mismatch'::regclass) like '%sum(t.qty_good)%' and pg_get_viewdef('analytics.v_production_order_job_mismatch'::regclass) like '%parent_job_id%');
  end if;
  v_log := v_log || pg_temp.chk('T41a', 'ใบผลิตที่แบ่งส่วน ปิดครบทั้งต้นไม้: qty_done ของรายการ = ยอดดีทั้งต้นไม้ (แม่ + ส่วน) → ไม่ถือเป็น mismatch (เดิมเทียบแม่ใบเดียว = mismatch ปลอม)',
    not exists (select 1 from analytics.v_production_order_job_mismatch where job_id = j));
  perform pg_temp.x(format('update analytics.production_order_item set qty_done = %s where id = %L', v_good_tree + 1, v_poi));
  v_log := v_log || pg_temp.chk('T41b', 'qty_done ต่างจากยอดดีทั้งต้นไม้ 1 ชิ้น = เป็น mismatch จริง และคอลัมน์ qty_good ของ view = ยอดดีทั้งต้นไม้ (ไม่ใช่ของแม่ใบเดียว)',
    (select qty_good = v_good_tree from analytics.v_production_order_job_mismatch where job_id = j));
  return v_log;
end;
$s$;

-- ============================================================================
-- Section U — security re-review: M-A board/loss ทั้งต้นไม้ · M-B excess + note · M-C น้ำหนักของเสียตอนยกเลิกส่วน · L-2 ล็อกเดาน้ำหนัก · L-3 สะสม/scrap_over · L-1 ผลรวม gap
-- ============================================================================
create function pg_temp.su(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pw uuid; pg_ uuid; pn uuid; wA uuid; wB uuid;
  d jsonb; j uuid; th text; sa text; sb text;
  r jsonb; r2 jsonb; r3 jsonb; r4 jsonb; r5 jsonb;
  l1 uuid; l2 uuid; l3 uuid; dd uuid; v_n int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pw := pg_temp.mkprof(p_shop, 'vfy-ชั่งหล่อ+ตัดต้น');
  pg_ := pg_temp.pid(p_shop, 'gold');
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  wB := pg_temp.wid(p_shop, 'vfy-ช่าง B', '7351');

  -- ===== U1 (M-A + L-1): ขั้นแรกของส่วนย่อยต้องมองเห็นได้ที่บอร์ดของใบแม่ (คอลัมน์ tree_*) =====
  d := pg_temp.fx(p_shop, p_tpl, pg_, 50, 3, 'gold', 9.9);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4, null, null, 100);
  l1 := pg_temp.lot(pg_temp.o_split(p_shop, j, 4, 10, 0, null, null, 20));
  l2 := pg_temp.lot(pg_temp.o_split(p_shop, j, 4, 10, 0, null, null, 20));
  -- ส่วนที่ 1: รับไม่ครบ 8 จาก 10 ที่ขั้นแรกของส่วน (ชั่ง 16 g)
  r := pg_temp.wr(th, sb, 5, l1, 8, 16);
  v_log := v_log || pg_temp.chk('U1a', 'รับไม่ครบที่ขั้นแรกของส่วนย่อย (ทอง 8 จาก 10 ชั่ง 16 จาก 20 g) → ok · บอร์ดของใบแม่: tree_handoff_gap_partial_g = 4 · handoff_gap_partial_g เดิม (นับเฉพาะใบตัวเอง) ยังเป็น null = มองไม่เห็น · v_job_tree_stage_loss ดึงแถวส่วนได้พร้อม root_job_id/lot_seq',
    (r ->> 'ok') = 'true'
    and coalesce((select tree_handoff_gap_partial_g = 4 and tree_handoff_gap_g is null and handoff_gap_partial_g is null from analytics.v_job_board where id = j), false)
    and coalesce((select handoff_gap_partial_g = -4 and root_job_id = j and lot_seq = 1 from analytics.v_job_tree_stage_loss where job_stage_id = pg_temp.sid(l1, 5)), false));
  -- ส่วนที่ 2: ชั่งไม่ตรง (19.9 ต่าง 0.1) 1 ครั้ง แล้วชั่ง 19.96 (ต่าง 0.04) ผ่าน
  r := pg_temp.wr(th, sb, 5, l2, null, 19.9);
  r2 := pg_temp.wr(th, sb, 5, l2, null, 19.96);
  v_log := v_log || pg_temp.chk('U1b', 'ส่วนที่ 2 รับครบที่ขั้นแรก: ชั่ง 19.9 = handoff_mismatch (ข้อความไม่มีตัวเลข) · ชั่ง 19.96 = ok · บอร์ดใบแม่: tree_handoff_gap_g = 0.04 · tree_handoff_mismatch_count = 1 · handoff_gap_g / handoff_mismatch_count เดิมของใบแม่ = null / 0 (ความหมายเดิมไม่เปลี่ยน) · L-1: tree_lot_first_gap_sum_g = −0.04 (ยังไม่เกิน 0.05)',
    (r ->> 'code') = 'handoff_mismatch' and pg_temp.nodigit(r) and (r2 ->> 'ok') = 'true'
    and coalesce((select tree_handoff_gap_g = 0.04 and tree_handoff_mismatch_count = 1 and handoff_gap_g is null and handoff_mismatch_count = 0
                         and tree_lot_first_gap_sum_g = -0.04 from analytics.v_job_board where id = j), false));
  -- ส่วนที่ 3: ชั่ง 19.96 อีกใบ → ผลรวม gap ของขั้นแรกของทุกส่วนจากขั้นเดียวกัน = −0.08 (ต่อใบผ่านด่าน ±0.05 แต่รวมกันหายเกิน)
  l3 := pg_temp.lot(pg_temp.o_split(p_shop, j, 4, 10, 0, null, null, 20));
  r := pg_temp.wr(th, sb, 5, l3, null, 19.96);
  v_log := v_log || pg_temp.chk('U1c', 'L-1: ส่วนที่ 3 รับครบชั่ง 19.96 = ok (เดี่ยวๆ ผ่าน) · tree_lot_first_gap_sum_g = −0.08 (ผลรวมต่อขั้นต้นทาง ต่ำกว่า −0.05 = ให้ UI เตือน) · ต้นไม้ไม่ drift',
    (r ->> 'ok') = 'true'
    and coalesce((select tree_lot_first_gap_sum_g = -0.08 from analytics.v_job_board where id = j), false)
    and pg_temp.dcount(j) = 0 and pg_temp.sdrift(j) = 0);

  -- ===== U2 (M-B): snapshot น้ำหนัก/จำนวนที่ส่ง + excess + ต้องมีคำอธิบายเมื่อทองหายเกินสัดส่วน =====
  d := pg_temp.fx(p_shop, p_tpl, pg_, 10, 3, 'gold', 9.9);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4, null, null, 10);
  perform pg_temp.ws(th, sa, 4, null, null, 10, 0, null, 10);
  r := pg_temp.wr(th, sb, 5, null, 9, 8.5);
  dd := pg_temp.disc_of(j);
  v_log := v_log || pg_temp.chk('U2a', 'ทองส่ง 10 ชิ้น 10 g รับ 9 ชิ้น ชั่ง 8.5 → ok · ส่วนต่างเก็บ weight_sent_g = 10 · qty_sent = 10 · gap −1.5 · v_job_discrepancy.weight_gap_excess_g = −1.5 + 10×1/10 = −0.5 · บอร์ด tree_weight_gap_excess_g = −0.5 · N1: response ช่าง (ผู้รับ/ผู้ส่ง) ไม่มี key excess/weight_sent/qty_sent',
    (r ->> 'ok') = 'true' and dd is not null
    and coalesce((select weight_sent_g = 10 and qty_sent = 10 and weight_gap_g = -1.5 from analytics.job_discrepancy where id = dd), false)
    and coalesce((select weight_gap_excess_g = -0.5 and metal = 'gold' from analytics.v_job_discrepancy where discrepancy_id = dd), false)
    and coalesce((select tree_weight_gap_excess_g = -0.5 from analytics.v_job_board where id = j), false)
    and not (r ? 'weight_gap_excess_g') and not (r ? 'weight_sent_g')
    and not exists (select 1 from unnest(pg_temp.keys_of(pg_temp.w_res(th, sb)) || pg_temp.keys_of(pg_temp.w_res(th, sa))) k where k ~* 'excess|weight_sent|qty_sent'));
  r := pg_temp.o_dres(p_shop, dd, 'lost', 'missing');
  r2 := pg_temp.o_dres(p_shop, dd, 'scrap', 'other');
  r3 := pg_temp.o_dres(p_shop, dd, 'lost', '...');
  v_log := v_log || pg_temp.chk('U2b', 'ทอง excess −0.5 (< −0.05): ออฟฟิศชี้แจงด้วยรหัสเหตุผลล้วน (missing / other) = note_required · ข้อความไม่มีสัญลักษณ์ล้วน (...) = ปฏิเสธ · แถวยัง open · เขียนคำอธิบายเป็นข้อความ = ok',
    pg_temp.rej(r, 'note_required') and pg_temp.rej(r2, 'note_required') and (r3 ->> '_err') is not null and pg_temp.d_status(dd) = 'open'
    and (pg_temp.o_dres(p_shop, dd, 'lost', 'ชั่งซ้ำแล้ว ผงทองหายตอนตะไบ') ->> 'ok') = 'true' and pg_temp.d_status(dd) = 'resolved');
  -- ขอบเขต: excess −0.04 / −0.05 ไม่เกินเกณฑ์ = ใช้รหัสได้ (ต้องไม่พัง)
  d := pg_temp.fx(p_shop, p_tpl, pg_, 10, 3, 'gold', 9.9);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4, null, null, 10);
  perform pg_temp.ws(th, sa, 4, null, null, 10, 0, null, 10);
  perform pg_temp.wr(th, sb, 5, null, 9, 8.95);
  dd := pg_temp.disc_of(j);
  v_log := v_log || pg_temp.chk('U2c', 'ทอง excess = −0.05 พอดี (รับ 9 ชั่ง 8.95) ไม่ต่ำกว่าเกณฑ์ = ชี้แจงด้วยรหัส missing ได้ (ต้องไม่พัง) · ต้นไม้ไม่ drift',
    coalesce((select weight_gap_excess_g = -0.05 from analytics.v_job_discrepancy where discrepancy_id = dd), false)
    and (pg_temp.o_dres(p_shop, dd, 'lost', 'missing') ->> 'ok') = 'true' and pg_temp.dcount(j) = 0);
  -- เงิน: น้ำหนักหายเกินก็ใช้รหัสได้ (ด่านนี้เฉพาะทอง)
  d := pg_temp.fx(p_shop, p_tpl, pw, 10, 3, 'silver', 9.9);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4, null, null, 10);
  perform pg_temp.ws(th, sa, 4, null, null, 10, 0, null, 10);
  perform pg_temp.wr(th, sb, 5, null, 9, 8.5);
  dd := pg_temp.disc_of(j);
  v_log := v_log || pg_temp.chk('U2d', 'เงิน excess −0.5 → ออฟฟิศชี้แจงด้วยรหัส missing ได้ (note_required เฉพาะทอง) · ok',
    coalesce((select weight_gap_excess_g = -0.5 and metal = 'silver' from analytics.v_job_discrepancy where discrepancy_id = dd), false)
    and (pg_temp.o_dres(p_shop, dd, 'lost', 'missing') ->> 'ok') = 'true');

  -- ===== U3 (M-C): ยกเลิกส่วนทองเป็นของเสีย ต้องชั่งน้ำหนักของเสีย =====
  d := pg_temp.fx(p_shop, p_tpl, pg_, 50, 3, 'gold', 9.9);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4, null, null, 100);
  l1 := pg_temp.lot(pg_temp.o_split(p_shop, j, 4, 10, 0, null, null, 20));
  r := pg_temp.o_lcancel(p_shop, l1, 'ใช้ไม่ได้', 'scrap', 'broken');
  r2 := pg_temp.o_lcancel(p_shop, l1, 'ใช้ไม่ได้', 'scrap', 'broken', 0);
  r3 := pg_temp.o_lcancel(p_shop, l1, 'ใช้ไม่ได้', 'scrap', 'broken', 25);
  r4 := pg_temp.o_lcancel(p_shop, l1, 'ใช้ไม่ได้', 'return_to_parent', null, 5);
  r5 := pg_temp.o_lcancel(p_shop, l1, 'ใช้ไม่ได้', 'scrap', 'broken', 1.2345);
  v_log := v_log || pg_temp.chk('U3a', 'ส่วนทอง (มีขั้นชั่ง) ยกเลิกเป็นของเสีย: ไม่ใส่น้ำหนัก = scrap_weight_required · 0 = weight_invalid · 4 ทศนิยม = weight_invalid · 25 (เกิน 20 g ที่ส่วนนี้เคยมี) = weight_over · คืนชิ้นแต่ใส่น้ำหนัก = weight_unexpected · ส่วนยังไม่ถูกยกเลิก',
    pg_temp.rej(r, 'scrap_weight_required') and pg_temp.rej(r2, 'weight_invalid') and pg_temp.rej(r5, 'weight_invalid') and pg_temp.rej(r3, 'weight_over')
    and pg_temp.rej(r4, 'weight_unexpected') and pg_temp.jv(l1, 'status') <> 'cancelled' and pg_temp.jv(l1, 'cancel_scrap_weight_g') is null);
  r := pg_temp.o_lcancel(p_shop, l1, 'ใช้ไม่ได้', 'scrap', 'broken', 3.5);
  v_log := v_log || pg_temp.chk('U3b', 'ใส่น้ำหนักของเสีย 3.5 → ok · เก็บ cancel_scrap_weight_g = 3.500 · event split_cancel มี scrap_weight_g · v_job_tree / v_job_tree_stage_loss / v_job_tree_summary นับน้ำหนักนี้ · ต้นไม้ไม่ drift · sum_check จริง',
    (r ->> 'ok') = 'true' and pg_temp.jv(l1, 'cancel_scrap_weight_g') = '3.500'
    and exists (select 1 from analytics.job_event where job_id = l1 and event_type = 'split_cancel' and (payload ->> 'scrap_weight_g')::numeric = 3.5)
    and coalesce((select cancel_scrap_weight_g = 3.5 from analytics.v_job_tree where job_id = l1), false)
    and coalesce((select weight_scrap_cancel_g = 3.5 from analytics.v_job_tree_summary where root_job_id = j), false)
    and exists (select 1 from analytics.v_job_tree_stage_loss where root_job_id = j and job_id = l1 and cancel_scrap_weight_g = 3.5)
    and pg_temp.dcount(j) = 0 and pg_temp.sumok(j));
  -- เลี่ยง guard: ลบน้ำหนักที่เก็บไว้ทิ้งตรงๆ → ต้องถูกจับที่ drift 'cancel_weight'
  execute 'alter table analytics.job disable trigger trg_job_guard';
  update analytics.job set cancel_scrap_weight_g = null where id = l1;
  execute 'alter table analytics.job enable trigger trg_job_guard';
  v_log := v_log || pg_temp.chk('U3c', 'ส่วนทองที่ยกเลิกเป็นของเสียแต่ไม่มีน้ำหนัก (เลี่ยง guard) → v_job_tree_drift มี cancel_weight · job_tree_assert ถอยทั้งก้อน',
    exists (select 1 from analytics.v_job_tree_drift where root_job_id = j and check_code = 'cancel_weight')
    and pg_temp.q(format('select analytics.job_tree_assert(%L)', j)) ->> '_hint' is not null);
  execute 'alter table analytics.job disable trigger trg_job_guard';
  update analytics.job set cancel_scrap_weight_g = 3.5 where id = l1;
  execute 'alter table analytics.job enable trigger trg_job_guard';
  -- UPDATE ตรง (ผ่าน guard) เปลี่ยน/ลบน้ำหนักของส่วนที่ยกเลิกแล้ว = ปฏิเสธ
  v_log := v_log || pg_temp.chk('U3d', 'UPDATE ตรง cancel_scrap_weight_g ของส่วนที่ยกเลิกแล้ว (3.5→1 · 3.5→null) = ปฏิเสธ · ค่าคงเดิม · ต้นไม้ไม่ drift',
    pg_temp.x(format('update analytics.job set cancel_scrap_weight_g = 1 where id = %L', l1)) like 'ERR:%'
    and pg_temp.x(format('update analytics.job set cancel_scrap_weight_g = null where id = %L', l1)) like 'ERR:%'
    and pg_temp.jv(l1, 'cancel_scrap_weight_g') = '3.500' and pg_temp.dcount(j) = 0);
  -- ต้องไม่พัง: เงิน (ไม่ใช่ทอง) ยกเลิกเป็นของเสียไม่ต้องชั่ง / ใส่น้ำหนักมา = weight_unexpected · ทอง+แบบไม่ชั่ง ไม่ต้องชั่ง
  d := pg_temp.fx(p_shop, p_tpl, pw, 30, 3, 'silver', 9.9);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4, null, null, 9.9);
  l2 := pg_temp.lot(pg_temp.o_split(p_shop, j, 4, 10));
  r := pg_temp.o_lcancel(p_shop, l2, 'ใช้ไม่ได้', 'scrap', 'broken', 2);
  r2 := pg_temp.o_lcancel(p_shop, l2, 'ใช้ไม่ได้', 'scrap', 'broken');
  d := pg_temp.fx(p_shop, p_tpl, pn, 30, 3, 'gold', null);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  l3 := pg_temp.lot(pg_temp.o_split(p_shop, j, 4, 10));
  r3 := pg_temp.o_lcancel(p_shop, l3, 'ใช้ไม่ได้', 'scrap', 'broken');
  v_log := v_log || pg_temp.chk('U3e', 'ต้องไม่พัง: เงินยกเลิกเป็นของเสียโดยไม่ชั่ง = ok · เงินใส่น้ำหนักมา = weight_unexpected · ทอง+แบบ "ไม่ชั่ง" ยกเลิกเป็นของเสียโดยไม่ชั่ง = ok · ไม่เก็บน้ำหนัก (null)',
    pg_temp.rej(r, 'weight_unexpected') and (r2 ->> 'ok') = 'true' and pg_temp.jv(l2, 'cancel_scrap_weight_g') is null
    and (r3 ->> 'ok') = 'true' and pg_temp.jv(l3, 'cancel_scrap_weight_g') is null and pg_temp.dcount(j) = 0);

  -- ===== U4 (L-2): ทอง + ช่างรับไม่ครบผ่าน QR ชั่งไม่ผ่านครบ 3 ครั้ง = ล็อก ต้องให้ออฟฟิศรับ =====
  d := pg_temp.fx(p_shop, p_tpl, pg_, 10, 3, 'gold', 9.9);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4, null, null, 10);
  perform pg_temp.ws(th, sa, 4, null, null, 10, 0, null, 10);
  r := pg_temp.wr(th, sb, 5, null, 9, 10.2);
  r2 := pg_temp.wr(th, sb, 5, null, 9, 10.3);
  r3 := pg_temp.wr(th, sb, 5, null, 9, 10.4);
  r4 := pg_temp.wr(th, sb, 5, null, 9, 9);
  select count(*) into v_n from analytics.job_event e
   where e.job_stage_id = pg_temp.sid(j, 5) and e.event_type = 'weigh' and e.payload ->> 'kind' = 'handoff_mismatch' and e.payload ->> 'partial' = 'true';
  v_log := v_log || pg_temp.chk('U4a', 'ทอง รับไม่ครบ ชั่งหนักกว่าที่ส่ง 3 ครั้ง: ครั้งที่ 1-2 = handoff_mismatch · ครั้งที่ 3 = office_required (ข้อความไม่มีตัวเลข) · ครั้งที่ 4 ชั่งถูก (9 g) ก็ = office_required (ล็อก) · ขั้นยัง pending · ไม่มีส่วนต่าง · event mismatch บันทึก 3 รายการ',
    (r ->> 'code') = 'handoff_mismatch' and (r2 ->> 'code') = 'handoff_mismatch' and (r3 ->> 'code') = 'office_required' and pg_temp.nodigit(r3)
    and (r4 ->> 'code') = 'office_required' and pg_temp.sv(j, 5, 'status') = 'pending'
    and not exists (select 1 from analytics.job_discrepancy where root_job_id = j) and v_n = 3);
  r := pg_temp.o_recv3(p_shop, j, 5, 9, 9, wB);
  v_log := v_log || pg_temp.chk('U4b', 'ออฟฟิศรับแทนได้ (ปลดล็อก · ต้องไม่พัง): รับ 9 ชิ้น ชั่ง 9 g = ok · ขั้น received · ส่วนต่าง 1 ชิ้นรอชี้แจง · ต้นไม้ไม่ drift',
    (r ->> 'ok') = 'true' and pg_temp.sv(j, 5, 'status') = 'received' and pg_temp.dcount(j) = 0
    and exists (select 1 from analytics.job_discrepancy where root_job_id = j and status = 'open' and qty = 1));
  -- แคบ: ชั่งรับครบไม่ตรงกี่ครั้งก็ตอบ handoff_mismatch (ด่านเดิม ไม่ล็อกด้วยกติกานี้) · ผสมรับครบ 4 ครั้ง + รับไม่ครบไม่ตรง 2 ครั้ง ยังไม่ล็อก · แล้วรับไม่ครบชั่งถูก = ok
  d := pg_temp.fx(p_shop, p_tpl, pg_, 10, 3, 'gold', 9.9);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4, null, null, 10);
  perform pg_temp.ws(th, sa, 4, null, null, 10, 0, null, 10);
  r := pg_temp.wr(th, sb, 5, null, null, 10.2);
  r2 := pg_temp.wr(th, sb, 5, null, null, 10.3);
  r3 := pg_temp.wr(th, sb, 5, null, null, 10.4);
  r4 := pg_temp.wr(th, sb, 5, null, null, 9.4);
  r5 := pg_temp.wr(th, sb, 5, null, 9, 10.3);
  v_log := v_log || pg_temp.chk('U4c', 'แคบ: รับครบชั่งไม่ตรง 4 ครั้งยังเป็น handoff_mismatch ทุกครั้ง (ไม่ใช่ office_required) · รับไม่ครบชั่งไม่ตรง 1 ครั้งหลังจากนั้นก็ handoff_mismatch (นับเฉพาะรับไม่ครบ) · แล้วรับไม่ครบชั่งถูก (9) = ok',
    (r ->> 'code') = 'handoff_mismatch' and (r2 ->> 'code') = 'handoff_mismatch' and (r3 ->> 'code') = 'handoff_mismatch' and (r4 ->> 'code') = 'handoff_mismatch'
    and (r5 ->> 'code') = 'handoff_mismatch' and (pg_temp.wr(th, sb, 5, null, 9, 9) ->> 'ok') = 'true');

  -- ===== U5 (L-3): ทองแยกรอบ 2 เกินน้ำหนักสะสม · เศษเกินส่วนที่หายของขั้นที่แยกไปแล้ว =====
  d := pg_temp.fx(p_shop, p_tpl, pg_, 50, 3, 'gold', 9.9);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4, null, null, 100);
  r := pg_temp.ws(th, sa, 4, null, 10, 50, 0, null, null, null, null, null, 40);
  r2 := pg_temp.ws(th, sa, 4, null, 10, 40, 0, null, null, null, null, null, 60);
  v_n := pg_temp.nlots(j);
  r3 := pg_temp.o_split(p_shop, j, 4, 10, 0, null, null, 60);
  v_log := v_log || pg_temp.chk('U5a', 'ทองแยกรอบแรก 40 g ok · รอบสอง 60 g (สะสม 100 = เท่าที่ถือ ไม่เหลือให้ผู้ถือ) = weight_move_over (ไม่ใช่ error ดิบ 23514) ทั้งช่างและออฟฟิศ · ข้อความไม่ใช่เรื่อง "น้ำหนักออก/เติมโลหะ" และไม่มีตัวเลข · มีส่วนเดียว · ขั้นแม่ weight_split_out_g 40',
    (r ->> 'ok') = 'true' and (r2 ->> 'code') = 'weight_move_over' and pg_temp.rej(r3, 'weight_move_over') and r2 ->> 'message' !~ 'เติมโลหะ|น้ำหนักออก' and pg_temp.nodigit(r2)
    and v_n = 1 and pg_temp.nlots(j) = 1 and pg_temp.sv(j, 4, 'weight_split_out_g') = '40.000' and pg_temp.dcount(j) = 0);
  r := pg_temp.ws(th, sa, 4, null, 10, 40, 0, null, null, null, null, null, 59.95);
  v_log := v_log || pg_temp.chk('U5b', 'ต้องไม่พัง: รอบสอง 59.95 g (สะสม 99.95 < 100) = ok · weight_split_out_g 99.950 · ต้นไม้ไม่ drift',
    (r ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'weight_split_out_g') = '99.950' and pg_temp.dcount(j) = 0);
  -- scrap_over ต้องหักน้ำหนักที่แยกไปแล้ว: ถือ 100 แยกไป 40 ส่งส่วนที่เหลือออก 50 → เศษได้ไม่เกิน 100 − 50 − 40 = 10
  d := pg_temp.fx(p_shop, p_tpl, pw, 50, 3, 'gold', 9.9);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4, null, null, 100);
  perform pg_temp.ws(th, sa, 4, null, null, 50, 0, null, 100);
  perform pg_temp.wr(th, sb, 5, null, null, 100);
  perform pg_temp.ws(th, sb, 5, null, 10, 50, 0, null, null, null, null, null, 40);
  r := pg_temp.ws(th, sb, 5, null, null, 40, 0, null, 50, null, 15);
  r2 := pg_temp.ws(th, sb, 5, null, null, 40, 0, null, 50, null, 10);
  v_log := v_log || pg_temp.chk('U5c', 'ขั้นที่แยกส่วนไปแล้ว (40 g · ขั้นที่ถามเศษ): ส่งต่อน้ำหนักออก 50 เศษ 15 (> 100 − 50 − 40 = 10) = scrap_over · เศษ 10 = ok · loss ของขั้น = 0 (ไม่ติดลบ)',
    (r ->> 'code') = 'scrap_over' and (r2 ->> 'ok') = 'true'
    and coalesce((select loss_g = 0 from analytics.v_job_stage_loss where job_stage_id = pg_temp.sid(j, 5)), false) and pg_temp.dcount(j) = 0);
  return v_log;
end;
$s$;

-- ============================================================================
-- ตัวรัน section: แต่ละ section ล้มด้วย exception ไม่ทำให้ทั้งชุดตาย · ทุก section ถอยกลับ (raise) — ข้อมูลทดสอบไม่เหลือ
-- ============================================================================
create function pg_temp.run_sec(p_fn text, p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare v text; v_ctx text;
begin
  begin
    execute format('select pg_temp.%I(%L, %L)', p_fn, p_shop, p_tpl) into v;
    raise exception 'SEC_DONE';
  exception when others then
    if sqlerrm <> 'SEC_DONE' then
      get stacked diagnostics v_ctx = pg_exception_context;
      v := coalesce(v, '') || format(E'[FAIL] %s  section ล้มด้วย exception: %s\n   %s\n', p_fn, sqlerrm, left(v_ctx, 600));
    end if;
  end;
  return coalesce(v, '');
end;
$c$;

-- ============================================================================
-- ตัวรันหลัก: section ทั้งหมด → state ไม่ขยับ → mutant → คืนของเดิม → section ซ้ำ → state ไม่ขยับ
-- ============================================================================
-- label ของเคส -> section ที่รันเคสนั้น (mutant รันเฉพาะ section ที่ expect อยู่)
create function pg_temp.sec_of(p_label text) returns text language sql as $c$
  select case
    when p_label ~ '^A2[a-h]' then 'sa2'
    when p_label ~ '^A' then 'sa'
    when p_label ~ '^B' then 'sb'
    when p_label ~ '^C' then 'sc'
    when p_label ~ '^D' then 'sd'
    when p_label ~ '^E' then 'se'
    when p_label ~ '^G' then 'sg'
    when p_label ~ '^H' then 'sh'
    when p_label ~ '^I' then 'si'
    when p_label ~ '^J(7|8|9[b-e])' then 'sj2'
    when p_label ~ '^J' then 'sj'
    when p_label ~ '^K' then 'sk'
    when p_label ~ '^L' then 'sl'
    when p_label ~ '^M[0-9]' then 'sm'
    when p_label ~ '^N' then 'sn'
    when p_label ~ '^P' then 'sp'
    when p_label ~ '^U' then 'su'
    when p_label ~ '^T4' then 'ss2'
    when p_label ~ '^T' then 'ss'
    else 'sq' end $c$;
create function pg_temp.run_for(p_expect jsonb, p_shop uuid, p_tpl uuid) returns text language plpgsql as $c$
declare v text := ''; s text;
begin
  for s in select distinct pg_temp.sec_of(e) from jsonb_array_elements_text(p_expect) e order by 1 loop
    v := v || pg_temp.run_sec(s, p_shop, p_tpl);
  end loop;
  return v;
end;
$c$;
create function pg_temp.run_all(p_shop uuid, p_tpl uuid) returns text
 language sql as $c$
  select pg_temp.run_sec('sa', p_shop, p_tpl) || pg_temp.run_sec('sa2', p_shop, p_tpl) || pg_temp.run_sec('sb', p_shop, p_tpl) || pg_temp.run_sec('sc', p_shop, p_tpl)
      || pg_temp.run_sec('sd', p_shop, p_tpl) || pg_temp.run_sec('se', p_shop, p_tpl) || pg_temp.run_sec('sg', p_shop, p_tpl) || pg_temp.run_sec('sh', p_shop, p_tpl)
      || pg_temp.run_sec('si', p_shop, p_tpl) || pg_temp.run_sec('sj', p_shop, p_tpl) || pg_temp.run_sec('sj2', p_shop, p_tpl) || pg_temp.run_sec('sk', p_shop, p_tpl)
      || pg_temp.run_sec('sl', p_shop, p_tpl) || pg_temp.run_sec('sm', p_shop, p_tpl) || pg_temp.run_sec('sn', p_shop, p_tpl) || pg_temp.run_sec('sp', p_shop, p_tpl)
      || pg_temp.run_sec('sq', p_shop, p_tpl) || pg_temp.run_sec('ss', p_shop, p_tpl) || pg_temp.run_sec('ss2', p_shop, p_tpl) || pg_temp.run_sec('su', p_shop, p_tpl)
$c$;
create function pg_temp.snap_x() returns text language sql as $c$
  select pg_temp.snap() || (select count(*)::text || '/' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '') from analytics.job_discrepancy x) $c$;

do $v181$
declare
  v_shop uuid; v_tpl uuid;
  v_log text := ''; v_s text; v_fail int; v_snap0 text; v_d0 text;
  v_m record; v_killed int := 0; v_total int; v_survived text := ''; v_cnt int; v_id text; v_hit int; v_skip int; v_ok_cnt int;
  c_send constant text := 'analytics.job_core_send(uuid, int, date, numeric, int, text, numeric, text, numeric, uuid, text, uuid, text, boolean)';
  c_split constant text := 'analytics.job_lot_split(uuid, uuid, integer, integer, integer, text, integer, uuid, numeric)';
  v_mutants jsonb := jsonb_build_array(
    jsonb_build_object('id', 'MU-1', 'what', 'job_core_send: qty_out ไม่หักส่วนที่แยกออก (ผิดโซ่)', 'fn', 'job_core_send',
      'from', 'qty_out = qty_in - v_total - qty_split_out,', 'to', 'qty_out = qty_in - v_total,', 'expect', jsonb_build_array('A10', 'A11a', 'E3')),
    jsonb_build_object('id', 'MU-2', 'what', 'job_core_send: ผู้ถือ = เข้า (ไม่หักเสีย/แยกออก) — ของเสียเกินที่ถือผ่าน', 'fn', 'job_core_send',
      'from', 'v_hold := v_s.qty_in - v_s.qty_scrap - v_s.qty_split_out;', 'to', 'v_hold := v_s.qty_in;', 'expect', jsonb_build_array('E5')),
    jsonb_build_object('id', 'MU-3', 'what', 'job_core_receive: ปิดขั้นก่อนอัตโนมัติแม้แยกส่วนออกไปแล้ว', 'fn', 'job_core_receive',
      'from', 'if v_p.qty_split_out > 0 then', 'to', 'if false then', 'expect', jsonb_build_array('H1')),
    jsonb_build_object('id', 'MU-4', 'what', 'job_core_receive: รับมากกว่าที่ส่งผ่าน', 'fn', 'job_core_receive',
      'from', 'p_qty_received > v_base', 'to', 'p_qty_received > v_base + 1000000', 'expect', jsonb_build_array('I1')),
    jsonb_build_object('id', 'MU-5', 'what', 'job_core_receive: รับไม่ครบไม่สร้างส่วนต่าง (ของหายเงียบ)', 'fn', 'job_core_receive',
      'from', 'if v_qin < v_base then', 'to', 'if false then', 'expect', jsonb_build_array('J1')),
    jsonb_build_object('id', 'MU-6', 'what', 'job_lot_split_core: ถอดด่านน้ำหนักห้ามมากับการแยก (ค1)', 'fn', 'job_lot_split_core',
      'from', 'if p_weight_out is not null or coalesce(p_metal_added, 0) <> 0 or p_scrap_weight is not null or nullif(btrim(p_weight_note), '''') is not null then', 'to', 'if false then', 'expect', jsonb_build_array('D1')),
    jsonb_build_object('id', 'MU-7', 'what', 'job_lot_split_core: ถอด CAS จำนวนที่ถือ (กดซ้ำ/2 มือถือสร้างส่วนซ้ำ)', 'fn', 'job_lot_split_core',
      'from', 'if p_qty_hold is not null and p_qty_hold is distinct from v_hold then', 'to', 'if false then', 'expect', jsonb_build_array('B4b', 'B4c')),
    jsonb_build_object('id', 'MU-8', 'what', 'job_lot_split_core: แยกได้จนผู้ถือเหลือ 0', 'fn', 'job_lot_split_core',
      'from', 'or p_qty + v_scrap > v_hold - 1 then', 'to', 'or p_qty + v_scrap > v_hold then', 'expect', jsonb_build_array('B1b', 'B1c')),
    jsonb_build_object('id', 'MU-9', 'what', 'job_lot_split_core: ไม่ส่ง p_qty_hold ก็แยกได้ (ทุกช่องทาง — L4)', 'fn', 'job_lot_split_core',
      'from', 'if p_qty_hold is null then', 'to', 'if false then', 'expect', jsonb_build_array('B4a', 'B4d')),
    jsonb_build_object('id', 'MU-10', 'what', 'job_lot_split_core: ไม่ตรวจว่าเป็นผู้ถือ', 'fn', 'job_lot_split_core',
      'from', 'if p_enforce_holder and v_s.worker_id is distinct from p_worker_id then', 'to', 'if false then', 'expect', jsonb_build_array('C1')),
    jsonb_build_object('id', 'MU-11', 'what', 'job_stage_guard: ถอดการผูก qty_split_out กับส่วนที่ชี้ขั้น (แก้จำนวนตรงๆ ได้)', 'fn', 'job_stage_guard',
      'from', 'if new.qty_split_out <> v_link then', 'to', 'if false then', 'expect', jsonb_build_array('G4')),
    jsonb_build_object('id', 'MU-12', 'what', 'job_guard: ถอดการบังคับ job.qty_split_out = Σ ขั้น', 'fn', 'job_guard',
      'from', 'if new.qty_split_out is distinct from (select coalesce(sum(s.qty_split_out), 0) from analytics.job_stage s where s.job_id = new.id) then', 'to', 'if false then', 'expect', jsonb_build_array('G2')),
    jsonb_build_object('id', 'MU-13', 'what', 'job_guard: ปิดใบแม่ได้ทั้งที่ส่วนยังเปิด (ชั้น trigger)', 'fn', 'job_guard',
      'from', 'if new.parent_job_id is null and exists (select 1 from analytics.job c where c.parent_job_id = new.id and c.status not in (''done'', ''cancelled'')) then', 'to', 'if false then', 'expect', jsonb_build_array('L2')),
    jsonb_build_object('id', 'MU-14', 'what', 'job_stage_guard: ข้าม QC/แพ็กได้ทุกใบ', 'fn', 'job_stage_guard',
      'from', 'if new.stage_code in (''qc'', ''pack'')', 'to', 'if false and new.stage_code in (''qc'', ''pack'')', 'expect', jsonb_build_array('A2c')),
    jsonb_build_object('id', 'MU-15', 'what', 'job_token_issue: ใบที่แบ่งแล้วพิมพ์ traveler ค่าเริ่มเพิกถอนของเก่า', 'fn', 'job_token_issue',
      'from', 'p_purpose = ''traveler'' and not exists (select 1 from analytics.job l where l.parent_job_id = p_job_id and l.status <> ''cancelled''))', 'to', 'p_purpose = ''traveler'')', 'expect', jsonb_build_array('N3')),
    jsonb_build_object('id', 'MU-16', 'what', 'job_token_issue: เพดาน QR 5 → 50', 'fn', 'job_token_issue',
      'from', 'if v_active >= 5 then', 'to', 'if v_active >= 50 then', 'expect', jsonb_build_array('N7a', 'P8')),
    jsonb_build_object('id', 'MU-17', 'what', 'job_token_guard: INSERT token ให้ส่วนย่อยตรงๆ ได้', 'fn', 'job_token_guard',
      'from', 'if v_parent is not null then', 'to', 'if false then', 'expect', jsonb_build_array('G8')),
    jsonb_build_object('id', 'MU-18', 'what', 'job_discrepancy_guard: แก้แถวที่ชี้แจงแล้วได้ (ไม่ใช่ open→resolved ครั้งเดียว)', 'fn', 'job_discrepancy_guard',
      'from', 'if old.status <> ''open'' or new.status <> ''resolved'' then', 'to', 'if false then', 'expect', jsonb_build_array('J6')),
    jsonb_build_object('id', 'MU-19', 'what', 'job_worker_discrepancy_resolve: ใครก็ชี้แจงได้ (ไม่ตรวจผู้ส่ง/can_external)', 'fn', 'job_worker_discrepancy_resolve',
      'from', 'if v_fs.worker_id is distinct from v_wid and not coalesce(v_ext, false) then', 'to', 'if false then', 'expect', jsonb_build_array('J4', 'J7')),
    jsonb_build_object('id', 'MU-20', 'what', 'job_lot_cancel_core: ช่างยกเลิกส่วนที่คนอื่นแยกได้', 'fn', 'job_lot_cancel_core',
      'from', 'if v_who is distinct from p_worker_id or v_ms.worker_id is distinct from p_worker_id then', 'to', 'if false then', 'expect', jsonb_build_array('K1a')),
    jsonb_build_object('id', 'MU-21', 'what', 'job_lot_return_blocker: คืนชิ้นได้แม้ขั้นถัดไปถูกรับแล้ว', 'fn', 'job_lot_return_blocker',
      'from', 'if exists (select 1 from analytics.job_stage s where s.job_id = p_lot_job_id and s.id <> v_s2.id and s.status in (''received'', ''sent'')) then', 'to', 'if false then', 'expect', jsonb_build_array('K2a')),
    jsonb_build_object('id', 'MU-22', 'what', 'job_worker_resolve: เสนอ "รับ" ขั้นถัดไปของแม่ทั้งที่ผู้ถือยังค้างส่วนที่เหลือ', 'fn', 'job_worker_resolve',
      'from', 'or ph.qty_split_out > 0))', 'to', 'or false))', 'expect', jsonb_build_array('A8')),
    jsonb_build_object('id', 'MU-23', 'what', 'job_tree_assert: ไม่ raise เมื่อผลรวมไม่ตรง', 'fn', 'job_tree_assert',
      'from', 'if v_bad is not null then', 'to', 'if false then', 'expect', jsonb_build_array('M1', 'M2')),
    jsonb_build_object('id', 'MU-24', 'what', 'job_done: ไม่นับ qty_split_out ในสมการดี+เสีย', 'fn', 'job_done',
      'from', 'or p_qty_good + p_qty_scrap + v_job.qty_split_out <> v_job.qty_planned then', 'to', 'or p_qty_good + p_qty_scrap <> v_job.qty_planned then', 'expect', jsonb_build_array('A11c', 'L5')),
    jsonb_build_object('id', 'MU-25', 'what', 'job_done: ถอดด่านส่วนเปิด (ชั้น RPC — ข้อความต่างจากชั้น trigger)', 'fn', 'job_done',
      'from', 'if (v_job.parent_job_id is null and exists', 'to', 'if false and (v_job.parent_job_id is null and exists', 'expect', jsonb_build_array('A11b')),
    jsonb_build_object('id', 'MU-26', 'what', 'job_stage_reopen: ย้อนขั้นแม่ที่แยกส่วนออกได้ (ชั้น RPC)', 'fn', 'job_stage_reopen',
      'from', 'if v_s.qty_split_out > 0 or v_s.split_from_stage_id is not null', 'to', 'if v_s.qty_split_out > 1000000 or v_s.split_from_stage_id is not null', 'expect', jsonb_build_array('L6')),
    jsonb_build_object('id', 'MU-27', 'what', 'job_stage_guard: ย้อนขั้นที่แยกส่วนออกตรงๆ ได้ (ชั้น trigger)', 'fn', 'job_stage_guard',
      'from', 'if old.qty_split_out > 0 or old.split_from_stage_id is not null', 'to', 'if false and (old.qty_split_out > 0 or old.split_from_stage_id is not null)', 'expect', jsonb_build_array('L6')),
    jsonb_build_object('id', 'MU-28', 'what', 'ddl: job_lot_split ถูก grant ให้ authenticated', 'ddl',
      'grant execute on function ' || c_split || ' to authenticated', 'expect', jsonb_build_array('P2', 'P3')),
    jsonb_build_object('id', 'MU-29', 'what', 'ddl: job_core_send (ภายใน) ถูก grant ให้ service_role', 'ddl',
      'grant execute on function ' || c_send || ' to service_role', 'expect', jsonb_build_array('P2')),
    jsonb_build_object('id', 'MU-30', 'what', 'job_stage_sync: ไม่ sync job.qty_split_out', 'fn', 'job_stage_sync',
      'from', 'qty_split_out = v_split', 'to', 'qty_split_out = j.qty_split_out', 'expect', jsonb_build_array('A1', 'A4')),
    jsonb_build_object('id', 'MU-31', 'what', 'job_stage_guard: โซ่จำนวนไม่หักส่วนต่าง', 'fn', 'job_stage_guard',
      'from', 'v_exp_in := v_prev.qty_out - analytics.job_disc_active_qty(v_prev.id, new.id);', 'to', 'v_exp_in := v_prev.qty_out;', 'expect', jsonb_build_array('J1')),
    jsonb_build_object('id', 'MU-32', 'what', 'job_live_qty: ไม่หักส่วนที่แยกออกจากผู้ถือ', 'fn', 'job_live_qty',
      'from', 's.qty_in - s.qty_scrap - s.qty_split_out', 'to', 's.qty_in - s.qty_scrap', 'expect', jsonb_build_array('A7')),
    jsonb_build_object('id', 'MU-33', 'what', 'job_discrepancy_void: void ได้ขณะผู้รับยังรับอยู่', 'fn', 'job_discrepancy_void',
      'from', 'if v_to.status <> ''pending'' then', 'to', 'if false then', 'expect', jsonb_build_array('J8')),
    jsonb_build_object('id', 'MU-34', 'what', 'job_token_revoke: p_print_no ไม่มีผล (เพิกถอนทุกใบ)', 'fn', 'job_token_revoke',
      'from', 'and (p_print_no is null or print_no = p_print_no)', 'to', 'and true', 'expect', jsonb_build_array('N6a')),
    jsonb_build_object('id', 'MU-35', 'what', 'H1: รับไม่ครบที่ทองหนักกว่าที่ส่งผ่าน (ถอดด่าน gap > +0.05)', 'fn', 'job_core_receive',
      'from', 'or (v_qin < v_base and v_gap > 0.05)', 'to', 'or false', 'expect', jsonb_build_array('T12a')),
    jsonb_build_object('id', 'MU-36', 'what', 'M1: รับไม่ครบขณะขั้นก่อนยังไม่ส่ง ปิดขั้นก่อนอัตโนมัติ (โยนความผิดให้ผู้ส่ง)', 'fn', 'job_core_receive',
      'from', 'if v_p.id is not null and v_p.status = ''received'' and v_qin < v_base then', 'to', 'if false then', 'expect', jsonb_build_array('T31')),
    jsonb_build_object('id', 'MU-37', 'what', 'H1: ผู้ส่งชี้แจงส่วนต่างทองที่มีน้ำหนักเทียบเองได้ (ถอด office_required)', 'fn', 'job_worker_discrepancy_resolve',
      'from', 'if v_d.weight_gap_g is not null and exists', 'to', 'if false and exists', 'expect', jsonb_build_array('T13')),
    jsonb_build_object('id', 'MU-38', 'what', 'H2: ทองที่ขั้นชั่งแยกโดยไม่ชั่ง (ถือว่าไม่ใช่ทองชั่ง)', 'fn', 'job_lot_split_core',
      'from', 'v_gold_w := v_root.metal = ''gold'' and v_s.weigh_required;', 'to', 'v_gold_w := false;', 'expect', jsonb_build_array('T21', 'T23')),
    jsonb_build_object('id', 'MU-39', 'what', 'H1: ไม่บันทึก weight_gap_g ตอนรับไม่ครบ', 'fn', 'job_core_receive',
      'from', 'p_worker_id, p_actor, v_gap,' || chr(10) || '            case when v_gap is not null then v_p.weight_out_g end, case when v_gap is not null then v_p.qty_out end)',
      'to', 'p_worker_id, p_actor, null,' || chr(10) || '            null, null)', 'expect', jsonb_build_array('T11', 'T12b', 'T14')),
    jsonb_build_object('id', 'MU-40', 'what', 'H2: ส่งส่วนที่เหลือไม่หักน้ำหนักที่แยกไป (น้ำหนักออกเกินได้)', 'fn', 'job_core_send',
      'from', 'p_weight_out > v_s.weight_in_g + v_added - v_s.weight_split_out_g then', 'to', 'p_weight_out > v_s.weight_in_g + v_added then', 'expect', jsonb_build_array('T26')),
    jsonb_build_object('id', 'MU-41', 'what', 'H2: ยกเลิกส่วน (คืนชิ้น) ไม่คืนน้ำหนักที่แยกให้ขั้นแม่', 'fn', 'job_lot_cancel_core',
      'from', 'weight_split_out_g = weight_split_out_g - coalesce(v_s2.weight_out_g, 0)', 'to', 'weight_split_out_g = weight_split_out_g', 'expect', jsonb_build_array('T27b')),
    jsonb_build_object('id', 'MU-42', 'what', 'H2: ออฟฟิศแยกทองไม่ส่งน้ำหนักต่อไปยัง core', 'fn', 'job_lot_split',
      'from', 'null, null, null, null, p_weight_move_g,', 'to', 'null, null, null, null, null,', 'expect', jsonb_build_array('T27a')),
    jsonb_build_object('id', 'MU-43', 'what', 'H2: ส่วนที่แยกไม่เก็บน้ำหนักออกของขั้นแยก (ผู้รับเทียบไม่ได้)', 'fn', 'job_lot_split_core',
      'from', 'qty_out = p_qty, weight_out_g = case when v_gold_w then p_weight_move end', 'to', 'qty_out = p_qty, weight_out_g = case when v_gold_w then p_weight_move + 1 end', 'expect', jsonb_build_array('T23', 'T25')),
    jsonb_build_object('id', 'MU-44', 'what', 'H2: เงินที่ส่งน้ำหนักมากับการแยกผ่าน (ถอด weight_unexpected ของ weight_move)', 'fn', 'job_lot_split_core',
      'from', 'elsif p_weight_move is not null then', 'to', 'elsif false then', 'expect', jsonb_build_array('T28a', 'T28b')),
    jsonb_build_object('id', 'MU-45', 'what', 'L-2: ถอดการล็อกขั้นหลังชั่งไม่ตรง 3 ครั้ง (ครั้งที่ 4 ที่ชั่งถูกผ่านได้)', 'fn', 'job_core_receive',
      'from', 'if v_n_mm >= 3 then', 'to', 'if false then', 'expect', jsonb_build_array('U4a')),
    jsonb_build_object('id', 'MU-46', 'what', 'L-2: ครั้งที่ 3 ที่ชั่งไม่ตรงยังตอบ handoff_mismatch (ไล่เดาต่อได้อีกหนึ่งครั้ง)', 'fn', 'job_core_receive',
      'from', 'v_n_mm + 1 >= 3', 'to', 'v_n_mm + 1 >= 1000', 'expect', jsonb_build_array('U4a')),
    jsonb_build_object('id', 'MU-47', 'what', 'L-2: ล็อกใช้กับออฟฟิศด้วย (ออฟฟิศรับแทนไม่ได้)', 'fn', 'job_core_receive',
      'from', 'v_job.metal = ''gold'' and p_channel = ''worker_qr'' and v_qin < v_base and v_p.id is not null then', 'to', 'v_job.metal = ''gold'' and v_qin < v_base and v_p.id is not null then', 'expect', jsonb_build_array('U4b')),
    jsonb_build_object('id', 'MU-48', 'what', 'L-2: นับ mismatch ของการรับครบด้วย (ล็อกเกินขอบเขต)', 'fn', 'job_core_receive',
      'from', 'and e.payload->>''partial'' = ''true'';', 'to', ';', 'expect', jsonb_build_array('U4c')),
    jsonb_build_object('id', 'MU-49', 'what', 'M-B: snapshot น้ำหนักที่ส่งผิดค่า (excess เพี้ยน)', 'fn', 'job_core_receive',
      'from', 'then v_p.weight_out_g end, case', 'to', 'then v_p.weight_out_g + 1 end, case', 'expect', jsonb_build_array('U2a')),
    jsonb_build_object('id', 'MU-50', 'what', 'M-B: ออฟฟิศชี้แจงทองที่น้ำหนักหายเกินด้วยรหัสล้วนได้ (ถอดด่านต้องมีคำอธิบาย)', 'fn', 'job_discrepancy_resolve',
      'from', '< -0.05', 'to', '< -1000', 'expect', jsonb_build_array('U2b')),
    jsonb_build_object('id', 'MU-51', 'what', 'M-B: ด่านต้องมีคำอธิบายใช้กับเงินด้วย (เกินขอบเขต)', 'fn', 'job_discrepancy_resolve',
      'from', 'and v_job.metal = ''gold''', 'to', 'and true', 'expect', jsonb_build_array('U2d')),
    jsonb_build_object('id', 'MU-52', 'what', 'M-C: ยกเลิกส่วนเป็นของเสียไม่บังคับน้ำหนัก (ถอดด่านชั่ง)', 'fn', 'job_lot_cancel_core',
      'from', 'if v_wreq then', 'to', 'if false then', 'expect', jsonb_build_array('U3a')),
    jsonb_build_object('id', 'MU-53', 'what', 'M-C: บังคับน้ำหนักของเสียกับเงินด้วย (เกินขอบเขต)', 'fn', 'job_lot_cancel_core',
      'from', 'v_l.metal = ''gold''', 'to', 'true', 'expect', jsonb_build_array('U3e')),
    jsonb_build_object('id', 'MU-54', 'what', 'M-C: ไม่เก็บน้ำหนักของเสียลงใบ (กระทบยอดไม่ได้)', 'fn', 'job_lot_cancel_core',
      'from', 'cancel_scrap_weight_g = case when v_wreq then p_scrap_weight end', 'to', 'cancel_scrap_weight_g = null', 'expect', jsonb_build_array('U3b')),
    jsonb_build_object('id', 'MU-55', 'what', 'M-C: job_lot_cancel (ออฟฟิศ) ไม่ส่งน้ำหนักของเสียต่อไปยัง core', 'fn', 'job_lot_cancel',
      'from', 'p_scrap_reason, p_scrap_weight_g, null', 'to', 'p_scrap_reason, null, null', 'expect', jsonb_build_array('U3b')),
    jsonb_build_object('id', 'MU-56', 'what', 'M-C: ถอดเพดานน้ำหนักของเสีย (กรอกเกินน้ำหนักที่ส่วนเคยมีได้)', 'fn', 'job_lot_cancel_core',
      'from', 'p_scrap_weight > coalesce(v_wbasis, 0)', 'to', 'p_scrap_weight > coalesce(v_wbasis, 0) + 1000000', 'expect', jsonb_build_array('U3a')),
    jsonb_build_object('id', 'MU-57', 'what', 'L-3: แยกรอบสองไม่นับน้ำหนักที่แยกไปแล้ว (สะสมเกินผ่านด่านโค้ด)', 'fn', 'job_lot_split_core',
      'from', 'p_weight_move + v_s.weight_split_out_g >= v_s.weight_in_g + v_s.metal_added_g', 'to', 'p_weight_move >= v_s.weight_in_g + v_s.metal_added_g', 'expect', jsonb_build_array('U5a')),
    jsonb_build_object('id', 'MU-58', 'what', 'L-3: เพดานเศษไม่หักน้ำหนักที่แยกไปแล้ว (scrap_over หลวม)', 'fn', 'job_core_send',
      'from', 'v_s.weight_in_g + v_added - p_weight_out - v_s.weight_split_out_g end', 'to', 'v_s.weight_in_g + v_added - p_weight_out end', 'expect', jsonb_build_array('U5c')),
    jsonb_build_object('id', 'MU-59', 'what', 'รหัส weight_move_over ของการแยกกลับไปใช้ weight_over (ข้อความผิดบริบท)', 'fn', 'job_lot_split_core',
      'from', 'return analytics.job_fail(''weight_move_over''', 'to', 'return analytics.job_fail(''weight_over''', 'expect', jsonb_build_array('T22', 'U5a'))
  );
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select id into v_shop from public.shop order by created_at limit 1;
  select i.id into v_tpl from analytics.oem_quote_item i join analytics.oem_quote q on q.id = i.quote_id
   where i.shop_id = v_shop and i.input ->> 'metal' = 'silver' and q.quote_no not like 'V17%' order by q.created_at, i.seq limit 1;
  if v_tpl is null then
    v_log := v_log || '[FAIL] S0  ไม่มี oem_quote_item เงินจริงให้ใช้เป็นแม่แบบโคลน — ชุดทดสอบรันต่อไม่ได้' || E'\n';
    raise exception E'%', v_log;
  end if;

  create temp table _v181_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f';

  v_snap0 := pg_temp.snap_x(); v_d0 := pg_temp.snap_d();
  v_s := pg_temp.run_all(v_shop, v_tpl);
  v_log := v_log || v_s;
  v_log := v_log || pg_temp.chk('K0', 'หลังรัน: แถวตารางใบงาน/ช่าง/ตัวนับ/ส่วนต่าง/แบบการบันทึก + ตาราง OEM/ผลิต/สต็อก (นับ + md5) เท่าเดิมเป๊ะ — ทุก section ถอยกลับ (ตัวนับเลขใบงานไม่ขยับถาวร)', pg_temp.snap_x() = v_snap0);
  v_ok_cnt := (length(v_s) - length(replace(v_s, '[OK]', ''))) / 4;

  v_total := jsonb_array_length(v_mutants);
  for v_m in select value as m from jsonb_array_elements(v_mutants) loop
    v_id := v_m.m ->> 'id';
    v_s := '';
    begin
      if v_m.m ? 'ddl' then
        execute v_m.m ->> 'ddl';
      else
        perform pg_temp.mutate(v_m.m ->> 'fn', v_m.m ->> 'from', v_m.m ->> 'to');
      end if;
      v_s := pg_temp.run_for(v_m.m -> 'expect', v_shop, v_tpl);
      raise exception 'MUTANT_DONE';
    exception when others then
      if sqlerrm <> 'MUTANT_DONE' then
        v_log := v_log || format(E'[FAIL] %s  ใช้ mutant ไม่ได้: %s\n', v_id, sqlerrm);
        v_s := 'ERR';
      end if;
    end;
    v_hit := 0;
    for v_cnt in 0 .. jsonb_array_length(v_m.m -> 'expect') - 1 loop
      -- ถูกจับเมื่อเคสที่คาดไว้ล้ม — หรือ section ที่รันเคสนั้นล้มด้วย exception ทั้งก้อน (mutant ทำให้ระบบพังเสียงดัง ก็นับว่าเทสต์จับได้)
      if position('[FAIL] ' || (v_m.m -> 'expect' ->> v_cnt) || ' ' in v_s) > 0
         or position('[FAIL] ' || pg_temp.sec_of(v_m.m -> 'expect' ->> v_cnt) || '  section ล้ม' in v_s) > 0 then
        v_hit := v_hit + 1;
      end if;
    end loop;
    if v_hit >= 1 then
      v_killed := v_killed + 1;
      v_log := v_log || format(E'[OK] %s  mutant ถูกจับ (%s): ล้ม %s จาก %s\n', v_id, v_m.m ->> 'what', v_hit, v_m.m -> 'expect');
    else
      v_survived := v_survived || v_id || ' ';
      v_log := v_log || format(E'[FAIL] %s  mutant รอด (%s) — ไม่มี %s ล้มเลย\n', v_id, v_m.m ->> 'what', v_m.m -> 'expect');
    end if;
  end loop;
  v_log := v_log || pg_temp.chk('MX', format('mutant %s จุด ถูกจับ %s · รอด: %s', v_total, v_killed, coalesce(nullif(v_survived, ''), '(ไม่มี)')), v_killed = v_total);

  select count(*) into v_cnt from _v181_orig o where md5(pg_get_functiondef(to_regprocedure(o.sig))) = o.h;
  v_log := v_log || pg_temp.chk('MY', format('หลังรัน mutant: md5 definition ของฟังก์ชันทุกตัวในสคีมา analytics (%s ตัว รวม oem_*/production_*/stock_* ที่ 0181 ไม่แตะ) เท่าเดิม · trigger ใบงาน/ขั้น/token/ช่าง/ส่วนต่างเปิดครบ · grant ของ core ภายใน/RPC ไม่เปลี่ยน', (select count(*) from _v181_orig)),
    v_cnt = (select count(*) from _v181_orig)
    and not exists (select 1 from pg_trigger t where t.tgrelid in ('analytics.job'::regclass, 'analytics.job_stage'::regclass, 'analytics.job_event'::regclass, 'analytics.job_token'::regclass,
                                                                  'analytics.worker'::regclass, 'analytics.job_discrepancy'::regclass) and not t.tgisinternal and t.tgenabled not in ('O', 'A'))
    and not has_function_privilege('service_role', c_send, 'execute')
    and not has_function_privilege('authenticated', c_split, 'execute'));
  v_s := pg_temp.run_all(v_shop, v_tpl);
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_log := v_log || pg_temp.chk('MZ', 'หลังคืนของเดิม: ชุดเทสต์หลักรันซ้ำ FAIL ' || v_fail, v_fail = 0);
  if v_fail > 0 then
    v_log := v_log || (select string_agg('    (รันซ้ำ) ' || l, E'\n') from unnest(string_to_array(v_s, E'\n')) l where l like '[FAIL]%') || E'\n';
  end if;
  v_log := v_log || pg_temp.chk('K0c', 'state ไม่ขยับหลังรัน mutant ทั้งหมด' || coalesce((select ' ขยับ: ' || string_agg(split_part(a, '=', 1), ',') from unnest(string_to_array(v_d0, chr(10))) a
    where a <> '' and not (a = any (string_to_array(pg_temp.snap_d(), chr(10))))), ''), pg_temp.snap_x() = v_snap0);

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_skip := (length(v_log) - length(replace(v_log, '[SKIP]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป: [OK] ~%s (ก่อน mutant) · [FAIL] ทั้งไฟล์ = %s · [SKIP] = %s %s ===\n', v_ok_cnt, v_fail, v_skip, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception E'%', v_log;
end;
$v181$;

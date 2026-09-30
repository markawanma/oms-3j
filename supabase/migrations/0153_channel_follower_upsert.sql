-- 0153_channel_follower_upsert.sql
--
-- Why: 0146 สร้าง analytics.channel_follower_log ไว้แล้วแต่ตั้งใจไม่ทำ RPC
-- เขียนในรอบนั้น (0146's own comment ที่ตาราง: "ไม่มี RPC เขียนในรอบนี้ (0146),
-- เขียนผ่าน service_role/migration เท่านั้น จนกว่าจะมี write RPC (ไม่อยู่ใน
-- สโคป P1)") — งานนี้คือ P2 ที่เจ้าของต้องเริ่มจดเพื่อน LINE รายสัปดาห์เอง
-- ผ่านหน้าเว็บ (/tiktok/live-log) แทนที่จะพึ่งคนเขียน SQL มือทุกครั้ง จึงต้อง
-- เปิดช่องเขียนที่ปลอดภัยพอให้ end-user เรียกได้.
--
-- Additive only — ไม่แตะตาราง/RLS/index ที่ 0146 สร้างไว้แม้แต่บรรทัดเดียว
-- (ตารางมีอยู่แล้วครบ constraint ที่ต้องการ: channel ใน 4 ค่า,
-- follower_count >= 0, PK (shop_id, channel, as_of_date) — RPC นี้แค่เปิด
-- ทางเขียนที่ปลอดภัย ไม่ต้องแก้ schema).
--
-- Design decision — returns void ไม่ใช่ uuid: ต่างจาก live_session_upsert
-- (0121) ที่ตาราง live_session_log มีคอลัมน์ id uuid เป็น surrogate key ให้
-- return ได้ตรงๆ, channel_follower_log ไม่มีคอลัมน์ id เลย — primary key เป็น
-- composite (shop_id, channel, as_of_date) ซึ่ง caller รู้ค่าทั้งสามอยู่แล้ว
-- ตั้งแต่ก่อนเรียก (เป็น input เอง) ไม่มีอะไรใหม่ให้ RPC ต้องคืนกลับมา —
-- คืน uuid ปลอมๆ (เช่น gen_random_uuid() ทิ้งไม่ผูกกับอะไร) จะทำให้ caller
-- เข้าใจผิดว่าเป็น surrogate key ที่ใช้อ้างอิงแถวได้ ทั้งที่ไม่ใช่.
--
-- ============================================================================

drop function if exists analytics.channel_follower_upsert(uuid, text, date, int);

create or replace function analytics.channel_follower_upsert(
  p_shop_id uuid,
  p_channel text,
  p_as_of_date date,
  p_follower_count int
) returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
begin
  -- p_shop_id ต้องไม่ null ก่อนเรียก crm_require_owner_admin เอง (ฟังก์ชันนั้น
  -- ก็ raise ถ้า null แต่ raise ข้อความของตัวเองที่ไม่ได้ขึ้นต้นด้วยชื่อ RPC นี้
  -- — เช็คตรงนี้ก่อนให้ error message สม่ำเสมอกับพารามิเตอร์ตัวอื่น).
  if p_shop_id is null then
    raise exception 'channel_follower_upsert: ต้องระบุร้าน' using errcode = '22023';
  end if;

  -- ด่านสิทธิ์ก่อน validate อื่นเสมอ (3j-migration-traps: ลอกแพทเทิร์นจาก
  -- live_session_upsert 0121 — "ด่านสิทธิ์ก่อน validate อื่น กัน probe" —
  -- caller ที่ไม่มีสิทธิ์ต้องได้ 42501 ทันที ไม่ใช่ข้อความ validate ที่เผยว่า
  -- พารามิเตอร์ไหนผิดก่อนจะรู้ด้วยซ้ำว่ามีสิทธิ์เรียกไหม).
  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_channel is null or p_as_of_date is null or p_follower_count is null then
    raise exception 'channel_follower_upsert: ต้องระบุช่องทาง วันที่ และจำนวนผู้ติดตาม' using errcode = '22023';
  end if;

  -- ซ้ำกับ CHECK ของตาราง (channel_follower_log_channel_check) โดยตั้งใจ —
  -- error message อ่านรู้เรื่องกว่า constraint violation ดิบ (แพทเทิร์นเดียวกับ
  -- live_session_upsert เช็ค p_source ซ้ำกับ CHECK ของตัวเอง).
  if p_channel not in ('line_oa', 'tiktok', 'facebook', 'instagram') then
    raise exception 'channel_follower_upsert: ช่องทางไม่ถูกต้อง: %', p_channel using errcode = '22023';
  end if;

  -- p_follower_count เป็น int ไม่ใช่ numeric — 'NaN'::int พังตั้งแต่ cast ก่อน
  -- ถึงบรรทัดนี้แล้ว (3j-migration-traps ข้อ 4: NaN เป็นกับดักเฉพาะ numeric)
  -- เช็คแค่ >= 0 ก็พอ ไม่ต้องกัน NaN เพิ่ม.
  if p_follower_count < 0 then
    raise exception 'channel_follower_upsert: จำนวนผู้ติดตามต้องไม่ติดลบ' using errcode = '22023';
  end if;

  -- เขตเวลาไทย (3j-migration-traps ข้อ 6) — "วันนี้" ต้องเทียบกับวันทางธุรกิจ
  -- ของไทย ไม่ใช่ current_date (UTC) ซึ่งเหลื่อม 00:00-07:00 น. ไทย
  if p_as_of_date > (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'channel_follower_upsert: as_of_date (%) อยู่ในอนาคต — ยังบันทึกไม่ได้จนกว่าจะถึงวันนั้นจริง',
      p_as_of_date using errcode = '22023';
  end if;

  insert into analytics.channel_follower_log
    (shop_id, channel, as_of_date, follower_count, source, created_by, updated_by, updated_at)
  values
    (p_shop_id, p_channel, p_as_of_date, p_follower_count, 'manual', auth.uid(), auth.uid(), now())
  on conflict (shop_id, channel, as_of_date) do update set
    follower_count = excluded.follower_count,
    -- source เขียนเป็น 'manual' เสมอตามบรีฟ — ฟอร์มนี้คือกรอกมือ ไม่ใช่ทาง API
    -- แม้แถวเดิมจะเคยมาจาก source='api' (ยังไม่มี caller แบบนั้นจริงในระบบ
    -- วันนี้ แต่คอลัมน์เผื่อไว้แล้ว) — คนกรอกมือทับ ก็ถือว่าค่าล่าสุดเป็น
    -- manual ต่อจากนี้ ไม่ใช่ bug
    source = 'manual',
    updated_by = auth.uid(),  -- created_by ตั้งใจไม่แตะตอน update — เก็บคนสร้างแถวแรกไว้ (แพทเทิร์นเดียวกับ live_session_upsert)
    updated_at = now();
end;
$$;

-- Grant หายทุกครั้งหลัง create or replace (3j-migration-traps ข้อ 2) —
-- สคีมา analytics ปิด REST ให้ anon/authenticated ทั้งสคีมาตั้งแต่ 0123
-- (3j-migration-traps ข้อ 18) แอปเรียกผ่าน service_role (getServiceClient())
-- เท่านั้น ไม่มี caller ฝั่ง authenticated เลย — grant ให้ service_role ตัว
-- เดียวตาม convention ปัจจุบันของทุก migration หลัง 0147 (ห้ามลอก
-- `to authenticated, service_role` จากตัวอย่างเก่าก่อน 0123).
revoke execute on function analytics.channel_follower_upsert(uuid, text, date, int)
  from public, anon, authenticated;
grant execute on function analytics.channel_follower_upsert(uuid, text, date, int)
  to service_role;

notify pgrst, 'reload schema';

-- ============================================================================
-- DRY-RUN VERIFICATION BLOCK (3j-migration-traps ข้อ 11) — Tech Lead: copy
-- แต่ละ `do $$ ... $$;` ด้านล่างไปรันเป็นคำสั่งของตัวเอง แยกกัน หลังจาก
-- apply_migration ผ่านแล้ว. ทุกบล็อกจงใจ `raise exception` ปิดท้ายเพื่อบังคับ
-- rollback ทั้งก้อน — DB ไม่ควรขยับจริงหลังรันบล็อกเหล่านี้. ตรวจ
-- row count ของ analytics.channel_follower_log ก่อน/หลังถ้าไม่มั่นใจ.
-- ห้ามรันเป็นส่วนหนึ่งของ migration เอง.
-- ============================================================================

/*
-- ---------------------------------------------------------------------------
-- BLOCK 1 — (ก)(ข)(ค)(ง)(จ)(ฉ)(ช), รันเป็น service_role, self-rolls-back
-- ---------------------------------------------------------------------------
do $$
declare
  v_shop_id uuid;
  v_row analytics.channel_follower_log%rowtype;
  v_overloads int;
  v_raised boolean;
  v_msg text;
  v_before_count int;
  v_after_count int;
  v_log text := E'\n=== 0153 channel_follower_upsert dry-run (block 1) ===\n';
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  v_shop_id := 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7'::uuid;  -- shop 3J (ตัวเดียวกับที่ 0121 ใช้ทดสอบ)
  if v_shop_id is null then
    raise exception '0153 dry-run: ไม่มี public.shop ให้ทดสอบ — ตรวจ seed ก่อน';
  end if;

  select count(*) into v_before_count from analytics.channel_follower_log where shop_id = v_shop_id;

  -- (ก) insert ใหม่ — วันที่ในอดีต ห้ามชนแถวจริงที่มีอยู่
  begin
    perform analytics.channel_follower_upsert(v_shop_id, 'line_oa', '2020-01-05'::date, 4200);
    select * into v_row from analytics.channel_follower_log
      where shop_id = v_shop_id and channel = 'line_oa' and as_of_date = '2020-01-05';
    if v_row.follower_count = 4200 and v_row.source = 'manual' then
      v_log := v_log || 'T1 (insert ใหม่ follower_count=4200 source=manual): OK' || E'\n';
    else
      v_log := v_log || format('T1: FAIL follower_count=%s source=%s', v_row.follower_count, v_row.source) || E'\n';
    end if;
  exception when others then
    v_log := v_log || format('T1: FAIL ขึ้น error ไม่ควรพัง — %s', sqlerrm) || E'\n';
  end;

  -- (ข) upsert ซ้ำวันเดิม/ช่องเดิม ต้อง "อัปเดต" ไม่ใช่เพิ่มแถวใหม่
  begin
    perform analytics.channel_follower_upsert(v_shop_id, 'line_oa', '2020-01-05'::date, 4300);
    if (select count(*) from analytics.channel_follower_log
        where shop_id = v_shop_id and channel = 'line_oa' and as_of_date = '2020-01-05') = 1
       and (select follower_count from analytics.channel_follower_log
            where shop_id = v_shop_id and channel = 'line_oa' and as_of_date = '2020-01-05') = 4300 then
      v_log := v_log || 'T2 (upsert ซ้ำวันเดิม ทับเป็น 4300 ไม่เพิ่มแถว): OK' || E'\n';
    else
      v_log := v_log || 'T2: FAIL ค่าไม่ถูกทับ หรือมีแถวซ้ำ' || E'\n';
    end if;
  exception when others then
    v_log := v_log || format('T2: FAIL ขึ้น error ไม่ควรพัง — %s', sqlerrm) || E'\n';
  end;

  -- (ค) channel ไม่ถูกต้อง ต้อง raise ก่อนถึง insert/CHECK ของตาราง
  v_raised := false; v_msg := null;
  begin
    perform analytics.channel_follower_upsert(v_shop_id, 'youtube', '2020-01-06'::date, 100);
  exception when others then
    v_raised := true; v_msg := sqlerrm;
  end;
  if v_raised and v_msg ilike '%ช่องทางไม่ถูกต้อง%' then
    v_log := v_log || 'T3 (channel ผิด -> ข้อความไทย "ช่องทางไม่ถูกต้อง"): OK' || E'\n';
  else
    v_log := v_log || format('T3: FAIL raised=%s msg=%s', v_raised, coalesce(v_msg, 'null')) || E'\n';
  end if;

  -- (ง) follower_count ติดลบ ต้องถูกปฏิเสธด้วยข้อความไทย
  v_raised := false; v_msg := null;
  begin
    perform analytics.channel_follower_upsert(v_shop_id, 'line_oa', '2020-01-06'::date, -1);
  exception when others then
    v_raised := true; v_msg := sqlerrm;
  end;
  if v_raised and v_msg ilike '%ติดลบ%' then
    v_log := v_log || 'T4 (follower_count ติดลบ -> ถูกปฏิเสธ): OK' || E'\n';
  else
    v_log := v_log || format('T4: FAIL raised=%s msg=%s', v_raised, coalesce(v_msg, 'null')) || E'\n';
  end if;

  -- (จ) as_of_date อนาคต ต้องถูกปฏิเสธ (เขตเวลาไทย)
  v_raised := false; v_msg := null;
  begin
    perform analytics.channel_follower_upsert(
      v_shop_id, 'line_oa', ((now() at time zone 'Asia/Bangkok')::date + 1), 100);
  exception when others then
    v_raised := true; v_msg := sqlerrm;
  end;
  if v_raised and v_msg ilike '%อนาคต%' then
    v_log := v_log || 'T5 (as_of_date อนาคต -> ถูกปฏิเสธ): OK' || E'\n';
  else
    v_log := v_log || format('T5: FAIL raised=%s msg=%s', v_raised, coalesce(v_msg, 'null')) || E'\n';
  end if;

  -- (ฉ) as_of_date = วันนี้เป๊ะ (ไทย) ต้องผ่านได้ (ไม่ใช่ future, boundary test)
  begin
    perform analytics.channel_follower_upsert(
      v_shop_id, 'line_oa', (now() at time zone 'Asia/Bangkok')::date, 100);
    v_log := v_log || 'T6 (as_of_date = วันนี้เป๊ะ ผ่านได้): OK' || E'\n';
  exception when others then
    v_log := v_log || format('T6: FAIL ควรผ่านแต่ error — %s', sqlerrm) || E'\n';
  end;

  -- (ช) overload check — ต้องมี identity arguments แบบเดียวเท่านั้น
  select count(*) into v_overloads
  from pg_proc
  where pronamespace = 'analytics'::regnamespace and proname = 'channel_follower_upsert';
  if v_overloads = 1 then
    v_log := v_log || 'T7 (overload check = 1 ตัว): OK' || E'\n';
  else
    v_log := v_log || format('T7: FAIL เจอ %s overload', v_overloads) || E'\n';
  end if;

  select count(*) into v_after_count from analytics.channel_follower_log where shop_id = v_shop_id;
  v_log := v_log || format('แถวก่อน/หลัง block (ก่อน rollback): %s -> %s (คาดว่า +2: 2020-01-05, 2020-01-06 line_oa + วันนี้)',
    v_before_count, v_after_count) || E'\n';

  raise exception '%', v_log; -- บังคับ rollback ทั้งก้อน — DB ไม่ขยับจริง
end $$;

-- ---------------------------------------------------------------------------
-- BLOCK 2 — (ซ) permission test: non-owner/admin member ต้องได้ 42501
--
-- แยกจาก block 1 เพราะต้องสลับ role จริง (set local role authenticated) —
-- แพทเทิร์นเดียวกับ 0121's block 2 เป๊ะ ดูคอมเมนต์ที่นั่นสำหรับเหตุผลเต็ม.
-- ---------------------------------------------------------------------------
do $$
declare
  v_member record;
  v_shop_id uuid;
  v_raised boolean := false;
  v_code text;
  v_log text := E'\n=== 0153 dry-run (block 2 — permission, ซ) ===\n';
begin
  select sm.user_id, sm.shop_id into v_member
  from public.shop_member sm
  where sm.role not in ('owner', 'admin')
  limit 1;

  if v_member.user_id is null then
    raise exception '0153 dry-run block 2: ข้าม T8 — ไม่มี shop_member ที่ role ไม่ใช่ owner/admin '
      'ในข้อมูลจริงตอนนี้ (สถานะเดียวกับที่ 0121 block 2 เคยบันทึกไว้ 16 ก.ย. 69) '
      'ต้อง provision staff member ก่อน (scripts/provision-member.mjs) แล้วรันบล็อกนี้ใหม่';
  end if;

  v_shop_id := v_member.shop_id;

  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', v_member.user_id), true);
  set local role authenticated;

  begin
    perform analytics.channel_follower_upsert(v_shop_id, 'line_oa', '2020-01-07'::date, 100);
  exception when others then
    v_raised := true;
    get stacked diagnostics v_code = returned_sqlstate;
  end;

  reset role;

  if v_raised and v_code = '42501' then
    v_log := v_log || 'T8 (non-owner/admin ถูกปฏิเสธ 42501): OK' || E'\n';
  elsif v_raised then
    v_log := v_log || format('T8: FAIL raise จริงแต่ sqlstate=%s ไม่ใช่ 42501', v_code) || E'\n';
  else
    v_log := v_log || 'T8: FAIL ไม่ raise ทั้งที่ควรถูกปฏิเสธ (สิทธิ์หลุด!)' || E'\n';
  end if;

  raise exception '%', v_log; -- บังคับ rollback ทั้งก้อน — DB ไม่ขยับจริง
end $$;
*/

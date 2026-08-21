-- 0071_dashboard_meta_shop_scope.sql
-- Defense-in-depth จาก security review ของ 0070
--
-- CTE `staged_created_at` ใน 0070 กรองร้านฝั่งเดียว:
--
--     from analytics.stg_order_import soi
--     join analytics.fact_order fo on fo.id = soi.fact_order_id
--     where fo.shop_id = p_shop_id          -- <- ฝั่ง fact_order เท่านั้น
--
-- ตัว stg_order_import เองมีคอลัมน์ shop_id อยู่แล้ว (0011) แต่ไม่ได้ถูกใช้
-- และ FK เป็น fact_order_id เดี่ยวๆ ไม่ใช่ composite — **ไม่มีอะไรใน DB
-- บังคับว่า staging row กับ fact_order ที่มันชี้ต้องอยู่ร้านเดียวกัน**
--
-- แปลว่าถ้าวันหนึ่ง transform จับคู่ผิด (bug ตอน import, หรือตอนทำระบบ
-- ขายส่งที่จะมีร้าน/ช่องทางเพิ่ม) staging row ของร้าน B ที่ชี้ fact_order
-- ของร้าน A จะทำให้ data_through / last_order_at ของร้าน A ปนเวลาจากร้าน B
-- ผลคือป้าย "ข้อมูลอาจยังไม่ครบวัน" ตัดสินจากเวลาที่ไม่ใช่ของร้านตัวเอง
--
-- ที่รั่วเป็น timestamp ไม่ใช่ยอดเงิน จึงไม่ใช่เรื่องด่วน แต่ราคาแก้คือ
-- เงื่อนไขเดียว ถูกกว่ารอให้เกิดจริงมาก
--
-- เปลี่ยนแค่บรรทัดเดียวใน CTE เดียว — ที่เหลือคัดลอกจาก 0070 ทั้งดุ้น
-- (create or replace ต้องเขียนตัวฟังก์ชันใหม่ทั้งก้อน แก้เฉพาะจุดไม่ได้)
--
-- ยังเหลือเป็นหนี้: ควรมี migration แยกเติม unique (id, shop_id) บน
-- fact_order แล้วเปลี่ยน FK ของ stg_order_import เป็น composite
-- (fact_order_id, shop_id) เพื่อให้ DB บังคับเองแทนที่จะพึ่งวินัยของ query
-- ทุกตัวที่ join สองตารางนี้ — ผูกไว้กับงาน Auth A2 / ระบบขายส่ง

create or replace function analytics.tiktok_daily_dashboard(
  p_shop_id uuid,
  p_date date default null
)
 returns json
 language plpgsql
 stable
 security invoker
 set search_path = 'analytics', 'public', 'pg_temp'
as $$
declare
  v_date date;
  v_prev date;
begin
  v_date := coalesce(p_date, (select max(order_date) from analytics.fact_order where shop_id = p_shop_id));

  if v_date is null then
    return json_build_object(
      'date', null,
      'has_data', false,
      'kpis', json_build_object(
        'sales', json_build_object('value', 0, 'prev', 0),
        'orders', json_build_object('value', 0, 'prev', 0),
        'profit', json_build_object('value', 0, 'prev', 0, 'coverage_pct', 0),
        'aov', json_build_object('value', 0, 'prev', 0)
      ),
      'data_quality', json_build_object(
        'cost_coverage_pct', 0,
        'province_unknown_pct', 0,
        'address_pending_review_count', 0
      ),
      'breakdown', json_build_object(
        'channel', '[]'::json,
        'province', '[]'::json,
        'top_products', '[]'::json
      ),
      'meta', json_build_object(
        'data_through', null,
        'last_order_at', null,
        'min_order_date', null,
        'max_order_date', null
      )
    );
  end if;

  v_prev := v_date - 1;

  return (
    with today as (
      select * from analytics.fact_order where shop_id = p_shop_id and order_date = v_date
    ),
    prev as (
      select * from analytics.fact_order where shop_id = p_shop_id and order_date = v_prev
    ),
    kpi_today as (
      select
        coalesce(sum(revenue), 0) as sales,
        count(*) as orders,
        coalesce(sum(profit), 0) as profit,
        case when count(*) > 0 then round(sum(revenue) / count(*)) else 0 end as aov,
        case when count(*) > 0
          then round(100.0 * count(*) filter (where profit_status = 'actual') / count(*), 1)
          else 0
        end as cost_coverage_pct,
        case when count(*) > 0
          then round(100.0 * count(*) filter (where province_code = 'TH-XX' or province_code is null) / count(*), 1)
          else 0
        end as province_unknown_pct
      from today
    ),
    kpi_prev as (
      select
        coalesce(sum(revenue), 0) as sales,
        count(*) as orders,
        coalesce(sum(profit), 0) as profit,
        case when count(*) > 0 then round(sum(revenue) / count(*)) else 0 end as aov
      from prev
    ),
    channel as (
      select coalesce(json_agg(row_to_json(c) order by c.sales desc), '[]'::json) as j
      from (
        select
          label,
          sales,
          orders,
          case when total_sales > 0 then round(100.0 * sales / total_sales) else 0 end as share_pct
        from (
          select
            dch.name as label,
            sum(t.revenue) as sales,
            count(*) as orders,
            sum(sum(t.revenue)) over () as total_sales
          from today t
          join analytics.dim_channel dch on dch.id = t.channel_id
          group by dch.name
        ) g
      ) c
    ),
    province_ranked as (
      select
        coalesce(dg.province_name_th, 'ไม่ระบุ') as label,
        count(*) as orders,
        bool_or(t.province_code = 'TH-XX' or t.province_code is null or coalesce(dg.is_unknown, false)) as is_unknown
      from today t
      left join analytics.dim_geo dg on dg.province_code = t.province_code
      group by coalesce(dg.province_name_th, 'ไม่ระบุ')
    ),
    province as (
      select coalesce(json_agg(row_to_json(p)), '[]'::json) as j
      from (
        select label, orders, is_unknown
        from province_ranked
        order by orders desc
        limit 6
      ) p
    ),
    top_products as (
      select coalesce(json_agg(row_to_json(tp)), '[]'::json) as j
      from (
        select
          coalesce(fi.product_name_snapshot, fi.sku_snapshot, 'ไม่ระบุสินค้า') as label,
          sum(fi.qty) as qty
        from analytics.fact_order_item fi
        join today t on t.id = fi.fact_order_id
        group by coalesce(fi.product_name_snapshot, fi.sku_snapshot, 'ไม่ระบุสินค้า')
        order by sum(fi.qty) desc
        limit 5
      ) tp
    ),
    shop_date_range as (
      select min(order_date) as min_order_date, max(order_date) as max_order_date
      from analytics.fact_order
      where shop_id = p_shop_id
    ),
    staged_created_at as (
      select fo.order_date, soi.order_created_at
      from analytics.stg_order_import soi
      join analytics.fact_order fo on fo.id = soi.fact_order_id
      where fo.shop_id = p_shop_id
        and soi.shop_id = p_shop_id   -- 0071: กรองสองฝั่ง ไม่พึ่ง join ฝั่งเดียว
    ),
    meta_created_at as (
      select
        max(order_created_at) as data_through,
        max(order_created_at) filter (where order_date = v_date) as last_order_at
      from staged_created_at
    )
    select json_build_object(
      'date', to_char(v_date, 'YYYY-MM-DD'),
      'has_data', true,
      'kpis', json_build_object(
        'sales', json_build_object('value', kt.sales, 'prev', kp.sales),
        'orders', json_build_object('value', kt.orders, 'prev', kp.orders),
        'profit', json_build_object('value', kt.profit, 'prev', kp.profit, 'coverage_pct', kt.cost_coverage_pct),
        'aov', json_build_object('value', kt.aov, 'prev', kp.aov)
      ),
      'data_quality', json_build_object(
        'cost_coverage_pct', kt.cost_coverage_pct,
        'province_unknown_pct', kt.province_unknown_pct,
        'address_pending_review_count', 0
      ),
      'breakdown', json_build_object(
        'channel', (select j from channel),
        'province', (select j from province),
        'top_products', (select j from top_products)
      ),
      'meta', json_build_object(
        'data_through', mca.data_through,
        'last_order_at', mca.last_order_at,
        'min_order_date', to_char(sdr.min_order_date, 'YYYY-MM-DD'),
        'max_order_date', to_char(sdr.max_order_date, 'YYYY-MM-DD')
      )
    )
    from kpi_today kt, kpi_prev kp, shop_date_range sdr, meta_created_at mca
  );
end;
$$;

revoke execute on function analytics.tiktok_daily_dashboard(uuid, date) from public, anon, authenticated;
grant execute on function analytics.tiktok_daily_dashboard(uuid, date) to service_role;

notify pgrst, 'reload schema';

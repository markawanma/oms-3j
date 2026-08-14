# Phase Dashboard Charts — Technical Design (architect / Yoda)

ยกเครื่องหน้า /dashboard จาก card/text ล้วน → เพิ่ม 2 KPI + 6 กราฟเชิงลึก
ยึด pattern จริงในโปรเจกต์ (hand-rolled SVG, single-jsonb RPC, staff money-gate).

- หน้าเดิม: app/(dashboard)/dashboard/page.tsx, action lib/actions/dashboard.ts, RPC analytics.dashboard_summary (0039), types lib/dashboard/types.ts.
- Chart pattern อ้างอิง: components/domain/tiktok/SalesTrendChart.tsx, ChannelMixChart.tsx.
- RPC pattern อ้างอิง: 0043_crm_overview_summary.sql (language sql / stable / security invoker / CTE / single jsonb).
- Migration ล่าสุด = 0043 → ของงานนี้ = 0044.

---

## 0. Design overview + data flow

    page.tsx (server)
      - getDashboard(period)        -> dashboard_summary (0039, +2 KPI)   [เดิม]
      - getDashboardCharts(period)  -> dashboard_charts  (0044, ใหม่)     [Promise.all]
            p_include_money = role != staff   (gate เดียวกับ 0039)
       analytics.fact_order / fact_order_item / v_dim_product / dim_channel
       aggregate ใน SQL ทั้งหมด (ห้าม fetch loop, บทเรียน 1000-cap)
       jsonb { sales_trend[], top_sku[], product_mix[], new_returning{}, aov_by_channel[], weekday[], coverage{} }

Page เรียก 2 action ขนาน. KPI (รวม 2 ตัวใหม่) มาจาก dashboard_summary เพื่อคง KPI row เป็นหน่วยเดียว; กราฟ 6 อันมาจาก dashboard_charts.

---

## 1. RPC design — แยก RPC ใหม่ dashboard_charts (ไม่ยัดรวม 0039)

ตัดสิน: สร้าง analytics.dashboard_charts แยก + แก้ dashboard_summary แบบ additive เฉพาะ 2 KPI (customers, repeat_rate).

- ยัดกราฟเข้า dashboard_summary → ไม่: payload บวมทุก period toggle; 0039 เป็น plpgsql คนละก้อน; เสี่ยง regress หน้าเดิม.
- แยก charts รวม 2 KPI ไว้ใน charts → ไม่: KPI row ถูกแบ่ง 2 แหล่ง cohesion แตก.
- แยก charts + เติม 2 KPI เข้า summary → ใช่: KPI อยู่ที่เดียว (cost แค่ 2 บรรทัด); กราฟแยกก้อนโหลดขนานได้; 0039 แก้ additive เสี่ยงต่ำ.

dashboard_charts เป็น pure read aggregate → language sql, stable, security invoker (app เรียกผ่าน service-role client ที่ bypass RLS อยู่แล้ว เหมือน 0039/0043). ไม่ต้อง SECURITY DEFINER.

### 1a. Scope แต่ละ section (มติ #1 — ระบุ label ให้ผู้ใช้)

- KPI / New-vs-Returning / AOV-by-Channel / Top-SKU / Product-Mix : scope v_from..today ตาม period, ผูกปุ่ม, label "วันนี้/7 วัน/เดือนนี้".
- Sales Trend : 30 วันล่าสุดคงที่, ไม่ผูกปุ่ม, label "ยอดขาย 30 วันล่าสุด".
- Sales by Weekday : ทั้งหมด (all-time), ไม่ผูกปุ่ม, label "รูปแบบรายวันในสัปดาห์ · ทุกช่วงเวลา".

RPC รับ p_period ใช้เฉพาะ section ที่ตามปุ่ม; sales_trend/weekday คำนวณจากช่วงคงที่ของตัวเอง.

### 1b. jsonb shape (money = null เมื่อ staff)

    { "period":"month",
      "coverage":{"items_pct":0.86,"orders_total":1240,"orders_with_items":1067,"range_label":"ม.ค.-14 ส.ค."},
      "top_sku":[{"sku":"NC0041","name":"สร้อยเงิน","revenue":82000,"qty":41}],  (top 10)
      "product_mix":[{"bucket":"silver_bar","label":"เงินแท่ง","revenue":120000,"pct":0.55}, jewelry/art_toy/other...],
      "aov_by_channel":[{"channel_code":"tiktok","channel_name":"TikTok Shop","orders":210,"revenue":102000,"aov":485.71}],
      "new_returning":{"new":177,"returning":133,"unknown":12},
      "sales_trend":[{"date":"2026-07-16","revenue":8200,"orders":9,"aov":911.11}],  (30 แถว เติม 0)
      "weekday":[{"dow":1,"label":"จ.","orders":640,"revenue":402000}] }  (7 แถว dow 0..6)

staff: top_sku/product_mix/aov_by_channel = []; sales_trend.revenue/aov = null; weekday.revenue = null. count/coverage โชว์ staff ได้.

### 1c. SQL skeleton (aggregate ทั้งหมด — ไม่มี loop)

    create or replace function analytics.dashboard_charts(
      p_shop_id uuid, p_period text default 'month', p_include_money boolean default true
    ) returns jsonb
      language sql stable security invoker
      set search_path to 'analytics', 'public', 'pg_temp'
    as $$
      with bounds as (
        select case p_period when 'today' then current_date when '7d' then current_date-6
                             else date_trunc('month', current_date)::date end as p_from
      ),
      ord as (   -- ออเดอร์ในช่วง period + ธงมี line-item
        select v.id, v.customer_id, v.channel_id, v.order_date, v.revenue, v.is_new_customer,
               exists (select 1 from analytics.fact_order_item fi where fi.fact_order_id = v.id) as has_items
        from analytics.v_fact_order v, bounds b
        where v.shop_id = p_shop_id and v.order_date >= b.p_from
      ),
      itm as (   -- line-item ในช่วง + bucket + line revenue
        select fi.fact_order_id, fi.sku_snapshot, fi.qty, (fi.qty*fi.unit_price)::numeric(14,2) as line_rev,
               coalesce(dp.name, fi.product_name_snapshot, fi.sku_snapshot) as name,
               case when dp.category = 'เงินแท่ง' then 'silver_bar'
                    when dp.category ilike '%art%toy%' then 'art_toy'
                    when upper(coalesce(fi.sku_snapshot, dp.sku)) ~ '^(NC|BL|B|E|P|R)[0-9]' then 'jewelry'
                    else 'other' end as bucket
        from analytics.fact_order_item fi
        join ord o on o.id = fi.fact_order_id
        left join analytics.v_dim_product dp on dp.product_id = fi.product_id
      ),
      cov as ( select count(*) orders_total, count(*) filter (where has_items) orders_with_items from ord ),
      top_sku as (
        select coalesce(jsonb_agg(jsonb_build_object('sku',sku,'name',name,'revenue',revenue,'qty',qty) order by revenue desc),'[]') j
        from ( select sku_snapshot sku, max(name) name, sum(line_rev) revenue, sum(qty) qty
               from itm group by sku_snapshot order by sum(line_rev) desc limit 10 ) t
      ),
      mix as (
        select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket,'label',label,'revenue',revenue,
                 'pct', case when tot>0 then round(revenue/tot,4) else 0 end) order by revenue desc),'[]') j
        from ( select bucket,
                 case bucket when 'silver_bar' then 'เงินแท่ง' when 'jewelry' then 'เครื่องเงิน 925'
                             when 'art_toy' then 'Art Toy เงิน' else 'อื่นๆ' end label,
                 sum(line_rev) revenue, sum(sum(line_rev)) over () tot
               from itm group by bucket ) t
      ),
      aov_ch as (
        select coalesce(jsonb_agg(jsonb_build_object('channel_code',code,'channel_name',name,'orders',orders,
                 'revenue',revenue, 'aov', case when orders>0 then round(revenue/orders,2) else 0 end) order by revenue desc),'[]') j
        from ( select dch.code, dch.name, count(*) orders, coalesce(sum(o.revenue),0) revenue
               from ord o join analytics.dim_channel dch on dch.id = o.channel_id group by dch.code, dch.name ) t
      ),
      nr as (
        select jsonb_build_object('new', count(*) filter (where is_new_customer is true),
                 'returning', count(*) filter (where is_new_customer is false),
                 'unknown', count(*) filter (where is_new_customer is null)) j from ord
      ),
      trend as (   -- 30 วันคงที่ เติมวัน 0
        select coalesce(jsonb_agg(jsonb_build_object('date', to_char(d,'YYYY-MM-DD'),
                 'revenue', case when p_include_money then coalesce(r.revenue,0) end,
                 'orders', coalesce(r.orders,0),
                 'aov', case when p_include_money then case when coalesce(r.orders,0)>0 then round(r.revenue/r.orders,2) else 0 end end)
                 order by d),'[]') j
        from generate_series(current_date-29, current_date, interval '1 day') g(d)
        left join ( select order_date, sum(revenue) revenue, count(*) orders
                    from analytics.v_fact_order where shop_id=p_shop_id and order_date >= current_date-29
                    group by order_date ) r on r.order_date = g.d::date
      ),
      wk as (   -- all-time 7 dow เติมครบ
        select coalesce(jsonb_agg(jsonb_build_object('dow', dow,
                 'label', (array['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.'])[dow+1],
                 'orders', orders, 'revenue', case when p_include_money then revenue end) order by dow),'[]') j
        from ( select g.dow, coalesce(count(v.id),0) orders, coalesce(sum(v.revenue),0) revenue
               from generate_series(0,6) g(dow)
               left join analytics.v_fact_order v on v.shop_id=p_shop_id and extract(dow from v.order_date)::int = g.dow
               group by g.dow ) t
      )
      select jsonb_build_object(
        'period', p_period,
        'coverage', (select jsonb_build_object('orders_total',orders_total,'orders_with_items',orders_with_items,
                       'items_pct', case when orders_total>0 then round(orders_with_items::numeric/orders_total,4) else 0 end,
                       'range_label','ม.ค.-14 ส.ค.') from cov),
        'top_sku',        case when p_include_money then (select j from top_sku) else '[]'::jsonb end,
        'product_mix',    case when p_include_money then (select j from mix)     else '[]'::jsonb end,
        'aov_by_channel', case when p_include_money then (select j from aov_ch)  else '[]'::jsonb end,
        'new_returning',  (select j from nr),
        'sales_trend',    (select j from trend),
        'weekday',        (select j from wk)
      );
    $$;

    grant execute on function analytics.dashboard_charts(uuid, text, boolean) to authenticated, service_role;
    notify pgrst, 'reload schema';

range_label เป็น placeholder — dev derive จริงจาก min/max(order_date) ของแถวที่มี line-item ได้ถ้าคุ้ม; ไม่งั้น frontend ใส่คงที่ (line-item ครอบ ม.ค.-14 ส.ค.).

### 1d. แก้ dashboard_summary (0039) — additive 2 KPI

ในบล็อก if p_include_money เดิม เติม 2 field เข้า v_kpi:

    'customers',   (select count(distinct customer_id) from analytics.v_fact_order
                    where shop_id = p_shop_id and order_date >= v_from and customer_id is not null),
    'repeat_rate', ( ...ตาม section 2... )

create-or-replace ต้องคง shape เดิมทุก field แค่เติมใน kpi.

---

## 2. นิยาม Customers & Repeat Rate (กันตีความผิด)

- Customers (ในช่วง) = count(distinct customer_id) ของออเดอร์ในช่วง period ที่ customer_id is not null. (ออเดอร์มาสก์ PII customer_id null ถูกตัด → เป็น floor).
- Repeat Rate = สัดส่วนของ "ลูกค้าที่ active ในช่วง" ที่เป็น repeat buyer (มี >=2 ออเดอร์ lifetime):

    with cust as ( select distinct customer_id from analytics.v_fact_order
                   where shop_id=p_shop_id and order_date >= v_from and customer_id is not null )
    select case when count(*)>0
      then round(count(*) filter (where lt.cnt >= 2)::numeric / count(*), 4) else 0 end
    from cust c
    join lateral (select count(*) cnt from analytics.v_fact_order f
                  where f.customer_id = c.customer_id and f.shop_id = p_shop_id) lt on true

ตัดสิน: repeat = >=2 ออเดอร์ lifetime ไม่ใช่ within-period. เหตุผล: within-period ทำให้ today/7d ได้ ~0% เสมอ (คนน้อยซื้อซ้ำในวันเดียว) misleading. Lifetime = "ในลูกค้าที่ซื้อช่วงนี้ กี่ % เป็นขาประจำ" ตรงความหมายธุรกิจ.
trade-off: เป็น property lifetime ฉายลง cohort ของ period — label ต้องเขียน "ลูกค้าช่วงนี้ที่เป็นขาประจำ" ไม่ใช่ "ซื้อซ้ำในช่วงนี้".

---

## 3. Product Mix bucket mapping (category ดิบ → 4 ถัง)

public.product.category เป็น free-text (0028) ไม่ tag jewelry ตรงๆ → ใช้ category + SKU prefix ผสม (CASE เรียงลำดับ):

- silver_bar (เงินแท่ง) : category = 'เงินแท่ง'
- art_toy (Art Toy เงิน) : category ILIKE '%art%toy%'
- jewelry (เครื่องเงิน 925) : SKU prefix ^(NC|BL|B|E|P|R)[0-9]  (BL ก่อน B)
- other (อื่นๆ) : ที่เหลือ (ทองจีน / BOX / ของแถม / SKU ว่าง)

ลำดับ: check category ก่อน (เชื่อ tag ที่ตั้งใจกรอก) → fallback SKU prefix → ที่เหลือ other. other เป็นถังจริงเสมอ (ไม่ซ่อน) เพื่อให้ % รวม 100 และเจ้าของเห็นส่วนที่ยังไม่จัดหมวด.

---

## 4. Component tree + layout/IA

สร้างใหม่ที่ components/domain/dashboard/ (ยึด style เดิม: rounded-lg border border-zinc-200 bg-white p-4 shadow-sm, viewBox responsive, <title> tooltip, empty-state "ไม่มีข้อมูล"):

- TrendChart.tsx — Sales Trend 30 วัน — client (mode toggle) — port จาก tiktok/SalesTrendChart แต่ label รายวัน + ตัด per-bar value label + x-tick ห่าง.
- HBarChart.tsx — Top SKU + AOV by Channel — server — 1 component 2 ที่ — rows {label,value,displayValue,sub?}.
- DonutChart.tsx — Product Mix + New vs Returning — server — 1 component 2 ที่ — slices {label,value,color}+legend.
- WeekdayChart.tsx — Sales by Weekday — server — vertical 7 แท่ง จ.-อา.

ไม่ reuse tiktok/SalesTrendChart ตรงๆ: x-label ใช้ formatMonthShort (30 แท่งรายวันยุบเป็นเดือนเดียว) + per-bar label รก; port pattern สะอาดกว่า + ไม่แตะ component ที่หน้า tiktok ใช้อยู่. HBar/Donut/Weekday ไม่มี hook → server component (JS client น้อยลง).

Page (server component) ลำดับ IA:
1. Header + brand + period toggle (โชว์เสมอ — กราฟ count ก็ตามปุ่ม ไม่ผูก d.kpi แล้ว)
2. ต้องจัดการ (action-needed เดิม บนสุด โชว์ staff)
3. KPI row 6 การ์ด grid-cols-2 md:grid-cols-3 lg:grid-cols-6 (ยอดขาย/ออเดอร์/กำไร/AOV/ลูกค้า/Repeat) — เงิน+customers/repeat โชว์เมื่อ d.kpi != null
4. กราฟ:
   - TrendChart full width "ยอดขาย 30 วันล่าสุด"
   - grid lg:grid-cols-2: HBar(Top SKU) | Donut(Product Mix) — ทั้งคู่มี coverage note
   - grid lg:grid-cols-2: Donut(New vs Returning) | HBar(AOV by Channel)
   - WeekdayChart full width "ทุกช่วงเวลา"
5. Reco / RFM / ช่องทางเด่น / ทางลัด (เดิม)

responsive: mobile ทุก grid = 1 col; coverage note = text-xs text-zinc-500 "อิงออเดอร์ที่มีข้อมูลสินค้า {pct}% ({rangeLabel})".

---

## 5. Type contracts (lib/dashboard/types.ts)

    export interface DashboardKpi {
      revenue: number; orders: number; profit: number; aov: number;
      customers: number;   // ใหม่
      repeatRate: number;  // ใหม่ (0..1)
    }
    export interface TrendPoint { date: string; revenue: number | null; orders: number; aov: number | null; }
    export interface HBarRow    { label: string; value: number; displayValue: string; sub?: string; }
    export interface MixSlice   { bucket: string; label: string; revenue: number; pct: number; }
    export interface NewReturning { new: number; returning: number; unknown: number; }
    export interface WeekdayPoint { dow: number; label: string; orders: number; revenue: number | null; }
    export interface ChartCoverage { ordersTotal: number; ordersWithItems: number; itemsPct: number; rangeLabel: string; }
    export interface DashboardCharts {
      period: DashboardPeriod;
      coverage: ChartCoverage;
      topSku: HBarRow[];         // [] เมื่อ staff
      productMix: MixSlice[];    // [] เมื่อ staff
      aovByChannel: HBarRow[];   // [] เมื่อ staff
      newReturning: NewReturning;     // count มีเสมอ
      salesTrend: TrendPoint[];       // revenue/aov=null เมื่อ staff
      weekday: WeekdayPoint[];        // revenue=null เมื่อ staff
    }

Action ใหม่ getDashboardCharts(period) ใน lib/actions/dashboard.ts (map snake->camel เหมือน getDashboard, p_include_money = getDevRole() !== staff, return ActionResult<DashboardCharts>).

---

## 6. Staff gating (ตัดสินต่อกราฟ)

- Sales Trend (revenue/aov) : staff เห็นบางส่วน — orders คงไว้, revenue/aov=null → chart โหมด orders (ซ่อน toggle เงิน).
- Top SKU / Product Mix / AOV by Channel (เงิน) : staff ไม่เห็น — return [] → empty-state.
- New vs Returning (count) : staff เห็น — คงไว้.
- Sales by Weekday : staff เห็น orders — orders คงไว้, revenue=null.
- Coverage note : ไม่ใช่เงิน — โชว์ staff.

หลักการเดิม 0039: เงินตัดที่ SQL ไม่ใช่ UI — staff session ไม่มีทางได้ byte ของ revenue/profit. getDashboardCharts set p_include_money จาก role เดียวกับ getDashboard.

---

## 7. แผน implement (phase)

- Phase 1 Backend (backend-dev): migration 0044_dashboard_charts.sql = (a) create dashboard_charts 1c + grant, (b) create-or-replace dashboard_summary เติม 2 KPI 1d/2. Tech Lead apply ผ่าน MCP. ทดสอบ 3 period x (owner/staff) ว่า money gate ตัดจริง.
- Phase 2 Frontend (frontend-dev): 4 chart components 4 + getDashboardCharts action + types 5 + rewrite page.tsx (Promise.all, IA 4). npm run typecheck.
- Phase 3 Verify (ขนาน): security-auditor (staff ไม่เห็น revenue/profit/aov/top-sku ในทุก payload) + qa-tester (empty-state, coverage %, period toggle, mobile 1-col) → code-reviewer ปิดท้าย.

---

## 8. ความเสี่ยง / จุดต้องระวัง

1. Line vs order revenue ไม่เท่ากัน: Top SKU & Product Mix ใช้ unit_price*qty ระดับ line; ผลรวม != order revenue (มี shipping/discount). เป็นสัดส่วนสินค้า ไม่ใช่ยอดขายจริง — copy อย่าเคลม "ยอดขาย".
2. Coverage บิดตาม period: line-item ครอบ ม.ค.-14 ส.ค. → period ที่มีวันหลัง 14 ส.ค. coverage ตก, Top SKU/Mix เอียง. coverage note ต้องแสดงเด่น.
3. SKU prefix mapping เปราะ: prefix เครื่องเงินอื่น (RG/AN?) จะตกถัง other. verify distinct left(sku,2) กับของจริงก่อน ship; ถ้าเยอะย้ายไป seed table (YAGNI ตอนนี้ 6 prefix พอ).
4. is_new_customer=null: ออเดอร์มาสก์ PII → bucket unknown ใน New/Returning. อย่าโยนเข้า returning เงียบๆ.
5. generate_series timezone: trend/weekday ใช้ current_date/order_date (date อยู่แล้ว) — ไม่มีปม UTC เหมือน tiktok timestamptz.
6. แตะ 0039: create-or-replace ต้องคง shape เดิมทุก field (แค่เติมใน kpi) ไม่งั้นหน้า/action เดิมพัง.

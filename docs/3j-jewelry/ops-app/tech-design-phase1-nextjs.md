# Tech Design — TikTok Ops App Phase 1 (Next.js บน OMS)

> architect (Yoda) · 2026-08-10 · ตรวจของจริงแล้ว (0001 schema, tailwind.config, layout, lib/actions/orders)
> Scope: โครงแอป 4 หน้า + หน้ายอดขายต่อ orders จริง · Dashboard/Copilot/Upload = UI จริง + mock data

## ข้อเท็จจริงจากโค้ดจริง
- channel seed = **shopee, tiktok เท่านั้น — ไม่มี LINE** → หน้ายอดขายจาก orders = marketplace only
- tailwind: มีแค่ `primary` (indigo 50/100/600/700) + `min-h-11` · **ไม่มี brand red, ไม่มี dark mode**
- layout เดิม: NAV 4 item, mobile = icon-only, `max-w-3xl`, ToastProvider
- action pattern: service client + `getDevShopId()` + `ActionResult<T>` (ยังใช้ DEV_SHOP_ID ไม่มี auth จริง)

## 1. Routing
`app/(dashboard)/tiktok/{dashboard,copilot,upload,sales}/page.tsx` + `tiktok/layout.tsx` + `tiktok/page.tsx`=redirect→dashboard
- อยู่ใต้ `(dashboard)` group → ได้ ToastProvider/header/max-w-3xl ฟรี
- nested layout = แถบ brand accent แดง 3J + sub-nav โมดูล

## 2. Nav — เพิ่ม 4→**5** ไม่ใช่ 4→8
- top NAV เพิ่ม 1 item `{ /tiktok/dashboard, "TikTok Ops", BarChart3 }`
- `tiktok/layout.tsx` render **sub-nav 4 tab** (client, usePathname ไฮไลต์) เป็น sticky tab bar ใต้ header
- แก้ mobile overflow (§7/§8) ตรงจุด · bottom-nav ใน mockup ย้ายมาเป็น top tab bar (bottom fixed ชนกับ StickyActionBar/ปุ่ม sticky ของ upload)
- Trade-off: เข้าหน้า = 2 tap — ยอมรับได้ (ผู้ใช้ 1-2 คน วนใน 4 หน้า)

## 3. หน้ายอดขาย — data จริง (จุดสำคัญ + honest)
**LINE ไม่อยู่ใน orders** → ตัวเลข H1 (฿19.8M รวม LINE ฿15.4M) query จาก orders ไม่ได้ · หน้ายอดขาย = **marketplace-only ช่วงที่ OMS มีข้อมูล**

- `lib/actions/tiktok-sales.ts` → `getSalesSummary({from,to,granularity})` คืน `ActionResult<SalesSummary>`
  - select `placed_at,created_at,total_amount,status,channel_account_id` จาก orders · filter shop_id + ช่วง + `neq(status,cancelled)` · **aggregate ใน JS** (รวมยอด/นับ/AOV/bucket ต่อ period ต่อ channel)
  - ไม่ทำ SQL RPC: ~700 order/เดือน aggregate ใน action เร็วพอ + ไม่แตะ DB · โต >20k แถวค่อย migrate เป็น function (additive) — **tech debt**
  - วันที่: `placed_at` หลัก, null→`created_at` · filter DB บน created_at กว้างแล้วกรองละเอียด JS
  - **debt:** ยังไม่มี index `(shop_id,created_at)` — ที่สเกลนี้ผ่าน `idx_orders_shop_status` โอเค
- **UI บังคับ scope label:** "ข้อมูลจาก OMS — Shopee + TikTok เท่านั้น ตั้งแต่ [วันแรก]" กันเทียบไฟล์ H1 แล้วงงว่าหาย ฿15M
- ตัดทิ้ง: (ก) เพิ่ม channel line + backfill order เก่า → ปนเปื้อน OMS hot path · (ข) hardcode H1 ปนกราฟจริง → จริง/ปลอมแยกไม่ออก
- **Option (ต้อง confirm):** การ์ด "บริบท H1" แยก static จากไฟล์สรุป (label ชัด "ย้อนหลังจากไฟล์ ไม่ใช่ OMS")
- **Decision:** นับ status ไหน = ยอดขาย → เสนอ default ตัด cancelled + oversold_hold

## 4. Component plan
| หน้า | Reuse | สร้างใหม่ (`components/domain/tiktok/`) | S/C |
|---|---|---|---|
| Sales | Button, ErrorState, Skeleton | SalesKpiRow, SalesTrendChart, ChannelMixChart, DateRangeFilter, SalesScopeNote, SalesPageClient | server→client refetch |
| Dashboard | Badge, EmptyState, ErrorBanner, Skeleton | KpiCard (coveragePct บังคับ), DataQualityBanner (ปิดไม่ได้), BreakdownTabs, DashboardKpiSkeleton | server fixture→client tabs |
| Copilot | Badge, Button, Modal (pattern AdjustStockSheet) | CopilotCard, CopilotSection, CopilotOverviewCard, CopilotCardSkeleton | client |
| Upload | Button, Badge, EmptyState, Toast, Modal | UploadDropzone, UploadQueueList/Item, BatchSummaryCard, ReviewQueueList/Row, UploadQueueSkeleton | client (จำลอง state) |
| Layout | — | TikTokSubNav (client usePathname) | server+client |

Chart = hand-rolled SVG React (~80 บรรทัด/ตัว) ไม่ลง recharts (เลี่ยง +100KB เพื่อ 2 กราฟ)

## 5. Mock strategy (สลับเป็นจริงง่าย)
- `lib/tiktok/types.ts` — interface กลาง (SalesSummary = ตัวเดียวกับ action จริง)
- `lib/tiktok/fixtures.ts` — typed fixtures ตรงตัวเลข mockup + comment "MOCK — รอ analytics DB"
- `lib/tiktok/mock-actions.ts` — function หน้าตาเดียวกับ server action (`getDailyDashboard(): Promise<ActionResult<...>>`) → analytics DB มา สลับไฟล์เดียว UI ไม่แก้
- Copilot approve/dismiss = **localStorage** (ไม่แตะ DB, schema ควรเกิดพร้อม analytics DB)

## 6. File structure (เพิ่มอย่างเดียว แก้เดิม 2 จุด)
```
app/(dashboard)/tiktok/layout.tsx, page.tsx(redirect), {dashboard,copilot,upload,sales}/page.tsx
components/domain/tiktok/ (~14 ไฟล์)
lib/tiktok/{types,fixtures,mock-actions}.ts
lib/actions/tiktok-sales.ts  ← action จริงตัวเดียว
แก้เดิม: app/(dashboard)/layout.tsx (+1 NAV), tailwind.config.ts (+brand token)
```
ไม่ extend FilterBar เดิม (ผูก OMS ChannelCode/OrderStatus แน่น) — สร้าง filter โมดูลเอง

## 7. Design system mapping
- +token additive `brand:{DEFAULT:#a2191d,ink:#7d1316}` — ใช้แค่ accent bar/eyebrow/hero KPI (แดง ≠ ปุ่ม, danger จองแล้ว)
- ปุ่ม/chip/tab → indigo primary เดิม (mockup ใช้ indigo อยู่แล้ว)
- **Dark mode ตัด Phase 1** — OMS ไม่มี dark mode, ทำเฉพาะโมดูล = ครึ่งมืดครึ่งสว่าง (flag)
- emoji (📊🎯🏷️💰) → lucide (BarChart3/Target/Tags/Coins)

## ลำดับ implement + effort
| # | ชิ้น | Effort | สถานะ |
|---|---|---|---|
| 1 | tailwind token + tiktok/layout + SubNav + NAV item | S | ทำได้เลย |
| 2 | Sales: action + page + 2 chart | M | ทำได้เลย (data จริง) |
| 3 | Dashboard UI + fixtures | M | mock (data รอ analytics DB) |
| 4 | Copilot UI + localStorage | M | mock (engine รอ DB+LLM) |
| 5 | Upload UI (จำลอง state) | M | UI ได้ (pipeline รอ decision parser) |

## Decisions ต้อง confirm ก่อน implement
1. Sales นับ status ไหน (เสนอ: ตัด cancelled + oversold_hold)
2. เอาการ์ด "บริบท H1" (static, label ชัด) ในหน้า sales ไหม
3. ยอมรับหน้ายอดขาย = Shopee+TikTok เท่านั้น (LINE ไม่อยู่ OMS) หรือวางแผน import LINE (งานแยก)
4. Dark mode ตัด Phase 1 — ok ไหม
5. สิทธิ์ (§8 Q5) — ยังรัน DEV_SHOP_ID ไม่มี auth, ไม่ block Phase 1 (debt เดิมสืบทอด)

## ความเสี่ยง
- Sales query โตแล้วช้า (>หมื่นแถว) → ย้าย SQL function + index (debt ตั้งแต่วันแรก)
- ผู้ใช้เทียบ sales กับไฟล์ H1 ไม่ตรง → mitigate ด้วย scope label บังคับ
- Upload UI จำลอง state ไม่มี backend → **ต้อง label ชัด "ระบบอ่านไฟล์ยังไม่เปิดใช้"** กันลากไฟล์จริงแล้วคิดว่าบันทึกแล้ว

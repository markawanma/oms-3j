# Campaign Tracking Taxonomy v2 — Cross-platform + Clip Entity

> โดย CMO (Leia) 2026-08-18 · ต่อยอดจาก `campaign-playbook-taxonomy.md` (0049) + เอกสารเจ้าของ
> `3J_Jewelry_Marketing_KPI_Growth_System.md` · สถานะ: **เฟสวางแผน รอ architect design + เจ้าของอนุมัติ**

## 0. ปัญหาที่ต้องปิดก่อน (Foundation gap)

| ปัญหา | หลักฐาน | ผล |
|---|---|---|
| `fact_ad_spend.campaign_id` nullable + `mkt_upsert_ad_spend` hardcode `null` (0027:109) | spend ผูกแค่ channel-day | ROAS รายแคมเปญคำนวณไม่ได้ |
| margin placeholder 20% (`v_channel_perf_roas.profit_roas`) | comment "ALWAYS an estimate" | contribution profit = เลขปลอม |
| campaign มี 2 ตัวไม่รู้จักกัน: `dim_campaign` (ad/UTM) vs `analytics.campaign` (playbook 0049) | ไม่มี FK | แผนกับผลต่อกันไม่ติด |

**Decision 0:** Foundation = ปิด 3 ช่องนี้ ไม่ใช่ติด pixel เพิ่ม

## 1. สองแกน — อย่ายัดเป็น enum เดียว

- `campaign_type` (มีแล้ว 0049) = **WHO/WHEN** (promo_event/live_promo/winback/...) — คงเดิม
- `campaign_objective` (ใหม่) = **WHAT/WHERE** — 7 ค่า ด้านล่าง · สองแกนตัดกันได้ (เช่น promo_event × live_drive)

## 2. Campaign Objective Types (7)

| objective | รูปแบบจริง | funnel | Primary KPI | Guardrail | Attribution tier |
|---|---|---|---|---|---|
| `dm_handoff` | ยิง FB → ปิดใน LINE/inbox | Awareness→Consideration | Cost per qualified DM + DM→order rate | CAC ≤ 40% contribution/order | B |
| `cart_direct` | content ปักตะกร้า ซื้อใน TikTok เลย | Consideration→Purchase | Product-click→order rate | AOV ไม่ตก >15% | A |
| `live_drive` | ยิงดึงคนเข้าไลฟ์ | Interest→Engagement | Cost per live entry + viewer→order% | avg watch ไม่ตก | C (time-window) |
| `code_promo` | โค้ดส่วนลดร้านสร้างเอง | Purchase→Repeat | Redemption rate + incremental margin | margin floor 10% | A + B |
| `owned_capture` | การ์ดพัสดุ/QR → add LINE | Purchase→Owned | Cost per LINE follower (+consent) | unsub <2%/broadcast | A (keyword) |
| `retention_broadcast` | LINE ยิงลูกค้าเก่า | Repeat→Loyalty | Revenue per 1,000 messages | quota ≤4 msg/คน/4wk | A (code) |
| `brand_authority` | ความรู้ 925/ช่าง 30 ปี/แท่ง | Awareness→Trust | Saves+Shares per 1k views · follower growth | **ห้ามมีช่อง ROAS ใน UI** | ไม่ attribute |

## 3. Attribution — บันได 3 ชั้น + Unattributed เป็นตัวเลขชั้นหนึ่ง

| Tier | วิธี | แหล่ง | เชื่อถือ | ใช้ตัดสิน |
|---|---|---|---|---|
| **A Deterministic** | platform voucher / UTM / โค้ดที่ระบบบันทึก | `fact_order.discount_code` (0040) | สูง | ตัด/เพิ่มงบได้ |
| **B Declared** | ลูกค้าพิมพ์โค้ด-คีย์เวิร์ดในแชท / ถามใน DM | `promo_attribution` (0036) | กลาง | จัดอันดับ |
| **C Inferred** | time-window lift เทียบ baseline | ต้องมี `live_session` | ต่ำ (ทิศทาง) | ห้ามใส่รายงานกำไร |
| **U Unattributed** | ที่เหลือ | ส่วนต่าง | — | **โชว์เป็น % เสมอ** |

**KPI สุขภาพระบบ = Attribution Coverage %** — เป้า เดือน 1 = 30%, เดือน 3 = 60%

### วิธีต่อรูปแบบจริง
- **FB→LINE:** 1 ad creative = 1 keyword (LINE add-friend URL + greeting ให้พิมพ์ เช่น `ปี่เซียะ01`) — อย่าหวัง pixel
- **ปักตะกร้า:** SKU-level lift (ยอด SKU 48 ชม.หลังโพสต์ vs เฉลี่ย 14 วัน) — ต้องมี fact_order_item ครบ
- **ไลฟ์:** entity `live_session` + attribute order ที่ paid_at ในช่วง session +90 นาที บน channel tiktok
- **โค้ด:** มาตรฐาน `[OBJ][YYMM][SEQ]` (LIVE2609, CART2609A) ไม่มีตัวสับสน 0/O 1/I/l · โค้ดเดียว = spine ทั้ง voucher (A) และ keyword (B) → วัด "อัตราคนลืมพิมพ์" · 1 แคมเปญ ≥2 โค้ดเมื่อทดสอบ 2 creative

## 4. ฟิลด์ที่ระบบต้องเก็บ (ให้ architect)

### A. เพิ่มบน `analytics.campaign`
`campaign_code` (unique/shop, spine) · `objective` (7 ค่า) · `funnel_stage_primary` · `source_channels[]` / `destination_channels[]` (หัวใจ cross-platform) · `budget_planned` · `offer_kind`/`offer_value` · `target_kpi_name/_value` (บังคับกรอกก่อนยิง) · `guardrail_kpi_name/_value` · `attribution_method`/`attribution_tier`/`attribution_window_hours` (live=90, code=168, DM=336) · `hero_sku_ids[]` · `hypothesis` · `result_verdict` (win/lose/inconclusive/running)

### B. ตารางใหม่ 3 ตัว
| ตาราง | grain | แกน |
|---|---|---|
| `campaign_code` | 1 row/โค้ด | campaign_id, code, code_kind(voucher/keyword/utm), platform, valid_from/to, max_redemption |
| `live_session` | 1 row/ไลฟ์ | started/ended_at, platform, theme, host, peak/avg_viewer, comments, campaign_id? |
| `campaign_result_daily` | campaign × date | spend, impressions, clicks, attributed_orders/revenue แยก a/b/c, est_contribution_profit |

### C. แก้ของเดิม
1. `mkt_upsert_ad_spend` + `p_campaign_id` — **ทำก่อนตัวอื่นทั้งหมด**
2. `dim_campaign.parent_campaign_id → analytics.campaign(id)`
3. `fact_order` + `live_session_id`, `attribution_tier`
4. เริ่มเขียน `fact_touchpoint` (line_add_friend, live_view)
5. view `v_campaign_scorecard`: spend, revenue 4 tier, coverage%, CAC, contribution profit vs target

⚠️ CFO flag: contribution profit ยังประมาณการจนกรอก unit_cost ครบ — UI ต้องติดป้ายทุกจุด

## 5. Clip Entity (1 Idea → 3 Hooks → 2 Executions)

```
content_idea (1) → clip (N) → clip_metric_daily (N)
```

### `content_idea`
`idea_code` (IDEA-2609-01) · `core_insight` (ความเชื่อของลูกค้า ไม่ใช่ฟีเจอร์) · `pillar` (knowledge/entertain/product/story/proof/promo — mix 20/20/20/15/15/10) · `moat_asset` (craftsman/factory/silver_bar_nfc/live_price/stamp_925/customer_proof/none — none ต้องมีเหตุผล) · `claim_risk` (none/needs_expert/needs_cfo/needs_legal) + `verified_by/at`

### `clip`
`idea_id` · `clip_code` (IDEA-2609-01-H2-B) · `hook_type` (curiosity/problem/price/education/contrarian/story/choice) · `hook_line` (คำต่อคำ 3 วิแรก) · `execution_variant` (A/B ต่างแค่วิธีถ่าย) · `funnel_stage` · `primary_metric` (**1 ตัว** ตาม funnel) · `guardrail_metric` · `hypothesis` · `cta_type` (comment_keyword/add_line/cart_link/live_reminder/follow/dm/none) · **`cta_code` → FK `campaign_code` (สะพาน content↔revenue เส้นเดียว)** · `linked_sku_ids[]` · `campaign_id?` · `boosted`/`boost_spend` · `platform, published_at, duration_sec, format` · `repurposed_from` · `verdict` · `learning`

### `clip_metric_daily`
views, views_3s, avg_watch_pct, completion_pct, likes, comments, shares, **saves** (สำคัญกว่า likes สำหรับสายมู/ลงทุน), profile_visits, follows, product_clicks, orders_attributed, live_entries

### Primary metric ต่อชั้น funnel (ห้ามวัดผิดชั้น)
| stage | primary | เกณฑ์ผ่าน | ห้ามใช้ |
|---|---|---|---|
| awareness | 3s-retention % | ≥35% | orders |
| interest | avg watch % | ≥50% | orders |
| consideration | (saves+shares)/1k | ≥15 | views |
| purchase | product click→order % | ≥3% | views |
| repeat | code redemption ลูกค้าเก่า | — | views |

**กติกาตัดสิน:** ≥1,000 views/variant ถึงตัดสิน · เทียบ hook ที่ 3s-retention → execution ที่ avg watch → conversion · ต่ำกว่า = inconclusive ห้ามสรุป

## 6. ไอเดียคลิป 10 ตัว (สูตรแม่: "โชว์สิ่งที่คนอื่นโชว์ไม่ได้ ในวินาทีแรก")

moat 4 อย่างที่ร้านรีเซลเลอร์ถ่ายไม่ได้: ช่าง 30 ปี+โรงงาน · เงินแท่ง+NFC · ราคา realtime+buy-back · ตรา 925 จริงในมือ

| # | หัวข้อ | hook | CTA | KPI | ธง |
|---|---|---|---|---|---|
| V1 | สแกน NFC แท่งเงิน "มีชิปข้างใน" | curiosity | คอมเมนต์ `แท่ง` | saves/1k | — |
| V2 | ชั่งให้ดูทำไมราคานี้ (ตาชั่ง×ราคาเงินวันนี้) | price | ปักตะกร้า | click→order% | **รอ CFO เคาะเปิดสูตร** |
| V3 | ขายคืนจริง ถ่ายให้ดู (หัก 30 บ./บาท ต่อหน้า) | contrarian | คอมเมนต์ `ราคา` | comment+DM | เงื่อนไขขึ้นจอ |
| V4 | ช่าง 30 ปี ซ่อมแหวนพัง (before/after ASMR) | story | follow | avg watch % | — |
| V5 | ให้ช่างทาย แท้ 1 ชุบ 2 | choice | comment | comments/1k | ห้ามพาดพิงแบรนด์อื่น |
| V6 | ปี่เซียะใส่ผิดด้าน 8 ใน 10 | problem | คอมเมนต์ `ปี่เซียะ` | saves/1k | ห้ามเคลม "รวยแน่นอน" |
| V7 | หลอมกำไลเก่า 20 ปีเป็นแหวนใหม่ (timelapse) | curiosity | DM งานสั่งทำ | completion % | — |
| V8 | เงินดำ = ปลอม? (ตรงข้าม! เช็ด 10 วิ) | contrarian | follow+save | 3s-retention | ช่างยืนยันเคมี |
| V9 | แม่ค้ารับไปขายกำไรเท่าไหร่ | education | DM `ขายส่ง` | qualified DM | **CFO verify ตัวเลข** |
| V10 | นาทีทองจากไลฟ์ (ของหมดใน 3 นาที) | story | เตือนไลฟ์รอบหน้า | live entries | ห้ามเลขสต็อกลอย |

สำรอง: V11 ราคาเงินวันนี้ (recurring, สร้าง habit) · V12 "1 แหวน 5 ลุค" (entertain)
**เริ่มก่อน: V1, V6, V8** (ต้นทุนต่ำ + moat ชัด + ไม่ต้องรอ CFO)

## 7. Trade-off & เงื่อนไขสำเร็จ

- งานมือเพิ่ม ~10-15 นาที/วัน (ลง live_session + ถามที่มาใน DM) — **ถ้าไม่มีคนรับผิดชอบ (COO) อย่าเพิ่ง build**
- coverage 2 เดือนแรกจะ ~20-30% = ความจริง ไม่ใช่ความล้มเหลว
- เปิดสูตรราคา (V2/V3/V9) = เปิดต้นทุนให้คู่แข่ง — **CFO ตัดสินก่อน**
- คำถามค้าง: งบ FB จริง/เดือน + DM เข้าวันละกี่ราย — ถ้า DM <10/วัน คอขวดคือ reach ไม่ใช่ tracking

## ส่งต่อ
- **architect:** §4 ทั้งหมด (ทำ `mkt_upsert_ad_spend(p_campaign_id)` ก่อน) + §5 schema
- **CFO:** เปิดสูตรราคา? · ตัวเลข V9 · margin floor code_promo · blended margin จริง
- **COO:** เจ้าภาพ live_session + ถาม DM
- **content-strategist/copywriter:** แตก V1-V10 ตาม 3 Hooks × 2 Executions (แม่แบบ §5)

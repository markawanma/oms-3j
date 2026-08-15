# Campaign Playbook Taxonomy — 3J Ad Copilot

> CMO (Leia) · 2026-08-15 · ฐาน: campaign-plan-99-winback, broadcast/winback scripts, ops-plan-99, discount-policy-99, content-master, month1-calendar
> **สถานะ:** taxonomy definition (input ให้ architect design `campaign_playbook` model)

## หลักคิด
Copilot ต้องตอบเจ้าของร้าน 2 คำถามเท่านั้น: **"ตอนนี้ต้อง action อะไร"** (= step) และ **"ในแต่ละ action ต้องผลิต content อะไร ใครทำ เสร็จยัง"** (= artifact) ผูกกับ funnel `reach → engage → convert → retain` + gate ธุรกิจ (CFO discount / COO stock / PDPA)

---

## ชั้น 1 — CAMPAIGN TYPES (6 ชนิดที่ 3J ใช้จริง)

| campaign_type | เป้า (funnel) | ช่องทางหลัก | trigger | audience segment | สถานะจริงตอนนี้ |
|---|---|---|---|---|---|
| `promo_event` | convert (peak) | LINE OA + TikTok live | calendar (9.9/11.11/ตรุษจีน) | champion, loyal, new, all_followers, geo_bkk | **active** (9.9) |
| `winback` | retain/reactivate | LINE OA | data (recency >90 วัน) | at_risk | **blocked — waiting_data** (at-risk=0, รอสะสม 2-3 เดือน) |
| `second_purchase_nurture` | retain (2nd order) | LINE OA | data (new = ซื้อครั้งเดียว) | new | active (subset ของ 9.9) |
| `live_promo` | convert (engine) | TikTok live | recurring (จ/พ/ศ) | all_followers | **active — recurring engine** |
| `vip_loyalty` | retain (exclusivity) | LINE 1:1 + narrowcast | data (RFM champion/loyal) | champion, loyal | active |
| `acquisition` | reach→owned | TikTok→LINE (การ์ดในพัสดุ + CTA live) | always-on | tiktok_buyer→line | **active** (การ์ด generic เริ่ม 20-21 ส.ค.) |

`trigger` = enum แยก (`calendar` / `data_driven` / `recurring` / `always_on`) — Copilot ตัดสินว่าเด้ง action เมื่อไหร่ (calendar = นับถอยหลังจากวันงาน, data = poll จาก view)

---

## ชั้น 2 — STEPS มาตรฐานต่อ type (sequence + timing pattern)

**timing = relative offset** (`D-n` จากวันงาน) ให้ระบบคำนวณวันจริงเอง ไม่ hardcode

### `promo_event` (แม่แบบ 9.9 — 5 steps)
| seq | step_kind | timing | audience | goal / KPI | gate |
|---|---|---|---|---|---|
| 1 | `teaser` | D-8→D-7 | all_followers | teaser click ≥15-20% = ขนาด audience วันจริง | pdpa_consent |
| 2 | `vip_private_access` | D-4→D-3 | champion (1:1), loyal (narrowcast) | champion 6 คน→4-5 order AOV ≥฿1,600 | coo_stock_check (จองตัด reserve RPC) |
| 3 | `main_day` | D-0 | คนกดรับสิทธิ์ + all | GMV/ชม.live, attribution "รับสิทธิ์99" | cfo_discount_approval + coo_stock_check + price_realtime_fill |
| 4 | `last_call` | D-0 ค่ำ | คลิกแล้วยังไม่ซื้อ | ปิดคนค้าง; block/unsub <2% | coo_stock_check (จำนวนเหลือ=เลขจริง) |
| 5 | `post_sale` | D+2→D+3 | สายลงทุน/เงินแท่ง | second angle (มุมลงทุน) | silver_bar ห้ามคำ "ลด" |

### `winback` (4 steps — ทั้ง type blocked)
`reconnect` (soft) → `segment_offer` (A เงินแท่ง / B เครื่องประดับ / C กลาง) → `followup_nudge` (D+4-5 เฉพาะคนไม่คลิก) → `close`
Gate: ต้องมี audience at_risk >0 (ตอนนี้=0), quota รวมกับ promo ต้องเช็ค

### `live_promo` (recurring — 3 steps/session)
`pre_live_hook` (short-form, D-0 เช้า) → `live_session` (2 ชม., theme หมุน: จ=เงินแท่ง / พ=คอลเลกชัน / ศ=โปรท้ายสัปดาห์) → `live_highlight_recap` (D+1, clip นาทีทอง)
Gate: ราคาเงินวันนี้ confirm ก่อน 10 โมง (blocking); ทุกดีลผ่าน quick-order ห้ามจดกระดาษ

### `vip_loyalty` / `second_purchase_nurture` / `acquisition`
- **vip:** `identify` (ดึง champion/loyal สด) → `personal_outreach` (1:1) → `perk_fulfillment` (สลักชื่อ/กล่อง ≤฿50)
- **second_purchase:** `remind` → `cross_sell_matching` (ชิ้นเข้าชุด ฿500-900) — เป้า = 2nd order ไม่ใช่ AOV
- **acquisition:** `insert_card` (การ์ด add-LINE ในพัสดุ) → `live_cta` (CTA ทุกไลฟ์) → `capture_consent` (กดรับสิทธิ์ = consent)

---

## ชั้น 3 — CONTENT ARTIFACTS ต่อ step ("content ข้างในต้องทำอะไร")

แต่ละ artifact = `{artifact_type, owner, source_doc, status, is_dynamic}`

| artifact_type | ใช้ใน step | owner | template มีแล้วที่ | status default |
|---|---|---|---|---|
| `broadcast_script_line` | teaser, last_call, main_day, reconnect | copywriter | broadcast-scripts-99 (Hook A/B), winback-scripts (A/B/C/D) | **done (draft)** — รอ fill placeholder |
| `dm_script_1to1` | vip_private_access, personal_outreach | copywriter/owner | broadcast-scripts-99 ข้อ 2 | draft — รอชื่อ+SKU รายคน |
| `teaser_image` | teaser | content-repurposer | — | todo |
| `cta_button_flex` | teaser, vip, main_day | owner (LINE OA) | สคริปต์ระบุปุ่ม + PDPA line | todo — รอยืนยัน Flex |
| `parcel_card` | insert_card | copywriter→โรงพิมพ์ | ops-plan-99 ข้อ 3 (generic + QR + รับสิทธิ์99) | draft — deadline ไฟล์ 18 ส.ค. |
| `live_rundown` | live_session, main_day | owner/host | month1-calendar ข้อ 2 (15/กลาง/15) | todo ต่อ session |
| `attribution_code` | main_day, last_call, insert_card | tech_lead | "รับสิทธิ์99" (พิมพ์ในแชท, ยังไม่มี tracking link) | **active** |
| `short_form_clip` | pre_live_hook, post_sale | copywriter+repurposer | content-master (7 พร้อมถ่าย + .srt) | mixed (7 done / 18 todo) |
| `live_highlight_clip` | live_highlight_recap | content-repurposer | content-master R4 | todo ต่อ live |
| `fb_post` / caption | teaser, post_sale | copywriter | content-master | todo |
| `bundle_offer_spec` | main_day (เงินแท่ง+จี้) | cfo+copywriter | discount-policy-99 ข้อ 4 | **blocked** — รอต้นทุนจี้ |

---

## ENUMS (architect → check constraint / column)

```
campaign_type   = promo_event | winback | second_purchase_nurture | live_promo | vip_loyalty | acquisition
trigger_kind    = calendar | data_driven | recurring | always_on
step_kind       = teaser | vip_private_access | main_day | last_call | post_sale |
                  reconnect | segment_offer | followup_nudge |
                  pre_live_hook | live_session | live_highlight_recap |
                  identify | personal_outreach | perk_fulfillment |
                  remind | cross_sell_matching |
                  insert_card | live_cta | capture_consent | close
artifact_type   = broadcast_script_line | dm_script_1to1 | teaser_image | cta_button_flex |
                  parcel_card | live_rundown | attribution_code | short_form_clip |
                  live_highlight_clip | fb_post | bundle_offer_spec
audience_segment = champion | loyal | new | at_risk | all_followers | geo_bkk |
                   silver_bar | tiktok_buyer | line_follower
artifact_status = todo | draft | done | blocked
campaign_status = active | scheduled | blocked | waiting_data | done
owner_role      = copywriter | content_repurposer | owner | cfo | coo | tech_lead | host
channel         = line_oa | tiktok_live | shopee | facebook | parcel_insert
gate_kind       = cfo_discount_approval | coo_stock_check | pdpa_consent | quota_check | price_realtime_fill
```

---

## จุดที่ต้อง "ผูกข้อมูลสด" (is_dynamic=true) — อย่าเก็บเป็นเลขตาย

| field | ดึงจาก | เหตุผล |
|---|---|---|
| จำนวน champion/loyal/new/at_risk ต่อ step | `v_rfm_segment` (สด) | at_risk=0 วันนี้ พรุ่งนี้อาจ >0; hardcode = เด้ง winback ผิดจังหวะ |
| stock hero คงเหลือ (last_call, live_session) | central_stock / live counter | ห้ามใส่เลขลอยเร่งขาย (กติกาเหล็ก) |
| ราคาเงินแท่ง realtime | Google Sheet→Wix price feed | ผันผวนรายวัน fill ตอนใกล้ยิง |
| teaser click → audience วันจริง | tag click log | ขนาด audience main_day = ฟังก์ชันของ teaser result |
| attribution "รับสิทธิ์99" count | log table (Tech Lead กำลังทำ) | วัด conversion ของ step |

---

## BUSINESS RULES ที่ต้องบังคับใน UI (hard gate)

1. **เงินแท่งห้ามลด** — artifact segment=`silver_bar` ห้ามมี discount% / คำ "ลด" (arbitrage risk). ใช้ได้แค่ ส่งฟรี+ประกัน/NFC/buy-back โปร่งใส
2. **ส่วนลดเครื่องประดับต้องผ่าน CFO** — step มี discount ต้อง gate `cfo_discount_approval`=passed ก่อน status→done. เพดาน: LINE 0-5% (แนะนำ 0), TikTok/Shopee ≤5-7%, floor margin 10% — conservative จนกรอก unit_cost
3. **Quota ≤4 ข้อความ/คน/4 สัปดาห์** — นับข้าม campaign (winback+promo รวม) ต่อ segment. เกิน = เตือน+block
4. **PDPA consent** — step ที่มี `cta_button_flex`/`capture_consent` ต้องมี consent line. ไม่มี = block
5. **block/unsub <2%/broadcast** — เกิน = flag "หยุดทบทวน" ก่อน step ถัดไป
6. **LINE ไม่ไล่คนไป Shopee** — channel=line_oa ห้าม CTA ไป shopee (เสีย fee จากลูกค้าตัวเอง)
7. **bundle เงินแท่ง+จี้** = blocked จนกรอกต้นทุนจี้ (ส่วนลดออกจาก margin จี้เท่านั้น, เป็นบาทไม่ใช่ %, LINE-only)

---

## ตัวอย่างเต็ม — "9.9 Promo Event" map ลง taxonomy

```
campaign: "9.9 Silver Event 2026"
  type=promo_event · trigger=calendar (anchor=2026-09-09) · status=active
  primary_channel=[line_oa, tiktok_live]

step 1 · teaser · D-8 (1-2 ก.ย.) · audience=all_followers · KPI: click≥15-20%
  gate: pdpa_consent
  artifacts:
    - broadcast_script_line (Hook A/B) — copywriter — done(draft) — src:broadcast-scripts-99
    - cta_button_flex ("กดรับสิทธิ์ 9.9") — owner — todo (รอยืนยัน Flex)
    - teaser_image — content_repurposer — todo

step 2 · vip_private_access · D-4 (5-6 ก.ย. เย็น 18-19) · audience=[champion,loyal]
  gate: coo_stock_check (จองตัด reserve RPC ทันที)
  dynamic: champion=6/loyal=55 ← v_rfm_segment
  artifacts:
    - dm_script_1to1 (champion 6 คน) — copywriter/owner — draft (รอชื่อ+SKU รายคน)
    - broadcast_script_line (loyal narrowcast) — copywriter — done(draft)

step 3 · main_day · D-0 (9 ก.ย. เช้า→live 14-16) · audience=คนกดรับสิทธิ์+all
  gate: cfo_discount_approval + coo_stock_check + price_realtime_fill
  dynamic: stock hero, teaser-click audience, attribution count
  artifacts:
    - broadcast_script_line (วันจริง + ชี้ live) — copywriter — done(draft, รอ hero SKU+ลิงก์ live)
    - live_rundown — host — todo
    - attribution_code "รับสิทธิ์99" — tech_lead — active
    - bundle_offer_spec (แท่ง+จี้) — cfo — BLOCKED (รอต้นทุนจี้)

step 4 · last_call · D-0 ค่ำ · audience=คลิกแล้วยังไม่ซื้อ
  gate: coo_stock_check
  artifacts:
    - broadcast_script_line — copywriter — done(draft, fill จำนวนจริงหน้างาน)

step 5 · post_sale · D+2 (11-12 ก.ย.) · audience=silver_bar
  gate: silver_bar ห้ามคำ "ลด"
  status: waiting_data (silver_bar segment ดึงไม่ได้จนมี line-item ต่อ SKU)
  artifacts:
    - broadcast_script_line (มุมลงทุน/buy-back/NFC) — copywriter — todo
    - fb_post — copywriter — todo
```

---

## CMO decisions ที่ต้องสะท้อนเป็น status (ห้ามโชว์ "พร้อมยิง" ทั้งที่ไม่พร้อม)
- `winback` ทั้ง type = **waiting_data** (at-risk=0) — โชว์เหตุผล "ยังไม่มี audience — รอ recency 2-3 เดือน" ไม่ใช่ปุ่มเทาๆ
- `post_sale` (silver_bar) + `bundle_offer_spec` = **blocked** จนมี line-item ต่อ SKU + ต้นทุนจี้
- `dm_script_1to1` = draft generic จนได้ชื่อ+SKU รายคน

## ส่งต่อ architect + Tech Lead
1. **architect:** model 3 ชั้น `campaign → step → artifact` (1:N:N). แยก `is_dynamic` (resolve ตอน render ผูก view) จาก static. `gate` = ตารางกลาง M:N กับ step. `timing` = relative offset (int วัน) + `anchor_date` ที่ campaign level
2. **Tech Lead:** Copilot ต้องอ่าน log ที่กระจายอยู่จากที่เดียว — teaser-click log, "รับสิทธิ์99" attribution, live session log (viewer/order/GMV), v_rfm_segment count สด, central_stock hero

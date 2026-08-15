# Campaign Playbook — Technical Design

> architect (Yoda) · 2026-08-15 · status: **PROPOSED — รอ approve ก่อน implement**
> เอาแผนการตลาด CMO (`docs/3j-jewelry/marketing/campaign-playbook-taxonomy.md`) เข้า Ad Copilot ให้เจ้าของเห็น "ต้อง action อะไร + content ต้องทำอะไร ใครทำ เสร็จยัง" ผูกข้อมูลสด

ยึดของจริงที่อ่าน: `0027` (v_marketing_reco + mkt_reco_decision), `0020` (v_rfm_segment: segment = champion/loyal/new/at_risk/standard/no_orders — **ไม่มี silver_bar**), `0037` (v_hero_stock), `0036/0040` (promo_attribution keyed by code), copilot page + RecoList + marketing.ts. migration เริ่ม **0049** (0046-0048 จอง auth-hardening)

---

## 6 การตัดสินหลัก

**D1 · Schema = `analytics`** — playbook เป็น marketing-intel (owner/admin) เกาะ v_rfm_segment/reco/hero_watch ที่อยู่ analytics หมด. ตัด `public` เพราะต้อง cross-schema join ตลอด + RLS tier ตรงอยู่แล้ว (0012)

**D2 · Enum = `text + CHECK`** ไม่ใช่ pg enum type — ทั้ง repo ไม่มี enum type. step_kind 20 ค่า CMO อาจเพิ่ม → DROP/ADD CONSTRAINT ง่ายกว่า `ALTER TYPE ADD VALUE` (lock). TS mirror `lib/marketing/campaign-types.ts`

**D3 · Copilot = section แยก "แคมเปญ (ตามแผน)" ไม่ merge เข้า v_marketing_reco** — reco = stateless rule feed (recompute ทุก load, approve/dismiss, flat); campaign step = stateful stored + artifacts ซ้อน (checklist) + gates + toggle-done. ยัดเข้า reco = เสียโครง checklist. **Reuse:** CopilotSection/Badge/is_blocked semantics. Trade-off: 2 section (แผน CMO vs ระบบจับได้ = คนละ mental model — ตั้งใจ)

**D4 · is_dynamic resolve ตอน read** — `audience_live_count` join v_rfm_segment สดใน view; เก็บแค่ `audience_segment` ไม่เก็บเลข → at_risk=0 → waiting_data อัตโนมัติ, silver_bar ไม่มีใน RFM → count 0 → waiting_data **โดยไม่ hardcode**. artifact-dynamic (attribution/stock/price) เก็บ flag, resolve phase 2

**D5 · 7 rule แบ่ง RPC-enforced vs UI-only** — state ชัด (CFO/PDPA/stock/bundle) บังคับใน `campaign_advance_step`; free-text ("คำว่าลด") + runtime metric (unsub<2%) = UI/review (ไม่แกล้งบังคับสิ่งที่ DB ทำไม่ได้)

**D6 · Phase 1 = read-only board + seed 9.9 hardcoded** — เห็นคุณค่าเร็วสุด ไม่ต้องรอ write CMS. Trade-off: แก้แผน = แก้ SQL (ยอมได้ — 9.9 แคมเปญเดียว ทีมเล็ก)

---

## Data model (schema `analytics`, RLS = pattern hero_watch: tenant_isolation_select + owner_admin_*, denormalize shop_id ทุกชั้น)

- **`campaign`** (id, shop_id, name, `campaign_type` check6, `trigger_kind` check4, status check5, **anchor_date** date null, primary_channels text[], blocked_reason, note, audit)
- **`campaign_step`** (id, campaign_id, shop_id, seq, `step_kind` check20, **offset_start_days/offset_end_days** int — relative to anchor, `audience_segment` check9, channel check5, goal_kpi, status check6, blocked_reason, unique(campaign_id,seq))
- **`step_artifact`** (id, step_id, shop_id, `artifact_type` check11, `owner_role` check7, source_doc, status check4[todo/draft/done/blocked], **is_dynamic** bool, **dynamic_source** check5, dynamic_ref, **discount_pct** numeric — แยก field ให้ CFO gate + silver_bar guard เช็คได้, note, audit)
- **`step_gate`** M:N (step_id, shop_id, `gate_kind` check5, status[pending/passed/blocked/na], passed_by/at, note, pk(step_id,gate_kind))

Enum values ยึด taxonomy §ENUMS ตรงๆ (ไม่เปลี่ยน semantics)

## Read: `v_campaign_board` (security_invoker, 1 row/step)
resolve: `resolved_start = anchor_date + offset_start_days`, `days_until`, `audience_live_count` (join v_rfm_segment by shop+segment), `artifacts` jsonb_agg, `gates` jsonb_agg, `art_done/art_total`

**`effective_status`** logic (comment ใน view ให้ชัด):
```
gate_blocked>0 or artifact_blocked>0                                    -> 'blocked'
audience_segment set & live_count=0 & data_driven                       -> 'waiting_data'
audience_segment in (silver_bar,tiktok_buyer,line_follower) & count=0   -> 'waiting_data'
else                                                                    -> step.status
```
→ winback auto-waiting, post_sale silver_bar auto-waiting, bundle blocked — **สะท้อนความจริง CMO อัตโนมัติ**

action `getCampaignBoard()` (`lib/actions/marketing.ts`, gate `requireOwnerAdmin()`) คืน rows; `CampaignBoard.tsx` จัดกลุ่มด้วย effectiveStatus เรียง daysUntil: "ต้องทำเร็วๆ นี้" / "รอข้อมูล-เงื่อนไข" (collapsible + blockedReason + gates) / "เสร็จแล้ว" วาง**เหนือ** RecoList ในหน้า copilot เดิม

## Rule enforcement
| rule | ที่ไหน |
|---|---|
| 1 เงินแท่งห้ามลด | RPC reject (segment=silver_bar + discount_pct not null); "คำว่าลด" = UI only |
| 2 CFO approval | RPC: advance→done reject ถ้ามี discount แต่ gate cfo_discount_approval≠passed |
| 3 quota ≤4/segment/4wk | view `v_segment_message_quota` + RPC warn (phase 2) |
| 4 PDPA | RPC: มี cta_button_flex/capture_consent ต้อง gate pdpa_consent passed |
| 5 unsub<2% | UI only (ไม่มี data source) |
| 6 LINE→Shopee | UI validation (ไม่คุ้มทำ DB check) |
| 7 bundle blocked | seed status=blocked, ปลดเมื่อกรอกต้นทุนจี้ |

## Dependencies — **ไม่มีตัวใดบล็อก MVP**
มีแล้ว: v_rfm_segment, v_promo_attribution_summary/auto, v_hero_stock. ยังไม่มี: silver_bar segment (→waiting_data), teaser-click log (→artifact is_dynamic resolve=null/manual, debt), unsub metric (UI-only), bundle cost (seed blocked), persona-auth (บล็อกแค่ phase 2 write ราย persona — MVP owner/admin toggle ไม่กระทบ). **ทุกตัวที่ขาด = model โชว์ waiting/blocked พร้อมเหตุผล = feature ไม่ใช่ bug**

## Phase
1. **MVP (0049 + seed 0050):** 4 ตาราง+RLS + `v_campaign_board` + seed 9.9 (5 steps/artifacts/gates map จาก taxonomy §ตัวอย่าง) + `getCampaignBoard()` + `CampaignBoard`. อ่านอย่างเดียว
2. **Write เบา:** RPC `campaign_set_artifact_status` / `campaign_pass_gate` / `campaign_advance_step` (บังคับ rule 1/2/4, security definer + crm_require_owner_admin) + resolve artifact-dynamic + quota view
3. **Template + persona auth:** `campaign_template_step/_artifact` + `create_from_template` (CMO seed campaign เอง) + copywriter login หลัง auth-hardening

## ความเสี่ยงตอน implement
- **channel enum ≠ dim_channel** — marketing channel (line_oa/tiktok_live) เป็น text enum แยก **อย่า FK ไป analytics.dim_channel** (นั่น sales channel)
- **denormalized shop_id** — write RPC derive จาก parent เสมอ (อย่ารับจาก client) กัน orphan cross-shop
- **effective_status 2 เงื่อนไข waiting_data** — comment ใน view ให้ชัด
- **auth debt:** owner_role ใน artifact (copywriter/cfo) = label ผู้รับผิดชอบ ไม่ใช่ auth role; app มีแค่ owner/admin/staff → phase 1/2 owner กดแทนทีม, persona login รอ 0046-0048
- seed hardcode shop_id — 3J shop เดียวปลอดภัย แต่ระบุให้ชัด

## เปิดคำถามก่อน implement
- seed 9.9 ใช้ `select id from public.shop order by created_at limit 1` หรือ pin DEV_SHOP_ID? → **Tech Lead ตอบ: ใช้ subquery `select id from public.shop ...` (idempotent, ไม่ผูก env) — ตรงกับ seed/verify อื่นในโปรเจกต์**

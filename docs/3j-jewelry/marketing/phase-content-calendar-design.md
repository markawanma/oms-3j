# Phase 1 — Content Calendar + Approve flow + Clip Brief (data model + API contract)

> architect (Yoda) · 2026-08-19 · เฟสวางแผน (ยังไม่ implement)
> อิง: `ux-content-calendar.md` (Padmé) · `campaign-tracking-taxonomy-v2.md` §5 (CMO) ·
> migrations `0027` / `0034` / `0049` / `0053` · มติเจ้าของ 4 ข้อ (ล็อคแล้ว)
> ส่งต่อ: backend-dev (migration 0057 + actions), frontend-dev (UI)

---

## 1. Decision สรุป

| # | คำถาม | ตัดสิน | เหตุผล / trade-off |
|---|---|---|---|
| D1 | calendar entry = อะไร | **`analytics.campaign_step` เป็นแกนเดียว** — งาน standalone = campaign ห่อบางๆ 1 แคมเปญ/1 งาน (`campaign_type='content_task'`, `trigger_kind='manual'`, `anchor_date`=วันงาน, 1 step `seq=1 offset=0`) | ทางเลือกที่ตัดทิ้ง: (ก) ตาราง `marketing_task` ใหม่ที่ FK ไป step ก็ได้/standalone ก็ได้ → ปฏิทินต้อง union 2 แหล่ง, ทุก RPC/UI แตก 2 สาย, ต้อง reimplement `effective_status`+gate+artifact ทั้งชุด = งานซ้ำกับ 0049 ทั้งดุ้น (ข) ย้ายทุกอย่างไป task table = ทิ้ง `v_campaign_board` ที่ใช้อยู่จริง<br>**ราคาที่จ่าย**: ตาราง `campaign` จะมีแถว "งานเดี่ยว" เยอะขึ้น และ `/marketing/copilot` (CampaignBoard) ต้อง filter `campaign_type <> 'content_task'` ออก (1 บรรทัด) |
| D2 | template ของ "งานโครง" เก็บที่ไหน | **ตารางอ้างอิง `analytics.campaign_template` 1 ตาราง, steps เป็น `jsonb`** (global, ไม่มี shop_id) | precedent เดิมของ repo: `campaign_calendar` (0034) จงใจเป็นตารางไม่ใช่ hardcode "เพื่อแก้ทีหลังได้โดยไม่ต้อง ship view ใหม่" · ตัดทิ้ง: template แตกเป็น 2 ตาราง (template + template_step) = join เพิ่มโดยไม่ได้อะไร เพราะไม่มีใคร query step ข้าม template<br>**ราคา**: ค่าใน jsonb ไม่มี CHECK — ผิดจะไประเบิดตอน INSERT ลง `campaign_step` (fail fast, rollback ทั้ง transaction) ยอมรับได้ |
| D3 | reco ไหนแปลงเป็นงานได้ | **ผูกด้วย data ไม่ใช่ code**: `campaign_template.rule_code` (unique, nullable) = "reco rule นี้อนุมัติแล้วกลายเป็น template นี้" เฟส 1 seed 2 แถว (`seasonal_calendar`, `winback_at_risk`) | เพิ่ม rule อื่นทีหลัง = insert template 1 แถว ไม่ต้องแก้โค้ด/ไม่ต้องแก้ `v_marketing_reco` (view นี้ถูก re-create มาแล้ว 2 รอบ อย่าแตะอีก) · reco ที่ไม่มี template → ปุ่มเป็น "รับทราบ" พฤติกรรมเดิม 100% |
| D4 | clip brief เก็บที่ไหน | **`step_artifact.clip_brief jsonb`** (ตาม UX) — **ไม่**สร้างตาราง `clip` ตอนนี้ | grain ต่างกันจริง ไม่ใช่งานซ้ำ: brief = *แผน* 1 ชิ้น/artifact (1 idea + 3 hooks + 2 executions + shot list) ส่วน `clip` ของ CMO §5 = *คลิปที่โพสต์จริง* 1 แถว/variant พร้อม metric ราย variant — เฟส 2 ตาราง `clip` เกิดได้โดย brief ยังอยู่ที่เดิม (clip อ้างกลับมาที่ artifact) ไม่ต้อง migrate ข้อมูล<br>**ราคา**: `content_idea` เฟส 2 อยากได้ `pillar/moat_asset` เป็นคอลัมน์ → ตอนนั้นต้อง backfill จาก `clip_brief->'meta'` (ไม่กี่สิบแถว) เผื่อทางไว้แล้วด้วย `meta.idea_code` |
| D5 | สถานะสคริปต์ AI (มติ #1/#2) | ขยาย `step_artifact.status` เป็น 6 ค่า: `todo / draft_pending_review / draft / approved / done / blocked` + คอลัมน์ provenance (`generated_by`, `generated_model`, `generated_at`, `human_edited`, `reviewed_by/at`) และ **ship RPC `campaign_ai_draft_artifact` เลยในเฟสนี้** | ตัดทิ้ง: ทำ status `edited` แยก → status ระเบิดเป็น 8 ค่าและยังตอบไม่ได้ว่า "แก้แล้วอนุมัติยัง" · `human_edited boolean` เก็บ provenance "AI ร่าง → คนแก้" ได้โดยไม่กิน state<br>RPC ให้ agent มี landing pad พร้อมใช้ (~20 บรรทัด) — ไม่ต้องเปิด migration รอบสอง |
| D6 | read path | **ไม่สร้าง view ใหม่** — ขยาย `v_campaign_board` เดิม (เพิ่ม field ใน artifact json + `step.title` + `campaign.source_reco_key`) | agenda/day/detail/month-dot ใช้ view เดียวกันหมด กรองด้วย `resolved_start` (PostgREST filter ได้) · month dot = group ฝั่ง client จาก rows ของเดือนนั้น (ข้อมูลหลักสิบแถว ไม่ต้องมี view นับ) |

---

## 2. DDL ร่าง — `supabase/migrations/0057_content_calendar.sql`

> ทั้งไฟล์เป็น additive: ALTER + ตารางใหม่ 1 ตัว + RPC ใหม่ + `create or replace view`

**2.1 ขยาย CHECK เดิม (drop + add constraint, ไม่มี data migration)**

```
campaign.campaign_type   += 'content_task'
campaign.trigger_kind    += 'manual'
step_artifact.status     += 'draft_pending_review', 'approved'    -- คง 4 ค่าเดิมไว้ครบ
```

⚠️ `campaign_set_artifact_status` (0049) hardcode 4 ค่าไว้ใน plpgsql → ต้อง `create or replace` ด้วย (signature เดิม ไม่ต้อง drop)

**2.2 คอลัมน์ใหม่**

```
analytics.campaign
  + source_reco_key text            -- reco_key ที่สร้างแคมเปญนี้ (idempotency + cross-link กลับ Ad Copilot)
  create unique index uq_campaign_shop_reco
    on analytics.campaign (shop_id, source_reco_key) where source_reco_key is not null;
  create index idx_campaign_shop_anchor on analytics.campaign (shop_id, anchor_date);

analytics.campaign_step
  + title text                      -- ชื่อที่คนตั้งเอง; null = ใช้ STEP_KIND_LABEL เหมือนเดิม

analytics.step_artifact
  + clip_brief      jsonb
  + generated_by    text not null default 'human'
                    check (generated_by in ('human','ai_copywriter','template_seed'))
  + generated_model text
  + generated_at    timestamptz
  + human_edited    boolean not null default false
  + reviewed_by     uuid references auth.users (id) on delete set null
  + reviewed_at     timestamptz
  -- CHECK ตื้นระดับ shape (ลึกกว่านี้ validate ใน RPC):
  check (clip_brief is null or (
    jsonb_typeof(clip_brief) = 'object'
    and coalesce(jsonb_typeof(clip_brief->'segments'), 'array') = 'array'
    and coalesce(jsonb_typeof(clip_brief->'shots'), 'array') = 'array'))
  check (clip_brief is null or artifact_type in ('short_form_clip','live_highlight_clip'))
```

**2.3 ตารางใหม่ `analytics.campaign_template`** — global reference (pattern เดียวกับ `campaign_calendar` 0034: ไม่มี shop_id, RLS policy `read_all` ให้ authenticated/service_role, **ไม่มี write policy** → เขียนได้เฉพาะ service role / migration)

```
code             text primary key          -- 'promo_event_5step'
name_th          text not null
campaign_type    text not null             -- ต้องผ่าน CHECK ของ analytics.campaign
trigger_kind     text not null
primary_channels text[]
rule_code        text unique               -- null = ใช้ manual เท่านั้น | 'seasonal_calendar' | 'winback_at_risk'
anchor_semantics text not null check (anchor_semantics in ('event_date','start_date'))
steps            jsonb not null            -- [{seq, step_kind, offset_start_days, offset_end_days?,
                                           --   audience_segment?, channel?, goal_kpi?,
                                           --   artifacts:[{artifact_type, owner_role}], gates:[gate_kind]}]
is_active        boolean not null default true
```

Seed เฟส 1 (2 แถว):

- `promo_event_5step` · rule_code=`seasonal_calendar` · anchor=`event_date` · 5 step ตาม 0050 (teaser −7…−4 / vip_private_access −3…−1 / main_day 0 / last_call +1 / post_sale +2…+5)
- `winback_3step` · rule_code=`winback_at_risk` · anchor=`start_date` · reconnect 0 / segment_offer +3 / followup_nudge +7 · `audience_segment='at_risk'`, `channel='line_oa'`

**RLS ของสิ่งที่ ALTER**: สืบทอด policy เดิมจาก 0049 ทั้งหมด — ยังไม่ grant INSERT/UPDATE ให้ `authenticated` (เหมือนเดิม) ทางเขียนเดียวคือ RPC `security definer`

---

## 3. Write RPC contracts

ทุกตัว: `security definer` · `set search_path = public, analytics, extensions, pg_temp` · เรียก `analytics.crm_require_owner_admin(v_shop_id)` เป็นด่านแรกหลังหา shop_id ได้ · `revoke execute from public, anon, authenticated` แล้ว `grant execute to authenticated, service_role` (แบบเดียวกับ 0049)

| # | signature | ทำอะไร / guard สำคัญ |
|---|---|---|
| R1 | `campaign_create_from_template(p_shop_id uuid, p_template_code text, p_anchor_date date, p_reco_key text default null, p_name_override text default null) returns uuid` | สร้าง campaign + steps + artifacts + gates จาก template ใน transaction เดียว · step.status=`scheduled`, artifact.status=`todo`, `generated_by='template_seed'` · **idempotent**: มี campaign ที่ `(shop_id, source_reco_key)` ตรงอยู่แล้ว → return id เดิม ไม่สร้างซ้ำ (กันกดรัว/retry) · guard: template ต้อง `is_active`, `p_anchor_date` ห้าม null |
| R2 | `campaign_create_task(p_shop_id uuid, p_title text, p_date date, p_artifact_type text default null, p_campaign_id uuid default null, p_step_kind text default null) returns uuid` (step_id) | manual add · `p_campaign_id is null` → สร้าง campaign ห่อ (`content_task`/`manual`, name=p_title, anchor=p_date) + 1 step seq=1 offset 0 · ไม่ null → append step `seq = max(seq)+1`, `offset_start_days = p_date - campaign.anchor_date` (raise ถ้า anchor_date null) · ส่ง `p_artifact_type` มา → insert artifact 1 ตัว status `todo` · guard: `trim(p_title) <> ''` |
| R3 | `campaign_reschedule_step(p_step_id uuid, p_new_date date) returns void` | แคมเปญเป็น `content_task` + มี step เดียว → ขยับ `campaign.anchor_date` · กรณีอื่น → ขยับ `offset_start_days` (และ `offset_end_days` เท่าเดลต้าเดียวกัน เพื่อรักษาความยาวช่วง) **เฉพาะ step นั้น ไม่ลากพี่น้องไปด้วย** |
| R4 | `campaign_set_artifact_content(p_artifact_id uuid, p_content_body text default null, p_clip_brief jsonb default null) returns void` | คนแก้เนื้อหา · เขียนเฉพาะพารามิเตอร์ที่ไม่ null (ส่ง null = ไม่แตะคอลัมน์นั้น) · set `human_edited=true`, `updated_by=auth.uid()` · status ปัจจุบัน=`todo` → เลื่อนเป็น `draft` (status อื่นไม่แตะ — การอนุมัติต้องกดเอง) · validate clip_brief: เป็น object, `segments[].role ∈ (hook,body,close)`, `shots[]` ทุกตัวมี `id`+`desc`+`done` |
| R5 | `campaign_ai_draft_artifact(p_artifact_id uuid, p_content_body text, p_clip_brief jsonb, p_model text) returns void` | ทางเข้าของ copywriter agent (เฟสหน้าใช้เต็ม) · set `generated_by='ai_copywriter'`, `generated_model`, `generated_at=now()`, `status='draft_pending_review'` · **ปฏิเสธเมื่อ `human_edited=true`** (ห้าม AI ทับงานที่คนแก้ไปแล้ว) |
| R6 | `campaign_toggle_clip_shot(p_artifact_id uuid, p_shot_id text, p_done boolean) returns void` | ติ๊กช็อตทีละอันด้วย `jsonb_set` เจาะ index ที่ `id` ตรง — ไม่เขียนทับทั้งก้อน (กัน lost update ตอนติ๊กรัวๆ) · raise ถ้าไม่พบ shot_id |
| R7 | `campaign_set_artifact_status(p_artifact_id uuid, p_status text)` **(replace ของ 0049)** | เพิ่ม 2 ค่าใหม่ใน whitelist · `p_status='approved'` → set `reviewed_by=auth.uid(), reviewed_at=now()` · คงกฎเดิม: step `audience_segment='silver_bar'` + `discount_pct` ไม่ null → raise 22023 |
| R8 | `campaign_delete_step(p_step_id uuid) returns void` | ลบงานที่พิมพ์ผิด · **guard: เฉพาะแคมเปญ `trigger_kind='manual'`** (งานที่มาจาก template ห้ามลบในเฟสนี้) · ถ้าเป็น step สุดท้ายของแคมเปญ `content_task` → ลบ campaign ทิ้งด้วย ไม่ให้เหลือซาก |

Server actions อยู่ไฟล์ใหม่ `lib/actions/calendar.ts` (`marketing.ts` 818 บรรทัดแล้ว) — ทุกตัวเรียก `requireOwnerAdmin()` แบบเดิมก่อน แล้ว `revalidatePath("/marketing/calendar")` (R1/R7 เพิ่ม `/marketing/copilot`)

---

## 4. Read path

| หน้า | query | หมายเหตุ |
|---|---|---|
| ปฏิทิน (agenda + date strip + month overlay) | `getCalendarTasks(from, to)` → `v_campaign_board` `.eq(shop_id)` `.gte(resolved_start, from)` `.lte(resolved_start, to)` `.order(resolved_start)` | ดึงทั้งเดือนรอบเดียว → dot/count ต่อวัน + agenda ของวันที่เลือก group ฝั่ง client (ไม่ต้องมี view นับวัน) · แถวที่ `anchor_date is null` → `resolved_start` null → ไม่ขึ้นปฏิทินโดยธรรมชาติ (RPC ทุกตัวบังคับใส่ anchor_date อยู่แล้ว) |
| รายละเอียดงาน `/marketing/calendar/[stepId]` | `getCalendarTask(stepId)` → `v_campaign_board` `.eq(step_id)` `.maybeSingle()` | ครบในแถวเดียว: campaign_name / resolved_start / effective_status / artifacts[] (มี `content_body` + `clip_brief` + provenance) / gates[] · ไม่พบ → 404 |
| แท็บ "เทศกาลทั้งปี" | `getCampaignCalendar()` ของเดิม | ไม่แตะเลย |
| Ad Copilot (RecoList) | เพิ่ม `getCampaignTemplates()` (อ่าน `campaign_template` where `is_active`) | frontend map `rule_code → template` เพื่อรู้ว่า reco ใบไหนโชว์ dialog "เลือกวันเริ่ม" ใบไหนแค่ "รับทราบ" |
| CampaignBoard เดิม | เพิ่ม filter `campaign_type <> 'content_task'` | กันงานเดี่ยวไปรกบอร์ดแคมเปญ |

`v_campaign_board` ที่ต้อง re-create: เพิ่ม `cs.title`, `cp.source_reco_key` และใน `jsonb_build_object` ของ artifact เพิ่ม `clip_brief, generated_by, generated_model, human_edited, reviewed_at` — **ชื่อ/ชนิด/ลำดับคอลัมน์เดิมห้ามเปลี่ยน** (`create or replace view` จึงถูกกฎ และ grant เดิมคงอยู่)

---

## 5. `clip_brief` jsonb schema (v1) — สัญญากลาง frontend ↔ AI agent

```jsonc
{
  "v": 1,
  "idea": "เงินแท้ 925 ไม่แพ้ผิว vs เครื่องประดับชุบ",
  "hooks": [ { "id": "h1", "line": "...", "hook_type": "curiosity" } ],      // 0-3 ตัว
  "chosen_hook_id": "h1",                                                     // null จนกว่าจะเลือก (ห้าม default h1)
  "segments": [                                                               // 3 แถวคงที่ เรียง hook → body → close
    { "role": "hook",  "line": "พูดอะไร",   "duration_sec": 3,  "shot": "โคลสอัพตรา 925" },
    { "role": "body",  "line": "...",       "duration_sec": 20, "shot": "..." },
    { "role": "close", "line": "... + CTA", "duration_sec": 7,  "shot": "..." }
  ],
  "executions": [ { "id": "e1", "label": "ตัดเน้นสินค้า" }, { "id": "e2", "label": "ตัดเน้นคนพูด" } ],
  "chosen_execution_id": null,
  "shots": [ { "id": "s1", "desc": "ตาชั่งดิจิทัลชั่งแท่ง", "done": false, "ref_role": "body" } ],
  "cta": { "type": "comment_keyword", "code": null, "label": "พิมพ์คำว่า แท่ง" },
  "meta": {
    "hook_type": "curiosity",
    "pillar": "knowledge",             // knowledge|entertain|product|story|proof|promo (CMO §5)
    "moat_asset": "silver_bar_nfc",    // craftsman|factory|silver_bar_nfc|live_price|stamp_925|customer_proof|none
    "funnel_stage": "awareness",       // awareness|interest|consideration|purchase|repeat
    "primary_metric": "3s_retention",
    "linked_sku_ids": [],
    "idea_code": null,                 // จองไว้ให้ content_idea.idea_code เฟส 2
    "ai_generated": false,
    "ai_model": null,
    "reviewed_by": null,
    "reviewed_at": null,
    "capcut": { "aspect": "9:16", "target_duration_sec": 30 }   // จองไว้ ยังไม่มีใครอ่าน
  }
}
```

กติกาที่ผูกมัดทั้ง frontend และ AI:

- **`id` ทุกตัวเป็น string ถาวร** (frontend gen ตอนสร้าง เช่น `s1`,`s2`) — ห้ามอ้าง shot ด้วย array index เพราะลบ/เพิ่มแล้วเลื่อน (R6 หา shot จาก `id`)
- `cta.type ∈ comment_keyword | add_line | cart_link | live_reminder | follow | dm | none` (ตรง CMO §5) · `cta.code` วันนี้เป็น text อิสระ เฟส 2 จะยกเป็น FK ไป `campaign_code.code`
- field ที่ไม่มี **ละไว้ได้** — renderer ต้องทน missing key ทุกจุด (AI ร่างมาไม่ครบเป็นเรื่องปกติ)
- `v` ไว้ migrate ตอน schema เปลี่ยน — เพิ่ม field ใหม่ไม่ต้องขึ้น `v`, เปลี่ยนความหมาย field เดิมต้องขึ้น
- TS type + `emptyClipBrief()` + validator อยู่ที่ `lib/marketing/clip-brief.ts` แหล่งเดียว (ทั้ง server action และ UI import ตัวนี้ ห้ามนิยามซ้ำ)

---

## 6. Mapping reco → task

| rule_code | แปลงเป็นงาน? | template | default วันใน dialog | ปุ่ม |
|---|---|---|---|---|
| `seasonal_calendar` | ✅ | `promo_event_5step` | `detail.date` (วันอีเวนต์ = anchor) | "อนุมัติ → สร้างแผน" |
| `winback_at_risk` | ✅ | `winback_3step` | วันนี้ | "อนุมัติ → สร้างแผน" |
| `live_targeting_brief` | ⏸ ยังไม่ (ตัวถัดไปที่ควรเพิ่ม — insert template 1 แถว จบ ไม่ต้องแก้โค้ด) | — | — | "รับทราบ" |
| `geo_focus` / `cac_vs_aov` / `spend_missing` | ❌ ad-tuning ล้วน ไม่มีงานให้ทำในปฏิทิน | — | — | "รับทราบ" |
| `roas_drop` / `lookalike_seed` | ❌ (is_blocked อยู่แล้ว) | — | — | badge เดิม |

Flow ตามมติเจ้าของ #1: กด "อนุมัติ" → dialog เลือกวันเริ่ม (prefill ตามตาราง) → ยืนยัน → `campaign_create_from_template(..., p_reco_key=recoKey)` → **สำเร็จแล้วค่อย** `decideReco(approved)` (ลำดับนี้ห้ามสลับ — สร้างพังแล้ว reco ต้องยัง pending ตาม UX §1A) → toast + ลิงก์ "ดูในปฏิทิน" ไป `/marketing/calendar?d=<anchor_date>` · reco ที่ approve ไปแล้วหางานเดิมเจอผ่าน `campaign.source_reco_key`

---

## 7. จงใจเลื่อนไปเฟส 2 + จุดเชื่อมที่เผื่อไว้

| ของเฟส 2 (taxonomy §4/§5) | เผื่อทางไว้ยังไง (วันนี้ยังไม่มีโค้ดอ่านทั้งสิ้น) |
|---|---|
| `campaign.campaign_code` + `objective` + `attribution_*` + ตาราง `campaign_code` | **ห้ามใช้ชื่อคอลัมน์ `code` บน `campaign` เด็ดขาด** — เฟสนี้ใช้ `source_reco_key` เท่านั้น ชื่อ `campaign_code` ยังว่างสนิท |
| ตาราง `live_session` + `fact_order.live_session_id` | ไม่แตะ `fact_order` เลย · step_kind `live_session` (มีใน 0049 อยู่แล้ว) ต่อ FK ทีหลังได้ผ่านคอลัมน์ใหม่ ไม่ชนอะไร |
| `content_idea` / `clip` / `clip_metric_daily` | `clip_brief.meta.idea_code` + `meta.hook_type/pillar/moat_asset/funnel_stage/primary_metric` ใช้ vocabulary เดียวกับ CMO §5 เป๊ะ → backfill เข้าตารางได้ตรงๆ · **ไม่สร้างตารางชื่อ `clip` ตอนนี้** (ชื่อสงวนไว้) |
| CapCut agent | `segments[].duration_sec/shot` + `shots[]` + `meta.capcut` = payload ที่ export ให้ agent ได้เลย ไม่ต้อง ALTER schema ตอนนั้น |
| `mkt_upsert_ad_spend(p_campaign_id)` (CMO บอกทำก่อนตัวอื่น) | คนละไฟล์ ไม่ถูกบล็อกโดยเฟสนี้ — ทำขนานได้ |
| **ไม่ทำเลย** | drag-drop เลื่อนวัน · assignment หลายคน · month grid แก้ inline · แก้/ลบ step ที่มาจาก template (R8 กันไว้แล้ว) · clip metric ทุกชนิด · A/B ของ hook |

---

## 8. ลำดับ build

1. **M1 — migration `0057_content_calendar.sql`** (backend-dev): §2 ทั้งหมด → RPC R1–R8 → `create or replace view v_campaign_board` → ปิดท้ายด้วย `grant select on all tables in schema analytics to authenticated, service_role;` + `notify pgrst, 'reload schema';` · ⚠️ DO NOT APPLY — Tech Lead apply ผ่าน MCP ตาม convention ทุกไฟล์
2. **M2 — types + actions**: `lib/marketing/clip-brief.ts` (type + `emptyClipBrief()` + validator) → ต่อ `lib/marketing/campaign-types.ts` (status 6 ค่า + label ไทย + provenance field) → `lib/actions/calendar.ts` (`getCalendarTasks` / `getCalendarTask` / `getCampaignTemplates` / `createTaskFromReco` / `createManualTask` / `rescheduleTask` / `setArtifactContent` / `toggleClipShot` / `deleteTask`)
3. **M3 — UI ปฏิทิน**: `/marketing/calendar` เป็น 2 แท็บ (`CalendarPageTabs` + `SeasonalCalendarTab` = `CampaignCalendar` เดิมไม่แก้) → `DateStrip` + `DayAgenda` + `AgendaTaskCard` → `AddPlanForm` (R2)
4. **M4 — หน้า detail**: `/marketing/calendar/[stepId]` → reuse checklist/gate จาก `CampaignBoard` → `ClipBriefPanel` (accordion, ติ๊ก shot ผ่าน R6, แก้เนื้อหาผ่าน R4, badge "AI ร่าง รอตรวจ" เมื่อ `status='draft_pending_review'`)
5. **M5 — ต่อ Ad Copilot**: `ApproveRecoConfirmSheet` + ลำดับ create→decide ตาม §6 + filter `content_task` ออกจาก CampaignBoard
6. **M6 — verify**: security-auditor (guard ของทุก RPC + RLS + jsonb ที่รับจาก client) ขนานกับ qa-tester (สร้าง/เลื่อน/ติ๊ก/ลบ + อนุมัติ reco ซ้ำต้องไม่สร้างงานซ้ำ) → code-reviewer

### ความเสี่ยงที่ต้องระวังตอน implement

- `create or replace view v_campaign_board` **ล้มทันที**ถ้าเผลอสลับลำดับ/เปลี่ยนชนิดคอลัมน์เดิม — เพิ่มได้เฉพาะ **ท้ายรายการ** กับ key ภายใน jsonb เท่านั้น
- แก้ CHECK constraint ต้อง `drop constraint` ด้วยชื่อจริงที่ Postgres auto-gen จาก 0049 — ให้ backend-dev query `pg_constraint` ยืนยันชื่อก่อนเขียน **ห้ามเดาชื่อ**
- `campaign_set_artifact_status` ถูกเรียกจาก UI ที่ใช้งานจริงอยู่ (`CampaignBoard`) — replace แล้วต้อง smoke test บอร์ด 9.9 ว่ายังติ๊กเสร็จได้ และ error 22023 (silver_bar) ยังเด้งข้อความไทยเดิม
- ยังไม่มี auth จริง: `getServiceClient()` bypass RLS ทุกอันและ `crm_require_owner_admin` short-circuit ให้ service_role → **`requireOwnerAdmin()` ใน server action คือด่านเดียวที่ทำงานจริงวันนี้** ห้ามลืมใส่ในทุก action ใหม่
- `winback_3step` ใช้ `trigger_kind='data_driven'` → `v_campaign_board` จะขึ้น `waiting_data` เองถ้า at_risk = 0 (ตอนนี้ 1,045 คน ปกติ) — อย่าไปแก้ effective_status ให้ต่างจากบอร์ดเดิม จะได้เห็นสถานะชุดเดียวกันทั้งสองหน้า
- ปฏิทินกรองด้วย `resolved_start` ซึ่งเป็น expression (`anchor_date + offset`) index ตรงๆ ไม่ได้ — วันนี้ข้อมูลหลักสิบแถว seq scan ไม่มีปัญหา ถ้าโตถึงหลักหมื่น step ค่อยเพิ่ม generated column + index (บันทึกเป็น technical debt ไว้ตรงนี้)

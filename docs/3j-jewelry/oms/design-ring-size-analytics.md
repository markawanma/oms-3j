# Design: เก็บข้อมูลไซส์แหวนจาก `/ring-size` + หน้าสรุปเจ้าของ (`/marketing/ring-size`)

> architect (Yoda) · 25 ต.ค. 69 · design only — ยังไม่มีโค้ด/migration · อิงโค้ดจริงบน `origin/main` @ `4fced33`
> สเปคหน้า `/ring-size` ฉบับเดียว = `docs/3j-jewelry/oms/ux-ring-size-build.md` · pattern ที่ลอก = gem quiz (`docs/3j-jewelry/analytics/design-gem-quiz.md` §1.2/§2/§5 + migration 0154–0157)
> โจทย์เจ้าของ 24 ต.ค.: "อยากรู้ว่าส่วนใหญ่ไซส์อะไร วิธีวัดทำด้วยอะไร จากวงเดิมหรือไม่" + คนเลิกกลางทางที่ขั้นไหน + มาจากช่องทางไหน · มติ: เก็บทุกคน ไม่ระบุตัวตน

## 0. TL;DR

- **เก็บ 1 แถวต่อ "การเปิดเครื่องมือ 1 ครั้ง" (session)** ไม่ใช่ event log — client ส่ง snapshot ของ state ทุกครั้งที่ไปถึงขั้นใหม่/กดปุ่มสำคัญ · DB รวมแบบ monotonic (`greatest(stage)` · `OR` ธง · ค่าวัดล่าสุด) ⇒ ยิงซ้ำ/ลำดับสลับ/หลุดบางก้อน ไม่ทำให้ตัวเลขเพี้ยน และขนาดข้อมูลต่อ session มีเพดาน (กันสแปมโดยโครงสร้าง)
- **ไม่ระบุตัวตนจริง**: session id = `crypto.randomUUID()` ใน `sessionStorage` (ตายเมื่อปิดแท็บ) · ไม่มี IP/IP hash/UA/cookie/ชื่อ/เบอร์โทร/LINE ในสคีมา · "คนกลับมา" วัดจากธง `is_return` (มีค่าเทียบจอ/ผลเดิมใน localStorage ตอนเปิด) ไม่ใช่จาก device id
- **ช่องเขียนสาธารณะ** = route handler `POST /api/ring-size/event` (exempt exact path เหมือน `/api/gem-quiz/submit`) → RPC `analytics.ring_size_session_upsert` (service_role เท่านั้น · ตารางไม่มี INSERT grant ให้ใคร) · ไม่มี Server Action ใน graph ของ `app/(quiz)/`
- **ช่องทาง** `?src=` whitelist อยู่ใน lookup table `analytics.ring_size_src` (เพิ่มช่องทาง = insert แถว ไม่ต้องแก้ฟังก์ชัน — บทเรียน check constraint ของ gem quiz) · ค่าไม่รู้จัก = `direct`
- **ส่ง** ด้วย `navigator.sendBeacon` (fallback `fetch keepalive`) ล้มเงียบ ไม่ await · header ของ `/ring-size` ไม่ต้องเปลี่ยน (CSP มีแค่ `frame-ancestors`)
- **หน้าสรุป** `/marketing/ring-size` ข้าง gem quiz · owner/admin · ตัวเลขทุกตัวจาก RPC `analytics.ring_size_stats` (jsonb) · filter ช่วงวัน + ช่องทางใน RPC ตั้งแต่แรก
- **retention** ลบแถวอายุ > 365 วันด้วย pg_cron `[ต้องยืนยัน: 365 วัน]`
- 4 phase: migration 0193 → endpoint + exempt → client `track.ts` + ถ้อยคำ + เปิด flag → หน้าสรุป (UX ก่อน frontend)

## 1. ข้อเท็จจริงจากโค้ดจริง

| # | ข้อเท็จจริง | ที่มา | ผลต่อ design |
|---|---|---|---|
| F1 | `/ring-size` static (ไม่มี `force-dynamic`) ไม่มี network/DB | `app/(quiz)/ring-size/page.tsx` | ห้ามทำให้หลุด static (ห้าม `useSearchParams` / ห้าม token ต่อ render) |
| F2 | `TRACK_ENABLED=false` + คอมเมนต์ "ห้ามส่ง result_size" | `lib/ring-size/config.ts:120-124` · build spec §5 | มติเจ้าของ 24 ต.ค. กลับข้อนี้ ⇒ แก้ build spec §5 + คอมเมนต์ |
| F3 | `copy-guard.test.ts:229` ห้าม fetch/sendBeacon/XHR ใต้ ring-size · `:241` ห้าม supabase/lib/auth/process.env | เทสต์ | แก้ข้อ 229 เป็น allowlist path เป๊ะ `lib/ring-size/track.ts` · ข้อ 241 คงเดิม ⇒ route/validator ที่แตะ env อยู่นอก 2 โฟลเดอร์ |
| F4 | `no-camera-code.test.ts:86` graph หน้าลากได้แค่ `app/(quiz)/ring-size` · `lib/ring-size` · `lib/shop/line.ts` | เทสต์ | `track.ts` + schema อยู่ใน `lib/ring-size/` · ห้าม import `lib/gem-quiz/` หรือ `lib/supabase/` |
| F5 | `qa-regression.test.ts:50-80` differential matcher "ต่างจาก main เฉพาะ `/ring-size`" | เทสต์ | เพิ่ม exempt endpoint ⇒ ต้องแก้ baseline โดยตั้งใจ พร้อม must-NOT ใหม่ |
| F6 | gem quiz: same-origin + body ≤2KB + honeypot + HMAC token + allowlist + RPC ตรวจซ้ำ + circuit breaker · ตอบ 204 | `app/api/gem-quiz/submit/route.ts` · 0154 | ลอกทุกชั้น ยกเว้น token/honeypot (§5) |
| F7 | default privileges แจก ALL ให้ service_role ⇒ ต้อง revoke (0155) + MAINTAIN (0156) | 0154–0156 | 0193 revoke ชุดเดียวกันในไฟล์เดียว |
| F8 | matcher exempt exact: `api/gem-quiz/submit/?$` · `gem-quiz/?$` | `middleware.ts` · `lib/auth/exempt-path.ts` | เพิ่ม `api/ring-size/event/?$` · must-NOT: `/api/ring-size`, `/api/ring-size/`, `/api/ring-size/event/x`, `/api/ring-size-x`, `/api/ring-sizes/event` |
| F9 | header `/ring-size` 3 ตัว · `headers.test.ts` ล็อก | `next.config.mjs` | ไม่แก้ header · response ของ endpoint ตั้ง `Cache-Control: no-store` เอง |
| F10 | ปุ่ม LINE ใช้ `window.location.href` · เกมพลอย/ร้าน = `<a href>` | `LineCta.tsx` · `R6.tsx` | event ปุ่มยิงก่อน navigation แบบไม่ await ⇒ sendBeacon |
| F11 | gem quiz อ่าน `src` จาก `window.location.search` ใน client | `GemQuizClient.tsx` | ใช้วิธีเดียวกันใน `useEffect` |
| F12 | หน้าสรุป gem quiz: `force-dynamic` + staff → EmptyState · action `lib/actions/gem-quiz-stats.ts` · nav `lib/marketing/nav.ts` | โค้ดจริง | ลอก pattern ทั้งชุด |
| F13 | pg_cron pattern (0024 · 0146) | migrations | retention ใช้ pattern เดียวกัน |
| F14 | migration สูงสุด = `0192_gems_to_buy_g1b.sql` (branch g1b) | git | งานนี้ = **0193** · เช็คชนซ้ำตอนเขียนจริง |
| F15 | นโยบาย TikTok Shop ไทยห้ามลิงก์เว็บ/LINE (memory `tiktok-offplatform-policy`) | research 24 ต.ค. | ช่องแปะลิงก์จริง = LINE OA · Facebook · เว็บร้าน · รับ `tiktok`/`ig` ถ้าคนพิมพ์เอง แต่ไม่ทำลิงก์ให้ |

## 2. Data flow

```
ผู้ใช้เปิด /ring-size?src=line  (static HTML · ไม่มี token)
  │ useEffect: sid = sessionStorage["ringSize:sid:v1"] ?? randomUUID()
  │ src = whitelist(location.search) · in_app = bucket(UA) · is_return = มีค่าเทียบ/ผลเดิม
  ▼
RingSizeClient ──(ถึงขั้นใหม่ / กดปุ่มสำคัญ)──▶ lib/ring-size/track.ts :: track(snapshot)
                                               │ TRACK_ENABLED && !DNT · dedupe · sendBeacon ‖ fetch keepalive · ไม่ await · ไม่ throw
                                               ▼
POST /api/ring-size/event (route handler · exempt exact · service role)
  same-origin → 403 · body ≤ 1 KB → 413 · allowlist (lib/ring-size/track-schema.ts) → 400
  RPC analytics.ring_size_session_upsert → 22023=400 · P0001=429 เงียบ · อื่น=500 (log แค่ code) · สำเร็จ 204
                                               ▼
analytics.ring_size_session (1 แถว/sid · upsert monotonic) ◀── pg_cron ลบ > 365 วัน
                                               ▼
/marketing/ring-size (owner/admin · force-dynamic)
  lib/actions/ring-size-stats.ts → RPC analytics.ring_size_stats(shop, from, to, src|null) → jsonb
  components/domain/marketing/RingSizeStats.tsx (presentational · ไม่คิดเลข)
```

**ทำไม snapshot ไม่ใช่ event log**: คำถามเจ้าของทั้ง 5 ข้อ (เบอร์ · วิธี · เหรียญ/บัตร · ขั้นที่ไปถึง · ช่องทาง) ตอบได้จากสถานะสุดท้ายของ session · event log เปิดช่องให้ 1 session ยิงได้ไม่จำกัดแถว — YAGNI

## 3. Data model (คนเขียน migration ต้องผ่าน `3j-migration-traps` ครบ)

### 3.1 `analytics.ring_size_src` — lookup ช่องทาง
`code` text pk `check (code ~ '^[a-z][a-z0-9_]{0,15}$')` · `label_th` text not null · `sort_order` int default 100 · `is_active` boolean default true
seed: `direct` "เข้าตรง/ไม่ระบุ" · `line` "LINE OA" · `fb` "Facebook" · `web` "เว็บร้าน" · `tiktok` "TikTok (พิมพ์เอง)" · `ig` "Instagram" `[ต้องยืนยัน: รายการ/ป้าย]`
ไม่ใช้ check constraint แบบ `gem_quiz_response.src` เพราะเพิ่มช่องทางต้อง migration แก้ทุกครั้ง

### 3.2 `analytics.ring_size_session` — 1 แถว/session

| คอลัมน์ | ชนิด / check | ที่มา |
|---|---|---|
| `id` | uuid pk | client สุ่ม |
| `shop_id` | uuid not null → `public.shop` | `getDevShopId()` ฝั่ง route |
| `created_at` / `updated_at` | timestamptz default now() | วันไทยคิดตอนอ่าน |
| `src` | text not null default 'direct' | ไม่มีใน lookup active → `direct` · ตั้งครั้งเดียวตอน insert |
| `in_app` | text check in ('line','tiktok','fb','ig','browser','unknown') | client bucket จาก UA (ไม่ส่ง UA) |
| `is_return` | boolean not null | มีค่าเทียบ/ผลเดิมตอนเปิด |
| `max_stage` | smallint check 0..7 | `greatest(old,new)` |
| `ref` | text null check in ('card','coin') | ล่าสุดทับ |
| `method` | text null check in ('A','B') | ล่าสุดทับ |
| `circ_mm` | numeric(4,1) null check 20..120 | ค่าปัด 0.1 ของผลล่าสุด · ไม่ส่ง px/ppm/dpr ดิบ |
| `result_size` | smallint null check 30..90 | เบอร์หลังปัดตามวิธี (`circToRec`) |
| `between` | boolean null | เฉพาะวิธี B |
| `in_shop_range` | boolean null | **RPC คำนวณจาก result_size เทียบ 45–68 เอง ไม่เชื่อ client** |
| `measure_count` | smallint default 0 check <= 50 | +1 ทุก measure_done |
| `invalid_count` (G4) · `zoom_blocked` (G1) · `calib_warn` (G3) · `stale_recalib` (G5) | smallint/boolean | จุดที่คนติด |
| `cta_line` · `cta_share` · `cta_shop` · `cta_gem_quiz` | boolean default false | OR |
| `event_count` | smallint default 0 | +1 ทุก upsert · เกิน 40 → P0001 |

**ไม่มีคอลัมน์**: IP · IP hash · UA ดิบ · cookie/device id · ข้อความอิสระ · ชื่อ/เบอร์โทร/LINE — เขียนใน comment ของตาราง
**stage** (TS `as const` ชุดเดียว): `0 view` · `1 start` · `2 calib_pick` · `3 calib_adjust` · `4 calib_done` · `5 method_pick` · `6 measure` · `7 result (R6 หรือ G4)` — คนกลับมาข้ามขั้น กระโดด 1→5 ได้
index `(shop_id, created_at desc)` · RLS select-only · grant select service_role + revoke insert/update/delete/truncate/references/trigger/maintain ในไฟล์เดียว

### 3.3 RPC `analytics.ring_size_session_upsert(p_shop_id uuid, p_session_id uuid, p_snapshot jsonb) returns void`
security definer · search_path pin · execute service_role เท่านั้น (revoke public/anon/authenticated)
1. null check · `jsonb_typeof='object'` · key ≤ 20 · ทุก key ∈ allowlist · ชนิด/ช่วง (`not (x between a and b)` กัน NaN)
2. `src` ไม่อยู่ใน lookup active → `direct`
3. circuit breaker นับแถวใหม่ใน 10 นาทีต่อร้าน ≥ cap → P0001 · cap เสนอ 300 `[ต้องยืนยัน]`
4. `insert ... on conflict (id) do update` monotonic (`greatest` stage · coalesce ค่าล่าสุด · OR ธง · measure_count +1 เมื่อ stage 7 มี result) · `src` ไม่อยู่ใน set · `old.event_count >= 40` → P0001 · `old.shop_id <> p_shop_id` → 22023
5. `in_shop_range` จาก result_size เทียบค่าคงที่ 45/68 (อยู่ 2 ที่: `config.ts` + ฟังก์ชัน — comment ทั้งสองที่)
กับดัก #14 (CHECK ตรวจแถวที่เสนอ — check ทุกตัวยอม null) · #22 (`now()` คงที่ในทรานแซกชันทดสอบ)

### 3.4 RPC `analytics.ring_size_stats(p_shop_id uuid, p_from date, p_to date, p_src text) returns jsonb`
`crm_require_owner_admin` ด่านแรก · `p_from<=p_to` · ≤366 วัน · วันไทย inclusive · `p_src` null = ทุกช่องทาง ไม่งั้นต้องอยู่ใน lookup
คืน (รวมใน DB ไม่คืนแถวดิบ): `sessions` · `returning` · `by_src` · `by_in_app` · `funnel[k]` (max_stage ≥ k) · `abandon_at[k]` (max_stage = k, k<7) · `result_sizes[{size,count}]` · `size_summary{below_45,in_45_68,above_68,between_count,invalid_sessions}` · `circ_hist` (1 มม.) · `method{A,B}` · `ref{card,coin}` · `method_x_ref` · `cta{...}` + `measured` · `friction{...}` · `daily[{date,sessions,measured}]`
grant service_role เท่านั้น · jsonb (ไม่ชนเพดาน 1000 แถว PostgREST)

### 3.5 retention
`analytics.ring_size_retention_apply()` ลบ > 365 วัน + `cron.schedule('ring-size-retention-365d','45 3 * * *', ...)` ด้วย pattern unschedule-ใน-do-block ของ 0024 `[ต้องยืนยัน: 365 วัน]`

## 4. หน้า `/ring-size` — สิ่งที่เปลี่ยน

### 4.1 `lib/ring-size/track.ts` (ไฟล์เดียวที่มี network ใต้ ring-size)
`track(snapshot): void` sync ไม่ throw ไม่ await · ไม่ส่งเมื่อ `!TRACK_ENABLED` / SSR / DNT-GPC `[ต้องยืนยัน: เคารพ DNT]` · sid ใน `sessionStorage["ringSize:sid:v1"]` (เขียนไม่ได้ → ถือในหน่วยความจำ · ไม่มี `crypto.randomUUID` → ไม่ส่ง) · dedupe ต่อ stage/cta · measure_done throttle 1 วิ · sendBeacon(Blob JSON) → fallback fetch keepalive `.catch(()=>{})` · body ~300 ไบต์ · ห้าม import supabase/env/gem-quiz

### 4.2 `lib/ring-size/track-schema.ts` (pure · client + route ใช้ร่วม)
`RING_STAGES` / `RING_IN_APP` / `RING_CTA` as const · `parseRingTrackBody(raw)` หยิบทีละ field ไม่ spread · `src` regex เท่านั้น (whitelist จริงอยู่ DB) · `sid` UUID v4 เป๊ะ · `inAppBucket(ua)` (Line/ · BytedanceWebview|musical_ly|TikTok · FBAN|FBAV|FB_IAB · Instagram · อื่น=browser · ว่าง=unknown)

### 4.3 จุดเกาะใน `RingSizeClient.tsx`
mount หลัง loaded → stage 0 (src · in_app · is_return) · `start()` → 1 · เลือกเหรียญ/บัตร → 2→3 · `finishCalibration` → 4 + ref (+g3/g5) · `pickMethod` → 5 + method · เข้า R5A/R5B → 6 · `finishMeasure` สำเร็จ → 7 + circ/size/between/in_range · G4 → 7 + g4 (ไม่ส่ง circ/size) · G1 แสดง → g1 · R6 ปุ่ม LINE/แชร์/ร้าน/เกมพลอย → cta ยิงก่อน navigation · `viewLastResult` ไม่ส่ง stage 7

### 4.4 ถ้อยคำความเป็นส่วนตัว `[ต้องยืนยัน: ถ้อยคำ โดยเจ้าของ]` (ห้ามคำใน copy-guard FORBIDDEN)
- `COPY.r6.privacy` แทนทั้งประโยค: "เบอร์ของคุณเก็บไว้ในเครื่องนี้ · ร้านได้รับเฉพาะเบอร์ วิธีวัด และขั้นตอนที่ใช้ แบบไม่ระบุตัวตน (ไม่มีชื่อ เบอร์โทร หรือข้อมูลเครื่อง) เพื่อเตรียมไซส์ให้ครบ · ชื่อและข้อความถึงร้านส่งก็ต่อเมื่อคุณกด LINE เอง"
- `COPY.pick.privacyBody`: "...ไม่อ่านข้อมูลบัตร · จำค่าขนาดจอและผลล่าสุดไว้ในเครื่องของคุณ · ร้านเห็นเฉพาะสถิติแบบไม่ระบุตัวตน"
- `COPY.r0.privacy` คงเดิม
- เทสต์ copy-guard ใหม่: เมื่อ TRACK on ต้องไม่มี "จนกว่าคุณจะกดส่ง" ใน copy ที่ render
- 🔴 เปิด `TRACK_ENABLED` ใน PR เดียวกับ copy ใหม่เท่านั้น

### 4.5 ลิงก์ที่เจ้าของใช้แปะ
LINE OA → `https://app.3jthailand.com/ring-size?src=line` · Facebook → `?src=fb` · เว็บร้าน (Wix) → `?src=web` (ลิงก์ธรรมดา ห้าม iframe — XFO DENY) · TikTok → **ไม่ทำลิงก์** (นโยบาย) คนเข้าจาก TikTok จะเห็นเป็น `in_app=tiktok` · ก่อนแจกยังต้องมี OG image

## 5. Anti-spam — ตัดสิน
ทำ: same-origin · body ≤ 1 KB · allowlist TS + RPC · 1 แถว/sid + event_count ≤ 40 + monotonic · circuit breaker 300/10 นาที `[ต้องยืนยัน]` · เขียนทางเดียวผ่าน RPC
ไม่ทำ: HMAC token (ต้อง force-dynamic เสีย static ที่สำคัญกับ webview · บอทรอ 4 วิได้อยู่ดี · ข้อมูลไม่มีมูลค่าให้ปลอม) · honeypot (ไม่มีฟอร์ม) · IP hash รายวัน (เป็น pseudonymous id + ต้อง secret ใหม่ — Phase 4 ถ้าเห็นสแปมจริง)
ข้อมูลปลอม: ยิง sid ใหม่ได้ ≤ cap → histogram วันนั้นเพี้ยน ตรวจพบจากกราฟรายวัน · ยอมรับได้สำหรับเครื่องมือฟรีไม่มีรางวัล · ถ้าผูกโปรโมชันวันหน้า ต้องเพิ่ม token + IP hash ก่อน

## 6. หน้าสรุปเจ้าของ `/marketing/ring-size`
`app/(dashboard)/marketing/ring-size/page.tsx` force-dynamic · staff → EmptyState · searchParams from/to/src · default 30 วัน · `lib/actions/ring-size-stats.ts` ("use server" · requireOwnerAdmin) · `components/domain/marketing/RingSizeStats.tsx` presentational ใช้ component เดิม · "ข้อมูลยังน้อย" เมื่อ < 30 · nav `lib/marketing/nav.ts` เพิ่ม "ไซส์แหวน"
**ส่ง Padmé ออกแบบ (ux-ui ก่อน frontend)**: แถวสรุป (เปิด/วัดได้/กด LINE) · กราฟเบอร์ 45–68 + ต่ำกว่า/สูงกว่า + 3 อันดับ · แหวน vs กระดาษ × เหรียญ vs บัตร · funnel 8 ขั้นภาษาคน + "เลิกที่ขั้นนี้" · ช่องทาง src คู่ in_app · จุดเสียดทาน G1/G3/G4/G5/วัดซ้ำ · ก้ำกึ่ง + กระจาย มม. · ช่วงวันที่ + รายวัน · ข้อความ "ไม่ระบุตัวตน · เปิดใหม่ = นับใหม่"

## 7. PDPA / ความเป็นส่วนตัว
เก็บ: random session id (อายุแท็บ) · เวลา · ช่องทาง · ประเภท webview · เบอร์/มม. · วิธี · ธงขั้น/ปุ่ม — ไม่มีตัวระบุย้อนกลับถึงบุคคล/เครื่อง · ความเสี่ยงเชื่อมโยงที่เหลือ (จับคู่เวลาที่ลูกค้าทัก LINE) ลดด้วย: หน้าสรุปไม่แสดงแถวรายตัว/เวลาระดับนาที · ไม่มี export แถวดิบ · retention จำกัด · **ทีมไม่ตอบคำถามกฎหมายเอง** — ถ้าต้องการความมั่นใจเชิง PDPA ให้ปรึกษาที่ปรึกษากฎหมายด้วยสรุป §3.2

## 8. ไฟล์ที่ต้องสร้าง/แก้
- **P0 DB** (backend-dev): `supabase/migrations/0193_ring_size_analytics.sql` (lookup + seed · ตาราง + RLS + grant/revoke · 2 RPC · retention + cron · notify pgrst · LF) · `scripts/verify/verify-0193.sql` + ตารางแมปเคส→เทสต์ · หลัง apply `check-analytics-grants.sql`
- **P1 endpoint** (backend-dev · security): `app/api/ring-size/event/route.ts` · `lib/ring-size/track-schema.ts` + test · แก้ `middleware.ts` + `lib/auth/exempt-path.ts` + `exempt-path.test.ts` + `exempt-path.matcher.test.ts` + `lib/ring-size/qa-regression.test.ts` (baseline ตั้งใจ + must-NOT) · `route.test.ts`
- **P2 client** (frontend-dev · worktree): `lib/ring-size/track.ts` + test · แก้ `config.ts` (TRACK_ENABLED=true · endpoint · copy §4.4 · ลบคอมเมนต์ "ห้ามส่ง result_size") · `RingSizeClient.tsx` · `R6.tsx` · `LineCta.tsx` · `copy-guard.test.ts:229` allowlist path เป๊ะ · build spec §5/§7.1 · ไม่แตะ `next.config.mjs` / `(quiz)/layout.tsx`
- **P3 หน้าสรุป** (ux-ui → frontend/backend): action · page + loading · `RingSizeStats.tsx` · nav · docs (READING-LISTS + INDEX + memory)

## 9. เคสสำหรับ security / QA

### ต้องถูกปฏิเสธ
1. POST ข้าม origin → route 403
2. body > 1 KB (header โกหก/ไม่มี) → 413
3. ไม่ใช่ JSON / array / field นอก allowlist / ชนิดผิด / NaN-Infinity-1e9 / stage 99 / sid ไม่ใช่ UUID / src แปลก-ยาว / in_app นอกชุด → route 400 และหลุดไป RPC 22023
4. src ไม่อยู่ใน lookup → ไม่ปฏิเสธ แต่เก็บ `direct`
5. sid เดิม 100 ครั้ง → 1 แถว · event_count หยุด 40 → 429 เงียบ · ค่าที่ลดลงไม่ทับ
6. sid ใหม่ > cap ใน 10 นาที → 429 · แถวไม่เพิ่ม
7. sid ของแถวร้านอื่น → 22023
8. `in_range=true` แต่ size=80 → DB ได้ false
9. GET/PUT/DELETE → 405 · `/api/ring-size`, `/api/ring-size/event/x`, `/api/ring-size-x`, `/ring-sizes` → ยัง gate
10. anon/authenticated เรียก RPC / select ตาราง → 42501 · service_role INSERT ตรง → ปฏิเสธ
11. `ring_size_stats` โดย staff → ปฏิเสธ · วันผิด/ >366 / src นอก lookup → 22023
12. ไม่มี env DEV_SHOP_ID → 500 ไม่ echo · log แค่ code
13. diff ไม่มี IP/UA/cookie ถูกเก็บ · ไม่มีค่า LINE/URL/เบอร์ ที่แต่งใหม่

### ต้องไม่พัง
14. endpoint ล่ม/offline · TRACK ปิด · ไม่มี sendBeacon/fetch · sessionStorage throw → flow วัดครบ ไม่มี error บนจอ ไม่มี unhandled rejection
15. กด LINE/แชร์/เกมพลอย → navigate ทันที · beacon ถูกเรียกก่อน
16. หน้ายัง static (build ไม่มี ƒ ที่ /ring-size) · header 3 ตัวเดิม
17. gem-quiz/submit · /w/* · /shop matcher เดิม (differential)
18. `?src=line` → src=line · ไม่มี param → direct · TikTok webview → in_app=tiktok
19. คนกลับมา → is_return · stage กระโดด 1→5 · viewLastResult ไม่เพิ่ม measure_count
20. วัด 3 รอบ → 1 แถว measure_count=3 ค่าล่าสุด
21. copy เมื่อ TRACK on ไม่มี "จนกว่าคุณจะกดส่ง" · copy-guard เดิมผ่าน
22. stats: sum(abandon_at)+funnel[7]=sessions · วันไทย 00:00–07:00 ไม่เหลื่อม
23. retention 364 วันอยู่ · 366 หาย · cron job 1 แถว ไม่ซ้ำเมื่อ apply ซ้ำ
24. check-analytics-grants สะอาด
ระดับ QA: **L** · security ผ่านก่อน merge

## 10. Trade-offs (ทางที่ตัดทิ้ง)
Server Action จากหน้า (หน้า exempt gate) · event log หลายแถว (ไม่มีเพดาน) · localStorage device id (เป็น persistent id ขัดไม่ระบุตัวตน) · check constraint src · token/honeypot/IP hash (§5) · useSearchParams (หลุด static) · แก้ whitelist gem quiz (Q11 ตัดสินแล้ว) · aggregate table ก่อน purge (YAGNI)

## 11. ความเสี่ยงตอน implement
1. แก้ baseline `qa-regression.test.ts` ด้วยการผ่อน regex กว้าง = เปิด subtree — brief ต้องเขียน must-NOT ชัด
2. allowlist network ใน copy-guard ต้องเป็น path เป๊ะ ไม่ใช่ "ไฟล์ที่มีคำว่า track"
3. sendBeacon บน iOS อาจหลุดบางครั้ง → ตัวเลข cta เป็นขั้นต่ำ (บอกบนหน้าสรุป)
4. ลืม revoke default privileges → ต้องออก migration ซ้ำ
5. ช่วงร้าน 45/68 อยู่ 2 ที่ — เปลี่ยนต้องแก้คู่
6. ห้ามเปิด TRACK บน prod ก่อน copy ผ่าน
7. UA bucket อาจพลาด webview ใหม่ → ตกเป็น browser

## 12. ค่าที่ต้องมาจากเจ้าของ
| # | ค่า | ค่าเสนอ |
|---|---|---|
| O1 | ถ้อยคำความเป็นส่วนตัว §4.4 | ตามร่าง |
| O2 | ช่องทาง + ป้าย | direct/line/fb/web/tiktok/ig |
| O3 | retention | 365 วัน |
| O4 | cap circuit breaker /10 นาที (ขนาด LINE broadcast) | 300 |
| O5 | เคารพ DNT/GPC | เคารพ |
| O6 | เก็บ circ_mm | เก็บ (ปัด 0.1) |
| O7 | ลิงก์ปลายทางจริง + OG image ก่อนแจก | — |

## 13. ลำดับงาน
P0 migration 0193 + verify → P1 endpoint + exempt + เทสต์ (security) → P2 track.ts + จุดเกาะ + copy + เปิด flag (QA L) → P3 ux-ui หน้าสรุป → action + page → code-reviewer → devops (apply 0193 ก่อน deploy โค้ดที่เรียก RPC · ไม่มี env ใหม่) · P1 กับ P2 ขนานได้ใน worktree แยก (`qa-regression.test.ts` ให้ P1 ถือ)

### 12.1 มติเจ้าของ 25 ต.ค. 69 (ทับค่าเสนอ)
- **O1** ถ้อยคำ §4.4 ใช้ตามร่าง
- **O3 retention = 6 เดือน (180 วัน)** ไม่ใช่ 365 → cron ชื่อ `ring-size-retention-180d` · เทสต์ 179 วันอยู่ / 181 วันหาย
- **O4** LINE broadcast ไม่เกิน 1,000 คน → cap 300 แถวใหม่/10 นาที/ร้าน ใช้ได้
- **O5** เคารพ DNT/GPC (ไม่ส่ง)
- O2 / O6 ไม่ได้ถาม — ใช้ค่าเสนอ (ช่องทาง direct/line/fb/web/tiktok/ig · เก็บ circ_mm ปัด 0.1)

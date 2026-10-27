# Design: เก็บข้อมูลไซส์แหวนจาก `/ring-size` + หน้าสรุปเจ้าของ (`/marketing/ring-size`)

> architect (Yoda) · 25 ต.ค. 69 · **เขียนทับตามมติเจ้าของ + ผล code review/security รอบ r2 (27 ต.ค. 69)**
> **สถานะ: มีโค้ดแล้ว ยังไม่ apply** — P0 migration `0193` + `verify-0193` และ P1 endpoint `POST /api/ring-size/event` มีโค้ด/เทสต์แล้วบน branch `feature/ring-size-analytics` (+ `-r2`) · **ยังไม่ apply 0193 บน DB** · P2 client (`track.ts` + จุดเกาะ + copy) และ P3 หน้าสรุปยังไม่ทำ
> สเปคหน้า `/ring-size` ฉบับเดียว = `docs/3j-jewelry/oms/ux-ring-size-build.md` · pattern ที่ลอก = gem quiz (`docs/3j-jewelry/analytics/design-gem-quiz.md` §1.2/§2/§5 + migration 0154–0157)
> โจทย์เจ้าของ 24 ต.ค.: "อยากรู้ว่าส่วนใหญ่ไซส์อะไร วิธีวัดทำด้วยอะไร จากวงเดิมหรือไม่" + คนเลิกกลางทางที่ขั้นไหน · มติ: เก็บทุกคน ไม่ระบุตัวตน · **ไม่แยกช่องทาง `?src=`** (มติ 25 ต.ค. รอบสอง — §12.1)

## 0. TL;DR

- **เก็บ 1 แถวต่อ "การเปิดเครื่องมือ 1 ครั้ง" (session)** ไม่ใช่ event log — client ส่ง snapshot ของ state ทุกครั้งที่ไปถึงขั้นใหม่/กดปุ่มสำคัญ · DB รวมแบบ monotonic (`greatest(stage)` · `OR` ธง · ค่าวัดล่าสุด) ⇒ ยิงซ้ำ/ลำดับสลับ/หลุดบางก้อน ไม่ทำให้ตัวเลขเพี้ยน และขนาดข้อมูลต่อ session มีเพดาน (กันสแปมโดยโครงสร้าง)
- **ไม่ระบุตัวตนจริง**: session id = `crypto.randomUUID()` ใน `sessionStorage` (ตายเมื่อปิดแท็บ) · ไม่มี IP/IP hash/UA/cookie/ชื่อ/เบอร์โทร/LINE ในสคีมา · "คนกลับมา" วัดจากธง `is_return` (มีค่าเทียบจอ/ผลเดิมใน localStorage ตอนเปิด) ไม่ใช่จาก device id
- **ไม่มีช่องทาง (`src`)**: เห็นที่มาจาก `in_app` (bucket จาก user-agent: line/tiktok/fb/ig/browser/unknown) อย่างเดียว — ไม่มีตาราง lookup ช่องทาง · ไม่มีคอลัมน์ `src` · ไม่มี `p_src` · ส่ง key `src` มา = 400
- **ช่องเขียนสาธารณะ** = route handler `POST /api/ring-size/event` (exempt exact path เหมือน `/api/gem-quiz/submit`) → RPC `analytics.ring_size_session_upsert` (service_role เท่านั้น · ตารางไม่มี INSERT grant ให้ใคร · ตารางไม่มี RLS policy เลย = deny) · ไม่มี Server Action ใน graph ของ `app/(quiz)/`
- **สัญญา event (client ต้องทำตาม — security r2 S2/S3)**: `circ_mm` / `size` / `between` ส่งเฉพาะ event ที่ได้ผลวัด (`finishMeasure` สำเร็จ · stage 7) — ที่ stage อื่น = ถูกปฏิเสธ (400 ที่ route · 22023 ที่ RPC) · `g4` ส่งเฉพาะ event G4 · event CTA ไม่พก `size` (ตัวนับเพิ่ม "ทุกครั้งที่ค่าเหล่านี้โผล่" — ไม่ dedupe ให้)
- **นับต่อวิธีตามวิธีตอนเกิดเหตุ (security r2 S1)**: session ที่ใช้ 2 วิธีไม่นับผิดฝั่ง — `result_method` (วิธีของผลล่าสุด) · `invalid_a/b` · `measure_count_a/b` · `method_stats` ต่อวิธีอ่านจากคอลัมน์เหล่านี้
- **ส่ง** ด้วย `navigator.sendBeacon` (fallback `fetch keepalive`) ล้มเงียบ ไม่ await · เคารพ DNT/GPC (ไม่ส่ง) · header ของ `/ring-size` ไม่ต้องเปลี่ยน (CSP มีแค่ `frame-ancestors`)
- **หน้าสรุป** `/marketing/ring-size` ข้าง gem quiz · owner/admin · ตัวเลขทุกตัวจาก RPC `analytics.ring_size_stats(shop, from, to)` (jsonb) · **ช่วงวันต้อง 7–180 วันปฏิทิน**
- **retention 180 วัน** (6 เดือน) ด้วย pg_cron `ring-size-retention-180d`
- 4 phase: migration 0193 → endpoint + exempt → client `track.ts` + ถ้อยคำ + เปิด flag → หน้าสรุป (UX ก่อน frontend)

## 1. ข้อเท็จจริงจากโค้ดจริง

| # | ข้อเท็จจริง | ที่มา | ผลต่อ design |
|---|---|---|---|
| F1 | `/ring-size` static (ไม่มี `force-dynamic`) ไม่มี network/DB | `app/(quiz)/ring-size/page.tsx` | ห้ามทำให้หลุด static (ห้าม `useSearchParams` / ห้าม token ต่อ render) |
| F2 | `TRACK_ENABLED=false` + คอมเมนต์ "ห้ามส่ง result_size" | `lib/ring-size/config.ts:120-124` · build spec §5 | มติเจ้าของ 24 ต.ค. กลับข้อนี้ ⇒ แก้ build spec §5 + คอมเมนต์ (P2) |
| F3 | `copy-guard.test.ts:229` ห้าม fetch/sendBeacon/XHR ใต้ ring-size · `:241` ห้าม supabase/lib/auth/process.env | เทสต์ | แก้ข้อ 229 เป็น allowlist path เป๊ะ `lib/ring-size/track.ts` · ข้อ 241 คงเดิม ⇒ route/validator ที่แตะ env อยู่นอก 2 โฟลเดอร์ |
| F4 | `no-camera-code.test.ts:86` graph หน้าลากได้แค่ `app/(quiz)/ring-size` · `lib/ring-size` · `lib/shop/line.ts` | เทสต์ | `track.ts` + schema อยู่ใน `lib/ring-size/` · ห้าม import `lib/gem-quiz/` หรือ `lib/supabase/` |
| F5 | `qa-regression.test.ts` differential matcher "ต่างจาก main เฉพาะ `/ring-size` + endpoint" | เทสต์ | baseline ถูกแก้โดยตั้งใจแล้ว (P1) พร้อม must-NOT |
| F6 | gem quiz: same-origin + body ≤2KB + honeypot + HMAC token + allowlist + RPC ตรวจซ้ำ + circuit breaker · ตอบ 204 | `app/api/gem-quiz/submit/route.ts` · 0154 | ลอกทุกชั้น ยกเว้น token/honeypot (§5) |
| F7 | default privileges แจก ALL ให้ service_role ⇒ ต้อง revoke (0155) + MAINTAIN (0156) | 0154–0156 | 0193 revoke ชุดเดียวกันในไฟล์เดียว |
| F8 | matcher exempt exact: `api/gem-quiz/submit/?$` · `gem-quiz/?$` | `middleware.ts` · `lib/auth/exempt-path.ts` | เพิ่ม `api/ring-size/event/?$` · must-NOT: `/api/ring-size`, `/api/ring-size/`, `/api/ring-size/event/x`, `/api/ring-size-x`, `/api/ring-sizes/event` |
| F9 | header `/ring-size` 3 ตัว · `headers.test.ts` ล็อก | `next.config.mjs` | ไม่แก้ header · response ของ endpoint ตั้ง `Cache-Control: no-store` เอง |
| F10 | ปุ่ม LINE ใช้ `window.location.href` · เกมพลอย/ร้าน = `<a href>` | `LineCta.tsx` · `R6.tsx` | event ปุ่มยิงก่อน navigation แบบไม่ await ⇒ sendBeacon |
| F11 | ~~gem quiz อ่าน `src` จาก `window.location.search`~~ | `GemQuizClient.tsx` | **ไม่ใช้แล้ว** — ไม่แยกช่องทาง (§12.1) |
| F12 | หน้าสรุป gem quiz: `force-dynamic` + staff → EmptyState · action `lib/actions/gem-quiz-stats.ts` · nav `lib/marketing/nav.ts` | โค้ดจริง | ลอก pattern ทั้งชุด |
| F13 | pg_cron pattern (0024 · 0146) | migrations | retention ใช้ pattern เดียวกัน |
| F14 | main มีถึง 0191 · `0192_gems_to_buy_g1b.sql` อยู่ branch g1b (ยังไม่ merge) | git | งานนี้ = **0193** · เช็คชนซ้ำก่อน apply |
| F15 | นโยบาย TikTok Shop ไทยห้ามลิงก์เว็บ/LINE (memory `tiktok-offplatform-policy`) | research 24 ต.ค. | ไม่ทำลิงก์พิเศษให้ช่องทางใด (ไม่แยกช่องทางอยู่แล้ว) — คนเข้าจาก TikTok เห็นเป็น `in_app=tiktok` |
| F16 | `crm_require_owner_admin` **ข้ามการตรวจเมื่อ `auth.role() = 'service_role'`** | `analytics.crm_require_owner_admin` · `verify-0193` หัว T13 | action ที่เรียก stats ผ่าน service client ต้องเช็คสิทธิ์ในชั้นแอปเอง (§6) |

## 2. Data flow

```
ผู้ใช้เปิด /ring-size  (static HTML · ไม่มี token · ไม่อ่าน ?src=)
  │ useEffect: sid = sessionStorage["ringSize:sid:v1"] ?? randomUUID()
  │ in_app = bucket(UA) · is_return = มีค่าเทียบ/ผลเดิม
  ▼
RingSizeClient ──(ถึงขั้นใหม่ / กดปุ่มสำคัญ)──▶ lib/ring-size/track.ts :: track(snapshot)
                                               │ TRACK_ENABLED && !DNT/GPC · dedupe · sendBeacon ‖ fetch keepalive · ไม่ await · ไม่ throw
                                               ▼
POST /api/ring-size/event (route handler · exempt exact · service role)
  same-origin → 403 · body ≤ 1 KB (อ่านแบบ stream ตัดทันที) → 413 · UTF-8 เสีย/allowlist/สัญญา event (lib/ring-size/track-schema.ts) → 400
  RPC analytics.ring_size_session_upsert → 22023=400 · P0001=429 เงียบ · อื่น=500 (log แค่ code) · สำเร็จ 204
                                               ▼
analytics.ring_size_session (1 แถว/sid · upsert monotonic) ◀── pg_cron ลบ > 180 วัน
                                               ▼
/marketing/ring-size (owner/admin · force-dynamic)
  lib/actions/ring-size-stats.ts → requireOwnerAdmin() ในชั้นแอป (F16) → RPC analytics.ring_size_stats(shop, from, to) → jsonb
  components/domain/marketing/RingSizeStats.tsx (presentational · ไม่คิดเลข)
```

**ทำไม snapshot ไม่ใช่ event log**: คำถามเจ้าของ (เบอร์ · วิธี · เหรียญ/บัตร · ขั้นที่ไปถึง · ที่มาตาม in_app) ตอบได้จากสถานะสุดท้ายของ session · event log เปิดช่องให้ 1 session ยิงได้ไม่จำกัดแถว — YAGNI

## 3. Data model (คนเขียน migration ต้องผ่าน `3j-migration-traps` ครบ)

### 3.1 ช่องทาง (`src`) — ตัดออก
มติเจ้าของ 25 ต.ค. 69 รอบสอง: "ยังไม่มีช่องทางเยอะ เก็บข้อมูลยาก" ⇒ **ไม่มี** ตาราง `ring_size_src` · คอลัมน์ `src` · `p_src` · `by_src` · `src_options` · client ไม่อ่าน `?src=` · endpoint ส่ง field `src` มา = key ไม่รู้จัก = 400 (allowlist เข้ม — ไม่ ignore เงียบ เพราะ client ที่ยังส่ง `src` แปลว่าโค้ดไม่ตรงสัญญา ควรเห็นทันทีตอนทดสอบ) · อยากเพิ่มช่องทางทีหลัง = migration ใหม่ (add column + lookup) ไม่เผื่อคอลัมน์ว่าง · verify-0193 T03 ล็อกว่าไม่มีคอลัมน์/ตารางนี้

### 3.2 `analytics.ring_size_session` — 1 แถว/session

| คอลัมน์ | ชนิด / check | ที่มา |
|---|---|---|
| `id` | uuid pk | client สุ่ม |
| `shop_id` | uuid not null → `public.shop` | `getDevShopId()` ฝั่ง route |
| `created_at` / `updated_at` | timestamptz default now() | วันไทยคิดตอนอ่าน |
| `in_app` | text check in ('line','tiktok','fb','ig','browser','unknown') | client bucket จาก UA (ไม่ส่ง UA) · เติมได้ครั้งเดียวจาก unknown |
| `is_return` | boolean not null | มีค่าเทียบ/ผลเดิมตอนเปิด · OR |
| `max_stage` | smallint check 0..7 | `greatest(old,new)` |
| `ref` | text null check in ('card','coin') | ล่าสุดทับ |
| `method` | text null check in ('A','B') | **วิธีที่เลือกล่าสุด** (ล่าสุดทับ) — ไม่ใช่ "เคยใช้วิธีไหน" |
| `circ_mm` | numeric(4,1) null check 20..120 | ค่าปัด 0.1 ของผลล่าสุด · ไม่ส่ง px/ppm/dpr ดิบ |
| `result_size` | smallint null check 30..90 | เบอร์หลังปัดตามวิธี (`circToRec`) |
| `is_between` | boolean null | เฉพาะวิธี B (ผลล่าสุด) — `between` เป็นคำสงวน SQL |
| `result_method` | text null check in ('A','B') | **วิธีของผลล่าสุด** — ตั้งเมื่อ snapshot พกผล = วิธีตอนนั้น · ไม่เปลี่ยนเมื่อแค่สลับ `method` ทีหลัง |
| `in_shop_range` | boolean null | **RPC คำนวณจาก result_size เทียบ `ring_size_shop_range()` เอง ไม่เชื่อ client** |
| `measure_count` / `measure_count_a` / `measure_count_b` | smallint default 0 check <= 50 | +1 เมื่อ stage 7 มี size · แยก a/b ตามวิธีตอนนั้น |
| `invalid_count` / `invalid_a` / `invalid_b` | smallint · boolean | G4 รวม · G4 ตามวิธีตอนเกิด (OR) |
| `used_a` · `used_b` | boolean default false | เคยเข้าหน้าวัดของวิธีนั้น (stage ≥ 6 ขณะ method = นั้น) · OR |
| `saw_between` | boolean default false | เคยได้ผลก้ำกึ่งใน session นี้ · OR |
| `zoom_blocked` (G1) · `calib_warn` (G3) · `stale_recalib` (G5) | boolean | จุดที่คนติด · OR |
| `cta_line` · `cta_share` · `cta_shop` · `cta_gem_quiz` | boolean default false | OR |
| `event_count` | smallint default 0 | +1 ทุก upsert · เกิน 40 → P0001 |

รวม **31 คอลัมน์** (verify-0193 T01 ล็อกรายชื่อเป๊ะ — เพิ่มคอลัมน์ = เทสต์ล้ม ต้องทบทวนเรื่อง PDPA ก่อน)
**ไม่มีคอลัมน์**: IP · IP hash · UA ดิบ · cookie/device id · ข้อความอิสระ · ชื่อ/เบอร์โทร/LINE · src — เขียนใน comment ของตาราง
**stage** (TS `as const` ชุดเดียว): `0 view` · `1 start` · `2 calib_pick` · `3 calib_adjust` · `4 calib_done` · `5 method_pick` · `6 measure` · `7 result (R6 หรือ G4)` — คนกลับมาข้ามขั้น กระโดด 1→5 ได้
index `(shop_id, created_at desc)` · **RLS เปิดแต่ "ไม่มี policy"** (deny ทุก role ที่ไม่ bypass — security r2 L4: ทางอ่านทางเดียวคือ `ring_size_stats`) · grant select service_role + revoke insert/update/delete/truncate/references/trigger/maintain ในไฟล์เดียว

### 3.3 RPC `analytics.ring_size_session_upsert(p_shop_id uuid, p_session_id uuid, p_snapshot jsonb) returns void`
security definer · search_path pin · execute service_role เท่านั้น (revoke public/anon/authenticated) · **ไม่มี `p_src`**
1. null check · `jsonb_typeof='object'` · key ≤ 20 · ทุก key ∈ allowlist (`v_allowed` ⇔ `RING_SNAPSHOT_KEYS`) · ชนิด/ช่วง (`not (x between a and b)` กัน NaN)
2. **ผลวัดเฉพาะ stage 7 (S3)**: มี `circ_mm`/`size`/`between` แต่ `stage <> 7` → 22023
3. circuit breaker นับ "แถวใหม่" ใน 10 นาทีต่อร้าน ≥ 300 → P0001 (session ที่มีอยู่แล้วส่งต่อได้ตามปกติ)
4. อ่านแถวเดิมแบบ `for update` → ไม่มีค่อย `insert ... on conflict do nothing` (แพ้ race วนรอบ 2) · monotonic (`greatest` stage · ล่าสุดทับ ref/method · OR ธง · ผลวัดทับเป็นก้อน) · `old.event_count >= 40` → P0001 · `old.shop_id <> p_shop_id` → 22023
5. วิธีตอนนั้น = `method` ใน snapshot (ถ้ามี) ไม่งั้นของเดิม → ตั้ง `result_method` (เมื่อมีผล) · `invalid_a/b` (เมื่อ g4) · `measure_count_a/b` (เมื่อ stage 7 + size)
6. `in_shop_range` จาก result_size เทียบ `analytics.ring_size_shop_range()` — ค่าคงที่ 45–68 อยู่ 2 ที่ (`config.ts` + ฟังก์ชันนี้ — comment ทั้งสองที่ · track-schema.test เทียบให้)
กับดัก #14 (CHECK ตรวจแถวที่เสนอ — check ทุกตัวยอม null) · #22 (`now()` คงที่ในทรานแซกชันทดสอบ)

### 3.4 RPC `analytics.ring_size_stats(p_shop_id uuid, p_from date, p_to date) returns jsonb`
**ไม่มี `p_src`** · `crm_require_owner_admin` ด่านแรก (ก่อน validate — กัน probe) · `p_from <= p_to` · **7 วัน ≤ ช่วง ≤ 180 วันปฏิทิน** (`6 <= p_to - p_from <= 179` ไม่งั้น 22023 — ขั้นต่ำ 7 วันกันตัวเลขวันเดียวที่จับคู่กับเวลาลูกค้าทัก LINE ได้ง่าย · เพดาน 180 ตรง retention) · วันไทย inclusive
คืน (รวมใน DB ไม่คืนแถวดิบ): `sessions` · `returning` · `measured` (= มี result_size ไม่ใช่ funnel[7]) · `shop_range{min,max}` · `data_since` · `by_in_app` · `funnel[k]` (max_stage ≥ k) · `abandon_at[k]` (max_stage = k, k<7) · `result_sizes[{size,count}]` · `size_summary{below_range,in_range,above_range,between_count}` · `circ_hist` (1 มม.) · `method{A,B}` (วิธีล่าสุด) · **`method_stats{A,B}`** (ต่อวิธี: picked/measured/abandoned_at_measure/invalid_sessions/remeasured/between) · `switched{a_to_b,b_to_a,both}` · `saw_between` · `ref{card,coin}` · `method_x_ref` · `cta{...}` · `friction{zoom_blocked,calib_warn,invalid,stale_recalib,remeasured}` · `daily[{date,sessions,measured}]`
**ตัวที่ UI ใช้ (กันสับสนตัวซ้ำ)**: ต่อวิธี = `method_stats` เท่านั้น · รวมทุกวิธี = `measured` / `friction.invalid` / `friction.remeasured` / `saw_between` · `size_summary.between_count` = เฉพาะผลล่าสุดก้ำกึ่ง (UI หลักไม่ใช้) · `invalid_sessions` ถูกตัดออกจาก `size_summary` (ซ้ำ `friction.invalid`)
**invariant**: `sum(abandon_at) + funnel[7] = sessions` · `funnel[0] = sessions` · `sum(by_in_app) = sessions` · `sum(daily.sessions) = sessions` · funnel ไม่เพิ่มตามขั้น · **`measured <= funnel[7]`** (รวม 6 ข้อ — `pg_temp.inv` ใน verify-0193)
grant service_role เท่านั้น · jsonb (ไม่ชนเพดาน 1000 แถว PostgREST)

### 3.5 retention (มติเจ้าของ O3 = 6 เดือน)
`analytics.ring_size_retention_apply()` ลบ `created_at` เก่ากว่า **180 วัน** + `cron.schedule('ring-size-retention-180d','45 3 * * *', ...)` ด้วย pattern unschedule-ใน-do-block ของ 0024 · เทสต์: 179 วันอยู่ / 181 วันหาย / cron job 1 แถวไม่ซ้ำเมื่อ apply ซ้ำ

## 4. หน้า `/ring-size` — สิ่งที่เปลี่ยน (P2 — ยังไม่ทำ)

### 4.1 `lib/ring-size/track.ts` (ไฟล์เดียวที่มี network ใต้ ring-size)
`track(snapshot): void` sync ไม่ throw ไม่ await · ไม่ส่งเมื่อ `!TRACK_ENABLED` / SSR / **DNT-GPC (เคารพ — มติเจ้าของ O5)** · sid ใน `sessionStorage["ringSize:sid:v1"]` (เขียนไม่ได้ → ถือในหน่วยความจำ · ไม่มี `crypto.randomUUID` → ไม่ส่ง) · dedupe ต่อ stage/cta · measure_done throttle 1 วิ · sendBeacon(Blob JSON) → fallback fetch keepalive `.catch(()=>{})` · body ~300 ไบต์ · ห้าม import supabase/env/gem-quiz · **ต้องทำตามสัญญา event (§0)**

### 4.2 `lib/ring-size/track-schema.ts` (pure · client + route ใช้ร่วม) — มีแล้ว
`RING_STAGES` / `RING_IN_APP` / `RING_CTA` as const · `parseRingTrackBody(raw)` หยิบทีละ field ไม่ spread · **ไม่มี `src`** · `sid` UUID v4 เป๊ะ · ผลวัดผิด stage = ปฏิเสธ (`result_stage`) · `inAppBucket(ua)` (Line/ · BytedanceWebview|musical_ly|TikTok · FBAN|FBAV|FB_IAB · Instagram · อื่น=browser · ว่าง=unknown) · JSDoc ของ `RingTrackSnapshot` เขียนสัญญา event

### 4.3 จุดเกาะใน `RingSizeClient.tsx`
mount หลัง loaded → stage 0 (in_app · is_return) · `start()` → 1 · เลือกเหรียญ/บัตร → 2→3 · `finishCalibration` → 4 + ref (+g3/g5) · `pickMethod` → 5 + method · เข้า R5A/R5B → 6 (+ method) · `finishMeasure` สำเร็จ → **7 + circ/size/between/method** (in_range ส่งได้แต่ DB ทิ้ง) · G4 → **7 + g4 + method (ไม่ส่ง circ/size)** · G1 แสดง → g1 · R6 ปุ่ม LINE/แชร์/ร้าน/เกมพลอย → **cta (ไม่พกผล)** ยิงก่อน navigation · `viewLastResult` ไม่ส่ง stage 7 พร้อมผล

### 4.4 ถ้อยคำความเป็นส่วนตัว — **เจ้าของอนุมัติแล้ว** (ห้ามคำใน copy-guard FORBIDDEN)
- `COPY.r6.privacy` แทนทั้งประโยค: "เบอร์ของคุณเก็บไว้ในเครื่องนี้ · ร้านได้รับสถิติการใช้งานแบบไม่ระบุตัวตน เช่น เบอร์ที่วัดได้ วิธีวัด ปุ่มที่กด และประเภทแอปที่เปิด (เช่น LINE) · ร้านไม่เก็บชื่อ เบอร์โทร หรือรหัสเครื่อง และลบอัตโนมัติภายใน 6 เดือน"
- ข้อความอื่นของหน้า (`COPY.pick.privacyBody` ฯลฯ) ให้ frontend ปรับให้สอดคล้องกับประโยคข้างบน — ห้ามพูดเกินกว่าที่เก็บจริง (ไม่มีช่องทางลิงก์ · ไม่มีรหัสเครื่อง) · `COPY.r0.privacy` คงเดิม
- เทสต์ copy-guard ใหม่: เมื่อ TRACK on ต้องไม่มี "จนกว่าคุณจะกดส่ง" ใน copy ที่ render
- 🔴 เปิด `TRACK_ENABLED` ใน PR เดียวกับ copy ใหม่เท่านั้น

### 4.5 ลิงก์ที่เจ้าของใช้แปะ
ไม่มีลิงก์แยกช่องทาง — ใช้ลิงก์เดียว `https://app.3jthailand.com/ring-size` (ลิงก์ธรรมดา ห้าม iframe — XFO DENY) · ดูที่มาจาก `in_app` · TikTok → ไม่ทำลิงก์ (นโยบาย F15) · ก่อนแจกยังต้องมี OG image

## 5. Anti-spam — ตัดสิน + ความเสี่ยงที่เจ้าของยอมรับ
ทำ: same-origin · body ≤ 1 KB (อ่าน stream ตัดทันที · UTF-8 fatal) · allowlist TS + RPC · สัญญา event (ผลวัดเฉพาะ stage 7) · 1 แถว/sid + event_count ≤ 40 + monotonic · circuit breaker 300 แถวใหม่/10 นาที/ร้าน · เขียนทางเดียวผ่าน RPC
ไม่ทำ: HMAC token (ต้อง force-dynamic เสีย static ที่สำคัญกับ webview · บอทรอ 4 วิได้อยู่ดี · ข้อมูลไม่มีมูลค่าให้ปลอม) · honeypot (ไม่มีฟอร์ม) · **rate limit ต่อ IP** · IP hash รายวัน (เป็น pseudonymous id + ต้อง secret ใหม่)

🔴 **ความเสี่ยงที่เจ้าของยอมรับ (มติเจ้าของ — บันทึกรอบ r2 27 ต.ค. 69): "ยอมรับไปก่อน เฝ้าดู"**
1. **ไม่มี rate limit ต่อ IP** — ผู้โจมตีคนเดียวยิง sid ใหม่ได้จนชน breaker (300 แถว/10 นาที/ร้าน)
2. **breaker บล็อกข้อมูลคนจริงเมื่อโดนสแปม** — breaker นับรวมทั้งร้าน ไม่แยกคน ⇒ ระหว่างโดนสแปม session ใหม่ของลูกค้าจริงถูก 429 เงียบ (ข้อมูลช่วงนั้นหาย — เครื่องมือยังใช้ได้ปกติเพราะ client ล้มเงียบ) · histogram ช่วงที่โดนจะเพี้ยน ตรวจเห็นจากกราฟรายวัน
3. **แผนถ้าเห็น burst**: เปิด **Vercel Firewall** (rate limit ต่อ IP ที่ edge) บน path `/api/ring-size/event` — ไม่ต้องเก็บ IP ในแอป/DB (ยังไม่ระบุตัวตน) · ทริกเกอร์ = กราฟ `daily` มีวันที่ sessions พุ่งผิดปกติ หรือ log เห็น 429 (P0001) ถี่
4. ถ้าผูกโปรโมชัน/รางวัลกับเครื่องมือนี้วันหน้า ต้องเพิ่ม token + IP hash ก่อน (ข้อมูลกลายเป็นมีมูลค่าให้ปลอม)

## 6. หน้าสรุปเจ้าของ `/marketing/ring-size` (P3 — ยังไม่ทำ)
`app/(dashboard)/marketing/ring-size/page.tsx` force-dynamic · staff → EmptyState · searchParams from/to · default 30 วัน (ช่วงเลือก **7–180 วัน** — UI ต้องกันไม่ให้ส่งนอกช่วง) · `lib/actions/ring-size-stats.ts` ("use server") · `components/domain/marketing/RingSizeStats.tsx` presentational ใช้ component เดิม · "ข้อมูลยังน้อย" เมื่อ < 30 · nav `lib/marketing/nav.ts` เพิ่ม "ไซส์แหวน"

🔴 **ข้อบังคับ P3 (security)**: action ต้องเรียก **`requireOwnerAdmin()` ในชั้นแอปก่อนเรียก RPC stats ทุกครั้ง** — เพราะ `analytics.crm_require_owner_admin` **ข้ามการตรวจเมื่อ role เป็น `service_role`** (F16) และ action เรียกผ่าน service client ⇒ ด่านใน RPC ไม่ทำงานเลยในเส้นทางจริง · ด่านแอปคือด่านเดียวที่กัน staff
**เคส "ห้ามผ่าน"**: (1) staff เรียก action (ตรง ๆ / ผ่านฟอร์ม) ⇒ ปฏิเสธก่อนถึง RPC (เช็คว่า RPC ไม่ถูกเรียกเลย) (2) ผู้ใช้ไม่ล็อกอิน/ไม่ใช่สมาชิกร้าน ⇒ ปฏิเสธ (3) ช่วงวัน < 7 หรือ > 180 ⇒ ปฏิเสธที่ action ด้วย (ไม่พึ่ง 22023 อย่างเดียว) · **เคส "ต้องไม่พัง"**: owner/admin ที่ถูกต้องเรียกได้ · ช่วง 7 วัน และ 180 วันพอดี
**ส่ง Padmé ออกแบบ (ux-ui ก่อน frontend)**: แถวสรุป (เปิด/วัดได้/กด LINE) · กราฟเบอร์ (ช่วงร้านจาก `shop_range` ห้าม hardcode 45/68) + ต่ำกว่า/สูงกว่า + 3 อันดับ · แหวน vs กระดาษ (จาก `method_stats`) × เหรียญ vs บัตร · funnel 8 ขั้นภาษาคน + "เลิกที่ขั้นนี้" · ประเภทแอป (`by_in_app`) · จุดเสียดทาน G1/G3/G4/G5/วัดซ้ำ · ก้ำกึ่ง + กระจาย มม. · ช่วงวันที่ + รายวัน · ข้อความ "ไม่ระบุตัวตน · เปิดใหม่ = นับใหม่ · ตัวเลขปุ่มเป็นขั้นต่ำ (sendBeacon อาจหลุด)"

## 7. PDPA / ความเป็นส่วนตัว
เก็บ: random session id (อายุแท็บ) · เวลา · ประเภท webview · เบอร์/มม. · วิธี · ธงขั้น/ปุ่ม — ไม่มีตัวระบุย้อนกลับถึงบุคคล/เครื่อง · ความเสี่ยงเชื่อมโยงที่เหลือ (จับคู่เวลาที่ลูกค้าทัก LINE) ลดด้วย: หน้าสรุปไม่แสดงแถวรายตัว/เวลาระดับนาที · **ช่วงดูขั้นต่ำ 7 วัน** · ตารางไม่มี policy (ไม่เปิดแถวดิบทาง PostgREST) · ไม่มี export แถวดิบ · retention 180 วัน · **ทีมไม่ตอบคำถามกฎหมายเอง** — ถ้าต้องการความมั่นใจเชิง PDPA ให้ปรึกษาที่ปรึกษากฎหมายด้วยสรุป §3.2

## 8. ไฟล์ที่ต้องสร้าง/แก้
- **P0 DB** (backend-dev) ✅ มีโค้ด ยังไม่ apply: `supabase/migrations/0193_ring_size_analytics.sql` (ตาราง + RLS ไม่มี policy + grant/revoke · 2 RPC + shop_range · retention + cron · notify pgrst · LF) · `scripts/verify/verify-0193.sql` + ตารางแมปเคส→เทสต์ · หลัง apply `check-analytics-grants.sql`
- **P1 endpoint** (backend-dev · security) ✅ มีโค้ด: `app/api/ring-size/event/route.ts` · `lib/ring-size/track-schema.ts` + test · แก้ `middleware.ts` + `lib/auth/exempt-path.ts` + `exempt-path.test.ts` + `exempt-path.matcher.test.ts` + `lib/ring-size/qa-regression.test.ts` · `route.test.ts`
- **P2 client** (frontend-dev · worktree) ⏳: `lib/ring-size/track.ts` + test · แก้ `config.ts` (TRACK_ENABLED=true · endpoint · copy §4.4 · ลบคอมเมนต์ "ห้ามส่ง result_size") · `RingSizeClient.tsx` · `R6.tsx` · `LineCta.tsx` · `copy-guard.test.ts:229` allowlist path เป๊ะ · build spec §5/§7.1 · ไม่แตะ `next.config.mjs` / `(quiz)/layout.tsx`
- **P3 หน้าสรุป** (ux-ui → frontend/backend) ⏳: action (ข้อบังคับ §6) · page + loading · `RingSizeStats.tsx` · nav · memory

## 9. เคสสำหรับ security / QA

### ต้องถูกปฏิเสธ
1. POST ข้าม origin → route 403
2. body > 1 KB (header โกหก/ไม่มี/chunked/stream ไม่รู้จบ) → 413 และหยุดอ่าน · UTF-8 เสีย → 400
3. ไม่ใช่ JSON / array / field นอก allowlist / ชนิดผิด / NaN-Infinity-1e9 / stage 99 / sid ไม่ใช่ UUID / in_app นอกชุด → route 400 และหลุดไป RPC 22023
4. ~~src แปลก~~ → **ส่ง key `src` (หรือ `source`) มาเลย = 400 ที่ route และ 22023 ที่ RPC** (ไม่มี lookup ไม่มี fallback `direct`)
5. sid เดิม 100 ครั้ง → 1 แถว · event_count หยุด 40 → 429 เงียบ · ค่าที่ลดลงไม่ทับ
6. sid ใหม่ > cap ใน 10 นาที → 429 · แถวไม่เพิ่ม
7. sid ของแถวร้านอื่น → 22023
8. `in_range=true` แต่ size=80 → DB ได้ false (รวมมี mutant ที่ให้ RPC เชื่อ `in_range` ของ client ต้องถูกจับ — ทั้งทาง insert และ update)
9. GET/PUT/DELETE → 405 · `/api/ring-size`, `/api/ring-size/event/x`, `/api/ring-size-x`, `/ring-sizes` → ยัง gate
10. anon/authenticated เรียก RPC / select ตาราง → 42501 · service_role INSERT ตรง → ปฏิเสธ · ตารางต้องไม่มี policy
11. `ring_size_stats` โดย staff/ไม่ใช่สมาชิก → ปฏิเสธ · วันผิด / **ช่วง < 7 วัน (diff 5 ⇒ ปฏิเสธ · diff 6 ⇒ ผ่าน) / > 180 วัน (diff 179 ⇒ ผ่าน · diff 180 ⇒ ปฏิเสธ)** → 22023
12. ไม่มี env DEV_SHOP_ID → 500 ไม่ echo · log แค่ code
13. diff ไม่มี IP/UA/cookie ถูกเก็บ · ไม่มีค่า LINE/URL/เบอร์ ที่แต่งใหม่
14. **ผลวัด (`circ_mm`/`size`/`between`) ที่ stage ≠ 7 → 400 ที่ route · 22023 ที่ RPC** · invariant `measured <= funnel[7]`
15. **session ใช้ 2 วิธี ต้องนับตามวิธีตอนเกิดเหตุ**: วัด B ได้เบอร์ → เลือก A → เลิก = ผลนับเป็น B (`result_method`) · G4 ตกที่ `invalid_a/b` ตามวิธีตอนนั้น · `measure_count_a/b` แยกวิธี

### ต้องไม่พัง
16. endpoint ล่ม/offline · TRACK ปิด · ไม่มี sendBeacon/fetch · sessionStorage throw → flow วัดครบ ไม่มี error บนจอ ไม่มี unhandled rejection (P2)
17. กด LINE/แชร์/เกมพลอย → navigate ทันที · beacon ถูกเรียกก่อน (P2)
18. ~~`?src=line` → src=line~~ → **ไม่อ่าน `?src=`** · TikTok webview → `in_app=tiktok` · ไม่มี param → ปกติ (ไม่กระทบอะไร)
19. หน้ายัง static (build ไม่มี ƒ ที่ /ring-size) · header 3 ตัวเดิม
20. gem-quiz/submit · /w/* · /shop matcher เดิม (differential)
21. คนกลับมา → is_return · stage กระโดด 1→5 · viewLastResult ไม่เพิ่ม measure_count
22. วัด 3 รอบ → 1 แถว measure_count=3 ค่าล่าสุด
23. copy เมื่อ TRACK on ไม่มี "จนกว่าคุณจะกดส่ง" · copy-guard เดิมผ่าน (P2)
24. stats: sum(abandon_at)+funnel[7]=sessions · วันไทย 00:00–07:00 ไม่เหลื่อม (ทั้งขอบต้นและขอบท้ายช่วง)
25. **retention 179 วันอยู่ · 181 วันหาย** · cron job 1 แถว ไม่ซ้ำเมื่อ apply ซ้ำ
26. check-analytics-grants สะอาด
27. stats ช่วง 7 วัน (ขั้นต่ำ) และ 180 วัน (เพดาน) ผ่าน · ช่วงที่ไม่มีข้อมูลคืน shape ครบ (ไม่ error)
ระดับ QA: **L** · security ผ่านก่อน merge

## 10. Trade-offs (ทางที่ตัดทิ้ง)
Server Action จากหน้า (หน้า exempt gate) · event log หลายแถว (ไม่มีเพดาน) · localStorage device id (เป็น persistent id ขัดไม่ระบุตัวตน) · ช่องทาง `?src=` + lookup (มติไม่แยกช่องทาง) · RLS policy อ่านรายแถว (L4) · token/honeypot/IP hash/rate limit ต่อ IP (§5) · useSearchParams (หลุด static) · แก้ whitelist gem quiz (Q11 ตัดสินแล้ว) · aggregate table ก่อน purge (YAGNI)

## 11. ความเสี่ยงตอน implement
1. แก้ baseline `qa-regression.test.ts` ด้วยการผ่อน regex กว้าง = เปิด subtree — brief ต้องเขียน must-NOT ชัด
2. allowlist network ใน copy-guard ต้องเป็น path เป๊ะ ไม่ใช่ "ไฟล์ที่มีคำว่า track"
3. sendBeacon บน iOS อาจหลุดบางครั้ง → ตัวเลข cta เป็นขั้นต่ำ (บอกบนหน้าสรุป)
4. ลืม revoke default privileges → ต้องออก migration ซ้ำ
5. ช่วงร้าน 45/68 อยู่ 2 ที่ — เปลี่ยนต้องแก้คู่ (`config.ts` ⇔ `analytics.ring_size_shop_range()`)
6. ห้ามเปิด TRACK บน prod ก่อน copy ผ่าน
7. UA bucket อาจพลาด webview ใหม่ → ตกเป็น browser
8. client ที่ไม่ทำตามสัญญา event (§0) — ผลวัดผิด stage ถูกปฏิเสธทั้ง event (ข้อมูล event นั้นหาย) · พก size ซ้ำใน event stage 7 อื่น ๆ = รอบวัดนับเกิน — P2 ต้องมีเทสต์ล็อก
9. ข้อมูลก่อน apply จะไม่มี: migration นี้ยังไม่ apply — ห้าม deploy โค้ดที่เรียก RPC ก่อน apply (route จะ 500 เงียบ ๆ)

## 12. ค่าที่ต้องมาจากเจ้าของ — สถานะ (ตัดสินแล้วทั้งหมด)
| # | ค่า | ผล |
|---|---|---|
| O1 | ถ้อยคำความเป็นส่วนตัว §4.4 | **อนุมัติแล้ว** (ข้อความใน §4.4) |
| O2 | ช่องทาง + ป้าย | **ยกเลิก — ไม่แยกช่องทาง** (§12.1) |
| O3 | retention | **180 วัน** (6 เดือน) |
| O4 | cap circuit breaker /10 นาที | **300** (LINE broadcast ≤ 1,000 คน) |
| O5 | เคารพ DNT/GPC | **เคารพ** (client ไม่ส่ง) |
| O6 | เก็บ circ_mm | **เก็บ** (ปัด 0.1) |
| O7 | ลิงก์ปลายทางจริง + OG image ก่อนแจก | ยังค้าง (P2/แจกลิงก์) |
| O8 | rate limit ต่อ IP | **ยอมรับความเสี่ยงไปก่อน เฝ้าดู** (§5) |

## 13. ลำดับงาน
P0 migration 0193 + verify ✅ → P1 endpoint + exempt + เทสต์ (security) ✅ → **apply 0193 (devops · หลัง security + QA ผ่าน)** → P2 track.ts + จุดเกาะ + copy + เปิด flag (QA L) → P3 ux-ui หน้าสรุป → action (ข้อบังคับ §6) + page → code-reviewer → devops (apply 0193 ก่อน deploy โค้ดที่เรียก RPC · ไม่มี env ใหม่) · P1 กับ P2 ขนานได้ใน worktree แยก (`qa-regression.test.ts` ให้ P1 ถือ)

### 12.1 มติเจ้าของ 25 ต.ค. 69 (ทับค่าเสนอ)
- **O1** ถ้อยคำ §4.4 ใช้ตามร่าง → ปรับข้อความรอบ r2 เป็นฉบับที่เจ้าของอนุมัติ (ใน §4.4)
- **O3 retention = 6 เดือน (180 วัน)** ไม่ใช่ 365 → cron ชื่อ `ring-size-retention-180d` · เทสต์ 179 วันอยู่ / 181 วันหาย
- **O4** LINE broadcast ไม่เกิน 1,000 คน → cap 300 แถวใหม่/10 นาที/ร้าน ใช้ได้
- **O5** เคารพ DNT/GPC (ไม่ส่ง)
- O6 ไม่ได้ถาม — ใช้ค่าเสนอ (เก็บ circ_mm ปัด 0.1)
- **O2 ถูกกลับ (25 ต.ค. 69 รอบสอง): ยังไม่แยกช่องทาง `?src=`** — "ยังไม่มีช่องทางเยอะ เก็บข้อมูลยาก" ⇒ 0193 ไม่มีตาราง `ring_size_src` / คอลัมน์ `src` / `p_src` ของ stats / `by_src` / `src_options` · client ไม่อ่าน `?src=` · **คง `in_app`** · endpoint: ส่ง field `src` มา = key ไม่รู้จัก = 400 · เพิ่มช่องทางทีหลัง = migration ใหม่ ไม่เผื่อคอลัมน์ว่าง
- เพิ่มจาก UX (Padmé, 25 ต.ค. 69 — ก่อนตารางเกิด): `used_a` / `used_b` / `saw_between` (OR) · `ring_size_stats` คืน `method_stats` ต่อวิธี + `switched` + `shop_range` + `data_since` · `measured` = มี `result_size` (ไม่ใช่ `funnel[7]` ที่รวม G4) · นิยามอยู่ในคอมเมนต์ของ `ring_size_stats` ใน migration 0193
- **รอบ r2 (code review + security — ก่อน apply จึงแก้ใน 0193 เดิม)**: S1 `result_method`/`invalid_a`/`invalid_b`/`measure_count_a`/`measure_count_b` · S2 สัญญา event (§0 + JSDoc) · S3 ผลวัดเฉพาะ stage 7 + invariant `measured <= funnel[7]` · L1/N2 stats ช่วง 7–180 วัน (แทน "≤ 180" เดิมที่ปล่อย 181 วัน) · L2 route อ่าน stream + UTF-8 fatal · L4 ไม่มี policy · N1 ตัด `size_summary.invalid_sessions` · **เจ้าของยอมรับความเสี่ยง breaker/ไม่มี rate limit ต่อ IP (§5)**

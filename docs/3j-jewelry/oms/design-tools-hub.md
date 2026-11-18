# Design — หน้ารวมเครื่องมือลูกค้า + โดเมนลูกค้า `tools.3jthailand.com`

> Yoda · 18 พ.ย. 69 · ฐาน = origin/main `36c2823` · branch `feature/tools-hub`
> หน้าตา hub = spec ของ Padmé (`docs/3j-jewelry/oms/ux-tools-hub.md`) — ไฟล์นี้คุมเฉพาะ routing / host / security / ship
> 💰 แตะ middleware + auth matcher → security ผ่านก่อน merge ทุก phase ที่แตะ routing

## 0. หลักข้อเดียวที่ทุกข้อด้านล่างตามมา

**กฎของ host `tools.` มีหน้าที่ "ตัดสิทธิ์" อย่างเดียว ห้าม "ให้สิทธิ์" เพิ่ม**
- auth gate เดิม (matcher + `AUTH_GATE`) ไม่ถูกแก้ตรรกะ และไม่ขึ้นกับ Host
- ปลอม `Host: tools.3jthailand.com` ได้แค่ "เห็นน้อยลง" (ทุกอย่างกลายเป็น hub) — ไม่มีทางได้หน้าหลังบ้านโดยไม่มี session
- ปลอม `Host: app.` = ได้พฤติกรรม app. เดิม = เหมือนเปิด app. ตรงๆ → ไม่มีอะไรให้ได้

## 1. Design overview

```
Request -> next.config headers() -> next.config redirects() -> middleware -> route
           (ติด XFO/CSP/PP ตาม     (1) tools.: path นอก allowlist   (2) tools.: "/" -> rewrite /tools
            path ทุก host)             -> 307 "/"                      อื่นใดที่หลุดมาถึง -> 307 "/"
                                   (3) app.: หน้าลูกค้า 4 หน้า          (ก่อนสร้าง Supabase client · ไม่แตะ cookie
                                       -> 307 https://tools.../...      · ไม่ขึ้นกับ AUTH_GATE)
                                       (Phase 2 เท่านั้น)               host อื่น -> ตรรกะเดิมทุกบรรทัด
```

ทำไมต้อง 2 ชั้น (1)+(2) ไม่ใช่ middleware ชั้นเดียว:
- middleware **ไม่รัน** บน path ที่ exempt (`/shop` `/stock/hero` `/w/<token>` `/api/webhooks/*` ...) → ถ้าใช้ middleware อย่างเดียว path พวกนี้เปิดได้บน tools. · `redirects()` ของ next.config รัน**ก่อน** middleware และไม่สน matcher → ครอบทุก path
- แต่ rewrite "/" → hub ทำใน next.config ไม่ได้ (rewrite รันหลัง middleware → middleware เห็น "/" ที่ถูก gate → เด้ง /login) → ต้องมี (2) ใน middleware
- (2) เป็น defense-in-depth ด้วย: ถ้าวันหน้า regex ของ (1) พลาด path ที่ถูก gate ไป (2) ส่งกลับ hub ไม่ใช่หน้า login (สิ่งที่เจ้าของกังวลตรงๆ)

### 1.1 allowlist บน `tools.` (ลอกจาก exempt-path จริง — นอกนี้ = 307 "/")

| path | เหตุผล |
|---|---|
| `/` | hub (middleware rewrite → `/tools`) |
| `/ring-size` `/gem-quiz` `/ring-builder` (+ `/` ท้าย) | 3 หน้าลูกค้า |
| `/api/gem-quiz/submit` `/api/ring-size/event` `/api/ring-builder/quote` | endpoint ที่ 3 หน้าเรียก — same-origin check ของทั้ง 3 route เทียบกับ Host ของ request เอง → ใช้บน tools. ได้โดยไม่ต้องแก้ route |
| `/_next/static/...` `/_next/image` | chunk + รูป static import ของ ring-builder |
| root asset `[^/]+\.(svg,png,jpg,jpeg,gif,webp,ico)` · `gem-quiz/<file>` · `ring-size/<file>` | og.png · 3j-mark · โลโก้ · favicon — ลอกกฎ asset จาก matcher เป๊ะ |

**ไม่อยู่ใน allowlist (ตั้งใจ)**: `/tools` (→ "/" = canonical) · `/shop` · `/stock/hero` · `/w/*` `/w/s/*` (QR ใบงานยังชี้ app. ผ่าน `APP_ORIGIN` — ไม่แตะ) · `/api/webhooks/*` · `/login` `/register` `/pending` · ที่เหลือทั้งหมด

### 1.2 พฤติกรรมบน `app.` (ข้อ 2)

- **Phase 1**: ไม่เปลี่ยนอะไร + มี `/tools` (hub) เพิ่ม exempt แบบ exact (ใช้ดู hub บน preview/app. ก่อนโดเมน live)
- **Phase 2**: GET `/ring-size` `/gem-quiz` `/ring-builder` `/tools` เฉพาะ host `app.3jthailand.com` → **307** ไป `https://tools.3jthailand.com` path เดิม (`/tools` → `/`) · Next ส่ง query ต่อให้เอง (`?t&i&q&g&c&d&r` ของ ring-builder ไม่หาย — ส่งต่อทั้งก้อน ไม่ parse จึงไม่ผูกรายชื่อ key)
- **API บน app. ไม่ redirect** — คนที่เปิดหน้าค้างไว้บน app. ระหว่าง deploy ยังส่งผลได้ (fetch ตาม redirect ข้าม origin จะชน same-origin check อยู่ดี)
- **307 ไม่ใช่ 308**: ทุกหน้า noindex → 308 ไม่ได้อะไรทาง SEO แต่เบราว์เซอร์จำถาวร ถ้า tools. มีปัญหาถอยไม่ได้สำหรับคนที่เคยเปิด · เปลี่ยนเป็น 308 วันที่เจ้าของสั่งเปิด index
- **header XFO/CSP/Permissions-Policy**: rule เดิม `/ring-size` `/ring-builder` ใน next.config ไม่มี host condition → ติดบน tools. เอง ห้ามแก้ · 307 ของ app. ไม่ต้องมี header (ไม่มีเนื้อหา)
- 🔴 redirect ชุดนี้ **ต้องอยู่ตลอดไป** — QR บนการ์ดขอบคุณที่พิมพ์แล้ว + ลิงก์ที่แจกไปแล้วชี้ app.

### 1.3 Hub route (ข้อ 3)

`app/(quiz)/tools/page.tsx` — ใต้ `(quiz)` เพื่อได้ฟอนต์/shell และ **ถูก `lib/gem-quiz/no-server-action-graph.test.ts` เดินครอบอัตโนมัติ** (ห้าม "use server") · server component static ไม่มี DB/env/token · ลิงก์ไป 3 หน้า = `<a href>` relative ธรรมดา ห้าม next/link (header ติดเฉพาะตอนโหลดหน้าเต็ม — L2 เดิม)

> **อัปเดต P2/P3 (18 พ.ย. 69):** หลัง P2 หน้าลูกค้า 3 หน้าอยู่บน tools. เสมอ (app. 307 ออกหมด) → `ToolsHubLink` ใช้ `HUB_URL = "/"` (lib/site/hosts.ts) ไม่ใช่ `/tools` — บน tools. "/" = hub ตรงๆ ไม่เสีย hop 307 · ข้อแลก: บน localhost/*.vercel.app (ไม่ redirect) "/" = dashboard→login ตอนกดทดสอบ · ข้อความด้านล่างเป็นการตัดสินใจก่อน P2

ลิงก์ "กลับหน้ารวม" จาก 3 หน้า (ถ้า Padmé ใส่) = `href="/tools"` **ห้ามเป็น "/"** — บน app./preview "/" = dashboard → login (เผยว่ามีหลังบ้าน) · `/tools` ใช้ได้ทุก host (บน tools. → 307 "/") · ⚠️ ทำหลัง `feature/ring-showcase-multi` merge เท่านั้น (branch นั้นมี copy-guard "href ใน DOM ได้แค่ lineOaMessageUrl, /ring-size, /gem-quiz" + แก้ไฟล์ ring-builder ราว 20 ไฟล์ → ชนแน่)

## 2. ไฟล์ที่ต้องสร้าง/แก้

| ไฟล์ | Phase | หน้าที่ |
|---|---|---|
| `lib/site/hosts.ts` (ใหม่) | 1 | `TOOLS_HOST = "tools.3jthailand.com"` · `TOOLS_ORIGIN` · `APP_HOST` · `normalizeHost(raw)` (lowercase · ตัด `:port` · ตัด `.` ท้าย · รูปแบบเพี้ยน → null) · `isToolsHost()` — pure ไม่อ่าน env |
| `next.config.mjs` | 1 | `redirects()` ชั้น (1): source `/:path((?!<allowlist>).*)` + `has: [{ type: "host", value: "tools\.3jthailand\.com\.?" }]` → `/` `permanent: false` · headers: เพิ่ม `/tools` (ทุก host) และ `/` + has host tools. = XFO DENY + CSP `frame-ancestors 'none'` (headers จับ path ก่อน rewrite → hub บน tools. ต้องมี rule "/" แยก) |
| `middleware.ts` | 1 | ชั้น (2) เป็นบรรทัดแรกของ `middleware()` ก่อนเช็ค anonKey/สร้าง client: tools. host → `pathname === "/"` ? `NextResponse.rewrite("/tools")` : `NextResponse.redirect("/")` · matcher เพิ่ม `tools/?$` (exact) |
| `lib/auth/exempt-path.ts` | 1 | mirror `tools/?$` ให้ตรง matcher |
| `lib/auth/exempt-path.tools.test.ts` (ใหม่) | 1 | look-alike: `/toolsx` `/tools/x` `/tools-admin` `/TOOLS` `/tools/..%2fdashboard` ต้องถูก gate — ใช้ `getMiddlewareMatchers` ของ Next จริงแบบ `exempt-path.matcher.test.ts` |
| `lib/site/tools-host.test.ts` (ใหม่) | 1 | ตาราง §4 กับ redirects จริงจาก next.config — compile ด้วยฟังก์ชันของ Next (`getPathMatch` / `matchHas` ใน `next/dist/shared/lib/router/utils/`) ไม่เขียน regex เทียบเอง · middleware branch ด้วย NextRequest ปลอม Host · assert literal host ใน next.config ตรงกับ `TOOLS_HOST` · response tools. ไม่มี `set-cookie` |
| `app/(quiz)/tools/page.tsx` (+ component ตาม Padmé) | 1 | hub · metadata ครบทุกช่อง (ห้ามหลุด "3J Insight" จาก root layout — บทเรียน F9) · robots noindex จนเจ้าของสั่ง |
| `scripts/smoke-tools-host.mjs` (ใหม่) | 1 | ยิงตาราง §4 ใส่ base URL ใดก็ได้ (`--base http://localhost:3000 --host tools.3jthailand.com` หรือ prod จริง) · ตรวจ status + Location · GET/HEAD เท่านั้น ไม่เขียน DB |
| `next.config.mjs` | 2 | redirects ชั้น (3): has host `app\.3jthailand\.com\.?` · 4 path → `https://tools.3jthailand.com/...` `permanent: false` |
| `app/(quiz)/ring-size/page.tsx` | 2 | `SITE_ORIGIN` → `TOOLS_ORIGIN` (constant ไม่ใช่ env — copy-guard ห้าม process.env ใต้ ring-size) · แก้ `_tests/page-og.test.tsx` ตาม |
| `app/(quiz)/gem-quiz/page.tsx` · `ring-builder/page.tsx` · `tools/page.tsx` | 2 | ใส่ `metadataBase: new URL(TOOLS_ORIGIN)` — ตอนนี้ gem-quiz ไม่มี metadataBase → og:image ไป resolve จาก fallback ของ Vercel (production URL ของ project — มี 2 โดเมนแล้วเลือกตัวไหนไม่ควรพึ่ง) |

**ไม่เพิ่ม env `TOOLS_ORIGIN`** (ข้อ 6): hostname เป็นมติเจ้าของตายตัว ไม่ต่างตาม environment · env เพิ่ม failure mode "ลืมตั้ง → tools. ทำตัวเป็น app. = โชว์ login" ซึ่งคือสิ่งที่เจ้าของกลัวที่สุด · next.config อ่าน env ได้แค่ตอน build อยู่แล้ว · `APP_ORIGIN` คงเดิมสำหรับ QR ใบงาน
**preview `*.vercel.app` / localhost** = host ที่ไม่รู้จัก = พฤติกรรม app. ทั้งหมด (ไม่มีกฎ host ใดทำงาน) — ทดสอบกฎ tools. ด้วย `next start` + ส่ง Host header (§7)

## 3. Cookie / session (ข้อ 4) — ยืนยันจากโค้ดแล้ว

grep `lib/` `app/` `middleware.ts` ไม่มี `domain:` ใน cookie options → Supabase cookie = host-only ของ app. · tools. ไม่ได้รับ cookie · ชั้น (2) return ก่อนสร้าง Supabase client → ไม่มี Set-Cookie บน tools. · **ห้ามใครเพิ่ม `domain=.3jthailand.com` ในอนาคต** (ล็อกด้วยเคส T12)

## 4. รายการ "ห้ามผ่าน" + ด่านที่ตก (Host = `tools.3jthailand.com`)

| # | เคส | ต้องได้ | ตกที่ |
|---|---|---|---|
| T1 | `/dashboard` `/catalog/x` `/oem` `/jobs/1/print` | 307 → `/` | (1) สำรอง (2) |
| T2 | `/login` `/register` `/pending` | 307 → `/` (ห้ามเห็นฟอร์ม login) | (1) + (2) |
| T3 | `/shop` `/stock/hero` `/w/<token>` `/w/s/<token>` | 307 → `/` | (1) เท่านั้น — middleware ไม่รัน |
| T4 | `/api/webhooks/x` `/api/ring-size` `/api/ring-builder/quote/x` `/api/gem-quiz/submitx` | 307 → `/` | (1) |
| T5 | ตัวพิมพ์ใหญ่ `/RING-SIZE` `/Gem-Quiz` `/Dashboard` | 307 → `/` หรือ 404 — ห้าม 200 หน้าอื่น ห้าม login | (1) หรือ (2) — redirects ของ Next อาจไม่สนตัวพิมพ์ แต่ matcher ของ middleware gate ตัวพิมพ์ใหญ่ → (2) จับ |
| T6 | `/ring-size/../dashboard` `/ring-size/..%2fdashboard` `/%2e%2e/dashboard` `//dashboard` `/ring-size//` | ไม่ได้หน้าหลังบ้าน | (1) + (2) |
| T7 | `/ring-size/x` `/gem-quiz/deep/x.png` `/ring-builders` `/tools/x` `/toolsx` | 307 → `/` | (1) |
| T8 | POST `/ring-size` และ POST `/` พร้อม `Next-Action: <id จริงของหลังบ้าน>` | action ไม่รัน | graph test (ไม่มี "use server" ใต้ (quiz)) + (2) · **ต้องยิงจริงบน `next start`** อย่าเชื่อการอ่าน |
| T9 | Host `TOOLS.3JTHAILAND.COM` · `tools.3jthailand.com.` · `tools.3jthailand.com:443` | พฤติกรรม tools. เหมือนกัน (ห้ามตกไปเป็น app. = เห็น login) | `normalizeHost` + has regex `\.?` |
| T10 | Host ปลอม `tools.` ยิงไป `oms-3j.vercel.app` / app. | ได้แค่ hub/redirect · ไม่มีหน้าไหนผ่าน auth | หลักข้อ 0 |
| T11 | Host `evil-tools.3jthailand.com` · `tools.3jthailand.com.evil.com` · `xtools.3jthailand.com` | ไม่ใช่ tools. → พฤติกรรม app. เดิม (ยัง gate) | has anchored ทั้งสองด้าน — **พิสูจน์ใน test ด้วย `matchHas` ของ Next ห้ามสมมติ** · `isToolsHost` เทียบเท่ากันเป๊ะ ไม่ใช้ endsWith/includes |
| T12 | response ใดๆ บน tools. มี `set-cookie` | ห้ามมี | (2) return ก่อนสร้าง client |

**ต้องไม่พัง** (สำคัญเท่ากัน):
- N1 app. ทุกหน้าหลังบ้าน + login/logout + server actions — test session-gate/role-gate/guard-coverage เดิมเขียวโดยไม่แก้
- N2 preview `*.vercel.app` + localhost = พฤติกรรม app. ทั้งหมด (3 หน้าลูกค้าเสิร์ฟตรง ไม่ redirect)
- N3 `/w/<token>` `/w/s/<token>` บน app. + QR ใบงานที่พิมพ์แล้ว · webhooks บน app.
- N4 tools.: 3 หน้าเปิดครบ · submit quiz · beacon ring-size · quote ring-builder · og.png 200 · header XFO/CSP/Permissions-Policy ติด (`curl -I`)
- N5 Phase 2: `app.3jthailand.com/ring-builder?t=..&i=..&c=..&d=..` → tools. query byte เดิม · `/gem-quiz` (QR การ์ด) → tools. · `/ring-size` → tools.
- N6 exempt-path tests เดิม diff 0 (`exempt-path.test` · `.ring-builder.test` · `.worker.test` · `.matcher.test` เพิ่มได้แค่เคส `/tools`)

## 5. Phase ให้ Luke (ตามลำดับ — P2 ห้ามรวม PR กับ P1)

| phase | ขอบเขต | รอใคร | ระดับ QA |
|---|---|---|---|
| **P1a routing** | hosts.ts + redirects (1) + headers + middleware (2) + matcher/exempt `tools/?$` + tests §4 + smoke script + hub page โครงเปล่าที่ metadata ครบ (ข้อความ placeholder กลางๆ ไม่แต่ง copy) | ไม่รอ | 💰 security ก่อน merge |
| **P1b hub UI** | ตาม `ux-tools-hub.md` — แตะเฉพาะ `app/(quiz)/tools/**` | Padmé | M |
| **P2 switch** | redirects (3) + metadataBase/SITE_ORIGIN → tools. | โดเมน live + smoke prod ผ่าน | 💰 security ก่อน merge |
| **P3** | ลิงก์ "กลับหน้ารวม" `/tools` ใน 3 หน้า + ขยาย copy-guard | `feature/ring-showcase-multi` merge | M |

เหตุผลที่แยก P2: รวม redirect app.→tools. ไว้ใน P1 แล้ว merge ก่อน cert ออก = ลิงก์ลูกค้าทุกอันพังทันที (cert ของ app. เคยค้าง 45 นาที) · ทางเลือก env flag เปิด/ปิด redirect ถูกตัด เพราะ next.config อ่าน env ตอน build → สลับต้อง redeploy อยู่ดี และเป็นสวิตช์ล่องหนที่คนลืมได้ · rollback ของ P2 = Vercel Instant Rollback ไป deployment ก่อนหน้า

## 6. ขั้นตอน ship

1. P1 merge → prod (กฎ tools. ยังไม่มีผลเพราะยังไม่มีโดเมน · `app.3jthailand.com/tools` ใช้ดู hub ได้)
2. TL เพิ่ม `tools.3jthailand.com` ใน Vercel project `oms-3j` (Production)
3. เจ้าของเพิ่ม CNAME `tools` → `cname.vercel-dns.com` ใน Wix DNS (ห้ามแตะ A / www / MX)
4. รอ `misconfigured:false` → 10 นาทียังไม่มี HTTPS ให้ `issue_cert` ทันที (กับดักเดิม memory app-domain)
5. `node scripts/smoke-tools-host.mjs --base https://tools.3jthailand.com` ครบตาราง §4 + เปิดในมือถือจริงผ่าน LINE in-app browser
6. P2 merge → smoke N5 บน app.
7. เจ้าของสลับลิงก์ LINE rich menu / Wix / FB-IG bio เป็น `https://tools.3jthailand.com/...` (ลิงก์ app. เก่ายัง 307 ใช้ได้)
8. การ์ด OG ใน LINE อาจค้างของเดิม (LINE แคช og ตาม URL) — แจ้งเจ้าของล่วงหน้า

## 7. QA scope

**P1a + P2 = 💰 (L + security ก่อน merge)** · P1b/P3 = M
- unit: ตาราง §4 ผ่าน compiler ของ Next จริง + middleware branch + exempt look-alike
- integration local: `npm run build && npm start` แล้ว smoke script ด้วย `--host tools.3jthailand.com` / `app.3jthailand.com` / `oms-3j.vercel.app` — **preview บน Vercel ทดสอบกฎ host ไม่ได้** (edge route ตาม Host จริง) ห้ามรายงานว่า "ทดสอบบน preview แล้ว"
- T8 ยิงจริง: หยิบ action id จาก chunk หน้าหลังบ้าน แล้ว POST ไป tools./ring-size และ tools./ — action ต้องไม่รัน
- regression: login/logout app. · หน้าช่าง /w · gem quiz submit end-to-end · ring-size beacon · ring-builder quote (ทั้งบน app. และ tools.)
- security/red-team: Host header matrix T9–T11 + ไม่มี set-cookie บน tools.

## 8. ความเสี่ยง

1. **`has` host + `redirects()` ของ Next ทำงานตามที่คิดไหม** (anchoring · ตัวพิมพ์ · port · จุดท้าย) — รีโปนี้ยังไม่เคยใช้ `has` เลย ไม่มีหลักฐานในบ้าน → test ต้องใช้ฟังก์ชันของ Next เอง + smoke บน `next start` ก่อน merge
2. **regex 3 ก้อนต้องตรงกัน**: allowlist (1) · matcher middleware · mirror exempt-path — เพิ่มหน้าลูกค้าใหม่วันหน้าต้องแก้ 3 ที่ · ลืม (1) = หน้าใหม่ถูกส่งไป hub บน tools. (fail-closed ยอมรับได้) · ใส่คอมเมนต์ชี้กันทั้ง 3 ไฟล์ + test ที่ assert ว่าทุก path ลูกค้าใน allowlist ก็ exempt ใน matcher ด้วย
3. **RSC / prefetch** — ถ้า hub ใช้ next/link, header ของหน้าปลายทางไม่ติด และ RSC request (`?_rsc=`) ต้องผ่าน allowlist → ห้าม next/link ใน hub
4. **"/" บน tools. ผ่าน middleware rewrite** — ถ้าลืม header rule "/" + has host, hub บน tools. จะไม่มี XFO (ล็อกด้วย test + `curl -I`)
5. ระหว่าง P1→P2 og:url/og:image ของ ring-size ยังชี้ app. — แชร์ลิงก์ tools. ได้การ์ดที่ชี้ app. (ไม่พัง แค่ไม่ตรง)
6. `design-ring-showcase-multi.md` ยังไม่อยู่บน main (อยู่ branch นั้น) — สัญญา URL ที่อ้างคือ query `t i q g c d r` · redirect (3) ส่ง query ทั้งก้อน จึงไม่ต้องรู้ key · branch นั้นไม่แตะ middleware/next.config/exempt-path → P1/P2 ไม่ชน

## 9. คำถามเจ้าของ (ไม่เดา — default ระหว่างรอ)

1. ให้ Google เก็บหน้า `tools.3jthailand.com` (hub / วัดไซส์) ไหม? — default: **noindex เหมือน 3 หน้าเดิม** จนกว่าจะสั่ง
2. hub จะ "ฝัง" ในหน้าเว็บ Wix (iframe) หรือเป็นปุ่มลิงก์ออกไป? — default: **ลิงก์ออก + ห้ามฝัง** (XFO DENY เหมือน ring-size) · ถ้าจะฝังต้องให้ security ตรวจก่อนเปลี่ยน
3. `/shop` (หน้าร้านสาธารณะเดิมบน app.) ต้องย้ายมา tools. ด้วยไหม? — default: **ไม่ย้าย** (นอก scope · บน tools. = ส่งไป hub)

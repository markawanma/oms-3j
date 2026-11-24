# Design — แนบภาพ 3D มุมหน้าไปกับข้อความ LINE ของ /ring-builder (ทาง ก. การ์ดตัวอย่างลิงก์)

> Yoda · 24 พ.ย. 69 · ออกแบบอย่างเดียว ยังไม่ implement
> คำสั่งเจ้าของ (คำต่อคำ): "ก. เลยอยากให้ง่ายที่สุด แบบว่าระบบแนบรูปส่งให้เองเลยได้ไหม ก็คือ save รูปด้านหน้าที่เป็น 3มิติ ส่งให้เลย แล้วเขียน คำอธิบายด้านล่างเป็นข้อๆแบบ ที่ทำในลิงค์"
> ฐาน: main `bcc52b3` · ต่อยอด D1.3 (`design-ring-showcase-multi.md` §15: `formatPriceThb(id)` ราคาต่อแบบ) — **P2 เริ่มหลัง §15 merge** (ไฟล์ชุดเดียวกัน)
> อ่านคู่: `design-tools-hub.md` (§0 host tools. ตัดสิทธิ์อย่างเดียว · §4 T1–T12) · `app/api/ring-size/event/route.ts` (แม่แบบ endpoint สาธารณะ) · migration 0193 (แม่แบบ circuit breaker)

## 0. ข้อเท็จจริงที่ยังไม่ยืนยัน — ต้องผ่าน Phase 0 ก่อนเขียนโค้ด

ทาง ก. ทั้งก้อนพิงพฤติกรรมของ LINE ซึ่ง**ทีมยังไม่เคยพิสูจน์** ห้ามถือเป็นข้อเท็จจริง:

| # | คำถาม | ทำไมสำคัญ | วิธีพิสูจน์ |
|---|---|---|---|
| L1 | ข้อความที่ลูกค้าส่งเข้าแชต 1:1 กับ OA มีลิงก์ แล้ว**ฝั่งลูกค้า**เห็นการ์ดตัวอย่าง (og:image) ไหม | ถ้าไม่ขึ้น ทาง ก. ไม่ได้อะไรเลย | Phase 0 (ทดสอบมือ) |
| L2 | **ฝั่งแอดมิน** (LINE OA Manager แอปมือถือ + เว็บแชต) แสดงการ์ดของลิงก์ในข้อความลูกค้าไหม | 🔴 คนที่ต้องเห็นรูปคือแอดมิน — ถ้า OA Manager โชว์แค่ตัวลิงก์ แอดมินต้องกดเปิดเอง (ยังใช้ได้ แต่ไม่ใช่ "เห็นรูปในแชต") | Phase 0 |
| L3 | อัตราส่วน/ขนาดที่ LINE ใช้ครอปการ์ด · ขนาดไฟล์สูงสุด · og:image ข้ามโดเมนได้ไหม · แคชนานเท่าไร · ลบรูปแล้วการ์ดเก่าในแชตยังอยู่ไหม · crawler ส่ง Origin/UA อะไร | ตัดสินขนาดภาพ + TTL | `docs-researcher` หาเอกสาร LINE ทางการ (ต้องมี URL) + Phase 0 |
| L4 | เปลี่ยน `location.href` ไป `line.me/R/oaMessage/...` หลัง `await` (ไม่ใช่ gesture ตรง) บน iOS / Android / LINE in-app เปิดแอป LINE ได้ไหม | เลือกกลไกปุ่ม | **เลี่ยงไม่ใช้กลไกนี้** (§1.1) — ไม่ต้องพิสูจน์ |
| L5 | Vercel plan ของ `oms-3j` มี Firewall rate limit ไหม | ชั้นกันยิงรัวเสริม (S5) | ดู dashboard Vercel |

**Phase 0 (ฟรี · 10 นาที · ไม่ต้องมีโค้ด):** เจ้าของใช้ LINE ส่วนตัวส่งเข้า @3jjewelry ว่า `ทดสอบการ์ด https://tools.3jthailand.com/ring-size` (หน้านี้มี og.png อยู่แล้ว) แล้วแคปจอ (ก) ฝั่งลูกค้า (ข) OA Manager มือถือ (ค) OA Manager เว็บ
- ขึ้นการ์ดครบทั้ง 3 = ทำตาม design นี้
- ลูกค้าขึ้น แอดมินไม่ขึ้น = ยังทำได้ (แอดมินกดลิงก์ดูรูป) แต่ต้องบอกเจ้าของก่อนว่าไม่ใช่ "เห็นรูปในแชต" ให้เจ้าของตัดสินว่าคุ้มไหม
- ไม่ขึ้นทั้งคู่ = **หยุด** ทาง ก. — ทางที่เหลือคือ LIFF (`sendMessages`/`shareTargetPicker`) ส่งรูปเป็น image message จริง (ต้องมี LIFF app + ใช้ได้เฉพาะเปิดในแอป LINE · design ใหม่)

## 1. Design overview

```
[ลูกค้าเลือกแบบ/พลอย/ไซซ์ — การ์ดสรุปอยู่ในจอ]
   │ debounce 1.5 วิ หลังการเลือกนิ่ง (ไม่ใช่ตอนกดปุ่ม)
   ▼
renderer.captureFront()  เรนเดอร์มุมหน้า 1200x630 ใน task เดียว → readPixels → คืนมุม/ขนาดเดิม (ผู้ใช้ไม่เห็นภาพกระโดด)
   ▼ compose บน canvas 2D: พื้นเดียวกับเวที + ป้าย "ภาพจำลอง · 3J Jewelry" → toBlob(jpeg 0.85)
POST /api/ring-builder/snapshot?p=<choice code>   body = JPEG ดิบ   (client timeout 6 วิ)
   │ ด่าน: same-origin → ชนิด → ขนาด → choice ผ่าน parser เดิม → JPEG + มิติเป๊ะ + ตัด metadata → RPC (breaker) → upload
   ▼ 201 {id}
href ปุ่ม LINE = ข้อความเดิมทุกบรรทัด + "ดูภาพแหวน: https://tools.3jthailand.com/ring/<id>"
   │ ยังไม่พร้อม/ล้ม = href ข้อความเดิม · ปุ่มเป็น <a> sync ตลอด ไม่มีวันถูกบล็อก
   ▼ ลูกค้ากดส่งใน LINE → LINE crawler GET /ring/<id> (og meta) + GET /ring/<id>/og.jpg
หน้า /ring/<id> = รูป + รายละเอียดเป็นข้อ (สร้างใหม่จาก choice ที่ DB เก็บ ผ่าน helper เดียวกับข้อความ LINE) + ราคา formatPriceThb(designId)
```

### 1.1 ทำไมอัปโหลด "ล่วงหน้า" ไม่ใช่ตอนกดปุ่ม (popup blocker)
| ทาง | ผล | ตัดสิน |
|---|---|---|
| กด → await upload → `window.open` | Safari / LINE in-app บล็อก popup หลัง await | ตัดทิ้ง |
| กด → `window.open('about:blank')` ก่อน แล้วเปลี่ยน location ทีหลัง | in-app browser ส่วนใหญ่เมิน หรือค้างแท็บเปล่า | ตัดทิ้ง |
| กด → await → `location.href` แท็บเดิม | ไม่โดนบล็อก แต่ universal link LINE บน iOS อาจไม่เปิดแอปเมื่อไม่มี gesture (L4) + ลูกค้ารอ | ตัดทิ้ง |
| กด 2 ครั้ง ("เตรียมรูป" → "เปิด LINE") | ทำงานทุกที่ แต่ขัด "ง่ายที่สุด" | สำรอง |
| **เตรียมล่วงหน้า + `<a href>` sync เดิม** | ปุ่มเหมือนเดิมทุกประการ · href เปลี่ยนเมื่อรูปพร้อม · ไม่พร้อม = ข้อความเดิม | **เลือก** |

ข้อแลก 1: อัปโหลดรูปที่ลูกค้าอาจไม่ได้ส่ง (เปลี่ยนใจ/ปิดหน้า) → เปลืองที่เก็บ + กินโควตา breaker · คุมด้วย dedupe ตาม choice (ชุดเดิมไม่อัปซ้ำในหน้าเดียว) · เพดาน 8 ครั้ง/การโหลดหน้า · เริ่มเมื่อการ์ดสรุปเข้าจอเท่านั้น (IntersectionObserver) · TTL ลบเอง · ภาพไม่มี PII
ข้อแลก 2: กดระหว่างอัปโหลด = ได้ข้อความไม่มีลิงก์ → ใต้ปุ่มมีสถานะเล็ก "กำลังเตรียมรูปแหวน…" / "แนบรูปแหวนแล้ว" (ถ้อยคำให้ ux-ui) ลูกค้ารอได้ถ้าอยาก ไม่บังคับ

## 2. Flow รายละเอียด

### 2.1 จับภาพ (client · `gl-renderer.ts` เพิ่ม 1 เมธอด)
- `captureFront(w = 1200, h = 630): Uint8Array | null` ทำ**ใน task เดียว**: เก็บ yaw/pitch/zoom + canvas.width/height → ตั้ง 0/0/1 (= มุม "กลับมุมหน้า") + ขนาด 1200x630 → `draw()` → `gl.readPixels` ทันที (ไม่ต้องเปิด `preserveDrawingBuffer` ซึ่งเสียประสิทธิภาพทุกเฟรม) → คืนค่าเดิม → `draw()` → คืน RGBA · lost / disposed / ไม่มี mesh = null
- ไม่แตะ `matrix.ts` / shader / `bypass-ring.ts` — เรียก `buildCamera` เดิมด้วย W,H ใหม่เท่านั้น · 🔴 หัวไฟล์ gl-renderer เขียนว่า "เพิ่มได้ 1 เมธอด setRing()" → **เมธอดที่ 2 ต้องได้ TL อนุมัติ** แล้วแก้คอมเมนต์หัวไฟล์ + ตาราง §0 ของ design-ring-showcase-multi
- ส่ง capture ออกจาก viewer ทาง callback prop (`onCaptureReady(fn | null)`) RingViewer → RingStage → RingShowcaseClient · viewer ยังไม่ fetch อะไรเอง (สัญญาเดิม)
- compose ใน `lib/ring-builder/snapshot/compose.ts`: canvas 2D 1200x630 · พื้น gradient ขาว → `--gq-border-soft` + เงาวงรีแบบเวที · พลิกแถว (readPixels กลับหัว) · ป้าย "ภาพจำลอง" (ซื่อตรงแบบ badge บนเวที · Z6) + "3J Jewelry" · แหวนอยู่ในจัตุรัสกลาง 630x630 (LINE ครอปจัตุรัสก็ยังเห็นครบ — กันไว้ระหว่างรอ L3)
- **ไม่ใส่ราคา/ไซซ์/ชื่อพลอยลงภาพ**: ภาพถูกส่งต่อได้และค้างในแชตถาวร ราคาเปลี่ยนได้ (790/890) — ตัวเลขอยู่ในข้อความ + หน้า preview ที่สร้างสดจาก config
- stage ไม่ ready (unsupported / lost / designFailed / ยังโหลด) = ไม่จับ = ข้อความเดิม · **ห้ามใช้รูปถ่ายจริงแทน** (สีพลอยไม่ตรงที่เลือก · Z6)
- `toBlob('image/jpeg', 0.85)` คาด 60–150 KB (วัดจริงตอน implement)

### 2.2 สัญญา `p` (choice code) — ไม่มีข้อความอิสระ
`p` = `<designId>~<kind>~<codes>~<size>` เช่น `bypass2~own~ruby.cz~56` · `small7~slots~ruby.ruby.cz.cz.cz.ruby.ruby~-` · `trinity~rec1~ruby.sapphire~-` · ยาว ≤ 160 · รูปร่าง `^[a-z0-9]{1,24}~(direct|unpicked|own|slots|rec[1-3])~[a-z.]{0,120}~([0-9]{2}|-)$` (รหัสจริงของ designId/พลอยให้ลอกจาก designs.ts / gem-quiz config ตอน implement)
- parse → `ShowcaseLineInput` แล้ว **ต้องผ่าน `buildShowcaseLineMessage(input) !== null`** (ด่านเดียวกับปุ่ม LINE: whitelist แบบ · `resolveChoice` · `isShowcaseSize`) — ไม่ผ่าน = 400
- serializer/parser ไฟล์เดียว `lib/ring-builder/snapshot/choice-code.ts` (pure) + round-trip test ทุก kind × ทุกแบบ
- ทำไมไม่ใช้ query ของหน้า (t/i/q/c/d/r): ไม่มีไซซ์ และมี state ที่หน้า preview ไม่ต้องรู้ (intention/table)

### 2.3 Endpoint `POST /api/ring-builder/snapshot` (ใหม่ · exact exempt)
ลอกโครง `ring-size/event/route.ts` — export POST อย่างเดียว · ทุกคำตอบ `no-store` · log แค่ code · ลำดับด่าน:
1. same-origin (Origin host = Host · ไม่มี Origin ต้อง `Sec-Fetch-Site: same-origin`) → 403
2. `Content-Type` ต้องเป็น `image/jpeg` เป๊ะ → 415
3. `p` ผ่าน §2.2 → 400 (ข้อความทั่วไป ไม่บอก field) — ตรวจก่อนอ่าน body (ถูกกว่า)
4. ขนาด ≤ 256 KB: content-length + อ่าน stream ตัดทันที (นับไบต์) · เส้นตายรวม 5 วิ → 413 / 408
5. `looksLikeJpeg` + `extractJpegDimensions` = **1200x630 เป๊ะ** + `cleanJpegForStorage` (ตัด EXIF/XMP/COM — มีอยู่แล้วใน `lib/images/server.ts`) → 400
6. shop จาก env (`getDevShopId`) → RPC `analytics.ring_snapshot_create` (breaker) · P0001 → 429 · 22023 → 400
7. upload `ring-snapshots/<id>.jpg` (service role · `upsert: false` · contentType `image/jpeg`) · ล้ม → RPC ลบแถว best-effort → 503
8. ลบของหมดอายุแบบพ่วง ≤ 20 ไฟล์ (§3.3) — ล้มไม่กระทบคำตอบ
9. 201 `{ id }`
- client: `AbortController` 6 วิ · ไม่ใช่ 201 = เงียบ ใช้ข้อความเดิม (ไม่โชว์ error ให้ลูกค้า)

### 2.4 ข้อความ LINE
- `buildShowcaseLineMessage(input, snapshotUrl?)` — มี url = แทรกบรรทัด `ดูภาพแหวน: <url>` ก่อน `LINE_COPY.closing` · ไม่มี = **byte เดิมทุกตัว** (test ล็อก)
- url = `${location.origin}/ring/${id}` (prod = tools. · preview = origin ของ preview) · id ต้องผ่าน regex ก่อนต่อ string
- ปุ่ม "คัดลอกข้อความ" ได้ข้อความเดียวกัน

### 2.5 หน้า preview `/ring/<id>` (ใหม่ · ไม่อยู่ใต้ /ring-builder)
- `app/(quiz)/ring/[id]/page.tsx` server component (ใต้ `(quiz)` = `no-server-action-graph.test` ครอบเอง) · id ไม่ตรง `^[A-Za-z0-9_-]{22}$` → `notFound()` ก่อนแตะ DB
- อ่าน RPC `ring_snapshot_get(shop, id)` (หมดอายุ = ไม่คืน) → **parse `choice_code` ซ้ำด้วย §2.2** (ไม่เชื่อว่าของใน DB ยังถูก — whitelist ใน TS เปลี่ยนได้หลังบันทึก) → ไม่ผ่าน/ไม่มี = หน้า "ลิงก์นี้หมดอายุแล้ว ทักแอดมินได้" (404)
- แสดง: รูป `/ring/<id>/og.jpg` + ป้าย "ภาพจำลอง" + รายการเป็นข้อ = **helper เดียวกับ OrderSummary/LINE** (แยก `buildShowcaseDetailRows(input)` ออกจาก line-message.ts) + ราคา `formatPriceThb(designId)` + "ยังไม่ใช่การสั่งซื้อ — แอดมินยืนยันอีกครั้ง" + `<a href="/ring-builder">` ธรรมดา
- metadata: `og:title` "แบบแหวน: {ชื่อแบบ} · 3J Jewelry" · `og:description` = พลอย + ไซซ์ (**ไม่มีราคา** — การ์ดค้างในแชตถาวร) · `og:image` absolute + width/height + alt · `robots noindex,nofollow` · `referrer: no-referrer` (id = สิทธิ์ดูรูป ห้ามรั่วผ่าน Referer)
- รูป `app/(quiz)/ring/[id]/og.jpg/route.ts` GET → อ่าน storage (private) ด้วย service role → header `Content-Type: image/jpeg` · `X-Content-Type-Options: nosniff` · `Content-Security-Policy: default-src 'none'; sandbox` · `X-Robots-Tag: noindex` · `Cache-Control: public, max-age=3600, s-maxage=86400` (CDN Vercel รับโหลด crawler/แอดมิน) · ไม่มี/หมดอายุ = 404 `no-store`

## 3. Storage + ตาราง

### 3.1 bucket `ring-snapshots` — **private** + เสิร์ฟผ่าน route ของเรา
- migration: `public=false · file_size_limit=262144 · allowed_mime_types={image/jpeg}` (แบบ 0182) · ไม่มี policy บน `storage.objects` ให้ anon/authenticated (เขียน/อ่านผ่าน service role ใน route เท่านั้น)
- ทำไมไม่ public bucket: (1) คุม header ไม่ได้ (nosniff / CSP sandbox กัน polyglot) (2) URL supabase.co โผล่ project ref + ลบแล้ว CDN ของ Supabase อาจยังเสิร์ฟตาม cache (3) โดเมนเดียวกับหน้า = crawler จบใน host เดียว · ข้อแลก: route เพิ่ม 1 ตัว + Vercel invocation (CDN แคชลดให้)
- ทำไมไม่ signed URL ใน og:image: หมดอายุแล้วรูปที่แอดมินเปิดทีหลังพัง

### 3.2 ตาราง `analytics.ring_snapshot` (migration เลขใหม่ — ห้ามแก้ 0196)
| คอลัมน์ | ชนิด | หมายเหตุ |
|---|---|---|
| id | text PK | 22 ตัว base64url จาก `gen_random_bytes(16)` (128 bit) · check regex · สร้างใน DB ไม่รับจาก client |
| shop_id | uuid FK shop | จาก env |
| choice_code | text | `p` ที่ผ่านด่านแล้ว · check `length <= 160` + regex รูปร่าง |
| design_id | text | แยกเก็บไว้สรุปภายหลัง (ไม่ใช้ตัดสินอะไร) |
| created_at / expires_at | timestamptz | expires_at = created_at + TTL `[ต้องยืนยัน]` ค่าเริ่ม 90 วัน |

RPC ทุกตัว: security definer · pin search_path · revoke `public, anon, authenticated` · grant `service_role` เท่านั้น (skill migration-traps ข้อ 2/18) · validate ตัวเลขด้วย `not (between)`
- `ring_snapshot_create(p_shop_id, p_choice_code, p_design_id) returns text` — รูปร่างผิด 22023 · **breaker** แถวใหม่ต่อร้าน ≥ 60 / 10 นาที หรือ ≥ 500 / 24 ชม. → P0001 `[ตัวเลขต้องยืนยัน — เทียบยอดเข้าหน้าจริง]`
- `ring_snapshot_get(p_shop_id, p_id)` — เฉพาะยังไม่หมดอายุ
- `ring_snapshot_delete(p_shop_id, p_id)` (ตอน upload ล้ม) · `ring_snapshot_expired(p_shop_id, p_limit)` + `ring_snapshot_purge(p_shop_id, p_ids)`
- ทำไมต้องมีตาราง (ไม่ใช่ storage อย่างเดียว + choice ใน URL): (1) breaker นับได้ atomic — นับไฟล์ใน storage ช้าและไม่ atomic (2) ผูกภาพกับ choice ฝั่ง server ไม่ให้ใครต่อรายละเอียดใหม่บนรูปคนอื่น (3) TTL ต้องรู้อายุ · ข้อแลก: migration + verify ตาม skill `3j-migration-traps`
- **ไม่เก็บ** IP / User-Agent / cookie / ชื่อ / เบอร์ (แนวเดียวกับ 0193)

### 3.3 ลบอัตโนมัติ
พ่วงในทุก POST ที่สำเร็จ: `ring_snapshot_expired(20)` → `storage.remove(paths)` → สำเร็จค่อย `purge` (ล้มกลางทาง = แถวยังอยู่ รอบหน้าลองใหม่ · ไม่มีไฟล์กำพร้าที่ไม่มีแถว) · ไม่ใช้ pg_cron / Vercel Cron (repo ยังไม่มี · YAGNI) — ข้อแลก: ช่วงไม่มีคนใช้ = ไม่ลบ (ค้างแต่ไม่โต · รับได้) · หน้า preview/route รูปเช็ก `expires_at` เอง จึงไม่เสิร์ฟของหมดอายุแม้ยังไม่ถูกลบ (ยกเว้น CDN cache ≤ 24 ชม.)

## 4. Security — เคสที่ห้ามผ่าน + ด่านที่ตก

| # | เคส | ต้องได้ | ตกที่ |
|---|---|---|---|
| S1 | body เป็น PNG / GIF / WebP / SVG / HTML / PDF / ว่าง | 415 / 400 | ด่าน 2 (Content-Type) + ด่าน 5 (magic bytes) — ไม่เชื่อ header อย่างเดียว |
| S2 | polyglot: JPEG ต่อท้ายด้วย HTML/JS หรือซ่อนใน COM/APPn | ไม่ถูกตีความเป็น HTML ที่ใดเลย | `cleanJpegForStorage` ตัด segment · route รูปส่ง `nosniff` + `CSP sandbox` + Content-Type ตายตัว · bucket mime = jpeg |
| S3 | ไฟล์ > 256 KB · chunked ไม่มี content-length · content-length โกหก · body หยดช้า | 413 / 408 ไม่กิน RAM | ด่าน 4 (stream cap + เส้นตาย) + bucket file_size_limit |
| S4 | JPEG มิติไม่ใช่ 1200x630 | 400 | ด่าน 5 |
| S5 | ยิงรัว (สคริปต์ส่งซ้ำพันครั้ง) | เกิน cap = 429 ไม่มีไฟล์ใหม่ | breaker ใน RPC **ก่อน** upload (ด่าน 6) · เสริม Vercel Firewall rate limit path นี้ถ้า plan รองรับ (L5) · ⚠️ breaker เป็นเพดานรวมร้าน → ผู้โจมตีทำให้ฟีเจอร์หยุดได้ แต่ผลคือปุ่มกลับเป็นข้อความเดิม (ตั้งใจ — รับได้ · ไม่เก็บ IP จึงทำ per-IP ไม่ได้) |
| S6 | ใช้โดเมนเราฝากรูปอะไรก็ได้ (ภาพไม่เหมาะสมขนาด 1200x630 ถูกต้อง) | จำกัดความเสียหาย | ตรวจเนื้อภาพไม่ได้ (ยอมรับ) → ลดมูลค่า: id สุ่ม 128 bit ไม่มีหน้า list · noindex ทั้งหน้าและรูป · TTL · breaker · ป้าย "ภาพจำลองที่ลูกค้าจัดเอง" · ลบรายตัวได้ · 🔴 **ห้ามทำเป็น cache ร่วมตาม choice** (id = hash ของ choice) — คนแรกอัปรูปปลอม คนหลังที่เลือกชุดเดียวกันได้รูปนั้น |
| S7 | เดา/ไล่ id | 404 | 128 bit จาก DB · ไม่มี list endpoint · regex ก่อนแตะ DB · คำตอบเหมือนกันทั้ง "ไม่มี" และ "หมดอายุ" |
| S8 | path traversal `/ring/..%2f..` · `/ring/<id>/../../dashboard` · id มี `/` `.` `%` | 404 / 307 | regex id ทั้ง page + route รูป · object path สร้างจาก id ของ DB เท่านั้น (ไม่มี input client ใน path) · allowlist tools. anchored |
| S9 | ปลอมรายละเอียด/ราคาบนหน้า preview (ส่ง `p` แปลก · เติม query) | ได้แค่ combination ที่ถูกตาม whitelist · ราคา = ของแบบนั้นจาก config | หน้า preview **ไม่อ่าน query เลย** · รายละเอียดสร้างจาก choice_code ผ่าน parser + `buildShowcaseDetailRows` · ราคา `formatPriceThb(designId)` เท่านั้น · ระบบไม่มีช่องข้อความอิสระ |
| S10 | ส่ง `shop_id` / `id` / `expires_at` มาเอง | ไม่มีผล | route ไม่อ่าน · RPC สร้าง id/expiry เอง |
| S11 | cross-origin POST (เว็บอื่นยิงผ่านเบราว์เซอร์เหยื่อ) | 403 | ด่าน 1 |
| S12 | POST พร้อม header next-action ไป /ring/(id) บน tools. หรือ app. | action ไม่รัน | กฎเดิมของ tools. (T8) + graph test ของ (quiz) — ห้ามไฟล์ use-server ใต้ app/(quiz)/ring/ |
| S13 | response ของ 3 path ใหม่มี header Set-Cookie | ห้ามมี | tools.: middleware return ก่อนสร้าง client · app.: path ใหม่อยู่ใน exempt matcher — test ทั้งสอง host |
| S14 | หน้า /ring/(id) ถูกฝัง iframe | ห้าม | XFO DENY + CSP frame-ancestors none (เหมือน /ring-builder) |
| S15 | id รั่วผ่าน Referer เมื่อกดลิงก์ออกจากหน้า preview | ไม่รั่ว | Referrer-Policy no-referrer |
| S16 | log error ทั้งก้อน / log choice_code คู่ id | ไม่มี | log เฉพาะ code (memory supabase-error-logging-trap) |
| S17 | `/ring/x.png` · `/ring/<id>/x` · `/ring/<id>/og.png` · `/ringx/<id>` · `/ring` | app. = gate · tools. = 307 | regex exempt 2 รูปแบบ exact ไม่ใช่ subtree — เพิ่มเคสใน `exempt-path.test` + matcher compile test (บทเรียน H1 นามสกุลรูป) |

**ต้องไม่พัง** (สำคัญเท่ากัน):
- N1 ปุ่ม LINE เมื่อไม่มีรูป (WebGL ไม่ได้ · 429 · offline · timeout · สวิตช์ปิด) = **href byte เดิม** ของวันนี้ · ปุ่มเป็น `<a>` ไม่ disabled ไม่รอ
- N2 ลิงก์ /ring-builder เดิมทุกรูปแบบ query (t/i/q/g/c/d/r) · app.→tools. 307 · QR การ์ดขอบคุณ
- N3 smoke tools.: hub · 3 หน้า · submit quiz · beacon ring-size · quote · og.png ring-size · header /ring-builder เดิม — test `tools-host` / `exempt-path*` เดิมเขียวโดยไม่แก้เคสเก่า
- N4 การหมุน/ลากไม่สะดุด ไม่เห็นภาพกระโดดตอนจับภาพ (เครื่องจริง Android ระดับกลาง + iPhone)
- N5 `RingViewer` ยังไม่ fetch อะไร — upload อยู่นอก viewer

## 5. ไฟล์ที่ต้องสร้าง/แก้

| path | หน้าที่ |
|---|---|
| `supabase/migrations/NNNN_ring_snapshot.sql` + `scripts/verify/verify-NNNN.sql` | ตาราง + bucket + 5 RPC + grant · verify: breaker / regex id / หมดอายุ / grant 3 ชื่อ / ตารางแมปข้อ→เทสต์ |
| `lib/ring-builder/viewer/gl-renderer.ts` (+test) | `captureFront()` (ต้อง TL อนุมัติ — §2.1) |
| `app/(quiz)/ring-builder/_components/RingViewer.tsx` · `RingStage.tsx` | ส่ง capture handle ขึ้นผ่าน `onCaptureReady` · ไม่ ready = null |
| `lib/ring-builder/snapshot/compose.ts` | RGBA → canvas 2D + ป้าย → Blob |
| `lib/ring-builder/snapshot/choice-code.ts` (+test) | serialize/parse `p` (pure · ใช้ทั้ง client / route / หน้า preview) |
| `lib/ring-builder/snapshot/upload-client.ts` (+test) | debounce · dedupe · เพดาน 8 · timeout 6 วิ · ไฟล์เดียวที่มี fetch ของ snapshot |
| `app/(quiz)/ring-builder/RingShowcaseClient.tsx` · `_components/OrderSummary.tsx` | ถือ `{choiceCode → id}` · href/คัดลอกใช้ url ถ้ามี · สถานะใต้ปุ่ม |
| `lib/ring-builder/showcase/line-message.ts` | `snapshotUrl?` + แยก `buildShowcaseDetailRows` |
| `lib/ring-builder/showcase/config.ts` | copy ใหม่ + `SNAPSHOT_ENABLED` (สวิตช์ฝั่ง client) |
| `app/api/ring-builder/snapshot/route.ts` (+test) | §2.3 |
| `app/(quiz)/ring/[id]/page.tsx` · `app/(quiz)/ring/[id]/og.jpg/route.ts` (+test) | §2.5 |
| `lib/site/hosts.ts` · `next.config.mjs` (allowlist + headers) · `middleware.ts` matcher · `lib/auth/exempt-path.ts` | 3 regex ใหม่: `api/ring-builder/snapshot/?$` · `ring/[A-Za-z0-9_-]{22}/?$` · `ring/[A-Za-z0-9_-]{22}/og\.jpg$` — **ต้องตรงกัน 4 ที่** (test drift เดิมจับ) |
| `lib/images/constants.ts` | `RING_SNAPSHOT_BUCKET` · `RING_SNAPSHOT_MAX_BYTES` |

**ไม่ใช้ `sharp` re-encode** (ที่ TL เสนอ): repo ไม่มี native image dependency เลย (รูปใบงาน/แคตตาล็อกใช้ byte-check + strip metadata ที่ผ่าน security แล้ว) · sharp เพิ่ม bundle function หลาย MB + cold start · ความเสี่ยงที่ re-encode กัน (polyglot) ถูกกันด้วย strip + header + mime lock + มิติเป๊ะ · ถ้า security ยืนยันว่าต้อง re-encode → ใส่ในด่าน 5 ได้โดยไม่เปลี่ยนสัญญา

## 6. Phase + QA + ต้นทุน

| Phase | ขอบเขต | QA | ด่านก่อน merge |
|---|---|---|---|
| **P0** | ทดสอบมือใน LINE (§0) + docs-researcher L3 | — | แคปจอถึง TL → เจ้าของตัดสิน |
| **P1** | migration + bucket + endpoint + หน้า preview + route รูป + allowlist 4 ที่ · **ยังไม่มี UI เรียก** | **L** (แตะ allowlist/matcher = ทุก flow ของ tools. + gate ของ app.) | 🔴 **security ผ่านก่อน merge** (anonymous upload สาธารณะครั้งแรกของระบบ) · migration dry-run → `--commit --record` · หลัง merge: QA ยิง endpoint จาก devtools บน tools. prod แล้วส่งลิงก์ใน LINE จริงดูการ์ด (preview deployment อาจติด Vercel Deployment Protection → LINE crawler เข้าไม่ได้ ทดสอบการ์ดบน prod) |
| **P2** | `captureFront` + compose + upload-client + OrderSummary + copy (ux-ui ก่อน — memory ui-through-ux-first) · หลัง §15 merge | **M** + เครื่องจริง iOS / Android / LINE in-app | security ดูฝั่ง client |

ไม่ใช่ 💰: ไม่แตะเงิน/เอกสารภาษี · ราคาแค่แสดงจาก config เดิม
ต้นทุนเพิ่มคร่าวๆ (plan จริง `[ต้องยืนยัน]`): ภาพ ~100 KB × 1,000 ครั้ง/เดือน ≈ 100 MB (TTL 90 วัน ค้างสูงสุด ~300 MB) อยู่ในโควตา Supabase เดิม ≈ 0 THB เพิ่ม · Vercel: 1 invocation/อัปโหลด + หน้า/รูปที่ CDN แคช — หลักพันครั้งต่อเดือน ≈ 0 THB เพิ่มบน plan เดิม

## 7. ความเสี่ยงตอน implement
1. **L2 แอดมินไม่เห็นการ์ด** — ความเสี่ยงสูงสุดและไม่ใช่เรื่องโค้ด → P0 ก่อนเขียนบรรทัดแรก
2. `readPixels` หลังเปลี่ยนขนาด canvas บนมือถือบางรุ่น (หน่วยความจำ/ขนาด framebuffer) → ล้ม = null = ข้อความเดิม · ต้องลองเครื่องจริง · ห้ามเปิด `preserveDrawingBuffer` ถาวรเพื่อแก้
3. ภาพที่ LINE แคชไว้อาจไม่หายแม้เราลบ (L3) → TTL ไม่ใช่การรับประกันว่าภาพหายจากแชต — บอกเจ้าของตรงๆ
4. allowlist 4 ที่ไม่ตรงกัน → tools. ส่งหน้าใหม่ไป hub (fail-closed) หรือ app. gate หน้า preview → test drift เดิมต้องเขียว + เคส S17
5. ชนกับ branch §15 (ราคาต่อแบบ) ที่ `config.ts` · `line-message.ts` · `OrderSummary.tsx` → P2 เริ่มหลัง §15 merge · P1 แตะ line-message เฉพาะ helper → rebase เล็ก
6. breaker cap ต่ำไปวัน broadcast → ลูกค้าบางคนได้ข้อความไม่มีรูป (ไม่พัง) · ปรับเลขใน migration ถัดไป

## 8. คำถามเจ้าของ (ระหว่างรอใช้ค่าเริ่ม — ไม่บล็อก P1 ยกเว้นข้อ 1)
1. ทำ P0 ให้ได้ไหม (ส่งข้อความทดสอบ + แคปจอ 3 จุด) — **บล็อกทั้งงาน**
2. เก็บรูปนานเท่าไร `[ต้องยืนยัน]` — ค่าเริ่ม 90 วัน
3. ป้าย "ภาพจำลอง · 3J Jewelry" มุมภาพ — โอเคไหม / อยากได้โลโก้แทน
4. ถ้าแอดมินไม่เห็นการ์ดในแชต (ต้องกดลิงก์ดูรูป) ยังเอาทางนี้ไหม หรือไป LIFF (ส่งรูปจริงได้ แต่ใช้ได้เฉพาะเปิดในแอป LINE + งานใหญ่กว่า)
5. path `tools.3jthailand.com/ring/<รหัส>` — ชื่อนี้โอเคไหม (เปลี่ยนได้ก่อน P1 เท่านั้น ลิงก์ที่ส่งไปแล้วต้องอยู่ตลอด TTL)

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // /crm/import posts the raw .xlsx as multipart FormData (design D1 —
      // file_hash needs the raw bytes server-side, so parsing can't move to
      // the client). Real files run ~100-300KB; 4MB is generous headroom
      // over Next's 1MB server action default.
      bodySizeLimit: "4mb",
    },
  },
};

// ───────── โดเมนลูกค้า tools.3jthailand.com (design-tools-hub.md §1) ─────────
// 🔴 กฎของ host นี้ "ตัดสิทธิ์" อย่างเดียว ห้ามให้สิทธิ์เพิ่ม · literal ต้องตรงกับ TOOLS_HOST ใน lib/site/hosts.ts (test ตรวจ drift)
// `has` host ของ Next: lowercase + ตัด :port ให้เอง · anchor ^…$ ให้เอง · "." ท้ายไม่ตัด → ต้องมี `\.?` เอง
export const TOOLS_HOST_REGEX = "tools\\.3jthailand\\.com\\.?";
// ชั้น (1) redirects(): path นอก allowlist บน tools. → 307 "/" (รันก่อน middleware และไม่สน matcher → ครอบ /shop /w/* /api/webhooks ที่ middleware ไม่รัน)
// ⚠️ regex 3 ก้อนต้องตรงกัน: allowlist นี้ · matcher ใน middleware.ts · EXEMPT_PATTERN ใน lib/auth/exempt-path.ts
//    เพิ่มหน้าลูกค้าใหม่ = แก้ 3 ที่ (ลืมที่นี่ = หน้าใหม่ถูกส่งไป hub บน tools. · fail-closed) · test: lib/site/tools-host.test.ts
// หน้าแรก "" ($) = hub (middleware rewrite → /tools) · `_next/static/` ต้องมี "/" ต่อท้าย (ไม่ใช่ prefix _next/staticx)
// ⚠️ ชั้น (2) ใน middleware.ts ใช้รายการเดียวกัน (lib/site/hosts.ts TOOLS_PASSTHROUGH_ALTERNATIVES) — test ตรวจให้ตรงกัน (security M1: ห้ามพึ่งชั้น (1) ชั้นเดียว)
export const TOOLS_ALLOWLIST_ITEMS = [
  "$",
  "ring-size/?$",
  "gem-quiz/?$",
  "ring-builder/?$",
  "api/gem-quiz/submit/?$",
  "api/ring-size/event/?$",
  "api/ring-builder/quote/?$",
  "_next/static/",
  "_next/image/?$",
  "[^/]+\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$",
  "gem-quiz/[^/]+\\.(?:svg|png|jpg|jpeg|webp)$",
  "ring-size/[^/]+\\.(?:svg|png|jpg|jpeg|webp)$",
];
export const TOOLS_ALLOWLIST = TOOLS_ALLOWLIST_ITEMS.join("|");
const TOOLS_HOST_HAS = [{ type: "host", value: TOOLS_HOST_REGEX }];
const HUB_FRAME_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];
// ───────── P2 (design-tools-hub §1.2) ชั้น (3): app.3jthailand.com → tools. ─────────
// 🔴 ปลายทาง "ตายตัวทั้งก้อน" (literal origin + literal path ต่อ rule · ไม่มี :path/:param ในปลายทาง) → ไม่เป็น open redirect ไม่ว่า request มาแบบไหน
//    4 path exact เท่านั้น (ไม่ใช่ subtree: /ring-size/og.png · /api/* · /w/* · /gem-quiz/x ไม่โดน) · API ไม่ redirect (ใครเปิดหน้าค้างบน app. ยัง submit ได้)
// has host = app. เท่านั้น → tools. (ไม่โดน = ไม่วน) · localhost / *.vercel.app ไม่ตรง → เสิร์ฟตรงเหมือนเดิม (N2) · literal ต้องตรง APP_HOST/TOOLS_ORIGIN ใน lib/site/hosts.ts (test ตรวจ drift)
// 307 ไม่ใช่ 308 (ถอยได้) · query ส่งต่อทั้งก้อนโดย Next (ไม่ parse → ไม่ผูกรายชื่อ key ของ ring-builder t/i/q/c/d/r) · method คงเดิม (POST ไม่กลายเป็น GET)
// 🔴 ต้องอยู่ตลอดไป — QR บนการ์ดขอบคุณที่พิมพ์แล้ว + ลิงก์ที่แจกไปแล้วชี้ app.
export const APP_HOST_REGEX = "app\\.3jthailand\\.com\\.?";
const APP_HOST_HAS = [{ type: "host", value: APP_HOST_REGEX }];
const TOOLS_ORIGIN_LITERAL = "https://tools.3jthailand.com";
export const APP_TO_TOOLS_REDIRECTS = [
  { source: "/ring-size", destination: `${TOOLS_ORIGIN_LITERAL}/ring-size` },
  { source: "/gem-quiz", destination: `${TOOLS_ORIGIN_LITERAL}/gem-quiz` },
  { source: "/ring-builder", destination: `${TOOLS_ORIGIN_LITERAL}/ring-builder` },
  { source: "/tools", destination: `${TOOLS_ORIGIN_LITERAL}/` },
].map((r) => ({ ...r, has: APP_HOST_HAS, permanent: false }));

nextConfig.redirects = async () => [
  // T8 (พบจริงตอน smoke บน next start): Next หา Server Action ตาม id จาก "ทุก worker" ไม่ผูกกับหน้า — POST + Next-Action (id จริงของหลังบ้าน) ไป
  // /ring-size /gem-quiz /ring-builder (exempt · ไม่มี middleware) แล้ว action รันได้ · หน้าลูกค้า 3 หน้าไม่มี action ของตัวเอง → บน tools. ทุก request ที่มี
  // header next-action ต้องถูกตัดทิ้งก่อนถึง handler (ตัดสิทธิ์อย่างเดียว) · 307 คง method → "/" → middleware 405 · source เป็น /:path+ (ไม่ครอบ "/") กัน redirect วนตัวเอง — POST "/" ตกชั้น (2) ได้ 405
  { source: "/:path+", has: [...TOOLS_HOST_HAS, { type: "header", key: "next-action" }], destination: "/", permanent: false },
  { source: `/((?!${TOOLS_ALLOWLIST}).*)`, has: TOOLS_HOST_HAS, destination: "/", permanent: false },
  ...APP_TO_TOOLS_REDIRECTS,
];

// หน้าช่าง /w/<token>: token อยู่ใน URL → ห้ามรั่วผ่าน Referer · ห้าม search engine เก็บ · ห้ามแคช (security J1 §5.5)
// L3 (12 ต.ค.): ห้ามถูกฝังใน iframe/เว็บอื่น (clickjacking ปุ่มรับงาน/ส่งต่อ + ช่องใส่ PIN) — ทั้ง X-Frame-Options (เบราว์เซอร์เก่า) และ CSP frame-ancestors (มาตรฐานปัจจุบัน)
nextConfig.headers = async () => [
  {
    source: "/w/:path*",
    headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      { key: "Cache-Control", value: "no-store, max-age=0" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ],
  },
  // เครื่องมือวัดไซส์แหวน /ring-size (หน้าสาธารณะ): คำสัญญา "ไม่ใช้กล้อง" ต้องมีด่านที่ระดับเบราว์เซอร์ด้วย
  // ไม่ใช่แค่ไม่มีโค้ดเรียกกล้อง — exact path เท่านั้น (ไม่ใช่ /ring-size/:path*) · 3 header: Permissions-Policy + X-Frame-Options + CSP frame-ancestors (ไม่มี CSP ตัวอื่น)
  // (Next ถือ "/ring-size/" เป็นหน้าเดียวกัน — regex ที่ build ได้คือ ^/ring-size(?:/)?$ · ดูเทสต์ lib/ring-size/headers.test.ts)
  // security L1: ห้ามถูกฝังใน iframe (clickjacking) — ทั้ง X-Frame-Options และ CSP frame-ancestors (เหมือนหน้าช่างด้านบน)
  //   ตอนนี้ยังไม่มีแผนฝังใน Wix — ถ้าวันหน้าจะฝัง ต้องเปลี่ยนสองค่านี้ (และให้ security ตรวจ) ไม่ใช่ลบทิ้งเงียบๆ
  // security L2: header ติดเฉพาะตอน "โหลดหน้าเต็ม" — ลิงก์ที่ชี้มา /ring-size จากหน้าอื่นในแอปต้องใช้ <a href> ธรรมดา
  //   ไม่ใช่ next/link (client-side navigation ไม่ดึง response ใหม่ จึงไม่ได้ header) · ตอนนี้ในแอปไม่มีลิงก์แบบนั้น
  {
    source: "/ring-size",
    headers: [
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ],
  },
  // หน้าแบบแหวน /ring-builder (สาธารณะ · D1 demo): security L1 12 พ.ย. — ห้ามถูกฝังใน iframe (clickjacking ปุ่มส่ง LINE)
  // exact path เหมือน /ring-size · ลิงก์จากหน้าผล quiz เป็น <a href> ธรรมดา header จึงติด
  {
    source: "/ring-builder",
    headers: [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ],
  },
  // หน้ารวมเครื่องมือลูกค้า (hub) — ห้ามฝัง iframe (design-tools-hub §2) · /tools ทุก host (ใช้ดูบน app./preview)
  // "/" + host tools. แยกอีก rule: headers() จับ path ก่อน middleware rewrite "/" → /tools จึงต้องมี rule "/" เอง
  { source: "/tools", headers: HUB_FRAME_HEADERS },
  { source: "/", has: TOOLS_HOST_HAS, headers: HUB_FRAME_HEADERS },
];

export default nextConfig;

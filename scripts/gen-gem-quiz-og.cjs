// scripts/gen-gem-quiz-og.mjs
//
// สร้าง public/gem-quiz/og.png — รูปพรีวิวตอนแชร์ลิงก์ /gem-quiz (LINE/
// Facebook ดึงจาก og:image) ที่เดิมเป็นไฟล์ placeholder 68 bytes.
//
// 🔴 ทำไมต้องเป็น static file generator ไม่ใช่ app/(quiz)/gem-quiz/
// opengraph-image.tsx (Next.js convention ปกติ): matcher exempt ของ
// middleware.ts เป็น exact path เท่านั้น (gem-quiz/?$) — route ใหม่แบบ
// opengraph-image จะกลายเป็น sub-route ที่ไม่ exempt แล้วโดนเด้ง /login ตอน
// LINE/Facebook ยิง request มาดึงรูป (ไม่มี session) ดู page.tsx's comment
// ที่ห้ามไว้แล้วชัดเจน — ทางที่ถูกต้องคือ generate ไฟล์ไว้ล่วงหน้าแล้วเสิร์ฟ
// เป็น static asset ธรรมดาผ่าน public/ (ไม่ใช่ route ที่ middleware ต้องตัดสินใจ)
//
// รันด้วย: node scripts/gen-gem-quiz-og.cjs
// (.cjs ไม่ใช่ .mjs — "next/og" ไม่มี export subpath สำหรับ ESM resolution
// ตรงๆ ใน package.json ของ next เจอ ERR_MODULE_NOT_FOUND ถ้าใช้ import)
//
// ขอบเขตตั้งใจ "ง่ายๆ ก่อน" ตามที่เจ้าของสั่ง 5 ต.ค. 69:
//   - พื้นหลังสีแบรนด์ #a2191d (เฉดเดียวกับทั้งเว็บ — ไม่ใช่ Burgundy ของ
//     แพ็กเกจ ตาม O1 เดิม) ไล่เฉดเข้มที่มุมให้มีมิติเล็กน้อย
//   - ข้อความภาษาอังกฤษล้วน (DAILY GEM QUIZ / 3J JEWELRY) — Satori (ตัว
//     render JSX→SVG ของ ImageResponse) ต้องโหลดไฟล์ฟอนต์เองถึงจะวาดภาษาไทย
//     ได้ถูกต้อง ไม่งั้นได้กล่องเปล่า (tofu) — รอบนี้เลี่ยงความเสี่ยงนั้นไปก่อน
//     ถ้าอยากได้ข้อความไทย ("วันนี้คุณควรใส่พลอยอะไร?") ในรอบหน้า ต้องโหลด
//     font file จริง (Noto Serif Thai ตัวเดียวกับที่หน้าเว็บใช้) ส่งเข้า
//     ImageResponse's `fonts` option
//   - วงกลม enso + ประกายดาว วาดด้วย SVG ตรงๆ (ชุดเดียวกับโลโก้จริงที่ใช้ใน
//     components/brand/Logo.tsx แต่ทำเป็น vector ง่ายๆ ไม่ใช้ไฟล์ภาพ raster
//     ของโลโก้จริง เพราะ ImageResponse โหลดรูปจากดิสก์ตรงๆ ไม่ได้ง่ายเท่า inline SVG)
//   - จุดสี 5 สีแทนพลอยทั้ง 5 ตัว (สีเดียวกับ GEM_QUIZ_STONES.colors.base)
const { writeFileSync, mkdirSync } = require("node:fs");
const { dirname, join } = require("node:path");
const { ImageResponse } = require("next/og");

const OUT_PATH = join(__dirname, "..", "public", "gem-quiz", "og.png");

const BRAND_RED = "#a2191d";
const BRAND_RED_DARK = "#650A0D";
const IVORY = "#FAF8F4";

// สีพลอย 5 ตัว — คัดลอกจาก lib/gem-quiz/config.ts's colors.base ตรงๆ (ไฟล์นี้
// รันนอก Next.js build graph จึงไม่ import TS โดยตรง คัดลอกแค่ hex 5 ค่า)
const GEM_COLORS = ["#A3192B", "#6E3FA6", "#D99A2B", "#7DA331", "#2E86C6"];

const element = {
  type: "div",
  props: {
    style: {
      width: "1200px",
      height: "630px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      backgroundImage: `linear-gradient(135deg, ${BRAND_RED} 0%, ${BRAND_RED_DARK} 100%)`,
      fontFamily: "sans-serif",
    },
    children: [
      // enso ring + spark (วาด SVG ตรงๆ แทนโลโก้จริง — ดูคอมเมนต์หัวไฟล์)
      {
        type: "svg",
        props: {
          width: 90,
          height: 90,
          viewBox: "0 0 54 54",
          fill: "none",
          style: { marginBottom: 18 },
          children: [
            { type: "circle", props: { cx: 27, cy: 29, r: 20, stroke: IVORY, strokeWidth: 3.5 } },
            {
              type: "path",
              props: {
                d: "M41 6l1.6 4.4L47 12l-4.4 1.6L41 18l-1.6-4.4L35 12l4.4-1.6z",
                fill: IVORY,
              },
            },
          ],
        },
      },
      {
        type: "div",
        props: {
          style: {
            fontSize: 28,
            letterSpacing: 14,
            color: IVORY,
            opacity: 0.85,
            marginBottom: 8,
          },
          children: "3J  ·  JEWELRY",
        },
      },
      {
        type: "div",
        props: {
          style: {
            fontSize: 96,
            fontWeight: 600,
            color: "#FFFFFF",
            lineHeight: 1.05,
            textAlign: "center",
          },
          children: "DAILY GEM QUIZ",
        },
      },
      {
        type: "div",
        props: {
          style: {
            display: "flex",
            gap: 18,
            marginTop: 36,
          },
          children: GEM_COLORS.map((c) => ({
            type: "div",
            props: {
              style: {
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: c,
                boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
              },
            },
          })),
        },
      },
    ],
  },
};

(async () => {
  const res = new ImageResponse(element, { width: 1200, height: 630 });
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, buf);
  console.log(`เขียนแล้ว: ${OUT_PATH} (${buf.length.toLocaleString()} bytes)`);
})();

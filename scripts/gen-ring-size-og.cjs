// scripts/gen-ring-size-og.cjs
//
// สร้าง public/ring-size/og.png — รูปพรีวิวตอนแชร์ลิงก์ /ring-size (LINE/Facebook ดึงจาก og:image)
// วิธีเดียวกับ scripts/gen-gem-quiz-og.cjs: รูป static ใน public/ สร้างจากสคริปต์ แล้ว commit ทั้งสคริปต์และรูป
//
// 🔴 ทำไมเป็น static file ไม่ใช่ app/(quiz)/ring-size/opengraph-image.tsx: route ใหม่แบบนั้นเป็น sub-route
// ที่ไม่ exempt ใน middleware.ts matcher (exact path เท่านั้น) → LINE ดึงรูปแล้วโดนเด้ง /login · ไฟล์ใน public/ring-size/<file>.png
// อยู่ใต้ exempt อยู่แล้ว (`ring-size/[^/]+\.(svg|png|jpg|jpeg|webp)$` ลึกหนึ่งชั้น — แก้ exempt ไม่ต้อง)
//
// รันด้วย: node scripts/gen-ring-size-og.cjs
//   (.cjs ไม่ใช่ .mjs — "next/og" ไม่มี export subpath สำหรับ ESM ตรงๆ · เหตุผลเดียวกับ gem-quiz)
//   → เขียน public/ring-size/og.png (ตัวหลัก · พื้นครีม) + docs/3j-jewelry/oms/ring-size-og-alt-red.png (ตัวเลือก · พื้นแดงแบรนด์ ไม่ถูกเสิร์ฟ)
//
// 🔴 ถ้อยคำบนรูป = ข้อความที่มีอยู่แล้วบนหน้า /ring-size เท่านั้น (lib/ring-size/config.ts · ห้ามแต่งคำใหม่):
//   - TITLE    = COPY.r0.title      "วัดไซส์แหวนด้วยมือถือ"
//   - SUBTITLE = COPY.r0.descReturn "รู้เบอร์แหวนได้ในไม่กี่นาที ไม่ต้องไปร้าน" (ประโยคแรกของ COPY.r0.desc ที่หน้าแรกแสดง)
//   - ชื่อร้าน "3J Jewelry" = COPY.common.logoAlt (+ โลโก้จริง public/3j-logo.png — ไฟล์ที่เว็บใช้อยู่ ไม่วาดโลโก้เอง)
//   ไฟล์นี้รันนอก Next build graph จึงคัดลอกข้อความ 3 ชุดนี้มา — og-image.test.ts เทียบกับ COPY ให้ (แก้ config ฝั่งเดียวเทสต์ล้ม)
// ไม่มีราคา/โปร/LINE ID/เบอร์/URL/QR/คำว่า "แม่นยำ 100%" · ไม่มีตัวเลขเบอร์แหวนตัวอย่าง
//
// สี: token --rs-* ของหน้าจริง (app/(quiz)/ring-size/layout.tsx) · brand red #a2191d ห้าม re-palette
// ฟอนต์: Noto Serif Thai 600 (scripts/assets/NotoSerifThai-600.ttf — ตัวเดียวกับ gem-quiz · หน้าเว็บใช้ตระกูลเดียวกับหัวข้อ)
const { writeFileSync, mkdirSync, readFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const { ImageResponse } = require("next/og");

const ROOT = join(__dirname, "..");
const OUT_MAIN = join(ROOT, "public", "ring-size", "og.png");
const OUT_ALT = join(ROOT, "docs", "3j-jewelry", "oms", "ring-size-og-alt-red.png");
const FONT_PATH = join(__dirname, "assets", "NotoSerifThai-600.ttf");
const LOGO_PATH = join(ROOT, "public", "3j-logo.png");

const TITLE_LINES = ["วัดไซส์แหวน", "ด้วยมือถือ"]; // TITLE = "วัดไซส์แหวนด้วยมือถือ" (COPY.r0.title) ตัดที่ขอบคำ
const SUBTITLE = "รู้เบอร์แหวนได้ในไม่กี่นาที ไม่ต้องไปร้าน";
const SHOP = "3J Jewelry";

// token จาก ring-size/layout.tsx (ค่าเดียวกัน) + brand red (--gq-burgundy)
const BRAND = "#a2191d";
const BRAND_DARK = "#650A0D";
const BG = "#FBF7F2";
const TEXT = "#2B1E1E";
const TEXT_3 = "#5C4D49";
const GOLD = "#C8A777";
const SURFACE = "#FFFFFF";

const fontData = readFileSync(FONT_PATH);
const logoSrc = `data:image/png;base64,${readFileSync(LOGO_PATH).toString("base64")}`;
// 3j-logo.png = 382×247 (RGBA · เส้นแดงเข้มบนโปร่งใส)
const LOGO_W = 382;
const LOGO_H = 247;

const div = (style, children) => ({ type: "div", props: { style, children } });

/** variant "cream" = ตัวหลัก · "red" = ตัวเลือก */
function build(variant) {
  const red = variant === "red";
  const titleColor = red ? "#FFFFFF" : TEXT;
  const subColor = red ? BG : TEXT_3;
  const shopColor = red ? BG : BRAND;

  const left = div(
    { display: "flex", flexDirection: "column", width: 690, justifyContent: "center" },
    [
      div(
        { fontSize: 34, letterSpacing: 10, color: shopColor, marginBottom: 22, textTransform: "uppercase" },
        SHOP,
      ),
      // ไทยไม่มีช่องว่างคั่นคำ → Satori ไม่ตัดบรรทัดให้ (ล้นไปใต้การ์ดโลโก้) · ตัดเองที่ขอบคำ 2 บรรทัด — ต่อกันต้องได้ TITLE เป๊ะ (og-image.test.ts เช็ค)
      div(
        { display: "flex", flexDirection: "column", fontSize: 120, lineHeight: 1.12, color: titleColor, fontWeight: 600 },
        TITLE_LINES.map((line) => div({ display: "flex" }, line)),
      ),
      div({ fontSize: 44, lineHeight: 1.35, color: subColor, marginTop: 30, fontWeight: 600 }, SUBTITLE),
    ],
  );

  // โลโก้จริงอยู่บนการ์ดขาวกลม (เส้นโลโก้เป็นแดงเข้ม — วางบนพื้นแดงตรงๆ ไม่เห็น)
  const logoCard = div(
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 320,
      height: 320,
      borderRadius: 160,
      background: SURFACE,
      border: `6px solid ${GOLD}`,
    },
    [{ type: "img", props: { src: logoSrc, width: LOGO_W * 0.66, height: LOGO_H * 0.66 } }],
  );

  return div(
    {
      width: "1200px",
      height: "630px",
      display: "flex",
      flexDirection: "column",
      backgroundImage: red
        ? `linear-gradient(135deg, ${BRAND} 0%, ${BRAND_DARK} 100%)`
        : `linear-gradient(${BG}, ${BG})`,
      fontFamily: "Noto Serif Thai",
    },
    [
      div(
        {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexGrow: 1,
          padding: "0 90px 0 96px",
        },
        [left, logoCard],
      ),
      // แถบล่าง: ตัวหลักใช้แดงแบรนด์ · ตัวเลือกใช้เส้นทองบางๆ (ตกแต่งเท่านั้น)
      div({ display: "flex", height: red ? 12 : 22, backgroundColor: red ? GOLD : BRAND }, []),
    ],
  );
}

async function render(variant, outPath) {
  const res = new ImageResponse(build(variant), {
    width: 1200,
    height: 630,
    fonts: [{ name: "Noto Serif Thai", data: fontData, weight: 600, style: "normal" }],
  });
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);
  console.log(`เขียนแล้ว: ${outPath} (${buf.length.toLocaleString()} bytes)`);
}

(async () => {
  await render("cream", OUT_MAIN);
  await render("red", OUT_ALT);
})();

// scripts/smoke-tools-host.mjs — smoke ตาราง Host x path (design-tools-hub §4 · §7)
// ใช้: node scripts/smoke-tools-host.mjs --base http://localhost:3000 [--with-post]
//   --base   ที่อยู่ที่ต่อ TCP จริง (next start / prod) · Host header ส่งตามตารางเอง (เคสละ host) — ยิง prod: --base https://tools.3jthailand.com
//   --with-post  เพิ่มเคส T8 (POST + Next-Action ปลอม ไปที่ "/" และ /ring-size) — ไม่แตะ DB (id ปลอม) · ไม่ใส่ = GET/HEAD เท่านั้น
// 🔴 ต้องรันบน `next start` (ไม่ใช่ dev) · preview *.vercel.app ทดสอบกฎ host ไม่ได้ · ไม่เขียน DB · exit 1 ถ้ามีเคสไม่ตรง
import http from "node:http";
import https from "node:https";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = new URL(opt("--base", "http://localhost:3000"));
const withPost = args.includes("--with-post");

function req(method, host, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = base.protocol === "https:" ? https : http;
    const r = lib.request(
      { hostname: base.hostname, port: base.port || undefined, method, path, headers: { host, ...headers }, timeout: 20000 },
      (res) => {
        res.resume();
        res.on("end", () =>
          resolve({ status: res.statusCode, location: res.headers.location ?? null, setCookie: res.headers["set-cookie"] ?? null, headers: res.headers }),
        );
      },
    );
    r.on("timeout", () => r.destroy(new Error("timeout")));
    r.on("error", reject);
    if (method === "POST") r.write("[]");
    r.end();
  });
}

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const TOOLS = "tools.3jthailand.com";
const TO_ROOT = (r) => r.status === 307 && (r.location === "/" || r.location === `https://${TOOLS}/`);
const OK = (r) => r.status === 200;

/** [host, path, label, check] — host tools. ทุกรูปแบบ */
const toolsRows = [];
const toolsHosts = [TOOLS, "TOOLS.3JTHAILAND.COM", "tools.3jthailand.com.", `${TOOLS}:443`];
// Next normalize "//x" "/x//" "/x/" ด้วย 308 ก่อนถึง redirects() — เคสเหล่านี้ตามต่ออีกไม่เกิน 3 hop แล้วต้องจบที่ 307 "/" (หรือ 200 สำหรับหน้าลูกค้า) ห้ามได้หน้าหลังบ้าน
const followPaths = new Set(["//dashboard", "/ring-size//", "/tools/"]);
const redirectPaths = [
  "/dashboard", "/catalog/x", "/oem", "/jobs/1/print", "/login", "/register", "/pending", // T1 T2
  "/shop", "/stock/hero", `/w/${TOKEN}`, `/w/s/${TOKEN}`, // T3
  "/api/webhooks/x", "/api/ring-size", "/api/ring-builder/quote/x", "/api/gem-quiz/submitx", // T4
  "/Dashboard", "/RING-SIZE", "/Gem-Quiz", // T5
  "/ring-size/../dashboard", "/ring-size/..%2fdashboard", "/%2e%2e/dashboard", "//dashboard", "/ring-size//", // T6
  "/ring-size/x", "/gem-quiz/deep/x.png", "/ring-builders", "/tools/x", "/toolsx", "/tools", "/tools/", // T7
];
for (const p of redirectPaths) toolsRows.push([TOOLS, p, followPaths.has(p) ? "308 normalize → … → 307 / หรือ 200 หน้าลูกค้า" : "→ 307 /", followPaths.has(p) ? "FOLLOW" : TO_ROOT]);
// T9: host รูปแบบอื่นต้องได้พฤติกรรมเดียวกัน
for (const h of toolsHosts.slice(1)) {
  for (const p of ["/dashboard", "/shop", "/login"]) toolsRows.push([h, p, "→ 307 /", TO_ROOT]);
}
// N4: เปิดได้
for (const p of ["/", "/ring-size", "/gem-quiz", "/ring-builder", "/ring-size/og.png", "/gem-quiz/og.png", "/3j-logo.png"]) {
  toolsRows.push([TOOLS, p, "200", OK]);
}
// favicon.ico exempt แต่ไม่มีไฟล์ใน public/ → 404 ทุก host (ไม่ใช่ 307) — ตรวจแค่ว่าไม่ถูกส่งไป hub/ไม่เปิดหน้าอื่น
toolsRows.push([TOOLS, "/favicon.ico", "exempt: 404 ไม่ใช่ redirect", (r) => r.status === 404 || r.status === 200]);
for (const h of toolsHosts.slice(1)) toolsRows.push([h, "/", "200 hub", OK]);

const rows = [];
for (const [h, p, label, check] of toolsRows) rows.push({ host: h, method: "GET", path: p, label, check });

// T10/T11: host ปลอมที่ไม่ใช่ tools. ต้องไม่ได้พฤติกรรม tools. (dashboard ต้องไม่ถูกส่งไป hub)
for (const h of ["evil-tools.3jthailand.com", "tools.3jthailand.com.evil.com", "xtools.3jthailand.com"]) {
  rows.push({ host: h, method: "GET", path: "/dashboard", label: "ไม่ใช่ tools. (ไม่ 307 → /)", check: (r) => !TO_ROOT(r) });
}
// P2 (18 พ.ย. 69) — app.3jthailand.com → 307 tools. (ปลายทางตายตัว · query ส่งต่อทั้งก้อน) · localhost/preview เสิร์ฟตรง (N2)
const Q = "t=gac.acp.cpb.bgc.pab.gpa&i=love&q=love&c=1&d=2&r=3";
const TO_TOOLS = (path) => (r) => r.status === 307 && r.location === `https://${TOOLS}${path}`;
const appHosts = ["app.3jthailand.com", "APP.3JTHAILAND.COM", "app.3jthailand.com.", "app.3jthailand.com:443"];
for (const h of appHosts) {
  rows.push({ host: h, method: "GET", path: "/ring-size", label: "P2 → 307 tools./ring-size", check: TO_TOOLS("/ring-size") });
  rows.push({ host: h, method: "GET", path: "/gem-quiz", label: "P2 → 307 tools./gem-quiz", check: TO_TOOLS("/gem-quiz") });
  rows.push({ host: h, method: "GET", path: "/ring-builder", label: "P2 → 307 tools./ring-builder", check: TO_TOOLS("/ring-builder") });
  rows.push({ host: h, method: "GET", path: "/tools", label: "P2 → 307 tools./", check: TO_TOOLS("/") });
}
rows.push({ host: "app.3jthailand.com", method: "GET", path: `/ring-builder?${Q}`, label: "N5 query คงเดิมทั้งก้อน", check: TO_TOOLS(`/ring-builder?${Q}`) });
rows.push({ host: "app.3jthailand.com", method: "GET", path: "/gem-quiz?utm_source=qr&x=%E0%B8%81", label: "N5 query (percent-encoded) คงเดิม", check: TO_TOOLS("/gem-quiz?utm_source=qr&x=%E0%B8%81") });
rows.push({ host: "app.3jthailand.com", method: "HEAD", path: "/ring-size", label: "P2 HEAD → 307", check: TO_TOOLS("/ring-size") });
// open redirect / ปลายทางต้องไม่ขยับตาม input: path/query/header แปลกๆ ได้ปลายทาง host เดิมเสมอ
for (const p of ["/ring-size?next=https://evil.example/", "/ring-size?redirect=//evil.example", "/ring-builder?t=//evil.example"]) {
  rows.push({ host: "app.3jthailand.com", method: "GET", path: p, label: "ไม่ open redirect (host ปลายทางตายตัว)", check: (r) => r.status === 307 && new URL(r.location).origin === `https://${TOOLS}` && new URL(r.location).pathname === p.split("?")[0] });
}
rows.push({ host: "app.3jthailand.com", method: "GET", path: "/ring-size", headers: { "x-forwarded-host": "evil.example", origin: "https://evil.example" }, label: "ไม่เชื่อ x-forwarded-host/Origin", check: TO_TOOLS("/ring-size") });
// ไม่วน: ปลายทางบน tools. ได้ 200 (หรือ hub) ไม่ใช่ 307 อีก
for (const p of ["/ring-size", "/gem-quiz", "/ring-builder", "/"]) rows.push({ host: TOOLS, method: "GET", path: p, label: "tools. ปลายทางไม่ redirect ซ้ำ (ไม่วน)", check: OK });
// ต้องไม่พัง: API ไม่ redirect · asset ไม่ redirect · หลังบ้านบน app. ไม่ถูกส่งไป tools./hub
rows.push({ host: "app.3jthailand.com", method: "GET", path: "/api/ring-size/event", label: "API ไม่ redirect (405/อื่น ไม่ใช่ 307)", check: (r) => r.status !== 307 && r.status !== 308 });
rows.push({ host: "app.3jthailand.com", method: "GET", path: "/api/ring-builder/quote", label: "API ไม่ redirect", check: (r) => r.status !== 307 && r.status !== 308 });
rows.push({ host: "app.3jthailand.com", method: "GET", path: "/api/gem-quiz/submit", label: "API ไม่ redirect", check: (r) => r.status !== 307 && r.status !== 308 });
for (const p of ["/ring-size/og.png", "/gem-quiz/og.png", "/3j-logo.png"]) rows.push({ host: "app.3jthailand.com", method: "GET", path: p, label: "asset บน app. ยัง 200 (การ์ด OG เก่า)", check: OK });
for (const p of ["/ring-size/x", "/gem-quiz/deep", "/ring-builders", "/toolsx", "/tools/x"]) rows.push({ host: "app.3jthailand.com", method: "GET", path: p, label: "look-alike ไม่โดน P2 (ไม่ 307 → tools.)", check: (r) => !(r.location ?? "").startsWith(`https://${TOOLS}`) });
for (const p of ["/dashboard", "/login", "/shop", "/stock/hero", `/w/${TOKEN}`]) rows.push({ host: "app.3jthailand.com", method: "GET", path: p, label: "หลังบ้าน/หน้าอื่นบน app. ไม่ถูกส่งไป tools./hub", check: (r) => !TO_ROOT(r) && !(r.location ?? "").startsWith(`https://${TOOLS}`) });
// host ปลอม (look-alike app.) ไม่โดน P2 · localhost = เสิร์ฟตรง
for (const h of ["evil-app.3jthailand.com", "app.3jthailand.com.evil.com", "xapp.3jthailand.com"]) rows.push({ host: h, method: "GET", path: "/ring-size", label: "look-alike app. ไม่โดน P2", check: (r) => !(r.location ?? "").startsWith(`https://${TOOLS}`) });
for (const h of ["localhost", "oms-3j.vercel.app"]) {
  rows.push({ host: h, method: "GET", path: "/tools", label: "N2 200 hub (ไม่ redirect)", check: OK });
  rows.push({ host: h, method: "GET", path: "/ring-size", label: "N2 200 (ไม่ redirect)", check: OK });
  rows.push({ host: h, method: "GET", path: "/gem-quiz", label: "N2 200 (ไม่ redirect)", check: OK });
  rows.push({ host: h, method: "GET", path: `/ring-builder?${Q}`, label: "N2 200 (ไม่ redirect)", check: OK });
  rows.push({ host: h, method: "GET", path: "/dashboard", label: "ไม่ถูกส่งไป hub", check: (r) => !TO_ROOT(r) });
}
if (withPost) {
  const nx = { "next-action": "00deadbeef00deadbeef00deadbeef00deadbeef00", "content-type": "text/plain;charset=UTF-8" };
  rows.push({ host: TOOLS, method: "POST", path: "/", headers: nx, label: "T8 405 ไม่รัน action", check: (r) => r.status === 405 });
  rows.push({ host: TOOLS, method: "POST", path: "/dashboard", headers: nx, label: "T8 → 307 /", check: TO_ROOT });
  rows.push({ host: TOOLS, method: "POST", path: "/ring-size", headers: nx, label: "T8 next-action → 307 / (action ไม่รัน)", check: TO_ROOT });
  // P2: POST ไป app. หน้าลูกค้า → 307 (คง method · ไม่กลายเป็น GET) ไป tools. · ไม่แตะ API (API ไม่อยู่ใน rule)
  rows.push({ host: "app.3jthailand.com", method: "POST", path: "/ring-size", label: "P2 POST → 307 (คง method) tools.", check: TO_TOOLS("/ring-size") });
  rows.push({ host: "app.3jthailand.com", method: "POST", path: "/ring-size", headers: nx, label: "P2 POST+next-action → 307 tools. (action ไม่รันบน app.)", check: TO_TOOLS("/ring-size") });
  rows.push({ host: "app.3jthailand.com", method: "POST", path: "/api/ring-size/event", label: "P2 POST API ไม่ redirect", check: (r) => r.status !== 307 && r.status !== 308 });
}

let failed = 0;
const out = [];
for (const row of rows) {
  let r;
  try {
    r = await req(row.method, row.host, row.path, row.headers ?? {});
  } catch (e) {
    r = { status: `ERR ${e.message}`, location: null, setCookie: null, headers: {} };
  }
  let ok = false;
  let chain = "";
  if (row.check === "FOLLOW") {
    // ตาม 308 สูงสุด 3 hop แล้วต้องไม่ใช่หน้าหลังบ้าน: จบที่ 307 "/" หรือ 200 ของหน้าลูกค้า (ring-size/gem-quiz/ring-builder)
    let cur = r;
    let path = row.path;
    for (let i = 0; i < 3 && cur.status === 308 && cur.location; i++) {
      path = cur.location;
      chain += ` ${cur.status}→${path}`;
      cur = await req(row.method, row.host, path);
    }
    ok = TO_ROOT(cur) || (cur.status === 200 && /^\/(ring-size|gem-quiz|ring-builder)\/?$/.test(path));
    r = { ...cur, status: `${cur.status}${chain}` };
  } else {
  try {
    ok = Boolean(row.check(r));
  } catch {
    ok = false;
  }
  }
  // T12: tools. ห้ามมี set-cookie ทุก response
  const toolsHost = toolsHosts.map((x) => x.toLowerCase()).includes(row.host.toLowerCase());
  const cookieBad = toolsHost && r.setCookie;
  if (!ok || cookieBad) failed++;
  out.push(`${ok && !cookieBad ? "PASS" : "FAIL"}  ${row.method.padEnd(4)} ${row.host.padEnd(34)} ${row.path.padEnd(34)} ${String(r.status).padEnd(4)} ${r.location ?? "-"}  [${row.label}]${cookieBad ? "  SET-COOKIE!" : ""}`);
}
// header hub บน tools. "/" (ผ่าน rewrite) ต้องมี XFO + CSP
try {
  const h = await req("GET", TOOLS, "/");
  const okH = h.headers["x-frame-options"] === "DENY" && /frame-ancestors 'none'/.test(h.headers["content-security-policy"] ?? "");
  if (!okH) failed++;
  out.push(`${okH ? "PASS" : "FAIL"}  GET  ${TOOLS.padEnd(34)} ${"/ (XFO+CSP)".padEnd(34)} ${h.status}`);
} catch (e) {
  failed++;
  out.push(`FAIL  header check: ${e.message}`);
}
console.log(out.join("\n"));
console.log(`\n${rows.length + 1} เคส · ล้ม ${failed}`);
process.exit(failed ? 1 : 0);

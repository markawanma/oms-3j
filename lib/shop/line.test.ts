import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { lineOrderUrl } from "./category";
import { LINE_OA_HANDLE, LINE_OA_ID, LINE_OA_URL, lineOaMessageUrl } from "./line";

// ค่าที่เจ้าของยืนยัน 24 ต.ค. 69
const OWNER_ID = "3jjewelry";
const OWNER_URL = "https://lin.ee/PzIJl6j";

// ประกอบสตริงต้องห้ามแบบแยกชิ้น เพื่อไม่ให้ไฟล์เทสต์นี้ติดการกวาดของตัวเอง
const BANNED = ["3j", "silver"].join("");

const ROOT = resolve(__dirname, "../..");
const SCAN_DIRS = ["app", "lib", "components"];
const SCAN_EXT = /\.(ts|tsx|js|jsx|mjs|css|html|json|md)$/;
const SKIP_DIR = new Set(["node_modules", ".next", ".git"]);

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (SCAN_EXT.test(name)) out.push(full);
  }
}

describe("LINE OA — ค่าเดียวของทั้งแอป", () => {
  it("ค่าตรงกับที่เจ้าของยืนยัน", () => {
    expect(LINE_OA_ID).toBe(OWNER_ID);
    expect(LINE_OA_HANDLE).toBe(`@${OWNER_ID}`);
    expect(LINE_OA_URL).toBe(OWNER_URL);
  });

  it("ลิงก์สั่งซื้อผ่าน LINE ชี้ OA ที่ถูก และ encode ข้อความ", () => {
    const url = lineOrderUrl("แหวนเงิน & ทดสอบ", "R-01");
    expect(url.startsWith(`https://line.me/R/oaMessage/%40${OWNER_ID}/?`)).toBe(true);
    const message = decodeURIComponent(url.split("/?")[1] ?? "");
    expect(message).toBe("สนใจสั่งซื้อ: แหวนเงิน & ทดสอบ (R-01)");
    expect(url).not.toContain(" ");
    expect(url).toBe(lineOaMessageUrl("สนใจสั่งซื้อ: แหวนเงิน & ทดสอบ (R-01)"));
  });

  it("ไม่มีค่า LINE ผิดร้านใน app/ lib/ components/", () => {
    const files: string[] = [];
    for (const d of SCAN_DIRS) walk(join(ROOT, d), files);
    expect(files.length).toBeGreaterThan(100); // กันการกวาดว่างแล้วผ่านเงียบๆ

    const hits = files
      .filter((f) => readFileSync(f, "utf8").toLowerCase().includes(BANNED))
      .map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it("ไม่มีไฟล์ใดนอก lib/shop/line.ts ประกาศ LINE_OA_URL/ID ซ้ำ", () => {
    const files: string[] = [];
    for (const d of SCAN_DIRS) walk(join(ROOT, d), files);
    const dup = files
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/line\.(test\.)?ts$/.test(f))
      .filter((f) => /(const|let|var)\s+LINE_OA_(URL|ID)\b/.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f));
    expect(dup).toEqual([]);
  });
});

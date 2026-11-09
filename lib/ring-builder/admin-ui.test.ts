import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeSize, fmtDiffThb, fmtThb, parseRingTab, parseWholeThb, ringErrorText, RING_ERROR_MESSAGES } from "./admin-ui";

describe("ringErrorText — code ของ DB → ข้อความไทย", () => {
  it("code ที่รู้จักชนะข้อความที่ส่งมา", () => {
    expect(ringErrorText({ error: "raw", code: "design_locked" })).toBe(RING_ERROR_MESSAGES.design_locked);
    expect(ringErrorText({ error: "raw", code: "name_dup" })).toBe("มีรายการชื่อนี้อยู่แล้ว");
    expect(ringErrorText({ error: "x", code: "price_too_fast" })).toContain("ถี่เกินไป");
  });
  it("code ไม่รู้จัก → ใช้ error ที่ action ส่งมา (ซึ่งเป็นข้อความไทยของ server)", () => {
    expect(ringErrorText({ error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้น", code: "zzz" })).toBe("เฉพาะเจ้าของร้าน/แอดมินเท่านั้น");
  });
  it("ไม่มีอะไรเลย → ข้อความกลาง (ไม่ว่าง)", () => {
    expect(ringErrorText(null)).toBe("ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง");
    expect(ringErrorText({ error: "  " })).toBe("ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง");
  });
  it("ทุกข้อความในตารางเป็นภาษาไทย (มีอักขระไทย)", () => {
    for (const [k, v] of Object.entries(RING_ERROR_MESSAGES)) expect(v, k).toMatch(/[฀-๿]/);
  });
});

describe("ตัวจัดรูป/pre-check", () => {
  it("fmtThb / fmtDiffThb แสดงเลขที่ได้มาเท่านั้น", () => {
    expect(fmtThb(1090)).toBe("฿1,090");
    expect(fmtThb(null)).toBe("—");
    expect(fmtDiffThb(20)).toBe("+฿20");
    expect(fmtDiffThb(-1250)).toBe("-฿1,250");
    expect(fmtDiffThb(0)).toBe("—");
    expect(fmtDiffThb(null)).toBe("—");
  });
  it("parseWholeThb: เต็มบาทเท่านั้น ไม่รับทศนิยม/ลบ/ศูนย์/เกินช่วง/ว่าง", () => {
    expect(parseWholeThb("80", 100000)).toBe(80);
    expect(parseWholeThb(" 120 ", 100000)).toBe(120);
    for (const bad of ["", "0", "-5", "9.5", "1e3", "abc", "100001", "08x"]) expect(parseWholeThb(bad, 100000), bad).toBeNull();
  });
  it("composeSize ประกอบ กว้าง×ยาว", () => {
    expect(composeSize(" 4", "3 ")).toBe("4×3");
  });
  it("parseRingTab ไม่รู้จัก → gems", () => {
    expect(parseRingTab("designs")).toBe("designs");
    expect(parseRingTab("verify")).toBe("verify");
    expect(parseRingTab("nope")).toBe("gems");
    expect(parseRingTab(undefined)).toBe("gems");
  });
});

// ---------------------------------------------------------------------------
// boundary: หน้าหลังบ้านนี้คือ "ราคาขาย" — ห้ามลากจอ "ต้นทุน" (/oem/gems) หรือคำนวณเงินใน client
// ---------------------------------------------------------------------------
const ROOT = join(__dirname, "../..");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const UI_FILES = [...walk(join(ROOT, "components/domain/ring-builder/admin")), ...walk(join(ROOT, "app/(dashboard)/catalog/ring-builder")), join(ROOT, "lib/ring-builder/admin-ui.ts")].filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));

describe("boundary หน้า admin ring builder", () => {
  it("พบไฟล์ให้ตรวจ (กันเทสต์ว่างเปล่า)", () => {
    expect(UI_FILES.length).toBeGreaterThanOrEqual(10);
  });
  it("ไม่ import component/ action ต้นทุนของ /oem/gems (GemPriceDialog · GemItemsTable · GemItemDetailDialog · GemCatalogClient · components/domain/gems · lib/actions/gems · lib/jobs/gems)", () => {
    const offenders: string[] = [];
    for (const f of UI_FILES) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/from\s*["']([^"']+)["']/g)) {
        if (/components\/domain\/gems|oem\/gems|lib\/actions\/gems|lib\/jobs\/gem|Gem(PriceDialog|ItemsTable|ItemDetailDialog|CatalogClient)/.test(m[1])) offenders.push(`${f} → ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
  it("ไม่คำนวณเงินใน client: ไม่มี parseFloat/Number()/toFixed/Math.round ในโค้ดหน้า admin", () => {
    const offenders: string[] = [];
    for (const f of UI_FILES) {
      const src = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      if (/parseFloat|\bNumber\(|\.toFixed\(|Math\.(round|floor|ceil)/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
  it("ไม่ import server-only (admin-server) และไม่ import supabase ตรง", () => {
    const offenders: string[] = [];
    for (const f of UI_FILES) {
      const src = readFileSync(f, "utf8");
      if (/admin-server|lib\/supabase|server-only/.test(src.replace(/\/\/.*$/gm, ""))) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});

// lib/marketing/ring-size-stats.guard.test.ts — ด่านกวาดซอร์สของหน้าสรุป /marketing/ring-size (P3)
// เคสห้ามผ่านของ brief: 5 (แถวดิบ/spread) · 6 (log ก้อน error) · 7 (hardcode 45/68) · 8 (dangerouslySetInnerHTML) · 9 (chart lib ใหม่)
// + ข้อกำหนด UX: ไม่ใช้ zinc-400 กับข้อความ · ไม่มีคำต้องห้ามบนจอ · client ไม่มี network/server action/DB
//
// กวาดเฉพาะ "ซอร์สที่ส่งขึ้นจริง" (ไม่รวมไฟล์เทสต์) และตัดคอมเมนต์ก่อน (คอมเมนต์อธิบายกฎได้ ไม่ถูกนับ)
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isExemptPath } from "@/lib/auth/exempt-path";
import { MARKETING_NAV } from "@/lib/marketing/nav";
import { ROOT, listSources, readStripped, rel } from "@/lib/ring-size/source-scan.test-util";

const p = (...parts: string[]) => join(ROOT, ...parts);

const PAGE_DIR = p("app", "(dashboard)", "marketing", "ring-size");
const COMPONENT_DIRS = [p("components", "domain", "marketing", "ring-size")];
const COMPONENT_FILES = [p("components", "domain", "marketing", "RingSizeStats.tsx"), p("components", "ui", "RelativeBar.tsx")];
const ACTION_FILE = p("lib", "actions", "ring-size-stats.ts");
const LIB_FILES = ["ring-size-filters.ts", "ring-size-format.ts", "ring-size-labels.ts", "ring-size-stats.ts"].map((f) => p("lib", "marketing", f));

const UI_FILES = [...COMPONENT_DIRS.flatMap((d) => listSources(d)), ...COMPONENT_FILES];
const PAGE_FILES = listSources(PAGE_DIR);
const ALL_FILES = [...UI_FILES, ...PAGE_FILES, ACTION_FILE, ...LIB_FILES];

describe("ชุดไฟล์ที่กวาดมีจริง (กันเทสต์ผ่านเพราะกวาดไม่เจอไฟล์)", () => {
  it("มีไฟล์ครบตามที่ระบุ", () => {
    for (const f of [...COMPONENT_FILES, ACTION_FILE, ...LIB_FILES]) expect(existsSync(f), rel(f)).toBe(true);
    expect(PAGE_FILES.map(rel).sort()).toEqual(["app/(dashboard)/marketing/ring-size/loading.tsx", "app/(dashboard)/marketing/ring-size/page.tsx"]);
    expect(UI_FILES.length).toBeGreaterThanOrEqual(12);
  });
});

describe("เคส 8 — ไม่มี dangerouslySetInnerHTML / การเขียน HTML ดิบ", () => {
  it.each(ALL_FILES.map((f) => [rel(f), f]))("%s", (_n, f) => {
    const code = readStripped(f as string);
    expect(code).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|document\.write/);
  });
});

describe("เคส 9 — ไม่มี chart library ใหม่ (ตาราง + แท่ง CSS เท่านั้น)", () => {
  const CHART_LIBS = /\b(recharts|chart\.js|react-chartjs-2|d3|d3-[a-z]+|victory|@nivo\/[a-z]+|apexcharts|react-apexcharts|echarts|@visx\/[a-z]+|@tremor\/react|plotly\.js|react-plotly\.js|highcharts|chartist|@mui\/x-charts)\b/;
  it.each(ALL_FILES.map((f) => [rel(f), f]))("%s ไม่ import chart lib", (_n, f) => {
    const imports = readStripped(f as string).match(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'][^"']+["']/g) ?? [];
    for (const i of imports) expect(i).not.toMatch(CHART_LIBS);
  });
  it("package.json ไม่มี chart library (ทั้ง dependencies และ devDependencies)", () => {
    const pkg = JSON.parse(readFileSync(p("package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    expect(names.filter((n) => CHART_LIBS.test(n))).toEqual([]);
  });
});

describe("เคส 7 — ไม่ hardcode ช่วงเบอร์ร้าน 45/68 (ใช้ shop_range จาก RPC)", () => {
  it.each(ALL_FILES.map((f) => [rel(f), f]))("%s", (_n, f) => {
    // ตัวเลข 45 หรือ 68 เป็นโทเคนเดี่ยวในโค้ด (ไม่ใช่ส่วนของเลขที่ยาวกว่า / class เช่น w-45)
    expect(readStripped(f as string)).not.toMatch(/(?<![\w.-])(45|68)(?![\w.-])/);
  });
  it("ไม่ import lib/ring-size/config (SHOP_RING_SIZES ของหน้าสาธารณะ)", () => {
    for (const f of ALL_FILES) expect(readStripped(f), rel(f)).not.toMatch(/lib\/ring-size\/config|SHOP_RING_SIZES/);
  });
});

describe("เคส 5 — แถวดิบ/session id/เวลา ห้ามถึง client: ประกอบทีละ field ไม่ spread", () => {
  it("ตัวแปลงผล RPC และ action ไม่ใช้ spread (...) และไม่อ้าง key แถวดิบ", () => {
    for (const f of [p("lib", "marketing", "ring-size-stats.ts"), ACTION_FILE]) {
      const code = readStripped(f);
      expect(code, rel(f)).not.toMatch(/\.\.\./);
      expect(code, rel(f)).not.toMatch(/session_id|sessionId|created_at|createdAt|updated_at|\bsid\b|user_agent|userAgent/);
    }
  });
  it("action ไม่ cast ผล RPC ตรงๆ เป็น RingSizeStats (ต้องผ่าน parseRingSizeStats)", () => {
    const code = readStripped(ACTION_FILE);
    expect(code).toMatch(/parseRingSizeStats\(data\)/);
    expect(code).not.toMatch(/as\s+RingSizeStats|as\s+unknown\s+as/);
  });
});

describe("เคส 6 — ไม่ log ก้อน error ทั้งก้อน (PII) — ใช้ readErrorCode เท่านั้น", () => {
  it.each([ACTION_FILE, ...PAGE_FILES].map((f) => [rel(f), f]))("%s", (_n, f) => {
    const code = readStripped(f as string);
    expect(code).not.toMatch(/console\.\w+\(\s*(err|error|e)\s*[,)]/);
    expect(code).not.toMatch(/console\.\w+\([^;\n]*,\s*(err|error|e)\s*\)/);
    expect(code).not.toMatch(/JSON\.stringify\(\s*(err|error|e)\b/);
    expect(code).not.toMatch(/\$\{\s*(err|error|e)\s*\}/);
    expect(code).not.toMatch(/error\.message|err\.message|readErrorMessage/);
    if (/console\.error/.test(code)) expect(code).toMatch(/readErrorCode\(/);
  });
});

describe("client ไม่มี network / server action / DB / env ของ server", () => {
  it.each(UI_FILES.map((f) => [rel(f), f]))("%s", (_n, f) => {
    const code = readStripped(f as string);
    expect(code).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
    expect(code).not.toMatch(/\/api\/ring-size/);
    expect(code).not.toMatch(/@\/lib\/actions\/|@\/lib\/supabase\/|@\/lib\/dev\/context|server-only|process\.env/);
    expect(code).not.toMatch(/shop_?id/i);
    expect(code).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
  it("page.tsx เรียก action เดียวคือ getRingSizeStats และไม่ import supabase ตรง", () => {
    const code = readStripped(join(PAGE_DIR, "page.tsx"));
    expect(code).toMatch(/getRingSizeStats/);
    expect(code).not.toMatch(/@\/lib\/supabase\/server|getServiceClient|\.rpc\(/);
  });
});

describe("UX/ถ้อยคำ — ไม่มี zinc-400 กับข้อความ · ไม่มีคำต้องห้าม · ไม่มีตัวกรองช่องทาง (A3 เลิก)", () => {
  it.each(UI_FILES.concat(PAGE_FILES).map((f) => [rel(f), f]))("%s", (_n, f) => {
    const code = readStripped(f as string);
    expect(code).not.toMatch(/zinc-400/); // ต่ำกว่า WCAG AA บนพื้นขาว (ใช้ zinc-600/500)
    expect(code).not.toMatch(/PDPA|ปลอดภัยตามกฎหมาย/);
    expect(code).not.toMatch(/\bG[1-5]\b/);
    expect(code).not.toMatch(/by_src|bySrc|src_options|srcOptions|ring_size_src/);
    expect(code).not.toMatch(/<select\b/); // ไม่มี select ช่องทาง
  });
  it("ไฟล์ lib/action ไม่มี src เป็นพารามิเตอร์ของ action/RPC", () => {
    const action = readStripped(ACTION_FILE);
    expect(action).not.toMatch(/\bsrc\b|p_src/);
  });
  it("inline style ใช้เฉพาะ width ของแท่ง (ค่าไดนามิก) ที่เดียว", () => {
    const withStyle = UI_FILES.concat(PAGE_FILES).filter((f) => /\bstyle=\{\{/.test(readStripped(f)));
    expect(withStyle.map(rel)).toEqual(["components/ui/RelativeBar.tsx"]);
    expect(readStripped(p("components", "ui", "RelativeBar.tsx"))).toMatch(/style=\{\{\s*width:/);
  });
});

describe("nav + middleware", () => {
  it("เมนู 'ไซส์แหวน' อยู่ในเมนู 'เพิ่มเติม' (ไม่ดันแถบล่างมือถือเกิน 4 ช่องหลัก · href ไม่ซ้ำ)", () => {
    const row = MARKETING_NAV.find((i) => i.href === "/marketing/ring-size");
    expect(row).toBeDefined();
    expect(row).toMatchObject({ label: "ไซส์แหวน", tab: "more", mobile: "more", sidebar: false });
    expect(new Set(MARKETING_NAV.map((i) => i.href)).size).toBe(MARKETING_NAV.length);
    expect(MARKETING_NAV.filter((i) => i.mobile === "main").length).toBeLessThanOrEqual(4);
    // หน้า gem quiz เดิมยังอยู่
    expect(MARKETING_NAV.some((i) => i.href === "/marketing/gem-quiz")).toBe(true);
  });
  it("/marketing/ring-size ไม่ใช่ path ที่ข้าม login gate (มี gate ของ middleware) · /ring-size สาธารณะยังข้ามเหมือนเดิม", () => {
    expect(isExemptPath("/marketing/ring-size")).toBe(false);
    expect(isExemptPath("/marketing/ring-size/")).toBe(false);
    expect(isExemptPath("/marketing/ring-size/x")).toBe(false);
    expect(isExemptPath("/ring-size")).toBe(true);
    expect(isExemptPath("/gem-quiz")).toBe(true);
  });
});

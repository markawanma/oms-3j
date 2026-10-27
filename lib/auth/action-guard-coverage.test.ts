// lib/auth/action-guard-coverage.test.ts — ratchet: ทุก export ของไฟล์ "use server" ใน lib/actions
// ต้องมี guard ในตัว หรือถูกระบุใน allowlist อย่างตั้งใจ (H1 Phase 2, design §4 "ratchet test")
//
// ทำไม: server action เป็น public POST endpoint — page/middleware gate ไม่คุ้มครองมัน (H1 root cause)
// ที่ผ่านมา guard เป็นวินัย action ใหม่ที่ลืมใส่ไม่มีอะไรจับ → เทสต์นี้จับตั้งแต่ CI
//
// ⚠️ เป็น regex ไม่ใช่ proof: ตรวจว่า "body ของ action มีการเรียก guard token อย่างน้อยหนึ่งตัว"
// (ไม่ตรวจว่าเป็นบรรทัดแรก/ครอบทุก path) — body ที่เรียก guard ผ่าน wrapper ชื่ออื่นต้องเพิ่ม token
// ใน GUARD_TOKENS · คอมเมนต์ + เนื้อใน string/template/regex ถูกตัดทิ้งก่อน match (กันหลอกด้วยคอมเมนต์
// แบบเดียวกับ lib/jobs/worker-boundary.test.ts) · คู่กับ exempt-graph.test.ts (ด่านโครงสร้างของหน้า exempt)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const USE_SERVER_LINE = /^\s*["']use server["'];?\s*$/m;

/**
 * Token ที่นับว่าเป็น guard ในตัว action.
 *  - requireOwnerSession: members.ts (เจ้าของร้านเท่านั้น · throw) — ไม่อยู่ในรายการของ design แต่เป็น guard จริงของไฟล์นั้น
 *  - guard: lib/jobs/office-server.ts ของกลุ่ม jobs/gems/job-workers (session + canManageJobs)
 */
const GUARD_TOKENS =
  /\b(?:requireWriteAccess|requireMemberAccess|requireOwnerAdmin|requireOwnerSession|getEffectiveRole|guard)\s*\(/;

// ---- ตั้งใจเปิดถาวร ---------------------------------------------------------------------
// "*" = ทั้งไฟล์. แต่ละรายการต้องมีเหตุผล และถูกบังคับต่อโดย exempt-graph.test.ts / worker-boundary*.test.ts
const PERMANENT_UNGATED: Record<string, "*" | string[]> = {
  // /stock/hero จอสาธารณะ (มติเจ้าของ §E.1) — select เฉพาะ sku/name/is_active/qty ไม่มีราคา/ต้นทุน/PII
  // (exempt-graph.test.ts ตรวจ source ว่าห้ามมีคำเหล่านั้น)
  "lib/actions/hero-stock.ts": ["getHeroStock", "getProductPickerOptions"],
  // ไม่มีข้อมูล · ถูก bundle เข้า /stock/hero ผ่าน layout อยู่แล้ว
  "lib/actions/auth.ts": ["signOut"],
  // ช่างพิสูจน์ตัวด้วย token+PIN ที่ DB โดยตั้งใจ — ห้ามใส่ session guard (ขอบเขตกันโดย lib/jobs/worker-boundary*.test.ts)
  "lib/actions/job-worker.ts": "*",
  // delegate ไป advancePiece ซึ่ง guard แล้ว (เทสต์ด้านล่างตรวจว่า advancePiece มี guard จริง)
  "lib/actions/content-pieces.ts": ["postPieceNoUrl"],
};

// ============================================================================
// ตัวแยก source: ตัดคอมเมนต์ + blank เนื้อ string/template/regex แล้วแยก body ของ export async function
// ============================================================================

/** ลบคอมเมนต์ และแทนเนื้อใน string/template/regex ด้วยค่าว่าง (เหลือแค่เครื่องหมายคร่อม) — braces/คำใน string จึงไม่รบกวน brace matching และไม่นับเป็น guard */
export function toCodeOnly(src: string): string {
  const n = src.length;
  let i = 0;
  const out: string[] = [];

  function code(stopAtCloseBrace: boolean): void {
    let depth = 0;
    let lastSig = "";
    while (i < n) {
      const c = src[i];
      const d = src[i + 1];
      if (c === "/" && d === "/") {
        while (i < n && src[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && d === "*") {
        const e = src.indexOf("*/", i + 2);
        i = e < 0 ? n : e + 2;
        out.push(" ");
        continue;
      }
      if (c === '"' || c === "'") {
        out.push(c);
        i++;
        while (i < n && src[i] !== c && src[i] !== "\n") i += src[i] === "\\" ? 2 : 1;
        out.push(c);
        i++;
        lastSig = c;
        continue;
      }
      if (c === "`") {
        out.push("`");
        i++;
        template();
        out.push("`");
        lastSig = "`";
        continue;
      }
      if (c === "/" && (lastSig === "" || "(,=:[!&|?{};+-*%<>~^".includes(lastSig))) {
        // regex literal
        i++;
        let inClass = false;
        while (i < n && src[i] !== "\n") {
          const ch = src[i];
          if (ch === "\\") {
            i += 2;
            continue;
          }
          if (ch === "[") inClass = true;
          else if (ch === "]") inClass = false;
          else if (ch === "/" && !inClass) {
            i++;
            break;
          }
          i++;
        }
        while (i < n && /[a-z]/i.test(src[i])) i++;
        out.push("/r/");
        lastSig = "/";
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        if (stopAtCloseBrace && depth === 0) return; // caller consumes the '}'
        depth--;
      }
      out.push(c);
      if (!/\s/.test(c)) lastSig = c;
      i++;
    }
  }

  function template(): void {
    while (i < n) {
      const c = src[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        i++;
        return;
      }
      if (c === "$" && src[i + 1] === "{") {
        i += 2;
        const mark = out.length;
        code(true);
        out.length = mark; // เนื้อใน ${...} ไม่นับ
        i++; // '}'
        continue;
      }
      i++;
    }
  }

  code(false);
  return out.join("");
}

export interface ExtractedAction {
  name: string;
  body: string;
}

/** แยก body ของทุก `export async function` ด้วย brace matching (ไม่ใช่ "จนถึง export ถัดไป" — ไม่งั้น helper ที่อยู่ท้าย function อื่นจะแอบนับเป็น guard ของมัน) */
export function extractActions(src: string): ExtractedAction[] {
  const code = toCodeOnly(src);
  const actions: ExtractedAction[] = [];
  for (const m of code.matchAll(/export\s+async\s+function\s+(\w+)/g)) {
    let i = (m.index as number) + m[0].length;
    // ข้าม generic params (ถ้ามี) แล้ว paren-match รายการพารามิเตอร์
    while (i < code.length && code[i] !== "(") i++;
    let paren = 0;
    for (; i < code.length; i++) {
      if (code[i] === "(") paren++;
      else if (code[i] === ")" && --paren === 0) {
        i++;
        break;
      }
    }
    // หา '{' เริ่ม body — ข้าม '{' ที่อยู่ใน type argument ของ return type (เช่น Promise<ActionResult<{ id: string }>>)
    let angle = 0;
    for (; i < code.length; i++) {
      const ch = code[i];
      if (ch === "<") angle++;
      else if (ch === ">" && code[i - 1] !== "=") angle = Math.max(0, angle - 1);
      else if (ch === "{" && angle === 0) break;
    }
    if (i >= code.length) throw new Error(`หา body ของ ${m[1]} ไม่เจอ`);
    const start = i;
    let brace = 0;
    for (; i < code.length; i++) {
      if (code[i] === "{") brace++;
      else if (code[i] === "}" && --brace === 0) break;
    }
    if (brace !== 0) throw new Error(`brace ของ ${m[1]} ไม่สมดุล (ตัวแยก source ผิดพลาด)`);
    actions.push({ name: m[1], body: code.slice(start, i + 1) });
  }
  return actions;
}

/** รูปแบบ export อื่นที่ตัวแยกไม่เห็น — ถ้ามีใน "use server" ไฟล์ ratchet จะถูกเลี่ยงได้เงียบๆ จึงให้เทสต์ล้มแทน */
export function unsupportedExportForms(src: string): string[] {
  const code = toCodeOnly(src);
  return [...code.matchAll(/^\s*export\s+(?:default\b|const\b|let\b|var\b|function\b|async\s+function\s*\*|\*|\{)/gm)].map((m) =>
    m[0].trim(),
  );
}

export function ungatedActions(src: string): string[] {
  return extractActions(src)
    .filter((a) => !GUARD_TOKENS.test(a.body))
    .map((a) => a.name);
}

// ============================================================================
// ข้อมูลจริงใน lib/actions
// ============================================================================

interface ActionFile {
  rel: string;
  src: string;
}

const ACTION_FILES: ActionFile[] = readdirSync(join(ROOT, "lib", "actions"))
  .filter((n) => /\.ts$/.test(n) && !/\.test\.ts$/.test(n))
  .map((n) => ({ rel: `lib/actions/${n}`, src: readFileSync(join(ROOT, "lib", "actions", n), "utf8") }))
  .filter((f) => USE_SERVER_LINE.test(f.src))
  .sort((a, b) => a.rel.localeCompare(b.rel));

function allowedNames(file: string): "*" | string[] {
  const perm = PERMANENT_UNGATED[file];
  if (perm === "*") return "*";
  return perm ?? [];
}

describe("ratchet: ทุก export ใน lib/actions ('use server') ต้องมี guard หรืออยู่ใน allowlist", () => {
  it("ไม่มี action ที่ไม่ guard และไม่ได้ระบุไว้ใน allowlist", () => {
    const violations: string[] = [];
    for (const f of ACTION_FILES) {
      const allow = allowedNames(f.rel);
      if (allow === "*") continue;
      for (const name of ungatedActions(f.src)) {
        if (!allow.includes(name)) violations.push(`${f.rel}#${name}`);
      }
    }
    expect(
      violations,
      "action เหล่านี้ไม่มี requireWriteAccess/requireMemberAccess/requireOwnerAdmin/requireOwnerSession/getEffectiveRole/guard ในตัว — " +
        "เพิ่ม guard (design H1 §1) หรือ ถ้าตั้งใจเปิดจริงให้ใส่ PERMANENT_UNGATED พร้อมเหตุผล",
    ).toEqual([]);
  });

  it("allowlist ไม่ค้าง: ทุกรายการยังมีอยู่จริงและยังไม่ guard (guard แล้ว = ตัดออกจาก allowlist — ratchet ขยับทางเดียว)", () => {
    const stale: string[] = [];
    for (const [file, names] of Object.entries(PERMANENT_UNGATED)) {
      const f = ACTION_FILES.find((x) => x.rel === file);
      if (!f) {
        stale.push(`PERMANENT ${file} ไม่ใช่ไฟล์ "use server" ใน lib/actions แล้ว`);
        continue;
      }
      if (names === "*") continue;
      const ungated = new Set(ungatedActions(f.src));
      const exported = new Set(extractActions(f.src).map((a) => a.name));
      for (const name of names) {
        if (!exported.has(name)) stale.push(`PERMANENT ${file}#${name} ไม่ได้ export แล้ว (ย้าย/ลบ?)`);
        else if (!ungated.has(name)) stale.push(`PERMANENT ${file}#${name} มี guard แล้ว — ตัดออกจาก allowlist`);
      }
    }
    expect(stale).toEqual([]);
  });

  it("Phase 1-3 ปิดแล้ว: ไฟล์ที่ H1 แตะทั้งหมดต้องไม่มี action ที่ไม่ guard (ไม่มี TEMP allowlist เหลือ)", () => {
    const files = [
      "orders", "crm", "dashboard", "crm-retention", // Phase 1
      "marketing", "catalog", "catalog-images", "catalog-sku", "tiktok-sales", // Phase 2
      "stock", "quick-order", "products", "live", // Phase 3
    ].map((n) => `lib/actions/${n}.ts`);
    for (const file of files) {
      expect(PERMANENT_UNGATED[file], file).toBeUndefined();
      const f = ACTION_FILES.find((x) => x.rel === file);
      expect(f, file).toBeDefined();
      expect(ungatedActions((f as ActionFile).src), file).toEqual([]);
    }
  });

  it("getManualTiktokChannelAccountId ย้ายออกจาก \"use server\" แล้ว: live.ts ไม่ export · อยู่ใน lib/live/channel-account.ts (server-only ไม่ใช่ use server)", () => {
    const live = ACTION_FILES.find((x) => x.rel === "lib/actions/live.ts") as ActionFile;
    expect(extractActions(live.src).map((a) => a.name)).not.toContain("getManualTiktokChannelAccountId");
    const moved = readFileSync(join(ROOT, "lib", "live", "channel-account.ts"), "utf8");
    expect(USE_SERVER_LINE.test(moved)).toBe(false);
    expect(/^import\s+["']server-only["'];?\s*$/m.test(moved)).toBe(true);
    expect(/export\s+async\s+function\s+getManualTiktokChannelAccountId\b/.test(moved)).toBe(true);
  });

  it("'use server' ไฟล์ไม่มีรูปแบบ export ที่ตัวแยกมองไม่เห็น (export const/default/{ } ฯลฯ) — กัน ratchet ถูกเลี่ยงเงียบๆ", () => {
    const bad = ACTION_FILES.flatMap((f) => unsupportedExportForms(f.src).map((x) => `${f.rel}: ${x}`));
    expect(bad).toEqual([]);
  });

  it("postPieceNoUrl delegate ไป advancePiece — advancePiece ต้องมี guard จริง", () => {
    const f = ACTION_FILES.find((x) => x.rel === "lib/actions/content-pieces.ts") as ActionFile;
    const adv = extractActions(f.src).find((a) => a.name === "advancePiece");
    expect(adv, "advancePiece หายไป").toBeDefined();
    expect(GUARD_TOKENS.test((adv as ExtractedAction).body)).toBe(true);
  });
});

describe("ตัวแยก source ต้องทำงานจริง (negative controls — กัน ratchet ว่างเปล่า)", () => {
  it("ตัวแยกเจอ action ครบ: จำนวน = นับ `export async function` ระดับบรรทัด · มากพอสมเหตุสมผล", () => {
    let total = 0;
    for (const f of ACTION_FILES) {
      const expected = [...f.src.matchAll(/^export async function \w+/gm)].length;
      const got = extractActions(f.src).length;
      expect(got, f.rel).toBe(expected);
      total += got;
    }
    expect(total).toBeGreaterThanOrEqual(150);
    expect(ACTION_FILES.length).toBeGreaterThanOrEqual(40);
  });

  it("เห็นของที่ guard แล้วจริง: orders.listOrders / crm.getCrmOverview / dashboard.getDashboard / stock.adjustStock / live.getTopSkus มี guard token", () => {
    for (const [file, name] of [
      ["lib/actions/orders.ts", "listOrders"],
      ["lib/actions/crm.ts", "getCrmOverview"],
      ["lib/actions/dashboard.ts", "getDashboard"],
      ["lib/actions/stock.ts", "adjustStock"],
      ["lib/actions/live.ts", "getTopSkus"],
    ]) {
      const f = ACTION_FILES.find((x) => x.rel === file) as ActionFile;
      const a = extractActions(f.src).find((x) => x.name === name);
      expect(a, `${file}#${name}`).toBeDefined();
      expect(GUARD_TOKENS.test((a as ExtractedAction).body), `${file}#${name}`).toBe(true);
    }
  });

  it("mutant: action ใหม่ที่ไม่มี guard ถูกจับ", () => {
    const src = `"use server";
export async function leakyRead(): Promise<ActionResult<{ a: number }>> {
  try { return { ok: true, data: { a: 1 } }; } catch { return { ok: false, error: "x" }; }
}`;
    expect(ungatedActions(src)).toEqual(["leakyRead"]);
  });

  it("mutant: guard ที่อยู่ในคอมเมนต์ / string / template ไม่นับ", () => {
    const src = `"use server";
export async function a(): Promise<void> {
  // await requireMemberAccess();
  /* const g = await guard(); */
  const s = "requireWriteAccess(";
  const t = \`\${await getEffectiveRole()}\`;
  return;
}`;
    expect(ungatedActions(src)).toEqual(["a"]);
  });

  it("mutant: guard ใน helper/function ถัดไปไม่ถูกนับเป็นของ action ก่อนหน้า", () => {
    const src = `"use server";
export async function first(): Promise<void> {
  return;
}
async function helper() { await getEffectiveRole(); }
export async function second(): Promise<void> {
  const gateErr = await requireMemberAccess();
  if (gateErr) return;
}`;
    expect(ungatedActions(src)).toEqual(["first"]);
  });

  it("ต้องไม่พัง: return type ที่มี { } ใน generic, default param, regex/string ที่มี brace — ยังแยก body ถูก", () => {
    const src = `"use server";
export async function ok(p: { a: string } = { a: "{" }): Promise<ActionResult<{ id: string }>> {
  const gateErr = await requireMemberAccess();
  if (gateErr) return gateErr;
  const re = /\\d{4}/;
  const msg = "}}}";
  return { ok: true, data: { id: msg + String(re) } };
}
export async function bad(): Promise<void> { return; }`;
    expect(extractActions(src).map((a) => a.name)).toEqual(["ok", "bad"]);
    expect(ungatedActions(src)).toEqual(["bad"]);
  });

  it("mutant: รูปแบบ export ที่หลบ ratchet ถูกจับ", () => {
    expect(unsupportedExportForms(`export const x = async () => 1;`).length).toBe(1);
    expect(unsupportedExportForms(`export { a, b };`).length).toBe(1);
    expect(unsupportedExportForms(`export async function ok() {}\nexport type T = 1;`)).toEqual([]);
  });
});

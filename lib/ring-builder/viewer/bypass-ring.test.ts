// โมเดล 3D: pure · ตัวเลขต้องนิ่ง (พอร์ตตรงตัวจากต้นฉบับ — ห้าม refactor คณิตศาสตร์) · ไม่มีข้อมูลภายใน (X6)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GEM_QUIZ_STONE_BY_CODE, GEM_QUIZ_STONE_CODES } from "@/lib/gem-quiz/config";
import { BYPASS2, buildBypassRing, computeCameraFrame, type RingMesh } from "./bypass-ring";
import { CZ_TINT, hexToRgb, ringTints, stoneTint } from "./gem-colors";
import { FOV, TILT, buildCamera, mmul, persp, rotX, rotY, trans } from "./matrix";

function checkMesh(m: RingMesh, label: string) {
  expect(m.pos.length % 3, label).toBe(0);
  expect(m.nor.length, label).toBe(m.pos.length);
  expect(m.idx.length % 3, label).toBe(0);
  const vtx = m.pos.length / 3;
  for (let i = 0; i < m.pos.length; i++) {
    if (!Number.isFinite(m.pos[i]) || !Number.isFinite(m.nor[i])) throw new Error(`${label}: NaN/Inf ที่ ${i}`);
  }
  for (let i = 0; i < m.idx.length; i++) {
    if (m.idx[i] >= vtx) throw new Error(`${label}: index ${m.idx[i]} เกิน ${vtx}`);
  }
}

describe("buildBypassRing", () => {
  const ring = buildBypassRing();

  it("4 เม็ด: พลอยไข่ 2 (บน/ล่าง) + CZ เล็ก 2 · ทุก mesh ถูกต้อง (ไม่มี NaN · ดัชนีไม่หลุด)", () => {
    expect(ring.gems).toHaveLength(4);
    checkMesh(ring.metal, "metal");
    ring.gems.forEach((g, i) => checkMesh(g.mesh, `gem${i}`));
    expect(ring.metal.idx.length).toBeGreaterThan(1000);
  });
  it("ขนาดพลอยไข่ = 7×5 มม. (ค่าจากเจ้าของ) · CZ = 1.5 มม.", () => {
    expect(BYPASS2.ovalLongMm).toBe(7);
    expect(BYPASS2.ovalShortMm).toBe(5);
    expect(ring.gems[0].radiusMm).toBe(3.5);
    expect(ring.gems[1].radiusMm).toBe(3.5);
    expect(ring.gems[2].radiusMm).toBeCloseTo(0.75, 10);
    expect(ring.gems[3].radiusMm).toBeCloseTo(0.75, 10);
  });
  it("จำนวนจุดยอดไม่เกินขีดของ index 16 บิต (Uint16) และไม่หนักเกินมือถือรุ่นล่าง", () => {
    expect(ring.metal.pos.length / 3).toBeLessThan(65535);
    expect(ring.vertexCount).toBeLessThan(60000);
  });
  it("พลอยไข่บนอยู่ z ลบ · ล่างอยู่ z บวก (ตำแหน่ง 1 = บนในมุมหน้า)", () => {
    expect(ring.gems[0].center[2]).toBeCloseTo(-BYPASS2.stoneZMm, 10);
    expect(ring.gems[1].center[2]).toBeCloseTo(BYPASS2.stoneZMm, 10);
  });
  it("deterministic: สร้างสองครั้งได้ mesh เดียวกันทุก byte", () => {
    const again = buildBypassRing();
    expect(Array.from(again.metal.pos)).toEqual(Array.from(ring.metal.pos));
    expect(Array.from(again.gems[0].mesh.pos)).toEqual(Array.from(ring.gems[0].mesh.pos));
    expect(again.frame).toEqual(ring.frame);
  });
  it("เฟรมกล้องใช้สูตรเดียวกับต้นฉบับ (span = สูงทั้งวง · cy = กึ่งกลางกรอบ)", () => {
    const innerR = BYPASS2.innerDiaMm / 2;
    const headEff = Math.max(BYPASS2.headHeightMm, 0.43 * 5 + 0.035 * 5 + 0.25);
    const Rg = innerR + BYPASS2.bandThickMm + headEff;
    const top = Rg + Math.min(BYPASS2.stoneMm * 0.6, 2.4);
    const bot = innerR + 1.2;
    const mx = Math.max(...ring.gems.map((g) => Math.abs(g.center[0])));
    expect(ring.frame.span).toBeCloseTo(Math.max(top + bot, 2 * (mx + BYPASS2.stoneMm / 2 + 0.4), 2 * bot), 10);
    expect(ring.frame.cy).toBeCloseTo((top - bot) / 2, 10);
    expect(computeCameraFrame(ring.gems, { innerDiaMm: BYPASS2.innerDiaMm, stoneMm: BYPASS2.stoneMm, girdleRadiusMm: Rg })).toEqual(ring.frame);
  });
  it("X6: ไม่พอร์ต generator แบบแถว/spec/โหมด dev · ผลลัพธ์ไม่มี info/notes", () => {
    for (const f of ["bypass-ring.ts", "gl-renderer.ts", "matrix.ts", "gem-colors.ts"]) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/function buildRowRing|function buildSpec|#dev|devonly|"dev"/);
    }
    expect(Object.keys(ring).sort()).toEqual(["frame", "gems", "metal", "vertexCount"]);
  });
});

describe("matrix (พอร์ตตรงตัว)", () => {
  it("mmul กับ identity ไม่เปลี่ยนค่า · rotX/rotY ที่ 0 = identity", () => {
    const I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const m = persp(0.42, 1.5, 1, 100);
    expect(Array.from(mmul(I, m))).toEqual(Array.from(m));
    // -0 กับ 0 ต่างกันใน toEqual แต่เป็นค่าเดียวกันทางคณิตศาสตร์ — เทียบแบบใกล้เคียง
    Array.from(I).forEach((v, i) => {
      expect(rotX(0)[i]).toBeCloseTo(v, 12);
      expect(rotY(0)[i]).toBeCloseTo(v, 12);
    });
    expect(Array.from(trans(1, 2, 3)).slice(12, 15)).toEqual([1, 2, 3]);
  });
  it("buildCamera: ระยะกล้องเพิ่มตาม zoom · จอแคบ (W<H) ถอยกล้องเพิ่ม · ค่าทุกตัวจำกัด", () => {
    const f = { span: 30, cy: 1 };
    const a = buildCamera(f, 0, 0, 1, 800, 600);
    const b = buildCamera(f, 0, 0, 2, 800, 600);
    const narrow = buildCamera(f, 0, 0, 1, 300, 600);
    expect(b.distance).toBeCloseTo(a.distance * 2, 8);
    expect(narrow.distance).toBeGreaterThan(a.distance);
    for (const v of [...a.mvp, ...a.model]) expect(Number.isFinite(v)).toBe(true);
    expect(a.distance).toBeCloseTo(30 / 0.86 / (2 * Math.tan(FOV / 2)), 6);
    expect(TILT).toBe(0.5);
  });
});

describe("gem-colors — แหล่งเดียว = GEM_QUIZ_STONES", () => {
  it("สี 3D ของทุกพลอย = colors.base ของ quiz (แปลง hex → 0..1)", () => {
    for (const code of GEM_QUIZ_STONE_CODES) {
      const hex = GEM_QUIZ_STONE_BY_CODE[code].colors.base;
      expect(stoneTint(code).rgb).toEqual(hexToRgb(hex));
      expect(stoneTint(code).cz).toBe(false);
    }
  });
  it("ringTints: [บน, ล่าง, CZ, CZ] · null = CZ ขาว · CZ เล็กขาวตายตัวไม่ขึ้นกับพลอย", () => {
    const t = ringTints("citrine", "garnet");
    expect(t).toHaveLength(4);
    expect(t[0]).toEqual(stoneTint("citrine"));
    expect(t[1]).toEqual(stoneTint("garnet"));
    expect(t[2]).toBe(CZ_TINT);
    expect(t[3]).toBe(CZ_TINT);
    expect(ringTints(null, null).every((x) => x === CZ_TINT)).toBe(true);
  });
  it("hexToRgb ปฏิเสธรูปแบบผิด (ไม่เดาสี)", () => {
    for (const bad of ["", "#fff", "A3192B", "#GGGGGG", "#A3192B00", "red"]) expect(hexToRgb(bad)).toBeNull();
  });
  it("ไม่มีตาราง hex สีพลอยซ้ำใน viewer", () => {
    const src = readFileSync(new URL("./gem-colors.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
  });
});

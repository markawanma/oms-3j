// lib/auth/deployment.test.ts — isRealDeployment() / actionGateEnforced() (มติ 3 พ.ย. 69 A-แคบ)
// ชั้น action ต้องบังคับเสมอบน deployment จริง ไม่ว่า AUTH_GATE จะเป็นอะไร · local dev ฟัง AUTH_GATE=on เท่านั้น
// ค่า real ต่อ VERCEL_ENV เขียนตรงๆ ในตาราง (ไม่คำนวณซ้ำด้วย logic เดียวกับตัวจริง) เพื่อให้ตาราง ≠ สำเนาของโค้ด
import { afterEach, describe, expect, it, vi } from "vitest";
import { actionGateEnforced, isRealDeployment } from "./deployment";

afterEach(() => {
  vi.unstubAllEnvs(); // restores NODE_ENV ("test"), VERCEL_ENV, AUTH_GATE to what the suite started with
});

const NODE_ENVS = ["test", "production"] as const;
const GATES = [undefined, "off", "on"] as const;
// real = ตัว VERCEL_ENV อย่างเดียวบอกว่า deployment จริง (NODE_ENV=test)
const VERCEL: { v: string | undefined; real: boolean }[] = [
  { v: undefined, real: false },
  { v: "", real: false },
  { v: "   ", real: false }, // trim แล้วว่าง = ไม่ตั้ง
  { v: "development", real: false },
  { v: "preview", real: true },
  { v: "production", real: true },
  { v: "Development", real: true }, // สะกดผิดตัวพิมพ์ = ไม่ใช่ "development" ตัวจริง -> fail-closed
  { v: " production ", real: true },
  { v: " development ", real: false }, // trim แล้วเท่ากับ development
  { v: "staging", real: true }, // ค่าที่ไม่รู้จัก = จริง (fail-closed)
];

describe("actionGateEnforced — NODE_ENV x VERCEL_ENV x AUTH_GATE", () => {
  for (const nodeEnv of NODE_ENVS) {
    for (const { v, real } of VERCEL) {
      for (const gate of GATES) {
        // NODE_ENV=production ชนะทุกอย่าง (build จริง · Next inline ตอน build ปลอมตอน runtime ไม่ได้)
        const expected = nodeEnv === "production" || real || gate === "on";
        it(`NODE_ENV=${nodeEnv} VERCEL_ENV=${JSON.stringify(v)} AUTH_GATE=${JSON.stringify(gate)} -> ${expected}`, () => {
          vi.stubEnv("NODE_ENV", nodeEnv);
          vi.stubEnv("VERCEL_ENV", v);
          vi.stubEnv("AUTH_GATE", gate);
          expect(actionGateEnforced()).toBe(expected);
        });
      }
    }
  }
});

describe("ต้องบังคับ: deployment จริง + AUTH_GATE ปิด/ไม่ตั้ง (กรณีที่ A-แคบแก้)", () => {
  it.each([undefined, "off", "OFF", "0", "true", ""] as const)("VERCEL_ENV=production AUTH_GATE=%j -> enforced", (gate) => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("AUTH_GATE", gate);
    expect(actionGateEnforced()).toBe(true);
  });

  it("VERCEL_ENV=preview AUTH_GATE=off -> enforced (preview เขียน DB จริง)", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("AUTH_GATE", "off");
    expect(actionGateEnforced()).toBe(true);
  });

  it("NODE_ENV=production + VERCEL_ENV=development + AUTH_GATE unset -> enforced (production build ชนะ)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv("AUTH_GATE", undefined);
    expect(actionGateEnforced()).toBe(true);
  });
});

describe("ต้องไม่พัง: local dev ยังเปิดได้เมื่อไม่ตั้ง AUTH_GATE=on", () => {
  it("NODE_ENV=test + VERCEL_ENV unset + AUTH_GATE unset -> not enforced", () => {
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("AUTH_GATE", undefined);
    expect(process.env.NODE_ENV).toBe("test");
    expect(actionGateEnforced()).toBe(false);
  });

  it("NODE_ENV=development + VERCEL_ENV=development + AUTH_GATE=off -> not enforced", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv("AUTH_GATE", "off");
    expect(actionGateEnforced()).toBe(false);
  });

  it("local dev + AUTH_GATE=on -> enforced (ทดสอบ gate บนเครื่องได้เหมือนเดิม)", () => {
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("AUTH_GATE", "on");
    expect(actionGateEnforced()).toBe(true);
  });

  it('AUTH_GATE ต้องเป็น "on" เป๊ะ (ไม่ใช่ "ON"/"true"/"1") — ตรงกับ middleware', () => {
    vi.stubEnv("VERCEL_ENV", undefined);
    for (const g of ["ON", "true", "1", " on"]) {
      vi.stubEnv("AUTH_GATE", g);
      expect(actionGateEnforced(), g).toBe(false);
    }
  });
});

describe("isRealDeployment (ย้ายมาจาก role.ts — logic เดิม)", () => {
  it("suite premise: NODE_ENV=test, ไม่ใช่ deployment จริงเมื่อ VERCEL_ENV ไม่ตั้ง", () => {
    vi.stubEnv("VERCEL_ENV", undefined);
    expect(isRealDeployment()).toBe(false);
  });

  it("ไม่ขึ้นกับ AUTH_GATE", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("AUTH_GATE", "off");
    expect(isRealDeployment()).toBe(true);
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("AUTH_GATE", "on");
    expect(isRealDeployment()).toBe(false);
  });
});

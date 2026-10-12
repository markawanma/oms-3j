// QA (R2-D2) — J1 ข้อความไทย: ทุก code/hint ที่ migration 0172 raise ต้องมีข้อความไทยในตาราง
//  - อ่านไฟล์ migration จริง (ไม่ใช่รายการที่จดมือ) → เพิ่ม code ใหม่ใน SQL แล้วลืมแปล = แดงทันที
//  - 🐞 BUG-J1-03 (Low): ผู้แพ้การรับขั้นพร้อมกันเห็น "มีคนรับขั้นนี้ไปแล้ว" ไม่มีชื่อ ทั้งที่ DB ส่ง "ขั้นนี้ถูกรับไปแล้วโดย <ชื่อ>"
//    (lib/jobs/messages.ts workerFailMessage เลือกตารางก่อนข้อความ DB · design §5 ระบุ "รับแล้วโดย X")
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OFFICE_HINT_TH, WORKER_CODE_TH, officeErrorMessage, workerFailMessage } from "@/lib/jobs/messages";

const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/0172_job_tracking_j1.sql"), "utf8");
const THAI = /[฀-๿]/;
const TECH = /[a-z]+_[a-z_]+|analytics\.|\bselect\b|\bERROR\b/i;

describe("ครอบคลุมข้อความ — เทียบกับ SQL จริง", () => {
  it("ทุก job_fail('<code>') ฝั่งช่าง มีใน WORKER_CODE_TH", () => {
    const codes = new Set([...sql.matchAll(/job_fail\('([a-z_]+)'/g)].map((m) => m[1]));
    expect(codes.size).toBeGreaterThan(20);
    expect([...codes].filter((c) => !(c in WORKER_CODE_TH))).toEqual([]);
  });
  it("ทุก hint ที่ RPC ออฟฟิศ raise มีใน OFFICE_HINT_TH หรือ WORKER_CODE_TH", () => {
    const hints = new Set([...sql.matchAll(/hint\s*=\s*'([a-z_0-9]+)'/g)].map((m) => m[1]));
    expect(hints.size).toBeGreaterThan(20);
    expect([...hints].filter((h) => !(h in OFFICE_HINT_TH) && !(h in WORKER_CODE_TH))).toEqual([]);
  });
  it("ทุกข้อความในตารางเป็นไทย ไม่มี snake_case/ชื่อตาราง", () => {
    for (const [k, v] of [...Object.entries(WORKER_CODE_TH), ...Object.entries(OFFICE_HINT_TH)]) {
      expect(THAI.test(v), k).toBe(true);
      expect(TECH.test(v), `${k}: ${v}`).toBe(false);
    }
  });
});

describe("ข้อความผิดปกติ ไม่หลุดภาษาเทคนิค", () => {
  it("code ไม่รู้จัก + ข้อความ DB เป็นอังกฤษ/SQL → ข้อความกลาง", () => {
    expect(workerFailMessage("zzz_unknown", "duplicate key value violates constraint job_pkey")).toBe("ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง");
    expect(workerFailMessage(undefined, undefined)).toBe("ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง");
    expect(workerFailMessage({ x: 1 }, 42)).toBe("ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง");
  });
  it("error ออฟฟิศที่ไม่รู้จัก / 42501 / ข้อความมี token", () => {
    expect(officeErrorMessage({ code: "XX000", message: "relation analytics.job does not exist" })).toBe("ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง");
    expect(officeErrorMessage({ code: "42501", message: "permission denied for table job" })).toMatch(/เจ้าของร้าน/);
    expect(officeErrorMessage(null)).toBe("ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง");
    expect(officeErrorMessage("boom")).toBe("ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง");
  });
});

describe("ผู้แพ้การรับพร้อมกัน", () => {
  it.fails("BUG-J1-03: ข้อความต้องบอกว่าใครรับไปแล้ว (design §5: รับแล้วโดย X)", () => {
    const msg = workerFailMessage("already_received", "ขั้นนี้ถูกรับไปแล้วโดย สมชาย");
    expect(msg).toContain("สมชาย");
  });
});

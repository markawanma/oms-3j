// origin ใน QR (security L2): env APP_ORIGIN ชนะ Host header · ผิดรูปแบบ = ปฏิเสธ · preview/dev หรือ host ไม่ตรง = แถบเตือน
import { describe, expect, it } from "vitest";
import { ORIGIN_ENV_INVALID, ORIGIN_UNKNOWN, PREVIEW_WARNING, deployEnv, resolveAppOrigin } from "./origin";
import type { OriginInput } from "./origin";

const base = (o: Partial<OriginInput> = {}): OriginInput => ({ appOrigin: undefined, vercelEnv: "production", nodeEnv: "production", host: "app.example.test", proto: "https", ...o });

describe("deployEnv", () => {
  it("VERCEL_ENV ชนะ · ไม่ใช่ Vercel ดู NODE_ENV", () => {
    expect(deployEnv("production", "production")).toBe("production");
    expect(deployEnv("preview", "production")).toBe("preview");
    expect(deployEnv("development", "development")).toBe("dev");
    expect(deployEnv(undefined, "production")).toBe("production");
    expect(deployEnv(undefined, "development")).toBe("dev");
    expect(deployEnv(undefined, "test")).toBe("dev");
  });
});

describe("env APP_ORIGIN ตั้งไว้ — ใช้ค่านี้เสมอ ไม่สน Host header", () => {
  it("production + host ตรง = ใช้ env ไม่มีคำเตือน", () => {
    const r = resolveAppOrigin(base({ appOrigin: "https://oms.example.test" , host: "oms.example.test" }));
    expect(r).toMatchObject({ ok: true, origin: "https://oms.example.test", fromEnv: true, warning: null });
  });
  it("Host header ปลอม/ต่างจาก env ไม่เปลี่ยน origin (กัน host injection) แต่เตือน", () => {
    const r = resolveAppOrigin(base({ appOrigin: "https://oms.example.test", host: "evil.test" }));
    expect(r).toMatchObject({ ok: true, origin: "https://oms.example.test", warning: PREVIEW_WARNING });
  });
  it("เปิดจาก preview แต่ env ชี้ production = เตือน (QR ชี้เว็บ production ที่อาจยังไม่มีหน้านี้)", () => {
    const r = resolveAppOrigin(base({ appOrigin: "https://oms.example.test", vercelEnv: "preview", host: "oms-git-feature-x.vercel.app" }));
    expect(r).toMatchObject({ ok: true, warning: PREVIEW_WARNING });
  });
  it("เทียบ host ที่เปิดหน้าไม่สนตัวพิมพ์ (env ต้องเป็นตัวพิมพ์เล็ก) · พอร์ตต้องตรง", () => {
    expect(resolveAppOrigin(base({ appOrigin: "https://oms.example.test", host: "OMS.Example.TEST" }))).toMatchObject({ ok: true, warning: null });
    expect(resolveAppOrigin(base({ appOrigin: "https://oms.example.test:8443", host: "oms.example.test" }))).toMatchObject({ ok: true, warning: PREVIEW_WARNING });
  });
  it("dev: http://localhost ตั้งใน env ได้ (มีคำเตือนเพราะไม่ใช่ production)", () => {
    expect(resolveAppOrigin(base({ appOrigin: "http://localhost:3000", vercelEnv: undefined, nodeEnv: "development", host: "localhost:3000", proto: "http" }))).toMatchObject({ ok: true, origin: "http://localhost:3000", warning: PREVIEW_WARNING });
  });
});

describe("env ผิดรูปแบบ = ปฏิเสธ (fail closed ไม่ถอยไปใช้ Host)", () => {
  it.each([
    "TODO_OWNER_APP_ORIGIN",
    "http://oms.example.test",
    "https://oms.example.test/",
    "https://oms.example.test/path",
    "https://oms.example.test?x=1",
    "https://oms.example.test#x",
    "https://user@oms.example.test",
    "https://oms.example.test:99999999",
    "https://-bad.test",
    "https://localhost",
    "ftp://oms.example.test",
    "oms.example.test",
    "javascript:alert(1)",
    "https://oms.example.test https://evil.test",
    "https://oms .test",
  ])("ปฏิเสธ %s", (v) => {
    expect(resolveAppOrigin(base({ appOrigin: v }))).toEqual({ ok: false, error: ORIGIN_ENV_INVALID });
  });
  it("ค่าว่าง/ช่องว่างล้วน = ถือว่าไม่ได้ตั้ง (ใช้ Host)", () => {
    expect(resolveAppOrigin(base({ appOrigin: "   " }))).toMatchObject({ ok: true, fromEnv: false, origin: "https://app.example.test" });
  });
});

describe("ไม่ได้ตั้ง env — ทางถอยใช้ Host ที่ผ่านการตรวจ", () => {
  it("production ใช้ host ได้ ไม่เตือน", () => {
    expect(resolveAppOrigin(base())).toMatchObject({ ok: true, origin: "https://app.example.test", fromEnv: false, warning: null });
  });
  it("preview / dev = เตือน", () => {
    expect(resolveAppOrigin(base({ vercelEnv: "preview" }))).toMatchObject({ ok: true, warning: PREVIEW_WARNING });
    expect(resolveAppOrigin(base({ vercelEnv: undefined, nodeEnv: "development", host: "localhost:3000", proto: null }))).toMatchObject({ ok: true, origin: "http://localhost:3000", warning: PREVIEW_WARNING });
  });
  it("x-forwarded-host หลายค่า = ใช้ตัวแรก · proto แปลก = https", () => {
    expect(resolveAppOrigin(base({ host: "a.example.test, b.example.test", proto: "javascript" }))).toMatchObject({ ok: true, origin: "https://a.example.test" });
  });
  it.each(["", "evil.test/../x", "a b", "evil.test@x", "-bad.test", "x".repeat(130), "evil.test?x=1", "evil.test#x"])("host แปลก %j = ไม่รู้ที่อยู่", (host) => {
    expect(resolveAppOrigin(base({ host }))).toEqual({ ok: false, error: ORIGIN_UNKNOWN });
  });
  it("host เป็น null = ไม่รู้ที่อยู่", () => {
    expect(resolveAppOrigin(base({ host: null }))).toEqual({ ok: false, error: ORIGIN_UNKNOWN });
  });
});
